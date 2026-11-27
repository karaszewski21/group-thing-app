# Reality Check: POINTS offers with an owner-set price

## TL;DR
- **Status: ⚠️ Issues Found. It can ship; nothing blocks deployment.** All five flows are wired end to end, from the web call through the backend wire name, the lock and the ledger, and the targeted suites pass: backend `test_points_*` 167 passed, and 14 POINTS frontend files with 205 passed.
- Every acceptance case holds, in `domain/pricing.py` and its tests: s=40 → 20–60, s=60 → 30–90, no maximum above 100, and 55 is rejected with „Cena musi być od 20 do 60 pkt, co 10.”
- The gaps are small:
  - The My Items price chip appears only after a reload when you switch an item to POINTS.
  - The context sheet says „Rezerwuję na ten termin” on its POINTS step.
  - A POINTS item whose owner photo was later rejected can't have its visibility or price changed.
  - Non-default config edge cases (step or cap changes) can leave stored prices off-step or above the cap.
  - Two settle paths don't invalidate the balance; this is harmless with the default `staleTime: 0`.

## Key Decisions
- I did not re-run the full suites, as instructed. I trusted the work-log's final numbers (backend 1889 passed with 2 known stale, matcher 125, vitest 32 baseline failures, typecheck 0) and re-ran only the POINTS-targeted sets.
- I took these user-scoped decisions as given and did not count them as gaps:
  - SALE_REFUND, the 3-correction block and the 30-day reminder are deferred.
  - HOLD at take, SALE at confirm, RELEASE on cancel.
  - Only the buyer confirms.
  - Spending needs a login token.
  - `points_price` and `held_points` are the R8 exceptions.
- I judged the readiness against the default config (0.5 / 1.5 / 100 / 10). Edge cases that only appear under a custom config are rated Low.

## Open Questions / Risks
- **Off-step price under a custom step (Low).** `clamp_price` returns the suggestion unchanged when it lies within the bounds. With `price_step` = 25 and s = 40, the stored price is 40, which is not a multiple of 25. Later edits of such an item need a valid price, so the owner has to fix it by hand.
- **Lowering `price_cap` or the ratios never re-clamps existing listings.** For example, a listing at 100 stays at 100 after the cap drops to 80. This matches „lowering the cap never unlists”, but the rule „nothing above the cap” is then true only for new prices. Worth a sentence in the runbook.
- **Held points can stay locked indefinitely.** There is no auto-confirm, and the 30-day reminder is deferred. This is an accepted risk; the seller can cancel.
- **The pair limit can overshoot across GIFT and POINTS.** This is accepted in the spec: the overshoot is at most the pair's open holds, and burn still equals emission.
- **A dead end on /add (accepted, L9).** It happens when every uploaded photo fails or is rejected straight away. The retry repeats only the PUT, which keeps returning 400, so the user has to leave and add a photo from the edit form.

## Status
⚠️ **Issues Found.** The feature works for its intended purpose and is acceptable to deploy with the action items below as follow-ups. Nothing is Critical.

## Verification evidence
| Check | Result |
|---|---|
| `uv run --no-sync python -m pytest tests/test_points_*.py -q` (13 files) | **167 passed** in 117 s |
| `npx vitest run` with AccountPointsView, itemActionsViewState, ItemCard, ItemCreateView, ItemEditView, ItemPointsPreview, MyItemsView, pointsConfigForm, PointsConfigPage, PointsPriceStepper, PointsReservationSheet, ReservedItemsView, SearchView and usePointsConfig | **14 files, 205 passed** |
| Migration `0109_points_offers.py`, the runbook in `architecture.md`, the `security.md` line and the `INDEX.md` line | present |
| Full suites (from the work-log, not re-run) | backend 1889 / 2 known stale; matcher 125; vitest 32 baseline failures; typecheck 0 |

## Reality vs Claims: the five flows traced

