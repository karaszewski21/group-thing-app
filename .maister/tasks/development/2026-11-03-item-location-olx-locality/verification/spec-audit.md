# Spec Audit: Mandatory item location + OLX-style locality (TERYT)

## TL;DR
- Verdict: **pass-with-concerns** (Mostly Compliant). The spec is implementable against the current codebase. Every backend consumer of `Location.name`/`formatted_address`/`notes` and of `inventories.location_id` is accounted for, and the 4 FKs to `locations` match what migration 0080 nulls.
- Counts: **Critical 0, High 2, Medium 6, Low 8**.
- High 1: after a `/places/new` round trip, `ItemEditView`'s "Zapisz/Anuluj" uses `navigate(-1)` and lands the user back on `/places/new`.
- High 2: the privacy guarantee contradicts itself. `/actions` term contexts carry `location_name = label`, and that label includes the address. The success criterion says no non-owner `/actions` response contains `label`, `formatted_address` or an address substring.

## Key Decisions
- **No Critical findings.** No break of core functionality or security was found. The privacy contradiction (H2) is rated High, not Critical: the only address that can leak is one the owner already published on a term.
- **Author flags 1, 2, 3, 6, 7 and 8 are accepted.** They are consistent with the code and the standards; the evidence is in section "Author-flagged items".
- **Missing test-plan coverage is rated Medium or Low, not High.** `npm run typecheck`, exact key sets and the pytest suite will surface these gaps mechanically during implementation.

## Open Questions / Risks
- Should `/actions` contexts (`ItemContextOptionResponse.location_name`) show the full `label` (address included) or only the locality? See H2.
- What happens to an already-listed item when its place is soft-deleted? Does a visibility-only change on such a listing get a 409? See M3.
- The GUGiK PRG postal licence and format cannot be verified offline. The fallback (empty `locality_postal_codes`) is well defined in the spec.
- Test-suite time: 22 existing migration tests downgrade below 0079, so each one re-seeds about 100–140k rows (M6).

---

## Scope of verification
- Read: `implementation/spec.md`, `analysis/requirements.md`, `scope-clarifications.md`, `clarifications.md`, `design-context/INDEX.md`, item-page mockup text, `gap-analysis.md` decisions.
- Backend code checked: `app/locations/*`, the three `infrastructure/locations_acl.py`, `circulation/infrastructure/{ledger,repository}.py`, `circulation/application/{inventory,inventory_items}.py`, `circulation/{router,schemas}.py`, `groups/application/{item_actions,reservation_context,term_item_listings,owner_items,public_view,terms,circles}.py`, `groups/infrastructure/{circulation_bridge,events_acl}.py`, `events/{page,router,service}.py`, `core/authorization_matrix.py`, `core/cache_headers.py` usage, alembic 0057/0058/0069/0070/0075, `alembic/env.py`, `db.py`, `pyproject.toml`, `Dockerfile`.
- Frontend code checked: `LocationPicker`, `PlaceCreateView`, `FirstTermStepperOrganizer`, `TermEditForm`, `AddTermView`, `EventForm`/`EventEditView`, `GroupFormFields`/`GroupEditView`, `ItemCreateView`, `ItemEditView`, `ItemBackButton`, `ItemContextActions`, `AppDataContext`, `api/{locations,inventories,items,itemActions}.ts`, `hooks/{useMyLocations,useItemDetail,useItemActions}.ts`, `lib/{googleMaps,publicMetadata}.ts`.
- Tests checked: grep across `src/backend/tests` and `src/frontend/src/test`.

## Verified claims (no finding)
- **FKs to `locations`.** There are exactly 4: `groups.default_location_id` (`app/groups/models.py:128`), `terms.location_id` (`:219`), `events.location_id` (`app/events/models.py:48`) and `inventories.location_id` (`app/circulation/models.py:194`). 0080's null-then-delete list is complete.
- **Backend consumers of the place's name and address.**
  - `item_actions.py:216` (term `location_name`) and `:250-256` (`_viewer_location`).
  - `owner_items.py:163`.
  - `events_acl.py:139`.
  - Every `LocationRefResponse`/`PublicLocationResponse` builder goes through the ACLs: `groups/router/circles.py:70,130`, `groups/router/terms.py:42,77`, `public_view.py:145,313`, `terms.py:129`, `events/page.py:191`, `events/router.py:56`.
  - The spec's req. 11 and the ACL delegation cover all of them. No messaging or notification code reads location fields.
