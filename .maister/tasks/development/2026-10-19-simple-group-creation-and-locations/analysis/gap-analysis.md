# Gap Analysis: Simple group creation + Location entity (Google Places)

**Date**: 2026-10-19
**Inputs**: `task-description.md`, `analysis/codebase-analysis.md`, `analysis/clarifications.md`, spot checks in `src/backend/app/groups/*`, `src/frontend/src/pages/panel/*`, `src/frontend/src/components/panel/*`.
Paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`.

## Summary

- **Risk Level**: Medium-High
- **Estimated Effort**: High (two scopes; ~25 production files modified, ~10 new; ~20 test files touched)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy
- Nothing in scope exists on the backend for locations/capacity (grep `locations` in `src/backend/app` hits only an unrelated comment). Scope A is a restructuring of an existing flow whose building blocks all exist. Scope B is a brand-new entity with a new external integration, plus two columns on each of `groups` and `terms`.
- Phase 1 decisions already fix the four biggest contradictions (`k-<hash>` slugs, `/mine/new` + explicit visibility, notifications deferred, `app/locations` module + hand-written Maps loader). This report lists the remaining open points as decisions.

## Task Characteristics

- Has reproducible defect: no (the `groupExtras` "disappears on refresh" behaviour is a known placeholder, not a defect to reproduce)
- Modifies existing code: yes (panel data model, steppers, modals, group/term schemas and use cases)
- Creates new entities: yes (`Location` backend module, `LocationPicker`, `api/locations.ts`, `useMyLocations`, Maps loader, env plumbing)
- Involves data operations: yes (Location CRUD with soft delete; group defaults; term copy semantics)
- UI heavy: yes (stepper rewrite, 6 forms gain a picker, 4 display surfaces, hints, hamburger)

---

## Gaps Identified: current vs desired per scope item

### Scope A: group creation

| # | Desired | Current (evidence) | Gap | Change type |
|---|---|---|---|---|
| A1 | "Załóż grupę" entry for every logged-in user: home, Spotkania, hamburger | Home: hint "Dodaj swój pierwszy termin" only when `!isOrganizer` (`HomeView.tsx:70-83`); Spotkania: "+ Dodaj grupę" only inside the `isOrganizer` branch (`SpotkaniaView.tsx:158-176`); hamburger `AccountMenu.tsx:55-75` has Profil/Ustawienia/Moja organizacja/Mój dom, no group item; `GhostBlock.tsx:50` CTA "Dodaj grupę →" to `/panel/spotkania` | Add a persona-independent entry in all three places; the "+ Dodaj grupę" button must leave the organizer-only branch | modificative |
| A2 | 2-step stepper: group (name + optional default location + capacity) -> first term (date, description, location + capacity prefilled) | `FirstTermStepperGuest.tsx`: optional org step (`withOrganizationStep`) -> circle name via `createMyCircle` (POST `/mine`, no visibility) -> term via `createTerm({circle_group_id, occurs_on, description})`; `FirstTermStepperOrganizer.tsx`: 1-step term for `myGroups[0]` | Remove org step; switch to `createAdditionalMyCircle` (`/mine/new`) with `visibility` + `default_location_id` + `default_capacity`; term step sends `location_id`/`capacity` prefilled from step 1; new fields need the picker inline inside the panel `ModalSheet` | modificative |
| A3 | Default visibility PRIVATE without org, PUBLIC with org, user-editable | `groupForm.visibility: "PUBLIC"` (`PanelDataContext.tsx:305-310`); backend default PUBLIC (`models.py:113-125`); `/mine` ignores visibility; `organizationSlug` loaded at `PanelDataContext.tsx:416-422` is the "has an Organization" signal | Frontend-only: compute default from `organizationSlug === null`; add visibility select to the stepper step 1 (the "grupa" modal already has one at `PanelModals.tsx:170-185`). Decided in Phase 1: backend default unchanged | additive (FE) |
| A4 | Organization as optional follow-up ("Stwórz wizytówkę"), offered on the done screen | Done screen (`FirstTermStepperGuest.tsx:105-127`) has only the public-term link and "Gotowe"; org creation lives in the stepper's org step, `OrganizationPage.tsx:68` (`/organization`, name form) and onboarding `organizerSteps.tsx` | Add CTA on done screen; remove org step. Target of CTA is an open decision (D-important-3) | modificative |
| A5 | Public group/term page works without slug; all links use the fallback | Backend always returns `k-<hash>` (`domain/organizer_slug.py`); guards `?? "krag"` exist in `panelHelpers.ts:110`, both steppers, `PublicTermView.tsx:191`; `HomeView.tsx:190` "Zapisane zajęcia" links use `a.organizer_slug` without guard | Decided: keep `k-<hash>`. Only gap: no code change required beyond keeping guards; verify `MyAttendanceResponse.organizer_slug` is never null (backend derives it) | none / verify |
| A6 | Panel shows led and attended groups at once; hints no longer either/or | `load()` at `PanelDataContext.tsx:455-470` is mutually exclusive (`myGroups` XOR `guestCircles`); `relevantGroupsForForm = isOrganizer ? myGroups : guestCircles` (`:1091`); `HomeView.tsx:133` and `SpotkaniaView.tsx:128,158` branch on `isOrganizer`; `guestTerms` memo merges `myAttendances` only for non-organizers (`SpotkaniaView.tsx:127-156`); 4 hint cards keyed by `isOrganizer` (`HomeView.tsx:70-119`) | Restructure `load()` to populate both lists independently; term loading (`getTerms` + `getNeededItems` per group) must cover led groups while attended terms come from `myAttendances`; view branches become per-card (`organizerTermCard` for led groups, Link card for attended); hint matrix redesigned (see User Journey). How to present both contexts is D-important-4 | modificative (largest FE change) |
| A7 | "organizator" only as a per-group role | Status-level wording: `FirstTermStepperGuest.tsx:20-27,102` ("Zostań organizatorem"), `PanelModals.tsx:92-104` (modal kind + toast "Jesteś organizatorem — dodano pierwszy termin"), `panelHelpers.ts:29` (`"zostan-organizatorem"`), `HomeView.tsx:85-94` ("Możesz zostać organizatorem"). Per-group role wording stays (`PrivateGroupGate`, `GroupHeader`, `TermCard:31`, `RegisterPage` etc.) | Remove/rename the modal kind, toast and hint; keep `isOrganizer` as an internal derived flag only where it still means "leads at least one group" | modificative |

### Scope B: Location entity and Google Places

| # | Desired | Current (evidence) | Gap | Change type |
|---|---|---|---|---|
| B8 | `Location` entity + `GET /api/locations/mine`, `POST`, `PATCH /{id}`, `DELETE /{id}` (soft), owner-scoped, partial unique (owner, google_place_id) | No module, no table, no matrix row (`authorization_matrix.py` catch-all at `:248`), no router registration in `main.py:146-160` | New `app/locations/{models,schemas,service,router}.py`, migration 0057, matrix rows before the catch-all, `main.py` include before `system_router`. Templates: `app/organizations/*` (PATCH via `model_fields_set`, 404-then-403), `0054_organization_media.py` (UUID PK, partial unique via `postgresql_where`), `circulation/application/inventory.py:40-70` (SAVEPOINT + IntegrityError re-fetch) | additive (new BC) |
| B9 | `Group.default_location_id`, `default_capacity`; in `GroupResponse` (nested `LocationResponse`), `CreateOwnCircleRequest`, PATCH | `Group` has no such columns (`models.py:97-131`); `GroupResponse` 8 fields (`schemas.py:31-41`); `UpdateGroupRequest` requires `name`, applies only non-None (`schemas.py:72-81`, `circles.py:220-247`); `create_additional_circle` is the only place honouring visibility (`circles.py:93-122`) | Migration 0058, model columns, schema fields (`default_location: LocationResponse \| None` attached after `model_validate`, same pattern as `organizer_slug` at `router/circles.py:69-71,84-86,104-106`), `create_additional_circle` accepts defaults, ownership check of `default_location_id` via `locations_acl`. PATCH clearing semantics is D-important-1 | additive + modificative |
| B10 | `Term.location_id`, `capacity`; copied from group defaults at creation; in `TermResponse`, `CreateTermRequest`, `UpdateTermRequest`, `ModerationTermResponse` | `Term` has `circle_group_id`, `occurs_on`, `description` only (`models.py:221-239`); `create_term` (`terms.py:32-44`) copies nothing; `update_term` applies only non-None (`:122-125`); `list_terms_for_moderation` builds the response field by field (`:95-109`) | Copy-at-create in `create_term` (group is already loaded there); location ownership validation; batched location attach on list endpoints (query budgets `test_organizer_page_queries.py:25-26`); moderation response gets `location`/`capacity`. Clearing semantics is D-important-1 | additive + modificative |
| B11 | Public reads return `LocationResponse` without `owner_party_id` | `PublicTermResponse` = id, occurs_on, description, needed_items, item_listings (`schemas.py:284-289`); PRIVATE reduced branch returns `term=None` (`public_view.py:226-240`) | Add `location: PublicLocationResponse \| None`, `capacity: int \| None` to `PublicTermResponse`; allowlisted mapper in `locations_acl.py` (template `organizations_acl.public_organization`). `attendee_count` on the public term is D-important-2 | additive |
| B12 | Google Places Autocomplete via `VITE_GOOGLE_MAPS_API_KEY`, session tokens, manual fallback, no backend Google calls, Maps link | Nothing reads `import.meta.env`; no `src/frontend/src/vite-env.d.ts`, no `src/frontend/.env*`, no `ARG`/`ENV` in `src/frontend/Dockerfile`, no `VITE_` in `docker-compose.yml` or `.env.example` (verified by grep); no script loader exists | New loader (`libraries=places`, injected on first interaction), `vite-env.d.ts`, `.env.example` placeholder, Dockerfile `ARG` + compose `build.args`; `@types/google.maps` devDependency; backend validates only shape (`google_place_id` max length, lat in [-90,90], lng in [-180,180], source/place_id/coords consistency) | additive |
| B13 | Shared `LocationPicker` (saved list, add via Google or manual, inline edit/delete, empty state = search) used in 6 forms | No combobox/autocomplete anywhere; closest precedents `role="radiogroup"` grids (`ColorsTab.tsx:53`) and inline edit/delete list in `EditTermDialog.tsx:181-280,329-429`; panel `ModalSheet` lacks trapFocus/Esc (`panelComponents.tsx:167`) so the picker must be inline, not a nested panel sheet | New `components/shared/LocationPicker.tsx` + `api/locations.ts` + `hooks/useMyLocations.ts`; integrate into "grupa", "edit-grupa", stepper step 1 and 2, "termin" modal, `FirstTermStepperOrganizer`, `EditTermDialog` | additive + modificative |
| B14 | Group form fields persist to backend; delete `groupExtras` | `groupExtras` state at `PanelDataContext.tsx:293`, read `:935`, exported `:1144`, consumed `SpotkaniaView.tsx:85,183`; `editGroupForm.location/freeSpots` are strings/numbers (`:202-208`); `updateGroupLayoutMode(id, name, layoutMode, visibility?)` is the only PATCH caller (`api/groups.ts:126-139`) | Replace with `default_location_id`/`default_capacity` in the create/update requests; `saveEditGroup` (`:954-984`) sends them; tiles read `group.default_location`/`default_capacity` | modificative |
| B15 | Term forms prefilled from group defaults, editable | Add-term form state `PanelDataContext.tsx:313-319` has no location/capacity; `EditTermDialog` state `:122-128` only `occursOn`/`description` | Prefill on group selection (`relevantGroupsForForm` select) and on stepper step transition; EditTermDialog shows current term values (not group defaults) | modificative |
| B16 | Display name, address, Maps link, capacity (+ signed-up count when available) on public term page, panel cards, AdminTermsPage; read from term, never group | `TermCard.tsx` takes `{date}` only; `organizerTermCard` (`PanelDataContext.tsx:851-930`) and guest card (`HomeView.tsx:134-163`, `SpotkaniaView.tsx:287-321`) show date/description/needed items; `AdminTermsPage.tsx:33-60` columns Date/Circle/Description/Signups/Children; SpotkaniaView group tile shows `extra.location` + "wolne N miejsca" (`:220-229`) | Add a `TermPlaceLine`-style display (name, address, "Otwórz w Google Maps") reused across surfaces; capacity line hides when null; `SpotkaniaView` attended-term literals (`:127-156`) need the new nullable fields. Notifications excluded (Phase 1 Q3) | additive |
| B17 | Informational "Brak wolnych miejsc" when `attendee_count >= capacity`; RSVP not blocked | No count on the public response; `guardians[]` includes withdrawn attendances (`repository.py:452-458` `list_attendances_for_term` has no `withdrawn_at` filter; docstring at `:463-465` confirms "keeps withdrawn rows"), so `guardians.length` overcounts | Needs an active count on the public term (D-important-2); message in `TermCard`/`TermFooter`; `create_rsvp` untouched | additive |

### Behavioural changes to existing code (regression-sensitive)

- `create_term` gains copy-from-group logic: every existing test that creates a term still passes (defaults null -> copies null) as long as inheritance only fires when the request omits the field.
- `UpdateGroupRequest`/`UpdateTermRequest` semantics change if `model_fields_set` is adopted (D-important-1): `extra="forbid"` would reject unknown keys that today are silently ignored; check `PanelPage.test.tsx:1314,1522-1580` exact-arg assertions.
- `PanelDataContext.load()` stops zeroing `guestCircles` when leaderships exist; every PanelPage test that relies on "organizer sees no guest cards" needs review (`:597-700` hints, `:1646-1867` links).
- Stepper exact-arg assertions (`createMyCircle({name:"Nutki"})` at `PanelPage.test.tsx:507`; `createTerm` exact objects at `:522-528,1476-1482`) break by design: the stepper now calls `createAdditionalMyCircle` with visibility and defaults and `createTerm` with `location_id`/`capacity`.

---

## User Journey Impact Assessment

### Journeys

| Journey | Current path | Desired path | Assessment |
|---|---|---|---|
| J1. New user creates first group | Home hint "Dodaj swój pierwszy termin" (only when `!isOrganizer`) -> Guest stepper: [org name] -> group name -> term -> done link | Home hint / Spotkania button / hamburger "Załóż grupę" -> step 1 (name, visibility default PRIVATE, optional place + capacity) -> step 2 (term with prefilled place/capacity) -> done (public link + "Stwórz wizytówkę" CTA) | Positive: one fewer step, three entry points instead of one conditional hint. Watch: step 1 now holds 4 inputs plus a picker; the picker's empty state (search field) must not make "name only" look incomplete. Discoverability 6/10 -> 9/10 |
| J2. Existing organizer adds another group | Spotkania "+ Dodaj grupę" -> "grupa" modal (`name`, local-only location/capacity, visibility) | Same entry plus hamburger; "grupa" modal uses LocationPicker + persisted capacity; default visibility PUBLIC when org exists | Neutral-positive. Open: whether the "grupa" modal and the stepper step 1 share one form component (D-important-6) |
| J3. User adds a location via Google | n/a | In any form: "+ Dodaj nowe miejsce" -> autocomplete (lazy-loaded script, session token) -> pick suggestion -> label + notes -> POST -> selected | New UI pattern for this codebase (first combobox). Risks: Esc inside the Google dropdown must not close the sheet; `pac-container` is rendered outside the sheet DOM so focus trapping in krag `ModalSheet` must tolerate it; duplicate place_id handling (D-important-5) |
| J4. User adds a location manually | n/a | "wpisz ręcznie" or no key -> name + address + notes -> POST source=MANUAL | Must be the complete fallback in tests/CI (no key). Address required? Brief lists `formatted_address` as non-null in the entity, so manual mode needs an address field; recommend required non-blank |
| J5. Term creation inheriting defaults | Term modal: pick group, date, description | Term modal: pick group -> picker preselects `group.default_location`, capacity prefilled; user may change; backend copies on omission | Two inheritance paths (frontend prefill AND backend copy). Both are needed: the frontend prefill makes the value visible/editable; the backend copy covers API callers that omit the field. Edge: a user who explicitly clears the prefilled field in the form expects "no place" but the backend would copy the default again if the field is omitted — the frontend must send an explicit `null` and the backend must distinguish omitted from null (ties to D-important-1) |
| J6. Public visitor views location/capacity | Public term page shows date, description, attendees, RSVP | Adds place line with Maps link and "N/M miejsc" or "Brak wolnych miejsc" | Positive. PRIVATE group without access: reduced branch returns `term=None`, so nothing leaks. Edge: soft-deleted location still renders (lookup by id ignores `deleted_at`) |
| J7. Deleting a referenced location | n/a | DELETE -> soft delete -> vanishes from picker list; existing groups/terms keep FK and render the stored name/address | Correct per brief. UX gap: the picker should not offer delete without a confirm (precedent `DeleteGroupDialog.tsx`), and a group whose default location was deleted shows it as selected-but-not-in-list — picker needs a "(usunięte)" row for the currently selected id when it is absent from `/mine` |

### Dimensions

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability (group creation) | 1 conditional hint for guests; organizers via Spotkania only | Home hint, Spotkania button, hamburger item, for everyone | Positive (+1) |
| Discoverability (group creation) | 6/10 | 9/10 | +3 |
| Discoverability (locations) | n/a (local text field) | 7/10: inline picker in every group/term form; add flow one click away | Good |
| Flow integration | Org step blocks guests; panel either/or | Org optional; panel shows both | Positive |
| Multi-persona | Guest and organizer get different panels; GUEST cannot reach "+ Dodaj grupę" | Same panel for everyone; "organizator" is per group | Positive; moderation (AdminTermsPage) gains capacity/location columns |

---

## Data Lifecycle Analysis

### Entity: Location (new)

Three-layer verification executed now (grep for `locations` in backend `app/`, `api/locations`, `LocationPicker` in frontend): nothing exists at any layer. All four operations are in scope, so no orphan remains after implementation, provided every row below is built.

| Operation | Backend | UI component | User access | Status today | Planned |
|---|---|---|---|---|---|
| CREATE | none | none | none | missing | POST `/api/locations`; "+ Dodaj nowe miejsce" inside LocationPicker; reachable from all 6 forms |
| READ (own list) | none | none | none | missing | GET `/api/locations/mine` (filters `deleted_at IS NULL`); saved list in picker |
| READ (by reference) | none | none | none | missing | `locations_acl.get_locations_by_ids` including soft-deleted; rendered on term/group surfaces |
| UPDATE | none | none | none | missing | PATCH `/api/locations/{id}` (`model_fields_set`, 404/403); inline edit row in picker (pencil) |
| DELETE | none | none | none | missing | DELETE 204 soft; trash icon in picker with confirm |

Planned completeness: 100% if the inline edit/delete rows are actually shipped in the picker (brief item 13 requires them; do not defer them, otherwise UPDATE/DELETE become orphaned backend operations).

**Lifecycle rules to specify**:
- Soft delete sets `deleted_at` (naive UTC `datetime.utcnow()` per `standards/backend/time.md`); list endpoint excludes; by-id lookups used by groups/terms include deleted rows; PATCH/DELETE on a deleted row -> 404.
- Partial unique on `(owner_party_id, google_place_id) WHERE google_place_id IS NOT NULL` — whether it also requires `deleted_at IS NULL` is D-important-5 together with POST duplicate behaviour.
- `source` consistency: GOOGLE requires `google_place_id` and lat/lng; MANUAL forbids `google_place_id` (coordinates optional, out of scope to capture). Validate in the Pydantic request model.
- PATCH must not allow changing `google_place_id`/`source` (it would break the identity of the cached place); editable: `name`, `notes`, and for MANUAL rows `formatted_address`.
- Google cache terms: `google_place_id` may be stored indefinitely; `formatted_address`, `lat`, `lng` are subject to Google's caching limits (30 days for coordinates under current Places terms); refresh is out of scope and must be documented in the module docstring and project docs. Store `updated_at` already provided by `BaseEntity` as the cache timestamp.

### Entity: Group defaults

- `default_location_id` (FK `locations.id`, nullable, `ON DELETE` none — soft delete only), `default_capacity` (nullable int, validate `>= 1`, upper bound e.g. 10000).
- Migration adds nullable columns; existing rows become null; UI hides the rows when null (brief risk list).
- Ownership: `default_location_id` must belong to the caller's `profile.party_id` (not the group's ORGANIZATION `Party`). Note the two different Party ids in play: `Group.party_id` is the per-circle organization party; `Location.owner_party_id` is the human's PERSON party. The ACL must compare against the caller's party.

### Entity: Term location/capacity

- Copy semantics: at `create_term`, if `location_id` was omitted copy `group.default_location_id`; if `capacity` omitted copy `group.default_capacity`. Later group changes never propagate. Must distinguish omitted vs explicit null (D-important-1).
- Reads: `TermResponse.location` attached via one batched `IN` lookup per list endpoint (`router/terms.py:46-64` pattern); `get_term`/PATCH responses attach a single lookup.
- Migration: nullable columns, no backfill.

### Migration plan (two chained revisions)

- `0057_locations`: table (UUID PK `gen_random_uuid()`, `owner_party_id` FK `parties.id`, `name` VARCHAR(255), `formatted_address` VARCHAR(500), `google_place_id` VARCHAR(255) null, `lat`/`lng` NUMERIC(9,6) null, `notes` VARCHAR(500) null, `source` VARCHAR(10), `created_at`, `updated_at`, `deleted_at`), `ix_locations_owner_party_id`, partial unique index.
- `0058_group_term_location_capacity`: 4 columns + 2 named FKs. Downgrade drops FKs and columns before 0057 drops the table; migration tests (`test_group_soft_delete_migration.py` template) cross both.

---

## Integration Points

Backend
- `app/main.py` include `locations_router` before `system_router`.
- `app/core/authorization_matrix.py`: rows `GET ^/api/locations(/.*)?$` READ, `POST ^/api/locations$` EDIT, `(PATCH|DELETE) ^/api/locations/[^/]+$` EDIT before the catch-all; assert in `tests/test_authorization_matrix.py`.
- `app/groups/infrastructure/locations_acl.py`: `get_owned_location(db, id, party_id)` (404/403), `get_locations_by_ids(db, ids)` (incl. deleted), `location_response`, `public_location_response`.
- `app/groups/application/circles.py` (`create_additional_circle`, `update_group`), `terms.py` (`create_term`, `update_term`, `list_terms_with_counts`, `list_terms_for_moderation`), `public_view.py` (`get_public_circle_view`, optionally `list_my_attendances`), routers attach location after `model_validate`.
- `tests/test_domain_clock_guard.py`: any new code under `app/groups/application` and `app/groups/router` must use `clock`/`datetime.utcnow()`; `app/locations` is outside the guard but should follow the same rule.

Frontend
- `api/locations.ts`, `hooks/useMyLocations.ts` (key `["locations", "mine", token]`), `components/shared/LocationPicker.tsx`, `lib/googleMaps.ts` loader, `src/vite-env.d.ts`, `src/frontend/.env.example`, Dockerfile `ARG VITE_GOOGLE_MAPS_API_KEY`, compose `build.args`.
- Types: `api/groups.ts` (`GroupResponse`, `CreateCircleRequest`, PATCH request, `PublicTermResponse`), `api/terms.ts` (`TermResponse`, `ModerationTermResponse`, `CreateTermRequest`, `UpdateTermRequest`), all new fields `| null` / optional so hand-built literals (`SpotkaniaView.tsx:127-156`, test fixtures) keep compiling.
- Panel: `PanelDataContext.tsx` (forms, `load()`, `groupExtras` removal, hints), `PanelModals.tsx`, `HomeView.tsx`, `SpotkaniaView.tsx`, `panelHelpers.ts` (`ModalKind`), `AccountMenu.tsx` (+ `PublicLayout.tsx` passes the panel context? — AccountMenu is rendered by `PublicLayout.tsx:36`, outside the panel provider, so the hamburger item must navigate to a panel route/query that opens the stepper rather than call `setModal` directly).
- Steppers and dialogs: `FirstTermStepperGuest.tsx` (becomes the 2-step "Załóż grupę" stepper), `FirstTermStepperOrganizer.tsx`, `EditTermDialog.tsx`.
- Display: `pages/krag/components/TermCard.tsx` (+ `TermFooter`), `AdminTermsPage.tsx`, panel cards.
- Tests: new `FirstTermStepperGuest.test.tsx`, `LocationPicker.test.tsx`, `useMyLocations.test.tsx`; `vi.mock("../api/locations")` in `PanelPage.test.tsx`, `EditTermDialog.test.tsx`, `FirstTermStepperOrganizer.test.tsx` (+ `createQueryWrapper()`); update exact-arg/exact-title assertions; `AdminTermsPage.test.tsx` `getByText("3")` collisions with a capacity column (use `within(row)` or distinct fixture numbers).

---

## Issues Requiring Decisions

Already decided in Phase 1 (not re-asked): `k-<hash>` slugs; `/mine/new` + frontend-sent visibility; notifications deferred; `app/locations` module + `locations_acl.py`; no text moderation of location fields; hand-written Maps loader with `@types/google.maps`; manual mode when the key is absent.

### Critical (must decide before specification)

None blocking. All remaining points have a workable default; they are listed as important so the orchestrator can confirm them in one pass.

### Important (should decide; defaults given)

1. **PATCH clearing semantics for group defaults and term location/capacity** (`UpdateGroupRequest`, `UpdateTermRequest`)
   - Finding: groups' PATCH applies only `is not None` (`circles.py:243-246`, `terms.py:122-125`); a user can never clear a default place or capacity, and the term form cannot say "no place even though the group has one". `UpdateGroupRequest.name` is required today.
   - Options: (a) switch both requests to `model_fields_set` semantics (omitted = keep, `null` = clear) with `ConfigDict(extra="forbid")`, making `name` optional on `UpdateGroupRequest`; (b) keep "replace only" and accept that fields cannot be cleared; (c) `model_fields_set` only for the four new fields, `name` stays required.
   - Default: (c) — minimal change, keeps `updateGroupLayoutMode` callers valid, and makes `location_id: null`/`capacity: null` clearable. Also apply omitted-vs-null to `CreateTermRequest` so an explicit `null` suppresses inheritance (J5).

2. **`attendee_count` on `PublicTermResponse`**
   - Finding: the brief's "Brak wolnych miejsc" needs active signups; `guardians[]` keeps withdrawn rows (`repository.py:452-465`), so a client-side `guardians.length` overcounts and would show "full" too early.
   - Options: (a) add `attendee_count: int` (active, from `count_active_attendances_by_term`) to `PublicTermResponse`; (b) count client-side from `guardians` after adding a `withdrawn` flag to `PublicGuardianResponse`; (c) filter withdrawn rows out of `guardians` entirely.
   - Default: (a). One extra scalar, computed with the existing batched helper; `test_public_term.py` exact-key sets must be updated in the same change (they break anyway for `location`/`capacity`). Child count is out of scope (brief: "liczba zapisanych").

3. **"Stwórz wizytówkę" CTA target on the done screen**
   - Options: (a) link to existing `/organization` page (`OrganizationPage.tsx`, name form, then `?edit=1` for layout); (b) inline one-field org-name form inside the done screen calling `createMyOrganization` and then reloading `organizationSlug`.
   - Default: (a). Reuses an existing, tested page; no new modal state; the `hint_org_polish` card already points there. Keep the stepper free of organization code.

4. **Panel presentation of both contexts (led + attended)**
   - Finding: Home "Najbliższe terminy" and Spotkania are built around one list; attended terms come from `myAttendances` (`MyAttendanceResponse`), led terms from `getTerms` per group.
   - Options: (a) one merged chronological term list where each card picks its variant by whether the group is led (`myGroups` membership) or attended; (b) two sections ("Prowadzę" / "Jestem zapisany(a)") on both Home and Spotkania; (c) merged list on Home, two sections on Spotkania.
   - Default: (c). Home stays a short "what's next" (3 cards), Spotkania already has "Grupy" and term sections and gains a clear "Zapisane" section. Avoids duplicating the same term when the user leads and attends it (dedupe by term id, led wins).

5. **Partial unique index scope and POST duplicate behaviour**
   - Options for the index: (a) `WHERE google_place_id IS NOT NULL` only (a soft-deleted Google place blocks re-adding the same place); (b) `WHERE google_place_id IS NOT NULL AND deleted_at IS NULL` (re-adding after delete creates a fresh row; old terms keep the deleted row).
   - Options for POST with an existing active place_id: (i) 200 + existing row (idempotent, "or select existing" wording in the brief); (ii) 409 and the frontend selects the existing row from the list; (iii) 200 + existing row and update `name`/`notes` from the request.
   - Default: (b) + (i), implemented with SAVEPOINT + IntegrityError re-fetch (`inventory.py:40-70` precedent). Return 200 vs 201 distinguishes created from reused. The picker should still pre-check its loaded list and select the existing row without a request.

6. **Form unification: "grupa" modal, "edit-grupa" modal and stepper step 1**
   - Options: (a) one `GroupFormFields` component (name, visibility, LocationPicker, capacity) used by all three, state kept by each host; (b) keep three code paths and add the picker to each.
   - Default: (a). Three copies of the same five fields plus picker is the kind of duplication the minimal-implementation standard forbids; `PanelModals.tsx:139-279` already duplicates two of them.

7. **`FirstTermStepperOrganizer` fate**
   - Options: (a) keep the one-step term form, add LocationPicker + capacity prefilled from `myGroups[0]` defaults; (b) delete it and route "first term for an existing group" through the general "termin" modal with the group preselected.
   - Default: (a) for this iteration (its test and the `hint_org_first_term` path exist); mark (b) as follow-up simplification.

8. **Manual-mode address requirement and coordinates**
   - Options: (a) `formatted_address` required non-blank for both sources, lat/lng only from Google; (b) address optional for MANUAL.
   - Default: (a) — the Maps link in manual mode is built from the address, so an empty address yields a dead link.

9. **Where the hamburger "Załóż grupę" lands**
   - Finding: `AccountMenu` is rendered by `PublicLayout`, outside `PanelDataContext`, so it cannot call `setModal`.
   - Options: (a) navigate to `/panel/spotkania?nowa=grupa` and have the panel open the stepper from the query; (b) navigate to `/panel` and rely on the hint.
   - Default: (a).

---

## Defect Analysis

Not applicable (no reproducible defect). The "groupExtras disappears on refresh" is an acknowledged placeholder with a comment at `PanelDataContext.tsx:968`.

---

## Recommendations

1. Specify the backend in two deliverables that can be tested independently: (1) `app/locations` module + 0057 + matrix rows + tests; (2) group/term columns + 0058 + ACL + schema/response changes + inheritance + tests. Both before any frontend work.
2. Build `LocationPicker` first in manual mode with a full test, then add the Google path behind `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` with `vi.stubEnv` + fake `window.google` tests. The picker must render inline (no nested panel `ModalSheet`); if an "add place" sub-sheet is wanted, use krag `ModalSheet` and `preventDefault` Esc while the Google dropdown is open.
3. Make every new TS field nullable/optional and ship the type changes together with fixture updates so `npx tsc -b` keeps passing.
4. Restructure `PanelDataContext.load()` before touching views: compute `myGroups` and `guestCircles` independently, derive `terms` for led groups, keep attended terms from `myAttendances`; then remove `groupExtras` and `relevantGroupsForForm`.
5. Keep the slug guards; verify `HomeView.tsx:190` and other link builders handle `organizer_slug` the same way as `termPublicPath`.
6. Document the Google cache rule and the "no server-side geocoding" decision in `app/locations/__init__.py` docstring and in `.maister/docs/project/architecture.md`.
7. Security: `VITE_GOOGLE_MAPS_API_KEY` is a build-time public value, referrer-restricted; never print it; `.env.example` entries hold an empty placeholder only.
8. Follow-up standards update (not part of this task): `models.md` (UUID PK, soft delete exists), `migrations.md`, `backend-testing.md`.

## Risk Assessment

- **Complexity risk**: High. Two scopes across DB/API/ACL/three frontend surfaces and a 1221-line stateful context; mitigated by strong templates (`organizations`, `0054`/`0056`, `organizations_acl`).
- **Integration risk**: Medium-High. First external script dependency; must degrade to manual mode; Docker build args and env typing are new; focus-trap interaction with Google's `pac-container`.
- **Regression risk**: High on tests, medium on behaviour. ~10 backend files with exact-key/exact-text/query-budget assertions and ~12 frontend test files with exact-arg assertions break by design; `create_term` inheritance and PATCH semantics change must keep all existing calls that omit the new fields behaving identically. Query budgets (`test_organizer_page_queries.py`) require batched location lookups from day one.
- **Data risk**: Low. All new columns nullable, no backfill; soft delete only; FK integrity preserved.
