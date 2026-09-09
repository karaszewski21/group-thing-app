"""`PATCH`/`DELETE /api/inventory-items/{id}` tests — the circulation-context
edit/soft-delete surface (implementation/spec.md R4, API contract §4).

Ownership is `inventory.owner_user_id == acting user` (raw `users.id`, never
`party_id` — see `standards/backend/security.md`). PATCH `condition` is
allowed regardless of `InventoryBalance` status; DELETE is blocked with 409
unless the balance is `AVAILABLE`.
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import BalanceStatus, InventoryBalance


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _create_item(client: AsyncClient, headers: dict[str, str]) -> tuple[int, int]:
    """Resolves a product, creates a PERSONAL inventory, registers one item.
    Returns `(inventory_id, item_id)`."""
    resolved = await client.post(
        "/api/products/resolve",
        json={"name": "Klocki Duplo", "category": "TOY"},
        headers=headers,
    )
    assert resolved.status_code == 200
    product_id = resolved.json()["id"]

    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=headers,
    )
    assert inventory.status_code == 201
    inventory_id = inventory.json()["id"]

    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inventory_id, "product_id": product_id, "condition": "GOOD"},
        headers=headers,
    )
    assert item.status_code == 201
    return inventory_id, item.json()["id"]


async def _set_balance_status(
    db_session: AsyncSession, item_id: int, status: BalanceStatus
) -> None:
    balance = (
        await db_session.execute(
            select(InventoryBalance).where(InventoryBalance.item_id == item_id)
        )
    ).scalar_one()
    balance.status = status
    await db_session.commit()


async def test_patchInventoryItem_owner_updatesCondition(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-patch-owner@example.com")
    _, item_id = await _create_item(client, headers)

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "FAIR"}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["condition"] == "FAIR"


async def test_patchInventoryItem_ownerWithReservedBalance_stillUpdatesCondition(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "circ-patch-reserved@example.com")
    _, item_id = await _create_item(client, headers)
    await _set_balance_status(db_session, item_id, BalanceStatus.RESERVED)

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["condition"] == "POOR"


async def test_patchInventoryItem_nonOwner_returns403(client: AsyncClient) -> None:
    owner_headers = await _authed_headers(client, "circ-patch-real-owner@example.com")
    _, item_id = await _create_item(client, owner_headers)
    other_headers = await _authed_headers(client, "circ-patch-intruder@example.com")

    response = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "FAIR"}, headers=other_headers
    )

    assert response.status_code == 403


async def test_deleteInventoryItem_availableItem_returns204AndExcludedFromList(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "circ-delete-ok@example.com")
    inventory_id, item_id = await _create_item(client, headers)

    response = await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    assert response.status_code == 204

    listing = await client.get(
        "/api/inventory-items", params={"inventory_id": inventory_id}, headers=headers
    )
    assert listing.status_code == 200
    assert all(entry["id"] != item_id for entry in listing.json())

    fetched = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert fetched.status_code == 404


async def test_deleteInventoryItem_nonAvailableBalance_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "circ-delete-conflict@example.com")
    _, item_id = await _create_item(client, headers)
    await _set_balance_status(db_session, item_id, BalanceStatus.LENT)

    response = await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    assert response.status_code == 409

    fetched = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert fetched.status_code == 200


async def test_getInventoryItem_softDeleted_returns404(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "circ-get-softdeleted@example.com")
    _, item_id = await _create_item(client, headers)

    assert (
        await client.delete(f"/api/inventory-items/{item_id}", headers=headers)
    ).status_code == 204

    response = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    assert response.status_code == 404
