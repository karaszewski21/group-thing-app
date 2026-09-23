# Implementation Plan: Decouple Standing-Membership Promotion from Group Visibility

## Overview
Total Steps: 44
Task Groups: 7
Expected Tests: 18-25

## Implementation Steps

### Task Group 1: Backend — `formalize_group_from_term` Decoupling + Stale Docstrings
**Dependencies:** None
**Files to Modify:** src/backend/app/groups/application/memberships.py, src/backend/app/groups/models.py, src/backend/app/groups/router/circles.py, src/backend/app/groups/application/circles.py, src/backend/app/groups/schemas.py, src/backend/tests/test_group_privacy.py

- [x] 1.0 Complete backend visibility/family decoupling in `formalize_group_from_term`
  - [x] 1.1 In `src/backend/tests/test_group_privacy.py`, rewrite `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` in place as `test_formalizeGroupFromTerm_organizer_createsMembershipStaysPublic`: assert `response.json()["visibility"] == "PUBLIC"`, keep the membership-creation assertion
  - [x] 1.2 Add `test_formalizeGroupFromTerm_familyLessAttendee_createsMembership`: anonymous RSVP with no explicit family, formalized by organizer, results in a `Membership` for that `party_id`
  - [x] 1.3 Add `test_createRsvp_publicGroupWithExistingMembers_stillAcceptsAnonymousRsvp`: formalize one attendee into a standing member, then a fresh anonymous RSVP to the same still-`PUBLIC` group's term still returns 201
  - [x] 1.4 Confirm `test_formalizeGroupFromTerm_nonOrganizer_returns403` is unaffected (no change needed)
  - [x] 1.5 In `memberships.py`'s `formalize_group_from_term` (lines ~125-163): remove the `if group.visibility != GroupVisibility.PUBLIC: raise AccessDeniedException` precondition and the trailing `group.visibility = GroupVisibility.PRIVATE` assignment
  - [x] 1.6 Remove the `families = await _resolve_party_families(...)` call and the `if party_id not in families: continue` skip inside the loop; every `party_id` in `eligible_party_ids & set(party_ids)` gets a `Membership` regardless of family resolution. Keep `_require_active_organizer`, the eligibility intersection, and `get_or_create_active_group_role(db, party_id, GroupRoleType.MEMBER)` unchanged
  - [x] 1.7 Update `formalize_group_from_term`'s docstring to describe standing-`Membership` creation only, independent of `Group.visibility` and no longer gated on family resolution; remove the now-unused `GroupVisibility` import from `memberships.py` only if nothing else in the file references it
  - [x] 1.8 Correct stale docstrings/comments: `models.py`'s `GroupVisibility` docstring (visibility changes only via `PATCH /groups/{id}`), `router/circles.py`'s formalize route docstring (no visibility involvement), `application/circles.py`'s `update_group` docstring (formalize and visibility-change are now fully independent), `schemas.py`'s section header above `TermAttendeeResponse`/`FormalizeGroupFromTermRequest` and `TermAttendeeResponse`'s docstring (family-less attendees remain selectable; `family_id`/`family_name` are display-only)
  - [x] 1.9 Run the 3 tests from 1.1-1.3 plus 1.4's existing test — confirm all pass

**Acceptance Criteria:**
- The 4 tests (1 rewritten, 2 new, 1 unaffected-verified) pass
- `formalize_group_from_term` never reads or mutates `Group.visibility`
- A family-less attendee (anonymous RSVP) can be promoted to a standing `Membership`
- No stale docstring/comment in the four touched files still claims formalization flips visibility

---

### Task Group 2: Backend — Solo-Family Auto-Creation
**Dependencies:** None
**Files to Modify:** src/backend/app/families/bootstrap.py, src/backend/app/families/service.py, src/backend/app/users/service.py, src/backend/app/groups/application/public_view.py, src/backend/tests/test_families_bootstrap.py (or equivalent chosen by implementer)

