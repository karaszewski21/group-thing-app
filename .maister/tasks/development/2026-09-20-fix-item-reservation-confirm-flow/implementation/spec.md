# Specification: Fix item-reservation locking, re-listing, cache-refresh, and add fallback confirm/cancel

## Goal
Fix four confirmed bugs in the panel/krag item-reservation and confirm-transaction flow (tile locking, re-listing after a transaction, "Moje rzeczy" cache refresh, and no fallback after skipping the post-term dialog), and add the backend `term_id` persistence + `cancel_transaction` use case needed to support a durable fallback confirm/cancel action on the "Moje rzeczy" tile.

## User Stories
1. As a member with a reserved/in-transit item, I want the mode-toggle buttons on that item's tile disabled, so I can't accidentally change Wypożyczę/Oddam/Zamienię while a transaction is in flight.
2. As a member who just received or was given an item via GIFT/SWAP, I want to be able to re-list that item under my own name afterward, so it doesn't silently vanish from "Moje rzeczy" mode-toggling.
3. As a member who just completed an exchange, I want "Moje rzeczy" to reflect the new state immediately, without a manual page reload.
4. As a member who dismissed ("Później") the post-term "Czy dałeś/otrzymałeś rzecz X?" dialog, I want a persistent way to confirm receipt or cancel the transaction later from the item's own tile, so the exchange isn't stuck forever.

## Core Requirements

1. Disable the three mode-toggle buttons (`Wypożyczę`/`Oddam`/`Zamienię`) on a "Moje rzeczy" tile whenever `itemBalances[item.id]` is `RESERVED` or `IN_TRANSIT`.
2. `set_item_listing_preference`'s update branch must reassign `existing.owner_party_id` to the caller's own party, so a previously-acquired item can be correctly re-listed by its new owner.
3. `confirmPendingAction` must refresh panel data (`await load({ silent: true })`) after a successful transaction confirmation. `PanelDataContext` must also silently reload on navigation back to any `/panel/*` route, so a confirmation made on `KragGrupyPage` is reflected in the panel too.
4. Add a NOT NULL `term_id` column to `Reservation`, set at creation time on every reachable creation path (with one exception noted in Technical Approach), backfilled for existing rows.
5. Add a `cancel_transaction` use case and `POST /api/reservations/{reservation_id}/cancel-transaction` route, sharing a gating helper with `confirm_transaction`, correctly cancelling both legs of a SWAP together.
6. Extend `getInventoryItemBalance(s)`'s response with a `reservation_id` field so the tile has what it needs to call confirm/cancel without a second round-trip.
7. Add "Odebrał" and "Anuluj wymianę" buttons to a locked ("Moje rzeczy") tile, visible only once the reservation's term has ended, calling confirm-transaction / cancel-transaction respectively.
8. Update `RzeczyViewCategory.test.tsx`'s existing "no action button" assertions to match the new locked-tile behavior.
9. Add regression test coverage for `owner_party_id` reassignment, cache-refresh-after-confirm, and `cancel_transaction` (including SWAP pairing).

## Visual Design

Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to the UI task groups touching `RzeczyView.tsx`.

