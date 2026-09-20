# Work Log

## 2026-09-20 - Implementation Started

**Total Steps**: 42
**Task Groups**: 7

**Wave plan** (computed from Dependencies + Files to Modify):
- Wave 1: Group 1 (tile locking), Group 2 (owner_party_id), Group 3 (cache refresh) — disjoint files, no deps
- Wave 2: Group 4 (term_id migration + threading) — conflicts with Group 2 (term_item_listings.py) and Group 3 (PanelDataContext.tsx) in wave 1, so deferred
- Wave 3: Group 5 (shared gating helper + cancel_transaction) — depends on Group 4
- Wave 4: Group 6 (balances extension + tile buttons) — depends on Group 5 and Group 1
- Wave 5: Group 7 (test review & gap analysis) — depends on all

**Note**: TaskCreate/TaskUpdate tools unavailable in this environment; implementation-plan.md checkboxes are the progress-tracking source of truth.

## 2026-09-20 - Wave 1 Complete (Groups 1, 2, 3)

**Group 1 (tile locking)**: SUCCESS. RzeczyView.tsx toggles get disabled/aria-disabled/opacity classes when locked; defense-in-depth guard added to setItemMode in PanelDataContext.tsx. 10 new frontend tests, all pass. Standards: frontend/accessibility.md, frontend/components.md, testing/frontend-testing.md.

**Group 2 (owner_party_id)**: SUCCESS. `existing.owner_party_id = profile.party_id` added to set_item_listing_preference's reused-row branch. 2 new backend tests (GIFT + SWAP re-listing scenarios), full test_term_item_listings.py re-run: 34 passed, no regressions. Standards: global/error-handling.md, global/validation.md, backend/models.md, testing/backend-testing.md.

**Group 3 (cache refresh)**: SUCCESS. `await load({ silent: true })` added to confirmPendingAction; route-watching effect added (transition-only, not first-mount, to avoid double-loading given PanelDataProvider already unmounts/remounts with PanelPage). 2 new frontend tests, pass. Standards: frontend/components.md, testing/frontend-testing.md.

**Cross-group regression found and fixed by main agent**: Group 3 flagged 4 pre-existing "PanelPage — inventory item edit/delete" tests failing after Group 1's change, because `PanelPage.test.tsx`'s `vi.mock("../api/inventories", ...)` factory replaced the whole module and didn't re-export the new `ACTIVE_LOCK_BALANCE_STATUSES` constant that `RzeczyView.tsx` now reads directly. Fixed by adding `ACTIVE_LOCK_BALANCE_STATUSES: ["RESERVED", "IN_TRANSIT"]` to that mock factory. Re-ran full `PanelPage.test.tsx` + `RzeczyViewCategory.test.tsx` + `KragGrupyPage.test.tsx`: **113 passed, 0 failed**. Backend `test_term_item_listings.py`: **34 passed**.

**Wave 1 status**: All 3 groups complete, checkboxes marked, no outstanding regressions. Proceeding to Wave 2 (Group 4).

## Standards Reading Log

### Group 1: Tile Mode-Toggle Locking
**From Implementation Plan**: frontend/accessibility.md, frontend/components.md, testing/frontend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: none

### Group 2: Re-listing After Transaction (owner_party_id)
**From Implementation Plan**: global/error-handling.md, global/validation.md, backend/models.md, testing/backend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: none

### Group 3: Panel Cache Refresh
**From Implementation Plan**: frontend/components.md, testing/frontend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: none

## 2026-09-20 - Wave 2 Complete (Group 4)

