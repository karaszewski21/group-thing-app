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
- **Purpose**: Environment-variable-backed settings (`pydantic_settings.BaseSettings`). `JWT_SECRET` and `DATABASE_URL` are required with no default (fail-loud `ValidationError` on startup if missing); the remaining vars (`JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `FOOTPRINT_AUDIT_RETRY_*`, `SPACES_*`, `MODERATION_*`) are operational tuning knobs with defaults matching `.env.example`/`docker-compose.yml`
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
moderation-worker (python -m app.moderation.worker) → VPS B POST /v1/moderate/image (ShieldGemma-2)
      → per-category scores → APPROVED (files public-read, CDN)
                             | NEEDS_REVIEW → /api/moderation (ADMIN)
                             | REJECTED (files stay private)
```

Two independent flags, both default `false`: `MODERATION_TEXT_ENABLED` (API) and `MODERATION_IMAGE_ENABLED` (API + worker). The API logs both at startup. The old `MODERATION_ENABLED` is ignored (unknown env vars are dropped), so a stale `.env` that still sets it gets photos approved on upload.

**Text: synchronous and reject-only, in the API process.**
- `app/moderation/text_guard.py` `check_text(field, new, current=None)` runs Bielik-Guard-0.1B (ONNX, 1 intra-op thread) via `asyncio.to_thread` before the write.
- Checked fields: organization name, group name, term description, product name and the shared product description. This includes the resolve/create branch and the `plugin_data` PUT.
- A value is scored only when it changes (normalised comparison with `current`), so untouched legacy text is never re-checked.
- Any category score ≥ `MODERATION_TEXT_REJECT_THRESHOLD` (default 0.8) → 400 with a Polish message and no scores. Model unavailable → 503 (fail-closed).
- With the flag on, the API lifespan loads the model from `MODERATION_MODELS_DIR` (`<dir>/text`), and startup fails if that is impossible.
- No text status is stored and no text goes through the queue: products have no `text_status`/`text_moderated_hash` (migration 0047 marks leftover `moderation.text_requested` events PROCESSED and moves PENDING photos whose event already FAILED to NEEDS_REVIEW; 0048 drops the columns). Old `PRODUCT_TEXT` decisions remain only as audit rows.
- The synchronous contact-info regex rules (`rules.py`, 400) are unchanged.

**Photos: asynchronous, in the slim `moderation-worker`.**
- The worker has no ONNX/ML code. `app/moderation/ai_client.py` posts each photo with httpx and a bearer token to VPS B `POST /v1/moderate/image` (ShieldGemma-2), with a `MODERATION_AI_TIMEOUT_SECONDS` (120) per-call timeout.
- With `MODERATION_IMAGE_ENABLED=false`, uploads are APPROVED at once and the worker logs and exits 0. With it on, the worker fails at startup if `MODERATION_AI_URL`, `MODERATION_AI_TOKEN` or storage (`SPACES_*`) is missing.
- `service.process_next(db, client, storage)` runs claim → score → finalize on one `moderation.photo_requested` outbox event. The worker loops on it and sleeps 5 s when nothing is eligible.
  - The lease is the event's `attempts` counter: the claim increments it, and every finalize is guarded with `WHERE attempts = :claimed`, so a lost lease discards its result.
  - Any exception after the claim counts as one failed attempt. The retry backoff is timeout + 30 s·2^(n-1), anchored at the end of each attempt.
  - After 5 attempts the photo goes to NEEDS_REVIEW with a null-score decision (shown as "No model score" in the admin queue), about 25 min in the worst case.
  - Run a **single worker replica**. The lease guard is a safety net, not a scaling mechanism.
- Decisions are made per category: `sexual`/`violence`/`dangerous` score ≥ `MODERATION_IMAGE_REVIEW_THRESHOLD` (0.5) → NEEDS_REVIEW, ≥ `MODERATION_IMAGE_REJECT_THRESHOLD` (0.9) → REJECTED; `weapons` is review-only. The most severe outcome wins.
- The outbox is split by event type: the API poller uses `exclude_event_types=WORKER_EVENT_TYPES` (photo events only), and the worker claims only those.

**Shared pieces.**
- `app/storage/` — `ObjectStorage` protocol + `SpacesStorage` (boto3); `get_storage()` returns `None` while the `SPACES_*` settings are unset (upload disabled). `storage.objects_delete` outbox events delete files after their rows are gone.
- `app/moderation/` — `ModerationStatus` (PENDING/APPROVED/NEEDS_REVIEW/REJECTED) per photo; append-only `moderation_decisions` audit log; ADMIN queue/decisions router (photos only).
- Non-owners see only APPROVED photos.

**Images and deployment.**
- The production API image is the default (last) Dockerfile stage `runtime`. It contains the `ml` uv group and Bielik-Guard, which is exported to ONNX at build time from the gated HF repo, so it needs the secret: `docker build --secret id=hf_token,env=HF_TOKEN src/backend`. Expect about +0.6–0.8 GB RSS per uvicorn process.
- `runtime-dev` (used by compose) has no model and needs no secret, so text moderation is off in dev. `worker` has no `ml` group and no secret.
- Deployment order for this change: stop the old worker → run migrations 0047/0048 → deploy the new worker → enable `MODERATION_IMAGE_ENABLED` on the API.
- 0048 is not zero-downtime: any API or worker process from before it fails on every product query once the columns are dropped, so recreate all backend containers together (expect a few seconds of errors) and leave no old one running.
- Rolling back past 0048: the old image's `alembic upgrade head` does not know revision 0048 and its model reads `text_status`. First run `alembic downgrade 0046` **with the new image** (restores the columns; 0047's data changes are not reverted), then deploy the old image.

## External Integrations
- **PostgreSQL 18**: Primary datastore, run via `docker-compose.yml`
- **DigitalOcean Spaces** (S3 API) + CDN: user-uploaded product photos
- **VPS B AI service** (`group-thing-ai`): `POST /v1/moderate/image` (ShieldGemma-2, bearer token), called only by the photo moderation worker
- No other external API integrations exist. The footprint domain's `app/footprint/ports.py`/`stubs.py` define ports for an emission-factor/product-attribute adapter that remains stubbed (out of scope for this migration)

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
- `backend` builds the model-free `runtime-dev` target with `MODERATION_TEXT_ENABLED` fixed to `"false"`. The opt-in `moderation-worker` service (`docker compose --profile moderation up`, `target: worker`, no build secret) runs `python -m app.moderation.worker` and needs `MODERATION_IMAGE_ENABLED=true` plus `MODERATION_AI_URL`/`MODERATION_AI_TOKEN`; otherwise it exits at once
- nginx allows request bodies up to 16 MB on `/api/` (photo uploads; the backend caps a photo at 15 MB)
- No CI/CD yet

---
*Based on the completed Java-to-Python migration (`.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`), 2026-09-01*
