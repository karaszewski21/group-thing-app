# Implementation Completeness Report: POINTS mode (stage 2, part 1) with an owner-set price

## TL;DR
- **Status: passed_with_issues.** 0 critical, 3 warnings, 6 info.
- **Plan:** all 126 checkboxes are ticked (16 group headers and 110 steps). Code exists for every group I spot-checked, backend and frontend.
- **Standards:** mostly compliant. The gaps are a duplicated price helper pair (minimal implementation), one mutation hook that does not refresh the points cache (data fetching), and a few minor comment and test-helper points.
- **Documentation:** complete. The architecture.md points section, the 0109 runbook, security.md, INDEX.md and the work-log all match spec R12.

## Key Decisions
- **Some items are recorded rather than counted against the task.** The work-log lists them as recorded deviations or open follow-ups, so I report them as warnings or info, not failures:
  - Group 9: ink text on orange, and the mode group placed after Lokalizacja.
  - Group 11: the search keeps its toggle-off chip pattern.
  - Group 12: a context picker before the sheet, the counterparty name not inflected, and generic 403 text.
  - Group 14: history rows keep the card style.
- **Two backend failures and the frontend failures are pre-existing.** The backend failures are `test_owner_items_page` (nearest term, `location_name`) and the 0053 round-trip. The frontend count is 32 failures against a baseline of 33. Both match the stale tests recorded in project memory. I did not re-run any suite; that belongs to the test-suite runner.
- **The ruff findings in touched files are not new.** All 6 are E501 on lines that are byte-identical at HEAD, so this task added none.

## Open Questions / Risks
- **Points data goes stale after confirm/cancel outside the item page.** `useReservationSettlement` does not invalidate `[POINTS_KEY]`, so a confirm or cancel from My Items or pending actions leaves the cached balance and held amount stale until the next mount or refetch.
- **My Items price chip needs a reload (from the work-log, not verified in a browser).** After a My Items mode switch to POINTS, the price chip only appears after a page reload.

---

## 1. Plan Completion

| Metric | Value |
|---|---|
| Checkboxes | 126 / 126 `[x]`, 0 `[ ]` (16 group headers and 110 steps; the work-log says "110 completed, 0 skipped") |
| Completion | 100 % |
| Status | ✅ Complete |

### Spot checks (code evidence)

| Group | Evidence |
|---|---|
| 1 Database 0109 | `src/backend/alembic/versions/0109_points_offers.py` (new) has `lock_timeout`, the 4 config columns with their defaults then dropped, the `points_price` column and its 2 CHECKs, the account unique constraint and CHECK swap, the BURN partial index and the BURN seed, and a guarded downgrade over the 3 counts that names "restore the pre-0109 dump". `PointAccount.__table_args__` mirrors `uq_point_accounts_party_id_account_type` and `uq_point_accounts_account_type_burn` (`app/points/models.py:83-97`). `tests/test_points_offers_migration.py` has the round trip, the head seed, and the refusal with `upgrade head` in `finally`. |
| 2 Ledger contract | The `app/points/infrastructure/ledger.py` docstring is rewritten: debits/credits, the balance check under the lock, per-type accounts, SALE/RELEASE exclusion, and the lock order with take as the exception. `_require_balances` is at L234, `system_account_id` at L276, `lock_accounts` at L288 and `hold_amounts` at L336. |
| 3 Pricing / config / item-value | `app/points/domain/pricing.py` matches R2 exactly: `ROUND_HALF_UP`, the max guard and the min collapse. The tests are `test_points_pricing.py` (acceptance table, cap, half-up, valid, clamp) and the `test_points_valuation.py:404-503` `item_id` form (stored value after a config change, all-null, 403, 404 before 403, both/neither 400, mcp:read 403). |
| 4 Purchases | `app/points/application/purchases.py` (new). `tests/test_points_purchases_ledger.py` covers short balance, family/ineligible, pair limit with an open hold, the 4-entry SALE, RELEASE↔SALE 409s, and SALE counted once. |
| 5 Listing | `set_item_listing_preference` (`app/groups/application/term_item_listings.py:220-307`) follows lock order owner PARTY → item → preference, re-checks M4 (409 `OFFER_CHANGED_MESSAGE`), then valuation → photo → cap → price, all inside `mapped_transaction_conflicts`. `clamp_points_price` hook is at L310, wired at `app/inventory/router.py:179`. `update_item` is wrapped (`inventory_items.py:284`). `tests/test_points_listing.py` has 9 functions covering every R3 test bullet. |
| 6 Take / confirm / cancel | `require_login_principal` is at `term_item_listings.py:770` and is called at L874 (take) and L1325 (confirm). `release_hold` runs first in `_release` (`reservation_transitions.py:83`), and `lock_release_accounts` is at L112. `delete_event` is wrapped (`events/service.py:277`). `tests/test_points_purchase_flow.py` covers the mcp:edit 403, TERM/EVENT/PERSONAL confirm, two-buyer event delete, parallel races and deadlock → 409 on 5 writes. |
| 7 Read models / R8 | `_R8_ALLOWED = {"points_price", "held_points"}` (`tests/test_points_valuation.py:231`). `_POINTS_IMPORTERS` is unchanged (`tests/test_module_boundaries.py:103-107`; that file is not in the diff). `tests/test_points_read_models.py` covers the search filter, my-reservations `held_points`, counts and wants matching. |
| 8–14 Frontend | New `PointsPriceStepper.tsx` (`inputMode="numeric"`, `aria-invalid`, `role="alert"`, ± aria-labels). New `PointsReservationSheet.tsx` (`ModalSheet`, `aria-disabled` + `aria-describedby`). `useItemTake.ts:93` invalidates `[POINTS_KEY]`. Tests are present: `PointsPriceStepper.test.tsx`, `PointsReservationSheet.test.tsx`, `appHelpers.test.ts`, and updated ItemCreateView/ItemEditView/AccountPointsView/PointsConfigPage tests. |
| 15 Test review | 4 functions appended (term-end prompt, SALE slot, 40P01 → 409, constant history queries). |
| 16 Docs | See §3. |

