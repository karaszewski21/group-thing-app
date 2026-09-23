# Gap Analysis: Decouple "promote term attendees to members" from PUBLIC->PRIVATE flip

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium
- **Detected Characteristics**: modifies_existing_code, creates_new_entities (new UI integration point only), involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no (intentional behavior/architecture change, not a bug)
- Modifies existing code: yes (`formalize_group_from_term`, `EditTermDialog.tsx`, `models.py` docstring, `router/circles.py` docstring)
- Creates new entities: no new backend entities/tables; yes for a net-new frontend integration point (`KragGrupyPage.tsx` has zero formalize-related code today)
- Involves data operations: yes (`Membership` CREATE; family-list READ/display)
- UI heavy: yes (two frontend surfaces, one existing gate rework + one net-new section)

## Gaps Identified

### Missing Features
- No "promote to standing member" UI on `KragGrupyPage.tsx` (organizer's own group page) — confirmed via grep, zero formalize-related code exists there. Must be added per clarification Q3, reusing `useKragGrupy.ts`'s hook-mutation pattern (`useState` + toast + `await refetch()`) and the `isOrganizerViewer` gate already used for other organizer-only actions on this page.

### Incomplete Features
- `formalize_group_from_term` (`app/groups/application/memberships.py:125-163`) coalesces two independent concerns into one transaction and gates on one when it should only do the other:
  - Precondition to remove: `if group.visibility != GroupVisibility.PUBLIC: raise AccessDeniedException` (line 139-140).
  - Postcondition to remove: `group.visibility = GroupVisibility.PRIVATE` (line 160).
  - Eligibility filter to remove: `if party_id not in families: continue` (line 148-149) — per clarification Q2, family-less attendees must now also become members directly from `party_id`.
  - **Consequence not previously called out**: once the family filter is removed, the `_resolve_party_families` call inside `formalize_group_from_term` (line 145) becomes dead code for this function (its result is no longer consulted for anything) and should be deleted, not just have its result ignored — per the project's `minimal-implementation` standard (no unused computation left behind).

### Behavioral Changes Needed
- **Backend**: From "formalize = create Memberships AND flip PUBLIC→PRIVATE, only runnable while PUBLIC" to "promote = create Memberships only, runnable regardless of visibility, no eligibility requirement beyond being a current `TermAttendance` on `term_id`."
- **Frontend (`EditTermDialog.tsx`)**: From gating fetch/render/selection/copy on `group.visibility === "PUBLIC"` and `family_id !== null`, to gating on "has attendees not yet standing members" (derived from `already_member`) with no family requirement.
- **Frontend (new, `KragGrupyPage.tsx`)**: Add the equivalent organizer-only action, calling the same underlying `formalizeGroupFromTerm`/`getTermAttendeesForFormalization` API functions via a new `useKragGrupy.ts` mutation, targeting `currentTerm` (no term picker on this page).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | Only via `/panel` → edit-term dialog (internal/admin surface) | Also directly on the organizer's own group page (`/…/grupa/:groupId/term/:termId`) | ✅ improved — matches clarification Q3's intent |
| Discoverability | 5/10 (buried in an edit-term modal, panel-only) | 7/10 on `KragGrupyPage.tsx` if placed near other organizer-only actions (e.g., alongside "Wycofaj się z zajęć" / layout controls); panel entry stays at 5/10 | +2 on the new surface |
| Flow Integration | Organizer must leave the group page, go to `/panel`, open edit-term dialog | Organizer can act in-place on the page they're already viewing | ✅ positive |
| Multi-Persona | Organizer-only both before and after (via `_require_active_organizer` / `isOrganizerViewer`) | Unchanged, consistently enforced on both surfaces | ✅ consistent |

## Data Lifecycle Analysis

### Entity: `Membership` (standing group membership, created from a `TermAttendance`)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | `formalize_group_from_term` (memberships.py:125), `join_private_group` (public_view.py:384) | `EditTermDialog.tsx` checkbox list + "Formalizuj" button; new `KragGrupyPage.tsx` section (to be built) | Organizer-only via `_require_active_organizer`/`isOrganizerViewer`, reached from `/panel` today, from group page after this task | ✅ (after task) |
| READ | `list_term_attendees_for_formalization` (memberships.py:91), `getMembershipsForCircle` used in `useKragGrupy.ts`'s `resolveFamiliesForMemberships` | Attendee picker list (both dialogs); family-orbit visualization (`GroupVisualization`) on `KragGrupyPage.tsx` | Organizer for the picker; any logged-in viewer for the family-orbit display | ⚠️ **partial — see orphan finding below** |
| UPDATE | n/a for this task (membership `valid_to` handled by unrelated `end_membership`) | n/a | n/a | out of scope |
| DELETE | n/a for this task | n/a | n/a | out of scope |

**Completeness**: ~75% (CREATE will be complete and family-independent after this task; READ/display has a newly-identified gap below).

**Orphaned Operations (new finding, not present in codebase-analysis.md or clarifications.md)**:
`useKragGrupy.ts`'s `resolveFamiliesForMemberships` (lines 155-173) builds the family-orbit display **exclusively** from `getFamiliesForGuardianParty(partyId)` per member — `const family = families[0]; if (!family || ...) continue;`. Any `party_id` with **no resolvable Family is silently dropped from the family list entirely**. Once Q2 removes the family-eligibility filter from `formalize_group_from_term`, an organizer will be able to create a standing `Membership` for a family-less attendee (e.g., the "individual adult, music-class" scenario the clarification explicitly targets), but that new member will then be **invisible** in `KragGrupyPage.tsx`'s own family-orbit visualization (`GroupVisualization`) — the exact page this task adds the promote action to. This is a CREATE-succeeds/READ-silently-omits orphan, not covered by the existing `already_member` signal (which only gates the *picker*, not the *display*).
- `PanelDataContext.tsx` was checked and does **not** use this family-grouping pattern (grep found no matches), so this gap is specific to `KragGrupyPage.tsx`/`useKragGrupy.ts`.

**Missing Touchpoints**: family-less standing members are not represented anywhere in the group-page member visualization after promotion (see above) — this is a high-value gap directly caused by this task's own scope (Q2), not a pre-existing unrelated issue.

## Defect Analysis
Not applicable — no reproducible defect; this is a planned decoupling/extension of intentional existing behavior.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Family-less standing members are invisible in the family-orbit display after promotion**
   - Context: `resolveFamiliesForMemberships` in `useKragGrupy.ts` drops any member `party_id` without a resolvable `Family`. Q2 explicitly requires promoting family-less attendees (e.g., individual-adult music-class signups) to standing `Membership`. Without a display fix, those new members become real `Membership` rows that never appear anywhere on the group page — an orphaned-CREATE-without-visible-READ outcome, directly caused by combining this task's two clarified decisions (decouple + relax family filter).
   - Options:
     a. Extend `KragGrupyPage.tsx`'s member display (`GroupVisualization`/`resolveFamiliesForMemberships`) to also render family-less standing members as standalone entries (in scope for this task).
     b. Ship the promote action without a display fix, explicitly documenting that family-less members are "invisible but real" members for now (defer display work to a follow-up task).
     c. Restrict promotion of family-less attendees to the `/panel` surface only (asymmetric behavior between the two entry points) until display support exists.
   - Recommendation: (a) if scope/time allow — it directly follows from Q2's own stated motivation (individual adults with no family concept); otherwise (b) with an explicit call-out in the PR/spec so it isn't mistaken for a bug later. (c) is not recommended — it reintroduces an inconsistency between the two entry points that clarification Q3 was explicit about avoiding ("both call the same underlying backend operation").
   - Rationale: shipping Q2's family-relaxation without addressing this makes the promoted membership functionally invisible to the organizer on the very page this task is enhancing.

2. **`EditTermDialog.tsx`'s existing family-based UI logic must be reworked, not just its visibility gate**
   - Context: Beyond the `group.visibility === "PUBLIC"` gate already flagged in codebase-analysis.md, the dialog also (a) pre-selects only family-resolvable, non-member attendees (`rows.filter((r) => r.family_id !== null && !r.already_member)`, line ~146), (b) disables the checkbox for family-less attendees (`disabled={a.family_id === null || a.already_member}`, line ~456), and (c) shows "— brak rodziny, nie można ustalić" ("no family, cannot be assigned") next to family-less attendees (lines ~463-464). All three now contradict Q2 and must change together, or family-less attendees will remain unselectable/mislabeled in the UI even after the backend stops filtering them out.
   - Options: rework all three pieces of family-based logic in the same pass as the visibility-gate rework (recommended, single coherent change) vs. fix only the visibility gate now and leave the family-based UI restrictions as a follow-up (not recommended — leaves the panel UI actively contradicting the new backend behavior).
   - Recommendation: fix all three together; they are one cohesive UI concern (attendee eligibility display), not two separate changes.

### Important (Should Decide)
1. **Should `formalize_group_from_term` (and its schemas/route/API-client names) be renamed?**
   - Context: the function no longer "formalizes" anything (it never touches visibility); the task's own title calls this "promote term attendees to members." The name appears in: `memberships.py` function, `service.py` facade re-export, `router/circles.py` route handler + path segment `.../formalize`, `schemas.py`'s `FormalizeGroupFromTermRequest`, `api/groups.ts`'s `formalizeGroupFromTerm`/`getTermAttendeesForFormalization`, and multiple test names.
   - Options: (A) rename throughout (function, schema, hook method, route path) to something like `promote_term_attendees_to_members` for accuracy; (B) keep all names as-is to minimize diff/risk, and rely on updated docstrings/comments to correct the stale claims — the route path in particular is also an external API contract with no other consumers noted, so renaming it is low-risk here but still a scope/diff-size choice.
   - Default if undecided: (B) keep names, fix docstrings only — smallest diff, matches "minimal implementation" standard, and the DDD facade convention makes wide renames touch many files for a purely cosmetic gain.
   - Rationale for default: no functional benefit to renaming; stale docstrings are the actual risk (already covered by clarifications) and are cheap to fix without a rename.

2. **How should `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate` be handled?**
   - Context: clarifications.md already says it "must be rewritten," but doesn't specify in-place rewrite (same test name → new name, same slot) vs. leaving the old test name/assertions removed and adding fresh, separately-named test(s) alongside existing ones.
   - Options: (A) rewrite in place, renaming to reflect new behavior (e.g., `test_formalizeGroupFromTerm_organizer_createsMembershipWithoutChangingVisibility`) plus add one new test for "family-less attendee still gets a Membership" (Q2 coverage) and one for "PUBLIC group with standing Memberships still accepts anonymous RSVP" (regression coverage per codebase-analysis.md); (B) leave the old test deleted and write 2-3 new independently-named tests.
   - Default if undecided: (A) — matches the project's `action_condition_expectedResult` test naming convention and keeps one clear canonical test per behavior rather than a deleted-then-orphaned name in git history discussions.

## Recommendations
- Remove the now-dead `_resolve_party_families` call from `formalize_group_from_term` itself (its result is no longer used once the family filter is dropped) — keep `_resolve_party_families` for `list_term_attendees_for_formalization`, which still needs it to annotate the picker with family names for display purposes only.
- Update `GroupVisibility`'s docstring in `models.py` (lines 74-81) and the route docstring in `router/circles.py` (lines 195-199) to remove the "flips PUBLIC -> PRIVATE only via formalize_group_from_term" claim — already required by clarifications.md, confirmed still present in current code.
- Update the stale comment in `application/circles.py` around line 153-155 ("the one-way `PUBLIC -> PRIVATE` transition via `formalize_group_from_term` is the only path that also bulk-creates `Membership` rows") — this becomes false once decoupled and should be corrected or removed.
- Confirm `create_rsvp`/`join_private_group` in `public_view.py` need **no code changes**: both branch solely on `group.visibility`, verified by direct read — a PUBLIC group with standing Memberships continues to accept anonymous RSVP unchanged, and `join_private_group` still 404s for non-PRIVATE groups regardless of Membership state. Add a regression test rather than changing code.
- Resolve the critical family-orbit-display gap (see Critical #1) before or explicitly alongside shipping, since it directly undermines the stated purpose of Q2.

## Risk Assessment
- **Complexity Risk**: Low-Medium — the backend change itself is deletion of two guard clauses plus one filter line; complexity is concentrated in coordinating two frontend surfaces with consistent-but-not-identical gating logic.
- **Integration Risk**: Medium — `EditTermDialog.tsx`'s family-based selection/disable/copy logic (Critical #2) is a previously-unflagged integration point that must move in lockstep with the backend eligibility change, or the panel UI will contradict the new backend contract.
- **Regression Risk**: Medium — one existing backend test directly asserts the coupled (now-wrong) behavior and will fail the moment the backend changes; `test_public_term.py` and `PanelPage.test.tsx` should be re-run/extended per codebase-analysis.md's existing gap list.
- **UX Risk (new)**: Medium-High if unaddressed — family-less members can become "real but invisible" on the exact page this task is enhancing (Critical #1), directly contradicting the intent behind Q2's family-filter relaxation.

---

*This report supersedes nothing in `analysis/codebase-analysis.md` or `analysis/clarifications.md` — it adds two previously-unidentified findings (the family-orbit display orphan, and the specific family-based selection/disable/copy logic in `EditTermDialog.tsx` beyond its visibility gate) and surfaces two naming/test-structure decisions the clarifications left open.*
