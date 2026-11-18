# Requirements: semantic SIMILAR tier for „Szukam”

## TL;DR
Build the SIMILAR design end to end:
- `pgvector` (0100) and the vector side tables, the view and the tier CHECK (0101);
- an int8 mmlw-roberta-base embedder in the API process;
- sync best-effort vector writes, with an outbox retry and a 1-min reconcile job;
- matcher SIMILAR statements, run last, behind gate 101;
- `GET /api/wants/{id}/similar`;
- a quiet „Powiązane rzeczy” section on `/wanted/[id]`.

Lexical behaviour, bells and counts must not change. The threshold is provisional (0.86) until the release gate re-scores it.

## Key Decisions
- The architecture is fixed by research ADR-001..009 (`analysis/research-context/decision-log.md`). No new technical clarification round, because all approaches were already chosen.
- Phase 1 and Phase 2 decisions are in `analysis/clarifications.md` and `analysis/scope-clarifications.md`.
- Phase 5 confirmations:
  - The SIMILAR journey exists only on `/wanted/[id]`.
  - Reuse the SUGGESTION tier end to end.
  - Extract `reservedCaption`.
  - The Phase 4 mockups are binding.

## Open Questions / Risks
- Quality on real names is unproven. Deploying needs the labelled-sample gate, which is not code.
- VPS A capacity has not been measured (rollout step 0b).

## Initial description
Implement the research outcome in `.maister/tasks/research/2026-11-18-wants-semantic-embeddings`. Add semantic matching to the „Szukam” matcher with a small embedding model and pgvector, as a bell-less third tier SIMILAR shown as „Powiązane rzeczy”.

## Q&A (all rounds)
**Phase 1**
1. Scope: everything, including the frontend, the Dockerfile, compose, `.env.example` and docs. Shadow mode comes from deploy order.
2. `SEMANTIC_SIMILARITY_MIN` = 0.86 (probe best-F1). The release gate re-scores it.
3. The Dockerfile `models` stage exports mmlw-roberta-base, runs int8 and a ≥0.99 cosine parity gate, and writes `model_id.txt` to `/models/embed`.
4. The DB image is `pgvector/pgvector:0.8.7-pg18-trixie` in compose and in both conftests.

**Phase 2**
5. `list_wants(matched_item_id)` counts MATCH and SUGGESTION only; SIMILAR is excluded.
6. The reconcile sweep is an APScheduler 1-min job. Update `tests/test_wants_scan_removed.py:68`.
7. An existing product without a vector on the `get_or_create` early return is left to the sweep.
8. `resume_want` reuses the stored vector, and the sweep repairs a missing one.
9. The `EMBEDDING_MODEL_ID` constant lives in `app/embeddings`. The loader refuses a mismatching `model_id.txt`. Matcher `rules.py` pins the same string, and a new AST drift test checks both.
10. Backfill order: deploy the backend and the sweep first, drain the backfill, then deploy the matcher at 101. The runbook documents this.
11. Section lead: „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.”

**Phase 5**
12. User journey: logged-in seekers see SIMILAR only on `/wanted/[id]`, below „Może Cię zainteresuje” and above the actions.
    - No bell, badge, count or email.
    - Opening a card marks it opened, like a suggestion.
    - Closed wants show no SIMILAR.
13. Reuse:
    - Copy the SUGGESTION tier end to end.
    - Follow the moderation ONNX pattern for the embedder.
    - Use the `bells_due` `begin_nested` handler pattern.
    - Extract the duplicated `reservedCaption` into one helper used by MatchCard, SuggestionCard and SimilarCard.
14. Visual assets: the Phase 4 HTML mockups (`analysis/design-context/INDEX.md`) are the only binding visual reference.

