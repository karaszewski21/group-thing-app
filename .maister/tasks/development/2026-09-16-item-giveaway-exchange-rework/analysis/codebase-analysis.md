# Codebase Analysis Report

**Date**: 2026-09-16
**Task**: Re-implementation of item giveaway (oddanie) and exchange (zamiana) flows gated on term attendance, with locking, notifications, and first-to-confirm/accept-reject transactions.
**Description**: Two flows: (1) Oddanie — giver lists item; attendee clicks "Chcę wziąć" in a dialog listing giveaway items → locks item in giver's "moje rzeczy". After the term ends, both sides get a notification and a per-tile confirm action; whichever side confirms first triggers the transaction (item moves inventories). (2) Zamiana — either side lists item for exchange; the other party opens a dialog, picks "chcę", supplies own items to offer; first party gets a notification + lock + accept/reject; after term ends, both sides see "Czy doszło do zamiany?" and whichever confirms first triggers the mutual swap. This is a re-implementation/refinement of an existing in-flight, uncommitted WIP (prior task: `.maister/tasks/development/2026-09-14-lending-exchange-mechanism`) that already touches `app.circulation` and `app.groups`.
**Analyzer**: codebase-analyzer skill (4 Explore agents: Backend circulation domain, Backend groups domain + notifications (partial), Notification system (dedicated), Frontend panel/term UI)

---

## Summary

The current uncommitted WIP is a real, reusable foundation — not a prototype to discard — but it implements the *wrong* semantics for the target spec on three specific axes: (1) it auto-confirms both parties at "take" time instead of gating confirmation on term-end with a genuine first-to-confirm race; (2) it has no accept/reject step for exchange proposals, only a unilateral commit; (3) its "term occurred" check blocks taking *after* the term instead of gating finalization to *after* the term ends. The low-level primitives (Reservation, paired SWAP, GIFT type, InventoryBalance locking, ledger posting, the notification system, and the outbox pattern) are solid, tested, and should be built on top of rather than rewritten.

---

## Files Identified

### Primary Files

**`src/backend/app/circulation/domain/reservation_rules.py`**
- Defines confirm/cancel/fulfill authorization rules; `_require_holder_to_confirm` currently makes confirm holder-only (wrong direction for a two-party race); `_require_party_to_reservation` (either party) exists for cancel/fulfill and is the closer precedent for a real race.
- Central place to change for "either party can confirm first" semantics.

**`src/backend/app/circulation/application/reservation_transitions.py`**
- `confirm_reservation` (line ~65), `fulfill_reservation` LEND branch (111-119) and RETURN branch (120-128); `_current_holder_user_id` (37-44) now derives holder via `home_inventory_id`/VIRTUAL inventory instead of reservation history — a bugfix, keep it.

**`src/backend/app/circulation/models.py`**
- `Reservation` (type: LEND|RETURN|SWAP|GIFT; status: PENDING/CONFIRMED/CANCELLED/FULFILLED; `paired_reservation_id` self-FK for SWAP), `InventoryBalance` (AVAILABLE/RESERVED/IN_TRANSIT/LENT/RETURNED), `InventoryItem.home_inventory_id` (new column, line 159-168).

