## Domain Clock (Europe/Warsaw)

### Term Times Are Naive Warsaw Wall Clock

`Term.occurs_on` is a naive Europe/Warsaw wall-clock value (what the organizer typed, no tzinfo). Audit timestamps (`created_at`, `updated_at`, markers, `read_at`, `withdrawn_at`, `deleted_at`) stay naive UTC via `datetime.utcnow()`. Never compare the two kinds against each other.

### Read "Now" Only Through app.core.clock

Every comparison against `occurs_on` and every "today"/date default in Term-related code uses `from app.core import clock` then `clock.local_now()` (or `clock.local_now().date()`); never `datetime.now()` or `date.today()`. Call it via the module attribute, not `from app.core.clock import local_now`, so the test fixture can patch it. Enforced by `tests/test_domain_clock_guard.py` for `app/groups/application` and `app/groups/router`.

```python
from app.core import clock

if term.occurs_on < clock.local_now():
    raise BusinessConflictException("Termin już się odbył")
```

### tzdata Is a Runtime Dependency

`tzdata` is declared in `pyproject.toml` because slim images ship no zone database. `clock.check_timezone()` runs first in the app lifespan and fails fast; it logs only the zone key/abbreviation. Ship `uv.lock` with any dependency change.

### Freeze Time With freeze_local_now

Tests use the opt-in (not autouse) `freeze_local_now` fixture from `tests/conftest.py` (`freeze(datetime(...))`), never freezegun or time-machine. Build Term times in tests from `clock.local_now()`, not `utcnow()`.

### User-Facing Dates

Format Term dates via `clock.format_term_day` / `clock.format_term_when` (e.g. "śr 14.10 o 16:30"). Cap stored notification text with `clock.fit_notification_message` (500 chars).
