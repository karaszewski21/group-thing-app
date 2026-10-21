# Docs & Standards: configuration and dependency inventory (token generation, rate limiting)

**Category**: `docs-standards` (configuration sub-part of Gathering Strategy row 3)
**Secrets rule**: only key names were listed from `.env.example` (`grep -oE '^[A-Z_][A-Z0-9_]*'`); `.env` was never opened; `docker-compose.yml` lines containing `PASSWORD`/`SECRET`/`KEY=` were filtered out of the listing. No values appear below.

## 1. Environment keys (names only)

**Root `.env.example`** (the only one; `src/backend/.env.example` does not exist — `architecture.md` l.207 confirms it was moved to the repo root):
`JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `DATABASE_URL`, `FOOTPRINT_AUDIT_RETRY_MAX_ATTEMPTS`, `FOOTPRINT_AUDIT_RETRY_DELAY_MS`, `FOOTPRINT_AUDIT_RETRY_MULTIPLIER`, `SPACES_ENDPOINT_URL`, `SPACES_REGION`, `SPACES_BUCKET`, `SPACES_KEY`, `SPACES_SECRET`, `SPACES_PUBLIC_BASE_URL`, `MODERATION_TEXT_ENABLED`, `MODERATION_TEXT_REJECT_THRESHOLD`, `MODERATION_MODELS_DIR`, `MODERATION_IMAGE_ENABLED`, `VITE_GOOGLE_MAPS_API_KEY`.

**Finding**: no `JOIN_CODE_*`, `RATE_LIMIT_*`, `REDIS_*` key exists. Confidence: High.

## 2. `src/backend/app/config.py` (`Settings`, pydantic-settings)

- `model_config = SettingsConfigDict(env_file=".env", extra="ignore")` (l.20) — unknown env vars are silently dropped (so a mis-spelled `JOIN_CODE_TTL` would be ignored, as `architecture.md` l.67 warns for `MODERATION_ENABLED`).
- Required: `jwt_secret`, `database_url` (l.23–24). Knobs with defaults: `jwt_expiration_ms=3_600_000`, `cors_allowed_origins`, `spaces_*` (all `None`), `moderation_text_enabled=False`, `moderation_image_enabled=False`, `moderation_models_dir`, `moderation_text_reject_threshold=0.8` (l.27–49).
- Precedent for a new knob: a typed field with a default documented in a comment, mirrored in `.env.example`/`docker-compose.yml` (`architecture.md` l.22). A `join_code_length`/`join_code_ttl_hours`/`join_attempt_limit` setting would go here — but `minimal-implementation.md` argues for constants in the groups module unless ops actually needs to tune them.
- Note: `sources.md` l.128 cites `src/backend/app/config.py` (correct); the gatherer brief's `app/core/config.py` does not exist.

## 3. `docker-compose.yml` (services)

Services: `postgres` (image `postgres:18`), `frontend-build` (one-shot index.html builder), `backend` (`alembic upgrade head && exec uvicorn ... --port 8080`), `frontend` (nginx, 5174:80). Volumes: `postgres_data`, `frontend_index`. Secret: `hf_token` (build-time only).
**Finding**: **no Redis, no memcached, no reverse-proxy rate limiting declared in compose** (nginx config in `src/frontend/` was not inspected here; `architecture.md` l.211 mentions only a 16 MB body limit). Confidence: High for compose; Medium for nginx.

## 4. `src/backend/pyproject.toml` dependencies

Runtime (l.6–23): `fastapi>=0.141,<0.142`, `uvicorn[standard]`, `sqlalchemy==2.0.44`, `asyncpg==0.31.0`, `alembic==1.17.1`, `pyjwt>=2.13.0`, `bcrypt>=4.2`, `pydantic>=2`, `pydantic-settings>=2.6`, `tenacity>=9.0`, `python-multipart`, `apscheduler>=3.10,<4`, `boto3`, `pillow`, `httpx`, `tzdata>=2026.4`.
Dev (l.26–33): `ruff`, `mypy`, `pytest`, `pytest-asyncio`, `testcontainers`, `boto3-stubs`. `ml` group: `numpy`, `onnxruntime`, `tokenizers`.
Tooling: ruff line-length 100, rules E/F/I/UP/B/SIM, double quotes (l.58–66); mypy `strict = true`, `pydantic.mypy` plugin (l.68–73).

**Grep of `app/` + `pyproject.toml` + `uv.lock` for `slowapi|limits|redis|rate_limit|ratelimit|429`**: zero relevant hits (only the oauth2 docstring saying stores are "not durable to Postgres/Redis", and a Google caching-limits comment). Confidence: High.

### Relevant to token generation (all stdlib, nothing to add)
| Need | Available | Evidence |
|------|-----------|----------|
| CSPRNG code | `secrets.choice(alphabet)` / `secrets.token_urlsafe` | precedent `app/oauth2/stores.py` l.59–61, l.132 (`secrets.token_urlsafe(32)` "256-bit URL-safe base64 code") |
| Hashing a code for storage | `hashlib.sha256` / `hmac` (stdlib); `bcrypt` (installed, but salted → not lookup-able by value) | `pyproject.toml` l.13; `security.md` §Password Storage |
| Constant-time compare | `secrets.compare_digest` / `hmac.compare_digest` (stdlib) | — |
| Scheduled expiry/cleanup job | `apscheduler` 3.x already wired in the lifespan (`architecture.md` l.48 "before the outbox poller and APScheduler start") | `pyproject.toml` l.18 |
| Retry/backoff helper | `tenacity` (only used for the footprint audit pipeline) | `tech-stack.md` l.36–37 |

### Relevant to rate limiting (nothing installed)
| Option | Status | Notes |
|--------|--------|-------|
| `slowapi` / `limits` | not installed | would need a `pyproject.toml` + `uv.lock` change and a documented reason (`conventions.md` §Minimal Dependencies); `uv.lock` must ship (`time.md` l.20) |
| Redis | not in compose, not in deps | OAuth2 stores are in-memory single-instance by deliberate decision (`security.md` l.67) — same single-instance assumption would apply to an in-process attempt counter |
| DB-backed counter | feasible with existing SQLAlchemy/asyncpg (e.g. `join_code_failed_attempts`/`join_code_locked_until` columns on `groups`, or per-user columns) | naive-UTC marker columns per `time.md`; optimistic lock via `updated_at` means concurrent failed attempts can raise `StaleDataError` → 409 unless written with an `UPDATE ... SET n = n + 1` Core statement |
| In-process dict with TTL | feasible (precedent: oauth2 in-memory stores with TTL, `app/oauth2/stores.py` l.3) | lost on restart, single instance |
| nginx `limit_req` | not verified (nginx conf not read in this category) | would be outside the app; `api.md` still expects rate-limit headers |
| 429 envelope | **no handler** in `app/core/errors.py` l.144–162 | add a typed exception + handler; frontend `queryClient` won't retry 4xx (`queryClient.ts` l.8–11) and `serverMessageOr` only passes through 400/409/503 messages (`problem.ts` l.67–79) — a 429 would fall to the Polish fallback unless extended |

## 5. `src/frontend/package.json`

Runtime (l.15–23): `@chakra-ui/react ^3.34.0`, `@tanstack/react-query ^5.103.2`, `dayjs ^1.11.23`, `lucide-react ^1.7.0`, `react ^19.2.4`, `react-dom ^19.2.4`, `react-router-dom ^7.13.2`.
Dev (l.24–44): `vitest ^3.2.4`, `jsdom ^27`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`, `tailwindcss ^4.3.3` + `@tailwindcss/vite`, `typescript ~5.9.3`, `vite ^8`, eslint 9 + `typescript-eslint`.
Scripts: `test = vitest run`, `build = tsc -b && vite build && vite build -c vite.sdk.config.ts`, `lint = eslint .`.

**Finding**: no clipboard/OTP-input/QR library; copying a code uses `navigator.clipboard` (browser API); `react-router-dom` v7 `useSearchParams`/`setSearchParams(..., { replace: true })` is available for consuming and stripping `?code=`. Confidence: High for deps, Medium for the router API suggestion (not verified in the codebase).

## 6. Summary for the synthesizer

1. There is **no rate-limiting infrastructure of any kind** (no lib, no Redis, no 429 handler, no setting); any throttle is new code and a new decision.
2. There is **no join-code setting**; `Settings` is the place for one, but the knob is optional under `minimal-implementation.md`.
3. Secret generation needs only the stdlib `secrets` module (precedent in `app/oauth2/stores.py`); hashing needs only `hashlib`/`hmac`.
4. The backend is single-instance by existing design (in-memory OAuth2 stores), so an in-process attempt counter is consistent with current assumptions but a DB counter is the only option that survives restarts.
5. Frontend stack (TanStack v5, Chakra v3, Tailwind v4, react-router v7, dayjs/pl) already covers the UI needs; no new dependency is required.
