# Implementation Verification — Paid terms

## TL;DR
⚠️ **Passed with Issues** (after fix cycle 2) — 0 critical, 2 warnings remaining (both pre-existing platform gaps: no error tracking, no backend restart policy), info items only otherwise. Documentation drift R1–R4 and code items R7, R8, R10, R12 fixed in cycle 2 (targeted tests green). All cycle-0 code warnings resolved; code review now clean (0 C / 0 W); production readiness **GO** (93%, low risk). No regressions: backend 1702/1705 (2 pre-existing + 1 flaky setup failure, passes alone), frontend 2016/2048 (32 pre-existing).

## Open Questions / Risks
- No browser run of the integrated flow yet — Phase 12 E2E covers it
- Only remaining URL difference: server accepts `https://a<b.pl`, client refuses (client stricter — harmless)
- Future own gateway: relax method CHECKs, per-attendance method, marked-by, payments table, more states; webhook needs a system-level `set_payment_status` variant

## Executive summary
All 11 groups are implemented and the 14 approved verification fixes plus one extra (uppercase `HTTPS://`) are in place with tests. Remaining items are documentation updates and pre-existing platform gaps; none blocks release.

## Implementation plan
68/68 steps `[x]` (100%). Fixes from verification are outside plan steps.

## Test suite (cycle 1, test-suite-results.md)
| Suite | Passed | Failed | Regressions |
|---|---|---|---|
| Backend pytest | 1702/1705 (99.8%) | 2 pre-existing + 1 flaky (`test_points_awards_contexts` setup 400 in `/api/products/resolve`, passes alone, code untouched) | 0 |
| Frontend vitest | 2016/2048 (98.4%) | 32 pre-existing (identical to baseline) | 0 |

## Standards compliance
Mostly compliant — 18 applicable standards followed. Docs: architecture.md (Paid terms, nine CHECKs, row 71, runbook with backend-up check), models.md money entry, INDEX.md.

## Optional reviews (cycle 1)
| Review | Verdict | Counts |
|---|---|---|
| Code review | clean | 0 C / 0 W / 10 I |
| Pragmatic review | appropriate; fixes reduced code | 0 C / 0 H / 0 M / 1 L (kept) / 1 I |
| Production readiness | **GO**, 93%, low risk | 0 C / 2 W (pre-existing) / 2 I |
| Reality check | deployable, ~97% of scope | 0 C/H; Q1 open → Phase 12; N1 Low |
| Completeness | passed_with_issues | 0 C / 4 W (docs) / 3 I |

## Remaining issues
| # | Sev | Source | Issue | Location | Fixable |
|---|---|---|---|---|---|
| R1 | warning | completeness | architecture.md / INDEX.md say `LIKE 'https://%'`; code uses `ILIKE` (case-insensitive, stored as typed) | architecture.md:517, INDEX.md | yes |
| R2 | warning | completeness | spec.md stale after fixes (7 CHECKs, module of set_payment_status, mint-soft, missing userinfo/log/no-store rules) | spec.md | yes |
| R3 | warning | completeness | "Opłacone" `bg-primary-soft text-primary-fg` not recorded as accepted deviation (D5, 4.54:1 contrast, themeTokenUsage rule) | spec.md Visual Design | yes |
| R4 | warning | completeness | No work-log entry for the verification fix cycle | work-log.md | yes |
| R5 | warning | production | No error-tracking SDK (pre-existing) | platform | no |
| R6 | warning | production | `backend` has no restart policy/healthcheck (pre-existing; runbook step covers this release) | docker-compose.yml | no (separate infra task) |
| R7 | info | code + reality | Client accepts `https://@x.pl`, `https://:@x.pl`, `https://x.pl\@evil.tld` that server rejects; server accepts invalid port / `<` the client refuses | appHelpers.ts:178, schemas.py | yes |
| R8 | info | code | `is not` enum comparison in set_payment_status; `!=` sturdier | attendance_points.py | yes |
| R9 | info | code | Term made free after sign-up shows "Opłacone" to an unpaid attendee (intended) | SignUpFooter.tsx:82 | decision |
| R10 | info | completeness | 0106 docstring doesn't say the https CHECK is case-insensitive | 0106_paid_terms.py | yes |
| R11 | info | completeness | Switch thumb uses `bg-white` (carried over) | appComponents.tsx:69 | optional |
| R12 | info | production | No test pins tolerance of missing (undefined) fields | src/features/terms | yes |
| R13 | info | code/prod | Host of payment link not shown near "Zapłać"; duplicate attendance row → 500 (pre-existing); CHECK scans under lock | various | no / later |
| R14 | low | flaky test | `test_points_awards_contexts::test_confirmGift_parallelConfirmsOnCommittedSessions_postsExactlyOneAward` setup failure in full run | tests | separate task |

