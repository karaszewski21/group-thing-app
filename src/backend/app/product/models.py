"""`Product` ORM model (table created by Group 2's `0001_initial_schema`
migration; see spec.md's Database Schema Spec `products` table). Category is
a closed, string-backed enum (`ProductCategory`) rather than a separate
`Category` FK — the standalone `app.category` module was removed in favor of
this inline dictionary, and `app.circulation`'s `InventoryItem.product_id`
now references this same catalog.
"""

from __future__ import annotations

import enum
from decimal import Decimal
from typing import Any

from sqlalchemy import Enum, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """A `String`-backed column for a `StrEnum` that actually round-trips as
    the enum type on read, not a bare `str` — `native_enum=False` keeps the
    DDL a plain `VARCHAR` (matches `standards/backend/models.md`'s "stored
    as a String column, never ordinal"; no Postgres native enum type is
    created), while `values_callable` stores/reads each member's `.value`
    rather than SQLAlchemy's own `Enum` default of `.name`. Duplicated from
    `app/party/models.py` rather than shared — each vertical in this
    codebase is self-contained (see `app/category/service.py` vs.
    `app/product/service.py` not sharing a base CRUD class either)."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class ProductCategory(enum.StrEnum):
    """Closed, extensible dictionary for what kind of thing a product is."""

    TOY = "TOY"
    BOOK = "BOOK"
    GAME = "GAME"
    CLOTHING = "CLOTHING"
    OTHER = "OTHER"


class Product(BaseEntity):
    __tablename__ = "products"
    __sequence_name__ = "product_seq"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(19, 2), nullable=False)
    # No unique constraint on `sku` at the DB level (see the migration),
    # even though it's this entity's business key below — preserve that
    # absence exactly, matching the Java source.
    sku: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[ProductCategory] = mapped_column(
        _enum_column(ProductCategory, 20), nullable=False
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
