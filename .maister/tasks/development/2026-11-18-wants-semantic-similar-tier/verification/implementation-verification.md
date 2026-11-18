# Implementation Verification: semantic SIMILAR tier (after re-verification cycle 2)

## TL;DR
- **Verdict: ❌ Failed. The only blockers left are operational deployment gates; there are no code defects.**
  - **Shadow deploy (runbook steps 1–7): GO with mitigations.** It needs C2, a full image build with `hf_token`, plus the operator steps listed below.
  - **Full release (step 8, web): NO-GO** until C1, the labelled-sample gate, is done. It is now scoped to "before step 8".
- **Code:** code review is clean (0 critical, 0 warnings, 3 optional info items). Pragmatic review is appropriate. Reality check shows H1/M1/M2 resolved. All 89 of 89 steps are done.
- **Tests (cycle 2, current tree):** at baseline with 0 regressions.
  - backend: 1577 passed, 2 failed (both known), 1 skipped
  - matcher: 125 passed
  - frontend: 33 known failures
  - ruff 65, mypy 15, typecheck 0, lint 38
- **Remaining issues:** 2 critical (operational), 2 warning (W13 deferred, W15 operational), 10 info. Two fix cycles resolved 46 findings.

## Open Questions / Risks
- **Base 0099 release status unconfirmed.** Production must be confirmed to run 0099 with wants live, or the 0099 per-word gate (≥200 pairs) must have passed. Otherwise the shadow deploy also ships the per-word tier and its MATCH bells.
- **Parity margin.** Parity is 0.9904 against a 0.99 floor. The model is quantized with onnxruntime 1.32.0, but the runtime infers with 1.30.0, and runtime parity has not been measured.
- **No embedder warm-up.** The first reconcile batch may exceed the 2 s budget and log `busy`/`timeout` WARNINGs after a deploy (retry path covers it).
- **Release gate sign-off.** The owner's sign-off for moving the gate before step 8 must be recorded in the release notes before step 1.
- **Uncommitted tree.** The working tree is uncommitted. Build from exactly the verified tree.

## Executive summary
Two fix-and-reverify cycles closed every fixable finding:
- the lost-bell defect (W1, a SIMILAR row upgraded in place)
- the page-breaking `/similar` failure, now kept, with previous data on poll failure
- embedding under row locks
- reconcile starvation and worker sharing
- a lock-order deadlock (N1)
- an unpinned build stage
- the matcher parameter coupling
- the runbook gaps: threshold change, image tags, never-up rule, `--no-build`, re-flags, and the gate rescope

The verdict stays Failed only because the production-readiness criteria still list the operational release gates.

## Implementation plan verification
89 of 89 steps are done. The fixes are logged in `implementation/work-log.md`, under "Verification fixes" cycles 1 and 2. The completeness re-check passed with issues. The only warning is W13, which was deferred.

## Test suite (cycle 2, `verification/test-suite-results.md`)
| Suite | Result | Baseline |
|---|---|---|
| backend (alone, head 0101) | 1577 passed, 2 failed, 1 skipped | 2 failed (same) |
| matcher | 125 passed | — |
| frontend | 1873 passed, 33 failed | 33 failed (identical ids) |
| ruff / mypy / typecheck / lint | 65 / 15 / 0 / 38 | same |

## Standards compliance
Mostly compliant. W13 is deferred to `/maister:standards-update`: the `postgres:18` image in `backend-testing.md`, and the side-table carve-out in `models.md`/`migrations.md`.

## Documentation completeness
Complete. The runbook covers:
- gate before step 8 with sign-off
- 7b sweep and 7c threshold change
- `pre-semantic` tags
- never `up` between steps 1 and 4.2
- `--no-build` on the shadow `up` steps
- rollback re-flags
- stale-pair note
- collation checks
- web freeze

Spec R11/R12/R13/R26 and ADR-002 are amended.

## Optional reviews (latest)
| Review | Status | Report |
|---|---|---|
| Code review | clean: 0 critical, 0 warning, 3 info | `code-review-reverify2.md` |
| Pragmatic review | appropriate; R1/N1/L5 resolved in cycle 2 | `pragmatic-reverify.md` (+ cycle-2 fixes) |
| Production readiness | shadow GO with mitigations; full release NO-GO (C1) | `production-readiness-reverify2.md` |
| Reality check | ready for shadow; H1/M1/M2 resolved | `reality-reverify.md` |
| Completeness | passed with issues (W13 deferred) | `completeness-reverify.md` |

## Visual fidelity
Comes in Phase 12 (E2E).

