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
Microkernel (plugin-based) architecture pattern — no longer pre-alpha scaffolding; real business logic across category/product/plugin/footprint verticals plus a full OAuth2 authorization server. Covers the category tree (Vinted-seeded, products on leaf categories only), `inventory_items.listing_status`, needed items as plain names, the removed photo-moderation listing gate, the `app/events` bounded context (migration 0070, `POST /api/events` + banner upload with public w1600/w400 files, native `/add/event` host form; the `plugins/events` plugin kept but not mounted), and the 0064–0069 cutover/rollback runbook. Documents the FastAPI `app/` package structure, database layer (Alembic + PostgreSQL), deferred test infrastructure, and data flow.

---

## Technical Standards

### Global Standards

Located in `.maister/docs/standards/global/`

#### Error Handling (`standards/global/error-handling.md`)
Clear user messages, fail-fast validation, typed exceptions, centralized handling, and graceful degradation.

#### Validation (`standards/global/validation.md`)
Server-side validation, client-side feedback, early input checking, specific error messages, allowlists over blocklists, and integer inputs as `type="text" inputMode="numeric" pattern="[0-9]*"` (never `type=number`) with the raw string in state, one shared parser returning `null`/number/`undefined` (`parseCapacity` in `utils/appHelpers.ts`), an inline Polish `role="alert"` error with `aria-invalid`/`aria-describedby`, submit disabled while invalid, and server-side `ge`/`le` still enforced.

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
SQLAlchemy 2.0 entity modeling standards: shared `BaseEntity` mixin (`app/core/base_model.py`) with a UUID `id` (`uuid4` default + `gen_random_uuid()` server default; no per-table `Sequence`), `created_at`, and `updated_at` doubling as `version_id_col` for optimistic locking; PK carve-outs (`PluginDescriptor` string PK, `RegisteredClient` app-generated UUID PK, both on plain `Base`); string-backed enums; `lazy="raise"` plus explicit eager loading; business-key `__eq__`/`__hash__`; cross-module references as plain FK-id columns, with the groups BC declaring no `relationship()` at all and loading related rows via batched `IN` lookups; coordinates as `Numeric(9,6)` exposed as `float`; soft delete via nullable naive-UTC `deleted_at` with explicit list filters and partial unique indexes (soft-deleted Circles 404 by id, referenced Locations still render with `deleted_at`/"(usunięte)"); the category tree (`parent_id` self-FK RESTRICT without `relationship()`, nullable unique Vinted `external_id`, `(parent_id, name)` uniqueness + partial root-unique index and business key, leaf-only products via `require_leaf_category`) and `inventory_items.listing_status` (DRAFT/ACTIVE, VARCHAR(20) via `_enum_column`, written only in lockstep with `item_listing_preferences`, by groups through `circulation_bridge`); and cross-context access through a single `infrastructure/<other>_acl.py` (no `..schemas` import, owner's 404-before-403 check, batched `get_<x>s_by_ids`, narrow `LocationRefResponse`/`PublicLocationResponse` embeds, unchanged reference ids not re-validated).

#### Database Queries (`standards/backend/queries.md`)
Parameterized queries via SQLAlchemy binding, N+1 avoidance with explicit eager loading (required, not optional, under `AsyncSession`), select only needed columns, strategic indexing via Alembic, and transactions.

#### SQLAlchemy Core Query Standards (`standards/backend/jooq.md`)
SQLAlchemy Core dynamic-query standards for the two hand-rolled filter-DSL query services (`app/product/query_service.py`'s 4-part grammar, `app/plugin/query_service.py`'s 3-part grammar — deliberately kept separate, not unified): bind-parameter discipline for comparison values, regex-validate-then-splice for JSONB path segments (`IDENTIFIER_PATTERN`), the `exists` operator's bind-not-splice asymmetry, N+1 prevention, query optimization (EXISTS over COUNT, explicit ordering, enforced SQL-level LIMIT), and common pitfalls (no unvalidated splicing, no NOT IN with nullables, no incidental DISTINCT). Migrated from jOOQ.

#### Database Migrations (`standards/backend/migrations.md`)
Alembic workflow (`revision --autogenerate`, review before applying), reversible migrations whose `downgrade()` drops in reverse dependency order (FKs before columns, indexes before tables, later revisions before earlier ones), a downgrade-then-upgrade-head pytest per migration (`tests/test_locations_migration.py`, `tests/test_group_soft_delete_migration.py`), small focused changes (one-time full-schema `0001` exception), UUID PKs with `server_default=gen_random_uuid()` and `pk_<table>` (no sequences/IDENTITY), explicit `pk_`/`fk_<table>_<col>_<ref>`/`ix_`/`uq_` names, partial unique indexes via `postgresql_where=... AND deleted_at IS NULL`, additive nullable columns with no backfill in a separate revision from new tables, deleting self-referential trees leaves-first (repeat `DELETE … WHERE NOT EXISTS (child)`, never null `parent_id` first because nulled siblings collide on the partial root-unique index; `0069_vinted_categories.py`), data migrations deleting storage-backed rows staging `storage.objects_delete` outbox entries (`{"keys": [...]}` as in `_stage_photo_files_delete`, ≤1000 keys each) in the same transaction before the delete, zero-downtime awareness, separate schema and data migrations, and careful indexing. Migrated from Liquibase.

#### Security (`standards/backend/security.md`)
FastAPI dependency-based authorization (`Depends(require_any(...))`) replacing `@PreAuthorize`/`SecurityFilterChain`, the `AUTHORIZATION_MATRIX` reference table in `app/core/authorization_matrix.py` (first-match-wins evaluation order, verified by tests, enforced per route through `Depends(require_any(...))` or no dependency for PUBLIC rows), custom exception handlers replicating legacy 401/403 envelopes, PyJWT claim shapes (login token: `sub`/`permissions`/`iat`/`exp`; OAuth2-issued token: `iss`/`sub`/`scopes`/`iat`/`exp`/`aud`), bcrypt password hashing, and the preserved hand-rolled OAuth2 authorization server (PKCE, rotating refresh tokens, RFC 8693 token-exchange bridge) with its documented known gaps. Migrated from Spring Security.

#### Plugin Authentication (`standards/backend/plugin-auth.md`)
Browser SDK auth via hostApp.getToken() and postMessage (unchanged by the backend migration), server-side auth with createServerSDK now forwarding JWT to the FastAPI backend, and permission checking in plugins by decoding the JWT's flat `permissions`/`scopes` claim (client-side contract unchanged; server-side implementation notes updated for FastAPI).

#### Domain Clock (`standards/backend/time.md`)
Europe/Warsaw domain clock: `Term.occurs_on` is naive Warsaw wall-clock while audit timestamps (`created_at`, `updated_at`, `read_at`, `withdrawn_at`, `deleted_at`, markers) stay naive UTC via `datetime.utcnow()`; read "now" only via `from app.core import clock` + `clock.local_now()` (never `datetime.now()`/`date.today()`, module-attribute call so it can be patched; enforced by `tests/test_domain_clock_guard.py` for `app/groups/application` and `app/groups/router`); `tzdata` as a runtime dependency with fail-fast `clock.check_timezone()` first in the lifespan and `uv.lock` shipped with dependency changes; opt-in `freeze_local_now` fixture from `tests/conftest.py` (no freezegun/time-machine, Term times built from `clock.local_now()`); user-facing dates via `clock.format_term_day`/`clock.format_term_when` and notification text capped with `clock.fit_notification_message` (500 chars).

### Frontend Standards

Located in `.maister/docs/standards/frontend/`

#### CSS (`standards/frontend/css.md`)
Consistent methodology (Tailwind/BEM/modules), work with the framework, design tokens, minimize custom CSS, and production optimization.

#### Components (`standards/frontend/components.md`)
Single responsibility, reusability with configurable props, composability, clear interfaces, encapsulation, consistent naming, local state kept close to use, minimal props, usage documentation, and pages with several screens deriving one discriminated view state in a pure `resolve…View()` (in a separate `*ViewState.ts`, table-tested with `it.each` including stale/refresh-error rows) that the page only `switch`es over on `view.kind` (no scattered JSX `if`s, no re-derivation in children, `Extract<…>` sub-unions for multi-state views), with state-bound flows (URL params, storage, mutations) in a dedicated hook taking `view.kind` (`pages/term/termViewState.ts`, `pages/term/hooks/useJoinCodeLink.ts`).

#### Accessibility (`standards/frontend/accessibility.md`)
Semantic HTML, keyboard navigation, color contrast (4.5:1), alt text and labels, screen reader testing, ARIA when needed, heading structure, focus management, modal sheets/blocking dialogs (`aria-modal` sheets trap Tab/Shift+Tab via `components/shared/trapFocus.ts`, Esc handled on the dialog element ignoring `defaultPrevented` events, focus returned to the opener with `main[tabindex=-1]` fallback, prefer shared `components/shared/ModalSheet`), picker sheets inside forms (`createPortal(…, document.body)` wrapped in a span stopping `onClick`/`onKeyDown` propagation, every inner button `type="button"` incl. the ModalSheet ✕, Enter in search always `preventDefault()`, trigger `<button type="button">` with `aria-labelledby` on a visible `<span id>`, never inside `<label>`; `components/shared/CategoryTreePicker.tsx`), blocked-by-input actions using `aria-disabled="true"` + `aria-describedby` hint with a handler guard (native `disabled` only while busy; `pages/add/ItemCreateView.tsx`), editable trees as nested lists with `aria-expanded` disclosure buttons and `aria-hidden` ▸/▾ instead of `role="tree"` (`pages/admin/CategoryListPage.tsx`), registering every blocking dialog with `useRegisterOpenSheet(open)` from `components/shared/openSheets.ts` so `PendingActionsHost` waits (its own sheet passes `registerAsPageSheet={false}`), inline comboboxes inside sheets (Esc with the listbox open closes only the listbox via `preventDefault()` + `stopPropagation()`, `aria-controls` only while open, `aria-activedescendant`, ArrowUp/Down + Enter; `components/shared/LocationAddForm.tsx`), and spacing around `sr-only` text (separator as `{" "}` outside the hidden span, never a leading space inside it).

#### Responsive Design (`standards/frontend/responsive.md`)
Mobile-first approach, standard breakpoints, fluid layouts, relative units (rem/em), and cross-device testing.

#### Data Fetching & Dates (`standards/frontend/data-fetching.md`)
TanStack Query v5 hooks in `src/hooks/` wrapping `src/api/*.ts` (no `useState`+`useEffect` fetching, no ad hoc `useQuery` in components), one shared `queryClient` in `src/api/queryClient.ts` (no retry on `ApiError` 4xx, up to 2 retries on network/5xx), array query keys with a resource-name prefix constant followed by params, mutations that `await invalidateQueries` on the whole resource prefix and pass `extractProblemMessage` errors through verbatim, app-shaped hook returns (`data` with a stable module-level empty fallback, `loading = isPending`, `error: string | null`, `refetch(): Promise<void>`), keeping values such as the auth token out of the key when shown data must survive their change (`useTermAccess` `forToken`/`isStale` pattern), passing a host hook's mutation callbacks (`create`/`update`/`remove`) down as props instead of re-subscribing in a child (a second `staleTime: 0` subscriber refetches on every mount; `LocationAddForm`'s `create` prop), the documented `staleTime` exception for `useCategories` (5 min for the ~2300-node tree, so every category/product-count write awaits invalidation of the categories prefix: `useCategories` create/update/remove/move, `useProducts` invalidate, admin `ProductFormPage` after save), and dates via `dayjs` imported from `src/utils/dayjs.ts` (Polish `pl` locale; never import `"dayjs"` directly; `src/utils/format.ts` is legacy).

