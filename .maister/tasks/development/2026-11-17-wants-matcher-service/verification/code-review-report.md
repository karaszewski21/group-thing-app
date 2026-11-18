# Code Review Report

## TL;DR
- **Status: ⚠️ Issues Found.** 0 critical, 2 warnings, 9 info, across 41 changed/new code files (backend `app/wants`, `main.py`, amended `0099`, new `src/matcher`, frontend `features/wanted` + hooks).
- I found no SQL injection, no PRIVATE-visibility leak and no secret in the logs. Every value is a bound parameter, the f-strings only splice module constants, and the DSN is `repr=False` and never logged.
- **W1:** the window has no upper bound. After a matcher outage the first window can exceed the 30 s timeout, and it never catches up. Expiry, reminders and purge sit in the same transaction and stall with it.
- **W2:** `update_want` holds the want's row lock while the text classifier runs (it can take up to 5 s).

**Date**: 2026-11-17
**Path**: uncommitted changes (`git diff HEAD` + untracked `src/matcher/**`, `bells_due.py`, `outbox_acl.py`, new tests, `MatchingStatus.tsx`, `SuggestionCard.tsx`)
**Scope**: all

## Key Decisions
These were taken as given and are not reported as defects:
- The PRIVATE visibility correlated `OR EXISTS` SubPlan (user decision, `measurement/results.md`).
- A window cost of about 39 ms per takeable listing, and the sustained-rate ceiling (about 500 new listings per minute). This is a documented risk.
- The spec also accepts two smaller things, so they are not reported: the stale window pair after an edit (spec Open Questions) and the suggestion-cap overshoot under concurrent runs (`/suggestions` LIMIT 10).
- Amending 0099 in place instead of adding 0100 (unreleased, behind the release gate). The backend's `_check_wants_contract` and the matcher's startup gate both stop on an old-0099 schema.

## Open Questions / Risks
- W1 is a different trigger from the accepted per-listing cost. It is about **downtime**, not sustained traffic. A one-hour matcher stop at about 25 listings/min already puts about 1,500 listings in one window. Should the window be bounded, or should operators get a runbook step for it?
- `words_pl` depends on `LC_CTYPE` while it is declared IMMUTABLE and feeds generated columns. This is documented (architecture.md runbook step 7), but nothing at startup checks it.

## Summary
- **Critical**: 0 issues
- **Warnings**: 2 issues
- **Info**: 9 issues

## Security assessment (no findings)
- **SQL injection.** `statements._statement` and `_WANTS.format(...)` only splice module constants: tier names, `MATERIALIZED`, a fixed `AND w.id = $2::uuid`. Every runtime value is `$n`. `limit_transaction` passes the timeout to `set_config` as `$1`. Backend `_ensure_name_has_word` uses `bindparam`. The old f-string `SET LOCAL statement_timeout` was removed. The `to_tsquery('''' || replace(stem, '''', '''''') || ...)` builders quote lexemes in SQL. Their input is `words_pl` output, which is runs of `[:alnum:]`, so it cannot carry quotes or operators.
- **PRIVATE visibility.** `matchable_listings` plus `private_group_peers` copy `listed_items_with_product_select` + `with_pending_proposer` and `parties_share_group(private_only=True)`, and `test_wants_visibility_parity.py` guards that copy. Every read path goes through `reads.visible_matches`: lists, counts, `/suggestions`, and the bell handler `_visible_pairs`. `missing_words` holds only the seeker's own words. `/suggestions` is covered by matrix row 66 and `_ensure_own_want`.
- **Secrets.** `Settings.dsn` is `field(repr=False)`. The DSN is never logged. `wait_for_contract` and `request_loop` log only exception type names for connection failures. asyncpg error texts never contain the password. The compose `DATABASE_URL` uses the same dev credentials as the existing `backend` service. `.dockerignore` excludes `.env*`, and the tool caches are git-ignored.

## Critical Issues
None.

## Warnings

