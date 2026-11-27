# Work Log

## 2026-11-26T14:34:45Z - Implementation Started

**Total Steps**: 110
**Task Groups**: 1 Database 0109; 2 Ledger contract; 3 Pricing/config/item-value; 4 Purchases HOLD/SALE/RELEASE; 5 Listing for POINTS; 6 Take/confirm/cancel; 7 Read models & R8; 8 FE types ripple; 9 Item create stepper; 10 Item edit; 11 Cards/search/My Items; 12 Item page & reservation sheet; 13 Admin config; 14 Account points; 15 Test review; 16 Docs & full suites
**Mode**: parallel waves (sequential: false). TaskCreate/TaskList unavailable in this session — plan checkboxes are the sole tracker.
**Planned waves**: W1 {1, 8}; then backend 2 → 3 (shared points/schemas.py) → 4 → 5 → 6 → 7 alongside frontend {9, 11, 12, 13, 14} → 10.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-26T14:44:19Z - Group 1 Complete (wave 1)

**Steps**: 1.0–1.8 completed
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md, testing/backend-testing.md
- From INDEX.md: global/commenting.md, global/minimal-implementation.md
- Discovered: none
**Tests**: 9 passed (test_points_offers_migration.py, test_points_migration.py); ruff clean, mypy clean on touched files
**Files Modified**: alembic/versions/0109_points_offers.py (new), app/points/models.py, app/groups/models.py, app/inventory/models.py, app/inventory/infrastructure/ledger.py, app/inventory/domain/item_privacy.py, tests/test_points_offers_migration.py (new), tests/test_points_migration.py
**Notes**: revision id "0109", down_revision "0108". Known temporary break until Group 2: stage-1 lock_accounts ON CONFLICT (party_id) no longer matches a unique constraint (11 award tests fail). Use `uv run --no-sync` (TLS issue fetching hatchling).

## 2026-11-26T14:48:50Z - Group 8 Complete (wave 1)

**Steps**: 8.0–8.7 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/data-fetching.md, frontend/accessibility.md, testing/frontend-testing.md
- From INDEX.md: global/validation.md (parsePointsPrice like parseCapacity), global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 67 passed in 7 files; typecheck 0 errors; lint at baseline (10 errors/28 warnings, none new). Full vitest: 33 baseline failures + 6 expected failures in pointsConfigForm.test.ts / PointsConfigPage.test.tsx (fixtures carry the 4 new config keys; fixed by Group 13).
**Files Modified**: api/{groups,itemListingPreferences,inventories,reservations,itemActions,search,ownerItems,points}.ts, hooks/useItemPointsPreview.ts, utils/appHelpers.ts, ItemCard, ItemTileBadges, termLabels, ExchangeModeTabs, organizerHelpers, OfferModeChips, wantText, wantFormViewState, HomeView, ReservedItemsView; outside the declared list (for typecheck): MyItemsView.tsx, points/pointsLabels.ts, hooks/useMyItemsPage.ts; ~35 typed test fixtures.
**Notes**: Status PARTIAL accepted — the only failures belong to Group 13. Hand-offs: Group 12 adds ItemTakeRequest.points_price in api/itemReservations.ts; Group 11 covers api/events.ts EventParticipantItem.points_price, useSearchUrlState OFFER_TYPES and ItemStatsBlock MODES; Group 14 reviews pointsLabels icons.

## 2026-11-26T14:52:05Z - Group 14 Complete (frontend wave)

**Steps**: 14.0–14.5 completed
**Standards Applied**: From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, testing/frontend-testing.md. From INDEX.md: none extra. Discovered: none.
**Tests**: 13 passed (AccountPointsView.test.tsx); eslint clean on touched files. Full typecheck temporarily red only from sibling in-progress files (Groups 9, 13).
**Files Modified**: features/points/{PointsTiles,AccountPointsView,pointsLabels,PointsHistoryRow}.tsx/.ts, test/AccountPointsView.test.tsx
**Notes**: three tiles only via the withHeld prop (AccountView entry tiles unchanged). Buyer SALE amount derived from held_amount. Deviation: rows keep the existing card style rather than plain divider lines.

## 2026-11-26T14:53:08Z - Group 13 Complete (frontend wave)

