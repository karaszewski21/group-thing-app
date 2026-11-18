# Implementation Plan: semantic SIMILAR tier for „Szukam” (wants)

## TL;DR
- 13 task groups and 89 steps, in the research rollout order: DB contract → embedder → writers/handlers/reconcile → lifespan → backend read → matcher → frontend → infra → docs → test review.
- Group 1 (migrations 0100/0101, models, pgvector test image) blocks almost everything. After it, the embedder (2), the read API (6) and the frontend data layer (9) can start in the same wave.
- Product writers (3), want writers (4) and the matcher statements (7) follow the embedder. Lifespan wiring (5) waits for 3+4, the request loop (8) for 7, infra (11) for 2+7, docs (12) for all.
- `<HF_COMMIT_SHA>` is resolved once in Group 2 (step 2.2) and reused by Groups 7 and 11. The real Docker `models` stage build is a separate, out-of-band verification step (11.6). Unit tests use `FakeEmbedder` only.
- No commits are planned. Verification compares against the HEAD baseline (33 vitest failures, 2 stale backend tests, mypy 15, ruff 65), not against zero.

## Key Decisions
- **13 groups instead of the usual 5–6.** The spec covers three code bases (backend, matcher, frontend) plus infra and docs. Splitting along the spec's test groups (1, 2, 3, 4, 5, 5b, 6, 7) keeps every group at 2–8 tests and lets independent layers run in parallel. The expected total (~64 plus up to 10 gap tests) is above the generic 16–34 range, because the spec itself names ~60 tests.
- **`src/backend/tests/conftest.py` is split by concern.** Group 1 owns the image swap and the `seed_want_matches(tier=)` keyword, so the read API (Group 6) needs only Group 1. Group 2 owns `FakeEmbedder` + `fake_embedder` and the `EMBEDDINGS_ENABLED=false` env line. Both groups declare the file, so the executor runs them one after the other.
- **`app/main.py` changes are a separate lifespan group (5).** The product (3) and want (4) groups then do not both edit `main.py`, and they can run in parallel. Group 5 registers both handlers, schedules the reconcile job and adds the table check and the model load.
- **The matcher is split in two.** Group 7 covers the statements, window counts, gate and constants (spec test group 5). Group 8 covers the two-kind request loop (R26, spec test group 5b), which needs `match_similar_forward` from Group 7.
- **Group 7 depends on Group 2**, because `rules.EMBEDDING_MODEL_ID` and its AST drift assertion need the backend constant with the resolved SHA. The Dockerfile part of the drift test is added in Group 11, which owns the Dockerfile.
- **The frontend data layer (9) has no dependency.** The `/similar` contract is fixed by R16/R19, so the frontend is built against the mocked API while the backend groups run.
- **The `HF_COMMIT_SHA` lookup happens once (step 2.2)**, with a generic client and no user details. All three places reuse the same value from the work-log.
- **Docs are a group with no tests.** Their check is a grep step (no stale "no revision 0100" phrase, both image references updated). This is the only group that breaks the tests-first pattern, because it writes no code.

## Open Questions / Risks
- **Network for the SHA.** If the HF API cannot be reached in step 2.2, the implementer must stop and flag it. The placeholder must not be committed into the three constants, and the drift test would still pass on a placeholder, so this risk is not caught by tests.
- **pgvector testcontainer pull.** Both suites need `pgvector/pgvector:0.8.7-pg18-trixie` locally. The first run of Group 1 tests pulls it. With no Docker or no network, every backend and matcher group is blocked.
- **The real Docker `models` stage (11.6) may be slow or network-bound** (a model download, an fp32 export and int8 quantization). It is a separate verification step and does not gate group completion. The parity gate (≥ 0.99) and `model_id.txt` are proven only there.
- **Forward SIMILAR planner shape (R13).** Step 7.7 records `EXPLAIN (ANALYZE)` in the work-log. If the vector restriction does not reach the view's embedding join (no InitPlan form), the forward p95 target of 150 ms is at risk, and that needs a design discussion, not a workaround.
- **Contended shared files:** `src/backend/tests/conftest.py` (Groups 1, 2), `src/backend/tests/test_wants_embeddings.py` (4, 5), `src/matcher/tests/test_constants_drift.py` (7, 11), `docker-compose.yml` (1, 11), `src/frontend/src/test/WantMatchesView.test.tsx` and `useWants.test.tsx` (9, 10). Each pair is already ordered by dependencies.
- **Lock-waiting handler test (4.1).** It needs two sessions and a real lock wait. It may be flaky on slow machines. Use a bounded `asyncio.wait_for` and release the lock from the test, never a sleep.

## Overview
Total Steps: 89
Task Groups: 13 (12 implementation/infra/docs + Test Review & Gap Analysis)
Expected Tests: ~64 new focused tests in Groups 1–11 (plus ~6 updated existing tests), and at most 10 gap tests in Group 13 (≈ 64–74 total)

## Implementation Steps