### W1. The window is unbounded, so a backlog after an outage never clears, and expiry, reminders and purge stall with it
- **Location**: `src/matcher/matcher/window.py:102-110` (start = marker − overlap, end = `now`), `window.py:90-100` (expire/remind/purge in the same transaction)
- **Description**: Each run matches every listing created in `(marker − 2 min, now]`. The marker moves only when the whole run commits. If the matcher was stopped (deploy, crash, DB maintenance), the first run covers the whole gap. Each statement costs about 20 ms per takeable listing, so a gap of about 1,500 takeable listings exceeds the 30 s `statement_timeout`. The run rolls back, and the next run tries an even larger window, forever. EXPIRE, REMIND and PURGE are in the same transaction, so wants stop expiring, reminders stop and purge stops too. The log then shows one ERROR per minute. This is separate from the accepted per-listing cost: one outage is enough, with no high sustained rate needed.
- **Recommendation**: Bound each run. For example, end = `min(now, start + MAX_WINDOW_SPAN)` (or a listing-count cap via `ORDER BY created_at LIMIT n`), and move the marker to that end, so a backlog drains over several runs. Commit expire/remind/purge in their own transaction (or savepoint) before the match step, so they do not depend on its cost. Add a test where the marker is hours old.
- **Fixable**: true

### W2. `update_want` holds the want's row lock while the text classifier runs
- **Location**: `src/backend/app/wants/application/writes.py:206` (lock taken), `writes.py:220` (`_check_texts` → `moderation_acl.check_text`, with `INFERENCE_TIMEOUT_SECONDS = 5.0`)
- **Description**: The H3 lock (`FOR NO KEY UPDATE`) is now taken before the text checks. The classifier then runs while the row lock and an open transaction are held, which can take up to 5 s. While it runs:
  - the window's `EXPIRE`/`REMIND` `UPDATE` touching that want waits inside the window transaction, which also holds the advisory lock and the statement budget;
  - other writes by the seeker on the same want queue up.

  Before this change the classifier ran without a row lock.
- **Recommendation**: Run `clean_*`, `_check_texts` and the lookups on an unlocked read first. Then take the `FOR NO KEY UPDATE` lock (`populate_existing`), check that the row's `updated_at` is unchanged (otherwise 409, or re-check), and apply the edit. The H3 guarantee is kept because the delete and the flag still happen under the lock.
- **Fixable**: true

## Informational

### I1. The backoff map is never pruned
- **Location**: `src/matcher/matcher/requests.py:43-63`
- **Description**: `_failures` and `_retry_after` are cleared only on success. If a want is withdrawn, purged or un-flagged while it is backing off, its entries stay for the life of the process. This is a slow leak, and expired ids keep being scanned by `waiting()`.
- **Suggestion**: In `waiting(now)` (or a periodic pass), drop entries whose `retry_after` is long past.
- **Fixable**: true

### I2. Connection failures during a DB outage are logged with a full traceback every poll
- **Location**: `src/matcher/matcher/requests.py:101-105` with `db.py:97-103`
- **Description**: The `db.py` docstring says no connect error is logged. But a `pool.acquire()` failure in `process_next` reaches `drain` → `log_failure(..., exc_info=exc)`, which logs an ERROR with a traceback every 10 s, and the text carries host and port (not the password). The listener path logs the type name only, so the two paths are inconsistent.
- **Suggestion**: In `drain`, treat `OSError`/`asyncpg.InterfaceError`/connection errors like `request_loop` does: one WARNING with the type name.
- **Fixable**: true

### I3. Image hygiene
- **Location**: `src/matcher/Dockerfile:7`, `:17-25`
- **Description**: `pip install uv` is unpinned, so builds are not reproducible. The runtime stage runs as root.
- **Suggestion**: Pin uv (for example `COPY --from=ghcr.io/astral-sh/uv:<version>`), and add a non-root `USER`.
- **Fixable**: true

### I4. `words_pl` and `fold_pl` are recomputed for every candidate pair
- **Location**: `src/matcher/matcher/statements.py:117-118`
- **Description**: `public.words_pl(w.name)` (an aggregate SQL function, not inlinable) and `fold_pl` for each word are evaluated per pair that passes the text filter: about 32.8k pairs and about 1.0 s of the 9.2 s window statement at 500 listings. The values depend only on the want.
- **Suggestion**: Compute them once per want in `matchable_wants` (for example `public.words_pl(w.name) AS words`), or store them as a generated column in a later contract revision.
- **Fixable**: false (changes the measured plan or the DB contract, so it needs re-measurement)

