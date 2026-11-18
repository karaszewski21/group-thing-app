# Work Log

## 2026-11-17T11:48:06Z - Implementation Started

**Total Steps**: 83
**Task Groups**: 1 DB contract, 2 Backend writes/reads/API, 3 Backend bells handler/lifespan/removals, 4 Matcher scaffold, 5 Matcher matching SQL, 6 Matcher loops/runtime, 7 Frontend data layer, 8 Frontend views/components, 9 Compose/runbook/docs, 10 Re-measurement + smoke test, 11 Test review & gap analysis
**Mode**: parallel waves (planned: W1 [1], W2 [2,4], W3 [3,5,7], W4 [6,8], W5 [9], W6 [10], W7 [11])
**Note**: TaskCreate/TaskUpdate unavailable — progress tracked by plan checkboxes, HTML markers and this log.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-17T12:01:04Z - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.10 completed
**Standards Applied**:
- From plan: backend/migrations.md, testing/backend-testing.md, backend/models.md, backend/queries.md, backend/time.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: architecture notes on fold_pl (0087) / ix_products_name_trgm (0094) — name_folded expression matches the trigram index
**Tests**: 56 passed (test_wants_migration, test_wants_visibility_parity, test_membership_definition_guard); ruff clean
**Files Modified**: src/backend/alembic/versions/0099_wants.py, tests/test_wants_migration.py (rewritten), tests/test_wants_visibility_parity.py (new), tests/test_membership_definition_guard.py (docstring)
**Notes / contract for later groups**:
- public.words_pl(text)→text[] (never NULL, '{}' when empty); stem_word_pl(text)→text; stem_pl(text)→text[] (aligned with words_pl, NOT NULL); stem_query_pl(text)→tsquery (NULL when no word). Prefix ':*A' when folded len>4 or shortened by ę/ą exception, else exact ':A'.
- Suffixes (longest first, ≥3 chars remain): owych; owej, owym; owa, owy, owe, ego, emu, ych, ymi, ami, ach; ek; a, e, i, y, o. No -ka.
- wants: stem_query tsquery GENERATED nullable; stem_words text[] GENERATED NOT NULL; match_requested_at timestamp NULL + ix_wants_match_requested_at; short_words_query removed. models.py needs Computed("public.stem_query_pl(name)") / Computed("public.stem_pl(name)") deferred.
- want_matches: tier varchar(10) NOT NULL DEFAULT 'MATCH'; missing_words text[] NULL; ck_want_matches_tier; ck_want_matches_missing_words (MATCH⇒NULL, SUGGESTION⇒non-empty); ix_want_matches_want_id_tier.
- Trigger trg_wants_match_requested AFTER INSERT OR UPDATE OF match_requested_at WHEN NEW.match_requested_at IS NOT NULL → pg_notify('wants_changed', id::text).
- Views: group_holdings(party_id, group_id); private_group_peers(party_id, peer_party_id) — use only inside EXISTS (dups/self rows); matchable_listings(item_id, owner_party_id, visibility, mode, created_at [listing pref], name_folded, search_vector, category_path uuid[] or NULL, locality_id, lat, lng numeric→cast float).
- Collation: words_pl splits on [^[:alnum:]] — depends on DB ctype (runbook note for Group 9).
- Expected breakage until Groups 2/3: ORM inserts into wants (short_words_query) in test_wants_api/matcher/lifecycle/notifications/scan.
- Bug caught: missing_words check needed coalesce(cardinality(...),0)>0.

### Standards Reading Log — Group 1
- [x] backend/migrations.md (plan) · [x] testing/backend-testing.md (plan) · [x] backend/models.md (plan) · [x] backend/queries.md (plan) · [x] backend/time.md (plan) · [x] global/minimal-implementation.md (INDEX.md)

## 2026-11-17T12:07:49Z - Group 4 Complete (wave 2)