- **Inventory-location consumers.**
  - `circulation/application/inventory.py:81-107`.
  - `circulation/infrastructure/repository.py:148-163`.
  - `circulation_bridge.py:240-244`.
  - `reservation_context.py:284`.
  - `item_actions.py:88-89`.
  - Router `circulation/router.py:130-141`.
  - Matrix `authorization_matrix.py:172`.
  - Frontend: `InventoryLocationCard`, `useMyInventoryLocation`, `api/inventories.ts:157-172`, `MyItemsView.tsx:24,279`.
  - All are listed in req. 20/32. No browse/listing SQL predicate reads `inventories.location_id`.
- **Item creation entry points.** There is one backend route (`circulation/router.py:157`) and one frontend caller (`hooks/useCreateItem.ts:48`). No plugin or other client POSTs `/api/inventory-items`.
- **Existing helpers and patterns the spec relies on.** `find_party_id_by_user_id` (`repository.py:~138`), `get_own_location` 404→403 (`locations/service.py:101-111`), `leaf_category_ids` (`tests/conftest.py:149`) and the 0069 fixture path pattern (`0069_vinted_categories.py:51`) all exist. `api.put` exists (`api/client.ts:90`).
- **Cache headers.** `/actions` (`groups/router/item_actions.py:29`) and `/details` (`circulation/router.py:217`) already call `set_personalised_cache_headers`. The anonymous `/actions` will now contain the locality, which is fine to share-cache.
- **Picker hosts and drafts.**
  - `GroupCreateView`/`GroupEditView`: drafts already live in `AppDataContext`, seeded once per id (`GroupEditView.tsx:29-31`, `AppDataContext.tsx:594-603`).
  - `EventForm`: drafts in `AppDataContext` (`eventDraft`/`eventEdit`).
  - `AddTermView`: drafts in `AppDataContext` (`termLocationId`).
  - The inline-mode hosts are exactly `TermEditForm.tsx:210` and `FirstTermStepperOrganizer.tsx:120` (`addMode="inline"`), plus the removed `InventoryLocationCard.tsx:37`.
  - The panel layout keeps `AppDataContext` mounted across `/add/product` ↔ `/places/new` ↔ `/items/:id/edit` (`app/(site)/(panel)/layout.tsx`).
- **Authorization matrix.**
  - Row 207 changes `PATCH,DELETE` to `PUT,DELETE`.
  - Row 172 is removed. The GET falls under row 38, so the route deletion is enough.
  - A new `GET ^/api/localities$` READ row is added.
  - `tests/test_authorization_matrix.py:277` (`PATCH /api/locations/x`) must become PUT.

---

## High

### H1. Item edit "Zapisz/Anuluj" returns to `/places/new` after the `+` round trip
- **Spec reference:** req. 26 and success criterion "Item create and edit … keep every typed value … across `/places/new`".
- **Evidence:**
  - `features/items/ItemEditView.tsx:24-27`: `done = () => { if (hasInAppHistory) navigate(-1); else navigate(viewPath("items")); }`.
  - `features/places/PlaceCreateView.tsx:33-35` returns with a push: `navigate(backTo, { state })`, with no `replace`.
  - After item page → edit → `+` → `/places/new` → back to edit, the history is `[…, item, edit, places/new, edit]`. Saving or cancelling therefore lands on `/places/new`.
  - `ItemBackButton.tsx:13-15` has the same problem after an item-create round trip: `[…, add/product, places/new, item(replaced)]`.
  - `EventEditView.tsx:42-43` avoids it by navigating to an explicit `eventHref`.
- **Category:** missing requirement / unimplementable as written (the core story "set location on a transferred item" is the flow that hits it).
- **Severity:** High. It happens on the primary path whenever the owner adds a new place from item edit.
- **Recommendation:** pick one of these and state it in the spec:
  - (a) `ItemEditView` navigates explicitly to `itemHref`/`/items` (the event pattern).
  - (b) `PlaceCreateView` uses `replace: true` when it returns to a picker (`returnTo && picker`). This also needs checking against `AddTermView`/`EventForm` back behaviour.

