# Moderation Architecture: Where the Moderation Model Should Live

Category: `moderation-architecture`. Gathered 2026-10-01.
Question: "Czy taki model do moderacji ma się znaleźć w osobnym mikroserwisie?" ("Should such a moderation model go in a separate microservice?")

---

## 0. Codebase facts that constrain the decision

| Fact | Evidence | Confidence |
|---|---|---|
| The backend is one FastAPI process. It runs as one uvicorn process in compose (`alembic upgrade head && exec uvicorn app.main:app`, no `--workers`) | `docker-compose.yml` backend `command`; `src/backend/Dockerfile` CMD | High |
| The image is `python:3.12-slim`. Runtime deps have no torch/transformers/boto3/Pillow, and **httpx is dev-only** | `src/backend/pyproject.toml:6-19` (`httpx` is under `[dependency-groups].dev`) | High |
| A generic transactional outbox exists. `append()` stages a row in the same commit as the aggregate, `dispatch_pending` claims rows with `FOR UPDATE SKIP LOCKED`, and handlers are registered by event-type string. A failure increments `attempts`, and the row becomes `FAILED` after 5 attempts | `app/outbox/service.py:22-38`, `dispatcher.py:21-57`, `registry.py:13-26` | High |
| The outbox poller is an `asyncio.Task` inside the API process (`app.main` lifespan). The default interval is 60 s | `app/main.py:59-80`, `app/outbox/scheduler.py:14-23` | High |
| `SKIP LOCKED` means a **second poller process** (a separate worker container) can safely run against the same table without double processing | `app/outbox/dispatcher.py:21-29, 33-36` docstring | High |
| Consumers register through a `register()` function called from the composition root (example: `notifications.outbox_listener.register()`) | `app/notifications/outbox_listener.py`, `app/main.py:66` | High |
| Plugins are **frontend iframes** with UI-only extension points: `menu.main`, `product.detail.tabs`, `product.list.filters`, `product.detail.info`. There is no server-side hook or webhook in the product write path | `src/frontend/src/plugins/extensionPoints.ts:1-4`; `.maister/docs/project/architecture.md` ("not a server-side plugin-loading framework"); `plugins/ai-description/manifest.json` | High |
| The existing AI plugin (`ai-description`) calls an LLM through BAML → a LiteLLM proxy at `localhost:4000`, which handles Presidio PII guardrails and Langfuse. This runs outside the backend and is not in docker-compose | `plugins/ai-description/baml_src/clients.baml:1-13`; architecture.md (Deployment) | High |
| The "minimal implementation" standard says no speculative abstractions and no factories, strategies or adapters "unless there's an immediate need". The tech-stack doc lists minimal dependencies | `.maister/docs/standards/global/minimal-implementation.md` | High |
| Pre-production, small team, no CI/CD or hosting decision yet | `.maister/docs/project/architecture.md` (Deployment Architecture, last bullet) | High |

---

## 1. Literature on serving patterns and when to split

- **ML serving patterns** (ml-ops.org) name these patterns:
  - *Model-as-Dependency*: the model is called like a library inside the app.
  - *Model-as-Service*: the model is a separate REST/gRPC service.
  - *Precompute*: predictions are stored in the DB.
  - *Model-on-Demand*: requests go through a broker/queue for async processing.
  
  Options A-E below map onto these. Source: https://ml-ops.org/content/three-levels-of-ml-software. Confidence: High.
- **Fowler, MonolithFirst (2015)**: "you shouldn't start a new project with microservices"; "the premium of microservices is a drag you should do without" early on; "start with a monolith and gradually peel off microservices at the edges". Source: https://martinfowler.com/bliki/MonolithFirst.html. Confidence: High.
- **Fowler, MicroservicePrerequisites (2014)**: before running microservices you need rapid provisioning, basic monitoring and rapid application deployment, which together imply a DevOps culture. This project has no CI/CD or hosting decision yet. Source: https://martinfowler.com/bliki/MicroservicePrerequisites.html. Confidence: High.
- **Sam Newman, *Monolith to Microservices***: legitimate reasons to split are team autonomy, time to market, **cost-effective scaling for load**, **robustness** (with the caveat that it "may increase the surface area of failure"), scaling the number of developers, and **embracing new technology**. Source: https://eddmann.com/posts/notes-monolith-to-microservices-by-sam-newman/ (summary of the book). Confidence: Medium (secondary summary).
- **Heavy ML deps in a web image**:
  - Default PyPI torch pulls in about 2.8 GB of NVIDIA libraries. A CPU-only torch is about 0.6 GB.
  - Reported image sizes: about 8.3 GB shrinking to about 1.75 GB by using the CPU wheel index (`--extra-index-url https://download.pytorch.org/whl/cpu`). Another report: 8.7 GB (PyPI torch) vs 4.4 GB (CPU) vs 11.4 GB (CUDA).
  - "Each [uvicorn] worker loads its own copy of the model", so N workers use N times the model RAM.
  
  Sources: https://medium.com/@himanshujhamb222/we-shrunk-our-docker-image-by-78-just-by-changing-one-line-in-requirements-txt-d8e9f73246d6 ; https://parsebridge.com/blog/running-docling-in-docker/ ; https://analyticsindiamag.com/ai-news/pytorch-configuration-change-reduces-docker-image-size-by-78. Confidence: Medium (blog sources that agree in direction).