**Steps**: 4.1 through 4.7 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, backend/time.md, global/conventions.md, global/minimal-implementation.md, global/coding-style.md
- From INDEX.md: backend/migrations.md, project/architecture.md (alembic script_location cwd-relative, contract objects)
- Discovered: CLAUDE.md secrets rule (DSN repr=False, alembic output captured)
**Tests**: 10 passed (src/matcher); ruff + mypy strict clean; Docker image built without HF_TOKEN (removed after)
**Files Modified**: src/matcher/{pyproject.toml, uv.lock, Dockerfile, .dockerignore, matcher/{__init__,__main__,settings,clock,rules,db}.py, tests/{__init__,conftest,test_clock_guard,test_settings}.py} (all new)
**Notes for Groups 5/6**:
- settings.load() reads DATABASE_URL; to_asyncpg_dsn strips +asyncpg; db.connect(settings) single conn (LISTEN), db.create_pool(settings).
- rules.py: MATCH_TOP_N=20, SUGGESTION_CAP=10, WORD_SIMILARITY_MIN=0.65, SHORT_WORD_MAX_CHARS=4, REMINDER_LEAD=7d, RETENTION=30d, WINDOW_INTERVAL=60s, WINDOW_OVERLAP=2min, FIRST_WINDOW_LOOKBACK=20min, REQUEST_POLL=10s, STATEMENT_TIMEOUT=30s, BACKOFF_START=60s, BACKOFF_MAX=15min.
- conftest fixtures: postgres_container, database_url (runs backend alembic with cwd=src/backend), settings, _session_pool, db (truncates domain tables before each test; keeps Vinted categories + TERYT localities). Seed helpers (commit immediately): locality, person, location, group, join_group, category, product, item(listed_at=…), want(match_requested_at=…).
- uv needs --system-certs inside this sandbox (TLS UnknownIssuer). Commands from src/matcher: uv run --system-certs python -m pytest | ruff check matcher tests | mypy matcher tests.
- Group 6 replaces __main__.py (gate + loops) and extends db.py.

### Standards Reading Log — Group 4
- [x] testing/backend-testing.md · backend/time.md · global/conventions.md · global/minimal-implementation.md · global/coding-style.md (plan) · [x] backend/migrations.md (INDEX.md) · [x] CLAUDE.md secrets (discovered)

## 2026-11-17T12:15:54Z - Group 2 Complete (wave 2)

**Steps**: 2.1 through 2.9 completed (note: tests written in the same pass as code; H3 concurrency test verified to fail with the lock disabled)
**Standards Applied**:
- From plan: backend/models.md, backend/queries.md, backend/api.md, backend/security.md, global/error-handling.md, global/validation.md, global/minimal-implementation.md, testing/backend-testing.md, backend/time.md
- From INDEX.md: count_queries pattern (testing/backend-testing.md)
- Discovered: none
**Tests**: 141 passed, 3 expected failures (scan tests in test_wants_notifications.py → moved by Group 3); test_wants_matcher/test_wants_scan fail at import (deleted by Group 3)
**Files Modified**: app/wants/{models,schemas,router/wants,application/{writes,reads,errors,match_notifications},domain/messages}.py; application/text_queries.py deleted; app/core/authorization_matrix.py (comment); tests/{conftest,test_wants_api,test_wants_edit_concurrency (new),test_wants_lifecycle,test_wants_matches_api,test_wants_notifications,test_authorization_matrix}.py
**Notes for Groups 3/7**:
- WantResponse keys: id, name, note, category_id, category_name, category_path, offer_mode, locality_id, locality_name, radius_km, notifications_enabled, status, expires_at, closed_at, created_at, matching, match_count, new_match_count.
- WantSuggestionResponse keys: id, title, href, meta{mode, condition, thumb_url, reserved, reserved_until}, missing_words[], reserved_by_me, proposed_by_me (no is_new).
- GET /api/wants/{id}/suggestions: ≤10, score desc then item id; 404 „Nie znaleziono poszukiwania.” for foreign/unknown/withdrawn.
- Stop-words-only name: 400 „Wpisz, czego szukasz — nazwa nie może składać się z samych spójników i przyimków.” (create + name-changing PATCH). 503 timeout path removed.
- WantMatchTier enum lives in app/wants/models.py.
- Group 3 cleanup: limits.py matcher constants (incl. FORWARD_STATEMENT_TIMEOUT_SECONDS), matcher.py, scan.py, WantScanMarker, test_wants_matcher.py, test_wants_scan.py, lazy _scan/_bell_rows/_pointer + 3 scan tests in test_wants_notifications.py.
- conftest: _Owner, _want, _product, seed_want_matches(db, want_id, item_ids, *, missing_words=None, seen=True, score=0.5).

