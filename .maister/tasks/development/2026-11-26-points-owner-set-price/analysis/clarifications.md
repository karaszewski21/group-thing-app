# Clarifications (Phase 1)

## TL;DR
This task builds a stage-2 slice: config, price bounds, listing for points with an owner-set `points_price`, the ±10 form field, the price on cards and the item page, a HOLD at „Biorę”, a burn plus SALE at confirm, the 5-offer limit and the required photo. The condition correction at pickup (SALE_REFUND) and the 30-day reminder go to a follow-up task. `points_price` gets an R8 exception. A take for points is refused for a family pair or a pair that has used up its limit.

## Key Decisions
- Scope: pricing + listing + settlement. The pickup correction (SALE_REFUND, 3-correction block) and the 30-day reminder move to a follow-up task. — user choice
- `points_price` is visible in public responses, lists and search for POINTS offers only, as an explicit R8 exception (like `attendance_points`). The R8 probe gets an allowlist and architecture.md documents it. — user choice
- Payment: at „Biorę” the price moves into a per-party HELD account after a balance check under the account lock. Confirm burns it and posts SALE to the seller, cancel releases it. `uq_point_accounts_party_id` is widened to `(party_id, account_type)`. — user choice
- 3-correction block (recorded for the follow-up): count the „gorszy stan” corrections on a seller's offers; after 3 the seller cannot list new items for points, and existing offers stay. — user choice
- A pair limit or the family rule that would suppress SALE blocks the POINTS take instead (409 with a message), so burn always equals emission. — user choice
- round10 = Decimal ROUND_HALF_UP (45 → 50), as required by the acceptance case. — derived from acceptance criteria

## Q&A
1. **Scope?** → „Wycena + wystawienie + rozliczenie”: config, price bounds, listing with a price, the ±10 form, the price on cards, „Biorę” with a burn at the buyer and SALE for the seller, the 5-offer limit, the photo. The correction and the reminder are a separate task.
2. **Price on cards vs R8?** → Yes, an exception for `points_price`.
3. **When points leave the buyer?** → Blocked at „Biorę” (HELD), burned at confirm, released on cancel.
4. **What does the 3-correction block mean?** → The seller: after 3 corrections they cannot list for points (applies in the follow-up task).
5. **What if SALE would be suppressed (pair limit or family)?** → The take for points is refused for such a pair.
