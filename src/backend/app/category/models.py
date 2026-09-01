"""`Category` ORM model (table created by Group 2's `0001_initial_schema`
migration; see spec.md's Database Schema Spec `categories` table). Reference
module for the migration's ORM pattern — Groups 8/9 (product, plugin_objects)
follow this shape.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class Category(BaseEntity):
    __tablename__ = "categories"
    __sequence_name__ = "category_seq"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `name` (never entity `id`) — per
        `backend/models.md`'s equals/hashCode convention, ported here since
        the Java entity's own business key was `name`."""
        if not isinstance(other, Category):
            return NotImplemented
        return self.name == other.name

    def __hash__(self) -> int:
        return hash(self.name)
