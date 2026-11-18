# Production Readiness Re-verification: wants semantic SIMILAR tier

**Date**: 2026-11-18
**Path**: `.maister/tasks/development/2026-11-18-wants-semantic-similar-tier` (the in-scope files of `verification/review-scope.md`, current working tree)
**Target**: production (VPS A, docker compose: postgres, backend, matcher, web, nginx)
**Status**: Not Ready for the full release. Shadow deploy: With Concerns.

## TL;DR
- **Full release (through runbook step 8): NO-GO.** C1, the labelled-sample release gate, is still open. Code cannot close it.
- **Shadow deploy (backend + matcher, web held back): GO WITH MITIGATIONS.** It is conditional on five things: a successful step-1 build (C2), a passing 1b measurement, the release gate moved from "before any deploy" to "before step 8" in the runbook, a threshold-change step, and a tag on the old backend image.
- Every fixable finding is resolved: W3, W11, W12, W16 and W17. W14 is resolved in the docs, but the missing backend restart policy is still there (pre-existing). W15 is reordered, but the measurement still has to be run.
- The new refusal below 0101 is correct and safe under compose, because the compose `command` migrates before uvicorn starts. It does make the old backend image the only rollback target, and the runbook never preserves that image.
- Two new gaps for the shadow path: stored SIMILAR rows are not filtered by score on read, and the old backend image is overwritten in step 1.

## Key Decisions
- **C1 stays a deploy blocker as the runbook is written.** The runbook says "Release gate, before any deploy", and `SEMANTIC_SIMILARITY_MIN = 0.86` (`src/matcher/matcher/rules.py:17`) is still provisional. On its merits, the gate protects only what users see: the quality of the „Powiązane rzeczy” cards, which only the web image shows. In shadow, SIMILAR rows are born seen, ring no bell, and do not count toward MATCH (`reads.py:195`). The gate can therefore safely move to "before step 8". That is a release-owner decision, and it has to be written into the runbook before anyone runs a shadow deploy. Until then, "before any deploy" governs.
- **C2 is a precondition gate, not a code blocker.** The production `runtime` image has never been built with `hf_token`. The embed `RUN` sits after the secret-mounted Bielik-Guard `RUN` in the same `models` stage, so the in-image embed block cannot have run either. The "rebuilt twice, hash 4552576b…1e08" evidence in the work-log comes from outside that Dockerfile path. Step 1 of the runbook *is* this build, and it fails closed (parity below 0.99 means exit 1). So C2 blocks every deploy until step 1 succeeds, and it closes once the operator has the build log with `embed parity: min cosine ≥ 0.99`, the `model.sha256` line, and `model_id.txt == EMBEDDING_MODEL_ID`. If that hash differs from 4552576b…1e08, the release-gate sweep must run on the new hash.
- **The shadow deploy is GO WITH MITIGATIONS, not GO.** It still adds latency to product and want writes (a synchronous embed of up to 2 s), still needs the API RSS headroom, and is a schema change with no image-only rollback. None of these depend on the threshold. All of them are covered by 1b and the runbook.
- **The refusal below 0101 is accepted as designed.** `_check_similar_schema()` (`app/main.py:180`) runs whatever `EMBEDDINGS_ENABLED` says, because the ORM maps `wants.similar_requested_at`. Without it, every want read would fail at runtime instead of at startup. Failing fast is the right choice.

## Open Questions / Risks
1. **Threshold change after shadow (new).** The backend reads SIMILAR rows ordered by score with `SIMILAR_LIMIT = 10`, and does not filter them against a minimum (`app/wants/application/reads.py:282-286`, `:387`). If the gate sets the threshold above 0.86, the rows between 0.86 and the new value stay stored. They appear as soon as step 8 ships, and they keep taking up `SEMANTIC_CAP` slots. If the gate sets it below 0.86, existing wants never get the pairs in between. The runbook has no step for either case. Add a step between the gate and step 8:
   - deploy the matcher with the new value;
   - `DELETE FROM want_matches WHERE tier = 'SIMILAR' AND score < <new_min>`;
   - re-flag every ACTIVE want with the step-6 `UPDATE`.

   Without this step, a shadow run with the provisional value leaks into the release.
