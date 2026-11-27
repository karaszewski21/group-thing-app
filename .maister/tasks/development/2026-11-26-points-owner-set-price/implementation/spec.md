# Specification: POINTS mode (stage 2, part 1) with an owner-set price

## TL;DR
POINTS becomes a third listing mode. The owner picks `points_price` within bounds around the item's stored `points_value`, served by `GET /api/points/item-value?item_id=` (owner-only) and enforced by the same function on PUT.
„Biorę” posts HOLD (buyer PARTY → buyer HELD). The buyer's confirm posts a 4-entry SALE (HELD −p, BURN +p, EMISSION −p, seller +p). Any cancel posts RELEASE from inventory's single cancel transition. POINTS take and confirm need a login token; OAuth `mcp:*` tokens get 403.
The ledger moves to declared debit/credit types, a non-negative balance check and one account per (party, type), under one lock order: accounts → item → preference. Migration 0109 has a guarded downgrade.
`points_price` and `held_points` become the R8 exceptions. Eight binding mockup screens are implemented, and /add retries only the PUT after a failure.

## Key Decisions
- **No new routes and no new matrix rows.** `GET /api/points/item-value` gains an `item_id` query form under row 69 (`READ`, no mcp). Everything else uses existing rows: 60 (PUT preference), the take|propose row, 64 (confirm/cancel). Rationale: minimal implementation.
- **POINTS take and confirm need a login token (user decision 1).** The use case checks that the principal holds `PERMISSION_EDIT`; a token with only `mcp:edit` gets 403. A matrix carve-out cannot work, because the take and confirm paths do not name the reservation type. This mirrors row 69 (`READ`, not `mcp:read`). Cancel and listing stay open to `mcp:edit`, since neither spends points.
- **Bounds for an existing item come from its stored `points_value` (user decision 2).** `GET /api/points/item-value?item_id=…` is owner-only: an unknown or deleted item gets 404 before the ownership 403. It returns the stored value as the suggestion plus the bounds computed from it. The edit form and PUT both use this source. A new item, and an edit draft whose category or condition changed, still use the category + condition preview. That preview is the value PATCH will store, so it serves only as a forecast.
- **Listing for points happens only through PUT `/api/item-listing-preferences/{id}`.** `POST /api/inventory-items` keeps `listing_mode` ∈ {GIFT, SWAP, null}. The /add flow registers a draft, uploads the photos, then PUTs `{mode: POINTS, points_price}`. Rationale: the photo rule needs an owner photo, and a photo can only be uploaded after the item exists.
- **/add after a failed POINTS PUT (user decision 3).** The form stays and keeps the created draft's id. A retry repeats only the PUT, never `createItem`, so no duplicate item is created. If the user leaves, the draft stays in My Items.
- **One lock order everywhere (M3):** point accounts (sorted by party_id, account_type) → item row FOR UPDATE → preference row. PUT, the PATCH re-valuation and confirm all follow it. Take is the only path that locks the preference before the accounts. This is safe because take locks no item row, and every path that holds accounts and then wants a preference targets an item that is not takeable POINTS (see Technical Approach). `update_item` and `delete_event` are wrapped in `mapped_transaction_conflicts`, so a residual deadlock is a 409.
- **The "becomes POINTS" decision is re-checked under the item lock (M4).** PUT reads the preference without a lock to decide whether to take the owner's account lock. Under the item lock it reads the preference again. If the answer changed in either direction, it returns 409 „Oferta zmieniła się w międzyczasie — odśwież.” and writes nothing.
- **On PUT, `points_price` may be omitted for POINTS.** The server keeps the current POINTS price, or uses the suggestion clamped into the bounds. Rationale: the My Items mode switch needs no stepper.
- **Condition or category changes clamp through a router-injected hook** (`on_revalued`, the `on_registered` pattern), because inventory never imports groups. `update_item` locks the item first, then the hook locks the preference.
- **`/api/public/items/{id}/details` is unchanged.** The item page reads `points_price` from `/actions`, which already carries `mode`.
- **Wants match cards get `meta.points_price`.** Term-listing responses do not; their cards fall back to „Za punkty”.
- **HOLD is the price snapshot.** SALE and RELEASE use the HOLD amount. `MyReservationResponse` and `ItemPartyReservationResponse` both expose it as `held_points` (L11).
- **The R8 allowlist is `{"points_price", "held_points"}` (L10).** `held_points` keeps its name and is documented as a party-only field. The probe adds a reserved POINTS item case.
- **Confirm never re-checks the pair limit or the family rule.** Both are checked at take, where the pair's open holds count as used slots. GIFT/SWAP planning ignores open holds (user decision 4; see Risks).
- **SALE and RELEASE exclude each other under the account lock.** The second one gets 409 „Ta transakcja została już rozstrzygnięta”. A repeat of the same one is skipped via its source key.
- **`max_points_offers` uses the owner's PARTY account as a mutex.** It is locked only when an item becomes POINTS. `lock_owner_accounts` locks exactly `(owner, PARTY)`, the same key take locks for the seller.
- **Bounds guard.** `price_max = min(cap, max(step, round_step(s × max_ratio)))`. This changes nothing for the defaults.
- **Server texts are the mockup's texts, with one exception (L6).** The offer-limit 409 is the number-neutral „Masz już maksymalną liczbę ofert za punkty ({n}).” instead of the mockup's „Masz już 5 ofert za punkty — to maksimum.”, because the backend has no Polish plural helper and the cap is configurable.
- **/add uses one mode group with one submit for all three modes (L4).** The mockup's `aria-pressed` group Oddam / Zamienię / Za punkty applies to all three modes, with Oddam preselected. One primary button follows the group: „Wystaw” for GIFT/SWAP and „Wystaw za N pkt” for POINTS. „Wersja robocza” stays as the secondary action in every mode (the mockup's „Zapisz jako szkic” is the same action, so it keeps one name).
- **The photo rule is checked only on the server (L9).** The /add hint covers only the common case, where no photo is picked. The edge cases with shared products are accepted (see Risks).
- **One revision, 0109, holds schema plus seed.** This is a recorded exception to "separate schema and data migrations", like 0104's `attendance_points`.
- **The badge, button and Home tile use `bg-orange text-ink`.** Ink on orange is about 5:1; white is about 2.9:1.

## Open Questions / Risks
- **The pair limit is not strict across GIFT and POINTS (accepted, user decision 4).** `award_exchange` (GIFT/SWAP confirm) counts used slots without open POINTS holds, and SALE never re-checks. A GIFT confirm can take a slot that an open hold has reserved, and the later SALE then posts beyond `pair_reward_limit`. The overshoot is at most the pair's open holds. Burn still equals emission.
- **Shared products and the photo rule (accepted, L9).** Products are shared by name within a category and hold at most 10 photos. If the product is full and none of its photos is the owner's, the owner cannot list for points: the upload fails and the PUT gets 400 (the draft is kept). If the owner already uploaded a photo for an earlier item of the same product, the server accepts the listing, but the /add hint blocks it while no photo is picked. The owner can then list from My Items or the edit form.
- **Held points can stay locked indefinitely.** A term or event reservation cannot be resolved before its date, and there is no auto-confirm. Accepted: the seller can cancel, and the 30-day reminder is deferred.
- **The ledger contract changes for the first time.** PARTY debits become possible. The non-negative check runs inside `post_points` against the locked balance. The ledger tests are rewritten deliberately.
- **Every account read keyed by `party_id` must also filter `account_type`.** This covers `reads._account_id`, the history join, the stage-1 `lock_accounts` callers (R8.5) and the test helpers (M5).
- **The RFC 8693 bridge token carries `EDIT`** (`mcp:edit` maps to `EDIT`). It therefore passes the login check, just as it passes row 69's `READ` today. This is unchanged behaviour and is recorded, not fixed.
- **POINTS listings start matching wants with `offer_mode` NULL.** This is intended. The matcher suite must run.
- **No image-only rollback past 0109.** The downgrade refuses while any POINTS data exists, and the recovery is the pre-0109 dump. An old image's `UpdateWantRequest` rejects re-saving a want with `offer_mode='POINTS'`; the runbook notes this.
- **Stage-1 record superseded.** "Frozen at listing, may only lower" and "badge without the price" are replaced by this task's decisions.

