# Specification: Java/Spring Boot → Python/FastAPI Backend Migration

## Goal

Replace `src/backend/` (Java 25 / Spring Boot 4.0.5, ~114 files, unbuildable — no `pom.xml`, no config, no schema, no tests) with a Python 3.12+ / uv / FastAPI / SQLAlchemy 2.x / Alembic backend that preserves the REST API contract, both error-response envelopes, the JWT claim shape, and the full hand-built OAuth2 authorization server byte-for-byte, so `src/frontend/` and `plugins/` continue to work unmodified. This is a first-ever deployment (the Java backend was never built or run), so the only hard constraint is contract fidelity — not availability during cutover.

## Scope Boundaries

**In scope**: entire `src/backend/` replacement (routers, ORM models + Alembic migrations, JWT + OAuth2 server, category/product/plugin/footprint domain logic, audit pipeline, CSV export, SPA-fallback + health routes); `pyproject.toml` (uv), `Dockerfile`, `docker-compose.yml`, `.env.example`; updates to `.maister/docs/project/tech-stack.md`, `architecture.md`, and the six Java-specific docs under `.maister/docs/standards/backend/`.

**Out of scope**: `src/frontend/` (React/Vite — no code changes; only its dev-proxy target at `http://localhost:8080` must remain valid), `plugins/` (unchanged), automated test suite (clarification Q2 — ruff + mypy are the only quality gates), persisting OAuth2 code/token stores to a database, wiring a real emission-factor/product-attribute adapter (stubs stay stubs), fixing the PER_100G untyped-exception bug, adding pagination to any listing endpoint, live rollback/dual-run mechanics (none applicable — see `analysis/rollback-plan.md`).

## User Stories

As the **frontend SPA**, I want every `/api/**` route, response shape, and error envelope to behave identically to the current (never-deployed) Java backend, so that no frontend code needs to change.

As a **plugin app**, I want the JWT claim shape (`sub`, `permissions`/`scopes` flat array, `iat`, `exp`, HS256) and the plugin manifest/data/object endpoints to behave identically, so client-side JWT decoding and `createServerSDK` forwarding continue to work without modification.

As an **external MCP client**, I want the OAuth2 authorization server (DCR, authorize+PKCE, all three token grants, introspection, metadata) to expose identical wire behavior, so any existing integration continues to function.

As a **developer**, I want the new backend runnable via `docker-compose up` with Postgres 18, so the system can be deployed for the first time.

## Reusable Components

### Existing Code to Leverage (as the port specification, not literal reuse — no Python code exists anywhere in this repo)

Every Java file under `src/backend/` is the algorithm-for-algorithm source of truth for its Python equivalent. Nothing is copy-paste reusable across languages, but the following are called out because they are **framework-agnostic** and should be translated with minimal reinterpretation (translate the algorithm, not the intent):

| Java source | What to port |
|---|---|
| `src/backend/archetype/pricing/*.java` | Pure value objects / one interface — zero Spring dependency, direct 1:1 dataclass port |
| `src/backend/footprint/internal/*.java` | `BreakdownTreeBuilder`, `ComponentTreeRegistry`, `RoundingPolicy`, `BreakdownScaler` — direct algorithm port |
| `src/backend/footprint/spi/stub/*.java` | Hardcoded seed data (factor versions, product attributes) — port literal values as-is |
| `src/backend/core/security/SecurityConfiguration.java` | The authorization matrix — single source of truth for the FastAPI permission-dependency table |
| `src/backend/core/plugin/DbProductQueryService.java`, `DbPluginObjectQueryService.java` | The filter-DSL parsers — port regex/split/operator logic exactly, keep the two parsers separate (they have different split limits and error strings; do not unify them) |

### New Components Required

The entire Python codebase is new code, justified simply: **this is a full language/framework rewrite** (task-level requirement), not an incremental feature. There is no existing Python backend to extend. New infrastructure not present in the Java repo at all (schema/Alembic migrations, `pyproject.toml`, Dockerfile, docker-compose, `.env.example`) is greenfield because the Java side never had it either (confirmed in `analysis/current-state-analysis.md` — no build file, no Liquibase changelog, no application config).

## Target Project Layout

Replace `src/backend/` in place with a standard Python service layout (keeps the sibling relationship with `src/frontend/` and matches the existing repo convention of one `src/<component>/` per deployable):

```
src/backend/
├── pyproject.toml                 # uv-managed, pinned deps (see Dependencies)
├── uv.lock
├── Dockerfile                     # multi-stage: uv sync --frozen --no-dev → slim runtime
├── docker-compose.yml             # postgres:18 + this service
├── .env.example                   # documents every required env var (see Auth/Config)
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/                  # 0001_initial_schema.py reconstructs every table in one migration (see Database Schema)
└── app/
    ├── main.py                    # FastAPI() app, router includes, exception handler registration, SPA fallback mount
    ├── config.py                  # Pydantic Settings reading env vars (JWT_SECRET, CORS_ALLOWED_ORIGINS, FOOTPRINT_PROBLEM_BASE_URI, DATABASE_URL, footprint retry/executor tunables)
    ├── db.py                      # async_sessionmaker, AsyncSession dependency
    ├── core/
    │   ├── base_model.py          # declarative base + BaseEntity mixin (id, created_at, updated_at-as-version_id_col)
    │   ├── errors.py              # ErrorResponse model, EntityNotFoundException, BusinessConflictException, legacy exception handlers
    │   ├── security.py            # JwtTokenProvider equivalent (encode/decode, permissions/scopes fallback), password hashing (bcrypt direct)
    │   ├── auth_deps.py           # FastAPI dependencies: get_current_principal, require_any(*permissions) — mirrors SecurityConfiguration's matrix
    │   └── filter_dsl.py          # shared regex-validated jsonPath filter grammar primitives (operator allowlist, regex) reused by product + plugin_object query modules — NOT a shared parser (see Reusability), just shared constants/regex
    ├── oauth2/
    │   ├── models.py              # RegisteredClient ORM model (ARRAY columns)
    │   ├── stores.py              # in-memory dict + asyncio.Lock authorization-code and refresh-token stores + background cleanup tasks
    │   ├── errors.py              # OAuth2Error enum, OAuth2ErrorResponse model, single consolidated error→status mapper
    │   ├── client_auth.py         # OAuth2ClientAuthenticator equivalent
    │   ├── router.py              # /oauth2/register, /oauth2/authorize, /oauth2/token, /oauth2/introspect
    │   └── metadata_router.py     # /.well-known/oauth-authorization-server, /api/oauth2/client-info
    ├── auth/
    │   ├── models.py              # User ORM model, user_permissions association table, Permission enum
    │   └── router.py              # POST /api/auth/login
    ├── category/
    │   ├── models.py
    │   ├── schemas.py             # Pydantic request/response models
    │   ├── service.py
    │   └── router.py
    ├── product/
    │   ├── models.py
    │   ├── schemas.py
    │   ├── query_service.py       # SQLAlchemy Core dynamic filter/sort (jOOQ-equivalent)
    │   ├── service.py
    │   └── router.py
    ├── plugin/
    │   ├── models.py              # PluginDescriptor (string PK, own base), PluginObject (composite unique)
    │   ├── schemas.py
    │   ├── query_service.py       # plugin_object filter DSL (3-part, distinct from product's 4-part)
    │   ├── service.py             # PluginDescriptorService, PluginDataService (replace-at-key semantics), PluginObjectService
    │   └── router.py              # plugins, plugin objects, plugin data — 3 route groups
    ├── footprint/
    │   ├── archetype/             # pricing archetype port: component.py, calculator.py, applicability.py, validity.py, parameter_value.py, quantity_extractor.py
    │   ├── domain/                # BreakdownNode/Component discriminated unions, exception hierarchy
    │   ├── engine/                # breakdown_tree_builder.py, component_tree_registry.py, rounding_policy.py, breakdown_scaler.py
    │   ├── ports.py                # EmissionFactorPort / ProductAttributesPort protocols
    │   ├── stubs.py                # InMemoryEmissionFactorPort / InMemoryProductAttributesPort (ported seed data)
    │   ├── facade.py              # DefaultFootprintFacade equivalent
    │   ├── audit/
    │   │   ├── models.py          # FootprintAuditEntity
    │   │   ├── mapper.py
    │   │   └── task.py            # BackgroundTasks + tenacity retry + idempotent-duplicate handling
    │   ├── export/
    │   │   └── csv_flattener.py
    │   ├── errors.py              # RFC7807 ProblemDetail model + footprint-scoped exception handlers
    │   ├── schemas.py             # FootprintResponseDto and nested shapes
    │   └── router.py              # /api/products/{id}/footprint, /api/footprints/calculations/{id}/export
    └── system/
        └── router.py              # GET /api/health, SPA-fallback catch-all
```

Rationale: mirrors the Java package-per-domain-vertical structure (category/product/plugin/footprint/core/oauth2) so the module-by-module gap analysis in `target-state-plan.md` §3 maps directly onto directories; `footprint/` keeps its Java-side hexagonal seam (`archetype`≈`archetype.pricing`, `domain`+`engine`≈`internal`, `ports`/`stubs`≈`internal.ports`/`spi.stub`, `audit`≈`audit`, `export`≈`export`).

