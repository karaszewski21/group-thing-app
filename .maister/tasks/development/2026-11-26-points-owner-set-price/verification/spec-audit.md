# Spec Audit: POINTS mode (stage 2, part 1) with an owner-set price

## TL;DR
Verdict: **pass-with-concerns** (Mostly Compliant). No critical findings. Counts: 1 high, 6 medium, 11 low.
- The ledger rewrite is sound: debit/credit sets, a balance check under the lock, `(party_id, account_type)` keys, mutual exclusion of SALE and RELEASE, and source-key idempotency all hold. The bounds formula meets every acceptance case.
- The weak spots are the edit-form bounds source, which contradicts a binding scope decision and has no API behind it, and the /add retry after a failed PUT, which can create a duplicate item.
- Also weak: an owner-side confirm button in My Items, an inverted lock pair between PUT and PATCH, and an incomplete list of tests that will break.
- All five self-declared deviations are acceptable.

## Key Decisions
- **High severity** is used only for a gap that contradicts a binding user decision or blocks a core flow without a workaround (finding H1). Lock-order and race gaps are medium, because `mapped_transaction_conflicts` turns any residual deadlock into a 409 wherever it wraps the code.
- **Test-list omissions are medium.** They cause certain test failures, but no product defects.
- **Deviations are judged against `requirements.md` and `scope-clarifications.md`** (binding), with evidence from the code.

## Open Questions / Risks
- **OAuth clients and points.** Should `mcp:edit` clients be able to spend or burn points? Take and confirm accept `mcp:edit` (`authorization_matrix.py:213`, `:258`), while points reads exclude mcp on purpose (row 69, `:274`).
- **Edit-form bounds.** For an existing item whose stored `points_value` differs from today's preview (after an admin config or size-class change), which value bounds the price? Scope says the stored one; the spec says the preview.
- **/add after a failed PUT.** What should the screen do once the draft exists: stay (with retry PUTting the existing item) or navigate to the item?
- **Pair limit.** The spec accepts that it is not strict across GIFT and POINTS (finding L1). Confirm with the owner.

---

## 1. Verified claims (evidence)

