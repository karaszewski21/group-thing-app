# Code Review Report

**Date**: 2026-10-05
**Path**: working tree of `C:\Users\karas\Desktop\swaptime\group-thing-app` (54 modified + 13 untracked files; text/image moderation policy)
**Scope**: all (quality, security, performance, best practices)
**Status**: Issues Found (no critical issues)

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues
- **Info**: 9 issues

Overall the change is careful and well structured. ONNX inference runs off the event loop (`asyncio.to_thread`). The worker uses three short phases: claim with `FOR UPDATE SKIP LOCKED` and `attempts` as the lease, score with no transaction open, then finalize with an `attempts == claimed` guard. There is a crash-at-limit path and a re-read `FOR UPDATE` of the photo so an admin's decision is never overwritten. Errors are fail-closed (503) and don't leak internals: no scores or user text are logged, and the 503 message is fixed. Photo scores are exposed only through the ADMIN-only queue, and the VPS B response is validated strictly (`_parse` rejects bools, missing categories and non-objects). The migrations separate data (0047) and schema (0048) changes. Ruff on all new files is clean. The ruff findings in touched files (I001/E501 in circles.py, terms.py, organizations/service.py, term_item_listings.py, repository.py) all exist at HEAD already, so this change did not introduce them.

## Critical Issues
None.

## Warnings

### W1. A partial `set_public` failure can leave a non-approved photo publicly readable
- **Location**: `src/backend/app/moderation/service.py:116-120`, `:222-225`, `:430-432`
- **Description**: `_set_photo_files_public` sets the ACL on `large_key` and then on `thumb_key` as two separate network calls. If the AI outcome is APPROVED and the first call succeeds but the second fails, the DB transaction is rolled back and the photo stays PENDING (later possibly NEEDS_REVIEW after 5 attempts). The large file is already public-read on the CDN, though. An admin who then REJECTs it from NEEDS_REVIEW goes through `decide()`. There `was_public` comes from the DB status (not APPROVED, so False) and the outcome is REJECTED, so `set_public(False)` is never called and the large file stays public.
- **Risk**: Content that failed or never finished moderation can be served publicly. Low probability (it needs a Spaces error between the two ACL calls), but it affects exactly the content moderation is meant to hide.
- **Recommendation**: In `decide()`, when the outcome is not APPROVED, always call `set_public(False)` (idempotent), not only when the DB says the photo was approved. Or, on the worker's failure path, best-effort revert both ACLs to private.
- **Fixable**: true

### W2. Text past 512 tokens is never scored (truncation bypass)
- **Location**: `src/backend/app/moderation/onnx_models.py:54`, `:87`; call sites `src/backend/app/product/service.py:127-128,146-147,428`, `src/backend/app/plugin/service.py:150-157`
- **Description**: The tokenizer truncates to 512 tokens, so only the head of the text is classified. Product descriptions allow 2000 characters, which can exceed 512 tokens for Polish text. The `replace_plugin_data` path (`ai-description`) has no length limit at all. Someone can put a benign prefix in front of harmful content and the harmful part is never scored.
- **Recommendation**: Score overlapping 512-token windows and take the max per label, or cap moderated fields at a length that is guaranteed to fit (and add a `max_length` to the shared description written via `replace_plugin_data`).
- **Fixable**: false (design choice: chunking vs. cap)

### W3. Synchronous ONNX inference shares the default thread pool with no concurrency bound
- **Location**: `src/backend/app/moderation/text_guard.py:73`
- **Description**: `asyncio.to_thread` uses the loop's default executor (min(32, cpu+4) threads). That pool is also used by every boto3 storage call (`app/storage/service.py:69-95`). Under a burst of writes, many concurrent inferences (each with `intra_op_num_threads=1`) can saturate the API VPS CPU and starve both photo uploads and the event loop. Each uvicorn worker process also loads its own copy of the model.
- **Recommendation**: Run inference through a small dedicated executor or an `asyncio.Semaphore` (e.g. 1-2 concurrent inferences per process). Document the per-process memory cost if uvicorn ever runs with `--workers > 1`.
- **Fixable**: true

