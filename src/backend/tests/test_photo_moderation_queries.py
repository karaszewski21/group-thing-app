"""The batched unmoderated-photo lookup behind the "Moje rzeczy" pending
flag, kept after the photo-moderation listing gate was removed."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.infrastructure import product_bridge
from app.moderation.status import ModerationStatus
from app.product.models import ProductPhoto
from tests.test_circulation_ledger import _create_product, _create_user


async def _add_photo(db: AsyncSession, product_id: uuid.UUID, status: ModerationStatus) -> None:
    db.add(
        ProductPhoto(
            product_id=product_id,
            storage_key=f"products/{product_id}/{uuid.uuid4().hex}",
            width=1600,
            height=1200,
            size_bytes=1000,
            content_sha256=uuid.uuid4().hex * 2,
            status=status,
            uploaded_by_user_id=await _create_user(db),
            sort_order=0,
        )
    )
    await db.flush()


async def test_productIdsWithUnmoderatedPhotos_pendingAndNeedsReviewOnly(
    db_session: AsyncSession,
) -> None:
    by_status = {}
    for status in ModerationStatus:
        product_id = await _create_product(db_session)
        await _add_photo(db_session, product_id, status)
        by_status[status] = product_id
    no_photos = await _create_product(db_session)

    result = await product_bridge.product_ids_with_unmoderated_photos(
        db_session, [*by_status.values(), no_photos]
    )

    assert result == {
        by_status[ModerationStatus.PENDING],
        by_status[ModerationStatus.NEEDS_REVIEW],
    }
    assert await product_bridge.product_ids_with_unmoderated_photos(db_session, []) == set()
