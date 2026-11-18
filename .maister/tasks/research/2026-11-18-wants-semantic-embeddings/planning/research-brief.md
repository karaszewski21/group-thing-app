# Research Brief: semantyczne dopasowanie „Szukam” przez embeddingi + pgvector

## TL;DR
Mixed research (technical + literature): which small embedding model, threshold method and architecture let the wants matcher connect synonyms and close meanings ("Samochód Zabawka" ↔ "Zabawka - auto mercedes") as a third, bell-less tier "Podobne rzeczy", at acceptable cost on VPS A. Output feeds a later `/maister:development` task.

## Key Decisions
- Option A only (embeddings + pgvector); LLM query expansion and per-pair LLM judging are out of scope — user choice after comparing options.
- Vectors computed by the backend outbox worker on VPS A (Bielik-Guard pattern), not by the matcher; heavy models stay in `group-thing-ai` on VPS B — standing decision (memory: ai-microservice-decision).
- Lexical MATCH/SUGGESTION stay as they are; semantic results are a separate tier without a bell until scored on the release-gate sample.

## Open Questions / Risks
- Polish short-name quality of small models is the main unknown; public benchmarks (MTEB-PL/PIRB) measure sentences/passages, not 2–8-word item names.
- The 0099 release gate (≥200 labelled pairs) is not built yet; the threshold method depends on it.

## Research question
How should the „Szukam” matcher add semantic matching with a small embedding model and pgvector, so that synonyms and close meanings match, and what does it cost?

## Research type
Mixed — technical (codebase: matcher, 0099 contract, moderation worker, compose) + literature (models, benchmarks, pgvector, ONNX on CPU).

## Sub-questions
1. **Model**: which small multilingual or Polish embedding model best separates short Polish item names (2–8 words, diminutives, inflection, synonyms)? Quality vs size vs CPU time in ONNX. Candidates: `intfloat/multilingual-e5-small`, `multilingual-e5-base`, `sdadas/mmlw-roberta-base`, `sdadas/mmlw-e5-small`, `paraphrase-multilingual-MiniLM-L12-v2`, `BAAI/bge-m3`, others found. Query/passage prefixes (e5 `query:`/`passage:`), dimension, licence.
2. **Threshold & input**: how to set the similarity threshold (labelled sample ≥200 pairs from the 0099 release gate; precision/recall at k), and whether to embed name only or name + description (+ category path).
3. **Architecture**:
   - who computes vectors (backend outbox worker on VPS A, as moderation with Bielik-Guard ONNX), when (listing created/renamed — `changed_at`; want created/edited), and backfill of existing items;
   - pgvector: extension, image `pgvector/pgvector:pg18` instead of `postgres:18`, column types (`vector(n)`/`halfvec`), HNSW index and its params, filtered search with the existing narrowing (offer mode, category, locality radius, PRIVATE visibility);
   - matcher (asyncpg, DB contract: `matchable_listings`, window over `changed_at`, forward match) — how it compares vectors; a third tier „Podobne rzeczy” without a bell, interplay with MATCH/SUGGESTION and caps;
   - migrations (new revision vs amended 0099, which is unreleased), rollback.
4. **Cost & risks**: RAM/CPU of the model on VPS A, latency per listing and per want, window cost at 10k wants, false positives (e.g. "Klocki" vs "Kloc drewniany"), privacy of PRIVATE listings, operational risks.

## Scope
**Included**: model choice for Polish short texts; threshold method; DB schema and index; compute pipeline; matcher integration; cost estimates; risks; rollout (feature flag, shadow mode).
**Excluded**: LLM query expansion, LLM pair judging, GPU hosting, search-page (`/api/public/search`) semantic search (may be noted as a follow-up), frontend design beyond naming the tier.
**Constraints**: CPU-only; VPS A runs app + Postgres; matcher stays asyncpg-only with no ML deps; Polish UI; never print secrets (`.env`, env dumps) — presence checks only.

## Success criteria
- A ranked model recommendation with evidence (benchmarks, size, CPU latency) and a fallback.
- A concrete threshold-setting procedure tied to the labelled sample.
- An architecture sketch that fits the existing contract (tables/columns, who writes, how the matcher reads) with migration and rollback notes.
- Cost numbers or well-founded estimates for VPS A, and a risk list with mitigations.

## Context
- `.maister/docs/project/architecture.md` — section Wants (matcher, window, `changed_at`, release gate)
- `src/matcher/` — `statements.py`, `window.py`, `requests.py`
- `src/backend/alembic/versions/0099_wants.py` — DB contract
- `src/backend/app/moderation/` — ONNX worker pattern (Bielik-Guard)
- `.maister/tasks/development/2026-11-17-wants-matcher-service/` — spec, measurements (`implementation/measurement/results.md`)
- `.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/` and `2026-11-14-szukam-wanted-mechanism/` — prior research
- Sibling repo `../group-thing-ai` — VPS B service