### Task Group 1: Database Contract (migrations 0100/0101, models, pgvector image)
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0100_pgvector.py`, `src/backend/alembic/versions/0101_want_similar.py`, `src/backend/app/wants/models.py`, `docker-compose.yml`, `src/backend/tests/conftest.py`, `src/matcher/tests/conftest.py`, `src/backend/tests/test_want_similar_migration.py`, `src/backend/tests/test_wants_migration.py`
**Estimated Steps:** 9

- [x] 1.0 Complete the database contract layer
  - [x] 1.1 Write 6 focused tests in `src/backend/tests/test_want_similar_migration.py` (spec test group 1)
    - At head: `vector` 0.8.7 is installed, both side tables and `wants.similar_requested_at` exist, and the `matchable_listings` columns end with `changed_at, embedding, model_id`
    - A listing without a vector is still in the view (NULL `embedding`)
    - A product vector with a later `updated_at` moves `changed_at`
    - The CHECK accepts SIMILAR with NULL `missing_words` and refuses SIMILAR with words
    - Setting `similar_requested_at` NOTIFYs `wants_changed` with the want id (LISTEN on a raw asyncpg connection), and clearing it does not
    - Downgrade to 0099 deletes SIMILAR rows, restores the 0099 view column list and CHECK texts, and drops the trigger, index, column, tables and extension. `alembic upgrade head` + `engine.dispose()` run in `finally`
  - [x] 1.2 Switch the DB image to `pgvector/pgvector:0.8.7-pg18-trixie` (R6) in `docker-compose.yml` (postgres service only, same volume `/var/lib/postgresql`), `src/backend/tests/conftest.py` and `src/matcher/tests/conftest.py`
  - [x] 1.3 Write `0100_pgvector.py` (R1), modelled on `0086_pg_trgm.py`
    - `CREATE EXTENSION IF NOT EXISTS vector` / `DROP EXTENSION IF EXISTS vector`
    - Docstring: superuser needed, the `rolsuper` check, the `pg_extension` ownership check before going below 0100, and that 0101's downgrade drops the dependent columns first
  - [x] 1.4 Write the `0101_want_similar.py` upgrade (R2–R4) under `SET LOCAL lock_timeout = '5s'`
    - Raw DDL for `product_embeddings` / `want_embeddings` (`<owner>_id uuid` PK, `model_id varchar(200) NOT NULL`, `embedding halfvec(768) NOT NULL`, `updated_at timestamp NOT NULL`), with `pk_…` and `fk_…_products` / `fk_…_wants` ON DELETE CASCADE, and no vector index (ADR-008)
    - `wants.similar_requested_at timestamp NULL` (no backfill), `ix_wants_similar_requested_at` partial `WHERE similar_requested_at IS NOT NULL`
    - `trg_wants_similar_requested AFTER UPDATE OF similar_requested_at … WHEN (NEW.similar_requested_at IS NOT NULL) EXECUTE FUNCTION public.wants_notify_match_requested()` (reuse the 0099 function, no INSERT branch)
    - `CREATE OR REPLACE VIEW matchable_listings`: add `LEFT JOIN product_embeddings e ON e.product_id = pr.id`, `e.updated_at` as the last `greatest(…)` argument, and append `e.embedding AS embedding, e.model_id AS model_id` after `changed_at`. Every other column keeps its position and expression. Update the 0099-style comment on in-place renames
    - Replace `ck_want_matches_tier` (adds `'SIMILAR'`) and `ck_want_matches_missing_words` ("(MATCH or SIMILAR) and NULL, or SUGGESTION and non-empty")
    - Reuse: `0099_wants.py::MATCHABLE_LISTINGS` and the CHECK texts as the base
  - [x] 1.5 Write the 0101 downgrade (R5), also under `SET LOCAL lock_timeout = '5s'`
    - `DELETE FROM want_matches WHERE tier = 'SIMILAR'`, restore both 0099 CHECKs
    - `DROP VIEW matchable_listings` and recreate it from a **verbatim copy** of the 0099 `MATCHABLE_LISTINGS` SQL kept inside 0101 (never import it from 0099)
    - Drop the trigger, then the index, then the column, then `want_embeddings`, then `product_embeddings`
  - [x] 1.6 Mirror the model changes in `app/wants/models.py` (R4)
    - `WantMatchTier.SIMILAR` (string-backed; docstring: embedding-related, born seen, never a bell)
    - Both CHECK texts in `WantMatch.__table_args__`
    - `Want.similar_requested_at: Mapped[datetime | None]` next to `match_requested_at`, with a docstring: background SIMILAR-only re-run, set only by Core `update()`
  - [x] 1.7 Extend `seed_want_matches` in `src/backend/tests/conftest.py` with the keyword `tier: WantMatchTier | None = None`
    - A given `tier` overrides the inference, and `tier=SIMILAR` requires `missing_words=None`
    - Omitted, today's inference stays, so existing callers do not change
  - [x] 1.8 Fix the two existing tests that break (M1) in `src/backend/tests/test_wants_migration.py`
    - `test_contractFunctions_bodies_immutableAndPublicQualified` (:295-316): the exact column list gains `embedding, model_id` after `changed_at`
    - `test_migration0099_downgradeFromOldShape_succeeds` (:224-248): run `alembic downgrade 0099` before applying `OLD_SHAPE`, then `downgrade 0098`, and `upgrade head` + `engine.dispose()` in `finally`
  - [x] 1.9 Ensure the database-contract tests pass
    - From `src/backend`: `uv run python -m pytest tests/test_want_similar_migration.py tests/test_wants_migration.py`
    - Do NOT run the entire suite

**Acceptance Criteria:**
- The 6 new tests and the 2 updated tests pass on the pgvector testcontainer
- `alembic upgrade head` → `downgrade 0099` → `upgrade head` is clean
- 0101 keeps every 0099 view column in place and only appends `embedding`, `model_id`
- `ruff`/`mypy` on the touched files add no findings over the baseline (ruff 65, mypy 15)

---

### Task Group 2: Embeddings Module (`app/embeddings`, settings, FakeEmbedder)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/embeddings/__init__.py`, `src/backend/app/embeddings/embedder.py`, `src/backend/app/embeddings/service.py`, `src/backend/app/embeddings/onnx_embedder.py`, `src/backend/app/config.py`, `src/backend/tests/conftest.py`, `src/backend/tests/test_embeddings.py`, `src/backend/tests/test_module_boundaries.py`, `src/backend/tests/test_moderation_config.py`
**Estimated Steps:** 9

**Secrets rule (configuration touched):** never print secret values. No `env`, `printenv`, `cat .env` or settings dumps; check presence only. No `HF_TOKEN` is needed or read for the public embed model.

