# Code Review Report

**Date**: 2026-11-18
**Path**: SIMILAR-tier files listed under "In scope" in `verification/review-scope.md` (uncommitted working tree). The 0102/ledger change is excluded.
**Scope**: all (quality, security, performance)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issues. The SQL is injection-safe: every matcher constant is bound, the f-strings splice only module constants, and vectors are bound through `CAST(:embedding AS halfvec)`. `/similar` reuses `visible_matches`, so PRIVATE items do not leak, and the responses carry no vectors or scores.
- Migration 0101's downgrade restores the 0099 view byte-for-byte (checked by diffing the two strings). Both directions set `lock_timeout`, and the downgrade order is correct.
- 4 warnings: outbox handlers and reconcile embed while holding row locks (up to 10 s); one embed worker shared by user writes and reconcile, with no priority; one failed `/similar` call fails the whole want page; the int8 model build is not reproducible enough for a pinned model id.
- 11 info items, mostly docs and edge cases.

## Key Decisions
These decisions were reviewed and accepted as designed, not reported as findings:
- **Exact scan, no vector index.** The work-log measured forward SIMILAR at about 32–37 ms p95 on 20k listings. The spec sets a revisit point at about 500k listings.
- **Background re-triggers are SIMILAR-only.** They set `similar_requested_at` through a Core `update()`, so `updated_at`, the version column, does not change and a seeker's edit does not get a 409. The full `CLEAR` compares against the SIMILAR value that was claimed. Under the claim's `FOR NO KEY UPDATE` no writer can move either flag, so the `CASE … ELSE` branches only guard against changes that cannot happen. The trigger's `WHEN NEW.similar_requested_at IS NOT NULL` does not fire on a clear.
- **SIMILAR never takes a lexical candidate**, even one that the top-N or cap rule leaves out of the current run (`statements.py:155-161`, `:186`, `:203`).

## Open Questions / Risks
- `0102_ledger_entries_on_inventories.py` is not in the working tree, so nothing chains after 0101 right now. When 0102 lands, its `down_revision` must be `"0101"`. Its downgrade must not recreate `matchable_listings` without the 0101 columns.
- The int8 parity margin is 0.0004 above the gate (0.9904 against 0.99). A rebuild with a different `onnxruntime` or `optimum` resolution could fail the build. It could also produce different weights under the same `EMBEDDING_MODEL_ID` (see W4).
- `SEMANTIC_SIMILARITY_MIN = 0.86` is provisional until the release gate sample has been scored.

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues
- **Info**: 11 issues

## Critical Issues
None.

## Warnings

### W1. Outbox handlers and the reconcile sweep embed while holding the subject's row lock
- **Location**:
  - `src/backend/app/product/embeddings.py:133-144` (handler) and `:154-191` (reconcile)
  - `src/backend/app/wants/application/embeddings.py:124-141` (handler) and `:166-201` (reconcile)
- **What happens**: The want write path embeds before it takes the lock, as asked. The handlers and the sweep do the opposite. They lock `FOR NO KEY UPDATE` first, then call the embedder: up to `EMBED_TIMEOUT_SECONDS = 2` in a handler, up to `RECONCILE_EMBED_TIMEOUT_SECONDS = 10` for a batch of 32.
  - A seeker's `update_want` (`writes.py:240`) waits on that lock while the sweep runs.
  - So does an admin `update_product` (an ORM UPDATE).
  - The spec accepts this (spec line 270). It becomes visible during a model-change backfill, when every ACTIVE want and every product goes through the sweep.
- **Why it matters**: A user-facing edit can take up to about 10 s. This is a latency risk, not a correctness bug.
- **Recommendation**: Read the name without a lock (or with `SKIP LOCKED` only to choose the rows). Embed. Then lock and upsert only when the name is unchanged, as `update_want` does with `updated_at`. That keeps the lock for milliseconds.
- **Fixable**: false (design trade-off)

### W2. One embed worker serves both user writes and reconcile batches, with no priority
- **Location**: `src/backend/app/embeddings/service.py:99-112` and `:146-173`, `src/backend/app/main.py:96-133`
- **What happens**:
  - Every embed goes through one `ThreadPoolExecutor(max_workers=1)`, and time spent in the queue counts toward the timeout.
  - A reconcile batch of 32 names on one ONNX thread can occupy the worker longer than the 2 s budget of a write.
  - A product or want write queued behind it then times out. The write still commits, but without a vector, and a retry is staged; it does not fail.
  - In steady state this is rare. During the first enable, or after a model change (up to 300 products plus 300 wants per minute), many user writes will miss and log WARNINGs.
  - With up to 10 batches of up to 10 s each, a tick can also run past the 1-minute interval. APScheduler then skips runs with its own warning (`max_instances=1`).
