# Phase 2 Scope Decisions (Gap Analysis Decision Gate)

## Critical decisions

1. **cancel-transaction-route-shape**: New sibling route `POST /api/reservations/{reservation_id}/cancel-transaction`, mirroring the existing `confirm-transaction` route's `{term_id}` body contract.

2. **cancel-transaction-swap-pairing-implementation**: Extract a shared gating/pairing helper (term-ended check, `confirm_race_rules._require_race_participant`, already-resolved guard, SWAP paired-leg resolution) used by both `confirm_transaction` and the new `cancel_transaction`. Each then performs its own terminal action (fulfill vs. cancel) on the returned reservation(s). This keeps the two paths from drifting out of sync on race/pairing correctness — the highest regression-risk spot identified in gap analysis.

3. **term-id-column-nullability-and-scope**: `Reservation.term_id` is **NOT NULL**. Before the migration, audit every `Reservation`-creation call site (including `pledge_fulfillment.py`, which was unverified in gap analysis) to confirm each one has a `term_id` available and passes it through. If a creation path genuinely has no term context, it must be resolved during specification (e.g., is it actually reachable, or dead code) rather than silently defaulting to nullable.

4. **tile-reservation-id-lookup**: Extend `getInventoryItemBalance(s)`'s response shape with a `reservation_id` field, populated for `RESERVED`/`IN_TRANSIT` items. The "Moje rzeczy" tile gets everything it needs (item lock status + the reservation to act on) from the one existing balances call, no second round-trip.

## Important decisions

5. **cancel-button-label**: Use a more descriptive label than the existing "Anuluj" (which is already used in `RzeczyView.tsx` for cancelling the item-condition-edit form) — e.g. "Anuluj wymianę" / "Anuluj rezerwację" — to avoid ambiguity for screen-reader users tabbing through the tile, even though the two buttons never render simultaneously. Exact Polish wording to be finalized during specification (must read naturally next to "Odebrał").

6. **cross-hook-refresh-mechanism**: Use the lower-risk route-focus-triggered approach — `PanelDataContext` re-runs `load({ silent: true })` when the user navigates back to a `/panel/*` route (e.g. after confirming a transaction on `KragGrupyPage`), rather than building a new shared invalidation/event-emitter primitive. No new shared-state mechanism is introduced into the codebase.

## Net effect on scope

Confirmed: this task now includes a new Alembic migration (`Reservation.term_id`, NOT NULL, requires auditing all creation call sites), a new backend use case + route (`cancel_transaction` / `POST .../cancel-transaction`), a shared confirm/cancel gating helper (refactor of existing `confirm_transaction` internals), a balances-endpoint response extension (`reservation_id`), and two new frontend tile actions — on top of the three smaller, independent bug fixes (#1 tile locking, #2 owner_party_id, #3 cache refresh). Risk level remains medium per gap analysis; `RzeczyViewCategory.test.tsx` will need an explicit rewrite of its "no action button" assertions.
