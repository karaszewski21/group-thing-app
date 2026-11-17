# Gap Analysis: Wants matcher as a separate service (MATCH / SUGGESTION tiers)

## TL;DR
None of the target contract exists yet. There is no tier, pending signal, view, SQL function, NOTIFY, stemming, matcher app, compose service or wants outbox handler; head is 0099. Matching runs in-process today, synchronously in create/update/resume and in a 15-min APScheduler scan. **One blocking finding:** the requested trigram typo path (~0.65 on the whole name) turns `Traktor Bruder Claas → Traktor bruder Deutz` into a MATCH (measured word_similarity 0.714). That contradicts the expected SUGGESTION, so the typo path has to work per word. The second blocker is a durable "match requested" column on `wants`: it serves as the work queue (NOTIFY alone is lossy) and as the pending state the frontend polls. Risk medium-high, effort high.

## Key Decisions
- Characteristics: modifies_existing_code, creates_new_entities, involves_data_operations and ui_heavy are true; has_reproducible_defect is false. This is a feature/refactor, not a bug fix, although the whole-name trigram rule already over-matches today (0.714 ≥ 0.70).
- Change type is **modificative**. Matching goes from synchronous to asynchronous, so create/update/resume responses no longer carry fresh counts. Compatibility is **moderate**: frontend and backend deploy together, and no external API consumers exist.
- The backend stays the only schema owner. The matcher talks to the DB contract with raw SQL and never imports `app.*`. Verified: `alembic/env.py` reads only `DATABASE_URL` from the environment, and revisions don't import `app`.
- Stemming can stay **on the want side only**. `products.search_vector` already holds folded, unstemmed words, and a stemmed prefix `tsquery` with weight A (`'kurtk':*A & 'zim':*A`) runs on the existing GIN index. No product-side column or reindex is needed.
- A SUGGESTION needs ≥2 shared words and ≤1 missing. A 2-word want with one word missing has only 1 shared word, so **suggestions can only arise for wants with ≥3 words**. That bounds the cost.
- No `event_types` split is needed. The matcher only INSERTs outbox rows and never dispatches; the backend's single unfiltered poller (`main.py`, `run_forever()`) claims `wants.*`.

## Open Questions / Risks
- **Prefix false positives** from crude stemming, measured on the local DB:
  - Stripping `-ka` gives `kurt`, which matches „Kurtyna prysznicowa”.
  - `lego:*` matches „Legowisko dla psa”.
  - Fix: use minimal suffix stripping, a minimum stem length, and exact (non-prefix) lexemes for short words (≤3, possibly ≤4 chars). The 0099 release gate (≥200 labelled pairs) must score the final rules before deploy.
- **Backend `service_started` ≠ migrated.** Compose runs `alembic upgrade head && uvicorn` in one container with no healthcheck, so the matcher can start before 0100 exists.
- **Outbox handler partial commits.** `dispatch_pending` commits after a handler raises, with no savepoint, so a half-written bell batch could be committed on retry. The wants handler should run in `begin_nested()`.
- **Stale bells.** An edit or withdraw between the matcher run and the ≤60 s outbox dispatch can leave a bell for pairs already deleted. The handler must re-check that the `want_matches` rows still exist with tier MATCH.
- **`updated_at` version column.** Expire and remind must keep bumping `updated_at`. Clearing the request marker should not, and should use compare-and-clear instead, so that a seeker PATCH is not answered 409 by background work.
- **Pending forever** if the matcher is down. The frontend needs a polling cap and fallback copy, and the runbook needs a check that the queue drains.
- **Known limit (accepted):** an item that later becomes takeable (PRIVATE→PUBLIC, cancelled reservation, rename) is not rematched.
- **Suggestion cost** must be measured (EXPLAIN at 10k wants), as must the inlining of `matchable_listings` / `can_see_listing` into the GIN plans.

## Summary
- **Risk Level**: Medium-High. Privacy rule duplicated in SQL, sync→async API change, new deployable, matching-quality gate.
- **Estimated Effort**: High. About 25+ files across backend, new `src/matcher`, frontend, compose and docs; about 6 backend test files rewritten or moved.
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy.

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`writes.py`, `scan.py`, `match_notifications.py`, `reads.py`, `schemas.py`, `models.py`, `main.py`, frontend wanted feature)
- Creates new entities: yes (`src/matcher` app, Dockerfile, compose service, migration 0100, SQL view/functions/trigger, tier and pending columns, outbox event type, suggestions UI)
- Involves data operations: yes (`want_matches` rows by tier, `wants` pending marker, outbox rows, notifications)
- UI heavy: yes (pending state, new „Może Cię zainteresuje” section, polling)

