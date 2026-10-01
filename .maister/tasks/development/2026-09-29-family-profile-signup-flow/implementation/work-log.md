# Work Log

## 2026-10-01 - Implementation Started

**Total Steps**: 82
**Task Groups**: 1 Database, 2 Families member data, 3 Families access hardening, 4 Attendees/term-group/deterministic family, 5 Organizer term counts + privacy, 6 FE utilities, 7 FE id widening, 8 FE family view, 9 FE organizer page, 10 FE card chip, 11 Test review + gates

**Wave plan** (deps + disjoint Files to Modify):
- Wave 1: 1, 6, 7
- Wave 2: 2, 8, 9
- Wave 3: 3, 4
- Wave 4: 5, 10
- Wave 5: 11

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-10-01 - Group 6 Complete (wave 1)

**Steps**: 6.1-6.5 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md (dates), testing/frontend-testing.md, global/validation.md, global/coding-style.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 25 passed (3 files, table-driven)
**Files Modified**: src/frontend/src/utils/url.ts (isSafeReturnPath), utils/plural.ts (pluralPl), utils/age.ts (approxAge, formatApproxAge, formatChildAges), src/test/{url,plural,age}.test.ts
**Notes**: Git-Bash heredoc dropped backslashes in test data; fixed via Edit. formatChildAges returns "" for empty list (caller shows "brak dzieci w profilu rodziny").

## 2026-10-01 - Group 1 Complete (wave 1)

**Steps**: 1.1-1.6 completed
**Standards Applied**:
- From plan: backend/models.md, backend/migrations.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 2 passed (tests/test_user_profile_birth_year.py); ruff clean
**Files Modified**: alembic/versions/0044_user_profiles_birth_year.py (created), app/users/models.py, app/families/models.py (FamilyRoleType docstring), tests/test_user_profile_birth_year.py (created)
**Notes**: Local DB migrated to 0044 (round-trip downgrade/upgrade verified). Model-level test needed `import app.auth.models` for the users FK (candidate standard).

## 2026-10-01 - Group 7 Complete (wave 1)

**Steps**: 7.1-7.10 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, testing/frontend-testing.md, global/coding-style.md, global/minimal-implementation.md
- From INDEX.md: global/validation.md
- Discovered: none
**Tests**: 3 new R29 tests pass; PanelPage+RzeczyViewCategory 87 passed / 27 failed. The 27 failures are PRE-EXISTING at HEAD (identical names on a git-archive HEAD copy): stale "Menu" hamburger and related UI drift. List: implementation/panelpage-baseline-fails.txt
**tsc**: baseline 58 errors (implementation/tsc-baseline.txt) -> 58 after, 0 new
**Files Modified**: api/terms.ts, api/groups.ts, api/reservations.ts, panelHelpers.ts, PanelDataContext.tsx, PanelModals.tsx (NaN bug fix), EditTermDialog.tsx, FirstTermStepperGuest.tsx, FirstTermStepperOrganizer.tsx, RzeczyView.tsx, SpotkaniaView.tsx (synthetic term count fields), test/PanelPage.test.tsx, test/RzeczyViewCategory.test.tsx
**Notes**: Frontend test gate for later groups = no new failures beyond the 27 baseline. Candidate standard: Term/Group ids are UUID strings; never Number()/parseInt route params/select values.

## 2026-10-01 - Group 9 Complete (wave 2)

**Steps**: 9.1-9.7 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, testing/frontend-testing.md, frontend/components.md, accessibility.md, css.md, responsive.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 7 passed (TermAttendeesPage.test.tsx), incl. unknown-term 404 (no loading text, dependents never called)
**tsc**: 58 -> 58, 0 new
**Files Modified**: src/hooks/useTermAttendees.ts (created), src/pages/panel/TermAttendeesPage.tsx (created), src/router.tsx (route inside AuthGuard), src/test/TermAttendeesPage.test.tsx (created)
**Visual**: mockups 9/10 followed; deviation: 0-children pill gets border border-line (cream on cream otherwise invisible). Error state shows mockup headline + extractProblemMessage detail.
**Notes**: Candidate standard: dependent queries gated on parent isSuccess; disabled queries never count toward loading.

## 2026-10-01 - Group 2 Complete (wave 2)

