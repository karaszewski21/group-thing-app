# Codebase Analysis Report

**Date**: 2026-11-18
**Task**: Semantic SIMILAR tier for the Szukam (wants) matcher
**Description**: Implement a semantic SIMILAR tier: mmlw-roberta-base int8 ONNX embedder in the FastAPI process (new compute-only `app/embeddings` module), `halfvec(768)` side tables `product_embeddings`/`want_embeddings` in new revisions `0100_pgvector` + `0101_want_similar` on `pgvector/pgvector:0.8.7-pg18-trixie`, recreated `matchable_listings` view, tier CHECK incl. SIMILAR, sync best-effort vector writes in product and wants write paths with outbox `embeddings.requested` retry and a lifespan reconcile sweep, matcher FORWARD_SIMILAR/WINDOW_SIMILAR run last, gate 101, `rules.py` constants + drift test, `GET /api/wants/{id}/similar`, frontend „Powiązane rzeczy” section. Design: `analysis/research-context/high-level-design.md` (+ `decision-log.md`).
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

---

## TL;DR
Every integration point in the design exists, and the SUGGESTION tier can be copied almost line by line for the backend reads, route, tests and frontend section. Three areas need real refactoring rather than copying. First, the matcher's `_statement()` hardcodes word-similarity scoring, the text candidate and the SUGGESTION cap. Second, `window.py` derives the suggestion count as `len(pairs) - len(matches)`. Third, `matchable_listings` has no `product_id`, so the embedding join must live inside the recreated view. Vector writes need new code paths: they must not fail when the embedder is missing (moderation raises 503), and outbox handlers must use `begin_nested()`. The work spans backend, matcher, migrations, infra and frontend (about 35 files), so the risk is Medium-High.

## Key Decisions
- **Extend the matcher's existing `_statement()` builder with a tier-specific `pairs` body. Do not add a generic "tier strategy" abstraction.** The minimal-implementation standard says so, and SIMILAR shares the visibility, owner≠seeker, NOT EXISTS, ranking and ON CONFLICT parts.
- **Pull the inline visibility block (`statements.py` ~160–169) into a `_VISIBILITY` fragment.** The parity test (`test_wants_visibility_parity.py` `CALL_SITE_RULE`) copies it as text, so both tiers must emit the same text.
- **Rebind `$3`/`$4` per tier, for SIMILAR as `$3::text` model id and `$4::float8` min similarity (or use a per-tier param tuple in `_store`).** Postgres rejects unused parameters it cannot type, and `_store` always binds `SHORT_WORD_MAX_CHARS`/`WORD_SIMILARITY_MIN` today.
- **Put the `LEFT JOIN product_embeddings` inside the recreated `matchable_listings`.** The view exposes `item_id` but not `product_id`. The upgrade can `CREATE OR REPLACE` if new columns go last. The downgrade must DROP + CREATE using the exact 0099 SQL. No other view depends on `matchable_listings`.
- **On an embedder miss or timeout, log, commit the write and stage an `embeddings.requested` outbox row.** Do not copy moderation's `ModerationUnavailable` 503.
- **Add `embeddings.requested` to `app/wants/infrastructure/outbox_acl.py` (it re-exports only `Handler`/`get_handlers`/`register_handler` today, so also add `append`) and call it through a new `embeddings_acl.py`.** This keeps `tests/test_module_boundaries.py` passing. Add `"embeddings"` to `MODULES`.
- **Add `FakeEmbedder` to `tests/conftest.py`, not per file.** More than three test files will import it, and `FakeTextClassifier` is already duplicated, which is an anti-pattern. ML libraries are only in the `ml` dependency group.
- **Keep `match_count`/`new_match_count` counting MATCH only, and fire bells for MATCH only.** SIMILAR rows are born seen and their `missing_words` is NULL.
- **Keep the frontend query key `[WANTS_KEY,"matches",token,wantId]` and add `getWantSimilar` to the same `Promise.all`.** Invalidation (`useWants.ts:138`) and polling keep working unchanged.

