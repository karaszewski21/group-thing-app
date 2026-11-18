# Gap Analysis: semantic SIMILAR tier for the „Szukam” matcher

## TL;DR
Nothing semantic exists today. There is no pgvector, no embedder, no vector tables, no SIMILAR tier, no `/similar` route and no „Powiązane rzeczy” section. Every anchor the design names (I1–I15) is present, and SUGGESTION is the template for most of the work. The research and Phase 1 settle the architecture. Six smaller choices are still open. One of them affects users: `list_wants(matched_item_id)` ignores tier, so during shadow mode SIMILAR rows would already change the item page's closing prompt in the current web image. That breaks ADR-004's promise that shadow mode changes nothing for users, so it is the one critical decision. Risk: Medium-High. Effort: High.

## Key Decisions
- **Characteristics**: modifies existing code + creates new entities + data operations + light UI. There is no defect. The task changes the 0099 contract, the matcher and the write paths, and adds a module, two tables, a route and a section.
- **Change type: additive.** Lexical MATCH/SUGGESTION behaviour, bells and counts stay as they are (ADR-002). One existing behaviour does change: the `changed_at` re-read on in-place renames (see Behavioural Changes).
- **Q2 (`e.updated_at` in `changed_at`) is not re-opened.** ADR-001 and ADR-005 chose it. It only needs the documented known limit rewritten.
- **Q6 (unfiltered `dispatch_pending` tests) needs no decision.** With `EMBEDDINGS_ENABLED=false` forced in `tests/conftest.py`, the design stages no `embeddings.requested` rows (F4). The 13 unfiltered calls (`test_outbox.py`, `test_term_end_scan.py`, `test_notifications.py`) are unaffected. Only tests that turn on `FakeEmbedder` in failing mode need `event_types=[...]`.
- **Q7 (drift test) needs no rewrite.** `test_backendLimits_movedConstantsGone_onlyReminderLeadShared` only parses `app/wants/domain/limits.py`. The SIMILAR constants belong in `matcher/rules.py` and the model id in `app/embeddings`, so that assertion stays true. The model id drift check is a new test (see decision I4).
- **Matrix rows 66–67** already cover `^/api/wants(/.*)?$`. No new row is needed, only the comment and a test row.

## Open Questions / Risks
- Backfill re-entry: about 50k products get vectors and move `changed_at`, so about 167 capped window runs (300 each) re-read every listing lexically. That also happens with an old matcher on 0101. It can ring R12 bells and delays brand-new listings while it drains (decision I5).
- Quality is still unproven. 0.86 is provisional, and the release gate (≥300 pairs) and the VPS A measurement stay pre-deploy steps outside the code.
- An old backend or matcher image against DB 0101 is inferred safe but untested. The runbook must test it.
- An embedder load error with `EMBEDDINGS_ENABLED=true` aborts startup, the same as moderation (`main.py` comment "a load error propagates"). A config error fails fast. Only runtime misses fail open.

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: High (about 35 files across five layers)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy (light)

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: yes (`product_embeddings`, `want_embeddings`, tier SIMILAR, `app/embeddings`)
- Involves data operations: yes
- UI heavy: yes, light (one new section and card on `/wanted/[id]`)

## Gaps Identified

### Missing Features (verified absent)
- **pgvector**: no `vector` extension and no 0100/0101 revisions. `docker-compose.yml:3` and both conftests use plain postgres:18.
- **Embedder**: there is no `app/embeddings`, and the Dockerfile `models` stage exports only Bielik-Guard with no int8 quantize step.
- **Vector writers**: `product/service.py` `create_product` (l147), `update_product` (l164) and `get_or_create_product_by_name` (l184), and `wants/writes.py` `create_want`/`update_want` write no vectors.
- **Outbox retry and sweep**: there is no `embeddings.requested` type, no handlers, no reconcile job, and `wants/infrastructure/outbox_acl.py` has no `append`.
- **Matcher SIMILAR**: `statements.py` has only MATCH/SUGGESTION, `CONTRACT_REVISION=99` and no semantic constants in `rules.py`.
- **Read API and UI**: there is no `/api/wants/{id}/similar`, no `WantSimilarResponse`, no `getWantSimilar`, and „Powiązane rzeczy” appears nowhere in `src/frontend`.

