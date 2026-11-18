# Research Report: semantic „Szukam” matching with a small embedding model and pgvector

**Research type:** mixed (technical and literature) · **Date:** 2026-11-18 · **Researcher:** maister research workflow (research-synthesizer)

## TL;DR
- **It can be built, and it is cheap; whether it is good enough is not proven yet.** Run `sdadas/mmlw-roberta-base` as int8 ONNX in the API process. Store `halfvec` vectors in side tables keyed by product and want, and search them by exact scan with no vector index. Add a third tier with no bell and a cap of 10, run after MATCH and SUGGESTION.
- **Cost on VPS A (estimated):** about +126 MB RAM, 25–50 ms of CPU per new name, about +1–1.7 s per capped window run (the lexical part takes about 13 s today), about +60–130 ms per forward match, and a backfill of minutes.
- **Main risk:** quality. Every small model rates accessories and related items almost as high as true matches (hard-negative AUC 0.50–0.73). Embeddings therefore show related things and never ring a bell. Ship only after a labelled sample of at least 300 pairs and a shadow-mode period.

## Key Decisions
- **Model:** mmlw-roberta-base, int8. PKOBP/embed-modernbert-68m is the challenger scored on the same sample, and multilingual-e5-small is the lighter fallback. Reason: it has the best Polish STS score among models up to 300M, and it is the same encoder family as Bielik-Guard, which already runs on VPS A.
- **Storage:** `halfvec(n)` with no HNSW index, compared by exact scan inside the existing SQL filters. Reason: 768-d `vector` was 50× slower because of TOAST, and HNSW returned 0 of 20 rows under a selective filter.
- **Writer:** the API process, synchronously and best-effort, with an outbox retry that wakes the matcher again. Reason: there is no separate worker, and a vector that arrives late is missed by the window and by the one-off forward match.
- **Image and migrations:** pin `pgvector/pgvector:0.8.7-pg18-trixie`. Add two new revisions, 0100 for the extension and 0101 for the schema, and do not amend 0099 again. Reason: the bare `pg18` tag is bookworm, so its glibc differs from the existing data directory, and a third amendment would create a third shape of 0099.
- **Release:** extend the release gate to at least 300 labelled pairs, scored for both the lexical rule and the semantic tier. Run 2–4 weeks in shadow mode before showing the tier.

