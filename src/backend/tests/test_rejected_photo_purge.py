"""`purge_rejected_photos`: REJECTED photos are deleted from their gallery,
the rest is renumbered and the files are staged for deletion."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.moderation.status import ModerationStatus
from app.outbox.models import OutboxEntry
from app.product.models import ProductPhoto
from app.product.service import purge_rejected_photos
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.test_photo_moderation_gate import _set_status, _upload_photo
from tests.test_term_item_listings import _register, _register_personal_item, _resolve_product

pytestmark = pytest.mark.usefixtures("moderation_on")


@pytest.fixture
def moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)


async def _gallery(db: AsyncSession, product_id: str) -> list[tuple[uuid.UUID, int]]:
    db.expire_all()
    result = await db.execute(
        select(ProductPhoto.id, ProductPhoto.sort_order)
        .where(ProductPhoto.product_id == uuid.UUID(product_id))
        .order_by(ProductPhoto.sort_order)
    )
    return [(row.id, row.sort_order) for row in result]


async def test_purgeRejectedPhotos_rejectedPhoto_deletedRenumberedAndFilesStaged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "purge.r1@example.com")
    await _register_personal_item(client, token, "Czystka lampa")
    product_id = await _resolve_product(client, token, "Czystka lampa")
    first = await _upload_photo(client, token, product_id, 11)
    rejected = await _upload_photo(client, token, product_id, 12)
    last = await _upload_photo(client, token, product_id, 13)
    await _set_status(db_session, rejected, ModerationStatus.REJECTED)
    rejected_key = f"products/{product_id}/{rejected}"

    deleted = await purge_rejected_photos(db_session)

    assert deleted == 1
    assert await _gallery(db_session, product_id) == [(first, 0), (last, 1)]
    staged = (
        (
            await db_session.execute(
                select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
            )
        )
        .scalars()
        .all()
    )
    assert {"keys": [f"{rejected_key}/w1600.webp", f"{rejected_key}/w400.webp"]} in staged


async def test_purgeRejectedPhotos_noRejectedPhotos_leavesGalleryUntouched(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "purge.n1@example.com")
    await _register_personal_item(client, token, "Czystka krzesło")
    product_id = await _resolve_product(client, token, "Czystka krzesło")
    pending = await _upload_photo(client, token, product_id, 14)
    review = await _upload_photo(client, token, product_id, 15)
    await _set_status(db_session, review, ModerationStatus.NEEDS_REVIEW)

    deleted = await purge_rejected_photos(db_session)

    assert deleted == 0
    assert await _gallery(db_session, product_id) == [(pending, 0), (review, 1)]
