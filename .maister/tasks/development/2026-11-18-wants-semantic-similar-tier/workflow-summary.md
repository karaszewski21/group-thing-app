# Workflow Summary: semantic SIMILAR tier („Powiązane rzeczy”)

## TL;DR
- The semantic SIMILAR tier is implemented end to end: pgvector (0100) and the vector side tables (0101), an int8 mmlw-roberta-base embedder in the API, sync writers with outbox retry and reconcile, the matcher's SIMILAR tier (born seen, no bell, cap 10, upgraded in place by a later lexical hit), `GET /api/wants/{id}/similar`, and the „Powiązane rzeczy” UI.
- Tests are at baseline with 0 regressions: backend 1577, matcher 125, frontend 1873. Code review is clean. E2E passed 9 of 9, and visual fidelity matched on 5 of 5 screens.
- Verdict: ❌ Failed only on operational gates. The **shadow deploy (steps 1–7) is GO with mitigations**; the **web release (step 8) is NO-GO until the labelled-sample gate passes**.
- Nothing is committed; all work is left uncommitted.

## Key Decisions
- Architecture follows research ADR-001..009: a DB contract, the embedder in the API, halfvec side tables, exact scan, and the bell-less SIMILAR tier.
- Phase decisions:
  - SIMILAR is excluded from `list_wants(matched_item_id)`.
  - The APScheduler reconcile job runs every minute.
  - `EMBEDDING_MODEL_ID` is pinned in 3 places, with a drift test.
  - The backfill drains before the matcher deploys.
  - A SIMILAR-only background re-trigger uses `similar_requested_at`.
- Verification decisions:
  - A SIMILAR row is **upgraded in place** to MATCH or SUGGESTION, which reverses ADR-002's "never upgraded".
  - MatMul-only int8, because plain QInt8 failed the parity gate.
  - Reconcile batch of 8 with a 2 s timeout.
  - The release gate moved to before step 8 (web).

## Open Questions / Risks
- C1: the labelled-sample gate (≥300 pairs) still sets `SEMANTIC_SIMILARITY_MIN`. The current 0.86 is provisional.
- C2: the full image build with `hf_token` (runbook step 1).
- W15: measure VPS A (step 1b).
- Thin parity margin: 0.9904 against the 0.99 floor. Parity under the runtime's onnxruntime 1.30.0 has not been checked.
- The base 0099 release status is unconfirmed.
- The runbook's owner sign-off for the gate rescope is still to be recorded.

## Phases
| Phase | Result |
|---|---|
| 1 Codebase analysis | done: 4 Explore agents + reporter |
| 2 Gap analysis | done: 1 critical + 6 important decisions |
| 3 TDD red | skipped (no defect) |
| 4 UI mockups | done: 3 screens, 2 components |
| 5 Specification | done: 26 requirements |
| 6 Spec audit | pass-with-concerns: H1 + 6 M, fixed in the spec |
| 7 Planning | done: 13 groups, 89 steps |
| 8 Implementation | done: 5 waves, 1 cross-group fix |
| 9 TDD green | skipped |
| 10 Verification options | all reviews + E2E + docs |
| 11 Verification | 2 fix cycles, 46 findings resolved; operational gates remain |
| 12 E2E | GO, 9/9; fidelity 5/5 |
| 13 User docs | Polish guide, 5 screenshots |
| 14 Finalization | this summary |

## Artifacts
All artifacts declared in `orchestrator-state.yml` exist on disk; none are missing.

The main ones:
- `implementation/spec.md` + `.html`
- `implementation/implementation-plan.md` + `.html`
- `implementation/work-log.md`
- `verification/implementation-verification.md` + `.html`
- `verification/e2e-verification-report.md` + `.html`
- `verification/visual-fidelity.md` + `.html`
- `documentation/user-guide.md`

## Follow-ups
1. Operator steps before the shadow deploy are listed in `verification/implementation-verification.md`: sign-off, 0099 status, image tags, full build, step 1b, the never-up rule.
2. `/maister:standards-update` (W13):
   - the testing standard image becomes `pgvector/pgvector:0.8.7-pg18-trixie`;
   - the side-table carve-out goes into `models.md`/`migrations.md`;
   - a new standard: "every int8 quantization step is followed by a parity gate in the same RUN, with a recorded weight hash".
3. Optional info items: embedder warm-up; reading the `/similar` fallback key from the `queryFn` context.
4. Re-capture the user-guide screenshots without the dev overlay if publishing.
5. Out of scope, noticed in passing:
   - Next 16.4.4 has a security advisory;
   - other features' migration tests do not check the `alembic upgrade` return code;
   - the backend has no `restart:` policy.
