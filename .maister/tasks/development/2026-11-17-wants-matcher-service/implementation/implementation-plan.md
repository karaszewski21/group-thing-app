# Implementation Plan: Wants matcher service (MATCH / SUGGESTION tiers)

## TL;DR
11 task groups, 83 steps, built from `implementation/spec.md` (revision 2).
Order: DB contract (amended 0099) → backend writes/API → backend bells handler and removals. In parallel, after the contract: matcher scaffold → matching SQL → loops. The frontend data layer and views follow the backend API. Then come compose/runbook/docs, re-measurement plus a compose smoke test (the local-DB downgrade waits for user approval), and test review with the full suites of all three apps.
Groups 1–6 are on the critical path. Group 7 (frontend data) can start once Group 2 is done.

## Key Decisions
- **The backend split is 2 (writes/reads/API) → 3 (bells handler, lifespan, removals).** `main.py` imports `scan.py`/`matcher.py`, and `limits.py` constants are used by them. So constants, `matcher.py`, `scan.py`, `WantScanMarker` and the two old test files are deleted together in Group 3, which keeps the backend importable after Group 2.
- **The old backend test cases are ported, not lost.** Groups 5/6 port the cases of `test_wants_matcher.py`/`test_wants_scan.py`/the lifecycle sweep tests. If Group 3 has already deleted those files, they read them with `git show HEAD:<path>` (the repo root is a git work tree).
- **The matcher constants drift test (Group 6) depends on Group 3**, because it asserts that the moved names are gone from `src/backend/app/wants/domain/limits.py`.
- **The frontend is split into a data layer (Group 7, no UI) and views/components (Group 8, all Visual References).** The hooks/view state can be tested before the components exist.
- **Some groups carry spec-mandated suites larger than 8 tests.** Groups 1, 2, 5 and 6 have test lists fixed by the spec's Testing Approach (acceptance cases, parity cases, migration shapes). They are written as parametrized tests where possible. The 2–8 rule applies to the other groups.
- **The local dev DB is at the old 0099. Downgrading it is a gated step (10.5).** The matcher and backend test suites use testcontainers, so no destructive local command is needed before Group 10.
- **Re-measurement runs on a throwaway testcontainer/measurement DB**, never on the dev DB.
- **The final full suite runs inside Group 11 (Test Review & Gap Analysis)**, as the orchestrator asked. Commit/push stays with the workflow.

## Open Questions / Risks
- **Destructive local step:** applying the amended 0099 to the dev DB (`alembic downgrade 0098` + `upgrade head`) deletes every want, match and WANT_* notification. The executor must stop and get explicit user approval (step 10.5). If approval is refused, the compose smoke test (10.6) is reported as not run.
- **Shared-file contention:**
  - `src/backend/tests/conftest.py` and `src/backend/app/wants/models.py` are touched by Groups 2 and 3.
  - `src/matcher/tests/conftest.py` and `test_forward.py` by Groups 4–6.
  - `.maister/docs/project/architecture.md` by Groups 9 and 10.

  These groups are already ordered by dependencies.
- **Exact matching SQL is left to the implementer** (spec: "behaviour pinned by the acceptance tests"). Group 5 is the highest-uncertainty group: per-word unnest, the suggestion cap and forward/reverse parity.
- **The `ę`/`ą` short-word exception** is implemented as the spec states. The release gate still scores it, and so far it has only been confirmed by the orchestrator note.
- **Task-tool group items:** the `TaskCreate`/`TaskUpdate` tools were not available to the planner, so group-level task items were not created. The executor relies on the markdown checkboxes.

## Overview
Total Steps: 83
Task Groups: 11 (10 implementation + Test Review & Gap Analysis)
Expected Tests:
- ~80–100 new or rewritten test functions: Groups 1/2/5/6 are spec-mandated and parametrized; the other groups have 2–8 each.
- up to 10 gap tests.
- full suites of backend, matcher and frontend in Group 11.

Commands:
- backend: `uv run python -m pytest|mypy|ruff` from `src/backend`
- matcher: the same from `src/matcher`
- frontend: `npm test`, `npm run typecheck`, `npm run lint` from `src/frontend`

Secrets rule (CLAUDE.md): never print `DATABASE_URL`, `.env`, `env`/`printenv`, `docker inspect` env. Check presence only.

## Implementation Steps

