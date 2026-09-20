# Codebase Analysis Report

**Date**: 2026-09-17
**Task**: Investigate why the item giveaway (oddanie) and exchange (zamiana) mechanism does not work, in preparation for a bugfix/rework
**Description**: Investigate why the item giveaway (oddanie) and exchange (zamiana) mechanism does not work, in preparation for a bugfix/rework of `.maister/tasks/development/2026-09-17-fix-giveaway-exchange`
**Analyzer**: codebase-analyzer skill (3 Explore agents: Backend Code Analysis, Frontend Code Analysis, Context Discovery)

---

## Summary

The give-away/exchange mechanism (built in two prior orchestrator tasks, `2026-09-14-lending-exchange-mechanism` and `2026-09-16-item-giveaway-exchange-rework`) has an **uncommitted working-tree diff that already fixes the two real root causes** of "mechanism does not work": a swap-leg ownership inversion that made inventory transfer a no-op, and a naive-local-vs-UTC datetime mismatch that threw term-end gating off by ~2 hours. Backend tests (21/21) pass against the current tree. Two genuinely open gaps remain unaddressed by the diff: the frontend/backend never restrict a SWAP counter-offer to the proposer's own "zamienię"-tagged items, and no test anywhere asserts a `CirculationTransaction`/`CirculationEntry` was actually posted for audit purposes. The `SpotkaniaView.tsx`/`PanelPage.test.tsx` changes in the working tree are unrelated (guest-RSVP list fix) and should be confirmed with the user before inclusion in this task.

---

## Files Identified

### Primary Files

**`src/backend/app/groups/application/term_item_listings.py`** (uncommitted changes)
- Core use cases: set/list/browse listing preferences, `take_item_listing` (GIFT/LEND), `propose_swap`/`accept_swap_proposal` (SWAP), `confirm_transaction` (post-term confirm+fulfill).
- Contains the just-fixed swap ownership-inversion bug (`:419-441`, `:502-517`) and the just-fixed holder/physical-holder conflation bug (`:669-691`) in `confirm_transaction`.

**`src/backend/app/groups/application/term_end_scan.py`** (uncommitted changes)
- Periodic scan job (`scan_for_term_ended`, `_scan_giveaways`, `_scan_swaps`) that finds ended `Term`s and emits idempotent outbox events for unresolved GIFT reservations / ACCEPTED swaps.
- Contains the just-fixed `utcnow()` → `now()` fix (Term.occurs_on is naive local wall-clock).

**`src/backend/app/main.py`** (uncommitted changes)
- Registers `notifications_outbox_listener` and schedules `_run_term_end_scan` via APScheduler; scan interval changed 5→1 min (testing convenience only).

**`src/backend/app/groups/router/term_item_listings.py`**
- HTTP layer: `/api/item-listing-preferences/*`, `/api/term-item-listings/*`, `/api/swap-proposals/*`, `/api/reservations/{id}/confirm-transaction`.

**`src/backend/app/groups/models.py`**
- `ItemListingPreference` (GIFT/LEND/SWAP standing mode), `SwapProposal` (+status, `term_ended_notified_at` idempotency marker), `GiveawayTermEndMarker`.

**`src/backend/app/circulation/application/reservation_transitions.py`**
- `fulfill_reservation` (`:96`) is the only place a `CirculationTransaction` is posted and inventory ownership actually moves — the function whose no-op-ness was the actual bug symptom.

**`src/backend/app/circulation/infrastructure/ledger.py`**
- `post_circulation` (`:62`) — single entry point creating `CirculationTransaction` + paired DEBIT/CREDIT `CirculationEntry`.

**`src/backend/tests/test_term_item_listings.py`** (uncommitted changes)
- ~21 tests, all passing. New regression test `test_confirmTransaction_swapCounterpartyConfirmsViaPairedLegId_succeeds` is the first test in this area to assert real `InventoryItem.inventory_id` movement rather than just status fields — docstring calls this "the exact gap that let the real bug through every earlier test here."

**`src/frontend/src/pages/krag/KragGrupyPage.tsx`**
- Term/meeting page: `TermPageView`, `ListingRow`, `SwapProposeDialog` (exchange-offer item picker). Contains the frontend half of the SWAP-item-mode-not-enforced gap (`SwapProposeDialog`, `:318-373`, `:339-350`) and generic-toast error handling (`:708,725,1259,1284`).

