# Technology Stack

## Overview
This document describes the technology choices and rationale for **aj** — a plugin-based microkernel platform. The backend was migrated from a Java/Spring Boot scaffold to Python/FastAPI (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the stack below reflects the Python backend as actually built.

## Languages

### Python (>=3.12)
- **Usage**: 100% of `src/backend`
- **Rationale**: Mature async ecosystem (FastAPI/SQLAlchemy 2.0), fast iteration, strong typing support via `mypy --strict`
- **Key Features Used**: `enum.StrEnum`, `match`/`assert_never` exhaustiveness checking (domain discriminated unions), `dataclass(frozen=True, slots=True)`, PEP 604 union types (`X | None`)

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

#### uvicorn (0.52.4, `[standard]` extras)
- **Purpose**: ASGI server

### Testing

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

## Infrastructure

### Containerization
- `docker-compose.yml` + `.env.example` live at the repo root (backend `Dockerfile` in `src/backend/`, frontend `Dockerfile` in `src/frontend/`) — `docker-compose up` brings up Postgres 18, the FastAPI service on port 8080, and the frontend app shell (nginx) on port 5173, matching `src/frontend/vite.config.ts`'s dev-proxy target
- TestContainers-style isolation for a real pytest suite is deferred (see Testing above)

### CI/CD
- Not yet configured

### Hosting
- Not yet determined

## Development Tools

### Linting & Formatting
- **ruff** (0.16.5) — `ruff check` (rules: E, F, I, UP, B, SIM) and `ruff format` (double-quote style), configured in `pyproject.toml`

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
| python-multipart | 0.0.32 | Form-body parsing (OAuth2 `_token`/form fallbacks) |
| ruff (dev) | 0.16.5 | Lint + format |
| mypy (dev) | 2.3.1 | Static typing (strict) |
| httpx (dev) | 0.28.1 | Manual verification scripts (live HTTP calls against uvicorn) |

## Version Management
- `uv.lock` pins every transitive dependency; `uv sync --frozen` installs exactly what's locked
- Python version floor: `requires-python = ">=3.12"` in `pyproject.toml`

## Architectural Decisions Pending
- **Plugin framework**: no runtime plugin-loading framework has been adopted — plugins remain frontend iframes talking to the host API (`app/plugin/`), not a server-side plugin-loading mechanism. Still an open decision if server-side plugin execution is ever required.

## Architectural Decisions Resolved
- **JPA vs jOOQ** (formerly pending): resolved as SQLAlchemy ORM (declarative `Mapped[...]` models) for CRUD verticals, plus SQLAlchemy Core (`select()`/`text()`) for the two dynamic filter-DSL query services (`app/product/query_service.py`, `app/plugin/query_service.py`) — one library serving both roles. See `standards/backend/models.md` and `standards/backend/jooq.md`.

---
*Last Updated*: 2026-09-01
*Migrated from*: Java 25 / Spring Boot 4.0.5 / Maven — see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/` for the full migration record