| Claim | Evidence | Result |
|---|---|---|
| `uq_point_accounts_party_id`, `ck_point_accounts_party_id_account_type`, `uq_point_accounts_account_type_emission` exist | `app/points/models.py:74-86` | correct |
| `lock_accounts` conflicts on `party_id` and returns `{party_id: id}`, so it must change once HELD exists | `ledger.py:191-229` (`on_conflict_do_nothing(index_elements=[PointAccount.party_id])`, `.where(party_id.in_)`) | correct, R8.5 addresses it |
| `reads._account_id` uses `scalar_one_or_none` on `party_id` only; the history join matches every account of the party | `reads.py:25-28`, `:51` | correct, R9 addresses it |
| PARTY-debit guard to remove | `ledger.py:122-123`, `_require_account_types` `:150-174` (credits forced to PARTY) | correct |
| `_used_pair_slots` counts every `pair_limited` type in both directions, so SALE (pair_limited) is included automatically | `awards.py:132-153` | correct |
| CHECKs `ck_point_transactions_counterparty`/`_cap_month` already allow HOLD/SALE/RELEASE with a counterparty and no cap_month | `models.py:127-134` | correct |
| `_may_confirm` short-circuits every non-GIFT type to True, so it must add POINTS | `term_item_listings.py:882-892` | correct |
| `_require_exchange_legs` accepts only a GIFT leg or a SWAP pair | `inventory/domain/reservation_rules.py:33-48` | correct |
| Hand-over queries filter `reservation_type == GIFT` | `inventory/infrastructure/repository.py:498`, `:520` | correct (they live in the inventory repository, called through `groups/infrastructure/inventory_bridge.py:197/211`) |
| `_release` is the single cancel choke point; event deletion locks reservations FOR UPDATE first | `reservation_transitions.py:76-111` | correct |
| No other code path sets CANCELLED | grep of `ReservationStatus.CANCELLED`/cancel calls: only `event_reservations.py:102`, swap accept/reject `term_item_listings.py:1008/1051`, `cancel_exchange` `:1204` | correct, all go through `_release` |
| The term-end scan never cancels; it only prompts the taker | `term_end_scan.py:95-130`, `outbox_listener.py:88-110` | correct |
| `delete_event` runs only before start and with 0 attendees; confirm/cancel need `require_ended` | `events/service.py:269-282`; `term_item_listings.py:1137` | correct, event-delete versus confirm cannot overlap in time |
| `update_item` takes no row lock; the item is written at commit, so a hook that locks the preference first gives preference → item | `inventory_items.py:262-289` | correct |
| `on_registered` injection pattern | `inventory/router.py:152` | correct |
| `item_actions.py` L71 reads the preference row | `item_actions.py:70-71` | correct |
| Count sums at `owner_items.py` L32, `owner_pages.py` L219/L269, `organization_page.py` L77 | verified; `organization_page.py:71` (the constructor) also needs POINTS | correct |
| `_POINTS_IMPORTERS` = {main.py, groups points_acl, inventory points_acl}; `points/domain` may import only itself | `tests/test_module_boundaries.py:103-139` | correct; the plan keeps both green |
| No new matrix rows are needed | rows 60 (`:246`), take (`:213`), 64 (`:258`), 68/69 (`:273-274`) | correct |
| No DB CHECK constrains `mode`/`reservation_type`/`offer_mode` values | grep of `alembic/versions` | correct, the enum ripple needs no schema change |
| The matcher compares `l.mode = w.offer_mode` as strings | `src/matcher/matcher/statements.py:89` | correct |
| The photo upload needs the item to exist first (deviation 1) | `hooks/useCreateItem.ts:27-28`, `:48-76` | correct |
| `bg-orange` and `text-ink` tokens exist, and orange is meant to carry dark text | `globals.css:41`, `:46-47` | correct |
| Contrast (deviation 4) | computed: ink `#1e2e27` on `#ff6a0d` ≈ 4.96:1; white ≈ 2.87:1 | correct |
| Every key-set constant named in the spec exists | the 12 constants grep-verified in their files | correct |

### Acceptance arithmetic (defaults 0.5/1.5/100/10)
- s=20: min = max(10, rs(10)) = 10, max = min(100, max(10, rs(30))) = 30. Result 10–30.
- s=40: 20–60.
- s=60: 30–90.
- s=80: max = min(100, 120) = 100.
- 45 → (4.5).quantize(HALF_UP) = 5 → 50.
- 55 % 10 ≠ 0, so 55 is rejected with „Cena musi być od 20 do 60 pkt, co 10.” for s=40.
- Stored `points_value` ∈ {20, 40, 60} (`domain/valuation.py:12-17`), so the real API never exceeds 90 under the defaults. The s=80 case is reachable only in the pure domain table. That is fine.
- `cap % step == 0` plus cap ≥ 1 implies cap ≥ step, and the max stays a multiple of the step. The min>max collapse keeps the price valid.

### Ledger correctness walk-through
- **HOLD** (PARTY −p, HELD +p) and **RELEASE** (HELD −p, PARTY +p) both satisfy the debit/credit sets. The balance check on the debited PARTY/HELD account runs after `lock_accounts`.
- **SALE** has four entries: HELD −p, EMISSION −p, BURN +p, PARTY(seller) +p. Debits are {HELD, EMISSION} and credits {BURN, PARTY}; the sum is 0. EMISSION and BURN are not balance-checked, as intended.
- **SALE and RELEASE exclusion.** Confirm locks {(buyer, HELD), (seller, PARTY)} and cancel locks {(buyer, HELD), (buyer, PARTY)}. Each set is locked by one sorted `SELECT … FOR UPDATE ORDER BY`, so there is no deadlock between the two. Under READ COMMITTED, the statement after the lock sees the other side's committed SALE or RELEASE, which gives a 409. Repeats are skipped via the unique source key (`uq_point_transactions_type_source`).
- **Take races.** Two parallel takes by one buyer serialize on the buyer's PARTY lock. Cross-direction pairs (A buys from B while B buys from A) overlap on both PARTY rows and serialize, so the pair-limit count is race-free.