## Goal
Let people spend their points: owners list an item for an owner-set price within system bounds, buyers reserve it by holding that price, and the buyer's confirmation burns the held points while the seller receives the same amount, so the points in circulation do not change.

## User Stories
- As an **owner**, I want to list an item „Za punkty” at a price I choose within the allowed range, so that I can earn points for things I no longer need.
- As an **owner**, I want the form to show the system's suggestion and the allowed range, so that I pick a fair price without guessing.
- As a **buyer**, I want to see the price on cards, in search and on the item page, so that I know what an item costs before opening it.
- As a **buyer**, I want the reservation sheet to show my available balance and what remains after the reservation, so that I know whether I can afford it.
- As a **buyer**, I want my points only held, not spent, until I confirm the pickup, so that I don't lose them if the hand-over fails.
- As a **seller**, I want to receive the price when the buyer confirms, and to be able to cancel (returning the hold), so that a no-show never blocks my item.
- As a **logged-in person**, I want `/points` to show available, held and reputation, and to label holds, sales, purchases and releases in my history.
- As an **admin**, I want to tune the price ratios, cap, step and offer limit, so that the economy can be adjusted without a deploy.

## Core Requirements

### R1 Config (`points_config`, admin page)
1. New columns:

   | Column | Type | Seed |
   |---|---|---|
   | `price_min_ratio` | NUMERIC(4,2) NOT NULL | 0.50 |
   | `price_max_ratio` | NUMERIC(4,2) NOT NULL | 1.50 |
   | `price_cap` | INTEGER NOT NULL | 100 |
   | `price_step` | INTEGER NOT NULL | 10 |

   `max_points_offers` (already stored) is now enforced. Remove "not enforced" from the `PointsConfig` docstring.
2. `PointsConfigResponse` gains the four keys. Ratios are `float`, like the multipliers. `UpdatePointsConfigRequest` gains them as required: `Decimal` ratios and `int` cap/step (a full replace, `extra=forbid`).
3. Validation in `application/config.py`, Polish 400s, first match wins:
   - `price_cap` joins `_INTEGER_FIELDS` as („Cena maksymalna”, 1, 1000), and `price_step` as („Krok ceny”, 1, 100).
   - `price_min_ratio`: finite, two decimals, 0.01–1.00, else „Minimum ceny musi być liczbą od 0,01 do 1,00.”
   - `price_max_ratio`: finite, two decimals, 1.00–3.00, else „Maksimum ceny musi być liczbą od 1,00 do 3,00.”
   - `price_cap % price_step == 0`, else „Cena maksymalna musi być wielokrotnością kroku ceny.” Since the cap is at least 1, this also makes cap ≥ step.
4. `update_config` writes the four fields (the `updated_at` compare → 409 is unchanged).

### R2 Price domain (`app/points/domain/pricing.py`, pure)
1. `round_step(x: Decimal, step: int) -> int` = `(x / step).quantize(Decimal(1), ROUND_HALF_UP) × step`. Never Python `round()`.
2. `price_bounds(s, min_ratio, max_ratio, cap, step) -> PriceBounds(min, max, step)`:
   - `max = min(cap, max(step, round_step(s × max_ratio)))`
   - `min = max(step, round_step(s × min_ratio))`
   - when `min > max`, `min = max`
3. `is_valid_price(p, bounds)`: `bounds.min ≤ p ≤ bounds.max` and `p % step == 0`.
4. `clamp_price(p, bounds)`: the nearest bound when outside, else `p`.
5. Table-tested acceptance cases (defaults 0.5/1.5/100/10):
   - s=20 → 10–30
   - s=40 → 20–60
   - s=60 → 30–90
   - no s gives a maximum above 100 (s=80 → max 100)
   - 55 is invalid (step)
   - `round_step(Decimal(45), 10) == 50`
6. The application facade (`application/pricing.py`, re-exported from `service.py`) offers:
   - `bounds_for(db, suggestion)`, which loads the config and returns `PriceBounds`
   - `offer_rules(db)`, which returns `max_points_offers`
7. **`GET /api/points/item-value`** (row 69, `READ`, no mcp) returns `{points_value, price_min, price_max, price_step}` in two query forms:
   - `?item_id=…` (an existing item): owner-only. The item is read through `points/infrastructure/inventory_acl.py` (Core refs: `inventory_items` joined to `inventories.owner_user_id`, `deleted_at IS NULL`). An unknown or deleted item → 404, checked before the ownership 403. The caller's user id comes from `points/infrastructure/users_acl.py`. `s` is the stored `points_value`. When it is NULL, all four fields are null.
   - `?category_id=…&condition=…` (a new item, or an edit draft whose category or condition changed): as today, plus the bounds for `s = item_value_preview`.
   - Exactly one form is required: both or neither → 400 „Podaj item_id albo category_id i condition.”
   - PUT validates with the same `bounds_for`, so the item_id form and the server never disagree.

### R3 Listing for POINTS (groups)
1. **Enum ripple (backend):**
   - `inventory.models.ReservationType.POINTS` and `MovementType.POINTS`.
   - `inventory/infrastructure/ledger.py::MOVEMENT_RULES[POINTS]`, the same rule as GIFT.
   - `app/inventory/domain/item_privacy.py::_TERM_DATED_MOVEMENTS` gains POINTS.
   - `groups.schemas._OFFERABLE_RESERVATION_TYPES` gains POINTS, `ExchangeMode = Literal["GIFT", "SWAP", "POINTS"]`, and the `_validate_mode` message becomes „mode may only be SWAP, GIFT or POINTS”.
   - `inventory.schemas._LISTING_MODES` stays {SWAP, GIFT} (Key Decisions).
   - `my_reservations._MODES` gains POINTS.
   - `wants.schemas.OfferMode` gains POINTS.
   - The search `offer_type` and the pages schemas widen through `ExchangeMode`.
2. **Model:** `ItemListingPreference.points_price: Mapped[int | None]`, SmallInteger, nullable. The CHECKs are mirrored in `__table_args__`:
   - `ck_item_listing_preferences_points_price` `(mode = 'POINTS') = (points_price IS NOT NULL)`
   - `ck_item_listing_preferences_points_price_positive` `points_price IS NULL OR points_price > 0`
3. **`SetItemListingPreferenceRequest` gains `points_price: int | None`.**
   - It is refused with any mode other than POINTS (400 „Cena w punktach dotyczy tylko oferty za punkty.”).
   - It is optional with POINTS (Key Decisions).
   - `ItemListingPreferenceResponse` gains `points_price`.
4. **`set_item_listing_preference` for `mode = POINTS`**, in this order (steps 2–9 inside `mapped_transaction_conflicts`):
   1. Profile.
   2. **Pre-lock decision:** read the preference without a lock. `becomes_points` = no row, or a row whose mode is not POINTS. When `becomes_points`, lock `(owner, PARTY)` through `points_acl.lock_owner_accounts(db, party_id)`.
   3. Item FOR UPDATE, then the ownership check (403) and the live-location rule as today.
   4. **Re-check (M4):** read the preference again, now under the item lock. If `becomes_points` computed now differs from step 2, return 409 „Oferta zmieniła się w międzyczasie — odśwież.” and write nothing.
   5. **Valuation:** a NULL `points_value` → 400 „Tej rzeczy nie można wystawić za punkty — brak wyceny.”
   6. **Photo rule:** the item's product must have at least one `ProductPhoto` with `uploaded_by_user_id` = the owner's account user and `status != REJECTED`, else 400 „Dodaj przynajmniej jedno zdjęcie, aby wystawić za punkty.” The check goes through a new `product_service.has_own_unrejected_photo(db, product_id, user_id)`, exposed via `groups/infrastructure/product_bridge.py`. A later rejection or deletion never unlists.
   7. **Limit (only when `becomes_points`):** count the owner's preferences with `mode = 'POINTS'`, reserved ones included, excluding this item. When the count is ≥ `max_points_offers`: 409 „Masz już maksymalną liczbę ofert za punkty ({n}).” Lowering the cap never unlists.
   8. **Price:** `bounds = points_acl.price_bounds(db, item.points_value)`, which uses the stored value.
      - A sent price must pass `is_valid_price`, else 400 „Cena musi być od {min} do {max} pkt, co {step}.”
      - An omitted price keeps the existing POINTS price, or uses `clamp_price(points_value, bounds)`.
   9. Write `mode`, `points_price` and `visibility`, set ACTIVE, and commit.
