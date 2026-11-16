# Code Review Report (re-verification, cycle 1)

**Date**: 2026-11-16
**Path**: uncommitted changes of `2026-11-15-szukam-wanted-mechanism`, focused on the files changed by "Verification fixes (Phase 11, cycle 1)" (`implementation/work-log.md:443`)
**Scope**: all
**Status**: ⚠️ Issues Found (no critical issue, no new warning)

## TL;DR
- W1 is resolved for withdrawals: `_wants_to_notify` now filters on `ACTIVE`, locks the rows `FOR UPDATE` in id order, and the pointer update filters on `ACTIVE` too. One residual remains: an edit committed during a run can still get a bell row for the old name's pairs. This belongs to the "stale pairs after a concurrent edit" case that was already accepted.
- The lock does not add a deadlock cycle. It removes one: the scan used to delete the notification row before it locked the want, while the seeker locked the want first. The only remaining cycle (a PATCH forward match inserting the same `(want, item)` pair as the scan's reverse match) existed before through the pointer UPDATE. Postgres detects it, and the next run redoes the window.
- `create_notifications`, the 0099 downgrade DELETE, `WantWriteError` and `useWantsMatchingItem` are correct. The statement count is unchanged (the select became a select `FOR UPDATE`; the scan test still pins it at ≤16).
- The extra `getMyWants` call after closing is harmless: the invalidation refetches the matching query while it is still enabled. It costs one GET and does not point to a defect.

## Key Decisions
- W2 (sweep locks during the match, unbounded window after downtime) and W3 (no rate limit) are recorded risks by the user's decision. They are listed as residual and not raised again. The same holds for the reverse-scan budget miss.
- The ItemDetailPage assertion change (two `getMyWants(ITEM_ID)` calls) is accepted as correct behaviour (see N3).

## Open Questions / Risks
- If the backend is ever scaled out, or a seeker edits the name of a want while a scan run stores a pair for the same item, the deadlock in N1 can abort the scan run or return a 500 to the seeker. This is rare, and it existed before the fix.

## Summary
- **Critical**: 0 issues
- **Warnings**: 0 new (W2 and W3 remain as accepted residual risks)
- **Info**: 4 new (N1-N4) plus residual earlier info items (see table)

## Previous findings: resolved or residual

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| W1 | Bell row for a want withdrawn or edited mid-run | **Resolved** (withdraw); residual for edit (accepted stale-pair case) | `match_notifications.py:55-77`: `Want.status == ACTIVE`, `.order_by(Want.id).with_for_update()`; `:135`: the pointer update filters on `ACTIVE`. Under READ COMMITTED the locked read re-checks the WHERE clause on the newest row version after the wait, so a withdraw committed mid-run is filtered out. Test `test_writeBellRows_wantWithdrawnAfterItsPairWasStored_noRowAndPointerUntouched` (`tests/test_wants_scan.py:233`) covers the sequential case. An edit leaves the want ACTIVE, so the pairs stored for the old name survive the seeker's `DELETE want_matches` (they were not committed yet) and get a row with the new name. |
| W2 | Sweep locks held through the match; unbounded window | Residual (accepted risk) | `scan.py:117-125` unchanged. |
| W3 | No rate limit on forward-match writes | Residual (accepted risk) | `writes.py` create/update/resume unchanged. |
| I1 | Cap link keyed on message text | **Resolved** | `WantFormView.tsx:164`: `err instanceof WantWriteError && err.status === 409`. |
| I2 | Read filter wider than match rule | Residual (harmless) | `reads.py` unchanged, no note added. |
| I3 | `matched_item_id` checks stored pairs only | Residual (harmless) | Unchanged. |
| I4 | `CLOSE_OUTCOMES` dead code | **Resolved** | No match left in `app/`. |
| I5 | Marker conflict detected via `str(exc.orig)` | Residual | `main.py` `_run_want_scan`: `MARKER_UNIQUE_CONSTRAINT not in str(exc.orig)`. Failures other than the marker race are now logged with `logger.exception` (an improvement). |
| I6 | Bell `created_at` from the writer's clock | Residual (harmless) | `notifications/service.py:84`: `datetime.utcnow()`. |
| I7 | Marker can move backwards on clock skew | Residual (harmless) | `scan.py:125`: `marker.scanned_through = now`. |
| I8 | `time.md` omits `app/search`, `app/wants` | **Resolved** | `standards/backend/time.md:9` lists six packages. |
| I9 | f-string `SET LOCAL statement_timeout` | Residual | `writes.py:76`. |
| I10 | Unbounded stored pairs / unpaged list | Residual (accepted) | Unchanged. |
| I11 | `ix_want_matches_item_id` has no reader | Residual | Unchanged. |
| I12 | `onClick` on `<li>`, auxclick not recorded | Residual | `MatchCard.tsx:23`. |
| I13 | AccountView shows "brak" on a wants error | Residual | `AccountView.tsx:28,56`: only `loading` is checked, not `error`. |
| I14 | Create with a `?locality=` prefill drops it before it resolves | Residual | `WantFormView.tsx:116`: the `initial.localityId` fallback applies only when `want` is set (edit). |
| I15 | Category prefill not checked for UUID shape | Residual | `wantFormViewState.ts:62`. |
| I16 | Extra `GET /api/wants` and a "seen" POST on every visit | Residual (spec-conformant) | `WantMatchesView.tsx:37,46-51`. |
| I17 | Long functions | Residual | Unchanged. |

## Fix-specific checks

### Lock ordering of `.with_for_update()` (asked)
- **With the sweep**: `_expire`/`_remind` run in the same transaction, so the scan already holds those row locks itself. A transaction never conflicts with its own locks, so there is no deadlock with itself. Between two scan runs (only possible if the backend is scaled out), the unordered set-based sweep UPDATEs were already a deadlock path. The new id-ordered lock does not add to it.
- **With seekers**: every seeker write locks exactly one want row (ORM flush, `FOR NO KEY UPDATE`), then may delete its unread notification (`_drop_unread_match_row`). Before the fix, the scan deleted the notification first (`replace_unread_notifications`) and updated the want afterwards: that was the opposite order, a real W→N / N→W cycle. Now the scan locks W before it deletes N (`match_notifications.py:159-163`), the same order as the seeker, so **this cycle is gone**.
- **Remaining cycle** (pre-existing, see N1): the scan's reverse INSERT into `want_matches` takes only `FOR KEY SHARE` on W, which does not block the seeker's `UPDATE`. A PATCH that changes the matching fields then runs `matcher.match_want` (`INSERT … ON CONFLICT DO NOTHING`). If it hits the same `(want_id, item_id)` the scan has inserted but not yet committed, it waits for the scan, while the scan's `FOR UPDATE` waits for the seeker. Before the fix, the pointer UPDATE waited the same way.
- **Statement count**: unchanged. The select became a select `FOR UPDATE` (one statement). Delete plus insert is still two statements. `test_scanWants_oneOrSeveralWantsAndListings_sameStatementCountAtMostSixteen` passes.

### `create_notifications` (asked)
Correct. Each row gets its own `uuid4` id, `created_at == updated_at == now`, and all other columns explicitly. The ids are returned in entry order through `zip(strict=True)`, and the call runs one INSERT with no flush or commit (`test_createNotifications_severalEntries_distinctIdsInEntryOrderInOneStatement`). Match entries come before expiring entries, so `written[: len(pointed)]` lines up with `pointed` (`match_notifications.py:205-214`). An empty input runs no statement. The nullable `proposal_id`, `reservation_id` and `read_at` default to NULL.

### 0099 downgrade DELETE (asked)
Safe. `SET LOCAL lock_timeout = '5s'` comes first (`0099_wants.py:150-151`), and it also bounds the wait for row locks held by a concurrent `mark_read`. The DELETE takes only ROW EXCLUSIVE on `notifications`, so readers are not blocked. `kind` has no index, so this is a sequential scan of `notifications`, which is acceptable for a one-off downgrade. `wants.match_notification_id` has no FK to `notifications`, so there is no cascade. The round-trip test asserts that only the WANT_* rows are deleted (`tests/test_wants_migration.py:86-100`). The runbook's rollback order is stop, then DELETE, then start the old image.

### `WantWriteError` (asked)
The message is `extractProblemMessage(err)` verbatim (ProblemDetail `detail`, the legacy `message`, or `"<statusText> (HTTP n)"`). `status` is `ApiError.status`, or `null` for a network error (`useWants.ts:24-33`). Network errors give `"Network error — check connection"`, which is English, but that text comes from the shared helper and predates this task (N4).

### `useWantsMatchingItem` (asked)
It follows `data-fetching.md`. The key is `[WANTS_KEY, "matching", token, itemId]` under the wants prefix (the token in the key is the documented deviation for private data). `enabled` is `token !== null && itemId !== null`, and `NO_WANTS` is a stable module-level fallback. `ItemPickupActions` calls it before the early returns, so the hook order is stable. The trigger matches the spec: `takenItemId` is set after every successful non-swap take (`useItemTake.ts:117-120`). A personal take opens no success sheet, so the prompt opens as soon as the lookup answers. For a term or event take, `showClosePrompt` requires `!take.takeSuccess`, so the prompt waits for the success sheet to close. The render-time reset (`promptFor !== takenItemId`) re-arms the prompt for a new take.

## Informational (new)

| # | Location | Description | Suggestion | Fixable |
|---|----------|-------------|------------|---------|
| N1 | `src/backend/app/wants/application/match_notifications.py:75` with `writes.py:224-230` | A deadlock is possible, though rare, and it existed before the fix: a scan's uncommitted reverse pair `(W, X)` and a seeker's PATCH forward match inserting the same `(W, X)` wait on each other (the unique index wait against the `FOR UPDATE`). Postgres aborts one side after `deadlock_timeout`. If it aborts the scan, `_run_want_scan` logs it and re-raises, the marker does not move, and the next run redoes the window. If it aborts the seeker, the PATCH fails with an unmapped `DBAPIError`, most likely a 500. | Accept. Or map `DeadlockDetected`/`SerializationFailure` to a 409 "spróbuj ponownie" in the global handler. | false |
| N2 | `src/backend/app/notifications/service.py:86-100`, `match_notifications.py:61-76,127-142` | The multi-row VALUES insert uses 7 binds per row, and the `IN (…)` lists and the `values()` CTE grow with the number of wants per run. asyncpg allows at most 32,767 parameters per statement, so a run with more than about 4,680 bell rows would fail. This is far above the expected per-run volume, and the earlier writer had the same shape. | Accept for v1. If volume grows, chunk the writes (for example 1,000 rows per statement) or switch to `unnest` arrays as the migration seeds do. | true |
| N3 | `src/frontend/src/features/wanted/CloseWantSheet.tsx:36-43`, `src/frontend/src/test/ItemDetailPage.test.tsx:885-886` | The second `getMyWants(ITEM_ID)` comes from `invalidateQueries([WANTS_KEY])` refetching the matching query, which is still enabled because `onClose` (which sets `promptDismissed`) runs only after the awaited invalidation. This is not a defect. In production the refetch returns `[]` (the wants are now FULFILLED), so the sheet unmounts through the data change a moment before `onClose`. The visible result is the same. The test's mock keeps returning both wants, so it does not cover this production path. | Optional: call `onClose()` before invalidating (or invalidate without awaiting), which saves the GET and makes the sheet close through one path. Or make the test's second answer `[]`. | true |
| N4 | `src/frontend/src/api/problem.ts:55` (used by `WantWriteError`) | Network failures on want writes show the English "Network error — check connection" in a Polish UI. This predates the task (shared helper). | Use a Polish fallback, for example `serverMessageOr(err, "…")` as `CloseWantSheet` does, or localise the helper project-wide. | true |

## Metrics
- Max function length: unchanged (`match_statement` about 150 lines); `write_bell_rows` is now about 70 lines
- Max nesting depth: 3
- Potential vulnerabilities: 0 (injection/authz); 1 abuse vector (W3, accepted)
- N+1 query risks: 0; scan statement count unchanged (≤16)
- Race conditions: W1 closed for withdraw; 1 rare pre-existing deadlock path (N1)

## Prioritized Recommendations
1. Optional N3: close the sheet before invalidating (saves a request and gives one close path).
2. N1: consider mapping deadlock and serialization failures to a 409 so a rare collision does not surface as a 500.
3. Remaining cheap info items: I14 (locality prefill fallback on create), I13 (wants error in AccountView), I12 (auxclick), I5 (constraint name).
