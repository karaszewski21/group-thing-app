# Implementation Plan: POINTS mode (stage 2, part 1) with an owner-set price

## TL;DR
16 groups: 7 backend groups (schema → ledger → pricing/config → purchases → listing → take/confirm/cancel → read models), 6 frontend groups, a test review group and a final docs and full-suite group.
The backend chain is mostly serial, because the groups share `term_item_listings.py`, `groups/schemas.py` and the points ACLs. The frontend groups depend only on the frontend types group (8). They mock the API and can run beside the backend chain.
Groups 9–14 each own one or two binding mockup screens. `visual-coverage.md` covers all 10 design IDs.
No commit, push or PR steps (user rule).

## Key Decisions
- **Schema and models first, in one group (1).** Migration 0109, every enum value and every mirrored CHECK land together. All later groups then run against a head that already has HELD/BURN, the POINTS enums and `points_price`.
- **Ledger contract (2) is separate from pricing/config/item-value (3).** Both depend only on 1. They share `app/points/schemas.py` and `service.py`, so the executor serializes them on those files. Purchases (4) needs both.
- **Listing (5) comes before take/confirm/cancel (6), and read models (7) come last.** Group 6's tests need a listed POINTS item. Group 7 needs `hold_amounts` (4) and the response schemas group 6 has already touched.
- **The frontend starts from one types-and-ripple group (8).** Adding `"POINTS"` to `ExchangeMode` breaks every `Record<ExchangeMode, …>`, so a single group keeps `tsc` green. Groups 9–14 then add the behaviour per screen.
- **`PointsPriceStepper` is built in group 9 (/add) and reused by group 10 (edit).** That gives group 10 a dependency on 9.
- **The spec's test list is larger than 8 per group.** Each group writes the highest-risk cases (parametrized where the spec lists variants). Group 15 fills the rest, up to 10 tests, in priority order: concurrency, the M4 race and cancel paths first.
- **Task-system items:** this planner has no `TaskCreate` tool in its environment, so no task items were created. The markdown checkboxes are the tracking source.

## Open Questions / Risks
- **`term_item_listings.py` (>1200 lines) is touched by groups 5, 6 and 7, and `groups/infrastructure/points_acl.py` by 4, 5, 6 and 7.** Groups 5–7 must run strictly one after another. A merge mistake there breaks take, confirm or listing.
- **Lock order is the highest correctness risk.** The order is accounts → item → preference, with take as the only exception. Group 6 must test the parallel-take race and the event deletion with two buyers. Group 5 must test the M4 race with a real second session. A savepoint fixture cannot reproduce a second session.
- **Ledger tests are rewritten on purpose (group 2).** The stage-1 "PARTY is never debited" assertions are removed. Reviewers should check that the replacements (declared debit/credit types, overdraft) are at least as strict.
- **Wants `OfferMode` gains POINTS (group 7).** The matcher suite (`src/matcher`) must run in groups 7 and 16, even though no matcher code changes.
- **The baseline must not be counted as regressions:** 33 vitest failures, 2 stale backend tests, mypy 15, ruff 65.
- **Shared frontend files:** `ItemCard.tsx` is touched by 8 (Record maps) and 11 (price prop). `appHelpers.ts` is touched by 8 (ItemMode maps and `parsePointsPrice`). `api/points.ts` is touched by 8 only. The executor serializes on these files.

## Overview
Total Steps: 110
Task Groups: 16 (14 implementation, 1 test review, 1 docs and full suites)
Expected Tests: 50–112 focused tests across groups 1–14 (each writes 2–8, target ~5), plus up to 10 in group 15. That is about 60–120 in total, above the generic 16–34 range because this is a high-risk, cross-module feature with 14 implementation groups. Existing key-set and fixture updates are not counted as new tests.

## Implementation Steps