- [x] 2.0 Complete solo-family auto-creation and wire into registration + anonymous RSVP
  - [x] 2.1 Write `test_register_newAccount_createsSoloFamily`: after `/api/auth/register`, the new party has exactly one resolvable Family (via `list_families_for_guardian_party` / `GET /api/families/by-guardian-party/{party_id}`) with that party as sole guardian
  - [x] 2.2 Write `test_createRsvp_anonymousAttendee_createsSoloFamily`: after an anonymous RSVP, the newly-created party similarly has exactly one resolvable Family
  - [x] 2.3 Write `test_createSoloFamilyForParty_calledTwice_returnsSameFamilyBothTimes`: idempotency — calling the function/flow twice for the same party never creates a second Family
  - [x] 2.4 In `app/families/bootstrap.py`, add `create_solo_family_for_party(db, party_id: int, display_name: str) -> Family`: call `list_families_for_guardian_party(db, party_id)` first, return `families[0]` if any exist; otherwise call `bootstrap_family_for_party(db, f"Rodzina {display_name}", party_id)` and return the result. Flushes only, does not commit
  - [x] 2.5 Export `create_solo_family_for_party` from `app/families/service.py`'s `from .bootstrap import (...)` line and `__all__`
  - [x] 2.6 In `app/users/service.py`'s `register()`, after `party, profile = await create_account_and_profile(...)` and before `await db.commit()`, add a function-local `from app.families.service import create_solo_family_for_party` (with a short comment explaining the import-cycle avoidance) and call `create_solo_family_for_party(db, party.id, display_name)`. Correct the function's docstring to distinguish this unconditional solo-family call from the previously-removed organizer-role-triggered bootstrap
  - [x] 2.7 In `app/groups/application/public_view.py`'s `create_rsvp`, anonymous branch, after `db.add(profile)` and `await db.flush()`, before the `TermAttendance` is created, add the same function-local import (with comment) and call `create_solo_family_for_party(db, party.id, guardian_name)`
  - [x] 2.8 Run the 3 tests from 2.1-2.3 — confirm all pass

**Acceptance Criteria:**
- The 3 tests pass
- Every new `Party` (via register and anonymous RSVP) has exactly one resolvable solo `Family` immediately after creation
- Calling the creation path twice for the same party never produces a duplicate Family
- Both call sites use function-local imports with explanatory comments per `standards/global/commenting.md`

---

### Task Group 3: Backend — `join_private_group` Requires Authentication
**Dependencies:** Group 2 (shares `public_view.py`; serialize to avoid merge conflicts)
**Files to Modify:** src/backend/app/groups/application/public_view.py, src/backend/app/groups/router/circles.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_circles_router.py

- [x] 3.0 Complete authentication requirement for `join_private_group`
  - [x] 3.1 Write `test_joinPrivateGroup_unauthenticated_returns401`: no principal (or a principal not resolving to an account-backed `UserProfile`) is rejected with a 401 pointing to login/register, before any membership logic runs
  - [x] 3.2 Write `test_joinPrivateGroup_authenticated_attachesExistingMembership`: an authenticated, account-backed principal still gets the existing attach/return-membership behavior unchanged
  - [x] 3.3 Write `test_authorizationMatrix_joinRoute_fallsThroughToAuthenticatedCatchAll`: confirm the join route no longer resolves to the `"PUBLIC"` matrix row and instead requires authentication (row 25 catch-all)
  - [x] 3.4 In `router/circles.py` (lines ~156-167), change `join_private_group`'s principal dependency from `principal: OptionalPrincipal = None` to `Depends(require_any())` (zero permission names); update the route docstring to describe an authenticated-only contract
  - [x] 3.5 In `app/core/authorization_matrix.py`, remove row 91 (`(_methods("POST"), r"^/api/groups/public/[^/]+/join$", "PUBLIC")`) and its explanatory comment (lines ~87-91)
  - [x] 3.6 In `public_view.py`'s `join_private_group`, change the signature to `principal: Principal` (required, no default); delete the anonymous branch (lines ~439-467) entirely; resolve `profile` via `get_profile_by_principal(db, principal)`, catching `EntityNotFoundException` and re-raising `AuthenticationRequiredException` (import from `app.core.auth_deps`, alongside the existing `AccessDeniedException, EntityNotFoundException` import). Otherwise proceed with the existing attach/return logic unchanged. Update the function's docstring to describe the new authenticated-only contract
  - [x] 3.7 Run the 3 tests from 3.1-3.3 — confirm all pass

**Acceptance Criteria:**
- The 3 tests pass
- An unauthenticated request to join a private group is rejected before membership logic runs, with a message directing the caller to log in or register
- An authenticated, account-backed principal's existing join behavior is unchanged
- No matrix row still resolves this route to `"PUBLIC"`

---

### Task Group 4: Frontend — `EditTermDialog.tsx` Rework (drop family/visibility gating)
**Dependencies:** Group 1, Group 2 (relies on backend family-less-eligibility and solo-family behavior for correctness)
**Files to Modify:** src/frontend/src/components/panel/EditTermDialog.tsx, src/frontend/src/test/PanelPage.test.tsx

