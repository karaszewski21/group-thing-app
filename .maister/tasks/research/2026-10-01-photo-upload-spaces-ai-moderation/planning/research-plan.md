# Research Plan: Photo Upload to DO Spaces + Hugging Face AI Moderation

## 1. Research Overview

**Primary question**: How should product gallery photos be uploaded to DigitalOcean Spaces, how should item name, description and photos be moderated with Hugging Face models, and should moderation live in a separate microservice?

**Research type**: Mixed. It covers technical codebase integration, literature and vendor documentation, and an architecture decision.

### Sub-questions
1. **Upload (DO Spaces)**
   - 1a. What does the current gallery (`product_photos`, migration 0045, `/api/products/{id}/photos`, `ItemGalleryEditor.tsx`) look like, and what must change in the model, API and UI?
   - 1b. Should uploads use presigned PUT/POST straight from the browser, or proxy through FastAPI (`python-multipart` is already a dependency)? Which client library: boto3, aioboto3 or aiobotocore?
   - 1c. Bucket layout and object keys, public-read + CDN vs private + signed GET, CORS, size and MIME limits, content-length enforcement.
   - 1d. Image processing: resize, thumbnails, WebP, EXIF/GPS stripping. Where does it run (Pillow in a worker vs on the client)?
   - 1e. Orphan cleanup, delete semantics, local dev (MinIO in docker-compose), secrets/config in `app/config.py`, cost.
2. **Moderation models (Hugging Face)**
   - 2a. Polish text: toxicity/hate, spam/scam, PII. Compare Polish-specific models (HerBERT-based classifiers), multilingual toxicity models (XLM-R based) and small LLM guard models (Llama Guard, ShieldGemma, Qwen-based guards), plus licenses.
   - 2b. Images: NSFW, violence/gore, and possibly CSAM handling obligations. Compare ViT NSFW classifiers, Falconsai, CLIP-based approaches and vision guard models.
   - 2c. Known accuracy for Polish, false positive rates, and how to calibrate thresholds.
3. **Hosting/serving**
   - 3a. HF serverless Inference Providers vs dedicated Inference Endpoints vs self-hosted (transformers/ONNX Runtime/Optimum, TEI for classifiers) on DO droplets (CPU) or DO GPU droplets.
   - 3b. Latency (CPU vs GPU per text or image), monthly cost at pre-production scale, cold starts, and data residency (EU/GDPR).
4. **Workflow and architecture**
   - 4a. Sync (blocking on create/update) vs async (`pending` -> `approved`/`rejected`) through the existing outbox/APScheduler.
   - 4b. Separate microservice vs in-process module vs outbox-driven worker vs a Next.js plugin (like `ai-description`). Also: when to split later.
   - 4c. Human review queue (ADMIN, reuse the authorization matrix and the existing `/api/groups/moderation` pattern), audit trail, appeals, notifications to the owner, re-moderation on edit.

### Scope
- **In**: backend product/gallery/outbox/notifications/auth/config, frontend gallery editor, plugin pattern, DO Spaces S3 API, HF models and hosting, moderation workflow patterns.
- **Out**: implementation, non-DO storage vendors (only as a comparison), payments.
- **Constraints**: Python 3.12/FastAPI/async SQLAlchemy/PostgreSQL, React + TanStack Query, pre-production with a small team, Polish content, and the `minimal-implementation` standard (few dependencies, no speculative abstractions).

## 2. Methodology

- **Primary**: (1) Codebase analysis to establish the current state and integration seams. (2) Targeted web research on official DO, HF and model-card documentation. (3) Comparative trade-off analysis that ends in a recommendation.
- **Fallbacks**: If official pricing pages cannot be fetched, use DO/HF pricing docs and recent community benchmarks, and mark them as estimates. If no Polish-specific moderation model exists for a category, evaluate multilingual or LLM-guard alternatives and flag the risk.
- **Evidence rule**: Every model claim gives the HF model ID, license, base model, languages and the date checked. Every price gives its source URL and date.

### Analysis framework
- **Codebase**: components -> data flow (create item -> photos -> display) -> integration seams (outbox handler registry, scheduler, notifications, auth matrix, config).
- **Upload**: a decision matrix covering presigned vs proxy against security, complexity, bandwidth, validation ability and async compatibility.
- **Models**: a scoring table covering Polish support, task coverage, size/latency, license (commercial use), maintenance and accuracy evidence.
- **Hosting**: cost/latency/ops matrix for 3 traffic tiers (e.g. 100 / 1k / 10k items per month).
- **Architecture**: options scored on ops cost, deploy coupling, resource isolation (torch RAM/GPU vs API process), failure isolation, team size, and the triggers that would justify a split.

## 3. Research Phases

**Phase 1: Broad discovery**
- Map `app/product/*`, migration `0045_product_photos.py`, `tests/test_product_photo*.py`, frontend gallery files, `app/outbox/*`, `app/notifications/*`, `app/core/authorization_matrix.py`, `app/config.py`, `docker-compose.yml`, `.env.example`, `src/backend/Dockerfile`, and `plugins/ai-description`.
- Web: DO Spaces docs index, HF Hub model search (`text-classification` + Polish/multilingual toxicity; `image-classification` NSFW), HF Inference pricing pages.

