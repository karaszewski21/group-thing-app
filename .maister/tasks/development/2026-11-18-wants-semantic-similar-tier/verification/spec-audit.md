# Spec audit: semantic SIMILAR tier for „Szukam” (pre-implementation)

## TL;DR
- **Verdict: pass-with-concerns** (⚠️ Mostly Compliant). The spec covers every requirement. Its concrete code claims mostly check out against the repo. One design hole and several unlisted test breakages need fixing before implementation.
- **Counts:** Critical 0 · High 1 · Medium 6 · Low 11.
- **High:** background re-triggers (the outbox handler, the reconcile backfill, a model change) run the matcher's *forward* path. Forward stores lexical MATCH pairs **born seen**, so the window never rings their bells. This contradicts "bells and counts unchanged" (Success Criterion 1).
- **Medium:**
  - three existing tests break and are not listed;
  - the handler lock is specified two different ways;
  - the forward SIMILAR statement does not check the listing's `model_id`;
  - the parity script is not copied into the Docker `models` stage;
  - 0101's 5 s `lock_timeout` can fail while the old matcher keeps running;
  - an embed that times out keeps burning CPU, because the thread is never cancelled.

## Key Decisions
- **H1 is rated High, not Critical.** It loses bells (and lowers `new_match_count`) but corrupts no data. The pairs are still stored and visible on `/wanted/[id]`. The loss is largest during the one-off backfill and on a model change.
- **The 0101 lock risk (M5) is rated Medium.** A failed `alembic upgrade head` rolls back cleanly, but the backend container (no `restart:` policy) stays down until someone retries.
- **The rollback claims are confirmed:**
  - Alembic raises on an unknown current revision, so `alembic upgrade head` in an old image fails at 0100 or later.
  - The old matcher's gate is numeric (≥ 99). Its statements never name the new columns, and the new CHECKs are supersets of the old ones.
- **Documented standards deviations are Low.** The side tables do not follow the UUID/`BaseEntity` rules in migrations.md and models.md. The spec already proposes carve-outs for user approval.

## Open Questions / Risks
- **Bells lost on background re-triggers (H1).** Should a background re-trigger run only SIMILAR, or should the loss be accepted and documented? This needs a product decision.
- **Handler lock (M2).** Should the outbox handler use `FOR NO KEY UPDATE` (wait) or `SKIP LOCKED`? With SKIP LOCKED, a locked row is read as "gone" and the retry is dropped.
- **Release-gate items stay open:** `<HF_COMMIT_SHA>` is unresolved, threshold 0.86 is provisional, and VPS A capacity is unmeasured.
- **Forward SIMILAR cost depends on the planner pushing the restriction into the view (InitPlan).** This is unproven until someone records an `EXPLAIN (ANALYZE)` run.

---

## Summary
| Check | Result |
|---|---|
| Completeness vs `analysis/requirements.md` | All functional requirements 1–9, C1, I1–I6 and Phase 5 items map to R1–R25. No requirement was dropped. |
| Ambiguity | 4 items (M2, M3, L3, L6) |
| Internal contradictions | 2 items (M2; L11 "waits ≤ 2 s") |
| Implementability vs codebase | Most anchors verified (below). Gaps: M1, M4, L1 |
| Postgres/pgvector behaviour | Holds, see the verified claims below |

### Claims verified against the code (no finding)
- **View recreate.** 0099 `matchable_listings` is at `src/backend/alembic/versions/0099_wants.py:211-243` and has 12 columns ending in `changed_at`. `CREATE OR REPLACE VIEW` allows a new `LEFT JOIN`, a changed expression of the same type (`greatest(…, e.updated_at)` is still `timestamp`) and columns added at the end. `product_embeddings.product_id` is a PK, so rows cannot multiply. Dropping the restored view in the downgrade needs `DROP VIEW` + `CREATE`, which R5 does, because `CREATE OR REPLACE` cannot drop columns. No other view depends on `matchable_listings` (`VIEWS` at 0099:245).
- **CHECKs.** The names and texts are at 0099:351-356 and mirrored in `app/wants/models.py:178-183`. `tier` is `String(10)`, so `'SIMILAR'` (7 characters) fits. `_enum_column` is non-native, so it adds no DB CHECK.
- **Migrations run one transaction each** (`alembic/env.py:47`, `transaction_per_migration=True`), so `SET LOCAL lock_timeout` is scoped to 0101. The precedent is 0099:262 and 0099:404.
- **Re-trigger does not bump `updated_at`.** `updated_at` is a `version_id_col` with no `onupdate` (`app/core/base_model.py:61-68`). An ORM `update(Want)…values(match_requested_at=…)` therefore leaves it untouched, as the matcher's `CLEAR` does (`src/matcher/matcher/requests.py:40`).
- **The dispatcher has no savepoint.** It calls every handler in one `try` and commits after each entry (`app/outbox/dispatcher.py:67-87`). `begin_nested()` in each handler is required, following `bells_due.py:85`. Several handlers per event type are allowed (`registry.py:158`).
- **Matcher parameter typing.**
  - Lexical statements type `$3::int` and `$4::real` (`statements.py:109,114`). A per-tier `_store` tuple that uses both parameters in every statement avoids untyped-parameter errors.
  - Window `seen_at` is already `$1` for every non-MATCH tier (`statements.py:145`).
  - `_match` counts `len(pairs) - len(matches)` as suggestions (`window.py:184`), so R14 is needed.
