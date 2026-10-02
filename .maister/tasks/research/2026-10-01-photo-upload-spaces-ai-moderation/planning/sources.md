# Research Sources

Repo root: `C:\Users\karas\Desktop\group-thing-app`. Every codebase path below was verified to exist.

## Codebase Sources

### Product gallery (backend)
- `src/backend/app/product/models.py` - Product + ProductPhoto entities (URL-only photos)
- `src/backend/app/product/schemas.py` - `AddProductPhotoRequest`, `ProductPhotoResponse`, `ReorderProductPhotosRequest`
- `src/backend/app/product/router.py` - `/api/products/{id}/photos` endpoints (line ~93+)
- `src/backend/app/product/service.py` - photo service logic
- `src/backend/alembic/versions/0045_product_photos.py` - current photo schema
- `src/backend/tests/test_product_photos.py`, `test_product_photo_model.py`, `test_product_description.py` - current behavior/limits
- `src/backend/app/circulation/application/item_details.py`, `src/backend/app/circulation/schemas.py` - photos in item detail read model

### Product gallery (frontend)
- `src/frontend/src/pages/product/ItemGallery.tsx`, `ItemGalleryEditor.tsx` - gallery display/editor
- `src/frontend/src/pages/product/ItemCreatePage.tsx`, `ItemEditPage.tsx`, `ItemDetailPage.tsx`
- `src/frontend/src/api/products.ts`, `src/frontend/src/api/items.ts` - API clients
- `src/frontend/src/hooks/useCreateItem.ts`, `useItemDetail.ts`, `useProducts.ts`
- `src/frontend/src/test/ItemCreatePage.test.tsx`, `ItemDetailPage.test.tsx`, `useItemDetail.test.tsx`

### Async jobs / events
- `src/backend/app/outbox/{models,service,registry,dispatcher,scheduler}.py` - transactional outbox + APScheduler
- `src/backend/app/groups/infrastructure/outbox_bridge.py` - example of a domain -> outbox bridge
- `src/backend/app/notifications/{models,service,outbox_listener,router}.py` - user notifications (to notify owners of a rejection)
- `src/backend/tests/test_outbox.py`, `test_notifications.py`
- `src/backend/app/main.py` - startup wiring (scheduler, routers)

### Auth / admin moderation precedent
- `src/backend/app/core/authorization_matrix.py`, `src/backend/app/core/auth_deps.py`, `src/backend/app/core/_auth/*`
- `src/backend/tests/test_groups_moderation.py` - existing ADMIN-only `/api/groups/moderation` list pattern

### AI / plugin integration pattern
- `plugins/ai-description/manifest.json` - `product.detail.tabs` extension point
- `plugins/ai-description/baml_src/{clients,main,generators}.baml` - BAML via LiteLLM proxy (localhost:4000, Presidio PII guardrails, Langfuse)
- `plugins/ai-description/src/` - plugin pages/domain
- `plugins/sdk.ts`, `plugins/server-sdk.ts`, `plugins/CLAUDE.md`
- `src/backend/app/plugin/{router,service}.py`

## Documentation Sources
- `.maister/docs/INDEX.md`
- `.maister/docs/project/tech-stack.md`, `.maister/docs/project/architecture.md`
- `.maister/docs/standards/backend/models.md` (BaseEntity, string enums), `migrations.md`, `security.md`, `api.md`, `queries.md`
- `.maister/docs/standards/global/minimal-implementation.md`, `conventions.md`, `error-handling.md`, `validation.md`
- `.maister/docs/standards/frontend/data-fetching.md`, `standards/testing/backend-testing.md`
- `docs/system-wypozyczalni-inventory-accounting.md` - domain context
- Prior research for conventions: `.maister/tasks/research/2026-09-23-termpage-state-machine/analysis/findings/codebase-conventions.md`

## Configuration Sources
- `src/backend/app/config.py` - pydantic-settings (where the Spaces/HF settings would go)
- `.env.example` (repo root)
- `docker-compose.yml` - postgres/backend/frontend services (candidate MinIO / moderation worker service)
- `src/backend/Dockerfile`, `src/backend/pyproject.toml` (current deps: fastapi, python-multipart, apscheduler, tenacity; no boto3/Pillow/torch)
- `plugins/ai-description/package.json`, `next.config.js`
- Note: the repo contains no DigitalOcean deployment config. The production deployment target is unknown and must be flagged.

## External Sources

### DigitalOcean Spaces
- https://docs.digitalocean.com/products/spaces/ (overview, limits, pricing)
- https://docs.digitalocean.com/products/spaces/how-to/use-aws-sdks/ (boto3 endpoint config)
- https://docs.digitalocean.com/products/spaces/how-to/configure-cors/
- https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/
- https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/ (presigned POST/PUT support, lifecycle)
- https://docs.digitalocean.com/products/spaces/details/pricing/
- boto3 `generate_presigned_url` / `generate_presigned_post` docs; aiobotocore / aioboto3 READMEs
- MinIO docker image docs (local dev)
- Pillow / pyvips docs (EXIF transpose/strip, WebP)

### Hugging Face models (verify on the model cards)
- HF Hub search: https://huggingface.co/models?pipeline_tag=text-classification&language=pl and `search=toxic`
- Polish: Polish toxicity/hate classifiers built on `allegro/herbert-*`, `sdadas/polish-roberta-*`; PolEval hate-speech datasets
- Multilingual: `textdetox/xlmr-large-toxicity-classifier`, `unitary/multilingual-toxic-xlm-roberta` (Detoxify)
- LLM guards: `meta-llama/Llama-Guard-3-1B` / `-8B`, `Llama-Guard-4-12B` (multimodal), `google/shieldgemma-2b`, `google/shieldgemma-2-4b-it` (image), `Qwen/Qwen3Guard-*`
- Images: `Falconsai/nsfw_image_detection`, other ViT/CLIP NSFW classifiers (e.g. `AdamCodd/vit-base-nsfw-detector`), `openai/clip-vit-*` zero-shot
- PII: Polish NER models; Microsoft Presidio (already used through LiteLLM in the plugin)

### Hugging Face serving
- https://huggingface.co/docs/inference-providers/ and pricing
- https://huggingface.co/docs/inference-endpoints/ and https://endpoints.huggingface.co/pricing
- https://huggingface.co/docs/text-embeddings-inference/ (TEI supports sequence-classification models)
- https://huggingface.co/docs/optimum/ (ONNX Runtime export, CPU quantization)
- DO GPU Droplets and DO GenAI Platform pricing pages

### Moderation workflow / architecture
- EU Digital Services Act (Regulation 2022/2065), Art. 16 (notice and action), Art. 17 (statement of reasons), Art. 20 (complaint handling)
- Public trust-and-safety writeups on pre-moderation vs post-moderation, human-in-the-loop review, threshold tuning
- Modular monolith vs microservices guidance (e.g. Martin Fowler "MonolithFirst", "Microservice Prerequisites")
- OpenAI / Google moderation API docs (comparison baseline only)
