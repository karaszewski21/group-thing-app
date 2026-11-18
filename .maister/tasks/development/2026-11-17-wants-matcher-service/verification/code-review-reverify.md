# Code Review Re-verification

## TL;DR
- **Status: ⚠️ Issues Found.** 0 critical, 1 new warning, 4 new info items.
- **W1 is resolved for the case it was raised for**, an outage backlog. **It is still open for dense bursts.** The cap of 300 counts only the listings after the marker, but every capped run also re-reads the 2-minute overlap (`start = end − WINDOW_OVERLAP`). When listings arrive faster than about 400 a minute (for example a bulk import), or many share one `created_at`, the window grows by 300 listings with each capped run until a statement passes the 30 s timeout. From then on that run repeats and fails every minute, and the marker stays where it is (N1).
- W2, W3, W5 and W6 are resolved. W4 is resolved: the restart policy was added, and the missing healthcheck is a documented choice.
- **The advisory lock is released on every path.** After the explicit unlock, asyncpg's pool reset on release runs `pg_advisory_unlock_all()`, and a closed connection drops the lock on the server. The marker CAS is correct with a capped end. Listings with equal `created_at` at the cap boundary are not lost. The 409 path rolls back before it raises. I found no race in the signal handling.

**Date**: 2026-11-17
**Path**: `src/matcher/matcher/{window,statements,__main__,rules,db}.py`, `src/backend/app/wants/application/writes.py` (`update_want`), `src/backend/app/outbox/dispatcher.py`, `docker-compose.yml` (matcher), plus the new tests: `src/matcher/tests/test_window.py`, `test_main.py`, `test_suggestions.py` and `src/backend/tests/test_wants_edit_concurrency.py`
**Scope**: all (re-verification of W1–W6)

## Status of the original items

| Item | Verdict | Notes |
|------|---------|-------|
| W1 (unbounded window, sweep rolled back with it) | **Resolved for outage backlogs, residual for dense bursts** | The sweep now commits on its own (`window.py:116-125`), and `test_runWindow_matchStatementFails_sweepStaysCommitted_lockReleased` covers that. The count cap and the drain run back to back (`window.py:128-138`, `222-225`), covered by `test_runWindow_hoursOldMarkerAboveTheCap_*` and `test_windowLoop_cappedRun_*`. An hour-long stop at about 25 listings a minute now drains in capped runs. The cap does not bound the overlap's share of the window, though (N1). |
| W2 (suggestion cap counts gone items) | **Resolved** | `statements.py:133-136` counts only stored suggestions whose item is still in `matchable_listings`. Covered by `test_suggestionCap_storedSuggestionsNoLongerMatchable_freeTheirPlaces`. Two small edge cases remain, see N3. |
| W3 (row lock held during the classifier) | **Resolved** | `writes.py:206-234`: the checks and lookups run on an unlocked read. Then the row is read again `FOR NO KEY UPDATE` with `populate_existing`, compared with the `updated_at` read first, and a mismatch does `db.rollback()` before it raises `StaleDataError` (the shared 409 handler, `app/core/errors.py:120`). `_ensure_allowed` runs again on the locked row, so an expiry by a matcher whose clock is behind (with `updated_at` unchanged) is still refused. Matches are deleted, and the flag is set, under the lock (H3 kept). `_mapped_database_errors` catches only `DBAPIError`, so the `StaleDataError` reaches the handler untouched. Tests: `test_updateWant_classifierRuns_wantRowNotLocked`, `test_updateWant_seekerWriteDuringClassifier_raisesStaleDataError` (asserts nothing was saved) and `test_updateWant_matcherRunHoldsTheWant_*`. |
| W4 (no restart policy or healthcheck) | **Resolved** | `restart: unless-stopped` was added. Leaving out the healthcheck is a documented choice (compose comment): the marker moves on every run, idle runs included, so a stale `want_scan_markers.updated_at`/`scanned_through` is the liveness signal. N4 notes that capped runs write a past time into `updated_at`. |
| W5 (no SIGTERM handling) | **Resolved** | `__main__.py:247-281` handles the signals. Details under Signal handling below. The Dockerfile `CMD` is exec form, so Python is PID 1 and receives the signal. Covered by `test_main_sigterm_*`, which checks the LISTEN connection is gone, the pool is closing and the previous handler is restored. |
| W6 (silent FAILED outbox rows) | **Resolved** | `dispatcher.py` logs one ERROR with the id, event type, attempts and the truncated `last_error` when a row moves to FAILED. `last_error` is the handler's exception text, which holds no secrets. |
| W7–W13 | Not in scope | Not part of this round of fixes, so unchanged. |