### Task Group 1: Database — migration 0109 and models
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0109_points_offers.py`, `src/backend/app/points/models.py`, `src/backend/app/groups/models.py`, `src/backend/app/inventory/models.py`, `src/backend/app/inventory/infrastructure/ledger.py`, `src/backend/app/inventory/domain/item_privacy.py`, `src/backend/tests/test_points_offers_migration.py`, `src/backend/tests/test_points_migration.py`
**Estimated Steps:** 8

- [x] 1.0 Complete the 0109 schema layer
  - [x] 1.1 Write 3–5 focused tests in `tests/test_points_offers_migration.py`
    - `test_migration0109_downgradeThenUpgrade_roundTrips` (downgrade 0108 → upgrade head; config columns, `points_price`, constraints and the BURN row exist)
    - `test_migration0109_downgradeWithPointsData_refuses`, parametrized over the three guard counts (HOLD/SALE/RELEASE transaction, POINTS preference, POINTS reservation). The message names the counts and "restore the pre-0109 dump". `alembic upgrade head` + `engine.dispose()` run in `finally`.
    - `test_migration0109_head_seedsOneBurnAccountAndConfigDefaults` (0.50/1.50/100/10, exactly one BURN row)
    - Use `_alembic` from `tests/test_personal_pickup_migration.py`
  - [x] 1.2 Write `alembic/versions/0109_points_offers.py` upgrade (down_revision `0108_nullable_password_hash`, `SET LOCAL lock_timeout = '5s'`)
    - four `points_config` columns NOT NULL with server defaults (0.50/1.50/100/10), then drop the defaults
    - `item_listing_preferences.points_price SMALLINT NULL` + `ck_item_listing_preferences_points_price` `(mode = 'POINTS') = (points_price IS NOT NULL)` + `ck_item_listing_preferences_points_price_positive`
    - drop `uq_point_accounts_party_id`; add `uq_point_accounts_party_id_account_type`; recreate `ck_point_accounts_party_id_account_type` (PARTY/HELD ⇒ party_id; EMISSION/BURN ⇒ NULL); add the partial unique index `uq_point_accounts_account_type_burn WHERE account_type = 'BURN'`
    - insert the BURN row with explicit `id`, `created_at`, `updated_at`
    - docstring records the schema+seed-in-one exception (as 0104)
  - [x] 1.3 Write the guarded downgrade
    - the three counts → `RuntimeError` naming them and "restore the pre-0109 dump"
    - then in reverse: delete HELD/BURN accounts → drop the BURN index, restore the old CHECK and `uq_point_accounts_party_id` → drop the preference CHECKs and column → drop the config columns
    - leave `wants.offer_mode = 'POINTS'` rows untouched
  - [x] 1.4 Update `app/points/models.py`
    - `PointAccountType` + HELD, BURN; `PointTransactionType` + HOLD, SALE, RELEASE
    - `PointAccount.__table_args__` mirrors the new unique constraint, CHECK and BURN partial index
    - `PointsConfig` gains `price_min_ratio`/`price_max_ratio` (`Numeric(4,2)`), `price_cap`/`price_step` (Integer); remove "not enforced" from the `max_points_offers` docstring
  - [x] 1.5 Update `app/groups/models.py`: `ItemListingPreference.points_price: Mapped[int | None]` (SmallInteger) with both CHECKs in `__table_args__`
  - [x] 1.6 Inventory enum ripple
    - `inventory/models.py`: `ReservationType.POINTS`, `MovementType.POINTS`
    - `inventory/infrastructure/ledger.py::MOVEMENT_RULES[POINTS]` = the GIFT rule
    - `inventory/domain/item_privacy.py::_TERM_DATED_MOVEMENTS` + POINTS
  - [x] 1.7 Update `tests/test_points_migration.py:122-134` head sets: swap `uq_point_accounts_party_id` for `uq_point_accounts_party_id_account_type`; add `uq_point_accounts_account_type_burn` to the index set
  - [x] 1.8 Ensure database layer tests pass
    - run only `tests/test_points_offers_migration.py` and `tests/test_points_migration.py`

**Acceptance Criteria:**
- The 3–5 new tests and the updated `test_points_migration.py` pass
- `alembic upgrade head` → `downgrade 0108` → `upgrade head` round-trips on an empty POINTS dataset; it refuses with POINTS data
- The model `__table_args__` match the migration (no autogenerate drift)

---

### Task Group 2: Points ledger contract and account reads
**Dependencies:** 1
**Files to Modify:** `src/backend/app/points/infrastructure/ledger.py`, `src/backend/app/points/application/awards.py`, `src/backend/app/points/application/reads.py`, `src/backend/app/points/schemas.py`, `src/backend/tests/test_points_ledger.py`, `src/backend/tests/test_points_me_api.py`, `src/backend/tests/test_points_awards.py`, `src/backend/tests/test_points_awards_contexts.py`
**Estimated Steps:** 9

- [x] 2.0 Complete the ledger contract change
  - [x] 2.1 Write 4–6 focused tests (rewrite in `tests/test_points_ledger.py`, extend `tests/test_points_me_api.py`)
    - `test_transactionRules_everyType_declaresDebitsCreditsAndParties`: replaces "every rule debits EMISSION". One table row per type, matching spec R8.3.
    - `test_postPoints_debitBeyondLockedBalance_raisesLedgerInvariantError` and `test_postPoints_entryOnUndeclaredAccountType_raises`: replace "PARTY debit raises"
    - `test_lockAccounts_partyAndHeld_createsOneAccountPerType` (tuple keys, sorted, lazily created)
    - `test_getMe_empty_returnsZeroBalanceHeldReputation` (literal `{"balance": 0, "held": 0, "reputation": 0}`; `SUMMARY_KEYS` + `held`, `ENTRY_KEYS` + `held_amount`)
    - keep the AST "only `ledger.py` constructs point rows" guard unchanged
  - [x] 2.2 Rewrite `TransactionRule` as `(source_type, pair_limited, counts_reputation, debits: frozenset, credits: frozenset)` and fill `TRANSACTION_RULES` for GIVE_FREE/EXCHANGE/WISHLIST_MATCH/ATTENDANCE/HOLD/SALE/RELEASE (spec R8.3 table: SALE pair-limited, no reputation)
  - [x] 2.3 Rewrite `post_points` validation
    - remove the "Stage 1 never debits a PARTY account" guard and `_require_account_types`' PARTY-credit rule
    - negatives only on `debits` types, positives only on `credits` types, sum 0, no zero amounts
    - for each debited PARTY/HELD account: `account_balance + amount ≥ 0` in the same session, else `LedgerInvariantError`
    - still flush-only; validate everything before adding rows
  - [x] 2.4 Rewrite `lock_accounts(db, keys: Iterable[tuple[UUID, PointAccountType]]) -> dict[tuple, UUID]`
    - sorted Core `INSERT … ON CONFLICT (party_id, account_type) DO NOTHING`, then `SELECT … FOR UPDATE ORDER BY party_id, account_type`
    - `emission_account_id` → `system_account_id(db, account_type)` for EMISSION and BURN
    - add `hold_amounts(db, reservation_ids) -> dict[UUID, int]` (HOLD credit on HELD, one query, empty input → `{}` with no query)
  - [x] 2.5 Rewrite the `ledger.py` docstring: declared debit/credit types, balance check under the lock, one account per (party, type), BURN/HELD, SALE/RELEASE mutual exclusion, lock order accounts → item → preference (take as the documented exception)
  - [x] 2.6 Update the stage-1 call sites in `points/application/awards.py` (L8)
    - `:70`, `:182` pass `(party, PARTY)` keys; `accounts[party]` (`:127`) and `accounts[award.party_id]` (`:202`) → `accounts[(party, PARTY)]`
    - `_attendance_in_cap_month` (`:185`, `:208-223`) takes the PARTY account ids
    - `:106`, `:188` call `system_account_id(db, EMISSION)`
  - [x] 2.7 Account reads (R9) in `points/application/reads.py` + `points/schemas.py`
    - `_account_id` filters `account_type`
    - `PointsSummaryResponse` = `{balance, held, reputation}`
    - history: one row per transaction per caller over the caller's PARTY and HELD entries; `amount` = PARTY sum (0 if none), new `held_amount` = HELD sum, `total` = distinct transactions; statement count constant (keep the `count_queries` test)
  - [x] 2.8 Test helpers: `_account_id` in `test_points_awards.py:150-153` and the giver-account select in `test_points_awards_contexts.py:98-102` add `PointAccount.account_type == PARTY`. `tests/point_ledger_assertions.py` stays as is.
  - [x] 2.9 Ensure ledger tests pass
    - run only `test_points_ledger.py`, `test_points_me_api.py`, `test_points_awards.py`, `test_points_awards_contexts.py`, `test_term_attendance_points.py` (stage-1 regression set)

**Acceptance Criteria:**
- The new and rewritten tests pass, and the stage-1 award and attendance tests stay green with tuple-keyed `lock_accounts`
- An overdraft posting raises `LedgerInvariantError`, and no row is added
- `/api/points/me` returns `held`; the history rows carry `held_amount` with a constant statement count

---

### Task Group 3: Pricing domain, config keys and item-value
**Dependencies:** 1
**Files to Modify:** `src/backend/app/points/domain/pricing.py`, `src/backend/app/points/application/pricing.py`, `src/backend/app/points/application/config.py`, `src/backend/app/points/application/valuation.py`, `src/backend/app/points/schemas.py`, `src/backend/app/points/router.py`, `src/backend/app/points/service.py`, `src/backend/app/points/infrastructure/inventory_acl.py`, `src/backend/app/points/infrastructure/users_acl.py`, `src/backend/tests/test_points_pricing.py`, `src/backend/tests/test_points_config_api.py`, `src/backend/tests/test_points_valuation.py`
**Estimated Steps:** 8

- [x] 3.0 Complete pricing, config and item-value
  - [x] 3.1 Write 5–8 focused tests
    - `tests/test_points_pricing.py::test_priceBounds_acceptanceTable` (`it.each`-style `pytest.mark.parametrize`: s=20 → 10–30, 40 → 20–60, 60 → 30–90, 80 → max 100, min>max collapse, the `max(step, …)` guard; `round_step(Decimal(45), 10) == 50`; `is_valid_price(55)` false; `clamp_price` both sides)
    - `test_points_config_api.py`: `CONFIG_KEYS` + 4; `test_putConfig_newKeys_roundTrip`; `test_putConfig_invalidPriceKeys_returnsPolish400` parametrized (min ratio 0.00/1.01, max ratio 0.99/3.01, cap 1001, step 0, cap not a multiple of the step)
    - `test_points_valuation.py`: `test_getItemValue_ownItemId_returnsStoredValueAndBounds`, also after a config change that makes the preview differ; `test_getItemValue_otherOwnersItem_returns403` and `…_unknownOrDeletedItem_returns404`; `test_getItemValue_bothOrNeitherForm_returns400`; `test_getItemValue_mcpReadToken_returns403`; response keys + `price_min/price_max/price_step`
  - [x] 3.2 Write `points/domain/pricing.py` (pure, imports only `decimal`/itself): `PriceBounds(min, max, step)`, `round_step` (`quantize(Decimal(1), ROUND_HALF_UP)`, never `round()`), `price_bounds`, `is_valid_price`, `clamp_price`
  - [x] 3.3 Write `points/application/pricing.py`: `bounds_for(db, suggestion)` (loads config) and `offer_rules(db)` (`max_points_offers`); re-export both from `service.py`
  - [x] 3.4 Config (R1) in `application/config.py` + `schemas.py`
    - `_INTEGER_FIELDS` + („Cena maksymalna”, 1, 1000) and („Krok ceny”, 1, 100)
    - ratio validation: finite, two decimals, 0.01–1.00 / 1.00–3.00 with the exact Polish messages
    - „Cena maksymalna musi być wielokrotnością kroku ceny.”
    - `PointsConfigResponse` floats; `UpdatePointsConfigRequest` required `Decimal`/`int` (`extra=forbid`); `update_config` writes the four fields
  - [x] 3.5 Item value (R2.7)
    - `points/infrastructure/inventory_acl.py`: owned-item read (Core refs `inventory_items` ⨝ `inventories.owner_user_id`, `deleted_at IS NULL`) returning `(owner_user_id, points_value)` or None
    - `users_acl.py`: the caller's user id
    - `application/valuation.py`: `item_value_preview` adds the bounds; new `owned_item_value(db, principal, item_id)` with 404 before 403, and all four fields null when `points_value` is NULL
  - [x] 3.6 `points/router.py` `GET /api/points/item-value`: `item_id` or (`category_id` + `condition`), exactly one form, else 400 „Podaj item_id albo category_id i condition.” Row 69 stays unchanged.
  - [x] 3.7 Keep `points/domain/` importing only itself (the boundary test stays green)
  - [x] 3.8 Ensure pricing/config tests pass
    - run only `test_points_pricing.py`, `test_points_config_api.py`, `test_points_valuation.py` (the R8 probe in this file is changed in group 7; leave it untouched here)

**Acceptance Criteria:**
- All acceptance-table cases pass; nothing above 100 for any s
- The four config keys round-trip, and each Polish 400 matches the spec text
- `item-value?item_id` returns the stored value and its bounds for the owner: 404 before 403, 400 for both forms or neither

---

### Task Group 4: Points purchases — HOLD, SALE, RELEASE
**Dependencies:** 2, 3
**Files to Modify:** `src/backend/app/points/application/purchases.py`, `src/backend/app/points/application/awards.py`, `src/backend/app/points/service.py`, `src/backend/tests/test_points_purchases_ledger.py`
**Estimated Steps:** 7

- [x] 4.0 Complete the purchase use cases in `app/points`
  - [x] 4.1 Write 4–6 focused tests in `tests/test_points_purchases_ledger.py` (service-level, seeding a reservation id and parties via SQL/service helpers + `await db_session.commit()`)
    - `test_lockPurchase_shortBalance_raises409` and `…_familyPair_raises409`, `…_pairLimitWithOpenHold_raises409`
    - `test_postHold_thenSettleSale_postsFourBalancedEntries` (BURN sum = −EMISSION sum, `assert_point_transactions_balanced`, party = seller, counterparty = buyer)
    - `test_releaseAfterSale_raises409` and `test_saleAfterRelease_raises409`; repeats are skipped via the source key
  - [x] 4.2 `lock_purchase(db, buyer, seller, price) -> Purchase`
    - eligible persons with a login (`users_acl.eligible_party_ids`), else 409 „Za punkty mogą kupować tylko osoby z kontem.”
    - shared active family → 409 „Nie można kupować za punkty od członka własnej rodziny.”
    - one sorted `lock_accounts` for buyer PARTY + HELD and seller PARTY
    - pair limit: `_used_pair_slots` (incl. SALE) + the pair's open holds (HOLD without a SALE/RELEASE of the same source id, either direction) ≥ `pair_reward_limit` → 409 „Limit nagród dla tej pary został wyczerpany — spróbuj za kilka dni.”
    - buyer PARTY balance < price → 409 „Za mało punktów — ktoś był szybszy albo masz inne blokady.”
  - [x] 4.3 `post_hold(db, purchase, reservation_id, product_name)`: HOLD PARTY(buyer) −p, HELD(buyer) +p; party = buyer, counterparty = seller; RESERVATION source key
  - [x] 4.4 `settle_sale(db, reservation_id)`: read the HOLD (missing → `LedgerInvariantError`), lock buyer HELD + seller PARTY in one sorted call, RELEASE exists → 409 „Ta transakcja została już rozstrzygnięta”, SALE exists → skip; post HELD −p, BURN +p, EMISSION −p, PARTY(seller) +p with the HOLD's description; no eligibility, family or pair re-check, no WISHLIST_MATCH/GIVE_FREE/reputation
  - [x] 4.5 `release_hold(db, reservation_id)` (lock buyer HELD + PARTY; SALE exists → 409; RELEASE exists → skip; RELEASE HELD −p, PARTY +p) and `lock_release_accounts(db, reservation_ids)` (read all HOLDs in one query, lock every buyer's (HELD, PARTY) in one sorted call)
  - [x] 4.6 `awards.award_exchange` routes a POINTS reservation to `settle_sale`; re-export the purchase functions and `hold_amounts` from `service.py`
  - [x] 4.7 Ensure purchase tests pass
    - run only `test_points_purchases_ledger.py`, plus `test_points_awards.py` as the regression set

**Acceptance Criteria:**
- The 4–6 tests pass. HOLD/SALE/RELEASE entries balance, and burn equals emission
- SALE and RELEASE exclude each other with 409; a repeat posts nothing
- No new importer of `app.points` (`_POINTS_IMPORTERS` unchanged)

---

### Task Group 5: Groups — listing for POINTS and re-valuation
**Dependencies:** 1, 3, 4
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/infrastructure/points_acl.py`, `src/backend/app/groups/infrastructure/product_bridge.py`, `src/backend/app/product/service.py`, `src/backend/app/inventory/application/inventory_items.py`, `src/backend/app/inventory/router.py`, `src/backend/tests/test_points_listing.py`
**Estimated Steps:** 9

