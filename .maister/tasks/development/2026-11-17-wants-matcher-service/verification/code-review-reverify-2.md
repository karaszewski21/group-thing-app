## TL;DR

- **N1 resolved.** With the bound `start = min(marker, previous_run_at − OVERLAP)`, no listing can be skipped (proof below), as long as the overlap assumption holds: a listing's commit trails its `created_at` by ≤ `WINDOW_OVERLAP`, measured on the same clock as the matcher's `now`. That holds for late commits near "now", for the capped → uncapped transition, and for ties at `end`. A drained backlog or a burst older than 2 minutes is not re-read. The only window growth left is the accepted near-real-time rate limit.
- **N2 resolved.** `_unlock()` swallows `OSError`/`PostgresError`/`InterfaceError` and logs at DEBUG, so the run's own error propagates. The pool reset (`pg_advisory_unlock_all`) still drops the lock, and the test proves it.
- **N4 resolved.** `MARKER_INSERT`/`MARKER_MOVE` write `updated_at` (and `created_at` on insert) = run `now`, and `scanned_through = end`.
- **The CAS holds.** It still compares `scanned_through` only, which is enough under the advisory lock. A stale `updated_at` can only make `start` earlier (more conservative).
- **The tests discriminate.** All 5 new tests would fail on the round-1 code. `tests/test_window.py`: 20 passed (14.5 s).
- **New issues:** 0 critical, 0 warnings, 2 info (I1, I2).

**Date**: 2026-11-17
**Path**: `src/matcher/matcher/window.py`, `src/matcher/matcher/rules.py` (comment), `src/matcher/tests/test_window.py`, `.maister/docs/project/architecture.md` (window step 4/6, Window cost, 0099 runbook Measured cost)
**Scope**: all (focused re-verify of N1/N2/N4)
**Status**: ✅ Clean (info only)

## Verdicts

| Item | Verdict | Evidence |
|------|---------|----------|
| N1 (the overlap is not capped) | **Resolved** | `window.py:150-154` `window_start`, used at `window.py:166-167`. The cap still counts from the marker (`counted_after = marker`, `window.py:167-168`). See the proof below. |
| N2 (unlock masks the run error) | **Resolved** | `window.py:178-186`. `test_runWindow_unlockFailsAfterAFailedMatch_theMatchErrorPropagates` checks that `MatchFailed` propagates. Its second run, after `undo()`, checks that the lock was released by the pool reset. The check `"pg_advisory_unlock("` does not match the reset's `pg_advisory_unlock_all(`, so only the explicit unlock is broken. |
| N4 (a capped run writes a past `updated_at`) | **Resolved** | `window.py:59-68`, `114-122` (`$1 = now`, `$3 = end`). `test_runWindow_cappedRun_markerUpdatedAtIsTheRunClock` checks `(scanned_through, updated_at) == (first, now)`. |

## Correctness analysis

Notation:

- `O` = `WINDOW_OVERLAP`.
- Run k has clock `P_k` (its `now`, taken in `run_logged` before the lock and the sweep, so every snapshot of run k is at least `P_k`) and end `M_k`.
- `M_k ≤ P_k`, because `end` is either `now` or a `created_at` that is at most `now`.

**The formula reduces to `min(marker, previous_run_at − O)`.**

- Since `M ≤ P`, `M − O` is at most both `M` and `P − O`.
- So the outer `max` only matters when `updated_at < scanned_through`. That is a clock that went backwards, covered by the `-5 min` parametrised case. Keeping it is a sound guard.

**No listing is skipped.**

- Invariant I_k: after run k, every committed listing with `t ≤ min(M_k, P_k − O)` has been read.
- Step:
  - Listings with `t ≤ start_k = min(M_{k−1}, P_{k−1} − O)` are covered by I_{k−1}.
  - Listings in `(start_k, min(M_k, P_k − O)]` have committed by `t + O ≤ P_k ≤` run k's snapshot (the overlap assumption), and they lie in run k's window. So run k reads them.
- Listings in `(min(M_k, P_k − O), M_k]` are exactly what run k+1's `start` reopens.
- `M` and `P` both reach now, so every listing is eventually read.
- The proof uses only each run's own `P_k`. It does not need back-to-back capped runs to be 2 minutes apart.
  - Example: run k is capped near now (`M_k` within O of `P_k`), and the next run comes 13 s later. That run starts at `P_k − O`.
  - A listing that committed after that next run's snapshot has `t > P_{k+1} − O`, so run k+2 reopens it again.

**Capped → uncapped transition.**

- A capped run with `M ≤ P − O` makes the next run start at `M`. That is safe, because everything at or before `M` had committed before the capped run's snapshot.
- The first uncapped run writes `M = P = now`. The run after it gets the full 2-minute overlap again, as in round 1.

**Ties at `end`.**

- `WAITING_LISTINGS` orders by `created_at`, and `end` is the 300th row's time.
- `match_window` reads `created_at <= end`, so every tie is in that run.
- The next `start` is at most `end`, so a tie is never skipped. It is re-read only when `end` is within O of the run's clock.
- `test_runWindow_tiedCreatedAtBeyondTheCap_*` checks the counts `[12, 2]`.

