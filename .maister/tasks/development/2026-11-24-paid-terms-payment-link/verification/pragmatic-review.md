# Pragmatic Review (re-verification cycle 1): Paid terms (price, payment link, manual payment status)

## TL;DR
- Status: **Appropriate**. Findings: 0 Critical, 0 High, 0 Medium, 1 Low (L3, an intentional choice). Cycle-1 additions: 1 Info.
- L1, L2 and L4 are resolved. None of the fixes adds over-engineering. The shared `Switch` is about 25 lines with no new abstraction, `term_payments.py` shrank to 24 lines of pure rules, and the function-local imports and cycle workaround are gone.
- The new additions are proportionate: the 2 `https` CHECKs, 1 audit log line, and 2 calls to the existing `set_personalised_cache_headers` helper.
- No changes are required before merge.

## Key Decisions
- The project-scale judgment is unchanged: early production, so balanced complexity is appropriate.
- I accept the 2 extra `ck_*_payment_url_https` CHECKs as a cheap backstop for money-adjacent data. They are one-line predicates, follow the existing `_CHECKS` tuple pattern, and are covered in `test_paid_terms_migration.py`.
- I accept the new `logger.info` in `set_payment_status` (an audit trail for payment marks) even though `set_presence` does not log. It is one statement, fires only on a real change, and logs IDs only, with no personal data.

## Open Questions / Risks
- L3 is still open by design. `payment_method` is serialized in the response shapes, and the client only declares its type and never reads it. It is acceptable as wire-shape groundwork for PLATFORM.

---

## Re-check (cycle 1)

| ID | Previous finding | Status | Evidence |
|---|---|---|---|
| L1 | The payment switch duplicated `ToggleRow`'s markup | **Resolved** | `components/shared/appComponents.tsx:47-75` exports `Switch({checked,label,onChange,disabled?})`. `ToggleRow` (line 41) and `TermAttendeeRow` (`TermAttendeesPage.tsx:410`) both use it. Only one set of switch classes remains. |
| L2 | `PaymentUrlField` hardcoded the URL-length literal `500` | **Resolved** | `appHelpers.ts:135` exports `MAX_PAYMENT_URL_LENGTH`. It is used by `parsePaymentUrl` (line 181) and by `PaymentUrlField` (`appComponents.tsx:304`). There is no literal left. |
| L3 | `payment_method` is exposed in responses but not read by the client | **Residual (accepted, intentional)** | Unchanged, as decided. It is Low and optional. |
| L4 | `set_payment_status` used function-local imports to break a cycle | **Resolved** | `set_payment_status` now lives in `attendance_points.py:149`, next to `set_presence`, and uses its module-level `_require_active_organizer` and `_require_term_in_group` imports. `term_payments.py` is 24 lines of pure rules that import only `PaymentMethod`. The router calls `attendance_points.set_payment_status` (`router/circles.py:260`). |

### Did the fixes add over-engineering?

| Change | Assessment |
|---|---|
| Shared `Switch` | **No.** It is a plain presentational component with 4 props and one optional `disabled`. It has no variants, sizes or context, and has 2 real callers. It also picks up a focus ring and disabled styling for `ToggleRow` at no cost. |
| 2 extra `https` CHECKs (9 in total) | **No.** The total went from 7 to 9 CHECKs. Each is a one-line predicate in the existing `_CHECKS` tuple, backing the schema validator in `schemas.py:150`. The comment at the top of the migration documents them. This is proportionate for a link that users will pay through. |
| `logger.info` on a payment-status change | **No.** It is one statement, guarded by `changed`, and logs IDs only. A slight inconsistency remains because `set_presence` does not log, but an audit line for money marks is a fair exception (Info, below). |
| Cache headers on the attendee list and `mine/attendances` | **No.** Each endpoint makes one call to the existing `core/cache_headers.set_personalised_cache_headers`, which 22 call sites already use. A test asserts the header (`test_term_attendees.py:76`). Both endpoints require a principal, so the result is always `private, no-store`, plus a harmless `Vary`. |

### New finding (Info, no action needed)
- **I1.** `set_payment_status` logs and `set_presence` does not (`attendance_points.py:186`). Leave it as is. Only if the team wants strict symmetry, either drop the log or add one to `set_presence`. Effort is about 2 minutes, and the value is negligible.

## Brief re-assessment of the whole feature
- **Data model:** 3 columns on `groups`, 3 on `terms`, 2 on `term_attendances`, and 9 named CHECKs. There is no payments table, which the spec defers until a gateway exists. Proportionate.
- **Backend:** the pure rules sit in `term_payments.py` and the organizer toggle sits with the other organizer toggles. There is one shared listed-row predicate (`listed_attendance_condition` plus `is_counted`). There is no new infrastructure, SDK, queue or webhook.
- **Frontend:** `PriceField` and `PaymentUrlField` share a private `DescribedTextField`. There is a payment variant of `SignUpFooter`, and the shared `Switch`. Parse helpers sit next to `parseCapacity`. The pattern is consistent with `CapacityField` and `ToggleRow`.
- **Validation:** the client and the server have mirrored validators, which is required because the client blocks submit and the server is authoritative. The length limit is now a single constant on each side.
- **Context consistency:** I found no dead code. `term_payments.py` has 2 importers (`circles.py`, `terms.py`). The removed helpers have no callers left. Every new helper has a production caller.
- **Requirements alignment:** the implementation matches the spec, with no extra features. The only forward-looking piece is PLATFORM plus `payment_method`, which the user requested.

## Recommended Simplifications
None required. L3 is the only optional cleanup: remove `payment_method` from response schemas until a PLATFORM client needs it. It is low value and the team has decided to keep it.

## Summary Statistics

| Metric | Cycle 0 | Cycle 1 |
|---|---|---|
| `term_payments.py` lines | 78 | 24 (pure rules only) |
| Switch implementations | 2 | 1 |
| Hardcoded URL-length literals (frontend) | 1 | 0 |
| Function-local imports / cycle workaround | 2 / yes | 0 / no |
| Named CHECK constraints | 7 | 9 (+2 `https` backstops) |
| New infrastructure or dependencies | 0 | 0 |
| Findings: Critical / High / Medium / Low | 0 / 0 / 0 / 4 | 0 / 0 / 0 / 1 (L3, intentional), plus 1 Info |

## Conclusion
The fixes are minimal and well placed, and none of them adds unneeded complexity. They reduced net code, removed a workaround, and put the two organizer toggles in one place. The feature is still appropriately scaled. No action is required.
