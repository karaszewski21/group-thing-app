"""Limits and periods of wants. The matching constants live in the matcher
service (`src/matcher/matcher/rules.py`); `REMINDER_LEAD` is shared with it
and pinned by its drift test."""

from __future__ import annotations

from datetime import timedelta

NAME_MIN_LENGTH = 3
NAME_MAX_LENGTH = 80
NOTE_MAX_LENGTH = 300
RADIUS_MIN_KM = 1
RADIUS_MAX_KM = 100

MAX_ACTIVE_WANTS = 30

VALIDITY = timedelta(days=90)
REMINDER_LEAD = timedelta(days=7)
# Opening the match list this close to `expires_at` renews the want.
AUTO_EXTENSION_WINDOW = timedelta(days=30)