### Standards Reading Log — Group 2
- [x] backend/models.md · backend/queries.md · backend/api.md · backend/security.md · global/error-handling.md · global/validation.md · global/minimal-implementation.md · testing/backend-testing.md · backend/time.md (plan)

## 2026-11-17T12:26:43Z - Group 7 Complete (wave 3)

**Steps**: 7.1 through 7.7 completed (tests failed first as expected)
**Standards Applied**:
- From plan: frontend/data-fetching.md, frontend/components.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: useItemDetail polling pattern + observer refetchInterval test style
**Tests**: 43 passed (useWantMatches, useWants, wantMatchesViewState); lint clean; typecheck 1 error in WantMatchesView.tsx:38 (Group 8 call site)
**Files Modified**: src/frontend/src/{api/wants.ts, hooks/useWants.ts, hooks/useWantMatches.ts, features/wanted/wantMatchesViewState.ts, test/fixtures/wants.ts, test/wantMatchesViewState.test.ts, test/useWantMatches.test.tsx, test/useWants.test.tsx}
**Notes for Group 8**:
- WantMatchesData {want, matches, suggestions, slow, loading, notFound, error}; union kinds loading|error|notFound|matching|matchingSlow|active|activeEmpty (all with suggestions)|expired|fulfilled (no suggestions). ActiveWantView = matching|matchingSlow|active|activeEmpty; MatchingWantView = matching|matchingSlow. Matching wins over active when want.matching.
- Skeleton only when view.matches.length === 0; suggestions section only when length > 0.
- useWantMatches returns {want, matches, suggestions, slow, loading, notFound, error, refetch, markSeen, markOpened}; refetch() restarts the 60 s window ("Odśwież teraz").
- useMatchingPolledQuery<T>({queryKey, queryFn, enabled, isMatching}) in hooks/useWants.ts; MATCHING_POLL_MS=2000, MATCHING_WINDOW_MS=60000.
- Fixtures: makeWant({matching}), makeWantMatch(), makeWantSuggestion() (default „Traktor bruder Deutz”, missing_words ["Claas"]).
- WantMatchesView.test.tsx currently fails (11) — its vi.mock lacks getWantSuggestions; Group 8 fixes.
- Possibly pre-existing unrelated failures seen: AppPage.test.tsx („Prowadzę”, „+ Dodaj termin”), ItemDetailPage.test.tsx („Wróć”) — to check in Group 11.

### Standards Reading Log — Group 7
- [x] frontend/data-fetching.md · frontend/components.md · testing/frontend-testing.md (plan) · [x] global/minimal-implementation.md · global/commenting.md (INDEX.md) · [x] useItemDetail pattern (discovered)

## 2026-11-17T12:35:42Z - Group 5 Complete (wave 3)

