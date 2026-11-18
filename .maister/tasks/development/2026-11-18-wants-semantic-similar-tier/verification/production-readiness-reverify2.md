# Production Readiness Re-verification 2: wants semantic SIMILAR tier

**Date**: 2026-11-18
**Path**: `.maister/tasks/development/2026-11-18-wants-semantic-similar-tier` (current working tree, after fix cycle 2)
**Target**: production (VPS A, docker compose: postgres, backend, matcher, web, nginx)
**Status**: Shadow deploy (steps 1–7): With Concerns. Full release (step 8): Not Ready.

## TL;DR
- **(a) Shadow deploy, runbook steps 1–7: GO WITH MITIGATIONS.** Every fix that code or docs could make is done: R-N1, R-N2, RR-1, the gate rescope and the never-up rule. What is left is operator work before and during step 1: sign-off, image tags, the `hf_token` build (C2) and the 1b measurement (W15).
- **(b) Full release, step 8 (web): NO-GO.** C1, the labelled-sample gate, is still open. It is now correctly scoped to "before step 8", and 7b/7c are its exit path. Code cannot close it.
- Cycle-2 suites match the baseline: backend 2 F / 1577 P / 1 S, matcher 125 passed, frontend 33 F with identical ids, and ruff/mypy/typecheck/lint all at baseline. No regressions.
- One small new runbook nit (N3): steps 4.3 and 6 should use `up -d --no-build`, so a missing old web image can never be rebuilt from the new tree. Open from before: the base 0099 release status still has to be confirmed.

## Key Decisions
- **The gate rescope is accepted as sufficient for shadow.** `architecture.md:774` now reads "Release gate, before step 8 (web deploy)" with a reason given: SIMILAR rows are born seen, ring no bell and have no UI while web is frozen. It also requires release-owner sign-off in the release notes **before step 1**, and `architecture.md:294` (the Wants section) now points at the same scope. The sign-off is a document act the operator still has to perform. Until it exists, the old "before any deploy" intent governs.
- **C2 stays a precondition, not a code blocker.** The Dockerfile path has not changed: the embed `RUN` (`Dockerfile:56-68`) still sits after the required-secret Bielik `RUN` (`:34`). The work-log does not record a successful full `hf_token` build. Step 1 fails closed when parity is below 0.99, so step 1 succeeding *is* the closure. If the recorded hash differs from 4552576b…1e08, the 7b sweep must run on the new hash. The runbook says so.
- **7c is the correct shape for a threshold change.** The order is: deploy the matcher with the new min (tagged `pre-threshold`), `DELETE … tier='SIMILAR' AND score < new_min`, then re-flag. `reads.py:282-286` and `SEMANTIC_CAP` still do not filter by score, which the runbook now states explicitly. A read-side filter would also work, but it isn't needed.
- **The `pre-semantic` tags plus "never `docker compose up` between step 1 and 4.2" close the rollback-target gap.** Rollback 4 now says to deploy only from the `pre-semantic` tags, never `up -d` while the compose tag still names the new backend.

## Open Questions / Risks
1. **Base 0099 release status (carried over, unconfirmed).** `architecture.md:296` still says the per-word wants feature must not deploy until its own ≥200-pair sample is scored. This runbook assumes production is already at 0099 with wants live. If it is not, the shadow deploy also ships the per-word backend, the matcher and MATCH bells. Confirm before step 1.
2. **N3 (new, low): `up -d` without `--no-build` in steps 4.3 and 6.** Compose builds any service whose image is missing. Step 4.3 brings up every service. If the old web image were pruned or absent, compose would build web from the new tree and expose „Powiązane rzeczy” before the gate, which would break the web freeze. Adding `--no-build` to 4.3 (and to 6 after its explicit build) removes the risk. The old web image is normally present because it is running, so the risk is low.
3. **onnxruntime 1.32 (quantizer) vs 1.30 (runtime)** (documented, low). The parity is never checked under the runtime version, and the margin is +0.0004. 1b times the model but does not check the cosine.
4. **The tree is uncommitted.** The cycle-2 suites ran on the current working tree. Build step 1 from exactly that tree, or re-run the suites on whatever is built.
5. **The backend has no `restart:` policy** (pre-existing). The runbook's recovery paragraph covers a failed model load by hand.

