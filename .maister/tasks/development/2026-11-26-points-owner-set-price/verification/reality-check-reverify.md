# Reality Check (re-verify): POINTS offers with an owner-set price

## TL;DR
- **Status: ✅ Ready.** Five of the six gaps are resolved in the code. G4 is only partly resolved: two settle paths still don't refresh the points balance. That gap is Low and harmless while `useMyPoints` keeps the default `staleTime: 0`.
- All five end-to-end flows still work after the W8 lock reorder and the W5 retry change on /add.
- Full suites are at baseline: backend 1897 passed with the 2 known stale failures, vitest 32 baseline failures, typecheck 0. Lint is back to 10 errors (the `setGroupForm` effect now comes after its `useState` in `AppDataContext.tsx`).

## Open Questions / Risks
- **G4 residual (Low).** A POINTS confirm or cancel from My Items (`MyItemsView.tsx` `handleConfirmReceipt`/`handleCancelTransaction`, L279-307) and the end-of-term prompt confirm (`PendingActionsHost.tsx` L108-111) still don't invalidate `[POINTS_KEY]`. A balance already on screen stays stale until the next mount or window focus.
- **The kept /add item has one way out.** `itemCreated` is cleared only by a successful submit (`ItemCreateView.tsx:149`), and nothing on the page says so. After a failed POINTS PUT, the form stays locked on that item even after the user leaves and comes back, because the panel state persists. „Wersja robocza” gets the user out (it returns the kept item without a PUT), so this is not a dead end. One edge case: if the user deletes the draft in My Items first, „Wersja robocza” navigates to a 404 item page, and only then clears the kept item. Low.
- **Docstring drift (Info).** `term_item_listings._take` and the `set_item_listing_preference` docstring still describe the order as "accounts → item → preference". The settle paths are now reservation → accounts → item → preference. This changes no behaviour.
- I6 (a product re-point skips the photo rule) and I9 (the size of `term_item_listings.py`) were knowingly left open by the fix loop. They are not re-assessed here.

## Key Decisions
- I did not run any tests (`skip_test_execution: true`). The suite numbers come from `verification/test-suite-results.md`, and the lint count of 10 comes from the caller. I checked in the source that the lint fix is in place: `useState` is at L161 and the effect at L164.
- I traced everything read-only, through the working tree and `git diff`.

## Gap status
| Gap | Was | Now | Evidence |
|---|---|---|---|
| G1 My Items price chip | Medium | **Resolved** | `AppDataContext.setItemMode` (L518-526) writes `points_price: saved?.points_price ?? null` into the panel copy, and the panel copy wins in the `MyItemsView` merge (L139-142). `ItemListingPreferenceResponse.points_price` exists on both stacks. `AppDataContextItemMode.test.tsx` checks 40 on POINTS and null on the switch back. `setItemVisibility` touches only the visibility, so the chip survives a visibility toggle. |
| G3 Photo re-check on edits | Medium-Low | **Resolved** | In `term_item_listings._points_price` (L173-213), the photo rule and the offer limit run only `if becomes_points`. An existing POINTS listing keeps its price, or validates the price it is sent. Covered by `test_putPreference_existingPointsAfterPhotoRejected_editsPriceAndVisibility`. One leftover: the `points_value is None` 400 still runs on every POINTS PUT, but that can only happen to an item that is becoming POINTS. |
| G2 ChooseContextSheet label | Low | **Resolved** | `CONFIRM_LABEL.POINTS = "Dalej: zablokuj punkty"` (`ChooseContextSheet.tsx:19-23`). `ChooseContextSheet.test.tsx` has a row per mode. |
| G4 Points refresh on settle | Low | **Partly resolved** | `useReservationSettlement` now invalidates `[POINTS_KEY]` before the refetch on confirm and cancel (L64-68, L93-101), and a test covers it. That hook is used only by `PartyReservationActions`, the item-page path that already refreshed the balance. `MyItemsView` and `PendingActionsHost` are unchanged (see Open Questions). |
| G5 Helper copies | Low | **Resolved** | The private `_is_valid_price`/`_clamp_price` are gone (nothing in `app/` matches them). `groups/infrastructure/points_acl.py:21-22` re-exports `points_service.is_valid_price`/`clamp_price` from `points/domain/pricing.py`. The client's `clampPointsPrice` (`appHelpers.ts:156`) is a deliberate mirror of the server rule, with parity rows in `appHelpers.test.ts`, including the step-25 cases. |
| G6 Step snap | Low | **Resolved** | `clamp_price` now applies `round_step` (half-up) and then clamps. Both bounds are on the step, because `price_bounds` rounds them and the config keeps the cap a multiple of the step, so the result always passes `is_valid_price`. For example, with step 25 and s = 40 the bounds are 25–50 and the stored price is 50. `test_clampPrice_offStep_snapsToStepWithinBounds` covers this. The runbook in `architecture.md` (L510) now says „Lowering the cap or the offer limit never unlists or re-prices.” An above-cap price that is already stored stays editable: a visibility toggle keeps the price without validating it, and the edit form starts from the clamped value. |

