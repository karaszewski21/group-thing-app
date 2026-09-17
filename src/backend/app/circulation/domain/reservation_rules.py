"""Pure, already-standalone circulation-domain helpers: the party-to-
reservation authorization predicate and the transaction-number generator.
No `db`, no ORM queries."""

from __future__ import annotations

import uuid

from app.circulation.models import Reservation
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


def _next_transaction_number() -> str:
    return f"TRX-{uuid.uuid4().hex[:12].upper()}"