- [x] 4.0 Complete `EditTermDialog.tsx`'s family/visibility-gate removal
  - [x] 4.1 Extend `PanelPage.test.tsx`'s existing `formalizeGroupFromTerm`/`getTermAttendeesForFormalization` mocks with a test that selects an attendee, clicks submit, and asserts `formalizeGroupFromTerm` was called with the expected `party_ids` and that the success copy "Dodano N osób jako stałych członków grupy." renders
  - [x] 4.2 Write a test confirming a family-less attendee (`family_id: null`) row is selectable (not disabled) and pre-selected
  - [x] 4.3 Replace the fetch gate (`if (group.visibility !== "PUBLIC") return;`, line ~137) with an unconditional fetch on mount for this term; drop the visibility dependency from the `useEffect`'s dependency array
  - [x] 4.4 Replace the render gate (`group.visibility === "PUBLIC"`, line ~427) with a condition derived from `attendees` (e.g. render whenever `attendees !== null`), so loading/error/empty/populated states all show
  - [x] 4.5 Drop `family_id !== null` from the default pre-selection (line ~146) — pre-select every attendee with `!r.already_member`
  - [x] 4.6 Drop `a.family_id === null` from the disabled-checkbox condition (line 456) — disable only on `a.already_member`
  - [x] 4.7 Remove "— brak rodziny, nie można ustalić" copy and the visibility-change warning ("grupa stanie się prywatna..."); replace helper text with "Zaznacz, kto ma zostać stałym członkiem grupy."; replace the success message with "Dodano N osób jako stałych członków grupy."; update the `EditTermDialogProps.group` doc comment (lines ~63-65)
  - [x] 4.8 Run the 2 tests from 4.1-4.2 — confirm all pass

**Acceptance Criteria:**
- The 2 tests pass
- No family- or visibility-based gate/copy remains in this section
- Both surfaces (`EditTermDialog.tsx` and the new `KragGrupyPage.tsx` card) will read near-identically once Group 5 completes

---

### Task Group 5: Frontend — New `KragGrupyPage.tsx` "Dodaj stałych członków" Card
**Dependencies:** Group 1, Group 2 (relies on backend family-less-eligibility and solo-family behavior)
**Files to Modify:** src/frontend/src/hooks/useKragGrupy.ts, src/frontend/src/pages/krag/KragGrupyPage.tsx, src/frontend/src/test/KragGrupyPage.test.tsx, src/frontend/src/test/useKragGrupy.test.ts
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#header-entry-point
  element: screen:krag-grupy-organizer-header
  locator: Mockup 1 (lines 41-84) — kg-head header block, new kg-card placed immediately after the existing "Wycofaj się z zajęć" button, before GroupVisualization
  acceptance: new kg-card sits inside/adjacent to the kg-head visual cluster, below the withdraw-attendance button, not as a separate section below GroupVisualization and not a modal
- mockup: analysis/design-context/ascii/ui-mockups.md#header-entry-point
  element: component:promote-members-card-collapsed
  locator: Mockup 1 (lines 59-67) — collapsed card body
  acceptance: title "Dodaj stałych członków z tego terminu", summary line "N osób z listy obecności na «{date}» nie są jeszcze stałymi członkami grupy.", primary submit button styled kg-btn-primary; no visibility/privacy copy anywhere
- mockup: analysis/design-context/ascii/ui-mockups.md#expanded-checklist
  element: component:promote-members-checklist
  locator: Mockup 2 (lines 91-112) — expanded checklist body and interaction details (lines 114-119)
  acceptance: every currentTerm attendee is a selectable checkbox regardless of family; pre-selected unless already_member; only already_member disables a row (never family-based); checkbox aria-label mirrors `Ustal ${a.display_name} jako stałego członka`; inline error text "Nie udało się dodać stałych członków — spróbuj ponownie" on failure; submit button disabled while busy or zero selected; expand/collapse control (if used) has a real aria-expanded button, not a bare glyph
- mockup: analysis/design-context/ascii/ui-mockups.md#checklist-states
  element: component:promote-members-states
  locator: Mockup 3 (lines 128-145) — success / nothing-to-promote / loading state blocks
  acceptance: success state shows "Dodano N osób jako stałych członków grupy." with no visibility/privacy mention; loading state shows "Wczytywanie zapisanych…"; nothing-to-promote state shows "Wszyscy zapisani na ten termin są już stałymi członkami grupy." (or hides the checklist/button) when every fetched attendee has already_member === true

