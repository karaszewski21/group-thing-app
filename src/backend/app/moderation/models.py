"""`ModerationDecision`: the append-only audit log of every moderation
outcome (automated model verdicts and admin decisions). Rows are never
updated; the `status` columns on `product_photos`/`products` are projections
of the latest row per subject."""

from __future__ import annotations

import enum
import uuid
from typing import Any

from sqlalchemy import Boolean, Enum, ForeignKey, Index, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity

from .status import ModerationStatus


class ModerationSubjectType(enum.StrEnum):
    PHOTO = "PHOTO"
    AVATAR = "AVATAR"
    PRODUCT_TEXT = "PRODUCT_TEXT"


class ModerationSource(enum.StrEnum):
    AI = "AI"
    ADMIN = "ADMIN"


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class ModerationDecision(BaseEntity):
    __tablename__ = "moderation_decisions"
    __table_args__ = (
        Index("ix_moderation_decisions_subject", "subject_type", "subject_id", "created_at"),
    )

    subject_type: Mapped[ModerationSubjectType] = mapped_column(
        _enum_column(ModerationSubjectType, 20), nullable=False
    )
    # A product photo id or a product id; no FK, the log outlives its subject.
    subject_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[ModerationSource] = mapped_column(
        _enum_column(ModerationSource, 20), nullable=False
    )
    automated: Mapped[bool] = mapped_column(Boolean, nullable=False)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_moderation_decisions_decided_by_user_id_users"),
        nullable=True,
    )
    model_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    scores: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    thresholds: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    outcome: Mapped[ModerationStatus] = mapped_column(
        _enum_column(ModerationStatus, 20), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    def __eq__(self, other: Any) -> bool:
        """An audit row has no natural business key; identity is the row itself."""
        return self is other

    def __hash__(self) -> int:
        return id(self)