- **Event-loop blocking**: PyTorch CPU inference is synchronous. Calling it inside `async def` blocks FastAPI's event loop. The mitigation is `run_in_executor` with a small or single-thread pool, because the ML libraries are already multithreaded. Move to a dedicated serving layer (Ray Serve/Triton) "once you need batching, multi-model deployment". Source: https://theneuralbase.com/fastapi-for-ml/learn/beginner/run-in-executor-for-sync-models/ ; https://luis-sena.medium.com/how-to-optimize-fastapi-for-ml-model-serving-6f75fb9e040d. Confidence: Medium.
- **Off-the-shelf servers**:
  - **TEI** supports XLM-RoBERTa/CamemBERT *sequence classification* models through `/predict`. It ships a CPU image (`ghcr.io/huggingface/text-embeddings-inference:cpu-1.9`) and offers token-based dynamic batching, small images and fast boot. Source: https://github.com/huggingface/text-embeddings-inference ; https://huggingface.co/docs/text-embeddings-inference/en/index. Confidence: High. TEI covers text classifiers, not image classifiers.
  - **BentoML** is a service-definition framework with adaptive batching and containerization. Source: https://docs.bentoml.com/en/latest/. Confidence: High.
  - **Ray Serve** offers FastAPI integration, batching, autoscaling and model composition, and **requires a Ray cluster**. Source: https://docs.ray.io/en/latest/serve/index.html. Confidence: High.
- **Vendor-risk example**: Google Jigsaw's Perspective API, a free toxicity API that once handled about 500M requests a day, shuts down on 31 Dec 2026. This is an argument for keeping the moderation call behind one small internal function and storing `model_id` with every decision. Source: https://www.lassomoderation.com/blog/what-is-perspective-api/ ; https://arxiv.org/html/2604.25580v1. Confidence: Medium.

---

## 2. Options for THIS project

Typical model footprints come from the hf-models and hf-hosting gatherers (cross-check there):
- XLM-R-base classifier: about 280M params, about 1.1 GB fp32 RAM.
- XLM-R-large: about 560M params, about 2.2 GB fp32 RAM.
- ViT-base NSFW: about 86M params, about 350 MB.
- LLM guards (1-12B): need a GPU or several GB of RAM.

### Option A: In-process module that calls an external inference API (HF Inference Providers/Endpoints, or OpenAI omni-moderation as a baseline)
`app/moderation/` holds a small `classify_text()` / `classify_image(url)` function using async httpx. It is called from an outbox handler (async) or inline with a timeout (sync text check).

| Dimension | Assessment |
|---|---|
| Deployment | Nothing new to deploy. Add `httpx` to runtime deps, plus an API key in `app/config.py` |
| Heavy ML deps | None in the image |
| Memory | Negligible |
| Failure isolation | A provider outage or slowness only affects moderation. With async outbox handling, items stay `PENDING` and retry (MAX_ATTEMPTS=5, then FAILED, which should map to `NEEDS_REVIEW`). Rate limits and cold starts need backoff (tenacity is already a dep) |
| Latency | A network round-trip plus possible serverless cold start (seconds). Fine for async, borderline for sync |
| Cost | Per-call or per-hour pricing (see hf-hosting). OpenAI moderation is free but US-hosted and has a non-PL-specific taxonomy |
| Team overhead | Lowest |
| Risks | GDPR transfer/DPA for images and text (see legal file). Vendor model drift ("latest" aliases) and vendor shutdown (Perspective) |

### Option B: In-process model inference (Model-as-Dependency inside the API process)
transformers/optimum + torch (or ONNX Runtime) are loaded in the FastAPI process, and inference runs in `run_in_executor`.

