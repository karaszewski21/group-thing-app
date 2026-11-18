# Pragmatic Review: semantic SIMILAR tier

## TL;DR
- **Status: Appropriate, with minor issues.** The complexity is driven by the ADRs the user chose (fail-open embedder, outbox retry, reconcile sweep, two-flag claim). Each of those is implemented about as simply as its requirements allow.
- No Critical or High findings. There are 3 Medium and 6 Low.
- The top fixes are all small. Give the reconcile job one `try` per side, so a failing product side does not starve wants. Give SIMILAR statements a fixed parameter layout instead of `$3`/`$4` meaning different things and a position-shifting tail. Make the two reconcile loops consistent and drop the dead `now_factory` parameter.
- The new code is about 1,000 LOC plus about 900 changed lines and about 2,000 LOC of tests (60 tests). That is proportionate to a cross-process feature with concurrency rules, but some test groups run past the 2–8 guideline.

## Key Decisions
- **Not flagged (user decisions):** the reconcile sweep, the outbox retry, the `similar_requested_at` two-flag claim, the single-worker executor, the model-id pin in 3 places with its drift test, and the lexical exclusion in SIMILAR. I judged only how simply each one is built. All six are implemented compactly:
  - The executor plus `_stuck` is about 30 lines (`app/embeddings/service.py:32-107`).
  - The claim is one statement plus two clears (`src/matcher/matcher/requests.py:37-58`).
  - The pin is one AST test and one regex test.
- **The near-duplicate `app/product/embeddings.py` and `app/wants/application/embeddings.py` (about 200 LOC each) are accepted.** ADR-009 makes `app/embeddings` compute-only, and the module-boundary guard forbids a shared store. A shared "vector store" helper would break that compute-only boundary. The cost is drift between the two copies (finding M3), not their existence.
- **Unmapped side tables written in `sa.text`, plus a hand-written migration with a verbatim 0099 view copy:** both are simple and in line with the 0099 precedent. No change needed.
- **Frontend:** proportionate. It adds one fetch, one view-state field, one section and one card, and extracts `reservedCaption` (which removes duplication).

## Open Questions / Risks
- **The int8 parity margin is thin.** The build measured 0.9904 against a 0.99 gate (`Dockerfile` comment, work-log 11.6). A rebuild with a different `onnxruntime`/`optimum` resolution could fail the image build for reasons unrelated to the change. This is fine as a gate, but operators should expect it.
- **A failing product reconcile blocks want reconcile** (M1). The work-log records this as "wants run on the next tick". It only holds while the product failure is transient.
- **Migration 0102** (excluded from scope) is not in `alembic/versions` right now, so its chaining after 0101 could not be checked.

---

## 1. Complexity Assessment
| Aspect | Assessment |
|---|---|
| Project scale | Early production: a single VPS, a real user base, and strict runbooks and standards |
| Problem | A quiet third match tier from text embeddings that must never fail or slow writes, never ring bells, and roll out in shadow mode |
| Complexity | **Medium.** It spans 4 layers (migration, API, matcher, web), but every layer extends an existing pattern (moderation ONNX, `bells_due` handler, `_statement` builder, `SuggestionsSection`) |
| Fit | Appropriate. There is no vector index, no pgvector Python package, no new service and no new infrastructure beyond the pgvector image, which is a deliberate minimum (ADR-008) |

## 2. Key Issues Found

### Medium

**M1: one `try` covers both reconcile sides, so a product-side error starves wants.** `src/backend/app/main.py:96-133`
```python
try:
    async with async_session_factory() as db:
        products = await product_embeddings.reconcile_embeddings(...)
    async with async_session_factory() as db:
        wants = await wants_embeddings.reconcile_embeddings(...)
except DBAPIError ...: return
```
- **Impact:** a repeating product-side DB error (for example a bad row that makes the upsert fail on every tick) means the want reconcile never runs. That is a silent freeze of the want backfill.
- **Fix:** run each side in its own small helper, with its own `try`, and log both results. This costs a few lines and needs no new abstraction.
- **Effort:** 15 min.

