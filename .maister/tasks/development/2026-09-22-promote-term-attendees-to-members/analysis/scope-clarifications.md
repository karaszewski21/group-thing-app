# Scope Clarifications (Phase 2 Decision Gate)

## Critical Decision 1: Family-orphan display gap

**Chosen approach (user-proposed, expanded)**: Instead of patching
`resolveFamiliesForMemberships`'s display logic directly, fix the root
cause: ensure every `Party` in the system has a resolvable `Family` by the
time it can become a standing member.

- On full registration (`/api/auth/register`), automatically create a
  solo `Family` for the new user with themself as the sole member, role
  "guardian"/opiekun (exact role naming to be confirmed against the
  existing `families` domain's role vocabulary during specification).
- On anonymous RSVP (`create_rsvp`'s anonymous branch in
  `application/public_view.py`, which creates a fresh `Party`+
  `UserProfile` in-line), apply the SAME solo-family creation — this is
  the critical extension, since this is group-thing-app's actual "Kasia's
  music class" scenario: attendees who never go through
  `/api/auth/register` at all.
- The "resolvable Family" eligibility filter inside the promote-to-member
  operation is still REMOVED per clarification Q2 (not re-added) — this
  keeps the operation robust for any pre-existing `party_id`s created
  before this change that still lack a family, and avoids a hard
  dependency between two bounded contexts (`groups` and `families`) for
  correctness.
- No additional patch to `useKragGrupy.ts`'s `resolveFamiliesForMemberships`
  is needed under this approach, since after this change every `party_id`
  reaching that function should have exactly one resolvable (possibly
  solo) `Family`.

**Rejected alternative**: Patching the frontend display function directly
to render family-less members as standalone entries. Not chosen — the
root-cause fix (every party has a family) is more consistent with the
existing family-centric data model used throughout groups/families/
exchange features, and avoids adding a second, parallel "no family"
rendering path to maintain.

**Follow-up implication for specification/planning phase**: this expands
scope to touch `app/families` (or wherever registration and anonymous
Party+UserProfile creation currently live) in addition to `app/groups`.
The specification-creator and implementation-planner must treat "create a
solo Family on registration and on anonymous Party/UserProfile creation"
as an explicit, separate requirement, not an incidental side effect.

## Important Decision 2: Keep `formalize_group_from_term` name

**Chosen**: Keep the existing function/schema/route/API-client names
unchanged (`formalize_group_from_term`, `FormalizeGroupFromTermRequest`,
`POST /groups/{id}/terms/{id}/formalize`, `formalizeGroupFromTerm`).
Only fix stale docstrings/comments that describe the now-removed
visibility-flip behavior (e.g. `GroupVisibility`'s docstring in
`models.py`, and any comment in `application/circles.py` referencing the
formalize-implies-private assumption).

## Important Decision 3: Rewrite existing test in place

**Chosen**: `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate`
is rewritten in place (renamed to reflect new behavior, e.g.
`test_formalizeGroupFromTerm_organizer_createsMembershipStaysPublic`)
rather than deleted and replaced by wholly separate new tests. Additional
new tests are still added alongside it for: family-less attendee
promotion, and a PUBLIC group with existing formalized members still
accepting anonymous RSVP afterward (per gap-analysis recommendations).

## Critical Decision 5 (added after spec review): require login to join a PRIVATE group

**Trigger**: While reviewing the spec's "out of scope" note that `join_private_group`
has the same anonymous, family-less Party-creation pattern as `create_rsvp`
(`application/public_view.py:384-467`), the user re-examined this path and
decided the underlying business rule should change, not just be patched
for family visibility.

**Chosen approach**: `join_private_group` (`application/public_view.py:384-467`)
must require an authenticated `principal` going forward. The anonymous
branch (lines 439-467, which today creates a fresh `Party`+`UserProfile`
with `account_user_id=None` and returns `attached_to_account=False`) is
REMOVED entirely. If no `principal`/logged-in profile is present, the
function raises an authentication-required error.

**Resulting behavior for an unauthenticated visitor using a private-group
join link**: reject with 401/403 and a message telling them to log in or
register (chosen over building a full login-redirect-then-return-to-link
flow, which is out of scope for this task).

**Rationale (user's own)**: dołączanie do prywatnej grupy powinno zawsze
wymagać konta — this removes the entire family-orphan risk for this path
at the source (every `principal`-backed profile can be guaranteed to have
a family via the same registration-time solo-family creation from
Decision 1, so no separate "also call create_solo_family_for_party from
join_private_group" wiring is needed here — the anonymous branch that
would have needed it no longer exists).

**Scope/consumer impact** (to be confirmed and detailed by the
specification-creator's update pass):
- Backend: `join_private_group`'s signature/behavior changes; its
  `AccessDeniedException`/auth-required error path; existing test
  `test_joinPrivateGroup_anonymous_createsStandingMembership`
  (`test_group_privacy.py`) is now testing removed behavior and must be
  rewritten (e.g. to assert 401/403 for anonymous, plus a new test for
  authenticated join).
- Frontend: `JoinPrivateGroupDialog.tsx` (not yet read in this task) will
  need investigation — does it currently collect a guardian name for
  anonymous join? If so, that form path is removed/replaced with a
  login/register prompt for unauthenticated visitors.
- This is now use-case-2/3/4-adjacent (family/teacher/coach join flows,
  previously reported as "fully supported, no changes needed" by the
  original research) — the specification-creator must confirm this
  tightening doesn't regress any currently-passing behavior for those
  scenarios beyond intentionally removing anonymous join.

## Important Decision 4: Fix all of EditTermDialog.tsx's family-coupled UI logic together

**Chosen**: In the same change, rework all four family/visibility-coupled
behaviors in `EditTermDialog.tsx` as one cohesive fix:
1. Render gate (currently `group.visibility === "PUBLIC"`) — needs a new
   condition not based on visibility (e.g. "has attendees for this term
   not yet members").
2. Default pre-selection (currently `family_id !== null && !already_member`)
   — drop the `family_id !== null` condition per Q2/family-auto-creation.
3. Disabled-checkbox condition (currently `family_id === null || already_member`)
   — drop the `family_id === null` condition; family-less attendees should
   no longer exist post-registration-fix, but the eligibility check itself
   should not gate on family regardless.
4. Copy referencing "brak rodziny, nie można ustalić" and the
   visibility-change warning — both removed/rewritten to match the new,
   decoupled, family-independent behavior.
