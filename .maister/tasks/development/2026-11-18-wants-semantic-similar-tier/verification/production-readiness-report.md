# Production Readiness Report

**Date**: 2026-11-18
**Path**: `.maister/tasks/development/2026-11-18-wants-semantic-similar-tier` (the in-scope files of `verification/review-scope.md`)
**Target**: production (VPS A, docker compose: postgres, backend, matcher, web, nginx)
**Status**: Not Ready

## TL;DR
- **NO-GO.** The code and the runbook are in good shape. Two pre-deploy gates are still open: the labelled-sample release gate, and a full `runtime` image build that has never been run (`hf_token`, int8 export, parity gate).
- The image swap, the superuser `CREATE EXTENSION`, the migration order (stop the matcher, then `compose run alembic`), the "no image-only rollback" warning and the `EMBEDDINGS_ENABLED` kill switch are all correct and clearly documented.
- **Revision 0102 is gone from the working tree.** Only a stale `.pyc` is left. The runbook still points to "0102's runbook", which does not exist, and the test evidence came from a tree that still had 0102 in it.
- The `models` build stage does not pin onnxruntime, so the 0.9904 int8 parity is not reproducible. The production runtime uses 1.30.0.
- VPS A RAM and embed latency have not been measured (step 0b). A model-load failure stops the whole API from starting, and the backend has no restart policy.

## Key Decisions
- **The release gate is a blocker, not a concern.** The runbook says "Release gate, before any deploy". The provisional `SEMANTIC_SIMILARITY_MIN = 0.86` is not set from data yet. Only a held-out sweep on at least 300 labelled pairs can set it. That is an operational step, so code changes cannot clear it.
- **The unbuilt production image is a blocker.** The new Dockerfile `RUN` (snapshot download, optimum export, MatMul-only QInt8, parity script, `model_id.txt`) has never run end to end. The image that would ship has never existed.
- **VPS A measurement (step 0b) is a concern, not a blocker.** The runbook already makes it a required step with explicit pass criteria (about 130 MB RSS headroom, embed p95 well under 2 s). It must be done, but nothing in the code needs to change for it.
- **Pre-existing infrastructure gaps are listed for information only.** These are: Postgres published on host port 5432 with `aj:aj`, no error tracking, and no backend `restart:` policy. This task did not introduce them, and they do not count toward the verdict.

## Open Questions / Risks
1. **0102 release order (user decision).** The work-log records an untracked `0102_ledger_entries_on_inventories.py` with `down_revision = "0101"`. That file is no longer in `src/backend/alembic/versions/`. Only `__pycache__` bytecode of its test remains, and `app/inventory/*` and the two migration tests show no changes. Questions:
   - Where does 0102 live now?
   - Will it still chain on 0101?
   - Will it ship in the same image?

   The compose `command` runs `alembic upgrade head`, so any revision baked into the image is applied during this deploy. If 0102 is applied, a full semantic-tier revert has to downgrade the ledger change first. That couples two unrelated rollbacks.
2. **Test evidence vs. the final tree.** The full backend run (1562 passed) ran against a tree that still had 0102 and its inventory and test changes. Re-run the backend and matcher suites on the exact commit that will be built.
3. **Thin int8 margin.** The margin is 0.9904 against a 0.99 gate (+0.0004). The build fails closed, which is good. But an unpinned onnxruntime or optimum in the `models` stage can fail the build at random, or produce an export that differs from the measured one.
4. **Collation compatibility after the image swap.** Step 3 checks `datcollversion` after the swap but gives no fix if rows come back. It also checks only the database default collation, not `pg_collation` entries that are used by indexes.

## Executive Summary
- **Recommendation**: NO-GO
- **Overall Readiness**: about 75%
- **Deployment Risk**: Medium. Every downgrade loses only derived data, the kill switch exists, and the matcher is deployed in shadow first. The risk is mainly process, not code.
- **Blockers**: 2  **Concerns**: 8  **Recommendations**: 5

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 90% | Good. The flag defaults to false in `config.py`, compose and `.env.example`. The model id is pinned in three places with drift tests. |
| Monitoring | 80% | Good. The reconcile line, window `similar=`, `FAILED after`, the WARNING miss lines and the shadow SQL all exist. There is no error tracking (pre-existing). |
| Resilience | 80% | Good. Misses fail open, a stuck call is held as `busy`, and lost races give one WARNING. A model-load failure stops startup (fail closed) and the backend has no restart policy. |
| Performance | 70% | VPS A has not been measured. A synchronous embed of up to 2 s is added to product and want writes. The matcher costs were measured (forward SIMILAR p95 about 37 ms at 20k listings). |
| Security | 85% | No secrets in logs, the token is used only as a build secret, and `/similar` is owner-scoped under matrix row 66. The superuser role and the published 5432 port are pre-existing. |
| Deployment | 50% | The runbook is thorough, but the release gate is open, the image is unbuilt, 0102 is unresolved and onnxruntime is unpinned. |

