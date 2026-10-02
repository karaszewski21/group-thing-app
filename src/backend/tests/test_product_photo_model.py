"""`app.product.models.ProductPhoto` (migrations 0045/0046) — DB-layer round
trips only: UUID id and timestamps on insert, the `(product_id,
content_sha256)` duplicate key, and business-key equality on
`(product_id, storage_key)`."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.category.models import Category
from app.moderation.status import ModerationStatus
from app.product.models import Product, ProductPhoto


async def _create_product(db: AsyncSession) -> uuid.UUID:
    category = Category(name=f"Photo {uuid.uuid4().hex[:8]}", sort_order=99)
    db.add(category)
    await db.flush()
    product = Product(
        name="Klocki Duplo", sku=f"SKU-{uuid.uuid4().hex[:8]}", category_id=category.id
    )
    db.add(product)
    await db.flush()
    return product.id


async def _create_user(db: AsyncSession) -> uuid.UUID:
    user = User(username=f"photo-{uuid.uuid4().hex[:8]}", password_hash="x")
    db.add(user)
    await db.flush()
    return user.id


def _photo(
    product_id: uuid.UUID, user_id: uuid.UUID, *, key: str, sha: str, sort_order: int = 0
) -> ProductPhoto:
    return ProductPhoto(
        product_id=product_id,
        storage_key=key,
        width=1600,
        height=1200,
        size_bytes=1000,
        content_sha256=sha,
        status=ModerationStatus.PENDING,
        uploaded_by_user_id=user_id,
        sort_order=sort_order,
    )


async def test_insertProductPhoto_validRow_persistsWithUuidIdAndTimestamps(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)
    user_id = await _create_user(db_session)

    photo = _photo(product_id, user_id, key="products/p/1", sha="a" * 64)
    db_session.add(photo)
    await db_session.flush()

    assert isinstance(photo.id, uuid.UUID)
    assert photo.created_at is not None
    assert photo.updated_at is not None
    stored = (
        await db_session.execute(select(ProductPhoto.status).where(ProductPhoto.id == photo.id))
    ).scalar_one()
    assert stored == ModerationStatus.PENDING


async def test_insertProductPhoto_sameFileTwiceForProduct_raisesIntegrityError(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)
    user_id = await _create_user(db_session)
    db_session.add(_photo(product_id, user_id, key="products/p/1", sha="b" * 64))
    await db_session.flush()

    db_session.add(_photo(product_id, user_id, key="products/p/2", sha="b" * 64, sort_order=1))
    with pytest.raises(IntegrityError, match="uq_product_photos_product_id_content_sha256"):
        await db_session.flush()


def test_productPhotoEquality_sameProductAndStorageKey_equalAndSameHash() -> None:
    product_id = uuid.uuid4()
    user_id = uuid.uuid4()
    first = _photo(product_id, user_id, key="products/p/1", sha="c" * 64)
    second = _photo(product_id, user_id, key="products/p/1", sha="d" * 64, sort_order=3)
    other_key = _photo(product_id, user_id, key="products/p/2", sha="c" * 64)

    assert first == second
    assert hash(first) == hash(second)
    assert first != other_key
    assert first.large_key == "products/p/1/w1600.webp"
    assert first.thumb_key == "products/p/1/w400.webp"
