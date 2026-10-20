# Implementation Plan: Simple group creation for any logged-in user + Location entity (Google Places / manual)

**Task path**: `.maister/tasks/development/2026-10-19-simple-group-creation-and-locations`
**Spec**: `implementation/spec.md` (rev 3, binding). **Design context**: `analysis/design-context/INDEX.md` (25 ids, binding) + `ascii/ui-mockups.md`. **Coverage matrix**: `implementation/visual-coverage.md`.
Paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`; backend `src/backend/app`, frontend `src/frontend/src`. Mockup line numbers refer to `analysis/design-context/ascii/ui-mockups.md`.

## Preamble (read before any group)

**Secrets rule (binding for every task-group implementer and every subagent you spawn):** never print `VITE_GOOGLE_MAPS_API_KEY` or any `.env` content. Do not run `env`, `printenv`, `cat .env`, `docker compose exec … env`, `docker inspect`. `.env` stays git-ignored; only `.env.example` files with an **empty** placeholder (`VITE_GOOGLE_MAPS_API_KEY=`) are tracked. Presence checks only (`[ -n "$VAR" ] && echo set || echo missing`). Never write a key value into code, tests, reports, work-logs, screenshots or commits. Tests use the literal string `"test-key"` via `vi.stubEnv`.

**Commands** (exact):
- Backend tests: `cd src/backend && uv run python -m pytest tests/<file> -q` (Docker required for testcontainers; never `uv run pytest`). Types/lint: `uv run python -m mypy app` (baseline ~32 errors; compare the count, do not chase pre-existing ones), `uv run python -m ruff check`.
- Frontend tests: `cd src/frontend && npm test -- src/test/<file>`; types `npx tsc -b`; lint `npm run lint`.

**Known baseline failures (do not chase):** frontend ~11 — `PanelPage.test.tsx` "hamburger promotion" ×6 (`:397-445`, deleted in Group 7), `TermPage.test.tsx` ×5 (pre-existing, not caused by this task; Group 8 adds new cases beside them), `OrganizerEditor` focus ×2 flaky. Backend mypy baseline ~32 errors. Record the counts you see before and after your group in the execution report.

**Stale standards:** `standards/backend/models.md` (Sequence PKs, "no soft delete") and `standards/backend/migrations.md` are stale — follow the code: UUID PKs via `app/core/base_model.py` / migration 0054, soft delete via 0056. `standards/testing/backend-testing.md` is Java/MockMvc — follow `tests/conftest.py` (httpx client, per-file `_register`/`_auth`, camelCase `test_<op>_<scenario>_<expected>`).

**Architecture decisions (from prior phases, binding):** own BC `app/locations/`; `app/groups/infrastructure/locations_acl.py` is the only `app.groups` file importing `app.locations` and must not import `..schemas` (cycle); migrations 0057 (locations) and 0058 (groups/terms columns; 0058 downgrades before 0057); term inherits group defaults **by value** in `create_term`; `model_fields_set` for the 4 new clearable PATCH fields; batched `IN` lookups everywhere (no per-row queries); `attendee_count` on `PublicTermResponse` and `MyAttendanceResponse`; idempotent `POST /api/locations` (200 for an existing active place_id); Places API (New) only via `importLibrary("places")` with session tokens, manual fallback; minimal change in `PanelDataContext.load()` (both contexts incl. membership-circle terms); `AccountMenu` "Załóż grupę" exists only on public pages and deep-links `/panel/spotkania?nowa=grupa`; stepper uses `POST /groups/mine/new` with frontend-chosen visibility.

## Overview

- Task Groups: 10 (3 backend, 5 frontend, 1 integration, plus scope-addition Group 10 — Moje miejsca view + compact picker)
- Total Steps: 73 (parent steps X.0 excluded; 83 checkboxes)
- Expected Tests: 40–52 new/rewritten (2–8 per group) plus the listed existing-test updates; the final group runs the full suites once
- Parallelism: Groups 1→2→3 (backend chain) and Group 4→5→{6,8}→7 (frontend chain) are independent until Group 9. Group 4 may start at the same time as Group 1. Group 6 and Group 8 can run concurrently (disjoint files). Group 7 waits for 5 and 6.

## Implementation Steps

### Task Group 1: Backend — `app/locations` bounded context, migration 0057, authorization matrix
**Dependencies:** None
**Files to Modify:** `src/backend/app/locations/__init__.py`, `src/backend/app/locations/models.py`, `src/backend/app/locations/schemas.py`, `src/backend/app/locations/service.py`, `src/backend/app/locations/router.py`, `src/backend/alembic/versions/0057_locations.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/app/main.py`, `src/backend/tests/test_locations.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 8

- [x] 1.0 Complete the locations module
  - [x] 1.1 Write 8 focused tests in `tests/test_locations.py` (spec §9.1; template `tests/test_organizations*.py` style helpers `_register`, `_auth`):
    - `test_createLocation_manual_returns201AndListsInMine`
    - `test_createLocation_google_returns201_andDuplicateActivePlaceIdReturns200SameId`
    - `test_createLocation_validation_googleWithoutPlaceIdOrCoords_manualWithPlaceId_blankAddress_return400`
    - `test_listMine_excludesOtherOwnersAndSoftDeleted`
    - `test_updateLocation_nameNotes200_addressOnGoogleRow409`
    - `test_updateOrDeleteLocation_nonOwner403`
    - `test_deleteLocation_204_thenMineExcludes_andPatchDeleteOnDeleted404`
    - `test_createLocation_afterDelete_reAddingSamePlaceIdCreatesNewRow201`
    - Plus in `tests/test_authorization_matrix.py` (`:43-60, 161-192`): extend the parametrized table with the 3 `/api/locations` rows; assert GET/POST/PATCH/DELETE on `/api/locations…` never resolve to the catch-all.
  - [x] 1.2 `alembic/versions/0057_locations.py` (`revision="0057"`, `down_revision="0056"`; template `0054_organization_media.py`): `create_table("locations")` with the §6.1 columns (`id` UUID `gen_random_uuid()` `pk_locations`; `owner_party_id` FK `fk_locations_owner_party_id_parties`; `name` String(255); `formatted_address` String(500); `google_place_id` String(255) nullable; `lat`/`lng` `Numeric(9,6)` nullable; `notes` String(500) nullable; `source` String(10); `created_at`, `updated_at`; `deleted_at` nullable), `ix_locations_owner_party_id`, partial unique `uq_locations_owner_party_id_google_place_id` via `op.create_index(..., unique=True, postgresql_where=sa.text("google_place_id IS NOT NULL AND deleted_at IS NULL"))`. `downgrade`: drop the two indexes, then the table.
  - [x] 1.3 `app/locations/models.py`: `Location(BaseEntity)` per §6.1 with a local `_enum_column` replica (do **not** import `app.groups`), `LocationSource` StrEnum (`GOOGLE`/`MANUAL`, `native_enum=False`), no `relationship()`, no `__eq__`. `app/locations/__init__.py` module docstring: Google place_id storable indefinitely; `formatted_address`/`lat`/`lng` are cached Google data (30-day coordinate cache), refresh out of scope, backend never calls Google, `updated_at` is the cache timestamp.
  - [x] 1.4 `app/locations/schemas.py` per §6.4: `LocationResponse` (`from_attributes`, `lat`/`lng` typed `float | None` so JSON carries numbers), `PublicLocationResponse` (no `owner_party_id`, no timestamps), `CreateLocationRequest` (`extra="forbid"`, `str_strip_whitespace=True`, ranges, blank notes -> null, model validator GOOGLE requires place_id+lat+lng / MANUAL forbids them), `UpdateLocationRequest` (`model_fields_set`, `_not_null` validators for `name`/`formatted_address`; template `app/organizations/schemas.py:93-112`).
  - [x] 1.5 `app/locations/service.py` (template `app/organizations/service.py`): `list_my_locations` (active only, order `name, created_at`), `create_location` (owner = `get_profile_by_principal(...).party_id`; GOOGLE: look up active `(owner, google_place_id)` -> return existing + `created=False`; else insert inside `begin_nested()`, on `IntegrityError` re-fetch — template `app/circulation/application/inventory.py:40-70`), `get_own_location_including_deleted` -> `update_location` (missing or `deleted_at` -> `EntityNotFoundException` 404; non-owner -> `AccessDeniedException` 403; `formatted_address` on GOOGLE -> `BusinessConflictException` 409; apply only `model_fields_set`), `soft_delete_location` (`deleted_at = datetime.utcnow()`; already deleted -> 404). No `datetime.now()`/`date.today()`.
  - [x] 1.6 `app/locations/router.py` (tag `locations`; template `app/organizations/router.py`): `GET /api/locations/mine` (`ReadPrincipal`) declared before `/{id}`; `POST /api/locations` (`EditPrincipal`, sets `response.status_code` 201/200 dynamically); `PATCH /api/locations/{id}`; `DELETE /api/locations/{id}` (204, `response_model=None`). Owner id never from the body.
  - [x] 1.7 `app/core/authorization_matrix.py`: add next to the organizations rows (`:195-201`), before the catch-all (`:248`): `(_methods("PATCH","DELETE"), r"^/api/locations/[^/]+$", ("EDIT","mcp:edit"))`, `(_methods("GET"), r"^/api/locations(/.*)?$", ("READ","mcp:read"))`, `(_methods("POST"), r"^/api/locations(/.*)?$", ("EDIT","mcp:edit"))`. `app/main.py:146-160`: `include_router(locations_router)` after `organizations_router`, before `system_router` (SPA catch-all stays last).
  - [x] 1.8 Ensure the group's tests pass: `cd src/backend && uv run python -m pytest tests/test_locations.py tests/test_authorization_matrix.py tests/test_group_soft_delete_migration.py -q` (the soft-delete migration test downgrades to 0055 and back, proving the 0057 downgrade works). Then `uv run python -m ruff check app/locations alembic/versions/0057_locations.py`.

