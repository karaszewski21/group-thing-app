# Gap Analysis: Mandatory item location + OLX-style locality (TERYT) in the place form

## TL;DR
- The whole locality capability is missing: no TERYT/SIMC dictionary, no postal-code data, no search endpoint, and no locality columns. Items have no location of their own; location sits on the owner's PERSONAL inventory (0075).
- The work splits into four parts: (1) a new `teryt` dictionary with postal codes, seeded by migration 0078, plus `GET /api/localities?q=`; (2) a `locations` rework (`locality_id` NOT NULL, address optional, `name`/`notes` dropped from the form, label derived); (3) `inventory_items.location_id`, required on create, with pickup gating, `/actions` and privacy moved to it; (4) frontend: a required `LocationPicker`, an item draft that survives `/places/new`, the 2-field form, and about 10 display sites.
- Two problems the earlier phases did not raise. **Ownership transfer** (`ledger.py:192` moves `item.inventory_id`) would leave the item pointing at the giver's place, so its address leaks to the new owner. **Non-owners currently see `location.name`**, and once `name` is derived from locality plus address, that would leak the address.
- Postal codes need a second dataset with its own licence question. This is the main open sourcing risk.

## Key Decisions
- Characteristics detected: modifies_existing_code, creates_new_entities (TERYT dictionary, item location FK, locality search API), involves_data_operations (Location, InventoryItem.location, Locality), ui_heavy. There is no reproducible defect.
- Change type is **modificative**. Compatibility is **flexible**: the user said the DB will be wiped, so there are no guarded downgrades and no fallbacks for old rows.
- I recommend the dataset ship as a **data migration from a gzipped fixture in `src/backend/alembic/data/`**. `0069_vinted_categories.py` plus `vinted_categories_pl.json` is the existing precedent. Testcontainers runs `alembic upgrade head` once per session, so every test DB gets the dictionary with no extra step.
- Search should use a normalised, diacritic-folded column built in Python (no `unaccent`/`pg_trgm` extension; none is used today) with a prefix btree index (`text_pattern_ops`). This fits the minimal-dependencies standard.
- Coordinates are not needed for locality-only places. A Maps link can be a text search on "locality, gmina, woj.". `lat`/`lng` stay filled only from a Google-resolved address.

## Open Questions / Risks
- **Licence and source for postal codes.** TERYT (GUS) is open data. Poczta Polska's electronic PNA database is a commercial product (only the PDF is free), and community CSVs derived from it have unclear licences. A candidate open source is PRG address points (GUGiK), which carry a postal code and the SIMC id on every address. These need offline aggregation to distinct (PNA, SIMC) pairs. The source's licence must be checked before implementation.
- **Duplicate locality names.** Hundreds of "Nowa Wieś" entries mean suggestions and labels must carry gmina/powiat/województwo. Showing locality plus voivodeship alone is ambiguous.
- **Address vs locality consistency.** Google cannot be called server-side, so a Google address in a different town than the chosen TERYT locality cannot be rejected by the backend.
- **Transferred items lose their location.** After a confirmed GIFT/SWAP the receiver owns an item with no valid location. Relisting needs a rule.
- **Seed size and time.** SIMC has about 100k rows including locality parts, about 50–60k independent localities. The (PNA, SIMC) pairs are probably 50–80k (unverified). The fixture would be roughly 1–3 MB gzipped, and the insert adds a few seconds to every testcontainers session.
- Dictionary refresh: TERYT changes yearly. Pin the version and date in a README next to the fixture, as `vinted_categories_pl.README.md` does. Re-import is out of scope.
- `InventoryLocationCard.tsx` shows as modified in git (CRLF only). Don't let it hide real diffs.

## Summary
- **Risk Level**: High (medium-high per Phase 1; raised because of the transfer/privacy findings and the external dataset licence)
- **Estimated Effort**: High
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: yes (locality dictionary + postal mapping, item-level location FK, locality search API)
- Involves data operations: yes
- UI heavy: yes

## Gaps Identified

