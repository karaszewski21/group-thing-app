"""`/api/notifications` — the recipient's own in-app inbox.

Notifications are produced as a side effect of the pledge cycle (see
`app.groups.application.pledges` / `pledge_fulfillment` / `terms`), so each
test drives a real pledge to generate one, then asserts the inbox routes.

`create_pledge`/`withdraw_pledge` now go through the outbox pattern (stage an
`OutboxEntry`, not a `Notification`, in the same transaction) rather than
writing the `Notification` row synchronously — see
`app.groups.application.pledges` and `app.notifications.outbox_listener`. So
each test must explicitly run the poller (`dispatch_pending`) after the
pledge action, before asserting on `/api/notifications/mine`, to simulate the
30s background poll.
"""

from __future__ import annotations

import uuid
from datetime import date

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.models import Notification, NotificationKind
from app.notifications.outbox_listener import register as register_outbox_handlers
from app.outbox import service as outbox_service
from app.outbox.dispatcher import dispatch_pending


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _process_outbox(db_session: AsyncSession) -> None:
    register_outbox_handlers()
    await dispatch_pending(db_session)


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _category_id(client: AsyncClient, token: str) -> str:
    categories = await client.get("/api/categories", headers=_auth(token))
    assert categories.status_code == 200
    return str(categories.json()[0]["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": await _category_id(client, token)},
        headers=_auth(token),
    )
    assert r.status_code == 200
    return r.json()["id"]


async def _setup_pledge(
    client: AsyncClient, db_session: AsyncSession, prefix: str
) -> tuple[str, str, int]:
    """`(organizer_token, guest_token, pledge_id)` — organizer circle+term+need, guest pledges.
    Runs the outbox poller once before returning so the resulting
    PLEDGE_CREATED notification is already visible to callers."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle.json()["id"], "occurs_on": date.today().isoformat()},
        headers=_auth(org_token),
    )
    product_id = await _resolve_product(client, org_token, "Bębenek")
    needed = await client.post(
        "/api/needed-items",
        json={"term_id": term.json()["id"], "product_id": product_id, "description": None},
        headers=_auth(org_token),
    )
    assert needed.status_code == 201

    guest_token, _ = await _register(client, "GUEST", f"{prefix}.guest@example.com")
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": needed.json()["id"]}, headers=_auth(guest_token)
    )
    assert pledge.status_code == 201
    await _process_outbox(db_session)
    return org_token, guest_token, pledge.json()["id"]


async def _my_notifications(client: AsyncClient, token: str) -> list[dict[str, object]]:
    r = await client.get("/api/notifications/mine", headers=_auth(token))
    assert r.status_code == 200
    return list(r.json())


async def _unread_count(client: AsyncClient, token: str) -> int:
    r = await client.get("/api/notifications/unread-count", headers=_auth(token))
    assert r.status_code == 200
    return int(r.json()["count"])


async def test_createPledge_notifiesOrganizer_appearsInMineUnread(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _guest_token, _pledge_id = await _setup_pledge(client, db_session, "notif.create")

    rows = await _my_notifications(client, org_token)
    assert len(rows) == 1
    assert rows[0]["kind"] == "PLEDGE_CREATED"
    assert "Bębenek" in str(rows[0]["message"])
    assert rows[0]["read_at"] is None
    assert str(rows[0]["link_path"]).startswith("/")
    assert await _unread_count(client, org_token) == 1


async def test_markRead_dropsUnreadCount_keepsRowWithTimestamp(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _guest_token, _pledge_id = await _setup_pledge(client, db_session, "notif.read")
    notification_id = (await _my_notifications(client, org_token))[0]["id"]

    read = await client.post(f"/api/notifications/{notification_id}/read", headers=_auth(org_token))
    assert read.status_code == 204

    assert await _unread_count(client, org_token) == 0
    rows = await _my_notifications(client, org_token)
    assert len(rows) == 1
    assert rows[0]["read_at"] is not None


async def test_markRead_otherPartysNotification_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, guest_token, _pledge_id = await _setup_pledge(client, db_session, "notif.forbidden")
    notification_id = (await _my_notifications(client, org_token))[0]["id"]

    forbidden = await client.post(
        f"/api/notifications/{notification_id}/read", headers=_auth(guest_token)
    )
    assert forbidden.status_code == 403


async def test_mine_neverLeaksAnotherPartysNotifications(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _org_token, guest_token, _pledge_id = await _setup_pledge(client, db_session, "notif.isolation")

    assert await _my_notifications(client, guest_token) == []


async def test_withdrawPledge_secondNotification_readAllClears(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, guest_token, pledge_id = await _setup_pledge(client, db_session, "notif.withdraw")

    withdrawn = await client.post(f"/api/pledges/{pledge_id}/withdraw", headers=_auth(guest_token))
    assert withdrawn.status_code == 200
    await _process_outbox(db_session)

    kinds = {r["kind"] for r in await _my_notifications(client, org_token)}
    assert kinds == {"PLEDGE_CREATED", "PLEDGE_WITHDRAWN"}
    assert await _unread_count(client, org_token) == 2

    read_all = await client.post("/api/notifications/read-all", headers=_auth(org_token))
    assert read_all.status_code == 204
    assert await _unread_count(client, org_token) == 0


async def _append_term_ended_giveaway(
    db_session: AsyncSession, owner_party_id: str, taker_party_id: str, reservation_id: str
) -> None:
    await outbox_service.append(
        db_session,
        event_type="groups.term_ended_giveaway",
        payload={
            "owner_party_id": owner_party_id,
            "taker_party_id": taker_party_id,
            "reservation_id": reservation_id,
            "link_path": "/x/grupa/1/term/1",
        },
    )
    await db_session.commit()


async def test_handleTermEndedGiveaway_payloadWithReservationId_setsItOnBothNotifications(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, owner_party_id = await _register(client, "GUEST", "notif.resid.owner@example.com")
    _, taker_party_id = await _register(client, "GUEST", "notif.resid.taker@example.com")
    reservation_id = str(uuid.uuid4())
    await _append_term_ended_giveaway(db_session, owner_party_id, taker_party_id, reservation_id)

    await _process_outbox(db_session)

    notifications = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.party_id.in_((owner_party_id, taker_party_id)),
                    Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED,
                )
            )
        )
        .scalars()
        .all()
    )
    assert {str(n.party_id) for n in notifications} == {owner_party_id, taker_party_id}
    assert [str(n.reservation_id) for n in notifications] == [reservation_id, reservation_id]


async def test_listMyNotifications_notificationWithReservationId_returnsReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party_id = await _register(
        client, "GUEST", "notif.resid.api.owner@example.com"
    )
    _, taker_party_id = await _register(client, "GUEST", "notif.resid.api.taker@example.com")
    reservation_id = str(uuid.uuid4())
    await _append_term_ended_giveaway(db_session, owner_party_id, taker_party_id, reservation_id)
    await _process_outbox(db_session)

    rows = await _my_notifications(client, owner_token)

    assert len(rows) == 1
    assert rows[0]["kind"] == "TERM_CONFIRMATION_NEEDED"
    assert rows[0]["reservation_id"] == reservation_id