- **`matchable_listings` has no `product_id`** (0099:213-228). The embedding has to come through the view's join, as R3 does.
- **The read path can be reused.** `_cards_select(caller, want_id, tier, *columns)` (`reads.py:210-250`) and `_card_fields` produce exactly `{id, title, href, meta, reserved_by_me, proposed_by_me}` (`reads.py:314-330`). `list_wants` has the "either tier" `exists` (`reads.py:192-199`).
- **Authorization matrix.** Rows 66–67 are `^/api/wants(/.*)?$` (`app/core/authorization_matrix.py:246-247`). The test rows are at `tests/test_authorization_matrix.py:147-148`, and the `mcp:read` refusal is at :189-192.
- **Boundaries.** `app.wants` may be imported only by `main.py`, and code outside `infrastructure/` may import only `app.core`/`app.db`/`app.storage`/`app.wants` (`tests/test_module_boundaries.py:54-85`). R10's `embeddings_acl.py` and `outbox_acl.append` fit, and so does R12 calling `app.wants…reconcile_embeddings` from `main.py`. The clock guard bans only `datetime.now(`/`date.today(` (`tests/test_domain_clock_guard.py:35`), so `datetime.utcnow()` is allowed (precedent `bells_due.py:90`).
- **Product writers.** Only `app/product/service.py:152,204` constructs `Product`, so no product writer is missed. The callers are `router.py:99,107,115`.
- **Frontend.** `getWantSuggestions` is mocked in exactly the three files R22 names (`test/useWantMatches.test.tsx:17`, `test/useWants.test.tsx:14`, `test/WantMatchesView.test.tsx:17`). `reservedCaption` is duplicated in `features/wanted/MatchCard.tsx:4-8` and `SuggestionCard.tsx:5-9`. `ItemCard` has `dashed`, `marker` and `footnote` (`components/shared/ItemCard.tsx:10-29`). The four active cases are in `WantMatchesView.tsx:152-200`.
- **Image.** `pgvector/pgvector:0.8.7-pg18-trixie` exists (`docker manifest inspect` returned an OCI index). Compose and both conftests use `postgres:18` (`docker-compose.yml:3`, `src/backend/tests/conftest.py:58`, `src/matcher/tests/conftest.py:67`).
- **Doc anchors exist:**
  - "no revision 0100" at `architecture.md:687`;
  - `postgres:18` at `architecture.md:383` and `tech-stack.md:53,114`;
  - the rename known limits at `architecture.md:315,455`.
- **`halfvec` binding.** `CAST($1 AS halfvec)` makes Postgres type the parameter as `halfvec`. asyncpg falls back to text I/O for non-builtin extension types, so a Python `str` literal binds without the `pgvector` package.

---

## Critical Issues
None.

## Important Gaps (High / Medium)

### H1 — Background re-triggers swallow lexical MATCH bells
- **Spec reference:**
  - R11: the want handler sets `match_requested_at = now`.
  - R12: reconcile re-triggers "as R11".
  - Technical Approach, Compatibility: "shadow mode is invisible to users".
  - Success Criterion 1: "MATCH counts and bells are identical".
- **Evidence:**
  - `src/matcher/matcher/statements.py:143-145`: forward pairs are born seen (`seen_at = "NULL" if window and tier == "MATCH" else "$1::timestamp"`).
  - `requests.py:77-80`: every claimed ACTIVE want runs the full `match_forward` (MATCH → SUGGESTION, and SIMILAR in the spec).
  - `statements.py:171-173`: the window's `NOT EXISTS` skips any pair already stored.
