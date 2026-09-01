# Target State Plan: Java/Spring Boot → Python/FastAPI Migration

**Date**: 2026-08-31
**Task**: `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`
**Inputs**: `analysis/current-state-analysis.md`, `analysis/clarifications.md`, direct re-inspection of ~20 source-of-truth files in `src/backend/` (security, oauth2, error handling, entities, product query service, footprint web/audit/internal, plugin controllers)

---

## 1. Migration Classification

**Primary type: Code migration** (language + framework rewrite — Java 25/Spring Boot 4 → Python/FastAPI), same domain logic, same external contract.

**Secondary, unusually large component: Architecture-adjacent.** In a typical code migration, schema, build tooling, and deployment config already exist and are carried across with modification. Here they don't exist at all in-repo:

- No `pom.xml`/`build.gradle` — the Java app cannot currently be built.
- No Liquibase changelog — the schema exists only as an implication of JPA annotations (and, in one case — `products.category_id → categories.id` — as an implication of business logic that never appears as a declared FK anywhere in-repo).
- No `application.properties`/`.yml` — environment variables (`app.jwt.secret`, `app.cors.allowed-origins`, `app.footprint.problem-base-uri`, `app.footprint.audit.retry.*`) are referenced by `@Value` but never given real values in this repo.
- No Dockerfile, docker-compose, or CI.

This means roughly a third of this migration's work (schema authorship, config surface, containerization) is **greenfield creation using the Java code as the spec**, not "porting" in the normal sense. Do not budget it like a typical migration's "update the config" step — budget it like new infrastructure work gated by a reverse-engineering exercise.

**Do not classify this as a pure "architecture migration"** either — the actual request is a straight framework swap with an identical layered structure (routers/controllers → services/facades → ORM/query layer), not a topology change (no move to microservices, no hexagonal restructuring beyond what footprint already has). The two classifications coexist; treat them as two work streams sized independently in planning.

---

## 2. Target System Definition

