# Codebase Analysis Report

**Date**: 2026-11-03
**Task**: Mandatory location on item creation + OLX-style locality in the add-location form
**Description**: (1) When creating an item (ItemCreateView, /add/product), make location mandatory, reusing the same LocationPicker used on term and event forms, where "+" navigates to /places/new. (2) Rework the add-location form (LocationAddForm / PlaceCreateView /places/new) to only 2 fields: "Lokalizacja" (required, OLX-style locality: voivodeship + city/town/village, findable also by postal code or village name, no exact address) and "Adres" (optional, exact address mainly for terms/events).
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## TL;DR
- Items have **no location of their own**. Location is on the owner's PERSONAL inventory (`inventories.location_id`, migration 0075), and the item create API has no location field. "Location required on item create" can be done by setting the inventory location in the create flow, or by adding a new item-level column.
- `LocationPicker` always renders a "none" option and has no required mode. Its page mode (`+` → `/places/new`) only works if the host form keeps its state across the round trip. `ItemCreateView` keeps all of its state, including photo `File[]`s, in local `useState`, so that state is lost today.
- The `locations` table has no locality, voivodeship or postal-code columns. `formatted_address` is `NOT NULL` and is shown unconditionally on about 10 display sites, so making "Adres" optional is a cross-cutting schema change plus display change.
- The repo has no TERYT, voivodeship or postal data. The only geo source is client-side Google Places, which needs `includedPrimaryTypes` (locality / postal_code / sublocality) and `addressComponents` to produce OLX-style localities. The backend never calls Google.

## Key Decisions
- **Reuse `inventories.location_id` for item location instead of adding `inventory_items.location_id`.** Personal pickup gating (`find_personal_inventory_live_location_id`, `reservation_context.py:284`) and `/actions` `_viewer_location` already read it. A per-item column would mean rewriting those paths and would break 20 backend test files that POST `/api/inventory-items` without a location. This needs user confirmation (see Open Questions).
- **Add new nullable locality columns to `locations` (migration 0078) and make `formatted_address` nullable**, rather than putting a voivodeship-plus-city string into `name` or `formatted_address`. Locality must stay structured so it can be searched by postal code or village and shown publicly while the address stays private.
- **Extend `LocationPicker` with a `required` prop** (hide the "none" option, add validation and `aria-invalid`) rather than forking it. Five other hosts depend on today's optional behaviour.
- **Lift `ItemCreateView` form state into a draft store** (the `AppDataContext` pattern used by `eventDraft`/`eventBanner`) before switching it to page mode. Otherwise the `/places/new` round trip throws away the typed item and photos.
- **Keep Google Places as the locality source**, configured with type filters and `addressComponents`. Bundling TERYT data would add a large dataset and a dependency the project has avoided so far (minimal-dependencies standard).

