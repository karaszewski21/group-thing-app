# Work Log

## 2026-09-22T11:30:14Z - Implementation Started

**Total Steps**: 44
**Task Groups**: 1 (formalize decoupling), 2 (solo-family auto-creation), 3 (join_private_group auth), 4 (EditTermDialog rework), 5 (new KragGrupyPage card), 6 (logged-out join prompt), 7 (test review & gap analysis)

**Wave plan**:
- Wave 1: Groups 1, 2 (no deps, disjoint files)
- Wave 2: Groups 3, 4, 5 (deps on 1/2, disjoint files from each other)
- Wave 3: Group 6 (deps on 3, 5 — shares KragGrupyPage.tsx with 5)
- Wave 4: Group 7 (deps on all)

Note: `TaskCreate`/`TaskUpdate` tools not available in this environment (confirmed during planning phase) — markdown checkboxes in `implementation-plan.md` are the sole progress-tracking source.

## 2026-09-22T11:35:00Z - Wave 1 Complete (Groups 1, 2)

### Group 1: Backend — formalize_group_from_term Decoupling + Stale Docstrings
**Status**: SUCCESS
**Steps**: 1.1-1.9 all completed
**Tests**: 4/4 new/rewritten pass (11/11 full test_group_privacy.py file)
**Files Modified**: src/backend/tests/test_group_privacy.py, src/backend/app/groups/application/memberships.py, src/backend/app/groups/models.py, src/backend/app/groups/router/circles.py, src/backend/app/groups/application/circles.py, src/backend/app/groups/schemas.py
**Notes**: `GroupVisibility` import removed cleanly from memberships.py (ruff-verified, no unused-import warnings). `test_joinPrivateGroup_anonymous_createsStandingMembership` in the same file will need rewriting once Group 3 (join_private_group auth) lands — noted for Group 7.

