"""Event reservations: `POST /api/items/{item_id}/take|propose` with an EVENT
context, an event swap's accept, and confirm/cancel gated on the event start."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from httpx import AsyncClient, Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import BalanceStatus, InventoryBalance, Reservation
from app.core import clock
from app.events.models import Event
from app.groups.infrastructure import events_acl
from tests.conftest import create_location, seed_legacy_guest
from tests.test_term_item_listings import _auth, _item_link, _register, _resolve_product

EVENT_NAME = "Piknik wymiany"
CONTEXT_KEYS = {"kind", "id", "name", "starts_at", "path", "has_started"}


async def _create_event(client: AsyncClient, token: str) -> tuple[uuid.UUID, datetime]:
    starts_at = (clock.local_now() + timedelta(days=7)).replace(second=0, microsecond=0)
    response = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": EVENT_NAME,
            "starts_at": starts_at.isoformat(),
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"]), starts_at


async def _sign_up(client: AsyncClient, event_id: uuid.UUID, token: str) -> None:
    response = await client.post(
        f"/api/events/{event_id}/attendances", json={}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text


async def _listed_items(
    client: AsyncClient, token: str, *specs: tuple[str, str]
) -> list[uuid.UUID]:
    """One PERSONAL inventory with an item per `(product name, mode)`."""
    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inventory.status_code == 201, inventory.text
    item_ids = []
    for name, mode in specs:
        item = await client.post(
            "/api/inventory-items",
            json={
                "inventory_id": inventory.json()["id"],
                "product_id": await _resolve_product(client, token, name),
                "condition": "GOOD",
                "location_id": await create_location(client, _auth(token)),
            },
            headers=_auth(token),
        )
        assert item.status_code == 201, item.text
        item_id = uuid.UUID(item.json()["id"])
        preference = await client.put(
            f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
        )
        assert preference.status_code == 200, preference.text
        item_ids.append(item_id)
    return item_ids


async def _attendees(
    client: AsyncClient, prefix: str, *names: str
) -> tuple[uuid.UUID, datetime, list[str]]:
    """An event plus one signed-up account per name."""
    author_token, _ = await _register(client, "GUEST", f"{prefix}.author@example.com")
    event_id, starts_at = await _create_event(client, author_token)
    tokens = []
    for name in names:
        token, _ = await _register(client, "GUEST", f"{prefix}.{name}@example.com")
        await _sign_up(client, event_id, token)
        tokens.append(token)
    return event_id, starts_at, tokens


async def _take(
    client: AsyncClient, event_id: uuid.UUID, item_id: uuid.UUID, token: str, mode: str = "GIFT"
) -> tuple[int, dict[str, object]]:
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": _event_ref(event_id), "reservation_type": mode},
        headers=_auth(token),
    )
    return response.status_code, response.json()


def _event_ref(event_id: uuid.UUID) -> dict[str, str]:
    return {"kind": "EVENT", "id": str(event_id)}


async def _propose(
    client: AsyncClient, event_id: uuid.UUID, item_id: uuid.UUID, offered: uuid.UUID, token: str
) -> Response:
    return await client.post(
        f"/api/items/{item_id}/propose",
        json={"context": _event_ref(event_id), "offered_item_id": str(offered)},
        headers=_auth(token),
    )


async def _notifications(client: AsyncClient, token: str, kind: str) -> list[dict[str, object]]:
    notifs = (await client.get("/api/notifications/mine", headers=_auth(token))).json()
    return [n for n in notifs if n["kind"] == kind]


async def _event_reservation(db: AsyncSession, item_id: uuid.UUID) -> Reservation:
    return (
        await db.execute(
            select(Reservation)
            .where(Reservation.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def test_takeEventItem_eligibleAttendee_returnsContextAndNotifiesWithEventWording(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    event_id, starts_at, (owner, taker) = await _attendees(client, "eir1", "owner", "taker")
    (item_id,) = await _listed_items(client, owner, ("Rowerek eir1", "GIFT"))

    status, body = await _take(client, event_id, item_id, taker)

    assert status == 200, body
    assert set(body) == {"item_id", "product_name", "context"}
    assert body["item_id"] == str(item_id)
    assert body["product_name"] == "Rowerek eir1"
    context = body["context"]
    assert isinstance(context, dict) and set(context) == CONTEXT_KEYS
    assert context["kind"] == "EVENT"
    assert context["id"] == str(event_id)
    assert context["name"] == EVENT_NAME
    assert context["starts_at"] == starts_at.isoformat()
    assert str(context["path"]).endswith(f"/event/{event_id}")
    assert context["has_started"] is False
    reservation = await _event_reservation(db_session, item_id)
    assert (reservation.event_id, reservation.term_id) == (event_id, None)

    when = clock.format_term_when(starts_at)
    taken = await _notifications(client, owner, "TERM_ITEM_LISTING_TAKEN")
    reserved = await _notifications(client, taker, "ITEM_RESERVED_FOR_PICKUP")
    assert len(taken) == 1 and len(reserved) == 1
    assert f"przynieś w {when} — {EVENT_NAME}" in str(taken[0]["message"])
    assert reserved[0]["message"] == (
        f"Zarezerwowano „Rowerek eir1” — odbierz w {when} — {EVENT_NAME}"
    )
    assert reserved[0]["link_path"] == await _item_link(client, owner, item_id)


async def test_takeEventItem_ineligibleTakerOwnerOrGuest_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    event_id, _, (owner, taker) = await _attendees(client, "eir2", "owner", "taker")
    stranger, _ = await _register(client, "GUEST", "eir2.stranger@example.com")
    (owner_item,) = await _listed_items(client, owner, ("Sanki eir2", "GIFT"))
    (stranger_item,) = await _listed_items(client, stranger, ("Narty eir2", "GIFT"))

    ineligible_taker, _ = await _take(client, event_id, owner_item, stranger)
    ineligible_owner, _ = await _take(client, event_id, stranger_item, taker)

    guest_party_id = await seed_legacy_guest(db_session, "Ania", event_id=event_id)
    event = await db_session.get(Event, event_id)
    assert event is not None

    assert (ineligible_taker, ineligible_owner) == (403, 403)
    assert await events_acl.is_event_eligible(db_session, event, guest_party_id) is False


async def test_takeEventItem_unknownEventOwnItemOrSwapViaTake_returns404And409(
    client: AsyncClient,
) -> None:
    event_id, _, (owner, taker) = await _attendees(client, "eir3", "owner", "taker")
    gift_item, swap_item = await _listed_items(
        client, owner, ("Klocki eir3", "GIFT"), ("Lalka eir3", "SWAP")
    )

    unknown, _ = await _take(client, uuid.uuid4(), gift_item, taker)
    own, _ = await _take(client, event_id, gift_item, owner)
    swap_status, swap_body = await _take(client, event_id, swap_item, taker, mode="SWAP")

    assert (unknown, own, swap_status) == (404, 409, 409)
    assert "propozycję zamiany" in str(swap_body["message"])


async def test_takeOrProposeEventItem_afterStart_returns409(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    event_id, starts_at, (owner, taker) = await _attendees(client, "eir4", "owner", "taker")
    gift_item, swap_item = await _listed_items(
        client, owner, ("Puzzle eir4", "GIFT"), ("Gra eir4", "SWAP")
    )
    (offered,) = await _listed_items(client, taker, ("Książka eir4", "SWAP"))

    freeze_local_now(starts_at)
    take_status, take_body = await _take(client, event_id, gift_item, taker)
    propose = await _propose(client, event_id, swap_item, offered, taker)

    assert take_status == 409
    assert take_body["message"] == "Wydarzenie już się rozpoczęło"
    assert propose.status_code == 409
    assert propose.json()["message"] == "Wydarzenie już się rozpoczęło"


async def test_eventSwap_proposeAcceptBeforeStart_confirmOnlyAfterStart(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    event_id, starts_at, (owner, proposer) = await _attendees(client, "eir5", "owner", "proposer")
    (listed,) = await _listed_items(client, owner, ("Monopoly eir5", "SWAP"))
    (offered,) = await _listed_items(client, proposer, ("Scrabble eir5", "SWAP"))

    propose = await _propose(client, event_id, listed, offered, proposer)
    assert propose.status_code == 200, propose.text
    proposal = propose.json()
    accept = await client.post(f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(owner))
    assert accept.status_code == 200, accept.text
    accepted = accept.json()
    assert accepted["event_id"] == str(event_id)
    assert accepted["term_id"] is None and accepted["group_id"] is None
    assert accepted["group_name"] == EVENT_NAME
    assert accepted["term_occurs_on"] == starts_at.isoformat()
    assert accepted["event_slug"]

    confirm_url = f"/api/reservations/{proposal['proposer_reservation_id']}/confirm-transaction"
    freeze_local_now(starts_at - timedelta(minutes=1))
    early = await client.post(confirm_url, headers=_auth(owner))
    freeze_local_now(starts_at)
    confirmed = await client.post(confirm_url, headers=_auth(owner))

    assert early.status_code == 409
    assert early.json()["message"] == "Wydarzenie jeszcze się nie rozpoczęło"
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "FULFILLED"


async def test_withdrawAttendance_afterEventTake_keepsReservation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    event_id, _, (owner, taker) = await _attendees(client, "eir6", "owner", "taker")
    (item_id,) = await _listed_items(client, owner, ("Hulajnoga eir6", "GIFT"))
    status, body = await _take(client, event_id, item_id, taker)
    assert status == 200, body

    withdraw = await client.post(
        f"/api/events/{event_id}/attendances/withdraw", headers=_auth(taker)
    )

    assert withdraw.status_code == 204
    reservation = await _event_reservation(db_session, item_id)
    assert reservation.status.value == "PENDING"
    assert reservation.event_id == event_id


async def test_confirmTransaction_cancelledReservationWithoutContext_returns409AlreadyResolved(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    event_id, _, (owner, taker) = await _attendees(client, "eir7", "owner", "taker")
    (item_id,) = await _listed_items(client, owner, ("Rolki eir7", "GIFT"))
    status, body = await _take(client, event_id, item_id, taker)
    assert status == 200, body
    reservation_id = (await _event_reservation(db_session, item_id)).id
    await db_session.execute(
        text("UPDATE reservations SET status = 'CANCELLED', event_id = NULL WHERE id = :id"),
        {"id": reservation_id},
    )
    await db_session.commit()
    db_session.expire_all()

    response = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=_auth(taker)
    )

    assert response.status_code == 409, response.text
    assert response.json()["already_resolved"] is True


async def test_eventSwap_ownerRejects_cancelsProposerLegAndNotifiesProposer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    event_id, _, (owner, proposer) = await _attendees(client, "eir8", "owner", "proposer")
    (listed,) = await _listed_items(client, owner, ("Gitara eir8", "SWAP"))
    (offered,) = await _listed_items(client, proposer, ("Ukulele eir8", "SWAP"))
    propose = await _propose(client, event_id, listed, offered, proposer)
    assert propose.status_code == 200, propose.text

    reject = await client.post(
        f"/api/swap-proposals/{propose.json()['id']}/reject", headers=_auth(owner)
    )

    assert reject.status_code == 200, reject.text
    assert reject.json()["status"] == "REJECTED"
    offered_leg = await _event_reservation(db_session, offered)
    assert (offered_leg.status.value, offered_leg.event_id) == ("CANCELLED", event_id)
    balance = (
        await db_session.execute(
            select(InventoryBalance.status)
            .where(InventoryBalance.item_id == offered)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert balance == BalanceStatus.AVAILABLE
    rejected = await _notifications(client, proposer, "SWAP_REJECTED")
    assert [n["link_path"] for n in rejected] == [await _item_link(client, owner, listed)]


async def test_eventGift_confirmAndCancelTransaction_onlyFromStart(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    event_id, starts_at, (owner, taker) = await _attendees(client, "eir9", "owner", "taker")
    confirmed_item, cancelled_item = await _listed_items(
        client, owner, ("Kask eir9", "GIFT"), ("Fotelik eir9", "GIFT")
    )
    for item_id in (confirmed_item, cancelled_item):
        status, body = await _take(client, event_id, item_id, taker)
        assert status == 200, body
    confirm_id = (await _event_reservation(db_session, confirmed_item)).id
    cancel_id = (await _event_reservation(db_session, cancelled_item)).id

    freeze_local_now(starts_at - timedelta(minutes=1))
    early_cancel = await client.post(
        f"/api/reservations/{cancel_id}/cancel-transaction", headers=_auth(owner)
    )
    freeze_local_now(starts_at)
    confirmed = await client.post(
        f"/api/reservations/{confirm_id}/confirm-transaction", headers=_auth(taker)
    )
    cancelled = await client.post(
        f"/api/reservations/{cancel_id}/cancel-transaction", headers=_auth(owner)
    )

    assert early_cancel.status_code == 409
    assert early_cancel.json()["message"] == "Wydarzenie jeszcze się nie rozpoczęło"
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "FULFILLED"
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "CANCELLED"
    balance = (
        await db_session.execute(
            select(InventoryBalance.status)
            .where(InventoryBalance.item_id == cancelled_item)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert balance == BalanceStatus.AVAILABLE


async def test_deleteEventBeforeStart_thenConfirmTake_returns409AlreadyResolvedDetailWithoutContext(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author, _ = await _register(client, "GUEST", "eir10.author@example.com")
    event_id, _ = await _create_event(client, author)
    owner, _ = await _register(client, "GUEST", "eir10.owner@example.com")
    taker, _ = await _register(client, "GUEST", "eir10.taker@example.com")
    for token in (owner, taker):
        await _sign_up(client, event_id, token)
    (item_id,) = await _listed_items(client, owner, ("Wózek eir10", "GIFT"))
    status, body = await _take(client, event_id, item_id, taker)
    assert status == 200, body
    reservation_id = (await _event_reservation(db_session, item_id)).id
    for token in (owner, taker):
        withdrawn = await client.post(
            f"/api/events/{event_id}/attendances/withdraw", headers=_auth(token)
        )
        assert withdrawn.status_code == 204, withdrawn.text
    deleted = await client.delete(f"/api/events/{event_id}", headers=_auth(author))
    assert deleted.status_code == 204, deleted.text

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=_auth(taker)
    )
    detail = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker))

    assert confirm.status_code == 409, confirm.text
    assert confirm.json()["already_resolved"] is True
    assert detail.status_code == 200, detail.text
    body_detail = detail.json()
    assert body_detail["status"] == "CANCELLED"
    assert (body_detail["term_id"], body_detail["event_id"]) == (None, None)
    assert body_detail["term_occurs_on"] is None
