"""Pure rules of the email module: which bell kinds are mailed, the
preference defaults, the idempotency keys and the timing constants.

Bell kinds arrive as plain strings, so this module never imports
`app.notifications`. Datetimes here are naive; callers pass the Warsaw wall
clock where a helper says `local_dt` and naive UTC elsewhere.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta
from typing import NamedTuple

from app.email.models import EmailCategory


class KindRule(NamedTuple):
    category: EmailCategory
    subject: str
    cta_label: str


WANT_MATCH_KIND = "WANT_MATCH_FOUND"
TERM_CONFIRMATION_KIND = "TERM_CONFIRMATION_NEEDED"

KIND_RULES: dict[str, KindRule] = {
    "TERM_ITEM_LISTING_TAKEN": KindRule(
        EmailCategory.RESERVATIONS, "Ktoś wziął Twoją rzecz", "Zobacz szczegóły"
    ),
    "SWAP_PROPOSED": KindRule(
        EmailCategory.RESERVATIONS, "Ktoś chce wymienić się z Tobą", "Zobacz propozycję"
    ),
    "SWAP_ACCEPTED": KindRule(
        EmailCategory.RESERVATIONS, "Twoja propozycja wymiany została przyjęta", "Zobacz wymianę"
    ),
    "SWAP_REJECTED": KindRule(
        EmailCategory.RESERVATIONS, "Twoja propozycja wymiany została odrzucona", "Zobacz szczegóły"
    ),
    TERM_CONFIRMATION_KIND: KindRule(
        EmailCategory.RESERVATIONS, "Potwierdź, czy przekazanie się odbyło", "Potwierdź"
    ),
    "RESERVATION_CANCELLED": KindRule(
        EmailCategory.RESERVATIONS, "Rezerwacja została anulowana", "Zobacz szczegóły"
    ),
    WANT_MATCH_KIND: KindRule(EmailCategory.WANTS, "Mamy coś, czego szukasz", "Zobacz"),
}

WANTS_DEFAULT_ENABLED = True

CATEGORY_DEFAULTS: dict[EmailCategory, bool] = {
    EmailCategory.RESERVATIONS: True,
    EmailCategory.WANTS: WANTS_DEFAULT_ENABLED,
    EmailCategory.MEETINGS: True,
    EmailCategory.MESSAGES: False,
    EmailCategory.ORGANIZER_DIGESTS: False,
}

VISIBLE_CATEGORIES: tuple[EmailCategory, ...] = (EmailCategory.RESERVATIONS, EmailCategory.WANTS)

CATEGORY_LABELS: dict[EmailCategory, str] = {
    EmailCategory.RESERVATIONS: "Rezerwacje i wymiany",
    EmailCategory.WANTS: "Szukam",
}

BATCH_SIZE = 50
BACKOFF_MINUTES = (1, 5, 15, 60, 240)
MAX_ATTEMPTS = 6
STUCK_SENDING_AFTER = timedelta(minutes=10)
NOTIFICATION_TTL = timedelta(hours=24)
QUIET_HOURS_START = time(22, 0)
QUIET_HOURS_END = time(7, 0)
VERIFY_TOKEN_TTL = timedelta(hours=48)
RESET_TOKEN_TTL = timedelta(hours=1)
TOKEN_REQUEST_MIN_INTERVAL = timedelta(seconds=60)
TOKEN_REQUESTS_PER_HOUR = 5
WEBHOOK_MAX_SKEW = timedelta(minutes=5)
# Seconds, because it bounds `asyncio.wait_for` and the SMTP socket.
SEND_TIMEOUT = 10.0


def normalize_address(value: str) -> str:
    """The compared form of an address (`email_suppressions.address_normalized`),
    the Python twin of SQL `lower(btrim(...))`."""
    return value.strip().lower()


def is_quiet(local_dt: datetime) -> bool:
    """True between 22:00 and 07:00 Warsaw, when only TRANSACTIONAL mail goes."""
    moment = local_dt.time()
    return moment >= QUIET_HOURS_START or moment < QUIET_HOURS_END


def want_match_day(local_dt: datetime) -> date:
    """The Warsaw date of the send window a match falls into: from 22:00 the
    mail can go only the next morning, so it counts as the next day."""
    if local_dt.time() >= QUIET_HOURS_START:
        return local_dt.date() + timedelta(days=1)
    return local_dt.date()


def next_send_after(now: datetime, attempts: int) -> datetime:
    """The retry time after `attempts` failed attempts (1-based)."""
    index = min(max(attempts, 1), len(BACKOFF_MINUTES)) - 1
    return now + timedelta(minutes=BACKOFF_MINUTES[index])


def category_enabled(rows: Mapping[str, bool], category: EmailCategory) -> bool:
    """`rows` maps one party's stored categories to `enabled`; a missing row
    means the category's default. An `ALL=false` row switches everything off."""
    if rows.get(EmailCategory.ALL) is False:
        return False
    return rows.get(category, CATEGORY_DEFAULTS.get(category, False))


def notification_key(notification_id: uuid.UUID) -> str:
    return f"notification:{notification_id}"


def want_match_key(want_id: uuid.UUID, day: date) -> str:
    return f"want_match:{want_id}:{day.isoformat()}"


def term_confirmation_key(source_id: uuid.UUID, party_id: uuid.UUID) -> str:
    """`source_id` is the proposal id when set, else the reservation id."""
    return f"term_confirmation:{source_id}:{party_id}"


def auth_key(token_id: uuid.UUID) -> str:
    return f"auth:{token_id}"


def password_changed_key(token_id: uuid.UUID) -> str:
    return f"auth:{token_id}:changed"
