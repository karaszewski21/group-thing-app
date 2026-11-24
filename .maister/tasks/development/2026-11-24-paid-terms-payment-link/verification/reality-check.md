# Reality Check: Paid terms (price, payment link, manual payment status). Re-verification, cycle 1

## TL;DR
- **Verdict: ⚠️ Issues Found, deployable.** After the fixes, both journeys still connect end to end in code. Organizer: circle defaults → term inherits/overrides → "opłacone" switch. Attendee: price before sign-up → Zapłać / Do zapłaty / Opłacone → Moje zajęcia.
- No Critical or High gaps. Tests (from `verification/test-suite-results.md`, not re-run): backend 1702/1705, frontend 2016/2048. All failures are either baseline or 1 unrelated flaky setup failure. The 3 new backend and 14 new frontend tests all pass.
- Q2 is resolved, Q3 and Q4 are accepted by decision, and Q1 (no browser run) is still open and handed to Phase 12 E2E.
- One new Low finding: the client accepts `https://@host` (an empty userinfo) but the server rejects it with a 400. This is a minor parity gap in the stricter parser.

## Key Decisions
- I assessed by reading the code after the fixes (`skip_test_execution: true`), with one small Node/Python parsing probe of URL edge cases. I did not start the app or run tests.
- Q4 is closed as a **user decision** ("Zapłać" stays visible after the term ends), not as a gap. Q3 is closed as **accepted**: the client blocks the case before it reaches the server.
- The gateway-readiness items remain forward risks, not defects (section 5).

## Open Questions / Risks
- **Q1 is still open:** no browser run of the panel flow yet. Phase 12 E2E should run the smoke script in section 7, action 1.
- **Moving `set_payment_status` into `attendance_points.py`** removed the local imports, but the router now calls `attendance_points.set_payment_status`. The behaviour is unchanged, and the test suite (`test_term_payments.py`, 7 tests) passes.
- **Client/server URL parity edge:** `https://@example.com` and `https://:@example.com` pass `parsePaymentUrl` (WHATWG gives an empty username and password). The server rejects them because it checks for `"@" in netloc`. The result is a server 400 instead of an inline field error. This is Low because nobody realistically types it.

---

## Re-check (cycle 1)

| # | Previous finding | Status | Evidence after fixes |
|---|---|---|---|
| Q1 | No end-to-end/browser evidence of the panel flow | **Residual (handed to Phase 12 E2E)** | No `verification/visual-fidelity.md` or E2E artifact exists yet. AppPage "edit group" and "add term" still fail on the baseline stale selectors (12 failures, same as before), so the integrated panel path is still verified by reading code only. |
| Q2 | Inconsistent "Opłacone" styling | **Resolved** | Both `SignUpFooter.tsx:84` and `TermCards.tsx:216` (`PaymentBadge`) now use `bg-primary-soft text-primary-fg`. "Do zapłaty" uses `bg-accent-soft text-accent-fg` on both screens. The themeTokenUsage test is green (not among the failures). |
| Q3 | "Link requires price" 400 arrives in `message`, not `fieldErrors` | **Accepted (residual by design)** | `parsePayment` (`appHelpers.ts:198-206`) still blocks a link without a price before submit, so only raw API callers see the non-field error. |
| Q4 | "Zapłać" visible after the term ends | **Closed by user decision (keep)** | `TermSignUp.tsx:24-26` has no end-of-term condition. This is intended, because it allows late payment. |

### The other fixes, verified in code
| Fix | Verified | Where |
|---|---|---|
| href guard | ✅ The stored link is re-parsed before it becomes an `href`. An invalid link falls back to "Do zapłaty … (na miejscu)" instead of rendering an anchor. | `SignUpFooter.tsx:91-94` |
| Stricter client URL parser | ✅ Enforces a literal `https://` prefix (any case), at most 500 characters (shared `MAX_PAYMENT_URL_LENGTH`), no `\s` or `\p{C}`, a URL that parses, a host, and no userinfo. Returns the trimmed input, not `URL.href`. It mirrors `schemas._normalize_payment_url` except for the `https://@host` edge noted above. | `appHelpers.ts:178-194`, `schemas.py:130-157` |
| https CHECKs use ILIKE | ✅ Migration 0106 and the models agree (`ILIKE 'https://%'`). An uppercase `HTTPS://` round-trip is tested. | `0106_paid_terms.py:51-69`, `models.py:145,300`, `test_term_pricing.py:221` |
| `!= null` checks | ✅ Every price/status branch uses loose null checks. An older backend that omits the fields gives no "NaN zł", and `paymentStatus == null` hides the footer. | `TermCard.tsx:55-84`, `TermCards.tsx:222`, `TermSignUp.tsx:25`, `TermAttendeesPage.tsx:91,131`, `RsvpDialogLoggedIn.tsx:92` |
| Hint placement | ✅ The hint sits under the sheet title and only shows when the circle has a default price or link. | `AddTermView.tsx:52,78`, `FirstTermStepperOrganizer.tsx:126-128` |
| no-store on personal lists | ✅ Set by `set_personalised_cache_headers` and asserted in tests. | `router/circles.py:201,286`, `test_term_attendees.py:76`, `test_my_attendances.py:152` |
| INFO log on status change | ✅ Logs only when the status actually changed. The log carries ids only, no PII. | `attendance_points.py:184-191` |

