# Implementation Plan: Java/Spring Boot → Python/FastAPI Backend Migration

## Overview

Total Steps: ~97
Task Groups: 15
Expected Verification Checkpoints: no automated test suite is in scope (clarification Q2) — `ruff` + `mypy` are the only static quality gates. In place of "expected tests," each group below writes a **throwaway manual-verification script** (curl/httpx, discarded or kept in scratch, never committed as a pytest suite) and its acceptance criteria are concrete request/response checks against `implementation/spec.md`'s route/schema/behavior tables. Group 15 consolidates every prior group's script into one end-to-end pass — this substitutes, weakly, for the deferred test oracle per `analysis/target-state-plan.md` §4 step 6.
Has Testing Group: Group 15 (Manual Contract Verification Pass) serves this role — see note above on why it isn't test-count based.

This plan follows the phased strategy already locked in `analysis/target-state-plan.md` §4 and `implementation/spec.md`'s Migration Strategy Reference section verbatim: scaffolding → schema-first → core infra → auth/OAuth2 in isolation (split fine-grained per the task brief) → category → product → plugin → footprint (split fine-grained per the task brief) → system wiring → docs → manual verification. No dual-run/live-rollback mechanics are planned — see `analysis/rollback-plan.md`: this is a first-ever deployment, so "rollback" per task group means reverting that group's commit(s) (and downgrading its Alembic migration, if any) rather than any live traffic-shifting mechanism.

---

## Implementation Steps

### Task Group 1: Project Scaffolding, Tooling & Java Removal
**Dependencies:** None
**Files to Modify:** `src/backend/**/*.java` (removed — entire existing Java tree, ~114 files), `src/backend/pyproject.toml`, `src/backend/uv.lock`, `src/backend/Dockerfile`, `src/backend/docker-compose.yml`, `src/backend/.env.example`, `src/backend/alembic.ini`, `src/backend/alembic/env.py`, `src/backend/alembic/versions/.gitkeep`, `src/backend/app/__init__.py` + `__init__.py` in every subpackage (`core/`, `oauth2/`, `auth/`, `category/`, `product/`, `plugin/`, `footprint/{archetype,domain,engine,audit,export}/`, `system/`), `src/backend/app/main.py` (placeholder only)
**Estimated Steps:** 7

