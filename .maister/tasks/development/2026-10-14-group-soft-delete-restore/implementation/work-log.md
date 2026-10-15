# Work Log

## 2026-10-14 - Implementation Started

**Total Steps**: 70
**Task Groups**: 1 Database, 2 Services/Getters, 3 Routes/Matrix/Security, 4 Read Isolation, 5 Keep-Live Regression, 6 FE API+Hook, 7 DeleteGroupDialog, 8 Panel Integration, 9 Admin Groups Page, 10 Test Review + Full Suites
**Waves (planned)**: W1 = {1, 6, 7}; W2 = {2, 9}; W3 = {3, 8}; W4 = {4}; W5 = {5}; W6 = {10}
**Note**: TaskCreate/TaskList not available in this session — progress tracked via plan checkboxes and this log.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-10-14 - Group 7 Complete (Wave 1)

**Steps**: 7.1 through 7.5 completed
**Standards Applied**:
- From plan: frontend/accessibility.md, frontend/components.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: none additional
- Discovered: none
**Visual Compliance**: delete-group-dialog ✓, -busy ✓, -error ✓ (only addition: mt-3 on alert)
**Tests**: 4 passed (src/test/DeleteGroupDialog.test.tsx)
**Files Modified**: src/frontend/src/pages/panel/DeleteGroupDialog.tsx (created), src/frontend/src/test/DeleteGroupDialog.test.tsx (created)
**Notes**: dialog owns focus return (opener → main fallback); busy not reset on success (parent unmounts); Tab blocked while busy; onConfirm must reject with server message (serverMessageOr) for 409/403/404. tsc errors at the time were in Group 6's in-progress AdminGroupsPage.test.tsx fixtures.

## 2026-10-14 - Group 1 Complete (Wave 1)

**Steps**: 1.1 through 1.5 completed
**Standards Applied**:
- From plan: backend/models.md, backend/migrations.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md, global/commenting.md
- From INDEX.md: none additional
- Discovered: none
**Tests**: 2 passed (tests/test_group_soft_delete_migration.py); red before implementation
**Files Modified**: src/backend/alembic/versions/0056_group_soft_delete.py (created), src/backend/app/groups/models.py (modified), src/backend/tests/test_group_soft_delete_migration.py (created)
**Notes**: sa.DateTime() == timestamp without time zone; drift probe via compare_metadata → 0 diffs for groups (53 pre-existing diffs on other tables). alembic/env.py has target_metadata = None → `alembic check`/autogenerate cannot detect drift (standards follow-up candidate).

## 2026-10-14 - Group 6 Complete (Wave 1)

**Steps**: 6.1 through 6.5 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md, global/coding-style.md
- From INDEX.md: none additional
- Discovered: reused src/test/page.ts pageOf helper
**Tests**: 7 passed (useModerationGroups.test.tsx 3 new, AdminGroupsPage.test.tsx 4 existing)
**Files Modified**: src/frontend/src/api/groups.ts, src/frontend/src/hooks/useModerationGroups.ts, src/frontend/src/test/useModerationGroups.test.tsx (created), src/frontend/src/pages/AdminGroupsPage.tsx (1 line), src/frontend/src/test/AdminGroupsPage.test.tsx (assertions + fixtures)
**Notes**: deleteGroup/restoreGroup typed Promise<void> (204). Key ["moderationGroups", deleted, page].

## 2026-10-14 - Group 9 Complete (Wave 2)

**Steps**: 9.1 through 9.6 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, frontend/accessibility.md, frontend/components.md, frontend/css.md, testing/frontend-testing.md, global/minimal-implementation.md
- From INDEX.md: none additional
- Discovered: none
**Visual Compliance**: admin-groups ✓, admin-groups-deleted ✓, admin-group-restore-button ✓, admin-groups-deleted-empty ✓
**Tests**: 8 passed (AdminGroupsPage.test.tsx: 4 new + 4 existing); tsc clean
**Files Modified**: src/frontend/src/pages/AdminGroupsPage.tsx, src/frontend/src/components/moderation/DeletedGroupRow.tsx (created), src/frontend/src/test/AdminGroupsPage.test.tsx
**Notes**: DeletedGroupRow renders the 3 extra cells as a fragment. Deleted at uses plain dayjs (same as PhotoModerationCard; naive UTC shown as UTC wall-clock). Standard candidate: server-error test fixtures should reject with ApiError + ProblemDetail (plain Error → generic network message).

## 2026-10-14 - Group 8 Complete (Wave 2)

