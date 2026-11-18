# Completeness Report: semantic SIMILAR tier for „Szukam”

## TL;DR
- **Status: passed_with_issues.** 0 critical, 4 warnings, 6 info.
- Plan: all 89 steps are checked (102 boxes, counting the 13 group headers), and the code spot-checks found every key step implemented. 2 of the 3 recorded deviations (`is_busy()` and MatMul-only QInt8) are in the code and in `architecture.md`. The third, the lexical exclusion, is in both too, but `spec.md` was never amended.
- Standards: mostly compliant. The gaps are a stale testing standard (`postgres:18`), the approved side-table carve-out not yet recorded in `models.md`/`migrations.md`, and some minor style points.
- Docs: the work-log and the project docs are thorough. But `architecture.md` refers to a migration 0102 that is no longer in the working tree, and `full-suite-results.md` was measured on a tree that still had 0102 in it.

## Key Decisions
- **Scope.** The scope came from `verification/review-scope.md`. The 0102/ledger files listed there as excluded are **no longer on disk**: `git status` shows no 0102, no `app/inventory` change and no edited migration tests. So only the doc references to 0102 are assessed.
- **Plan steps vs boxes.** I counted 89 plan steps, not 102 boxes; the 13 extra boxes are the group headers (`N.0`). The extra `is_busy()` step in Group 5 is recorded in the work-log but is not a plan checkbox.
- **Recorded deviations.** I treated the three deviations from the work-log as accepted. The lexical exclusion was the user's decision ("Fix: lexical exclusion"). The other two were build or engineering necessities. I checked that each one is reflected in code and docs, not whether it was the right call.
- **Unchecked claims.** Test results are taken from `full-suite-results.md`. I did not re-run any suites, because this check is read-only.

## Open Questions / Risks
1. **The suite evidence predates the current tree.** `full-suite-results.md` (backend 1564 tests, the run-1 cascade analysis) was measured while 0102 and the inventory changes were still present. Those files are gone now, so the head revision is 0101 and the backend test count will differ. A fresh backend run on the current tree would confirm the baseline equality.
2. **Dangling 0102 runbook references.** `architecture.md:793` ("e.g. 0102") and `:824` ("from a database at 0102 this runs 0102's downgrade first, see its runbook") point at a revision and a runbook that do not exist. If 0102 comes back later, it needs its own runbook. If it does not, these phrases should go.
3. **Image build not verified end to end.** The full `docker compose build backend` (needs the `hf_token` secret) was not run. Only the embed block was verified, in a scratch Dockerfile. The parity margin is thin (0.9904 against a 0.99 gate), so an onnxruntime bump can fail the build.
4. **Release gate is still operational.** The labelled-sample gate, the 0.86 threshold and the VPS A measurement are documented steps, not code. This is expected by the spec.

---

## 1. Plan Completion

**Status: ✅ Complete.** 89 of 89 steps are checked (100%), and 13 of 13 groups. There are no unchecked boxes (`grep '- \[ \]'` returns 0).

