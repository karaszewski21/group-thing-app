# Work Log

## 2026-11-03T18:38:33Z - Implementation Started

**Total Steps**: 99
**Task Groups**: 1 Locality Dictionary Data & Seed Migrations; 2 Locations & Item-Location Schema Migration; 3 Localities Search & Locations API; 4 Item Location in Circulation; 5 Item Page Privacy, Personal Pickup & Listing Guard; 6 Backend Shared Location Helpers Adoption; 7 Frontend Location Contract; 8 Place Form & Locality Combobox; 9 Required Page-Mode LocationPicker; 10 Item Create & Edit with Required Location and Drafts; 11 Term, First-Term Stepper, Event & Group Picker Hosts; 12 Item Page Location Card & Display Sites; 13 Documentation & Removal Audit; 14 Test Review & Gap Analysis
**Note**: TaskCreate/TaskList unavailable in this session — plan checkboxes + this log are the tracker.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-03T18:44:47Z - Group 7 Complete (wave 1)

**Steps**: 7.1 through 7.9 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, testing/frontend-testing.md, frontend/components.md, global/minimal-implementation.md, global/coding-style.md
- From INDEX.md: backend/api.md (PUT, plural /localities), global/commenting.md
- Discovered: none
**Tests**: 46 passed (useLocalitySearch, locationLabel, useMyLocations, MyItemsView, MyItemsViewCategory); eslint 0 errors
**Files Modified**: api/locations.ts, api/localities.ts (new), api/inventories.ts, api/items.ts, api/itemActions.ts, hooks/useLocalitySearch.ts (new), hooks/useMyLocations.ts, hooks/useMyInventoryLocation.ts (deleted), utils/locationLabel.ts (new), utils/appHelpers.ts, lib/googleMaps.ts, features/items/InventoryLocationCard.tsx (deleted), features/items/MyItemsView.tsx, test/fixtures/locations.ts (new), tests
**Notes**: typecheck red in consumers until Groups 8–12 (expected). Unowned files reassigned by main agent: features/groups/GroupEditView.tsx → Group 9; test/EventComponents.test.tsx, test/eventDraft.test.ts, test/TermPage.test.tsx, test/OrganizerItemRoute.test.tsx, test/useItemDetail.test.tsx, test/useItemTake.test.tsx → Group 12. ThreadPage.tsx has 4 unrelated TS6133 errors (pre-existing, out of scope). InventoryLocationCard.tsx's pre-existing git 'M' status was only a CRLF line-ending change (verified in Phase 1), so no user content was lost by deleting it.

### Standards Reading Log — Group 7
**From Implementation Plan**: frontend/data-fetching.md, testing/frontend-testing.md, frontend/components.md, global/minimal-implementation.md, global/coding-style.md
**From INDEX.md**: backend/api.md, global/commenting.md

## 2026-11-03T18:53:40Z - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.10 completed
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md (string-PK precedent), backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md, coding-style.md, commenting.md
- From INDEX.md: project/tech-stack.md
- Discovered: backend/migrations.md §Data Migrations (no storage-backed rows → no outbox)
**Tests**: 10 passed (test_localities.py, test_localities_migration.py); mypy app 15 (baseline); ruff clean on group files (repo-wide 46 pre-existing errors elsewhere)
**Data**: TERYT SIMC/TERC (GUS, stan 2026-01-01) + GUGiK PRG address points (licence: free, any use). localities 54,440 (1,026 TOWN / 53,414 VILLAGE); postal pairs 72,245; fixtures ~0.95 MB gz. City districts folded into their city (documented in README).
**Seed timing**: 0079 = 2.00 s; migration suite 121.66 s → 178.75 s (+57 s, within 2-min budget); COPY fallback not needed.
**Files Modified**: app/locations/localities.py, scripts/build_localities.py, alembic/data/localities_pl.csv.gz, alembic/data/locality_postal_codes_pl.csv.gz, alembic/data/localities_pl.README.md, alembic/versions/0078_localities.py, alembic/versions/0079_seed_localities.py, tests/test_localities.py, tests/test_localities_migration.py
**Notes**: Group 3 model must mirror 0078 exactly (ck_localities_kind, text_pattern_ops/varchar_pattern_ops). Group 13 to document city-district fold, TERYT/PRG attribution, String(7) carve-out, and suggested standard: bind arrays with CAST(:x AS text[]) in sa.text. Owner should confirm TERYT reuse terms. PRG scratch download deleted by main agent.