### Testing Standards

Located in `.maister/docs/standards/testing/`

#### Backend Testing (`standards/testing/backend-testing.md`)
pytest + pytest-asyncio (auto mode, session event loop) against a real PostgreSQL 18 via `testcontainers` (Docker required, `alembic upgrade head` once per session); the `db_session` fixture (outer transaction + savepoints, rolled back after each test) and `client` fixture (httpx `AsyncClient` over `ASGITransport` with `get_db`/`get_storage` overridden); integration-first HTTP testing, seeding via service functions or SQL plus `await db_session.commit()` when no endpoint exists; per-file `_register`/`_auth` and `_create_*` helpers; `count_queries(engine)` asserting query count does not grow with row count; exact key-set assertions for response shapes (update, never loosen); categories only via `tests.conftest.leaf_category_ids(client, headers, n)` called per test (never cached at module/session scope, never `categories[0]` or by name); dates from `clock.local_now()`/`freeze_local_now`; flat `tests/test_<feature>.py` placement and `test_<operation>_<scenario>_<expected>` camelCase naming; 2–8 tests per feature; commands via `uv run python -m pytest|mypy|ruff` from `src/backend`.

#### Frontend Testing (`standards/testing/frontend-testing.md`)
Vitest with globals and jsdom environment, explicit `import { describe, expect, it, vi } from "vitest"` in test files (because `tsc -p tsconfig.app.json` type-checks `src/test` without Vitest global types), @testing-library/react for component rendering and queries, @testing-library/jest-dom for extended DOM matchers, per-file renderWithProviders() helper wrapping ChakraProvider and MemoryRouter, React Query test wrapper from src/test/queryClient.tsx (createQueryWrapper() passed via render/renderHook `wrapper` option, fresh QueryClient per test with retry: false, createTestQueryClient()/withQueryClient()), microtask notifyManager scheduler in src/test/setup.ts so query notifications flush inside act(), API module mocking with vi.mock() factory functions and vi.resetAllMocks() in beforeEach, vi.mocked() for type-safe mock configuration, pinning the clock for date-dependent UI (`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime()`, restored with `vi.useRealTimers()` in afterEach, faking only Date so `findBy*` keeps working, fixture dates whose weekday matches assertions), fully typed fixture factories with no `as <ResponseType>` casts so `tsc` catches DTO drift (a cast hid a missing `listing_status` in `OrganizerItemRoute.test.tsx`), describe blocks named after pages/features, and test files in src/test/ directory.

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