**Steps**: 13.0–13.5 completed
**Standards Applied**: From plan: global/validation.md, frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md. From INDEX.md: backend/models.md (Decimal money/ratios → integer-hundredths client mirror). Discovered: none.
**Tests**: 53 passed (pointsConfigForm, PointsConfigPage, usePointsConfig) incl. the 6 that failed after Group 8; lint at baseline.
**Files Modified**: features/admin/{pointsConfigForm.ts,PointsConfigPage.tsx}, test/{pointsConfigForm.test.ts,PointsConfigPage.test.tsx}
**Notes**: RatioField/parseRatio; cap-multiple-of-step checked client-side too; live example hidden while price fields invalid; example shows suggestions 20/40/60. Standard suggestion to raise at the end: client mirrors of server Decimal maths use integer half-up arithmetic.

## 2026-11-26T14:55:10Z - Group 2 Complete (backend)

**Steps**: 2.0–2.9 completed
**Standards Applied**: From plan: backend/queries.md, global/error-handling.md, backend/models.md, testing/backend-testing.md. From INDEX.md: global/commenting.md, global/minimal-implementation.md. Discovered: global/coding-style.md (step 2.9, ruff SIM300).
**Tests**: 65 passed (ledger, me_api, awards, awards_contexts, term_attendance_points, rsvp_reactivation, module_boundaries); ruff/mypy clean on 8 files. The Group 1 ON CONFLICT break is fixed.
**Files Modified**: app/points/infrastructure/ledger.py, app/points/application/{awards,reads}.py, app/points/schemas.py, tests/test_points_{ledger,me_api,awards,awards_contexts}.py
**Notes**: PARTIAL — tests/test_term_attendance_close.py (outside scope) fails at import (emission_account_id → system_account_id, tuple keys); handed to Group 3 as an added file. Standard suggestion: balance-debiting postings check the balance under the lock_accounts lock inside post_points.

## 2026-11-26T14:56:47Z - Group 9 Complete (frontend wave)

**Steps**: 9.0–9.6 completed
**Standards Applied**: From plan: global/validation.md, frontend/accessibility.md, frontend/components.md, frontend/data-fetching.md, testing/frontend-testing.md. From INDEX.md: global/minimal-implementation.md, global/commenting.md. Discovered: none.
**Tests**: 34 passed (PointsPriceStepper 5, ItemCreateView 29); typecheck 0; lint at baseline.
**Files Modified**: components/shared/PointsPriceStepper.tsx (new), features/items/ItemCreateView.tsx, hooks/useCreateItem.ts, test/PointsPriceStepper.test.tsx (new), test/ItemCreateView.test.tsx
**Notes**: useCreateItem returns {createItem, createdItemId}; POINTS = draft → photos → PUT; retry repeats only the PUT. Deviations: ink text on orange (contrast); the mode group sits after Lokalizacja (field order pinned by an existing test). Residual risks: LocationPicker not disabled after a failed PUT; leaving and returning with the AppData draft could create a second item.

## 2026-11-26T14:57:04Z - Group 11 Complete (frontend wave)

**Steps**: 11.0–11.6 completed
**Standards Applied**: From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, testing/frontend-testing.md. From INDEX.md: frontend/css.md. Discovered: none.
**Tests**: 63 passed (ItemCard, ItemTileBadges, SearchView, MyItemsView); related suites green apart from baseline failures; lint at baseline. Typecheck errors at the time were only in sibling work in progress (Groups 9, 12).
**Files Modified**: ItemTileBadges (PointsPriceLabel), ItemCard, ParticipantItemsPreview, api/events.ts, events/eventViewModel.ts, search/{SearchResultCard,SearchFilters,useSearchUrlState}, OwnerItemsList, RecentItemsBlock, ItemStatsBlock, ProfileItems, wanted/{Match,Similar,Suggestion}Card, MyItemsView; tests ItemCard, ItemTileBadges, SearchView, MyItemsView, EventComponents/EventPage fixtures
**Notes**: M2 fixed (recipientConfirms). Deviation: the search keeps the toggle-off chip pattern instead of a „Wszystkie” chip. Follow-ups: ItemHeader can pass pointsPrice (Group 12); after a My Items switch to POINTS the price chip appears only after a reload (AppDataContext.setItemMode).

## 2026-11-26T14:59:07Z - Group 12 Complete (frontend wave)

