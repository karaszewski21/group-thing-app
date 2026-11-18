# Synthesis: semantic „Szukam” matching with a small embedding model and pgvector

## TL;DR
- The design is feasible and cheap at this scale. The weak point is quality. No small model separates hard negatives well: AUC against hard negatives is 0.50–0.73 in the local probe. Embeddings find related things, not only the same thing. They belong in a bell-less, capped third tier and never in MATCH.
- Recommended stack: `sdadas/mmlw-roberta-base` as int8 ONNX (`PKOBP/embed-modernbert-68m` as the challenger, `multilingual-e5-small` as the light fallback). Vectors are stored as `halfvec(n)` in side tables keyed by `products.id` and `wants.id`. There is no vector index; exact scan runs inside the existing SQL filters. The vectors are written by the API process (no worker exists), synchronously and best-effort, with an outbox retry.
- The schema change goes in new revisions (extension, then schema) after 0099, never in a second amendment of 0099. The Postgres image moves to `pgvector/pgvector:0.8.7-pg18-trixie`, not the bookworm `pg18` tag. Rollback cannot be image-only.
- Cost on VPS A, estimated: about +126 MB RSS, 25–50 ms CPU per embedded name, about +1–1.7 s per capped window run (lexical takes about 13 s) and about +60–130 ms per forward match. The labelled sample (≥300 pairs) is the go/no-go instrument.

## Key Decisions
- Six conflicts between gatherers are resolved in §3. They are: worker vs API process, 768-d TOAST, sample size 200 vs 300, the `pg18` tag, amend-0099 vs a new revision, and the SEMANTIC → MATCH upgrade.
- The tier is decided by rules, not by score fusion. The order is MATCH > SUGGESTION > semantic, with one row per (want, item).

## Open Questions / Risks
- VPS A's CPU and RAM are not documented. Every VPS number is a laptop or dev-host measurement multiplied by an assumed factor of 1.5–3×.
- The quality of the semantic tier on real names is unknown until the labelled sample is scored.
- The tier name „Podobne rzeczy” clashes with the existing suggestions subtitle.

---

## 1. Research question
How should the „Szukam” matcher add semantic matching with a small embedding model and pgvector, so that synonyms and close meanings match (for example „Samochód zabawka” ↔ „Zabawka - auto mercedes”), and what does it cost?

## 2. Executive summary
The four gatherer groups (models, pgvector, codebase, evaluation) agree on the architecture. They disagree mainly on details that the synthesis resolves.

The external evidence (PL-MTEB) and the measured local probe disagree on which model is best. mmlw-roberta-base leads on Polish STS (85.20) and pair classification (88.16) (`models-candidates.md` §1.1). PKOBP-68m leads on the short-name probe (AUC-all 0.98, AUC-hard 0.72, P@1 0.80) (`models-local-probe.md` §2). Neither result covers real 2–8-word item names, so only the labelled sample can decide.

The pgvector measurements make the storage and search choice clear. Exact scan is fast enough: 0.45–0.55 s for 300 listings × 10k wants, and 27–44 ms for one forward want against 50k listings (`pgvector-performance-and-options.md` §1, §4). It is also correct under the matcher's filters, whereas HNSW returned 0 of 20 rows under a 0.5% filter (§3). A 768-d `vector` column, however, is TOASTed, and that made the window join 50× slower (22.5 s vs 0.46 s). This decides `halfvec`.

The codebase constrains who writes vectors and when. The window only sees `matchable_listings.changed_at` (`codebase-matcher-contract.md` §2). Forward match runs once per `match_requested_at` flag (§3). There is no separate moderation worker: Bielik-Guard and the outbox poller live in the API process (`codebase-backend-writers.md` TL;DR, §5–6). The vector therefore has to exist before the listing or the flag becomes visible to the matcher, or its arrival has to re-trigger the matcher.

## 3. Cross-source analysis

