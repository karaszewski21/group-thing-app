# Specification: Simple group creation for any logged-in user + Location entity (Google Places / manual) on groups and terms

**Task path**: `.maister/tasks/development/2026-10-19-simple-group-creation-and-locations`
**Inputs**: `task-description.md`, `analysis/requirements.md`, `analysis/codebase-analysis.md`, `analysis/gap-analysis.md`, `analysis/clarifications.md`, `analysis/scope-clarifications.md`, `analysis/technical-clarifications.md`, `analysis/design-context/INDEX.md` + `ascii/ui-mockups.md`.
**Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy. Risk: medium-high.
Paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`. Backend `src/backend/app`, frontend `src/frontend/src`.

Secrets rule (binding for every implementer and subagent): never print `VITE_GOOGLE_MAPS_API_KEY` or any `.env` content; `.env` stays git-ignored; only `.env.example` files with empty placeholders are tracked; presence checks only.

---

## 1. Goal

A. Any logged-in user founds a group in one 2-step flow ("Załóż grupę": group -> first term) without naming an organization and without the word "organizator" as an account status; the organization/public page becomes an optional follow-up. The panel shows led and attended groups at the same time.

B. A new owner-scoped `Location` entity (Google Places or manual, soft-deletable) is saved once and reused from a shared `LocationPicker` on groups (default place + default capacity) and terms (place + capacity copied by value from the group at creation, overridable). Place and capacity are displayed on the public term page, panel term cards, Spotkania tiles and the admin terms table; capacity is informational ("Brak wolnych miejsc" never blocks RSVP).

## 2. User Stories

- As a logged-in user without groups, I want to tap "Załóż grupę", name the group and set the first term, so that I get a shareable public link in two steps without creating an organization.
- As a group founder, I want my group to be private by default (public when I already run an organization) and to be able to change this in the form.
- As a user who leads one group and attends another, I want the panel to show both so that I do not lose either context.
- As a group leader, I want to search a place in Google (or type it by hand), label it, and pick it from a list for every later group and term, so that I never retype an address.
- As a group leader, I want a term to start with the group's default place and capacity but be able to override or clear them per term.
- As a visitor of a public term page, I want to see where the meeting is (with a Google Maps link) and whether there are free places, while still being able to sign up.
- As a moderator, I want to see place and "signed/capacity" per term in the admin table.

## 3. Core Requirements

Numbered to match the brief (A1–A7, B8–B17). "Decided" notes carry the clarifications that reinterpret the brief.

### Scope A: founding a group

- **A1. Entry "Załóż grupę" for every logged-in user** in three places: Home hint card and Spotkania section header button (inside the panel), and the `AccountMenu` hamburger item on **public pages only** (`AccountMenu` is rendered by `components/layout/PublicLayout.tsx:36`; the `/panel` routes are not under `PublicLayout` and have no hamburger — `router.tsx:78-102`). The hamburger item deep-links to `/panel/spotkania?nowa=grupa`, which the panel turns into the open stepper. It replaces every "Zostań organizatorem" label that leads to group creation.
- **A2. Two-step stepper**: step 1 = `GroupFormFields` (name required; visibility; optional default place via `LocationPicker`; optional capacity); step 2 = first term (date/time required, description, place and capacity prefilled from step 1, editable). No organization step. First term stays required (the stepper is not "done" until the term is created). Step 1 calls `POST /api/groups/mine/new` (`createAdditionalMyCircle`); "Wstecz" from step 2 returns to step 1 with the created group kept and saves changes via `PATCH /api/groups/{id}`. Closing the sheet at step 2 keeps the already-created group silently (same as today): it then appears under "Prowadzę" and the "Dodaj swój pierwszy termin" hint nudges the user to add the term; no confirmation dialog on close.
- **A3. Default visibility**: frontend computes `PRIVATE` when the user has no Organization (`organizationSlug === null`), `PUBLIC` otherwise; the user may change it in the form. Backend server default stays `PUBLIC`; `POST /api/groups/mine` is unchanged (still used by registration onboarding). The same default rule applies to the "Dodaj nową grupę" modal.
- **A4. Organization as an optional follow-up**: the done screen shows (only when `organizationSlug === null`) a soft CTA "Stwórz publiczną wizytówkę / własny adres" linking to the existing `/organization` page. No organization code in the stepper.
- **A5. Public link without an organization** (decided reinterpretation of the "/krag/..." criterion): keep backend-derived `k-<hash>` organizer slugs; the public term link is `termPublicPath(group, termId)` = `/${organizer_slug ?? "krag"}/grupa/{groupId}/term/{termId}` and must work for groups without an Organization. No backend slug change. Keep the `?? "krag"` guards; `HomeView` "Zapisane zajęcia" links keep using `organizer_slug` (backend always sets it on `MyAttendanceResponse`).
- **A6. Both contexts at once**: `PanelDataContext.load()` populates `myGroups` (from active leaderships) and the guest side (`myAttendances` = my RSVPs, plus family memberships -> `guestCircles` whose terms are fetched via `getTerms` as today) independently; `guestCircles` is never zeroed because leaderships exist. "Zapisane" = my RSVPs **plus** upcoming terms of `guestCircles` (membership-only, not yet RSVPed), merged and deduped by term id with priority led > attended > membership-only. Home shows a merged top-3 over led + attended + membership-only terms sorted by `occurs_on`, deduped by the same rule. Spotkania shows two sections: "Prowadzę" (groups + led terms, with "+ Załóż grupę" when `myGroups.length === 0` else "+ Dodaj grupę") and "Zapisane" (attended + membership-only terms). Hint matrix reworded by state (section 7.7).
- **A7. "Organizator" only as a per-group role**: remove status-level copy (stepper title, `"zostan-organizatorem"` modal kind, toast "Jesteś organizatorem — …", hint "Możesz zostać organizatorem"). Per-group role copy (`PrivateGroupGate`, `GroupHeader`, `TermCard:31`, `RegisterPage`, `GroupVisualization`, `RequestAccessDialog`, `api/problem.ts:60`) stays. `isOrganizer` remains an internal derived flag meaning "leads at least one group" where still needed (e.g. FAB visibility).

### Scope B: Location entity and Google Places

- **B8. Backend `Location`** in a new bounded context `app/locations/` with `GET /api/locations/mine`, `POST /api/locations`, `PATCH /api/locations/{id}`, `DELETE /api/locations/{id}` (soft). Owner sees and edits only their own rows. Partial unique index on `(owner_party_id, google_place_id)` WHERE `google_place_id IS NOT NULL AND deleted_at IS NULL`. Soft-deleted rows disappear from `/mine` but keep rendering wherever referenced by groups/terms.
- **B9. Group defaults**: `groups.default_location_id` (FK, nullable), `groups.default_capacity` (int, nullable); in `GroupResponse` (nested `default_location: LocationResponse | None`, `default_capacity`), `CreateOwnCircleRequest` (honoured by `/mine/new`), `PATCH /api/groups/{id}` (clearable via explicit `null`).
- **B10. Term fields**: `terms.location_id` (FK, nullable), `terms.capacity` (int, nullable); in `TermResponse` (nested `location`), `CreateTermRequest`, `UpdateTermRequest`, `ModerationTermResponse`. `create_term` copies the group's defaults by value when a field is omitted (explicit `null` = none); later group changes never propagate.
- **B11. Public reads**: `PublicTermResponse` gains `location: PublicLocationResponse | None` (name, formatted_address, google_place_id, lat, lng, notes; never `owner_party_id`), `capacity: int | None`, and `attendee_count: int` (decided: active signups via `count_active_attendances_by_term`). PRIVATE reduced branch (no access) keeps `term=None`.
- **B12. Google integration (frontend only)**: **Places API (New)** only (no legacy `AutocompleteService`/`PlacesService`): lazy hand-written Maps JS loader (`loading=async`, then `google.maps.importLibrary("places")`) injected on first user interaction with the search input; key from `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` (referrer-restricted, build-time public value, read at call time); `AutocompleteSuggestion.fetchAutocompleteSuggestions` with an `AutocompleteSessionToken`, `place.fetchFields` on selection, new token after each selection; no request without user input; manual mode (source `MANUAL`, no place_id/coordinates) when the key is missing, the user chooses "wpisz ręcznie", or the script fails to load. Backend never calls Google; it validates only field shape. Maps link: `https://www.google.com/maps/search/?api=1&query=<urlencoded formatted_address>&query_place_id=<google_place_id>`; omit `query_place_id` for MANUAL rows.
- **B13. Shared `LocationPicker`** (inline, never a nested sheet): saved list (`GET /api/locations/mine`) as a radiogroup with "Brak miejsca" row; "+ Dodaj nowe miejsce" disclosure with Google autocomplete (own combobox/listbox) + label/notes, or manual form; inline edit and delete (with confirm) per row; empty state shows the search input immediately (manual form when no key). Used in: "Dodaj nową grupę", "Edytuj grupę", stepper step 1 and step 2, "Dodaj termin zajęć" modal, `FirstTermStepperOrganizer`, `EditTermDialog`.
- **B14. Group form persists**: "Stałe miejsce spotkań" (picker) and "Ile miejsc" are sent as `default_location_id`/`default_capacity`; `groupExtras` and `editGroupForm.location/freeSpots` string state are deleted; tiles read `group.default_location` / `group.default_capacity`.
- **B15. Term forms prefilled**: on group selection (term modal), on step transition (stepper), and on mount (`FirstTermStepperOrganizer`) the picker preselects `group.default_location?.id` and capacity = `group.default_capacity`; editable; clearing a prefilled value sends an explicit `null`. `EditTermDialog` shows the term's own values (not group defaults).
- **B16. Display** (read from the term, never from the group): place name, address, notes, Maps link and "X/Y miejsc" on the public term page (`TermCard`), led term cards (`organizerTermCard`), attended term cards (address only, no nested anchor), Spotkania group tile (default place name + address; "wolne N miejsca" chip removed), `AdminTermsPage` columns "Miejsce" and "Miejsca" ("3 / 10" string or "—"). Null values hide the row; never render "null". Notifications are NOT changed in this iteration (decided follow-up).
- **B17. Informational capacity**: public page shows "Zapisanych X z Y" and a `role="status"` pill "Brak wolnych miejsc" when `attendee_count >= capacity`; RSVP footer and `create_rsvp` untouched.

## 4. Visual Design

Mockups in `analysis/design-context/` are binding inputs — the implementation-planner will attach `Visual References` to UI task groups. Fidelity: ASCII wireframes (layout, copy, roles, field order and states are binding; spacing/typography follow the existing Tailwind classes named in the mockups). All sources: `analysis/design-context/ascii/ui-mockups.md`.