**Steps**: 12.0–12.7 completed
**Standards Applied**: From plan: frontend/accessibility.md, frontend/components.md, frontend/data-fetching.md, testing/frontend-testing.md. From INDEX.md: global/minimal-implementation.md. Discovered: global/commenting.md.
**Tests**: 60 passed (itemActionsViewState, useItemTake, PointsReservationSheet (new), ssrSafety); typecheck 0; lint at baseline. The 2 „Wróć” failures in ItemDetailPage/OrganizerItemRoute match the known baseline (1 each).
**Files Modified**: features/product/{itemActionsViewState,useItemTake,PointsReservationSheet (new),PartyReservationActions}.ts(x), blocks/{ItemPickupActions,ItemHeader}.tsx, api/itemReservations.ts, tests (itemActionsViewState, useItemTake, PointsReservationSheet, ssrSafety). ItemStatus.tsx unchanged.
**Notes**: Deviations: a pickup-context choice before the sheet (the mockup shows none); the counterparty name is not inflected („wrócą do Ania”); a 403 shows the generic Polish access-denied text. Follow-ups for verification: ChooseContextSheet POINTS label; useReservationSettlement should invalidate [POINTS_KEY] for My Items / pending actions. Standard suggestion: POINTS orange actions use bg-orange text-ink.

## 2026-11-26T15:01:29Z - Group 3 Complete (backend)

**Steps**: 3.0–3.8 completed
**Standards Applied**: From plan: backend/security.md, backend/models.md, global/validation.md, global/error-handling.md, testing/backend-testing.md. From INDEX.md: backend/queries.md. Discovered: ownership via owner_inventory_id (inventory_items.py).
**Tests**: 206 passed (pricing, config_api, valuation, term_attendance_close, authorization_matrix, module_boundaries); ruff clean; mypy: 2 errors on untouched lines (within the baseline).
**Files Modified**: app/points/domain/pricing.py (new), app/points/application/pricing.py (new), config.py, valuation.py, schemas.py, router.py, service.py, infrastructure/{inventory_acl,users_acl}.py; tests test_points_pricing.py (new), test_points_config_api.py, test_points_valuation.py, test_term_attendance_close.py (Group 2 follow-up fix)
**Notes**: All acceptance cases are covered (s=40→20–60, s=60→30–90, cap 100, 55 rejected, 45→50). service re-exports bounds_for, offer_rules, PriceBounds; is_valid_price/clamp_price stay in the domain (to be re-exported if needed by Groups 4/5).

## 2026-11-26T15:03:22Z - Group 10 Complete (frontend)

**Steps**: 10.0–10.6 completed
**Standards Applied**: From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, global/validation.md, testing/frontend-testing.md. From INDEX.md: global/minimal-implementation.md. Discovered: api/problem.ts serverMessageOr reads `message` (step 10.1).
**Tests**: 13 passed (ItemEditView.test.tsx, 7 new); typecheck 0; lint at baseline.
**Files Modified**: utils/itemQuickAdd.ts, hooks/useItemDetail.ts (savePointsPrice), features/product/ItemEditForm.tsx, test/ItemEditView.test.tsx (ItemEditView.tsx unchanged)
**Notes**: Stored-value bounds while the category/condition are unchanged, preview bounds plus a forecast note after a change, the clamp mirrored client-side, PATCH before PUT. Frontend chain 8–14 complete. Standard suggestion: "shown verbatim" error fixtures use {message}.

## 2026-11-26T15:07:16Z - Group 4 Complete (backend)

**Steps**: 4.0–4.7 completed
**Standards Applied**: From plan: backend/queries.md, global/error-handling.md, backend/models.md, testing/backend-testing.md. From INDEX.md: backend/time.md. Discovered: none.
**Tests**: 7 new cases + 83 in the points regression set passed; ruff/mypy clean.
**Files Modified**: app/points/application/purchases.py (new), awards.py, service.py, tests/test_points_purchases_ledger.py (new)
**Notes**: lock_purchase (eligibility → family → sorted lock → pair limit incl. open holds → balance), post_hold, settle_sale (4 entries), release_hold, lock_release_accounts, lock_owner_accounts (added early so Group 5 can call it). _used_pair_slots moved to purchases.used_pair_slots to avoid an import cycle. award_exchange routes POINTS legs to settle_sale.

## 2026-11-26T15:20:13Z - Group 5 Complete (backend)

