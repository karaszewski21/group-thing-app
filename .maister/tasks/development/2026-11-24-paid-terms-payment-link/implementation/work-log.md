# Work Log

## 2026-11-24T10:28:00Z - Implementation Started

**Total Steps**: 68
**Task Groups**: 1 DB migration 0106; 2 Matrix row 71; 3 Backend pricing; 4 Backend payment status; 5 RSVP reactivation fix; 6 Frontend types/helpers/fields; 7 Frontend forms; 8 Frontend term page; 9 Frontend organizer list; 10 Docs; 11 Test review
**Waves (planned)**: W1 {1,2,6} W2 {3,7,8,9} W3 {4} W4 {5} W5 {10} W6 {11}
**Note**: plan path `src/backend/app/groups/repository.py` = actual `src/backend/app/groups/infrastructure/repository.py`.

## Standards Reading Log

### Loaded Per Group
| Group | From plan | From INDEX.md | Discovered |
|---|---|---|---|
| 1 DB migration | backend/models.md, backend/migrations.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md | backend/time.md | — |
| 2 Matrix row 71 | backend/security.md, testing/backend-testing.md, global/commenting.md | — | — |
| 3 Backend pricing | backend/models.md, global/validation.md, global/error-handling.md, global/minimal-implementation.md, backend/api.md, testing/backend-testing.md | backend/time.md, backend/security.md | — |
| 4 Payment status | backend/api.md, backend/security.md, backend/queries.md, backend/time.md, backend/models.md, global/error-handling.md, global/minimal-implementation.md, testing/backend-testing.md | global/validation.md | — |
| 5 RSVP fix | global/minimal-implementation.md, backend/time.md, backend/queries.md, testing/backend-testing.md | — | — |
| 6 FE types/helpers | global/validation.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md | global/commenting.md, global/minimal-implementation.md | ESLint no-irregular-whitespace / no-control-regex |
| 7 FE forms | global/validation.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, testing/frontend-testing.md | frontend/data-fetching.md | — |
| 8 FE term page | frontend/components.md, frontend/accessibility.md, frontend/css.md, testing/frontend-testing.md | frontend/data-fetching.md, global/minimal-implementation.md | — |
| 9 FE organizer list | frontend/data-fetching.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, testing/frontend-testing.md | global/error-handling.md | — |
| 10 Docs | global/conventions.md, global/commenting.md | — | 0103–0105 runbook style |
| 11 Test review | testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md | — | themeTokenUsage project rule |

## 2026-11-24 - Group 2 Complete (wave 1)

**Steps**: 2.1 through 2.3 completed
**Standards Applied**:
- From plan: backend/security.md, testing/backend-testing.md, global/commenting.md
**Tests**: tests/test_authorization_matrix.py — 107 passed; ruff + mypy clean
**Files Modified**: src/backend/app/core/authorization_matrix.py (row 71), src/backend/tests/test_authorization_matrix.py (+2 tests)
**Notes**: Group 4 route must use Depends(require_any("EDIT", "mcp:edit")). HTML markers carry an extra " card" class; verify with 'class="group done'.

## 2026-11-24 - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.5 completed
**Standards Applied**:
- From plan: backend/models.md, backend/migrations.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: backend/time.md (paid_marked_at naive UTC)
**Tests**: tests/test_paid_terms_migration.py + tests/test_points_migration.py — 6 passed; ruff, format, mypy clean
**Files Modified**: src/backend/alembic/versions/0106_paid_terms.py (new), src/backend/app/groups/models.py (PaymentMethod, PaymentStatus, 8 columns, 7 CHECKs), src/backend/tests/test_paid_terms_migration.py (new)
**Notes**: exact key-set tests may be affected by later schema exposure — full suite in group 11.

## 2026-11-24 - Group 6 Complete (wave 1)

**Steps**: 6.1 through 6.7 completed
**Standards Applied**:
- From plan: global/validation.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md
- From INDEX.md: global/commenting.md, global/minimal-implementation.md
- Discovered: ESLint no-irregular-whitespace / no-control-regex (NBSP escapes)
**Tests**: paymentHelpers, PaymentFields, termViewState — 37 passed; 0 tsc errors under src/
**Files Modified**: api/groups.ts, api/terms.ts, utils/appHelpers.ts, components/shared/appComponents.tsx, features/panel/AppDataContext.tsx, features/meetings/meetingsList.ts, 2 new tests, 13 fixture test files (+DeleteGroupDialog.test.tsx flagged by tsc)
**Notes**:
- PRE-EXISTING: `npm run typecheck` fails with 94 errors in stale `src/frontend/.next/types/validator.ts` (Nov 15 artifact for removed `(site)` route group). Filter tsc output to `src/`.
- PRE-EXISTING: 13 failures in AppPage.test.tsx (12) + TermPage.test.tsx (1) reproduce at HEAD (missing "Prowadzę", "+ Dodaj termin", "Miejsce" UI).
- PRE-EXISTING: `npm run lint` 10 errors in unrelated plugin tests.