- **Recommendation**: Any one of these would do:
  - smaller reconcile batches, such as 8;
  - yield between batches;
  - skip a reconcile batch while an interactive embed is waiting, for example with a counter in `_embed`.

  Also record the queue wait in the miss log line, so these misses can be told apart from real timeouts.
- **Fixable**: true

### W3. A failed `/similar` call fails the whole want page
- **Location**: `src/frontend/src/hooks/useWantMatches.ts:63-69`
- **What happens**: `getWantSimilar` joins `getWant`, `getWantMatches` and `getWantSuggestions` in one `Promise.all`. Related items are best-effort and never counted, but a 5xx or network error on `/similar` alone rejects the query. `resolveWantMatchesView` then shows the `error` state on the first load. This works against the graceful-degradation standard (`standards/global/error-handling.md`).
- **Side effect**: The polling window (every 2 s for 60 s) now sends 4 requests per tick instead of 3.
- **Recommendation**: Use `getWantSimilar(wantId).catch(() => NO_SIMILAR)`, but keep a 404 rethrowing so `notFound` still works. Or move related items into their own query under the `WANTS_KEY` prefix that does not poll.
- **Fixable**: true

### W4. The int8 model build is not reproducible enough for a pinned model id
- **Location**: `src/backend/Dockerfile:37-59`, `src/backend/app/embeddings/service.py:87`
- **What happens**: The `models` stage pins `torch==2.7.1` and `optimum-onnx[onnxruntime]==0.1.0`. `onnxruntime`, which runs `quantize_dynamic`, and `transformers` are resolved transitively at build time.
  - `EMBEDDING_MODEL_ID` names the Hub revision plus `+int8`. It does not name the quantizer version or the weight hash.
  - Two builds can therefore ship different `model.onnx` files under the same id. Vectors stored by the old image would then be compared with new ones as if they came from the same model, and the threshold is tuned for that model.
  - The parity margin is 0.0004, so a drifting dependency is as likely to fail the build as to pass it silently.
- **Recommendation**: Pin `onnxruntime` (and `transformers`) in the `models` stage. Write `sha256(model.onnx)` into `model_id.txt` or a sidecar file, and log it at startup. Changing the id when the hash changes is optional.
- **Fixable**: true

## Informational

### I1. Reconcile timestamps vectors before the embed
- **Location**: `src/backend/app/product/embeddings.py:175`, `src/backend/app/wants/application/embeddings.py:167`
- **What happens**: `now` is taken before the embed (up to 10 s), but the upsert commits after it. The product `updated_at` therefore feeds a `matchable_listings.changed_at` that is up to about 10 s older than the commit.
  - The window's 2-minute overlap covers this for normal runs.
  - A run that follows a capped run starts at the marker with no overlap. A row committed late, with a `changed_at` at or before the capped end, would not be read.
- **Suggestion**: Take `now` after the embed, as the handler does at `product/embeddings.py:144`.

### I2. Stale SIMILAR pairs survive a re-embed
- **Location**: `src/backend/app/product/embeddings.py:83-90`, `src/backend/app/wants/application/embeddings.py:198-200`
- **What happens**:
  - After an `EMBEDDING_MODEL_ID` change, the sweep re-embeds and re-triggers. Pairs stored under the old model, with their old scores, stay until the want is edited.
  - A product renamed in place keeps the SIMILAR pairs of its old name.
  - Once stored as SIMILAR, a pair can never become a MATCH (`_NOT_STORED`), so it never rings a bell.
- **Suggestion**: Document this next to the existing "renamed in place" known limit. Or delete a want's SIMILAR rows when its vector's `model_id` changes.

### I3. Stale docstring
- **Location**: `src/backend/app/wants/application/writes.py:202`
- **What happens**: The docstring still says "drops the stored matches of both tiers". There are now three tiers, and the DELETE removes SIMILAR rows too.
- **Suggestion**: Say "of every tier".

