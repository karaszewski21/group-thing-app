# Research Plan: semantic „Szukam” matching with a small embedding model + pgvector

## TL;DR
Mixed research (technical + literature). Four parallel gatherers: `models` (external model evidence for short Polish names), `pgvector` (external: pg18 image, types, HNSW, filtered ANN), `codebase` (matcher, 0099 contract, outbox/ONNX moderation pattern, item write paths, compose, measurements) and `evaluation` (threshold method from a labelled sample, embedding input, prior research). Synthesis then maps literature onto the existing DB contract and produces a ranked model choice, a threshold procedure, an architecture sketch with migration/rollback, cost numbers for VPS A and a risk list.

## Key Decisions
- Four gatherers, not the default four source-type split: model and pgvector literature are large and independent; evaluation is its own category because the threshold method decides whether the tier can ship at all.
- Codebase is one gatherer: matcher, 0099 and the outbox/moderation worker are tightly linked (who writes vectors, how the matcher reads them); splitting would duplicate reads.
- Scope fixed by the brief: Option A only (embeddings + pgvector), vectors computed in the backend outbox worker on VPS A, matcher stays asyncpg-only with no ML deps; LLM expansion/judging and search-page semantic search are out of scope (follow-ups only).
- Evidence standard: model claims need a model card / benchmark table / measured number with URL; codebase claims need `file:line`.

## Open Questions / Risks
- Public benchmarks (PL-MTEB, PIRB) score sentences/passages; nothing public measures 2–8-word Polish item names. Gatherers must flag this and the synthesis must say how to measure it locally (small offline probe on `polish_names.py`-style names).
- CPU latency numbers online vary by hardware; VPS A specs must come from the codebase/prior research (or be marked as an assumption).
- pgvector filtered-search behaviour (iterative scans, 0.8+) must be checked against the exact version shipped in `pgvector/pgvector:pg18`.
- The 0099 release-gate labelled sample does not exist yet; the threshold procedure has to work with it once built (and say how many pairs per tier are enough).

---

## 1. Research Overview

**Question**: How should the „Szukam” matcher add semantic matching with a small embedding model and pgvector, so that synonyms and close meanings match (e.g. „Samochód Zabawka” ↔ „Zabawka - auto mercedes”), and what does it cost?

**Type**: Mixed — technical (codebase) + literature (models, pgvector, evaluation method).

**Sub-questions** (from the brief):
1. Model — which small multilingual/Polish embedding model best separates short Polish item names; quality vs size vs ONNX CPU time; prefixes, dims, licence.
2. Threshold & input — threshold from a labelled ≥200-pair sample (precision/recall, PR curve, per-tier); name only vs name + description (+ category path).
3. Architecture — who computes vectors and when (outbox worker, `changed_at`, want create/edit, backfill); pgvector schema/index/filtered search with existing narrowing (offer mode, category, locality radius, PRIVATE visibility); matcher integration as a third bell-less tier „Podobne rzeczy” with caps; migration (amend unreleased 0099 vs new revision) and rollback.
4. Cost & risks — RAM/CPU on VPS A, per-listing/per-want latency, window cost at 10k wants, false positives, PRIVATE privacy, operations.

**In scope**: model choice, threshold method, schema + index, compute pipeline, matcher integration, cost, risks, rollout (flag/shadow mode).
**Out of scope**: LLM query expansion or pair judging, GPU, `/api/public/search` semantic search (follow-up note only), frontend beyond the tier name.
**Constraints**: CPU only; VPS A hosts app + Postgres; matcher asyncpg-only; Polish UI; never print secrets (presence checks only; no `env`, no `cat .env`).

## 2. Methodology

**Primary approach**
- Literature: model cards, leaderboards (PL-MTEB / MTEB, PIRB), papers, pgvector README/CHANGELOG and release notes, ONNX/optimum docs, IR evaluation literature.
- Technical: targeted code reading of the matcher and 0099 contract, the outbox dispatcher + moderation ONNX loader, item create/rename paths, compose and the existing measurement results.

**Fallback strategies**
- If no benchmark covers short texts: use STS/paraphrase subsets of PL-MTEB (e.g. CDSC-R, SICK-R-PL, PPC) as the nearest proxy and propose a local probe.
- If CPU latency is not published: derive from parameter count + known ONNX benchmarks for MiniLM/e5-small/base and mark as estimate; compare with the Bielik-Guard measured cost in prior research.
- If pgvector pg18 image details are unclear: read the Docker Hub tags / GitHub Dockerfile and CHANGELOG directly.

**Analysis framework**
- Models: comparison matrix (params, dims, max tokens, licence, prefixes, Polish STS/retrieval scores, ONNX availability, RAM, ms/text on CPU) → ranked choice + fallback.
- pgvector: option table (exact scan vs HNSW; `vector` vs `halfvec`; pre-filter vs post-filter vs iterative scan) against expected volumes (listings, 10k wants, 300 listings/window).
- Architecture: integration mapping onto the 0099 contract — tables/columns, writer, trigger/notify, window and forward paths, caps, tier interplay, visibility.
- Evaluation: procedure (sample design, metrics, threshold choice, per-tier cut-offs, monitoring), plus input-choice evidence.
- Cost & risk: estimate table + risk register with mitigations.

## 3. Data Sources
See `planning/sources.md` (codebase, documentation, configuration, external).

## 4. Research Phases

