# Codebase: backend writers, outbox, ONNX moderation, product/item paths, compose

## TL;DR
- There is **no separate moderation worker any more**. Bielik-Guard runs **inside the API process** (`OnnxTextClassifier`, 1 intra-op thread, via `asyncio.to_thread`), and the only outbox poller is an `asyncio` task in the API lifespan, polling every 60 s. "The outbox worker on VPS A" therefore means the API process itself.
- Item names live on **shared `products`**. `POST /api/products/resolve` reuses a product with the same name (case-insensitive) in the same category, and an item rename re-points `inventory_items.product_id`. A vector keyed by `product_id` is computed once per distinct product, and the existing synchronous `check_text(PRODUCT_NAME)` call sites are exactly where a product name is born.
- Want writes set `match_requested_at` in three places (create, matching-relevant edit, resume). The want vector has to be in place before the matcher claims that flag.
- `onnxruntime` (1.30.0 in uv.lock), `tokenizers` (0.23.2) and `numpy` already sit in the backend `ml` group. Models are exported to ONNX at image build time in a throwaway `models` stage (torch and optimum are never in runtime). The matcher has no ML dependencies.
- Measured Bielik-Guard 0.1B (fp32 ONNX) in the API: about 756 MB RSS per uvicorn process, a 479 MB model dir, 2.5 s load, 20–40 ms per check. These are the reference numbers for a second small model in the same process.

## Key Decisions
- (Inferred) Two writer options fit the code. (A) **Synchronous, in the write path**: next to `check_text`, both for products (create / resolve / rename) and for wants (create / edit), so the vector commits with the row. The flag-before-vector and window-lag problems then disappear. (B) **Outbox event** (`embeddings.requested`) handled by the API poller: it decouples latency, but it adds up to 60 s of lag and needs a re-trigger (`changed_at` / `match_requested_at`).

## Open Questions / Risks
- Option B handlers run in the same event loop as HTTP. ONNX calls must use `asyncio.to_thread`, or they block requests (the dispatcher awaits handlers inline, dispatcher.py:69-71).
- A second model in the API process adds RSS to the 0.75 GB already used. There are no compose memory limits (docker-compose.yml has none) and no documented VPS A size. Only VPS B's size (6 vCPU / 12 GB) was discussed (user memory `ai-microservice-decision`). VPS A sizing is a gap.
- The description is edited in place (`PATCH /api/products/{id}/description`, `PUT /api/products/{id}`). If the embedding input includes the description, those paths must re-embed. `changed_at` does not move for them.
- Writing a vector onto `wants` through the ORM bumps `updated_at` (the version column), so the seeker's concurrent edit would get a 409. A side table, or a raw update that leaves `updated_at` alone, avoids this.

---

## 1. Wants writes (`src/backend/app/wants/application/writes.py`)

### Finding: where `match_requested_at` is set
| Write | Line | Behaviour |
|---|---|---|
| `create_want` | writes.py:151-184, flag at :177 | `_check_texts` (contact info, then `moderation_acl.check_text` for WANT_NAME and WANT_NOTE) runs **before any DB statement** (writes.py:46-55, 159). Then insert, flush, `load_want`, commit. |
| `update_want` | writes.py:187-259, flag at :247 | Text checks on an unlocked read. Then lock `FOR NO KEY UPDATE`, compare `updated_at` (409 on change). If name, category, mode, locality or radius changed: delete all `WantMatch` rows, drop the unread bell, set the flag (writes.py:237-247). Note and notification switch changes do not re-match. |
| `resume_want` | writes.py:299-316, flag at :311 | Re-activates and flags. Matches are kept. |

- Implication: a want vector computed synchronously would slot in after `_check_texts` (same "no lock while the model runs" rule as the classifier, writes.py:202-205). It would be written in the same transaction as the flag, and only when the **name** changes (category, locality and similar fields do not change the vector).
- The docstring states "A deadlock or serialization failure rolls the write back and is answered with the shared 'try again' 409" (writes.py:1-6, 41-70).
- The want ORM has `updated_at` as `version_id_col` (`app/core/base_model.py:61-66`). The edit concurrency check compares it (writes.py:231-234). The matcher's CLEAR deliberately leaves it alone (requests.py:40).