### 3.1 Validated findings (multiple sources agree)
| Finding | Sources | Confidence |
|---|---|---|
| The matcher stays asyncpg-only and compares vectors in SQL; vectors never reach Python in the matcher | `codebase-integration-map.md` C1; `pgvector-operations.md` §3; `src/matcher/pyproject.toml` | High |
| Exact scan beats HNSW here, both on correctness and at this scale | `pgvector-performance-and-options.md` §3–5; `evaluation-threshold-procedure.md` 2.6; prior research `external-matching-alerts-matching.md:134-142` ("At thousands of rows the exact scan needs no vector index") | High |
| An absolute cut-off is needed, set per model from labelled pairs; defaults do not transfer | `evaluation-threshold-procedure.md` 2.1, 2.3; `models-local-probe.md` Open Questions (mmlw mean positive 0.865 vs hard 0.849); e5 card FAQ | High |
| A semantic tier must be bell-less and capped, like SUGGESTION | probe AUC-hard 0.50–0.73 (`models-local-probe.md` TL;DR); `evaluation-embedding-input-and-hybrid.md` 2.4; `rules.py:7-8` | High |
| The reusable runtime path is ONNX Runtime + `tokenizers` + numpy, with the build-time `optimum-cli` export | `models-candidates.md` §4; `codebase-backend-writers.md` §7; `src/backend/Dockerfile:19-35`; `onnx_models.py:27-69` | High |
| Vectors are keyed by `products.id` (shared, resolved by name), not by items | `codebase-backend-writers.md` §4; `codebase-integration-map.md` Key Decisions; `0099_wants.py:211-249` (view joins `pr.name`) | High |
| A third tier needs both CHECK constraints rewritten and the view recreated | `codebase-matcher-contract.md` §6; `0099_wants.py:375-380`, `:40-41`; `architecture.md:723` | High |
| The threshold is valid only for one (model, revision, quantisation, prefix, template) tuple | `evaluation-threshold-procedure.md` 2.7; `models-local-probe.md` (prefix matters more than int8) | High |
| The whole "Option G" was deferred in 2026-11-14 for lack of measured benefit and an unknown threshold | `evaluation-prior-research.md` Finding 1 | High |

### 3.2 Contradictions and how they are resolved

**C-1. "Outbox worker on VPS A" vs no worker.** The brief and the user memory (`ai-microservice-decision.md:12-14`) place small models "in the moderation outbox worker". The code has no such worker. Bielik runs in the API process (`onnx_models.py:27-33` "Runs inside the API process"), the outbox poller is an `asyncio` task in the API lifespan (`main.py:135`), and "VPS A runs no photo worker" (`architecture.md:101`).
**Resolution:** the code wins. The embedder lives in the API process next to Bielik, loaded in the lifespan behind its own switch, and its calls run through `asyncio.to_thread` with `intra_op_num_threads = 1`. The dispatcher's `event_types` filter (`dispatcher.py:63-66`) would allow a dedicated poller process later, but nothing requires it now. The memory note is outdated and should be corrected. (Confidence: high)

**C-2. Synchronous vs asynchronous vector writer (timing).** The codebase gatherers offer both. With async (outbox, 0–60 s lag plus inference), the listing can leave the window before its vector exists (`codebase-matcher-contract.md` §2). Forward match can also run before the want vector exists, because it runs once per flag (§3).
**Resolution: synchronous best-effort, with an outbox fallback.**
- *Products.* Embed right after `check_text(PRODUCT_NAME)` in `create_product` / `get_or_create_product_by_name` (product/service.py:150, 203), and in `update_product` on a name change (service.py:164-181), inside the same transaction. A new product is created when an item is created; the listing becomes active later, so the vector normally predates `changed_at`.
- *Wants.* Embed after `_check_texts` on create and on a name change (writes.py:159, 223). The texts are checked unlocked, as the classifier is. The vector is written in the same transaction as the `match_requested_at` flag, so the forward run always sees it.
- *On a model error or timeout* (for example 2 s, a proposal), commit without a vector, log once, and stage `embeddings.requested` through `outbox_service.append`. Matching is best-effort, so the write must not fail closed the way moderation does (`text_guard.py:102-105`).
- *The outbox handler* writes the vector. For a want it then re-sets `match_requested_at`, which fires NOTIFY. For a product, the view adds `e.updated_at` to `greatest(…)` in `changed_at`, so the listing re-enters the window (`codebase-integration-map.md` §1, "View" row).

The cost is +25–50 ms (estimated) on product-creating and want-writing requests, on top of Bielik's 20–40 ms. (Confidence: medium. This is design reasoning on high-confidence code facts.)

**C-3. 768-d model vs TOAST.** The primary model is 768-d. A plain `vector(768)` is 3,080 B and is stored out of line, which made the window join 22.5 s instead of 0.46 s (`pgvector-performance-and-options.md` §1, measured).
**Resolution:** store `halfvec(n)` for every candidate. `halfvec(768)` is 1,544 B inline, with a measured window of 454 ms and forward of 28 ms. The challenger's `vector(512)` would be 2,056 B (4·512 + 8), which is above the ~2 KB threshold and therefore also at TOAST risk (inference from the size formula in the same table). `halfvec(512)` is 1,032 B. Precision loss is about 1e-3 or less in cosine (estimate), below the 0.005 threshold step. `SET STORAGE PLAIN` is the alternative for full-precision `vector`. (Confidence: high)