5. **Non-POINTS modes:** writing GIFT/SWAP sets `points_price = NULL`. Clearing the mode deletes the row (as today). Price and mode edits are allowed while reserved; an open reservation still settles at its HOLD.
6. **Re-valuation hook (M3):** `inventory.application.inventory_items.update_item(…, on_revalued=None)`. The router passes `term_item_listings.clamp_points_price`.
   - `update_item` first works out whether the product or condition changes. When one does, it locks the item row through `get_item_for_update` before assigning any attribute. It then computes the new `points_value` and calls `on_revalued(db, item_id, new_value)`.
   - The hook locks the item's preference FOR UPDATE. When the preference is POINTS and its price is outside the new bounds, it writes `clamp_price(...)`.
   - All of `update_item` runs inside `mapped_transaction_conflicts`, so a deadlock or serialization failure is a 409, not a 500.
   - The PATCH request schema is unchanged.
7. **Counts** gain a `POINTS` key: `MyInventoryItemCountsResponse` (ALL/GIFT/SWAP/POINTS), `OwnerItemCountsResponse`, `OrganizationItemStatsResponse`. Sums become GIFT + SWAP + POINTS in `owner_items.py` L32, `owner_pages.py` L219/L269, and `organization_page.py` L71 (the constructor) and L77.

### R4 Visibility (R8 exception)
`points_price: int | None` is non-null exactly for POINTS listings. `held_points: int | None` is the HOLD amount of a POINTS reservation, shown only to its parties. They are added to:

| Response | Field | Source |
|---|---|---|
| `ItemActionsResponse` | `points_price` | the preference row `item_actions.py` already reads (L71) |
| `ItemPartyReservationResponse` | `held_points` (both parties) | `points_acl.hold_amounts` |
| `MyInventoryItemResponse` | `points_price` | preference row |
| search `ProductResultMeta` | `points_price` | search `groups_acl` (preference column) |
| `pages` `OwnerItemCardResponse` (owner/organizer/party items, organization layouts) | `points_price` | pages `groups_acl` rows |
| events `EventParticipantItemResponse` | `points_price` | `groups_acl.item_listing_preferences_select` |
| wants `WantMatchMeta` (shared by matches, suggestions and similar) | `points_price` | wants `groups_acl` |
| `MyReservationResponse` | `held_points` (POINTS rows, null otherwise) | `points_acl.hold_amounts` |

- **The R8 probe** `test_points_valuation.py::test_itemResponses_valuedListedItem_carryNoPointsField` gets `_R8_ALLOWED = {"points_price", "held_points"}`. The comment says that `held_points` is party-only. The probe covers a GIFT item, a POINTS item, and a reserved POINTS item seen by a third person. It asserts that no key containing "point" outside the allowlist appears. For the GIFT item, `points_price` is null wherever it is present. For the third person, `party_reservation` and therefore `held_points` are absent.
- The `points_value` suggestion appears only in the owner's form (`/item-value`) and in `MyInventoryItemResponse`. Balance, held and reputation stay owner-only.

### R5 Take (HOLD)
1. **`ItemTakeRequest.points_price: int | None = None`:**
   - required when `reservation_type == POINTS` (400 „Podaj cenę w punktach.”)
   - refused otherwise (400 „Cena w punktach dotyczy tylko oferty za punkty.”)
2. **Login token only (user decision 1):** in `take_item`, right after the profile, a POINTS take by a principal without `PERMISSION_EDIT` → 403 (`AccessDeniedException`), before any read or write. One helper, `require_login_principal(principal)`, sits next to the use cases in `groups/application/term_item_listings.py` and serves both take and confirm.
3. **In `_take`, after the mode check, for POINTS** (all inside `mapped_transaction_conflicts`):
   1. `data.points_price != preference.points_price` → 409 „Cena zmieniła się — odśwież.”
   2. `purchase = await points_acl.lock_purchase(db, buyer_party_id, seller_party_id, price)` locks and checks:
      - both parties must be eligible persons with a login, else 409 „Za punkty mogą kupować tylko osoby z kontem.”
      - a shared active family → 409 „Nie można kupować za punkty od członka własnej rodziny.”
      - it locks buyer PARTY + HELD and seller PARTY (created lazily) in one sorted `lock_accounts` call
      - pair limit: `_used_pair_slots` (incl. SALE) + the pair's open holds (HOLDs without a SALE/RELEASE of the same source id, any age, either direction, matched on `party_id`/`counterparty_party_id`) ≥ `pair_reward_limit` → 409 „Limit nagród dla tej pary został wyczerpany — spróbuj za kilka dni.”
      - buyer PARTY balance < price → 409 „Za mało punktów — ktoś był szybszy albo masz inne blokady.”
   3. `create_reservation(…, reservation_type=POINTS, commit=False)` as for GIFT.
   4. `points_acl.post_hold(db, purchase, reservation_id, product_name)` posts HOLD with **`party_id` = buyer and `counterparty_party_id` = seller** (L7). The open-holds query and the history's `other_party` rely on this.
   5. Notifications: as GIFT, with „ za {p} pkt” after the product name in both texts.
4. A SWAP still redirects to propose. GIFT is unchanged (no account lock, `mcp:edit` still allowed).

### R6 Confirm (SALE)
1. `_may_confirm`: GIFT **and POINTS** are confirmed by the recipient only. `transaction_action_flags` inherits this, so the seller gets `can_confirm = false`, `can_cancel = true`.
2. **Login token only:** `confirm_transaction`, after resolving the reservations, calls `require_login_principal` when the reservation is POINTS (403 for an `mcp:edit`-only token). Cancel is not restricted.
3. `_require_exchange_legs` accepts one GIFT leg, **one POINTS leg**, or two paired SWAP legs. The message becomes „Wymiana to jedna rezerwacja GIFT albo POINTS albo dwie sparowane rezerwacje SWAP”.
4. **Lock order (M3):** inside the existing `mapped_transaction_conflicts`, confirm becomes: `points_acl.award_exchange` (point accounts) → for each leg in item-id order, `inventory_bridge.get_item_for_update` → preference read and delete → DRAFT → `fulfill_exchange`. The new item lock comes before the preference delete.
5. `award_exchange` routes a POINTS reservation to `points_service.settle_sale(db, reservation_id)`, which:
   - reads the HOLD transaction and its entries (a missing HOLD → `LedgerInvariantError`)
   - locks buyer HELD + seller PARTY in one sorted call
   - returns 409 „Ta transakcja została już rozstrzygnięta” when a RELEASE exists, and skips when a SALE exists
   - posts SALE: HELD(buyer) −p, BURN +p, EMISSION −p, PARTY(seller) +p, with `party_id` = seller, `counterparty` = buyer and the HOLD's description
   - makes no eligibility, family or pair re-check, and posts no WISHLIST_MATCH, GIVE_FREE or reputation
6. The hand-over queries `list_active_hand_over_reservations_for_terms/_events` (in `inventory/infrastructure/repository.py`) filter `reservation_type IN (GIFT, POINTS)`.

### R7 Cancel (RELEASE)
1. `inventory/application/reservation_transitions._release` calls `points_acl.release_hold(db, reservation)` **first**, before mutating any row, when `reservation_type == POINTS`. This covers `cancel_exchange`, `cancel_reservations_without_commit` (event deletion) and any future cancel path.
2. `release_hold`:
   - locks the buyer's HELD + PARTY accounts
   - returns 409 „Ta transakcja została już rozstrzygnięta” when a SALE exists, and skips when a RELEASE exists
   - posts RELEASE: HELD −p, PARTY +p (`party_id` = buyer, counterparty = seller)