- [x] 5.0 Complete POINTS listing
  - [x] 5.1 Write 6–8 focused tests in `tests/test_points_listing.py` (`leaf_category_ids` per test)
    - `test_putPreference_pointsWithoutOwnPhoto_returns400`, parametrized: no photo / only another user's photo; plus `…_pendingOwnPhoto_returns200`
    - `test_putPreference_sixthPointsOffer_returns409` („Masz już maksymalną liczbę ofert za punkty (5).”)
    - `test_putPreference_offRangeOrOffStepPrice_returns400NamingRange` („Cena musi być od 20 do 60 pkt, co 10.”)
    - `test_putPreference_omittedPrice_storesClampedSuggestion` and `…_usesStoredValueAfterConfigChange`
    - `test_patchItem_conditionChange_clampsStoredPrice`; `test_putPreference_switchToGift_nullsPrice`
    - `test_putPreference_modeChangedBetweenReads_returns409NothingWritten` (M4: commit a mode switch from a second `AsyncSession` on the engine between the unlocked read and the item lock, by patching the bridge call)
  - [x] 5.2 Schemas: `_OFFERABLE_RESERVATION_TYPES` + POINTS; `ExchangeMode = Literal["GIFT","SWAP","POINTS"]`; `_validate_mode` message „mode may only be SWAP, GIFT or POINTS”; `SetItemListingPreferenceRequest.points_price: int | None` (with a non-POINTS mode → 400 „Cena w punktach dotyczy tylko oferty za punkty.”); `ItemListingPreferenceResponse.points_price`
  - [x] 5.3 `groups/infrastructure/points_acl.py`: `lock_owner_accounts(db, party_id)` (exactly `(owner, PARTY)`), `price_bounds(db, points_value)`, `offer_rules(db)`
  - [x] 5.4 Photo rule: `product_service.has_own_unrejected_photo(db, product_id, user_id)` (one EXISTS, `status != REJECTED`, `uploaded_by_user_id`), exposed via `groups/infrastructure/product_bridge.py`
  - [x] 5.5 `set_item_listing_preference` for POINTS, in spec order R3.4 inside `mapped_transaction_conflicts`: profile → unlocked read + `becomes_points` → owner account lock → item FOR UPDATE + ownership/location → re-check under the item lock (409 „Oferta zmieniła się w międzyczasie — odśwież.”) → NULL value 400 → photo 400 → limit 409 (only when becoming POINTS; reserved ones counted, this item excluded) → price validate or keep/clamp → write mode, price, visibility, ACTIVE
  - [x] 5.6 Non-POINTS: GIFT/SWAP writes `points_price = NULL`; clearing deletes the row (unchanged)
  - [x] 5.7 Re-valuation hook (M3)
    - `inventory_items.update_item(…, on_revalued=None)`: decide whether the product or condition changes, lock the item via `get_item_for_update` before assigning, compute the new value, call `on_revalued(db, item_id, new_value)`; the whole use case runs in `mapped_transaction_conflicts`
    - `term_item_listings.clamp_points_price`: preference FOR UPDATE; POINTS outside the new bounds → `clamp_price`
    - `inventory/router.py` passes `on_revalued=term_item_listings.clamp_points_price` (the `on_registered` pattern); PATCH schema unchanged
  - [x] 5.8 Keep inventory free of any `app.groups` import (the hook is injected by the router)
  - [x] 5.9 Ensure listing tests pass
    - run only `test_points_listing.py`, plus `test_term_item_listings_router.py` and `test_module_boundaries.py` as regression sets