### Standards Reading Log — Group 1
**From Implementation Plan**: backend/migrations.md, backend/models.md, backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md, global/coding-style.md, global/commenting.md
**From INDEX.md**: project/tech-stack.md
**Discovered During Execution**: backend/migrations.md §Data Migrations (data seed step)

## 2026-11-03T18:57:00Z - Group 9 Complete (wave 2)

**Steps**: 9.1 through 9.7 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, global/validation.md, global/minimal-implementation.md, testing/frontend-testing.md
- From INDEX.md: frontend/data-fetching.md
- Discovered: none
**Tests**: 7 passed (LocationPicker.test.tsx); eslint clean
**Files Modified**: components/shared/LocationPicker.tsx, test/LocationPicker.test.tsx (GroupEditView.tsx error resolved without edit)
**Notes**: Final prop API: value, onChange, label, idPrefix, noneLabel?, required?, invalid?, errorText? ("Wybierz lokalizację"), fallbackLocation? {id,label,deleted_at}, helperText?, onAddClick?. Group 11 must remove addMode="inline" at FirstTermStepperOrganizer.tsx:120 and TermEditForm.tsx:210. Detail line under select per spec Req. 26 (mockup omitted it). useMyLocations.create no longer used by picker — check after Group 8.

### Standards Reading Log — Group 9
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, global/validation.md, global/minimal-implementation.md, testing/frontend-testing.md
**From INDEX.md**: frontend/data-fetching.md

## 2026-11-03T19:00:48Z - Group 8 Complete (wave 2)

**Steps**: 8.1 through 8.7 completed
**Standards Applied**:
- From plan: frontend/accessibility.md (inline combobox), frontend/components.md, frontend/data-fetching.md, global/validation.md, testing/frontend-testing.md, frontend/css.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: none
**Tests**: 19 passed (LocalityCombobox 5, LocationAddForm 4, PlaceCreateView 3, PlacesView 7); typecheck + eslint clean on group files
**Files Modified**: components/shared/LocalityCombobox.tsx (new), components/shared/LocationAddForm.tsx, features/places/PlaceCreateView.tsx, PlaceEditView.tsx, PlacesView.tsx, tests
**Notes**: Request shapes: {locality_id} | + {formatted_address, source MANUAL} | + {source GOOGLE, google_place_id, lat, lng}. Google bias via query suffix "{locality}, {voivodeship}". Bug found+fixed: editing GOOGLE place without Maps key no longer drops the address. Suggested standard: "more results" line under a listbox is role=status outside the listbox (LocalityCombobox.tsx).

### Standards Reading Log — Group 8
**From Implementation Plan**: frontend/accessibility.md, frontend/components.md, frontend/data-fetching.md, global/validation.md, testing/frontend-testing.md, frontend/css.md
**From INDEX.md**: global/minimal-implementation.md

## 2026-11-03T19:02:56Z - Group 2 Complete (wave 2)

**Steps**: 2.1 through 2.5 completed
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: backend/time.md (checked, n/a)
- Discovered: none
**Tests**: 3 passed (test_inventory_location_migration, test_locations_migration incl. data case). -k migration: 59 passed / 10 failed — all UndefinedColumn inventories.location_id from ORM Inventory model (Group 4 owns; expected red until then).
**Files Modified**: alembic/versions/0080_item_location_locality.py (new), tests/test_inventory_location_migration.py, tests/test_locations_migration.py
**Notes**: CHECK ck_locations_address_fields; fk_locations_locality_id_localities RESTRICT; fk_inventory_items_location_id_locations + ix_inventory_items_location_id partial. 0075 guard verified still works after 0080 downgrade. Group 4 must drop Inventory.location_id + index from models and re-run -k migration.

### Standards Reading Log — Group 2
**From Implementation Plan**: backend/migrations.md, backend/models.md, testing/backend-testing.md, global/minimal-implementation.md
**From INDEX.md**: backend/time.md