**C-4. Sample size: ≥200 (release gate) vs ≥300 (threshold procedure).** `architecture.md:294` requires ≥200 labelled pairs for the lexical rule. The Wilson intervals show that 200 pairs can reject a threshold but cannot prove precision ≥ 0.80 once it is split into tune and held-out sets (`evaluation-threshold-procedure.md` 2.4: 30 predicted positives at 90% give 0.74–0.97).
**Resolution:** one labelling effort of ≥300 pairs with ≥120 independent positives, stratified (40% positives, 30% hard negatives, 20% random same-category negatives, 10% lexical-only), scored against both the lexical rule and each embedding candidate. The ≥200 gate is satisfied as a subset, and the gate text should be extended to name the semantic threshold. (Confidence: high for the arithmetic, medium for the exact proportions.)

**C-5. Image `pgvector/pgvector:pg18` (brief) vs `pg18-trixie`.** The bare `pg18` tag is bookworm (glibc 2.36), while the project's `postgres:18` is trixie (glibc 2.41) (`pgvector-operations.md` §1, measured).
**Resolution:** pin `pgvector/pgvector:0.8.7-pg18-trixie` in compose and in both testcontainers conftests (`src/matcher/tests/conftest.py:67`, `src/backend/tests/conftest.py:58`). That avoids a collation-version mismatch on the existing data directory. (Confidence: high for the facts, medium that the mismatch warning would fire.)

**C-6. A later lexical MATCH should upgrade a SEMANTIC pair (hybrid finding 2.4) vs `ON CONFLICT DO NOTHING` never re-tiering (`codebase-matcher-contract.md` §1).** In practice both directions run lexical before semantic for the same text, so a stored semantic pair can only become lexical after an in-place product rename on the same item. A want edit deletes all of the want's pairs (writes.py:244-247). SUGGESTION already behaves this way today.
**Resolution:** keep `DO NOTHING` for consistency with SUGGESTION, record the rename edge case, and leave the upgrade as an open decision. (Confidence: medium)

**C-7. Amend 0099 vs a new revision.** `architecture.md:687` says "There is no revision 0100". That describes the current state; it is not a rule (`codebase-matcher-contract.md` §6).
**Resolution:** new revisions. Amending 0099 a second time would create a third DB shape for the old-0099 runbook, and it would tie the lexical release to the image switch. Following the 0086 pattern (`pgvector-operations.md` Key Decisions) and the migrations standard (schema changes kept separate from new objects), use `0100_pgvector` (`CREATE EXTENSION IF NOT EXISTS vector`, with a superuser check in the runbook) and `0101_want_similar` (side tables, CHECKs, view recreate). (Confidence: high for "not 0099", medium for the two-revision split.)

### 3.3 Confidence assessment
- **High:** pgvector types, sizes and timings; the HNSW filtered-search failure; image and glibc facts; the extension not being trusted; the matcher contract, statement template, gate and CHECKs; the writers and outbox behaviour; model card facts and the probe numbers on the probe data.
- **Medium:** the model ranking (the probe is synthetic, with 41 positives and about ±0.03–0.05 AUC SE); the sync-writer design; the input template; the sample proportions; the halfvec precision estimate.
- **Low:** VPS A latency and RAM headroom (VPS A is undocumented); whether the semantic tier reaches precision ≥0.80 on real data at a useful recall.

