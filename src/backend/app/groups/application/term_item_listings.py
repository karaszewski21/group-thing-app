"""The `ItemListingPreference` set/list/browse/take use cases — the
exchange-mechanism counterpart to `pledge_fulfillment.py`'s Pledge->Reservation
bridge. Gated on `attendance._require_term_eligibility` (Term-scoped
attendance, or being the Term's Circle organizer) rather than Circle-wide
membership. Ownership validation for the item being offered (a `SWAP`
taker's own counter-offer) is the exact `inventory.owner_user_id ==
profile.account_user_id and inventory_type == PERSONAL` + `AVAILABLE`-balance
check `pledge_fulfillment.fulfill_pledge` already performs — factored here
into `_require_own_available_personal_item` so both call sites share it.

Listing membership itself ("does this item show up for this Term") and
listing status ("is it still takeable, who took it") are both derived, never
stored: a `ItemListingPreference` is a standing, Term-independent mode set
from `Moje rzeczy`; whether it's visible for a given Term follows from the
owner's `TermAttendance`/organizer status for that Term, and whether it's
still open follows from the item's live `InventoryBalance` and
`circulation.Reservation` history (`_resolve_listing_status`) — no
listing-owned status field, per `standards/global/minimal-implementation.md`."""

from __future__ import annotations

from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.users.service import (
    get_profile_by_account_user_id,
    get_profile_by_party,
    get_profile_by_principal,
)

from ..domain import confirm_race_rules
from ..infrastructure import circulation_bridge, notifications_bridge, product_bridge, repository
from ..infrastructure.notifications_bridge import NotificationKind
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import ItemListingPreference, SwapProposal, SwapProposalStatus, Term
from ..schemas import BrowseTermItemListingResponse, TakeTermItemListingRequest
from .attendance import _require_term_eligibility
from .circles import _group_role_party_id, get_current_leadership
from .terms import get_term

_ACTIVE_RESERVATION_STATUSES = (
    circulation_bridge.ReservationStatus.PENDING,
    circulation_bridge.ReservationStatus.CONFIRMED,
)


class TermAlreadyResolvedException(BusinessConflictException):
    """Raised by `confirm_transaction` when the *other* party to a
    swap/giveaway transaction already resolved it first — deliberately a
    distinct subclass (not a bare `BusinessConflictException`) so Group 5's
    router can catch it and map it to a distinct response shape
    (`ConfirmTransactionResponse.already_resolved`, per spec.md requirement
    3) instead of letting a generic, unexplained 409 surface."""

    def __init__(self) -> None:
        super().__init__("Ta transakcja została już rozstrzygnięta przez drugą stronę")


async def _require_own_available_personal_item(
    db: AsyncSession, account_user_id: int | None, item_id: int
) -> circulation_bridge.InventoryItem:
    """Identical check to `fulfill_pledge`'s `inventory_item_id` branch —
    used by a `SWAP` taker's own counter-offer, per spec.md's "reuse the
    ownership-check helper from listing-creation" (now reused from the
    preference-set path instead, see `set_item_listing_preference`)."""
    item = await circulation_bridge.get_item(db, item_id)
    inventory = await circulation_bridge.resolve_owning_inventory(db, item)
    if (
        inventory.owner_user_id != account_user_id
        or inventory.inventory_type != circulation_bridge.InventoryType.PERSONAL
    ):
        raise AccessDeniedException
    balance = await circulation_bridge.get_item_balance(db, cast(int, item.id))
    if balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException(
            "Nie można użyć tej rzeczy — jest zarezerwowana lub wypożyczona"
        )
    return item