## Gaps Identified

### Missing Features
| Gap | Evidence (current state) |
|---|---|
| `want_matches.tier` MATCH/SUGGESTION and stored missing words | `models.py:143` WantMatch has source/score/seen_at/opened_at only |
| Pending / match-requested signal on `wants` | `Want` (`models.py:51`) has no such column. Today the response is final because matching is synchronous |
| `NOTIFY wants_changed` | No `pg_notify`/LISTEN anywhere in `app/` |
| `matchable_listings` view, `can_see_listing(seeker, item)` function | Rules exist only as SQLAlchemy builders: `matcher.py` `takeable()`, `groups/infrastructure/visibility.py:52` `owner_shares_group_with`, `membership.py` `group_ids_for` |
| Crude Polish stemming (`stem_pl`) and stemmed prefix query | `wants.name_query` = `plainto_tsquery('simple', fold_pl(name))` (exact words). `fold_pl` does not stem |
| Per-word typo path | Trigram test is whole-name `word_similarity(want.name_folded, product name_folded)` ≥ 0.70/0.60 (`matcher.py`, `limits.py`) |
| SUGGESTION computation (≥2 shared, ≤1 missing, ≤10/want, no bell) | Nothing exists |
| `src/matcher` app (pyproject/uv.lock, LISTEN loop, window scan, sweep, Dockerfile, tests) | `src/` contains only `backend`, `frontend`, `resources` |
| Wants outbox event + backend handler for WANT_MATCH_FOUND / WANT_EXPIRING | `write_bell_rows` is called inline from `scan.py`. Only notifications/storage listeners are registered in `main.py` lifespan |
| Compose `matcher` service | `docker-compose.yml` has postgres/backend/web/frontend only. Backend has no healthcheck |
| Suggestions API + UI („Może Cię zainteresuje”, „brakuje: …”) | `GET /wants/{id}/matches` returns `list[WantMatchResponse]` with no tier. `wantMatchesViewState.ts` has no matching/suggestions kinds |
| Frontend pending state „Szukamy pasujących rzeczy…” + polling | `useWantMatches.ts` has no `refetchInterval` |

### Incomplete Features
- **Matching rules.** Today a pair matches when all words match exactly (FTS) OR on whole-name trigram. The new rule needs all *stemmed* words as weight-A prefixes OR a per-word typo match, plus a separate suggestion tier.
- **Bell writing.** It works but is coupled to the in-process scan. It has to become event-driven and must exclude suggestions.

### Behavioral Changes Needed
- **create/update(matching fields)/resume**: from "match in-request under a 3 s timeout, 503/409 mapping, counts final" to "set match-requested + NOTIFY, return pending; counts arrive later". `FORWARD_STATEMENT_TIMEOUT_SECONDS` and `ForwardMatchTimedOut` (503) become dead code and should be removed.
- **Scan**: from a 15-min APScheduler job in the backend (`main.py` `_run_want_scan`, l.92-117/160-162) to a matcher loop about every 60 s, with the window marker kept.
- **Counts**: `match_count`/`new_match_count` must count tier MATCH only (`reads._match_counts`).
- **Known over-match**: `Traktor Bruder Claas → Traktor bruder Deutz` matches today (whole-name word_similarity 0.714 ≥ 0.70) and must become a SUGGESTION.