**Steps**: 5.0–5.9 completed
**Standards Applied**: From plan: backend/models.md, backend/security.md, global/validation.md, global/error-handling.md, backend/queries.md, testing/backend-testing.md. From INDEX.md: test_module_boundaries rule. Discovered: none.
**Tests**: 12 new passed (test_points_listing.py). Regression: 320+18 passed after updating test_item_visibility PREFERENCE_KEYS. 1 failure: test_owner_items_page::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath (location_name; untouched code; to be checked against the HEAD baseline in verification). ruff/mypy: only pre-existing findings.
**Files Modified**: tests/test_points_listing.py (new), groups/schemas.py, groups/application/term_item_listings.py, groups/infrastructure/{points_acl,product_bridge}.py, product/service.py, inventory/application/inventory_items.py, inventory/router.py; outside the declared list: groups/router/term_item_listings.py (passes body.points_price), tests/test_item_visibility.py (key set)
**Notes**: Lock order: owner accounts (only when becoming POINTS) → item → preference re-read (M4 409). update_item locks the item first and calls the injected on_revalued=clamp_points_price; it is wrapped in mapped_transaction_conflicts. Private _is_valid_price/_clamp_price copies in term_item_listings (service does not export the domain helpers) — simplification candidate for verification.

## 2026-11-26T16:44:59Z - Group 6 Complete (backend)

**Steps**: 6.0–6.9 completed
**Standards Applied**: From plan: backend/security.md, global/error-handling.md, backend/queries.md, backend/models.md, backend/time.md, testing/backend-testing.md. From INDEX.md: n/a. Discovered: none.
**Tests**: 13 new cases (test_points_purchase_flow.py, 3 stable runs) incl. parallel takes, confirm-vs-cancel race, two-buyer event delete; 388 passed in the regression set.
**Files Modified**: groups/{schemas.py, application/term_item_listings.py, domain/confirm_race_rules.py, infrastructure/points_acl.py}, inventory/{domain/reservation_rules.py, application/reservation_transitions.py, infrastructure/points_acl.py, infrastructure/repository.py}, events/service.py, tests/test_points_purchase_flow.py (new)
**Notes**: require_login_principal for POINTS take/confirm (mcp-only → 403); buyer-only confirm for GIFT+POINTS; hand-over queries IN (GIFT, POINTS); RELEASE first in _release; lock_release_accounts once on event delete; take/cancel/delete_event wrapped in mapped_transaction_conflicts; confirm locks items in id order for all types. Follow-up: move committed_client/_purge to conftest if a third file imports them.

## 2026-11-26T17:00:37Z - Group 7 Complete (backend)

**Steps**: 7.0–7.8 completed
**Standards Applied**: From plan: backend/security.md, backend/models.md, backend/queries.md, testing/backend-testing.md, module boundaries. From INDEX.md: global/minimal-implementation.md, global/commenting.md. Discovered: none.
**Tests**: 4 new (test_points_read_models.py) + the R8 probe rewrite; all key-set files green except the known test_owner_items_page nearest-term failure (location_name, untouched code); matcher suite 125 passed.
**Files Modified**: groups/{schemas, infrastructure/points_acl, application/item_actions, my_reservations, owner_items, term_item_listings}.py, search/{schemas, application/search}.py, pages/{schemas, application/owner_pages, organization_page}.py, events/{schemas, page}.py, wants/schemas.py; extras: groups/infrastructure/repository.py, wants/application/reads.py; 15 test files (key sets, counts, literal dicts)
**Notes**: R8 allowlist {points_price, held_points}; held_points party-only via batched hold_amounts. Standard suggestion: when a shared DTO gains a field, also grep tests for full-dict literal assertions.

## 2026-11-26T17:12:09Z - Group 15 Complete

**Steps**: 15.0–15.4 completed
**Standards Applied**: From plan: testing/backend-testing.md, testing/frontend-testing.md. From INDEX.md: global/error-handling.md. Discovered: none.
**Tests**: 4 new functions (9 cases): term/event-end prompt for POINTS, SALE counted once in pair slots, 40P01 → 409 on PATCH/PUT/confirm/cancel/delete_event, constant history queries with purchases. Feature run: backend 365 passed / 1 known failure (test_owner_items_page nearest-term location_name); frontend 16 files, 255 passed; typecheck 0. No bugs found.
**Files Modified**: tests/test_points_purchases_ledger.py, tests/test_points_me_api.py, tests/test_points_purchase_flow.py (append-only)
**Notes**: Test-helper consolidation candidates for conftest.py: _PgError/_deadlock (3 files), committed_client/_purge (2 files).

## 2026-11-26T17:35:25Z - Group 16 Complete

**Steps**: 16.0–16.6 completed
**Standards Applied**: From plan: backend/migrations.md, backend/security.md. From INDEX.md: global/commenting.md, global/minimal-implementation.md; CLAUDE.md Secrets rule. Discovered: none.
**Files Modified**: .maister/docs/project/architecture.md (points section + 0109 runbook), .maister/docs/standards/backend/security.md (login-token rule), .maister/docs/INDEX.md
**Notes**: No regressions; nothing fixed.