- `screen:rzeczy-tile-baseline` / `screen:rzeczy-tile-available` (`analysis/design-context/ascii/ui-mockups.md#baseline`, `#available-after-fix`): current/`AVAILABLE`-state tile, unchanged by this task — reference only.
- `component:rzeczy-tile-locked` (`#component-rzeczy-tile-locked`): `RESERVED`/`IN_TRANSIT`, term **not yet** ended — mode toggles disabled (`disabled` + `aria-disabled` + `disabled:opacity-60`), existing `lockBadgeLabel()` badge shown, **no** new buttons yet (Bug #1 only).
- `component:rzeczy-tile-locked-post-term` (`#component-rzeczy-tile-locked-post-term`): `RESERVED`/`IN_TRANSIT`, term **has** ended — same disabled toggles + badge, plus two new buttons rendered immediately after the badge inside the existing `<div className="mt-2 flex flex-wrap gap-1.5">` row: "Odebrał" (primary/`bg-mint` pill, same visual weight as the tile's existing "Zapisz" buttons) and "Anuluj wymianę" (tertiary pill with a `text-danger`/`hover:bg-danger-soft` accent — explicitly **not** the bare "Anuluj" ghost-pill style already used by the name/condition inline-edit forms on the same tile, to avoid a label/style collision).

Fidelity: ASCII layout mockups, ~component-level fidelity (exact Tailwind classes named per element, not full visual mockups) — sufficient for a Tailwind-utility-class implementation with no separate design pass needed. Row order and gating logic (locked-only vs. locked-and-term-ended) are binding; exact pixel spacing is not.

Accessibility (binding, per `standards/frontend/accessibility.md`): disabled toggles need both the native `disabled` attribute and `aria-disabled="true"`; the two new buttons must have full-word visible text labels (no icon-only buttons) and sit in DOM/tab order immediately after the badge.

## Reusable Components

### Existing Code to Leverage

- **`ACTIVE_LOCK_BALANCE_STATUSES`** (`src/frontend/src/api/inventories.ts:87`) — already-exported constant (`["RESERVED", "IN_TRANSIT"]`); drives Bug #1's `disabled` condition directly, no new constant needed.
- **`itemBalances`** local state in `RzeczyView.tsx` (already fetched via `getInventoryItemBalances`) — reused as the source for both the disabled condition and, once extended, the new `reservation_id`.
- **`disabled:opacity-60` convention** (`RzeczyView.tsx:144`, `:189`, the "Zapisz" buttons) — the project's established disabled-button treatment; applied to the mode-toggle buttons for Bug #1 and used as the "Odebrał" button's base style.
- **`confirm_transaction`** (`src/backend/app/groups/application/term_item_listings.py:663-745`) — already idempotent, race-safe, SWAP-paired-leg-aware. Its gating logic (term-ended check, `_resolve_transaction_holder_user_id`, `confirm_race_rules._require_race_participant`, already-resolved guard, SWAP pairing via `paired_reservation_id`) is extracted into a shared helper reused by both `confirm_transaction` and the new `cancel_transaction` (see Technical Approach).
- **`circulation_bridge.cancel_reservation`** (`src/backend/app/circulation/application/reservation_transitions.py:76-93`, exposed via `circulation_bridge`) — the terminal primitive `cancel_transaction` calls per leg, after the shared gating helper resolves which reservation(s) to act on. Its own status guard (`PENDING`/`CONFIRMED` allowed) already matches `_ACTIVE_RESERVATION_STATUSES`, so no change needed there.
- **`confirm_race_rules._require_race_participant`** (`src/backend/app/groups/domain/confirm_race_rules.py`) — reused as-is by the shared gating helper.
- **`PanelDataContext.tsx`'s mutate → `await load({ silent: true })` pattern** (e.g. `withdrawMyPledge` at line 575, `saveItemCondition`/similar handlers) — template for both the `confirmPendingAction` fix and the new `cancelPendingAction`-equivalent flow.
- **`KragGrupyPage.tsx`'s `currentTermHasOccurred()` (line 726) / `confirmActionFor()` (line 712) / `handleConfirmListing()` (line 733)** — direct precedent for term-end gating and the confirm-call pattern; the new tile buttons mirror this rather than inventing a new pattern.
- **`api/reservations.ts`'s `confirmTransaction`** (line 79) — reused unmodified by "Odebrał"; its sibling `cancelTransaction` (new) mirrors its shape exactly (`{ term_id }` body, same response shape).
- **Existing Alembic migration conventions** (`src/backend/alembic/versions/0030`-`0033`) — sequential numeric prefix, explicit-sequence PK pattern, `standards/backend/migrations.md`'s small-focused-change guidance; the new migration is `0034_reservation_term_id.py`.

### New Components Required

- **`Reservation.term_id` column** (backend model + Alembic migration): no existing column or derivable-at-read-time value serves this — `term_id` for a reservation is currently only ever transiently present inside a dismissed notification's `link_path` (see `codebase-analysis.md`'s Data Flow section), which is exactly the fragility the user rejected (Phase 1 decision). New, persisted, NOT NULL FK-id column is required.
- **`cancel_transaction` use case + route**: no cancel path exists today with the shared-gating/SWAP-pairing/already-resolved semantics `confirm_transaction` has; `circulation_bridge.cancel_reservation` alone only cancels one leg and uses a different (looser) authorization gate. New use case required, built on the extracted shared gating helper.
- **Shared confirm/cancel gating helper** (new private function in `term_item_listings.py`, e.g. `_resolve_transaction_reservations_for_action`): factored out of `confirm_transaction`'s current inline logic (term-ended check, holder resolution, race-participant check, already-resolved guard, SWAP-pair resolution) so `cancel_transaction` cannot drift out of sync with `confirm_transaction` on race/pairing correctness — the highest regression-risk spot per gap analysis. Justification for extracting rather than duplicating: `confirm_transaction`'s existing SWAP-pairing logic (lines 729-743) is intricate (holder-vs-counterparty resolution per leg) and a second independent copy in `cancel_transaction` would be the exact kind of "two paths drift apart" risk the scope decision explicitly called out.
- **"Odebrał" / "Anuluj wymianę" tile buttons + `termHasEnded(itemId)` gating** in `RzeczyView.tsx`: no existing UI in this view surfaces a confirm/cancel action; `KragGrupyPage.tsx`'s equivalent lives on a different page against a different data shape (`BrowseTermItemListingResponse` rows, not inventory-item tiles) and cannot be reused directly, only its pattern.
- **`reservation_id` field on `InventoryBalanceResponse`** (backend) and `getInventoryItemBalance(s)`'s return type (frontend): the balance endpoint currently returns only `status`/timestamps; the tile has no other source for the reservation id needed to call confirm/cancel without a second lookup (per scope decision 4, extending balances was chosen over a `PanelDataContext`-style client resolution).

## Technical Approach

### Bug #1 — Tile locking (frontend only, no backend change)
In `RzeczyView.tsx`, compute `const locked = ACTIVE_LOCK_BALANCE_STATUSES.includes(itemBalances[it.id] ?? "AVAILABLE")` per item inside the render loop (`itemBalances` is already fetched) and apply `disabled={locked}` + `aria-disabled={locked}` + a `disabled:opacity-60 disabled:cursor-not-allowed` class to each of the three `ITEM_MODES.map(...)` buttons (currently `RzeczyView.tsx:214-229`). Optionally add a defense-in-depth early-return guard in `usePanelData()`'s `setItemMode` for the same locked condition — cheap and consistent with treating the client-side disable as UX, not the sole guard (the backend already blocks a `set_item_listing_preference` availability change implicitly via its own balance checks in the take/propose paths, though not the preference-set path itself, which is intentionally availability-independent per that function's own docstring — worth noting but not a gap this task needs to close).

