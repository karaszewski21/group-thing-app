"""Pure, already-standalone circulation-domain helpers: the party-to-
reservation authorization predicates, the exchange-shape rule, the
raw-route reservation-type rule and the transaction-number generator. No
`db`, no ORM queries."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.circulation.models import Reservation, ReservationType
from app.core.errors import AccessDeniedException, BusinessConflictException


def _require_party_to_reservation(
    reservation: Reservation, holder_user_id: uuid.UUID, acting_user_id: uuid.UUID
) -> None:
    if acting_user_id not in (reservation.reserved_by_user_id, holder_user_id):
        raise AccessDeniedException


def _require_party_to_any_reservation(
    reservations: Sequence[Reservation], acting_user_id: uuid.UUID
) -> None:
    """Exchange-level gate: the actor must be the giver or the recipient of
    at least one leg. The legs themselves then run on behalf of each item's
    holder."""
    if not any(
        acting_user_id in (r.giver_user_id, r.reserved_by_user_id) for r in reservations
    ):
        raise AccessDeniedException


def _require_exchange_legs(reservations: Sequence[Reservation]) -> None:
    """An exchange is a single LEND or GIFT leg, or exactly two SWAP legs
    paired with each other."""
    if len(reservations) == 1 and reservations[0].reservation_type in (
        ReservationType.LEND,
        ReservationType.GIFT,
    ):
        return
    if len(reservations) == 2:
        first, second = reservations
        if (
            first.reservation_type == second.reservation_type == ReservationType.SWAP
            and first.paired_reservation_id == second.id
            and second.paired_reservation_id == first.id
        ):
            return
    raise BusinessConflictException(
        "Wymiana to jedna rezerwacja LEND/GIFT albo dwie sparowane rezerwacje SWAP"
    )


def _require_holder_to_confirm(holder_user_id: uuid.UUID, acting_user_id: uuid.UUID) -> None:
    """Mutual-consent gate for `confirm`: `reserved_by_user_id` is always
    the party *gaining* the item as a result of this reservation (the one
    who proposed it — see `create_reservation`/`take_item_listing`), and
    `holder_user_id` is always the party *giving it up* — two always-
    distinct roles (the fulfilment's movement always leaves from the
    holder's inventory account, e.g. a LEND moves the item from the
    holder's PERSONAL to `reserved_by`'s VIRTUAL). Restricting `confirm`
    to the holder alone therefore always requires the *other* side to
    agree, for every reservation type — including each leg of a `SWAP`,
    where each leg's holder is whoever currently possesses that specific
    item."""
    if acting_user_id != holder_user_id:
        raise AccessDeniedException


def require_raw_route_reservation_type(reservation_type: ReservationType) -> None:
    """The raw `/api/reservations` write routes only serve the borrower's
    one-sided RETURN ("Oddaję"). Every other type is created and resolved by
    the groups exchange flow (take -> Term ends -> `confirm-transaction`),
    so the raw routes reject it outright. Applied by the router only — the
    shared transitions stay type-agnostic because groups drives them too."""
    if reservation_type != ReservationType.RETURN:
        raise AccessDeniedException("Surowe trasy rezerwacji obsługują tylko zwrot (RETURN)")


def _next_transaction_number() -> str:
    return f"TRX-{uuid.uuid4().hex[:12].upper()}"