## 1. Journeys end to end (after the fixes)

| Journey step | Status | Path |
|---|---|---|
| Circle create/edit with a default price and link | ✅ | `GroupCreateView`/`GroupEditView` → `parsePayment` gate → `circles.py` merge with `model_fields_set` → method derived on the server |
| "Dodaj termin" prefill + hint | ✅ | `selectTermGroup` → `AddTermView` effect selects the first circle → hint shown when the circle has defaults → request sends both fields explicitly → `terms.py` inheritance table |
| Organizer marks "opłacone" | ✅ | `TermAttendeesPage` `onPayment` → `api.put(…/attendees/{party}/payment)` (`groups.ts:398`) → router row 71 → `attendance_points.set_payment_status`. The order is 403 → 404 term → locked row via `listed_attendance_condition` → idempotent write and log. |
| Withdrawn PAID attendee kept for refund | ✅ | The same `listed_attendance_condition` predicate drives both the list and the PUT. Unchanged by the fixes. |
| Attendee sees the price before sign-up | ✅ | TermCard badge and cost line in `RsvpDialogLoggedIn` (both sign-up paths, including needed items) |
| Zapłać / Do zapłaty / Opłacone | ✅ | `TermSignUp` → `SignUpFooter` payment variant, with the href guard applied |
| Moje zajęcia badge | ✅ | `MyAttendanceResponse.payment_status` → `PaymentBadge` (now the unified style) |
| Re-RSVP keeps the status | ✅ | `create_rsvp` reactivation. Unchanged; `test_rsvp_reactivation.py` passes 4/4. |

## 2. Critical Gaps
None.

## 3. Quality Gaps (current)

| # | Severity | Gap | Impact |
|---|---|---|---|
| Q1 | Medium | No browser/E2E run of the integrated flow (residual) | The wiring is verified by reading code only |
| N1 | Low | The client accepts `https://@host`, which the server rejects (`"@" in netloc`) | A generic 400 instead of an inline error. Fix: reject a literal `@` in the authority part on the client too. |
| Q3 | Low (accepted) | The "link requires price" error arrives in `message` | Only API callers see it |

## 4. Integration Check
- **Auth:** row 71 and `EditPrincipal` are unchanged. Moving the service to `attendance_points` keeps the order 403 → 404.
- **DB:** the 0106 CHECKs now use ILIKE in both the migration and the models, so the drift risk is resolved. The migration round-trip test passes (`test_paid_terms_migration.py`).
- **Caching:** the personal attendee list and `/mine/attendances` are `private, no-store`, so payment marks cannot leak through a shared cache.
- **Test baseline:** the one new backend failure (`test_points_awards_contexts`) fails in a products-resolve setup helper outside the diff and passed when re-run on its own. It is not a feature regression.

## 5. Readiness for an Own Gateway (unchanged; keep for the future)

| Aspect | State | Gap for a gateway |
|---|---|---|
| Method enum | `EXTERNAL_LINK`/`PLATFORM`, derived on the server | `ck_*_payment_method_url` ties the method to a URL and must be relaxed. The method is per term, not per attendance. |
| Status independent of link | ✅ `term_attendances.payment_status` | — |
| Who/what set the status | `paid_marked_at`, plus the organizer id in the INFO log only | A persisted `paid_marked_by` / source (ORGANIZER vs PLATFORM) |
| Amount | No snapshot | A charged amount per payment |
| Payment record | None | Provider reference, idempotency key, webhook audit |
| States | Binary UNPAID/PAID | PENDING/FAILED/REFUNDED. The frontend `PaymentStatus` union and its switches assume two values. |
| Refund | An unmark erases the mark | No history survives. A payments table or ledger is needed. |
| Write entry point | ✅ The single service `attendance_points.set_payment_status` | A webhook could call it, but it currently requires an organizer principal, so it needs a system-principal variant |

## 6. Functional Completeness
About **97%** of the agreed scope is implemented and covered by tests. The remainder is runtime evidence (Q1) and one Low parity edge (N1).

## 7. Pragmatic Action Plan

| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Phase 12 E2E smoke run, in order: (1) create a circle priced 25,50 zł with a link; (2) "Dodaj termin" shows the hint and prefill; (3) a second account signs up and sees the cost line; (4) it sees "Zapłać" open a new tab; (5) the organizer toggles "opłacone"; (6) "✓ Opłacone" shows on the term page and in Moje zajęcia, in the same style; (7) the attendee withdraws and the organizer sees "wypisany — do zwrotu"; (8) a re-RSVP keeps "Opłacone" | Every step behaves as described, with no console errors | High | 30–45 min |
| 2 | Reject an empty userinfo (`@` in the authority) in `parsePaymentUrl`, and add a test case | `https://@example.com` gives an inline error | Low | 10 min |
| 3 | Before the gateway work: design `paid_marked_by`/source, a payments table (amount snapshot, provider ref, states), a system-principal write path, and relaxed method CHECKs | An ADR or spec is ready when the gateway work starts | Medium (future) | — |
| 4 | Fix the stale AppPage selectors (pre-existing) | AppPage failures reach 0 and the price fields get exercised | Medium | 1–2 h |

## 8. Completion Verdict
**⚠️ Complete with minor gaps.** The fixes landed as described and broke none of the journeys. The only remaining substantive gap is evidence: one real-browser pass (Phase 12) is needed before release.
