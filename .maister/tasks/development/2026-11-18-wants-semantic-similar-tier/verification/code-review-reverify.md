# Code Review Report: re-review after the verification fixes

**Date**: 2026-11-18
**Path**: the In-scope files of `verification/review-scope.md`, plus `src/backend/app/db.py`
**Scope**: all (quality, security, performance)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issues. All 4 warnings and 4 of the 11 info items from the previous review are fixed (W1–W4, I1, I3, I4, I5). The rest are accepted or open info items. None of them is a regression.
- The matcher upgrade from SIMILAR to a lexical tier is correct. `DO UPDATE … WHERE want_matches.tier = 'SIMILAR'` never overwrites a MATCH or SUGGESTION row. `RETURNING` reports only rows that were really upgraded, so an upgraded window MATCH gets its bell. The parameter layout matches what each statement reads, and the SQL is injection-safe.
- The lock-free embed cannot leave a stale vector. It does reverse the lock order against `update_product`, though. **N1**: a rename that races a reconcile or handler on the same product can deadlock, and the admin's edit may be the one that gets aborted.
- 1 new warning and 6 new info items. Most are about docs, logging and contention under rare races.

## Key Decisions
These were reviewed and accepted as designed, not reported as findings:
- **Upgrade in place, one way only.** The lexical statements skip only lexical rows in their `NOT EXISTS` (`statements.py:243`). The SIMILAR statements skip every stored row and use `DO NOTHING` (`:194`, `:213`, `:291`). An upgraded row keeps its original `created_at`. Nothing orders by `want_matches.created_at` (`reads.py:264-287` order by `seen_at` and `score`), so this has no visible effect.
- **The frontend `.catch` swallows every `/similar` error, including a 404.** That is safe: "not found" is driven by `getWant`, which still rejects `Promise.all` (`useWantMatches.ts:63-70`, `:103`). The test at `useWantMatches.test.tsx:149` pins this. So rethrowing a 404 from `/similar`, as the previous report suggested, is not needed.
- **`model.sha256` is recorded and printed, not enforced.** The hash makes two builds comparable, and the pins make a drift unlikely. Nothing compares the hash with an expected value (see N6).

## Open Questions / Risks
- **N1** (a deadlock between a product rename and a background embed) is rare. It needs a rename to commit during the moment a reconcile or handler holds the same product. That is most likely during a model-change backfill. Adding `flush()` before the vector upsert would remove it.
- After the upgrade change, the lexical statements take row locks on stored SIMILAR rows, where before they only skipped them. Two writers could now meet on the same pair: a window run, a forward run, and the backend's mark-seen. Such a deadlock is a lost race, already covered by the standards (one WARNING, retry next run; or a 409 in the API). It is not reported as a finding.
- The int8 parity margin is still 0.0004. The pins should keep it stable, but any bump needs a new parity run, as the Dockerfile comment says.

## Summary
- **Critical**: 0 issues
- **Warnings**: 1 issue (new)
- **Info**: 6 new issues, plus 7 info items carried over (I2, I6–I11), all accepted or optional

## Status of previous findings

