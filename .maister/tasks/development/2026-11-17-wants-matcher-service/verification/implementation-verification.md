# Implementation Verification: Wants matcher service (MATCH / SUGGESTION)

## TL;DR
**Verdict after 2 fix rounds: ❌ Failed on the deployment blocker only. The code passes with minor issues.** The one critical item is the 0099 release gate (labelled sample of ≥200 pairs not scored). It blocks deploy by design and cannot be fixed in code.
- Plan 83/83. Tests: backend 1518 passed, matcher 95 passed, frontend 1852 passed. 0 regressions; the backend 2 and frontend 33 failures are pre-existing, plus 1 frontend flake that passes in isolation.
- Of the 13 original warnings, 10 are fixed (W1–W6, W8–W11) and 3 were accepted by the user (W7 follow-up, W12, W13). The round-1 regression N1 is fixed in round 2.
- What remains is info-level only, plus one accepted burst limit.

## Open Questions / Risks
- **Release gate (C1):** still open. No deploy until the labelled Polish sample is scored and `rules.py` and the stemmer are tuned. While 0099 is unreleased, changes go by amending 0099.
- **Accepted burst limit:** more than about 1,000–1,200 listings created within 2 real minutes can time out one window run, and that run then repeats until someone intervenes. The sweep keeps working. The signal is a repeated `window run failed` ERROR with the same `start`. This is a follow-up.
- **Accepted follow-up W7:** the bells handler sends one statement per seeker, about 3 s per 1000-pair row.
- **Not yet checked live:** the SUGGESTION tier on the stack (the running image predates the fixes) and visual fidelity. Both are pending Phase 12 E2E.

## Executive Summary
All 11 task groups are implemented, and the compose smoke test passed end to end on the rebuilt dev DB. Verification found no critical code defects and no security issues. Two fix rounds addressed the matcher's operational gaps: the window is now bounded and burst-safe, the sweep runs in its own transaction, shutdown is clean, there is a restart policy, and FAILED outbox rows are logged. They also fixed the suggestion-cap staleness, the lock order in `update_want`, and the docs. Each fix round was re-verified.

## Implementation Plan Verification
83/83 steps (94 checkboxes including headers). Every group was spot-checked in code. The work-log has entries for every group, the completion entry, both fix rounds, and the user decisions (H1, window cost, dev-DB rebuild, fix scopes, burst limit).

## Test Suite Results
| Run | Backend | Matcher | Frontend | Static |
|---|---|---|---|---|
| Initial | 1515 passed / 2 failed | 81 passed | 1853 passed / 33 failed | mypy 15, ruff 65, typecheck 0, lint 38 |
| After round 1 | 1518 passed / 2 failed | 86 passed | 1852 passed / 34 failed (33 + 1 flake) | ruff 66 → fixed back to 65 |
| After round 2 (matcher only) | — (unchanged) | 95 passed, ruff, format and mypy strict clean | — (unchanged) | — |

Every backend and frontend failure is pre-existing; the 2 backend failures were confirmed at HEAD in a worktree. The flake (`DeleteGroupDialog` focus) passes 3/3 in isolation and is outside the diff. Details: `test-suite-results.md`, `test-suite-results-reverify.md`.

## Standards Compliance
19 of 19 applicable standards are followed. The W-1 gap is closed: the matcher is documented in `tech-stack.md` and in the INDEX Tech Stack line.

## Documentation Completeness
Complete. Spec revision 3 describes the post-fix behaviour (FR-BE-01, FR-MT-05, FR-MT-10, FR-MR-03). `architecture.md` covers the Wants section, the matcher service, the runbook steps 1–10 and the cost table. `INDEX.md`, `tech-stack.md`, the three standards and `src/matcher/README.md` are updated. No dead references remain.

## Optional Reviews
| Review | Initial | Re-verification |
|---|---|---|
| Code review | 0 critical / 2 warning / 11 info | Round 1: W2–W6 resolved, W1 partial, new N1. Round 2: N1, N2 and N4 resolved, 0 warnings, 2 info |
| Pragmatic review | appropriate, 0 / 3 / 7 | Not re-run. Its warnings were docs-only (W8–W10), and the completeness re-check confirmed them |
| Production readiness | NO-GO 68/100, 1 / 7 / 7 | NO-GO 80/100 for B1 only. GO with mitigations once the gate passes |
| Reality check | ~90%, 0 / 2 / 5 | ~95%. W1 (cap) resolved; W2 (window) partial and then fixed in round 2 |
| Completeness | passed with issues, 0 / 1 / 9 | passed with issues. R-1–R-5 fixed in round 2; R-2 (work-log) written |

Security: no SQL injection, no PRIVATE visibility leak, no secrets in logs or images.