---

## 2. Findings

### High

**H1. The edit-form bounds source contradicts the binding scope decision, and no API supplies the correct bounds.**
- **Spec:** Visual Design `screen:item-edit-points`: "The stepper is bounded by the preview of the draft category + condition." R3.4.7 validates the PUT against `item.points_value` (the stored value).
- **Binding input:** `scope-clarifications.md` *suggestion-source*: "the stored `points_value` for an existing item, `item_value_preview` for a new one; one shared bounds function."
- **Evidence:**
  - The stored value is never recomputed (`service.py:225-230` docstring; `config.py:90-93` "stored values are never recomputed").
  - The preview recomputes from the current config and size class (`valuation.py:146-154`).
  - After an admin changes a base, a multiplier or a category `size_class`, preview ≠ stored for unchanged items. The form then shows one range and suggestion while the server validates another (400), or the form blocks prices the server would accept.
  - `GET /api/points/item-value` takes only `category_id` + `condition` (`router.py:306-315`). `points_config` is ADMIN-only (row 68), so the client cannot compute bounds for the stored value itself.
- **Category:** Contradictory and unimplementable as written.
- **Severity:** High. It breaks the price edit for every existing POINTS item after a routine admin tuning ("adjust the economy without a deploy" is a stated user story).
- **Recommendation:** Use the stored-value bounds while the draft category and condition are unchanged, and the preview only once either changes. Supply them by adding `price_min/max/step` to the owner's `MyInventoryItemResponse` (it already carries `points_value`), or by letting `/item-value` accept `points_value` or `item_id`.

### Medium

**M1. A failed PUT after creating the /add draft leads to duplicate items on retry.**
- **Spec:** `screen:item-create-points`: "register draft → photos → PUT POINTS. A PUT failure leaves the draft and shows the server message (`role="alert"`)."
- **Evidence:** `ItemCreateView.tsx:71-94`. On any error the form keeps its value and photos and stays on the page. Pressing the action again calls `createItem` again (`useCreateItem.ts:48`), which registers a second item and re-uploads the photos.
- **Severity:** Medium. Likely triggers are the 6th-offer 409, an off-step price, or a failed photo upload.
- **Recommendation:** Specify the post-failure state. Either navigate to the new draft's item or edit page with the message, or keep the created item id so a retry only re-PUTs.

**M2. My Items shows the seller a confirm button that the server will 403.**
- **Evidence:** `MyItemsView.tsx:183` sets `isGift: reservation_type === "GIFT"`, and `:497` renders `!isGift(it.id) && <button … handleConfirmReceipt>`. A POINTS reservation is not "GIFT", so the seller sees „Potwierdź”, which R6.1 makes a 403.
- **Spec:** The MyItemsView row lists only the mode option, chip, filter and count.
- **Recommendation:** Treat POINTS like GIFT there, or better, drive the button from `can_confirm`.

**M3. The lock-order narrative is not a total order: PUT is item → preference, while the re-valuation hook and confirm are preference → item.**
- **Spec:** Technical Approach lists "new POINTS listing: owner accounts → item FOR UPDATE → preference" and "re-valuation: preference FOR UPDATE → item row". Key Decision: "The hook locks the preference before the item row is written, which keeps confirm's order."
- **Evidence:**
  - `set_item_listing_preference` locks the item first (`term_item_listings.py:164`), then writes the preference.
  - `update_item` writes the item at commit (`inventory_items.py:287`), so with the hook it runs preference → item.
  - Confirm deletes the preference and then sets the item's `listing_status` (`term_item_listings.py:1180-1185`), which is also preference → item.
  - A concurrent price-edit PUT plus a condition PATCH, or a PUT plus a confirm, on the same item can therefore deadlock. Price and mode edits while reserved are now a feature (R3.5).
  - PUT and confirm are wrapped (409), but `update_item` is not, so a deadlock victim there is a 500.