3. `cancel_transaction` wraps `cancel_exchange` in `mapped_transaction_conflicts`.
4. **Event deletion (L2):** `cancel_reservations_without_commit` locks its reservations FOR UPDATE in id order as today. Before the per-row loop, it calls `points_acl.lock_release_accounts(db, reservations)`. That call reads the HOLDs of the open POINTS rows in one query and locks every buyer's (HELD, PARTY) in one sorted `lock_accounts` call. The per-row `release_hold` then re-locks rows it already holds and never waits. `events/service.delete_event` runs inside `mapped_transaction_conflicts`. This is safe against confirm, which cannot run before the event starts, while deletion with open reservations runs only before the start.

### R8 Ledger schema and contract
1. Enums: `PointAccountType` gains HELD and BURN; `PointTransactionType` gains HOLD, SALE and RELEASE. `PointSourceType` is unchanged (all three use RESERVATION).
2. Account constraints (0109), mirrored in `PointAccount.__table_args__`:
   - drop `uq_point_accounts_party_id`
   - add `uq_point_accounts_party_id_account_type (party_id, account_type)`
   - recreate `ck_point_accounts_party_id_account_type` as `(account_type IN ('PARTY','HELD') AND party_id IS NOT NULL) OR (account_type IN ('EMISSION','BURN') AND party_id IS NULL)`
   - add the partial unique index `uq_point_accounts_account_type_burn` `WHERE account_type = 'BURN'`
   - seed one BURN row
3. `TransactionRule(source_type, pair_limited, counts_reputation, debits: frozenset[PointAccountType], credits: frozenset[PointAccountType])`:

   | Type | Debits | Credits | Pair slot | Reputation | party / counterparty | Source key |
   |---|---|---|---|---|---|---|
   | GIVE_FREE, EXCHANGE, WISHLIST_MATCH | {EMISSION} | {PARTY} | yes | GIVE_FREE only | as today | RESERVATION, as today |
   | ATTENDANCE | {EMISSION} | {PARTY} | no | no | as today | TERM_ATTENDANCE |
   | HOLD | {PARTY} | {HELD} | no | no | buyer / seller | RESERVATION, POINTS reservation id |
   | SALE | {HELD, EMISSION} | {BURN, PARTY} | yes | no | seller / buyer | RESERVATION, POINTS reservation id |
   | RELEASE | {HELD} | {PARTY} | no | no | buyer / seller | RESERVATION, POINTS reservation id |

4. `post_points`:
   - The guard "Stage 1 never debits a PARTY account" is removed.
   - Every negative entry must be on an account whose type is in `debits`, and every positive entry on one in `credits`.
   - Entries must sum to 0, with no zero amounts.
   - **Balance check:** for every debited PARTY or HELD account, `account_balance + amount ≥ 0`. This is computed in the same session, and the caller must hold `lock_accounts`. Otherwise `LedgerInvariantError` (500).
   - It still only flushes and still writes no rows before validating.
5. `lock_accounts(db, keys: Iterable[tuple[party_id, PointAccountType]]) -> dict[tuple, account_id]`:
   - sorted Core `INSERT … ON CONFLICT (party_id, account_type) DO NOTHING`
   - then `SELECT … FOR UPDATE ORDER BY party_id, account_type`
   - **Stage-1 call sites change (L8):** `awards.py:70` and `:182` pass `(party, PARTY)` keys. `accounts[party]` at `awards.py:127` and `accounts[award.party_id]` at `:202` become `accounts[(party, PARTY)]`. `_attendance_in_cap_month(db, accounts, …)` (`awards.py:185`, `:208-223`) takes the PARTY account ids (`accounts.values()`).
   - `ledger.emission_account_id` becomes `system_account_id(db, account_type)` for EMISSION and BURN. The callers at `awards.py:106` and `:188` are updated.
6. The `ledger.py` docstring is rewritten. It covers the declared debit/credit types, the balance check under the lock, one account per (party, type), BURN/HELD, SALE/RELEASE mutual exclusion and the lock order.
7. New `ledger.hold_amounts(db, reservation_ids) -> {reservation_id: amount}` (the HOLD credit on HELD, one query).
8. `PointTransaction` CHECKs are unchanged: HOLD/SALE/RELEASE have a counterparty and no `cap_month`.

### R9 Account reads
1. `PointsSummaryResponse` = `{balance, held, reputation}`:
   - `balance` = the PARTY account sum (available)
   - `held` = the HELD account sum
   - `reputation` = the PARTY account's GIVE_FREE sum
2. `reads._account_id` filters `account_type`.
3. History becomes **one row per transaction per caller**:
   - group the caller's PARTY and HELD entries by transaction
   - `amount` = the PARTY-entry sum (0 when none)
   - new `held_amount` = the HELD-entry sum
   - `reputation` as today
   - `total` = the count of distinct transactions
   - the statement count stays constant in rows (`count_queries` test)
4. Resulting rows:

   | Type | amount | held_amount |
   |---|---|---|
   | HOLD | −p | +p |
   | RELEASE | +p | −p |
   | SALE, buyer | 0 | −p |
   | SALE, seller | +p | 0 |

### R10 Migration 0109 (`0109_points_offers.py`)
**Upgrade** (`SET LOCAL lock_timeout = '5s'`):
1. Add the four `points_config` columns NOT NULL, each with a server default (0.50/1.50/100/10, no table rewrite). Then drop the server defaults, to match the other config columns.
2. Add `item_listing_preferences.points_price` SMALLINT NULL and its two CHECKs.
3. Replace the account unique constraint and the CHECK, and add the BURN partial unique index.
4. Insert the BURN row with explicit `id`, `created_at` and `updated_at`.

The docstring records the schema+seed exception.

**Downgrade**, guarded. It refuses with `RuntimeError` naming the counts and "restore the pre-0109 dump" when any of these is non-zero:
- `SELECT count(*) FROM point_transactions WHERE transaction_type IN ('HOLD','SALE','RELEASE')`
- `SELECT count(*) FROM item_listing_preferences WHERE mode = 'POINTS'`
- `SELECT count(*) FROM reservations WHERE reservation_type = 'POINTS'`

Otherwise, in reverse order:
1. Delete the HELD and BURN accounts (which have no entries once the guard passes).
2. Drop the BURN index, restore the old CHECK and the unique constraint.
3. Drop the preference CHECKs and column.
4. Drop the config columns.

`wants.offer_mode = 'POINTS'` rows are left as they are and match nothing after a downgrade.