### Code spot-checks (evidence)
| Group | Step checked | Evidence |
|---|---|---|
| 1 DB contract | 1.3–1.6 | `alembic/versions/0100_pgvector.py` (`CREATE/DROP EXTENSION … vector`, docstring with the superuser and `pg_extension` checks). `0101_want_similar.py` has both tables with `pk_`/`fk_` names, the column, the partial index, the trigger reusing `wants_notify_match_requested()`, `CREATE OR REPLACE VIEW` with `e.updated_at` in `greatest()` and `embedding, model_id` appended, the CHECK swap and `SET LOCAL lock_timeout` in upgrade and downgrade. I compared the `MATCHABLE_LISTINGS_0099` copy against 0099 with a script: **byte-identical**. `app/wants/models.py` has `WantMatchTier.SIMILAR`, the mirrored CHECKs, `similar_requested_at` and its index. |
| 1 | 1.2 | The pgvector image is in `docker-compose.yml`, `src/backend/tests/conftest.py:64` and `src/matcher/tests/conftest.py:70`. |
| 1 | 1.8 (M1) | `test_wants_migration.py:200` (the index set gains `ix_wants_similar_requested_at`), `:229` (`downgrade 0099` first) and `:320` (the view columns). |
| 2 Embedder | 2.4–2.6 | `app/embeddings/service.py`: the constants, a single-worker executor, `_stuck` with its done-callback, the reasons `missing`/`busy`/`timeout`/`error` without the text, `vector_literal`, `read_model_id` and `is_busy()`. `onnx_embedder.py`: `intra_op_num_threads=1`, truncation 512 with padding, `token_type_ids` only when declared, CLS + L2. |
| 3 Products | 3.2–3.5 | `app/product/embeddings.py`: `CAST(:embedding AS halfvec)`, `save_name_vector`, a handler in `begin_nested` with `with_for_update(key_share=True)` (= `FOR NO KEY UPDATE`), and a reconcile with `skip_locked`, `of=Product`, batches of 32, a skip list and an `is_busy()` stop. `service.py`: embedding is wired into `create_product`, the create branch of `get_or_create_product_by_name`, and `update_product` on rename only. |
| 4 Wants | 4.2–4.6 | `infrastructure/embeddings_acl.py` (the only importer of `app.embeddings`) and `outbox_acl.append`. `application/embeddings.py`: `request_similar` is a Core `update()` limited to ACTIVE wants. The handler skips WITHDRAWN wants and a missing row. The reconcile covers ACTIVE + unexpired wants only and takes `now` per batch. `writes.py`: `create_want` embeds after `_check_texts` and before the first DB call. `update_want` embeds on the unlocked read and stores or deletes the vector under the lock. |
| 5 Lifespan | 5.2–5.5 | `app/main.py`: `_check_embeddings_tables` runs before the model load, the `OnnxEmbedder` import is lazy, the log line includes `EMBEDDINGS_ENABLED=%s`, both handlers are registered, `_run_embedding_reconcile` runs every 1 min and is always scheduled, a lost race is one WARNING, other errors go to `logger.exception` and are not re-raised, and `set_embedder(None)` runs at shutdown. |
| 6 Read API | 6.3–6.6 | `schemas.WantSimilarResponse` (6 fields), `reads.list_similar` (`SIMILAR_LIMIT=10`, ordered by `score DESC, item_id`), the route `GET /{want_id}/similar` with `ReadPrincipal`, `list_wants(matched_item_id)` restricted to the MATCH and SUGGESTION tiers, and the comment on matrix rows 66–67. |
| 7 Matcher stmts | 7.4–7.7 | `rules.py` has the 3 constants and the provisional-threshold comment. `statements.py` has `_VISIBILITY`, `_FORWARD_SIMILAR_PAIRS` (InitPlan), `_WINDOW_SIMILAR_PAIRS` (`CASE`), the generic `_CAPPED` and `match_similar_forward`. `window.py` counts by tier and logs `similar=`. `db.py` has `CONTRACT_REVISION = 101` and the 3 `to_regclass` checks. |
| 8 Request loop | 8.2–8.5 | `requests.py`: `CLAIM` puts full requests first, `CLEAR` uses the two-flag `CASE`, `CLEAR_SIMILAR` is the SIMILAR-only clear, and the failure log line names the kind. |
| 9/10 Frontend | 9.2–10.4 | `api/wants.ts:82,135`, `useWantMatches.ts` (4th fetch, `NO_SIMILAR`), `wantMatchesViewState.ts` (`similar` on the 4 active kinds only), `SimilarCard.tsx` (`dashed`, `reservation={null}`, no footnote or marker), `reservedCaption.ts`. `SimilarSection` follows the spec's markup (`aria-labelledby`/`useId`, `aria-hidden` emoji, classes, grid), and `similarSection` comes after `suggestionsSection` and before `ActiveActions` in `matching`, `matchingSlow`, `active` and `activeEmpty`. |
| 11 Infra | 11.2–11.5 | `scripts/check_embed_parity.py`. The Dockerfile has the pinned `EMBED_REVISION`, `snapshot_download`, the export, a MatMul-only QInt8 step and the parity gate in the same `RUN`, `model_id.txt`, and `COPY --from=models /models/embed`. Compose sets `EMBEDDINGS_ENABLED: ${EMBEDDINGS_ENABLED:-false}`. `.env.example` has placeholders only, no secrets. |
| 12 Docs | 12.1–12.5 | See section 3. |
| 13 Tests | 13.3 | 7 gap tests are present, for example `test_putProduct_renameWhileEmbeddingsDisabled_…`, `test_processNext_wantWithoutVector_…` and `test_missingContract_revision0101WithoutProductEmbeddings_reported`. |

