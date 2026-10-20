"""`Location` entity. The owner is a plain FK-id to `parties.id` (no
`relationship()` across the module boundary). No `__eq__`/`__hash__`: a
location has no natural business key."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.dialects import postgresql
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


class LocationSource(enum.StrEnum):
    GOOGLE = "GOOGLE"
    MANUAL = "MANUAL"


class Location(BaseEntity):
    __tablename__ = "locations"

    owner_party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_locations_owner_party_id_parties"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    formatted_address: Mapped[str] = mapped_column(String(500), nullable=False)
    google_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[LocationSource] = mapped_column(
        _enum_column(LocationSource, 10), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
