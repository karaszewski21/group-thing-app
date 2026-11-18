# Research Sources

## TL;DR
Verified local sources (matcher, 0099, wants module, outbox + ONNX moderation, compose, measurements, prior research) plus external sources for models, pgvector and evaluation. Paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app` unless noted. Category tags in brackets map to gatherers.

## Open Questions / Risks
- External URLs are starting points; gatherers must confirm current versions (pgvector in the pg18 image, model card details) on the day.
- `docker-compose.yml` currently uses `image: postgres:18` (line 3); the switch to `pgvector/pgvector:pg18` is part of the question.
- Never print secrets: `.env` is not a source; check variables by presence only.

---

## Codebase Sources [codebase]

### Matcher service (`src/matcher/`)
- `src/matcher/matcher/statements.py` — SQL for window, forward, suggestions, caps
- `src/matcher/matcher/window.py` — 60 s window loop, marker, sweep/match transactions
- `src/matcher/matcher/requests.py` — LISTEN/poll request loop, forward match
- `src/matcher/matcher/rules.py` — constants (`WORD_SIMILARITY_MIN`, caps, `WINDOW_MAX_LISTINGS`)
- `src/matcher/matcher/db.py`, `outbox.py`, `settings.py`, `clock.py`, `__main__.py`
- `src/matcher/tests/` — `test_window.py`, `test_forward.py`, `test_suggestions.py`, `test_constants_drift.py`, `test_text_rules.py`, `conftest.py`
- `src/matcher/pyproject.toml`, `src/matcher/Dockerfile`, `src/matcher/README.md`

### DB contract
- `src/backend/alembic/versions/0099_wants.py` — `wants` generated columns, `matchable_listings` view with `changed_at` (≈lines 205–251, 394), `group_holdings`/`private_group_peers`, trigger `trg_wants_match_requested`, text functions
- `src/backend/alembic/versions/0086`–`0098` — search vectors, trigram indexes, locality coordinates (radius filter base)
- `src/backend/tests/test_wants_migration.py`, `tests/test_wants_visibility_parity.py`

### Wants module (`src/backend/app/wants/`)
- `application/` (writes, outbox handler for `wants.bells_due`), `domain/` (limits), `infrastructure/*_acl.py`, `router/`, `models.py`, `schemas.py`

### Outbox worker and ONNX moderation (vector-writer pattern)
- `src/backend/app/outbox/dispatcher.py`, `registry.py`, `scheduler.py`, `service.py`, `models.py`
- `src/backend/app/moderation/onnx_models.py` — model dir (`model.onnx`, `model_id.txt`), `onnxruntime` CPU session
- `src/backend/app/moderation/classifiers.py`, `text_guard.py`, `service.py`, `rules.py`
- `src/backend/app/main.py` — lifespan / model loading

### Item and product write paths (when to (re)embed)
- `src/backend/app/inventory/` (`application/`, `service.py`, `models.py`, `router.py`) — listing, listing_status, preferences
- `src/backend/app/product/` (`service.py`, `models.py`) — product name/description changes

### Measurements
- `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/measurement/results.md`
- same dir: `seed_measurement.py`, `explain_matcher.py`, `measure_bells.py`, `polish_names.py` (name corpus usable for a probe), `plans/`

## Documentation Sources [codebase, evaluation]

### Project documentation
- `.maister/docs/project/architecture.md` — section „Wants” incl. release gate (≈line 294) and limits (≈line 300)
- `.maister/docs/project/tech-stack.md` — versions, matcher stack
- `.maister/docs/standards/backend/migrations.md`, `queries.md`, `models.md`, `global/error-handling.md`
- `.maister/docs/INDEX.md`

### Task documentation
- `.maister/tasks/development/2026-11-17-wants-matcher-service/implementation/spec.md`, `implementation-plan.md`, `work-log.md`, `documentation/user-guide.md`
- `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/outputs/research-report.md`, `decision-log.md`, `high-level-design.md`, `solution-exploration.md` [evaluation]
- `.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/outputs/research-report.md` — Bielik-Guard / ONNX on VPS A, RAM/latency, VPS sizing [evaluation, codebase]
- User memory decision: small models on VPS A in the app worker, heavy ones on VPS B (`ai-microservice-decision`)

### Sibling repo (context only)
- `../group-thing-ai/` — VPS B service (`app/`, `models/`, `docker-compose.yml`); not the target for this model

## Configuration Sources [codebase]
- `docker-compose.yml` — `postgres:18` (line 3), backend, matcher, nginx services, resource limits if any
- `src/backend/Dockerfile`, `src/backend/pyproject.toml`, `src/backend/uv.lock` — `onnxruntime`, tokenizers deps
- `src/matcher/pyproject.toml` — asyncpg-only constraint
- `.env.example` — variable names only (never `.env`)

## External Sources

### Models [models]
- PL-MTEB paper and leaderboard: https://arxiv.org/abs/2405.10138 , https://huggingface.co/spaces/mteb/leaderboard
- PIRB (Polish IR benchmark): https://arxiv.org/abs/2402.13350 , https://huggingface.co/spaces/sdadas/pirb
- sdadas/mmlw models: https://huggingface.co/sdadas/mmlw-e5-small , https://huggingface.co/sdadas/mmlw-roberta-base , https://huggingface.co/sdadas/mmlw-roberta-large ; paper https://arxiv.org/abs/2402.13350
- intfloat/multilingual-e5: https://huggingface.co/intfloat/multilingual-e5-small , https://huggingface.co/intfloat/multilingual-e5-base ; paper https://arxiv.org/abs/2402.05672
- https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
- https://huggingface.co/BAAI/bge-m3
- https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0 , https://huggingface.co/jinaai/jina-embeddings-v3 (licence check), https://huggingface.co/ipipan/silver-retriever-base-v1
- ONNX/CPU: https://huggingface.co/docs/optimum/onnxruntime/usage_guides/quantization , https://onnxruntime.ai/docs/performance/ , sentence-transformers efficiency docs https://sbert.net/docs/sentence_transformer/usage/efficiency.html

### pgvector [pgvector]
- https://github.com/pgvector/pgvector (README: HNSW, halfvec, iterative scans, filtering)
- https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md
- https://hub.docker.com/r/pgvector/pgvector (pg18 tags)
- pgvector 0.8.0 release notes (iterative index scans): https://www.postgresql.org/about/news/
- asyncpg custom codecs: https://magicstack.github.io/asyncpg/current/usage.html#custom-type-conversions

### Evaluation [evaluation]
- scikit-learn precision-recall / threshold tuning: https://scikit-learn.org/stable/modules/classification_threshold.html
- Manning et al., Introduction to IR, ch. 8 (evaluation): https://nlp.stanford.edu/IR-book/
- Sentence-transformers evaluators (BinaryClassificationEvaluator, threshold search): https://sbert.net/docs/package_reference/sentence_transformer/evaluation.html
- Hybrid search / RRF: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- Product/classifieds title-matching literature (e.g. WDC product matching, Amazon semantic product search https://arxiv.org/abs/1907.00937)