| ID | Status | Evidence |
|----|--------|----------|
| W1: embed while holding the row lock | **Resolved** | Product handler: reads the name without a lock, embeds, then locks without `SKIP LOCKED` and re-checks the name (`product/embeddings.py:147-158`). Product reconcile: reads, rolls back, embeds, then locks with `SKIP LOCKED`, re-checks and commits (`:186-208`). The want side does the same (`wants/application/embeddings.py:135-148`, `:186-213`). A lock is now held for milliseconds. |
| W2: user embeds starve behind reconcile batches | **Resolved** (one part left) | `RECONCILE_EMBED_BATCH = 8` (`embeddings/service.py:30-33`). The queue wait is still not in the miss log line (`service.py:75-78`), see N4. |
| W3: a `/similar` failure takes down the page | **Resolved** | `getWantSimilar(wantId).catch(() => NO_SIMILAR)` (`useWantMatches.ts:67-69`). Tests at `useWantMatches.test.tsx:130-157`. |
| W4: model build not reproducible | **Resolved** (one part left) | The whole export stack is pinned (`Dockerfile:23-31`). The `sha256sum` goes into `model.sha256` and the build log (`:66-67`). It is not logged at startup or compared with an expected value, see N6. |
| I1: `now` taken before the embed | **Resolved** | `now = datetime.utcnow()` after the embed and the lock (`product/embeddings.py:200`, `wants/application/embeddings.py:146`, `:204`). |
| I2: stale SIMILAR pairs survive a re-embed | **Open** (partly better) | A product renamed in place is now re-read once it is re-embedded, so it can be upgraded (`architecture.md:478`). Pairs of the old name, or of an old `EMBEDDING_MODEL_ID`, are still not removed, and `architecture.md` does not mention them. |
| I3: docstring said "both tiers" | **Resolved** | `writes.py:199` now says "every tier". |
| I4: a NaN vector fails the write | **Resolved** | `service.py:96-98` raises `ValueError` on a non-finite value. `except Exception` (`:107-112`) turns it into a miss. |
| I5: the 0101 column is needed even with embeddings off | **Resolved** | `_check_similar_schema` (`main.py:167-192`) runs on every start (`:207`). It checks both embedding tables and `wants.similar_requested_at`. |
| I6: a cancelled request does not mark the embed stuck | **Open** (accepted) | Unchanged: `service.py:100` catches only `TimeoutError`. The delay stays bounded by the timeout. |
| I7: migration 0100 and the 0101 index | **Accepted** | Unchanged. |
| I8: `/similar` fetched for closed wants | **Accepted** | Unchanged, consistent with suggestions. |
| I9: related-item tiles look like suggestion tiles | **Open** (optional) | `SimilarCard.tsx:19` still uses `dashed`, and there is no `aria-describedby` link. |
| I10: reconcile scans every product each minute | **Open** (slightly worse during backfill) | With batches of 8, a 300-row backfill tick runs about 38 anti-join reads instead of about 10 (`product/embeddings.py:172-186`). Steady state is still one read per tick. |
| I11: view-state purity | **Verified** | Not touched by the fixes. |

## Critical Issues
None.

## Warnings

### N1. A product rename takes its locks in the opposite order from the background embed, so the two can deadlock
- **Location**: `src/backend/app/product/service.py:179-188`, against `src/backend/app/product/embeddings.py:153-158` (handler) and `:198-208` (reconcile)
- **What happens**:
  - `update_product` changes the ORM attributes and then calls `save_name_vector`. That runs a `text()` upsert, and a `text()` statement does not autoflush. So the `product_embeddings` row is written and locked first, and `UPDATE products` (the product row lock) only flushes at `commit()`.
  - The handler and the reconcile do the opposite. They lock the product with `FOR NO KEY UPDATE` first, then upsert the vector.
  - Suppose a background path locks the product after the rename's upsert but before its commit flush. The background path sees the old name, which is still committed, and waits on the `product_embeddings` row. The rename's flush then waits on the product row. That is a deadlock (`40P01`).
- **Why it matters**:
  - Stale vectors are still impossible: either side's abort leaves a name and a vector that agree.
  - But the victim is chosen by the deadlock detector. If it is the rename, the admin gets an unhandled error. `update_product` has no `TRANSACTION_CONFLICTS` handling.
  - The window is very short, and the race needs the same product, so it is rare. It is most likely during a backfill after a model change.
  - The create paths flush first (`service.py:162`, `:221`), and the want write locks first (`writes.py:235-255`). So only the rename path has the inverted order.
- **Recommendation**: Add `await db.flush()` before `save_name_vector` in `update_product`, as both create paths already do. The product row is then locked before the vector row, the same order as every other path.
- **Fixable**: true

## Informational

### N2. `architecture.md` still names the old model parameter
- **Location**: `.maister/docs/project/architecture.md:366`
- **What happens**: The line says "`we.model_id`/`l.model_id` bound as `$3`". After the new layout this is `$6` (`statements.py:50-57`, `:177`, `:191`, `:205`, `:208`).
- **Suggestion**: Change it to `$6`.

### N3. The upgrade path is pinned only on the happy path
- **Location**: `src/matcher/tests/test_similar.py:292-353`
- **What happens**: Three tests cover SIMILAR becoming MATCH (window, with a bell), MATCH (forward) and SUGGESTION. Two things are not tested:
  - that an already-stored SUGGESTION is left alone when the listing later qualifies as MATCH (the `NOT EXISTS` at `statements.py:243`);
  - the `WHERE want_matches.tier = 'SIMILAR'` guard on a conflict with a lexical row (`:254`), which only fires under a race.

  The code is correct by reading.
- **Suggestion**: Optionally add one test: store a SUGGESTION, re-point the item so the listing becomes a MATCH, run the window, and assert that the tier, `seen_at` and the outbox are unchanged.

### N4. A reconcile batch can still hold the embed worker for up to 10 s
- **Location**: `src/backend/app/embeddings/service.py:28-33`
- **What happens**:
  - In normal operation, batches of 8 keep a write's wait in the queue near 0.1 s.
  - Under CPU contention a batch can run up to `RECONCILE_EMBED_TIMEOUT_SECONDS = 10` before it is marked stuck. A write queued behind it then misses its 2 s budget.
  - The miss log line still does not say whether the time went to waiting in the queue or to running (`:75-78`).