**Group 4 (term_id migration + threading)**: SUCCESS. New migration 0034_reservation_term_id.py: plain FK column (no ORM relationship), NOT NULL, with a 3-step backfill (preference-nearest, date-nearest fallback, delete-as-last-resort for unresolvable legacy rows — dev DB had 0 pre-existing reservation rows in practice, backfill logic exercised via dedicated test). term_id threaded through create_reservation/create_swap/create_lend_reservation; RETURN-type derives it server-side via new `_resolve_return_term_id` (most recent FULFILLED LEND on the item). Call sites updated: take_item_listing, propose_swap, accept_swap_proposal (reordered to reuse the proposer leg's term_id), pledge_fulfillment.py::fulfill_pledge. CreateSwapRequest.term_id added for schema consistency (route unreachable). Migration verified: upgrade/downgrade/upgrade round-trip clean.

Two files outside the original "Files to Modify" list needed mechanical, in-scope fixes: `groups/infrastructure/circulation_bridge.py` (the only path term_item_listings.py/pledge_fulfillment.py use to reach circulation — needed term_id passthrough) and `tests/test_term_item_listings.py` (one pre-existing raw POST /api/reservations LEND call needed term_id added).

Discovered standard: this app maps RequestValidationError to HTTP 400, not FastAPI's default 422 (app/core/errors.py::validation_error_handler) — validation tests adjusted accordingly.

6 new tests + full regression sweep across 5 backend test files: **97 passed, 0 failed**.

**Note for Group 5**: Reservation.term_id is now a plain non-null int attribute on the ORM object — confirm_transaction/cancel_transaction's shared gating helper CAN read reservation.term_id directly if useful, but per spec.md's Technical Approach, the route signatures (confirm-transaction/cancel-transaction request body) keep term_id as a caller-supplied field — do not change the API contract, this is an internal implementation detail only.

**Wave 2 status**: Complete, checkboxes marked. Proceeding to Wave 3 (Group 5).

## Standards Reading Log

### Group 4: term_id Migration and Creation-Site Threading
**From Implementation Plan**: backend/models.md, backend/migrations.md, global/error-handling.md, global/validation.md, testing/backend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: app/core/errors.py's RequestValidationError → HTTP 400 mapping (not FastAPI's default 422) — trigger: writing validation-rejection tests for missing term_id

## 2026-09-20 - Wave 3 Complete (Group 5)

**Group 5 (shared gating helper + cancel_transaction)**: SUCCESS. Extracted `_resolve_transaction_reservations_for_action(db, principal, reservation_id, term_id) -> list[Reservation]` from confirm_transaction's inline sequence (term-ended check, holder resolution, race-participant check, already-resolved guard, SWAP-pair resolution). confirm_transaction refactored to use it with no behavioral change. New `cancel_transaction` calls the same helper then `circulation_bridge.cancel_reservation` per resolved reservation. New route `POST /api/reservations/{reservation_id}/cancel-transaction`, response shape mirrors confirm's (`{reservation_id, status: CANCELLED|ALREADY_RESOLVED, already_resolved}`), same 409-on-race-loss mapping.

Glue files outside the original list, mechanically necessary: `groups/schemas.py` (CancelTransactionRequest/Response) and `groups/service.py` (facade export, per project's DDD-facade convention — memory: project_backend_ddd_refactor).

One pre-existing test asserted confirm_transaction's own source contained the term-ended check via `inspect.getsource` — updated to target the new helper's source instead (location check only, not a functional regression, since the extraction was the explicitly requested change).

New tests: 5 passed. confirm_transaction regression suite: 7 passed. Full test_term_item_listings.py: 39 passed.

**For Group 6**: cancelTransaction() can be built with the exact same request/response contract shape as confirmTransaction() — just a new endpoint name (`cancel-transaction`) and action verb, no new discriminator logic needed.

**Wave 3 status**: Complete, checkboxes marked. Proceeding to Wave 4 (Group 6).

## Standards Reading Log

### Group 5: Shared Gating Helper + cancel_transaction
**From Implementation Plan**: global/minimal-implementation.md, backend/api.md, global/error-handling.md, testing/backend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: none

## 2026-09-20 - Wave 4 Complete (Group 6)

**Group 6 (balances extension + tile fallback buttons)**: SUCCESS. Backend: `reservation_id: int | None` added to `InventoryBalanceResponse`, populated via new `get_active_reservation_id_for_item` — the plan named `circulation/application/inventory.py` as the file to modify, but that file only holds Inventory-level (not balance) use cases; the correct home is `inventory_items.py` alongside the existing `get_item_balance`. Built `list_active_reservations_for_item` in `repository.py` (mirrors existing `list_active_reservations_for_taker`) since no active-reservation-at-balance-level lookup pre-existed to reuse. Frontend: `getInventoryItemBalances` return shape changed to `Record<number, {status, reservationId}>`; new `cancelTransaction()` API client call; `RzeczyView.tsx` gained `termHasEnded` resolution and the two new "Odebrał"/"Anuluj wymianę" buttons per Mockup 4, gated on `locked && termHasEnded`, both refreshing panel data via Group 3's `load({ silent: true })` on success.

`ReservationResponse.term_id` added as **optional** (not required) on the frontend type to avoid an out-of-scope rewrite of `KragGrupyPage.test.tsx`'s pre-existing mocks (not in this group's file list) — real backend responses always include it.

