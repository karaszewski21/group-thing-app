# Codebase: where each piece of the semantic tier would go, and the constraints that apply

## TL;DR
- Six slots: **writer** (backend, sync next to `check_text` for products and wants, or an outbox handler in the API poller), **storage** (a side table per product plus a vector for wants, in a new revision 0100), **trigger** (`changed_at` and `match_requested_at`, which the vector write must feed), **matcher statement** (a third tier built from the existing CTE and visibility fragments), **API** (a third list or a tier parameter, filtered by `visible_matches`) and **UI** (a third section next to „Może Cię zainteresuje”).
- Constraints that cannot be bent: the matcher stays asyncpg-only with no model; visibility has exactly one SQL copy (`private_group_peers`) and one Python copy, with a parity test; `app/wants` reaches other contexts only through `infrastructure/*_acl.py`; the clock is read only through `matcher/clock.py` and `app.core.clock`; constants live in `rules.py` as bound parameters.
- **Naming collision**: the existing suggestions section already has the subtitle „Podobne rzeczy — brakuje im jednego słowa…”, so a third tier named „Podobne rzeczy” would clash.
- `polish_names.py` (52 "things" with listed and wanted synonym sets) can serve as a ready local smoke-test corpus: same-key pairs such as „Samochód”/„Autko”/„Resoraki” are positives, cross-key pairs are negatives.

## Key Decisions
- (Inferred) Key the vectors on `products.id` (shared, deduplicated by `resolve`) and on `wants.id`. Do not key them on items.

## Open Questions / Risks
- Embedding the description too: the description is stored on the shared product ("gallery and shared description", product/router.py:5), so a product-level vector matches what each item shows. But any owner of the product can edit the description in place (`PATCH …/description`), which then needs a re-embed and does not move `changed_at`.
- If the matcher statement also needs a "want has a vector" filter, a want without one (model down) silently gets no semantic tier. That is acceptable if it is logged.
- Frontend tests use typed fixtures (frontend-testing standard). A new response type means new fixtures and `resolveWantMatchesView` table rows.

---

## 1. Placement map

