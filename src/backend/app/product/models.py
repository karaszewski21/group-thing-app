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

from sqlalchemy import Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity
from app.moderation.status import ModerationStatus


def _status_column() -> Enum:
    """String-backed (never ordinal, never a native PG enum) — see
    `app/party/models.py`'s `_enum_column` for the rationale."""
    return Enum(
        ModerationStatus,
        native_enum=False,
        length=20,
        values_callable=lambda cls: [member.value for member in cls],
    )


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
    # Moderation of the name + shared description, and the hash of the text
    # that status was decided for (re-moderated only when the text changes).
    text_status: Mapped[ModerationStatus] = mapped_column(
        _status_column(),
        nullable=False,
        default=ModerationStatus.APPROVED,
        server_default=ModerationStatus.APPROVED.value,
    )
    text_moderated_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

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
    """One uploaded gallery photo of a catalog `Product`, shared by every
    inventory item of that product and shown in dense `sort_order` (0..n-1).
    The files live in object storage under `storage_key` (`/w1600.webp` and
    `/w400.webp`); they stay private until `status` is APPROVED. No cascade
    and no `relationship()`. The 10-photo limit is enforced in the
    application layer."""

    __tablename__ = "product_photos"
    __table_args__ = (
        UniqueConstraint(
            "product_id", "storage_key", name="uq_product_photos_product_id_storage_key"
        ),
        UniqueConstraint(
            "product_id", "content_sha256", name="uq_product_photos_product_id_content_sha256"
        ),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_product_photos_product_id_products"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Hash of the original upload: rejects re-uploading the same file.
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ModerationStatus] = mapped_column(_status_column(), nullable=False)
    uploaded_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_product_photos_uploaded_by_user_id_users"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)

    @property
    def large_key(self) -> str:
        return f"{self.storage_key}/w1600.webp"

    @property
    def thumb_key(self) -> str:
        return f"{self.storage_key}/w400.webp"

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `(product_id, storage_key)`, never the surrogate id."""
        if not isinstance(other, ProductPhoto):
            return NotImplemented
        return (self.product_id, self.storage_key) == (other.product_id, other.storage_key)

    def __hash__(self) -> int:
        return hash((self.product_id, self.storage_key))
