# Implementation Plan: "Szukam" (wanted) mechanism

## TL;DR
- 19 task groups, 139 steps: a baseline run, 9 backend groups (foreign-module edits, `app/wants` model + migration 0099, domain + ACLs, match statement, measurement, writes + API, match list API, scan job), 7 frontend groups (data layer, shared components, three views, routes + entry points + mock removal, closing prompt), documentation, and a closing test review with a full-suite comparison against the baseline.
- Backend and frontend chains are independent after the baseline; inside each chain the order follows imports and shared files (`app/main.py`, `routing/paths.ts`, `test/AppPage.test.tsx`).
- Every group is test-first (2-8 scenario tests per feature file) and runs only its own tests; the full suites run twice only: group 1 and group 19.
- No commit, checkpoint commit or push anywhere; all work stays uncommitted.
- The spec (`implementation/spec.md`) is the source of truth; ids `FR-*` / `AC-*` below refer to it.

## Key Decisions
- The `EXPLAIN ANALYZE` measurement (group 7) runs right after the match statement (group 6) and before the scan job (group 10) — the spec wants the run-only checks before code is built on them, and the "fold once per listing" lever changes `matcher.py`, which the scan calls.
- The page views (groups 13-15) are built and tested without route files; one group (16) switches all routes, wires the three entry points and deletes the mock — `test/AppPage.test.tsx`, `test/routeManifest.test.ts`, `test/panelPages.ts` and `routing/paths.ts` are then edited by one group, and the three views can be built side by side.
- `routing/paths.ts`: group 11 adds `"add/wanted"`, `wantPath`, `wantEditPath` and keeps `"add/hunting"`; group 16 removes the old member — no group leaves the typecheck with new errors.
- Want responses with counters (list statement, FR-A-11) are built in group 8, match cards in group 9 — create must return `match_count` / `new_match_count`, so the read-time filter cannot wait for the match list.
- The auto-extension pin of FR-T-14 ("seen" inside the last 30 days) is written in `tests/test_wants_matches_api.py` (group 9), not in `tests/test_wants_lifecycle.py` — the route lives in group 9, and groups 9 and 10 then share no file.
- Exceptions (`WantNotFound`, conflict and timeout errors) live in `app/wants/application/errors.py` — `domain/` may import only `app.wants.domain`, and the exceptions subclass `app.core.errors` types.
- `component:bell-rows` needs no new UI: the copy is produced by the backend (groups 5 and 10); group 11 pins that the unchanged bell renders the three rows.
- Groups 1, 7 and 18 write no unit tests first (run-and-record, measurement, documentation); each states its own check instead.
- File names inside `app/wants/` and `features/wanted/` are fixed by this plan (the spec names only folders) so that `Files to Modify` can drive scheduling; an implementer who needs another split stays inside the group's file list or reports the change.

## Open Questions / Risks
- **Generated `tsquery` column (O1)**: unproven on PostgreSQL 18 until step 4.2 runs. Fallback: `name_query` becomes an application-written column filled by the same SQL expression helper as `short_words_query` (groups 6 and 8); record the outcome in the work log before group 6 starts.
- **Reverse-scan budget**: 500 listings x 10,000 wants is expected to miss 2 s. Lever order in group 7: fold product names once per listing (materialised CTE of the window), then plain-column pre-filters, then report. A longer interval or the outbox fallback is a user decision, not a plan step.
- **Unstable frontend baseline**: project memory records 24 Vitest, 5 typecheck and 2 backend failures on an earlier HEAD and a mypy baseline of 15; `AppPage`, `ItemDetailPage`, `routeManifest` are among the failing files this task edits. Without group 1 a regression cannot be told from an old failure.
- **Shared test files**: `test/AppPage.test.tsx` is edited by groups 12 (only if a `BottomNav` assertion changes) and 16; `tests/test_wants_notifications.py` by 3 and 10; `tests/test_wants_lifecycle.py` by 8 and 10; `app/main.py` by 8 and 10. The dependencies below make each pair sequential.
- **"Konto" prefix highlight** changes pages outside wants (`/places/...`, `/groups/:id`, `/family/...`); their existing assertions need a look in group 12.
- **Docker load**: backend groups that could run side by side each start their own testcontainers PostgreSQL 18.
- **Expected test count** (about 120-150) is far above the framework's usual 16-34, because the spec lists 21 test rows over 19 groups.
- **FR-D-13** asks for a pointer to the new user guide "only if this workflow produces user documentation"; that is a later phase, so group 18 corrects the text only.
- **Task items**: the task-tracking tool (`TaskCreate`) was not available to the planner; group-level items were not created. The markdown checkboxes are the only progress source.
- Risks carried from the spec unchanged: mandatory short prepositions, unbounded match list, thresholds 0.70 / 0.60 unmeasured (release gate), 0099 rollback rule.

## Rules for every implementer (repeat in every subagent prompt)
1. **Secrets**: never print secret values. No `env`, `printenv`, `docker compose exec <svc> env`, `docker inspect` (Env section) or `cat .env`. Presence checks only (exit code or `set` / `missing`). Never write a secret or a connection string into a report, the work log, the task folder, a screenshot or a script output.
2. **No git writes**: no `git commit`, no checkpoint commit, no `git push`, no branch change. Leave all work uncommitted.
3. **Backend commands** (from `src/backend`, Docker must be running for tests): `uv run python -m pytest tests/<file>.py -q`, `uv run python -m mypy app`, `uv run python -m ruff check`. Never `uv run pytest` / `uv run mypy` / `uv run ruff`.
4. **Frontend commands** (from `src/frontend`): `npm run test -- src/test/<file>` (Vitest, `vitest run`), `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint .`).
5. **No new failures**: compare with `implementation/baseline/` (group 1). A failure listed there is fixed only where this task rewrites the failing test.
6. **Test-first**: write the group's tests, then the code, then run only that group's test files (plus the named regression file where a step says so). The full suites run in groups 1 and 19 only.
7. **Standards**: read `.maister/docs/INDEX.md` and the standards named in the group before writing code.
8. **Spec wins**: where a mockup and the spec differ, follow the spec (see `implementation/visual-coverage.md`, "Spec overrides").
9. **Work log**: record deviations, the outcome of run-only checks and every "to confirm" text used in `implementation/work-log.md`.

## Overview
Total Steps: 139
Task Groups: 19
Expected Tests: about 120-150 new or rewritten tests (2-8 scenario tests per feature file; up to 10 more in group 19)

Paths: backend paths are relative to `src/backend/`, frontend paths to `src/frontend/src/`, unless they start with `.maister/` or `implementation/` (task folder `.maister/tasks/development/2026-11-15-szukam-wanted-mechanism/`).

## Implementation Steps

### Task Group 1: Test and static-check baseline
**Goal:** Record what fails before the first change, so later groups can tell a regression from an old failure.
**Satisfies:** FR-T-01; AC-35 (first half)
**Standards:** testing/backend-testing.md, testing/frontend-testing.md, global/conventions.md
**Dependencies:** None
**Files to Modify:** `implementation/work-log.md`, `implementation/baseline/backend-pytest.txt`, `implementation/baseline/backend-mypy.txt`, `implementation/baseline/backend-ruff.txt`, `implementation/baseline/frontend-vitest.txt`, `implementation/baseline/frontend-typecheck.txt`, `implementation/baseline/frontend-lint.txt`
**Estimated Steps:** 6

- [x] 1.0 Record the baseline (no source change in this group)
  - [x] 1.1 Check the preconditions without printing configuration
    - `git status --short` shows only the task folder as untracked; Docker answers (`docker info` exit code only)
    - Record HEAD (`git rev-parse --short HEAD`) in the work log
  - [x] 1.2 Run the backend suite from `src/backend`: `uv run python -m pytest -q`
    - Save the summary line and the ids of failing / erroring tests to `implementation/baseline/backend-pytest.txt` (ids only, no environment output)
  - [x] 1.3 Run `uv run python -m mypy app` and `uv run python -m ruff check`
    - Save the error count and the error lines to `backend-mypy.txt` / `backend-ruff.txt` (memory says mypy baseline 15; record the real number)
  - [x] 1.4 Run the frontend suite from `src/frontend`: `npm run test`
    - Save failing file and test names to `frontend-vitest.txt`; run a failing file a second time when it looks flaky (memory: `OrganizerEditor`) and mark it "flaky"
  - [x] 1.5 Run `npm run typecheck` and `npm run lint`; save the error lines to `frontend-typecheck.txt` / `frontend-lint.txt`
  - [x] 1.6 Write the baseline summary into `implementation/work-log.md`
    - Counts per check, the failing set, and which failing files this task edits (`AppPage`, `ItemDetailPage`, `routeManifest`, others found)

**Acceptance Criteria:**
- Six baseline files and a work-log entry exist; no source file changed
- The failing set is listed by test id, not only by count
- No secret, connection string or environment dump is in any recorded file

### Task Group 2: Groups visibility annotations
**Goal:** Let the group-sharing predicate be called with a column on the viewer side, by annotations only, and pin the column form.
**Satisfies:** FR-X-12, FR-T-17; AC-24
**Standards:** backend/models.md, backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md
**Dependencies:** 1
**Files to Modify:** `app/groups/infrastructure/visibility.py`, `tests/test_visible_to.py`
**Estimated Steps:** 4

- [x] 2.0 Widen the group-sharing predicate annotations
  - [x] 2.1 Write 3 tests in `tests/test_visible_to.py` for the column form of `parties_share_group` / `owner_shares_group_with(<column>, private_only=True)`
    - Shared live PRIVATE group gives true; soft-deleted group gives false; PUBLIC-only shared group gives false
    - Reuse the private-group world of `tests/test_visible_to.py:98-160`; the viewer side is a column of a selected row, not a Python value
  - [x] 2.2 Widen `other_party` of `parties_share_group` (:42) and `viewer` of `owner_shares_group_with` (:53) to `Parties`; update both docstrings
    - No runtime change, no facade change, no new function
  - [x] 2.3 Run `uv run python -m mypy app` and compare with the baseline (the widening must add no error)
  - [x] 2.4 Run only `uv run python -m pytest tests/test_visible_to.py tests/test_membership_definition_guard.py -q`

**Acceptance Criteria:**
- The 3 new tests pass; the existing tests of the file pass as in the baseline
- `git diff` of `visibility.py` shows annotations and docstrings only
- mypy count not above the baseline

### Task Group 3: Moderation fields and notification kinds and writers
**Goal:** Add the two text fields, the two notification kinds, the batch delete-unread-then-insert writer and the delete-only function.
**Satisfies:** FR-X-13, FR-X-14, FR-N-01, FR-N-02, FR-N-09, FR-W-08 (messages), FR-T-13 (writer pins); AC-40 (writer half)
**Standards:** backend/queries.md, backend/models.md, global/error-handling.md, testing/backend-testing.md, global/minimal-implementation.md
**Dependencies:** 1
**Files to Modify:** `app/moderation/text_guard.py`, `app/notifications/models.py`, `app/notifications/service.py`, `tests/test_wants_notifications.py`
**Estimated Steps:** 7

