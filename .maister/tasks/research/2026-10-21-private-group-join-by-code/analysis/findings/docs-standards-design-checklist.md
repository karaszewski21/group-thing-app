# Docs & Standards: rules a "join private group by code" design must satisfy

**Category**: `docs-standards` (Gathering Strategy row 3)
**Sources read**: `.maister/docs/project/{architecture,tech-stack}.md`; `.maister/docs/standards/backend/{models,migrations,security,time,api,queries}.md`; `standards/global/{validation,error-handling,minimal-implementation,conventions}.md`; `standards/frontend/{data-fetching,accessibility,components,css}.md`; `standards/testing/{backend-testing,frontend-testing}.md`; plus the code the standards point at for envelope/retry facts (`src/backend/app/core/errors.py`, `src/frontend/src/api/{queryClient,problem}.ts`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_domain_clock_guard.py`).
**Secrets rule**: no `.env` value was read or printed; `.env.example` referenced by key names only (see `docs-standards-config-inventory.md`).

Confidence legend: High = rule quoted verbatim from a standard; Medium = derived from a standard plus the code it references.

---

## A. Data model (where the code lives)

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| A1 | Prefer a plain column on an existing table over a new mapped class: "Prefer plain columns (string, enum) over separate mapped classes when possible ... Only create a dedicated mapped class when you need identity, lifecycle, or complex relationships." A per-group static code is a candidate for `groups.join_code` (+ optional `join_code_rotated_at`/`join_code_expires_at`); a per-invite token with its own lifecycle (uses, revocation) would justify a table. | `standards/backend/models.md` §Design Principles › Model Simplicity (l.7–23) | High |
| A2 | If a new table is created it must extend `BaseEntity` (UUID `id` with `uuid4` default + `gen_random_uuid()` server default, `created_at`, `updated_at` as `version_id_col`). No `BigInteger`/`Sequence`/`IDENTITY` PKs. | `models.md` §BaseEntity Pattern (l.60–85), §Primary Keys (l.88–91) | High |
| A3 | Never set `updated_at` by hand; the version generator writes it on every flush. Consequence: regenerating a code bumps `updated_at` → a concurrent stale PATCH on the group gets `StaleDataError` → 409 "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie". | `models.md` l.79–83; `app/core/errors.py` `stale_data_error_handler` (l.101–108) | High |
| A4 | Groups BC declares **no `relationship()`**, even between its own tables; related rows load via batched `IN` lookups returning `dict[id,row]`; list endpoint query count must not grow with rows (`count_queries`). A join-code lookup therefore is a plain `select(Group).where(Group.join_code == ..., Group.deleted_at.is_(None))`, not a relationship walk. | `models.md` §Groups Bounded Context Has No relationship() (l.133–136) | High |
| A5 | Fixed-length codes use `String(length=N)`; enums as `enum.StrEnum` stored as `String` (e.g. if a code status/visibility enum is added). | `models.md` §Data Types (l.37–40), §Enumerations (l.94–97) | High |
| A6 | Soft delete: every list/lookup query adds `.where(Model.deleted_at.is_(None))` explicitly; a soft-deleted Circle is nonexistent to every caller (404 via `repository.get_group`). Uniqueness among live rows uses a partial unique index `... AND deleted_at IS NULL`. ⇒ a global-unique `join_code` must be a partial unique index `uq_groups_join_code` with `postgresql_where=sa.text("join_code IS NOT NULL AND deleted_at IS NULL")`, and redeeming a code on a soft-deleted group must 404. | `models.md` §Soft Delete Pattern (l.175–183); `migrations.md` §Partial Unique Indexes (l.29–37) | High |
| A7 | Cross-context data (party/user for the joining member) goes through the existing `infrastructure/*_acl.py` modules only; the ACL must not import `..schemas`; it reuses the owner BC's 404-before-403 check. | `models.md` §Cross-Context Access Through an ACL Module (l.141–158); `architecture.md` §Locations › Boundary (l.137) | High |
| A8 | Entity identity via business key for `__eq__`/`__hash__`, never surrogate `id`. | `models.md` §Entity Identity (l.162–167) | High |
| A9 | Data integrity enforced at DB level (`nullable=False`, unique/FK constraints) and declared in the Alembic migration, not inferred from the ORM. | `models.md` §Data Integrity (l.33–35) | High |
| A10 | Index columns used in WHERE (`join_code` is looked up by value) via explicit `op.create_index` in the owning migration; don't over-index. | `models.md` §Indexes (l.41–44); `queries.md` §Index Strategic Columns (l.12–13) | High |
| A11 | Hashing option: if the code is stored hashed, the only existing hashing precedent is bcrypt for passwords (`String(72)` column); for a short lookup code a deterministic hash (`hashlib`/`hmac`, stdlib) would be needed because bcrypt hashes are not lookup-able — a trade-off the synthesizer must decide (no standard forbids plaintext storage of a low-value code; `security.md` only governs passwords/JWT). | `security.md` §Password Storage (l.53–55) | Medium |

## B. Migration (new revision + drop of the old mechanism)

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| B1 | File `alembic/versions/NNNN_short_description.py`, sequential 4-digit id, `down_revision` = previous (current head is `0058`, so new revisions are `0059+`). | `migrations.md` §Naming Convention (l.26–27); `sources.md` l.42 | High |
| B2 | Every constraint/index explicitly named: `pk_<table>`, `fk_<table>_<column>_<referenced_table>`, `ix_<table>_<col(s)>`, `uq_<table>_<col(s)>`. | `migrations.md` l.27 | High |
| B3 | One logical change per revision; **additive nullable columns on an existing table (`groups.join_code*`) go in their own revision, separate from any new table**, with no backfill (existing rows get NULL — i.e. existing PRIVATE groups have no code until the organizer generates one, unless a separate data migration backfills). Module docstring says "Schema only" and what the columns mean. | `migrations.md` §Small and Focused (l.14–15), §Additive Nullable Columns (l.39–40) | High |
| B4 | Schema and data migrations in separate revisions (so "backfill a code for every PRIVATE group" or "mark PENDING requests" must be its own revision, not mixed with `add_column`/`drop_table`). | `migrations.md` §Separate Schema and Data (l.45–46) | High |
| B5 | Reversible: `downgrade()` undoes only its own revision in strict reverse order (FKs before columns, indexes before table). For the removal: the revision dropping `notifications.join_request_id` (FK, from 0038) must drop before the one dropping `group_join_requests` (0037) — or, if a single "drop join requests" revision is used, drop the FK column first, then the indexes, then the table, and `downgrade()` recreates table → indexes → FK column. Verify `alembic downgrade base` leaves a clean DB. | `migrations.md` §Reversible (l.8–9); research-plan Phase 4 l.98 | High |
| B6 | **A pytest per revision** (`tests/test_<feature>_migration.py`): downgrade to previous revision, assert tables/columns/named FKs/indexes gone via `sqlalchemy.inspect` in `conn.run_sync`, upgrade head in `finally`, `await engine.dispose()` after each subprocess step; name like `test_migration_downgradeTo0058AndUpgradeHead_succeeds`. Templates: `tests/test_group_soft_delete_migration.py`, `tests/test_locations_migration.py`. | `migrations.md` §Migration Test for Every Revision (l.11–12) | High |
| B7 | Zero-downtime ordering: additive changes (new nullable columns) before destructive ones (drop `group_join_requests`); `architecture.md` records 0048 as a non-zero-downtime precedent and its rollback procedure, so a destructive drop should state its rollback path. | `migrations.md` §Zero-Downtime Awareness (l.42–43); `architecture.md` l.117 | High |
| B8 | Never edit an applied migration (0037/0038 stay; write new drop revisions). | `migrations.md` §Version Control (l.51–52) | High |
| B9 | Production indexes with real volume use `postgresql_concurrently=True` "once this project has real production data volumes" — not required now. | `migrations.md` §Careful Indexing (l.48–49) | High |

## C. Authorization matrix and endpoints

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| C1 | For every new route: (1) add the row to `AUTHORIZATION_MATRIX` **first, in the correct first-match position**, (2) declare the matching `Depends(require_any(...))` (none for PUBLIC), (3) add a `resolve_requirement` case to `tests/test_authorization_matrix.py` plus regression cases for rows it is placed ahead of. | `security.md` §The Authorization Matrix Is Code (l.25–33) | High |
| C2 | Placement precedent to copy: the join-request row `POST ^/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?$ → "AUTHENTICATED"` sits ahead of row 27's blanket `POST ^/api/groups(/.*)?$ → EDIT`; a new `POST /api/groups/public/{id}/join` (redeem code) row must take the same slot or row 27 would demand EDIT. Organizer code endpoints (`GET/POST /api/groups/{id}/join-code`, regenerate) fall under row 26 (`GET … READ`) / row 27 (`POST … EDIT`) unless a specific row is added; the ownership check (active organizer) lives in the service, not the matrix. | `app/core/authorization_matrix.py` l.107–118, 134–135 and comments; `security.md` l.35 (public organizer directory example) | High |
| C3 | Public rows need no dependency at all; `/api/groups/public/{id}` and `/access` are PUBLIC and must stay so ("an unauthenticated caller just gets all-False access flags, never a 401/403"). The join-request row deliberately uses zero-arg `require_any()` ("account-backed principal") — redeeming a code should be the same: AUTHENTICATED, no permission. | `security.md` §Public Routes Need No Dependency (l.37–39); matrix comments l.94–100, 107–112 | High |
| C4 | Row ambiguity resolves toward the more specific rule, documented inline at the row. | `security.md` §Row-Order Ambiguity (l.41–43) | High |
| C5 | REST shape: resource-based URLs, plural nouns, ≤2–3 nesting levels, lowercase hyphenated names, proper status codes. `/api/groups/public/{id}/join-requests` (3 levels after `/api`) is the existing precedent for depth. | `api.md` l.3–22 | High |
| C6 | `api.md` asks for rate-limit information in response headers ("Include rate limit information in response headers") — if a 429 path is added, send e.g. `Retry-After`. No implementation exists today (see inventory). | `api.md` §Rate Limit Headers (l.24–25) | High |
| C7 | JWT: decode once per request via `get_current_principal`; login token claims `sub/permissions/iat/exp`; don't re-decode in the route. | `security.md` §JWT, §Token Claims (l.49–59) | High |

## D. Error envelopes (what the frontend will receive)

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| D1 | All errors use the legacy flat envelope `{status, error, message, fieldErrors, timestamp}` (field order significant; `fieldErrors` is JSON `null` unless validation). | `app/core/errors.py` `ErrorResponse` (l.22–35); `security.md` §Error Responses for Auth Failures (l.45–47) | High |
| D2 | 401 `AuthenticationRequiredException` ("Authentication required") and 403 `AccessDeniedException` (fixed message "Access denied") are raised by `require_any` before the route body; the route body never checks permissions itself. Service-level ownership failures also raise `AccessDeniedException` → 403 with the generic message (so a Polish explanation must come from the frontend: `ACCESS_DENIED_MESSAGE` in `problem.ts`). | `security.md` l.47; `errors.py` l.53–56, 121–122; `src/frontend/src/api/problem.ts` l.59–60, 67–79 | High |
| D3 | 404 = `EntityNotFoundException(entity_type, id)` with fixed English message `"{entity_type} with id {id} not found"` — not customisable. ⇒ "wrong code" must NOT be a 404-by-id message if the UI needs a Polish text; use 400/409 with a Polish `message` (see D4/D5), or map 404 to a fixed Polish string in the frontend. | `errors.py` l.38–45, 86–87 | High |
| D4 | 409 = `BusinessConflictException(message)` subclasses with their own (Polish) message, e.g. "Termin już się odbył"; the frontend's `serverMessageOr` passes a 400/409/503 `message` verbatim when there are no `fieldErrors`. Suitable for "already a member", "code expired/rotated". | `errors.py` l.48–50, 90–93; `time.md` example l.11–16; `problem.ts` l.62–79 | High |
| D5 | 400 = `RequestValidationError` → "Validation failed" + `fieldErrors` (Pydantic constraints like `Field(min_length, max_length, pattern)`), or any `ValueError` raised in the route/service → 400 with `str(exc)` as message (precedent: `TextModerationRejected`). Generic "Validation failed" must never reach the user — frontend substitutes a Polish fallback. | `errors.py` l.58–59, 111–118, 131–132; `problem.ts` l.62–66 | High |
| D6 | **No 429 handler or exception exists**; adding rate limiting means adding a typed exception + handler in `errors.py` and registering it in `register_exception_handlers` (most-specific first), consistent with "Typed Exceptions" and "Centralized Handling". | `errors.py` l.144–162; `global/error-handling.md` §Typed Exceptions, §Centralized Handling (l.9–13) | High |
| D7 | User messages must be actionable "without exposing internal details or security-sensitive information" — the wrong-code message must not reveal whether a group exists / whether the code is merely expired vs never existed, if enumeration resistance is wanted. | `global/error-handling.md` §Clear User Messages (l.3–4) | High |
| D8 | IntegrityError (e.g. duplicate membership on a unique index) is mapped globally to 409 "Data integrity violation" (English) — so a race on double-join should be handled explicitly (idempotent return) rather than relying on the generic envelope. | `errors.py` l.96–98 | Medium |
| D9 | Frontend retry policy: TanStack `queryClient` does not retry any `ApiError` with status < 500 — a 429 would **not** be retried automatically (good), but it also would not get a `Retry-After`-aware backoff unless added. | `src/frontend/src/api/queryClient.ts` l.6–11; `data-fetching.md` §One Shared QueryClient (l.7–9) | High |

## E. Clock and expiry

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| E1 | Audit/marker timestamps (`created_at`, `updated_at`, `read_at`, `withdrawn_at`, `deleted_at`, "markers") are **naive UTC via `datetime.utcnow()`**; only `Term.occurs_on` is naive Warsaw wall clock. A `join_code_rotated_at` / `join_code_expires_at` column is an audit-style marker ⇒ naive UTC, and must never be compared against `clock.local_now()` (Warsaw). | `time.md` §Term Times Are Naive Warsaw Wall Clock (l.3–5) | High |
| E2 | Inside `app/groups/application` and `app/groups/router`, `datetime.now(` and `date.today(` are **forbidden** (guard test `tests/test_domain_clock_guard.py`, `_FORBIDDEN = ("datetime.now(", "date.today(")`); `datetime.utcnow()` is allowed (used for audit columns). "Now" for Term logic is `from app.core import clock; clock.local_now()` as a module-attribute call so `freeze_local_now` can patch it. | `time.md` §Read "Now" Only Through app.core.clock (l.7–16); `tests/test_domain_clock_guard.py` l.26–33 | High |
| E3 | If an expiry is user-facing (e.g. "kod ważny do ..."), format with `clock.format_term_day`/`format_term_when` only for Warsaw wall-clock values; a UTC marker would first need `clock.utc_to_local(naive_utc)` (exists in `app/core/clock.py` l.37). Frontend formats dates with `dayjs` from `src/utils/dayjs.ts` (Polish locale), never `"dayjs"` directly. | `time.md` §User-Facing Dates (l.26–28); `app/core/clock.py` l.37; `data-fetching.md` §Dates with dayjs (l.45–52) | High |
| E4 | Tests pin time with the opt-in `freeze_local_now` fixture (no freezegun/time-machine); frontend date-dependent tests use `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`. Note `freeze_local_now` patches `clock.local_now`, not `datetime.utcnow` — a UTC-based expiry check is not frozen by it (design consequence: either express expiry via `clock` or seed `expires_at` relative to real UTC in tests). | `time.md` §Freeze Time (l.22–24); `backend-testing.md` §Dates in Tests (l.46–47); `frontend-testing.md` §Pin the Clock (l.78–88) | Medium |
| E5 | `tzdata` is already a runtime dependency; ship `uv.lock` with any dependency change. | `time.md` §tzdata (l.18–20); `pyproject.toml` l.22 | High |
| E6 | Notification text (if a "ktoś dołączył" notification is kept) is capped with `clock.fit_notification_message` (500 chars). | `time.md` l.28 | High |

## F. Validation of the code input

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| F1 | Server-side validation always; client-side only for feedback; validate early; allowlists over blocklists ⇒ Pydantic `Field(pattern=r"^[A-Z0-9]{N}$")` (allowlisted alphabet) on the request model, normalised (upper-case, strip separators) before matching. | `global/validation.md` §Server-Side Always, §Validate Early, §Allowlists Over Blocklists, §Type and Format Checks (l.3–19) | High |
| F2 | Frontend constrained-text input pattern (the only concrete input standard): `type="text"` with `inputMode`/`pattern`, raw string kept in state, one shared parser returning `null` (blank) / value (valid) / `undefined` (invalid), inline Polish `role="alert"` error wired with `aria-invalid`/`aria-describedby`, submit disabled while invalid, server still validates. Reference `pages/panel/panelHelpers.ts` (`parseCapacity`), `pages/panel/panelComponents.tsx` (`CapacityField`). A `parseJoinCode` helper should mirror this shape. | `global/validation.md` §Integer Inputs (l.30–40) | High |
| F3 | Specific, field-level messages ("Podaj liczbę od 1 do 10000" precedent) — Polish, naming the expected format. | `validation.md` §Specific Errors (l.12–13) | High |
| F4 | Consistent enforcement across entry points: the same normalisation/validation applies to the `?code=` deep link and the typed input. | `validation.md` §Consistent Enforcement (l.27–28) | High |
| F5 | Bind every comparison value as a SQLAlchemy parameter (never interpolate the code into SQL text). | `queries.md` §Parameterized Queries (l.3–4) | High |

## G. Frontend hooks, query keys, mutations

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| G1 | All server state via TanStack Query v5 hooks in `src/hooks/` wrapping `src/api/*.ts`; no `useState`+`useEffect` fetching; components never call `useQuery` ad hoc. ⇒ `useJoinCode(groupId)` (organizer) and a `joinByCode` mutation inside `useTermAccess`/`useGroupAccess` or a dedicated hook. | `data-fetching.md` §TanStack Query for Server State (l.3–5) | High |
| G2 | Array query keys: resource-name constant first, then params; existing key `["groupAccess", groupId, termId ?? null]`. New key e.g. `["groupJoinCode", groupId]`. | `data-fetching.md` §Query Keys (l.11–20) | High |
| G3 | Mutations call the api fn, catch → `throw new Error(extractProblemMessage(err))` (verbatim backend message, e.g. 409 shown inline), then `await queryClient.invalidateQueries({ queryKey: PREFIX })` on the whole resource prefix. After a successful join: invalidate `["groupAccess"]` (and group details / memberships prefixes). | `data-fetching.md` §Mutations Invalidate the Resource Prefix (l.22–31) | High |
| G4 | App-shaped hook return: `data` (stable module-level empty fallback), `loading = isPending`, `error: string | null`, `refetch(): Promise<void>`. | `data-fetching.md` §App-Shaped Hook Return (l.33–39) | High |
| G5 | Keep the auth token out of the key where shown data must survive login (`useTermAccess` `forToken`/`isStale`); the join-by-code flow (visitor logs in, then enters code) must keep that pattern. | `data-fetching.md` §Keep Values Out of the Key (l.41–43) | High |
| G6 | Pass a host hook's mutation callbacks (`create`/`update`/`remove`, here `regenerate`/`join`) down as props; a child must not re-subscribe to the same hook (second `staleTime: 0` subscriber refetches on every mount). ⇒ the code-entry sheet receives `join` as a prop from the page that owns `useTermAccess`. | `data-fetching.md` §Pass Mutation Callbacks Down (l.54–59) | High |
| G7 | Components: single responsibility, configurable props, composition, minimal props. | `frontend/components.md` l.3–25 | High |
| G8 | CSS: stick to the project methodology (Tailwind v4 + Chakra v3 per `package.json`), design tokens, minimal custom CSS; existing tests `themeDefects.test.tsx`/`themeTokenUsage.test.tsx` scan component files. | `frontend/css.md`; `sources.md` l.88 | Medium |

## H. Accessibility of a code-entry sheet / organizer code card

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| H1 | Every `aria-modal="true"` sheet traps Tab/Shift+Tab via `components/krag/trapFocus.ts`, closes on Esc handled on the dialog element (ignoring `defaultPrevented`), returns focus to the opener (fallback `main[tabindex=-1]`); **prefer the shared `components/krag/ModalSheet`** (props: `title`, `ariaLabel?`, `onClose`, `registerAsPageSheet?`, `children`). | `accessibility.md` §Modal Sheets and Blocking Dialogs (l.27–28); `ModalSheet.tsx` l.23–27 | High |
| H2 | Every blocking dialog calls `useRegisterOpenSheet(open)` from `components/shared/openSheets.ts` so `PendingActionsHost` waits. If `PendingActionsHost` is removed with join requests, this rule's rationale disappears but the registry is also used by `ModalSheet` (`registerAsPageSheet`) — check whether other consumers remain before deleting `openSheets.ts` (codebase-frontend gatherer scope). | `accessibility.md` §Register Blocking Dialogs (l.30–31) | High |
| H3 | Inline error pattern: `role="alert"` + `aria-invalid` + `aria-describedby` on the input, label for the input, keyboard-operable submit, 4.5:1 contrast, no colour-only signalling. | `accessibility.md` §Alt Text and Labels, §Keyboard Navigation, §Color Contrast (l.6–13); `validation.md` l.31 | High |
| H4 | `sr-only` spacing: separator `{" "}` outside the hidden span; decorative glyphs in `aria-hidden="true"` (relevant for a "Kopiuj kod" button with icon, or "(nowa karta)" links). | `accessibility.md` §Spacing Around Visually Hidden Text (l.43–48) | High |
| H5 | Heading order and focus management in dynamic content (after a successful join, move focus to the revealed content/heading). | `accessibility.md` §Heading Structure, §Focus Management (l.21–25) | High |
| H6 | The combobox-in-sheet Esc rule is not needed for a plain code field, but shows the convention: nested widgets own their Esc via `preventDefault()`+`stopPropagation()`. | `accessibility.md` §Inline Combobox Inside a Sheet (l.33–41) | High |

## I. Tests

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| I1 | Backend: pytest + pytest-asyncio auto mode, real PostgreSQL 18 via testcontainers (Docker required), `alembic upgrade head` once per session; never mock the DB; `db_session` (savepoint rollback) and `client` (httpx `ASGITransport`, `get_db`/`get_storage` overridden). | `backend-testing.md` §Integration Test Infrastructure, §Core Fixtures (l.5–11) | High |
| I2 | Integration-first via HTTP: assert status + JSON, include `response.text` in status asserts; seed via service functions/SQL + `await db_session.commit()` when no endpoint exists (e.g. forcing an expired code or a soft-deleted group). | `backend-testing.md` §Integration-First via HTTP (l.13–18) | High |
| I3 | Per-file private helpers `_register(client, email)`, `_auth(token)`, `_create_circle`, …; unique email per test. | `backend-testing.md` §Per-File Auth Helpers (l.20–25) | High |
| I4 | `count_queries(engine)` assertion when a list endpoint is touched (e.g. organizer panel listing groups with codes). | `backend-testing.md` §Query-Count Assertions (l.27–36) | High |
| I5 | Exact key-set assertions on public/narrow shapes: the PUBLIC `/api/groups/public/{id}` and `/access` responses must assert the code is **absent** (`for hidden in ("join_code",): assert hidden not in body`) and the organizer response asserts the exact key set. | `backend-testing.md` §Exact Response Shapes (l.38–44) | High |
| I6 | Naming/placement: flat `tests/test_<feature>.py` (e.g. `test_group_join_code.py`, `test_group_join_code_migration.py`), functions `test_<operation>_<scenario>_<expected>` in camelCase segments (`test_joinByCode_validCode_returns200AndCreatesMembership`), module docstring first, `# noqa: E501` for long names. | `backend-testing.md` §Test Naming and Placement (l.49–50) | High |
| I7 | Scope: **2–8 focused tests per feature** (happy path + validation errors + 404-before-403 + soft-deleted references + idempotency), prefer one scenario-test over many tiny ones. | `backend-testing.md` §Test Scope (l.52–53) | High |
| I8 | Commands from `src/backend`: `uv run python -m pytest tests/<file>.py -q`, `uv run python -m mypy app`, `uv run python -m ruff check`. | `backend-testing.md` §Commands (l.55–61) | High |
| I9 | Frontend: Vitest + jsdom, explicit `import { describe, expect, it, vi } from "vitest"`, per-file `renderWithProviders()` (ChakraProvider + MemoryRouter + `wrapper: createQueryWrapper()`), API modules mocked with `vi.mock()` factories and `vi.resetAllMocks()` in `beforeEach`, `vi.mocked()` typing, describe blocks named after the page/feature, files in `src/test/`. | `frontend-testing.md` l.3–92 | High |
| I10 | Auth-matrix test: add `resolve_requirement` cases for each new row and regression cases for rows the new one precedes. | `security.md` l.31 | High |

## J. Scope discipline

| # | Rule | Citation | Conf. |
|---|------|----------|-------|
| J1 | Build only what is called; no future stubs ("max uses", "per-invite links", "expiry" only if the product actually asks for them); delete exploration artifacts; unused code is debt ⇒ the old join-request code must be deleted, not left behind feature-flagged. | `global/minimal-implementation.md` l.3–22 | High |
| J2 | Minimal dependencies — document why a major one is added (relevant to any rate-limit library). | `global/conventions.md` §Minimal Dependencies (l.15–16) | High |
| J3 | Configuration in env vars, never commit secrets; `.env.example` with placeholders only. | `conventions.md` §Environment Variables (l.12–13); `CLAUDE.md` §Secrets | High |
| J4 | Feature flags for incomplete features instead of long-lived branches (if the cutover must be staged). | `conventions.md` §Feature Flags (l.24–25) | High |
| J5 | Graceful degradation / retry with backoff only for external services — not applicable to the join flow (no external call). | `global/error-handling.md` l.15–19 | High |

## K. Gaps and inconsistencies in the docs themselves

- `architecture.md` l.29–33 and `tech-stack.md` l.45–47 still say "one migration exists" and "no automated pytest suite exists yet"; both are stale (58 migrations and a full `tests/` suite exist, as `backend-testing.md`/`migrations.md` dated 2026-10-20 confirm). Rely on the standards, not the project docs, for test/migration facts.
- `architecture.md`'s Package Structure (l.160–204) predates `app/groups`, `app/notifications`, `app/moderation`, `app/storage`; the groups-BC rules live only in `models.md`.
- `api.md` §Rate Limit Headers is the only mention of rate limiting anywhere in the standards; there is no standard on rate limiting, brute-force throttling, or 429 shape — a design decision the external gatherer/synthesizer must supply.
- No standard addresses secret/code generation; the only precedent is `secrets.token_urlsafe(32)` in `app/oauth2/stores.py` (l.59–61, l.132).
- No standard addresses "consume `?code=` from URL / strip from history" — frontend hygiene must come from external sources.