## Dependencies (`pyproject.toml`, uv-managed)

Pinned per `target-state-plan.md` §2 research (re-verify against actual latest at implementation time, do not treat these as frozen if newer patch releases exist):

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | `0.141.x` | Web framework |
| `uvicorn[standard]` | latest compatible | ASGI server (uvloop/httptools) |
| `sqlalchemy` | `2.0.44` | Async ORM + Core (dynamic queries) |
| `asyncpg` | `0.31.0` | Postgres async driver |
| `alembic` | `1.17.1` | Migrations |
| `pyjwt` | `>=2.13.0` | JWT encode/decode (not python-jose — unmaintained, per research) |
| `bcrypt` | latest | Direct `bcrypt.hashpw`/`checkpw` (not passlib) |
| `pydantic` | `v2` | Request/response validation, Settings |
| `pydantic-settings` | latest | Env-var config loading |
| `tenacity` | latest | Retry/backoff for footprint audit persistence |
| `ruff` (dev) | latest | Lint + format |
| `mypy` (dev) | latest | Static type checking (strict-ish; required for sealed-type-exhaustiveness substitute — see Domain Logic Spec) |

Deliberately not adopted: Celery/RabbitMQ (single background write path, unwarranted), `authlib` or any OAuth2 library runtime (hand-rolled server preserved 1:1 per clarification Q1 — a library swap would risk wire-format drift), `python-jose`, `passlib`.

## Database Schema Spec

One initial Alembic migration (`0001_initial_schema`) reconstructs the entire schema from JPA annotations — no prior migration exists to build on. All tables use Postgres; JSONB columns via `sqlalchemy.dialects.postgresql.JSONB`; array columns via `sqlalchemy.dialects.postgresql.ARRAY`.

### Shared base pattern (`BaseEntity` equivalent)