- [x] 3.0 Extend moderation and notifications
  - [x] 3.1 Write 4-6 tests in `tests/test_wants_notifications.py` (writer level, no wants tables needed)
    - Batch writer: several entries in one call give distinct ids, and exactly two statements run (`count_queries`)
    - An unread previous row is deleted and reported as deleted; a read previous row is left and reported as not deleted
    - Delete-only function removes unread rows only, in one statement, and returns the deleted ids
    - `check_text(TextField.WANT_NAME, ...)` rejection carries the fixed message of FR-W-08 (classifier stubbed as the existing text-guard tests do)
  - [x] 3.2 `app/moderation/text_guard.py`: add `TextField.WANT_NAME`, `TextField.WANT_NOTE` and their `MESSAGES` entries
    - "Nazwa poszukiwania narusza zasady społeczności. Zmień ją i spróbuj ponownie." / "Notatka narusza zasady społeczności. Zmień ją i spróbuj ponownie."
  - [x] 3.3 `app/notifications/models.py`: add `WANT_MATCH_FOUND`, `WANT_EXPIRING` to `NotificationKind`; update the docstring (no migration: VARCHAR(30), no CHECK)
  - [x] 3.4 `app/notifications/service.py`: batch writer, exported in `__all__`
    - Input: entries (recipient party, kind, message, link, previous row id or none)
    - One `DELETE ... WHERE id IN (...) AND read_at IS NULL RETURNING id`, then one batched `INSERT` supplying `id`, `created_at`, `updated_at` explicitly; returns the new ids and which previous rows were deleted; no flush or commit beyond the two statements
  - [x] 3.5 `app/notifications/service.py`: delete-only function, exported in `__all__` (one statement, unread rows only, returns deleted ids)
  - [x] 3.6 Run mypy and ruff on the touched files; compare with the baseline
  - [x] 3.7 Run only `uv run python -m pytest tests/test_wants_notifications.py -q`

**Acceptance Criteria:**
- The 4-6 tests pass
- `create_notification` and `mark_read` are unchanged
- The writer never updates a row in place

### Task Group 4: Wants data model and migration 0099
**Goal:** Create the package skeleton, the three tables, and prove the generated columns on PostgreSQL 18.
**Satisfies:** FR-X-01 (package, boundary docstring), FR-X-03 (status enum), FR-D-01, FR-D-02, FR-D-03, FR-D-04, FR-D-05, FR-T-10; AC-22
**Standards:** backend/models.md, backend/migrations.md, backend/time.md, testing/backend-testing.md
**Dependencies:** 1
**Files to Modify:** `app/wants/__init__.py`, `app/wants/models.py`, `app/wants/domain/__init__.py`, `app/wants/domain/status.py`, `alembic/versions/0099_wants.py`, `tests/test_wants_migration.py`
**Estimated Steps:** 7

- [x] 4.0 Build the wants tables
  - [x] 4.1 Write 4 tests in `tests/test_wants_migration.py` (template `tests/test_locality_coordinates_migration.py:32-45`)
    - Downgrade to 0098 then upgrade head (restore head in `finally`, `engine.dispose()`)
    - `name_folded` and `name_query` exist as generated columns and are filled for an inserted row
    - CHECKs reject radius 0, radius 101 and a radius without a locality
    - CHECK rejects `closed_at` not matching the status (both directions)
  - [x] 4.2 Run-only check O1 first: write `alembic/versions/0099_wants.py` by hand and apply it
    - `SET LOCAL lock_timeout = '5s'` first in upgrade and downgrade; templates `0082_media.py`, `0070_events.py`
    - Generated columns by raw `ALTER TABLE ... GENERATED ALWAYS AS (...) STORED`: `fold_pl(name)` and `plainto_tsquery('simple'::regconfig, fold_pl(name))` (two-argument form)
    - If PostgreSQL 18 refuses the `tsquery` column: make `name_query` a plain NOT NULL column written by the application, and record the fallback in the work log (groups 6 and 8 then write it)
  - [x] 4.3 Complete 0099: `wants`, `want_matches`, `want_scan_markers` with every constraint and index of FR-D-01..03
    - Names: `pk_wants`, `fk_wants_seeker_party_id_parties`, `fk_wants_category_id_categories` (SET NULL), `fk_wants_locality_id_localities` (RESTRICT), `ck_wants_radius_requires_locality`, `ck_wants_closed_at_matches_status`, `ix_wants_seeker_party_id_status`, `ix_wants_active_expires_at` (partial), `ix_wants_closed_at` (partial), `pk_want_matches`, `fk_want_matches_want_id_wants` (CASCADE), `uq_want_matches_want_id_item_id`, `ix_want_matches_item_id`, `uq_want_scan_markers_scan_name`
    - UUID PKs with `gen_random_uuid()` server default; no data revision; no extension; the `item_listing_preferences.created_at` index is NOT here (FR-D-06)
    - Downgrade drops `want_matches`, `want_scan_markers`, `wants` (indexes and FKs before tables); unguarded
  - [x] 4.4 `app/wants/__init__.py` (boundary docstring: only `app/main.py` imports `app.wants`) and `app/wants/domain/status.py` (`WantStatus`, match source values; no imports outside `app.wants.domain`)
  - [x] 4.5 `app/wants/models.py` in the `app/events/models.py` style
    - `BaseEntity`, `_enum_column`, business-key `__eq__` / `__hash__`, plain FK-id columns, no `relationship()`, loose `item_id` and `match_notification_id` pointers
    - Generated columns as `Computed(..., persisted=True)`, deferred with `deferred_raiseload=True`
  - [x] 4.6 Run mypy and ruff on `app/wants`; compare with the baseline
  - [x] 4.7 Run only `uv run python -m pytest tests/test_wants_migration.py -q`

**Acceptance Criteria:**
- The 4 tests pass; the database is at head after the file runs
- The O1 outcome (generated column or fallback) is written in the work log
- Model columns and migration columns agree one to one with FR-D-01..03

### Task Group 5: Wants domain rules, links and anti-corruption layers
**Goal:** Constants, pure rules, link and message builders, the nine ACLs, and the guards that keep the module boundary.
**Satisfies:** FR-X-01 (boundary guard), FR-X-02, FR-X-03, FR-X-04, FR-X-15 (boundary and clock parts), FR-N-04 (text builders), FR-W-01 and FR-W-02 (pure rules), FR-T-18 (boundary, clock, membership parts); AC-23
**Standards:** backend/models.md (one ACL per foreign module), backend/time.md, global/validation.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**Dependencies:** 2, 3, 4
**Files to Modify:** `app/wants/domain/limits.py`, `app/wants/domain/lifecycle.py`, `app/wants/domain/validation.py`, `app/wants/domain/links.py`, `app/wants/domain/messages.py`, `app/wants/infrastructure/__init__.py`, `app/wants/infrastructure/groups_acl.py`, `app/wants/infrastructure/inventory_acl.py`, `app/wants/infrastructure/product_acl.py`, `app/wants/infrastructure/category_acl.py`, `app/wants/infrastructure/locations_acl.py`, `app/wants/infrastructure/users_acl.py`, `app/wants/infrastructure/organizations_acl.py`, `app/wants/infrastructure/moderation_acl.py`, `app/wants/infrastructure/notifications_acl.py`, `tests/test_wants_domain.py`, `tests/test_module_boundaries.py`, `tests/test_domain_clock_guard.py`
**Estimated Steps:** 8

- [x] 5.0 Build the domain layer and the ACLs
  - [x] 5.1 Write 5-7 tests in `tests/test_wants_domain.py` (pure, no database)
    - Name rule: trimmed, 3-80 code points, at least one letter or digit; note: trimmed, up to 300, blank to null
    - Radius rule: 0 or null to null; 1-100 only with a locality; clearing the locality clears the radius
    - State machine: allowed transitions of FR-L-01..07 and the refused ones (edit / extend / close of a non-ACTIVE want, resume of an ACTIVE one)
    - Match message for count 1, 2-4, 5+, 22-24 and the expiring message (table test; the 500-character cap is applied by the caller in group 10, because `domain/` imports only `app.wants.domain`)
    - `want_path(id)` is `/wanted/{id}`
  - [x] 5.2 Extend the guards first: `"wants"` in `MODULES` and a `product_path` parity test against `app.search.domain.links.product_path` in `tests/test_module_boundaries.py`; `app/wants` in `_GUARDED_DIRS` of `tests/test_domain_clock_guard.py`
  - [x] 5.3 `domain/limits.py`: every constant of FR-X-03 (name 3-80, note 300, cap 30, top 20, validity 90 d, reminder 7 d, retention 30 d, auto-extension window 30 d, scan interval 15 min, overlap 5 min, thresholds 0.70 / 0.60, forward timeout 3 s)
  - [x] 5.4 `domain/validation.py` and `domain/lifecycle.py`: pure functions for the name, note and radius rules and for the state machine (files import only `app.wants.domain`)
  - [x] 5.5 `domain/links.py` (`product_path(slug, item_id)` as a pure copy of the search one, `want_path(id)`) and `domain/messages.py` (the four notification texts of FR-N-04 and the Polish error texts of FR-A-20 as constants; the cap text of FR-W-07)
  - [x] 5.6 Nine ACL files, each the only importer of its foreign module, none importing `..schemas` (shape of `app/search/infrastructure/*_acl.py`)
    - Contents exactly as FR-X-02; `derive_party_slug` in `groups_acl`; `users_acl` raises 401 on a missing profile and gives `party_id` and `account_user_id` (template `app/messaging/infrastructure/users_acl.py:25-32`); `notifications_acl` on the `notifications_bridge.py` template, exposing `create_notification`, the batch writer, the delete-only function and `NotificationKind`
    - Offer modes stay the plain strings `"GIFT"` / `"SWAP"`
  - [x] 5.7 Run mypy and ruff on `app/wants`; compare with the baseline
  - [x] 5.8 Run only `uv run python -m pytest tests/test_wants_domain.py tests/test_module_boundaries.py tests/test_domain_clock_guard.py tests/test_membership_definition_guard.py -q`

**Acceptance Criteria:**
- The domain tests and the three guard files pass
- `app/wants/domain/` imports nothing outside `app.wants.domain` (the notification cap `clock.fit_notification_message` is applied by the caller)
- No own shares-a-group SQL in `app/wants`; no `datetime.now(` / `date.today(`

### Task Group 6: Match statement
**Goal:** One statement builder for both directions that stores pairs and returns the inserted ones.
**Satisfies:** FR-M-01, FR-M-02, FR-M-03, FR-M-04, FR-M-05, FR-L-08, FR-W-10 (SQL expression), FR-T-11; AC-05, AC-06, AC-07 (operator present), AC-08 (radius match), AC-38, AC-40 (matcher half), AC-41
**Standards:** backend/queries.md, backend/jooq.md, backend/models.md (safe-by-default PRIVATE), backend/time.md, testing/backend-testing.md
**Dependencies:** 5
**Files to Modify:** `app/wants/application/__init__.py`, `app/wants/application/matcher.py`, `app/wants/application/text_queries.py`, `tests/test_wants_matcher.py`
**Estimated Steps:** 8

