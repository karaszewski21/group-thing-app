# Codebase Analysis Report

**Date**: 2026-08-31
**Task**: Migrate backend from Java 25 / Spring Boot 4.0.5 to Python (uv + FastAPI)
**Description**: Full rewrite of `src/backend/` — REST controllers, JPA entities, JOOQ queries, Liquibase migrations (claimed but absent), Spring Security JWT + custom OAuth2 authorization server, plugin system, category/product domain, pricing archetype, footprint domain. `src/frontend/` and `plugins/` stay as-is; only backend language/framework changes, with the existing REST API contract preserved for frontend/plugin compatibility.
**Analyzer**: codebase-analyzer skill (5 Explore agents: API Surface & Entry Point, Persistence Layer, Auth & Security Layer, Domain Logic — Pricing/Footprint, Tests/Frontend-Contract/Migration-Target)

---

## Summary

The backend is a ~114-file Spring Boot application (`pl.devstyle.aj`, flattened under `src/backend/` with no `pom.xml`/`build.gradle`, no `application.properties`, no Liquibase changelog, and **no tests** — it is not currently buildable from this repo alone). It implements five REST verticals (category, product, plugin, plugin-object, footprint) plus a hand-built OAuth2 authorization server layered on stateless HS256 JWT auth, and a genuinely reusable "pricing archetype" domain library that the footprint module repurposes for carbon-accounting. The single hardest constraint is the frontend/plugin contract: raw unverified client-side JWT decoding, two incompatible error-response shapes (legacy flat `ErrorResponse` vs RFC7807 `ProblemDetail` for footprint only), and an OAuth2 token-exchange bridge (`mcp:read/mcp:edit → READ/EDIT`) that external MCP clients depend on — all of which must be bit-for-bit replicated by the FastAPI rewrite even though the underlying persistence/schema (JOOQ-implied, Liquibase-absent) must be reverse-engineered from JPA annotations.

---

## Files Identified

### Primary Files

**`src/backend/.../api/AuthController.java`, `CategoryController.java`, `ProductController.java`, `PluginController.java`, `PluginDataController.java`, `PluginObjectController.java`** — full REST surface for auth/category/product/plugin/plugin-data/plugin-object; defines every route, DTO shape, and validation rule the FastAPI routers must reproduce exactly.

**`src/backend/.../footprint/web/FootprintController.java`, `export/FootprintExportController.java`, `api/OAuth2MetadataController.java`** — footprint calculation/export endpoints and OAuth2 discovery metadata endpoint; footprint uses a distinct RFC7807 error convention that must coexist with the legacy one.

**`src/backend/.../core/error/GlobalExceptionHandler.java`, `ErrorResponse.java`** and **`footprint/api/exception/FootprintExceptionHandler.java`** — the two parallel error-response conventions (legacy flat envelope vs RFC7807 ProblemDetail) that the frontend explicitly branches on (`problem.ts`); both must be replicated verbatim.

**`src/backend/.../core/security/` (SecurityConfiguration, JwtAuthenticationFilter, JwtTokenProvider, CustomUserDetailsService)** — CORS, filter chain, JWT claim shape (`sub`, `permissions[]`, HS256 shared secret), and the full path→permission authorization matrix; this is the single source of truth plugins rely on for client-side permission checks.

**`src/backend/.../core/oauth2/` (full package: PublicClientRegistrationFilter, OAuth2AuthorizationFilter, OAuth2TokenFilter, OAuth2IntrospectionFilter, AuthorizationCodeService, RefreshTokenService, OAuth2ClientAuthenticator, RegisteredClientEntity, DatabaseRegisteredClientRepository)** — hand-built OAuth2 authorization server (auth-code+PKCE, rotating refresh tokens, custom token-exchange grant for MCP `mcp:*→READ/EDIT` mapping, introspection); high complexity, external MCP-client compatibility constraint.

**`src/backend/.../core/BaseEntity.java` and all entities (Category, Product, User, PluginDescriptor, PluginObject, RegisteredClientEntity, FootprintAuditEntity)** — JPA mapping source-of-truth standing in for the absent Liquibase schema; must be reverse-engineered into the new ORM/migration layer.

**`src/backend/.../product/DbProductQueryService.java`, `plugin/DbPluginObjectQueryService.java`** — jOOQ-based dynamic filtering/sorting query services implementing the bespoke JSON-path filter mini-language used by both product and plugin-object listing endpoints; no ORM ("ORM-bypass") ports needed for the ORM the rewrite chooses.