**Steps**: 5.1 through 5.8 completed (note: statements.py written before first test run — red phase skipped; negative acceptance cases discriminate)
**Standards Applied**:
- From plan: backend/queries.md, global/minimal-implementation.md, testing/backend-testing.md, backend/time.md
- From INDEX.md: global/commenting.md, global/coding-style.md
- Discovered: none
**Tests**: 42 passed (test_text_rules, test_forward, test_suggestions); ruff + mypy strict clean
**Files Modified**: src/matcher/matcher/statements.py (new), tests/conftest.py (helpers appended), tests/test_text_rules.py, test_forward.py, test_suggestions.py (new)
**Notes for Groups 6/10**:
- API: StoredPair(want_id, item_id, tier); match_forward(db, want_id, *, now) and match_window(db, *, listed_after, now) → inserted pairs; run inside caller's transaction after SET LOCAL statement_timeout. Outbox payload must keep only tier == MATCH. Constants FORWARD_MATCH/FORWARD_SUGGESTION/WINDOW_MATCH/WINDOW_SUGGESTION for EXPLAIN.
- Forward: source FORWARD, seen_at=now both tiers. Window: source SCAN, MATCH unseen, SUGGESTION seen.
- Candidate set = OR-of-stems tsquery OR name_folded <% l.name_folded; forward reads want values via InitPlans (needed: join_collapse_limit blocked index use otherwise).
- EXPLAIN (20k products, 505 wants): forward MATCH 9–77 ms, SUGGESTION 10–114 ms (old ≤17 ms); window 100 listings × 505 wants MATCH 967 ms (163 ms JIT), SUGGESTION 604 ms. Levers: SET LOCAL jit = off in window; MATCH could use AND stem_query instead of OR set. Visibility is a hashed SubPlan (OR EXISTS cannot be a semi-join) vs FR-OPS-03 wording — decision for Group 10.
- Not tested here: pending swap proposal (view-level, Group 1).
- Standard suggestion: pass single-row driver values as scalar subqueries when joining multi-table views.

### Standards Reading Log — Group 5
- [x] backend/queries.md · global/minimal-implementation.md · testing/backend-testing.md · backend/time.md (plan) · [x] global/commenting.md · global/coding-style.md (INDEX.md)

## 2026-11-17T12:43:37Z - Group 3 Complete (wave 3)

**Steps**: 3.1 through 3.7 completed (tests failed at import first)
**Standards Applied**:
- From plan: global/error-handling.md, global/minimal-implementation.md, backend/queries.md, backend/models.md, backend/time.md, testing/backend-testing.md
- Discovered: tests/test_module_boundaries.py rules
**Tests**: group 34 passed. Full backend suite: 1511 passed, 3 failed — (1) test_search_migrations roundTrip: information_schema.columns now includes matchable_listings.search_vector (caused by Group 1 view → fix in Group 11); (2) test_owner_items_page nearest privateCircleTerm location_name; (3) test_terms_circle_occurs_on_index_migration 0053 roundTrip — both untouched areas, likely pre-existing (verify vs HEAD in Group 11).
**Files Modified**: app/wants/application/bells_due.py (new), app/wants/infrastructure/outbox_acl.py (new), app/main.py, app/wants/domain/limits.py, app/wants/models.py (WantScanMarker removed); deleted app/wants/application/{matcher,scan}.py, tests/test_wants_{matcher,scan}.py; tests/test_wants_bells_due.py, test_wants_scan_removed.py (new); tests/test_wants_notifications.py
**Notes for Group 6**:
- event_type "wants.bells_due"; payload {"pairs": [[want_id, item_id], ...], "expiring": [want_id, ...]} — both keys required (may be []); ≤1000 pairs/row; expiring only in first row.
- Handler drops non-MATCH / invisible pairs; expiring kept only for ACTIVE wants; matcher must set reminded_at.
- Raw outbox insert: INSERT INTO outbox_entries (id, created_at, updated_at, event_type, payload, status, attempts) VALUES (gen_random_uuid(), timezone('UTC', clock_timestamp()) ×2, 'wants.bells_due', CAST(… AS jsonb), 'PENDING', 0).
- limits.py keeps NAME_MIN/MAX_LENGTH, NOTE_MAX_LENGTH, RADIUS_MIN/MAX_KM, MAX_ACTIVE_WANTS, VALIDITY, REMINDER_LEAD (7d), AUTO_EXTENSION_WINDOW; removed MATCH_TOP_N, RETENTION, SCAN_INTERVAL, SCAN_OVERLAP, SIMILARITY_*, FORWARD_STATEMENT_TIMEOUT_SECONDS.
- Lifespan contract check: to_regclass('public.matchable_listings') → RuntimeError on old 0099.
- Docs to fix (Group 9): standards/global/error-handling.md (_run_want_scan), standards/backend/queries.md (matcher.py), INDEX.md (15-min scan); match_notifications.py docstring "scan run".

