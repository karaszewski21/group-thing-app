# Implementation Plan: Events plugin (wydarzenia) at /add/event

## TL;DR
- 11 task groups (10 implementation + Test Review), 67 steps, 29 new automated tests (+ up to 10 in Group 11): 3 backend groups (migration → create API → banner API), 3 host frontend groups (plugin infrastructure, SDK, `EventCreateView`), 3 `plugins/events` groups (scaffold+domain → form+location sheet → save flow), 1 docs group, and a final Test Review & Gap Analysis group.
- Two independent chains start in parallel: backend (1 → 2 → 3) and host frontend (4 → 6, 5 → 7 → 8 → 9; 5 → 10). Test Review (11) waits for all.
- Every UI group carries binding `Visual References`; `visual-coverage.md` maps all 9 screens and 2 components from `analysis/design-context/INDEX.md`.
- The plugin has no unit-test infrastructure (spec Out of Scope); its groups use `tsc -b` / `npm run build` plus a Copy-table parity checklist as their gate.

## Key Decisions
- **Backend split into three groups (schema, create, banner)** — keeps each test file within 2–8 tests (migration 2, `test_events.py` 8, `test_event_banners.py` 5) and lets the banner service build on a merged create service.
- **Both `AUTHORIZATION_MATRIX` rows land in Group 2** — one edit to the shared matrix file; the banner route in Group 3 only adds the endpoint. The matrix and clock-guard test edits extend existing parametrised/guard tests rather than adding new test functions.
- **Host plugin infrastructure (Group 4) and SDK (Group 5) are separate groups** — they touch disjoint files (`src/plugins/*` + `hooks/usePlugins.ts` vs `src/plugin-sdk/*` + `plugins/sdk.ts` + `package.json`) and split the 9 frontend plugin tests into 7 + 2.
- **`build:sdk` copy is an inline `node -e "fs.copyFileSync(...)"`** in `package.json`, not a new script file — the spec only asks for a cross-platform Node copy (minimal-implementation).
- **Plugin `main.tsx` belongs to Group 8, not the scaffold group** — Group 7 is gated by `npx tsc -b` (type-check of `domain.ts`), so no placeholder page is created; the first full `npm run build` runs in Group 8.
- **Plugin groups substitute a verification checklist for unit tests** — the spec rules out plugin test infrastructure; N.1 in each plugin group writes the checklist (Copy-table keys, aria attributes, mockup acceptance) that N.n checks after `npm run build`.
- **`EventCreatePage.tsx` is declared in both Group 8 and Group 9** so the executor serialises them (Group 9 adds the save-flow state machine to the same page).
- **Requirement 22 needs no step** — `analysis/requirements.md` already records `event_attendances` (line 10); Group 10 only confirms it.

## Open Questions / Risks
- **Iframe height offset** (`calc(100dvh - …)`) must be tuned against the PhoneFrame chrome in Group 6 so the panel does not double-scroll; jsdom tests cannot catch it.
- **Plugin behaviour is untested by automation** — Copy-table parity and mockup fidelity rely on the workflow's e2e/visual verification phase, which needs the backend (Groups 1–3), `npm run build:sdk`, port 3004 and a manual plugin registration.
- **ruff/mypy baseline** — mypy HEAD baseline is ~32 (see memory note); Group 11 compares against it rather than expecting zero.
- **Message duplication** — Polish copy lives in both `app/events/service.py` and `plugins/events/src/domain.ts`; Group 11 diffs them by hand against the Copy table.

## Overview
Total Steps: 67
Task Groups: 11 (10 implementation + Test Review & Gap Analysis)
Expected Tests: 2 + 8 + 5 (backend new) + 7 + 2 + 5 (frontend new) = 29, plus 2 extended existing backend tests; up to 10 more in Group 11 → ~31–41 feature tests

Commands:
- Backend (from `src/backend`): `uv run python -m pytest <files>`, `uv run python -m mypy app`, `uv run python -m ruff check app tests`
- Frontend (from `src/frontend`): `npx vitest run <files>` (`npm test` = `vitest run`), `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`, `npm run build:sdk`
- Plugin (from `plugins/events`): `npm install`, `npm run build` (`tsc -b && vite build`)

Secrets rule applies to every group: never print secret values (no `env`, `printenv`, `cat .env`, `docker inspect` Env); presence checks only; docs and curl use `<admin-token>` placeholders.

## Implementation Steps