**`src/backend/.../archetype/pricing/` (Calculator, Component/SimpleComponent/CompositeComponent, ComponentVersion, Applicability, Validity, ParameterValue, QuantityExtractor)** — framework-agnostic pricing/rating engine (zero Spring dependencies); cleanly portable to plain Python dataclasses/Pydantic.

**`src/backend/.../footprint/internal/BreakdownTreeBuilder.java`, `ComponentTreeRegistry.java`, `RoundingPolicy.java`, `BreakdownScaler.java`**, **`footprint/api/DefaultFootprintFacade.java`** — the recursive footprint calculation engine and orchestration (product-attribute merge, root-level warnings, PER_100G rescaling); the core business logic to port exactly.

**`src/backend/.../footprint/audit/` (FootprintCalculatedEvent, FootprintAuditListener, FootprintAuditMapper, FootprintAuditRepository)** — async, at-least-once, idempotent (unique `correlationId`) audit persistence decoupled from the request path; needs a Python async-task equivalent (BackgroundTasks/Celery/tenacity).

### Related Files

**`src/frontend/src/api/*.ts`, `client.ts`, `problem.ts`, `AuthContext.tsx`, `AuthGuard.tsx`** — not modified by this migration, but define the exact contract (request/response shapes, error envelope detection, JWT claim usage, no-refresh-token login flow) the new backend must satisfy byte-for-byte.

**`.maister/docs/project/tech-stack.md`, `.maister/docs/project/architecture.md`, `.maister/docs/standards/testing/backend-testing.md`** — existing project docs; **confirmed stale/aspirational** (describe a Liquibase changelog, test classes, and a "pre-alpha scaffolding" backend that do not exist). Do not treat as ground truth for current state; do treat the testing standard as the target test strategy for the new pytest suite.

**`src/frontend/vite.config.ts`** — likely proxies `/api` to the backend in dev; worth checking when standing up the FastAPI dev server (not yet confirmed by agents).

---

## Current Functionality

### Key Components/Functions