## Verification of the requested focus points

### 1. Image swap and data directory: OK, with a minor gap
- `docker-compose.yml`: `postgres:18` becomes `pgvector/pgvector:0.8.7-pg18-trixie` on the same `postgres_data:/var/lib/postgresql` volume. Both images are PG 18 with the same PGDATA layout, so no `pg_upgrade` is needed. The test suites already use this image through testcontainers, so the tag exists.
- Runbook step 3 checks three things after the swap:
  - `SELECT version()` shows 18.x;
  - the collation-version query (`datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid)`);
  - `rolsuper`.
- Gap: there is no check *before* the swap that the running `postgres:18` really is a trixie build. Add `docker compose exec postgres cat /etc/os-release`, or the image digest. There is also no fix path if the collation query returns rows (go back to the old image, or `REINDEX` and `ALTER DATABASE … REFRESH COLLATION VERSION`). See Concern C5.

### 2. Migrations: OK
- `0100_pgvector.py` is `CREATE EXTENSION IF NOT EXISTS vector`. The compose `POSTGRES_USER aj` is a superuser in the official image, and the runbook checks it.
- The downgrade drops the extension unconditionally. The runbook adds the `pg_extension` ownership check before going below 0100.
- `0101_want_similar.py`:
  - schema only, under `SET LOCAL lock_timeout = '5s'`;
  - `CREATE OR REPLACE VIEW` keeps every 0099 column in place;
  - the downgrade restores a verbatim 0099 view copy;
  - it is covered by `tests/test_want_similar_migration.py`.
- Order (step 4):
  1. `stop matcher`, and the old backend if it was restarted;
  2. `compose run --rm --no-deps backend alembic upgrade 0100`, then `\dx vector`;
  3. `upgrade head`;
  4. only then `up -d` without `--build`.

  The order is correct. The lock-timeout retry note ("never start the backend in between") is right.
- The matcher gate `CONTRACT_REVISION = 101` is compared numerically, and it also checks `to_regclass` for both side tables. A later 0102 passes it.

### 3. Backend at revisions ≥0100: OK
- The runbook states: "There is **no image-only rollback** for the backend once the database is at 0100 or later". It also says: "Once the database is at 0101, never start an older backend image". Rollback level 4 runs from the **new** image, in the right order (stop matcher and backend, downgrade 0100, then 0099).

### 4. `EMBEDDINGS_ENABLED`: OK, one design caveat
- The default is false in `Settings`, `${EMBEDDINGS_ENABLED:-false}` in compose, and in `.env.example`.
- When it is false:
  - `_embed` returns `None` without a WARNING;
  - the reconcile returns at once;
  - the handlers return and use up their outbox rows;
  - stored vectors and SIMILAR rows stay readable.
- Startup refusal: `_check_embeddings_tables()` raises "EMBEDDINGS_ENABLED but … missing; run alembic upgrade head" before the model loads.
- Model-load failure: `OnnxEmbedder` → `read_model_id` raises on a missing or mismatched `model_id.txt`, and so does a broken `model.onnx`. This **stops lifespan startup** and the whole API is down. It does not degrade to "embeddings off". The behaviour is deliberate and noted in a comment. It is safe only because the model is baked in and checked at build time. Combined with no `restart:` policy on `backend` and flipping the flag in the same `up -d` as the first new-image start (step 4.3), it puts the API at risk. See Concern C3.
- Runtime misses (`missing`/`busy`/`timeout`/`error`) fail open. The WARNING logs only the reason, the count and the exception type, never the text.

