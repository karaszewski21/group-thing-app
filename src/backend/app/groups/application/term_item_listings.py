"""The `ItemListingPreference` set/list/browse/take use cases — the
GIFT/SWAP exchange mechanism. Gated on `attendance._require_term_eligibility`
(Term-scoped attendance, or being the Term's Circle organizer) rather than
Circle-wide membership. Ownership validation for the item being offered (a
`SWAP` proposer's own counter-offer) is `_require_own_available_personal_item`.

Listing membership itself ("does this item show up for this Term") and
listing status ("is it still takeable, who took it") are both derived, never
stored: a `ItemListingPreference` is a standing, Term-independent mode set
from `Moje rzeczy`; whether it's visible for a given Term follows from the
owner's `TermAttendance`/organizer status for that Term, and whether it's
still open follows from the item's live `InventoryBalance` and
`circulation.Reservation` history (`_resolve_listing_status`) — no
listing-owned status field, per `standards/global/minimal-implementation.md`.

Take/propose/accept/reject call circulation with `commit=False` and commit
once at the end: an event's `FOR SHARE` lock and a proposal's `FOR UPDATE`
lock then hold for the whole use case, so a concurrent `delete_event` waits
instead of cancelling a half-written exchange, and a failure leaves nothing
behind."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.storage.service import ObjectStorage
from app.users.models import UserProfile
from app.users.service import (
    get_profile_by_account_user_id,
    get_profile_by_party,
    get_profile_by_principal,
)

from ..domain import confirm_race_rules
from ..infrastructure import circulation_bridge, notifications_bridge, product_bridge, repository
from ..infrastructure.notifications_bridge import NotificationKind
from ..models import (
    GroupVisibility,
    ItemListingPreference,
    ItemVisibility,
    SwapProposal,
    SwapProposalStatus,
    Term,
)
from ..schemas import (
    AcceptedSwapProposalResponse,
    BrowseTermItemListingResponse,
    ItemProposeRequest,
    ItemTakeRequest,
    ItemTakeResponse,
    MyInventoryItemResponse,
    PublicItemListingResponse,
    SwapProposalOfferResponse,
    SwapProposalResponse,
)
from .attendance import _require_term_eligibility
from .circles import _group_role_party_id, get_current_leadership, get_group_including_deleted
from .item_links import item_path
from .item_visibility import require_item_visible
from .reservation_context import (
    PersonalContext,
    ReservationContext,
    load_for_reservation,
    load_requested_context,
    require_placeable,
)
from .reserved_by import load_reserved_by_names
from .terms import get_term, get_term_any

_ACTIVE_RESERVATION_STATUSES = (
    circulation_bridge.ReservationStatus.PENDING,
    circulation_bridge.ReservationStatus.CONFIRMED,
)

MAX_GIFT_ITEMS = 10
_GIFT_LIMIT_MESSAGE = f"Możesz mieć maksymalnie {MAX_GIFT_ITEMS} rzeczy do oddania. "
GIFT_LIMIT_ON_REGISTER_MESSAGE = (
    _GIFT_LIMIT_MESSAGE + "Wybierz „Zamienię” albo zapisz wersję roboczą."
)
GIFT_LIMIT_ON_SET_MESSAGE = _GIFT_LIMIT_MESSAGE + "Zdejmij „Oddam” z innej rzeczy."


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
    db: AsyncSession, account_user_id: uuid.UUID | None, item_id: uuid.UUID
) -> circulation_bridge.InventoryItem:
    """The offered item must be the caller's own, in their PERSONAL
    inventory and `AVAILABLE` — used by a `SWAP` proposer's counter-offer."""
    item = await circulation_bridge.get_item(db, item_id)
    inventory = await circulation_bridge.resolve_owning_inventory(db, item)
    if (
        inventory.owner_user_id != account_user_id
        or inventory.inventory_type != circulation_bridge.InventoryType.PERSONAL
    ):
        raise AccessDeniedException
    balance = await circulation_bridge.get_item_balance(db, cast(uuid.UUID, item.id))
    if balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException(
            "Nie można użyć tej rzeczy — jest zarezerwowana"
        )
    return item


async def _require_gift_capacity(
    db: AsyncSession, owner_party_id: uuid.UUID, item_id: uuid.UUID, message: str
) -> None:
    """One COUNT of the owner's GIFT preferences other than `item_id`'s own,
    shared by register and set. A soft limit: two concurrent requests can
    both pass it."""
    gifts = (
        await db.execute(
            select(func.count())
            .select_from(ItemListingPreference)
            .where(
                ItemListingPreference.owner_party_id == owner_party_id,
                ItemListingPreference.mode == circulation_bridge.ReservationType.GIFT.value,
                ItemListingPreference.item_id != item_id,
            )
        )
    ).scalar_one()
    if gifts >= MAX_GIFT_ITEMS:
        raise BusinessConflictException(message)


async def list_registered_item(
    db: AsyncSession,
    item: circulation_bridge.InventoryItem,
    inventory: circulation_bridge.Inventory,
    mode: circulation_bridge.ReservationType,
) -> None:
    """`register_item`'s hook for an item registered with a listing mode:
    inserts its preference inside the registration's transaction — never
    commits. Same PERSONAL-inventory rule as `set_item_listing_preference`;
    circulation has already checked that the caller owns `inventory` and set
    the item ACTIVE."""
    if inventory.inventory_type != circulation_bridge.InventoryType.PERSONAL:
        raise AccessDeniedException
    profile = await get_profile_by_account_user_id(db, inventory.owner_user_id)
    item_id = cast(uuid.UUID, item.id)
    if mode == circulation_bridge.ReservationType.GIFT:
        await _require_gift_capacity(db, profile.party_id, item_id, GIFT_LIMIT_ON_REGISTER_MESSAGE)
    db.add(ItemListingPreference(item_id=item_id, owner_party_id=profile.party_id, mode=mode.value))
    await db.flush()


