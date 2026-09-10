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


def _next_transaction_number() -> str:
    return f"TRX-{uuid.uuid4().hex[:12].upper()}"