**Phase 2: Targeted reading**
- Read the product photo model/schemas/service/router and the gallery editor to capture exact fields, limits and validation (URL-only today).
- Read the outbox registry/dispatcher/scheduler to learn how a handler is registered, retried and run. Can it host a `moderate_product` job?
- Read the ai-description plugin (BAML, LiteLLM proxy at localhost:4000, manifest extension points) to see the existing AI integration pattern.
- Read the DO Spaces presigned URL, CORS, CDN and limits docs. Read model cards for the shortlisted HF models.

**Phase 3: Deep dive**
- Design a candidate end-to-end flow: request upload URL -> browser PUT -> confirm endpoint -> outbox event -> process (thumbnail, EXIF strip) + moderate -> status update -> notification.
- Model status fields: `moderation_status` on product and photo, a reason, `moderated_at`, a `moderation_decisions` audit table. Define the public visibility rule (only approved items are shown publicly).
- Benchmark evidence, by literature not execution: CPU latency of a ~110M–560M param classifier and a ViT image classifier, and LLM guard models on GPU.

**Phase 4: Verification**
- Cross-check pricing and limits against at least 2 sources where possible. Confirm the licenses permit commercial use.
- Validate that the proposed design fits the standards (`models.md` BaseEntity/string enums, `migrations.md`, `security.md` matrix, `minimal-implementation.md`, frontend `data-fetching.md`).
- List open questions and unknowns explicitly.

## 4. Gathering Strategy

### Instances: 5

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase | Current gallery (model, migration 0045, API, schemas, tests, `ItemGallery*.tsx`, `api/products.ts`, `api/items.ts`), outbox/scheduler/registry, notifications, auth matrix + group-moderation precedent, `config.py`/`.env.example`/`docker-compose.yml`/Dockerfile, `ai-description` plugin (BAML + LiteLLM) and plugin SDKs, plus the relevant `.maister/docs` standards | Glob, Grep, Read | codebase |
| 2 | spaces-upload | DO Spaces S3 API: presigned PUT vs POST policy (content-length-range, content-type), boto3/aiobotocore against Spaces endpoints, CORS, CDN + custom domain, public-read vs private + signed GET, lifecycle rules, limits and pricing; image processing (Pillow/pyvips, EXIF strip, WebP thumbnails); MinIO for local dev; upload security (magic-byte check, max size, malware) | WebSearch, WebFetch | spaces-upload |
| 3 | hf-models | Model shortlist: Polish/multilingual text toxicity/hate/spam/PII (HerBERT-based, XLM-R toxicity, Detoxify multilingual, Llama Guard 3/4, ShieldGemma, Qwen3Guard, Polish NER for PII), and image NSFW/violence (ViT NSFW classifiers, Falconsai, CLIP zero-shot, vision guard models). For each: model ID, license, size, Polish evidence, accuracy/benchmarks, maintenance | WebSearch, WebFetch | hf-models |
| 4 | hf-hosting | Serving options and costs: HF Inference Providers (serverless), HF Inference Endpoints (CPU/GPU per-hour, scale-to-zero, EU regions), self-hosting with transformers/Optimum-ONNX/TEI on DO CPU droplets, DO GPU droplets or the DO GenAI platform; latency figures, cold starts, RAM/Docker image size, GDPR/data residency | WebSearch, WebFetch | hf-hosting |
| 5 | moderation-architecture | Workflow and architecture: sync vs async pre-/post-moderation, pending/approved/rejected state machines, human-in-the-loop review queues, thresholds/false positives, appeals, audit, DSA (EU Digital Services Act) notice and statement-of-reasons obligations; monolith module vs worker vs microservice trade-offs for small teams, and when to extract | WebSearch, WebFetch, Read | moderation-arch |

### Rationale
The codebase gets one gatherer because every integration seam (gallery, outbox, notifications, auth, config, plugins) lives in one repo and is tightly related. The external work splits into 4 separate domains (storage, model selection, serving/cost, workflow/architecture) that use different sources and do not overlap. Separating "which model" from "where to run it" keeps the model shortlist independent of the hosting cost analysis, and the synthesis step then combines them. No separate configuration gatherer is needed, because there are only a few config files and the codebase gatherer covers them.

## 5. Success Criteria
- A concrete recommended upload flow (sequence + endpoints), data model/migration changes, and bucket/CDN/CORS configuration for DO Spaces, including local dev and orphan cleanup.
- A shortlist of 2–4 HF text models (with Polish evidence) and 2–3 image models, with license, size and accuracy notes.
- A hosting recommendation with cost and latency estimates at 3 traffic tiers and an EU data-residency note.
- A clear answer on microservice vs module/worker, with trade-offs and explicit split triggers.
- A moderation workflow with states, human review, appeals, audit and notifications, mapped onto the existing outbox/notifications/auth.
- Every claim cites a file path or URL. Unknowns are listed.

## 6. Expected Outputs
- `analysis/findings/{codebase,spaces-upload,hf-models,hf-hosting,moderation-arch}-*.md`
- A synthesized research report in `outputs/` with recommendations, decision matrices, a proposed sequence diagram and a phased rollout (MVP -> later).
