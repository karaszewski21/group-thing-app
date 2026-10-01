# Gap Analysis: Family-profile completion from a term sign-up, child role/age, organizer attendee view

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium (parts 1-3 low to moderate; part 4 moderate, more if a new page is built)
- **Detected Characteristics**: has_reproducible_defect, modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: yes. Children are labelled "(opiekun)" in RodzinaView (`RodzinaView.tsx:114`). The banner links to `/panel` instead of `/panel/rodzina`.
- Modifies existing code: yes (RsvpDialogLoggedIn, RodzinaView, PanelDataContext, CreateFamilyDialog, families schemas/guardians/members, groups memberships/schemas, EditTermDialog or organizer card)
- Creates new entities: yes. A new `birth_year` column (migration 0044), new response fields, and possibly a new organizer-only term details route.
- Involves data operations: yes (CREATE and READ of a child's birth year; READ of attendees with children)
- UI heavy: yes (banner link, return button, role label, conditional birth-year input in two forms, organizer attendee list or page)

## Gaps Identified

### Missing Features
- **Return-to-term flow**: nothing in the panel reads `returnTo`. `PanelDataContext.tsx` does not use `useSearchParams`, and `setView` (361-363) navigates to `/panel/<view>` without the query string. There is no safe-returnTo helper in the frontend. `AuthGuard.tsx:40-45` navigates to the raw `returnTo` without validating it, so the existing convention has no open-redirect guard to reuse.
- **Child birth year**: no age, birth or birth_year column exists anywhere (grep of `backend/app` found none). `CreateLightweightMemberRequest` and `GuardianResponse` have no such field. Neither form (RodzinaView add form 134-179, CreateFamilyDialog step 2) has the input.
- **Organizer sign-up visibility**: the organizer term card (`PanelDataContext.tsx:1075-1150`, used by HomeView:118 and SpotkaniaView:148) shows no sign-up information at all: no count and no list. The only attendee list is the "Formalizuj stałych członków" picker inside EditTermDialog (423-480). It fetches `child_count` but doesn't render it and has no ages. There is no organizer term-details route. `router.tsx` has only `/panel` and `/panel/:view`, so a two-segment route such as `/panel/terminy/:termId` would not collide.

### Incomplete Features
- **Banner in RsvpDialogLoggedIn (105-118)**: currently `<Link to="/panel">`. It needs to go to `/panel/rodzina?returnTo=<encoded term path>`. The component receives only `groupId`/`termId`. `useLocation().pathname` is the simplest source (it already matches the term route). Alternatively, `termPublicPath(group, termId)` can be passed from PublicTermView.
- **`build_guardian_responses` (`guardians.py:55-76`)**: it already loads the `FamilyRole` for each membership (`role` variable) but drops `role.role_type`. Adding `role_type` costs nothing. `birth_year` needs to come from wherever it is stored. Note that the loop issues two queries per membership (an existing N+1). This is acceptable for family sizes but can be noted.
- **`list_term_attendees_for_formalization` (`memberships.py:89-120`)**: it resolves `party_id -> (family_id, family_name)` in one batched query. It needs a second batched query: active CHILD members of the resolved family ids, with display_name and birth_year. `_resolve_party_families` must keep importing families **models** directly because of the groups↔families cycle.
- **`TermAttendeeResponse` (`groups/schemas.py:338-351`)**: it needs a `children: list[...]` field (name?, birth_year/age).

### Behavioral Changes Needed
- Member label: change "(opiekun)" for everyone else to a label based on role: "(Ty)", "(opiekun)" or "(dziecko)". The existing test `PanelPage.test.tsx:839` asserts the buggy behaviour and must be changed.
- The birth-year input appears only when the "Dziecko" toggle is active. The backend must reject `birth_year` for GUARDIAN (model validator) and validate the range (e.g. 1900..current year, or narrower).
- `FamilyRoleType` docstring ("CHILD currently unused") is stale; fix it in passing.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (family from term) | Banner → `/panel` (home), user must find "Mój dom" via AccountMenu | Banner → `/panel/rodzina?returnTo=…` | ✅ |
| Return to term | None (back button / manual navigation) | "Wróć do terminu" at bottom of RodzinaView | ✅ |
| Discoverability of return | 1/10 | 8/10 (bottom of view; may be below the fold on phone after long member list) | +7 (consider also after CreateFamilyDialog "done" step) |
| Organizer sign-up info | 1/10 (only visible, without child counts, inside Edit dialog's formalize picker) | 7-9/10 depending on location (card summary + list/page) | +6..8 |
| Flow integration | Returning to term re-mounts RsvpDialogLoggedIn → refetches `getMyFamilies` → prefill child_count | same, works | ✅ |

**Persona impact**
- Parent (guest, logged in): benefits from return flow, correct labels and birth year.
- Organizer: gains the attendee view. The organizer is also a parent and uses the same RodzinaView.
- Anonymous visitor: unchanged. Child data must not appear in `PublicCircleResponse`, `PublicGuardianResponse` or `AttendeeList`.
- Lightweight child profiles: cannot log in, so there is no persona impact.

**Edge cases found**
- The `returnTo` search param survives the CreateFamilyDialog flow naturally. The dialog is a modal (`PanelModals.tsx:94-101`) that only calls `setModal(null)` and `load()`, with no navigation. However, any `setView` call (hamburger or tab switch) drops it. This matches the spec intent ("visible on the family view"). If the user leaves the view, losing the param is acceptable. Otherwise it must be kept in context state.
- Open redirect: `returnTo` must be `startsWith("/") && !startsWith("//")` (and not contain `\`). A bare `startsWith("/")` check lets `//evil.com` through as a protocol-relative URL.
- Double counting: if two guardians of the same family both RSVP, the organizer sees the same children twice. `_resolve_party_families` uses `setdefault`, so a party that belongs to several families shows only the first family's children.

## Data Lifecycle Analysis

### Entity: Child birth year (`birth_year`, CHILD members only)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing. Planned: `POST /api/families/mine/members` (`members.py:24-83`) with `birth_year` | Missing. Planned: RodzinaView add form and CreateFamilyDialog step 2 | `/panel/rodzina` (AccountMenu:71), and "Załóż rodzinę" modal | ❌ → planned |
| READ (family owner) | Missing. Planned: `GuardianResponse.birth_year` or computed `age` | Missing. Planned: shown next to the "(dziecko)" label | `/panel/rodzina` | ❌ → planned |
| READ (organizer) | Missing. Planned: `TermAttendeeResponse.children` | Missing. Planned: attendee list | EditTermDialog / card / new page (decision) | ❌ → planned |
| UPDATE | **No endpoint** exists for editing a family member (router has only family-level `PATCH /api/families/{id}` rename) | No edit UI for members | none | ❌ **orphan risk** |
| DELETE | Soft-close via the existing `DELETE` guardians endpoint (`remove_family_member`) removes the whole member | Trash button in RodzinaView (117-126) | yes | ✅ (whole member) |

**Completeness (after the planned scope)**: 75%. CREATE and READ are covered and DELETE works through member removal, but UPDATE is missing.
**Orphaned operations**:
- Existing CHILD members (all current rows) get `birth_year = NULL`, and there is no way to set it later. The only workaround is to delete and re-add the child. The same applies to typos made at creation.
- OnboardingWizard also creates CHILD members through the batch API. Without an input there, children created in onboarding have no birth year, and there is no edit path to add one.

**Missing touchpoints**: OnboardingWizard (creates children); organizer card on HomeView/SpotkaniaView (sign-up summary).

### Entity: Term sign-up with children (organizer view, read-only)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | `POST /api/groups/public/{gid}/rsvp` (exists) | RsvpDialog / RsvpDialogLoggedIn | term page | ✅ |
| READ (organizer) | `GET /api/groups/{gid}/terms/{tid}/attendees` exists (organizer-gated via `_require_active_organizer`) but lacks children | EditTermDialog list doesn't render child_count | only via pencil → Edit dialog → formalize section | ⚠️ partial |
| DELETE (withdraw) | exists (`test_attendance_withdrawal.py`) and is filtered out of the list | — | — | ✅ |

## Defect Analysis

### Reproduction Data
- Steps: log in → `/panel/rodzina` → add member "Zosia", role Dziecko → list shows "Zosia (opiekun)".
- Expected: "Zosia (dziecko)". The current user is shown as "(Ty)" and is the guardian (already true in the backend: `create_lightweight_members_batch` bootstraps the caller as GUARDIAN and primary contact).
- Actual: every member who is not the current user is labelled "(opiekun)".
- Second defect: the banner on the term RSVP dialog links to `/panel` (home view), not `/panel/rodzina`.

### Root Cause Hypothesis
`GuardianResponse` has no `role_type`, so `RodzinaView.tsx:114` can only compare `party_id` against the current profile and hard-codes "(opiekun)".

### Regression Risk Areas
- `PanelPage.test.tsx:821-885` (Rodzina tests, the :839 assertion), 888-1080 (CreateFamilyDialog), ~1255-1340 (formalize picker, which uses `TermAttendeeResponse`).
- `TermPage.test.tsx:493-540`. This test doesn't mock `../api/families`, so the banner link test needs a mock.
- `test_lightweight_family_members.py`, `test_families.py` (response shape), `test_group_privacy.py:152-156` (attendees endpoint).
- OnboardingWizard and its tests (batch API contract; `birth_year` must be optional).
- The stale `number` ID types in `api/families.ts` versus UUIDs. Don't widen the problem; typing the new fields correctly is enough.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Existing children have no way to set a birth year (UPDATE orphan)**. After migration 0044, all existing CHILD rows have NULL `birth_year`, and no member-edit endpoint or UI exists.
   - Options: (A) add a minimal edit path: `PATCH /api/families/{fid}/members/{membership_id}` with `birth_year` (and optionally name), plus an inline edit in RodzinaView; (B) accept delete-and-re-add as the workaround and show "wiek nieznany" in the organizer view; (C) edit birth year only (no name edit).
   - Recommendation: C (or A if name editing is wanted). Without it, the organizer's ages are empty for every existing family, and typos are permanent.
2. **Location of the organizer UI** (the user suggested "list in panel, per term, maybe a new organizer-only term details page").
   - Options: (A) new route `/panel/terminy/:termId` (organizer-only page: attendee list with child count and ages), linked from `organizerTermCard` with a summary chip such as "5 zapisanych · 7 dzieci"; (B) expandable attendee list inside `organizerTermCard` only; (C) render child_count and ages inside EditTermDialog's existing formalize list only.
   - Recommendation: A, plus a summary chip on the card. This matches the user's wording and keeps EditTermDialog focused on editing. Note that the card summary needs counts for every card. Fetching the attendees endpoint per card causes N requests, so either fetch lazily on the details page and show no counts on the card, or add a count to the terms payload. Decide the card-chip data source.

### Important (Should Decide)
1. **Where `birth_year` lives**.
   - Options: `user_profiles.birth_year` (a person attribute) or `family_roles.birth_year` (role-scoped).
   - Default: `user_profiles.birth_year SMALLINT NULL`.
   - Rationale: birth year belongs to the person, not the role. It survives role changes and is reusable elsewhere. The CHILD-only rule is enforced in the families service and schema. Guardians' profiles simply stay NULL. `build_guardian_responses` already loads the profile.
2. **Extend the existing attendees endpoint or add a new one**.
   - Options: (A) add a `children` field to `TermAttendeeResponse` / `GET …/terms/{tid}/attendees`; (B) a new organizer endpoint, e.g. `GET …/terms/{tid}/signups`.
   - Default: A.
   - Rationale: the endpoint already has the same organizer-only gate and filters out withdrawn sign-ups. The change is additive, and the formalize picker ignores the extra field.
3. **API shape for age**.
   - Options: return `birth_year` and compute age on the frontend (dayjs), or return a computed `age` from the backend.
   - Default: return `birth_year`; the frontend shows "ok. N lat" computed from `dayjs().year() - birth_year`.
   - Rationale: a year-only value gives an approximate age; the label should say so or show "rocznik 2018".
4. **Show children's names to the organizer, or ages only?**
   - Options: names and ages, or ages only (e.g. "2 dzieci: 5, 8 lat").
   - Default: ages only (data minimisation for minors).
   - Rationale: the user asked for "ile dzieci, ile lat".
5. **Organizer child count: the RSVP `child_count` versus the family's children**. These can differ, for example when a parent brings 1 of 3 children.
   - Default: show the RSVP `child_count` as "przychodzi z N dzieci" and the family's children's ages as "dzieci w rodzinie: 5, 8, 11 lat".
   - Rationale: the clarification binds ages to the family profile, and the count should not be silently replaced.
6. **Deduplicating families** when two guardians of one family both RSVP.
   - Default: no dedupe; list per attendee as today.
   - Rationale: keep it simple; note it in the spec.
7. **Birth-year input in OnboardingWizard**.
   - Options: add it there too, or leave it out (API field optional).
   - Default: leave it out.
   - Rationale: the user named only RodzinaView and CreateFamilyDialog. If the UPDATE path (critical 1) is added, children from onboarding can have their birth year filled in later.
8. **Migrate families data fetching to TanStack Query** (the data-fetching standard requires hooks in `src/hooks/`).
   - Options: (A) keep PanelDataContext's hand-rolled `load()` for family changes, and write *new* organizer page fetching as a TanStack hook (`useTermAttendees`); (B) migrate all family calls to hooks.
   - Default: A.
   - Rationale: B is a scope expansion into a 1638-line context. A new page has no legacy constraint, so it should follow the standard.
9. **Placement of "Wróć do terminu"** and whether it also appears in CreateFamilyDialog's "done" step.
   - Default: the bottom of RodzinaView only (both the empty state and the populated state), as the user specified. The param survives the modal automatically.
   - Rationale: the button stays visible after the dialog closes.
10. **returnTo validation helper**.
    - Default: add a small shared `isSafeReturnPath()` (`/`-prefixed, not `//`, no `\`). Use it for the new button only; do not retrofit AuthGuard.
    - Rationale: stays in scope. Retrofitting AuthGuard would be a separate hardening task and could be offered to the user.

## Recommendations
- Backend: migration `0044` adds `user_profiles.birth_year SMALLINT NULL`. Add `birth_year: int | None` with a range check to `CreateLightweightMemberRequest`, plus a model validator that rejects it for GUARDIAN. Add `role_type` and `birth_year` to `GuardianResponse`. Add `children: list[TermAttendeeChild]` to `TermAttendeeResponse`, filled by one batched query over the resolved family ids. The query imports families models directly.
- Frontend: banner → `/panel/rodzina?returnTo=${encodeURIComponent(location.pathname)}`. RodzinaView reads `useSearchParams` and shows the button if the path is safe. Add the role-aware label, and show the birth-year input only for CHILD in both forms. The organizer page/list uses a new TanStack hook.
- Tests: backend integration tests for `birth_year` persisted / rejected for a guardian / `role_type` in the response, the attendees endpoint's children and ages, a 403 for non-organizers, and absence from the public circle response. Frontend: the label fix (:839), the conditional input, the returnTo button visible/hidden/unsafe cases, the banner href (mock families), and the organizer list rendering.

## Risk Assessment
- **Complexity Risk**: Medium. Part 4 plus a new page and possibly a member-edit endpoint.
- **Integration Risk**: Medium. The groups↔families import cycle, the PanelDataContext size, and query-param handling across `setView`.
- **Regression Risk**: Low-Medium. Changes are additive, the field is optional, and one known test assertion must change. The privacy boundary on the public endpoints must be verified by a test.
