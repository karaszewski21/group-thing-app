# Codebase: Plugin System and ai-description AI Integration, Relevant Standards, Gaps

## 1. Plugin system: what a plugin can and cannot do

### F1.1 Plugins are separately hosted web apps embedded as iframes through UI extension points
- The manifest is uploaded with `PUT /api/plugins/{pluginId}/manifest` and holds `name`, `version`, `url`, `description` and `extensionPoints` (`plugins/CLAUDE.md:113-130`).
- The extension point types are all UI: `menu.main` (full-page iframe), `product.detail.tabs` (iframe tab), `product.list.filters` (native filter driven by `pluginData`) and `product.detail.info` (inline iframe) (`plugins/CLAUDE.md:132-188`; constants in `src/frontend/src/plugins/extensionPoints.ts:2-4`).
- Product detail tabs render on the **admin** product page `/admin/products/:id` (`src/frontend/src/router.tsx:159`), not on the user item page `/product/:id` (`router.tsx:113`).
- **There are no server-side hooks, webhooks or event subscriptions** for plugins. The host never calls a plugin when a product or photo changes. The plugin router exposes only manifest, enabled, data and objects CRUD (`src/backend/app/plugin/router.py:45-190`, route list from grep).
- **Confidence**: High.

### F1.2 The server SDK acts with the end user's JWT and has no service identity
**Source**: `plugins/server-sdk.ts:50-70`. `createServerSDK(pluginId, hostBaseUrl?, request?)` forwards the incoming request's `Authorization` header to host calls (`:56-57`, `:66`). Host base URL is `HOST_BASE_URL` or `http://localhost:8080` (`:40`, `:55`). The available calls are `hostApp.getProducts/getProduct/fetch` and `thisPlugin.getData/setData/removeData/objects.*` (`:20-38`, `:81-143`).
- The plugin router grants `READ`/`EDIT` only and has no `mcp:*` bridge (`src/backend/app/plugin/router.py:1-9`, `:34-36`). A plugin therefore cannot run as a background moderator: it has no credentials of its own, no trigger, and cannot set a moderation status on host tables except through user-level endpoints.
- Side observation: `EntityId = Annotated[int | None, Query(alias="entityId")]` (`plugin/router.py:40`), while entity ids are UUIDs. Entity binding by product id may be broken (low relevance; unverified at runtime).
- **Confidence**: High (code) / Low (the EntityId bug impact).

### F1.3 The ai-description plugin uses BAML through a LiteLLM proxy (OpenAI-compatible) and is user-triggered
- `plugins/ai-description/manifest.json:1-14`: `url http://localhost:3003`, a single `product.detail.tabs` extension.
- `plugins/ai-description/baml_src/clients.baml:1-19`: `client<llm> LiteLlmProvider { provider openai; model "gpt-4o-mini"; api_key env.LITELLM_API_KEY; base_url "http://localhost:4000/v1" }`, wrapped in a `fallback` client. The comments say LiteLLM handles key management (keys in `litellm/.env`), **PII filtering via Presidio guardrails** and **Langfuse** observability.
- `baml_src/main.baml:1-31`: `GenerateProductDescription(productName, productDescription, customInformation?) -> ProductDescription {recommendation, targetCustomer, pros[], cons[]}`.
- `src/pages/api/generate.ts:23-76`: a Next.js API route that is POST-only, gets the product through the host SDK with the caller's JWT, calls BAML, and saves the result as plugin object `description` bound to `PRODUCT`.
- `package.json:5-18`: `next dev -p 3003`, `@boundaryml/baml ^0.220.0`, and `postinstall: baml-cli generate`. `.env.example:1-7` contains only `LITELLM_API_KEY`.
- **The LiteLLM proxy, Presidio and Langfuse are not in this repo**: there is no `litellm/` directory (`find` returned nothing) and no compose service (`docker-compose.yml:1-71`). The plugin apps are not in compose either (`.maister/docs/project/architecture.md:104`).
- **Confidence**: High.

### F1.4 Is a plugin a viable host for moderation? No, for enforcement. Possibly for reuse of the gateway.
Reasoning from F1.1–F1.3:
- **Against**: it has no event trigger (F1.1); it acts as the user, so a malicious user could skip calling it (F1.2); it lives in a separate Node process outside compose (F1.3); and moderation is a cross-cutting invariant that must hold for every entry point including `mcp:edit` clients (`codebase-auth-moderation-precedent.md` F1.4). That makes it a core/host concern, which fits `standards/global/validation.md:27-28` "Consistent Enforcement" across APIs and background jobs.
- **Reusable ideas**: an **OpenAI-compatible gateway** (LiteLLM) is already the house pattern for LLM calls. If an LLM-guard model (e.g. Llama Guard served by an OpenAI-compatible endpoint or HF Inference Providers) is chosen, the backend could call it through the same LiteLLM proxy and get key management, Presidio PII masking and Langfuse tracing. Caveat: Presidio masking **before** a PII-moderation call would hide exactly what is being checked. Classifier models (text-classification and image-classification pipelines) are not chat-completions and do not fit LiteLLM/BAML naturally.
- Also note: the owner-edited shared description is stored under `plugin_data["ai-description"]` (`src/backend/app/product/service.py:36-39`). The host core already reuses this plugin's namespace for a core feature, so the line between plugin and core is blurred.
- **Confidence**: Medium-high (an architectural judgement grounded in code facts).

