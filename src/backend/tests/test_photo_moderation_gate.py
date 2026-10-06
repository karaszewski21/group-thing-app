"""Publish gate for photos in moderation: an item cannot get a listing mode
while its product has a PENDING or NEEDS_REVIEW photo (`mode: null` is
always allowed), and `GET /api/inventory-items/mine` flags such items."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.groups.application.term_item_listings import PHOTOS_IN_MODERATION_MESSAGE
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
    return uuid.UUID(response.json()["id"])


async def _set_status(db: AsyncSession, photo_id: uuid.UUID, status: ModerationStatus) -> None:
    await db.execute(update(ProductPhoto).where(ProductPhoto.id == photo_id).values(status=status))
    await db.commit()


async def _put_mode(
    client: AsyncClient, token: str, item_id: uuid.UUID, mode: str | None
) -> tuple[int, dict[str, object] | None]:
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
    )
    return response.status_code, response.json()


async def test_setListingPreference_pendingPhoto_returns409WithExactMessage(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.p1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka wózek")
    product_id = await _resolve_product(client, token, "Bramka wózek")
    await _upload_photo(client, token, product_id, 1)

    status, body = await _put_mode(client, token, item_id, "GIFT")

    assert status == 409
    assert body is not None and body["message"] == PHOTOS_IN_MODERATION_MESSAGE
    assert PHOTOS_IN_MODERATION_MESSAGE == (
        "Nie można wystawić tej rzeczy — jej zdjęcia czekają na moderację. "
        "Tryb wypożyczę/oddam/zamienię włączysz po ich zatwierdzeniu."
    )


async def test_setListingPreference_needsReviewPhoto_returns409(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.n1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka rowerek")
    product_id = await _resolve_product(client, token, "Bramka rowerek")
    photo_id = await _upload_photo(client, token, product_id, 2)
    await _set_status(db_session, photo_id, ModerationStatus.NEEDS_REVIEW)

    status, body = await _put_mode(client, token, item_id, "LEND")

    assert status == 409
    assert body is not None and body["message"] == PHOTOS_IN_MODERATION_MESSAGE


async def test_setListingPreference_onlyApprovedOrRejected_returns200(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.a1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka hulajnoga")
    product_id = await _resolve_product(client, token, "Bramka hulajnoga")
    approved = await _upload_photo(client, token, product_id, 3)
    rejected = await _upload_photo(client, token, product_id, 4)
    await _set_status(db_session, approved, ModerationStatus.APPROVED)
    await _set_status(db_session, rejected, ModerationStatus.REJECTED)

    status, body = await _put_mode(client, token, item_id, "SWAP")

    assert status == 200, body
    assert body is not None and body["mode"] == "SWAP"


async def test_setListingPreference_modeNullWhilePending_returns200(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.z1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka fotelik")
    product_id = await _resolve_product(client, token, "Bramka fotelik")
    await _upload_photo(client, token, product_id, 5)

    status, body = await _put_mode(client, token, item_id, None)

    assert status == 200
    assert body is None


async def test_setListingPreference_coOwnersPendingPhoto_blocks(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    owner_token, _ = await _register(client, "GUEST", "gate.c1@example.com")
    co_owner_token, _ = await _register(client, "GUEST", "gate.c2@example.com")
    item_id = await _register_personal_item(client, owner_token, "Bramka klocki")
    await _register_personal_item(client, co_owner_token, "Bramka klocki")
    product_id = await _resolve_product(client, owner_token, "Bramka klocki")
    assert product_id == await _resolve_product(client, co_owner_token, "Bramka klocki")
    await _upload_photo(client, co_owner_token, product_id, 6)

    status, body = await _put_mode(client, owner_token, item_id, "GIFT")

    assert status == 409
    assert body is not None and body["message"] == PHOTOS_IN_MODERATION_MESSAGE


async def test_setListingPreference_imageModerationDisabled_notBlocked(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    token, _ = await _register(client, "GUEST", "gate.d1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka lalka")
    product_id = await _resolve_product(client, token, "Bramka lalka")
    await _upload_photo(client, token, product_id, 7)

    status, body = await _put_mode(client, token, item_id, "GIFT")

    assert status == 200, body


async def test_myInventoryItems_photosModerationPending_trueAndFalse(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "gate.f1@example.com")
    pending_item = await _register_personal_item(client, token, "Bramka puzzle")
    mine = await client.get("/api/inventory-items/mine", headers=_auth(token))
    second = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": mine.json()[0]["inventory_id"],
            "product_id": await _resolve_product(client, token, "Bramka książka"),
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert second.status_code == 201, second.text
    clean_item = second.json()["id"]
    await _upload_photo(client, token, await _resolve_product(client, token, "Bramka puzzle"), 8)

    response = await client.get("/api/inventory-items/mine", headers=_auth(token))

    assert response.status_code == 200, response.text
    flags = {row["id"]: row["photos_moderation_pending"] for row in response.json()}
    assert flags == {str(pending_item): True, clean_item: False}


async def test_setListingPreference_existingModeWhilePending_changeBlockedNullClears(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    """A listing that predates the gate (or the cleanup script): the owner can
    neither switch it to another mode nor re-save it, but can always turn it
    off — the toggles' disabled state must not trap a live listing."""
    token, _ = await _register(client, "GUEST", "gate.e1@example.com")
    item_id = await _register_personal_item(client, token, "Bramka sanki")
    product_id = await _resolve_product(client, token, "Bramka sanki")
    photo_id = await _upload_photo(client, token, product_id, 10)
    await _set_status(db_session, photo_id, ModerationStatus.APPROVED)
    assert (await _put_mode(client, token, item_id, "GIFT"))[0] == 200
    await _set_status(db_session, photo_id, ModerationStatus.PENDING)

    async def _listing_mode() -> object:
        response = await client.get("/api/inventory-items/mine", headers=_auth(token))
        return next(r["listing_mode"] for r in response.json() if r["id"] == str(item_id))

    status, body = await _put_mode(client, token, item_id, "LEND")

    assert status == 409
    assert body is not None and body["message"] == PHOTOS_IN_MODERATION_MESSAGE
    assert await _listing_mode() == "GIFT"

    status, body = await _put_mode(client, token, item_id, None)

    assert status == 200
    assert body is None
    assert await _listing_mode() is None


async def test_myInventoryItems_coOwnersPendingPhoto_flagTrueForEveryOwner(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    owner_token, _ = await _register(client, "GUEST", "gate.f2@example.com")
    co_owner_token, _ = await _register(client, "GUEST", "gate.f3@example.com")
    owner_item = await _register_personal_item(client, owner_token, "Bramka wspólna")
    co_owner_item = await _register_personal_item(client, co_owner_token, "Bramka wspólna")
    product_id = await _resolve_product(client, owner_token, "Bramka wspólna")
    assert product_id == await _resolve_product(client, co_owner_token, "Bramka wspólna")
    await _upload_photo(client, co_owner_token, product_id, 9)

    for token, item_id in ((owner_token, owner_item), (co_owner_token, co_owner_item)):
        response = await client.get("/api/inventory-items/mine", headers=_auth(token))
        assert response.status_code == 200, response.text
        flags = {row["id"]: row["photos_moderation_pending"] for row in response.json()}
        assert flags == {str(item_id): True}
