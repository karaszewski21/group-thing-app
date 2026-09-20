# Gap Analysis: Fix item-reservation and confirm-transaction flow (4 bugs + 2 new tile actions + term_id migration)

## Summary
- **Risk Level**: Medium (elevated from Phase 1's "Low-Medium" — the `cancel_transaction` SWAP-pairing requirement and the `term_id`-threading footprint are both larger than Phase 1 assumed)
- **Estimated Effort**: Medium
- **Detected Characteristics**: has_reproducible_defect, modifies_existing_code, creates_new_entities (new `cancel_transaction` use case + migration), involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: yes (bugs #1-#4, all root-caused in Phase 1)
- Modifies existing code: yes (all four bugs are fixes to existing code paths)
- Creates new entities: yes — new `term_id` column on `Reservation` (Alembic migration) + new `cancel_transaction` application function + new API route
- Involves data operations: yes — `ItemListingPreference.owner_party_id` reassignment (bug #2), new `Reservation.term_id` persistence (bug #4)
- UI heavy: yes — new buttons on `RzeczyView.tsx` tiles, disabled-state wiring, modal button semantics in `PanelDataContext.tsx`

## Gaps Identified

### Missing Features
- **`cancel_transaction` use case** (backend): does not exist. `circulation/application/reservation_transitions.py::cancel_reservation(db, reservation_id, acting_user_id)` exists and is usable as the primitive, but it:
  - Gates via `_require_party_to_reservation`, not `confirm_race_rules._require_race_participant` — the new `cancel_transaction` must call `_require_race_participant` itself (mirroring `confirm_transaction`'s pattern at line 688).
  - Has **no SWAP-pairing logic** — cancels exactly one `Reservation` row. `confirm_transaction` (lines 729-743) walks `reservation.paired_reservation_id` and repeats the operation on the paired leg; `cancel_transaction` must replicate this.
  - Has no `TermAlreadyResolvedException`/race-loser handling — needs the identical already-resolved guard as `confirm_transaction`.
  - `cancel_reservation`'s status guard is looser than `confirm_transaction`'s — needs reconciling so `cancel_transaction` accepts both `PENDING` and `CONFIRMED` (matching `_ACTIVE_RESERVATION_STATUSES`).
- **New API route** for cancel: no `cancel-transaction` endpoint exists (only `POST /api/reservations/{reservation_id}/confirm-transaction`).
- **`Reservation.term_id` column**: does not exist anywhere. Confirmed no `term_id` on `Reservation`, `ItemListingPreference`, or `SwapProposal`. NEW nullable FK column + Alembic migration.
  - **Creation-site footprint**: `Reservation` rows are created at `circulation/application/reservations.py::create_reservation` (line 24) and `create_lend_reservation` (line 60), called from `groups/application/term_item_listings.py::take_item_listing` (line 348) and `propose_swap` (line 417) — crossing the `groups`→`circulation` module boundary. `term_id` must be threaded through the DTO, kept as a plain FK-id column per DDD-boundary convention (`standards/backend/models.md`).

### Incomplete Features
- **Bug #1 (tile locking)**: `RzeczyView.tsx` mode-toggle buttons (lines 219-229) have zero `disabled`/`aria-disabled` gating. `itemBalances[it.id]` is already in scope (used by `lockBadgeLabel`) — fix is local: `disabled={ACTIVE_LOCK_BALANCE_STATUSES.includes(itemBalances[it.id] ?? "AVAILABLE")}`.
- **Bug #2 (re-list after transaction)**: `set_item_listing_preference`'s update branch needs `existing.owner_party_id = profile.party_id` alongside the `mode` reassignment.
- **Bug #3 (cache refresh)**: `confirmPendingAction` omits `await load({ silent: true })`. `KragGrupyPage.tsx` uses its own independent `useKragGrupy` hook with no shared invalidation channel to `PanelDataContext` (no React Query / shared cache anywhere in the frontend).

### Behavioral Changes Needed
- `RzeczyViewCategory.test.tsx` currently **asserts the absence** of an action button on locked tiles — must change to "Odebrał/Anuluj visible, mode toggles disabled" once bugs #1 and #4 land. This is a test *rewrite*, flagged for the implementation-planner.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (fallback confirm/cancel) | None — only reachable via the one-shot dismissable modal at term-end | Persistent action on the "Moje rzeczy" locked tile, reachable any time post-term | major improvement |
| Discoverability | 1-2/10 (modal only, once, then gone forever) | ~6/10 (two new buttons alongside the existing lock badge, competing for space with mode toggles + edit/delete icons) | +4/+5, see label-collision decision |
| Flow Integration | Dead end — "Później" is a permanent data-loss action | Integrates with the existing tile as ongoing status; consistent with `KragGrupyPage`'s existing persistent "Potwierdź odbiór" pattern | positive |
| Multi-Persona | N/A | Both parties to a SWAP need this on their own tiles — needs explicit per-leg test coverage | needs coverage |

**Confirmed UI collision**: `RzeczyView.tsx` line 197 already renders a button labeled **"Anuluj"** in the item-condition-edit inline form (cancels editing). Mutually exclusive in render (only shown while `editingItemCondition?.id === it.id`), so no simultaneous double-"Anuluj", but the label is reused for a semantically unrelated action.

## Data Lifecycle Analysis

### Entity: `ItemListingPreference` (bug #2)
| Operation | Backend | UI | Status |
|-----------|---------|-----|--------|
| CREATE | insert branch sets `owner_party_id` correctly | mode buttons | OK |
| UPDATE (mode change on existing item) | update branch — mode only, `owner_party_id` NOT reassigned | same buttons | broken after ownership transfer |
| READ | filters by `owner_party_id` | "Moje rzeczy" list | OK (but silently excludes the misattributed row) |

Completeness: ~75% — data-correctness bug, not a missing-layer orphan.

### Entity: `Reservation.term_id` (bug #4)
| Operation | Backend | UI | Status |
|-----------|---------|-----|--------|
| CREATE | does not exist — needs column + threading through 2 creation functions + 2 call sites | N/A | missing |
| READ | `confirm_transaction` currently takes `term_id` as caller-supplied param, not read from the row — needs a decision on whether to keep accepting it or read from `reservation.term_id` | new tile buttons need a way to get the reservation_id too | missing |

Completeness: 0% today.

**Missing touchpoint (critical)**: even after `term_id` is persisted, `RzeczyView.tsx`'s tile only has `item_id` + `BalanceStatus` in scope — no `reservation_id`. Persisting `term_id` alone doesn't give the tile anything to call `confirmTransaction`/the new cancel endpoint with. Needs either (a) `getInventoryItemBalances` extended to return `reservation_id`, or (b) a `resolvePendingReservationId`-style client lookup reused from `PanelDataContext`.

## Defect Analysis
All four bugs already have confirmed root causes with exact file/line evidence from Phase 1, independently re-verified for #2's `owner_party_id`, #4's `confirm_transaction` gating/pairing, and `cancel_reservation`'s actual signature.

### Regression Risk Areas
- `RzeczyViewCategory.test.tsx`'s "no action button" assertion will fail once bugs #1/#4 land — must be updated as part of the same change.
- `confirm_transaction`'s SWAP paired-leg logic is the template `cancel_transaction` must mirror; drift risks a half-cancelled SWAP (one leg AVAILABLE, other still locked) — highest-risk spot in the task.
- Threading `term_id` through `create_reservation`/`create_lend_reservation` touches a circulation-module function with 3 call sites across 2 files in a different bounded context — must stay a plain FK-id parameter per DDD-boundary convention.
- The in-progress sibling task (`2026-09-17-fix-giveaway-exchange`, phase-10, uncommitted) already modified `confirm_transaction`'s gating and `resolvePendingReservationId`/`confirmActionFor` in the exact same files this task touches. Implementation should verify against the *current* (already-modified) file contents.

## Issues Requiring Decisions

### Critical
1. **cancel-transaction-route-shape** — New sibling route `POST .../cancel-transaction` mirroring confirm's contract, vs. a single route with a verb discriminator. **Recommendation: new sibling route** (matches existing REST verb-suffix convention; different downstream side effects shouldn't share error branches).
2. **cancel-transaction-swap-pairing-implementation** — Duplicate `confirm_transaction`'s race-check+pairing structure, vs. extract a shared gating/pairing helper used by both. **Recommendation: extract shared helper** (avoids the two paths drifting out of sync — highest regression-risk spot).
3. **term-id-column-nullability-and-scope** — NOT NULL (audit every creation path) vs. nullable (default NULL for non-term-scoped paths; `pledge_fulfillment.py`'s involvement with `Reservation` creation is unverified). **Recommendation: nullable.**
4. **tile-reservation-id-lookup** — Extend `getInventoryItemBalances` response with `reservation_id`, vs. reuse a `PanelDataContext`-style client lookup. **Recommendation: extend balances response** (self-contained, no second round-trip).

### Important
1. **cancel-button-label** — Reuse "Anuluj" (mutually exclusive render states, lower churn) vs. a more specific label like "Anuluj wymianę". **Default: reuse "Anuluj".**
2. **cross-hook-refresh-mechanism** — Route-focus-triggered silent reload in `PanelDataContext` vs. a new shared invalidation signal. **Default: route-focus-triggered silent reload** (lower risk, no new shared-state primitive).

## Recommendations
- Implement bugs #1-#3 together first (low risk, no schema changes) — commit and test before starting bug #4's larger surface.
- Scope bug #4 as its own task group: migration → `Reservation.term_id` threading → shared confirm/cancel gating helper → new `cancel_transaction` route → tile UI (both buttons + reservation_id balance-field extension) → `RzeczyViewCategory.test.tsx` rewrite.
- Verify `pledge_fulfillment.py`'s relationship to `Reservation` creation during specification (surfaced in grep, not fully analyzed in Phase 1).
- Confirm the exact `cancel_reservation`/`confirm_reservation` status-guard reconciliation (PENDING vs CONFIRMED) explicitly in the spec.

## Risk Assessment
- **Complexity Risk**: Medium — bugs #1-#3 low; bug #4 medium-high (cross-module `term_id` threading, new SWAP-aware orchestration).
- **Integration Risk**: Medium — the tile's missing `reservation_id` is a previously-unflagged integration gap that must be closed for the new buttons to function at all.
- **Regression Risk**: Medium — concentrated in `cancel_transaction`'s SWAP-pairing logic and the mandatory `RzeczyViewCategory.test.tsx` rewrite.

## Integration Points
- `circulation/application/reservations.py::create_reservation` / `create_lend_reservation` → new `term_id` param, threaded from `groups/term_item_listings.py::take_item_listing` and `propose_swap`
- `groups/application/term_item_listings.py::confirm_transaction` → shared gating helper (proposed) → `circulation_bridge.confirm_reservation`/`fulfill_reservation`
- `groups/application/term_item_listings.py::NEW cancel_transaction` → same shared gating helper → `circulation_bridge.cancel_reservation` (×2 for SWAP paired leg)
- `groups/router/term_item_listings.py` → NEW `POST /api/reservations/{id}/cancel-transaction` route
- `frontend api/inventories.ts::getInventoryItemBalance(s)` → needs new `reservation_id` field for tile buttons
- `frontend RzeczyView.tsx` tile → `ACTIVE_LOCK_BALANCE_STATUSES` (disable toggles) + new Odebrał/Anuluj buttons → `api/reservations.ts confirmTransaction` + new `cancelTransaction`
- `PanelDataContext.tsx::confirmPendingAction` → add `await load({ silent: true })`
- `groups/application/term_item_listings.py::set_item_listing_preference` update branch → `existing.owner_party_id` reassignment

## Key Files Referenced
- `src/backend/app/circulation/application/reservation_transitions.py` (`cancel_reservation`, lines 76-93; `fulfill_reservation`, lines 96+)
- `src/backend/app/circulation/models.py` (`Reservation`, lines 191-224 — no `term_id`)
- `src/backend/app/circulation/application/reservations.py` (`create_reservation` line 24, `create_lend_reservation` line 60)
- `src/backend/app/groups/application/term_item_listings.py` (`confirm_transaction`, lines 663-746 — template for `cancel_transaction`)
- `src/frontend/src/pages/panel/views/RzeczyView.tsx` (lines 23-27 `lockBadgeLabel`, 214-246 tile action row, 193-198 existing "Anuluj" label collision)
- `.maister/tasks/development/2026-09-17-fix-giveaway-exchange/orchestrator-state.yml` (sibling in-progress task context)
