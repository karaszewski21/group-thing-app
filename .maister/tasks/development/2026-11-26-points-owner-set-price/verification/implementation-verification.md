# Implementation Verification: POINTS mode (stage 2, part 1)

## TL;DR
**✅ Passed, after one fix and re-verification cycle plus a minor-fix pass.**
- All 11 original warnings are resolved and 8 of the 9 info items are fixed (I6 and I9 were deferred by decision).
- The cycle-2 pass resolved the INDEX.md warning and the fixable residuals. Remaining: 0 critical, 0 warning, plus N2, I6, I9 and M4 (deferred) and one observed test flake.
- Full suites are at baseline, with backend 1897 passed. Production readiness is GO (95%).
- Code review and the reality check both say clean / ready.

## Open Questions / Risks
- `test_confirmAndCancelPoints_parallel_settleOrReleaseNeverBoth` failed once in a combined run after cycle 2, then passed 12/12. The failing assertion was not captured. If it was the SALE+RELEASE count rather than the status codes, that would be a ledger defect, so watch this test in CI.
Product decisions to settle before the follow-up task (SALE_REFUND, the reminder):
- A buyer can cancel after receiving the item and get the points back.
- A seller has no remedy when the buyer never confirms. Held points can stay locked indefinitely; this was accepted earlier and is now visible through the runbook step 3a queries.
- An owner can switch a reserved POINTS item to GIFT or delist it. This is accepted: settlement uses the HOLD amount.
- Who runs runbook step 3a (monitoring) each week?

## Executive Summary
POINTS offers are fully implemented: migration 0109, the ledger with HOLD, a 4-entry SALE and RELEASE, owner pricing, listing, take/confirm/cancel, the read models and all 8 screens. The first verification found 11 warnings, all fixed in one cycle. Re-verification confirms the fixes, including a real lock-order change: every settling path now locks the reservation, then the accounts, then the item, then the preference. Only small documentation and UX residuals remain.

## Implementation Plan Verification
126/126 checkboxes (100%). Spot checks in completeness-report.md and completeness-reverify.md found no issues.

## Test Suite Results (after fixes, verification/test-suite-results.md)
| Suite | Result | Baseline |
|---|---|---|
| Backend pytest | 1897 passed / 2 failed (known stale tests: owner_items nearest-term, 0053 round trip) | 2 |
| Backend mypy / ruff | 15 / 64 | 15 / 64 |
| Matcher pytest / mypy / ruff | 125 passed / 0 / clean | green |
| Vitest | 2190 passed / 32 failed (same files) | 32 |
| Typecheck | 0 | 0 |
| Lint | 10 errors / 29 warnings | 10 / 28 |

The extra lint warning comes from the `setGroupForm` effect, which was moved below its `useState` to fix a new `react-hooks/immutability` error. Its warning is `set-state-in-effect`, the same as the three neighbouring effects in that file.

## Standards Compliance
Compliant. The previous gaps are resolved: duplicated helpers, the settlement prefix, the spec ID in a docstring, and the `_PgError` duplication.

## Documentation Completeness
Complete, with one residual. architecture.md (lock order, the 0109 runbook with step 2 deploy-together and step 3a monitoring), the ledger.py docstring and security.md all match the code. **Residual:** INDEX.md still describes the lock order as "accounts → item → preference".

## Optional Reviews
| Review | First run | After fixes |
|---|---|---|
| Code review | 0 critical / 4 warning / 8 info | **clean**: 0 warning / 3 new info |
| Pragmatic | 0 high / 4 medium / 7 low | **appropriate**: residual L2/L3/L6 nits, M4 deferred |
| Production readiness | GO with mitigations, 89% | **GO**, 95%, 5 optional recommendations |
| Reality check | issues found, 6 gaps | **ready**: 5/6 resolved, G4 partial (Low) |
| Completeness | 3 warning / 6 info | 1 warning / 2 info |