| ID | Implements | Key elements |
|---|---|---|
| screen:stepper-step1 | A2, A3, B13, B14 | Title "Załóż grupę", 2 dots, `GroupFormFields` (Nazwa grupy, Widoczność grupy select defaulted by org presence, "Stałe miejsce spotkań (opcjonalnie)" picker, "Ile miejsc (opcjonalnie)"), "Dalej →" disabled until name |
| screen:stepper-step2 | A2, B15 | Eyebrow "Pierwszy termin w grupie „<name>"", "Data i godzina", "Opis (opcjonalnie)", "Miejsce" picker prefilled, "Ile miejsc" prefilled, "← Wstecz" / "Dodaj" |
| screen:stepper-done | A4, A5 | Copy without "krąg"/"organizator", "Przejdź do publicznej strony →" (`termPublicPath`), "Gotowe", optional CTA box "Stwórz publiczną wizytówkę / własny adres →" to `/organization` only when no Organization |
| component:group-form-fields | A2, A3, B14 | Controlled `GroupFormFields` (name, optional layout select, visibility, LocationPicker, capacity), `idPrefix`, `aria-label`s equal to labels |
| component:location-picker | B13 | Props `value`, `onChange`, `label`, `noneLabel`, `idPrefix`, `fallbackLocation`; radiogroup contract; no nested sheet |
| component:location-picker-empty | B13 | "Nie masz jeszcze zapisanych miejsc." + search input immediately; manual form directly when no key; "wpisz ręcznie" toggle |
| component:location-picker-list | B13 | "Brak miejsca" radio, rows (name bold, address, notes) with "Edytuj"/"Usuń" buttons outside the radio, "(usunięte)" row for a soft-deleted selection without buttons, "+ Dodaj nowe miejsce" disclosure |
| component:location-picker-add | B12, B13 | Own `role="combobox"` + `role="listbox"` inside the sheet, 300 ms debounce, session token, Esc closes only the listbox (`preventDefault` + `stopPropagation`), chosen address line + "zmień", "Nazwa miejsca" prefilled with place name, "Notatka", "Zapisz miejsce"/"Anuluj"; `aria-busy` + "Ładowanie wyszukiwarki…" while loading; failure -> manual with `role="alert"` "Wyszukiwarka niedostępna — wpisz adres ręcznie" |
| component:location-picker-manual | B12, B13 | "Nazwa miejsca" (required), "Adres" (required), "Notatka"; "szukaj w Google" link only when a key is configured; error `role="alert"` "Podaj adres" |
| component:location-picker-edit | B13 | Row swaps to a form: name/notes editable, address editable only for MANUAL rows (Google rows show "(z Google)" read-only); "Zapisz"/"Anuluj"; focus to name input on edit, back to the row's "Edytuj" after save/cancel; one row edits at a time |
| screen:group-add-modal | A3, B13, B14 | "Dodaj nową grupę" uses `GroupFormFields`; `createAdditionalMyCircle({name, visibility, default_location_id, default_capacity})`; button "Dodaj grupę" |
| screen:group-edit-modal | B9, B14 | "Edytuj grupę" uses `GroupFormFields` + "Szablon wizualizacji"; PATCH with `null` to clear; initial values from `GroupResponse` |
| screen:term-add-modal | B13, B15 | "Dodaj termin zajęć": Grupa select over led groups only; "Miejsce" + "Ile miejsc" after Opis, prefilled on group change with helper "Domyślne miejsce grupy — możesz zmienić"; needed items unchanged |
| screen:first-term-stepper-organizer | B13, B15 | One-step form: "Data i godzina", "Opis (opcjonalnie)", "Miejsce", "Ile miejsc", "Dodaj termin" (labels unchanged) |
| screen:edit-term-dialog | B13, B15 | "Miejsce" with the term's value (soft-deleted renders as "(usunięte)"), "Ile miejsc"; diff-PATCH with `null` to clear |
| screen:home-view | A1, A6, A7, B16 | Hint matrix (section 7.7), merged top-3 cards (led + attended + membership-only); the panel header has no hamburger (mockup corrected) |
| component:term-place-line | B16 | `TermPlaceLine`: pin glyph `aria-hidden`, name, address, notes, "Otwórz w Google Maps" (`target=_blank rel="noopener noreferrer"`, `aria-label` "Otwórz <name> w Google Maps (nowa karta)"), capacity text "X/Y miejsc" / "Y miejsc"; renders nothing when location and capacity are null; `withMapLink=false` inside Link cards |
| component:led-term-card | B16 | `organizerTermCard` + `TermPlaceLine` + " · X/Y miejsc" inside `signupSummaryChip` |
| component:attended-term-card | A6, B16 | Guest Link card used for attended terms (`MyAttendanceResponse.location/capacity/attendee_count`) and for membership-only terms of `guestCircles` (`TermResponse.location/capacity`, no count); `TermPlaceLine withMapLink={false}` (name + address, no nested anchor) + small `bg-cream` pill "X/Y miejsc" (attended) or "Y miejsc" (membership-only) |
| screen:spotkania-view | A1, A6, B16 | Sections "Prowadzę · N" (+ button) and "Zapisane · N"; empty copies; FAB only when `myGroups.length > 0` |
| component:group-tile | B14, B16 | Tile small line = `default_location?.name ?? "<n> terminów"`, second line address truncated; "wolne N miejsca" chip removed |
| component:account-menu-zaloz-grupe | A1 | `Link role="menuitem"` "Załóż grupę" to `/panel/spotkania?nowa=grupa` between "Ustawienia" and "Moja organizacja", unconditional; the menu exists only on public pages (`PublicLayout`), never inside `/panel` |
| screen:public-term-page | B11, B16, B17 | `TermCard` location block under the date (eyebrow "MIEJSCE", name, address, notes, Maps link), "Zapisanych X z Y"; RSVP footer unchanged |
| component:public-term-full | B17 | `role="status"` pill "Brak wolnych miejsc" (`bg-accent-soft`, tokens only) when `attendee_count >= capacity`; RSVP active |
| screen:admin-terms-page | B16 | Columns `["Date","Circle","Description","Miejsce","Signups","Children","Miejsca"]`; "Miejsce" = name + address line; "Miejsca" = `"${attendee_count} / ${capacity}"` or "—" gray italic |

## 5. Reusable Components

### 5.1 Existing code to leverage

Backend

| Reuse | Path | How |
|---|---|---|
| Standalone module layout, `/mine` route shape, `ReadPrincipal`/`EditPrincipal` aliases, 201/204 conventions | `app/organizations/router.py` | Template for `app/locations/router.py` |
| `model_fields_set` PATCH with `ConfigDict(extra="forbid", str_strip_whitespace=True)`, `_not_null` validators, narrow public response | `app/organizations/schemas.py` (`UpdateOrganizationRequest`, `PublicOrganizationResponse`) | Template for `UpdateLocationRequest`, `PublicLocationResponse`, and the 4 new clearable group/term fields |
| 404-then-403 ownership order, `get_own_*` | `app/organizations/service.py` | Template for `app/locations/service.py` |
| Cross-BC ACL mapper (`public_organization`) | `app/groups/infrastructure/organizations_acl.py` | Template for `app/groups/infrastructure/locations_acl.py` |
| UUID table migration with `gen_random_uuid()`, named constraints, partial unique index via `postgresql_where` | `alembic/versions/0054_organization_media.py` | Template for `0057_locations.py` |
| `add_column` + `create_foreign_key` with reverse-order downgrade | `alembic/versions/0056_group_soft_delete.py` | Template for `0058_group_term_location_capacity.py` |
| SAVEPOINT + `IntegrityError` re-fetch for unique races | `app/circulation/application/inventory.py:40-70` | `POST /api/locations` idempotency on active place_id |
| Soft delete (`deleted_at` set with `datetime.utcnow()`, `.where(deleted_at.is_(None))` on reads, `get_*_including_deleted`) | `app/groups/application/circles.py:173-201`, `infrastructure/repository.py:62-75` | Location soft delete and the "include deleted" by-id lookup |
| Attach computed fields after `model_validate` | `app/groups/router/circles.py:69-71,84-86,104-106`, `router/terms.py:56-64` | Attaching `location`/`default_location` |
| Batched dict lookup precedent | `repository.list_group_names(db, ids)`, `count_active_attendances_by_term` (`repository.py:475-492`) | `get_locations_by_ids` and public `attendee_count` |
| Matrix row shapes and comments | `app/core/authorization_matrix.py:177-201` (inventory-items/organizations) | New `/api/locations` rows |
| String-backed enum column helper | `app/groups/models.py` `_enum_column` | `LocationSource` column (replicate locally in `app/locations/models.py`; do not import `app.groups`) |
| `create_term` already loads the group | `app/groups/application/terms.py:32-44` | Inheritance point |

Frontend

| Reuse | Path | How |
|---|---|---|
| Hook shape (`data` with module-level empty fallback, `loading = isPending`, `error`, `refetch`, mutations invalidating the prefix and rethrowing `extractProblemMessage`) | `hooks/useCategories.ts` | `hooks/useMyLocations.ts` |
| Token in the query key, `enabled: token !== null` | `hooks/useMyOrganization.ts:45-49` | `useMyLocations` key `["locations", "mine", token]` |
| API module style (snake_case types, `encodeURIComponent` ids) | `api/organizations.ts` | `api/locations.ts` |
| Panel `ModalSheet`, `Field`, `HintCard`, `inputClass`, button classes | `pages/panel/panelComponents.tsx` | Hosts for every form; picker rendered inline |
| Radiogroup with roving tabIndex | `pages/organizer/editor/ColorsTab.tsx:53-75` | Saved-places list |
| Inline edit/delete rows, `rowIconBtn`/`rowSaveBtn`/`rowCancelBtn` | `components/panel/EditTermDialog.tsx:329-400` | Picker rows |
| Disclosure "+ Dodaj …"/"Zwiń" | `pages/panel/PanelModals.tsx:322-370` | "+ Dodaj nowe miejsce" |
| Confirm alertdialog | `pages/panel/DeleteGroupDialog.tsx` | Delete-location confirm |
| Focus move after row removal | `pages/organizer/editor/PhotosTab.tsx` | After delete in the picker |
| `termPublicPath`, `serverMessageOr`, `extractProblemMessage`, `hasStatus` | `pages/panel/panelHelpers.ts:109`, `api/problem.ts` | Links and error text |
| Visibility select options and copy | `PanelModals.tsx:170-185` | `GroupFormFields` |
| `createAdditionalMyCircle`, `createTerm`, `updateTerm`, `updateGroupLayoutMode` | `api/groups.ts`, `api/terms.ts` | Extended request types; one new `updateGroup(id, request)` beside the existing PATCH caller |
| Icons | `pages/panel/panelIcons.tsx` | Add `MapPinIcon`; reuse `CalendarPlusIcon`, `BuildingIcon` |
| `dayjs` from `utils/dayjs.ts` | | All date formatting |
| Test helpers `createQueryWrapper`, `vi.stubEnv` | `src/test/queryClient.tsx`, Vitest | New tests |