**Acceptance Criteria:**
- The 8 location tests and the extended matrix test pass; `test_group_soft_delete_migration.py` still passes (0057 downgrade/upgrade clean).
- `POST /api/locations` returns 201 for new rows and 200 with the same id for an active duplicate place_id; MANUAL always 201.
- Ownership order 404 -> 403; soft-deleted rows are 404 for PATCH/DELETE and absent from `/mine`.
- No file under `app/groups` is touched in this group; `app/locations` imports nothing from `app.groups`.

---

### Task Group 2: Backend — migration 0058, groups ACL, group defaults (`default_location`/`default_capacity`), `GET /api/groups` batching
**Dependencies:** 1
**Files to Modify:** `src/backend/alembic/versions/0058_group_term_location_capacity.py`, `src/backend/app/groups/models.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/infrastructure/locations_acl.py`, `src/backend/app/groups/application/circles.py`, `src/backend/app/groups/router/circles.py`, `src/backend/app/groups/service.py` (facade re-exports if needed), `src/backend/tests/test_locations_migration.py`, `src/backend/tests/test_group_location_defaults.py`
**Estimated Steps:** 8

- [x] 2.0 Complete group defaults
  - [x] 2.1 Write 7 focused tests:
    - `tests/test_locations_migration.py` (template `tests/test_group_soft_delete_migration.py:63-79`): `test_migration_downgradeTo0056AndUpgradeHead_succeeds` (asserts `locations` table, `groups.default_location_id`/`default_capacity`, `terms.location_id`/`capacity`, FKs `fk_groups_default_location_id_locations` / `fk_terms_location_id_locations`, both indexes exist after upgrade and are gone after downgrade).
    - `tests/test_group_location_defaults.py`: `test_createAdditionalCircle_withDefaults_returnsNestedDefaultLocationAndCapacity` (also asserts `lat`/`lng` are JSON numbers); `test_createAdditionalCircle_otherUsersLocation_403`; `test_createAdditionalCircle_softDeletedLocation_404`; `test_updateGroup_nullClearsDefaults_omittedKeepsThem`; `test_listGroups_rowsCarryDefaultLocation_withOneBatchedQuery` (`count_queries` from `conftest.py:81-94`: count does not grow with the number of groups); `test_createOwnCircle_mine_ignoresDefaults_unchanged`.
  - [x] 2.2 `alembic/versions/0058_group_term_location_capacity.py` (`down_revision="0057"`; template `0056_group_soft_delete.py`): the four `add_column`s (UUID/Integer, nullable) and two named `create_foreign_key`s, no `ON DELETE`; `downgrade` drops both FKs then the four columns (must run cleanly before 0057's downgrade). No data backfill.
  - [x] 2.3 `app/groups/models.py`: `Group.default_location_id: Mapped[uuid.UUID | None]` (FK `locations.id`, name as in 0058), `Group.default_capacity: Mapped[int | None]`; `Term.location_id`, `Term.capacity` likewise (used by Group 3 but declared here so the model matches the DB). Plain FK ids, no `relationship()`.
  - [x] 2.4 `app/groups/infrastructure/locations_acl.py` (template `organizations_acl.py`, but **do not import `..schemas`**): `get_owned_location(db, location_id, caller_party_id)` (missing -> `EntityNotFoundException("Location", id)`; soft-deleted -> 404; non-owner -> `AccessDeniedException`), `get_locations_by_ids(db, ids) -> dict` (one `IN` query, includes soft-deleted, `{}` for empty input without a query), `location_response(loc | None)`, `public_location_response(loc | None)`, re-export `LocationResponse`, `PublicLocationResponse`.
  - [x] 2.5 `app/groups/schemas.py`: import the two response models from `.infrastructure.locations_acl`; `GroupResponse` + `default_location: LocationResponse | None = None`, `default_capacity: int | None = None`; `CreateOwnCircleRequest` + `default_location_id`, `default_capacity` (`ge=1, le=10000`); `UpdateGroupRequest` + the same two fields (no `extra="forbid"`). If an import cycle appears, define thin nested response models inside the ACL and import those.
  - [x] 2.6 `app/groups/application/circles.py`: `create_additional_circle(db, party_id, name, visibility, default_location_id, default_capacity)` validates via `get_owned_location` against the caller's PERSON party (`profile.party_id`, not the circle's ORGANIZATION party) and sets both columns; `update_group` receives the `UpdateGroupRequest` (router `router/circles.py:279-281` currently passes name/layout_mode/visibility positionally — change the signature) and applies `default_location_id` (ownership-validated when non-null) / `default_capacity` only when in `model_fields_set`; `create_own_circle` (`/mine`) unchanged.
  - [x] 2.7 `app/groups/router/circles.py`: attach `default_location` after `model_validate` at every `GroupResponse` site (`:69-71, 84-86, 104-106, 282-284, 303-305` — same spots as `organizer_slug`); the `GET /api/groups` list uses one `get_locations_by_ids` over the page's distinct `default_location_id`s. `/mine/new` passes the two new fields.
  - [x] 2.8 Ensure the group's tests pass: `cd src/backend && uv run python -m pytest tests/test_locations_migration.py tests/test_group_location_defaults.py tests/test_groups.py tests/test_circles_router.py tests/test_group_soft_delete_migration.py -q`; then `uv run python -m ruff check app/groups`.

**Acceptance Criteria:**
- The 7 tests pass; `test_groups.py`, `test_circles_router.py` and all migration-downgrade tests still pass.
- `GroupResponse` is never half-populated: every endpoint returning it (including the list) carries `default_location` when set.
- `locations_acl.py` is the only `app/groups` file importing `app.locations`; `tests/test_domain_clock_guard.py` passes (no `datetime.now()`/`date.today()` added).

---