- **Gap:** Today, forward runs only after the seeker's own create, edit or resume, when the seeker is looking at the results. The spec adds background forward runs:
  - an outbox retry (≤ 60 s poll, ×5);
  - the reconcile of every ACTIVE want without a current vector, which during the backfill is **all** ACTIVE wants and on a model change is all of them again.

  Any listing that changed after the last window run and lexically matches such a want is stored as a seen MATCH. Its bell is never rung and `new_match_count` stays 0. During the backfill this happens with the **old** matcher too, at up to 300 wants per minute.
- **Category:** Incorrect assumption / Contradiction (ADR-001 vs ADR-002).
- **Severity:** High. It silently breaks a core promise of the tier ("bells unchanged") on every model change. It is not covered by the R12 re-entry risk, which is about the window re-reading listings, not about forward runs.
- **Recommendation:** Choose one option and write it into the spec:
  - (a) A SIMILAR-only re-trigger, for example a separate `similar_requested_at` flag with its own claim, or a window branch that reads `want_embeddings.updated_at > marker`.
  - (b) Store forward MATCH pairs unseen when they come from a background re-trigger (this needs a signal the matcher can see).
  - (c) Accept the loss, document it in Open Questions and the runbook, and drop the "identical bells" success claim for the backfill.

  Add a test either way: a listing appears, then a background re-trigger runs before the window, then assert the bell row.

### M1 — Existing tests that break and are not in the spec's impact list
- **Spec reference:** the Testing Approach lists only `test_wants_scan_removed.py`, `test_constants_drift.py`, `test_window.py` and "`test_main.py`/`test_settings.py` if they pin 99".
- **Evidence:**
  1. `src/backend/tests/test_wants_migration.py:295-316` (`test_contractFunctions_bodies_immutableAndPublicQualified`) asserts the **exact** 12-column list of `matchable_listings`. At head it will have 14 columns.
  2. `test_wants_migration.py:224-248` (`test_migration0099_downgradeFromOldShape_succeeds`) applies `OLD_SHAPE` (:51-65) **at head**. That drops `matchable_listings` and the `tier`/`missing_words` columns, and the test then runs `downgrade 0098`. At head = 0101, the 0101 downgrade runs first and fails:
     - `DELETE … WHERE tier = 'SIMILAR'` hits a missing column;
     - the CHECK restore references the dropped columns;
     - R5's `DROP VIEW matchable_listings` has no `IF EXISTS`.
  3. `src/matcher/tests/test_loop.py:176-207` (`test_waitForContract_waitsForTheRevisionAndTheView`) releases the gate by setting `version_num = '0099'` with only a view present. With `CONTRACT_REVISION = 101` and the two `to_regclass` table checks, `asyncio.wait_for(gate, timeout=5)` times out. `test_main.py` and `test_settings.py` do not pin 99 (`test_settings.py:58` is `>= 99` and still passes).
- **Category:** Unimplementable as written (test plan incomplete).
- **Severity:** Medium. The suite goes red. The fixes are easy, but test 2 needs a design choice.
- **Recommendation:**
  - (1) Extend the column list with `embedding, model_id`.
  - (2) Downgrade to `0099` first, then apply `OLD_SHAPE`, then downgrade to `0098`. An old-0099 database never reaches 0101 in production. Alternatively, make the 0101 downgrade defensive, but this is not recommended.
  - (3) Set `0101` and create stub `product_embeddings`/`want_embeddings` tables in the gate DB, and add a step asserting that `0100` alone still blocks.

### M2 — Contradictory lock mode for the outbox handlers
- **Spec reference:**
  - R11: "re-reads the current name, with `FOR NO KEY UPDATE`, and returns when the subject is gone".
  - Key Decisions line 23: "The reconcile **and handler** locks are `FOR NO KEY UPDATE SKIP LOCKED`".
  - Concurrency: "Want reconcile **and the handler** use `FOR NO KEY UPDATE SKIP LOCKED` … Each skips or waits ≤ 2 s".
- **Evidence:** The matcher claim holds `FOR NO KEY UPDATE` on the want during forward (`requests.py:31-38,73-80`). `update_want` takes the same lock (`writes.py:121-122,231`).
- **Gap:** If the handler uses SKIP LOCKED, a want the matcher or a seeker edit is holding returns no row. R11 then treats it as "gone", the entry is marked PROCESSED and the retry is lost. Only the 1-minute sweep repairs it, and only for ACTIVE wants.
- **Severity:** Medium (ambiguous, and it can drop retries).
- **Recommendation:**
  - The handlers wait with plain `FOR NO KEY UPDATE`, and "gone" means the row does not exist or the want is WITHDRAWN.
  - Only reconcile uses SKIP LOCKED.
  - Fix line 23 and the Concurrency paragraph.
  - The wait can last up to the matcher's forward transaction (3 statements × the 30 s `STATEMENT_TIMEOUT`, `rules.py:180`), not "≤ 2 s" (see L11).

