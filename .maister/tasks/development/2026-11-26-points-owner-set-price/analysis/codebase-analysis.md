# Codebase Analysis Report

**Date**: 2026-11-26
**Task**: POINTS mode (points system stage 2) where the owner sets `points_price` within bounds around the system suggestion, with a condition correction at pickup
**Description**: POINTS mode (stage 2 of the points system) with an owner-set points_price. suggested = current points_value (snap(base[size_class]×multiplier[condition]) → 20/40/60). Bounds: min=max(10, round10(s×price_min_ratio 0.5)), max=min(price_cap 100, round10(s×price_max_ratio 1.5)), step 10, server 400 with the range. The form has a +/−10 field and „System proponuje 40”, and the suggestion appears only in the form; cards and the item page show points_price. Condition correction at pickup: new_price=round10(points_price×mult[new]/mult[declared]), min 10; buyer SALE_REFUND of the difference, seller SALE=new_price. Unchanged: burn at the buyer = emission to the seller (settled price), max_points_offers=5, pair limit, family rule, photo required, block after 3 corrections, a 30-day reminder proposing price −10 or „oddam za darmo”. New config: price_min_ratio, price_max_ratio, price_cap, price_step. Acceptance: s=40 → 20–60; s=60 → 30–90; nothing >100; 55 rejected; NEW→FAIR at 90: 90×0.75/1.5=45→50, buyer gets back 40.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## TL;DR
- **Stage 2 (POINTS mode) is not built at all.** Nothing below exists yet: POINTS mode, `points_price`, the SALE/SALE_REFUND types, hold and burn, the pickup condition correction, the correction counter, the 30-day reminder, and checks for the photo requirement or `max_points_offers`. The task is worded as a change to stage-2 decisions that were only written down (in `2026-11-19-points-reputation-system/analysis/scope-clarifications.md`, in spec.md "Stage 2 notes" ~L592-605, and in `architecture.md` L508). Doing it means building all of stage 2.
- The ledger is built on the rule that it never debits a PARTY account (`ledger.py` L122-123 and `_require_account_types`). One party can hold only one account (`uq_point_accounts_party_id`). One source key per reservation blocks several corrections. All three must change in a new migration 0109.
- The price sits naturally on `item_listing_preferences` (groups). That suits the module-boundary rules, because search, pages and wants already read that table through their `groups_acl`.
- Two things conflict with what was agreed before. Showing `points_price` on cards and responses breaks the R8 "no point field" probe test and the recorded stage-2 decision of a „za punkty” badge without the price. Both need explicit sign-off.

## Key Decisions
- **Treat the task as "build stage 2 with an owner-set price", not "change a price rule".** No POINTS code path exists to tweak.
- **Store `points_price` on `ItemListingPreference` (groups), with a CHECK `mode='POINTS' ⇔ points_price IS NOT NULL`.** The mode already lives there, and consumers in other modules reach it through their existing `groups_acl` (`app.points` imports are locked to 3 modules).
- **Snapshot the price and the declared condition on the reservation at take.** `update_item` re-values `points_value` on a product or condition PATCH even while the item is reserved (`inventory_items.py` L282), so live values are not reliable at confirm.
- **Put the pure maths in `app/points/domain/` and use `Decimal` with `ROUND_HALF_UP`.** This covers `price_bounds(s, config)`, `round10`, `corrected_price(price, mult_declared, mult_new, config)` and validating a price against the step. Banker's rounding (Python `round`) gives 45→40, which fails the acceptance case 45→50.
- **Extend `GET /api/points/item-value` with `price_min`/`price_max`/`price_step` rather than adding a route.** It is already the form preview and already covered by matrix row 69.
- **Turn the ledger's TransactionRule into a debit/credit pair.** Remove the PARTY-debit guard and add an explicit "no negative balance" check under `lock_accounts`.