### Spec test groups present
| Group | File | Tests (spec target) |
|---|---|---|
| 1 | `test_want_similar_migration.py` | 6 (6) |
| 2 | `test_embeddings.py` | 9 (8): one extra `is_busy` test, one real-model `importorskip` test |
| 3 | `test_product_embeddings.py` | 11 (8) |
| 4 | `test_wants_embeddings.py` | 11 (8) |
| 5 | matcher `test_similar.py` | 11 (8), including 2 for the lexical exclusion |
| 5b | matcher `test_similar_requests.py` | 6 (5) |
| 6 | `test_wants_similar_api.py` | 6 (6), plus 2 matrix rows |
| 7 | the frontend view-state, hook, view and `reservedCaption` tests | present |

Drift and parity: `test_embeddingModelId_equalsTheBackendConstant`, `test_dockerfileEmbedArgs_composeTheModelId`, `test_embedParityScript_holdsTheNames_failsBelowTheMinimum` and `test_visibility_isTheBackendParityTestsCallSiteRule` are all in `src/matcher/tests/test_constants_drift.py`. The renamed gate test is `test_loop.py:176`.

Spot-check issues: none blocking. Plan step 3.6 ("no `FOR UPDATE` anywhere") holds for the vector paths. The pre-existing `_lock_product` `FOR UPDATE` used for photo edits remains, as the work-log notes; it is outside this feature.

---

## 2. Standards Compliance

**Status: ⚠️ Mostly compliant.** I checked 23 standards. 18 apply, and 15 of those are fully followed. The other 3 (`migrations.md`, `models.md` and `backend-testing.md`) are followed in the code, but the standard documents need updating or a minor gap remains (gaps below).

### Applicability reasoning
| Standard | Applies? | Reasoning / verdict |
|---|---|---|
| global/error-handling.md | ✅ Yes | Fail-open embedder and a scheduled job. The job logs a lost race (`40P01`/`40001` through `TRANSACTION_CONFLICTS`) as one WARNING and any other failure once with its traceback, and never re-raises (`main.py`). User writes keep the shared 409. ✅ |
| global/validation.md | ⚠️ Marginal | No new user input; it reuses `clean_name` and `_check_texts`. ✅ |
| global/conventions.md | ✅ Yes | Env vars with defaults and `.env.example` placeholders, docs updated. No new Python package (no `pgvector` lib). ✅ |
| global/coding-style.md | ✅ Yes | Naming is consistent, ruff and format are clean on the touched files (work-log). ✅ |
| global/commenting.md | ✅ Yes | The comments explain why (InitPlan, NO KEY UPDATE, stuck worker, provisional threshold). The Dockerfile comment quotes measured parities, which is a justification, not a change log. ✅ |
| global/minimal-implementation.md | ✅ Yes | No tier-strategy abstraction, no vector index, one endpoint. `is_busy()` replaces private-attribute reads, so it is justified. ✅ |
| backend/api.md | ✅ Yes | `GET /api/wants/{id}/similar`: a plural resource, one level of nesting, a twin of `/suggestions`. ✅ |
| backend/models.md | ✅ Yes | String-backed `WantMatchTier.SIMILAR`, mirrored CHECKs, mapped `similar_requested_at`, cross-module access through `embeddings_acl.py`. The unmapped owner-id-PK side tables are an **approved carve-out (decision 18) that the standard does not record yet**. ⚠️ |
| backend/queries.md | ✅ Yes | Bound parameters only (`CAST(:embedding AS halfvec)`, `$n` in the matcher), SQL `LIMIT`, batched `_card_fields`, and a constant statement count is tested. The want reconcile issues 2 statements per row (upsert + `request_similar`, up to 64 per batch), while the product side uses one executemany (info). ✅ |
| backend/jooq.md | ❌ No | The filter-DSL query services are untouched. |
| backend/migrations.md | ✅ Yes | `SET LOCAL lock_timeout` in both directions, explicit `pk_`/`fk_`/`ix_` names, an additive nullable column, the extension revision separate from the schema revision, exact-reverse downgrades, no `::` in `sa.text`, and a downgrade-then-upgrade test that restores head in `finally`. The UUID-PK rule carve-out is approved but **not yet recorded**. ⚠️ |
| backend/security.md | ✅ Yes | Matrix rows 66–67 (READ) are covered by a test row and an `mcp:read` refusal. No vectors or scores in responses (exact key-set test). The want is the caller's own (404). Private route, so no cache-header requirement. ✅ |
| backend/plugin-auth.md | ❌ No | No plugin surface. |
| backend/time.md | ✅ Yes | Audit timestamps are naive UTC via `datetime.utcnow()`. `app/wants` takes `now` as a keyword or through `now_factory`, and the clock guard is green (work-log G4). ✅ |
| frontend/css.md | ✅ Yes | Existing Tailwind tokens and classes are reused from `SuggestionsSection`. ✅ |
| frontend/components.md | ✅ Yes | The view is resolved in the pure `resolveWantMatchesView` and the page `switch`es on `view.kind`. The feature code is in `features/wanted`, and the shared helper is extracted. ✅ |
| frontend/accessibility.md | ✅ Yes | `section aria-labelledby` + `useId`, an `aria-hidden` emoji, Polish copy, an `h2` in the right place in the heading order. ✅ |
| frontend/responsive.md | ✅ Yes | `grid-cols-2 sm:grid-cols-3`, mobile first. ✅ |
| frontend/data-fetching.md | ✅ Yes | The hook keeps its query key and has a stable module-level `NO_SIMILAR`. The fetch goes through `api/wants.ts`. ✅ |
| testing/backend-testing.md | ✅ Yes | testcontainers, `FakeEmbedder` in `conftest.py` (3+ files import it), exact key sets, `count_queries`, `test_<op>_<scenario>_<expected>` names. Three files exceed the 2–8 range (11 tests each). Line 6 of the standard still names `postgres:18`. ⚠️ |
| testing/frontend-testing.md | ✅ Yes | Explicit `vitest` imports, `vi.mock` factories with `getWantSimilar` in all 3 files, typed `makeWantSimilar` with no response-type casts (`as const` only). ✅ |
| project/architecture.md + tech-stack.md | ✅ Yes | Updated (section 3). |
| CLAUDE.md secrets rule | ✅ Yes | The embed `RUN` has no secret mount, `.env.example` holds names and defaults only, and no env dumps appear in docs or tests. ✅ |