- [x] 2.0 Complete the embeddings module
  - [x] 2.1 Write 8 focused tests in `src/backend/tests/test_embeddings.py` (spec test group 2), plus the side assertions
    - The disabled path returns None without calling the embedder
    - `embed_queries` prefixes `zapytanie: `, and `embed_listings` sends the names unchanged
    - A timeout returns None with one WARNING that does not contain the text
    - While a timed-out call still runs (`FakeEmbedder` `delay` mode blocked on a `threading.Event`), the next call returns None (`busy`) at once without reaching the embedder. After the stuck call finishes, calls succeed again
    - An exception returns None
    - `vector_literal` round-trips through `CAST(:embedding AS halfvec)` in the DB (768 dims)
    - `read_model_id` refuses a mismatching or missing `model_id.txt`
    - A real-model test behind `pytest.importorskip` (and a missing model dir skip) gives unit-norm 768-d vectors, with a related pair above an unrelated pair
    - In `tests/test_module_boundaries.py`: `app.embeddings` imports only `app.config`, `app.core` and its own files
    - In `tests/test_moderation_config.py`: `embeddings_enabled is False` and `embeddings_model_dir == "/models/embed"` by default
  - [x] 2.2 Resolve `<HF_COMMIT_SHA>`
    - Query `https://huggingface.co/api/models/sdadas/mmlw-roberta-base` with a generic client (e.g. plain `curl -s`, no custom User-Agent, no token, no user or project details) and read the 40-hex `sha` field
    - Record the value and the lookup date in the work-log, so Groups 7 and 11 reuse it
    - If the network is unavailable or the field is not 40 hex characters, STOP and flag it to the orchestrator. Never fall back to `main`
  - [x] 2.3 Add the settings to `app/config.py`: `embeddings_enabled: bool = False` (`EMBEDDINGS_ENABLED`) and `embeddings_model_dir: str = "/models/embed"` (`EMBEDDINGS_MODEL_DIR`). Do not reuse `moderation_models_dir`
  - [x] 2.4 Write `app/embeddings/embedder.py`: the `Embedder` Protocol (`model_id: str`, synchronous batched `embed(texts) -> list[list[float]]` returning L2-normalised vectors)
  - [x] 2.5 Write `app/embeddings/service.py` (R7, no ML imports)
    - Constants `EMBEDDING_MODEL_ID = "sdadas/mmlw-roberta-base@<sha>+int8"`, `QUERY_PREFIX`, `EMBED_TIMEOUT_SECONDS = 2.0`, `RECONCILE_EMBED_TIMEOUT_SECONDS = 10.0`, `EMBEDDING_DIMENSIONS = 768`, `EMBEDDINGS_REQUESTED = "embeddings.requested"`
    - `set_embedder`/`get_embedder`/`is_enabled()`. `set_embedder` creates the single `ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")`, and `set_embedder(None)` shuts it down with `wait=False`
    - `embed_listings`/`embed_queries(names, *, timeout=…)`: submit to the own executor, `asyncio.wait_for(asyncio.wrap_future(future), timeout)`. On a timeout, cancel a not-started future, or set `_stuck` and clear it in the done-callback. While `_stuck` is set, return None (`busy`) at once
    - On any miss, return None with one WARNING naming the reason (`missing`/`busy`/`timeout`/`error`), never the text. Never raise 503
    - `vector_literal(vector)` (`[x1,…]`, 7 significant digits) and `read_model_id(model_dir)`
    - Reuse: the set/get and `wait_for` pattern from `app/moderation/text_guard.py`, but fail open
  - [x] 2.6 Write `app/embeddings/onnx_embedder.py` (`ml` group, imported lazily), modelled on `app/moderation/onnx_models.py`
    - `intra_op_num_threads = 1`, `CPUExecutionProvider`, `tokenizer.json` truncation at 512 with batch padding, int64 feeds, `token_type_ids` only when the model declares it
    - CLS pooling (token 0 of `last_hidden_state`) + L2 norm; `model_id` from `read_model_id`
  - [x] 2.7 Add `FakeEmbedder` and the `fake_embedder` fixture to `src/backend/tests/conftest.py`
    - A deterministic 768-d unit vector per text, an override map, a record of the texts received, `fail` and `delay` modes
    - The fixture monkeypatches `settings.embeddings_enabled = True`, calls `set_embedder`, and resets both
    - Add `os.environ["EMBEDDINGS_ENABLED"] = "false"` next to `MODERATION_TEXT_ENABLED` (R24)
  - [x] 2.8 Add short why-comments only (single worker, the stuck flag, fail open)
  - [x] 2.9 Ensure the embeddings tests pass
    - `uv run python -m pytest tests/test_embeddings.py tests/test_module_boundaries.py tests/test_moderation_config.py`
    - Do NOT run the entire suite

**Acceptance Criteria:**
- The 8 tests and the 2 side assertions pass (the real-model test may be skipped locally)
- `EMBEDDING_MODEL_ID` carries a real 40-hex SHA, recorded in the work-log
- No embed call ever raises, and no WARNING contains the embedded text
- `app.embeddings` imports nothing outside `app.config`/`app.core`

---

### Task Group 3: Product Vector Writers, Handler and Reconcile
**Dependencies:** 2
**Files to Modify:** `src/backend/app/product/service.py`, `src/backend/app/product/embeddings.py`, `src/backend/tests/test_product_embeddings.py`
**Estimated Steps:** 7

- [x] 3.0 Complete the product vector layer
  - [x] 3.1 Write 8 focused tests in `src/backend/tests/test_product_embeddings.py` (spec test group 3), using `fake_embedder`
    - Create stores a vector with the current model id
    - `get_or_create_product_by_name` of an existing product calls no embedder
    - An in-place rename re-embeds and moves `product_embeddings.updated_at`
    - A failing embedder commits the product without a vector and with exactly one `embeddings.requested` outbox row
    - A rename miss deletes the stale vector
    - The handler embeds the current name, and a deleted product is a no-op
    - Reconcile fills missing and stale-model vectors up to `limit`, newest first
    - A batch that times out is skipped for the rest of the tick, the next batch is still filled, and the tick line counts `misses`
    - Outbox dispatch with a failing fake passes `event_types=["embeddings.requested"]`
  - [x] 3.2 Write the vector store in `app/product/embeddings.py`: `upsert_vector`, `delete_vector` and `stage_retry` in `sa.text`, binding `CAST(:embedding AS halfvec)` (never `::` in `sa.text`)
  - [x] 3.3 Wire the writers in `app/product/service.py` (R9)
    - `create_product`: after the `check_text` calls, `embed_listings([name])`, flush, then upsert or (when enabled) stage `{"subject": "product", "id": …}`, in one commit
    - `get_or_create_product_by_name`: the same on the create branch only
    - `update_product`: only when `data.name != product.name`. Upsert on success, or delete the stored vector and stage the retry (staging only when enabled; a rename with embeddings off still deletes the vector)
    - Reuse: `app/outbox/service.append` as in `_stage_photo_files_delete`
  - [x] 3.4 Write the `embeddings.requested` product handler in `app/product/embeddings.py` (R11)
    - Ignore other subjects, run inside `db.begin_nested()`, return while `is_enabled()` is false
    - Re-read the name with plain `FOR NO KEY UPDATE` (wait, never SKIP LOCKED). Return only when the row is gone
    - Embed with `EMBED_TIMEOUT_SECONDS`, upsert, raise on a miss so the dispatcher retries
    - An idempotent `register()` like `bells_due.register`. It is called from the lifespan in Group 5
  - [x] 3.5 Write `reconcile_embeddings(db, *, limit=300)` in `app/product/embeddings.py` (R12)
    - Select rows with no vector or `model_id <> EMBEDDING_MODEL_ID`, newest first, `id <> ALL(:skipped)`, in sub-batches of `RECONCILE_EMBED_BATCH = 32`, `FOR NO KEY UPDATE OF p SKIP LOCKED`
    - One transaction per batch with its own `now = datetime.utcnow()`. Embed with `RECONCILE_EMBED_TIMEOUT_SECONDS`
    - A `timeout`/`error` miss rolls the batch back and adds its ids to the skip list. A `busy` miss ends the tick. Stop at `limit` rows attempted
    - Return the counts (filled, misses) for the tick log line written in Group 5
  - [x] 3.6 Check that no `FOR UPDATE` is used anywhere, so the item-insert KEY SHARE lock on `products` is never blocked
  - [x] 3.7 Ensure the product embedding tests pass
    - `uv run python -m pytest tests/test_product_embeddings.py` and the existing product tests that touch `create_product`/`update_product` (run only those files)

**Acceptance Criteria:**
- The 8 tests pass
- Product writes never fail because of the embedder
- A renamed product never keeps a vector of its old name

---

### Task Group 4: Want Vector Writers, Handler and Reconcile
**Dependencies:** 2
**Files to Modify:** `src/backend/app/wants/application/writes.py`, `src/backend/app/wants/application/embeddings.py`, `src/backend/app/wants/infrastructure/embeddings_acl.py`, `src/backend/app/wants/infrastructure/outbox_acl.py`, `src/backend/tests/test_wants_embeddings.py`
**Estimated Steps:** 8

