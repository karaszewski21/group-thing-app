# Production Readiness Report

**Date**: 2026-10-05
**Path**: uncommitted moderation-policy changes (`src/backend/app/moderation/*`, `app/config.py`, `app/main.py`, `app/core/errors.py`, `Dockerfile`, `docker-compose.yml`, `.env.example`, migrations 0047/0048)
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO WITH MITIGATIONS. Ship with both flags off (the defaults). Turn on `MODERATION_TEXT_ENABLED` only after the production image and memory are confirmed. Turn on `MODERATION_IMAGE_ENABLED` only after VPS B exists and is reachable over TLS.
- **Overall Readiness**: 78%
- **Deployment Risk**: Medium. With both flags off the change is mostly a schema cleanup. The main risks are rolling back past 0048 and baking secrets into the image.
- **Blockers (introduced by this change)**: 0. **Concerns**: 9. **Recommendations**: 5.
- Some gaps exist across the whole project and are not caused by this diff: no error tracking (Sentry), no rate limiting, no metrics. These would be blockers by the generic checklist. They are listed separately and do not decide this verdict.

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 75% | With concerns (stale-flag hazard, no threshold/URL validation, `.env` baked into image) |
| Monitoring | 65% | With concerns (startup INFO line not emitted by the API, worker has no liveness signal) |
| Resilience | 90% | Good (fail-closed 503, lease/backoff, 5 attempts then NEEDS_REVIEW, total deadline) |
| Performance | 80% | With concerns (model memory and CPU in the API process, 512-token truncation) |
| Security | 75% | With concerns (bearer token and image sent over a URL that may be plain HTTP; `.env` in image) |
| Deployment | 70% | With concerns (rolling back past 0048 is not documented, no prod manifest, HF secret needed for default build) |

## What was verified as sound
- **Text fail-closed**: `text_guard.check_text` (`app/moderation/text_guard.py:58-80`) returns 503 `ModerationUnavailable` when the classifier is missing or raises, and logs at ERROR with the traceback. The handler is registered before `ValueError`, so the 503 is not swallowed (`app/core/errors.py`).
- **Startup fail-fast**: `app/main.py:79-84` loads the model in the lifespan. A missing or corrupt model aborts startup, so the API never runs "enabled but no model". The ML import happens only when the flag is on.
- **Worker config validation**: `app/moderation/worker.py:26-43` refuses to start with the image flag on but no `MODERATION_AI_URL`, `MODERATION_AI_TOKEN` or `SPACES_*`. With the flag off it exits 0, and compose has no restart policy, so it does not crash-loop.
- **VPS B timeouts/retries**: httpx has a per-operation timeout (`ai_client.py:60`). `asyncio.timeout(moderation_ai_timeout_seconds)` puts one deadline on fetch plus call (`service.py:259`). The lease is `timeout + 30*2^(n-1)` seconds, so it always outlasts the deadline (`service.py:137-145`). No transaction or row lock is held during the call. Lost-lease guards stop double finalization. Attempt 5 sets FAILED and moves the photo to NEEDS_REVIEW (`service.py:271-306`). A crash on the final attempt is caught by `claimed > MAX_ATTEMPTS` (`service.py:323`).
- **Secrets**: the token is not logged. `last_error` stores the exception text (the httpx message has the URL, not the headers). The HF token is a BuildKit secret mount and does not persist in any layer.
- **Image payload**: the worker sends the 1600px WebP (`product/images.py:18`), not the 15 MB original, so base64 JSON bodies stay small.
- **Worker image**: built from plain `builder` with no onnxruntime or models. Small.
- **Migrations**: a single head (0046 -> 0047 -> 0048). No `text_status` or `text_moderated_hash` references remain in `app/`. 0048 has a downgrade that restores the columns, index and server default. 0047 is data-only, and its no-op downgrade is explained.

## Blockers (Must Fix)
None introduced by this change while the flags stay off.

## Concerns (Should Fix)

1. **[warning, deployment] Rolling back past 0048 is not documented, and the old image cannot start on the new schema.** `src/backend/alembic/versions/0048_drop_product_text_status.py:31-34`; `docker-compose.yml:40`.
   The old image's command runs `alembic upgrade head`. It does not know revision 0048, so it fails with "Can't locate revision", and its ORM still selects `products.text_status`. A rollback must run `alembic downgrade 0046` with the **new** image first, then redeploy the old image. The deployment order in spec.md covers only the forward path.
   Fix: add a rollback section to spec.md and architecture.md. Fixable: true.

2. **[warning, deployment] 0048 is not zero-downtime.** Same file.
   The drop happens in the same deploy that removes the ORM column, so any old API process still serving after the migration fails on every product query. On a single VPS with compose recreate this is a few seconds of errors, which is acceptable. Make sure no old API or worker container keeps running alongside (spec step 1). The alternative, expand/contract (drop the column in a later release), is optional at this scale. Fixable: true.

3. **[warning, security/configuration] `src/backend` has no `.dockerignore`, so `COPY . .` bakes `src/backend/.env` (JWT_SECRET, DATABASE_URL) and the local `.venv` (302 MB, Windows) into the build context and image layers.** `src/backend/Dockerfile:16`.
   `Settings` uses `env_file=".env"` (`app/config.py:19`), so the baked dev `.env` becomes the **fallback** value for any variable the production environment forgets. This existed before this change. It matters more now because the production image has to be built on a machine that has `HF_TOKEN`, most likely the dev workstation.
   Fix: add `src/backend/.dockerignore` excluding `.env`, `.venv`, `__pycache__`, `.*_cache` and `tests`. Fixable: true.