### H2. "Non-owners never receive address-derived text" contradicts req. 11 and req. 18
- **Spec reference:**
  - TL;DR bullet 3 and Key Decision "Item responses for non-owners never carry `label`".
  - Success criterion: "No non-owner `/actions` response contains `formatted_address`, `label` or any substring of the place's address".
  - Req. 11: `ItemContextOptionResponse.location_name` = `label` (which is "Kęty — {formatted_address}").
  - Req. 18: `ItemLocationResponse` keeps a `formatted_address` key (null for non-owners).
- **Evidence:**
  - `groups/application/item_actions.py:195-216` batches the item's place together with the owner's term places (the same `locations` dict) and emits `location_name=term_location.name` into `contexts`, which go to OTHER and ANONYMOUS viewers.
  - If the owner reuses one place for the item and a term (likely, since places are per person), the address appears in the non-owner `/actions` JSON.
  - The test "non-owner JSON contains no address substring" then fails, or passes only because the fixture happens to use different places.
  - The criterion's literal "contains `formatted_address`" also conflicts with req. 18's null-valued key.
- **Category:** contradictory.
- **Severity:** High. This is the spec's own highest-risk area, and the test oracle is ambiguous.
- **Recommendation:** decide one of:
  - (a) Context `location_name` uses the locality-only label in `/actions` (and `owner_items`).
  - (b) Accept that a term's public address may appear. Then reword the criterion to "the item location block never carries address-derived text" and pin the test to a place not used by a term.
  - Also reword "contains `formatted_address`" to "a non-null `formatted_address`".

---

## Medium

### M1. Two existing migration tests cannot "keep passing" unchanged
- **Spec reference:** Testing: "Keep `test_inventory_location_migration.py` passing"; the test plan does not mention `test_locations_migration.py`.
- **Evidence:**
  - `tests/test_inventory_location_migration.py:62-72` asserts at **head** that `inventories.location_id`, `fk_inventories_location_id_locations` and `ix_inventories_location_id` exist, but 0080 drops them.
  - `tests/test_locations_migration.py:21,75` asserts that `uq_locations_owner_party_id_google_place_id` exists at head, but 0080 drops it.
  - `test_personal_pickup_migration.py:208-233` still holds: the chain stops at the 0075 guard after 0080's downgrade re-adds the column, with `transaction_per_migration=True` (`alembic/env.py:33`).
- **Category:** incorrect assumption about existing code.
- **Recommendation:** rewrite both tests to assert their revision's schema at that revision (`upgrade 0075`/`0058` then inspect, then `upgrade head`), or move the head assertions into `test_localities_migration.py`.

### M2. Loading `Location.locality` after writes is unspecified (`lazy="raise"`)
- **Spec reference:** Key Decision 2 and "Locations module". The loaders are defined only for reads.
- **Evidence:**
  - `locations/service.py:96-97` (create) and `:125-126` (update) do `db.commit(); db.refresh(location)`.
  - `locations/router.py:46,56` then `LocationResponse.model_validate(location)`.
  - With `expire_on_commit=False` (`app/db.py:15`) and `lazy="raise"`, a computed `label` or a nested `locality` raises on serialization.
  - After PUT changes `locality_id`, a previously joined-loaded `locality` is also stale.
  - `circulation/infrastructure/locations_acl.py:27-32` (`get_owned_location` returns `LocationRefResponse`) needs the locality loaded as well.
- **Category:** unimplementable as written (detail missing).
- **Recommendation:** state that POST/PUT re-read the row through `load_location` (or `refresh(location, ["locality"])` after `expire`) before building the response. Also state that `get_own_location` uses `joinedload`.

### M3. Listing invariant vs place soft delete is underspecified
- **Spec reference:** req. 17, Key Decision "A soft-deleted place stays referenced", TL;DR "needed to list the item".
- **Evidence:**
  - `groups/application/term_item_listings.py:169-226`: `set_item_listing_preference` with a non-null `mode` is also the path for a visibility-only change (`visibility` with the current mode).
  - Under req. 17, an owner whose listed item's place was deleted cannot switch PUBLIC↔PRIVATE without first setting a new location.
  - Deleting a place leaves its items ACTIVE, so "every listed item has a live location" does not hold.
- **Category:** ambiguous.
- **Recommendation:** clarify whether (a) the 409 applies only when the mode moves from null to non-null, or to every non-null write, and (b) a place delete leaves listings as they are (accepted) or warns the owner.

