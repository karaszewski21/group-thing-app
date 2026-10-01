"""`Product` ORM model (table created by Group 2's `0001_initial_schema`
migration; see spec.md's Database Schema Spec `products` table). `category_id`
is a plain FK-id column into the standalone `app.category` module's
`Category` table (reintroduced by `0025_category_reintroduction`) — no
`relationship()` per `standards/backend/models.md`'s cross-module rule;
`app.circulation`'s `InventoryItem.product_id` references this same catalog.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class Product(BaseEntity):
    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # No unique constraint on `sku` at the DB level (see the migration),
    # even though it's this entity's business key below — preserve that
    # absence exactly, matching the Java source.
    sku: Mapped[str] = mapped_column(String(50), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False
    )
    plugin_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `sku` (never entity `id`) — per
        `backend/models.md`'s equals/hashCode convention, ported here since
        the Java entity's own business key was `sku`."""
        if not isinstance(other, Product):
            return NotImplemented
        return self.sku == other.sku

    def __hash__(self) -> int:
        return hash(self.sku)


class ProductPhoto(BaseEntity):
    """One gallery photo (an external URL) of a catalog `Product`, shared by
    every inventory item of that product and shown in dense `sort_order`
    (0..n-1). No cascade and no `relationship()`. The 10-photo limit and URL
    format are enforced in the application layer, not by DB checks."""

    __tablename__ = "product_photos"
    __table_args__ = (
        UniqueConstraint("product_id", "url", name="uq_product_photos_product_id_url"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_product_photos_product_id_products"),
        nullable=False,
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `(product_id, url)`, never the surrogate id."""
        if not isinstance(other, ProductPhoto):
            return NotImplemented
        return (self.product_id, self.url) == (other.product_id, other.url)

    def __hash__(self) -> int:
        return hash((self.product_id, self.url))