## Open Questions / Risks
- **R8 conflict.** `test_points_valuation.py::test_itemResponses_valuedListedItem_carryNoPointsField` (~L223) asserts that no key containing "point" appears in item, public details, actions or search responses, and spec R8 says these key sets are "updated, never loosened". A visible `points_price` needs a recorded exception like `attendance_points` (architecture.md L506), and the probe must be rewritten deliberately.
- **Card display conflict.** The recorded stage-2 decision says lists and search show a „za punkty” badge *without* the price. The task says cards show `points_price`. Which one is the product decision?
- **"Owner may only lower" is superseded.** The new bounds allow prices above the suggestion. Anti-farming still holds, because the award equals the price actually paid, but this should be recorded as a changed decision.
- **Hold vs burn timing.** The recorded design is HOLD at „Biorę” into a held account, burn on confirm, release on cancel or reject. That needs HELD accounts, which collide with the unique `party_id` constraint. The simpler alternative is a balance check at take and a burn at confirm, which risks overspending across parallel reservations. A decision is needed.
- **Multiple corrections vs the source key.** The unique key `(transaction_type, source_type, source_id)` allows one SALE_REFUND per reservation. Two options: (a) settle once at confirm with the final corrected price, or (b) add a `CONDITION_CORRECTION` source type keyed by a correction row.
- **What "block after 3 corrections" counts** (per seller? per item? per buyer?), and what it blocks (POINTS listings? takes?). No correction counter exists.
- **Suppression semantics.** When the pair limit, family rule or eligibility suppress the seller's SALE, should the buyer's burn still happen? Stage-1 suppression skips the whole award silently. Burning without an emission breaks "points in circulation unchanged"; skipping the burn means a free item.
- **The 30-day reminder needs new infrastructure.** It needs a scheduled job, a notification kind, and an anchor on the listing date (is there a listed-at timestamp on the preference?). The photo requirement and `max_points_offers` (stored, not enforced) must be enforced at listing, the latter under the account lock.
- **Who reports the pickup condition and when.** The buyer, on an open POINTS reservation, before confirm, worse condition only? Nothing about pickup condition exists today, so the UI flow has to be designed from scratch.
- **Many cancel and release paths.** `cancel_transaction`, `event_reservations.cancel_open_event_reservations` (event delete), the term-end scan, and proposal rejection. Missing one leaks held points.
- **The migration needs a runbook.** Like 0103–0108 it needs `pg_dump` first, a guarded downgrade once any SALE row exists, and no image-only rollback.

---

## Summary

The stage-1 points system is complete. It covers the ledger, valuation (`points_value` 20/40/60), awards at confirm for GIVE_FREE/EXCHANGE/WISHLIST_MATCH/ATTENDANCE, and admin config. Stage 2 exists only as recorded decisions. Delivering this task means extending four areas: the ledger (party debits, burn, possibly hold accounts, new transaction types), the listing model (a POINTS mode with an owner-set price), the reservation flow (take-time balance and hold, buyer confirm, condition correction, release on cancel), and the frontend (the item form price stepper, card and item-page price, the reservation window, admin config). The size of the work comes from ExchangeMode being used in roughly 15 places across backend modules and from a TypeScript `Record<ExchangeMode, …>` in every frontend label map.

---

## Files Identified

### Primary Files

**src/backend/app/points/infrastructure/ledger.py**
- `TransactionRule(source_type, pair_limited, counts_reputation, debits)` L53-86. Every rule debits EMISSION.
- `post_points` L102-147 is flush-only, and L122-123 raises "Stage 1 never debits a PARTY account". `_require_account_types` L150-174 requires a PARTY credit.
- `lock_accounts` L191-229 lazily creates PARTY accounts (ON CONFLICT on `party_id`) and locks them in party-id order. `existing_source_ids`/`source_key_exists` L232-267, `account_balance` L270, `account_reputation` L281.
- Why it matters: this is the main blocker for burning and holding points. It needs a credit side, a balance check, and new account types.

**src/backend/app/points/models.py**
- Enums L52-66: `PointAccountType` PARTY/EMISSION, `PointTransactionType` GIVE_FREE/EXCHANGE/WISHLIST_MATCH/ATTENDANCE, `PointSourceType` RESERVATION/TERM_ATTENDANCE.
- `PointTransaction` L106-171 has a unique source key, a counterparty CHECK (ATTENDANCE ⇔ NULL) and a cap_month CHECK. `PointEntry` has `amount<>0`.
- `PointsConfig` L206-232 is the singleton, and `max_points_offers` is unenforced.
- Changes needed: SALE/SALE_REFUND (plus HOLD/RELEASE if held), BURN/HELD account types, the four new config columns, and a widened `uq_point_accounts_party_id` → `(party_id, account_type)` with an extended `ck_point_accounts_party_id_account_type`.