No plan step is unchecked, and I found no missing code.

---

## 2. Standards Compliance

### Applicability reasoning

| Standard | Applies? | Reasoning | Result |
|---|---|---|---|
| global/error-handling.md | ✅ | New 409/400 paths; 40P01/40001 mapping | ✅ `mapped_transaction_conflicts` on PUT, `update_item`, take, confirm, cancel and `delete_event`; `LedgerInvariantError` for contract breaches; deadlock test on 5 writes |
| global/validation.md | ✅ | Price and ratio inputs | ✅ text/numeric input, raw string, shared `parsePointsPrice`, inline alert, server authoritative |
| global/conventions.md | ✅ | Docs kept up to date | ✅ |
| global/coding-style.md | ✅ | All code | ✅ no new ruff findings in touched files (6 E501 all pre-existing at HEAD) |
| global/commenting.md | ✅ | New docstrings | ⚠️ minor: a spec ID in a docstring (`term_item_listings.py:192`, "(R3.4 steps 5-8)") |
| global/minimal-implementation.md | ✅ | New helpers | ⚠️ `_is_valid_price`/`_clamp_price` duplicate the domain functions |
| backend/api.md | ✅ | `item-value?item_id` query form | ✅ no new routes |
| backend/models.md | ✅ | New column, CHECK mirrors, ACLs | ✅ CHECKs mirrored, int points, ACL access, 404 before 403 |
| backend/queries.md | ✅ | Batched hold reads, history | ✅ `hold_amounts` and `lock_release_accounts` batched; constant-query history test |
| backend/jooq.md | ❌ | No change to the filter-DSL query services | n/a |
| backend/migrations.md | ✅ | 0109 | ✅ lock_timeout, named constraints, guarded downgrade naming the recovery path, round-trip and refusal tests restoring head; schema+seed exception recorded in the docstring and the runbook |
| backend/security.md | ✅ | Login-token rule, row 69 | ✅ use-case check plus a doc line; no matrix rows added |
| backend/plugin-auth.md | ❌ | No plugin surface touched | n/a |
| backend/time.md | ✅ | Ledger timestamps | ✅ naive UTC; no new clock reads |
| frontend/css.md | ✅ | Tailwind tokens | ✅ `bg-orange text-ink` tokens |
| frontend/components.md | ✅ | Sheet, stepper, view state | ✅ `resolveItemActionsView` extended with table rows; features layout |
| frontend/accessibility.md | ✅ | Sheet, stepper, mode group | ✅ ModalSheet trap, aria-disabled/describedby, aria-pressed group, sr-only text |
| frontend/responsive.md | ✅ | New screens | ✅ (mockup-driven; not browser-verified here) |
| frontend/data-fetching.md | ✅ | New queries and mutations | ⚠️ `useReservationSettlement` does not invalidate `[POINTS_KEY]` |
| testing/backend-testing.md | ✅ | New test files | ✅ naming and key-set updates. ℹ️ The per-file count exceeds 2–8 (`test_points_purchase_flow.py` has 10 functions), but the spec enumerates these cases. ℹ️ `_PgError` is now defined in a 4th file. |
| testing/frontend-testing.md | ✅ | New tests and fixtures | ✅ typed fixtures, no casts (per work-log) |

Totals: 21 standards checked, 19 applicable. 16 are fully followed and 3 have minor gaps.

### Gaps

