# Codebase Analysis Report

**Date**: 2026-09-29
**Task**: Family-profile completion flow from a term sign-up, child role/age handling, and organizer visibility of sign-ups
**Description**: On page /panel/rodzic (parent/family panel). When a user signs up for a term (termin) and has no completed family profile, a modal on the term page asks them to complete it. Requirements: 1) Add a query param so after completing the family the user can return to the term -> "Wróć do terminu" button at the bottom of the family panel. 2) Fix: when adding a family member with role "child", the current user should be (shown as) guardian (opiekun). 3) Add an "age" (wiek) field only for children. 4) For the organizer: show info that someone signed up, how many children and their ages.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## Summary

The feature touches three areas: the logged-in RSVP dialog on the public term page, the family panel (`/panel/rodzina`, not `/panel/rodzic`), and the organizer's term views. Parts 1 and 2 are small frontend changes plus one new field on the backend (`role_type` on `GuardianResponse`). Part 3 needs a new database column (migration 0044) and schema, service and form changes. Part 4 is the largest and least defined. Sign-ups only store a `child_count` number per adult (`TermAttendance`) and are not linked to individual children. There are no RSVP notifications. The organizer's only attendee list (inside EditTermDialog) doesn't even show `child_count` today.

Discrepancies with the task wording (verified):
- There is no `/panel/rodzic` route. The family panel is `/panel/rodzina` (served by `/panel/:view`, heading "Mój dom").
- The "complete family" prompt is **not a modal**. It is an inline banner inside `RsvpDialogLoggedIn.tsx` (lines 105-118). It links to bare `/panel` (line 111), not `/panel/rodzina`, and carries no term context.
- The panel shows **every** non-self member as "(opiekun)", children included (`RodzinaView.tsx:114`). This happens because `GuardianResponse` has no `role_type`. This is most likely the actual bug behind requirement 2. The current user is already stored as GUARDIAN and primary contact in the backend.

---

## Files Identified

### Primary Files

**src/frontend/src/components/krag/RsvpDialogLoggedIn.tsx** (132 lines)
- Logged-in RSVP form. Calls `getMyFamilies` in a useEffect (39-57). `hasChildPrefill = family && child_count >= 1` (62). Shows the banner "Dodaj rodzinę, aby uzupełnić liczbę dzieci" with `<Link to="/panel">` and "Pomiń" (105-118). Submits `createRsvp(groupId, {term_id, guardian_name, child_count})` (65-81).
- Only receives `groupId` and `termId`, so the return URL must be built from these (or passed as props from PublicTermView).

**src/frontend/src/pages/panel/views/RodzinaView.tsx** (182 lines)
- Family panel view. Empty state 30-50 ("Załóż rodzinę" → modal `rodzina-nowa`). Header with rename and count 52-97. Member list 105-128 ("(Ty)" for self, "(opiekun)" for everyone else, line 114). Add form 134-179: "Imię i nazwisko" + Opiekun/Dziecko toggle (aria-pressed), default GUARDIAN.
- Needs the role-aware label, an age input that appears only for CHILD, and the "Wróć do terminu" button.

**src/frontend/src/pages/panel/PanelDataContext.tsx** (1638 lines)
- Hand-rolled panel state. VIEW_VALUES 246-254, `useParams` view 270, family state 279-280/305-309, `memberName`/`memberRole` 431-432, `load()` 540-547 (myFamilies[0] + getGuardians), `handleAddFamilyMember` 999-1013 (`createLightweightMembers([{name, role_type}])` → toast → load), remove/rename 1015-1066, `setView` → `navigate('/panel/'+next)` 361-363, silent reload ~623-645, organizerTermCard 1075+.
- Does not use `useSearchParams` today. Navigating between views drops the query string.