async def set_item_listing_preference(
    db: AsyncSession,
    principal: Principal,
    item_id: uuid.UUID,
    mode: circulation_bridge.ReservationType | None,
    visibility: ItemVisibility | None = None,
) -> ItemListingPreference | None:
    """Sets, changes, or (when `mode` is `None`) clears the standing listing
    mode on one of the caller's own items, moving the item to ACTIVE or
    DRAFT in the same commit. A `None` `visibility` keeps the row's current
    one, and a new row starts PUBLIC. Ownership-only check (no availability
    requirement) — unlike taking a listing, expressing intent to gift/swap
    an item shouldn't be blocked by its current balance. Setting GIFT is
    refused at `MAX_GIFT_ITEMS`. A first listing (DRAFT to ACTIVE) needs the
    item's live location; changing an existing listing never does, so a
    deleted place leaves listings as they are. The item row is read under
    FOR UPDATE, so concurrent status writes serialize against this one."""
    profile = await get_profile_by_principal(db, principal)
    item = await circulation_bridge.get_item_for_update(db, item_id)
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
            await circulation_bridge.set_item_listing_status(
                db, item_id, circulation_bridge.ItemListingStatus.DRAFT
            )
            await db.commit()
        return None
    if existing is None and await circulation_bridge.get_item_live_location_id(db, item_id) is None:
        raise BusinessConflictException("Ustaw lokalizację przedmiotu, aby go wystawić")

    if mode == circulation_bridge.ReservationType.GIFT:
        await _require_gift_capacity(db, profile.party_id, item_id, GIFT_LIMIT_ON_SET_MESSAGE)

    if existing is not None:
        existing.mode = mode.value
        existing.owner_party_id = profile.party_id
        if visibility is not None:
            existing.visibility = visibility
        preference = existing
    else:
        preference = ItemListingPreference(
            item_id=item_id,
            owner_party_id=profile.party_id,
            mode=mode.value,
            visibility=visibility or ItemVisibility.PUBLIC,
        )
        db.add(preference)
    await circulation_bridge.set_item_listing_status(
        db, item_id, circulation_bridge.ItemListingStatus.ACTIVE
    )
    await db.commit()
    await db.refresh(preference)
    return preference


async def list_my_inventory_items(
    db: AsyncSession, principal: Principal, storage: ObjectStorage | None = None
) -> list[MyInventoryItemResponse]:
    """The caller's items physically in their PERSONAL inventory, with each
    item's standing listing mode, used by
    `Moje rzeczy` to list items and seed each mode toggle on load. Items
    whose product has a photo in moderation are flagged (one batched query,
    informational only — it does not block listing). With `storage`, each item
    carries its product's first approved photo as `thumb_url` (one more
    batched query)."""
    profile = await get_profile_by_principal(db, principal)
    inventory = await circulation_bridge.find_personal_inventory(
        db, cast(uuid.UUID, profile.account_user_id)
    )
    if inventory is None:
        return []
    rows = await circulation_bridge.list_items_with_product_name(db, cast(uuid.UUID, inventory.id))
    preferences = {
        pref.item_id: pref
        for pref in await repository.list_item_listing_preferences_for_party(
            db, profile.party_id, include_private=True
        )
    }
    product_ids = {item.product_id for item, _ in rows}
    pending = await product_bridge.product_ids_with_unmoderated_photos(db, product_ids)
    photos = (
        await product_bridge.first_approved_photo_by_product(db, product_ids)
        if storage is not None and product_ids
        else {}
    )
    return [
        MyInventoryItemResponse(
            id=cast(uuid.UUID, item.id),
            inventory_id=item.inventory_id,
            home_inventory_id=item.home_inventory_id,
            product_id=item.product_id,
            product_name=product_name,
            condition=item.condition,
            added_at=item.added_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
            listing_mode=preference.mode if preference else None,
            listing_visibility=preference.visibility if preference else None,
            listing_status=item.listing_status,
            location_id=item.location_id,
            photos_moderation_pending=item.product_id in pending,
            thumb_url=(
                storage.public_url(photos[item.product_id].thumb_key)
                if storage is not None and item.product_id in photos
                else None
            ),
        )
        for item, product_name in rows
        for preference in [preferences.get(cast(uuid.UUID, item.id))]
    ]


async def _takeable_preferences(
    db: AsyncSession, preferences: list[ItemListingPreference]
) -> list[ItemListingPreference]:
    """The preferences whose item can still be taken: live, AVAILABLE and
    not the target of a `PROPOSED` swap proposal (two batched reads)."""
    item_ids = [pref.item_id for pref in preferences]
    proposed = await repository.list_listing_item_ids_with_pending_proposal(db, item_ids)
    available = await circulation_bridge.list_available_items_with_product(db, item_ids)
    return [
        pref for pref in preferences if pref.item_id not in proposed and pref.item_id in available
    ]


