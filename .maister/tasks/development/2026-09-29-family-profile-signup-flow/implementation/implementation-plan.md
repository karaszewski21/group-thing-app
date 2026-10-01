# Implementation Plan: Family profile completion flow from a term signup

## Overview
Total Steps: 82
Task Groups: 11 (5 backend, 5 frontend, 1 test review/gates)
Expected Tests: about 55 new or updated focused tests across groups 1-10, plus up to 10 gap tests in group 11. The spec mandates an explicit test list (spec "Testing Approach"), so the total is above the usual 16-34 guideline. Each group stays within 2-8.

Source spec: `implementation/spec.md` (requirements 1-30 are referenced as R1..R30).
Red gate: `src/backend/tests/test_lightweight_family_members.py::test_listGuardians_childAndCaller_exposeRoleTypePerMember` must turn green (group 2).
Design context (binding): `analysis/design-context/INDEX.md` and `analysis/design-context/ascii/ui-mockups.md`. Coverage matrix: `implementation/visual-coverage.md`.

All paths below are relative to the repo root (`C:\Users\karas\Desktop\group-thing-app`). Backend commands run in `src/backend`, frontend commands in `src/frontend`.

### Global gates (checked in group 11)
- Backend: `uv run pytest` passes (in `src/backend`).
- Migration 0044 is applied to the local DB: `set -a; . ./.env; set +a; uv run alembic upgrade head` (in `src/backend`).
- Frontend: `npx vitest run` passes for all touched and new test files.
- Frontend type check: `npx tsc -p tsconfig.app.json --noEmit` shows **no new errors** compared with the baseline captured in step 7.1 (about 60 pre-existing errors). Zero errors overall is not required.

### Concurrency rules (shared-file serialization)
- `PanelDataContext.tsx` and `src/test/PanelPage.test.tsx` are touched by groups 7, 8 and 10. These run strictly in the order **7 → 8 → 10**.
- `app/families/guardians.py`, `service.py` and `router.py` are touched by groups 2 and 3, so **2 → 3**.
- `app/groups/schemas.py` and `app/groups/service.py` are touched by groups 4 and 5, so **4 → 5**.
- These groups can run concurrently: backend groups 3 and 5; frontend groups 6, 7 and the backend groups; frontend groups 8 and 9 (both after 6 and 7; they share no files).

---

## Implementation Steps

### Task Group 1: Database Layer (birth_year column)
**Dependencies:** None
**Files to Modify:** src/backend/alembic/versions/0044_user_profiles_birth_year.py, src/backend/app/users/models.py, src/backend/app/families/models.py, src/backend/tests/test_user_profile_birth_year.py
**Estimated Steps:** 6

- [ ] 1.0 Complete the database layer
  - [ ] 1.1 Write 2 focused tests in the new `tests/test_user_profile_birth_year.py` (integration, real PostgreSQL, `action_condition_expectedResult` naming)
    - `test_saveUserProfile_withBirthYear_persistsSmallInt`: persist a `UserProfile` with `birth_year=2018`, re-read it in a fresh select, and assert 2018.
    - `test_saveUserProfile_withoutBirthYear_defaultsNull`: persist it without the field and assert `None`.
  - [ ] 1.2 Create `alembic/versions/0044_user_profiles_birth_year.py` with `revision = "0044"` and `down_revision = "0043"`. Copy the header shape from `0043_restore_admin_permission.py`.
    - `upgrade`: `op.add_column("user_profiles", sa.Column("birth_year", sa.SmallInteger(), nullable=True))`.
    - `downgrade`: `op.drop_column("user_profiles", "birth_year")`.
    - Schema only: no backfill, no index, no CHECK (spec "Database Migration").
  - [ ] 1.3 Add `birth_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)` to `UserProfile` in `app/users/models.py`, with a one-line docstring or comment: "set only for CHILD family members".
  - [ ] 1.4 In `app/families/models.py`, fix the stale "CHILD currently unused" `FamilyRoleType` docstring. Do not change behaviour.
  - [ ] 1.5 Apply the migration locally (in `src/backend`): `set -a; . ./.env; set +a; uv run alembic upgrade head`. Verify that `uv run alembic current` reports `0044`. Run `uv run alembic downgrade -1 && uv run alembic upgrade head` once to prove reversibility.
  - [ ] 1.6 Ensure the database layer tests pass
    - `uv run pytest tests/test_user_profile_birth_year.py -q`
    - Run ONLY these 2 tests.

**Acceptance Criteria:**
- The 2 tests pass.
- Local DB is at revision 0044, and the downgrade/upgrade round-trip succeeds.
- `UserProfile.birth_year` is a nullable `SmallInteger` with no other model changes.

---

### Task Group 2: Backend Families API, member data (role_type, birth_year, PATCH)
**Dependencies:** 1
**Files to Modify:** src/backend/app/families/schemas.py, src/backend/app/families/guardians.py, src/backend/app/families/members.py, src/backend/app/families/service.py, src/backend/app/families/router.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_lightweight_family_members.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 10