- **AuthController.login**: username/password → JWT `{sub, permissions[], iat, exp}` via `AuthenticationManager` + `CustomUserDetailsService`; manually returns 401 bypassing the global handler.
- **CategoryController / ProductController**: standard CRUD, no pagination anywhere; Product listing supports category filter, case-insensitive search, whitelisted sort, and a repeatable `pluginFilter={pluginId}:{jsonPath}:{operator}:{value}` mini-language executed via jOOQ with bind-parameter safety.
- **PluginController / PluginDataController / PluginObjectController**: plugin manifest CRUD, per-product arbitrary JSON plugin data (copy-on-write merge into `products.plugin_data` JSONB), and a generic polymorphic plugin-object store (composite unique key `pluginId/objectType/objectId`, optional loose `entityType/entityId` reference with no FK) with the same filter mini-language and a hard-capped `limit` (1000).
- **FootprintController/FootprintFacade/BreakdownTreeBuilder**: computes a carbon-footprint breakdown tree (materials/transport/packaging/cold-storage) from per-request parameters merged with stored product attributes; supports STRICT/LENIENT missing-factor handling, TOTAL/PER_100G normalization, dry-run mode, and async audit-event publication.
- **FootprintExportController/BreakdownCsvFlattener**: replays a *previously computed* audit row (by `correlationId`) as a flattened 12-column CSV — not a live recalculation.
- **OAuth2 authorization server** (custom, not Spring Authorization Server's runtime): DCR (`/oauth2/register`), authorize+PKCE, token (auth-code/refresh/token-exchange), introspection; issues a second JWT type with fixed 15-min expiry and `scopes` claim, bridging MCP `mcp:read/mcp:edit` scopes to app `READ/EDIT` permissions.

### Data Flow

Request → `JwtAuthenticationFilter` populates `SecurityContext` from `Authorization: Bearer` header or `_token` form param → `SecurityConfiguration`'s permission matrix authorizes by path+method → controller validates DTO → service (Category/Product) or facade (Footprint) executes business rules → JPA entity persisted via `saveAndFlush` (Category/Product) or jOOQ dynamic query executed directly against generated table metadata (Product listing, PluginObject listing) → response DTO built (bypassing entity hydration for jOOQ paths) → for footprint, an audit event is additionally published post-response and persisted asynchronously on a dedicated thread pool with retry/idempotency.

---

## Dependencies

### Imports (What This Depends On)

- Spring Boot WebMVC, Spring Data JPA, Spring Security (core primitives reused as value objects only — no actual Spring Authorization Server filter chain), jOOQ (generated table metadata implying an out-of-band schema), Jackson (manual JSONB (de)serialization), Micrometer (timers/counters, with a fallback no-op registry), Spring Retry (`@Retryable`/`@Recover`), Lombok.
- **No Liquibase, no build file (pom.xml/build.gradle), no application.properties/yml** exist in-repo — externalized config (`app.jwt.secret`, `app.cors.allowed-origins`, etc.) and the real DB schema are not captured anywhere in this repository and must be reconstructed.

### Consumers (What Depends On This)

- **`src/frontend/`** (React SPA): consumes every REST endpoint, both error-envelope shapes, the app-JWT claim shape, and has zero refresh-token usage (uses only `/api/auth/login`).
- **`plugins/`** (plugin apps): consume plugin manifest/data/object endpoints, decode the app JWT **client-side without signature verification** to check `permissions`, and forward `Authorization: Bearer` headers verbatim via `createServerSDK`.
- **External MCP clients**: consume the OAuth2 discovery metadata, authorization-code+PKCE flow, and the token-exchange grant (`mcp:read`/`mcp:edit` scopes).

**Consumer Count**: 2 first-party consumers (frontend, plugin apps) + unspecified external MCP clients.
**Impact Scope**: High — the API contract, JWT claim shape, and both error-response conventions are hard external constraints; any deviation breaks the frontend, in-repo plugins, or third-party MCP integrations without recourse to change the consumers (task explicitly requires unchanged contract).

---

## Test Coverage

### Test Files

**None.** No `src/test/` directory, no `*Test.java`/`*Tests.java` files anywhere in the repository.

### Coverage Assessment

- **Test count**: 0.
- **Gaps**: Everything — there is no existing test suite to port or use as a behavioral oracle. `AjApplicationTests.java`, `TestAjApplication.java`, and `TestcontainersConfiguration.java` are referenced only in stale documentation and do not exist. The project also lacks a build file (no `pom.xml`/`build.gradle`), so the Java backend cannot currently be compiled or run as-is — there is no working baseline to diff behavior against beyond static code reading.
- Because there's no test oracle, the FastAPI rewrite's own test suite (per `standards/testing/backend-testing.md` — pytest + testcontainers-python) will need to encode expected behavior newly derived from this static analysis, particularly around edge cases (STRICT/LENIENT footprint handling, filter-DSL parsing, OAuth2 grant validation) that have no executable spec today.

---

## Coding Patterns

### Naming Conventions

- **Packages**: `pl.devstyle.aj.<domain>` (category, product, footprint, core.oauth2, core.security, core.plugin, archetype.pricing).
- **Entities**: PascalCase, suffixed by domain noun (Category, Product, PluginDescriptor, PluginObject, RegisteredClientEntity, FootprintAuditEntity); DTOs suffixed `Request`/`Response`.
- **Files**: one class per file, `*Controller`, `*Service`, `*Repository`, `*Exception`, `*Filter` suffix conventions strictly followed.

### Architecture Patterns

- **Style**: Layered Spring MVC (Controller → Service/Facade → Repository/jOOQ), with one hexagonal-ish module (footprint: `api/`, `internal/`, `internal.ports/`, `spi.stub/`, `web/`, `audit/`, `export/`, `config/`) and one pure-domain library with no framework coupling (`archetype.pricing`).
- **State Management**: Stateless JWT auth (no server session); in-memory `ConcurrentHashMap` used for OAuth2 authorization codes and refresh tokens (not persisted — a scaling/restart consideration for the rewrite); PostgreSQL JSONB used pervasively for semi-structured data (plugin data, plugin objects, footprint audit breakdown).
- **Domain modeling**: sealed interfaces + records for exhaustive-pattern-matched hierarchies (Component, BreakdownNode, FootprintCalculationException) — needs a Python equivalent (discriminated `Union[Literal[...]]` + Pydantic, or ABC + `assert_never`).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count (backend) | ~114 Java files across 5+ domain verticals | High |
| Dependencies | Spring Web/Data/Security, jOOQ, Jackson, Micrometer, Spring Retry (6+ major framework deps, all need FastAPI-ecosystem equivalents) | High |
| Consumers | Frontend SPA + in-repo plugin apps + external MCP clients, all with hard contract constraints | High |
| Test coverage | 0 tests | High (risk) |
| Schema/migration state | No Liquibase, no build file, no config — must be reverse-engineered | High (risk) |

### Overall: Complex

This is a full-stack framework rewrite (not an incremental change) touching REST API, ORM/schema, dynamic-query layer, custom auth/OAuth2 server, async audit pipeline, and a domain-specific calculation engine — with zero executable tests and no recoverable build/schema artifacts to validate against. The domain logic itself (pricing archetype, footprint engine) is well-isolated and genuinely portable; the risk is concentrated in the auth/OAuth2 layer and in faithfully reconstructing the undocumented schema and dual error-response contract.

---

## Key Findings

### Strengths
- The pricing archetype (`archetype.pricing`) is genuinely framework-agnostic — pure value objects, one interface, one enum — and should port cleanly to plain Python/Pydantic with minimal redesign.
- The footprint module's separation of concerns (facade/internal engine/ports/spi-stub/web/audit/export) gives a clear seam for the Python rewrite to mirror package-by-package.
- The authorization matrix is centralized in one file (`SecurityConfiguration`), giving a single place to read the entire path→permission contract rather than scattered `@PreAuthorize` annotations.
- Clear repository-per-aggregate pattern with only a handful of custom query methods (mostly JOIN-FETCH to avoid N+1); the two jOOQ-based dynamic query services are the only non-trivial persistence logic to reimplement.

### Concerns
- **No tests exist anywhere** — the rewrite has no executable behavioral oracle; correctness must be inferred from static code reading alone, raising defect risk.
- **No Liquibase changelog, no build file, no application config** — the real database schema, environment variables, and even whether the Java app currently runs are all unknown/unverifiable from this repo; schema must be reverse-engineered from JPA annotations and jOOQ-generated-table naming conventions, including at least one FK (`products.category_id → categories.id`) that is relied upon for business logic (`CategoryHasProductsException`) but never explicitly declared in-repo.
- **Two incompatible error-response conventions** (legacy flat `ErrorResponse` vs RFC7807 `ProblemDetail` for footprint only) must both be preserved — the frontend explicitly branches on shape.
- **Client-side JWT decoding without signature verification** by plugins is a hard, unusual compatibility constraint: the new JWT must remain a plain unencrypted JWS with an un-prefixed, flat `permissions`/`scopes` string array and `sub` claim; permissions are baked in at issuance and never re-checked against the DB per request.
- **Hand-built OAuth2 authorization server** (not using a battle-tested library's runtime, only its domain model classes) with in-memory (non-persisted) authorization-code and refresh-token stores, a hardcoded `mcp:*→READ/EDIT` scope-mapping table, and two independently-duplicated OAuth2-error→HTTP-status mapping switches — meaningful surface area and duplication to consolidate carefully during rewrite, while preserving exact wire behavior (grant types, PKCE requirements, token TTLs, `/.well-known/oauth-authorization-server` metadata shape).
- Defaulting logic in the footprint request path is duplicated (once in the controller, once again in `DefaultFootprintFacade.withDefaults`) — worth collapsing, but must confirm behavior is identical before doing so.
- `BreakdownScaler`'s PER_100G path throws an untyped `IllegalArgumentException` (not one of the module's typed domain exceptions) — a gap to normalize as a proper typed error in the Python port.

### Opportunities
- Consolidate the two duplicated OAuth2-error→HTTP-status mapping switches into one function during the rewrite (behavior-preserving cleanup).
- Normalize the untyped `IllegalArgumentException` in `BreakdownScaler` into the typed footprint exception hierarchy.
- Collapse the double-defaulting of footprint request parameters (controller + facade) into a single location.
- Since there is no existing test suite, the rewrite is a clean opportunity to establish the pytest + testcontainers-python strategy from `standards/testing/backend-testing.md` from day one, using this analysis's documented request/response contracts as the specification to test against.

---

## Impact Assessment

- **Primary changes**: Entire `src/backend/` is replaced — REST routers (FastAPI), ORM models + migrations (SQLAlchemy + Alembic, schema reverse-engineered from JPA entities), the two jOOQ-based dynamic query services (SQLAlchemy Core `select()` with the same regex-validated JSON-path filter DSL), JWT auth + custom OAuth2 authorization server (PyJWT/python-jose + hand-rolled endpoints matching exact claim/grant/metadata shapes), the pricing archetype and footprint calculation engine (dataclasses/Pydantic, ported algorithm-for-algorithm), and the async audit pipeline (BackgroundTasks/Celery/tenacity-based retry with idempotency on `correlationId`).
- **Related changes**: Packaging/tooling introduced from scratch (`pyproject.toml`/uv, no existing Python artifacts to reconcile); Docker/CI introduced from scratch (none exists today); `src/frontend/vite.config.ts` dev-proxy target should be checked/updated to point at the new FastAPI dev server.
- **Test updates**: A full pytest + testcontainers-python suite must be written from scratch (no existing tests to port), using this document's endpoint/DTO/error-shape inventory as the specification.

### Risk Level: High

Full rewrite of every backend layer with zero existing tests, an unrecoverable/undocumented database schema and application config, and hard external compatibility constraints (frontend, in-repo plugins, external MCP clients) around JWT claim shape, dual error-response conventions, and OAuth2 wire behavior that cannot be renegotiated. The domain logic (pricing/footprint) is low-risk to port faithfully; the auth/OAuth2 layer and the undocumented schema/config are the highest-risk areas.

---

## Recommendations

**This is a "creating new capability in a new stack while preserving an external contract" migration** — recommendations follow that framing:

1. **Contract-first approach**: Before writing any FastAPI code, formalize the request/response DTO shapes, both error-envelope conventions, and the JWT claim shape documented in this report as an explicit contract (e.g., OpenAPI spec or a set of golden-file examples) that the new implementation is tested against. This report's "Files Identified" and "Current Functionality" sections are the source material.
2. **Schema reconstruction first**: Reverse-engineer the database schema from JPA entity annotations (Agent 2's field-by-field inventory) into Alembic migrations before any endpoint work — this includes explicitly declaring the `products.category_id → categories.id` FK that the current codebase relies on implicitly, and deciding on the `@Version`-as-`updatedAt` semantics (real optimistic-lock column vs plain audit timestamp) for each entity that uses it.
3. **Auth/OAuth2 layer needs the most care and its own focused test suite**: preserve the exact JWT claim shape (flat, unprefixed, unencrypted JWS), the HS256 shared-secret scheme (or make a deliberate, documented decision to change it, understanding it breaks client-side decoding unless coordinated), the `mcp:read/mcp:edit ↔ READ/EDIT` mapping table, and the RFC8414 metadata shape at `/.well-known/oauth-authorization-server`. Test this in isolation from the CRUD endpoints since it is the highest-risk, least-conventional part of the system.
4. **Port the pricing/footprint domain logic algorithm-for-algorithm** rather than reinterpreting it — Agent 4's Spring-mechanism→Python-equivalent mapping table (events→BackgroundTasks/Celery, `@Retryable`→tenacity, `@Transactional(REQUIRES_NEW)`→explicit new session, sealed interfaces→discriminated unions) is directly actionable guidance for this piece.
5. **Reimplement the JSON-path filter mini-language carefully**: both product and plugin-object listing depend on the same colon-delimited, regex-validated, bind-parameterized filter DSL backed by jOOQ; SQLAlchemy Core with the same regex validation before splicing raw JSON-path expressions (never the comparison value) into the query is the direct equivalent.
6. **Build the pytest test suite incrementally alongside each ported module** (per `standards/testing/backend-testing.md`), since there is no existing suite to lean on — treat this report's documented behaviors (missing-factor strictness handling, applicability pruning, PER_100G rescaling, filter-DSL edge cases, OAuth2 grant validation) as the test specification.
7. **Introduce Docker/CI and packaging (`uv`/`pyproject.toml`) from scratch** as part of this migration, since none exists today — this is a good opportunity to also fix the fact that the current Java backend has no build file and cannot be run/verified as-is.

---

## Next Steps

Invoke the gap-analyzer to compare this current-state inventory against the desired end state (FastAPI + uv backend with byte-for-byte contract preservation), producing a concrete gap list to drive specification and planning phases — with particular attention to the auth/OAuth2 layer, schema reconstruction, and the dual error-response convention, which carry the highest risk of subtle contract breakage.
