"""Limits, periods and thresholds of wants."""

from __future__ import annotations

from datetime import timedelta

NAME_MIN_LENGTH = 3
NAME_MAX_LENGTH = 80
NOTE_MAX_LENGTH = 300
RADIUS_MIN_KM = 1
RADIUS_MAX_KM = 100

MAX_ACTIVE_WANTS = 30
# Pairs stored per want in one match run.
MATCH_TOP_N = 20

VALIDITY = timedelta(days=90)
REMINDER_LEAD = timedelta(days=7)
# A closed want is deleted this long after `closed_at`.
RETENTION = timedelta(days=30)
# Opening the match list this close to `expires_at` renews the want.
AUTO_EXTENSION_WINDOW = timedelta(days=30)

SCAN_INTERVAL = timedelta(minutes=15)
# Each scan window reaches this far back behind the previous one.
SCAN_OVERLAP = timedelta(minutes=5)

# Minimum `word_similarity` of the trigram branch.
SIMILARITY_THRESHOLD_WITHOUT_CATEGORY = 0.70
SIMILARITY_THRESHOLD_WITH_CATEGORY = 0.60

FORWARD_STATEMENT_TIMEOUT_SECONDS = 3