### 5. Model artefacts: open
- 241 MB in the image, about 130 MB RSS, VPS A not measured. Step 0b is well specified, but it is numbered before step 1 even though it needs the built image ("against the built image's model"). Run it after step 1. The probe it mounts exists at `.maister/tasks/research/2026-11-18-wants-semantic-embeddings/analysis/models-probe/probe.py`.
- The int8 parity of 0.9904 against the 0.99 gate is enforced in the same `RUN` (`scripts/check_embed_parity.py`, exit 1 below the gate). But the `models` stage installs `torch==2.7.1` and `optimum-onnx[onnxruntime]==0.1.0` with every transitive dependency unpinned, onnxruntime included. The quantization and the parity check run under that version, and production inference runs under `onnxruntime 1.30.0` from `uv.lock`. See Concern C1.
- The full-image build with the `hf_token` secret has not been run. See Blocker B2.

### 6. Monitoring: OK
- Reconcile: `embedding reconcile: products=%d wants=%d misses=%d duration_ms=%d` (INFO when work was done, DEBUG otherwise), in `app/main.py::_run_embedding_reconcile`.
- Matcher: `window run: … capped=%s matches=%d suggestions=%d similar=%d …` in `matcher/window.py`.
- Outbox: `outbox entry %s (%s) FAILED after %d attempts: %s` (`app/outbox/dispatcher.py:78`). The handler's exception text holds only the product or want id.
- The shadow metrics in runbook step 7 (score histogram, spot check, `capped=True` share, forward p95, RSS, FAILED count, stale-vector counts, bell and MATCH baseline) are concrete SQL and log checks.
- No error tracking (Sentry or similar) exists in the project. This is pre-existing and project-wide.

### 7. Release gate: open (Blocker B1)
- `SEMANTIC_SIMILARITY_MIN = 0.86` is marked provisional in `matcher/rules.py`, `architecture.md` and the runbook. The runbook says the gate comes "before any deploy" and spells out the pass criteria: at least 300 pairs, a held-out Wilson lower bound ≥ 0.80, hard-negative false positives ≤ 10%, and the agreed recall gain, "Otherwise the tier is dropped". None of this has been done yet.

### 8. Revision 0102: changed since the work-log (Open Question 1)
- Current state: `src/backend/alembic/versions/` ends at `0101_want_similar.py`. No `0102_*.py` exists in any tracked or untracked path of this checkout. `git log --all` has no history for it. Only `tests/__pycache__/test_ledger_entries_on_inventories_migration…pyc` (13:23) is left.
- Remaining risks:
  - `architecture.md` lines 793 and 824 refer to "e.g. 0102" and "see its runbook". No 0102 runbook exists. See Concern C2.
  - If 0102 comes back with `down_revision = "0101"` and lands in the same image, `alembic upgrade head` (step 4.2 and the compose `command`) applies it in the same maintenance window. A semantic-tier full revert would then have to run the ledger downgrade first.
  - If 0102 comes back with a different parent (for example `0099`), Alembic gets two heads and `upgrade head` fails. That would also break the compose start.
  - Any local or dev database that was upgraded to 0102 now fails `alembic upgrade head` with "Can't locate revision 0102". This is local only.

## Blockers (Must Fix)

### B1. Release gate not met
- **Where**: runbook "Release gate, before any deploy"; `src/matcher/matcher/rules.py::SEMANTIC_SIMILARITY_MIN`
- **Issue**: the labelled sample (at least 300 pairs, kappa overlap, strata) has not been scored on the deployed int8 export. The threshold 0.86 is provisional.
- **Fix**: do the operational step. Then set the threshold from the held-out sweep, or drop the tier. Strictly, this blocks only the matcher (step 6) and web (step 8) parts. The runbook says "before any deploy", so it blocks the whole release as written.
- **Fixable in code**: no (operational).

### B2. Production `runtime` image never built
- **Where**: `src/backend/Dockerfile` `models` stage (new embed `RUN`), `COPY --from=models /models/embed`
- **Issue**: the snapshot download, `optimum-cli export`, `quantize_dynamic` (MatMul only), parity gate and `model_id.txt` write have only been run piecewise outside Docker. The `hf_token` build has not run.
- **Fix**: run `docker compose build backend` with `HF_TOKEN` present (check presence only, never print it). Confirm that the log line `embed parity: min cosine … (gate 0.99)` passes and that `/models/embed/model_id.txt` equals `EMBEDDING_MODEL_ID` (runbook step 1). Then run step 0b on that image.
- **Fixable in code**: no (needs the build environment and the secret).

## Concerns (Should Fix)

