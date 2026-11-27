# Pragmatic Review: POINTS mode with an owner-set price

## TL;DR
Status: ✅ Appropriate. The complexity is proportional, with a few small cleanups to make. The ledger rework, lock order and guarded migration are what the spec requires for something that behaves like money. They are not speculative.
No Critical or High findings. 4 Medium, 7 Low.
Top actions: (1) remove the private price-rule copies in `term_item_listings.py` and re-export the domain helpers; (2) make `clamp_price` snap to the step (an omitted price can be stored off-step once an admin changes `price_step`); (3) move `_PgError` (now in 4 test files) to `tests/conftest.py`.
Total effort for every recommended change is about 1–1.5 h. None of them blocks the release.

## Key Decisions
- **The ledger generalisation is accepted as necessary.** It covers declared debit/credit sets, a balance check under the lock and one account per (party, type). It is the smallest change that lets PARTY accounts be debited safely. `_award()` keeps the four stage-1 rules to one line each.
- **The balance is checked twice, and that stays.** `lock_purchase` returns the user-facing 409, and `post_points` keeps the invariant (500). These are separate concerns, not duplication.
- **The thin ACL wrappers stay** (`groups/infrastructure/points_acl.py` and `inventory/infrastructure/points_acl.py`). They are the project's enforced boundary pattern (`tests/test_module_boundaries.py`), not extra layers.
- **The `on_revalued` hook injection in `update_item` is justified.** Inventory must not import groups, and the hook copies the existing `on_registered` pattern.
- **Splitting `term_item_listings.py` is recommended but deferred.** It is not required for this task.

## Open Questions / Risks
- **Off-step stored price (Medium, cheap fix).** `clamp_price` (`app/points/domain/pricing.py:38`) clamps but does not snap to the step. When an admin sets `price_step` so that it no longer divides the suggestion, two things go wrong:
  - **On a PUT without a price:** `_points_price` stores `clamp_price(points_value, bounds)` as is. Example: s=20 with step 15 gives bounds 15–30, and 20 is stored. That price then fails `is_valid_price`, and the edit form's `parsePointsPrice` shows it as invalid.
  - **On a re-valuation:** `clamp_points_price` keeps an in-bounds price that is off the new step.

  Proposed fix: `min(max(round_step(Decimal(p), step), min), max)`. Both bounds are already multiples of the step, because `round_step` produces them and the config requires `cap % step == 0`. Add one table case to `tests/test_points_pricing.py`.
- **`term_item_listings.py` is now 1375 lines** (1207 on HEAD). DX keeps getting worse, but splitting it in this task would add churn to an already large diff (159 files).

---

## 1. Complexity Assessment

**Project scale:** early production. The app is live with real users and a deploy runbook for every migration, run by a small team. A ledger of points that people spend needs production-grade care: locking, idempotent source keys, a guarded downgrade.

| Indicator | Observation | Verdict |
|---|---|---|
| New backend modules | `points/domain/pricing.py` (39 LOC), `points/application/pricing.py` (25), `points/application/purchases.py` (281), migration 0109 (157) | Proportional |
| Ledger change | `TransactionRule` gets `debits`/`credits` frozensets and `_require_balances`; `lock_accounts` is keyed by (party, type) | Needed for PARTY debits |
| New routes / matrix rows | None. `/item-value` gains an `item_id` form | Minimal |
| Frontend | 2 new components (`PointsPriceStepper` 87 LOC, `PointsReservationSheet` 115 LOC), a `points` sub-state in `useItemTake`, a `CreateItemOffer` union | Proportional |
| Tests | 6 new backend test files (~1640 LOC), several frontend suites extended | Heavy but targeted (race and deadlock cases) |

**Overall complexity: Medium, appropriate.** I found no infrastructure overkill, no speculative abstraction and no future stubs. Stage-2 items such as auto-confirm and the 30-day reminder are left out, as the spec says.

## 2. Key Issues Found

### Medium

**M1. Duplicated price rules in groups**
- **Evidence:** `src/backend/app/groups/application/term_item_listings.py:157-162` defines `_is_valid_price` and `_clamp_price`, which are verbatim copies of `app/points/domain/pricing.py::is_valid_price` / `clamp_price`. `points/service.py` exports `PriceBounds` but not these two functions, so the copies were written.
- **Impact:** the price rule now lives in two places. The fix for the Risk above would have to be made twice, and it is easy to miss the copy.
- **Recommendation:** export both from `points/service.py` (`__all__`) and re-export them in `groups/infrastructure/points_acl.py`, as `PriceBounds` already is.
  ```python
  # groups/infrastructure/points_acl.py
  PriceBounds = points_service.PriceBounds
  is_valid_price = points_service.is_valid_price
  clamp_price = points_service.clamp_price
  ```
  Then delete the two private functions and call `points_acl.is_valid_price` / `points_acl.clamp_price`. This removes about 8 LOC and leaves one source of truth.