Applies to `categories`, `products`, `plugin_objects`, `footprint_audit_log`, `users`. Each table:
- `id BIGINT PRIMARY KEY` — Postgres `SEQUENCE` per table (`category_seq`, `product_seq`, `plugin_object_seq`, `footprint_audit_log_id_seq`, `user_seq`), `NEXTVAL`, no `IDENTITY`/`SERIAL` (matches Java's explicit-sequence, allocationSize=1 choice — batching irrelevant here, but keep the same generation strategy for schema-shape parity).
- `created_at TIMESTAMP NOT NULL` — set once at insert, never updated.
- `updated_at TIMESTAMP NOT NULL` — **also SQLAlchemy's `version_id_col`**, with a `version_id_generator` returning `datetime.utcnow()` on every UPDATE (preserves the Java `@Version`-as-timestamp dual-purpose exactly, per fixed decision #3 — do NOT split into separate audit-timestamp + integer version columns).

`PluginDescriptor` and `RegisteredClientEntity` do **not** use this shared base (different PK strategies — see below); model them as standalone mapped classes.

### `categories`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK, sequence `category_seq` |
| name | VARCHAR(100) | NOT NULL |
| description | VARCHAR(500) | nullable |
| created_at | TIMESTAMP | NOT NULL |
| updated_at | TIMESTAMP | NOT NULL, version_id_col |

### `products`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK, sequence `product_seq` |
| name | VARCHAR(255) | NOT NULL |
| description | VARCHAR(2000) | nullable |
| photo_url | VARCHAR(500) | nullable |
| price | NUMERIC(19,2) | NOT NULL |
| sku | VARCHAR(50) | NOT NULL (Java has no DB unique constraint on sku despite business-key equals/hashCode — do not add one; preserve absence) |
| category_id | BIGINT | **FK → categories.id, NOT NULL** — undeclared in Java DDL anywhere; must be explicit here (checklist item 1) |
| plugin_data | JSONB | nullable |
| created_at / updated_at | TIMESTAMP | as shared base |

### `users`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK, sequence `user_seq` |
| username | VARCHAR(50) | NOT NULL, **UNIQUE** (checklist item 5) |
| password_hash | VARCHAR(72) | NOT NULL |
| created_at / updated_at | TIMESTAMP | as shared base |

`user_permissions` association table (checklist item 6 — plain `Table(...)`, NOT a mapped class, matching JPA `@ElementCollection` semantics: child rows have no independent identity, always inserted/deleted alongside the parent):
| Column | Type | Constraints |
|---|---|---|
| user_id | BIGINT | FK → users.id |
| permission | VARCHAR | enum-as-text: `READ`, `EDIT`, `PLUGIN_MANAGEMENT` |

### `plugins` (PluginDescriptor — string PK, own base, no sequence)
| Column | Type | Constraints |
|---|---|---|
| id | VARCHAR(255) | PK (plugin-supplied slug, not generated) |
| name | VARCHAR(255) | NOT NULL |
| version | VARCHAR(50) | nullable |
| url | VARCHAR(500) | nullable |
| description | TEXT | nullable |
| enabled | BOOLEAN | NOT NULL, default `true` |
| manifest | JSONB | NOT NULL |
| created_at | TIMESTAMP | NOT NULL |
| updated_at | TIMESTAMP | NOT NULL, version_id_col |

### `plugin_objects`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK, sequence `plugin_object_seq` |
| plugin_id | VARCHAR(255) | NOT NULL |
| object_type | VARCHAR(255) | NOT NULL |
| object_id | VARCHAR(255) | NOT NULL |
| **UNIQUE(plugin_id, object_type, object_id)** | | composite unique constraint, no single-column uniqueness (checklist item 2) |
| data | JSONB | NOT NULL |
| entity_type | VARCHAR(50) | nullable, enum-as-text: `PRODUCT`, `CATEGORY` |
| entity_id | BIGINT | nullable, **no FK** — deliberate loose reference, do not add referential integrity |
| created_at / updated_at | TIMESTAMP | as shared base |

### `oauth2_registered_client`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| client_id | VARCHAR | **UNIQUE** (checklist item 3) |
| client_id_issued_at | TIMESTAMP | |
| client_secret | VARCHAR | nullable (public clients have none) |
| client_secret_expires_at | TIMESTAMP | nullable |
| client_name | VARCHAR | NOT NULL |
| client_authentication_methods | TEXT[] | Postgres native array |
| authorization_grant_types | TEXT[] | |
| redirect_uris | TEXT[] | |
| scopes | TEXT[] | |

### `footprint_audit_log`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK, sequence `footprint_audit_log_id_seq` |
| correlation_id | UUID | NOT NULL, **UNIQUE** — the idempotency key, load-bearing (checklist item 4) |
| comparison_group_id | UUID | nullable |
| product_id | VARCHAR(100) | NOT NULL |
| caller_id | VARCHAR(100) | nullable |
| requested_at | TIMESTAMP | NOT NULL |
| total_kg_co2 | NUMERIC(12,4) | NOT NULL |
| strictness | VARCHAR(16) | NOT NULL, enum-as-text: `STRICT`, `LENIENT` |
| normalisation | VARCHAR(16) | NOT NULL, enum-as-text: `TOTAL`, `PER_100G` |
| breakdown | JSONB | NOT NULL — stores the **full serialized `FootprintBreakdown`** object (fields: `root`, `total`, `factorVersions`, `rootWarnings`, `computedAt`, `correlationId` — note: no `parametersEcho` field; the CSV export's timestamp-extraction fallback chain depends on this, see Domain Logic Spec / CSV Export) |
| warnings | JSONB | NOT NULL |
| factor_versions | JSONB | NOT NULL |
| dry_run | BOOLEAN | NOT NULL |

### FK/constraint reconstruction checklist (must all be explicit in the migration — none exist as DDL anywhere in the Java repo)
1. `products.category_id → categories.id`, NOT NULL
2. `plugin_objects` composite unique `(plugin_id, object_type, object_id)`
3. `oauth2_registered_client.client_id` unique
4. `footprint_audit_log.correlation_id` unique
5. `users.username` unique
6. `user_permissions` association table (no ORM identity)

## API Route Spec

All routes below are `/api/**` unless noted. Every response model preserves exact field names/nesting from the Java DTOs (verified directly against source, not just summarized).

### Category (`/api/categories`)

| Method | Path | Request | Response | Status | Notes |
|---|---|---|---|---|---|
| GET | `/api/categories` | — | `list[CategoryResponse]` | 200 | Sorted `created_at DESC` always — no query params supported |
| GET | `/api/categories/{id}` | `id: int` path | `CategoryResponse` | 200 | 404 if missing |
| POST | `/api/categories` | `CreateCategoryRequest` | `CategoryResponse` | **201** | |
| PUT | `/api/categories/{id}` | `id: int` path, `UpdateCategoryRequest` | `CategoryResponse` | 200 | |
| DELETE | `/api/categories/{id}` | `id: int` path | — | **204** | 409 if category has products (DB FK violation → `CategoryHasProductsException`) |

`CategoryResponse`: `id: int, name: str, description: str|None, created_at: datetime, updated_at: datetime`.
`CreateCategoryRequest`/`UpdateCategoryRequest`: `name: str` (required, max 100), `description: str|None` (max 500, optional — no required check).

`CategoryHasProductsException` message (verbatim, preserve exactly): `"Category with id {categoryId} cannot be deleted because it has associated products"` → 409, `error: "Conflict"`.

Permission: GET → `READ` or `mcp:read`; POST/PUT/DELETE → `EDIT` or `mcp:edit`.

### Product (`/api/products`)

| Method | Path | Request | Response | Status | Notes |
|---|---|---|---|---|---|
| GET | `/api/products` | query: `category: int?`, `search: str?`, `sort: str?`, `pluginFilter: list[str]?` (repeatable) | `list[ProductResponse]` | 200 | See filter DSL below |
| GET | `/api/products/{id}` | `id: int` path | `ProductResponse` | 200 | JOIN-fetches category (avoid lazy-load) |
| POST | `/api/products` | `CreateProductRequest` | `ProductResponse` | **201** | 404 if `categoryId` doesn't exist |
| PUT | `/api/products/{id}` | `id: int` path, `UpdateProductRequest` | `ProductResponse` | 200 | Full replace (all fields), 404 if category missing |
| DELETE | `/api/products/{id}` | `id: int` path | — | **204** | Plain delete, no FK-violation handling (unlike category delete) |

`ProductResponse` — **nests a full `CategoryResponse`, never just `categoryId`**:
```
id: int, name: str, description: str|None, photo_url: str|None, price: Decimal,
sku: str, category: CategoryResponse, plugin_data: dict|None,
created_at: datetime, updated_at: datetime
```
`CreateProductRequest`/`UpdateProductRequest`:
```
name: str            required, max 255
description: str|None max 2000
photo_url: str|None   max 500, must match ^https?://.*  ("Photo URL must start with http:// or https://")
price: Decimal        required, > 0
sku: str              required, max 50
category_id: int      required
```

**Product listing filter DSL** (`DbProductQueryService.parseFilter` — port exactly, do not unify with plugin-object's variant):
- Sort whitelist: `{name, price, sku, createdAt}`; format `"{field},{direction}"`; unknown/blank field → silently falls back to default `created_at DESC` (no error); direction: ascending unless second part is exactly `"desc"` (case-insensitive).
- `search` (non-blank): case-insensitive substring match on `name`.
- `category`: exact match on `category_id`.
- `pluginFilter` (repeatable, each parsed independently): split on `:` with **limit 4** → `{pluginId}:{jsonPath}:{operator}:{value}`.
  - `< 3` parts → `"Invalid pluginFilter format. Expected: {pluginId}:{jsonPath}:{operator}:{value}"` (400, `IllegalArgumentException`-equivalent → legacy envelope)
  - `pluginId`/`jsonPath` must match `^[a-zA-Z0-9_.-]+$` else `"Invalid pluginId: must contain only alphanumeric characters, underscores, dots, or hyphens"` / `"Invalid jsonPath: ..."` (same wording, substitute noun)
  - operator must match `eq|gt|lt|exists|bool` else `"Unsupported operator: {op}. Supported: eq, gt, lt, exists, bool"`
  - value required unless `op == "exists"`, else `"Operator '{op}' requires a value"`
  - `eq`: string-equals on `plugin_data->'{pluginId}'->>'{jsonPath}'` (pluginId/jsonPath spliced as validated literal path expression; value always bound parameter)
  - `gt`/`lt`: cast extracted text to numeric, compare; non-numeric value → `"Value must be numeric for 'gt' operator: {val}"` (or `'lt'`)
  - `exists`: `jsonb_exists(plugin_data->{pluginId}, {jsonPath})`, both bound
  - `bool`: cast to boolean via `value.lower() == "true"`-equivalent, compare

Permission: GET → `READ` or `mcp:read`; POST/PUT/DELETE → `EDIT` or `mcp:edit`.

### Plugin descriptor (`/api/plugins`)

| Method | Path | Request | Response | Status | Notes |
|---|---|---|---|---|---|
| PUT | `/api/plugins/{pluginId}/manifest` | body: `dict` (manifest) | `PluginResponse` | 200 | Upsert; validates `pluginId` regex, manifest `name`/`url` |
| GET | `/api/plugins` | — | `list[PluginResponse]` | 200 | **Enabled-only** |
| GET | `/api/plugins/{pluginId}` | — | `PluginResponse` | 200 | Returns even if disabled (uses plain find, not `findEnabledOrThrow`) |
| DELETE | `/api/plugins/{pluginId}` | — | — | **204** | |
| PATCH | `/api/plugins/{pluginId}/enabled` | `SetEnabledRequest{enabled: bool}` | `PluginResponse` | 200 | |

Manifest upload validation (verbatim messages):
- `pluginId` must match `^[a-zA-Z0-9_-]+$` else `"pluginId must contain only alphanumeric characters, underscores, or hyphens"`
- `manifest["name"]` must be non-blank string else `"Manifest must contain a non-blank 'name' field"`
- if `manifest["url"]` present, must start with `http://`/`https://` else `"Manifest 'url' must be an HTTP(S) URL"`

`PluginResponse`: `id: str, name: str, version: str|None, url: str|None, description: str|None, enabled: bool, extension_points: list[dict]` (extracted from `manifest["extensionPoints"]` if a list, else `[]`).

`findEnabledOrThrow` semantics: disabled plugin → same 404 `EntityNotFoundException("Plugin", pluginId)` as nonexistent plugin — indistinguishable, preserve exactly. Applies to object/data operations below, not to plain `GET /api/plugins/{pluginId}`.

Permission: GET → `READ`; PUT manifest / PATCH enabled / DELETE → `PLUGIN_MANAGEMENT` (no `mcp:*` bridge on any plugin route).

### Plugin data (`/api/plugins/{pluginId}/products/{productId}/data`)

| Method | Status | Behavior |
|---|---|---|
| GET | 200 | Returns `product.plugin_data.get(pluginId, {})` — empty dict if `plugin_data` is null or key absent |
| PUT | 200 | **Confirmed REPLACE semantics** (fixed decision #5): copy existing `plugin_data` map, `map[pluginId] = data` (whole-blob overwrite at that key, no field-level merge within the plugin's data), save. Response = **the input `data` echoed back**, not the freshly-persisted state |
| DELETE | **204** | Removes `pluginId` key from copy of map if present; no-op if `plugin_data` already null |

All three: 404 if plugin missing/disabled (`findEnabledOrThrow`) or product missing (`EntityNotFoundException("Product", productId)`).

Permission: GET → `READ`; PUT/DELETE → `EDIT` (no `mcp:*` bridge).

### Plugin objects (`/api/plugins/{pluginId}/objects`)

| Method | Path | Params | Status | Notes |
|---|---|---|---|---|
| GET | `.../objects` | `entityType: str?`, `entityId: int?`, `filter: str?`, `limit: int = 1000` | 200 | Requires **both** `entityType` and `entityId` together, else `"Both entityType and entityId are required for cross-type listing"`. Effective limit = `min(limit, 1000)` |
| GET | `.../objects/{objectType}` | same params | 200 | `entityType`/`entityId` must be both-present-or-both-absent, else `"Both entityType and entityId must be provided together or both absent"` |
| GET | `.../objects/{objectType}/{objectId}` | — | 200 | `PluginObjectResponse`, 404 if missing |
| PUT | `.../objects/{objectType}/{objectId}` | query `entityType?`, `entityId?` + body `dict` (data) | 200 | Upsert, same both-or-neither validation |
| DELETE | `.../objects/{objectType}/{objectId}` | — | **204** | 404 if missing |

All operations: 404 if plugin missing/disabled first.

`PluginObjectResponse`: `id: int, plugin_id: str, object_type: str, object_id: str, data: dict, entity_type: str|None, entity_id: int|None, created_at: datetime, updated_at: datetime`.

**Plugin-object filter DSL** (`DbPluginObjectQueryService.parseFilter` — distinct from product's, do NOT unify):
- Single `filter` param (not repeatable). Split on `:` with **limit 3** → `{jsonPath}:{operator}:{value}` (no `pluginId` segment — already bound from path).
- `< 2` parts → `"Invalid filter format. Expected: {jsonPath}:{operator}:{value}"`
- Same `jsonPath` regex, same operator regex/allowlist, same numeric-parse error message wording as product's parser, but field expression is `data->>'{jsonPath}'` (single level — `data` column already scoped to one plugin's row) instead of `plugin_data->'{pluginId}'->>'{jsonPath}'`.
- `exists` → `jsonb_exists(data, {jsonPath})`.

Permission: GET → `READ`; PUT/DELETE → `EDIT` (no `mcp:*` bridge).

### Footprint (`/api/products/{productId}/footprint`)

`GET /api/products/{productId}/footprint`

Headers (all optional):
- `X-Correlation-Id` — parsed as UUID; malformed → `InvalidParametersException("X-Correlation-Id", value)`; absent/blank → `None`, facade generates `uuid4()`.
- `X-Caller-Id` — string; absent/blank → `"anonymous"`.
- `X-Comparison-Group` — parsed as UUID same as correlation id.

Query params:
| Param | Type | Default |
|---|---|---|
| `asOf` | datetime (ISO instant) | `now()` (resolved in the route handler) |
| `materialWeightKg` | Decimal | none; if present and `<= 0` → `InvalidParametersException("materialWeightKg", value)` |
| `supplierDistanceKm` | Decimal | none |
| `destinationDistanceKm` | Decimal | none |
| `lastMileDistanceKm` | Decimal | none |
| `storageDays` | int | `0` |
| `requiresRefrigeration` | bool | `false` |
| `unit` | enum `TOTAL`\|`PER_100G` | `TOTAL` |
| `strictness` | enum `STRICT`\|`LENIENT` | `STRICT` |
| `dryRun` | bool | `false` |

Invalid enum value for `unit`/`strictness` → `InvalidParametersException(param_name, value)` → 400 problem+json (mirrors Java's `MethodArgumentTypeMismatchException` wrapping).

Response (always 200): `FootprintResponseDto`:
```
correlation_id: UUID, comparison_group_id: UUID|None, computed_at: datetime,
total: Decimal, unit: "KG_CO2"|"KG_CO2_PER_100G",
parameters_echo: {product_id, material_weight_kg, supplier_distance_km, destination_distance_km,
                  last_mile_distance_km, storage_days: int, requires_refrigeration: bool,
                  timestamp: datetime}   # = the resolved asOf, NOT breakdown.computed_at
options: {strictness, normalisation, dry_run: bool},
breakdown: CompositeNode | LeafNode      # discriminated union, see Domain Logic Spec
```
`unit` = `"KG_CO2_PER_100G"` when `normalisation == PER_100G`, else `"KG_CO2"`.

Permission: `READ` or `mcp:read`.

`GET /api/footprints/calculations/{correlationId}/export?format=csv`
- `format` must equal `"csv"` else `InvalidParametersException("format", format)` (400, problem+json).
- Looks up audit row by `correlation_id`; missing → `EntityNotFoundException("FootprintAudit", correlationId)` → **404 via the legacy envelope** (this export controller's not-found path is NOT footprint-scoped in the Java source — `EntityNotFoundException` is handled by the global handler even here; preserve exactly, do not route it through problem+json).
- Response: `200`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="footprint-{correlationId}.csv"`. Replays the **previously stored** audit row — never recalculates.
- Exact 12-column header, in order: `correlation_id, computed_at, product_id, timestamp_param, component_path, component_id, kg_co2, scope, factor_value, factor_valid_from, factor_version_id, warnings`. See Domain Logic Spec for per-column formatting rules and the `MAX_LEAF_ROWS = 1000` cap.

Permission: `READ` or `mcp:read`.

### Auth (`/api/auth`)

`POST /api/auth/login` — public.
- Body: `{username: str, password: str}` (both required/non-blank).
- Success: `200 {"token": "..."}`. Permissions extracted from the authenticated principal (stripped of internal `PERMISSION_` prefix), passed to token generation.
- Invalid credentials: **manually constructed** `401` legacy `ErrorResponse` (`"Invalid username or password"`) — bypasses the generic exception-handler path entirely (preserve as an explicit branch, not a caught exception mapped generically). **Only the specific bad-credentials case gets this manual 401** — any other authentication failure (e.g. a disabled/locked-account condition, if ever introduced) is NOT special-cased in the Java source and would fall through to the catch-all 500 handler; do not silently broaden the 401 branch to cover other auth-failure types beyond what a straight port would produce.

### System

`GET /api/health` → public, `200 {"status": "UP"}`.

SPA fallback: any request whose path does **not** start with `/api/` or `/assets/` and is not a dot-containing (file-extension) path → serve `index.html` (client-side routing support). A `/api/**` or `/assets/**` 404 must remain a real 404, not fall back to `index.html`.

## Error-Handling Spec

Two envelopes coexist. Route each footprint-domain exception type through the RFC7807 handler; everything else (including every non-footprint route, and even `EntityNotFoundException`/`IllegalArgumentException` *raised from within* the footprint module, e.g. the export 404 and the PER_100G bug) through the legacy handler.

### Legacy envelope (everywhere except the 6 footprint-domain exception types)

```json
{"status": 404, "error": "Not Found", "message": "Product with id 42 not found", "fieldErrors": null, "timestamp": "2026-08-31T12:00:00"}
```
Field order: `status, error, message, fieldErrors, timestamp`. `fieldErrors` is `null` (serialized, not omitted) except on validation failures. `timestamp` = naive local datetime (no timezone), matching Java's `LocalDateTime.now()`.

Exception → status → `error` (exact reason-phrase string) → `message` mapping, in this priority order:

| Exception (or condition) | Status | `error` | `message` |
|---|---|---|---|
| `EntityNotFoundException` (`"{entityType} with id {id} not found"`) | 404 | `"Not Found"` | exception message |
| `BusinessConflictException` (subclasses build their own message) | 409 | `"Conflict"` | exception message |
| DB integrity/FK violation (e.g. category-has-products) | 409 | `"Conflict"` | `"Data integrity violation"` (fixed literal) |
| Request validation failure (Pydantic → adapt to this shape, not FastAPI's default `{"detail": [...]}`) | 400 | `"Bad Request"` | `"Validation failed"` (fixed) | `fieldErrors`: `{field: message}`, first message wins per field on duplicates |
| Access denied (authenticated but insufficient permission) | 403 | `"Forbidden"` | `"Access denied"` (fixed) |
| Generic value/argument error (Python equivalent of `IllegalArgumentException` — the filter-DSL errors, the PER_100G bug, the plugin-object both-or-neither checks, etc. all surface here) | 400 | `"Bad Request"` | exception message (echoed directly) |
| Unhandled exception (catch-all) | 500 | `"Internal Server Error"` | `"An unexpected error occurred"` (fixed; log full exception server-side, never leak it) |

**Auth entry-point bodies** (401/403 raised by the auth dependency itself, before any route runs) use this same envelope, hardcoded:
- 401: `{"status": 401, "error": "Unauthorized", "message": "Authentication required", "fieldErrors": null, "timestamp": ...}`
- 403: `{"status": 403, "error": "Forbidden", "message": "Access denied", "fieldErrors": null, "timestamp": ...}`

**Exception**: `GET /api/oauth2/client-info` on unknown `client_id` returns **404 with an empty body** — not this envelope. Preserve exactly (do not "fix" it into the standard shape).

### RFC7807 envelope (footprint-domain exceptions only — 5 typed exceptions + invalid-parameter-type-mismatch)

```json
{"type": "https://.../missing-factor", "title": "Missing emission factor", "status": 422, "detail": "No factor found for component raw-material at 2026-08-31T00:00:00Z", "instance": "/api/products/42/footprint", "code": "MISSING_FACTOR", "componentId": "raw-material", "timestamp": "2026-08-31T00:00:00Z"}
```
- `type` = `{FOOTPRINT_PROBLEM_BASE_URI env var, normalized to end with "/"} + kebab(code)` (e.g. `MISSING_FACTOR` → `missing-factor`).
- `instance` = **request path only** (no scheme/host — deliberate, avoids leaking topology behind a reverse proxy).
- `detail` = exception message.
- Every entry from the exception's `details()` dict becomes a ProblemDetail extension property, plus `"code"` = the exception's code.
- Media type: `application/problem+json`.

| Exception | `code()` | Status | `title` | Message format | `details()` |
|---|---|---|---|---|---|
| `MissingFactorException` | `MISSING_FACTOR` | 422 | `"Missing emission factor"` | `"No factor found for component {componentId} at {timestamp}"` | `{componentId, timestamp}` |
| `MissingProductAttributeException` | `MISSING_PRODUCT_ATTRIBUTE` | 422 | `"Missing product attribute"` | `"Missing attribute '{attribute}' on product {productId}"` | `{productId, attribute}` |
| `InvalidParametersException` | `INVALID_PARAMETERS` | 400 | `"Invalid parameters"` | `"Invalid parameter '{parameter}': {value}"` | `{parameter, value}` |
| `ApplicabilityResolutionException` | `APPLICABILITY_RESOLUTION_FAILED` | 422 | `"Applicability resolution failed"` | `"Applicability resolution failed for {componentId}: {reason}"` | `{componentId, reason}` |
| `FactorVersionOverlapException` | `FACTOR_VERSION_OVERLAP` | 409 | `"Factor version overlap"` | `"Factor versions overlap for component {componentId}"` | `{componentId, a: "{validFrom}/{validTo}", b: same}` |
| Invalid query-param type (unit/strictness enum mismatch etc.) | wrapped as `INVALID_PARAMETERS` | 400 | `"Invalid parameters"` | as above | `{parameter: field name, value: raw value}` |

**Critical exclusion, preserve exactly (fixed decision #1 — do not fix)**: `BreakdownScaler`'s PER_100G path raises a plain value error (`materialWeightKg` null/`<=0`) with message `"materialWeightKg must be positive for PER_100G normalisation"`. This is **not** one of the 5 typed exceptions above — it must surface through the **legacy envelope** (400, `error: "Bad Request"`, that exact message), not problem+json, even though every other footprint validation error uses problem+json. This asymmetry is a known bug in the current system; the migration preserves it byte-for-byte rather than "fixing" the envelope.

## Domain Logic Spec

### Pricing archetype (`archetype/pricing` → `app/footprint/archetype/`)

Direct 1:1 port, zero framework coupling on the Java side:
- `ComponentId(value: str)`, `CalculatorId(value: str)` — validate non-blank on construction (`"ComponentId value must not be blank"` / `"CalculatorId value must not be blank"`).
- `Component` — discriminated union `SimpleComponent | CompositeComponent`, tag field for exhaustiveness matching. `SimpleComponent(id, calculator_id, extractor: QuantityExtractor, applicability, scope: int)`. `CompositeComponent(id, child_ids: list[ComponentId], applicability)`.
- `Applicability` — `ALWAYS` (always active) | `REFRIGERATED_ONLY` (`context.requires_refrigeration`).
- `QuantityExtractor` — `Protocol` with `extract(context: ParameterValue) -> Decimal`.
- `ParameterValue(product_id, material_weight_kg, supplier_distance_km, destination_distance_km, last_mile_distance_km, storage_days: int, requires_refrigeration: bool)` — the 4 Decimal fields null-coalesce to `Decimal("0")`.
- `Calculator` — `Protocol` with `calculate(rate: Decimal, quantity: Decimal) -> Decimal`. Only implementation: `SimpleFixedCalculator` → `(rate * quantity).quantize(Decimal("0.0001"), ROUND_HALF_UP)` — used unconditionally regardless of a component's declared `calculator_id`.
- `ComponentVersion(component_id, factor_version_id: str, rate: Decimal, validity: Validity)`.
- `Validity(valid_from: datetime, valid_to: datetime)`: `covers(t)` = **half-open interval `[valid_from, valid_to)`**; `overlaps(a, b)`; `assert_non_overlapping(windows)` — pairwise O(n²) check, raises on first overlap with message `"Overlapping validity windows: {a} and {b}"`.

**Decimal discipline is correctness-critical**: every `BigDecimal` in the Java source maps to Python `decimal.Decimal`, never `float`. This applies throughout the engine below.

### Footprint calculation engine (`footprint/internal` → `app/footprint/engine/`)

- `RoundingPolicy.round(value)` = `value.quantize(Decimal("0.0001"), ROUND_HALF_UP)` — applied everywhere a kgCo2 value is produced or rescaled.
- `ComponentTreeRegistry` — hardcoded V1 tree, `ROOT_ID = "product-footprint"`. Port the exact leaf/composite structure and quantity formulas verbatim:
  - Leaves: `raw-material`(scope 3, ALWAYS, qty=`material_weight_kg`), `processing`(2, ALWAYS, qty=`material_weight_kg`), `supplier-to-warehouse`(3, ALWAYS, qty=`material_weight_kg * supplier_distance_km`), `warehouse-to-customer`(3, ALWAYS, qty=`material_weight_kg * destination_distance_km`), `last-mile`(3, ALWAYS, qty=`material_weight_kg * last_mile_distance_km`), `packaging`(3, ALWAYS, qty=`material_weight_kg`), `warehouse-refrigeration`(2, REFRIGERATED_ONLY, qty=`material_weight_kg * storage_days`), `transport-refrigeration`(3, REFRIGERATED_ONLY, qty=`material_weight_kg * (supplier_distance_km + destination_distance_km)`), `last-mile-cold-chain`(3, REFRIGERATED_ONLY, qty=`material_weight_kg * last_mile_distance_km`).
  - Composites: `materials`=[raw-material, processing] (ALWAYS); `transport`=[supplier-to-warehouse, warehouse-to-customer, last-mile] (ALWAYS); `cold-storage`=[warehouse-refrigeration, transport-refrigeration, last-mile-cold-chain] (REFRIGERATED_ONLY); root `product-footprint`=[materials, transport, packaging, cold-storage] (ALWAYS).
- `BreakdownTreeBuilder`: single shared calculator instance for all leaves. Skip (return `None`) any node whose `applicability.is_active(context)` is false. A composite with all children absent returns `None` itself (drops from tree — e.g. `cold-storage` vanishes entirely when not refrigerated). Leaf resolution: look up `emission_factor_port.version_at(leaf_id, as_of)`; if found, compute + round, no warnings; if absent and `strictness == STRICT` → raise `MissingFactorException(leaf_id, as_of)`; if absent and `strictness == LENIENT` → zero-value leaf with warning `("MISSING_FACTOR", "No emission factor for {leaf_id} at {as_of}", leaf_id)`, all factor fields `None`.
- `BreakdownScaler.scale(breakdown, normalisation, material_weight_kg)`: `TOTAL` → unchanged. `PER_100G` → validate `material_weight_kg` present and `> 0` (else the preserved-bug legacy-envelope error above); `scale_factor = Decimal("0.1") / material_weight_kg` (10-digit intermediate precision, `ROUND_HALF_UP`); recursively scale every **leaf's** kgCo2 by `scale_factor` and round; recompute each **composite's** kgCo2 as the sum of its already-scaled children (not by scaling the composite's original total directly — rounding error accumulates per-leaf, preserve this exact order of operations, do not "optimize" by scaling composites directly).
- `DefaultFootprintFacade`:
  - `with_defaults`: `strictness` → `STRICT` if absent, `normalisation` → `TOTAL` if absent, `correlation_id` → `uuid4()` if absent, `caller_id` → `"anonymous"` if absent; `dry_run` passed through.
  - `merge_with_product_attributes`: look up product attributes via the stub port; missing → `MissingProductAttributeException(product_id, "product")`. Each of the 4 numeric params falls back to the stored attribute **only if the incoming request param is `None`** (per-field override). `requires_refrigeration` is **OR'd** (`request.requires_refrigeration or attributes.requires_refrigeration`) — cannot be forced off by the request if the product's stored attribute says true.
  - `calculate_total`: applies defaults, merges attributes, builds the breakdown tree, computes root-level timestamp warnings (below), and — **unless `dry_run`** — schedules the audit-persistence background task.
  - `calculate_unit` (PER_100G path): calls `calculate_total` first (**this always produces and persists an audit event for the TOTAL calculation, even though the caller asked for PER_100G**, unless `dry_run` — preserve this, do not skip the TOTAL-audit step for unit-normalized requests), then re-merges attributes and applies `BreakdownScaler.scale(..., PER_100G, material_weight_kg)` to the already-computed total breakdown.
  - `timestamp_warnings(as_of)`: `as_of > now + 30 days` → warning `("FUTURE_TIMESTAMP", "asOf is more than 30 days in the future", ROOT_ID)`; `as_of < now - 3650 days` → warning `("ANCIENT_TIMESTAMP", "asOf is more than 10 years in the past", ROOT_ID)`. Independent checks, both attached to root.

### Ports/stubs — stay stubs (fixed decision #4)

`EmissionFactorPort.version_at(component_id, t) -> ComponentVersion | None`, `.factor_version_by_id(id) -> ComponentVersion | None`. `ProductAttributesPort.find_by_id(product_id) -> ProductAttributes | None`.

Port the exact hardcoded seed data 1:1: `raw-material` has two adjacent, non-overlapping validity windows (`2026-01-01T00:00:00Z`–`2026-06-01T00:00:00Z` @ rate `0.90`, then `2026-06-01T00:00:00Z`–`2027-01-01T00:00:00Z` @ rate `0.95`); every other leaf has one version spanning `2026-01-01`–`2027-01-01`. Assert non-overlapping validity per component at module load (mirrors Java's startup-time `assertNonOverlapping` call). Seed products: `OFB-330`, `CAW-042` (full explicit attribute sets) plus 14 electronics SKUs via a helper that always sets `destination_distance_km="500"`, `last_mile_distance_km="0"`, `requires_refrigeration=false`. Wiring a real adapter is explicitly out of scope — these remain the only implementations of the two port protocols.

### Audit pipeline (`footprint/audit` → `app/footprint/audit/`)

Replace Spring's `@Async` + `@TransactionalEventListener(AFTER_COMMIT)` + `@Retryable` with: schedule via FastAPI `BackgroundTasks.add_task(...)` at the end of the footprint route handler (post-response, and since the footprint request path itself performs no DB writes on the happy path — recalculation is stateless — "after response" is equivalent to "after commit" here; confirmed no other in-request commit needs sequencing against).

The background task: opens its **own new** `AsyncSession` (≈ `REQUIRES_NEW`), wrapped in `tenacity.retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2.0, min=0.2))` (defaults: 3 attempts, 200ms initial delay, 2.0 multiplier — matching the Java `@Retryable`/`@Backoff` SpEL fallback literals `app.footprint.audit.retry.{max-attempts:3, delay-ms:200, multiplier:2.0}`; make these three values configurable via env vars with these exact defaults). On `IntegrityError` from the unique `correlation_id` constraint: log at debug level and treat as **idempotent success** — do not retry, do not raise. On exhausted retries: log at error level and increment a counter analogous to Micrometer's `footprint.audit.failed`. `dry_run` requests are never scheduled for audit at all (checked before `add_task` is called, not inside the task).

`FootprintAuditEntity` mapping: convert the event's `requested_at` to a naive UTC datetime for storage (mirrors `LocalDateTime.ofInstant(..., ZoneOffset.UTC)`); serialize the **entire breakdown result object** (not just its `root` field) into the `breakdown` JSONB column — top-level keys are `root, total, factor_versions, root_warnings, computed_at, correlation_id` (no `parameters_echo` key at this level; see CSV export note below for the resulting fallback behavior). Warnings serialize to a list of dicts; `factor_versions` copies through as a list of strings.

### CSV export (`footprint/export` → `app/footprint/export/csv_flattener.py`)

`MAX_LEAF_ROWS = 1000` — raise `InvalidParametersException("breakdown.leafCount", row_count)` if the flattened row count would exceed this (V1's fixed tree yields at most 9 leaves in practice; this is a defensive cap, not a normal-path limit).

Per audit row: `correlation_id = str(row.correlation_id)`; `computed_at = str(row.requested_at)` (the **audit-log column**, default Python datetime string formatting to match Java's `LocalDateTime.toString()`); `product_id = row.product_id`; `timestamp_param` = 3-level fallback: `breakdown_json.get("parameters_echo", {}).get("timestamp")` → else `breakdown_json.get("computed_at")` → else `row.requested_at` (the first branch will typically miss in practice since the stored breakdown JSON has no `parameters_echo` key per the audit-mapper note above — preserve this fallback chain exactly regardless, do not "fix" it by pointing the first lookup at a key that actually exists, since that would be reinterpreting rather than porting).

Walk `breakdown_json["root"]`, building `component_path` as dot-joined child component IDs (root excluded, e.g. `materials.raw-material`); a node with no `children` list or an empty one is a leaf. Per-leaf row, exact 12-column order matching the CSV header:
1. `correlation_id` 2. `computed_at` 3. `product_id` 4. `timestamp_param` 5. `component_path` 6. `component_id` 7. `kg_co2` (format: to-Decimal, `quantize(Decimal("0.0001"), ROUND_HALF_UP)`, plain string; `0` if null) 8. `scope` (raw stringify, `""` if null) 9. `factor_value` (to-Decimal plain string if non-null else `""` — **no forced scale**, unlike `kg_co2`) 10. `factor_valid_from` (stringify) 11. `factor_version_id` (stringify) 12. `warnings` (`""` if null/empty; else JSON-serialize the list; on serialization failure, log a warning and use `""` — never raise).

## Auth/OAuth2 Spec

This is the highest-risk module (zero test coverage, external consumers of unverifiable liveness). Every behavior below is verified directly against the Java source (not just summarized) and must be preserved exactly.

### JWT (app-level)

- Signing key: **the configured `JWT_SECRET` env var is base64-decoded before use as HMAC key material** (`base64.b64decode(secret)` → HMAC-SHA256 key). Getting this decode step wrong silently breaks interop with any already-issued token if a real secret value is ever supplied.
- Standard login token claims, **in this exact order**: `sub` (username), `permissions` (list of strings), `iat`, `exp` (from `JWT_EXPIRATION_MS` env var, no default known — must be sourced from real deployment config before cutover; not recoverable from this repo). No `iss` claim on the standard login token.
- OAuth2-issued token claims, in this exact order: `iss` (issuer URL), `sub`, `scopes` (list of strings — **note: different claim name than the login token's `permissions`**), `iat`, `exp` (hardcoded 15 min / 900,000 ms, independent of `JWT_EXPIRATION_MS`), `aud` (only if an audience was passed — token-exchange grant sets `aud = issuer`, i.e. self-audience; auth-code/refresh-token grants pass no audience).
- Token-reading fallback (used by the request-auth dependency that populates the principal for every protected route): read `permissions` claim; **if absent, fall back to `scopes`**; if still absent, empty list. This unifies login-tokens and OAuth2-tokens through one code path. A second, narrower accessor (`get_permissions_from_token`-equivalent, if ported at all) reads only `permissions` with **no** scopes fallback — if such a helper is needed anywhere, do not silently give it the same fallback as the primary parser; the Java source deliberately has this asymmetry (only one call site needs the narrow behavior).
- `POST /api/auth/login`: on success, permissions = the authenticated principal's authorities with the internal `PERMISSION_` prefix stripped, passed to token generation; `200 {"token": "..."}`. On invalid credentials specifically: **hand-built** `401` legacy `ErrorResponse` (`"Invalid username or password"`) constructed directly in the route handler, not via a registered exception handler. Password check: `bcrypt.checkpw(password.encode(), stored_hash.encode())` against `users.password_hash`.

### Full authorization matrix (verbatim from `SecurityConfiguration`, in evaluation order — first match wins; reproduce order, don't just reproduce the set)

| # | Path pattern | Method | Required authority |
|---|---|---|---|
| 1 | `/.well-known/oauth-authorization-server` | GET | public |
| 2 | `/oauth2/register` | POST | public |
| 3 | `/oauth2/token` | POST | public |
| 4 | `/oauth2/introspect` | POST | public |
| 5 | `/api/oauth2/client-info` | GET | public |
| 6 | `/api/auth/login` | POST | public |
| 7 | `/api/health` | GET | public |
| 8 | `/assets/**` | any | public |
| 9 | `/`, `/index.html`, `/*.js`, `/*.css`, `/favicon.ico` | any | public |
| 10 | any path NOT starting with `/api/` | any | public (SPA catch-all) |
| 11 | `/api/categories/**` | GET | `READ` or `mcp:read` |
| 12 | `/api/products/**` | GET | `READ` or `mcp:read` |
| 13 | `/api/footprints/calculations/*/export` | GET | `READ` or `mcp:read` |
| 14 | `/api/plugins` | GET | `READ` |
| 15 | `/api/plugins/*` | GET | `READ` |
| 16 | `/api/plugins/*/objects/**` | GET | `READ` |
| 17 | `/api/plugins/*/products/*/data` | GET | `READ` |
| 18 | `/api/categories/**` | POST/PUT/DELETE | `EDIT` or `mcp:edit` |
| 19 | `/api/products/**` | POST/PUT/DELETE | `EDIT` or `mcp:edit` |
| 20 | `/api/plugins/*/objects/**` | PUT/DELETE | `EDIT` |
| 21 | `/api/plugins/*/products/*/data` | PUT/DELETE | `EDIT` |
| 22 | `/api/plugins/*/manifest` | PUT | `PLUGIN_MANAGEMENT` |
| 23 | `/api/plugins/*/enabled` | PATCH | `PLUGIN_MANAGEMENT` |
| 24 | `/api/plugins/*` | DELETE | `PLUGIN_MANAGEMENT` |
| 25 | anything else | any | authenticated (any valid token, no specific permission) |

**Do not collapse the asymmetries** — plugin routes deliberately lack the `mcp:*` bridge that category/product routes have; this is consistent across every plugin route in the source, not an oversight. Reproduce exactly; only change if the user explicitly asks to change behavior, not as a "cleanup."

Note: `/oauth2/authorize` (see below) is **not** in this permitAll list — it requires prior authentication via the standard JWT dependency (reads the already-authenticated principal), which is a separate mechanism from this permission matrix. `/oauth2/introspect` **is** in the permitAll list for the *permission matrix*, but the endpoint itself still requires OAuth2-client-credential authentication internally (Basic or POST body) — permitAll only exempts it from the *permission* check, not from client authentication.

Token extraction (used to populate the authenticated principal before the matrix is evaluated): `Authorization: Bearer <token>` header (case-sensitive `"Bearer "` prefix, 7 chars); if absent, fall back to a `_token` form/query parameter (supports the OAuth2 authorize endpoint's native form POST, which can't set a custom header). If neither present, request proceeds unauthenticated (matrix then denies unless the path is public).

Authorities are internally represented with a `PERMISSION_` prefix (e.g. `PERMISSION_READ`, `PERMISSION_mcp:read`) when mapped from JWT claims — this is an internal representation detail; the permission-checking dependency should encapsulate it so route code just declares e.g. `require_any("READ", "mcp:read")` without needing to know about the prefix.

### CORS / session / password policy

CORS: allowed origins from `CORS_ALLOWED_ORIGINS` env var (comma-separated origin patterns, default empty), methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`, all headers allowed, credentials allowed, applied to all paths. Session: stateless (no cookies). Password hashing: bcrypt (direct library calls, not passlib).

### OAuth2 authorization server — endpoint-by-endpoint (verbatim preserve-exactly constraints)

**`GET /.well-known/oauth-authorization-server`** → 200:
```json
{
  "issuer": "...", "authorization_endpoint": ".../oauth2/authorize", "token_endpoint": ".../oauth2/token",
  "registration_endpoint": ".../oauth2/register", "introspection_endpoint": ".../oauth2/introspect",
  "grant_types_supported": ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:token-exchange"],
  "response_types_supported": ["code"], "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic", "none"],
  "scopes_supported": ["mcp:read", "mcp:edit"]
}
```
Base-URL resolution: honor `X-Forwarded-Proto`/`X-Forwarded-Host`/`X-Forwarded-Port` request headers, overriding scheme/host/port; omit the port from the built URL when it's the scheme default (80/http, 443/https) or when `X-Forwarded-Proto` is set but no explicit forwarded port is given. This exact base-URL logic is reused (do not reimplement separately) by the token endpoint's `issuer` field and by the metadata endpoint.

**`GET /api/oauth2/client-info?client_id=...`** → `200 {"client_id", "client_name" (default "Unknown Application" if null), "scopes"}` if found; **`404` with an empty body** if not found — not the standard error envelope.

**`POST /oauth2/register`** (DCR) → public. Reads `client_name`, `redirect_uris`, `token_endpoint_auth_method`, `grant_types`, `scope`, `response_types`. `ALLOWED_SCOPES = ["mcp:read", "mcp:edit"]` (order matters as the default when `scope` omitted).

Validation (any failure → `invalid_client_metadata` → 400, exact messages):
- `client_name`: required, non-blank, ≤255 chars → `"client_name is required and cannot be empty"` / `"client_name cannot exceed 255 characters"`.
- `redirect_uris` — only enforced if `authorization_code` is among `grant_types`: required/non-empty → `"redirect_uris is required when using authorization_code grant type"`; no blank entries → `"redirect_uris cannot contain empty values"`; each must be `https://` or loopback (`http://localhost`, `http://127.0.0.1`, `http://[::1]`) → `"redirect_uri must be a valid HTTPS URL: {uri}"`; no `#` fragment → `"redirect_uri cannot contain fragments: {uri}"`.
- `scope`: if provided, split on whitespace and validate subset of `ALLOWED_SCOPES` → `"Unsupported scope: {scope}. Allowed scopes: [mcp:read, mcp:edit]"` (embed the Python list's bracketed repr to match Java's `List.toString()` format); if omitted, defaults to both scopes.
- `token_endpoint_auth_method`: default `"client_secret_post"`; accepts `client_secret_post`/`client_secret_basic`/`none`; else → `"token_endpoint_auth_method must be 'client_secret_post', 'client_secret_basic', or 'none'"`.
- `grant_types`: default `["authorization_code"]` if empty; each entry must be `authorization_code`/`refresh_token` else → `"Unsupported grant type: {grantType}"`.

Success: **201**, generate `client_id`/`client_secret` as random UUIDs; store secret bcrypt-hashed; return plaintext secret once:
```json
{"client_id": "...", "client_secret": "... (plaintext, one-time)", "client_name": "...", "client_id_issued_at": <epoch>, "redirect_uris": [...], "grant_types": [...], "response_types": ["code"], "scope": "...", "token_endpoint_auth_method": "...", "client_secret_expires_at": 0}
```
(`client_secret_expires_at: 0` = never expires, standard OIDC-DCR convention.)

**`POST /oauth2/authorize`** — requires prior JWT authentication (this endpoint is functionally protected, not public, despite not appearing in the permission matrix as such — see matrix note above). Params: `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `code_challenge`, `code_challenge_method`.

Validation order (each failure raises with an exact message, then gets mapped to an OAuth2 error code via substring matching — reproduce the **same substring-matching order**, since it determines which error code a given message maps to):
1. missing `client_id`/`redirect_uri`/`response_type` → `"Missing required parameters: client_id, redirect_uri, response_type"`
2. `response_type != "code"` → `"Unsupported response_type. Only 'code' is supported"`
3. unknown `client_id` → `"Invalid client_id"`
4. `redirect_uri` not registered for client → `"redirect_uri not registered for this client"`
5. requested scope (space-split) not subset of client's scopes → `"Scope not allowed for this client: {scope}"`
6. PKCE: public client (`token_endpoint_auth_method == "none"`) with no PKCE params → `"PKCE is required for public clients. Provide code_challenge and code_challenge_method parameters"`; partial PKCE → `"Both code_challenge and code_challenge_method must be provided when using PKCE"`; method not `S256` → `"Unsupported code_challenge_method. Only 'S256' is supported"`; length not 43–128 → `"Invalid code_challenge length. Must be 43-128 characters"`; charset not `^[A-Za-z0-9_-]+$` → `"Invalid code_challenge format. Must be base64url-encoded"`
7. not authenticated → `"User must be authenticated"`

**Error-message → OAuth2-error-code mapping** (substring match, evaluated **in this exact order** — first match wins):
```
"redirect_uri" in message           → invalid_request
"Scope not allowed" or "scope" in message → invalid_scope
"response_type" in message          → unsupported_response_type
"client_id" in message              → invalid_request
"PKCE" in message                   → invalid_request
"authenticated" in message          → unauthorized_client
(default)                           → invalid_request
```
(Note the ordering consequence: `"redirect_uri not registered for this client"` matches the first branch, `invalid_request`, even though it also loosely relates to client validation.)

Success: generate a 256-bit random authorization code (URL-safe base64, no padding), store `{client_id, redirect_uri, scope, code_challenge, code_challenge_method, username, permissions, created_at}` keyed by the code, 600-second TTL, single-use (consumed on redemption). Respond **302** with `Location: {redirect_uri}?code={code}` + `&state={state}` if `state` was provided and non-empty.

**`POST /oauth2/token`** — dispatch on `grant_type`:

*`authorization_code`* — params `code`, `client_id`, `redirect_uri`, `client_secret`:
1. missing `code` → `invalid_request`, `"Missing required parameter: code"`
2. missing `redirect_uri` → `invalid_request`, `"Missing required parameter: redirect_uri"`
3. code invalid/expired (consumed via single-use lookup) → `invalid_grant`, `"Authorization code is invalid or has expired"`
4. `client_id` mismatch (if provided) → same generic `invalid_grant` message (do not leak which check failed)
5. `redirect_uri` mismatch → same generic `invalid_grant` message
6. confidential client (not `none` auth method): missing secret → `invalid_client`, `"Client authentication required"`; wrong secret (bcrypt check) → `invalid_client`, `"Client authentication failed"`
7. PKCE was used at authorize time: verify `code_verifier` via `SHA256(code_verifier) == code_challenge` (base64url); failure → same generic `invalid_grant` message as step 3 (do not distinguish PKCE failure from expired-code in the response)
8. success: issue access token scoped to the **granted scope** (not the user's full permission set), issue a refresh token alongside it

*`refresh_token`* — param `refresh_token`:
1. missing → `invalid_request`, `"Missing required parameter: refresh_token"`
2. invalid/expired/already-consumed → `invalid_grant`, `"The provided refresh token is invalid, expired, or revoked"`
3. success: **rotate** — old token invalidated, new token issued atomically, reusing the original granted scope, 24h TTL

*`urn:ietf:params:oauth:grant-type:token-exchange`* (RFC 8693) — requires OAuth2 client authentication (Basic header or POST body):
1. no credentials → `invalid_client`, `"Client authentication required"`
2. auth fails → `invalid_client`, `"Client authentication failed"`
3. missing `subject_token` → `invalid_request`, `"Missing required parameter: subject_token"`
4. missing `subject_token_type` → `invalid_request`, `"Missing required parameter: subject_token_type"`
5. `subject_token_type != "urn:ietf:params:oauth:token-type:access_token"` → `invalid_request`, `"Unsupported subject_token_type: {value}"`
6. subject token invalid/unparseable → `invalid_grant`, `"Subject token is invalid or expired"`
7. scope mapping: **fixed table `{"mcp:read": "READ", "mcp:edit": "EDIT"}`** — map the requested `scope` param (if given) or else the subject token's own scopes/permissions through this table; unmapped entries are **silently dropped**, never an error; preserve insertion order.
8. issue new JWT: `aud = issuer` (self-audience), **no refresh token** (per RFC 8693 §2.2), `issued_token_type = "urn:ietf:params:oauth:token-type:access_token"`.

All three grants, on success: `Cache-Control: no-store`, `Pragma: no-cache`, `expires_in: 900` — **this is a hardcoded literal**, kept as its own constant separate from the 900,000ms token-expiration constant used to actually compute `exp` (they currently agree; do not silently derive one from the other, since the source doesn't).

Response bodies, exact field order:
```json
// authorization_code / refresh_token grants
{"access_token": "...", "token_type": "Bearer", "expires_in": 900, "refresh_token": "...", "scope": "..."}
// (scope field omitted entirely if null/empty)

// token-exchange grant
{"access_token": "...", "issued_token_type": "urn:ietf:params:oauth:token-type:access_token", "token_type": "Bearer", "expires_in": 900}
```

**`POST /oauth2/introspect`** (RFC 7662) — requires OAuth2 client auth (same as token-exchange). Then: missing/unparseable `token` → **200 `{"active": false}`** (this is a valid response per RFC 7662, not an error). Valid token → 200, exact key order:
```json
{"active": true, "sub": "...", "scope": "read write" /* only if scopes claim present+non-empty, space-joined */, "exp": 1234567890, "iat": 1234567890, "iss": "..." /* only if present */, "aud": "..." /* single string if exactly 1 audience entry, else array; only if present */, "token_type": "Bearer", "client_id": "..." /* the introspecting client's id, not necessarily the token's original issuing client */}
```

**Uniform OAuth2 error shape** for all of the above:
```json
{"error": "invalid_grant", "error_description": "The provided refresh token is invalid, expired, or revoked"}
```
(`error_uri` field always omitted, never present — not `null`, actually absent from the JSON.) Status mapping, **consolidate into a single function** (currently duplicated verbatim across 4 Java filter classes — safe cleanup since all 4 copies are identical):
```
invalid_client                → 401
unauthorized_client, access_denied → 403
server_error                  → 500
(everything else, incl. invalid_request, invalid_scope, unsupported_response_type,
 invalid_grant, unsupported_grant_type, invalid_client_metadata) → 400
```

### Persistence of OAuth2 code/token stores (fixed decision #2 — preserve as-is)

Authorization codes and refresh tokens live in an in-memory store (a plain `dict` guarded by an `asyncio.Lock`, or `TTLCache`-equivalent) — **not** persisted to Postgres or Redis. A background cleanup task sweeps expired-but-unconsumed entries (mirror the Java cadence: authorization codes every 5 minutes, TTL 600s; refresh tokens every 30 minutes, TTL 86400s). This means: a process restart invalidates all in-flight codes/tokens, and the service must run **single-process** for these guarantees to hold (do not deploy multiple uvicorn workers/replicas without first revisiting this — out of scope for this migration to fix, per fixed decision #2). Document this constraint in the Dockerfile/compose comments.

`oauth2_registered_client` table (durable, unlike the code/token stores) uses native Postgres `TEXT[]` array columns for `client_authentication_methods`, `authorization_grant_types`, `redirect_uris`, `scopes` — direct SQLAlchemy `ARRAY(String)` mapping, no JSON-encoding workaround needed.

## Standards Docs Update Spec

Brief per-file guidance — `maister:docs-operator` performs the actual edits during implementation; this is the content each file needs to end up describing.

- **`.maister/docs/project/tech-stack.md`**: Replace Java/Spring Boot/Maven content with Python 3.12+, uv, FastAPI 0.141.x, SQLAlchemy 2.0.44 (async) + asyncpg, Alembic, PyJWT, bcrypt, Pydantic v2, uvicorn, tenacity, ruff, mypy. Remove the "Architectural Decisions Pending" JPA-vs-JOOQ item (resolved: SQLAlchemy ORM + Core). Note Docker/docker-compose now exist (previously "not yet configured").
- **`.maister/docs/project/architecture.md`**: Replace the Spring Boot bootstrap description with the FastAPI `app/` layout from this spec's Target Project Layout section. Update "Database Layer" to reference Alembic instead of Liquibase. Update "Package Structure" to the `app/` tree above. Note the system is no longer "pre-alpha scaffolding" — it has real business logic (category/product/plugin/footprint verticals) and is runnable via docker-compose.
- **`standards/backend/models.md`**: Replace JPA `@MappedSuperclass`/`@Version`/`@SequenceGenerator` guidance with SQLAlchemy 2.0 `Mapped[...]`/`mapped_column`, the shared `BaseEntity` mixin pattern (id via `Sequence`, `created_at`, `updated_at` as `version_id_col` with a datetime `version_id_generator`), `EnumType.STRING`-equivalent (Python `Enum` + `sqlalchemy.Enum(..., native_enum=False)` or plain string columns), LAZY-by-default relationship loading (`lazy="selectin"`/`"raise"` guidance), business-key `__eq__`/`__hash__`, JSONB via `postgresql.JSONB`.
- **`standards/backend/jooq.md`**: Replace with SQLAlchemy Core dynamic-query guidance — when to use Core `select()` over ORM (the product/plugin-object filter-DSL case), bind-parameter discipline for user input, the regex-validate-then-splice pattern for JSON-path segments (never splice unvalidated user input), MULTISET-equivalent (subquery-as-JSON via `func.json_agg`) if ever needed.
- **`standards/backend/queries.md`**: Keep the general principles (parameterized queries, avoid N+1, index strategic columns), replace any JPA-specific phrasing with SQLAlchemy `AsyncSession`/`selectinload` equivalents.
- **`standards/backend/migrations.md`**: Replace Liquibase-specific guidance with Alembic (`alembic revision --autogenerate`, one logical change per revision, reversible `upgrade`/`downgrade`, naming convention).
- **`standards/backend/security.md`**: Replace `SecurityFilterChain`/`@PreAuthorize`-avoidance guidance with FastAPI dependency-based authorization (`Depends(require_any(...))`), the centralized authorization-matrix-as-code pattern (a single table/module, not scattered route decorators), PyJWT claim shape (`sub`, `permissions`, `iat`, `exp`), bcrypt direct usage, custom exception handlers replicating the legacy/RFC7807 envelopes for 401/403.
- **`standards/backend/plugin-auth.md`**: No consumer-side change needed (frontend/plugins unchanged) — update only the phrase "the host API" implementation detail if it currently implies Java-specific behavior; the client-side JWT decoding contract (flat `permissions` array, no signature verification) is unchanged and should be reconfirmed as still accurate post-migration.

## Migration Strategy Reference

Follow the phased internal execution plan from `target-state-plan.md` §4 (schema-first → auth/OAuth2 in isolation → category → product → plugin → footprint → manual contract verification → DevOps stand-up incrementally throughout). No dual-run or incremental live cutover is possible or planned (no running Java baseline exists) — delivery is effectively big-bang, but internal build/verification should still proceed in these phases to catch issues before that single delivery. See `analysis/rollback-plan.md` for why no live rollback path applies.

## Implementation Guidance

### Testing Approach

No automated test suite is in scope for this migration (clarification Q2). `ruff` and `mypy` (strict-ish) are the only quality gates — mypy strict mode is specifically required (not merely nice-to-have) for the footprint domain's discriminated-union exhaustiveness checking (`assert_never` + mypy), since Python has no compiler-enforced sealed-class exhaustiveness the way Java's sealed interfaces do, and there is no test suite to catch an unhandled case at runtime instead. If the implementation-planner introduces any manual verification scripts (throwaway, not a formal suite) per module before calling it "done," keep each to a focused spot-check against this spec's route/DTO/error tables — not a substitute for the deferred pytest suite.

### Standards Compliance

Apply `.maister/docs/standards/backend/models.md` (post-migration content, per Standards Docs Update Spec above) for every ORM model — SEQUENCE-based PKs except `PluginDescriptor` (string PK) and `RegisteredClientEntity` (UUID PK), `EnumType.STRING`-equivalent for all enums, LAZY relationship loading, business-key equality, JSONB via `postgresql.JSONB`. Apply the updated `jooq.md` content for the two filter-DSL query services (bind-parameter discipline, regex-validate-then-splice). Apply the updated `security.md` content for the auth/OAuth2 layer (centralized authorization table, not scattered per-route checks).

## Out of Scope

- Automated pytest/testcontainers-python suite (deferred; `standards/testing/backend-testing.md` remains the target strategy for whenever that follow-up happens).
- Persisting OAuth2 authorization-code/refresh-token stores to Postgres/Redis (preserved as in-memory, single-instance).
- Wiring a real emission-factor/product-attribute adapter (stubs stay stubs).
- Fixing the PER_100G untyped-exception-envelope bug.
- Adding pagination to any listing endpoint (absence preserved).
- Adding a `category_id`/plugin-object `entity_id` FK beyond what's explicitly listed in the reconstruction checklist (do not add referential integrity the Java source deliberately omits, e.g. `plugin_objects.entity_id`).
- Live rollback/dual-run mechanics, blue-green deployment, or traffic-splitting infrastructure (no applicable baseline — see `analysis/rollback-plan.md`).
- Determining real values for `JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `DATABASE_URL` (documented as required env vars; actual values supplied at deploy time, out of scope here).

## Success Criteria

- Every route in the API Route Spec responds with the exact status code, response shape, and (for errors) the correct envelope as specified.
- The full authorization matrix (25 entries) is enforced in the exact evaluation order given.
- All 4 OAuth2 endpoint families (register, authorize, token — 3 grant types, introspect) plus metadata/client-info behave per the endpoint-by-endpoint table, including the empty-body 404 on `client-info` and the substring-matching error-code order on `authorize`.
- The PER_100G untyped-exception bug surfaces via the legacy envelope, not problem+json (preserved, not fixed).
- `PluginDataService`-equivalent PUT replaces the whole blob at the `pluginId` key (confirmed replace semantics, not merge).
- The footprint engine produces byte-identical `kg_co2` values to the documented rounding/scaling order of operations (per-leaf PER_100G scaling before composite resummation, `Decimal`/`ROUND_HALF_UP` throughout, never `float`).
- `docker-compose up` brings up Postgres 18 + the FastAPI service listening on port `8080`, matching `src/frontend/vite.config.ts`'s dev-proxy target, with no code changes required in `src/frontend/` or `plugins/`.
- `ruff check` and `mypy` (strict-ish) both pass with zero errors on the new `app/` tree.
- All 8 documentation files listed in the Standards Docs Update Spec are updated to describe the Python stack, with no lingering Java-era claims.