### R11 Frontend
1. **Types and ripple** (typecheck catches most, the rest are layout or behaviour):
   - `ExchangeMode`, `ListingMode`, `MyItemsModeFilter` and the reservations `mode` gain `"POINTS"`. `api/reservations.ts::ReservationType` gains `"POINTS"`.
   - Every `Record<ExchangeMode, …>` gains POINTS: `ItemCard` PLACEHOLDER_TONE/OFFER_BADGE, `termLabels` (EXCHANGE_MODE_LABELS „Za punkty”, INTENT_LABELS, EXCHANGE_MODE_TONE), `ExchangeModeTabs`, `organizerHelpers.exchangeTotal`, wanted `OfferModeChips`, search `OFFER_TYPES`.
   - **`utils/appHelpers.ts`:** `ItemMode` gains `"za punkty"`. It is added to `ITEM_MODES`, `ITEM_MODE_TONE` (`bg-orange text-ink`), `ITEM_MODE_STYLE` (orange / ink), `ITEM_MODE_TO_RESERVATION_TYPE` and `RESERVATION_TYPE_TO_ITEM_MODE`.
   - **`features/panel/HomeView.tsx`:** the `ITEM_MODES` tiles grid becomes `grid-cols-3` (Oddam / Zamienię / Za punkty with the POINTS count). No mockup covers this; it is the minimal layout for three tiles.
   - **`features/items/ReservedItemsView.tsx`:** `MODE_LABEL`/`MODE_TONE` gain POINTS („Za punkty”, orange). A POINTS row shows „{held_points} pkt zablokowane”.
   - **`features/items/MyItemsView.tsx` (M2):** `ReservationTermInfo.isGift` becomes `recipientConfirms`, true for GIFT **and POINTS**. The seller of a POINTS item therefore sees only „Anuluj”, never „Potwierdź”.
   - **Wanted:** `features/wanted/wantText.ts::OFFER_MODE_LABEL` gains `POINTS: "Za punkty"`. `features/wanted/wantFormViewState.ts::initialFromPrefill` accepts `offer_type=POINTS`.
   - `components/layout/pending/pendingActions.ts:124` is already correct by fall-through. It is listed so nobody "fixes" it.
   - Count types gain POINTS.
   - `PointsConfigValues`, `PointsSummary` (`held`), `PointHistoryEntry` (`held_amount`), `PointTransactionType` (HOLD/SALE/RELEASE), `MyReservationResponse.held_points`, `ItemPartyReservation.held_points` and the item-value response (`price_min/max/step`) are updated. `api/points.ts` gains `getOwnedItemPointsValue(itemId)`, and `hooks/useItemPointsPreview.ts` gains `useOwnedItemPointsValue(itemId)` under the same `POINTS_KEY` prefix.
   - Typed fixture factories are updated without casts.
2. **Per screen:** see Visual Design.

### R12 Docs
1. **`architecture.md` points section:**
   - Replace the stage-1 framing and the "Out of scope / stage 2" bullet with a „Stage 2 part 1: POINTS offers” bullet set. It covers pricing and `item-value?item_id`, the listing rules, HOLD/SALE/RELEASE, the lock order (accounts → item → preference, take as the safe exception), the login-token rule for POINTS take/confirm, the R8 exceptions (`points_price`, `held_points`), history rows and the accepted pair-limit overshoot.
   - Rewrite the ledger contract bullet: debit/credit types, balance check, per-type accounts, BURN.
   - Add the **0109 runbook**:
     - `pg_dump` first
     - run the matcher suite
     - build the backend before web (the web image is never ahead of the backend)
     - the three guard counts before any downgrade
     - `docker compose run --rm --no-deps backend alembic downgrade 0108` from the new image, refused while POINTS data exists → restore the dump
     - no image-only rollback past 0109 (an old image fails on the unknown revision); an old image rejects re-saving a want with `offer_mode='POINTS'`
     - still open: SALE_REFUND and the 30-day reminder
2. **`backend/security.md`:** one line saying that POINTS take/confirm require the login `EDIT` authority, with an `mcp:edit`-only token getting 403 in the use case.
3. **`INDEX.md` architecture paragraph:** replace "stage 2 (POINTS mode) … out of scope" with a one-line summary of POINTS offers (0109: `points_price`, HELD/BURN, HOLD/SALE/RELEASE, 4 config keys, `item-value?item_id`, login-only POINTS take/confirm, R8 exceptions, runbook).

## Visual Design
The mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to the UI task groups. Fidelity is mid-fidelity HTML using the `globals.css` tokens (admin uses Chakra/slate).

| Screen ID | Mockup | Components | Key elements |
|---|---|---|---|
| `screen:item-create-points` | `mockups/dodaj-rzecz-wystawienie-za-punkty.html` | `features/items/ItemCreateView.tsx`, `hooks/useCreateItem.ts`, new `components/shared/PointsPriceStepper.tsx` | **Mode group (L4):** Oddam / Zamienię / Za punkty as `aria-pressed` buttons (Oddam preselected), then one primary action, „Wystaw” for GIFT/SWAP and „Wystaw za N pkt” (orange) for POINTS, and the secondary „Wersja robocza” in every mode. In POINTS mode: the stepper, „System proponuje N pkt” and „Dozwolone A–B pkt, co S” (replacing `ItemPointsPreview`), and the photo info line. With no photo picked, the action is `aria-disabled` with the hint „Dodaj przynajmniej jedno zdjęcie, aby wystawić za punkty.” **Flow:** register the draft, upload photos, then PUT POINTS. **After a failed PUT (user decision 3):** the view keeps the created item id (`createdItemId` state) and shows the server message (`role="alert"`). A retry calls only the PUT for that id, never `createItem`, and re-uploads no photos. Leaving keeps the draft in My Items. On success it navigates to the item page as today. |
| `component:price-stepper` | same | `PointsPriceStepper` | −/+ buttons (`type="button"`, aria-labels „Obniż o S” / „Podnieś o S”) moving by `price_step` within the bounds. A `type="text" inputMode="numeric" pattern="[0-9]*"` input holds the raw string in state. A shared parser `parsePointsPrice(raw, bounds)` lives in `utils/appHelpers.ts` (the parseCapacity rule). An invalid value shows an inline `role="alert"` „Cena musi być od A do B pkt, co S.” with `aria-invalid`/`aria-describedby`, and submit is blocked. The bounds are props: /add passes the category + condition preview. |
| `screen:item-edit-points` | `mockups/edycja-rzeczy-cena-za-punkty.html` | `features/product/ItemEditForm.tsx`, `features/items/ItemEditView.tsx`, `utils/itemQuickAdd` (`ItemEditDraft.pointsPrice` raw string), `hooks/useItemDetail.useItemEditing` (new `savePointsPrice`) | Only for POINTS listings (mode and price from `useItemActions`). **Bounds (user decision 2):** while the draft category and condition equal the stored ones, the stepper uses `useOwnedItemPointsValue(itemId)`, which reads the stored value. After a category or condition change, it shows the preview as a forecast: „Zmieniłeś stan — sugestia to teraz N pkt (dozwolone A–B)”. While reserved it shows „Zarezerwowana przez X za H pkt — ta rezerwacja rozliczy się po H pkt. Nowa cena dotyczy kolejnych osób.” (H = `held_points`). **Saving:** the existing saves (PATCH clamps the stored price) run first, then a PUT `{mode: POINTS, points_price}` when the price or the bounds changed. The server validates the PUT against the new stored value. A 400 is shown verbatim, and the form refetches `item-value?item_id`. |
| `screen:item-cards-points` | `mockups/karty-przedmiot-w-z-cen-w-punktach.html` | `components/shared/ItemCard.tsx` (+ `pointsPrice` prop), `ItemTileBadges.tsx`, its users (SearchResultCard, OwnerItemsList, RecentItemsBlock, ProfileItems, Match/Similar/SuggestionCard, ParticipantItemsPreview), `features/items/MyItemsView.tsx`, `features/panel/HomeView.tsx` | The orange POINTS badge „N pkt” (`bg-orange text-ink`), with the sr-only text „Za punkty: N pkt” (spacing rule). Without a price it reads „Za punkty”. The suggestion never appears on cards. MyItemsView gains the mode option „Za punkty” (a PUT without a price), the price chip, the POINTS filter and its count, and the POINTS-aware confirm gating (M2). HomeView shows three mode tiles. |
| `component:points-badge` | same | `ItemCard` OFFER_BADGE / `ItemTileBadges` | as above |
| `screen:item-page-points` | `mockups/strona-przedmiotu-za-punkty.html` | `features/product/itemActionsViewState.ts`, `blocks/ItemPickupActions.tsx`, `blocks/ItemHeader.tsx`/`ItemStatus.tsx`, `PartyReservationActions.tsx`, `useItemTake.ts` | The header shows „Cena N pkt”. The buyer sees „Biorę za N pkt” and the note „Punkty zostaną zablokowane do odbioru. Spalimy je dopiero, gdy potwierdzisz odbiór.” A guest gets `AuthSheet`. The owner sees „Zarezerwowane przez X · H pkt zablokowane”, „Potwierdza tylko kupujący. Możesz anulować — punkty wrócą do X.” and „Anuluj rezerwację”. After pickup the buyer sees „Potwierdź odbiór”. `resolveItemActionsView` carries `pointsPrice` and `heldPoints`, with new table rows. |
| `screen:points-reservation-sheet` | `mockups/okno-rezerwacji-za-punkty-saldo.html` | new `features/product/PointsReservationSheet.tsx` (`ModalSheet`, `useRegisterOpenSheet`), `useItemTake` (a `pointsPick` state like `swapPick`; the context picker comes first when needed), `hooks/useMyPoints` | Rows: „Cena”, „Dostępne saldo” and „Po rezerwacji”, plus the pickup line. „Zablokuj N pkt i rezerwuj” sends `takeItem({reservation_type: "POINTS", points_price, context})`. When the balance is short, the action is `aria-disabled` with the hint „Brakuje Ci D pkt.” A server 409 (or 403) is shown verbatim, with „Odśwież” refetching actions and points. On success it invalidates the points and actions prefixes. |
| `screen:search-points-filter` | `mockups/wyszukiwanie-filtr-za-punkty.html` | `features/search/SearchFilters.tsx`, `useSearchUrlState.ts`, `SearchResultCard.tsx` | An offer-type chip „Za punkty” → `offer_type=POINTS`. Result cards pass `meta.points_price`. |
| `screen:admin-points-offers` | `mockups/admin-konfiguracja-ofert-za-punkty.html` | `features/admin/PointsConfigPage.tsx`, `pointsConfigForm.ts` | The section „Oferty „za punkty”” is no longer dimmed. It holds the limit, „Minimum ceny (× sugestia)”, „Maksimum ceny (× sugestia)”, „Cena maksymalna” and „Krok ceny”. **Ratios (L11):** a new `RatioField` type with its own `parseRatio(raw, min, max)` (decimal comma, two decimals; 0.01–1.00 and 1.00–3.00, matching the server). The `MultiplierField` union and its 0.01–9.99 rule are not reused. **Live example (L5):** a client mirror of `price_bounds` for s = 20/40/60 in integer arithmetic. Ratios are kept as integer hundredths, and half-up rounding is done by integer division, so the mirror matches the server's Decimal result exactly (e.g. 30 × 1.15 → 35 for step 1). It reads „Przykład: sugestia 40 → 20–60 pkt; …; nigdy powyżej {cap}.” Server 400s are shown verbatim. |
| `screen:account-points-held` | `mockups/twoje-punkty-saldo-blokady-historia.html` | `features/points/AccountPointsView.tsx`, `PointsTiles.tsx` (+ `held`), `PointsHistoryRow.tsx`, `pointsLabels.ts` | Three tiles: „dostępne”, „zablokowane”, „reputacja”. The „wkrótce” note is removed. History labels and icons: HOLD „Blokada: …” (−p), RELEASE „Zwolnienie blokady: …” (+p), SALE with `held_amount < 0` „Zakup: …” showing „zablokowane p → wydane”, and any other SALE „Sprzedaż: …” (+p). Subtitles: „Sprzedawca: …” / „Kupujący: …”. |

