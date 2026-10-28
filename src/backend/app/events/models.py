"""`app.events` models (migration 0070). Cross-module references
(`parties.id`, `locations.id`) are plain FK-id columns, and the module
declares no `relationship()` at all, per `standards/backend/models.md`.

`starts_at`/`ends_at` are naive Europe/Warsaw wall-clock times; every other
timestamp is naive UTC (`standards/backend/time.md`)."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, text
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


class Event(BaseEntity):
    __tablename__ = "events"

    author_party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_events_author_party_id_parties"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("locations.id", name="fk_events_location_id_locations"),
        nullable=True,
    )

    def __eq__(self, other: Any) -> bool:
        """No natural unique key exists (name and start may repeat), so the
        business key is the immutable author plus creation time."""
        if not isinstance(other, Event):
            return NotImplemented
        return (self.author_party_id, self.created_at) == (other.author_party_id, other.created_at)

    def __hash__(self) -> int:
        return hash((self.author_party_id, self.created_at))


class EventBanner(BaseEntity):
    """The event's single banner. Its files (under `storage_key`:
    `/w1600.webp`, `/w400.webp`) are public; a replacement deletes the old
    row and stages an outbox delete of its files."""

    __tablename__ = "event_banners"
    __table_args__ = (UniqueConstraint("event_id", name="uq_event_banners_event_id"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("events.id", name="fk_event_banners_event_id_events"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ModerationStatus] = mapped_column(
        _enum_column(ModerationStatus, 20), nullable=False
    )

    @property
    def large_key(self) -> str:
        return f"{self.storage_key}/w1600.webp"

    @property
    def thumb_key(self) -> str:
        return f"{self.storage_key}/w400.webp"

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `storage_key`, never the surrogate id."""
        if not isinstance(other, EventBanner):
            return NotImplemented
        return self.storage_key == other.storage_key

    def __hash__(self) -> int:
        return hash(self.storage_key)


class EventAttendance(BaseEntity):
    """A sign-up for one event, shaped like `app.groups.models.TermAttendance`
    but without `child_count`. Nothing reads or writes it yet."""

    __tablename__ = "event_attendances"
    __table_args__ = (
        Index("ix_event_attendances_event_id", "event_id"),
        Index(
            "uq_event_attendances_event_id_party_id",
            "event_id",
            "party_id",
            unique=True,
            postgresql_where=text("withdrawn_at IS NULL"),
        ),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("events.id", name="fk_event_attendances_event_id_events"),
        nullable=False,
    )
    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_event_attendances_party_id_parties"),
        nullable=False,
    )
    # `NULL` = active sign-up; non-null (naive UTC) = withdrawn.
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    def __eq__(self, other: Any) -> bool:
        """`(event_id, party_id)` alone repeats across a withdrawn and a later
        sign-up, and `withdrawn_at` changes, so `created_at` completes the key."""
        if not isinstance(other, EventAttendance):
            return NotImplemented
        return (self.event_id, self.party_id, self.created_at) == (
            other.event_id,
            other.party_id,
            other.created_at,
        )

    def __hash__(self) -> int:
        return hash((self.event_id, self.party_id, self.created_at))