- [x] 4.0 Complete the want vector layer
  - [x] 4.1 Write 7 focused tests in `src/backend/tests/test_wants_embeddings.py` (spec test group 4, without the lifespan test that Group 5 adds)
    - Create stores a vector embedded from `zapytanie: <name>` in the commit that sets `match_requested_at`, and resume calls no embedder
    - A name edit re-embeds, and a category-only edit does not
    - A miss saves the want with the flag set, no vector and one outbox row, and a name-edit miss deletes the old vector
    - The handler upserts and sets `similar_requested_at` (never `match_requested_at`) without changing `updated_at`, only for ACTIVE wants
    - The handler waits for a want locked `FOR NO KEY UPDATE` by a second session and writes the vector once it is released (bounded `asyncio.wait_for`, no sleeps)
    - Reconcile picks only ACTIVE, unexpired wants and sets `similar_requested_at` on them
    - Reconcile skips a want locked by another session without failing the tick
  - [x] 4.2 Write `app/wants/infrastructure/embeddings_acl.py`, the only `app.wants` importer of `app.embeddings` (re-export `embed_queries`, `is_enabled`, `vector_literal`, the constants). Add `append` to `outbox_acl.py`
  - [x] 4.3 Write the want vector store in `app/wants/application/embeddings.py` (`upsert_vector`, `delete_vector`, `stage_retry`, `request_similar(db, want_id, *, now)` as a Core `update()` of `similar_requested_at` for ACTIVE wants only, so `updated_at` is not bumped)
  - [x] 4.4 Wire the writers in `app/wants/application/writes.py` (R10)
    - `create_want`: `embed_queries([name])` after `_check_texts` and before any DB statement. After the flush, upsert or stage `{"subject": "want", "id": …}` in the commit that sets `match_requested_at`
    - `update_want`: on a name change, embed after `_check_texts` on the unlocked read. After the lock and the `updated_at` compare, upsert, or delete and (when enabled) stage, in the same transaction as the match delete. The 409 rule is unchanged
    - `resume_want`: no embedding
    - Take `now` as a keyword; never call `datetime.now()` (clock guard)
  - [x] 4.5 Write the `embeddings.requested` want handler (R11): the same rules as the product handler, plus return when the want is WITHDRAWN, then `request_similar` for ACTIVE wants. Idempotent `register()`
  - [x] 4.6 Write `reconcile_embeddings(db, *, limit=300, now_factory…)` for wants (R12): ACTIVE and unexpired only, `FOR NO KEY UPDATE OF w SKIP LOCKED` (LEFT JOIN to `want_embeddings`), per-batch `now`, the same miss and skip-list rules, and `request_similar` for each filled want
  - [x] 4.7 Keep the module boundaries green: `app/wants` code outside `infrastructure/` imports no `app.embeddings` (`tests/test_module_boundaries.py`, `tests/test_domain_clock_guard.py`)
  - [x] 4.8 Ensure the want embedding tests pass
    - `uv run python -m pytest tests/test_wants_embeddings.py tests/test_module_boundaries.py tests/test_domain_clock_guard.py` plus the existing wants write tests (only those files)

**Acceptance Criteria:**
- The 7 tests pass, and the existing wants write tests (incl. the 409 rule) still pass
- Background re-triggers set only `similar_requested_at`, never `match_requested_at`, and never bump `updated_at`
- Boundary and clock guards stay green

---

### Task Group 5: Lifespan Wiring (handlers, reconcile job, contract check, model load)
**Dependencies:** 3, 4
**Files to Modify:** `src/backend/app/main.py`, `src/backend/tests/test_wants_scan_removed.py`, `src/backend/tests/test_wants_embeddings.py`
**Estimated Steps:** 6

**Secrets rule (configuration touched):** never print secret values. Log only `EMBEDDINGS_ENABLED=%s`, never other settings.

- [x] 5.0 Complete the lifespan wiring
  - [x] 5.1 Write 2 tests
    - In `tests/test_wants_embeddings.py`: the lifespan with the flag on and the side tables missing refuses to start
    - In `tests/test_wants_scan_removed.py`: rename the test at :63 to `test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers`, expect the job list `[_run_term_end_scan, _run_media_sweep, _run_embedding_reconcile]` (:71), assert both `embeddings.requested` handlers are registered, and keep `not hasattr(main, "_run_want_scan")`
  - [x] 5.2 Add `_check_embeddings_tables` (`to_regclass` for both tables, log once and raise), modelled on `_check_wants_contract`, run only when `EMBEDDINGS_ENABLED`
  - [x] 5.3 When enabled, load `OnnxEmbedder(Path(settings.embeddings_model_dir))` with a lazy import; a load or model-id error aborts startup. Call `set_embedder(None)` at shutdown. Log `EMBEDDINGS_ENABLED=%s` next to the moderation flags
  - [x] 5.4 Register both handlers (product and want) next to `bells_due.register`
  - [x] 5.5 Add `_run_embedding_reconcile` as an APScheduler interval job (`_EMBEDDING_RECONCILE_INTERVAL_MINUTES = 1`, the existing `job_defaults`, always scheduled)
    - Return at once while no embedder is set; otherwise run the product, then the want reconcile (limit 300 each)
    - One line per tick: `embedding reconcile: products=%d wants=%d misses=%d duration_ms=%d`, INFO when it did work or missed, DEBUG otherwise
    - A deadlock (`40P01`) or serialization failure (`40001`) is one WARNING. Any other error is logged once with its traceback and not re-raised
  - [x] 5.6 Ensure the lifespan tests pass
    - `uv run python -m pytest tests/test_wants_scan_removed.py tests/test_wants_embeddings.py`

**Acceptance Criteria:**
- The 2 tests pass, and the job list is the same with the flag on and off
- The backend refuses to start with the flag on and the tables missing
- The reconcile job never re-raises

---

### Task Group 6: Backend Read API (`GET /api/wants/{id}/similar`, counts, matrix)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/wants/application/reads.py`, `src/backend/app/wants/router/wants.py`, `src/backend/app/wants/schemas.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_wants_similar_api.py`
**Estimated Steps:** 7

