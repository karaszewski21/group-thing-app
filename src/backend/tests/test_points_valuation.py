"""Item valuation: `inventory_items.points_value` = the 20/40/60 snap of
`base[size_class] × multiplier[condition]`, with `size_class` inherited from
the nearest categorised ancestor (MEDIUM at the root). Set on create and
recomputed only when the condition or the product changes."""

from __future__ import annotations

import uuid
import warnings
from decimal import Decimal

import jwt
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import column, select, table, text, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import SAWarning
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import compiler

from app.inventory.models import InventoryItem
from app.points.domain.valuation import snap
from app.points.infrastructure.category_acl import resolve_size_class, size_class_statement
from app.points.models import PointsConfig
from tests.conftest import create_location, leaf_category_ids
from tests.test_authorization_matrix import _oauth_token
from tests.test_points_awards import _person
from tests.test_points_purchase_flow import _grant, _pair, _points_item, _take

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


# The R8 exceptions: a POINTS offer's price, and the HOLD amount of a POINTS
# reservation, which reaches only its two parties (`party_reservation`,
# `/api/reservations/mine`).
_R8_ALLOWED = {"points_price", "held_points"}


def _values(payload: object, key: str) -> list[object]:
    """Every value of `key` anywhere in a JSON payload."""
    if isinstance(payload, dict):
        own = [payload[key]] if key in payload else []
        return own + [found for value in payload.values() for found in _values(value, key)]
    if isinstance(payload, list):
        return [found for value in payload for found in _values(value, key)]
    return []


async def _item_reads(
    client: AsyncClient, item_id: object, headers: dict[str, str], query: str
) -> list[Response]:
    responses = [
        await client.get(f"/api/public/items/{item_id}/details", headers=headers),
        await client.get(f"/api/public/items/{item_id}/details"),
        await client.get(f"/api/public/items/{item_id}/actions", headers=headers),
        await client.get(f"/api/public/items/{item_id}/actions"),
        await client.get("/api/public/search", params={"q": query}),
    ]
    for response in responses:
        assert response.status_code == 200, (response.url, response.text)
        assert not {
            key for key in _keys(response.json()) if "point" in key and key not in _R8_ALLOWED
        }, response.url
    assert str(item_id) in {result.get("id") for result in responses[-1].json()["items"]}
    return responses


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
    seller, buyer = await _pair(client, "pval.r8")
    third = await _person(client, "pval.r8.third@example.com")
    points_item, price = await _points_item(client, db_session, seller, "Wycena rolki")
    reserved_item, reserved_price = await _points_item(client, db_session, seller, "Wycena wrotki")
    await _grant(db_session, buyer.party_id, 200)
    taken = await _take(client, buyer.headers, reserved_item, reserved_price)
    assert taken.status_code == 200, taken.text

    own = await client.get(f"/api/inventory-items/{item_id}", headers=headers)
    gift = await _item_reads(client, item_id, headers, "hulajnoga")
    points = await _item_reads(client, points_item, third.headers, "rolki")
    reserved = await _item_reads(client, reserved_item, third.headers, "wrotki")

    assert own.status_code == 200, own.text
    assert not {key for key in _keys(own.json()) if "point" in key}
    assert all(
        value is None for response in gift for value in _values(response.json(), "points_price")
    )
    assert points[2].json()["points_price"] == price
    (points_card,) = [r for r in points[4].json()["items"] if r["id"] == str(points_item)]
    assert points_card["meta"]["points_price"] == price
    third_actions = reserved[2].json()
    assert third_actions["points_price"] == reserved_price
    assert third_actions["party_reservation"] is None
    assert not [
        key for response in reserved for key in _keys(response.json()) if key == "held_points"
    ]