### Missing Features
- **Locality dictionary.** Nothing in `src/backend` mentions TERYT, SIMC or PNA. The only geo source is browser-side Google (`lib/googleMaps.ts`). Needed: a table (e.g. `localities`: SIMC id PK, name, normalised name, kind, gmina, powiat, województwo names or TERC codes, optional parent SIMC for city districts) and a `locality_postal_codes(postal_code, locality_id)` table.
- **Locality search API.** None exists. Needed: a public or logged-in `GET /api/localities?q=` that handles both name-prefix and postal-code (`^\d{2}-?\d{0,3}$`) queries, has a limit (e.g. 10), ranks towns first and then by name, and returns a label with disambiguation. This needs a row in `AUTHORIZATION_MATRIX`.
- **Item-level location.** `InventoryItem` (`circulation/models.py:199`) has no location. `CreateInventoryItemRequest` (`circulation/schemas.py:97`) has only `inventory_id, product_id, condition, listing_mode`.
- **Required mode in `LocationPicker`.** It always renders the "none" option (`components/shared/LocationPicker.tsx`).
- **Item create draft store.** `ItemCreateView` keeps its fields and photo `File[]` in local `useState`. `AppDataContext.tsx:162-163` already holds `eventDraft`/`eventBanner: File | null`, which is the pattern to follow.

### Incomplete Features
- **`locations` model.** Today it has `name` NOT NULL, `formatted_address` NOT NULL, `notes`, and `source` GOOGLE|MANUAL that applies to the whole place. It needs `locality_id` NOT NULL (FK to the dictionary), nullable `formatted_address`, `name` derived (either a stored column computed server-side or a response-only label), `notes` removed, and `source`/`google_place_id`/`lat`/`lng` describing only the optional address.
- **`LocationAddForm.tsx` (369 lines).** It has Nazwa, Adres (Google or manual) and Notatka. It needs two fields: a required "Lokalizacja" combobox backed by the new API (keeping the existing combobox ARIA, Esc and `aria-activedescendant` rules from the accessibility standard), and an optional "Adres" field with Google suggestions or manual fallback. `PlaceEditView.tsx` needs the same rework, including when the locality can be edited.
- **Response DTOs.** `LocationResponse`, `LocationRefResponse`, `PublicLocationResponse`, `ItemLocationResponse` (`groups/schemas.py:807`), `InventoryLocationResponse`, and the TS types in `api/locations.ts`, `events.ts`, `groups.ts`, `terms.ts`, `inventories.ts` and `itemActions.ts` all assume `formatted_address: string` and `name`. They need locality fields plus a nullable address, changed in lockstep (the exact key-set test standard applies).
- **Display sites.** `TermPlaceLine`/`buildMapsUrl`, `TermCard`, `EventWhenCard`, `GroupDetailsPage`, `GroupsView`, `ItemContextActions` (`LocationCard`, `OwnLocationCard`), `AdminTermsPage`, `PlacesView`, `LocationPicker:133` and `publicMetadata.ts` all need a shared `formatLocationLabel()` and a Maps URL that does not require an address.

### Behavioral Changes Needed
- **Personal pickup gate.** It moves from `circulation_bridge.get_personal_inventory_live_location_id` (`reservation_context.py:284`) and `item_actions.py:88-93`, which read the PERSONAL inventory's location, to the item's own `location_id`.
- **`/actions` location.** `_viewer_location` (`item_actions.py:240-256`) gives non-owners `location.name`. With a derived name, non-owners must get the locality label only, never the address.
- **Ownership transfer.** `ledger._apply_projection` (`circulation/infrastructure/ledger.py:192`) sets `item.inventory_id = leg.to_inventory_id`. An item-level location FK must be cleared (or otherwise handled) there, or the receiver sees the giver's address as "OWN".
- **`/places/new`** today requires a name and an address. Afterwards it requires the locality only.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (item location) | Separate card "Gdzie są moje rzeczy?" on `/items` (MyItemsView); nothing on `/add/product` | Required picker inside `/add/product`; `+` goes to `/places/new` and returns with the pick | Better |
| Discoverability | 4/10: the card is optional and easy to skip | 9/10: a required form field, and the submit hint names it | +5 |
| Flow integration | One location for all items | One location per item, plus a page round trip during create, which needs the draft store or the user loses typed fields and photos | Risk until the draft exists |
| Place form | Search an address, then edit the name, then a note | Locality (name or postal code), then an optional address | Simpler; matches the OLX mental model |
| Multi-persona | Owner sees name + address; other logged-in users see the name; anonymous see nothing | Owner sees locality + address; others see the locality (anonymous too, if decided, as OLX does); term/event participants see the address as they do today | Needs a decision |

