# Workflow Summary: Owner items page, participants preview, event item reservations

## TL;DR
All 3 user requests are delivered and verified, along with the organizer "recently added" block:
- a public owner items page;
- a 3-newest "Zapisani i ich rzeczy" preview with context links;
- a public item page with Weź / Zamienię / Napisz / Zapisz się;
- full item reservation on events.

Verification passed with issues: 0 critical issues, 9 of 10 warnings fixed, and W10 (platform-wide rate limiting) left open. E2E: 6/6 journeys pass. Backend tests: 1028/1028. Frontend tests: 1295/1308; all 13 failures also fail on a clean HEAD. All new files, migration 0073 included, are untracked and must be committed together.

## Key Decisions
- Reservations point to a Term XOR an Event (migration 0073, CHECK constraint, `event_id ON DELETE SET NULL`). A guarded downgrade was added, with a runbook in `architecture.md`.
- A `ReservationContext` (Term | Event) in groups gives one take/propose/accept/confirm path. Each use case commits once, for terms as well as events.
- Event reservations stay open until `starts_at`; confirm/cancel happen after it. Withdrawing from the event does not cancel. Deleting the event before `starts_at` cancels and notifies (`RESERVATION_CANCELLED`); after `starts_at` it returns 409; it stays blocked while anyone is signed up.
- The item page is public for ACTIVE items. Owner identity is public, but a party with no listed items returns 404. Chat is the per-item ITEM conversation.
- Owner URLs use the party id. A party-id URL for an organization owner redirects to its slug. `display_name` is the Organization name when one exists.

## Open Questions / Risks
- W10: the new anonymous endpoints have no rate limiting. This is a platform-wide follow-up, related to W8.
- Known E2E items, left on purpose:
  - date chips are missing on `/items` when the page context is not the owner's nearest date;
  - an owner whose only item is in a swap gets a 404;
  - there is no mode chip on the item page;
  - the delete dialog is centred instead of a bottom sheet.
- 13 frontend test failures predate this task: auth, extension-points, foundation, PublicLayout, AppPage add-term, PendingActionsHost GIFT, TermPage sign-up. They need a separate task.
- Rollback becomes forward-only once event reservations exist. Keep the pre-0073 DB dump.
- The local dev DB is now at 0073 and contains throwaway E2E data (`e2e-1793463574-*@example.test`, org `e2e-wymiana-1793463574`).

## Phases
| Phase | Result |
|---|---|
| 1 Codebase analysis | done (4 Explore agents + reporter; 4 clarifications) |
| 2 Gap analysis | done (14 scope decisions) |
| 3 TDD red | skipped (no reproducible defect) |
| 4 Mockups | done (11 screens + 2 components, HTML) |
| 5 Spec | done (35 requirements; new `RESERVATION_CANCELLED` kind) |
| 6 Spec audit | FAIL (1C/3H/7M/8L), all resolved in spec revision |
| 7 Plan | done (18 groups / 105 steps / 5 waves) |
| 8 Implementation | done (18/18; organizer query budget 10→11) |
| 9 TDD green | skipped (Phase 3 not run) |
| 10 Verification options | all reviews + E2E + docs |
| 11 Verification | passed with issues; W1–W9 fixed; W10 open; full re-verification skipped by user |
| 12 E2E | GO with caveats (13/13 scenarios, 2 minor + 4 cosmetic) |
| 13 User docs | done (documentation/user-guide.md, 17 screenshots) |
| 14 Finalization | done |

## Artifacts
- `analysis/`:
  - codebase-analysis, clarifications, gap-analysis, scope-clarifications, technical-clarifications, requirements;
  - design-context (INDEX, design-resources, mockups).
- `implementation/`: spec (.md/.html), implementation-plan (.md/.html), visual-coverage, work-log.
- `verification/`:
  - spec-audit, test-suite-results, completeness-report, code-review-report, pragmatic-review, production-readiness-report, reality-check;
  - implementation-verification (.md/.html), e2e-verification-report (.md/.html), visual-fidelity (.md/.html), screenshots.
- `documentation/`: user-guide.md and screenshots.

All artifacts declared in state exist on disk (reconciled at finalization).

## Next Steps
1. Review the diff (129 changed or untracked paths). Then commit everything together, including the untracked new modules, the tests and `0073_event_reservations.py`.
2. Before deploying:
   - take a DB dump;
   - deploy backend and frontend together (backend first is safe);
   - after deploy, verify `alembic current` = 0073 and `import app.main`.
3. Follow-ups:
   - W10 rate limiting;
   - the 13 pre-existing frontend test failures;
   - optionally, the E2E minor/cosmetic items;
   - optionally, a `term-item-listings/mine` event-reservation test;
   - optionally, a configurable `AuthGateSheet`.