### Task Group 1: Database Layer (migration 0070 + models)
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0070_events.py`, `src/backend/app/events/__init__.py`, `src/backend/app/events/models.py`, `src/backend/tests/test_events_migration.py`
**Estimated Steps:** 6

- [x] 1.0 Complete database layer
  - [x] 1.1 Write 2 focused tests in `tests/test_events_migration.py` (pattern: `tests/test_locations_migration.py`)
    - `test_downgrade0069_dropsEventTables_upgradeHeadRestores`: downgrade to `0069` → `events`, `event_banners`, `event_attendances` absent; upgrade `head` → present
    - `test_upgradeHead_eventConstraints_namedAndPartial`: named `pk_*`, `fk_events_author_party_id_parties`, `fk_events_location_id_locations`, `fk_event_banners_event_id_events`, `uq_event_banners_event_id`, `fk_event_attendances_*`, `ix_event_attendances_event_id`, and the `uq_event_attendances_event_id_party_id` predicate `withdrawn_at IS NULL`
  - [x] 1.2 Write `alembic/versions/0070_events.py` (`revision = "0070"`, `down_revision = "0069"`)
    - `events`: `id` UUID `pk_events` `server_default=gen_random_uuid()`, `author_party_id` UUID NOT NULL FK → `parties.id`, `name` VARCHAR(120) NOT NULL, `description` VARCHAR(2000) NULL, `starts_at` TIMESTAMP NOT NULL, `ends_at` TIMESTAMP NULL, `location_id` UUID NULL FK → `locations.id`, `created_at`, `updated_at`
    - `event_banners`: `id` `pk_event_banners`, `event_id` NOT NULL FK + `uq_event_banners_event_id`, `storage_key` VARCHAR(200), `size_bytes` INTEGER, `content_sha256` VARCHAR(64), `status` VARCHAR(20), timestamps
    - `event_attendances`: `id` `pk_event_attendances`, `event_id` FK + `ix_event_attendances_event_id`, `party_id` FK → `parties.id`, `withdrawn_at` TIMESTAMP NULL, timestamps, partial unique `uq_event_attendances_event_id_party_id` `postgresql_where=withdrawn_at IS NULL`; no `child_count`, no `capacity`
    - No other indexes on `events` / `event_banners`
  - [x] 1.3 Write `downgrade()` in reverse dependency order: `event_attendances` indexes → `event_attendances` → `event_banners` → `events`
  - [x] 1.4 Write `app/events/models.py`: `Event`, `EventBanner`, `EventAttendance` on `BaseEntity` (`app/core/base_model.py`)
    - Module-local copy of `_enum_column`; `EventBanner.status` string-backed `ModerationStatus`
    - No `relationship()`; FK-id columns only
    - Business keys: `Event` `(author_party_id, created_at)`, `EventBanner` `storage_key`, `EventAttendance` `(event_id, party_id, created_at)`
    - `EventBanner.large_key` = `f"{storage_key}/w1600.webp"`, `thumb_key` = `f"{storage_key}/w400.webp"`
    - Reuse: `TermAttendance` (`app/groups/models.py:255-281`) shape for `EventAttendance`
  - [x] 1.5 Make sure model metadata matches the migration (column types, nullability, constraint names) by reading both side by side
  - [x] 1.6 Ensure database layer tests pass
    - `uv run python -m pytest tests/test_events_migration.py` from `src/backend` (only these 2 tests)

**Acceptance Criteria:**
- The 2 migration tests pass
- `alembic downgrade 0069` then `upgrade head` runs cleanly
- Models have no `relationship()` and business-key equality on immutable columns only

---

### Task Group 2: Event Creation API (`POST /api/events`)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/core/errors.py`, `src/backend/app/moderation/text_guard.py`, `src/backend/app/events/infrastructure/__init__.py`, `src/backend/app/events/infrastructure/locations_acl.py`, `src/backend/app/events/schemas.py`, `src/backend/app/events/service.py`, `src/backend/app/events/router.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/app/main.py`, `src/backend/tests/test_events.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_domain_clock_guard.py`
**Estimated Steps:** 9

- [x] 2.0 Complete event creation API
  - [x] 2.1 Write 8 focused tests in `tests/test_events.py` (per-file `_register`/`_auth` helpers, `freeze_local_now`, times built from `clock.local_now()`)
    - `test_createEvent_validWithOwnLocation_returns201ExactKeys` — exact keys `{id, name, description, starts_at, ends_at, location, created_at, updated_at}`, blank description → `null`, seconds truncated
    - `test_createEvent_missingOrAwareStart_returns400` — parametrised: start.missing, datetime.aware
    - `test_createEvent_startPastOrTooFar_returns400` — start.past, start.tooFar (now + 730 days)
    - `test_createEvent_endNotAfterStartOrOtherDay_returns400` — parametrised: equal, earlier, 00:00 next day (end.notAfter / end.otherDay)
    - `test_createEvent_nameOrDescriptionOutOfBounds_returns400` — blank, 2 chars, 121 chars, 2001-char description
    - `test_createEvent_foreignOrMissingLocation_returns403Or404`
    - `test_createEvent_rejectedText_returns400` — fake rejecting classifier (pattern: `test_conversation_messages.py`), restored afterwards
    - `test_createEvent_classifierUnavailable_returns503`
  - [x] 2.2 Extend existing tests (no new test functions)
    - `tests/test_authorization_matrix.py`: rows `POST /api/events` and `POST /api/events/{id}/banner` → `("EDIT", "mcp:edit")`
    - `tests/test_domain_clock_guard.py`: add `_APP_ROOT / "events"` to `_GUARDED_DIRS`; rename test to `test_guardedPackages_noHostClockCalls`
  - [x] 2.3 `app/core/errors.py`: add optional `public_message: str | None = None` to `AccessDeniedException`; `access_denied_handler` uses it when set, else "Access denied" (existing 403s unchanged)
  - [x] 2.4 `app/moderation/text_guard.py`: add `TextField.EVENT_NAME` and `TextField.EVENT_DESCRIPTION` with `MESSAGES` from the Copy table
  - [x] 2.5 `app/events/infrastructure/locations_acl.py`: sole importer of `app.locations`; re-export `LocationRefResponse`, `get_owned_location`, `get_location`, `location_ref_response`; never import `..schemas`
    - Reuse: `app/groups/infrastructure/locations_acl.py`
  - [x] 2.6 `app/events/schemas.py`: `CreateEventRequest` (`extra="forbid"`, all fields optional), `EventResponse` (exact 8 keys, `location: LocationRefResponse | None` from the ACL), `EventBannerResponse {url, status}`
  - [x] 2.7 `app/events/service.py`: `EventNotFound(EntityNotFoundException)` ("Nie znaleziono wydarzenia."), `NotEventAuthor(AccessDeniedException)` (`public_message` "Możesz dodać baner tylko do swojego wydarzenia."), copy constants, and `create_event(db, principal, request)`
    - Author = `get_profile_by_principal(...).party_id`
    - Validate in Copy-table order raising `ValueError`: start (missing, aware, truncate to minute, past vs `clock.local_now()` truncated, tooFar `+ timedelta(days=730)`), end (aware, truncate, notAfter, otherDay), name (trim, blank, 3–120), description (trim, blank → None, ≤2000)
    - `location_id` → `locations_acl.get_owned_location` (404 before 403, English server-side)
    - `check_text(EVENT_NAME, name)` then `check_text(EVENT_DESCRIPTION, description)` before insert
    - Insert, commit, load location for the response; `clock.local_now()` via module attribute only
  - [x] 2.8 `app/events/router.py` with `POST /api/events` → 201 (`Depends(require_any("EDIT", "mcp:edit"))`); add both matrix rows before the catch-all in `app/core/authorization_matrix.py`; `app.include_router(events_router)` in `app/main.py`
  - [x] 2.9 Ensure event creation tests pass
    - `uv run python -m pytest tests/test_events.py tests/test_authorization_matrix.py tests/test_domain_clock_guard.py` from `src/backend`

