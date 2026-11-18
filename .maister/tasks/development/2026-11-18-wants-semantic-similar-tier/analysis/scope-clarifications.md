# Scope Clarifications (Phase 2)

## TL;DR
Seven gap-analysis decisions were resolved, all on the recommended option. SIMILAR stays invisible on the item-page closing prompt. The sweep is an APScheduler 1-min job. Existing products and resumed wants rely on the sweep. The model id is a backend constant with a drift test. The backfill drains before the matcher deploy. The lead text under „Powiązane rzeczy” is „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.”

## Key Decisions
- **C1 `list_wants(matched_item_id)`** counts only MATCH and SUGGESTION and excludes SIMILAR. This keeps shadow mode invisible, and a related item is not the wanted item.
- **I1 Reconcile sweep** is an APScheduler interval job (1 min) next to the term-end scan and the media sweep. Update the jobs assertion in `tests/test_wants_scan_removed.py:68`.
- **I2 `get_or_create_product_by_name`**: on the early return, a missing vector is left to the sweep and outbox. The hot path gets no extra read.
- **I3 `resume_want`** reuses the stored vector. The sweep repairs a missing or stale vector for ACTIVE wants and re-triggers matching.
- **I4 Model id**: an `EMBEDDING_MODEL_ID` constant in `app/embeddings`. The loader refuses a mismatching `model_id.txt`. Matcher `rules.py` pins the same string, and a new AST drift test compares the two.
- **I5 Backfill order**: deploy the backend and sweep first, drain off-peak, then deploy the matcher at revision 101. This is documented in the runbook.
- **I6 Section lead**: „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.” It can be edited in review.

## Not decisions (settled by the analysis)
- `e.updated_at` in `changed_at` is already chosen in ADR-001 and ADR-005. Rewrite the "in-place rename not re-read" known limit in `architecture.md` and the 0099 comment.
- Tests force `EMBEDDINGS_ENABLED=false`. Only tests with a failing FakeEmbedder need an `event_types` filter.
- The constants drift test keeps passing. The model-id check is a new test.
- No new authorization matrix row. Only the comment and a test row change.
- An embedder load error aborts startup when the feature is enabled. Only runtime misses fail open.
- Spec defaults:
  - embed timeout 2 s
  - sweep batch of 300 products and 300 wants per tick
  - `SEMANTIC_CAP` 10
  - `SEMANTIC_SIMILARITY_MIN` 0.86
  - `/similar` returns up to 10 results, ordered by score desc, then item id
