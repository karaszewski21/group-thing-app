"""`app.product.models.ProductPhoto` (migration 0045) — DB-layer round trips
only: UUID id and timestamps on insert, the
`uq_product_photos_product_id_url` business key, and business-key equality
on `(product_id, url)`."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.category.models import Category
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


async def test_insertProductPhoto_validRow_persistsWithUuidIdAndTimestamps(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)

    photo = ProductPhoto(product_id=product_id, url="https://example.com/a.jpg", sort_order=0)
    db_session.add(photo)
    await db_session.flush()

    assert isinstance(photo.id, uuid.UUID)
    assert photo.created_at is not None
    assert photo.updated_at is not None
    assert photo.sort_order == 0


async def test_insertProductPhoto_duplicateProductAndUrl_raisesIntegrityError(
    db_session: AsyncSession,
) -> None:
    product_id = await _create_product(db_session)
    url = "https://example.com/dup.jpg"
    db_session.add(ProductPhoto(product_id=product_id, url=url, sort_order=0))
    await db_session.flush()

    db_session.add(ProductPhoto(product_id=product_id, url=url, sort_order=1))
    with pytest.raises(IntegrityError, match="uq_product_photos_product_id_url"):
        await db_session.flush()


def test_productPhotoEquality_sameProductAndUrl_equalAndSameHash() -> None:
    product_id = uuid.uuid4()
    first = ProductPhoto(id=uuid.uuid4(), product_id=product_id, url="https://x/1", sort_order=0)
    second = ProductPhoto(id=uuid.uuid4(), product_id=product_id, url="https://x/1", sort_order=3)
    other_url = ProductPhoto(id=first.id, product_id=product_id, url="https://x/2", sort_order=0)

    assert first == second
    assert hash(first) == hash(second)
    assert first != other_url
