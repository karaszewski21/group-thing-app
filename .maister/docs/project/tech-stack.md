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
- **`pyjwt[crypto]`**: the `crypto` extra pulls in `cryptography` (50.0.2 in `uv.lock`) for the RS256 verification of Google ID tokens against Google's JWKS (`app/auth/google.py`, fetched with `httpx`); the HS256 login token and the HS256 nonce cookie need no extra
- **Google sign-in env** (names only, never commit values): `GOOGLE_CLIENT_ID` (backend; empty = feature off, both `/api/auth/google*` routes answer 503), `AUTH_COOKIE_SECURE` (backend, default `true`; the `Secure` flag of the `aj_google_nonce` cookie, set `false` over http — dev `:5173`, compose `:5174` — or Safari drops the cookie) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, see **npm** below); both client IDs hold the same OAuth Web client ID

#### Jinja2 (3.1.6)
- **Purpose**: the mail templates of `app/email` (`app/email/templates/`, an HTML + text pair per template over `base.html.j2`/`base.txt.j2`), rendered with `select_autoescape` for the HTML and `StrictUndefined`; MarkupSafe 3.0.3 comes with it (`uv.lock`). Added with `uv add` (this environment needed `--system-certs` for the index TLS)
- **Mail transport**: no SDK — the Mailgun EU messages API is a plain `httpx` form POST (`app/email/senders.py`), SMTP the stdlib `smtplib` (dev Mailpit only)
- **E-mail env** (names only, never commit values): `EMAIL_ENABLED`, `EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_BACKEND`, `EMAIL_PROVIDER_API_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO_ADDRESS`, `EMAIL_LINK_SIGNING_SECRET`, `EMAIL_WEBHOOK_SIGNING_KEY`, `EMAIL_DAILY_CAP`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `APP_PUBLIC_BASE_URL`; see `project/architecture.md`, **E-mail** and **Configuration**

#### tenacity (9.1.4)
- **Purpose**: Retry/backoff for the footprint audit pipeline's async persistence task. Note: `wait_exponential`'s signature is `(multiplier=<base wait>, exp_base=<growth factor>, min=...)` — the inverse of what its parameter names might suggest if read too quickly (documented at length in `app/footprint/audit/task.py`).

#### tzdata (2026.4)
- **Purpose**: IANA zone database for `zoneinfo`. Explicit runtime dependency because `python:3.12-slim` ships no zone files; `app/core/clock.py` needs `Europe/Warsaw` and startup fails fast without it.

#### uvicorn (0.52.4, `[standard]` extras)
- **Purpose**: ASGI server

