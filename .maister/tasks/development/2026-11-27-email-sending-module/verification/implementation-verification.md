# Implementation Verification: e-mail module `app/email` (stages 1+2) — final state after 3 cycles

## TL;DR
**⚠️ Passed with Issues — ready for stage 1.**
- 0 critical. Of the original 12 warnings, 9 are fixed (W1–W9). The 3 left (W10–W12) are product or ops decisions, deferred.
- Tests: backend 2079 passed / 2 fail, frontend 2290 / 49 fail, matcher 125 passed, typecheck 0, mypy 15, ruff 64. Every failure was already in the baseline; **0 regressions**.
- Production readiness: **GO**. Reality check: **Ready**.
- Before stage 2 (`EMAIL_NOTIFICATIONS_ENABLED=true`): runbook step-6 precondition (W10), retention in the privacy policy (W11), alerting (W12).

## Open Questions / Risks
- **W10 (product):** existing password accounts are unverified (the 0112 backfill covers Google accounts only). Notifications reach only people who confirm their address through the banner. Runbook step 6 measures the share.
- **W11:** no retention for `email_messages` (bell text) or `account_tokens`. Needs a purge task and a retention period in the D14 privacy policy.
- **W12:** no alerting on FAILED rows or overdue PENDING rows. The runbook has a SQL check.
- **Proxy in front of nginx:** if a TLS proxy or CDN sits in front, set `set_real_ip_from`, otherwise the `auth_flows` limit applies to everyone as one client. This is a runbook step before stage 1, and the user decides at deploy time.
- **Residual (accepted):**
  - The nginx error log prints the full URL with the token when an upstream call fails.
  - The 8 s shutdown wait is shorter than one send's 10 s timeout. A long send that is in progress at shutdown may end as `stuck_sending`; the rest of the batch goes back to PENDING.
  - Legacy passwords over 72 bytes now get a 400 at login and need a reset. Before this change they got a 500.
  - One-click unsubscribes from large providers share the per-IP limit. Harmless at 100 mails/day.
- **Outside the code:** the D14 privacy policy, the Mailgun DPA, and an ADR to replace ADR-009.
- **Unrelated changes in the working tree:** search (`search.py` + 2 tests), the „Zarezerwowane” tile in `HomeView.tsx`, and one "Visibility predicates" line in `architecture.md`. Keep them out of this feature's commit.

## Executive summary
All mail paths connect end to end, and tests confirm each of them:
- bell → transactional queue → job → Mailgun;
- registration → verification mail → confirmation;
- reset, including setting a first password on a Google-only account;
- webhook → suppressions;
- unsubscribe by one-click POST, and by GET → page → POST.

Two fix cycles closed every code and documentation warning from the first verification. The second cycle also fixed the one regression it had introduced: `pause()` on the test's fake scheduler. The final full test run shows no regressions.

## Implementation plan verification
136/136 items (117 steps, 19 groups) plus follow-up 17b. Details are in `completeness-report.md`: standards 22/22 and complete documentation.

## Test suite results (final, test-suite-results-reverify-2.md)
| Suite | Result | Compared with baseline |
|---|---|---|
| Backend pytest | 2079 passed / 2 failed | the 2 known stale tests (`test_owner_items_page…`, `test_terms_circle…0053`) |
| Backend mypy / ruff | 15 / 64 | baseline |
| Frontend vitest | 2290 passed / 49 failed | the 11 baseline files. The 20 failures in `MyItemsViewCategory` come from HEAD 3bb3591, not from this feature. routeManifest (2) and reservedSlugs (1) were fixed along the way. |
| Frontend typecheck / lint | 0 / 10 errors + 29 warnings | baseline, no findings in feature files |
| Matcher pytest | 125 passed | baseline |
| `docker compose config --quiet` | exit 0 | — |

## Optional reviews (final state)
| Review | First pass | After fixes |
|---|---|---|
| Code review | 0 crit / 2 warn / 15 info | cycle 3 **clean**: 0 crit / 0 warn / 2 info (C3-1 shutdown wait, C3-2 legacy passwords) |
| Pragmatic review | Appropriate, 2 warn | Appropriate, 0 warn, 2 info (both fixed in round 2) |
| Production readiness | GO_WITH_MITIGATIONS, 7 warn | **GO**. 2 new warnings, both handled: stop_grace_period (fixed) and proxy real_ip (runbook) |
| Reality check | Issues Found (~95%) | **Ready**: stage 1 now, stage 2 after the step-6 preconditions |