**`src/frontend/src/hooks/useKragGrupy.ts`**
- Data/action hook: `myItemListings`, `browseListings`, `myAvailableItems`, `takeListing`, `proposeSwap`, `confirmListingReceipt`. `loadMyAvailableItems`/`AvailableItem` (`:35-38`, `:144-171`) build the swap-offer item list without joining `ItemListingPreference.mode`.

**`src/frontend/src/pages/panel/PanelDataContext.tsx`**
- Global state: `resolvePendingReservationId`, `confirmPendingAction`, `GlobalPendingActionsModal` (post-term confirm/accept/reject prompts, app-wide).

### Related Files

**`src/backend/app/groups/domain/confirm_race_rules.py`** — `_require_race_participant(reserved_by, holder, acting)`, pure predicate for the post-term confirm race.

**`src/backend/app/groups/domain/swap_events.py`** — event-type string constants shared with `app.notifications` by convention only.

**`src/backend/app/groups/infrastructure/circulation_bridge.py`** — only module in `app.groups` allowed to import `app.circulation`; pass-throughs for reservations/items/inventory.

**`src/backend/app/groups/infrastructure/repository.py`** — read queries incl. `ItemListingPreference`/`SwapProposal` lookups.

**`src/backend/app/groups/infrastructure/notifications_bridge.py`** / **`slug_resolver.py`** — notification creation and link-path building.

**`src/backend/app/groups/application/attendance.py`** — `_require_term_eligibility`, Term-scoped gate reused throughout.

**`src/backend/app/groups/application/pledge_fulfillment.py`** — sibling mechanism, shares `_require_own_available_personal_item` ownership-check pattern.

**`src/backend/app/circulation/domain/reservation_rules.py`** — `_require_holder_to_confirm`, `_require_party_to_reservation`.

**`src/backend/app/notifications/outbox_listener.py`** — `_handle_term_ended_giveaway`/`_handle_term_ended_swap` consume outbox events, create `TERM_CONFIRMATION_NEEDED` notifications.

**`src/frontend/src/api/termItemListings.ts`** — `getMyTermItemListings`, `getBrowseTermItemListings`, `takeTermItemListing`, `proposeSwap`, `acceptSwapProposal`, `rejectSwapProposal`.

**`src/frontend/src/api/reservations.ts`** — `getReservation`, `confirmReservation`, `fulfillReservation`, `confirmTransaction`.

**`src/frontend/src/api/itemListingPreferences.ts`** — sets standing oddam/wypożyczę/zamienię tag (from "Moje rzeczy").

**`src/frontend/src/pages/panel/panelHelpers.ts`** — `ItemMode`↔`ReservationType` maps (`zamienię`→SWAP, `oddam`→GIFT, `wypożyczę`→LEND).

### Unrelated (flag for user confirmation)

**`src/frontend/src/pages/panel/views/SpotkaniaView.tsx`** and **`src/frontend/src/test/PanelPage.test.tsx`** (both uncommitted) — fix a GUEST-attendance-without-Circle-membership gap in the "Spotkania" entry-point term list. Does not touch listings/reservations/confirm logic. Appears to be unrelated leftover WIP mixed into this branch; confirm with the user whether it belongs in this fix task before proceeding.

---

## Current Functionality

### End-to-end flow: Give-away (GIFT)

1. Owner sets standing preference: `PUT /api/item-listing-preferences/{item_id}` (mode=GIFT) → `set_item_listing_preference` (`term_item_listings.py:89`) — ownership-only check.
2. Anyone eligible browses `GET /api/term-item-listings/browse` → `list_browsable_term_item_listings` (`:282`) → `_resolve_listing_status` (`:146`).
3. Taker: `POST /api/term-item-listings/{item_id}/take` → `take_item_listing` (`:321`) — eligibility both sides, balance AVAILABLE, mode match, creates PENDING `Reservation`, notifies owner.
4. Term ends → APScheduler (`main.py:52`) → `scan_for_term_ended` → `_scan_giveaways` (`term_end_scan.py:66`) finds PENDING GIFT reservations, emits outbox event `groups.term_ended_giveaway` + `GiveawayTermEndMarker`.
5. Outbox listener creates `TERM_CONFIRMATION_NEEDED` notification for both parties.
6. Either party: `POST /api/reservations/{id}/confirm-transaction` → `confirm_transaction` (`:627`) gates on `term.occurs_on <= now()`, resolves counterparty (`:580`), enforces race rule, confirms then fulfills.
7. `fulfill_reservation` (`reservation_transitions.py:96`) moves `item.inventory_id` to taker, balance→AVAILABLE, `post_circulation` posts ledger entries.
8. Second party's later confirm → `TermAlreadyResolvedException` → 409 + `TERM_ALREADY_RESOLVED` notification.