## Open Questions / Risks
- **Per-item or per-owner location?** The wording "location mandatory when creating an item" could mean one location for all of my items (today's model) or a location per item. The answer changes the whole backend scope.
- **Is the requirement enforced by the backend or the frontend only?** Backend enforcement on `POST /api/inventory-items` breaks about 20 test files unless a conftest helper sets a location first. Items created before this change (with no location) need a defined behaviour.
- **Fallback when Google is unavailable or the key is unset.** Manual mode exists today. An OLX-style locality typed by hand cannot be validated without a dataset, so the manual-mode rules for "Lokalizacja" need to be decided.
- **Postal-code search.** Google autocomplete with `postal_code` in the types does return postal codes, but these resolve to a code area, not a town. The task needs a rule for mapping a code to its locality.
- **Existing rows.** Existing `locations` rows have `formatted_address` and no locality. A backfill is needed (parse it from the address, or leave locality null as legacy), and readers have to tolerate a null locality.
- **Privacy.** Today non-owners see the place `name`, which the `InventoryLocationCard` copy promises. With the rework, locality should become the publicly visible part and the address should stay owner-only or limited to term/event participants. The `ItemLocationResponse`, `PublicLocationResponse` and `LocationRefResponse` contracts all change.
- **What happens to "Nazwa miejsca" and "Notatka"?** The task leaves only 2 fields, but `name` is `NOT NULL` and is used as the label in the picker options, `location_name` and metadata. Either derive `name` from the locality (plus address) or make it nullable.
- **Display sites that assume an address.** `buildMapsUrl`, `TermPlaceLine` (type requires a `formatted_address` string), `EventWhenCard` (always renders the address and a Maps link), `TermCard`, `AdminTermsPage`, `GroupDetailsPage`, `GroupsView`, `PlacesView`, `LocationPicker:133`. Each needs a null-safe fallback to the locality.
- **Test gaps.** There are no direct tests for `EventForm`, `AddTermView`, `PlaceEditView` or `LocationAddForm` on its own, and none for `InventoryLocationCard` outside `MyItemsView`.
- `InventoryLocationCard.tsx` shows as modified in git, but the change is CRLF line endings only. Leave it alone or normalise it, but don't let it hide real diffs.

---

## Summary

Locations are a self-contained `app/locations` module (per-person `Location` with Google or MANUAL source). Other modules reach it only through three ACLs (circulation, groups, events), using four nullable FKs. Items inherit their location from the owner's PERSONAL inventory, which also gates personal pickup. The frontend shares one `LocationPicker` and one `LocationAddForm` across term, event, group and inventory hosts. Both requested changes are therefore cross-cutting: one is a UI and data-flow change on item create, the other a schema and contract change to locations that reaches roughly 10 display sites and around 25 test files.

---

## Files Identified

### Primary Files

**src/frontend/src/components/shared/LocationAddForm.tsx** (369 lines)
- Google Places (New) autocomplete mode (ARIA combobox, 300ms debounce) plus a manual fallback. Fields: Nazwa (required), Adres (required in manual mode), Notatka. Posts `CreateLocationRequest`.
- This is the form being reworked to "Lokalizacja" plus "Adres". It exports `LOCATION_INPUT_CLASS`/`LOCATION_ERROR_CLASS`, which PlacesView, PlaceEditView, LocationPicker and InventoryLocationCard use.

**src/frontend/src/components/shared/LocationPicker.tsx** (149 lines)
- Props: `value, onChange, label, noneLabel, idPrefix, fallbackLocation?, helperText?, addMode ("page" | "inline")`. In page mode, `+` links to `placeCreatePath(returnTo, idPrefix)`. On return it auto-selects through the `PickedLocationState` nav state (a `handledPick` ref, then focus).
- It always has a "none" option, so it needs a required mode. Line 133 shows `selected.formatted_address`.

**src/frontend/src/features/items/ItemCreateView.tsx** (155 lines)
- `/add/product` (route `app/(site)/(panel)/add/product/page.tsx`). Contains `NewPhotosField` (local `File[]`), `ItemQuickAddForm` (Nazwa, Stan, Kategoria, Opis), and the GIFT/SWAP/draft buttons. `fieldsMissing` uses `aria-disabled` plus the hint `item-create-missing-fields` ("Podaj nazwę i wybierz kategorię…").
- This is the host for the new mandatory picker. All of its state is local `useState`.

**src/frontend/src/features/places/PlaceCreateView.tsx** (42 lines)
- `/places/new`. Validates `returnTo` with `isSafeReturnPath`, shows a toast, then `navigate(returnTo, {state:{pickedLocation:{picker, locationId}}})`.

**src/frontend/src/hooks/useCreateItem.ts** (78 lines)
- `getMyProfile` → `getOrCreatePersonalInventory` → `resolveProduct` → `registerInventoryItem` → optional description and photos → navigate. This is the natural place to `PUT /api/inventories/mine/location` before registering.

**src/frontend/src/lib/googleMaps.ts** (167 lines)
- `isGoogleMapsConfigured` (reads env on each call, presence only), `loadPlaces` (memoized, 10s timeout), `suggest` (`fetchAutocompleteSuggestions` with `language/region: "pl"` and **no `includedPrimaryTypes`**), `resolve` (fetches only `id, formattedAddress, location, displayName`, **not `addressComponents`**), `newSessionToken`, `buildMapsUrl`.

**src/backend/app/locations/models.py** (52 lines)
- `Location`: `owner_party_id`, `name` String(255) NOT NULL, `formatted_address` String(500) NOT NULL, `google_place_id`, `lat`/`lng` Numeric(9,6), `notes` String(500), `source` GOOGLE|MANUAL, `deleted_at`. Partial unique index on `(owner_party_id, google_place_id)`. No locality, voivodeship or postal columns.

**src/backend/app/locations/schemas.py** (113 lines)
- `LocationResponse`, `LocationRefResponse`, `PublicLocationResponse`. `CreateLocationRequest` has `extra=forbid`, whitespace stripping, `name` 1–255, `formatted_address` 1–500 required, and a validator where GOOGLE requires place_id + lat + lng and MANUAL forbids them. `UpdateLocationRequest`.

**src/backend/app/locations/service.py** (132 lines)
- GOOGLE dedupe (returns 200 on a duplicate, with a savepoint for races), `GoogleAddressNotEditable` 409, soft delete, `get_own_location` (404 → 403). There is no repository.py; queries live here.

**src/frontend/src/api/locations.ts** (~77 lines)
- TS types (`formatted_address: string` at lines 11, 28, 37, 47) and CRUD calls (`/locations/mine`, POST, PATCH, DELETE).

### Related Files

**Frontend, location flow**
- `src/frontend/src/hooks/useMyLocations.ts` (~103): list and create, dedupes by `google_place_id`. Used by LocationPicker, PlaceCreateView, PlaceEditView and PlacesView.
- `src/frontend/src/features/items/InventoryLocationCard.tsx` (~58): "Gdzie są moje rzeczy?" on MyItemsView. Inline picker with `idPrefix="inventory-location"`. Its copy says others see only the place name.
- `src/frontend/src/hooks/useMyInventoryLocation.ts` (~60); `src/frontend/src/api/inventories.ts` (~172; GET/PUT `/inventories/mine/location` at ~155–172; legacy free-text `InventoryResponse.location`).
- `src/frontend/src/features/places/PlaceEditView.tsx` (~141; address editable only when `source === "MANUAL"`), `PlacesView.tsx` (~137; link at line 99, address at 73).
- `src/frontend/src/utils/appHelpers.ts` (`placeCreatePath` 15–19, `PickedLocationState` 22–24, `TermPlaceLocation` ~69–70).
- `src/frontend/src/routing/paths.ts` plus `app/.../places/new/page.tsx`, `places/page.tsx`, `places/[locationId]/edit/page.tsx`; `routing/navigation.tsx` nav entry.
- `src/frontend/src/features/panel/AppDataContext.tsx` (~136–171): draft store (`termLocationId`, `eventDraft`, `eventBanner`, `eventEdit`). This is the pattern to follow for an item draft.
- `src/frontend/src/utils/itemQuickAdd.ts`: the `ItemQuickAddValue` type.

**Frontend, other picker hosts** (regression surface for picker changes)
- `features/terms/TermEditForm.tsx:209` (inline), `terms/AddTermView.tsx:94` (page), `terms/FirstTermStepperOrganizer.tsx:119` (inline; type usage at line 28), `events/EventForm.tsx:171` (page, label "Miejsce (opcjonalnie)", used by both EventCreateView and EventEditView), `groups/GroupFormFields.tsx:78` (page).

**Frontend, display consumers of location data**
- `components/shared/TermPlaceLine.tsx:33` (`buildMapsUrl`, requires the address), `terms/components/TermCard.tsx:45`, `events/components/EventWhenCard.tsx:43–58`, `groups/GroupDetailsPage.tsx:178`, `GroupsView.tsx:105`, `items/product/ItemContextActions.tsx:359–385` ("Lokalizacja przedmiotu" plus `OwnLocationCard`), `itemActionsViewState.ts`, `admin/AdminTermsPage.tsx:66`, `lib/publicMetadata.ts:49` (name only).
- API types: `api/events.ts:22`, `api/groups.ts:29,196,519`, `api/terms.ts:17,32`, `api/inventories.ts:158`, `api/itemActions.ts:26` (`ItemLocationResponse`).

**Backend**
- `app/locations/router.py` (~67), `__init__.py` (Google caching policy doc). Registered in `app/main.py:37,162`. Auth matrix: `core/authorization_matrix.py:172` (PUT inventory location) and `205–209`.
- Migrations: `alembic/versions/0057_locations.py`, `0058_group_term_location_capacity.py`, `0070` (events.location_id), `0075_inventory_location.py`. The latest is `0077`, so the next is **0078**.
- Circulation: `infrastructure/locations_acl.py`, `application/inventory.py:81–107`, `router.py` (GET/PUT `/api/inventories/mine/location` 130–141; POST `/api/inventory-items` ~152–153), `schemas.py` (`CreateInventoryItemRequest:97`, `InventoryLocationResponse`/`SetInventoryLocationRequest` 51–60), `models.py` (`Inventory.location` free text plus `location_id` 168–195; `InventoryItem:199` has no location), `application/inventory_items.py`, `repository.find_personal_inventory_live_location_id`.
- Groups: `infrastructure/locations_acl.py` (`get_location`, `get_locations_by_ids`, `location_ref_response`, `public_location_response`, `get_owned_location`), `infrastructure/circulation_bridge.py:244`, `application/item_actions.py` (`_viewer_location` ~89–121, 195, 240; `location_name` 216, 232), `owner_items.py:163`, `reservation_context.py:284`, `schemas.py ~806` (`ItemLocationResponse`), `models.py:126,217`.
- Events: `infrastructure/locations_acl.py`, `models.py:46`, `page.py:143,191`.

**Prior task docs**
- `.maister/tasks/development/2026-10-19-simple-group-creation-and-locations/`
- `.maister/tasks/development/2026-10-31-product-page-reservations-visibility-location/`

---

## Current Functionality

### Key Components/Functions

- **LocationPicker**: a select over `useMyLocations` with a mandatory "none" option. `+` either navigates to `/places/new` (page mode) or opens an inline `LocationAddForm`. After a page round trip it picks up the new location once, using `useNavigationState`.
- **LocationAddForm**: Google mode (search, pick, show resolved address with "zmień", then Nazwa prefilled from `displayName`, then Notatka) or manual mode (Nazwa, Adres, Notatka). If Places fails to load or suggest, it falls back to manual with "Wyszukiwarka niedostępna — wpisz adres ręcznie". Validation messages: "Podaj nazwę miejsca", "Wybierz adres z listy", "Podaj adres".
- **Places API surface**: `GET /api/locations/mine`, `POST /api/locations` (201, or 200 on a GOOGLE duplicate), `PATCH`/`DELETE /api/locations/{id}` (soft delete). Changing the address of a GOOGLE location returns 409.
- **Item creation**: `useCreateItem` registers the item in the PERSONAL inventory with no location. The item's "location" is whatever `inventories.location_id` is (set separately in `InventoryLocationCard`).
- **Item location display**: `_viewer_location` returns name, address and `deleted_at` to the owner; the name only to other logged-in users when the place is live; nothing to anonymous users. A live inventory location is required for PERSONAL pickup reservations.

### Data Flow

```
Browser ──Google Places (client-side, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)──► suggestion/resolve
   │
   └─ LocationAddForm ─POST /api/locations─► locations (per person)
                                               ▲ FK (nullable): inventories.location_id (0075)
                                               │               groups.default_location_id (0058)
                                               │               terms.location_id (0058)
                                               │               events.location_id (0070)
ItemCreateView ─useCreateItem─► POST /api/inventory-items (no location)
InventoryLocationCard ─PUT /api/inventories/mine/location─► inventories.location_id
item_actions._viewer_location / reservation_context ◄─ inventories.location_id (via circulation_bridge)
```

---

## Dependencies

### Imports (What This Depends On)
- Google Maps JS Places (New) library, through `lib/googleMaps.ts` (`@types/google.maps` only, no SDK package).
- `useMyLocations` / TanStack Query; the routing facade (`useNavigationState`, `Link`); `AppDataContext` for drafts.
- Backend: SQLAlchemy `Location` model, the `parties` FK, Pydantic v2 schemas. The backend has no geo service (only httpx, unused for geo).

### Consumers (What Depends On This)
- **Picker hosts (6)**: AddTermView, TermEditForm, FirstTermStepperOrganizer, EventForm, GroupFormFields, InventoryLocationCard. ItemCreateView would be the 7th.
- **Display sites (~10)**: TermPlaceLine, TermCard, EventWhenCard, GroupDetailsPage, GroupsView, ItemContextActions, AdminTermsPage, PlacesView, LocationPicker, publicMetadata.
- **Backend ACLs (3)**: circulation, groups (circles, terms, public_view, owner_items, item_actions, events_acl) and events (service, router, page).

**Consumer Count**: ~20 files
**Impact Scope**: High. The shared form, the picker and the response DTOs are used by terms, events, groups and items, on both the public and owner side.

---

## Test Coverage

### Test Files

Backend (`src/backend/tests/`):
- `test_locations.py` (8), `test_locations_migration.py` (1), `test_inventory_location.py` (6), `test_inventory_location_migration.py` (1), `test_group_location_defaults.py` (7), `test_term_location_capacity.py` (11), `test_personal_pickup.py` (9), `test_personal_pickup_migration.py`, `test_item_actions.py` (6), `test_circulation.py` (25), `test_events.py`, `test_events_migration.py`, `test_authorization_matrix.py`.
- About 20 files POST `/api/inventory-items` without a location.

Frontend (`src/frontend/src/test/`):
- `LocationPicker.test.tsx` (11; mocks googleMaps; 197–221 assert the address), `PlacesView.test.tsx` (10; also covers PlaceCreateView), `useMyLocations.test.tsx` (3), `useMyInventoryLocation.test.tsx` (3), `ItemCreateView.test.tsx` (11; no location assertions), `MyItemsView.test.tsx` (14), `MyItemsViewCategory.test.tsx`, `TermEditForm.test.tsx` (11), `FirstTermStepperOrganizer.test.tsx` (4), `EventComponents.test.tsx` (8), `ItemDetailPage.test.tsx`, `itemActionsViewState.test.ts`, `TermPlaceLine.test.tsx`, `googleMaps.test.ts`, `AppPage.test.tsx`, `routeManifest.test.ts`/`panelPages.ts`.

### Coverage Assessment
- **Test count**: ~70 backend and ~90 frontend tests touch locations.
- **Gaps**: no direct tests for `EventForm`, `AddTermView`, `PlaceEditView` or `LocationAddForm` on its own; `InventoryLocationCard` is covered only through `MyItemsView`; nothing covers locality or address-null rendering. Per memory, there are 12 pre-existing vitest failures, which are not regressions.

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase `*View` / `*Form` / `*Card` in `src/features/<domain>/` and `src/components/shared/`.
- **Hooks**: `useMy*`, `useCreate*` in `src/hooks/`, wrapping `src/api/*.ts`.
- **Backend**: `app/<bc>/{models,schemas,service,router}.py`; cross-context access through `infrastructure/<other>_acl.py`; migrations `NNNN_<name>.py` with explicit constraint names.

### Architecture Patterns
- **Style**: functional React with discriminated view state for multi-screen pages; FastAPI routers with service functions; ACL-mediated bounded contexts.
- **State Management**: TanStack Query for server state; `AppDataContext` for cross-page form drafts; navigation state for picker handoff.
- **Relevant standards**: integer/validation inline errors (`role="alert"`, `aria-invalid`), `aria-disabled` plus hint for blocked submit, the combobox pattern (`LocationAddForm` is the reference), migrations with additive nullable columns in a separate revision, `SET LOCAL lock_timeout`, guarded downgrades, exact key-set response assertions, typed fixtures with no casts.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | 369 (LocationAddForm), others 42–167 | Medium |
| Dependencies | Google Places, Query, routing, AppDataContext, 3 ACLs | Medium |
| Consumers | ~20 files (6 picker hosts, ~10 display sites, 3 ACLs) | High |
| Test Coverage | ~25 test files; gaps on EventForm, AddTermView, PlaceEditView, LocationAddForm | Medium |

### Overall: Complex

Part 1 (mandatory item location) alone is Moderate: a picker required mode, an item draft store, and wiring the inventory location into `useCreateItem`. Part 2 (locality model) is Medium-High: a migration, the Places configuration, three response DTOs kept in lockstep with the TS types, the privacy rules, and null-safe address display everywhere.

---

## Key Findings

### Strengths
- Locations are well encapsulated: one module, three ACLs, nullable FKs, soft delete with "(usunięte)" rendering.
- The picker page-mode round trip already exists and works for terms and events, so it can be reused.
- Personal pickup gating already treats a live inventory location as meaningful. Requiring it at item create fits the existing domain.

### Concerns
- No locality data exists. The feature depends on Google Places configuration and has no offline fallback for validating localities.
- `formatted_address` NOT NULL is assumed in the DB, in Pydantic, in TS types and in about 10 display sites.
- `ItemCreateView` state, including photo `File` objects, would be lost on the `/places/new` round trip. Files cannot go into storage-backed drafts; they have to live in in-memory context.
- The item-level vs inventory-level ambiguity could double the backend scope if chosen wrongly.

### Opportunities
- Give `LocationPicker` a `required` prop and reuse it for terms and events later if the requirement spreads.
- A structured locality (voivodeship, locality, postal code) allows public "Kraków, małopolskie" display and future filtering or search of items by area.
- If the user's PERSONAL inventory already has a location, preselect it on item create so the extra step costs nothing.

---

## Impact Assessment

- **Primary changes**: `LocationAddForm.tsx`, `LocationPicker.tsx`, `ItemCreateView.tsx`, `useCreateItem.ts`, `PlaceCreateView.tsx`, `AppDataContext.tsx`, `lib/googleMaps.ts`, `api/locations.ts`, `app/locations/{models,schemas,service}.py`, new `alembic/versions/0078_*.py`.
- **Related changes**: `PlaceEditView.tsx`, `PlacesView.tsx`, `InventoryLocationCard.tsx`, the display sites (TermPlaceLine, TermCard, EventWhenCard, GroupDetailsPage, GroupsView, ItemContextActions, AdminTermsPage, publicMetadata), the API types (events, groups, terms, inventories, itemActions), the three backend ACL response builders, `item_actions._viewer_location`, `groups/schemas.py ItemLocationResponse`, and `architecture.md` plus the migrations runbook.
- **Test updates**: a new migration test (downgrade then upgrade head); updates to `test_locations.py`; exact key-set updates in response tests; `LocationPicker.test.tsx` (required mode, address-null); `ItemCreateView.test.tsx` (location required, draft survives the round trip); `PlacesView.test.tsx`; `googleMaps.test.ts` (types filter, addressComponents); new `LocationAddForm` tests. If enforced in the backend, a conftest helper is needed for the ~20 item-creating test files.

### Risk Level: Medium-High

There are many consumers across four bounded contexts. A contract change to shared DTOs (nullable address, new locality fields) and a NOT NULL relaxation need a guarded or lossy-aware downgrade. Locality quality depends on an external API that is not configured in every environment, and the privacy semantics of what non-owners see change.

---

## Recommendations

**Modifying existing code, plus a new capability (locality):**

1. **Item location (part 1)**
   - Keep the location at inventory level. In `ItemCreateView`, add `<LocationPicker required addMode="page" idPrefix="item-create-place" />`, prefilled from `useMyInventoryLocation`. In `useCreateItem`, call `PUT /api/inventories/mine/location` when the value changed, then `registerInventoryItem`.
   - Add an `itemDraft` (fields plus photo `File[]`) to `AppDataContext`, following `eventDraft`/`eventBanner`, so the `/places/new` round trip keeps everything. Clear it on successful create.
   - Extend `fieldsMissing` and the hint text ("…i wybierz lokalizację"). Keep the `aria-disabled` plus `aria-describedby` pattern.
   - Backend enforcement is optional: if wanted, return 409/422 on `POST /api/inventory-items` when the PERSONAL inventory has no live location, and add a conftest helper. Otherwise enforce in the frontend only and document it.
2. **Locality model (part 2)**
   - Migration 0078: add nullable `locality` (city/town/village), `voivodeship`, `postal_code` (optionally `country_code`) and make `formatted_address` nullable, using `lock_timeout`. Guard the downgrade while address-null rows exist, and document the runbook. Backfill existing rows lazily (null locality is legacy and is displayed using `formatted_address`/`name`).
   - Schemas: `CreateLocationRequest` gets locality required and address optional. Decide on `name`: derive it server-side as "{locality}" or "{locality}, {address}" so existing `name` consumers keep working with minimal churn. Add the locality fields to `LocationRefResponse`, `PublicLocationResponse`, `LocationResponse` and `ItemLocationResponse`, and update the TS types in lockstep.
   - `googleMaps.ts`: add a `suggestLocality()` that uses `includedPrimaryTypes: ["locality","sublocality","postal_code","administrative_area_level_3"]` and `includedRegionCodes: ["pl"]`, and a `resolveLocality()` that fetches `addressComponents` and maps `administrative_area_level_1` to the voivodeship and `locality`/`sublocality`/`postal_town` to the town. A postal-code pick resolves to its locality component. Keep the address autocomplete for the optional "Adres" field.
   - `LocationAddForm`: two fields. "Lokalizacja" is a required combobox (keep the existing ARIA combobox and Esc rules). "Adres" is optional (Google address search or free text). Define the manual fallback for locality when Places is unavailable.
   - Display: one helper, `formatLocationLabel(loc)` (locality plus voivodeship, then name), and a null-safe `buildMapsUrl`. Update all ~10 display sites. Public and non-owner item views show the locality only.
3. **Testing**: follow the 2–8 tests per feature rule. Use exact key-set assertions on the changed DTOs, add a migration test, and use typed fixtures (no casts) so DTO drift shows up in `tsc`.

---

## Next Steps

Invoke the gap-analyzer with this report. Before writing the specification, have the orchestrator resolve these with the user: (a) per-owner (inventory) vs per-item location; (b) backend vs frontend-only enforcement and how pre-existing items behave; (c) the fate of "Nazwa miejsca"/"Notatka" and how `name` is derived; (d) the locality fallback when Google is unavailable; (e) what non-owners see (locality vs name). A UI mockup of the 2-field form and the item-create picker placement is recommended.