### Task Group 3: Backend — term location/capacity (inheritance by value, clearing), moderation, public `attendee_count`, `MyAttendanceResponse`
**Dependencies:** 2
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/terms.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/router/terms.py`, `src/backend/app/groups/infrastructure/repository.py` (only if a batched helper is missing), `src/backend/tests/test_term_location_capacity.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_my_attendances.py`
**Estimated Steps:** 8

- [x] 3.0 Complete term fields and public reads
  - [x] 3.1 Write 8 focused tests in `tests/test_term_location_capacity.py`:
    - `test_createTerm_omittedFields_inheritGroupDefaultsByValue_andLaterGroupChangeDoesNotPropagate`
    - `test_createTerm_explicitNull_suppressesInheritance`
    - `test_createTerm_ownLocation_overridesDefault_andOtherUsersLocation403`
    - `test_updateTerm_nullClears_omittedKeeps`
    - `test_listTerms_attachesLocation_withQueryCountNotGrowingWithTermCount` (`count_queries`)
    - `test_moderationTerms_carryLocationAndCapacity`
    - `test_publicCircleView_termHasLocationWithoutOwnerPartyId_capacity_andAttendeeCountExcludesWithdrawn_softDeletedLocationStillRenders`
    - `test_myAttendances_carryLocationCapacityAttendeeCount_withQueryCountNotGrowing`
    - Update existing exact-key assertions: `tests/test_public_term.py:180-198, 243-249` (`term` keys + `location`, `capacity`, `attendee_count`), `tests/test_my_attendances.py:114` (+ the three keys).
  - [x] 3.2 `app/groups/schemas.py`: `TermResponse` + `location: LocationResponse | None = None`, `capacity: int | None = None`; `CreateTermRequest` + `location_id`, `capacity` (`ge=1, le=10000`); `UpdateTermRequest` + both (`model_fields_set` semantics); `ModerationTermResponse` + `location: PublicLocationResponse | None`, `capacity`; `PublicTermResponse` + `location: PublicLocationResponse | None`, `capacity`, `attendee_count: int`; `MyAttendanceResponse` (`:~500-515`) + `location: PublicLocationResponse | None`, `capacity: int | None`, `attendee_count: int`. `OrganizerTermResponse`/`OrganizerNextTermResponse`/`GroupAccessResponse` unchanged.
  - [x] 3.3 `application/terms.py` `create_term` (`:32-44`, group already loaded): after the 404/403/moderation steps, `location_id = data.location_id if "location_id" in data.model_fields_set else group.default_location_id` (same for `capacity`); caller-supplied non-null `location_id` validated via `get_owned_location`; inherited ids not re-validated. `update_term` (`:113-129`): apply the two fields when in `model_fields_set`, validate non-null ids. `list_terms_for_moderation` (`:86-110`): batch-attach via `get_locations_by_ids` + `public_location_response`.
  - [x] 3.4 `router/terms.py`: list endpoint (`:46-64`) batch-attaches `location` with one `IN` query per request; `GET /{id}`, `POST`, `PATCH` attach with a single lookup (including soft-deleted rows).
  - [x] 3.5 `application/public_view.py` `get_public_circle_view` (`:183-329`): `PublicTermResponse` gets `location` (single lookup including soft-deleted), `capacity`, `attendee_count` from `count_active_attendances_by_term(db, [term.id])` (0 when absent); PRIVATE reduced branch keeps `term=None`.
  - [x] 3.6 `application/public_view.py` `list_my_attendances` (`:96-133`): one `get_locations_by_ids` over distinct `term.location_id`s and one `count_active_attendances_by_term` over all term ids; attach `location`, `capacity`, `attendee_count` (defensive 0) — exactly two extra queries regardless of count.
  - [x] 3.7 Verify-unchanged set: run `tests/test_groups_moderation.py tests/test_organizer_terms.py tests/test_organizer_page_queries.py tests/test_organizer_bridges.py tests/test_public_preview.py tests/test_notifications.py tests/test_domain_clock_guard.py` — no edits expected (budgets `MAIN_ENDPOINT_BUDGET=10`, `TERMS_ENDPOINT_BUDGET=5` untouched because organizer endpoints are not extended).
  - [x] 3.8 Ensure the group's tests pass: `cd src/backend && uv run python -m pytest tests/test_term_location_capacity.py tests/test_public_term.py tests/test_my_attendances.py -q` plus the 3.7 set; `uv run python -m ruff check app`; `uv run python -m mypy app` — record the error count, must not exceed the ~32 baseline.

**Acceptance Criteria:**
- The 8 new tests and the 2 updated exact-key tests pass; the verify-unchanged set passes.
- Terms copy group defaults by value only when a field is omitted; explicit `null` suppresses; later group changes never propagate.
- No `owner_party_id` key in any public/attendance/moderation payload; soft-deleted locations still render on terms.
- Query counts for `GET /api/terms`, `GET /api/groups/mine/attendances` do not grow with row count.

---

### Task Group 4: Frontend — env/build plumbing, `lib/googleMaps.ts`, `api/locations.ts`, `hooks/useMyLocations.ts`, type mirrors
**Dependencies:** None (can run in parallel with Groups 1–3; the TS types mirror spec §6.4 verbatim)
**Files to Modify:** `src/frontend/src/vite-env.d.ts` (new), `src/frontend/.env.example` (new), `.env.example` (root), `src/frontend/Dockerfile`, `docker-compose.yml`, `src/frontend/package.json` + `package-lock.json` (`@types/google.maps` devDependency only), `src/frontend/src/lib/googleMaps.ts` (new; `lib/` directory does not exist yet), `src/frontend/src/api/locations.ts` (new), `src/frontend/src/hooks/useMyLocations.ts` (new), `src/frontend/src/api/groups.ts`, `src/frontend/src/api/terms.ts`, `src/frontend/src/pages/panel/views/SpotkaniaView.tsx` (literals `:127-156` only), `src/frontend/src/test/googleMaps.test.ts` (new), `src/frontend/src/test/useMyLocations.test.tsx` (new), plus minimal fixture additions in any test file `npx tsc -b` flags (expected: `src/test/PanelPage.test.tsx` `getMyAttendances` fixtures, `src/test/TermPage.test.tsx:46-80`)
**Estimated Steps:** 8

- [x] 4.0 Complete the data layer
  - [x] 4.1 Write 8 focused tests:
    - `src/test/googleMaps.test.ts` (5): `loadPlaces` resolves `null` without a key (`vi.unstubAllEnvs()` in `afterEach`); resolves `null` when the injected script fires `error` (memo cleared, a retry injects again); with `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY","test-key")` + `window.google.maps.importLibrary` stub + firing the script `load` event, `importLibrary("places")` is called once across two `loadPlaces()` calls; `suggest(api, "  ", token)` returns `[]` without calling `fetchAutocompleteSuggestions`; after `resolve(...)` the caller gets a fresh token (`newSessionToken` returns a new instance). Fake shape exactly as spec §7.2.
    - `src/test/useMyLocations.test.tsx` (3): returns `{data, loading, error, refetch, create, update, remove}` with `NO_LOCATIONS` fallback and the token in the key; `create` invalidates `["locations"]` and `create` with an already-loaded active `google_place_id` returns that row without calling `createLocation`; `remove` rethrows `extractProblemMessage` text as `Error`.
  - [x] 4.2 Env/build plumbing (§7.1): `src/vite-env.d.ts` (`/// <reference types="vite/client" />` + `ImportMetaEnv { readonly VITE_GOOGLE_MAPS_API_KEY?: string }`); `src/frontend/.env.example` and root `.env.example` gain `VITE_GOOGLE_MAPS_API_KEY=` with the comment "referrer-restricted browser key; leave empty for manual mode" (empty placeholder only); `src/frontend/Dockerfile` builder stage `ARG VITE_GOOGLE_MAPS_API_KEY=` + `ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY` before `npm run build`; `docker-compose.yml` `build.args: VITE_GOOGLE_MAPS_API_KEY: ${VITE_GOOGLE_MAPS_API_KEY:-}` on `frontend-build` and `frontend`; `npm i -D @types/google.maps` (recent enough for `AutocompleteSuggestion`, `Place.fetchFields`, `importLibrary`).
  - [x] 4.3 `lib/googleMaps.ts` with the exact exports of §7.2: `isGoogleMapsConfigured()` (reads `import.meta.env` **inside** the function), `loadPlaces()` (memoized; `<script async src="https://maps.googleapis.com/maps/api/js?key=…&v=weekly&loading=async">`, then `google.maps.importLibrary("places")`; `null` on missing key / script error / 10 s timeout; memo cleared on failure; never called at import or mount), `newSessionToken`, `suggest` (`[]` for blank input; `language:"pl"`, `region:"pl"`; maps `placePrediction.placeId/mainText.text/secondaryText.text`), `resolve` (`toPlace()` + `fetchFields({ fields:["id","formattedAddress","location","displayName"], sessionToken })` — if typings reject `sessionToken` here, pass it only to suggestions and retire it), `buildMapsUrl({formatted_address, google_place_id})`. No legacy `AutocompleteService`/`PlacesService`. Nothing sensitive logged.
  - [x] 4.4 `api/locations.ts` (template `api/organizations.ts`): `LocationSource`, `LocationResponse` (`deleted_at: string | null`, `lat`/`lng: number | null`), `PublicLocationResponse`, `CreateLocationRequest`, `UpdateLocationRequest`; `getMyLocations`, `createLocation`, `updateLocation`, `deleteLocation` with `encodeURIComponent` ids.
  - [x] 4.5 `hooks/useMyLocations.ts` (templates `hooks/useCategories.ts`, `hooks/useMyOrganization.ts:45-49`): key `[LOCATIONS_KEY, "mine", token]`, `enabled: token !== null`, module-level `NO_LOCATIONS`, `loading = isPending`, `error: string | null`, `refetch(): Promise<void>`, mutations `await invalidateQueries({ queryKey: [LOCATIONS_KEY] })` and rethrow `new Error(extractProblemMessage(err))`; `create` pre-checks the loaded list for an active row with the same `google_place_id`.
  - [x] 4.6 Type mirrors: `api/groups.ts` — `GroupResponse` + `default_location?: LocationResponse | null`, `default_capacity?: number | null`; `CreateOwnCircleRequest`-equivalent of `createAdditionalMyCircle` + `default_location_id?: string | null`, `default_capacity?: number | null`; new `updateGroup(id, { name, layout_mode?, visibility?, default_location_id?, default_capacity? })` beside `updateGroupLayoutMode` (`:126-139`, kept); `PublicTermResponse` + `location?: PublicLocationResponse | null`, `capacity?: number | null`, `attendee_count?: number`; `MyAttendanceResponse` (`:~514-523`) + `location: PublicLocationResponse | null`, `capacity: number | null`, `attendee_count: number`. `api/terms.ts` — `TermResponse` + `location?: LocationResponse | null`, `capacity?: number | null`; `ModerationTermResponse` + `location?: PublicLocationResponse | null`, `capacity?: number | null`; `CreateTermRequest`/`UpdateTermRequest` + `location_id?: string | null`, `capacity?: number | null`. Rule: additive fields on response types are optional-nullable so the fixtures listed in spec §9.1 ("fixtures compile only if…") keep compiling; the three `MyAttendanceResponse` fields are required per spec, so update their fixtures in this group.
  - [x] 4.7 `SpotkaniaView.tsx:127-156` literals: add `location: attendance.location`, `capacity: attendance.capacity`, `attendee_count: attendance.attendee_count`, `child_count: null` on the term literal and `default_location: null`, `default_capacity: null` on the group literal (no behaviour change yet; Group 7 replaces the construction).
  - [x] 4.8 Ensure the group's tests pass: `cd src/frontend && npm test -- src/test/googleMaps.test.ts src/test/useMyLocations.test.tsx`; then `npx tsc -b` (must be green — add only the nullable fields to fixtures it flags) and `npm run lint`.