## Fix & Re-Verification History
| Cycle-0 issue | Fix applied | Re-check (cycle 1) |
|---|---|---|
| #1 href without client re-check; no DB https CHECK | `SignUpFooter` renders `<a>` only if `parsePaymentUrl` returns a string; `ck_terms_payment_url_https`, `ck_groups_default_payment_url_https` (`ILIKE`) in 0106 + models | resolved — code review W-1 closed; migration test covers http:// violations |
| #2 client URL parser looser than server | literal `^https://` (case-insensitive), `[\s\p{C}]` rejected, host required | resolved, residual R7 edge cases |
| #3 version skew "NaN zł" | `!= null` / `== null` across TermCard, TermSignUp, TermCards, RsvpDialogLoggedIn, FirstTermStepperOrganizer, SignUpFooter | resolved (production) |
| #4 runbook lacks backend-up check | runbook step: `docker compose ps backend`, `alembic current` = `0106 (head)`, else logs + retry | resolved (production) |
| #5 no log of payment toggles | INFO log on actual change, ids only, caplog test | resolved |
| #8 "Opłacone" style inconsistent | both screens `bg-primary-soft text-primary-fg` (4.54:1) | resolved; needs D5 record (R3) |
| #9 prefill hint placement | under page/sheet title, only with circle defaults | resolved |
| #10 work-log standards placeholder | table filled | resolved |
| #11 userinfo URLs | rejected server (`@` in netloc) + client (username/password) | resolved, residual R7 (`https://@x.pl`) |
| #13 switch duplicated ToggleRow | shared `Switch` component | resolved (pragmatic L1) |
| #14 hardcoded 500 | `MAX_PAYMENT_URL_LENGTH` reused | resolved (pragmatic L2) |
| #15 function-local imports | `set_payment_status` moved to `attendance_points.py`; `term_payments.py` 78 → 24 lines | resolved (pragmatic L4, code I-7) |
| #19 no-store on personal lists | `set_personalised_cache_headers` on attendee list + `/mine/attendances`, tested | resolved |
| extra: uppercase `HTTPS://` → DB CHECK 500 (found during fixes) | CHECKs use `ILIKE`; test stores link as typed | resolved |
| #12 Zapłać after term end | user decision: keep | closed |

### Fix cycle 2 (targeted re-check, no full re-run — user choice)
| Issue | Fix | Re-check |
|---|---|---|
| R1 `LIKE` in docs | architecture.md + INDEX.md say `ILIKE`, case-insensitive, stored as typed | resolved |
| R2 spec stale | spec.md/spec.html "Post-verification changes (cycle 1)" section; stale lines updated; rev 3 | resolved |
| R3 Opłacone style undeclared | deviation D5 added (role tokens, 4.54:1) | resolved |
| R4 work-log | entries "Verification fix cycle 1" and "cycle 2" | resolved |
| R7 URL parity | client rejects `@` in authority and `\`; server rejects `\` and invalid port; tests both sides | resolved (only `https://a<b.pl` differs, client stricter) |
| R8 enum `is not` | `!=` | resolved |
| R10 migration docstring | notes case-insensitive https CHECK | resolved |
| R12 missing-field tolerance | 2 tests: no NaN/zł/link when fields absent, no casts | resolved |
Tests: backend test_term_pricing/test_term_payments/test_paid_terms_migration 21 passed, ruff clean; frontend 5 files 61 passed, typecheck 0, eslint clean.
Not addressed (out of scope / decisions): R5, R6 (pre-existing platform), R9 (intended), R11, R13 (later), R14 (separate flaky-test task).

## Verification checklist
- [x] All six reports on disk and refreshed for cycle 1
- [x] No critical issues; no regressions
- [x] Documentation drift R1–R4 (cycle 2)
- [ ] E2E browser verification (Phase 12)