async def _resolve_listing_status(
    db: AsyncSession, item_id: uuid.UUID
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """`(resolved_reservation_id, taken_by_party_id)` derived from the
    item's `Reservation` history: the active (`PENDING`/`CONFIRMED`) one if
    present, else the latest `FULFILLED` one, else `(None, None)` — still
    open. A lingering `CANCELLED`-only history also resolves to `(None,
    None)`, which is exactly "reopened" — no special-case handling needed
    since a cancelled reservation already put the balance back to
    `AVAILABLE`. A `PROPOSED` swap leaves no reservation on the listing
    item, so it resolves to `(None, None)` too: the proposer's reservation
    and party stay private to the swap's parties. "Latest" is by
    `created_at`, not `id` — a UUID primary key carries no creation-order
    information."""
    reservations = await circulation_bridge.list_reservations(db, item_id)
    active = [r for r in reservations if r.status in _ACTIVE_RESERVATION_STATUSES]
    chosen: circulation_bridge.Reservation | None
    if active:
        chosen = max(active, key=lambda r: r.created_at)
    else:
        fulfilled = [
            r for r in reservations if r.status == circulation_bridge.ReservationStatus.FULFILLED
        ]
        chosen = max(fulfilled, key=lambda r: r.created_at) if fulfilled else None
    if chosen is None:
        return None, None
    taker_profile = await get_profile_by_account_user_id(db, chosen.reserved_by_user_id)
    return chosen.id, taker_profile.party_id


async def _resolve_item_display_info(
    db: AsyncSession, item_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str]]:
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
    info: dict[uuid.UUID, tuple[str, str]] = {}
    for item_id in item_ids:
        try:
            item = await circulation_bridge.get_item(db, item_id)
        except EntityNotFoundException:
            continue
        product = await product_bridge.get_product(db, item.product_id)
        info[item_id] = (product.name, item.condition.value)
    return info


async def _resolve_lister_display_names(db: AsyncSession, party_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """`party_id -> display_name`, resolved once per DISTINCT lister in a
    result set — same bounded-loop precedent as `_resolve_item_display_info`."""
    names: dict[uuid.UUID, str] = {}
    for party_id in party_ids:
        profile = await get_profile_by_party(db, party_id)
        names[party_id] = profile.display_name
    return names


async def _build_listing_views(
    db: AsyncSession, term_id: uuid.UUID, preferences: list[ItemListingPreference]
) -> list[BrowseTermItemListingResponse]:
    item_ids = {pref.item_id for pref in preferences}
    lister_ids = {pref.owner_party_id for pref in preferences}
    item_info = await _resolve_item_display_info(db, item_ids)
    lister_names = await _resolve_lister_display_names(db, lister_ids)

    views: list[BrowseTermItemListingResponse] = []
    for pref in preferences:
        if pref.item_id not in item_info:
            # Item was live when `_takeable_preferences` ran
            # (list_my_term_item_listings has no such pre-filter) but has
            # since become unresolvable, or this is the `list_my_...` path
            # which never filters by availability at all — skip rather
            # than KeyError.
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
    db: AsyncSession, term: Term, exclude_party_id: uuid.UUID | None = None
) -> set[uuid.UUID]:
    """Everyone whose items may show up as listings for `term`: active
    attendees plus the Circle's organizer, minus the viewer themself
    (`exclude_party_id=None` — the public, viewer-less listing — excludes
    nobody)."""
    attendances = await repository.list_active_attendances_for_term(db, cast(uuid.UUID, term.id))
    party_ids = {a.party_id for a in attendances}
    leadership = await get_current_leadership(db, term.circle_group_id)
    if leadership is not None:
        party_ids.add(await _group_role_party_id(db, leadership.from_role_id))
    if exclude_party_id is not None:
        party_ids.discard(exclude_party_id)
    return party_ids


async def list_my_term_item_listings(
    db: AsyncSession, term_id: uuid.UUID, party_id: uuid.UUID
) -> list[BrowseTermItemListingResponse]:
    term = await get_term_any(db, term_id)
    await _require_term_eligibility(db, term_id, term.circle_group_id, party_id)
    preferences = await repository.list_item_listing_preferences_for_party(
        db, party_id, include_private=True
    )
    return await _build_listing_views(db, term_id, preferences)


async def list_my_active_taken_term_item_listings(
    db: AsyncSession, term_id: uuid.UUID, party_id: uuid.UUID
) -> list[BrowseTermItemListingResponse]:
    """The taker-side counterpart of `list_my_term_item_listings`: the
    caller's own active (`PENDING`/`CONFIRMED`) takes of this Term, resolved
    availability-independently — unlike `list_browsable_term_item_listings`,
    this still resolves after `term.occurs_on` has passed, which is exactly
    the post-term-end window `confirm_transaction` needs a reservation id
    for."""
    term = await get_term_any(db, term_id)
    await _require_term_eligibility(db, term_id, term.circle_group_id, party_id)

    profile = await get_profile_by_party(db, party_id)
    reservations = await circulation_bridge.list_active_reservations_for_taker(
        db, cast(uuid.UUID, profile.account_user_id)
    )

    eligible_lister_party_ids = await _list_eligible_lister_party_ids(db, term)
    preferences: list[ItemListingPreference] = []
    for reservation in reservations:
        if reservation.term_id != term_id:
            continue
        preference = await repository.get_item_listing_preference(db, reservation.item_id)
        if preference is None:
            # The owner cleared the mode meanwhile: the take is still live,
            # so describe it from the reservation instead. Transient, never
            # added to the session.
            giver = await get_profile_by_account_user_id(db, reservation.giver_user_id)
            preference = ItemListingPreference(
                item_id=reservation.item_id,
                owner_party_id=giver.party_id,
                mode=reservation.reservation_type.value,
                created_at=reservation.created_at,
                updated_at=reservation.updated_at,
            )
        if preference.owner_party_id in eligible_lister_party_ids:
            preferences.append(preference)

    return await _build_listing_views(db, term_id, preferences)


async def list_browsable_term_item_listings(
    db: AsyncSession, term_id: uuid.UUID, viewer_party_id: uuid.UUID
) -> list[BrowseTermItemListingResponse]:
    term = await get_term(db, term_id)
    await _require_term_eligibility(db, term_id, term.circle_group_id, viewer_party_id)
    if term.occurs_on < clock.local_now():
        return []

    eligible_party_ids = await _list_eligible_lister_party_ids(db, term, viewer_party_id)
    sees_private = await _sees_private_circle_items(db, term, viewer_party_id)
    preferences = await repository.list_item_listing_preferences_for_parties(
        db,
        eligible_party_ids,
        private_circle_id=term.circle_group_id if sees_private else None,
    )
    takeable = await _takeable_preferences(db, preferences)
    return await _build_listing_views(db, term_id, takeable)