**src/backend/app/points/application/config.py**
- `_INTEGER_FIELDS` L18-30 (field, Polish label, min, max) and the multiplier `Numeric(4,2)` fields L32-40 with validation L68-78. `update_config` compares `updated_at` and returns 409.
- Changes needed: add `price_cap`/`price_step` as integers, add the `price_min_ratio`/`price_max_ratio` decimals, and add a cross-field `min_ratio ≤ max_ratio` check.

**src/backend/app/points/domain/valuation.py** and **application/valuation.py**, **service.py**
- `snap` (<30→20, <50→40, else 60), `item_points_value`, `value_for`, `item_value_preview`, and the `compute_item_points_value` facade.
- These are the home for `price_bounds`, `round10` and `corrected_price`.

**src/backend/app/points/application/awards.py** and **domain/awards.py**
- `award_exchange`: eligibility → family skip → `lock_accounts` → `load_config` → `_used_pair_slots` → `plan_exchange_awards` (branches on `reservation_type`) → `post_points`.
- Changes needed: a POINTS branch (buyer burn, seller SALE at the settled price, pair limit plus family rule on the seller side).

**src/backend/app/groups/application/term_item_listings.py**
- `set_item_listing_preference` L149-205 (PUT `/api/item-listing-preferences/{item_id}`), where price validation and the `max_points_offers` and photo checks go.
- `_lock_takeable_preference` L606-620 and `_take` L648-715 (mode check L676, SWAP → propose L679, `create_reservation(commit=False)` L686). The hold or balance check and the snapshot go here.
- `_may_confirm` L874-892 (only a GIFT recipient confirms) needs POINTS treated like GIFT.
- `confirm_transaction` L1149-1190 (inside `mapped_transaction_conflicts`, `points_acl.award_exchange` first) and `cancel_transaction` L1193+ need a release.
- Hard-coded GIFT/SWAP counts at L294-317.

**src/backend/app/groups/models.py** L436-472
- `ItemListingPreference(item_id unique, owner_party_id, mode String(20), visibility)` is where `points_price` should live.

**src/backend/app/groups/schemas.py**
- `_OFFERABLE_RESERVATION_TYPES` {SWAP, GIFT} L35, the `ExchangeMode` Literal L543, `SetItemListingPreferenceRequest/Response` L755-786, `MyInventoryItemResponse.points_value` L789-816, Take/Propose requests L898-907, `ItemActionsResponse.mode` L955-970.

**src/backend/app/inventory/models.py**
- `ReservationType` L99-106 is LEND/RETURN/SWAP/GIFT and needs POINTS.
- `Reservation` L261-331 has no price, declared-condition or correction columns, so it needs the snapshot (or a groups side table).
- `InventoryItem.points_value` L238-241.

**src/backend/app/inventory/domain/reservation_rules.py** and fulfilment
- `_require_exchange_legs` accepts only one GIFT leg or two SWAP legs.
- `_post_fulfilment` uses `MovementType(reservation_type.value)`, so POINTS needs a MovementType (and a `ledger.py::MOVEMENT_RULES` entry) or a mapping to GIFT.

**src/backend/app/inventory/application/inventory_items.py**
- `register_item` L55-100 (value L80, `on_registered` hook L96-98 inserts the preference) and `update_item` L265-290 (re-values at L282 even while reserved).

**src/backend/app/inventory/schemas.py**
- `_LISTING_MODES` L36-38 and the create/update requests L89-125 with `listing_mode`. Create needs `points_price`.

**src/backend/app/points/router.py** and **schemas.py**
- GET/PUT `/api/points/config` and GET `/api/points/item-value`. `PointsConfigResponse`/`UpdatePointsConfigRequest` use `extra=forbid` with a full replace, so the four fields are required on PUT.

**src/frontend/src/features/items/ItemCreateView.tsx**, **features/product/ItemEditForm.tsx**, **ItemEditView.tsx**, **useCreateItem.ts**
- `submit(mode)` L71-82, the preview L106, and the Oddam/Zamienię buttons L136-147. A third mode and a +/−10 price field with „System proponuje N” go here.

**src/frontend/src/components/shared/ItemPointsPreview.tsx**, **hooks/useItemPointsPreview.ts**, **api/points.ts**
- „Wycena systemu: N pkt”, `getItemPointsValue` L84-93, `PointsConfigValues` L7-26, `PointTransactionType` L49.

### Related Files

