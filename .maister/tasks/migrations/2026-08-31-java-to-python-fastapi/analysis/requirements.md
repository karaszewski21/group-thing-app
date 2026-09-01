# Phase 3 Requirements Gathering

## R1: Deployment context
This is a **first-ever deployment**, not a live-traffic cutover. The Java backend has never been built or deployed (no build file, no config, no Docker/CI ever existed). There is no production instance to protect, no downtime window to plan, and "rollback" means "the Java source remains in git history," not "shift traffic back." Correctness and contract-fidelity (vs. the frontend/plugins that already exist and work) are the only real constraints — not availability during cutover.

## R2: Scope boundaries
Only the backend language/framework changes. `src/frontend/` (React/Vite) and `plugins/` (plugin apps) are untouched except for a possible dev-proxy port confirmation (already resolved: `vite.config.ts` proxies `/api` → `http://localhost:8080`, so the new FastAPI service must listen on 8080). Where the new Python code physically lives (replace `src/backend/` in place vs. a new sibling directory) is an implementation-planning decision, not a requirements question — defer to Phase 4.

## R3: Secrets/config delivery
`app.jwt.secret` and other config values referenced via Spring `@Value` (`app.cors.allowed-origins`, `app.footprint.problem-base-uri`, `app.footprint.audit.retry.*`, DB connection string) have no recoverable real value from this repo (no `application.properties` ever existed). The Python service will read these from environment variables (e.g. `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `FOOTPRINT_PROBLEM_BASE_URI`, `DATABASE_URL`), documented in `docker-compose.yml` and/or a `.env.example`, with actual secret values supplied later at deploy time — out of scope for this task.

## R4: Documentation scope expansion
In addition to updating `.maister/docs/project/tech-stack.md` and `architecture.md` (original request), this task now also updates the Java-specific backend standards under `.maister/docs/standards/backend/` (`models.md`, `jooq.md`, `queries.md`, `migrations.md`, `security.md`, `plugin-auth.md`) to describe the new Python/FastAPI/SQLAlchemy/Alembic conventions, so `.maister/docs/INDEX.md` and `CLAUDE.md` don't reference stale Java-era standards as if they were current.

## Carried-forward hard constraints (from clarifications.md / target-state-plan.md, not re-litigated)
- Full REST route table (paths, methods, request/response DTO shapes) preserved exactly.
- Both error-response envelopes preserved exactly (legacy flat `ErrorResponse` + RFC7807 `ProblemDetail` scoped to footprint).
- JWT claim shape preserved exactly (plain JWS, flat `permissions`/`scopes` string array, `sub`, `iat`, `exp`, HS256, base64-decode-before-HMAC-key-use).
- OAuth2 authorization server rewritten 1:1 (all grant types, PKCE, rotating refresh tokens, token-exchange bridge, DCR, introspection, metadata) — in-memory code/token stores preserved as-is.
- PER_100G untyped-exception bug preserved as-is (not fixed).
- `@Version`-as-`updatedAt` optimistic locking preserved exactly via SQLAlchemy `version_id_col`.
- Footprint emission-factor/product-attribute ports stay in-memory stubs (1:1 port of current seed data).
- No automated test suite in scope (ruff/mypy static gates only).
- Dockerfile + docker-compose.yml (Postgres 18 + FastAPI) in scope.
- Plugin-data PUT confirmed as replace-under-key semantics (not merge) — no ambiguity remains.