## Visual Fidelity
Pending: `verification/visual-fidelity.md` will be written by the Phase 12 E2E verifier. Group 8 noted two deviations of its own: the slow-card heading is h2 instead of h3, and stored matches are shown under the slow card.

## Fix & Re-Verification History
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 window unbounded, single transaction | R1: sweep in its own transaction, `WINDOW_MAX_LISTINGS = 300`, marker moves to `end`, capped runs back to back. R2: `window_start` limits the overlap to 2 min before the previous run's clock | Resolved. Burst and tie tests pass; the review gave an induction proof that no listing is skipped |
| W2 suggestion cap counts stale rows | Counts only items still in `matchable_listings` | Resolved (the test fails on the old SQL). Info N3 remains: private-group visibility and reserved items |
| W3 lock held during the classifier | Unlocked checks, then the lock and an `updated_at` check (409); matches deleted under the lock | Resolved. +2 concurrency tests |
| W4 no restart policy | `restart: unless-stopped`; no healthcheck, which is documented | Resolved. A hung process is still not detected (info) |
| W5 no SIGTERM handler | Handlers with a Windows fallback, pool close within 5 s, exit 0 | Resolved. Portable test |
| W6 FAILED bells rows silent | The dispatcher logs one ERROR, "FAILED after N attempts" | Resolved. caplog test; monitoring grep in the runbook |
| W8–W11 docs | 4-char rule mirrors 0099 (amend while unreleased, then a new revision); matcher commands and README; matcher-suite rule; tech-stack | Resolved |
| R1 regression: ruff E501 in the `writes.py` comment | Comment shortened | Resolved (ruff 65) |
| R1 regression: wrong comment about expiry and `updated_at` | Corrected | Resolved |
| N1 (from R1) overlap not counted in the cap | `window_start(marker, previous_run_at)` | Resolved |
| N2 unlock masks the error | `_unlock()` logs at DEBUG and never raises | Resolved |
| N4 marker `updated_at` = past end | `updated_at` = run's now, `scanned_through` = end | Resolved |
| R-1, R-3–R-5 spec and doc drift | Spec rev 3, doc fixes | Resolved |

## Remaining Issues
### Critical
| # | Issue | Fixable |
|---|---|---|
| C1 | 0099 release gate not scored | no (process) |

### Warning (accepted by the user)
- W7: the bells handler sends one statement per seeker (follow-up).
- W12: lossy rollback with no image-only path (acceptable while unreleased).
- W13: superuser DSN (Phase 1 decision: same login `aj`).

### Info
- N3: the cap keeps a slot for a suggestion from a private group the seeker has left, and frees one for a reserved item that `/suggestions` may still show. Its count runs per candidate row.
- N5: `update_want` is about 73 lines.
- Round-2 I1: a marker written by the old backend ORM scan would shorten the first overlap. This does not apply: 0099 was never deployed, and the dev DB's marker table was recreated during the downgrade and upgrade.
- Round-2 I2: no integration test for a capped run that ends near its own clock followed by a late commit. The unit table covers that case.
- From the initial reviews: the window does not skip flagged wants (a millisecond race), `LC_CTYPE` is not checked at startup, the backoff map is never evicted, the outage traceback is logged every 10 s, the Dockerfile pins no uv version and runs as root, the page polls 4 endpoints while matching, there are several `role="status"` badges, `reservedCaption` and `SUGGESTIONS_LIMIT` are duplicated, there are tombstone tests, the module is named `requests.py`, and reconnect uses a fixed 10 s.
- Smoke-test data is still in the dev DB (2 `smoke-*@example.com` users, 1 product, 1 listed item).

## Overall Assessment
| Area | Result |
|---|---|
| Implementation | ✅ 100% |
| Tests | ✅ 99%, 0 regressions |
| Standards | ✅ 19/19 |
| Documentation | ✅ complete (spec rev 3) |
| Code review | ✅ 0 critical / 0 open warnings |
| Pragmatic | ✅ appropriate |
| Production | ❌ NO-GO (release gate only), 80/100 |
| Reality | ✅ ~95%, no critical gaps |

## Recommendations
1. Score the release-gate sample before any deploy, then set the `rules.py` and stemmer values by amending 0099.
2. Phase 12: rebuild the stack image (the running matcher predates the fixes), then run E2E for the five screens and a live SUGGESTION.
3. Follow-ups: batch the bells handler (W7), alert on a stalled marker `updated_at` or on repeated `window run failed`, and decide on the N3 visibility case.

## Verification Checklist
- [x] Completeness checker (initial + re-check)
- [x] Test suite (initial + after round 1; matcher after round 2)
- [x] Code review (initial + round 1 + round 2)
- [x] Pragmatic review (initial)
- [x] Production readiness (initial + re-check)
- [x] Reality check (initial + re-check)
- [ ] Visual fidelity (Phase 12)