**Phase 1 — Parallel gathering** (four gatherers, below).
- models: build the comparison matrix; collect each candidate's card facts and Polish scores with URLs.
- pgvector: version in `pgvector/pgvector:pg18`, types, operators, HNSW params, build cost, filtered search, upgrade/operations.
- codebase: trace the matcher statements and loops, the 0099 view/trigger contract, outbox handler registration and ONNX model loading/RAM, product/item write paths that change name/description, compose services, measurement numbers.
- evaluation: threshold-setting method, sample size, input choice evidence, prior-research decisions to respect.

**Phase 2 — Verification**: cross-check model facts across card + leaderboard; confirm pgvector features exist in the image's version; confirm each codebase claim with `file:line`.

**Phase 3 — Synthesis**: map model + pgvector onto the 0099 contract; decide tier rules and caps; estimate cost; build risk list.

**Phase 4 — Outputs**: research report, solution options, high-level design (by later workflow steps).

## 5. Gathering Strategy

### Instances: 4

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|-------------|-----------|-------|---------------|
| 1 | models | Small multilingual / Polish embedding models for 2–8-word item names: `sdadas/mmlw-*` (e5-small, roberta-base, roberta-large for reference), `intfloat/multilingual-e5-small/base`, `paraphrase-multilingual-MiniLM-L12-v2`, `BAAI/bge-m3`, `Snowflake arctic-embed-m-v2.0`, `jina-embeddings-v3` (licence), `ipipan/silver-retriever`, others found; PL-MTEB / PIRB scores (STS/paraphrase subsets especially), params, dims, max tokens, licence, prefixes, normalisation, ONNX availability (Hub `onnx/` folder, optimum export, int8 quantisation), CPU latency and RAM | WebSearch, WebFetch | models |
| 2 | pgvector | pgvector on PostgreSQL 18: `pgvector/pgvector:pg18` image and its pgvector version, `vector`/`halfvec` (and binary quantisation), cosine ops `<=>` and `vector_cosine_ops`/`halfvec_cosine_ops`, HNSW `m`/`ef_construction`/`ef_search`, build time + memory (`maintenance_work_mem`), filtered ANN and iterative index scans (`hnsw.iterative_scan`, `max_scan_tuples`) in 0.8+, exact scan vs index at small N, asyncpg type handling without the `pgvector` Python package (text cast), switching image from `postgres:18` (same data dir, `CREATE EXTENSION`), backups, upgrades | WebSearch, WebFetch | pgvector |
| 3 | codebase | `src/matcher/matcher/*` (statements, window, requests, rules, db, outbox), `src/matcher/tests/*`, `src/backend/alembic/versions/0099_wants.py` (matchable_listings + `changed_at`, trigger, tiers, caps, visibility views), `src/backend/app/wants/*` (writes, outbox handler, suggestions API), `src/backend/app/outbox/*` + `src/backend/app/moderation/onnx_models.py`/`classifiers.py`/`text_guard.py` (ONNX load, RAM, dispatch), item/product create/rename paths (`app/inventory`, `app/product`), `docker-compose.yml`, backend/matcher Dockerfiles and pyproject, measurement `results.md` + scripts | Glob, Grep, Read | codebase |
| 4 | evaluation | Threshold setting from a labelled sample (PR curves, precision@k, choosing a cosine cut-off per tier, sample size/confidence, hard negatives), embedding input for classifieds/e-commerce matching (name vs name+description vs +category path), asymmetric query/passage prefixes for short queries, hybrid lexical+semantic ranking (RRF) as context; prior project research and decisions (2026-11-14 Szukam, 2026-10-01 moderation, memory decision on VPS A/B), the 0099 release gate in `architecture.md` | WebSearch, WebFetch, Read, Grep | evaluation |

### Rationale
The question splits cleanly into two independent literature areas (model choice; pgvector mechanics), one codebase area (where vectors are written and read in the existing contract) and one method area (how to decide the threshold and the input text) that combines literature with the project's prior decisions and release gate. Configuration (compose, Dockerfiles, pyproject) belongs to the codebase gatherer because it is small and tied to the same integration question. Four instances keep categories distinct with no overlap.

### Gatherer notes
- All gatherers: cite URLs or `file:line`; mark estimates as estimates; never print secrets (presence checks only, no `env`/`cat .env`); do not modify code.
- models: flag explicitly that public benchmarks do not cover short names; collect any short-text / product-title evidence found.
- codebase: report VPS A RAM/CPU assumptions if documented (prior research, compose limits), the moderation model's measured RAM/latency, and the current window cost numbers from `results.md`.

## 6. Success Criteria
- Ranked model recommendation with evidence (scores, size, dims, licence, ONNX, CPU latency) and a fallback.
- Concrete threshold procedure tied to the ≥200-pair labelled sample (metrics, how to choose the cut-off, per-tier, re-check cadence).
- Architecture sketch fitting the 0099 contract: tables/columns, writer (outbox worker), triggers on `changed_at`/want edits, backfill, matcher statement shape for the third tier, caps and interplay with MATCH/SUGGESTION, visibility/PRIVATE handling, migration choice (amend 0099 vs new revision) and rollback.
- Cost numbers or grounded estimates for VPS A (RAM, CPU per text, index size, window cost at 10k wants).
- Risk list with mitigations (false positives, privacy, ops, model drift/re-embedding).
- Every claim backed by a source.

## 7. Expected Outputs
- `analysis/findings/models-*.md`, `pgvector-*.md`, `codebase-*.md`, `evaluation-*.md`
- Research report with recommendations (`outputs/research-report.md`)
- Inputs for solution exploration / high-level design for the follow-up `/maister:development` task