async def test_itemValuePreview_categoryAndCondition_returnsValueWithoutSaving(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.preview@example.com")
    leaves = await leaf_category_ids(client, headers, 50)
    chain = next(
        c for c in [await _ancestor_ids(db_session, leaf) for leaf in leaves] if len(c) >= 2
    )
    for category_id in chain:
        await _set_size_class(db_session, category_id, None)
    await _set_size_class(db_session, chain[1], "LARGE")

    inherited = await client.get(
        "/api/points/item-value",
        params={"category_id": str(chain[0]), "condition": "POOR"},
        headers=headers,
    )
    await _set_size_class(db_session, chain[1], None)
    root_default = await client.get(
        "/api/points/item-value",
        params={"category_id": str(chain[0]), "condition": "NEW"},
        headers=headers,
    )

    assert inherited.status_code == 200, inherited.text
    # 60 × 0.50 = 30 → 40
    assert inherited.json() == {
        "points_value": 40,
        "price_min": 20,
        "price_max": 60,
        "price_step": 10,
    }
    # 40 × 1.50 = 60
    assert root_default.json() == {
        "points_value": 60,
        "price_min": 30,
        "price_max": 90,
        "price_step": 10,
    }


async def test_itemValuePreview_badInput_rejected(client: AsyncClient) -> None:
    headers = await _register(client, "pval.preview.bad@example.com")
    category_id = (await leaf_category_ids(client, headers))[0]

    unknown = await client.get(
        "/api/points/item-value",
        params={"category_id": str(uuid.uuid4()), "condition": "GOOD"},
        headers=headers,
    )
    bad_condition = await client.get(
        "/api/points/item-value",
        params={"category_id": category_id, "condition": "BROKEN"},
        headers=headers,
    )
    anonymous = await client.get(
        "/api/points/item-value", params={"category_id": category_id, "condition": "GOOD"}
    )

    assert unknown.status_code == 404
    assert bad_condition.status_code == 400
    assert anonymous.status_code == 401


async def test_myItemsPage_ownerRow_carriesStoredPointsValue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.mine@example.com")
    category_id = (await leaf_category_ids(client, headers))[0]
    await _set_size_class(db_session, category_id, "LARGE")
    product_id = await _product_id(client, headers, "Wycena komoda", category_id)
    item_id = await _create_item(client, headers, product_id, "GOOD")

    page = await client.get("/api/inventory-items/mine/page", headers=headers)

    assert page.status_code == 200, page.text
    rows = {row["id"]: row for row in page.json()["items"]}
    assert rows[item_id]["points_value"] == 60  # 60 × 1.00


ITEM_VALUE_KEYS = {"points_value", "price_min", "price_max", "price_step"}


async def _item_value(
    client: AsyncClient, headers: dict[str, str], params: dict[str, str]
) -> tuple[int, dict[str, object]]:
    response = await client.get("/api/points/item-value", params=params, headers=headers)
    return response.status_code, dict(response.json())


async def _large_item(
    client: AsyncClient, db_session: AsyncSession, headers: dict[str, str], name: str
) -> tuple[str, str]:
    """A GOOD item in a LARGE leaf (stored value 60); returns item and category ids."""
    category_id = (await leaf_category_ids(client, headers))[0]
    await _set_size_class(db_session, category_id, "LARGE")
    product_id = await _product_id(client, headers, name, category_id)
    return await _create_item(client, headers, product_id, "GOOD"), category_id


async def test_getItemValue_ownItemId_returnsStoredValueAndBounds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.itemid.own@example.com")
    item_id, category_id = await _large_item(client, db_session, headers, "Wycena biurko")

    before = await _item_value(client, headers, {"item_id": item_id})
    await db_session.execute(update(PointsConfig).values(base_large=20))
    preview = await _item_value(client, headers, {"category_id": category_id, "condition": "GOOD"})
    after = await _item_value(client, headers, {"item_id": item_id})

    stored = {"points_value": 60, "price_min": 30, "price_max": 90, "price_step": 10}
    assert before == (200, stored)
    assert set(before[1]) == ITEM_VALUE_KEYS
    assert preview == (
        200,
        {"points_value": 20, "price_min": 10, "price_max": 30, "price_step": 10},
    )
    assert after == (200, stored)


async def test_getItemValue_unvaluedItem_returnsAllNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "pval.itemid.null@example.com")
    item_id, _category = await _large_item(client, db_session, headers, "Wycena taboret")
    await db_session.execute(
        update(InventoryItem)
        .where(InventoryItem.id == uuid.UUID(item_id))
        .values(points_value=None)
    )

    assert await _item_value(client, headers, {"item_id": item_id}) == (
        200,
        {"points_value": None, "price_min": None, "price_max": None, "price_step": None},
    )


async def test_getItemValue_otherOwnersItem_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _register(client, "pval.itemid.owner@example.com")
    other = await _register(client, "pval.itemid.other@example.com")
    item_id, _category = await _large_item(client, db_session, owner, "Wycena półka")

    status, _body = await _item_value(client, other, {"item_id": item_id})

    assert status == 403


async def test_getItemValue_unknownOrDeletedItem_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _register(client, "pval.itemid.deleted@example.com")
    other = await _register(client, "pval.itemid.deleted.other@example.com")
    item_id, _category = await _large_item(client, db_session, owner, "Wycena krzesło")
    deleted = await client.delete(f"/api/inventory-items/{item_id}", headers=owner)
    assert deleted.status_code == 204, deleted.text

    unknown = await _item_value(client, owner, {"item_id": str(uuid.uuid4())})
    gone_for_owner = await _item_value(client, owner, {"item_id": item_id})
    gone_for_other = await _item_value(client, other, {"item_id": item_id})

    assert (unknown[0], gone_for_owner[0], gone_for_other[0]) == (404, 404, 404)


@pytest.mark.parametrize("form", ["both", "neither", "categoryOnly", "conditionOnly"])
async def test_getItemValue_bothOrNeitherForm_returns400(
    client: AsyncClient, db_session: AsyncSession, form: str
) -> None:
    headers = await _register(client, f"pval.itemid.form.{form.lower()}@example.com")
    item_id, category_id = await _large_item(client, db_session, headers, f"Wycena {form}")
    params = {
        "both": {"item_id": item_id, "category_id": category_id, "condition": "GOOD"},
        "neither": {},
        "categoryOnly": {"category_id": category_id},
        "conditionOnly": {"condition": "GOOD"},
    }[form]

    status, body = await _item_value(client, headers, params)

    assert status == 400
    assert body["message"] == "Podaj item_id albo category_id i condition."


async def test_getItemValue_mcpReadToken_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    registered = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "pval.itemid.mcp@example.com", "password": "secret123"},
    )
    assert registered.status_code == 201, registered.text
    token = registered.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    item_id, _category = await _large_item(client, db_session, headers, "Wycena stolik")
    username = jwt.decode(token, options={"verify_signature": False})["sub"]
    mcp = {"Authorization": f"Bearer {_oauth_token(username, ['mcp:read'])}"}

    status, _body = await _item_value(client, mcp, {"item_id": item_id})

    assert status == 403
