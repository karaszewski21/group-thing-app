# Requirements: POINTS mode (stage 2, part 1) with an owner-set price

## TL;DR
This task builds the first part of POINTS mode:
- **Pricing:** four `points_config` keys and price bounds around the suggested `points_value`, with server validation, round-half-up, the step taken from `price_step`, and a 400 that names the allowed range.
- **Listing and display:** listing for points (owner photo required, max 5 offers), the ±step form, and the price on cards and the item page (an R8 exception).
- **Reservation and settlement:** „Biorę” with a HOLD and consent to the price, then a 4-entry SALE at confirm (buyer only) or a RELEASE on cancel.
- **Elsewhere:** search filter, counts, wants offer_mode, and available/held balance in the reservation sheet and on /points.

The pickup correction (SALE_REFUND) and the 30-day reminder are deferred.

## Key Decisions
- All Phase 1 and Phase 2 decisions are recorded in `analysis/clarifications.md` and `analysis/scope-clarifications.md`. This file only adds the Phase 5 confirmations.
- POINTS works in all three reservation contexts (term, event, personal pickup), like GIFT.
- Implementation reuses the GIFT path and the stage-1 ledger primitives.

## Initial description (user, Polish, verbatim intent)
„Cena POINTS ustalana przez właściciela (zastępuje „tylko obniżenie o poziom”)”:
- **Price setting:**
  - suggested_price = snap(base[size_class] × multiplier[condition]).
  - points_price lies between min = max(10, round10(s × price_min_ratio 0.5)) and max = min(price_cap 100, round10(s × price_max_ratio 1.5)), in steps of 10.
  - The server validates it and answers 400 with the range.
- **Form:** ±10, with the suggestion shown in the form only. Cards and the item page show only points_price.
- **Correction at pickup:** the „gorszy stan” correction and SALE_REFUND are **deferred**.
- **Unchanged:** burn = emission, max_points_offers = 5, pair limit, family rule, photo required. The 3-correction block and the 30-day reminder are **deferred**.
- **Config:** price_min_ratio, price_max_ratio, price_cap, price_step.
- **Acceptance:**
  - s = 40 → 20–60; s = 60 → 30–90; nothing above 100.
  - 55 is rejected.
  - The correction example 90 → 50 (refund 40) is deferred, but `corrected_price` arithmetic may be unit-tested if the domain function is added.

## Q&A (Phase 5)
1. **User journey.** Owners choose „Za punkty” on /add, or switch the mode in My Items and edit. Buyers find offers through search (filter), owner or organization pages and the item page. Reservation works in all contexts: term, event and personal pickup. Guests see the price; „Biorę” opens login (AuthSheet). → Confirmed.
2. **Code reuse.**
   - POINTS follows the GIFT path (take → buyer confirms).
   - Settlement via `award_exchange`/`lock_accounts`/`post_points`.
   - The reservation sheet is a `ModalSheet` like `PersonalPickupSheet`.
   - The stepper follows the `parseCapacity` integer-input rule (validation.md).
   - The admin ratios copy `MultiplierField`/`parseMultiplier`.
   → Confirmed.
3. **Visual assets.** Only the 8 Phase-4 mockups are binding (`analysis/design-context/INDEX.md`). → Confirmed.

## Functional requirements
1. **Config.**
   - Add `price_min_ratio` and `price_max_ratio` as Numeric(4,2), seeded 0.50 and 1.50; `price_cap` as int, 100; `price_step` as int, 10.
   - Admin GET/PUT validation:
     - 0 < min_ratio ≤ 1 ≤ max_ratio ≤ 3
     - the cap is a multiple of the step and at least the step
     - Polish 400 messages
   - The admin page gets an un-dimmed „Oferty „za punkty”” section with a live example.
2. **Price domain** (pure, in `app/points/domain`). With `round_step(x) = Decimal ROUND_HALF_UP to a multiple of step`:
   - `bounds(s) = (max(step, round_step(s × min_ratio)), min(cap, round_step(s × max_ratio)))`
   - if min > max, then min = max
   - `validate_price(p)` requires min ≤ p ≤ max and p % step == 0
   - Expose the bounds through `GET /api/points/item-value` (price_min, price_max, price_step); the suggestion source is `points_value`.
3. **Listing for POINTS.**
   - `ReservationType.POINTS`, `MovementType.POINTS`, `ExchangeMode`/`ListingMode`/`OfferMode` gain POINTS.
   - `item_listing_preferences.points_price` is a nullable smallint, with a CHECK that mode = POINTS ⇔ price NOT NULL.
   - Set on create (`listing_mode`) and via PUT `/api/item-listing-preferences/{id}` with `points_price`.
   - Validated against the bounds (400 „Cena musi być od {min} do {max} pkt, co {step}.”).
   - Requires at least one owner photo that is not REJECTED (400).
   - The `max_points_offers` cap counts every POINTS preference of the owner, reserved ones included (409).
   - A condition or category change re-validates a price sent with it, or clamps the stored price.
   - Edits are allowed while reserved.
4. **Visibility (R8 exception).**
   - `points_price` appears for POINTS offers in public details, actions, search product meta, owner/organizer/event item cards and my reservations.
   - The R8 probe gets an allowlist for `points_price`; architecture.md documents the exception.
