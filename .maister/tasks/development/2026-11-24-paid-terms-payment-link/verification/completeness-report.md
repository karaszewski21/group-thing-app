# Completeness Report: Paid terms (price, payment link, manual payment status)

## TL;DR
- **Re-check (cycle 1): passed_with_issues.** 0 critical, 4 warnings, 3 info. All three cycle-0 warnings are fixed, and all 14 listed fixes are in the code.
- The plan is still 79 `[x]` and 0 `[ ]`. The work-log Standards Reading Log is now filled in.
- The fixes introduced docs drift. architecture.md says the https CHECK is `LIKE 'https://%'`, but the code uses `ILIKE`, and no doc mentions that the CHECK is case-insensitive.
- spec.md was not updated for the fixes. It still lists 7 CHECKs, puts `set_payment_status` in `term_payments.py`, calls "Opłacone" mint-soft, and has no userinfo, INFO-log or no-store rules.
- The work-log has no entry for the verification fix cycle.

## Key Decisions
- Spec drift counts as a warning, not critical. The code and architecture.md agree, and architecture.md is the living reference. spec.md is the record of what was agreed, so it should be updated or given a "post-verification changes" addendum.
- Moving `set_payment_status` to `attendance_points.py` is accepted as a deviation that improves on the spec. It removes local imports, and architecture.md L524 already documents the move.

## Open Questions / Risks
- A small client/server mismatch remains for `https://@host` (empty userinfo). The server rejects it (`"@" in parts.netloc`, `schemas.py:152`). The client accepts it, because `url.username` is `""` (`appHelpers.ts:191`). The user sees a server 400 instead of an inline error. This is cosmetic.

---

## Re-check (cycle 1)

### Fix verification

| # | Fix | In place? | Evidence |
|---|---|---|---|
| 1 | https CHECKs (ILIKE) in 0106 + client href re-check | Yes | `alembic/versions/0106_paid_terms.py:51-53,67-69` (`ILIKE 'https://%'`), mirrored in `app/groups/models.py:145,300`. `tests/test_paid_terms_migration.py:26-37` holds the 9 names, with violation asserts at L94/L100. `SignUpFooter.tsx:91` re-checks with `parsePaymentUrl` before the href, and an invalid link falls back to "na miejscu". |
| 2 | Client `parsePaymentUrl` matches server | Yes (one edge case) | `utils/appHelpers.ts:178-193`: `/^https:\/\//i` prefix, `\p{C}`/`\s` rejection, host check, username/password check. The server uses `char.isspace() or not char.isprintable()` (`schemas.py:145`). Edge case: `https://@host` (see Open Questions). |
| 3 | `!= null` checks | Yes | `TermCard.tsx:55,57,62,84`, `TermCards.tsx:222`, `TermAttendeesPage.tsx:91,131`, `RsvpDialogLoggedIn.tsx:92`, `TermSignUp.tsx:25`, `SignUpFooter.tsx:82` all use loose `!= null`/`== null`. |
| 4 | Runbook: backend running + `alembic current` = 0106 | Yes | `architecture.md` runbook step 2 (L930): `docker compose ps backend`, `alembic current` prints `0106 (head)`, and the lock-timeout retry guidance. |
| 5 | INFO log on payment status change | Yes | `attendance_points.py:185-192` logs on an actual change only, with ids only. Tested in `tests/test_term_payments.py:124-145` (caplog). Documented in architecture.md L524. |
| 8 | Unified "Opłacone" style | Yes | `SignUpFooter.tsx:84` and `TermCards.tsx:216` both use `bg-primary-soft text-primary-fg`. |
| 9 | Prefill hint under the title, only with circle defaults | Yes | `AddTermView.tsx:52,78` (`prefilledPayment` = default price or URL `!= null`, rendered above the form card). `FirstTermStepperOrganizer.tsx:125-127` renders it right under the `ModalSheet` title, conditioned the same way. `PriceField` no longer gets a hint (`AddTermView.tsx:123`, `FirstTermStepperOrganizer.tsx:161`). |
| 10 | Work-log standards reading log filled | Yes | `work-log.md:12-25`: the table has one row per group (from plan / from INDEX / discovered). |
| 11 | userinfo URLs rejected (server + client) | Yes | `schemas.py:152`, `appHelpers.ts:191`. Tests: `test_term_pricing.py:195-196` (`https://bank.pl@evil.tld/p`, `https://user:haslo@x.pl`). |
| 13 | Shared `Switch` component | Yes | `components/shared/appComponents.tsx:47-72` (`role="switch"`, `aria-checked`, `aria-label`, `disabled`). Used by the existing toggle row (L41) and `TermAttendeesPage.tsx:410`. |
| 14 | `MAX_PAYMENT_URL_LENGTH` reused | Yes | Defined at `appHelpers.ts:135`, used at `appHelpers.ts:181` and `appComponents.tsx:304`. |
| 15 | `set_payment_status` moved to `attendance_points` | Yes | `attendance_points.py:149`. The router calls it at `circles.py:260`. `term_payments.py` now holds only `ensure_payment_url_has_price` and `derive_payment_method`, with module-level imports. |
| 19 | `private, no-store` on the attendee list and `/mine/attendances` | Yes | `circles.py:201` and `circles.py:286` call `set_personalised_cache_headers`. Tests: `test_term_attendees.py:76`, `test_my_attendances.py:152`. |
| extra | Uppercase `HTTPS://` accepted | Yes | CHECK `ILIKE`, client regex `/i`, server `scheme.lower()`. Tests: `test_term_pricing.py:221`, `paymentHelpers.test.ts:72`. |