### Task Group 1: Database Contract (amended 0099)
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0099_wants.py`, `src/backend/tests/test_wants_migration.py`, `src/backend/tests/test_wants_visibility_parity.py`, `src/backend/tests/test_membership_definition_guard.py`
**Estimated Steps:** 10

- [x] 1.0 Complete the DB contract layer
  - [x] 1.1 Write the migration and parity tests (spec-mandated set)
    - `test_wants_migration.py`:
      - round trip new→new
      - **old-shape downgrade (C1):** from head, drop the 3 views, the trigger and trigger function, `stem_query`, `stem_words`, `match_requested_at`, `tier`, `missing_words` and the 4 text functions; add `short_words_query tsquery`; keep `alembic_version = 0099`; run `alembic downgrade 0098` in the subprocess → it succeeds and `wants` is gone; `upgrade head` + `engine.dispose()` in `finally`
      - the contract objects exist
      - pinned `words_pl`/`stem_word_pl`/`stem_pl`/`stem_query_pl` examples (parametrized): zimowa→zim, zimę→zim prefix, kurtka→kurtk, rowerek→rower, biegowy→bieg, lego exact, `words_pl('kurtka na zimę')`, `words_pl('Rower-biegowy 2w1 dla 3-latka')`, `words_pl('na i z') = {}`, diacritics, a `'` quote, `İ`
      - generated columns follow a name update
      - **H5:** under `SET LOCAL search_path = ''`, `INSERT INTO public.wants …` and `UPDATE public.wants SET name` succeed
      - **trigger (L9):** committed data on an engine connection plus asyncpg LISTEN on a second connection. NOTIFY fires on insert and on setting the flag, and not on clearing it. Rows are deleted in `finally`
      - the downgrade deletes WANT_* notifications
    - `test_wants_visibility_parity.py` (new, H2): `EXISTS(private_group_peers)` vs `parties_share_group(owner, seeker, private_only=True)`, parametrized over every FR-DB-05 case:
      - standing membership on both sides; standing and ended membership
      - current and ended leadership
      - ended GroupRole with a standing Membership / current Leadership
      - wrong role type in both directions
      - owner member × seeker leader, and the reverse
      - soft-deleted PRIVATE group
      - shared PUBLIC + unshared PRIVATE; PUBLIC only; no shared group
      - plus the full call-site rule vs `items_visible_to(ALL)` (non-counterparty, non-own) for a PUBLIC and a PRIVATE listing
  - [x] 1.2 Add the text functions to `upgrade()` (FR-DB-01)
    - `words_pl`, `stem_word_pl`, `stem_pl`, `stem_query_pl`: `LANGUAGE sql IMMUTABLE PARALLEL SAFE`, string bodies, no SET clause, every non-`pg_catalog` call written `public.<fn>`
    - the 24-word stop-list is compared after `public.fold_pl`
    - `stem_word_pl`:
      - ≤4 folded chars → exact
      - `ę`/`ą` exception (≥3 chars before it) → stem
      - otherwise the longest suffix from the minimal set, only if ≥3 chars remain; never `-ka`
    - `stem_query_pl`: `to_tsquery('simple', …)` with `'<stem>':*A` / `'<word>':A`, `'` doubled; NULL for no words
    - Reuse: `fold_pl` (migration 0087)
  - [x] 1.3 `wants` columns (FR-DB-02)
    - stop creating `short_words_query`
    - add GENERATED STORED `stem_query tsquery` = `public.stem_query_pl(name)` and `stem_words text[]` = `public.stem_pl(name)`
    - add `match_requested_at timestamp NULL` with the partial index `ix_wants_match_requested_at`
  - [x] 1.4 Trigger function `wants_notify_match_requested()` (plpgsql, `pg_catalog.pg_notify('wants_changed', NEW.id::text)`) and trigger `trg_wants_match_requested`
    - AFTER INSERT OR UPDATE OF `match_requested_at`, FOR EACH ROW, WHEN `NEW.match_requested_at IS NOT NULL` (FR-DB-03)
  - [x] 1.5 `want_matches` (FR-DB-04)
    - `tier varchar(10) NOT NULL DEFAULT 'MATCH'` + `ck_want_matches_tier`
    - `missing_words text[] NULL` + `ck_want_matches_missing_words` (NULL for MATCH, non-empty for SUGGESTION)
    - `ix_want_matches_want_id_tier`
  - [x] 1.6 Views `group_holdings` and `private_group_peers` (FR-DB-05), copied from `app/groups/infrastructure/membership.py` (`active_membership_clause`, `active_leadership_clause`, `live_group_clause`) and `visibility.py::parties_share_group`
    - membership: MEMBER role; leadership: ORGANIZATOR role
    - live GroupRole and live group, PRIVATE in the peers view
    - no RSVP/family relation
  - [x] 1.7 View `matchable_listings` (FR-DB-06)
    - rows: a listing preference row exists, the item is live, balance AVAILABLE, no PROPOSED swap proposal, its own place set and live
    - columns `item_id, owner_party_id, visibility, mode, created_at, name_folded` (same expression as `ix_products_name_trgm`), `search_vector, category_path, locality_id, lat, lng`
    - Reuse: the conditions of `inventory/infrastructure/repository.py::listed_items_with_product_select`
  - [x] 1.8 Shape-tolerant `downgrade()` (FR-DB-07), in order:
    1. `SET LOCAL lock_timeout = '5s'` and delete the WANT_* notifications
    2. `DROP VIEW IF EXISTS` ×3
    3. the existing table drops (no new-only object dropped individually)
    4. `DROP FUNCTION IF EXISTS` ×5
  - [x] 1.9 Update the `test_membership_definition_guard.py` module docstring so it names the SQL copy (`group_holdings`/`private_group_peers` in `0099_wants.py`) and the parity test
  - [x] 1.10 Ensure the DB contract tests pass
    - Run ONLY `test_wants_migration.py`, `test_wants_visibility_parity.py` and `test_membership_definition_guard.py`

**Acceptance Criteria:**
- The migration and parity tests pass, including the old-shape downgrade and the empty-`search_path` insert/update (AC-05, AC-11)
- Every function body is `public.`-qualified. No scalar visibility function exists.

