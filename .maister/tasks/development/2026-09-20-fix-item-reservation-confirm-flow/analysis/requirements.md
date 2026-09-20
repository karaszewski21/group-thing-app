# Requirements — Fix reservation locking, re-listing, cache refresh, and pickup confirmation

## Initial description (user, PL)

1. Blokowanie kafla rzeczy w panelu gdy jest zarezerwowany — nie można zmienić wypożyczę/oddam/zamienię.
2. Poprawka błędu — odbiorca po zaszłej transakcji nie może ponownie wystawić wziętej/zamienionej rzeczy; PUT /api/item-listing-preferences/{id} nie ustawia Wypożyczę/Oddam/Zamienię.
3. Problem z cache — gdy dochodzi do wymiany/oddania rzeczy, lista "Moje rzeczy" się nie odświeża.
4. Dodatkowa akcja potwierdzenia wymiany/oddania — jeśli user kliknie "pomiń" (Później), brak innej akcji potwierdzającej. Dodać na zablokowanym kaflu dodatkowy "odebrał/nieodebrał rzeczy", żeby transakcja mogła dojść do skutku.

## Q&A (Phase 1 + Phase 2 + Phase 5)

**Q: term_id source for the fallback confirm/cancel action?**
A: Persist `term_id` on `Reservation` (new NOT NULL column + migration), set at reservation-creation time. Not a frontend notification-replay workaround.

**Q: what does "nieodebrał" mean?**
A: Split into two distinct, clearly-labeled actions: "Odebrał" (confirms — reuses existing confirm_transaction) and "Anuluj wymianę" (NEW — cancels the reservation, releases the item back to AVAILABLE). Covers no-show / forgot-to-exchange scenarios without building a dispute system. Out of scope: dispute/moderation workflow, auto-expiry.

**Q: cancel_transaction route shape?**
A: New sibling route `POST /api/reservations/{reservation_id}/cancel-transaction`, same `{term_id}` body contract as confirm-transaction.

**Q: confirm/cancel code structure?**
A: Shared gating helper (term-ended check, race-participant check, already-resolved guard, SWAP paired-leg resolution) used by both `confirm_transaction` and new `cancel_transaction`; each performs its own terminal action.

**Q: term_id nullability?**
A: NOT NULL. Audit every Reservation-creation call site (including `pledge_fulfillment.py`) to ensure term_id is always available and threaded through.

**Q: backfill for existing Reservation rows predating the migration?**
A: Best-effort backfill from related data (e.g. ItemListingPreference / term_end_scan-derivable eligible term) for active (PENDING/CONFIRMED) reservations; for old FULFILLED/CANCELLED history rows where term_id can't be cleanly derived, a placeholder/nearest-matching value is acceptable since they're no longer touched by confirm/cancel. (Local/dev DB is known to contain throwaway test data — no backward-compat concern for stale rows.)

**Q: tile's reservation_id access?**
A: Extend `getInventoryItemBalance(s)` response with a `reservation_id` field.

**Q: button label collision?**
A: Use "Anuluj wymianę" (not bare "Anuluj") for the new cancel action, distinct from the existing unrelated edit-cancel "Anuluj" button on the same tile.

**Q: cache-refresh mechanism scope?**
A: Fix `confirmPendingAction`'s missing `load({ silent: true })` (primary), AND make `PanelDataContext` re-run `load({ silent: true })` on navigation back to a `/panel/*` route (secondary/structural fix for KragGrupyPage-confirmed transactions), rather than building a new shared invalidation primitive.

**Q: when are the new Odebrał/Anuluj wymianę buttons visible?**
A: Only after the term has ended (mirrors `currentTermHasOccurred` gating already used by `KragGrupyPage`'s "Potwierdź odbiór"). Before term end, a reserved item shows only the existing informational lock badge, toggles disabled, no action buttons yet.

## Similar features / existing code to reuse

- `KragGrupyPage.tsx`'s `confirmActionFor`/`handleConfirmListing`/`currentTermHasOccurred` — direct precedent for term-end-gated persistent confirm actions; the new tile buttons should follow the same gating pattern.
- `confirm_transaction` (`term_item_listings.py:663-746`) — template for the new shared gating helper and `cancel_transaction`.
- `circulation_bridge.cancel_reservation` — existing primitive to build `cancel_transaction` on top of.
- `PanelDataContext.tsx`'s mutate→`load({ silent: true })` pattern (e.g. `withdrawMyPledge`, `saveItemCondition`) — template for the `confirmPendingAction` fix.
- `ACTIVE_LOCK_BALANCE_STATUSES` (`api/inventories.ts`) — already-defined constant to drive toggle-disabling.

## Visual assets

ASCII mockups produced in Phase 4: `analysis/design-context/ascii/ui-mockups.md`, indexed in `analysis/design-context/INDEX.md` (`component:rzeczy-tile-locked`, `component:rzeczy-tile-locked-post-term`).

## Functional requirements summary

1. Disable the three mode-toggle buttons on a "Moje rzeczy" tile whenever the item's balance status is RESERVED or IN_TRANSIT.
2. Fix `set_item_listing_preference` to reassign `owner_party_id` when updating an existing preference row, so a newly-acquired item can be correctly re-listed by its new owner.
3. Fix `confirmPendingAction` to refresh panel data after a successful transaction confirmation; also refresh panel data on navigation back to `/panel/*` routes so cross-page (KragGrupyPage) confirmations are reflected too.
4. Add a `term_id` column to `Reservation` (NOT NULL, backfilled), threaded through all creation call sites.
5. Add a `cancel_transaction` use case + `POST /api/reservations/{id}/cancel-transaction` route, sharing a gating helper with `confirm_transaction`, handling SWAP paired-leg cancellation symmetrically with confirm's paired-leg fulfillment.
6. Extend `getInventoryItemBalance(s)` to return `reservation_id`.
7. Add "Odebrał" and "Anuluj wymianę" buttons to the locked tile, visible only once the reservation's term has ended, calling confirm-transaction / cancel-transaction respectively.
8. Update `RzeczyViewCategory.test.tsx`'s existing "no action button" assertions to reflect the new buttons.
9. Add test coverage for owner_party_id reassignment, cache-refresh-after-confirm, and the new cancel_transaction path (including SWAP pairing).

## Scope boundaries

In scope: all 4 reported bugs + the term_id migration + cancel_transaction + balances extension + tile UI, as detailed above.
Out of scope: dispute/moderation workflow, auto-expiry of unconfirmed reservations, `SpotkaniaView.tsx` and `PanelPage.test.tsx`'s unrelated guest-RSVP changes (existing uncommitted work, untouched).

## Technical considerations

- This task's changes stack on top of the in-progress sibling task `2026-09-17-fix-giveaway-exchange` (uncommitted, phase-10) which already touches `confirm_transaction`'s gating and reservation-resolution in `PanelDataContext.tsx`/`KragGrupyPage.tsx`. Implementation must work against the current (already-modified) file contents.
- `term_id` threading must stay a plain FK-id column per DDD-boundary convention (`standards/backend/models.md`), not a cross-module relationship object.