**Phase 6 (audit) decisions** (from `verification/spec-audit.md`)
15. **H1: background re-triggers are SIMILAR-only.**
    - 0101 adds the nullable `wants.similar_requested_at` and a trigger that NOTIFYs `wants_changed` when it is set.
    - These set it instead of `match_requested_at`: the outbox want-handler retry, the want reconcile backfill and a model switch.
    - The matcher's request loop also claims wants with that flag (`FOR NO KEY UPDATE SKIP LOCKED`), runs only `FORWARD_SIMILAR` for them, then compare-and-clears it.
    - A want with `match_requested_at` set runs the full forward run (SIMILAR last), and clears both flags when `similar_requested_at` was set at or before the claim.
    - Product-side late vectors keep moving `changed_at` via `e.updated_at`. Window MATCH pairs are born unseen, so no bell is lost; the spec confirms this.
    - The spec covers: the exact claim/clear SQL, the backoff interplay, the 0101 downgrade dropping the column and trigger, tests (a background re-trigger stores no lexical pairs and rings no bell; a full forward run clears the SIMILAR flag), and the matcher gate covering the new column.
16. **M2: the handler waits, the sweep skips.** The outbox handlers lock their subject with plain `FOR NO KEY UPDATE` (a short wait, no SKIP LOCKED), so a locked row is never mistaken for "gone". The reconcile sweep uses `FOR NO KEY UPDATE SKIP LOCKED`.
17. **M5: stop the matcher, then run alembic.** `docker compose stop matcher`, then `docker compose run --rm --no-deps backend alembic upgrade 0100` and `upgrade head`, then `docker compose up -d --remove-orphans`. This is the same pattern as the amended-0099 runbook.
18. **Standards carve-outs approved.** The unmapped side tables with an owner-id PK and no `BaseEntity` (precedent `want_scan_markers`) are approved. When shipping, run `/maister:standards-update` to record the carve-out in `standards/backend/models.md` and `migrations.md`.

## Similar features identified
- **SUGGESTION tier**:
  - backend `app/wants/application/reads.py` (`_suggestions_select`, `list_suggestions`), `schemas.py`, `router/wants.py:91`
  - matcher `statements.py` (`_TIERS`, `_LIMITS`, `_statement`)
  - frontend `useWantMatches.ts`, `wantMatchesViewState.ts`, `WantMatchesView.tsx` (`SuggestionsSection`), `SuggestionCard.tsx`
  - tests `test_wants_matches_api.py`, matcher `test_suggestions.py`, frontend `wantMatchesViewState.test.ts`, `useWantMatches.test.tsx`, `WantMatchesView.test.tsx`
- **Moderation ONNX**: `app/moderation/onnx_models.py`, `classifiers.py`, `text_guard.py`; fake in `tests/test_text_guard.py`.
- **Outbox handler**: `app/wants/application/bells_due.py` (idempotent `register()`, `begin_nested()`).
- **Extension migration**: `alembic/versions/0086_pg_trgm.py`. **View and CHECKs**: `0099_wants.py`.
- **Startup gate**: `main.py::_check_wants_contract`. **Matcher gate**: `db.py::missing_contract`.

## Visual assets
- `screen:want-detail-active-similar`, `screen:want-detail-empty-similar`, `screen:want-detail-matching-similar`
- `component:similar-section`, `component:similar-card`

All are listed in `analysis/design-context/INDEX.md`. Binding points: placement, heading „Powiązane rzeczy” with an aria-hidden emoji, the lead copy, a dashed ItemCard with no footnote and no „nowe” marker, and the section rendered only when the list is non-empty, in the four active states.

## Functional requirements summary
1. **DB**:
   - 0100 runs `CREATE EXTENSION vector` (superuser runbook in the docstring).
   - 0101 creates `product_embeddings(product_id PK→products CASCADE, model_id, embedding halfvec(768), updated_at)` and `want_embeddings(want_id PK→wants CASCADE, …)`.
   - 0101 recreates `matchable_listings` with a `LEFT JOIN product_embeddings`, exposes `embedding` and `model_id`, and adds `e.updated_at` to `changed_at`.
   - Tier CHECK `MATCH|SUGGESTION|SIMILAR`. `missing_words` is NULL for MATCH and SIMILAR.
   - Downgrade deletes SIMILAR rows and restores the 0099 view and CHECKs. ORM mirrors are updated.
2. **Embedder** (`app/embeddings`, compute-only):
   - Protocol and fake; ONNX int8, CLS pooling and L2 norm; prefix `zapytanie: ` for queries.
   - Runs via `to_thread` with a 2 s timeout and 1 intra-op thread.
   - `EMBEDDING_MODEL_ID` constant plus a check against `model_id.txt`.
   - Loaded in the lifespan behind `EMBEDDINGS_ENABLED`. A load error aborts startup.