- [ ] 2.0 Complete role-aware member data and child birth year (R5, R7, R9-R11)
  - [ ] 2.1 Write up to 7 new focused tests (the red-gate test already exists and is the eighth)
    - In `tests/test_lightweight_family_members.py`:
      - `test_createMembers_childWithBirthYear_persistsAndReturnsIt`: POST `/api/families/mine/members` with a CHILD `birth_year=2018` and a second CHILD with the field omitted. The response and a subsequent `GET /guardians` show 2018 and `null`, and `role_type == "CHILD"`.
      - `test_createMembers_guardianWithBirthYear_returns400`.
      - `test_createMembers_birthYearOutOfRange_returns400`: parametrize over 1899 and `date.today().year + 1`, both computed at test time. Assert `field_errors` contains `members.0.birth_year`. In the same test, or a sibling, show that `date.today().year` is accepted (201).
      - `test_patchBirthYear_guardianSetsAndClearsChildYear_returns200`: set 2019 and then `null`; the response is the member's `GuardianResponse`.
      - `test_patchBirthYear_nonGuardianOrUnknownMembership_rejected`: a non-guardian gets 403. A membership of another family, or a random UUID, gets 404.
      - `test_patchBirthYear_guardianTargetOrExtraField_returns400`: a target member with the GUARDIAN role gets 400 "Rok urodzenia można ustawić tylko dziecku". A body `{"birth_year": 2018, "name": "x"}` gets 400 because `extra="forbid"`.
    - In `tests/test_authorization_matrix.py`:
      - `test_resolveRequirement_patchFamilyGuardian_requiresEdit`: `resolve_requirement("PATCH", "/api/families/x/guardians/y")` resolves to EDIT.
  - [ ] 2.2 In `app/families/schemas.py`:
    - Add a shared module-level helper or validator, `_birth_year_not_in_future(v)`, that rejects `v > date.today().year` and reads `date.today()` on **every** call. A static `Field(le=...)` is forbidden.
    - Lower bound: `Field(default=None, ge=1900)`.
    - Add `birth_year: int | None = Field(default=None, ge=1900)` plus a `field_validator("birth_year")` to `CreateLightweightMemberRequest`. Add a `model_validator(mode="after")` that rejects a non-null `birth_year` when `role_type == "GUARDIAN"`.
    - Add `UpdateFamilyMemberRequest` with `model_config = ConfigDict(extra="forbid")` and a **required** `birth_year: int | None = Field(..., ge=1900)`, using the same field validator.
    - Add `role_type: Literal["GUARDIAN", "CHILD"]` and `birth_year: int | None = None` to `GuardianResponse`.
  - [ ] 2.3 In `app/families/guardians.py`, change `build_guardian_responses` (55-76) to fill `role_type` from the already-loaded `FamilyRole` and `birth_year` from the already-loaded `UserProfile`. `birth_year` is forced to `None` for GUARDIAN rows. Add no new query.
  - [ ] 2.4 In `app/families/members.py`, give `create_lightweight_family_member` a `birth_year: int | None = None` parameter and set it on the new `UserProfile`. `create_lightweight_members_batch` passes `item.birth_year` through.
  - [ ] 2.5 In `app/families/guardians.py`, add the public `get_family_for_guardian(db, family_id, caller_party_id) -> Family`, which calls `repository.get_family` (404) and then `_require_family_guardian` (403). Add `update_child_birth_year(db, family_id, family_membership_id, caller_party_id, birth_year) -> GuardianResponse`. It checks, in order:
    1. `get_family_for_guardian`;
    2. the membership exists, has `to_family_id == family_id` and is active (`valid_to IS NULL`), else `EntityNotFoundException`;
    3. the role is CHILD, else `ValueError("Rok urodzenia można ustawić tylko dziecku")`;
    4. it sets `UserProfile.birth_year`, flushes, and returns the built response for that member. Reuse `build_guardian_responses`.
  - [ ] 2.6 Export `get_family_for_guardian` and `update_child_birth_year` from `app/families/service.py` (`__all__`). Routers import only from the facade.
  - [ ] 2.7 In `app/families/router.py`, add `PATCH /api/families/{family_id}/guardians/{family_membership_id}` with `EditPrincipal`, mirroring the DELETE route (164-165). It resolves the caller via `get_profile_by_principal`, calls `service.update_child_birth_year`, and returns 200 `GuardianResponse`.
  - [ ] 2.8 In `app/core/authorization_matrix.py` (about line 134), widen the DELETE row for `^/api/families/[^/]+/guardians/[^/]+$` to `_methods("PATCH", "DELETE")`. Leave the GET row (#28, READ) unchanged.
  - [ ] 2.9 Run `uv run ruff check app/families app/core` and `uv run mypy app/families` if configured. Fix only issues introduced by this group.
  - [ ] 2.10 Ensure the group's tests pass
    - `uv run pytest tests/test_lightweight_family_members.py tests/test_authorization_matrix.py -q`
    - The red-gate test `test_listGuardians_childAndCaller_exposeRoleTypePerMember` is now GREEN, and the file's existing tests stay green.

**Acceptance Criteria:**
- The red-gate test passes, as do the new tests (7 or fewer).
- `GuardianResponse` carries `role_type` and `birth_year` with no added query in `build_guardian_responses`.
- The current-year bound is evaluated per validation call, and no static `le=` is used.
- PATCH order of checks: 404 family → 403 guardian → 404 membership → 400 role.

---

### Task Group 3: Backend Families API, access hardening (R24-R26)
**Dependencies:** 2
**Files to Modify:** src/backend/app/families/guardians.py, src/backend/app/families/primary_contact.py, src/backend/app/families/service.py, src/backend/app/families/router.py, src/backend/tests/test_families.py
**Estimated Steps:** 7

- [ ] 3.0 Restrict GuardianResponse-producing family routes to the family's own guardians
  - [ ] 3.1 Write 6 focused tests in `tests/test_families.py`
    - `test_getFamilyAndGuardians_unrelatedUser_returns403`: both `GET /api/families/{id}` and `GET /api/families/{id}/guardians`.
    - `test_getFamilyAndGuardians_guardianOfOtherFamily_returns403`
    - `test_getFamilyAndGuardians_ownGuardian_returns200WithRoleFields`: the guardians items include `role_type` and `birth_year`.
    - `test_getFamilyAndGuardians_unknownFamily_returns404` (random UUID).
    - `test_addGuardian_nonGuardianOrUnknownFamily_rejectedAndUnchanged`: 403 for a non-guardian, after which the family's member count is unchanged; 404 for a random UUID; 201 for the own guardian.
    - `test_makePrimary_nonGuardianOrUnknownFamily_rejectedAndUnchanged`: 403 for a non-guardian, after which the primary contact is unchanged; 404 for a random UUID; 200 for the own guardian. Membership-of-another-family still returns 404.
  - [ ] 3.2 Router `GET /api/families/{family_id}` (`router.py:118`) and `GET /api/families/{family_id}/guardians`: resolve the caller profile with `get_profile_by_principal`, then call `service.get_family_for_guardian(db, family_id, profile.party_id)` before building the response. Keep `ReadPrincipal`.
  - [ ] 3.3 `add_guardian(db, family_id, caller_party_id, data)` in `guardians.py:28`: add the parameter and call `get_family_for_guardian` first, then the existing logic.
  - [ ] 3.4 `make_primary_contact(db, family_id, family_membership_id, caller_party_id)` in `primary_contact.py:18`: add the parameter and call `get_family_for_guardian` first (import it from `guardians`, not the facade, to avoid an intra-package cycle), then the existing logic, including the existing 404 for a foreign or unknown membership.
  - [ ] 3.5 Routers `add_guardian` (`router.py:130`) and `make_primary_contact` (`router.py:151`): keep `EditPrincipal`, resolve the caller profile, and pass `caller_party_id`. Update any facade re-exports in `service.py` if the signatures are re-declared there.
  - [ ] 3.6 Re-run the existing guardian-self reads unchanged: `test_families.py` (186, 218, 231-235, 258, 269, 300) and `test_lightweight_family_members.py` (133, 187).
  - [ ] 3.7 Ensure the group's tests pass
    - `uv run pytest tests/test_families.py tests/test_lightweight_family_members.py -q`
    - Run only these files.

**Acceptance Criteria:**
- The 6 new tests pass, and the existing family tests stay green without edits.
- Check order is 404 (family) then 403 (guardian) on all four routes. Rejected writes change nothing.
- No new membership query is written: `_require_family_guardian` is reused, and the `AUTHORIZATION_MATRIX` GET row is unchanged.

---

### Task Group 4: Backend Groups, attendee children, term↔group check, deterministic family (R15, R16, R22, R27, R28)
**Dependencies:** 1, 2
**Files to Modify:** src/backend/app/groups/application/memberships.py, src/backend/app/groups/schemas.py, src/backend/tests/test_term_attendees.py
**Estimated Steps:** 8

- [ ] 4.0 Extend the organizer attendees use case and harden formalize
  - [ ] 4.1 Write 7 focused tests in the new `tests/test_term_attendees.py`. Reuse or copy the `_rsvp_with_family` seeding style from `test_group_privacy.py`, and create children through `POST /api/families/mine/members` with `birth_year`.
    - `test_listAttendees_familyWithChildren_returnsChildBirthYearsOnly`: guardians excluded; ordered by `birth_year` DESC with nulls last; the null is kept; the JSON has no names or ids inside `children`.
    - `test_listAttendees_attendeeWithoutFamilyOrChildren_returnsEmptyChildren`
    - `test_listAttendees_withdrawnRsvp_excluded`
    - `test_listAttendees_nonOrganizer_returns403`
    - `test_listAttendees_termOfOtherGroup_returns404`: also covers an unknown term UUID.
    - `test_listAttendees_partyInTwoFamilies_resolvesOldestFamily`: `family_id`, `family_name` and `children` come from the earlier-created family. Repeat the call to show the result is stable.
    - `test_formalize_termOfOtherGroup_returns404AndCreatesNoMembership`
  - [ ] 4.2 In `app/groups/schemas.py`, add `TermAttendeeChildResponse(BaseModel)` with `birth_year: int | None`, and add `children: list[TermAttendeeChildResponse] = []` (use `Field(default_factory=list)`) to `TermAttendeeResponse` (338).
  - [ ] 4.3 In `memberships.py`, add `_require_term_in_group(db, group_id, term_id)`. It loads the term through `repository.get_term` and raises `EntityNotFoundException` when the term is missing or `term.circle_group_id != group_id`.
  - [ ] 4.4 Call `_require_term_in_group` right after `_require_active_organizer` in both `list_term_attendees_for_formalization` (89) and `formalize_group_from_term` (123), so the order is 403 first, then 404.
  - [ ] 4.5 In `_resolve_party_families` (64-86), add `.order_by(Family.created_at, Family.id)`. With the existing `setdefault`, the oldest family wins. Update the docstring to state this.
  - [ ] 4.6 Add `_resolve_family_child_birth_years(db, family_ids) -> dict[uuid.UUID, list[int | None]]`. It is **one** batched select: `FamilyMembership` (`to_family_id IN ids`, `valid_to IS NULL`) → `FamilyRole` (role_type CHILD) → `UserProfile` on `party_id`, selecting `(to_family_id, birth_year)` and ordered `birth_year DESC NULLS LAST`. Group the rows in Python. Import `app.families.models` and `app.users.models.UserProfile` directly, as `_resolve_party_families` does; do NOT import `app.families.service`, because that would create a cycle. Return early with `{}` when `family_ids` is empty.
  - [ ] 4.7 In `list_term_attendees_for_formalization`, call the new function once over all resolved family ids and fill `children` per attendee (`[]` when the attendee has no family). Leave the existing per-membership `_group_role_party_id` loop untouched.
  - [ ] 4.8 Ensure the group's tests pass
    - `uv run pytest tests/test_term_attendees.py tests/test_add_active_membership.py tests/test_group_privacy.py -q`
    - The existing formalize and privacy tests stay green.

**Acceptance Criteria:**
- The 7 tests pass.
- Children lookup adds exactly one batched query plus one term lookup per request.
- No names or ids are in `children`, and the family resolution is deterministic (oldest wins).

---

### Task Group 5: Backend Groups, organizer term counts and public privacy assertion (R17, R23)
**Dependencies:** 2, 4
**Files to Modify:** src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/application/terms.py, src/backend/app/groups/service.py, src/backend/app/groups/schemas.py, src/backend/app/groups/router/terms.py, src/backend/tests/test_circles_router.py, src/backend/tests/test_group_privacy.py
**Estimated Steps:** 8

- [ ] 5.0 Add organizer-only signup counts to the terms list and prove the public payloads stay child-free
  - [ ] 5.1 Write 5 focused tests
    - In `tests/test_circles_router.py`:
      - `test_listTerms_organizer_returnsAttendeeAndChildCounts`: two RSVPs (child_count 2 and 1) plus one withdrawn RSVP give 2/3; a term with no RSVPs gives 0/0.
      - `test_listTerms_nonOrganizerMember_returnsNullCounts`
      - `test_getTerm_organizer_returnsNullCounts`: `GET /api/terms/{id}`.
      - (optional, per the spec) `test_listTerms_principalWithoutProfile_returns200NullCounts`. Write it only if an existing fixture can create a profile-less principal easily; otherwise note that it was skipped in the work log.
    - In `tests/test_group_privacy.py`:
      - `test_publicTermViewAndAccess_familyWithAgedChildren_exposeNoChildData`: an attendee's family has CHILD members with `birth_year`. The public circle/term view and the `GroupAccessResponse` JSON, searched recursively over keys, contain no `birth_year`, `children`, `attendee_count` or `child_count` keys. RSVP `child_count`, if part of an existing public shape, is checked against the existing contract only.
  - [ ] 5.2 In `infrastructure/repository.py`, add `count_active_attendances_by_term(db, term_ids) -> dict[uuid.UUID, tuple[int, int]]`. It is one grouped query: `SELECT term_id, COUNT(*), COALESCE(SUM(child_count), 0) ... WHERE term_id IN (...) AND withdrawn_at IS NULL GROUP BY term_id`. Reuse the withdrawn filter semantics of `list_active_attendances_for_term` (334). Return early with `{}` when `term_ids` is empty.
  - [ ] 5.3 In `application/terms.py`, add `list_terms_with_counts(db, circle_group_id, caller_party_id: uuid.UUID | None) -> list[tuple[Term, int | None, int | None]]`. It calls `_is_active_organizer` (from `circles.py`) once. Only for an organizer does it run the grouped query; missing term ids default to (0, 0). Non-organizers and callers without a profile get `(None, None)`.
  - [ ] 5.4 Export it from `app/groups/service.py`.
  - [ ] 5.5 In `schemas.py`, add `attendee_count: int | None = None` and `child_count: int | None = None` to `TermResponse` (132). Follow the defaulted derived-field precedent of `FamilyOut.child_count`.
  - [ ] 5.6 In `router/terms.py`, change `list_terms` (42-48):
    - Resolve the caller profile with `get_profile_by_principal` inside `try/except EntityNotFoundException` → `caller_party_id = None`. This is the same pattern as `app/groups/application/public_view.py:83`.
    - Call `service.list_terms_with_counts`.
    - Build each `TermResponse` with `model_validate(term)` and then set the two counts.
    - Other term endpoints are untouched, so the schema defaults give `null`.
  - [ ] 5.7 Run `uv run ruff check app/groups`.
  - [ ] 5.8 Ensure the group's tests pass
    - `uv run pytest tests/test_circles_router.py tests/test_group_privacy.py -q`

**Acceptance Criteria:**
- The 4-5 tests pass.
- Counts are non-null only for the active organizer, and come from one grouped query per list call.
- The terms list returns 200 with null counts for callers without a profile.
- The public term view and access JSON contain no child data or counts.

---

### Task Group 6: Frontend Shared Utilities (returnTo safety, Polish plurals, ages)
**Dependencies:** None
**Files to Modify:** src/frontend/src/utils/url.ts, src/frontend/src/utils/plural.ts, src/frontend/src/utils/age.ts, src/frontend/src/test/url.test.ts, src/frontend/src/test/plural.test.ts, src/frontend/src/test/age.test.ts
**Estimated Steps:** 5

- [ ] 6.0 Complete the pure helpers used by groups 8, 9 and 10
  - [ ] 6.1 Write 6 focused unit tests (Vitest, in `src/test/`)
    - `url.test.ts`:
      - `isSafeReturnPath` accepts `/x/grupa/1/term/2`.
      - It rejects `""`, `null`/`undefined`, `//evil.com`, `https://evil.com`, `/\evil`, `\\evil` and `evil`. Use a table-driven `it.each` that mirrors mockup 4's visibility table.
    - `plural.test.ts`:
      - `pluralPl(n, "zapis", "zapisy", "zapisów")` gives the right form for 1, 2, 5, 12, 22, 0 and 112.
      - Use a table-driven `it.each`.
    - `age.test.ts`:
      - `approxAge(year)` is `dayjs().year() - year`. Freeze time with `vi.setSystemTime`.
      - `formatApproxAge` gives "ok. 1 rok", "ok. 3 lata" and "ok. 8 lat".
      - `formatChildAges([2018, 2021, null])` gives "5, 8 lat, wiek nieznany" (computed against the frozen year): the numbers are sorted ascending to match the order in mockup 9, the plural follows the **last** number, and unknown years come last. An all-unknown list gives "wiek nieznany". The empty list is handled by the caller, which shows "brak dzieci w profilu rodziny".
  - [ ] 6.2 `src/utils/url.ts`: add `export function isSafeReturnPath(value: string | null | undefined): value is string`. It returns true only for a non-empty string that starts with `/`, does not start with `//`, and contains no `\`. Place it next to `isValidImageUrl`.
  - [ ] 6.3 `src/utils/plural.ts`: add `pluralPl(n, one, few, many)` with the standard Polish rule. Use `one` only for n === 1. Use `few` when n % 10 is 2-4 and n % 100 is not 12-14. Use `many` otherwise.
  - [ ] 6.4 `src/utils/age.ts`: add `approxAge(birthYear)`, `formatApproxAge(age)` ("ok. N rok/lata/lat") and `formatChildAges(birthYears)` ("5, 8 lat" plus "wiek nieznany"). Import `dayjs` **only** from `src/utils/dayjs.ts`.
  - [ ] 6.5 Ensure the utility tests pass
    - `npx vitest run src/test/url.test.ts src/test/plural.test.ts src/test/age.test.ts`

**Acceptance Criteria:**
- The 6 tests pass.
- There are no direct `"dayjs"` imports.
- The helpers are pure and have no React dependencies.

---

### Task Group 7: Frontend Id Widening (Term/Group ids to string) and additive API types (R29, TS mirrors)
**Dependencies:** None (run early; groups 8, 9 and 10 depend on it)
**Files to Modify:** src/frontend/src/api/terms.ts, src/frontend/src/api/groups.ts, src/frontend/src/api/reservations.ts, src/frontend/src/pages/panel/panelHelpers.ts, src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/pages/panel/PanelModals.tsx, src/frontend/src/components/panel/EditTermDialog.tsx, src/frontend/src/components/panel/FirstTermStepperGuest.tsx, src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx, src/frontend/src/pages/panel/views/RzeczyView.tsx, src/frontend/src/pages/panel/views/SpotkaniaView.tsx, src/frontend/src/pages/panel/views/HomeView.tsx, src/frontend/src/test/PanelPage.test.tsx, src/frontend/src/test/RzeczyViewCategory.test.tsx
**Estimated Steps:** 10

- [ ] 7.0 Widen Term and Group ids to `string` end to end, with no `String(...)` wrappers and no `Number()` or `parseInt` on ids
  - [ ] 7.1 Capture the type-check **baseline before any edit**. Run `npx tsc -p tsconfig.app.json --noEmit > <scratch>/tsc-baseline.txt` (the error count is about 60) and record the count and file list in the work log. Every later tsc comparison uses this baseline.
  - [ ] 7.2 Write or update 3 focused tests in `src/test/PanelPage.test.tsx`
    - `"Nowy termin" group select keeps the selected group's UUID`: pick a group in the PanelModals select, submit, and assert that `createTerm` receives `circle_group_id: "<uuid>"` (not `NaN`).
    - `formalize picker sends string party ids`: in the EditTermDialog formalize picker, assert that `formalizeGroupFromTerm(groupUuid, termUuid, ["<party-uuid>"])` is called. Fixtures gain `children: []`.
    - `getTerms is called with the group's UUID string`: assert `toHaveBeenCalledWith("<group-uuid>")` once the fixtures are converted.
  - [ ] 7.3 `src/api/terms.ts`:
    - Change `TermResponse.id` and `circle_group_id`, `CreateTermRequest.circle_group_id`, `NeededItemResponse.term_id` and `CreateNeededItemRequest.term_id` to `string`.
    - Change the params of `getTerms`, `getTerm`, `updateTerm` and `getNeededItems` to `string`.
    - Add `attendee_count: number | null` and `child_count: number | null` to `TermResponse`.
  - [ ] 7.4 `src/api/groups.ts`:
    - Change `GroupResponse.id` and `party_id`, `LeadershipResponse.to_group_id`, `MembershipResponse.to_group_id`, `TermAttendeeResponse.party_id` and `family_id`, and `MyAttendanceResponse.term_id` and `group_id` to `string`.
    - Change the params of `getGroup`, `updateGroupLayoutMode`, `getCurrentLeadership`, `getLeadershipHistory`, `getMembershipsForCircle`, `getTermAttendeesForFormalization(groupId: string, termId: string)` and `formalizeGroupFromTerm(groupId: string, termId: string, partyIds: string[])` to `string`.
    - Add `children: { birth_year: number | null }[]` to `TermAttendeeResponse`.
    - Fix the stale comment at 318-319, which says family-less attendees are not selectable.
  - [ ] 7.5 `src/api/reservations.ts`: `ReservationResponse.term_id?: string`. Leave the families, public, RSVP, join-request, exchange, pledges, termItemListings, `ModerationGroupResponse` and `AssignLeadershipRequest` types as `number`.
  - [ ] 7.6 Consumer adjustments (spec R29 list):
    - `panelHelpers.ts:99`: `termPublicPath(group, termId: string)`.
    - `PanelDataContext.tsx`:
      - `editTermId` (315), `editingGroupId` (320) and `termGroupId` (443) become `string | null`;
      - `groupExtras` (425) becomes `Record<string, …>`;
      - `handleRemoveGroup(groupId: string)` (874).
    - `PanelModals.tsx:278`: `setTermGroupId(e.target.value || null)`. This fixes the existing NaN bug.
    - `EditTermDialog.tsx`: `selectedPartyIds: Set<string>` (132) and `toggleAttendee(partyId: string)` (154).
    - `FirstTermStepperGuest.tsx:42` and `FirstTermStepperOrganizer.tsx:33`: `createdTermId: string | null`. `FirstTermStepperOrganizer.tsx:20`: `circleGroupId: string | null`.
    - `RzeczyView.tsx:113`: `(id): id is string`.
    - `SpotkaniaView.tsx` and `HomeView.tsx`: touch these only if tsc still reports new errors there after the changes above.
  - [ ] 7.7 Grep check: `rg -n "Number\(|parseInt\(|String\(" src/frontend/src` over the touched files. No numeric coercion of a Term or Group id and no `String(...)` wrappers may remain or be introduced. The category and product `Number(id)` calls are out of scope and stay.
  - [ ] 7.8 Convert the fixtures to UUID-like strings.
    - `PanelPage.test.tsx`: `mockGroup` 229-230, the term fixtures 263-276, and the listed sites at 370, 433, 479, 493, 509, 708, 748, 761, 774, 792, 804, 1208-1323, 1460-1690, 2109-2110 and 2720-2729. Update the matching `toHaveBeenCalledWith(<id>)` assertions.
    - `RzeczyViewCategory.test.tsx`: `term_id` at 87 and `mockTerm` at 98-99.
  - [ ] 7.9 Re-run `npx tsc -p tsconfig.app.json --noEmit` and diff it against the 7.1 baseline. Production code must have **zero new errors**, and all fixture errors introduced by the widening must be resolved. The pre-existing baseline errors may remain.
  - [ ] 7.10 Ensure the group's tests pass
    - `npx vitest run src/test/PanelPage.test.tsx src/test/RzeczyViewCategory.test.tsx`

**Acceptance Criteria:**
- The 3 tests pass, and the existing PanelPage and RzeczyViewCategory tests stay green.
- tsc shows no new errors compared with the baseline.
- There are no `Number()`/`parseInt`/`String()` coercions on Term or Group ids. The "Nowy termin" select keeps the UUID.

---

### Task Group 8: Frontend Family View (return to term, role label, birth year)
**Dependencies:** 6, 7 (shared `PanelDataContext.tsx` and `PanelPage.test.tsx`; also uses the group 2 API contract)
**Files to Modify:** src/frontend/src/api/families.ts, src/frontend/src/components/krag/RsvpDialogLoggedIn.tsx, src/frontend/src/pages/panel/views/RodzinaView.tsx, src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/components/panel/CreateFamilyDialog.tsx, src/frontend/src/test/PanelPage.test.tsx, src/frontend/src/test/TermPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:rsvp-dialog-logged-in
  locator: "Mockup 1: RSVP dialog banner", lines 66-103
  acceptance: Only the banner `<Link to>` changes, to `/panel/rodzina?returnTo=<encodeURIComponent(useLocation().pathname)>`. The copy "Przejdź do „Mój dom”", the "Pomiń" button and every class are unchanged. No new props.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:rodzina-populated
  locator: "Mockup 2: RodzinaView, populated state", lines 104-165
  acceptance: Member rows show role labels. CHILD rows show the meta line. The add form has an optional "Rok urodzenia" field directly below the "Rola" toggle, visible only while "Dziecko" is pressed. The "Wróć do terminu" button sits in an `mt-7` wrapper as the LAST element of the view.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:rodzina-empty
  locator: "Mockup 3: RodzinaView, empty state", lines 166-192
  acceptance: When `family === null`, the same return button renders under the dashed "Załóż rodzinę" card, only when `returnTo` is safe.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:return-to-term-button
  locator: "Mockup 4: Wróć do terminu button, states and flow", lines 193-240
  acceptance: A full-width secondary outline `<Link to={returnTo}>` with `<BackIcon aria-hidden>` and the text "Wróć do terminu". It is declared once as a local `ReturnToTermButton` in RodzinaView and used by both branches. It is visible only when `isSafeReturnPath(returnTo)`, which matches every row of the visibility table. It survives opening and closing CreateFamilyDialog.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:member-role-label
  locator: "Mockup 2", member list rows (RodzinaView :113-114), lines 104-165
  acceptance: A single `<span className="ml-1.5 text-ink-soft">` reading "(Ty)" when `party_id` equals the current profile's party, otherwise "(dziecko)" for CHILD, otherwise "(opiekun)". The self check wins.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:child-birth-year-inline
  locator: "Mockup 5: Inline birth-year edit on a CHILD row", lines 241-283
  acceptance:
    - Display state: "rocznik YYYY · ok. N lat" plus a pencil button whose `aria-label` includes the child's name.
    - Empty state: a "+ Dodaj rok urodzenia" text button.
    - Editing state: a numeric input and "Zapisz". Enter saves, Esc cancels, and blur with no change cancels. Only one row edits at a time.
    - Error state: the inline danger text "Podaj rok urodzenia z zakresu 1900–YYYY", with submit disabled.
    - Success: the toast "Zapisano rok urodzenia".
    - The editor follows the family-rename editor pattern (RodzinaView 56-91).
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:birth-year-field
  locator: "Mockup 6: Rok urodzenia field", lines 284-307
  acceptance:
    - `Field label="Rok urodzenia"` wrapping `<input type="number" inputMode="numeric" min={1900} max={currentYear} placeholder="np. 2018" aria-label="Rok urodzenia">`.
    - It is optional.
    - It shows a live "ok. N lat" hint when the year is valid.
    - It is hidden, and its value cleared, when "Opiekun" is pressed.
    - Focus does not move automatically when it appears.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:create-family-step2
  locator: "Mockup 7: CreateFamilyDialog step 2 with a child draft", lines 308-347
  acceptance:
    - The step-2 form shows the same birth-year field under the role toggle, only for "Dziecko".
    - The draft row suffix reads "Dziecko · ok. N lat" when a year is set.
    - `MemberDraft.birthYear` holds the year, and `birth_year` is sent only for CHILD drafts.
**Estimated Steps:** 10

- [ ] 8.0 Complete the family view flow
  - [ ] 8.1 Write 8 focused tests
    - Setup in `PanelPage.test.tsx`:
      - Add `role_type`/`birth_year` to `mockGuardians` (283-304), with one CHILD whose `birth_year` is 2018.
      - Give `renderPanel` (306-315) an optional `initialEntry` parameter, defaulting to `"/panel"`.
    - Tests in `PanelPage.test.tsx`:
      1. `role labels`: update the assertion at about :839. The self row shows "(Ty)", the other guardian "(opiekun)" and the child "(dziecko)".
      2. `birth-year field appears only for Dziecko and is sent only for CHILD`: the field is absent by default and appears after pressing "Dziecko". Switching to "Opiekun" hides and clears it. `createLightweightMembers` receives `birth_year: 2019` for the child.
      3. `inline birth-year edit saves and toasts`: click the pencil, type 2017, press Enter. `updateChildBirthYear(familyId, membershipId, 2017)` is called and "Zapisano rok urodzenia" is shown.
      4. `returnTo safe shows link; unsafe hides it`:
         - With `/panel/rodzina?returnTo=%2Fx%2Fgrupa%2F1%2Fterm%2F2`, the link "Wróć do terminu" has `href="/x/grupa/1/term/2"`.
         - With `returnTo=%2F%2Fevil.com`, there is no link.
      5. `empty family state shows the return button`.
      6. `CreateFamilyDialog step 2 sends birth_year for a child draft`: the draft row shows "Dziecko · ok. N lat".
      7. `add-member server error message shown verbatim`: `createLightweightMembers` rejects with an `ApiError` whose body is `{message: "..."}`, and that exact text appears.
    - Test in `TermPage.test.tsx`:
      8. `logged-in RSVP banner links to family view with returnTo`:
         - Add `vi.mock("../api/families")` with `getMyFamilies` resolving a family whose `child_count` is 0.
         - Assert that the banner `href` equals `/panel/rodzina?returnTo=<encodeURIComponent(term path)>`.
         - The existing logged-in RSVP tests stay green.
  - [ ] 8.2 `src/api/families.ts`:
    - `GuardianResponse` gains `role_type: "GUARDIAN" | "CHILD"` and `birth_year: number | null`.
    - `CreateLightweightMemberRequest` gains `birth_year?: number | null`.
    - Add `updateChildBirthYear(familyId, membershipId, birthYear: number | null)`, which sends a PATCH to `/api/families/{familyId}/guardians/{membershipId}` with `{ birth_year }`. Keep the families id types unchanged.
  - [ ] 8.3 `RsvpDialogLoggedIn.tsx`: change the banner link to ``to={`/panel/rodzina?returnTo=${encodeURIComponent(useLocation().pathname)}`}``. Nothing else changes.
  - [ ] 8.4 `PanelDataContext.tsx`:
    - Add `memberBirthYear` state next to `memberRole` (431-432).
    - `handleAddFamilyMember` (999-1013) sends `birth_year` only for CHILD. It resets name, role and year. On failure it shows `err.body.message` verbatim, in the same way as `handleRemoveFamilyMember` at 1015-1037, falling back to "Nie udało się dodać członka rodziny".
    - Add `saveChildBirthYear(membership, birthYear)`. It calls `updateChildBirthYear`, then `load({ silent: true })`, then shows the toast "Zapisano rok urodzenia", and returns or throws the error message for inline display. This follows the `saveRenameFamily` pattern (1046-1066).
    - Expose the new state and handler through the context value.
  - [ ] 8.5 `RodzinaView.tsx` labels: implement the role label with the self-check precedence (R6), replacing the current `(opiekun)` fallback at about 113-114.
  - [ ] 8.6 `RodzinaView.tsx` add form: add the birth-year `Field` under the role toggle (137-169), visible only when `memberRole === "CHILD"`. Clear the year when switching to GUARDIAN. Show the client validation text "Podaj rok urodzenia z zakresu 1900–YYYY" (YYYY is `dayjs().year()` from `src/utils/dayjs.ts`) for invalid input and disable submit. Show the live "ok. N lat" hint using `formatApproxAge`.
  - [ ] 8.7 `RodzinaView.tsx` CHILD row: add the meta line "rocznik YYYY · ok. N lat" plus the pencil button, or "+ Dodaj rok urodzenia" when the year is null. Add the inline editor, following the rename editor at 56-91, with local `editingBirthYearFor`, draft and error state. One row edits at a time. Enter saves, Esc cancels, and blur with no change cancels.
  - [ ] 8.8 `RodzinaView.tsx` return button:
    - Read `returnTo` with `useSearchParams()`.
    - Declare a local `ReturnToTermButton` (a full-width secondary outline `<Link>` with `BackIcon aria-hidden`).
    - Render it as the last element (`mt-7` wrapper) in both the populated and empty branches, guarded by `isSafeReturnPath`.
  - [ ] 8.9 `CreateFamilyDialog.tsx`:
    - Add `MemberDraft.birthYear` (18) and `draftBirthYear` state.
    - Show the field only when `draftRole === "CHILD"` (41), and reset it in `addDraftMember` (about 69).
    - The draft suffix reads "Dziecko · ok. N lat".
    - Map `birth_year` for CHILD drafts only (84-86).
    - On submit failure, set `formError` to the server `message` verbatim, with a fallback (89-90).
    - The dialog must not navigate, so `returnTo` is preserved.
  - [ ] 8.10 Ensure the group's tests pass
    - `npx vitest run src/test/PanelPage.test.tsx src/test/TermPage.test.tsx`
    - Re-run tsc and confirm no new errors compared with the baseline.

**Acceptance Criteria:**
- The 8 tests pass, and the existing PanelPage and TermPage tests stay green.
- Every Visual References `acceptance` item above is self-checked against `ui-mockups.md` lines 66-347.
- The OnboardingWizard is untouched, and `returnTo` is read only in RodzinaView.

---

### Task Group 9: Frontend Organizer Attendees Page (`/panel/terminy/:termId`)
**Dependencies:** 6, 7
**Files to Modify:** src/frontend/src/hooks/useTermAttendees.ts, src/frontend/src/pages/panel/TermAttendeesPage.tsx, src/frontend/src/router.tsx, src/frontend/src/test/TermAttendeesPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organizer-term-attendees
  locator: "Mockup 9: Organizer term attendees page", lines 386-450. The hook note at line 446 (`useTermAttendees(groupId, termId)`) and the "open point" about PanelDataContext are SUPERSEDED: use `useTermAttendees(termId: string)` and resolve the group through `term.circle_group_id`.
  acceptance:
    - The page always shows a back link to `/panel/spotkania` (OrganizationPage.tsx:89-91 idiom) and an h2 "Zapisani".
    - Summary line, only once the attendees have loaded: "N zapisów · M dzieci", or "Brak zapisów" when there are no attendees. M is the sum of `child_count`, and `pluralPl` is used for both nouns.
    - Read-only term head card: date tile, group name, time and description, and "Zobacz stronę terminu ›" linking to `termPublicPath(group, term.id)`. It renders only when both the term and the group have loaded, with no skeleton.
    - The rows are a `<ul>` inside a `rounded-[22px] border bg-paper p-5` panel.
    - The page renders in `PhoneFrame` with the PanelPage content column classes (`PanelPage.tsx:62`), without PanelDataProvider or PanelNav.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:term-attendee-row
  locator: "Mockup 9", attendee row block, lines 386-450
  acceptance:
    - The `<li>` has the classes `mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0`.
    - It shows `display_name`, and `family_name` when not null.
    - Pill:
      - "przychodzi bez dzieci" (`bg-cream text-ink-soft`) for 0;
      - "przychodzi z 1 dzieckiem" for 1;
      - "przychodzi z N dzieci" (`bg-mint-soft text-[#12604D]`) for 2 or more.
    - "dzieci w rodzinie: 5, 8 lat" comes from `formatChildAges`, with "wiek nieznany" last; an empty list shows "brak dzieci w profilu rodziny".
    - Ages only: no child names.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organizer-term-attendees-states
  locator: "Mockup 10: Organizer attendees page, states", lines 451-483. The combined 403/404 message is SUPERSEDED: they are split per R21.
  acceptance:
    - Precedence: denied → notFound → error → loading → ready.
    - Denied (403): "Nie masz dostępu do tego terminu.", `text-ink-soft`, no retry.
    - notFound (404): "Nie znaleziono tego terminu.", the same visual, no retry.
    - Error: the message plus a "Spróbuj ponownie" button that calls `refetch()`.
    - Loading: "Wczytywanie zapisanych…", preceded by the term card once the term and group are loaded.
    - Empty: "Nikt jeszcze nie zapisał się na ten termin."
    - In the denied, notFound and error states, the header is only the back link and "Zapisani", with no summary and no term card.
**Estimated Steps:** 7

- [ ] 9.0 Complete the organizer attendees page
  - [ ] 9.1 Write 7 focused tests in the new `src/test/TermAttendeesPage.test.tsx`
    - Setup:
      - `vi.mock("../api/terms")` and `vi.mock("../api/groups")` (factory functions), with `vi.resetAllMocks()` in `beforeEach`.
      - Render with `createQueryWrapper()` plus a MemoryRouter at `/panel/terminy/<uuid>`.
      - All ids are UUID-shaped strings.
    - Tests:
      1. `rows render name, family, pill wording and ages`: cover 0, 1 and N children, "dzieci w rodzinie: 5, 8 lat", "wiek nieznany", and "brak dzieci w profilu rodziny".
      2. `summary and empty state`: "N zapisów · M dzieci" with attendees; "Brak zapisów" plus "Nikt jeszcze nie zapisał się na ten termin." with none.
      3. `ids pass through uncoerced`: `getTerm` is called with the exact UUID. `getGroup` and `getTermAttendeesForFormalization` receive the term's `circle_group_id` UUID unchanged.
      4. `attendees 403 shows denied`: "Nie masz dostępu do tego terminu." and no retry button.
      5. `unknown term 404 shows notFound and never loads dependents`: `getTerm` rejects with an `ApiError` 404, so "Nie znaleziono tego terminu." is present, "Wczytywanie zapisanych…" is absent, and `getGroup` and `getTermAttendeesForFormalization` are never called.
      6. `getGroup 500 shows error with retry and minimal header`: "Spróbuj ponownie" is present. Only the back link and "Zapisani" show, with no term card.
      7. `generic attendees error retry refetches`: clicking "Spróbuj ponownie" calls `getTermAttendeesForFormalization` again.
  - [ ] 9.2 Create `src/hooks/useTermAttendees.ts` with `useTermAttendees(termId: string)`. It composes three `useQuery` calls:
    - `[TERM_KEY, termId]` → `getTerm(termId)`;
    - `[GROUP_KEY, groupId]` → `getGroup(groupId)`, enabled when `termQ.isSuccess`;
    - `[TERM_ATTENDEES_KEY, groupId, termId]` → `getTermAttendeesForFormalization(groupId, termId)`, enabled when `termQ.isSuccess`;
    - where `groupId = termQ.data?.circle_group_id`.
    - Use module-level prefix constants (`"term"`, `"group"`, `"termAttendees"`).
    - It returns `{ term, group, attendees (NO_ATTENDEES fallback), denied, notFound, error, loading, refetch }`, derived exactly as in R30:
      - `loading = termQ.isPending || (termQ.isSuccess && (groupQ.isPending || attendeesQ.isPending))`;
      - a disabled query never counts toward `loading`;
      - a `getGroup` failure of any status sets `error`.
    - `refetch` awaits the term refetch, then the dependents.
    - Do not coerce ids, and do not use `Number`.
  - [ ] 9.3 Create `src/pages/panel/TermAttendeesPage.tsx`:
    - It reads `useParams().termId` and passes it unchanged.
    - It renders the header, states, term head and the `<ul>` of rows per the Visual References.
    - It uses `pluralPl`, `formatChildAges`, `termPublicPath`, `dayMonth`/`termTime`, `BackIcon` and `PhoneFrame`.
    - Keep the row as a small local component (`TermAttendeeRow`).
  - [ ] 9.4 In `src/router.tsx`, add `{ path: "/panel/terminy/:termId", element: <AuthGuard><TermAttendeesPage /></AuthGuard> }` next to the `/panel` routes (about lines 89-95). It is an explicit three-segment route.
  - [ ] 9.5 Accessibility pass: semantic `<ul>/<li>`, `<Link>` for navigation, `aria-hidden` on decorative icons, and the h2 heading.
  - [ ] 9.6 Re-run tsc and confirm no new errors compared with the baseline.
  - [ ] 9.7 Ensure the group's tests pass
    - `npx vitest run src/test/TermAttendeesPage.test.tsx`

**Acceptance Criteria:**
- The 7 tests pass.
- The hook follows `standards/frontend/data-fetching.md`: array keys with prefix constants, an app-shaped return, and a stable empty fallback.
- An unknown term never sticks in loading.
- Every Visual References `acceptance` item is self-checked against `ui-mockups.md` lines 386-483.

---

### Task Group 10: Frontend Organizer Term Card Chip
**Dependencies:** 6, 7, 8 (serialized after 8 because both edit `PanelDataContext.tsx` and `PanelPage.test.tsx`), 9 (the chip target route must exist)
**Files to Modify:** src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/test/PanelPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organizer-term-card
  locator: "Mockup 8: Organizer term card with the sign-up summary chip", lines 348-385 (`organizerTermCard`, PanelDataContext.tsx 1075-1150)
  acceptance:
    - The chip sits on its own `mt-1.5` row below the needed-items row, outside the needed-items `flex-wrap`.
    - It renders even when the term has no needed items.
    - The right icon column, date tile and title are unchanged.
    - It appears in both HomeView and SpotkaniaView through the shared `organizerTermCard`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:signup-summary-chip
  locator: "Mockup 8", chip detail, lines 348-385
  acceptance:
    - It is a `<Link to={`/panel/terminy/${term.id}`}>` pill with the classes `rounded-full border border-line bg-paper px-2.5 py-0.5 text-[10.5px] font-extrabold text-ink`, an optional small `FamilyIcon` (`aria-hidden`) and a decorative `›` (`aria-hidden`).
    - Text: "N zapisów · M dzieci" (Polish plurals through `pluralPl`: zapis/zapisy/zapisów, dziecko/dzieci/dzieci), or "Brak zapisów" when `attendee_count === 0`.
    - `aria-label` is "Zapisani na termin: …" followed by the same sentence.
    - It is not rendered when `attendee_count` is `null`.
**Estimated Steps:** 4

- [ ] 10.0 Complete the organizer card chip
  - [ ] 10.1 Write 3 focused tests in `PanelPage.test.tsx`. The organizer term fixtures from group 7 gain `attendee_count`/`child_count`.
    - `organizer card shows signup chip linking to attendees page`: with counts 5/8, the text is "5 zapisów · 8 dzieci" and `href="/panel/terminy/<term-uuid>"`. Check the plural forms with a 2/1 or 22 case ("2 zapisy · 1 dziecko").
    - `organizer card shows "Brak zapisów" for zero attendees`
    - `no chip when counts are null`: the guest or non-organizer payload has `attendee_count: null`.
  - [ ] 10.2 In `organizerTermCard` (`PanelDataContext.tsx`, 1075-1150), add the chip row after the needed-items row. It reads `term.attendee_count` and `term.child_count` from the existing `terms` state, so no new request is made. Reuse the pill shape from 1105-1121.
  - [ ] 10.3 Visually self-check against mockup 8, both in HomeView and SpotkaniaView, through the test DOM or a manual `run` if available.
  - [ ] 10.4 Ensure the group's tests pass
    - `npx vitest run src/test/PanelPage.test.tsx`
    - Re-run tsc and confirm no new errors compared with the baseline.

**Acceptance Criteria:**
- The 3 tests pass.
- No per-term request is added, because the counts come from the `GET /api/terms` payload.
- The chip matches every Visual References `acceptance` item.

---

### Task Group 11: Test Review, Gap Analysis and Final Gates
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
**Files to Modify:** src/backend/tests/test_term_attendees.py, src/backend/tests/test_families.py, src/backend/tests/test_lightweight_family_members.py, src/frontend/src/test/TermAttendeesPage.test.tsx, src/frontend/src/test/PanelPage.test.tsx (append-only, gap tests only)
**Estimated Steps:** 7

- [ ] 11.0 Review the tests and fill critical gaps
  - [ ] 11.1 Review the tests from groups 1-10 (about 55) against the spec's "Testing Approach" list and the Success Criteria. Tick off each listed scenario.
  - [ ] 11.2 Analyze gaps for THIS feature only. Likely candidates:
    - PATCH with `birth_year = date.today().year` accepted;
    - make-primary for a membership of another family still returning 404 after the guardian check;
    - `formatChildAges` with all unknown years rendered on the page;
    - the RodzinaView inline editor's Esc cancel and invalid-year disabled-submit;
    - `returnTo` surviving the CreateFamilyDialog open and close.
  - [ ] 11.3 Write up to 10 additional strategic tests in the files listed above.
  - [ ] 11.4 Run the feature-specific tests:
    - backend: `uv run pytest tests/test_user_profile_birth_year.py tests/test_lightweight_family_members.py tests/test_families.py tests/test_authorization_matrix.py tests/test_term_attendees.py tests/test_circles_router.py tests/test_group_privacy.py -q`;
    - frontend: `npx vitest run src/test/url.test.ts src/test/plural.test.ts src/test/age.test.ts src/test/PanelPage.test.tsx src/test/TermPage.test.tsx src/test/TermAttendeesPage.test.tsx src/test/RzeczyViewCategory.test.tsx`.
  - [ ] 11.5 Final gates (required by the spec):
    - backend: the full `uv run pytest` in `src/backend` is green;
    - migration: `set -a; . ./.env; set +a; uv run alembic upgrade head` is applied and `alembic current` is `0044 (head)`;
    - frontend: the full `npx vitest run` is green. Note any pre-existing unrelated failures separately; do not fix them.
    - tsc: `npx tsc -p tsconfig.app.json --noEmit`, diffed against the baseline from step 7.1, shows NO new errors.
  - [ ] 11.6 Grep audits:
    - no `import dayjs from "dayjs"` in new code;
    - no `Number(`/`parseInt(`/`String(` on Term or Group ids;
    - routers import families only via `app.families.service`;
    - `memberships.py` does not import `app.families.service`.
  - [ ] 11.7 Write `implementation/visual-coverage.md` status updates if any screen's acceptance was not met, and record them in the work log.

**Acceptance Criteria:**
- All feature tests pass, with no more than 10 additional tests added.
- All four global gates pass: pytest, migration applied, vitest, and no new tsc errors.

---

## Execution Order

1. Group 1: Database Layer (6 steps)
2. Group 6: Frontend Shared Utilities (5 steps, no dependencies, can run in parallel with 1)
3. Group 7: Frontend Id Widening (10 steps, no dependencies, can run in parallel with 1 and 6)
4. Group 2: Backend Families member data (10 steps, depends on 1)
5. Group 3: Backend Families access hardening (7 steps, depends on 2)
6. Group 4: Backend attendees, term↔group check, deterministic family (8 steps, depends on 1 and 2; can run in parallel with 3)
7. Group 5: Backend term counts and privacy (8 steps, depends on 2 and 4; can run in parallel with 3)
8. Group 8: Frontend Family View (10 steps, depends on 6 and 7)
9. Group 9: Frontend Organizer Attendees Page (7 steps, depends on 6 and 7; can run in parallel with 8)
10. Group 10: Frontend Organizer Card Chip (4 steps, depends on 6, 7, 8 and 9)
11. Group 11: Test Review and Final Gates (7 steps, depends on all)

Serialized chains on shared files: 7 → 8 → 10 (`PanelDataContext.tsx`, `PanelPage.test.tsx`); 2 → 3 (`families/guardians.py`, `service.py`, `router.py`); 4 → 5 (`groups/schemas.py`).

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: error-handling (typed exceptions: 404 `EntityNotFoundException`, 403 `AccessDeniedException`, 400 `ValueError`/validation), validation (server-side range and role checks mirrored on the client, the allowlist `isSafeReturnPath`), minimal-implementation (no name editing, no OnboardingWizard input, no PanelDataContext migration, no dedupe), coding-style, commenting, conventions.
- `backend/`:
  - models.md: a nullable plain column; no cross-module `relationship()`.
  - migrations.md: the small reversible 0044, applied locally with `.env` loaded.
  - queries.md: batched `IN` and grouped queries, an explicit `ORDER BY`, bound params, and no new N+1.
  - security.md: the PATCH matrix row is widened, and fine-grained checks stay in services.
  - api.md: additive response changes; the PATCH is nested under the existing members path.
- `frontend/`:
  - data-fetching.md: the `useTermAttendees` hook, array keys with prefix constants, an app-shaped return, and `dayjs` only from `src/utils/dayjs.ts`.
  - components.md, accessibility.md (`aria-label`s, `<ul>/<li>`, `<Link>` navigation, no automatic focus move), responsive.md (phone-first single column), css.md (Tailwind tokens).
- `testing/`:
  - backend-testing.md: integration-first with real PostgreSQL and `action_condition_expectedResult` names.
  - frontend-testing.md: Vitest, `vi.mock` factories plus `vi.resetAllMocks`, and `createQueryWrapper()` for hook-backed components.
- Project notes:
  - Import groups and circulation code only through `app.<v>.service`, and families through `app.families.service`.
  - The app is pre-production, so add no backward-compat shims.

## Notes

- Test-Driven: each group starts with 2-8 tests. Group 2 includes the pre-existing red-gate test.
- Run Incrementally: after each group, run only that group's tests. The full suites run only in group 11.
- tsc baseline: capture it in step 7.1 BEFORE any frontend edit. The uncommitted `GroupHeader.tsx` and `test_lightweight_family_members.py` changes in the working tree are part of the baseline and the red gate. Do not revert them.
- Mark Progress: check off steps as they are completed.
- Reuse First: `build_guardian_responses`, `_require_family_guardian`, `_resolve_party_families`, `_is_active_organizer`/`_require_active_organizer`, the rename-editor pattern, `Field`, `BackIcon`/`FamilyIcon`/`PencilIcon`, `termPublicPath`, `PhoneFrame` and `useTermAccess` (hook shape).
- Superseded mockup details: mockup 9's `useTermAttendees(groupId, termId)` is replaced by `useTermAttendees(termId: string)`, and mockup 10's combined 403/404 message is split into denied and notFound.