**Acceptance Criteria:**
- The 8 new tests and the extended matrix / clock-guard tests pass
- Every user-facing 400 matches the Copy table text exactly
- Existing 403 responses still read "Access denied"

---

### Task Group 3: Banner Upload API (`POST /api/events/{id}/banner`)
**Dependencies:** 2
**Files to Modify:** `src/backend/app/events/service.py`, `src/backend/app/events/router.py`, `src/backend/app/events/schemas.py`, `src/backend/tests/test_event_banners.py`
**Estimated Steps:** 5

- [x] 3.0 Complete banner upload API
  - [x] 3.1 Write 5 focused tests in `tests/test_event_banners.py` (`fake_storage`, `test_my_profile.py::_png` pattern)
    - `test_uploadBanner_author_returns200StoresPublicFiles` — `{url, status}`, `APPROVED`, two public WebP keys under `events/{event_id}/{banner_id}`
    - `test_uploadBanner_replace_keepsOneRowStagesOutboxDelete` — one `event_banners` row, one `OBJECTS_DELETE` outbox entry with the old keys
    - `test_uploadBanner_nonAuthorOrMissing_returns403Or404Polish`
    - `test_uploadBanner_tooLargeOrNotImage_returns400` — banner.tooLarge, `INVALID_IMAGE_MESSAGE`
    - `test_uploadBanner_storageDisabled_returns409` — "Dodawanie zdjęć jest chwilowo niedostępne"
  - [x] 3.2 Add `EVENT_BANNER_MAX_BYTES = 5 * 1024 * 1024` and `set_event_banner(db, principal, event_id, data, storage)` in `service.py`, in spec order:
    1. `db.get(Event, event_id, with_for_update=True)` → `EventNotFound`
    2. non-author → `NotEventAuthor`
    3. `storage is None` → `BusinessConflictException` with `AVATAR_UPLOAD_DISABLED_MESSAGE` text
    4. `len(data) > EVENT_BANNER_MAX_BYTES` → `ValueError` banner.tooLarge
    5. `images.process_upload` in a thread (invalid → `INVALID_IMAGE_MESSAGE`)
    6. previous banner lookup (serialised by the row lock)
    7. store large + thumb `public=True`, row `status=APPROVED`
    8. previous banner: delete row, flush, `outbox.append` `OBJECTS_DELETE` for its keys
    9. commit; on any failure roll back and delete newly stored files
    - Reuse: avatar flow `app/users/service.py:152-195`
  - [x] 3.3 Add `POST /api/events/{event_id}/banner` in `router.py`: multipart `file`, bounded read of `EVENT_BANNER_MAX_BYTES + 1` bytes, returns 200 `EventBannerResponse` (url = public `w1600` URL)
    - Reuse: `app/users/router.py:84-96`
  - [x] 3.4 Confirm the `FOR UPDATE` lock by reading the code path (not testable under the savepoint fixture); note it for code review
  - [x] 3.5 Ensure banner tests pass
    - `uv run python -m pytest tests/test_event_banners.py` from `src/backend`

**Acceptance Criteria:**
- The 5 banner tests pass
- Error order is 404 → 403 → 409 → 400 (size) → 400 (invalid image)
- A replacement leaves exactly one banner row and stages one outbox delete

---

### Task Group 4: Host Plugin Infrastructure
**Dependencies:** None
**Files to Modify:** `src/frontend/src/plugins/extensionPoints.ts`, `src/frontend/src/plugins/resolveExtensionPoints.ts`, `src/frontend/src/plugins/PluginContext.tsx`, `src/frontend/src/plugins/PluginFilterBar.tsx` (only if it imports the moved type; HEAD shows it does not), `src/frontend/src/plugins/PluginFrame.tsx`, `src/frontend/src/plugins/PluginMessageHandler.ts`, `src/frontend/src/plugins/usePluginMessageHandler.ts`, `src/frontend/src/hooks/usePlugins.ts`, `src/frontend/src/test/plugins.test.tsx`
**Estimated Steps:** 8