### Standards Reading Log — Group 3
- [x] global/error-handling.md · global/minimal-implementation.md · backend/queries.md · backend/models.md · backend/time.md · testing/backend-testing.md (plan) · [x] module boundary rules (discovered)

## 2026-11-17T13:40:31Z - Group 8 Complete (wave 4)

**Steps**: 8.1 through 8.8 completed (code written in the interrupted earlier session; this session verified every step and mockup acceptance item, no further edits)
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, frontend/data-fetching.md, testing/frontend-testing.md
- From INDEX.md: none beyond the plan
- Discovered: none
**Tests**: 81 passed (WantMatchesView, WantedListView, WantFormView, useWantMatches, useWants, wantMatchesViewState); ItemCard callers 7 passed; typecheck clean; eslint clean on group files (38 pre-existing lint problems elsewhere)
**Files Modified**: src/frontend/src/features/wanted/{MatchingStatus.tsx (new), SuggestionCard.tsx (new), WantMatchesView.tsx, WantedListView.tsx}, components/shared/ItemCard.tsx (optional dashed/footnote props), test/{WantMatchesView,WantedListView,WantFormView}.test.tsx; WantFormView.tsx unchanged (400 already verbatim)
**Visual compliance**: all 7 references ✓; deviations: slow-card title is h2 (mockup h3) to keep heading order; stored matches shown under the slow card (mockup shows only the empty case)
**Notes**: reservedCaption duplicated in SuggestionCard.tsx and MatchCard.tsx (candidate for a shared helper); one test also fakes setTimeout to step the 60 s window (documented exception)

### Standards Reading Log — Group 8
- [x] frontend/components.md · frontend/accessibility.md · frontend/css.md · frontend/responsive.md · frontend/data-fetching.md · testing/frontend-testing.md (plan)

## 2026-11-17T13:41:21Z - Group 6 Complete (wave 4)

**Steps**: 6.1 through 6.9 completed (code written in the interrupted earlier session; this session fixed 2 failing tests and 8 strict-mypy errors)
**Standards Applied**:
- From plan: global/error-handling.md, backend/time.md, backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: backend/migrations.md (all NOT NULL columns set on raw inserts)
- Discovered: global/commenting.md (step 6.8, docstring for db.acquire)
**Tests**: 78 passed (whole matcher suite; 33 in Group 6 files); ruff check + format clean; mypy strict clean (21 files)
**Files Modified**: src/matcher/matcher/{db (added acquire()), requests, window, outbox, __main__}.py; tests/{test_loop, test_window, test_forward, test_sweep, test_constants_drift, conftest}.py
**Fixes**: unreachable-DB gate test waited a fixed 0.5 s (Windows refused connect ~2 s) → waits for records; >1000-pairs test read now before creating listings → dated listed_at=now-1min; PoolConnectionProxy typing → db.acquire()
**Notes for Groups 9/10**: run python -m matcher; needs only DATABASE_URL (same as backend, +asyncpg stripped, never logged); pool 1–4 + 1 LISTEN conn (≤5); gate waits, so no depends_on condition strictly needed; window-run INFO line carries duration_ms/outbox_rows (measurement hook); LOCK_KEY 0x77616E7473, marker scan_name 'wants'
**Standard candidate**: tests reading now must create rows before now or date them explicitly

