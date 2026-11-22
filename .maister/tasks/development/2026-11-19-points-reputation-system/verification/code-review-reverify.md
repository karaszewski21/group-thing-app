# Code Review Report: re-verification after the Phase 11 fix loop (cycle 1)

**Date**: 2026-11-20
**Path**: the fix-loop changes in the points & reputation working tree: `app/points/{infrastructure/wants_acl.py, infrastructure/ledger.py, domain/awards.py, application/awards.py}`, `app/groups/{application/attendance_points.py, application/memberships.py, infrastructure/membership.py, infrastructure/points_acl.py, schemas.py}`, `frontend/src/{hooks/usePointsConfig.ts, api/groups.ts, features/meetings/TermAttendeesPage.tsx}` and the added tests
**Scope**: all
**Status**: ✅ Clean (no critical issues, no warnings; 3 info notes)

## TL;DR
All seven fixes are correct, and none of them introduces a defect.
- Every previous warning is **resolved**. The two business-logic gaps W1 and W2 leave only documented, accepted limits.
- W3 is confirmed: `LedgerInvariantError(RuntimeError)` is not a `ValueError`, so it reaches the catch-all `Exception` handler and returns a logged 500.
- New findings are 3 info notes: a stale docstring, the organizer label on closed lists, and the want-resume limit.
- ruff and mypy are clean on the changed code. The only 2 ruff E501 hits, in `memberships.py`, already exist at HEAD.

## Key Decisions
- W8 (the PARTY-debit check in `post_points`) was kept by user decision and is not re-reported.
- The numbering follows the orchestrator's consolidated list:
  - W1–W4 are the earlier report's W1–W4.
  - W5 is the earlier I1.
  - W6 is the earlier I7 together with the organizer flag.
  - W7 is the close-dialog warning.

## Open Questions / Risks
- A want that was WITHDRAWN or EXPIRED at reservation time and resumed before confirm still qualifies for the „Szukam” bonus. No status history is kept, and the docstring states this. The farming surface is small: the want must have existed before the take, and the pair limit applies.

## Summary
- **Critical**: 0 issues
- **Warnings**: 0 issues
- **Info**: 3 issues

## Previous warnings: status

| ID | Fix | Status |
|----|-----|--------|
| W1 | `wants_acl.wanted_at_reservation` | **Resolved** (resume limit documented, see I-R3) |
| W2 | cap month = month of the close | **Resolved** |
| W3 | `LedgerInvariantError(RuntimeError)` | **Resolved** |
| W4 | `existing_source_ids` batch | **Resolved** |
| W5 | prefix invalidation | **Resolved** |
| W6 | `is_organizer` + countable banner | **Resolved** (see I-R2) |
| W7 | close-dialog below-minimum warning | **Resolved** |
| Late fix | `_not_an_organizer` / `holds_active_leadership(party_id: UUID \| SQLColumnExpression)` | **Correct** |

### W1: resolved
`src/backend/app/points/infrastructure/wants_acl.py:27-52`
- One `EXISTS` adds `_wants.c.created_at <= reserved_at`, which applies to both the ACTIVE branch and the FULFILLED (`closed_at >= reserved_at`) branch.
- Both timestamps are naive UTC from `BaseEntity`, so the comparison is sound.
- The caller is `app/points/application/awards.py:87-93`. It passes `leg.created_at`, which `groups/infrastructure/points_acl.py:35` sets from `Reservation.created_at`, and it runs at most two queries (one per leg).
- The test case `createdAfterTake` was added to the parametrised no-bonus test (`tests/test_points_awards.py:396`).

### W2: resolved
`app/points/domain/awards.py:124-127`, `app/points/application/awards.py:184`
- `attendance_cap_month(clock.local_now())` keys the cap on the Warsaw month of the close. Past-dated terms closed together therefore share one cap, and the bound now follows wall-clock time.
- `award_attendance` no longer takes `occurs_on`. The single caller (`attendance_points.py:204`) and the ACL wrapper (`groups/infrastructure/points_acl.py:46-54`) match the new signature.
- `app/points` is in `_GUARDED_DIRS` of `tests/test_domain_clock_guard.py`, and the clock read goes through the module attribute.
- `ck_point_transactions_cap_month` only requires a non-null value for ATTENDANCE, so it still holds.
- The test `test_close_pastTermsOfTwoMonths_closedTogether_shareOneCloseMonthCap` covers the case. The spec is amended (`spec.md:81`).
- The `domain/awards.py` module docstring is stale (I-R1).

### W3: resolved
`app/points/infrastructure/ledger.py:97-174`
- Every invariant raise in `post_points` and `_require_account_types` is now `LedgerInvariantError(RuntimeError)`.
- `app/core/errors.py:192` registers `ValueError` → 400, and `:193` registers `Exception` → `logger.exception` + a generic 500 envelope with no internal message.
- The ancestors of `RuntimeError` do not include `ValueError`, so the 400 handler never matches.
- `mapped_transaction_conflicts` (`app/db.py:26-37`) catches only `DBAPIError`, so the error propagates unchanged.
- The auto-close job's `except Exception` logs a traceback and continues.
- No `except RuntimeError` or `except ValueError` in `app/` swallows it. The only `except ValueError` is in `organizations/service.py:43`, which is unrelated.
- `ValueError` remains only for user input in `app/points/application/config.py`, which is correct.

