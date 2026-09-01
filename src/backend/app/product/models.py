"""`Product` ORM model (table created by Group 2's `0001_initial_schema`
migration; see spec.md's Database Schema Spec `products` table). Follows
`app/category/models.py`'s ORM pattern (Group 7's reference module).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.category.models import Category
from app.core.base_model import BaseEntity


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
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", name="fk_products_category_id_categories"), nullable=False
    )
    plugin_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # `lazy="raise"`: every read path (get/list/create/update in
    # service.py/query_service.py) must explicitly
    # `.options(joinedload(Product.category))` — spec.md requires GET-by-id
    # to JOIN-fetch category rather than lazy-load, and since
    # `ProductResponse` always nests a full `CategoryResponse`, every other
    # read path needs the same. `AsyncSession` can't do an implicit
    # lazy-load anyway (it would raise `MissingGreenlet` deep in Pydantic
    # serialization); `lazy="raise"` turns a missed eager-load into an
    # immediate, legible `InvalidRequestError` at the call site instead.
    category: Mapped[Category] = relationship(Category, lazy="raise")

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `sku` (never entity `id`) — per
        `backend/models.md`'s equals/hashCode convention, ported here since
        the Java entity's own business key was `sku`."""
        if not isinstance(other, Product):
            return NotImplemented
        return self.sku == other.sku

    def __hash__(self) -> int:
        return hash(self.sku)
