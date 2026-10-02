# Codebase: Config, Secrets, Dependencies, Deployment

## 1. Settings (`src/backend/app/config.py`)

### F1.1 pydantic-settings with required secrets and no secret defaults
**Source**: `src/backend/app/config.py:18-35`. `Settings(BaseSettings)` uses `env_file=".env"` and `extra="ignore"` (`:19`). The required fields are `jwt_secret` and `database_url` (`:22-23`). The tuning knobs are `jwt_expiration_ms` and `cors_allowed_origins` (`:26-27`). It exposes the singleton `settings` (`:35`). The docstring states that nothing carries a hardcoded secret default, so a missing secret should fail loudly at startup (`:3-10`).
- **Implication**: Spaces settings would follow the same pattern, e.g. required `spaces_key`/`spaces_secret`/`spaces_bucket`/`spaces_region`/`spaces_endpoint`, an optional `spaces_cdn_base_url`, and optional HF settings `hf_token`/`hf_endpoint_url`. Making them **required** breaks every environment that lacks them, including tests: `Settings()` is built at import time, so the test suite needs the env vars or a fake. A design choice is needed between required-and-fail-fast and optional with the feature disabled. `standards/global/conventions.md:24-25` ("Feature Flags") supports a flag.
- **Confidence**: High.

### F1.2 Alembic reads `DATABASE_URL` only from the environment
Per the user memory note (`project_alembic_env_loading.md`), `.env` must be sourced before `uv run alembic upgrade head`. That is relevant to any new migration. **Confidence**: Medium (memory note, not re-verified in `alembic/env.py`).

## 2. `.env.example` (repo root)

**Source**: `.env.example:1-21`. It lists `JWT_SECRET`, `JWT_EXPIRATION_MS`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, plus **stale** `FOOTPRINT_PROBLEM_BASE_URI` and `FOOTPRINT_AUDIT_RETRY_*` (`:10-21`). The `app/footprint` module no longer exists: `ls src/backend/app` shows no `footprint`, and grep finds no `footprint` references in `app/`.
- Spaces/HF vars would be added here with placeholder values. **Confidence**: High.

## 3. docker-compose and Dockerfiles

### F3.1 Compose services: postgres, frontend-build, backend, frontend. No object storage, no worker, no plugins.
**Source**: `docker-compose.yml:1-71`.
- `postgres:18` (`:2-16`).
- `backend` (`:33-53`) runs `alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8080`, a **single process** with no `--workers` (`:39`). Its env is only `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRATION_MS` and `CORS_ALLOWED_ORIGINS` (`:42-46`).
- `frontend` is nginx on 5174 (`:55-67`).
- **Implication**: local dev of Spaces would add a `minio` service (S3-compatible) plus a bucket-init one-shot, mirroring the existing `frontend-build` one-shot pattern (`:18-31`). A separate moderation or worker service would be a new service entry. **Confidence**: High.

### F3.2 Backend image: python:3.12-slim with uv and no system image libraries
**Source**: `src/backend/Dockerfile:3-24`. Builder runs `uv sync --frozen --no-dev`. The runtime copies `/app` and runs uvicorn on 8080.
- **Implication**: Pillow ships manylinux wheels, so slim works without apt packages. pyvips would need `libvips` from apt. Adding `torch`/`transformers` to this image would add roughly 1–2+ GB (CPU torch) and hundreds of MB of RAM per process: an argument for keeping inference out of the API image (hosted endpoint or separate service). **Confidence**: High (Dockerfile) / Medium (size figures are general knowledge and should be verified by the hf-hosting gatherer).

### F3.3 nginx in front of the API has no `client_max_body_size`, so the default 1 MB applies
**Source**: `src/frontend/nginx.conf:7-12` (`location /api/ { proxy_pass http://backend:8080; … }`). It has no `client_max_body_size` directive. nginx's default is 1m.
- **Implication**: a **proxied** multipart upload through FastAPI fails with 413 for any phone photo over 1 MB unless nginx is changed. **Presigned direct-to-Spaces** uploads bypass nginx and the API entirely. The Vite dev proxy (`src/frontend/vite.config.ts:11-21`) has no such limit, so the problem would show up only in the docker/prod path. **Confidence**: High (config read; nginx default from general knowledge).

### F3.4 There is no CSP. Image origins are unrestricted.
A grep for `Content-Security`/`img-src` in `src/frontend/index.html` and `app/system/router.py` returns nothing. The CDN domain therefore needs no CSP change today, but a CSP added later must allowlist the Spaces/CDN origin. **Confidence**: Medium-high.

### F3.5 Backend CORS is irrelevant to presigned uploads, while Spaces bucket CORS is required
`app/main.py:85-91` configures CORS for the API from `settings.cors_allowed_origins_list`. A browser PUT/POST to `*.digitaloceanspaces.com` is governed by **bucket** CORS (to be researched by the spaces-upload gatherer), not by this middleware. **Confidence**: High.

### F3.6 No production deployment target is defined
`.maister/docs/project/architecture.md:100-106` says "No CI/CD or hosting decision yet", and the plugin apps are not in compose. The repo contains no DigitalOcean App Platform spec, droplet scripts or Terraform (`ls` of the repo root shows `docker-compose.yml` only). **Confidence**: High.

## 4. Dependencies (`src/backend/pyproject.toml`)

**Source**: `src/backend/pyproject.toml:6-19`

| Present | Relevance |
|---|---|
| `fastapi>=0.141,<0.142`, `uvicorn[standard]` | API |
| `python-multipart>=0.0.20` (`:17`) | Needed for `UploadFile`/`Form`. **Currently used only for OAuth2 form posts** (`app/oauth2/router.py:304`, `app/core/_auth/token.py:32`). Grep finds no `UploadFile` usage. |
| `tenacity>=9.0` (`:16`) | Retry/backoff for HF/Spaces HTTP calls |
| `apscheduler>=3.10,<4` (`:18`) | Periodic jobs (orphan cleanup) |
| `pydantic-settings` | Config |

Absent: `boto3`/`aioboto3`/`aiobotocore` (S3 client), `Pillow`/`pyvips` (image processing), `httpx` as a **runtime** dependency (it is dev-only at `:25`, so calling the HF Inference API would need `httpx` promoted to runtime or `huggingface_hub` added), `huggingface_hub`, `transformers`, `torch`, `onnxruntime`.
- **Dev deps**: `testcontainers>=4.8` (`:28`), which ships a MinIO module usable for integration tests of the storage path.
- **Standard**: "Minimal Dependencies — keep lean; document why major ones are included" (`.maister/docs/standards/global/conventions.md:15-16`). The tech-stack doc lists pinned versions and rationale (`.maister/docs/project/tech-stack.md`), so new dependencies must be added there.
- **Confidence**: High.

## 5. Frontend upload considerations from config
- `src/frontend/src/api/client.ts:19-33`: JSON-only client (see the gallery findings, F3.5).
- `src/frontend/vite.config.ts:11-21`: dev proxy for `/api`, `/oauth2` only. Direct uploads go to the Spaces origin and are not proxied.
- **Confidence**: High.