## Open Questions / Risks
- VPS A's CPU and RAM are not documented. Every VPS figure here is a laptop or dev-host measurement scaled by an assumed factor of 1.5–3×. Measure on VPS A first.
- The tier name „Podobne rzeczy” clashes with the existing subtitle of the suggestions section („Podobne rzeczy — brakuje im jednego słowa…”).
- Shadow mode needs a hold on the read side, which bends the release gate's "no feature switch" wording.
- After the rollout, rolling back to the old Postgres image cannot be done by swapping images alone. It needs downgrades and a superuser `DROP EXTENSION`.

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Research Objectives](#2-research-objectives)
3. [Methodology](#3-methodology)
4. [Findings](#4-findings)
5. [Answer 1: Model recommendation](#5-answer-1-model-recommendation)
6. [Answer 2: Threshold procedure and embedding input](#6-answer-2-threshold-procedure-and-embedding-input)
7. [Answer 3: Architecture on the 0099 contract](#7-answer-3-architecture-on-the-0099-contract)
8. [Answer 4: Cost on VPS A and risk register](#8-answer-4-cost-on-vps-a-and-risk-register)
9. [Recommendations and rollout](#9-recommendations-and-rollout)
10. [Analysis and insights](#10-analysis-and-insights)
11. [Conclusions](#11-conclusions)
12. [Open decisions for the user](#12-open-decisions-for-the-user)
13. [Appendices](#13-appendices)

---

## 1. Executive Summary
**What was researched.** How the wants matcher can match synonyms and close meanings with a small embedding model and pgvector. A motivating example is „Samochód zabawka” ↔ „Zabawka - auto mercedes”, where the per-word lexical rule finds nothing. The research also asked what this costs on VPS A. The brief fixed Option A only: embeddings plus pgvector, with no LLM query expansion or per-pair judging (`planning/research-brief.md`).

**How it was researched.** Information was gathered in parallel in four categories. The models gatherer read model cards, the PL-MTEB paper and the HF API, and ran a local ONNX probe of 6 models on 20 wants × 76 names. The pgvector gatherer checked Docker Hub tags, the image Dockerfile and changelog, and measured exact vs HNSW search on PostgreSQL 18.7 with pgvector 0.8.7. The codebase gatherer read the matcher, the 0099 contract, the backend writers, the outbox and the ONNX moderation code. The evaluation gatherer covered threshold method, sample size, embedding input and prior project decisions. The synthesis maps all of this onto the 0099 contract.

**Key findings.**
- No public benchmark scores 2–8-word Polish item names.
- mmlw-roberta-base leads PL-MTEB STS (85.20), while PKOBP-68m wins the local probe (AUC-all 0.98).
- Every model mixes up related items with true matches (AUC-hard 0.50–0.73).
- Exact scan is fast at this scale (0.45–0.55 s for 300 × 10k, 27–44 ms for forward) and correct under filters. HNSW is not.
- A 768-d `vector` column is TOASTed and was 50× slower, which is why `halfvec` is used.
- There is no separate worker: Bielik and the outbox poller run in the API process.
- The window only sees `changed_at`, and forward match runs once per flag. The timing of the vector write therefore decides correctness.

**Main conclusions.** Build a bell-less third tier on the design above. Its value depends on a ≥300-pair labelled sample and shadow mode. Overall confidence: **medium**. Architecture and cost confidence is high to medium. Confidence in quality on real names is low until the sample exists.

## 2. Research Objectives
**Primary question:** how should the „Szukam” matcher add semantic matching with a small embedding model and pgvector, so that synonyms and close meanings match, and what does it cost?

**Sub-questions**
1. Model: which small model best separates short Polish item names? Covers quality vs size vs CPU in ONNX, prefixes, dimensions and licence.
2. Threshold and input: how to set the cut-off from a labelled sample, and what text to embed.
3. Architecture: who writes vectors and when, the pgvector setup, matcher integration as a third tier, migrations and rollback.
4. Cost and risks: RAM and CPU on VPS A, latency, window cost at 10k wants, false positives, PRIVATE visibility, operations.

**Scope.** *Included:* model choice, threshold method, schema and index, compute pipeline, matcher integration, cost, risks, rollout. *Excluded:* LLM expansion or judging, GPU, semantic search on `/api/public/search` (noted only as a follow-up), and frontend design beyond naming the tier.

## 3. Methodology
- **Type:** mixed. Literature: model cards, PL-MTEB, PIRB, the pgvector README and changelog, scikit-learn and sbert docs, IR papers. Technical: code reading with `file:line` citations, plus measured probes.
- **Data sources:** 10 finding files, about 45 external URLs (model cards, HF API, Docker Hub, pgvector GitHub, papers), about 40 project files cited by line, and 3 prior task folders. Measured artefacts are in `analysis/models-probe/` (probe, parity, 6 result JSONs) and in the pgvector probe container numbers in `pgvector-performance-and-options.md`.
- **Frameworks:** a model comparison matrix; a pgvector option table against the expected volumes (≤50k listings, 10k wants, 300-listing window); integration mapping onto the 0099 contract; an evaluation procedure; and a cost table with a risk register.
- **Limits:**
  - Probe data was written by the author (41 positives).
  - Timings were taken on a dev laptop (Ryzen 7 7735HS, AVX2, no VNNI) and on Docker Desktop.
  - The pgvector timings use random vectors. They are valid for timing but not for recall.
  - VPS A was not measured.

## 4. Findings

| # | Finding | Category | Confidence | Sources |
|---|---|---|---|---|
| F1 | No public benchmark covers 2–8-word Polish item names, and card scores differ from paper scores | models | High | `models-candidates.md` Open Questions; PL-MTEB https://arxiv.org/html/2405.10138 |
| F2 | mmlw-roberta-base has the best Polish STS (85.20) and PC (88.16) among models ≤300M. It is Apache-2.0, 768-d, and Bielik's base | models | High | PL-MTEB Table 2; https://huggingface.co/speakleash/Bielik-Guard-0.1B-v1.0 |
| F3 | Probe: PKOBP-68m AUC-all 0.98 / hard 0.72 / P@1 0.80; mmlw 0.94 / 0.64 / 0.55; e5-small 0.89–0.91 / 0.59 / 0.75 | models (measured) | Medium (synthetic data) | `models-local-probe.md` §2; `analysis/models-probe/result-*.json` |
| F4 | Every model's hard-negative AUC is 0.50–0.73. Accessories score close to true matches | models (measured) | High (structural), medium (values) | `models-local-probe.md` TL;DR, §2 |
| F5 | int8 halves latency and roughly quarters RAM. mmlw parity min cosine 0.9925; granite collapsed | models (measured) | High | `models-local-probe.md` §1–2; `models-candidates.md` §1.10 |
| F6 | `pg18` = bookworm (glibc 2.36); `postgres:18` = trixie (2.41); `0.8.7-pg18-trixie` = postgres:18-trixie + the extension | pgvector (measured) | High | `pgvector-operations.md` §1; Docker Hub API; pgvector Dockerfile |
| F7 | `vector` is not a trusted extension, so `CREATE EXTENSION` needs a superuser. Compose role `aj` is one | pgvector | High | `vector.control` in the image; PG18 docs; `docker-compose.yml:5` |
| F8 | Exact scan: window 300 × 10k in 0.45–0.55 s, forward 27–44 ms at 50k (one core, dev host) | pgvector (measured) | High (dev host) | `pgvector-performance-and-options.md` §1, §4 |
| F9 | HNSW with a 0.5% filter returned 0 of 20 rows. The iterative scan fixes it at 240 ms, slower than exact | pgvector (measured) | High | same, §3 |
| F10 | `vector(768)` is TOASTed: the window took 22.5 s vs 0.46 s with `halfvec(768)` or `STORAGE PLAIN` | pgvector (measured) | High | same, §1 |
| F11 | The window reads only `changed_at`; forward runs once per `match_requested_at`; the trigger fires only on that column | codebase | High | `window.py:1-27,139-177`; `requests.py:66-94`; `0099_wants.py:154-170` |
| F12 | There is no separate worker. Bielik and the outbox poller run in the API process (60 s poll, handlers inline) | codebase | High | `onnx_models.py:27-33`; `main.py:132-141`; `dispatcher.py:44-88`; `architecture.md:101` |
| F13 | Products are shared and resolved by name. A name is created only in `create_product` / `get_or_create_product_by_name`; a rename re-points the item | codebase | High | `product/service.py:147-213`; `inventory_items.py:273-275` |
| F14 | 0099 hard-codes `tier IN ('MATCH','SUGGESTION')` and `missing_words`. The view must be recreated for new columns. The gate checks `>= 99` + view | codebase | High | `0099_wants.py:359-383,205-249,40-41`; `db.py:20-57` |
| F15 | One SQL copy of the visibility rule (parity test) plus the read-side `visible_matches` | codebase | High | `statements.py:161-169`; `test_wants_visibility_parity.py:1-7`; `reads.py:55-73` |
| F16 | The UI subtitle „Podobne rzeczy — brakuje im jednego słowa…” already exists | codebase | High | `WantMatchesView.tsx:327-350` |
| F17 | The threshold must be absolute, set precision-first on a tune split and confirmed on held-out data. e5 scores sit in 0.7–1.0 | evaluation | High | scikit-learn thresholds doc; e5 card FAQ; `evaluation-threshold-procedure.md` §2 |
| F18 | 200 pairs is too thin to prove precision ≥ 0.80. Plan ≥300 pairs with ≥120 positives | evaluation (computed) | High (arithmetic) | Wilson table, `evaluation-threshold-procedure.md` 2.4 |
| F19 | Name-only input by default. Prefixes are part of the model contract. RRF ranks but cannot decide tiers | evaluation | Medium (input), High (prefix, RRF) | `evaluation-embedding-input-and-hybrid.md` 1.1–1.4, 2.1 |
| F20 | 2026-11-14 deferred embeddings for lack of measured benefit. 2026-10-01 set the ONNX/int8/shadow-mode discipline | prior research | High | `evaluation-prior-research.md` F1, F4 |

## 5. Answer 1: Model recommendation
**Confidence: medium.** The ranking is evidence-based, but it rests on sentence benchmarks and a synthetic probe.

### 5.1 Comparison matrix (condensed)
Latency and RAM were measured on a laptop with 1 thread, int8, one text per call. "est." marks an estimate (`models-candidates.md` §2).

| Model | Params | Dim | Licence | Prefix (want / listing) | ONNX | int8 MB | RSS int8 | ms/text | PL-MTEB STS / PC | Probe AUC-all / hard / P@1 | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **sdadas/mmlw-roberta-base** | 124M | 768 | Apache-2.0 | `zapytanie: ` / none | optimum export (same as Bielik) | 125 | 126 | 17 (10.5 batched) | **85.20 / 88.16** | 0.936 / 0.64 / 0.55 | **Primary** |
| **PKOBP/embed-modernbert-68m** | 68M | 512 | Apache-2.0 (gate-form metadata) | `[query]: ` / none | torch.onnx export works | **69** | **75** | 15 | n/a (vendor clustering only) | **0.978 / 0.72 / 0.80** | **Challenger** |
| **intfloat/multilingual-e5-small** | 118M | 384 | MIT | `query: ` / `query: ` | official + int8 | 118 | 128 | 6–7 | 78.41 / 81.70 | 0.886 / 0.59 / 0.75 | **Light fallback** |
| sdadas/mmlw-e5-small | 118M | 384 | Apache-2.0 | `query: ` / `passage: ` | export | 118 | 127 | 6 | 82.05 / 86.67 | 0.896 / 0.59 / 0.35 | No (weak probe) |
| paraphrase-ml-MiniLM-L12-v2 | 118M | 384 | Apache-2.0 | none | official | 118 | 130 | 4–5 | 78.68 / 83.40 | 0.824 / 0.50 / 0.10 | No |
| granite-107m-multilingual | 107M | 384 | Apache-2.0 | none | official fp32 | broken | 97 | 3 (fp32 4.4) | n/a | 0.838 / 0.50 / 0.45 | No (int8 collapse) |
| mmlw-roberta-large | 435M | 1024 | Apache-2.0 | `zapytanie: ` | export | ~440 est. | ~450 est. | ~60 est. | 85.23 / 89.15 | n/a | VPS B escalation |
| bge-m3 | 568M | 1024 | MIT | none | fp32 2.27 GB | ~570 est. | ~600 est. | ~60+ est. | n/a | n/a | VPS B escalation |
| arctic-embed-m-v2.0, Qwen3-0.6B | 305M / 596M | 768 / ≤1024 | Apache-2.0 | various | official / community | 311 / 613 | est. | est. | n/a / 78.45 | n/a | No (size, no PL STS edge) |
| jina-v3, silver-retriever, embeddinggemma | — | — | CC-BY-NC / CC-BY-SA / Gemma gated | — | — | — | — | — | — | — | Excluded (licence) |

### 5.2 Ranked choice
1. **`sdadas/mmlw-roberta-base` (int8, 768-d → `halfvec(768)`), primary.**
   - It has the best Polish STS and pair classification (PL-MTEB paper, Table 2).
   - It is Bielik-Guard 0.1B's base checkpoint (https://huggingface.co/speakleash/Bielik-Guard-0.1B-v1.0), so the export command, tokenizer family and CPU profile are already proven (`src/backend/Dockerfile:30-31`, `onnx_models.py:27-69`).
   - Use the asymmetric prefix `zapytanie: ` on the want and nothing on the listing. In the probe this beat the symmetric form (AUC-all 0.939 vs 0.914).
   - Known weakness: it falls for the „Klocki” ↔ „Kloc drewniany do rąbania” trap (0.862 vs 0.849 for the true match).
2. **`PKOBP/embed-modernbert-68m` (int8, 512-d → `halfvec(512)`), challenger.**
   - It won the probe on every metric and is the cheapest model (69 MB, 75 MB RSS).
   - It is young (created 2026-08-03, about 50 downloads), has vendor-only benchmarks, and carries gate-form metadata. Pin the revision and bake it into the image.
   - **Decision rule:** if it beats mmlw on held-out average precision and precision at the chosen threshold on the labelled sample, switch to it.
3. **`intfloat/multilingual-e5-small` (int8 official, 384-d), light fallback.**
   - Use it under RAM or CPU pressure: official ONNX files and 6–7 ms per text.
   - Its 0.7–1.0 score compression (card FAQ) makes thresholds fragile.

**Escalation (not VPS A):** bge-m3 or mmlw-roberta-large on VPS B in `group-thing-ai`, if no small model reaches the precision target. This follows memory `ai-microservice-decision`.

**Implementation notes.**
- The runtime already has `onnxruntime` 1.30.0, `tokenizers` 0.23.2 and numpy (`pyproject.toml:34-38`).
- Pooling is CLS for mmlw and PKOBP and mean for e5, followed by L2 normalisation.
- The int8 step is `quantize_dynamic`. Add a **parity gate**: min cosine ≥ 0.99 against fp32 on a fixed name list.
- Store `model_id` (with revision) on every vector row (`onnx_models.py:42-47` pattern).
- None of the top three are Matryoshka-trained, so never truncate their vectors.

## 6. Answer 2: Threshold procedure and embedding input
**Confidence: high for the method, medium for the proportions and targets.**

### 6.1 Rule
Store a pair as the third tier only when all of the following hold:
- `cosine ≥ T_sem`, where `T_sem` is model-bound;
- the pair is not already MATCH or SUGGESTION;
- the narrowing (offer mode, category subtree, locality and radius) and visibility pass;
- the want's still-matchable count for this tier is under `SEMANTIC_CAP = 10`.

Use an absolute threshold together with a cap. Pure top-k always fills the list, even with junk, and a threshold alone floods generic wants (`evaluation-threshold-procedure.md` 2.6).

### 6.2 Procedure (one labelling effort for both the lexical and the semantic gate)
1. **Corpus.**
   - `polish_names.py` (52 "things" with listed and wanted forms; `codebase-integration-map.md` §3).
   - Real `products.name` values from dev or staging: names only, never descriptions.
   - 30–50 hand-written synonym pairs, such as „wózek głęboki” ↔ „gondola” and „body niemowlęce” ↔ „bodziak”.
2. **Pairs: ≥300, with ≥120 independent positives.**
   - Stratify them: about 40% positives built by a person, not by the matcher; about 30% hard negatives; about 20% random same-category negatives; about 10% lexical-only pairs.
   - The hard-negative stratum must include the following traps: „Klocki”/„Kloc drewniany”, „Lego”/„Legowisko”, „Zamek”, „Mysz”, „Kurtka 110”/„Kurtka XL”, „Wózek”, „Fotelik samochodowy”/„Samochodzik”, and accessory pairs („Laptop”/„Torba na laptopa”, „Narty”/„Buty narciarskie”).
3. **Labels.**
   - Use three values: `match`, `related` and `no`. `match ∪ related` is the positive class for the bell-less tier, and `match` is the positive class for any future bell.
   - Two people label independently, one of them the product owner. Report Cohen's kappa on an overlap of ≥50 pairs.
4. **Scoring.**
   - Work offline on a dev machine. Use the **deployed int8 ONNX export** with the exact prefix and input template.
   - Score each pair with every candidate model × template × prefix mode, and run the lexical rule on a test DB.
   - Split tune/held-out 2:1, stratified.
   - Compare models first by threshold-free average precision (sbert `BinaryClassificationEvaluator` or `sklearn.metrics.precision_recall_curve`).
5. **Threshold.**
   - On the tune split, sweep in **0.005 steps**, because the score bands are narrow: mmlw has a mean positive of 0.865 against a mean hard negative of 0.849.
   - Pick the **lowest** `T_sem` whose precision on `match ∪ related` is ≥ 0.85.
   - Never use the "best-F1" threshold for this.
6. **Go/no-go on held-out.** All of the following must hold:
   - The Wilson 95% lower bound of precision is ≥ 0.80.
   - The false-positive rate on hard negatives is ≤ 10%.
   - Semantic adds ≥ X points of recall over the lexical tiers on independent positives. X is to be agreed; 15 is a proposal.
   - If any fails, try the next model or template, or drop the tier.
7. **Pin the result.** `SEMANTIC_SIMILARITY_MIN`, `SEMANTIC_CAP`, the model id and revision, the prefix and the template go in `rules.py` (matcher) and in the embedder config (backend). Add a drift test like `test_constants_drift.py`.
8. **Shadow mode, then launch.** Spot-check 100 stored pairs. After launch, review the open and take rates per score band from `want_matches.score` and `opened_at` (`0099_wants.py:365-367`).
9. **Re-run the whole procedure** after any change to the model, revision, quantisation, prefix or template.

Halfvec rounding moves the cosine by about 1e-3 or less (estimate), which is below the 0.005 sweep step. Either accept that or compute the curve in SQL on the stored halfvec (`pgvector-performance-and-options.md` §1).

**Sample-size conflict resolved.** The architecture gate's ≥200 pairs (`architecture.md:294`) is not enough on its own. In the Wilson table, 30 predicted positives at 90% give a 95% interval of 0.74–0.97. At ≥300 pairs the lexical gate is satisfied as a subset. The gate text should be extended to name the semantic threshold.

### 6.3 Embedding input
- **Default (template A): the product name only.**
  - Industry query → product work centres on titles (Walmart, Amazon and Allegro evidence, `evaluation-embedding-input-and-hybrid.md` 1.1–1.2).
  - The project's own first precision lever is name-only (`high-level-design.md:586`).
  - The lexical tiers are name-based too.
  - The vector changes only on a rename.
- **Measured alternatives:**
  - Template B = name + „ — ” + leaf category name. Risk: sibling-category false positives.
  - Template C = B + the first 200 characters of the description. Descriptions are edited in place (`PATCH …/description`) without moving `changed_at`, so they would need an extra re-embed path.
  - Adopt B or C only if they win on held-out precision.
- **Do not** apply `fold_pl()` before embedding: the subword models were trained with diacritics. Keep sizes and numbers in the text. Size mismatches go to the hard-negative stratum.
- **Prefixes** are part of the threshold tuple: `zapytanie: ` / none for mmlw, `[query]: ` / none for PKOBP, `query: ` / `query: ` for e5. Pin them with a test shared by the writer and the scoring script.
- **No score fusion.** RRF (Cormack et al. 2009, k = 60) is rank-based and has no absolute meaning. Use it only if the three tiers are ever shown as one mixed list.

## 7. Answer 3: Architecture on the 0099 contract
**Confidence: high for the contract facts and the storage choice, medium for the writer design.**

### 7.1 Who writes vectors, and when (the timing risk)
**Fact.** There is no moderation worker. Bielik-Guard runs inside the API process (`OnnxTextClassifier`, `intra_op_num_threads = 1`, `asyncio.to_thread`, `onnx_models.py:27-33`), and the only outbox poller is an `asyncio` task in the API lifespan, polling every 60 s (`main.py:135`, `scheduler.py:16`). The brief's "outbox worker on VPS A" therefore means the API process. The memory note that says otherwise is outdated (`codebase-backend-writers.md` §6).

**Timing risk.**
- The window compares a listing only while its `changed_at` lies within `(start, end]` (`window.py:1-27`). The window runs every 60 s with a 2-minute overlap.
- Forward match runs once per `match_requested_at` flag (`requests.py:66-94`).
- An asynchronous vector (outbox lag of 0–60 s plus inference) can arrive after both have passed, and the semantic pair is then missed silently.

**Recommended writer: synchronous, best-effort, with an outbox fallback.**

| Path | Hook | Action |
|---|---|---|
| New product | after `check_text(PRODUCT_NAME)` in `create_product` (service.py:150) and `get_or_create_product_by_name` (service.py:203) | embed the name and insert into `product_embeddings` in the same transaction |
| In-place rename | `update_product` (service.py:164-181), only when `name` changes | re-embed and upsert |
| Want create / name edit | after `_check_texts` (writes.py:159, 223), unlocked like the classifier | upsert `want_embeddings` in the same transaction as `match_requested_at` (writes.py:177, 247). On resume (writes.py:311), reuse the stored vector |
| Model error or timeout (for example 2 s) | the same hooks | commit without a vector (do **not** fail closed like `text_guard.py:102-105`), log once, and stage `embeddings.requested` via `outbox_service.append` |
| Outbox handler `embeddings.requested` | registered in the lifespan, ONNX via `to_thread` | write the vector. For a want, re-set `match_requested_at`, which fires NOTIFY. For a product, the view's `changed_at` includes `e.updated_at`, so the listing re-enters the window |

- **Keyed by `products.id`**, not by items. Products are shared and resolved by a case-insensitive name within a category (`service.py:184-213`), so each distinct product is embedded once. Renaming an item in the UI resolves a new product and re-points `item.product_id` (`inventory_items.py:273-275`), which moves `changed_at`.
- **Side tables, not ORM columns.** Writing a vector onto `wants` through the ORM would bump `updated_at`, the version column (`base_model.py:61-66`), and cause 409s. The backend also has no `pgvector` package, so writes use Core or `sa.text` with `CAST(:v AS halfvec)` or a `real[]` cast (`pgvector-operations.md` §3). Never write `::` inside `sa.text`.
- **Module boundaries.** `app/wants` reaches the embedder only through a new `app/wants/infrastructure/embedding_acl.py` (`test_module_boundaries.py:1-17`). The clock is passed in as an argument (`test_domain_clock_guard.py:28-34`).

### 7.2 pgvector: image, type, index
- **Image:** `pgvector/pgvector:0.8.7-pg18-trixie`, not `pg18`.
  - `pg18` is bookworm with glibc 2.36, while the data directory was created under trixie with glibc 2.41. That risks a collation-version mismatch and a REINDEX of the text and trigram indexes (`pgvector-operations.md` §1, measured).
  - The trixie image is `FROM postgres:18-trixie` with the same `PGDATA` and volume layout, and 18.4 → 18.7 is a minor upgrade.
  - Update `docker-compose.yml:3` and both testcontainers conftests (`src/matcher/tests/conftest.py:67`, `src/backend/tests/conftest.py:58`). Also update the docs that name `postgres:18` (tech-stack.md:53,114; architecture.md:383; testing standard).
- **Extension:**
  - `CREATE EXTENSION IF NOT EXISTS vector` needs a superuser, because `vector.control` has no `trusted = true`.
  - The runbook check is `SELECT rolsuper FROM pg_roles WHERE rolname = current_user;`. The compose role `aj` is the image's `POSTGRES_USER` and therefore a superuser.
  - pgvector 0.8.7 includes the 0.8.3/0.8.4 HNSW vacuum fixes and 0.8.0's iterative scans, in case an index is ever added.
- **Type:** `halfvec(n)` (768 for mmlw, 512 for PKOBP, 384 for e5).
  - `vector(768)` is 3,080 B, is TOASTed, and made the window take 22.5 s against 0.46 s.
  - `vector(512)` would be 2,056 B, also above the ~2 KB TOAST threshold (inference from 4·d + 8).
  - `halfvec(768)` is 1,544 B inline: window 454 ms, forward 28 ms. Published recall with halfvec is essentially identical (Katz 2024; Neon).
- **No vector index at launch: exact scan.**
  - Both matcher paths need every pair above a threshold inside the SQL filters. HNSW gives approximate top-k and post-filters, and it returned **0 of 20 rows** under a 0.5% filter.
  - `iterative_scan = relaxed_order` fixed that, but at 240 ms, slower than exact (7–44 ms).
  - A `WHERE distance < t` condition never uses an ANN index anyway (README).
  - Revisit at about 500k listings or when forward exceeds about 200 ms. If an index is added then, use a halfvec HNSW with iterative scan and a materialized CTE, built with `CREATE INDEX CONCURRENTLY` in `autocommit_block()`.
- **Normalised vectors.** The writer L2-normalises, so cosine and inner product agree.

### 7.3 Schema (proposal for 0100/0101)
```text
0100_pgvector:      CREATE EXTENSION IF NOT EXISTS vector
0101_want_similar:  SET LOCAL lock_timeout = '5s'
  product_embeddings(product_id uuid PK FK→products ON DELETE CASCADE, model_id text NOT NULL,
                     embedding halfvec(n) NOT NULL, updated_at timestamp NOT NULL)
  want_embeddings(want_id uuid PK FK→wants ON DELETE CASCADE, model_id, embedding halfvec(n), updated_at)
  DROP/CREATE VIEW matchable_listings (+ LEFT JOIN product_embeddings e ON e.product_id = pr.id,
       expose e.embedding, e.model_id; add e.updated_at to greatest(...) AS changed_at)
       -- also recreate dependent views per 0099_wants.py:40-41 / architecture.md:723
  want_matches: drop/re-add ck_want_matches_tier  → tier IN ('MATCH','SUGGESTION','SIMILAR')
                drop/re-add ck_want_matches_missing_words → … OR (tier = 'SIMILAR' AND missing_words IS NULL)
  ORM mirrors: WantMatchTier (models.py:163-168), __table_args__ (models.py:176-186)
```
- The tier code fits `String(10)`. `SIMILAR` or `SEMANTIC` both fit, and the choice is open.
- `ix_want_matches_want_id_tier` already serves per-tier reads (`0099_wants.py:383`).
- Add `product_embeddings` and `want_embeddings` to the matcher test `_TRUNCATED` list (`conftest.py:38-59`).
- Add a downgrade-then-upgrade test for each revision (migrations standard).

**Why new revisions and not a second amendment of 0099.**
- 0099 was already amended once, and the runbook has an old-0099 detection and downgrade path (`architecture.md:687,695-704`). A second amendment would create a third shape.
- It would also tie the whole lexical wants release to the image switch, because `CREATE EXTENSION vector` fails on `postgres:18`.
- The extension goes in its own revision, following the 0086 pg_trgm pattern.
- "There is no revision 0100" (`architecture.md:687`) describes the current state and must be edited.

### 7.4 Matcher statements for the third tier
- Add `FORWARD_SIMILAR` and `WINDOW_SIMILAR`, built from the same fragments: `matchable_wants` joined to `want_embeddings` (an inner join for this statement only), `window_listings`, `_NARROWING`, the visibility `WHERE`, `l.owner_party_id <> w.seeker_party_id` and `NOT EXISTS want_matches` (`statements.py:45-76,161-173`).
- Replace the text candidate and `_WORD_CHECK` with `(l.embedding <=> we.embedding) <= $dist`, where `$dist = 1 - SEMANTIC_SIMILARITY_MIN`, and require `l.model_id = we.model_id`. Use `score = 1 - distance`.
- Order with `row_number() OVER (PARTITION BY want_id ORDER BY score DESC, created_at DESC, item_id)`.
- Cap with `position <= SEMANTIC_CAP - (stored SIMILAR whose item is still in matchable_listings)`, the same rule as SUGGESTION (`statements.py:131-138`).
- Insert with `seen_at = $1::timestamp` (born seen, never a bell) and `ON CONFLICT (want_id, item_id) DO NOTHING`.
- **Run last** in `match_forward` and in `match_window` (`statements.py:220-247`). Lexical tiers take precedence, and the unique key keeps one row per pair.
- **Visibility:** factor the PRIVATE `WHERE` into one shared constant used by all six statements, and never add a new rule. The parity test (`test_wants_visibility_parity.py`) still guards it, and the read side filters again via `visible_matches` (`reads.py:55-73`). PRIVATE items get vectors like any item. Vectors never leave the database: the API returns no vectors, and the matcher reads only ids and scores.
- **Window logging:** count SIMILAR separately from suggestions (`window.py:177`). Bells stay MATCH-only (`window.py:174-175`), so `bells_due` is unchanged.
- **Constants:** add `SEMANTIC_SIMILARITY_MIN` and `SEMANTIC_CAP` to `rules.py` only, as bound parameters.
- **A want with no vector** gets no semantic tier. Log it; do not treat it as an error.
- **Upgrade edge case:** a stored SIMILAR pair is never re-tiered to MATCH. The only way this arises is an in-place rename of the same item's product, and SUGGESTION behaves the same way today. Whether to upgrade is open decision D10.

### 7.5 Startup gate
- `CONTRACT_REVISION = 99` plus `to_regclass('public.matchable_listings')` (`db.py:20-57`) would let a semantic matcher start on a DB without the vector objects.
- Bump the gate to 101 **and** add `to_regclass('public.product_embeddings')` and `to_regclass('public.want_embeddings')`.
- The backend lifespan can mirror this with its existing `to_regclass` style refusal.

### 7.6 API and UI
- **API:** add `GET /api/wants/{id}/similar`, built from `_similar_select` via `_cards_select(..., tier=SIMILAR)` (`reads.py:210-250`), with `LIMIT 10`, ordered by score descending and then item id. Its response model has no `missing_words`, because `WantSuggestionResponse` requires it (`schemas.py:105-115`). Counts stay MATCH-only (`reads.py:76-89`). Authorization uses matrix rows 66–67.
- **UI:** add a third fetch in `useWantMatches` (`useWantMatches.ts:41-57`), a third array in `WantMatchesData`, rows for the view state in `resolveWantMatchesView`, a section below suggestions, and a card without the „brakuje:” footnote. Use typed fixtures.
- **Naming clash.** The suggestions section already uses the subtitle „Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.” (`WantMatchesView.tsx:327-350`). Either rename that subtitle (for example „Prawie pasują — brakuje im jednego słowa…”) or give the new tier another name. The probe shows the tier surfaces *related* things and accessories, so a name such as „Powiązane rzeczy” or „Coś w tym stylu” promises less than „Podobne”. This is a proposal: open decision D2.

### 7.7 Rollback
- **No image-only rollback.** `postgres:18` cannot load `$libdir/vector` while the extension or any `halfvec` column exists (`pgvector-operations.md` §4).
- To go back, take these steps in order:
  1. Downgrade 0101: delete or re-tier SIMILAR rows, restore both CHECKs, recreate the view without the vector columns, and drop the side tables.
  2. Downgrade 0100: `DROP EXTENSION vector`. This needs a superuser or ownership check, the same caveat as 0086.
  3. Only then switch the image back.
- 0101's downgrade loses all vectors and SIMILAR pairs. That is acceptable because they can be recomputed and carry no bells.
- **`pg_dump`** emits `CREATE EXTENSION vector`, so a restore target must be a pgvector image.
- **Image rollback for backend or matcher alone**, keeping the DB at 0101:
  - An old matcher has no semantic statements and its gate (≥99) passes.
  - An old backend reads tiers by filter and would ignore SIMILAR rows.
  - Both are **inferred, not tested**. The runbook must test them before relying on them.
- **Kill switch:** turn the backend's `EMBEDDINGS_ENABLED` off, so no new vectors are written and the tier stays static. Turn the read-side hold on to hide the section.

## 8. Answer 4: Cost on VPS A and risk register
**Confidence: medium.** The numbers are measured on dev hardware, and the VPS factor of 1.5–3× is an estimate.

### 8.1 Cost table
| Item | Measured (dev) | VPS A estimate | Source |
|---|---|---|---|
| RAM, mmlw int8 in the API process | +126 MB RSS (fp32 +497 MB) | +~130 MB on top of ~756 MB today (Bielik fp32) | `models-local-probe.md`; `reality-check.md:34` |
| RAM, PKOBP int8 / e5-small int8 | +75 / +128 MB | same | probe |
| CPU per embedded name (mmlw int8, 1 thread) | 17 ms median, p95 23 ms; batched 10.5 ms | 25–50 ms | probe; `models-candidates.md` §3 |
| Added latency on product-creating / want-writing requests | — | +25–50 ms (Bielik already 20–40 ms) | inference |
| Model load at startup | Bielik 2.5 s | +~1–3 s (estimate) | `reality-check.md:34` |
| Image size | +125 MB int8 model dir | — | probe |
| Storage, `halfvec(768)` | 1,544 B/row | 50k products ≈ 77 MB, 10k wants ≈ 15 MB (before TOAST and row overhead) | `pgvector-performance-and-options.md` §1 |
| Window semantic statement, 300 × 10k | 0.45–0.55 s (1 core) | ~1–1.7 s; lexical takes ~13 s per capped run | pgvector §4; `results.md` |
| Window, 300 × 30k wants | ~1.7 s (extrapolated) | ~3–5 s; still under the 30 s per-statement timeout | pgvector §4 |
| Forward semantic, 1 want × 50k listings | 27–44 ms | ~60–130 ms (lexical median 9–31 ms) | pgvector §1 |
| Backfill, embedding 10k listings or products | 2–8 min CPU (1 thread) | ~4–15 min; 50k products ≈ 15–40 min | `models-local-probe.md` §2 |
| Backfill, matching | 10k wants × 50k = 500M distances ≈ 90 s/core | run as batched forward requests and window re-entry, never as one statement | pgvector §4 |
| HNSW (avoided) | 56–195 MB per 50k, 39–297 s build | 0 | pgvector §2 |

**Reading.** The model fits comfortably if VPS A has at least 2 GB free for the API, but VPS A's size is undocumented. CPU is spent per write, not per match. The semantic window adds about 4% to a capped run on the same hardware (0.5 s against about 13 s on the dev machine). The lexical part slows down on VPS A by the same factor. Window cost grows linearly with active wants × window listings. The 30-want cap per user bounds growth per user, not the total.

**Backfill plan.**
- Embed products in batches, for example 300 per minute in a one-off script or an outbox batch. The `e.updated_at` re-entry then feeds each listing through the window at the existing cap.
- For wants, write vectors and set `match_requested_at` in batches. Forward pairs are born seen, so this rings no bells.
- Run it off-peak.
- Watch `capped=` in the window log line.

### 8.2 Risk register
| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **Hard negatives / related items shown as matches** (AUC-hard 0.50–0.73; „Kloc drewniany” beats „Klocki LEGO” for mmlw) | critical | high | Bell-less tier, cap 10, copy that promises "related"; hard-negative stratum in the sample with FP ≤ 10%; optional same-top-level-category guard, measured first; PKOBP challenger |
| R2 | **Narrow score bands** (0.011–0.016 gap between mean positive and mean hard negative) make the threshold fragile | warning | high | 0.005 sweep; threshold tuple pinned (model, revision, int8, prefix, template); drift test; re-score on any change |
| R3 | **Quantisation shift or collapse** (granite: every cosine 0.999) | warning | medium | Build-time parity gate, min cosine ≥ 0.99 against fp32; threshold from the deployed int8 export |
| R4 | **Timing misses** (vector after `changed_at` leaves the window, or after the forward run) | critical | medium (async) / low (sync) | Synchronous write in the same transaction; outbox retry re-sets `match_requested_at`; `e.updated_at` in `changed_at`; shadow metric "listings without a vector" |
| R5 | **PRIVATE visibility leak** through a new code path | critical | low | Reuse the one SQL visibility fragment as a shared constant; parity test; read-side `visible_matches`; no vectors in any API response |
| R6 | **Collation mismatch** from a wrong image tag (bookworm) | warning | low (if pinned) | Pin `0.8.7-pg18-trixie`; verify `debian_version` and glibc; check `pg_collation` version warnings after the swap |
| R7 | **Superuser needed** for `CREATE EXTENSION` | info | low | Runbook `rolsuper` check, or a DBA pre-creates the extension (`IF NOT EXISTS`) |
| R8 | **No image-only rollback** | warning | medium | Runbook downgrade order 0101 → 0100 → image; `pg_dump` before; restore only into a pgvector image |
| R9 | **RAM on VPS A unknown** (API already ~756 MB) | warning | medium | Measure first; int8 only; e5-small fallback; optionally int8-quantise Bielik too (prior estimate 0.13 GB) |
| R10 | **Embedder outage blocks writes** | warning | low | Fail open: commit without a vector, use the outbox retry, log once; no 503 |
| R11 | **API event loop blocked** by inline ONNX in outbox handlers | warning | medium | `asyncio.to_thread` plus a timeout, as `text_guard`; `intra_op_num_threads = 1` |
| R12 | **Backfill re-entry** stores lexical MATCH pairs that an earlier per-run cap left out, and rings bells | info | low | Throttled backfill; measure in shadow mode; optionally backfill before deploying the semantic statements |
| R13 | **HNSW added later "for speed"** silently drops filtered rows (0 of 20) | warning | low | Documented decision: no index; if ever added, iterative scan plus tests for short results |
| R14 | **Model maturity / access** (PKOBP young, gate-form metadata) | info | medium | Pin the revision, bake it into the image, keep mmlw as primary |
| R15 | **Stale vector after an in-place rename or description edit** | info | medium | Re-embed in `update_product` on a name change; name-only input avoids the description path |
| R16 | **Sample quality** (one labeller, positives built from matcher output) | warning | medium | Two labellers with kappa ≥ 50 overlap; positives built independently; held-out split |

## 9. Recommendations and rollout

### 9.1 Recommendations
| # | Recommendation | Priority | Effort | Rationale | Risk if skipped |
|---|---|---|---|---|---|
| 1 | Build the ≥300-pair, 3-label sample, and score lexical plus 3 models × 2 templates offline | Critical (gate) | M (labelling) | It is the only real evidence of quality (F1, F18) | Shipping an unknown-precision tier |
| 2 | Measure on VPS A: `probe.py` int8 latency and RSS, plus free RAM | Critical | S | All VPS figures are estimates | OOM or slow writes |
| 3 | Switch the image to `pgvector/pgvector:0.8.7-pg18-trixie` as its own deploy, with 0100 | High | S | Isolates the infrastructure change; keeps lexical wants on stock behaviour | Collation and REINDEX, tangled rollback |
| 4 | Add the embedder (protocol + fake, int8 + parity gate, `EMBEDDINGS_ENABLED`), sync best-effort writers, and the outbox fallback | High | M | Fits the existing ONNX pattern; avoids timing misses | Silent misses |
| 5 | Add 0101 (side tables, view, CHECKs), matcher statements run last, and the gate bump | High | M | Fits the 0099 contract | — |
| 6 | Run shadow mode: store SIMILAR pairs, hide them, review | High | S | Moderation precedent (`2026-10-01 … research-report.md:465`) | Embarrassing cards in production |
| 7 | Add the API endpoint and UI section with a non-clashing name | Medium | M | User-visible value | Naming confusion |
| 8 | Update the docs: architecture "no revision 0100", `postgres:18` mentions, the testing standard, the memory note | Medium | S | Keeps the documentation accurate | Wrong future decisions |

### 9.2 Rollout
0. **Offline gate:** labelled sample, model and template choice, `T_sem`, go/no-go.
1. **Infrastructure deploy:** `pg_dump`, image swap to `0.8.7-pg18-trixie`, verify glibc and collations, `alembic upgrade` to 0100, check `\dx vector` = 0.8.7.
2. **Writer deploy, embeddings off then on:** 0101, backend with the embedder; turn on `EMBEDDINGS_ENABLED`; throttled backfill of products and wants.
3. **Matcher deploy, shadow:** semantic statements active, pairs stored born seen, API and UI section held back. Run 2–4 weeks.
4. **Shadow metrics:**
   - SIMILAR pairs per want (distribution, share of wants with at least one);
   - score histogram against `T_sem`;
   - overlap with lexical pairs (should be 0);
   - human spot check of 100 random pairs (precision ≥ 0.80);
   - window run time and the `capped=` share;
   - forward p95;
   - embed latency p95 and timeouts;
   - API RSS;
   - FAILED `embeddings.requested` rows (`grep "FAILED after"`);
   - share of matchable listings and active wants without a vector, or with a stale `model_id`.
5. **Show the tier.** Then track open and take rates per score band (`want_matches.score`, `opened_at`) and adjust `T_sem` only by re-scoring the sample.
6. **Later, optional:** promote to a bell only if precision on `match` alone has a Wilson lower bound of at least 0.90. Use semantic search on `/api/public/search` as a separate follow-up.

## 10. Analysis and insights

### 10.1 Patterns identified
| Pattern | Type | Prevalence | Assessment | Example |
|---|---|---|---|---|
| DB contract instead of shared code | architectural | everywhere in the wants stack | mature, guarded | `db.py:20-57`, parity test |
| One statement template with bound constants | design | all four lexical statements | mature | `statements.py:141-217` |
| Born-seen, capped bell-less tier | implementation | SUGGESTION | reusable as-is | `statements.py:131-145` |
| Small ONNX model in the API process behind a switch | integration | Bielik | established; embedder must fail open | `text_guard.py:164-211` |
| Model-bound derived data with `model_id` | implementation | moderation | copy for vectors | `onnx_models.py:42-47` |
| Runbooked, guarded migrations; no image-only rollback | operational | 0073–0099 | applies strongly here | `architecture.md` runbooks |
| Measure before adding | organisational | prior research, the decision not to add an index | dominant style | `architecture.md:687` |

### 10.2 Key insights
1. **"Related", not "same".** This is the right framing for the tier and its copy, and it is why the tier gets no bell. (High)
2. **Thresholds matter more than model size.** Narrow bands and prefix sensitivity outweigh the gap between models. (High)
3. **Timing is the integration risk; compute is not.** (High)
4. **Visibility is free if the fragment is reused.** (High)
5. **Choosing Bielik's base model minimises operational novelty.** (Medium-high)
6. **The quantisation parity gate is mandatory.** (High)

### 10.3 SWOT
| Strengths | Weaknesses |
|---|---|
| Fits the existing contract, the ONNX path and the visibility rule; exact and filter-correct; small RAM and CPU cost; no new matcher dependency | Hard negatives poorly separated; narrow score bands; no real-name benchmark; synchronous writes add request latency |
| **Opportunities** | **Threats** |
| Same sample tunes the lexical gate; int8 Bielik frees RAM; a path to search-page semantic search; VPS B escalation for bigger models | Unknown VPS A capacity; tier name confusion; a one-way image switch; a future HNSW added carelessly |

## 11. Conclusions
**Direct answer.** Add a third, bell-less, capped tier fed by `mmlw-roberta-base` int8 vectors. The challenger and fallback are scored on the same labelled sample. Vectors are computed synchronously and best-effort in the API process when a product name or want name is created or changed, with an outbox retry that re-triggers the matcher. They are stored as `halfvec` in product and want side tables on the `pgvector/pgvector:0.8.7-pg18-trixie` image, through new revisions 0100 and 0101. The matcher compares them by exact scan inside the existing narrowing and visibility SQL, after the lexical tiers, with an absolute cosine threshold set precision-first on at least 300 labelled pairs. The estimated cost is about +130 MB RAM, 25–50 ms per write and about 1–1.7 s per capped window run.

| Conclusion | Confidence |
|---|---|
| Exact scan on `halfvec`, no HNSW, trixie image, new revisions | High |
| Third tier shape (run last, born seen, cap 10, shared visibility fragment) | High |
| Sync best-effort writer + outbox re-trigger | Medium |
| mmlw-roberta-base primary, PKOBP challenger, e5-small fallback | Medium |
| Cost estimates on VPS A | Medium (unmeasured on VPS) |
| The tier reaches precision ≥ 0.80 with useful recall | Low (sample pending) |

**Overall confidence: medium.**

**Secondary conclusions.**
- The memory note about a moderation worker is outdated.
- int8-quantising Bielik through the same pipeline could save about 600 MB. That is out of scope, but worth a task.
- Semantic search on the search page can reuse the vectors later.

## 12. Open decisions for the user
| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Final model | mmlw-roberta-base / PKOBP-68m / e5-small | Decide on the labelled sample; mmlw unless PKOBP wins on held-out data |
| D2 | Tier name vs the existing „Podobne rzeczy” subtitle | rename the subtitle / name the tier e.g. „Powiązane rzeczy” or „Coś w tym stylu” | Name the new tier something other than „Podobne rzeczy”, because it surfaces related items |
| D3 | Release gate sample | keep ≥200 / extend to ≥300 with ≥120 positives, 3 labels, 2 labellers | Extend |
| D4 | Writer | sync best-effort + outbox fallback / pure outbox (async) | Sync + fallback |
| D5 | Embedding input | name only / + leaf category / + description excerpt | Name only unless B or C wins on the sample |
| D6 | Revisions | one 0100 / 0100 extension + 0101 schema | Two revisions |
| D7 | Shadow-mode mechanism vs "no feature switch" | read-side setting hiding `/similar` / deploy the frontend later | A read-side hold for 2–4 weeks; record it as an explicit exception |
| D8 | Precision target and recall gain X | 0.80 lower bound / X = 15 pts proposed | Confirm the numbers |
| D9 | VPS A measurement before building | yes / no | Yes, via `probe.py` in the backend container |
| D10 | Upgrade SIMILAR → MATCH when a later lexical match appears | keep `DO NOTHING` (as SUGGESTION) / `DO UPDATE` | Keep `DO NOTHING` |
| D11 | Tier code | `SIMILAR` / `SEMANTIC` | `SIMILAR` |
| D12 | int8-quantise Bielik too | yes, as a separate task / no | Separate task |

## 13. Appendices

### A. Sources
**Finding files (10):** `analysis/findings/models-candidates.md`, `models-local-probe.md`, `pgvector-operations.md`, `pgvector-performance-and-options.md`, `codebase-matcher-contract.md`, `codebase-backend-writers.md`, `codebase-integration-map.md`, `evaluation-threshold-procedure.md`, `evaluation-embedding-input-and-hybrid.md`, `evaluation-prior-research.md`.

**Measured artefacts:** `analysis/models-probe/` (`probe.py`, `parity.py`, `probe_data.py`, `summ.py`, 6 `result-*.json`).

**Project files (selection):**
- Matcher: `src/matcher/matcher/statements.py`, `window.py`, `requests.py`, `rules.py`, `db.py`, `outbox.py`
- Migrations and wants models: `src/backend/alembic/versions/0099_wants.py`, `0086_pg_trgm.py`; `src/backend/app/wants/{application/writes.py, application/bells_due.py, reads.py, schemas.py, models.py, router/wants.py, infrastructure/*}`
- Product, inventory and outbox: `app/product/service.py`, `app/inventory/application/inventory_items.py`, `app/outbox/{dispatcher,scheduler,service,registry}.py`
- Moderation and app wiring: `app/moderation/{onnx_models,classifiers,text_guard}.py`, `app/main.py`
- Build and deploy: `src/backend/Dockerfile`, `src/backend/pyproject.toml`, `docker-compose.yml`
- Frontend: `src/frontend/src/features/wanted/WantMatchesView.tsx`, `hooks/useWantMatches.ts`
- Tests: `src/matcher/tests/conftest.py`, `src/backend/tests/conftest.py`, `test_wants_visibility_parity.py`, `test_module_boundaries.py`, `test_domain_clock_guard.py`, `test_constants_drift.py`
- Docs: `.maister/docs/project/architecture.md`

**Prior research:** `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/`, `2026-10-01-photo-upload-spaces-ai-moderation/`, `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/`, `2026-10-02-text-image-moderation-policy/verification/reality-check.md`.

**External (main):**
- Papers and model cards: PL-MTEB https://arxiv.org/html/2405.10138; PIRB https://arxiv.org/abs/2402.13350; model cards on huggingface.co (sdadas/mmlw-roberta-base, PKOBP/embed-modernbert-68m, intfloat/multilingual-e5-small, speakleash/Bielik-Guard-0.1B-v1.0 and the others listed in `models-candidates.md` Sources).
- pgvector: https://github.com/pgvector/pgvector (README, CHANGELOG, Dockerfile, `sql/vector.sql` v0.8.7); Docker Hub tag API for pgvector/pgvector and library/postgres.
- Quantisation: Katz, halfvec quantisation https://jkatz05.com/post/postgres/pgvector-scalar-binary-quantization/; Neon halfvec https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost.
- Evaluation and retrieval: scikit-learn thresholds https://scikit-learn.org/stable/modules/classification_threshold.html; sbert evaluators https://sbert.net/docs/package_reference/sentence_transformer/evaluation.html; Agresti & Coull 1998; Cormack et al. RRF 2009 http://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf; Allegro NLI retrieval https://arxiv.org/abs/2308.03103.
- PostgreSQL 18 docs: CREATE EXTENSION, ALTER COLLATION.
- asyncpg usage docs.

### B. Gaps and uncertainties
- VPS A hardware is undocumented, and no VPS measurement exists.
- There is no real-name quality data; the probe has 41 positives and an AUC SE of about ±0.03–0.05.
- The pgvector timings use random vectors (valid for timing; HNSW recall is not representative).
- The semantic SQL has not been run on the real 0099 schema.
- Old-image compatibility after 0101 is inferred.
- No source gives a description vs name ablation for short queries.
- The backfill re-entry side effect (R12) is inferred.

### C. Methodology details
- **Probe:** 20 wants × 76 names, `torch.onnx.export` at opset 17, dynamic int8 with `quantize_dynamic(QInt8)`, ONNX Runtime CPU with 1 thread, metrics AUC-hard, AUC-all, best F1, P@1, R@3 and MRR. Run in a throwaway venv in the scratchpad.
- **pgvector:** run in a `pgvector/pgvector:0.8.7-pg18-trixie` container with `max_parallel_workers_per_gather = 0` and default memory settings, on 10k wants, 50k listings and 300-row windows, repeated warm.
- **Wilson intervals** computed locally.

### D. Raw data references
- `analysis/models-probe/result-mmlw-roberta-base.json`, `result-pkobp-modernbert-68m.json`, `result-multilingual-e5-small.json`, `result-mmlw-e5-small.json`, `result-paraphrase-ml-MiniLM-L12-v2.json`, `result-granite-107m-multilingual.json`
- `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/results.md` (lexical baselines)