**Late commits near now.**

- In an uncapped run `M = P`, so the next `start = P − O`, the same as round 1.
- The clock-skew budget is unchanged as well: matcher skew plus commit delay must stay under O, as it already had to for uncapped runs.

**Old marker row (`updated_at = scanned_through`).**

- `start = min(M, M − O) = M − O`, which is round-1 behaviour (conservative).
- The integration tests seed exactly such a row (`MARKER_INSERT` with `$1 = marker`), and their first run starts at `marker − O`. That covers the case.
- The exception is a row written by the backend's former ORM scan; see I1.

**CAS.**

- `MARKER_MOVE … WHERE scanned_through = $4` is unchanged. `updated_at` is not part of the predicate.
- Runs are serialised by the session advisory lock, and the marker is read and moved in one transaction.
- The only staleness `updated_at` could add is an older `P`, which gives an earlier `start` (a harmless re-read).
- `MARKER_INSERT … ON CONFLICT DO NOTHING` returns 0 rows when it loses, which raises `LostRace`.

**Docs.**

- `architecture.md`, window steps 4 and 6, matches the code and states the formula and its `previous_run_at` source.
- So do **Window cost** (line ~459), the runbook rows (lines 734–737), the `window.py` module docstring and the `rules.py:18-26` comment.
- The residual (more than about 1,000–1,200 listings created within 2 real minutes) is described as the accepted limit.

**Discrimination against round 1.**

| Test | Round-1 code would fail because |
|------|-------------------------------|
| `test_windowStart_*` (5 cases) | round 1 has no `window.window_start` (and its `start` was always `marker − O`, which breaks the 30 s / O / 3 h cases) |
| `test_runWindow_cappedRun_markerUpdatedAtIsTheRunClock` | round 1 writes `updated_at = end = first`, not `now` |
| `test_runWindow_burstWithinOneMinute_*` | round 1 re-reads the overlap, so `reads` grows (5, 10, 15, …) instead of `[5] * 10` |
| `test_runWindow_tiedCreatedAtBeyondTheCap_*` | round 1's second run starts at `tied_at − O`, so `reads == [12, 14]` and the `start` tuple differs |
| `test_runWindow_unlockFailsAfterAFailedMatch_*` | round 1's `finally` raises `ConnectionDoesNotExistError`, which masks `MatchFailed` |

## Critical Issues

None.

## Warnings

None.

## Informational

### I1. A marker written by the former backend scan has an `updated_at` a little later than its `scanned_through`
- **Location**: `src/matcher/matcher/window.py:150-154`, `166-167`. The old writer is `src/backend/app/wants/application/scan.py` at HEAD (now deleted), which set `marker.scanned_through = now`; `updated_at` came from `_version_timestamp` (`datetime.utcnow()` at flush).
- **Description**:
  - In such a row `updated_at = scanned_through + d`, where d is that backend run's duration (seconds; the old single statement took about 5.7 s at 500 listings).
  - The first matcher run then starts at `scanned_through + d − O`, so its overlap is d shorter than the backend run needed.
  - A listing created in `(scanned_through − O, scanned_through − O + d]` that committed after the backend's snapshot could be skipped once.
  - This only matters on a database where commit 2eb9298's backend scan actually ran. The 0099 release gate says it was not deployed, so in practice this means dev databases only.
- **Suggestion**: Nothing, if no deployed database ran the backend scan. Otherwise, one runbook line before the matcher's first start: `UPDATE want_scan_markers SET updated_at = scanned_through`.
- **Fixable**: true

### I2. No integration test for a capped run that ends within the overlap of its clock
- **Location**: `src/matcher/tests/test_window.py:116-121` (pure-function coverage only), `166-221`
- **Description**:
  - The burst and tie tests both place the capped `end` more than O before the run clock, so they exercise only the `start = marker` branch.
  - The `P − O` branch (a burst near real time, the case the accepted residual is about) is pinned only by the `30 s` parametrised case of `window_start`.
  - No test covers the capped-to-uncapped transition with a listing committed late, after the capped run.
  - The proof above shows the logic is correct; this is only a gap in regression protection.
- **Suggestion**: Optionally, add one run pair:
  1. A capped run whose `end` lies within O of its `now`.
  2. Insert a listing with `created_at` in `(now − O, end]`.
  3. Run uncapped and assert that the listing matches.
- **Fixable**: true

## Metrics
- Max function length (changed code): `_match` 19 lines, `window_start` 5 lines
- Max nesting depth: 2
- Potential vulnerabilities: 0 (no secrets, DSN or env values printed or written)
- N+1 query risks: 0

## Prioritized Recommendations
1. I1: confirm that no deployed database ran the backend scan; if one did, add the one-line `updated_at = scanned_through` reset to the runbook.
2. I2 (optional): add the near-now capped → uncapped integration test.