| Dimension | Assessment |
|---|---|
| Deployment | One image, but it grows from about 150 MB slim to about 1.5-2 GB with CPU-only torch, or 8+ GB if the CUDA wheel gets in by accident. ONNX Runtime without torch is much smaller |
| Heavy ML deps | torch and transformers enter the core API's dependency tree, which conflicts with the minimal-dependencies standard. Upgrades become coupled to the web stack |
| Memory | Models stay resident in *every* API replica and every uvicorn worker (1-3 GB per process). Scaling the API to handle web load multiplies model RAM |
| Failure isolation | Worst. An OOM or a native-library segfault kills the API. CPU-bound inference competes with request handling, and GIL/thread contention raises p99 for all endpoints |
| Latency | Lowest per call (no network): about 10-100 ms text and about 100-500 ms image on CPU (estimates, see hf-hosting) |
| Cost | No per-call fee, but you must size every API box for the models (for example 4 GB+ droplets instead of 1-2 GB) |
| Team overhead | Low code effort, but there are operational surprises: slow startup from model download/load, and health checks that time out |
| Verdict | Acceptable only for a tiny model (for example an ONNX text classifier under 300 MB) and one replica. Not recommended for image models |

### Option C: Background worker consuming the outbox (same codebase, separate process/container) — Model-on-Demand
This is the same repo and the same `app` package. A second entrypoint (for example `python -m app.moderation.worker`) runs only `dispatch_pending` with the moderation handlers registered, and it has the ML extras installed. The API container keeps the slim image. The moderation handler may run the model locally (C1) or call an external API or a TEI container (C2).

| Dimension | Assessment |
|---|---|
| Deployment | One more service in `docker-compose.yml` from the same source. Optional dependency group `uv sync --group ml` in a second Dockerfile stage. No new API contract: the DB and the outbox *are* the contract |
| Heavy ML deps | Isolated to the worker image. The API image stays slim |
| Memory | Models load once, in one place, and scale independently of API replicas |
| Failure isolation | Good. A worker crash or OOM leaves the API up, and items wait in `PENDING`. `SKIP LOCKED` already allows several pollers. **One caveat**: today the API-process poller would also claim moderation events. Either register moderation handlers *only* in the worker (the dispatcher marks unknown event types PROCESSED, `dispatcher.py:44-45`, so the API poller would swallow them), or filter `event_type` per poller. This needs a small dispatcher change, for example an `event_types` filter on `_claim_batch` |
| Latency | Async by nature. Poll interval (60 s today) plus inference time. It can be reduced with a shorter interval or Postgres `LISTEN/NOTIFY` |
| Cost | One extra small/medium droplet or container (CPU). No per-call fees with self-hosting |
| Team overhead | Low to medium. One codebase, one test suite (`uv run pytest`), shared models/migrations |
| Verdict | **The best fit** for this architecture and stage |

### Option D: A separate moderation microservice (FastAPI, BentoML, Ray Serve, or plain TEI)
A separate HTTP service owns the models and is called synchronously by the API or by the worker.

| Dimension | Assessment |
|---|---|
| Deployment | A new repo or service, image, versioning, auth between services (service token or network policy), health checks and monitoring. Fowler's prerequisites (rapid provisioning, monitoring, CI/CD) are not met yet in this project |
| Heavy ML deps | Fully isolated, and the service could be in another language or runtime |
| Memory | Independent. A GPU can be attached only to this service |
| Failure isolation | Good, *if* callers use timeouts and circuit breaking. A synchronous call chain adds a network failure mode to the API ("surface area of failure", Newman) |
| Latency | One extra hop of about 1-5 ms on a private network, plus inference. Supports dynamic batching (TEI/BentoML/Ray Serve), which matters only at volume |
| Cost | At least one always-on instance (a GPU is expensive), plus engineering time |
| Team overhead | Highest: API contract, versioning, deployment, observability. Ray Serve adds a Ray cluster |
| Middle ground | **Run an off-the-shelf server (TEI CPU image) as a sidecar container** instead of writing a microservice. You get model isolation and batching with no custom service code. The worker (Option C2) calls it over HTTP. TEI covers text classifiers only. Images still need a small custom server or in-worker inference |

### Option E: As a plugin (Next.js iframe, like `ai-description`)
| Dimension | Assessment |
|---|---|
| Fit | **Poor for enforcement.** Plugins are UI iframes rendered in the browser after the fact. They have no server-side hook in the product create/update path (`extensionPoints.ts` lists only UI points), so they cannot gate visibility or block publication |
| Security | Client-side moderation can be bypassed by calling `/api/products` directly. Moderation must be enforced server-side |
| Where a plugin *could* help | (1) An **admin review-queue UI** as a `menu.main` plugin that reads `/api/moderation/queue`. Even so, a host page is simpler and uses the same auth. (2) **Pre-submit hints** for the author ("this description may break the rules"), which are advisory only. (3) Reusing the LiteLLM proxy (Presidio PII guardrails) pattern for LLM-based checks, which would still have to be called from the backend to be authoritative |
| Verdict | Not the place for the moderation model or the decision |