## 4. Patterns and themes
| Pattern | Description | Evidence | Prevalence / quality |
|---|---|---|---|
| **DB contract instead of shared code** | The matcher reads views, functions and constraints and never imports `app.*` | `architecture.md` wants section; `db.py:20-57` gate; parity test | Established and guarded. The semantic tier must extend the contract (view column, side tables, gate) |
| **Statement template with bound constants** | One `_statement(window, tier)` generator; constants only as `$n` from `rules.py` | `statements.py:141-217`; `rules.py:1-3`; drift test | Mature. A semantic pair extends it with `SEMANTIC_SIMILARITY_MIN` and `SEMANTIC_CAP` |
| **Born-seen bell-less tier** | SUGGESTION inserts `seen_at = $1`, capped at 10 per want counting still-matchable rows | `statements.py:131-145`; `architecture.md:344` | Ready-made shape for „Podobne rzeczy” |
| **Small ONNX model in the API process** | Protocol + fake, lifespan import behind a switch, 1 intra-op thread, `to_thread` with a timeout | `classifiers.py:1-16`; `text_guard.py:164-211`; `onnx_models.py:27-69` | Established for Bielik. Embedding needs new pooling code and must fail open |
| **Build-time model export** | `models` Docker stage with torch + optimum; runtime image without torch | `Dockerfile:19-35`, `:52-63` | Established. Needs an added int8 + parity step |
| **Model-bound derived data** | `model_id.txt` and `moderation_decisions.model_id`; generated columns tied to SQL functions | `onnx_models.py:42-47`; `0099_wants.py:321-337` | Copy as `model_id` on each vector row. A model change means re-embedding and a new threshold |
| **Guarded, runbooked migrations; no image-only rollback** | 0073–0080 and 0099 runbooks | `architecture.md` runbooks; migrations standard | Applies doubly: the extension makes the image switch one-way while vectors exist |
| **Measure before adding** | 2026-11-14 deferred embeddings; moderation shadow mode; "no revision 0100" because an index was measured as not needed | `evaluation-prior-research.md` F1, F4; `architecture.md:687` | The project's dominant decision style. This research's rollout follows it |

## 5. Key insights
1. **Embeddings add "related", not "same".** In the probe every model scores accessories and neighbours close to true matches. For mmlw, „Fotelik samochodowy” scores 0.872 against a true match at 0.922, and „Kloc drewniany” scores 0.862, beating the true „Klocki LEGO Duplo” at 0.849 (`models-local-probe.md` §2). *Implication:* the tier name and copy should promise related things. MATCH stays lexical, and a bell needs a separate ≥0.9 precision proof. (High)
2. **Score bands are narrow, so threshold engineering matters more than model size.** Mean positive minus mean hard negative is about 0.016 for mmlw (asymmetric) and 0.011 for e5. Prefix mode moves AUC more than int8 does. *Implication:* sweep in 0.005 steps on the deployed int8 export with the exact prefix and template, and pin all of them as constants with a drift test. (High)
3. **At this scale the vector search is trivial; the window lexical statements remain the bottleneck.** The semantic window adds about 0.5 s (dev host) to a 13 s capped run (`results.md`; pgvector §4). *Implication:* no index, no HNSW parameters, no `maintenance_work_mem` or `shm_size` tuning. Revisit only at ~500k listings or a forward query above 200 ms. (High)
4. **Timing, not compute, is the integration risk.** With a lagging writer, semantic pairs are missed silently, because the window moves on and forward runs once. *Implication:* write synchronously and make every late write re-trigger the matcher (C-2). (High that the risk exists, medium for the chosen remedy.)
5. **Visibility comes free if the fragment is reused.** The one SQL copy of the PRIVATE rule (`statements.py:161-169`, guarded by `test_wants_visibility_parity.py`) and the read-side `visible_matches` (reads.py:55-73) apply unchanged. *Implication:* factor the visibility `WHERE` into a shared constant used by all six statements and never write a new rule. Vectors never leave the DB or the API. (High)
6. **The mmlw-roberta-base primary is operationally the safest choice.** It is Bielik-Guard's base checkpoint, so the tokenizer family, export command and CPU profile are already proven on VPS A (`models-candidates.md` §1.1). *Implication:* the lowest integration risk, even if PKOBP turns out slightly better on quality. (Medium-high)
7. **Quantisation must be gated.** granite-107m collapsed under naive dynamic int8, with every cosine at 0.999 (`models-candidates.md` §1.10). mmlw keeps min cosine 0.9925 against fp32. *Implication:* the build fails unless min cosine ≥ 0.99 against fp32 on a fixed name list. (High)

## 6. Relationships and dependencies
```
 item create/rename (UI)                      want create / name edit / resume
        │ resolveProduct                                   │
        ▼                                                  ▼
 product/service.py  check_text ─► embed (API process, ONNX int8, to_thread)  ◄─ wants/writes.py _check_texts
        │  same txn                     │ error/timeout → outbox embeddings.requested (retry, re-trigger)
        ▼                               ▼
 product_embeddings(product_id PK, model_id, halfvec(n), updated_at)    want_embeddings(want_id PK, …)
        │                                                                     │ same txn as match_requested_at
        ▼ LEFT JOIN on pr.id, e.updated_at in greatest(changed_at)            ▼ NOTIFY wants_changed
 matchable_listings (view, recreated in 0101) ────────────────► matcher (asyncpg)
                                                                 forward: MATCH → SUGGESTION → SIMILAR
                                                                 window : MATCH → SUGGESTION → SIMILAR
                                                                          (seen_at=$1, cap, no bell)
                                                                        ▼
                                          want_matches(tier ∈ MATCH|SUGGESTION|SIMILAR, score = cosine)
                                                                        ▼
                                     reads.visible_matches → GET /api/wants/{id}/similar → 3rd UI section
```
Integration points: the `embedding_acl.py` in `app/wants/infrastructure` (module boundary C3), the clock passed in as an argument (C4), and constants in `rules.py` (C5). Error policy: matcher loops follow WARNING-and-retry; the backend outbox retries 5 times and then marks the row FAILED (C7).