### Task Group 2: Backend Writes, Reads and API
**Dependencies:** 1
**Files to Modify:** `src/backend/app/wants/models.py`, `src/backend/app/wants/schemas.py`, `src/backend/app/wants/router/wants.py`, `src/backend/app/wants/application/writes.py`, `src/backend/app/wants/application/reads.py`, `src/backend/app/wants/application/errors.py`, `src/backend/app/wants/application/match_notifications.py`, `src/backend/app/wants/application/text_queries.py` (delete), `src/backend/app/wants/domain/messages.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/conftest.py`, `src/backend/tests/test_wants_api.py`, `src/backend/tests/test_wants_edit_concurrency.py`, `src/backend/tests/test_wants_lifecycle.py`, `src/backend/tests/test_wants_matches_api.py`, `src/backend/tests/test_wants_notifications.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 9

- [x] 2.0 Complete the backend write/read/API layer
  - [x] 2.1 Write and rewrite the focused tests
    - `test_wants_api.py`:
      - create returns `matching: true`, counts 0, and no `want_matches` row
      - „na i z” → 400 with `NAME_NEEDS_A_WORD_MESSAGE` on create and on update
      - the 503 timeout test is deleted; the 409 deadlock test is kept
      - a matching-field PATCH deletes both tiers and the unread bell, and re-flags; a note-only PATCH does not re-flag
      - statement counts updated
    - `test_wants_edit_concurrency.py` (new, H3): committed seed on the session engine, cleanup in `finally`. A second connection holds `FOR NO KEY UPDATE` and inserts a pair; the PATCH starts; the simulator commits. Afterwards no pair is left and the flag is set
    - `test_wants_lifecycle.py`: resume flags and keeps the old matches; the cap path stays. Remove the three sweep tests (l.246, 272, 322) and the `_scan` import; they are ported in 6.2
    - `test_wants_matches_api.py`:
      - seed `WantMatch` rows with tiers directly
      - `/matches` returns MATCH only
      - `/suggestions` exact key set with `missing_words`, read-time visibility filter, ≤10, 404 for a foreign or withdrawn want
      - counts are MATCH only; `matched_item_id` covers both tiers; `opened` works on a suggestion
    - `test_authorization_matrix.py`: row for `GET /api/wants/{id}/suggestions` (login READ; guest 401)
  - [x] 2.2 Move `_Owner`, `_want` and `_product` from `test_wants_matcher.py` into `tests/conftest.py` (M4)
    - Repoint the imports in `test_wants_api.py`, `test_wants_notifications.py`, `test_wants_lifecycle.py` and `test_wants_matches_api.py`
  - [x] 2.3 Map the model columns (models.md)
    - `Want.stem_query`/`stem_words` as `Computed` (never written), `match_requested_at`
    - remove the `short_words_query` mapping
    - `WantMatch.tier` and `missing_words`
  - [x] 2.4 Define `MatchedPair = tuple[uuid.UUID, uuid.UUID]` in `match_notifications.py` (FR-BE-10) and drop its import from `.matcher`
  - [x] 2.5 `writes.py` (FR-BE-01/02):
    - create, resume and a matching-field update set `match_requested_at = now` instead of `matcher.match_want`
    - `_own_want(…, for_update: bool = False)` → `with_for_update(key_share=True)`
    - `update_want` locks first → deletes both tiers and the unread bell → sets the values and the flag → flushes
    - remove `_set_forward_timeout`, `SET LOCAL statement_timeout`, the `57014`→503 mapping and `ForwardMatchTimedOut` (`errors.py`)
    - remove `short_words_query` writes and delete `text_queries.py`
    - keep the 40P01/40001→409 mapping
  - [x] 2.6 Name-word guard (FR-BE-08)
    - create and a name-changing update run `SELECT cardinality(public.words_pl(:name))` before the write; 0 → 400
    - add `NAME_NEEDS_A_WORD_MESSAGE` („Wpisz, czego szukasz — nazwa nie może składać się z samych spójników i przyimków.”) to `domain/messages.py`; no backend stop-list copy
  - [x] 2.7 `reads.py` (FR-BE-05/06/07):
    - tier MATCH filter in `list_matches` and `_match_counts`
    - `matched_item_id` covers both tiers
    - `matching` = `match_requested_at IS NOT NULL AND status = ACTIVE`
    - new `list_suggestions` reusing `_matches_select` + `visible_matches`, ordered by score desc then item id, `LIMIT 10`
    - `opened` works for either tier
  - [x] 2.8 Schemas and router
    - `WantResponse.matching: bool`
    - `WantSuggestionResponse` (`id, title, href, meta: WantMatchMeta, missing_words, reserved_by_me, proposed_by_me`)
    - `GET /api/wants/{id}/suggestions` with the same 404 rules as `/matches`
    - matrix row in `app/core/authorization_matrix.py`
  - [x] 2.9 Ensure the backend API tests pass
    - Run ONLY the test files listed in 2.1 (plus `test_wants_notifications.py` for the import change)

**Acceptance Criteria:**
- The tests from 2.1 pass (AC-02, AC-04)
- No request path calls `match_want` or sets a statement timeout. `text_queries.py` is gone.

### Task Group 3: Backend Bells Handler, Lifespan and Removals
**Dependencies:** 2
**Files to Modify:** `src/backend/app/wants/application/bells_due.py` (new), `src/backend/app/wants/infrastructure/outbox_acl.py` (new), `src/backend/app/main.py`, `src/backend/app/wants/application/matcher.py` (delete), `src/backend/app/wants/application/scan.py` (delete), `src/backend/app/wants/domain/limits.py`, `src/backend/app/wants/models.py`, `src/backend/tests/conftest.py`, `src/backend/tests/test_wants_bells_due.py` (new), `src/backend/tests/test_wants_scan_removed.py` (new), `src/backend/tests/test_wants_notifications.py`, `src/backend/tests/test_wants_matcher.py` (delete), `src/backend/tests/test_wants_scan.py` (delete)
**Estimated Steps:** 7

- [x] 3.0 Complete the bells handler and the removal of the in-process matcher
  - [x] 3.1 Write 2–8 focused tests
    - `test_wants_bells_due.py`:
      - the handler runs via `dispatch_pending` over a raw-inserted `wants.bells_due` row and writes a bell for MATCH pairs
      - SUGGESTION and deleted pairs are skipped
      - a pair whose item the seeker can no longer see (the owner left the shared PRIVATE group) is skipped and no product name is written (H2)
      - two chunk rows sum into one unread row
      - expiring wants (ACTIVE only)
      - a failure leaves no partial rows (savepoint) and increments `attempts`
      - moved from `test_wants_notifications.py` with the `_bell_rows`/`_pointer` helpers: `test_scanWants_oneNewPair…`, `test_scanWants_unreadRow…`, `test_closeWithdrawnOrMatchingEdit_afterAScan…` (close/withdraw/matching edit after a handler run deletes the unread match row only)
    - `test_wants_scan_removed.py` (`test_worker_removed.py` style):
      - `app.wants.application.matcher`/`scan` are not importable
      - the lifespan schedules no want job
      - the `wants.bells_due` handler is registered
      - the lifespan refuses to start without `matchable_listings`
  - [x] 3.2 Add `infrastructure/outbox_acl.py`, a thin wrapper over `app.outbox.registry.register_handler`
    - Add `application/bells_due.py` with the handler and `register()` (FR-BE-04):
      - inside `db.begin_nested()`, filter the payload pairs to existing MATCH rows and to `reads.visible_matches`, one statement per distinct seeker
      - load the still-ACTIVE `expiring` wants
      - call `write_bell_rows(pairs=…, expiring=…, now=datetime.utcnow())`
      - imports only `app.core`, `app.db`, `app.wants`
    - Reuse: the `notifications/outbox_listener.py` `register()` pattern
  - [x] 3.3 `app/main.py` (FR-BE-03/09):
    - remove the wants scan imports, `_want_scan_lost_a_race`, `_run_want_scan` and the scheduler job
    - register the wants outbox handler next to the notifications/storage listeners
    - fix the lifespan docstring from 30 s to 60 s
    - after `clock.check_timezone()`, run `SELECT to_regclass('public.matchable_listings')`; NULL → log ERROR „schema is the old 0099; run the amended-0099 runbook (architecture.md)” and raise
  - [x] 3.4 Delete `application/matcher.py`, `application/scan.py` and the `WantScanMarker` mapping
    - From `domain/limits.py`, delete `MATCH_TOP_N`, `RETENTION`, `SCAN_INTERVAL`, `SCAN_OVERLAP`, both similarity thresholds and `FORWARD_STATEMENT_TIMEOUT_SECONDS`
    - Keep `VALIDITY`, `AUTO_EXTENSION_WINDOW`, `REMINDER_LEAD` and the name/note/radius/cap limits
  - [x] 3.5 Delete `tests/test_wants_matcher.py` and `tests/test_wants_scan.py`
    - Their cases are ported in Groups 5/6; read them via `git show HEAD:<path>` if needed
    - Remove the moved scan cases from `test_wants_notifications.py`
  - [x] 3.6 Run the guard tests touched by the removal: `test_module_boundaries.py`, `test_domain_clock_guard.py`, `test_worker_removed.py`
    - Run `uv run python -m mypy app` and `ruff check app tests`
  - [x] 3.7 Ensure the Group 3 tests pass
    - Run ONLY `test_wants_bells_due.py`, `test_wants_scan_removed.py`, `test_wants_notifications.py` and the guards from 3.6

**Acceptance Criteria:**
- The tests from 3.1 pass (AC-03 backend side, AC-06)
- The backend has no want scheduler job, matcher, scan or matcher-only constants. mypy and ruff are clean.

### Task Group 4: Matcher Scaffold and Test Harness
**Dependencies:** 1
**Files to Modify:** `src/matcher/pyproject.toml`, `src/matcher/uv.lock`, `src/matcher/Dockerfile`, `src/matcher/.dockerignore`, `src/matcher/matcher/__init__.py`, `src/matcher/matcher/__main__.py`, `src/matcher/matcher/settings.py`, `src/matcher/matcher/clock.py`, `src/matcher/matcher/rules.py`, `src/matcher/matcher/db.py`, `src/matcher/tests/__init__.py`, `src/matcher/tests/conftest.py`, `src/matcher/tests/test_clock_guard.py`, `src/matcher/tests/test_settings.py`
**Estimated Steps:** 7

- [x] 4.0 Complete the matcher scaffold
  - [x] 4.1 Write 2–8 focused tests
    - `test_clock_guard.py`: only `matcher/clock.py` calls `datetime.now/utcnow/date.today`, mirroring `src/backend/tests/test_domain_clock_guard.py`
    - `test_settings.py`: the `+asyncpg` suffix is stripped; the URL never appears in log records
    - a harness smoke test: after the session fixture, `to_regclass('public.matchable_listings')` is not null
  - [x] 4.2 `pyproject.toml` (FR-MT-01)
    - `aj-matcher`, Python ≥3.12, runtime `asyncpg==0.31.0`
    - dev group: pytest, pytest-asyncio (auto mode, session loop), testcontainers, `alembic==1.17.1`, `sqlalchemy==2.0.44`, ruff, mypy strict, line length 100 (match the backend pins where shared)
  - [x] 4.3 Run `uv lock` in `src/matcher` and commit `uv.lock` with the change
  - [x] 4.4 Package modules
    - `settings.py` (`DATABASE_URL` only, suffix stripped, never logged)
    - `clock.py` (naive UTC, single `utcnow()`)
    - `rules.py` with every FR-MT-10 constant: `MATCH_TOP_N=20`, `SUGGESTION_CAP=10`, `WORD_SIMILARITY_MIN=0.65`, `SHORT_WORD_MAX_CHARS=4`, `REMINDER_LEAD=7d`, `RETENTION=30d`, `WINDOW_INTERVAL=60s`, `WINDOW_OVERLAP=2min`, `FIRST_WINDOW_LOOKBACK=20min`, `REQUEST_POLL=10s`, `STATEMENT_TIMEOUT=30s`, `BACKOFF_START=60s`, `BACKOFF_MAX=15min`
    - `db.py` connection helper
    - no `app.*` import
  - [x] 4.5 `Dockerfile`: python:3.12-slim + uv, builder stage `uv sync --frozen --no-dev`, slim runtime, `CMD ["python","-m","matcher"]`
    - no `ml` group, no Bielik, no `hf_token` secret
    - Reuse: the `builder` stage of `src/backend/Dockerfile`
    - Add a `.dockerignore`
  - [x] 4.6 `tests/conftest.py`
    - postgres:18 testcontainer (session)
    - `alembic -c alembic.ini upgrade head` as a subprocess with `cwd=src/backend` and `DATABASE_URL` in the env (never printed)
    - asyncpg pool fixture; TRUNCATE between tests (committed data)
    - raw-SQL seed helpers: locality, location, party/person, group + role + membership/leadership, category, product, item + balance + listing preference, want
    - Reuse: the `src/backend/tests/conftest.py` pattern
  - [x] 4.7 Ensure the scaffold tests pass
    - Run ONLY the 4.1 tests, plus `ruff check` and `mypy` on `matcher`

**Acceptance Criteria:**
- The 2–8 tests pass. The harness runs the backend migrations from `src/matcher`.
- The image builds without HF_TOKEN (build checked in 9.1).

### Task Group 5: Matcher Matching SQL (MATCH / SUGGESTION, forward and window)
**Dependencies:** 4
**Files to Modify:** `src/matcher/matcher/statements.py`, `src/matcher/tests/conftest.py`, `src/matcher/tests/test_text_rules.py`, `src/matcher/tests/test_forward.py`, `src/matcher/tests/test_suggestions.py`
**Estimated Steps:** 8

- [x] 5.0 Complete the matching statements
  - [x] 5.1 Write `test_text_rules.py` (spec-mandated, parametrized)
    - all 11 acceptance cases:
      - kurtka zimowa → „Kurtka na zimę” MATCH; kurtka na zimę → „Kurtka zimowa” MATCH
      - rower dla dziecka → „Rower biegowy dla dziecka” MATCH
      - Traktor Bruder Claas → „Traktor bruder Deutz” SUGGESTION `{Claas}`
      - Traktor na Bruder → „Traktor bruder Deutz” MATCH, never a SUGGESTION
      - rowerek biegowy → MATCH
      - kurtka zimowa ↛ „Kurtka przejściowa”; traktor bruder ↛ „Koparka Bruder”
      - kurtka ↛ „Kurtyna prysznicowa”; lego ↛ „Legowisko dla psa”
      - kurtka zimowq → „Kurtka zimowa” via typo; kurtka zimowq ↛ „Kurtka na zimę”
    - the 4-char exact rule; stop-words never in `missing_words`; description words ignored (weight A only)
    - `SHOW pg_trgm.word_similarity_threshold` = 0.6 on a matcher connection (M2)
  - [x] 5.2 Write `test_forward.py` (predicate part) and `test_suggestions.py`
    - `test_forward.py`, ported from the deleted backend `test_wants_matcher.py`:
      - offer mode, category ancestor, locality and radius
      - PRIVATE shared/not shared, own item, takeable
      - top 20
      - pairs born seen with `source = FORWARD`
    - `test_suggestions.py`:
      - only wants with ≥3 want words (stop-words not counted)
      - ≥2 hits and exactly 1 missing
      - cap 10 in total across runs
      - `missing_words` in the original case
  - [x] 5.3 Shared predicate SQL in `statements.py` (FR-MR-01)
    - ACTIVE unexpired want with ≥1 word
    - `matchable_listings`, owner ≠ seeker
    - `l.visibility = 'PUBLIC' OR EXISTS (SELECT 1 FROM private_group_peers p WHERE p.party_id = l.owner_party_id AND p.peer_party_id = w.seeker_party_id)`
    - offer mode, category path, locality or haversine ≤ `radius_km`
    - pair not stored yet
    - all constants as bound parameters
    - Reuse: the predicate shape and haversine of the old `matcher.py`
  - [x] 5.4 Per-word verification (FR-MR-02/03/04)
    - `unnest(stem_words, words_pl(name)) WITH ORDINALITY` per candidate pair
    - hit = prefix lexeme (exact for short words) on weight A of `search_vector`, or, for words >`SHORT_WORD_MAX_CHARS`, `word_similarity(fold_pl(word), name_folded) ≥ WORD_SIMILARITY_MIN`
    - gives the hit count and the missing positions
  - [x] 5.5 Forward MATCH insert
    - candidates: `search_vector @@ w.stem_query` OR `w.name_folded <% l.name_folded` OR the OR-of-stems prefix query from `stem_words`; then every word must hit
    - score = `word_similarity(w.name_folded, l.name_folded)`
    - top `MATCH_TOP_N` by score desc, `created_at` desc, item id
    - `ON CONFLICT (want_id, item_id) DO NOTHING`
    - `id`/`created_at`/`updated_at` set (FR-MT-06); `source = FORWARD`, `seen_at = now`
  - [x] 5.6 Forward SUGGESTION insert
    - ≥3 want words, not a MATCH, ≥2 hits, exactly 1 missing
    - `missing_words = ARRAY[words_pl(name)[pos]]`
    - cap = `SUGGESTION_CAP` − existing suggestions; ranked like MATCH
    - `seen_at = now`
  - [x] 5.7 Window (reverse) MATCH and SUGGESTION statements
    - a MATERIALIZED `window_listings` CTE selected from `matchable_listings` over `(start, now]`, with the plain-columns-first `CASE`
    - MATCH `source = SCAN`, `seen_at NULL`, `RETURNING want_id, item_id`
    - SUGGESTION `seen_at = now`, never returned for bells
  - [x] 5.8 Ensure the matching tests pass
    - Run ONLY `test_text_rules.py`, `test_forward.py` and `test_suggestions.py`

**Acceptance Criteria:**
- Every acceptance case passes (AC-01)
- The suggestion cap holds and stop-words never count
- No string-spliced constants

### Task Group 6: Matcher Loops and Runtime
**Dependencies:** 3, 5
**Files to Modify:** `src/matcher/matcher/db.py`, `src/matcher/matcher/requests.py`, `src/matcher/matcher/window.py`, `src/matcher/matcher/outbox.py`, `src/matcher/matcher/__main__.py`, `src/matcher/tests/conftest.py`, `src/matcher/tests/test_forward.py`, `src/matcher/tests/test_window.py`, `src/matcher/tests/test_sweep.py`, `src/matcher/tests/test_loop.py`, `src/matcher/tests/test_constants_drift.py`
**Estimated Steps:** 9

- [x] 6.0 Complete the matcher runtime loops
  - [x] 6.1 Write `test_loop.py` and `test_constants_drift.py`
    - `test_loop.py`:
      - a NOTIFY wakes processing; the poll catches a want flagged without NOTIFY
      - a failing want does not block a second flagged want in the same drain, and is retried only after its backoff (H4)
      - the startup gate waits for a missing contract
      - a lost race logs WARNING; other errors are logged once and the loop continues
    - `test_constants_drift.py`:
      - `ast`-parse `src/backend/app/wants/domain/limits.py`: `REMINDER_LEAD` equals `rules.REMINDER_LEAD`, and none of the moved names remain
      - `stem_query_pl` gives an exact lexeme for a 4-char word and a prefix for a 5-char word
  - [x] 6.2 Write `test_window.py`, `test_sweep.py` and the runtime part of `test_forward.py`
    - `test_window.py`:
      - window pairs unseen with `source = SCAN`
      - every NOT NULL column without a default is set on `outbox_entries`/`want_matches`/`want_scan_markers`, checked against `information_schema` (L2)
      - >1000 pairs → 2 outbox rows, `expiring` only in the first (L8)
      - the marker advances with the overlap
      - the advisory lock skips a second run
      - a window insert for a claimed want does not wait (L7)
      - forward ≡ reverse on the same fixture
    - `test_sweep.py`, ported from the backend lifecycle sweep tests:
      - expire with `closed_at` at the want's end
      - remind once per period, also when muted, again after an extend
      - purge after 30 days, with its matches; bell rows stay
      - all bump `updated_at`; reminded wants go into `expiring`
    - `test_forward.py`:
      - compare-and-clear keeps a newer flag
      - `updated_at` untouched
      - two concurrent claimers never process one want twice
      - no outbox row from a forward run
  - [x] 6.3 `db.py`: the startup gate (FR-MT-03)
    - `alembic_version.version_num` ≥ 99 numerically AND `to_regclass('public.matchable_listings')` not null
    - one INFO line per attempt, then „listening”
    - reconnect with backoff; the URL is never logged
  - [x] 6.4 `requests.py`: the claim and processing (FR-MT-04)
    - claim: `… WHERE match_requested_at IS NOT NULL AND id <> ALL(:backing_off) ORDER BY match_requested_at, id LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED`
    - `SET LOCAL statement_timeout` (bound from `STATEMENT_TIMEOUT`), then the MATCH and SUGGESTION inserts
    - compare-and-clear on `match_requested_at = :claimed` without touching `updated_at`
    - in-memory backoff map: `retry_after = now + BACKOFF_START × 2^(n−1)`, capped at `BACKOFF_MAX`, cleared on success; a WARNING with the id and count
  - [x] 6.5 LISTEN `wants_changed` on a dedicated connection plus a `REQUEST_POLL` poll
    - each wake-up drains, one transaction per want, until the claim returns no row
    - LISTEN is re-issued after a reconnect
  - [x] 6.6 `window.py` (FR-MT-05)
    - one transaction under `pg_try_advisory_xact_lock(<constant>)` (DEBUG skip) and the statement timeout
    - expire/remind/purge ported from the old `scan.py` (`updated_at` bumped, remind ignores `notifications_enabled`)
    - window start = marker − `WINDOW_OVERLAP`, or now − `FIRST_WINDOW_LOOKBACK`
    - MATCH and SUGGESTION inserts
    - marker first-run insert (`id`, `created_at`, `updated_at`) or compare-and-set on `scanned_through`
  - [x] 6.7 `outbox.py`: insert `wants.bells_due` rows
    - `{pairs, expiring}`, ≤1000 pairs per row, `expiring` in the first row
    - every NOT NULL column (`id`, `created_at`, `updated_at`, `event_type`, `payload` jsonb, `status='PENDING'`, `attempts=0`)
    - only when there are MATCH pairs or expiring wants
  - [x] 6.8 `__main__.py`: the gate, then both loops under asyncio
    - one `clock.utcnow()` per run
    - error policy FR-MT-07: 40P01/40001 or a marker miss → one WARNING; else `logger.exception` once; never crash
  - [x] 6.9 Ensure the runtime tests pass
    - Run ONLY the 6.1/6.2 test files, plus `ruff check` and `mypy` on `matcher`

**Acceptance Criteria:**
- The loop, window, sweep and drift tests pass (AC-03 matcher side, AC-07 behaviour)
- Two copies produce no duplicates. A failing want does not delay others.

### Task Group 7: Frontend Data Layer (API, hooks, view state)
**Dependencies:** 2
**Files to Modify:** `src/frontend/src/api/wants.ts`, `src/frontend/src/hooks/useWantMatches.ts`, `src/frontend/src/hooks/useWants.ts`, `src/frontend/src/features/wanted/wantMatchesViewState.ts`, `src/frontend/src/test/fixtures/wants.ts`, `src/frontend/src/test/useWantMatches.test.tsx`, `src/frontend/src/test/useWants.test.tsx`, `src/frontend/src/test/wantMatchesViewState.test.ts`, `src/frontend/src/test/panelPages.test.ts` (only if its wants key-set assertions change)
**Estimated Steps:** 7

- [x] 7.0 Complete the frontend data layer
  - [x] 7.1 Write 2–8 focused tests
    - `wantMatchesViewState.test.ts` `it.each` rows:
      - `matching` with and without stored matches
      - `matchingSlow`
      - active/activeEmpty with suggestions
      - closed without suggestions
      - stale/refresh-error rows
    - `useWantMatches.test.tsx`:
      - fetches the suggestions
      - `refetchInterval` is 2000 while matching and `false` when not (`observers[0].options.refetchInterval`, as in `useItemDetail.test.tsx:149`)
      - the 60 s end flips `slow` without new data: fake `Date`/`setTimeout`/`clearTimeout`, `act(() => vi.advanceTimersByTime(60_000))`, no `findBy*` (the documented exception, with a comment)
      - `refetch` restarts the window
    - `useWants.test.tsx`: the list polls while any want is matching and stops after the window
  - [x] 7.2 `api/wants.ts`: `matching: boolean` on `WantResponse`, a `WantSuggestionResponse` type and `getWantSuggestions(id)`
  - [x] 7.3 `test/fixtures/wants.ts`: the `matching` field and a typed `wantSuggestion()` factory (no casts)
    - Update the exact key-set tests that use the wants fixtures (find them by grepping `src/frontend/src/test`)
  - [x] 7.4 `useWantMatches.ts` (FR-FE-02)
    - one `Promise.all` for want, matches and suggestions
    - `refetchInterval` function: 2000 while `want.matching` and the window is not expired, else `false`
    - the window starts when the hook first sees `matching`; one `setTimeout` sets `expired`, cleared on unmount and on restart
    - exposes `suggestions` (stable empty fallback) and `slow`
    - `refetch` refetches and restarts the window
  - [x] 7.5 `useWants.ts`: the same 2 s / 60 s polling while any listed want has `matching`; no slow state (FR-FE-03)
  - [x] 7.6 `wantMatchesViewState.ts` (FR-FE-04)
    - `matching`/`matchingSlow` take precedence over `active`/`activeEmpty` and carry `matches` + `suggestions`
    - `active`/`activeEmpty` carry `suggestions`
    - closed kinds carry none
  - [x] 7.7 Ensure the data-layer tests pass
    - Run ONLY the 7.1 test files, plus `npm run typecheck` and `npm run lint`

**Acceptance Criteria:**
- The 2–8 tests pass. The fixtures are fully typed and tsc catches DTO drift.
- Polling stops at about 60 s. `refetch` resumes it.

### Task Group 8: Frontend Views and Components
**Dependencies:** 7
**Files to Modify:** `src/frontend/src/features/wanted/MatchingStatus.tsx` (new), `src/frontend/src/features/wanted/SuggestionCard.tsx` (new), `src/frontend/src/features/wanted/WantMatchesView.tsx`, `src/frontend/src/features/wanted/WantedListView.tsx`, `src/frontend/src/features/wanted/WantFormView.tsx` (only if the 400 message path needs a change), `src/frontend/src/components/shared/ItemCard.tsx`, `src/frontend/src/test/WantMatchesView.test.tsx`, `src/frontend/src/test/WantedListView.test.tsx`, `src/frontend/src/test/WantFormView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/want-detail-matching-pending.html
  element: screen:want-matching
  locator: `#mockup-content` (line 231), from `.top` header through `.pending` row, `ul.grid` of 4 `.card.skel`, to `.valid` + ActiveActions
  acceptance:
  - header („‹ Szukam”, „Edytuj”, h1, summary), notification toggle, validity line and „Znalezione — zamknij” / „Przedłuż” / „Wycofaj” unchanged
  - 4 skeleton tiles in an `aria-hidden` grid only when no MATCH is stored
  - with stored matches, the status row sits above the existing grid and no skeleton is shown
