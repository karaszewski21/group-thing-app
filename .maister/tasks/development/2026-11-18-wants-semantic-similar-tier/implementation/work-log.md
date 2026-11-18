# Work Log

## 2026-11-18T11:52:08Z - Implementation Started

**Total Steps**: 89 (13 groups)
**Task Groups**: 1 DB contract, 2 Embeddings module, 3 Product writers, 4 Want writers, 5 Lifespan, 6 Read API, 7 Matcher statements, 8 Matcher request loop, 9 Frontend data, 10 Frontend UI, 11 Infra, 12 Docs, 13 Test review
**Waves (computed)**: W1 {1, 9} · W2 {2, 6, 10} · W3 {3, 4, 7} · W4 {5, 8, 11} · W5 {12, 13}
**Baseline (HEAD)**: 33 vitest + 2 backend stale failures, mypy 15, ruff 65. No commits.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

### Group 9: Frontend Data Layer
**From Implementation Plan**: frontend/data-fetching.md, frontend/components.md, testing/frontend-testing.md, global/minimal-implementation.md
**From INDEX.md**: global/commenting.md, global/coding-style.md
**Discovered During Execution**: none

## 2026-11-18T11:56:06Z - Group 9 Complete (wave 1)

**Steps**: 9.1 through 9.6 completed (9.6: tests and eslint pass; typecheck has 1 error at WantMatchesView.tsx:41 that Group 10 resolves by passing `similar`, on purpose, not hidden by an optional field)
**Tests**: 4 files, 66 passed (no new failures over the 33 baseline)
**Files Modified**: api/wants.ts, hooks/useWantMatches.ts, features/wanted/wantMatchesViewState.ts, test/fixtures/wants.ts, test/wantMatchesViewState.test.ts, test/useWantMatches.test.tsx, test/useWants.test.tsx, test/WantMatchesView.test.tsx
**Notes**: WantSimilarResponse {id,title,href,meta,reserved_by_me,proposed_by_me}; NO_SIMILAR stable; same query key; 7 new view-state rows.

### Group 1: Database Contract
**From Implementation Plan**: backend/migrations.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
**From INDEX.md**: project/architecture.md (runbook context), backend/time.md
**Discovered During Execution**: alembic env.py target_metadata None (constraint names kept); migrations.md no `::` in sa.text → CAST(:embedding AS halfvec)

## 2026-11-18T11:58:25Z - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.9 completed
**Tests**: 43 passed (6 new + 37 in test_wants_migration.py incl. 3 updated); ruff 65 = baseline, mypy 15 = baseline
**Files Modified**: alembic/versions/0100_pgvector.py (new), 0101_want_similar.py (new), app/wants/models.py, docker-compose.yml (postgres image line only), tests/conftest.py, src/matcher/tests/conftest.py, tests/test_want_similar_migration.py (new), tests/test_wants_migration.py
**Notes**: M1 addendum: a third broken test, test_migration0099_downgradeUpgrade_roundTrip (exact wants index set), gained ix_wants_similar_requested_at. Tests were written first but only first run after the implementation. similar_requested_at documented with a # comment to match its neighbour.

## 2026-11-18T11:58:25Z - Wave 1 resolved: groups 1, 9 complete

### Group 6: Backend Read API
**From Implementation Plan**: backend/security.md, backend/queries.md, backend/api.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: global/commenting.md
**Discovered During Execution**: none

## 2026-11-18T12:03:29Z - Group 6 Complete (wave 2)

**Steps**: 6.1 through 6.7 completed
**Tests**: 115 passed (6 new + 2 matrix + existing matches API); mypy 15 = baseline; ruff clean on touched files
**Files Modified**: app/wants/{schemas.py, application/reads.py, router/wants.py}, app/core/authorization_matrix.py (comment), tests/test_authorization_matrix.py, tests/test_wants_similar_api.py (new)
**Notes**: list_wants(matched_item_id) filters tier IN (MATCH, SUGGESTION). The "over both tiers" wording in the test_wants_matches_api.py docstring is now slightly imprecise (optional tweak).