## The checks you asked for

### Advisory lock release on every path (`window.py:164-173`)
- **Normal path, or a failed sweep or match:** the `connection.transaction()` blocks have already rolled back or committed when `finally` runs `pg_advisory_unlock` on a clean connection. This includes a statement timeout (`57014`).
- **Connection lost:** `is_closed()` skips the unlock, and the server drops session locks when the backend process exits.
- **Cancellation (SIGTERM during a run):** the transaction `__aexit__` rolls back, then the unlock runs. The outer `gather` does not finish until its children do, so this happens before `_close(pool)`.
- **Pool connection reuse:** if the explicit unlock is skipped or fails, the connection still goes back through `Pool.release`, which calls `Connection.reset()`. The reset query in asyncpg 0.31 includes `SELECT pg_advisory_unlock_all()` (the server supports advisory locks). If the reset fails, the connection is terminated. A pooled connection never carries the lock into the request loop. The one leftover weakness is that an unlock failure hides the original error (N2).

### Marker CAS and overlap with a capped end (`window.py:141-156`)
- The marker is read and moved in the same transaction. The move is `WHERE scanned_through = <read value>`, and `end` is either `now` or a `created_at` strictly greater than the marker, so the marker only moves forward. The values make an exact round trip (microsecond `timestamp`). A miss raises `LostRace`, which rolls the match back and logs a WARNING, and the loop sleeps.
- `start` stays `marker − WINDOW_OVERLAP` and `counted_after` is the marker, so a late-committed listing near the previous end is still read again. Correctness holds, but the cost of that re-read is not capped (N1).

### Equal `created_at` at the cap boundary
- **No pairs are lost.** `end` is the `created_at` of the 300th waiting listing. The window statements use `created_at <= $6`, so every listing tied with the 300th is in this run. The next run counts `created_at > end`, and the overlap and `NOT EXISTS` stop duplicates.
- Ties can push a run past the cap: N listings with the same timestamp all land in one run. That falls under N1.
- `WAITING_LISTINGS` and the two window statements each take their own READ COMMITTED snapshot. A listing committed between them with `created_at <= end` is either read by the later statement or caught by the next run's overlap, the same as before the change.

### 409 rollback (`writes.py:231-234`)
- `await db.rollback()` comes before `raise StaleDataError(...)`, which releases the `FOR NO KEY UPDATE` lock and discards nothing written: no flush has happened at that point. Nothing touches the expired ORM objects after the rollback.
- A want withdrawn in the meantime makes the second `_own_want` raise `WantNotFound` (404) while no row is locked, and the request session's normal teardown rolls back. That is correct.

### Signal handling (`__main__.py:247-315`)
- **POSIX:** `loop.add_signal_handler` runs `stop` on the loop thread. **Windows:** `signal.signal`, then `call_soon_threadsafe`, which is safe to call from a signal handler.
- `stopping` makes `stop` idempotent, so a second SIGTERM during `_close` does not cancel the pool close.
- `asyncio.wait_for` inside an already-cancelled-once task works correctly on 3.12: the timeout tracks the task's `cancelling()` level, so expiry becomes `TimeoutError`, then `pool.terminate()`.
- `task.uncancel()` comes before the normal return, so `asyncio.run` sees a clean exit (0). The handlers are restored in `finally`.
- A signal that arrives before `install_stop_handlers` gets the default action. That window is only `settings.load()`, before any DB work, so it does not matter.
- Both loops run forever and swallow their errors, so the "other exception plus signal" interleaving is not reachable.
- I found no race.

## New issues

### Warnings

#### N1. The overlap is not capped, so a dense burst brings back the timeout loop W1 described
- **Location**: `src/matcher/matcher/window.py:145-149` (`start = marker − WINDOW_OVERLAP`, cap counted from `marker`), `window.py:59-63`/`statements.py:59-63` (`window_listings` = `(start, end]`), `rules.py:121-127`
- **Description**: Each capped run reads up to 300 new listings plus every listing in the 2 minutes before the marker. Most of the window's cost is the per-want text comparison for each listing, about 20 ms per listing per statement at 10,000 wants. That cost does not depend on whether the pair is already stored: `NOT EXISTS` removes only stored pairs, and most comparisons are misses.
  - Example: a burst of 2,000 listings in one minute after the marker.
  - Each capped run covers about 18 s of listings, so run k re-reads all of runs 1..k−1 that fall within 2 minutes.
  - `window_listings` grows 300, 600, 900, … By run 6 or so it is around 1,800 listings, about 36 s per statement, which is over the 30 s timeout.
  - That run rolls back without moving the marker. It then repeats with the same window every 60 s, and `log_failure` logs an ERROR each time. Unlike before, the sweep keeps working.
  - Listings with the same `created_at` give the same effect without a burst. The fix guarantees no loss, but not the bound.
  - Sustained rates near the accepted ceiling (about 500 a minute) put about 1,000 overlap listings plus 300 new ones into every capped run, about 26 s per statement.