- [x] 6.0 Build the match statement
  - [x] 6.1 Write up to 8 scenario tests in `tests/test_wants_matcher.py` (grouped pins of FR-T-11; wants seeded by direct inserts with a per-file helper that fills `short_words_query` through `text_queries.py`; items listed through the existing endpoints; categories via `leaf_category_ids` per test)
    - Text: full-text hit; trigram hit at 0.70 without and 0.60 with a category; the compiled statement contains the `<%` operator and the `word_similarity` cut-off
    - Short words: "TV LG 43" never by trigram alone; "kurtka 3-5 lat" matches an identical product name
    - Narrowing: category subtree narrows and never matches alone; offer mode equal or null
    - Locality: same locality; radius 10 hits ANDRYCHOW from KETY (8.8 km) and "Tylko tu" misses; BIELSKO 14.4 km and LODZ 209 km misses; null-point fallback to "same locality"
    - Must not match: own item, PRIVATE without a shared live PRIVATE group, reserved, pending proposal, deleted place; only ACTIVE unexpired wants
    - Top-20 cap and order (score, then newest listing); several rows of one statement get distinct ids
    - Stored pairs are excluded before the ranking: a second forward run over 25 candidates adds the 5 not stored yet
    - Forward and reverse give the same pairs for the same data
  - [x] 6.2 `application/text_queries.py`: the SQL expression for `short_words_query` (lexemes of `to_tsvector('simple'::regconfig, fold_pl(:name))` of length up to 3 joined with `&`, null when none), and, only under the O1 fallback, the expression for `name_query`
  - [x] 6.3 `application/matcher.py`: base rows of FR-M-02
    - `wants` joined to `item_listing_preferences` UNALIASED, the listed-items select, `products`, `inventory_items`, a live `locations` row and its `localities` row, left join to the want's locality; only `status = 'ACTIVE'` and `expires_at > now`
  - [x] 6.4 Predicates of FR-M-03 as column forms (copies, not imports, of the search recipes; the category-only branch of search is NOT copied)
    - Own items, takeable (`AVAILABLE` and `proposer_party_id IS NULL` over `with_pending_proposer`), visibility (`PUBLIC`, or `PRIVATE` with `owner_shares_group_with(<seeker column>, private_only=True)`), offer mode, category ancestry, locality with haversine and the null-point fallback, text (full text OR indexable trigram branch with the CASE threshold and the short-words condition)
  - [x] 6.5 Ranking and insert of FR-M-01 / FR-M-04
    - Anti-join on `want_matches` before `row_number()`; top 20 per want by score desc, then `item_listing_preferences.created_at` desc
    - `INSERT ... SELECT` with `include_defaults=False`, explicit `gen_random_uuid()`, `created_at`, `updated_at`; `ON CONFLICT (want_id, item_id) DO NOTHING RETURNING want_id, item_id`
    - `score` = `word_similarity(name_folded, fold_pl(product name))` for every stored pair
  - [x] 6.6 Two entry functions over the one builder: forward (one want id, `source = FORWARD`, `seen_at = now`) and reverse (listing window `created_at > start AND <= now`, `source = SCAN`, `seen_at` null); both take `now`
  - [x] 6.7 Run mypy and ruff on `app/wants`; run the boundary and membership guards
  - [x] 6.8 Run only `uv run python -m pytest tests/test_wants_matcher.py -q`

**Acceptance Criteria:**
- The matcher tests pass
- One builder serves both directions; the predicates are not duplicated
- Bind parameters for every value; no unvalidated splicing; no incidental DISTINCT

### Task Group 7: Match statement measurement and index decision
**Goal:** Measure both directions on realistic data, record the result and decide the `item_listing_preferences.created_at` index.
**Satisfies:** FR-T-30, FR-D-06; AC-07 (plan at 20,000 items), AC-36
**Standards:** backend/queries.md, backend/jooq.md, backend/migrations.md (concurrent index, separate revision), global/conventions.md, global/minimal-implementation.md
**Dependencies:** 6
**Files to Modify:** `implementation/measurement/polish_names.py`, `implementation/measurement/seed_measurement.py`, `implementation/measurement/explain_match.py`, `implementation/measurement/results.md`, `implementation/work-log.md`; only if the measurement requires it: `alembic/versions/0100_listing_preferences_created_at_index.py`, `tests/test_wants_migration.py`, `app/wants/application/matcher.py`, `tests/test_wants_matcher.py`
**Estimated Steps:** 7

