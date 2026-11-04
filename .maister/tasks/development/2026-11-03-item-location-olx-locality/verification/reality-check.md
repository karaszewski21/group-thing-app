# Reality Check: Mandatory item location + OLX-style locality

## TL;DR
- **Status: ⚠️ Issues Found. The code is functionally complete, but nothing has run end to end yet.** Every requested behaviour exists in code, the frontend and backend contracts match, and the tests are green (backend 1174/1174; frontend failures are all unrelated to this feature).
- The local dev database is still at **0077**, so 0078 to 0080 have never been applied outside testcontainers. No browser or E2E pass and no visual-fidelity report exist yet.
- Applying 0080 to the dev DB will delete 20 places, clear the place on 18 terms, 9 events and 10 groups, and leave all 83 items without a location. The user agreed to this (MVP, DB wipe), but it needs to be done knowingly.
- No critical gaps. The warnings are about runtime verification and one narrow case where a pick from `/places/new` can be lost. The rest is info.

## Key Decisions
- Test execution was skipped as instructed. Results come from `verification/test-suite-results.md`. Two targeted re-runs confirmed that the extra frontend failures beyond the earlier 12/13 baseline are unrelated to this feature:
  - `PublicLayout` (top bar and logo link) and `foundation` ("Tomorrow" text).
  - The AppPage edit-group tests fail on a missing "Prowadzę" heading before they reach the place picker.
- The fixture was checked directly. It has 54,440 localities (1,026 TOWN) and 72,245 postal pairs, with 0 orphans. Kęty `0924365` is a TOWN, `32-650` maps to Kęty plus 4 villages, and the Łódź TOWN plus same-name villages fold to "lodz".
- The DB wipe and deleting places in 0080 are accepted user decisions (`analysis/clarifications.md` item 4). They are not counted as gaps.

## Open Questions / Risks
- **Running `alembic upgrade head` on the dev DB is destructive.** See the counts above. Production is not assessed; the requirements say "to nie produkcja".
- **TERYT reuse terms** still need the owner's confirmation (fixture README, "The project owner confirms both at review").
- **About 30 new files are untracked**, including both `.csv.gz` fixtures (about 950 KB) and migrations 0078 to 0080. A `git add -u` or `commit -a` would leave them out and break `alembic upgrade head` on any other checkout.

---

## Reality vs Claims

| Claim | Reality | Evidence |
|---|---|---|
| Location required on item create (backend and frontend) | ✅ True | `CreateInventoryItemRequest.location_id: uuid` is required. `register_item` checks it via `_require_owned_location`: party, then `locations_acl.get_owned_location`, 404 before 403. `ItemCreateView` adds a missing location to `fieldsMissing`, uses a required picker and sends `location_id`. The only frontend caller of `POST /inventory-items` is `useCreateItem`. |
| Same picker as terms/events, "+" goes to `/places/new` | ✅ True | `LocationPicker` has no inline mode, and "+" is a `Link` with `replace` to `placeCreatePath(returnTo, idPrefix)`. It is used by item create/edit, term edit, the first-term stepper, events and groups. |
| Place form reduced to Lokalizacja (required) + Adres (optional) | ✅ True | `LocationAddForm` contains `LocalityCombobox` plus one address field. The address is disabled until a locality is chosen, and changing the locality clears it. `name` and `notes` are gone from the schema, the DTOs and the TS types. |
| OLX-style locality: voivodeship + city, find by postal code or village name | ✅ True | `GET /api/localities`: name prefix on the diacritic-folded `name_search` (`autoescape`), postal prefix `NN`, `NN-N…` or `NNNNN`, TOWN first, 2 statements. The option shows "gm. X, pow. Y, voivodeship" and "· miasto". |
| No exact address on items for others | ✅ True | `_viewer_location` returns only `{locality, formatted_address: None, deleted_at: None}` for OTHER and ANONYMOUS. `ItemDetailsResponse.location_id` is for the owner only and is null when the place is deleted. `InventoryItemResponse` has no `location_id`. |
| Fixture present and seeded | ✅ Committed-ready in the repo and seeded in the test DB. ❌ **Not in the dev DB** | `alembic/data/*.csv.gz` and the README are present and not git-ignored, and the backend Dockerfile `COPY . .` includes them. The dev Postgres `alembic_version` is `0077` and the `localities` relation does not exist. |
| Tests green, no regressions | ✅ True (backend 1174/1174, mypy 15 = baseline). Frontend 21 failures, all unrelated (spot-checked) | See Key Decisions. The spec's success criterion said "beyond the 12-failure baseline". The 8 extra failures (PublicLayout, foundation, LayoutRenderer, extension-points, PendingActionsHost) do not touch locations. |
| Works end to end | ⚠️ **Not demonstrated** | No E2E or browser run. `verification/visual-fidelity.md` is missing, and the dev DB is not migrated, so the running app would fail on `inventory_items.location_id`. |