### M3 — Forward SIMILAR does not state the listing-side model check
- **Spec reference:**
  - R13, window: "`CASE WHEN l.model_id = $3::text AND …`".
  - R13, forward: only the want-side InitPlan `… WHERE want_id = $2 AND model_id = $3`.
  - Data flow: "only pairs whose two sides both carry `rules.EMBEDDING_MODEL_ID` form".
- **Gap:** As written, the forward statement could compare a new-model want vector with old-model listing vectors during a model switch (same dimension 768), and store meaningless scores. The test "a vector with another model id is ignored" does not say which side is checked.
- **Severity:** Medium.
- **Recommendation:** Add `AND l.model_id = $3::text` to the forward plain ANDs. Test both sides: a stale want vector and a stale listing vector.

### M4 — The parity script is not available in the Docker `models` stage
- **Spec reference:** R23 runs `src/backend/scripts/check_embed_parity.py` in the `models` stage.
- **Evidence:** `src/backend/Dockerfile:21-35`: the `models` stage is `FROM python:3.12-slim` with no `COPY` of the build context. `scripts/` today holds only `build_localities.py` and `build_locality_coordinates.py`.
- **Severity:** Medium. The build step fails as specified.
- **Recommendation:** Add `COPY scripts/check_embed_parity.py /tmp/` (or similar) to the `models` stage. Pin the runtime the script needs: `tokenizers` and `onnx` come with `optimum-onnx[onnxruntime]`, which should be checked. Keep the script out of the runtime image.

### M5 — 0101 `lock_timeout = 5s` while the old matcher keeps running
- **Spec reference:**
  - R2: under `SET LOCAL lock_timeout = '5s'`.
  - Runbook step 4: "`docker compose up -d … backend`. The compose `alembic upgrade head` applies 0101 … Keep the matcher on its old image".
- **Evidence:**
  - `CREATE OR REPLACE VIEW` needs ACCESS EXCLUSIVE on the view, and the CHECK drop and add needs ACCESS EXCLUSIVE on `want_matches`.
  - The old matcher's window transaction holds ACCESS SHARE on the view and ROW EXCLUSIVE on `want_matches` until commit. That covers `WAITING_LISTINGS` + MATCH + SUGGESTION + marker in one transaction (`window.py:166-185`), about 13 s for a capped run (`rules.py:169-178`).
  - Compose runs `alembic upgrade head && exec uvicorn` (`docker-compose.yml:27`), and `backend` has no `restart:` policy.
- **Gap:** If a window run overlaps, 0101 fails on the lock timeout and the backend container exits.
- **Severity:** Medium.
- **Recommendation:** In step 4:
  - stop the matcher;
  - run `docker compose run --rm --no-deps backend alembic upgrade head`;
  - start the old matcher again;
  - then start the backend with `up -d`.

  Alternatively, document "retry `up -d` on a lock timeout". Also state whether the 0101 downgrade sets `lock_timeout` (0099:404 does).

### M6 — An embed that times out is not cancelled, and the reconcile batch shares the per-write timeout
- **Spec reference:** R7 `asyncio.wait_for(asyncio.to_thread(...), EMBED_TIMEOUT_SECONDS)`; R12 sub-batches of 32 through the same `embed_*` with 2 s.
- **Evidence:**
  - The pattern is copied from `app/moderation/text_guard.py:111-112`.
  - `wait_for` cancels only the awaiting task. The worker thread runs ONNX to completion on the default executor, which is shared with moderation.
  - At 25–50 ms per name (spec cost budget), a batch of 32 is 0.8–1.6 s, close to 2 s on a loaded VPS A.
- **Gap:** Under load, timeouts pile up threads that keep burning CPU, which makes the next writes time out too. If one batch of 32 regularly exceeds 2 s, every tick ends at its first batch ("a miss ends the tick") and the backfill never progresses.
- **Severity:** Medium (operational, hard to see in tests).
- **Recommendation:**
  - Bound concurrency with an `asyncio.Semaphore(1)` or a dedicated single-thread executor, and skip immediately (miss) when it is busy.
  - Give reconcile its own timeout that scales with the batch, or use a smaller batch.
  - Log timeouts with a count in the tick line.

## Minor Discrepancies (Low)