- **C1. Unpinned onnxruntime and optimum in the `models` stage** (`src/backend/Dockerfile`). The parity is measured under whatever onnxruntime resolves at build time, and production runs 1.30.0. Pin `onnxruntime==1.30.0`, plus the `optimum`, `transformers` and `huggingface_hub` versions measured on 2026-11-18, in that `pip install`, so that the measured 0.9904 is reproducible.
- **C2. The runbook refers to a 0102 runbook that does not exist** (`architecture.md` steps 4.2 and rollback 4). Decide where 0102 goes:
  - recommended: ship 0100–0101 alone, and add 0102 in a later deploy after the shadow period;
  - or re-chain 0102 before 0100 if it has to ship first.

  Then update the two references. Build the release image from a tree whose head is exactly the intended revision.
- **C3. Model-load failure takes the API down.** The relevant files are `app/main.py` lifespan, and `docker-compose.yml` (the backend has no `restart:` policy). In step 4.3, first start the new backend with `EMBEDDINGS_ENABLED=false` and check `/api/health` and the startup log. Then set `true` and run `up -d backend`. Write the recovery into step 4.3: "on a startup failure, set `EMBEDDINGS_ENABLED=false` and `up -d backend`".
- **C4. VPS A not measured (step 0b)**, and the step is in the wrong place. Move it after step 1. Record RSS headroom and embed p95. The p95 also bounds the added write latency, because every product create or rename and every want create or edit waits up to 2 s for the embed.
- **C5. Collation check is incomplete** (runbook step 3):
  - add a pre-swap OS or digest check of the running `postgres:18`;
  - extend the check to `pg_collation` (`collversion IS DISTINCT FROM pg_collation_actual_version(oid)`);
  - give the fix path: go back to the old image, or `REINDEX DATABASE` and then `ALTER DATABASE aj REFRESH COLLATION VERSION`.
- **C6. Shadow period depends on not rebuilding `web`.** The SIMILAR section ships in the same change set with no UI switch. Any `docker compose build web` for an unrelated fix during the 2–4-week shadow window shows „Powiązane rzeczy” before the gate. Either hold every web release until step 8, or say so explicitly in the runbook.
- **C7. The frontend needs the new backend route.** `hooks/useWantMatches.ts` fetches `/similar` inside one `Promise.all`, so a 404 from an older backend fails the whole want page. Rollback order "web first" is correct (rollback 1 before 4). Add a line that the new web image must never run against a backend older than this release.
- **C8. Test evidence is not from the final tree.** The suites ran with the parallel 0102 and inventory changes present, and those changes have since been withdrawn. Re-run the backend suite (alone, see `full-suite-results.md`) and the matcher suite on the commit that will be built.

## Recommendations (Nice to Have)
- R1. In step 4.2, show the planned revisions before upgrading (`alembic history -r current:head`), so that an unexpected 0102 is noticed.
- R2. In step 6, rebuild the matcher only with `docker compose build matcher`. Before step 4.3, check that the old matcher image still exists locally (`docker image ls`). If it was pruned, `up -d` rebuilds it from the new tree and starts the ≥ 101 matcher early.
- R3. Add the `onnxruntime` version string to the parity log line, so a drift shows up in build logs.
- R4. Pre-existing, outside this diff: remove the host port `5432:5432` (and `8080:8080` if nginx fronts it) on VPS A or firewall it, move the `aj:aj` credentials to `.env`, add `restart: unless-stopped` to `backend`, and consider error tracking.
- R5. Follow-up from the work-log: run `/maister:standards-update` for `backend-testing.md` (still says `postgres:18`), for the side-table carve-out, and for the parity-gate rule.

## Next Steps
1. Settle 0102 (C2): where it is, its parent, and whether it ships with this image. Fix the two runbook references.
2. Pin the `models`-stage dependencies (C1). Build the full `runtime` image with `hf_token` (B2) and confirm parity and `model_id.txt`.
3. Run step 0b on VPS A with that image (C4).
4. Re-run the backend and matcher suites on the final commit (C8).
5. Do the release-gate labelling and sweep (B1). Set `SEMANTIC_SIMILARITY_MIN` or drop the tier.
6. Amend the runbook: pre-swap OS check, `pg_collation` and its fix path (C5); a two-step flag flip with the recovery line (C3); the web freeze during shadow (C6, C7).
7. Then run the runbook from step 1. With B1 and B2 closed, the verdict would become GO WITH MITIGATIONS, using the staged backend → shadow matcher → web rollout.
