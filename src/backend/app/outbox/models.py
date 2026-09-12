"""`app.outbox`: the generic transactional-outbox table. A row is staged in
the same `AsyncSession`/`db.commit()` as the aggregate write that produced it
(see `app.outbox.service.append`), then later claimed and dispatched by
`app.outbox.dispatcher` to whatever handlers a consuming vertical registered
for its `event_type` (see `app.outbox.registry`).

`event_type` and `payload` are plain strings/JSON — this module never imports
another vertical, which is the whole point: producers and consumers agree on
an event-type string and a payload shape, never on each other's modules."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class OutboxStatus(enum.StrEnum):
    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"


class OutboxEntry(BaseEntity):
    __tablename__ = "outbox_entries"
    __sequence_name__ = "outbox_entry_seq"

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[OutboxStatus] = mapped_column(
        _enum_column(OutboxStatus, 20), nullable=False, default=OutboxStatus.PENDING
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
