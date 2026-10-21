# Implementation Verification — Join a PRIVATE group by access code

## TL;DR
**Final verdict: ⚠️ Passed with Issues** (re-verification cycle 3 of 3). The initial verdict was ❌ Failed because of B1.
- **Remaining:** 0 critical issues and 1 warning. The warning is W1, which we accepted (follow-up OQ-8). There are about 13 info items. Two of them are new and edge-case: I19 (`redeemStarted` is not scoped to the group) and I20 (two redeems running at once share a storage key).
- **Production readiness:** GO (94%). The join code never appears in a URL or in a log. It survives a 401 because it is now written to storage before the redeem.
- **Pragmatic review:** ✅ appropriate.
- **Tests:** the backend passes 860/860. The frontend passes 1015/1022 with no regressions: the 6 failures already failed before this change, and 1 test is flaky in a file this task does not touch.

## Open Questions / Risks
- **W1 (accepted, OQ-8):** two concurrent redeems can create duplicate memberships.
- **SC1/SC7 have no runtime evidence yet.** Phase 12 E2E needs to run steps (a)–(i) plus a new step (j): open a second link while a 409 sheet is showing.
- **I19 and I20:** narrow edge cases that are fixable, and none of them leaks the code. I19 is in-app navigation between groups after a redeem. I20 is two links opened within one request.
- **I18 and G5 (accepted by design and written into the spec):** a profile-less account re-sends the code after each login. A restored code is redeemed by whoever logs in next in that tab, within 1 hour.
- **Pre-existing problems:**
  - 6 frontend tests fail, including the `Imię` label test.
  - The project has lint and ruff debt.
  - The health check only reports liveness.

## Executive Summary
Both fix cycles resolved every selected issue. The cycle-2 changes are proportionate (pragmatic review), correct (code review) and keep B1 closed (production readiness). What remains is one accepted design residual plus low or info items, and two of those are cheap pre-merge polish (G2, G4).

## Implementation Plan Verification
62/62 steps complete. The R31 gate returns nothing with the spec's command. The amendments are reflected in the code and spec. The implementation-plan text for Groups 6/7 still describes `?code=` (info).

## Test Suite (test-suite-results.md, cycle 2)
| Suite | Cycle 2 | Cycle 1 | Initial |
|---|---|---|---|
| Backend | 860 / 860 | 860 / 860 | 859 / 859 |
| Frontend | 1014 / 1021 (6 pre-existing + 1 flaky) | 1010 / 1017 | 1007 / 1014 |
| Regressions | 0 | 0 | 0 |
| tsc / mypy | clean / 23 | clean / 23 | clean / 23 |

T1 was stable over 3 consecutive TermPage runs.

## Standards Compliance
19/19 applicable standards are followed. Info nits remain: sr-only separator, hard-coded `#12604D`, one 135-character comment.

## Documentation
Adequate:
- The ADR-005/008 superseded notes are in place.
- Spec SC1/SC6 and the R18/22/24/26 pointers are updated.
- The user guide is updated.

Info:
- The plan text for Groups 6/7 is still stale.
- The spec amendments do not cover the 401/TTL behaviour (G4).

## Optional Reviews (cycle 2)
| Review | Status | Critical | Warning | Info |
|---|---|---|---|---|
| Code review | issues found | 0 | 1 (W1, accepted) | 2 new (I17, I18) + carried |
| Pragmatic review | ✅ appropriate | 0 | 0 | 4 + 3 residual-optional |
| Production readiness | ✅ GO with mitigations (93%) | 0 | 0 | 3 |
| Reality check | ⚠️ gaps, none blocking (~97%) | 0 | 1 (SC1 → Phase 12) | 6 |
| Completeness | passed with issues | 0 | 0 | 6 |

## Issues Requiring Attention
### Warning
1. **W1 [code_review]:** duplicate active memberships on concurrent redeem. `join_code.py:150-158`. Accepted residual (OQ-8). Not fixable without a design change.