- [x] 4.0 Complete host plugin infrastructure
  - [x] 4.1 Write 7 focused tests in `src/test/plugins.test.tsx` (explicit `vitest` imports; MessageEvent `source`/`origin` pattern at lines 156-200)
    - `uploadImage` happy path: FormData field `file`, Bearer, `X-Requested-With: PluginFetch`, no `Content-Type`, `credentials: "omit"`, `{status, headers, body}` response
    - non-allowlisted path (incl. `..`) → error response
    - `it.each`: non-Blob, oversized (> 5 MB), `image/gif` → error response
    - `done` calls `onDone(pluginId, payload)` and posts no response
    - `done` without `onDone` → no response, no throw
    - `PluginFrame` with `add.event` → `#RENDER` prefix
    - `usePluginMessageHandler` removes its listener on unmount
  - [x] 4.2 Add `ADD_EVENT = "add.event"` to `plugins/extensionPoints.ts` (widens `ExtensionPointType`)
  - [x] 4.3 Move `resolveExtensionPoints` + `ResolvedExtensionPoint` from `PluginContext.tsx` into new `plugins/resolveExtensionPoints.ts`; unchanged behaviour (skip disabled, ascending priority); update importers
  - [x] 4.4 `PluginFrame.tsx`: `CONTEXT_TYPE_PREFIX[ADD_EVENT] = "RENDER"`; optional `title` prop (default `Plugin: {name}`)
  - [x] 4.5 `PluginMessageHandler.ts`: `createMessageHandler(iframeRegistry, options?)` with `options.onDone`
    - `done`: fire-and-forget → `options.onDone?.(pluginId, payload)`; ignored without `onDone`
    - `uploadImage {url, file}`: `UPLOAD_IMAGE_RULES` = `[{ pattern: /^\/api\/events\/<uuid>\/banner$/i, maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg","image/png","image/webp"] }]`; reject non-string / `..` / no match / non-Blob / oversize / bad MIME; raw `fetch` POST with FormData, Bearer, `X-Requested-With`, `credentials: "omit"`; safelisted headers like `pluginFetch`
    - Both run after existing prefix/source/origin checks; existing types unchanged
  - [x] 4.6 New `plugins/usePluginMessageHandler.ts`: installs `createMessageHandler` listener once on mount, removes on unmount, latest `options` kept in a ref
  - [x] 4.7 New `hooks/usePlugins.ts`: TanStack hook over `getPlugins()`, key `[PLUGINS_KEY]` with `PLUGINS_KEY = "plugins"`, returns `{ data` (stable module-level empty array), `loading`, `error: string | null`, `refetch }`
  - [x] 4.8 Ensure host plugin tests pass
    - `npx vitest run src/test/plugins.test.tsx src/test/extension-points.test.tsx` from `src/frontend`

**Acceptance Criteria:**
- The 7 new tests pass; existing plugin and extension-point tests still pass
- Admin `PluginProvider` behaviour is unchanged
- `uploadImage` refuses every path, size or MIME outside its single rule

---

### Task Group 5: Plugin SDK & Dev Serving
**Dependencies:** None
**Files to Modify:** `src/frontend/src/plugin-sdk/host-app.ts`, `src/frontend/src/plugin-sdk/this-plugin.ts`, `src/frontend/src/plugin-sdk/types.ts`, `plugins/sdk.ts`, `src/frontend/package.json`, `src/frontend/.gitignore`, `src/frontend/src/test/plugin-sdk.test.ts`
**Estimated Steps:** 6

- [x] 5.0 Complete SDK additions
  - [x] 5.1 Write 2 focused tests in `src/test/plugin-sdk.test.ts`
    - `hostApp.uploadImage(url, file)` posts `uploadImage` with `{url, file}` and resolves the `pluginFetch` shape
    - `thisPlugin.done({name})` sends a fire-and-forget `done` (no pending response)
  - [x] 5.2 `host-app.ts`: `uploadImage(url: string, file: Blob)` via `sendMessageAndWait("uploadImage", { url, file })`; 10 s timeout unchanged
  - [x] 5.3 `this-plugin.ts`: `done(payload?: { name?: string })` via `sendFireAndForget("done", payload ?? {})`; type additions in `types.ts` if the SDK interface lives there
  - [x] 5.4 Mirror both members in `plugins/sdk.ts` (`PluginSDKType`)
  - [x] 5.5 `package.json` `build:sdk` → `vite build -c vite.sdk.config.ts && node -e "require('fs').mkdirSync('public/assets',{recursive:true});require('fs').copyFileSync('dist/assets/plugin-sdk.js','public/assets/plugin-sdk.js')"` (cross-platform; adjust to ESM `import` if `require` is unavailable under `"type": "module"`); add `public/assets/plugin-sdk.js` to `src/frontend/.gitignore`; `build` script unchanged
  - [x] 5.6 Ensure SDK tests pass and the bundle copies
    - `npx vitest run src/test/plugin-sdk.test.ts src/test/plugin-sdk-auth.test.ts`, then `npm run build:sdk` and confirm `public/assets/plugin-sdk.js` exists and is git-ignored (`git check-ignore`)

**Acceptance Criteria:**
- The 2 new SDK tests pass
- `npm run build:sdk` writes both `dist/assets/plugin-sdk.js` and `public/assets/plugin-sdk.js`
- The legacy `src/resources/static/assets/plugin-sdk.js` is untouched

---