### M4. Item edit with a soft-deleted place has no picker fallback
- **Spec reference:** req. 15, 24 and 26.
- **Evidence:**
  - Item edit gets only `location_id` (`ItemDetailsResponse`, req. 15).
  - `useMyLocations` lists active places only (`locations/service.py:35-41`).
  - `LocationPicker` shows a missing value only through `fallbackLocation` (`LocationPicker.tsx:75-79`).
  - Req. 26 defines the banner only for "no location". A deleted place's id matches no option, so the native select shows the placeholder while the draft still holds the deleted id. Saving unchanged then sends nothing, which is inconsistent with "required".
- **Category:** missing requirement.
- **Recommendation:** treat a deleted place as no location in item edit (seed `locationId = null` + banner), or carry a `{id, label, deleted_at}` fallback for the owner (e.g. from `/actions` `location`).

### M5. Draft lifecycle gaps for the new `AppDataContext` slices
- **Spec reference:** req. 26, 27 and 28.
- **Evidence:**
  - The existing `eventEdit` is cleared on save (`EventEditView.tsx:42`).
  - The spec says `itemEdit`/`termEdit` are "seeded once per item/term" but never says when they are cleared. With the `GroupEditView` pattern (`GroupEditView.tsx:29-31`), cancelling and later reopening the same item shows the stale draft.
  - Stepper:
    - Cancelling on `/places/new` (`PlaceCreateView.tsx:38`, `navigate(backTo)` with no state) does not reopen the modal, and the draft lingers.
    - `onAddClick` must close without the "closing clears the draft" path.
    - The reopen effect needs a once-only guard, as the picker's `handledPick` does, or it reopens again while the same history entry still carries the state.
- **Category:** incomplete.
- **Recommendation:** specify clearing on save and cancel for `itemEdit`/`termEdit`, and separate "close for `+`" from "close and discard" for the stepper. Define the cancel-from-`/places/new` behaviour and a once-only reopen.

### M6. Migration-test seed cost
- **Spec reference:** Open Questions "Test-session cost", target of 10 s or less per 0079 upgrade.
- **Evidence:** `ls tests/*migration*.py` gives 22 files, all downgrading below 0077, so each one re-runs 0079 on `upgrade head`. At 10 s each that is about 4 min added. The number of downgrades per file can be more than one.
- **Category:** risk.
- **Recommendation:** keep the unnest seed. Consider making 0079's downgrade a no-op `DELETE` (fast) and measure. If it is too slow, the spec should allow `COPY FROM STDIN` via the raw asyncpg/psycopg connection.

---

## Low

- **L1. `location_id` visible to non-owners through `InventoryItemResponse`.** Req. 15 adds `location_id` to `InventoryItemResponse`. `GET /api/inventory-items/{id}` is readable by any logged-in viewer who can see the item (`circulation/router.py:181-185`). This is inconsistent with the owner-only rule chosen for `ItemDetailsResponse`. Since there is no `GET /api/locations/{id}`, only linkability leaks. Make it owner-only or document it.
- **L2. Deleted place shown differently to owner and non-owners.** Non-owners receive `deleted_at = null` for a deleted place (req. 18), so they see "Otwórz w Mapach", while the owner's link is hidden (req. 30). The mockup has no non-owner deleted state. Confirm that this is intended.
- **L3. Display sites missing from req. 31:**
  - `PersonalPickupSheet locationName={choose.location.name}` (`ItemContextActions.tsx:204`).
  - `TermCard`'s `buildMapsUrl(location)` (`TermCard.tsx:48`); req. 31 gives Maps rules only for `TermPlaceLine`/`EventWhenCard`.
  - `EventWhenCard` calendar `groupName: location?.name` (`EventWhenCard.tsx:65`).
  - `OwnerMeetingsPage.tsx:35` and `ChooseContextSheet.tsx:11`: the `location_name` strings get longer with the address.
- **L4. Frontend fixtures and test files outside the plan.**
  - Fixture coverage: 19 test files build location objects inline (e.g. `AppPage.test.tsx` ×9, `LocationPicker.test.tsx` ×15, `PlacesView.test.tsx` ×13, `PendingActionsHost.test.tsx`, `LayoutRenderer.test.tsx`, `publicMetadata.test.ts`, `eventDraft.test.ts`). There is no shared typed factory. Recommend `makeLocality()`/`makeLocationRef()` factories in `src/test` per frontend-testing.md "fully typed fixture factories".
  - Backend: `test_events.py`, `test_group_location_defaults.py` and `test_term_location_capacity.py` POST `/api/locations` with `name`/`notes` (rejected by `extra=forbid`) but are not named in the plan.
  - Backend: `_set_location` is imported from `test_personal_pickup` by other files.