async def _sees_private_circle_items(
    db: AsyncSession, term: Term, viewer_party_id: uuid.UUID
) -> bool:
    """PRIVATE items show on a PRIVATE circle's term to its standing members
    and organizer, never to an RSVP-only non-member (`can_view_item`); only
    those of listers in that circle too (`private_circle_id`)."""
    group = await get_group_including_deleted(db, term.circle_group_id)
    return group.visibility == GroupVisibility.PRIVATE and await repository.is_in_circle(
        db, term.circle_group_id, viewer_party_id
    )


@dataclass(frozen=True)
class PublicTermListing:
    """A public term listing (its `thumb_url` still unset) and the product
    the thumbnail comes from."""

    listing: PublicItemListingResponse
    product_id: uuid.UUID


async def list_public_term_item_listings(
    db: AsyncSession,
    term_id: uuid.UUID,
    *,
    viewer_party_id: uuid.UUID | None = None,
    include_private: bool = False,
) -> list[PublicTermListing]:
    """The read-only sibling of `list_browsable_term_item_listings` for the
    public per-Term page (`get_public_circle_view`): no eligibility check
    and nobody excluded, so a visitor without an account still sees what's
    on offer; taking one still requires logging in. Reserved items stay
    listed with their `reservation` badge, shaped for `viewer_party_id`
    (`None` = anonymous, no reserver names). PRIVATE items only with
    `include_private` (a PRIVATE circle's member or organizer), and only
    those whose lister is in the circle too — an RSVP-only lister's PRIVATE
    items stay hidden, as `can_view_item` would hide them.

    No past-Term cutoff: `get_public_circle_view` falls back to the most
    recent past Term when a Circle has no upcoming one, and `needed_items`
    on that same response is never date-filtered either. Taking a listing
    is independently blocked for a past Term by `take_item`'s own
    `require_open` check.

    One statement for the listings (preferences joined to the listed items
    and their pending proposal), then one profile lookup by party id
    (listers and proposers) and one by account user id (reservers),
    however many listings there are."""
    term = await get_term(db, term_id)

    eligible_party_ids = await _list_eligible_lister_party_ids(db, term)
    rows = await repository.list_listed_items_for_parties(
        db,
        eligible_party_ids,
        repository.with_pending_proposer(circulation_bridge.listed_items_with_product_select()),
        private_circle_id=term.circle_group_id if include_private else None,
    )
    names = await load_reserved_by_names(
        db, rows, viewer_party_id, extra_party_ids={row.owner_party_id for row in rows}
    )
    return [
        PublicTermListing(
            listing=PublicItemListingResponse(
                id=row.item_id,
                item_id=row.item_id,
                product_name=row.product_name,
                condition=row.condition,
                offered_types=[row.mode],
                lister_party_id=row.owner_party_id,
                lister_display_name=names.party_names[row.owner_party_id],
                added_at=row.created_at,
                reservation=names.row_reservation(row),
            ),
            product_id=row.product_id,
        )
        for row in rows
        if row.owner_party_id in names.party_names
    ]


async def _lock_takeable_preference(
    db: AsyncSession, item_id: uuid.UUID
) -> ItemListingPreference:
    """The item's listing preference under `FOR UPDATE`, checked after the
    lock so a concurrent take or proposal that committed first is seen: the
    item must still be AVAILABLE and free of a `PROPOSED` swap proposal."""
    preference = await repository.lock_item_listing_preference(db, item_id)
    if preference is None:
        raise EntityNotFoundException("ItemListingPreference", item_id)
    balance = await circulation_bridge.get_item_balance(db, item_id)
    if balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException("Ta rzecz jest już zajęta")
    if item_id in await repository.list_listing_item_ids_with_pending_proposal(db, [item_id]):
        raise BusinessConflictException("Ktoś już zaproponował zamianę za tę rzecz")
    return preference


def _take_messages(
    context: ReservationContext, taker_name: str, product_name: str
) -> tuple[str, str]:
    """`(owner, taker)` notification text of a take."""
    if isinstance(context, PersonalContext):
        return (
            f"„{taker_name}” odbierze osobiście „{product_name}” — ustalcie szczegóły na czacie.",
            f"Zarezerwowano „{product_name}” — {context.pickup_phrase()}, ustal szczegóły"
            f" z {context.owner_display_name} na czacie. Gdy odbierzesz rzecz, potwierdź to"
            " na stronie przedmiotu.",
        )
    phrase = context.pickup_phrase()
    return (
        f"„{taker_name}” weźmie „{product_name}” — przynieś w {phrase}",
        f"Zarezerwowano „{product_name}” — odbierz w {phrase}",
    )


def _swap_accepted_message(context: ReservationContext, product_name: str) -> str:
    accepted = f"Twoja propozycja zamiany za „{product_name}” została zaakceptowana"
    if isinstance(context, PersonalContext):
        return f"{accepted} — {context.pickup_phrase()}"
    return f"{accepted} — wymiana w {context.pickup_phrase()}"