## Fix & Re-Verification History
| Issue | Fix | Re-check |
|---|---|---|
| W1 tokens in access logs | nginx `token_safe` format (`$uri`, unsubscribe path redacted, no referer) + uvicorn filter `app/core/access_log.py` (path, `token=`, `_token=`) | resolved. Residual: nginx error log on upstream failure (accepted) |
| W2 password >72 B → 500; bcrypt before claim | 72 B limit with a Polish 400 (register, reset, and in round 2 also login and families); token claim first, then bcrypt in `to_thread` | resolved |
| W3 Mailgun 401/403 permanent | 401/403/404 retryable with a separate code + one ERROR per run; one `_CREDENTIAL_STATUSES` set (round 2) | resolved |
| W4 no GET on List-Unsubscribe | GET → 303 to `/unsubscribe?token=`, no side effects; matrix row 78 GET+POST | resolved |
| W5 no HTTP rate limit | nginx `auth_flows` 10 r/min burst 5 on token routes + unsubscribe; webhook excluded | resolved. Residual: shared provider IPs for one-click (info) |
| W6 restart during a send | round 1: 15 s wait. Round 2: cooperative stop between sends, unattempted rows go back to PENDING, wait 8 s, compose `stop_grace_period: 25s` | resolved. Residual: C3-1 (info) |
| W7 normalisation duplicated | `rules.normalize_address`; auth uses `normalize_email` (strip fixed) | resolved |
| W8 labels duplicated | one map `EMAIL_CATEGORY_LABELS`, order taken from the server | resolved |
| W9 reset does not revoke JWTs | documented as an accepted risk (architecture.md) | resolved (doc) |
| Info | cap log wording, `link_path` guard, canonical UUID in the token, reset lifts BOUNCE, strict localhost URL, webhook body ≤64 KiB, `_utcnow` inlined, empty body handled in `client.ts` (simplified in round 2), bold address/category in `AuthLayout` | resolved |
| Regression (cycle 2) | `test_wants_scan_removed`: the fake scheduler had no `pause()`; a no-op `pause()` was added | resolved in cycle 3 |
| Incident | `tests/test_email_senders.py` was accidentally truncated during the fix and rebuilt from the transcript | 13/13 pass |

Cycles: 1 initial verification + 2 fix rounds (reverify_count = 2). Docs (`architecture.md` runbook, `security.md`, `INDEX.md`) were updated in each round.

## Remaining issues
| # | Severity | Issue | Status |
|---|---|---|---|
| W10 | warning | Existing password accounts unverified (stage-2 reach) | deferred (product); runbook step 6 measures it |
| W11 | warning | No retention for `email_messages` / `account_tokens` | deferred (separate task + D14) |
| W12 | warning | No alerting | deferred (ops); SQL check in the runbook |
| C3-1 | info | 8 s wait < 10 s single-send timeout | fixable (wait ~15 s) |
| C3-2 | info | Legacy >72 B passwords → 400 at login | note for CHANGELOG/runbook |
| — | info | Webhook replay memory is single-instance; replay prune is a full scan; httpx client per mail; ADR-009 not replaced | accepted / later |

## Recommendations
1. Stage 1 (`EMAIL_ENABLED=true`): follow the runbook, including the proxy check, DNS, the seed test and the 429 / log checks.
2. Before stage 2: the step-6 query (verified share), retention in the privacy policy, a simple alert.
3. Optional: raise the shutdown wait to about 15 s (C3-1); add a CHANGELOG line about 72 B passwords (C3-2); write the ADR that replaces ADR-009.

## Verification checklist
- [x] All 6 checks ran, plus 2 fix rounds and re-checks; every report is on disk (`*-reverify*.md`, Re-verification sections).
- [x] Final verdict: plan 100%, tests 0 regressions, 0 critical, warnings deferred by decision → **Passed with Issues**.
- [x] Roadmap: none (`.maister/docs/project/roadmap.md` does not exist).