**src/frontend/src/api/families.ts** (126 lines)
- `getMyFamilies` 64, `createOwnFamily` 81, `renameFamily` 86, `getGuardians` 94, `removeFamilyMember` 108, `createLightweightMembers` 122 (body `{members:[{name, role_type}]}`). `GuardianResponse` and `CreateLightweightMemberRequest` types need `role_type` and age fields. IDs are typed `number`, but the backend has used UUIDs since migration 0041 (stale).

**src/backend/app/families/schemas.py** (102 lines)
- `CreateLightweightMemberRequest` (role `Literal["GUARDIAN","CHILD"]`, l.78). `GuardianResponse` (85-97: family_membership_id, party_id, user_profile_id, display_name, email, is_primary_contact, valid_from, valid_to; **no role_type or age**). `FamilyOut.child_count`.

**src/backend/app/families/guardians.py** (152 lines)
- `build_guardian_responses` 55-76 returns all active memberships (guardians and children). This is where `role_type` (and age) must be joined in. Also contains `_require_family_guardian`, `remove_family_member` (409 on removing the last guardian) and `add_guardian`.

**src/backend/app/families/members.py** (83 lines)
- `create_lightweight_family_member` 24-57: Party(PERSON) + UserProfile(account_user_id=None, email=None) + FamilyRole(role_type) + FamilyMembership(is_primary_contact=False). `create_lightweight_members_batch` 60-83: uses the caller's first family, or bootstraps "Rodzina {display_name}" with the caller as GUARDIAN and primary contact. Commits once. Age must be persisted here.

**src/backend/app/families/models.py** (102 lines)
- `Family`, `FamilyRole` (party_id, role_type GUARDIAN/CHILD varchar(20) non-native enum, valid_from/to), `FamilyMembership` (from_role_id → to_family_id, is_primary_contact; partial unique index allowing one active primary contact). The `FamilyRoleType` docstring is stale ("CHILD currently unused"). There is no age or birth column anywhere.

**src/backend/app/groups/application/memberships.py**
- `_resolve_party_families` 64-86 (imports families models directly to avoid an import cycle). `list_term_attendees_for_formalization` 89-120 (organizer-only). This is the natural place to add children and ages for the organizer.

**src/backend/app/groups/schemas.py**
- `PublicGuardianResponse` and `PublicCircleResponse` 271-288 (docstring: no per-child data leaks publicly). `CreateRsvpRequest`/`RsvpResponse` 319-331. `TermAttendeeResponse` 338-351 (party_id, display_name, child_count, family_id, family_name, already_member). `MyAttendanceResponse` 380-395.

**src/frontend/src/components/panel/EditTermDialog.tsx** (483 lines)
- The only organizer attendee list: "Formalizuj stałych członków" (fetch 129-178, render 423-480). Shows a checkbox, display_name and family_name. `child_count` is fetched but **not rendered**.

### Related Files