async def set_item_listing_preference(
    db: AsyncSession,
    principal: Principal,
    item_id: int,
    mode: circulation_bridge.ReservationType | None,
) -> ItemListingPreference | None:
    """Sets, changes, or (when `mode` is `None`) clears the standing listing
    mode on one of the caller's own items. Ownership-only check (no
    availability requirement) — unlike taking a listing, expressing intent
    to lend/gift/swap an item shouldn't be blocked by its current balance."""
    profile = await get_profile_by_principal(db, principal)
    item = await circulation_bridge.get_item(db, item_id)
    inventory = await circulation_bridge.resolve_owning_inventory(db, item)
    if (
        inventory.owner_user_id != profile.account_user_id
        or inventory.inventory_type != circulation_bridge.InventoryType.PERSONAL
    ):
        raise AccessDeniedException

    existing = await repository.get_item_listing_preference(db, item_id)
    if mode is None:
        if existing is not None:
            await db.delete(existing)
            await db.commit()
        return None

    if existing is not None:
        existing.mode = mode.value
        preference = existing
    else:
        preference = ItemListingPreference(
            item_id=item_id, owner_party_id=profile.party_id, mode=mode.value
        )
        db.add(preference)
    await db.commit()
    await db.refresh(preference)
    return preference


async def list_my_item_listing_preferences(
    db: AsyncSession, principal: Principal
) -> list[ItemListingPreference]:
    """All of the caller's own standing preferences, Term-independent —
    used by `Moje rzeczy` to seed each item's mode toggle on load."""
    profile = await get_profile_by_principal(db, principal)
    return await repository.list_item_listing_preferences_for_party(db, profile.party_id)


async def _is_item_available(db: AsyncSession, item_id: int) -> bool:
    try:
        await circulation_bridge.get_item(db, item_id)
    except EntityNotFoundException:
        return False
    balance = await circulation_bridge.get_item_balance(db, item_id)
    return balance.status == circulation_bridge.BalanceStatus.AVAILABLE


async def _resolve_listing_status(db: AsyncSession, item_id: int) -> tuple[int | None, int | None]:
    """`(resolved_reservation_id, taken_by_party_id)` derived from the
    item's `Reservation` history: the active (`PENDING`/`CONFIRMED`) one if
    present, else the latest `FULFILLED` one, else `(None, None)` — still
    open. A lingering `CANCELLED`-only history also resolves to `(None,
    None)`, which is exactly "reopened" — no special-case handling needed
    since a cancelled reservation already put the balance back to
    `AVAILABLE`."""
    reservations = await circulation_bridge.list_reservations(db, item_id)
    active = [r for r in reservations if r.status in _ACTIVE_RESERVATION_STATUSES]
    chosen: circulation_bridge.Reservation | None
    if active:
        chosen = max(active, key=lambda r: cast(int, r.id))
    else:
        fulfilled = [
            r for r in reservations if r.status == circulation_bridge.ReservationStatus.FULFILLED
        ]
        chosen = max(fulfilled, key=lambda r: cast(int, r.id)) if fulfilled else None
    if chosen is None:
        # No `Reservation` yet on the listing item itself — but a `PROPOSED`
        # swap only locks the *proposer's* offered item at this stage (the
        # listing item's own leg isn't created until `accept_swap_proposal`),
        # so the reservation-history scan above alone would miss it and
        # wrongly report the listing as still open. Extends this function
        # rather than replacing it — an `ACCEPTED` swap already has a real
        # `Reservation` on the listing item, so it's already covered by the
        # `active` branch above and never reaches this fallback.
        swap_proposal = await repository.get_active_swap_proposal_for_listing_item(db, item_id)
        if swap_proposal is not None:
            return swap_proposal.proposer_reservation_id, swap_proposal.proposer_party_id
        return None, None
    taker_profile = await get_profile_by_account_user_id(db, chosen.reserved_by_user_id)
    return cast(int, chosen.id), taker_profile.party_id


async def _resolve_item_display_info(
    db: AsyncSession, item_ids: set[int]
) -> dict[int, tuple[str, str]]:
    """`item_id -> (product_name, condition)`, resolved once per DISTINCT
    item id present in a result set (bounded loop, per
    `standards/backend/queries.md` — not a per-row N+1).

    An `ItemListingPreference` is a standing row in `app.groups`; the item
    it points at lives in `app.circulation`, which has no knowledge of (and
    per the Term-independence boundary, must never be given knowledge of)
    listings when an item is soft-deleted there (`soft_delete_item`). A
    deleted/missing item id is silently skipped here rather than letting
    `EntityNotFoundException` propagate — otherwise one stale listing
    preference would take down every browse/public-view response that
    happens to include it. `_build_listing_views` filters out any
    preference whose item_id isn't in the returned dict."""
    info: dict[int, tuple[str, str]] = {}
    for item_id in item_ids:
        try:
            item = await circulation_bridge.get_item(db, item_id)
        except EntityNotFoundException:
            continue
        product = await product_bridge.get_product(db, item.product_id)
        info[item_id] = (product.name, item.condition.value)
    return info