**Steps**: 8.1 through 8.7 completed
**Standards Applied**:
- From plan: frontend/accessibility.md, frontend/data-fetching.md, frontend/components.md, testing/frontend-testing.md, global/error-handling.md, global/minimal-implementation.md
- From INDEX.md: none additional
- Discovered: none
**Visual Compliance**: delete-group-trigger ✓, panel-spotkania-after-delete ✓ (⚠ toast may appear just before dialog unmounts because handleRemoveGroup awaits load() — cosmetic), delete-group-dialog-error ✓
**Tests**: PanelPage + DeleteGroupDialog: 110 passed, 6 failed — the same 6 pre-existing "PanelPage — hamburger promotion" failures as on main; 5 new panel tests pass
**Files Modified**: src/frontend/src/test/PanelPage.test.tsx, src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/pages/panel/views/SpotkaniaView.tsx, src/frontend/src/api/groups.ts (removed assignLeadership, endLeadership, AssignLeadershipRequest)
**Notes**: load() helper unlessGone() turns 404 into null for getGroup (organizer+guest) and getTerms→getNeededItems chain; only deleteGroup inside try/catch in handleRemoveGroup; trash focuses itself before opening (Safari opener capture).

## 2026-10-14 - Group 2 Complete (Wave 2)

**Steps**: 2.1 through 2.10 completed
**Standards Applied**:
- From plan: backend/time.md, backend/queries.md, backend/jooq.md, backend/models.md, backend/security.md, global/error-handling.md, global/minimal-implementation.md, testing/backend-testing.md
- From INDEX.md: global/coding-style.md, global/commenting.md
- Discovered: none
**Tests**: 21 passed (test_group_soft_delete_service.py 7 new + test_group_join_requests_router.py); +test_domain_clock_guard.py → 24 passed
**Files Modified**: app/groups/infrastructure/repository.py, app/groups/application/circles.py, app/groups/application/terms.py, app/groups/schemas.py, app/groups/service.py, tests/test_group_soft_delete_service.py (created), tests/test_group_join_requests_router.py
**Notes**: Expected break until Group 3: router/leaderships.py:44 calls remove_leadership with old signature (TypeError at runtime; mypy error). 409 check also applies to admins. ruff I001/E501 in circles.py/terms.py and mypy terms.py:186/197 are pre-existing.

## 2026-10-14 - Group 3 Complete (Wave 3)

**Steps**: 3.1 through 3.9 completed
**Standards Applied**:
- From plan: backend/security.md, backend/api.md, global/error-handling.md, testing/backend-testing.md, backend/time.md, global/minimal-implementation.md
- From INDEX.md: testing/backend-testing.md
- Discovered: none
**Tests**: 64 passed (test_group_soft_delete.py incl. both ORIGINAL RED TESTS now green unchanged, test_groups_moderation.py, test_authorization_matrix.py); with Group 2 suites 85 passed. mypy app: 32 (= baseline).
**Files Modified**: app/core/authorization_matrix.py, app/groups/router/circles.py, app/groups/router/leaderships.py, tests/test_group_soft_delete.py (appended), tests/test_groups_moderation.py, tests/test_authorization_matrix.py
**Notes**: authorities use PERMISSION_ prefix ("PERMISSION_ADMIN"). ADMIN login token verified to carry EDIT (L5). Restore route next to moderation route. 2 E501 pre-existing in test_group_soft_delete.py (protected red test signature).

## 2026-10-14 - Group 4 Complete (Wave 4)

**Steps**: 4.1 through 4.9 completed
**Standards Applied**:
- From plan: backend/queries.md, backend/jooq.md, backend/models.md, backend/security.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: backend/migrations.md (checked, not needed)
- Discovered: none
**Tests**: 35 passed (reads 8 new + clock guard + soft_delete + service + moderation); ruff no new findings; mypy 32 (= baseline)
**Files Modified**: app/groups/infrastructure/repository.py, app/groups/application/terms.py, app/groups/application/term_item_listings.py, app/groups/router/circles.py, tests/test_group_soft_delete_reads.py (created)
**Notes**:
- ⚠ TDD order deviation: code (4.2–4.6) written before tests (4.1); separate RED run not demonstrated (stash blocked by hook). Tests assert behaviour the old code did not filter.
- A14 guard: GET /{id}/leadership|leaderships|memberships for nonexistent ids now 404 instead of null/[] (intended) — watch in full suite.
- POST /api/groups/mine for organizer whose only circle was deleted creates a new circle (expected).
- Standard candidate: in tests soft-delete via ORM (db_session.get + set + commit), not raw UPDATE (identity map staleness with expire_on_commit=False).