### Wants matcher (`src/matcher`, project `aj-matcher`)
- **Purpose**: the separate matching process of the wants feature (`python -m matcher`, compose service `matcher`); see `project/architecture.md`, Wants.
- **Runtime**: Python >=3.12, **asyncpg (0.31.0) is the only runtime dependency** (raw SQL over the backend's DB contract from migrations 0099 and 0100–0101, the SIMILAR tier comparing the stored `halfvec` vectors in SQL; no SQLAlchemy, no FastAPI, no import from `app.*`).
- **Own project files**: `pyproject.toml`, `uv.lock` and `Dockerfile` (`python:3.12-slim` + uv, no secrets), independent of `src/backend`.
- **Dev tools**: pytest + pytest-asyncio + testcontainers (a `pgvector/pgvector:0.8.7-pg18-trixie` container migrated with the backend's Alembic, so `alembic`/`sqlalchemy` are dev-only pins), ruff, mypy `strict = true` with `asyncpg-stubs`. Commands in `project/architecture.md` (Wants, **Matcher commands**).

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

pytest + pytest-asyncio against a real PostgreSQL 18 (`pgvector/pgvector:0.8.7-pg18-trixie`) started by `testcontainers` (Docker required, `alembic upgrade head` once per session); see `standards/testing/backend-testing.md`. During the Java-to-Python migration the verticals were verified with manual live-uvicorn + real-Postgres scripts; the suite came later. The matcher has its own suite on the same pattern (`src/matcher/tests`).

## Database

### PostgreSQL 18
- **Type**: Relational (RDBMS)
- **ORM/Client**: SQLAlchemy 2.0 (async) — ORM for CRUD, Core `select()`/`text()` for dynamic filter DSLs
- **Migration Tool**: Alembic
- **Rationale**: Robust relational database with strong JSONB support for plugin data (`plugin_data`, `manifest`, `data` columns all `postgresql.JSONB`)
- **Image**: `pgvector/pgvector:0.8.7-pg18-trixie` (compose and both test suites): PostgreSQL 18 with pgvector
- **Extensions**: `pg_trgm` (0086, search and wants) and `vector` (pgvector 0.8.7, 0100, superuser): `halfvec(768)` columns in `product_embeddings`/`want_embeddings`, cosine distance `<=>`, exact scan with no vector index (revisit at about 500,000 listings)

## Build Tools & Package Management

### uv
- **Purpose**: Dependency resolution, lockfile (`uv.lock`), virtual environment management
- **Build backend**: `hatchling` (see `pyproject.toml`'s `[build-system]`)
- **Lockfile**: `uv.lock` — pinned, reproducible installs via `uv sync --frozen`

### npm (frontend)
- **Lockfile**: `src/frontend/package-lock.json` (`npm ci`); `next` and `eslint-config-next` are pinned to 16.4.4
- **Scripts** (`src/frontend/package.json`): `dev` = `next dev -p 5173`, `build` = `next build`, `start` = `next start -p 5173` (`predev`/`prebuild` run `build:sdk` first), `build:sdk` = `vite build -c vite.sdk.config.ts`, `typecheck` = `tsc --noEmit`, `lint` = `eslint .`, `test` = `vitest run`. The repo-root `package.json` `web` and `dev:all` scripts call the frontend `dev` script
- **Env**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (build-time, inlined into the client bundle; without it the place picker is manual-only; the place form's draggable pin map (`components/shared/PlaceMapPicker.tsx`, `DEMO_MAP_ID` advanced marker) also needs the Geocoding API and the location map of the shared `PlaceCard` on item, term and event pages (`PlaceMapEmbed`, locality only for item non-owners) the Maps Embed API on the same key) and `BACKEND_INTERNAL_URL` (server-only; `src/proxy.ts` and `src/api/server.ts` read it at runtime, while the `next.config.ts` rewrites are fixed at build time, so the Docker build also takes it as a build arg, default `http://backend:8080`) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (build-time, inlined like the Maps key, so a change needs a rebuild of `web`; empty = no Google button and no script; when set, `src/lib/googleIdentity.ts` loads the Google Identity Services script `https://accounts.google.com/gsi/client` on demand)

## Infrastructure

### Containerization
- `docker-compose.yml` + `.env.example` live at the repo root (backend `Dockerfile` in `src/backend/`, frontend `Dockerfile` in `src/frontend/`) — `docker-compose up` brings up Postgres 18 (`pgvector/pgvector:0.8.7-pg18-trixie`), the FastAPI service on port 8080, the Next.js server (`web`, standalone output on port 3000 inside the network, built from `src/frontend/Dockerfile` with the repo root as context), the wants `matcher` (built from `src/matcher/Dockerfile`, no port, `restart: unless-stopped`) and nginx (`frontend`, the stock `nginx:1.27-alpine` image with `src/frontend/nginx.conf` mounted) in front of both on port 5174 (see `project/architecture.md`, Deployment Architecture). The dev server (`npm run dev`) runs on port 5173
- **Mailpit** `axllent/mailpit:v1.27.10` (dev only, `profiles: ["dev"]`, started with `docker compose --profile dev up -d mailpit`): the SMTP catcher for `EMAIL_BACKEND=smtp`, SMTP 1025 on the compose network, web UI on `127.0.0.1:8025`
- Both pytest suites (`src/backend/tests`, `src/matcher/tests`) start their own `pgvector/pgvector:0.8.7-pg18-trixie` testcontainer (Docker required), isolated from the compose database (see Testing above)

### CI/CD
- Not yet configured

### Hosting
- Two VPS (DE region, non-DO provider): VPS A runs nginx + FastAPI (with the Bielik-Guard text model in-process) + Postgres; VPS B runs the heavy AI models as a separate service (its own repo, `group-thing-ai`), including ShieldGemma-2 and the `moderation-cron` that decides product photos. VPS A runs no photo moderation worker
- DigitalOcean Spaces (FRA1) + its CDN for photo storage only
- Mailgun (EU region) for outbound mail while `EMAIL_ENABLED=true` and `EMAIL_BACKEND=mailgun`, with delivery webhooks back to `POST /api/email/webhooks/mailgun`
- Photo moderation integration runs in the other direction: VPS B's `moderation-cron` connects to the VPS A Postgres over the VPC (least-privilege role `gt_moderation_cron`, column-level grants, `ssl=require`) and to Spaces (read + put-ACL), with those credentials only in its `.env.cron`. The app itself never calls VPS B for moderation
- The `ml` uv dependency group is installed only in the production API image (the default `runtime` target, built with `docker build --secret id=hf_token,env=HF_TOKEN src/backend`); Bielik-Guard and the embed model (`sdadas/mmlw-roberta-base` at a pinned revision, int8, into `/models/embed`) are exported to ONNX at image build time in the throwaway `models` stage, so torch and optimum never enter a runtime image and `onnxruntime.quantization` runs only in that stage. The `runtime-dev` target has no `ml` group and no model

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
| pyjwt[crypto] | 2.13.0 | JWT encode/decode; the `crypto` extra (`cryptography` 50.0.2) verifies Google's RS256 ID tokens |
| bcrypt | 5.0.0 | Password hashing |
| pydantic | 2.13.5 | Request/response validation |
| pydantic-settings | 2.15.0 | Environment-based settings |
| jinja2 | 3.1.6 | Mail templates (`app/email/rendering.py`, autoescaped HTML + text) |
| tenacity | 9.1.4 | Retry/backoff (footprint audit pipeline) |
| tzdata | 2026.4 | Zone database for `zoneinfo` (`Europe/Warsaw` domain clock, `app/core/clock.py`) |
| python-multipart | 0.0.32 | Form-body parsing (OAuth2 `_token`/form fallbacks, photo uploads) |
| boto3 | 1.43.107 | DigitalOcean Spaces (S3 API) photo storage, `app/storage/` — plain boto3 in `asyncio.to_thread` (one dependency, no aioboto3) |
| pillow | 12.3.0 | Upload sanitization: decode allowlisted JPEG/PNG/WebP, EXIF strip, WebP re-encode (`app/storage/images.py`) |
| onnxruntime (`ml` group) | 1.30.0 | API `runtime` image only: CPU inference of Bielik-Guard (text moderation) and of the embedder (`app/embeddings/onnx_embedder.py`); `onnxruntime.quantization` runs only in the Dockerfile `models` stage |
| tokenizers (`ml` group) | 0.23.2 | API `runtime` image only: Bielik-Guard and embedder tokenizers |
| numpy (`ml` group) | 2.5.3 | API `runtime` image only: tensor pre/post-processing |
| ruff (dev) | 0.16.5 | Lint + format |
| mypy (dev) | 2.3.1 | Static typing (strict) |
| httpx | 0.28.1 | Runtime: the Google JWKS fetch in `app/auth/google.py` (5 s timeout) and the Mailgun messages POST in `app/email/senders.py` (10 s, connect 5 s); also used by tests (`AsyncClient`) and verification scripts |

Database extensions and baked-in models (not uv dependencies):

| Component | Version | Purpose |
|---|---|---|
| pgvector (`vector` extension) | 0.8.7 (`pgvector/pgvector:0.8.7-pg18-trixie`) | `halfvec(768)` name vectors for the wants SIMILAR tier; cosine distance, exact scan, no vector index (migration 0100) |
| `sdadas/mmlw-roberta-base`, int8 ONNX | revision `bdeb29a43c3d58af1e6ed9d1836703a1ddfbe1d7` | Polish name embedder (CLS pooling, L2-normalised, 768 dims), baked into `/models/embed` (`EMBEDDINGS_MODEL_DIR`); `EMBEDDING_MODEL_ID = "sdadas/mmlw-roberta-base@bdeb29a43c3d58af1e6ed9d1836703a1ddfbe1d7+int8"`, pinned in `app/embeddings/service.py`, the Dockerfile ARGs and `matcher/rules.py`; MatMul-only QInt8 behind a ≥ 0.99 cosine parity gate at build time (measured 0.9904); about 241 MB; `model.sha256` beside it records the weight hash (`4552576b345ea0464a3d5fa651a95376fb52841197868a4b02c4f8e129061e08` for the pinned stack below) |
| Dockerfile `models` stage (build only, pip) | torch 2.7.1 (CPU), optimum-onnx 0.1.0, optimum 2.1.0, onnxruntime 1.32.0, onnx 1.23.2, transformers 4.57.6, tokenizers 0.22.2, numpy 2.5.5, huggingface_hub 0.36.2 | ONNX export and int8 quantization of both models; pinned to the resolution that measured the parity, so a bump re-runs the parity gate and, with a new weight hash, the release-gate sweep. The runtime `ml` group infers with onnxruntime 1.30.0 |
| Bielik-Guard (`speakleash/Bielik-Guard-0.1B-v1.1`), ONNX | Hub latest at build | Text moderation, baked into `/models/text` (needs the `hf_token` build secret) |

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
*Last Updated*: 2026-11-18 (wants semantic tier: `.maister/tasks/development/2026-11-18-wants-semantic-similar-tier/`)
*Migrated from*: Java 25 / Spring Boot 4.0.5 / Maven — see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/` for the full migration record
