"""Pure privacy rules of the item page: who is shown as "Ty", by name or
as "inna rodzina", the server-built history descriptions, and the current
status derivation. No `db`, no ORM queries.

Labelling is strictly per user: a counterparty's display name is shown only
to a viewer who took part in that event (or reservation); everyone else is
"inna rodzina". A viewer of `None` (a principal with no `User`) never
matches anyone."""

from __future__ import annotations

import enum
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from app.circulation.models import BalanceStatus, MovementType, Reservation, ReservationType

SELF_LABEL = "Ty"
OTHER_FAMILY_LABEL = "inna rodzina"

_TERM_DATED_MOVEMENTS = frozenset({MovementType.GIFT, MovementType.LEND, MovementType.SWAP})


class ItemStatusCode(enum.StrEnum):
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    IN_TRANSIT = "IN_TRANSIT"
    RETURNING = "RETURNING"
    PROPOSED_SWAP = "PROPOSED_SWAP"
    LENT = "LENT"
    DELETED = "DELETED"


@dataclass(frozen=True)
class ItemStatus:
    code: ItemStatusCode
    term_occurs_on: datetime | None = None
    due_date: datetime | None = None
    counterparty_label: str | None = None


def label(
    subject: uuid.UUID | None,
    viewer: uuid.UUID | None,
    participants: Collection[uuid.UUID | None],
    display_name: str | None,
) -> str:
    """"Ty" for the viewer themself; the subject's name when the viewer took
    part (falling back to "inna rodzina" without a profile); otherwise
    "inna rodzina"."""
    if viewer is None:
        return OTHER_FAMILY_LABEL
    if subject == viewer:
        return SELF_LABEL
    if viewer in participants:
        return display_name or OTHER_FAMILY_LABEL
    return OTHER_FAMILY_LABEL


def history_description(movement_type: MovementType, from_label: str, to_label: str) -> str:
    if movement_type == MovementType.REGISTER:
        return f"Dodana przez: {to_label}"
    if movement_type == MovementType.REMOVE:
        return f"Usunięta przez: {from_label}"
    return f"{from_label} → {to_label}"


def history_term_occurs_on(
    movement_type: MovementType, occurs_on: datetime | None
) -> datetime | None:
    """Only GIFT/LEND/SWAP carry their term date: a RETURN inherits its
    LEND's `term_id`, so its date would mislead."""
    return occurs_on if movement_type in _TERM_DATED_MOVEMENTS else None


def newest_reservation(reservations: Sequence[Reservation]) -> Reservation | None:
    return max(reservations, key=lambda r: r.reserved_at) if reservations else None


def derive_status(
    *,
    deleted: bool,
    balance_status: BalanceStatus | None,
    due_date: datetime | None,
    reservation: Reservation | None,
    term_occurs_on: datetime | None,
    viewer: uuid.UUID | None,
    holder_user_id: uuid.UUID,
    home_owner_user_id: uuid.UUID,
    display_names: Mapping[uuid.UUID, str],
) -> ItemStatus:
    """The "Aktualny status" block. `reservation` is the newest active
    reservation (see `newest_reservation`) and `term_occurs_on` its term
    date; `holder_user_id` owns the item's current inventory (the borrower
    while lent) and `home_owner_user_id` its permanent one."""
    if deleted:
        return ItemStatus(ItemStatusCode.DELETED)
    if balance_status in (None, BalanceStatus.AVAILABLE, BalanceStatus.RETURNED):
        return ItemStatus(ItemStatusCode.AVAILABLE)
    if balance_status == BalanceStatus.LENT:
        return ItemStatus(
            ItemStatusCode.LENT,
            due_date=due_date,
            counterparty_label=label(
                holder_user_id,
                viewer,
                {holder_user_id, home_owner_user_id},
                display_names.get(holder_user_id),
            ),
        )
    balance_code = ItemStatusCode(balance_status.value)
    if reservation is None:
        return ItemStatus(balance_code)
    recipient = reservation.reserved_by_user_id
    counterparty = label(
        recipient,
        viewer,
        {recipient, reservation.giver_user_id},
        display_names.get(recipient),
    )
    if reservation.reservation_type == ReservationType.RETURN:
        return ItemStatus(ItemStatusCode.RETURNING, counterparty_label=counterparty)
    if (
        reservation.reservation_type == ReservationType.SWAP
        and reservation.paired_reservation_id is None
    ):
        return ItemStatus(ItemStatusCode.PROPOSED_SWAP, counterparty_label=counterparty)
    return ItemStatus(balance_code, term_occurs_on=term_occurs_on, counterparty_label=counterparty)
