"""Item valuation: `inventory_items.points_value` = the 20/40/60 snap of
`base[size_class] × multiplier[condition]`, with `size_class` inherited from
the nearest categorised ancestor (MEDIUM at the root). Set on create and
recomputed only when the condition or the product changes."""

from __future__ import annotations

import uuid
import warnings
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import column, select, table, text, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import SAWarning
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import compiler

from app.inventory.models import InventoryItem
from app.points.domain.valuation import snap
from app.points.infrastructure.category_acl import resolve_size_class, size_class_statement
from tests.conftest import create_location, leaf_category_ids

_categories = table("categories", column("id"), column("size_class"))


async def _register(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _product_id(
    client: AsyncClient, headers: dict[str, str], name: str, category_id: str
) -> str:
    response = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": category_id},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


async def _ancestor_ids(db: AsyncSession, category_id: str) -> list[uuid.UUID]:
    """`category_id` first, then each parent up to the root."""
    chain: list[uuid.UUID] = []
    current: uuid.UUID | None = uuid.UUID(category_id)
    while current is not None:
        chain.append(current)
        current = (
            await db.execute(
                text("SELECT parent_id FROM categories WHERE id = :id"), {"id": current}
            )
        ).scalar_one()
    return chain


async def _set_size_class(
    db: AsyncSession, category_id: uuid.UUID | str, value: str | None
) -> None:
    await db.execute(
        update(_categories)
        .where(_categories.c.id == uuid.UUID(str(category_id)))
        .values(size_class=value)
    )


async def _create_item(
    client: AsyncClient, headers: dict[str, str], product_id: str, condition: str
) -> str:
    inventory = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL"}, headers=headers
    )
    assert inventory.status_code == 201, inventory.text
    response = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory.json()["id"],
            "product_id": product_id,
            "condition": condition,
            "location_id": await create_location(client, headers),
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _stored_value(db: AsyncSession, item_id: str) -> int | None:
    return (
        await db.execute(
            select(InventoryItem.points_value).where(InventoryItem.id == uuid.UUID(item_id))
        )
    ).scalar_one()


async def _patch(
    client: AsyncClient, headers: dict[str, str], item_id: str, body: dict[str, object]
) -> None:
    response = await client.patch(f"/api/inventory-items/{item_id}", json=body, headers=headers)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (Decimal("45"), 40),
        (Decimal("60"), 60),
        (Decimal("25"), 20),
        (Decimal("29.99"), 20),
        (Decimal("30"), 40),
        (Decimal("49.99"), 40),
        (Decimal("50"), 60),
    ],
)
def test_snap_rawValue_snapsTo204060(raw: Decimal, expected: int) -> None:
    assert snap(raw) == expected


@pytest.mark.parametrize("case", ["own", "nearestAncestor", "noneUpToRoot"])
async def test_resolveSizeClass_categoryChain_returnsNearestOrMedium(
    client: AsyncClient, db_session: AsyncSession, case: str
) -> None:
    headers = await _register(client, f"pval.resolve.{case.lower()}@example.com")
    leaves = await leaf_category_ids(client, headers, 50)
    chains = [await _ancestor_ids(db_session, leaf) for leaf in leaves]
    chain = next(chain for chain in chains if len(chain) >= 3)
    product_id = await _product_id(client, headers, f"Wycena {case}", str(chain[0]))
    for category_id in chain:
        await _set_size_class(db_session, category_id, None)
    if case == "own":
        await _set_size_class(db_session, chain[0], "LARGE")
        await _set_size_class(db_session, chain[1], "SMALL")
    elif case == "nearestAncestor":
        await _set_size_class(db_session, chain[1], "LARGE")
        await _set_size_class(db_session, chain[-1], "SMALL")

    resolved = await resolve_size_class(db_session, uuid.UUID(product_id))

    assert resolved == {"own": "LARGE", "nearestAncestor": "LARGE", "noneUpToRoot": "MEDIUM"}[case]