**Acceptance Criteria:**
- The 6–8 tests pass, including the M4 race with a second session
- PUT and `item-value?item_id` agree on bounds (both from the stored `points_value`)
- A deadlock or serialization failure on PUT/PATCH maps to 409

---

### Task Group 6: Groups and inventory — take (HOLD), confirm (SALE), cancel (RELEASE)
**Dependencies:** 4, 5
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/domain/confirm_race_rules.py`, `src/backend/app/groups/infrastructure/points_acl.py`, `src/backend/app/groups/infrastructure/inventory_bridge.py`, `src/backend/app/inventory/domain/reservation_rules.py`, `src/backend/app/inventory/application/reservation_transitions.py`, `src/backend/app/inventory/infrastructure/points_acl.py`, `src/backend/app/inventory/infrastructure/repository.py`, `src/backend/app/events/service.py`, `src/backend/tests/test_points_purchase_flow.py`
**Estimated Steps:** 9

- [x] 6.0 Complete the POINTS reservation flow
  - [x] 6.1 Write 6–8 focused HTTP tests in `tests/test_points_purchase_flow.py` (reuse `_setup`/`_listed_item`/`_take`/`_confirm` from `test_points_awards.py`, `_oauth_token` from `test_authorization_matrix.py`)
    - `test_takePoints_holdsPrice_availableDownHeldUp` (party = buyer, counterparty = seller, balanced)
    - `test_takePoints_priceMismatchOrShortBalance_returns409NoReservation`, parametrized
    - `test_takePoints_parallelTakesOneBalance_oneCreatedOne409` (two engine sessions, `asyncio.gather`)
    - `test_takePoints_mcpEditToken_returns403NoHold`, plus the same token on a GIFT take still 201
    - `test_confirmPoints_sellerForbiddenBuyerSettles` (seller 403 and `can_confirm` false; an `mcp:edit` confirm 403, then the buyer's login 200; SALE uses the HOLD amount after a price edit; no reputation)
    - `test_cancelPoints_sellerOrBuyer_releases`, parametrized; `test_deleteEvent_twoBuyers_releasesBoth`
  - [x] 6.2 `ItemTakeRequest.points_price: int | None = None` (required for POINTS: 400 „Podaj cenę w punktach.”; refused otherwise)
  - [x] 6.3 `require_login_principal(principal)` in `term_item_listings.py` (`AccessDeniedException` unless `"PERMISSION_EDIT" in principal.authorities`); call it for a POINTS take right after the profile, before any read
  - [x] 6.4 `_take` POINTS branch inside `mapped_transaction_conflicts`: price mismatch 409 „Cena zmieniła się — odśwież.” → `points_acl.lock_purchase` → `create_reservation(…, POINTS, commit=False)` → `points_acl.post_hold` → notifications with „ za {p} pkt”. SWAP still redirects; GIFT is unchanged.
  - [x] 6.5 Confirm
    - `_may_confirm` and `confirm_race_rules`: GIFT and POINTS are recipient-only (`transaction_action_flags` inherits)
    - `confirm_transaction`: `require_login_principal` for POINTS after resolving the reservations; lock order award/SALE → `inventory_bridge.get_item_for_update` per leg in item-id order → preference read and delete → DRAFT → `fulfill_exchange`
    - `reservation_rules._require_exchange_legs` accepts one POINTS leg; new message „Wymiana to jedna rezerwacja GIFT albo POINTS albo dwie sparowane rezerwacje SWAP”
    - `repository.list_active_hand_over_reservations_for_terms/_events` filter `reservation_type IN (GIFT, POINTS)`
  - [x] 6.6 Cancel
    - `inventory/infrastructure/points_acl.py`: `release_hold`, `lock_release_accounts`
    - `reservation_transitions._release` calls `release_hold` first, before mutating, for POINTS
    - `cancel_reservations_without_commit` calls `lock_release_accounts` after the FOR UPDATE row lock and before the loop
    - `cancel_transaction` wraps `cancel_exchange` in `mapped_transaction_conflicts`; `events/service.delete_event` too
  - [x] 6.7 Cover term, event and personal contexts (parametrize the confirm test over `context.kind`)
  - [x] 6.8 Notification texts: both take notifications append „ za {p} pkt” after the product name (asserted in the 6.1 take test via the notifications table)
  - [x] 6.9 Ensure flow tests pass
    - run only `test_points_purchase_flow.py`, plus `test_points_awards.py`, `test_points_awards_contexts.py`, `test_party_reservation_actions.py`, `test_term_item_listings_router.py` and the event reservation tests as regression sets

**Acceptance Criteria:**
- The 6–8 tests pass; the parallel takes give exactly one 201
- An `mcp:edit`-only token gets 403 on a POINTS take and a POINTS confirm, with nothing written
- Cancel by the seller, the buyer and event deletion each release. SALE and RELEASE never both happen.

---

### Task Group 7: Read models, counts and the R8 exceptions
**Dependencies:** 4, 6
**Files to Modify:** `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/application/my_reservations.py`, `src/backend/app/groups/application/owner_items.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/infrastructure/points_acl.py`, `src/backend/app/search/schemas.py`, `src/backend/app/search/application/*.py`, `src/backend/app/search/infrastructure/groups_acl.py`, `src/backend/app/pages/schemas.py`, `src/backend/app/pages/application/owner_pages.py`, `src/backend/app/pages/application/organization_page.py`, `src/backend/app/pages/infrastructure/groups_acl.py`, `src/backend/app/events/schemas.py`, `src/backend/app/events/page.py`, `src/backend/app/wants/schemas.py`, `src/backend/app/wants/infrastructure/groups_acl.py`, `src/backend/tests/test_points_valuation.py`, `src/backend/tests/test_points_read_models.py`, existing key-set tests (listed in 7.7)
**Estimated Steps:** 8

- [x] 7.0 Complete the read side
  - [x] 7.1 Write 3–5 focused tests
    - rewrite the R8 probe `test_points_valuation.py::test_itemResponses_valuedListedItem_carryNoPointsField`: `_R8_ALLOWED = {"points_price", "held_points"}` with a comment that `held_points` is party-only; it covers a GIFT item (price null wherever present), a POINTS item, and a reserved POINTS item seen by a third person (no `party_reservation`, no `held_points`)
    - `tests/test_points_read_models.py::test_searchOfferTypePoints_returnsOnlyPointsWithPrice`
    - `…::test_myReservations_pointsRow_carriesHeldPoints` and `…::test_myItemsCounts_includePoints`
    - `…::test_wantOfferModePoints_matchesPointsListing` (create a want with `offer_mode=POINTS`)
  - [x] 7.2 Response fields (R4 table): `ItemActionsResponse.points_price`, `ItemPartyReservationResponse.held_points` (via `points_acl.hold_amounts`), `MyInventoryItemResponse.points_price`, `MyReservationResponse.held_points`; `my_reservations._MODES` + POINTS
  - [x] 7.3 Search: `ProductResultMeta.points_price` from the search `groups_acl` preference column; `offer_type` widens through `ExchangeMode`
  - [x] 7.4 Pages: `OwnerItemCardResponse.points_price` from the pages `groups_acl`; counts gain POINTS in `MyInventoryItemCountsResponse`, `OwnerItemCountsResponse`, `OrganizationItemStatsResponse`; sums become GIFT + SWAP + POINTS in `owner_items.py` L32, `owner_pages.py` L219/L269 and `organization_page.py` L71/L77
  - [x] 7.5 Events: `EventParticipantItemResponse.points_price` via `groups_acl.item_listing_preferences_select` in `events/page.py`
  - [x] 7.6 Wants: `OfferMode` + POINTS; `WantMatchMeta.points_price` from the wants `groups_acl` (shared by matches, suggestions and similar)
  - [x] 7.7 Deliberate key-set updates (never loosened): `test_item_actions.py` ACTIONS_KEYS, `test_party_reservation_actions.py` PARTY_KEYS, `test_search_api.py` META_KEYS["product"], `test_owner_items_page.py`, `test_organizer_page.py`, `test_event_page.py` ITEM_KEYS, `test_my_reservations.py` ROW_KEYS, `test_wants_matches_api.py` and `test_wants_similar_api.py:23` META_KEYS, `test_term_item_listings_router.py:264-286`, `test_item_visibility.py` PREFERENCE_KEYS + counts, `test_my_items_page.py`, `test_reserved_listings.py`, `test_party_profile.py` counts
  - [x] 7.8 Ensure read-model tests pass
    - run only the tests in 7.1 and the files in 7.7, plus the matcher suite from `src/matcher` (wants `OfferMode` changed)

**Acceptance Criteria:**
- The R8 probe passes with exactly the two allowed keys; `held_points` only reaches the parties
- Every listed key set is updated, and the matcher suite is green
- `points_price` appears only for POINTS listings across actions, search, pages, events and wants cards

---

### Task Group 8: Frontend types, labels and POINTS mode ripple
**Dependencies:** None
**Files to Modify:** `src/frontend/src/api/groups.ts`, `src/frontend/src/api/itemListingPreferences.ts`, `src/frontend/src/api/inventories.ts`, `src/frontend/src/api/reservations.ts`, `src/frontend/src/api/points.ts`, `src/frontend/src/api/itemActions.ts`, `src/frontend/src/api/search.ts`, `src/frontend/src/api/ownerItems.ts`, `src/frontend/src/api/organizations.ts`, `src/frontend/src/api/wants.ts`, `src/frontend/src/hooks/useItemPointsPreview.ts`, `src/frontend/src/utils/appHelpers.ts`, `src/frontend/src/components/shared/ItemCard.tsx`, `src/frontend/src/components/shared/ItemTileBadges.tsx`, `src/frontend/src/features/terms/components/termLabels.ts`, `src/frontend/src/features/items/blocks/ExchangeModeTabs.tsx`, `src/frontend/src/features/organization-public/organizerHelpers.ts`, `src/frontend/src/features/wanted/OfferModeChips.tsx`, `src/frontend/src/features/wanted/wantText.ts`, `src/frontend/src/features/wanted/wantFormViewState.ts`, `src/frontend/src/features/panel/HomeView.tsx`, `src/frontend/src/features/items/ReservedItemsView.tsx`, `src/frontend/src/test/appHelpers.test.ts`, `src/frontend/src/test/ReservedItemsView.test.tsx`, typed fixture factories under `src/frontend/src/test/`
**Visual References:**
- mockup: analysis/design-context/mockups/karty-przedmiot-w-z-cen-w-punktach.html
  element: screen:item-cards-points
  locator: the mode colour legend and the Home mode tiles row (Oddam / Zamienię / Za punkty)
  acceptance: the POINTS tone is `bg-orange text-ink` in `ITEM_MODE_TONE` and `ITEM_MODE_STYLE`; HomeView shows three mode tiles in `grid-cols-3` in the order Oddam, Zamienię, Za punkty, the third with the POINTS count; the POINTS label everywhere is „Za punkty”
**Estimated Steps:** 7

- [x] 8.0 Complete the frontend types and ripple
  - [x] 8.1 Write 3–5 focused tests
    - `src/test/appHelpers.test.ts`: `parsePointsPrice(raw, bounds)` table (`it.each`: "" → null, "4a" → undefined, below min/above max/off step → undefined, "40" → 40) and the `ITEM_MODE_TO_RESERVATION_TYPE` / reverse maps for „za punkty”
    - `ReservedItemsView.test.tsx`: a POINTS row shows „Za punkty” and „{held_points} pkt zablokowane”
    - `wantFormViewState` test: `initialFromPrefill` accepts `offer_type=POINTS`
  - [x] 8.2 Types: `ExchangeMode`, `ListingMode`, `MyItemsModeFilter`, the reservations `mode`, `ReservationType` + `"POINTS"`; `points_price` and `held_points` fields; count types + POINTS; `PointsConfigValues` (+4 keys), `PointsSummary.held`, `PointHistoryEntry.held_amount`, `PointTransactionType` + HOLD/SALE/RELEASE, item-value `price_min/max/step`
  - [x] 8.3 `api/points.ts::getOwnedItemPointsValue(itemId)`; `hooks/useItemPointsPreview.ts::useOwnedItemPointsValue(itemId)` under `POINTS_KEY`
  - [x] 8.4 Every `Record<ExchangeMode, …>` gains POINTS: `ItemCard` PLACEHOLDER_TONE/OFFER_BADGE (label „Za punkty”, orange/ink), `ItemTileBadges`, `termLabels` (EXCHANGE_MODE_LABELS, INTENT_LABELS, EXCHANGE_MODE_TONE), `ExchangeModeTabs`, `organizerHelpers.exchangeTotal`, `OfferModeChips`, `wantText.OFFER_MODE_LABEL`
  - [x] 8.5 `utils/appHelpers.ts`: `ItemMode` + „za punkty” in `ITEM_MODES`, `ITEM_MODE_TONE`, `ITEM_MODE_STYLE`, both reservation-type maps; `parsePointsPrice` (the `parseCapacity` rule)
  - [x] 8.6 `HomeView.tsx` tiles `grid-cols-3`; `ReservedItemsView.tsx` `MODE_LABEL`/`MODE_TONE` + POINTS and the held line; leave `pendingActions.ts:124` as is (fall-through is correct); update typed fixture factories without casts
  - [x] 8.7 Ensure tests pass
    - run only the tests from 8.1 and `npm run typecheck` (must stay at the 0-error baseline)

**Acceptance Criteria:**
- The 3–5 tests pass, and `tsc --noEmit` shows no new errors
- HomeView and the mode maps match the `screen:item-cards-points` acceptance above

---

### Task Group 9: Item create — POINTS mode and price stepper
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/components/shared/PointsPriceStepper.tsx`, `src/frontend/src/features/items/ItemCreateView.tsx`, `src/frontend/src/hooks/useCreateItem.ts`, `src/frontend/src/test/PointsPriceStepper.test.tsx`, `src/frontend/src/test/ItemCreateView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/dodaj-rzecz-wystawienie-za-punkty.html
  element: screen:item-create-points
  locator: the mode group and actions block, the POINTS price panel, the no-photo, error and limit states
  acceptance: one `aria-pressed` group in the order Oddam / Zamienię / Za punkty with Oddam preselected; one primary button („Wystaw” for GIFT/SWAP, orange „Wystaw za N pkt” for POINTS) and the secondary „Wersja robocza” in every mode; in POINTS: the stepper, „System proponuje N pkt”, „Dozwolone A–B pkt, co S” (replacing `ItemPointsPreview`) and the photo info line; without a photo the action is `aria-disabled` with the hint „Dodaj przynajmniej jedno zdjęcie, aby wystawić za punkty.” via `aria-describedby`; a server error is shown verbatim in `role="alert"`; the limit 409 text is the number-neutral L6 text
- mockup: analysis/design-context/mockups/dodaj-rzecz-wystawienie-za-punkty.html
  element: component:price-stepper
  locator: the −/+ stepper with the numeric input and range line
  acceptance: −/+ are `type="button"` with aria-labels „Obniż o S” / „Podnieś o S” and move by `price_step` within the bounds (disabled at each bound); the input is `type="text" inputMode="numeric" pattern="[0-9]*"` with the raw string in state; an invalid value shows inline `role="alert"` „Cena musi być od A do B pkt, co S.” with `aria-invalid` and `aria-describedby`, and blocks submit
**Estimated Steps:** 6

- [x] 9.0 Complete the POINTS create flow
  - [x] 9.1 Write 5–7 focused tests
    - `PointsPriceStepper.test.tsx`: ±step within the bounds (disabled at min/max), a typed off-step value → alert + `aria-invalid`
    - `ItemCreateView.test.tsx`: the mode group (Oddam preselected; GIFT/SWAP submit through „Wystaw”); the POINTS flow calls `createItem` → photo upload → `setItemListingPreference({mode: "POINTS", points_price})` in order; the no-photo hint with `aria-disabled`; **a failed PUT then a retry calls only the PUT, once, with the same id (`createItem` called once, no re-upload)**
  - [x] 9.2 Build `components/shared/PointsPriceStepper.tsx` (props: `value`, `onChange`, `bounds`, `suggestion`, ids for describedby; uses `parsePointsPrice`)
  - [x] 9.3 `ItemCreateView.tsx`: the three-mode `aria-pressed` group and one primary action; POINTS panel with bounds from `useItemPointsPreview` (category + condition), suggestion and range; the photo hint (`aria-disabled` + handler guard; native `disabled` only while busy)
  - [x] 9.4 `useCreateItem.ts`: POINTS = register the draft without `listing_mode` → upload photos → PUT POINTS; keep `createdItemId` state; a retry after a failed PUT calls only the PUT for that id; success navigates to the item page as today
  - [x] 9.5 Verify the mockup acceptance items in the jsdom render (labels, order, aria attributes)
  - [x] 9.6 Ensure tests pass
    - run only `PointsPriceStepper.test.tsx` and `ItemCreateView.test.tsx`

**Acceptance Criteria:**
- The 5–7 tests pass, and the retry test proves that `createItem` runs once
- The implementation matches each `acceptance` criterion of `screen:item-create-points` and `component:price-stepper`

---

### Task Group 10: Item edit — price re-validation
**Dependencies:** 8, 9
**Files to Modify:** `src/frontend/src/features/product/ItemEditForm.tsx`, `src/frontend/src/features/items/ItemEditView.tsx`, `src/frontend/src/utils/itemQuickAdd.ts`, `src/frontend/src/hooks/useItemDetail.ts`, `src/frontend/src/test/ItemEditView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/edycja-rzeczy-cena-za-punkty.html
  element: screen:item-edit-points
  locator: the price section of the edit form, the condition-change forecast note, the clamp case and the reserved note
  acceptance: the price section shows only for POINTS listings (mode and price from `useItemActions`); with the draft category and condition unchanged, the stepper uses `useOwnedItemPointsValue(itemId)` bounds; after a change it shows the forecast „Zmieniłeś stan — sugestia to teraz N pkt (dozwolone A–B)”; while reserved it shows „Zarezerwowana przez X za H pkt — ta rezerwacja rozliczy się po H pkt. Nowa cena dotyczy kolejnych osób.”; a server 400 is shown verbatim and `item-value?item_id` is refetched
- mockup: analysis/design-context/mockups/dodaj-rzecz-wystawienie-za-punkty.html
  element: component:price-stepper
  locator: the reused stepper
  acceptance: the same `PointsPriceStepper` as group 9, with no forked copy
**Estimated Steps:** 6

- [x] 10.0 Complete the POINTS edit flow
  - [x] 10.1 Write 3–5 focused tests in `ItemEditView.test.tsx`
    - the stepper uses the owned-item bounds while the condition is unchanged
    - after a condition change the forecast note shows the preview bounds
    - the reserved note with `held_points`
    - save order: PATCH first, then PUT `{mode: "POINTS", points_price}` only when the price or the bounds changed; a 400 is shown verbatim
  - [x] 10.2 `utils/itemQuickAdd.ts`: `ItemEditDraft.pointsPrice` (raw string)
  - [x] 10.3 `hooks/useItemDetail.ts::useItemEditing`: new `savePointsPrice`, awaiting invalidation of the item-actions and points prefixes
  - [x] 10.4 `ItemEditForm.tsx` / `ItemEditView.tsx`: the POINTS section, the bounds source switch, the forecast and reserved notes, the refetch after a 400
  - [x] 10.5 Verify the mockup acceptance items in the jsdom render
  - [x] 10.6 Ensure tests pass
    - run only `ItemEditView.test.tsx`

**Acceptance Criteria:**
- The 3–5 tests pass
- The implementation matches each `acceptance` criterion of `screen:item-edit-points`

---

### Task Group 11: Cards, search filter and My Items
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/components/shared/ItemCard.tsx`, `src/frontend/src/components/shared/ItemTileBadges.tsx`, `src/frontend/src/features/search/SearchResultCard.tsx`, `src/frontend/src/features/search/SearchFilters.tsx`, `src/frontend/src/features/search/useSearchUrlState.ts`, `src/frontend/src/features/items/blocks/OwnerItemsList.tsx`, card callers (RecentItemsBlock, ProfileItems, Match/Similar/SuggestionCard, ParticipantItemsPreview), `src/frontend/src/features/items/MyItemsView.tsx`, `src/frontend/src/test/ItemCard.test.tsx`, `src/frontend/src/test/ItemTileBadges.test.tsx`, `src/frontend/src/test/SearchView.test.tsx`, `src/frontend/src/test/MyItemsView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/karty-przedmiot-w-z-cen-w-punktach.html
  element: screen:item-cards-points
  locator: the card grid (Oddam / Zamienię / POINTS cards) and the My Items list row with the price chip
  acceptance: a POINTS card shows the badge „N pkt” and no suggestion; MyItemsView offers the mode option „Za punkty” (a PUT without a price), the price chip, the POINTS filter with its count; the seller of a POINTS reservation sees only „Anuluj”, never „Potwierdź” (`recipientConfirms`)
- mockup: analysis/design-context/mockups/karty-przedmiot-w-z-cen-w-punktach.html
  element: component:points-badge
  locator: the orange badge on a card
  acceptance: `bg-orange text-ink`, visible text „N pkt”, sr-only „Za punkty: N pkt” (separator `{" "}` outside the hidden span); without a price the text is „Za punkty”
- mockup: analysis/design-context/mockups/wyszukiwanie-filtr-za-punkty.html
  element: screen:search-points-filter
  locator: the offer-type chip row and the result grid
  acceptance: the chip „Za punkty” sets `offer_type=POINTS` in the URL (via the routing facade, `scroll: false`) and is pressed when active; result cards pass `meta.points_price` to the badge
**Estimated Steps:** 6

- [x] 11.0 Complete cards, search and My Items
  - [x] 11.1 Write 4–6 focused tests
    - `ItemCard.test.tsx`: the POINTS badge with a price (visible + sr-only text) and without a price
    - `SearchView.test.tsx`: the „Za punkty” chip writes `offer_type=POINTS`; a result shows its price
    - `MyItemsView.test.tsx`: no „Potwierdź” for the seller of a POINTS reservation; the POINTS filter and its count; the mode option sends a PUT without `points_price`
  - [x] 11.2 `ItemCard` + `pointsPrice` prop; `ItemTileBadges` the same badge; pass the price from SearchResultCard, OwnerItemsList, RecentItemsBlock, ProfileItems, Match/Similar/SuggestionCard and ParticipantItemsPreview (term-listing cards fall back to „Za punkty”)
  - [x] 11.3 `SearchFilters` + `useSearchUrlState` (`OFFER_TYPES` + POINTS)
  - [x] 11.4 `MyItemsView`: `isGift` → `recipientConfirms` (GIFT or POINTS); the mode option, price chip, filter and count
  - [x] 11.5 Verify the mockup acceptance items in the jsdom render
  - [x] 11.6 Ensure tests pass
    - run only the four test files above

**Acceptance Criteria:**
- The 4–6 tests pass
- The implementation matches each `acceptance` criterion of `screen:item-cards-points`, `component:points-badge` and `screen:search-points-filter`

---

### Task Group 12: Item page and points reservation sheet
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/features/product/itemActionsViewState.ts`, `src/frontend/src/features/product/blocks/ItemPickupActions.tsx`, `src/frontend/src/features/product/blocks/ItemHeader.tsx`, `src/frontend/src/features/product/blocks/ItemStatus.tsx`, `src/frontend/src/features/product/PartyReservationActions.tsx`, `src/frontend/src/features/product/useItemTake.ts`, `src/frontend/src/features/product/PointsReservationSheet.tsx`, `src/frontend/src/test/itemActionsViewState.test.ts`, `src/frontend/src/test/useItemTake.test.tsx`, `src/frontend/src/test/PointsReservationSheet.test.tsx`, `src/frontend/src/test/ssrSafety.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/strona-przedmiotu-za-punkty.html
  element: screen:item-page-points
  locator: the header price line and the three action panels (buyer, owner while reserved, buyer after pickup)
  acceptance: the header shows „Cena N pkt”; the buyer sees „Biorę za N pkt” and the note „Punkty zostaną zablokowane do odbioru. Spalimy je dopiero, gdy potwierdzisz odbiór.”; a guest gets `AuthSheet`; the owner sees „Zarezerwowane przez X · H pkt zablokowane”, „Potwierdza tylko kupujący. Możesz anulować — punkty wrócą do X.” and „Anuluj rezerwację”; after pickup the buyer sees „Potwierdź odbiór”
- mockup: analysis/design-context/mockups/okno-rezerwacji-za-punkty-saldo.html
  element: screen:points-reservation-sheet
  locator: the sheet body rows, the short-balance state and the 409 state
  acceptance: rows „Cena”, „Dostępne saldo”, „Po rezerwacji” and the pickup line; the primary action „Zablokuj N pkt i rezerwuj”; a short balance makes it `aria-disabled` with the hint „Brakuje Ci D pkt.”; a 409 or 403 is shown verbatim with „Odśwież”, which refetches actions and points; `ModalSheet` focus trap and `useRegisterOpenSheet(open)`
**Estimated Steps:** 7

- [x] 12.0 Complete the item page POINTS flow
  - [x] 12.1 Write 5–7 focused tests
    - `itemActionsViewState.test.ts`: new `it.each` rows (POINTS buyer, POINTS owner reserved with `heldPoints`, POINTS buyer after pickup, guest)
    - `PointsReservationSheet.test.tsx`: balance after; a short balance blocked with the hint; a 409 shown verbatim with „Odśwież”
    - `useItemTake.test.tsx`: the `pointsPick` state sends `takeItem({reservation_type: "POINTS", points_price, context})` after the context picker and awaits invalidation of the points and actions prefixes
    - `ssrSafety.test.tsx`: an `initialToken` case for the item page with a POINTS item (the sheet host must not touch browser globals)
  - [x] 12.2 `resolveItemActionsView` carries `pointsPrice` and `heldPoints`
  - [x] 12.3 `PointsReservationSheet.tsx` on `ModalSheet` (portal, `type="button"` everywhere, open-sheet registration), balance from `useMyPoints`
  - [x] 12.4 `useItemTake`: `pointsPick` like `swapPick`; the context picker first when needed
  - [x] 12.5 `ItemPickupActions`, `ItemHeader`/`ItemStatus` and `PartyReservationActions` texts per the mockup; the seller gets only cancel
  - [x] 12.6 Verify the mockup acceptance items in the jsdom render
  - [x] 12.7 Ensure tests pass
    - run only the four test files above

**Acceptance Criteria:**
- The 5–7 tests pass
- The implementation matches each `acceptance` criterion of `screen:item-page-points` and `screen:points-reservation-sheet`

---

### Task Group 13: Admin config — POINTS offers section
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/features/admin/PointsConfigPage.tsx`, `src/frontend/src/features/admin/pointsConfigForm.ts`, `src/frontend/src/test/pointsConfigForm.test.ts`, `src/frontend/src/test/PointsConfigPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/admin-konfiguracja-ofert-za-punkty.html
  element: screen:admin-points-offers
  locator: the „Oferty „za punkty”” section with its five fields and the live example line
  acceptance: the section is no longer dimmed and has no „etap 2” label; fields „Limit ofert”, „Minimum ceny (× sugestia)”, „Maksimum ceny (× sugestia)”, „Cena maksymalna”, „Krok ceny” (Chakra/slate admin style); ratios take a decimal comma with two decimals in 0.01–1.00 / 1.00–3.00; the live example reads „Przykład: sugestia 40 → 20–60 pkt; …; nigdy powyżej {cap}.”; server 400s are shown verbatim
**Estimated Steps:** 5

- [x] 13.0 Complete the admin section
  - [x] 13.1 Write 3–5 focused tests
    - `pointsConfigForm.test.ts`: DEFAULTS + the four keys; `parseRatio` `it.each` (ranges, comma, two decimals); the live example in integer hundredths at 30 × 1.15, step 1 → 35, and 40 → 20–60 at the defaults
    - `PointsConfigPage.test.tsx`: CONFIG literal + 4 keys; a server 400 shown verbatim
  - [x] 13.2 `pointsConfigForm.ts`: a new `RatioField` type and `parseRatio(raw, min, max)` (the `MultiplierField` union and its 0.01–9.99 rule are not reused); `priceBoundsExample` as the integer mirror of `price_bounds`
  - [x] 13.3 `PointsConfigPage.tsx`: un-dim the section, add the four fields and the live example
  - [x] 13.4 Verify the mockup acceptance items in the jsdom render
  - [x] 13.5 Ensure tests pass
    - run only the two test files above

**Acceptance Criteria:**
- The 3–5 tests pass, and the client example matches the server's Decimal result
- The implementation matches each `acceptance` criterion of `screen:admin-points-offers`

---

### Task Group 14: Account points — held tile and history
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/features/points/AccountPointsView.tsx`, `src/frontend/src/features/points/PointsTiles.tsx`, `src/frontend/src/features/points/PointsHistoryRow.tsx`, `src/frontend/src/features/points/pointsLabels.ts`, `src/frontend/src/test/AccountPointsView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/twoje-punkty-saldo-blokady-historia.html
  element: screen:account-points-held
  locator: the three-tile row and the history list
  acceptance: three tiles „dostępne”, „zablokowane”, „reputacja”, with no „wkrótce” note; history labels HOLD „Blokada: …” (−p), RELEASE „Zwolnienie blokady: …” (+p), SALE with `held_amount < 0` „Zakup: …” showing „zablokowane p → wydane”, any other SALE „Sprzedaż: …” (+p); subtitles „Sprzedawca: …” / „Kupujący: …”
**Estimated Steps:** 5

- [x] 14.0 Complete the account points page
  - [x] 14.1 Write 2–4 focused tests in `AccountPointsView.test.tsx`
    - the three tiles with `held`
    - `it.each` over HOLD, RELEASE, buyer SALE and seller SALE rows: label, sign, subtitle
  - [x] 14.2 `PointsTiles` + `held`; remove the „wkrótce” note
  - [x] 14.3 `pointsLabels.ts` + `PointsHistoryRow.tsx`: labels, icons and the buyer/seller SALE split on `held_amount`
  - [x] 14.4 Verify the mockup acceptance items in the jsdom render
  - [x] 14.5 Ensure tests pass
    - run only `AccountPointsView.test.tsx`

**Acceptance Criteria:**
- The 2–4 tests pass
- The implementation matches each `acceptance` criterion of `screen:account-points-held`

---

### Task Group 15: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
**Files to Modify:** `src/backend/tests/test_points_*.py`, `src/frontend/src/test/*.test.ts(x)` (append only)
**Estimated Steps:** 4

- [x] 15.0 Review and fill critical gaps
  - [x] 15.1 Review the tests from groups 1–14 against the spec's Testing Approach list and the Success Criteria
  - [x] 15.2 Analyse gaps for this feature only. Likely candidates, in priority order:
    - a take whose pair limit counts an open hold in the reverse direction
    - a repeat confirm or cancel posting nothing
    - the hand-over query including POINTS
    - SALE pair-limited in the `_used_pair_slots` count
    - a deadlock on `update_item` or `delete_event` mapped to 409 (patched `OperationalError` 40P01)
    - the history `count_queries` with HOLD/SALE/RELEASE rows
    - the frontend price chip in MyItemsView
  - [x] 15.3 Write up to 10 additional strategic tests
  - [x] 15.4 Run the feature-specific tests only (all `test_points_*` files, the key-set files from 7.7, and the frontend test files touched in groups 8–14)

**Acceptance Criteria:**
- All feature tests pass
- No more than 10 additional tests are added

---

### Task Group 16: Documentation and cross-suite regression
**Dependencies:** 15
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/standards/backend/security.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 6

- [x] 16.0 Complete docs and full-suite regression
  - [x] 16.1 `architecture.md` points section (R12.1)
    - replace the stage-1 framing and the "Out of scope / stage 2" bullet with the „Stage 2 part 1: POINTS offers” bullets (pricing and `item-value?item_id`, listing rules, HOLD/SALE/RELEASE, lock order with take as the safe exception, the login-token rule, the R8 exceptions, history rows, the accepted pair-limit overshoot)
    - rewrite the ledger contract bullet (debit/credit types, balance check, per-type accounts, BURN)
  - [x] 16.2 Add the 0109 runbook to `architecture.md`
    - `pg_dump` first, run the matcher suite, build the backend before web
    - the three guard counts before any downgrade
    - `docker compose run --rm --no-deps backend alembic downgrade 0108` from the new image, refused while POINTS data exists → restore the dump
    - no image-only rollback past 0109; an old image rejects re-saving a want with `offer_mode='POINTS'`
    - still open: SALE_REFUND and the 30-day reminder
    - no secret values in any example (names only)
  - [x] 16.3 `standards/backend/security.md`: one line saying that POINTS take/confirm require the login `EDIT` authority, with an `mcp:edit`-only token getting 403 in the use case
  - [x] 16.4 `INDEX.md` architecture paragraph: replace "stage 2 (POINTS mode) … out of scope" with the one-line POINTS offers summary (0109 schema, HELD/BURN, HOLD/SALE/RELEASE, 4 config keys, `item-value?item_id`, login-only POINTS take/confirm, R8 exceptions, runbook)
  - [x] 16.5 Run the full suites and compare with the baseline
    - backend from `src/backend`: `uv run python -m pytest`, `uv run python -m mypy` (baseline 15), `uv run python -m ruff check` (baseline 65), only the 2 known stale failures allowed
    - matcher from `src/matcher`: its pytest suite, mypy and ruff
    - frontend from `src/frontend`: `npm test` (only the 33 pre-existing failures), `npm run typecheck` (0), `npm run lint`
  - [x] 16.6 Record any regression with its file and test name for the verification phase. Fix it only if it is clearly caused by this feature.

**Acceptance Criteria:**
- The docs reflect the spec's R12 items, and INDEX.md no longer calls POINTS out of scope
- The full suites are at baseline or better: mypy 15, ruff 65, 33 vitest failures, 2 stale backend tests, matcher green

## Execution Order

1. Group 1: Database (8 steps)
2. Group 2: Ledger contract and reads (9 steps, depends on 1)
3. Group 3: Pricing, config, item-value (8 steps, depends on 1)
4. Group 4: Purchases HOLD/SALE/RELEASE (7 steps, depends on 2, 3)
5. Group 5: Listing for POINTS (9 steps, depends on 1, 3, 4)
6. Group 6: Take/confirm/cancel (9 steps, depends on 4, 5)
7. Group 7: Read models and R8 (8 steps, depends on 4, 6)
8. Group 8: Frontend types and ripple (7 steps, no dependencies)
9. Group 9: Item create and stepper (6 steps, depends on 8)
10. Group 10: Item edit (6 steps, depends on 8, 9)
11. Group 11: Cards, search, My Items (6 steps, depends on 8)
12. Group 12: Item page and reservation sheet (7 steps, depends on 8)
13. Group 13: Admin config (5 steps, depends on 8)
14. Group 14: Account points (5 steps, depends on 8)
15. Group 15: Test Review & Gap Analysis (4 steps, depends on 1–14)
16. Group 16: Documentation and cross-suite regression (6 steps, depends on 15)

The executor derives concurrency from the `Dependencies` and `Files to Modify` fields above. As a reading aid: the backend chain (1–7) and the frontend chain (8–14) share no dependency or file. Within the backend, 2 and 3 depend only on 1 but share `app/points/schemas.py`. Within the frontend, 9, 11, 12, 13 and 14 depend only on 8 and their file lists do not overlap.

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: validation (integer inputs as text/numeric, shared parser, inline alert), error-handling (typed Polish 400/409, `mapped_transaction_conflicts` on every touched write path), minimal-implementation (no SALE_REFUND or reminder stubs), conventions, coding-style, commenting
- `backend/`: migrations (lock_timeout, named constraints, guarded downgrade, round trip + refusal tests, the recorded schema+seed exception), models (CHECKs mirrored in `__table_args__`, ACL-only cross-module access, 404 before 403), security (no new matrix rows, the login-token rule in the use case), queries (batched `hold_amounts`/`lock_release_accounts`, constant history statements), time (naive-UTC ledger timestamps, no new clock reads)
- `frontend/`: components (`resolve…View` table-tested, routing facade, server-safe rendering), accessibility (ModalSheet trap + `useRegisterOpenSheet`, `aria-disabled` + `aria-describedby`, `aria-pressed`, sr-only spacing, contrast via `bg-orange text-ink`), data-fetching (hooks in `src/hooks/`, awaited prefix invalidation, verbatim server messages)
- `testing/`: backend-testing (exact key sets updated never loosened, `leaf_category_ids` per test, downgrade-refusal tests restore head), frontend-testing (explicit vitest imports, typed fixtures without casts, `renderWithRoute`, `vi.resetAllMocks()`)

## Notes

- Test-driven: each group starts with 2–8 tests
- Run incrementally: only the new tests and the named regression sets after each group; full suites only in group 16
- Mark progress: check off steps as they complete
- Reuse first: `post_points`/`lock_accounts`, `_used_pair_slots`, `mapped_transaction_conflicts`, the `on_registered` hook pattern, `ModalSheet`, `parseCapacity`, `swapPick`
- No git commit, push or PR steps (user rule); leave work uncommitted
- Never print secret values; check configuration by presence only