### W4. The VPS B bearer token can be sent over plain HTTP
- **Location**: `src/backend/app/moderation/worker.py:31-42`, `src/backend/app/moderation/ai_client.py:139-146`
- **Description**: The startup check only checks that `MODERATION_AI_URL` is non-empty. VPS B is a separate host, so an `http://` URL would send the bearer token and every user photo across the network in cleartext.
- **Recommendation**: In `_startup_check`, require the `https://` scheme, or allow plain HTTP only for an explicit private-network or localhost host.
- **Fixable**: true

## Informational

- **I1. Network I/O while row locks are held** — `src/backend/app/moderation/service.py:263-268`, `:427-433`. In phase 3, `_complete_event` and the photo `FOR UPDATE` are held while the Spaces `set_public` calls run, and `decide()` does the same. It is bounded and acceptable for a single replica, but it goes against the stated "no transaction open during network calls" principle. Consider setting the ACLs before the finalize transaction (they are idempotent).
- **I2. A new `httpx.AsyncClient` per call** — `src/backend/app/moderation/ai_client.py:139`. There is no connection or TLS reuse. Negligible at one call per photo, but a long-lived client opened in `worker.main` would be cleaner.
- **I3. `asyncio.timeout` does not stop the boto3 thread** — `src/backend/app/moderation/service.py:259-261`. Cancelling `storage.get` (which runs in `to_thread`) leaves the boto3 request running in the background. The lease stays correct. Just be aware of it.
- **I4. `datetime.utcnow()` is deprecated in Python 3.12** — `src/backend/app/moderation/service.py:134`. This matches the existing project convention (`app/outbox/dispatcher.py:75`) and the naive-UTC columns. Track it as a project-wide cleanup (`datetime.now(UTC).replace(tzinfo=None)`).
- **I5. A stale `MODERATION_ENABLED=true` is silently ignored** — `src/backend/app/config.py:42-43`, documented in `.env.example`. A production `.env` that still sets the old flag will approve photos on upload. Consider logging a warning at startup when the legacy env var is present. The startup log in `main.py:74` helps already.
- **I6. Untested paths** — `tests/test_moderation_worker.py`. There are no tests for the crash-at-limit branch (`service.py:323-328`, `claimed > MAX_ATTEMPTS`), for the HTTP client's non-2xx and malformed-body cases (`ai_client.py:149-150`, `_parse` errors), or for the partial `set_public` failure in W1.
- **I7. Migration 0048 makes previously held-back product text visible** — `alembic/versions/0048_drop_product_text_status.py:95-98`. Products whose text was NEEDS_REVIEW or REJECTED under the old async pipeline become visible to all viewers once the column and its read filters are gone. This is acceptable because production never enabled moderation (as documented). Dev databases are affected only.
- **I8. Line length in the polling hook** — `src/frontend/src/hooks/useItemDetail.ts:54` is about 120 characters. Polling runs only while the owner has a PENDING photo and pauses in background tabs. If the worker is down, an open owner tab keeps polling every 10 s with no upper bound. That is acceptable, but a maximum polling duration could be considered.
- **I9. The `update_product` change detection compares against the legacy column** — `src/backend/app/product/service.py:147`. `data.description` is compared to `product.description`, not to the effective shared description. This is correct per spec (that endpoint writes the legacy column), and noted only for clarity.

## Metrics
- Max function length (new or changed code): ~45 lines (`_score_and_finalize` / `_fail_attempt`, `service.py`)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 3 (W1 exposure edge case, W2 truncation bypass, W4 cleartext token)
- N+1 query risks: 0 (the queue uses one batched `_latest_ai_decisions` query and `QUEUE_LIMIT=100`)
- Blocking calls in async paths: 0 (ONNX and boto3 both run via `to_thread`)
- Ruff on new files: clean. Issues in touched files exist at HEAD already.

## Prioritized Recommendations
1. W1: make the admin REJECT path always force files private, or revert the ACLs on a failed finalize.
2. W4: require HTTPS for `MODERATION_AI_URL` before sending the token and photos.
3. W2: score long texts in windows (max per label), or enforce a token-safe length cap, including on the `replace_plugin_data` path.
4. W3: put a small semaphore or dedicated executor around text inference.
5. I6: add tests for the crash-at-limit branch and the non-2xx/malformed VPS B responses.
6. I5: warn at startup when the legacy `MODERATION_ENABLED` is set.