- **Other ExchangeMode consumers (backend):** `my_reservations._MODES`, `item_actions`, `app/search` (application L109-115 and L309-310 `offer_type`, router, schemas L27), `app/pages` (schemas, owner_pages, groups_acl), search `groups_acl`, wants `offer_mode`, organization stats.
- **ACLs:** `groups/infrastructure/points_acl.py`, `inventory/infrastructure/points_acl.py`, `points/infrastructure/inventory_acl.py` (`exchanged_items`: points_value, product_name).
- **Reservation paths:** `groups/application/event_reservations.py` (`cancel_open_event_reservations`), the term-end scan, and proposal reject.
- **`app/db.py::mapped_transaction_conflicts`**, which wraps confirm.
- **`app/core/authorization_matrix.py`**: rows 60 (PUT item-listing-preferences), 64 (`(confirm|cancel)-transaction`, load-bearing), 68 (config ADMIN) and 69 (`/api/points` READ).
- **Migrations:** head `0108_nullable_password_hash`, so the next is 0109. 0103 tables, 0104 columns, 0105 seed (pattern references).
- **Frontend API and labels:** `api/itemListingPreferences.ts` (ListingMode), `api/inventories.ts` (points_value, listing_mode, MyItemsModeFilter), `api/groups.ts` ExchangeMode L324, `features/points/pointsLabels.ts`, `utils/appHelpers.ts` L66-111 (ITEM_MODES), `termLabels.ts` EXCHANGE_MODE_LABELS, wanted `OfferModeChips`, search `useSearchUrlState`.
- **Cards:** `components/shared/ItemCard.tsx` (OFFER_BADGE, PLACEHOLDER_TONE `Record<ExchangeMode>`), used by SearchResultCard, OwnerItemsList, RecentItemsBlock, ProfileItems, Match/Similar/SuggestionCard and ParticipantItemsPreview. `ItemTileBadges.tsx` is used by `ItemHeader.tsx`.
- **Item page and reservations:** `ItemPage.tsx`, `itemActionsViewState.ts`, `blocks/ItemStatus.tsx`, `ItemPickupActions.tsx`, `useItemTake.ts`, `PartyReservationActions.tsx`, `useReservationSettlement.ts`, `ChooseContextSheet`/`PersonalPickupSheet`/`TakeSuccessSheet`, `ReservedItemsView`, `pendingActions`.
- **Owner list:** `MyItemsView.tsx` L440-470 (mode badge and owner points_value chip).
- **Admin:** `pointsConfigForm.ts` and `PointsConfigPage.tsx` (the dimmed „Oferty „za punkty” (etap 2)” section with `max_points_offers`, plus the MultiplierField/parseMultiplier decimal-comma pattern).
- **Docs:** `.maister/docs/project/architecture.md` L488-510 (points section, ledger contract, R8, stage-2 line 508).

---

## Current Functionality

- **Valuation.** `points_value = snap(base[size_class] × multiplier[condition])` produces 20/40/60. It is stored on `inventory_items`, set on create and re-set on a condition or product change. The owner sees it only as a chip and the „Wycena systemu” preview.
- **Listing modes.** Only GIFT („Oddam”) and SWAP („Zamienię”). The mode is stored on `item_listing_preferences.mode`.
- **Take flow (`_take`).** `require_open` → eligibility → preference read → own-item refusal → placeable → lock the preference `FOR UPDATE` → mode check → SWAP is redirected to propose → `create_reservation` → notifications → commit.
- **Confirm.** Only the GIFT recipient confirms (`_may_confirm`). Inside `mapped_transaction_conflicts`: `award_exchange` (emission only, EMISSION → PARTY), delete preferences, DRAFT, `fulfill_exchange`.
- **Ledger.** Append-only, and the balance is the SUM of entries. PARTY accounts are only ever credited. Idempotency comes from the unique source key.
- **Pickup condition.** No concept exists anywhere: no declared-condition snapshot, no correction, no counter.

### Key Components/Functions

- **post_points**: the only writer of point rows (AST-guarded), flush-only.
- **lock_accounts**: lazily creates accounts and locks them deterministically in party-id order.
- **award_exchange / plan_exchange_awards**: plan the stage-1 awards per reservation type.
- **_used_pair_slots**: counts pair-limited transactions in both directions within the window. SALE should be pair_limited=True and counts_reputation=False.
- **set_item_listing_preference**: the single place where mode and visibility are written.
- **item_value_preview**: backs the form preview. It should also return the bounds.

### Data Flow