### Bug #2 — Re-listing after transaction (backend only)
In `set_item_listing_preference` (`src/backend/app/groups/application/term_item_listings.py:115-117`), the `if existing is not None:` branch currently only does `existing.mode = mode.value`. Add `existing.owner_party_id = profile.party_id` alongside it, so a reused preference row is correctly reattributed to whoever currently owns the item (the caller, already ownership-checked earlier in the same function via `resolve_owning_inventory`).

### Bug #3 — Cache refresh (frontend only)
1. **Primary fix**: in `confirmPendingAction` (`PanelDataContext.tsx:717-747`), add `await load({ silent: true });` immediately after the successful `await confirmTransaction(...)` call (before `dismissPendingAction`), matching every sibling mutation handler's convention.
2. **Structural fix**: `PanelDataContext` gains a route-focus-triggered silent reload — an effect that watches the current route (via `useLocation` from `react-router-dom`, not currently imported in this file — `useParams`/`useNavigate` already are) and calls `load({ silent: true })` when the pathname transitions onto a `/panel/*` route (e.g. on mount at a panel route, and on re-entry after navigating away and back — e.g. from `KragGrupyPage` and back). This is the lower-risk option chosen in scope-clarifications over a new shared invalidation/event-emitter primitive; it does not fix `KragGrupyPage`'s own staleness (out of scope — that page owns its data via `useKragGrupy`, unaffected here) but ensures the panel reflects term-page confirmations once the user navigates back to it.

### Bug #4 — Fallback confirm/cancel action