3. **Writers**:
   - Product: embed on create, on `get_or_create` when a new product is made, and on an in-place rename. The write happens in the same transaction.
   - Want: embed on create and on a name edit, before the lock. The write happens in the same transaction as `match_requested_at`.
   - A miss commits the write without a vector and stages `embeddings.requested {subject, id}`. Wants stage it via `outbox_acl.append`.
4. **Outbox handlers**:
   - One handler per module, filtered on the payload subject and wrapped in `begin_nested()`.
   - Each re-reads the current name. A deleted subject is a no-op.
   - The want handler re-sets `match_requested_at` without bumping `updated_at`.
5. **Reconcile job**:
   - APScheduler, every 1 min.
   - Per tick, up to 300 products and 300 ACTIVE wants that have no vector or whose `model_id` is not current, selected with `SKIP LOCKED`.
   - Embeds in batches, upserts, and re-triggers as the handlers do.
   - Logs one line per tick.
6. **Matcher**:
   - Extract `_VISIBILITY`.
   - SIMILAR pairs body (vector distance, model id equality) with per-tier parameters.
   - Tier-generic cap.
   - `FORWARD_SIMILAR` and `WINDOW_SIMILAR` run last, born seen, `DO NOTHING`.
   - Count `similar` per tier in the window log line.
   - Gate at revision 101 plus both tables.
   - `rules.py`: `SEMANTIC_SIMILARITY_MIN=0.86`, `SEMANTIC_CAP=10`, `EMBEDDING_MODEL_ID`, with a drift test.
7. **Backend API**:
   - `GET /api/wants/{id}/similar`: party-only own want, `visible_matches`, at most 10 results, ordered by score desc then item id.
   - `WantSimilarResponse` = the suggestion response without `missing_words`, and no vectors.
   - Counts stay MATCH-only. `list_wants(matched_item_id)` excludes SIMILAR.
   - Startup check that both tables exist when the feature is enabled.
8. **Frontend**:
   - `getWantSimilar`, a fourth entry in `Promise.all`, and `NO_SIMILAR`.
   - Add `similar` to `WantMatchesData` and to the four active view kinds.
   - `SimilarSection` and `SimilarCard`; the extracted `reservedCaption`.
   - Typed fixtures, and tests updated everywhere `getWantSuggestions` is mocked.
9. **Infra and docs**:
   - Dockerfile `models` stage and `runtime` COPY.
   - Compose image and `EMBEDDINGS_ENABLED`; `.env.example`; conftest images and env.
   - Matcher `_TRUNCATED`.
   - `architecture.md`: drop "no revision 0100" and `postgres:18`, add a runbook for 0100/0101 incl. the backfill order and the rollback order 0101 → 0100 → image, and rewrite the rename known limit. `tech-stack.md`.

## Reusability opportunities
`_cards_select`, `_card_fields`, `visible_matches`, `_ensure_own_want`, `seed_want_matches` (add a `tier=` parameter), `count_queries`, `ItemCard`, `makeWant*` fixtures, `createQueryWrapper`, `renderWithRoute`, the `text_guard` setter/getter pattern, and the `FakeEmbedder` in `tests/conftest.py` (three or more importers).

## Scope boundaries
**In**: everything above.

**Out**:
- semantic `/api/public/search`
- LLM expansion or judging
- GPU and VPS B
- a SIMILAR bell
- the category guard and the anchor gate
- HNSW
- int8 Bielik-Guard
- a dedicated embedder process
- embedding descriptions or notes
- upgrading SIMILAR to MATCH
- the labelled sample itself and the VPS A measurement (operational release-gate steps, documented only)

## Technical considerations
- Postgres rejects untyped unused parameters, so rebind `$3`/`$4` per tier.
- `window._match` currently counts every non-MATCH pair as a suggestion.
- `matchable_listings` has no `product_id`.
- The dispatcher has no savepoint.
- Tests force `EMBEDDINGS_ENABLED=false`.
- The `ml` dependency group is not installed in tests, so tests use the fake.
- `halfvec` is passed as text with `CAST(:v AS halfvec)`; there is no pgvector Python package.
- Never print secrets.