- [x] 1.0 Complete project scaffolding layer
  - [x] 1.1 Write a throwaway scaffold-verification checklist (not pytest) enumerating every directory/file expected to exist per spec.md's Target Project Layout tree — used to self-check this group at 1.7
  - [x] 1.2 `git rm` the entire existing `src/backend/` Java tree (controllers, entities, services, filters, archetype, footprint packages — all ~114 `.java` files per `analysis/current-state-analysis.md`'s file inventory); confirm no build file (`pom.xml`/`build.gradle`) exists to remove either (none does) — NOTE: tree was untracked in git, `rm -rf` used as functional equivalent
  - [x] 1.3 Author `src/backend/pyproject.toml` (uv-managed) with pinned deps from spec.md's Dependencies table: `fastapi` 0.141.x, `uvicorn[standard]`, `sqlalchemy` 2.0.44, `asyncpg` 0.31.0, `alembic` 1.17.1, `pyjwt>=2.13.0`, `bcrypt`, `pydantic` v2, `pydantic-settings`, `tenacity`; dev-only: `ruff`, `mypy` — re-verify each pin against actual latest at implementation time per spec.md's note, do not treat as frozen
  - [x] 1.4 Create the full `app/` package skeleton (empty `__init__.py` files) matching spec.md's Target Project Layout exactly, and a placeholder `app/main.py` that only instantiates `FastAPI()` (real router/handler wiring deferred to Group 13)
  - [x] 1.5 Configure `ruff` (lint + format) and `mypy` (strict-ish — required, not optional, per spec.md's note that footprint's discriminated-union exhaustiveness checking depends on it) in `pyproject.toml`
  - [x] 1.6 Write multi-stage `Dockerfile` (`uv sync --frozen --no-dev` build stage → slim runtime running `uvicorn app.main:app --host 0.0.0.0 --port 8080`), `docker-compose.yml` (`postgres:18` + this service), and `.env.example` documenting every required env var: `JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `DATABASE_URL`, `FOOTPRINT_AUDIT_RETRY_MAX_ATTEMPTS` (default 3), `FOOTPRINT_AUDIT_RETRY_DELAY_MS` (default 200), `FOOTPRINT_AUDIT_RETRY_MULTIPLIER` (default 2.0)
  - [x] 1.7 Run the scaffold-verification checklist from 1.1: `uv sync` resolves cleanly, `docker-compose config` validates, `ruff check`/`mypy` both run cleanly on the near-empty tree, zero `*.java` files remain

**Acceptance Criteria:**
- `find src/backend -name '*.java'` returns zero results
- `uv lock && uv sync --frozen` succeeds inside `src/backend/`
- `docker-compose -f src/backend/docker-compose.yml config` succeeds without error
- Every directory in spec.md's Target Project Layout exists (with `__init__.py`) under `src/backend/app/`
- `ruff check` and `mypy` both exit 0 on the (near-empty) `app/` tree
- Dockerfile/compose bind uvicorn to port 8080, matching `src/frontend/vite.config.ts`'s dev-proxy target

**Rollback:** Revert the commit(s) for this task group — restores the Java `src/backend/` tree and removes the Python scaffolding. No Alembic migration exists yet; nothing to downgrade.

---

### Task Group 2: Database Schema — Alembic Initial Migration
**Dependencies:** 1
**Files to Modify:** `src/backend/alembic/versions/0001_initial_schema.py`, `src/backend/alembic/env.py`, `src/backend/alembic.ini`
**Estimated Steps:** 5

- [x] 2.0 Complete schema-first database layer
  - [x] 2.1 Write a throwaway schema-verification psql/SQL script (not pytest) enumerating every expected table/column/constraint from spec.md's Database Schema Spec, to run against the migrated DB at 2.5
  - [x] 2.2 Author `0001_initial_schema` reconstructing every table in dependency order: `categories`, `users`, `user_permissions` (plain association table, no ORM identity), `oauth2_registered_client`, `plugins` (string PK, own base), `products` (FK→`categories.id` NOT NULL), `plugin_objects` (composite unique), `footprint_audit_log` (correlation_id unique) — Postgres `SEQUENCE` per table (`category_seq`, `product_seq`, `plugin_object_seq`, `footprint_audit_log_id_seq`, `user_seq`), JSONB via `postgresql.JSONB`, `TEXT[]` via `postgresql.ARRAY`
  - [x] 2.3 Explicitly declare all 6 checklist items from spec.md's FK/constraint reconstruction checklist (none exist as DDL anywhere in the Java repo): (1) `products.category_id → categories.id` NOT NULL, (2) `plugin_objects` UNIQUE`(plugin_id, object_type, object_id)`, (3) `oauth2_registered_client.client_id` unique, (4) `footprint_audit_log.correlation_id` unique, (5) `users.username` unique, (6) `user_permissions` as plain `Table(...)`, not a mapped class
  - [x] 2.4 Write `downgrade()` for `0001` dropping every table/sequence in reverse dependency order
  - [x] 2.5 Bring up `docker-compose up -d db` (postgres:18), run `alembic upgrade head`, run the verification script from 2.1 via psql `\d+` against every table — NOTE: fixed docker-compose.yml postgres:18 volume mount path (breaking change in image, /var/lib/postgresql/data -> /var/lib/postgresql), added ix_products_category_id index

**Acceptance Criteria:**
- `alembic upgrade head` against a fresh `postgres:18` container succeeds with no errors
- `\d products` shows `category_id` NOT NULL with an FK to `categories(id)`
- `\d plugin_objects` shows a UNIQUE constraint spanning exactly `(plugin_id, object_type, object_id)` and no single-column uniqueness on any of those three
- `\d oauth2_registered_client` shows `client_id` UNIQUE; `\d footprint_audit_log` shows `correlation_id` UNIQUE; `\d users` shows `username` UNIQUE
- `\d user_permissions` shows a plain two-column table (`user_id`, `permission`) with no independent primary key beyond the FK
- `alembic downgrade base` cleanly drops every table with no leftover sequences/types

**Rollback:** `alembic downgrade base` (or to the revision before 0001) against the running DB, then revert the commit(s) for this task group.

---

### Task Group 3: Core Cross-Cutting Infrastructure
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/config.py`, `src/backend/app/db.py`, `src/backend/app/core/base_model.py`, `src/backend/app/core/errors.py`, `src/backend/app/core/security.py`, `src/backend/app/core/filter_dsl.py`
**Estimated Steps:** 8

- [x] 3.0 Complete core cross-cutting infrastructure
  - [x] 3.1 Write a throwaway verification script that inserts/updates a `Category` row twice via the `BaseEntity` mixin against Group 2's live schema and asserts `updated_at` changes and a stale second write raises a version-conflict error
  - [x] 3.2 Implement `app/config.py`: Pydantic Settings reading `JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `DATABASE_URL`, `FOOTPRINT_AUDIT_RETRY_*` — no hardcoded secret defaults, explicit required-env-var startup errors on missing values (per requirements.md R3, no real secret values are recoverable from this repo)
  - [x] 3.3 Implement `app/db.py`: async engine + `async_sessionmaker` + a `get_db` FastAPI dependency yielding `AsyncSession` per request
  - [x] 3.4 Implement `app/core/base_model.py`: declarative Base + `BaseEntity` mixin (`id` via `Sequence`, `created_at` set-once, `updated_at` as SQLAlchemy `version_id_col` with a `version_id_generator` returning `datetime.utcnow()` — preserving the Java `@Version`-as-timestamp dual-purpose exactly per fixed decision #3; do NOT split into separate audit-timestamp + integer version columns)
  - [x] 3.5 Implement `app/core/errors.py`: `ErrorResponse` model (field order `status, error, message, fieldErrors, timestamp`), `EntityNotFoundException`, `BusinessConflictException`, and exception handlers implementing the full legacy-envelope priority table from spec.md's Error-Handling Spec (`EntityNotFoundException`→404, `BusinessConflictException`→409, DB integrity/FK violation→409 fixed `"Data integrity violation"`, Pydantic validation→400 with `fieldErrors`, access-denied→403 fixed `"Access denied"`, generic value/argument error→400 echoing the message, catch-all→500 fixed `"An unexpected error occurred"`)
  - [x] 3.6 Implement `app/core/security.py`: password hashing via direct `bcrypt.hashpw`/`bcrypt.checkpw` (not passlib); base64-decode-before-HMAC-key-use helper (JWT encode/decode itself deferred to Group 4, which needs the permission-matrix design first)
  - [x] 3.7 Implement `app/core/filter_dsl.py`: shared regex constants only (`^[a-zA-Z0-9_.-]+$` for pluginId/jsonPath, operator allowlist `eq|gt|lt|exists|bool`) — explicitly NOT a shared parser (Groups 8 and 9 keep their two filter-DSL parsers separate per spec.md's Reusability note)
  - [x] 3.8 Run the verification script from 3.1 against the live Group-2 DB; mount one throwaway route to confirm a Pydantic validation error produces the exact legacy envelope shape, then remove it

**Acceptance Criteria:**
- Two sequential UPDATEs to the same row produce two different `updated_at` values; a stale write (using the first `updated_at` as the optimistic-lock token) raises a version-conflict error
- A raised `EntityNotFoundException("Product", 42)` returns exactly `{"status":404,"error":"Not Found","message":"Product with id 42 not found","fieldErrors":null,"timestamp":"<naive-local-datetime>"}` with `Content-Type: application/json`
- A Pydantic validation failure returns `{"status":400,"error":"Bad Request","message":"Validation failed","fieldErrors":{field: message}}` (first message wins per field)
- `app/config.py` raises a clear startup error (not a silent default) when `JWT_SECRET`/`DATABASE_URL` are unset

**Rollback:** Revert the commit(s) for this task group. No schema change (Alembic untouched) — nothing to downgrade.

---

### Task Group 4: Auth — JWT & Permission Matrix
**Dependencies:** 3
**Files to Modify:** `src/backend/app/core/security.py`, `src/backend/app/core/auth_deps.py`, `src/backend/app/auth/models.py`, `src/backend/app/auth/router.py`
**Estimated Steps:** 7

- [x] 4.0 Complete JWT auth and the centralized permission matrix
  - [x] 4.1 Write a throwaway curl/httpx verification script covering: valid login, invalid credentials, missing Authorization header on a protected route, wrong permission on a protected route, `_token` form/query-param fallback
  - [x] 4.2 Implement `app/auth/models.py`: `User` ORM model (`username` UNIQUE, `password_hash` VARCHAR(72)) and `user_permissions` association table; `Permission` enum (`READ`, `EDIT`, `PLUGIN_MANAGEMENT`)
  - [x] 4.3 Finalize `app/core/security.py` JWT encode/decode: `jwt.encode({sub, permissions, iat, exp}, key=base64.b64decode(JWT_SECRET), algorithm="HS256")` — exact claim order `sub, permissions, iat, exp`, no `iss` claim; `exp` from `JWT_EXPIRATION_MS`
  - [x] 4.4 Implement `app/core/auth_deps.py`: token extraction (`Bearer ` header, case-sensitive 7-char prefix, else `_token` form/query param, else unauthenticated); `get_current_principal` decodes JWT, reads `permissions` falling back to `scopes` if absent (permissions checked first); `require_any(*permissions)` implementing the full 25-entry authorization matrix from spec.md **verbatim, in the exact evaluation order given** (first-match-wins) — public entries 1-10, `READ`/`EDIT`/`mcp:*`-bridge entries 11-21, `PLUGIN_MANAGEMENT`-only entries 22-24 (no mcp bridge), catch-all 25; plus custom 401/403 handlers returning the hardcoded legacy bodies (`"Authentication required"` / `"Access denied"`), not FastAPI's default `{"detail":...}` — NOTE: resolved a spec ambiguity, row 10 (SPA-fallback/non-/api/ path) scoped to GET only so POST /oauth2/authorize correctly falls through to row 25 (authenticated), see work-log
  - [x] 4.5 Implement `app/auth/router.py`: `POST /api/auth/login` — public; validates body non-blank; on success strips internal `PERMISSION_` prefix, generates token, returns `200 {"token": "..."}`; on invalid credentials, **manually constructs** the 401 `ErrorResponse` directly in the handler (bypassing the generic exception-handler path), exact message `"Invalid username or password"`
  - [x] 4.6 Seed one throwaway user (bcrypt-hashed password) via manual SQL insert against the Group-2 DB for use by the verification script
  - [x] 4.7 Run the verification script from 4.1 against a running uvicorn instance with only this router + one throwaway protected dummy route mounted

**Acceptance Criteria:**
- Valid login returns `200 {"token": "<JWS>"}`; decoding it (unverified) shows claim order `sub, permissions, iat, exp`, no `iss`
- Invalid credentials returns `401 {"status":401,"error":"Unauthorized","message":"Invalid username or password","fieldErrors":null,"timestamp":...}`
- A protected route with no Authorization header returns `401 {"status":401,"error":"Unauthorized","message":"Authentication required",...}`
- A protected route with a valid token lacking the required permission returns `403 {"status":403,"error":"Forbidden","message":"Access denied",...}`
- Supplying the token via `_token` form param (no Authorization header) succeeds identically to the header form
- `GET /api/health` and any non-`/api/` path succeed with no token at all (matrix entries 1-10)

**Rollback:** Revert the commit(s) for this task group. No schema change (`users`/`user_permissions` already exist from Group 2) — nothing to downgrade.

---

### Task Group 5: OAuth2 — Client Registration & Authorization
**Dependencies:** 4
**Files to Modify:** `src/backend/app/oauth2/models.py`, `src/backend/app/oauth2/stores.py`, `src/backend/app/oauth2/errors.py`, `src/backend/app/oauth2/client_auth.py`, `src/backend/app/oauth2/router.py`
**Estimated Steps:** 8

- [x] 5.0 Complete OAuth2 dynamic client registration and the authorize endpoint
  - [x] 5.1 Write a throwaway verification script covering: DCR success + every validation-failure message, authorize success (302 with code+state), and every one of the 7 authorize validation-order failures mapped to the correct OAuth2 error code via substring matching
  - [x] 5.2 Implement `app/oauth2/models.py`: `RegisteredClient` ORM model matching `oauth2_registered_client` (UUID PK, `TEXT[]` array columns via `postgresql.ARRAY(String)`)
  - [x] 5.3 Implement `app/oauth2/errors.py`: `OAuth2Error` enum, `OAuth2ErrorResponse` model (`error`, `error_description`, `error_uri` always **omitted**, not null — actually absent from the JSON), and the single consolidated status-mapper (`invalid_client`→401, `unauthorized_client|access_denied`→403, `server_error`→500, everything else→400) — consolidating the 4 duplicated Java switches into one function (safe cleanup per spec.md, since all 4 copies are identical)
  - [x] 5.4 Implement `app/oauth2/stores.py`: in-memory `dict` + `asyncio.Lock` authorization-code store (600s TTL, single-use, ~5-min cleanup sweep) — the refresh-token store lives in the same file but is finalized in Group 6
  - [x] 5.5 Implement `app/oauth2/client_auth.py`: `OAuth2ClientAuthenticator` — Basic header or POST-body client credential check, bcrypt-verified secret
  - [x] 5.6 Implement `POST /oauth2/register` in `app/oauth2/router.py`: full DCR validation per spec.md's verbatim messages (`client_name` required/≤255; `redirect_uris` conditional-required + https/loopback + no-fragment checks; `scope` subset-of-`ALLOWED_SCOPES` with the bracketed-list error format; `token_endpoint_auth_method` allowlist; `grant_types` allowlist) → 201 with the exact RFC7591-shaped body (`client_secret_expires_at: 0`)
  - [x] 5.7 Implement `POST /oauth2/authorize`: requires prior JWT auth (via Group 4's dependency — **not** in the permitAll matrix despite superficial appearances); validates in the exact 7-step order from spec.md; maps failure messages to OAuth2 error codes via the exact substring-match order (`"redirect_uri"`→`invalid_request` checked before `"client_id"`/`"PKCE"`/`"authenticated"`); on success generates a 256-bit URL-safe base64 code, stores `{client_id, redirect_uri, scope, code_challenge, code_challenge_method, username, permissions, created_at}` with 600s TTL, responds 302 to `redirect_uri?code=...&state=...` (state only if provided/non-empty) — **KNOWN GAP** (see work-log): "not authenticated" branch is structurally unreachable — `Depends(require_any())` raises the generic legacy 401 before the OAuth2-shaped `unauthorized_client` error path can fire; flagged for Group 15 verification pass
  - [x] 5.8 Run the verification script from 5.1 against a running instance with a client registered via 5.6, exercised through 5.7

**Acceptance Criteria:**
- `POST /oauth2/register` with a missing `client_name` → `400 {"error":"invalid_client_metadata","error_description":"client_name is required and cannot be empty"}`, no `error_uri` key present at all
- `POST /oauth2/register` with a valid minimal body → `201`, body contains `client_secret_expires_at: 0` and a one-time plaintext `client_secret`
- `POST /oauth2/authorize` without a valid JWT does not silently succeed (confirms this endpoint is functionally protected, not public)
- `POST /oauth2/authorize` with a bad `redirect_uri` → error code `invalid_request` (verify this specific case doesn't fall into a different bucket per the substring-match order)
- `POST /oauth2/authorize` for a public client with no PKCE params → error code `invalid_request`, message containing "PKCE is required for public clients"
- Successful authorize → `302` with `Location` containing `code=`, and `&state=<value>` present iff `state` was passed

**Rollback:** Revert the commit(s) for this task group. Schema unaffected (`oauth2_registered_client` already exists from Group 2) — nothing to downgrade.

---

### Task Group 6: OAuth2 — Token Exchange, Introspection & Metadata
**Dependencies:** 5
**Files to Modify:** `src/backend/app/oauth2/stores.py`, `src/backend/app/oauth2/router.py`, `src/backend/app/oauth2/metadata_router.py`
**Estimated Steps:** 9

- [x] 6.0 Complete the token/introspect/metadata surface of the OAuth2 server
  - [x] 6.1 Write a throwaway verification script covering all 3 token grants (success + every listed failure), introspect (valid/invalid/missing token), and metadata + client-info (including the empty-body 404)
  - [x] 6.2 Finalize `app/oauth2/stores.py`: refresh-token store (24h TTL, rotate-on-use, ~30-min cleanup sweep, same dict+Lock pattern as the authorization-code store)
  - [x] 6.3 Implement the `authorization_code` grant in `POST /oauth2/token`: exact validation order from spec.md (missing `code`/`redirect_uri`→`invalid_request`; expired/consumed/client_id-mismatch/redirect_uri-mismatch → the **same generic** `invalid_grant` message, never leaking which check failed; confidential-client secret check → `invalid_client`; PKCE verifier failure → the same generic `invalid_grant` message as expired-code); issues access token scoped to the **granted** scope (not the user's full permission set) + a refresh token
  - [x] 6.4 Implement the `refresh_token` grant: missing→`invalid_request`; invalid/expired/consumed→`invalid_grant` exact message; success **rotates** atomically (old invalidated, new issued, original scope reused, 24h TTL)
  - [x] 6.5 Implement the `urn:ietf:params:oauth:grant-type:token-exchange` grant (RFC 8693): client-auth required (missing/failed→`invalid_client`); missing `subject_token`/`subject_token_type`→`invalid_request`; unsupported `subject_token_type`→`invalid_request` with the exact interpolated message; invalid subject token→`invalid_grant`; scope mapping through the **fixed** `{"mcp:read":"READ","mcp:edit":"EDIT"}` table (unmapped entries silently dropped, insertion order preserved); issues new JWT with `aud=issuer`, **no** refresh token, `issued_token_type` field present
  - [x] 6.6 Apply the uniform response headers to all 3 grants: `Cache-Control: no-store`, `Pragma: no-cache`, `expires_in: 900` (hardcoded literal, kept separate from the `JWT_EXPIRATION_MS`-derived constant even though they currently agree); verify exact field order per grant type, `scope` field omitted entirely when null/empty
  - [x] 6.7 Implement `POST /oauth2/introspect`: client auth required; missing/unparseable `token`→`200 {"active": false}` (a valid response, not an error); valid token→200 with the exact key order and conditional fields (`scope` only if scopes claim present+non-empty; `iss`/`aud` only if present; `aud` single-string-or-array based on entry count)
  - [x] 6.8 Implement `app/oauth2/metadata_router.py`: `GET /.well-known/oauth-authorization-server` with the exact JSON shape and the shared base-URL resolution logic (`X-Forwarded-Proto`/`-Host`/`-Port`, port-omission rules) reused (not reimplemented) by both this endpoint and the token endpoint's `issuer` field; `GET /api/oauth2/client-info?client_id=`→200 with default `client_name` or **404 with an empty body** (not the standard envelope) if unknown
  - [x] 6.9 Run the verification script from 6.1 end-to-end: register→authorize→token(auth-code)→introspect→token(refresh, rotated)→token(token-exchange)

**Acceptance Criteria:**
- Full flow produces a valid access token whose introspection returns `{"active":true,...}` in the correct key order; a subsequent refresh attempt using the now-rotated-out refresh token fails with `invalid_grant`
- Token-exchange response contains **no** `refresh_token` field and includes `issued_token_type`; requesting scope `mcp:read` maps to a token whose granted permission is `READ` only
- All 3 grants' success responses carry `Cache-Control: no-store`, `Pragma: no-cache`, and `expires_in: 900`
- `GET /api/oauth2/client-info?client_id=nonexistent`→`404` with an **empty response body** (`size_download` of 0 via `curl -w`)
- `GET /.well-known/oauth-authorization-server` behind a simulated `X-Forwarded-Proto: https` header (no forwarded port) omits the port from every URL in the response
- `POST /oauth2/introspect` with `token=garbage`→`200 {"active": false}` (not 400/401)

**Rollback:** Revert the commit(s) for this task group. No schema change — nothing to downgrade.

---

### Task Group 7: Category Vertical
**Dependencies:** 4
**Files to Modify:** `src/backend/app/category/models.py`, `src/backend/app/category/schemas.py`, `src/backend/app/category/service.py`, `src/backend/app/category/router.py`
**Estimated Steps:** 6

- [x] 7.0 Complete the category vertical (reference module for the pattern)
  - [x] 7.1 Write a throwaway curl verification script for all 5 category routes, including the 409 category-has-products case
  - [x] 7.2 Implement `app/category/models.py`: `Category` ORM model on the shared `BaseEntity` mixin, business-key `__eq__`/`__hash__` on `name`
  - [x] 7.3 Implement `app/category/schemas.py`: `CategoryResponse`; `CreateCategoryRequest`/`UpdateCategoryRequest` (`name` required max100, `description` optional max500, no required check)
  - [x] 7.4 Implement `app/category/service.py` + `CategoryHasProductsException` (`BusinessConflictException` subclass) with the exact message `"Category with id {categoryId} cannot be deleted because it has associated products"`
  - [x] 7.5 Implement `app/category/router.py`: 5 routes with exact status codes (GET list sorted `created_at DESC`, no query params supported; GET-by-id 404; POST 201; PUT 200; DELETE 204/409-on-FK-violation) and permissions (`READ`/`mcp:read` for GET, `EDIT`/`mcp:edit` for write)
  - [x] 7.6 Run the verification script from 7.1, seeding a category with an attached product to trigger the 409 path

**Acceptance Criteria:**
- `GET /api/categories` returns `200`, results sorted `created_at DESC`, ignoring any query params passed
- `POST /api/categories`→`201`, response has exactly `id, name, description, created_at, updated_at`
- `DELETE` on a category with an attached product→`409 {"status":409,"error":"Conflict","message":"Category with id {id} cannot be deleted because it has associated products",...}`
- `DELETE` on an empty category→`204`, no body

**Rollback:** Revert the commit(s) for this task group. Schema unaffected (`categories` already exists from Group 2).

---

### Task Group 8: Product Vertical
**Dependencies:** 7, 4
**Files to Modify:** `src/backend/app/product/models.py`, `src/backend/app/product/schemas.py`, `src/backend/app/product/query_service.py`, `src/backend/app/product/service.py`, `src/backend/app/product/router.py`
**Estimated Steps:** 7

- [x] 8.0 Complete the product vertical including the jOOQ-equivalent dynamic filter/sort query service
  - [x] 8.1 Write a throwaway verification script for CRUD + every filter-DSL branch (sort whitelist/fallback, search, category filter, all 5 `pluginFilter` operators + every listed error message)
  - [x] 8.2 Implement `app/product/models.py`: `Product` ORM model (`NUMERIC(19,2)` price, `category_id` FK NOT NULL, `plugin_data` JSONB nullable, business key on `sku`), relationship to `Category` with explicit eager-join semantics for GET-by-id (avoid lazy-load per spec.md)
  - [x] 8.3 Implement `app/product/schemas.py`: `ProductResponse` (nests a full `CategoryResponse`, never just `category_id`); `CreateProductRequest`/`UpdateProductRequest` with the `photo_url` regex validator (`^https?://.*`, message `"Photo URL must start with http:// or https://"`) and `price > 0` validator
  - [x] 8.4 Implement `app/product/query_service.py` (`DbProductQueryService` port — **the single highest-precision port in this module**): sort whitelist `{name,price,sku,createdAt}` with silent fallback to `created_at DESC` on unknown/blank field; case-insensitive `search` substring on `name`; exact `category` match; `pluginFilter` parser — split on `:` limit 4, exact validation-order and exact error-message wording per spec.md (`< 3` parts, pluginId/jsonPath regex, operator allowlist, value-required-unless-`exists`, per-operator SQL: `eq` string-equals, `gt`/`lt` numeric cast with exact error message naming the operator, `exists` via `jsonb_exists`, `bool` cast); regex-validate pluginId/jsonPath **before** splicing into the path expression, only comparison values bound
  - [x] 8.5 Implement `app/product/service.py`: create/update 404 when `categoryId` doesn't exist; plain delete with **no** FK-violation handling (unlike category)
  - [x] 8.6 Implement `app/product/router.py`: 5 routes with exact status codes/permissions, GET listing wired to `query_service`
  - [x] 8.7 Run the verification script from 8.1: unknown sort field falls back silently, each of the 5 `pluginFilter` operators against a seeded product with `plugin_data`, and every malformed-filter error string verbatim

**Acceptance Criteria:**
- `GET /api/products?sort=bogusField`→`200`, results ordered `created_at DESC` (silent fallback, no 400)
- `GET /api/products?pluginFilter=abc` (2 parts)→`400 {"message":"Invalid pluginFilter format. Expected: {pluginId}:{jsonPath}:{operator}:{value}"}`
- `GET /api/products?pluginFilter=p1:field:gt:notanumber`→`400 {"message":"Value must be numeric for 'gt' operator: notanumber"}`
- `GET /api/products?pluginFilter=p1:field:exists` (no value)→succeeds, filters via `jsonb_exists`
- `GET /api/products/{id}` response nests `category: {id, name, description, created_at, updated_at}`, not `category_id`
- `POST /api/products` with `photo_url: "ftp://x"`→`400`, message `"Photo URL must start with http:// or https://"`
- `POST /api/products` with a nonexistent `category_id`→`404`
- `DELETE /api/products/{id}` on any product→`204` unconditionally (no 409 path, unlike category)

**Rollback:** Revert the commit(s) for this task group. Schema unaffected (`products` already exists from Group 2).

---

### Task Group 9: Plugin System (Descriptor / Data / Object)
**Dependencies:** 8, 4
**Files to Modify:** `src/backend/app/plugin/models.py`, `src/backend/app/plugin/schemas.py`, `src/backend/app/plugin/query_service.py`, `src/backend/app/plugin/service.py`, `src/backend/app/plugin/router.py`
**Estimated Steps:** 7

- [x] 9.0 Complete the plugin descriptor/data/object system
  - [x] 9.1 Write a throwaway verification script covering all 3 route groups (descriptor, data, object), including the `findEnabledOrThrow` disabled-plugin-indistinguishable-from-404 behavior and the plugin-object cross-type/per-type both-or-neither validation
  - [x] 9.2 Implement `app/plugin/models.py`: `PluginDescriptor` (string PK, own base — does **not** inherit the shared `BaseEntity`/sequence pattern) and `PluginObject` (composite unique, **no FK** on `entity_id` — deliberate loose reference, do not add referential integrity)
  - [x] 9.3 Implement `app/plugin/schemas.py`: `PluginResponse` (`extension_points` extracted from `manifest["extensionPoints"]` if a list else `[]`), `SetEnabledRequest`, `PluginObjectResponse`
  - [x] 9.4 Implement `app/plugin/service.py`: `PluginDescriptorService` (manifest upload validation — pluginId regex, manifest name/url checks, exact messages), `findEnabledOrThrow` returning the same `EntityNotFoundException("Plugin", pluginId)` for both disabled and nonexistent plugins; `PluginDataService` with **confirmed replace-at-key semantics** (copy existing `plugin_data` map, `map[pluginId] = data` whole-blob overwrite, response echoes the **input** data — per fixed decision #5, this is not a merge); `PluginObjectService`
  - [x] 9.5 Implement `app/plugin/query_service.py` (`DbPluginObjectQueryService` port, kept **separate** from product's parser per spec.md's explicit non-unification instruction): single `filter` param, split limit 3 (`{jsonPath}:{operator}:{value}`, no pluginId segment), `< 2` parts distinct error message from product's, `data->>'{jsonPath}'` single-level field expression (vs. product's two-level expression)
  - [x] 9.6 Implement `app/plugin/router.py`: 3 route groups — descriptor (PUT manifest, GET list enabled-only, GET-by-id returns even if disabled, DELETE 204, PATCH enabled), data (GET/PUT-replace/DELETE at `/plugins/{pluginId}/products/{productId}/data`), objects (cross-type GET requiring both `entityType`+`entityId` together, per-type GET both-or-neither, get/put/delete by composite key, effective `limit = min(limit, 1000)`) — permissions per spec.md (`PLUGIN_MANAGEMENT` for manifest/enabled/delete, `READ`/`EDIT` elsewhere, **no** `mcp:*` bridge anywhere in this module
  - [x] 9.7 Run the verification script from 9.1: PUT plugin-data with a pre-existing key at a different pluginId stays untouched (replace-at-key, not whole-map-replace), and a disabled plugin's object routes 404 identically to a nonexistent plugin

**Acceptance Criteria:**
- `PUT /api/plugins/{id}/products/{pid}/data` with another plugin's data already present at a different key→after the call, that other key is untouched and the response body is exactly the **input** payload (not the full persisted map)
- Disabling a plugin then `GET /api/plugins/{id}/objects`→byte-identical `404` body to querying a nonexistent plugin id
- `GET /api/plugins/{id}` (plain get) on a disabled plugin→`200`, not 404 (plain find, not `findEnabledOrThrow`)
- `GET /api/plugins/{id}/objects?entityType=CATEGORY` (missing `entityId`)→`400 "Both entityType and entityId are required for cross-type listing"`
- `GET .../objects/{type}?entityId=5` (missing `entityType`)→`400 "Both entityType and entityId must be provided together or both absent"` (distinct message from the cross-type case)
- `GET .../objects?limit=5000`→effective result count capped at 1000
- A token with only `mcp:read` (no `READ`) is rejected on every plugin GET route (no `mcp:*` bridge in this module)

**Rollback:** Revert the commit(s) for this task group. Schema unaffected (`plugins`/`plugin_objects` already exist from Group 2).

---

### Task Group 10: Footprint — Domain Engine Port
**Dependencies:** 1
**Files to Modify:** `src/backend/app/footprint/archetype/*.py`, `src/backend/app/footprint/domain/*.py`, `src/backend/app/footprint/engine/*.py`, `src/backend/app/footprint/ports.py`, `src/backend/app/footprint/stubs.py`, `src/backend/app/footprint/facade.py`
**Estimated Steps:** 6

- [x] 10.0 Complete the pricing archetype + footprint calculation engine port (most directly portable domain logic, but with the most moving parts)
  - [x] 10.1 Write a throwaway verification script computing known footprint scenarios by hand (e.g. `OFB-330` at a fixed `asOf` with fixed params) and comparing against manually pre-computed expected `kg_co2` values using the exact rounding rules — sanity-checks the engine before it's ever wired to a route
  - [x] 10.2 Port `archetype/pricing` 1:1: `ComponentId`/`CalculatorId` (non-blank validation, exact messages), `Component` discriminated union (`SimpleComponent`/`CompositeComponent`, `Literal[...]` tag + `assert_never` exhaustiveness), `Applicability` (`ALWAYS`/`REFRIGERATED_ONLY`), `QuantityExtractor` Protocol, `ParameterValue` (4 Decimal fields null-coalesce to `Decimal("0")`), `Calculator` Protocol + `SimpleFixedCalculator` (`(rate*quantity).quantize(Decimal("0.0001"), ROUND_HALF_UP)`), `ComponentVersion`, `Validity` (half-open `[valid_from, valid_to)` coverage, pairwise O(n²) `assert_non_overlapping`)
  - [x] 10.3 Port `footprint/domain` + `footprint/engine`: `RoundingPolicy`, `ComponentTreeRegistry` (exact V1 tree — 9 leaves + 4 composites, exact quantity formulas verbatim per spec.md), `BreakdownTreeBuilder` (applicability pruning, composite-drops-when-empty, STRICT raises `MissingFactorException`/LENIENT zero-value+warning), `BreakdownScaler` (PER_100G: validate weight present/`>0`, `scale_factor = Decimal("0.1")/weight` at 10-digit precision, scale **leaves** first then recompute composites as sum-of-scaled-children — never scale composites directly)
  - [x] 10.4 Port `footprint/ports.py` + `footprint/stubs.py`: `EmissionFactorPort`/`ProductAttributesPort` Protocols; `InMemoryEmissionFactorPort`/`InMemoryProductAttributesPort` with the exact seed data (`raw-material`'s two adjacent non-overlapping windows @ rates 0.90/0.95; every other leaf one window spanning `2026-01-01`–`2027-01-01`; seed products `OFB-330`, `CAW-042`, + 14 electronics SKUs via the documented helper); assert non-overlapping validity at module load
  - [x] 10.5 Port `footprint/facade.py` (`DefaultFootprintFacade`): `with_defaults`, `merge_with_product_attributes` (per-field None-fallback only, `requires_refrigeration` OR'd — not overridable-off), `calculate_total` (builds tree + root-level timestamp warnings; audit-scheduling hook stubbed as a no-op callback here, wired for real in Group 11), `calculate_unit` (PER_100G: **always computes and would-audit the TOTAL calculation first**, then re-merges and scales — preserve this double-computation exactly), `timestamp_warnings` (`FUTURE_TIMESTAMP` >30d ahead, `ANCIENT_TIMESTAMP` >3650d behind, independent checks)
  - [x] 10.6 Run the verification script from 10.1: confirm hand-computed `kg_co2` values match for ≥2 scenarios (one STRICT/TOTAL, one LENIENT/PER_100G with a deliberately-missing factor), and confirm `cold-storage` vanishes entirely when `requires_refrigeration=false`

**Acceptance Criteria:**
- `assert_non_overlapping` at module import does not raise (self-check against the documented seed data)
- A TOTAL/STRICT calculation with `requires_refrigeration=false` produces a tree with no `cold-storage` node at any level
- A LENIENT calculation against a component with no covering validity window produces a leaf with `kg_co2=0`, factor fields `None`, and a warning `("MISSING_FACTOR", "No emission factor for {leaf_id} at {as_of}", leaf_id)`
- PER_100G scaling recomputes each composite as the **sum of its already-scaled leaf children** (construct one scenario deliberately in the verification script where scaling the composite directly would yield a different rounded total, and confirm the per-leaf order is what's actually implemented)
- Every arithmetic result in the verification script is `type(x) is Decimal`, never `float`, at each intermediate step

**Rollback:** Revert the commit(s) for this task group. No schema/DB dependency — nothing to downgrade.

---

### Task Group 11: Footprint — Audit Pipeline & CSV Export
**Dependencies:** 10, 8, 2, 3
**Files to Modify:** `src/backend/app/footprint/audit/models.py`, `src/backend/app/footprint/audit/mapper.py`, `src/backend/app/footprint/audit/task.py`, `src/backend/app/footprint/export/csv_flattener.py`
**Estimated Steps:** 6

- [x] 11.0 Complete the async audit pipeline and CSV export
  - [x] 11.1 Write a throwaway verification script that: triggers the audit-persistence call twice with the same `correlation_id` (expect idempotent no-raise), forces retry exhaustion (expect exactly 3 attempts with the configured backoff), and round-trips a computed breakdown through CSV export
  - [x] 11.2 Implement `app/footprint/audit/models.py`: `FootprintAuditEntity` matching `footprint_audit_log` (`correlation_id` UNIQUE, `breakdown`/`warnings`/`factor_versions` JSONB, `dry_run` boolean)
  - [x] 11.3 Implement `app/footprint/audit/mapper.py`: converts `requested_at` to a naive UTC datetime; serializes the **entire** breakdown result object (not just `root`) into the `breakdown` JSONB column — top-level keys `root, total, factor_versions, root_warnings, computed_at, correlation_id` — confirm **no** `parameters_echo` key at this level (its absence is load-bearing for the CSV export fallback chain in 11.5)
  - [x] 11.4 Implement `app/footprint/audit/task.py`: `tenacity.retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2.0, min=0.2))`-decorated async function opening its **own new** `AsyncSession` (≈`REQUIRES_NEW`); on `IntegrityError` from the unique `correlation_id` constraint, log at debug and treat as idempotent success (no retry, no raise); on retry exhaustion, log at error and increment a `footprint_audit_failed` in-process counter; `dry_run` requests are never scheduled — this precondition is enforced at the call site added in Group 12, noted here as a cross-group contract — NOTE: tenacity's actual multiplier/exp_base semantics required a corrected parameter mapping to hit the documented 0.2s/0.4s timing, see work-log
  - [x] 11.5 Implement `app/footprint/export/csv_flattener.py`: `MAX_LEAF_ROWS=1000` cap (`InvalidParametersException("breakdown.leafCount", row_count)` on exceed); per-row derivation exactly per spec.md (`computed_at` from the audit-log column, not the breakdown JSON; `timestamp_param` 3-level fallback `parameters_echo.timestamp → computed_at → row.requested_at`, confirmed to typically hit the 2nd/3rd branch given the absence noted in 11.3); `component_path` dot-joined child IDs (root excluded); exact 12-column order and formatting rules (`kg_co2` forced 4-decimal quantize, `factor_value` **not** forced-scale, `warnings` JSON-serialized with fallback to `""` on serialization failure — never raise)
  - [x] 11.6 Run the verification script from 11.1 against the live Group-2 DB

**Acceptance Criteria:**
- Calling the audit task twice with the identical `correlation_id` results in exactly one stored row and no exception on the second call
- Forcing repeated non-`IntegrityError` failures results in exactly 3 total attempts with the documented exponential backoff timing (~0.2s, ~0.4s between attempts) and the failure counter incremented exactly once
- CSV export of a stored row produces exactly the 12-column header in the documented order; `kg_co2` values are 4-decimal-quantized strings; `factor_value` is not forced to a fixed scale; `warnings` is `""` when the stored list is empty
- Constructing a synthetic breakdown with >1000 leaf rows raises `InvalidParametersException("breakdown.leafCount", <count>)`

**Rollback:** Revert the commit(s) for this task group. Schema unaffected (`footprint_audit_log` already exists from Group 2).

---

### Task Group 12: Footprint — Router & RFC7807 Error Handling
**Dependencies:** 10, 11, 4
**Files to Modify:** `src/backend/app/footprint/errors.py`, `src/backend/app/footprint/schemas.py`, `src/backend/app/footprint/router.py`
**Estimated Steps:** 6

- [ ] 12.0 Complete the footprint HTTP surface and RFC7807 error scoping
  - [ ] 12.1 Write a throwaway verification script covering: full happy-path GET footprint (TOTAL and PER_100G), every RFC7807 exception type + status, the PER_100G-bug legacy-envelope exception, the export endpoint (success + the NOT-RFC7807-scoped 404), and every header/query-param default
  - [ ] 12.2 Implement `app/footprint/errors.py`: RFC7807 `ProblemDetail` model + footprint-scoped exception handlers for the 5 typed exceptions + invalid-parameter-type-mismatch, per the exact table in spec.md (`type` = base-URI + kebab(code), `instance` = request path only, `detail` = exception message, `details()` dict spliced as extension properties, media type `application/problem+json`). **Critical:** the PER_100G untyped-value-error path must be explicitly routed through the **legacy** handler (Group 3's), never this RFC7807 handler — preserve the bug exactly, do not "fix" the envelope
  - [ ] 12.3 Implement `app/footprint/schemas.py`: `FootprintResponseDto` and nested shapes exactly per spec.md (`parameters_echo.timestamp` = the resolved `asOf`, **not** `breakdown.computed_at`; `unit` = `"KG_CO2_PER_100G"` when `normalisation=PER_100G` else `"KG_CO2"`)
  - [ ] 12.4 Implement `GET /api/products/{productId}/footprint`: 3 optional headers (`X-Correlation-Id`/`X-Caller-Id`/`X-Comparison-Group`, UUID-parsed, malformed→`InvalidParametersException`), full query-param surface with every documented default (`asOf=now()`, `storageDays=0`, `requiresRefrigeration=false`, `unit=TOTAL`, `strictness=STRICT`, `dryRun=false`, `materialWeightKg<=0`→`InvalidParametersException` if present), invalid enum values→`InvalidParametersException`; wires the Group 11 audit `BackgroundTasks.add_task` call (skipped entirely when `dry_run`, checked before scheduling)
  - [ ] 12.5 Implement `GET /api/footprints/calculations/{correlationId}/export?format=csv`: `format` must equal `"csv"` else `InvalidParametersException`; audit-row lookup miss→`EntityNotFoundException("FootprintAudit", correlationId)` routed through the **legacy** handler (this controller's not-found path is deliberately not footprint-scoped — confirm the handler registration doesn't accidentally catch this at the footprint-scoped level); success→`text/csv`, `Content-Disposition: attachment; filename="footprint-{correlationId}.csv"`, replays the stored row (never recalculates)
  - [ ] 12.6 Run the verification script from 12.1 end-to-end against a live instance with Groups 2/3/4 wired

**Acceptance Criteria:**
- `GET .../footprint` with no params→`200`, `unit:"KG_CO2"`, `parameters_echo.timestamp` equals the resolved `asOf` (not any value from inside `breakdown`)
- `GET .../footprint?materialWeightKg=-5`→`400 application/problem+json {"code":"INVALID_PARAMETERS","status":400,...}` (RFC7807-scoped)
- `GET .../footprint?unit=PER_100G` with no `materialWeightKg`→**legacy envelope** `400 {"status":400,"error":"Bad Request","message":"materialWeightKg must be positive for PER_100G normalisation",...}`, `Content-Type: application/json` — explicitly **not** `application/problem+json` (the preserved bug)
- A component with no covering factor at STRICT→`422 application/problem+json {"code":"MISSING_FACTOR","componentId":"...","timestamp":"...",...}`
- `GET /api/footprints/calculations/{unknownId}/export?format=csv`→`404` via the **legacy** envelope (`Content-Type: application/json`), not `application/problem+json`
- `GET .../export?format=xml`→`400 application/problem+json {"code":"INVALID_PARAMETERS",...}` (this one IS RFC7807-scoped, unlike the not-found case)
- Successful export→`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="footprint-{id}.csv"`

**Rollback:** Revert the commit(s) for this task group. Schema unaffected.

---

### Task Group 13: System Routes & Application Wiring
**Dependencies:** 6, 7, 8, 9, 12
**Files to Modify:** `src/backend/app/system/router.py`, `src/backend/app/main.py`
**Estimated Steps:** 4

- [ ] 13.0 Complete SPA fallback, health, and final app wiring
  - [ ] 13.1 Write a throwaway verification script exercising SPA-fallback (index.html serving vs. real 404 for `/api` and `/assets` paths) and health
  - [ ] 13.2 Implement `app/system/router.py`: `GET /api/health` public→`200 {"status":"UP"}`; SPA-fallback catch-all — any path not starting with `/api/` or `/assets/` and not dot-containing→serve `index.html`; `/api/**`/`/assets/**` unmatched paths remain real 404s
  - [ ] 13.3 Finalize `app/main.py`: `FastAPI()` instantiation, CORS middleware (origins from `CORS_ALLOWED_ORIGINS`, methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`, all headers, credentials allowed), include every router from Groups 4-9 and 12 in the correct order (specific paths registered before the SPA catch-all), register every exception handler from Groups 3 and 12 (legacy handlers global, footprint RFC7807 handlers scoped to footprint routes only — mirrors the Java `@RestControllerAdvice(basePackages=...)` scoping)
  - [ ] 13.4 Run the verification script from 13.1, and re-run every prior group's verification script against this single fully-wired `uvicorn` process (not each group's standalone harness) to catch router-registration-order or handler-scoping regressions

**Acceptance Criteria:**
- `GET /some/client/route` (no dot, not `/api`/`/assets`)→`200`, serves `index.html`
- `GET /api/does-not-exist`→real `404` (legacy envelope), not the SPA fallback
- `GET /assets/does-not-exist.js`→real `404`, not SPA fallback
- `GET /api/health`→`200 {"status":"UP"}` with no auth
- Every route from Groups 4/5/6/7/8/9/12's individual scripts still passes when run against the fully-wired app
- CORS preflight (`OPTIONS`) on any `/api/**` route with an allowed `Origin` header returns correct `Access-Control-Allow-*` headers

**Rollback:** Revert the commit(s) for this task group. Schema unaffected.

---

### Task Group 14: Standards Documentation Update
**Dependencies:** 13
**Files to Modify:** `.maister/docs/project/tech-stack.md`, `.maister/docs/project/architecture.md`, `.maister/docs/standards/backend/models.md`, `.maister/docs/standards/backend/jooq.md`, `.maister/docs/standards/backend/queries.md`, `.maister/docs/standards/backend/migrations.md`, `.maister/docs/standards/backend/security.md`, `.maister/docs/standards/backend/plugin-auth.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 5

- [ ] 14.0 Complete the standards documentation update (in scope per requirements.md R4)
  - [ ] 14.1 Read each of the 8 target files against spec.md's Standards Docs Update Spec section (per-file guidance already drafted there) — documentation-only, no verification script needed
  - [ ] 14.2 Update `tech-stack.md`: replace Java/Spring/Maven content with the finalized Python stack (actual pinned versions from Group 1's `pyproject.toml`/`uv.lock`, not spec.md's placeholder pins if they diverged); remove the resolved "JPA vs JOOQ" pending item; note Docker/compose now exist
  - [ ] 14.3 Update `architecture.md`: replace the Spring Boot bootstrap description with the finalized `app/` tree (cross-checked against what Groups 1-13 actually built); update "Database Layer" to Alembic; note the system is no longer "pre-alpha scaffolding"
  - [ ] 14.4 Update `standards/backend/models.md`, `jooq.md`, `queries.md`, `migrations.md`, `security.md`, `plugin-auth.md` per spec.md's per-file guidance, reflecting the actual patterns implemented in Groups 2-9/12 (`BaseEntity` mixin, SQLAlchemy Core filter-DSL pattern, Alembic migration conventions, FastAPI dependency-based authorization matrix)
  - [ ] 14.5 Spot-check `.maister/docs/INDEX.md` for any stale one-line summaries (referencing Liquibase/JPA by name) and update those lines only

**Acceptance Criteria:**
- None of the 8 updated files contains "Spring", "JPA", "Liquibase", "jOOQ", "Maven", or "pom.xml" as a description of the *current* stack (a "migrated from X" historical note is acceptable)
- `tech-stack.md` lists the actual pinned versions from the final `pyproject.toml`/`uv.lock`
- `architecture.md`'s package-structure section matches the real `app/` tree 1:1 (spot-check 5 directories)

**Rollback:** Revert the commit(s) for this task group. No code/schema impact — documentation-only.

---

### Task Group 15: Manual Contract Verification Pass
**Dependencies:** All previous groups (1-14)
**Files to Modify:** None (review/verification-only — no permanent application code changes; any consolidated verification script lives in a scratch location, not the committed tree)
**Estimated Steps:** 6

- [ ] 15.0 Perform the final manual contract verification pass (substitutes, weakly, for the deferred automated test suite — per clarification Q2, must not be skipped)
  - [ ] 15.1 Consolidate every prior group's throwaway verification script into one end-to-end pass, run once against a `docker-compose up` instance (Postgres 18 + FastAPI on port 8080)
  - [ ] 15.2 Walk the full API Route Spec table in spec.md route-by-route (category, product, plugin descriptor/data/object, auth, footprint, oauth2, system), confirming exact status code + response shape + error envelope for at least the happy path and one representative error case per route
  - [ ] 15.3 Re-verify the 4 fixed decisions explicitly as a checklist (highest-risk silent-drift points): (a) PER_100G bug surfaces via the legacy envelope, not RFC7807; (b) plugin-data PUT replaces-at-key (echoes input, doesn't merge); (c) OAuth2 code/token stores are in-memory single-instance (restart the container mid-flow, confirm a previously-issued auth code now fails); (d) `updated_at`-as-optimistic-version column (confirm a stale-write conflict raises, not silently succeeds)
  - [ ] 15.4 Run `ruff check` and `mypy` (strict-ish) against the complete `app/` tree — both must exit 0; as a sanity check that the `assert_never` exhaustiveness pattern is actually wired (not silently permissive), temporarily remove one `match`/`case` branch in a footprint discriminated union, confirm `mypy` errors, then restore it
  - [ ] 15.5 Confirm `docker-compose up` brings up the full stack cleanly from a fresh state (no leftover volumes) and the frontend's dev-proxy target (`http://localhost:8080`) is reachable with zero code changes required in `src/frontend/`/`plugins/`
  - [ ] 15.6 Document any discrepancy found against spec.md as a follow-up note; route any required code change back to the owning task group above rather than patching ad hoc here

**Acceptance Criteria:**
- Every route in spec.md's API Route Spec has been exercised at least once with a matching status/shape/envelope, with no unexplained discrepancies remaining open
- All 4 fixed-decision checks in 15.3 pass as documented
- `ruff check` and `mypy` (strict-ish) both exit 0 on `src/backend/app`, and the deliberate mypy-exhaustiveness sanity check in 15.4 actually fails when a case is removed
- `docker-compose up` succeeds from a clean state and `curl http://localhost:8080/api/health` returns `200 {"status":"UP"}`

**Rollback:** This group makes no permanent code changes — nothing to revert. Any discrepancy found is routed back to the relevant task group above (revert + refix that group's commits), not rolled back here.

---

## Execution Order

1. Group 1 — Project Scaffolding, Tooling & Java Removal (7 steps)
2. Group 2 — Database Schema: Alembic Initial Migration (5 steps, depends on 1)
3. Group 3 — Core Cross-Cutting Infrastructure (8 steps, depends on 1, 2)
4. Group 4 — Auth: JWT & Permission Matrix (7 steps, depends on 3)
5. Group 5 — OAuth2: Client Registration & Authorization (8 steps, depends on 4)
6. Group 6 — OAuth2: Token Exchange, Introspection & Metadata (9 steps, depends on 5)
7. Group 7 — Category Vertical (6 steps, depends on 4)
8. Group 8 — Product Vertical (7 steps, depends on 7, 4)
9. Group 9 — Plugin System (7 steps, depends on 8, 4)
10. Group 10 — Footprint: Domain Engine Port (6 steps, depends on 1 — can proceed in parallel with Groups 4-9)
11. Group 11 — Footprint: Audit Pipeline & CSV Export (6 steps, depends on 10, 8, 2, 3)
12. Group 12 — Footprint: Router & RFC7807 Error Handling (6 steps, depends on 10, 11, 4)
13. Group 13 — System Routes & Application Wiring (4 steps, depends on 6, 7, 8, 9, 12)
14. Group 14 — Standards Documentation Update (5 steps, depends on 13)
15. Group 15 — Manual Contract Verification Pass (6 steps, depends on 1-14)

**Parallelization note:** Group 10 (footprint domain engine) has zero DB/auth dependency and can start as soon as Group 1 lands, in parallel with the Group 4→9 auth/category/product/plugin chain — it only needs to rendezvous with that chain at Group 11 (which needs Product's `plugin_data` access and the live schema). This mirrors `analysis/target-state-plan.md` §4 step 5's note that footprint has no dependency on category/product/plugin beyond reading `Product.plugin_data`.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/` — always applicable (error handling, validation, conventions, coding style, commenting, minimal implementation)
- `backend/models.md`, `backend/queries.md`, `backend/migrations.md`, `backend/security.md` — apply their **post-migration** content once Group 14 has updated them; until then, apply the target patterns described directly in `implementation/spec.md`'s Standards Docs Update Spec section (SEQUENCE-based PKs except `PluginDescriptor`/`RegisteredClientEntity`, `EnumType.STRING`-equivalent, LAZY relationship loading, business-key equality, JSONB via `postgresql.JSONB`, bind-parameter discipline + regex-validate-then-splice for the two filter-DSL query services, centralized FastAPI-dependency-based authorization matrix)
- `backend/plugin-auth.md` — no consumer-side change; reconfirm the client-side JWT decoding contract is still accurate post-migration

## Notes

- **No automated test suite** (clarification Q2): every group's "tests" are throwaway manual-verification scripts (curl/httpx), not a pytest suite. `ruff` + `mypy` (strict-ish) are the only enforced quality gates, verified in Group 15.
- **Run incrementally**: only re-run a group's own verification script after that group; Group 13 and Group 15 are the two points where prior groups' scripts are re-run together to catch integration regressions.
- **Mark progress**: check off steps as completed; each group's commit(s) are the rollback unit (see `analysis/rollback-plan.md` — no live rollback path exists, only git history).
- **Preserve, don't fix**: this plan deliberately preserves four known quirks/bugs exactly as documented in spec.md/clarifications.md — the PER_100G untyped-exception-envelope bug, plugin-data PUT replace-at-key semantics, in-memory single-instance OAuth2 code/token stores, and `updated_at`-as-optimistic-version-column. Do not "clean these up" during implementation; any group whose acceptance criteria appear to conflict with a "sensible" fix should re-read the corresponding spec.md section before changing behavior.
- **Reuse first**: every Java source file listed in spec.md's Reusable Components table is the algorithm-for-algorithm source of truth for its Python port — translate the algorithm, not the intent.
- **Task-tracking tool note**: this environment does not expose a `TaskCreate`/`TaskUpdate` tool, so no group-level Task items were created alongside this plan. The markdown checkboxes above are the sole progress-tracking source of truth for this plan; if group-level Task items are desired, create them manually from the 15 group headers and dependency edges above once a Task-management tool is available.
