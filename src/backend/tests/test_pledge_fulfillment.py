"""`POST /api/pledges/{id}/fulfill` — the Pledge -> Reservation bridge, in
its two modes (new `InventoryItem` vs one the pledger already owns) — plus
`POST /api/pledges/{id}/sync`.

Setup chain per test: an ORGANIZER with a circle (active Leadership) + term
+ a `NeededItem` naming a product; a GUEST who pledges it.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import BalanceStatus, InventoryBalance


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


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
    product_id = await _resolve_product(client, token, product_name)
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inv.json()["id"], "product_id": product_id, "condition": "GOOD"},
        headers=_auth(token),
    )
    assert item.status_code == 201
    return int(item.json()["id"])


async def _setup_pledge(
    client: AsyncClient, prefix: str, product_name: str = "Skrzypce"
) -> tuple[str, int, int, int]:
    """Returns `(guest_token, guest_party_id, needed_item_product_id, pledge_id)`."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle.json()["id"], "occurs_on": date.today().isoformat()},
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    product_id = await _resolve_product(client, org_token, product_name)
    needed = await client.post(
        "/api/needed-items",
        json={"term_id": term.json()["id"], "product_id": product_id, "description": None},
        headers=_auth(org_token),
    )
    assert needed.status_code == 201

    guest_token, guest_party_id = await _register(client, "GUEST", f"{prefix}.guest@example.com")
    pledge = await client.post(
        "/api/pledges",
        json={"needed_item_id": needed.json()["id"]},
        headers=_auth(guest_token),
    )
    assert pledge.status_code == 201
    return guest_token, guest_party_id, product_id, int(pledge.json()["id"])


async def _item_of_reservation(
    client: AsyncClient, token: str, reservation_id: int
) -> dict[str, Any]:
    res = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(token))
    assert res.status_code == 200
    item = await client.get(f"/api/inventory-items/{res.json()['item_id']}", headers=_auth(token))
    assert item.status_code == 200
    return {"reservation": res.json(), "item": item.json()}


async def test_fulfillPledge_newItemMode_registersItemWithNeedProduct(client: AsyncClient) -> None:
    guest_token, _party, need_product_id, pledge_id = await _setup_pledge(client, "fnew")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(guest_token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["resolved_reservation_id"] is not None
    assert body["status"] == "CLAIMED"  # only /sync flips it to FULFILLED

    detail = await _item_of_reservation(client, guest_token, body["resolved_reservation_id"])
    assert detail["reservation"]["reservation_type"] == "LEND"
    assert detail["reservation"]["status"] == "PENDING"
    assert detail["item"]["product_id"] == need_product_id
    assert detail["item"]["condition"] == "GOOD"


async def test_fulfillPledge_notifiesOrganizerItemRegistered(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fnotif")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(guest_token),
    )
    assert response.status_code == 200

    login = await client.post(
        "/api/auth/login", json={"email": "fnotif.org@example.com", "password": "secret123"}
    )
    org_token = login.json()["token"]
    notifs = (await client.get("/api/notifications/mine", headers=_auth(org_token))).json()
    assert any(n["kind"] == "PLEDGE_ITEM_REGISTERED" for n in notifs)


async def test_fulfillPledge_newItemMode_productIdOverride(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fover")
    override_id = await _resolve_product(client, guest_token, "Wiolonczela")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"condition": "FAIR", "product_id": override_id},
        headers=_auth(guest_token),
    )

    assert response.status_code == 200
    detail = await _item_of_reservation(
        client, guest_token, response.json()["resolved_reservation_id"]
    )
    assert detail["item"]["product_id"] == override_id


async def test_fulfillPledge_ownedItemMode_reusesExistingItem(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fowned")
    owned_item_id = await _register_personal_item(client, guest_token, "Moja skrzypka")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"inventory_item_id": owned_item_id},
        headers=_auth(guest_token),
    )

    assert response.status_code == 200
    detail = await _item_of_reservation(
        client, guest_token, response.json()["resolved_reservation_id"]
    )
    assert detail["reservation"]["item_id"] == owned_item_id
    assert detail["reservation"]["reservation_type"] == "LEND"


async def test_fulfillPledge_ownedItemMode_notAvailable_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fbusy")
    owned_item_id = await _register_personal_item(client, guest_token, "Zajęta skrzypka")

    balance = (
        await db_session.execute(
            select(InventoryBalance).where(InventoryBalance.item_id == owned_item_id)
        )
    ).scalar_one()
    balance.status = BalanceStatus.LENT
    await db_session.commit()

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"inventory_item_id": owned_item_id},
        headers=_auth(guest_token),
    )
    assert response.status_code == 409


async def test_fulfillPledge_ownedItemMode_notOwner_returns403(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fnotowner")
    other_token, _ = await _register(client, "GUEST", "fnotowner.other@example.com")
    other_item_id = await _register_personal_item(client, other_token, "Cudza skrzypka")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"inventory_item_id": other_item_id},
        headers=_auth(guest_token),
    )
    assert response.status_code == 403


async def test_fulfillPledge_ownedItemMode_unknownItem_returns404(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "f404")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"inventory_item_id": 999999},
        headers=_auth(guest_token),
    )
    assert response.status_code == 404


async def test_fulfillPledge_noMode_returns400(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fnomode")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill", json={}, headers=_auth(guest_token)
    )
    assert response.status_code == 400


async def test_fulfillPledge_bothModes_returns400(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fboth")
    owned_item_id = await _register_personal_item(client, guest_token, "Skrzypka konfliktowa")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"condition": "GOOD", "inventory_item_id": owned_item_id},
        headers=_auth(guest_token),
    )
    assert response.status_code == 400


async def test_fulfillPledge_nonPledger_returns403(client: AsyncClient) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fnonpledger")
    intruder_token, _ = await _register(client, "GUEST", "fnonpledger.intruder@example.com")

    response = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(intruder_token),
    )
    assert response.status_code == 403


async def test_syncPledge_afterReservationFulfilled_marksPledgeFulfilled(
    client: AsyncClient,
) -> None:
    guest_token, _party, _need_product_id, pledge_id = await _setup_pledge(client, "fsync")

    fulfilled = await client.post(
        f"/api/pledges/{pledge_id}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(guest_token),
    )
    reservation_id = fulfilled.json()["resolved_reservation_id"]

    assert (
        await client.post(f"/api/reservations/{reservation_id}/confirm", headers=_auth(guest_token))
    ).status_code == 200
    assert (
        await client.post(f"/api/reservations/{reservation_id}/fulfill", headers=_auth(guest_token))
    ).status_code == 200

    synced = await client.post(f"/api/pledges/{pledge_id}/sync", headers=_auth(guest_token))
    assert synced.status_code == 200
    assert synced.json()["status"] == "FULFILLED"