## 2026-11-03T19:05:28Z - Group 12 Complete (wave 2, PARTIAL → accepted)

**Steps**: 12.1 through 12.7 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: eslint react-refresh/only-export-components → Maps helper termPlaceMapsUrl moved to utils/locationLabel.ts
**Tests**: 333 passed / 14 failed across 16 files. 13 failures pre-exist on clean HEAD (AppPage 12, TermPage 1). 1 new: AppPage "add group: place picker + goes to /places/new" uses old "Nazwa miejsca" form → reassigned to Group 11 (now unblocked by Groups 8/9).
**Files Modified**: ItemContextActions.tsx, itemActionsViewState.ts, PersonalPickupSheet.tsx, TermPlaceLine.tsx, EventWhenCard.tsx, TermCard.tsx, GroupDetailsPage.tsx, GroupsView.tsx, AdminTermsPage.tsx, lib/publicMetadata.ts, utils/locationLabel.ts (+termPlaceMapsUrl), 14 test files
**Visual deviations**: full localityDetail in deleted state; "Odbiór osobisty dostępny" only in choose view with pickup available; non-owner copy per mockup.

### Standards Reading Log — Group 12
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md
**From INDEX.md**: global/minimal-implementation.md
**Discovered During Execution**: eslint rule react-refresh/only-export-components (helper placement)

## 2026-11-03T19:05:28Z - Wave 2 resolved (Groups 2, 8, 9, 12)

## 2026-11-03T19:17:29Z - Group 10 Complete (wave 3, PARTIAL → accepted)

**Steps**: 10.1 through 10.7 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, global/validation.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: frontend/css.md (danger tokens for banner; themeTokenUsage)
**Tests**: 30 passed (ItemCreateView 21, ItemEditView 4, ItemQuickAddForm 5); useItemDetail 8, themeTokenUsage 112, ssrSafety 10 pass. Breaks 6 ItemDetailPage.test.tsx edit-page tests (mock lacks itemEdit/setItemEdit/refreshItems; button now "Zapisz zmiany") → reassigned to Group 11.
**Files Modified**: utils/itemQuickAdd.ts, features/panel/AppDataContext.tsx (itemDraft/itemPhotos/itemEdit + refreshItems), ItemCreateView.tsx, ItemQuickAddForm.tsx, hooks/useCreateItem.ts, hooks/useItemDetail.ts (saveLocation), ItemEditView.tsx, product/ItemEditForm.tsx, tests
**Notes**: Prefill = newest item's live place, else only place. Round-trip history verified (no /places/new entry). Suggested standard: shared stateful useAppData test stand-in (src/test/panelDataMock.ts).

### Standards Reading Log — Group 10
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, global/validation.md, testing/frontend-testing.md
**From INDEX.md**: global/minimal-implementation.md, global/commenting.md
**Discovered During Execution**: frontend/css.md

## 2026-11-03T19:17:40Z - Group 3 Complete (wave 3)

**Steps**: 3.1 through 3.11 completed
**Standards Applied**:
- From plan: backend/models.md, backend/queries.md, backend/jooq.md, backend/api.md, backend/security.md, global/validation.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: app/core/errors.py validation_error_handler → API validation errors are 400 (not 422 as plan said)
**Tests**: 185 passed / 10 failed (test_public_term 4, test_organizer_page 6 — all inventories.location_id ORM column, Group 4 dependency). test_localities + test_locations: 34 passed. mypy 15 (baseline). ruff clean on touched files.
**Files Modified**: app/locations/{models,localities,schemas,service,router}.py, app/core/authorization_matrix.py, 3 locations_acl.py, groups/application/item_actions.py (context label + interim _viewer_location locality.name), owner_items.py, groups/infrastructure/events_acl.py, tests/conftest.py (locality_ids, create_location), 6 test files
**Notes**: Location.label model property (single source; requires loader-loaded locality). Test SIMC ids: Kęty 0924365, Łódź 0957650. Group 5 must rewrite test_item_actions.py / test_personal_pickup.py place bodies. Group 13: document 400-not-422 and label property.