- mockup: analysis/design-context/mockups/want-detail-matching-pending.html
  element: component:matching-status
  locator: `div.pending[role=status]` in line 231
  acceptance:
  - inline row with `role="status" aria-live="polite"`
  - spinner `aria-hidden`, still under `prefers-reduced-motion`
  - text „Szukamy pasujących rzeczy…” with the sub-line „To zwykle kilka sekund.”
- mockup: analysis/design-context/mockups/want-detail-matching-slow.html
  element: screen:want-matching-slow
  locator: `div.empty[role=status]` in line 231
  acceptance:
  - dashed card in the activeEmpty style with `role="status" aria-live="polite"`
  - ⏳ `aria-hidden`
  - h3 „Wyniki pojawią się wkrótce”
  - text „Szukanie trwa dłużej niż zwykle. Zajrzyj tu za chwilę — damy też znać o nowych rzeczach.”
  - button „Odśwież teraz” calls `refetch`
  - actions below unchanged
- mockup: analysis/design-context/mockups/want-detail-suggestions.html
  element: screen:want-results
  locator: `div.empty` + `section.sugg[aria-labelledby=sg]` in line 231
  acceptance:
  - the existing empty card („Jeszcze nic nie pasuje”, „Damy znać, gdy ktoś doda pasującą rzecz.”), or the MATCH list when present, comes first
  - below it a `<section aria-labelledby>` with h2 „💡 Może Cię zainteresuje” (emoji `aria-hidden`), lead „Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.” and a grid of SuggestionCards
  - the section is rendered only when there are suggestions, and only for ACTIVE wants