async def _take(
    db: AsyncSession,
    taker_profile: UserProfile,
    item_id: uuid.UUID,
    reservation_type: circulation_bridge.ReservationType,
    context: ReservationContext,
) -> tuple[ItemListingPreference, str]:
    """The take shared by terms, events and personal pickups; returns the
    listing preference and the product name. The reservation stays `PENDING`
    until either party resolves it via `confirm_transaction` once the date
    has come (at once for a personal pickup)."""
    context.require_open()
    await context.require_eligibility(db, taker_profile.party_id)

    preference = await repository.get_item_listing_preference(db, item_id)
    if preference is None:
        raise EntityNotFoundException("ItemListingPreference", item_id)

    if preference.owner_party_id == taker_profile.party_id:
        raise BusinessConflictException("Nie możesz wziąć własnej rzeczy")

    await context.require_eligibility(db, preference.owner_party_id)
    await require_placeable(db, context, preference, taker_profile.party_id)

    listed_item = await circulation_bridge.get_item(db, item_id)
    preference = await _lock_takeable_preference(db, item_id)
    await require_placeable(db, context, preference, taker_profile.party_id)

    if reservation_type.value != preference.mode:
        raise BusinessConflictException("Ten sposób wzięcia rzeczy nie został zaoferowany")

    if reservation_type == circulation_bridge.ReservationType.SWAP:
        # A swap needs the owner's separate accept/reject decision, so it goes
        # through `propose_item_swap` instead of this single-shot take.
        raise BusinessConflictException(
            "Zamianę zaproponuj przez propozycję zamiany, nie przez wzięcie rzeczy"
        )

    reservation = await circulation_bridge.create_reservation(
        db,
        item_id=item_id,
        reservation_type=reservation_type,
        reserved_by_user_id=cast(uuid.UUID, taker_profile.account_user_id),
        commit=False,
        **context.reservation_kwargs(),
    )

    product = await product_bridge.get_product(db, listed_item.product_id)
    owner_message, taker_message = _take_messages(
        context, taker_profile.display_name, product.name
    )
    await notifications_bridge.create_notification(
        db,
        party_id=preference.owner_party_id,
        kind=NotificationKind.TERM_ITEM_LISTING_TAKEN,
        message=clock.fit_notification_message(owner_message),
        link_path=await item_path(db, item_id),
    )
    await notifications_bridge.create_notification(
        db,
        party_id=taker_profile.party_id,
        kind=NotificationKind.ITEM_RESERVED_FOR_PICKUP,
        message=clock.fit_notification_message(taker_message),
        link_path=await item_path(db, item_id),
    )
    await db.commit()
    await db.refresh(reservation)
    return preference, product.name


async def take_item(
    db: AsyncSession, principal: Principal, item_id: uuid.UUID, data: ItemTakeRequest
) -> ItemTakeResponse:
    """`POST /api/items/{id}/take` in any context; `context` is null in the
    response for a personal pickup. A hidden item is a 404 before the
    context is built."""
    taker_profile = await get_profile_by_principal(db, principal)
    await require_item_visible(db, item_id, taker_profile.party_id)
    context = await load_requested_context(db, data.context, item_id)
    _, product_name = await _take(db, taker_profile, item_id, data.reservation_type, context)
    return ItemTakeResponse(
        item_id=item_id, product_name=product_name, context=await context.to_response(db)
    )


async def propose_item_swap(
    db: AsyncSession, principal: Principal, item_id: uuid.UUID, data: ItemProposeRequest
) -> SwapProposal:
    proposer_profile = await get_profile_by_principal(db, principal)
    await require_item_visible(db, item_id, proposer_profile.party_id)
    context = await load_requested_context(db, data.context, item_id)
    return await _propose(db, proposer_profile, item_id, data.offered_item_id, context)


async def list_swap_proposals_for_my_item(
    db: AsyncSession, principal: Principal, item_id: uuid.UUID
) -> list[SwapProposalOfferResponse]:
    """Every pending offer against `item_id`, for the item's own owner —
    lets the owner see every competing proposal at once on the `Moje
    rzeczy` tile and `acceptSwapProposal` whichever they prefer (the rest
    auto-reject, see `accept_swap_proposal`)."""
    owner_profile = await get_profile_by_principal(db, principal)
    preference = await repository.get_item_listing_preference(db, item_id)
    if preference is None or preference.owner_party_id != owner_profile.party_id:
        raise AccessDeniedException

    proposals = await repository.list_pending_swap_proposals_for_listing_item(db, item_id)
    offers = []
    for proposal in proposals:
        proposer_profile = await get_profile_by_party(db, proposal.proposer_party_id)
        offered_item = await circulation_bridge.get_item(db, proposal.offered_item_id)
        product = await product_bridge.get_product(db, offered_item.product_id)
        offers.append(
            SwapProposalOfferResponse(
                id=cast(uuid.UUID, proposal.id),
                proposer_party_id=proposal.proposer_party_id,
                proposer_display_name=proposer_profile.display_name,
                offered_item_id=proposal.offered_item_id,
                offered_product_name=product.name,
                created_at=proposal.created_at,
            )
        )
    return offers