### 5.2 New components required (and why)

| New | Why reuse is impossible |
|---|---|
| `app/locations/{__init__,models,schemas,service,router}.py` | No location concept exists anywhere in the backend; the owner is the PERSON party (`profile.party_id`), not the per-circle ORGANIZATION party, so it cannot live on `Group` |
| `app/groups/infrastructure/locations_acl.py` | Groups BC may only import other BCs through an ACL file (architecture rule) |
| `alembic/versions/0057_locations.py`, `0058_group_term_location_capacity.py` | Hand-written migrations (`target_metadata = None`) |
| `api/locations.ts`, `hooks/useMyLocations.ts` | New resource |
| `components/shared/LocationPicker.tsx` | No combobox/autocomplete or selectable list with per-row edit/delete exists; a `<select>` cannot carry address/notes/actions |
| `lib/googleMaps.ts` | No external script loader exists (`PluginFrame` uses an iframe); no Google package allowed at runtime |
| `components/panel/GroupFormFields.tsx` | Three forms would otherwise duplicate five fields plus the picker (`PanelModals.tsx` already duplicates two) |
| `components/shared/TermPlaceLine.tsx` | Same place/capacity line on four surfaces (led card, attended card, public `TermCard`, Spotkania tile) |
| `src/vite-env.d.ts`, `src/frontend/.env.example`, Dockerfile `ARG`, compose `build.args` | Nothing reads `import.meta.env` today |

Not created (over-engineering guard): no generic autocomplete abstraction, no `relationship()` on groups models, no server geocoding, no location moderation `TextField`s, no hook migration of group/term loading, no `/krag` route, no new sheet component, no location fields on organizer public responses (`OrganizerTermResponse`/`OrganizerNextTermResponse`).

## 6. Backend Specification

### 6.1 `Location` model (`app/locations/models.py`, table `locations`)

Extends `BaseEntity` (`app/core/base_model.py`: UUID `id` with `default=uuid.uuid4` and `server_default=gen_random_uuid()`, `created_at`, `updated_at` as optimistic-lock version). No `__eq__`/`__hash__` (no natural business key). No `relationship()`.

| Column | Type / constraint |
|---|---|
| `owner_party_id` | `UUID`, FK `parties.id` named `fk_locations_owner_party_id_parties`, not null; index `ix_locations_owner_party_id` |
| `name` | `String(255)`, not null (user label) |
| `formatted_address` | `String(500)`, not null (required for both sources) |
| `google_place_id` | `String(255)`, nullable |
| `lat` | `Numeric(9,6)`, nullable (`Decimal` in Python) |
| `lng` | `Numeric(9,6)`, nullable |
| `notes` | `String(500)`, nullable |
| `source` | `String(10)` string-backed `LocationSource` StrEnum `GOOGLE` / `MANUAL`, not null, `native_enum=False` |
| `deleted_at` | `DateTime()`, nullable; set with `datetime.utcnow()` (naive UTC audit timestamp, per `standards/backend/time.md`) |
| partial unique | index `uq_locations_owner_party_id_google_place_id` on `(owner_party_id, google_place_id)` `WHERE google_place_id IS NOT NULL AND deleted_at IS NULL` |

Module docstring (`app/locations/__init__.py`) must state: Google place_id may be stored indefinitely; `formatted_address`/`lat`/`lng` are cached Google data subject to Google's caching limits (currently 30 days for coordinates); refresh/re-geocoding is out of scope; the backend never calls Google; `updated_at` is the cache timestamp.

### 6.2 Migrations

- **`0057_locations.py`** (`down_revision = "0056"`): `create_table("locations", …)` with the columns above, `pk_locations`, the named FK, `ix_locations_owner_party_id`, and the partial unique index via `op.create_index(..., unique=True, postgresql_where=sa.text("google_place_id IS NOT NULL AND deleted_at IS NULL"))`. `downgrade`: drop the two indexes, then the table.
- **`0058_group_term_location_capacity.py`** (`down_revision = "0057"`): `add_column("groups", "default_location_id" UUID nullable)`, `add_column("groups", "default_capacity" Integer nullable)`, `add_column("terms", "location_id" UUID nullable)`, `add_column("terms", "capacity" Integer nullable)`; `create_foreign_key("fk_groups_default_location_id_locations", "groups", "locations", ["default_location_id"], ["id"])`, `create_foreign_key("fk_terms_location_id_locations", "terms", "locations", ["location_id"], ["id"])`. No `ON DELETE` action (rows are only soft-deleted). `downgrade`: drop both FKs, then the four columns. No data backfill; existing rows get nulls.
- Schema only, no data migrations. Migration tests downgrade the shared DB below head and back (template `tests/test_group_soft_delete_migration.py`), so 0058's downgrade must run cleanly before 0057's.

Stale standards flag: `standards/backend/models.md` ("explicit Sequence PKs", "no soft delete") and `standards/backend/migrations.md` describe the pre-0041 world; follow the code (`app/core/base_model.py`, migrations 0041/0054/0056). Recorded as a follow-up `/maister:standards-update`.

### 6.3 Groups/terms model changes (`app/groups/models.py`)

- `Group.default_location_id: Mapped[uuid.UUID | None]` FK `locations.id` (named as in 0058), `Group.default_capacity: Mapped[int | None]` `Integer`.
- `Term.location_id: Mapped[uuid.UUID | None]` FK `locations.id`, `Term.capacity: Mapped[int | None]`.
- Plain FK-id columns, no `relationship()` (groups BC convention).

### 6.4 Schemas

`app/locations/schemas.py`