### 1. Owner lists for points via /add (draft → photos → PUT)
- **Claim:** /add registers a draft, uploads the photos, then sends a PUT with POINTS and the price. A retry repeats only the PUT.
- **Reality:**
  - `hooks/useCreateItem.ts` registers the item with `listing_mode: null` for POINTS and uploads the photos. It then calls `setItemListingPreference(id, "POINTS", undefined, pointsPrice)`, which sends `{mode, points_price}`. That matches `SetItemListingPreferenceRequest.points_price` in `groups/schemas.py:769`.
  - `created` is kept after a failure, so the next submit skips `registerWithPhotos`.
  - The server side (`term_item_listings.set_item_listing_preference`, L219-307) checks, in order: the owner PARTY lock (only when the item becomes POINTS), the item lock, the M4 re-check, valuation, the owner photo, the offer limit and the price bounds.
  - The stepper shows „System proponuje N pkt” and „Dozwolone A–B pkt, co S” (`PointsPriceStepper.tsx:74-77`).
- **Evidence:** the ItemCreateView tests „lists for POINTS as a draft, then uploads the photos, then PUTs…” and „after a failed PUT … a retry repeats only the PUT” pass. So does `test_points_listing.py` (range 400, limit 409, photo 400).
- **Verdict:** ✅ Works.

### 2. The buyer sees the price and takes the item (term, event or personal); points are held
- **Cards:** `ItemCard` and `ItemTileBadges` get `pointsPrice` from every backend read model that carries it:
  - search `meta.points_price`
  - pages owner, organizer, party and organization cards
  - event participants (through `eventViewModel.ts`)
  - wants match, suggestion and similar meta
  - Term-listing cards fall back to „Za punkty”, which the spec accepts.
- **Item page:** `ItemHeader` shows `actions.points_price` as „Cena N pkt”. `ItemPickupActions` shows „Biorę za N pkt” with the hold note. A guest gets `AnonymousPointsActions` and then `AuthSheet`.
- **Take:**
  - `useItemTake.confirmPoints` sends `{context, reservation_type: "POINTS", points_price}`, which matches `ItemTakeRequest`.
  - `take_item` calls `require_login_principal` before any read.
  - `_take` locks the preference and compares prices (409 „Cena zmieniła się — odśwież.”).
  - `lock_purchase` checks eligibility, then the family rule, then takes the sorted account locks, then the pair limit (including open holds), then the balance.
  - Then come `create_reservation`, `post_hold` and the notifications with „za N pkt”.
- **Sheet:** `PointsReservationSheet` shows the price, the available balance and the balance after the hold, and blocks the action with „Brakuje Ci D pkt.” when the balance is short. A server 409 or 403 is shown verbatim with „Odśwież”.
- **Evidence:** in `test_points_purchase_flow.py`:
  - hold moves available down and held up
  - a price mismatch or short balance gets 409 with no reservation
  - an `mcp:edit` token gets 403 with no hold
  - parallel takes on one balance: one is created, the other gets 409
  - The confirm test is parametrised over TERM, EVENT and PERSONAL.
- **Verdict:** ✅ Works.
- **Gap G2:** the context-sheet label (Low, see below).

### 3. The buyer confirms and SALE is posted
- `_may_confirm` lets only the recipient confirm GIFT and POINTS. `confirm_transaction` calls `require_login_principal` for POINTS.
- `award_exchange` routes POINTS to `settle_sale`, which posts four entries: HELD −p, BURN +p, EMISSION −p, seller +p. So burn equals emission.
- The seller's My Items card gates on `recipientConfirms`, so the seller sees no „Odebrał”. `PartyReservationActions` invalidates `[POINTS_KEY]` for POINTS.
- **Evidence:** `test_confirmPoints_sellerForbiddenBuyerSettles` for all three contexts, `test_confirmAndCancelPoints_parallel_settleOrReleaseNeverBoth`, and `test_termEndScan_openPointsReservation_promptsTheBuyer`.
- **Verdict:** ✅ Works.