- [x] 6.0 Complete the read API
  - [x] 6.1 Write 6 tests in `src/backend/tests/test_wants_similar_api.py` (spec test group 6), seeding with `seed_want_matches(tier=WantMatchTier.SIMILAR)`
    - The exact key set `{id, title, href, meta, reserved_by_me, proposed_by_me}`, with no vector or score
    - At most 10 results, ordered by score desc then item id, with a constant `count_queries`
    - A foreign or withdrawn want returns 404
    - A hidden PRIVATE item is omitted
    - SIMILAR rows change neither `match_count` nor `new_match_count`
    - `GET /api/wants?matched_item_id=` excludes a want that holds the item only as SIMILAR
  - [x] 6.2 Add 2 matrix tests in `tests/test_authorization_matrix.py`: the row `("GET", "/api/wants/42/similar", ("READ",))` and an `mcp:read`-only refusal like the `/suggestions` test
  - [x] 6.3 Add `WantSimilarResponse` to `app/wants/schemas.py` (the suggestion fields minus `missing_words`)
  - [x] 6.4 Add `SIMILAR_LIMIT = 10` and `reads.list_similar` = `_ensure_own_want` + `_cards_select(caller, want_id, WantMatchTier.SIMILAR)` ordered by `score DESC, item_id`, SQL `LIMIT`, then `_card_fields`
  - [x] 6.5 Add the route `GET /api/wants/{want_id}/similar` (`ReadPrincipal`) next to `/suggestions` in `router/wants.py`
  - [x] 6.6 Keep `_match_counts` MATCH-only. Add `WantMatch.tier IN (MATCH, SUGGESTION)` to `list_wants(matched_item_id)` and say so in its docstring. Update the comment of matrix rows 66–67 to list `/similar` (no new row)
  - [x] 6.7 Ensure the read API tests pass
    - `uv run python -m pytest tests/test_wants_similar_api.py tests/test_authorization_matrix.py` plus the existing wants read tests (only those files)

**Acceptance Criteria:**
- The 6 + 2 tests pass, and existing `/suggestions` and `/matches` tests are unchanged
- No response contains a vector or a score
- The statement count is constant in the number of rows

---

### Task Group 7: Matcher SIMILAR Statements, Window Counts and Gate
**Dependencies:** 1, 2
**Files to Modify:** `src/matcher/matcher/statements.py`, `src/matcher/matcher/window.py`, `src/matcher/matcher/db.py`, `src/matcher/matcher/rules.py`, `src/matcher/tests/conftest.py`, `src/matcher/tests/test_similar.py`, `src/matcher/tests/test_constants_drift.py`, `src/matcher/tests/test_loop.py`, `src/matcher/tests/test_window.py`
**Estimated Steps:** 9