**M2: SIMILAR statements reuse `$3`/`$4` for other meanings and shift the lexical parameters by position.** `src/matcher/matcher/statements.py:43-50, 166-207, 290-354`
- Lexical statements bind `$3`/`$4` to `SHORT_WORD_MAX_CHARS`/`WORD_SIMILARITY_MIN`.
- SIMILAR statements bind `$3`/`$4` to `EMBEDDING_MODEL_ID`/`SEMANTIC_SIMILARITY_MIN`, and then put the lexical pair at `$6/$7` (forward) or `$7/$8` (window).
- `_store` takes `tier_params: tuple[int, float] | tuple[str, float]` and `*tail: datetime | int | float`.
- So a reader has to count positions in each call site (for example `match_window(...)`, whose tail is `end, *_LEXICAL`). The type of `tail` no longer says anything.
- **Fix:** give every statement the same layout and let lexical statements ignore the semantic parameters (the comment already notes that Postgres needs every parameter referenced, so add trivial references):
  - Before: `_store(conn, stmt, now, scope, _SEMANTIC, cap, end, *_LEXICAL)`
  - After: `_store(conn, stmt, now, scope, cap, *window_end)`, which always binds `$3 SHORT, $4 WORD_SIM, $5 cap, $6 end?, then MODEL_ID, SEMANTIC_MIN` at fixed positions.

  Or, more simply, splice `EMBEDDING_MODEL_ID`/`SEMANTIC_SIMILARITY_MIN` as typed literals. They are compile-time constants from `rules.py`, not user input.
- **Effort:** 1 h, plus re-running the matcher suite.

**M3: the two reconcile and store implementations have drifted apart for no reason.** `app/product/embeddings.py:99-193` vs `app/wants/application/embeddings.py:76-203`

| | product | want |
|---|---|---|
| `is_enabled` gate on staging | in `save_name_vector` | in `stage_retry` |
| `is_enabled` check in reconcile | every loop iteration | once before the loop |
| skip filter | `not_in(skipped)` always (an empty IN) | only when non-empty |
| tiebreak | `id DESC` | `id ASC` |
| `now` | `datetime.utcnow()` inline | `now_factory` parameter |
| batch write | one executemany upsert | 2 statements per row (64 per batch) |
| `ReconcileResult` | keyword construction | positional |

- **Impact:** each copy is small, but a reader comparing them has to work out whether every difference matters, and none of them does.
- **Fix:** align the want loop to the product shape:
  - one executemany upsert;
  - one `UPDATE wants SET similar_requested_at = :now WHERE id = ANY(:ids) AND status = 'ACTIVE'`;
  - the same tiebreak and the same skip filter.
- **Effort:** 30–45 min.

### Low

- **L1: dead parameter `now_factory`.** `app/wants/application/embeddings.py:154`. No caller or test passes it (grep). Use `datetime.utcnow()` as the product side does. This breaks the minimal-implementation standard's "parameters passed but never used" rule.
- **L2: three overlapping `is_enabled()` checks on the reconcile path.** They are in `main._run_embedding_reconcile:102`, at the top of the want reconcile, and in every product loop iteration. Keep the one in `main` (a cheap early return) and the per-loop `is_busy()`; the rest is noise. The spec does say the job "returns at once while the embedder is not set", and `main` already does that.
- **L3: `main.py` imports `TRANSACTION_CONFLICTS` from `app.wants.application.writes`** to classify product-side errors too. Inline the two SQLSTATEs, or move the constant to `app.core`, the way the matcher has `db.LOST_RACE_SQLSTATES`. As written, the app entry point is coupled to a wants internal.
- **L4: `get_embedder()` is used only by tests** (`test_wants_embeddings.py:385`, `test_wants_scan_removed.py:88-90`). It is an acceptable test seam, but the tests could assert `is_enabled()` instead, and the public function could go.
- **L5: the drift test copies all 20 parity names.** `src/matcher/tests/test_constants_drift.py:24-45` asserts `script.PARITY_NAMES == _PARITY_NAMES`. That is a change-detector against a copy and catches nothing a reviewer would not see in the diff. The `gate()` behaviour checks in the same test are the valuable part; drop the name copy.
- **L6: test volume.** 60 tests across 7 new files, and four groups have 9–11 tests against the 2–8 guideline (`test_product_embeddings.py` 11, `test_wants_embeddings.py` 11, matcher `test_similar.py` 11, `test_embeddings.py` 9). Most of them cover real concurrency or rollback paths, so this is not worth trimming now. Flagged only against the standard.

## 3. Developer Experience
- **Good:**
  - `EMBEDDINGS_ENABLED=false` by default, so local development and CI never load the model.
  - `FakeEmbedder` is shared in `conftest.py`, with `fail`/`delay` modes.
  - The log lines are clear (`reason=missing|busy|timeout|error`, never the text).
  - The startup check names the missing tables.