## Open Questions / Risks
- **`list_wants(matched_item_id=...)` (`reads.py` 196–200) does not filter by tier.** Once SIMILAR rows exist, a want would show up on an item's "who is looking" prompt only because of semantic similarity. A product decision is needed on whether to filter it to MATCH/SUGGESTION.
- **`matchable_listings.changed_at`.** If `e.updated_at` (embedding) is added to `greatest(...)`, an in-place product rename starts re-triggering the window. This contradicts the 0099 comment (l205–210) and the known-limit wording in `architecture.md`. Decide on it deliberately and document it.
- **`get_or_create_product_by_name` returns early for an existing product without any check.** The design's "embed when no current vector" needs a new branch there, which is an extra read on a hot path.
- **`resume_want` has no text check.** Decide whether resume embeds or reconciles (the lifespan sweep would cover it).
- **New APScheduler reconcile job.** It breaks `tests/test_wants_scan_removed.py:68`, which asserts exactly `[_run_term_end_scan, _run_media_sweep]`. If the design means a startup-only sweep rather than a job, this does not apply.
- **Tests that call `dispatch_pending` without an `event_types` filter** will now also process staged `embeddings.requested` rows. Those tests need the fake embedder or a filter.
- **Postgres image switch.** Five places need it: `docker-compose.yml:3`, backend `tests/conftest.py:58`, matcher `tests/conftest.py:67`, and the docs `architecture.md:383` and `tech-stack.md:53,114`. Volume `/var/lib/postgresql` is compatible with the pg18 layout, but this is an infra/deploy change, so a runbook is needed.
- **Docs state "no revision 0100"** (`architecture.md:687`). The amended-0099 release gate and runbook must be reconciled with the new 0100/0101.
- **There is no int8 quantization step in the Dockerfile today.** The `models` stage exports Bielik-Guard only, so the mmlw-roberta export plus quantize is new build work (needs `HF_TOKEN` handling via `/run/secrets/hf_token`; never print it).
- **`window.py` `suggestions = len(pairs) - len(matches)`** would silently count SIMILAR rows as suggestions. Counts must be per tier, and the log line and `WindowRun`/`_Match` must gain a `similar` field.
- **`tests/test_constants_drift.py` `test_backendLimits_movedConstantsGone_onlyReminderLeadShared`** asserts that only `REMINDER_LEAD` is shared between the backend and the matcher. New SIMILAR constants must live only in `matcher/rules.py`, or the test has to change.
- **No real-model test is possible in CI** (onnxruntime is not in `dev`). Use an `importorskip` test like the moderation one (`test_text_guard.py:163–173`).

---

## Summary

The task adds a fourth match tier on top of a codebase with a fully working MATCH/SUGGESTION pipeline. The pieces are the 0099 schema contract, the `src/matcher` service, the `app/wants` reads/writes/route and the `features/wanted` UI. The ONNX in-process moderation stack (`app/moderation/onnx_models.py`, `text_guard.py`) and the outbox (`app/outbox`) are good templates for the embedder and the retry. The design touches every layer, so the main effort is keeping the module boundaries, the visibility parity, the contract revision and the exact-key-set tests consistent.

---

## Files Identified

### Primary Files

**src/backend/alembic/versions/0099_wants.py** (421 lines)
- Source of `MATCHABLE_LISTINGS` (l211), `VIEWS` (l251), `FUNCTIONS` (l252), the upgrade with `SET LOCAL lock_timeout='5s'` (l274) and the downgrade (l403).
- `want_matches`: `score REAL NOT NULL` (l365), `tier String(10)` default `'MATCH'` (l368), `ck_want_matches_tier` (l375), `ck_want_matches_missing_words` (l377–379), `ix_want_matches_want_id_tier` (l383).
- 0101 must replace both CHECKs and recreate the view. The downgrade must copy the 0099 view SQL.

**src/backend/alembic/versions/0086_pg_trgm.py** (35 lines)
- Template for `0100_pgvector`: `CREATE EXTENSION IF NOT EXISTS` / `DROP EXTENSION IF EXISTS`, with a privilege-check runbook docstring.

