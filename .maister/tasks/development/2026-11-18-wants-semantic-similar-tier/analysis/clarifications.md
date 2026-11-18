# Phase 1 Clarifications

## TL;DR
Build the full SIMILAR design in this task, from migrations to the frontend section. Shadow mode comes from deploy order, not from the code. The threshold is the provisional probe value 0.86 until the release gate re-scores it. The Dockerfile model build (with int8 and a parity gate) is in scope. The pgvector image is swapped in compose and in both test conftests.

## Key Decisions
- **Scope: everything** — 0100/0101, `app/embeddings`, product and want writers, the outbox retry, the reconcile sweep, matcher SIMILAR statements and gate 101, `GET /api/wants/{id}/similar`, the „Powiązane rzeczy” frontend section, the Dockerfile, compose, `.env.example` and docs. Shadow mode = deploy backend and matcher first, web later.
- **`SEMANTIC_SIMILARITY_MIN` = 0.86 (provisional)** — this is the best-F1 cut-off for mmlw-roberta-base with the asymmetric prefix on the local probe (0.862, `models-local-probe.md`). Before deploy, the release gate (≥300 labelled pairs) must re-score it. That stays a documented release-gate step, not code.
- **Model build in the Dockerfile `models` stage** — export `sdadas/mmlw-roberta-base` at a pinned revision (feature-extraction), run int8 `quantize_dynamic`, fail the build unless min cosine vs fp32 is ≥ 0.99 on a fixed name list, write `model_id.txt`, and copy the result to `/models/embed` in `runtime`.
- **DB image `pgvector/pgvector:0.8.7-pg18-trixie`** goes into `docker-compose.yml`, `src/backend/tests/conftest.py` and `src/matcher/tests/conftest.py`. The local dev volume is reused, since the major version and path are the same.

## Open Questions / Risks
- The 0.86 value comes from 41 positives written by the author. Real precision is unknown until the labelled sample exists.

## Q&A
1. Q: Which parts to build? A: Everything (recommended).
2. Q: Threshold value for now? A: Probe value, and the release gate stays (recommended) → 0.86.
3. Q: Is the model build in scope? A: Yes, in the Dockerfile (recommended).
4. Q: Swap the DB image everywhere? A: Yes (recommended).
