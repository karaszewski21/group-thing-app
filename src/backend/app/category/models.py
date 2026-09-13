"""`Category` ORM model (table reintroduced by the `0025_category_
reintroduction` Alembic migration; see spec.md's Database Schema Spec
`categories` table).

Note: `app/category/service.py` reaches `products.category_id` through a
lightweight ad-hoc Core table reference rather than importing
`app.product.models.Product`, to avoid a cross-module ORM `relationship()`
per `standards/backend/models.md`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class Category(BaseEntity):
    __tablename__ = "categories"
    __sequence_name__ = "category_seq"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `name` (never entity `id`) — per
        `standards/backend/models.md`'s equals/hashCode convention, mirrors
        `Product`'s `sku`-based equality (`app/product/models.py`)."""
        if not isinstance(other, Category):
            return NotImplemented
        return self.name == other.name

    def __hash__(self) -> int:
        return hash(self.name)