### Standards Reading Log — Group 6
- [x] global/error-handling.md · backend/time.md · backend/queries.md · testing/backend-testing.md · global/minimal-implementation.md (plan) · [x] backend/migrations.md (INDEX.md) · [x] global/commenting.md (discovered)

## 2026-11-17T13:49:22Z - Group 9 Complete (wave 5)

**Steps**: 9.1 through 9.6 completed (checks written first and failed as expected)
**Standards Applied**:
- From plan: global/conventions.md, global/commenting.md, backend/migrations.md
- From INDEX.md: backend/security.md + CLAUDE.md secrets rule, backend/time.md, testing/backend-testing.md
- Discovered: backend/queries.md "Query Timeouts" was stale (search already uses SET LOCAL) — updated
**Checks**: 4/4 passed (compose config --quiet, matcher service shape, build matcher without HF_TOKEN, no dead doc references); script in session scratchpad group9_checks.sh
**Files Modified**: docker-compose.yml (matcher service), .maister/docs/project/architecture.md (Wants section rewritten, amended-0099 runbook steps 1–10, runtime fixes, deployment/clock/package tree), .maister/docs/INDEX.md, standards/backend/queries.md, standards/global/error-handling.md, standards/backend/time.md
**Notes for Group 10**: runbook step-3 detection query: docker compose exec -T postgres psql -U aj -d aj -tAc "SELECT to_regclass('public.matchable_listings') IS NULL AND EXISTS (SELECT 1 FROM alembic_version WHERE version_num = '0099')" (t = old 0099); step-10 placeholder marked <!-- MEASURED-COST: filled by the re-measurement (Task Group 10) --> at the end of architecture.md; Wants text claims PRIVATE branch is EXISTS/views inline — reconcile with EXPLAIN (hashed SubPlan seen in Group 5)
**Notes for Group 11**: 0099_wants.py docstring still says want_scan_markers written by "the first scan run"/"periodic scan" → reword to the matcher's window run
**Standard candidate**: scope statement timeouts to the transaction (SET LOCAL / set_config(…, true)) — now written into queries.md

### Standards Reading Log — Group 9
- [x] global/conventions.md · global/commenting.md · backend/migrations.md (plan) · [x] backend/security.md · backend/time.md · testing/backend-testing.md (INDEX.md) · [x] backend/queries.md (discovered)

## 2026-11-17T18:10:13Z - Group 10 Complete (wave 6)