## Error-Path Walkthrough

| Scenario | Backend | Frontend | Verdict |
|---|---|---|---|
| **No places yet** | n/a | Required picker shows the disabled option "Nie masz jeszcze miejsc" plus the helper "Dodaj miejsce przyciskiem „+”…". Create is blocked with the hint "…i lokalizację, aby zapisać." | ✅ |
| **Cancel from `/places/new`** | n/a | `PlaceCreateView.leave(null)` uses `replace` and passes `{picker, locationId: null}`. The picker marks it handled and keeps its value, and the first-term stepper reopens. Without `returnTo` it pushes `/places`. | ✅ |
| **Save from `/places/new`** | POST returns 201 with the row reloaded through `load_location` | `replace` back and the picker selects the new id once. The item draft and photos live in `AppDataContext`. | ✅ (but see W2) |
| **Deleted place** | Pickup returns 409 "Właściciel nie ustawił lokalizacji przedmiotu". `/details` `location_id` is null. Existing listings stay. Create or PATCH with a deleted place returns 404. | Owner card: "(usunięte)" plus "Odbiór osobisty niedostępny — ustaw lokalizację". Item edit: banner and empty required picker. Non-owners see the plain locality. | ✅ (intended per spec Req. 19/35) |
| **Transferred item (GIFT/SWAP)** | `ledger._apply_projection` sets `location_id = None` for GIFT/SWAP. The confirm path deletes the preference, so the item is DRAFT. A first listing returns 409 "Ustaw lokalizację przedmiotu, aby go wystawić". | Owner card prompts to set a location. The 409 is shown verbatim as a toast. | ✅ Tested, including a full personal SWAP that relists after a location is set (Group 14). |
| **Google unavailable** | Backend never calls Google | `loadPlaces()` failure or a `suggest` rejection switches to manual mode with the alert "Wyszukiwarka niedostępna — wpisz adres ręcznie". With no key configured, the form starts in manual mode. A saved GOOGLE address still shows when there is no key. | ✅ |
| **Postal code search** | `32-65`, `32650` and `32` are normalised to a prefix. The result is distinct localities with their smallest matching code, plus `total`. | The option shows the code. The hint mentions "32-650". | ✅ |
| **Locality search returns 0** | `{results: [], total: 0}` | The combobox shows no listbox and **no "brak wyników" message**. Typing a city district ("Nowa Huta", "Mokotów", folded into its city per the README) silently returns nothing. On blur it shows only "Wybierz miejscowość z listy". | ⚠️ I1 |
| **Search API error** | n/a | `searchError` is shown with `role="alert"`. | ✅ |
| **Typed but un-picked Google address** | n/a | Save is blocked with "Wybierz adres z listy". | ✅ |

## Integration Points
- **Contracts.** I compared these shapes field by field and they match: frontend `Locality`, `LocationResponse`, `LocationRefResponse`, `PublicLocationResponse` and `LocationRequest` against the backend `app/locations/schemas.py`. Also `ItemDetailsResponse.location_id`, `MyInventoryItemResponse.location_id` and `UpdateInventoryItemRequest.location_id` (explicit null returns 400/422). Group 14 states that all 7 shapes were hand-checked.
- **Removed endpoints.** There are no remaining references to `inventories/mine/location`, `useMyInventoryLocation` or `InventoryLocationCard` in `src/`.
- **Auth matrix.** The localities row is READ, PATCH became PUT, and the inventory-location row is removed. `test_authorization_matrix` passes.
- **Every listing-preference creation path is covered.**
  - `list_registered_item` runs at create time, where a location is already required.
  - `set_item_listing_preference` is guarded on `existing is None`.
  - The transient preference at `term_item_listings.py:463` is never persisted.
- **`plugins/events`** (kept but not mounted per architecture.md) still POSTs `{name, formatted_address, source}` to `/api/locations` (`plugins/events/src/domain.ts:313`). That now returns a 400 because of `extra="forbid"` and the missing `locality_id`. It is dead code today; see I2.

## Gaps

### Critical
None.

### Warning
- **W1: No runtime or E2E verification, and the dev DB is not migrated.**
  - Location: the dev Postgres is at `0077`. `verification/visual-fidelity.md` is absent.
  - Impact: tests are the only evidence. Nobody has clicked through "add item → + → /places/new → save → back with photos" in a real browser, Google included.
  - Fixable: yes. Run `uv run python -m alembic upgrade head` (destructive, see Risks), then run the planned e2e-test-verifier pass.