---

## 3. Comparison matrix (5 = best for this project)

| | A: in-proc + external API | B: in-proc model | C: outbox worker | D: microservice | E: plugin |
|---|---|---|---|---|---|
| Deployment simplicity | 5 | 4 | 4 | 2 | 3 |
| Heavy-dep isolation | 5 | 1 | 5 | 5 | 4 |
| Memory / scaling independence | 5 | 1 | 4 | 5 | 4 |
| Failure isolation | 4 | 1 | 5 | 4 | 3 |
| Latency (async OK) | 3 | 5 | 3 | 4 | 3 |
| Running cost at low volume | 4 | 3 | 4 | 2 | 4 |
| GDPR/data residency | 2 (unless EU endpoint) | 5 | 5 (self-host) / 2 (API) | 5 | n/a |
| Team overhead | 5 | 4 | 4 | 1 | 2 |
| Enforcement correctness | 5 | 5 | 5 | 5 | **1** |

Scores are a synthesis judgment. Confidence: Medium.

---

## 4. Concrete triggers to split moderation into its own microservice

Split when **one or more** of these is true and measured:
1. **GPU need**: you adopt a model that needs a GPU, such as an LLM guard (Llama Guard / ShieldGemma / Qwen3Guard) or a vision guard. A GPU box should serve only inference, scale separately, and possibly scale to zero.
2. **Sync latency SLO**: product wants *synchronous* pre-publish checks on the request path with batching across concurrent requests (TEI/BentoML/Ray Serve dynamic batching). The worker poll model cannot meet a sub-second SLO.
3. **Independent scaling or cost**: moderation volume or CPU dominates. For example, worker CPU stays above about 70%, or the backlog (`PENDING` age p95) grows beyond the target, for example 2 minutes, while the API is idle. Or model RAM forces larger API-tier boxes.
4. **Multiple consumers**: other services or plugins (Next.js plugins, a future mobile backend) need the same moderation capability over a stable API. At that point the model is a shared platform service (Newman: robustness and reuse).
5. **Release cadence or ownership**: model updates (re-calibration, shadow runs, A/B tests) happen far more often than backend releases, or a dedicated ML person owns them. This is Newman's team autonomy reason.
6. **Different runtime**: you need a non-Python or specialized runtime (Triton, vLLM, TEI Rust) or a different hardware or region, for example EU GPU only.
7. **Prerequisites in place**: CI/CD, monitoring and rapid provisioning exist (Fowler). Without them, do not split even if 1-6 apply. Use a managed endpoint instead.

Until then, the boundary is a module boundary: `app/moderation/` with its own models, service facade and outbox handlers, following the project's DDD facade convention. This keeps the later extraction mechanical. The outbox event becomes an HTTP call or a queue message.

---

## 5. Recommendation

1. **Do not build a separate microservice now.** The project is pre-production with a small team, a single FastAPI process, no CI/CD or hosting decision, and the minimal-implementation standard. This matches Fowler's MonolithFirst and MicroservicePrerequisites. Confidence: High.
2. **Build `app/moderation/` as a module inside the monolith.** It should contain:
   - status fields on product and photo;
   - an append-only `moderation_decisions` table;
   - ADMIN review-queue endpoints in the authorization matrix (copy the `/api/groups/moderation` precedent);
   - an appeal endpoint;
   - DSA-compliant rejection notifications through `app/notifications`;
   - outbox events `product.moderation_requested` / `photo.moderation_requested`, staged in the same commit as the write.
3. **Run inference asynchronously from the outbox.** The order of preference:
   - **MVP**: an external inference API (HF Inference Endpoint in an EU region, or a managed provider with a DPA). Call it from the outbox handler in the API process (Option A + async). This adds no ML deps and only a few lines of code.
   - **When cost, residency or volume justify self-hosting**: add a **separate worker container from the same codebase** (Option C) with CPU-only torch or ONNX, and/or a **TEI CPU sidecar** for the text classifier. Change the dispatcher so moderation event types are claimed only by the worker.
   - **Avoid Option B** (models inside the API process) except for a tiny ONNX text model.
   - **Avoid Option E** for enforcement.
4. **Keep a thin synchronous pre-check** (length, links, phone or email regex) on create/update for instant feedback. All ML runs async with `PENDING` → `APPROVED/NEEDS_REVIEW/REJECTED` states.
5. **Revisit the split** when any trigger in section 4 fires. The most likely first one is adopting a GPU LLM guard or vision guard.

Overall confidence in the recommendation: **High** for "no microservice now", **Medium** for the exact MVP hosting choice (it depends on hf-hosting cost and residency findings).