## 7. Gaps and uncertainties
- **VPS A spec:** not documented, and there are no compose limits. The headroom for +126 MB (int8) or +497 MB (fp32) is unknown.
- **No real-name quality data:** the probe uses 20 wants × 76 names written by the author.
- **CPU on VPS:** laptop 17 ms (int8, mmlw); the VPS factor of 1.5–3× is an estimate. Shared vCPUs may lack VNNI.
- **Semantic SQL not run on the real schema:** the shapes are illustrative, with timings from synthetic tables.
- **Old-image compatibility** after 0101 (an old backend reading SIMILAR rows, an old matcher on the recreated view) is inferred, not tested.
- **Backfill re-entry side effect:** re-embedding moves `changed_at` for every listing of a product. The window then also re-runs the lexical tiers for those listings. That is harmless through `NOT EXISTS`, but it can store lexical MATCH pairs that an earlier per-run `MATCH_TOP_N` cap left out, and those ring bells. This is an inference; measure it in shadow mode.
- **Description in the input:** no ablation source was found, and descriptions change in place without moving `changed_at`.

## 8. Synthesis by framework (mixed)

**Component analysis.** *New:* the embedder (`app/embeddings` or an `app/moderation` sibling, with an `Embedder` protocol and a fake), the `embedding_acl` for wants, the outbox handler `embeddings.requested`, two side tables, the view column, a third tier, two matcher statements, a gate bump, an API endpoint and response, a UI section, and the image switch. *Unchanged:* bells, counts (MATCH-only), lexical tiers, visibility rules.

**Trade-offs.**

| Choice | Picked | Rejected and why |
|---|---|---|
| Search | Exact scan in SQL | HNSW: post-filter loses rows (0/20), top-k not threshold, 56–195 MB per 50k |
| Type | `halfvec(n)` | `vector(768)`: TOAST, 50× slower |
| Writer | Sync best-effort + outbox retry | Pure async: window and forward misses; fail-closed sync: matching is best-effort |
| Key | `product_id` | `item_id`: duplicates the shared product name per item |
| Tier decision | Rules, lexical first | RRF/score fusion: ranks only, uncalibrated scales (Cormack 2009) |
| Revision | New revisions after 0099 | Amending 0099: third shape, ties lexical release to the image |
| Model location | VPS A API process | VPS B: reserved for heavy models (bge-m3, mmlw-large) as the escalation path |

**Applicability.** Everything fits the project's constraints (CPU-only, asyncpg-only matcher, ACL boundaries, clock guards, Polish UI). The only constraint that bends is the release gate's "no feature switch", because shadow mode needs a read-side hold. This goes to the user as an open decision.

## 9. Conclusions
**Primary**
1. Use `mmlw-roberta-base` int8 (asymmetric `zapytanie: ` prefix on the want), with PKOBP-68m scored in parallel and e5-small as the fallback. Final choice by average precision and held-out precision on the labelled sample. (Medium)
2. Use `halfvec(n)` side tables keyed by product and want, exact scan, no index, and the `0.8.7-pg18-trixie` image, in new revisions after 0099. (High)
3. Add a third bell-less tier with an absolute cosine threshold and a cap of 10, run last, reusing the narrowing and visibility fragments. (High)
4. Write vectors synchronously and best-effort in the API process, and make late vectors re-trigger the matcher. (Medium)
5. The cost is small: about +126 MB RAM and about 1 s per capped window. The risk is concentrated in quality and is controlled by the ≥300-pair sample and shadow mode. (Medium; VPS unmeasured)

**Secondary**
- The memory note on the moderation worker is outdated.
- The architecture line "There is no revision 0100" and every `postgres:18` mention (tech-stack.md, the testing standard) need updating when this ships.
- int8-quantising Bielik too would free about 600 MB (prior estimate 0.13 GB vs 0.76 GB measured RSS). This is outside the scope here, but it is the same pipeline.

**Recommendations**: see `outputs/research-report.md` §9.