**Steps**: 10.1 through 10.7 completed
**User decisions (main session AskUserQuestion)**: H1 — accept correlated OR EXISTS SubPlan for PRIVATE visibility, spec FR-OPS-03/H1/Inlining wording amended, assertion changed accordingly; window cost — accepted and documented as a risk; local dev DB downgrade/upgrade + smoke — approved with pg_dump first
**Standards Applied**: backend/queries.md, backend/migrations.md, testing/backend-testing.md, global/minimal-implementation.md, CLAUDE.md secrets rule
**Results (20k items × 10k wants)**: forward match_forward median 9.0 ms / max 78.5 ms (old max 17.2 ms per statement); window ~39 ms per takeable listing (old ~12 ms), 500 listings 18.6 s (old 5.7 s); limit ~500 new listings/min at 10k wants vs 30 s timeout; bells handler ~3.0–3.2 s per 1000-pair row (461 statements, one per seeker)
**EXPLAIN assertions**: index 30/30, visibility (amended) 30/30; explain_matcher.py exits 0
**Dev DB**: detection t (old 0099, 39 wants, 9 matches) → pg_dump to scratchpad aj-pre-amended-0099.dump (2.26 MB) → downgrade 0098 → upgrade head (new image) → detection f
**Smoke**: compose up --build OK; matcher "listening"; want "Rowerek biegowy" matching→false in 844 ms with 2 MATCH; flag drained; scanned_through advances each minute; window SCAN pair + wants.bells_due PROCESSED + WANT_MATCH_FOUND bell. Test data left: 2 smoke-*@example.com users, 1 product, 1 listed item
**Files Modified**: implementation/measurement/{measurement_db, seed_measurement, polish_names, explain_matcher, measure_bells}.py, results.md, plans/final/*; implementation/spec.md (H1 wording); .maister/docs/project/architecture.md (step-10 table, known limits)
**Follow-ups**: batch visible_matches in bells handler; alert on window duration_ms approaching 30 s

## 2026-11-17T18:35:36Z - Group 11 Complete (wave 7)

**Steps**: 11.1 through 11.5 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md (plan); backend/migrations.md (INDEX.md); CLAUDE.md secrets rule (discovered)
**Tests added (7)**: matcher reconnect + re-LISTEN; ę/ą short-word rows (matcher ×2, backend migration ×2); bells_due empty payload / purged want; useWants window reopen after run-out
**Fixed**: test_search_migrations roundTrip (view column in information_schema → BASE TABLE filter); 0099 docstring (matcher's window run)
**Files Modified**: src/backend/alembic/versions/0099_wants.py (docstring), src/backend/tests/{test_search_migrations, test_wants_migration, test_wants_bells_due}.py, src/matcher/tests/{test_loop, test_text_rules}.py, src/frontend/src/test/useWants.test.tsx

## 2026-11-17T18:35:36Z - Implementation Complete

**Total Steps**: 83 completed (11 groups, 7 waves)
**Test Suite**: backend 1515 passed / 2 failed (pre-existing, confirmed at HEAD in a worktree: test_owner_items_page nearest privateCircleTerm, test_terms_circle_occurs_on_index_migration 0053); mypy 15 (baseline 15); ruff 65 (baseline 65). Matcher 81 passed; ruff/format/mypy strict clean. Frontend 1853 passed / 33 failed (same 12 files and counts as the pre-existing baseline); typecheck 0; lint 38 (baseline).
**Result**: passed except pre-existing baseline failures

## 2026-11-17T20:16:27Z - Verification fix round 1 (Phase 11)

**User decision**: fix W1–W6 + W8–W11; W7 (bells batching) follow-up; W12 (lossy rollback) and W13 (same login aj) accepted
**Fixes**:
- W1 src/matcher/matcher/window.py: sweep (expire/remind/purge + its own outbox row) and match in separate transactions under a session advisory lock; WINDOW_MAX_LISTINGS=300 caps the window end at the 300th waiting listing; marker moves to that end; capped runs back to back; log line gains end/capped
- W2 statements.py: suggestion cap counts only items still in matchable_listings; window statements take $6 (end); Db typed Connection only
- W3 backend writes.py update_want: checks on an unlocked read, then FOR NO KEY UPDATE + updated_at check (StaleDataError 409); matches deleted under the lock (H3)
- W4 docker-compose.yml: matcher restart: unless-stopped (no healthcheck, documented)
- W5 __main__.py: SIGTERM/SIGINT handlers (Windows fallback), pool close with SHUTDOWN_GRACE 5 s, exit 0
- W6 app/outbox/dispatcher.py: one ERROR "FAILED after N attempts" on the FAILED transition
- W8–W11 docs: 4-char rule mirrors 0099, matcher commands + src/matcher/README.md, matcher-suite rule, tech-stack.md matcher section; behaviour changes in architecture.md/INDEX.md; explain_matcher.py binds $6; results.md re-measurement section
- Comment in writes.py corrected (expiry/reminder do bump updated_at); E501 fixed
**Tests added**: matcher +5 (capped drain, back-to-back loop, sweep survives match failure, stale suggestion cap, SIGTERM); backend +3 (classifier unlocked, concurrent write 409, FAILED ERROR log)
**Re-verification suite**: backend 1518 passed / 2 pre-existing; matcher 86 passed, ruff/mypy clean; frontend 1852 passed / 33 pre-existing + 1 flake (DeleteGroupDialog, passes in isolation); ruff 65, mypy 15, typecheck 0, lint 38
**Re-measurement** (loaded laptop): window ~43 ms per takeable listing; cap 300 ≈ 13 s per run vs 30 s timeout; EXPLAIN assertions 30/30 both

## 2026-11-17T20:43:26Z - Verification fix round 2 (Phase 11)

**User decision**: fix N1 + N4 + N2 + R-1/R-3–R-5; N3 (cap visibility edge cases, per-row count) and N5 (update_want length) stay info
**Fixes**:
- N1 window.py window_start(marker, previous_run_at) = max(marker − overlap, min(marker, previous_run_at − overlap)); after a capped run the next starts at the marker (no unbounded overlap growth); ties handled via created_at <= end
- N4 marker updated_at = run's now, scanned_through = end (liveness signal)
- N2 _unlock() never masks the run's error (DEBUG log)
- R-1 spec.md revision 3 (FR-BE-01, FR-MT-05, FR-MT-10, FR-MR-03) + spec.html rows synced; R-3/R-4/R-5 and the architecture l.294 amend-vs-new-revision wording; tech-stack testing paragraph de-staled
**Tests**: matcher 95 passed (+5 tests / 9 cases: window_start table, marker updated_at, 50-listing burst with cap 5 drains in bounded runs, tied created_at beyond cap, unlock failure keeps match error); ruff/format/mypy strict clean; window SQL unchanged (EXPLAIN unaffected)
**Residual (documented)**: >~1,000–1,200 listings within 2 real minutes can still time out one run and repeat until intervention (sweep keeps working; signal = repeated "window run failed" with the same start)

## 2026-11-18T07:25:05Z - Phase 13 & Finalization

**Phase 13**: documentation/user-guide.md (Polish, 292 lines, 18 screenshots: 10 reused from E2E, 8 new). Throwaway account `docs-anna-…@example.com` (GUEST) with one active want „Kurtka na zimę” left in the dev DB. Noted: „Oddam” chip label reads from the lister's side; „Znalezione — zamknij” has no confirmation (undo via „Szukam znowu”).
**Finalization**: all recorded artifacts present on disk. Nothing committed (user rule). Deploy still blocked by the 0099 release gate (≥200 labelled Polish pairs). Follow-ups: W7 bells batching, I3 restart bell, >~1000 listings/2 min burst limit.

## 2026-11-18 - Follow-up: window re-reads changed listings + matcher console logs

**Trigger**: user's „Klocki lego” want missed an item listed as „Klocki Cobi” and renamed 4 minutes later (listing `created_at` stayed before the marker).
**Fix**: `matchable_listings.changed_at` = greatest(listing created/updated, item updated, balance updated, latest swap proposal updated) appended to the view in amended 0099, plus `ix_swap_proposals_listing_item_id (listing_item_id, updated_at)` (dropped IF EXISTS in the downgrade); matcher window and its 300-cap read `changed_at`; ranking keeps `created_at`. Place edits and in-place product renames stay unread (documented limit). Local DB updated with CREATE OR REPLACE VIEW + CREATE INDEX (no downgrade, no data loss).
**Logging**: `python -m matcher --log-level DEBUG|INFO|WARNING|ERROR` (matcher logger only, default INFO), format with asctime; `npm run matcher` passes DEBUG.
**Also this session**: root `package.json` scripts `matcher` and `dev:all` (= docker compose stop backend matcher + concurrently web/server/matcher).
**Tests**: matcher 99 passed (+2 window: renamed item, available again; +2 logging cases), ruff/format/mypy strict clean; backend wants + migration tests 106 passed (view column list updated).
**Docs**: architecture.md (view, window step, known limits, local run), INDEX.md, user-guide FAQ.