5. **Take (HOLD).**
   - `ItemTakeRequest.points_price` is required for POINTS; a mismatch returns 409 „Cena zmieniła się — odśwież.”.
   - Under the account lock in party-id order, the take checks:
     - eligibility
     - family (409)
     - pair limit, with open POINTS holds of the pair counting as used slots (409)
     - available balance ≥ price (409 „Za mało punktów.”)
   - It then posts HOLD (buyer PARTY → buyer HELD).
   - The lock order must stay consistent with confirm.
6. **Confirm (SALE).**
   - Buyer only (`_may_confirm` + action flags).
   - One 4-entry SALE transaction: HELD −p, BURN +p, EMISSION −p, seller +p.
   - p is the HOLD amount; the transaction is pair-limited and does not count toward reputation.
   - No WISHLIST_MATCH.
   - `_require_exchange_legs` accepts a single POINTS leg.
   - The term and event hand-over queries include POINTS.
7. **Cancel (RELEASE).**
   - RELEASE (HELD → PARTY) runs in inventory's single cancel transition through the inventory points_acl, which covers seller or buyer cancel and event deletion.
   - SALE and RELEASE of the same reservation are mutually exclusive, and idempotent via source keys.
8. **Ledger schema.**
   - Widen `uq_point_accounts_party_id` to `(party_id, account_type)`.
   - Add a per-party HELD account and a system BURN account (seeded).
   - New transaction types HOLD/SALE/RELEASE.
   - `TransactionRule` declares the debit and credit account types, and the PARTY-debit guard is replaced by an explicit balance check.
   - The ledger contract docstring and architecture.md are rewritten.
9. **Account reads.**
   - `/api/points/me` gains `held`; `balance` = available.
   - History labels: HOLD „Blokada”, SALE „Sprzedaż” (seller) / „Zakup” (buyer), RELEASE „Zwolnienie blokady”.
10. **Frontend.** Implement the eight mockup screens:
    - create (third mode, stepper, suggestion, range, photo hint, errors, limit)
    - edit (re-validation and clamp)
    - ItemCard POINTS badge with the price
    - item page („Biorę za N pkt”, owner held/cancel, buyer confirm)
    - reservation sheet (price / available / after, a blocked state with „Brakuje Ci N pkt”, the 409 messages)
    - search chip
    - admin section
    - /points available/held/reputation tiles

    Every `Record<ExchangeMode,…>` also gains POINTS.
11. **Counts/filters.** A POINTS key in every {GIFT, SWAP} counts object (owner items, organization stats, term listing counts, my reservations modes) and the search `offer_type=POINTS`. Exact key-set tests are updated deliberately.
12. **Wants.** `OfferMode` gains POINTS. The matcher is unchanged, but its suite runs.
13. **Migration 0109.**
    - Uses `lock_timeout` and a guarded downgrade that refuses while HOLD/SALE/RELEASE rows or POINTS preferences exist.
    - The runbook goes in architecture.md.
    - Tests: a downgrade-then-upgrade round trip and the refusal.

## Reusability opportunities
- GIFT take/confirm path in `groups/application/term_item_listings.py`; `confirm_race_rules._require_recipient_to_confirm_gift`.
- `points/application/awards.py` (`award_exchange`, `_used_pair_slots`), `ledger.lock_accounts`, `post_points`, `source_key_exists`; `families_acl.share_active_family`; `users_acl.eligible_party_ids`.
- `points/domain/valuation.py` (`snap`) and `application/valuation.py` (`value_for`, `item_value_preview`).
- FE:
  - `ItemPointsPreview`, `useItemPointsPreview`
  - `ModalSheet`, `PersonalPickupSheet`, `ChooseContextSheet`
  - `parseCapacity` (utils/appHelpers.ts)
  - `pointsConfigForm.ts` `parseMultiplier`
  - `ItemCard` `OFFER_BADGE`
  - `SearchFilters` chips
  - `pointsLabels.ts`
- Tests: the `test_points_awards.py` helpers (`_setup`, `_listed_item`, `_take`, `_confirm`), `point_ledger_assertions.assert_point_transactions_balanced`, `_alembic` from `test_personal_pickup_migration.py`, `count_queries`.

## Scope boundaries
**In:** everything above.
**Out (follow-up task):**
- the pickup condition correction and SALE_REFUND
- the seller block after 3 corrections
- the 30-day reminder
- auto-confirm/objection
- points notifications

## Technical considerations
- Lock order: event FOR SHARE → preference FOR UPDATE → point accounts (party-id order) → items. The listing-time `max_points_offers` check must not take account locks after an item lock. Use a preference-count read under the item lock, or lock the owner's accounts first.
- `mapped_transaction_conflicts` around take/confirm/cancel point writes (40P01/40001 → 409).
- `round_step` must use `Decimal` `ROUND_HALF_UP`, not `round()`.
- Module boundaries:
  - `_POINTS_IMPORTERS` stays {main, groups points_acl, inventory points_acl}.
  - search/pages read `points_price` via their groups ACLs or table refs.
- Held points can stay locked until the term or event date, or indefinitely; there is no auto-confirm. This risk is accepted.
