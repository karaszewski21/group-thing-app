# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to understand available documentation and standards.

## Quick Reference

### Project Documentation
Project-level documentation covering architecture and technology choices for **aj** — a plugin-based microkernel platform with a Python/FastAPI backend.

### Technical Standards
Coding standards, conventions, and best practices organized by domain.

---

## Project Documentation

Located in `.maister/docs/project/`

### Tech Stack (`project/tech-stack.md`)
Python 3.12+, FastAPI, SQLAlchemy 2.0 (async) + asyncpg, Alembic, PostgreSQL, uv, PyJWT, bcrypt, Pydantic v2, tenacity, ruff, mypy. Includes exact pinned dependency versions, rationale for choices, and the resolved JPA-vs-jOOQ decision (SQLAlchemy ORM + Core serves both roles); migrated from Java/Spring Boot/Maven (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`).

### Architecture (`project/architecture.md`)
Microkernel (plugin-based) architecture pattern — no longer pre-alpha scaffolding; real business logic across category/product/plugin/footprint verticals plus a full OAuth2 authorization server. Documents the FastAPI `app/` package structure, database layer (Alembic + PostgreSQL), deferred test infrastructure, and data flow.

---

## Technical Standards

### Global Standards

Located in `.maister/docs/standards/global/`

#### Error Handling (`standards/global/error-handling.md`)
Clear user messages, fail-fast validation, typed exceptions, centralized handling, and graceful degradation.

#### Validation (`standards/global/validation.md`)
Server-side validation, client-side feedback, early input checking, specific error messages, and allowlists over blocklists.

#### Development Conventions (`standards/global/conventions.md`)
Predictable file structure, up-to-date documentation, clean version control, environment variables, and minimal dependencies.

#### Coding Style (`standards/global/coding-style.md`)
Naming consistency, automatic formatting, descriptive names, focused functions, and uniform indentation.

#### Commenting (`standards/global/commenting.md`)
Let code speak through structure and naming, comment sparingly for non-obvious logic, avoid change-log comments.

#### Minimal Implementation (`standards/global/minimal-implementation.md`)
Build only what is needed, clear purpose for every method, delete exploration artifacts, no future stubs or speculative abstractions.

### Backend Standards

Located in `.maister/docs/standards/backend/`

#### API Design (`standards/backend/api.md`)
RESTful principles, consistent naming, versioning, plural nouns for resources, and limited nesting.

#### SQLAlchemy Entity Modeling (`standards/backend/models.md`)
SQLAlchemy 2.0 entity modeling standards: shared `BaseEntity` mapped-superclass mixin (id via explicit Postgres `Sequence`, `created_at`, `updated_at` doing double duty as `version_id_col` for optimistic locking via a custom `version_id_generator`), string-backed enums (never ordinal), `lazy="raise"` plus explicit `joinedload`/`selectinload` (no implicit lazy-load under `AsyncSession`), business-key `__eq__`/`__hash__` (never surrogate id), cross-module references via plain FK-id columns (DDD bounded contexts), JSONB via `postgresql.JSONB`, and PK-strategy carve-outs (`PluginDescriptor` string PK, `RegisteredClient` UUID PK — neither uses `BaseEntity`). Migrated from JPA/Hibernate.

#### Database Queries (`standards/backend/queries.md`)
Parameterized queries via SQLAlchemy binding, N+1 avoidance with explicit eager loading (required, not optional, under `AsyncSession`), select only needed columns, strategic indexing via Alembic, and transactions.

#### SQLAlchemy Core Query Standards (`standards/backend/jooq.md`)
SQLAlchemy Core dynamic-query standards for the two hand-rolled filter-DSL query services (`app/product/query_service.py`'s 4-part grammar, `app/plugin/query_service.py`'s 3-part grammar — deliberately kept separate, not unified): bind-parameter discipline for comparison values, regex-validate-then-splice for JSONB path segments (`IDENTIFIER_PATTERN`), the `exists` operator's bind-not-splice asymmetry, N+1 prevention, query optimization (EXISTS over COUNT, explicit ordering, enforced SQL-level LIMIT), and common pitfalls (no unvalidated splicing, no NOT IN with nullables, no incidental DISTINCT). Migrated from jOOQ.

#### Database Migrations (`standards/backend/migrations.md`)
Alembic workflow (`revision --autogenerate`, review before applying), reversible migrations, small focused changes (with the documented one-time exception of the full-schema-reconstruction initial migration), explicit-sequence PK convention, naming conventions, zero-downtime awareness, separate schema and data migrations, and careful indexing. Migrated from Liquibase.

#### Security (`standards/backend/security.md`)
FastAPI dependency-based authorization (`Depends(require_any(...))`) replacing `@PreAuthorize`/`SecurityFilterChain`, the centralized `AUTHORIZATION_MATRIX`-as-code pattern (25-entry table, first-match-wins evaluation order) in `app/core/auth_deps.py`, custom exception handlers replicating legacy 401/403 envelopes, PyJWT claim shapes (login token: `sub`/`permissions`/`iat`/`exp`; OAuth2-issued token: `iss`/`sub`/`scopes`/`iat`/`exp`/`aud`), bcrypt password hashing, and the preserved hand-rolled OAuth2 authorization server (PKCE, rotating refresh tokens, RFC 8693 token-exchange bridge) with its documented known gaps. Migrated from Spring Security.

#### Plugin Authentication (`standards/backend/plugin-auth.md`)
Browser SDK auth via hostApp.getToken() and postMessage (unchanged by the backend migration), server-side auth with createServerSDK now forwarding JWT to the FastAPI backend, and permission checking in plugins by decoding the JWT's flat `permissions`/`scopes` claim (client-side contract unchanged; server-side implementation notes updated for FastAPI).

### Frontend Standards

Located in `.maister/docs/standards/frontend/`

#### CSS (`standards/frontend/css.md`)
Consistent methodology (Tailwind/BEM/modules), work with the framework, design tokens, minimize custom CSS, and production optimization.

#### Components (`standards/frontend/components.md`)
Single responsibility, reusability with configurable props, composability, clear interfaces, and encapsulation.

#### Accessibility (`standards/frontend/accessibility.md`)
Semantic HTML, keyboard navigation, color contrast (4.5:1), alt text and labels, and screen reader testing.

#### Responsive Design (`standards/frontend/responsive.md`)
Mobile-first approach, standard breakpoints, fluid layouts, relative units (rem/em), and cross-device testing.

### Testing Standards

Located in `.maister/docs/standards/testing/`

#### Backend Testing (`standards/testing/backend-testing.md`)
Integration test infrastructure with TestContainers and real PostgreSQL 18, integration-first testing strategy (over unit tests), what NOT to test (auto-generated repos, Lombok getters/setters, private methods), test data isolation with @Transactional rollback, MockMvc with jsonPath()/Hamcrest for HTTP assertions, test class naming (*Tests suffix, package-private, same package as production), test method naming (action_condition_expectedResult pattern), private createAndSave*() helper methods with saveAndFlush(), integration vs validation test class split, test scope guidelines (2-8 tests per feature, CRUD plus edge cases), MockMvc security integration requiring SecurityMockMvcConfiguration import for Spring Boot 4/Security 7, custom security test annotations (@WithMockEditUser, @WithMockAdminUser), and Spring Security 7 PathPattern constraints (single-segment `*` vs multi-segment `**`).

#### Frontend Testing (`standards/testing/frontend-testing.md`)
Vitest with globals and jsdom environment, @testing-library/react for component rendering and queries, @testing-library/jest-dom for extended DOM matchers, per-file renderWithProviders() helper wrapping ChakraProvider and MemoryRouter, API module mocking with vi.mock() factory functions and vi.resetAllMocks() in beforeEach, vi.mocked() for type-safe mock configuration, describe blocks named after pages/features, and test files in src/test/ directory.

---

## How to Use This Documentation

1. **Start Here**: Always read this INDEX.md first to understand what documentation exists
2. **Project Context**: Read relevant project documentation before starting work
3. **Standards**: Reference appropriate standards when writing code
4. **Keep Updated**: Update documentation when making significant changes
5. **Customize**: Adapt all documentation to your project's specific needs

## Updating Documentation

- Project documentation should be updated when goals, tech stack, or architecture changes
- Technical standards should be updated when team conventions evolve
- Always update INDEX.md when adding, removing, or significantly changing documentation