Item form → POST `/api/inventory-items` (listing_mode) → `register_item` → `on_registered` hook inserts the `ItemListingPreference` → public reads (search, pages, actions) read the mode via groups ACLs → „Biorę” → `_take` → reservation → pickup → `confirm_transaction` → `award_exchange` → `post_points`.

In POINTS mode the price travels with the preference. It is snapshotted at take (with the declared condition), possibly corrected before confirm, and settled at confirm as a buyer burn plus a seller SALE at the settled price, with a SALE_REFUND (or reduced burn) for the difference.

**Arithmetic check against the acceptance criteria** (default ratios 0.5 and 1.5, cap 100, step 10, half-up rounding):
- s=20 → 10–30
- s=40 → 20–60
- s=60 → 30–90
- 55 fails the step check
- NEW (1.50) → FAIR (0.75) at 90: 90 × 0.75 / 1.50 = 45 → 50, and the buyer gets back 40

---

## Dependencies

### Imports (What This Depends On)

- `points_config` (bases, multipliers, new ratios, cap, step) feeds the bounds and the correction.
- `inventory_items.points_value`, `size_class` and the condition give the suggestion `s`.
- `app/db.py::mapped_transaction_conflicts` maps deadlocks and serialization failures to 409.
- Lock order to keep: event FOR SHARE → preference/proposal FOR UPDATE → point accounts (party-id order) → items.

### Consumers (What Depends On This)

- **app/groups**: listing, take, confirm, cancel, counts, my_reservations, item_actions.
- **app/inventory**: create/update item, reservation rules, fulfilment, MOVEMENT_RULES.
- **app/search**: the `offer_type` filter and result meta.
- **app/pages**: owner, organizer and party item lists, organization stats.
- **app/wants**: `offer_mode` and match cards.
- **Frontend**: about 25 files (ItemCard plus its 7 users, item page blocks, the forms, MyItemsView, admin config, labels, search).

**Consumer Count**: 15+ backend files, 25+ frontend files
**Impact Scope**: High. ExchangeMode is cross-cutting, the ledger invariants change, and public response shapes change.

---

## Test Coverage

### Test Files

- **test_points_valuation.py**: valuation plus the R8 no-point-field probe (recursive `_keys` L214, test ~L223). It must change.
- **test_points_awards.py / test_points_awards_contexts.py**: awards per context, with helpers `_setup/_listed_item/_take/_end_term/_confirm` from `test_term_item_listings`.
- **test_points_ledger.py**: asserts that every rule debits EMISSION and that a PARTY debit raises. Both must change. The AST guard (only ledger.py constructs rows) stays.
- **test_points_config_api.py**: the exact `CONFIG_KEYS`, which gains 4 keys.
- **test_points_migration.py**: uses `_alembic` from `test_personal_pickup_migration`, and is the pattern for the 0109 up/down and guard tests.
- **test_points_me_api.py**: `count_queries`. History must render the SALE/SALE_REFUND types.
- **tests/point_ledger_assertions.py**: `assert_point_transactions_balanced`, reusable for burn plus emission.
- **test_authorization_matrix.py**: the parametrized points test ~L172. A correction route needs a row.
- **Exact key sets touched**: `test_item_actions` ACTIONS_KEYS, `test_search_api` META_KEYS["product"], ITEM_KEYS in `test_owner_items_page`/`test_organizer_page`/`test_event_page`, `test_item_details`, `test_my_reservations` ROW_KEYS.
- **test_module_boundaries.py**: `_POINTS_IMPORTERS` is exactly 3 modules.
- **Frontend**: `pointsConfigForm.test.ts` (DEFAULTS literal), `PointsConfigPage.test.tsx` (CONFIG literal), `ItemCreateView.test.tsx`, `ItemDetailPage.test.tsx`, `ItemCard.test.tsx`, `ItemTileBadges.test.tsx`, `ItemPointsPreview.test.tsx`, `usePointsConfig.test.tsx`, `useItemTake.test.tsx`, `ItemEditView.test.tsx`, `AccountPointsView.test.tsx`.

### Coverage Assessment

- **Test count**: stage 1 has strong integration coverage (about 8 backend points files plus key-set tests and 11 frontend files).
- **Gaps**: no tests for anything in stage 2, since none of it exists. Concurrency (two parallel takes against one balance) and every cancel/release path will need new tests. Per the memory note, the baseline already has 33 vitest and 2 backend stale failures, so don't count those as regressions.

---

## Coding Patterns

### Naming Conventions