- **Recommendation:** Wrap `update_item`'s hook path in `mapped_transaction_conflicts`, or have the hook take the item lock first (`get_item_for_update`) and the preference second, matching PUT. Fix the lock-order text so it does not claim more than it guarantees.

**M4. The "already POINTS" decision is read before the item lock (TOCTOU), so the `max_points_offers` mutex can be skipped.**
- **Spec:** R3.4.2 says "When the item is not already POINTS, lock the owner's point accounts … before `get_item_for_update`." R3.4.6 runs the limit only "when the item becomes POINTS".
- **Gap:** The preference has to be read unlocked to decide whether to take the account lock. A concurrent POINTS→GIFT switch committed in between means the request finds "becomes POINTS" under the item lock without holding the account mutex. It cannot take it then without inverting the order.
- **Recommendation:** Re-check under the item lock. When the item now *becomes* POINTS and no account lock was taken, refuse with a 409 „odśwież” (or restart), and state this in R3.4.

**M5. The exact-key-set and constraint test list is incomplete; these tests will fail.**
- **`tests/test_points_migration.py:122-134`** asserts at head that `uq_point_accounts_party_id` ⊂ constraints. 0109 drops it, so the set must swap to `uq_point_accounts_party_id_account_type` and add `uq_point_accounts_account_type_burn` to the indexes.
- **`tests/test_wants_similar_api.py:23`** has `META_KEYS = {"mode", "condition", "thumb_url", "reserved", "reserved_until"}`. `WantMatchMeta` is shared by matches, suggestions and similar (`wants/schemas.py:99,112,125`), so `points_price` breaks it too. Check the suggestions tests as well.
- **`tests/test_term_item_listings_router.py:264-286`** holds the exact frozenset of `MyInventoryItemResponse` keys, which gains `points_price` (R4).
- **Test helpers** use `select(PointAccount.id).where(PointAccount.party_id == …)` with `scalar_one_or_none`: `test_points_awards.py:152` and `test_points_awards_contexts.py:100`. They break as soon as a new POINTS test reuses them for a party that has a HELD account.
- **Recommendation:** Add all of these to "Exact key-set test updates".

**M6. OAuth `mcp:edit` clients can spend and burn a person's points, but cannot read the balance.**
- **Evidence:**
  - Take, row `authorization_matrix.py:213`: `("EDIT", "mcp:edit")`.
  - Confirm/cancel, row 64 `:258`: `("EDIT", "mcp:edit")`.
  - Points reads, row 69 `:274`: `("READ",)` only. The points docs say "without the OAuth `mcp:*` scopes".
- **Problem:** With this spec, a POINTS take through an MCP token moves the user's balance into HELD, and a confirm burns it. The "no new matrix rows" claim is true, but this new capability on existing rows is not discussed.
- **Recommendation:** Decide explicitly. Either refuse `reservation_type=POINTS` for OAuth-issued principals (for example a 403 in `_take` when the principal carries scopes), or document it as an accepted risk in security.md and architecture.md.

### Low

**L1. The pair limit is not strict across GIFT and POINTS.**
- Open holds count only inside `lock_purchase`. `award_exchange` (GIFT/SWAP confirm) still uses `_used_pair_slots` without open holds (`awards.py:73-75`), and SALE is never re-checked.
- So a GIFT confirm can take the slot an open hold "reserved", and the later SALE posts beyond `pair_reward_limit`. Burn = emission still holds.
- Recommendation: count open holds in `award_exchange` too, or record the accepted overshoot (at most the number of open holds).

