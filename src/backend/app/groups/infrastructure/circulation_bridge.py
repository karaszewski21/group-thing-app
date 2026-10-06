"""Anti-corruption layer over `app.circulation`: the ONLY `app.groups`
module that imports the circulation vertical. `application/pledge_fulfillment`
drives the Pledge->Reservation bridge exclusively through these thin
pass-throughs, and reads `ReservationStatus` from here rather than
importing circulation models directly. `application/term_item_listings`
and `application/attendance` drive the ItemListingPreference->Reservation
bridge the same way, via the `create_reservation`/`list_reservations`
pass-throughs and the re-exported `ReservationType`; a Term transaction is
resolved in one circulation commit through `fulfill_exchange`/
`cancel_exchange`. The photo-moderation withdraw reaches every item of a
product through `list_item_ids_for_product` and releases a rejected swap
proposer's reservation through `release_reservation`, the flush-only
cancel that stays inside the caller's transaction; the publish gate reads
the item through `get_item_for_share`, so a concurrent re-point serializes
against it."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation import service as circulation_service
from app.circulation.models import (
    BalanceStatus,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.circulation.schemas import CreateReservationRequest

__all__ = [
    "BalanceStatus",
    "InventoryItem",
    "InventoryType",
    "Reservation",
    "ReservationStatus",
    "ReservationType",
    "cancel_exchange",
    "cancel_reservation",
    "confirm_reservation",
    "create_lend_reservation",
    "create_reservation",
    "find_item_including_deleted",
    "find_personal_inventory",
    "fulfill_exchange",
    "get_inventory",
    "get_item",
    "get_item_balance",
    "get_item_for_share",
    "get_or_create_personal_inventory",
    "get_reservation",
    "list_active_hand_over_reservations_for_terms",
    "list_active_reservations_for_taker",
    "list_item_ids_for_product",
    "list_items_with_product_name",
    "list_lent_out_items_with_product_name",
    "list_reservations",
    "register_item",
    "release_reservation",
    "resolve_owning_inventory",
]


async def get_or_create_personal_inventory(db: AsyncSession, owner_user_id: uuid.UUID) -> Inventory:
    return await circulation_service.get_or_create_personal_inventory(db, owner_user_id)


async def register_item(
    db: AsyncSession, inventory_id: uuid.UUID, product_id: uuid.UUID, condition: str
) -> InventoryItem:
    return await circulation_service.register_item(db, inventory_id, product_id, condition)


async def create_lend_reservation(
    db: AsyncSession, *, item_id: uuid.UUID, reserved_by_user_id: uuid.UUID, term_id: uuid.UUID
) -> Reservation:
    return await circulation_service.create_lend_reservation(
        db, item_id=item_id, reserved_by_user_id=reserved_by_user_id, term_id=term_id
    )


async def create_reservation(
    db: AsyncSession,
    *,
    item_id: uuid.UUID,
    reservation_type: ReservationType,
    reserved_by_user_id: uuid.UUID,
    term_id: uuid.UUID | None = None,
) -> Reservation:
    """Generic reservation creation (`LEND`/`GIFT`/`SWAP` for the exchange
    mechanism — `create_lend_reservation` above stays as the narrower
    Pledge-only helper). Used by `app.groups.application.term_item_listings`.

    `term_id` is required for every `reservation_type` except `RETURN`
    (`CreateReservationRequest`'s own validator enforces this) — no caller
    in this module creates a bare RETURN through here today, but the
    parameter stays optional to mirror the schema it wraps."""
    return await circulation_service.create_reservation(
        db,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=reservation_type,
            reserved_by_user_id=reserved_by_user_id,
            term_id=term_id,
        ),
    )


async def get_reservation(db: AsyncSession, reservation_id: uuid.UUID) -> Reservation:
    return await circulation_service.get_reservation(db, reservation_id)


async def confirm_reservation(db: AsyncSession, reservation_id: uuid.UUID, acting_user_id: uuid.UUID) -> Reservation:
    """Used by `pledge_fulfillment`/`term_item_listings` to auto-confirm a
    just-created reservation on behalf of the item's current holder, whose
    consent already exists — a published `ItemListingPreference`, or the
    guardian's own act of registering/offering the item for a Pledge —
    before circulation's own `confirm_reservation` was tightened to require
    exactly that party (see `standards/backend/security.md`'s "only a
    reservation's holder/recipient" note)."""
    return await circulation_service.confirm_reservation(db, reservation_id, acting_user_id)


async def cancel_reservation(db: AsyncSession, reservation_id: uuid.UUID, acting_user_id: uuid.UUID) -> Reservation:
    """Thin pass-through, same shape as `confirm_reservation` above."""
    return await circulation_service.cancel_reservation(db, reservation_id, acting_user_id)


async def release_reservation(
    db: AsyncSession, reservation_id: uuid.UUID, acting_user_id: uuid.UUID
) -> Reservation:
    """Same cancel as `cancel_reservation` but flush-only: used by the
    photo-moderation withdraw, whose caller owns the single commit."""
    return await circulation_service.release_reservation(db, reservation_id, acting_user_id)


async def list_item_ids_for_product(db: AsyncSession, product_id: uuid.UUID) -> list[uuid.UUID]:
    """Every item of the product, soft-deleted ones included."""
    return await circulation_service.list_item_ids_for_product(db, product_id)


async def fulfill_exchange(
    db: AsyncSession, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID
) -> list[Reservation]:
    """Used by `term_item_listings.confirm_transaction`. Commits the
    session, including the caller's flushed changes — see
    `app.circulation.service.fulfill_exchange`."""
    return await circulation_service.fulfill_exchange(db, reservation_ids, acting_user_id)


async def cancel_exchange(
    db: AsyncSession, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID
) -> list[Reservation]:
    """Used by `term_item_listings.cancel_transaction`; same commit contract
    as `fulfill_exchange`."""
    return await circulation_service.cancel_exchange(db, reservation_ids, acting_user_id)


async def list_reservations(db: AsyncSession, item_id: uuid.UUID) -> list[Reservation]:
    """Used by `application/term_item_listings.py` to derive an item's
    current listing status (active or most-recently-fulfilled reservation)
    since that's no longer cached on a stored listing row."""
    return await circulation_service.list_reservations(db, item_id)


async def list_active_reservations_for_taker(
    db: AsyncSession, account_user_id: uuid.UUID
) -> list[Reservation]:
    """Used by `application/term_item_listings.py`'s
    `list_my_active_taken_term_item_listings` — the availability-independent
    taker-side counterpart to `list_reservations` above."""
    return await circulation_service.list_active_reservations_for_taker(db, account_user_id)


async def list_active_hand_over_reservations_for_terms(
    db: AsyncSession, term_ids: list[uuid.UUID]
) -> list[Reservation]:
    """Used by `application/term_end_scan.py`: the still-open GIFT/LEND
    reservations of the just-ended Terms, in one query."""
    return await circulation_service.list_active_hand_over_reservations_for_terms(db, term_ids)


async def find_personal_inventory(db: AsyncSession, owner_user_id: uuid.UUID) -> Inventory | None:
    """The user's PERSONAL inventory, or `None` if they have never created
    one — read-only, unlike `get_or_create_personal_inventory`."""
    inventories = await circulation_service.list_inventories(db, owner_user_id)
    return next(
        (inv for inv in inventories if inv.inventory_type == InventoryType.PERSONAL), None
    )


async def list_items_with_product_name(
    db: AsyncSession, inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """Used by `list_my_inventory_items`: items physically in `inventory_id`."""
    return await circulation_service.list_items_with_product_name(db, inventory_id)


async def list_lent_out_items_with_product_name(
    db: AsyncSession, home_inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """Used by `list_my_lent_out_items`: items lent out of `home_inventory_id`."""
    return await circulation_service.list_lent_out_items_with_product_name(
        db, home_inventory_id
    )


async def get_item(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    return await circulation_service.get_item(db, item_id)


async def get_item_for_share(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    """`get_item` under a FOR SHARE item row lock — see
    `app.circulation.application.inventory_items.get_item_for_share`."""
    return await circulation_service.get_item_for_share(db, item_id)


async def find_item_including_deleted(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem | None:
    """Used by the photo-moderation withdraw, which also reaches soft-deleted
    items."""
    return await circulation_service.find_item_including_deleted(db, item_id)


async def get_item_balance(db: AsyncSession, item_id: uuid.UUID) -> InventoryBalance:
    return await circulation_service.get_item_balance(db, item_id)


async def get_inventory(db: AsyncSession, inventory_id: uuid.UUID) -> Inventory:
    return await circulation_service.get_inventory(db, inventory_id)


async def resolve_owning_inventory(db: AsyncSession, item: InventoryItem) -> Inventory:
    """The item's permanent owning inventory — not its current physical
    location, which may be a borrower's VIRTUAL inventory during a loan.
    See `app.circulation.application.inventory_items.resolve_owning_inventory`."""
    return await circulation_service.resolve_owning_inventory(db, item)
