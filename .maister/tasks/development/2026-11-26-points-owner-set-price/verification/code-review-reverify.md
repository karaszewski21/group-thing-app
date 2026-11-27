# Code Review Re-verification: Phase 11 fix loop (cycle 1)

## TL;DR
- Status: Clean. All 11 warnings are resolved. Of the info items, I1–I5, I7 and I8 are resolved, and I6 and I9 are left open on purpose.
- W8: every path that settles a POINTS reservation now locks in the order reservation → accounts → items → preference. Take, the one documented exception, cannot form a cycle. `delete_event` uses the same order.
- No new critical issues and no new warnings. There are 3 new info items, all latent or about UX.
- Checks I re-ran: `test_points_pricing.py` + `test_points_purchase_flow.py` (48 passed); 4 frontend test files (78 passed); ESLint on the touched files (0 errors). Full ESLint shows 10 errors, which matches the baseline, and none of them is in a touched file.

## Open Questions / Risks
- `_release` says in its docstring that "every caller that can meet a POINTS reservation has already locked it". The public `cancel_reservation` / `confirm_reservation` wrappers do not lock. Today they are only called on SWAP legs, so this holds, but a future caller could break it without any warning (N1).

**Date**: 2026-11-26
**Path**: uncommitted working tree (`git diff`), the fix-loop files
**Scope**: all (re-verification)
**Status**: ✅ Clean (info only)

## Summary
- **Critical**: 0
- **Warnings**: 0 (all W1–W11 resolved)
- **Info**: 3 new; I6 and I9 accepted as known

## Original findings

| ID | Verdict | Evidence |
|----|---------|----------|
| W1 | Resolved | `groups/infrastructure/points_acl.py:21-22` re-exports `is_valid_price` / `clamp_price` from `points/service.py`. No `_is_valid_price`, `_clamp_price` or frontend `clampPrice` remains (grep is empty). `ItemEditForm.tsx:331` uses the shared `clampPointsPrice`. |
| W2 | Resolved | `points/domain/pricing.py:38-42`: `min(max(round_step(Decimal(price), step), min), max)`. `round_step` is Decimal `ROUND_HALF_UP` on `value/step` (line 19). The frontend `appHelpers.ts:156-159` does `Math.floor(price/step + 0.5) * step`, then clamps to `[min, max]`. That is the same half-up rounding to a multiple of the step counted from 0 (prices are positive). Float error is ruled out: an exact .5 needs an even step, where `n/step` is exactly representable. Any other quotient lies at least `1/(2·step)` away from .5. Both bounds are on the step: `price_cap % price_step` is refused (`points/application/config.py:101`), and `max(step, round_step(…))` is a multiple of the step. Parity rows exist: `test_points_pricing.py:74-91` (off-step 23→30, 45→50, 59→60 with step 15) and `appHelpers.test.ts:40-55`. |
| W3 | Resolved | `useReservationSettlement.ts:64-67` adds `[POINTS_KEY]` when `movesPoints`, also on an already-resolved answer (line 81). The `["points", …]` prefix covers `useMyPoints` and `useItemPointsPreview`. |
| W4 | Resolved | `AppDataContext.tsx` `setItemMode` writes `points_price: saved?.points_price ?? null` into `items`. |
| W5 | Resolved | `itemCreated` lives in `AppDataContext.tsx:183`. `useCreateItem(created, onCreated)` (`useCreateItem.ts:44-68`) registers only when `created === null`. It calls `onCreated` right after a POINTS register, before the PUT. A retry, also after a remount, repeats only the PUT. `ItemCreateView.tsx:149` clears it on success, together with the draft and the photos. While locked, `LocationPicker` is `disabled={busy \|\| locked}` and the photo field and the form are disabled. GIFT/SWAP stay atomic and never set it. A duplicate remains possible only on a register that fails on the network after the server committed, which was already the case before. See N2 and N3 for UX edges. |
| W6 | Resolved | `ItemCreateView.tsx:108-109`: the default is `clampPointsPrice(suggestion, bounds)`. Test "defaults the POINTS price … non-default config, with no error" passes. |
| W7 | Resolved, no bypass | `term_item_listings.py:180-201`: the photo rule and the `max_points_offers` cap run only when `becomes_points`. `becomes_points` is decided on an unlocked read (`:233-237`) and re-checked under the item and preference locks (`:246-248`). A disagreement is a 409, so a concurrent flip cannot skip the checks. Every other writer of a POINTS preference was checked: `list_registered_item` (`:130-146`) is reachable only with GIFT/SWAP (`inventory/schemas.py:100-105`), and `clamp_points_price` only adjusts the price. The cap count stays sound, because every transition to POINTS takes the owner's PARTY account lock first. A price on an existing POINTS listing is still validated against the stored bounds (`:202-209`). |
| W8 | Resolved | **Confirm** (`term_item_listings.py:1338-1366`): `lock_reservations` → `award_exchange` (awards' PARTY accounts or `settle_sale`'s HELD + PARTY) → item rows `FOR UPDATE` in item-id order → preference delete → `fulfill_exchange`. `fulfill_exchange` re-locks the same rows through `_load_exchange`, which is harmless because they are already held. **Cancel** (`cancel_transaction` → `cancel_exchange` → `_load_exchange` → `lock_reservations`, `reservation_transitions.py:238-247`) → `_release` → `release_hold` accounts → balance row. **`delete_event`** (`cancel_reservations_without_commit`, `:121-153`): reservations `FOR UPDATE` in id order → `lock_release_accounts` (one sorted call) → per-row release. All three follow the same order. **Take** (`:796-840`) is preference `FOR UPDATE` → accounts, with no item lock. To form a cycle, something holding accounts would need preference Z. Two writers take a preference after accounts. One is PUT-becoming-POINTS on Z: Z is not POINTS, so the take refuses on the mode check before it touches any account. The other is a confirm on Z: Z is not AVAILABLE, so `_lock_takeable_preference` refuses. `clamp_points_price` takes no accounts. An event take waits on `delete_event`'s event lock before anything else. So no cycle. The contract in `points/infrastructure/ledger.py:45-55` documents this, and `test_settlePoints_locksReservationBeforeAccounts[cancel/confirm]` (`test_points_purchase_flow.py:429-449`) pins it (passes). |
| W9 | Resolved | `points/application/purchases.py:76-82` and `groups/infrastructure/points_acl.py:49-52` document the account as a mutex only, with the eligibility check skipped on purpose. |
| W10 | Resolved | `architecture.md` 0109 runbook step 2: both images in one `up -d`, the web image never ahead of the backend, and no save on `/admin/points` before the new web image serves. |
| W11 | Resolved | `architecture.md` step 3a: a `LedgerInvariantError` log grep, the open-holds SQL (count, sum, oldest, >30 days) and the reconciliation SQL (HELD = open holds, BURN = SALE, no negative PARTY or HELD account). |
| I1 | Resolved | `ChooseContextSheet.tsx:22` POINTS: „Dalej: zablokuj punkty”. |
| I2 | Resolved | `tests/conftest.py:91-100` `PgError` / `pg_error`. No per-file `_PgError` left. |
| I3 | Resolved | The `_points_price` docstring (`term_item_listings.py:183-189`) describes the checks, with no spec ID. |
| I4 | Resolved | `points/infrastructure/ledger.py:346` `hold_credits_select`, shared by `hold_amounts` (`:374`) and `purchases.py:263`. |
| I5 | Resolved | `transaction_action_flags` (`term_item_listings.py:1057-1081`) takes `principal`. `can_confirm` is false for POINTS without `PERMISSION_EDIT`, the same `_is_login_principal` as `require_login_principal` (`:768-777`). The one caller, `item_actions.py:271`, passes it. |
| I6 | Left as known | A product re-point of a POINTS listing still skips the photo rule. This is consistent with the W7 policy that an existing POINTS listing is not re-checked. |
| I7 | Resolved | `PointsPriceStepper.tsx:27,91-93`: `role="alert"` only after an edit. |
| I8 | Resolved | `TypeGuard` `_is_points`; the redundant `None` check is gone; the hint is extracted into `pointsBlockedHint`. |
| I9 | Left as known | `term_item_listings.py` is still large; split it in a follow-up. |
| Lint fix | Resolved | `AppDataContext.tsx:160-165`: the `organizationSlug` effect now sits below `useState(groupForm)`. Its behaviour is unchanged, since effect order does not matter here. ESLint on the touched files: 0 errors. |