### W4: resolved
`app/points/infrastructure/ledger.py:232-248`, `app/points/application/awards.py:168-178`
- One `SELECT source_id … IN (…)` replaces the per-attendee `EXISTS`, and it short-circuits on an empty input.
- With a capacity of at most 10,000, the bind count stays below asyncpg's 32,767-parameter limit.
- The unique key remains the backstop. `source_key_exists` is still used in `award_exchange`, which handles at most 3 awards, so that is fine.

### W5 (former I1): resolved
`src/frontend/src/hooks/usePointsConfig.ts:37` invalidates `[POINTS_KEY]` after the save completes.
- `useAttendanceRules` (`[POINTS_KEY, "attendance-rules"]`) and `useMyPoints` use the same prefix constant, so the levels and minimum refresh in the same session.
- Refetching `me`/`history` is harmless.
- The test `usePointsConfig.test.tsx` was added.

### W6 (former I7 + organizer flag): resolved
- `TermAttendeeResponse.is_organizer` was added to the backend (`app/groups/schemas.py:516-517`) and the frontend (`api/groups.ts:316`). The only consumer is the organizer-only attendees route, so R8 and the public surface are unaffected.
- `memberships.list_term_attendees` (`app/groups/application/memberships.py:149-158`) computes the flag with one query, a correlated `holds_active_leadership(TermAttendance.party_id, group_id)`. This is the same rule as the close and the present count, so the label and the count agree.
- `TermAttendeesPage.tsx:118` computes `countable` from non-organizer rows, so "Teraz: X z Y" now compares like with like. Line 340 labels organizer rows.
- Existing key-set assertions were updated (`tests/test_term_attendees.py:114`), and `tests/test_term_attendance_close.py:261` checks the flag.

### W7: resolved
`TermAttendeesPage.tsx:198-205` (`closeDialogBody`)
- The warning appears only when `level > 0 && present < min`.
- While the list is OPEN, `present_count` is the backend's live non-organizer count and `min_present` the current rule, which is exactly what the close will evaluate.
- The wording matches the banner's below-minimum text.

### Late fix: correct
`app/groups/infrastructure/membership.py:91-105`, `attendance_points.py:45-48`
- The widened annotation `uuid.UUID | SQLColumnExpression[uuid.UUID]` is used in three places:
  - `get_attendance`, inside the `FILTER` of the present count;
  - the `close_attendance` present read;
  - `list_term_attendees`.
- In each, the enclosing select's FROM is `term_attendances`, so the `EXISTS` auto-correlates on `TermAttendance.party_id`. None of these outer queries contains `group_roles` or `leaderships`, so no unintended correlation occurs.
- The value form is still used by `circles.is_active_group_organizer`.
- The rule has no deleted-group filter, which keeps the organizer exclusion working on soft-deleted circles. The soft-deleted group test covers this.
- mypy is clean.

## Critical Issues
None.

## Warnings
None.

## Informational

### I-R1: stale module docstring on the cap month
- **Location**: `src/backend/app/points/domain/awards.py:10-12`
- **Description**: The docstring still says the cap applies in the "Warsaw calendar month of the term date". The function docstring at `:125` and the code use the month of the close.
- **Suggestion**: Change it to "…of the close".
- **Fixable**: true

### I-R2: on a closed list, `is_organizer` reflects current leadership, not leadership at close
- **Location**: `src/backend/app/groups/application/memberships.py:149-158`
- **Description**: The frozen `attendance_present_count` excluded whoever led the group at close time. If leadership changes later, the closed list's "organizator" labels can differ from the frozen count. This is rare and display-only; the awards are unaffected.
- **Suggestion**: Accept, or hide the label once the list is CLOSED.
- **Fixable**: true

### I-R3: a resumed want still qualifies for the „Szukam” bonus
- **Location**: `src/backend/app/points/infrastructure/wants_acl.py:30-34`
- **Description**: A want that was WITHDRAWN or EXPIRED at reservation time and resumed before confirm counts as ACTIVE. This is documented as a known limit, because there is no status history. It is bounded by `created_at <= reserved_at` and the pair limit.
- **Suggestion**: Accept as documented, or add `resumed_at` later.
- **Fixable**: false

## Metrics
- Max function length (changed code): ~76 lines (`award_exchange`, unchanged; earlier I9)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0 new. W1 and W2 are closed apart from the documented limit (I-R3).
- N+1 query risks: 0. W4 is fixed; `wanted_at_reservation` runs at most 2 queries per confirm.
- Tooling:
  - `uv run python -m mypy` on `app/points` and the changed groups modules: no issues (22 files).
  - `ruff check` on the changed backend files and tests: only 2 E501 in `memberships.py:27,219`, both present at HEAD (baseline).

## Prioritized Recommendations
1. I-R1: change the `domain/awards.py` module docstring to the month of the close.
2. I-R2 and I-R3: accept, or address when convenient.
