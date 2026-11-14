"""`Location` entity and the TERYT locality dictionary (`Locality`,
`LocalityPostalCode`). The owner is a plain FK-id to `parties.id` (no
`relationship()` across the module boundary); `Location.locality` is a
same-module `lazy="raise"` relationship, loaded only through
`service.load_location`/`load_locations_by_ids`. No `__eq__`/`__hash__`: a
location has no natural business key, and a locality's SIMC id PK is its
business key (the `PluginDescriptor` carve-out)."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.base_model import Base, BaseEntity


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


class LocalityKind(enum.StrEnum):
    TOWN = "TOWN"
    VILLAGE = "VILLAGE"


class Locality(Base):
    """An independent TERYT SIMC locality, seeded by migration 0079. The
    7-character SIMC id is a natural string PK on plain `Base`.
    `name_search` is `localities.fold_polish(name)` for prefix search.
    `lat`/`lng` are the locality's main point (WGS 84, seeded by 0098),
    null for the few localities the source register has no point for."""

    __tablename__ = "localities"
    __table_args__ = (
        CheckConstraint("kind IN ('TOWN', 'VILLAGE')", name="ck_localities_kind"),
        CheckConstraint("(lat IS NULL) = (lng IS NULL)", name="ck_localities_coordinates"),
        Index(
            "ix_localities_name_search",
            "name_search",
            postgresql_ops={"name_search": "text_pattern_ops"},
        ),
    )

    id: Mapped[str] = mapped_column(String(7), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    name_search: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[LocalityKind] = mapped_column(_enum_column(LocalityKind, 10), nullable=False)
    gmina: Mapped[str] = mapped_column(String(100), nullable=False)
    powiat: Mapped[str] = mapped_column(String(100), nullable=False)
    voivodeship: Mapped[str] = mapped_column(String(50), nullable=False)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)


class LocalityPostalCode(Base):
    __tablename__ = "locality_postal_codes"
    __table_args__ = (
        Index(
            "ix_locality_postal_codes_postal_code",
            "postal_code",
            postgresql_ops={"postal_code": "varchar_pattern_ops"},
        ),
    )

    postal_code: Mapped[str] = mapped_column(String(6), primary_key=True)
    locality_id: Mapped[str] = mapped_column(
        String(7),
        ForeignKey(
            "localities.id",
            name="fk_locality_postal_codes_locality_id_localities",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )


class Location(BaseEntity):
    __tablename__ = "locations"
    __table_args__ = (
        CheckConstraint(
            "(formatted_address IS NULL AND source IS NULL AND google_place_id IS NULL "
            "AND lat IS NULL AND lng IS NULL) "
            "OR (formatted_address IS NOT NULL AND source IS NOT NULL)",
            name="ck_locations_address_fields",
        ),
    )

    owner_party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_locations_owner_party_id_parties"),
        nullable=False,
        index=True,
    )
    locality_id: Mapped[str] = mapped_column(
        String(7),
        ForeignKey(
            "localities.id", name="fk_locations_locality_id_localities", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    locality: Mapped[Locality] = relationship(lazy="raise")
    formatted_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    google_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    source: Mapped[LocationSource | None] = mapped_column(
        _enum_column(LocationSource, 10), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    @property
    def label(self) -> str:
        """The place as one line: "Kęty, małopolskie" without an address,
        "Kęty — {address}" with one. Needs `locality` loaded (`lazy="raise"`)."""
        if self.formatted_address:
            return f"{self.locality.name} — {self.formatted_address}"
        return f"{self.locality.name}, {self.locality.voivodeship}"
