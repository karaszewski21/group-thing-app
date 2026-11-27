# Gap Analysis: POINTS mode with an owner-set price (stage 2 slice: pricing + listing + settlement)

## TL;DR
- None of stage 2 exists. In scope: a third listing mode POINTS with an owner-set `points_price` in [max(10, r(s·0.5)), min(100, r(s·1.5))] step 10; a HOLD at take, then a burn plus SALE at confirm, or a release on cancel; the 5-offer cap and the photo rule. The pickup correction and the 30-day reminder are deferred.
- The task is mostly additive, but it changes two invariants: the ledger contract (a PARTY account may now be debited; one account per party becomes one per type) and the R8 rule (`points_price` becomes public). It touches about 20 backend and about 30 frontend files. Migration 0109 has a guarded downgrade.
- Three hazards found in the code. (1) `_may_confirm` lets *anyone* confirm a non-GIFT reservation, so the seller could burn the buyer's points. (2) Product photos are shared across owners and uploaded *after* the item is created, so "photo required" can't be a naive check at create. (3) The term-end prompt queries are GIFT-only, so a POINTS reservation would never prompt for confirmation.
- 4 critical and 11 important decisions remain. The biggest are: what the photo rule means, the price-consent race at take, pair-limit or family drift between take and confirm, and where the release hook lives.

## Key Decisions
- **Characteristics.** `modifies_existing_code` (take, confirm, cancel, ledger, forms) + `creates_new_entities` (POINTS mode, HELD/BURN accounts, HOLD/RELEASE/SALE types, 4 config keys) + `involves_data_operations` (the hold → burn/release lifecycle) + `ui_heavy` (form stepper, cards, item page, reservation sheet, admin). `has_reproducible_defect` = no. The `_may_confirm` hazard is latent: it is unreachable until POINTS exists.
- **Change type: additive with modificative core.** Existing GIFT/SWAP behaviour must stay byte-identical (strict compatibility for their key sets, except new nullable keys).
- **The pure maths goes in `app/points/domain/pricing.py`**, using Decimal ROUND_HALF_UP. Verified against the acceptance cases: s=20 → 10–30, s=40 → 20–60, s=60 → 30–90, 55 rejected, the cap of 100 is never exceeded.
- **The HOLD transaction is the authoritative price snapshot.** Confirm burns exactly the held amount, never the live `points_price`, because `update_item` revalues items while they are reserved (L282).
- **The settlement must be one choke point per transition.** Settle in `award_exchange` (already inside `mapped_transaction_conflicts`, before the item locks). Release in inventory's single cancel transition, reached via the allowed `inventory/infrastructure/points_acl.py`, so `cancel_transaction`, event deletion and any future cancel path all release.

## Open Questions / Risks
- **Seller-confirm hazard.** `term_item_listings.py::_may_confirm` (L882-892) returns True for every type other than GIFT. POINTS must be recipient-only, like GIFT, or the seller triggers the burn. A test is mandatory.
- **Points held for weeks.** `_resolve_transaction_reservations_for_action` calls `context.require_ended()`. A term or event POINTS reservation cannot be cancelled before the date, so the buyer's points stay held until then. If nobody ever confirms or cancels (there is no auto-confirm), the points stay held indefinitely. GIFT already has this behaviour; with points it costs a visible balance.
- **No confirmation prompt for POINTS.** `inventory/infrastructure/repository.py` L498 and L520 (`list_active_hand_over_reservations_for_terms/_events`) filter `ReservationType.GIFT`. POINTS must be added, or no "potwierdź odbiór" prompt is ever sent.
- **Deadlock risk.** Confirm locks point accounts, then preferences and items. A listing write that checks `max_points_offers` "under the account lock" after `get_item_for_update` reverses that order on the same item, which can deadlock. Either lock the owner account first or wrap it in `mapped_transaction_conflicts`.
- **Silent POINTS matches.** Wants `offer_mode` NULL matches any `l.mode` in the matcher, so POINTS listings start matching wants as soon as they exist. That is probably desired, but the matcher suite must run (backend schema change on seeded tables).
- **Contract and docs changes.** The ledger contract change ("never debits PARTY", "one account per party") is tested (`test_points_ledger.py`) and documented (`ledger.py` docstring, architecture.md L490-508). Both must be rewritten deliberately, as must the R8 probe (`test_points_valuation.py` ~L223).
- **Deploy.** Migration 0109 is not image-rollback-safe. The downgrade must refuse while any HOLD/SALE row or POINTS preference exists, and needs a runbook entry (pattern 0103–0108).

