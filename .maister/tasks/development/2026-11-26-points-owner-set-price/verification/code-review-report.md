# Code Review Report

## TL;DR
The ledger rewrite, the HOLD/SALE/RELEASE exclusion and the authorization gates are sound. I found no critical issue.
The main warning: on /add, a failed POINTS PUT can still produce a duplicate item. The "retry only the PUT" guarantee lives in hook state, and the place picker stays usable after the failure, so a trip to /places/new loses that state.
The other warnings: the documented single lock order has one more exception (cancel paths lock reservation rows before accounts), and a few small UX/a11y gaps remain. All of these are covered by the shared 409 mapping or are cosmetic.

**Date**: 2026-11-26
**Path**: working tree (uncommitted): `src/backend/app/{points,groups,inventory,events,search,wants,pages}`, `src/backend/alembic/versions/0109_points_offers.py`, `src/frontend/src/**`
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## Key Decisions
- I did not re-run the tests. `uv run` could not reach PyPI (a TLS certificate error), so the review is static only.
- I checked deadlock safety against every lock-taking path the brief names: PUT preference, take, confirm, cancel, `update_item` + `on_revalued`, `delete_event` and the attendance close. I flagged an inversion only when a real cycle can form.
- Behaviour the spec records as an accepted risk (pair-limit overshoot, indefinitely held points, the shared-product photo edge cases) is not reported as a defect.

## Open Questions / Risks
- **Buyer-side trust.** The buyer alone confirms (`_may_confirm`), and either party may cancel until then. A buyer who has received the item can cancel and get the points back (RELEASE). A seller who never gets a confirm has no remedy except cancelling. This matches GIFT semantics and the spec's "no auto-confirm", but points have value, so the product owner should decide on it explicitly.
- **`can_confirm` and token type.** The `/actions` `can_confirm` flag does not reflect `require_login_principal`. An `mcp:edit`-only client sees `can_confirm: true` and then gets a 403. This is harmless for the web UI.

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues
- **Info**: 8 issues

## Critical Issues
None.

Verified correct:
- **Ledger** (`points/infrastructure/ledger.py:157-267`):
  - The debit and credit types are declared per rule, and each entry is checked against the side that matches its sign.
  - The balance check sums the net amount per account and runs one query, after the caller's `lock_accounts` lock. Under READ COMMITTED a statement issued after the lock sees the competitor's committed entries, so the check is sound.
  - `lock_accounts` refuses system types, creates and locks rows in `(party_id, account_type)` order, and sorts the same way in Python and in SQL (uuid int order matches bytewise order, and the account types are ASCII).
- **SALE/RELEASE mutual exclusion** (`points/application/purchases.py:134-185`):
  - Both paths lock the buyer's HELD account, so they serialize.
  - After the lock, each checks the other type's source key (409), then its own (skip).
  - The unique `(type, source_type, source_id)` constraint is the backstop.
- **Take** (`term_item_listings.py:805-840`): checks the mode match and the price snapshot under the preference lock. `lock_purchase` takes buyer PARTY, buyer HELD and seller PARTY in one sorted call. Concurrent takes by the same buyer serialize on the buyer's PARTY account; crossed buyer and seller pairs cannot deadlock.
- **Authorization**:
  - `require_login_principal` checks `PERMISSION_EDIT`, which matches `principal.py:60`, before the take or confirm logic runs.
  - Confirm is buyer-only (`_RECIPIENT_CONFIRMED_TYPES`).
  - `GET /api/points/item-value?item_id=` returns 404 for an unknown or deleted item before the 403 for someone else's (`valuation.py:53-68`).
  - `held_points` is built only inside the party branch of `_party_reservation` (`item_actions.py:268-287`) and in `/reservations/mine`. The R8 probe allowlists exactly `{"points_price", "held_points"}`.
- **Migration 0109**:
  - The constraints are added with `SET LOCAL lock_timeout`, and BURN is seeded behind a partial unique index.
  - The downgrade is guarded by three counts. HELD and BURN rows are deleted before the per-party unique constraint is restored, so the old constraint cannot fail.
  - `POINTS` did not exist in `ReservationType` before this task, so no existing rows can violate the new CHECK.

## Warnings

### W1. /add can still create a duplicate item after a failed POINTS PUT
- **Location**:
  - `src/frontend/src/hooks/useCreateItem.ts:45-70` (`created` kept in `useState`)
  - `src/frontend/src/features/items/ItemCreateView.tsx:172-179` (`LocationPicker` is not disabled while `locked`)
- **Description**:
  - The "retry repeats only the PUT" guarantee (user decision 3) depends on `created`, which is local state of the hook.
  - After a failed PUT, the photos and `ItemQuickAddForm` are locked, but the place picker is not. Its `+` link navigates to `/places/new` and back.
  - The form draft survives that trip through `AppDataContext` (`itemDraft`/`itemPhotos`), but `created` is lost when the view remounts. The next „Wystaw” calls `registerWithPhotos` again and creates a second item, while the first draft stays in My Items.
  - Even without the round trip, picking a different existing place after the failure is ignored silently: the retry sends only the PUT.
- **Recommendation**:
  - Pass `disabled={busy || locked}` to `LocationPicker`.
  - Store the created item id with the draft in `AppDataContext` (cleared together with `itemDraft`), so the retry survives a remount.
  - Add a test: a PUT failure, then a remount with the same draft, then a submit must not call `registerInventoryItem`.
- **Fixable**: true

### W2. Cancel paths lock reservation rows before point accounts (an undocumented second exception to the lock order)
- **Location**:
  - `src/backend/app/inventory/application/reservation_transitions.py:100-123` (`cancel_reservations_without_commit`: reservations `FOR UPDATE`, then `lock_release_accounts`)
  - `reservation_transitions.py:77-90` (`_release`: accounts first, then the reservation and balance UPDATE)