### Task Group 6: Host Event Create View
**Dependencies:** 4
**Files to Modify:** `src/frontend/src/pages/add/eventCreateViewState.ts`, `src/frontend/src/pages/add/EventCreateView.tsx`, `src/frontend/src/test/eventCreateViewState.test.ts`, `src/frontend/src/test/AppPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/plugin-niedost-pny.html
  element: screen:event-plugin-unavailable
  locator: phone content, lines 250-260 (host `.sub` header at 252 and the fallback card below it)
  acceptance: `SubPageHeader` "Nowe wydarzenie" with back "Wróć do dodawania" → `/add`; card with `aria-hidden` "🎈", heading "Plugin wydarzeń jest niedostępny", text "Dodawanie wydarzeń jest chwilowo wyłączone. Spróbuj później.", link "Wróć do dodawania"
- mockup: analysis/design-context/mockups/hub-dodawania-z-toastem.html
  element: screen:add-hub-toast
  locator: lines 251-257 (`/add` hub tiles and the `.toast[role=status]` at 257)
  acceptance: after `done`, the user is on the `/add` hub and a host toast reads "Wydarzenie „{name}” zapisane" (trimmed, ≤120 chars; fallback "Wydarzenie zapisane")
- mockup: analysis/design-context/mockups/formularz-nowego-wydarzenia-pusty.html
  element: screen:event-form-empty
  locator: host chrome only, line 252 (`.sub` header) and the `.frame` container at 253
  acceptance: host renders header "Nowe wydarzenie" above an iframe titled "Formularz nowego wydarzenia" with fixed `calc(100dvh - <offset>)` height and `minHeight: 560px`; the panel itself does not scroll
**Estimated Steps:** 6

- [x] 6.0 Complete host event create view
  - [x] 6.1 Write 5 focused tests
    - `src/test/eventCreateViewState.test.ts`: one `it.each` table — loading, fetch error, no plugins, disabled plugin, enabled plugin without `add.event`, ready, lowest priority wins (typed fixtures, no `as` casts)
    - `src/test/AppPage.test.tsx`: replace the "Dodaj › Wydarzenie (mock)" describe; `vi.mock("../api/plugins")`, stub `getPlugins` per test, `createQueryWrapper()`
      - hub link points to `/add/event`
      - enabled `add.event` plugin → iframe "Formularz nowego wydarzenia" under "Nowe wydarzenie"
      - no plugin or disabled plugin → fallback copy and back link
      - `done` MessageEvent (`source` = iframe `contentWindow`, `origin` = `http://localhost:3004`) → `/add` hub + toast "Wydarzenie „Piknik w parku” zapisane"
  - [x] 6.2 New `pages/add/eventCreateViewState.ts`: pure `resolveEventCreateView({ loading, error, plugins })` → `{kind:"loading"} | {kind:"unavailable"} | {kind:"ready", point}` using `resolveExtensionPoints(plugins, ADD_EVENT)[0]`
  - [x] 6.3 Rewrite `EventCreateView.tsx`: always `SubPageHeader title="Nowe wydarzenie" backTo={viewPath("add")} backLabel="Wróć do dodawania"`; `switch (view.kind)`: `loading` → `role="status"` "Wczytywanie…"; `unavailable` → fallback card; `ready` → `PluginFrame` (`pluginId/pluginName/pluginUrl` from point, `contextType={ADD_EVENT}`, `path={point.path ?? "/"}`, `title="Formularz nowego wydarzenia"`, height style)
  - [x] 6.4 Mount `usePluginMessageHandler({ onDone })`: trim + cap name at 120, `showToast` (toast copy), `void queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY] })`, `navigate(viewPath("add"))`
  - [x] 6.5 (done in E2E fix: h-[calc(100dvh-250px)] min-h-[400px] min-[520px]:h-[calc(100dvh-314px)], measured) Tune the iframe height offset against the PhoneFrame chrome (check in `npm run dev` at phone width) so only the iframe scrolls
  - [x] 6.6 Ensure view tests pass
    - `npx vitest run src/test/eventCreateViewState.test.ts src/test/AppPage.test.tsx` from `src/frontend`

**Acceptance Criteria:**
- The 5 tests pass
- Implementation matches each `acceptance` criterion declared above
- The page `switch`es on `view.kind` only; no scattered JSX conditionals

---

### Task Group 7: Events Plugin Scaffold & Domain
**Dependencies:** 5
**Files to Modify:** `plugins/events/package.json`, `plugins/events/package-lock.json`, `plugins/events/vite.config.ts`, `plugins/events/tsconfig.json`, `plugins/events/index.html`, `plugins/events/manifest.json`, `plugins/events/src/vite-env.d.ts`, `plugins/events/src/styles.css`, `plugins/events/src/domain.ts`
**Estimated Steps:** 6