All three cycle-0 warnings (#1 colour, #2 hint placement, #3 standards log) are resolved.

### Documentation check after the fixes

| Doc | State |
|---|---|
| architecture.md "Paid terms" (L517) | Says "**Nine CHECKs**" and names both `_payment_url_https` CHECKs. **Inaccurate:** it gives the condition as `url LIKE 'https://%'`, but the migration and the models use `ILIKE`. It does not mention that the check is case-insensitive. |
| architecture.md runbook (L927, L932) | "the nine CHECKs" in both the deploy and downgrade steps. Correct. |
| architecture.md L520 (validation) | Documents the userinfo rule and the client/server parity. Does not mention case-insensitive scheme acceptance. |
| architecture.md L524 (Payment PUT) | Documents the module move, the INFO log line, and the no-store headers on the attendee list and `/mine/attendances`. Correct. |
| INDEX.md | Says "under nine named CHECKs (... link starts with `https://` ...)". The count is correct; case-insensitivity is not mentioned. |
| 0106 migration docstring | Mentions the https CHECK and that the API also requires a host and no userinfo. Does not say ILIKE/case-insensitive, though the code makes it clear. |

**Answer to the orchestrator's question:** No. The https CHECK's case-insensitivity is not documented anywhere. architecture.md actually misstates the condition as `LIKE`.

### Spec/plan vs code after the fixes

spec.md was not changed during the fix cycle. These statements in it no longer match the code:

| spec.md location | Spec says | Code now |
|---|---|---|
| L213-221 (CHECK table), L457 (round-trip test) | 7 CHECKs, "the seven CHECK names" | 9 CHECKs, including `ck_groups_default_payment_url_https` and `ck_terms_payment_url_https` (ILIKE). The test asserts 9 names. |
| L184, L289-298 (`term_payments.py` services) | `set_payment_status` lives in `term_payments.py` | It lives in `attendance_points.py:149`. |
| L74, L242, L261, L391 (URL rules) | https + host + no whitespace/control | Also rejects userinfo (server and client), and the client requires the literal `https://` prefix (case-insensitive). |
| L417, L426 ("Opłacone" style) | "mint-soft" box and badge | `bg-primary-soft text-primary-fg` in both places. This is a visual deviation from the spec and mockup and is not in the accepted D1-D4 list. |
| L417 (pay link) | `<a href={paymentUrl}>` | `href` is the result of a `parsePaymentUrl` re-check; an invalid stored link renders "Do zapłaty … (na miejscu)". |
| (none) | No INFO log, no `no-store` requirement on the attendee list | Both are implemented. Spec L521 mentions no-store only for `/access` and `/mine/attendances`. |
| L107 / mockup table L126 (hint) | Prefilled forms; the hint position is set by the mockup | The hint is now under the title, matching the mockup. Resolved. |

implementation-plan.md is a historical record, and every step is still `[x]`. The fixes come from verification and are not plan steps, so they do not lower plan completion. The work-log, however, has no section for the verification fix cycle: the last entry is "Implementation Complete" (L151).

### Standards spot-check of the fixes
- css.md: the new and changed classes are tokens (`bg-primary-soft`, `text-primary-fg`, `bg-mint`, `bg-line`). `Switch` uses `bg-white` for the thumb. That is a Tailwind default rather than a theme token, and it was carried over from the pre-existing toggle, so this is info only.
- accessibility.md: `Switch` keeps `role="switch"`, `aria-checked` and an accessible name. The external link keeps "(nowa karta)".
- security.md: userinfo rejection and the no-store headers strengthen compliance.
- commenting.md: the fixes have explanatory comments (`SignUpFooter.tsx:90`, `schemas.py:152`, and the router docstrings at `circles.py` L198-199 and L283).
- migrations.md: 0106 is still one schema-only revision. Its CHECK list drives the downgrade in reverse order, so the 2 new CHECKs are dropped too.

### Cycle 1 issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| C1-1 | documentation | warning | architecture.md gives the https CHECK as `LIKE 'https://%'`, but the code uses `ILIKE`. Case-insensitivity is not documented anywhere. | `.maister/docs/project/architecture.md:517`; INDEX.md paid-terms sentence | true | Change it to `ILIKE 'https://%'` (case-insensitive, matching `scheme.lower()` and the client's `/i`), and optionally add "(case-insensitive)" in INDEX.md. |
| C1-2 | documentation | warning | spec.md is stale after the fixes: 7 vs 9 CHECKs, the `set_payment_status` module, the userinfo rule, the INFO log, no-store on the attendee list, and the href re-check. | `implementation/spec.md` L184, L213-221, L261, L289-298, L391, L417, L457, L521 | true | Add a "Post-verification changes (cycle 1)" section to spec.md listing these. |
| C1-3 | documentation | warning | The "Opłacone" style (`primary-soft`) is not "mint-soft" as the spec and mockup say, and it is not recorded as an accepted deviation. | `SignUpFooter.tsx:84`, `TermCards.tsx:216` vs spec L417/L426 | true | Record it as D5 (the reason, 4.54:1 contrast, is in orchestrator-state) or confirm with the user. |
| C1-4 | documentation | warning | The work-log has no entry for the verification fix cycle (fixes #1-#19, files touched, tests re-run). | `implementation/work-log.md` (ends at L151) | true | Append a dated "Verification fixes (cycle 1)" entry. |
| C1-5 | standards | info | Edge case: client accepts `https://@host`, server rejects it with a 400. | `appHelpers.ts:191` vs `schemas.py:152` | true | Optionally also reject `url.href` containing `@` before the host, or check `trimmed` for `@` in the authority part. |
| C1-6 | standards | info | The `Switch` thumb uses `bg-white` (a Tailwind default, not a theme token). It was carried over from the existing toggle. | `appComponents.tsx:69` | true | Optional: use a surface token. |
| C1-7 | documentation | info | The 0106 docstring does not say that the https CHECK is case-insensitive. | `0106_paid_terms.py:10-11` | true | Optional one-word clarification. |

Cycle-0 info items #4-#7 are unchanged.

### Structured counts (cycle 1)
- plan_completion: complete. 68/68 steps (79 `[x]`, 0 `[ ]`), 100%.
- standards_compliance: mostly_compliant. 21 standards checked, 18 applicable, 18 followed. The gaps are info-level only.
- documentation: adequate. There are 4 warnings: architecture LIKE/ILIKE, stale spec, the undocumented Opłacone deviation, and no work-log entry for the fix cycle.
- issue_counts: critical 0, warning 4, info 3.

---

# Cycle 0 report (original, kept for reference)


## 1. Plan Completion — complete

| Metric | Value |
|---|---|
| Total steps (per Overview / Execution Order) | 68 (5+3+9+9+5+7+7+8+5+5+5) |
| Completed steps | 68 (plus the 11 group-header markers x.0, so 79 `[x]` and 0 `[ ]`) |
| Completion | 100% |

### Code spot-checks

| Group | Evidence |
|---|---|
| 1 DB | `src/backend/alembic/versions/0106_paid_terms.py`: `down_revision = "0105"`, `SET LOCAL lock_timeout`, 8 columns and 7 named CHECKs, reversible downgrade. `app/groups/models.py:115,123` adds the `PaymentMethod`/`PaymentStatus` StrEnums; L178 and L337 use `Numeric(10, 2)`; L425 makes `paid_marked_at` a naive `DateTime()`. `tests/test_paid_terms_migration.py:57` holds the round trip. |
| 2 Matrix | `app/core/authorization_matrix.py:110-117`: row 71 `PUT …/attendees/[^/]+/payment$` → EDIT/mcp:edit. It sits directly after row 70 and before rows 26/27 (L123-124). |
| 3 Pricing | `app/groups/schemas.py:100-126` (`PRICE_MESSAGE`, `PAYMENT_URL_MESSAGE`, `PAYMENT_URL_LENGTH_MESSAGE`, `_validate_price`); `application/term_payments.py` (`ensure_payment_url_has_price`, `derive_payment_method`); 9 tests in `tests/test_term_pricing.py`. |
| 4 Payment status | `term_payments.set_payment_status`: 403 → 404 → listed-row 404, `with_for_update` + `populate_existing`, `mapped_transaction_conflicts`, idempotent. `router/circles.py:239-253` has the handler with `EditPrincipal` (= `require_any("EDIT","mcp:edit")`). `repository.py:654` has `listed_attendance_condition`. 7 tests in `tests/test_term_payments.py`. |
| 5 RSVP fix | `public_view.py:452-454`: `withdrawn_at = None`; presence is cleared only `if term.attendance_closed_at is None`. `list_attendances_for_term` and `_attendances_active_at` are removed (grep finds no hits in `app/`). `tdd-green-gate.md` shows 4 of 4 passing. |
| 6 Types/helpers/fields | `utils/appHelpers.ts:137-140` has the four error constants, identical to the server text. `components/shared/appComponents.tsx:232,268` has `PriceField`/`PaymentUrlField` with `role="alert"`. `api/groups.ts:392` has `setPaymentStatus`. |
| 7 Forms | `AddTermView.tsx:120` has `PriceField` with `TERM_PAYMENT_PREFILL_HINT`. `FirstTermStepperOrganizer.tsx:88-89` implements the explicit-null rule. `AppModals.tsx:28-29` passes the defaults. |
| 8 Term page | `TermCard.tsx:58-85` has the price badge (`bg-primary-soft … text-primary-fg`), "płatność na miejscu" and "Płatność online po zapisaniu się.". `RsvpDialogLoggedIn.tsx:94` has the cost line. `SignUpFooter.tsx:81-105` has the payment variant: external `<a>` with `rel="noopener noreferrer"` and the "(nowa karta)" label. `TermCards.tsx:221-226` has the SavedTermCard badges. `TermNeededItems.tsx:105-106` passes the price props (group 11 follow-up). |
| 9 Organizer list | `TermAttendeesPage.tsx:158` has the counted-only count line with " · opłaceni: N". L395-398 has the refund pill and note. L411-414 has `role="switch"`, `aria-checked`, `aria-label="opłacone — {name}"` and a pending-disabled state. `hooks/useTermAttendance.ts:69` has `setPaymentStatus`. |
| 10 Docs | See section 3. |
| 11 Test review | 6 gap tests. The `themeTokenUsage` regression in `SignUpFooter` was fixed (mint → primary tokens). Full suites match the baseline (`verification/test-suite-results.md`). |

Visual coverage: `implementation/visual-coverage.md` maps all 9 items from `analysis/design-context/INDEX.md` to groups 6–9, and I verified each mapped component in the code above.

## 2. Standards Compliance — mostly compliant

| Standard | Applies? | Reasoning / evidence |
|---|---|---|
| global/error-handling.md | Yes | The payment PUT uses `mapped_transaction_conflicts` and `EntityNotFoundException`; the frontend uses the fallback "Nie udało się zapisać płatności". Followed. |
| global/validation.md | Yes | The server validates every input. The client uses text inputs, shared parsers, inline `role="alert"` errors and blocks submit; both stacks share one copy table. Followed. |
| global/conventions.md | Yes | Docs and runbook were updated; no secrets were added (work-log grep found 0 hits). Followed. |
| global/coding-style.md | Yes | ruff and eslint report nothing new (work-log). Followed. |
| global/commenting.md | Yes | Docstrings explain the rules and the 403/404 order (`term_payments.py`), and the matrix comment mirrors row 70. Followed. |
| global/minimal-implementation.md | Yes | No payments table or gateway stubs; the dead `list_attendances_for_term` and `_attendances_active_at` are deleted. Followed. |
| backend/api.md | Yes | PUT on the sub-resource returns 204, with 400/403/404/409. Followed. |
| backend/models.md | Yes | `Numeric(10,2)`, `_enum_column` StrEnums, named CHECKs, no `relationship()`. Followed. |
| backend/queries.md | Yes | One listed-row predicate is shared by the list and the PUT, with `with_for_update` + `populate_existing`. Followed. |
| backend/jooq.md (SQLAlchemy Core) | Marginal | The new query is ORM `select`, consistent with its neighbours. No issue. |
| backend/migrations.md | Yes | One schema-only revision, `lock_timeout`, reversible downgrade, round-trip test, runbook. Followed. |
| backend/security.md | Yes | Row 71 is declared before 26/27, the route `Depends` matches, the organizer check lives in the service, and status is never public. Followed. |
| backend/plugin-auth.md | No | No plugin auth surface was touched. |
| backend/time.md | Yes | `paid_marked_at` uses naive `datetime.utcnow()`, as the plan and the standard require. Followed. |
| frontend/css.md | Yes | Tokens only: no hex or rgb values in the added frontend lines, and the `themeTokenUsage` regression was fixed. Followed. |
| frontend/components.md | Yes | `resolveTermView`/`termViewState` remains the single view derivation (`paymentStatus` was added to `content`). Followed. |
| frontend/accessibility.md | Yes | `role="switch"` with an accessible name, "(nowa karta)" on the external link, `aria-hidden` on the arrow and ✓, `aria-invalid`/`aria-describedby` on the fields. Followed. |
| frontend/responsive.md | Yes (light) | The new elements reuse existing full-width and pill layouts; nothing suggests a breakpoint issue. No gap found, but the layouts were not tested at mobile widths. |
| frontend/data-fetching.md | Yes | `setPaymentStatus` copies `setPresence`: it awaits prefix invalidation and passes server messages through verbatim. Followed. |
| testing/backend-testing.md | Yes | Every new test follows `test_<op>_<scenario>_<expected>` (for example `test_setPayment_afterClose_isAccepted`), and integration tests go through HTTP. Followed. |
| testing/frontend-testing.md | Yes | All 4 new test files import from `"vitest"` explicitly and use no `as unknown`/`as any` casts. The files that mock call `vi.resetAllMocks()`. Followed. |

Count: 21 checked, 18 applicable (plugin-auth no; jooq and responsive marginal), 18 followed with no violation found.

## 3. Documentation Completeness — adequate

| Artifact | Finding |
|---|---|
| implementation-plan.md | Intact; every step is `[x]`. |
| work-log.md | Has a start entry, one dated entry per group (1–11) with standards, tests, files and notes, wave summaries and a final completion entry with full-suite results. Gap: the "Standards Reading Log › Loaded Per Group" section still says "(Entries added as groups execute)". The standards are listed inside each group entry instead (warning). |
| architecture.md | Has a "Paid terms (migration 0106)" section (L512+), row 71 (L524) and the "Deploy / rollback for paid terms (migration 0106)" runbook (L925+), and the close-algorithm and matrix bullets were updated. |
| standards/backend/models.md | Has a new "Money as Numeric(10,2), Decimal String on the Wire" entry. |
| INDEX.md | The architecture summary now covers 0106, row 71 and the runbook, and the models.md line gained the money clause. |
| Spec alignment | I traced all 15 core requirements and the 4 error-copy rows to code (see section 1). The server sends the URL-requires-price 400 in `message` with `fieldErrors` null (work-log, group 3). Spec req 3 does not require `fieldErrors` for this rule, so this is info only. |
| User docs | The spec does not require any. |

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | documentation | warning | Visual deviation not in the accepted D1–D4 list: the "Opłacone" text uses `text-ink` instead of the mockup's green. | `SignUpFooter.tsx` PaymentState; work-log group 8 | true | Confirm with the user and add it as D5 in the spec, or match the mockup with a token. |
| 2 | documentation | warning | Visual deviation not in the accepted D1–D4 list: the prefill hint sits under the price field, not under the sheet title. | `AddTermView.tsx:120`, `FirstTermStepperOrganizer.tsx:162` | true | Confirm with the user and record it as D6, or move the hint. |
| 3 | documentation | warning | The work-log "Standards Reading Log › Loaded Per Group" section was left as a placeholder. | `implementation/work-log.md` | true | Fill it in from the per-group "Standards Applied" lines, or remove the empty section. |
| 4 | plan_completion | info | Several plan-listed files were not modified (conditional fixture files, `useFirstTermStepper.ts`, 5 backend test files). The full suites match the baseline. | implementation-plan.md groups 3, 4, 6, 7 | false | None needed. |
| 5 | standards | info | The two backend full-suite failures were classified as pre-existing by inspection, not by running HEAD. | work-log completion entry | false | Optionally confirm with a HEAD run. |
| 6 | documentation | info | The URL-requires-price 400 arrives in `message` rather than `fieldErrors`. | `term_payments.py` / work-log group 3 | false | Acceptable under the spec. |
| 7 | documentation | info | The architecture runbook line "deploy web together with backend, never ahead" is an inference (work-log group 10). | architecture.md L925+ | true | Confirm with the deploy owner. |