2. **The old backend image is not kept (new).** The `backend` service has no `image:` tag (`docker-compose.yml:18-22`), so step 1 (`docker compose build backend`) points the compose tag at the new image. This has three effects:
   - Step 3 says "The old backend and matcher images may run again here". For the backend, that holds only for `docker compose start backend` on the existing container. A `docker compose up -d backend` starts the **new** image instead, and its `alembic upgrade head` applies 0100–0101 outside step 4's controlled order, without the `\dx` check.
   - Rollback level 4 ends with "deploy the old backend and matcher images", but the old backend image is then dangling or pruned.
   - Rebuilding the old backend means checking out the old commit and doing another `hf_token` build.

   Fix: before step 1, run `docker tag <project>-backend:latest <project>-backend:pre-semantic`, and the same for the matcher before step 6. Write in steps 3 and 4 that the old image runs only from that tag, or through `docker compose start`.
3. **Base wants release status.** This runbook assumes production is at 0099 with the per-word wants feature live. The 0099 runbook has its own release gate (a labelled sample of at least 200 pairs, "Do not deploy", `architecture.md:296`). Confirm that gate has been passed, or that the wants feature is already in production. If it is not, a shadow deploy of 0100–0101 also ships the per-word backend and the MATCH bells.
4. **Quantizer and runtime onnxruntime differ** (documented, low). The parity gate runs under `onnxruntime==1.32.0` in the `models` stage. Inference runs under 1.30.0 (`uv.lock:1100`). The parity is never checked under the runtime version. Step 1b times the model but does not check the cosine. With a +0.0004 margin, consider running `check_embed_parity.py` inside the runtime container once, or aligning the versions.
5. **The rest of the `models` stage still floats** (low). Transitive dependencies of `optimum-onnx` (protobuf, safetensors, sympy and others) and the `python:3.12-slim` base tag are not pinned. The `model.sha256` comparison in step 1 catches any change in the result, so the risk is a failed or re-gated build, not silent drift.
6. **The tree is uncommitted.** The W12 re-run used the current working tree. Build the image from that same tree with no further edits, or re-run the suites on whatever gets built.

## Executive Summary
- **Recommendation**:
  - Full release: **NO-GO** (C1 open; C2 not yet done).
  - Shadow deploy, runbook steps 1–7: **GO WITH MITIGATIONS** (conditions in Next Steps).
- **Overall Readiness**: about 85%, up from about 75%.
- **Deployment Risk**: Medium for the shadow deploy (a schema change with no image-only rollback; the old backend image is not kept). Low for the code itself.
- **Blockers**: 2 (C1, C2; both operational). **Concerns**: 3 (new threshold-change step, old-image tag, unmeasured VPS A). **Recommendations**: 4.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 92% | The flag defaults to false in `config.py`, compose and `.env.example`. The model id is pinned in three places with drift tests. The `models` stage now pins its stack. |
| Monitoring | 80% | No change: reconcile line, `similar=`, `FAILED after`, the parity and sha256 lines in the build log, the shadow SQL. No error tracking (pre-existing). |
| Resilience | 82% | The two-step flag flip and the recovery path are documented. The refusal below 0101 fails fast. The backend still has no `restart:` policy (pre-existing). |
| Performance | 70% | VPS A RSS and embed p95 are still not measured (step 1b is now placed correctly). |
| Security | 85% | No change. The token is used only as a build secret, `/similar` is owner-scoped, and no secrets appear in logs. |
| Deployment | 70% | The runbook gaps are closed. Still open: the release gate, the unbuilt image, the threshold-change step and the old-image tag. |

