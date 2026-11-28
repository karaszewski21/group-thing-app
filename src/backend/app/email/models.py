"""Email ORM models (migration 0110).

`EmailMessage` is one outgoing mail and its delivery state. The recipient
address is never stored: it is read from the profile at send time.
`notification_id` and `source_message_id` are loose pointers with no FK,
because collapsed bells delete their notification row. `EmailPreference` is
one opt-out switch per `(party, category)`; a missing row means the
category's default. `EmailSuppression` blocks a normalised address after a
bounce or a complaint.

Cross-module references (`parties.id`) are plain FK-id columns, never a
`relationship()` crossing the module boundary, per
`standards/backend/models.md`.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
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


class EmailStream(enum.StrEnum):
    TRANSACTIONAL = "TRANSACTIONAL"
    NOTIFICATION = "NOTIFICATION"


class EmailCategory(enum.StrEnum):
    """The full preference catalogue. `ALL` exists only as a preference row;
    a NOTIFICATION message carries one of the other categories."""

    ALL = "ALL"
    RESERVATIONS = "RESERVATIONS"
    MEETINGS = "MEETINGS"
    WANTS = "WANTS"
    MESSAGES = "MESSAGES"
    ORGANIZER_DIGESTS = "ORGANIZER_DIGESTS"


class EmailTemplate(enum.StrEnum):
    VERIFY_EMAIL = "verify_email"
    PASSWORD_RESET = "password_reset"
    PASSWORD_CHANGED = "password_changed"
    NOTIFICATION = "notification"


class EmailStatus(enum.StrEnum):
    PENDING = "PENDING"
    SENDING = "SENDING"
    SENT = "SENT"
    DELIVERED = "DELIVERED"
    BOUNCED = "BOUNCED"
    COMPLAINED = "COMPLAINED"
    SKIPPED = "SKIPPED"
    FAILED = "FAILED"


class EmailSkipReason(enum.StrEnum):
    NO_ADDRESS = "no_address"
    UNVERIFIED = "unverified"
    ORGANIZATION = "organization"
    SUPPRESSED = "suppressed"
    CATEGORY_DISABLED = "category_disabled"
    DAILY_CAP = "daily_cap"
    EXPIRED = "expired"


class SuppressionReason(enum.StrEnum):
    BOUNCE = "BOUNCE"
    COMPLAINT = "COMPLAINT"


class EmailMessage(BaseEntity):
    """One outgoing mail. `category` is NULL exactly for TRANSACTIONAL mail;
    `skip_reason` is set exactly for SKIPPED. `payload` holds the bell's
    `message`/`link_path` or the account mail's `token` (raw, removed at any
    final state), `google_only` and `changed_at`. `last_error` is a code
    only, never an address or content."""

    __tablename__ = "email_messages"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_email_messages_idempotency_key"),
        CheckConstraint(
            "stream IN ('TRANSACTIONAL', 'NOTIFICATION')", name="ck_email_messages_stream"
        ),
        CheckConstraint(
            "(stream = 'TRANSACTIONAL') = (category IS NULL)",
            name="ck_email_messages_category_stream",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', "
            "'SKIPPED', 'FAILED')",
            name="ck_email_messages_status",
        ),
        CheckConstraint(
            "skip_reason IS NULL OR skip_reason IN ('no_address', 'unverified', "
            "'organization', 'suppressed', 'category_disabled', 'daily_cap', 'expired')",
            name="ck_email_messages_skip_reason",
        ),
        CheckConstraint(
            "(status = 'SKIPPED') = (skip_reason IS NOT NULL)",
            name="ck_email_messages_skipped_reason",
        ),
        CheckConstraint("attempts >= 0", name="ck_email_messages_attempts"),
        Index("ix_email_messages_party_id", "party_id"),
        Index(
            "ix_email_messages_pending_send_after",
            "send_after",
            postgresql_where=text("status = 'PENDING'"),
        ),
        Index(
            "ix_email_messages_sending_claimed_at",
            "claimed_at",
            postgresql_where=text("status = 'SENDING'"),
        ),
        Index("ix_email_messages_sent_at", "sent_at"),
        Index("ix_email_messages_provider_message_id", "provider_message_id"),
    )

    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_email_messages_party_id_parties"),
        nullable=False,
    )
    stream: Mapped[EmailStream] = mapped_column(_enum_column(EmailStream, 20), nullable=False)
    category: Mapped[EmailCategory | None] = mapped_column(
        _enum_column(EmailCategory, 30), nullable=True
    )
    template: Mapped[EmailTemplate] = mapped_column(_enum_column(EmailTemplate, 50), nullable=False)
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    notification_kind: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    status: Mapped[EmailStatus] = mapped_column(_enum_column(EmailStatus, 20), nullable=False)
    skip_reason: Mapped[EmailSkipReason | None] = mapped_column(
        _enum_column(EmailSkipReason, 30), nullable=True
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    send_after: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    event_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    """The time of the last applied webhook event."""
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    """Normalised without the surrounding `<>`."""
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `idempotency_key`."""
        if not isinstance(other, EmailMessage):
            return NotImplemented
        return self.idempotency_key == other.idempotency_key

    def __hash__(self) -> int:
        return hash(self.idempotency_key)


class EmailPreference(BaseEntity):
    __tablename__ = "email_preferences"
    __table_args__ = (
        UniqueConstraint("party_id", "category", name="uq_email_preferences_party_id_category"),
        CheckConstraint(
            "category IN ('ALL', 'RESERVATIONS', 'MEETINGS', 'WANTS', 'MESSAGES', "
            "'ORGANIZER_DIGESTS')",
            name="ck_email_preferences_category",
        ),
    )

    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_email_preferences_party_id_parties"),
        nullable=False,
    )
    category: Mapped[EmailCategory] = mapped_column(_enum_column(EmailCategory, 30), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `(party_id, category)`."""
        if not isinstance(other, EmailPreference):
            return NotImplemented
        return (self.party_id, self.category) == (other.party_id, other.category)

    def __hash__(self) -> int:
        return hash((self.party_id, self.category))


class EmailSuppression(BaseEntity):
    """`address_normalized` is `lower(btrim(address))`, enforced by a CHECK.
    `source_message_id` is a loose pointer to the `email_messages` row whose
    webhook event caused the suppression."""

    __tablename__ = "email_suppressions"
    __table_args__ = (
        UniqueConstraint("address_normalized", name="uq_email_suppressions_address_normalized"),
        CheckConstraint(
            "address_normalized = lower(btrim(address_normalized))",
            name="ck_email_suppressions_address_normalized",
        ),
        CheckConstraint("reason IN ('BOUNCE', 'COMPLAINT')", name="ck_email_suppressions_reason"),
    )

    address_normalized: Mapped[str] = mapped_column(String(320), nullable=False)
    reason: Mapped[SuppressionReason] = mapped_column(
        _enum_column(SuppressionReason, 20), nullable=False
    )
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `address_normalized`."""
        if not isinstance(other, EmailSuppression):
            return NotImplemented
        return self.address_normalized == other.address_normalized

    def __hash__(self) -> int:
        return hash(self.address_normalized)