### Info (selected, all fixable unless noted)
- **G2:** add `key` to `<JoinByCodeSheet>` (`PrivateGroupGate.tsx:113-118`) and a hash-only-change test.
- **G4/G5:** add a spec amendment bullet covering the 401 restore, `signedOut`, the 1h TTL and the "next login redeems" note.
- **I17:** write the pending code before `joinWithCode` and remove it on any result other than 401 (`TermPage.tsx:94-99`).
- **I18:** an account with no profile re-redeems after each login. Optional "retried once" marker. Not fixable in practice; record only.
- **C2-3:** small simplification of `readPendingCode`.
- **signedOut test:** test the `signedOut` guard across a re-render.
- **Plan text:** add an amendment pointer to the plan for Groups 6/7.
- **Carried:** `mcp:read` can read the code; the limiter has no idle-key sweep; PUBLIC→PRIVATE revives the old code; toast markup is duplicated; R1/R3/R4 optional simplifications.

## Fix & Re-Verification History
### Cycle 1 (after the initial ❌ Failed)
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| B1 (critical): code in access logs | `#code=` fragment; sessionStorage across login; `returnTo` without hash | **Resolved**: production GO |
| Validation alert while typing | `touched` flag | **Resolved** |
| `useJoinCode` shape | `idle`; no `error` | **Resolved** |
| regenerate extra GET | `setQueryData` | **Resolved** |
| `?code=` triple guard | immediate strip | **Resolved** |
| Gate prop pass-through | `codeSheet` prop | **Resolved** |
| Migration test importlib | literals + gate exclusion | **Resolved** |
| Rollback note / audit logging | 0060 docstring; redeem/blocked logs without the code | **Resolved** |
| DTO key sets / user guide | exact key sets; guide l.58/99/240 | **Resolved** |
| W1 duplicate memberships | not fixed (user decision) | Residual (OQ-8) |

### Cycle 2 (after cycle 1 ⚠️)
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| T1 flaky stale-link assertion | `waitFor` on 3 hash assertions | **Resolved**: 3/3 stable runs |
| I13 code lost on 401 mid-redeem | write back to sessionStorage on 401 (`{cause}` in `useTermAccess`); `signedOut` guard | **Resolved**: code review, production, reality |
| I15 pending code lives for the whole tab | `{code, savedAt}` with 1h TTL | **Resolved** |
| I14 no storage/StrictMode tests | blocked-storage test + StrictMode test | **Resolved** |
| I16 ADR drift; SC1/SC6 wording | superseded notes; spec wording | **Resolved** |

### Cycle 3 (after cycle 2 ⚠️)
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| G2: second link while the sheet is open showed the old code | `key={codeSheet.initialCode}` plus a test | **Resolved** (code review, reality check) |
| I17: the 401 write-back raced the redirect | Write `{code, savedAt}` before the redeem; remove it on any result other than a 401; `redeemStarted` replaces `signedOut` | **Resolved**: the outcome no longer depends on when the redirect happens |
| G4/G5: spec amendments incomplete | Extended the amendment bullet (TTL, write-before, guard, G5/I18, key); added a plan pointer | **Resolved** (completeness) |
| I18 | Not fixed; accepted in the spec | Accepted by design |

**Cycle 3 checks:**
- Completeness: 0 critical, 0 warnings, 4 info.
- Code review: 0 critical, 1 warning (W1), 13 info (new: I19, I20).
- Pragmatic review: ✅ appropriate.
- Production readiness: GO 94%.
- Reality check: gaps found, none blocking.

## Overall Assessment
| Area | Result |
|---|---|
| Implementation | 100% |
| Tests | backend 100%; frontend no regressions (1 unrelated flaky test) |
| Standards | compliant (info nits) |
| Production readiness | ✅ GO (94%) |
| **Overall** | **⚠️ Passed with Issues**: no blockers |

## Recommendations
1. **Before merge (cheap):** G2 (sheet `key` + test), G4 (spec bullet). Optionally I17 (write before redeem).
2. **Phase 12 E2E:**
   - two-account SC1, including step (i): a real 401 → reload → login → exactly one redeem
   - confirm the access logs contain no code
3. **Follow-ups:**
   - OQ-8 unique index
   - clear `join_code` when a group becomes PUBLIC
   - panel copy-link should include the code
   - shared ToastPill
   - OrganizerEditor flaky tests
   - the pre-existing `Imię` label test

## Verification Checklist
- [x] Completeness, test suite, code review, pragmatic, production readiness, reality: all cycle-2 reports on disk
- [x] Canonical report reflects the latest (cycle 2) verdict