4. **[warning, security] VPS B traffic may be plain HTTP between hosts.** `app/moderation/ai_client.py:44-67`; `app/moderation/worker.py:31-38`.
   The bearer token and every unapproved user photo go to `MODERATION_AI_URL` with no scheme check. If VPS B is reached over the public internet with `http://`, both travel in cleartext.
   Fix: make the worker startup check require `https://` (or document a WireGuard/private network). Fixable: true.

5. **[warning, configuration] Stale `MODERATION_ENABLED` silently approves photos.** `.env.example:33-35`; `app/config.py:19` (`extra="ignore"`).
   The local `.env` still has `MODERATION_ENABLED=true` (line 29). Any environment that still sets it gets instant photo approval and no error. This is documented, but a startup WARNING when the legacy variable is present would cost one line.
   Fix: log a warning in the lifespan and the worker when `os.environ` or `.env` contains `MODERATION_ENABLED`. Fixable: true.

6. **[warning, monitoring] The API never emits the startup flag line.** `app/main.py:74-78`.
   Only the worker calls `logging.basicConfig` (`worker.py:65`). Under uvicorn the root/app logger stays at WARNING, so `logger.info("MODERATION_TEXT_ENABLED=...")` is dropped. Spec item 1 depends on this line being visible "so a deploy that omits a flag is visible in the logs". The same applies to `ai_client.py:69` timing logs if the client is ever used in the API.
   Fix: log at WARNING, or configure the `app` logger level at startup. Fixable: true.

7. **[warning, performance] Model memory and CPU in the API process.** `src/backend/Dockerfile:63-73`; `app/moderation/onnx_models.py:31-37`.
   Bielik-Guard 0.1B in fp32 ONNX plus onnxruntime is roughly 0.5-0.8 GB RSS in the API process (an estimate, not measured). Each uvicorn worker process would load its own copy. `intra_op_num_threads=1` limits each inference, but concurrent requests run in the default thread pool (up to cpu+4 threads), so a burst of writes can use all cores that serve HTTP.
   Fix: measure RSS and image size of the `runtime` target before enabling, keep a single uvicorn process, and optionally cap concurrency with a semaphore. Fixable: false (sizing).

8. **[warning, security/policy] Text past 512 tokens is not scored.** `app/moderation/onnx_models.py:24,57`.
   Descriptions allow 2000 characters (`product/schemas.py:55`). Polish text at 2000 characters can exceed 512 tokens, so offensive content placed at the end passes unscored.
   Fix: score overlapping 512-token windows and take the max per label, or cap description length to fit. Fixable: true.

9. **[warning, deployment] There is no production deployment manifest, and the default build needs a gated secret.** `src/backend/Dockerfile:1-5,28`; `docker-compose.yml:37,56`.
   The only compose file pins `runtime-dev` and hardcodes `MODERATION_TEXT_ENABLED: "false"`. Production text moderation therefore needs a separate, undocumented compose/override that builds the default `runtime` target with `--secret id=hf_token`. That needs an HF account that has accepted the Bielik-Guard license. A build without the secret fails, which is good.
   Fix: add a `docker-compose.prod.yml` (or a documented override) and a build command in the README. Fixable: true.

## Recommendations (Nice to Have)
1. **Threshold validation** (`app/config.py:47-50`): add Pydantic `Field(ge=0, le=1)` and a model validator for `review <= reject`. A typo such as `0.09` or `9` currently rejects all text or approves all photos. Fixable: true.
2. **Worker liveness** (`app/moderation/worker.py:53-61`): the worker has no healthcheck or heartbeat. Add a compose `restart: unless-stopped` (only when the flag is on) and an alert on the age of the oldest PENDING `moderation.photo_requested` event or on FAILED events. Today a dead worker shows only as photos stuck in PENDING.
3. **Graceful SIGTERM in the worker**: there is no handler. A kill mid-call is recovered by the lease (one attempt is used up), so this is acceptable. A handler that finishes the current event would be cleaner.
4. **Storage fetch under `asyncio.timeout`** (`service.py:259-261`, `storage/service.py:79-81`): boto3 runs in `to_thread`, so a timeout cancels the await but not the thread. Set `connect_timeout`/`read_timeout` in the boto `Config`. Low impact with one worker.
5. **Reuse the httpx client** (`ai_client.py:60`): a new `AsyncClient` (and TLS handshake) per photo is fine at current volume. Reuse it if throughput grows.

## Pre-existing, project-wide gaps (outside this diff)
- No error tracking (Sentry or similar). The new `logger.error` / `logger.exception` lines go only to stdout.
- No metrics. Moderation latency, reject rate and 503 rate are not instrumented.
- No rate limiting on write endpoints. Each text write now costs CPU inference, so this gap matters a little more once text moderation is enabled.
- `/api/health` (`app/system/router.py:63-65`) is static and checks neither the DB nor the classifier. That is acceptable for the classifier because startup fails fast without it.

## Next Steps
1. Before merge: document the rollback procedure for 0048 (Concern 1) and add `src/backend/.dockerignore` (Concern 3).
2. Before enabling text moderation in production: build the `runtime` target with the HF secret, measure memory and image size (Concern 7), fix the startup log level (Concern 6), and decide on long-text windowing (Concern 8).
3. Before enabling image moderation: VPS B deployed, https or private network enforced (Concern 4), worker liveness alert (Recommendation 2), flag set on both API and worker.
4. Optional: legacy-flag warning (Concern 5) and threshold validation (Recommendation 1).