**Confidence**: High.

## 2. Wants reads and API (`reads.py`, `schemas.py`, `router/wants.py`)
- `visible_matches(seeker, listed, *columns)` is the read-side visibility filter: a stored match whose item is still listed, `items_visible_to(seeker, ALL)`, and not the seeker's own (reads.py:55-73). Every tier reads through it, so a third tier is filtered automatically.
- Counts (`match_count`, `new_match_count`) are MATCH-only (reads.py:76-89). `matching` = `match_requested_at IS NOT NULL AND ACTIVE` (reads.py:151-153).
- `_cards_select(caller, want_id, tier, *columns)` is tier-parameterised (reads.py:210-250). `_suggestions_select` returns SUGGESTION rows ordered by score, `LIMIT SUGGESTIONS_LIMIT = 10` (reads.py:52, 266-272). A semantic list would be one more `_…_select` plus `list_…` (reads.py:350-363 pattern).
- Endpoints: `GET /api/wants/{id}/matches`, `GET /api/wants/{id}/suggestions` (router/wants.py:85-95). A semantic tier would be either a third endpoint or a `tier` query parameter on suggestions. Authorization goes through the existing login READ/EDIT matrix rows 66–67 (INDEX.md).
- Schemas: `WantSuggestionResponse` requires `missing_words: list[str]` (schemas.py:105-115). A semantic card has no missing words, so it needs its own response model, or a nullable field plus an optional similarity value.
- ORM: `WantMatchTier` has MATCH/SUGGESTION (models.py:163-168). `WantMatchSource` (FORWARD/SCAN) is in `source` String(10). The CHECK constraints are duplicated in `__table_args__` (models.py:176-186).

## 3. Bells handler (`src/backend/app/wants/application/bells_due.py`)
- `wants.bells_due` payload `{"pairs": [[want,item]...], "expiring": [...]}`. A pair gets a bell only while it is still stored as MATCH and passes `visible_matches` (bells_due.py:1-11, 41-60). Registered idempotently via `outbox_acl.register_handler` (bells_due.py:34-38). `outbox_acl` is the only `app.wants` module that imports `app.outbox` (infrastructure/outbox_acl.py:1-8).
- A bell-less semantic tier needs **no change** here. The matcher stages only MATCH pairs (window.py:174-175).

## 4. Product and item write paths (where a name is born or changed)

### Finding: products are shared and resolved by name; renames re-point the item
**Source**: `src/backend/app/product/service.py:147-213`, `product/router.py:104-117`, `src/frontend/src/hooks/useCreateItem.ts:45`, `src/frontend/src/hooks/useItemDetail.ts:154`, `src/backend/app/inventory/application/inventory_items.py:262-284`
```python
async def get_or_create_product_by_name(db, name, category_id) -> Product:
    """Resolves a freeform item name ... to an existing `Product` in the same
    `category_id` — matched case-insensitively — or creates a new one ..."""
    ...
    rules.ensure_no_contact_info(name)
    await check_text(TextField.PRODUCT_NAME, name)
    product = Product(name=name, description=None, ...)
```
- Creating an item in the UI calls `resolveProduct({name, category_id})` and then registers the item with that `product_id` (useCreateItem.ts:45, 63). Renaming in item detail resolves again (useItemDetail.ts:154), and `update_item` re-points `item.product_id` (inventory_items.py:273-275), which bumps the item's `updated_at` and so moves `matchable_listings.changed_at`.
- `create_product` (service.py:147-161) and `get_or_create_product_by_name` (service.py:184-213) are the only places a product name is created. Both already call `check_text(PRODUCT_NAME)` synchronously before `db.add`. These are the natural hooks for "compute embedding" (sync) or "stage an `embeddings.requested` outbox row" (async, via `outbox_service.append`, the same pattern as `_stage_photo_files_delete`, service.py:232-240).
- In-place changes: `update_product` (`PUT /api/products/{id}`, service.py:164-181) can change the name and category in place. `set_shared_description` (`PATCH /api/products/{id}/description`, product/router.py:176-184) changes the description. Neither moves `changed_at` (0099_wants.py:205-210). If the vector input is the name only, only `update_product` needs a re-embed. With the description, both do.
- `products.search_vector` is a GENERATED column with the name at weight A and the description at weight C (product/models.py:63-67), so the lexical matcher already "sees" the description in `search_vector`. But the word check uses weight A only (statements.py:106-111).
- `register_item` (inventory_items.py:43-96) does not create products. It takes a `product_id`, so nothing is needed there if vectors are per product.
- The Product ORM uses `Computed` for `search_vector`. A vector column on `products` would need a pgvector SQLAlchemy type (the `pgvector` Python package) or a `UserDefinedType`. A side table `product_embeddings(product_id PK/FK, model_id, embedding, updated_at)` written in raw SQL / Core keeps the Product model untouched (inference).