- **Components**: PascalCase views in `src/features/<domain>/`, thin route files in `src/app/`.
- **Functions**: snake_case use cases (`set_item_listing_preference`, `award_exchange`), private helpers with a leading `_`, and camelCase hooks in TS (`useItemTake`).
- **Files**: `tests/test_<feature>.py` with `test_<operation>_<scenario>_<expected>`. Migrations are `NNNN_<name>.py`.

### Architecture Patterns

- **Style**: DDD-ish modules (`domain/` pure, `application/` use cases, `infrastructure/` ACLs and ledger), with cross-module access only through `infrastructure/<other>_acl.py`.
- **Ledger**: the accounting archetype (accounts, transactions, entries, a balance as a SUM, idempotent source keys).
- **Config**: one row, a full-replace PUT with an `updated_at` compare, and Polish 400s from `ValueError`.
- **Money-like values**: Numeric(4,2) multipliers as `Decimal`. Points are ints.
- **Frontend state**: TanStack Query hooks in `src/hooks/`, discriminated view states (`itemActionsViewState.ts`), and integer inputs as `type="text" inputMode="numeric"` with a shared parser (validation standard).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~40 backend and ~30 frontend files touched, `term_item_listings.py` >1200 lines | High |
| Dependencies | ledger, config, valuation, groups, inventory, search, pages, wants | High |
| Consumers | 15+ backend, 25+ frontend ExchangeMode/points consumers | High |
| Test Coverage | strong for stage 1, none for stage 2 | Medium |

### Overall: Complex

This is a new feature stage, not a parameter change. It touches ledger invariants, a migration with new types and constraints, concurrency-sensitive take, confirm and cancel paths, public response shapes guarded by R8, and a new UI flow (correction at pickup, reservation balance window).

---

## Key Findings

### Strengths
- The ledger is cleanly isolated behind `post_points`, with an AST guard, idempotent source keys, deterministic lock ordering and a shared balance assertion helper.
- Bases and multipliers are already configurable, so the bounds and the correction are pure functions over the config.
- `item_listing_preferences` is already read across modules through ACLs, so it is a cheap place to carry the price.
- `GET /api/points/item-value` already serves the form preview and the authorization matrix row.
- `mapped_transaction_conflicts` already wraps confirm, so new locking inherits 409 mapping.

### Concerns
- The ledger invariants "never debit PARTY" and "one account per party" are tested and documented. Changing them is a contract change that must be re-documented in architecture.md and `ledger.py`'s docstring.
- Holding or checking a balance across concurrent takes needs locking on the buyer's account at take time, which adds a lock to a hot path.
- `points_value` drifts while an item is reserved, so a snapshot is mandatory.
- The R8 and badge-without-price decisions conflict with the task.
- Many reservation exit paths must each release or refund correctly.

### Opportunities
- Settling once at confirm with the final corrected price (one burn, one SALE, refunds collapsed) avoids the multi-correction source-key problem, and may make HOLD unnecessary if a balance check plus burn-at-confirm is acceptable.
- Reuse the `attendance_points` R8 exception precedent for `points_price`.
- Reuse the `MultiplierField`/`parseMultiplier` admin pattern for the ratio fields, and `parseCapacity`-style parsing for the price stepper.

---

## Impact Assessment

- **Primary changes**: `app/points/{models,schemas,router,service}.py`, `points/domain/valuation.py` (bounds, round10, correction), `points/infrastructure/ledger.py`, `points/application/{config,awards}.py`, `points/domain/awards.py`, `groups/models.py`, `groups/schemas.py`, `groups/application/term_item_listings.py`, `inventory/models.py`, `inventory/schemas.py`, `inventory/application/inventory_items.py`, `inventory/domain/reservation_rules.py`, the inventory ledger MOVEMENT_RULES, `app/core/authorization_matrix.py`, and the new `alembic/versions/0109_*.py`.
- **Related changes**: search, pages and wants (mode and price via groups_acl), event_reservations and term-end scan cancel paths, a new scheduler job plus notification kind for the 30-day reminder, and architecture.md L488-510.
- **Frontend changes**: ItemCreateView, ItemEditForm, ItemEditView, ItemCard, ItemTileBadges, the item page blocks, the reservation sheets, MyItemsView, admin PointsConfigPage and pointsConfigForm, every `Record<ExchangeMode>` label map, the search offer filter, and AccountPointsView history labels.
- **Test updates**: the R8 probe, the ledger rule tests, CONFIG_KEYS, about 6 exact key-set tests, the authorization matrix, a 0109 migration test, new award, correction, concurrency and cancel-release tests, and the frontend fixtures (DEFAULTS and CONFIG literals, typed factories gaining POINTS and `points_price`).

