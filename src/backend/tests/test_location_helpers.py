"""The shared `tests.conftest` location helpers: `create_location` returns a
live place of the caller that `POST /api/inventory-items` accepts, and
`locality_ids` returns distinct ids on every call."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import create_location, leaf_category_ids, locality_ids


async def _register(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _create_item_statuses(
    client: AsyncClient, headers: dict[str, str], location_ids: list[str]
) -> list[int]:
    inventory = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL"}, headers=headers
    )
    assert inventory.status_code == 201, inventory.text
    product = await client.post(
        "/api/products/resolve",
        json={"name": "Lampka", "category_id": (await leaf_category_ids(client, headers))[0]},
        headers=headers,
    )
    assert product.status_code == 200, product.text
    statuses = []
    for location_id in location_ids:
        response = await client.post(
            "/api/inventory-items",
            json={
                "inventory_id": inventory.json()["id"],
                "product_id": product.json()["id"],
                "condition": "GOOD",
                "location_id": location_id,
            },
            headers=headers,
        )
        statuses.append(response.status_code)
    return statuses


async def test_createLocation_withAndWithoutAddress_returnsLiveOwnedPlaceAcceptedByItemCreate(
    client: AsyncClient,
) -> None:
    headers = await _register(client, "lochelp.create@example.com")

    bare = await create_location(client, headers)
    addressed = await create_location(client, headers, address="ul. Prosta 1")

    mine = await client.get("/api/locations/mine", headers=headers)
    assert mine.status_code == 200, mine.text
    by_id = {str(row["id"]): row for row in mine.json()}
    assert set(by_id) == {bare, addressed}
    assert by_id[bare]["formatted_address"] is None
    assert by_id[addressed]["formatted_address"] == "ul. Prosta 1"
    assert all(by_id[place]["deleted_at"] is None for place in by_id)
    assert await _create_item_statuses(client, headers, [bare, addressed]) == [201, 201]


async def test_localityIds_requestedCount_returnsDistinctIds(client: AsyncClient) -> None:
    headers = await _register(client, "lochelp.localities@example.com")

    ids = await locality_ids(client, headers, 3)

    assert len(ids) == 3
    assert len(set(ids)) == 3