**Confidence**: High (code). The design implications are inference.

## 5. Outbox (`src/backend/app/outbox/*`)
**Source**: `dispatcher.py:20-88`, `registry.py:1-30`, `scheduler.py:1-36`, `service.py:1-38`, `app/main.py:132-141`
- `service.append(db, event_type=..., payload=...)` stages a row in the caller's transaction without committing (`src/backend/app/outbox/service.py:22-38`).
- `dispatch_pending` claims up to 50 PENDING rows `FOR UPDATE SKIP LOCKED` and runs every registered handler **inline** (`await handler(db, entry.payload)`). It commits per entry, retries up to `MAX_ATTEMPTS = 5`, then marks the row FAILED with one ERROR log. An event type with no handler is marked PROCESSED (dispatcher.py:44-88).
- `run_forever` sleeps `DEFAULT_INTERVAL_SECONDS = 60` between polls (scheduler.py:16, 21-36). It is started once in the lifespan: `_outbox_task = asyncio.create_task(outbox_scheduler.run_forever())` (main.py:135, lifespan at main.py:104). Handlers are registered at the same place: `notifications_outbox_listener.register()`, `storage_outbox_listener.register()`, `wants_bells_due.register()` (main.py:132-134).
- `event_types` / `exclude_event_types` exist "to split the outbox between pollers in different processes" (dispatcher.py:63-66). A dedicated embedding poller (for example a separate compose service running the backend image with only `embeddings.*`) is supported by the dispatcher API but not wired anywhere.
- Latency implication: an outbox-written vector arrives 0–60 s after commit, plus inference time, plus the next matcher window run (60 s).

