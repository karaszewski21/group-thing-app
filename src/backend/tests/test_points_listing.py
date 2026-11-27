"""Listing an item for POINTS (R3): the owner-photo rule, the per-owner
offer cap, the price bounds around the STORED `points_value`, the clamped
suggestion for an omitted price, the re-valuation clamp on a condition
PATCH, the GIFT switch dropping the price and the M4 re-check of the
"becomes POINTS" decision under the item lock."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import column, select, table, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.infrastructure import inventory_bridge
from app.groups.models import ItemListingPreference
from app.inventory.models import InventoryItem
from app.moderation.status import ModerationStatus
from app.points.models import PointsConfig
from app.product.models import ProductPhoto
from tests.conftest import create_location, leaf_category_ids

_categories = table("categories", column("id"), column("size_class"))

PHOTO_MESSAGE = "Dodaj przynajmniej jedno zdjęcie, aby wystawić za punkty."
RANGE_MESSAGE = "Cena musi być od 20 do 60 pkt, co 10."
CHANGED_MESSAGE = "Oferta zmieniła się w międzyczasie — odśwież."


class _Owner:
    def __init__(self, headers: dict[str, str], user_id: uuid.UUID, inventory_id: str) -> None:
        self.headers = headers
        self.user_id = user_id
        self.inventory_id = inventory_id


async def _owner(client: AsyncClient, email: str) -> _Owner:
    registered = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert registered.status_code == 201, registered.text
    headers = {"Authorization": f"Bearer {registered.json()['token']}"}
    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200, me.text
    inventory = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL"}, headers=headers
    )
    assert inventory.status_code == 201, inventory.text
    return _Owner(headers, uuid.UUID(me.json()["account_user_id"]), inventory.json()["id"])


async def _product(client: AsyncClient, db: AsyncSession, owner: _Owner, name: str) -> uuid.UUID:
    """A product in a MEDIUM leaf, so a GOOD item is valued 40 (bounds 20–60)."""
    category_id = (await leaf_category_ids(client, owner.headers))[0]
    await db.execute(
        update(_categories)
        .where(_categories.c.id == uuid.UUID(category_id))
        .values(size_class="MEDIUM")
    )
    response = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": category_id},
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text
    return uuid.UUID(response.json()["id"])


async def _item(
    client: AsyncClient, owner: _Owner, product_id: uuid.UUID, condition: str = "GOOD"
) -> str:
    response = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": owner.inventory_id,
            "product_id": str(product_id),
            "condition": condition,
            "location_id": await create_location(client, owner.headers),
        },
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _photo(
    db: AsyncSession, product_id: uuid.UUID, user_id: uuid.UUID, status: ModerationStatus
) -> None:
    key = uuid.uuid4().hex
    db.add(
        ProductPhoto(
            product_id=product_id,
            storage_key=f"products/{product_id}/{key}",
            width=10,
            height=10,
            size_bytes=100,
            content_sha256=key + key,
            status=status,
            uploaded_by_user_id=user_id,
            sort_order=0,
        )
    )
    await db.flush()


async def _photographed_item(
    client: AsyncClient, db: AsyncSession, owner: _Owner, name: str
) -> str:
    product_id = await _product(client, db, owner, name)
    await _photo(db, product_id, owner.user_id, ModerationStatus.APPROVED)
    return await _item(client, owner, product_id)


async def _put(
    client: AsyncClient, owner: _Owner, item_id: str, body: dict[str, object]
) -> Response:
    return await client.put(
        f"/api/item-listing-preferences/{item_id}", json=body, headers=owner.headers
    )


async def _preference(db: AsyncSession, item_id: str) -> tuple[str, int | None] | None:
    row = (
        await db.execute(
            select(ItemListingPreference.mode, ItemListingPreference.points_price)
            .where(ItemListingPreference.item_id == uuid.UUID(item_id))
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    return None if row is None else (row[0], row[1])


@pytest.mark.parametrize("photo_by", ["nobody", "someone_else"])
async def test_putPreference_pointsWithoutOwnPhoto_returns400(
    client: AsyncClient, db_session: AsyncSession, photo_by: str
) -> None:
    owner = await _owner(client, f"plist.nophoto.{photo_by}@example.com")
    product_id = await _product(client, db_session, owner, f"Punkty lampa {photo_by}")
    if photo_by == "someone_else":
        other = await _owner(client, f"plist.nophoto.other.{photo_by}@example.com")
        await _photo(db_session, product_id, other.user_id, ModerationStatus.APPROVED)
    await _photo(db_session, product_id, owner.user_id, ModerationStatus.REJECTED)
    item_id = await _item(client, owner, product_id)

    response = await _put(client, owner, item_id, {"mode": "POINTS"})

    assert response.status_code == 400, response.text
    assert response.json()["message"] == PHOTO_MESSAGE
    assert await _preference(db_session, item_id) is None


async def test_putPreference_pendingOwnPhoto_returns200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.pending@example.com")
    product_id = await _product(client, db_session, owner, "Punkty czajnik")
    await _photo(db_session, product_id, owner.user_id, ModerationStatus.PENDING)
    item_id = await _item(client, owner, product_id)

    response = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 50})

    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "POINTS"
    assert response.json()["points_price"] == 50


async def test_putPreference_sixthPointsOffer_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.cap@example.com")
    product_id = await _product(client, db_session, owner, "Punkty kubek")
    await _photo(db_session, product_id, owner.user_id, ModerationStatus.APPROVED)
    item_ids = [await _item(client, owner, product_id) for _ in range(6)]
    for item_id in item_ids[:5]:
        listed = await _put(client, owner, item_id, {"mode": "POINTS"})
        assert listed.status_code == 200, listed.text

    sixth = await _put(client, owner, item_ids[5], {"mode": "POINTS"})
    repriced = await _put(client, owner, item_ids[0], {"mode": "POINTS", "points_price": 60})

    assert sixth.status_code == 409, sixth.text
    assert sixth.json()["message"] == "Masz już maksymalną liczbę ofert za punkty (5)."
    assert await _preference(db_session, item_ids[5]) is None
    assert repriced.status_code == 200, repriced.text


@pytest.mark.parametrize("price", [70, 45, 10])
async def test_putPreference_offRangeOrOffStepPrice_returns400NamingRange(
    client: AsyncClient, db_session: AsyncSession, price: int
) -> None:
    owner = await _owner(client, f"plist.range.{price}@example.com")
    item_id = await _photographed_item(client, db_session, owner, f"Punkty stolik {price}")

    response = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": price})

    assert response.status_code == 400, response.text
    assert response.json()["message"] == RANGE_MESSAGE


async def test_putPreference_omittedPrice_storesClampedSuggestion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.omitted@example.com")
    item_id = await _photographed_item(client, db_session, owner, "Punkty krzesło")

    first = await _put(client, owner, item_id, {"mode": "POINTS"})
    await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 50})
    kept = await _put(client, owner, item_id, {"mode": "POINTS", "visibility": "PUBLIC"})

    assert first.status_code == 200, first.text
    assert first.json()["points_price"] == 40
    assert kept.status_code == 200, kept.text
    assert kept.json()["points_price"] == 50


async def test_putPreference_existingPointsAfterPhotoRejected_editsPriceAndVisibility(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.rejectedlater@example.com")
    item_id = await _photographed_item(client, db_session, owner, "Punkty fotel")
    listed = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 40})
    assert listed.status_code == 200, listed.text
    await db_session.execute(
        update(ProductPhoto)
        .where(ProductPhoto.uploaded_by_user_id == owner.user_id)
        .values(status=ModerationStatus.REJECTED)
    )

    visibility = await _put(client, owner, item_id, {"mode": "POINTS", "visibility": "PUBLIC"})
    price = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 50})

    assert visibility.status_code == 200, visibility.text
    assert visibility.json()["points_price"] == 40
    assert price.status_code == 200, price.text
    assert await _preference(db_session, item_id) == ("POINTS", 50)


async def test_putPreference_usesStoredValueAfterConfigChange(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.stored@example.com")
    item_id = await _photographed_item(client, db_session, owner, "Punkty komoda")
    await db_session.execute(update(PointsConfig).values(base_medium=20))

    response = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 60})

    # The preview would now be 20 (bounds 10–30); the stored 40 still allows 60.
    assert response.status_code == 200, response.text
    assert response.json()["points_price"] == 60


async def test_patchItem_conditionChange_clampsStoredPrice(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.revalue@example.com")
    item_id = await _photographed_item(client, db_session, owner, "Punkty regał")
    listed = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 60})
    assert listed.status_code == 200, listed.text

    patched = await client.patch(
        f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=owner.headers
    )

    # 40 × 0.50 = 20 → bounds 10–30, so 60 is clamped to 30.
    assert patched.status_code == 200, patched.text
    value = (
        await db_session.execute(
            select(InventoryItem.points_value).where(InventoryItem.id == uuid.UUID(item_id))
        )
    ).scalar_one()
    assert value == 20
    assert await _preference(db_session, item_id) == ("POINTS", 30)


async def test_putPreference_switchToGift_nullsPrice(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _owner(client, "plist.gift@example.com")
    item_id = await _photographed_item(client, db_session, owner, "Punkty dywan")
    await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 50})

    refused = await _put(client, owner, item_id, {"mode": "GIFT", "points_price": 50})
    gift = await _put(client, owner, item_id, {"mode": "GIFT"})

    assert refused.status_code == 400, refused.text
    messages = refused.json()["fieldErrors"].values()
    assert any("Cena w punktach dotyczy tylko oferty za punkty." in m for m in messages)
    assert gift.status_code == 200, gift.text
    assert gift.json()["points_price"] is None
    assert await _preference(db_session, item_id) == ("GIFT", None)


async def test_putPreference_modeChangedBetweenReads_returns409NothingWritten(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second session on the test connection commits a switch to POINTS
    after the unlocked read decided "becomes POINTS" and before the item
    lock, so the re-read under the lock disagrees."""
    owner = await _owner(client, "plist.race@example.com")
    item_id = await _photographed_item(client, db_session, owner, "Punkty szafka")
    await _put(client, owner, item_id, {"mode": "GIFT"})
    real_lock: Callable[[AsyncSession, uuid.UUID], Awaitable[InventoryItem]] = (
        inventory_bridge.get_item_for_update
    )

    async def switch_then_lock(db: AsyncSession, locked_id: uuid.UUID) -> InventoryItem:
        async with AsyncSession(
            bind=db_session.bind, join_transaction_mode="create_savepoint"
        ) as other:
            await other.execute(
                update(ItemListingPreference)
                .where(ItemListingPreference.item_id == locked_id)
                .values(mode="POINTS", points_price=30)
            )
            await other.commit()
        return await real_lock(db, locked_id)

    monkeypatch.setattr(inventory_bridge, "get_item_for_update", switch_then_lock)

    response = await _put(client, owner, item_id, {"mode": "POINTS", "points_price": 50})

    assert response.status_code == 409, response.text
    assert response.json()["message"] == CHANGED_MESSAGE
    assert await _preference(db_session, item_id) == ("POINTS", 30)
