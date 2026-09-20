# Codebase Analysis Report

**Date**: 2026-09-20
**Task**: Fix four related bugs in the panel/krag item-listing and reservation flow
**Description**: Four related bugs in the panel/krag item-listing and reservation flow of group-thing-app:
1. Item tile in panel "Moje rzeczy" should be locked (can't toggle Wypożyczę/Oddam/Zamienię) while the item has an active reservation.
2. After a completed transaction, a user cannot re-list an item they previously received/took — `PUT /api/item-listing-preferences/{id}` doesn't correctly set the preference flags for a previously-acquired item.
3. "Moje rzeczy" panel list doesn't refresh automatically after an exchange/give-away transaction completes (cache/refresh bug).
4. When the user clicks "skip" (pomiń/Później) on the post-term confirmation dialog ("Czy dałeś/otrzymałeś rzecz X?"), there's no other way to confirm later — need a fallback "odebrał/nieodebrał rzeczy" action on the locked/reserved item tile.

**Analyzer**: codebase-analyzer skill (5 Explore agents: Code Analysis × 4, Context Discovery)

---

## Summary

All four bugs are confirmed and root-caused, each isolated to 1-2 files with a clear minimal fix. Bugs #1-#3 are self-contained, low-risk changes with existing infrastructure (badge data, refresh pattern) already in place — the fix is "wire up what's already there." Bug #4 is structurally harder: no persisted `term_id` exists anywhere for a reservation/item once its originating notification is dismissed, so a full fix requires either a frontend workaround (re-query dismissed notifications) or a backend schema addition (persist `term_id`). All four bugs are backed by an existing, extensive test suite (`test_term_item_listings.py`, `PanelPage.test.tsx`, `KragGrupyPage.test.tsx`, `RzeczyViewCategory.test.tsx`) that provides ready-made fixtures/patterns to extend, though current coverage for the actual defects is confirmed zero (bugs #2, #3, #4) to partial (bug #1).

---

## Files Identified

### Primary Files

**`src/backend/app/groups/application/term_item_listings.py`** (bug #2 root cause; also relevant to #4)
- `set_item_listing_preference` (lines 89-125): the `if existing is not None` branch mutates `mode` but never reassigns `existing.owner_party_id`, leaving preference rows attributed to the previous owner after an item changes hands.
- `confirm_transaction` (lines 663-746): the reusable, idempotent confirm endpoint used both by the term page and (potentially) any new tile-based fallback action for bug #4. Gate is only `term.occurs_on <= now()`.

**`src/frontend/src/pages/panel/views/RzeczyView.tsx`** (bugs #1 and #4)
- Renders "Moje rzeczy" tiles, the three mode-toggle buttons (lines ~219-228), and `lockBadgeLabel` (lines 13-27) — currently a purely informational badge with an explicit comment stating no action button is ever added.
- Toggle buttons have no `disabled` attribute — the concrete gap for bug #1.
- The tile where a new "odebrał/nieodebrał rzeczy" fallback action (bug #4) needs to be added.

**`src/frontend/src/pages/panel/PanelDataContext.tsx`** (bugs #1, #3, #4)
- `itemModes` state / `setItemMode(itemId, mode)` (~line 868): write path for mode toggles, no lock guard — secondary defense-in-depth location for bug #1.
- `confirmPendingAction` (lines 717-747): confirms a pending transaction but is missing the `await load({ silent: true })` refresh call that every sibling mutation handler includes — root cause of bug #3.
- `GlobalPendingActionsModal` (~lines 1339-1438): the "Czy dałeś/otrzymałeś rzecz X?" dialog; its "Później" button (bug #4) calls `dismissPendingAction` which permanently discards the notification (and the only client-side source of `term_id` for that reservation) via `markNotificationRead` (line 658).
- `pendingActions` (lines 612-642), `dismissPendingAction` (648-659), `resolvePendingReservationId` (176-212): the notification → pending-action → reservation-id resolution pipeline relevant to bug #4.

**`src/frontend/src/api/inventories.ts`** (bug #1)
- `ACTIVE_LOCK_BALANCE_STATUSES = ["RESERVED", "IN_TRANSIT"]` (line 87): already exported constant, currently unused for actual UI locking — exactly what bug #1's fix needs to consume.
- `getInventoryItemBalance(s)`: returns only `status`/timestamps, no `reservation_id`/`term_id` (relevant limitation for bug #4).

### Related Files

**`src/backend/app/groups/router/term_item_listings.py`**
- `PUT /api/item-listing-preferences/{item_id}` handler (lines 39-47): thin passthrough to the buggy service call (bug #2).
- `POST /api/reservations/{reservation_id}/confirm-transaction` (lines 122-146): already generic/reusable endpoint, maps `TermAlreadyResolvedException` to 409 `already_resolved: true` — reusable for bug #4's fallback action.

**`src/backend/app/groups/service.py`** — facade re-exporting `set_item_listing_preference` (bug #2, no logic here).

**`src/backend/app/groups/infrastructure/repository.py`**
- `get_item_listing_preference` (lines 398-404): looks up by `item_id` only, no owner filter — enables the stale-owner row to be reused (bug #2).
- `list_item_listing_preferences_for_party`: filters by `owner_party_id`, which is why a re-listed item silently disappears from the new owner's own list (bug #2 symptom).

**`src/backend/app/groups/models.py`**
- `ItemListingPreference` (lines 231-260): `item_id` unique constraint, separate `owner_party_id` column (bug #2). No `term_id` column anywhere (bug #4 blocker).
- `SwapProposal` (lines 263-300): also has no `term_id` (bug #4 blocker).

**`src/backend/app/circulation/application/reservation_transitions.py`**
- `fulfill_reservation` (lines 96-147, esp. 129-136): SWAP/GIFT branch correctly moves ownership to the new owner's PERSONAL inventory — confirms the circulation layer's ownership transfer is correct; bug #2 is isolated to the `groups` preference row.

**`src/backend/app/groups/infrastructure/circulation_bridge.py`** / **`src/backend/app/circulation/application/inventory_items.py`**
- `resolve_owning_inventory` correctly resolves the post-transfer owning inventory — confirms the preference-set authorization check itself is not the bug.

**`src/backend/app/groups/application/term_end_scan.py`**
- `scan_for_term_ended`: the only place `term_id` is ever captured for a reservation, embedded in an outbox event's `link_path`. Central to bug #4's structural gap.

**`src/frontend/src/pages/krag/KragGrupyPage.tsx`**
- `handleConfirmListing`/`handleConfirmReceipt` (lines 642-651, 733+), persistent "Potwierdź odbiór" tile action (rendered 1044-1054, 1100-1109, 1156-1165) — working precedent for a durable, term-scoped confirm action (relevant pattern for bug #4).
- Own `refetch()` via `useKragGrupy` — confirms independently from `PanelDataContext`, contributing to bug #3's structural gap (confirming here never refreshes Panel's "Moje rzeczy").

**`src/frontend/src/hooks/useKragGrupy.ts`**
- Independent per-term-page state hook (lines 140-244) with no shared cache/query key with `PanelDataContext` — structural cause behind bug #3's secondary gap.

**`src/frontend/src/api/termItemListings.ts`** — `setItemListingPreference`, the client call that triggers bug #2's backend path.

**`src/frontend/src/api/reservations.ts`** — `confirmTransaction(reservationId, { term_id })` (lines 79-84), reused by both existing confirm dialogs; would be reused by bug #4's fallback action.

**`src/frontend/src/pages/panel/panelHelpers.ts`** — `ITEM_MODES`, `ITEM_MODE_STYLE` powering the three toggle buttons (bug #1 rendering).

**`src/backend/app/groups/domain/confirm_race_rules.py`** — `_require_race_participant`: authorization gate on who can call confirm; unaffected by but relevant context for bug #4.

**`src/backend/app/circulation/schemas.py`** — reservation state machine (`PENDING → CONFIRMED → FULFILLED`/`CANCELLED`), no `term_id` field (bug #4 blocker).

**`src/backend/alembic/versions/0033_inventory_personal_virtual_uniqueness.py`** — unrelated partial-unique-index migration; explicitly ruled out as a cause for bug #2.

---

## Current Functionality

### Bug #1 — Tile locking
`RzeczyView` already fetches per-item `BalanceStatus` (`itemBalances`, local state) and already has `ACTIVE_LOCK_BALANCE_STATUSES` exported for exactly this purpose, plus a purely-informational lock badge (`lockBadgeLabel`). The toggle buttons simply never check this data — no `disabled` wiring exists on the buttons themselves, nor a guard in `setItemMode`.

### Bug #2 — Re-listing after transaction
`set_item_listing_preference`'s existing-row branch updates `mode` in place but never reassigns `owner_party_id`. Since `ItemListingPreference.item_id` is unique (one row per item, per model docstring), a row created by the previous owner survives ownership transfer and gets silently reused — mode changes, but ownership attribution doesn't. Downstream, `list_item_listing_preferences_for_party` filters by `owner_party_id`, so the new (rightful) owner's own listing never appears in their own "Moje rzeczy", while the previous owner's is misattributed with a row for an item they no longer own.

### Bug #3 — Cache refresh
No shared query cache (no React Query/SWR) — a hand-rolled context (`PanelDataContext`) with a single `load()` function, manually re-invoked after each mutation. Every mutation handler follows a "mutate → `await load()`" convention except `confirmPendingAction`, which omits it — the direct root cause. A secondary, structural issue: `useKragGrupy` (term page) and `PanelDataContext` (panel page) are fully independent state instances with no cross-invalidation, so confirming from the term page never updates the panel view either.

### Bug #4 — Post-term dialog skip fallback
The confirm-transaction backend flow is fully general/idempotent and safe to call repeatedly at any time after term end — no backend state-machine changes needed for the "confirm later" concept itself. The blocker is structural: `term_id` for a given reservation/item is captured *only* inside the outbox-derived notification's `link_path`, at scan time. Once the user dismisses ("Później") that notification via `dismissPendingAction` → `markNotificationRead`, that's the only place `term_id` existed client-side, and it's gone — nothing in `Reservation`, `ItemListingPreference`, or `SwapProposal` persists a term/reservation link. Adding a fallback action to the locked tile in `RzeczyView.tsx` (which only knows `item_id` + `BalanceStatus`) requires either recovering `term_id` from read (not just unread) notifications client-side, or persisting `term_id` server-side.

### Key Components/Functions

- **`ACTIVE_LOCK_BALANCE_STATUSES`** (`inventories.ts`): status set (`RESERVED`, `IN_TRANSIT`) that should gate tile editability — exists, unused.
- **`lockBadgeLabel`** (`RzeczyView.tsx`): informational-only badge display; candidate location to add the bug #4 fallback action.
- **`set_item_listing_preference`** (`term_item_listings.py`): buggy update branch, bug #2.
- **`confirmPendingAction`** (`PanelDataContext.tsx`): missing refresh call, bug #3.
- **`confirm_transaction`** (`term_item_listings.py`): reusable backend confirm action, safe basis for bug #4's fix.

### Data Flow

Term ends → `term_end_scan.scan_for_term_ended` derives eligible parties from `ItemListingPreference` and appends an outbox event carrying `term_id` in its `link_path` (the only place this ever happens) → outbox listener creates a `Notification` (`kind: TERM_CONFIRMATION_NEEDED`) → `PanelDataContext.pendingActions` derives a `PendingConfirmAction` per unread notification, parsing `term_id` back out via `parseTermIdFromLinkPath` → `GlobalPendingActionsModal` renders "Potwierdź"/"Później" → "Potwierdź" resolves reservation id and calls `confirmTransaction`; "Później" discards the notification (and the only client path to `term_id`) via `markNotificationRead`.

---

## Dependencies

### Imports (What This Depends On)

- Backend `term_item_listings.py` depends on `circulation_bridge` (inventory/ownership resolution) and `repository` (preference CRUD).
- Frontend `RzeczyView.tsx` depends on `api/inventories.ts` (balances) and `PanelDataContext` (items, `setItemMode`).
- `PanelDataContext.confirmPendingAction` depends on `api/reservations.ts::confirmTransaction` and `resolvePendingReservationId`.

### Consumers (What Depends On This)

- **`src/backend/app/groups/router/term_item_listings.py`**: consumes `set_item_listing_preference` and `confirm_transaction` directly (bugs #2, #4).
- **`src/frontend/src/pages/panel/views/RzeczyView.tsx`**: consumes `itemModes`/`setItemMode` and `ACTIVE_LOCK_BALANCE_STATUSES` (bug #1).
- **`src/frontend/src/pages/krag/KragGrupyPage.tsx`**: independent consumer of `confirmTransaction` via its own hook (bug #3's structural half).
- **`src/frontend/src/test/PanelPage.test.tsx`**, **`RzeczyViewCategory.test.tsx`**, **`KragGrupyPage.test.tsx`**: existing tests exercising these surfaces.

**Consumer Count**: ~6-8 files directly touch the buggy code paths across backend/frontend.
**Impact Scope**: Medium — changes are localized to specific functions/branches within already-identified files; no broad API surface changes required for bugs #1-#3. Bug #4 has a wider potential impact if a schema change (persisting `term_id`) is chosen.

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_term_item_listings.py`** (1402 lines): preference set/clear/list, swap flows, `confirm_transaction` (race/`already_resolved`, SWAP paired-leg, GIFT/SWAP ledger posting). Closest existing test to bug #2 is `test_setPreference_whileItemLentOut_stillSucceeds` (line 753), but it covers temporary LEND, not permanent ownership transfer — does not assert `owner_party_id`.
- **`src/backend/tests/test_term_item_listings_router.py`** (577 lines): HTTP-layer status-code/shape checks.
- **`src/backend/tests/test_circulation.py`** (676 lines): inventory/reservation fulfillment, includes a 2026-09-17 regression test for duplicate-PERSONAL-inventory (unrelated but adjacent pattern).
- **`src/backend/tests/test_term_end_scan.py`** (334 lines): outbox scan idempotency / notification creation.
- **`src/frontend/src/test/KragGrupyPage.test.tsx`** (606 lines): term-gating of "Potwierdź odbiór", 409 handling. Has a TODO noting no true E2E without Playwright.
- **`src/frontend/src/test/PanelPage.test.tsx`** (2343 lines): broadest file — item edit/delete, global pending-actions modal (swap accept/reject, `TERM_CONFIRMATION_NEEDED` confirm). No test hits `"Później"` (`grep` returns zero matches).
- **`src/frontend/src/test/RzeczyViewCategory.test.tsx`** (197 lines): passive lock-badge rendering only (`RESERVED`/`IN_TRANSIT`/`AVAILABLE`), explicitly asserts no action button is rendered — this assertion will need to change for bugs #1 and #4.
- **`src/frontend/src/test/useKragGrupy.test.ts`**: hook-level, no coverage of the four bug areas.

### Coverage Assessment

- **Test count**: several thousand lines total across the above files, but zero tests directly cover any of the four defects end-to-end.
- **Gaps**:
  1. Bug #1: badge rendering tested, but no test drives a real take/reserve flow to assert the toggle buttons become disabled.
  2. Bug #2: zero coverage — no test asserts `owner_party_id` after re-listing a previously-acquired item.
  3. Bug #3: zero coverage — no test asserts a second `getInventoryItems`/list-content-change call after `confirmPendingAction` resolves.
  4. Bug #4: zero coverage; `RzeczyViewCategory.test.tsx` currently asserts the *opposite* (no action button) and will need updating once the fallback action is added.

---

## Coding Patterns

### Naming Conventions

- **Backend**: snake_case functions/modules, `application/`, `infrastructure/`, `router/`, `domain/` DDD layering per module (per project memory: groups/circulation are domain/application/infrastructure-layered behind a flat `service.py` facade).
- **Frontend**: PascalCase components (`RzeczyView.tsx`), camelCase hooks/functions (`setItemMode`, `useKragGrupy`), Polish UI copy alongside English identifiers.
- **Tests**: `test_<action>_<condition>_<expectedResult>` pattern in backend tests (e.g. `test_confirmTransaction_swapCounterpartyConfirmsViaPairedLegId_succeeds`).

### Architecture Patterns

- **Style**: Backend follows DDD-ish layering (domain/application/infrastructure) behind facades; frontend is function-component/hooks-based React.
- **State Management**: No global state library — custom React Context (`PanelDataContext`) with manual `load()`/refetch calls; a separate per-page hook (`useKragGrupy`) duplicates similar concerns for the term page, with no shared cache.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count (bugs #1-#3) | 1-2 files each | Low |
| File count (bug #4) | 3+ files, possible schema change | Medium-High |
| Dependencies | Localized (inventory balances, notification/outbox pipeline) | Low-Medium |
| Consumers | 6-8 files touch buggy paths | Medium |
| Test coverage of defects | 0% (bugs #2-#4), partial (bug #1) | High (gap) |

### Overall: Moderate

Bugs #1-#3 are individually simple (single-branch/single-line fixes with existing supporting infrastructure). Bug #4 is the complexity driver: it exposes a genuine data-modeling gap (no persisted term/reservation linkage) that the other three bugs don't have, and the choice between a frontend workaround and a backend schema addition affects scope significantly.

---

## Key Findings

### Strengths
- Bugs #1 and #3 have all necessary data/patterns already present in the codebase (`ACTIVE_LOCK_BALANCE_STATUSES`, the `load()` refresh convention) — these are pure "wire it up" fixes, low risk.
- `confirm_transaction` backend endpoint is already idempotent, race-safe, and reusable — no new backend logic needed for bug #4's core confirm action.
- Existing test suite provides strong scaffolding/fixtures (`PanelPage.test.tsx`'s `pendingNotif`/mock helpers, backend's `_register`→`_create_circle_and_term`→... factory chain) to extend for new regression tests.

### Concerns
- Bug #4 exposes a structural data gap: term_id is never persisted against a reservation/item, only transiently derivable from a notification's `link_path`. This constrains the fix options and could require a migration if the backend-persistence route is chosen.
- Two independent, non-synchronized state containers (`PanelDataContext` vs `useKragGrupy`) mean fixing bug #3 for the panel's own modal won't fully close the gap for confirms initiated from the term page — worth flagging as a secondary, currently out-of-scope fix.
- `RzeczyViewCategory.test.tsx` currently asserts the *absence* of an action button on locked tiles — this test will need explicit updating (not just addition) once bug #4 is fixed.

### Opportunities
- Bugs #1-#3 fixes are small enough to implement and test together in one pass with low risk of regression.
- The existing "same fixture, two surfaces" cross-reference pattern between `KragGrupyPage.test.tsx` and `PanelPage.test.tsx` (noted at lines 492-501/2087-2095) is a good template to extend for the new regression tests these fixes need.

---

## Impact Assessment

- **Primary changes**:
  - `src/backend/app/groups/application/term_item_listings.py` (bug #2: add `existing.owner_party_id = profile.party_id` in the update branch)
  - `src/frontend/src/pages/panel/views/RzeczyView.tsx` (bug #1: `disabled`/`aria-disabled` on toggle buttons; bug #4: new fallback action on locked tiles)
  - `src/frontend/src/pages/panel/PanelDataContext.tsx` (bug #3: add `await load({ silent: true })` in `confirmPendingAction`; bug #1: optional defense-in-depth guard in `setItemMode`; bug #4: term_id resolution logic for the new fallback action)
- **Related changes**: Possible backend addition (bug #4, if the persistence route is chosen) to `app/groups/models.py` (`ItemListingPreference`/`Reservation`) plus an Alembic migration.
- **Test updates**: Update `RzeczyViewCategory.test.tsx` (no-action-button assertion must change), add new tests to `test_term_item_listings.py` (owner_party_id assertion), `PanelPage.test.tsx` (refresh-after-confirm, "Później" fallback flow).

### Risk Level: Low-Medium

Bugs #1-#3 are low risk: small, localized, well-supported by existing infra and tests to extend. Bug #4 carries medium risk if a schema/migration change is chosen, given it touches reservation/preference persistence; a frontend-only workaround (re-resolving `term_id` from read notifications) would keep risk low but may be less robust long-term.

---

## Recommendations

This is a **defect-fix task** (modifying existing code with confirmed root causes), so the approach is: fix each bug at its root cause, add regression tests, and verify no unrelated flows break.

1. **Bug #2 (backend, highest confidence fix)**: In `set_item_listing_preference`'s `if existing is not None` branch, add `existing.owner_party_id = profile.party_id` alongside the `mode` update. Add a backend test asserting `owner_party_id` is correctly reassigned after a GIFT/SWAP transaction completes and the new owner re-lists the same item (extend `test_term_item_listings.py`, following the `_register`→`_create_circle_and_term`→...→`confirm_transaction` pattern already used for swap tests).

2. **Bug #3 (frontend, highest confidence fix)**: Add `await load({ silent: true });` immediately after the successful `confirmTransaction(...)` call inside `confirmPendingAction` in `PanelDataContext.tsx`, mirroring the pattern in `withdrawMyPledge`/`saveItemCondition`/`saveItemMeta`. Add a test asserting the items list is re-fetched/updated after confirming via the global modal (extend `PanelPage.test.tsx`'s existing pending-actions-modal test group). Flag (but treat as out of scope unless the user wants it) the secondary structural gap between `useKragGrupy` and `PanelDataContext`.

3. **Bug #1 (frontend)**: In `RzeczyView.tsx`, import `ACTIVE_LOCK_BALANCE_STATUSES` from `../../../api/inventories`, compute `locked = ACTIVE_LOCK_BALANCE_STATUSES.includes(itemBalances[it.id] ?? "AVAILABLE")`, and apply `disabled={locked}`/`aria-disabled={locked}` to the three mode-toggle buttons (mirroring the existing `disabled:opacity-60` styling pattern used for "Zapisz" buttons in the same file). Consider an early-return guard in `setItemMode` as defense in depth. Extend `RzeczyViewCategory.test.tsx` to assert the toggles are disabled when status is `RESERVED`/`IN_TRANSIT`, and enabled otherwise.

4. **Bug #4 (frontend + possible backend, needs a scope decision)**: Recommend starting with the **frontend-only approach (Option A)**: on the locked tile, when a user needs to confirm later, look up notifications by `kind=TERM_CONFIRMATION_NEEDED` without filtering to unread only, re-resolve `term_id` via `parseTermIdFromLinkPath`, and reuse `resolvePendingReservationId` + `confirmTransaction` to wire an "odebrał/nieodebrał rzeczy" button into `RzeczyView.tsx` next to the existing lock badge. This avoids a migration and reuses the already-idempotent, race-safe backend endpoint. If the user later wants a more robust guarantee (notifications could theoretically be deleted/pruned), escalate to Option B — persisting `term_id` on `Reservation` or `ItemListingPreference` via a new Alembic migration. Update `RzeczyViewCategory.test.tsx`'s "no action button" assertion and add a full flow test (dismiss dialog → tile shows fallback action → confirm via tile → transaction resolves) extending `PanelPage.test.tsx`'s existing pending-notification test scaffolding.

5. Since bugs #1 and #4 both modify `RzeczyView.tsx`'s tile UI and interact with the same lock/badge concept, consider implementing them together in the same task group to avoid conflicting UI changes.

---

## Next Steps

Proceed to gap analysis (maister:gap-analyzer) using this report to compare current vs. desired state per bug, then to specification/planning phases to scope the exact fix for bug #4 (Option A vs B) with the user before implementation.