1. **minimal-implementation.md (warning).** `src/backend/app/groups/application/term_item_listings.py:157-162` re-implements `is_valid_price` and `clamp_price` from `app/points/domain/pricing.py`, because `points_service` and `points_acl` do not re-export them. Two sources of the price rule can drift apart. **Fix:** re-export both through `points_acl` (as `PriceBounds` already is) and delete the copies. The work-log flags this as a simplification candidate.
2. **data-fetching.md (warning).** `src/frontend/src/hooks/useReservationSettlement.ts:23-31`: `RESERVATION_STATE_KEYS` has no `[POINTS_KEY]`. The item page compensates (`PartyReservationActions.tsx:63`, `useItemTake.ts:93`), but a POINTS confirm or cancel from My Items or pending actions leaves `/api/points/me` cached. **Fix:** invalidate `[POINTS_KEY]` in the settlement hook.
3. **commenting.md (info).** `term_item_listings.py:192`, docstring "(R3.4 steps 5-8)", refers to the spec section rather than describing the code.
4. **backend-testing.md (info).** `class _PgError` is now duplicated in 4 test files (`test_points_ledger.py:494`, `test_points_purchase_flow.py:633`, `test_search_api.py:149`, `test_wants_api.py:112`). It is a candidate for `tests/conftest.py`.

---

## 3. Documentation Completeness

| Artifact | Check | Result |
|---|---|---|
| implementation-plan.md | All steps `[x]`, file intact | ✅ |
| work-log.md | Dated start, 16 group entries with standards/tests/files/notes, final completion entry with suite results and open follow-ups | ✅ |
| spec.md | Audit resolution table H1, M1–M6, L1–L11 | ✅ The audit items map to code and tests: M4 at `term_item_listings.py:258-259` with a test; M6 at `require_login_principal` with tests; L2 at `lock_release_accounts` with the two-buyer test; M2 recorded in Group 11 |
| architecture.md points section | R12.1: stage-2 bullet set, ledger contract rewrite, R8 exceptions | ✅ L490 intro, L494 ledger contract (debits/credits, balance check, per-type accounts, BURN), L500 config keys, L506 R8 allowlist, L508 "Stage 2 part 1: POINTS offers"; no stale "stage 2 out of scope" text remains |
| architecture.md 0109 runbook | pg_dump, matcher suite, backend before web, 3 guard counts, downgrade from the new image, no image-only rollback, the old-image want rejection, still-open items | ✅ L976-989, all 7 elements present |
| standards/backend/security.md | Login-token line | ✅ "Spending Points Needs a Login Token" section, including the RFC 8693 known gap |
| INDEX.md | Architecture paragraph updated | ✅ "POINTS offers (stage 2 part 1, migration 0109…)" replaces the out-of-scope wording |
| visual-coverage.md | 10/10 screens and components mapped | ✅ |
| User docs | Not required by spec | n/a |

**Spec alignment.** R1–R12 all have code and tests. The remaining items are recorded deviations or follow-ups:
- `ChooseContextSheet.tsx:74` shows „Rezerwuję na ten termin” for POINTS, and its doc comment at L24 mentions only GIFT/SWAP (info).
- The My Items price chip after a mode switch appears only after a reload. This comes from the Group 11 work-log follow-up; `AppDataContext.setItemMode` updates only `itemModes` (warning, UX).

---

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | standards | warning | Duplicated price validity/clamp helpers | `src/backend/app/groups/application/term_item_listings.py:157-162` | true | Re-export the domain `is_valid_price`/`clamp_price` via `points_acl` |
| 2 | standards | warning | Settlement hook does not invalidate the points prefix | `src/frontend/src/hooks/useReservationSettlement.ts:23-31` | true | Add `[POINTS_KEY]` to the keys it invalidates (or do so conditionally for POINTS) |
| 3 | documentation | warning | My Items price chip appears only after a reload following a mode switch | `src/frontend/src/features/panel/AppDataContext.tsx:498-517` | true | Refresh `myItems` (or store the saved `points_price`) after `setItemListingPreference` |
| 4 | documentation | info | ChooseContextSheet label/comment not POINTS-specific | `src/frontend/src/features/product/ChooseContextSheet.tsx:24,74` | true | Add a POINTS label (e.g. „Dalej: zablokuj punkty”) and update the comment |
| 5 | standards | info | Spec ID in a docstring | `term_item_listings.py:192` | true | Describe the checks instead of citing "R3.4 steps 5-8" |
| 6 | standards | info | `_PgError` test helper duplicated in 4 files | `tests/test_points_ledger.py:494`, `test_points_purchase_flow.py:633`, `test_search_api.py:149`, `test_wants_api.py:112` | true | Move it to `tests/conftest.py` |
| 7 | standards | info | Test-per-file count above the 2–8 guidance | `tests/test_points_purchase_flow.py` (10 functions) | false | Accepted: the spec enumerates these cases |
| 8 | plan_completion | info | Recorded UI deviations from the mockups | work-log Groups 9, 11, 12, 14 | false | Confirm with the owner in the UI review |
| 9 | plan_completion | info | 2 backend failures, outside this task's code | `test_owner_items_page` nearest-term, 0053 round trip | false | Pre-existing stale tests (project memory) |

**Issue counts:** critical 0 · warning 3 · info 6