- **Effort:** 10 min.

**M2. The HOLD lookup query is written twice**
- **Evidence:** `app/points/application/purchases.py:255` (`_read_hold`) and `app/points/infrastructure/ledger.py:336` (`hold_amounts`) build the same join: `PointTransaction` → `PointEntry` → `PointAccount`, with `HOLD` / `RESERVATION` / `account_type == HELD` / `amount > 0`. Only the selected columns and the cardinality differ.
- **Impact:** if the definition of "the HOLD amount" changes, one copy can drift from the other. `held_points` in responses would then disagree with what SALE or RELEASE actually moves.
- **Recommendation:** add one private select builder in `ledger.py`, for example `_hold_credit_select(*columns)`, and use it in both places. `_read_hold` adds `party_id`, `counterparty_party_id` and `description`. About 12 LOC less.
- **Effort:** 15 min.

**M3. `_PgError` test helper copied into 4 files**
- **Evidence:** `class _PgError` exists in `tests/test_points_ledger.py:494` and `tests/test_points_purchase_flow.py:633` (both new in this task), and already in `tests/test_search_api.py:149` and `tests/test_wants_api.py:112`. `_deadlock` (`test_points_purchase_flow.py:629`) builds on it.
- **Impact:** the backend-testing standard says to move a helper to `tests/conftest.py` once three or more files use it. That threshold is now passed.
- **Recommendation:** move `_PgError` (and a `raise_sqlstate(code)` factory if one is wanted) to `tests/conftest.py`, then import it in all four files.
- **Effort:** 10 min.
- **`committed_client` / `_purge`:** `test_points_purchase_flow.py:73` imports `committed_client` from `test_points_awards_contexts.py`. That makes 2 files, below the threshold, so it is fine as is. `_committed_purge` is a legitimate extension, not a copy.

**M4. `term_item_listings.py` keeps growing** (1207 → 1375 lines)
- **Evidence:** the new POINTS block sits next to the listing, take and confirm use cases: `_is_points`, `_count_other_points_offers`, `_points_price`, `clamp_points_price` (L150-322) and `require_login_principal` (L770).
- **Impact:** the file is hard to navigate, and it now mixes listing-preference writes, take/propose, confirm/cancel and POINTS pricing.
- **Recommendation (defer):** in a follow-up, move the POINTS listing rules (`_points_price`, `_count_other_points_offers`, `clamp_points_price`) into `groups/application/points_listing.py`. `set_item_listing_preference` would import them. This change is not worth making inside this task's diff.
- **Effort:** 30 min, in a separate change.

### Low

**L1. `config` is loaded twice in a POINTS PUT.** `_points_price` calls `points_acl.offer_rules(db)` and then `points_acl.price_bounds(db, …)`, and each runs `load_config`. Each is a one-row read, so the cost is negligible. The name `offer_rules` is the bigger problem: it returns a bare `int`. Rename it to `max_points_offers` at all three layers (`points/application/pricing.py:23`, `points/service.py`, `groups/infrastructure/points_acl.py:59`). 5 min.

**L2. `PurchaseConflictException` adds no behaviour** (`purchases.py`). It subclasses `BusinessConflictException` without changing anything, and only tests (`test_points_purchases_ledger.py`) refer to it. In the same way, `settle_sale` is exported from `points/service.py` only for tests, since production calls it from `awards.py`. Both are harmless. Optionally drop the subclass and let tests assert on `BusinessConflictException` and the message.

**L3. String literals where enums are used elsewhere.** These are `awards.py:42` `_POINTS = "POINTS"` and `my_reservations.py:164` `row.mode == "POINTS"`. The neighbouring code uses `ReservationType.POINTS` / `_MODES`. This is a consistency nit, and the fix is to use the enum value.

**L4. A redundant guard.** In `term_item_listings.py:215`, `current is not None and _is_points(current)` can be just `_is_points(current)`, because `_is_points` already handles `None`.

**L5. The M4 re-check reads like a puzzle.** In `term_item_listings.py`, `if mode == _POINTS and becomes_points == _is_points(existing): raise …` is correct, but a reader has to invert it in their head. Suggested rewrite:
```python
still_becomes_points = not _is_points(existing)
if mode == _POINTS and becomes_points != still_becomes_points:
    raise BusinessConflictException(OFFER_CHANGED_MESSAGE)
```

