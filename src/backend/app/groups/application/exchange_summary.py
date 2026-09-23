""""Udostępnia rzecz"/"przynosi na zajęcia" aggregation for a Circle's
current Term (`PrivateKragGrupyView`'s family cards). Deliberately its own
module (not folded into the already-large `term_item_listings.py`) — see
spec.md's Phase-1 Q3 decision.

Current-Term selection here mirrors `useKragGrupy.ts`'s `terms[0]` (the
*newest* Term, `occurs_on DESC`) — **not** `public_view.py`'s
`min(upcoming, key=occurs_on)` (nearest *upcoming* Term). Those are two
genuinely different algorithms picked for two different screens; this
module backs the private, `useKragGrupy`-driven screen, so it must match
that one, per spec.md's HIGH-severity audit finding.

Cross-BC family resolution reads `app.families.models` directly (plain
joins on FK-id columns, no `relationship()`), the same pattern
`app.families.repository` already uses in the opposite direction for
`app.groups` tables — importing `app.families.service`/`repository` here
instead would reintroduce the exact import cycle those modules already
work around (`app.families.repository` imports `app.groups.service`)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.families.models import FamilyMembership, FamilyRole, FamilyRoleType

from ..infrastructure import repository
from ..models import GroupRole, NeededItem, Pledge, PledgeStatus, Term
from ..schemas import (
    FamilyExchangeDetailResponse,
    FamilyExchangeOffer,
    FamilyExchangeSummary,
    GroupExchangeSummaryResponse,
)
from .circles import _group_role_party_id, get_current_leadership, get_group
from .term_item_listings import (
    _is_item_available,
    _list_eligible_lister_party_ids,
    _resolve_item_display_info,
)


async def _get_current_term(db: AsyncSession, group_id: int) -> Term | None:
    """The `useKragGrupy.ts` "current term": the *newest* Term for this
    Circle (`occurs_on DESC`, first row) — deliberately not the nearest
    *upcoming* one `public_view.py` picks. See module docstring."""
    result = await db.execute(
        select(Term).where(Term.circle_group_id == group_id).order_by(Term.occurs_on.desc()).limit(1)
    )
    return result.scalars().first()


async def _ordered_group_member_party_ids(db: AsyncSession, group_id: int) -> list[int]:
    """Every party currently holding an active `Membership` in `group_id`,
    in `Membership` order (`valid_from DESC`, per
    `repository.list_active_memberships_for_group`), deduplicated keeping
    first occurrence — mirrors `resolveFamiliesForMemberships`'s own
    Membership-order-preserving traversal on the frontend. One batched
    `IN (...)` for the `GroupRole` -> `party_id` resolution, no per-Membership
    query."""
    memberships = await repository.list_active_memberships_for_group(db, group_id)
    role_ids = [m.from_role_id for m in memberships]
    if not role_ids:
        return []
    roles = (await db.execute(select(GroupRole).where(GroupRole.id.in_(role_ids)))).scalars().all()
    role_to_party = {role.id: role.party_id for role in roles}

    seen: set[int] = set()
    ordered: list[int] = []
    for membership in memberships:
        party_id = role_to_party.get(membership.from_role_id)
        if party_id is not None and party_id not in seen:
            seen.add(party_id)
            ordered.append(party_id)
    return ordered


async def _require_group_member_or_leader(
    db: AsyncSession, group_id: int, viewer_party_id: int, member_party_ids: list[int]
) -> None:
    """Membership/leadership check that can't live in the coarse
    `AUTHORIZATION_MATRIX` — per `standards/backend/security.md`. Takes the
    caller's already-resolved `member_party_ids` (from
    `_ordered_group_member_party_ids`) so this reuses that query instead of
    running it twice."""
    if viewer_party_id in member_party_ids:
        return
    leadership = await get_current_leadership(db, group_id)
    if leadership is not None and await _group_role_party_id(db, leadership.from_role_id) == viewer_party_id:
        return
    raise AccessDeniedException


async def _resolve_family_guardians(
    db: AsyncSession, party_ids: list[int]
) -> tuple[list[int], dict[int, list[int]]]:
    """`(family_order, family_id -> guardian_party_ids)` for `party_ids`
    (the group's members): `family_order` lists every Family reachable from
    `party_ids` through an active `FamilyMembership` (any role — a member
    whose only active family role is CHILD still identifies their Family,
    per the "family without an active GUARDIAN" edge case, spec.md Section
    8.1), in first-occurrence order; `family_id -> guardian_party_ids` keeps
    only the GUARDIAN-role party ids (possibly empty for a given family — a
    caller must not crash on that, just treat it as "nobody to check").
    One batched `IN (...)` query, no N+1."""
    if not party_ids:
        return [], {}

    rows = await db.execute(
        select(FamilyMembership.to_family_id, FamilyRole.party_id, FamilyRole.role_type)
        .join(FamilyRole, FamilyMembership.from_role_id == FamilyRole.id)
        .where(FamilyRole.party_id.in_(party_ids), FamilyMembership.valid_to.is_(None))
    )
    party_to_family: dict[int, int] = {}
    family_guardians: dict[int, list[int]] = {}
    for family_id, party_id, role_type in rows.all():
        party_to_family.setdefault(party_id, family_id)
        if role_type == FamilyRoleType.GUARDIAN:
            family_guardians.setdefault(family_id, []).append(party_id)

    seen_families: set[int] = set()
    family_order: list[int] = []
    for party_id in party_ids:
        family_id = party_to_family.get(party_id)
        if family_id is not None and family_id not in seen_families:
            seen_families.add(family_id)
            family_order.append(family_id)
    return family_order, family_guardians


async def _guardian_party_ids_for_family(db: AsyncSession, family_id: int) -> set[int]:
    """Every party currently holding an active GUARDIAN `FamilyMembership`
    for `family_id` — may be empty (see `_resolve_family_guardians`'s
    docstring)."""
    result = await db.execute(
        select(FamilyRole.party_id)
        .join(FamilyMembership, FamilyMembership.from_role_id == FamilyRole.id)
        .where(
            FamilyMembership.to_family_id == family_id,
            FamilyRole.role_type == FamilyRoleType.GUARDIAN,
            FamilyMembership.valid_to.is_(None),
        )
    )
    return set(result.scalars().all())


async def _pledging_party_ids(
    db: AsyncSession, term: Term | None, guardian_party_ids: set[int]
) -> set[int]:
    """Which of `guardian_party_ids` have an active (`status != WITHDRAWN`
    — the same "active" `list_needed_item_views`/`_needed_item_view` use)
    `Pledge` on one of `term`'s live needs. One batched `IN (...)` query for
    every guardian party in the group at once — callers filter per family
    in memory, per `standards/backend/queries.md`."""
    if term is None or not guardian_party_ids:
        return set()
    result = await db.execute(
        select(Pledge.pledged_by_party_id)
        .join(NeededItem, Pledge.needed_item_id == NeededItem.id)
        .where(
            NeededItem.term_id == term.id,
            NeededItem.deleted_at.is_(None),
            Pledge.status != PledgeStatus.WITHDRAWN,
            Pledge.pledged_by_party_id.in_(guardian_party_ids),
        )
    )
    return set(result.scalars().all())


async def _sharing_party_ids(
    db: AsyncSession, term: Term | None, guardian_party_ids: set[int]
) -> set[int]:
    """Which of `guardian_party_ids` currently have a takeable exchange-
    mechanism offer for `term`: eligible to list for this Term
    (`_list_eligible_lister_party_ids`) **and** their listed item is still
    `AVAILABLE` (`_is_item_available`) — the same "active" definition
    `list_browsable_term_item_listings` uses. One batched `IN (...)` fetch
    of `ItemListingPreference` rows (`repository.
    list_item_listing_preferences_for_parties`), then a bounded per-listing-
    item availability check (same precedent as `_build_listing_views`)."""
    if term is None or not guardian_party_ids:
        return set()
    eligible_party_ids = await _list_eligible_lister_party_ids(db, term)
    relevant_party_ids = eligible_party_ids & guardian_party_ids
    if not relevant_party_ids:
        return set()
    preferences = await repository.list_item_listing_preferences_for_parties(db, relevant_party_ids)
    sharing: set[int] = set()
    for preference in preferences:
        if await _is_item_available(db, preference.item_id):
            sharing.add(preference.owner_party_id)
    return sharing


async def get_group_exchange_summary(
    db: AsyncSession, group_id: int, viewer_party_id: int
) -> GroupExchangeSummaryResponse:
    """`shares_item`/`brings_item` for every family currently in `group_id`,
    for its current Term (see module docstring for "current"). Raises
    `AccessDeniedException` unless `viewer_party_id` is a member or the
    active leader of `group_id`."""
    await get_group(db, group_id)
    member_party_ids = await _ordered_group_member_party_ids(db, group_id)
    await _require_group_member_or_leader(db, group_id, viewer_party_id, member_party_ids)

    family_order, family_guardians = await _resolve_family_guardians(db, member_party_ids)
    all_guardian_party_ids = {
        party_id for guardians in family_guardians.values() for party_id in guardians
    }

    term = await _get_current_term(db, group_id)
    pledging_party_ids = await _pledging_party_ids(db, term, all_guardian_party_ids)
    sharing_party_ids = await _sharing_party_ids(db, term, all_guardian_party_ids)

    families = [
        FamilyExchangeSummary(
            family_id=family_id,
            shares_item=bool(set(family_guardians.get(family_id, ())) & sharing_party_ids),
            brings_item=bool(set(family_guardians.get(family_id, ())) & pledging_party_ids),
        )
        for family_id in family_order
    ]
    return GroupExchangeSummaryResponse(families=families)


async def get_family_exchange_offers(
    db: AsyncSession, group_id: int, family_id: int, viewer_party_id: int
) -> FamilyExchangeDetailResponse:
    """Every active exchange-mechanism offer from any guardian of
    `family_id`, for `group_id`'s current Term. `family_id` must have an
    active `Membership` in `group_id` (via one of its guardians) — a
    family from another Circle, or a family currently with no active
    guardian at all, is a 404, not a silently-empty list."""
    await get_group(db, group_id)
    member_party_ids = set(await _ordered_group_member_party_ids(db, group_id))
    await _require_group_member_or_leader(db, group_id, viewer_party_id, list(member_party_ids))

    guardian_party_ids = await _guardian_party_ids_for_family(db, family_id)
    if not guardian_party_ids & member_party_ids:
        raise EntityNotFoundException("Family", family_id)

    term = await _get_current_term(db, group_id)
    if term is None:
        return FamilyExchangeDetailResponse(family_id=family_id, offers=[])

    eligible_party_ids = await _list_eligible_lister_party_ids(db, term)
    relevant_party_ids = eligible_party_ids & guardian_party_ids
    preferences = (
        await repository.list_item_listing_preferences_for_parties(db, relevant_party_ids)
        if relevant_party_ids
        else []
    )
    available = [pref for pref in preferences if await _is_item_available(db, pref.item_id)]
    item_info = await _resolve_item_display_info(db, {pref.item_id for pref in available})

    offers = [
        FamilyExchangeOffer(
            id=pref.item_id,
            item_id=pref.item_id,
            product_name=item_info[pref.item_id][0],
            condition=item_info[pref.item_id][1],
            offered_types=[pref.mode],
        )
        for pref in available
        if pref.item_id in item_info
    ]
    return FamilyExchangeDetailResponse(family_id=family_id, offers=offers)