- mockup: analysis/design-context/mockups/want-detail-suggestions.html
  element: component:suggestion-card
  locator: `section.sugg ul.grid li.card` in line 231
  acceptance:
  - the same ItemCard tile as MatchCard (thumb, name, „Stan: …”, mode pill, reserved caption)
  - dashed border, no „nowe” marker
  - extra line „brakuje: „Claas”” with each missing word in „…” quotes
  - a click calls `markOpened`
  - existing ItemCard callers unchanged (new props optional)
- mockup: analysis/design-context/mockups/want-detail-matches-only.html
  element: screen:want-results-matches-only
  locator: `h2` count line + `ul.grid` of MatchCards in line 231
  acceptance:
  - count line „2 pasujące rzeczy”
  - MatchCards with the „nowe” marker as today
  - no suggestions section in the DOM
- mockup: analysis/design-context/mockups/wanted-list-pending-badge.html
  element: screen:wanted-list
  locator: first `a.wc` with `div.cnt.pend[role=status]` in line 231
  acceptance:
  - a card with `matching` shows an `aria-hidden` spinner and „Szukamy…” in a `role="status"` element in place of the count/new pills
  - other cards unchanged („Jeszcze nic nie pasuje”, „3 pasujące”, „1 nowe”)
**Estimated Steps:** 8