**src/frontend/src/pages/krag/PublicTermView.tsx** (220): renders RsvpDialogLoggedIn (122-139). Has `group.organizer_slug`, `groupId` and `term.id` available for building the return path.
**src/frontend/src/pages/krag/TermPage.tsx** (45): route `/:organizationSlug/grupa/:groupId/term/:termId` (the slug is cosmetic).
**src/frontend/src/router.tsx** (148): `/panel`, `/panel/:view` 89-95; term route 107.
**src/frontend/src/pages/krag/hooks/useTermSignUp.ts** (40): anonymous users see AuthGateSheet first; success toast and refetch.
**src/frontend/src/components/krag/RsvpDialog.tsx** (85): anonymous RSVP (creates a solo family on the backend).
**src/frontend/src/components/panel/CreateFamilyDialog.tsx** (~150): three-step flow. Step 2 drafts members with roleType → `createLightweightMembers`. Needs an age input for children and should ideally honour returnTo.
**src/frontend/src/components/onboarding/OnboardingWizard.tsx**: also calls the batch member API and must stay compatible if age becomes optional.
**src/frontend/src/pages/panel/panelHelpers.ts**, **PanelPage.tsx** (l.69), **PanelModals.tsx** (93-100 create family, 107+ EditTermDialog), **panelComponents.tsx** (ModalSheet 101, Field 92).
**src/frontend/src/components/shared/AccountMenu.tsx** (l.71 links `/panel/rodzina`).
**src/frontend/src/components/auth/AuthGuard.tsx** (35-45), **LoginPage.tsx** (17), **RegisterPage.tsx** (22), **OnboardingPage.tsx** (49): existing `returnTo` query-param convention to follow.
**src/frontend/src/api/groups.ts** (504): `createRsvp` 308, `TermAttendeeResponse` 320-327, `getTermAttendeesForFormalization` 329-333, `formalizeGroupFromTerm` 336-341. The stale comment at 318-319 says family-less attendees are not selectable, but they are.
**src/frontend/src/pages/panel/views/SpotkaniaView.tsx**, **HomeView.tsx**: organizer term cards. Candidate locations for a sign-up summary.
**src/backend/app/families/router.py** (182): GET `/mine` 46, POST `/mine` 61, PATCH 76, POST `/mine/members` 90, guardians GET 139 / DELETE 159.
**src/backend/app/families/repository.py**: `list_families_for_guardian_party` 177, `count_active_child_members` 210, `list_guardian_memberships` 229. Imports `app.groups` (a groups ↔ families cycle).
**src/backend/app/families/bootstrap.py**: `bootstrap_family_for_party` 22-51.
**src/backend/app/users/models.py**: UserProfile (party_id, account_user_id nullable, display_name, email). **users/service.py** 236-238 creates a solo family "Rodzina {display_name}" at registration.
**src/backend/app/groups/models.py**: `TermAttendance` 284-310 (term_id, party_id, child_count, withdrawn_at).
**src/backend/app/groups/application/public_view.py**: `create_rsvp` 359-468 (idempotent upsert; `guardian_name` is ignored when logged in). `get_public_circle_view` 164-290. `list_my_attendances` 95-132.
**src/backend/app/groups/router/circles.py**: RSVP POST ~146-162 (OptionalPrincipal). Attendees GET 165-178 (EditPrincipal + `_require_active_organizer`, non-withdrawn only).
**src/backend/app/notifications/models.py**: `NotificationType` has no RSVP type.
**src/backend/app/core/authorization_matrix.py** 122-136: family endpoints in the matrix.
**src/backend/alembic/versions/0043_restore_admin_permission.py**: latest revision. The next migration is `0044`.

---

## Current Functionality

### Key Components/Functions

- **RsvpDialogLoggedIn**: the family counts as "completed" when it has at least one active child (`child_count >= 1`). Otherwise the dialog shows the banner linking to `/panel`. "Pomiń" reveals the numeric "Liczba dzieci" input.
- **RodzinaView + handleAddFamilyMember**: adds one lightweight member (name + role), then reloads the family. Labels come only from a `party_id` comparison with the current profile.
- **create_lightweight_members_batch**: if the caller has no family, it bootstraps one with the caller as GUARDIAN and primary contact. Children are login-less Party/UserProfile records with a CHILD FamilyRole and are linked only to the Family.
- **create_rsvp**: one `TermAttendance(term_id, party_id, child_count)` per adult. Children are a number and are never linked to the term. Anonymous sign-ups create Party + UserProfile + solo family.
- **list_term_attendees_for_formalization**: organizer-only list with child_count and family info, shown only in EditTermDialog. `child_count` is not rendered there.

### Data Flow