**L2. Event deletion takes account locks one reservation at a time, in reservation-id order.**
- `cancel_reservations_without_commit` loops `_release` per row (`reservation_transitions.py:106-110`), so `release_hold` locks per reservation, not in one global (party_id, account_type) order. This contradicts "One total order means no deadlocks".
- Two concurrent deletions with crossed buyers can deadlock. `delete_event` is not wrapped in `mapped_transaction_conflicts` (`events/service.py:269-299`), so the result is a 500.
- The case is rare (zero attendees is required). Recommendation: pre-lock all buyers' accounts once, sorted, or wrap the deletion.

**L3. Frontend ripple sites are missing from R11. Typecheck catches some; behaviour or layout gaps catch the rest.**
- **HomeView:** `features/panel/HomeView.tsx:91-92` renders `ITEM_MODES` in a `grid-cols-2`. A third mode changes the home tiles; no mockup or decision covers this.
- **appHelpers maps:** `utils/appHelpers.ts:90-114`, where `ItemMode`, `ITEM_MODE_TONE`, `ITEM_MODE_STYLE`, `ITEM_MODE_TO_RESERVATION_TYPE` and `RESERVATION_TYPE_TO_ITEM_MODE` all need POINTS (the spec names only ITEM_MODES).
- **ReservedItemsView:** `features/items/ReservedItemsView.tsx:8-16` has the MODE_LABEL/MODE_TONE Records. No screen shows the new `MyReservationResponse.points_price`, although R4 and the success criteria say my reservations show it.
- **Reservation type:** `api/reservations.ts:3` (`ReservationType` without POINTS).
- **Wanted:** `features/wanted/wantText.ts:5` (`OFFER_MODE_LABEL`) and `wantFormViewState.ts:67` (URL `offerType` accepts only GIFT/SWAP).
- **Pending actions:** `components/layout/pending/pendingActions.ts:124` is correct by fall-through. Name it so it is not "fixed".

**L4. The create-screen mode group is ambiguous for GIFT and SWAP.**
- Today /add has direct submit buttons Oddam, Zamienię and Wersja robocza (`ItemCreateView.tsx:130-155`). The spec says "A third mode „Za punkty” (`aria-pressed` group)", and the mockup shows a mode chooser plus a single submit.
- State whether GIFT and SWAP also move to choose-then-submit, or whether only POINTS opens a sub-panel.

**L5. The admin live example is a client float mirror of `price_bounds`.**
- The ratios arrive as `float` (`PointsConfigResponse`, R1.2), and `s × ratio` in JS floats can sit just below a .5 boundary (for example 30 × 1.15 = 34.4999…), so a half-up mirror diverges from the Decimal one for step 1.
- Require integer-hundredths arithmetic (ratio × 100 as an int) in the mirror.

**L6. The limit message differs from the mockup despite the "server texts are the mockup's texts" rule.**
- The mockup says „Masz już 5 ofert za punkty — to maksimum”; the spec rewords it to „Masz już maksymalną liczbę ofert za punkty ({n}).”
- The reason (Polish plural forms) is plausible. Record it as a deliberate exception to Key Decision 10, or keep the mockup text with a plural helper.

**L7. HOLD's `party_id` and `counterparty_party_id` are not stated.**
- R7 states RELEASE's counterparty and R6 states SALE's party and counterparty, but HOLD's (presumably party = buyer, counterparty = seller) is left implicit.
- The "open holds of the pair" query and the history's `other_party` both depend on it. State it in R5.2.4.

**L8. Some parameters are left implicit.**
- `lock_owner_accounts` does not say which account types it locks (PARTY only is enough for the mutex). Pin it down so take, which locks seller PARTY, and listing agree.
- `lock_accounts` now returns tuple keys, so the stage-1 call sites `accounts[party]` (`awards.py:127`, `:202`) and `_attendance_in_cap_month(accounts…)` (`awards.py:208-223`) must change. List them.
- `PointAccount.__table_args__` must mirror the new constraints, and `ledger.emission_account_id` becomes `system_account_id`.

