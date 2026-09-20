# Implementation Plan: Fix broken giveaway (oddanie) / exchange (zamiana) mechanism

## Overview
Total Steps: 39
Task Groups: 6
Expected Tests: 27-40

## Implementation Steps

### Task Group 1: Backend — taker-side "my active reservations" query chain (repository → application → bridge → service)
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/circulation/infrastructure/repository.py`
- `src/backend/app/circulation/application/reservations.py`
- `src/backend/app/groups/infrastructure/circulation_bridge.py`
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/app/groups/router/term_item_listings.py`
- `src/backend/tests/test_term_item_listings.py`

**Estimated Steps:** 9

- [x] 1.0 Complete the cross-layer taker-side query chain
  - [x] 1.1 Write 5 focused tests in `test_term_item_listings.py` for `list_my_active_taken_term_item_listings`:
    - returns a listing for a GIFT/LEND reservation the caller holds as taker (status PENDING or CONFIRMED)
    - excludes reservations not held by the calling party (scoped correctly)
    - excludes reservations against listers not eligible for the term (mirrors `_list_eligible_lister_party_ids` scoping)
    - still resolves the row when `term.occurs_on < now()` (the post-term-end case that `list_browsable_term_item_listings` structurally cannot serve — this is the behavior the TDD red gate in Group 5 depends on)
    - raises/denies when the calling party itself is not eligible for the term (`_require_term_eligibility` gate on the caller)
  - [x] 1.2 In `app/circulation/infrastructure/repository.py`, add `list_active_reservations_for_taker(db: AsyncSession, account_user_id: int) -> list[Reservation]` (status in PENDING/CONFIRMED, `reserved_by_user_id == account_user_id`), sibling to existing `list_reservations_for_item` (:151); parameterized query, no N+1 (single select).
  - [x] 1.3 In `app/circulation/application/reservations.py`, add a thin service wrapper `list_active_reservations_for_taker(db, account_user_id)` calling the new repository function, alongside existing `list_reservations`/`get_reservation` (:118-125).
  - [x] 1.4 In `app/groups/infrastructure/circulation_bridge.py`, add pass-through `list_active_reservations_for_taker(db, account_user_id)` (same shape as existing `list_reservations`/`get_reservation` wrappers, :109-153) — the sole cross-context entry point per the DDD bridge convention.
  - [x] 1.5 In `app/groups/application/term_item_listings.py`, add `list_my_active_taken_term_item_listings(db, term_id, party_id)`: call `_require_term_eligibility(db, term_id, term.circle_group_id, party_id)` for the caller first; resolve the caller's `account_user_id`; call the new bridge function; keep only reservations whose item has an `ItemListingPreference` (via `repository.get_item_listing_preference`) owned by a party in `_list_eligible_lister_party_ids(db, term_id)`; render through the existing `_build_listing_views` (:218-253) for response-shape consistency — no new DTO.
  - [x] 1.6 In `app/groups/router/term_item_listings.py`, add `GET /api/term-item-listings/mine-as-taker?term_id=...` returning `list[BrowseTermItemListingResponse]`, declared alongside `mine`/`browse` (:63-77), same `ReadPrincipal`/`require_any("READ", "mcp:read")` dependency, same literal-segment-before-`{item_id}` ordering caveat already documented there.
  - [x] 1.7 In `src/frontend/src/api/termItemListings.ts`, add `getMyTakenTermItemListings(termId: number): Promise<BrowseTermItemListingResponse[]>` thin client, same shape as `getMyTermItemListings`/`getBrowseTermItemListings` (:37-43).
  - [x] 1.8 Confirm no regression to `_is_item_available`/`list_browsable_term_item_listings` semantics — the new query is strictly additive, does not modify any existing function's filter behavior.
  - [x] 1.9 Ensure the 5 new backend tests pass
    - Run only the 5 tests written in 1.1 (`uv run pytest -k <new test names>` in `src/backend`)
    - Do NOT run the entire backend suite

  **Note**: Also required (not in original file list) exporting the new functions through `app/circulation/service.py` and `app/groups/service.py` facades — this project's DDD convention requires all cross-layer calls to go through `service.py` facades, so the bridge/router calls would `AttributeError` at runtime without these exports.

**Acceptance Criteria:**
- The 5 tests pass
- `GET /api/term-item-listings/mine-as-taker?term_id=...` returns the caller's own active (PENDING/CONFIRMED) taken reservations regardless of item AVAILABLE/RESERVED balance status or whether `term.occurs_on` is in the past
- `test_browseListing_termOccursOnInPast_becomesUnbrowsable` (existing) is untouched and still passes
- `getMyTakenTermItemListings` frontend client exists with the same call shape as its siblings

