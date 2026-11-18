# Code Review Report: re-review after fix cycle 2

**Date**: 2026-11-18
**Path**: the cycle-2 changes (backend `product/service.py`, `embeddings/service.py`, `wants/application/embeddings.py`, `wants/infrastructure/embeddings_acl.py`, `main.py`; matcher `statements.py`; frontend `hooks/useWantMatches.ts`; and the new tests)
**Scope**: all (focused re-review)
**Status**: ✅ Clean (info items only)

## TL;DR
- No critical issues and no warnings. Cycle 2 fixes or settles every item from the last round that could be fixed.
- N1 is resolved. `update_product` now flushes before `save_name_vector`, so every path locks the product row before the vector row, and a test pins the statement order.
- The shared `ReconcileResult`, the frozen `Statement(sql, similar)`, the expiry re-check and the previous-data fallback for `/similar` are all correct. They add no lock-order, binding or stale-closure risk.
- I found no regressions. The 3 new info items (C1–C3) are optional.

## Open Questions / Risks
- `RECONCILE_EMBED_TIMEOUT_SECONDS = 2.0` and the embedder is not warmed up at startup (`main.py:218-220`). If the first ONNX inference is slow, the first reconcile batch can be marked stuck. That would cost one tick plus a short window in which write embeds miss as `busy`. The miss path handles this, but it would show up as WARNINGs right after a deploy (C1).

## Summary
- **Critical**: 0
- **Warnings**: 0
- **Info**: 3 new (C1–C3); residual I2, I6, I9 and I10 are accepted or optional

## Status of previous findings

| ID | Status | Evidence |
|----|--------|----------|
| N1: rename lock order | **Resolved** | `product/service.py:186-190`: `await db.flush()` comes before `save_name_vector`, inside `if renamed`. The embed still runs before any attribute change or flush (`:180`), so no lock is held while it runs. `tests/test_product_embeddings.py:132-151` asserts the write order `UPDATE products` → `INSERT INTO product_embeddings`. |
| N2: `$3` in `architecture.md` | **Resolved** | `architecture.md:366` now says "bound as `$6`". |
| N3: upgrade only tested on the happy path | **Resolved** | `matcher/tests/test_similar.py:357` tests that a stored SUGGESTION is left alone when its listing is re-pointed to MATCH: same row, no bell, zero counts. `:380` is a two-connection race test for the `WHERE want_matches.tier = 'SIMILAR'` guard. It waits until the forward insert is blocked (`pg_stat_activity.wait_event_type = 'Lock'`), then commits, and asserts that the row is untouched and not returned. A stuck test fails through `asyncio.timeout(5)` rather than passing by mistake. |
| N4: reconcile timeout 10 s | **Resolved** | `embeddings/service.py:29-32`: 2.0 s, with its reason documented. The queue wait is still not logged (optional). See C1. |
| N5: `/similar` failure empties the section | **Resolved** | `useWantMatches.ts:71-73`. On a failure the hook reuses the cached `similar`, or the stable `NO_SIMILAR`. Test at `useWantMatches.test.tsx:149`. |
| N6: model hash not visible to operators | **Resolved by the runbook** (runtime log not added) | `architecture.md:782` reads `model.sha256` and says to re-run the release-gate sweep when the hash differs. `:858` gives the same rule for bumped pins. The hash is still not logged at startup. That is acceptable, because the runbook step covers the operator's comparison. |
| N7: reconcile does not re-check expiry | **Resolved** | `wants/application/embeddings.py:195-199`: the locked re-read filters `ACTIVE` and `expires_at > now`. `request_similar` (`:102-111`) filters on both too, so the handler path cannot flag an expired want either. Test at `tests/test_wants_embeddings.py:514`. |
| I2: stale SIMILAR pairs | **Resolved (documented)** | The **Stale pairs** paragraph at `architecture.md:366` describes them. The behaviour is unchanged by design. |
| I6: a cancelled request is not marked stuck | **Residual (accepted)** | `service.py:110` still catches only `TimeoutError`. The delay stays bounded. |
| I9: related-item tiles look like suggestion tiles | **Residual (optional)** | `SimilarCard.tsx:19` still uses `dashed` and has no `aria-describedby`. |
| I10: reconcile reads per tick | **Residual (accepted)** | Unchanged. There are about 38 reads per tick during a 300-row backfill and 1 in steady state. |
| Pragmatic R1: implicit `similar=` binding | **Resolved** | `statements.py:51-54`: `Statement` is a frozen dataclass, and `_statement` sets `similar=tier == "SIMILAR"` (`:301`). `_store` binds `_SIMILAR` from `statement.similar` (`:332`), so no caller passes the flag anymore. The window end is still positional (`$6`/`$8`), but it comes from the same `_statement` and is appended only when a caller passes `window_end`. All three window callers do so, and none of the forward callers do. |
| Pragmatic N1: `_ReconcileResult` Protocol | **Resolved** | There is one frozen `ReconcileResult` in `embeddings/service.py:41-47`. It is re-exported by `product/embeddings.py:26` and by `embeddings_acl.py:13` and `:25` (so the wants side does not import `app.embeddings` directly). `main.py:95-97` types the callable with it. The Protocol is gone. |

## Regression review of the cycle-2 code

### `src/backend/app/product/service.py`
- The flush is inside `if renamed`, so a plain edit's write order does not change. With `renamed` and a miss, `save_name_vector(..., None, renamed=True)` deletes and stages after the flush. The order is the same as on a hit.
- The create paths (`:162`, `:224`) already flushed before the upsert. All three write paths and both background paths now take the product row first.