- **Why it matters**: W1's failure mode was "a backlog that never clears". It remains for bursts, such as a bulk import or a seed script, and for clustered timestamps, which the new test does not cover. Its listings are 20 minutes apart.
- **Recommendation**: The overlap exists only to catch listings that committed after the previous run's snapshot, so it should be measured from the previous run's wall-clock time, not from its `end`.
  - Write the run's `now` into `want_scan_markers.updated_at` (see N4). Then use `start = max(marker − WINDOW_OVERLAP, min(marker, previous_run_at − WINDOW_OVERLAP))`.
  - With that rule, a capped run whose `end` is older than its own `now − overlap` is followed by a run that starts at the marker, with no re-read. Real time-based overlap stays for uncapped runs.
  - Alternatively, count the cap over `(start, now]` and guarantee progress by taking at least the first listing after the marker.
  - Add a test with more than `WINDOW_MAX_LISTINGS` listings inside one overlap span, or with equal timestamps, that asserts the size of `window_listings` per run.
- **Fixable**: true

### Informational

#### N2. A failing unlock hides the run's original error
- **Location**: `src/matcher/matcher/window.py:171-173`
- **Description**: If the connection broke during the match but is not yet marked closed (a network drop), `pg_advisory_unlock` raises `ConnectionDoesNotExistError` from `finally`. That error replaces the real one in `run_logged`'s log line. The lock is still released, by the server on disconnect or by the pool reset.
- **Suggestion**: Wrap the unlock in `try/except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError)` and log a DEBUG line, so the original exception propagates.
- **Fixable**: true

#### N3. Two edge cases remain in the suggestion cap, and its subquery runs for every ranked row
- **Location**: `src/matcher/matcher/statements.py:133-136`
- **Description**:
  - **Edge cases:** `matchable_listings` is the same for every seeker. A stored suggestion whose item is still listed but no longer visible to this seeker (they left the shared PRIVATE group) still takes a place, while `reads.visible_matches` hides it. A reserved item, or one with a pending proposal, frees its place while `/suggestions` can still show it (`listed` includes reserved items). The read's `LIMIT 10` bounds that second case, and it falls under the accepted overshoot.
  - **Cost:** the correlated `count(*) … EXISTS (matchable_listings)` sits in the final `WHERE`, so it runs once for each ranked candidate row, not once for each want. Its cost in the window was not re-measured.
- **Suggestion**: Compute the count once per want, in a CTE grouped by `want_id` and joined to `ranked`. Add the PRIVATE-peer check if the visibility gap matters, or accept it in the spec.
- **Fixable**: true

#### N4. A capped run writes a past time into the marker's `updated_at`
- **Location**: `src/matcher/matcher/window.py:51-59`, `105-113` (`MARKER_INSERT`/`MARKER_MOVE` take `$1 = end` for `updated_at` and `created_at`)
- **Description**: During a drain, `updated_at` is the creation time of a listing, hours old, not the time of the run. The compose comment and runbook step 7 name the marker as the matcher's health signal, so during a drain the marker looks stalled even though runs are going back to back.
- **Suggestion**: Pass `now` for `updated_at`/`created_at` and `end` only for `scanned_through`. This is also the input N1's fix needs.
- **Fixable**: true

#### N5. `update_want` is now about 73 lines
- **Location**: `src/backend/app/wants/application/writes.py:187-259`
- **Description**: The function is past the 50-line guideline. The unlocked-check phase (lines 213-229) is a natural helper that would return the cleaned values.
- **Suggestion**: Extract `_checked_edit(db, want, data) -> (name, note, category_id, offer_mode, locality_id, radius_km)`.
- **Fixable**: true

## Summary
- **Critical**: 0
- **Warnings**: 1 (N1)
- **Info**: 4 (N2–N5)

## Prioritized Recommendations
1. N1 and N4 together: store the run's `now` in the marker's `updated_at`, and skip the overlap after a run whose end is older than `now − overlap`. Add a burst or equal-timestamp test.
2. N2: make the unlock in `finally` non-masking.
3. N3: compute the suggestion count per want. Decide on the PRIVATE-peer edge case.
4. N5: optional refactor.

Tests were read, not run, in this review. `test-suite-results-reverify.md` holds the run results.
