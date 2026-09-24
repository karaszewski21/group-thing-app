"""`app.notifications` bounded context: a per-recipient in-app inbox.

A `Notification` is a fully pre-rendered message (`message` is the exact
Polish string the producer built — no client-side templating, no join to
display) addressed to one `parties.id`. Producers in other verticals write
through `app.notifications.service.create_notification` (via an ACL, e.g.
`app.groups.infrastructure.notifications_bridge`), never by importing this
module's internals.

Cross-module reference (`parties.id`) is a plain FK-id column, never a
`relationship()` crossing the module boundary, per
`standards/backend/models.md`."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class NotificationKind(enum.StrEnum):
    """What happened. The recipient differs by kind: the first three go to a
    Term's organizer, `NEEDED_ITEM_REMOVED` goes to the affected pledger,
    `TERM_ITEM_LISTING_TAKEN` goes to the lister whose offered item was just
    taken by another attendee, `SWAP_PROPOSED` goes to the target listing's
    owner, `SWAP_ACCEPTED`/`SWAP_REJECTED` go back to the swap's proposer,
    `TERM_CONFIRMATION_NEEDED` goes to a party with a locked leg (swap or
    giveaway) once its Term ends, and `TERM_ALREADY_RESOLVED` goes to the
    other party in a swap/giveaway when they act after the first party
    already resolved the same transaction. `GROUP_JOIN_REQUESTED` goes to a
    private Circle's active organizer, and `GROUP_JOIN_APPROVED`/
    `GROUP_JOIN_REJECTED` go back to the request's requester."""

    PLEDGE_CREATED = "PLEDGE_CREATED"
    PLEDGE_WITHDRAWN = "PLEDGE_WITHDRAWN"
    PLEDGE_ITEM_REGISTERED = "PLEDGE_ITEM_REGISTERED"
    NEEDED_ITEM_REMOVED = "NEEDED_ITEM_REMOVED"
    TERM_ITEM_LISTING_TAKEN = "TERM_ITEM_LISTING_TAKEN"
    SWAP_PROPOSED = "SWAP_PROPOSED"
    SWAP_ACCEPTED = "SWAP_ACCEPTED"
    SWAP_REJECTED = "SWAP_REJECTED"
    TERM_CONFIRMATION_NEEDED = "TERM_CONFIRMATION_NEEDED"
    TERM_ALREADY_RESOLVED = "TERM_ALREADY_RESOLVED"
    GROUP_JOIN_REQUESTED = "GROUP_JOIN_REQUESTED"
    GROUP_JOIN_APPROVED = "GROUP_JOIN_APPROVED"
    GROUP_JOIN_REJECTED = "GROUP_JOIN_REJECTED"


class Notification(BaseEntity):
    __tablename__ = "notifications"
    __sequence_name__ = "notification_seq"

    party_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("parties.id", name="fk_notifications_party_id_parties"),
        nullable=False,
    )
    kind: Mapped[NotificationKind] = mapped_column(
        _enum_column(NotificationKind, 30), nullable=False
    )
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    # In-app route the bell entry links to (e.g. a public term page, or
    # "/panel"). `None` = no navigation target.
    link_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    # Loose cross-BC pointer (no FK, per `standards/backend/models.md`'s
    # `ItemListingPreference`/`Pledge.resolved_reservation_id` convention) at
    # `app.groups.models.SwapProposal.id`. Populated only for `SWAP_PROPOSED`
    # so the frontend's global pending-actions modal can call
    # `acceptSwapProposal`/`rejectSwapProposal` directly instead of
    # deep-linking to the term page. `None` for every other kind.
    proposal_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Loose cross-BC pointer (no FK, same convention as `proposal_id`) at
    # `app.groups.models.GroupJoinRequest.id`. Populated only for the
    # `GROUP_JOIN_*` kinds; `None` for every other kind.
    join_request_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