- **Friction:**
  - The positional parameter layout in the matcher (M2) is the main maintenance trap. Adding one more tier, or another parameter, means re-counting positions in five places.
  - The want lifecycle now has two flags with different meanings. The module docstrings explain this well (`requests.py:1-20`, `wants/application/embeddings.py:1-10`), so it is adequately mitigated.
  - The work-log records 2 new mypy attr-defined errors in `tests/test_wants_embeddings.py` (`main.outbox_scheduler`, `main.product_embeddings`). That is minor noise against the baseline of 15.

## 4. Requirements Alignment
- The implementation matches spec R1–R26. I found no feature beyond the spec:
  - The `/similar` route returns exactly the six fields.
  - Counts and `list_wants(matched_item_id)` stay MATCH/SUGGESTION.
  - No bells.
- No speculative future-proofing:
  - The `Embedder` Protocol has exactly one production implementation plus the test fake. It mirrors the moderation classifier seam and is justified by testing.
  - There is no vector index, no batching service and no config beyond two settings.
- **One small addition:** the public `is_busy()` (`service.py:62`) is not in R7. It was added on purpose, to stop callers reading the private `_stuck` (work-log G5). It is a good trade.

## 5. Context Consistency
- **Drift between the two owner modules** (M3).
- **Unused code:** `now_factory` (L1) and `get_embedder` outside tests (L4). Every other new function has a production caller (verified by grep: `upsert_vector`, `delete_vector`, `stage_retry`, `request_similar`, `save_name_vector`, `store_or_stage`, `is_busy`, `match_similar_forward`).
- **`EMBEDDING_DIMENSIONS` is read only by tests.** It documents the `halfvec(768)` width, so keeping it is fine.
- **The parity script repeats the CLS + L2 pooling of `onnx_embedder.py`.** This is necessary, because the `models` stage has no app source, and the script's docstring says so.

## 6. Recommended Simplifications (top 3)
1. **Separate the reconcile sides (M1).**
   ```python
   async def _reconcile(side, reconcile) -> ReconcileResult | None:
       try:
           async with async_session_factory() as db:
               return await reconcile(db, limit=_EMBEDDING_RECONCILE_LIMIT)
       except DBAPIError as exc: ...  # WARNING or exception, per side
       except Exception: logger.exception("embedding reconcile (%s) failed", side)
   ```
   Impact: about 0 net LOC, and a failure on one side no longer starves the other.
2. **Fixed parameter layout for matcher statements (M2).** Every statement binds `(now, scope, SHORT, WORD_SIM, cap[, end])`, and SIMILAR splices the two `rules` constants as literals, or appends them at a fixed position. Impact: removes `tier_params`, `*tail` and the `_LEXICAL`/`_SEMANTIC` tuples, about 15 fewer LOC, and call sites go back to the 0099 shape.
3. **Align the want reconcile with the product one (M3, L1, L2).** One executemany upsert plus one `ANY(:ids)` re-trigger per batch, no `now_factory`, and one `is_enabled` gate. Impact: about 10 fewer LOC and 62 fewer statements per full batch of 32.

## 7. Summary Statistics
| Metric | Current | After the top 3 |
|---|---|---|
| New production LOC (backend + matcher + script) | ~1,000 new + ~650 changed | ~−25 |
| Statements per want reconcile batch (32) | 1 select + 64 writes | 1 select + 2 writes |
| Positional parameter layouts in `statements.py` | 4 (lexical forward/window, SIMILAR forward/window) | 1–2 |
| Dead parameters or functions | 1 (`now_factory`) + 1 test-only (`get_embedder`) | 0 |
| Findings | 0 Critical / 0 High / 3 Medium / 6 Low | — |

## 8. Conclusion
The tier is built pragmatically for the project's scale. It adds no new infrastructure beyond the pgvector image, and every user-chosen mechanism is implemented compactly. The open items are local clean-ups:
1. M1: give each reconcile side its own `try` (15 min).
2. M3 with L1 and L2: align the want reconcile with the product one (45 min).
3. M2: one parameter layout for matcher statements (1 h).
4. Optional: L3 (move the SQLSTATE constant), L5 (drop the copy of the parity names).

Estimated total: about 2–2.5 h. None of these blocks the shadow deploy.
