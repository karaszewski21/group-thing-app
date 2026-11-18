# Evaluation: prior project research and decisions to respect

## TL;DR
- The 2026-11-14 Szukam research put embeddings + pgvector on the table as option 4.2D/G and deferred it: "real operating cost before any measured benefit"; thresholds were to come from a labelled sample that still does not exist. This research picks up exactly that deferred option.
- The 2026-10-01 moderation research sets the hosting pattern: small models as ONNX Runtime CPU in a same-codebase outbox worker, int8, `tokenizers` + `numpy`, no `torch` in images, models exported at build time; estimated ~50–150 ms per text and ~0.13 GB RAM for a 124 M RoBERTa int8 (estimates, not measured on the target VPS).
- The user later moved hosting to two non-DO VPSs: small models stay on VPS A in the app's outbox worker, heavy models on VPS B.

## Key Decisions
- Respect: lexical tiers unchanged; semantic as a measured add-on (2026-11-14 R6/R10 rationale); shadow mode before acting on scores (2026-10-01 step 2.4); model on VPS A (memory decision).

## Open Questions / Risks
- Every CPU/RAM number in prior research is an estimate derived from other hardware; VPS A's spec is not recorded in the documents read here.
- The prior labelled-set plan (200 pairs) was sized for the lexical rule only.

---

### Finding 1: Embeddings were considered and explicitly deferred
**Source**: `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/outputs/research-report.md:385`, `:390`, `:493`; `outputs/solution-exploration.md:334-339`, `:793`; `outputs/decision-log.md:275`, `:289`
**Evidence**: Option G "Small embedding model + pgvector | Semantic matches | Extension in the image, a model in the app process, re-embedding on edits | Yes/no threshold unknown for three-word Polish wants; CPU and memory unconfirmed | Medium". R10: "Do not add a Polish dictionary, embeddings or a search engine now … Cost without measured benefit". ADR-007, user: "no lemmatisation or embeddings in v1". Rejection note: "4.2C and 4.2D: real operating cost before any measured benefit."
**Context**: The open items then — threshold for three-word Polish wants, CPU and memory — are the same ones this research must close; the labelled set is the instrument for the first.
**Confidence**: High.

### Finding 2: Prior external notes on embeddings already collected
**Source**: `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/analysis/findings/external-matching-alerts-matching.md:15`, `:20`, `:134-142`
**Evidence**: "a 384-dimension small model fits the "small models" rule, but adds a model, a threshold to tune and an extension". `sdadas/mmlw-retrieval-e5-small`: "384 dimensions; same prefixes; 52.34 NDCG@10 on the Polish Information Retrieval Benchmark; Apache-2.0; about 0.1B parameters". pgvector: exact search by default with "perfect recall"; "At thousands of rows the exact scan needs no vector index". "An alert needs a yes/no decision, so a similarity cut-off must be chosen and tuned on real data; no opened source gives a threshold for short Polish listings … Benchmarks above measure passage retrieval, not three-word wanted posts."
**Context**: Consistent with this gatherer's findings; the models gatherer should verify the mmlw-retrieval-e5-small facts on the day.
**Confidence**: High (as recorded).

### Finding 3: Release gate and measurement plan
**Source**: `.maister/docs/project/architecture.md:294`, `:691`; `.maister/tasks/research/2026-11-14-szukam-wanted-mechanism/outputs/high-level-design.md:586-587`, `:653`
**Evidence**: see threshold file Findings 1.1–1.3. Acceptance item: "the thresholds are set from the labelled sample before release" (`high-level-design.md:653`).
**Confidence**: High.

### Finding 4: Hosting pattern for small models (moderation research)
**Source**: `.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/outputs/research-report.md:41-42`, `:183`, `:241`, `:252`, `:393`, `:442`, `:465`
**Evidence**:
- "Self-host the two small classifiers on CPU with ONNX Runtime" (`:41`); "Build a module … triggered by the existing outbox, with inference running in a separate worker process from the same codebase" (`:42`).
- Bielik-Guard-0.1B: "124 M RoBERTa (`sdadas/mmlw-roberta-base`), Apache-2.0" (`:183`) — the same backbone as the `mmlw-roberta-base` embedding candidate, so its RAM/latency is a direct proxy.
- "RAM is the real cost driver: Bielik int8 is about 0.13 GB … plus runtime; a PyTorch FP32 stack would be 2–3 GB. Latency estimates (derived from AWS benchmarks of same-size architectures, not measured on DO): text about 50–150 ms (ONNX) … shared vCPUs with no guaranteed VNNI, so measure int8 gains before relying on them." (`:241`)
- "ONNX Runtime + `tokenizers` + `numpy` … in a `uv` dependency group `ml` … Models are exported with Optimum at build time … `torch` never enters any image." (`:252`)
- "keep CPU work in `asyncio.to_thread` even in the worker" (`:393`); "measure latency and RSS … FP32 vs int8" (`:442`); "Shadow mode (log scores, decide nothing) for 2–4 weeks or N items … set thresholds" (`:465`).
- A Polish evaluation set of "200–500 realistic listings" was planned for moderation thresholds (`:440`) — the same evaluation discipline proposed here.
**Context**: Short item names (≤ ~20 tokens) cost far less than the 512-token worst case behind those estimates; a 118 M e5-small or 124 M mmlw-roberta-base in int8 should sit near Bielik's footprint (inference, not measured). The codebase gatherer has the actual `onnx_models.py` loader.
**Confidence**: High for what is written; latency/RAM are estimates by the prior research's own admission.

### Finding 5: Current hosting decision (user memory)
**Source**: user memory `ai-microservice-decision.md:12-14`
**Evidence**: "VPS A = app (nginx, FastAPI, outbox worker, Postgres). VPS B = separate AI microservice for HEAVY models only … SMALL models stay in group-thing-app on VPS A, run in the moderation outbox worker (ONNX, CPU)". VPS B "6 vCPU / 12 GB RAM, CPU-only" under consideration.
**Context**: An embedding model of ~0.1 B params is a small model → VPS A outbox worker, matching the brief. VPS A size not stated in sources read.
**Confidence**: High.