- [x] 7.0 Complete plugin scaffold and domain module
  - [x] 7.1 Write the domain verification checklist (no plugin test infrastructure per spec): one line per Copy-table key used by the plugin (name.*, start.*, end.notAfter, description.length, banner.*, submit.hint, create.*, session, place.*, places.load) with its exact Polish text, plus the three mapper tables (`createEventError`, `bannerError`, `locationError`) — kept in the group's work-log for N.n
  - [x] 7.2 Scaffold from `plugins/warehouse` without its smells: `package.json` (`events-plugin`, `"type": "module"`, same dependency versions, `build: "tsc -b && vite build"`), `vite.config.ts` (port 3004, `strictPort`), `tsconfig.json`, `src/vite-env.d.ts`, `index.html` (`lang="pl"`, loads `http://localhost:5173/assets/plugin-sdk.js`, no `plugin-ui.css`, entry `/src/main.tsx`)
  - [x] 7.3 `manifest.json`: name "Wydarzenia", version "1.0.0", url `http://localhost:3004`, description "Tworzenie jednorazowych wydarzeń", `extensionPoints: [{ "type": "add.event", "label": "Wydarzenie", "path": "/", "priority": 10 }]`
  - [x] 7.4 `src/styles.css`: mirror host tokens from `src/frontend/src/index.css` (`primary`, `primary-soft`, `line`, `paper`, `focus-ring`, radii), system font fallbacks for Bricolage Grotesque / Figtree, no external font loads; inputs `h-12 rounded-2xl` equivalent, 1.5px `line` border, primary pill buttons, `rounded-[28px]` confirmation card class, 16px gutter, `overflow-x: hidden`
  - [x] 7.5 `src/domain.ts` (pure): types `EventDraft`, `EventResponse`, `LocationResponse`, `EventBannerResponse`; `validateDraft(draft, now)`; `validatePlace({name, address})`; `toRequest(draft)` (`YYYY-MM-DDTHH:mm:00`, end uses start date); mappers `createEventError`, `bannerError`, `locationError`; API helpers `createEvent`, `uploadBanner`, `listMyLocations` (`GET /api/locations/mine`), `createLocation` (`POST /api/locations`, `source: "MANUAL"`) over `hostApp.fetch` / `hostApp.uploadImage`; `getSDK()` once, imported from `../../sdk`
  - [x] 7.6 Verify: `npm install` then `npx tsc -b` from `plugins/events` passes; walk the 7.1 checklist against `domain.ts`

**Acceptance Criteria:**
- `npx tsc -b` passes in `plugins/events`
- Every Copy-table string in `domain.ts` matches the spec character for character
- `manifest.json` declares exactly one `add.event` point

---

### Task Group 8: Events Plugin Form & Location Sheet
**Dependencies:** 7
**Files to Modify:** `plugins/events/src/main.tsx`, `plugins/events/src/pages/EventCreatePage.tsx`, `plugins/events/src/components/BannerPicker.tsx`, `plugins/events/src/components/LocationField.tsx`, `plugins/events/src/components/LocationSheet.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/formularz-nowego-wydarzenia-pusty.html
  element: screen:event-form-empty
  locator: `.frame` content, lines 253-266 (lead text, banner drop zone, fields, submit)
  acceptance: lead "Jednorazowe spotkanie, np. piknik, urodziny albo wspólny spacer."; field order Baner (opcjonalnie) → Nazwa → Początek (date + time) → Koniec (opcjonalnie, tego samego dnia) → Lokalizacja (opcjonalnie) → Opis (opcjonalnie, "0 / 2000"); date and time fields blank (mockup prefill is illustrative); "Zapisz wydarzenie" with `aria-disabled="true"` and visible hint "Uzupełnij nazwę oraz datę i godzinę początku, aby zapisać." linked by `aria-describedby`
- mockup: analysis/design-context/mockups/formularz-wype-niony-z-banerem.html
  element: screen:event-form-filled
  locator: `.frame` `.form`, lines 254-267
  acceptance: banner preview with "Zmień"/"Usuń" chips; start as date + time grid; end time in the first grid column; location row showing name (bold) + address and "Zmień ›"; description counter "N / 2000"; submit enabled (no `aria-disabled`)
- mockup: analysis/design-context/mockups/b-dy-walidacji.html
  element: screen:event-form-errors
  locator: `.form`, lines 254-266 (`.input.invalid` fields and their error lines)
  acceptance: after blur (or a click on the blocked submit) inline `role="alert"` errors "Podaj nazwę wydarzenia.", "Początek nie może być w przeszłości.", "Koniec musi być później niż początek."; invalid inputs carry `aria-invalid="true"` and `aria-describedby` to their error
- mockup: analysis/design-context/mockups/wyb-r-lokalizacji.html
  element: screen:event-location-picker
  locator: `.sheet-scrim` / `.sheet[role=dialog]`, lines 266-272
  acceptance: `role="dialog"` `aria-modal="true"` sheet with heading "Lokalizacja" and a ✕ `type="button"` close; my places as rows (name bold, address below, selected row highlighted); dashed "+ Dodaj nowe miejsce" opening an inline form (Nazwa `maxLength=255`, Adres `maxLength=500`, "Dodaj miejsce" with the `aria-disabled` pattern); ghost "Bez lokalizacji"; Tab/Shift+Tab trapped, Esc closes, focus returns to the trigger; loading `role="status"`, error "Nie udało się wczytać miejsc." + "Spróbuj ponownie"
- mockup: analysis/design-context/mockups/formularz-wype-niony-z-banerem.html
  element: component:banner-picker
  locator: line 255 (`.banner-img` with `.acts` chips); empty-state drop zone in formularz-nowego-wydarzenia-pusty.html line 255
  acceptance: empty → "+ Dodaj baner" drop zone with hint "JPG, PNG lub WebP, do 5 MB"; file input `accept="image/jpeg,image/png,image/webp"`; chosen → `URL.createObjectURL` preview with "Zmień" and "Usuń" chips; object URL revoked on replace and unmount; invalid type / > 5 MB show banner.invalid / banner.tooLarge inline
- mockup: analysis/design-context/mockups/wyb-r-lokalizacji.html
  element: component:location-field
  locator: lines 262-263 (`.loc` row under "Lokalizacja opcjonalnie")
  acceptance: a `<button type="button">` row, labelled via a visible span; shows the chosen name + address and "Zmień ›", or a placeholder when none; opens the sheet
**Estimated Steps:** 7

- [x] 8.0 Complete plugin form and location sheet
  - [x] 8.1 Write the form verification checklist (no plugin test infrastructure): each `acceptance` line above as a checkbox plus keyboard checks (Tab order, Esc in sheet, focus return, click on `aria-disabled` submit reveals all errors)
  - [x] 8.2 `src/main.tsx`: single route `/` → `pages/EventCreatePage.tsx`; import `styles.css`
  - [x] 8.3 `components/BannerPicker.tsx` per component:banner-picker (SDK import path `../../../sdk` if needed)
  - [x] 8.4 `pages/EventCreatePage.tsx` form state: draft, per-field `touched`, `validateDraft(draft, new Date())`; Nazwa `maxLength=120`, Początek date + time, Koniec time, Opis `maxLength=2000` + counter; errors shown after blur with `role="alert"` / `aria-invalid` / `aria-describedby`; submit `aria-disabled` + hint, click while invalid marks all touched and returns (handler guard)
    - Reuse: `actionState` / `MISSING_FIELDS_HINT_ID` pattern from `src/frontend/src/pages/product/ItemCreatePage.tsx`; copy and classes from the current host `pages/add/EventCreateView.tsx` (read via `git show HEAD:src/frontend/src/pages/add/EventCreateView.tsx`, since Group 6 rewrites it)
  - [x] 8.5 `components/LocationField.tsx` + `components/LocationSheet.tsx` per screen:event-location-picker: `listMyLocations`, focus trap, Esc, focus return, inline add-place form with `validatePlace`, `createLocation` (201/200 → select + close; failure → `locationError` `role="alert"`, input kept), "Bez lokalizacji" clears
  - [x] 8.6 Check layout at 360px width: 16px gutter, no horizontal scroll, sheet visible inside the fixed-height iframe
  - [x] 8.7 Verify: `npm run build` from `plugins/events` passes; walk the 8.1 checklist in `npm run dev` (3004) against the mockups

**Acceptance Criteria:**
- `npm run build` passes
- Implementation matches each `acceptance` criterion declared above
- Every button inside the sheet has `type="button"`

---

### Task Group 9: Events Plugin Save Flow
**Dependencies:** 8
**Files to Modify:** `plugins/events/src/pages/EventCreatePage.tsx`, `plugins/events/src/components/SaveProgress.tsx`, `plugins/events/src/components/SavedCard.tsx`, `plugins/events/src/components/BannerFailed.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/zapisywanie-wydarzenia.html
  element: screen:event-saving
  locator: `.frame` content, lines 253-262
  acceptance: title "Zapisujemy „{name}”…"; steps "✓ Wydarzenie zapisane" then "Wysyłanie banera…" (banner step only when a banner was chosen); note "Nie zamykaj tej strony."; button "Zapisywanie…" natively `disabled`