- [x] 8.0 Complete the „Szukam” views
  - [x] 8.1 Write 2–8 focused tests
    - `WantMatchesView.test.tsx`:
      - pending `role="status"` text; skeleton only without stored matches
      - slow card with „Odśwież teraz” calling `refetch`
      - suggestions heading, cards and „brakuje: „Claas””
      - matches-only renders no section
    - `WantedListView.test.tsx`: „Szukamy…” status instead of the counts
    - `WantFormView.test.tsx`: the server's 400 stop-words message is shown through `extractProblemMessage`
  - [x] 8.2 `MatchingStatus.tsx`: inline status row (spinner `aria-hidden`, `motion-reduce` safe, Tailwind tokens only)
  - [x] 8.3 `ItemCard.tsx`: add minimal optional props (dashed border, footnote line)
    - `SuggestionCard.tsx` wraps `ItemCard` with the „brakuje: „…”” footnote and `markOpened` on click
    - Reuse: `MatchCard.tsx`
  - [x] 8.4 `WantMatchesView.tsx`: switch on `view.kind` for `matching`/`matchingSlow`
    - status row + skeleton, or the stored grid
    - slow card in the activeEmpty style
    - suggestions `<section>` under the MATCH list or the empty card
    - keep the first-load `newIds` snapshot and the single `markSeen`
  - [x] 8.5 `WantedListView.tsx`: a `matching` card shows the spinner + „Szukamy…” `role="status"` instead of the counts
  - [x] 8.6 Confirm the create/edit form shows the server's 400 message verbatim (no client stop-list); change `WantFormView.tsx` only if it does not
  - [x] 8.7 Visual self-check: open each mockup and check every `acceptance` item above against the rendered components
    - copy, element order, roles, `aria-hidden` glyphs, dashed borders, no section in matches-only
    - mobile-first at phone width
  - [x] 8.8 Ensure the view tests pass
    - Run ONLY the 8.1 test files, plus `npm run typecheck` and `npm run lint`