### Risk Level: High

Ledger invariants change for the first time since stage 1. Points become spendable, so errors are user-visible balance losses. Concurrency bugs on take could overspend. The migration is not image-rollback-safe. The change cuts across many modules, and two product decisions conflict.

---

## Recommendations

**New capability on top of stage 1 (building stage 2):**

1. **Settle the product decisions before the spec.** Decide on R8 (price visible), card display, hold vs balance-check-plus-burn, settle-once vs a per-correction source key, the scope of the "3 corrections" counter, and whether suppression cancels the burn.
2. **Pure domain first, in `app/points/domain/pricing.py`.** Write `round10` (Decimal, ROUND_HALF_UP), `price_bounds(s, cfg) -> (min, max, step)` and `corrected_price(price, mult_declared, mult_new, cfg)` with a minimum of 10. Table-test them against the acceptance cases (s=20/40/60, 55 rejected, >100 impossible, 90 NEW→FAIR → 50 and a refund of 40).
3. **Migration 0109** (`SET LOCAL lock_timeout='5s'`), adding:
   - the config columns with seeds 0.50/1.50/100/10, plus a CHECK on the ratios
   - `item_listing_preferences.points_price SMALLINT` with the mode ⇔ price CHECK and a step/cap CHECK
   - the reservation snapshot (`points_price`, `declared_condition`, `price_corrections` or a side table)
   - SALE/SALE_REFUND (and HOLD/RELEASE if chosen) in the type CHECKs
   - account widening if held accounts are chosen
   - a guarded downgrade refusing while any SALE row exists, with a runbook in architecture.md
4. **Ledger.** Give `TransactionRule` explicit debit and credit account types, remove the PARTY-debit guard, and add an insufficient-balance check computed under `lock_accounts` (409 with a Polish message). Update `test_points_ledger` and the ledger docstring.
5. **Listing.** Make POINTS a third `ExchangeMode`/`ReservationType`. In `set_item_listing_preference` and on create, validate the price against the bounds (400 with the range in Polish), require a photo, and count `max_points_offers` under the owner's account lock. Extend `/api/points/item-value` with `price_min`/`price_max`/`price_step`.
6. **Take, confirm and cancel.** In `_take`, after the preference lock, snapshot the price and condition, then hold or check the balance. `_may_confirm` lets the POINTS buyer confirm. Add a POINTS branch in `award_exchange`: burn at the buyer, SALE to the seller at the settled price, the pair limit and family rule on the seller's SALE. Release or refund in every cancel path. Map POINTS onto the inventory MovementType (GIFT-like single leg).
7. **Correction.** Add a new endpoint (e.g. `POST /api/reservations/{id}/condition-correction`) with its own matrix row (EDIT/mcp:edit) or an extended row-64 regex. It is for the buyer, on an open POINTS reservation, worse condition only, below the counter limit, and returns 409 otherwise.
8. **Reminder.** Add a 30-day scheduled job following the `_run_attendance_close` pattern (batch, `SKIP LOCKED`, one log line) and a new notification kind with the „−10” and „oddam za darmo” actions.
9. **Frontend.** Add a POINTS option in the create and edit forms with a +/−10 stepper bounded by the preview's range and „System proponuje N”. Show the price on ItemCard, ItemTileBadges and the item page. Add a reservation sheet with the price, available balance and balance after (button blocked when too low), a correction UI at pickup, admin config fields, and history labels.
10. **Testing.** Cover the domain maths, the ledger balancing via `assert_point_transactions_balanced`, a parallel take against one balance, every cancel path releasing, a correction refund, the 0109 downgrade guard, the updated key sets (deliberately), and frontend view-state tables.

---

## Next Steps

Invoke the gap-analyzer with this report. Its main job is to turn the Open Questions above (R8 and the card price, hold vs burn-at-confirm, settle-once vs a correction source key, the counter scope, suppression semantics, the reminder anchor) into explicit decisions for the user before the specification phase. Then scope stage 2 as one large task or split it, for example: (a) config, domain pricing and listing with the price; (b) ledger burn and settlement at confirm; (c) the correction at pickup; (d) the 30-day reminder.