**Steps**: 2.1-2.10 completed
**Standards Applied**:
- From plan: backend/api.md, backend/security.md, backend/models.md, backend/queries.md, global/error-handling.md, global/validation.md, testing/backend-testing.md
- From INDEX.md: global/coding-style.md, global/commenting.md
- Discovered: get_db does not auto-commit -> update_child_birth_year commits (mirrors remove_family_member)
**Tests**: 37 passed (test_lightweight_family_members.py + test_authorization_matrix.py), RED-GATE TEST NOW GREEN; test_families.py 13 passed
**Files Modified**: app/families/{schemas,guardians,members,service,router}.py, app/core/authorization_matrix.py, tests/test_lightweight_family_members.py, tests/test_authorization_matrix.py
**Notes**: GUARDIAN+birth_year -> 400 with field key members.0 (model validator). Pre-existing ruff I001/E501 and mypy bootstrap.py:64 left untouched.

## 2026-10-01 - Group 8 Complete (wave 2; first run stalled, resumed)

**Steps**: 8.1-8.10 completed
**Standards Applied**:
- From plan: frontend/components.md, accessibility.md, css.md, responsive.md, data-fetching.md, global/validation.md, testing/frontend-testing.md
- From INDEX.md: none further
- Discovered: project memory "port UX faithfully, Tailwind only"
**Tests**: PanelPage+TermPage 118 passed / 19 failed. PanelPage baseline: 15 of 27 pre-existing failures FIXED (family suites now render at /panel/rodzina; "Mój dom" lives in header AccountMenu), 12 remain (hamburger promotion 6, home hints 4, join-request 2), 0 new.
TermPage: 7 failing. 3 are stale numeric-id assertions (7, 101) caused by Group 7's string widening -> REGRESSION FROM THIS TASK, to fix in Group 11. 3 are UI drift and 1 is a PRIVATE member view; HEAD status to be confirmed in Group 11.
**tsc**: 58 -> 58, 0 new
**Files Modified**: api/families.ts, RsvpDialogLoggedIn.tsx, PanelDataContext.tsx, RodzinaView.tsx, CreateFamilyDialog.tsx, test/PanelPage.test.tsx, test/TermPage.test.tsx
**Visual**: all refs matched. Field label is "Rok urodzenia" (acceptance) not "(opcjonalnie)" (mockup).
**Notes**: birthYearError duplicated in RodzinaView + CreateFamilyDialog (candidate move to utils/age.ts). Candidate standard: shared server-error-message helper.

## 2026-10-01 - Group 3 Complete (wave 3)

**Steps**: 3.1-3.7 completed
**Standards Applied**:
- From plan: backend/security.md, backend/api.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: none
**Tests**: 33 passed (test_families.py + test_lightweight_family_members.py); 6 new tests incl. no-side-effect checks on 403
**Files Modified**: app/families/guardians.py (add_guardian caller check), primary_contact.py (make_primary_contact caller check), router.py (4 routes resolve caller), tests/test_families.py. service.py unchanged (re-exports only).
**Notes**: Frontend callers already verified in spec caller audit (only own family). Pre-existing ruff I001/E501 and mypy bootstrap.py:64 remain.

## 2026-10-01 - Group 4 Complete (wave 3)

**Steps**: 4.1-4.8 completed
**Standards Applied**:
- From plan: backend/queries.md, backend/models.md, backend/security.md, backend/api.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: global/coding-style.md (ruff on new test file)
**Tests**: 28 passed (test_term_attendees.py new 7 + add_active_membership, group_privacy, circles_router)
**Files Modified**: app/groups/schemas.py (TermAttendeeChildResponse, children), app/groups/application/memberships.py (_require_term_in_group on attendees+formalize, _resolve_family_child_birth_years single batched query, ORDER BY created_at,id), tests/test_term_attendees.py (created)
**Notes**: Test imports create_lightweight_family_member from app.families.members (not exported by facade). Pre-existing ruff issues in memberships.py untouched.

## 2026-10-01 - Group 10 Complete (wave 4)

**Steps**: 10.1-10.4 completed
**Standards Applied**:
- From plan: frontend/components.md, accessibility.md, css.md, responsive.md, testing/frontend-testing.md
- From INDEX.md: frontend/data-fetching.md (no new request)
- Discovered: none
**Tests**: PanelPage 98 passed / 12 failed (exactly the 12 remaining pre-existing baseline failures; 0 new); 4 new chip tests pass
**tsc**: 58 -> 58, 0 new
**Files Modified**: PanelDataContext.tsx (signupSummaryChip in organizerTermCard), test/PanelPage.test.tsx
**Visual**: matches mockup 8; "Brak zapisów" variant without icon per mockup. Chip hidden when counts null.