**Acceptance Criteria:**
- The 2–8 tests pass
- The implementation matches each `acceptance` criterion of the seven Visual References (AC-08)
- Accessibility per `standards/frontend/accessibility.md`

### Task Group 9: Compose, Runbook and Documentation
**Dependencies:** 3, 6, 8
**Files to Modify:** `docker-compose.yml`, `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`, `.maister/docs/standards/backend/queries.md`, `.maister/docs/standards/global/error-handling.md`, `.maister/docs/standards/backend/time.md`
**Estimated Steps:** 6

- [x] 9.0 Complete ops and docs
  - [x] 9.1 Write 2–4 verification checks (scripted, no secrets printed)
    - `docker compose config --quiet` succeeds
    - `docker compose build matcher` succeeds with no `hf_token` secret/HF_TOKEN
    - a grep check finds no dead references (`matcher.py`, `test_wants_matcher.py`, `_run_want_scan`, `short_words_query`, „30s” outbox poll) in `.maister/docs/`, except where history is quoted
  - [x] 9.2 `docker-compose.yml`: service `matcher` (FR-OPS-01)
    - `build: src/matcher`
    - `DATABASE_URL: postgresql+asyncpg://aj:aj@postgres:5432/aj` (the same literal as backend)
    - `depends_on` postgres `service_healthy`, backend `service_started`
    - no ports
  - [x] 9.3 `architecture.md` (FR-OPS-02)
    - rewrite the Wants section: matcher service, contract, tiers, stop-list, counts, lifecycle table, bells via outbox (≤60 s, re-checked visibility)
    - extend the boundary/clock notes to `src/matcher`
    - list `matcher` in the Deployment section
    - fix the runtime/runtime-dev statements at l.125 and l.503 (`runtime` with the `hf_token` secret, `MODERATION_TEXT_ENABLED: "true"`)
  - [x] 9.4 Replace the „Deploy / rollback for wants (migration 0099)” section with the spec's amended-0099 runbook, steps 1–10
    - explicit `docker compose run --rm --no-deps backend alembic …` commands
    - the no-`up`-before-downgrade warning, deploy order, verify, rollback (no image-only rollback), future changes
    - step 10 is a placeholder table that Group 10 fills
  - [x] 9.5 Docs and standards
    - update the wants summary in `.maister/docs/INDEX.md` (matcher, amended 0099, tiers, stop-list, runbook)
    - repoint the `standards/backend/queries.md` and `standards/global/error-handling.md` examples to the matcher, or drop the dead reference
    - mention the matcher clock guard in `standards/backend/time.md`
  - [x] 9.6 Ensure the 9.1 checks pass

**Acceptance Criteria:**
- Compose validates and the matcher image builds without HF_TOKEN (AC-07 build)
- The runbook and docs cover everything listed in AC-10

### Task Group 10: Performance Re-measurement and Stack Smoke Test
**Dependencies:** 6, 9
**Files to Modify:** `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/*` (adapted `seed_measurement.py`, `measurement_db.py`, `explain_matcher.py`, `results.md`), `.maister/docs/project/architecture.md`
**Estimated Steps:** 7

