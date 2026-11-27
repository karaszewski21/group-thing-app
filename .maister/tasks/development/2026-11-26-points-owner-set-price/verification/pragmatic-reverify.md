# Pragmatic Re-check: POINTS mode with an owner-set price (after fix loop cycle 1)

## TL;DR
Status: ✅ Appropriate. The step risk is fixed, and so are M1, M2 and M3. M4 is deferred on purpose (`term_item_listings.py` is now 1387 lines, up from 1375).
Of the Low findings, L1 (the rename), L4, L5 and L7 are resolved. L6 is partly resolved: the clamp is now shared, but the dense derived state remains. L2 is still open (optional), and L3 is still open with a reason.
The fixes added no over-engineering. The five constructs I was asked about are each the smallest form of a needed fix. There are three small new nits: an unused `createdItemId` return, a `movesPoints` flag that could be a constant, and a confirm path that locks the reservation rows twice.
None of this blocks the release. The remaining cleanups take about 15 minutes.

## Open Questions / Risks
- **Lint baseline.** The work log reports 11 lint errors against a baseline of 10, with "the extra error is not in touched files; to be checked". That is not a pragmatism issue, but someone should confirm it before sign-off so a regression is not waved through.
- **M4 is still deferred.** The file grew by 12 more lines in the fix loop (the lock-order comment and `lock_reservations` call). The follow-up task should go ahead.

---

## 1. Status of the original findings

| Finding | Status | Evidence |
|---|---|---|
| **Risk: `clamp_price` off-step** | ✅ Resolved | `app/points/domain/pricing.py:38-42` is `min(max(round_step(Decimal(price), step), min), max)` and its docstring explains why the result is always valid. `tests/test_points_pricing.py:77-87` adds the off-step table (`test_clampPrice_offStep_snapsToStepWithinBounds`). The frontend mirror `clampPointsPrice` (`utils/appHelpers.ts:156`) snaps the same way: `floor(x/step+0.5)` equals ROUND_HALF_UP for positive values. |
| **M1: duplicate price rules in groups** | ✅ Resolved | The private copies are gone. `groups/infrastructure/points_acl.py:21-22` re-exports `is_valid_price`/`clamp_price`, `points/service.py` exports them in `__all__`, and `term_item_listings.py:206,213,316` calls `points_acl.*`. |
| **M2: HOLD query written twice** | ✅ Resolved | `points/infrastructure/ledger.py:346` `hold_credits_select(reservation_ids, *columns)` is used by `hold_amounts` (`:374`) and `_read_hold` (`purchases.py:263`). |
| **M3: `_PgError` in 4 test files** | ✅ Resolved | `tests/conftest.py:91-108` now holds `PgError`, `pg_error(sqlstate, statement)` and `deadlock`. No class copies remain: `test_points_ledger`, `test_search_api` and `test_wants_api` import `pg_error`, and `test_points_purchase_flow` imports `deadlock`. |
| **M4: `term_item_listings.py` size** | ⏸ Deferred (by decision) | 1387 lines, up from 1375 at review time and 1207 on HEAD. |
| **L1: double config load and `offer_rules` name** | ✅ Rename done; the double load is accepted | `max_points_offers` is used at all three layers. `_points_price` still calls `load_config` twice (`max_points_offers` and then `price_bounds`), but only when an item becomes POINTS, and each call reads one row. Leave it. |
| **L2: `PurchaseConflictException` / `settle_sale` exports** | Residual (optional) | The subclass is still used, and 7 test references catch it. `settle_sale` is exported only for `tests/test_points_purchases_ledger.py`. Both are harmless, and the tests use them as precise assertions, so this can stay. |
| **L3: string literals instead of enums** | Partly resolved; the rest is justified | `my_reservations.py:164` now uses `ReservationType.POINTS.value`, and `term_item_listings.py:149` uses the enum. `awards.py` now imports `POINTS = "POINTS"` from `points/domain/awards.py:26`. That literal is justified: points may not import inventory's `ReservationType` (module boundary). |
| **L4: redundant `current is not None`** | ✅ Resolved | `term_item_listings.py:211` is `_is_points(current) and …`. `_is_points` is now a `TypeGuard`, so mypy narrows the type without the extra check. |
| **L5: puzzle-like re-check** | ✅ Resolved | `term_item_listings.py:254-255` uses `still_becomes_points = not _is_points(existing)` and `becomes_points != still_becomes_points`, as suggested. |
| **L6: dense `ItemEditForm` derived state and a 4th clamp copy** | Partly resolved | The clamp copy is gone: `ItemEditForm.tsx:105,331` and `ItemCreateView.tsx:109` use the shared `clampPointsPrice`. The chain of about 15 `const`s (`ItemEditForm.tsx:94-110`) remains, and `ItemCreateView.tsx:103-115` now has a similar, smaller chain. The pure `resolvePointsPriceField` extraction is still only worth doing if a third form appears. |
| **L7: nested ternary hint** | ✅ Resolved | `blocks/ItemPickupActions.tsx:204` `pointsBlockedHint(view, reachable)` uses early returns. |

## 2. Complexity added by the fixes