## New issues

### Informational
- **N1 — the lock-order claim rests on the callers.** `inventory/application/reservation_transitions.py:77-83,188-219`. `_release` says that every caller that can meet a POINTS reservation has locked it, but `cancel_reservation` / `confirm_reservation` load the row with `get_reservation` (no lock). Their only callers today are SWAP legs (`term_item_listings.py:990,1145,1177,1220`), so no POINTS release goes through them. Suggestion: call `lock_reservations` in `cancel_reservation` too, or narrow the docstring to "cancel_exchange and cancel_reservations_without_commit". Fixable: true.
- **N2 — a locked /add form cannot add a photo.** `ItemCreateView.tsx:155`. If the POINTS PUT fails because every photo was refused („Dodaj przynajmniej jedno zdjęcie…”), the photo field is locked (`disabled={busy || locked}`). The user can still retry as GIFT/SWAP or save a draft and add a photo on the item page, but the message does not say so. Suggestion: on that error, point to the item page or the draft action. Fixable: false (UX choice).
- **N3 — a stale `itemCreated` has no explicit reset.** `AppDataContext.tsx:183`. It is cleared only by a successful submit, which may be a draft save. If the kept item is deleted elsewhere (from My Items), a retry PUT returns 404 and the form stays locked until the user picks "save as draft". That save navigates to the deleted item and then clears the state. This is a rare edge; there is an escape, but it is clumsy. Fixable: true (clear it on a 404 from the PUT).

## Metrics
- Lock-taking settle paths checked: 5 (confirm, cancel, `delete_event`, take, PUT preference) plus `clamp_points_price` and the attendance close. Cycles: 0.
- Potential vulnerabilities: 0. N+1 risks: 0 new.

## Prioritized Recommendations
1. N1: make `cancel_reservation` lock its row, or narrow the `_release` docstring.
2. N3: clear `itemCreated` when the retry PUT answers 404.
3. N2: copy only, an optional hint after a photo-rule failure on a locked form.