## Executive Summary
- **Recommendation**:
  - (a) Shadow deploy, steps 1–7: **GO WITH MITIGATIONS** (the operator preconditions below).
  - (b) Full release, step 8: **NO-GO** until 7b passes, and 7c runs if the value moves.
- **Overall Readiness**: about 90% (up from about 85%). The remaining gaps are operational.
- **Deployment Risk**: Medium for shadow (a schema change with no image-only rollback, but rollback targets are now preserved). Low for the code.
- **Blockers**: 2 (C1 for step 8 only; C2 before step 1 completes). **Concerns**: 3 (W15 measurement, 0099 base status, N3). **Recommendations**: 3.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 92% | `EMBEDDINGS_ENABLED` defaults to false (`docker-compose.yml:45`). The model id is pinned in three places with drift tests. No change. |
| Monitoring | 80% | Reconcile line, `similar=`, `FAILED after`, the parity/sha256 build lines, the 7 shadow metrics. No error tracking (pre-existing). |
| Resilience | 85% | CR-N4 reconcile timeout is 2.0 s (`embeddings/service.py:29`). CR-N7 checks expiry under the lock (`wants/application/embeddings.py:107-108`). CR-N5 frontend keeps the previous `similar` (`useWantMatches.ts:72`). The backend still has no restart policy. |
| Performance | 70% | VPS A RSS and embed p95 are still unmeasured (1b). |
| Security | 85% | No change. `HF_TOKEN` is a build secret only. The runbook checks presence only. |
| Deployment | 85% | Gate rescoped, 7b/7c added, `pre-semantic` tags, the never-up rule, rollback-3 re-flag. Still open: the build itself, the sign-off, N3. |

## Status of earlier items

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| C1 | Release gate (≥300 pairs) not run; 0.86 provisional | **Residual, scoped to step 8.** Not a blocker for steps 1–7 once the owner signs. | `rules.py:17` is still `0.86`. `architecture.md:774` reads "before step 8 (web deploy)" and requires sign-off before step 1. 7b (`:839`) is the exit, and dropping the tier is the alternative. |
| C2 | Production `runtime` image never built with `hf_token` | **Residual: precondition of the shadow deploy (closes when step 1 succeeds).** | The work-log cycle 2 records no full build. `Dockerfile:34` (secret-mounted Bielik RUN) comes before `:56-68` (embed, parity, sha256). |
| W15 | VPS A not measured | **Residual: operator step 1b.** | The runbook 1b has pass criteria (≥ about 130 MB headroom, p95 ≤ 2 s, target ≤ 50 ms, "Do not go on when either fails"). No measurement is recorded. |
| R-N1 | Threshold change leaks stored rows | **Resolved (docs).** | 7c: matcher deploy with the `pre-threshold` tag, DELETE below the new min, re-flag. "Future changes" points to 7c. The work-log cycle 2 "Docs" agrees. |
| R-N2 | Old images not kept; `up` between steps 1 and 4.2 migrates | **Resolved (docs).** | The "Keep the old images" paragraph has the backend tag before step 1 and the matcher tag before step 6 (also in step 6 itself). The "Never `docker compose up` between step 1 and step 4.2" paragraph allows only `up -d postgres`. Step 3 permits only `start` or the tags. Rollback 4 deploys from the `pre-semantic` tags only. |
| RR-1 | Rollback 3 has no re-flag; H1 while the old matcher runs | **Resolved (docs).** | Rollback 3 now states the lost upgrade in place (no lexical tier or bell for a stored SIMILAR row while the old matcher runs) and requires a re-flag with the step-6 `UPDATE` when the new matcher is redeployed. |