## Remaining issues
| ID | Sev | Source | Issue | Fixable |
|---|---|---|---|---|
| C1 | critical | production | Labelled-sample release gate (≥300 pairs) not run; 0.86 provisional. Blocks step 8 (web) only. Owner sign-off on the rescope still to be recorded | no (operational) |
| C2 | critical | production | Full image not yet built with `hf_token` (runbook step 1). Blocks the shadow deploy until step 1 passes: parity ≥ 0.99, sha256 line, `model_id.txt` | no (operator) |
| W15 | warning | production | VPS A measurement (step 1b) not run | no (operator) |
| W13 | warning | completeness | Standards update deferred | deferred |
| P-1 | info | production | Base 0099 release status unconfirmed | no (operator check) |
| P-2 | info | production | Runtime-ORT (1.30.0) parity unchecked; margin +0.0004 | partly (run parity script in the runtime container) |
| CR-C1 | info | code | No embedder warm-up under the 2 s reconcile budget | yes (optional) |
| CR-C2 | info | code | `/similar` fallback reads the cache via the closure key, not the `queryFn` context | yes (optional) |
| CR-C3 | info | code | Kept `similar` can briefly outlive an edit when `/similar` fails | no (accepted) |
| CR-I6/I9/I10 | info | code | client-disconnect stuck marking; tile style shared with suggestions; reconcile queries during backfill | no (accepted) |
| P-L6 | info | pragmatic | Test files have 10–16 tests | no (accepted) |
| TS-1 | info | test suite | Other features' migration tests don't check the upgrade return code (load-sensitive) | out of scope |
| P-R1-rest | info | pragmatic | Window end still `$6`/`$8` | no (accepted) |
| P-3 | info | production | Backend has no `restart:` policy (pre-existing; runbook recovery covers it) | out of scope |

## Fix & Re-Verification History
| Cycle | Issue | Fix | Outcome |
|---|---|---|---|
| 1 | W1 lost bell after re-point | Lexical tiers skip only lexical rows; `ON CONFLICT … DO UPDATE … WHERE tier='SIMILAR'` | ✓ resolved (probe v2 + 3 tests) |
| 1 | W2 `/similar` breaks page | Fallback to `NO_SIMILAR` | ✓ resolved |
| 1 | W3 unpinned build | Pins + `model.sha256` (deterministic hash 4552576b…1e08) | ✓ resolved |
| 1 | W4 embed under lock | Embed → lock → re-check → upsert | ✓ resolved |
| 1 | W5 writes behind reconcile | Batch 8 | ✓ resolved |
| 1 | W6 shared try | `_reconcile_side` | ✓ resolved |
| 1 | W7 param layout | Fixed `$1–$5`, SIMILAR `$6/$7` | ✓ resolved |
| 1 | W8 module drift | Aligned | ✓ resolved |
| 1 | W9/W10/W14/W16/W17 runbook | Re-flags, two-step flag flip, collation, web freeze | ✓ resolved |
| 1 | W11 0102 refs, W12 stale evidence | Removed; suites re-run | ✓ resolved |
| 1 | I1/I3/I4/I5, P-L1..L4, S1 | `now` after embed, docstrings, non-finite miss, always-on 0101 check, cleanups | ✓ resolved |
| 2 | N1 lock-order deadlock | `flush()` before vector write + statement-order test | ✓ resolved |
| 2 | R-N1 threshold change | Runbook 7b/7c (delete below new min, re-flag) | ✓ resolved |
| 2 | R-N2 old images | `pre-semantic` tags, never-up rule | ✓ resolved |
| 2 | RR-1 rollback re-flag | Added | ✓ resolved |
| 2 | CR-N3/N4/N5/N7, CR-I2 | Tests, 2 s timeout, keep previous similar, expiry re-check, stale-pair doc | ✓ resolved |
| 2 | P-R1/N1/L5 | Frozen `Statement`, shared `ReconcileResult`, parity-name dedup | ✓ resolved |
| 2 | D-N1/N3 spec/ADR drift | Amended | ✓ resolved |
| 2 | PR2-N3 `--no-build` | Added to steps 4.3 and 6 | ✓ resolved |
| — | C1 gate | Rescoped to before step 8 (user decision) | residual (operational) |
| — | C2, W15 | — | residual (operator) |
| — | W13 | — | residual-deferred |

Re-verification count: 2.

## Operator steps before the shadow deploy
1. Record the owner's gate-rescope sign-off in the release notes.
2. Confirm the base 0099 status.
3. Build from the verified tree.
4. Start the web freeze.
5. Run `docker tag … backend:pre-semantic`.
6. Step 1: `docker compose build backend` with `HF_TOKEN` present (check presence only). Confirm:
   - parity ≥ 0.99
   - the sha256 line is printed
   - `model_id.txt` matches the expected model id
7. Step 1b on VPS A.
8. Steps 2–7, following the never-up rule. Tag the matcher before step 6.

## Verification checklist
- [x] Test suite re-run, cycle 2, sequential
- [x] Code review and production re-checks, cycle 2. Side reports are on disk.
- [x] Canonical report rewritten with the post-fix verdict and the full fix history