Full-file sanity check (explicitly required given this group changes a shape Groups 1 and 3 already depend on): PanelPage.test.tsx + RzeczyViewCategory.test.tsx — **98 passed**; test_term_item_listings.py + test_circulation.py — **72 passed**. tsc clean. No repeat of the Wave-1-style shape/mock mismatch regression.

**Wave 4 status**: Complete, checkboxes marked. Proceeding to Wave 5 (Group 7, final).

## Standards Reading Log

### Group 6: Balances Extension + Tile Fallback Buttons
**From Implementation Plan**: backend/queries.md, frontend/accessibility.md, frontend/components.md, testing/backend-testing.md, testing/frontend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: none beyond the file-location correction noted above (inventory.py vs inventory_items.py)

## 2026-09-20 - Wave 5 Complete (Group 7 — final)

**Group 7 (test review & gap analysis)**: SUCCESS. Reviewed all 6 prior groups' work against spec.md's Success Criteria and gap analysis's flagged regression risks. Of 3 flagged high-risk areas, confirmed 2 already adequately covered (SWAP-pairing symmetry for cancel_transaction — Group 5's own test already proves both legs release together; owner_party_id vs sibling GIFT/SWAP flows — re-ran full test_term_item_listings.py with all 6 groups landed together, no interaction regressions) and 1 confirmed structurally safe by code inspection (route-focus reload cannot double-fire with confirmPendingAction's load() since confirmPendingAction never navigates, so the route effect's pathname dependency never changes during that flow).

Found and closed 2 genuine test gaps: (1) SWAP's two legs weren't tested for distinct, correct reservation_id per party on their own balance response — added `test_getItemBalance_swapBothLegs_eachHasOwnDistinctReservationId`; (2) the RETURN-type term_id derivation's actual failure path (LENT balance with no corresponding FULFILLED LEND row — data-corruption/API-misuse case) wasn't tested — added `test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict`, confirming it raises a typed 409 rather than silently producing a bad term_id.

**Final feature test totals**: backend 108 passed (test_circulation.py, test_term_item_listings.py, test_term_item_listings_router.py, test_term_end_scan.py, test_pledge_fulfillment.py), frontend 127 passed (RzeczyViewCategory.test.tsx, PanelPage.test.tsx, KragGrupyPage.test.tsx, useKragGrupy.test.ts). **235 total, 0 failed.**

No unresolved production-code findings.

## Standards Reading Log

### Group 7: Test Review & Gap Analysis
**From Implementation Plan**: testing/backend-testing.md, testing/frontend-testing.md
**From INDEX.md**: none additional found relevant
**Discovered During Execution**: none

## 2026-09-20 - Implementation Complete

**Total Steps**: 42 completed (7 groups, 5 waves)
**Total Standards Applied**: frontend/accessibility.md, frontend/components.md, testing/frontend-testing.md, global/error-handling.md, global/validation.md, backend/models.md, testing/backend-testing.md, backend/migrations.md, global/minimal-implementation.md, backend/api.md, backend/queries.md

**Full project test suite** (all tests, not just feature tests, per finalization requirement):
- Backend (`uv run pytest`, full suite): **281 passed, 0 failed** (125.81s)
- Frontend (`npx vitest run`, full suite): **248 passed, 4 failed** — all 4 failures are in `auth.test.tsx`, `extension-points.test.tsx`, `foundation.test.tsx`, none touched by this task (git status confirms no changes; files last modified 2026-09-10). Root cause: a hardcoded test JWT fixture whose `exp` claim has now passed relative to today's date (2026-09-20) — pre-existing test rot, unrelated to this task's changes. Not a regression introduced by this work.

**This task's feature tests**: 235 passed (108 backend + 127 frontend), 0 failed, across all 6 implementation groups plus Group 7's gap-closing tests.

**Cross-group regression caught and fixed during the run**: after Wave 1, `PanelPage.test.tsx`'s `vi.mock("../api/inventories")` factory needed `ACTIVE_LOCK_BALANCE_STATUSES` added (Group 1 introduced a direct import of this constant that the full-module mock didn't re-export). Fixed immediately, verified with a 113-test re-run before proceeding to Wave 2.

**Migration verified**: `0034_reservation_term_id.py` applies, rolls back, and re-applies cleanly against the local dev DB.

**Duration**: ~5 sequential waves (3 fully parallel in Wave 1), all groups SUCCESS on first attempt, no rollbacks or user-invoked recovery needed.