## Fix & Re-Verification History
| ID | Issue | Fix applied | Re-check |
|---|---|---|---|
| W1 | duplicated price helpers | domain `is_valid_price`/`clamp_price` exported via service → points_acl; the frontend has a shared `clampPointsPrice` | resolved (parity rows in appHelpers.test) |
| W2 | `clamp_price` ignored the step | snaps to the step, then clamps | resolved (`test_clampPrice_offStep…`) |
| W3 | settlement did not refresh points | `useReservationSettlement` invalidates `[POINTS_KEY]` on confirm/cancel | **partial**: MyItemsView and PendingActionsHost use their own paths (G4, Low, harmless with staleTime 0) |
| W4 | My Items price chip appeared only after a reload | `setItemMode` stores `points_price` | resolved (AppDataContextItemMode.test) |
| W5 | /add could create a duplicate after a remount | `itemCreated` kept in AppDataContext; LocationPicker disabled | resolved (remount test) |
| W6 | default price invalid under a custom config | default clamped and step-aligned | resolved |
| W7 | photo check ran on every POINTS PUT | photo rule and cap only when the item becomes POINTS | resolved (`test_putPreference_existingPointsAfterPhotoRejected…`) |
| W8 | delete_event ↔ cancel deadlock cycle | `lock_reservations` before the accounts in cancel and confirm | resolved (order test; parallel tests green) |
| W9 | `lock_owner_accounts` without an eligibility check | documented as a mutex only | resolved |
| W10 | version skew breaks the config save | runbook step 2: deploy together, don't save before web is up | resolved (R2: add "reload the tab") |
| W11 | no monitoring of holds | runbook step 3a: log grep, open-holds and reconciliation SQL | resolved (SQL checked against 0103/0109) |
| I1 | ChooseContextSheet label | „Dalej: zablokuj punkty” | resolved |
| I2 | `_PgError` in 4 files | `tests/conftest.py` pg_error/deadlock | resolved |
| I3 | spec ID in a docstring | rewritten | resolved |
| I4 | duplicated hold query | `hold_credits_select` | resolved |
| I5 | `can_confirm` ignored the login rule | now honours `_is_login_principal` | resolved |
| I7 | stepper alert on mount | alert only after an edit | resolved |
| I8 | style nits | renames, enum, TypeGuard, flat hint | resolved (the L3 string kept for the module boundary) |
| new lint error | AppDataContext effect before its `useState` | effect moved | resolved (10 errors) |
| I6, I9 | product re-point skips the photo rule; file size | deferred by decision | open |

## Remaining Issues
| Severity | Item | Location | Fixable |
|---|---|---|---|
| warning | INDEX.md lock-order phrase is out of date | `.maister/docs/INDEX.md` points paragraph | yes |
| info | G4: MyItemsView and PendingActionsHost confirm/cancel do not invalidate `[POINTS_KEY]` | `MyItemsView.tsx:279-307`, `PendingActionsHost.tsx:108-111` | yes |
| info | N1: the `_release` docstring claims every caller has locked the reservation (true only for SWAP callers) | `reservation_transitions.py` | yes |
| info | N2: a failed PUT because all photos were rejected gives no hint about the way out | `ItemCreateView.tsx` | UX choice |
| info | N3: `itemCreated` is not cleared when the retry PUT returns 404 | `ItemCreateView.tsx` | yes |
| info | `useCreateItem` returns a `createdItemId` nobody reads | `useCreateItem.ts` | yes |
| info | `_take` / `set_item_listing_preference` docstrings carry the old lock-order wording | `term_item_listings.py` | yes |
| info | `awards.py:1-2` cites „spec R2/R6” | `points/application/awards.py` | yes |
| info | runbook R1 (write out the 30-day query), R2 (reload /admin/points), R3 (logs reset on recreate), R5 (delisting wording); step 2 repeats `up -d` | architecture.md | yes |
| info | I6, I9, M4 split of term_item_listings.py | — | follow-up |

## Cycle 2 (minor fixes, no re-verification)
| Item | Fix | Evidence |
|---|---|---|
| INDEX.md lock order | phrase updated to reservation → accounts → items → preference | grep |
| G4 | MyItemsView and PendingActionsHost invalidate `[POINTS_KEY]` | new MyItemsView test; PendingActionsHost test updated |
| N1 | `_release` docstring narrowed | review of the callers |
| N3 | `itemCreated` cleared on a 404 retry | new ItemCreateView test |
| unused `createdItemId` | removed | typecheck 0 |
| docstring drift, awards.py comment | rewritten | — |
| runbook R1/R2/R3/R5 | 30-day query, reload note, logs note, delisting wording | — |

After cycle 2: backend targeted 44/44 (×3) plus the race test 6/6 standalone; frontend 99 passed / 1 baseline; typecheck 0; lint 10 errors.

## Recommendations
1. Optional quick pass (about 45 min): INDEX.md phrase, G4, N1, N3, unused `createdItemId`, docstring drift, awards.py comment, runbook R1/R2/R3/R5.
2. Follow-up task: SALE_REFUND / condition correction / 3-correction block, the 30-day reminder, the open product questions above, auto-release of held points, the term_item_listings split.

## Verification Checklist
- [x] Completeness, code review, pragmatic, production, reality (first run + re-verification)
- [x] Full test suite after fixes
- [x] All reports on disk: completeness-report, code-review-report, pragmatic-review, production-readiness-report, reality-check, test-suite-results, plus the *-reverify side files
- [ ] Visual fidelity: pending Phase 12 (E2E)
