# Codebase Analysis Report

**Date**: 2026-11-17
**Task**: Extract „Szukam” (wants) matching from the FastAPI backend into a standalone `src/matcher` service with a DB contract, two match tiers (MATCH / SUGGESTION) and async frontend states.
**Description**: Extract wants matching from `src/backend/app/wants` into a separate Python app `src/matcher` running as its own docker-compose service, with a DB contract (SQL view `matchable_listings`, SQL function `can_see_listing`, `NOTIFY wants_changed`, `want_matches.tier MATCH|SUGGESTION`, outbox event → `WANT_MATCH_FOUND` bell rows created by backend, least-privilege DB role `matcher`). Remove synchronous `matcher.match_want` from `writes.py` and the wants APScheduler job from `main.py`; expire/remind/purge move to the matcher. MATCH = all words after crude Polish stemming (prefix tsquery, e.g. `'kurtk':* & 'zim':*`) plus trigram typo path (~0.65); SUGGESTION („Może Cię zainteresuje”) = ≤1 word missing with ≥2 shared, no bell, ≤10/want. Frontend: „Szukamy pasujących rzeczy…” pending state + suggestions section with „brakuje: …”. Compose, runbook, architecture.md. 0099 release gate (≥200 labelled pairs) still applies.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## TL;DR
Matching today is one wants-owned set-based SQL statement (`app/wants/application/matcher.py`) built from ORM models of six other modules, run synchronously on create/update/resume and every 15 min by an APScheduler job in `main.py`. None of the target contract exists yet: no tier column, no LISTEN/NOTIFY, no view or SQL function, no `matcher` role. The hard parts are the shared-code strategy (importing `app.*` requires JWT_SECRET/DATABASE_URL), duplicating the visibility rule in SQL (it is guarded as "one definition"), the new stemmed prefix query plus SUGGESTION per-lexeme counting (GIN can't serve it), and the switch to async matching (new pending state across API, fixtures and tests). Complex, medium-high risk; next migration is 0100.

## Key Decisions
- **Matcher talks to the DB contract only (raw SQL / Core), not `app.*` imports.** Importing the backend pulls `app.config.Settings` (JWT_SECRET, DATABASE_URL required) and builds an engine at import time. A view plus SQL functions keep one definition shared by both processes.
- **Write the visibility/takeable rule once, as SQL (`can_see_listing`, `matchable_listings`), and have the backend use it or parity-test it.** `owner_shares_group_with` is the one guarded definition (`tests/test_membership_definition_guard.py`). A second copy without a parity test will drift.
- **Use `LANGUAGE sql` functions and plain views so they inline.** That keeps the GIN pushdown on `products.search_vector` and `fold_pl(name)` trgm. Re-measure the reverse MATERIALIZED window path after the change.
- **The backend keeps creating bell rows from an outbox event.** `write_bell_rows` needs the org slug (`derive_party_slug`), the message templates and the 500-char cap, all of which live in backend Python. The matcher only appends an outbox row. The backend dispatcher must claim that event type, and any matcher-side poller must split by `event_types`, because unhandled types get marked PROCESSED.
- **Edit/close stay in the API and keep deleting `want_matches` and unread bell rows synchronously.** Re-matching is triggered by `NOTIFY wants_changed`, with the periodic scan as a safety net.
- **Pending state needs a persisted signal**, e.g. a `matched_at`/`matching_pending` column set NULL on write and set by the matcher. That means a migration plus a new `WantResponse` field, and frontend polling on `useWantMatches` while it is pending (same pattern as `useItemDetail.ts:51`).
- **Stemmed name query as a new stored column or generated column built from an IMMUTABLE stemming function** (migration 0100). Changing it later means DROP/ADD. Filter on weight A (`'kurtk':*A`), because `search_vector` also contains description words (weight C).

## Open Questions / Risks
- **SUGGESTION tier cost**: counting shared and missing lexemes per pair (`unnest(tsvector_to_array(...))` intersections) is not index-served. The reverse path today is about 12 ms per listing at 10k wants, so it needs measurement and a ≤10/want cap enforced in SQL.
- **Release gate**: the 0099 gate (≥200 labelled pairs) has to be re-run for the new MATCH semantics (stemming + prefix + trigram 0.65 instead of 0.70/0.60).
- **Bell latency**: the outbox poll interval is 60 s (the `main.py` docstring wrongly says 30 s), which adds up to 60 s on top of matcher latency. Could add a NOTIFY on the outbox side or shorten the interval.
- **Concurrency**: the matcher must keep bumping `wants.updated_at` (version_id_col) in set-based UPDATEs, or concurrent seeker writes will silently overwrite. Marker race handling (StaleDataError/IntegrityError → log, no re-raise) must move with the scan.
- **Known missed cases persist**: PRIVATE→PUBLIC, cancelled reservation and product rename are not rescanned, because `item_listing_preferences.created_at` is set once. Decide whether NOTIFY on listing changes is in scope.
- **Least-privilege role**: the only precedent (`gt_moderation_cron`) is created outside the repo (group-thing-ai/scripts, column grants, pg_hba hostssl, startup privilege self-check). Decide whether the `matcher` role goes in a migration, an init script or a runbook step. Compose postgres has no init scripts today.
- **Deploy**: `docker compose up -d --remove-orphans` on VPS A means the new service must be in the same compose file. The matcher has to wait for backend `alembic upgrade`. Rollback order changes (stop matcher and backend).
- **`ItemPickupActions` closing prompt** (`useWantsMatchingItem`) will appear later once matching is async. That is acceptable but should be stated.
- **Doc drift**: `architecture.md:125` says compose uses `runtime-dev`, but compose builds `runtime`.

---

## Summary

The wants module (2158 LOC) has a matcher of set-based INSERT…SELECT statements (forward per want, reverse per listing window) that the backend runs in-process: synchronously in writes (3 s statement timeout, 503/409 mapping) and through a 15-minute APScheduler scan that also expires, reminds, purges and writes bell rows. Extraction is feasible because the statement is pure SQL over wants-owned tables with ON CONFLICT and marker protections. The predicates (takeable, visibility, category ancestry, distance, text) come from ORM builders in other modules, though, and have to be re-expressed as a DB contract. The new tiers need new stored query columns and a non-indexed per-lexeme comparison.

---

## Files Identified

### Primary Files

**src/backend/app/wants/application/matcher.py** (302 lines)
- `match_statement` INSERT…SELECT; `match_want` (forward); `match_new_listings` (reverse window); takeable/visibility/offer/category path/haversine (`EARTH_RADIUS_KM`)/FTS+trigram; `MATCH_TOP_N`=20.
- Moves to `src/matcher` and gets rewritten against `matchable_listings` / `can_see_listing`, with tiers added.

**src/backend/app/wants/application/scan.py** (143 lines)
- `scan_wants`, one transaction: expire, remind, purge (closed ≥30 d), window match (marker −5 min overlap, first run now−20 min), bell rows, marker upsert; `MARKER_UNIQUE_CONSTRAINT`, `SCAN_OVERLAP`. No statement timeout.
- Moves to the matcher, except the bell-row part, which becomes an outbox event.

**src/backend/app/wants/application/match_notifications.py** (215 lines)
- `write_bell_rows`: WANT_MATCH_FOUND/WANT_EXPIRING. Locks ACTIVE+notifications_enabled wants FOR UPDATE, deletes previous unread, single vs several message, slug lookup, 500 cap, multi-row insert, `_point_wants_at_rows`.
- Stays in the backend and becomes the outbox handler. Suggestions must be excluded.

**src/backend/app/wants/application/writes.py** (342 lines)
- create/update/close/extend/resume; sync `match_want`; `FORWARD_STATEMENT_TIMEOUT_SECONDS`; `TRANSACTION_CONFLICTS`; update re-matches on name/category/offer/locality/radius change (DELETE want_matches + `_drop_unread_match_row`).
- Remove sync matching and emit NOTIFY / set pending. Keep the delete-on-edit.

**src/backend/app/main.py** (211 lines)
- l.57-59 wants imports; l.92-117 `_want_scan_lost_a_race` / `_run_want_scan`; lifespan l.120-171 (outbox listeners l.147-148, outbox `run_forever` l.149, scheduler jobs l.154-164; the scheduler is shared with term-end and media sweep).
- Remove the want-scan job and register the wants outbox handler.

**src/backend/app/wants/models.py** (190 lines)
- `Want` l.51, `WantMatch` l.143, `WantScanMarker` l.175. Needs `tier` (and a pending/matched marker, plus the stemmed query column).

**src/backend/app/wants/application/reads.py** (294 lines)
- `visible_matches` read-time filter (AVAILABLE/RESERVED/IN_TRANSIT, not deleted, `items_visible_to`, owner≠seeker); `_match_counts`; `list_matches` cards; slug via `derive_party_slug`.
- Needs tier-aware counts (MATCH only) and a suggestions read with missing words.

**src/backend/app/wants/schemas.py** (100 lines), **router/wants.py** (101 lines)
- `WantResponse` (match_count, new_match_count). Needs the pending field and a suggestions payload.

**src/backend/app/wants/text_queries.py** (32 lines)
- `short_words_query` (lexemes ≤3 chars AND-ed), computed in Python/SQL by the writer. Candidate for a generated column via an IMMUTABLE function.

**src/backend/alembic/versions/0099_wants*.py** → new **0100**
- Current head 0099. 0100 adds tier, view, functions, stemming function/column, pending column, NOTIFY trigger or role grants.

**docker-compose.yml** (83 lines), **src/backend/Dockerfile** (63 lines)
- Add the `matcher` service (builder stage pattern without the ml group or hf_token secret). It depends on backend migrations.

**src/frontend features/wanted: WantMatchesView.tsx** (322) + **wantMatchesViewState.ts** (52)
- `resolveWantMatchesView` kinds loading/error/notFound/active/activeEmpty/expired/fulfilled. Add `matching` kind („Szukamy pasujących rzeczy…”) and a suggestions section („Może Cię zainteresuje”, „brakuje: …”). activeEmpty copy at ~l.155.

**src/frontend api/wants.ts** (108), **hooks/useWantMatches.ts** (76), **hooks/useWants.ts** (103)
- Types for pending/suggestions; conditional `refetchInterval` on the `[wants,"matches",token,wantId]` query.

**docs architecture.md**
- wants section l.290-410 (lifecycle table, statement counts, l.336 per-listing option), boundary l.244, clock l.60, deployment l.497 (+ l.125 mismatch, l.131 remove-orphans), 0099 runbook l.641-665. Plus INDEX.md wants summary.

### Related Files

- **app/wants/infrastructure/*_acl.py** (10–34 lines each): groups_acl, inventory_acl, locations_acl, category_acl, product_acl, notifications_acl (matcher inputs); organizations_acl, moderation_acl, users_acl (API-only).
- **app/groups/visibility.py**: `owner_shares_group_with` l.52, `items_visible_to` l.92. Source of the visibility SQL to replicate.
- **app/groups/domain/organizer_slug.py:36** `derive_party_slug`; **app/groups/repository.py:938** `with_pending_proposer`; **app/groups/models.py** ItemListingPreference/ItemVisibility/SwapProposal.
- **app/inventory/infrastructure/repository.py**: `listed_items_with_product_select` :276, `newest_open_reservation_starts_at` :714; inventory/models.py BalanceStatus/InventoryItem/ItemCondition.
- **app/product/service.py:328** `first_approved_photo_by_product`; Product.search_vector (name A + description C).
- **app/notifications/models.py:64-65** NotificationKind; `create_notification(s)`, `delete_unread_notifications`; **app/notifications/outbox_listener.py** (142), storage/outbox_listener.py (handler pattern templates).
- **app/outbox/**: models OutboxEntry; service.append; registry.register_handler; dispatcher dispatch_pending (FOR UPDATE SKIP LOCKED, MAX_ATTEMPTS=5, event_types / exclude_event_types; unhandled types marked PROCESSED); scheduler run_forever 60 s.
- **app/config.py:23-24** (required JWT_SECRET, DATABASE_URL), **app/db.py** (engine at import). These are why the matcher shouldn't import the backend.
- **app/wants/domain/** limits 32, status 20 (source FORWARD|SCAN), lifecycle 49, validation 45, messages 53, links 17 (test-guarded copy).
- **authorization_matrix** rows 66-67 (wants).
- **pyproject.toml** (81) / **uv.lock**: aj-backend, py≥3.12, sqlalchemy==2.0.44, asyncpg==0.31.0, alembic==1.17.1, apscheduler<4; dev pytest, pytest-asyncio, testcontainers≥4.8, ruff, mypy strict, line 100. No uv workspace.
- **.env.example**: no matcher keys yet.
- Frontend consumers: WantedListView (259) + state (28), WantFormView (319, l.160-161 navigate after create/update) + state (112), MatchCard (38), wantText (70), AccountView/AddView (sum new_match_count), ItemPickupActions (`useWantsMatchingItem`, 19), SearchView EmptyItems, NotificationBell (generic link_path).
- Previous task: `.maister/tasks/development/2026-11-15-szukam-wanted-mechanism` (research-context, mockups wanted-matches*.html, measurement/results.md). Use it as the baseline for the release gate.

---

## Current Functionality

### Key Components/Functions

- **match_statement**: stores a pair when the want is ACTIVE and unexpired, and the item belongs to another party, is takeable (balance AVAILABLE, no PROPOSED swap, live pickup place) and visible (PUBLIC, or PRIVATE with a shared live PRIVATE group via `owner_shares_group_with(seeker, private_only=True)`). It must also match the offer mode, the category (any ancestor, recursive CTE + lateral array_agg) and the locality (equal, or haversine ≤ radius; NULL radius → exact locality). The text test is `name_query @@ search_vector` OR (`short_words_query` NULL or matches) AND `name_folded <% listing name_folded` AND word_similarity ≥ 0.70 (no category) / 0.60 (category). It keeps the top 20 per run via row_number(score desc, pref.created_at desc, item_id), uses NOT EXISTS + ON CONFLICT (want_id,item_id) DO NOTHING RETURNING, and score = word_similarity even for FTS hits. "Listed" means an `item_listing_preferences` row exists; listing_status is not checked.
- **Forward path**: wants JOIN prefs ON true + takeable; GIN indexes drive the plan.
- **Reverse path**: `WITH window_listings AS MATERIALIZED` (prefs created in (start, now]) + derived columns; CASE WHEN narrowing THEN text_match ELSE false.
- **Want text columns**: `name_folded` GENERATED `fold_pl(name)`; `name_query` GENERATED `plainto_tsquery('simple', fold_pl(name))`; `short_words_query` written by the writing statement. `fold_pl` is IMMUTABLE and does no stemming.
- **writes**: `SET LOCAL statement_timeout '3s'`; 57014→503 ForwardMatchTimedOut; 40P01/40001→409 StaleDataError. create: moderation → cap → category/locality checks → insert → flush → match_want → load → commit. resume EXPIRED/FULFILLED→ACTIVE + match_want (old matches kept). mark_matches_seen (auto-extension), mark_match_opened. Forward matches are born seen, so new_match_count=0.
- **reads.list_matches**: unpaged, ordered reserved → new → score. Cards: id/title/href/meta{mode,condition,thumb_url,reserved,reserved_until}/is_new/reserved_by_me/proposed_by_me.
- **scan_wants**: `_expire` UPDATE; `_remind` UPDATE…RETURNING (ignores notifications_enabled); `_purge`; window match; `write_bell_rows`; `_window_sizes` log; marker insert/versioned update; commit. Every set-based UPDATE bumps updated_at.
- **write_bell_rows**: described above. The notifications table has no triggers, so a raw INSERT from another process would be safe, but the slug and message logic are in Python.

### Data Flow

Today:
1. A seeker POST/PATCH runs `writes` → `match_want` in-request (forward), and the response carries the counts.
2. Every 15 min, APScheduler runs `scan_wants`: expire/remind/purge, then reverse-match listings created in the marker window, then bell rows, then advance the marker.
3. GET matches → `reads.visible_matches` (read-time re-filter).

Target:
1. API write → row change + pending marker + `NOTIFY wants_changed`. Edit still deletes matches and unread bells synchronously.
2. The matcher LISTENs (plus a periodic scan) → INSERT `want_matches` with tier → append an outbox event for MATCH rows.
3. The backend outbox handler → WANT_MATCH_FOUND bell rows.
4. The frontend polls while pending and renders matches plus suggestions.

Schema 0099:
- `wants`: seeker_party_id (no ON DELETE), name varchar80, note 300, category_id SET NULL, offer_mode, locality_id RESTRICT, radius_km smallint, notifications_enabled, status, expires_at, closed_at, reminded_at, short_words_query, match_notification_id, match_notification_count, generated columns. Checks: radius_requires_locality, closed_at_matches_status. Indexes: seeker/status, partial active expires_at, partial closed_at.
- `want_matches`: want_id CASCADE, item_id loose, source varchar10, score real, seen_at, opened_at; uq (want_id,item_id); ix item_id.
- `want_scan_markers`: scan_name unique, scanned_through.

---

## Dependencies

### Imports (What This Depends On)

- groups (ItemListingPreference, ItemVisibility, SwapProposal, visibility builders, derive_party_slug, with_pending_proposer): takeable and visibility rules, slug.
- inventory (BalanceStatus, InventoryItem, ItemCondition, listed_items_with_product_select, newest_open_reservation_starts_at): takeable rule, card metadata.
- locations (Locality, Location): radius and pickup place.
- category (Category.path_text, 0091/0092): ancestry.
- product (Product.search_vector, first_approved_photo_by_product): text match, thumbnail.
- notifications (NotificationKind, create/delete helpers): bell rows.
- outbox (append, register_handler, dispatcher): new event route.
- Postgres: pg_trgm, `fold_pl`, GIN indexes 0093/0094/0096.
- BaseEntity version column (`updated_at` version_id_col).

### Consumers (What Depends On This)

- **app/main.py**: imports, scan wrapper, scheduler job, include_router.
- **authorization_matrix**: wants rows 66-67.
- **notifications**: WANT_MATCH_FOUND / WANT_EXPIRING kinds.
- **tests/test_module_boundaries.py**: enforces that no other module imports `app.wants`.
- **Frontend**: api/wants.ts, useWants, useWantMatches, useWantsMatchingItem, WantMatchesView, WantedListView, WantFormView, AccountView, AddView, ItemPickupActions, SearchView, NotificationBell.

**Consumer Count**: about 4 backend + about 11 frontend files
**Impact Scope**: High. The change crosses process boundaries (new service, DB contract, roles, deploy) and changes API semantics from sync to async.

---

## Test Coverage

### Test Files

- **test_wants_api.py** (522): create forward counts l.124, timeout 503 l.334, deadlock 409 l.361, PATCH reset l.433, statement counts create 9 / list 3 l.496. Breaks and needs a rewrite.
- **test_wants_matcher.py** (507): matcher predicates, forward==reverse l.377, FROM-linter l.444. Moves to the matcher.
- **test_wants_scan.py** (504): scan, `_run_want_scan` race l.337, ≤16 statements. Moves to the matcher; the race test changes.
- **test_wants_matches_api.py** (452): setup relies on POST forward matching, so it has to seed WantMatch directly.
- **test_wants_lifecycle.py** (357): resume matches l.162 (+ cap path l.212). Needs updating.
- **test_wants_notifications.py** (280): scan parts move; l.236 close/edit deletes unread (spans both).
- **test_wants_migration.py** (199), **test_wants_domain.py** (173), authorization matrix wants rows: unaffected. A 0100 round-trip test is needed.
- **test_module_boundaries.py** (121), **test_domain_clock_guard.py** (179; replicate in the matcher, utcnow allowed), **test_membership_definition_guard.py** (affected by the SQL copy of visibility), **test_worker_removed.py** (precedent for a "removed module not importable" test).
- **conftest.py** (249): PostgresContainer postgres:18 (session), alembic upgrade head via subprocess cwd=BACKEND_ROOT (l.65), savepoint db_session (can't be shared across processes), MODERATION_TEXT_ENABLED=false. Alembic env has target_metadata=None and revisions don't import app, so the matcher suite can run backend migrations.
- Frontend: WantMatchesView.test (356), wantMatchesViewState.test, useWantMatches.test (111), useWants.test (205), WantedListView.test, WantFormView.test (450), CloseWantSheet.test, wantText.test, NotificationBell.test:90, fixtures/wants.ts (needs new fields; exact key-set tests). Polling assertion template: useItemDetail.test.tsx:149 (`observers[0].options.refetchInterval`).

### Coverage Assessment

- **Test count**: about 3,000 lines of wants backend tests across 8 files, plus about 10 frontend test files.
- **Gaps**:
  - No cross-process tests: matcher ↔ backend via NOTIFY and outbox.
  - No tier or suggestion tests.
  - No tests for the privilege set of a least-privilege role.
  - No parity test between the SQL visibility function and the Python `owner_shares_group_with`.
  - Labelled-pair evaluation for the new MATCH semantics doesn't exist yet (release gate).

---

## Coding Patterns

### Naming Conventions

- **Components**: PascalCase views (`WantMatchesView`) with pure `*ViewState.ts` resolvers returning discriminated `kind`s.
- **Functions**: snake_case, verb-first (`match_want`, `scan_wants`, `write_bell_rows`); private helpers prefixed `_`.
- **Files**: hexagonal layout per module (`domain/`, `application/`, `infrastructure/*_acl.py`, `router/`), migrations `NNNN_name.py`.

### Architecture Patterns

- **Style**: modular monolith with ACL modules and boundary tests; set-based SQL via SQLAlchemy Core/ORM builders; plain constants (minimal-implementation standard); domain clock guard.
- **State Management**: frontend React Query (keys `[wants,"mine",token]`, `[wants,"matches",token,wantId]`) with conditional `refetchInterval` polling (useItemDetail 10 s, useThread 5 s).
- **Async work**: transactional outbox (append in caller session, dispatcher with SKIP LOCKED), APScheduler in lifespan.
- **Concurrency**: optimistic versioning via `updated_at`; ON CONFLICT DO NOTHING; unique marker.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~2158 LOC module; 25+ files touched across backend, matcher, frontend, compose, docs | High |
| Dependencies | 6 module ACLs + outbox + Postgres extensions | Medium-High |
| Consumers | ~15 files (backend + frontend) | High |
| Test Coverage | Strong today (~3k lines), but ~6 test files break/move and the cross-process paths are new | Medium |

### Overall: Complex

The SQL itself fits in one statement, but the task adds a new deployable, a DB contract duplicating guarded rules, new text-matching semantics with an index-unfriendly tier, a sync→async API change, and deploy/role/runbook work.

---

## Key Findings

### Strengths
- Matching is already a single set-based statement over wants-owned tables, with idempotent ON CONFLICT and a versioned marker, so it tolerates concurrent writers and duplicate runs.
- The outbox infrastructure already exists with a handler pattern and event-type filtering.
- Alembic revisions don't import `app`, so the matcher test suite can reuse migrations and testcontainers.
- The notifications table has no triggers, and the outbox accepts raw INSERTs if all columns are set.
- Polling and pending-state templates already exist in the frontend.

### Concerns
- Duplicating the visibility/takeable rules in SQL breaks the "one definition" guard unless it is mitigated.
- `search_vector` includes description words. A prefix query without a `:A` weight filter would widen MATCH beyond the name.
- SUGGESTION counting isn't GIN-served, and the reverse path cost grows as O(wants × window).
- The outbox dispatcher marks unhandled events PROCESSED, so multiple pollers would swallow each other's events.
- The 60 s outbox poll adds bell latency.
- The matcher must preserve `updated_at` bumps, or 409 protection is lost.
- Removing the sync match changes the response semantics (counts 0 at first), which ripples through WantFormView navigation, AddView/AccountView totals and ItemPickupActions.

### Opportunities
- Make `short_words_query` and the stemmed query generated columns built from IMMUTABLE functions, removing the Python-computed value.
- A SQL `party_group_ids(party)` / `can_see_listing` function used by both backend reads and the matcher would restore a single definition.
- LISTEN/NOTIFY gives near-instant matching and shrinks the scan to a safety net.
- Fix the doc drift (runtime-dev vs runtime; 30 s vs 60 s docstring) while editing.

---

## Impact Assessment

- **Primary changes**:
  - Backend: `app/wants/application/{matcher,scan,writes,reads,match_notifications}.py`, `app/wants/{models,schemas}.py`, `app/main.py`, new alembic `0100_*`.
  - New `src/matcher/` (pyproject, uv.lock, Dockerfile, app, tests).
  - `docker-compose.yml`.
  - Frontend: `api/wants.ts`, `useWantMatches.ts`, `WantMatchesView.tsx`, `wantMatchesViewState.ts`.
- **Related changes**: wants outbox listener registration, NotificationKind usage, `.env.example`, WantedListView/WantFormView/AccountView/AddView/ItemPickupActions copy and behaviour, fixtures/wants.ts, architecture.md (wants, boundary, clock, deployment, runbook), INDEX.md.
- **Test updates**:
  - Rewrite test_wants_api, test_wants_lifecycle and test_wants_matches_api setup.
  - Move test_wants_matcher, test_wants_scan and parts of test_wants_notifications to the matcher.
  - Add tests for 0100 round-trip, tiers, suggestions cap/no-bell, the outbox handler, the NOTIFY trigger, visibility parity, role privileges, a "wants scheduler removed" check and the matcher clock guard.
  - Frontend: matching state, suggestions section, polling interval.

### Risk Level: Medium-High

Cross-cutting concerns are involved: visibility/privacy (a wrong SQL copy leaks PRIVATE listings), data (new columns and roles), deploy (a new service, remove-orphans, migration ordering) and UX (sync→async). The existing test suite mitigates much of this, but most of it breaks or moves, and the cross-process paths have no tests yet. The release gate on matching quality adds a precision/recall risk for the new stemming and prefix semantics.

---

## Recommendations

**Modifying existing code + creating a new capability.**

1. **DB contract first (0100).**
   - Add `want_matches.tier` (CHECK MATCH|SUGGESTION, default MATCH for existing rows) and, if needed, a missing-words column for suggestions.
   - Add a pending marker on `wants`.
   - Add an IMMUTABLE crude Polish stemming function (`stem_pl`) and generated stemmed prefix query column(s) on `wants`, plus a matching stemmed name lexeme representation on the listing side if needed.
   - Add `matchable_listings` view (item_id, owner_party_id, visibility, mode, created_at, name_folded, search_vector, category_path, locality_id, lat, lng).
   - Add `can_see_listing(seeker, item)` as `LANGUAGE sql STABLE`.
   - Add a trigger or explicit `pg_notify('wants_changed', want_id)` on wants writes.
   - Add grants for a `matcher` role. Role creation itself probably belongs in a runbook or init script, following the `gt_moderation_cron` precedent, with only grants in the migration.
   - Add a round-trip migration test.
2. **Single definition of visibility.** Either switch the backend's `items_visible_to` / `owner_shares_group_with` to call the SQL function, or add a parity test that runs both over fixture groups. Update `test_membership_definition_guard.py` accordingly.
3. **Matcher app** (`src/matcher`, own pyproject/uv.lock, sqlalchemy + asyncpg + alembic only for tests):
   - Use raw SQL / Core Table definitions against the contract.
   - Run a LISTEN loop plus a periodic scan (expire/remind/purge/window match), keeping the marker, overlap and version-bump semantics.
   - Insert MATCH (top N) and SUGGESTION (≤10/want, ≥2 shared, ≤1 missing) rows.
   - Append an outbox row for new MATCH pairs and WANT_EXPIRING reminders, with all outbox columns set.
   - Set a statement timeout and log-and-continue on races.
   - Replicate the clock guard test.
4. **Backend.**
   - Remove `match_want` from writes (and the 503 timeout path). Keep delete-on-edit plus unread-bell drop, set pending, notify.
   - Remove the scheduler job and `_run_want_scan` from `main.py`.
   - Register a wants outbox handler that wraps `write_bell_rows` (MATCH only), and make sure the dispatcher claims it.
   - Make reads/counts tier-aware, and add suggestions to the matches response.
   - Add a test that the removed scan isn't scheduled, following the `test_worker_removed.py` precedent.
5. **Frontend.**
   - Add the `matching` kind in `resolveWantMatchesView` („Szukamy pasujących rzeczy…”) with conditional `refetchInterval` on `useWantMatches` while pending.
   - Add a suggestions section „Może Cię zainteresuje” showing „brakuje: …”, with no "new" pill and no bell.
   - Update fixtures and exact key-set tests, then check the AddView/AccountView totals and the ItemPickupActions behaviour.
6. **Ops/docs.**
   - Add the compose `matcher` service (builder stage without the ml/secret, `depends_on` backend healthy or migrations completed) and matcher env keys in `.env.example`.
   - Update architecture.md (wants lifecycle table, boundary, clock, deployment, l.125 fix) and write a 0100 runbook (role setup, verify that the matcher LISTENs and the marker advances, rollback stops the matcher and backend).
   - Re-run the ≥200 labelled pairs gate on the new MATCH semantics before release, using the measurement harness from the 2026-11-15 task.
7. **Performance verification.** EXPLAIN the forward and reverse paths through the view and functions to confirm inlining and GIN use, and measure the suggestion pass at 10k wants.

---

## Next Steps

Invoke the gap-analyzer with this report. Have it confirm decisions with the operator on:
- the shared-code strategy (contract-only vs path dependency)
- the role-creation mechanism
- the pending-state representation
- the trigger mechanism (NOTIFY trigger vs explicit)
- whether listing-side changes (rename, visibility, reservation cancel) should also NOTIFY
- the bell latency target (outbox poll interval)

Then move on to specification.
