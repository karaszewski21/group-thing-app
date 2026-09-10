"""`app.groups` bounded context: Circles (`Group`), the person-side roles
played toward a Circle (`GroupRole`), the two relationships built on those
roles (`Leadership`, `Membership`), and the Term/NeededItem/Pledge bridge
into `app.circulation` (unchanged contract — see `Pledge`'s docstring).

`leaderships` lives in this module (not `app.users`) because this module
owns the invariant it enforces — "at most one active leader per Circle" —
per this domain's relationship-ownership rule: a relationship table lives
wherever the invariant it protects belongs.

Cross-module references (`parties.id`, `products.id`) are plain FK-id
columns, never a `relationship()` crossing the module boundary, per
`standards/backend/models.md`."""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Enum, ForeignKey, Integer, String
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


class GroupRoleType(enum.StrEnum):
    """`ORGANIZATOR` here is the groups-BC-scoped capacity that
    `Leadership.from_role_id` references — distinct from
    `app.users.models.UserRoleType.ORGANIZATOR`, which is the global,
    users-BC-owned "may found Circles at all" declaration. The same active
    `ORGANIZATOR` `GroupRole` row may back several concurrent `Leadership`
    rows (one person may lead many Circles)."""

    MEMBER = "MEMBER"
    ORGANIZATOR = "ORGANIZATOR"


class PledgeStatus(enum.StrEnum):
    OPEN = "OPEN"
    CLAIMED = "CLAIMED"
    WITHDRAWN = "WITHDRAWN"
    FULFILLED = "FULFILLED"


class Group(BaseEntity):
    """A class/activity Circle."""

    __tablename__ = "groups"
    __sequence_name__ = "group_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("parties.id", name="fk_groups_party_id_parties"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class GroupRole(BaseEntity):
    """A person's capacity toward the groups BC. No scope column (no
    "which Circle") — the specific Circle binding lives on `Leadership`/
    `Membership`, not here; see module docstring."""

    __tablename__ = "group_roles"
    __sequence_name__ = "group_role_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("parties.id", name="fk_group_roles_party_id_parties"), nullable=False
    )
    role_type: Mapped[GroupRoleType] = mapped_column(
        _enum_column(GroupRoleType, 20), nullable=False
    )
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)


class Leadership(BaseEntity):
    """`GroupRole(ORGANIZATOR)` -> `Group`, strictly 1:N: at most one row
    with `valid_to IS NULL` per `to_group_id` (enforced by a partial unique
    index in the migration, not just application logic)."""

    __tablename__ = "leaderships"
    __sequence_name__ = "leadership_seq"

    from_role_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("group_roles.id", name="fk_leaderships_from_role_id_group_roles"),
        nullable=False,
    )
    to_group_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("groups.id", name="fk_leaderships_to_group_id_groups"),
        nullable=False,
    )
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)


class Membership(BaseEntity):
    """`GroupRole(MEMBER)` -> `Group`, N:N: many simultaneously-active rows
    per `from_role_id`/`to_group_id` are allowed (no uniqueness
    constraint, unlike `Leadership`). Connects an individual family
    member's `GroupRole`, not the family as a whole — see
    `app.families.models.FamilyMembership` for family-side membership."""

    __tablename__ = "memberships"
    __sequence_name__ = "membership_seq"

    from_role_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("group_roles.id", name="fk_memberships_from_role_id_group_roles"),
        nullable=False,
    )
    to_group_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("groups.id", name="fk_memberships_to_group_id_groups"),
        nullable=False,
    )
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)


class Term(BaseEntity):
    """A concrete class/meeting occurrence for a Circle."""

    __tablename__ = "terms"
    __sequence_name__ = "term_seq"

    circle_group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("groups.id", name="fk_terms_circle_group_id_groups"), nullable=False
    )
    # Date *and* wall-clock start time of the class (the time matters to
    # guardians — "which hour do we show up?"). Naive local datetime, same
    # convention as `created_at`/`updated_at`.
    occurs_on: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)


class NeededItem(BaseEntity):
    """A structured "we need X for this Term" request: a reference to a
    concrete `app.product` catalog entry (`product_id`, a plain cross-module
    FK-id per `standards/backend/models.md`) plus an optional free-text
    refinement (`description` — e.g. "rozmiar 1/2", "czerwona")."""

    __tablename__ = "needed_items"
    __sequence_name__ = "needed_item_seq"

    term_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("terms.id", name="fk_needed_items_term_id_terms"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", name="fk_needed_items_product_id_products"),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class Pledge(BaseEntity):
    """ "I'll bring it" declaration bridging a Party to a NeededItem.
    Converts into a `circulation.Reservation` only once a concrete
    `InventoryItem` is registered. `pledged_by_party_id` is a cross-module
    reference straight to `parties.id` (not to any one BC's role/profile
    table) — the pledging identity, resolved to a `users.id` via
    `app.users.service.get_profile_by_party` only at the fulfillment step,
    where `app.circulation` actually needs a raw account id."""

    __tablename__ = "pledges"
    __sequence_name__ = "pledge_seq"

    needed_item_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("needed_items.id", name="fk_pledges_needed_item_id_needed_items"),
        nullable=False,
    )
    pledged_by_party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_pledges_pledged_by_party_id_parties"),
        nullable=False,
    )
    status: Mapped[PledgeStatus] = mapped_column(_enum_column(PledgeStatus, 20), nullable=False)
    # Deliberate loose reference into `app.circulation.Reservation` — no FK,
    # mirrors `app.plugin.models.PluginObject.entity_id`'s precedent for a
    # cross-bounded-context pointer.
    resolved_reservation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class TermAttendance(BaseEntity):
    """A single-term RSVP — deliberately not a GroupRole/Membership (a
    circle-wide, standing capacity); this is scoped to exactly one Term,
    per scope-clarifications.md Decision #1. `party_id` may point at either
    a fully-registered UserProfile's party (an already-logged-in guardian
    RSVPing from the authenticated app — not built by this task, but not
    precluded either) or, in the anonymous-RSVP case this task builds, a
    freshly-created Party with an account_user_id=None UserProfile — see
    app.families.service.create_lightweight_family_member's identical
    shape."""

    __tablename__ = "term_attendances"
    __sequence_name__ = "term_attendance_seq"

    term_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("terms.id", name="fk_term_attendances_term_id_terms"), nullable=False
    )
    party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_term_attendances_party_id_parties"),
        nullable=False,
    )
    child_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