**Acceptance Criteria:**
- The 8 tests pass; `npx tsc -b` and `npm run lint` are green.
- No runtime Google npm package; `@types/google.maps` is a devDependency only.
- `.env.example` files contain only the empty placeholder; no key value anywhere in the diff.
- `isGoogleMapsConfigured()` reads the env at call time (verified by the stubbed tests flipping modes).

---

### Task Group 5: Frontend — `LocationPicker`, `GroupFormFields`, `TermPlaceLine`, `MapPinIcon`
**Dependencies:** 4
**Files to Modify:** `src/frontend/src/components/shared/LocationPicker.tsx` (new), `src/frontend/src/components/panel/GroupFormFields.tsx` (new), `src/frontend/src/components/shared/TermPlaceLine.tsx` (new), `src/frontend/src/pages/panel/panelIcons.tsx` (`MapPinIcon`), `src/frontend/src/pages/panel/panelHelpers.ts` (`defaultVisibility` helper only — `ModalKind` is edited in Group 7), `src/frontend/src/test/LocationPicker.test.tsx` (new), `src/frontend/src/test/TermPlaceLine.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:location-picker
  locator: section "Mockup 2: LocationPicker" (lines 205-208) + "Accessibility considerations" (lines 749-758)
  acceptance: props `value`, `onChange`, `label`, `noneLabel`, `idPrefix`, `fallbackLocation?`, `helperText?`; rendered inline inside a host `Field`, never opens a sheet; radiogroup `aria-label` = `label`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:location-picker-empty
  locator: "2a: empty state" (lines 210-225)
  acceptance: text "Nie masz jeszcze zapisanych miejsc."; search `role="combobox"` input shown immediately in Google mode with a "wpisz ręcznie" text button; manual form directly (no toggle, no search input) when `isGoogleMapsConfigured()` is false; no radiogroup rendered; `value` stays `null`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:location-picker-list
  locator: "2b: list state with a selection" (lines 227-252)
  acceptance: `role="radiogroup"`; first radio "Brak miejsca"/`noneLabel` -> `onChange(null)`; one `role="radio"` per row with `aria-checked`, roving `tabIndex`, Arrow keys (copy `ColorsTab.tsx:53-75`); row shows name (bold), `formatted_address`, notes only when non-null; sibling buttons `aria-label="Edytuj miejsce <name>"` / `"Usuń miejsce <name>"` outside the radio; "(usunięte)" row rendered from `fallbackLocation` when `value` is absent from the list, checked, without buttons; "+ Dodaj nowe miejsce" disclosure with `aria-expanded`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:location-picker-add
  locator: "2c: add new (Google Places Autocomplete)" (lines 254-296)
  acceptance: own `role="combobox"` (`aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) + own `role="listbox"`/`role="option"` inside the sheet; `loadPlaces()` on first focus with `aria-busy` + placeholder "Ładowanie wyszukiwarki…"; 300 ms debounce; ArrowUp/Down + Enter; Esc with the listbox open closes only the listbox and calls `preventDefault()` + `stopPropagation()`; chosen address line + "zmień"; "Nazwa miejsca" prefilled with `displayName`; "Notatka"; "Zapisz miejsce"/"Anuluj"; fresh session token after each selection; `loadPlaces()` -> `null` falls back to manual with `role="alert"` "Wyszukiwarka niedostępna — wpisz adres ręcznie"; on save the row is appended, selected (`onChange(id)`), disclosure collapses, focus moves to the new radio
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:location-picker-manual
  locator: "2d: manual mode" (lines 298-323)
  acceptance: inputs `aria-label` "Nazwa miejsca" (required), "Adres" (required, non-blank, `role="alert"` "Podaj adres"), "Notatka"; `create({source:"MANUAL", name, formatted_address, notes})`; "szukaj w Google" link rendered only when a key is configured
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:location-picker-edit
  locator: "2e: inline edit row" (lines 325-351)
  acceptance: one `editingId` at a time; row swaps to a form with name + notes editable; address editable only when `source === "MANUAL"`, Google rows show the address read-only with "(z Google)"; "Zapisz" -> `update`, "Anuluj"; focus to the name input on open and back to that row's "Edytuj" on close; `role="alert"` errors under the row; "Usuń" opens a confirm alertdialog (pattern `DeleteGroupDialog`, registered with `useRegisterOpenSheet`; check whether `components/shared/ConfirmDialog.tsx` already satisfies this before writing a new one) — confirm -> `remove(id)`, `onChange(null)` when the deleted row was selected, focus to the next row or "+ Dodaj nowe miejsce"
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:group-form-fields
  locator: "Mockup 1a" GroupFormFields block (lines 90-113) + "Mockup 3" (lines 355-396) + "Consistency checklist" (lines 740-747)
  acceptance: controlled `value {name, visibility, layoutMode?, defaultLocationId, defaultCapacity}` + `onChange`, `showLayoutMode?`, `idPrefix`, `fallbackLocation?`; field order Nazwa grupy -> (Szablon wizualizacji, only when `showLayoutMode`) -> Widoczność grupy (`aria-label="Widoczność grupy"`, options/copy from `PanelModals.tsx:170-185`) -> "Stałe miejsce spotkań (opcjonalnie)" (`LocationPicker`, `noneLabel` "Brak stałego miejsca") -> "Ile miejsc (opcjonalnie)" (`type=number min=1 inputMode=numeric w-28`, blank -> `null`); every input has `aria-label` equal to its visible label; `defaultVisibility(organizationSlug)` helper in `panelHelpers.ts` returns `"PRIVATE"` when `null`, else `"PUBLIC"`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:term-place-line
  locator: "Mockup 5" integration points + A11y (lines 531-536) and the led-card lines 504-507
  acceptance: props `location`, `capacity`, `attendeeCount?`, `withMapLink`, `className?`; pin glyph `aria-hidden`; name, address, notes; link text "Otwórz w Google Maps" with `target="_blank" rel="noopener noreferrer"` and `aria-label="Otwórz <name> w Google Maps (nowa karta)"` only when `withMapLink`; URL from `buildMapsUrl` (no `query_place_id` for MANUAL); capacity text "X/Y miejsc" (both known) / "Y miejsc" (capacity only) / nothing; renders `null` when location and capacity are both null; tokens only (`text-ink-soft`, `bg-cream`)
**Estimated Steps:** 7

