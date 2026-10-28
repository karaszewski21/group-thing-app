"""Photos in moderation no longer gate listing: an item can get a listing
mode while its product has a PENDING or NEEDS_REVIEW photo, a new pending
photo or a re-point keeps the listing, and `GET /api/inventory-items/mine`
still flags such items."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.moderation.status import ModerationStatus
from app.product.models import ProductPhoto
from tests.test_moderation import _png
from tests.test_term_item_listings import (
    _auth,
    _register,
    _register_personal_item,
    _resolve_product,
)


@pytest.fixture
def moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)


async def _upload_photo(client: AsyncClient, token: str, product_id: str, seed: int) -> uuid.UUID:
    response = await client.post(
        f"/api/products/{product_id}/photos",
        files={"file": ("p.png", _png(seed), "image/png")},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "PENDING"
    return uuid.UUID(response.json()["id"])


async def _put_mode(client: AsyncClient, token: str, item_id: uuid.UUID, mode: str | None) -> int:
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
    )
    return response.status_code


async def _mine_row(client: AsyncClient, token: str, item_id: uuid.UUID) -> dict[str, object]:
    response = await client.get("/api/inventory-items/mine", headers=_auth(token))
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row["id"] == str(item_id))


async def _add_item(
    client: AsyncClient, token: str, sibling_item: uuid.UUID, product_name: str
) -> uuid.UUID:
    """A second item in the inventory `sibling_item` lives in."""
    inventory_id = (await _mine_row(client, token, sibling_item))["inventory_id"]
    response = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory_id,
            "product_id": await _resolve_product(client, token, product_name),
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def test_setListingPreference_pendingAndNeedsReviewPhotos_returns200AndActive(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.p1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka wózek")
    product_id = await _resolve_product(client, token, "Bramka wózek")
    await _upload_photo(client, token, product_id, 1)
    review_id = await _upload_photo(client, token, product_id, 2)
    await db_session.execute(
        update(ProductPhoto)
        .where(ProductPhoto.id == review_id)
        .values(status=ModerationStatus.NEEDS_REVIEW)
    )
    await db_session.commit()

    status = await _put_mode(client, token, item_id, "GIFT")

    assert status == 200
    row = await _mine_row(client, token, item_id)
    assert (row["listing_mode"], row["listing_status"]) == ("GIFT", "ACTIVE")


async def test_addProductPhoto_pendingPhoto_keepsListingPreference(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.u1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka rowerek")
    product_id = await _resolve_product(client, token, "Bramka rowerek")
    assert await _put_mode(client, token, item_id, "SWAP") == 200

    await _upload_photo(client, token, product_id, 3)

    row = await _mine_row(client, token, item_id)
    assert (row["listing_mode"], row["listing_status"]) == ("SWAP", "ACTIVE")


async def test_updateItem_repointToPendingProduct_keepsListingPreference(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.r1@example.com")
    other_token, _ = await _register(client, "GUEST", "gate.r2@example.com")
    item_id = await _register_personal_item(client, token, "Bramka hulajnoga")
    await _register_personal_item(client, other_token, "Bramka fotelik")
    other_product_id = await _resolve_product(client, other_token, "Bramka fotelik")
    await _upload_photo(client, other_token, other_product_id, 4)
    assert await _put_mode(client, token, item_id, "GIFT") == 200

    response = await client.patch(
        f"/api/inventory-items/{item_id}",
        json={"product_id": other_product_id},
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    row = await _mine_row(client, token, item_id)
    assert row["product_id"] == other_product_id
    assert (row["listing_mode"], row["listing_status"]) == ("GIFT", "ACTIVE")


async def test_myInventoryItems_photosModerationPending_stillReported(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    owner_token, _ = await _register(client, "GUEST", "gate.f1@example.com")
    co_owner_token, _ = await _register(client, "GUEST", "gate.f2@example.com")
    pending_item = await _register_personal_item(client, owner_token, "Bramka wspólna")
    clean_item = await _add_item(client, owner_token, pending_item, "Bramka książka")
    co_owner_item = await _register_personal_item(client, co_owner_token, "Bramka wspólna")
    product_id = await _resolve_product(client, owner_token, "Bramka wspólna")
    assert product_id == await _resolve_product(client, co_owner_token, "Bramka wspólna")
    await _upload_photo(client, co_owner_token, product_id, 5)

    assert (await _mine_row(client, owner_token, pending_item))["photos_moderation_pending"] is True
    assert (await _mine_row(client, owner_token, clean_item))["photos_moderation_pending"] is False
    assert (await _mine_row(client, co_owner_token, co_owner_item))[
        "photos_moderation_pending"
    ] is True