## 6. ONNX moderation pattern (`src/backend/app/moderation/*`)
**Source**: `onnx_models.py:1-69`, `classifiers.py:1-16`, `text_guard.py:1-126`, `app/main.py` lifespan, `.maister/docs/project/architecture.md:84, 101, 124`
- Model directory `<MODERATION_MODELS_DIR>/text` (default `/models`, config.py:47) holds `model.onnx`, `model_id.txt`, `config.json` and `tokenizer.json` (onnx_models.py:1-12).
- Session: `ort.SessionOptions(); intra_op_num_threads = 1; providers=["CPUExecutionProvider"]` with the comment "Runs inside the API process, which shares its CPU with request handling" (onnx_models.py:27-33). Tokenizer from `tokenizers.Tokenizer.from_file`, truncation to 512 (onnx_models.py:24, 56-57). Feeds `input_ids`, `attention_mask` and optional `token_type_ids` (onnx_models.py:59-66). An embedding model needs the same feeds plus mean pooling and L2 normalisation in numpy (e5/mmlw style). The classifier code does a sigmoid instead, so the pooling step is new code.
- A protocol (`TextClassifier`) lets tests inject fakes, and the ML import happens only in the lifespan when `MODERATION_TEXT_ENABLED` is on (classifiers.py:1-16; text_guard.py:1-5, 164-173; main.py:125-130 "Imported here so the `ml` dependency group is needed only when enabled"). An `Embedder` protocol with `set_embedder()` / `get_embedder()` and a fake in tests would mirror this.
- Call: `await asyncio.wait_for(asyncio.to_thread(classifier.scores, normalized), INFERENCE_TIMEOUT_SECONDS=5.0)`. It fails closed with a 503 `ModerationUnavailable` (text_guard.py:102-105, 180-211). For embeddings, failing closed on a want or product write is probably wrong: matching is best-effort. A missing vector should degrade to lexical-only (inference).
- Settings (names only, presence not checked; never printed): `moderation_text_enabled`, `moderation_image_enabled`, `moderation_models_dir`, `moderation_text_reject_threshold` (config.py:44-49). `.env.example` lists `MODERATION_TEXT_ENABLED`, `MODERATION_TEXT_REJECT_THRESHOLD`, `MODERATION_MODELS_DIR`, `MODERATION_IMAGE_ENABLED` (names only). Compose sets `MODERATION_TEXT_ENABLED: "true"` (docker-compose.yml:43).
- Measured (reality check of the 2026-10-02 task, `.maister/tasks/development/2026-10-02-text-image-moderation-policy/verification/reality-check.md:34`): "Model loads in 2.5 s … 50 concurrent checks take 0.36 s (20–40 ms each). RSS is about 756 MB, model dir 479 MB." Architecture note: "Expect about +0.6–0.8 GB RSS per uvicorn process" (architecture.md:124). Prior research estimated int8 Bielik at about 0.13 GB and warned that DO-style shared vCPUs may lack VNNI (`.maister/tasks/research/2026-10-01-photo-upload-spaces-ai-moderation/outputs/research-report.md:241`). That report rated "models in the API process" as "acceptable only as a local-dev stop-gap … RAM multiplies per worker" (research-report.md:366). The current code nonetheless runs Bielik in the API (architecture.md:84).
- The photo worker was removed. "VPS A runs no photo worker" (architecture.md:101). The memory note `ai-microservice-decision` still says small models run "in the moderation outbox worker", which is outdated relative to the code. Today's pattern is the API process.

**Confidence**: High (code and measured reality check). The RSS of a second model is extrapolated.

## 7. Build, dependencies, compose
- Backend `pyproject.toml` group `ml = ["numpy>=2", "onnxruntime>=1.20", "tokenizers>=0.21"]` (src/backend/pyproject.toml:34-38). Locked `onnxruntime` 1.30.0 and `tokenizers` 0.23.2 (uv.lock:1100, 1619). No `pgvector` Python package.
- Dockerfile: the `models` stage installs `torch==2.7.1` (CPU) and `optimum-onnx[onnxruntime]==0.1.0`, then runs `optimum-cli export onnx --model speakleash/Bielik-Guard-0.1B-v1.1 --task text-classification /models/text` with an HF token build secret (src/backend/Dockerfile:19-35). The `runtime` stage copies `/models/text` (Dockerfile:52-63). An embedding model would be a second export (`--task feature-extraction` → `/models/embed`) in the same stage. If the model is not gated (e5 and mmlw are public), no token is needed for that step. `runtime-dev` has no model (Dockerfile:40-50).
- Compose: `postgres` uses `image: postgres:18` with volume `postgres_data:/var/lib/postgresql` (docker-compose.yml:2-16). The backend builds target `runtime` with secret `hf_token` and runs `alembic upgrade head && exec uvicorn …` (single process, docker-compose.yml:18-47). The matcher has no ports, only `DATABASE_URL`, and `restart: unless-stopped` (docker-compose.yml:55-64). **No `mem_limit`, `cpus` or `deploy` limits** on any service.
- Matcher: `dependencies = ["asyncpg==0.31.0"]`. Its dev group pins `alembic` and `sqlalchemy` only to run the backend migrations in tests (src/matcher/pyproject.toml). Its Dockerfile has no model (src/matcher/Dockerfile:3).