## Status of earlier findings

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| C1 | Release gate (≥300 pairs) not run; 0.86 provisional | **Residual: blocker** | `rules.py:17` is still 0.86. The runbook still says "before any deploy" (`architecture.md:774`). |
| C2 | Production image never built with `hf_token` | **Residual: blocker until step 1 succeeds** | The work-log (lines 152 and 192) still lists the build as not run. The embed `RUN` sits after the required-secret Bielik `RUN` (`Dockerfile:33-60`). |
| W3 | Unpinned `models` stage; no weight hash; thin margin | **Resolved** (minor residuals: risks 4 and 5) | `Dockerfile:22-29` pins optimum 2.1.0, onnxruntime 1.32.0, onnx 1.23.2, transformers 4.57.6, tokenizers 0.22.2, numpy 2.5.5 and huggingface_hub 0.36.2. `model.sha256` is written and printed (`:57-58`). Runbook step 1 says to keep the hash and re-gate on a changed hash. |
| W11 | Dangling references to 0102 | **Resolved** | No `0102` in `architecture.md`. The wording is now "any later revision chains after it". `alembic/versions` ends at `0101_want_similar.py`. |
| W12 | Suites ran on the 0102 tree | **Resolved** | `test-suite-results.md`: backend 2 F / 1575 P / 1 S (both failures are on the known baseline), matcher 123 passed, ruff, mypy and frontend all equal to the baseline, on the tree without 0102. |
| W14 | Failed model load stops the API; flag flipped in the same `up -d` | **Resolved in the runbook** (pre-existing residual) | Step 4.3 starts the backend with the flag off and checks `/api/health`. Step 4.4 flips the flag with `up -d backend` and notes that `restart` does not re-read the environment. A recovery paragraph is added. The backend still has no `restart:` policy, as the runbook states. |
| W15 | VPS A not measured; step 0b before the build it needs | **Partly resolved** | It is now step 1b, after the build, with pass criteria (≥ about 130 MB headroom, p95 within 2 s, target ≤ 50 ms, "Do not go on when either fails"). The measurement itself is still an operator step. |
| W16 | No pre-swap OS or collation check, no fix path | **Resolved** | Step 3 adds the pre-swap `os-release` trixie check, records the digest for revert, queries both `pg_database` and `pg_collation`, and gives a fix path: `REINDEX` plus `REFRESH COLLATION VERSION`, or revert to the recorded digest. |
| W17 | Web rebuild during shadow exposes the UI; web must never run ahead | **Resolved** | A "Release freeze for web" paragraph covers step 1 to step 8. "The web image must never run ahead of the backend" is now explicit. The W2 frontend fallback (`.catch(() => NO_SIMILAR)`) also removes the hard failure. |

## Shadow deploy assessment

**What is exposed during shadow (runbook steps 1–7):**
- Synchronous embeds on product and want writes, bounded by `EMBED_TIMEOUT_SECONDS = 2`. Misses fail open.
- About 130 MB more API RSS.
- A backfill that moves `changed_at` on every listing. The window re-reads each one once; existing pairs are protected by ON CONFLICT, so bells should not change.
- SIMILAR rows stored with the provisional 0.86, born seen, with no bells.
- `GET /api/wants/{id}/similar` reachable by the want owner through the API only. No UI exists while web is frozen.
- The W1 behaviour: a SIMILAR row later upgraded to MATCH by the lexical window is born unseen and rings its bell. That is the per-word tier's normal behaviour, not a SIMILAR leak.

