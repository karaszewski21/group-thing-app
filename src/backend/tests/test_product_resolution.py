"""`POST /api/products/resolve` tests — freeform item name -> `Product`
resolve-or-create (implementation/spec.md Core Requirement 10;
implementation-plan.md's "Backend Design Decisions Resolved By This Plan"
item 2). Also confirms the existing `POST /api/inventory-items`
`{inventory_id, product_id, condition}` contract is unchanged when chained
after a resolve call."""

from __future__ import annotations

from httpx import AsyncClient


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    """Registers a fresh user (grants `READ`+`EDIT`, per
    `app/users/service.py`) and returns a `Bearer` auth header."""
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def test_resolveProduct_noExistingMatch_createsNewProductWithPlaceholderPriceAndSku(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "resolve1@example.com")

    response = await client.post(
        "/api/products/resolve",
        json={"name": "Lego Duplo", "category": "TOY"},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Lego Duplo"
    assert body["category"] == "TOY"
    assert body["price"] == "0.01"
    assert body["sku"].startswith("LEGO DUPLO"[:10])


async def test_resolveProduct_caseInsensitiveNameMatchSameCategory_returnsExisting(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "resolve2@example.com")

    first = await client.post(
        "/api/products/resolve",
        json={"name": "Rowerek Biegowy", "category": "TOY"},
        headers=headers,
    )
    assert first.status_code == 200
    first_id = first.json()["id"]

    second = await client.post(
        "/api/products/resolve",
        json={"name": "ROWEREK biegowy", "category": "TOY"},
        headers=headers,
    )

    assert second.status_code == 200
    assert second.json()["id"] == first_id


async def test_resolveProduct_sameNameDifferentCategory_createsNew(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "resolve3@example.com")

    first = await client.post(
        "/api/products/resolve",
        json={"name": "Zestaw", "category": "TOY"},
        headers=headers,
    )
    second = await client.post(
        "/api/products/resolve",
        json={"name": "Zestaw", "category": "BOOK"},
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] != second.json()["id"]


async def test_resolveProduct_thenRegisterInventoryItem_producesRealInventoryItem(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "resolve4@example.com")

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
    body = item.json()
    assert body["inventory_id"] == inventory_id
    assert body["product_id"] == product_id
    assert body["condition"] == "GOOD"