- **Description**:
  - `delete_event` (before the event starts) holds the event's reservation rows and then waits on the buyer's HELD and PARTY accounts.
  - A concurrent buyer or seller cancel of the same POINTS reservation (`cancel_transaction` → `release_hold`) holds those accounts and then wants to UPDATE the reservation row. That is a real cycle.
  - Postgres resolves it as `40P01`. Both paths are inside `mapped_transaction_conflicts`, so one side gets a 409. The result is correct but contradicts the ledger docstring, which names take as "the one documented exception".
- **Recommendation**: Either lock the reservation rows in the single-cancel path before `release_hold` (`SELECT … FOR UPDATE` in `_load_exchange`), or record `delete_event` as a second exception in the ledger contract (`ledger.py:41-46`) and in `architecture.md`.
- **Fixable**: false (lock-order design choice)

### W3. The pre-filled POINTS price on /add may be invalid on first render
- **Location**: `src/frontend/src/features/items/ItemCreateView.tsx:101-104`
- **Description**:
  - `priceRaw` defaults to `String(points.data)`, the raw suggestion, not a value clamped and aligned to the bounds.
  - With a non-default config (for example `price_step=25`, or `price_cap` below 60), the default is off-step or above the cap. The stepper then mounts with `role="alert"` „Cena musi być…” and a blocked primary button before the user has typed anything.
  - The server, for an omitted price, uses `_clamp_price(points_value, bounds)` (`term_item_listings.py:215`), so the two disagree.
- **Recommendation**: Default to the suggestion clamped into the bounds and rounded to the step, the same rule the server applies (the existing `clampPrice` logic, plus step rounding).
- **Fixable**: true

### W4. A PARTY account is created lazily for a caller who is not the item's owner
- **Location**: `src/backend/app/groups/application/term_item_listings.py:241-253`
- **Description**:
  - `lock_owner_accounts(db, profile.party_id)` runs before the ownership check (`AccessDeniedException` a few lines later), and `lock_accounts` inserts missing accounts.
  - A 403 attempt to list someone else's item for points therefore commits nothing (the transaction rolls back), so no row persists.
  - However, a caller listing their own item gets a PARTY account without the "eligible person" check that the `lock_accounts` docstring delegates to its callers (`ledger.py:292-294`). This is harmless, since such an account has a balance of 0, but it breaks the stated contract.
- **Recommendation**: Note in `lock_owner_accounts` that the eligibility check is intentionally skipped (the account is only a mutex), or check eligibility first.
- **Fixable**: true

## Informational

1. **Duplicated price helpers.** `term_item_listings.py:157-162` re-implements `_is_valid_price` and `_clamp_price`, while `points/domain/pricing.py:40-45` already defines `is_valid_price`/`clamp_price`. Expose the domain functions through `points_acl` instead. A third copy exists in `ItemEditForm.tsx:321`, and `PointsPriceStepper` duplicates the bounds logic.
2. **Product re-point can bypass the owner-photo rule.** `update_item` (`inventory_items.py:286-300`) can move a POINTS listing to another `product_id`, which the hook only clamps. The owner-photo rule (`has_own_unrejected_photo`) is not re-checked, so a POINTS listing can end up on a product without the owner's photo. This is probably acceptable; consider documenting it.
3. **Confirm reads the preference without a lock.** `confirm_transaction` (`term_item_listings.py:1340-1345`) reads the preference with `get_item_listing_preference` after taking the item lock. Every writer of that preference holds the item lock, so this is safe; a comment would make the reasoning explicit.
4. **Alert shown on mount.** `PointsPriceStepper.tsx:96-99` renders its error with `role="alert"` as soon as the value is invalid, including on mount (see W3). Screen readers announce an error before the user has interacted. Consider showing it only after the input is touched, or using `aria-live="polite"`.
5. **Stale `can_confirm` for MCP tokens.** `can_confirm` in `/actions` ignores the login-token requirement (see Open Questions).
6. **Wall-clock time in purchases.** `purchases.py:97` uses `datetime.utcnow()`. This is consistent with the module (audit timestamps), but it means the pair window cannot be patched through the domain clock in tests. It is pre-existing style.
7. **Ratios returned as floats.** `PointsConfigResponse.price_min_ratio`/`price_max_ratio` are `float` (`points/schemas.py:38-39`), while the request takes `Decimal`. This follows the existing multiplier fields, and the frontend mirror rounds with `Math.round(ratio*100)`, which is correct for two-decimal inputs.
8. **Migration bundles schema and seed.** `0109` holds both in one revision; this is a recorded exception. The downgrade guard counts cancelled POINTS reservations too, so any POINTS history at all forces a dump restore. That is stated in the docstring; make sure the runbook says so.

## Metrics
- Max function length: about 110 lines (`set_item_listing_preference`, `term_item_listings.py:219-307`). It is long but linear; a candidate for splitting out the POINTS branch.
- Max nesting depth: 4 levels
- Potential vulnerabilities: 0 critical (authorization, R8 and ledger checks verified)
- N+1 query risks: 0. `hold_amounts` is batched (one query; none for an empty input), `lock_release_accounts` makes one sorted call, and `_open_pair_holds` uses the unique source-key index.

## Prioritized Recommendations
1. W1: lock the place picker after a failed PUT, and keep the created item id in `AppDataContext` so a remount cannot create a duplicate item.
2. W3: clamp and step-align the default POINTS price on /add.
3. W2: make the cancel paths' lock order consistent, or document the second exception.
4. Info 1: drop the duplicated price helpers in favour of `points/domain/pricing.py`.
5. W4 and Info 2: document, or close, the eligibility and owner-photo gaps.
