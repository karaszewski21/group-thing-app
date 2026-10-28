"""`Category` ORM model (table reintroduced by the `0025_category_
reintroduction` Alembic migration, turned into a tree by `0066_category_
tree`; see spec.md's Database Schema Spec `categories` table).

`parent_id` is a plain self-FK column with no ORM `relationship()`: the tree
is assembled client-side from the flat list. `sort_order` orders siblings.

Note: `app/category/service.py` reaches `products.category_id` through a
lightweight ad-hoc Core table reference rather than importing
`app.product.models.Product`, to avoid a cross-module ORM `relationship()`
per `standards/backend/models.md`.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class Category(BaseEntity):
    __tablename__ = "categories"
    __table_args__ = (
        Index("ix_categories_parent_id", "parent_id"),
        UniqueConstraint("external_id", name="uq_categories_external_id"),
        UniqueConstraint("parent_id", "name", name="uq_categories_parent_id_name"),
        # NULL parents never collide in the constraint above, so root names
        # need their own partial unique index.
        Index(
            "uq_categories_root_name",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NULL"),
        ),
    )

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("categories.id", name="fk_categories_parent_id_categories", ondelete="RESTRICT"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    external_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `(parent_id, name)` (never entity `id`) —
        names are unique only among siblings; per `standards/backend/models.md`'s
        equals/hashCode convention."""
        if not isinstance(other, Category):
            return NotImplemented
        return (self.parent_id, self.name) == (other.parent_id, other.name)

    def __hash__(self) -> int:
        return hash((self.parent_id, self.name))