Term page → RsvpDialogLoggedIn → `GET /api/families/mine` → banner or prefilled child count → `POST /api/groups/public/{group_id}/rsvp` → `TermAttendance` upsert.
Family panel → PanelDataContext.load → `GET /families/mine` + `GET guardians` → RodzinaView. Adding a member → `POST /families/mine/members` → members.py → Party/UserProfile/FamilyRole/FamilyMembership.
Organizer → EditTermDialog → `GET /groups/{gid}/terms/{tid}/attendees` → memberships.list_term_attendees_for_formalization (via `_resolve_party_families`).
Identity chain: auth.User → UserProfile.account_user_id → party_id → FamilyRole → FamilyMembership → Family.

### Failure Points / Behavioural Notes

- Every registered user gets a solo family at registration, so `family === null` almost never happens for logged-in users. In practice the banner shows because `child_count` is 0.
- The banner goes to `/panel` (the home view), not `/panel/rodzina`.
- Children are labelled "(opiekun)". Test `PanelPage.test.tsx:839` currently asserts this wrong behaviour.
- All consumers take `families[0]`. Multiple families are not handled.

---

## Dependencies

### Imports (What This Depends On)

- React Router (`useParams`, `useNavigate`, `useSearchParams`, `Link`) for the returnTo handling.
- `api/families.ts` and `api/groups.ts` (plain fetch wrappers; families are **not** on TanStack Query).
- Backend: SQLAlchemy async models (BaseEntity with UUID ids), Pydantic v2 schemas, Alembic.
- groups ↔ families import cycle, handled with deferred imports and direct model imports.

### Consumers (What Depends On This)

- **PanelDataContext.tsx**: most family API functions (load, add, remove, rename, guest circles 589).
- **RodzinaView.tsx**: family state and the role toggle.
- **CreateFamilyDialog.tsx**, **OnboardingWizard.tsx**: `createLightweightMembers`.
- **RsvpDialogLoggedIn.tsx**: `getMyFamilies`, `createRsvp`.
- **EditTermDialog.tsx**: `getTermAttendeesForFormalization`, `formalizeGroupFromTerm`.
- Backend: `main.py` (router), `users/service.py` (registration solo family), `groups/application/public_view.py:450` (anonymous RSVP solo family), `groups/application/memberships.py` and `exchange_summary.py` (families models).

**Consumer Count**: ~9 files
**Impact Scope**: Medium. `GuardianResponse` is additive. The age column is additive. Organizer data changes stay behind an organizer-only endpoint.

---

## Test Coverage

### Test Files

- **src/backend/tests/test_families.py** (366): create-own, rename, remove, child_count excludes guardians (:334).
- **src/backend/tests/test_lightweight_family_members.py**: batch bootstrap, CHILD persisted (:96), members appear in `build_guardian_responses`, cannot log in.
- **src/backend/tests/test_families_bootstrap.py**, **test_registration.py**.
- **src/backend/tests/test_rsvp.py** (281), **test_public_term.py** (491), **test_my_attendances.py**, **test_attendance_withdrawal.py**, **test_group_privacy.py** (`_rsvp_with_family` :46; attendees endpoint only at :152-156), **test_add_active_membership.py**, **test_authorization_matrix.py**, **test_circles_router.py**.
- **src/frontend/src/test/PanelPage.test.tsx** (3020): mocks `../api/families` (:54), mockFamily :251, mockGuardians :283. Rodzina section 821-885 (the :839 "(opiekun)" assertion must change). CreateFamilyDialog 888-1080. Rename 1084. Remove 1132-1180. Formalize picker ~1255-1340.
- **src/frontend/src/test/TermPage.test.tsx** (558): sign-up states 191-224, logged-in RSVP dialog 493-540, payload 505-522. Does **not** mock `../api/families`.
- OnboardingWizard.test.tsx, OnboardingHandoff.test.tsx.

### Coverage Assessment

- **Test count**: good backend integration coverage of families and RSVP. Solid frontend panel coverage.
- **Gaps**: no backend test asserts the attendees endpoint's response fields, 403 behaviour or withdrawn exclusion. The family-completion heuristic (banner visibility) is untested. TermPage tests don't mock families. There are no tests for role labels or age.

---