### End-to-end flow: Exchange (SWAP / zamiana)

1. Owner sets mode=SWAP.
2. Proposer: `POST /api/term-item-listings/{item_id}/propose` → `propose_swap` (`:390`) — validates listing item AVAILABLE+SWAP, validates proposer's offered item via `_require_own_available_personal_item` (`:67`, **ownership+AVAILABLE only — no mode check**), creates `Reservation` on offered item (gaining party = owner), self-confirms, creates `SwapProposal(PROPOSED)`.
3. Owner: `POST /api/swap-proposals/{id}/accept` → `accept_swap_proposal` (`:477`) creates second `Reservation` on listing item (gaining party = proposer), self-confirms, wires `paired_reservation_id` bidirectionally, `SwapProposal.status=ACCEPTED`.
4. Term ends → `_scan_swaps` (`:129`) finds ACCEPTED proposals, emits `groups.term_ended_swap`, stamps `term_ended_notified_at`.
5. Outbox listener notifies both parties.
6. Either party's `confirm_transaction` resolves stable counterparty via SWAP branch (`:597`), confirms+fulfills the given leg, then — via `paired_reservation_id` — confirms+fulfills the paired leg too (`:696-707`).
7. Each `fulfill_reservation` call moves that leg's item; two ledger postings total per swap.

### Frontend flow (mirrors backend)

- **Give-away**: "Weź na stałe" button (`KragGrupyPage.tsx:178`) → `takeTermItemListing`. Post-term, `GlobalPendingActionsModal` → `confirmPendingAction` → `resolvePendingReservationId` → `confirmTransaction`.
- **Exchange**: "Zamień" button → `openSwapSelect` opens `SwapProposeDialog` (`KragGrupyPage.tsx:318-373`), `<select>` built from `myAvailableItems`/`AvailableItem[]` → `proposeSwap(itemId, offeredItemId)`. Owner accepts/rejects via global modal `SWAP_PROPOSED` action. Post-acceptance, same confirm-transaction flow applies to both legs.
- State management: plain local component/hook state (`useState`/`useMemo`/`useCallback`), no React Query/SWR/global cache; manual `refetch()`/`load()` after mutations.

### Data Flow

Preference (standing) → Term-scoped Reservation(s) → APScheduler term-end scan → Outbox event → Notification → User confirm-transaction call → Reservation confirm+fulfill → InventoryItem ownership transfer + CirculationTransaction/Entry ledger postings.

---

## Dependencies

### Imports (What This Depends On)

- `app.groups.infrastructure.circulation_bridge` → `app.circulation` (reservations, items, inventory) — sole allowed cross-domain import point (DDD bounded-context discipline).
- `app.notifications.outbox_listener` — consumes outbox events by string-constant convention (`swap_events.py`), no direct import coupling.
- APScheduler (`main.py`) — drives periodic term-end scan.
- Frontend `termItemListings.ts`/`reservations.ts` API clients — thin fetch wrappers to the router endpoints.

### Consumers (What Depends On This)

- **`KragGrupyPage.tsx`** — primary UI consumer of both listing and confirm-transaction flows (public and private views).
- **`PanelDataContext.tsx`** — consumes reservation/proposal state for the global pending-actions modal across the whole app.
- **`pledge_fulfillment.py`** — sibling backend mechanism reuses the same ownership-check pattern (`_require_own_available_personal_item`), not a hard dependency but a parallel consumer of the same conventions.