**1. `Reservation.term_id` (migration `0034_reservation_term_id.py`)**
- New `term_id: Mapped[int]` column on `Reservation` (`src/backend/app/circulation/models.py:191-224`), plain FK-id column (`ForeignKey("terms.id", ...)`, no ORM relationship object) per `standards/backend/models.md`'s DDD cross-module-reference convention — this keeps `circulation` from taking on an ORM-level dependency on `app.groups`'s `Term` model, only a raw integer FK.
- NOT NULL, per scope-clarifications decision 3.
- **Creation-site audit** (all `Reservation(...)` constructions):
  - `circulation/application/reservations.py::create_reservation` (line 40) / `create_swap` (lines 86, 94) — both take `term_id` as a new required field on `CreateReservationRequest`/`CreateSwapRequest` (`circulation/schemas.py`).
  - `create_lend_reservation` (line 60-71) gains a `term_id: int` keyword parameter, threaded through to `create_reservation`.
  - **`term_item_listings.py::take_item_listing`** (line 394): `term.id` is already resolved (`data.term_id` at line 352) — pass it through.
  - **`term_item_listings.py::propose_swap`** (line 472) and **`accept_swap_proposal`** (line 543): `term_id`/`term.id` already resolved in both — pass through.
  - **`pledge_fulfillment.py::fulfill_pledge`** (line 79, `create_lend_reservation` call): `term` is already resolved at line 49 (`term = await get_term(db, needed_item.term_id)`) — pass `term.id` through. This closes the "unverified" gap flagged in gap analysis; confirmed reachable and has term context available.
  - **`PanelDataContext.tsx::returnBorrowedItem`** (line 1170, via `POST /api/reservations` → `circulation.router.create_reservation` → `circulation/application/reservations.py::create_reservation`, `reservation_type="RETURN"`): **newly identified during specification** (not flagged in Phase 1/2 analysis) — this is a real, reachable creation path with **no Term context at all**. A `RETURN` reservation reverses a specific prior `LEND`, so its `term_id` is resolved **server-side**, not caller-supplied: `create_reservation` internally looks up the item's most recent `LEND`-type `Reservation` (already resolvable the same way `_resolve_listing_status` finds the "chosen" reservation for an item) and reuses that `Reservation`'s `term_id`. This is the correct semantic (a return belongs to the same term-scoped exchange as the loan it reverses) and avoids inventing a sentinel/fake term. `CreateReservationRequest.term_id` becomes optional at the schema level specifically for the `RETURN` type (server derives it); required and caller-supplied for every other type.
  - **`POST /api/reservations/swap`** (`circulation/router.py:166`, `CreateSwapRequest`): grep-confirmed **no live frontend caller** (`createSwap` is exported from `api/reservations.ts` but never invoked). `term_id` is still added as a required field on `CreateSwapRequest` for schema/DB consistency (the NOT NULL constraint requires it regardless of whether the route is called) — purely mechanical, zero behavior-risk since unreachable today. Flagged here rather than silently reclassified as "dead code to delete" — deletion is out of scope for a bugfix task.
- **Backfill** (data migration, same Alembic revision or a paired one): for existing rows with `status IN ('PENDING', 'CONFIRMED')`, best-effort derive `term_id` from the same data `term_end_scan.py` already uses to resolve term-eligible listings for an item (i.e., resolve via the item's `ItemListingPreference` and the owning Circle's current/most-recent `Term`); for `FULFILLED`/`CANCELLED` historical rows where a clean derivation isn't available, backfill with the nearest-matching `Term` by date (acceptable per Phase 1 clarification — local/dev data is disposable and these rows are never read by `confirm_transaction`/`cancel_transaction` again since both are gated on active-status reservations).

