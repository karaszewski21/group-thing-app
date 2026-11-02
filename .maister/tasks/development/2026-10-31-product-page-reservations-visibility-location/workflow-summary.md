# Workflow Summary: Product page reservations, item visibility, physical & suggested location, reserved badges

## TL;DR
- The product page is now the only place to reserve an item. It offers three actions: Odbiorę osobiście, Wybieram termin and chat. A personal pickup is a reservation with no term or event attached.
- Tiles show an intent badge and a "zarezerwowana" badge and link to the product page. Each owner's inventory has a pickup place, and items can be PUBLIC or PRIVATE.
- Verification passed after two fix rounds. E2E passed all 12 scenarios, and the defects it found are fixed.
- Backend: 1121 tests passed. Frontend: 1351 passed, plus 13 failures that already existed before this work. mypy is at its baseline and tsc is clean.
- Nothing is committed yet. The work is on branch `feat/product-page-reservations`, based on `bf55353`.

## Key Decisions
- `ReservationContext` = `TermContext | EventContext | PersonalContext`. Migration 0074 relaxes `ck_reservations_context`. This means "pickup without a term" was brought into scope.
- One write endpoint, `POST /api/items/{id}/take|propose` with `context {kind, id?}`. The old term and event routes were removed.
- The pickup place lives on the owner's PERSONAL inventory (0075). Others see only its name; the address is never shared by the system.
- Visibility lives on `item_listing_preferences` (0076). Selects are safe by default, and a 404 gate applies everywhere.
- On a private circle, an item is PRIVATE-visible only if its owner is a member or organizer of that circle. An RSVP alone does not count.
- Every logged-in viewer sees who reserved an item; anonymous viewers do not. A pending swap proposal counts as reserved and blocks the item.
- Personalised public GETs send `private, no-store` and `Vary: Authorization`. Anonymous visitors get a 60 s shared cache, which the user accepted.

## Open Questions / Risks
- Infra: does the production CDN honour `Vary`? Is `index.html` served with `no-cache`?
- Before any downgrade or image-only rollback, run both guard counts from the 0074–0077 runbook in `architecture.md`.
- When the owner is an organization, the button copy reads awkwardly ("Rezerwuję i piszę do Wymianki u Ani").
- `.playwright-mcp/` in the repo root is not in `.gitignore`.
- Not covered by E2E: the positive path where a member of a private circle sees a PRIVATE item, and EVENT contexts.

## Phases
| Phase | Result |
|---|---|
| 1 Codebase analysis and clarifications | done; 4 decisions |
| 2 Gap analysis | done; 7 critical and 10 important decisions resolved |
| 3 TDD red | skipped: no reproducible defect |
| 4 UI mockups | 10 HTML screens |
| 5 Spec | 13 requirements (+R5a); Rev 3 |
| 6 Spec audit | failed at first (1 critical, 3 high), then revised and resolved |
| 7 Plan | 17 groups, 119 steps |
| 8 Implementation | 17/17 groups in 15 waves |
| 9 TDD green | skipped |
| 10 Verification options | all reviews, E2E and docs selected |
| 11 Verification | Passed after 2 fix rounds (W1–W11, N1, N2, D1–D5) |
| 12 E2E | 12/12 scenarios; M1 and C1–C3 fixed |
| 13 User docs | Polish guide with 20 screenshots |
| 14 Finalization | this summary |

## Artifacts
Every artifact declared in state exists on disk; no missing artifacts.
- **Analysis**: codebase analysis, gap analysis, clarifications, scope and technical clarifications, requirements, design context (10 mockups).
- **Implementation**: `spec.md`/`.html`, `implementation-plan.md`/`.html`, `visual-coverage.md`, `work-log.md`.
- **Verification**:
  - spec audit;
  - completeness, code review, pragmatic, production readiness and reality check reports, plus the three `*-reverify.md` re-checks;
  - `implementation-verification.md`/`.html`, `e2e-verification-report.md`/`.html`, `visual-fidelity.md`/`.html`;
  - 30 screenshots.
- **Documentation**: `user-guide.md` with 20 screenshots.

## Suggested standards (not yet adopted)
1. Listing-preference selects default to safe visibility; including private items is an explicit opt-in.
2. Personalised public GETs use `app/core/cache_headers.set_personalised_cache_headers`.
3. Guarded-downgrade refusal tests run `upgrade head` in `finally`.
4. Tailwind pages use `ConfirmDeleteDialog`, not the Chakra `ConfirmDialog`.