### Gaps
| # | Standard | Severity | Description | Evidence |
|---|---|---|---|---|
| S1 | testing/backend-testing.md | warning | The standard still says tests run against `postgres:18`. The suites now use `pgvector/pgvector:0.8.7-pg18-trixie`. | `.maister/docs/standards/testing/backend-testing.md:6` vs `src/backend/tests/conftest.py:64` |
| S2 | backend/models.md, backend/migrations.md | warning | The approved carve-out (unmapped side tables with an owner-id PK, no `BaseEntity`), the separate extension revision and the `CAST(:v AS halfvec)` binding are not recorded. The spec defers this `/maister:standards-update` to shipping. | spec "Standards follow-up"; work-log G12 notes |
| S3 | testing/backend-testing.md | info | The test files are above the 2–8 range because Group 13 added gap tests. | `test_product_embeddings.py`, `test_wants_embeddings.py`, matcher `test_similar.py` (11 each) |
| S4 | backend/queries.md | info | The want reconcile runs one upsert and one update per row. The product side uses one executemany per batch. It is bounded (≤ 64 statements per batch of 32) and runs in the background. | `app/wants/application/embeddings.py` (the `for row, vector in zip(...)` loop) vs `app/product/embeddings.py` (`db.execute(_UPSERT, [...])`) |

---

## 3. Documentation Completeness

**Status: ⚠️ Adequate.** Everything required is present and thorough. One stale cross-reference and an un-amended spec remain.

### implementation-plan.md
All boxes are `[x]` and the file is intact (520 lines).