**L6. Dense derived state in `ItemEditForm.tsx:91-110`.** About 15 chained `const`s decide `isPoints`, `revalued`, `valuation`, `priceBounds`, `priceText`, `parsedPrice`, `priceInvalid` and `priceToSave`. `clampPrice` (L321) is a fourth copy of the clamp rule, next to `parsePointsPrice` in `utils/appHelpers.ts`.
- **Recommendation (optional):** move `clampPrice` into `appHelpers.ts` beside `parsePointsPrice`. If the form grows again, extract a pure `resolvePointsPriceField(...)` that can be table-tested. Mirroring the rules across the two stacks is inherent, so keep that.

**L7. Nested ternary for `hint` in `ItemPickupActions.tsx::PointsChooseActions`.** It is a four-way nested ternary. An early-return helper `pointsTakeHint(view)` would read better. It is cosmetic.

## 3. Developer Experience
- **Good:**
  - The ledger docstring states the full contract: debit/credit sets, the balance check, lock order and SALE/RELEASE exclusion. `TRANSACTION_RULES` is the single declaration.
  - The deadlock tests are parametrised over all five writes, and the migration guard has a test.
  - Polish messages are constants.
- **Friction:**
  - The size of `term_item_listings.py` (M4).
  - Helper copies in the tests (M3).
  - Following the lock-order exception for take means reading three docstrings: `ledger.py`, `_take` and `set_item_listing_preference`. They agree, which is good, but a single "Lock order" section in `architecture.md`, if it is not already there, would be the canonical reference.

## 4. Requirements Alignment
- **No new routes or matrix rows, and no POINTS on `POST /inventory-items`.** This matches the spec's minimal decisions.
- **No feature inflation found.** Every new public field (`points_price`, `held_points`) appears in the R4 table. The R8 probe allowlist stays at exactly those two keys.
- **Deferred items stay deferred:** auto-confirm, the 30-day reminder, a PLATFORM payment and the strict pair limit across GIFT and POINTS.

## 5. Context Consistency
- **Dead or unused code:**
  - `useOwnedItemPointsValue` returns a `refetch` that no caller uses. It is kept because the data-fetching standard prescribes an app-shaped return with `refetch`, so it is not flagged.
  - All other new exports have callers (checked with grep).
- **Same rule in several places:** M1 (price rules), M2 (HOLD query) and L6 (frontend clamp).
- **Inconsistent idioms:** L3 (string versus enum).
- **No half-implemented patterns found.** The `_require_recipient_to_confirm_gift` → `_require_recipient_to_confirm` rename was applied at its call site.

## 6. Recommended Simplifications (top 3)

| # | Action | Before | After | Impact |
|---|---|---|---|---|
| 1 | M1: re-export the domain price helpers | 2 private copies in groups | `points_acl.is_valid_price` / `clamp_price` | −8 LOC, one rule |
| 2 | Risk fix: snap in `clamp_price` | `min(max(p, lo), hi)` | `min(max(round_step(Decimal(p), step), lo), hi)` | No off-step stored prices; 1 test row |
| 3 | M3: `_PgError` to conftest | 4 class copies | 1 in `tests/conftest.py` | −15 LOC, follows the standard |

Next in priority: M2, the shared HOLD select (about −12 LOC), then L1, the `max_points_offers` rename.

## 7. Summary Statistics

| Metric | Current | After the top 3 + M2 |
|---|---|---|
| Copies of the price validity/clamp rule (backend) | 2 | 1 |
| Copies of the HOLD-credit query | 2 | 1 |
| `_PgError` definitions in tests | 4 | 1 |
| `term_item_listings.py` LOC | 1375 | ~1367 (1375 − 8; split deferred) |
| New dependencies / infrastructure | 0 | 0 |

## 8. Conclusion
The implementation fits the problem. The complexity it adds is the minimum needed for a correct, concurrent points ledger, and it reuses the project's existing patterns: ACLs, `mapped_transaction_conflicts`, guarded migrations and the hook injection.

Action items:
1. Make `clamp_price` snap to the step and add the test row (Risk; 10 min).
2. M1: re-export and delete the copies (10 min).
3. M3: move `_PgError` to conftest (10 min).
4. M2: share the HOLD select (15 min).
5. L1–L5 nits as convenient (15 min).
6. M4: split `term_item_listings.py` in a follow-up task (30 min).
