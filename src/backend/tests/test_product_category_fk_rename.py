"""Task Group 3: `app.product`'s `Product.category` (enum) -> `category_id`
(FK to `app.category`'s `Category` table) rename: filtering, persistence
and name-plus-category matching through `category_id`.

Products may only point at leaf categories of the seeded Vinted tree, so the
two categories used here are the first two leaves from `GET /api/categories`
(`leaf_category_ids`), fetched per test and never cached.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.product import service as product_service
from app.product.schemas import CreateProductRequest, UpdateProductRequest
from tests.conftest import leaf_category_ids


async def _authed_headers(client: AsyncClient, email: str, role: str = "GUEST") -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": role, "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture
async def leaf_ids(client: AsyncClient) -> tuple[uuid.UUID, uuid.UUID]:
    headers = await _authed_headers(client, "catfk.leaves@example.com")
    first, second = await leaf_category_ids(client, headers, 2)
    return uuid.UUID(first), uuid.UUID(second)


@pytest.fixture
def first_leaf_id(leaf_ids: tuple[uuid.UUID, uuid.UUID]) -> uuid.UUID:
    return leaf_ids[0]


@pytest.fixture
def second_leaf_id(leaf_ids: tuple[uuid.UUID, uuid.UUID]) -> uuid.UUID:
    return leaf_ids[1]


async def test_listProducts_filteredByCategoryId_returnsOnlyMatchingProducts(
    client: AsyncClient,
    first_leaf_id: uuid.UUID,
    second_leaf_id: uuid.UUID,
) -> None:
    headers = await _authed_headers(client, "catfk.list@example.com")

    toy = await client.post(
        "/api/products",
        json={
            "name": "Katalogowa Zabawka",
            "sku": "CATFK-TOY-1",
            "category_id": str(first_leaf_id),
        },
        headers=headers,
    )
    assert toy.status_code == 201
    book = await client.post(
        "/api/products",
        json={
            "name": "Katalogowa Książka",
            "sku": "CATFK-BOOK-1",
            "category_id": str(second_leaf_id),
        },
        headers=headers,
    )
    assert book.status_code == 201

    listing = await client.get(
        "/api/products", params={"category_id": str(first_leaf_id)}, headers=headers
    )

    assert listing.status_code == 200
    ids = {item["id"] for item in listing.json()}
    assert toy.json()["id"] in ids
    assert book.json()["id"] not in ids
    assert all(item["category_id"] == str(first_leaf_id) for item in listing.json())


async def test_createAndUpdateProduct_persistCategoryId_roundTripsThroughGet(
    db_session: AsyncSession,
    first_leaf_id: uuid.UUID,
    second_leaf_id: uuid.UUID,
) -> None:
    created = await product_service.create_product(
        db_session,
        CreateProductRequest(
            name="Round-trip Product",
            sku="CATFK-RT-1",
            category_id=first_leaf_id,
        ),
    )
    assert created.category_id == first_leaf_id

    fetched = await product_service.get_product(db_session, created.id)
    assert fetched.category_id == first_leaf_id

    updated = await product_service.update_product(
        db_session,
        created.id,
        UpdateProductRequest(
            name="Round-trip Product",
            sku="CATFK-RT-1",
            category_id=second_leaf_id,
        ),
    )
    assert updated.category_id == second_leaf_id

    refetched = await product_service.get_product(db_session, created.id)
    assert refetched.category_id == second_leaf_id


async def test_getOrCreateProductByName_matchesOnNameAndCategoryId_notRetiredEnum(
    db_session: AsyncSession,
    first_leaf_id: uuid.UUID,
    second_leaf_id: uuid.UUID,
) -> None:
    first = await product_service.get_or_create_product_by_name(
        db_session, "Katalogowany Bębenek", first_leaf_id
    )
    same_category_again = await product_service.get_or_create_product_by_name(
        db_session, "katalogowany bębenek", first_leaf_id
    )
    different_category = await product_service.get_or_create_product_by_name(
        db_session, "Katalogowany Bębenek", second_leaf_id
    )

    assert same_category_again.id == first.id
    assert different_category.id != first.id
    assert different_category.category_id == second_leaf_id