### Group 2: Embeddings Module
**From Implementation Plan**: global/error-handling.md, global/minimal-implementation.md, global/commenting.md, backend/time.md, testing/backend-testing.md
**From INDEX.md**: backend/migrations.md + queries.md (CAST(:embedding AS halfvec)); moderation patterns (text_guard, onnx_models, test_text_guard)
**Discovered During Execution**: none

## 2026-11-18T12:03:51Z - Group 2 Complete (wave 2)

**Steps**: 2.1 through 2.9 completed
**Tests**: 23 passed, 1 skipped (the real-ONNX test skips because there is no /models/embed); mypy 15 = baseline; ruff clean
**Files Modified**: app/embeddings/{__init__,embedder,service,onnx_embedder}.py (new), app/config.py, tests/conftest.py (EMBEDDINGS_ENABLED=false, FakeEmbedder, fake_embedder fixture), tests/test_embeddings.py (new), tests/test_module_boundaries.py, tests/test_moderation_config.py
**HF_COMMIT_SHA (resolved 2026-11-18, public HF API, no auth)**: `bdeb29a43c3d58af1e6ed9d1836703a1ddfbe1d7`. EMBEDDING_MODEL_ID = "sdadas/mmlw-roberta-base@bdeb29a43c3d58af1e6ed9d1836703a1ddfbe1d7+int8". Use it in Groups 7 and 11.
**Notes**: _stuck holds the stuck future; set_embedder resets it and shuts down the old executor with cancel_futures. FakeEmbedder.model_id == EMBEDDING_MODEL_ID. Check the ONNX output name `last_hidden_state` in the Group 11 build.

### Group 10: Frontend UI
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md
**From INDEX.md**: global/coding-style.md, global/commenting.md
**Discovered During Execution**: none

## 2026-11-18T12:10:51Z - Group 10 Complete (wave 2)