async def _resolve_lister_display_names(db: AsyncSession, party_ids: set[int]) -> dict[int, str]:
    """`party_id -> display_name`, resolved once per DISTINCT lister in a
    result set — same bounded-loop precedent as `_resolve_item_display_info`."""
    names: dict[int, str] = {}
    for party_id in party_ids:
        profile = await get_profile_by_party(db, party_id)
        names[party_id] = profile.display_name
    return names


async def _build_listing_views(
    db: AsyncSession, term_id: int, preferences: list[ItemListingPreference]
) -> list[BrowseTermItemListingResponse]:
    item_ids = {pref.item_id for pref in preferences}
    lister_ids = {pref.owner_party_id for pref in preferences}
    item_info = await _resolve_item_display_info(db, item_ids)
    lister_names = await _resolve_lister_display_names(db, lister_ids)

    views: list[BrowseTermItemListingResponse] = []
    for pref in preferences:
        if pref.item_id not in item_info:
            # Item was resolvable when `_is_item_available`'s own
            # deleted-item check ran (list_my_term_item_listings has no
            # such pre-filter) but has since become unresolvable, or this
            # is the `list_my_...` path which never filters by
            # availability at all — skip rather than KeyError.
            continue
        product_name, condition = item_info[pref.item_id]
        resolved_reservation_id, taken_by_party_id = await _resolve_listing_status(db, pref.item_id)
        views.append(
            BrowseTermItemListingResponse(
                id=pref.item_id,
                term_id=term_id,
                item_id=pref.item_id,
                lister_party_id=pref.owner_party_id,
                offered_types=[pref.mode],
                resolved_reservation_id=resolved_reservation_id,
                taken_by_party_id=taken_by_party_id,
                product_name=product_name,
                condition=condition,
                lister_display_name=lister_names[pref.owner_party_id],
                created_at=pref.created_at,
                updated_at=pref.updated_at,
            )
        )
    return views


async def _list_eligible_lister_party_ids(
    db: AsyncSession, term: Term, exclude_party_id: int | None = None
) -> set[int]:
    """Everyone whose items may show up as listings for `term`: active
    attendees plus the Circle's organizer, minus the viewer themself
    (`exclude_party_id=None` — the public, viewer-less listing — excludes
    nobody)."""
    attendances = await repository.list_active_attendances_for_term(db, cast(int, term.id))
    party_ids = {a.party_id for a in attendances}
    leadership = await get_current_leadership(db, term.circle_group_id)
    if leadership is not None:
        party_ids.add(await _group_role_party_id(db, leadership.from_role_id))
    if exclude_party_id is not None:
        party_ids.discard(exclude_party_id)
    return party_ids


async def list_my_term_item_listings(
    db: AsyncSession, term_id: int, party_id: int
) -> list[BrowseTermItemListingResponse]:
    term = await get_term(db, term_id)
    await _require_term_eligibility(db, term_id, term.circle_group_id, party_id)
    preferences = await repository.list_item_listing_preferences_for_party(db, party_id)
    return await _build_listing_views(db, term_id, preferences)


async def list_browsable_term_item_listings(
    db: AsyncSession, term_id: int, viewer_party_id: int
) -> list[BrowseTermItemListingResponse]:
    term = await get_term(db, term_id)
    await _require_term_eligibility(db, term_id, term.circle_group_id, viewer_party_id)
    if term.occurs_on < datetime.utcnow():
        return []

    eligible_party_ids = await _list_eligible_lister_party_ids(db, term, viewer_party_id)
    preferences = await repository.list_item_listing_preferences_for_parties(db, eligible_party_ids)
    takeable = [pref for pref in preferences if await _is_item_available(db, pref.item_id)]
    return await _build_listing_views(db, term_id, takeable)