- **L5. Search folding details.** A `LIKE` prefix built from user input must escape `%`, `_` and `\`. `fold_polish` must map `ł`/`Ł` explicitly, because NFKD does not decompose them. Neither is stated.
- **L6. Build script tooling.** `scripts/` does not exist (flag 4). `mypy` runs on `app` only (backend-testing.md:76), so the script is covered by `ruff check` but not by mypy. `import app...` works because `uv sync` installs the project. State the run command (`uv run python scripts/build_localities.py …` from `src/backend`).
- **L7. Ranking puts every TOWN before an exact name match.** A village named exactly like the query can rank below towns whose names only start with it (e.g. "Nowa Wieś" vs "Nowa Wieś Wielka"). Confirm the order against "towns ranked first".
- **L8. Location edits during an open reservation and stale caches.**
  - Changing `location_id` while a personal-pickup reservation is open is unspecified. `update_item` allows edits regardless of balance (`inventory_items.py:256-258`).
  - After a location PATCH, `useItemEditing` invalidates only `ITEM_DETAILS_KEY` (`hooks/useItemDetail.ts:99`), not `ITEM_ACTIONS_KEY` (`hooks/useItemActions.ts:8`) or the my-items list used for the prefill.

---

## Author-flagged items

| # | Flag | Result |
|---|---|---|
| 1 | PATCH → PUT `/api/locations/{id}` | **Accept.** Consistent with api.md (full replacement). Update matrix row `authorization_matrix.py:207`, `test_authorization_matrix.py:277` and `api/locations.ts:69-71` (`api.put` exists). |
| 2 | `ItemDetailsResponse.location_id` owner-only | **Accept.** Needed for the edit prefill (`ItemEditView` reads `/details`). See L1 for the inconsistency with `InventoryItemResponse`. |
| 3 | Soft-deleted place still shows its locality to non-owners | **Accept.** See L2 (Maps link and note asymmetry) and M4 (owner edit). |
| 4 | `src/backend/scripts/` missing | Confirmed absent. See L6. |
| 5 | `test_inventory_location_migration.py` | Cannot pass unchanged. See M1 (also `test_locations_migration.py`). |
| 6 | Natural-PK carve-out (SIMC `String(7)`) | **Accept.** Precedent in models.md:81,90,179 (`PluginDescriptor` string PK on plain `Base`, `app/core/base_model.py:21`). Document it as the third carve-out. |
| 7 | 0080 lossy plain downgrade | **Accept.** migrations.md requires guards only for ledger-linked rows. `locations` are not ledger-linked, and the user waived compatibility (clarifications.md Q4). The docstring and architecture runbook must state that a downgrade below 0080 deletes all places and item locations. |
| 8 | Clearing on GIFT/SWAP only | **Verified.** The posted movements are REGISTER (`inventory_items.py:80-86`), REMOVE (`:286-288`) and GIFT/SWAP (`reservation_transitions.py:187-189`, `MovementType(reservation_type)`). LEND/RETURN are never posted (`circulation/models.py:61-71`). `_apply_projection` (`ledger.py:189-198`) is the single write point. |
| 9 | Seed performance | See M6. |
| 10 | GUGiK PRG licence/format | Cannot be verified offline. The fallback is well defined (empty postal table, hint text changes, `[]` for code queries). |

## Extra features (not in requirements)
- `total` count and the overflow line, `onAddClick`, `localityDetail`/`localityMapsQuery` helpers, and `MyInventoryItemResponse.location_id` for the prefill. All are justified by the mockups or the prefill decision; none is speculative.

## Recommendations (ordered)
1. Resolve H2 (context `location_name` privacy) and reword the success criterion.
2. Fix H1 by specifying explicit navigation after item edit, or `replace` on the picker return.
3. Add the post-write locality reload (M2) and the draft clearing and stepper cancel rules (M5) to the spec.
4. Amend the test plan: rewrite the two migration tests (M1), list the 3 location-body test files and add typed frontend fixture factories (L4), and add invalidation of `ITEM_ACTIONS_KEY` (L8).
5. Clarify M3 (listing guard scope) and M4 (deleted place in item edit).