## Summary
- **Risk Level**: High. The ledger starts debiting user balances, a concurrency-sensitive take path gains a lock, and public response shapes and the R8 rule change.
- **Estimated Effort**: High (about 20 backend files, about 30 frontend files, one migration, about 15 test files updated plus new ones).
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy.

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: yes
- Involves data operations: yes
- UI heavy: yes

## Gaps Identified

### Missing Features (verified absent)
- **POINTS mode.** It is absent from:
  - `ReservationType` (inventory/models.py L99-106) and `MovementType` (L63-73; the mapping `MovementType(reservation_type.value)` requires a POINTS member, or a mapping to GIFT, plus a `MOVEMENT_RULES` entry)
  - `_OFFERABLE_RESERVATION_TYPES` (groups/schemas.py L35) and `ExchangeMode` (L543)
  - `_LISTING_MODES` (inventory/schemas.py L38) and `OfferMode` (wants/schemas.py L16)
  - the frontend `ExchangeMode`/`ListingMode`/`MyItemsModeFilter`/reservations `mode` (api/groups.ts L324, inventories.ts L118, itemListingPreferences.ts L4, reservations.ts L55)
- **`points_price`.** No column, schema field or form field exists. The natural home is `item_listing_preferences`, with a CHECK `(mode='POINTS') = (points_price IS NOT NULL)`.
- **Price bounds and config.** `price_min_ratio`, `price_max_ratio`, `price_cap` and `price_step` are absent from `PointsConfig`, `_INTEGER_FIELDS`/multiplier validation, the config schemas and the FE `PointsConfigValues`/`pointsConfigForm`. `/api/points/item-value` returns only the value, without `price_min`/`price_max`/`price_step`.
- **Ledger.**
  - Account types HELD (per party) and BURN (singleton) are missing. `uq_point_accounts_party_id` and `ck_point_accounts_*` allow only PARTY/EMISSION.
  - Transaction types HOLD, RELEASE and SALE (and possibly BURN) are missing. `TransactionRule.debits` is a single type, and `post_points` L122-123 raises on any PARTY debit.
  - There is no non-negative balance check.