### The five shadow mitigations (from the previous re-verification)
| # | Mitigation | Status |
|---|------------|--------|
| 1 | A successful step-1 build (C2) | **Open (operator).** Needs `HF_TOKEN` (presence only), the parity ≥ 0.99 line, the `model.sha256` line, and `model_id.txt == EMBEDDING_MODEL_ID`. |
| 2 | A passing 1b measurement | **Open (operator).** |
| 3 | Gate moved to "before step 8" | **Resolved in the runbook.** Owner sign-off in the release notes is still to be recorded. |
| 4 | Threshold-change step | **Resolved** (7c). |
| 5 | Tag the old backend image (and the matcher) | **Resolved in the runbook.** The tag still has to be executed. |
| (6) | Confirm the base 0099 release status | **Open** (risk 1). |

## Cycle-2 code fixes (spot-checked)
- N1: `flush()` before `save_name_vector` in `product/service.py`, with a statement-order test (work-log).
- CR-N4: `RECONCILE_EMBED_TIMEOUT_SECONDS = 2.0`, used by both reconciles (`product/embeddings.py:186`, `wants/application/embeddings.py:190`).
- CR-N7: `status == ACTIVE AND expires_at > now` is in the locked select of the SIMILAR request path.
- CR-N3 / R1 / L5 (matcher): 125 tests pass, including the two-connection race test.
- CR-N5 (frontend): falls back to the previous `similar` through `getQueryData`.
- Suites: `verification/test-suite-results.md` (cycle 2) shows everything at baseline and no regressions.

## Blockers (Must Fix)
### C1. Release gate (step 8 only)
- **Location**: `src/matcher/matcher/rules.py:17`; runbook 7b
- **Issue**: the ≥300-pair held-out sweep has not been scored, so 0.86 is provisional.
- **Fix**: run 7b on the deployed int8 export (hash-matched), then run 7c if the value changes, or drop the tier.
- **Fixable**: no (operational).

### C2. Production image not built (before shadow)
- **Location**: `src/backend/Dockerfile` `models` stage; runbook step 1
- **Fix**: run step 1 with `HF_TOKEN` set (checked for presence, never printed). Keep the parity and sha256 lines with the release notes.
- **Fixable**: no (needs the secret and the build host).

## Concerns (Should Fix)
- **W15**: run 1b on VPS A before step 2.
- **Base 0099 status**: confirm that production is at 0099 with wants live, or that the 0099 gate has passed.
- **N3**: add `--no-build` to `up -d` in steps 4.3 and 6 (docs only, fixable).

## Recommendations (Nice to Have)
- Run `check_embed_parity.py` once inside the runtime container (onnxruntime 1.30.0), or align the pins.
- Add `restart: unless-stopped` to `backend` (pre-existing). Firewall 5432 and 8080 on VPS A.
- W13 (deferred): `/maister:standards-update` for the pgvector test image, the side-table carve-out and the parity-gate rule.

## Next Steps: operator steps before the shadow deploy
1. **Sign-off**: the release owner records the gate rescope ("before any deploy" to "before step 8") in the release notes.
2. **Confirm the base**: production is at 0099 with the per-word wants feature released, or its own gate is passed (`architecture.md:296`).
3. **Freeze the tree**: build from exactly the verified working tree (it is uncommitted), or re-run the suites on what is built.
4. **Start the web freeze** (no web build or rebuild until step 8). Optionally amend 4.3 and 6 with `--no-build` (N3).
5. **Tag the backend image**: `docker tag <project>-backend:latest <project>-backend:pre-semantic` (`docker compose images` names the image).
6. **Step 1 build**: `docker compose build backend` with `HF_TOKEN` present. Check for `embed parity: min cosine ≥ 0.99` and the `sha256` line in the log. Check that `model_id.txt` matches `EMBEDDING_MODEL_ID`. Compare the hash with 4552576b…1e08; a different hash means 7b runs on the new hash.
7. **Step 1b on VPS A**: RSS headroom of at least about 130 MB and embed p95 ≤ 2 s (target ≤ 50 ms). Stop if either fails.
8. Then continue with steps 2–7, obeying "never `docker compose up` between step 1 and 4.2". Tag the matcher `pre-semantic` before step 6.

**Before step 8**: 7b passes, 7c runs if the minimum moved, and the shadow metrics (bells and MATCH counts unchanged, spot check ≥ 0.80) look clean.