## 2026-11-26T17:35:25Z - Implementation Complete

**Total Steps**: 110 completed (16 groups, 0 skipped)
**Total Standards**: ~20 distinct standards applied (see per-group entries)
**Test Suite**: passed at baseline or better —
- backend pytest 1889 passed / 2 failed (the 2 known stale tests: test_owner_items_page nearest-term location_name, test_terms_circle_occurs_on_index_migration 0053 round trip); mypy 15 (=baseline); ruff 64 (baseline 65)
- matcher 125 passed, mypy 0, ruff clean
- frontend vitest 2169 passed / 32 failed (baseline 33, same files); typecheck 0; lint 10 errors / 28 warnings (=baseline)
**Open follow-ups for verification**: private _is_valid_price/_clamp_price copies in term_item_listings; useReservationSettlement not invalidating [POINTS_KEY] outside the item page; ChooseContextSheet POINTS label; My Items price chip after a mode switch shows only after reload; test-helper consolidation (_PgError, committed_client/_purge).

## 2026-11-26T18:14:03Z - Phase 11 fix loop (cycle 1)

**Backend + docs**: W2 clamp_price snaps to step; W1 domain helpers exported via service/points_acl, copies removed; W7 photo rule + cap only when becoming POINTS; W8 lock_reservations before accounts in cancel and confirm (reservation → accounts → items → preference), ordering test; W9 lock_owner_accounts documented as mutex; W10/W11 runbook step 2 + new 3a (log grep, open-holds and reconciliation SQL); I2 shared pg_error/deadlock in conftest; I3 docstring; I4 hold_credits_select; I5 can_confirm honours login-token rule; I8 renames/enum/TypeGuard. Tests: 467 passed; mypy 15; ruff 64.
**Frontend**: W1 shared clampPointsPrice (step snap) in appHelpers; W3 useReservationSettlement invalidates [POINTS_KEY] on confirm/cancel; W4 setItemMode stores points_price; W5 LocationPicker disabled + itemCreated kept in AppDataContext (retry-only-PUT survives remount); W6 clamped default price; I1 POINTS label in ChooseContextSheet; I7 alert only after edit; I8 pointsBlockedHint. Tests: 281 passed / 2 baseline (ItemDetailPage Wróć, PendingActionsHost GIFT); typecheck 0; lint 11 errors / 28 warnings (baseline 10 — the extra error is not in touched files; to be checked).
**Left as known**: I6 (product re-point skips photo rule), I9 (term_item_listings.py size).
**Standard suggestions collected**: lock reservation rows before point accounts when settling; one client helper per server pricing rule with parity rows; POINTS orange uses bg-orange text-ink; error fixtures use {message}; grep full-dict literals when a shared DTO gains a field.

## 2026-11-26T19:12:51Z - Phase 11 fix loop (cycle 2, minor items, no re-verification)

**Fixed**: INDEX.md lock-order phrase; G4 MyItemsView + PendingActionsHost invalidate [POINTS_KEY]; N1 _release docstring narrowed; N3 itemCreated cleared on a 404 retry; unused createdItemId removed; _take / set_item_listing_preference docstrings; awards.py module docstring; runbook R1 (30-day query), R2 (reload /admin/points), R3 (logs reset on recreate), R5 (delisting while reserved), duplicate up -d removed.
**Tests**: backend 43/44 then 44/44 ×3 combined and 6/6 standalone; frontend 99 passed / 1 baseline (PendingActionsHost GIFT owner-side); typecheck 0; lint 10 errors.
**Observed flake**: tests/test_points_purchase_flow.py::test_confirmAndCancelPoints_parallel_settleOrReleaseNeverBoth failed once in the fix agent's combined run, then passed 12/12. The failing assertion was not captured (status codes [200,409] vs SALE+RELEASE count). Recorded as a risk to watch.
**Left as known**: N2 (UX choice), I6, I9, M4.

## 2026-11-26T20:00:37Z - E2E follow-up fix

**M1**: PointsHistoryRow.tsx amount label `shrink-0` → `max-w-[45%]` so the buyer's „Zakup … zablokowane N → wydane” row no longer squeezes the title at 390 px. AccountPointsView tests 13 passed; eslint clean; web image rebuilt.

## 2026-11-26T20:08:17Z - Workflow finalized

All phases resolved (3 and 9 skipped: no reproducible defect). Artifact reconciliation: nothing missing. Nothing committed — awaiting user approval. Local stack left at migration 0109; pre-0109 dump in the session scratchpad.