| Construct | Verdict | Notes |
|---|---|---|
| **`movesPoints` flag in `useReservationSettlement`** (`hooks/useReservationSettlement.ts:64-101`) | Acceptable, but could be simpler (Low, N1) | The flag is a defaulted positional boolean, set to `true` only by confirm and cancel. It saves one invalidation of `[POINTS_KEY]` on accept and reject. The only cost of always invalidating would be one refetch of `/api/points/me`, and only when that query is mounted. Simpler: add `[POINTS_KEY]` to the key list that `refresh` uses (not to the exported `RESERVATION_STATE_KEYS`, which `useItemTake` also uses) and delete the flag and its two arguments. That is about 4 LOC less and one fewer concept. It is cosmetic, so keep it if you prefer explicit intent. |
| **`useCreateItem(created, onCreated)`** (`hooks/useCreateItem.ts:44-71`) | Justified, with one dead return (Low, N2) | The fix for W5 needs the item that a failed POINTS PUT left behind to survive a remount (the trip to `/places/new`). That means the state has to live in `AppDataContext`, so a controlled hook (value plus setter) is the natural shape. Extracting `registerWithPhotos` makes the create path easier to read than on HEAD. **Dead code:** the hook returns `createdItemId`, but no caller or test reads it. The only caller, `ItemCreateView.tsx:72`, destructures just `createItem`. Remove `createdItemId` and return `createItem` directly, or keep the object, without that field. Minor: on a retry with `created` set, a GIFT/SWAP offer goes through the PUT branch. That is correct (the mode can change after a failure) but implicit, and a short comment would help. |
| **`lock_reservations`** (`inventory/application/reservation_transitions.py:94-117`, bridged in `groups/infrastructure/inventory_bridge.py:174`) | Justified, because it fixes a real lock-order bug (W8); two Low nits (N3) | It gives one ordered `FOR UPDATE` that confirm and exchange run before any point account. That is the minimum needed for the reservation → accounts → items → preference order. Nits: (a) `confirm` in `term_item_listings.py:1345` locks the legs, and then `fulfill_exchange` → `_load_exchange` (`:243`) locks them again. The second lock is harmless in the same transaction, but it is an extra `SELECT … FOR UPDATE`. (b) `cancel_reservations_without_commit` (`:131-138`) still builds the same ordered `FOR UPDATE` select inline. It cannot reuse `lock_reservations` as is, because it ignores missing ids where `lock_reservations` raises a 404. Leave both: neither is worth a parameter or a new abstraction. |
| **`hold_credits_select`** (`points/infrastructure/ledger.py:346`) | ✅ Good | It is the M2 fix exactly: a 17-line unexecuted builder with variadic columns and two callers. It is public only because `application/purchases.py` imports it from infrastructure, which is consistent with the module layering. |
| **conftest `PgError` / `pg_error` / `deadlock`** (`tests/conftest.py:91-108`) | ✅ Good | It follows the three-or-more-files standard. The `statement` parameter is used: the search and wants tests pass `"SELECT"`. `deadlock` is a one-line convenience with one importer. Inlining `lambda *a, **k: (_ for _ in ()).throw(...)` would be worse, so keeping it is fine. |

Other changes in the fix loop that I checked add no complexity:
- `lock_release_accounts`: one sorted lock of all buyers' accounts before the RELEASE loop. It is needed for multi-buyer cancels.
- The `can_confirm` login-token rule (`require_login_principal`).
- Gating the photo rule and the cap on `becomes_points`: this removes work for existing POINTS listings.
- `setItemMode` storing `points_price`.

## 3. Context consistency
- **Unused code:** `createdItemId` (N2). I found no other new export without a caller.
- **One rule in each place:** price validity and clamp has one source per stack (backend domain and `appHelpers.ts`), and the two are mirrored on purpose. The HOLD credit query has one builder.
- **Idioms:** consistent, apart from the boundary-justified `POINTS` literal in the points domain.

## 4. Remaining recommendations

| # | Action | Effort |
|---|---|---|
| N2 | Drop the unused `createdItemId` from `useCreateItem`'s return | 2 min |
| N1 | Optional: replace the `movesPoints` flag with an always-on `[POINTS_KEY]` invalidation inside `refresh` | 5 min |
| N3 | Optional: leave the double reservation lock on confirm, or note it in `_load_exchange`'s docstring ("callers may already hold it") | 2 min |
| M4 | Split the POINTS listing rules out of `term_item_listings.py` (follow-up task) | 30 min |
| L6 | Extract `resolvePointsPriceField` only if a third price form appears | — |

## 5. Summary statistics

| Metric | At review | Now |
|---|---|---|
| Copies of the backend price validity/clamp rule | 2 | 1 |
| Frontend clamp copies | 1 local (`ItemEditForm`) | 1 shared (`appHelpers.ts`) |
| Copies of the HOLD credit query | 2 | 1 |
| `_PgError` definitions in tests | 4 | 1 (`conftest.PgError`) |
| `term_item_listings.py` LOC | 1375 | 1387 (split deferred) |
| New dependencies / infrastructure | 0 | 0 |
| New unused exports | 0 | 1 (`createdItemId`) |

## 6. Conclusion
The fix loop did what the review asked without adding layers. Every new helper either removes a duplicate (M1, M2, M3, the clamp) or carries a correctness fix (lock order, surviving a retry after a remount). The only new things worth touching are the dead `createdItemId` return and, optionally, the `movesPoints` flag. Before sign-off, confirm the 11-against-10 lint discrepancy, and keep the M4 split as its own follow-up task.