### Standards Reading Log — Group 3
**From Implementation Plan**: backend/models.md, backend/queries.md, backend/jooq.md, backend/api.md, backend/security.md, global/validation.md, global/error-handling.md, testing/backend-testing.md
**From INDEX.md**: global/minimal-implementation.md
**Discovered During Execution**: app/core/errors.py (400 validation convention)

## 2026-11-03T19:17:40Z - Wave 3 resolved (Groups 3, 10)

## 2026-11-03T19:28:02Z - Group 4 Complete (wave 4, PARTIAL → accepted, cross-group dependency)

**Steps**: 4.1 through 4.9 (4.9 partially green — test_item_details.py waits on Group 5's _register_personal_item helper)
**Standards Applied**:
- From plan: backend/models.md, backend/security.md, backend/queries.md, global/validation.md, global/minimal-implementation.md, testing/backend-testing.md
- From INDEX.md: backend/api.md, global/error-handling.md
- Discovered: app/core/errors.py (400 validation)
**Tests**: test_item_location.py 6/6; test_authorization_matrix full pass; -k migration 68 passed / 1 failed (test_circulation migration0034 — item create 400, Group 6); test_item_details 8 failing via Group 5 helper. mypy 18 (baseline 15; +3 in Group 5 files item_actions.py:89, circulation_bridge.py:244 — cleared by Group 5).
**Files Modified**: circulation/{models,schemas,router,service}.py, application/{inventory_items,inventory,item_details}.py, infrastructure/{repository,ledger,locations_acl}.py, core/authorization_matrix.py, tests/test_item_location.py (new), tests/test_inventory_location.py (deleted), test_authorization_matrix.py, test_item_details.py
**Notes**: find_personal_inventory_live_location_id already removed (Group 5 switches bridge to find_item_live_location_id). Item-creating test files NOT in Group 6's list, assigned to Group 6 by main agent: test_public_term.py, test_organizer_page.py, test_group_soft_delete_keep_live.py, test_moderation.py, test_text_moderation_product.py.

### Standards Reading Log — Group 4
**From Implementation Plan**: backend/models.md, backend/security.md, backend/queries.md, global/validation.md, global/minimal-implementation.md, testing/backend-testing.md
**From INDEX.md**: backend/api.md, global/error-handling.md
**Discovered During Execution**: app/core/errors.py

## 2026-11-03T19:31:13Z - Group 11 Complete (wave 4)

**Steps**: 11.1 through 11.5 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
**Tests**: FirstTermStepperOrganizer + TermEditForm 29 passed; AppPage 101 passed / 12 failed (exactly the pre-existing HEAD failures; add-group '+' test rewritten and passing); ItemDetailPage 56/56; cross-check 127 passed. Typecheck clean except 4 pre-existing ThreadPage TS6133.
**Files Modified**: features/terms/termDraft.ts (new), features/terms/hooks/useFirstTermStepper.ts (new), AppDataContext.tsx (termEdit, firstTermDraft, closeStepper, closeStepperForPlace), AppModals.tsx, FirstTermStepperOrganizer.tsx, TermEditForm.tsx (+ Anuluj), TermEditView.tsx (leaving ref), tests: FirstTermStepperOrganizer, TermEditForm, AppPage, ItemDetailPage
**Notes**: Reported probable stale re-seed bug in EventEditView/ItemEditView (clear slice then navigate; seed effect may re-run) → follow-up fix dispatched in wave 5 as "Group 11b". Panel-level useNavigationState consumes state after first commit — pickers mounting late would miss picks (none today). Suggested standard: 'leaving' ref guard for AppDataContext drafts cleared before navigation.

### Standards Reading Log — Group 11
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, testing/frontend-testing.md
**From INDEX.md**: global/minimal-implementation.md, global/commenting.md

## 2026-11-03T19:31:13Z - Wave 4 resolved (Groups 4, 11)

## 2026-11-03T19:34:20Z - Group 11b (follow-up fix) Complete (wave 5)

**Scope**: stale draft re-seed after save/cancel in EventEditView and ItemEditView (found by Group 11); added by main agent, not in original plan.
**Standards Applied**: frontend/components.md, testing/frontend-testing.md, global/minimal-implementation.md, global/commenting.md
**Tests**: reproduced first (4 failing), after fix 81 passed (EventEditView 2 new, ItemEditView 5, TermEditForm 18, ItemDetailPage 56); typecheck only 4 pre-existing ThreadPage errors; eslint clean.
**Files Modified**: features/items/ItemEditView.tsx, features/events/EventEditView.tsx, test/ItemEditView.test.tsx, test/EventEditView.test.tsx (new)
**Notes**: Suggested standard: test stand-ins clearing AppDataContext before navigation should flush the clear synchronously (flushSync) to expose re-seed bugs hidden by jsdom's synchronous mock router.

## 2026-11-03T19:52:24Z - Group 5 Complete (wave 5)

**Steps**: 5.1 through 5.8 completed
**Standards Applied**:
- From plan: backend/models.md, backend/security.md, backend/queries.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: global/commenting.md
**Tests**: 102 passed (test_item_actions, test_personal_pickup, test_item_visibility, test_item_location, test_term_item_listings); test_item_details passes; mypy 15 (baseline restored). Wider: 428 passed / 125 failed — all item-create 400 missing location_id (Group 6).
**Files Modified**: groups/schemas.py, groups/application/{item_actions,reservation_context,term_item_listings}.py, groups/infrastructure/{circulation_bridge,locations_acl}.py, tests: test_personal_pickup, test_item_actions, test_item_location, test_term_item_listings, test_item_visibility, test_event_item_reservations (_listed_items), test_term_item_listings_router (_register_personal_item)
**Notes**: Privacy test asserts no "Sekretna"/"00-950"/place id in non-owner /actions, /details, GET /api/inventory-items/{id}. Listing guard: DRAFT→first listing only. Group 6 scope extended by main agent with: test_organizer_page, test_organizer_page_queries, test_owner_items_page, test_public_term, test_event_page, test_party_profile (+ earlier: test_group_soft_delete_keep_live, test_moderation, test_text_moderation_product).

### Standards Reading Log — Group 5
**From Implementation Plan**: backend/models.md, backend/security.md, backend/queries.md, global/error-handling.md, testing/backend-testing.md
**From INDEX.md**: global/commenting.md

## 2026-11-03T19:52:24Z - Wave 5 resolved (Groups 5, 11b)

## 2026-11-03T20:30:31Z - Group 6 Complete (wave 6)

**Steps**: 6.1 through 6.4 completed
**Standards Applied**: testing/backend-testing.md, global/minimal-implementation.md; read backend/security.md (Vary analysis)
**Tests**: FULL backend suite 1173 passed, 0 failed (11m29s); mypy 15 (baseline); ruff clean on touched lines.
**Files Modified**: tests/test_location_helpers.py (new) + 19 test files (location_id via create_location); test_term_item_listings_router key set (+location_id); test_reserved_listings Vary assertion ignores GZip-added Accept-Encoding (payload >1000 B now).
**Notes**: No app code changed, no app bug found. Scope-extension files fixed transitively through shared helpers. Suggested standard: exact Vary assertions ignore GZip's size-dependent Accept-Encoding token.

## 2026-11-03T20:30:31Z - Wave 6 resolved (Group 6) — backend complete

## 2026-11-03T20:35:44Z - Group 13 Complete (wave 7)

**Steps**: 13.1 through 13.6 completed
**Standards Applied**: docs updates only (backend/models.md, backend/migrations.md edits as planned)
**Removal audit**: all 14 greps clean in src/ (inventories.location_id only in migration/migration-test docstrings — expected)
**Files Modified**: .maister/docs/project/architecture.md (Locations rewrite, Item location, picker & drafts, 0078–0080 runbook), .maister/docs/standards/backend/models.md (Locality string-PK carve-out, loader-backed relationship), .maister/docs/standards/backend/migrations.md (fixture/unnest/TRUNCATE precedent), .maister/docs/INDEX.md
**Notes**: Other implementer-suggested standards deliberately NOT added — to be proposed to user. Owner follow-up: confirm TERYT reuse terms.

## 2026-11-03T20:35:44Z - Wave 7 resolved (Group 13)

## 2026-11-03T21:12:45Z - Group 14 Complete (wave 8)

**Steps**: 14.1 through 14.4 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md; INDEX: frontend/components.md (ssr initialToken)
**Gaps → tests added (3)**: full personal SWAP clears both items' location → DRAFT → relist 409 → 200 (test_item_location.py); ssrSafety loaded item page with owner location card for cookie session; ItemCreateView cancelled (null) /places/new pick keeps resumed draft's place. Frontend-type ↔ backend key-set contract verified by hand (all 7 shapes match).
**Tests**: backend feature files 282 passed; mypy 15 (baseline); ruff: 0 findings introduced (46 pre-existing repo-wide). Frontend feature + ssr 162 passed; typecheck only 4 pre-existing ThreadPage TS6133; lint 14 errors all in untouched files (pre-existing). Full vitest: 1498 tests, 1477 passed, 21 failed — 0 caused by this feature (13 known AppPage/TermPage + 8 also failing on clean HEAD: PublicLayout 3, LayoutRenderer 1, PendingActionsHost 1, foundation 1, extension-points 2).
**Files Modified**: tests/test_item_location.py, src/test/ssrSafety.test.tsx, src/test/ItemCreateView.test.tsx

## 2026-11-03T21:12:45Z - Implementation Complete

**Total Steps**: 99 completed (+ follow-up Group 11b)
**Total Standards**: ~20 standards files applied across groups (see per-group logs)
**Test Suite**: backend FULL suite passed (1173/1173 after Group 6; Group 14 only added tests, feature files 282/282 re-run); frontend full vitest 1477/1498 — 21 failures all pre-existing on HEAD (none from this feature). Recorded as: backend passed, frontend passed-with-preexisting-failures.
**Notes**: No commits made (user preference). Owner follow-up: confirm TERYT reuse terms. Standards suggestions collected for user approval.

## 2026-11-04T07:44:22Z - Verification fixes applied (Phase 11, cycle 1)

User chose: fix warnings 1–5 + "Brak wyników" (docs trim skipped).
- W1 picks lost on late-mounting hosts → useNavigationState(isAddressed?) predicate; useFirstTermStepper reads only FIRST_TERM_PICKER state (+test late-mounting picker).
- W2 LocalityCombobox stale active → reset on results change, guarded Enter (+test).
- W3 draft with deleted place → liveLocationId helper used in ItemCreateView + ItemEditForm (+2 tests).
- W4 explicit openFirstTermStepper on context; HomeView CTA uses it; raw setModal passed through.
- W5 removed SEED_CEILING_SECONDS assertion in test_localities_migration.py.
- Info: "Brak wyników" persistent role=status region (+test); empty folded query returns no results without querying (+2 parametrized cases).
**Tests**: backend 38 passed (localities/migration/locations), mypy 15; frontend related suites 261 passed / 12 failed (pre-existing AppPage), typecheck only 4 pre-existing ThreadPage errors, eslint 0 errors.

## 2026-11-04T08:49:36Z - E2E (Phase 12) + post-E2E fix

**E2E**: 14/14 scenarios pass on fresh servers; dev DB migrated 0077→0080 (user-authorized, no backup); 0079 seeded in 1.66 s. Visual fidelity ✓4 / ⚠3 / ✗0.
**Fix**: blank photo preview after Anuluj on /places/new — usePhotoPreviews creates object URLs inside the effect (state), revokes own URLs; Remove matches by File. Regression test via React <Activity> hide/show. ItemCreateView + ssrSafety 35 passed; typecheck only 4 pre-existing; eslint clean.
**Follow-up noted (not fixed, pre-existing pattern)**: EventForm.tsx:239 BannerField uses the same useMemo createObjectURL + effect revoke pattern — event banner preview may blank after a /places/new round trip.
**Follow-up fixed (2026-11-04T08:54:50Z)**: EventForm BannerField → useBannerPreview (URL created in effect, state-held, own-URL revoke, file-identity guard). Regression test in EventEditView.test.tsx (Activity hide/show). EventEditView + ssrSafety 14/14; typecheck only 4 pre-existing; eslint clean.