**2. Shared gating helper + `cancel_transaction`**
- Extract `confirm_transaction`'s current inline sequence (`term_item_listings.py:681-728`, up to and including SWAP-pair resolution at 729-743) into a shared helper that returns the list of reservation(s) to act on (one, or two for a resolved SWAP pair) after: term-ended check, `_resolve_transaction_holder_user_id`, `confirm_race_rules._require_race_participant`, and the already-resolved guard (raising `TermAlreadyResolvedException`).
- `confirm_transaction` keeps its own terminal step (`confirm_reservation` + `fulfill_reservation` per resolved reservation, using each one's own `physical_holder_user_id`).
- New `cancel_transaction(db, principal, reservation_id, term_id)` calls the same shared helper, then calls `circulation_bridge.cancel_reservation` for each resolved reservation (mirroring confirm's per-leg pattern) instead of confirm+fulfill.
- New route `POST /api/reservations/{reservation_id}/cancel-transaction` in `term_item_listings.py` router, same request/response shape as `confirm-transaction` (`ConfirmTransactionRequest`/new `CancelTransactionRequest` — likely identical `{term_id: int}` shape, can share the request model; response needs its own `CancelTransactionResponse` or a shared shape with a `status`/`already_resolved` discriminator matching `ConfirmTransactionResponse`'s existing pattern), same `TermAlreadyResolvedException` → 409 mapping.

**3. `reservation_id` on balances**
- `InventoryBalanceResponse` (backend `circulation/schemas.py`) gains `reservation_id: int | None`, populated (for `RESERVED`/`IN_TRANSIT` statuses) from the same reservation-resolution logic `_resolve_listing_status`/the balance's own active-reservation lookup already uses at the `InventoryBalance` level — resolved once per item, no new query pattern.
- Frontend `InventoryBalanceResponse`/`getInventoryItemBalances` (`api/inventories.ts`) return type gains `reservation_id`, and the return shape of `getInventoryItemBalances` changes from `Record<number, BalanceStatus>` to `Record<number, { status: BalanceStatus; reservationId: number | null }>` (or an equivalent typed tuple) — `RzeczyView.tsx`'s existing `itemBalances[it.id]` usages update accordingly.

**4. Tile buttons**
- In `RzeczyView.tsx`, alongside the existing `lockBadgeLabel(...)` rendering (line 230-245), add a `termHasEnded` check for the item's active reservation, mirroring `KragGrupyPage.tsx`'s `currentTermHasOccurred()` — resolved from the reservation's term (needs the term's `occurs_on`, fetched once per distinct term among the locked items, same bounded-fetch pattern as `itemBalances` itself, not per-row).
- When `locked && termHasEnded`, render "Odebrał" (`onClick` → reuse the existing confirm-transaction call path, same underlying `confirmTransaction(reservationId, { term_id })` client call `KragGrupyPage.tsx`/`PanelDataContext.confirmPendingAction` already use) and "Anuluj wymianę" (`onClick` → new `cancelTransaction(reservationId, { term_id })` client call in `api/reservations.ts`, mirroring `confirmTransaction`'s shape).
- Both actions, on success, must trigger the same `load({ silent: true })` refresh as Bug #3's fix (they mutate the same panel data).

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group; test verification runs only new/affected tests, not the entire suite, per orchestrator convention.
- Suggested groupings (mirroring the natural task-group split — bugs #1-#3 are low-risk and independent of #4's larger surface, per gap analysis's own recommendation to implement/commit them first):
  - **Bug #2 backend**: extend `test_term_item_listings.py` with a test asserting `owner_party_id` is reassigned after a GIFT/SWAP `confirm_transaction` completes and the new owner re-lists the same item — follow the existing `_register` → `_create_circle_and_term` → ... → `confirm_transaction` fixture chain already used for swap tests.
  - **Bug #3 frontend**: extend `PanelPage.test.tsx`'s pending-actions-modal test group with a test asserting a second data-refresh call (e.g. `getInventoryItems`/list-content change) after confirming via the global modal; add a route-focus reload test if feasible within existing render-with-providers/router test setup.
  - **Bug #1 frontend**: extend `RzeczyViewCategory.test.tsx` to assert the three toggle buttons are `disabled`/`aria-disabled` when status is `RESERVED`/`IN_TRANSIT`, and enabled for `AVAILABLE`.
  - **Bug #4 backend (migration + cancel_transaction)**: new tests in `test_term_item_listings.py` for `cancel_transaction` — happy path (single LEND/GIFT reservation released to `AVAILABLE`), SWAP paired-leg cancellation (both legs released together), already-resolved race (loser gets 409-equivalent), race-participant rejection (non-party gets `AccessDeniedException`), term-not-ended rejection. Add/extend a test asserting `create_reservation`/`create_lend_reservation` reject a missing `term_id` for non-RETURN types and that `RETURN` correctly derives it from the prior LEND leg.
  - **Bug #4 frontend**: rewrite `RzeczyViewCategory.test.tsx`'s existing "no action button" assertions (currently asserting absence) to assert "Odebrał"/"Anuluj wymianę" render only when locked AND term-ended, and are absent when locked but term not yet ended; extend `PanelPage.test.tsx`'s pending-notification scaffolding with a full flow test (dismiss dialog → tile shows fallback buttons → confirm or cancel via tile → transaction resolves, panel refreshes).

### Standards Compliance
- `standards/backend/models.md`: `term_id` as a plain FK-id column (no ORM relationship) across the `circulation`↔`groups` bounded-context boundary; NOT NULL with explicit-sequence PK convention preserved (`Reservation` already extends `BaseEntity`, unaffected).
- `standards/backend/migrations.md`: new migration `0034_reservation_term_id.py`, small and focused (schema addition + backfill data migration, reversible), following the sequential-numeric-prefix convention of `0030`-`0033`.
- `standards/backend/queries.md`: `reservation_id`/term-end resolution for tile buttons stays a bounded, single-batched lookup (no per-row N+1), matching the existing `getInventoryItemBalances`/`itemBalances` pattern.
- `standards/backend/api.md`: new `POST /api/reservations/{reservation_id}/cancel-transaction` follows the existing verb-suffix sibling-route convention of `confirm-transaction`.
- `standards/frontend/accessibility.md`: `disabled` + `aria-disabled` on toggles; full-word text labels (no icon-only) on the two new buttons; text-carried (not color-only) status communication, consistent with the existing lock badge's `role="status"` pattern.
- `standards/frontend/components.md`: new tile-local state (`termHasEnded`, extended `itemBalances` shape) stays local to `RzeczyView.tsx`, not lifted into `PanelDataContext`, consistent with the existing comment justifying `itemBalances`'s current placement.
- `standards/global/minimal-implementation.md`: no speculative abstraction — the shared gating helper is justified by an existing, concrete second caller (`cancel_transaction`), not built preemptively for hypothetical future use.
- `standards/testing/backend-testing.md` / `standards/testing/frontend-testing.md`: 2-8 tests per feature, existing fixture-chain and `renderWithProviders`/`vi.mock` conventions reused throughout.

## Out of Scope
- Dispute/moderation workflow for contested "who actually didn't show up" scenarios.
- Auto-expiry of unconfirmed reservations.
- `SpotkaniaView.tsx` and `PanelPage.test.tsx`'s unrelated guest-RSVP changes (existing uncommitted work on the same branch, untouched by this task).
- Building a shared cross-page invalidation/event-emitter primitive between `PanelDataContext` and `useKragGrupy` (the route-focus reload is the chosen lower-risk alternative).
- Deleting the unreachable `POST /api/reservations/swap` route/`create_swap` path — only its schema is updated for NOT NULL consistency; removal is a separate cleanup decision.

## Success Criteria
- A "Moje rzeczy" tile with `RESERVED`/`IN_TRANSIT` status cannot have its mode toggled via the UI (buttons disabled, `aria-disabled` present).
- After a GIFT/SWAP transaction completes, the new owner can re-list the same item and it appears correctly under their own "Moje rzeczy" (`owner_party_id` matches).
- "Moje rzeczy" reflects a just-completed transaction without a manual reload, both when confirmed via the panel modal and when confirmed on `KragGrupyPage` and navigated back to.
- Every `Reservation` row created going forward has a non-null `term_id`; existing rows are backfilled; the migration applies and rolls back cleanly.
- `cancel_transaction` correctly releases a single LEND/GIFT reservation, or both legs of a SWAP together, back to `AVAILABLE`, respects the same race/already-resolved rules as `confirm_transaction`, and only the party's counterpart or the acting party can invoke it.
- On a locked tile, once the reservation's term has ended, "Odebrał" and "Anuluj wymianę" are visible and functional; before term end, only the existing lock badge shows.
- All new and updated tests pass; `RzeczyViewCategory.test.tsx`'s rewritten assertions match the new locked-tile behavior in both pre- and post-term-end states.
