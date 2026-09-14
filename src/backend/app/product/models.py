"""`Product` ORM model (table created by Group 2's `0001_initial_schema`
migration; see spec.md's Database Schema Spec `products` table). `category_id`
is a plain FK-id column into the standalone `app.category` module's
`Category` table (reintroduced by `0025_category_reintroduction`) — no
`relationship()` per `standards/backend/models.md`'s cross-module rule;
`app.circulation`'s `InventoryItem.product_id` references this same catalog.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class Product(BaseEntity):
    __tablename__ = "products"
    __sequence_name__ = "product_seq"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # No unique constraint on `sku` at the DB level (see the migration),
    # even though it's this entity's business key below — preserve that
    # absence exactly, matching the Java source.
    sku: Mapped[str] = mapped_column(String(50), nullable=False)
    category_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("categories.id"), nullable=False
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