- **Suggestion**: Set the reconcile timeout to about 2 s, the same as a write, which is ample for 8 names. Optionally log the wait in the queue.

### N5. A transient `/similar` failure during polling empties related items that were already shown
- **Location**: `src/frontend/src/hooks/useWantMatches.ts:69`
- **What happens**: The fallback becomes `similar` for that poll, so the section disappears until the next good poll, then comes back. The error is also swallowed without any trace.
- **Suggestion**: Acceptable for a best-effort section. Optionally reuse the previous `similar` on failure, using the query's previous data.

### N6. The model hash is not visible to operators at runtime
- **Location**: `src/backend/Dockerfile:66-67`, `src/backend/app/embeddings/onnx_embedder.py:34-40`, `service.py:134-142`
- **What happens**:
  - `model.sha256` exists only in the image and the build log. `OnnxEmbedder` does not read it, and the startup log does not show it.
  - No runbook step compares it between builds; `architecture.md` has no mention of `sha256` for the embed model.
  - The base `python:3.12-slim` is a floating tag. Transitive dependencies of the `models` stage (protobuf, sympy and others) are not pinned.
- **Suggestion**: Log the hash next to `EMBEDDINGS_ENABLED` at startup, and add one runbook line to compare it with the previous image.

### N7. The want reconcile re-checks ACTIVE under the lock but not expiry
- **Location**: `src/backend/app/wants/application/embeddings.py:177`, `:198-202`
- **What happens**:
  - A want that expires between the read and the lock still gets its vector and a SIMILAR flag.
  - The matcher's claim then runs no match for it: `_process` matches only `status == 'ACTIVE'`, and `matchable_wants` filters `expires_at > now`. It just clears the flag.
- **Suggestion**: None needed.

## Verified (no finding)

### 1. Matcher upgrade (`src/matcher/matcher/statements.py`)
- **`ON CONFLICT … DO UPDATE … WHERE tier = 'SIMILAR'`** (`:251-254`, `:291`):
  - The lexical tiers pre-filter only lexical rows (`:243`). So the usual conflict is with a stored SIMILAR row, and that row is rewritten with this run's tier, score, missing words, source, `seen_at` and `updated_at`.
  - A row that became lexical in a concurrent transaction gets the `WHERE` re-evaluated on its latest version. It is skipped and not returned.
  - `want_id`/`item_id` are not updated, so no FK re-check runs.
  - `matchable_listings` has one row per item (0101 view, lines 116-122), so a statement cannot hit the same row twice.
- **`RETURNING` and bells** (`window.py:177-178`):
  - An upgraded window MATCH has `seen_at = NULL`, is returned with tier MATCH and is staged for `bells_due`. The backend handler re-checks that it is still a visible MATCH (`bells_due.py:62`).
  - Forward upgrades and SUGGESTION upgrades are stored seen and ring no bell.
  - The `similar=` count in the log comes from the returned tiers (`window.py:180-188`).
- **Caps**:
  - MATCH: at most `MATCH_TOP_N` per run, upgrades included.
  - SUGGESTION and SIMILAR: each counts only its own tier (`:220-229`). An upgraded row leaves the SIMILAR count and can free a SIMILAR place in the same run, because SIMILAR runs last.
  - The SIMILAR statements still exclude every stored row, including a row upgraded moments earlier in the same transaction (`:194`, `:213`).
- **MATCH and SUGGESTION are never overwritten**. SIMILAR uses `DO NOTHING` together with an "any tier" `NOT EXISTS`. The lexical tiers skip stored lexical rows and guard the conflict with `WHERE tier = 'SIMILAR'`.
- **Parameter layout and typing** (`:50-57`, `:306-328`). Each statement reads every parameter it is given, with the same type everywhere:

  | Statements | Parameters read |
  |------------|-----------------|
  | Forward lexical | `$1`–`$5` |
  | Window lexical | `$1`–`$6`, with `$6` the window end (`:273`) |
  | Forward SIMILAR | `$1`–`$7`, with `$3`/`$4` read through `_LEXICALLY_CLAIMED` |
  | Window SIMILAR | `$1`–`$8` |

  - The types are `$1`, the window `$2` and the end `::timestamp`, the forward `$2 ::uuid`, `$3 ::int`, `$4 ::real`, `$5 ::bigint`, `$6 ::text` and `$7 ::float8`.
  - `_store` binds them positionally in that order.