**`src/backend/app/groups/application/term_item_listings.py`**
- `take_item_listing` (273-350) is the current de facto "take" flow: validates term-not-yet-occurred (239, 278 — inverse of target spec's term-end gating), eligibility, balance AVAILABLE, then creates Reservation(s) and **auto-confirms both legs immediately** (304-337) — this auto-confirm is the piece most likely needing rework/removal.
- `_resolve_listing_status` (129-150) derives per-listing status by walking Reservation history — solid pattern to extend, not replace.

**`src/backend/app/groups/models.py`**
- `Term` (131-144): `occurs_on: datetime`, no end/duration field — "ended" is inferred purely as `occurs_on < now()`.
- `TermAttendance` (197-222): `withdrawn_at` nullable = active RSVP; `ItemListingPreference` (225-250): standing, Term-independent per-item mode (LEND/GIFT/SWAP), one row per item, no lock/pending state field of its own.

**`src/backend/app/groups/infrastructure/circulation_bridge.py`**
- Full ACL surface to circulation from groups: `create_reservation`, `create_swap`, `confirm_reservation`, `get_item_balance`, `resolve_owning_inventory`, etc. **No `cancel_reservation`/`reject_reservation` pass-through exists yet** — needed for accept/reject.

**`src/backend/app/groups/infrastructure/notifications_bridge.py`**
- The only file in `app.groups` allowed to import `app.notifications`; exposes `create_notification(db, *, party_id, kind, message, link_path=None)`. Reuse for all new notification kinds.

**`src/backend/app/notifications/models.py`**
- `NotificationKind` enum (35-45): PLEDGE_CREATED, PLEDGE_WITHDRAWN, PLEDGE_ITEM_REGISTERED, NEEDED_ITEM_REMOVED, TERM_ITEM_LISTING_TAKEN. Needs new members for term-ended/accept/reject/confirm-race events.

**`src/backend/app/outbox/service.py`** and **`src/backend/app/notifications/outbox_listener.py`**
- Transactional-outbox pattern (`append`, event-type-string handlers registered via `app.outbox.registry`). Recommended mechanism for any async/decoupled notification triggering (e.g., a scheduled check for term-end), though nothing today reacts to time passing on its own — a scheduler/cron would still be needed to *detect* term-end.

**`src/frontend/src/pages/krag/KragGrupyPage.tsx`** (~1400 lines, duplicated private/public logic)
- Term page rendering "Twoje wystawione rzeczy" and "Rzeczy od innych"; take buttons (445), inline single-`<select>` swap offer picker (419, 810-823 private / 1246-1281 public) — needs upgrading to a real dialog; "Potwierdź odbiór" fulfill buttons (713-723, 757-767, 839-849) are physical-receipt only, not a confirm-race.

**`src/frontend/src/pages/panel/views/RzeczyView.tsx`**
- "Moje rzeczy": only the three standing mode toggle buttons (171-187); **no lock/pending/reserved status indicator anywhere** — net-new work needed here for "item locked, awaiting confirmation".

**`src/frontend/src/hooks/useKragGrupy.ts`** and **`src/frontend/src/api/termItemListings.ts` / `api/reservations.ts`**
- Data/API layer for listing fetch/take/fulfill — reusable as-is for the read side; take/commit semantics will need new endpoints or altered behavior.

### Related Files

**`src/backend/app/circulation/infrastructure/repository.py`, `router.py`, `schemas.py`** — CRUD plumbing, `home_inventory_id`/`product_name` additions; not directly gated by term logic (circulation stays Term-independent by design).

**`src/backend/app/groups/application/attendance.py`** — `_require_term_eligibility` (35), `withdraw_attendance` (50-70); the eligibility gate to reuse for browse/take authorization.

**`src/backend/app/groups/application/pledge_fulfillment.py`** — precedent for the direct/synchronous notification pattern (PLEDGE_ITEM_REGISTERED), useful reference for wiring new notification kinds.

**`src/frontend/src/pages/panel/PanelDataContext.tsx`, `PanelHeader.tsx`** — real notification bell/dropdown UI (state + rendering), generic by message/link_path, no kind-based branching; reuse for new notification kinds without new delivery UI.

**`src/frontend/src/api/notifications.ts`** — `NotificationKind` union is stale (missing `TERM_ITEM_LISTING_TAKEN`); fix regardless, and extend for new kinds.

**`src/frontend/src/pages/panel/views/WypozyczoneView.tsx`** (new, 47 lines) — thin "borrowed items" list with single "Oddaję" action; no dialog, no lock/status display; replaced deleted `PodarkiView.tsx` (was decorative local-state only).

**`src/backend/tests/test_circulation.py`, `test_pledge_fulfillment.py`, `test_term_item_listings.py`, `test_term_item_listings_router.py`** — existing coverage of the primitives being extended; will need new tests for accept/reject and confirm-race paths.

**`src/backend/app/users/router.py`, `tests/test_people_router.py`** — unrelated new endpoint (`by-account-user-id`) supporting `WypozyczoneView.tsx`'s lender display; not part of this feature's core gap but part of the same in-flight branch.

---

## Current Functionality

### Key Components/Functions

- **`Reservation`** (circulation/models.py): the core transaction-intent entity; `ReservationType.GIFT` and `SWAP` already exist as first-class values, `paired_reservation_id` links SWAP legs.
- **`InventoryBalance`**: the de facto "lock" — status transitions away from `AVAILABLE` gate all other reservation attempts (no explicit hold table, no queueing — one Reservation at a time).
- **`take_item_listing`**: today's single-call take-and-auto-confirm flow for both LEND/GIFT (single reservation) and SWAP (paired reservations), gated on term-not-yet-occurred + eligibility + AVAILABLE balance.
- **`_resolve_listing_status`**: derives a listing's displayable status by walking Reservation history — the extension point for new "locked pending confirmation" / "awaiting term-end" states.
- **Notification system**: full DB-backed in-app inbox (model, service, router, outbox listener) already wired end-to-end backend and frontend (bell + dropdown), just missing new `NotificationKind` values and a term-end trigger mechanism.

### Data Flow

1. Item owner sets `ItemListingPreference` (standing mode) via "Moje rzeczy" → persisted immediately, Term-independent.
2. On the term page, other attendees browse eligible listings (`_require_term_eligibility` gates both lister and taker) and call `take_item_listing`.
3. Today: `take_item_listing` synchronously creates Reservation(s) and **auto-confirms** them — collapsing propose+accept into one step, with only a subsequent "Potwierdź odbiór" (physical receipt/fulfill) left for the UI.
4. Target spec instead needs: take/propose → lock + notify → **wait until term end** → both sides get a confirm action → first confirm wins → transaction executes (inventory move / mutual swap) → notify the other side of the outcome. For exchange specifically, an intermediate accept/reject step by the original lister is also required before the lock/notify-at-term-end stage.

---

## Dependencies

### Imports (What This Depends On)

- `app.groups` → `app.circulation` (via `circulation_bridge.py`, the only allowed crossing) for Reservation/Inventory/Balance operations.
- `app.groups` → `app.notifications` (via `notifications_bridge.py`, the only allowed crossing) for creating notifications.
- `app.notifications` → `app.outbox` (via `outbox_listener.py` registering handlers) for the async pledge-notification path.
- Frontend `KragGrupyPage.tsx`/`RzeczyView.tsx`/`WypozyczoneView.tsx` → `api/termItemListings.ts`, `api/reservations.ts`, `api/inventories.ts`, `PanelDataContext.tsx`.

### Consumers (What Depends On This)

- **`term_item_listings.py`**: sole current consumer of `circulation_bridge`'s create_reservation/create_swap/confirm_reservation for the listing-take feature; also the sole caller of `notifications_bridge.create_notification` for `TERM_ITEM_LISTING_TAKEN`.
- **`pledge_fulfillment.py`**, **`pledges.py`**: other consumers of `circulation_bridge`/`notifications_bridge` for the separate pledge feature (precedent pattern, not to be touched).
- **`KragGrupyPage.tsx`** and its public counterpart: sole frontend consumers of the take/browse/fulfill API surface for this feature.

**Consumer Count**: ~4-6 backend application files, 2 large frontend page components, plus hooks/API modules.
**Impact Scope**: Medium — changes are concentrated in `app/groups` (term_item_listings.py, circulation_bridge.py, notifications additions) and two frontend page/view components, not spread across the whole codebase. `app/circulation` itself should stay largely untouched (Term-independent boundary is intentional).

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_circulation.py`**: covers Reservation/SWAP/GIFT primitives, confirm/cancel/fulfill transitions.
- **`src/backend/tests/test_term_item_listings.py`**, **`test_term_item_listings_router.py`**: cover the current take/browse/status flow, including the newly-added auto-confirm behavior.
- **`src/backend/tests/test_pledge_fulfillment.py`**: covers the unrelated but pattern-precedent pledge notification flow.
- **`src/backend/tests/test_people_router.py`** (new/untracked): covers the unrelated `by-account-user-id` endpoint.
- Frontend: **`PanelPage.test.tsx`**, **`PublicKragGrupyPage.test.tsx`**, **`RzeczyViewCategory.test.tsx`** (all modified in WIP).

### Coverage Assessment

- **Gaps**: No tests exist yet for: two-party confirm-race resolution, accept/reject on exchange proposals, term-end-gated confirmation, or "second taker loses" UX/API behavior — all because the underlying behavior doesn't exist yet under the target semantics.

---

## Coding Patterns

### Naming Conventions

- Backend: snake_case functions/modules, PascalCase for SQLAlchemy models and Enums (string-backed, never ordinal, per `.maister/docs/standards/backend/models.md`).
- Frontend: PascalCase components/views (`RzeczyView.tsx`, `KragGrupyPage.tsx`), camelCase hooks (`useKragGrupy.ts`) and API client functions.

### Architecture Patterns

- **Style**: DDD-layered backend (`domain/`, `application/`, `infrastructure/`) behind flat `service.py` facades for `groups`/`circulation` (per user memory: import only from `app.<module>.service`); strict bounded-context ACL via dedicated bridge files (`circulation_bridge.py`, `notifications_bridge.py`) — `app.circulation` must stay Term-independent.
- **Notification delivery**: two established patterns — (1) direct/synchronous `notifications_bridge.create_notification` call inside the same transaction (used for pledges, current listing-take), (2) async outbox-event → listener pattern (used for cross-BC pledge events). Direct pattern is simplest fit for "both parties notified on accept/reject."
- **State Management (frontend)**: page-level state in large page components (`KragGrupyPage.tsx`) plus a shared `PanelDataContext.tsx` for cross-view/panel state (notifications, borrowed items); no Redux/global store beyond context.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count (primary) | ~11 backend + 4 frontend | High |
| Dependencies | circulation ↔ groups ↔ notifications ↔ outbox (all ACL-gated) | Medium |
| Consumers | term_item_listings.py, 2 large page components, panel context | Medium |
| Test coverage | Good on existing primitives; zero on target semantics (race/accept-reject/term-end-gating) | Medium-Low for new behavior |

### Overall: Complex

Not complex because the primitives are missing — they largely exist and are well-factored — but because the required semantic shift (auto-confirm → propose/lock/notify/term-end-gate/first-confirm-race, plus a genuine accept/reject step for exchanges) touches authorization rules, a currently-nonexistent reject pathway, a currently-nonexistent term-end trigger, and matching frontend dialog/status UI across two large, partly-duplicated page components.

---

## Key Findings

### Strengths
- Reservation/SWAP/GIFT/InventoryBalance primitives are solid, tested, and already model both giveaway (GIFT) and exchange (SWAP) as first-class concepts — no need to invent new domain types at the circulation layer.
- Full notification system (model, service, outbox, bell UI) already exists end-to-end; no new delivery mechanism needed, only new `NotificationKind` values and wiring.
- Clear bounded-context ACL discipline (`circulation_bridge.py`, `notifications_bridge.py`) gives an obvious, established place to add new cross-context operations (e.g., `reject_reservation` pass-through).
- The in-flight WIP's `home_inventory_id`/VIRTUAL-inventory holder-tracking fix is orthogonal, correct, and should be kept as-is.

### Concerns
- The just-added auto-confirm-on-take behavior in `take_item_listing` is the opposite of what the target spec needs (propose → separately accept/reject → term-end-gated first-confirm race) and is the single biggest piece likely needing rework or reversion.
- `term.occurs_on < utcnow()` is currently used to *block* taking after a term occurs — inverse of the target's "gate finalization to after term end."
- No reject/decline operation exists anywhere in the stack (backend bridge or frontend UI) — only blunt `cancel_reservation`.
- No mechanism reacts to time passing (no scheduler/cron) — term-end notifications need a new trigger, not just a new NotificationKind.
- Frontend has no "locked/awaiting confirmation" indicator in "Moje rzeczy" (RzeczyView.tsx) and no losing-taker feedback UI for race scenarios — likely also a backend consistency gap (browseListings doesn't reflect a lock until refetch).

### Opportunities
- `_resolve_listing_status`'s history-derived status pattern can be extended (not replaced) to represent new states like "locked, awaiting term-end confirmation."
- `_require_party_to_reservation` (already used for cancel/fulfill, either-party) is a closer starting point than `_require_holder_to_confirm` for genuine two-party confirm-race semantics.
- The direct-notification pattern used for pledges is a ready template for "notify both parties on accept/reject/confirm."

---

## Impact Assessment

- **Primary changes**:
  - `app/circulation/domain/reservation_rules.py` — confirm authorization (holder-only → either-party-first-wins, or a new race-aware rule).
  - `app/groups/application/term_item_listings.py` — replace auto-confirm-on-take with propose/lock flow; add accept/reject for SWAP; add term-end gating for finalization instead of blocking on term-occurred.
  - `app/groups/infrastructure/circulation_bridge.py` — add `reject_reservation`/`cancel_reservation` pass-through.
  - `app/notifications/models.py` (+ migration) — new `NotificationKind` members (proposal, accept, reject, term-ended, confirm-race outcome).
  - A new mechanism to detect/react to term-end (scheduled job or lazy check-on-query) for triggering the confirm prompts/notifications.
  - `src/frontend/src/pages/krag/KragGrupyPage.tsx` — real swap-offer dialog (multi-item pick), accept/reject UI, confirm-race UI with "already taken/too late" feedback.
  - `src/frontend/src/pages/panel/views/RzeczyView.tsx` — lock/pending status indicator per item.
  - `src/frontend/src/api/notifications.ts` — sync stale `NotificationKind` union regardless.

- **Related changes**: `circulation_bridge.py` re-exports, `useKragGrupy.ts` hook additions for new endpoints, possibly `PanelDataContext.tsx` for new borrowed/locked-item derived state.

- **Test updates**: new backend tests for confirm-race, accept/reject, term-end gating; new/updated frontend tests for dialog and status UI (`KragGrupyPage`, `RzeczyView` test files already touched in WIP).

### Risk Level: Medium-High

Risk stems less from technical difficulty of any single change and more from: (1) reverting/reworking just-added auto-confirm behavior without regressing the WIP's legitimate `home_inventory_id` fix, (2) getting the term-end trigger right without a pre-existing scheduler pattern to copy, and (3) two large, duplicated (private/public) frontend page components needing matching dialog/status UI changes.

---

## Recommendations

Since this is a modification of existing, actively-evolving code (not a greenfield build):

1. **Preserve, don't touch, `app/circulation`'s core primitives and the `home_inventory_id`/VIRTUAL-inventory fix** — that WIP slice is orthogonal and correct.
2. **Rework `take_item_listing`'s auto-confirm** into a propose/lock step: creating the Reservation(s) as PENDING (no auto-confirm), notifying the other party, and leaving actual confirmation for a later, term-end-gated step.
3. **Add a reject path**: extend `circulation_bridge.py` with a `reject_reservation`/`cancel_reservation` pass-through distinct from the taker's own cancel, and wire a rejection notification back to the taker.
4. **Change term-gating direction**: keep `_require_term_eligibility` for browse/take eligibility (unchanged), but add a separate, new check that defers confirmation/finalization availability until `term.occurs_on` has passed, rather than blocking take before it.
5. **Confirm-race semantics**: loosen `_require_holder_to_confirm` back toward `_require_party_to_reservation` (either party can confirm), and rely on the existing `BusinessConflictException` on double-confirm as the natural "second confirmer loses" signal — surface that as user-facing feedback in the frontend rather than a generic error.
6. **Notifications**: add new `NotificationKind` members and use the existing direct/synchronous `notifications_bridge.create_notification` pattern (as used for pledges) for both "you got a notification" moments (lock created, term ended, someone confirmed) — reuse the existing bell/dropdown UI verbatim.
7. **Term-end trigger**: since nothing today reacts to time passing, either add a lightweight scheduled job (new, no existing precedent) or compute "eligible to confirm" lazily on each relevant read/action (matching the existing `occurs_on < utcnow()` lazy-check style) — the latter is lower-risk and consistent with current patterns.
8. **Frontend**: build a proper swap-offer dialog (replacing the single `<select>`) with multi-item picking and a trade preview; add lock/status badges to `RzeczyView.tsx`; add accept/reject and post-term-end confirm actions with "too late/already resolved" feedback for the losing side.

---

## Next Steps

Invoke the gap-analyzer to compare this current-state analysis against the detailed target-spec user journeys (oddanie and zamiana flows) and produce a concrete gap list feeding into specification and planning phases.