**What is not exposed:** the quality of the SIMILAR cards, which is the only thing the release gate measures. Shadow data (step 7's histogram and the 100-pair spot check) actually informs the gate.

**Verdict: GO WITH MITIGATIONS.** The conditions are:
1. Amend the runbook so that the release gate applies "before step 8 (web)" rather than "before any deploy", signed off by the release owner.
2. Step 1 succeeds: parity ≥ 0.99, hash recorded, `model_id.txt` matches (closes C2).
3. Step 1b passes on VPS A.
4. Tag the current backend image (and later the matcher image) before rebuilding (risk 2).
5. Add the threshold-change step between the gate and step 8 (risk 1).
6. Confirm the base 0099 wants release status (risk 3).

## New runbook consequence: the backend refuses to start below 0101

**Behaviour:** `_check_similar_schema()` raises `schema lacks migration 0101 (…) ; run alembic upgrade head` in the lifespan before anything else loads, even when `EMBEDDINGS_ENABLED=false`.

**Under compose, it is mostly invisible.** The backend `command` is `sh -c "alembic upgrade head && exec uvicorn …"` (`docker-compose.yml:28`), so every compose start of the new image migrates first. The refusal fires only in three cases:
- an entrypoint skipped the migration (host `uvicorn`, a custom `compose run`);
- the database was downgraded below 0101 after the image started;
- it guards a migration that failed. With `&&`, uvicorn never starts then anyway.

`alembic/env.py` does not import `app.main`, so `docker compose run --rm backend alembic …` is not affected.

**Why step 4.2 must run before the new backend starts.** The refusal itself is not the reason, because compose would migrate on its own. The reasons are:
- **The matcher's locks.** A compose-driven `upgrade head` with the old matcher still running can hit 0101's 5 s `lock_timeout`. The container then exits, and with no `restart:` policy the API stays down.
- **The pgvector image.** If postgres is still `postgres:18`, `CREATE EXTENSION vector` fails, and the API is down in the same way.
- **The checks.** The explicit step-4.2 path also runs the `\dx vector` check between 0100 and 0101.

In every failure case the database stays at 0099, because each revision runs in its own transaction and rolls back, so recovery is the old image. That makes risk 2 (keeping the old image) a real precondition.

**Effect on rollback.** The kill switch (rollback 2) does not decouple the code from the schema: the new image cannot run on 0099 or 0100 with the flag off. That matches "no image-only rollback", and the runbook states it. After a full revert (rollback 4), `up -d` with the new image still tagged would re-apply 0100–0101 through the compose `command`. The old image therefore has to be retagged before `up -d`, which risk 2 covers again.

**Local development.** A dev database below 0101 stops a host `uvicorn` until someone runs `alembic upgrade head`. The error message says so, and the effect is local only.

**Assessment:** sound. The ordering in steps 3, 4.1 and 4.2 is correct and sufficient. One line is worth adding to step 4: "never `docker compose up` (any service) between step 1 and step 4.2: the new backend image migrates on start".

## Blockers (Must Fix)

### B1 / C1. Release gate not met
- **Location**: runbook "Release gate, before any deploy"; `src/matcher/matcher/rules.py:17`
- **Issue**: the labelled sample has not been scored. 0.86 is provisional.
- **Fix**: run the sweep on the step-1 export (hash-matched) and set the value, or drop the tier. Alternatively, rescope the gate to "before step 8" so a shadow deploy can go ahead.
- **Fixable**: no (operational).

### B2 / C2. Production `runtime` image not built
- **Location**: `src/backend/Dockerfile` `models` stage
- **Issue**: the `hf_token` build has never run. The in-image embed export and parity check are not proven.
- **Fix**: runbook step 1 (`HF_TOKEN` checked for presence only, never printed). Keep the parity and sha256 lines.
- **Fixable**: no (needs the secret and the build host).

## Concerns (Should Fix)
- **N1. Threshold-change step missing** (risk 1). Add the purge and re-flag procedure for a gate value other than 0.86, before step 8. Docs only.
- **N2. Old backend image not kept** (risk 2). Add `docker tag` before step 1 and step 6. Correct step 3's "may run again" to "`docker compose start` only, or the tagged image". Docs only.
- **W15 residual. VPS A measurement (step 1b)** has not been run yet. Operator step.

## Recommendations (Nice to Have)
- R1. Add to step 4: "never `docker compose up` between step 1 and step 4.2".
- R2. Run `check_embed_parity.py` once in the runtime container (onnxruntime 1.30.0), or align the runtime pin with the quantizer's 1.32.0 (risk 4). Print `onnxruntime.__version__` on the parity line.
- R3. Pre-existing: add `restart: unless-stopped` to `backend`. Firewall or unpublish 5432 and 8080 on VPS A. Consider error tracking.
- R4. W13 (deferred): run `/maister:standards-update` for `backend-testing.md` (`postgres:18` → pgvector image), the side-table carve-out, and the "parity gate after every int8 step" rule.

## Next Steps
1. Release owner: decide whether the release gate moves to "before step 8". If not, nothing deploys until C1 is done.
2. Amend the runbook with N1 and N2 (and R1).
3. Confirm the base 0099 wants release status.
4. Tag the current images, then run step 1 (C2). Compare the hash with 4552576b…1e08.
5. Run step 1b on VPS A.
6. Shadow deploy: steps 2–7.
7. Release gate sweep, then the threshold-change step (N1), then step 8.