### Measured evidence (local postgres:18, `fold_pl` from 0087)
| Want → item | whole-name word_similarity | per-word (stem prefix in name / best word_similarity) | Expected |
|---|---|---|---|
| kurtka zimowa → Kurtka na zimę | 0.588 | kurtk ✓, zim ✓ (zime) | MATCH ✓ via prefix |
| Traktor Bruder Claas → Traktor bruder Deutz | **0.714** | traktor ✓, bruder ✓, claas ✗ (0.00) | SUGGESTION. Whole-name trigram at 0.65 would wrongly make it a MATCH |
| rowerek biegowy → Rower biegowy dla dziecka | 0.765 | rower ✓, bieg ✓ | MATCH ✓ |
| kurtka zimowa → Kurtka przejściowa | 0.500 | kurtk ✓, zim ✗ (0.29) | none ✓ (1 shared <2) |
| traktor bruder → Koparka Bruder | 0.467 | traktor ✗, bruder ✓ | none ✓ |
| kurtka → Kurtyna prysznicowa | — | `kurt:*` ✓ if `-ka` is stripped | false positive: strip only `-a` → `kurtk` |
| lego → Legowisko dla psa | — | `lego:*` ✓ | false positive: short words must stay exact |

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | `/add/wanted` → save → matches page (`WantFormView` l.160-161 navigates) | Same path. The page first shows „Szukamy pasujących rzeczy…” | ✅ |
| Discoverability (matches) | 8/10, shown immediately | 8/10 after 1-3 s of pending | 0 |
| Discoverability (suggestions) | n/a | 7/10, section under the matches on the same page | new |
| Flow integration | Counts are final on create | Counts start at 0 and arrive later. List view (`WantedListView`) and AddView/AccountView totals can be stale until refetch. `ItemPickupActions` close-prompt appears only after matching | ⚠️ needs pending copy in the list view too, or acceptance |
| Multi-persona | Seeker only; guests can't have wants | Unchanged | ✅ |

## Data Lifecycle Analysis

### Entity: want_matches (tier MATCH)
| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Today `matcher.match_statement` in the backend → moves to the matcher | n/a (system) | n/a | ⚠️ to be moved |
| READ | `reads.list_matches`, `GET /wants/{id}/matches` | `WantMatchesView`, `MatchCard` | Routed from the wanted list and the bell | ✅ (tier filter needed) |
| UPDATE | seen/opened endpoints | auto on view / card click | ✅ | ✅ |
| DELETE | edit/withdraw in `writes.py`; purge cascade | Edit form, close sheet | ✅ | ✅ (purge moves to the matcher) |

### Entity: want_matches (tier SUGGESTION), new
| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing (matcher) | n/a | n/a | ❌ planned |
| READ | Missing (no endpoint or field) | Missing („Może Cię zainteresuje”) | Missing | ❌ planned |
| UPDATE | `opened_at` via the existing opened endpoint if it is tier-agnostic | card click | — | ⚠️ decide |
| DELETE | Same as MATCH (edit deletes all pairs; purge cascades) | — | — | ✅ inherits |

### Entity: wants.match-requested (pending), new
CREATE/UPDATE are set by the backend writes and cleared by the matcher. READ needs a new `WantResponse` field plus frontend polling. All three are missing and planned.

### Entity: outbox wants event → notifications
CREATE: matcher raw INSERT into `outbox_entries`. Every column must be set: id, created_at, updated_at, event_type, payload, status `PENDING`, attempts 0. `attempts` has only a Python default. READ: the backend handler. Bell READ and access already exist (`NotificationBell`, generic `link_path`). Missing: handler and registration.

**Completeness (planned scope delivered on all 3 layers)**: 100%. **Current**: SUGGESTION 0/3 layers and pending 0/3 layers.
**Orphaned operations if partially delivered**: a SUGGESTION CREATE without the READ UI would be orphaned, so the matcher tier and the frontend section must ship together. The same applies to pending: the backend column without polling leaves an empty page.
**Missing touchpoints**:
- `GET /wants?matched_item_id=` (used by `useWantsMatchingItem` → `ItemPickupActions` close prompt). The tier policy must be decided.
- `WantedListView` cards, for pending copy.
- The `mark_matches_seen` / `new_match_count` semantics for suggestions.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Typo path: whole-name vs per-word trigram.** A whole-name word_similarity ≥ 0.65 makes `Traktor Bruder Claas → Traktor bruder Deutz` a MATCH (0.714), which contradicts the expected SUGGESTION.
   - Options:
     - A) Per-word: MATCH when every want word is a stem-prefix hit OR has a name word with word_similarity ≥ 0.65. Correct on all 5 examples; costs a per-word check on candidates.
     - B) Whole-name trigram allowed only when no word is fully missing. Still needs the per-word pass, so it is no simpler.
     - C) Whole-name at a higher threshold (≥0.75). Brittle: `rowerek biegowy` scores 0.765.
   - Recommendation: **A**. The GIN trigram index (`<%`) still pre-filters candidates.