async def list_public_term_item_listings(
    db: AsyncSession, term_id: int
) -> list[BrowseTermItemListingResponse]:
    """The anonymous-safe sibling of `list_browsable_term_item_listings` —
    no caller identity, so no eligibility check and nobody excluded, per
    `usePublicKragGrupy`'s "never an authenticated call" contract on the
    frontend. Used by the public per-Term page (`get_public_circle_view`)
    so a visitor without an account can still see what's on offer; taking
    one still requires logging in (`take_item_listing` is `EditPrincipal`-gated).

    Unlike `list_browsable_term_item_listings`, this is a read-only display
    path with no past-Term cutoff — `get_public_circle_view` falls back to
    the most recent past Term when a Circle has no upcoming one, and
    `needed_items` on that same response is never date-filtered either, so
    hiding still-`AVAILABLE` listings just because the Term already
    occurred would be inconsistent. Taking a listing is independently
    blocked for a past Term by `take_item_listing`'s own `occurs_on` check."""
    term = await get_term(db, term_id)

    eligible_party_ids = await _list_eligible_lister_party_ids(db, term)
    preferences = await repository.list_item_listing_preferences_for_parties(db, eligible_party_ids)
    takeable = [pref for pref in preferences if await _is_item_available(db, pref.item_id)]
    return await _build_listing_views(db, term_id, takeable)


async def take_item_listing(
    db: AsyncSession, principal: Principal, item_id: int, data: TakeTermItemListingRequest
) -> BrowseTermItemListingResponse:
    taker_profile = await get_profile_by_principal(db, principal)
    term = await get_term(db, data.term_id)
    if term.occurs_on < datetime.utcnow():
        raise BusinessConflictException("Termin już się odbył")

    await _require_term_eligibility(db, data.term_id, term.circle_group_id, taker_profile.party_id)

    preference = await repository.get_item_listing_preference(db, item_id)
    if preference is None:
        raise EntityNotFoundException("ItemListingPreference", item_id)

    if preference.owner_party_id == taker_profile.party_id:
        raise BusinessConflictException("Nie możesz wziąć własnej rzeczy")

    await _require_term_eligibility(
        db, data.term_id, term.circle_group_id, preference.owner_party_id
    )

    listed_item = await circulation_bridge.get_item(db, item_id)
    balance = await circulation_bridge.get_item_balance(db, item_id)
    if balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException("Ta rzecz jest już zajęta")

    if data.reservation_type.value != preference.mode:
        raise BusinessConflictException("Ten sposób wzięcia rzeczy nie został zaoferowany")

    if data.reservation_type == circulation_bridge.ReservationType.SWAP:
        # SWAP no longer dispatches from here — see `propose_swap` below.
        # A listing's SWAP mode is still browsable/take-eligible-checked
        # the same way, but actually proposing a swap goes through the
        # dedicated propose/accept/reject flow instead of this single-shot
        # take, since it needs the target owner's separate accept/reject
        # decision rather than an immediate double-auto-confirm.
        raise BusinessConflictException(
            "Zamianę zaproponuj przez propozycję zamiany, nie przez wzięcie rzeczy"
        )

    taker_account_user_id = cast(int, taker_profile.account_user_id)

    # No longer auto-confirmed: the `Reservation` stays `PENDING` after
    # creation — the lister must review and, once the Term ends, either
    # party resolves it via `confirm_transaction` below. This replaces the
    # previous unilateral auto-confirm-on-behalf-of-the-holder behavior.
    reservation = await circulation_bridge.create_reservation(
        db,
        item_id=item_id,
        reservation_type=data.reservation_type,
        reserved_by_user_id=taker_account_user_id,
    )

    product = await product_bridge.get_product(db, listed_item.product_id)
    slug = await resolve_organizer_slug(db, term.circle_group_id)
    await notifications_bridge.create_notification(
        db,
        party_id=preference.owner_party_id,
        kind=NotificationKind.TERM_ITEM_LISTING_TAKEN,
        message=f'„{taker_profile.display_name}" chce wziąć Twoją rzecz: {product.name}',
        link_path=f"/{slug}/grupa/{term.circle_group_id}/term/{term.id}",
    )
    await db.commit()
    await db.refresh(reservation)

    views = await _build_listing_views(db, data.term_id, [preference])
    return views[0]