### I4. A NaN vector would fail the write it was meant to help
- **Location**: `src/backend/app/embeddings/onnx_embedder.py:64-66`, `src/backend/app/embeddings/service.py:190-192`
- **What happens**: A zero-norm CLS vector would make NaN. `vector_literal` would render it as `nan`, and the `CAST` would fail inside the user's write transaction. That turns an embedder fault into a failed write, against the spec's "writes never fail because of the embedder". It is very unlikely for this model.
- **Suggestion**: Check `np.isfinite` in `OnnxEmbedder.embed` and raise. `_embed` already turns any raised error into a miss.

### I5. The ORM column needs 0101 even when embeddings are off
- **Location**: `src/backend/app/wants/models.py:147-149`, `src/backend/app/main.py:151-168`
- **What happens**: `Want.similar_requested_at` is now mapped, so every `Want` select needs 0101 whatever `EMBEDDINGS_ENABLED` says. `_check_embeddings_tables` runs only when the flag is on. A new image on a 0100 database starts, then fails each wants request with `UndefinedColumn` instead of the clear startup message.
- **Suggestion**: Check for `wants.similar_requested_at` (or 0101) in `_check_wants_contract` every time.

### I6. Client disconnect during an embed is not marked stuck
- **Location**: `src/backend/app/embeddings/service.py:158-167`
- **What happens**: If the request is cancelled while an inference is running (`CancelledError` is not an `Exception`), `_stuck` is not set. The next calls queue behind the running inference instead of failing fast as `busy`. The queue wait still counts toward their timeout, so the delay is bounded.
- **Suggestion**: None needed. Optionally handle `CancelledError` the same way as `TimeoutError` before re-raising it.

### I7. Migration 0100 and the 0101 index (accepted)
- **Location**: `src/backend/alembic/versions/0100_pgvector.py:31-36`, `0101_want_similar.py:193-196`
- **What happens**:
  - 0100 sets no `lock_timeout`. That is correct: `CREATE EXTENSION` takes no table locks.
  - 0100's downgrade drops an extension that a DBA may have installed. This is documented, and since there is no `CASCADE` it fails safe.
  - 0101 builds `ix_wants_similar_requested_at` without `CONCURRENTLY`. That is acceptable for the small `wants` table under the 5 s `lock_timeout`.

### I8. The want page always fetches related items
- **Location**: `src/backend/app/wants/application/reads.py:381-391`, `src/frontend/src/hooks/useWantMatches.ts:63-69`
- **What happens**: `list_similar` serves EXPIRED and FULFILLED wants too. Only the frontend view state hides their related items, which matches how suggestions work. The hook still fetches `/similar` for closed wants.
- **Suggestion**: None needed. Keep this consistent with suggestions.

### I9. Related-item tiles look like suggestion tiles
- **Location**: `src/frontend/src/features/wanted/SimilarCard.tsx:7-21`, `WantMatchesView.tsx:359-374`
- **What happens**: Accessibility is fine:
  - the section has `aria-labelledby`;
  - the emoji has `aria-hidden`;
  - the separating space is outside the hidden span;
  - the list is a `<ul>/<li>`.

  The tiles use the same `dashed` style as suggestion tiles. Only the section heading tells them apart.
- **Suggestion**: Optional: link the intro `<p>` to the section with `aria-describedby`.

### I10. The reconcile scans every product each minute
- **Location**: `src/backend/app/product/embeddings.py:155-170`
- **What happens**: Each tick runs an anti-join over all products, including catalogue products that are not listed. When nothing is missing this costs O(products) per minute. That is cheap today.
- **Suggestion**: Revisit together with the vector-index threshold.

### I11. View-state purity (verified)
- **Location**: `src/frontend/src/features/wanted/wantMatchesViewState.ts:65-92`
- **What happens**: `resolveWantMatchesView` stays pure. `similar` is carried only on the four active kinds, and related items never turn `activeEmpty` into `active`. `WantMatchesView` only switches on `view.kind`. This follows `standards/frontend/components.md`. No action needed.

## Verified (no finding)

### Matcher statements
In `src/matcher/matcher/statements.py`:
- **Parameter typing for each statement**:
  - lexical tiers: `$3::int`, `$4::real`;
  - SIMILAR: `$3::text`, `$4::float8`;
  - forward SIMILAR exclusion: `$6::int`, `$7::real`;
  - window SIMILAR exclusion: `$7::int`, `$8::real`.

  Every statement reads every one of its parameters. The `_store` call sites pass them in the order the statements expect (`:310-355`).