- mockup: analysis/design-context/mockups/potwierdzenie-zapisu.html
  element: screen:event-saved
  locator: `.frame` `.status[role=status]` and actions, lines 253-265
  acceptance: `role="status"` card (`rounded-[28px]` primary-soft) with "Wydarzenie zapisane", bold event name, date line from `Intl.DateTimeFormat("pl-PL")` e.g. "niedziela, 15 listopada · 14:00–18:00" (or "· 14:00" without end), location "name, address" when set; primary "Dodaj kolejne" resets to the empty form; ghost "Wróć do dodawania" calls `thisPlugin.done({ name })`; all data from the POST response
- mockup: analysis/design-context/mockups/b-d-wysy-ania-banera.html
  element: screen:event-banner-failed
  locator: `.frame` content, lines 253-264
  acceptance: saved card plus "Nie udało się wysłać banera. Wydarzenie jest zapisane bez banera." and the `bannerError` line when present; "Spróbuj ponownie" re-uploads (replacing any stored banner); "Pomiń baner" goes to saved
**Estimated Steps:** 5

- [x] 9.0 Complete plugin save flow
  - [x] 9.1 Write the save-flow verification checklist: each `acceptance` line above, plus create failure (non-201 → back to form, draft kept, form-level `role="alert"` with `createEventError`), 401 → session copy, banner timeout → banner.failed only
  - [x] 9.2 Add a discriminated save state to `EventCreatePage.tsx` (`form` | `saving` | `bannerFailed` | `saved`) and the save handler: `createEvent(toRequest(draft))` → on 201 `uploadBanner` when a banner was chosen → `saved` or `bannerFailed`
  - [x] 9.3 `components/SaveProgress.tsx` (screen:event-saving) and `components/SavedCard.tsx` (screen:event-saved, date formatting via `Intl.DateTimeFormat("pl-PL", …)`)
  - [x] 9.4 `components/BannerFailed.tsx` (screen:event-banner-failed) with retry and skip; "Dodaj kolejne" resets draft, banner and save state; "Wróć do dodawania" → `thisPlugin.done({ name })`
  - [x] 9.5 Verify: `npm run build` from `plugins/events` passes; walk the 9.1 checklist in dev (host 5173 + plugin 3004 + backend) where available

**Acceptance Criteria:**
- `npm run build` passes
- Implementation matches each `acceptance` criterion declared above
- The saved card renders only from the POST response, never from the draft

---

### Task Group 10: Plugin Developer Docs
**Dependencies:** 5, 7
**Files to Modify:** `plugins/CLAUDE.md`
**Estimated Steps:** 4