**L9. The photo rule interacts with shared products.**
- Products are resolved by name within a category and shared (`useCreateItem.ts:45`), and a product holds at most 10 photos (`product/models.py:100`).
- An owner whose product is already full cannot add an own photo, so they cannot list for POINTS. An owner who uploaded a photo to the same product for an earlier item passes the server check while the /add hint ("no photo picked") blocks them.
- State the intended behaviour, or accept it.

**L10. The R8 allowlist leaves out `held_points`.**
- `held_points` (on `ItemPartyReservationResponse`) contains "point". The probe passes only because `party_reservation` is null for an unreserved item.
- Document `held_points` as a party-only field in the probe's allowlist comment, or add a reserved-POINTS-item case to the probe.

**L11. Minor reference and naming inaccuracies.**
- `item_privacy._TERM_DATED_MOVEMENTS` lives in `app/inventory/domain/item_privacy.py:27`.
- `ItemEditView.tsx` is in `features/items/`, not `features/product/`.
- `MultiplierField` is a type union in `pointsConfigForm.ts:16`, not a component, and its 0.01–9.99 rule does not fit the ratio ranges. The ratios need their own rules.
- `MyReservationResponse.points_price` carries the HOLD amount; `held_points` would be the consistent name.

---

## 3. Self-declared deviations

| # | Deviation | Verdict | Reason |
|---|---|---|---|
| 1 | POINTS only via PUT after photos | **Accept** | The photo rule (binding) needs an owner photo, and the photos are uploaded only after the item exists (`useCreateItem.ts:27-28`). Requirement 3 "set on create" cannot be met atomically. Fix M1 for the failure path. |
| 2 | Price on `/actions`, not `/details` | **Accept** | `/details` carries no mode. `/actions` is public (anonymous OK, R8 probe line 241), already carries `mode` and is personalised-cached. The item page still shows the price, which is the user-visible requirement. |
| 3 | PUT without a price takes the clamped suggestion | **Accept, with a note** | It matches scope *condition-change* ("without one, the stored price is clamped"). The My Items switch then lists without an explicit price choice, but the price chip shows it at once and the edit form adjusts it. |
| 4 | Ink text on orange | **Accept** | Computed 4.96:1 versus 2.87:1 for white. `globals.css:46` already says "dark text on it". |
| 5 | Schema and seed in one revision | **Accept** | One BURN row, with the precedent of 0104's `attendance_points`. The NOT NULL temporary server defaults are also needed because `test_points_migration.py` re-seeds config at 0104 and upgrades to head. Record the exception in the migration docstring and the runbook. |

## 4. Migration 0109 and runbook check
- Upgrade order is fine: config columns with temporary defaults, the preference column and CHECKs, the account constraints (drop the old unique before adding the composite), then the BURN row. Existing rows satisfy `(mode='POINTS') = (points_price IS NOT NULL)`.
- The downgrade guards (HOLD/SALE/RELEASE, POINTS preferences, POINTS reservations) cover every row that would make it lossy. POINTS movements come only from fulfilled POINTS reservations, so they are covered too.
- Once the guard passes, deleting the HELD and BURN accounts is safe (they have no entries), and restoring the `party_id` unique is then valid.
- `wants.offer_mode='POINTS'` left in place is harmless for reads (`WantResponse.offer_mode: str`), but the old image's `UpdateWantRequest` (`Literal["GIFT","SWAP"]`) rejects re-saving such a want. Note it in the runbook.
- The refusal test must restore head in `finally` (backend-testing standard). The spec names `_alembic` from `test_personal_pickup_migration.py:40`.

## 5. Recommendations (ordered)
1. Fix H1 (the stored-value bounds source) before planning the edit task group.
2. Specify the post-failure behaviour of /add (M1). Make the My Items confirm button POINTS-aware (M2).
3. Correct the lock-order section and wrap the PATCH hook (M3). Add the under-lock re-check for "becomes POINTS" (M4).
4. Extend the key-set and constraint test list (M5).
5. Get an owner decision on `mcp:edit` spending points (M6).
6. Fold the low items into the plan's frontend ripple list and the ledger and API wording.