async def propose_swap(
    db: AsyncSession, principal: Principal, listing_item_id: int, offered_item_id: int, term_id: int
) -> SwapProposal:
    """The SWAP counterpart of `take_item_listing`: locks only the
    proposer's own offered item (auto-confirmed on their own behalf, same
    reasoning `create_lend_reservation`'s docstring gives for the existing
    auto-confirm cases — their own consent already exists) and leaves the
    target listing item `AVAILABLE` until the owner explicitly
    `accept_swap_proposal`s or `reject_swap_proposal`s it."""
    proposer_profile = await get_profile_by_principal(db, principal)
    term = await get_term(db, term_id)
    if term.occurs_on < datetime.utcnow():
        raise BusinessConflictException("Termin już się odbył")
    await _require_term_eligibility(db, term_id, term.circle_group_id, proposer_profile.party_id)

    preference = await repository.get_item_listing_preference(db, listing_item_id)
    if preference is None:
        raise EntityNotFoundException("ItemListingPreference", listing_item_id)
    if preference.owner_party_id == proposer_profile.party_id:
        raise BusinessConflictException("Nie możesz wziąć własnej rzeczy")
    await _require_term_eligibility(db, term_id, term.circle_group_id, preference.owner_party_id)

    listed_item = await circulation_bridge.get_item(db, listing_item_id)
    listing_balance = await circulation_bridge.get_item_balance(db, listing_item_id)
    if listing_balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException("Ta rzecz jest już zajęta")
    if preference.mode != circulation_bridge.ReservationType.SWAP.value:
        raise BusinessConflictException("Ten sposób wzięcia rzeczy nie został zaoferowany")

    await _require_own_available_personal_item(
        db, proposer_profile.account_user_id, offered_item_id
    )

    proposer_account_user_id = cast(int, proposer_profile.account_user_id)
    proposer_reservation = await circulation_bridge.create_reservation(
        db,
        item_id=offered_item_id,
        reservation_type=circulation_bridge.ReservationType.SWAP,
        reserved_by_user_id=proposer_account_user_id,
    )
    await circulation_bridge.confirm_reservation(
        db, cast(int, proposer_reservation.id), acting_user_id=proposer_account_user_id
    )

    proposal = SwapProposal(
        proposer_party_id=proposer_profile.party_id,
        listing_item_id=listing_item_id,
        offered_item_id=offered_item_id,
        proposer_reservation_id=cast(int, proposer_reservation.id),
        status=SwapProposalStatus.PROPOSED,
    )
    db.add(proposal)
    # Flush (no commit) so `proposal.id` is populated from its sequence
    # before it's attached to the notification below — the trailing
    # `db.commit()` further down still persists both atomically.
    await db.flush()

    product = await product_bridge.get_product(db, listed_item.product_id)
    slug = await resolve_organizer_slug(db, term.circle_group_id)
    await notifications_bridge.create_notification(
        db,
        party_id=preference.owner_party_id,
        kind=NotificationKind.SWAP_PROPOSED,
        message=f'„{proposer_profile.display_name}" proponuje zamianę za: {product.name}',
        link_path=f"/{slug}/grupa/{term.circle_group_id}/term/{term.id}",
        proposal_id=cast(int, proposal.id),
    )
    await db.commit()
    await db.refresh(proposal)
    return proposal


