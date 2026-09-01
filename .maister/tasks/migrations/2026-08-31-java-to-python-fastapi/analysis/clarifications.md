# Phase 1 Clarifications

## Q1: OAuth2 authorization server scope
The Java backend hand-rolls a full OAuth2 authorization server (PKCE, rotating refresh tokens, RFC 8693 token-exchange for `mcp:read`/`mcp:edit` → `READ`/`EDIT`, dynamic client registration). The frontend never uses it (only `/api/auth/login`); the only plausible consumers are external plugins/MCP clients, with no proof of live usage found in this repo.

**Decision: Rewrite 1:1.** Preserve the full implementation — `/oauth2/authorize`, `/oauth2/token` (all three grant types), `/oauth2/introspect`, `/oauth2/register`, `/.well-known/oauth-authorization-server`, PKCE S256, rotating refresh tokens, and the `mcp:*` → `READ`/`EDIT` scope-mapping bridge — in case external consumers depend on it.

## Q2: Test coverage
The Java backend has 0% test coverage and no build file at all.

**Decision: Production code only.** Do not write a pytest/testcontainers-python suite as part of this migration. Tests are deferred to a separate follow-up task. (Note: `.maister/docs/standards/testing/backend-testing.md` still describes the intended pytest-equivalent strategy for whenever that follow-up happens.)

## Q3: Data layer stack
No Liquibase changelog, no schema, and no build file exist anywhere in the repo — the schema must be reverse-engineered from JPA entity annotations.

**Decision: SQLAlchemy 2.x (ORM + Core for the jOOQ-equivalent dynamic/JSONB queries) + Alembic for migrations.**

## Q4: DevOps/packaging scope
No Dockerfile, docker-compose, or CI exists for the backend today — there's nothing to "migrate," but something must exist for the new service to run at all.

**Decision: In scope.** Include `pyproject.toml` (uv-managed), a `Dockerfile`, and a `docker-compose.yml` (Postgres + FastAPI) as part of this migration so the service is actually runnable locally.

## Not asked / carried as hard constraints from analysis (not decisions, just confirmed facts)
- Both error-response conventions (legacy flat `ErrorResponse` + RFC 7807 `ProblemDetail` scoped to footprint) must be preserved byte-for-byte — the frontend parses both shapes explicitly.
- JWT claim shape (`sub`, `permissions`/`scopes` as flat string array, `iat`, `exp`, HS256, plain JWS not JWE) must be preserved exactly — plugins decode it client-side without a library.
- Full existing REST route table (paths, methods, request/response DTO shapes) must be preserved — frontend and plugin apps are out of scope for changes.