---

### Task Group 2: Backend — SWAP-mode enforcement + circulation-ledger audit tests
**Dependencies:** None (independent of Group 1's query chain; touches `_require_own_available_personal_item`/`propose_swap` and adds separate ledger tests)
**Files to Modify:**
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/tests/test_term_item_listings.py`

**Estimated Steps:** 6

- [x] 2.0 Complete SWAP-mode enforcement and ledger audit coverage
  - [x] 2.1 Write 6 focused tests in `test_term_item_listings.py` — done
  - [x] 2.2 SWAP-mode check added in `propose_swap` after `_require_own_available_personal_item`
  - [x] 2.3 Already-fixed bug lines preserved untouched (confirmed via git diff)
  - [x] 2.4 Ledger audit test helper `_latest_ledger_entries_for_giver` written
  - [x] 2.5 File size 1402 lines — judged split unnecessary, flagged as follow-up consideration
  - [x] 2.6 6 new tests pass + full file regression run (32/32)

**Acceptance Criteria:**
- The 6 tests pass
- A non-"zamienię"-tagged item cannot be offered in a swap proposal (backend-enforced, independent of frontend filtering)
- `CirculationTransaction`/`CirculationEntry` rows are asserted for both GIFT and SWAP-leg fulfillment paths
- The two pre-existing uncommitted bug fixes (swap ownership inversion, UTC/local datetime) are verifiably unchanged in the diff

---

### Task Group 3: Frontend — term-page confirm button wiring + term-end gating
**Dependencies:** Group 1 (needs `confirmTransaction`'s existing shape confirmed; does not need the new taker query — this group only touches the lister-visible "mine" confirm button and its endpoint, which already resolves via `myItemListings`)
**Files to Modify:**
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/hooks/useKragGrupy.ts`
- `src/frontend/src/test/PanelPage.test.tsx` (only if term-page-button coverage lives there; otherwise a term-page-specific test file if one exists — implementer's call, per spec's "2-8 focused tests")

**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:listing-row-confirm-button
  locator: "Mockup 1: Term-page listing row — confirm button wiring (Root Cause A)" section, BEFORE/AFTER comparison block
  acceptance: same button, same position, same label "Potwierdź odbiór" (zero layout change); button renders disabled with a `statusLine` hint (e.g. "dostępne po zakończeniu zajęć", reusing `kg-status-line`) when `term.occurs_on > now()`; enabled and calls `confirmTransaction(reservationId, { term_id })` — never `fulfillReservation` — once the term has occurred; `disabled` state is paired with a visible reason per accessibility standards, not silently disabled

**Estimated Steps:** 7

- [x] 3.0 Complete term-page confirm button rewiring and gating
  - [x] 3.1 4 focused tests written (3 page-level, 1 hook-level regression guard)
  - [x] 3.2 `confirmActionFor` gated on `currentTermHasOccurred()` + `TERM_GATE_STATUS_LINE`
  - [x] 3.3 `confirmListingReceipt(reservationId, termId)` now calls `confirmTransaction`
  - [x] 3.4 `handleConfirmListing` threads `currentTerm.id` through
  - [x] 3.5 `confirmPledgeReceipt` untouched (verified via grep)
  - [x] 3.6 `ListingRow` markup untouched, only VM values changed
  - [x] 3.7 21/21 tests pass (17 existing + 4 new) across the two affected test files

**Acceptance Criteria:**
- The 4 tests pass
- Term-page "Potwierdź odbiór" calls `confirmTransaction`, never `fulfillReservation`
- Button cannot fire before the term has occurred; disabled state carries a visible reason
- `confirmPledgeReceipt`/pledge-fulfillment flow is unchanged
- Implementation matches each `acceptance` criterion declared under Visual References above

---

### Task Group 4: Frontend — resolvePendingReservationId GIFT/LEND owner+taker branches (TDD green requirement)
**Dependencies:** Group 1 (requires `getMyTakenTermItemListings` client to exist)
**Files to Modify:**
- `src/frontend/src/pages/panel/PanelDataContext.tsx`
- `src/frontend/src/test/PanelPage.test.tsx`

**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:global-pending-actions-modal
  locator: "Mockup 3: GlobalPendingActionsModal — 'Potwierdź transakcję' now reachable for GIFT/LEND (Root Cause B)" section, BEFORE/AFTER comparison block
  acceptance: zero markup change to `GlobalPendingActionsModal`'s `TERM_CONFIRMATION_NEEDED` branch (:1357-1374); `resolvePendingReservationId` resolves a non-null reservation id for both the GIFT/LEND owner/lister and the GIFT/LEND taker post-term-end; clicking "Potwierdź" then calls `confirmPendingAction` → `confirmTransaction` with that resolved id, exactly as it already does for SWAP

**Estimated Steps:** 8

- [x] 4.0 Complete GIFT/LEND reservation-id resolution symmetry
  - [x] 4.1 4 tests written/updated (TDD-gate test fixed, owner-side, SWAP regression, null/"not found")
  - [x] 4.2 Taker-side now uses `getMyTakenTermItemListings(termId)`
  - [x] 4.3 Owner/lister loop gained GIFT/LEND `else` branch
  - [x] 4.4 `KragGrupyPage.tsx` merges via `effectiveBrowseListings` (additive)
  - [x] 4.5 Backend unaffected (frontend-only change)
  - [x] 4.6 `[EXPECTED TO FAIL until fixed]` prefix removed — TEST NOW GREEN, assertions unweakened
  - [x] 4.8 4 tests pass in isolation; 105/105 across all 3 affected files confirmed by orchestrator

**Acceptance Criteria:**
- The 4 tests pass, including the formerly-red TDD gate test now green with its prefix removed and assertions unweakened
- A GIFT/LEND owner and a GIFT/LEND taker can each resolve a working `reservation_id` post-term-end, from both the term page and the global pending-actions modal
- Existing SWAP paired-leg resolution is unchanged
- Implementation matches each `acceptance` criterion declared under Visual References above

---

### Task Group 5: Frontend — SWAP counter-offer item-mode filtering
**Dependencies:** Group 2 (backend enforcement should land first so the frontend filter has a matching source of truth to test against, though the two are independently implementable; sequencing here avoids a window where the frontend allows a selection the backend then rejects with a raw 409)
**Files to Modify:**
- `src/frontend/src/hooks/useKragGrupy.ts`
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`

**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:swap-propose-dialog
  locator: "Mockup 2: SwapProposeDialog — zamienię-filtered picker + empty state" section, State A and State B diagrams
  acceptance: `<select>` (`:339-350`) keeps its exact markup/props (`kg-select`, `aria-label="Twoja rzecz do zamiany"`); `availableItems` array it maps over contains only items whose `ItemListingPreference.mode === "SWAP"`; when the filtered list is empty, render an empty-state paragraph reusing the `kg-bring-sub` class with the message pattern "Nie masz żadnej rzeczy oznaczonej 'zamienię'..."; "Zaproponuj zamianę" button's existing `disabled={busy || offeredItemId === null}` condition is unchanged (already correct for empty selection)

**Estimated Steps:** 5

- [x] 5.0 Complete SWAP-mode filtering on the frontend picker
  - [x] 5.1 4 tests written (2 hook-level, 2 component-level)
  - [x] 5.2 New `mySwapAvailableItems` field added (see deviation note below) — `myAvailableItems` kept unfiltered for pledge-fulfillment reuse
  - [x] 5.3 `SwapProposeDialog` branches empty-state vs select+preview
  - [x] 5.4 `openSwapSelect`/"Zamień" trigger untouched
  - [x] 5.5 4/4 tests pass; 25/25 full-file run also confirmed

  **Deviation from literal plan wording (justified, documented by implementer)**: `myAvailableItems` is a SHARED array also used by the unrelated pledge-fulfillment "Z moich rzeczy" picker (untagged/GIFT/LEND items must remain selectable there). Filtering it in place would have broken pledge fulfillment. Implementer added a new, narrower `mySwapAvailableItems` field instead, leaving `myAvailableItems` untouched, and rewired only the two `SwapProposeDialog` call sites to it. This satisfies the acceptance criteria (which only reference "the picker's `availableItems`") without the plan's literal wording's side effect. Public view's inline `loadMyAvailableItems` (no such conflict) was filtered in place as originally planned.

**Acceptance Criteria:**
- The 4 tests pass
- SWAP counter-offer picker shows only "zamienię"-tagged items, with a clear empty-state when none exist
- `aria-label="Twoja rzecz do zamiany"` preserved unchanged
- Implementation matches each `acceptance` criterion declared under Visual References above

---

### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Groups 1-5 (all previous groups)
**Files to Modify:** `src/backend/tests/**/*.py`, `src/frontend/src/test/**/*.test.tsx` (append-only, as gaps are found)

**Estimated Steps:** 4

- [x] 6.0 Review and fill critical gaps
  - [x] 6.1 Reviewed actual current source + tests from Groups 1-5 for cross-surface gaps
  - [x] 6.2 Confirmed scope boundary — no pledge/SpotkaniaView/concurrency tests added
  - [x] 6.3 4 new strategic tests added (within 8-test budget) + fixed a genuine regression found during full-suite gate (5 pre-existing tests in 2 other files needed SWAP-tag setup after Group 2's new enforcement)
  - [x] 6.4 Full backend suite: 261/261 passed. Full frontend suite: 236/240 passed — 4 pre-existing failures, all in files untouched by this task's entire diff (auth.test.tsx, extension-points.test.tsx, foundation.test.tsx), confirmed via `git status` cross-check by orchestrator

**Acceptance Criteria:**
- All feature tests pass (~31-39 total)
- No more than 8 additional tests added in this group
- Full backend and frontend suites pass with zero regressions
- The two already-fixed backend bugs (SWAP ownership inversion, UTC/local datetime) remain intact in the final diff
- `SpotkaniaView.tsx`/its `PanelPage.test.tsx` guest-RSVP additions remain untouched in the final diff

---

## Execution Order

1. Group 1 — Backend taker-side query chain (9 steps) — no dependencies, start immediately
2. Group 2 — Backend SWAP-mode enforcement + ledger tests (6 steps) — no dependencies, can run in parallel with Group 1
3. Group 3 — Frontend term-page confirm button wiring (7 steps, depends on Group 1's `confirmTransaction` shape being stable — can start once Group 1's step 1.7 client lands, or in parallel if the API contract is already known from spec.md)
4. Group 4 — Frontend resolvePendingReservationId GIFT/LEND branches / TDD green (8 steps, depends on Group 1 — needs `getMyTakenTermItemListings`)
5. Group 5 — Frontend SWAP picker filtering (5 steps, depends on Group 2 — backend enforcement should land first)
6. Group 6 — Test Review & Gap Analysis (4 steps, depends on Groups 1-5)

Groups 1 and 2 are independent and may run concurrently (different function areas within the same file, `term_item_listings.py` — coordinate on non-overlapping line ranges: Group 1 adds `list_my_active_taken_term_item_listings`, Group 2 modifies `propose_swap`). Groups 3 and 4 both touch `KragGrupyPage.tsx`/`PanelDataContext.tsx`-adjacent flows but different functions (`confirmActionFor`/`handleConfirmListing` vs `resolvePendingReservationId`) — sequence them if a single implementer session, or serialize the shared `KragGrupyPage.tsx` edits if parallelized.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/minimal-implementation.md` — no speculative abstractions; the new query is scoped exactly to "my active reservations as taker for a term"
- `global/commenting.md`, `global/coding-style.md` — always applicable
- `backend/models.md`, `backend/queries.md` — new `list_active_reservations_for_taker` follows existing N+1-avoidance and parameterized-query conventions
- `backend/security.md` — new endpoint uses the same `ReadPrincipal`/`require_any("READ", "mcp:read")` dependency as its `mine`/`browse` siblings
- `backend/api.md` — new endpoint chosen over overloading `browse` with a flag, per resource-clarity guidance
- `frontend/components.md` — `ListingRow`, `SwapProposeDialog`, `GlobalPendingActionsModal` markup reused unchanged
- `frontend/accessibility.md` — new disabled confirm-button state pairs with a visible `statusLine` reason

## Notes

- Test-Driven: Each group starts with 2-8 tests (Group 1: 5, Group 2: 6, Group 3: 4, Group 4: 4, Group 5: 4, Group 6: up to 8 additional)
- Run Incrementally: Only new tests after each group; the one exception is Group 6.4's final full-suite run, which is an explicit one-time gate per spec.md's Success Criteria, not a per-group pattern
- Mark Progress: Check off steps as completed
- Reuse First: `confirmTransaction`, `_build_listing_views`, `ListingRow`, `SwapProposeDialog`, `GlobalPendingActionsModal`, `itemListingPreferences.ts` are all reused unchanged per spec.md's Reusable Components section
- Preserve, do not revert: the two already-fixed uncommitted backend bugs (SWAP `reserved_by_user_id` inversion, `utcnow()`→`now()` term-end gating) must survive every group's diff
- Out of scope: `SpotkaniaView.tsx`, its `PanelPage.test.tsx` guest-RSVP additions, concurrency/row-locking hardening, `SwapProposal` uniqueness constraints, storing `reservation_id` on notification payloads, `pledge_fulfillment.py` — no task group should touch these