- **Take with a hold.** `_take` has no balance check, no lock on the buyer's account and no HOLD. It also performs no pair-limit or family refusal for POINTS (decision 5).
- **Settlement.** `plan_exchange_awards` has no POINTS branch (burn HELD, SALE to the seller, `counts_reputation=False`, `pair_limited=True`).
- **Release.** No release exists in `cancel_transaction`, in `event_reservations.cancel_open_event_reservations` (`cancel_reservations_without_commit`), or in inventory `reservation_transitions._cancel`.
- **`max_points_offers` enforcement.** The value is stored but never read (`set_item_listing_preference`, `register_item`'s `on_registered`).
- **The photo rule** exists nowhere. Photos are `ProductPhoto` rows on a *shared* product (`get_or_create_product_by_name` reuses another owner's product by name). Each row has `uploaded_by_user_id` and a moderation `status`. The FE uploads photos *after* `registerInventoryItem` (`hooks/useCreateItem.ts`).
- **Available versus held balance** for the reservation sheet. `/api/points/me` has a single balance.

### Incomplete Features
- `_may_confirm`: a GIFT is recipient-only. POINTS would fall through to "anyone may confirm" (hazard).
- Term-end and event-end confirmation prompts are GIFT-only (repository L498/L520).
- Owner, organizer and organization counts are hard-coded to `{GIFT, SWAP}`: `term_item_listings.py` L308-312 (`MyInventoryItemCountsResponse`), `owner_items.py` L27, `organization_page.py` L71 (`item_stats`). `my_reservations._MODES` L35-36 is also hard-coded.
- The search `offer_type` (`search.py` L309) is typed by `ExchangeMode`, so it widens automatically on the backend. The FE filter chips need a POINTS option.
- `ItemTakeRequest.reservation_type` accepts any `ReservationType`. POINTS passes the mode check once the preference holds POINTS, but nothing yet guarantees the price the buyer saw.

### Behavioral Changes Needed
- Ledger: from "PARTY accounts are only ever credited" to "only HOLD debits PARTY, under `lock_accounts`, refused below zero".
- R8: from "no point field in any public, list or search response" to "`points_price` (nullable, POINTS only) on item cards, `/actions`, `/details`, search meta, pages, event participant previews and wants cards".
- Stage-2 record: from "frozen at listing, may only lower" to "owner-set within the bounds, editable". Update architecture.md L508.
- Confirm for POINTS settles even when the live preference or price has changed since the take (it uses the HOLD amount).

## User Journey Impact Assessment

| Journey | Current | After | Assessment |
|---|---|---|---|
| Owner lists for points | Only Oddam/Zamienię buttons in `ItemCreateView` L136-147 and `ItemEditForm` | A third „Za punkty” option, a ±10 stepper bounded by the preview's range, „System proponuje N” | ✅ discoverable 8/10 (same row as the existing modes). ⚠️ Create ordering vs photo (see C1) |
| Buyer sees the price | — | The price on `ItemCard` (7 users) and `ItemTileBadges`/`ItemHeader` | ✅ 9/10 |
| Buyer reserves | „Biorę” → context sheet → take | The same, plus price, available balance and balance after; the button `aria-disabled` with a hint when too low | ⚠️ Needs a points read in the sheet (I3). Guests still get `AuthSheet` |
| Buyer confirms | GIFT recipient confirms after the date | The same for POINTS. The seller must NOT be able to | ❌ Today the code would let the seller confirm |
| Either side cancels | After the date (term/event), at once (personal) | Same gating, plus a release | ⚠️ Points held until the date (risk above) |
| Seller paid | — | SALE credited at confirm, visible in `/points` history | ✅ Needs FE labels for HOLD/RELEASE/SALE |
| Admin config | Dimmed „etap 2” section with `max_points_offers` | Active section with the 4 new fields (ratios use the MultiplierField pattern) | ✅ 7/10 (`/admin/points`) |

Personas: guest (sees the price, no take), logged-in buyer, owner/seller, admin. The organizer is unaffected. Only PERSONAL inventories list (`set_item_listing_preference`), and `owner_party_id` is the person profile, so sellers are always persons. The buyer must be an eligible person (`users_acl.eligible_party_ids`), and the take is refused otherwise.

## Data Lifecycle Analysis

### Entity: `points_price` (on the listing preference)

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | none (`register_item` + `on_registered` writes only the mode; `SetItemListingPreferenceRequest` has no price) | none | Item create form | ❌ |
| READ | none in `MyInventoryItemResponse`, `/actions`, `/details`, search, pages | none on cards or the item page | — | ❌ |
| UPDATE | none (PUT `/api/item-listing-preferences/{id}`) | none in `ItemEditForm`/`MyItemsView` | Edit form | ❌ |
| DELETE | implicit: the mode is cleared, or the preference is deleted at confirm (L1172-1179) | existing „wycofaj” | existing | ✅ (inherits) |

### Entity: point hold (HOLD → SALE/BURN or RELEASE)

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE (HOLD at take) | none | reservation sheet balance | „Biorę” | ❌ |
| READ (held, available) | `/api/points/me` balance only | `AccountPointsView`, the sheet | `/points` | ❌ partial |
| SETTLE (confirm) | `award_exchange` with no POINTS branch | existing confirm button | item page | ❌ |
| RELEASE (cancel, event delete) | none | existing cancel | item page, event delete | ❌ |

**Completeness**: 0% today (all new). Target 100% within scope.
**Orphaned operations (if scope were trimmed)**:
- A price displayed without a create field.
- A hold without a release on event deletion, which leaks points.
- A hold without an available-balance read, which leaves the buyer confused.

All of these are in agreed scope. The release must cover every cancel path.

**Idempotency**: one source key per `(type, RESERVATION, reservation_id)`, so one HOLD, one SALE and one RELEASE per reservation. A SALE and a RELEASE for the same reservation must be mutually exclusive; both settle and release check that a HOLD exists and that neither the other nor themselves exists, under the account lock.

**Missing touchpoints** (where the price or mode must appear):
- search result cards
- owner items, profile and organization recent items
- event and term participant previews
- wants Match/Similar/Suggestion cards
- the item page
- the `ReservedItemsView`/my reservations rows
- the owner's `MyItemsView` mode filter and counts
- the take notifications (they mention a „przynieś/odbierz” but not the points)

## Enum Ripple (checklist for the spec)

Backend:
- `ReservationType`, `MovementType` and `MOVEMENT_RULES`
- `reservation_rules._require_exchange_legs` (one leg: GIFT or POINTS)
- `_OFFERABLE_RESERVATION_TYPES`, `ExchangeMode`, `_LISTING_MODES`
- `my_reservations._MODES`
- `item_privacy` (POINTS behaves like GIFT)
- the term/event hand-over queries
- the counts in `term_item_listings`, `owner_items` and `organization_page`
- the search `offer_type` (automatic)
- the pages schemas (automatic via the ExchangeMode import)
- wants `OfferMode` (decision I8)
- the points `PointAccountType`/`PointTransactionType` plus CHECKs

Frontend:
- `ExchangeMode`, `ListingMode`, `MyItemsModeFilter`, reservations `mode`
- `ItemCard` OFFER_BADGE and PLACEHOLDER_TONE
- `ExchangeModeTabs`, `termLabels` EXCHANGE_MODE_LABELS, `organizerHelpers`
- `utils/appHelpers.ts` ITEM_MODES
- `pointsLabels` (transaction types)
- `OfferModeChips` (wanted)
- the search filter state

## Issues Requiring Decisions

### Critical
1. **C1 What "photo required" means and when it is checked.**
   - The problem: photos are product-level, the product can be shared with other owners, and the FE uploads photos only after the item exists.
   - Options:
     - (A, recommended) A POINTS listing needs ≥1 photo of the product uploaded by the owner (`uploaded_by_user_id`) with status ≠ REJECTED (PENDING allowed). It is checked in `set_item_listing_preference`. On create with POINTS, the FE registers as a draft, uploads the photos, then PUTs the POINTS preference. A later rejection or deletion of the photo leaves the listing as it is.
     - (B) Same, but APPROVED only. This adds moderation delay before an item can be sold.
     - (C) Any photo on the product. A stranger's photo would satisfy it.
     - (D) An FE-only check.
2. **C2 Price consent at take.**
   - The problem: the owner may change the price between the buyer viewing it and pressing „Biorę”.
   - Options:
     - (A, recommended) `ItemTakeRequest` gains `points_price` (required for POINTS). A mismatch with the locked preference gives 409 „Cena zmieniła się — sprawdź nową cenę”.
     - (B) Hold whatever the current price is.
3. **C3 Pair limit or family changing between take and confirm.**
   - The problem: decision 5 refuses the take, but by confirm another exchange may have filled the pair window or the two parties may have joined a family. Suppressing SALE then breaks burn = emission.
   - Options:
     - (A, recommended) Check eligibility, family and the pair limit at take, count open POINTS holds of the pair as used slots, and at confirm always post SALE = HOLD (no re-check).
     - (B) Re-check at confirm and refuse the confirm, which leaves the reservation stuck.
     - (C) Re-check at confirm and release instead, which gives the item away for free.
4. **C4 Who may confirm a POINTS reservation.**
   - Options:
     - (A, recommended) The buyer (recipient) only, like GIFT, by extending `_may_confirm` and `confirm_race_rules`. The seller can still cancel.
     - (B) Either party, which lets the seller burn the buyer's points without a handover.

### Important
1. **I1 Price and mode edits while a POINTS reservation is open.** Default: allowed. The open reservation settles at its HOLD amount, and the edit applies to future takes. Alternative: 409 while reserved.
2. **I2 Condition or category change on a POINTS listing** (s changes, so the bounds change). Default: re-validate. If a price is sent in the same request it must fit the new range (400 naming it); otherwise the stored price is clamped into the new range. Alternatives: 400 always; keep a now out-of-range price.
3. **I3 Buyer balance in the reservation sheet.** Default: in scope. `GET /api/points/me` gains `held`, with `balance` = available. The sheet shows the price, the available balance and the balance after, and blocks with a hint when short. The server stays authoritative (409 „Masz za mało punktów”). Alternative: server 409 only.
4. **I4 What `max_points_offers` counts.** Default: the owner's preference rows with mode POINTS (listed, including reserved, until confirm deletes them), checked on a new POINTS listing or a switch to POINTS under the owner's account lock, with the lock order kept as accounts → item, or wrapped in `mapped_transaction_conflicts`. Lowering the cap never unlists existing offers. Alternative: AVAILABLE-only.
5. **I5 Configurable step versus the hard-coded 10.** Default: generalise. Round to `price_step`, minimum = max(price_step, …), and the stepper moves ±price_step. Config validation: 0 < min_ratio ≤ 1 ≤ max_ratio ≤ 3, `price_cap` a multiple of the step, `price_cap` ≥ the step; if min > max, min is set to max. Alternative: keep a literal 10 and use the step only for validation.
6. **I6 Source of the suggestion s.** Default: the item's stored `points_value` for an existing item and `item_value_preview` for a new one, with the form preview and the server validation using the same function and inputs. Risk: if an admin changes the bases, the stored value goes stale. Alternative: always recompute live.
7. **I7 Ledger shape of the settlement.** Default: HOLD (buyer PARTY −p → buyer HELD +p). At confirm, one SALE transaction with 4 entries (HELD −p, BURN +p, EMISSION −p, seller PARTY +p, pair_limited, no reputation). RELEASE is HELD −p → PARTY +p. HOLD and RELEASE are not pair-limited. Alternative: separate BURN and SALE transactions, or a direct HELD → seller transfer (simplest, but loses "burn = emission" in the books).
8. **I8 Wants `offer_mode` POINTS.** Default: add POINTS to `OfferMode` (a string compare in the matcher, no SQL change; run the matcher suite). A NULL offer_mode already matches POINTS. Alternative: defer.
9. **I9 Search `offer_type=POINTS` filter and counts keys.** Default: in scope. Add a POINTS chip and a `POINTS` key to the `{GIFT, SWAP}` count objects (owner, organizer, organization `item_stats`, `MyInventoryItemCountsResponse`), deliberately updating the exact key sets. Alternative: leave the counts, which makes GIFT + SWAP ≠ listed.
10. **I10 WISHLIST_MATCH bonus on a POINTS sale.** Default: no. Only SALE is posted, because the bonus would mint points on a paid transfer. Alternative: also post it.
11. **I11 Release hook location and the snapshot column.** Default: release inside inventory's cancel transition through `inventory/infrastructure/points_acl.py` (covers `cancel_exchange`, `cancel_reservations_without_commit` and future paths). The HOLD row is the price snapshot. `declared_condition` is added by the follow-up correction task, following the minimal-implementation standard. Alternative: also add `reservations.points_price` now, for cheap reads in `my_reservations`.

## Recommendations
- Split the spec into: (a) domain pricing, config and the 0109 migration; (b) listing (create flow, edit, R8 allowlist); (c) ledger plus take/confirm/release; (d) frontend.
- Write the tests first for the `_may_confirm` restriction, two parallel takes against one balance (one 409), every release path (`cancel_transaction`, event delete), burn = emission via `assert_point_transactions_balanced`, and the 0109 downgrade refusal.
- Keep the R8 exception narrow. It allows a nullable `points_price` only, and the probe allowlist names exactly that key.
- Update architecture.md L488-510 (ledger contract, R8, stage-2 line, 0109 runbook) and the `ledger.py` docstring.

## Risk Assessment
- **Complexity Risk**: High. These are new ledger semantics plus a three-way mode ripple.
- **Integration Risk**: High. Groups, inventory, points, search, pages and wants are all involved, plus the matcher suite and the lock-order invariants.
- **Regression Risk**: Medium. GIFT/SWAP paths are touched in `_may_confirm`, the hand-over queries, the counts and the key-set tests. The baseline failures (33 vitest, 2 backend) are not regressions.
