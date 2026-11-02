# Technology Stack

## Overview
This document describes the technology choices and rationale for **aj** — a plugin-based microkernel platform. The backend was migrated from a Java/Spring Boot scaffold to Python/FastAPI (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the stack below reflects the Python backend as actually built. The frontend (`src/frontend`) runs on Next.js 16.4 App Router, migrated from Vite 8 + React Router 7 (see `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/`).

## Languages

### Python (>=3.12)
- **Usage**: 100% of `src/backend`
- **Rationale**: Mature async ecosystem (FastAPI/SQLAlchemy 2.0), fast iteration, strong typing support via `mypy --strict`
- **Key Features Used**: `enum.StrEnum`, `match`/`assert_never` exhaustiveness checking (domain discriminated unions), `dataclass(frozen=True, slots=True)`, PEP 604 union types (`X | None`)

### TypeScript (~5.9.3)
- **Usage**: `src/frontend`, `plugins/`
- **Config**: one `src/frontend/tsconfig.json` (strict; `types: ["node", "next"]`; the keys Next manages, such as `jsx`, `plugins` and the `.next/types` includes, are left as Next writes them). `next-env.d.ts` is generated and git-ignored. Type-check with `npm run typecheck` (`tsc --noEmit`)

## Frameworks

### Backend

#### FastAPI (0.141.1)
- **Purpose**: Application framework, routing, dependency injection, request/response validation
- **Pattern**: Dependency-based authorization (`Depends(require_any(...))`) replaces Spring's `SecurityFilterChain` — see `standards/backend/security.md`

#### SQLAlchemy (2.0.44, async)
- **Purpose**: ORM (declarative models via `Mapped[...]`/`mapped_column`) for CRUD verticals, Core `select()`/`text()` for the two hand-rolled filter-DSL query services
- **Driver**: `asyncpg` (0.31.0)
- **Rationale**: Single library covers both the JPA-equivalent (declarative ORM) and jOOQ-equivalent (Core DSL) roles the Java stack split across two frameworks — see `standards/backend/models.md` and `standards/backend/jooq.md`

#### Alembic (1.17.1)
- **Purpose**: Database schema migrations (replaces Liquibase)
- **Status**: One migration exists (`alembic/versions/0001_initial_schema.py`), reconstructing the full schema since no Liquibase changelog was ever populated in the Java source

#### Pydantic (2.13.5) / pydantic-settings (2.15.0)
- **Purpose**: Request/response schemas (`app/*/schemas.py`) and environment-based settings (`app.config.Settings`)

#### PyJWT (2.13.0) + bcrypt (5.0.0)
- **Purpose**: JWT encode/decode (HS256) and password hashing — hand-rolled, not a Spring-Security-style framework; see `standards/backend/security.md`

#### tenacity (9.1.4)
- **Purpose**: Retry/backoff for the footprint audit pipeline's async persistence task. Note: `wait_exponential`'s signature is `(multiplier=<base wait>, exp_base=<growth factor>, min=...)` — the inverse of what its parameter names might suggest if read too quickly (documented at length in `app/footprint/audit/task.py`).

#### tzdata (2026.4)
- **Purpose**: IANA zone database for `zoneinfo`. Explicit runtime dependency because `python:3.12-slim` ships no zone files; `app/core/clock.py` needs `Europe/Warsaw` and startup fails fast without it.

#### uvicorn (0.52.4, `[standard]` extras)
- **Purpose**: ASGI server

### Frontend (`src/frontend`)

#### Next.js (16.4.4, App Router)
- **Purpose**: Host web app: file-based routes in `src/app/` (route files only), server rendering of the public pages with `generateMetadata` (Open Graph/Twitter tags) and the organizer palette, and the request proxy `src/proxy.ts`
- **Build**: Turbopack for `next dev` and `next build`; `output: "standalone"` (the Docker runner starts `node server.js`). `outputFileTracingRoot` and `turbopack.root` are pinned to `src/frontend` because the repo root has its own `package-lock.json`
- **Rewrites**: `next.config.ts` forwards `/api/:path*`, `/oauth2/register`, `/oauth2/token`, `/oauth2/introspect` and `/.well-known/:path*` to `BACKEND_INTERNAL_URL` (server-only env var, default `http://localhost:8080`) in dev and whenever nginx is not in front
- **Rationale**: server-rendered link previews and first-paint palette for shared organizer/event/term links, which the former Vite SPA could only get from backend HTML injection (see `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/`)

#### React (19.2.4)
- **Purpose**: UI library; `useSyncExternalStore` (always with a `getServerSnapshot`) for browser-only values during server rendering

#### Chakra UI (3.34.0) + Tailwind CSS (4.3.3)
- **Purpose**: Component system and theme (`src/theme/system.ts`); Tailwind utility classes through `@tailwindcss/postcss` (`postcss.config.mjs`, `src/app/globals.css`). Chakra's Emotion styles are collected during server rendering by the `useServerInsertedHTML` registry in `src/app/providers.tsx` (`@emotion/react`, `@emotion/cache`)

#### TanStack Query (5.103.2)
- **Purpose**: Client server-state cache; see `standards/frontend/data-fetching.md`

#### dayjs (1.11.23)
- **Purpose**: Date formatting with the Polish locale, imported only from `src/utils/dayjs.ts`

#### server-only (0.0.1)
- **Purpose**: Build-time guard that keeps `src/api/server.ts` out of client bundles

#### Vite (8.0.3)
- **Purpose**: Not the app runner. Used by Vitest and by the plugin SDK build: `vite.sdk.config.ts` builds `src/plugin-sdk` as one IIFE into `public/assets/plugin-sdk.js` (git-ignored), run by `predev`/`prebuild` (`npm run build:sdk`)

### Testing

#### Frontend: Vitest (3.2.4) + Testing Library
- **Purpose**: Unit and component tests in `src/frontend/src/test/` (jsdom, `@testing-library/react`, `@testing-library/jest-dom`); `next/navigation` and `next/link` are aliased to in-repo mocks in `vitest.config.ts`. See `standards/testing/frontend-testing.md`

#### Backend

No automated pytest/TestContainers-python suite exists yet (deliberately deferred — see the migration's `spec.md` "Out of Scope"). Each vertical was verified during migration via live-uvicorn + real-Postgres manual verification scripts (not committed as a test suite). `standards/testing/backend-testing.md` remains the target strategy for whenever that follow-up work happens — it documents the JVM/JUnit-era conventions but its integration-first philosophy (test against real Postgres, not mocks) still applies.

## Database

### PostgreSQL 18
- **Type**: Relational (RDBMS)
- **ORM/Client**: SQLAlchemy 2.0 (async) — ORM for CRUD, Core `select()`/`text()` for dynamic filter DSLs
- **Migration Tool**: Alembic
- **Rationale**: Robust relational database with strong JSONB support for plugin data (`plugin_data`, `manifest`, `data` columns all `postgresql.JSONB`)

## Build Tools & Package Management

### uv
- **Purpose**: Dependency resolution, lockfile (`uv.lock`), virtual environment management
- **Build backend**: `hatchling` (see `pyproject.toml`'s `[build-system]`)
- **Lockfile**: `uv.lock` — pinned, reproducible installs via `uv sync --frozen`

### npm (frontend)
- **Lockfile**: `src/frontend/package-lock.json` (`npm ci`); `next` and `eslint-config-next` are pinned to 16.4.4
- **Scripts** (`src/frontend/package.json`): `dev` = `next dev -p 5173`, `build` = `next build`, `start` = `next start -p 5173` (`predev`/`prebuild` run `build:sdk` first), `build:sdk` = `vite build -c vite.sdk.config.ts`, `typecheck` = `tsc --noEmit`, `lint` = `eslint .`, `test` = `vitest run`. The repo-root `package.json` `web` and `dev:all` scripts call the frontend `dev` script
- **Env**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (build-time, inlined into the client bundle; without it the place picker is manual-only) and `BACKEND_INTERNAL_URL` (server-only; `src/proxy.ts` and `src/api/server.ts` read it at runtime, while the `next.config.ts` rewrites are fixed at build time, so the Docker build also takes it as a build arg, default `http://backend:8080`)

## Infrastructure

### Containerization
- `docker-compose.yml` + `.env.example` live at the repo root (backend `Dockerfile` in `src/backend/`, frontend `Dockerfile` in `src/frontend/`) — `docker-compose up` brings up Postgres 18, the FastAPI service on port 8080, the Next.js server (`web`, standalone output on port 3000 inside the network, built from `src/frontend/Dockerfile` with the repo root as context) and nginx (`frontend`, the stock `nginx:1.27-alpine` image with `src/frontend/nginx.conf` mounted) in front of both on port 5174 (see `project/architecture.md`, Deployment Architecture). The dev server (`npm run dev`) runs on port 5173
- TestContainers-style isolation for a real pytest suite is deferred (see Testing above)

### CI/CD
- Not yet configured

### Hosting
- Two VPS (DE region, non-DO provider): VPS A runs nginx + FastAPI (with the Bielik-Guard text model in-process) + Postgres; VPS B runs the heavy AI models as a separate service (its own repo, `group-thing-ai`), including ShieldGemma-2 and the `moderation-cron` that decides product photos. VPS A runs no photo moderation worker
- DigitalOcean Spaces (FRA1) + its CDN for photo storage only
- Photo moderation integration runs in the other direction: VPS B's `moderation-cron` connects to the VPS A Postgres over the VPC (least-privilege role `gt_moderation_cron`, column-level grants, `ssl=require`) and to Spaces (read + put-ACL), with those credentials only in its `.env.cron`. The app itself never calls VPS B for moderation
- The `ml` uv dependency group is installed only in the production API image (the default `runtime` target, built with `docker build --secret id=hf_token,env=HF_TOKEN src/backend`); Bielik-Guard is exported to ONNX at image build time, so torch never enters a runtime image. The `runtime-dev` target has no `ml` group and no model

## Development Tools

### Linting & Formatting
- **ruff** (0.16.5) — `ruff check` (rules: E, F, I, UP, B, SIM) and `ruff format` (double-quote style), configured in `pyproject.toml`

- **ESLint** (9.39.4, frontend) — `eslint.config.js` with `eslint-config-next/core-web-vitals`, `typescript-eslint`, `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` on `**/*.{ts,tsx}`; `no-restricted-imports` bans `react-router-dom` everywhere and `next/navigation`/`next/link` outside `src/routing/`, `src/app/` and the test mocks

### Type Checking
- **mypy** (2.3.1) — `strict = true`, `disallow_untyped_defs = true`, `warn_unused_ignores = true`, `pydantic.mypy` plugin enabled. Strict mode is load-bearing for the footprint domain's discriminated-union exhaustiveness checking (`assert_never`), since Python has no compiler-enforced sealed-class exhaustiveness the way Java's sealed interfaces do.

## Key Dependencies

Actual pinned versions from `src/backend/pyproject.toml` / `uv.lock`:

| Dependency | Version | Purpose |
|---|---|---|
| fastapi | 0.141.1 | Web framework / routing |
| uvicorn[standard] | 0.52.4 | ASGI server |
| sqlalchemy | 2.0.44 | ORM + Core query DSL (async) |
| asyncpg | 0.31.0 | Async Postgres driver |
| alembic | 1.17.1 | Schema migrations |
| pyjwt | 2.13.0 | JWT encode/decode |
| bcrypt | 5.0.0 | Password hashing |
| pydantic | 2.13.5 | Request/response validation |
| pydantic-settings | 2.15.0 | Environment-based settings |
| tenacity | 9.1.4 | Retry/backoff (footprint audit pipeline) |
| tzdata | 2026.4 | Zone database for `zoneinfo` (`Europe/Warsaw` domain clock, `app/core/clock.py`) |
| python-multipart | 0.0.32 | Form-body parsing (OAuth2 `_token`/form fallbacks, photo uploads) |
| boto3 | 1.43.107 | DigitalOcean Spaces (S3 API) photo storage, `app/storage/` — plain boto3 in `asyncio.to_thread` (one dependency, no aioboto3) |
| pillow | 12.3.0 | Upload sanitization: decode allowlisted JPEG/PNG/WebP, EXIF strip, WebP re-encode (`app/storage/images.py`) |
| onnxruntime (`ml` group) | 1.30.0 | API `runtime` image only: CPU inference of Bielik-Guard (text moderation) |
| tokenizers (`ml` group) | 0.23.2 | API `runtime` image only: Bielik-Guard tokenizer |
| numpy (`ml` group) | 2.5.3 | API `runtime` image only: tensor pre/post-processing |
| ruff (dev) | 0.16.5 | Lint + format |
| mypy (dev) | 2.3.1 | Static typing (strict) |
| httpx | 0.28.1 | Used by tests (`AsyncClient`) and verification scripts; no runtime import in `app/` |

Frontend versions from `src/frontend/package-lock.json`:

| Dependency | Version | Purpose |
|---|---|---|
| next | 16.4.4 | App Router framework, server rendering, proxy |
| react / react-dom | 19.2.4 | UI library |
| @chakra-ui/react | 3.34.0 | Component system and theme |
| @emotion/react / @emotion/cache | 11.14.0 | Chakra's style engine; SSR style registry in `src/app/providers.tsx` (direct, exact-pinned) |
| @tanstack/react-query | 5.103.2 | Client server-state cache |
| dayjs | 1.11.23 | Dates (Polish locale) |
| lucide-react | 1.7.0 | Icons |
| server-only | 0.0.1 | Guard for server-only modules (`src/api/server.ts`) |
| tailwindcss / @tailwindcss/postcss (dev) | 4.3.3 | Utility CSS via PostCSS |
| typescript (dev) | 5.9.3 | Type checking (`tsc --noEmit`) |
| vitest (dev) | 3.2.4 | Test runner |
| vite / @vitejs/plugin-react (dev) | 8.0.3 / 6.0.1 | Vitest transform and the plugin SDK build |
| eslint / eslint-config-next (dev) | 9.39.4 / 16.4.4 | Lint |

## Version Management
- `uv.lock` pins every transitive dependency; `uv sync --frozen` installs exactly what's locked
- Python version floor: `requires-python = ">=3.12"` in `pyproject.toml`

## Architectural Decisions Pending
- **Plugin framework**: no runtime plugin-loading framework has been adopted — plugins remain frontend iframes talking to the host API (`app/plugin/`), not a server-side plugin-loading mechanism. Still an open decision if server-side plugin execution is ever required.

## Architectural Decisions Resolved
- **JPA vs jOOQ** (formerly pending): resolved as SQLAlchemy ORM (declarative `Mapped[...]` models) for CRUD verticals, plus SQLAlchemy Core (`select()`/`text()`) for the two dynamic filter-DSL query services (`app/product/query_service.py`, `app/plugin/query_service.py`) — one library serving both roles. See `standards/backend/models.md` and `standards/backend/jooq.md`.

---
*Last Updated*: 2026-11-02 (frontend: `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/`)
*Migrated from*: Java 25 / Spring Boot 4.0.5 / Maven — see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/` for the full migration record