**Steps**: 10.1 through 10.6 completed
**Tests**: 4 targeted files, 56 passed; typecheck 0 errors (Group 9's open error is fixed); eslint clean; full vitest 33 failed / 1868 passed = baseline
**Files Modified**: features/wanted/{reservedCaption.ts (new), SimilarCard.tsx (new), MatchCard.tsx, SuggestionCard.tsx, WantMatchesView.tsx}, test/reservedCaption.test.ts (new), test/WantMatchesView.test.tsx
**Visual**: all 5 design-context IDs ✓

## 2026-11-18T12:10:51Z - Wave 2 resolved: groups 2, 6, 10 complete

### Group 3: Product Vector Writers
**From Implementation Plan**: backend/queries.md, global/error-handling.md, backend/time.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: backend/migrations.md, global/commenting.md
**Discovered During Execution**: none

## 2026-11-18T12:19:07Z - Group 3 Complete (wave 3)

**Steps**: 3.1 through 3.7 completed
**Tests**: 9 new passed; regressions 53 + 62 passed. My files are clean; the mypy/ruff deltas come from the parallel Group 4
**Files Modified**: app/product/embeddings.py (new), app/product/service.py, tests/test_product_embeddings.py (new)
**Exports for G5**: app.product.embeddings.register(), reconcile_embeddings(db,*,limit=300)->ReconcileResult(filled,misses), EMBEDDINGS_REQUESTED, SUBJECT="product"
**Notes**: Busy detection reads the private app.embeddings.service._stuck. Follow-up: a public is_busy() in app/embeddings (out of scope). Tests were not run before the implementation (order deviation). _lock_product still uses FOR UPDATE (pre-existing, photo edits).

### Group 4: Want Vector Writers
**From Implementation Plan**: backend/models.md, backend/queries.md, backend/time.md, global/error-handling.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: —
**Discovered During Execution**: none

## 2026-11-18T12:21:10Z - Group 4 Complete (wave 3)

**Steps**: 4.1 through 4.8 completed
**Tests**: 39 passed (7 new plus the wants API, lifecycle, edit-concurrency, boundary and clock guards); ruff 65 and mypy 15, both equal to the baseline
**Files Modified**: app/wants/infrastructure/embeddings_acl.py (new), infrastructure/outbox_acl.py (+append), application/embeddings.py (new), application/writes.py, tests/test_wants_embeddings.py (new)
**Exports for G5**: app.wants.application.embeddings.register(), EVENT_TYPE, reconcile_embeddings(db,*,limit=300,now_factory)->ReconcileResult(filled,misses), handle_embeddings_requested
**Notes**: request_similar is a Core update on Want.__table__, so updated_at is not bumped. Reconcile locks FOR NO KEY UPDATE OF wants SKIP LOCKED (the table is unaliased). The embed runs after the stop-word, category and locality lookups and before the lock. embeddings_acl.is_busy() reads the private _stuck → Group 5 adds a public service.is_busy() and switches both callers over to it.

### Group 7: Matcher SIMILAR Statements
**From Implementation Plan**: backend/queries.md, global/error-handling.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: global/commenting.md
**Discovered During Execution**: none

## 2026-11-18T12:21:21Z - Group 7 Complete (wave 3)

**Steps**: 7.1 through 7.9 completed
**Tests**: full matcher suite 109 passed (baseline 99); ruff, format and strict mypy clean
**Files Modified**: matcher/{statements,window,db,rules}.py, tests/{test_similar.py (new), test_constants_drift.py, test_loop.py, conftest.py}
**EXPLAIN (7.7)**: FORWARD_SIMILAR, 20k listings with random halfvec(768), PG18 + pgvector 0.8.7. Execution 31.2–31.4 ms; p50 31.7 / p95 37.4 ms over 20 runs (target ≤150 ms). The vector restriction is pushed into the Seq Scan on product_embeddings (Rows Removed 19999). The want vector is an InitPlan evaluated once. Linear scan, so roughly 80–95 ms expected at 50k.
**Notes**: match_similar_forward(connection, want_id, *, now) -> list[StoredPair]. The visibility parity test (AST + normalise) is in test_constants_drift.py. test_window.py needed no change. Group 11 adds the Dockerfile drift assertion.

## 2026-11-18T12:21:21Z - Wave 3 resolved: groups 3, 4, 7 complete

### Group 5: Lifespan Wiring
**From Implementation Plan**: global/error-handling.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: backend/security.md (log booleans only), global/commenting.md
**Discovered During Execution**: none

## 2026-11-18T12:27:50Z - Group 5 Complete (wave 4)

**Steps**: 5.1 through 5.6, plus the extra public is_busy() step
**Tests**: 32 passed/1 skipped + 36 passed; ruff 65 / mypy 15 = baseline
**Files Modified**: app/main.py, app/embeddings/service.py (+is_busy), app/product/embeddings.py, app/wants/infrastructure/embeddings_acl.py, tests/test_wants_scan_removed.py (renamed + parametrized), tests/test_wants_embeddings.py (+2), tests/test_embeddings.py (+1)
**Notes**: _run_embedding_reconcile every 1 min, limit 300, always scheduled; log line "embedding reconcile: products= wants= misses= duration_ms=". A product reconcile failure ends the tick, and wants run on the next tick. The table check runs before the model load. Nothing reads _stuck outside the service any more.

## 2026-11-18T12:27:50Z - Group 8 PARTIAL (wave 4)
**Steps**: 8.1–8.5 done. 8.6 failed one test: FORWARD_SIMILAR has no lexical exclusion, so a SIMILAR-only run can store a lexical candidate as seen SIMILAR → lost bell.
**User decision**: "Fix: lexical exclusion". The follow-up subagent adds NOT(lexical MATCH/SUGGESTION) to the forward and window SIMILAR pairs in statements.py.
**Files Modified**: matcher/requests.py, tests/test_similar_requests.py (new, 5 tests)

### Group 11: Infra
**From Implementation Plan**: global/conventions.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
**From INDEX.md**: CLAUDE.md secrets rule
**Discovered During Execution**: none

## 2026-11-18T12:34:55Z - Group 11 Complete (wave 4)

**Steps**: 11.1 through 11.7 completed
**Tests**: matcher test_constants_drift 7 passed (2 new); ruff clean; docker compose config -q OK
**Files Modified**: src/backend/scripts/check_embed_parity.py (new), src/backend/Dockerfile, docker-compose.yml (EMBEDDINGS_ENABLED default false), .env.example, src/matcher/tests/test_constants_drift.py
**11.6 real build**: verified for the embed block only, in a scratch Dockerfile with the same base and pins. Parity was min cosine **0.9904** over 40 texts (gate 0.99), 2026-11-18. model.onnx is 241 MB and model_id.txt equals EMBEDDING_MODEL_ID.
**Deviations**:
- optimum-cli 0.1.0 rejects --revision, so the block uses snapshot_download first.
- quantize_dynamic uses QInt8 with op_types_to_quantize=['MatMul'], because plain QInt8 gave 0.9895 (gate failed) and per_channel gave 0.6304.
**Open**: the full-image `docker compose build backend` needs the hf_token secret and is NOT run. The parity margin is thin (+0.0004), so an onnxruntime version change could tip the gate.
**Suggested standard**: every int8 quantization step must be followed by a parity gate in the same RUN.

### Group 8: Matcher Request Loop
**From Implementation Plan**: backend/queries.md, global/error-handling.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: global/commenting.md
**Discovered During Execution**: SIMILAR must never take a lexical candidate (cross-group defect in statements.py)

## 2026-11-18T12:37:40Z - Group 8 Complete (wave 4, after fix)

**Fix**: statements.py: `_lexically_claimed()` (text candidate, then per-word MATCH/SUGGESTION check) is applied as NOT in the forward and window SIMILAR. Forward binds $6/$7, window $7/$8 (lexical constants). A capped-out lexical candidate is not shown as SIMILAR either. +2 tests in test_similar.py.
**Tests**: full matcher suite 118 passed; ruff, format and mypy strict clean
**EXPLAIN after**: forward SIMILAR on 20k is ~32–38 ms p95 (noise-level change); synthetic worst case (all 20k within distance) went 144 → 334 ms
**Files Modified**: matcher/requests.py, matcher/statements.py, tests/test_similar_requests.py (new), tests/test_similar.py

## 2026-11-18T12:37:40Z - Wave 4 resolved: groups 5, 8, 11 complete

### Group 12: Documentation and Runbook
**From Implementation Plan**: global/conventions.md
**From INDEX.md**: CLAUDE.md secrets rule, INDEX single-paragraph style
**Discovered During Execution**: none

## 2026-11-18T12:46:08Z - Group 12 Complete (wave 5)
**Files Modified**: .maister/docs/project/architecture.md (new sections: semantic-tier DB contract, Name vectors, the 0100–0101 deploy/rollback runbook; stale phrases fixed), tech-stack.md (pgvector image, extensions/models table), INDEX.md
**Grep check**: no "no revision 0100" left; postgres:18 only as the intended rollback target; the model id carries the resolved SHA
**Notes**: standards/testing/backend-testing.md:6 still says postgres:18 → /maister:standards-update follow-up (together with the side-table carve-out and the suggested parity-gate standard). An untracked **0102_ledger_entries_on_inventories.py** (down_revision 0101, created 13:22, NOT by this workflow) now chains after 0101, and the runbook mentions it. Its release order needs a user decision.

### Group 13: Test Review
## 2026-11-18T12:46:08Z - Group 13 Complete (wave 5)
**Tests Added (7)**: want edit-miss → outbox → handler chain; embeddings-disabled freeze for wants and products (2); product rename via PUT moves changed_at; matcher want without a vector; gate at 0101 without product_embeddings; frontend empty similar in activeEmpty/matching/matchingSlow
**Results**: backend 199 passed / 1 skipped; matcher 120 passed; frontend 75 passed; typecheck clean; ruff clean on touched files
**Notes**: no production defects. mypy on tests/test_wants_embeddings.py has 2 attr-defined errors (main.outbox_scheduler, main.product_embeddings) from Group 4/5 code; app mypy is still 15.

## 2026-11-18T12:46:08Z - Wave 5 resolved: groups 12, 13 complete. All 13 groups done.

## 2026-11-18T13:31:17Z - Implementation Complete

**Total Steps**: 89 completed (13 groups, 5 waves, plus 1 follow-up fix in Group 8)
**Test Suite**: passed against the baseline. Backend 1562 passed / 2 failed (both baseline) / 1 skipped; matcher 120 passed; frontend 1869 passed / 33 failed (identical baseline ids); typecheck 0; ruff 65; mypy 15; lint 38 = baseline. See implementation/full-suite-results.md.
**Caveat**: a first backend run done in parallel with other suites gave 52 flaky failures. They came from an unchecked `alembic upgrade head` in a finally block of test_event_reservations_migration.py / test_personal_pickup_migration.py, both edited by the parallel 0102 change. The clean rerun matches the baseline.
**Open items**: the full-image docker build (needs hf_token) is not run; the parity margin is thin (0.9904); 0102 release order; standards-update follow-up.

## 2026-11-18T14:19:13Z - Verification fixes (Phase 11, cycle 1)
User chose "Fix all fixable issues" and "W1: upgrade in place". W13 deferred.
- **W1 + W7 (matcher)**: lexical statements skip only lexical rows in the stored check and use ON CONFLICT … DO UPDATE … WHERE tier='SIMILAR' (window MATCH upgrade is born unseen and rings its bell). Fixed parameter prefix $1–$5, SIMILAR adds $6/$7, window end last; typed _store. +3 tests; matcher 123 passed; EXPLAIN p95 33–38 ms.
- **W2 (frontend)**: getWantSimilar(...).catch(() => NO_SIMILAR); +3 tests; 56 passed; typecheck 0.
- **W4, W5, W6, W8, I1, I3, I4, I5, P-L1..L4 (backend)**:
  - lock-free embed then lock/re-check/upsert;
  - RECONCILE_EMBED_BATCH=8;
  - per-side try (_reconcile_side);
  - modules aligned;
  - now after embed;
  - non-finite → miss;
  - always-on 0101 check (_check_similar_schema);
  - TRANSACTION_CONFLICTS → app/db.py;
  - get_embedder removed.
  Results: 119 passed / 1 skipped; ruff 65; mypy 15.
- **W3, W9–W11, W14–W17, S1 (infra/docs)**:
  - models stage pins (optimum 2.1.0, onnxruntime 1.32.0, onnx 1.23.2, transformers 4.57.6, tokenizers 0.22.2, numpy 2.5.5, huggingface_hub 0.36.2) plus model.sha256. Embed block rebuilt twice: parity 0.9904, hash 4552576b…1e08 (deterministic).
  - Runbook: re-flag after matcher deploy and after model change, 0102 refs removed, flag flip in two steps, 1b VPS A measurement, OS/collation checks, web freeze.
  - W1 behaviour documented.
  - spec R13 amended; .env.example comment.
- **Orchestrator touch-ups**: architecture.md:347 batch size and per-side reconcile wording; spec R12 batch 8.

### Group 13: Test Review (standards log, added during re-verification)
**From Implementation Plan**: testing/backend-testing.md, testing/frontend-testing.md
**From INDEX.md**: —
**Discovered During Execution**: none

## 2026-11-18T15:48:04Z - Verification fixes (Phase 11, cycle 2)
User chose "Fix all fixable issues" and moved the release gate to "before step 8 (web)".
- **Backend**:
  - N1: flush before save_name_vector, with a statement-order test.
  - CR-N4: RECONCILE_EMBED_TIMEOUT_SECONDS 2.0.
  - CR-N7: expiry re-checked under the lock and in request_similar.
  - Shared ReconcileResult in app.embeddings.service (Protocol removed).
  - TS-1 was already satisfied.
  - Tests: 80 passed / 1 skipped. Ruff 65, mypy 15.
- **Matcher**:
  - CR-N3: SUGGESTION-unchanged test plus a deterministic two-connection race test for the WHERE guard (mutation-checked).
  - R1: frozen Statement(sql, similar).
  - L5: duplicated parity names removed.
  - Tests: 125 passed. Ruff, format and mypy clean.
- **Frontend**: CR-N5 keeps the previous `similar` on a /similar failure (getQueryData). 31 passed, typecheck 0.
- **Docs**:
  - Gate rescoped to before step 8, with owner sign-off.
  - 7b sweep and 7c threshold change (delete below new min, then re-flag).
  - pre-semantic image tags and the never-up rule between steps 1 and 4.2.
  - Rollback 3 re-flag.
  - Stale-pairs note.
  - Code facts.
  - Spec R11/R12/R13/R26 amended; ADR-002 note.

## 2026-11-18T17:23:01Z - Workflow finalized
All phases resolved (3 and 9 skipped, no defect). E2E GO 9/9; user guide written. Nothing committed. Summary: workflow-summary.md.