- **W2: A pick from `/places/new` can be lost when the host page mounts its picker late.**
  - Location: `routing/navigation.tsx::useNavigationState` clears the state after the first commit, and `ItemEditView` renders `ItemEditForm`/`LocationPicker` only once `/details` data is available.
  - Trigger: the user spends more than the React Query `gcTime` (5 min by default) on `/places/new`, or details fail to load. The edit page then shows a loading state first, the picker mounts in a later commit, and the new place is not auto-selected. The draft survives and the new place is in the list, so the user must pick it by hand. `TermEditView` has the same shape.
  - Fixable: yes, small. Read `useNavigationState` at the view level and pass the pick down, or make the item details query outlive the trip. Group 11 had already noted "pickers mounting late would miss picks".

### Info
- **I1: No "no results" feedback in `LocalityCombobox`.**
  - Location: `components/shared/LocalityCombobox.tsx`.
  - Impact: a typo or a city-district name gives silent emptiness.
  - Fixable: yes. Add a `role="status"` line such as "Brak miejscowości — sprawdź pisownię lub wpisz kod pocztowy".
- **I2: The unmounted `plugins/events` still uses the old location contract.**
  - Location: `plugins/events/src/domain.ts:160,313`.
  - Fixable: yes, update it or delete it. It is out of scope today.
- **I3: A stale draft location gives an unfriendly error.** This happens when `itemDraft.location_id` points to a place deleted while the draft was kept: the picker shows the placeholder but the value is not null, so submit is enabled. The backend answers 404, and `serverMessageOr` shows its message, which is possibly a generic "not found" text and not Polish copy.
  - Location: `features/items/ItemCreateView.tsx` (`fieldsMissing` only checks `=== null`).
  - Fixable: yes. Treat an id that is not in the live `useMyLocations` list as missing.
- **I4: About 30 untracked new files**, including the fixtures and migrations 0078 to 0080. Committing without `git add` of new paths would ship code that cannot migrate.
- **I5: The AppPage edit-group and add-term tests** (pre-existing failures) fail before they reach the place picker. Group default-place and add-term picker behaviour in page mode is therefore covered only by the `LocationPicker` unit tests and the rewritten "add group +" test.
- **I6: An admin or another user registering an item into someone else's inventory** must pass a place owned by the inventory owner (`_require_owned_location(db, inventory.owner_user_id, …)`). That is correct by design. Only `useCreateItem` (own PERSONAL inventory) exists in the UI today.

## Functional Completeness
About **95%** against the user's request and the spec. All requested behaviours exist and are tested. The remaining 5% is proof that it runs, plus the small UX gaps above.

## Pragmatic Action Plan

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Confirm the dev DB wipe, then run `alembic upgrade head` on the dev DB | `alembic_version = 0080`. `select count(*) from localities` returns 54440, and `locality_postal_codes` returns 72245. | High | 5 min |
| 2 | Run the browser/E2E pass over the 5 mockup screens and the round trips (item create with photos → + → save and cancel; item edit; first-term stepper; Google off/on; postal `32-650`) | `verification/visual-fidelity.md` written, with no ✗ entries | High | 30–60 min |
| 3 | Fix W2: hoist the pick read in `ItemEditView`/`TermEditView`, or keep details cached | A test where the details load after the return still selects the new place | Medium | 30 min |
| 4 | Add an empty-result status line to `LocalityCombobox` (I1) | A query with 0 results shows the message; covered by a test | Low | 15 min |
| 5 | Treat a draft location that is no longer live as missing (I3) | Create stays blocked with "Wybierz lokalizację" | Low | 15 min |
| 6 | Stage all new files when committing; owner confirms the TERYT/PRG licence | `git status` shows no `??` under `src/` | Medium (at commit) | 5 min |
| 7 | Update or delete `plugins/events` location calls (I2) | grep finds no `name:` in its place payload | Low | 15 min |

## Completion Verdict
**⚠️ Gaps.** The implementation does what the user asked:
- items need an owned place, picked through the shared page-mode picker;
- the place form is Lokalizacja (TERYT, by name or postal code) plus an optional Adres;
- buyers see the locality only;
- transfers and deleted places degrade correctly.

It is not yet *demonstrated* to work in the running app. The dev DB has not been migrated and no browser pass exists. Do actions 1 and 2 before calling it done. Action 3 is a small robustness fix worth making in the same pass.
