# System Architecture

## Overview

**aj** is a plugin-based microkernel platform. The backend (`src/backend/`) was migrated from a Java/Spring Boot scaffold to Python/FastAPI + SQLAlchemy + Alembic (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/` for the full migration record). The system is no longer pre-alpha scaffolding — it has real business logic across four verticals (category, product, plugin, footprint) plus a full hand-rolled OAuth2 authorization server, is runnable end-to-end via `docker-compose up`, and passed a 53/53-check integration verification pass with the fully wired application (no regressions across any prior module's acceptance criteria).

## Architecture Pattern

**Pattern**: Microkernel (Plugin-Based) — plugins are frontend iframes (`plugins/`) that talk to the host API via a browser SDK (`postMessage`/`hostApp.getToken()`) and a server-side SDK (`createServerSDK`), not a server-side plugin-loading framework. See `standards/backend/plugin-auth.md`.

**Current state**: A single FastAPI application (`app/main.py`) exposing category, product, plugin, footprint, auth, and OAuth2 routers behind one centralized authorization dependency layer. No server-side plugin-loading mechanism exists yet — that remains a future decision (see `project/tech-stack.md`'s "Architectural Decisions Pending").

## System Structure

### Application Core
- **Location**: `src/backend/app/`
- **Purpose**: FastAPI application bootstrap, cross-cutting infrastructure, and per-vertical routers
- **Key Files**: `app/main.py` (entry point — instantiates `FastAPI()`, wires CORS, registers every exception handler, includes every router with `system_router` registered last so its SPA-fallback catch-all doesn't shadow more specific routes)

### Configuration
- **Location**: `src/backend/app/config.py`
- **Purpose**: Environment-variable-backed settings (`pydantic_settings.BaseSettings`). `JWT_SECRET` and `DATABASE_URL` are required with no default (fail-loud `ValidationError` on startup if missing); the remaining vars (`JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `FOOTPRINT_AUDIT_RETRY_*`) are operational tuning knobs with defaults matching `.env.example`/`docker-compose.yml`
- **Key Files**: `.env.example`, `docker-compose.yml`, `Dockerfile`