- [x] 5.0 Complete the shared components
  - [x] 5.1 Write 8 focused tests in `src/test/LocationPicker.test.tsx` (`createQueryWrapper()`, `vi.mock("../api/locations")`, `vi.resetAllMocks()` in `beforeEach`, `vi.unstubAllEnvs()` in `afterEach`):
    - manual mode without a key: empty state renders the manual form, "Podaj adres" on blank address, save calls `createLocation` with `source:"MANUAL"` and selects the row (`onChange(id)`)
    - list state: radiogroup with `noneLabel` first, clicking a row calls `onChange(id)`, "Brak" calls `onChange(null)`, ArrowDown moves the roving focus
    - edit row: Google row shows "(z Google)" with no address input, MANUAL row has an "Adres" input; "Zapisz" calls `updateLocation`; focus returns to "Edytuj"
    - delete with confirm: alertdialog, confirm calls `deleteLocation`, selected row deleted -> `onChange(null)`
    - "(usunięte)" row for a `value` missing from the list with `fallbackLocation`, no Edytuj/Usuń
    - Google mode (`vi.stubEnv` before mount + `vi.mock("../lib/googleMaps")` returning `fakePlaces`-backed `loadPlaces`/`suggest`/`resolve`): suggestions appear in the own listbox; Esc closes only the listbox and the event is `defaultPrevented`
    - Google mode: pick -> name prefilled "Świetlica Osiedlowa" -> save calls `createLocation` with `source:"GOOGLE"`, numeric `lat`/`lng`; duplicate `google_place_id` already in the list selects that row without a request
    - Google mode: `loadPlaces` resolving `null` shows the alert "Wyszukiwarka niedostępna — wpisz adres ręcznie" and the manual form
    - Plus `src/test/TermPlaceLine.test.tsx` (4 small cases, counted inside the 8-per-group budget as one file): Maps URL with and without `google_place_id`; capacity text variants; renders nothing when both null; no anchor when `withMapLink={false}`.
  - [x] 5.2 `panelIcons.tsx`: add `MapPinIcon` (same style as `PencilIcon`/`TrashIcon`). `panelHelpers.ts`: add `defaultVisibility`.
  - [x] 5.3 `components/shared/TermPlaceLine.tsx` per spec §7.9 (uses `buildMapsUrl` from `lib/googleMaps.ts`).
  - [x] 5.4 `components/shared/LocationPicker.tsx` — manual path first (states Loading / Error / Empty / List / Deleted-selected / Add-manual / Edit / Delete per spec §7.4 table), reusing `inputClass`, `rowIconBtn`/`rowSaveBtn`/`rowCancelBtn` (`EditTermDialog.tsx:329-400`), the disclosure pattern (`PanelModals.tsx:322-370`), focus move after removal (`PhotosTab.tsx`).
  - [x] 5.5 `LocationPicker` — Google path: combobox/listbox, debounce, session tokens, Esc rule, fallback to manual, `create` pre-check; depends only on the `lib/googleMaps.ts` exports.
  - [x] 5.6 `components/panel/GroupFormFields.tsx` per spec §7.5 (not yet wired into any host — Group 7 does that).
  - [x] 5.7 Ensure the group's tests pass: `cd src/frontend && npm test -- src/test/LocationPicker.test.tsx src/test/TermPlaceLine.test.tsx`; `npx tsc -b`; `npm run lint`.

**Acceptance Criteria:**
- The LocationPicker and TermPlaceLine tests pass without a key (CI mode) and the Google-mode cases pass with the stubbed env.
- Implementation matches each `acceptance` criterion declared above (self-check each state against mockups 2a–2e).
- No nested interactive content (row buttons are siblings of the radio); every blocking dialog registers via `useRegisterOpenSheet`.

---

