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
    Term's organizer, `NEEDED_ITEM_REMOVED` goes to the affected pledger."""

    PLEDGE_CREATED = "PLEDGE_CREATED"
    PLEDGE_WITHDRAWN = "PLEDGE_WITHDRAWN"
    PLEDGE_ITEM_REGISTERED = "PLEDGE_ITEM_REGISTERED"
    NEEDED_ITEM_REMOVED = "NEEDED_ITEM_REMOVED"


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