- **Injection safety**:
  - Every `format`/f-string splices only module constants: `{materialized}`, `{want_filter}`, `{end}`, `{tiers}`, `{tier}`, `source` and `seen_at`.
  - Every value is a bound parameter.

### 2. Backend lock-free embed
- **Embed, lock and re-check race**:
  - Under READ COMMITTED, the locking re-read returns the latest committed name. A rename that commits during the embed makes the names differ: the handler raises and is retried; the reconcile skips the row until the next tick.
  - A rename that commits after the background write overwrites the vector in its own commit. On a miss it deletes the vector and stages a retry.
  - An A→B→A rename stores a correct vector of A.
  - So **a stale vector is impossible** (but see N1 for the lock order).
- **The skip list**:
  - `skipped` collects every attempted id, at most `limit` = 300 binds in `NOT IN`.
  - A missed batch is not retried within the tick, and a busy embedder ends the tick (`product/embeddings.py:170-197`, `wants/application/embeddings.py:168-197`).
- **Transactions**:
  - `db.rollback()` right after the read (`:187` in both files) ends the transaction before the embed, so no transaction sits idle or holds a lock while the embed runs.
  - The next `execute` autobegins a transaction for the lock, the upsert and `request_similar`, and `commit()` closes it.
  - The handlers run inside the dispatcher's savepoint. During their ≤2 s embed they hold no subject lock, only the dispatcher's own transaction.
- **`RECONCILE_EMBED_BATCH = 8`**: one constant, exported through `embeddings_acl` to the want side (`wants/application/embeddings.py:30`). `limit - attempted` caps the last batch.
- **Non-finite check**: it runs on the event loop after the future resolves (`service.py:96-98`). That is about 6k float checks per batch, which is negligible. The error message has no text.
- **`_reconcile_side` isolation** (`main.py:104-124`):
  - Each side gets its own session, and a session that exits with an exception rolls back.
  - `40P01`/`40001` (`TRANSACTION_CONFLICTS`, now in `app/db.py:17-19` and shared with `writes.py:23`, `:65`) log one WARNING. Anything else logs once with its traceback, is never re-raised, and the other side still runs.
- **`_check_similar_schema`** (`main.py:167-192`):
  - It runs on every start, after `_check_wants_contract`, whatever the flag says.
  - It reports by name which of the 0101 objects are missing.
  - It does not check the 0101 columns of the view. That is fine, because the backend does not read them.
- **Core `update()` on `wants`**: `updated_at` is a `version_id_col` without `onupdate` (`core/base_model.py:61-68`), so `request_similar` (`wants/application/embeddings.py:102-107`) does not change the seeker's version.

### 3. Frontend `useWantMatches`
- The `.catch` is scoped to `getWantSimilar` only. A 404 or 500 on the want, its matches or its suggestions still rejects, and "not found" is still `ApiError` 404 (`:103`).
- The `NO_SIMILAR` fallback is the module-level stable empty array, as the data-fetching standard asks.

### 4. Dockerfile
- The pins cover torch, optimum-onnx, optimum, onnxruntime (the quantizer), onnx, transformers, tokenizers, numpy and huggingface_hub (`:28-31`). The Hub revision is pinned (`:50`).
- The order of steps is right:
  1. export;
  2. MatMul-only quantize;
  3. parity gate (the build fails below 0.99);
  4. `sha256sum` into `model.sha256`, echoed to the log;
  5. clean-up;
  6. write `model_id.txt`.
- The embed RUN has no secret mount. Only `/models/embed` is copied into `runtime`.

### Security and secrets
No secrets were added. The fixes touch no auth, matrix or visibility code.

## Metrics
- Max function length: about 50 lines (`reconcile_embeddings` on both sides, `_store` call sites)
- Max nesting depth: 4 levels (`_WINDOW_SIMILAR_PAIRS` nested `CASE`)
- Potential vulnerabilities: 0
- N+1 query risks: 0. The reconcile does one read per batch of 8, by design (I10).

## Prioritized Recommendations
1. **N1**: add `await db.flush()` before `save_name_vector` in `update_product`. It is one line and puts the lock order in line with every other path.
2. **N2**: fix the `$3` → `$6` reference in `architecture.md:366`.
3. **N6**: log `model.sha256` at startup and add one runbook line to compare it between images.
4. **N4**: lower `RECONCILE_EMBED_TIMEOUT_SECONDS` to about 2 s for batches of 8.
5. **I2**: document that SIMILAR pairs of an old name or an old model stay until the want is edited.
6. Optional: N3 (a test that a stored SUGGESTION is left alone), N5 (keep the previous related items on a transient error) and I9.
