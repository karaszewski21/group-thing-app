"""Who sees what, as unexecuted SQL: one predicate per subject (items, terms,
groups) for a viewer party (`None` = guest) and a scope. `ALL` is
"Wszędzie", `MINE` is "Moje grupy": only what reaches the viewer through a
group they are in (`group_ids_for`), plus their counterparty and own items.
Soft-deleted groups never count, an RSVP or a family relation never counts.

"Listed only" is not part of `items_visible_to`: the item 404 gate
(`can_view_item`) keeps reaching reserved, given-away and lent items, and a
search starts from the listed items itself."""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import ColumnElement, ScalarSelect, exists, or_, select
from sqlalchemy.orm import aliased

from app.users.models import UserProfile

from ..models import (
    Group,
    GroupVisibility,
    ItemListingPreference,
    ItemVisibility,
    SwapProposal,
    SwapProposalStatus,
    Term,
)
from .inventory_bridge import Reservation, ReservationStatus
from .membership import Parties, group_ids_for

_OPEN_RESERVATION_STATUSES = (ReservationStatus.PENDING, ReservationStatus.CONFIRMED)


class VisibilityScope(enum.StrEnum):
    ALL = "all"
    MINE = "mine"


def parties_share_group(
    party: Parties, other_party: uuid.UUID, *, private_only: bool = False
) -> ColumnElement[bool]:
    """`party` (a party id or a correlated column) and `other_party` are both
    in one live group (a PRIVATE one when `private_only`)."""
    shared = group_ids_for(party).where(Group.id.in_(group_ids_for(other_party)))
    if private_only:
        shared = shared.where(Group.visibility == GroupVisibility.PRIVATE)
    return shared.exists()


def owner_shares_group_with(
    viewer: uuid.UUID, *, private_only: bool = False
) -> ColumnElement[bool]:
    """Over `ItemListingPreference`: the item's owner and `viewer` are both
    in one live group (a PRIVATE one when `private_only`)."""
    return parties_share_group(
        ItemListingPreference.owner_party_id, viewer, private_only=private_only
    )


def _account_user_id(party_id: uuid.UUID) -> ScalarSelect[uuid.UUID | None]:
    return (
        select(UserProfile.account_user_id)
        .where(UserProfile.party_id == party_id)
        .scalar_subquery()
    )


def _is_counterparty(viewer: uuid.UUID) -> ColumnElement[bool]:
    """`viewer` is the reserver or the giver of an open reservation on the
    item, or the proposer of a pending swap proposal on it."""
    viewer_user = _account_user_id(viewer)
    reserved = select(Reservation.item_id).where(
        Reservation.status.in_(_OPEN_RESERVATION_STATUSES),
        or_(
            Reservation.reserved_by_user_id == viewer_user,
            Reservation.giver_user_id == viewer_user,
        ),
    )
    proposed = select(SwapProposal.listing_item_id).where(
        SwapProposal.status == SwapProposalStatus.PROPOSED,
        SwapProposal.proposer_party_id == viewer,
    )
    return or_(
        ItemListingPreference.item_id.in_(reserved),
        ItemListingPreference.item_id.in_(proposed),
    )


def items_visible_to(viewer: uuid.UUID | None, scope: VisibilityScope) -> ColumnElement[bool]:
    """Predicate over `ItemListingPreference`: the viewer may see the item.
    A guest sees PUBLIC items only, whatever the scope. A PRIVATE item needs a shared live
    PRIVATE group; in `MINE` a PUBLIC one needs a shared live group of any
    visibility. Counterparty and own items are visible in both scopes."""
    public = ItemListingPreference.visibility == ItemVisibility.PUBLIC
    if viewer is None:
        return public
    private = ItemListingPreference.visibility == ItemVisibility.PRIVATE
    reached_public = (
        public if scope == VisibilityScope.ALL else public & owner_shares_group_with(viewer)
    )
    return or_(
        reached_public,
        private & owner_shares_group_with(viewer, private_only=True),
        _is_counterparty(viewer),
        ItemListingPreference.owner_party_id == viewer,
    )


def _groups_visible(
    group: type[Group], viewer: uuid.UUID | None, scope: VisibilityScope
) -> ColumnElement[bool]:
    public = group.visibility == GroupVisibility.PUBLIC
    if viewer is None:
        return public
    joined = group.id.in_(group_ids_for(viewer))
    return or_(public, joined) if scope == VisibilityScope.ALL else joined


def groups_visible_to(viewer: uuid.UUID | None, scope: VisibilityScope) -> ColumnElement[bool]:
    """Predicate over `Group`: never a soft-deleted group; in `ALL` a PUBLIC
    group or one the viewer is in, in `MINE` only one the viewer is in. A
    guest sees PUBLIC groups, whatever the scope."""
    return Group.deleted_at.is_(None) & _groups_visible(Group, viewer, scope)


def terms_visible_to(viewer: uuid.UUID | None, scope: VisibilityScope) -> ColumnElement[bool]:
    """Predicate over `Term`: its circle is visible by `groups_visible_to`.
    No date filter."""
    circle = aliased(Group)
    return exists().where(
        circle.id == Term.circle_group_id,
        circle.deleted_at.is_(None),
        _groups_visible(circle, viewer, scope),
    )
