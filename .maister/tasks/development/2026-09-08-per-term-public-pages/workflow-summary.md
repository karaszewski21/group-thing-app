# Workflow Summary: Add per-term public pages

**Completed:** 2026-09-09
**Orchestrator:** maister:development
**Status:** COMPLETE (verification phases 10–13 skipped by user request)

## Phases run
| Phase | Outcome |
|---|---|
| 1 Codebase analysis + clarifications | `analysis/codebase-analysis.md`, `analysis/clarifications.md` |
| 2 Gap analysis + scope decisions | `analysis/gap-analysis.md`, `analysis/scope-clarifications.md` — risk medium, ui_heavy |
| 4 UI mockups | `analysis/design-context/ascii/ui-mockups.md` (+ INDEX) — 5 screens, all reuse `.kg-*` |
| 5 Technical clarification + requirements + spec | `analysis/technical-clarifications.md`, `analysis/requirements.md`, `implementation/spec.md` |
| 6 Spec audit | skipped by user |
| 7 Implementation planning | `implementation/implementation-plan.md`, `implementation/visual-coverage.md` — 4 groups |
| 8 Implementation | 4/4 task groups SUCCESS, 34 steps, `implementation/work-log.md` |
| 3 / 9 TDD gates | skipped — no reproducible defect |
| 10–13 Verification / E2E / user docs | skipped by user |
| 14 Finalization | this file |

## What was built
- **Canonical public URL:** `/:organizationSlug/grupa/:groupId/term/:termId` (slug cosmetic, not validated) + term-less `/:organizationSlug/grupa/:groupId` that redirects to the nearest term (or renders "no terms yet").
- **`/krag/:groupId/publiczny` deleted** — app not in production; private `/krag/:groupId` kept.
- **Backend:** `GET /api/groups/public/{group_id}?term_id=` (query param → no auth-matrix change); `get_public_circle_view` generalized with an ownership guard copied from `create_rsvp`; new `resolve_organizer_slug` helper; `organizer_slug` on `PublicCircleResponse` + `GroupResponse` (not `list_groups`); `list_needed_items` `ORDER BY id`.
- **Frontend:** term-aware `PublicKragGrupyView` (reads `:termId`), new `PublicKragRedirectPage` resolver, `isPublic` pathname-sniff removed; `getPublicCircle(groupId, termId?)` + `usePublicKragGrupy(groupId, termId?)`; 5 link builders repointed with `/krag/:id` null-slug fallback; **copy-link button** on organizer "Terminy" rows; both first-term steppers now capture the `createTerm()` return and deep-link (or nudge to `/organization` when the user has no slug).

## Standards applied
security.md (matrix untouched, no new Depends), api.md (query-param filtering), queries.md (explicit ORDER BY, organizer_slug not in list_groups), models.md (cross-BC via plain function import, no cycle), error-handling / validation / minimal-implementation, css.md (`.kg-*` for public pages, Tailwind for Panel), components.md, accessibility.md (`role="status"` + `aria-label` on redirect frame, no nested interactive elements), backend-testing.md (integration-first, TestContainers, `action_condition_expectedResult`), frontend-testing.md (per-file MemoryRouter + vi.mock).

## Files changed
**Backend (modified):** `app/groups/router.py`, `app/groups/schemas.py`, `app/groups/service.py`
**Backend (new):** `tests/test_public_term.py`
**Frontend (modified):** `src/api/groups.ts`, `src/hooks/usePublicKragGrupy.ts`, `src/pages/krag/KragGrupyPage.tsx`, `src/router.tsx`, `src/pages/panel/PanelPage.tsx`, `src/components/panel/FirstTermStepperOrganizer.tsx`, `src/components/panel/FirstTermStepperGuest.tsx`, `src/test/PanelPage.test.tsx`, `src/test/PublicKragGrupyPage.test.tsx`
**Frontend (new):** `src/pages/krag/PublicKragRedirectPage.tsx`

## Test results
- Backend: `pytest -q` → **50 passed / 0 failed** (incl. new `test_public_term.py` 6/6).
- Frontend: `vitest run` → **138 passed / 3 failed**. The 3 (`auth.test.tsx`, `extension-points.test.tsx`, `OnboardingWizard.test.tsx`) fail identically on a clean `git stash` tree — pre-existing, unrelated.

## Follow-ups (out of scope, flagged during the run)
1. Pre-existing frontend test failures: `auth.test.tsx`, `extension-points.test.tsx`, `OnboardingWizard.test.tsx`.
2. Pre-existing backend lint/type debt: `router.py` `create_rsvp` line E501; `service.py` `fulfill_pledge` passes `int | None` where `int` expected (2 mypy errors).
3. Verification phases (code review, pragmatic review, reality check, production readiness, E2E, user docs) were skipped — consider `/maister:reviews-code` or `/code-review` before merge.
4. The authenticated private `/krag/:groupId` view still uses a third term-selection rule (`currentTerm = terms[0]`) — deliberately left inconsistent.