## Reusable Components

### Existing Code to Leverage
- **Take/confirm path:** `groups/application/term_item_listings.py` `_take`, `_lock_takeable_preference`, `_may_confirm`, `confirm_transaction`, `cancel_transaction`, `transaction_action_flags`; `confirm_race_rules._require_recipient_to_confirm_gift`.
- **Item lock:** `inventory/application/inventory_items.get_item_for_update` (via `groups/infrastructure/inventory_bridge`) for confirm and `update_item`.
- **Ledger primitives:** `points/infrastructure/ledger.py` `post_points`, `lock_accounts`, `source_key_exists`, `account_balance`, `emission_account_id` (generalized to `system_account_id(type)`).
- **Award helpers:** `points/application/awards.py` `_used_pair_slots`; `families_acl.share_active_family`; `users_acl.eligible_party_ids`.
- **Valuation:** `points/application/valuation.py` `value_for`, `item_value_preview` (extended with bounds); `domain/valuation.py`.
- **Points ACLs:** `points/infrastructure/inventory_acl.py` (Core refs over `inventory_items`; it gains the owned-item value read) and `users_acl.py` (the caller's user id).
- **Config validation:** `points/application/config.py` `_INTEGER_FIELDS`, the multiplier validation pattern and `update_config`.
- **Conflicts:** `app/db.py::mapped_transaction_conflicts`.
- **Hook injection pattern:** `inventory/router.py` `on_registered=term_item_listings.list_registered_item`.
- **Cancel choke point:** `inventory/application/reservation_transitions._release` and `cancel_reservations_without_commit`.
- **Read-side ACLs:** `groups/infrastructure/product_bridge.py` and `product/service` (photo queries); the search, pages and wants `groups_acl` (preference columns); `events/page.py` (`preferences.c.mode`).
- **Frontend:**
  - `ModalSheet`, `useRegisterOpenSheet`, `PersonalPickupSheet`/`ChooseContextSheet` (sheet layout), `AuthSheet`/`useAccountGate`
  - `useItemTake` (the `swapPick` pattern), `useItemPointsPreview`/`ItemPointsPreview`, `useMyPoints`, `usePointsConfig`
  - `parseCapacity` (parser rule), the `pointsConfigForm.parseMultiplier` pattern
  - `ItemCard` OFFER_BADGE, `SearchFilters` chips, `pointsLabels.ts`, `PointsTiles`
- **Tests:**
  - `tests/test_points_awards.py` helpers (`_setup`, `_listed_item`, `_take`, `_confirm`)
  - `tests/point_ledger_assertions.assert_point_transactions_balanced`
  - `_oauth_token` from `tests/test_authorization_matrix.py` (an `mcp:*` token)
  - `_alembic` from `tests/test_personal_pickup_migration.py`
  - `count_queries`, `freeze_local_now`, `leaf_category_ids`

### New Components Required
- `points/domain/pricing.py` + `application/pricing.py`: pure bounds, rounding and clamp. They have no home in the valuation snap.
- `points/application/purchases.py` (`lock_purchase`, `post_hold`, `settle_sale`, `release_hold`, `lock_release_accounts`, `hold_amounts`): HOLD, SALE and RELEASE have different rules from the awards (no silent skip, 409s at take), so they don't fit `award_exchange`'s plan-and-skip flow.
- `PointsReservationSheet.tsx`: no existing sheet shows a balance. It reuses `ModalSheet`.
- `PointsPriceStepper.tsx`: no stepper exists. It is shared by create and edit (two callers).
- `product_service.has_own_unrejected_photo`: the existing photo queries are per-product and approved-only.
- `require_login_principal`: no existing helper distinguishes a login token. It is a few lines with two callers.
- Migration `0109_points_offers.py`.

## Technical Approach
- **Module boundaries:**
  - `groups/infrastructure/points_acl.py` gains `lock_owner_accounts`, `price_bounds`, `offer_rules`, `lock_purchase`, `post_hold` and `hold_amounts`; `award_exchange` routes POINTS to `settle_sale`.
  - `inventory/infrastructure/points_acl.py` gains `release_hold` and `lock_release_accounts`.
  - `points/infrastructure/inventory_acl.py` gains the owned-item `points_value` read for `item-value?item_id`. Points never imports inventory.
  - `_POINTS_IMPORTERS` stays exactly {main.py, groups points_acl, inventory points_acl}.
  - Search, pages, events and wants read `points_price` through their existing groups ACLs or table refs. Nothing new imports `app.points`.
  - `points/domain/` imports only itself.
- **Lock order (one total order, documented in `ledger.py` and architecture.md):** point accounts (one sorted `lock_accounts` call per transaction step) → item row FOR UPDATE → preference row.
  - PUT POINTS: [(owner, PARTY) when becoming POINTS] → item → preference (re-checked under the item lock).
  - PATCH re-valuation: item → preference.
  - confirm: accounts (award/SALE) → items in id order → preference delete → `fulfill_exchange`.
  - cancel: accounts (first in `_release`) → reservation/balance rows. Event deletion locks reservations FOR UPDATE, then all buyers' accounts once, sorted. This is safe because confirm cannot run before the event starts.
  - **take (the exception):** event FOR SHARE → preference FOR UPDATE → accounts → reservation/balance rows. Take locks no item row. A path that holds accounts and then wants a preference is either PUT becoming POINTS, whose item was verified not to be POINTS under the lock (so no POINTS take can hold its preference), or confirm, whose item is reserved (so not takeable). Neither can close a cycle with take. Anything left over is mapped to 409 by `mapped_transaction_conflicts`, which wraps take, PUT, `update_item`, confirm, cancel and `delete_event`.
- **Login-token rule:** `require_login_principal(principal)` raises `AccessDeniedException` unless `"PERMISSION_EDIT" in principal.authorities`. It is called for a POINTS take (before any read) and a POINTS confirm (after the reservations resolve).
- **Data flow:** form (bounds from `item-value`) → PUT preference → read models (cards, search, actions) → sheet with `/api/points/me` → take (HOLD) → hand-over → confirm (SALE) or cancel (RELEASE) → `/points` history.
- **Clock:** ledger timestamps use naive-UTC `datetime.utcnow()` as today. No domain-clock reads are added.

## Implementation Guidance

### Testing Approach
- **Per step group:** 2–8 focused tests. Verification runs only the new and updated tests, plus the regression sets named here, the matcher suite and the frontend tests touched.
- **Domain (table test):** the bounds acceptance cases (s=20/40/60, cap 100, 55 rejected, 45→50, the min>max collapse, the step guard).
- **Config:** the four keys round-trip; each Polish 400 (ratio ranges, cap not a multiple of the step); `CONFIG_KEYS` +4.
- **Item value:**
  - `?item_id` for the owner returns the stored value and its bounds, also after an admin config change makes the preview differ
  - another person's item → 403; an unknown or deleted item → 404
  - both forms or neither → 400
  - an `mcp:read` token → 403 (row 69)
- **Listing:**
  - POINTS without an owner photo → 400
  - with only another user's photo → 400
  - a PENDING own photo → 200
  - the 6th POINTS offer → 409
  - an out-of-range or off-step price → 400 naming the range
  - an omitted price → the clamped suggestion
  - PUT bounds use the stored value after a config change
  - a condition PATCH clamps the stored price
  - a GIFT switch NULLs the price
  - the M4 re-check: the preference changes between the unlocked read and the item lock (simulated by committing a mode switch from a second session between the two reads) → 409 „Oferta zmieniła się w międzyczasie — odśwież.”, nothing written
- **Take:**
  - a balance below the price → 409
  - a price mismatch → 409
  - a family pair → 409
  - an exhausted pair limit, with an open hold counted → 409
  - two parallel takes against one balance → one 201 and one 409
  - HOLD entries balanced, `party_id` = buyer, counterparty = seller; available decreases and held increases
  - **an `mcp:edit` token (`_oauth_token`) on a POINTS take → 403, with no reservation and no HOLD; the same token on a GIFT take still works**
- **Confirm:**
  - only the buyer can confirm (seller → 403, `can_confirm` false)
  - **an `mcp:edit` token on a POINTS confirm → 403, then the buyer's login token → 200**
  - SALE has 4 entries, and the buyer's burn equals the seller's emission (`assert_point_transactions_balanced` + BURN sum = −EMISSION sum)
  - SALE uses the HOLD amount after a price edit
  - no reputation and no WISHLIST_MATCH
  - SALE is pair-limited
  - works in term, event and personal contexts
  - the hand-over queries include POINTS
- **Cancel:**
  - seller cancel, buyer cancel and event deletion each release
  - an event deletion with POINTS reservations by two different buyers releases both, in one transaction
  - a RELEASE after a SALE → 409, and vice versa
  - repeats post nothing
- **Ledger:**
  - the rules completeness test is rewritten (debits/credits and party/counterparty per type)
  - an overdraft posting raises `LedgerInvariantError`
  - the stage-1 awards still pass with tuple-keyed `lock_accounts`
  - the AST "only `ledger.py` writes" guard stays
- **Reads:** `/me` has `held`; history rows for HOLD, SALE (both sides) and RELEASE; constant statement count.
- **Migration 0109:** a downgrade-then-upgrade round trip; refusal with POINTS data, restoring head in `finally`.
- **Frontend (Vitest):**
  - `PointsPriceStepper` (±step, bounds, invalid → alert)
  - `parsePointsPrice` table
  - `ItemCreateView`: the mode group (GIFT/SWAP submit through „Wystaw”), the POINTS flow (draft → photos → PUT), the no-photo hint, and **a failed PUT followed by a retry that calls only the PUT, once, with the same id (`createItem` called once)**
  - the edit form uses `useOwnedItemPointsValue` bounds while the condition is unchanged, and the preview note after a change
  - `itemActionsViewState` POINTS rows
  - `MyItemsView`: no „Potwierdź” for the seller of a POINTS reservation
  - `PointsReservationSheet` (balance after, short balance blocked, a 409 shown)
  - `ItemCard` badge
  - `pointsConfigForm`: the new keys, `parseRatio` ranges, and the live example at 30 × 1.15, step 1 → 35
  - `AccountPointsView` tiles and labels
  - the `ssrSafety` case for the sheet host if it renders server-side

#### Exact key-set and constraint test updates (deliberate)
- `test_item_actions.py`: `ACTIONS_KEYS` + `points_price`.
- `test_party_reservation_actions.py`: `PARTY_KEYS` + `held_points`.
- `test_search_api.py`: `META_KEYS["product"]` + `points_price`.
- `test_owner_items_page.py`: `ITEM_KEYS` + `points_price`; the counts gain POINTS.
- `test_organizer_page.py`: `ITEM_KEYS` + `points_price`; item_stats gain POINTS.
- `test_event_page.py`: `ITEM_KEYS` + `points_price`.
- `test_my_reservations.py`: `ROW_KEYS` + `held_points`.
- `test_wants_matches_api.py` (`META_KEYS`, also used by the suggestions test) and **`test_wants_similar_api.py:23` (`META_KEYS`)**: + `points_price`, because `WantMatchMeta` is shared.
- **`test_term_item_listings_router.py:264-286`:** the `MyInventoryItemResponse` frozenset + `points_price`.
- `test_item_visibility.py`: `PREFERENCE_KEYS` + `points_price`.
- `test_my_items_page.py`, `test_reserved_listings.py`, `test_party_profile.py` and the `test_item_visibility.py` counts literals: + `POINTS`.
- `test_points_config_api.py`: `CONFIG_KEYS` + 4.
- `test_points_me_api.py`: `SUMMARY_KEYS` + `held`, `ENTRY_KEYS` + `held_amount`, and the empty-summary literal at L133 becomes `{"balance": 0, "held": 0, "reputation": 0}`.
- `test_points_valuation.py`: the item-value response keys + 3; the R8 probe allowlist `{"points_price", "held_points"}` with the reserved-POINTS case.
- **`test_points_migration.py:122-134`:** at head, the constraint set swaps `uq_point_accounts_party_id` for `uq_point_accounts_party_id_account_type`, and the index set adds `uq_point_accounts_account_type_burn`.
- **Test helpers:** `_account_id` in `test_points_awards.py:150-153` and the giver-account select in `test_points_awards_contexts.py:98-102` add `PointAccount.account_type == PARTY`, so `scalar_one()` stays unique once a party has a HELD account. `tests/point_ledger_assertions.py:33` (`transactions_for_party`) keeps matching every account of the party, which the HOLD/SALE assertions need.
- `test_points_ledger.py`: the "debits EMISSION" and "PARTY debit raises" tests are replaced by the declared-types and overdraft tests.
- `test_module_boundaries.py`: `_POINTS_IMPORTERS` is unchanged (must stay green).

### Standards Compliance
- **`backend/models.md`:** a plain-int `points_price` (points are ints, not money), CHECKs mirrored in `__table_args__` (preference and `PointAccount`), cross-module access via single ACLs, the owner's 404-before-403 check in `item-value?item_id`, `lazy="raise"` kept.
- **`backend/migrations.md`:** `lock_timeout`, named constraints, a guarded downgrade with the recovery path, the round-trip and refusal tests; the schema+seed-in-one exception recorded.
- **`backend/security.md`:** no matrix rows added. The POINTS login-token rule lives in the use case, because the routes are type-agnostic, and matches row 69's no-mcp stance. Owner-only point reads keep their caching; the personalised `/actions` cache headers are unchanged.
- **`backend/queries.md`:** batched `hold_amounts` and `lock_release_accounts`, no N+1 in history (constant statements), parameterized queries.
- **`global/error-handling.md`:** typed 409/400 with Polish messages, and `mapped_transaction_conflicts` for 40P01/40001 on every new or touched write path (take, PUT, `update_item`, confirm, cancel, `delete_event`). `LedgerInvariantError` is a 500 for contract breaches.
- **`global/validation.md`:** integer inputs as text/numeric with a shared parser, an inline alert, a disabled submit, and the server still authoritative.
- **`backend/time.md`:** naive-UTC ledger timestamps, no new clock reads.
- **`frontend/components.md`:** view state in the table-tested `resolveItemActionsView`, routing via the facade, server-safe rendering.
- **`frontend/accessibility.md`:** the ModalSheet focus trap and open-sheet registration, `aria-disabled` + `aria-describedby` for blocked actions, the `aria-pressed` mode group, sr-only spacing, 4.5:1 contrast.
- **`frontend/data-fetching.md`:** hooks in `src/hooks/`, mutations awaiting invalidation of the points and item-actions prefixes, server messages verbatim.
- **`testing/backend-testing.md`, `testing/frontend-testing.md`:** naming, exact key sets, typed fixtures, `leaf_category_ids` per test.
- **`global/minimal-implementation.md`:** no SALE_REFUND or correction stubs, no reservation snapshot columns, and no new route or matrix row.

## Out of Scope
- The pickup condition correction („gorszy stan”) and SALE_REFUND, including `corrected_price` and `declared_condition`.
- The seller block after 3 corrections.
- The 30-day reminder (price −step or „oddam za darmo”).
- Auto-confirm, the objection stage, and expiry of held points.
- Notifications about points (beyond the „za N pkt” text in the take notifications).
- POINTS on create via `POST /api/inventory-items` (`listing_mode`), and `points_price` on `/details` and term-listing responses.
- Recomputing stored prices when the admin changes the config. A lower cap or offer limit never unlists or re-prices existing offers.
- A strict pair limit across GIFT/SWAP and POINTS (the overshoot is accepted).
- Restricting `mcp:edit` on POINTS cancel or listing.
- START_BONUS, points at events, a platform payment gateway.

## Success Criteria
- s = 40 → 20–60, s = 60 → 30–90, s = 20 → 10–30, and nothing above 100 anywhere (API, form, admin example). 55 is rejected with „Cena musi być od 20 do 60 pkt, co 10.”
- For an existing item, the edit form and PUT use the same bounds, from the stored `points_value`, even after an admin config change.
- An owner without an own non-rejected photo cannot list for points (400). The 6th POINTS offer is refused (409), also under the M4 race.
- A take holds exactly the price (available −p, held +p). An insufficient balance, a price mismatch, a family pair and an exhausted pair limit each give 409, and no hold or reservation is written.
- An `mcp:edit`-only token gets 403 on a POINTS take and on a POINTS confirm.
- Only the buyer can confirm, and My Items shows the seller no confirm button. Confirm posts one SALE whose BURN entry equals the EMISSION debit and the seller's credit, with no reputation. Cancel (seller, buyer, event deletion) releases the hold, and SALE and RELEASE never both happen.
- A deadlock on PUT, PATCH, confirm, cancel or event deletion returns 409, never 500.
- /add never creates a second item after a failed POINTS PUT.
- `/points` shows available, held and reputation, and the HOLD/SALE/RELEASE history. Cards, search, the item page, pages, wants cards and my reservations show `points_price` / `held_points` only for POINTS offers and their parties.
- Migration 0109 round-trips and refuses to downgrade with POINTS data. All new and updated backend and frontend tests and the matcher suite pass. mypy and ruff stay at baseline (15 / 65), and the frontend failures stay at the 33 pre-existing.

## Audit resolution
Source: `verification/spec-audit.md`.

| ID | Resolution |
|---|---|
| H1 | User decision 2. `GET /api/points/item-value?item_id=` (owner-only, 404 before 403, row 69, via `points/infrastructure/inventory_acl.py`) returns the stored value and its bounds. The edit form and PUT use it. The preview stays for new items and serves as a forecast after a draft category or condition change (R2.7, R3.4.8, `screen:item-edit-points`). |
| M1 | User decision 3. /add keeps `createdItemId` after a failed PUT. A retry repeats only the PUT, and leaving keeps the draft in My Items (`screen:item-create-points`, Vitest case). |
| M2 | `MyItemsView` `isGift` → `recipientConfirms` (GIFT or POINTS), so the seller sees no confirm button (R11.1, Vitest case). |
| M3 | One order: accounts → item → preference. `update_item` locks the item before the hook, and confirm locks items before the preference delete. Take is the documented exception. `update_item` and `delete_event` are wrapped in `mapped_transaction_conflicts` (R3.6, R6.4, R7.4, Technical Approach). |
| M4 | The preference is re-read under the item lock. A changed "becomes POINTS" answer → 409 „Oferta zmieniła się w międzyczasie — odśwież.” (R3.4.4, test). |
| M5 | Added `test_points_migration` head sets, `test_wants_similar_api` `META_KEYS`, the `test_term_item_listings_router` `MyInventoryItemResponse` keys, the two `_account_id` helpers (`account_type == PARTY`), and the `test_points_me_api` empty-summary literal. |
| M6 | User decision 1. `require_login_principal` (needs `PERMISSION_EDIT`) on POINTS take and confirm, so an `mcp:edit`-only token gets 403. No matrix carve-out is possible, because the paths are type-agnostic. Tested with `_oauth_token`; recorded in `security.md` (R5.2, R6.2). |
| L1 | User decision 4. Accepted and recorded in Risks and Out of Scope. |
| L2 | `lock_release_accounts` pre-locks all buyers' accounts once, sorted, and `delete_event` is wrapped (R7.4, test). |
| L3 | Added HomeView (`grid-cols-3`), the appHelpers `ItemMode` maps, ReservedItemsView (labels + `held_points`), `ReservationType`, `wantText`, `wantFormViewState`, and the `pendingActions` fall-through note (R11.1). |
| L4 | One `aria-pressed` group for all three modes, with Oddam preselected and one primary action („Wystaw” / „Wystaw za N pkt”). „Wersja robocza” is kept (Key Decisions, `screen:item-create-points`). |
| L5 | The admin live example uses integer hundredths with half-up integer division, matching the server's Decimal result (Vitest case 30 × 1.15 → 35). |
| L6 | The number-neutral limit text is kept as a recorded exception to the mockup-text rule (Key Decisions). |
| L7 | HOLD: party = buyer, counterparty = seller; RELEASE likewise; SALE: party = seller, counterparty = buyer (R5.3.4, R8.3 table). |
| L8 | `lock_owner_accounts` locks `(owner, PARTY)` only. The stage-1 call sites `awards.py:70/106/127/182/185/188/202/208-223` are listed, and `PointAccount.__table_args__` mirrors the constraints. `emission_account_id` → `system_account_id` (R8.2, R8.5). |
| L9 | The server is authoritative. The full-product and earlier-photo edge cases are accepted and recorded in Risks. |
| L10 | `held_points` keeps its name and joins the R8 allowlist as a party-only field. The probe adds a reserved POINTS item seen by a third person (R4). |
| L11 | Paths fixed: `app/inventory/domain/item_privacy.py`, `features/items/ItemEditView.tsx`. A new `RatioField`/`parseRatio` replaces reuse of `MultiplierField`. `MyReservationResponse.points_price` is renamed `held_points`. |