| Piece | Where today's analogue lives | Where the semantic piece would go | Notes / evidence |
|---|---|---|---|
| Model loading | `app/moderation/onnx_models.py:27-69`, loaded in the lifespan when enabled (`app/main.py:125-130`), model exported in Dockerfile `models` stage (src/backend/Dockerfile:19-35) | A new `OnnxEmbedder` (same session options, mean pool + L2 norm), its own switch (for example `EMBEDDINGS_ENABLED`) and its own dir `/models/embed`, exported in the same `models` stage with `--task feature-extraction` | Protocol and fake pattern: `classifiers.py:1-16`, `text_guard.set_classifier` (text_guard.py:164-173). The module could be `app/moderation` (it already owns the models dir) or a new `app/embeddings` reached through ACLs. |
| Product vector writer | `check_text(PRODUCT_NAME)` in `create_product` (product/service.py:150) and `get_or_create_product_by_name` (product/service.py:203); in-place rename in `update_product` (product/service.py:164-181) | Sync: compute after `check_text`, insert into `product_embeddings` in the same commit. Async: `outbox_service.append(event_type="embeddings.product_requested", payload={"product_id": …})` (pattern: `_stage_photo_files_delete`, product/service.py:232-240) | Products are shared via resolve (product/service.py:184-213), so the vector is computed once per distinct name and category. Renames re-point the item (inventory_items.py:273-275). |
| Want vector writer | `_check_texts` in `create_want` (wants/application/writes.py:159) and `update_want` (writes.py:223); flags at writes.py:177, 247, 311 | Sync: compute after `_check_texts` (unlocked, as the classifier) and store with the flag. On edit, only when `name` changed. On resume, reuse the stored vector | Must not bump `wants.updated_at` from a background job (version column, base_model.py:61-66; 409 check writes.py:231-234). |
| Storage | `products.search_vector` (GENERATED, product/models.py:63-67); `wants.stem_*` (GENERATED, 0099_wants.py:321-337) | New revision **0100**: `CREATE EXTENSION vector`; `product_embeddings(product_id PK FK→products ON DELETE CASCADE, model_id, embedding halfvec/vector(n), updated_at)`; `wants.name_embedding` column or `want_embeddings(want_id PK FK ON DELETE CASCADE, …)`; index choice from the pgvector gatherer | A side table keeps the Product and Want ORM free of a vector type. The backend has no `pgvector` package (pyproject.toml:34-38), so writes go through Core/text with a `CAST(:v AS vector)` string. `model_id` mirrors `model_id.txt` (onnx_models.py:42-47) and marks rows to re-embed after a model change. |
| View | `matchable_listings` (0099_wants.py:211-249) | 0100 recreates the view with `LEFT JOIN product_embeddings e ON e.product_id = pr.id`, exposing `e.embedding`, and optionally adds `e.updated_at` to `greatest(...)` of `changed_at` | Rule: "A revision that alters a column the views read must drop and recreate the views" (0099_wants.py:40-41; architecture.md:723). Adding `e.updated_at` to `changed_at` makes an async vector re-enter the window. It also re-runs the lexical tiers for that listing, which is harmless because of `NOT EXISTS` (statements.py:171-173). |
| Trigger / wake-up | `trg_wants_match_requested` on `match_requested_at` (0099_wants.py:154-170); the window on `changed_at` (window.py:11-27) | Sync writer: nothing new (the vector is there before the flag is claimed and before the listing is matchable). Async writer: the want handler sets `match_requested_at = now` again after storing the vector (fires NOTIFY); the product handler relies on `changed_at` including `e.updated_at` | Forward match runs once per flag (requests.py:66-94). |
| Matcher statement | `_statement(window, tier)` (statements.py:141-197), tiers `_TIERS` (:123-126), caps `_LIMITS` (:131-138) | A semantic statement pair (`FORWARD_SEMANTIC`, `WINDOW_SEMANTIC`) reusing `_WANTS`, `_WINDOW_LISTINGS`, `_NARROWING`, the visibility `WHERE` and `NOT EXISTS`, but replacing `_WORD_CHECK` and the text candidate with `1 - (w.embedding <=> l.embedding) >= $k` and ordering by distance. Runs **last** in `match_forward` / `match_window` (statements.py:220-247). `seen_at = $1` (bell-less). Cap via its own `SEMANTIC_CAP` in `_LIMITS` style | Constants as bound parameters in `rules.py` (rules.py:1-3). The window's semantic count must be logged apart from suggestions (window.py:177, 235-249). |
| DB constraints | `ck_want_matches_tier`, `ck_want_matches_missing_words` (0099_wants.py:375-380; models.py:176-186) | 0100 drops and re-adds both with the third tier (`missing_words IS NULL` for it); update `WantMatchTier` (models.py:163-168) | `tier` String(10) fits `SEMANTIC` / `SIMILAR`. The downgrade must delete (or re-tier) third-tier rows before restoring the CHECKs. |
| Matcher gate | `CONTRACT_REVISION = 99` and `to_regclass('public.matchable_listings')` (db.py:20-57) | Bump to 100, or additionally check `to_regclass('public.product_embeddings')` | Otherwise a 0099-only DB would fail at runtime on the semantic statement. |
| API | `GET /api/wants/{id}/suggestions` (router/wants.py:91-95), `reads._suggestions_select` (reads.py:266-272), `visible_matches` (reads.py:55-73) | `GET /api/wants/{id}/similar` (or `?tier=`) with a new `_similar_select` using `_cards_select(..., tier=SEMANTIC)` (reads.py:210-250), a `WantSimilarResponse` without `missing_words` (schemas.py:105-115 has it as required) | Counts stay MATCH-only (reads.py:76-89). Visibility is inherited from `visible_matches`. |
| Bells | `wants.bells_due` MATCH only (window.py:174-175; bells_due.py:1-11) | No change (bell-less) | — |
| UI | `SuggestionsSection` „Może Cię zainteresuje” with subtitle „Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.” (src/frontend/src/features/wanted/WantMatchesView.tsx:327-350); `SuggestionCard` dashed with „brakuje:” footnote (SuggestionCard.tsx:11-40); fetched in `useWantMatches` with `Promise.all([getWant, getWantMatches, getWantSuggestions])` (src/frontend/src/hooks/useWantMatches.ts:41-57); view state union carries `suggestions` on active states only (wantMatchesViewState.ts:26-35) | A third fetch (`getWantSimilar`, src/frontend/src/api/wants.ts:119-121 pattern), a third array in `WantMatchesData` and the active view states, a section below suggestions, and a card without the „brakuje” footnote | Rename either the existing subtitle or the new tier: „Podobne rzeczy” is already used by the suggestions subtitle. |
| Tests | Matcher: raw-SQL seeds (src/matcher/tests/conftest.py:261-414), `postgres:18` (conftest.py:67). Backend: `postgres:18` (src/backend/tests/conftest.py:58), migration tests `tests/test_wants_migration.py` | pgvector image in both conftests and in the testing standard (`.maister/docs/standards/testing/backend-testing.md:6`); hand-made vectors in matcher tests; a fake embedder in backend tests; downgrade-then-upgrade test for 0100 (migrations standard) | Docs also name `postgres:18` (tech-stack.md:53, 114; architecture.md:383). |
| Compose / ops | `postgres: image: postgres:18` (docker-compose.yml:3); no resource limits | `pgvector/pgvector:pg18` (same data dir layout to be confirmed by the pgvector gatherer); the 0099 runbook pattern for a 0100 runbook (backup, verify, rollback) | The architecture sentence "There is no revision 0100" (architecture.md:687) must be updated. |