async def _propose(
    db: AsyncSession,
    proposer_profile: UserProfile,
    listing_item_id: uuid.UUID,
    offered_item_id: uuid.UUID,
    context: ReservationContext,
) -> SwapProposal:
    """The SWAP counterpart of `_take`: locks only the
    proposer's own offered item (auto-confirmed on their own behalf, same
    their own consent already exists) and leaves the
    target listing item `AVAILABLE` until the owner explicitly
    `accept_swap_proposal`s or `reject_swap_proposal`s it; meanwhile the
    pending proposal blocks every other take or proposal on it."""
    context.require_open()
    await context.require_eligibility(db, proposer_profile.party_id)

    preference = await repository.get_item_listing_preference(db, listing_item_id)
    if preference is None:
        raise EntityNotFoundException("ItemListingPreference", listing_item_id)
    if preference.owner_party_id == proposer_profile.party_id:
        raise BusinessConflictException("Nie możesz wziąć własnej rzeczy")
    await context.require_eligibility(db, preference.owner_party_id)
    await require_placeable(db, context, preference, proposer_profile.party_id)

    listed_item = await circulation_bridge.get_item(db, listing_item_id)
    preference = await _lock_takeable_preference(db, listing_item_id)
    await require_placeable(db, context, preference, proposer_profile.party_id)
    if preference.mode != circulation_bridge.ReservationType.SWAP.value:
        raise BusinessConflictException("Ten sposób wzięcia rzeczy nie został zaoferowany")

    await _require_own_available_personal_item(
        db, proposer_profile.account_user_id, offered_item_id
    )

    offered_preference = await repository.get_item_listing_preference(db, offered_item_id)
    if (
        offered_preference is None
        or offered_preference.mode != circulation_bridge.ReservationType.SWAP.value
    ):
        raise BusinessConflictException(
            "Możesz zaproponować w zamian tylko rzecz oznaczoną jako do zamiany"
        )

    proposer_account_user_id = cast(uuid.UUID, proposer_profile.account_user_id)
    # `reserved_by_user_id` must be the party GAINING the item (the listing
    # owner, who will receive the proposer's offered item once fulfilled),
    # per `reservation_rules.py`'s documented invariant — NOT the proposer
    # themself, even though the proposer is the one whose action creates
    # this leg and who currently holds/contributes the item: fulfilment
    # moves each leg's item to `reserved_by_user_id`'s PERSONAL inventory.
    owner_profile_for_reservation = await get_profile_by_party(db, preference.owner_party_id)
    proposer_reservation = await circulation_bridge.create_reservation(
        db,
        item_id=offered_item_id,
        reservation_type=circulation_bridge.ReservationType.SWAP,
        reserved_by_user_id=cast(uuid.UUID, owner_profile_for_reservation.account_user_id),
        commit=False,
        **context.reservation_kwargs(),
    )
    # Confirming is keyed on the item's actual CURRENT physical holder
    # (derived from inventory, independent of `reserved_by_user_id` above)
    # — still the proposer at this point, since nothing has moved yet.
    await circulation_bridge.confirm_reservation(
        db,
        cast(uuid.UUID, proposer_reservation.id),
        acting_user_id=proposer_account_user_id,
        commit=False,
    )

    proposal = SwapProposal(
        proposer_party_id=proposer_profile.party_id,
        listing_item_id=listing_item_id,
        offered_item_id=offered_item_id,
        proposer_reservation_id=cast(uuid.UUID, proposer_reservation.id),
        status=SwapProposalStatus.PROPOSED,
    )
    db.add(proposal)
    # Flush (no commit) so `proposal.id` is populated from its sequence
    # before it's attached to the notification below — the trailing
    # `db.commit()` further down still persists both atomically.
    await db.flush()

    product = await product_bridge.get_product(db, listed_item.product_id)
    await notifications_bridge.create_notification(
        db,
        party_id=preference.owner_party_id,
        kind=NotificationKind.SWAP_PROPOSED,
        message=f'„{proposer_profile.display_name}" proponuje zamianę za: {product.name}',
        link_path=await item_path(db, listing_item_id),
        proposal_id=cast(uuid.UUID, proposal.id),
    )
    await db.commit()
    await db.refresh(proposal)
    return proposal


def is_listing_owner(preference: ItemListingPreference | None, party_id: uuid.UUID) -> bool:
    """Only the listing owner accepts or rejects a swap proposal on it."""
    return preference is not None and preference.owner_party_id == party_id


def _is_unaccepted_swap_leg(reservation: circulation_bridge.Reservation) -> bool:
    """A still-PROPOSED swap's proposer lock, which is never resolved alone."""
    return (
        reservation.reservation_type == circulation_bridge.ReservationType.SWAP
        and reservation.paired_reservation_id is None
    )


def _may_confirm(reservation: circulation_bridge.Reservation, acting_user_id: uuid.UUID) -> bool:
    """A GIFT is confirmed by its recipient only; either SWAP party may."""
    if reservation.reservation_type != circulation_bridge.ReservationType.GIFT:
        return True
    try:
        confirm_race_rules._require_recipient_to_confirm_gift(
            reservation.reserved_by_user_id, acting_user_id
        )
    except AccessDeniedException:
        return False
    return True


async def transaction_action_flags(
    db: AsyncSession, reservation: circulation_bridge.Reservation, acting_user_id: uuid.UUID
) -> tuple[bool, bool]:
    """`(can_confirm, can_cancel)` for a party of `reservation`: the
    non-raising read of `_resolve_transaction_reservations_for_action` and
    `confirm_transaction`'s GIFT rule, from the same predicates."""
    if reservation.status not in _ACTIVE_RESERVATION_STATUSES or _is_unaccepted_swap_leg(
        reservation
    ):
        return False, False
    context = await load_for_reservation(db, reservation, for_write=False)
    if context is None:
        return False, False
    try:
        context.require_ended()
    except BusinessConflictException:
        return False, False
    return _may_confirm(reservation, acting_user_id), True


async def _lock_pending_proposal(db: AsyncSession, proposal_id: uuid.UUID) -> SwapProposal:
    proposal = await repository.lock_swap_proposal(db, proposal_id)
    if proposal is None:
        raise EntityNotFoundException("SwapProposal", proposal_id)
    if proposal.status != SwapProposalStatus.PROPOSED:
        raise BusinessConflictException("Ta propozycja została już rozstrzygnięta")
    return proposal