def test_sizeClassStatement_compiledWithLinting_raisesNoCartesianWarning() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error", SAWarning)
        size_class_statement(uuid.uuid4()).compile(
            dialect=postgresql.dialect(),
            linting=compiler.COLLECT_CARTESIAN_PRODUCTS | compiler.WARN_LINTING,
        )


async def test_createItem_largeAndPoor_storesSnappedValue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.create@example.com")
    category_id = (await leaf_category_ids(client, headers))[0]
    await _set_size_class(db_session, category_id, "LARGE")
    product_id = await _product_id(client, headers, "Wycena regał", category_id)

    item_id = await _create_item(client, headers, product_id, "POOR")

    # 60 × 0.50 = 30 → 40
    assert await _stored_value(db_session, item_id) == 40


async def test_patchItem_conditionOrProductChange_recomputesOtherwiseUnchanged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.patch@example.com")
    small_category, large_category = await leaf_category_ids(client, headers, 2)
    await _set_size_class(db_session, small_category, "SMALL")
    await _set_size_class(db_session, large_category, "LARGE")
    small_product = await _product_id(client, headers, "Wycena kubek", small_category)
    large_product = await _product_id(client, headers, "Wycena szafa", large_category)
    item_id = await _create_item(client, headers, small_product, "GOOD")
    assert await _stored_value(db_session, item_id) == 20
    await db_session.execute(
        update(InventoryItem).where(InventoryItem.id == uuid.UUID(item_id)).values(points_value=999)
    )

    await _patch(client, headers, item_id, {"location_id": await create_location(client, headers)})
    await _patch(client, headers, item_id, {"condition": "GOOD", "product_id": small_product})
    unchanged = await _stored_value(db_session, item_id)
    await _patch(client, headers, item_id, {"condition": "NEW"})
    after_condition = await _stored_value(db_session, item_id)
    await _patch(client, headers, item_id, {"product_id": large_product})
    after_product = await _stored_value(db_session, item_id)

    assert unchanged == 999
    assert after_condition == 40  # 20 × 1.50 = 30 → 40
    assert after_product == 60  # 60 × 1.50 = 90 → 60


async def test_categorySizeClassChange_afterCreate_keepsStoredValue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.sizechange@example.com")
    category_id = (await leaf_category_ids(client, headers))[0]
    await _set_size_class(db_session, category_id, "SMALL")
    product_id = await _product_id(client, headers, "Wycena lampka", category_id)
    item_id = await _create_item(client, headers, product_id, "GOOD")

    await _set_size_class(db_session, category_id, "LARGE")
    await _patch(client, headers, item_id, {"location_id": await create_location(client, headers)})

    assert await _stored_value(db_session, item_id) == 20


def _keys(payload: object) -> set[str]:
    """Every object key anywhere in a JSON payload."""
    if isinstance(payload, dict):
        return set(payload) | {key for value in payload.values() for key in _keys(value)}
    if isinstance(payload, list):
        return {key for value in payload for key in _keys(value)}
    return set()


async def test_itemResponses_valuedListedItem_carryNoPointsField(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.r8@example.com")
    category_id = (await leaf_category_ids(client, headers))[0]
    product_id = await _product_id(client, headers, "Wycena hulajnoga", category_id)
    item_id = await _create_item(client, headers, product_id, "GOOD")
    listed = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=headers
    )
    assert listed.status_code == 200, listed.text
    assert await _stored_value(db_session, item_id) is not None

    responses = [
        await client.get(f"/api/inventory-items/{item_id}", headers=headers),
        await client.get(f"/api/public/items/{item_id}/details", headers=headers),
        await client.get(f"/api/public/items/{item_id}/details"),
        await client.get(f"/api/public/items/{item_id}/actions", headers=headers),
        await client.get(f"/api/public/items/{item_id}/actions"),
        await client.get("/api/public/search", params={"q": "hulajnoga"}),
    ]

    for response in responses:
        assert response.status_code == 200, (response.url, response.text)
        assert not {key for key in _keys(response.json()) if "point" in key}, response.url
    search_ids = {result.get("id") for result in responses[-1].json()["items"]}
    assert item_id in search_ids