- [x] 5.0 Complete the new promote-standing-members card on `KragGrupyPage.tsx`
  - [x] 5.1 Write a `useKragGrupy.test.ts` test that `formalizeStandingMembers` calls `formalizeGroupFromTerm(group.id, currentTerm.id, partyIds)` and follows the busy-flag + `await refetch()` convention
  - [x] 5.2 Write a `KragGrupyPage.test.tsx` test (new `describe("KragGrupyPage (private view) — promote standing members", ...)` block) that the card renders for `isOrganizerViewer && currentTerm`, extending `baseHookValue`'s mocked `UseKragGrupyResult` with the new attendee/mutation fields
  - [x] 5.3 Write a test that selecting attendees and submitting calls the new hook mutation with the correct `party_ids`
  - [x] 5.4 Write a test that the success/empty (nothing-to-promote) states render correctly
  - [x] 5.5 Write a test that the card does NOT render (or renders nothing actionable) when `isOrganizerViewer` is false
  - [x] 5.6 Extend `useKragGrupy.ts`'s `UseKragGrupyResult` with term-attendee state for `currentTerm` (fetched via `getTermAttendeesForFormalization`) and `formalizeStandingMembers(partyIds: number[]): Promise<void>`, following the `useState` busy-flag + toast + `await refetch()` convention used by `withdrawMyAttendance`
  - [x] 5.7 Fetch the attendee list once `currentTerm` is available, mirroring `EditTermDialog.tsx`'s fetch timing adapted to the hook's `refetch`-driven lifecycle
  - [x] 5.8 In `KragGrupyPage.tsx`'s `PrivateKragGrupyView`, add the new `kg-card` section immediately after the existing withdraw-attendance button (~line 885), inside the `kg-head` cluster, before `GroupVisualization`, gated on `isOrganizerViewer && currentTerm`
  - [x] 5.9 Implement all states per the mockups: loading ("Wczytywanie zapisanych…"), nothing-to-promote ("Wszyscy zapisani na ten termin są już stałymi członkami grupy." or hidden), populated checklist (pre-selected on `!already_member`, only `already_member` disables), submit disabled while busy/zero-selected, inline error text, success text "Dodano N osób jako stałych członków grupy."
  - [x] 5.10 Implement checkbox `aria-label` per `` `Ustal ${a.display_name} jako stałego członka` ``; if expand/collapse is used, give it a real `aria-expanded` toggle button. Use `.kg-card`/`.kg-btn-primary`/`.kg-bring-sub`/`.kg-status-line` for styling
  - [x] 5.11 Run the 5 tests from 5.1-5.5 — confirm all pass