| Concern | Choice | Rationale |
|---|---|---|
| Language | Python 3.12+ | Current stable line with full match-statement, typing, and asyncio maturity; matches "3.12+" guidance in task brief. |
| Project/dependency mgmt | **uv** | Fixed by task. |
| Web framework | **FastAPI** | Fixed by task. Async-first, Pydantic-native request/response validation, automatic OpenAPI — useful for the contract-first verification this migration needs. |
| ORM | **SQLAlchemy 2.x** (`AsyncSession`, `async_sessionmaker`, declarative `Mapped[...]`/`mapped_column` style) + **asyncpg** driver | Fixed by task (clarification Q3). 2026 ecosystem consensus is SQLAlchemy 2.0 async + asyncpg for FastAPI; sync SQLAlchemy would block the event loop and defeat FastAPI's concurrency model. |
| Dynamic/JSONB query layer (jOOQ-equivalent) | **SQLAlchemy Core** (`sqlalchemy.select()`, `text()`/`cast()`/`func` for `->`, `->>`, `jsonb_exists`) | Same engine, Core mode, mirrors jOOQ's "typed DSL, not raw string SQL" discipline: pluginId/jsonPath still regex-validated before being spliced into a path expression; only comparison *values* go in as bind parameters — this is the exact discipline already used by `DbProductQueryService.parseFilter`. |
| Migrations | **Alembic** | Fixed by task; only viable pairing with SQLAlchemy for schema-as-code. |
| JWT | **PyJWT ≥ 2.13.0** | Researched 2026-08-31: `python-jose` is unmaintained with vulnerable transitive dependencies; PyJWT is the actively maintained, narrower-surface choice and is what current FastAPI community guidance is converging on. Confirmed no JWE/multi-format need here — the current system only ever produces plain HS256 JWS, so PyJWT's narrower feature set is not a limitation. |
| Password hashing | **`bcrypt` library directly** (not passlib) | passlib is in maintenance mode with known incompatibilities against newer bcrypt versions; calling `bcrypt.hashpw`/`bcrypt.checkpw` directly is the currently-recommended path and is a straight swap for Spring's `BCryptPasswordEncoder` (same algorithm, cost factor configurable to match). |
| Validation / DTOs | **Pydantic v2** | FastAPI-native; `BaseModel` with `model_config = ConfigDict(...)` replaces Java DTO records; field validators replace `@Valid`/`jakarta.validation` annotations. |
| ASGI server | **uvicorn** (with `uvicorn[standard]` for uvloop/httptools) | Standard FastAPI production server. |
| RFC 7807 support | **FastAPI native `JSONResponse` + a small `ProblemDetail` Pydantic model** (no extra library needed) | The Java side hand-builds `ProblemDetail` too (`ProblemDetail.forStatusAndDetail` + `.setProperty`); a ~30-line Pydantic model with `type`/`title`/`status`/`detail`/`instance`/extension members reproduces this without adding a dependency. |
| Background/retry (footprint audit) | **FastAPI `BackgroundTasks`** for the fire-after-response semantics + **`tenacity`** for the retry/backoff policy | Matches the Java mechanism most directly: `@Async` → `BackgroundTasks` (or a dedicated asyncio task if true after-commit-only semantics are needed — see §3.4), `@Retryable(backoff=...)` → `tenacity.retry(stop=stop_after_attempt(3), wait=wait_exponential(...))`. Celery is unwarranted here — this is a single, focused audit-write; Celery would add a broker dependency for a workload this repo doesn't need. |
| Lint/type gates (code quality only, no test suite per clarification Q2) | **ruff** (lint + format, replaces the implicit-but-never-enforced Java style) + **mypy** (or `pyright`) in strict-ish mode | Not a testing tool — a static-analysis substitute for the compile-time checking Java gave for free, valuable specifically because there is no test suite to catch these classes of error. |
| Containerization | **Dockerfile** (multi-stage: `uv sync --frozen` build stage → slim runtime stage running uvicorn) + **docker-compose.yml** (`postgres:18` to match the current-state-analysis's confirmed PG version + the FastAPI service) | Fixed in-scope by clarification Q4; nothing to reconcile against since none exists today. |

**Deliberately not adopted**: Celery/RabbitMQ (over-engineered for one background write path), a full OAuth2 library (e.g. `authlib`) in place of the hand-rolled server — see §3.5 for why a library swap is a live design question, not a default.

**External research validation (2026-08-31, WebSearch)**: the two choices above that depend on current library-health facts (not fixed by the task) were independently checked rather than taken on training-data assumption:

- **PyJWT vs python-jose**: confirmed `python-jose` has had no release since 2021 and carries known unpatched vulnerabilities; FastAPI's own docs have since moved off recommending it in favor of PyJWT, which is actively maintained. This validates the table's choice above.
- **SQLAlchemy 2.x async + asyncpg**: confirmed as the current (as of Aug 2026) mainstream pairing for FastAPI — never run a blocking sync DB call inside `async def`, session lifecycle via a dependency-injected generator, connection pool sized from measured pool-wait time. Current stable versions in this ecosystem as of Aug 2026: FastAPI 0.141.x, SQLAlchemy 2.0.44, asyncpg 0.31.0, Alembic 1.17.1, PostgreSQL 18.3 — useful as starting pins for `pyproject.toml`, to be re-checked against actual latest at implementation time rather than hardcoded from this document verbatim.

Sources:

- [Time to Abandon `Python-Jose` Recommendation in Favour of Supported Packages? · fastapi/fastapi Discussion #11345](https://github.com/fastapi/fastapi/discussions/11345)
- [Why `python-jose` is still recommended in the documentation when it is nearly abandoned · fastapi/fastapi Discussion #9587](https://github.com/fastapi/fastapi/discussions/9587)
- [Building High-Performance Async APIs with FastAPI, SQLAlchemy 2.0, and Asyncpg](https://leapcell.io/blog/building-high-performance-async-apis-with-fastapi-sqlalchemy-2-0-and-asyncpg)
- [How to Use Async Database Connections in FastAPI](https://oneuptime.com/blog/post/2026-02-02-fastapi-async-database/view)

---

## 3. Gap Analysis by Module

### 3.1 Category (lowest risk — reference module for the pattern)

| What exists (Java) | Gap → Python target | Translation approach | Risk/ambiguity |
|---|---|---|---|
| `Category extends BaseEntity` (`id`, `createdAt`, `@Version updatedAt`; `name` varchar(100) not-null, `description` varchar(500)); business-key `equals`/`hashCode` on `name` | SQLAlchemy `Category` model, same columns | Standard `Mapped[int]` PK via `IDENTITY`/`SEQUENCE` (see §3.6 for the shared base-entity pattern); `__eq__`/`__hash__` overridden on `name` to match Java's business-key semantics (matters wherever the ORM relies on set/dict membership) | None — this is the reference/template module the rest should mirror. |
| `CategoryController`: `GET /api/categories`, `GET /api/categories/{id}`, `POST /api/categories` (201), `PUT /api/categories/{id}`, `DELETE /api/categories/{id}` (204) | Identical FastAPI router, same status codes | `@router.get("", response_model=list[CategoryResponse])`, etc.; `status_code=201`/`204` explicit since FastAPI defaults to 200 | None. |
| `CategoryHasProductsException` → 409 via `BusinessConflictException` | Same conflict semantics | Custom exception + handler (see §3.6 error handling) | None. |

### 3.2 Product

| What exists (Java) | Gap → Python target | Translation approach | Risk/ambiguity |
|---|---|---|---|
| `Product extends BaseEntity`: `name`(255,NN), `description`(2000), `photoUrl`(500), `price` NUMERIC(19,2) NN, `sku`(50,NN), `category` `@ManyToOne(LAZY)` FK NN, `pluginData` JSONB (`Map<String,Object>`, nullable); business key on `sku` | SQLAlchemy model with `Numeric(19,2)`, `ForeignKey("categories.id")`, `JSONB` column type (`sqlalchemy.dialects.postgresql.JSONB`) | 1:1 field mapping; `lazy="select"` (or `"raise"` to force explicit loading, matching JPA's LAZY-by-default discipline documented in project standards) on the category relationship | The `category_id → categories.id` FK is **never declared anywhere in the current repo** (no Liquibase, no explicit `@ForeignKey` DDL beyond the JPA `@JoinColumn` annotation) yet `CategoryHasProductsException` relies on it existing at the DB level. **Must explicitly declare this FK in the first Alembic migration** — flagged as a design decision already, not new, but re-flagging because it's easy to silently drop during a rewrite since there's no migration file to copy from. |
| `CreateProductRequest`/`UpdateProductRequest`/`ProductResponse` (records) | Pydantic models | 1:1 field-for-field; note `ProductResponse` nests a full `CategoryResponse`, not just `categoryId` — preserve the nested shape exactly, frontend likely destructures `product.category.name` | Low — must diff exact field names/nesting against `src/frontend/src/api/*.ts` before finalizing, since this is exactly the kind of shape drift that silently breaks a "contract preserved" migration. |
| `DbProductQueryService` (jOOQ): category filter, case-insensitive `LIKE`, whitelist sort (`name,price,sku,createdAt` × asc/desc, default `createdAt desc`), repeatable `pluginFilter={pluginId}:{jsonPath}:{operator}:{value}` (`eq`,`gt`,`lt`,`exists`,`bool`) parsed via regex-validated split-on-`:` (max 4 parts) then spliced as a **literal JSON path expression string** (`plugin_data->'<pluginId>'->>'<jsonPath>'`) with **only the comparison value bound** | SQLAlchemy Core `select()` over a Core `Table`/ORM-mapped class; same regex validation (`^[a-zA-Z0-9_.-]+$` for pluginId/jsonPath, operator allowlist) executed in Python *before* building the `func.jsonb_extract_path_text`/`.op("->")`/`.op("->>")()` expression; comparison values passed as SQLAlchemy bound parameters exactly as jOOQ does | **This is the single highest-precision port in the whole product module** — get the operator semantics (`gt`/`lt` cast to `Double`, `exists` via `jsonb_exists(plugin_data->pluginId, jsonPath)`, `bool` cast to boolean) and the exact error strings (`"Invalid pluginFilter format. Expected: {pluginId}:{jsonPath}:{operator}:{value}"`, etc. — these surface to API consumers as the `message` field of `ErrorResponse`) bit-for-bit. Recommend a dedicated pure-function unit-style spot-check (even though full pytest is out of scope, a throwaway verification script comparing filter strings against expected SQL is cheap insurance) given zero test oracle exists. |
| No pagination anywhere | Same — preserve absence of pagination | Do not add `limit`/`offset` unless separately requested; adding pagination would itself be a contract change | Flag if it comes up in spec: pagination is *not* part of this migration's scope even though its absence is a known scaling risk in the current system. |

### 3.3 Plugin System (descriptor / data / object)

| What exists (Java) | Gap → Python target | Translation approach | Risk/ambiguity |
|---|---|---|---|
| `PluginDescriptor`: `id` (String PK, not sequence-generated — plugin-supplied slug), `name`, `version`, `url`, `description` TEXT, `enabled` boolean default true, `manifest` JSONB NN, `createdAt`/`@Version updatedAt` | SQLAlchemy model with **string PK** (breaks from the shared `BaseEntity`/sequence pattern — this entity does *not* extend the sequence-generated base) | Model this as its own mapped class, not inheriting the shared base-entity mixin used elsewhere — the ID strategy genuinely differs and forcing it into the common pattern would be wrong | Low, but call it out explicitly in the ORM base-class design so it isn't "fixed" into conformity by mistake during the rewrite. |
| `PluginController`: `PUT /api/plugins/{pluginId}/manifest`, `GET /api/plugins` (enabled-only), `GET /api/plugins/{pluginId}`, `DELETE /api/plugins/{pluginId}` (204), `PATCH /api/plugins/{pluginId}/enabled` | Identical FastAPI router | 1:1 | None. |
| `PluginDataController` (`/api/plugins/{pluginId}/products/{productId}/data`): `GET`/`PUT`(copy-on-write merge into `products.plugin_data`)/`DELETE`(204) | Identical, with the same copy-on-write merge semantics (read current dict, shallow-merge keys under `pluginId`, write back) | Preserve merge (not replace) semantics on PUT — verify this against `PluginDataService.setData` before implementing, since "PUT" _sounds_ like full replace but the current behavior appears additive/merge-based | **Confirm exact current merge behavior in the service layer during spec phase** — this is a plausible silent behavior-change point if the Python implementer assumes REST-standard PUT-replaces-whole-resource semantics. |
| `PluginObject`: composite unique key (`plugin_id`,`object_type`,`object_id`), `data` JSONB NN, optional loose `entityType`(enum)/`entityId` (**no FK** — deliberately loose reference to avoid coupling plugin objects to specific entity tables) | SQLAlchemy model with `UniqueConstraint`, and explicitly **no** `ForeignKey` on `entity_id` — this looseness is intentional, not an oversight, do not "fix" it by adding referential integrity during the port | 1:1, `Enum` type for `entityType` matching the Java enum values | Note for spec: preserve the *absence* of the FK — this is one of the few places the current design deliberately trades integrity for plugin decoupling; a well-meaning "improvement" here would be an undocumented behavior/constraint change. |
| `PluginObjectController`: cross-type listing (`GET /api/plugins/{pluginId}/objects?entityType=&entityId=` — requires both together), per-type listing (`GET .../objects/{objectType}` — entityType/entityId optional but must be paired), get/save/delete by composite key, same `pluginFilter`-style `filter` param, hard-capped `limit` (`Math.min(limit, 1000)`, default 1000) | Identical FastAPI router + reuse of the same JSON-path filter parser as §3.2 (this is explicitly the same mini-language, backed by the same jOOQ service in Java — `DbPluginObjectQueryService` — factor the Python filter-DSL parser into one shared module used by both product and plugin-object routers) | Factor once, use twice — do not duplicate the parser | Low if factored correctly; medium risk of drift if reimplemented twice independently. |

### 3.4 Footprint (pricing archetype + footprint domain + audit + export)

This module is the **most directly portable** piece — it's framework-agnostic Java (no Spring annotations in the `archetype.pricing` package) and already structured with clean boundaries (`api`/`internal`/`internal.ports`/`spi.stub`/`web`/`audit`/`export`).

| What exists (Java) | Gap → Python target | Translation approach | Risk/ambiguity |
|---|---|---|---|
| Sealed interfaces + records: `Component` (permits `SimpleComponent`, `CompositeComponent`), `BreakdownNode` (permits `LeafBreakdownNode`, `CompositeBreakdownNode`), `FootprintCalculationException` (abstract sealed, permits 5 typed subtypes, each with `code()`/`details()`) | Python discriminated unions | `Component`/`BreakdownNode`: `Union[SimpleComponent, CompositeComponent]` as frozen `@dataclass`es (not Pydantic — these are internal domain objects, not wire DTOs) with a `kind: Literal[...]` tag field for exhaustiveness, checked with a `match`/`case` + a final `assert_never(x)` (from `typing_extensions` or stdlib on 3.12+) branch to preserve Java's compiler-enforced exhaustiveness at least at type-check time (mypy). `FootprintCalculationException`: an `ABC` base with abstract `code`/`details` properties, 5 concrete subclasses — same shape as today. | Python has no compiler-enforced sealed-class exhaustiveness; `assert_never` + mypy strict mode is the closest available substitute and should be treated as **required**, not optional, given zero test coverage — this is where an unhandled case would otherwise silently fall through at runtime instead of failing to compile. |
| `Applicability`/`Validity`/`ComponentVersion`/`ParameterValue`/`QuantityExtractor`/`Calculator` (pure value objects + one interface) | Direct 1:1 port to Python dataclasses + a `Protocol` for `Calculator` | Straightforward | None — confirmed zero framework coupling on the Java side. |
| `BreakdownTreeBuilder`, `ComponentTreeRegistry` (hardcoded component tree), `RoundingPolicy`, `BreakdownScaler`, `DefaultFootprintFacade` | Direct algorithm-for-algorithm port | Preserve exact rounding (`RoundingMode.HALF_UP` → Python `decimal.ROUND_HALF_UP` with `decimal.Decimal`, not `float`, to avoid precision drift — **BigDecimal maps to `Decimal`, never `float`**, this is a correctness-critical translation point given the domain is a monetary-adjacent unit (kg CO2 with 4 decimal places persisted)) | Medium — `Decimal` discipline must be enforced everywhere `BigDecimal` appears (price, kg_co2, factor rates); a `float` slipping in anywhere in this arithmetic chain is a silent correctness bug with no test to catch it. |
| **Known existing bug to fix during port** (documented in current-state-analysis, reconfirmed by reading `BreakdownScaler.scale`): PER_100G path throws untyped `IllegalArgumentException` when `materialWeightKg` is null/non-positive, instead of one of the 5 typed `FootprintCalculationException` subtypes | Normalize to `InvalidParametersException("materialWeightKg", materialWeightKg)` (matching the existing pattern used elsewhere, e.g. `FootprintController.getFootprint`'s own explicit negative-weight check) | Behavior-preserving in one sense (still a 400) but changes the response *shape* from the legacy flat `ErrorResponse` (since untyped `IllegalArgumentException` is caught by `GlobalExceptionHandler`, the legacy handler) to RFC7807 `ProblemDetail` (since typed footprint exceptions go through `FootprintExceptionHandler`) | **Flag as a decision, not a silent fix**: this changes which of the two error envelopes the frontend receives for this specific edge case. Confirm with the user/spec phase whether to (a) fix it and accept the envelope-shape change for this one case, or (b) preserve the bug exactly (untyped exception → legacy envelope) for byte-for-byte fidelity. Given the task's hard "preserve both error-response shapes" constraint, **default recommendation is (b) preserve as-is**, note the bug in the plan, and let a follow-up task fix it deliberately — don't fold a semver-relevant response-shape change into a rewrite whose entire premise is "the contract doesn't change." |
| `FootprintController`: `GET /api/products/{productId}/footprint`, headers `X-Correlation-Id`/`X-Caller-Id`/`X-Comparison-Group` (all optional, UUID-parsed, invalid UUID → `InvalidParametersException`), query params (`materialWeightKg`,`supplierDistanceKm`,`destinationDistanceKm`,`lastMileDistanceKm`,`storageDays`,`requiresRefrigeration`,`strictness`,`unit`,`dryRun`,`asOf`), defaults (`strictness=STRICT`, `unit=TOTAL`, `storageDays=0`, `dryRun=false`, `callerId="anonymous"` when header blank/absent, `asOf=now()` when absent) | Identical FastAPI route with `Query(...)` params + `Header(...)` for the three custom headers | 1:1 — this is a large, precise parameter surface; enumerate every default exactly as above in the spec phase | Medium — many independent optional parameters each with a distinct default; a spec-phase checklist enumerating all of them (as done here) is the mitigation. |
| Duplicated defaulting logic (controller applies defaults, then `DefaultFootprintFacade.withDefaults` applies overlapping defaults again) | Collapse to one location (facade or controller, pick one) | Behavior-preserving cleanup **only if confirmed identical** — before collapsing, diff both defaulting code paths line-by-line since current-state-analysis flagged this as "must confirm behavior is identical before doing so" and it wasn't independently re-verified in this pass | Flag as a decision: verify equivalence first; if any divergence is found, that divergence itself may be an existing latent bug worth a separate flag. |
| `FootprintExportController`: `GET /api/footprints/calculations/{correlationId}/export?format=csv` (only `csv` supported, else `InvalidParametersException`), replays a **previously computed** audit row (not live recalculation), fixed 12-column CSV header, `Content-Disposition: attachment` | Identical FastAPI route returning `StreamingResponse`/`Response` with `media_type="text/csv"` | 1:1, including the exact header row and the "replay, not recompute" semantic — do not accidentally make this endpoint recalculate | Low if the "replay-only" framing above is preserved. |
| Audit pipeline: `FootprintCalculatedEvent` published via Spring's in-process event bus, `FootprintAuditListener` runs `@Async` on a dedicated executor, gated on `@TransactionalEventListener(AFTER_COMMIT, fallbackExecution=true)`, own `REQUIRES_NEW` transaction, `@Retryable` (3 attempts, exponential backoff from config, defaults 200ms×2.0), duplicate `correlation_id` (DB unique constraint violation) treated as idempotent success (not an error), `@Recover` increments a `footprint.audit.failed` counter and logs on exhausted retries, `dryRun` requests are never audited | FastAPI `BackgroundTasks.add_task(...)` scheduled at the end of the request handler (guaranteed post-response, analogous to "after commit" since the request's own DB write — if any — has already been committed by the ORM session by that point) wrapping a `tenacity`-decorated async function that opens its **own new SQLAlchemy session** (≈ `REQUIRES_NEW`), catches `IntegrityError` on the unique `correlation_id` constraint and treats it as success, and increments a Prometheus/OpenTelemetry counter analogous to Micrometer's on exhausted retries | **Design decision needed**: FastAPI `BackgroundTasks` does not have a native "after commit" hook the way Spring's event bus does — if the footprint endpoint itself does zero DB writes on the happy path (recalculation is stateless; only the *audit* write touches the DB), then "after response" ≈ "after commit" trivially and `BackgroundTasks` is sufficient. Confirm this assumption (no other DB write happens in the request path) during spec/implementation-planning before committing to `BackgroundTasks` over a more elaborate asyncio-task-with-explicit-commit-ordering approach. If it turns out there *is* an in-request commit this needs to sequence after, a lightweight explicit `asyncio.create_task` fired only after the main session commits is the fallback, not Celery. |
| `FootprintAuditEntity`: unique `correlationId` (UUID), optional `comparisonGroupId`, `productId`(100,NN), optional `callerId`(100), `requestedAt`, `totalKgCo2` NUMERIC(12,4) NN, `strictness`/`normalisation` enums, `breakdown`/`warnings`/`factorVersions` all JSONB, `dryRun` boolean | SQLAlchemy model, 1:1 | Straightforward given the field-by-field inventory above | None. |
| In-memory stub ports (`InMemoryEmissionFactorPort`, `InMemoryProductAttributesPort`) | Same stub pattern, ported as-is (these are explicitly SPI stubs per the Java package name `spi.stub`, not production adapters) | Direct port | Confirm during spec whether these stubs are meant to stay stubs post-migration (likely yes — no evidence of a real adapter existing anywhere in the current repo) or whether "migrate" implies wiring a real emission-factor data source. **Flag as a scope question** — current-state-analysis doesn't resolve this and clarifications.md doesn't address it either. |

### 3.5 Auth / Security (JWT + hand-built OAuth2 server)

This is the highest-risk module — externally-consumed wire behavior with client-side JWT decoding as a hard constraint, and a full custom OAuth2 server whose every status code, error code, and response field must be preserved for "external MCP clients" whose actual existence/behavior cannot be verified from this repo.

**JWT (app-level)**

| What exists (Java) | Gap → Python target | Translation approach | Risk/ambiguity |
|---|---|---|---|
| `JwtTokenProvider`: HS256, `secretKey = Keys.hmacShaKeyFor(Base64.decode(secret))` — **the configured secret is base64-encoded before use as key material**, `generateToken(username, permissions)` → claims `{sub, permissions:[...], iat, exp}`, default expiration from `app.jwt.expiration-ms` config (unknown value — not in this repo) | PyJWT `jwt.encode({...}, key=base64.b64decode(secret), algorithm="HS256")` | **Exact bit reproduction requires knowing that the secret is base64-decoded before HMAC use** — this is easy to get wrong (using the raw configured string as the HMAC key instead of its base64-decoded bytes would silently produce tokens/verifications that don't interoperate with any *existing* deployed secret value). Flag as a must-verify-with-user item: confirm the actual `app.jwt.secret` value/format used in any real deployment before cutover, since this repo has no config file to source it from. | 
| `parseToken`: falls back from `permissions` claim to `scopes` claim if `permissions` absent (used to unify handling of both app-JWTs and OAuth2-JWTs through one code path) | PyJWT decode + the same `permissions` → `scopes` fallback in the FastAPI dependency that extracts the authenticated principal | 1:1 | Low — but must preserve fallback order exactly (permissions checked first). |
| `AuthController.login`: `POST /api/auth/login`, on success → `200 {token}`, on `BadCredentialsException` → **manually constructed 401 `ErrorResponse`, bypassing the global exception handler** (`"Invalid username or password"`) | FastAPI route with the same manual-401 construction (don't rely on a generic exception-handler catch here, replicate the explicit branch) | 1:1 | Low. |
| Password verification via Spring's `AuthenticationManager`/`CustomUserDetailsService`/BCrypt | `bcrypt.checkpw(password.encode(), stored_hash.encode())` against `User.password_hash` (72-char column — standard bcrypt hash length, confirms current hashing scheme) | 1:1 | Confirm bcrypt cost factor used for existing hashes is compatible/reproducible (bcrypt hashes self-describe their cost factor, so this is low risk — just don't regenerate hashes, only verify against them). |

**Authorization matrix** (`SecurityConfiguration`) — the entire path→permission table, verified directly from source:

| Path pattern | Method | Required authority (Java) |
|---|---|---|
| `/.well-known/oauth-authorization-server` | GET | public |
| `/oauth2/register` | POST | public |
| `/oauth2/token` | POST | public |
| `/oauth2/introspect` | POST | public |
| `/api/oauth2/client-info` | GET | public |
| `/api/auth/login` | POST | public |
| `/api/health` | GET | public |
| `/assets/**`, `/`, `/index.html`, `/*.js`, `/*.css`, `/favicon.ico`, any non-`/api/**` path | any | public (SPA static assets + client-side-routed paths) |
| `/api/categories/**` | GET | `READ` or `mcp:read` |
| `/api/products/**` | GET | `READ` or `mcp:read` |
| `/api/footprints/calculations/*/export` | GET | `READ` or `mcp:read` |
| `/api/plugins`, `/api/plugins/*`, `/api/plugins/*/objects/**`, `/api/plugins/*/products/*/data` | GET | `READ` (no `mcp:read` bridge on the plugin routes — narrower than categories/products) |
| `/api/categories/**`, `/api/products/**` | POST/PUT/DELETE | `EDIT` or `mcp:edit` |
| `/api/plugins/*/objects/**`, `/api/plugins/*/products/*/data` | PUT/DELETE | `EDIT` (no `mcp:edit` bridge) |
| `/api/plugins/*/manifest` (PUT), `/api/plugins/*/enabled` (PATCH), `/api/plugins/*` (DELETE) | as noted | `PLUGIN_MANAGEMENT` |
| anything else | any | authenticated (any valid token) |

Translation approach: a FastAPI dependency-injection-based permission checker (`Depends(require_any("READ", "mcp:read"))` style) applied per-route, mirroring this exact table — **do not try to collapse the asymmetries** (plugins lack the `mcp:*` bridge that categories/products have; this is presumably deliberate, not an oversight, since it's consistent across every plugin route). Reproduce the table exactly; flag any asymmetry only if the user wants to *change* it, not fix it silently.

**Custom 401/403 bodies**: `AuthenticationEntryPoint`/`AccessDeniedHandler` return the legacy flat `ErrorResponse` (`"Authentication required"` / `"Access denied"`) — FastAPI equivalent: custom exception handlers on `HTTPException` for 401/403 (or a dependency that raises a typed exception caught by a handler) producing the identical envelope, not FastAPI's default `{"detail": "..."}` shape.

**OAuth2 authorization server** — full endpoint-by-endpoint inventory (re-verified from source, not just current-state-analysis's summary):

| Endpoint | Method | Behavior to preserve exactly |
|---|---|---|
| `/.well-known/oauth-authorization-server` | GET | Returns `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `introspection_endpoint`, `grant_types_supported: [authorization_code, refresh_token, urn:ietf:params:oauth:grant-type:token-exchange]`, `response_types_supported: [code]`, `code_challenge_methods_supported: [S256]`, `token_endpoint_auth_methods_supported: [client_secret_post, client_secret_basic, none]`, `scopes_supported: [mcp:read, mcp:edit]`. `issuer`/endpoint URLs derived from request scheme/host/port with `X-Forwarded-Proto`/`-Host`/`-Port` override logic (reverse-proxy aware) — **port omitted when it's the scheme default (80/443) or when behind a proxy with `X-Forwarded-Proto` set but no explicit forwarded port**. |
| `/api/oauth2/client-info?client_id=` | GET | `{client_id, client_name (default "Unknown Application"), scopes}` or 404. |
| `/oauth2/register` | POST | DCR: validates `client_name` (required, ≤255 chars), `redirect_uris` (required if `authorization_code` in `grant_types`, must be `https://` or a loopback URI `http://localhost`/`127.0.0.1`/`[::1]`, no `#` fragments), `token_endpoint_auth_method` (`client_secret_post`\|`client_secret_basic`\|`none`, default `client_secret_post`), `grant_types` (only `authorization_code`/`refresh_token` supported, default `authorization_code`), `scope` (must be subset of `{mcp:read, mcp:edit}`, defaults to both if omitted). Generates random `client_id`/`client_secret` (UUIDs), stores bcrypt-hashed secret, returns **201** with an RFC7591/OIDC-DCR-shaped body (via Spring's `OidcClientRegistrationHttpMessageConverter` — the Python port needs a hand-built equivalent JSON shape: `client_id`, `client_secret` (plaintext, one-time), `client_name`, `client_id_issued_at`, `redirect_uris`, `grant_types`, `response_types`, `scope`, `token_endpoint_auth_method`, `client_secret_expires_at: 0` meaning never-expires). Errors → `invalid_client_metadata`. |
| `/oauth2/authorize` | POST | Requires prior authentication (reads `SecurityContextHolder` — Python equivalent must have already run the JWT auth dependency on this route, meaning this endpoint is *not* actually in the "public" bucket despite what a first read of the security matrix might suggest — it depends on request-scoped authentication state, not a permission check). Validates `client_id`/`redirect_uri`/`response_type=code` required; `redirect_uri` must be pre-registered for the client; requested `scope` must be subset of client's allowed scopes; PKCE **required for public clients** (`code_challenge`+`code_challenge_method=S256` only, challenge 43-128 chars, base64url charset). On success: generates a 256-bit random authorization code, stores it (client_id, redirect_uri, scope, PKCE challenge, **the authenticated user's username and permission set** — captured on authorization-code storage, not deferred to token exchange) with a 10-minute TTL, then **302 redirect** to `redirect_uri?code=...&state=...` (state passed through only if present). Errors map to specific OAuth2 error codes based on message content (`redirect_uri`→`invalid_request`, `scope`→`invalid_scope`, `response_type`→`unsupported_response_type`, `PKCE`→`invalid_request`, `authenticated`→`unauthorized_client`, default→`invalid_request`). |
| `/oauth2/token` | POST | Three grant types dispatched by `grant_type` param: **`authorization_code`** (validates code exists/unexpired, optional client_id match, exact redirect_uri match, confidential-client secret check via bcrypt if the client isn't `none`-auth, PKCE verifier check via SHA-256(code_verifier)==code_challenge if PKCE was used at authorize time — generates access token from the **granted scope**, not the user's full permission set, plus a refresh token); **`refresh_token`** (consume-and-rotate — old token invalidated, new one issued atomically, 24h TTL, reuses original granted scope); **`urn:ietf:params:oauth:grant-type:token-exchange`** (RFC 8693 — requires client authentication via Basic or POST body, validates `subject_token`+`subject_token_type` (only `urn:ietf:params:oauth:token-type:access_token` supported), parses+validates the subject JWT, maps requested or subject-token scopes through the **fixed `mcp:read→READ`, `mcp:edit→EDIT` table** (unmapped scopes silently dropped, not errored), issues a new 15-minute JWT with `aud` set to the issuer URL and **no refresh token** per RFC 8693 §2.2, response includes `issued_token_type`). All three: `Cache-Control: no-store`, `Pragma: no-cache`, `expires_in: 900` (hardcoded — the OAuth2-issued token always has a fixed 15-minute lifetime, distinct from the app-JWT's separately-configured expiration). |
| `/oauth2/introspect` | POST | RFC 7662. Requires client auth (Basic or POST body) — this endpoint is *not* public despite appearing in the "permitAll" list; the permitAll only exempts it from the *permission* matrix, client credential auth still happens inside the filter itself. Missing/invalid `token` param → `{"active": false}` (200, not an error). Valid token → `{active:true, sub, scope (space-joined from `scopes` claim), exp, iat, iss (if present), aud (if present — single value unwrapped from array, or array if multiple), token_type:"Bearer", client_id}`. |
| **Every OAuth2 error response** | — | Uniform shape: `{"error": "<code>", "error_description": "<msg>", "error_uri": null (omitted, `NON_NULL` inclusion)}`. Status code mapping is **duplicated verbatim in 4 separate filter classes** (`OAuth2TokenFilter`, `OAuth2AuthorizationFilter`, `OAuth2IntrospectionFilter`, `PublicClientRegistrationFilter`): `invalid_client→401`, `unauthorized_client\|access_denied→403`, `server_error→500`, everything else→400. **Consolidate into one function in the Python port** (this exact duplication was already flagged as a cleanup opportunity in current-state-analysis; now confirmed present in all 4 files verbatim) — this is safe, behavior-preserving cleanup since all 4 copies are identical. |

**Persistence gap**: `AuthorizationCodeService` and `RefreshTokenService` are backed by **in-memory `ConcurrentHashMap`s with scheduled cleanup** (`@Scheduled` every 5min/30min) — not persisted to the database. This means:
- Restarting the service invalidates all in-flight authorization codes and outstanding refresh tokens.
- A multi-instance deployment would not work correctly today (codes/tokens issued by one instance aren't visible to another) — this is a latent scaling bug in the *current* system, not something the migration introduces.

**Decision needed** (flag to user, don't silently resolve): replicate the in-memory, single-instance-only behavior exactly (simplest, byte-for-byte faithful, but preserves the latent multi-instance bug), or take the opportunity to persist these to Postgres/Redis now. Given clarification Q1 says "rewrite 1:1... in case external consumers depend on it," and there's no evidence this system runs multi-instance today, **default recommendation: replicate in-memory exactly** (e.g., a plain Python dict guarded by an `asyncio.Lock`, or `cachetools.TTLCache`, with a background cleanup task mirroring the `@Scheduled` cadence) and treat persistence as an explicit out-of-scope follow-up, not a silent scope expansion.

**`RegisteredClientEntity`** (`oauth2_registered_client` table): UUID PK, unique `client_id`, `client_id_issued_at`, `client_secret`, `client_secret_expires_at`, `client_name` NN, `client_authentication_methods`/`authorization_grant_types`/`redirect_uris`/`scopes` all Postgres `text[]` arrays. SQLAlchemy target: `ARRAY(String)` columns (native Postgres array type, direct equivalent — no JSON-encoding workaround needed since SQLAlchemy+asyncpg support Postgres arrays natively).

### 3.6 Cross-cutting concerns

**Error handling — both conventions, verified field-for-field:**

Legacy flat envelope (`ErrorResponse`, everywhere except footprint):
```json
{"status": 404, "error": "Not Found", "message": "...", "fieldErrors": null, "timestamp": "2026-08-31T12:00:00"}
```
- `fieldErrors` populated only for validation failures (`MethodArgumentNotValidException` → 400, `{field: message}` map, first error wins on duplicate field).
- Handled cases: `EntityNotFoundException`→404, `BusinessConflictException`→409, `DataIntegrityViolationException`→409 (generic message, doesn't leak DB details), `MethodArgumentNotValidException`→400, `AccessDeniedException`→403, `IllegalArgumentException`→400 (echoes exception message directly — this is the fallback most ad-hoc validation errors flow through), catch-all `Exception`→500 (generic message, logs the real exception server-side).
- Target: a Pydantic `ErrorResponse` model + FastAPI `exception_handler`s registered per exception type, mirroring this table exactly, including the exact `error` reason-phrase strings (`"Not Found"`, `"Conflict"`, etc. — FastAPI/Starlette doesn't auto-supply HTTP reason phrases the way Spring's `HttpStatus.getReasonPhrase()` does, so these need to be hardcoded or sourced from `http.client.responses`).

RFC7807 (`ProblemDetail`, footprint module only):
```json
{"type": "https://.../missing-factor", "title": "Missing emission factor", "status": 422, "detail": "...", "instance": "/api/products/123/footprint", "code": "MISSING_FACTOR", "...exception-specific extension fields..."}
```
- `type` built from a configurable base URI (`app.footprint.problem-base-uri` — unset in this repo) + kebab-cased exception `code()`.
- `instance` is the **request path only** (no scheme/host) — deliberate, to avoid leaking internal topology behind a reverse proxy.
- Status codes: `MissingFactorException`/`MissingProductAttributeException`/`ApplicabilityResolutionException`→422, `InvalidParametersException`→400 (also catches `MethodArgumentTypeMismatchException`, wrapping it into an `InvalidParametersException`), `FactorVersionOverlapException`→409.
- Media type: `application/problem+json`, not `application/json`.
- Target: FastAPI supports returning `Response(content=..., media_type="application/problem+json")` directly from a scoped exception handler registered only for footprint-domain exception types — mirrors the Java `@RestControllerAdvice(basePackages="...footprint")` scoping.

**Schema/migrations (greenfield, reverse-engineered)** — full entity inventory now cross-verified from source:

| Entity | Table | PK strategy | Notable columns |
|---|---|---|---|
| `BaseEntity` (mapped superclass) | — | `SEQUENCE`, allocationSize=1, per-entity sequence name (`category_seq`, `product_seq`, `plugin_object_seq`, `footprint_audit_log_id_seq`, `user_seq`) | `created_at` (audit-managed, not updatable), `updated_at` (`@Version` — **used as Hibernate's optimistic-lock column, typed as `LocalDateTime`, not an integer counter**) |
| `Category` | `categories` | inherited | `name`(100,NN), `description`(500) |
| `Product` | `products` | inherited | `name`(255,NN), `description`(2000), `photo_url`(500), `price` NUMERIC(19,2) NN, `sku`(50,NN), `category_id` FK NN **(undeclared in any DDL today — must add)**, `plugin_data` JSONB |
| `User` | `users` | inherited (`user_seq`) | `username`(50,NN,unique), `password_hash`(72,NN — bcrypt-length), `permissions` via **`@ElementCollection`** into a separate `user_permissions` join table (`user_id`, `permission` enum-as-string) — **no separate Permission table, no bidirectional entity** |
| `PluginDescriptor` | `plugins` | **String PK, not sequence-generated** | `name`(255,NN), `version`(50), `url`(500), `description` TEXT, `enabled` boolean default true, `manifest` JSONB NN, `created_at`/`updated_at`(`@Version`) |
| `PluginObject` | `plugin_objects` | inherited (`plugin_object_seq`) | `plugin_id`/`object_type`/`object_id` (255 each, NN, **composite unique constraint**, no single-column uniqueness), `data` JSONB NN, `entity_type` enum (50, nullable), `entity_id` (nullable, **no FK**) |
| `RegisteredClientEntity` | `oauth2_registered_client` | **UUID PK** (not the shared sequence base — separate entity hierarchy entirely) | see §3.5 |
| `FootprintAuditEntity` | `footprint_audit_log` | inherited (`footprint_audit_log_id_seq`) | `correlation_id` UUID unique NN, `comparison_group_id` UUID nullable, `product_id`(100,NN), `caller_id`(100,nullable), `requested_at` NN, `total_kg_co2` NUMERIC(12,4) NN, `strictness`/`normalisation` enums, `breakdown`/`warnings`/`factor_versions` JSONB NN |

**`@Version`-as-`updatedAt` decision** (flagged in current-state-analysis, now confirmed present identically on `BaseEntity`, `PluginDescriptor`): every entity uses a `LocalDateTime` column simultaneously as (a) the audit "last modified" timestamp shown to clients and (b) Hibernate's optimistic-concurrency-control version column (an `UPDATE ... WHERE updated_at = :old_value` check on every write). **This dual-purpose is a genuine design decision to preserve or drop**:
- SQLAlchemy supports timestamp-based optimistic versioning too (`version_id_col` + a custom `version_id_generator` that returns `datetime.utcnow()`), so bit-for-bit fidelity is achievable.
- But it's worth flagging to the user explicitly once more: if optimistic locking was never actually relied upon in practice (plausible, given no tests exist to exercise concurrent-write conflict handling), it may be simpler and equally correct to split this into a plain `updated_at` audit column + a separate integer `version` column using SQLAlchemy's standard `version_id_col` pattern — cleaner, but **technically a behavior change** (a concurrent-write conflict would raise at a different point / with different semantics). Default recommendation: **preserve exactly** (timestamp-as-version) unless the user confirms optimistic locking is not depended upon.

**FK reconstruction task list for the first Alembic migration** (everything below must be explicitly declared since none of it exists as DDL anywhere in-repo today):
1. `products.category_id → categories.id` (NOT NULL) — relied upon implicitly by `CategoryHasProductsException`.
2. `plugin_objects` composite unique `(plugin_id, object_type, object_id)`.
3. `oauth2_registered_client.client_id` unique.
4. `footprint_audit_log.correlation_id` unique (relied upon for the idempotent-audit-write behavior — this one is load-bearing for correctness, not just a nice-to-have constraint).
5. `users.username` unique.
6. `user_permissions` join table (`user_id` FK → `users.id`, `permission` enum-as-text) — no ORM-level join entity in Java, model as a plain association table in SQLAlemy too (`Table(...)` + `relationship(..., secondary=...)`, not a mapped class), matching JPA's `@ElementCollection` semantics (child rows have no independent identity/lifecycle — always inserted/deleted alongside the parent user).

**DevOps/packaging (greenfield, in scope per clarification Q4):**
- `pyproject.toml` under `uv`, pinned dependency versions (FastAPI, SQLAlchemy, asyncpg, alembic, pyjwt, bcrypt, pydantic, uvicorn, tenacity; ruff/mypy as dev-only).
- Multi-stage `Dockerfile`: build stage runs `uv sync --frozen --no-dev`, runtime stage copies the resolved venv and runs `uvicorn app.main:app --host 0.0.0.0 --port 8080` (match whatever port the frontend's dev proxy expects — verify `src/frontend/vite.config.ts` proxy target, flagged as "not yet confirmed" in current-state-analysis; resolve during implementation, not left dangling).
- `docker-compose.yml`: `postgres:18` service (matches the version implied by JSONB/array usage patterns already in the current-state-analysis) + the FastAPI service, with environment-variable injection for `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, DB connection string, etc. — **this is also the first time these config values get a documented home**, since the Java app never had an `application.properties` to define them; treat this as the authoritative new source of truth for what env vars this system needs.
- The `SpaForwardController`/`HealthController` equivalents (serve `index.html` for any non-`/api/`, non-asset path so client-side routing + direct navigation works; `GET /api/health` → `{"status": "UP"}`) — small but must not be forgotten, since dropping SPA-fallback routing would silently break direct-URL navigation and reloads in the frontend even though "the frontend is unchanged."

---

## 4. Migration Strategy

**Recommended approach: phased, contract-first, from-scratch reimplementation** — explicitly *not* incremental-with-live-cutover and *not* dual-run, for a structural reason: **there is no running system to migrate incrementally against or dual-run alongside.** The Java backend cannot currently be built (no build file) or verified (no tests), so:

- **Dual-run is not feasible**: there is nothing to run in parallel. Standing up the Java side first just to dual-run against it would itself be a large, out-of-scope side-project (write a `pom.xml`, reconstruct config, discover the schema empirically) that duplicates exactly the reverse-engineering work this migration already has to do for the Python side — better spent once, on the target, than twice.
- **Incremental route-by-route cutover** (e.g., a reverse proxy splitting traffic between old/new backends per-route while both run) requires a working old backend to route the remaining traffic to. Same blocker.
- **Big-bang cutover** is the only mechanically available option — but "big bang" undersells how this should actually be run day-to-day: internally, build and verify it in phases even though there's no incremental *user-facing* cutover.

**Phased internal execution** (even though delivery is effectively big-bang):

1. **Contract-freeze phase** (do first, before any Python code): formalize this document's route table, DTO shapes, both error envelopes, JWT claim shape, and OAuth2 wire behavior into a golden reference (an OpenAPI spec hand-written from the Java source, or a set of literal request/response example pairs) — the specification-creation phase (Phase 5) should produce this as its primary artifact, not prose.
2. **Schema-first**: write the Alembic migration(s) reconstructing every entity/FK/constraint in §3.6 *before* writing any endpoint code — validate the schema stands up correctly (via docker-compose Postgres) independently of the API layer.
3. **Auth/OAuth2 in isolation**: implement and manually exercise (Postman/curl scripts, given no pytest suite) the JWT + full OAuth2 server against the golden reference from step 1, in isolation from CRUD endpoints, per current-state-analysis's own recommendation — this is the module with the most wire-format precision required and the least room for "close enough."
4. **Category → Product → Plugin system**, in that order (lowest to highest complexity, each reusing patterns established by the previous).
5. **Footprint module last** (or in parallel by a separate work-stream, since it has no dependency on category/product/plugin beyond reading `Product.plugin_data` for attribute merging) — the domain logic is the most mechanically portable part, but the audit/background-task wiring needs the DB layer from step 2 already in place.
6. **Manual contract verification pass**: since no automated test suite is in scope, budget explicit manual verification time (or a throwaway verification script per module, discarded after use) against the golden reference from step 1 before calling any module "done" — this substitutes, weakly, for the missing test oracle and should not be skipped even though it's not a formal pytest suite.
7. **DevOps stand-up**: Dockerfile/compose can be built incrementally alongside step 2 onward (get Postgres running early) rather than bolted on at the end.

**Rollback plan**: standard "keep the Java source tree in version control, don't delete it" — there is no live rollback path in the traditional sense (no dual-run to fall back to), so rollback here means "the old code still exists in git history if this needs to be aborted," not "traffic can be shifted back." This should be stated explicitly to the user as a limitation, not glossed over.

---

## 5. Risk Assessment

**Overall: High.**

| Risk factor | Why it's high | Mitigation already reflected above |
|---|---|---|
| No executable Java baseline | Zero ability to run the current system side-by-side to verify parity; every "preserve exactly" claim rests on static code reading alone | Precise, source-verified inventories (this document) substitute for a live oracle where possible; manual verification pass in strategy step 6. |
| Zero test coverage, and none in scope for this migration (clarification Q2) | No safety net catches regressions during or after the rewrite | ruff/mypy as static-analysis gates; ADR-style flagging of every ambiguous behavior (defaulting-logic duplication, the untyped-exception bug, plugin-data PUT semantics) so at least *known* ambiguities get explicit human sign-off even without tests. |
| Hand-rolled OAuth2 server, external consumer(s) of unknown/unverifiable liveness | Wire-format regressions (wrong error code, wrong field name, wrong status) could silently break real external MCP clients with no way to detect it from inside this repo | Full endpoint-by-endpoint behavioral inventory in §3.5, re-verified directly against source in this pass (not just summarized from prior analysis). |
| Dual error-response conventions, deliberately incompatible with each other | A single bug (e.g., the confirmed PER_100G untyped-exception bug) can silently flip which envelope a client-facing error uses | Explicitly flagged as a decision point rather than silently "fixed" during port (§3.4). |
| JWT client-side decoding without library/signature verification by plugins | Any change to claim names, nesting, or encoding breaks plugins with no server-side error to signal it — it would simply look like garbled/absent permissions client-side | Exact claim-shape and base64-secret-decoding behavior called out explicitly in §3.5. |
| Undocumented schema/config reconstructed from annotations only | A missed constraint (the `category_id` FK is the prime example) becomes a data-integrity gap discovered only in production | Explicit FK/constraint checklist in §3.6. |
| Large surface area (~114 files, 5 verticals + OAuth2 + pricing archetype) with no incremental cutover available | All-or-nothing delivery raises the cost of any single missed detail | Phased *internal* execution plan (§4) to catch issues before the effectively-big-bang cutover, even though true incremental production rollout isn't available. |

**Lower-risk pockets** (correctly identified in current-state-analysis, reconfirmed here): the `archetype.pricing` package and most of the footprint calculation engine are genuinely framework-agnostic and mechanically portable — risk there is concentrated in `Decimal`-vs-`float` discipline and sealed-type exhaustiveness, both addressable with static tooling (mypy) rather than requiring a live oracle.

---

## 6. Recommendations / Next Steps

1. Feed this document's §3 (module-by-module gap tables) directly into Phase 5 (specification creation) as the primary source material — it is already organized at the granularity a spec needs (endpoint-by-endpoint, field-by-field).
2. Resolve the four flagged decisions before specification is finalized:
   - PER_100G untyped-exception bug: preserve-as-is vs. fix-and-accept-envelope-change (default: preserve).
   - Plugin-data `PUT` merge-vs-replace semantics: confirm against `PluginDataService.setData` before implementing.
   - In-memory OAuth2 code/token stores: preserve-as-is single-instance behavior vs. persist now (default: preserve).
   - `@Version`-as-timestamp optimistic locking: preserve exactly vs. split into audit-timestamp + integer version (default: preserve).
3. Confirm the actual `app.jwt.secret` value/encoding and `app.jwt.expiration-ms` value used in any real deployment — these are configuration facts this repo cannot supply, and getting the base64-decode-before-HMAC-key-use detail wrong breaks interop with any already-issued tokens.
4. Resolve the footprint in-memory stub-port scope question (§3.4) — stay stubs, or wire a real adapter — before implementation planning sizes that work stream.
5. Check `src/frontend/vite.config.ts` dev-proxy target and update it to point at the new FastAPI dev server port as part of implementation (not deferred).

---

## Orchestrator State Updates (report back to orchestrator-state.yml)

```yaml
migration_context:
  migration_type: "code"   # primary; see §1 for the "architecture-adjacent" secondary characteristic
                            # (schema/build/deployment created from scratch, not migrated) that doesn't
                            # fit a single-value enum cleanly — call it out in any downstream summary.
  target_system:
    description: >
      Python 3.12+, uv, FastAPI, SQLAlchemy 2.x (async ORM + Core for dynamic/JSONB queries),
      Alembic, asyncpg, PyJWT, bcrypt, Pydantic v2, uvicorn, tenacity (background-task retry),
      ruff + mypy (lint/type gates only, no test suite per clarification Q2). Dockerfile +
      docker-compose (Postgres + FastAPI) included per clarification Q4.
    technologies: [python, fastapi, sqlalchemy, asyncpg, alembic, pyjwt, bcrypt, pydantic, uvicorn, tenacity, uv, ruff, mypy]
  risk_level: "high"
  breaking_changes:
    - "None intended for external consumers (frontend/plugins/MCP clients) — full route table, both error-response envelopes, and JWT claim shape are hard preserve-exactly constraints (see current-state-analysis + clarifications)."
    - "Internal-only, flagged-not-yet-decided: PER_100G footprint validation currently raises an untyped exception that surfaces via the legacy error envelope instead of the RFC7807 one used by every other footprint error — default recommendation is to preserve this bug as-is rather than silently changing the response envelope shape for this one case."
    - "Internal-only: OAuth2 authorization-code and refresh-token stores are in-memory (ConcurrentHashMap-equivalent) in the current system and are recommended to stay in-memory in the rewrite (single-instance-only behavior preserved) rather than being silently upgraded to persisted storage."
    - "Internal-only: the products.category_id -> categories.id foreign key, and several other constraints (plugin_objects composite unique key, footprint_audit_log.correlation_id uniqueness, users.username uniqueness), exist only implicitly today (via JPA annotations / application logic) and must be explicitly declared in the first Alembic migration — omission would be a silent data-integrity regression, not a behavior change users would see immediately."
  migration_strategy:
    approach: "phased-internal-execution, big-bang-delivery"
    phases:
      - "contract-freeze (golden reference: routes, DTOs, error envelopes, JWT/OAuth2 wire shapes)"
      - "schema-first (Alembic migrations reconstructed from JPA annotations, incl. undeclared FKs/constraints)"
      - "auth/OAuth2 server in isolation, verified against golden reference"
      - "category -> product -> plugin system (ascending complexity)"
      - "footprint module (pricing archetype + calculation engine + audit pipeline + export)"
      - "manual contract verification pass (no automated test suite in scope)"
      - "DevOps stand-up (Dockerfile/compose), incrementally alongside schema-first step"
  rollback_plan_created: false   # no live rollback path exists; see Section 4 — old code remains in git history only
  dual_run_configured: false     # not feasible: no running/buildable Java baseline exists to dual-run against
```