### Incomplete Features (need refactoring, not copying)
- `_statement()`/`_LIMITS`/`_store` assume word scoring and bind `$3`/`$4` as word constants. They need a tier-specific `pairs` body and per-tier params.
- `window._match` counts `suggestions = len(pairs) - len(matches)`. It needs per-tier counts plus `similar=` in `WindowRun`/`_Match` and the log line.
- `matchable_listings` has no `product_id` or vector columns, so it is recreated with the LEFT JOIN inside it. The downgrade restores the exact 0099 SQL.
- The visibility block is inline in `_statement()`. It is extracted into a fragment, and the parity test is re-pointed at it.
- `ck_want_matches_tier` and `ck_want_matches_missing_words` (0099 l375–379, mirrored in `models.py` l178–181) are rewritten.

### Behavioural Changes Needed
- **`matchable_listings.changed_at`**: today an in-place product rename is "not re-read" (architecture.md known limit, 0099 l205–210). After 0101 a re-embed moves `e.updated_at`, so the rename is re-read by every tier. This partly closes the known limit and must be documented.
- **`list_wants(matched_item_id)`** (`reads.py` l189–202, docstring "stored pair of either tier"): today it covers MATCH and SUGGESTION. Without a change it would include SIMILAR (decision C1).
- **Lifespan job list**: a reconcile job changes `tests/test_wants_scan_removed.py:68` (decision I1).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | `/wanted/[id]`: MATCH list + „Może Cię zainteresuje” | Plus „Powiązane rzeczy” below suggestions (after the web deploy) | OK, same page, no new navigation |
| Discoverability | n/a | 7/10 (third section, below the fold on mobile) | Acceptable for a bell-less, secondary tier (by design) |
| Flow Integration | Item page closing prompt shows wants holding the item as MATCH/SUGGESTION | Unchanged if C1 filters by tier; otherwise SIMILAR wants appear there, during shadow too | Risk, see C1 |
| Multi-persona | Seeker only (party-only `/matches`, `/suggestions`) | Same for `/similar`. Lister: no UI change, only write latency +25–50 ms | OK |

## Data Lifecycle Analysis

### Entity: SIMILAR match (`want_matches.tier='SIMILAR'`)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Matcher `FORWARD_SIMILAR`/`WINDOW_SIMILAR` (in scope) | none by design (system-created) | n/a | In scope |
| READ | `GET /api/wants/{id}/similar` (in scope) | `SimilarSection` + card (in scope) | Rendered on `/wanted/[id]`; held back during shadow (ADR-004, accepted) | In scope |
| UPDATE | none; born seen, never upgraded (ADR-002) | n/a | n/a | Intentional |
| DELETE | Want name edit deletes all pairs (`update_want`), purge and CASCADE | via edit | edit page | Existing |

### Entities: `product_embeddings`, `want_embeddings`
Internal derived data with no UI by design. CREATE and UPDATE come from the writers, the outbox handler and the sweep. READ happens only inside matcher SQL and is never returned by the API (R5). DELETE is ON DELETE CASCADE.

**Completeness**: 100% of the designed lifecycle is in scope. The READ UI being held back during shadow is a deliberate rollout choice (ADR-004), not an orphan.
**Orphaned Operations**: none.
**Missing Touchpoints**: one. The item-page closing prompt (`useWantsMatchingItem` → `getMyWants(itemId)` → `list_wants(matched_item_id)`, used by `features/product/blocks/ItemPickupActions.tsx`) is tier-blind (C1).

## Issues Requiring Decisions

### Critical
1. **C1 `list_wants(matched_item_id)` tier filter**: it matches any stored pair. SIMILAR rows would make the item page offer „close your Szukam” for merely related items. Because the current web image already calls it, users would see this during shadow mode.
   - Options: [A] Restrict to MATCH and SUGGESTION. [B] Include SIMILAR (also during shadow). [C] Restrict now and decide on SIMILAR after the shadow period.
   - Recommendation: **A**. It keeps the shadow promise and „related” is not „the thing I wanted”. C is the same code as A.

