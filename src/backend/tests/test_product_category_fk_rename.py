"""Task Group 3: `app.product`'s `Product.category` (enum) -> `category_id`
(FK to `app.category`'s `Category` table) rename, plus the `app.groups`
cross-bounded-context read side that joins through it. Distinct from the 6
rewritten test files (`test_product_resolution.py`, `test_circulation.py`,
`test_notifications.py`, `test_pledge_fulfillment.py`, `test_public_term.py`,
`test_groups.py`) which only swap their existing `category` literals for
`category_id` — these 6 are new, targeted at the rename's specific risk
points (spec.md Core Requirements #3 and #7).

Seeded category ids (from `0025_category_reintroduction`): 1=Zabawka,
2=Książka, 3=Gra, 4=Ubranie, 5=Inne.
"""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.product import service as product_service
from app.product.schemas import CreateProductRequest, UpdateProductRequest

_ZABAWKA_ID = 1
_KSIAZKA_ID = 2


async def _authed_headers(client: AsyncClient, email: str, role: str = "GUEST") -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": role, "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def test_listProducts_filteredByCategoryId_returnsOnlyMatchingProducts(
    client: AsyncClient,
) -> None:
    headers = await _authed_headers(client, "catfk.list@example.com")

    toy = await client.post(
        "/api/products",
        json={
            "name": "Katalogowa Zabawka",
            "sku": "CATFK-TOY-1",
            "category_id": _ZABAWKA_ID,
        },
        headers=headers,
    )
    assert toy.status_code == 201
    book = await client.post(
        "/api/products",
        json={
            "name": "Katalogowa Książka",
            "sku": "CATFK-BOOK-1",
            "category_id": _KSIAZKA_ID,
        },
        headers=headers,
    )
    assert book.status_code == 201

    listing = await client.get(
        "/api/products", params={"category_id": _ZABAWKA_ID}, headers=headers
    )

    assert listing.status_code == 200
    ids = {item["id"] for item in listing.json()}
    assert toy.json()["id"] in ids
    assert book.json()["id"] not in ids
    assert all(item["category_id"] == _ZABAWKA_ID for item in listing.json())


async def test_createAndUpdateProduct_persistCategoryId_roundTripsThroughGet(
    db_session: AsyncSession,
) -> None:
    created = await product_service.create_product(
        db_session,
        CreateProductRequest(
            name="Round-trip Product",
            sku="CATFK-RT-1",
            category_id=_ZABAWKA_ID,
        ),
    )
    assert created.category_id == _ZABAWKA_ID

    fetched = await product_service.get_product(db_session, created.id)
    assert fetched.category_id == _ZABAWKA_ID

    updated = await product_service.update_product(
        db_session,
        created.id,
        UpdateProductRequest(
            name="Round-trip Product",
            sku="CATFK-RT-1",
            category_id=_KSIAZKA_ID,
        ),
    )
    assert updated.category_id == _KSIAZKA_ID

    refetched = await product_service.get_product(db_session, created.id)
    assert refetched.category_id == _KSIAZKA_ID


async def test_getOrCreateProductByName_matchesOnNameAndCategoryId_notRetiredEnum(
    db_session: AsyncSession,
) -> None:
    first = await product_service.get_or_create_product_by_name(
        db_session, "Katalogowany Bębenek", _ZABAWKA_ID
    )
    same_category_again = await product_service.get_or_create_product_by_name(
        db_session, "katalogowany bębenek", _ZABAWKA_ID
    )
    different_category = await product_service.get_or_create_product_by_name(
        db_session, "Katalogowany Bębenek", _KSIAZKA_ID
    )

    assert same_category_again.id == first.id
    assert different_category.id != first.id
    assert different_category.category_id == _KSIAZKA_ID


async def test_getPublicCircle_unauthenticated_returnsCategoryIdAndNameForNeededItem(
    client: AsyncClient,
) -> None:
    org_headers = await _authed_headers(client, "catfk.public.org@example.com", role="ORGANIZER")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg FK"}, headers=org_headers
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle.json()["id"], "occurs_on": date.today().isoformat()},
        headers=org_headers,
    )
    assert term.status_code == 201
    product = await client.post(
        "/api/products",
        json={
            "name": "Publiczna Zabawka",
            "sku": "CATFK-PUB-1",
            "category_id": _ZABAWKA_ID,
        },
        headers=org_headers,
    )
    assert product.status_code == 201
    needed = await client.post(
        "/api/needed-items",
        json={
            "term_id": term.json()["id"],
            "product_id": product.json()["id"],
            "description": None,
        },
        headers=org_headers,
    )
    assert needed.status_code == 201

    response = await client.get(f"/api/groups/public/{circle.json()['id']}")

    assert response.status_code == 200
    item = response.json()["term"]["needed_items"][0]
    assert item["product_category_id"] == _ZABAWKA_ID
    assert item["product_category_name"] == "Zabawka"


async def test_listNeededItems_returnsCategoryIdAndNamePairFromJoin(client: AsyncClient) -> None:
    org_headers = await _authed_headers(
        client, "catfk.neededitems.org@example.com", role="ORGANIZER"
    )
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg FK 2"}, headers=org_headers
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle.json()["id"], "occurs_on": date.today().isoformat()},
        headers=org_headers,
    )
    assert term.status_code == 201
    product = await client.post(
        "/api/products",
        json={
            "name": "Instrumentalna Książka",
            "sku": "CATFK-NI-1",
            "category_id": _KSIAZKA_ID,
        },
        headers=org_headers,
    )
    assert product.status_code == 201
    needed = await client.post(
        "/api/needed-items",
        json={
            "term_id": term.json()["id"],
            "product_id": product.json()["id"],
            "description": None,
        },
        headers=org_headers,
    )
    assert needed.status_code == 201

    listing = await client.get(
        f"/api/needed-items?term_id={term.json()['id']}", headers=org_headers
    )

    assert listing.status_code == 200
    body = listing.json()[0]
    assert body["product_category_id"] == _KSIAZKA_ID
    assert body["product_category_name"] == "Książka"


async def test_createProductWithSeededZabawkaCategory_thenPublicNeededItem_returnsZabawkaName(
    client: AsyncClient,
) -> None:
    """End-to-end round trip through both bounded contexts: a product created
    against the seeded `Zabawka` category id, referenced by a needed item,
    surfaces `product_category_name == "Zabawka"` on the public,
    unauthenticated circle-view endpoint — the task's highest-risk
    integration point."""
    org_headers = await _authed_headers(
        client, "catfk.e2e.org@example.com", role="ORGANIZER"
    )
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg E2E"}, headers=org_headers
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle.json()["id"], "occurs_on": date.today().isoformat()},
        headers=org_headers,
    )
    assert term.status_code == 201
    product = await client.post(
        "/api/products",
        json={
            "name": "E2E Zabawka",
            "sku": "CATFK-E2E-1",
            "category_id": _ZABAWKA_ID,
        },
        headers=org_headers,
    )
    assert product.status_code == 201
    needed = await client.post(
        "/api/needed-items",
        json={
            "term_id": term.json()["id"],
            "product_id": product.json()["id"],
            "description": None,
        },
        headers=org_headers,
    )
    assert needed.status_code == 201

    response = await client.get(f"/api/groups/public/{circle.json()['id']}")

    assert response.status_code == 200
    item = response.json()["term"]["needed_items"][0]
    assert item["product_category_name"] == "Zabawka"