Navigation paths: `/add/product` → `+` → `/places/new?returnTo=/add/product&picker=item-create-place` → back with `PickedLocationState` (`PlaceCreateView.tsx`, `appHelpers.placeCreatePath`). `isSafeReturnPath` already allows panel paths.

## Data Lifecycle Analysis

### Entity: Locality (TERYT dictionary), new

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Seed migration only (read-only reference data) | n/a | n/a | Missing (to build: seed) |
| READ | none | none | none | Missing (search endpoint + combobox) |
| UPDATE/DELETE | Not needed (dictionary; refresh means a new migration) | n/a | n/a | n/a |

### Entity: Location (place), reworked

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | `POST /api/locations` (`locations/router.py`) | `LocationAddForm` | `/places/new`, picker `+`, inline picker mode | Exists; contract changes |
| READ | `GET /api/locations/mine` + ACL embeds | `PlacesView`, `LocationPicker`, ~10 display sites | `/places`, forms, term/event/item pages | Exists; every display needs null-safe address handling |
| UPDATE | `PATCH /api/locations/{id}` (409 on a GOOGLE address change) | `PlaceEditView` | `/places/{id}/edit` | Exists; needs a 2-field rework and a rule for editing the locality |
| DELETE | soft delete | PlacesView delete | `/places` | Exists. **Gap:** nothing defines what an item referencing a deleted place shows, or whether delete is blocked |

### Entity: InventoryItem.location (item location), new

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (set on create) | Missing. `CreateInventoryItemRequest` has no `location_id`; `register_item` takes none | Missing. `ItemCreateView` has no picker | `/add/product` | Missing |
| READ | Partial. `/actions` reads the inventory location, not the item's | `ItemContextActions` `LocationCard`/`OwnLocationCard` | Item page | Partial (wrong source) |
| UPDATE | Missing. `UpdateInventoryItemRequest` has only `condition`/`product_id` | Missing. `ItemEditView`/`ItemEditForm` has no location field | `/items/:id/edit` exists | **Missing: orphan risk** (a location can be set but never corrected; transferred items cannot be fixed) |
| DELETE / clear | Missing. Transfer must clear it | n/a | n/a | Missing |