async def accept_swap_proposal(
    db: AsyncSession, principal: Principal, proposal_id: uuid.UUID
) -> AcceptedSwapProposalResponse:
    """Creates the listing owner's own leg (auto-confirmed on their own
    behalf, same reasoning as `_propose`'s proposer leg) and pairs it
    with the proposer's already-locked leg by directly wiring
    `paired_reservation_id` on both ORM objects already in hand — circulation
    has no use case that pairs an existing leg with a new one, so the
    linkage is wired here directly."""
    owner_profile = await get_profile_by_principal(db, principal)
    proposal = await repository.get_swap_proposal(db, proposal_id)
    if proposal is None:
        raise EntityNotFoundException("SwapProposal", proposal_id)
    preference = await repository.get_item_listing_preference(db, proposal.listing_item_id)
    if not is_listing_owner(preference, owner_profile.party_id):
        raise AccessDeniedException
    if proposal.status != SwapProposalStatus.PROPOSED:
        raise BusinessConflictException("Ta propozycja została już rozstrzygnięta")

    listing_balance = await circulation_bridge.get_item_balance(db, proposal.listing_item_id)
    if listing_balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
        raise BusinessConflictException("Ta rzecz jest już zajęta")

    owner_account_user_id = cast(uuid.UUID, owner_profile.account_user_id)
    # Same fix as `_propose`: `reserved_by_user_id` is the GAINING
    # party — here, the proposer, who will receive the listing owner's item
    # once fulfilled — not the listing owner themself.
    proposer_profile_for_reservation = await get_profile_by_party(db, proposal.proposer_party_id)
    # Fetched ahead of the owner's own leg to reuse its context — both legs
    # of one swap always share the same term or event — and to reject a late
    # accept before any reservation is written. An event is locked FOR SHARE
    # so a concurrent delete cannot orphan the new leg.
    proposer_reservation = await circulation_bridge.get_reservation(
        db, proposal.proposer_reservation_id
    )
    context = await load_for_reservation(db, proposer_reservation, for_write=True)
    if context is None:
        raise BusinessConflictException("Wydarzenie tej zamiany zostało usunięte")
    # Locked after the event, the order `delete_event` takes them in, then
    # re-checked: a delete or another decision may have resolved it since.
    proposal = await _lock_pending_proposal(db, proposal_id)
    context.require_open()
    owner_reservation = await circulation_bridge.create_reservation(
        db,
        item_id=proposal.listing_item_id,
        reservation_type=circulation_bridge.ReservationType.SWAP,
        reserved_by_user_id=cast(uuid.UUID, proposer_profile_for_reservation.account_user_id),
        commit=False,
        **context.reservation_kwargs(),
    )
    # Confirming is keyed on the item's actual current physical holder
    # (still the owner at this point) — independent of `reserved_by_user_id`.
    await circulation_bridge.confirm_reservation(
        db,
        cast(uuid.UUID, owner_reservation.id),
        acting_user_id=owner_account_user_id,
        commit=False,
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
        message=clock.fit_notification_message(_swap_accepted_message(context, product.name)),
        link_path=await item_path(db, proposal.listing_item_id),
    )

    # The listing item now has an owner — every other still-`PROPOSED`
    # offer against it (only possible from before proposals blocked the
    # item) is moot. Auto-reject them (release each losing
    # proposer's locked offered item and let them know) instead of leaving
    # them stuck forever with a reserved item and no answer.
    other_pending = await repository.list_other_pending_swap_proposals_for_listing_item(
        db, proposal.listing_item_id, exclude_proposal_id=cast(uuid.UUID, proposal.id)
    )
    for other in other_pending:
        other_proposer_profile = await get_profile_by_party(db, other.proposer_party_id)
        await circulation_bridge.cancel_reservation(
            db,
            other.proposer_reservation_id,
            acting_user_id=cast(uuid.UUID, other_proposer_profile.account_user_id),
            commit=False,
        )
        other.status = SwapProposalStatus.REJECTED
        await notifications_bridge.create_notification(
            db,
            party_id=other.proposer_party_id,
            kind=NotificationKind.SWAP_REJECTED,
            message=f'Twoja propozycja zamiany za „{product.name}" została odrzucona — rzecz trafiła do kogoś innego',
            link_path=await item_path(db, other.listing_item_id),
        )

    await db.commit()
    await db.refresh(proposal)
    return AcceptedSwapProposalResponse(
        **SwapProposalResponse.model_validate(proposal).model_dump(),
        **await context.accepted_swap_fields(db),
    )


async def reject_swap_proposal(
    db: AsyncSession, principal: Principal, proposal_id: uuid.UUID
) -> SwapProposal:
    owner_profile = await get_profile_by_principal(db, principal)
    proposal = await repository.get_swap_proposal(db, proposal_id)
    if proposal is None:
        raise EntityNotFoundException("SwapProposal", proposal_id)
    preference = await repository.get_item_listing_preference(db, proposal.listing_item_id)
    if not is_listing_owner(preference, owner_profile.party_id):
        raise AccessDeniedException
    if proposal.status != SwapProposalStatus.PROPOSED:
        raise BusinessConflictException("Ta propozycja została już rozstrzygnięta")
    proposal = await _lock_pending_proposal(db, proposal_id)

    # Cancelled on the proposer's own behalf — the same self-reservation
    # convention `_propose` used to lock it (`reserved_by_user_id` ==
    # the item's own holder for this self-lock leg), so releasing it back
    # to `AVAILABLE` requires exactly that party per
    # `reservation_rules._require_party_to_reservation`.
    proposer_profile = await get_profile_by_party(db, proposal.proposer_party_id)
    await circulation_bridge.cancel_reservation(
        db,
        proposal.proposer_reservation_id,
        acting_user_id=cast(uuid.UUID, proposer_profile.account_user_id),
        commit=False,
    )

    proposal.status = SwapProposalStatus.REJECTED

    listed_item = await circulation_bridge.get_item(db, proposal.listing_item_id)
    product = await product_bridge.get_product(db, listed_item.product_id)
    await notifications_bridge.create_notification(
        db,
        party_id=proposal.proposer_party_id,
        kind=NotificationKind.SWAP_REJECTED,
        message=f'Twoja propozycja zamiany za „{product.name}" została odrzucona',
        link_path=await item_path(db, proposal.listing_item_id),
    )
    await db.commit()
    await db.refresh(proposal)
    return proposal