## 2. Relevant standards (`.maister/docs/standards`)

| Standard | Rule relevant here | Citation |
|---|---|---|
| minimal-implementation | Build only what is called; no speculative abstractions, factories, strategies or adapters "for future extensibility". This argues against a pluggable `StorageBackend`/`ModerationProvider` interface unless two implementations are needed now. A MinIO-vs-Spaces difference is only an endpoint URL in config, so no abstraction is needed. | `.maister/docs/standards/global/minimal-implementation.md:3-16` |
| conventions | Config through env vars, never commit secrets; minimal dependencies with documented rationale; feature flags for incomplete features | `.maister/docs/standards/global/conventions.md:12-16`, `:24-25` |
| validation | Server-side always (client-side is only feedback); allowlists (MIME allowlist); consistent enforcement across forms, APIs and background jobs | `.maister/docs/standards/global/validation.md:3-28` |
| models | StrEnum stored as string (never ordinal); cross-module references via plain FK-id columns, no `relationship()`; JSONB via `postgresql.JSONB` | `.maister/docs/standards/backend/models.md:115-117`, `:140-150` |
| migrations | One logical change per revision; reversible `downgrade()`; schema separate from data migrations; naming `{pk,fk,uq,ix}_{table}_{cols}`; never edit an applied migration | `.maister/docs/standards/backend/migrations.md:5-30` |
| security | Add a matrix row first (order matters), then `require_any`; ownership checks in the service | `.maister/docs/standards/backend/security.md:25-32` |
| api | Plural nouns, ≤2-3 nesting levels, proper status codes. `/api/products/{id}/photos/{pid}/complete` is 3 levels. | `.maister/docs/standards/backend/api.md:12-22` |
| frontend data-fetching | TanStack Query hooks in `src/hooks/`; mutations await `invalidateQueries` on the prefix; server error messages passed through verbatim | `.maister/docs/standards/frontend/data-fetching.md:3-30` |

### F2.1 Standards and docs drift that will mislead an implementer
- **PK strategy**: `models.md`/`migrations.md` mandate an explicit Postgres `Sequence` and `BigInteger` PK (`models.md:60-111`, `migrations.md:14-15`). The actual `BaseEntity` uses a **UUID** PK with `uuid4` and a `gen_random_uuid()` fallback (`src/backend/app/core/base_model.py:41-56`), and migration 0045 uses UUID with no sequence (`0045_product_photos.py:35-39`). New tables should follow the code (UUID), not the stale standard.
- **Security doc** says the matrix lives in `auth_deps.py` and has 25 entries. It is actually `authorization_matrix.py` with about 60 rows (see the auth findings, F1.2). The doc also says "no automated test suite exists yet" (`security.md:68`), but `src/backend/tests/` has an extensive pytest suite (memory: test gate = `uv run pytest`).
- **Outbox interval**: docstrings say 30 s, but the code uses 60 s (`app/outbox/scheduler.py:1`, `:14`; `app/main.py:59`).
- `.env.example` carries stale `FOOTPRINT_*` vars (`.env.example:10-21`).
- **Confidence**: High.

## 3. Gaps and open questions (codebase perspective)

1. **No storage abstraction and no S3 client**: nothing uploads or stores files today. The S3 client, keys, bucket and CDN configuration are all new (`pyproject.toml:6-19`; grep found no `UploadFile`).
2. **No moderation state anywhere**: product, photo and description have no status, reason, decided-at or decided-by, and there is no decisions or audit table. The `/api/groups/moderation` precedent is only a read-only list (auth findings F2.1).
3. **Shared-catalog semantics**: a product name, description and gallery are shared across all owners. Who gets notified on rejection (all owners, or just the uploader)? Should a rejected product name block all items using it? The photo model has no `uploaded_by_user_id` (gallery findings F1.1, F1.4).
4. **Two description stores** (`Product.description` vs `plugin_data["ai-description"]["description"]`) mean two moderation hooks (gallery findings F1.3).
5. **Product names leak to PUBLIC pages and into stored notification texts**. A post-moderation hide must cover many read paths, and notifications are already rendered (auth findings F3.3).
6. **The outbox has no rollback on handler failure, locks are released after the first commit, it runs in the API event loop, and latency is about 60 s**. All four matter for moderation handlers (outbox findings F1.6).
7. **Notifications target `party_id`**, while the photo and owner data is `users.id`, so a user→party resolution is needed (outbox findings F2.2).
8. **nginx 1 MB body limit** blocks proxied uploads in docker/prod (config findings F3.3).
9. **The frontend client is JSON-only**. Uploads need a new helper (gallery findings F3.5).
10. **No deployment target**: DigitalOcean is the stated intent but has no config in the repo, so region (EU, e.g. `fra1`/`ams3`), CDN domain and secrets management are unknown (config findings F3.6).
11. **The LiteLLM gateway is external and undocumented in the repo**. Its availability in production is unknown (F1.3).
12. **Existing external-URL photos**: decide whether URL photos remain allowed alongside uploads (they would also need image moderation by fetching the URL server-side, an SSRF risk) or are dropped. Pre-prod status allows dropping them (memory: no backward-compat shims).
13. **Tests**: the backend uses TestContainers Postgres. A storage test strategy (MinIO container vs a stubbed client) and an inference stub are undefined.
