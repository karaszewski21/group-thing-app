"""`/api/notifications` — the recipient's own in-app inbox.

Notifications are produced as a side effect of the pledge cycle (see
`app.groups.application.pledges` / `pledge_fulfillment` / `terms`), so each
test drives a real pledge to generate one, then asserts the inbox routes.
"""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve", json={"name": name, "category": "OTHER"}, headers=_auth(token)
    )
    assert r.status_code == 200
    return int(r.json()["id"])


async def _setup_pledge(client: AsyncClient, prefix: str) -> tuple[str, str, int]:
    """`(organizer_token, guest_token, pledge_id)` — organizer circle+term+need, guest pledges."""
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
    return org_token, guest_token, int(pledge.json()["id"])


async def _my_notifications(client: AsyncClient, token: str) -> list[dict[str, object]]:
    r = await client.get("/api/notifications/mine", headers=_auth(token))
    assert r.status_code == 200
    return list(r.json())


async def _unread_count(client: AsyncClient, token: str) -> int:
    r = await client.get("/api/notifications/unread-count", headers=_auth(token))
    assert r.status_code == 200
    return int(r.json()["count"])


async def test_createPledge_notifiesOrganizer_appearsInMineUnread(client: AsyncClient) -> None:
    org_token, _guest_token, _pledge_id = await _setup_pledge(client, "notif.create")

    rows = await _my_notifications(client, org_token)
    assert len(rows) == 1
    assert rows[0]["kind"] == "PLEDGE_CREATED"
    assert "Bębenek" in str(rows[0]["message"])
    assert rows[0]["read_at"] is None
    assert str(rows[0]["link_path"]).startswith("/")
    assert await _unread_count(client, org_token) == 1


async def test_markRead_dropsUnreadCount_keepsRowWithTimestamp(client: AsyncClient) -> None:
    org_token, _guest_token, _pledge_id = await _setup_pledge(client, "notif.read")
    notification_id = (await _my_notifications(client, org_token))[0]["id"]

    read = await client.post(f"/api/notifications/{notification_id}/read", headers=_auth(org_token))
    assert read.status_code == 204

    assert await _unread_count(client, org_token) == 0
    rows = await _my_notifications(client, org_token)
    assert len(rows) == 1
    assert rows[0]["read_at"] is not None


async def test_markRead_otherPartysNotification_returns403(client: AsyncClient) -> None:
    org_token, guest_token, _pledge_id = await _setup_pledge(client, "notif.forbidden")
    notification_id = (await _my_notifications(client, org_token))[0]["id"]

    forbidden = await client.post(
        f"/api/notifications/{notification_id}/read", headers=_auth(guest_token)
    )
    assert forbidden.status_code == 403


async def test_mine_neverLeaksAnotherPartysNotifications(client: AsyncClient) -> None:
    _org_token, guest_token, _pledge_id = await _setup_pledge(client, "notif.isolation")

    assert await _my_notifications(client, guest_token) == []


async def test_withdrawPledge_secondNotification_readAllClears(client: AsyncClient) -> None:
    org_token, guest_token, pledge_id = await _setup_pledge(client, "notif.withdraw")

    withdrawn = await client.post(f"/api/pledges/{pledge_id}/withdraw", headers=_auth(guest_token))
    assert withdrawn.status_code == 200

    kinds = {r["kind"] for r in await _my_notifications(client, org_token)}
    assert kinds == {"PLEDGE_CREATED", "PLEDGE_WITHDRAWN"}
    assert await _unread_count(client, org_token) == 2

    read_all = await client.post("/api/notifications/read-all", headers=_auth(org_token))
    assert read_all.status_code == 204
    assert await _unread_count(client, org_token) == 0