| Schema | Fields / rules |
|---|---|
| `LocationResponse` (`from_attributes`) | `id`, `owner_party_id`, `name`, `formatted_address`, `google_place_id: str \| None`, `lat: float \| None`, `lng: float \| None` (the ORM column is `Numeric(9,6)`/`Decimal`; the response declares `float` so JSON carries numbers, not strings — pydantic coerces `Decimal` -> `float`), `notes: str \| None`, `source: LocationSource`, `created_at`, `updated_at`, `deleted_at: datetime \| None` (owner view; `deleted_at` lets the picker label "(usunięte)") |
| `PublicLocationResponse` | `name`, `formatted_address`, `google_place_id`, `lat: float \| None`, `lng: float \| None`, `notes` — never `owner_party_id`, no timestamps. Also used by `ModerationTermResponse` (deliberate: moderators see the place, not the owner's party id; tracing an owner is not an admin use case in this iteration) |
| `CreateLocationRequest` (`extra="forbid"`, `str_strip_whitespace=True`) | `name` 1..255 non-blank; `formatted_address` 1..500 non-blank; `source: LocationSource`; `google_place_id` ≤255 optional; `lat` in [-90, 90], `lng` in [-180, 180] optional; `notes` ≤500 optional (blank -> null). Model validator: `GOOGLE` requires `google_place_id`, `lat` and `lng`; `MANUAL` forbids `google_place_id`, `lat`, `lng`. Violations -> validation error (400 envelope as elsewhere) |
| `UpdateLocationRequest` (`extra="forbid"`, `str_strip_whitespace=True`, `model_fields_set`) | `name` (cannot be null), `notes` (null/blank clears), `formatted_address` (cannot be null; allowed only when the row's `source == MANUAL`, otherwise 409 `BusinessConflictException`). `google_place_id`, `source`, `lat`, `lng` are not editable (unknown keys rejected by `extra="forbid"`) |

`app/groups/schemas.py` changes

| Schema | Change |
|---|---|
| `GroupResponse` | `+ default_location: LocationResponse \| None = None` (attached after `model_validate` on every endpoint that returns `GroupResponse`, including the `GET /api/groups` list via one batched `IN` lookup — never a half-populated row), `+ default_capacity: int \| None = None` |
| `CreateOwnCircleRequest` | `+ default_location_id: uuid.UUID \| None = None`, `+ default_capacity: int \| None = None` (`ge=1, le=10000`); honoured by `/mine/new` only; `/mine` keeps ignoring extras (unchanged behaviour) |
| `UpdateGroupRequest` | `name` stays required; `layout_mode`/`visibility` stay `is not None`-apply; `+ default_location_id: uuid.UUID \| None = None`, `+ default_capacity: int \| None = None` applied only when present in `model_fields_set` (omitted = keep, `null` = clear). Do NOT add `extra="forbid"` here (existing callers) |
| `TermResponse` | `+ location: LocationResponse \| None = None`, `+ capacity: int \| None = None` |
| `CreateTermRequest` | `+ location_id: uuid.UUID \| None = None`, `+ capacity: int \| None = None` (`ge=1, le=10000`); omitted vs explicit null distinguished via `model_fields_set` |
| `UpdateTermRequest` | `+ location_id`, `+ capacity` with `model_fields_set` semantics; `occurs_on`/`description` unchanged |
| `ModerationTermResponse` | `+ location: PublicLocationResponse \| None` (decided shape, see `PublicLocationResponse` row), `+ capacity: int \| None` (built field by field in `list_terms_for_moderation`) |
| `PublicTermResponse` | `+ location: PublicLocationResponse \| None`, `+ capacity: int \| None`, `+ attendee_count: int` |
| `MyAttendanceResponse` (`schemas.py:~500-515`, built in `application/public_view.py::list_my_attendances`) | `+ location: PublicLocationResponse \| None` (the term's location, soft-deleted rows still render), `+ capacity: int \| None` (the term's value), `+ attendee_count: int` (non-null: active signups via one batched `count_active_attendances_by_term` call over all listed term ids; `list_my_attendances_joined` already excludes withdrawn rows, so every listed term has at least the caller's own RSVP — fall back to 0 only defensively) |
| `OrganizerTermResponse`, `OrganizerNextTermResponse`, `GroupAccessResponse` | Unchanged (organizer public pages are a follow-up; `GroupAccessResponse` nests the changed `PublicCircleResponse` and needs no edit) |

Import boundary: `app/groups/schemas.py` obtains `LocationResponse`/`PublicLocationResponse` through `app/groups/infrastructure/locations_acl.py` (re-export), keeping that ACL the only `app.groups` file that imports `app.locations`. If this creates an import cycle, define thin nested response models in the ACL and import those into `schemas.py` instead.

### 6.5 Endpoints (`app/locations/router.py`, tag `locations`)

| Endpoint | Auth | Behaviour | Status / errors |
|---|---|---|---|
| `GET /api/locations/mine` | READ | Caller's active (not soft-deleted) locations ordered by `name`, then `created_at` | 200 `list[LocationResponse]` |
| `POST /api/locations` | EDIT | Validate; for `GOOGLE`: look up an active row with the same `(owner, google_place_id)` -> return it with **200**; else insert inside `begin_nested()`; on `IntegrityError` re-fetch and return **200**; otherwise **201**. `MANUAL` always inserts (201). Owner = `profile.party_id` | 201 created / 200 existing; 400 validation |
| `PATCH /api/locations/{id}` | EDIT | Load by id including deleted -> missing or `deleted_at` set -> 404; `owner_party_id != caller` -> 403; `formatted_address` on a GOOGLE row -> 409; apply `model_fields_set` | 200 `LocationResponse`; 404/403/409 |
| `DELETE /api/locations/{id}` | EDIT | Same lookup/ownership; set `deleted_at = datetime.utcnow()`; already-deleted -> 404 | 204, `response_model=None` |

Ownership order is lookup -> 404, then non-owner -> 403 (organizations precedent). Route `/mine` declared before `/{id}`. Owner id never comes from the body. The POST handler returns the status code dynamically (`Response.status_code`) since one route yields 200 or 201.

### 6.6 Authorization matrix (`app/core/authorization_matrix.py`) and registration

Add before the catch-all (next to the organizations rows, keeping first-match-wins correct):

- `(_methods("PATCH", "DELETE"), r"^/api/locations/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("GET"), r"^/api/locations(/.*)?$", ("READ", "mcp:read"))`
- `(_methods("POST"), r"^/api/locations(/.*)?$", ("EDIT", "mcp:edit"))`

Assert them in `tests/test_authorization_matrix.py`. Register `locations_router` in `app/main.py` after `organizations_router` and before `system_router` (SPA catch-all stays last).

### 6.7 Groups ACL (`app/groups/infrastructure/locations_acl.py`)

The only `app.groups` module importing `app.locations`.

- `get_owned_location(db, location_id, caller_party_id) -> Location`: missing -> `EntityNotFoundException("Location", id)` (404); soft-deleted -> 404 (a deleted place cannot be newly assigned); non-owner -> `AccessDeniedException` (403).
- `get_locations_by_ids(db, ids) -> dict[uuid.UUID, Location]`: one `IN` query, includes soft-deleted rows (existing references must render); empty input returns `{}` without a query.
- `location_response(location | None) -> LocationResponse | None`, `public_location_response(location | None) -> PublicLocationResponse | None`.
- Re-exports `LocationResponse`, `PublicLocationResponse` for `app/groups/schemas.py`.

### 6.8 Use-case changes (`app/groups/application/*`)

- `circles.create_additional_circle(db, party_id, name, visibility, default_location_id, default_capacity)`: if `default_location_id` is given, `get_owned_location` against the caller's PERSON party (not the circle's ORGANIZATION party); set both columns before commit. `create_own_circle` (`/mine`) unchanged.
- `circles.update_group(...)`: receives the `UpdateGroupRequest` (or an explicit fields-set); applies `default_location_id` (validates ownership when non-null) and `default_capacity` only when present in `model_fields_set`; `null` clears. `name`/`layout_mode`/`visibility` behaviour unchanged.
- `terms.create_term`: after the existing 404/403/moderation steps: `location_id = data.location_id if "location_id" in data.model_fields_set else group.default_location_id`; `capacity = data.capacity if "capacity" in data.model_fields_set else group.default_capacity`; a caller-supplied non-null `location_id` is validated via the ACL; inherited ids are not re-validated (they are the group's own and may be soft-deleted, which is allowed). Copy by value, never link.
- `terms.update_term`: applies `location_id` (validated when non-null) and `capacity` when present in `model_fields_set`; `null` clears.
- `terms.list_terms_for_moderation`: batch-attaches `location` and `capacity`.
- `public_view.get_public_circle_view`: `PublicTermResponse` gets `location` (single lookup for the one term, including soft-deleted), `capacity`, and `attendee_count` from `count_active_attendances_by_term(db, [term.id])` (0 when absent). PRIVATE reduced branch unchanged (`term=None`).
- `public_view.list_my_attendances`: after collecting the caller's attendances, one `get_locations_by_ids` over the distinct `term.location_id`s (including soft-deleted) and one `count_active_attendances_by_term` over all term ids; each `MyAttendanceResponse` gets `location` (`public_location_response`), `capacity` (copied from the term) and `attendee_count`. Exactly two extra queries per request regardless of attendance count.
- Routers: `router/circles.py` handlers returning `GroupResponse` attach `default_location` after `model_validate` (same spots as `organizer_slug`: `:69-71, 84-86, 104-106, 282-284, 303-305`); the `GET /api/groups` list attaches it too with one batched `get_locations_by_ids` over the page's distinct `default_location_id`s (consistent `GroupResponse` everywhere); `router/terms.py` list endpoint batch-attaches `location` with one `IN` query per request; `GET /{id}`, `POST`, `PATCH` attach with a single lookup. `GET /api/groups/mine/attendances` is extended inside `list_my_attendances` as above.
- Clock rule: no `datetime.now()`/`date.today()` anywhere under `app/groups/application` or `app/groups/router` (`tests/test_domain_clock_guard.py`); `deleted_at` uses `datetime.utcnow()`; `app/locations` follows the same rule although outside the guard.

### 6.9 Query budgets

`tests/test_organizer_page_queries.py` (`MAIN_ENDPOINT_BUDGET = 10`, `TERMS_ENDPOINT_BUDGET = 5`, must not grow with term count) and `tests/test_organizer_bridges.py:168,202` stay green because organizer endpoints are not extended in this iteration and every extended list endpoint resolves locations with exactly one batched query. No per-term lookups anywhere; the new terms test asserts the count does not grow with the number of terms.

### 6.10 Visibility wiring

`POST /api/groups/mine/new` already honours `visibility`; it additionally honours the two defaults. `POST /api/groups/mine` unchanged (idempotent, ignores visibility/defaults). Backend server default `PUBLIC` unchanged (dozens of tests depend on it).

## 7. Frontend Specification

### 7.1 Environment and build plumbing

- `src/frontend/src/vite-env.d.ts`: `/// <reference types="vite/client" />` + `ImportMetaEnv { readonly VITE_GOOGLE_MAPS_API_KEY?: string }`.
- `src/frontend/.env.example`: `VITE_GOOGLE_MAPS_API_KEY=` (empty placeholder, comment "referrer-restricted browser key; leave empty for manual mode"). Root `.env.example` gains the same placeholder for compose.
- `src/frontend/Dockerfile` builder stage: `ARG VITE_GOOGLE_MAPS_API_KEY=` and `ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY` before `npm run build`.
- `docker-compose.yml`: `build.args: VITE_GOOGLE_MAPS_API_KEY: ${VITE_GOOGLE_MAPS_API_KEY:-}` on both `frontend-build` and `frontend` services.
- `@types/google.maps` devDependency; no runtime Google npm package.
- Tests/CI run without a key (manual mode) and must pass; Google-mode tests stub the env with `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key")` and a fake `window.google`.

### 7.2 `lib/googleMaps.ts` (loader + Places API (New) wrapper)

Mandated API: **Places API (New)** via the Maps JavaScript API `places` library. The legacy `AutocompleteService`/`PlacesService`/`Autocomplete` widget must not be used anywhere (new Cloud projects no longer get the legacy library).

Contract (exact exported names; the picker depends only on these):

- `isGoogleMapsConfigured(): boolean` — reads `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` **inside the function at call time** (never into a module-level constant), so `vi.stubEnv` in tests can flip modes per test.
- `loadPlaces(): Promise<PlacesApi | null>` — memoized promise; on first call injects one `<script async>` `https://maps.googleapis.com/maps/api/js?key=<key>&v=weekly&loading=async` (key read at call time), waits for script `load`, then `await google.maps.importLibrary("places")` and resolves with `PlacesApi = { AutocompleteSuggestion, AutocompleteSessionToken, Place }` (the three constructors from the imported library); resolves `null` (and logs nothing sensitive) when the key is absent, the script errors, or a 10 s timeout elapses; the memo is cleared on failure so a later attempt can retry. Never called at module import or on mount — only on first focus/keystroke in the search input.
- `newSessionToken(api: PlacesApi): SessionToken` — `new api.AutocompleteSessionToken()`.
- `suggest(api, input: string, token: SessionToken): Promise<Suggestion[]>` — returns `[]` for blank input without calling Google; otherwise `api.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: token, language: "pl", region: "pl" })` mapped to `Suggestion { placeId: string; mainText: string; secondaryText: string; raw: AutocompleteSuggestion }` (from `suggestion.placePrediction.placeId`, `.mainText.text`, `.secondaryText.text`).
- `resolve(suggestion: Suggestion, token: SessionToken): Promise<ResolvedPlace>` — `const place = suggestion.raw.placePrediction.toPlace(); await place.fetchFields({ fields: ["id", "formattedAddress", "location", "displayName"], sessionToken: token })` (the `sessionToken` option is passed when the typings allow it; otherwise the token is simply retired), returning `ResolvedPlace { placeId: string; name: string; formattedAddress: string; lat: number; lng: number }` (`place.location.lat()`/`.lng()`). The caller discards the token after `resolve` or on cancel and creates a new one for the next search (one billing session per selection).
- `buildMapsUrl({ formatted_address, google_place_id })` — `https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(address)>` plus `&query_place_id=<id>` when present (lives in `TermPlaceLine` or `utils/`).

Test fake (what `LocationPicker.test.tsx` and any Google-mode test must provide, with `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key")` set **before** the component mounts, restored with `vi.unstubAllEnvs()` in `afterEach`): the test replaces `loadPlaces`' script injection by stubbing `window.google = { maps: { importLibrary: vi.fn(async (name) => name === "places" ? fakePlaces : {}) } }` **and** appending a `script` whose `load` event the test fires (or by mocking `lib/googleMaps.ts`' `loadPlaces` via `vi.mock` when only the picker is under test — the preferred route for component tests). `fakePlaces` shape:

```text
fakePlaces = {
  AutocompleteSessionToken: class {},
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: vi.fn(async ({ input, sessionToken }) => ({
      suggestions: [{
        placePrediction: {
          placeId: "ChIJ-test",
          mainText: { text: "Świetlica Osiedlowa" },
          secondaryText: { text: "Polna 12, Poznań" },
          toPlace: () => fakePlace,
        },
      }],
    })),
  },
  Place: class {},
}
fakePlace = {
  id: "ChIJ-test",
  displayName: "Świetlica Osiedlowa",
  formattedAddress: "Polna 12, 60-595 Poznań",
  location: { lat: () => 52.4064, lng: () => 16.9252 },
  fetchFields: vi.fn(async () => ({ place: fakePlace })),
}
```

`lib/googleMaps.test.ts` tests the loader itself (null without key, null on script error, `importLibrary("places")` called once, blank input makes no call, a new token is used after `resolve`).

### 7.3 `api/locations.ts` and `hooks/useMyLocations.ts`

- Types: `LocationSource = "GOOGLE" | "MANUAL"`; `LocationResponse` (owner view incl. `deleted_at: string | null`, `lat: number | null`, `lng: number | null`); `PublicLocationResponse` (`lat`/`lng` as `number | null`); `CreateLocationRequest` (`lat`/`lng` numbers); `UpdateLocationRequest { name?: string; notes?: string | null; formatted_address?: string }`.
- Functions: `getMyLocations()`, `createLocation(request)`, `updateLocation(id, request)`, `deleteLocation(id)` with `encodeURIComponent` ids.
- `useMyLocations()` returns `{ data: LocationResponse[], loading, error: string | null, refetch, create(request): Promise<LocationResponse>, update(id, request): Promise<LocationResponse>, remove(id): Promise<void> }`; key `[LOCATIONS_KEY, "mine", token]` with `enabled: token !== null`; module-level `NO_LOCATIONS` fallback; mutations `await invalidateQueries({ queryKey: [LOCATIONS_KEY] })` and rethrow `new Error(extractProblemMessage(err))`. `create` pre-checks the loaded list for an active row with the same `google_place_id` and returns it without a request.

### 7.4 `components/shared/LocationPicker.tsx`

Props: `value: string | null`, `onChange(id: string | null)`, `label: string` (radiogroup `aria-label`), `noneLabel: string` ("Brak stałego miejsca" / "Brak miejsca"), `idPrefix: string`, `fallbackLocation?: { id: string; name: string; formatted_address: string; notes: string | null } | null` (the group's/term's stored location, used to render the "(usunięte)" row when `value` is not in the list), `helperText?: string` ("Domyślne miejsce grupy — możesz zmienić").

Behaviour per state (binding, see mockups 2a–2e):

| State | Behaviour |
|---|---|
| Loading | Short "Ładowanie miejsc…" text; `onChange` untouched |
| Error loading list | `role="alert"` with the server message; manual add still available |
| Empty (no saved places) | "Nie masz jeszcze zapisanych miejsc." + the search input immediately (Google mode) with "wpisz ręcznie" toggle; or the manual form directly (no key). No radiogroup rendered; `value` stays `null` |
| List | `role="radiogroup"`: "Brak miejsca" radio first, then rows (`role="radio"`, `aria-checked`, roving `tabIndex`, Arrow keys); each row shows name, address, notes; sibling "Edytuj"/"Usuń" buttons with `aria-label="Edytuj miejsce <name>"` / `"Usuń miejsce <name>"`; "+ Dodaj nowe miejsce" disclosure (`aria-expanded`) |
| Deleted-selected | When `value` is set but absent from `/mine` and `fallbackLocation` is given: render a row "<name> (usunięte)" checked, without Edytuj/Usuń; choosing another radio or "Brak" replaces it |
| Add (Google) | Own `role="combobox"` input (`aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) + own `role="listbox"`/`role="option"` inside the sheet; `loadPlaces()` starts on first focus (`aria-busy`, placeholder "Ładowanie wyszukiwarki…"), then `newSessionToken`; 300 ms debounce -> `suggest(api, input, token)`; ArrowUp/Down, Enter picks -> `resolve(suggestion, token)` then a fresh token; **Esc with the listbox open closes only the listbox and calls `preventDefault()` + `stopPropagation()`** (the host panel `ModalSheet` has no Esc handler, so this matters for Esc-aware hosts: the delete-location confirm alertdialog and krag `ModalSheet`, which honour `defaultPrevented`); picking shows the chosen address line + "zmień", "Nazwa miejsca" prefilled with `displayName`, "Notatka"; "Zapisz miejsce" -> `create({source:"GOOGLE", name, formatted_address, google_place_id, lat, lng, notes})`; on success the row is appended, selected (`onChange(id)`), the disclosure collapses, focus moves to the new radio. `loadPlaces()` resolving `null` -> manual mode with `role="alert"` "Wyszukiwarka niedostępna — wpisz adres ręcznie" |
| Add (manual) | "Nazwa miejsca" (required), "Adres" (required, non-blank, error "Podaj adres"), "Notatka"; `create({source:"MANUAL", name, formatted_address, notes})`; "szukaj w Google" back-link only when configured |
| Edit | Row swaps to a form (`editingId`, one at a time): name, notes; address editable only for `source === "MANUAL"` (Google rows show it read-only with "(z Google)"); "Zapisz" -> `update`, "Anuluj"; focus to the name input on open, back to that row's "Edytuj" on close; errors `role="alert"` under the row |
| Delete | "Usuń" opens a confirm alertdialog (pattern `DeleteGroupDialog`, registered with `useRegisterOpenSheet`); confirm -> `remove(id)`; if the deleted row was selected -> `onChange(null)`; focus to the next row or "+ Dodaj nowe miejsce" |

The picker never opens a sheet of its own and is always inside a host `Field`. Inputs carry `aria-label` equal to the visible label.

### 7.5 `components/panel/GroupFormFields.tsx`

Controlled: `value: { name: string; visibility: GroupVisibility; layoutMode?: GroupLayoutMode; defaultLocationId: string | null; defaultCapacity: number | null }`, `onChange(next)`, `showLayoutMode?: boolean`, `idPrefix: string`, `fallbackLocation?` (passed to the picker). Field order: Nazwa grupy -> (Szablon wizualizacji, edit only) -> Widoczność grupy -> Stałe miejsce spotkań (opcjonalnie) -> Ile miejsc (opcjonalnie) (`type=number min=1 inputMode=numeric w-28`, blank -> `null`). Used by: stepper step 1, "Dodaj nową grupę" (`PanelModals.tsx:139-198`), "Edytuj grupę" (`:201-279`).

Visibility default rule (shared helper `defaultVisibility(organizationSlug: string | null): GroupVisibility` in `panelHelpers.ts`): `organizationSlug === null ? "PRIVATE" : "PUBLIC"`; applied when the stepper or the add-group modal opens; the `groupForm.visibility: "PUBLIC"` literal at `PanelDataContext.tsx:305-310` is replaced by this rule.

### 7.6 Stepper "Załóż grupę" (`components/panel/FirstTermStepperGuest.tsx`, may be renamed `CreateGroupStepper.tsx`)

- Remove `withOrganizationStep`, the organization step, the `createMyOrganization` import and the title switch. Title always "Załóż grupę"; 2 progress dots.
- Step 1: `GroupFormFields`; "Dalej →" disabled until `name.trim()`; submit -> `createAdditionalMyCircle({ name, visibility, default_location_id, default_capacity })`; keep the created `GroupResponse` in state; call `onCircleCreated()`. If the user goes "← Wstecz" and changes step 1, save with `PATCH /api/groups/{id}` (`updateGroup`) instead of creating again.
- Step 2: eyebrow "Pierwszy termin w grupie „<name>"", "Data i godzina" (required), "Opis (opcjonalnie)", "Miejsce" picker initialised to `group.default_location?.id ?? null`, "Ile miejsc" initialised to `group.default_capacity`; submit -> `createTerm({ circle_group_id, occurs_on, description, location_id, capacity })` where cleared prefills are sent as explicit `null` (never omitted when the group has a default).
- Done: copy per mockup, "Przejdź do publicznej strony →" (`termPublicPath(group, termId)`), "Gotowe" (`onDone`), and when `organizationSlug === null` the CTA box with `Link to="/organization"` that also calls `onDone`.
- `PanelModals.tsx`: new `ModalKind` `"zaloz-grupe"` mounts the stepper; the `"pierwszy-termin"` kind keeps only the `FirstTermStepperOrganizer` branch (`firstTermForOrganizer && myGroups.length > 0`), otherwise it renders the "zaloz-grupe" stepper; `"zostan-organizatorem"` is removed from `ModalKind` (`panelHelpers.ts:29`) and from `PanelModals.tsx:92-104`. Success toast: "Grupa założona — dodano pierwszy termin".
- `pages/panel/PanelPage.tsx` (`PanelPageView`, inside `PanelDataProvider`, `:33-38`) reads `?nowa=grupa` via `useSearchParams`, calls `setModal("zaloz-grupe")` once (effect keyed on the param) and strips the param with `setSearchParams` (replace). This is the landing of the public-page hamburger link; there is no hamburger inside the panel.
- `FirstTermStepperOrganizer.tsx` (kept): props gain the target group's `defaultLocation`/`defaultCapacity` (or the `GroupResponse`); fields in order "Data i godzina", "Opis (opcjonalnie)", "Miejsce" (prefilled), "Ile miejsc" (prefilled), button "Dodaj termin" (labels unchanged); sends `location_id`/`capacity` (explicit `null` when cleared).

### 7.7 Panel data (`pages/panel/PanelDataContext.tsx`) — minimal change inside `load()`

- Leaderships -> `myGroups` (as today). Independently: family memberships (`getMembershipsForFamily`, active only) -> `guestCircles` (no longer zeroed when leaderships exist); `myAttendances` loaded as today. `getTerms` + `getNeededItems` run for `myGroups` **and** `guestCircles` (as today for guests) and are kept apart: `terms` (led, `TermWithNeeded`) and `guestTerms` (membership-only, `TermWithNeeded`). Guest-side list ("Zapisane", Home candidates) = `myAttendances` cards + `guestTerms` cards, deduped by term id with priority led > attended > membership-only (a term I lead never shows as guest; a term I RSVPed shows the attendance card, not the membership card). `guestCircles` therefore keeps a consumer (its terms) and stays in state.
- Membership-only card (a `guestCircles` term without my RSVP): the same guest Link card as attended terms, built from `TermResponse` + `GroupResponse` (`SpotkaniaView.tsx:127-156` literal construction is replaced by the real objects), showing date, group name, description, `TermPlaceLine withMapLink={false}` from `term.location` and a "Y miejsc" pill from `term.capacity` (no count: `attendee_count` is null for non-organizers on `GET /api/terms`); link via `termPublicPath(group, term.id)`.
- Delete `groupExtras` (state `:293`, writes `:604-609, 970-984`, read `:935-940`, export `:1144`) and `editGroupForm.location/freeSpots`; `groupForm`/`editGroupForm` hold `defaultLocationId`/`defaultCapacity` instead.
- `handleAddGroup` -> `createAdditionalMyCircle({ name, visibility, default_location_id, default_capacity })`.
- `saveEditGroup` -> `PATCH /api/groups/{id}` with `{ name, layout_mode, visibility, default_location_id, default_capacity }` (send `null` to clear) through a new `updateGroup(id, request)` in `api/groups.ts`; `updateGroupLayoutMode` and its callers stay valid.
- Add-term form state gains `locationId: string | null`, `capacity: number | null`; on group select prefill from the chosen group's defaults; `handleAddTerm` sends them (explicit `null` when cleared).
- `relevantGroupsForForm` -> led groups (`myGroups`) only (terms can only be added to led groups).
- Home "Najbliższe terminy": dedupe by term id (led > attended > membership-only) over led + attended + membership-only cards, upcoming only, sort by `occurs_on`, take 3. The lower Home section "Zapisane zajęcia" (`HomeView.tsx:186-194`) excludes attendances already rendered in the top-3, so an attended term never appears twice on Home.
- `organizerTermCard` renders `TermPlaceLine` (with Maps link) and appends " · X/Y miejsc" to `signupSummaryChip` when `capacity` is known (`attendee_count` is available for organizers).

Hint matrix (`HomeView.tsx:70-119`), each dismissible per account via the existing `hintKey()`; new keys for new titles (`hint_create_group_dismissed`, `hint_create_org_dismissed`); the old `hint_become_organizer_dismissed` and `hint_first_term_dismissed` keys (`PanelDataContext.tsx:259-281`) are removed with their state/setters (`hint_org_polish_dismissed`, `hint_org_first_term_dismissed` stay). Hints **stack in matrix order**: every row whose condition holds renders (rows 2 and 4, or 3 and 4, commonly appear together, as org-polish + org-first-term do today); row 1 is exclusive with the others by construction:

| Condition | Title | Description | CTA | Target |
|---|---|---|---|---|
| `myGroups.length === 0` | "Załóż grupę" | "Zbierz znajomych lub rodziny i ustal pierwsze spotkanie — bez zakładania organizacji." | "Zacznijmy →" | `setModal("zaloz-grupe")` |
| `myGroups.length > 0 && organizationSlug === null` | "Stwórz wizytówkę" | "Publiczna strona z własnym adresem dla Twoich grup." | "Przejdź →" | `ctaTo="/organization"` |
| `myGroups.length > 0 && organizationSlug !== null` | "Dopracuj stronę organizacji" (unchanged) | unchanged | "Przejdź →" | `/${slug}?edit=1` |
| `myGroups.length > 0 && ledTerms.length === 0` | "Dodaj swój pierwszy termin" (unchanged) | "Ustal pierwsze spotkanie w swojej grupie." | "Dodaj termin →" | `setFirstTermForOrganizer(true); setModal("pierwszy-termin")` |

Hints no longer branch on `isOrganizer`/guest status; a user can see "Załóż grupę" while also having attended terms.

### 7.8 Wording changes (every status-level occurrence)

| File:line | Today | Change |
|---|---|---|
| `components/panel/FirstTermStepperGuest.tsx:20-21, 27` | comments about "Zostań organizatorem" / org step | Remove with the org step |
| `FirstTermStepperGuest.tsx:102` | title switch "Zostań organizatorem" / "Dodaj pierwszy termin" | "Załóż grupę" |
| `FirstTermStepperGuest.tsx:165` | field "Nazwa kręgu" | "Nazwa grupy" (via `GroupFormFields`) |
| `FirstTermStepperGuest.tsx:105-127` | done copy mentioning krąg | Copy per mockup 1c |
| `pages/panel/PanelModals.tsx:92-104` | modal `"zostan-organizatorem"`, toast "Jesteś organizatorem — dodano pierwszy termin" | Remove kind; toast "Grupa założona — dodano pierwszy termin" |
| `pages/panel/PanelModals.tsx:151, 213` | "Lokalizacja" | "Stałe miejsce spotkań (opcjonalnie)" via `GroupFormFields` |
| `pages/panel/panelHelpers.ts:29` | `"zostan-organizatorem"` in `ModalKind` | Replace with `"zaloz-grupe"` |
| `pages/panel/views/HomeView.tsx:71-83` | "Dodaj swój pierwszy termin" for `!isOrganizer` | "Załóż grupę" row of the matrix |
| `HomeView.tsx:85-94` | "Możesz zostać organizatorem" | Removed; replaced by "Stwórz wizytówkę" when groups exist and no org |
| `pages/panel/views/SpotkaniaView.tsx:158-176` | "+ Dodaj grupę" organizer-only; heading "Grupy" | Heading "Prowadzę · N"; button "+ Załóż grupę"/"+ Dodaj grupę" for everyone |
| `SpotkaniaView.tsx:220-229` | "wolne N miejsca" chip from `groupExtras` | Removed; default place name + address |
| `components/shared/AccountMenu.tsx:55-75` | no group item | + "Załóż grupę" menuitem |
| `src/test/PanelPage.test.tsx:614, 623, 627, 638, 652` | assertions on "Zostań organizatorem"/"Możesz zostać organizatorem" | Rewrite (section 9) |

Per-group role wording that stays: `RegisterPage.tsx:23-64`, `PrivateGroupGate.tsx:144-243`, `GroupVisualization.tsx:142/187/252`, `pages/krag/components/TermCard.tsx:31` ("Organizator nie dodał jeszcze żadnych zajęć."), `GroupHeader.tsx:46`, `PublicTermView.tsx:155`, `RequestAccessDialog.tsx:120`, `api/problem.ts:60`.

### 7.9 Display surfaces

- `components/shared/TermPlaceLine.tsx`: props `location: { name; formatted_address; google_place_id: string | null; notes: string | null } | null`, `capacity: number | null`, `attendeeCount?: number | null`, `withMapLink: boolean`, `className?`. Capacity text: `"X/Y miejsc"` when both known, `"Y miejsc"` when only capacity, nothing when capacity null. Renders `null` when location and capacity are both null. Tokens only (`text-ink-soft`, `bg-cream`), no raw colours (krag theme tests).
- `pages/krag/components/TermCard.tsx`: props `+ location`, `+ capacity`, `+ attendeeCount`; divider + "MIEJSCE" block (name, address, notes, "Otwórz w Google Maps" with `target="_blank" rel="noopener noreferrer"` and an sr-only "(nowa karta)"), "Zapisanych X z Y" when capacity known, `role="status"` pill "Brak wolnych miejsc" when `attendeeCount >= capacity`. All inside the existing `section aria-label="Termin zajęć"`. `PublicTermView.tsx` passes `term?.location ?? null`, `term?.capacity ?? null`, `term?.attendee_count`. `TermFooter` unchanged.
- `pages/panel/views/HomeView.tsx:134-163` and `SpotkaniaView.tsx:287-321` guest Link cards: render `TermPlaceLine` with `withMapLink={false}` (name + address, no nested anchor) from the card's location, plus a small `bg-cream` pill: attended cards "X/Y miejsc" from `attendance.attendee_count` (always a number) / `attendance.capacity`; membership-only cards "Y miejsc" from `term.capacity`; nothing when capacity is null.
- `SpotkaniaView.tsx:127-156` hand-built `TermResponse`/`GroupResponse` literals built from `MyAttendanceResponse`: carry the new nullable fields (`location: attendance.location`, `capacity: attendance.capacity`, `attendee_count: attendance.attendee_count`, `child_count: null`; `default_location: null`, `default_capacity: null` on the group literal) so `tsc` passes and the attended card reads the term's values; membership-only entries use the real `TermResponse`/`GroupResponse` from `guestTerms`.
- `api/groups.ts` `MyAttendanceResponse` (~514-523): `+ location: PublicLocationResponse | null`, `+ capacity: number | null`, `+ attendee_count: number` (non-null).
- `pages/AdminTermsPage.tsx`: columns `["Date","Circle","Description","Miejsce","Signups","Children","Miejsca"]`; "Miejsce" cell name (`fontWeight 500`) + address (12px, `#64748B`) or "—" italic `#94A3B8`; "Miejsca" cell `` `${attendee_count} / ${capacity}` `` or "—". Never a bare number.
- `api/groups.ts`, `api/terms.ts`: mirror every schema change with nullable/optional TS fields (`default_location: LocationResponse | null`, `default_capacity: number | null`, `location`, `capacity`, `attendee_count` on `PublicTermResponse`; request types with `location_id?: string | null`, `capacity?: number | null`, `default_location_id?: string | null`, `default_capacity?: number | null`).

### 7.10 `EditTermDialog.tsx`

State gains `locationId` (initial `term.location?.id ?? null`) and `capacity` (initial `term.capacity`); fields "Miejsce" (picker with `fallbackLocation={term.location}` so a soft-deleted place renders as "(usunięte)") and "Ile miejsc" after "Opis"; `saveTermFields` diff includes `location_id`/`capacity` only when changed, sending `null` to clear. Needed-items section unchanged.

### 7.11 Accessibility (binding, from `standards/frontend/accessibility.md` and the mockups)

Labelled inputs (`aria-label` = visible label), `role="alert"` for errors, `role="status"` for the capacity-full pill, radiogroup/radio with roving tabIndex, combobox/listbox ARIA, Esc handling scoped to the Esc-aware dialogs (the delete-location confirm alertdialog and krag `ModalSheet`; the panel `ModalSheet` hosts have no Esc handler, so the rule costs nothing there), no nested anchors inside Link cards, no icon-only controls, focus management described in 7.4, hamburger item `role="menuitem"`. Every blocking dialog registers via `useRegisterOpenSheet`; the delete-location confirm must do so too (pattern `DeleteGroupDialog`).

## 8. Technical Approach (data flow)

`LocationPicker` -> `useMyLocations` (`GET /api/locations/mine`) / `createLocation` (`POST /api/locations`, 200 or 201) -> `locations.id` -> `default_location_id` (group forms) or `location_id` (term forms) -> backend validates ownership through `locations_acl.get_owned_location` against the caller's PERSON party -> stored as a plain FK column -> `create_term` copies group defaults by value when fields are omitted -> read endpoints batch-load `get_locations_by_ids` (including soft-deleted) and attach `LocationResponse`/`PublicLocationResponse` after `model_validate` -> rendered by `TermPlaceLine`/`TermCard`/`AdminTermsPage`; `attendee_count` (active) vs `capacity` drives "Brak wolnych miejsc" without touching RSVP.

Two Party ids are in play and must not be confused: `Group.party_id` (per-circle ORGANIZATION party) vs `Location.owner_party_id` (the human's PERSON party from `get_profile_by_principal(...).party_id`).

Suggested delivery order (for the planner): (1) `app/locations` + 0057 + matrix + tests; (2) 0058 + groups/terms schemas, ACL, inheritance, public `attendee_count` + tests; (3) frontend env/loader/api/hook + `LocationPicker` (manual first, then Google) + tests; (4) `GroupFormFields`, stepper, modals, `PanelDataContext`/views/hints/AccountMenu + test updates; (5) display surfaces (`TermPlaceLine`, `TermCard`, `EditTermDialog`, `AdminTermsPage`) + test updates.

## 9. Implementation Guidance

### 9.1 Testing approach

2–8 focused tests per implementation step group; test verification runs only the new/updated tests, not the whole suite. Backend: `cd src/backend && uv run python -m pytest tests/<file>` (Docker required for testcontainers); frontend: `cd src/frontend && npm test -- <file>`, plus `npx tsc -b` and `npm run lint` at the end. Do not run `env`, `printenv` or `cat .env`.

Backend — new tests
- `tests/test_locations.py`: create MANUAL (201) and GOOGLE (201); `/mine` lists only own active rows; PATCH name/notes (200), PATCH address on a GOOGLE row (409); non-owner PATCH/DELETE (403); DELETE then `/mine` excludes and PATCH/DELETE on the deleted row (404); POST the same active place_id twice -> 200 with the same id; re-adding after delete -> 201 new row; validation: GOOGLE without place_id/coords, MANUAL with place_id, blank address (400).
- `tests/test_locations_migration.py` (template `test_group_soft_delete_migration.py`): downgrade to 0056 and back; columns/indexes/FKs exist after upgrade; 0058 downgrade drops FKs before 0057 drops the table.
- `tests/test_authorization_matrix.py`: the three `/api/locations` rows resolve to the expected permissions; GET/POST/PATCH/DELETE on `/api/locations...` never fall to the catch-all.
- `tests/test_group_location_defaults.py` (or extend `test_groups.py`): `/mine/new` with defaults -> `GroupResponse.default_location` nested + `default_capacity`; `default_location_id` of another user -> 403; soft-deleted id newly assigned -> 404; PATCH `null` clears; PATCH omitting the fields keeps them; `GET /api/groups` list rows carry `default_location` populated (batched); `lat`/`lng` serialize as JSON numbers.
- `tests/test_term_location_capacity.py`: term created without fields inherits group defaults by value; explicit `null` suppresses inheritance; explicit own location overrides; changing the group default later leaves the term unchanged; PATCH clears; `GET /api/terms` list attaches `location` with one batched query (assert with `count_queries` that the count does not grow with term count); moderation list carries `location`/`capacity`; public circle view returns `term.location` (no `owner_party_id` key), `capacity`, `attendee_count` excluding withdrawn RSVPs; a soft-deleted location still renders on the public term; `GET /api/groups/mine/attendances` returns `location` (soft-deleted still rendered, no `owner_party_id`), `capacity` and `attendee_count` per attendance with a query count that does not grow with the number of attendances.

Backend — existing tests to update (reason)
- `tests/test_public_term.py:180-198, 243-249` — exact key sets of `PublicCircleResponse`/`term` gain `location`, `capacity`, `attendee_count`.
- `tests/test_authorization_matrix.py:43-60, 161-192` — parametrized table gains the locations rows.
- Migration tests (`test_group_soft_delete_migration.py:63-79`, `test_organization_media_migration`, `test_organization_page_layout_migration`, `test_photo_moderation_attempts_migration`, `test_terms_circle_occurs_on_index_migration.py`) — they downgrade below head; they pass only if the 0057/0058 downgrades are correct (no edits expected; verify).
- `tests/test_domain_clock_guard.py` — no edit; new groups code must comply.
- `tests/test_my_attendances.py:114` — exact key set of `MyAttendanceResponse` gains `location`, `capacity`, `attendee_count`.
- `tests/test_groups_moderation.py:112-153`, `test_groups.py:570` — verify unchanged (nullable additions; no field containing "child").
- Verify-unchanged set (build/inspect group and term responses; additive nullable fields should pass, run them): `tests/test_circles_router.py`, `tests/test_organizer_terms.py`, `tests/test_organizer_page*.py`, `tests/test_public_preview.py` (`app/system/public_preview.py:21` consumes `PublicCircleResponse` for OG previews), `tests/test_notifications.py`, `tests/test_groups.py` (incl. the `GET /api/groups` list now carrying `default_location`).
- Not touched by design: `test_handover_copy_api.py`, `test_term_item_listings.py`, `test_term_end_scan.py` exact notification texts (notifications deferred); the ~40 files relying on server-default PUBLIC (backend default unchanged).

Frontend — new tests
- `src/test/LocationPicker.test.tsx`: manual mode without key (empty state shows the manual form; validation "Podaj adres"; save calls `createLocation` with `source:"MANUAL"` and selects the row); list state radiogroup selection and "Brak miejsca"; edit row (address read-only for GOOGLE); delete with confirm moves selection to null; "(usunięte)" row for a missing selected id; Google mode via `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key")` (set before mount, `vi.unstubAllEnvs()` in `afterEach`; works only because `isGoogleMapsConfigured` reads the env at call time) + `vi.mock("../lib/googleMaps")` returning the `fakePlaces`-backed `loadPlaces`/`suggest`/`resolve` from section 7.2 (suggestions in own listbox, Esc closes only the listbox and is `defaultPrevented`, pick -> prefilled name -> save with `source:"GOOGLE"` and numeric lat/lng, duplicate place_id selects the existing row without a request, `loadPlaces` resolving `null` falls back to manual with the alert).
- `src/test/googleMaps.test.ts`: loader contract per section 7.2 (null without key, null on script error, `importLibrary("places")` once, no call for blank input, fresh token after `resolve`), with `window.google` stubbed as described there.
- `src/test/useMyLocations.test.tsx`: shape, token in key, invalidation after create/remove, error passthrough.
- `src/test/CreateGroupStepper.test.tsx` (new, for the rewritten `FirstTermStepperGuest`): 2 steps, no "Nazwa organizacji", default PRIVATE without org / PUBLIC with org, `createAdditionalMyCircle` payload, step 2 prefilled from the created group, explicit `null` when cleared, done link via `termPublicPath`, CTA to `/organization` only without org.
- `src/test/TermPlaceLine.test.tsx`: Maps URL with/without place_id, capacity text variants, renders nothing when null, no anchor when `withMapLink=false`.

Frontend — existing tests to update (reason)
- `src/test/PanelPage.test.tsx`: add `vi.mock("../api/locations")` and `createAdditionalMyCircle`/`updateGroup` to the groups factory (`:68-81`); `:614-653` org-step flow and "Możesz zostać organizatorem" replaced by the "Załóż grupę" hint/stepper; `:402-416, 478-547, 550-571, 732-790, 1857` title "Dodaj pierwszy termin" -> "Załóż grupę", `createMyCircle({name:"Nutki"})` -> `createAdditionalMyCircle({name, visibility:"PRIVATE", default_location_id:null, default_capacity:null})`; `createTerm` exact objects (`:522-528, 1476-1482`) gain `location_id`/`capacity`; `:1314` `updateTerm` exact object unchanged unless the dialog diff adds keys; `:1522-1580` `updateGroupLayoutMode(...)` exact args -> the new `updateGroup` payload; `:3018` "Lokalizacja" absent still passes; add-group tests assert "Stałe miejsce spotkań"; hints `:597-700` new titles/keys (stacking asserted: "Stwórz wizytówkę" and "Dodaj swój pierwszy termin" together for a leader without org and without terms); the 6 "hamburger promotion" tests `:397-445` are **deleted** (they fail at baseline because the panel has no "Menu" button — `openMenu()` `:392-395`); new test: `renderPanel("/panel/spotkania?nowa=grupa")` opens the "Załóż grupę" sheet once and the URL loses the param; fixtures/literals (`:128, 221-268, 436, 485, 534, 690`) gain nullable fields; `getMyAttendances` fixtures gain `location`/`capacity`/`attendee_count`; new both-contexts test (a user with a leadership also sees "Zapisane"); new membership test: `getMembershipsForFamily` mocked non-empty (today `[]` at `:362`) for a user without RSVP proves the membership circle's term shows under "Zapisane" and in Home's top-3 with its "Y miejsc" pill, and that a term both RSVPed and membership-visible renders once; new attended-card test (address line and "8/10 miejsc" pill rendered inside the Link card, no nested anchor); Home dedupe test (an attendance in the top-3 is absent from "Zapisane zajęcia").
- `src/test/FirstTermStepperOrganizer.test.tsx:10-16`: wrap with `createQueryWrapper()` and `vi.mock("../api/locations")`; labels unchanged.
- `src/test/EditTermDialog.test.tsx`: `vi.mock("../api/locations")`; fixtures gain `location`/`capacity`; new case: a cleared place sends `location_id: null`.
- `src/test/AdminTermsPage.test.tsx:15-24, 52-53`: fixture gains `location`/`capacity`; "Miejsca" renders "3 / 10" so `getByText("3")` still matches only Signups.
- `src/test/TermPage.test.tsx:46-80`: fixture gains `location`, `capacity`, `attendee_count`; new cases: location block + Maps link, "Brak wolnych miejsc" with the RSVP button still enabled (5 baseline failures noted, not caused by this task).
- `PublicLayout.test.tsx`: menu-item count +1 and a new assertion that the "Załóż grupę" `menuitem` has `href="/panel/spotkania?nowa=grupa"` (this is where the hamburger lives); `Sidebar.test.tsx`, `SidebarAuthIntegration.test.tsx`: menu-item counts +1 if they enumerate `AccountMenu` items.
- `termViewModel.test.ts`, `termAccess.test.ts`, `AdminGroupsPage.test.tsx`, `DeleteGroupDialog.test.tsx`, `TermAttendeesPage.test.tsx`, `useModerationGroups.test.tsx`: fixtures compile only if the new fields are optional/nullable (keep them so).
- `OnboardingWizard.test.tsx`, `OnboardingHandoff.test.tsx`: unchanged (`createMyCircle` keeps working).
- `themeDefects.test.tsx`, `themeTokenUsage.test.tsx`: new krag code uses tokens only.

### 9.2 Standards compliance

- `standards/backend/models.md`: `Mapped[]`/`mapped_column`, string-backed enums, plain FK-id cross-module references, no `relationship()`, no `Float` (`Numeric(9,6)`), no `__eq__` without a business key. Stale parts (Sequence PKs, "no soft delete") are superseded by the code — follow `app/core/base_model.py` and migrations 0041/0054/0056; flagged for a standards update.
- `standards/backend/migrations.md`: hand-written, reversible, small, named constraints, schema/data separated, indexes deliberate. Stale PK guidance as above.
- `standards/backend/queries.md`: batched `IN` lookups, no N+1, explicit ordering, budgets respected.
- `standards/backend/security.md`: `Depends(require_any(...))` via `ReadPrincipal`/`EditPrincipal`, matrix rows before the catch-all with a test, owner from the principal's profile, 401/403 envelopes untouched.
- `standards/backend/api.md`: plural nouns (`/api/locations`), `/mine` sub-resource, 201/204, PATCH partial.
- `standards/backend/time.md`: `datetime.utcnow()` for `deleted_at`; `clock.local_now()` for domain "now"; no `datetime.now()`/`date.today()` in groups application/router.
- `standards/global/minimal-implementation.md`: no speculative abstractions (section 5.2 "Not created").
- `standards/global/validation.md` / `error-handling.md`: server-side shape validation with specific messages; typed exceptions (404/403/409).
- `standards/frontend/data-fetching.md`: hook in `src/hooks/` wrapping `src/api/locations.ts`, array keys with a prefix constant, token in the key, `await invalidateQueries`, app-shaped return, `dayjs` from `utils/dayjs.ts`.
- `standards/frontend/components.md`: single-responsibility `LocationPicker`, `GroupFormFields`, `TermPlaceLine` with explicit props.
- `standards/frontend/accessibility.md`: section 7.11; blocking dialogs register with `useRegisterOpenSheet`.
- `standards/frontend/css.md` / `responsive.md`: Tailwind tokens only; phone-first inside the 430 px sheet.
- `standards/testing/frontend-testing.md`: explicit Vitest imports, `createQueryWrapper`, `vi.mock` factories, `vi.resetAllMocks()` in `beforeEach`, pinned Date where a weekday matters.
- `standards/testing/backend-testing.md` is stale (Java/MockMvc); follow `tests/conftest.py` conventions (httpx client, `_register`/`_auth`, camelCase test names).
- `standards/global/conventions.md`: `.env` ignored, `.env.example` placeholders only; minimal dependencies (`@types/google.maps` dev only).

## 10. Out of Scope (carried from the brief and clarifications)

- Changes to the backend role model or endpoint permissions (beyond adding the `/api/locations` matrix rows).
- Blocking RSVP when full; waitlist.
- Embedded map on the term page; distance search; server-side geocoding or any backend Google call; refreshing cached lat/lng/address.
- Sharing locations between users (locations are private to the owner).
- Group picker in the term form beyond led groups; item search.
- Registration onboarding changes (`components/onboarding/steps/organizerSteps.tsx`) beyond what component reuse forces; `POST /api/groups/mine` semantics.
- Notifications (place in notification text) — follow-up.
- Organizer public pages (`OrganizerTermsPage`, `UpcomingTermsBlock`, `OrganizerTermResponse`) location/capacity — follow-up.
- A literal `/krag/` route or slug change; text moderation of location fields; CSP headers.

## 11. Success Criteria (acceptance, adjusted per decisions)

1. A logged-in user without groups sees "Załóż grupę" (Home hint, Spotkania button, and the public-page hamburger deep link `/panel/spotkania?nowa=grupa`), completes 2 steps (group, first term) and lands on a done screen whose link opens the public term page without an Organization (`/<k-hash>/grupa/<id>/term/<id>` via `termPublicPath`; the "/krag/..." wording is reinterpreted as "works without an organization").
2. A group founded this way has `visibility=PRIVATE` unless the user changed it; a user with an Organization gets `PUBLIC` by default. Backend tests relying on the server default `PUBLIC` keep passing.
3. Nowhere in the panel is naming an organization a mandatory step before founding a group; no status-level "organizator" copy remains (section 7.8 list).
4. The user searches a place in Google, saves it with their own label, and sees it in the picker list for the next group and the next term without searching again; a duplicate place_id selects the existing row.
5. Without a Google key the user adds a place manually and the whole flow (group, term, public page) works; tests and CI run without a key.
6. Place and capacity entered on a group survive a page refresh (server-stored) and appear prefilled in the new-term form; `groupExtras` is gone.
7. A term with an overridden place shows it (name, address, Google Maps link) on the public page and in the panel; changing the group default does not change existing terms. (Notification text is explicitly excluded.)
8. Deleting a saved location does not break existing terms/groups that reference it (they still render it, with "(usunięte)" in pickers) and removes it from the selection list.
9. The public term page with `attendee_count >= capacity` shows "Brak wolnych miejsc" and RSVP still works; `attendee_count` counts only non-withdrawn signups.
10. `AdminTermsPage` shows "Miejsce" and "Miejsca" ("3 / 10" or "—").
11. The panel shows led and guest contexts at once (Home merged top-3, Spotkania "Prowadzę"/"Zapisane"); a family member of a circle without an RSVP still sees that circle's upcoming terms under "Zapisane" (no regression vs. today's guest view); no term card is rendered twice on Home.
12. Migrations 0057/0058 upgrade and downgrade cleanly in the migration tests; the authorization matrix test covers `/api/locations`; organizer query-budget tests still pass; `npx tsc -b`, `npm run lint`, `uv run python -m ruff check` pass; mypy does not regress beyond the baseline.

## 12. Risks and Known Limitations

- Google key and cost: the key lives only in the frontend build, referrer-restricted; session tokens; no request without input; the key must never be printed in tool output, reports, screenshots or commits. Loader failure degrades to manual mode.
- Google Places caching terms: `google_place_id` may be stored indefinitely; `formatted_address`/`lat`/`lng` are cached data subject to Google's limits (refresh out of scope — document in the module docstring and `.maister/docs/project/architecture.md`). Displayed addresses may drift from Google over time.
- Existing groups/terms have null location/capacity after migration; every surface hides the row (never "null").
- Soft-deleted locations referenced by old terms must render: the ACL by-id lookup includes deleted rows; only `/mine` filters.
- Empty groups/spam: the first term stays required in the stepper; moderation sees `term_count` per group (unchanged).
- Large test surface: ~10 backend and ~12 frontend test files change by design (section 9.1); exact-arg assertions must be updated together with the code, not loosened.
- `PanelDataContext.tsx` is a 1221-line imperative context; the both-contexts change is kept minimal inside `load()` and must not migrate group/term loading to hooks.
- Two Party ids (circle ORGANIZATION party vs the human's PERSON party): ownership must compare against the caller's `profile.party_id`.
- `UpdateGroupRequest` keeps lenient unknown-key handling (no `extra="forbid"`) to avoid breaking existing callers; only the four new fields get `model_fields_set` semantics.
- Orphan groups: a user who closes the stepper at step 2 keeps a group without terms (unchanged from today); the "Dodaj swój pierwszy termin" hint and moderation's `term_count` are the mitigations; no close-confirm dialog.
- Google Places (New) typings: `@types/google.maps` must be recent enough to expose `AutocompleteSuggestion`, `Place.fetchFields` and `importLibrary`; if `fetchFields` does not accept `sessionToken` in the installed typings, pass the token only to `fetchAutocompleteSuggestions` and retire it after selection.
- Import boundary between `app/groups/schemas.py` and `app/locations` (section 6.4): resolve through the ACL re-export; watch for cycles.

## 13. Open Follow-ups (not part of this task)

- Notifications: append the place to term notification text (500-char cap via `clock.fit_notification_message`) or add structured fields; update exact-text tests.
- Organizer public pages (`OrganizerTermsPage`, `UpcomingTermsBlock`, `NextTermCtaBlock`): show place/capacity.
- Consider deleting `FirstTermStepperOrganizer` in favour of the general term modal with the group preselected.
- Standards update via `/maister:standards-update`: `models.md` (UUID PKs, soft delete exists, groups BC has no relationships), `migrations.md` (UUID/`gen_random_uuid()`), `testing/backend-testing.md` (pytest + testcontainers), `security.md` test-suite note.
- Optional: CSP allowing `maps.googleapis.com` if a CSP is ever introduced.

## Revision 3 (2026-10-20, user-approved)

Supersedes the conflicting parts of B9/B10/B13, section 4 (`component:location-picker-list`, `component:location-picker-edit` rows), section 6.4 and section 7.4.

- **Group 10 — location management moved to `/panel/miejsca`** ("Moje miejsca", `MiejscaView`), reachable from `AccountMenu` right after "Ustawienia". Renaming, editing notes/address and deleting saved places happen only there.
- **Forms use a native `<select>` + "+" button** that expands an inline `LocationAddForm` (Google autocomplete or manual entry, never a nested sheet). The picker has no per-row "Edytuj"/"Usuń" and no radiogroup; this supersedes B13's inline edit/delete, the picker-list/-edit rows in section 4 and the radiogroup contract in section 7.4. A soft-deleted current selection still shows with "(usunięte)".
- **Public `attendee_count` confirmed** (B11): it stays on `PublicTermResponse`.
- **READ-level location shape narrowed**: `GroupResponse.default_location` and `TermResponse.location` (served by `GET /api/groups`, `/api/groups/{id}`, `/api/terms`, `/api/terms/{id}` and the create/update responses) use `LocationRefResponse` = `{id, name, formatted_address, google_place_id, notes, deleted_at}` — no `owner_party_id`, no `lat`/`lng`, no `source`/timestamps. The full `LocationResponse` is returned only by `/api/locations/*`; public, attendance and moderation payloads keep `PublicLocationResponse`.
- **Unchanged location ids are not re-validated**: `PATCH /api/groups/{id}` checks ownership only when `default_location_id` is present, non-null and differs from the stored value; `PATCH /api/terms/{id}` only when `location_id` is non-null and differs from the term's current place; `POST /api/terms` skips the check when the supplied `location_id` equals the Circle's `default_location_id` (treated as inherited, so a soft-deleted default is accepted). A newly assigned soft-deleted id is still 404 and another party's id still 403.