## 2026-10-14 - Group 5 Complete (Wave 5)

**Steps**: 5.1 through 5.4 completed (5.2: no change needed — Table B NOT widened)
**Standards Applied**:
- From plan: testing/backend-testing.md, backend/time.md, global/minimal-implementation.md
- From INDEX.md: backend/models.md (ORM soft delete in tests)
- Discovered: none
**Tests**: 14 passed (keep_live 6 new + reads 8)
**Files Modified**: tests/test_group_soft_delete_keep_live.py (created)
**Notes**: B1 confirm/cancel, B2 /mine & /mine-as-taker, B3 term_end_scan, B4 withdraw attendance/pledge + GET pledge, L1 sync_pledge_fulfillment, L1 list swap proposals + reject — all work on soft-deleted group. Standard candidate: _register_personal_item only once per user (second PERSONAL inventory → 409).

## 2026-10-14 - Group 10 Complete (Wave 6)

**Steps**: 10.1 through 10.10 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md
- From INDEX.md: backend/models.md, backend/security.md
- Discovered: none
**Gaps found → tests added (4)**: M1 profile-less ADMIN delete (actor NULL / "Unknown"); ADMIN without profile ends foreign leadership; mutations on deleted group (PATCH group, POST/PATCH term, POST needed item, public RSVP, join-request create) → 404; fulfill_pledge on deleted → 404. No production code changes.
**Tests**:
- Feature backend: 108 passed; feature frontend: 121 passed / 6 failed (pre-existing hamburger promotion)
- FULL backend: 842 passed, 0 failed (run started before the 4 gap tests; those passed separately → 846)
- FULL frontend: 909 passed, 11 failed — exactly the 11 known pre-existing failures on main
- tsc clean; mypy 32 (= baseline); ruff: no findings on lines added by this feature (66 pre-existing repo-wide)
- Both original red tests byte-identical
**Files Modified**: tests/test_group_soft_delete.py (append), tests/test_group_soft_delete_reads.py (append)
**Standards update suggestions (not applied)**: models.md soft-delete pattern; backend-testing.md (ORM soft delete in tests, _register_personal_item once per user, profile-less principal via encode_login_token); frontend-testing.md (ApiError+ProblemDetail fixtures); migrations.md (env.py target_metadata=None → no drift detection); security.md (is_admin from "PERMISSION_ADMIN" in authorities; catch EntityNotFoundException for profile-less callers).

## 2026-10-14 - Implementation Complete

**Total Steps**: 70 completed
**Total Standards**: ~20 distinct standards applied across groups
**Test Suite**: backend 846/846 green; frontend green except 11 pre-existing failures on main; tsc/mypy/ruff at or below baseline
**Deviation**: Group 4 wrote code before tests (no separate RED run).

## 2026-10-14 - Verification Fixes (Phase 11, iteration 1)

User selected fixes 1–6; item 7 (restore → organizer may lead two groups) accepted and documented.
1. **H1 RzeczyView** — `GET /api/reservations/{id}` now returns `term_occurs_on` (ReservationDetailResponse, via keep-live `find_reservation_term`); RzeczyView drops `getTerm`, uses `Promise.allSettled` per reservation. Files: app/circulation/{schemas,router,service}.py, app/circulation/application/reservations.py, frontend api/reservations.ts, RzeczyView.tsx, tests RzeczyViewCategory.test.tsx (+1 soft-deleted test), test_group_soft_delete_keep_live.py (+1). PanelPage Bug #4c test mock updated by orchestrator (term_occurs_on on getReservation).
2. **W1** useModerationGroups placeholderData only within same `deleted` (+2 hook tests, +1 page test).
3. **W2** handleRemoveGroup → `load({ silent: true })` (+1 PanelPage test).
4. **UTC** DeletedGroupRow `dayjs.utc(...).local()`; page test timezone-independent.
5. **Logs** soft_delete_group / restore_group info logs (ids only) after commit.
6. **Clean-ups** removed unused service exports; trimmed/deleted duplicate service tests (kept non-duplicate assertions); dead assignment removed; flattened `getGroupTerms` in load() (behaviour unchanged, L4).
Docs: documentation/rollback-and-release-notes.md (rollback, release notes, accepted item 7).
**Tests after fixes**: frontend affected files 146 passed / 6 pre-existing failures; tsc clean; backend targeted 38 + 46 passed; mypy 32.