**Consumer Count**: 2 primary frontend surfaces (term page, global modal) + 1 sibling backend mechanism.
**Impact Scope**: Medium — the mechanism is centralized (single application-layer module + single circulation bridge), so fixes are localized, but the global pending-actions modal means behavior changes are visible app-wide.

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_term_item_listings.py`** (~21 tests): preference-setting, browse eligibility, GIFT/LEND take, full SWAP propose/accept/reject lifecycle, confirm_transaction before/after term-end, confirm-race, non-party rejection, plus new inventory-ownership-transfer regression test. All passing against current (uncommitted) tree.
- **`src/frontend/src/test/PanelPage.test.tsx`** (2149 lines): `describe("PanelPage — Group 7 global pending-actions modal")` covers modal rendering for swap accept/reject (incl. via `proposal_id`), already-resolved race-loss messaging, post-term-end confirmation prompts, read/unread filtering.

### Coverage Assessment

- **Test count**: ~21 backend + a substantial modal-focused frontend suite.
- **Gaps** (confirmed, not hypothesized):
  1. **No test anywhere asserts a `CirculationTransaction`/`CirculationEntry` row was actually posted** — despite this being an explicit requirement of the mechanism (auditability). Neither `circulation_entries` nor `circulation_transactions` appears by name in `test_term_item_listings.py`.
  2. **No frontend test exercises true end-to-end take→confirm→item-moved flow** or asserts `KragGrupyPage` item-lock badges reflect real state; only the one new backend test checks actual inventory movement.
  3. This exact class of gap (asserting status transitions but not real side effects) is what let the swap ownership-inversion bug ship undetected through the 2026-09-16 rework's full test suite (249/249 backend, 218/222 frontend) — worth calling out explicitly since it's a testing-strategy issue, not just a missing test.

---

## Coding Patterns

### Naming Conventions

- Backend: layered application/domain/infrastructure modules under `app/groups/`; private helper functions prefixed `_` (e.g., `_require_own_available_personal_item`, `_resolve_transaction_holder_user_id`).
- Frontend: hooks named `use<Feature>` (`useKragGrupy`), API modules per resource (`termItemListings.ts`, `reservations.ts`).

### Architecture Patterns

- **Backend**: DDD-style bounded contexts (`app.groups`, `app.circulation`) with a single designated bridge module for cross-context access; outbox pattern for term-end → notification decoupling; APScheduler for periodic jobs.
- **Frontend**: functional components + hooks, local state only (no global cache/query library), manual refetch-after-mutation.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count (primary) | ~12 backend + 5 frontend | Medium-High |
| Dependencies | Cross-context bridge (circulation), outbox/notifications, APScheduler | Medium |
| Consumers | 2 primary UI surfaces + 1 sibling backend mechanism | Medium |
| Test coverage | Status-level good, but misses real side-effect assertions (ledger, inventory) | Medium (gap identified) |

### Overall: Moderate

The mechanism itself is well-factored (application/domain/infrastructure layering, single bridge module, centralized auth/eligibility checks), which is why the actual bugs were narrow (one field assignment inversion, one datetime function). The complexity risk is less in the code structure and more in the **multi-step async lifecycle** (propose→accept→term-end-scan→outbox→notify→confirm→fulfill) where a single wrong variable at any step silently breaks the whole chain without raising an exception — exactly what happened.

---

## Key Findings

### Strengths
- Clear layering and a single, disciplined cross-context bridge (`circulation_bridge.py`) keeps `app.groups` and `app.circulation` decoupled.
- The just-added regression test (asserting real `InventoryItem.inventory_id` after fulfillment) is a genuinely valuable addition that closes the exact hole that let the ownership-inversion bug through.
- Router wiring, APScheduler registration, and outbox listener registration are all confirmed intact end-to-end — no dead-wiring issues.
- Prior task's `implementation-verification.md` already flagged a real concurrency gap (W1: unhandled `StaleDataError` on genuinely concurrent double-confirm → raw 500) with a clear recommendation, useful as a pre-vetted follow-up item.

### Concerns
- **SWAP item-mode enforcement is missing on both frontend and backend.** `_require_own_available_personal_item` (backend) and `myAvailableItems`/`SwapProposeDialog` (frontend) never check `ItemListingPreference.mode === SWAP` on the offered item — a user can offer any available personal item in an exchange, not just ones they've tagged "zamienię". This is a functional gap relative to the described mechanism, not just a display issue.
- **No audit-trail test coverage** for `CirculationTransaction`/`CirculationEntry` — a stated requirement (#6 per Context Discovery) is unverified by any test.
- **Generic error toasts discard actionable detail** (`KragGrupyPage.tsx:708,725,1259,1284`) — every mutation handler collapses distinct `BusinessConflictException`s into one Polish toast, which is likely a major contributor to the vague "mechanism doesn't work" bug reports, since real failures (timezone gating, wrong-party rejection, already-resolved races) are indistinguishable to the user.
- **Unrelated changes are mixed into the working tree** (`SpotkaniaView.tsx`, `PanelPage.test.tsx`) — should be confirmed with the user and likely split out before committing the actual fix.
- Two prior "add fix" commits (943bad3, 218454a) are squashed full-feature commits, not incremental bugfixes — the actual root-cause fixes for this investigation are still uncommitted.

### Opportunities
- Since the two main root causes (swap ownership inversion, UTC/local datetime mismatch) are already fixed in the uncommitted diff and validated by passing tests, this task can likely focus primarily on: (a) verifying/committing the existing fix, (b) closing the SWAP-mode-enforcement gap, (c) adding circulation-ledger assertion tests, and (d) improving error surfacing — rather than a full rework.
- The already-identified W1 (concurrent `StaleDataError`) and W2 (missing index on `swap_proposals.listing_item_id`) from the prior verification report are candidates to fold into this task's scope if the user wants a more complete pass.

---

## Impact Assessment

- **Primary changes**: `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/term_end_scan.py`, `src/backend/app/main.py` (verify/commit existing fixes); potentially extend `_require_own_available_personal_item` and the frontend `AvailableItem`/`myAvailableItems` pipeline to enforce SWAP-mode filtering.
- **Related changes**: `src/frontend/src/hooks/useKragGrupy.ts` and `KragGrupyPage.tsx` (`SwapProposeDialog`, `loadMyAvailableItems`) if SWAP-mode enforcement is added; error-handling paths (`KragGrupyPage.tsx:708,725,1259,1284`) if improved error surfacing is in scope.
- **Test updates**: new backend test(s) asserting `CirculationTransaction`/`CirculationEntry` rows are posted; possibly a SWAP-mode-enforcement rejection test; frontend test(s) if the item picker is filtered.
- **Out of scope / needs confirmation**: `SpotkaniaView.tsx` + `PanelPage.test.tsx` changes.

### Risk Level: Low-Medium

The core mechanism's structure is sound and the major bugs are already fixed and tested (21/21 passing). Residual risk is concentrated in: (1) the still-unenforced SWAP item-mode rule (a genuine functional gap, moderate effort to close correctly on both layers), and (2) the previously-flagged but unaddressed concurrency edge case (W1), which is a correctness issue under real concurrent load but not exercised by the current sequential-only test infrastructure (`conftest.py` shares one `AsyncSession` per test).

---

## Recommendations

**This is primarily a "verify and extend an in-progress fix" situation, not a from-scratch bugfix.**

1. **Confirm with the user**: (a) whether to keep/commit the already-fixed swap-ownership and timezone changes as-is, (b) whether `SpotkaniaView.tsx`/`PanelPage.test.tsx` belong in this task or should be split into a separate commit/branch.
2. **Root cause validation**: Re-run the full backend suite (`uv run pytest` in `src/backend`) and frontend suite against the current working tree to reconfirm 21/21 and the frontend counts before treating the diff as done.
3. **Close the SWAP-mode-enforcement gap**: Extend `_require_own_available_personal_item` (or add a sibling check) in `term_item_listings.py` to require the offered item's `ItemListingPreference.mode == SWAP`; mirror on the frontend by joining `myAvailableItems` against `getMyItemListingPreferences()` and filtering `SwapProposeDialog`'s `<select>` accordingly. Add a backend rejection test and a frontend filtering test.
4. **Add ledger audit-trail test coverage**: at least one test asserting a `CirculationTransaction` + paired `CirculationEntry` rows exist after a GIFT and after a SWAP fulfillment, addressing the stated requirement gap.
5. **Improve error surfacing** (optional, based on user priority): differentiate toast messages for distinct `BusinessConflictException` types so future "doesn't work" reports are diagnosable from the UI alone.
6. **Consider folding in W1 (concurrent double-confirm StaleDataError)** from the prior verification report if the user wants correctness under true concurrency addressed now rather than deferred again.

---

## Next Steps

Proceed to gap analysis (`gap-analyzer`) using this report to compare current state (fixed-but-uncommitted core bugs, open SWAP-mode-enforcement gap, missing ledger tests) against the desired end state for this task, then into specification/planning for the remaining concrete work items (SWAP-mode enforcement, ledger test coverage, and the unrelated-file split decision).
