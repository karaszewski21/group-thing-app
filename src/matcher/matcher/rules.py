"""The single home of the matcher's constants. They reach SQL only as bound
parameters. `REMINDER_LEAD` is shared with the backend's message text and is
pinned against `app/wants/domain/limits.py` by `tests/test_constants_drift.py`."""

from datetime import timedelta

MATCH_TOP_N = 20
SUGGESTION_CAP = 10
WORD_SIMILARITY_MIN = 0.65
SHORT_WORD_MAX_CHARS = 4

REMINDER_LEAD = timedelta(days=7)
RETENTION = timedelta(days=30)

WINDOW_INTERVAL = timedelta(seconds=60)
WINDOW_OVERLAP = timedelta(minutes=2)
FIRST_WINDOW_LOOKBACK = timedelta(minutes=20)
# The new listings (`matchable_listings` after the marker) one window run
# matches at most. The overlap's listings come on top, but only those created
# within `WINDOW_OVERLAP` before the previous run's clock, so a drained backlog
# is not read again. Measured at 10,000 wants: about 43 ms per takeable
# listing for both tiers together (about 21 ms per statement, MATCH then
# SUGGESTION), so about 6.5 s per statement and 13 s per capped run, well
# under `STATEMENT_TIMEOUT`. A capped run moves the marker to its last
# listing and the next one starts at once, so a backlog drains over several
# runs.
WINDOW_MAX_LISTINGS = 300
REQUEST_POLL = timedelta(seconds=10)
STATEMENT_TIMEOUT = timedelta(seconds=30)
# How long a stop (SIGTERM/SIGINT) waits for the pool to close before
# terminating its connections; under compose's 10 s stop timeout.
SHUTDOWN_GRACE = timedelta(seconds=5)

BACKOFF_START = timedelta(seconds=60)
BACKOFF_MAX = timedelta(minutes=15)