| # | Finding | Evidence | Recommendation |
|---|---|---|---|
| L1 | The job-list anchor is wrong. The assertion is at line **71**, not 68. The test name `test_lifespan_schedulesNoWantJob_…` becomes misleading once a wants reconcile job is scheduled. | `src/backend/tests/test_wants_scan_removed.py:63,71` | Fix the anchor and rename the test. |
| L2 | Success Criterion 5, "the parity test passes with the shared `_VISIBILITY` fragment", cannot fail. The parity test checks its own SQL copy (`CALL_SITE_RULE`) and never reads `statements.py`. | `src/backend/tests/test_wants_visibility_parity.py:43-48` | Add a matcher test asserting that the normalised `_VISIBILITY` text equals the parity test's predicate, or reword the criterion. |
| L3 | Want reconcile `FOR NO KEY UPDATE SKIP LOCKED` over a LEFT JOIN to `want_embeddings` fails in Postgres: "FOR NO KEY UPDATE cannot be applied to the nullable side of an outer join". Products say `OF p`; wants do not. | spec R12, Concurrency | Specify `FOR NO KEY UPDATE OF w SKIP LOCKED`, or use `NOT EXISTS`. |
| L4 | `reconcile_embeddings(db, limit=300, now)` uses one `now` for up to about 19 sub-batch commits. `e.updated_at` (feeding `changed_at`) can then predate its commit by tens of seconds. That is within, but undocumented against, the window's 2-minute overlap assumption. | `window.py:16-19` docstring; `rules.py:167` | Take `now` per sub-batch, or state the bound (≤ the tick duration, which must stay below `WINDOW_OVERLAP`). |
| L5 | Rollback step 4 stops only the matcher before `alembic downgrade 0100`. The still-running new backend then hits the missing tables: renames delete from `product_embeddings` and the reconcile tick errors. | spec runbook | Stop the backend too, or deploy the old backend image right after. |
| L6 | `seed_want_matches(tier=)` does not say how it interacts with the current inference (`missing_words is None → MATCH`). The `useWants.test.tsx` route-list test (:225-250) should also call `getWantSimilar` and expect `/wants/want-1/similar`. | `tests/conftest.py:366-393`; `src/frontend/src/test/useWants.test.tsx:236` | Make `tier` an explicit keyword that overrides the inference, and extend the route test. |
| L7 | Frontend test 7 says the section renders "after the EmptyCard in `activeEmpty` and in `matching`". The `matching` state has no EmptyCard (MatchingStatus + SkeletonGrid). | `WantMatchesView.tsx:152-162` | Say "after SkeletonGrid or the match list" for `matching`. |
| L8 | The runbook says "Measure VPS A with `probe.py` in the backend container". `probe.py` lives only in the research task folder and is not in the image. | `.maister/tasks/research/2026-11-18-wants-semantic-embeddings/analysis/models-probe/probe.py` | Ship a small script, or describe a `docker cp` step. |
| L9 | Standards deviations: migrations.md requires UUID PKs with `gen_random_uuid()`, and models.md requires `BaseEntity`. The owner-id-keyed, unmapped side tables break both. The spec suggests carve-outs, but CLAUDE.md asks for user approval when standards conflict. | `.maister/docs/standards/backend/migrations.md`, `models.md`; spec "Suggested standards updates" | Get approval before implementation, not after. |
| L10 | `.maister/docs/INDEX.md` also says "no revision 0100" (in the Architecture summary). The spec only says to "update the summaries". | INDEX.md Architecture paragraph | Name the phrase explicitly. |
| L11 | "Each skips or waits ≤ 2 s" is wrong for the waiting handler and for `update_want`. They wait for the matcher's forward transaction (up to 3 × 30 s). | `requests.py:73-80`, `rules.py:180` | Reword (see M2). |

## Clarification Needed
1. **H1:** When the backend re-triggers matching, should it run only SIMILAR, or is losing bells for the listings in that gap acceptable during the backfill and model changes?
2. **M2:** Should the handlers wait for the row lock, or skip a locked row? Treating a locked row as "gone" drops the retry.
3. **M5:** Should 0101 be applied with the matcher stopped (recommended), or should the runbook accept a retry?
4. **L9:** Does the user approve the side-table carve-outs to `models.md` and `migrations.md` now?

## Extra Features
None beyond the requirements. `reservedCaption` extraction and the `app/embeddings` compute-only boundary test were both requested in Phase 5.

## Recommendations (ordered)
1. Resolve H1 in the spec: a SIMILAR-only re-trigger, or a documented acceptance plus a test.
2. Unify the handler lock (M2) and add the forward `l.model_id` check (M3).
3. Extend the test-impact list with the three breaking tests (M1) and the L1/L6 updates.
4. Fix the Dockerfile `models` stage COPY (M4) and the 0101 deploy order (M5, L5).
5. Bound embedder concurrency and give reconcile its own timeout (M6).
6. Fix the remaining Low items as part of planning.