- [x] 10.0 Complete plugin docs
  - [x] 10.1 Write the docs checklist: `add.event` section; `hostApp.uploadImage` (allowlist, 5 MB, response shape, 10 s timeout caveat); `thisPlugin.done` (panel hosts only); dev SDK step (`npm run build:sdk` in `src/frontend` before starting a plugin and after SDK changes); ports 3001 warehouse / 3002 box-size / 3003 ai-description / 3004 events; registration curl with `-H "Authorization: Bearer <admin-token>"` (PLUGIN_MANAGEMENT or ADMIN); import paths `../../sdk` vs `../../../sdk`; panel plugins use their own CSS mirroring host tokens; "Events Plugin" reference entry
  - [x] 10.2 Edit `plugins/CLAUDE.md` to cover every checklist item
  - [x] 10.3 Confirm `analysis/requirements.md` Key Decisions already records `event_attendances` (Req 22; present at line 10 — no edit expected)
  - [x] 10.4 Verify: grep `plugins/CLAUDE.md` for `add.event`, `uploadImage`, `done`, `build:sdk`, `3003`, `3004`, `<admin-token>`; confirm no token, key or other secret value appears

**Acceptance Criteria:**
- Every 10.1 item is documented
- The curl uses only the `<admin-token>` placeholder

---

### Task Group 11: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
**Files to Modify:** `src/backend/tests/test_events*.py`, `src/backend/tests/test_event_banners.py`, `src/frontend/src/test/plugins.test.tsx`, `src/frontend/src/test/plugin-sdk.test.ts`, `src/frontend/src/test/eventCreateViewState.test.ts`, `src/frontend/src/test/AppPage.test.tsx`
**Estimated Steps:** 5

- [x] 11.0 Review and fill critical gaps
  - [x] 11.1 Review tests from previous groups (~29 new tests plus the 2 extended backend tests)
  - [x] 11.2 Analyse gaps for this feature only (e.g. `public_message` fallback still "Access denied", `usePlugins` error state, `onDone` invalidating `[LOCATIONS_KEY]`, name cap at 120 in the toast) and diff Polish strings in `app/events/service.py` vs `plugins/events/src/domain.ts` against the Copy table
  - [x] 11.3 Write up to 10 additional strategic tests for the gaps found
  - [x] 11.4 Run feature-specific tests only: backend `uv run python -m pytest tests/test_events.py tests/test_event_banners.py tests/test_events_migration.py tests/test_authorization_matrix.py tests/test_domain_clock_guard.py`; frontend `npx vitest run src/test/plugins.test.tsx src/test/plugin-sdk.test.ts src/test/eventCreateViewState.test.ts src/test/AppPage.test.tsx`
  - [x] 11.5 Run static checks: `uv run python -m ruff check app tests` and `uv run python -m mypy app` (at or below the HEAD baseline, ~32 for mypy); `npx tsc -p tsconfig.app.json --noEmit` and `npm run lint` in `src/frontend`; `npm run build` in `plugins/events`

**Acceptance Criteria:**
- All feature tests pass (~31–41 total)
- No more than 10 additional tests added
- ruff/mypy at or below baseline; frontend `tsc` and lint pass; plugin builds

## Execution Order

1. Group 1: Database Layer (6 steps)
2. Group 2: Event Creation API (9 steps, depends on 1)
3. Group 3: Banner Upload API (5 steps, depends on 2)
4. Group 4: Host Plugin Infrastructure (8 steps, no dependencies)
5. Group 5: Plugin SDK & Dev Serving (6 steps, no dependencies)
6. Group 6: Host Event Create View (6 steps, depends on 4)
7. Group 7: Events Plugin Scaffold & Domain (6 steps, depends on 5)
8. Group 8: Events Plugin Form & Location Sheet (7 steps, depends on 7)
9. Group 9: Events Plugin Save Flow (5 steps, depends on 8)
10. Group 10: Plugin Developer Docs (4 steps, depends on 5, 7)
11. Group 11: Test Review & Gap Analysis (5 steps, depends on all)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/` — validation (Polish inline errors, server authority, `aria-disabled` submit), error-handling, minimal-implementation (create-only; `event_attendances` is the user-approved exception), coding-style, commenting
- `backend/` — models (BaseEntity UUID PKs, no `relationship()`, business keys, single `infrastructure/locations_acl.py`), migrations (0070, named constraints, partial unique index, reverse-order downgrade + test), security (`require_any("EDIT","mcp:edit")`, matrix rows tested), time (`clock.local_now()` via module attribute, naive Warsaw; clock guard extended), api (plural `/api/events`, `/banner` sub-resource, 201), queries, plugin-auth (host injects JWT)
- `frontend/` — data-fetching (`usePlugins` prefix key, invalidate `[LOCATIONS_KEY]`), components (`resolveEventCreateView` in `*ViewState.ts`, table-tested), accessibility (labels, `role="alert"`, modal sheet focus trap/Esc/return, `type="button"`, Polish iframe title), css, responsive
- `testing/` — backend-testing (real Postgres, `freeze_local_now`, exact key sets, `test_<operation>_<scenario>_<expected>`), frontend-testing (explicit vitest imports, `vi.mock`, `createQueryWrapper`, typed fixtures)

## Notes

- Test-Driven: each code group starts with 2–8 tests; plugin groups start with a verification checklist (no plugin test infrastructure by spec)
- Run Incrementally: only the new tests after each group
- Mark Progress: check off steps as completed
- Reuse First: avatar upload flow, groups locations ACL, `TermAttendance`, `ItemCreatePage` `aria-disabled` pattern, warehouse plugin scaffold
- Secrets: never print secret values; presence checks only
