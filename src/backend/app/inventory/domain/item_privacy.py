"""Pure privacy rules of the item page: who is shown as "Ty", by name or
as "inna rodzina", the server-built history descriptions, and the current
status derivation. No `db`, no ORM queries.

Labelling is per user. Who is reserving an item (RESERVED, IN_TRANSIT,
PROPOSED_SWAP) is deliberately shown by name to every logged-in viewer
(`reserver_label`), so a list's "Zarezerwowana · przez …" badge and the item
page agree; an anonymous viewer sees no name. Everything else — the borrower
of a LENT item, the RETURNING counterparty and history — keeps the stricter
rule: the display name only for a viewer who took part in that event (or
reservation), "inna rodzina" for everyone else (`label`). A viewer of `None`
(anonymous, or a principal with no `User`) never matches anyone."""

from __future__ import annotations

import enum
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from app.inventory.models import BalanceStatus, MovementType, Reservation, ReservationType

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
class ReservationTerm:
    """The reservation's Term and the group it belongs to."""

    occurs_on: datetime
    group_id: uuid.UUID
    group_name: str


@dataclass(frozen=True)
class ReservationEvent:
    """The reservation's Event and its author's public-URL slug."""

    starts_at: datetime
    name: str
    author_slug: str


@dataclass(frozen=True)
class ItemStatus:
    code: ItemStatusCode
    term_occurs_on: datetime | None = None
    due_date: datetime | None = None
    counterparty_label: str | None = None
    term_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None
    group_name: str | None = None
    event_id: uuid.UUID | None = None
    event_slug: str | None = None
    personal_pickup: bool = False


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


def reserver_label(
    recipient: uuid.UUID, viewer: uuid.UUID | None, display_name: str | None
) -> str | None:
    """Who receives a reserved item: `None` for an anonymous viewer, "Ty"
    for the recipient, otherwise their name (falling back to "inna
    rodzina" without a profile)."""
    if viewer is None:
        return None
    if recipient == viewer:
        return SELF_LABEL
    return display_name or OTHER_FAMILY_LABEL


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
    term: ReservationTerm | None,
    viewer: uuid.UUID | None,
    event: ReservationEvent | None = None,
    holder_user_id: uuid.UUID,
    home_owner_user_id: uuid.UUID,
    display_names: Mapping[uuid.UUID, str],
) -> ItemStatus:
    """The "Aktualny status" block. `reservation` is the newest active
    reservation (see `newest_reservation`) and `term` or `event` its context,
    whose date is shown to everyone but whose id, name and link are shown
    only to the reservation's two parties (a reservation with neither is a
    personal pickup); `holder_user_id`
    owns the item's current inventory (the borrower while lent) and
    `home_owner_user_id` its permanent one."""
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
    if reservation.reservation_type == ReservationType.RETURN:
        return ItemStatus(
            ItemStatusCode.RETURNING,
            counterparty_label=label(
                recipient,
                viewer,
                {recipient, reservation.giver_user_id},
                display_names.get(recipient),
            ),
        )
    counterparty = reserver_label(recipient, viewer, display_names.get(recipient))
    if (
        reservation.reservation_type == ReservationType.SWAP
        and reservation.paired_reservation_id is None
    ):
        return ItemStatus(ItemStatusCode.PROPOSED_SWAP, counterparty_label=counterparty)
    is_party = viewer in {recipient, reservation.giver_user_id}
    if term is not None:
        if not is_party:
            return ItemStatus(
                balance_code, term_occurs_on=term.occurs_on, counterparty_label=counterparty
            )
        return ItemStatus(
            balance_code,
            term_occurs_on=term.occurs_on,
            counterparty_label=counterparty,
            term_id=reservation.term_id,
            group_id=term.group_id,
            group_name=term.group_name,
        )
    if event is not None:
        if not is_party:
            return ItemStatus(
                balance_code, term_occurs_on=event.starts_at, counterparty_label=counterparty
            )
        return ItemStatus(
            balance_code,
            term_occurs_on=event.starts_at,
            counterparty_label=counterparty,
            group_name=event.name,
            event_id=reservation.event_id,
            event_slug=event.author_slug,
        )
    return ItemStatus(
        balance_code,
        counterparty_label=counterparty,
        personal_pickup=reservation.term_id is None and reservation.event_id is None,
    )