## Coding Patterns

### Naming Conventions

- **Components**: PascalCase, views in `pages/panel/views/*View.tsx`, dialogs `*Dialog.tsx`.
- **Functions**: camelCase `handleX` handlers in PanelDataContext. Backend snake_case with `_require_*` guard helpers.
- **Files**: backend `models.py`/`schemas.py`/`router.py`/`service.py` per vertical. Migrations `NNNN_description.py`.

### Architecture Patterns

- **Style**: functional React with a large Context provider. Backend router → service facade → modules. The families vertical is behind a facade (import from `app.families.service`).
- **State Management**: local useState in PanelDataContext with a manual `load()` refetch. The new-code standard is TanStack Query hooks, but families have not been migrated.
- **UI**: Tailwind (`rounded-xl border-[1.5px] border-line bg-cream`), toggle buttons with `aria-pressed`, busy-disabling, Polish error strings, `ApiError.status` checks, ModalSheet + Field.
- **Backend**: Pydantic Request/Response/Out classes with `from_attributes`, Field constraints, Literal enums, field_validators. Soft-close via `valid_to`. Cross-module references as FK ids only. `AccessDeniedException` (403) and `BusinessConflictException` (409). String-backed enums.
- **returnTo convention**: `encodeURIComponent(pathname+search)` (AuthGuard) and `navigate(searchParams.get("returnTo") || "/panel")` (OnboardingPage).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | PanelDataContext 1638, EditTermDialog 483, others <250 | Medium-High |
| Dependencies | router, families/groups APIs, SQLAlchemy, Alembic | Medium |
| Consumers | ~9 files | High (7+) |
| Test Coverage | good backend, good panel FE, gaps on attendees/banner | Medium |

### Overall: Moderate

Parts 1 and 2 are simple. Part 3 is moderate (migration, schema, service, two forms). Part 4 ranges from moderate to complex depending on scope. Rendering child_count plus children's ages from the attendee's family is moderate. Linking specific children to a sign-up or adding real notifications is complex.

---

## Key Findings

### Strengths
- The backend already models children as CHILD FamilyRoles with lightweight profiles. The caller is always GUARDIAN and primary contact.
- There is an established `returnTo` query-param convention to reuse.
- An organizer-only attendees endpoint already exists and returns child_count and family info. It can be extended without exposing data publicly.
- Backend integration tests cover families and RSVP well.

### Concerns
- Task wording mismatches: the route is `/panel/rodzina`, and the prompt is an inline banner, not a modal.
- Sign-ups don't identify which children attend. "Ages of signed-up children" can only be approximated as "ages of children in the attendee's family" unless the sign-up model changes.
- Age vs birth date: a stored integer age goes stale. Storing `birth_date` (or birth year) and deriving the age is more robust, but the user asked for "wiek". This needs a decision.
- Where to store age: `user_profiles` (a person attribute) vs `family_roles` (role-specific). A CHILD-only rule favours validation at the schema/service level.
- Public views must keep hiding per-child data (see the `PublicGuardianResponse` docstring).
- PanelDataContext is huge and hand-rolled. `setView` drops query params, so returnTo must survive view changes and the CreateFamilyDialog flow.
- "Completed family" = `child_count >= 1` is a heuristic, and it is untested.
- There is no notification infrastructure for RSVPs. "Show info that someone signed up" probably means UI display, not push notifications.

### Opportunities
- Add `role_type` (and `age`) to `GuardianResponse`. This fixes the labels and powers the age display with one change.
- Render child_count (and ages) in the organizer's attendee list. SpotkaniaView/HomeView term cards could also show a signup summary.
- Fix stale artifacts along the way: the FamilyRoleType docstring and the `api/groups.ts:318-319` comment.

---

## Impact Assessment