async def accept_swap_proposal(
    db: AsyncSession, principal: Principal, proposal_id: int
) -> SwapProposal:
    """Creates the listing owner's own leg (auto-confirmed on their own
    behalf, same reasoning as `propose_swap`'s proposer leg) and pairs it
    with the proposer's already-locked leg by directly wiring
    `paired_reservation_id` on both ORM objects already in hand — the exact
    linkage `circulation.application.reservations.create_swap` performs
    internally right after creating both legs from scratch, replicated here
    for the one-leg-already-exists scenario since calling `create_swap`
    itself would create a *second*, redundant proposer leg."""
    owner_profile = await get_profile_by_principal(db, principal)
    proposal = await repository.get_swap_proposal(db, proposal_id)
    if proposal is None:
        raise EntityNotFoundException("SwapProposal", proposal_id)
    preference = await repository.get_item_listing_preference(db, proposal.listing_item_id)
    if preference is None or preference.owner_party_id != owner_profile.party_id:
        raise AccessDeniedException
    if proposal.status != SwapProposalStatus.PROPOSED:
        raise BusinessConflictException("Ta propozycja została już rozstrzygnięta")

    listing_balance = await circulation_bridge.get_item_balance(db, proposal.listing_item_id)
    if listing_balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException("Ta rzecz jest już zajęta")

    owner_account_user_id = cast(int, owner_profile.account_user_id)
    owner_reservation = await circulation_bridge.create_reservation(
        db,
        item_id=proposal.listing_item_id,
        reservation_type=circulation_bridge.ReservationType.SWAP,
        reserved_by_user_id=owner_account_user_id,
    )
    await circulation_bridge.confirm_reservation(
        db, cast(int, owner_reservation.id), acting_user_id=owner_account_user_id
    )

    proposer_reservation = await circulation_bridge.get_reservation(
        db, proposal.proposer_reservation_id
    )
    proposer_reservation.paired_reservation_id = owner_reservation.id
    owner_reservation.paired_reservation_id = proposer_reservation.id

    proposal.status = SwapProposalStatus.ACCEPTED

    listed_item = await circulation_bridge.get_item(db, proposal.listing_item_id)
    product = await product_bridge.get_product(db, listed_item.product_id)
    await notifications_bridge.create_notification(
        db,
        party_id=proposal.proposer_party_id,
        kind=NotificationKind.SWAP_ACCEPTED,
        message=f"Twoja propozycja zamiany za „{product.name}\" została zaakceptowana",
    )
    await db.commit()
    await db.refresh(proposal)
    return proposal


async def reject_swap_proposal(
    db: AsyncSession, principal: Principal, proposal_id: int
) -> SwapProposal:
    owner_profile = await get_profile_by_principal(db, principal)
    proposal = await repository.get_swap_proposal(db, proposal_id)
    if proposal is None:
        raise EntityNotFoundException("SwapProposal", proposal_id)
    preference = await repository.get_item_listing_preference(db, proposal.listing_item_id)
    if preference is None or preference.owner_party_id != owner_profile.party_id:
        raise AccessDeniedException
    if proposal.status != SwapProposalStatus.PROPOSED:
        raise BusinessConflictException("Ta propozycja została już rozstrzygnięta")

    # Cancelled on the proposer's own behalf — the same self-reservation
    # convention `propose_swap` used to lock it (`reserved_by_user_id` ==
    # the item's own holder for this self-lock leg), so releasing it back
    # to `AVAILABLE` requires exactly that party per
    # `reservation_rules._require_party_to_reservation`.
    proposer_profile = await get_profile_by_party(db, proposal.proposer_party_id)
    await circulation_bridge.cancel_reservation(
        db,
        proposal.proposer_reservation_id,
        acting_user_id=cast(int, proposer_profile.account_user_id),
    )

    proposal.status = SwapProposalStatus.REJECTED

    listed_item = await circulation_bridge.get_item(db, proposal.listing_item_id)
    product = await product_bridge.get_product(db, listed_item.product_id)
    await notifications_bridge.create_notification(
        db,
        party_id=proposal.proposer_party_id,
        kind=NotificationKind.SWAP_REJECTED,
        message=f'Twoja propozycja zamiany za „{product.name}" została odrzucona',
    )
    await db.commit()
    await db.refresh(proposal)
    return proposal