- **Injection safety**: f-strings splice only module constants (`tier`, `source`, parameter names).
- **Lexical exclusion**: the text-candidate guard and the word check are the same as the lexical tiers' (`:155-161`).
- **Visibility fragment**: one constant, shared by all tiers, and pinned by `test_constants_drift.py:142`.
- **Tier cap**: counts only stored rows of the same tier that are still matchable (`:212-221`).
- **Model pin**: the same `$3` pins the model on both the want side and the listing side.
- **Missing vectors**: `l.model_id` NULL makes the `CASE` false, and a want without a vector yields NULL, so neither forms a pair.
- **Statement order**: SIMILAR runs last in the same transaction, so `_NOT_STORED` sees the lexical rows just inserted.

### halfvec binding
`vector_literal` output is bound through `CAST(:embedding AS halfvec)`, never spliced into SQL. The round trip is tested in `test_embeddings.py:131`.

### PRIVATE visibility and response shape
- `/similar` goes through `_cards_select` → `visible_matches`, which applies `items_visible_to(ALL)` and excludes the caller's own items. It also checks the want belongs to the caller with `_ensure_own_want`.
- `WantSimilarResponse` has no score or vector, and its exact key set is tested.
- `matched_item_id` ignores SIMILAR rows, and match counts and bells stay MATCH-only (`bells_due.py:62`).

### Want write path concurrency
- The embed runs after `_check_texts` and the lookups, and before `FOR NO KEY UPDATE`.
- The upsert, or on a miss the delete plus staged retry, runs under the lock after the `updated_at` compare.
- A handler that writes an old-name vector in between is overwritten by the seeker's commit.

### Embedder
- **Single worker**: only one thread touches the tokenizer and the ONNX session, so the thread-unsafe `tokenizers` object is safe.
- **Stuck future**: it is set before `add_done_callback`, so a future that completes at once still clears it.
- **Cancellation**: a future still in the queue is cancelled and never runs.
- **Logs**: misses log only the reason, the text count and the timeout. Errors log only `type(exc).__name__`. The handlers' `RuntimeError` messages carry ids only.

### Migrations
- 0101 upgrade and downgrade both start with `SET LOCAL lock_timeout = '5s'`.
- The downgrade deletes SIMILAR rows before restoring the CHECKs. It drops the view before recreating it from the verbatim copy, and drops the trigger before the column.
- `MATCHABLE_LISTINGS_0099` is identical to 0099's `MATCHABLE_LISTINGS`, confirmed by a programmatic string comparison.

### Matcher contract check and request loop
- `missing_contract` now requires 0101 and both embedding tables (`db.py:20-66`).
- The claim takes full requests first. A full run's `CLEAR` also clears a SIMILAR flag set at or before the claim, and a SIMILAR-only run clears only its own flag (`requests.py:37-99`).

### Security and secrets
- No secrets in the changed files. `.env.example` holds only placeholders and booleans.
- The new Dockerfile RUN step downloads a public model with no secret mount.
- `/api/wants(/.*)?` keeps login-only READ/EDIT; matrix rows 66–67 are unchanged.

## Metrics
- Max function length: about 50 lines (`_run_embedding_reconcile`, `reconcile_embeddings`)
- Max nesting depth: 4 levels (`statements._WINDOW_SIMILAR_PAIRS` nested `CASE`)
- Potential vulnerabilities: 0
- N+1 query risks: 0 (cards are batched in `_card_fields`, and the statement count is constant, pinned by `test_wants_similar_api.py:73`)

## Prioritized Recommendations
1. **W3**: make `/similar` best-effort in `useWantMatches`. It is a one-line fix and stops a non-essential endpoint from taking the page down.
2. **W4**: pin `onnxruntime` and `transformers` in the `models` stage and record the `model.onnx` hash. Do this before the threshold is set by the release gate.
3. **W2**: keep reconcile batches from starving user write embeds, by using smaller batches or yielding to waiting interactive embeds.
4. **W1**: embed outside the lock in the handlers and the sweep, then lock and compare the name.
5. **I1, I4, I5**: take `now` after the embed, reject non-finite vectors, and always check for 0101 at startup.
6. **I3**: fix the "both tiers" docstring.