- **Primary changes**: RsvpDialogLoggedIn.tsx, RodzinaView.tsx, PanelDataContext.tsx, api/families.ts, families/schemas.py, guardians.py, members.py, models.py, new migration 0044, groups/schemas.py (`TermAttendeeResponse`), groups/application/memberships.py, EditTermDialog.tsx (and/or an organizer term view), api/groups.ts.
- **Related changes**: CreateFamilyDialog.tsx (age for draft children, returnTo), OnboardingWizard.tsx (compatibility), PublicTermView.tsx (pass the term path), SpotkaniaView/HomeView (optional summary).
- **Test updates**: PanelPage.test.tsx (the :839 label assertion, new age/returnTo tests), TermPage.test.tsx (banner link, needs a families mock), test_lightweight_family_members.py (age and role_type in the response, CHILD-only age validation), new attendees-endpoint backend test (child ages, organizer-only 403).

### Risk Level: Medium

The changes are additive, and organizer data stays behind an organizer-only endpoint. The risk comes from the schema migration, the large PanelDataContext, the privacy boundary (child ages must not leak through public views) and ambiguity in requirement 4.

---

## Recommendations

**Requirement 1 (return to term):**
- Change the banner link to `/panel/rodzina?returnTo=<encodeURIComponent(term path)>`, building the path from `organizer_slug`/`groupId`/`termId` in PublicTermView or the current `location.pathname`.
- In the panel, read `returnTo` with `useSearchParams`. Render "Wróć do terminu" at the bottom of RodzinaView when it is present. Make sure `setView` and the CreateFamilyDialog flow keep the param, or store it in context.
- Validate that `returnTo` is a relative path starting with `/` (open-redirect guard, allowlist-over-blocklist standard).
- On return, RsvpDialogLoggedIn refetches `getMyFamilies` on mount, so the prefilled child count updates.

**Requirement 2 (guardian label):**
- Add `role_type: Literal["GUARDIAN","CHILD"]` to `GuardianResponse` (backend) and the TS type. Join the active FamilyRole in `build_guardian_responses`.
- In RodzinaView, label members "(Ty)", "(opiekun)" or "(dziecko)" by role. Confirm with the user whether "current user should be guardian" means only the display fix or a backend check too. The backend already makes the caller GUARDIAN on bootstrap.

**Requirement 3 (age for children):**
- Add a nullable column in migration 0044. Recommendation: `birth_year` or `birth_date` rather than a raw age, but confirm with the user. Put it on `user_profiles` or `family_roles`.
- Extend `CreateLightweightMemberRequest` with an optional `age` and add a model validator that rejects it for GUARDIAN. Persist it in `create_lightweight_family_member`, expose it in `GuardianResponse`, and show the input only when the Dziecko toggle is active (RodzinaView and CreateFamilyDialog step 2).
- Consider an edit path for existing children, which currently can only be renamed at the family level. Out of scope unless requested.

**Requirement 4 (organizer info):**
- Minimal scope: extend `TermAttendeeResponse` with `children: [{display_name, age}]` resolved from the attendee's active family CHILD members in `list_term_attendees_for_formalization` (organizer-only). Render child_count and ages in the organizer UI: EditTermDialog's list, or a dedicated attendee summary on the organizer term card/view.
- Clarify with the user whether "someone signed up" requires a notification (new NotificationType and delivery, larger scope) or just visibility in the organizer's term view.
- Keep public endpoints (`PublicGuardianResponse`) free of child data.

**Testing:** follow the integration-first backend standard (2-8 tests per feature) and the Vitest + testing-library panel/term tests, updating the existing "(opiekun)" assertion.

---

## Next Steps

1. Invoke gap-analyzer with this report.
2. Clarify with the user: (a) route naming (`/panel/rodzina` confirmed as the target), (b) age vs birth date and where to store it, (c) the scope of requirement 4 (UI summary vs notification; family children vs children actually attending), (d) whether "Wróć do terminu" should also appear after the CreateFamilyDialog flow.
3. Then proceed to specification and planning.