2. **Pending state and work queue.**
   - Options:
     - A) `wants.match_requested_at timestamp NULL`, set by create/resume/matching-field edit. An AFTER trigger does `pg_notify('wants_changed', id)` when it is set. The matcher claims with `FOR UPDATE SKIP LOCKED` and clears with compare-and-clear (`WHERE match_requested_at = :seen`). The API exposes `matching: bool`. Durable, so a missed NOTIFY is caught by the periodic poll, and it gives the frontend its signal.
     - B) `wants.matched_at` (NULL = pending). Simpler, but a re-edit after a match can't be told apart from "done" without comparing against `updated_at`.
     - C) NOTIFY only, plus a frontend timer. Lossy, with no real pending signal.
   - Recommendation: **A**, with a trigger rather than explicit `pg_notify` in `writes.py`, so every writer is covered.
3. **Forward matching: stays synchronous or moves to the matcher, and with what semantics.**
   - Options:
     - A) Move to the matcher (as the task states). Want-triggered matches stay *born seen with no bell*, as today. Window (new-listing) matches stay unseen and belled.
     - B) Move, but want-triggered matches arrive unseen and belled. The seeker gets a bell for results they are watching load.
     - C) Keep synchronous forward matching in the backend and move only the window and sweep. Contradicts the task and duplicates the SQL in two apps.
   - Recommendation: **A**. The claim from item 2 tells the matcher which path it is running.
4. **Single definition of PRIVATE visibility.** Privacy-critical: a wrong copy leaks PRIVATE listings.
   - Options:
     - A) `can_see_listing` as `LANGUAGE sql STABLE` in 0100 (inlinable), used by the matcher and by `matchable_listings`. Add a backend parity test that runs it against `owner_shares_group_with(private_only=True)` over fixture memberships (standing/ended membership, leadership, deleted group, PUBLIC group). Extend the comment in `test_membership_definition_guard.py` to name the SQL copy.
     - B) Switch the backend's `items_visible_to` and search to the SQL function. Wide blast radius over search plans, out of scope.
     - C) Copy without a parity test. The copies will drift.
   - Recommendation: **A**.

### Important (Should Decide)
1. **Stemming implementation.**
   - Options:
     - A) IMMUTABLE SQL `stem_pl(text)` plus generated stored columns on `wants`: the stemmed prefix `tsquery` (`'kurtk':*A & 'zim':*A`, short words exact) and a word array for suggestions/missing-word display. Backend-owned, single definition, GIN-served.
     - B) Compute in the matcher in Python. Rules live outside the schema owner, and the backend can't explain a match.
   - Default: **A**. Strip a minimal suffix set (no `-ka`), require stem length ≥4, keep words ≤3 (consider ≤4) exact. Changing the function later means DROP/ADD of the generated columns in a new migration.
   - `short_words_query` can become generated too, which removes `text_queries.py`.
2. **How SUGGESTION is computed and capped.**
   - Options:
     - A) Only for wants with ≥3 words. Candidates come from the GIN index via an OR of stemmed prefixes on weight A. Count shared/missing words per candidate in SQL. Insert with `missing_words text[]` (original-case want words). Cap at 10 per want *in total* (subtract the existing SUGGESTION count), with no bell and `seen_at` irrelevant.
     - B) Compute at read time. Expensive on every page load, with no cap stability.
   - Default: **A**, name words only for now. The clarification allows description words for SUGGESTION, but that adds weight-C candidates and noise, so defer it until the release gate shows a need.
3. **API shape for suggestions and counts.**
   - Options:
     - A) Keep `/matches` MATCH-only and add `GET /wants/{id}/suggestions` → `{id,title,href,meta,missing_words}`. Old semantics stay intact for existing consumers and frontend key-set tests.
     - B) Add `tier` and `missing_words` to every `WantMatchResponse` in one list. Fewer requests, but every consumer has to filter.
     - C) Change `/matches` to an object `{matches, suggestions}`. Breaking.
   - Default: **A**.
   - Counts (`match_count`, `new_match_count`) are MATCH only.
   - `?matched_item_id=` should include both tiers, so the close prompt also appears after taking a suggested item.
4. **Expire/remind/purge location.**
   - Options:
     - A) The matcher, per the task. `WANT_EXPIRING` goes through the same outbox event. Allows removing the backend wants scheduler entirely.
     - B) Keep a small backend APScheduler job for the sweep. Contradicts "remove the wants job"; bells stay simple.
   - Default: **A**.