### Task Group 6: Frontend — term forms (`FirstTermStepperOrganizer`, `EditTermDialog`) and `AccountMenu` "Załóż grupę"
**Dependencies:** 5
**Files to Modify:** `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx`, `src/frontend/src/components/panel/EditTermDialog.tsx`, `src/frontend/src/components/shared/AccountMenu.tsx`, `src/frontend/src/test/FirstTermStepperOrganizer.test.tsx`, `src/frontend/src/test/EditTermDialog.test.tsx`, `src/frontend/src/test/PublicLayout.test.tsx`, `src/frontend/src/test/Sidebar.test.tsx`, `src/frontend/src/test/SidebarAuthIntegration.test.tsx` (only if they enumerate `AccountMenu` items)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:first-term-stepper-organizer
  locator: "Mockup 4", paragraph after the term modal diagram (line 438)
  acceptance: one-step form, field order "Data i godzina", "Opis (opcjonalnie)", "Miejsce" (`LocationPicker`, `noneLabel` "Brak miejsca", prefilled `defaultLocation?.id ?? null`), "Ile miejsc" (prefilled `defaultCapacity`), button "Dodaj termin"; labels unchanged; `createTerm` sends `location_id`/`capacity`, explicit `null` when a prefilled value was cleared; done screen unchanged; new props `defaultLocation?`/`defaultCapacity?` are optional so `PanelModals.tsx` keeps compiling until Group 7 wires them
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:edit-term-dialog
  locator: "Mockup 4", "Edytuj termin" diagram (lines 440-465)
  acceptance: after "Opis": "Miejsce" picker with `fallbackLocation={term.location}` (soft-deleted renders "(usunięte)") initialised to `term.location?.id ?? null` (the TERM's value, not the group default) and "Ile miejsc" initialised to `term.capacity`; `saveTermFields` diff includes `location_id`/`capacity` only when changed, `null` to clear; needed-items section unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:account-menu-zaloz-grupe
  locator: "Mockup 7: AccountMenu" (lines 600-621)
  acceptance: `Link role="menuitem"` "Załóż grupę" with `to="/panel/spotkania?nowa=grupa"`, placed between "Ustawienia" and "Moja organizacja", unconditional for every logged-in user, `onClick={close}`, `ACCOUNT_MENU_ITEM_CLASS`, icon `CalendarPlusIcon`; no change to `/panel` (the menu exists only under `PublicLayout`)
**Estimated Steps:** 6

- [x] 6.0 Complete term forms and the public-page entry
  - [x] 6.1 Write/update 6 focused tests:
    - `src/test/FirstTermStepperOrganizer.test.tsx:10-16`: wrap with `createQueryWrapper()`, add `vi.mock("../api/locations")`; existing label assertions unchanged; new: `createTerm` payload contains `location_id`/`capacity` prefilled from `defaultLocation`/`defaultCapacity`, and clearing the capacity sends `capacity: null`.
    - `src/test/EditTermDialog.test.tsx`: `vi.mock("../api/locations")`; fixtures gain `location`/`capacity`; new: a cleared place sends `updateTerm(id, { location_id: null })`; unchanged fields are not in the PATCH diff.
    - `src/test/PublicLayout.test.tsx`: menu-item count +1 and the "Załóż grupę" `menuitem` has `href="/panel/spotkania?nowa=grupa"`.
    - `Sidebar.test.tsx` / `SidebarAuthIntegration.test.tsx`: adjust counts only if they enumerate the items.
  - [x] 6.2 `FirstTermStepperOrganizer.tsx` (`:76-110`): add the two fields and optional props; keep the done link `:59` and "Gotowe".
  - [x] 6.3 `EditTermDialog.tsx`: state `locationId`/`capacity` (`:122-128`), fields after "Opis" (`:283-327`), diff in `saveTermFields` (`:186-197`).
  - [x] 6.4 `AccountMenu.tsx:55-75`: add the menuitem.
  - [x] 6.5 Confirm no `/panel` file renders `AccountMenu` (grep) — the `?nowa=grupa` landing is Group 7's job.
  - [x] 6.6 Ensure the group's tests pass: `cd src/frontend && npm test -- src/test/FirstTermStepperOrganizer.test.tsx src/test/EditTermDialog.test.tsx src/test/PublicLayout.test.tsx src/test/Sidebar.test.tsx src/test/SidebarAuthIntegration.test.tsx`; `npx tsc -b`; `npm run lint`.

**Acceptance Criteria:**
- The listed tests pass; `FirstTermStepperOrganizer` labels are byte-identical to today.
- `EditTermDialog` shows the term's own location (incl. "(usunięte)") and never the group default.
- Implementation matches each `acceptance` criterion declared above.

---

### Task Group 7: Frontend — panel restructure: `CreateGroupStepper`, `PanelDataContext.load()` both contexts, hints, `PanelModals`, `HomeView`, `SpotkaniaView`, `?nowa=grupa`
**Dependencies:** 5, 6
**Files to Modify:** `src/frontend/src/components/panel/FirstTermStepperGuest.tsx` (rewritten; may be renamed `CreateGroupStepper.tsx` — if renamed, delete the old file and update the `PanelModals.tsx` import), `src/frontend/src/pages/panel/PanelModals.tsx`, `src/frontend/src/pages/panel/PanelDataContext.tsx`, `src/frontend/src/pages/panel/panelHelpers.ts` (`ModalKind`), `src/frontend/src/pages/panel/PanelPage.tsx`, `src/frontend/src/pages/panel/views/HomeView.tsx`, `src/frontend/src/pages/panel/views/SpotkaniaView.tsx`, `src/frontend/src/test/CreateGroupStepper.test.tsx` (new), `src/frontend/src/test/PanelPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:stepper-step1
  locator: "Mockup 1a" (lines 80-129)
  acceptance: `ModalSheet` title "Załóż grupę"; 2 `aria-hidden` dots; `GroupFormFields` with visibility defaulted by `defaultVisibility(organizationSlug)`; "Dalej →" disabled until `name.trim()`; submit -> `createAdditionalMyCircle({ name, visibility, default_location_id, default_capacity })`, created `GroupResponse` kept in state, `onCircleCreated()`; after "← Wstecz" a changed step 1 saves via `updateGroup(id, …)` instead of creating again; `role="alert"` error text; no organization step, no `createMyOrganization` import, no `withOrganizationStep`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:stepper-step2
  locator: "Mockup 1b" (lines 131-170)
  acceptance: eyebrow "Pierwszy termin w grupie „<name>""; "Data i godzina" (required, `datetime-local`), "Opis (opcjonalnie)", "Miejsce" picker initialised to `group.default_location?.id ?? null`, "Ile miejsc" initialised to `group.default_capacity`; buttons "← Wstecz" / "Dodaj"; `createTerm({ circle_group_id, occurs_on, description, location_id, capacity })` with explicit `null` for cleared prefills
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:stepper-done
  locator: "Mockup 1c" (lines 172-201)
  acceptance: copy "Grupa założona, termin dodany! Tę stronę zobaczy każdy, kto dostanie link — bez logowania." (no "krąg"/"organizator"); primary `Link` "Przejdź do publicznej strony →" to `termPublicPath(group, termId)`; "Gotowe" -> `onDone`; only when `organizationSlug === null` a `bg-accent-soft rounded-2xl p-3.5` box with `Link to="/organization"` "Stwórz publiczną wizytówkę / własny adres →" that also calls `onDone`; order primary link, Gotowe, upsell
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:group-add-modal
  locator: "Mockup 3" left diagram (lines 360-396)
  acceptance: "Dodaj nową grupę" (`PanelModals.tsx:139-198`) renders `GroupFormFields` (no "Lokalizacja"/free-text location, no `groupExtras`); visibility default via `defaultVisibility`; button "Dodaj grupę" -> `createAdditionalMyCircle({ name, visibility, default_location_id, default_capacity })`; inline error behaviour of `:2882-2935` tests preserved
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:group-edit-modal
  locator: "Mockup 3" right diagram (lines 360-396)
  acceptance: "Edytuj grupę" (`:201-279`) renders `GroupFormFields showLayoutMode` with initial values from `group.name`, `group.layout_mode`, `group.visibility`, `group.default_location?.id`, `group.default_capacity` and `fallbackLocation={group.default_location}`; "Zapisz" -> `updateGroup(id, { name, layout_mode, visibility, default_location_id, default_capacity })` sending `null` to clear; "Lokalizacja" label absent
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-add-modal
  locator: "Mockup 4" term modal diagram (lines 405-436)
  acceptance: "Grupa" select over `myGroups` only (`relevantGroupsForForm` -> led groups); on group change prefill "Miejsce" (`helperText` "Domyślne miejsce grupy — możesz zmienić") and "Ile miejsc" from the group's defaults; fields placed after "Opis (opcjonalnie)" and before "Potrzebne rzeczy"; `handleAddTerm` sends `location_id`/`capacity` with explicit `null` when cleared; needed-items block unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:home-view
  locator: "Mockup 5" (lines 469-529) + hint table (lines 474-479)
  acceptance: hint matrix rows exactly per spec §7.7 (titles "Załóż grupę" / "Stwórz wizytówkę" / "Dopracuj stronę organizacji" / "Dodaj swój pierwszy termin", descriptions, CTAs, targets); hints stack in matrix order; keys `hint_create_group_dismissed`, `hint_create_org_dismissed` added, `hint_become_organizer_dismissed` and `hint_first_term_dismissed` removed with their state; "Najbliższe terminy" = merged upcoming led + attended + membership-only cards, deduped by term id (led > attended > membership-only), sorted by `occurs_on`, top 3; "Zapisane zajęcia" (`:186-194`) excludes attendances already shown in the top-3; no hamburger in the panel header
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:led-term-card
  locator: "Mockup 5" organizerTermCard block (lines 501-509)
  acceptance: `organizerTermCard` (`PanelDataContext.tsx:851`) renders `TermPlaceLine withMapLink` from `term.location`; `signupSummaryChip` (`:818`) appends " · X/Y miejsc" when `capacity` is known; needed-item pills and copy/edit buttons unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:attended-term-card
  locator: "Mockup 5" guest cards (lines 510-522) and "Mockup 6" (lines 576-586)
  acceptance: guest `Link` card (`HomeView.tsx:134-163`, `SpotkaniaView.tsx:287-321`) renders `TermPlaceLine withMapLink={false}` (name + address, no nested anchor) plus a small `bg-cream` pill: attended "X/Y miejsc" from `attendance.attendee_count`/`attendance.capacity`, membership-only "Y miejsc" from `term.capacity`, nothing when capacity is null; membership-only cards are built from the real `TermResponse` + `GroupResponse` of `guestTerms` (the `SpotkaniaView.tsx:127-156` literal construction is replaced), linked via `termPublicPath(group, term.id)`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:spotkania-view
  locator: "Mockup 6" (lines 540-596)
  acceptance: `h2` "Prowadzę · N" with a real `button` "+ Załóż grupę" (opens `"zaloz-grupe"`) when `myGroups.length === 0`, else "+ Dodaj grupę" (opens `"grupa"`), always rendered; empty copy "Nie masz jeszcze żadnej grupy. Załóż pierwszą, żeby dodać termin."; "Terminy · N nadchodzące" led terms only; `h2` "Zapisane · N" = `myAttendances` + `guestTerms` deduped (led > attended > membership-only); empty copy "Nie masz jeszcze zapisów na zajęcia."; `FloatingAddButton` only when `myGroups.length > 0`; `isOrganizer` view branches removed; `DeleteGroupDialog`/`TermList` unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:group-tile
  locator: "Mockup 6" tiles (lines 551-558)
  acceptance: small line = `group.default_location?.name ?? "<n> terminów"`; second small line = `default_location.formatted_address` truncated; "wolne N miejsca" chip removed; tile `aria-label`s "Edytuj grupę X"/"Usuń grupę X" unchanged
**Estimated Steps:** 10

- [x] 7.0 Complete the panel restructure
  - [x] 7.1 Write 8 new tests in `src/test/CreateGroupStepper.test.tsx` (`createQueryWrapper()`, mocks for `../api/groups`, `../api/terms`, `../api/locations`): two steps and no "Nazwa organizacji"; default visibility PRIVATE without org and PUBLIC with org; `createAdditionalMyCircle` exact payload; step 2 prefilled from the created group's `default_location`/`default_capacity`; cleared capacity sends `capacity: null`; "← Wstecz" then edit -> `updateGroup` instead of a second create; done link equals `termPublicPath(group, termId)`; CTA to `/organization` only without an org.
  - [x] 7.2 Update `src/test/PanelPage.test.tsx` in the same commit as the code (exact-arg assertions updated, never loosened): delete the 6 baseline-failing "hamburger promotion" tests (`:397-445`, `openMenu()` `:392-395`); add `vi.mock("../api/locations")` and `createAdditionalMyCircle`/`updateGroup` to the groups factory (`:68-81`); `:614-653` org-step flow and "Możesz zostać organizatorem" replaced by the "Załóż grupę" hint/stepper; `:402-416, 478-547, 550-571, 732-790, 1857` title "Dodaj pierwszy termin" -> "Załóż grupę" and `createMyCircle({name:"Nutki"})` -> `createAdditionalMyCircle({ name, visibility:"PRIVATE", default_location_id:null, default_capacity:null })`; `createTerm` exact objects (`:522-528, 1476-1482`) gain `location_id`/`capacity`; `:1522-1580` `updateGroupLayoutMode(...)` -> the `updateGroup` payload; add-group tests assert "Stałe miejsce spotkań"; `:3018` ("Lokalizacja" absent) keeps passing; hints `:597-700` new titles/keys incl. stacking ("Stwórz wizytówkę" + "Dodaj swój pierwszy termin" for a leader without org and terms); fixtures `:128, 221-268, 436, 485, 534, 690` gain nullable fields; `getMyAttendances` fixtures carry `location`/`capacity`/`attendee_count`. New tests (max 8): `renderPanel("/panel/spotkania?nowa=grupa")` opens the "Załóż grupę" sheet once and the URL loses the param; both-contexts (a leader also sees "Zapisane"); membership-only (`getMembershipsForFamily` mocked non-empty at `:362`, no RSVP) shows the circle's term under "Zapisane" and in Home's top-3 with "Y miejsc", and a term both RSVPed and membership-visible renders once; attended card renders the address line and "8/10 miejsc" inside the Link with no nested anchor; Home dedupe (an attendance in the top-3 is absent from "Zapisane zajęcia").
  - [x] 7.3 `panelHelpers.ts:24-32`: `ModalKind` — replace `"zostan-organizatorem"` with `"zaloz-grupe"`.
  - [x] 7.4 Stepper rewrite (`FirstTermStepperGuest.tsx` -> `CreateGroupStepper`): remove `withOrganizationStep`, org step (`:56-68`), `createMyOrganization` import, title switch (`:102`), comments (`:20-21, 27`); implement steps 1/2/done per the Visual References; field "Nazwa kręgu" (`:165`) replaced by `GroupFormFields`.
  - [x] 7.5 `PanelModals.tsx`: new `"zaloz-grupe"` kind mounts the stepper; `"pierwszy-termin"` (`:63-90`) keeps only the `FirstTermStepperOrganizer` branch (`firstTermForOrganizer && myGroups.length > 0`, now receiving `defaultLocation`/`defaultCapacity` of `myGroups[0]`), otherwise renders the stepper; remove `"zostan-organizatorem"` (`:92-104`); toast "Grupa założona — dodano pierwszy termin"; group modals (`:139-198`, `:201-279`) use `GroupFormFields`; term modal (`:282-374`) gains the two fields.
  - [x] 7.6 `PanelDataContext.tsx` minimal `load()` change (`:332-488`, either/or at `:455-470`): `myGroups` from leaderships and `guestCircles` from active family memberships independently (never zeroed); `getTerms` + `getNeededItems` for both, kept apart as `terms` (led) and `guestTerms` (membership-only); delete `groupExtras` (`:293, :604-609, :970-984, :935-940, :1144`) and `editGroupForm.location/freeSpots` (`:202-208`); `groupForm`/`editGroupForm` hold `defaultLocationId`/`defaultCapacity`, visibility literal (`:305-310`) replaced by `defaultVisibility(organizationSlug)`; `handleAddGroup` (`:592-617`) and `saveEditGroup` (`:954`) per Visual References; add-term state (`:313-319`) gains `locationId`/`capacity` with prefill on group select; `handleAddTerm` (`:647-684`) sends them; `relevantGroupsForForm` (`:1091`) = `myGroups`; hint keys (`:259-281`) replaced; `organizerTermCard`/`signupSummaryChip` per component:led-term-card. Do not migrate loading to hooks.
  - [x] 7.7 `HomeView.tsx` (`:70-119` hints, `:122-165` cards, `:186-194` lower section) per screen:home-view / component:attended-term-card.
  - [x] 7.8 `SpotkaniaView.tsx` (`:127-156, :158-176, :220-229, :263-269, :287-321`) per screen:spotkania-view / component:group-tile; remove `isOrganizer` branches (`:128, :158`).
  - [x] 7.9 `pages/panel/PanelPage.tsx` (`PanelPageView` `:33-38`): `useSearchParams`; when `nowa === "grupa"` call `setModal("zaloz-grupe")` once (effect keyed on the param) and `setSearchParams` with `replace` to strip it.
  - [x] 7.10 Ensure the group's tests pass: `cd src/frontend && npm test -- src/test/CreateGroupStepper.test.tsx src/test/PanelPage.test.tsx` (the only expected failures elsewhere are the baseline TermPage ×5 / OrganizerEditor ×2); `npx tsc -b`; `npm run lint`; grep the frontend for "Zostań organizatorem", "zostan-organizatorem", "Możesz zostać organizatorem", "Jesteś organizatorem", `groupExtras`, `hint_become_organizer_dismissed`, `hint_first_term_dismissed` — all zero hits.

**Acceptance Criteria:**
- `CreateGroupStepper.test.tsx` (8) and the updated `PanelPage.test.tsx` pass; the 6 hamburger tests are gone.
- Status-level "organizator" copy removed per spec §7.8; per-group role copy (`PrivateGroupGate`, `GroupHeader`, `TermCard:31`, `RegisterPage`, `GroupVisualization`, `RequestAccessDialog`, `api/problem.ts:60`) untouched.
- A family member without RSVP still sees the circle's terms under "Zapisane" and on Home; no term card rendered twice on Home.
- Implementation matches each `acceptance` criterion declared above.

---

### Task Group 8: Frontend — public term page (`TermCard`, `PublicTermView`) and `AdminTermsPage`
**Dependencies:** 5 (can run concurrently with Groups 6 and 7 — disjoint files)
**Files to Modify:** `src/frontend/src/pages/krag/components/TermCard.tsx`, `src/frontend/src/pages/krag/PublicTermView.tsx`, `src/frontend/src/pages/AdminTermsPage.tsx`, `src/frontend/src/test/TermPage.test.tsx`, `src/frontend/src/test/AdminTermsPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:public-term-page
  locator: "Mockup 8" (lines 625-658)
  acceptance: inside the existing `section aria-label="Termin zajęć"`: divider `border-t border-line mt-3 pt-3`, eyebrow "MIEJSCE" (same class as "TERMIN ZAJĘĆ"), name `font-bold`, address and notes `text-sm text-ink-soft` (notes only when set), link "Otwórz w Google Maps" `target="_blank" rel="noopener noreferrer"` with sr-only "(nowa karta)"; block omitted entirely when `location` is null; "Zapisanych X z Y" `text-sm` when capacity known, omitted when null; `TermCard` props `location`, `capacity`, `attendeeCount`; `PublicTermView.tsx` passes `term?.location ?? null`, `term?.capacity ?? null`, `term?.attendee_count`; `TermFooter` and `GroupHeader` unchanged; tokens only (`themeTokenUsage.test.tsx`, `themeDefects.test.tsx` stay green)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:public-term-full
  locator: "Mockup 8" full variant (lines 660-668)
  acceptance: `role="status"` pill "Brak wolnych miejsc" (`bg-accent-soft`, `text-accent-fg font-bold`, no raw hex) rendered when `attendeeCount >= capacity` (both numbers); the RSVP button stays enabled
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-terms-page
  locator: "Mockup 9" (lines 676-701)
  acceptance: `columns = ["Date","Circle","Description","Miejsce","Signups","Children","Miejsca"]`; "Miejsce" cell = name (`fontWeight 500`) + address line (`fontSize 12px`, `#64748B`) or "—" italic `#94A3B8`; "Miejsca" cell = the single string `` `${attendee_count} / ${capacity}` `` or "—" (gray italic) — never a bare number
**Estimated Steps:** 5

- [x] 8.0 Complete the display surfaces
  - [x] 8.1 Write/update 6 focused tests:
    - `src/test/TermPage.test.tsx:46-80`: fixture gains `location`, `capacity`, `attendee_count`; new: location block with the Maps link (`href` contains `query_place_id`), block absent when `location` is null, "Zapisanych 3 z 12", "Brak wolnych miejsc" `role="status"` with the RSVP button still enabled. (5 baseline failures in this file are pre-existing — record them, do not fix.)
    - `src/test/AdminTermsPage.test.tsx:15-24, 52-53`: fixture gains `location`/`capacity`; "Miejsca" renders "3 / 10" so `getByText("3")` still matches only Signups; "—" for a null location.
  - [x] 8.2 `TermCard.tsx` props and location/capacity block (reuse `buildMapsUrl`; `TermPlaceLine` may be reused if its markup fits the krag eyebrow layout, otherwise inline markup with tokens).
  - [x] 8.3 `PublicTermView.tsx` (`:224`) passes the new props.
  - [x] 8.4 `AdminTermsPage.tsx:33-60` columns and cells.
  - [x] 8.5 Ensure the group's tests pass: `cd src/frontend && npm test -- src/test/TermPage.test.tsx src/test/AdminTermsPage.test.tsx src/test/themeTokenUsage.test.tsx src/test/themeDefects.test.tsx`; `npx tsc -b`; `npm run lint`.

**Acceptance Criteria:**
- New TermPage and AdminTermsPage cases pass; theme-token tests pass; the TermPage baseline failures are unchanged in number (5).
- RSVP footer untouched; capacity is informational only.
- Implementation matches each `acceptance` criterion declared above.

---

### Task Group 9: Final integration — full suites, lint, types, mypy delta, docs follow-ups
**Dependencies:** All previous groups (1–8)
**Files to Modify:** `.maister/docs/project/architecture.md` (Google Places caching note + `app/locations` BC), work-log; `src/backend/tests/**` / `src/frontend/src/test/**` only to fix regressions found by the full run (max 10 additional tests)
**Estimated Steps:** 6

- [x] 9.0 Review and fill critical gaps
  - [x] 9.1 Review the tests written in Groups 1–8 (~40–52) against spec §11 success criteria; list uncovered criteria.
  - [x] 9.2 Analyse gaps for THIS feature only (e.g. 0058-then-0057 downgrade order already covered; check the `/mine` idempotency test `test_groups.py:~340` still passes; `GET /api/groups` list batching; Esc rule; `?nowa=grupa` strip).
  - [x] 9.3 Write up to 10 additional strategic tests only where 9.1 found a hole.
  - [x] 9.4 Full backend run: `cd src/backend && uv run python -m pytest -q`; `uv run python -m ruff check`; `uv run python -m mypy app` (report the delta vs the ~32 baseline; must not regress). Full frontend run: `cd src/frontend && npm test`; `npm run lint`; `npx tsc -b`. Expected remaining failures: only the pre-existing TermPage ×5 and OrganizerEditor ×2 flaky; everything else green.
  - [x] 9.5 Docs: `.maister/docs/project/architecture.md` — add `app/locations` BC and the Google caching statement (place_id indefinitely; address/lat/lng cached, refresh out of scope; backend never calls Google). Record follow-ups in the work-log: `/maister:standards-update` for `models.md` (UUID PKs, soft delete, no relationships in groups BC), `migrations.md`, `testing/backend-testing.md` (pytest + testcontainers), `security.md` test-suite note; notifications place text; organizer public pages; possible deletion of `FirstTermStepperOrganizer`.
  - [x] 9.6 Secrets sweep: `git diff --stat` + grep the diff for `AIza` and `VITE_GOOGLE_MAPS_API_KEY=` followed by a non-empty value — zero hits; `.env` not staged.

**Acceptance Criteria:**
- Full backend suite green; full frontend suite green except the 7 documented baseline failures; lint/tsc/ruff green; mypy count ≤ baseline.
- No more than 10 additional tests added.
- No secret value in the diff, work-log or reports.

---

### Task Group 10: Frontend — "Moje miejsca" management view + compact select in forms (scope addition, user-approved 2026-10-20)
**Dependencies:** 1–9
**Files to Modify:** `src/frontend/src/components/shared/LocationPicker.tsx` (slimmed to select + "+"), new `src/frontend/src/components/shared/LocationAddForm.tsx` (extracted add form: Google combobox + manual, reused by picker and view), new `src/frontend/src/pages/panel/views/MiejscaView.tsx`, `src/frontend/src/pages/panel/panelHelpers.ts` (`View` + `"miejsca"`), `src/frontend/src/pages/panel/PanelDataContext.tsx` (`VIEW_VALUES` only), `src/frontend/src/pages/panel/PanelPage.tsx` (render branch), `src/frontend/src/components/shared/AccountMenu.tsx` ("Moje miejsca"), tests: `src/test/LocationPicker.test.tsx`, new `src/test/MiejscaView.test.tsx`, `src/test/PublicLayout.test.tsx`, plus minimal updates in host tests that relied on in-form edit/delete
**Decisions (user):** management (list, add, edit, delete) lives only in the new view `/panel/miejsca`; forms keep a select + "+" button that expands the add form inline (no nested sheet); entry point only in AccountMenu ("Moje miejsca", next to Profil/Ustawienia/Moja rodzina). Public `attendee_count` stays (B11 confirmed). Backend unchanged.

- [x] 10.0 Complete the locations view
  - [x] 10.1 Tests first: `MiejscaView.test.tsx` (list renders name/address/notes; empty state; add manual; edit name/notes, address only for MANUAL "(z Google)"; delete with confirm alertdialog; Google mode add via mocked lib) and rewrite `LocationPicker.test.tsx` for the compact picker (select lists "Brak…" + own places + "(usunięte)" fallback; "+" expands add form with `aria-expanded`; save selects the new id and collapses; Esc in combobox closes only the listbox; no Edytuj/Usuń buttons in the picker); `PublicLayout.test.tsx` menu order/count incl. "Moje miejsca" → `/panel/miejsca`.
  - [x] 10.2 Extract the add form (Google combobox + manual fallback, session tokens, Esc rule, alert fallback) from `LocationPicker.tsx` into `LocationAddForm.tsx` with `onSaved(location)` / `onCancel`.
  - [x] 10.3 `LocationPicker` → native `<select>` (label via host Field / `aria-label` = `label`, `helperText` kept, same public props `value/onChange/label/noneLabel/idPrefix/fallbackLocation?/helperText?`) + "+" button (`aria-label="Dodaj nowe miejsce"`, `aria-expanded`, `aria-controls`) toggling inline `LocationAddForm`; on save `onChange(id)`, collapse, focus back to the select. Remove edit/delete UI and `DeleteLocationDialog` from the picker.
  - [x] 10.4 `MiejscaView.tsx`: `h1`/`h2` "Moje miejsca", list of own places (name bold, address, notes), per-row "Edytuj"/"Usuń" (moved edit row + delete alertdialog with `useRegisterOpenSheet`, trapFocus, focus management), "+ Dodaj miejsce" disclosure with `LocationAddForm`, empty state copy "Nie masz jeszcze zapisanych miejsc.", loading/error states; tokens only, phone-first.
  - [x] 10.5 Wire view: `View` + `VIEW_VALUES` + `PanelPage` branch; `AccountMenu` item "Moje miejsca" (`Link role="menuitem"`, `to="/panel/miejsca"`, `MapPinIcon`, between "Moja rodzina"/"Ustawienia" group per existing order — place after "Ustawienia", before "Załóż grupę").
  - [x] 10.6 Update host tests that used in-picker list/radio interactions (PanelPage, CreateGroupStepper, EditTermDialog, FirstTermStepperOrganizer) to the select — update assertions, never loosen.
  - [x] 10.7 Verify: group tests + host tests; full `npm test` (baseline 6 failures only); `npx tsc -b`; `npm run lint` (16 problems baseline, delta 0).

**Acceptance Criteria:**
- Forms show only select + "+"; edit/delete exist only in "Moje miejsca".
- No nested modal; Esc rule preserved; every blocking dialog registers via `useRegisterOpenSheet`.
- Full frontend suite: only the 6 documented baseline failures; tsc green; lint delta 0.

## Execution Order

1. Group 1 — Backend locations BC + 0057 + matrix (8 steps) — parallel with Group 4
2. Group 4 — Frontend data layer + env plumbing (8 steps, no dependency)
3. Group 2 — Backend 0058 + ACL + group defaults (8 steps, depends on 1)
4. Group 5 — Frontend LocationPicker / GroupFormFields / TermPlaceLine (7 steps, depends on 4)
5. Group 3 — Backend terms inheritance + public reads (8 steps, depends on 2)
6. Group 6 — Term forms + AccountMenu (6 steps, depends on 5) — parallel with Group 8
7. Group 8 — Public term page + AdminTermsPage (5 steps, depends on 5)
8. Group 7 — Panel restructure + stepper (10 steps, depends on 5, 6)
9. Group 9 — Final integration (6 steps, depends on all)
10. Group 10 — Moje miejsca view + compact picker (7 steps, scope addition)

Shared-file serialization: Groups 2 and 3 both edit `app/groups/schemas.py` (serialized by the chain). Groups 4, 5 and 7 touch `panelHelpers.ts`/`SpotkaniaView.tsx` in disjoint regions but are chained anyway. Groups 6 and 8 share no files.

## Standards Compliance

Follow standards from `.maister/docs/standards/` (see spec §9.2 for the per-standard mapping):
- global/ — error-handling (typed 404/403/409), validation (server-side shape validation), minimal-implementation (nothing from spec §5.2 "Not created"), conventions (`.env` ignored, placeholders only, `@types/google.maps` dev-only), coding-style, commenting
- backend/ — api (plural nouns, `/mine`, 201/204), models (`Mapped[]`, string enums, plain FK ids, `Numeric(9,6)`, no `__eq__`; **PK/soft-delete sections stale — follow the code**), migrations (hand-written, reversible, named constraints; **PK guidance stale**), queries (batched `IN`, no N+1, budgets), security (`ReadPrincipal`/`EditPrincipal`, matrix rows before catch-all with a test), time (`datetime.utcnow()` for `deleted_at`; `clock.local_now()` only; guard test)
- frontend/ — data-fetching (hook in `src/hooks/`, prefix key, token in key, `await invalidateQueries`, `dayjs` from `utils/dayjs.ts`), components, accessibility (§7.11; `useRegisterOpenSheet` on every blocking dialog), css/responsive (tokens only, phone-first)
- testing/ — frontend-testing (explicit Vitest imports, `createQueryWrapper`, `vi.mock` factories, `vi.resetAllMocks()`, pinned Date where a weekday matters); backend-testing is stale — follow `tests/conftest.py`

## Notes

- Test-Driven: each group starts with 2–8 tests (X.1) and ends by running only those files (X.n); the full suites run once in Group 9.
- Run Incrementally: never run the whole suite inside Groups 1–8; backend tests need Docker (testcontainers).
- Mark Progress: check off steps as completed; the executor marks checkboxes, implementers do not.
- Reuse First: templates are named per step (organizations module, `0054`/`0056`, `organizations_acl.py`, `useCategories`/`useMyOrganization`, `ColorsTab` radiogroup, `EditTermDialog` rows, `DeleteGroupDialog`).
- Exact-arg assertions must be updated together with the code, never loosened.
- Secrets: see the preamble — repeat it in every subagent prompt.