async def _resolve_transaction_reservations_for_action(
    db: AsyncSession, principal: Principal, reservation_id: uuid.UUID
) -> tuple[uuid.UUID, list[circulation_bridge.Reservation]]:
    """Shared gating sequence for both `confirm_transaction` and
    `cancel_transaction`: race-participant authorization (403 before any
    409), the already-resolved guard, the unaccepted-swap guard, and the
    context's has-come check (`require_ended`) — then returns the caller's account user id and the
    reservation(s) the caller should act on next (one, or two for a
    resolved SWAP pair via `paired_reservation_id`).
    Extracted per spec.md Bug #4's "shared gating helper" requirement:
    `cancel_transaction` needs the *exact* same SWAP-pairing resolution
    `confirm_transaction` already had (the highest-regression-risk logic in
    this area per gap analysis), and a second independent copy would let
    the two paths silently drift apart — the concrete second caller here is
    what justifies factoring this out now rather than speculatively, per
    `standards/global/minimal-implementation.md`.

    Callers own their own terminal step (circulation's `fulfill_exchange`
    vs. `cancel_exchange`) — this helper stops right before that.

    The term or event gated on is always the reservation's own context —
    never a caller-supplied one, which would let a party resolve an exchange
    early by naming some other, already-ended Term. Both dates are naive
    Europe/Warsaw wall-clock values compared with `clock.local_now()`."""
    profile = await get_profile_by_principal(db, principal)
    reservation = await circulation_bridge.get_reservation(db, reservation_id)
    # `giver_user_id` (captured at reservation creation), not the item's
    # current holder: for GIFT/SWAP possession changes permanently at
    # fulfillment, and the giver's `ItemListingPreference` is cleared then
    # too — yet the losing party's later call must still be recognized as a
    # participant so it gets `TermAlreadyResolvedException`, not a 403.
    acting_user_id = cast(uuid.UUID, profile.account_user_id)
    confirm_race_rules._require_race_participant(
        reservation.reserved_by_user_id,
        reservation.giver_user_id,
        acting_user_id=acting_user_id,
    )

    # Checked before the context: a resolved reservation may have none left
    # (its event was deleted) and must still answer "already resolved".
    if reservation.status not in _ACTIVE_RESERVATION_STATUSES:
        # The other party already resolved this transaction first.
        await notifications_bridge.create_notification(
            db,
            party_id=profile.party_id,
            kind=NotificationKind.TERM_ALREADY_RESOLVED,
            message="Ta transakcja została już rozstrzygnięta przez drugą stronę",
            link_path=await item_path(db, reservation.item_id),
        )
        await db.commit()
        raise TermAlreadyResolvedException

    # An unpaired SWAP leg is a still-PROPOSED swap's proposer lock: resolving
    # it alone would hand the proposer's item over without the listing owner
    # giving theirs. A proposal is only released via `reject_swap_proposal`.
    if _is_unaccepted_swap_leg(reservation):
        raise BusinessConflictException("Zamiana nie została zaakceptowana")

    # An open reservation without a term or event is personal, so only a
    # missing term or event row can leave it without a context.
    context = await load_for_reservation(db, reservation, for_write=False)
    if context is None:
        raise BusinessConflictException("Ta rezerwacja nie ma terminu ani wydarzenia")
    context.require_ended()

    reservations = [reservation]
    if (
        reservation.reservation_type == circulation_bridge.ReservationType.SWAP
        and reservation.paired_reservation_id is not None
    ):
        paired = await circulation_bridge.get_reservation(db, reservation.paired_reservation_id)
        reservations.append(paired)
    return acting_user_id, reservations


async def confirm_transaction(
    db: AsyncSession, principal: Principal, reservation_id: uuid.UUID
) -> circulation_bridge.Reservation:
    """Resolves a locked exchange (a GIFT leg, or a SWAP's paired legs)
    once its Term has ended: whichever party of the transaction calls this
    first wins the race and circulation's `fulfill_exchange` confirms and
    fulfils every leg in one commit, which also commits the listing
    preferences deleted here; the other party's later call is recognized
    as a no-op via `TermAlreadyResolvedException` rather than a raw,
    unexplained conflict. A GIFT is confirmed by its recipient only (403
    for the giver, who can still cancel); either SWAP party may confirm."""
    acting_user_id, reservations = await _resolve_transaction_reservations_for_action(
        db, principal, reservation_id
    )
    if not _may_confirm(reservations[0], acting_user_id):
        raise AccessDeniedException

    # A GIFT/SWAP permanently hands the item to someone else, so the giver's
    # standing listing mode no longer applies — deleted here so the item
    # isn't re-offered on the giver's behalf at their next Term, and the item
    # arrives at its new owner as a draft. The new owner sets their own mode
    # from `Moje rzeczy` if they want to pass it on.
    for r in reservations:
        preference = await repository.get_item_listing_preference(db, r.item_id)
        if preference is not None:
            await db.delete(preference)
            await circulation_bridge.set_item_listing_status(
                db, r.item_id, circulation_bridge.ItemListingStatus.DRAFT
            )
    await db.flush()

    fulfilled = await circulation_bridge.fulfill_exchange(
        db, [cast(uuid.UUID, r.id) for r in reservations], acting_user_id
    )
    return next(r for r in fulfilled if r.id == reservation_id)


async def cancel_transaction(
    db: AsyncSession, principal: Principal, reservation_id: uuid.UUID
) -> circulation_bridge.Reservation:
    """The cancel counterpart of `confirm_transaction`: same shared gating
    (race-participant, unaccepted-swap guard, term-ended, already-resolved) via
    `_resolve_transaction_reservations_for_action`, then circulation's
    `cancel_exchange` releases every resolved leg — both paired legs of a
    SWAP, not just the one the caller named — in one commit."""
    acting_user_id, reservations = await _resolve_transaction_reservations_for_action(
        db, principal, reservation_id
    )
    cancelled = await circulation_bridge.cancel_exchange(
        db, [cast(uuid.UUID, r.id) for r in reservations], acting_user_id
    )
    return next(r for r in cancelled if r.id == reservation_id)
