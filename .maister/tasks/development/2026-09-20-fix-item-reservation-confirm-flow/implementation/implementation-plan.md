# Implementation Plan: Fix Item-Reservation Locking, Re-listing, Cache-Refresh, and Fallback Confirm/Cancel

## Overview
Total Steps: 42
Task Groups: 7
Expected Tests: 30-52

**Baseline note**: this task stacks on top of the uncommitted sibling task `2026-09-17-fix-giveaway-exchange`, which already modified `confirm_transaction` (`term_item_listings.py`), `PanelDataContext.tsx`, and `KragGrupyPage.tsx`. Every group below must read the *current* on-disk state of these files (not assume a clean baseline) before editing. `SpotkaniaView.tsx` and `PanelPage.test.tsx`'s guest-RSVP changes on the same branch are out of scope — do not touch or revert them.

**Sequencing rationale** (per spec's Implementation Guidance and gap analysis): bugs #1-#3 are independent, low-risk, and have no schema changes — implemented and tested first (Groups 1-3), then committed conceptually before bug #4's larger, dependency-chained surface (Groups 4-6: migration → creation-site threading → shared gating helper + cancel_transaction → balances extension → tile UI), with final Test Review & Gap Analysis (Group 7).

## Implementation Steps

### Task Group 1: Bug #1 — Tile Mode-Toggle Locking (frontend only)
**Dependencies:** None
**Files to Modify:**
- `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- `src/frontend/src/test/RzeczyViewCategory.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#component-rzeczy-tile-locked
  element: component:rzeczy-tile-locked
  locator: Mockup 3 (`RESERVED`/`IN_TRANSIT`, term NOT yet ended), lines 80-100; "Reusable Components > Buttons > Mode toggle pill" section, lines 153-154
  acceptance: the three `ITEM_MODES.map(...)` toggle buttons (`Wypożyczę`/`Oddam`/`Zamienię`) get `disabled` (native attribute) + `aria-disabled="true"` + `disabled:opacity-60 disabled:cursor-not-allowed` classes whenever `itemBalances[it.id]` is `RESERVED` or `IN_TRANSIT`; existing `lockBadgeLabel()` badge renders unchanged; no new buttons appear in this state (those are Group 6's responsibility, gated separately on term-end)
**Estimated Steps:** 5

- [x] 1.0 Complete tile mode-toggle locking
  - [x] 1.1 Write 3-5 focused tests in `RzeczyViewCategory.test.tsx` asserting the three toggle buttons are `disabled` and `aria-disabled="true"` when `itemBalances[it.id]` is `RESERVED`, the same when `IN_TRANSIT`, and enabled (no `disabled`/`aria-disabled`) when `AVAILABLE`/undefined
  - [x] 1.2 In `RzeczyView.tsx`, compute `const locked = ACTIVE_LOCK_BALANCE_STATUSES.includes(itemBalances[it.id] ?? "AVAILABLE")` per item inside the render loop (reuse the already-imported/exported `ACTIVE_LOCK_BALANCE_STATUSES` from `src/frontend/src/api/inventories.ts:87` — import it if not already imported in this file)
  - [x] 1.3 Apply `disabled={locked}` + `aria-disabled={locked}` + `disabled:opacity-60 disabled:cursor-not-allowed` to each of the three `ITEM_MODES.map(...)` buttons (`RzeczyView.tsx:214-229`)
  - [x] 1.4 Add a defense-in-depth early-return guard in `usePanelData()`'s `setItemMode` (PanelDataContext.tsx — plan's `panelDataStore.ts` reference verified to only re-export the hook) for the same locked condition, matching the UX-not-sole-guard note in spec.md's Bug #1 Technical Approach
  - [x] 1.5 Ensure locking tests pass
    - Run ONLY the tests written in 1.1
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- The 3-5 tests pass
- Toggle buttons are disabled + aria-disabled when locked, enabled when not
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 2: Bug #2 — Re-listing After Transaction (backend only)
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/tests/test_term_item_listings.py`
**Estimated Steps:** 4

- [x] 2.0 Complete owner_party_id reassignment fix
  - [x] 2.1 Write 2-4 focused tests in `test_term_item_listings.py` asserting: after a GIFT/SWAP `confirm_transaction` completes, the new owner calling `set_item_listing_preference` on the same item reassigns `owner_party_id` to their own party and the item then appears correctly filtered under their own listing preferences; also assert the original owner no longer sees it. Follow the existing `_register` → `_create_circle_and_term` → ... → `confirm_transaction` fixture chain already used for swap tests
  - [x] 2.2 In `set_item_listing_preference`'s `if existing is not None:` branch (`term_item_listings.py:115-117`), add `existing.owner_party_id = profile.party_id` alongside the existing `existing.mode = mode.value` assignment
  - [x] 2.3 Ensure re-listing tests pass
    - Run ONLY the tests written in 2.1
    - Do NOT run the entire backend test suite

**Acceptance Criteria:**
- The 2-4 tests pass
- `owner_party_id` is correctly reassigned on the update branch of `set_item_listing_preference`

---

### Task Group 3: Bug #3 — Panel Cache Refresh (frontend only)
**Dependencies:** None
**Files to Modify:**
- `src/frontend/src/pages/panel/PanelDataContext.tsx`
- `src/frontend/src/test/PanelPage.test.tsx`
**Estimated Steps:** 6

- [x] 3.0 Complete cache-refresh-after-confirm fix
  - [x] 3.1 Write 3-6 focused tests in `PanelPage.test.tsx` extending the pending-actions-modal test group: assert a second data-refresh call (e.g. `getInventoryItems`/list-content change) occurs after confirming via the global modal, and (if feasible within the existing render-with-providers/router test setup) assert a silent reload fires on navigation/mount to a `/panel/*` route
  - [x] 3.2 Read the *current* state of `confirmPendingAction` in `PanelDataContext.tsx` (already modified by the uncommitted sibling task `2026-09-17-fix-giveaway-exchange`) before editing
  - [x] 3.3 In `confirmPendingAction`, add `await load({ silent: true });` immediately after the successful `await confirmTransaction(...)` call, before `dismissPendingAction`, matching every sibling mutation handler's convention (e.g. `withdrawMyPledge`)
  - [x] 3.4 Import `useLocation` from `react-router-dom` in `PanelDataContext.tsx` and add an effect that watches the current pathname, calling `load({ silent: true })` when the pathname transitions onto a `/panel/*` route (mount at a panel route, and re-entry after navigating away and back) — implemented as transition-only (not first-mount) to avoid double-loading on top of the pre-existing mount effect; see work-log for rationale
  - [x] 3.5 Verify the fix does not touch `useKragGrupy`/`KragGrupyPage.tsx`'s own data ownership (explicitly out of scope per spec)
  - [x] 3.6 Ensure cache-refresh tests pass
    - Run ONLY the tests written in 3.1
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- The 3-6 tests pass
- `confirmPendingAction` reloads panel data silently after a successful confirmation
- Navigating back to any `/panel/*` route triggers a silent reload

---

### Task Group 4: Bug #4a — `term_id` Migration and Creation-Site Threading (backend)
**Dependencies:** None (independent of Groups 1-3; schema-only + threading, no shared-gating-helper dependency yet)
**Files to Modify:**
- `src/backend/alembic/versions/0034_reservation_term_id.py` (new)
- `src/backend/app/circulation/models.py`
- `src/backend/app/circulation/schemas.py`
- `src/backend/app/circulation/application/reservations.py`
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/app/groups/application/pledge_fulfillment.py`
- `src/frontend/src/pages/panel/PanelDataContext.tsx`
- `src/backend/app/circulation/router.py`
- `src/backend/tests/test_circulation.py`
**Estimated Steps:** 11

- [x] 4.0 Complete term_id persistence and creation-site threading
  - [x] 4.1 Write 4-7 focused tests in `test_circulation.py` (and/or `test_term_item_listings.py`) asserting: `create_reservation`/`create_lend_reservation` reject a missing `term_id` for non-RETURN types (validation error), a `RETURN`-type reservation correctly derives `term_id` server-side from the prior LEND leg's `term_id`, and the new migration backfills existing rows without error
  - [x] 4.2 Create Alembic migration `0034_reservation_term_id.py`: add `term_id: Mapped[int]` NOT NULL FK-id column to `Reservation`, plain FK column (`ForeignKey("terms.id", ...)`, no ORM relationship object) per `standards/backend/models.md`'s DDD cross-module-reference convention; sequential numeric prefix following `0030`-`0033`; reversible
  - [x] 4.3 In the same migration, write the backfill data migration (preference-nearest-Term, date-nearest fallback, delete-as-last-resort for unresolvable rows), then apply NOT NULL
  - [x] 4.4 Add `term_id: int` to `CreateReservationRequest`/`CreateSwapRequest` (`circulation/schemas.py`), optional specifically for `RETURN` type (server-derives, via model_validator), required for every other type
  - [x] 4.5 Thread `term_id` through `create_reservation`, `create_swap`, and `create_lend_reservation`
  - [x] 4.6 In `create_reservation`, for `reservation_type="RETURN"`, derive `term_id` server-side via `_resolve_return_term_id` (most recent FULFILLED LEND on the item)
  - [x] 4.7 Update call sites to pass `term_id`: `take_item_listing`, `propose_swap`, `accept_swap_proposal` (reordered to reuse proposer leg's term_id), `pledge_fulfillment.py::fulfill_pledge`
  - [x] 4.8 Verified `PanelDataContext.tsx::returnBorrowedItem` continues to call `POST /api/reservations` with `reservation_type="RETURN"` and no `term_id` — no frontend change needed, payload shape confirmed compatible
  - [x] 4.9 Added `term_id` as a required field on `CreateSwapRequest` — mechanical, route confirmed unreachable from any live frontend caller
  - [x] 4.10 Migration applied/rolled back/re-applied cleanly against local dev DB (`alembic upgrade head` / `downgrade -1` / `upgrade head`)
  - [x] 4.11 Ensure term_id threading tests pass
    - Ran the 6 new tests plus a regression sweep across test_circulation.py, test_term_item_listings.py, test_term_end_scan.py, test_term_item_listings_router.py, test_pledge_fulfillment.py: 97 passed

**Acceptance Criteria:**
- The 4-7 tests pass
- Every `Reservation` row created going forward has a non-null `term_id`; existing rows are backfilled
- The migration applies and rolls back cleanly
- `RETURN`-type reservations correctly derive `term_id` server-side; all other types require caller-supplied `term_id`

---

### Task Group 5: Bug #4b — Shared Gating Helper + `cancel_transaction` (backend)
**Dependencies:** Task Group 4 (needs `Reservation.term_id` column to exist)
**Files to Modify:**
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/app/groups/router/term_item_listings.py`
- `src/backend/tests/test_term_item_listings.py`
**Estimated Steps:** 7

- [x] 5.0 Complete shared gating helper and cancel_transaction use case
  - [x] 5.1 Write 5-8 focused tests in `test_term_item_listings.py` for `cancel_transaction`: happy path, SWAP paired-leg cancellation, already-resolved race, race-participant rejection, term-not-ended rejection
  - [x] 5.2 Read the *current* state of `confirm_transaction` before extracting
  - [x] 5.3 Extracted into `_resolve_transaction_reservations_for_action(db, principal, reservation_id, term_id)` returning `list[Reservation]`
  - [x] 5.4 `confirm_transaction` updated to call the shared helper — no behavioral regression (1 source-inspection test updated to target the new helper location, not a functional change)
  - [x] 5.5 Implemented `cancel_transaction(db, principal, reservation_id, term_id)`
  - [x] 5.6 Added `POST /api/reservations/{reservation_id}/cancel-transaction` route with `CancelTransactionRequest`/`CancelTransactionResponse` — response: `{"reservation_id": int, "status": "CANCELLED"|"ALREADY_RESOLVED", "already_resolved": bool}`, same shape/semantics as confirm's response, 409 on already-resolved
  - [x] 5.7 Ensure cancel_transaction tests pass
    - New tests: 5 passed. Regression check (confirm_transaction suite): 7 passed. Full file: 39 passed.

**Acceptance Criteria:**
- The 5-8 tests pass
- `cancel_transaction` correctly releases a single LEND/GIFT reservation, or both legs of a SWAP together, back to `AVAILABLE`
- `cancel_transaction` respects the same race/already-resolved rules as `confirm_transaction` (via the shared helper)
- `confirm_transaction`'s existing behavior is unchanged after the extraction (no regression)

---

### Task Group 6: Bug #4c — Balances Extension + Tile Fallback Buttons (backend + frontend)
**Dependencies:** Task Group 5 (needs `cancel_transaction` route to exist); Task Group 1 (builds on the same `RzeczyView.tsx` locked-tile row Group 1 modified)
**Files to Modify:**
- `src/backend/app/circulation/schemas.py`
- `src/backend/app/circulation/application/inventory.py`
- `src/frontend/src/api/inventories.ts`
- `src/frontend/src/api/reservations.ts`
- `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- `src/frontend/src/test/RzeczyViewCategory.test.tsx`
- `src/frontend/src/test/PanelPage.test.tsx`
- `src/backend/tests/test_term_item_listings.py`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#component-rzeczy-tile-locked-post-term
  element: component:rzeczy-tile-locked-post-term
  locator: Mockup 4 (`RESERVED`/`IN_TRANSIT`, term HAS ended), lines 102-144; "Reusable Components > Buttons" section, lines 148-156; "Interaction Details" lines 140-144
  acceptance: same disabled toggles + unchanged `lockBadgeLabel()` badge as Group 1, plus two new buttons rendered immediately after the badge inside the existing `<div className="mt-2 flex flex-wrap gap-1.5">` row, in this order: (1) "Odebrał" using the primary `bg-mint` pill style (`rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60`, same visual weight as "Zapisz"), (2) "Anuluj wymianę" using a tertiary pill with `text-danger`/`hover:bg-danger-soft` accent (`rounded-[9px]` base, explicitly NOT the bare ghost "Anuluj" classes at `RzeczyView.tsx:150`/`:196`); both buttons only render when `locked && termHasEnded`; both have full-word visible text labels (no icons); both sit in DOM/tab order immediately after the badge; before term-end (locked but not termHasEnded), only the badge shows (no new buttons) — matches Group 1's Mockup 3 state
**Estimated Steps:** 9

- [x] 6.0 Complete balances extension and tile fallback buttons
  - [x] 6.1 Wrote 4 backend tests for `reservation_id` on `InventoryBalanceResponse` (AVAILABLE/RESERVED/IN_TRANSIT/post-cancel)
  - [x] 6.2 Added `reservation_id: int | None` to `InventoryBalanceResponse` via new `get_active_reservation_id_for_item` (implemented in `inventory_items.py`, not `inventory.py` — plan's file reference was incorrect, see work-log)
  - [x] 6.3 Updated frontend `InventoryBalanceResponse`/`getInventoryItemBalances` to `Record<number, {status, reservationId}>`, updated `RzeczyView.tsx`'s `itemBalances`/`locked` usages
  - [x] 6.4 Added `cancelTransaction(reservationId, {term_id})` to `api/reservations.ts`, mirroring `confirmTransaction`
  - [x] 6.5 Added `termHasEnded(itemId)` in `RzeczyView.tsx`, bounded-batch-resolved
  - [x] 6.6 Rendered "Odebrał"/"Anuluj wymianę" buttons per mockup, gated `locked && termHasEnded`
  - [x] 6.7 Both actions call `load({ silent: true })` on success
  - [x] 6.8 Rewrote/extended `RzeczyViewCategory.test.tsx` (6 new tests) and `PanelPage.test.tsx` (1 full-flow test)
  - [x] 6.9 Ensure balances + tile-button tests pass
    - New tests: 4 backend + 7 frontend. Full-file sanity check: 98 frontend (PanelPage.test.tsx + RzeczyViewCategory.test.tsx) + 72 backend (test_term_item_listings.py + test_circulation.py) all pass. tsc clean, ruff clean (no new issues).

**Acceptance Criteria:**
- The 7-11 tests (6.1 + 6.8 combined) pass
- `reservation_id` is available on balances without a second round-trip
- On a locked tile, once the reservation's term has ended, "Odebrał" and "Anuluj wymianę" are visible and functional; before term end, only the existing lock badge shows
- `RzeczyViewCategory.test.tsx`'s rewritten assertions match the new locked-tile behavior in both pre- and post-term-end states
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 7: Test Review & Gap Analysis
**Dependencies:** All previous groups (1-6)
**Files to Modify:** `src/backend/tests/**/*.py`, `src/frontend/src/test/**/*.test.tsx` (append-only, as needed)

- [x] 7.0 Review and fill critical gaps
  - [x] 7.1 Reviewed tests from all previous groups
  - [x] 7.2 Analyzed the 3 flagged gaps: SWAP-pairing symmetry (already sufficiently covered by Group 5), owner_party_id vs sibling flows (no regression, re-verified with all 6 groups landed together), route-focus reload vs confirmPendingAction (structurally cannot double-fire — confirmPendingAction never navigates, so the route effect's pathname dependency never changes during that flow)
  - [x] 7.3 Added 2 new tests (of 10 allowed): SWAP dual-leg distinct reservation_id per party; RETURN-with-no-derivable-term_id raises BusinessConflictException (409) instead of silently producing a bad term_id
  - [x] 7.4 Ran feature-specific tests: backend 108 passed (test_circulation.py, test_term_item_listings.py, test_term_item_listings_router.py, test_term_end_scan.py, test_pledge_fulfillment.py), frontend 127 passed (RzeczyViewCategory.test.tsx, PanelPage.test.tsx, KragGrupyPage.test.tsx, useKragGrupy.test.ts) — **235 total, 0 failed**

**Acceptance Criteria:**
- All feature tests pass (~30-52 total)
- No more than 10 additional tests added in this group
- SWAP paired-leg cancel/confirm symmetry explicitly verified
- No regressions in the sibling task's already-modified `confirm_transaction`/`PanelDataContext.tsx`/`KragGrupyPage.tsx` behavior

---

## Execution Order

1. Task Group 1 — Bug #1 tile locking (5 steps)
2. Task Group 2 — Bug #2 owner_party_id (4 steps, parallel-safe with 1, 3)
3. Task Group 3 — Bug #3 cache refresh (6 steps, parallel-safe with 1, 2)
4. Task Group 4 — Bug #4a term_id migration + threading (11 steps, parallel-safe with 1-3; independent schema work)
5. Task Group 5 — Bug #4b shared gating helper + cancel_transaction (7 steps, depends on 4)
6. Task Group 6 — Bug #4c balances extension + tile buttons (9 steps, depends on 5 and 1)
7. Task Group 7 — Test Review & Gap Analysis (4 steps, depends on 1-6)

Groups 1-4 may be executed concurrently (touch disjoint files, no shared dependency). Group 5 must follow Group 4. Group 6 must follow both Group 5 (needs cancel-transaction route) and Group 1 (shares/extends the same `RzeczyView.tsx` locked-tile row and `itemBalances` shape). Group 7 follows everything.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/minimal-implementation.md` — the shared gating helper (Group 5) is justified by an existing, concrete second caller (`cancel_transaction`), not speculative
- `global/error-handling.md`, `global/validation.md` — applied throughout backend changes
- `backend/models.md` — `term_id` as a plain FK-id column, no ORM relationship, across the `circulation`↔`groups` boundary (Group 4)
- `backend/migrations.md` — migration `0034_reservation_term_id.py`, small and focused, reversible, sequential-numeric-prefix convention (Group 4)
- `backend/queries.md` — `reservation_id`/term-end resolution stays a bounded, single-batched lookup, no per-row N+1 (Group 6)
- `backend/api.md` — new `POST /api/reservations/{reservation_id}/cancel-transaction` follows the existing verb-suffix sibling-route convention (Group 5)
- `frontend/accessibility.md` — `disabled` + `aria-disabled` on toggles (Group 1); full-word text labels, no icon-only buttons, tab order immediately after badge (Group 6)
- `frontend/components.md` — new tile-local state (`termHasEnded`, extended `itemBalances` shape) stays local to `RzeczyView.tsx` (Group 6)
- `testing/backend-testing.md` / `testing/frontend-testing.md` — 2-8 tests per group, existing fixture-chain and `renderWithProviders`/`vi.mock` conventions reused throughout

## Notes

- Test-Driven: Each group starts with 2-8 tests (Group 6 slightly wider at 7-11 combined given its two sub-features)
- Run Incrementally: Only new tests after each group, not the entire suite
- Mark Progress: Check off steps as completed
- Reuse First: Prioritize existing components from spec (`ACTIVE_LOCK_BALANCE_STATUSES`, `confirm_race_rules._require_race_participant`, `circulation_bridge.cancel_reservation`, `PanelDataContext`'s `load({ silent: true })` pattern, `KragGrupyPage.tsx`'s `currentTermHasOccurred()`/`confirmActionFor()` patterns)
- Baseline awareness: all groups touching `term_item_listings.py`, `PanelDataContext.tsx`, or `KragGrupyPage.tsx` must read current file state first (sibling task already modified these)
- Out of scope (do not touch): dispute/moderation workflow, auto-expiry of unconfirmed reservations, `SpotkaniaView.tsx`/`PanelPage.test.tsx`'s guest-RSVP changes, a shared cross-page invalidation/event-emitter primitive, deleting the unreachable `POST /api/reservations/swap` route