## 2. Constraints

### C1. Matcher is asyncpg-only and model-free
`src/matcher/pyproject.toml` `dependencies = ["asyncpg==0.31.0"]`; Dockerfile "No model, no secrets" (src/matcher/Dockerfile:3); compose comment "no ports, no secrets" (docker-compose.yml:49-54); brief constraint "matcher stays asyncpg-only with no ML deps" (planning/research-brief.md, Scope/Constraints). So the matcher only compares stored vectors in SQL. It never embeds text and never decodes vectors in Python.

### C2. One visibility definition, with parity guards
- SQL copy: views `group_holdings` / `private_group_peers` (0099_wants.py:172-203), used at the call site as `l.visibility = 'PUBLIC' OR EXISTS private_group_peers` (statements.py:163-169).
- Python copy: `app/groups/infrastructure/visibility.py` / `membership.py`.
- Guards: `src/backend/tests/test_wants_visibility_parity.py:1-7` ("the matcher's call-site rule … against `items_visible_to(ALL)`") and `src/backend/tests/test_membership_definition_guard.py:12-13` (the AST guard, which leaves 0099 to the parity test).
- Consequence: the semantic statement must reuse the exact same `WHERE` fragment (ideally factored into a shared constant), never a new PRIVATE rule. PRIVATE listings get vectors like any other, and visibility is applied at match time and again at read time (`visible_matches`, reads.py:55-73).

### C3. Module boundaries
`src/backend/tests/test_module_boundaries.py:1-17`: `app.wants` (like `pages` and `search`) is imported only by `app/main.py`, its code outside `infrastructure/` reaches no other context, and its ACLs never import its own schemas. An embedder used by `app/wants` must be reached through a new `app/wants/infrastructure/embedding_acl.py`, as `moderation_acl.py` is today (wants/infrastructure/moderation_acl.py, 11 lines). The product side lives in `app/product`, which is not under this guard but follows the same ACL standard (INDEX.md, models standard).

### C4. Clock guards
- Matcher: only `matcher/clock.py` may call `datetime.now(`, `datetime.utcnow(` or `date.today(` (src/matcher/tests/test_clock_guard.py:1-20). Every run takes one `now` and passes it down (clock.py:1-8; window.py:219-226).
- Backend: `tests/test_domain_clock_guard.py:28-34` guards `app/wants` (among others). An embedding writer in `app/wants` must take `now` as an argument (routers pass `datetime.utcnow()`, router/wants.py:80-109) or use `app.core.clock`.