**src/matcher/matcher/statements.py** (247 lines)
- `_WANTS` l45 (requires `stem_query IS NOT NULL`), `_WINDOW_LISTINGS` l59, `_NARROWING` l65, `_FORWARD_TEXT` l85, `_WINDOW_TEXT` l93, `_WORD_CHECK` l99, `_TIERS` l123, `_LIMITS` l131 (hardcodes `s.tier='SUGGESTION'`), `_statement` l141, `FORWARD_/WINDOW_ MATCH/SUGGESTION` l194–197, `_store` l200, `match_forward` l220, `match_window` l231.
- This file needs the most refactoring.

**src/matcher/matcher/window.py** (256 lines)
- `WindowRun` l80–90, `_Match` l101–108, `_match` l159–177 (per-tier counting bug risk), `run_window` l191, `did_work` l232–234, log line l235–249, `run_logged` l219.

**src/matcher/matcher/rules.py** (35 lines)
- Holds `MATCH_TOP_N=20`, `SUGGESTION_CAP=10`, `WORD_SIMILARITY_MIN=0.65`, `SHORT_WORD_MAX_CHARS=4`, `WINDOW_MAX_LISTINGS=300` and the 30 s statement timeout. Add the SIMILAR cap, minimum similarity and model id here.

**src/matcher/matcher/db.py** (103 lines)
- `CONTRACT_REVISION=99` (l22, compared numerically) must become 101. `missing_contract` l45 and `wait_for_contract` l60 need checking against the new tables. `limit_transaction` is 30 s with `jit=off`.

**src/backend/app/wants/application/writes.py** (357 lines)
- `_check_texts` l46, `_mapped_database_errors` l59, `create_want` l151 (embed after flush, once the id exists), `update_want` l187 (embed unlocked, next to `_check_texts`, before the `FOR NO KEY UPDATE` lock), `resume_want` l299.

**src/backend/app/wants/application/reads.py** (363 lines)
- `visible_matches` l55, `_match_counts` l76 (MATCH-only), `list_wants(matched_item_id)` l196–200, `_cards_select` l210 (tier-parameterised), `_suggestions_select` l266, `_ensure_own_want` l275, `_card_fields` l291, `list_suggestions` l350, `SUGGESTIONS_LIMIT=10` l52.

**src/backend/app/wants/router/wants.py** (109 lines)
- `/{want_id}/matches` l84 and `/{want_id}/suggestions` l91 are the template for `/similar`. Literal paths come before `/{want_id}`. Routes pass `now=datetime.utcnow()`.

**src/backend/app/wants/schemas.py** (115 lines)
- `WantSuggestionResponse(id,title,href,meta,missing_words,reserved_by_me,proposed_by_me)` → `WantSimilarResponse` without `missing_words`.

**src/backend/app/wants/models.py** (215 lines)
- `WantMatchTier` l163 (its docstring defines the tiers), and `WantMatch.__table_args__` l176 mirrors the CHECKs (l178–181). Add the `WantEmbedding` mapping or a Core table here, or in a new embeddings models file.

**src/backend/app/product/service.py** (533 lines)
- `create_product` l147 (check_text l150–151), `update_product` l164 (l173–174, embed only when the name changed), `get_or_create_product_by_name` l184 (l203), `set_shared_description` l510, `_stage_photo_files_delete` l232–240 (outbox staging pattern). Each function commits itself.

**src/backend/app/main.py** (194 lines)
- `_OLD_WANTS_SCHEMA` l88 and `_check_wants_contract()` l91 (`to_regclass` template). Lifespan l104: classifier setup, `register()` ×3 l132–134, outbox task l135, APScheduler jobs l140–147, teardown `set_classifier(None)` l155. Job intervals as module constants l71–75, job wrappers opening `async_session_factory` l78–85.

