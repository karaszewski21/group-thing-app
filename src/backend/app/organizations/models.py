"""`app.organizations` bounded context: a self-standing brand identity
(`Organization` — name + optional custom colors) owned by an ORGANIZER,
deliberately separate from `app.groups.Group` (a Circle). One ORGANIZER may
lead many Circles (see `app.groups`'s `GroupRole`/`Leadership` docstrings)
but has at most one Organization — this module mirrors `app.groups`'s
Party -> Role -> Membership shape exactly (per `standards/backend/models.md`
and the Party archetype) for consistency, even though the cardinality here
is 1:1 rather than groups' 1:N, since the same person may still want to
transfer/end organization ownership later without a schema change.

Cross-module references (`parties.id`) are plain FK-id columns, never a
`relationship()` crossing the module boundary, per
`standards/backend/models.md`."""

from __future__ import annotations

import enum
import re
from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity

_HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class OrganizationRoleType(enum.StrEnum):
    """`OWNER` here is the organizations-BC-scoped capacity that
    `OrganizationMembership.from_role_id` references — distinct from
    `app.users.models.UserRoleType.ORGANIZATOR` (the global "may found
    Circles/Organizations at all" declaration) and from
    `app.groups.models.GroupRoleType.ORGANIZATOR` (a Circle-scoped
    capacity). Kept as its own single-member enum (rather than reusing
    `ORGANIZATOR`) so a future collaborative-ownership feature has room to
    add e.g. `EDITOR` without colliding with either sibling module's type."""

    OWNER = "OWNER"


class Organization(BaseEntity):
    """A self-service brand identity: name + optional custom colors for the
    organization's own profile page. `primary_color`/`accent_color` are
    `#rrggbb` hex strings, validated both here (DB `CHECK`) and in
    `schemas.py` (Pydantic pattern) — deliberately simple flat columns
    rather than a separate branding table, mirroring `Group`'s own
    "just a name" simplicity (see `app.groups.models.Group`).

    `slug` is the public page's URL segment (`domena.pl/<slug>`),
    generated once from `name` at creation time (see
    `service._generate_unique_slug`, `slugs.slugify`) and never
    regenerated on rename, so a shared link stays valid even after the
    organizer changes their display name."""

    __tablename__ = "organizations"
    __sequence_name__ = "organization_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_organizations_party_id_parties"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    primary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(7), nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"primary_color IS NULL OR primary_color ~ '{_HEX_COLOR_PATTERN.pattern}'",
            name="ck_organizations_primary_color_hex",
        ),
        CheckConstraint(
            f"accent_color IS NULL OR accent_color ~ '{_HEX_COLOR_PATTERN.pattern}'",
            name="ck_organizations_accent_color_hex",
        ),
    )


class OrganizationRole(BaseEntity):
    """A person's capacity toward the organizations BC. No scope column (no
    "which Organization") — the specific Organization binding lives on
    `OrganizationMembership`, not here; see module docstring."""

    __tablename__ = "organization_roles"
    __sequence_name__ = "organization_role_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_organization_roles_party_id_parties"),
        nullable=False,
    )
    role_type: Mapped[OrganizationRoleType] = mapped_column(
        _enum_column(OrganizationRoleType, 20), nullable=False
    )
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)


class OrganizationMembership(BaseEntity):
    """`OrganizationRole(OWNER)` -> `Organization`. At most one active
    (`valid_to IS NULL`) row per `from_role_id` — enforced by a partial
    unique index in the migration — matching this module's 1:1 cardinality
    decision (unlike `app.groups.Leadership`'s inverse 1:N constraint,
    which caps active leaders per *Circle*, not per person)."""

    __tablename__ = "organization_memberships"
    __sequence_name__ = "organization_membership_seq"

    from_role_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "organization_roles.id", name="fk_organization_memberships_from_role_id_organization_roles"
        ),
        nullable=False,
    )
    to_organization_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "organizations.id", name="fk_organization_memberships_to_organization_id_organizations"
        ),
        nullable=False,
    )
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)