### Database Layer
- **Location**: `src/backend/alembic/`
- **Purpose**: Alembic database migrations
- **Technology**: PostgreSQL 18 via SQLAlchemy 2.0 (async, `asyncpg` driver)
- **Status**: One migration (`alembic/versions/0001_initial_schema.py`) reconstructs the entire schema, since no Liquibase changelog was ever populated in the Java source. Includes 6 explicitly-reconstructed FK/constraint items that existed nowhere as DDL in the original repo (see the migration's `work-log.md`, Group 2 entry, for the full checklist).

### Test Infrastructure
- **Status**: No automated pytest/TestContainers-python suite exists yet (deliberately deferred — see `project/tech-stack.md` and the migration's `spec.md` "Out of Scope"). Each vertical was verified during migration via live-uvicorn + real-Postgres manual verification scripts, not committed as a formal suite. `standards/testing/backend-testing.md` remains the target strategy for that follow-up work.

## Data Flow

```
Client Request → FastAPI Router → Auth Dependency (require_any) → Service Layer → SQLAlchemy (ORM or Core) → PostgreSQL
                                          ↓
                              AUTHORIZATION_MATRIX (app/core/auth_deps.py)
```

Plugin iframes reach the same routers via the host's browser SDK, which attaches the same JWT the router-level auth dependency validates — there is no separate plugin-specific auth path on the server side (see `standards/backend/plugin-auth.md`).

## Photo Upload and Content Moderation

```
POST /api/products/{id}/photos (multipart) → Pillow sanitize → Spaces (private) → product_photos(PENDING) + outbox
                                                                                         ↓ moderation.photo_requested
moderation worker (python -m app.moderation.worker, same codebase) → NSFW score → APPROVED (files public-read, CDN)
                                                                                 | NEEDS_REVIEW → /api/moderation (ADMIN)
                                                                                 | REJECTED (files stay private)
```

- `app/storage/` — `ObjectStorage` protocol + `SpacesStorage` (boto3); `get_storage()` returns `None` while the `SPACES_*` settings are unset (upload disabled). `storage.objects_delete` outbox events delete files after their rows are gone.
- `app/moderation/` — `ModerationStatus` (PENDING/APPROVED/NEEDS_REVIEW/REJECTED) tracked per photo and per product text (name + shared description, `products.text_status` + `text_moderated_hash`); append-only `moderation_decisions` audit log; synchronous contact-info regex rules (400); ADMIN queue/decisions router; worker handlers with injected classifiers (`onnx_models.py`: Bielik-Guard-0.1B text, Falconsai NSFW image).
- The outbox is split by event type: the API poller uses `exclude_event_types=WORKER_EVENT_TYPES`, the worker claims only those (5 s interval, batch of 5).
- Non-owners see only APPROVED photos and an APPROVED description; a product whose text is not APPROVED cannot be given a listing preference (the choke point for public pages).
- `MODERATION_ENABLED=false` (default, tests, local dev) approves new content immediately.

## External Integrations
- **PostgreSQL 18**: Primary datastore, run via `docker-compose.yml`
- **DigitalOcean Spaces** (S3 API) + CDN: user-uploaded product photos
- No external API integrations exist. The footprint domain's `app/footprint/ports.py`/`stubs.py` define ports for an emission-factor/product-attribute adapter that remains stubbed (out of scope for this migration)

## Database Schema
- **Migration tool**: Alembic
- **Location**: `alembic/versions/`
- **Status**: Schema defined and complete for all 8 tables (`categories`, `users`, `user_permissions`, `oauth2_registered_client`, `plugins`, `products`, `plugin_objects`, `footprint_audit_log`) via `0001_initial_schema.py`. Two entities deliberately do NOT use the shared `BaseEntity` sequence/`created_at`/`updated_at` pattern: `PluginDescriptor` (`plugins` table — string PK, plugin-supplied slug) and `RegisteredClient` (`oauth2_registered_client` table — UUID PK). `footprint_audit_log` has no `updated_at` (audit rows are append-only). `user_permissions` has no PK of its own (matches JPA `@ElementCollection` semantics — child rows have no independent identity).

## Configuration
- **Main config**: `app/config.py` (`Settings`, a `pydantic_settings.BaseSettings` subclass)
- **Pattern**: Environment-variable-based configuration, loaded from `.env` (see `.env.example`) with `extra="ignore"`
- **Profiles**: Not configured — a single settings object, no per-environment profile switching yet

## Package Structure

The real `app/` tree (from `find src/backend/app -type f -name '*.py'`, confirmed against Groups 1-13's actual output):

```
app/
├── main.py                      (FastAPI app instantiation, CORS, router + handler wiring)
├── config.py                    (Settings — env-var-backed configuration)
├── db.py                        (async engine/session factory, get_db dependency)
├── core/                        (cross-cutting infrastructure)
│   ├── base_model.py            (Base, BaseEntity mapped-superclass mixin)
│   ├── errors.py                (typed exceptions, legacy-envelope handlers)
│   ├── security.py              (JWT encode/decode, password hashing)
│   ├── auth_deps.py             (Principal, require_any(), AUTHORIZATION_MATRIX)
│   └── filter_dsl.py            (shared regex/operator-allowlist constants only —
│                                  NOT a shared parser; see standards/backend/jooq.md)
├── auth/                        (login vertical: User model, POST /api/auth/login)
├── oauth2/                      (full hand-rolled OAuth2 authorization server:
│   │                             DCR, /oauth2/authorize, /oauth2/token [3 grants],
│   │                             /oauth2/introspect, well-known metadata, client-info)
│   ├── models.py, errors.py, stores.py, client_auth.py, router.py, metadata_router.py
├── category/                    (category vertical: models, schemas, service, router)
├── product/                     (product vertical, incl. its own 4-part filter-DSL
│                                  query_service.py)
├── plugin/                      (plugin descriptor/data/object vertical, incl. its own
│                                  3-part filter-DSL query_service.py)
├── footprint/                   (emissions-footprint domain — the largest vertical)
│   ├── archetype/                (calculator/component/validity/applicability model)
│   ├── domain/                   (breakdown, enums, exceptions — discriminated unions)
│   ├── engine/                   (breakdown_scaler, tree_builder, rounding_policy)
│   ├── audit/                    (audit-log persistence task, retry/backoff via tenacity)
│   ├── export/                   (CSV flattener)
│   ├── ports.py, stubs.py, facade.py, router.py, schemas.py, errors.py
└── system/                      (health check, SPA-fallback catch-all — registered LAST)

alembic/
├── env.py
└── versions/0001_initial_schema.py
```

Five spot-checked directories, confirmed 1:1 against the real tree above: `app/core/`, `app/oauth2/`, `app/footprint/domain/`, `app/footprint/audit/`, `alembic/versions/`.

## Deployment Architecture
- `docker-compose.yml` (repo root) brings up three services via `docker-compose up`: Postgres 18, the FastAPI backend (port 8080, build context `src/backend/`), and the frontend app shell (port 5173, build context repo root) — the full plugin-architecture stack (host app + backend + DB) in one command. `.env.example` lives at the repo root alongside it (moved from `src/backend/.env.example`) since that's where docker-compose looks for a `.env` file by default
- **Frontend service**: `src/frontend/Dockerfile` is a two-stage build (Node builds the Vite SPA to `dist/`, then an nginx:alpine image serves it) driven from the **repo root** as build context — not `src/frontend/` — because `src/frontend`'s test suite imports the sibling `plugins/server-sdk.ts` by relative path, so that file must be present in the build context too (see `.dockerignore` at the repo root, which scopes that context down to just `src/frontend/` + `plugins/server-sdk.ts`). nginx reverse-proxies `/api/*` and `/oauth2/*` to the `backend` service and falls back to `index.html` for all other paths (client-side routing)
- `src/frontend/vite.config.ts`'s dev-proxy (`npm run dev`, port 5173) now proxies both `/api` and `/oauth2` to `localhost:8080` — the OAuth2 authorize page does a real browser form-POST to `/oauth2/authorize`, not just `fetch()` calls under `/api`
- Individual plugin apps (`plugins/warehouse`, `plugins/box-size`, `plugins/ai-description`) are **not** part of `docker-compose.yml` — they remain standalone dev-server processes per `plugins/CLAUDE.md`'s documented workflow, registered with the host via `PUT /api/plugins/{pluginId}/manifest`
- Opt-in `moderation-worker` service (`docker compose --profile moderation up`, needs `HF_TOKEN` as a build secret for the gated Bielik-Guard model): the backend image's `worker` target, running `python -m app.moderation.worker`
- nginx allows request bodies up to 16 MB on `/api/` (photo uploads; the backend caps a photo at 15 MB)
- No CI/CD yet

---
*Based on the completed Java-to-Python migration (`.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`), 2026-09-01*