### work-log.md
- **Dated entries**: multiple timestamped entries, 11:52Z to 13:31Z.
- **Group coverage**: all 13 groups, with wave resolutions.
- **Standards reading log**: kept for Groups 1–12. Group 13 has no "Standards Reading Log" block (minor).
- **Files modified**: listed per group.
- **Deviations**: all three are recorded (MatMul-only QInt8, the lexical exclusion fix with the user's decision, `is_busy()`). The EXPLAIN numbers are recorded too (7.7, and again after the fix).
- **Visual self-check**: "all 5 design-context IDs ✓" (step 10.5). `visual-coverage.md` covers 5 of 5.
- **Final completion entry**: present, with the open items.

### Spec alignment
Every core requirement, R1–R26, maps to code (section 1).
- **Deviations versus the spec text.** The lexical exclusion changes R13 and the data-flow sentence ("SIMILAR runs last, so `NOT EXISTS` plus `ON CONFLICT DO NOTHING` let the lexical tiers claim a pair first"). The code now excludes any lexical MATCH or SUGGESTION candidate from SIMILAR, even one that is capped out. `architecture.md:366` documents this correctly. `spec.md` was not amended.
- **Unaffected requirements.** `is_busy()` and MatMul-only QInt8 stay within the spec's intent. R23 still says "QInt8", which MatMul-only quantization still is.

### Project docs
- `architecture.md`:
  - It covers the DB contract (0100/0101), the "Name vectors" section, the SIMILAR tier rule with the lexical exclusion, the request kinds, gate 101, `similar=`, `/similar` in the API table (:456), the frontend section, the configuration (:504), the pgvector image (:405, :489, :570), the Dockerfile parity note (:576) and the full 0100–0101 deploy/rollback runbook (:772 onwards).
  - "no revision 0100" is gone.
- `tech-stack.md`: the pgvector image, and a model row with the resolved SHA (:169).
- `INDEX.md`: the Architecture and Tech Stack summaries are updated, and "0100–0101 add the semantic SIMILAR tier (own runbook)" is present. `postgres:18` appears only as the rollback target.

### Issues
| # | Artifact | Severity | Issue |
|---|---|---|---|
| D1 | `.maister/docs/project/architecture.md:793, :824` | warning | The runbook refers to migration 0102 and "its runbook". Neither exists in the working tree any more. |
| D2 | `implementation/full-suite-results.md` | warning | Measured with the parallel 0102 and inventory changes present (1564 backend tests, with the run-1 cascade attributed to 0102). The current tree no longer has them, so the record does not describe the tree as it is now. |
| D3 | `implementation/spec.md` (R13, Technical Approach item 2) | info | Not amended for the user-approved lexical exclusion. The work-log and `architecture.md` are correct. |
| D4 | `.env.example` (EMBEDDINGS comment) | info | "the dev compose image has no model" contradicts compose, which builds the `runtime` target, and that target copies `/models/embed`. |
| D5 | `tests/test_wants_matches_api.py` docstring | info | "over both tiers" is now imprecise with a third tier. The work-log already flags this as optional. |
| D6 | work-log, Group 13 | info | No Standards Reading Log block for this group. The work-log also notes 2 mypy `attr-defined` errors in `tests/test_wants_embeddings.py`, which are outside the app's baseline of 15. |

---

## Consolidated Issues
| Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|
| documentation | warning | Dangling references to 0102 in the 0100–0101 runbook | `architecture.md:793, :824` | true | Remove "e.g. 0102" and the 0102 downgrade clause, or restore 0102 together with its runbook |
| documentation | warning | Suite results were measured on a tree that differs from the current one (0102 is gone) | `implementation/full-suite-results.md` | true | Re-run the backend suite alone on the current tree and update the record |
| standards | warning | The testing standard still names the `postgres:18` test image | `standards/testing/backend-testing.md:6` | true | `/maister:standards-update`: pgvector image |
| standards | warning | The side-table carve-out, the extension revision split and the halfvec binding are not recorded | `standards/backend/models.md`, `migrations.md` | true | `/maister:standards-update` (approved, decision 18), plus the suggested "parity gate in the same RUN as int8 quantization" standard |
| documentation | info | `spec.md` not amended for the lexical exclusion | `implementation/spec.md` R13 | true | Add one line to R13 and the data flow |
| standards | info | Three test files above the 2–8 range | backend and matcher test files | false | Accept: they hold the Group 13 gap tests |
| standards | info | The want reconcile writes per row, the product side per batch | `app/wants/application/embeddings.py` | true | Optional: executemany the upserts plus one `request_similar` with `id = ANY(...)` |
| documentation | info | Inaccurate comment about the dev compose image | `.env.example` | true | Reword to "off by default; turn on only after the 0100–0101 runbook" |
| documentation | info | Docstring "over both tiers" | `tests/test_wants_matches_api.py` | true | Say "MATCH and SUGGESTION" |
| documentation | info | Group 13 has no standards log; 2 mypy errors in a test file | `work-log.md`, `tests/test_wants_embeddings.py` | true | Add the block; type the `main` attribute access |

**Issue counts:** critical 0, warning 4, info 6.