**Completeness**: about 25% for item location (READ exists, but from the wrong source). Location CRUD is roughly 75% once the reworked contracts land. The locality dictionary is 0%.
**Orphaned operations**: item location CREATE without UPDATE (if item edit is left out); CREATE on transferred items (no path to set a location after receiving an item).
**Missing touchpoints**: item edit page (`/items/:id/edit`); personal pickup gate; `InventoryLocationCard` and `GET|PUT /api/inventories/mine/location` (made redundant by per-item location); ownership-transfer projection; item cards (owner items page `/<slug>/items`, event participants' 3 newest items, organizer recent-items), where OLX shows the locality on every card. The last one is optional.

Other item-create paths: `registerInventoryItem` is called only from `hooks/useCreateItem.ts`, and `ItemQuickAddForm` is used only by `ItemCreateView`. `AddTermView` uses `NeededItemQuickAddForm` (plain names, not inventory items), so it is not affected.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Postal-code data source and licence.** SIMC has no postal codes.
   - Options:
     - (A, recommended) PRG address points (GUGiK, open data): aggregate offline to distinct (PNA, SIMC id) pairs and ship as a fixture. Coordinates are available from the same data if ever needed.
     - (B) Poczta Polska PNA list: the official electronic list is paid; parsing the free PDF is brittle.
     - (C) A community CSV (e.g. a GitHub "kody pocztowe" dataset): unclear licence and staleness.
     - (D) Leave postal-code search out of the MVP and search by name only.
   - Recommendation: A, with D as the fallback if the licence or effort checks fail. Search by postal code is an explicit user requirement, and A keeps a single official, open, SIMC-keyed source.
2. **How to ship the dataset.**
   - Options:
     - (A, recommended) Data migration 0078/0079 reading a gzipped CSV/JSON from `alembic/data/` with a README for version and source (0069 precedent).
     - (B) A management command run at deploy (an extra ops step; tests need a fixture call).
     - (C) Load at app startup (slows boot, races between workers).
   - Recommendation: A. It is the established precedent, gives every environment and test DB the data automatically, and matches "schema and data migrations separate" if the tables and the seed are separate revisions.
3. **Item location vs ownership transfer.** `ledger.py:192` moves items between owners.
   - Options:
     - (A, recommended) Clear `location_id` on transfer (nullable column) and require a location again before the item can be listed (GIFT/SWAP activation) or edited.
     - (B) Keep the giver's place (address leak, wrong pickup place).
     - (C) Copy the receiver's most recent place (a guess).
   - Recommendation: A. It avoids leaking the giver's private address and keeps the rule "every listed item has the owner's own location".
4. **Backend enforcement.**
   - Options:
     - (A, recommended) `location_id` required in `CreateInventoryItemRequest`, validated through `circulation/infrastructure/locations_acl.get_owned_location` (404 then 403, live only); DB column nullable (because of transfers); listing activation refused with 409 without a live location; a shared `tests/conftest.py` helper (e.g. `create_location(client, headers)` using a seeded locality) adopted by the 20 test files that POST `/api/inventory-items`.
     - (B) Frontend-only requirement.
   - Recommendation: A. "Mandatory" must hold for API callers too, and pickup gating depends on it. The cost is mechanical edits in 20 test files (each has its own `_create_*` helper; there is no shared one today).
5. **Item edit: changing the location later.**
   - Options:
     - (A, recommended) Add the picker to `ItemEditView`/`ItemEditForm` and `location_id` to `UpdateInventoryItemRequest`.
     - (B) Out of scope.
   - Recommendation: A. Without it, item location is CREATE without UPDATE (orphaned), and transferred items (decision 3) have no way to get a location.
6. **Privacy of locality vs address on the item page.** Today non-owners get `name`, which will contain the address once `name` is derived.
   - Options:
     - (A, recommended) Everyone, including anonymous viewers, sees the locality label (town + gmina/powiat + województwo), as on OLX. Only the owner sees the address. Term/event places keep today's exposure of the address to their audiences.
     - (B) Locality for logged-in users only (today's anonymous rule).
     - (C) Owner only.
   - Recommendation: A. Listed items are public (see memory: items are readable anonymously), a locality is not personal data at that level, and buyers need it to decide.
   - Must be done in any case: replace `name` in `_viewer_location` for non-owners with a locality-only label.

### Important (Should Decide)
1. **Personal pickup and item page source.** Default: switch `personal_pickup_available`, `reservation_context.py:284` and `/actions` location to the item's own live `location_id`. Rationale: the location is now per item, and the inventory-level location would be stale and unused.
2. **`InventoryLocationCard` and `inventories.location_id`.**
   - Options: (A) remove the card, `GET|PUT /api/inventories/mine/location`, `useMyInventoryLocation` and the column (DB wipe allowed); (B) keep it as the default prefilled into the item-create picker; (C) keep it unchanged.
   - Default: A. Prefill the item picker instead with the location of the owner's most recently created item, or the only saved place when there is exactly one.
   - Rationale: two sources of truth for "where is my item" invite inconsistency, and minimal-implementation applies.
3. **Draft persistence across `/places/new`.**
   - Options: (A) lift item-create fields and photo `File[]` into `AppDataContext` as `itemDraft`/`itemPhotos`, cleared on successful create (mirrors `eventDraft`/`eventBanner`); (B) use the picker's existing `addMode="inline"` on item create and avoid the round trip.
   - Default: A. The user explicitly asked for `+` to redirect to `/places/new`. B is far cheaper and worth offering.
4. **Coordinates for locality-only places.** Default: none. The Maps link becomes a text query on the locality label, and `lat`/`lng` stay only from a Google address. Rationale: SIMC has no coordinates and nothing uses them for locality-only places. They would only matter for future distance search, which is not requested.
5. **Dictionary scope and ranking.**
   - Options: (A) independent localities plus city districts/parts (OLX shows "Kraków, Krowodrza"); (B) independent localities only.
   - Default: B for the MVP, ranked towns before villages and then alphabetically, with the label always carrying gmina/powiat/województwo for disambiguation.
   - Rationale: smaller data and simpler search. Districts can come later.
6. **Address vs locality consistency.** Default: show "Lokalizacja" first. The "Adres" Google suggestions are biased with the chosen locality's label appended to the query, and there is no server-side cross-check. Rationale: Google is browser-only, so an auto-check would need a TERYT match on the resolved postal code or town name, which is fragile.
7. **Place deletion while items reference it.**
   - Options: (A) allow soft delete; the item still shows its locality (from the dictionary) and pickup becomes unavailable until the owner picks a new place; (B) block delete with 409 while live items reference it.
   - Default: A. It matches today's "(usunięte)" behaviour for referenced places, and the locality survives.
8. **Dedupe for locality-only places.** Today only GOOGLE `place_id` is deduped. Default: reuse an existing live place with the same `(owner, locality_id)` and no address, instead of creating duplicates. Rationale: OLX-style users will pick the same town repeatedly.
9. **`name` storage.** Default: drop `name` and `notes` from the schema (DB wipe allowed), and compute `label` in the response from the locality plus the optional address. Rationale: no stale derived data. The cost is touching every `name` consumer (`owner_items.py:163` `location_name`, `publicMetadata.ts`, picker options), which have to be touched anyway.
10. **Locality on item cards** (owner items page, event participants, recent-items). Default: out of scope (item page only). Rationale: keeps the change bounded; it can follow later.
11. **Migration shape.** Default: new revisions 0078 (dictionary tables) and 0079 (seed), then 0080 (locations rework: NOT NULL `locality_id`, drop `name`/`notes`, nullable address; item `location_id`; drop `inventories.location_id` if decision 2A). The migration may delete existing `locations` rows and null out referencing FKs rather than backfill (wipe agreed). Each revision still gets a plain downgrade and a downgrade-then-upgrade pytest per the migrations standard.

## Recommendations
- Settle Critical 1 (postal source and licence) with a short research spike before writing the spec. Everything else is implementable with known patterns.
- Backend order: dictionary tables, seed, search endpoint (+ auth matrix row, exact key-set tests), Location rework, item `location_id` + create/update validation through the circulation `locations_acl`, transfer clearing in `ledger._apply_projection`, pickup gate and `_viewer_location` switch, conftest helper.
- Frontend order: `api/localities.ts` + `useLocalitySearch` hook (TanStack Query, prefix key constant); 2-field `LocationAddForm` and `PlaceEditView`; `formatLocationLabel` + null-safe Maps URL across the ~10 display sites; `LocationPicker` `required` prop (hide "none", `aria-invalid`, hint); `itemDraft` in `AppDataContext`; picker in `ItemCreateView` (extend `fieldsMissing` and the hint "…i wybierz lokalizację") and `ItemEditForm`; `useCreateItem` passing `location_id`; remove `InventoryLocationCard` (if decided).
- Tests: a migration test per revision; `test_locations.py`, `test_personal_pickup.py`, `test_item_actions.py` (privacy: anonymous/other/own key sets), a new `test_localities.py` (name prefix, diacritics, postal code, limit), a transfer test (location cleared), and the conftest helper adopted in the 20 files. Frontend: `LocationPicker` required mode, a new `LocationAddForm` test, `ItemCreateView` (blocked without location, draft survives the round trip), `PlacesView`, `TermPlaceLine` with no address. Remember the 12 pre-existing vitest failures.
- Update `architecture.md` (locality dictionary, item location, removed inventory location) and the `models.md` cross-context ACL notes.

## Risk Assessment
- **Complexity Risk**: High. A new reference-data subsystem, plus a shared-entity contract change across 4 bounded contexts (locations, circulation, groups, events) and about 20 frontend files.
- **Integration Risk**: Medium-High. External dataset licensing and format, the Google address combined with a TERYT locality, and the picker round trip with `File` state.
- **Regression Risk**: Medium-High. Personal pickup, `/actions` key sets, term/event place display, about 25 backend and about 15 frontend test files. Privacy regressions (address leaking via the derived name or via transfer) are the most serious and need explicit tests.