## 2026-10-01 - Group 5 Complete (wave 4)

**Steps**: 5.1-5.8 completed
**Standards Applied**:
- From plan: backend/queries.md, backend/api.md, backend/security.md, testing/backend-testing.md
- From INDEX.md: backend/models.md
- Discovered: none
**Tests**: 23 passed (test_circles_router.py + test_group_privacy.py), incl. profile-less caller -> null counts, recursive public-payload child-data privacy check
**Files Modified**: app/groups/infrastructure/repository.py (count_active_attendances_by_term grouped query), application/terms.py (list_terms_with_counts, organizer-gated), service.py (export), schemas.py (TermResponse counts), router/terms.py (caller resolve try/except), tests/test_circles_router.py, tests/test_group_privacy.py
**Notes**: Pre-existing ruff/mypy debt in app/groups untouched.

## 2026-10-01 - Group 11 Complete (wave 5)

**Steps**: 11.0-11.7 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md, frontend/data-fetching.md (dayjs audit)
**Tests**: 6 gap tests (8 cases): PATCH range boundaries, PATCH removed child 404, attendees children after PATCH/removal, inline editor Esc + disabled Zapisz, returnTo after dialog close, all-unknown ages render.
TermPage: id assertions converted to UUID constants (they also failed at HEAD; route params were always strings) -> 26 pass / 5 fail (all 5 also fail at HEAD, header subtitle + "Imię" label drift).
**Files Modified**: tests/test_lightweight_family_members.py, tests/test_term_attendees.py, test/PanelPage.test.tsx, test/TermAttendeesPage.test.tsx, test/TermPage.test.tsx

## 2026-10-01 - Implementation Complete

**Total Steps**: 82 completed (11 groups, 5 waves)
**Gates**:
- Backend full pytest: 481 passed, 0 failed
- alembic current: 0044 (head) on local DB
- Frontend full vitest: 315 passed / 23 failed; ALL 23 also fail at HEAD (HEAD: 245 passed / 40 failed). 0 new failures; 17 pre-existing failures fixed (15 PanelPage, 2 TermPage).
  Pre-existing remaining: PanelPage 12 (hamburger promotion 6, home hints 4, join-request 2), TermPage 5 (subtitle/"Imię" drift), auth.test 1, extension-points 2, foundation 1, ItemQuickAddForm 1, ItemQuickAddFormCategory 1.
- tsc: 57 errors vs 58 baseline, 0 new
- Grep audits: dayjs imports, id coercion, families facade imports, memberships import boundary all pass
**Follow-ups suggested**: PublicCircleResponse/PublicTermResponse ids still typed number (UUID at runtime); UI-drift test cleanup (17 tests); pre-existing ruff/mypy debt in app/families and app/groups; move birthYearError into utils/age.ts; shared server-error-message helper.

## 2026-10-01 - Verification fixes (Phase 11, iteration 1)

User chose: fix issues 1-7.
1. C1 open redirect: `isSafeReturnPath` now also rejects whitespace/control chars (tab/CR/LF smuggling of "//host"). url.test.ts +4 cases. (eslint no-control-regex -> charCode loop)
2. W1 refetch race: `useTermAttendees.refetch` refetches dependents only if they were already enabled before the retry.
3. W2 double PATCH: `saveBirthYear` returns early while `busy`.
4. W3 error messages: new `serverMessageOr(err, fallback)` in api/problem.ts (server message only for 400 without fieldErrors and 409, else Polish fallback); replaces serverErrorMessage, the CreateFamilyDialog inline copy and the remove-member inline copy. New src/test/serverMessageOr.test.ts (6 cases).
5. I1 duplication: `birthYearError` + `MIN_BIRTH_YEAR` moved to utils/age.ts; both forms import them.
6. W4 cache after logout: NO CHANGE NEEDED. `logout()` does `window.location.href = "/login"`, a full page load that discards the in-memory query cache.
7. Mixed language: backend Pydantic birth-year messages translated to Polish.
**Tests**: backend families 37 passed; frontend url/age/PanelPage/TermAttendeesPage 129 passed / 12 failed (the 12 pre-existing baseline only); serverMessageOr 6 passed. tsc 57, 0 new vs baseline. eslint clean on touched files.
