"""Pure, already-standalone circulation-domain helpers: the party-to-
reservation authorization predicates, the raw-route reservation-type rule
and the transaction-number generator. No `db`, no ORM queries."""

from __future__ import annotations

import uuid

from app.circulation.models import Reservation, ReservationType
from app.core.errors import AccessDeniedException


def _require_party_to_reservation(
    reservation: Reservation, holder_user_id: int, acting_user_id: int
) -> None:
    if acting_user_id not in (reservation.reserved_by_user_id, holder_user_id):
        raise AccessDeniedException


def _require_holder_to_confirm(holder_user_id: int, acting_user_id: int) -> None:
    """Mutual-consent gate for `confirm`: `reserved_by_user_id` is always
    the party *gaining* the item as a result of this reservation (the one
    who proposed it — see `create_reservation`/`take_item_listing`), and
    `holder_user_id` is always the party *giving it up* — two always-
    distinct roles (accounting always credits the holder, never
    `reserved_by`, per `ledger.py`). Restricting `confirm` to the holder
    alone therefore always requires the *other* side to agree, for every
    reservation type — including each leg of a `SWAP`, where each leg's
    holder is whoever currently possesses that specific item."""
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
