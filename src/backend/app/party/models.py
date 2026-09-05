"""`Party` — the thin, global identity anchor for the Organizer/Circle/
Family domain. Every other bounded context (`app.users`, `app.groups`,
`app.families`) cross-references a `Party` row via a plain `party_id`
FK-id column (never a `relationship()` crossing the module boundary, per
`standards/backend/models.md`'s Cross-Module References section) and owns
its own business data and roles independently.

`Party` itself carries no business data and no roles — see
`standards/backend/models.md`'s "Identity Is Not Role" precedent: identity
(this table) is deliberately kept separate from what a party currently does
(each BC's own `*_roles` table) and from who it is in domain terms (each
BC's own profile/entity table).
"""

from __future__ import annotations

import enum

from sqlalchemy import Boolean, Enum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """A `String`-backed column for a `StrEnum` that actually round-trips as
    the enum type on read, not a bare `str` — `native_enum=False` keeps the
    DDL a plain `VARCHAR` (matches `standards/backend/models.md`'s "stored
    as a String column, never ordinal"; no Postgres native enum type is
    created), while `values_callable` stores/reads each member's `.value`
    rather than SQLAlchemy's own `Enum` default of `.name`."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class PartyType(enum.StrEnum):
    PERSON = "PERSON"
    ORGANIZATION = "ORGANIZATION"


class Party(BaseEntity):
    """The global identifier. `active=False` deactivates the whole identity
    (independent of any single BC's role validity, which tracks "is this
    specific capacity active" — see `app.users.models.UserRole`, `app.
    groups.models.GroupRole`, `app.families.models.FamilyRole`)."""

    __tablename__ = "parties"
    __sequence_name__ = "party_seq"

    party_type: Mapped[PartyType] = mapped_column(_enum_column(PartyType, 20), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