### Important
1. **I1 Reconcile sweep scheduling**: the design says every 60 s.
   - Options: [A] APScheduler interval job `_run_embedding_reconcile` (1 min) next to the term-end and media jobs, and update `test_wants_scan_removed.py:68`. [B] A separate asyncio loop task like the outbox poller. [C] A startup-only pass.
   - Default: **A**. It follows the existing job pattern (misfire/coalesce settings). C loses recovery from FAILED rows and the model-switch drain.
2. **I2 `get_or_create_product_by_name` early return**: an existing product without a current vector.
   - Options: [A] Leave it to the sweep and outbox. A late vector moves `changed_at`, so the listing re-enters the window. Catalogue picks (`inventory_items.py:275`, by `product_id`) need the sweep anyway. [B] Add an embed-if-missing branch (an extra read on a hot path).
   - Default: **A**. Embed only on new and renamed products.
3. **I3 `resume_want`**: reuse the stored vector (design F2). A missing or stale vector is left to the sweep, which re-embeds ACTIVE wants and re-sets `match_requested_at`.
   - Options: [A] Reuse the stored vector and let the sweep repair (≤60 s delay for SIMILAR only). [B] Embed in resume when the vector is missing or the model id is stale.
   - Default: **A**.
4. **I4 Model id source of truth and drift check**:
   - Options: [A] An `EMBEDDING_MODEL_ID` constant in `app/embeddings` (name@revision/int8/prefix). The loader refuses a `model_id.txt` that differs. The matcher pins the same string in `rules.py`. A new drift test parses the backend constant via AST, like `_limits()`. [B] Use only the runtime `model_id.txt`, with the matcher pinned and no automated check. [C] A Dockerfile ARG as the source, with a test reading the Dockerfile.
   - Default: **A**. It keeps the pinned tuple (R2) testable in CI without the model.
5. **I5 Backfill order and re-entry**: the first sweep moves `changed_at` on every listing.
   - Options: [A] Deploy the backend (0101 + sweep) and let the backfill drain off-peak before deploying the matcher at 101, then watch `capped=` and the bells in the runbook. [B] Deploy the matcher right away and accept the mixed backfill and SIMILAR load. [C] Make the backfill not move `changed_at` (extra view logic, conflicts with the R4 re-trigger).
   - Default: **A**. Re-entry still runs lexically on the old matcher, so it is documented as R12.
6. **I6 Section lead copy** for „Powiązane rzeczy” (ADR-006 left the wording to the product owner).
   - Options: [A] „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.” [B] Heading only, no lead. [C] Wording from the product owner.
   - Default: **A**, editable in review.

## Recommendations
- Spec defaults that are not decisions: an embed timeout of 2 s (vs moderation's 5 s), a sweep batch of 300 products + 300 wants per tick, `SEMANTIC_CAP=10`, `SEMANTIC_SIMILARITY_MIN=0.86`, and `SIMILAR_LIMIT=10` ordered by score desc then item id.
- Put `FakeEmbedder` in `tests/conftest.py` and force `EMBEDDINGS_ENABLED=false` next to `MODERATION_TEXT_ENABLED` (l47). Add `product_embeddings`/`want_embeddings` to the matcher `_TRUNCATED`.
- Give `seed_want_matches` a `tier=` parameter. Clone `test_suggestions.py` as `test_similar.py`, including "never two tiers for one pair" and "lexical first".
- Docs: replace "no revision 0100" (architecture.md:687), the postgres:18 references (architecture.md:383, tech-stack.md:53/114) and the rename known limit, and add the 0100/0101 + image runbook (pg_dump, `rolsuper`, `\dx vector`, rollback 0101 → 0100 → image).
- Configuration and infra changes must never print secrets. `HF_TOKEN` stays a build secret file, and `.env.example` gets names only.

## Risk Assessment
- **Complexity Risk**: High. A matcher statement refactor, a view recreate with an exact-reverse downgrade, and two write paths that must never fail.
- **Integration Risk**: High. The DB contract is shared by two services, plus an image swap, a model build stage, and the structural guards (boundaries, parity, drift, contract gate, lifespan job list).
- **Regression Risk**: Medium. Lexical tiers must stay byte-identical in behaviour (per-tier counts, bells for MATCH only, the visibility fragment text). Existing tests are strong.