### C5. Constants and drift
`rules.py` is "the single home of the matcher's constants" (rules.py:1-3). The drift test asserts that the backend's `limits.py` shares only `REMINDER_LEAD` (src/matcher/tests/test_constants_drift.py:70-79). A semantic threshold and cap belong in `rules.py` only.

### C6. Release gate
"No feature switch. Do not deploy it until the labelled Polish sample (at least 200 want/item pairs …) has been scored … and the thresholds are set from it" (architecture.md:294). The brief puts the semantic tier without a bell "until scored on the release-gate sample" (research-brief.md, Key Decisions). The same sample can score the cosine threshold. But the gate as written names only the per-word rule, so it would need extending to the semantic threshold.

### C7. Error policy in loops
Scheduled jobs: a lost race (`40P01` / `40001`) is one WARNING and a retry next run, and other failures are logged once with a traceback and not re-raised (db.py:93-103; error-handling standard). Backend outbox handlers retry 5 times, then FAILED (dispatcher.py:20, 72-83). An embedding handler failing on a model error would turn its rows FAILED after 5 polls, about 5 minutes (inference from the 60 s poll).

### C8. Secrets
The backend build needs `HF_TOKEN` only for the gated Bielik model (docker-compose.yml:22-25; Dockerfile:28-35). Public embedding models need no token. Compose's `DATABASE_URL` is shared by backend and matcher and is never logged (settings.py:1-2).

## 3. Local smoke-test corpus
**Source**: `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/polish_names.py:1-155`; `seed_measurement.py:51-55`
- `THINGS` holds 52 `Thing(key, listed, wanted, adjectives, brands, sizes, purposes)` entries (polish_names.py:11-21, 67-118). `product_name(rng, thing)` and `want_name(rng, thing)` generate realistic titles and queries (polish_names.py:123-155).
- Built-in semantic positives (same key, different words): `auto` lists „Samochód|Samochodzik|Autko|…|Resoraki|Traktor|Koparka” and wants „samochód|autko|resoraki|…” (polish_names.py:94). `kalosze` includes „Gumowce”, `kanapa` includes „Sofa|Narożnik|Wersalka”, `telewizor` includes „TV|Monitor”, `pluszak` includes „Miś|Maskotka|Przytulanka”, `klocki` includes „Klocki drewniane|Klocki magnetyczne”.
- Built-in hard negatives: cross-key items that share words, for example „Wózek dla lalek” appears under both `wozek` (purpose „dla lalek”) and `lalka` (listed „Wózek dla lalek”), and „Kask narciarski” vs „Narty”. Caveat: keys group by object family, not strict synonymy (`auto` contains „Koparka”; `krzeselko` contains „Fotel biurowy”; `butelka` contains „Wanienka”), so key equality is a loose positive label. It is fine for a smoke test but not for setting the threshold (that is the job of the labelled release-gate sample).
- Seed scale used in measurements: 20,000 items, 10,000 wants, 150,000 stored pairs, 300 PRIVATE groups (results.md "What was measured"). `seed_measurement.py` and `explain_matcher.py` can be re-used to measure a semantic statement at the same scale.

## 4. Relevant cost baselines (for the synthesizer)
| Item | Value | Source |
|---|---|---|
| Bielik-Guard 0.1B fp32 ONNX in API | about 756 MB RSS, 479 MB dir, 2.5 s load, 20–40 ms per check (50 concurrent in 0.36 s) | `.maister/tasks/development/2026-10-02-text-image-moderation-policy/verification/reality-check.md:34` |
| Prior estimate, int8 Bielik | about 0.13 GB; text 50–150 ms (ONNX, estimate); shared vCPU may lack VNNI | `.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/outputs/research-report.md:241` |
| Forward match (lexical) | median 9–31 ms, max about 88 ms at 20k items × 10k wants | architecture.md:731-736; results.md:5 |
| Window (lexical, both tiers) | about 43 ms per takeable listing; capped run of 300 ≈ 13 s; 30 s per-statement timeout | rules.py:18-27; architecture.md:737-739 |
| VPS A size | **not documented**; no compose limits; VPS B 6 vCPU / 12 GB under consideration | docker-compose.yml; memory `ai-microservice-decision` |