- [x] 10.0 Complete the re-measurement and the smoke test
  - [x] 10.1 Write 2–3 scripted assertions in `explain_matcher.py`
    - the forward EXPLAIN shows index conditions on `search_vector` and `name_folded`
    - no `SubPlan` filter for visibility (views inlined, PRIVATE branch a semi-join) (H1)
    - the script exits non-zero otherwise
  - [x] 10.2 Adapt the harness
    - copy `seed_measurement.py`/`measurement_db.py`/`polish_names.py` from `.maister/tasks/development/2026-11-15-szukam-wanted-mechanism/implementation/measurement/`
    - import the SQL strings from `matcher.statements` (run with `uv run` from `src/matcher`)
    - use a throwaway testcontainer DB, never the dev DB
  - [x] 10.3 Measure
    - forward cost
    - window cost at 10k wants (per listing and at 500 listings)
    - suggestion cost
    - the largest `wants.bells_due` payload and the handler time per row (L8)
    - compare with forward ≤17 ms and reverse ~12 ms/listing
  - [x] 10.4 Write `implementation/measurement/results.md` and fill the runbook step-10 cost table in `architecture.md`
  - [x] 10.5 **Local dev DB (approval-gated)**
    - run the runbook step-3 detection query (read-only)
    - if it returns `t` (old 0099), STOP and ask the orchestrator to get explicit user approval. Say that `downgrade 0098` + `upgrade head` deletes every want, match and WANT_* notification
    - only after approval: the step-4 `pg_dump` backup, `docker compose stop backend matcher`, `docker compose run --rm --no-deps backend alembic downgrade 0098`, then `… upgrade head`
    - never run this silently; never print config or secrets
  - [x] 10.6 Compose smoke test (only if the DB is at the new 0099)
    - `docker compose up -d --build`, then runbook step 7:
      - matcher log shows „listening”
      - creating a want shows „Szukamy…” and then the item
      - the flagged count drains to 0
      - `scanned_through` advances
      - `wants.bells_due` rows reach PROCESSED
    - if approval was refused, record "smoke not run" instead
  - [x] 10.7 Ensure the 10.1 assertions pass and the results are recorded

**Acceptance Criteria:**
- The EXPLAIN assertions pass
- Forward, reverse, suggestion and handler costs are stated against the previous numbers (AC-09)
- No destructive DB command ran without recorded user approval

### Task Group 11: Test Review & Gap Analysis
**Dependencies:** All previous groups
**Files to Modify:** `src/backend/tests/test_wants_*.py`, `src/matcher/tests/test_*.py`, `src/frontend/src/test/*Want*.test.ts*`, `src/frontend/src/test/useWant*.test.tsx`

- [x] 11.0 Review and fill critical gaps
  - [x] 11.1 Review the tests from Groups 1–10 against the spec's Testing Approach tables and AC-01..AC-11
  - [x] 11.2 Analyse the gaps for THIS feature only (e.g. backoff cap, the `ę`/`ą` exception edge, a list-polling edge, the bells handler with an empty payload)
  - [x] 11.3 Write up to 10 additional strategic tests
  - [x] 11.4 Run the feature-specific tests
    - backend `tests/test_wants_*.py` + the guards
    - matcher `tests/`
    - frontend want tests
  - [x] 11.5 Run the full suites and static checks of all three apps
    - backend: `uv run python -m pytest`, `mypy`, `ruff check`
    - matcher: the same from `src/matcher`
    - frontend: `npm test`, `npm run typecheck`, `npm run lint`
    - report any unrelated regressions; do not commit

**Acceptance Criteria:**
- All feature tests pass, with no more than 10 tests added
- The full backend, matcher and frontend suites, typecheck and lint are green, or the regressions are reported

## Execution Order

1. Group 1: Database Contract (10 steps)
2. Group 2: Backend Writes, Reads and API (9 steps, depends on 1)
3. Group 4: Matcher Scaffold and Test Harness (7 steps, depends on 1)
4. Group 3: Backend Bells Handler, Lifespan and Removals (7 steps, depends on 2)
5. Group 5: Matcher Matching SQL (8 steps, depends on 4)
6. Group 7: Frontend Data Layer (7 steps, depends on 2)
7. Group 6: Matcher Loops and Runtime (9 steps, depends on 3, 5)
8. Group 8: Frontend Views and Components (8 steps, depends on 7)
9. Group 9: Compose, Runbook and Documentation (6 steps, depends on 3, 6, 8)
10. Group 10: Performance Re-measurement and Stack Smoke Test (7 steps, depends on 6, 9)
11. Group 11: Test Review & Gap Analysis (5 steps, depends on all)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- global/:
  - error-handling (409 mapping kept; one WARNING + retry and `logger.exception` in the loops)
  - validation (server 400 with a Polish message)
  - minimal-implementation (dead code removed, no flags or abstractions)
  - commenting, coding-style
- backend/:
  - migrations (shape-tolerant downgrade, `lock_timeout`, explicit `ix_`/`ck_` names, downgrade-then-upgrade test, runbook)
  - models (columns mapped, generated columns not written)
  - queries (bound parameters only, set-based statements)
  - time (naive UTC, clock guard)
  - security (authorization matrix row)
- testing/:
  - backend-testing (postgres:18, exact key sets, naming `test_<operation>_<scenario>_<expected>`, conftest helpers for ≥3 importers, `upgrade head` + `dispose` in `finally`)
  - frontend-testing (typed fixtures, `createQueryWrapper`, Date-only fake timers with the one documented exception)
- frontend/:
  - components (one `resolveWantMatchesView`, switch on `view.kind`)
  - data-fetching (hooks in `src/hooks`, app-shaped returns, `refetch(): Promise<void>`)
  - accessibility (`role="status"`/`aria-live`, `aria-hidden` glyphs, headed section)
  - css/responsive (Tailwind tokens, mobile-first)

## Notes

- Test-driven: each group starts with its tests (2–8, or the spec-mandated set)
- Run incrementally: only the group's tests after each group; full suites in 11.5
- Mark progress: check off steps as they are completed (the md and the HTML companion `data-step` markers)
- Reuse first: the old `matcher.py`/`scan.py` SQL shape, `write_bell_rows`, `visible_matches`, the outbox handler pattern, `ItemCard`/`MatchCard`, the `useItemDetail` polling pattern, the measurement harness
- Secrets: never print `DATABASE_URL`, `.env` or container env; check presence only
- Visual coverage: `implementation/visual-coverage.md`