### Group 2: Backend — Solo-Family Auto-Creation
**Status**: SUCCESS
**Steps**: 2.1-2.8 all completed
**Tests**: 3/3 new pass
**Files Modified**: src/backend/app/families/bootstrap.py, src/backend/app/families/service.py, src/backend/app/users/service.py, src/backend/app/groups/application/public_view.py, src/backend/tests/test_families_bootstrap.py (new)
**Known fallout (expected, per spec's stated invariant)**: 5 pre-existing tests in `test_families.py` now fail because `register()` auto-creates a solo Family, so `create_own_family`'s idempotency check short-circuits instead of creating a fresh named Family:
  - test_createOwnFamily_noExistingFamily_createsNamedFamilyWithCallerAsGuardian
  - test_createOwnFamily_calledTwiceWithDifferentName_returnsExistingFamilyUnchanged
  - test_patchFamily_nonGuardian_returns403
  - test_patchFamily_guardianOfDifferentFamily_returns403
  - test_familyMineRead_reportsActiveChildCountExcludingGuardiansAndClosedMemberships
  **Action**: flagged for Group 7 (Test Review & Gap Analysis) to fix, since `test_families.py` is in that group's `Files to Modify` scope (`src/backend/tests/**/*.py`) and this is directly caused by this feature's core requirement (every Party has exactly one resolvable Family after registration), not a defect.

## Standards Reading Log

### Group 1
**From Implementation Plan**: global/minimal-implementation.md, backend/security.md, backend/api.md, testing/backend-testing.md
**From INDEX.md**: none beyond plan list
**Discovered During Execution**: none

### Group 2
**From Implementation Plan**: global/minimal-implementation.md, global/commenting.md, backend/models.md, testing/backend-testing.md
**From INDEX.md**: none beyond plan list
**Discovered During Execution**: none

## 2026-09-22T12:10:00Z - Wave 2 Complete (Groups 3, 4, 5)

### Group 3: Backend — join_private_group Requires Authentication
**Status**: SUCCESS
**Steps**: 3.1-3.7 all completed
**Tests**: 3/3 new pass (23/23 in test_circles_router.py + test_authorization_matrix.py); full backend suite 307 passed, 10 failed (see fallout below)
**Files Modified**: src/backend/app/groups/application/public_view.py, src/backend/app/groups/router/circles.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_circles_router.py
**Deviation from plan (correct, verified)**: spec assumed removing matrix row 91 would let the join route fall through to row 25's blanket AUTHENTICATED catch-all. Verified by direct read + failing test that row 27 (`POST /api/groups(/.*)?$` blanket EDIT rule) actually matches first, which would have silently required EDIT permission instead of bare authentication — contradicting the router's `require_any()` (zero permissions) dependency and violating security.md's "matrix and route dependency must agree" rule. Fixed by adding one explicit row resolving the join path to `"AUTHENTICATED"`, positioned ahead of row 27, with an explanatory comment. Test 3.3 passes against this corrected row.
**Known fallout (expected)**: two tests in `test_group_privacy.py` (outside this group's file scope) now fail because the anonymous join path is gone:
  - `test_joinPrivateGroup_anonymous_createsStandingMembership` (previously flagged by Group 1)
  - `test_joinPrivateGroup_publicGroup_returns404` (newly discovered — unauthenticated request now gets 401 before the PUBLIC-group 404 check fires, which is the correct new behavior; test needs an authenticated principal added to still exercise the 404 path)
  **Action**: flagged for Group 7.
**Unrelated pre-existing failures observed in full suite** (not caused by Group 3, root cause is Group 2's solo-family change): `test_exchange_summary.py::test_familyWithoutActiveGuardian_emptyPartyIds_bothFalseNoCrash`, `test_families.py` (5 failures, already logged under Group 2 above), `test_registration.py::test_register_organizerRole_grantsOrganizatorRoleButCreatesNoCircle`, `test_rsvp.py::test_createRsvp_loggedInUserNotCircleMember_attachesAttendanceWithoutMembershipSideEffect`. Flagged for Group 7.

### Group 4: Frontend — EditTermDialog.tsx Rework
**Status**: SUCCESS
**Steps**: 4.1-4.8 all completed
**Tests**: 2/2 new pass (86/86 full PanelPage.test.tsx)
**Files Modified**: src/frontend/src/components/panel/EditTermDialog.tsx, src/frontend/src/test/PanelPage.test.tsx
**Notes**: success copy uses a real `formalizedCount` state (N = actual submitted count), resolving spec.md's disambiguation that N is substituted, not literal. Flagged (non-blocking): this file's error copy ("Nie udało się ustalić...") differs slightly from the new KragGrupyPage card's spec'd error copy ("Nie udało się dodać..." — both are spec'd strings, not introduced by the implementer, likely intentional per-surface copy).

### Group 5: Frontend — New KragGrupyPage.tsx Card
**Status**: SUCCESS
**Steps**: 5.1-5.11 all completed
**Tests**: 7 new in KragGrupyPage.test.tsx + 2 new in useKragGrupy.test.ts, 49/49 total across both files pass
**Files Modified**: src/frontend/src/hooks/useKragGrupy.ts, src/frontend/src/pages/krag/KragGrupyPage.tsx, src/frontend/src/test/KragGrupyPage.test.tsx, src/frontend/src/test/useKragGrupy.test.ts
**Visual Compliance**: 4/4 references — 3 ✓ full match, 1 ⚠ (no expand/collapse control implemented; mockup explicitly left this as an optional implementation detail, so this is a deliberate simplification, not a gap)

## Standards Reading Log

### Group 3
**From Implementation Plan**: backend/security.md, backend/api.md, testing/backend-testing.md
**Discovered During Execution**: applied security.md's "matrix and route must agree" rule to catch the row-27 pre-emption issue (see deviation note above)

### Group 4
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md

### Group 5
**From Implementation Plan**: frontend/css.md, frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md
**Discovered During Execution**: `.kg-error` CSS class (KragGrupyPage.tsx:133) reused for inline error state instead of ad-hoc inline style

## 2026-09-22T12:35:00Z - Wave 3 Complete (Group 6)

### Group 6: Frontend — Logged-Out Join Prompt on Public Private-Group Page
**Status**: SUCCESS
**Steps**: 6.1-6.4 all completed
**Tests**: 2/2 new pass (40/40 full PublicKragGrupyPage.test.tsx; 34/34 KragGrupyPage.test.tsx cross-check confirms no contamination from Group 5's parallel edits to the same file)
**Files Modified**: src/frontend/src/pages/krag/KragGrupyPage.tsx, src/frontend/src/test/PublicKragGrupyPage.test.tsx
**Notes**: added defense-in-depth `isLoggedIn &&` guard on the dialog mount itself, beyond the letter of the task, so a stale `showJoinDialog=true` can't render the dialog for a since-logged-out visitor.

### Group 6 Standards
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, testing/frontend-testing.md

## Known Fallout to Fix in Group 7 (compiled from Groups 1-3 reports)

**Backend regressions caused directly by this feature's core requirements (expected, not defects):**
1. `test_group_privacy.py::test_joinPrivateGroup_anonymous_createsStandingMembership` — anonymous join path removed (Group 3); needs rewriting to use an authenticated principal or asserting 401.
2. `test_group_privacy.py::test_joinPrivateGroup_publicGroup_returns404` — unauthenticated request now hits 401 (from `require_any()`) before the PUBLIC-group 404 check; needs an authenticated principal added to the request so it still exercises the 404 path.
3. `test_families.py` (5 failures) — `register()` now auto-creates a solo Family, so `create_own_family`'s idempotency check returns the pre-existing solo Family instead of creating a fresh named one:
   - test_createOwnFamily_noExistingFamily_createsNamedFamilyWithCallerAsGuardian
   - test_createOwnFamily_calledTwiceWithDifferentName_returnsExistingFamilyUnchanged
   - test_patchFamily_nonGuardian_returns403
   - test_patchFamily_guardianOfDifferentFamily_returns403
   - test_familyMineRead_reportsActiveChildCountExcludingGuardiansAndClosedMemberships
4. `test_exchange_summary.py::test_familyWithoutActiveGuardian_emptyPartyIds_bothFalseNoCrash` — likely same root cause as #3 (solo-family auto-creation changes a previously family-less test fixture's state).
5. `test_registration.py::test_register_organizerRole_grantsOrganizatorRoleButCreatesNoCircle` — likely same root cause as #3.
6. `test_rsvp.py::test_createRsvp_loggedInUserNotCircleMember_attachesAttendanceWithoutMembershipSideEffect` — likely same root cause as #3 (anonymous/RSVP party now gets a solo Family).

Group 7 owns `src/backend/tests/**/*.py` — fix all of the above as part of its gap-analysis pass, confirming root cause for #4-6 before editing.

## 2026-09-22T13:15:00Z - Wave 4 Complete (Group 7) — Implementation Complete

### Group 7: Test Review & Gap Analysis
**Status**: SUCCESS
**Steps**: 7.1-7.4 all completed, plus corrective fixes to all 6 known-diagnosed regressions
**Regression fixes**: test_group_privacy.py (deleted redundant anonymous-join test, fixed public-group-404 test), test_families.py (5 tests fixed — root cause: solo-family auto-creation), test_exchange_summary.py (fixed fixture + a pre-existing missing `select` import), test_registration.py (fixed family-count assertion), test_rsvp.py (fixed to before/after diff assertion)
**New tests added (3, under the 10 cap)**: test_updateGroup_visibilityChange_doesNotCreateMemberships, test_joinPrivateGroup_malformedToken_returns401, PanelPage.test.tsx inline-error/retry test for EditTermDialog's formalize section
**Files Modified**: test_group_privacy.py, test_circles_router.py, test_families.py, test_exchange_summary.py, test_registration.py, test_rsvp.py, PanelPage.test.tsx

**Final full-suite gate**:
- Backend (`uv run pytest`, src/backend): **318 passed, 0 failed**
- Frontend (`npx vitest run`, src/frontend): **304 passed, 4 failed** — the 4 failures (foundation.test.tsx, auth.test.tsx, extension-points.test.tsx) are pre-existing, unrelated to this feature (untouched files, reproduce in isolation, confirmed via `git status`). All success-criteria-named files pass: test_group_privacy.py, test_public_term.py, test_circles_router.py, PanelPage.test.tsx (87), KragGrupyPage.test.tsx (34), PublicKragGrupyPage.test.tsx (40), useKragGrupy.test.ts — 176/176 combined.

**Real bug discovered, NOT fixed (out of Group 7's test-only file scope)**: `formalize_group_from_term` (memberships.py ~140-152) is not actually idempotent against already-active members — its docstring claims idempotency but it only excludes stale-attendance party_ids, never already-Membership party_ids. Calling formalize twice with the same still-attending, already-promoted party_id creates a **duplicate Membership row** (verified directly). A test for this (`test_formalizeGroupFromTerm_idempotent_skipsStaleSelection`) was drafted, confirmed the bug, then removed rather than either left red or written to enshrine wrong behavior. **Recommended follow-up**: subtract already-member party_ids in the `selected_party_ids` intersection at memberships.py, then restore the test. This matters because both new UI surfaces (EditTermDialog and the new KragGrupyPage card) invite exactly this retry scenario (double-click submit, retry after network error).

**Non-blocking copy inconsistency (previously flagged by Group 4, confirmed by Group 7)**: EditTermDialog.tsx always renders "Dodano N osób..." (grammatically wrong for N=1); the new KragGrupyPage card correctly pluralizes ("...osobę" for 1). Both pass their own tests as-is; true parity needs a small source fix outside any group's current scope.

## 2026-09-22T13:15:00Z - Implementation Complete

**Total Steps**: 44 planned + regression-fix/gap work in Group 7, all completed
**Total Standards Applied**: global/minimal-implementation.md, global/commenting.md, backend/security.md, backend/api.md, backend/models.md, frontend/css.md, frontend/components.md, frontend/accessibility.md, testing/backend-testing.md, testing/frontend-testing.md
**Test Suite**: Backend 318/318 passed. Frontend 304/308 passed (4 pre-existing unrelated failures, confirmed not caused by this feature).
**Open follow-up items** (not blocking, recommended as separate tasks):
1. `formalize_group_from_term` duplicate-Membership-on-retry bug (real defect, found by Group 7, not fixed — outside test-file scope)
2. Success-copy pluralization parity between EditTermDialog.tsx and the new KragGrupyPage card
3. Pre-existing unrelated frontend failures in foundation.test.tsx/auth.test.tsx/extension-points.test.tsx (separate from this task)

## 2026-09-22T14:20:00Z - Verification Fixes Applied & Re-Verified

Fixed the critical + warning issues from code review (`verification/code-review-report.md`):

1. **C1 fixed**: `formalize_group_from_term` (`memberships.py`) now excludes already-active-member party_ids from `selected_party_ids` before the mutation loop, mirroring `list_term_attendees_for_formalization`'s existing pattern. Docstring updated. Restored `test_formalizeGroupFromTerm_idempotent_skipsStaleSelection` in `test_group_privacy.py` (calls formalize twice, asserts exactly one Membership).
2. **W1 fixed**: `EditTermDialog.tsx`'s success copy now pluralizes ("osobę" for N=1, "osób" otherwise), matching `KragGrupyPage.tsx`. Updated the corresponding `PanelPage.test.tsx` assertion ("Dodano 1 osobę...").
3. **W2 not fixed**: N+1 pattern left as-is per code review's own "low priority, optional follow-up" recommendation.

**Re-verification**:
- Backend full suite (`uv run pytest`, src/backend): **319 passed, 0 failed** (was 318; +1 for the restored idempotency test)
- Frontend (`npx vitest run`, src/frontend, scoped to PanelPage.test.tsx + KragGrupyPage.test.tsx): **121 passed, 0 failed**
- Frontend full suite: **304 passed, 4 failed** — confirmed identical pre-existing, unrelated failures (foundation.test.tsx, auth.test.tsx, extension-points.test.tsx), no new regressions from the fixes.

**Files Modified (this pass)**: src/backend/app/groups/application/memberships.py, src/backend/tests/test_group_privacy.py, src/frontend/src/components/panel/EditTermDialog.tsx, src/frontend/src/test/PanelPage.test.tsx

## 2026-09-22T18:35:00Z - User-Reported Bug Fixed (post-verification)

User reported (live, after task completion): a logged-in user could not RSVP to a PUBLIC group's term.

**Root cause** (pre-existing, not introduced by this task's 7 groups — traced to `KragGrupyPage.tsx`'s route-level `token ? <PrivateKragGrupyView /> : <PublicKragGrupyView />` branch, already present and uncommitted before this task started): ANY logged-in visitor — not just a circle's own organizer/members — lands on `PrivateKragGrupyView` (the "my group" management view) per that route's auth-presence-only branching. `PrivateKragGrupyView` had a "Wycofaj się z zajęć" (withdraw) button for an already-attending viewer, but **no sign-up affordance at all** for a not-yet-attending one — `PublicKragGrupyView`'s "＋ Zapisz się na zajęcia" button/`RsvpDialogLoggedIn` dialog only existed in the anonymous-view component, unreachable once any token was present.

**Fix**: added the same "＋ Zapisz się na zajęcia" button + `RsvpDialogLoggedIn` dialog to `PrivateKragGrupyView`, shown when `currentTerm && !myAttendanceForCurrentTerm && group.visibility === "PUBLIC"` (scoped to PUBLIC groups only — PRIVATE-group joining already works correctly via the separate "Dołącz na stałe"/`join_private_group` standing-membership flow, untouched).

**Verified**:
- Live in-browser repro (Playwright): registered a fresh account, RSVP'd once via API, logged in via UI, confirmed the group page (now showing `PrivateKragGrupyView` for this non-member logged-in visitor) had no way to sign up for a second term — reproduced the exact reported bug.
- After the fix: same flow now shows the button, opens the dialog, submits successfully, backend confirms the new `TermAttendance` row (`GET /api/groups/4/terms/5/attendees`).
- Added 4 new tests to `KragGrupyPage.test.tsx` (button shown for PUBLIC+not-attending; hidden once attending; hidden for PRIVATE; submit calls `createRsvp` + `refetch`) — new `describe("KragGrupyPage (private view) — sign up for a PUBLIC group's term", ...)` block.
- Full frontend suite re-run: **308 passed, 4 failed** (was 304/4 — same 4 pre-existing unrelated failures, +4 new passing tests, zero new regressions).

**Files Modified**: src/frontend/src/pages/krag/KragGrupyPage.tsx, src/frontend/src/test/KragGrupyPage.test.tsx

### Loaded Per Group (remaining)
(Entries added as groups execute)
