# Scope Clarifications (Phase 2)

## TL;DR
All 15 gap-analysis decisions were resolved with the recommended options.
- **Price and listing:** listing for points requires a non-rejected photo uploaded by the owner. „Biorę” carries the price the buyer saw (409 when it has changed). The pair limit and family rule are checked at take, and confirm always posts SALE equal to the HOLD amount. Only the buyer confirms.
- **Ledger:** HOLD, a 4-entry SALE, and RELEASE in the inventory cancel transition. The step comes from `price_step`. Scope also includes POINTS in wants, the search filter, the counters, and the balance in the reservation sheet.

## Key Decisions
- photo-rule: at least 1 photo of the product uploaded by the owner, status other than REJECTED (PENDING allowed).
  - Checked when the POINTS preference is set; the form goes draft → photos → PUT POINTS.
  - A later rejection does not unlist the item.
- price-consent: `ItemTakeRequest.points_price` is required for POINTS; a mismatch with the locked preference returns 409 „Cena zmieniła się — odśwież”.
- pair-family-drift: eligibility, family and pair limit (open POINTS holds of the pair count as used slots) are checked at take. Confirm always posts SALE = HOLD amount.
- who-confirms: the buyer only, like GIFT (`_may_confirm` + action flags). The seller may cancel, which releases the hold. The term/event hand-over queries include POINTS.
- edit-while-reserved: price and mode edits are allowed while reserved; the open reservation settles at its HOLD amount.
- condition-change: a price sent with the change must fit the new bounds (400 naming the range). Without one, the stored price is clamped to the nearest bound.
- buyer-balance-sheet: in scope. `/api/points/me` gains `held`, and `balance` means available. The sheet shows the price, the available balance and the balance after; the button is blocked with a hint when the balance is too low. The server returns 409 on insufficient funds.
- max-offers-count: count all of the owner's POINTS preferences, reserved ones included. Lowering the cap never unlists existing offers. A safe lock order is required.
- step-generalisation: everything uses `price_step`: rounding, min = max(step, …), the ±step stepper.
  - Config validation: 0 < min_ratio ≤ 1 ≤ max_ratio ≤ 3, and the cap is a multiple of the step and ≥ step.
  - If min > max, min = max.
- suggestion-source: the stored `points_value` for an existing item, `item_value_preview` for a new one; one shared bounds function.
- ledger-shape:
  - HOLD (buyer PARTY → buyer HELD).
  - SALE as one 4-entry transaction: HELD −p, BURN +p, EMISSION −p, seller +p. Pair-limited, no reputation.
  - RELEASE (HELD → PARTY).
  - SALE and RELEASE of the same reservation are mutually exclusive.
- wants-offer-mode: add POINTS to `OfferMode`. The matcher is unchanged; run its suite.
- search-filter-and-counts: in scope. A POINTS chip in search, and a POINTS key in every {GIFT, SWAP} counts object; the exact key-set tests are updated deliberately.
- wishlist-bonus-on-sale: no WISHLIST_MATCH on a POINTS sale.
- release-hook-and-snapshot: RELEASE happens in inventory's single cancel transition, via the inventory points_acl. The HOLD row is the price snapshot. `declared_condition` is deferred to the correction follow-up.

## Open Questions / Risks
- Held points stay locked until the term/event date, or indefinitely when nobody resolves the reservation (there is no auto-confirm). This is accepted; the seller can cancel.
- The `max_points_offers` check under the account lock must not reverse confirm's lock order (accounts → items).
- The ledger contract, the R8 probe and architecture.md L488-510 are rewritten deliberately. Migration 0109 needs a runbook and a guarded downgrade.

## Deferred (follow-up task)
- Pickup condition correction + SALE_REFUND (round10(price × mult[new]/mult[declared]), min = step), with a seller-level block after 3 corrections.
- 30-day reminder (price −step or „oddam za darmo”).
