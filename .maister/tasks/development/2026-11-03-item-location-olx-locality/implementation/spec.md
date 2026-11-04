# Specification: Mandatory item location + OLX-style locality (TERYT) in the place form

## TL;DR
- A place becomes **Lokalizacja** (required TERYT locality from our own dictionary, searchable by name or postal code) plus an optional **Adres** (Google or typed). `name`/`notes` are dropped; responses carry a computed `label`.
- Every item gets its own required `location_id`: set on create, editable on `/items/:id/edit`, cleared on GIFT/SWAP, required to list a draft item. It replaces the removed `inventories.location_id` for personal pickup and the item page.
- The item's own location block shows everyone (anonymous too) the locality only; the owner alone gets its address. Term/event context lines keep the full place label, since those addresses are already public.
- Every `LocationPicker` uses page mode. Both legs of the `/places/new` trip replace the history entry. Drafts for item create/edit, term edit and the first-term stepper live in `AppDataContext` with defined clear points.
- Migrations: 0078 (dictionary tables), 0079 (chunked `unnest` seed from a committed gzipped fixture), 0080 (locations rework, item `location_id`, drop the inventory location). All have plain downgrades.

## Key Decisions
- **Dictionary lives in `app/locations`** (`Locality`, `LocalityPostalCode`), with the SIMC id as a `String(7)` natural PK on plain `Base`. This is a third PK carve-out next to `PluginDescriptor`/`RegisteredClient`, documented in `models.md`.
- **`Location.locality` is a same-module `relationship(lazy="raise")`**, always loaded through the new `app/locations/service.py` loaders (`joinedload`, `populate_existing`). This includes re-reading after POST/PUT commits and inside the three ACLs, so there is no `MissingGreenlet` and no stale locality.
- **Diacritic folding happens in Python** (`fold_polish`: NFKD, strip combining marks, explicit `ł/Ł → l`, lowercase, collapse whitespace). It is backed by a precomputed `name_search` column and a `text_pattern_ops` prefix index, with no `unaccent`/`pg_trgm`. The prefix `LIKE` escapes `%`, `_` and `\`.
- **Locality search is `GET /api/localities?q=&limit=`, READ-gated.** Ranking puts `TOWN` first (user decision: "towns ranked before villages"; the mockup shows "Nowa Wieś Ełcka · miasto" first), then exact folded-name matches.
- **`label` is computed server-side.** Without an address: "Kęty, małopolskie". With one: "Kęty — {formatted_address}".
- **Privacy scope (user decision, "Adres terminu publiczny").** The guarantee covers the item's own location block. `ItemLocationResponse` in `/actions` and `ItemDetailsResponse.location_id` never carry the item place's address, address-derived text or `label` for non-owners. Term/event context `location_name` keeps the full `label`, because that address is public on the term/event page anyway.
- **`PATCH /api/locations/{id}` becomes `PUT`** (full replacement). The `GoogleAddressNotEditable` 409 goes away.
- **No dedup.** Every POST creates a row. 0080 drops `uq_locations_owner_party_id_google_place_id`, and both dedups (backend and frontend) are removed.
- **Transfer clears `location_id` only for GIFT/SWAP** in `ledger._apply_projection`. REGISTER keeps it.
- **Listing guard applies only to DRAFT → ACTIVE.** `PUT /api/item-listing-preferences/{id}` answers 409 when no preference row exists yet, a non-null mode is requested, and the item has no live location. An already-listed item can still change mode or visibility. Soft-deleting a place leaves its items listed (accepted). Pickup becomes unavailable and the owner is prompted.
- **Item edit treats a soft-deleted place as "no location".** `ItemDetailsResponse.location_id` is owner-only and null when the place is soft-deleted. The picker starts empty with the banner, and any save requires a live place.
- **Page-mode round trip replaces history on both legs.** The picker's `+` link and `PlaceCreateView`'s return to `returnTo` (save and cancel) both use `replace: true`. History is unchanged after the trip, so the existing `navigate(-1)` in `ItemEditView` and `ItemBackButton` lands where the user came from.
- **A cancelled trip still hands back state.** `PickedLocationState.pickedLocation.locationId` becomes `string | null`, with `null` meaning cancelled. Pickers ignore a `null` pick, and the first-term stepper reopens on both a pick and a cancel.
- **`location_id` is not added to `InventoryItemResponse`.** That response is readable by any viewer who can see the item. The owner gets it from `MyInventoryItemResponse` and the owner-only `ItemDetailsResponse`.
- **0080 deletes all existing `locations` rows** (after nulling the 4 referencing FKs) before adding `locality_id NOT NULL`. This is a deliberate, documented deviation for the MVP with a DB wipe.

## Open Questions / Risks
- **Postal-code licence and format (GUGiK PRG).** Confirm during data prep. Fallback: an empty `locality_postal_codes`, the hint drops "albo kod pocztowy", and code queries return `[]`. The outcome goes in the fixture README.
- **Test-session cost.** All 22 migration tests downgrade below 0078, so each re-runs the 0079 seed on `upgrade head`. Mitigation is described in Technical Approach → Migrations (chunked `unnest`, `TRUNCATE` downgrade, ≤3 s target, a COPY fallback above a 2-minute overhead budget).
- **Same-place reuse.** If an owner uses one place for an item and a term, that place's address appears in the term context line on the item page. This is accepted, because the address is public on the term page. The item location block itself never shows it.
- **Browser Back on `/places/new`** skips the opener form, because the `+` leg replaced it. The opener's draft survives in `AppDataContext`. Accepted.
- **Fixture size** is estimated at 1–3 MB gzipped. Check it when the fixture is built.
- **A Google address can disagree with the chosen locality.** There is no server check (accepted).
- **The regression surface is wide.** About 20 backend files create items, 4 location DTOs have exact key-set tests, there are about 15 frontend display sites, and 19 frontend tests build location objects inline (addressed with the shared typed factories).
- **12 vitest failures already exist** and are not regressions. `InventoryLocationCard.tsx` has a CRLF-only diff and is deleted by this task.

## Goal
Make every item carry a required, owner-chosen place, shown publicly as an OLX-style locality. Reduce the place form to "Lokalizacja" (TERYT, name or postal code) plus an optional "Adres". Items, terms, events and groups all use it consistently through one page-mode picker.

## User Stories
- As an item owner, I want to choose where my item is when I add it, so buyers know the town without seeing my address.
- As an item owner, I want to add a new place with `+` without losing the name, category, description and photos I already entered.
- As the owner of a received (transferred) item, I want to set my own location before offering it again.
- As a buyer (logged in or anonymous), I want to see the item's town with gmina/powiat/województwo and open it in Maps.
- As a user adding a place, I want to find my village by name or postal code, and add an exact address only when needed (terms, events).
- As an organizer, I want the term/event place picker to work the same way, with my form kept intact when I add a place.

## Core Requirements

### Locality dictionary
1. Table `localities`:
   - `id`: SIMC SYM, 7 characters, PK.
   - `name`.
   - `name_search`: `fold_polish(name)`.
   - `kind`: `TOWN` when RM = 96, else `VILLAGE`.
   - `gmina`, `powiat`, `voivodeship`: lowercase TERC names.

   Only independent localities are included (SYM = SYMPOD).
2. Table `locality_postal_codes`:
   - `postal_code` (`NN-NNN`) and `locality_id` (FK, ON DELETE CASCADE), with a composite PK.
   - A prefix index on `postal_code`.
   - PRG points on a dependent SIMC are mapped to the independent root.
3. Build script `src/backend/scripts/build_localities.py`. This is a new directory.
   - Stdlib only, plus `app.locations.localities.fold_polish`.
   - It reads the downloaded GUS TERYT `SIMC`/`TERC` files and the GUGiK PRG address points; their paths are arguments.
   - It writes `alembic/data/localities_pl.csv.gz` and `alembic/data/locality_postal_codes_pl.csv.gz`.
   - Run it from `src/backend` with `uv run python scripts/build_localities.py --simc … --terc … --prg … --out alembic/data`.
   - It is linted by `uv run python -m ruff check app tests scripts`. mypy stays on `app` only (accepted).
4. `alembic/data/localities_pl.README.md` records the sources, "stan na", the download date, the licences, row counts, the filtering rules (independent only, part→root, postal normalisation) and the exact rebuild command. Its pattern is `vinted_categories_pl.README.md`.
5. Search `GET /api/localities?q=&limit=`:
   - `q` is trimmed. Fewer than 2 characters returns `{results: [], total: 0}`.
   - Postal mode: `q` matches `^\d{2}(-?\d{0,3})?$` and is normalised to `NN-…`. The result is the distinct localities with a matching code, each with its smallest matching `postal_code`.
   - Name mode: a prefix match on `name_search` against `fold_polish(q)`. The pattern is built through SQLAlchemy `startswith(..., autoescape=True)`, so `%`, `_` and `\` are escaped and the value stays a bound parameter.
   - Ranking: `TOWN` first, then exact folded match, then `name`, `voivodeship`, `powiat`, `gmina`.
   - `limit` defaults to 10. It must be 1–20, else 422.
   - `total` is the full match count, used for the "… i 412 więcej" line.
   - Response: `{results: [{id, name, kind, gmina, powiat, voivodeship, postal_code|null}], total}`.
   - Auth: matrix row `GET ^/api/localities$` → `READ`/`mcp:read`.
   - The endpoint uses 2 SQL statements regardless of result size.

### Locations (places)
6. `locations` schema changes:
   - Add `locality_id String(7) NOT NULL` with an FK (RESTRICT).
   - Drop `name` and `notes`.
   - Make `formatted_address` and `source` nullable.
   - Add `ck_locations_address_fields`: no address means `source`, `google_place_id`, `lat` and `lng` are all null; an address means `source` is not null.
   - Drop `uq_locations_owner_party_id_google_place_id`.
7. `POST /api/locations` body (`extra=forbid`):
   - `locality_id` (7 digits, required).
   - `formatted_address` (optional, 1–500, blank → null).
   - `source` (required with an address, forbidden without one).
   - `google_place_id`/`lat`/`lng`: GOOGLE requires all three, MANUAL forbids them.

   An unknown `locality_id` returns 404 `EntityNotFoundException("Locality")`. The call always returns 201 with a new row.
8. `PUT /api/locations/{id}` takes the same body and replaces both locality and address. Unknown or soft-deleted ids return 404, foreign ones 403. It replaces `PATCH`.
9. **Post-write reload.** `create_location` and `update_location` commit, then return `await load_location(db, id)`. `load_location` uses `joinedload(Location.locality)` with `execution_options(populate_existing=True)`, so a PUT that changed `locality_id` returns the new locality. They never return the refreshed instance with an unloaded or stale relationship. `get_own_location` uses the same `joinedload`.
10. Response shapes. Each carries `locality: {id, name, kind, gmina, powiat, voivodeship}` and `label`.

    | Shape | Fields |
    |---|---|
    | `LocationResponse` (owner) | `id, owner_party_id, locality, label, formatted_address, google_place_id, lat, lng, source, created_at, updated_at, deleted_at` |
    | `LocationRefResponse` (circle/term/event READ embeds) | `id, locality, label, formatted_address, google_place_id, deleted_at` |
    | `PublicLocationResponse` (public term/organizer views) | `locality, label, formatted_address, google_place_id, lat, lng` |
11. `GET /api/locations/mine` is ordered by locality name, then `created_at`. Soft delete is unchanged and allowed while items reference the place.
12. Term/event place strings use the full `label`:
    - `ItemContextOptionResponse.location_name` for term/event contexts.
    - The `owner_items.py` term rows.
    - `groups/infrastructure/events_acl.py` `UpcomingEvent.location_name`.

    These describe term/event places, which are public on their own pages. They are outside the item-location privacy guarantee (Req. 20).

### Item location
13. `inventory_items.location_id` is a nullable UUID FK → `locations.id`, with no ON DELETE action, plus a partial index `ix_inventory_items_location_id WHERE location_id IS NOT NULL`.
14. `CreateInventoryItemRequest.location_id: uuid` is required. `register_item` resolves the owner party (`repository.find_party_id_by_user_id`), then validates through `circulation/infrastructure/locations_acl.get_owned_location` (404 unknown or deleted, 403 foreign) before inserting. `get_owned_location` builds its `LocationRefResponse` from `load_location`.
15. `UpdateInventoryItemRequest.location_id: uuid | None = None` is optional. When present it must be a live owned place (same ACL); an explicit `null` returns 422. Changing it while a personal-pickup reservation is open is allowed. The reservation reads the item's current location live, so it moves with the item, and no notification is sent (accepted, out of scope).
16. Response fields:
    - `MyInventoryItemResponse` (owner's list, `groups/schemas.py`) gains `location_id`.
    - `ItemDetailsResponse` gains `location_id`, filled only when `is_owner` and the place is live; otherwise it is null.
    - `InventoryItemResponse` does **not** gain it, because `GET /api/inventory-items/{id}` is readable by non-owners.
17. Transfer: `ledger._apply_projection` sets `item.location_id = None` for GIFT/SWAP. REGISTER, REMOVE and legacy LEND/RETURN leave it untouched. The existing confirm path already deletes the giver's listing preference (`term_item_listings.py` ~1131–1141), so the received item arrives as DRAFT without a location.
18. Listing guard. In `set_item_listing_preference`, when `mode` is non-null **and no preference row exists yet** (DRAFT → ACTIVE), it raises `BusinessConflictException("Ustaw lokalizację przedmiotu, aby go wystawić")` (409) if the item has no live location.
    - Changing the mode or visibility of an existing preference is never blocked.
    - Clearing a mode is always allowed.
    - The check runs after the FOR UPDATE item read, using `circulation_bridge.get_item_live_location_id`.
19. Place soft delete with listed items: the listings stay ACTIVE (no cascade, no warning dialog).
    - Everyone still sees the locality.
    - Personal pickup is unavailable (409 on take, `personal_pickup_available = false`).
    - The owner's item page shows "(usunięte)" and "Odbiór osobisty niedostępny — ustaw lokalizację".
    - Item edit asks for a new place (Req. 31).

### Item page privacy and pickup
20. **Privacy guarantee (item location block).** `ItemLocationResponse` becomes `{locality, formatted_address, deleted_at}`, with no `name` and no `label`.
    - OWN: all three fields are filled from the place.
    - OTHER and ANONYMOUS: `locality` only. The `formatted_address` and `deleted_at` keys are present with value `null`, even for a soft-deleted place.
    - No location: `location: null`.
    - Together with Req. 16, a non-owner never receives the item place's address, address-derived text, `label` or id through the item location block, `/details` or `GET /api/inventory-items/{id}`.
    - The `/actions` route keeps `set_personalised_cache_headers`. The anonymous locality-only response may be shared-cached.
21. Item page `location` and the personal-pickup gate read `item.location_id`:
    - `item_actions` uses `owner_location_id = item.location_id` and keeps batching it with the term places in one `IN` query.
    - `reservation_context.load_personal_context` uses the new `circulation_bridge.get_item_live_location_id(db, item_id)`, backed by `circulation repository.find_item_live_location_id`. This replaces `find_personal_inventory_live_location_id`.
    - The 409 message becomes "Właściciel nie ustawił lokalizacji przedmiotu".
22. Removed:
    - `GET|PUT /api/inventories/mine/location`.
    - `get/set_my_inventory_location`, `InventoryLocationResponse`, `SetInventoryLocationRequest`.
    - Matrix row 172 and `Inventory.location_id`.
    - `circulation_bridge.get_personal_inventory_live_location_id`, and circulation `locations_acl.get_location_ref` if it is left unused.

### Frontend
23. `LocalityCombobox` (new, `components/shared/LocalityCombobox.tsx`) is an inline combobox over `useLocalitySearch` (300 ms debounce).
    - Label "Lokalizacja *", placeholder "Miejscowość lub kod pocztowy", hint "Np. „Kęty”, „Nowa Wieś” albo „32-650”."
    - Each option shows the name (plus `postal_code` in postal mode), the detail line "gm. X, pow. Y, voivodeship", and "· miasto" for a TOWN.
    - The status line "… i N więcej — doprecyzuj wpis" is not an option.
    - Chosen state: a chip with "zmień".
    - Error "Wybierz miejscowość z listy" when typed text was never picked.
    - Accessibility follows the inline combobox rules: `aria-activedescendant`, ArrowUp/Down + Enter, and Esc closing only the listbox via `preventDefault` + `stopPropagation`, with `aria-controls` only while open.
24. `LocationAddForm` is reworked to 2 fields for create and edit, taking `initial?: LocationResponse` and `submit(request)` (the host's `create` or `update`).
    - "Adres (opcjonalnie)" is disabled with "Najpierw wybierz miejscowość" until a locality is chosen. Its hint reads "Potrzebny głównie dla terminów i wydarzeń. Przy przedmiotach widzisz go tylko Ty."
    - Google suggestions are biased by appending "{locality}, {voivodeship}". The manual fallback is unchanged.
    - Changing the locality clears the address.
    - The buttons are "Zapisz" and "Anuluj". Nazwa and Notatka are removed.
25. `PlaceCreateView`:
    - It toasts `Dodano miejsce „{locality.name}”`.
    - With a safe `returnTo`, both save and cancel navigate with `replace: true`:
      - save hands back `{pickedLocation: {picker, locationId}}`;
      - cancel hands back `{pickedLocation: {picker, locationId: null}}` when `picker` is set.
    - Without `returnTo` it pushes `/places` as today.

    `PlaceEditView` uses the same form with `initial` + `update` (PUT). `PlacesView` rows:
    - The primary line is the locality name.
    - The secondary line is `{formatted_address} · {voivodeship}`, or the detail line when there is no address.
    - The footer note reads "Miejsca bez adresu wystarczą dla przedmiotów. Dla terminów i wydarzeń dodaj adres."
26. `LocationPicker`:
    - Inline mode is removed: the `addMode` prop, the `LocationAddForm` import and the `create` use.
    - `+` is always a `Link` to `placeCreatePath(...)` with `replace: true`. An optional `onAddClick` runs before navigation.
    - A pick from navigation state is consumed once (the existing `handledPick` ref). A `null` `locationId` (cancelled) is marked handled and leaves the value unchanged.
    - A new `required` prop removes the "none" option. With a null value it shows the disabled placeholder "Wybierz miejsce". It takes `invalid` + `errorText` (`aria-invalid` and a `role="alert"` message "Wybierz lokalizację").
    - With no places: "Nie masz jeszcze miejsc" + `+`, and the helper "Dodaj miejsce przyciskiem „+”. Wrócisz tu z zachowanymi danymi i zdjęciami."
    - Options show `label`. The selected-place line shows the address, or the locality detail line.
    - `FallbackLocation` becomes `{id, label, deleted_at}`.
27. `utils/appHelpers.ts`: `PickedLocationState.pickedLocation.locationId` becomes `string | null`.
28. **Navigation after the round trip (H1).** Because both legs replace (Req. 25 and 26), the history after `+` → `/places/new` → back equals the history before `+`. As a result:
    - `ItemEditView`'s existing `done` (`navigate(-1)` with in-app history, else `/items`) returns to the item page or `/items`, wherever edit was opened from.
    - After create, `ItemCreateView`'s `navigate(itemPagePath, {replace: true})` leaves `[…, opener-of-add, item]`, so `ItemBackButton`'s `navigate(-1)` reaches the page before `/add/product`.
    - `EventEditView`, `TermEditView` and `AddTermView` keep their explicit targets (`eventHref`, `/meetings`), unaffected.
29. Item create (`ItemCreateView`):
    - Draft fields, photos (`File[]`) and `locationId` live in `AppDataContext` (`itemDraft`, `itemPhotos`).
    - A required picker (`idPrefix="item-create-place"`) sits under Opis, with the helper "Kupujący zobaczą tylko miejscowość. Adres widzisz tylko Ty."
    - Prefill: the location of the owner's newest item (from `MyInventoryItemResponse`) whose place is in the live `useMyLocations` list, else the only saved place. It applies only while `itemDraft.locationId` is null and the draft is untouched.
    - `fieldsMissing` includes the location; the hint reads "Podaj nazwę, wybierz kategorię i lokalizację, aby zapisać."
    - `useCreateItem` sends `location_id`.
30. **Draft lifecycle** (the `eventDraft`/`eventEdit` parity rule: drafts survive any navigation inside the panel until a defined clear point):

    | Slice | Seeded | Cleared |
    |---|---|---|
    | `itemDraft` + `itemPhotos` | empty | after a successful create (before navigating). Otherwise kept, like `eventDraft`, so reopening `/add/product` resumes it |
    | `itemEdit {itemId, draft}` | once per `itemId` from `/details` (a new id re-seeds) | on successful save and on "Anuluj", both before `done()`. Other leave paths keep it (`eventEdit` parity) |
    | `termEdit {termId, draft}` | once per `termId` | on successful save and on cancel (`onDone(saved)`), before `TermEditView` navigates |
    | `firstTermDraft` | reset to empty when the stepper is opened from its normal trigger | on stepper close (✕/Esc/backdrop) and on finish. **Not** on the `+` close |
31. Item edit (`ItemEditView`/`ItemEditForm`):
    - The form state, including `locationId`, lives in `itemEdit`.
    - A required picker (`idPrefix="item-edit-place"`) is added.
    - A null `location_id` (no location or a soft-deleted place, Req. 16) shows the banner "Ustaw lokalizację, aby wystawić przedmiot." with an empty picker. Saving without a pick shows "Wybierz lokalizację" and saves nothing.
    - A changed location is sent via `updateInventoryItem(id, {location_id})`. After it, `useItemEditing` awaits invalidation of `ITEM_DETAILS_KEY` and `ITEM_ACTIONS_KEY` and reloads the panel's my-items list (the prefill source).
32. Term edit (`TermEditForm`): occursOn, description, locationId and capacity text move to `termEdit`. The picker switches to page mode. Needed-item sub-CRUD stays immediate.
33. First-term stepper (`FirstTermStepperOrganizer`):
    - Its fields live in `firstTermDraft`.
    - The picker's `onAddClick` calls a dedicated `closeStepperForPlace()` that sets `modal = null` and keeps the draft. This is separate from `closeStepper()`, which clears it.
    - `AppDataContext` reopens `modal = "pierwszy-termin"` when the navigation state carries `pickedLocation.picker === "first-term-place"`, whether `locationId` is an id or `null` (cancel). A `useRef` once-only guard on the state object, mirroring `handledPick`, prevents a second reopen from the same history entry.
    - The reopened picker consumes a non-null pick as usual.
34. Event create/edit, add-term and group forms keep their drafts and page mode. Labels and types switch to `label` and the reworked `LocationRefResponse`, and they gain the `replace` behaviour through the shared picker.
35. Item page (`ItemContextActions`):
    - One "Lokalizacja przedmiotu" card for every viewer: 📍 + `locality.name` (plus "(usunięte)" for the owner when `deleted_at`), the detail line, and "Otwórz w Mapach" (Maps search on the locality query, hidden for the owner's deleted place).
    - The owner also sees "Widoczne tylko dla Ciebie" + `formatted_address` and "Zmień lokalizację" → `/items/:id/edit`.
    - The owner with no location or a deleted place sees "Odbiór osobisty niedostępny — ustaw lokalizację".
    - Anonymous viewers see the card.
    - Non-owners of a deleted place see the plain locality and Maps link (they receive `deleted_at = null`). This is intended: the locality is still where the item is, and pickup unavailability already shows through the actions.
36. Display sites use the new shapes:
    - `TermPlaceLine` and `EventWhenCard`: bold locality name, then the address or the detail line, and no notes. The Maps link uses address + place id, else the locality query.
    - `TermCard`: `label`. Its `buildMapsUrl(location)` follows the `TermPlaceLine` Maps rule.
    - `EventWhenCard` calendar export: `groupName: location?.label`.
    - `PersonalPickupSheet` (`ItemContextActions.tsx` ~204): `locationName={choose.location.locality.name}`.
    - `GroupDetailsPage`, `GroupsView`, `AdminTermsPage` and `lib/publicMetadata.ts`: `label`.
    - `OwnerMeetingsPage` and `ChooseContextSheet` show the longer `location_name` unchanged, with existing wrapping (no truncation logic).
    - `buildMapsUrl` accepts `{query, google_place_id?}`.
    - Shared helpers `localityDetail(locality)` and `localityMapsQuery(locality)` go in `src/utils/locationLabel.ts`.
37. Removed:
    - `InventoryLocationCard.tsx` and its use in `MyItemsView`.
    - `useMyInventoryLocation.ts` and its test.
    - `getMyInventoryLocation`/`setMyInventoryLocation` and their types.
    - The dedup in `useMyLocations.create`.
    - `name`/`notes` in all TS location types, and `TermPlaceLocation`'s `name`/`notes`.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to UI task groups.

- Tokens: `src/frontend/src/app/globals.css` (mint, cream, line, ink, ink-soft, danger, teal-soft).
- Classes: `LOCATION_INPUT_CLASS`, `LOCATION_LABEL_CLASS`, `LOCATION_SAVE_BTN_CLASS`, `LOCATION_ERROR_CLASS`.
- Fidelity: mid-fidelity HTML. Layout, copy and states are binding; pixel values are not.

| ID | Mockup | Binding elements |
|---|---|---|
| `screen:place-create` | `analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html` | 5 states: empty (address disabled "Najpierw wybierz miejscowość"); name suggestions with gmina/powiat/woj, "· miasto", "… i N więcej"; postal suggestions with code; chosen locality + "zmień" + Google address suggestions; validation error "Wybierz miejscowość z listy". Applies to `/places/new` and `/places/:id/edit`. |
| `screen:item-create` | `analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html` | Required "Lokalizacja *" picker under Opis with `+`; helper "Kupujący zobaczą tylko miejscowość…"; no-places state; return-from-`/places/new` state with toast "Dodano miejsce „Kęty”" and the draft and photos intact; hint "Podaj nazwę, wybierz kategorię i lokalizację, aby zapisać." |
| `screen:item-edit` | `analysis/design-context/mockups/edytuj-rzecz-zmiana-lokalizacji.html` | Required picker; banner "Ustaw lokalizację, aby wystawić przedmiot." (also used for a deleted place); inline error "Wybierz lokalizację". |
| `screen:item-page-location` | `analysis/design-context/mockups/strona-przedmiotu-blok-lokalizacji.html` | Guest/other: locality + detail + "Otwórz w Mapach" + pickup note. Owner: plus "Widoczne tylko dla Ciebie" address + "Zmień lokalizację". Owner with deleted place: "(usunięte)" + "Odbiór osobisty niedostępny — ustaw lokalizację". |
| `screen:places-list` | `analysis/design-context/mockups/moje-miejsca-lista.html` | Locality primary; address · voivodeship or detail line secondary; Edytuj · Usuń; footer note. |
| `component:locality-combobox` | `analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html` | Option anatomy (name, optional postal code, detail line, "miasto"), overflow line, chosen chip with "zmień". |
| `component:location-picker-required` | `analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html` | No "none" option, "Wybierz miejsce" placeholder, `+`, error and helper texts. |

## Reusable Components

### Existing Code to Leverage
| Existing code | Path | Reuse |
|---|---|---|
| Vinted seed migration + fixture + README | `alembic/versions/0069_vinted_categories.py`, `alembic/data/vinted_categories_pl.README.md` | Fixture path `Path(__file__).parents[1] / "data"`, validation, provenance README |
| Additive FK + partial index migration | `alembic/versions/0075_inventory_location.py` | `SET LOCAL lock_timeout`, FK/index naming; its shape is re-added in 0080's downgrade |
| Migration round-trip tests | `tests/test_inventory_location_migration.py`, `tests/test_locations_migration.py` | `_alembic` subprocess + inspector pattern (both rewritten, see Testing) |
| Ownership ACLs | `app/{circulation,groups,events}/infrastructure/locations_acl.py` | Same API, loading delegated to the locations loaders |
| Owner check 404→403 | `app/locations/service.py::get_own_location` | PUT/DELETE and the ACLs (now `joinedload`) |
| Viewer privacy shaping | `app/groups/application/item_actions.py::_viewer_location`, `app/core/cache_headers.py` | Reworked for locality-only non-owner output |
| Pickup gate | `reservation_context.py::load_personal_context`, `circulation/infrastructure/repository.py::find_personal_inventory_live_location_id` | Same single-statement shape, keyed by item |
| Listing write path | `app/groups/application/term_item_listings.py::set_item_listing_preference` | Guard on the `existing is None` branch after the FOR UPDATE read |
| Transfer listing reset | `term_item_listings.py` confirm path (~1131–1141) | Already turns received items into DRAFT, so the guard catches them |
| Ledger projection | `app/circulation/infrastructure/ledger.py::_apply_projection` | Single place for transfer clearing |
| Auth matrix | `app/core/authorization_matrix.py` (rows 172, 205–209) | Localities row, PATCH→PUT, drop the inventory-location row |
| Test helpers | `tests/conftest.py::leaf_category_ids`, `tests/test_personal_pickup.py::_set_location` | Pattern for `locality_ids()`/`create_location()`; `_set_location` is rewritten |
| Picker round trip | `components/shared/LocationPicker.tsx` (`handledPick`), `utils/appHelpers.ts::placeCreatePath`, `features/places/PlaceCreateView.tsx` | Same mechanism, plus `replace` on both legs and a null pick for cancel |
| Navigation facade | `routing/navigation.tsx` (`NavigateOptions.replace`, `Link replace`, `useHasInAppHistory`) | `replace` already supported, no facade change |
| Draft store | `features/panel/AppDataContext.tsx` (`eventDraft`/`eventBanner`/`eventEdit`, `termLocationId`); `EventEditView.tsx` (clear on save) | Pattern for the new slices and their clear points |
| Combobox + Google | `components/shared/LocationAddForm.tsx`, `lib/googleMaps.ts` | Address field kept; combobox mechanics copied into `LocalityCombobox` |
| Blocked-action pattern | `features/items/ItemCreateView.tsx` | Extended to the location |
| Places hooks | `hooks/useMyLocations.ts` | `create`/`update`/`remove` as props |
| Query keys | `hooks/useItemDetail.ts::ITEM_DETAILS_KEY`, `hooks/useItemActions.ts::ITEM_ACTIONS_KEY` | Invalidated after a location change |

### New Components Required
| New | Why existing code cannot be reused |
|---|---|
| `Locality`, `LocalityPostalCode`, `app/locations/localities.py` (`fold_polish`, search) | No geo dictionary exists; Google cannot map a Polish postal code to a TERYT locality, and the backend never calls Google |
| `scripts/build_localities.py` + 2 fixtures + README | Reproducible, licence-documented data prep |
| Migrations 0078–0080 + `test_localities_migration.py` | Schema and data changes |
| `GET /api/localities` route + schemas | New read capability |
| `load_location`/`load_locations_by_ids` loaders | `lazy="raise"` requires explicit loading on every read and after writes |
| `api/localities.ts`, `hooks/useLocalitySearch.ts` (`LOCALITIES_KEY`) | Data-fetching standard |
| `components/shared/LocalityCombobox.tsx` | A different source, result shape, overflow and postal display than the Google combobox |
| `utils/locationLabel.ts` | One formatter for the ~15 display sites |
| `tests/conftest.py::locality_ids`, `create_location` | About 20 test files must pass a `location_id` |
| `src/test/fixtures/locations.ts` (`makeLocality`, `makeLocationResponse`, `makeLocationRef`, `makePublicLocation`, `makeItemLocation`) | 19 frontend tests build location objects inline; the frontend-testing standard requires typed factories |

## Technical Approach

**Data flow.**
1. `LocalityCombobox` calls `GET /api/localities`. The address field calls Google client-side.
2. `LocationAddForm` calls `POST`/`PUT /api/locations`. The response is re-read through `load_location`.
3. The pickers hand the place id to their hosts.
4. `POST`/`PATCH /api/inventory-items` stores `inventory_items.location_id` after the ACL check.
5. `/actions` and pickup read the item's location. The ledger clears it on GIFT/SWAP, and the DRAFT → ACTIVE listing transition requires it to be live.

**Migrations.**
- **0078** creates:
  - `localities`: `pk_localities`, `ix_localities_name_search` (`text_pattern_ops`), and a CHECK on `kind`.
  - `locality_postal_codes`: `pk_locality_postal_codes`, `fk_locality_postal_codes_locality_id_localities` (CASCADE) and `ix_locality_postal_codes_postal_code` (`varchar_pattern_ops`).

  Its downgrade drops both tables.
- **0079** is data only.
  - It streams both `.csv.gz` fixtures with `gzip` + `csv`.
  - It validates the header, the 7-digit unique ids, `kind`, the postal format, and that every postal `locality_id` exists.
  - It inserts 10k-row chunks as one `INSERT … SELECT * FROM unnest(:a::text[], …)` per chunk: about 6 + 8 statements, each with bound arrays.
  - It logs the counts and the elapsed time.
  - Its downgrade runs `TRUNCATE locality_postal_codes, localities`. This is fast, and `locations.locality_id` is already gone by then.
- **Seed cost (M6).** The target is ≤3 s per 0079 upgrade locally, with a hard ceiling of 10 s. All 22 migration tests cross 0078/0079 (they downgrade below 0077), and the tables are dropped by 0078's downgrade, so no reseed can be skipped. The first backend task group measures the full migration-test runtime before and after.
  - If the added time exceeds **2 minutes**, 0079 switches to asyncpg `copy_records_to_table`. It reaches it through `op.get_bind().connection.driver_connection`, wrapped in `sqlalchemy.util.await_only`, which works inside alembic's `run_sync` greenlet.
  - The fixture parsing and validation stay unchanged.
- **0080, upgrade:**
  1. `SET LOCAL lock_timeout = '5s'`.
  2. Null `groups.default_location_id`, `terms.location_id`, `events.location_id` and `inventories.location_id`, then `DELETE FROM locations`.
  3. Add `locality_id` NOT NULL + FK; drop `name`/`notes`; make `formatted_address`/`source` nullable; add `ck_locations_address_fields`; drop the google-place unique index.
  4. Add `inventory_items.location_id` + FK + partial index.
  5. Drop `inventories.location_id` (index, FK, column).
- **0080, downgrade** (reverse order):
  1. Drop the item FK, index and column.
  2. Re-add `inventories.location_id` + FK + partial index.
  3. Null the referencing FKs and `DELETE FROM locations`.
  4. Drop the CHECK and `locality_id`.
  5. Re-add `name NOT NULL`/`notes`, make `formatted_address`/`source` NOT NULL again, and re-create the unique index.

  The downgrade is lossy and plain. The docstring and the architecture runbook say a downgrade below 0080 deletes all places and item locations.

**Locations module.**
- `models.py` gains `Locality`, `LocalityPostalCode` and `Location.locality` (`lazy="raise"`).
- `service.py` gains `load_location(db, id)` and `load_locations_by_ids(db, ids)`: `joinedload` + `populate_existing`, soft-deleted rows included. It also gains `location_label(location)`.
- POST/PUT and `get_own_location` follow Req. 9.
- The responses compute `label` with a builder that reads the loaded locality.
- The three ACLs replace `db.get(Location, …)` and their own selects with the loaders.

**Item writes and reads.**
- Circulation resolves the owner's party id with `repository.find_party_id_by_user_id` before `locations_acl.get_owned_location`.
- `item_actions` takes `item.location_id`.
- `_viewer_location` emits the locality only for non-owners.
- `ItemDetailsResponse.location_id` uses the same live check as pickup.

**Frontend state and navigation.**
- The new `AppDataContext` slices follow the `eventDraft`/`eventEdit` shape, are exposed through `useAppData()`, and use the clear points in Req. 30.
- Photos stay as in-memory `File[]`, like `eventBanner`.
- The stepper reopen effect and the `replace` round trip follow Req. 26, 28 and 33.
- No facade changes are needed: `replace` is already supported by `useAppNavigate` and `Link`.

**Docs.** Update the following:
- `architecture.md`: the locality dictionary, item location, the removed inventory location, the listing-guard scope, and the 0078–0080 runbook.
- `models.md`: the dictionary carve-out, `Location.locality` with the loaders (including the post-write reload), and ACL delegation.
- `migrations.md`: the gzipped CSV + chunked `unnest` seed precedent and the `TRUNCATE` downgrade for dictionary data.
- `INDEX.md`.

## Implementation Guidance

### Testing Approach
- Write 2–8 focused tests per implementation step group. Verification runs only the new and changed tests: backend `uv run python -m pytest tests/test_x.py` from `src/backend`, frontend `npx vitest run <files>`.
- **Backend:**
  - `test_localities_migration.py` (new):
    - downgrade 0077 → upgrade head round trip;
    - schema and seed counts restored;
    - logs the 0079 duration;
    - restores head in `finally`.
  - `test_inventory_location_migration.py` (**rewritten**). It downgrades to 0074, asserts that `inventories.location_id` is absent, then `upgrade 0075` and asserts the 0075 column, FK (no ON DELETE) and partial index. It then upgrades to head and asserts at head:
    - `inventories.location_id`, its FK and its index are absent;
    - `inventory_items.location_id` (nullable), `fk_inventory_items_location_id_locations` and `ix_inventory_items_location_id` (`WHERE location_id IS NOT NULL`) exist.

    Head is restored in `finally`.
  - `test_locations_migration.py` (**rewritten**). It downgrades to 0056, asserts that the table is absent, then `upgrade 0058` and asserts the 0057/0058 shape (the `uq_locations_owner_party_id_google_place_id` index and the group/term FKs). It then upgrades to head and asserts at head:
    - the unique index is absent;
    - `locality_id` exists, NOT NULL, with an FK to `localities`;
    - `name` and `notes` are absent;
    - `formatted_address` is nullable;
    - `ck_locations_address_fields` exists;
    - the group/term FKs exist.
  - `test_personal_pickup_migration.py`: unchanged; the 0075 guard still applies after 0080's downgrade.
  - `test_localities.py`:
    - folded prefix ("kety" → Kęty);
    - TOWN first;
    - postal "32-65" and "32650";
    - a `q` containing `%`/`_` matches literally;
    - "łódź" finds Łódź (ł folding);
    - `limit` 422;
    - a short `q` returns an empty result;
    - exact key set;
    - 2 statements;
    - 401 for anonymous.
  - `test_locations.py` (updated):
    - no address;
    - MANUAL and GOOGLE rules;
    - unknown locality 404;
    - no dedup;
    - a PUT that changes the locality returns the new `locality` and `label` in the same response (post-write reload);
    - PUT clears the address;
    - exact key sets;
    - foreign 403.
  - `test_item_location.py` (new):
    - create requires `location_id` (422);
    - foreign place 403, deleted place 404;
    - PATCH changes the location; PATCH with `null` returns 422;
    - DRAFT → ACTIVE without a live location returns 409;
    - a visibility or mode change on an already-listed item whose place was deleted succeeds;
    - GIFT clears the location; REGISTER keeps it;
    - `GET /api/inventory-items/{id}` has no `location_id` key;
    - `/details` `location_id` is null for a non-owner and for the owner of a deleted place.
  - `test_item_actions.py` / `test_personal_pickup.py` (updated):
    - OWN/OTHER/ANONYMOUS `location` key sets.
    - For OTHER/ANONYMOUS, `location == {locality: …, formatted_address: None, deleted_at: None}`.
    - The JSON contains no substring of the item place's address. The fixture uses a place with an address that no term uses.
    - A separate case reuses the place for a term and asserts the term context's `location_name` equals that place's `label` (H2 decision).
    - A deleted place still shows the locality to others.
    - Pickup is gated by the item's location.
  - Shared helpers:
    - `tests/conftest.py::locality_ids(client, headers, n)` (via search, called per test) and `create_location(client, headers, *, address=None) -> str`. Adopt them in the ~20 files that POST `/api/inventory-items`.
    - Replace the `name`/`notes` place bodies in `test_events.py`, `test_group_location_defaults.py` and `test_term_location_capacity.py`.
    - Rewrite `test_personal_pickup.py::_set_location` to create a place and PATCH the item. It is imported by `test_item_actions.py` and `test_item_visibility.py`.
  - Delete `test_inventory_location.py`.
  - Update `test_authorization_matrix.py` (`PATCH /api/locations/x` → PUT, the localities row, the inventory-location row removed) and the key-set tests for groups, terms and events.
- **Frontend** (`src/test/`, typed fixtures, no casts):
  - `src/test/fixtures/locations.ts` with the typed factories. Every touched test file that builds location objects switches to them; `npm run typecheck` flags the rest.
  - `LocalityCombobox.test.tsx`: suggestions, keyboard selection, Esc closes only the listbox, overflow line, pick-required error.
  - `LocationAddForm.test.tsx`: address disabled until a locality is chosen, a locality change clears the address, create and edit request shapes.
  - `PlaceCreateView.test.tsx`:
    - save with `returnTo` calls navigate with `replace: true` and a pick;
    - cancel with `returnTo` + `picker` uses `replace` and `locationId: null`;
    - with no `returnTo` it pushes `/places`.
  - `LocationPicker.test.tsx` (updated):
    - no none option in required mode;
    - error and `aria-invalid`;
    - empty state;
    - the `+` link uses `replace` and runs `onAddClick`;
    - a pick from state is applied once;
    - a `null` pick leaves the value.
  - `ItemCreateView.test.tsx` (updated): blocked without a location, the draft and photos survive a remount, `location_id` is sent, the draft is cleared after create.
  - `ItemEditView` tests:
    - location change saved and `ITEM_ACTIONS_KEY` invalidated;
    - the banner for a null `location_id`;
    - "Anuluj" clears `itemEdit`;
    - after the round trip, save calls `navigate(-1)`, and the recorded history has no `/places/new` entry (`getTestRouter().calls`).
  - Item page location card: owner, other, anonymous and owner-deleted states.
  - `PlacesView.test.tsx` and `TermPlaceLine.test.tsx` (updated).
  - `FirstTermStepperOrganizer.test.tsx`:
    - reopens with the draft after a pick and after a cancel;
    - does not reopen twice for the same state;
    - ✕ clears the draft, `+` keeps it.
  - `ssrSafety.test.tsx` stays green.
- **Pre-existing failures:** the 12 known vitest failures are not regressions. Compare against that baseline.

### Standards Compliance
- `standards/backend/models.md`:
  - UUID `BaseEntity`; a documented string-PK carve-out.
  - `lazy="raise"` + explicit `joinedload`, including the post-write reload.
  - ACL-only cross-context access with 404 before 403.
  - Safe-by-default visibility kept: no new non-owner exposure of `location_id`.
- `standards/backend/migrations.md`:
  - `pk_`/`fk_`/`ix_`/`ck_` names.
  - `SET LOCAL lock_timeout` in 0080.
  - Reverse-order downgrades.
  - Downgrade→upgrade tests that restore head, including the two rewritten tests.
- `standards/backend/queries.md`, `jooq.md`: bound parameters only, the escaped `LIKE` via `autoescape`, SQL-level LIMIT, explicit ordering, no N+1.
- `standards/backend/security.md`: matrix rows for new and changed routes; personalised cache headers on `/actions` and `/details`.
- `standards/backend/api.md`: plural `/api/localities`, PUT for full replacement.
- `standards/backend/time.md`: audit timestamps unchanged.
- `standards/frontend/components.md`: thin routes, routing facade only (`replace` via `NavigateOptions`), drafts in `AppDataContext`, no browser globals in render.
- `standards/frontend/accessibility.md`: inline combobox rules, `aria-disabled` + hint, `aria-invalid`/`aria-describedby`, focus returned to the picker after a pick.
- `standards/frontend/data-fetching.md`:
  - `useLocalitySearch` with a prefix key.
  - `update` passed as a prop.
  - Mutations await invalidation of the locations prefix.
  - A location change also awaits `ITEM_DETAILS_KEY` + `ITEM_ACTIONS_KEY`.
- `standards/frontend/css.md`, `responsive.md`: existing tokens and classes, mobile-first.
- `standards/global/validation.md`: Polish inline `role="alert"` errors, with server-side validation enforced.
- `standards/global/minimal-implementation.md`: the inline picker mode, the inventory location and the dedup are removed; no speculative districts, coordinates or truncation logic.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: exact key sets, per-test helpers, typed fixture factories, 2–8 tests per feature.
- Secrets: the build script and README never contain or print secrets. The Google key is only checked for presence (`isGoogleMapsConfigured`).

## Out of Scope
- Locality on item cards and lists (owner items page, event participants' items, organizer recent-items, `MyItemsView` rows).
- City districts and locality parts.
- Coordinates for locality-only places; distance or area search; filtering by locality.
- A server-side Google-address vs TERYT consistency check.
- Notifying the other party when the owner changes the item location during an open personal-pickup reservation.
- A warning or cascade when a place used by listed items is soft-deleted (Req. 19).
- Truncating long `location_name` strings in `OwnerMeetingsPage`/`ChooseContextSheet`.
- mypy coverage of `scripts/` (ruff only).
- Legacy data migration or backfill (DB wiped; 0080 deletes places).
- Automated dictionary refresh. A TERYT update means re-running the script and adding a new data migration.
- Changing place optionality on terms, events and groups.

## Success Criteria
- `alembic upgrade head` on an empty DB seeds localities and postal pairs with counts that match the README. 0079 takes ≤3 s locally (hard ceiling 10 s), and the migration-test overhead stays ≤2 min, or the COPY fallback is in place.
- `GET /api/localities?q=kety` returns Kęty (TOWN) first, and `q=32-650` returns the localities with that code, both in 2 SQL statements. `%`/`_` in `q` match literally.
- `POST /api/inventory-items` without `location_id` returns 422, and with a foreign place 403. Every created item has `location_id`.
- After a confirmed GIFT/SWAP, the received item has `location_id = null` and is DRAFT. Listing it returns 409 until a live location is set. An already-listed item whose place is deleted can still change mode or visibility.
- For OTHER and ANONYMOUS viewers, the item's own location block (`/actions` `location`) is exactly `{locality, formatted_address: null, deleted_at: null}`. `/details` and `GET /api/inventory-items/{id}` carry no item `location_id`. No substring of the item place's address appears in their responses unless the same place is also a term/event place, in which case only the context `location_name` carries it (accepted).
- After `+` → `/places/new` → save or cancel, the history has no `/places/new` entry. "Zapisz"/"Anuluj" on item edit return to the item page or `/items`, and the item page's "Wróć" after create skips `/add/product`.
- No `LocationPicker` renders an inline add form. Item create and edit, term edit and the first-term stepper keep every typed value (and item photos) across `/places/new`, and their drafts are cleared at the points in Req. 30.
- `/places/new` and `/places/:id/edit` render exactly the 2 fields and the 5 states from `screen:place-create`.
- `GET|PUT /api/inventories/mine/location`, `InventoryLocationCard`, `useMyInventoryLocation` and `inventories.location_id` no longer exist (grep is clean).
- New and changed backend tests pass, including the two rewritten migration tests. mypy stays ≤15 and ruff is clean (including `scripts/`). Frontend tests show no new failures beyond the 12-failure baseline, and `npm run typecheck` is clean.

## Audit resolutions
| ID | Resolution |
|---|---|
| H1 | Both legs of the `/places/new` round trip use `replace: true` (picker `+` link; `PlaceCreateView` save/cancel with `returnTo`), so history is unchanged and the existing `navigate(-1)` in `ItemEditView`/`ItemBackButton` lands on the opener's origin. The `EventEditView`/`TermEditView` explicit targets are unaffected (Req. 25, 26, 28; tests in `PlaceCreateView`, `LocationPicker`, `ItemEditView`). |
| H2 | User decision "Adres terminu publiczny": the guarantee is narrowed to the item's own location block. Context `location_name` keeps the full `label`. The non-owner shape is `{locality, formatted_address: null, deleted_at: null}` (key present, null value). The test pins the item to a place no term uses, and a second case asserts the context label (TL;DR, Key Decisions, Req. 12, 20, Success Criteria). |
| M1 | `test_inventory_location_migration.py` and `test_locations_migration.py` are listed as rewritten, asserting their revision's schema at 0075/0058 and the 0080 shape at head. |
| M2 | Req. 9: POST/PUT return `load_location` (`joinedload` + `populate_existing`) after commit; `get_own_location` and circulation `get_owned_location` load the locality; a test checks that a locality change shows up in the PUT response. |
| M3 | Req. 18–19: the 409 applies only to DRAFT → ACTIVE (no existing preference); mode and visibility changes are never blocked; a place soft delete leaves listings ACTIVE, pickup unavailable, and the owner prompted. |
| M4 | Req. 16, 31: `ItemDetailsResponse.location_id` is null for a soft-deleted place, so item edit shows an empty required picker plus the banner, and saving needs a live place. No fallback option is needed. |
| M5 | Req. 30 and 33: a clear-point table per slice; a `closeStepperForPlace()` separate from `closeStepper()`; a once-only reopen guard; a cancel from `/places/new` hands back `locationId: null` and reopens the stepper. |
| M6 | Chunked `unnest` with bound arrays, a `TRUNCATE` downgrade, a ≤3 s target, a measured 2-minute overhead budget, and an asyncpg `copy_records_to_table` fallback via `await_only`. No skip is possible, because 0078's downgrade drops the tables. |
| L1 | `location_id` is not added to `InventoryItemResponse` (Req. 16); a test asserts the key is absent. |
| L2 | Confirmed intended: non-owners see the plain locality and Maps link for a deleted place (Req. 35). |
| L3 | `PersonalPickupSheet`, the `TermCard` Maps rule and the `EventWhenCard` calendar `groupName` are added to Req. 36; the longer strings in `OwnerMeetingsPage`/`ChooseContextSheet` are accepted (Out of Scope). |
| L4 | `src/test/fixtures/locations.ts` typed factories; `test_events.py`, `test_group_location_defaults.py` and `test_term_location_capacity.py` are named; `_set_location` is rewritten for its importers. |
| L5 | `startswith(autoescape=True)`; `fold_polish` maps `ł/Ł` explicitly; both are tested. |
| L6 | New `scripts/` directory, the run command is stated, ruff covers `scripts/`, and mypy stays `app`-only (accepted). |
| L7 | TOWN-first is kept (user decision, matches the mockup); an exact match ranks first within a kind; users narrow by typing more or by postal code. |
| L8 | A location change during an open personal-pickup reservation is allowed and read live, with no notification (Out of Scope); `ITEM_ACTIONS_KEY` and the my-items list are refreshed after a location change (Req. 31). |
