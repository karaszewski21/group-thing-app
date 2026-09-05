"""`app.families` bounded context: a household (`Family`), the person-side
roles played toward it (`FamilyRole`: guardian or child), and the
membership relationship binding a role instance to a specific Family
(`FamilyMembership`), which also carries the "primary contact" flag used
as the identity bridge into `app.circulation` (a `Reservation.reserved_by`
must resolve to a single `User`, never a `Group`/Family).

`family_memberships` lives in this module because it owns the invariant it
enforces — "at most one active primary contact per Family".

Cross-module references (`parties.id`) are plain FK-id columns, never a
`relationship()` crossing the module boundary, per
`standards/backend/models.md`."""

from __future__ import annotations

import enum
from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, Enum, ForeignKey, String
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


class FamilyRoleType(enum.StrEnum):
    """`CHILD` is a supported-but-currently-unused value: nothing in this
    codebase creates a `Person`/`UserProfile` for a child today (a family's
    children are, where they appear at all, free text elsewhere), so no
    service function ever assigns it yet — kept only so the schema doesn't
    need a migration the day a real "child as its own Party" feature is
    requested."""

    GUARDIAN = "GUARDIAN"
    CHILD = "CHILD"


class Family(BaseEntity):
    __tablename__ = "families"
    __sequence_name__ = "family_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("parties.id", name="fk_families_party_id_parties"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class FamilyRole(BaseEntity):
    """A person's capacity toward the families BC. No scope column (no
    "which Family") — the specific Family binding lives on
    `FamilyMembership`, not here."""

    __tablename__ = "family_roles"
    __sequence_name__ = "family_role_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_family_roles_party_id_parties"),
        nullable=False,
    )
    role_type: Mapped[FamilyRoleType] = mapped_column(
        _enum_column(FamilyRoleType, 20), nullable=False
    )
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)


class FamilyMembership(BaseEntity):
    """`FamilyRole` -> `Family`. `is_primary_contact` is only ever set on a
    row whose `FamilyRole.role_type == GUARDIAN` (enforced in
    `service.py`, not by the DB — the partial unique index below only
    needs this table's own columns, so it doesn't need to know the
    referenced role's type to enforce "at most one active primary contact
    per Family")."""

    __tablename__ = "family_memberships"
    __sequence_name__ = "family_membership_seq"

    from_role_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("family_roles.id", name="fk_family_memberships_from_role_id_family_roles"),
        nullable=False,
    )
    to_family_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("families.id", name="fk_family_memberships_to_family_id_families"),
        nullable=False,
    )
    is_primary_contact: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)