## Wave 1 resolved — groups 1, 2, 6 complete

## 2026-11-24 - Group 9 Complete (wave 2)

**Steps**: 9.1 through 9.5 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, testing/frontend-testing.md
- From INDEX.md: global/error-handling.md
**Tests**: TermAttendeesPage.test.tsx + attendanceViewState.test.ts — 35 passed (6 new); eslint clean
**Files Modified**: hooks/useTermAttendance.ts, features/meetings/TermAttendeesPage.tsx, test/TermAttendeesPage.test.tsx
**Notes**: price in subtitle; counted-only counts + " · opłaceni: N" on priced terms; withdrawn PAID refund pill/note; switch role=switch. Mockup 0.92 row opacity not reproduced (not in acceptance). tsc flagged sibling-in-progress errors in TermNeededItems.tsx:101 (not in any group's file list — check after group 8) and FirstTermStepperOrganizer.test.tsx:70 (group 7).

## 2026-11-24 - Group 8 Complete (wave 2)

**Steps**: 8.1 through 8.8 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/css.md, testing/frontend-testing.md
- From INDEX.md: frontend/data-fetching.md, global/minimal-implementation.md
**Tests**: TermPagePayment (6/6), SignUpFooter (4/4), termViewState (15/15), TermPage (1 pre-existing "Miejsce" failure) — 88 passed, 1 pre-existing failure; tsc src/ 0 errors; eslint clean
**Files Modified**: TermCard.tsx, TermInfo.tsx, RsvpDialogLoggedIn.tsx, TermSignUp.tsx, SignUpFooter.tsx, termViewState.ts, TermCards.tsx, test/TermPagePayment.test.tsx (new), SignUpFooter.test.tsx, termViewState.test.ts
**Notes**:
- FOLLOW-UP (assign to group 11): features/terms/blocks/TermNeededItems.tsx:101 opens RsvpDialogLoggedIn without price/paymentUrl → no cost line on the pledge sign-up path. Dialog props made optional; pass `price={term.price} paymentUrl={term.payment_url}` and consider making them required again.
- Visual deviation: "Opłacone" text uses text-ink (mockup #12604d has no token; contrast).

## 2026-11-24 - Group 7 Complete (wave 2) — reported PARTIAL, all steps done

**Steps**: 7.1 through 7.7 completed
**Standards Applied**:
- From plan: global/validation.md, frontend/components.md, frontend/accessibility.md, frontend/css.md, testing/frontend-testing.md
- From INDEX.md: frontend/data-fetching.md
**Tests**: PaymentForms, TermEditForm, FirstTermStepperOrganizer, GroupFormDescription, AddTermViewAttendancePoints — 51 passed
**Files Modified**: GroupFormFields.tsx, GroupCreateView.tsx, GroupEditView.tsx, AppDataContext.tsx, AppModals.tsx, termDraft.ts, AddTermView.tsx, FirstTermStepperOrganizer.tsx, TermEditForm.tsx, test/PaymentForms.test.tsx (new), TermEditForm.test.tsx, FirstTermStepperOrganizer.test.tsx
**Notes**:
- FOLLOW-UP (assign to group 11): AppPage.test.tsx:582-588 expected createAdditionalMyCircle args need `default_price: null, default_payment_url: null` (2 new failures from intended behaviour; brings AppPage back to 12 pre-existing failures).
- Visual deviation: prefill hint "Cena i link podpowiedziane z ustawień kręgu…" shown as price-field hint, not under sheet title (TERM_PAYMENT_PREFILL_HINT in termDraft.ts).
- Capacity label kept "Ile miejsc (opcjonalnie)".

## 2026-11-24 - Group 3 Complete (wave 2)

**Steps**: 3.1 through 3.9 completed
**Standards Applied**:
- From plan: backend/models.md, global/validation.md, global/error-handling.md, global/minimal-implementation.md, backend/api.md, testing/backend-testing.md
- From INDEX.md: backend/time.md, backend/security.md
**Tests**: test_term_pricing.py (8 new) + 8 touched/related files — 120 passed; ruff/mypy clean on new code (pre-existing E501 in circles.py, 8 pre-existing mypy errors in untouched app/groups files)
**Files Modified**: schemas.py, application/term_payments.py (new), application/circles.py, application/terms.py, router/circles.py, application/public_view.py, tests/test_term_pricing.py (new), test_group_access.py, test_public_term.py, test_my_terms.py
**Notes**: URL-requires-price 400 arrives in `message` (fieldErrors null). MyAttendanceResponse left to group 4 (step 4.2).

## Wave 2 resolved — groups 3, 7, 8, 9 complete

## 2026-11-24 - Group 4 Complete (wave 3)

**Steps**: 4.1 through 4.9 completed
**Standards Applied**:
- From plan: backend/api.md, backend/security.md, backend/queries.md, backend/time.md, backend/models.md, global/error-handling.md, global/minimal-implementation.md, testing/backend-testing.md
- From INDEX.md: global/validation.md
**Tests**: test_term_payments.py (6 new) + 10 related files — 184 passed; no new ruff/mypy findings
**Files Modified**: schemas.py, infrastructure/repository.py, application/memberships.py (removed _attendances_active_at), application/term_payments.py (set_payment_status), application/public_view.py, router/circles.py (PUT …/payment), tests/test_term_payments.py (new), test_term_attendees.py, test_my_attendances.py, test_group_access.py
**Notes**: function-local imports in set_payment_status to avoid circular import (circles/terms import term_payments). `paid` uses lax bool like PresenceRequest.

## Wave 3 resolved — group 4 complete

## 2026-11-24 - Group 5 Complete (wave 4)

**Steps**: 5.1 through 5.5 completed
**Standards Applied**:
- From plan: global/minimal-implementation.md, backend/time.md, backend/queries.md, testing/backend-testing.md
**Tests**: test_rsvp_reactivation.py 4/4 (2 former red tests now green, unchanged) + 7 related files — 67 passed; ruff clean; no mypy findings on changed lines
**Files Modified**: application/public_view.py (create_rsvp reactivation, guardians active-only, list_attendances_for_term removed), infrastructure/repository.py (list_attendances_for_term removed), tests/test_rsvp_reactivation.py (+2 tests), tests/test_group_access.py (withdrawn test renamed → notAttendingNorActiveAttendee)
**Notes**: re-RSVP racing a concurrent close not handled (out of scope).

## Wave 4 resolved — group 5 complete

## 2026-11-24 - Group 10 Complete (wave 5)

**Steps**: 10.1 through 10.5 completed
**Standards Applied**:
- From plan: global/conventions.md, global/commenting.md; 0103–0105 runbook style
**Tests**: grep checks pass (0106 ×6, row 71 ×2, downgrade 0105 ×2, models.md money entry L147, INDEX money clause); secret-pattern grep 0 hits
**Files Modified**: .maister/docs/project/architecture.md (Paid terms section + 0106 runbook, close-algorithm and matrix bullets), .maister/docs/standards/backend/models.md (money entry), .maister/docs/INDEX.md
**Notes**: runbook line "deploy web together with backend, never ahead" is an inference.

## Wave 5 resolved — group 10 complete

## 2026-11-24T11:31:40Z - Group 11 Complete (wave 6)

**Steps**: 11.1 through 11.5 completed + 2 assigned follow-ups
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md; project rule themeTokenUsage (discovered)
**Tests**: 6 gap tests added (2 backend, 4 frontend). Feature tests: backend 129 passed (test_rsvp_reactivation 4/4); frontend 138 passed.
**Files Modified**: TermNeededItems.tsx, RsvpDialogLoggedIn.tsx (props required again), SignUpFooter.tsx (regression fix: mint → primary role tokens), AppPage.test.tsx, PaymentForms/TermPagePayment/TermAttendeesPage tests, test_term_pricing.py, test_term_payments.py; regenerated git-ignored .next/types via `npx next typegen`
**Notes**: REGRESSION FOUND AND FIXED: themeTokenUsage test failed on SignUpFooter mint classes (group 8).

## 2026-11-24T11:31:40Z - Implementation Complete

**Total Steps**: 68 completed (11 groups, 6 waves)
**Test Suite**: full suites run — NOT fully green, all remaining failures pre-existing:
- Backend pytest: 1700 passed, 2 failed (pre-existing by code inspection: test_migration0053 round trip index name; test_owner_items_page location_name) — HEAD run not possible without copying .env
- mypy app: 15 errors, all pre-existing; ruff check: 64 pre-existing; ruff format: 49 files, diffs only on untouched lines
- Frontend typecheck: 0 errors (after regenerating stale .next types); lint: 10 pre-existing errors; vitest: 2002 passed, 32 failed — all 32 reproduce on HEAD export (AppPage 12, EventPage 7, PublicLayout 2, routeManifest 2, extension-points 2, reservedSlugs 1, foundation 1, ItemDetailPage 1, OrganizerItemRoute 1, ParticipantItemsPreview 1, PendingActionsHost 1, TermPage 1)

## 2026-11-24 - Verification fix cycle 1

**Source**: `verification/implementation-verification.md` cycle 0 (issues #1–#19), re-verified in cycle 1.
**Fixes** (14 items):
1. #1 href without client re-check / no DB https CHECK: `SignUpFooter` renders the `<a>` only when `parsePaymentUrl` returns a string; `ck_terms_payment_url_https` and `ck_groups_default_payment_url_https` added to 0106 + models (9 CHECKs).
2. #2 client parser looser than server: literal `^https://` (any case), `[\s\p{C}]` rejected, host required.
3. #3 version skew "NaN zł": `!= null` / `== null` in TermCard, TermSignUp, TermCards, RsvpDialogLoggedIn, FirstTermStepperOrganizer, SignUpFooter.
4. #4 runbook: backend-up check (`docker compose ps backend`, `alembic current` = `0106 (head)`).
5. #5 INFO log on an actual payment status change (ids + status only), caplog test.
6. #8 "Opłacone" style unified: `bg-primary-soft text-primary-fg` on both screens (recorded as D5 in cycle 2).
7. #9 prefill hint moved under the page/sheet title, shown only with circle defaults.
8. #10 work-log standards table filled.
9. #11 userinfo URLs rejected (server `@` in netloc, client username/password).
10. #12 "Zapłać" after term end: kept (user decision).
11. #13 shared `Switch` component replaces the duplicated ToggleRow switch.
12. #14 hardcoded 500 replaced by `MAX_PAYMENT_URL_LENGTH`.
13. #15 `set_payment_status` moved to `attendance_points.py`; `term_payments.py` 78 → 24 lines, no function-local imports.
14. #19 `private, no-store` (`set_personalised_cache_headers`) on the attendee list and `/mine/attendances`, tested.
**Extra**: uppercase `HTTPS://` hit the DB CHECK (500) — CHECKs switched to `ILIKE`, link stored as typed, test added.
**Result**: cycle 1 re-verification — no critical issues, no regressions; remaining R1–R14.

## 2026-11-24T13:34:24Z - Verification fix cycle 2

**Source**: cycle 1 remaining issues R1–R4, R7, R8, R10, R12.
**Changes**:
- R1: `architecture.md` (0106 CHECK list) and `INDEX.md` say `ILIKE 'https://%'` (case-insensitive, stored as typed).
- R2/R3: `spec.md` + `spec.html` gain "Post-verification changes (cycle 1)", deviation D5 ("Opłacone" in primary-soft, themeTokenUsage, 4.54:1), nine CHECKs in the table, stale statements (7 CHECKs, set_payment_status module, mint-soft) updated, rev 3 in the history.
- R4: this entry and the cycle 1 entry above.
- R7: client `parsePaymentUrl` rejects `@` in the raw authority and any backslash; server `_normalize_payment_url` rejects a backslash and an invalid port. Tests: `paymentHelpers.test.ts` (`https://@x.pl`, `https://:@x.pl`, `https://x.pl\@evil.tld`, `https://x.pl\pay`, @ after the host accepted), `test_term_pricing.py` (`:99999`, `:abc`, two backslash cases).
- R8: `set_payment_status` compares with `!=`.
- R10: 0106 docstring notes the https CHECK is case-insensitive (`ILIKE`).
- R12: `TermPagePayment.test.tsx` pins that a term/card without the price/payment fields (older backend) renders as free — no NaN, no link; fixture built without casts (`Reflect.deleteProperty` helper).
**Tests**: backend test_term_pricing/test_term_payments/test_paid_terms_migration 21 passed; ruff clean; frontend 5 payment test files 61 passed; typecheck 0 errors; eslint clean on touched files.