### `app/embeddings/service.py`
- `ReconcileResult` is a frozen value type with no store, so it fits the compute-only boundary.
- The 2 s budget is passed explicitly by both reconcile sides (`wants/application/embeddings.py:189-191`). Write paths keep `EMBED_TIMEOUT_SECONDS`.

### `app/wants/application/embeddings.py`
- `now` is used consistently. One `now = datetime.utcnow()` is taken after the embed (`:195`). The same value goes to the lock predicate, to the upsert's `updated_at` and to `request_similar`. The handler does the same at `:150-152`.
- The pre-embed read uses its own `datetime.utcnow()` (`:174`). That is correct: it is only a candidate filter, and the lock re-check is authoritative.
- Every timestamp is naive UTC, matching the `expires_at` writer (`router/wants.py:53` and the following lines, `new_expiry(now)`). This is in line with `time.md`: audit-style UTC, not `local_now()`.
- The handler re-checks only `WITHDRAWN` under the lock (`_names`, `:120-124`). So an expired or closed want still gets its vector, but `request_similar` stores no flag for it. That is harmless: the vector is ready if the want is resumed.
- The locked `SKIP LOCKED` re-read is `OF wants` only. It does not lock `want_embeddings`. The upsert then locks or inserts the vector row. The order is want first, then vector, the same as the seeker's write.

### `app/wants/infrastructure/embeddings_acl.py` and `app/main.py`
- The ACL now also exports `ReconcileResult` and `RECONCILE_EMBED_TIMEOUT_SECONDS`. It imports nothing from `..schemas`.
- The module-boundary test passed, according to `test-suite-results.md` (1577 passed).
- `_reconcile_side` is unchanged except for its type annotation.

### `src/matcher/matcher/statements.py`
- `Statement` is frozen and module-level. The six constants are built once at import.
- `_store` binds positionally:
  - `$1`–`$5` always;
  - then `$6 MODEL_ID` and `$7 SEMANTIC_MIN` only when `statement.similar`;
  - then the window end. That puts it at `$6` for a lexical statement and at `$8` for a SIMILAR one, which matches `_WINDOW_LISTINGS.format(end=…)` (`:273`).
- Each statement still binds exactly the parameters it reads.
- No value is spliced into the SQL. Only module constants are formatted in.

### `src/frontend/src/hooks/useWantMatches.ts`
- **Key**: `queryKey` (`:60`) is the same array value that `useMatchingPolledQuery` passes to `useQuery` unchanged (`useWants.ts:56-60`). `getQueryData` hashes the key, so it is structurally equal on every render. There is no mismatch.
- **Stale closure**: TanStack applies the latest observer options on each render, so the `queryFn` that runs closes over the current `token`/`wantId`. Both are in the key, so a token or want change reads only its own cache entry. Nothing leaks across users or wants.
- On the first read there is no cache, so the fallback is `NO_SIMILAR`. That is a stable module-level constant, and the reference-stability test is at `useWantMatches.test.tsx:72-79` and `:141-146`.
- The `.catch` is still scoped to `/similar` only, so a 404 on the want still reports `notFound` (`:107`, test `:180`).

### New tests
- The backend statement-order test filters `UPDATE`/`INSERT` from `count_queries`. It would catch the old order, where the upsert came before the product flush.
- The expiry test moves `expires_at` into the past inside the patched `embed_queries`. That is exactly the race window. It also covers `request_similar` on its own.
- The matcher race test is deterministic: it polls for a lock wait instead of sleeping, and rolls back on any failure before the commit.

## Critical Issues
None.

## Warnings
None.

## Informational

### C1. The first reconcile batch after start has no warm-up within its 2 s budget
- **Location**: `src/backend/app/main.py:218-220`, `src/backend/app/embeddings/service.py:29`
- **What happens**: The ONNX session is built at startup, but no inference runs. The first batch of 8 now has 2 s instead of 10 s. If cold-start allocation pushes it past 2 s, the future is marked stuck. Writes then miss as `busy` until it finishes, and the tick ends.
- **Why it matters**: Nothing is lost, because the miss path stages retries. It would show up as WARNINGs right after each deploy.
- **Suggestion**: Optionally run one dummy `embed(["warmup"])` in the lifespan after `set_embedder`, or confirm in the deploy smoke check that no `reason=timeout` appears in the first minute.

### C2. The `/similar` fallback reads the cache through the closure, not through the query function's context
- **Location**: `src/frontend/src/hooks/useWantMatches.ts:63`, `:72`
- **What happens**: The code is correct today, because the key passes through unchanged. `queryFn: async ({ queryKey }) => …` would tie the fallback to the exact key being fetched, even if `useMatchingPolledQuery` ever changes the key.
- **Suggestion**: Optional hardening.

### C3. A kept `similar` can briefly outlive a want edit when `/similar` fails
- **Location**: `src/frontend/src/hooks/useWantMatches.ts:71-73`
- **What happens**: An edit that changes the matches deletes every pair on the server. If the next `/similar` read fails, the related items for the old name stay visible until the next successful poll.
- **Why it matters**: This needs a failure exactly at that moment, and it fixes itself on the next poll. It is accepted as the trade-off of N5.
- **Suggestion**: None needed.

## Metrics
- Max function length: about 58 lines (`reconcile_embeddings`, want side, `:155-212`)
- Max nesting depth: 3 levels in the changed code
- Potential vulnerabilities: 0. No secrets, auth or SQL splicing changed.
- N+1 query risks: 0

## Prioritized Recommendations
1. Optional: C1 (warm up the embedder, or add a deploy smoke check for `reason=timeout`).
2. Optional: C2 (read the key from the query function's context), and I9 (make the related-item tile style distinct).