- [x] 7.0 Complete the matcher SIMILAR tier
  - [x] 7.1 Write 8 tests in `src/matcher/tests/test_similar.py` (spec test group 5), with a helper that stores vectors through an asyncpg text bind cast to `halfvec`, built from `e1` and `cos θ·e1 + sin θ·e2`
    - Forward stores a SIMILAR row, born seen, score ≈ cosine, `missing_words` NULL, source FORWARD, and a pair just below 0.86 is not stored
    - A want vector with another model id yields no pair (forward and window)
    - A listing vector with another model id yields no pair (forward and window)
    - A lexical MATCH pair is never also SIMILAR
    - The cap of 10 holds across runs, and a non-matchable stored row frees its place
    - A PRIVATE listing outside shared groups is excluded
    - The window stores SIMILAR born seen, stages no `bells_due` row, and `WindowRun.similar` counts it while `suggestions` excludes it
    - `missing_contract` reports revision 100 and a missing `want_embeddings`
  - [x] 7.2 Update the drift and parity tests in `tests/test_constants_drift.py`
    - `rules.EMBEDDING_MODEL_ID` equals the backend `app/embeddings/service.py` constant (AST, not imported)
    - Visibility text parity: parse `src/backend/tests/test_wants_visibility_parity.py` with `ast`, take `CALL_SITE_RULE`, strip the `SELECT … WHERE l.item_id = ANY(:item_ids) AND ` prefix, replace `:seeker` with `w.seeker_party_id`, and compare whitespace-normalised with `statements._VISIBILITY`
  - [x] 7.3 Fix the existing test that breaks (M1): `tests/test_loop.py:176-207` becomes `test_waitForContract_waitsForTheRevisionTheViewAndTheTables` (after `'0099'`, set `'0100'` and assert not done; create stub `product_embeddings`, `want_embeddings` and `wants (id uuid, similar_requested_at timestamp)`, set `'0101'`, `wait_for(gate, timeout=5)`). Update `test_window.py` log-line assertions for `similar=` if they pin the field list. Add both tables to `_TRUNCATED` in `tests/conftest.py`
  - [x] 7.4 Add to `rules.py`: `SEMANTIC_SIMILARITY_MIN = 0.86`, `SEMANTIC_CAP = 10`, `EMBEDDING_MODEL_ID` (the SHA from the work-log, step 2.2), with a comment that the threshold is provisional and bound to the pinned tuple
  - [x] 7.5 Restructure `statements.py` (R13)
    - Extract the inline visibility block, unchanged in text, into `_VISIBILITY`
    - `_statement(window, tier)` with a tier-specific pairs body; lexical tiers unchanged
    - SIMILAR window: `JOIN want_embeddings we ON we.want_id = w.id AND we.model_id = $3::text`, candidate `CASE WHEN l.model_id = $3::text AND <narrowing> THEN (l.embedding <=> we.embedding) <= 1 - $4::float8 ELSE false END`
    - SIMILAR forward: the want vector as a scalar InitPlan in plain ANDs with `l.model_id = $3::text` (as `_FORWARD_TEXT`). Score `1 - distance`, `missing_words` NULL, `seen_at = $1`
    - Tier-generic `_LIMITS` (SUGGESTION and SIMILAR: `$5` minus stored rows of this tier still in `matchable_listings`). `_store` takes the per-tier `$3`/`$4` tuple
    - Add `FORWARD_SIMILAR`/`WINDOW_SIMILAR`. `match_forward` and `match_window` run MATCH → SUGGESTION → SIMILAR (`SEMANTIC_CAP`). Add `match_similar_forward(connection, want_id, *, now)` running `FORWARD_SIMILAR` alone
    - No tier-strategy abstraction; why-comments only (InitPlan, pinned `$3` on both sides)
  - [x] 7.6 Update `window.py` (R14): `_Match`/`WindowRun` count `matches`, `suggestions`, `similar` by `pair.tier`; `did_work` includes `similar`; the log line adds `similar=%d` after `suggestions=%d`; bells stay MATCH-only
  - [x] 7.7 Update `db.py` (R15): `CONTRACT_REVISION = 101` with a comment naming what 0101 brings, and `missing_contract` also requires `to_regclass` for `public.product_embeddings` and `public.want_embeddings`. Record `EXPLAIN (ANALYZE)` of `FORWARD_SIMILAR` on seeded data in the work-log (target: the vector restriction reaches the view's embedding join, forward ≤ 150 ms)
  - [x] 7.8 Run `uv run python -m ruff check` and `uv run python -m mypy` (strict) from `src/matcher` on the touched files
  - [x] 7.9 Ensure the matcher statement tests pass
    - From `src/matcher`: `uv run python -m pytest tests/test_similar.py tests/test_constants_drift.py tests/test_loop.py tests/test_window.py tests/test_suggestions.py`

**Acceptance Criteria:**
- The 8 new tests, the 2 drift/parity assertions and the updated loop/window tests pass
- Existing MATCH/SUGGESTION matcher tests are unchanged and pass
- Bells remain MATCH-only; SIMILAR overlap with lexical pairs is 0
- mypy strict and ruff are clean for `src/matcher`

---

### Task Group 8: Matcher Request Loop (two-kind claim, R26)
**Dependencies:** 7
**Files to Modify:** `src/matcher/matcher/requests.py`, `src/matcher/tests/test_similar_requests.py`
**Estimated Steps:** 6

- [x] 8.0 Complete the two-kind request loop
  - [x] 8.1 Write 5 tests in `src/matcher/tests/test_similar_requests.py` (spec test group 5b)
    - A background re-trigger (only `similar_requested_at`) on a want whose listing matches lexically and semantically stores only SIMILAR rows, no MATCH/SUGGESTION, no `wants.bells_due` row, and clears the flag. A following window run stores the MATCH pair **unseen** and stages its `wants.bells_due` row
    - A full forward run with both flags set (SIMILAR at or before the claim) stores MATCH and SIMILAR rows, both flags end NULL, `updated_at` unchanged
    - A full request is claimed before an older SIMILAR-only request
    - A failing SIMILAR-only run (a broken statement monkeypatched in) rolls back, keeps the flag and backs the want off for both kinds
    - A SIMILAR-only flag on an EXPIRED want is cleared without storing pairs
  - [x] 8.2 Replace `CLAIM` with the one-statement two-flag claim of R26 (`ORDER BY match_requested_at IS NULL, least(match_requested_at, similar_requested_at), id … FOR NO KEY UPDATE SKIP LOCKED`)
  - [x] 8.3 Full claim: `limit_transaction` + `match_forward`, then the combined compare-and-clear of both flags (`CASE WHEN … = $2`, `similar_requested_at <= $3::timestamp`)
  - [x] 8.4 SIMILAR-only claim: `limit_transaction` + `match_similar_forward` only, then `UPDATE … SET similar_requested_at = NULL WHERE id = $1 AND similar_requested_at = $2`. A non-ACTIVE want only clears the claimed flag(s). Neither clear touches `updated_at`
  - [x] 8.5 Keep `Backoff` keyed by want id for both kinds. The failure log line names the kind (`matching want … (similar only, failure n, retry after …)`)
  - [x] 8.6 Ensure the request-loop tests pass
    - `uv run python -m pytest tests/test_similar_requests.py` plus the existing request-loop test file(s); ruff and mypy strict on `requests.py`

**Acceptance Criteria:**
- The 5 tests pass, and the existing request-loop tests pass
- A SIMILAR-only run never stores a lexical pair
- Full requests are always claimed first

---

### Task Group 9: Frontend Data Layer (API client, hook, view state, fixtures)
**Dependencies:** None
**Files to Modify:** `src/frontend/src/api/wants.ts`, `src/frontend/src/hooks/useWantMatches.ts`, `src/frontend/src/features/wanted/wantMatchesViewState.ts`, `src/frontend/src/test/fixtures/wants.ts`, `src/frontend/src/test/wantMatchesViewState.test.ts`, `src/frontend/src/test/useWantMatches.test.tsx`, `src/frontend/src/test/useWants.test.tsx`, `src/frontend/src/test/WantMatchesView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html
  element: screen:want-detail-active-similar
  locator: `#mockup-content` (line 229), `.sec.similar` after `.sec.suggestions`, before `.actions`
  acceptance: the `active` view kind carries `similar`
- mockup: analysis/design-context/mockups/want-detail-no-matches-only-related-items.html
  element: screen:want-detail-empty-similar
  locator: `#mockup-content` (line 229), `.empty` followed by `.sec.similar`
  acceptance: the `activeEmpty` view kind carries `similar`, and an empty `similar` never turns `activeEmpty` into `active`
- mockup: analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html
  element: screen:want-detail-matching-similar
  locator: `#mockup-content` (line 229), `.status` + `.skel` followed by `.sec.similar`
  acceptance: the `matching` and `matchingSlow` view kinds carry `similar`, and the closed kinds (`expired`, `fulfilled`) do not
**Estimated Steps:** 6

- [x] 9.0 Complete the frontend data layer
  - [x] 9.1 Write 3 tests
    - `wantMatchesViewState.test.ts`: `it.each` rows showing that `matching`, `matchingSlow`, `active` and `activeEmpty` carry `similar` and the closed kinds do not
    - `useWantMatches.test.tsx`: the fourth fetch is called and returned, and an empty `similar` keeps a stable identity (`NO_SIMILAR`)
    - `useWants.test.tsx` route-list test (:225-250): `getWantSimilar("want-1")` hits `/wants/want-1/similar`
  - [x] 9.2 Add `WantSimilarResponse` (six fields) and `getWantSimilar(id)` (doc: "At most 10 related items, best first") to `api/wants.ts`
  - [x] 9.3 Add the fourth `Promise.all` entry to `useWantMatches`, `similar` in `WantWithMatches` and the result, and the module-level `NO_SIMILAR`. Keep the query key
  - [x] 9.4 Add `WantMatchesData.similar` and put `similar` on the four active kinds in `resolveWantMatchesView`. Update the doc comment ("Only active wants carry suggestions and related items")
  - [x] 9.5 Add a fully typed `makeWantSimilar` to `test/fixtures/wants.ts` (no casts), and `getWantSimilar` to every `vi.mock` factory of `api/wants` (`useWantMatches.test.tsx`, `useWants.test.tsx`, `WantMatchesView.test.tsx`)
  - [x] 9.6 Ensure the data-layer tests pass
    - From `src/frontend`: `npm run test -- wantMatchesViewState useWantMatches useWants`, `npm run typecheck` (0 errors, as the baseline)

**Acceptance Criteria:**
- The 3 tests pass, and the typecheck has 0 errors
- The query key and polling are unchanged
- The view state carries `similar` exactly on the four active kinds

---

### Task Group 10: Frontend UI („Powiązane rzeczy” section and card)
**Dependencies:** 9
**Files to Modify:** `src/frontend/src/features/wanted/WantMatchesView.tsx`, `src/frontend/src/features/wanted/SimilarCard.tsx`, `src/frontend/src/features/wanted/reservedCaption.ts`, `src/frontend/src/features/wanted/MatchCard.tsx`, `src/frontend/src/features/wanted/SuggestionCard.tsx`, `src/frontend/src/test/WantMatchesView.test.tsx`, `src/frontend/src/test/reservedCaption.test.ts`
**Visual References:**
- mockup: analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html
  element: screen:want-detail-active-similar
  locator: `#mockup-content` (line 229): `.grid.matches` → `.sec.suggestions` → `.sec.similar` → `.actions`; annotations at line 269
  acceptance: in `active`, the order is the MATCH grid („N pasujące rzeczy”) → „Może Cię zainteresuje” → „Powiązane rzeczy” → ActiveActions („Ważne jeszcze …”)
- mockup: analysis/design-context/mockups/want-detail-no-matches-only-related-items.html
  element: screen:want-detail-empty-similar
  locator: `#mockup-content` (line 229): `.empty` (EmptyCard) → `.sec.similar` → `.actions`
  acceptance: in `activeEmpty`, the EmptyCard „Jeszcze nic nie pasuje” stays and „Powiązane rzeczy” follows it; related items never replace the empty state and never count as matches
- mockup: analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html
  element: screen:want-detail-matching-similar
  locator: `#mockup-content` (line 229): `.status` (MatchingStatus) + `.skel` (SkeletonGrid) → `.sec.similar` → `.actions`
  acceptance: in `matching`, „Powiązane rzeczy” follows the SkeletonGrid (or the match list) and is rendered from stored rows; there is no EmptyCard
- mockup: analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html
  element: component:similar-section
  locator: `.sec.similar` (h2, `.lead`, `.grid`) in line 229
  acceptance: `<section aria-labelledby={useId()}>` with the SuggestionsSection classes `mt-5.5 border-t border-line pt-4`; `h2` = `<span aria-hidden="true">🔗</span> Powiązane rzeczy`; lead `p` = „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.”; `ul` `grid grid-cols-2 gap-3 sm:grid-cols-3`; rendered only when non-empty; absent on `expired`/`fulfilled`
- mockup: analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html
  element: component:similar-card
  locator: `.sec.similar .card.dashed` in line 229
  acceptance: `ItemCard` with `dashed`, no `footnote` (no „brakuje:”), no `marker` (never „nowe”), `reservation={null}`, `reservedCaption` from the shared helper („Zarezerwowane przez Ciebie” / „Twoja propozycja” / „Zarezerwowane”); a reserved tile is dimmed by ItemCard; opening the card calls `reportOpened` → `markWantMatchOpened`
**Estimated Steps:** 6

- [x] 10.0 Complete the „Powiązane rzeczy” UI
  - [x] 10.1 Write 5 tests
    - `reservedCaption.test.ts`: the three captions and `undefined`
    - `WantMatchesView.test.tsx`, `active`: the section follows „Może Cię zainteresuje” and precedes the actions (`compareDocumentPosition`)
    - `activeEmpty`: the section follows the EmptyCard; `matching`: after the SkeletonGrid or the match list
    - The section is absent when `similar` is empty and on `expired`/`fulfilled`
    - The card has a dashed border, no „brakuje:” and no „nowe”, and a click calls `markWantMatchOpened`
  - [x] 10.2 Extract `reservedCaption` from `MatchCard.tsx`/`SuggestionCard.tsx` into `features/wanted/reservedCaption.ts` and use it in both (no behaviour change)
  - [x] 10.3 Write `SimilarCard.tsx` as specified in `component:similar-card`, reusing `components/shared/ItemCard.tsx`
  - [x] 10.4 Add `SimilarSection` and the `similarSection(list)` helper to `WantMatchesView.tsx`, rendered directly after `suggestionsSection(...)` and before `ActiveActions` in the four active cases only. Reuse the `SuggestionsSection` structure. Keep the existing suggestions copy unchanged (ADR-006). Use existing Tailwind tokens, not the mockup CSS
  - [x] 10.5 Self-check each Visual References acceptance criterion against the three mockups (order, copy, classes, aria) and note the result in the work-log
  - [x] 10.6 Ensure the UI tests pass
    - `npm run test -- WantMatchesView reservedCaption`, `npm run typecheck`, `npm run lint` on the touched files; compare with the baseline (33 pre-existing vitest failures elsewhere)

**Acceptance Criteria:**
- The 5 tests pass, and the existing MatchCard/SuggestionCard tests are unchanged
- Every Visual References acceptance criterion above holds
- No new typecheck errors or lint findings

---

### Task Group 11: Infra (Docker models stage, parity script, compose, env)
**Dependencies:** 2, 7
**Files to Modify:** `src/backend/Dockerfile`, `src/backend/scripts/check_embed_parity.py`, `docker-compose.yml`, `.env.example`, `src/matcher/tests/test_constants_drift.py`
**Estimated Steps:** 7

**Secrets rule (configuration and infrastructure touched):** never print secret values. Do not run `env`, `printenv`, `docker compose exec <svc> env`, `docker inspect` (Env section) or `cat .env`; check presence only (e.g. `[ -n "$X" ] && echo set || echo missing`). `.env.example` holds names and placeholder defaults only. The embed `RUN` uses no `hf_token` mount, and nothing in the build logs or work-log contains a secret.

- [x] 11.0 Complete the infra layer
  - [x] 11.1 Write 2 tests
    - In `src/matcher/tests/test_constants_drift.py`: the Dockerfile `EMBED_MODEL@EMBED_REVISION+int8` (parsed from its ARGs) equals `rules.EMBEDDING_MODEL_ID`
    - A small test (matcher drift file or a backend sibling) that `scripts/check_embed_parity.py` holds exactly the 20 parity names of R23 and exits non-zero below 0.99 on two fake model dirs, or, if a fake ONNX is impractical, that its `min_cosine` function fails below 0.99 on given vectors
  - [x] 11.2 Write `src/backend/scripts/check_embed_parity.py` (R23): `onnxruntime` + `tokenizers` + `numpy` only, CLS + L2, listing and query (`zapytanie: `) forms, the 20 names, exit code 1 when the minimum cosine is < 0.99
  - [x] 11.3 Extend the Dockerfile `models` stage (R23)
    - `ARG EMBED_MODEL=sdadas/mmlw-roberta-base`, `ARG EMBED_REVISION=<sha from step 2.2>`, in a separate `RUN` with no `hf_token` mount
    - Export `--task feature-extraction` at the pinned revision into `/models/embed-fp32` (fall back to `huggingface_hub.snapshot_download(revision=…)` + local export if `optimum-cli` has no revision option), fetch `tokenizer.json`, `quantize_dynamic` (QInt8) into `/models/embed/model.onnx`
    - `COPY scripts/check_embed_parity.py /tmp/check_embed_parity.py` right before the `RUN`, run it, delete it. Write `${EMBED_MODEL}@${EMBED_REVISION}+int8` to `/models/embed/model_id.txt`, remove the fp32 dir and caches
    - In `runtime`: `COPY --from=models /models/embed /models/embed`
  - [x] 11.4 Compose: `EMBEDDINGS_ENABLED: ${EMBEDDINGS_ENABLED:-false}` on `backend` (the postgres image was changed in Group 1; `EMBEDDINGS_MODEL_DIR` keeps its default)
  - [x] 11.5 Root `.env.example`: `EMBEDDINGS_ENABLED=false` and `EMBEDDINGS_MODEL_DIR=/models/embed`, with a short comment (placeholders only)
  - [x] 11.6 **Out-of-band build verification (does not gate this group):** `docker compose build backend` builds the `models` stage, the parity gate passes (≥ 0.99), and `/models/embed/model_id.txt` equals `EMBEDDING_MODEL_ID`. Check `pip show onnxruntime tokenizers numpy` in the stage and pin any missing package. If the build is too slow or the network is unavailable, record "build not verified" in the work-log and flag it for the verification phase
  - [x] 11.7 Ensure the infra tests pass
    - From `src/matcher`: `uv run python -m pytest tests/test_constants_drift.py`; plus the parity-script test; `docker compose config -q` validates the compose file

**Acceptance Criteria:**
- The 2 tests pass; one model id across the backend, the Dockerfile and the matcher
- `docker compose config -q` succeeds
- 11.6 is either verified or explicitly flagged in the work-log

---

### Task Group 12: Documentation and Runbook
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 5

**Secrets rule:** never write secret values into docs; the runbook names settings only.

- [x] 12.0 Complete the documentation (R25; no automated tests, a grep check instead)
  - [x] 12.1 `architecture.md`: the DB contract (`embedding`, `model_id`, `e.updated_at` in `matchable_listings`), the side tables, `wants.similar_requested_at` + `trg_wants_similar_requested`, the SIMILAR tier, the matcher (gate 101, MATCH → SUGGESTION → SIMILAR, `similar=`, the two request kinds and their clear rules), the pgvector test image (~line 383), `/similar`, „Powiązane rzeczy”, `EMBEDDINGS_ENABLED`/`EMBEDDINGS_MODEL_DIR`, and the rewritten in-place rename known limit
  - [x] 12.2 `architecture.md`: replace "There is **no revision 0100**…" in the amended-0099 runbook with a pointer, and add the full "Deploy / rollback for the semantic tier (migrations 0100–0101)" runbook from the spec (release gate, steps 0b–8, rollback 1–4, future changes)
  - [x] 12.3 `tech-stack.md`: lines 53 and 114 → `pgvector/pgvector:0.8.7-pg18-trixie`; rows for pgvector 0.8.7 (`halfvec`, exact scan, no index) and `sdadas/mmlw-roberta-base` int8 ONNX (pinned revision, `/models/embed`); onnxruntime/tokenizers also serve the embedder; `onnxruntime.quantization` runs in the `models` stage only
  - [x] 12.4 `INDEX.md`: update the Architecture and Tech Stack summaries; replace "no revision 0100" with "0100–0101 add the semantic SIMILAR tier (own runbook)"; mention the pgvector image
  - [x] 12.5 Verify with a grep: no "no revision 0100" left in `.maister/docs/`, no `postgres:18` test-image reference left where the pgvector image now applies, and the resolved SHA (not a placeholder) wherever the model id appears

**Acceptance Criteria:**
- All R25 points are covered
- The grep check in 12.5 is clean
- The standards follow-up (`/maister:standards-update` for the side-table carve-out) is noted for shipping, not done here

---

### Task Group 13: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
**Files to Modify:** `src/backend/tests/test_want_similar_migration.py`, `src/backend/tests/test_embeddings.py`, `src/backend/tests/test_product_embeddings.py`, `src/backend/tests/test_wants_embeddings.py`, `src/backend/tests/test_wants_similar_api.py`, `src/matcher/tests/test_similar.py`, `src/matcher/tests/test_similar_requests.py`, `src/frontend/src/test/WantMatchesView.test.tsx`

- [x] 13.0 Review and fill critical gaps
  - [x] 13.1 Review the ~64 tests from Groups 1–11 against the spec's 8 test groups and the Success Criteria (lexical behaviour unchanged, writes never fail, visibility, contract safety, UI)
  - [x] 13.2 Analyse gaps for THIS feature only (e.g. a stuck-worker `busy` miss ending a reconcile tick, the matcher gate at exactly 101 with one table missing, `EMBEDDINGS_ENABLED=false` freezing writes while SIMILAR rows stay readable)
  - [x] 13.3 Write up to 10 additional strategic tests
  - [x] 13.4 Run the feature-specific tests only: the new and updated backend, matcher and frontend test files of this plan. Compare with the baseline (33 vitest and 2 backend stale failures, mypy 15, ruff 65); report any new failure as a regression

**Acceptance Criteria:**
- All feature tests pass (~64–74 total)
- No more than 10 additional tests added
- No regression over the HEAD baseline

## Execution Order

1. Group 1: Database Contract (9 steps)
2. Group 2: Embeddings Module (9 steps, depends on 1)
3. Group 6: Backend Read API (7 steps, depends on 1)
4. Group 9: Frontend Data Layer (6 steps, no dependencies)
5. Group 3: Product Vector Writers (7 steps, depends on 2)
6. Group 4: Want Vector Writers (8 steps, depends on 2)
7. Group 7: Matcher SIMILAR Statements (9 steps, depends on 1, 2)
8. Group 10: Frontend UI (6 steps, depends on 9)
9. Group 5: Lifespan Wiring (6 steps, depends on 3, 4)
10. Group 8: Matcher Request Loop (6 steps, depends on 7)
11. Group 11: Infra (7 steps, depends on 2, 7)
12. Group 12: Documentation and Runbook (5 steps, depends on 1–11)
13. Group 13: Test Review & Gap Analysis (4 steps, depends on 1–11)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/`: error-handling (fail open in user writes, one WARNING for deadlocks in the job, no re-raise), minimal-implementation (no tier abstraction, no vector index, no pgvector Python package), commenting (why-comments only), conventions
- `backend/`: migrations (`SET LOCAL lock_timeout`, explicit names, additive column, exact-reverse downgrade, downgrade-then-upgrade test; approved side-table PK carve-out), models (string enum, mirrored CHECKs, ACL for cross-module access), queries (bound parameters, `CAST(:embedding AS halfvec)`, SQL `LIMIT`, no N+1), security (matrix rows 66–67, no vectors in responses), time (naive UTC, clock guard)
- `frontend/`: components (pure `resolveWantMatchesView`), accessibility (`aria-labelledby`, `aria-hidden` emoji, Polish copy), data-fetching (same key, stable `NO_SIMILAR`)
- `testing/`: backend-testing (testcontainers, exact key sets, `count_queries`, naming), frontend-testing (explicit vitest imports, typed fixtures, `vi.mock` factories)
- Project rules: never print secrets; no commits (leave the work uncommitted)

## Notes

- Test-Driven: Each group starts with its tests (Group 12 uses a grep check)
- Run Incrementally: Only the new and updated tests after each group
- Mark Progress: Check off steps as completed
- Reuse First: the SUGGESTION tier is the template on every layer
- Commands: backend and matcher `uv run python -m pytest|mypy|ruff` from `src/backend` / `src/matcher`; frontend `npm run test|typecheck|lint` from `src/frontend`
- Docker with the pgvector image is required for every backend and matcher test group
