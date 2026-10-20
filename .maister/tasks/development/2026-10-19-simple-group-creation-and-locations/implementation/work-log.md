# Work Log

## 2026-10-19 - Implementation Started

**Total Steps**: 71 (9 task groups)
**Task Groups**: 1 locations BC+0057+matrix; 2 migration 0058+ACL+group defaults; 3 term inheritance+public counts+MyAttendanceResponse; 4 frontend plumbing+googleMaps+api/hook+types; 5 LocationPicker/GroupFormFields/TermPlaceLine; 6 FirstTermStepperOrganizer/EditTermDialog/AccountMenu; 7 panel restructure+CreateGroupStepper; 8 public term page+AdminTermsPage; 9 final integration
**Mode**: parallel waves — W1 {1,4}; W2 {2,5}; W3 {3,6,8}; W4 {7}; W5 {9}
**Secrets rule**: no env/.env dumps; presence checks only; VITE_GOOGLE_MAPS_API_KEY only as placeholder name / "test-key" in tests.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-10-19 - Implementation PAUSED by user before Wave 1

No task group was dispatched; no application code was modified (only `.maister/tasks/...` artifacts exist). Resume with:
`/maister:development .maister/tasks/development/2026-10-19-simple-group-creation-and-locations --from=8`

## 2026-10-20 - Implementation RESUMED (Wave 1: Groups 1, 4 in parallel)

## 2026-10-20 - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.8 completed
**Standards Applied**:
- From plan: backend/api.md, backend/models.md (PK/soft-delete per code, stale std), backend/migrations.md, backend/security.md, backend/time.md, global/error-handling.md, global/validation.md, global/minimal-implementation.md, global/commenting.md, global/coding-style.md
- From INDEX.md: backend/queries.md; testing per tests/conftest.py (backend-testing.md stale)
- Discovered: SAVEPOINT + IntegrityError re-fetch pattern (app/circulation/application/inventory.py)
**Tests**: 61 passed (test_locations.py 8 new, test_authorization_matrix.py +4 param cases, test_group_soft_delete_migration.py); ruff check clean; mypy 32 → 32
**Files Modified**: app/locations/{__init__,models,schemas,service,router}.py (new), alembic/versions/0057_locations.py (new), app/core/authorization_matrix.py, app/main.py, tests/test_locations.py (new), tests/test_authorization_matrix.py
**Notes**: Tests not observed red before implementation (first run after impl). Concurrent IntegrityError path untested. `ruff format --check` would reformat 2 new files (style only, not required). Validation test name >100 chars carries `# noqa: E501`. No batched by-ids lookup yet — Group 2 ACL owns it.

## 2026-10-20 - Group 4 Complete (wave 1)

**Steps**: 4.1 through 4.8 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, testing/frontend-testing.md, global/conventions.md, global/minimal-implementation.md, coding-style.md, commenting.md
- From INDEX.md: none additional
- Discovered: api/organizations.ts + useMyOrganization.ts as templates (token in key, encodeURIComponent)
**Tests**: 8 passed (googleMaps.test.ts 5, useMyLocations.test.tsx 3; red before impl); `npx tsc -b` green; eslint clean on touched files
**Files Modified**: .env.example (root), src/frontend/.env.example (new), src/vite-env.d.ts (new), src/frontend/Dockerfile, docker-compose.yml, package.json/package-lock.json (@types/google.maps ^3.66.7 dev), src/lib/googleMaps.ts (new), src/api/locations.ts (new), src/hooks/useMyLocations.ts (new, exports LOCATIONS_KEY), src/api/groups.ts (+updateGroup, CreateAdditionalCircleRequest, UpdateGroupRequest), src/api/terms.ts, SpotkaniaView.tsx (literals), src/test/googleMaps.test.ts, src/test/useMyLocations.test.tsx (new), src/test/PanelPage.test.tsx (attendance fixtures)
**Deviations**:
- `resolve(suggestion)` takes no sessionToken (FetchFieldsRequest typings reject it) — plan fallback; caller must call `newSessionToken(api)` after resolve/cancel.
- SpotkaniaView term literal uses `location: null` (PublicLocationResponse ≠ LocationResponse); Group 7 replaces the construction.
**Baseline findings (pre-existing, not caused by this task)**:
- `npm run lint` full run: 16 problems (15 errors, 1 warning) in untouched files (AuthContext.tsx, organizerSteps.tsx, Icons.tsx, PluginContext.tsx, PluginFrame.tsx, router.tsx, plugin-sdk*.test.ts, plugins.test.tsx) → groups verify lint on touched files only; full lint delta checked in Group 9.
- Extra baseline failure: PanelPage "delete group (soft delete) > 409 message is shown inline in the dialog" (multiple /^Usuń grupę / buttons) — fails at HEAD too.
- TermPage currently 1 failing (baseline ≤5).

## 2026-10-20 - Wave 2 dispatched: Groups 2, 5 in parallel
