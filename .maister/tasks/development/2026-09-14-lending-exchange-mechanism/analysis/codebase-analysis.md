# Codebase Analysis Report

**Date**: 2026-09-14
**Task**: Full lend/return/exchange-items mechanism gated on Term attendance (RSVP)
**Description**: Cały mechanizm oddania wypożyczenia, zamiany rzeczy. Gdy user zapisał się na zajęcia, ma możliwość wystawienia rzeczy do oddania, wypożyczenia, zamiany rzeczy. Gdy user zapisał się na zajęcia ma możliwość wypożyczyć, wziąć, oraz zamieniać się. (Once a user has RSVP'd/signed up for a class Term, they can list their own items as available to give away/lend/exchange, and can browse and borrow/take/exchange items listed by others.)
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## Summary

The requested "RSVP-gated lend/return/exchange" mechanism does **not exist today**, either as a unified feature or as gating logic anywhere in the stack. Instead, three separate, loosely-related pieces exist: (1) a generic, ungated circulation/points-ledger backend (`app/circulation/`) implementing lend/return/swap/gift via a `Reservation` + `InventoryBalance` state machine with zero awareness of Terms or attendance; (2) a narrower `Term → NeededItem → Pledge → Reservation` bridge (`app/groups/`) where an organizer posts "needed items" for a Term and *any* party (not necessarily an RSVP'd attendee) can pledge to bring one; and (3) a purely decorative, local-only-state frontend UI (Panel's `RzeczyView`/`PodarkiView`, `itemModes`/`gifts`) that shows "Wypożyczę/Oddam/Zamienię" and "Pożyczone/Otrzymane/Zamienione" toggles/tiles with no backend persistence and no cross-user browse capability. Building the requested feature requires: adding a Term-attendance gate somewhere in the authorization path (circulation router/service or the pledge bridge), and building the missing "browse other users' listed items for a Term" capability, since no such endpoint or UI exists anywhere today.

---

## Files Identified

### Primary Files

**`src/backend/app/circulation/models.py`** (272 lines)
- ORM models: `Account`, `AccountType{USER_BALANCE,SYSTEM_EMISSION}`, `Inventory`, `InventoryType{PERSONAL,PICKUP_POINT,VIRTUAL}`, `InventoryItem`, `ItemCondition{NEW,LIKE_NEW,GOOD,FAIR,POOR}`, `InventoryBalance`, `BalanceStatus{AVAILABLE,RESERVED,IN_TRANSIT,LENT,RETURNED}`, `Reservation`, `ReservationType{LEND,RETURN,SWAP,GIFT}`, `ReservationStatus{PENDING,CONFIRMED,CANCELLED,FULFILLED}`, `CirculationTransaction`, `CirculationEntry`, `EntrySide{DEBIT,CREDIT}`.
- This is the generic circulation/points-ledger engine the task's lend/return/swap semantics map onto. Module docstring states it implements `docs/system-wypozyczalni-inventory-accounting.md` verbatim and is deliberately independent of `app.party`/Terms.

**`src/backend/app/circulation/service.py`** (73 lines)
- Flat re-export facade over `application/`/`infrastructure/` — the intended single import surface for other verticals (per the project's DDD-facade convention noted in memory).

**`src/backend/app/circulation/router.py`** (230 lines)
- FastAPI routes: `/api/inventories`, `/api/inventory-items(+/balance)`, `/api/reservations(+/swap,/confirm,/cancel,/fulfill)`, `/api/accounts/{user_id}/balance`, `/api/circulation-transactions`. This is where a Term-attendance gate would most naturally be enforced for direct circulation actions, if that's the design (see Gap Analysis needed on whether gating belongs here or only in the Pledge path).

**`src/backend/app/circulation/schemas.py`** (150 lines)
- Request/response Pydantic models for inventories/items/reservations/swap.

**`src/backend/app/circulation/application/reservations.py`, `reservation_transitions.py`, `inventory_items.py`, `inventory.py`, `accounts.py`, `identity.py`**
- Use cases. `reservation_transitions.py` documents "credit the current holder" fulfillment rule and is the only place `CirculationTransaction`s are created. `inventory_items.py:register_item` is where item listing (give/lend/exchange intent) originates.

**`src/backend/app/circulation/domain/reservation_rules.py`, `constants.py`**
- `_require_party_to_reservation` — the sole authorization predicate gating reservation transitions (must be `reserved_by_user_id` or the item's current holder). No Term/attendance concept. Also holds default 14-day lend period and flat `Decimal("1")` ledger amount.

**`src/backend/app/circulation/infrastructure/ledger.py`, `repository.py`**
- Points-ledger posting (`post_circulation`) and read-side queries.

**`src/backend/app/groups/models.py`** (~lines 131-219)
- `Term` (circle_group_id, occurs_on, description), `NeededItem` (term_id, product_id), `Pledge` (needed_item_id, pledged_by_party_id, `PledgeStatus{OPEN,CLAIMED,FULFILLED,WITHDRAWN}`, loose FK-less `resolved_reservation_id`), `TermAttendance` (term_id, party_id, child_count) — the RSVP record itself. Nothing else in the codebase currently reads `TermAttendance` to gate any circulation action.

**`src/backend/app/groups/application/terms.py`** (212 lines)
- `Term`/`NeededItem` CRUD, organizer-gated.

**`src/backend/app/groups/router/terms.py`** (107 lines)
- `/api/terms`, `/api/needed-items` routes.

**`src/backend/app/groups/application/pledges.py`** (122 lines)
- `create_pledge`/`withdraw_pledge`: any authenticated party with a profile can pledge to bring a `NeededItem` (one active pledge per item, 409 on conflict). **No `TermAttendance` check.**

**`src/backend/app/groups/application/pledge_fulfillment.py`** (112 lines)
- The actual Term→circulation bridge: `fulfill_pledge` registers/reuses an `InventoryItem` and opens a `LEND` `Reservation` addressed to the Term's active organizer (resolved via `Leadership`, not attendance); `sync_pledge_fulfillment` marks the pledge `FULFILLED` once the reservation is confirmed+fulfilled.

**`src/backend/app/groups/router/circles.py`**
- Hosts `POST /api/groups/public/{group_id}/rsvp` (`create_rsvp`, unauthenticated, idempotent per party+term) and `GET /api/groups/mine/attendances` (`list_my_attendances`) — RSVP capture itself. Never touches circulation.

### Related Files

**`src/backend/app/groups/infrastructure/circulation_bridge.py`** (68 lines)
- Anti-corruption layer; the *only* `app.groups` module importing `app.circulation`. Thin pass-throughs: `get_or_create_personal_inventory`, `register_item`, `create_lend_reservation`, `get_reservation`, `get_item`, `get_item_balance`, `get_inventory`. Any new Term-scoped circulation logic likely extends this bridge rather than reaching into `app.circulation` directly (per DDD boundary already established).

**`src/backend/app/groups/infrastructure/product_bridge.py`** (20 lines)
- Anti-corruption layer over `app.product`, validates `NeededItem.product_id`.

**`src/frontend/src/pages/panel/PanelDataContext.tsx`** (~981 lines)
- Loads real `Inventory`/`InventoryItem`/`Term`/`NeededItem`/`Pledge`/`TermAttendance` data via API. `itemModes` (wypożyczę/oddam/zamienię) and `gifts` are plain `useState`, **never persisted, never sent to any API** — explicitly documented as such in the file's own header comment. This is the natural home for wiring real listing-intent state once a backend field/endpoint exists.

**`src/frontend/src/pages/panel/PanelPage.tsx`** (86 lines)
- Top-level view switch; header comment explicitly calls out the item-mode/gifts UI as local-only with no domain-model counterpart.

**`src/frontend/src/pages/panel/panelHelpers.ts`** (88 lines)
- Defines `ItemMode = "wypożyczę"|"oddam"|"zamienię"`, `GiftSource = "pożyczone"|"otrzymane"|"zamienione"`, and style maps — cosmetic types only, not API-backed. Directly maps to `ReservationType{LEND,RETURN,SWAP,GIFT}` on the backend if wired up.

**`src/frontend/src/pages/panel/views/RzeczyView.tsx`** (207 lines)
- Renders "Moje rzeczy" with the wypożyczę/oddam/zamienię toggle (local state only) plus genuine CRUD (edit condition/name/category, delete) that does call the real `/inventory-items` API.

**`src/frontend/src/pages/panel/views/PodarkiView.tsx`** (49 lines)
- Renders local `gifts` array — fully local, no fetch, permanently empty (no producer besides `removeGift`).

**`src/frontend/src/pages/panel/panelComponents.tsx`, `PanelModals.tsx`**
- Shared `ItemQuickAddForm`/`NeededItemQuickAddForm` modal wiring (item registration UI, not browsing).

**`src/frontend/src/hooks/useKragGrupy.ts`** and **`src/frontend/src/pages/krag/KragGrupyPage.tsx`**
- The one real, wired frontend consumer of the Reservation lifecycle: builds `myAvailableItems` (caller's own AVAILABLE items for pledge-fulfil-from-owned-item), and `confirmPledgeReceipt()` drives `confirmReservation → fulfillReservation → syncPledgeFulfillment`. This is Term-scoped (via NeededItems) but only handles the organizer confirming a pledged item hand-off — not general peer-to-peer browsing/lending.

**`src/frontend/src/api/inventories.ts`** (93 lines), **`src/frontend/src/api/reservations.ts`** (61 lines), **`src/frontend/src/api/pledges.ts`**, **`src/frontend/src/api/terms.ts`**
- API clients. Confirmed: **no cross-user browse/search endpoint exists** — `GET /api/inventory-items` requires a specific `inventory_id`, so there is no "browse items available from other users for this Term" call anywhere in the frontend.

**`src/backend/app/core/authorization_matrix.py`**
- Circulation routes are gated by flat role permissions only (`READ`/`EDIT`), no Term- or attendance-scoped requirement:
  ```
  GET  /api/inventories(/.*)?             → READ
  POST /api/inventories(/.*)?             → EDIT
  GET  /api/inventory-items(/.*)?         → READ
  POST /api/inventory-items(/.*)?         → EDIT
  PATCH/DELETE /api/inventory-items/[id]  → EDIT   (fine-grained owner check in service.py)
  GET  /api/reservations(/.*)?            → READ
  POST /api/reservations(/.*)?            → EDIT
  GET  /api/accounts(/.*)?                → READ
  GET  /api/circulation-transactions(/.*)?→ READ
  ```

**`docs/system-wypozyczalni-inventory-accounting.md`**
- **Flag for specification phase**: the "given, unchanged" spec `app/circulation/models.py` claims to implement verbatim. Should be read directly before writing the spec — it may clarify whether Term-scoping was ever intended and simply not built, or was never in scope, and will shape whether Term-gating should live in `app/circulation` or stay confined to `app/groups`.

### Test Files (existing coverage)

- **`src/backend/tests/test_circulation.py`** (236 lines, 12 tests) — ownership-gated PATCH/DELETE on `/api/inventory-items`, condition edits, soft-delete/409-on-unavailable semantics, one `create_reservation` 404-on-deleted-item case. No GET/list tests, no swap/confirm/fulfill-transition tests. Authorization here is purely item-ownership (`inventory.owner_user_id`) — no group/circle/Term concept anywhere.
- **`src/backend/tests/test_pledge_fulfillment.py`** (276 lines, 11 tests) — the Pledge→Reservation bridge: organizer creates circle→Term→NeededItem, guest pledges it, `/fulfill` (new-item or owned-item mode, pledger-only 403 gate), `/sync` flips to FULFILLED. This is the only place a Term enters the circulation flow, purely as upstream context for creating the NeededItem/Pledge — nothing downstream re-checks attendance.
- **Attendance/RSVP tests** (`test_groups.py`, `test_public_term.py`, `test_authorization_matrix.py`, `test_my_attendances.py`, `test_rsvp.py`, `test_account_merge.py`) — none of these touch circulation/inventory/reservation.

---

## Current Functionality

### Item listing (`InventoryItem`)
- `register_item(db, inventory_id, product_id, condition, *, owner_user_id=None)` creates an `InventoryItem` against an `Inventory` + shared `app.product.Product`, plus a 1:1 `InventoryBalance(status=AVAILABLE)`. The only ownership check: if `owner_user_id` is passed it must match `inventory.owner_user_id`.
- Discovery is fully open: `GET /api/inventory-items?inventory_id=` and `GET /api/inventory-items/{id}` require only `READ`, with **no ownership/membership scoping** — but critically, **there is no endpoint to list items across inventories/owners** (only by a specific `inventory_id`), so "browse what others have listed" isn't just ungated — it structurally doesn't exist yet.
- There is no "listing intent" (give away vs. lend vs. exchange) field on `InventoryItem` itself — that distinction lives on `Reservation.reservation_type`, created only when someone reserves the item, not when the owner lists it. This is a structural gap versus the task's request ("wystawienia rzeczy do oddania/wypożyczenia/zamiany" — i.e., the owner declaring intent up front).

### Reservation ("cart" step)
- `create_reservation` takes `item_id`, `reservation_type ∈ {LEND,RETURN,SWAP,GIFT}`, `reserved_by_user_id` (caller-supplied in the body, not derived from the authenticated principal — no check the reserver differs from the owner). Guard: `InventoryBalance.status` must be `AVAILABLE` (or `LENT` for `RETURN`), else 409.
- `create_swap` reserves two items pairwise.

### Lifecycle transitions
- `confirm_reservation`/`cancel_reservation`/`fulfill_reservation(db, reservation_id, acting_user_id)` gate via `_require_party_to_reservation`: `acting_user_id` must be the reservation's `reserved_by_user_id` or the item's current holder — nothing about groups/circles/Terms.
- `fulfill_reservation` is the only place a `CirculationTransaction` is created. `LEND` → balance `LENT` + `due_date`; `RETURN` → back to `AVAILABLE`; `SWAP`/`GIFT` → item's `inventory_id` reassigned to recipient's personal inventory. Always posts a flat `Decimal("1")` points-ledger entry, unconditional of any Term.

### Pledge→Reservation bridge
- `fulfill_pledge` lets a guardian with an existing `Pledge` supply an existing `AVAILABLE` item or register a fresh one, then opens a `LEND` reservation addressed to the Term's *currently active Organizer* (via `Leadership`) — not gated by the pledger's own `TermAttendance`.
- `create_pledge` only checks: caller has a profile, `NeededItem` exists/not soft-deleted, no other active pledge on it. **No `TermAttendance`/RSVP check anywhere in this path.**

### Term-attendance gating: confirmed absent everywhere
- Grep of `app/circulation/` for `TermAttendance|attendance|rsvp|RSVP`: zero matches.
- Grep of `app/groups/` for the same: `TermAttendance` appears only in `models.py`, `router/circles.py` (RSVP endpoint), `service.py`, `infrastructure/repository.py`, `schemas.py`, `application/public_view.py`, `application/account_merge.py` — entirely confined to the public RSVP feature, never touching `Pledge`, `NeededItem`, or the circulation bridge.

### Key Components/Functions

- `InventoryItem` (`models.py:135`): `inventory_id`, `product_id`, `condition`, `added_at`, `deleted_at`.
- `Reservation` (`models.py:181`): `item_id`, `reservation_type`, `reserved_by_user_id`, `paired_reservation_id` (SWAP only), `reserved_at`, `expires_at`, `status`, `notes`. Owner-agnostic — any `users.id` can reserve.
- `register_item(db, inventory_id, product_id, condition, *, owner_user_id=None) -> InventoryItem`
- `create_reservation(db, data: CreateReservationRequest) -> Reservation`
- `create_lend_reservation(db, *, item_id, reserved_by_user_id) -> Reservation`
- `create_swap(db, data: CreateSwapRequest) -> tuple[Reservation, Reservation]`
- `confirm_reservation/cancel_reservation/fulfill_reservation(db, reservation_id, acting_user_id) -> Reservation`
- `_require_party_to_reservation(reservation, holder_user_id, acting_user_id) -> None`
- `fulfill_pledge(db, principal, pledge_id, data) -> Pledge` — the only place Term data touches circulation, and only to find the Organizer, not to gate the pledger.

### Data Flow

1. Owner registers item → `InventoryItem` + `InventoryBalance(AVAILABLE)` in their personal `Inventory`.
2. (Currently, only within the Pledge flow) A guardian pledges a `NeededItem` on a `Term` → `Pledge(OPEN)`.
3. Pledge fulfillment → `fulfill_pledge` registers/reuses an item, opens `LEND` `Reservation(PENDING)` to the organizer.
4. Organizer (via `useKragGrupy.ts`) calls confirm → fulfill → `CirculationTransaction` posted, balance transitions, `Pledge` synced to `FULFILLED`.
5. Generic (non-Pledge) circulation path: any user can `create_reservation`/`create_swap` directly against any `AVAILABLE` item system-wide, with no Term context at all.

### Enum values found
- `ItemCondition`: `NEW`, `LIKE_NEW`, `GOOD`, `FAIR`, `POOR`
- `ReservationType`: `LEND`, `RETURN`, `SWAP`, `GIFT`
- `ReservationStatus`: `PENDING`, `CONFIRMED`, `CANCELLED`, `FULFILLED`
- `BalanceStatus`: `AVAILABLE`, `RESERVED`, `IN_TRANSIT`, `LENT`, `RETURNED`
- `InventoryType`: `PERSONAL`, `PICKUP_POINT`, `VIRTUAL`
- `AccountType`: `USER_BALANCE`, `SYSTEM_EMISSION`
- `EntrySide`: `DEBIT`, `CREDIT`
- `PledgeStatus` (groups): `OPEN`, `CLAIMED`, `FULFILLED`, `WITHDRAWN`

---

## Dependencies

### Imports (What This Depends On)

- `app.circulation` depends on `app.product` (shared `Product` entity referenced by `InventoryItem.product_id`) and the shared `users` table (raw FK-id columns per the DDD cross-module convention). It does **not** import `app.party` or `app.groups`.
- `app.groups.infrastructure.circulation_bridge` depends on `app.circulation.service` (the facade) — the only sanctioned entry point.
- `app.groups.infrastructure.product_bridge` depends on `app.product`.
- Frontend `useKragGrupy.ts` depends on `api/reservations.ts`, `api/pledges.ts`, `api/terms.ts`.
- Frontend `PanelDataContext.tsx` depends on `api/inventories.ts`, `api/terms.ts` (for `TermAttendance` display, not gating).

### Consumers (What Depends On This)

- **`app/groups/application/pledge_fulfillment.py`**: sole consumer of `circulation_bridge` (and thus of `app.circulation`) outside `app.circulation` itself.
- **`src/frontend/src/hooks/useKragGrupy.ts`**: sole real frontend consumer of the Reservation confirm/fulfill lifecycle.
- **`src/frontend/src/pages/panel/views/RzeczyView.tsx`**: consumes `/inventory-items` CRUD (real) plus local-only `itemModes` (cosmetic).
- No other backend vertical touches `app.circulation`.

**Consumer Count**: ~4 files directly wire into circulation (1 backend bridge, 1 backend application module, 2 frontend files with real API calls); the rest of the "consumers" (Panel tiles) are decorative/local-state only.
**Impact Scope**: Medium — the circulation engine itself is small and self-contained, but adding Term-gating touches the router/authorization layer (shared by all consumers) and the one existing bridge, plus requires new endpoints (browse-others'-items) with no existing analog to extend.

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_circulation.py`**: PATCH/DELETE ownership gating, condition edits, delete-only-when-AVAILABLE, soft-delete, 404-on-deleted-item reservation creation.
- **`src/backend/tests/test_pledge_fulfillment.py`**: full pledge→fulfill→sync happy path, pledger-only 403 on `/fulfill`, new-item vs owned-item modes.
- **Attendance/RSVP tests** (`test_rsvp.py`, `test_my_attendances.py`, `test_public_term.py`, etc.): cover RSVP capture in isolation, never intersecting circulation.

### Coverage Assessment

- **Test count**: ~23 tests across the two most relevant files; RSVP has its own separate suite.
- **Gaps**: No test proves or disproves Term-gating of circulation actions — the concept doesn't exist in code or tests today. No tests for `create_swap`, `confirm_reservation`, `fulfill_reservation` in `test_circulation.py` (only indirectly via `test_pledge_fulfillment.py`'s LEND path). No browse/list-across-owners test (feature doesn't exist). No frontend tests found for `RzeczyView`/`PodarkiView`/`useKragGrupy` in the raw findings (worth confirming during planning).

---

## Coding Patterns

### Naming Conventions

- **Backend modules**: `models.py` / `service.py` (facade) / `router.py` / `schemas.py` / `application/*.py` (one file per aggregate/use-case group) / `domain/*.py` (pure helpers) / `infrastructure/*.py` (repository + external posting logic).
- **Cross-module boundaries**: anti-corruption "bridge" modules under `infrastructure/` (e.g., `circulation_bridge.py`, `product_bridge.py`) — the established pattern for any new module needing to reach into `app.circulation` or `app.product`.
- **Enums**: string-backed, PascalCase class names, UPPER_SNAKE members (per project `models.md` standard).

### Architecture Patterns

- **Style**: DDD-flavored microkernel verticals — `app/circulation`, `app/groups`, `app/product` as bounded contexts, each behind a flat `service.py` facade (per project memory: "import from `app.<v>.service` only").
- **State Management (frontend)**: React context (`PanelDataContext.tsx`) mixing real API-backed state and local-only `useState` for not-yet-wired features — an existing precedent for how a "half-built" feature looks in this codebase, useful for recognizing what needs to move from decorative to real.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count (primary) | ~14 backend + ~10 frontend | High |
| Dependencies | circulation ↔ product ↔ groups (via 1 bridge) | Medium |
| Consumers | ~4 real wired consumers, multiple decorative UI surfaces | Medium |
| Test coverage | ~23 backend tests, 0 covering the requested gating/browse behavior | Low (for the target feature) |

### Overall: Complex

This is not a small bugfix or additive endpoint — it requires: (a) deciding where Term-attendance gating belongs (router-level dependency, service-level check, or confined to a new Term-scoped bridge), (b) building a net-new "browse other attendees' listed items for a Term" read path that has no existing analog anywhere in the codebase, (c) adding a "listing intent" concept (give/lend/exchange) that currently doesn't exist on `InventoryItem` at all (only on `Reservation` after the fact), and (d) reconciling/replacing the decorative Panel UI (`itemModes`, `gifts`) with real, persisted, Term-scoped state — likely a different page/flow than the existing generic Panel "Moje rzeczy" view, given the RSVP-gating requirement.

---

## Key Findings

### Strengths
- Solid, tested, reusable circulation primitives already exist (`Reservation`/`InventoryBalance`/ledger) — lend/return/swap/gift state machine and points-ledger posting do not need to be rebuilt.
- A working Term→Pledge→Reservation bridge and anti-corruption-layer pattern (`circulation_bridge.py`) already demonstrate how to safely connect `app.groups` Term context to `app.circulation` without violating the DDD boundary.
- Authorization matrix + `service.py`-level ownership checks provide a clear, established place to add a new gating rule.

### Concerns
- No Term-attendance gating exists anywhere; it must be added net-new, and the design must decide whether it applies to the generic circulation router (broad, risky) or only to a new Term-scoped surface (narrower, safer, but more net-new code).
- No cross-user "browse items" capability exists at all — this is a bigger gap than "add a filter," it's a missing endpoint + missing UI.
- `reserved_by_user_id` in `CreateReservationRequest` is caller-supplied rather than derived from the authenticated principal — a pre-existing trust gap that any new Term-gated flow should not inherit uncritically.
- The Panel's "Wypożyczę/Oddam/Zamienię" and gift tiles are decorative today; users may already perceive this as a working feature from the UI, creating a discrepancy between apparent and actual behavior that the fix must resolve, not just extend.
- `docs/system-wypozyczalni-inventory-accounting.md` is claimed as a verbatim "given, unchanged" spec by `circulation/models.py` — any redesign must reconcile with whatever that document says (or explicitly document a deviation).

### Opportunities
- Extend `circulation_bridge.py` with a Term-scoped "list my item as available for Term X" and "browse items available for Term X" pair of use cases, keeping `app.circulation` itself Term-agnostic (preserving the existing architectural boundary) while `app.groups` owns the gating logic against `TermAttendance`.
- Reuse `ReservationType`/`ItemCondition` enums and the existing confirm/fulfill lifecycle unchanged — only the *authorization* (attendance check) and *discovery* (browse endpoint) are net-new.
- `useKragGrupy.ts`/`KragGrupyPage.tsx` already demonstrates the Term-scoped confirm/fulfill wiring pattern the new browse/borrow UI can follow.

---

## Impact Assessment

- **Primary changes**: `app/groups/infrastructure/circulation_bridge.py` (new Term-scoped use cases), `app/groups/application/` (new module for listing/browsing gated by `TermAttendance`), possibly a new `app/groups/router/` endpoint set, `app/circulation/router.py`/`service.py` only if gating is decided to apply at that layer directly, `PanelDataContext.tsx` + new/rewired frontend view (replacing or extending `RzeczyView.tsx`/`PodarkiView.tsx`) to persist listing intent and add a browse UI.
- **Related changes**: `app/core/auth_deps.py`/`authorization_matrix.py` if a new dependency-based attendance check is introduced; `app/groups/models.py` possibly needs a new field/table if "listing intent" (give/lend/exchange) must live on the item rather than only on the eventual `Reservation`.
- **Test updates**: new backend tests for attendance-gated listing/browsing/reserving (none exist today), new frontend tests for the real (non-decorative) Panel flow if a frontend test suite pattern is adopted per `standards/testing/frontend-testing.md`.

### Risk Level: Medium-High

No attendance-gating exists to build on, so the design decision (gate at generic circulation layer vs. new Term-scoped layer) has broad implications for `app.circulation`'s existing "Term-agnostic, given, unchanged" contract. Getting this boundary wrong risks violating the documented DDD separation or requires deviating from the "given, unchanged" spec doc — both worth surfacing explicitly in specification/gap-analysis before implementation.

---

## Recommendations

Since no existing implementation covers this feature (new capability, not a defect or straightforward extension):

1. **Read `docs/system-wypozyczalni-inventory-accounting.md` before specification** — confirm whether Term/attendance-scoping was ever part of the original "given" design, to avoid contradicting a document `circulation/models.py` claims to implement verbatim.
2. **Keep `app.circulation` Term-agnostic; put the attendance gate in `app.groups`** — consistent with the existing anti-corruption-layer pattern (`circulation_bridge.py`). A new Term-scoped application module (e.g., `app/groups/application/term_items.py`) should: (a) check `TermAttendance` exists for the acting party+term before allowing "list item for this term" or "browse/reserve items for this term," and (b) call into `circulation_bridge` for the actual `register_item`/`create_reservation` mechanics.
3. **Add a "listing intent" concept** — either a new field on `InventoryItem` (or a new lightweight `TermItemListing` join entity linking `Term` + `InventoryItem` + intended `ReservationType`) so items can be declared "available to lend/give/exchange for Term X" *before* someone reserves them — currently intent only exists after-the-fact on `Reservation`.
4. **Build the missing browse endpoint** — a new `GET` (e.g., `/api/terms/{term_id}/available-items`) scoped to attendees of that Term, since no cross-owner browse capability exists anywhere today.
5. **Replace the decorative Panel UI with real, Term-scoped state** — wire `itemModes`/`gifts` (or their replacements) in `PanelDataContext.tsx`/`RzeczyView.tsx`/`PodarkiView.tsx` to the new backend, or introduce a new Term-scoped view following the `KragGrupyPage`/`useKragGrupy` pattern, per the user's known preference (per memory) to port prototype UX faithfully rather than simplify.
6. **Testing strategy**: add backend tests mirroring `test_pledge_fulfillment.py`'s structure (attendee RSVPs → lists item → another attendee browses/reserves → confirm/fulfill), plus explicit negative tests (non-RSVP'd user blocked from listing/browsing/reserving for that Term). No existing test asserts today's *lack* of gating, so these will be genuinely new coverage, not modifications.
7. **Confirm pre-prod status before deciding on backward compatibility** — per project memory, the app is pre-production, so existing decorative Panel state/UI can be freely restructured with no back-compat shims required.

---

## Next Steps

Proceed to gap analysis (`maister:gap-analyzer`) to formally enumerate desired-vs-current state across: (a) where the attendance gate should live, (b) the missing browse/discovery endpoint, (c) the "listing intent" data model gap, and (d) the Panel UI's decorative-to-real transition — using this report as the current-state baseline. The gap analysis should also resolve the open design question of whether direct (non-Pledge) circulation actions (`create_reservation`, `create_swap`) should become Term-attendance-gated in general, or whether gating is scoped only to a new Term-specific listing/browsing surface layered on top of the existing generic engine.