async def _resolve_transaction_holder_user_id(
    db: AsyncSession, reservation: circulation_bridge.Reservation
) -> int:
    """The *stable* other party to `reservation` — the lister (GIFT/LEND)
    or the item's originally-listed/offered owner (each SWAP leg) —
    resolved from the standing `ItemListingPreference`/`SwapProposal`
    record rather than `circulation_bridge.resolve_current_holder_user_id`:
    that helper reports the item's *current* physical owner, which for
    GIFT/SWAP permanently changes the moment `fulfill_reservation` runs —
    exactly the moment the *second* (losing) party's `confirm_transaction`
    call needs this identity to still resolve correctly, so a "current
    holder" lookup would misidentify them as a non-party on that second call."""
    if reservation.reservation_type != circulation_bridge.ReservationType.SWAP:
        preference = await repository.get_item_listing_preference(db, reservation.item_id)
        if preference is not None:
            owner_profile = await get_profile_by_party(db, preference.owner_party_id)
            return cast(int, owner_profile.account_user_id)
    else:
        proposal = await repository.get_swap_proposal_for_item(db, reservation.item_id)
        if proposal is not None:
            if reservation.item_id == proposal.offered_item_id:
                proposer_profile = await get_profile_by_party(db, proposal.proposer_party_id)
                return cast(int, proposer_profile.account_user_id)
            preference = await repository.get_item_listing_preference(db, proposal.listing_item_id)
            if preference is not None:
                owner_profile = await get_profile_by_party(db, preference.owner_party_id)
                return cast(int, owner_profile.account_user_id)
    # Fallback (preference/proposal row no longer exists, e.g. cleared) —
    # best-effort current-physical-owner lookup.
    return await circulation_bridge.resolve_current_holder_user_id(db, reservation.item_id)


async def confirm_transaction(
    db: AsyncSession, principal: Principal, reservation_id: int, term_id: int
) -> circulation_bridge.Reservation:
    """Resolves a locked exchange (LEND/GIFT leg, or a SWAP's paired legs)
    once its Term has ended: whichever party of the transaction calls this
    first wins the race and both legs (for SWAP) get confirmed+fulfilled;
    the other party's later call is recognized as a no-op via
    `TermAlreadyResolvedException` rather than a raw, unexplained conflict.

    `term_id` is caller-supplied context (a bare `Reservation` carries no
    Term reference) — only used to gate on `term.occurs_on`, deliberately
    NOT sharing a helper with `take_item_listing`'s own, differently-timed
    `occurs_on < utcnow()` check (see spec.md Technical Approach step 3)."""
    profile = await get_profile_by_principal(db, principal)
    term = await get_term(db, term_id)
    if term.occurs_on > datetime.utcnow():
        raise BusinessConflictException("Termin jeszcze się nie odbył")

    reservation = await circulation_bridge.get_reservation(db, reservation_id)
    holder_user_id = await _resolve_transaction_holder_user_id(db, reservation)
    confirm_race_rules._require_race_participant(
        reservation.reserved_by_user_id,
        holder_user_id,
        acting_user_id=cast(int, profile.account_user_id),
    )

    if reservation.status not in _ACTIVE_RESERVATION_STATUSES:
        # The other party already resolved this transaction first.
        await notifications_bridge.create_notification(
            db,
            party_id=profile.party_id,
            kind=NotificationKind.TERM_ALREADY_RESOLVED,
            message="Ta transakcja została już rozstrzygnięta przez drugą stronę",
        )
        await db.commit()
        raise TermAlreadyResolvedException

    if reservation.status == circulation_bridge.ReservationStatus.PENDING:
        await circulation_bridge.confirm_reservation(
            db, reservation_id, acting_user_id=holder_user_id
        )
    fulfilled = await circulation_bridge.fulfill_reservation(
        db, reservation_id, acting_user_id=holder_user_id
    )

    if (
        reservation.reservation_type == circulation_bridge.ReservationType.SWAP
        and reservation.paired_reservation_id is not None
    ):
        paired = await circulation_bridge.get_reservation(db, reservation.paired_reservation_id)
        paired_holder_user_id = await _resolve_transaction_holder_user_id(db, paired)
        if paired.status == circulation_bridge.ReservationStatus.PENDING:
            await circulation_bridge.confirm_reservation(
                db, cast(int, paired.id), acting_user_id=paired_holder_user_id
            )
        await circulation_bridge.fulfill_reservation(
            db, cast(int, paired.id), acting_user_id=paired_holder_user_id
        )

    return fulfilled