## The five flows after W8 and W5
1. **Listing via /add (draft, then photos, then PUT): ✅ holds.**
   - `useCreateItem` takes the kept `created` item from `AppDataContext.itemCreated`, so after a failure, and even after a remount, the next submit repeats only the PUT.
   - Photos, fields and the place picker are disabled while an item is kept. The mode buttons stay enabled, so the user can still change the mode or retry with a new price.
   - On the server, the item is becoming POINTS, so the photo rule and the offer limit still apply.
   - Tests: ItemCreateView „a retry repeats only the PUT” and „a remount retries only the PUT, then clears the kept item”.
2. **Take: ✅ unchanged.**
   - The order is preference lock, the AVAILABLE re-check, the price compare, then `lock_purchase` (sorted accounts).
   - A take on an item that is already reserved gets 409 at `_lock_takeable_preference`, before it asks for any account lock, so it can't form a cycle with a confirm that holds the accounts and waits for the preference.
3. **Confirm: ✅ holds.**
   - New order: `lock_reservations` (id order, `populate_existing`), then `award_exchange`/`settle_sale` (accounts), then the items in id order, then the preference.
   - A cancel that commits between the unlocked status read and the lock is seen after the lock: `settle_sale` returns 409 once the hold is released, and the whole transaction rolls back.
   - Tests: `test_settlePoints_locksReservationBeforeAccounts[confirm]` and `test_confirmAndCancelPoints_parallel_settleOrReleaseNeverBoth`.
4. **Cancel and event deletion: ✅ holds.**
   - `cancel_exchange` goes through `_load_exchange`, then `lock_reservations`, then `_release` (RELEASE first).
   - `cancel_reservations_without_commit` locks the reservations, then `lock_release_accounts`. All three settle paths now share the same reservation-before-accounts order.
   - Pairings I checked for lock cycles:
     - set-preference (accounts, then item, then preference) against confirm: no cycle
     - `update_item` (item, then preference) against confirm: no cycle
     - take against cancel: no cycle
   - Tests: `test_settlePoints_locksReservationBeforeAccounts[cancel]`, `test_deleteEvent_twoBuyers_releasesBoth`, and `test_pointsWrites_deadlock_returns409AndWritesNothing`, where any residual 40P01 still maps to 409.
5. **Admin config: ✅ unchanged.**
   - A save invalidates the whole `[POINTS_KEY]` prefix.
   - `bounds_for` reads the config on every request.
   - The new step snap keeps every suggestion valid under a custom step.

## Status
✅ **Ready.** Nothing Critical, High or Medium remains open.

## Pragmatic Action Plan (optional follow-ups)
| # | Priority | Task | Success criteria | Effort |
|---|---|---|---|---|
| 1 | Low | Await `queryClient.invalidateQueries({ queryKey: [POINTS_KEY] })` after the confirm in `PendingActionsHost.tsx` and after the confirm and cancel in `MyItemsView.tsx`. | Every POINTS settlement refreshes a balance that is on screen. Add one assertion per path. | 20 min |
| 2 | Info | Update the lock-order wording in the `_take` and `set_item_listing_preference` docstrings to reservation → accounts → item → preference. | The docstrings match the code and the runbook. | 5 min |

## Completion Verdict
✅ **Complete.** G1, G2, G3, G5 and G6 are resolved in the code with tests. G4 is reduced to two non-blocking refresh paths. The W8 reorder gives every settle path the same reservation-before-accounts order with no new lock cycle, and the W5 change makes the PUT-only retry survive a remount.