### 4. Cancel or event deletion releases the hold
- `reservation_transitions._release` posts RELEASE first. `cancel_reservations_without_commit` calls `lock_release_accounts` once. `delete_event` and `cancel_transaction` are wrapped in `mapped_transaction_conflicts`.
- Item deletion is blocked while the item is reserved (`soft_delete_item`, „Nie można usunąć — rzecz jest zarezerwowana”), so no orphaned HOLD can come from that path.
- **Evidence:**
  - `test_cancelPoints_sellerOrBuyer_releases`
  - `test_deleteEvent_twoBuyers_releasesBoth`
  - `test_pointsWrites_deadlock_returns409AndWritesNothing`, which covers PATCH, PUT, confirm, cancel and delete_event
- **Verdict:** ✅ Works.

### 5. The admin changes the config
- `PointsConfigValues` in `api/points.ts` has the four keys with backend names (`price_min_ratio`, `price_max_ratio`, `price_cap`, `price_step`).
- The server validates finiteness, two decimals, the ranges and that the cap is a multiple of the step (`config.py:30-101`).
- A save invalidates the whole `[POINTS_KEY]` prefix, so the item-value bounds in open forms refetch.
- `bounds_for` reads the config on every request.
- **Evidence:** `test_points_config_api.py` (ratio 400s including 0.505), and `PointsConfigPage` and `pointsConfigForm` tests.
- **Verdict:** ✅ Works.

### The examples the brief asked about
| Question | Finding |
|---|---|
| Does the web call match the backend wire names? | **Yes.** I checked `points_price` on the PUT and on the take, `held`, `held_amount`, `held_points`, `price_min`/`price_max`/`price_step`, and the four config keys. |
| Is the balance refreshed everywhere? | **Mostly.** The take, the item-page settle and the admin save invalidate `[POINTS_KEY]`. The confirm in `PendingActionsHost` (end-of-term prompt, `PendingActionsHost.tsx:108-111`) invalidates only notifications, and My Items cancel or confirm invalidate nothing points-related. Because `useMyPoints` has the default `staleTime: 0`, every later mount or window focus refetches, so the user never sees a stale balance on a later screen. **G4, Low.** |
| Does a My Items switch to POINTS work without a price? | **Server: yes.** With the price omitted, the server uses `clamp_price(points_value, bounds)`. **UI: partly.** `setItemMode` updates only the mode and visibility in the panel copy, and that copy wins in the merge (`MyItemsView` L132-140), so the orange price chip stays hidden until a reload. **G1, Medium (UX).** A missing photo or the offer limit gives the server's verbatim toast. |
| The ChooseContextSheet label | In POINTS mode the button reads „Rezerwuję na ten termin” (`ChooseContextSheet.tsx:73`), but a click only opens the points sheet, and the reservation happens one step later at „Zablokuj N pkt i rezerwuj”. **G2, Low.** |

## Critical Gaps
None.

## Quality Gaps
| # | Severity | Claim | Reality / Evidence | Impact |
|---|---|---|---|---|
| G1 | Medium | „MyItemsView gains the mode option Za punkty (a PUT without a price), the price chip…” | `AppDataContext.setItemMode` (L498-525) ignores `saved.points_price`, and the panel copy overrides the refetched page item, so the chip is missing until a reload. The work-log lists this as an open follow-up. | The owner doesn't see the price the server picked right after the switch. |
| G3 | Medium-Low | „A later rejection or deletion never unlists.” | That holds, but `_points_price` (L194-199) re-runs the valuation and photo checks on every POINTS PUT, including a visibility-only toggle (`setItemVisibility` re-sends `mode: POINTS`) and an edit-form price change. Once the owner's only photo is rejected or deleted, those edits get 400 „Dodaj przynajmniej jedno zdjęcie…”. | The item stays listed but its visibility and price can't be changed. The workaround is to add a photo. |
| G2 | Low | The context step before the points sheet | The button label promises a reservation that doesn't happen yet (`ChooseContextSheet.tsx:73`; SWAP already has its own „Dalej: …” label). | A wording mismatch only. |
| G4 | Low | „On success it invalidates the points … prefixes” | Only the take and `PartyReservationActions` do. `PendingActionsHost` and My Items confirm/cancel don't. | It shows only if a balance is on screen at the same time; `staleTime: 0` covers later screens. |
| G5 | Low | One shared bounds function | `term_item_listings._is_valid_price` and `_clamp_price` (L157-162) are private copies of `points/domain/pricing.py`. They are identical today but can drift. The work-log flags this. | A maintenance risk only. |
| G6 | Low | The step and cap rules | A custom `price_step` that doesn't divide 20/40/60 makes `clamp_price` store an off-step suggestion. A lowered cap leaves existing prices above it (see Open Questions). | Appears only under a non-default config. |