### I5. `words_pl` is IMMUTABLE but depends on `LC_CTYPE`
- **Location**: `src/backend/alembic/versions/0099_wants.py:98`
- **Description**: Under a `C`/`POSIX` ctype, `[^[:alnum:]]+` treats `ą ę ł ó ś ź ż ć ń` as separators. „zimę” then becomes „zim”, and „łódź” is split up. These values are baked into the generated `stem_words`/`stem_query`. The docs cover this (runbook step 7), but nothing checks it at runtime.
- **Suggestion**: Make the class locale-independent (`[^[:alnum:]ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+`), or add a check of `pg_database.datctype` to the startup contract check.
- **Fixable**: true

### I6. `Db = Connection | Pool` allows a call without a transaction
- **Location**: `src/matcher/matcher/statements.py:30`, `:207-224`
- **Description**: Passing a `Pool` would run the MATCH and SUGGESTION statements on different connections, without `limit_transaction` and outside one transaction. The docstrings say "the caller owns the transaction".
- **Suggestion**: Type the parameter as `asyncpg.Connection` only.
- **Fixable**: true

### I7. Rows are fetched only to count them
- **Location**: `src/matcher/matcher/window.py:96`, `:100`
- **Description**: `EXPIRE` and `PURGE` return and transfer every id, but only `len()` is used. The existing `_row_count` would do the job.
- **Suggestion**: Use `connection.execute(...)` + `_row_count`, and drop `RETURNING id` from both.
- **Fixable**: true

### I8. The bell handler sends one statement per distinct seeker
- **Location**: `src/backend/app/wants/application/bells_due.py:58-67`
- **Description**: Measured at about 3 s per 1000-pair row (about 460 statements). This is a documented follow-up and is listed here for completeness.
- **Suggestion**: Use one `visible_matches`-equivalent statement over all seekers.
- **Fixable**: false (needs a set-based variant of `visible_matches`)

### I9. The want page polls 4 endpoints every 2 s while matching
- **Location**: `src/frontend/src/features/wanted/WantMatchesView.tsx:40` (with `hooks/useWants.ts` `useMatchingPolledQuery`)
- **Description**: The detail page also mounts `useWants()` to get its mutations. The list query polls too, because the current want is `matching`. That makes `/wants`, `/wants/{id}`, `/matches` (unpaged) and `/suggestions` every 2 s for 60 s.
- **Suggestion**: Let `useWants` take an option to disable list polling when it is used only for mutations.
- **Fixable**: true

### I10. Several live regions on the wanted list
- **Location**: `src/frontend/src/features/wanted/MatchingStatus.tsx:32`
- **Description**: Each matching card's `MatchingBadge` is a `role="status"` region, so a list with several matching wants announces several times on each refetch.
- **Suggestion**: Use plain text on the badges, or one list-level status.
- **Fixable**: true

### I11. The module name shadows a well-known package
- **Location**: `src/matcher/matcher/requests.py`
- **Description**: `matcher.requests` reads like the `requests` HTTP library in imports and tracebacks.
- **Suggestion**: Rename it, for example to `request_loop.py`.
- **Fixable**: true

## Metrics
- Max function length: about 55 lines (`writes.update_want`). Matcher functions are 40 lines or fewer.
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0
- N+1 query risks: 1 bounded, documented case (I8)
- Files analyzed: 41 (matcher 11 source + 9 tests read in part; backend 12; frontend 9)

## Prioritized Recommendations
1. W1: bound the window span or count, and commit expire/remind/purge separately, with a test for an hours-old marker.
2. W2: move `_check_texts` and the lookups before the `FOR NO KEY UPDATE` lock in `update_want`.
3. I5: make `words_pl` locale-independent, or check `datctype` in the contract gate.
4. I2 and I1: quieter outage logging and pruning of the backoff map.
5. I3, I6, I7, I9 to I11: small hygiene fixes.
6. I4 and I8: performance follow-ups after the release-gate measurements.
