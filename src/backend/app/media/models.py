"""The `media` table: one moderated image of a party's public page.

`owner_party_id` and `uploaded_by_user_id` are plain FK-id columns, never a
`relationship()` crossing the module boundary, per `standards/backend/models.md`."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity
from app.moderation.status import ModerationStatus


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class MediaKind(enum.StrEnum):
    LOGO = "LOGO"
    AVATAR = "AVATAR"
    COVER = "COVER"
    GALLERY = "GALLERY"


class Media(BaseEntity):
    """A moderated image of a party's public page: the logo, the avatar, the
    cover or one of the gallery photos. The files (under `storage_key`: `/w1600.webp`,
    `/w400.webp`) stay private until `status` is APPROVED. VPS B's cron claims
    PENDING rows (migration 0082) and logs its decisions as subject `MEDIA`.

    LOGO, AVATAR and COVER are slots: the newest APPROVED row per slot is the
    public one, and at most one unmoderated row per slot may exist. GALLERY rows are
    shown in `sort_order`; the limit is enforced in the application layer."""

    __tablename__ = "media"
    # The claim index `ix_media_pending_created_at` and the partial unique
    # `uq_media_one_pending_per_slot` stay migration-only.
    __table_args__ = (
        UniqueConstraint(
            "owner_party_id",
            "kind",
            "content_sha256",
            name="uq_media_owner_party_id_kind_content_sha256",
        ),
    )

    owner_party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_media_owner_party_id_parties"),
        nullable=False,
    )
    kind: Mapped[MediaKind] = mapped_column(_enum_column(MediaKind, 10), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ModerationStatus] = mapped_column(
        _enum_column(ModerationStatus, 20), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    uploaded_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_media_uploaded_by_user_id_users"),
        nullable=False,
    )
    moderation_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    moderation_retry_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    @property
    def large_key(self) -> str:
        return f"{self.storage_key}/w1600.webp"

    @property
    def thumb_key(self) -> str:
        return f"{self.storage_key}/w400.webp"

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `storage_key`, never the surrogate id."""
        if not isinstance(other, Media):
            return NotImplemented
        return self.storage_key == other.storage_key

    def __hash__(self) -> int:
        return hash(self.storage_key)