5. **Outbox event shape.**
   - Options:
     - A) One `wants.bells_due` event per matcher transaction `{pairs:[[want_id,item_id]...], expiring:[want_id...]}`. The backend handler wraps the existing `write_bell_rows`, keeping the "one unread row per want, summed count" logic. It re-reads names from the DB, re-checks that pairs still exist with tier MATCH, and runs in a savepoint.
     - B) Separate `wants.match_found` and `wants.expiring` events. Two handlers, and the shared locking order has to be duplicated.
     - C) One event per want. More rows; the summed count per run is lost.
   - Default: **A**.
6. **Startup ordering vs migrations.**
   - Options:
     - A) The matcher waits at startup, with a retry loop and a log line, until `alembic_version` is at or past its required revision. Compose `depends_on: postgres healthy, backend started`.
     - B) Add a backend HTTP healthcheck and use `service_healthy`. Needs a health endpoint and curl in the image.
     - C) A one-shot `migrate` service. Changes the backend deploy shape.
   - Default: **A**, plus B if a health endpoint already exists.
7. **No-duplicate concurrency with several matcher copies.**
   - Options:
     - A) Per-want claim with `FOR UPDATE SKIP LOCKED` on `match_requested_at IS NOT NULL`. Window scan and sweep under `pg_try_advisory_xact_lock(<const>)` plus the versioned marker. ON CONFLICT (want_id,item_id) DO NOTHING stays.
     - B) Marker versioning only, as today. Racing copies then lose whole runs with StaleDataError semantics that must be re-implemented in raw SQL.
   - Default: **A**.
8. **Test migration strategy for `src/matcher`.**
   - Options:
     - A) The matcher dev group adds `alembic`. Tests run `alembic -c ../backend/alembic.ini upgrade head` with `DATABASE_URL` pointing at the testcontainer (verified: env.py needs only `DATABASE_URL`, revisions don't import `app`).
     - B) Subprocess `uv run --project ../backend alembic upgrade head`. Needs the backend venv.
     - C) A schema snapshot SQL. Drifts.
   - Default: **A**. Matcher tests run from the repo, not inside the matcher image.
9. **New migration 0100 vs amending 0099.** 0099 is committed but deploy-gated, and dev DBs are already at 0099.
   - Options:
     - A) New additive 0100. Safe for existing DBs.
     - B) Amend 0099. Breaks any DB already at 0099.
   - Default: **A**. Update the runbook text that says "There is no revision 0100".
10. **Trigram path with a category set.**
    - Today there are two thresholds (0.70 without a category, 0.60 with one). The task mentions "~0.65 without category".
    - Options:
      - A) One per-word threshold of 0.65 regardless of category.
      - B) Keep a lower threshold when a category is set.
    - Default: **A**, so the gate measures a single knob.
11. **Frontend pending UX bounds.**
    - Options:
      - A) Poll every 2 s while `matching` is true. Stop after about 60 s and show „Wyniki pojawią się wkrótce”. Show the pending copy on `WantedListView` cards too.
      - B) Poll only on the matches page.
    - Default: **A**.

## Recommendations
- Deliver in this order:
  1. 0100 contract: tier, missing_words, match_requested_at + trigger, `stem_pl` + generated columns, `can_see_listing`, `matchable_listings`.
  2. Backend writes, reads and outbox handler, plus the parity test.
  3. `src/matcher`.
  4. Frontend.
  5. Compose, runbook and docs.
- Port the five expected pairs, plus the two false-positive probes (Kurtyna, Legowisko), into matcher tests as fixed cases. Then run the ≥200 labelled-pair gate (harness in `2026-11-15-szukam-wanted-mechanism/implementation/measurement/`) before setting thresholds.
- EXPLAIN the forward path through the view/function to confirm inlining and use of the GIN index on search_vector and the trigram index. Measure the suggestion pass and the 1-min window at 10k wants.
- Remove `_run_want_scan`, the scheduler job and the wants imports from `main.py`, and add a "wants scan not scheduled" test (precedent: `test_worker_removed.py`). Drop the 503 `ForwardMatchTimedOut` path and its tests.
- Fix doc drift while editing: `architecture.md:125` says runtime-dev but compose builds `runtime`; the `main.py` docstring says a 30 s outbox poll but it is 60 s.

## Risk Assessment
- **Complexity Risk**: High. A second deployable, a SQL contract, two-tier text matching and an async API.
- **Integration Risk**: Medium-High. Ordering of NOTIFY, outbox and migrations across processes. There are no cross-process tests today.
- **Regression Risk**: Medium-High. About 3k lines of wants tests rewritten or moved. A visibility copy is a privacy risk, mitigated by the parity test. Matching quality must pass the gate.