**src/backend/app/moderation/onnx_models.py** (69 lines) / **classifiers.py** (16) / **text_guard.py** (126)
- Template for the embedder. `_session` uses `intra_op_num_threads=1` with `CPUExecutionProvider`. `_model_id` reads `model_id.txt`. `_MAX_TOKENS=512`. Tokenizers come from `tokenizers.Tokenizer` and are imported lazily. Feeds are int64, `token_type_ids` only if the model declares it. There is a `Protocol` interface and `set_classifier`/`get_classifier` (l82/l87). `INFERENCE_TIMEOUT_SECONDS=5.0` runs via `asyncio.wait_for(asyncio.to_thread(...))`.

**src/backend/app/outbox/** (service.py, registry.py, dispatcher.py, scheduler.py)
- `append(db,*,event_type,payload)` only does `db.add`. Handlers are keyed by event type, and all handlers for a type run in one try. `_claim_batch` uses `SKIP LOCKED` with batch 50 and `MAX_ATTEMPTS=5`, and there is a log line `"... FAILED after %d attempts"`. The dispatcher commits after every entry with no savepoint, so handlers must use `db.begin_nested()` (template: `wants/application/bells_due.py:256`, docstring l9–11). Registration is idempotent (`bells_due.py:205–209`).

**src/backend/Dockerfile** (63 lines)
- `models` stage l21 (`optimum-onnx[onnxruntime]==0.1.0` + CPU torch, `optimum-cli export onnx`, `tokenizer.json` via `hf_hub_download`, HF token from `/run/secrets/hf_token`, `model_id.txt`). `runtime` l53 copies `/models/text` (l58). It needs an `/models/embeddings` export plus an int8 quantize step.

**Frontend: src/frontend/src/api/wants.ts** (130), **hooks/useWantMatches.ts** (102), **features/wanted/wantMatchesViewState.ts** (71), **features/wanted/WantMatchesView.tsx** (435), **features/wanted/SuggestionCard.tsx** (41)
- `getWantSuggestions` l119 → `getWantSimilar`. The hook key l50, `Promise.all` l52, and the `NO_*` constants. `WantMatchesData` l4 and the union l26 (four active kinds carry suggestions). The view has `suggestionsSection` l104 and `SuggestionsSection` l327 (rendered at l159/184/195/210). „Powiązane rzeczy” does not appear anywhere yet.

### Related Files

- **src/backend/app/config.py** – add `embeddings_enabled: bool = False` (and models dir/timeout if needed) next to the moderation settings l44–49.
- **src/backend/.env.example / root .env.example** – add the `EMBEDDINGS_ENABLED` name only (placeholders, never values).
- **docker-compose.yml** – postgres image l3, volume l11, backend env l31–44 (hardcodes `MODERATION_TEXT_ENABLED "true"`), `hf_token` secret l19–25, matcher service l55–64.
- **src/backend/pyproject.toml** (81) – `ml` group l34 (numpy, onnxruntime, tokenizers). There is no `pgvector` Python package; using raw `halfvec` text/`::halfvec` casts avoids adding one.
- **src/backend/app/core/authorization_matrix.py** l246–247 – rows 66/67 already cover `^/api/wants(/.*)?$`. Only the comment listing `/matches`/`/suggestions` needs updating.
- **src/backend/app/wants/infrastructure/** – 10 ACLs. Patterns: `moderation_acl.py` (11 lines) and `outbox_acl.py` (8). Add `embeddings_acl.py`.
- **src/backend/app/wants/domain/status.py** – `WantMatchSource` FORWARD/SCAN. **domain/limits.py** – parsed by the matcher drift test.
- **src/matcher/matcher/requests.py** (151) – `process_next` ignores the result, so no change unless the forward step gains a SIMILAR call.
- **src/matcher/matcher/outbox.py** l14–25 – raw-SQL `wants.bells_due` producer. It stays MATCH-only.
- **src/frontend/src/components/shared/ItemCard.tsx** – dashed style l25, footnote l28. Used by `SuggestionCard` and the new similar card.
- **src/frontend/src/hooks/useWants.ts** – `WANTS_KEY` l21, `useMatchingPolledQuery` l50, invalidation l138.
- **.maister/docs/project/architecture.md**, **tech-stack.md** – stale "no revision 0100" and postgres:18 statements. A new runbook is needed for 0100/0101.

---

## Current Functionality

The matcher (`src/matcher`) stores MATCH and SUGGESTION pairs in `want_matches`. It runs two kinds of statement:

- **Forward** statements run per want on request (LISTEN + 10 s poll).
- **Window** statements run every 60 s over new or changed listings from `matchable_listings`.

`_statement()` builds the following parts:

- A `pairs` CTE from text candidates.
- Narrowing by offer mode, category path and locality/radius.
- A `_WORD_CHECK` LATERAL that yields words, hits and missing words.
- An inline visibility rule and owner≠seeker.
- `NOT EXISTS` against existing `want_matches`.
- `row_number()` ranking by score DESC, created_at DESC, item_id.
- Tier caps.
- `INSERT ... ON CONFLICT (want_id,item_id) DO NOTHING RETURNING`.

Window-tier MATCH rows are born unseen and ring the bell through `wants.bells_due` outbox rows. SUGGESTION rows are born seen with `missing_words`.

The backend serves these through `/api/wants/{id}/matches` and `/suggestions`. Both are built on the tier-parameterised `_cards_select` and the shared `visible_matches` predicate. The frontend fetches both in one hook and renders them in `WantMatchesView` through the pure `resolveWantMatchesView()`.

### Key Components/Functions

- **`_statement(tier, mode)`** (matcher): builds every match INSERT. `seen_at NULL` only for window MATCH. `missing_words` only for SUGGESTION. With `seen_at` set and `missing_words` NULL, a SIMILAR row satisfies both, as long as the CHECK allows it.
- **`_LIMITS`**: the SUGGESTION cap is `$5` minus stored rows still in `matchable_listings`. It needs to become tier-generic.
- **`_check_texts` / `moderation_acl.check_text`**: the pre-write text gate. It skips unchanged text and raises 503 when moderation is unavailable.
- **`update_want`**: unlocked read, then text checks, then `FOR NO KEY UPDATE`, then a compare of `updated_at` (409). If the text changed it deletes all `WantMatch` rows, drops the unread bell and sets `match_requested_at`. The trigger NOTIFYs `wants_changed`.
- **Outbox dispatcher**: claims with `SKIP LOCKED`, retries up to 5 times, commits after every entry, and marks event types with no handler as PROCESSED.
- **`OnnxTextClassifier`**: in-process ONNX inference via `to_thread` with a 5 s timeout.

### Data Flow

1. Product write → `check_text` → commit → (new) embed name, upsert `product_embeddings`. On a miss or timeout, stage `embeddings.requested`.
2. Want create/update → `_check_texts` → (new) embed → `Want` flush → (new) upsert `want_embeddings`. Then `match_requested_at` → trigger NOTIFY → matcher forward run.
3. Matcher forward/window → MATCH → SUGGESTION → (new) SIMILAR (last, so the text tiers claim pairs first via NOT EXISTS / ON CONFLICT) → `want_matches`.
4. Backend `GET /similar` → `_cards_select(..., SIMILAR)` → `visible_matches` → cards → frontend „Powiązane rzeczy”.
5. (New) The outbox `embeddings.requested` handler and the lifespan reconcile sweep fill missing or stale vectors (keyed on model id).

---

## Dependencies

### Imports (What This Depends On)

- **pgvector extension (0.8.7) on the pg18 image**: `halfvec(768)`, `<=>` cosine distance, and HNSW/ivfflat index if one is used.
- **onnxruntime, tokenizers, numpy** (`ml` group, lazy import): the embedder.
- **optimum-onnx / torch (build stage only)**: export and int8 quantization.
- **app.outbox**: retry via `append` and `register_handler`.
- **app.core.clock / datetime.utcnow**: timestamps (domain clock guard for `app/wants`).
- **APScheduler** (only if the sweep is periodic).

### Consumers (What Depends On This)

- **src/matcher/matcher/statements.py, window.py**: read `matchable_listings` (`_WINDOW_LISTINGS`, `WAITING_LISTINGS`).
- **src/matcher/matcher/db.py**: contract gate on the revision number and `to_regclass`.
- **app/main.py `_check_wants_contract`**: refuses to start on an old schema.
- **app/wants/application/reads.py**: `visible_matches`, `list_wants(matched_item_id)`, `_match_counts`.
- **tests/test_wants_visibility_parity.py**: copies the visibility rule as text.
- **tests/test_constants_drift.py** (matcher): constants shared with the backend.
- **tests/test_module_boundaries.py**, **tests/test_domain_clock_guard.py**: structural guards.
- **tests/test_wants_scan_removed.py**: lifespan job list.
- **tests/test_authorization_matrix.py** l146–151, l165–192: route coverage.
- **Frontend**: `useWantMatches` consumers and every `vi.mock("…/api/wants")` factory.

**Consumer Count**: about 14 files
**Impact Scope**: High. The change reaches the schema contract, a separate service, the lifespan and the frontend.

---

## Test Coverage

### Test Files

- **Backend**:
  - `tests/test_wants_matches_api.py`: `SUGGESTION_KEYS` l40, `_suggestions` l60, exact-keys/limit/order/count_queries test l493, visibility and 404 test l544, first-open test l429.
  - `tests/test_wants_api.py`, `_lifecycle`, `_bells_due` (`dispatch_pending(..., event_types=[...])` l60), `_edit_concurrency`, `_migration` (migration/contract pattern), `_notifications`, `_domain`, `_scan_removed` (lifespan pattern l45–80).
  - `tests/test_outbox.py` (`_clean_registry` l22, MAX_ATTEMPTS/FAILED logs l92–129).
  - `tests/test_text_guard.py` (fake classifier l29–48, real-model `importorskip` l163–173).
  - `tests/test_moderation_config.py` (settings-defaults pattern).
  - `tests/test_authorization_matrix.py`, `test_module_boundaries.py`, `test_wants_visibility_parity.py`, `test_domain_clock_guard.py`.
  - `tests/conftest.py`: `seed_want_matches` l366 (needs a `tier=` parameter), `_want` l336, `_Owner` l278–330, `count_queries` l85, `MODERATION_TEXT_ENABLED=false` forced at l47 (do the same for `EMBEDDINGS_ENABLED`).
- **Matcher**:
  - `tests/test_suggestions.py`: cap across runs, born seen without an outbox row, never both tiers for one pair (l109), stored non-matchable rows free their place (l127). Clone it as `test_similar.py`.
  - `tests/test_constants_drift.py`.
  - `tests/conftest.py`: `_TRUNCATED` l38–59 must include `product_embeddings` and `want_embeddings`; postgres image l67.
- **Frontend**:
  - `wantMatchesViewState.test.ts` (`it.each` + `data(overrides)`).
  - `useWantMatches.test.tsx` (mocks at l17/34/100/107/151/173, stable empty identity l68–73).
  - `WantMatchesView.test.tsx` (mock list l13–24, `serve()` l32, section tests l430–463 using `compareDocumentPosition`, a "no section" test).
  - `test/fixtures/wants.ts` (typed `make*`, no casts).

### Coverage Assessment

- **Test count**: strong existing coverage of the wants and matcher pipeline (dozens of tests across about 15 wants-related files).
- **Gaps**:
  - No vector, embedder or pgvector tests exist.
  - No test runs the real ONNX model in CI (only an `importorskip` is possible).
  - There is no test of the `changed_at` behaviour on in-place renames.
  - Tests that dispatch the outbox without a filter will pick up the new event type.

---

## Coding Patterns

### Naming Conventions

- **Backend functions**: `_ensure_*`, `*_select`, `list_*`/`load_*`, `*_acl.py`. Constraint names follow `ck_/ix_/fk_/uq_/pk_`.
- **Matcher SQL**: module-level triple-quoted strings, UPPERCASE public statements, `_fragments` and parameter comments. Constants are bound and typed (`$n::int/::real/::timestamp/::uuid`). Only tier and source literals are interpolated into f-strings.
- **Tests**: `test_<unit>_<scenario>_<expectation>` in camelCase, flat `tests/test_<feature>.py`.
- **Frontend**: `features/wanted/*View.tsx` + `*ViewState.ts`, hooks in `src/hooks`, API in `src/api`, typed fixture factories.

### Architecture Patterns

- **Style**: backend bounded contexts as `application/{reads,writes}`, `domain`, `infrastructure/*_acl`, `router`, `schemas`, `models`. Frozen dataclasses, keyword-only `now`, dense why-docstrings with requirement IDs.
- **Migrations**: `SET LOCAL lock_timeout='5s'`, `IF EXISTS` downgrades, exact-reverse downgrades, a runbook in `architecture.md`, and a downgrade-then-upgrade test per migration.
- **State management (frontend)**: TanStack Query hooks with an app-shaped return and stable empty constants. One pure view-state resolver with `switch` on `view.kind`. Polish copy, `aria-labelledby` sections and an `aria-hidden` emoji.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | statements.py 247, writes.py 357, reads.py 363, product/service.py 533, 0099 421, WantMatchesView 435 | Medium |
| Dependencies | pgvector, onnxruntime, tokenizers, numpy, optimum (build), outbox, APScheduler | Medium |
| Consumers | about 14 files/guards | High |
| Test Coverage | Strong existing; none for the new vector paths | Medium |

### Overall: Complex

About 35 files change across five layers: migrations/infra, backend embeddings module plus write paths, matcher, backend read API, and frontend. Several structural guards (boundaries, parity, drift, contract revision, lifespan job list, auth matrix) must stay green, and the rollout includes a Postgres image switch and a model build.

---

## Key Findings

### Strengths
- SUGGESTION is a complete end-to-end template, and `_cards_select` already takes the tier as a parameter.
- `want_matches.score REAL` already exists, and a SIMILAR row born seen with NULL `missing_words` fits `_statement()`'s existing branches for free.
- The ONNX loading, timeout and lazy-import code is proven in moderation.
- The outbox already gives retry, FAILED logging and idempotent registration.
- Auth matrix rows 66/67 already cover the new route.

### Concerns
- The matcher's `pairs` CTE, `_LIMITS` and `_store` parameters all assume text scoring.
- The window's `len(pairs) - len(matches)` would miscount SIMILAR rows.
- The view recreation and the `changed_at` semantics change.
- The tier-agnostic `list_wants(matched_item_id)`.
- Dispatcher has no savepoint, so handlers must use `begin_nested()`.
- The Postgres image switch for dev, CI and prod.
- Docs and release-gate statements are stale.

### Opportunities
- Pull the `_VISIBILITY` fragment out of `_statement()` and keep the parity test pointed at it.
- Extract the duplicated `reservedCaption` (in MatchCard and SuggestionCard; a third copy would be the similar card).
- Move the fake ML helpers into `tests/conftest.py`.

---

## Impact Assessment

- **Primary changes**:
  - New `alembic/versions/0100_pgvector.py` and `0101_want_similar.py`.
  - New `app/embeddings/` (embedder protocol, ONNX implementation, setter/getter).
  - `app/wants/{models,application/writes,application/reads,schemas,router/wants,infrastructure/embeddings_acl,infrastructure/outbox_acl}.py`.
  - `app/product/service.py`, `app/main.py`, `app/config.py`.
  - `src/matcher/matcher/{statements,window,rules,db}.py`.
  - `Dockerfile`, `docker-compose.yml`.
  - Frontend `api/wants.ts`, `hooks/useWantMatches.ts`, `features/wanted/{wantMatchesViewState.ts,WantMatchesView.tsx}`, a new `SimilarCard.tsx`, and a shared reserved caption.
- **Related changes**:
  - `authorization_matrix.py` comment, `pyproject.toml` (if the model group changes), `.env.example`.
  - `architecture.md` runbook for 0100/0101 and the image switch; `tech-stack.md`; `INDEX.md`.
- **Test updates**:
  - Backend: `tests/conftest.py` (`FakeEmbedder`, env flag, image, `seed_want_matches(tier=)`), the new `test_embeddings*.py` and `test_wants_similar_api.py`, the migration tests, plus updates to `test_authorization_matrix.py`, `test_module_boundaries.py`, `test_wants_scan_removed.py` and `test_wants_visibility_parity.py`.
  - Matcher: `conftest.py` (`_TRUNCATED`, image), new `test_similar.py`, `test_constants_drift.py`.
  - Frontend: the three wanted test files and the fixtures.

### Risk Level: Medium-High

The change touches the shared DB contract between two services and the deploy image, and it is not covered by an image-only rollback. It also changes the hot write paths (product create, want create/update), where a misbehaving embedder must never block a commit. It is mitigated by the strong existing tests, the SUGGESTION template and the feature flag (`embeddings_enabled` false by default).

---

## Recommendations

**Modifying existing code plus a new capability:**

1. **Migrations first.**
   - **0100**: `CREATE EXTENSION IF NOT EXISTS vector`, with a privilege runbook like 0086.
   - **0101**: `product_embeddings` and `want_embeddings` (`halfvec(768)`, `model_id`, `updated_at`, FK ON DELETE CASCADE), the new `ck_want_matches_tier` and `ck_want_matches_missing_words` allowing SIMILAR with NULL `missing_words`, and the recreated `matchable_listings` with the embedding columns appended last.
   - The downgrade first deletes SIMILAR rows, then restores the 0099 CHECKs and view verbatim.
   - Add a downgrade-then-upgrade-head test.
2. **`app/embeddings` as a compute-only module**:
   - A `Protocol`, an ONNX implementation modelled on `onnx_models.py` (mean pooling, normalisation, the model's query/passage prefix if mmlw requires one), `set_embedder`/`get_embedder` and a timeout.
   - Returns `None` on a miss and never raises 503.
   - Add it to `MODULES` in the boundary test.
3. **Write paths**:
   - Embed on the best-effort path and upsert the vector in the same transaction.
   - On `None`, stage `embeddings.requested {"subject": "product"|"want", "id": ...}`.
   - The handler wraps its work in `begin_nested()` and re-checks staleness by model id.
   - The reconcile sweep runs in the lifespan. If it is periodic, update `test_wants_scan_removed.py`.
4. **Matcher**:
   - Extract `_VISIBILITY`, add a SIMILAR `pairs` body (forward: scalar subquery for the want vector; window: `CASE WHEN narrowing`), make `_LIMITS` tier-generic and rebind `$3/$4` per tier.
   - Run SIMILAR last.
   - Use per-tier counts in `_Match`/`WindowRun` and add `similar=%d` to the log line.
   - Set `CONTRACT_REVISION=101` and add the new constants to `rules.py` plus the drift test.
5. **Backend read**: `SIMILAR_LIMIT`, `_similar_select`/`list_similar`, `WantSimilarResponse`, `GET /{want_id}/similar` with `ReadPrincipal`, the auth-matrix test row and comment, and exact-key-set tests that clone l493/l544.
6. **Frontend**:
   - Add `getWantSimilar`, `NO_SIMILAR` and the extra `Promise.all` entry.
   - Carry `similar` on the four active view kinds.
   - Render a `SimilarSection` („Powiązane rzeczy”, short lead, no footnote) after the suggestions section.
   - Add `makeWantSimilar` and update every `api/wants` mock.
7. **Settle the open questions** (`list_wants` tier filter, `changed_at` semantics, `get_or_create` branch, `resume_want`) in the spec before implementation.
8. **Infra and docs**:
   - Switch the image in three places, add the `models` stage export plus int8 quantize, set `EMBEDDINGS_ENABLED` in compose and `.env.example` (names only).
   - Update `architecture.md` and `tech-stack.md` and the runbook (pg_dump, image switch, extension privilege, verifying that matcher contract 101 is reached).

---

## Next Steps

Invoke the gap-analyzer with this report and the high-level design/decision log. Resolve the open questions above (`list_wants` tier filter, `changed_at` + rename semantics, `get_or_create_product_by_name` embedding branch, `resume_want`, reconcile sweep as a startup pass or a scheduled job) before writing the specification.