- [x] 7.0 Measure the match statement (scripts stay in the task folder, never in `src/`)
  - [x] 7.1 Write `seed_measurement.py` and `polish_names.py`
    - The script starts its own disposable PostgreSQL 18 (testcontainers, as `tests/conftest.py`), runs `alembic upgrade head`, and never prints or writes a connection string, password or environment value; it refuses to run against any configured application database
    - Names drawn from realistic Polish product names (inflection, sizes, brands), not random strings
    - Sizes: 5,000 and 20,000 listed items; 1,000 and 10,000 active wants, half with a category, a third with a locality
  - [x] 7.2 Write `explain_match.py`: `EXPLAIN (ANALYZE, BUFFERS)` of the reverse statement for windows of 20 and 500 new listings and of the forward statement for one want, using the builders of group 6 unchanged
  - [x] 7.3 Run the eight reverse points and the forward points; write plans, timings and buffers to `results.md`
    - Budgets: forward under 300 ms; reverse under 2 s at 500 listings x 10,000 wants
    - Checks: at 20,000 items the forward plan uses `ix_products_name_trgm` and the full-text index (a sequential scan at 5,000 is not a failure)
  - [x] 7.4 If the reverse budget fails, apply the levers in order and re-measure after each: fold product names once per listing (materialised CTE of the window's listings, predicates still shared by both directions); then plain-column pre-filters; then report the remaining gap
    - Any change to `matcher.py` re-runs `tests/test_wants_matcher.py` unchanged in meaning
    - A longer interval or the outbox fallback is NOT applied; it is reported for the user
  - [x] 7.5 Decide the `created_at` index and record the decision with its evidence in `results.md`
    - If needed: a separate revision `0100_*` with a concurrent build inside `autocommit_block()`, an exact-reverse downgrade, and one round-trip test added to `tests/test_wants_migration.py`
  - [x] 7.6 Record in `implementation/work-log.md`: budgets met or missed, levers applied, the index decision, and that thresholds 0.70 / 0.60 remain unmeasured (release gate)
  - [x] 7.7 Run only the tests touched by this group (`tests/test_wants_matcher.py`, and `tests/test_wants_migration.py` if 0100 was added)

**Acceptance Criteria:**
- `implementation/measurement/results.md` holds the plans, the timings against both budgets and the index decision
- No secret or connection string appears in the scripts' output or in the results
- Matcher tests pass after any lever

### Task Group 8: Want writes, lifecycle transitions and want API
**Goal:** Create, edit, extend, close and resume a want, return it with filtered counters, and expose the want-returning routes with authorization.
**Satisfies:** FR-X-10 (router), FR-X-11, FR-X-15 (matrix test), FR-M-06, FR-M-07 (counters), FR-N-06, FR-L-01, FR-L-02 (extend route), FR-L-03, FR-L-04, FR-L-06, FR-L-09, FR-L-10, FR-W-01..FR-W-10, FR-A-01 (list), FR-A-02..FR-A-07, FR-A-11, FR-A-14, FR-A-15, FR-A-20, FR-T-14 (transition pins), FR-T-15, FR-T-18 (matrix part); AC-01, AC-08 (radius 0), AC-09 (create, list), AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-21, AC-31 (backend half), AC-45 (response), AC-47
**Standards:** backend/api.md, backend/security.md, backend/queries.md, backend/models.md, backend/time.md, global/validation.md, global/error-handling.md, testing/backend-testing.md
**Dependencies:** 6
**Files to Modify:** `app/wants/schemas.py`, `app/wants/application/errors.py`, `app/wants/application/writes.py`, `app/wants/application/reads.py`, `app/wants/router/__init__.py`, `app/wants/router/wants.py`, `app/main.py`, `app/core/authorization_matrix.py`, `tests/test_authorization_matrix.py`, `tests/test_wants_api.py`, `tests/test_wants_lifecycle.py`
**Estimated Steps:** 10

- [x] 8.0 Build the want writes and the want API
  - [x] 8.1 Write up to 8 scenario tests in `tests/test_wants_api.py` (grouped pins of FR-T-15; per-file `_register` / `_auth` / `_create_want` helpers)
    - Create 201: a want inserted through the ORM over asyncpg matches with its generated columns; forward matches born seen; `new_match_count` 0; no notification row; exact key set including `category_name`, `category_path`, `locality_name`
    - Validation 400s with the texts of FR-A-20 (length, no letter or digit, note length, radius rules, unknown category / locality, unknown field); radius 0 stored as null
    - PATCH clearing the locality clears the radius, 200
    - Contact details (existing `CONTACT_INFO_MESSAGE` verbatim) and classifier rejection 400; outage 503; nothing saved; on create no database statement before the checks
    - Cap: 31st want 409 with the cap text, nothing written
    - Forward timeout (monkeypatched sqlstate 57014) 503 with nothing saved
    - Foreign and withdrawn want 404 on every `/{id}` route of this group; edit of a non-ACTIVE want 409
    - Note-only and switch-only PATCH keep matches; a matching-field PATCH deletes matches and the unread bell row (row seeded directly, pointer set), resets pointer and count, stores fresh forward matches
    - Statement counts of create and list constant with 1 and several wants / matches
  - [x] 8.2 Write 4-6 tests in `tests/test_wants_lifecycle.py` (transition pins of FR-T-14) and the rows in `tests/test_authorization_matrix.py`
    - Extend sets `expires_at = now + 90 d`, clears `reminded_at`, keeps matches, 409 when not ACTIVE
    - Close FULFILLED keeps bell rows; close WITHDRAWN deletes the unread match row and hides the want; 409 when not ACTIVE
    - Resume / reopen: cap check (409 with 30 active), `closed_at` null, new period, stored matches kept, forward match adds pairs born seen; 409 when already ACTIVE
    - Matrix: the two wants rows resolve; an OAuth token with only `mcp:*` scopes gets 403, a login token 200
  - [x] 8.3 `app/wants/schemas.py`: request schemas with `extra="forbid"` (create, patch, close with `outcome`), the want response of the spec; foreign types only through the module's own ACL files
  - [x] 8.4 `application/errors.py`: `WantNotFound` (404, Polish), the conflict exceptions (409) and the forward-timeout error (503) with the texts from `domain/messages.py` (template `app/events/service.py:33-104`)
  - [x] 8.5 `application/reads.py`: one statement that returns wants with `match_count` / `new_match_count` through the read-time filter (listed, `items_visible_to` with the seeker as viewer, `owner_party_id <> seeker_party_id`), `category_name`, `category_path`, `locality_name` by join or one batch; list order ACTIVE first then newest; never WITHDRAWN; selection always by `(id, seeker_party_id)`
  - [x] 8.6 `application/writes.py`: create in the order of FR-W-04 (text checks, profile, `SET LOCAL statement_timeout = '3s'`, cap count, existence checks, insert with `short_words_query` computed in SQL, forward match, commit); sqlstate 57014 rolls back and raises the 503 error
  - [x] 8.7 `application/writes.py`: PATCH through `model_fields_set` on the merged state (reference ids not re-validated when unchanged; `current` passed to `check_text`); a changed matching field deletes matches, deletes the unread bell row through the delete-only function, resets pointer and count and re-runs the forward match under the timeout
  - [x] 8.8 `application/writes.py`: extend, close (FULFILLED / WITHDRAWN with the bell-row delete) and resume / reopen, using `domain/lifecycle.py`
  - [x] 8.9 Router and wiring: `router/wants.py` on the `app/messaging/router.py` pattern (`require_any("READ")` for GET, `require_any("EDIT")` for POST / PATCH; literal paths before `/{id}`; no DELETE); `app/main.py` includes the router before `system_router`; two rows in `app/core/authorization_matrix.py` before the catch-all, copied from conversations rows 53-54
    - Routes of this group: `GET /api/wants`, `POST /api/wants`, `GET /{id}`, `PATCH /{id}`, `POST /{id}/extend`, `POST /{id}/close`, `POST /{id}/resume`
  - [x] 8.10 Run mypy and ruff; run only `uv run python -m pytest tests/test_wants_api.py tests/test_wants_lifecycle.py tests/test_authorization_matrix.py tests/test_module_boundaries.py -q`

**Acceptance Criteria:**
- The API, lifecycle and matrix tests pass
- Every `/{id}` route answers 404 for a foreign, withdrawn or unknown want
- GET routes write nothing; validation errors are 400, never 422
- Statement counts of create and list do not grow with rows

### Task Group 9: Match list API
**Goal:** Serve the match cards, the "seen" and "opened" marks and the `matched_item_id` lookup.
**Satisfies:** FR-M-07 (list), FR-L-02 (auto-extension inside "seen"), FR-A-01 (`matched_item_id`), FR-A-08, FR-A-09, FR-A-10, FR-A-12, FR-A-13, FR-A-15, FR-A-20 (unknown pair), FR-T-14 (auto-extension pin), FR-T-16; AC-09 (match list), AC-18, AC-19, AC-20, AC-42
**Standards:** backend/api.md, backend/queries.md, backend/security.md, backend/models.md, testing/backend-testing.md
**Dependencies:** 8
**Files to Modify:** `app/wants/schemas.py`, `app/wants/application/reads.py`, `app/wants/application/writes.py`, `app/wants/router/wants.py`, `tests/test_wants_matches_api.py`
**Estimated Steps:** 7

- [x] 9.0 Build the match list API
  - [x] 9.1 Write up to 8 scenario tests in `tests/test_wants_matches_api.py` (grouped pins of FR-T-16)
    - Exact card key set (`id`, `title`, `subtitle`, `href`, `meta` {`mode`, `condition`, `thumb_url`, `reserved`, `reserved_until`}, `is_new`, `reserved_by_me`, `proposed_by_me`)
    - Order: available first, then reserved; inside, new first then score
    - `reserved`, `reserved_by_me`, and `proposed_by_me` for an own pending proposal that is not the oldest
    - Unlisted and no-longer-visible items are left out and not counted; an item the seeker now owns and lists again is left out and not counted; `match_count` / `new_match_count` of the want equal the list
    - `GET /api/wants?matched_item_id=` returns only ACTIVE wants holding the item
    - "seen" resets `new_match_count`; extends an ACTIVE want only inside its last 30 days; for a non-ACTIVE want only the counter is reset
    - "opened" sets `opened_at` once; an unknown pair is 404 "Nie znaleziono dopasowania."
    - Statement count of the match list constant with 1 and several matches
  - [x] 9.2 `schemas.py`: the match card response
  - [x] 9.3 `reads.py`: the match list statement over stored pairs joined to the current state (same read-time filter as the counters, shared code), `proposed_by_me` as an own `EXISTS`, `reserved_by_me` from `reserved_by_user_id` against the caller's `account_user_id`; photos and organization slugs batched; `href` from `product_path(owner slug, item_id)`
  - [x] 9.4 `reads.py`: the `matched_item_id` filter on the list statement
  - [x] 9.5 `writes.py`: "seen" (set `seen_at` on unseen pairs; auto-extension through the extend rule) and "opened" (first open only)
  - [x] 9.6 `router/wants.py`: `GET /{id}/matches`, `POST /{id}/matches/seen`, `POST /{id}/matches/{item_id}/opened` (204), the `matched_item_id` query parameter
  - [x] 9.7 Run mypy and ruff; run only `uv run python -m pytest tests/test_wants_matches_api.py tests/test_wants_api.py -q`

**Acceptance Criteria:**
- The match-list tests pass; the tests of group 8 still pass
- Counters and list agree in every test that changes item state
- No limit and no paging on the match list (v1)

### Task Group 10: Scan job, sweep and scheduler wiring
**Goal:** The 15-minute job: sweep, reverse match, grouped bell rows, marker, one commit, and a wrapper that survives a lost race.
**Satisfies:** FR-X-10 (job), FR-S-01..FR-S-08, FR-N-03, FR-N-04, FR-N-05, FR-N-08, FR-L-05, FR-L-07, FR-T-12, FR-T-13 (scan pins), FR-T-14 (sweep pins); AC-02, AC-03, AC-04, AC-09 (scan), AC-16, AC-17, AC-25, AC-39, AC-43, AC-50
**Standards:** backend/queries.md, backend/jooq.md, backend/time.md, backend/models.md, global/error-handling.md, testing/backend-testing.md
**Dependencies:** 7, 8
**Files to Modify:** `app/wants/application/scan.py`, `app/wants/application/match_notifications.py`, `app/main.py`, `tests/test_wants_scan.py`, `tests/test_wants_notifications.py`, `tests/test_wants_lifecycle.py`
**Estimated Steps:** 9

- [x] 10.0 Build the scan job
  - [x] 10.1 Write up to 8 scenario tests in `tests/test_wants_scan.py` (grouped pins of FR-T-12; every call passes `now`; rows are dated by setting columns directly)
    - A new listing gives one pair and one bell row; a second run over the same window adds nothing
    - First run without a marker uses a window of 15 + 5 minutes and creates the row; the overlap is honoured
    - The register insert path (`list_registered_item`) is seen
    - Switch off: pairs stored, no bell row, pointer and bell count untouched; after re-enabling the first row counts only that run's pairs
    - Race: a want loaded through the ORM before a run that updates it raises `StaleDataError` on its write (the scan set `updated_at`)
    - The job wrapper swallows `StaleDataError` and the marker `IntegrityError`, rolls back, and the next run works; two first runs leave one marker row
    - Statement count constant with 1 and several wants / listings, at most 16
    - One log line per run (INFO when work was done, DEBUG otherwise)
  - [x] 10.2 Append 3-4 tests to `tests/test_wants_notifications.py` (scan pins of FR-T-13)
    - Count 1 names the item and links to its page; count 2+ gives the count and links to `/wanted/{id}`
    - An unread row is replaced by one row with the summed count; a read row is left and the new row starts from the run's count
    - End to end: withdraw and a matching-field edit delete the unread row created by a scan; read rows and reminder rows stay
  - [x] 10.3 Append 3-4 tests to `tests/test_wants_lifecycle.py` (sweep pins of FR-T-14)
    - Expire sets `EXPIRED` and `closed_at = expires_at`
    - Reminder once per period, also with the switch off, again after an extension
    - Purge 30 days after `closed_at` with cascade; an ACTIVE want is never purged; bell rows of purged wants stay
  - [x] 10.4 `application/scan.py`: `scan_wants(db, *, now=None)` with the sweep (expire, remind, purge) as set-based `UPDATE` / `DELETE ... RETURNING`; every set-based `UPDATE` of `wants` also sets `updated_at = now`
  - [x] 10.5 `application/scan.py`: marker as an ORM entity (version column checked), first-run window, reverse match over `(scanned_through - 5 min, now]`, marker moved to `now`, one commit, one log line with the fields of FR-S-05
  - [x] 10.6 `application/match_notifications.py`: group the inserted pairs per want with the switch on; batched owner slugs and product names; texts from `domain/messages.py` capped with `clock.fit_notification_message`; one call of the batch writer; pointer and count set in one multi-row `UPDATE` (summed count only when the writer deleted the unread row); `WANT_EXPIRING` rows as plain inserts
  - [x] 10.7 `app/main.py`: interval constant from the wants domain, the job wrapper (catches `StaleDataError` and the marker `IntegrityError`, logs, rolls back; other exceptions propagate), `add_job` on the existing `AsyncIOScheduler`; no statement timeout on the scan (OQ1 default)
  - [x] 10.8 Run mypy and ruff; run the boundary, clock and membership guards
  - [x] 10.9 Run only `uv run python -m pytest tests/test_wants_scan.py tests/test_wants_notifications.py tests/test_wants_lifecycle.py -q`

**Acceptance Criteria:**
- The scan, notification and sweep tests pass
- At most one unread match row per want after any sequence of runs
- The run is one transaction; statement count does not grow with wants, listings or matches
- Bell copy equals the three rows of `analysis/design-context/mockups/bell-rows.html` (one match naming the item, several with a count, the expiry reminder)

### Task Group 11: Frontend data layer and paths
**Goal:** Typed API client, the two hooks, the fixture factory, shared text helpers, the path builders and the notification kind union.
**Satisfies:** FR-F-02 (builders, new member), FR-F-04, FR-F-05 (UTC day counts), FR-F-15 (plural helper), FR-F-64, FR-N-07, FR-T-21, FR-T-29 (pending actions, kind list); AC-34
**Standards:** frontend/data-fetching.md, frontend/components.md, testing/frontend-testing.md, global/coding-style.md
**Dependencies:** 1
**Files to Modify:** `routing/paths.ts`, `api/wants.ts`, `hooks/useWants.ts`, `hooks/useWantMatches.ts`, `features/wanted/wantText.ts`, `features/wanted/WantNotFound.tsx`, `api/notifications.ts`, `test/fixtures/wants.ts`, `test/useWants.test.tsx`, `test/useWantMatches.test.tsx`, `test/wantText.test.ts`, `test/pendingActions.test.ts`, `test/MyItemsViewCategory.test.tsx`, `test/NotificationBell.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/bell-rows.html
  element: component:bell-rows
  locator: the three bell rows, approx. lines 278-280
  acceptance: the unchanged `NotificationBell` renders a `WANT_MATCH_FOUND` row with the message "Szukasz: «…». Ktoś wystawił: «…»." linking to the item page, a row "… 3 nowe pasujące rzeczy." linking to `/wanted/{id}`, and a `WANT_EXPIRING` row "Poszukiwanie «…» wygaśnie za 7 dni. Przedłuż je, jeśli nadal szukasz." linking to `/wanted/{id}`; no new bell markup
- mockup: analysis/design-context/mockups/wanted-matches-states.html
  element: screen:wanted-matches-states
  locator: fourth frame (own not-found state), approx. lines 308-313
  acceptance: `WantNotFound` shows "Nie ma takiego poszukiwania", "Mogło zostać wycofane albo usunięte po zakończeniu." and the link "Wróć do listy „Szukam”" to `/wanted`
**Estimated Steps:** 8

- [x] 11.0 Build the frontend data layer
  - [x] 11.1 Write the typed factory `test/fixtures/wants.ts` (no `as` casts) and 6-8 tests across `test/useWants.test.tsx`, `test/useWantMatches.test.tsx`, `test/wantText.test.ts`
    - `useWants`: token in the key, disabled without a token, stable empty fallback, each mutation awaits invalidation of the whole prefix and passes the server message through
    - `useWantMatches`: want + matches, not-found flag on 404, `markSeen`, `markOpened`
    - `wantText`: filter summary variants of FR-F-12 (node name / full path, "Oddam" / "Zamiana", "Kęty +10 km", "Kęty", "cała Polska", "Bez doprecyzowania", "powiadomienia wyłączone"), plural forms ("1 pasująca rzecz", "3 pasujące rzeczy", "5 pasujących rzeczy", "1 nowa", "2 nowe", "5 nowych"), day counts from naive-UTC timestamps with a pinned clock
  - [x] 11.2 Add or adjust the kind tests: a `test/pendingActions.test.ts` row showing the two new kinds create no blocking sheet; rewrite the hard-coded kind list of `test/MyItemsViewCategory.test.tsx:508-526`; one `test/NotificationBell.test.tsx` case for the three wants rows
  - [x] 11.3 `routing/paths.ts`: add the `View` member `"add/wanted"` (keep `"add/hunting"` until group 16), `wantPath(id)`, `wantEditPath(id)` (as `placeEditPath`)
  - [x] 11.4 `api/wants.ts`: request and response types and calls for FR-A-01..10; `api/notifications.ts`: add `WANT_MATCH_FOUND`, `WANT_EXPIRING`, remove the stale `PLEDGE_ITEM_REGISTERED`
  - [x] 11.5 `hooks/useWants.ts` on the `hooks/useMyLocations.ts` template (key `[WANTS_KEY, "mine", token]`, `enabled: token !== null`, `create`, `update`, `extend`, `close`, `resume`, the `matched_item_id` lookup) and `hooks/useWantMatches.ts` on the `hooks/useEvent.ts` template under the same prefix
  - [x] 11.6 `features/wanted/wantText.ts` (summary line, plural forms through `utils/plural.ts`, day counts with the UTC plugin of `utils/dayjs.ts`) and `features/wanted/WantNotFound.tsx` (shared by the edit form and the match page)
  - [x] 11.7 Run `npm run typecheck` and `npm run lint`; compare with the baseline
  - [x] 11.8 Run only `npm run test -- src/test/useWants.test.tsx src/test/useWantMatches.test.tsx src/test/wantText.test.ts src/test/pendingActions.test.ts src/test/MyItemsViewCategory.test.tsx src/test/NotificationBell.test.tsx`

**Acceptance Criteria:**
- The new and adjusted tests pass
- No ad hoc `useQuery` in components; `dayjs` only from `utils/dayjs.ts`
- Typecheck errors not above the baseline (the old `View` member still exists)
- Each `acceptance` of the Visual References holds

### Task Group 12: Shared component changes
**Goal:** The small optional props and the one extraction that the wants views need, with existing callers unchanged.
**Satisfies:** FR-F-60, FR-F-61, FR-F-62, FR-F-63, FR-F-65, FR-T-29 (BottomNav, picker, combobox, card); AC-32, AC-33
**Standards:** frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md
**Dependencies:** 1
**Files to Modify:** `components/shared/RadiusChips.tsx`, `components/shared/chipStyles.ts`, `features/search/SearchFilters.tsx`, `features/search/useSearchUrlState.ts`, `components/shared/ItemCard.tsx`, `components/shared/CategoryTreePicker.tsx`, `components/shared/LocalityCombobox.tsx`, `components/layout/BottomNav.tsx`, `utils/appHelpers.ts`, `test/RadiusChips.test.tsx`, `test/ItemCard.test.tsx`, `test/BottomNav.test.tsx`, `test/CategoryTreePicker.test.tsx`, `test/LocalityCombobox.test.tsx`, `test/AppPage.test.tsx` (only if an existing "Konto" highlight assertion changes)
**Visual References:**
- mockup: analysis/design-context/mockups/wanted-form.html
  element: screen:wanted-form
  locator: second frame (prefilled, "Doprecyzuj" expanded), the "Miejscowość" and "Kategoria" fields, approx. lines 296-303
  acceptance: radius chips in the order "Tylko tu", "+10 km", "+25 km", "+50 km" with `aria-pressed`; `LocalityCombobox` accepts the placeholder "Cała Polska — wpisz, aby zawęzić"; `CategoryTreePicker` accepts the clear label "Dowolna kategoria"; defaults of both props unchanged
- mockup: analysis/design-context/mockups/wanted-matches.html
  element: component:match-card
  locator: first frame, card grid, approx. lines 281-309
  acceptance: `ItemCard` shows a "nowe" marker when the optional prop is passed and nothing new when it is not; the intent pill keeps today's labels
**Estimated Steps:** 8

- [x] 12.0 Change the shared components
  - [x] 12.1 Run `npm run test -- src/test/SearchView.test.tsx` first and record the result for L134-210 (must be the same after step 12.3)
  - [x] 12.2 Write 6-8 tests: `test/RadiusChips.test.tsx` (four chips, pressed state, null for "Tylko tu"), `test/ItemCard.test.tsx` (marker shown / absent), `test/BottomNav.test.tsx` ("Konto" highlighted on `/wanted/abc`, `/wanted/abc/edit`, `/places/new`; not on `/search`), one case each in `test/CategoryTreePicker.test.tsx` and `test/LocalityCombobox.test.tsx` (prop given; default unchanged)
  - [x] 12.3 Extract only the radius chips and the chip style constants from `features/search/SearchFilters.tsx` (L196-208, L30-34) into `components/shared/RadiusChips.tsx` and `components/shared/chipStyles.ts`; `SearchFilters.tsx` uses them
    - The heading, the "Ostatnio" chip, `MajorTownPicker`, the +10 km default on pick and the offer toggles stay in `SearchFilters.tsx` unchanged
  - [x] 12.4 `ItemCard`: one optional marker prop; `CategoryTreePicker`: one optional clear-label prop (default "Kategoria główna (brak)"); `LocalityCombobox`: one optional `placeholder` prop (default "Nazwa lub kod pocztowy")
  - [x] 12.5 `BottomNav` / `utils/appHelpers.ts`: "Konto" highlighted by prefix (exact path or path + "/...") for all `ACCOUNT_SUBVIEWS`
  - [x] 12.6 Check the pages the prefix now touches (`/places/...`, `/groups/:id`, `/family/...`): run the test files that assert the active tab and adjust only an assertion the new rule changes on purpose
  - [x] 12.7 Run `npm run typecheck` and `npm run lint`; compare with the baseline
  - [x] 12.8 Run only the five test files of 12.2 plus `src/test/SearchView.test.tsx`

**Acceptance Criteria:**
- The new tests pass; `test/SearchView.test.tsx` L134-210 has the same result as in 12.1
- Every existing caller of the three components compiles unchanged
- Each `acceptance` of the Visual References holds

### Task Group 13: Want list view
**Goal:** The `/wanted` list as a feature view with its view state (no route file here).
**Satisfies:** FR-F-03 (list), FR-F-10, FR-F-11, FR-F-12, FR-F-13, FR-F-14, FR-F-15, FR-F-39 (list actions), FR-T-20 (list), FR-T-23; AC-26 (list), AC-45 (node name), AC-49 (list)
**Standards:** frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, global/error-handling.md, testing/frontend-testing.md
**Dependencies:** 11, 12
**Files to Modify:** `features/wanted/WantedListView.tsx`, `features/wanted/wantedListViewState.ts`, `test/wantedListViewState.test.ts`, `test/WantedListView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/wanted-list.html
  element: screen:wanted-list
  locator: first frame (list with five cards), approx. lines 276-298; second frame (empty state), approx. lines 300-308
  acceptance: header order: back "‹ Konto", h1 "Szukam", link "+ Dodaj", intro "Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz."; no inline add field; active card: name link, summary joined with " · ", pill "N nowe", match band ("N pasujących rzeczy" or "Jeszcze nic · powiadomimy Cię" with a bell icon), "Ważne jeszcze N dni" with "Przedłuż" at 7 days or fewer; expired card: "Wygasło N dni temu", pill "Wygasło", "Zniknie z listy za M dni", "Wznów"; fulfilled card: "Znalezione N dni temu", pill "Znalezione", "Szukam znowu"; empty state: "Czego potrzebujesz?", "Dodaj rzecz, której szukasz, np. fotelik albo kurtkę na zimę.", "+ Dodaj poszukiwanie". Spec override: the summary shows the category node name (`category_name`), not the mockup's top-level name
**Estimated Steps:** 6

- [x] 13.0 Build the list view
  - [x] 13.1 Write the `it.each` table in `test/wantedListViewState.test.ts` (`loading`, `error`, `empty`, `list`, including a stale list with a refresh error) and up to 8 tests in `test/WantedListView.test.tsx` (`vi.mock("../api/wants")`, `renderWithRoute`, pinned clock)
    - Header copy and links; summary line variants; "N nowe"; match band at 0 and above; expiry hint and "Przedłuż"; expired and fulfilled rows with their actions; a 409 on resume shown verbatim in an inline `role="alert"` by the action; empty state
  - [x] 13.2 `wantedListViewState.ts`: pure `resolveWantedListView()` returning one discriminated state
  - [x] 13.3 `WantedListView.tsx`: header, intro, cards (active / expired / fulfilled) and the empty state; the page only switches on `view.kind`; icons from `components/shared/appIcons.tsx`; text from `features/wanted/wantText.ts`
  - [x] 13.4 Actions: "Przedłuż" (extend), "Wznów" / "Szukam znowu" (resume) through `useWants`; failures inline next to the action, no toast
  - [x] 13.5 Run `npm run typecheck` and `npm run lint`; compare with the baseline
  - [x] 13.6 Run only `npm run test -- src/test/wantedListViewState.test.ts src/test/WantedListView.test.tsx`

**Acceptance Criteria:**
- Both test files pass
- No category-tree load; router access only through `routing/navigation.tsx`
- Each `acceptance` of the Visual References holds (with the spec override)

### Task Group 14: Want form view
**Goal:** One form view for `/add/wanted` and `/wanted/:id/edit` (no route file here).
**Satisfies:** FR-F-03 (form), FR-F-20..FR-F-29, FR-T-20 (form), FR-T-22; AC-26 (form), AC-27, AC-46
**Standards:** frontend/components.md, frontend/accessibility.md, global/validation.md, global/error-handling.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md
**Dependencies:** 11, 12
**Files to Modify:** `features/wanted/WantFormView.tsx`, `features/wanted/wantFormViewState.ts`, `features/wanted/WantDisclosure.tsx`, `features/wanted/OfferModeChips.tsx`, `test/wantFormViewState.test.ts`, `test/WantFormView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/wanted-form.html
  element: screen:wanted-form
  locator: three frames: empty create (approx. lines 276-288), prefilled with "Doprecyzuj" expanded (approx. lines 290-308), edit (approx. lines 310-329)
  acceptance: titles "Szukam rzeczy" / "Edytuj poszukiwanie"; create intro "Napisz, czego szukasz — damy znać, gdy ktoś doda pasującą rzecz."; field order: name ("Czego szukasz?", placeholder "Np. kask rowerowy dla dziecka", counter "N/80 znaków"), disclosure, "Kategoria", "Jak chcesz dostać rzecz?" chips "Obojętnie" / "Oddam" / "Zamiana", "Miejscowość" with radius chips after a pick, "Notatka dla siebie" (placeholder "Rozmiar, kolor, do kiedy potrzebujesz", helper "Widzisz ją tylko Ty. N/300 znaków"); buttons "Zapisz poszukiwanie" / "Zapisz zmiany" + "Anuluj"; edit hint "Zmiana nazwy, kategorii, sposobu lub miejsca wyszuka dopasowania od nowa."; back link "‹ Dodaj" / "‹ {want name}". Spec override: only the locality field and the radius chips (no "Lokalizacja" heading, no `MajorTownPicker`, no "Ostatnio" chip)
- mockup: analysis/design-context/mockups/wanted-form.html
  element: component:want-disclosure
  locator: the "Doprecyzuj (opcjonalnie)" button in each frame, approx. lines 282, 296, 315
  acceptance: `<button type="button">` with `aria-expanded`, `aria-controls` and an `aria-hidden` ▸/▾; collapsed on an empty create form; expanded on edit and when opened with `category`, `offer_type`, `locality` or `radius`
- mockup: analysis/design-context/mockups/wanted-form-errors.html
  element: screen:wanted-form-errors
  locator: three frames: prefilled name out of range (approx. lines 276-293), 409 limit (approx. lines 295-306), contact / moderation / 503 (approx. lines 308-323)
  acceptance: out-of-range name shown as typed with the inline `role="alert"` "Nazwa musi mieć od 3 do 80 znaków.", `aria-invalid`, `aria-describedby`, blocked submit; server errors in a `role="alert"` block above the name field, verbatim; the 409 on create adds the link "Zobacz listę" to `/wanted`; the form stays filled. Spec override: the contact-details message is the server's existing `CONTACT_INFO_MESSAGE` verbatim, not the mockup's shortened text
**Estimated Steps:** 8

- [x] 14.0 Build the form view
  - [x] 14.1 Write the `it.each` table in `test/wantFormViewState.test.ts` (create `ready`; edit `loading`, `error`, `notFound`, `ready`, non-ACTIVE redirect) and up to 8 tests in `test/WantFormView.test.tsx` (grouped pins of FR-T-22)
    - Field order and copy; disclosure state and ARIA in the three openings
    - Prefill from `name`, `category`, `offer_type`, `locality`, `radius`; out-of-range prefilled name with the inline error and blocked submit
    - `aria-disabled` + hint "Wpisz, czego szukasz (3–80 znaków)."; native `disabled` only while saving; over-length note blocks the submit
    - "Obojętnie" sends null and the three chips are exclusive; picking a locality selects "Tylko tu", which sends null; clear label "Dowolna kategoria"
    - No `MajorTownPicker`, no "Ostatnio" chip; `features/search/lastLocality.ts` storage neither read nor written
    - Server error block and the 409 link; `replace` to `wantPath(id)` after save; edit hint, "Anuluj", back links (including "‹ Szukaj" with prefill)
  - [x] 14.2 `wantFormViewState.ts`: pure `resolveWantFormView()` for create and edit
  - [x] 14.3 `WantDisclosure.tsx` and `OfferModeChips.tsx` (the form's own three exclusive chips with `aria-pressed`, styled with `components/shared/chipStyles.ts`)
  - [x] 14.4 `WantFormView.tsx`: fields in the mockup order with `CategoryTreePicker` (`mode="any"`, clear label), `LocalityCombobox` (placeholder prop; prefilled locality loaded with `hooks/useLocality`), `RadiusChips`, the note with its counter
  - [x] 14.5 Validation and submit: raw strings in state, inline Polish errors, `aria-disabled` + `aria-describedby` with a handler guard, create / update through `useWants`, navigate with `replace` to `wantPath(id)`
  - [x] 14.6 Edit mode: load through `useWantMatches` or the list hook, `notFound` with `WantNotFound`, a non-ACTIVE want navigates with `replace` to `wantPath(id)`, "Anuluj" and the hint
  - [x] 14.7 Run `npm run typecheck` and `npm run lint`; compare with the baseline
  - [x] 14.8 Run only `npm run test -- src/test/wantFormViewState.test.ts src/test/WantFormView.test.tsx`

**Acceptance Criteria:**
- Both test files pass
- Every inner button of pickers is `type="button"`; no native `disabled` for input-blocked submit
- Each `acceptance` of the Visual References holds (with the spec overrides)

### Task Group 15: Match list view
**Goal:** The `/wanted/:id` page view with its states, toggle, cards and actions (no route file here).
**Satisfies:** FR-F-03 (match list), FR-F-30..FR-F-39, FR-T-20 (match list), FR-T-24; AC-20 (captions), AC-26 (match list), AC-31, AC-44, AC-45 (full path), AC-49
**Standards:** frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, global/error-handling.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md
**Dependencies:** 11, 12
**Files to Modify:** `features/wanted/WantMatchesView.tsx`, `features/wanted/wantMatchesViewState.ts`, `features/wanted/WantNotificationToggle.tsx`, `features/wanted/MatchCard.tsx`, `test/wantMatchesViewState.test.ts`, `test/WantMatchesView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/wanted-matches.html
  element: screen:wanted-matches
  locator: two frames (5 matches, 3 matches), approx. lines 276-331
  acceptance: back "‹ Szukam", link "Edytuj"; h1 name; filter line with the full category path ("Zabawki › Pojazdy dla dzieci"); "Notatka: …" when a note exists; toggle row; heading "N pasujących rzeczy" / "1 pasująca rzecz"; card grid; "Ważne jeszcze N dni"; actions "Znalezione — zamknij", "Przedłuż", "Wycofaj"
- mockup: analysis/design-context/mockups/wanted-matches.html
  element: component:want-notification-toggle
  locator: the toggle row in each frame, approx. lines 280 and 313
  acceptance: label "Powiadomienia o nowych rzeczach", sub-text "Damy znać w dzwonku" (on) / "Wyłączone" (off), `role="switch"` with `aria-checked`, accessible name = the visible label; a change sends a PATCH of `notifications_enabled` alone; a failure reverts and shows the server message in an inline `role="alert"`
- mockup: analysis/design-context/mockups/wanted-matches.html
  element: component:match-card
  locator: the cards of both frames, approx. lines 281-325
  acceptance: `ItemCard` with the "nowe" marker for items new on first load; caption "Zarezerwowane przez Ciebie", else "Twoja propozycja", else "Zarezerwowane". Spec override: the intent pill keeps the labels `ItemCard` renders today (the mockup's "Oddam" / "Zamiana" pills are not copied)
- mockup: analysis/design-context/mockups/wanted-matches-states.html
  element: screen:wanted-matches-states
  locator: four frames: no matches (approx. lines 276-285), expired (approx. lines 287-298), withdraw confirmation (approx. lines 300-306), not found (approx. lines 308-313)
  acceptance: no matches: bell icon, "Jeszcze nic nie pasuje", "Damy znać, gdy ktoś doda pasującą rzecz.", actions "Przedłuż o 90 dni", "Znalezione", "Wycofaj"; expired: "To poszukiwanie wygasło N dni temu. Nie szukamy już nowych rzeczy. Zniknie z listy za M dni.", "Wznów na 90 dni", stored matches below, no "Edytuj", no toggle; withdraw dialog: "Wycofać poszukiwanie?", "„{name}” zniknie z listy razem z dopasowaniami. Nie damy już znać o nowych rzeczach.", "Wycofaj" / "Anuluj"; not found: the shared `WantNotFound`
**Estimated Steps:** 8

- [x] 15.0 Build the match list view
  - [x] 15.1 Write the `it.each` table in `test/wantMatchesViewState.test.ts` (`loading`, `error`, `notFound`, `active`, `activeEmpty`, `expired`, `fulfilled`, stale data with a refresh error) and up to 8 tests in `test/WantMatchesView.test.tsx` (grouped pins of FR-T-24)
    - Header with `category_path` and the note; "Edytuj" only in active states
    - Toggle PATCH with `notifications_enabled` alone; a failed toggle reverts and shows the inline alert
    - "seen" called once across re-renders; "nowe" markers still shown after the refetch that follows "seen"
    - The three captions; "opened" fired on card open without blocking navigation, its failure ignored
    - Actions and the primary-action default (extend first at 7 days or fewer); "Znalezione" leaves the page on the fulfilled state
    - Withdraw dialog: confirm navigates to `/wanted`; an error stays inline in the open dialog
    - Expired state, fulfilled state ("Oznaczone jako znalezione N dni temu. …", "Szukam znowu"), own not-found state
  - [x] 15.2 `wantMatchesViewState.ts`: pure `resolveWantMatchesView()` with an `Extract<…>` sub-union for the states that show matches
  - [x] 15.3 `WantNotificationToggle.tsx` and `MatchCard.tsx` (wraps `ItemCard`, marker and caption)
  - [x] 15.4 `WantMatchesView.tsx`: header, filter line, note, toggle, heading, grid, expiry line; switch on `view.kind` only
  - [x] 15.5 "seen" effect guarded by a ref after the matches have loaded; the ids that were new on first load kept in page state for the markers
  - [x] 15.6 Actions: close as `FULFILLED`, extend, resume, withdraw through `components/shared/ConfirmDeleteDialog`; failures inline by the action (FR-F-39)
  - [x] 15.7 Run `npm run typecheck` and `npm run lint`; compare with the baseline
  - [x] 15.8 Run only `npm run test -- src/test/wantMatchesViewState.test.ts src/test/WantMatchesView.test.tsx`

**Acceptance Criteria:**
- Both test files pass
- No category-tree load; no closing sheet on this page
- Each `acceptance` of the Visual References holds (with the spec override)

### Task Group 16: Routes, entry points and mock removal
**Goal:** Mount the three views on their routes, wire the three entry points with real counts, and delete the demo.
**Satisfies:** FR-F-01, FR-F-02 (old member removed), FR-F-05 (no wants query on the server), FR-F-40, FR-F-41, FR-F-42, FR-F-43, FR-F-70, FR-T-26, FR-T-27, FR-T-28, FR-T-29 (`ssrSafety`); AC-26 (routes, `/add/hunting` gone), AC-28, AC-30
**Standards:** frontend/components.md (thin route files, no redirect page, server-safe rendering), frontend/data-fetching.md, frontend/accessibility.md, testing/frontend-testing.md, global/minimal-implementation.md
**Dependencies:** 13, 14, 15
**Files to Modify:** `app/(site)/(panel)/wanted/page.tsx`, `app/(site)/(panel)/wanted/[id]/page.tsx`, `app/(site)/(panel)/wanted/[id]/edit/page.tsx`, `app/(site)/(panel)/add/wanted/page.tsx`, `app/(site)/(panel)/add/hunting/page.tsx` (deleted), `routing/paths.ts`, `features/add/AddView.tsx`, `features/panel/PanelGate.tsx`, `features/account/AccountView.tsx`, `features/search/SearchView.tsx`, `features/search/WantedView.tsx` (deleted), `features/add/HuntingCreateView.tsx` (deleted), `utils/mocks.ts`, `test/HuntingCreateView.test.tsx` (deleted), `test/AppPage.test.tsx`, `test/addRoute.test.tsx`, `test/SearchView.test.tsx`, `test/routeManifest.test.ts`, `test/panelPages.ts`, `test/panelPages.test.ts`, `test/auth.test.tsx`, `test/ssrSafety.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/entry-points.html
  element: component:entry-points
  locator: three frames: `/add` tile (approx. lines 279-285), "Konto" row (approx. lines 287-295), empty-search prompt (approx. lines 297-306)
  acceptance: tile "Szukam rzeczy" / "Damy znać, gdy ktoś doda pasującą" links to `/add/wanted` and shows the pill "N nowe" when the summed `new_match_count` is above 0; "Konto" row "Szukam" shows "N rzeczy · M nowe dopasowania" (second part only when M > 0; "brak" at zero; N = ACTIVE wants) and links to `/wanted`; empty search: sentence "Damy znać, gdy ktoś doda pasującą rzecz." and link "Dodaj do listy „Szukam”" to `/add/wanted` with `name`, `category`, `offer_type`, `locality`, `radius` for each set value. Spec override: only the prompt block changes; today's heading, body and the scope-"mine" suffix stay; the mockup's "Szukaj wszędzie" button is not built
- mockup: analysis/design-context/mockups/wanted-list.html
  element: screen:wanted-list
  locator: whole first frame as mounted at `/wanted`, approx. lines 276-298
  acceptance: `/wanted` renders `WantedListView`; `/wanted/:id` renders `WantMatchesView`; `/wanted/:id/edit` and `/add/wanted` render `WantFormView`; `/add/hunting` does not exist and no redirect page is added
**Estimated Steps:** 9

- [x] 16.0 Mount the routes and wire the entry points
  - [x] 16.1 Rewrite the mock-bound tests first (they must fail for the right reason before the code changes)
    - `test/routeManifest.test.ts`, `test/panelPages.ts`, `test/panelPages.test.ts`: `/add/wanted`, `/wanted/:id`, `/wanted/:id/edit` present; `/add/hunting` gone; no redirect page
    - `test/AppPage.test.tsx` (mocks L50-192, defaults L488, wants section L2926-3038): `vi.mock("../api/wants")`; `/wanted` shows the new list; "Konto" row counts ("brak", "N rzeczy", "N rzeczy · M nowe dopasowania")
    - `test/addRoute.test.tsx`: tile link `/add/wanted`, pill with the count from `AddView`, no count and no wants call on `PublicAddView`
    - `test/SearchView.test.tsx` (L233-247): link with all five parameters; condition and scope dropped; heading and scope-"mine" suffix unchanged
    - `test/auth.test.tsx`: registration (not only login) follows a `returnTo` with a multi-parameter query
  - [x] 16.2 Route files (thin, client): switch `wanted/page.tsx` to `WantedListView`; add `wanted/[id]/page.tsx` and `wanted/[id]/edit/page.tsx`; rename `add/hunting/` to `add/wanted/` with `WantFormView`; keep the existing `wanted/error.tsx`, `loading.tsx`, `not-found.tsx`
  - [x] 16.3 `routing/paths.ts`: remove the `View` member `"add/hunting"`; fix every reference the typecheck reports
  - [x] 16.4 `/add` tile: `AddView` reads the summed `new_match_count` from `useWants` and passes it as a prop; the shared `AddTiles` and `PublicAddView` (also where `features/panel/PanelGate.tsx` renders them) do not call `useWants`
  - [x] 16.5 "Konto" row in `features/account/AccountView.tsx`: real counts from `useWants` instead of `MOCK_WANTS`
  - [x] 16.6 Empty-search prompt in `features/search/SearchView.tsx` (L260-281): new sentence and link with the five parameters; server-safe (no browser globals, no wants hook during render)
  - [x] 16.7 Delete `features/search/WantedView.tsx`, `features/add/HuntingCreateView.tsx`, `test/HuntingCreateView.test.tsx`, and `MockWant`, `MOCK_WANTS` and the header comment line in `utils/mocks.ts`; search the source for leftover references (`hunting`, `MOCK_WANTS`, `WantedView`, `HuntingCreateView`)
  - [x] 16.8 Run `npm run typecheck` and `npm run lint`; compare with the baseline (tests of this group that failed in the baseline and were rewritten here must now pass)
  - [x] 16.9 Run only `npm run test -- src/test/AppPage.test.tsx src/test/addRoute.test.tsx src/test/SearchView.test.tsx src/test/routeManifest.test.ts src/test/panelPages.test.ts src/test/auth.test.tsx src/test/ssrSafety.test.tsx`

**Acceptance Criteria:**
- The rewritten tests pass; failures left in these files are all in the baseline and outside the rewritten tests
- No wants query during server render (`ssrSafety.test.tsx` green as in the baseline); `PublicAddView` makes no wants call
- No reference to the mock is left in `src/frontend/src`
- Each `acceptance` of the Visual References holds (with the spec override)

### Task Group 17: Closing prompt on the item page
**Goal:** After a personal or term / event take of a matched item, offer to close the matching wants.
**Satisfies:** FR-F-03 (closing sheet), FR-F-05 (item page), FR-F-50..FR-F-55, FR-F-66, FR-T-25; AC-29, AC-48
**Standards:** frontend/accessibility.md (`ModalSheet`, `useRegisterOpenSheet`, focus return), frontend/components.md, frontend/data-fetching.md, global/error-handling.md, testing/frontend-testing.md
**Dependencies:** 11
**Files to Modify:** `features/product/useItemTake.ts`, `features/product/blocks/ItemPickupActions.tsx`, `features/product/TakeSuccessSheet.tsx`, `features/wanted/CloseWantSheet.tsx`, `test/CloseWantSheet.test.tsx`, `test/useItemTake.test.tsx`, `test/ItemDetailPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/close-want-sheet.html
  element: component:close-want-sheet
  locator: two frames: one want (approx. lines 278-290), several wants (approx. lines 292-300)
  acceptance: `ModalSheet` title "Znalezione?", `ariaLabel` "Zamknąć poszukiwanie?"; one want: "Ta rzecz pasuje do Twojego poszukiwania:", „{name}”, primary "Zamknij poszukiwanie", secondary "Szukam dalej", hint "Zamknięte poszukiwanie możesz wznowić przez 30 dni."; several: "Ta rzecz pasuje do Twoich poszukiwań:", the list of names, "Zamknij oba poszukiwania" for two ("Zamknij wszystkie poszukiwania" for three or more), "Szukam dalej", "Zamknięte poszukiwania możesz wznowić przez 30 dni."; never stacked on `TakeSuccessSheet`
**Estimated Steps:** 7

- [x] 17.0 Build the closing prompt
  - [x] 17.1 Write up to 8 tests across `test/CloseWantSheet.test.tsx`, `test/useItemTake.test.tsx`, `test/ItemDetailPage.test.tsx` (`vi.mock("../api/wants")` added to `ItemDetailPage.test.tsx`)
    - `useItemTake` returns the taken item id after a personal take and after a term / event take, never after a swap proposal
    - Sheet copy for one and for several wants; `ariaLabel`
    - Prompt after a personal take once the lookup answers; after a term / event take only once `TakeSuccessSheet` is closed; "Zobacz rzecz" closes `TakeSuccessSheet` and the prompt opens
    - No lookup for a guest; no sheet when the lookup returns no want
    - "Zamknij" closes every returned want; a failure is inline and the sheet stays open; a retry treats 409 and 404 as done
    - "Szukam dalej", ✕ and Esc close with no request; the prompt is not shown again for that take
  - [x] 17.2 `features/product/useItemTake.ts`: one more returned field with the item id of the last successful take (personal, term / event)
  - [x] 17.3 `features/product/TakeSuccessSheet.tsx`: "Zobacz rzecz" also calls `onClose`
  - [x] 17.4 `features/wanted/CloseWantSheet.tsx`: `ModalSheet` registered with `useRegisterOpenSheet`, copy for one / two / three or more wants, inline error, every button `type="button"`
  - [x] 17.5 `features/product/blocks/ItemPickupActions.tsx`: when the field is set and the viewer is logged in, look up `GET /api/wants?matched_item_id=` through `useWants`; open the sheet only with at least one want and only when `TakeSuccessSheet` is not open; close all as `FULFILLED`; no wants hook call during server render
  - [x] 17.6 Run `npm run typecheck` and `npm run lint`; compare with the baseline
  - [x] 17.7 Run only `npm run test -- src/test/CloseWantSheet.test.tsx src/test/useItemTake.test.tsx src/test/ItemDetailPage.test.tsx src/test/ssrSafety.test.tsx`

**Acceptance Criteria:**
- The new tests pass; failures left in `ItemDetailPage.test.tsx` are all in the baseline
- Two `ModalSheet`s never open together
- Each `acceptance` of the Visual References holds

### Task Group 18: Project documentation
**Goal:** Describe the module, the 0099 runbook and the release gate; correct the old search guide.
**Satisfies:** FR-D-07, FR-D-10, FR-D-11, FR-D-12, FR-D-13; AC-37
**Standards:** global/conventions.md, global/commenting.md, backend/migrations.md (runbook rules)
**Dependencies:** 7, 9, 10, 16, 17
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`, `.maister/tasks/development/2026-11-12-global-search-group-description/documentation/user-guide.md`
**Estimated Steps:** 6

- [x] 18.0 Update the project documentation (no unit tests; step 18.6 is the check)
  - [x] 18.1 `architecture.md`: a Wants section (module and boundary, the three tables, the match statement and its predicates, the scan steps, notification rules, lifecycle, API) written from the code as built, including the O1 outcome and any lever applied in group 7
  - [x] 18.2 `architecture.md`: the package tree; the guarded-module sentences (boundary and clock guards now name `app/wants`); remove the `HuntingCreateView` mention; the note that account deletion, when built, must handle `wants.seeker_party_id`
  - [x] 18.3 `architecture.md`: the 0099 runbook (delete `notifications` rows of kinds `WANT_MATCH_FOUND` and `WANT_EXPIRING` before a downgrade or an image-only rollback; lossy unguarded downgrade; the two generated `wants` columns join the DROP / ADD list when `fold_pl` changes; 0100 if group 7 added it)
  - [x] 18.4 `architecture.md`: the release gate — no feature switch; do not deploy until the labelled Polish sample (at least 200 pairs, follow-up task) is scored and the thresholds are set from it
  - [x] 18.5 `.maister/docs/INDEX.md`: extend the architecture entry with the wants summary; old search user guide (L8, L12, L143-152): remove the demo warning and correct the steps (no pointer to a new guide and no screenshot change here; those belong to the user-documentation phase)
  - [x] 18.6 Check by search: `architecture.md` contains the Wants section, "0099", both kind names and the release gate; no "HuntingCreateView" and no "/add/hunting" remain in `.maister/docs/`; the old guide no longer calls the list a demo

**Acceptance Criteria:**
- The three documents are updated and consistent with the code
- The runbook names the rows to delete and the release gate is stated as a rule
- No secret value in any document

### Task Group 19: Test review, gap analysis and baseline comparison
**Goal:** Close the critical test gaps of this feature and prove that no failure is new.
**Satisfies:** FR-T-01 (comparison), FR-T-10..FR-T-29 (review); AC-09 (re-check), AC-35
**Standards:** testing/backend-testing.md, testing/frontend-testing.md
**Dependencies:** All previous groups (1-18)
**Files to Modify:** `tests/test_wants_*.py`, `src/frontend/src/test/*Want*.test.tsx`, `src/frontend/src/test/want*.test.ts`, `implementation/baseline/final-comparison.md`, `implementation/work-log.md`
**Estimated Steps:** 6

- [x] 19.0 Review the tests and compare with the baseline
  - [x] 19.1 Review the tests written by groups 2-17 against the pins of FR-T-10..FR-T-29 and against AC-01..AC-50; list every pin with no test
  - [x] 19.2 Analyse gaps for THIS feature only (critical flows first: must-not-match cases, one unread row per want, 404 for a foreign want, statement counts, closing prompt)
  - [x] 19.3 Write up to 10 additional strategic tests for the listed gaps; no refactoring of passing tests
  - [x] 19.4 Run the feature tests only: `uv run python -m pytest tests/test_wants_*.py tests/test_visible_to.py tests/test_module_boundaries.py tests/test_domain_clock_guard.py tests/test_authorization_matrix.py tests/test_membership_definition_guard.py -q` and the frontend files of groups 11-17
  - [x] 19.5 Run the full checks once, exactly as in group 1: backend pytest, mypy, ruff; frontend Vitest, typecheck, lint
  - [x] 19.6 Write `implementation/baseline/final-comparison.md` and the work-log entry: per check, the baseline set, the final set, the difference; every difference is either a baseline failure fixed by a rewritten test or is reported as a new failure with its file (new failures are fixed in the owning group's files before this group is done)

**Acceptance Criteria:**
- All feature tests pass
- No more than 10 additional tests added
- The final failing set is a subset of the baseline set for all six checks; mypy count not above the baseline
- Nothing committed; `git status` shows only uncommitted work

## Execution Order

1. Group 1: Test and static-check baseline (6 steps)
2. Group 2: Groups visibility annotations (4 steps, depends on 1)
3. Group 3: Moderation fields and notification kinds and writers (7 steps, depends on 1)
4. Group 4: Wants data model and migration 0099 (7 steps, depends on 1)
5. Group 5: Wants domain rules, links and anti-corruption layers (8 steps, depends on 2, 3, 4)
6. Group 6: Match statement (8 steps, depends on 5)
7. Group 7: Match statement measurement and index decision (7 steps, depends on 6)
8. Group 8: Want writes, lifecycle transitions and want API (10 steps, depends on 6)
9. Group 9: Match list API (7 steps, depends on 8)
10. Group 10: Scan job, sweep and scheduler wiring (9 steps, depends on 7, 8)
11. Group 11: Frontend data layer and paths (8 steps, depends on 1)
12. Group 12: Shared component changes (8 steps, depends on 1)
13. Group 13: Want list view (6 steps, depends on 11, 12)
14. Group 14: Want form view (8 steps, depends on 11, 12)
15. Group 15: Match list view (8 steps, depends on 11, 12)
16. Group 16: Routes, entry points and mock removal (9 steps, depends on 13, 14, 15)
17. Group 17: Closing prompt on the item page (7 steps, depends on 11)
18. Group 18: Project documentation (6 steps, depends on 7, 9, 10, 16, 17)
19. Group 19: Test review, gap analysis and baseline comparison (6 steps, depends on all)

Dependency outline (information only; the executor derives the real schedule from each group's `Dependencies` and `Files to Modify`, and its derivation wins over this list):

| Stage | Groups that have no dependency or shared file between them |
|---|---|
| A | 1 |
| B | 2, 3, 4, 11, 12 |
| C | 5, 13, 14, 15, 17 |
| D | 6, 16 |
| E | 7, 8 |
| F | 9, 10 |
| G | 18 |
| H | 19 |

Files that force an order: `app/main.py` (8 then 10); `app/wants/application/reads.py`, `writes.py`, `router/wants.py`, `schemas.py` (8 then 9); `app/wants/application/matcher.py` and `tests/test_wants_matcher.py` (6 then 7, conditional); `tests/test_wants_migration.py` (4 then 7, conditional); `tests/test_wants_notifications.py` (3 then 10); `tests/test_wants_lifecycle.py` (8 then 10); `routing/paths.ts` (11 then 16); `test/AppPage.test.tsx` (12 then 16); `test/SearchView.test.tsx` (12 runs it, 16 edits it).

## Requirement Traceability

### Functional requirements (151)

| Requirement | Group(s) |
|---|---|
| FR-X-01 | 4, 5 |
| FR-X-02 | 5 |
| FR-X-03 | 4, 5 |
| FR-X-04 | 5 (guard), 6, 8, 10 |
| FR-X-10 | 8 (router), 10 (job) |
| FR-X-11 | 8 |
| FR-X-12 | 2 |
| FR-X-13 | 3 |
| FR-X-14 | 3 |
| FR-X-15 | 5 (boundary, clock), 8 (matrix) |
| FR-D-01, FR-D-02, FR-D-03, FR-D-04, FR-D-05 | 4 |
| FR-D-06 | 7 |
| FR-D-07 | 18 |
| FR-D-10, FR-D-11, FR-D-12, FR-D-13 | 18 |
| FR-M-01, FR-M-02, FR-M-03, FR-M-04, FR-M-05 | 6 |
| FR-M-06 | 8 |
| FR-M-07 | 8 (counters), 9 (list) |
| FR-S-01, FR-S-02, FR-S-03, FR-S-04, FR-S-05, FR-S-06, FR-S-07, FR-S-08 | 10 |
| FR-N-01, FR-N-02, FR-N-09 | 3 |
| FR-N-03, FR-N-05, FR-N-08 | 10 |
| FR-N-04 | 5 (texts), 10 (use) |
| FR-N-06 | 8, 10 (end-to-end test) |
| FR-N-07 | 11 |
| FR-L-01, FR-L-03, FR-L-04, FR-L-06, FR-L-09, FR-L-10 | 8 |
| FR-L-02 | 8 (extend), 9 (inside "seen") |
| FR-L-05, FR-L-07 | 10 |
| FR-L-08 | 6 |
| FR-W-01, FR-W-02 | 5 (pure rules), 8 |
| FR-W-03, FR-W-04, FR-W-05, FR-W-06, FR-W-07, FR-W-09 | 8 |
| FR-W-08 | 3 (messages), 8 |
| FR-W-10 | 6 (expression), 8 (use) |
| FR-A-01 | 8 (list), 9 (`matched_item_id`) |
| FR-A-02, FR-A-03, FR-A-04, FR-A-05, FR-A-06, FR-A-07 | 8 |
| FR-A-08, FR-A-09, FR-A-10 | 9 |
| FR-A-11 | 8, 9 (agreement test) |
| FR-A-12, FR-A-13 | 9 |
| FR-A-14 | 8 |
| FR-A-15 | 8, 9 |
| FR-A-20 | 5 (texts), 8, 9 (unknown pair) |
| FR-F-01 | 16 |
| FR-F-02 | 11 (builders, new member), 16 (old member removed) |
| FR-F-03 | 13, 14, 15, 17 |
| FR-F-04 | 11 |
| FR-F-05 | 11 (UTC day counts), 16, 17 (no server-render query) |
| FR-F-10, FR-F-11, FR-F-12, FR-F-13, FR-F-14 | 13 |
| FR-F-15 | 11 (helper), 13 |
| FR-F-20, FR-F-21, FR-F-22, FR-F-23, FR-F-24, FR-F-25, FR-F-26, FR-F-27, FR-F-28, FR-F-29 | 14 |
| FR-F-30, FR-F-31, FR-F-32, FR-F-33, FR-F-34, FR-F-35, FR-F-36, FR-F-37, FR-F-38 | 15 |
| FR-F-39 | 13, 15 |
| FR-F-40, FR-F-41, FR-F-42, FR-F-43 | 16 |
| FR-F-50, FR-F-51, FR-F-52, FR-F-53, FR-F-54, FR-F-55 | 17 |
| FR-F-60, FR-F-61, FR-F-62, FR-F-63, FR-F-65 | 12 |
| FR-F-64 | 11 |
| FR-F-66 | 17 |
| FR-F-70 | 16 |
| FR-T-01 | 1, 19 |
| FR-T-10 | 4 |
| FR-T-11 | 6 |
| FR-T-12 | 10 |
| FR-T-13 | 3 (writer), 8 (edit-reset with a seeded row), 10 (scan) |
| FR-T-14 | 8 (transitions), 9 (auto-extension), 10 (sweep) |
| FR-T-15 | 8 |
| FR-T-16 | 9 |
| FR-T-17 | 2 |
| FR-T-18 | 5 (boundary, clock, membership), 8 (matrix) |
| FR-T-20 | 13, 14, 15 |
| FR-T-21 | 11 |
| FR-T-22 | 14 |
| FR-T-23 | 13 |
| FR-T-24 | 15 |
| FR-T-25 | 17 |
| FR-T-26, FR-T-27, FR-T-28 | 16 |
| FR-T-29 | 11 (pending actions, kind list), 12 (nav, picker, combobox, card), 16 and 17 (`ssrSafety`) |
| FR-T-30 | 7 |

### Acceptance criteria (50)

| Criterion | Group(s) | Criterion | Group(s) |
|---|---|---|---|
| AC-01 | 8, 9 | AC-26 | 13, 14, 15, 16 |
| AC-02 | 10 | AC-27 | 14 |
| AC-03 | 10 | AC-28 | 16 |
| AC-04 | 10 | AC-29 | 17 |
| AC-05 | 6 | AC-30 | 16 |
| AC-06 | 6 | AC-31 | 8, 15 |
| AC-07 | 6, 7 | AC-32 | 12 |
| AC-08 | 6, 8 | AC-33 | 12 |
| AC-09 | 8, 9, 10, 19 | AC-34 | 11 |
| AC-10 | 8 | AC-35 | 1, 19 |
| AC-11 | 8 | AC-36 | 7 |
| AC-12 | 8 | AC-37 | 18 |
| AC-13 | 8, 9 | AC-38 | 6 |
| AC-14 | 8, 10 | AC-39 | 10 |
| AC-15 | 8, 10 | AC-40 | 3, 6 |
| AC-16 | 10 | AC-41 | 6 |
| AC-17 | 10 | AC-42 | 9 |
| AC-18 | 9 | AC-43 | 10 |
| AC-19 | 9 | AC-44 | 15 |
| AC-20 | 9, 15 | AC-45 | 8, 13, 15 |
| AC-21 | 8 | AC-46 | 14 |
| AC-22 | 4 | AC-47 | 8 |
| AC-23 | 5 | AC-48 | 17 |
| AC-24 | 2 | AC-49 | 13, 15 |
| AC-25 | 10 | AC-50 | 10 |

## Unrun Checks

| Check | Where it runs | If it fails |
|---|---|---|
| Generated stored `tsquery` column on PostgreSQL 18 (O1) | Step 4.2, proven by `tests/test_wants_migration.py` and the create-and-match test of group 8 | `name_query` becomes an application-written column filled by the SQL helper of step 6.2; work-log entry before group 6 |
| `EXPLAIN (ANALYZE, BUFFERS)` forward, under 300 ms, index use at 20,000 items | Step 7.3 | Report; check the `<%` pre-filter form before anything else |
| `EXPLAIN (ANALYZE, BUFFERS)` reverse, under 2 s at 500 listings x 10,000 wants | Steps 7.3-7.4 | Lever 1: fold product names once per listing (materialised CTE); lever 2: plain-column pre-filters; then report. Longer interval / outbox fallback = user decision |
| Need for an index on `item_listing_preferences.created_at` | Step 7.5 | Separate revision 0100 with a concurrent build |
| Thresholds 0.70 / 0.60 on a labelled Polish sample | Not in this task (follow-up; release gate written in group 18) | Do not deploy |
| Browser E2E and user documentation | Later workflow phases, not planned here | - |

## Standards Compliance

Follow standards from `.maister/docs/standards/` (start at `.maister/docs/INDEX.md`):
- global/ — always applicable: error-handling, validation, conventions, coding-style, commenting, minimal-implementation
- backend/ — groups 2-10: models, migrations, queries, jooq (Core query rules), security, api, time
- frontend/ — groups 11-17: components, accessibility, data-fetching, css, responsive
- testing/ — backend-testing (groups 1-10, 19), frontend-testing (groups 1, 11-17, 19)

Each group names its governing standards in its `Standards` line. If a standard conflicts with the spec, stop and report; do not choose silently.

## Notes

- Test-Driven: each group starts with its tests (2-8 scenario tests per feature file); groups 1, 7 and 18 state their own check instead
- Run Incrementally: only the group's test files after each group; full suites in groups 1 and 19
- Mark Progress: check off steps as completed (the HTML companion carries the same markers)
- Reuse First: the templates of the spec's "Existing Code to Leverage" table are named in the steps; copy recipes from `app/search`, never import it
- No commits, no pushes; secrets are never printed (rules at the top of this plan)
- Polish texts marked "to confirm" in the spec are used as written and listed in the work log for the user