**Acceptance Criteria:**
- The 5 tests pass
- The organizer can trigger "add standing members from this term" from `KragGrupyPage.tsx`, with family-independent, visibility-independent eligibility and the shared success copy
- A family-less promoted member appears correctly in the family-orbit visualization (verified via Group 2's solo-family fix; no code change needed here)
- Implementation matches each `acceptance` criterion declared in Visual References above

---

### Task Group 6: Frontend — Logged-Out Join Prompt on Public Private-Group Page
**Dependencies:** Group 3 (backend auth requirement), Group 5 (shares `KragGrupyPage.tsx`; serialize)
**Files to Modify:** src/frontend/src/pages/krag/KragGrupyPage.tsx, src/frontend/src/components/krag/RsvpDialog.tsx (reference only, no edit expected), src/frontend/src/test/PublicKragGrupyPage.test.tsx

- [x] 6.0 Complete the logged-out join prompt for `PublicKragGrupyView`'s private-group card
  - [x] 6.1 Write a test that a logged-out visitor viewing a `PRIVATE` group's "Dołącz na stałe" card sees a login/register prompt instead of `JoinPrivateGroupDialog`, and never triggers `joinPrivateGroup`
  - [x] 6.2 Write a test that a logged-in visitor still sees the existing `JoinPrivateGroupDialog` unchanged
  - [x] 6.3 In `KragGrupyPage.tsx`'s `PublicKragGrupyView`, the `circle.visibility === "PRIVATE"` block (~lines 1529-1584), add an `isLoggedIn` gate: logged-in renders the existing dialog trigger unchanged; logged-out renders an inline login/register prompt reusing `RsvpGateDialog.tsx`'s login/register `<Link>` markup pattern (`loginHref`/`registerHref` with `?returnTo=` wired the same way as the page's existing three call sites), rendered inline in the existing `.kg-card` (no new modal, no guest option)
  - [x] 6.4 Run the 2 tests from 6.1-6.2 — confirm all pass

**Acceptance Criteria:**
- The 2 tests pass
- Logged-out visitors never reach `joinPrivateGroup` unauthenticated; they see a clear log-in/register message
- `PrivateKragGrupyView`'s `JoinPrivateGroupDialog` consumer (always logged-in) is unaffected

---

### Task Group 7: Test Review & Gap Analysis
**Dependencies:** All previous groups (1-6)
**Files to Modify:** src/backend/tests/**/*.py, src/frontend/src/test/**/*.test.ts(x)

- [x] 7.0 Review and fill critical gaps
  - [x] 7.1 Review the 18 tests written across Groups 1-6
  - [x] 7.2 Analyze gaps specific to this feature only (visibility/family decoupling, solo-family creation, join-auth requirement, both promote-members UI surfaces, logged-out join prompt)
  - [x] 7.3 Write up to 10 additional strategic tests covering any identified gaps (e.g. `test_formalizeGroupFromTerm_idempotent_skipsStaleSelection`, `test_updateGroup_visibilityChange_doesNotCreateMemberships`, error-toast/retry behavior on the new card, cross-surface consistency between `EditTermDialog.tsx` and the new card)
  - [x] 7.4 Run the full backend suite (`uv run pytest` in `src/backend`) and the full frontend suite as a final gate; confirm no regressions in `test_group_privacy.py`, `test_public_term.py`, `test_circles_router.py`, `PanelPage.test.tsx`, `KragGrupyPage.test.tsx`, `PublicKragGrupyPage.test.tsx`, `useKragGrupy.test.ts`

**Acceptance Criteria:**
- All feature tests pass (~18-28 total across the whole feature)
- No more than 10 additional tests added in this group
- Full backend and frontend suites pass with no regressions

---

## Execution Order

1. Group 1: Backend — `formalize_group_from_term` decoupling (9 steps)
2. Group 2: Backend — solo-family auto-creation (8 steps, independent of Group 1, can run in parallel)
3. Group 3: Backend — `join_private_group` auth (7 steps, depends on Group 2)
4. Group 4: Frontend — `EditTermDialog.tsx` rework (8 steps, depends on Groups 1, 2)
5. Group 5: Frontend — new `KragGrupyPage.tsx` card (11 steps, depends on Groups 1, 2; can run parallel to Group 4)
6. Group 6: Frontend — logged-out join prompt (4 steps, depends on Groups 3, 5)
7. Group 7: Test Review & Gap Analysis (4 steps, depends on all)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/ — always applicable (minimal-implementation.md governs deletion of the now-dead `_resolve_party_families` call and unused `GroupVisibility` import; commenting.md governs the two function-local import comments)
- backend/models.md, backend/queries.md, backend/security.md, backend/migrations.md — no new tables/columns/migrations in this task; `_require_active_organizer` and `require_any()` dependency patterns per security.md
- backend/api.md — no new endpoints, no route/schema renames
- frontend/css.md, frontend/components.md, frontend/accessibility.md — reuse `.kg-card`/`.kg-btn-primary`/`.kg-bring-sub`/`.kg-status-line`; aria-label/aria-expanded requirements per accessibility.md
- testing/backend-testing.md, testing/frontend-testing.md — 2-8 tests per group, integration-first backend tests, Vitest + Testing Library conventions for frontend

## Notes

- Test-Driven: Each group starts with 2-8 tests
- Run Incrementally: Only new tests after each group
- Mark Progress: Check off steps as completed
- Reuse First: `bootstrap_family_for_party`, `list_families_for_guardian_party`, `create_own_family`'s idempotency pattern, `AuthenticationRequiredException`, `require_any()`, `RsvpGateDialog.tsx`'s login/register markup, `EditTermDialog.tsx`'s checklist logic as the adaptation source for the new card, `getTermAttendeesForFormalization`/`formalizeGroupFromTerm`/`TermAttendeeResponse` unchanged
- Out of scope (do not implement): use cases 2-4 fixed-membership flows, `PATCH /groups/{id}` visibility UI, `TermSeries`/recurring scheduling, renaming `formalize_group_from_term`, solo-family call on `join_private_group`'s (now-removed) anonymous branch, patching `resolveFamiliesForMemberships`, extracting a shared attendee-checklist component (optional, not mandated)