## Integration Issues
None that break the flows:
- The module boundaries hold: `app.points` is imported only through the groups and inventory `points_acl`, plus `main.py`.
- The lock order is accounts → item → preference, with take as the documented exception. The concurrency tests pass for parallel takes, the confirm-versus-cancel race, two-buyer event deletion and the 40P01 mapping.
- The matcher suite passed (125, from the work-log).

## Functional Completeness
About **95%** of the scoped request:
- Built: the config, the bounds, the listing, the stepper, the price on cards and the item page, HOLD/SALE/RELEASE, the login-only rule, the 5-offer limit, the pair limit, the family rule, the photo rule, the search chip, the counts, the wants offer mode, the `/points` tiles and history, and the docs and runbook.
- What remains is UI polish (G1, G2, G4) and a few edge-case hardening items (G3, G5, G6).
- The deferred parts (SALE_REFUND, the 3-correction block, the 30-day reminder) are out of scope by the user's decision.

## Pragmatic Action Plan
| # | Priority | Task | Success criteria | Effort |
|---|---|---|---|---|
| 1 | High | In `AppDataContext.setItemMode`, also write `saved?.points_price ?? null` into the panel item, the same way `setItemVisibilityLocally` writes the visibility. | Switching a card to „Za punkty” shows the orange „N pkt” chip at once. Add one MyItemsView test case. | 30 min |
| 2 | Medium | In `_points_price`, run the valuation and photo checks only when `becomes_points`, or when the request changes the price. Keep the price-bounds check for an explicit price. | A POINTS item whose photo was rejected can still toggle visibility. Add a backend test in `test_points_listing.py`. | 1 h |
| 3 | Low | Pass the mode-specific label to `ChooseContextSheet`: for POINTS, „Dalej: zablokuj punkty”, or similar copy approved by the owner. | The button text matches what the next step does. Update the ItemPickupActions/ChooseContextSheet test. | 15 min |
| 4 | Low | Add `[POINTS_KEY]` to the invalidations after a POINTS confirm or cancel in `PendingActionsHost` and `MyItemsView`, or add it to `RESERVATION_STATE_KEYS`. | Any POINTS settlement refreshes the balance queries. | 20 min |
| 5 | Low | Replace the private `_is_valid_price`/`_clamp_price` with re-exports of `points/domain/pricing.py` through `groups/infrastructure/points_acl.py`. | Only one implementation of the bounds remains; the tests still pass. | 15 min |
| 6 | Low | In `clamp_price`, round an in-range value to the step (`round_step` and then clamp). Add a runbook note that lowering the cap or the ratios doesn't re-clamp existing listings. | With step 25 and s=40, the stored price is a multiple of 25. Add one table row in `test_points_pricing.py`. | 30 min |

## Completion Verdict
⚠️ **Complete, with small gaps.**
- An owner can list an item for points at a price within the configured bounds.
- A buyer sees that price on cards and the item page, can hold it in any of the three contexts under all the business rules, and on confirm burns exactly what the seller receives.
- Cancel and event deletion return the hold, and the admin can tune all four price keys.
- Items 1 and 2 of the action plan are worth doing before or shortly after release. The rest is polish.
