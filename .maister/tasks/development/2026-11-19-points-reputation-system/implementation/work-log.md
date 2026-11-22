# Work Log

## 2026-11-19T13:46:43Z - Implementation Started

**Total Steps**: 96
**Task Groups**: 1 DB layer; 2 Ledger + conflict helper; 3 Valuation; 4 Exchange awards; 5 Confirm contexts & safety; 6 Attendance level/presence; 7 Attendance close + auto-close; 8 Points API/config/size_class; 9 Owner reads API; 10 FE admin; 11 FE organizer; 12 FE /account/points; 13 Docs; 14 Test review & regression
**Waves (planned)**: W1 [1] → W2 [2] → W3 [3, 8] → W4 [4, 10] → W5 [5, 6, 9] → W6 [7, 12] → W7 [11, 13] → W8 [14]

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-19T13:56:53Z - Group 1 Complete (Wave 1)

**Steps**: 1.1 through 1.8 completed (resumed once after an API auth interruption)
**Standards Applied**:
- From plan: backend/migrations.md, backend/models.md, backend/queries.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: backend/time.md
- Discovered: PostgreSQL 63-char identifier limit (step 1.4)
**Tests**: 4 passed (test_points_migration.py); mypy 15 (baseline); ruff 64 (≤ baseline)
**Files Modified**: alembic 0103/0104/0105 (created), app/points/__init__.py, app/points/models.py (created), category/models.py, inventory/models.py, groups/models.py, tests/test_points_migration.py
**Notes**: The index was renamed to ix_point_transactions_party_counterparty_occurred_at because of the length limit; spec and plan updated to match. 0105 closes only terms that are still open. size_class uses an inline Enum with native_enum=False.

## 2026-11-19T14:03:57Z - Group 2 Complete (Wave 2)

**Steps**: 2.1 through 2.7 completed
**Standards Applied**:
- From plan: backend/models.md, backend/queries.md, global/error-handling.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: global/commenting.md, global/coding-style.md
- Discovered: none
**Tests**: 46 passed in the targeted run; wants regression 188 passed; mypy 15 and ruff 64, both at baseline
**Files Modified**: points/infrastructure/{__init__,ledger}.py, points/application/{__init__,config}.py, app/db.py (mapped_transaction_conflicts), wants/application/writes.py, tests/test_points_ledger.py, tests/point_ledger_assertions.py, tests/test_module_boundaries.py, tests/test_domain_clock_guard.py
**Notes**:
- Validation failures raise ValueError before anything is written.
- lock_accounts does a sorted INSERT ON CONFLICT and then FOR UPDATE. Checking eligibility is the caller's job.
- Group 14 must tighten the boundary test from subset to equality.
- main.py wiring is deferred to the router and job groups.

## 2026-11-19T14:09:18Z - Group 3 Complete (Wave 3)

**Steps**: 3.1 through 3.6 completed
**Standards Applied**:
- From plan: backend/queries.md (join_from + lint-compile test), backend/models.md (ACLs), testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: module-boundary rules, global/commenting.md, global/coding-style.md
- Discovered: none
**Tests**: 14 passed (valuation); regression run 115 passed; mypy 15 (baseline)
**Files Modified**: points/domain/{__init__,valuation}.py, points/infrastructure/category_acl.py, points/service.py, inventory/infrastructure/points_acl.py, inventory/application/inventory_items.py, tests/test_points_valuation.py
**Notes**:
- update_item recomputes only when the condition or product actually changes.
- The red phase was not observed: tests were written first but would have failed only at import time.
- Ruff count is 65; the extra error is Group 8's test E501.

## 2026-11-19T14:09:57Z - Group 8 Complete (Wave 3)

**Steps**: 8.1 through 8.7 completed
**Standards Applied**:
- From plan: backend/security.md, global/validation.md, global/error-handling.md, testing/backend-testing.md, global/minimal-implementation.md, backend/models.md
- From INDEX.md: backend/api.md, backend/time.md
- Discovered: module-boundary rule in tests/test_module_boundaries.py
**Tests**: 156 passed (config API, category tree/module, matrix, boundaries, clock guard). ruff 64 and mypy 15, both at baseline.
**Files Modified**: points/schemas.py, points/router.py (created); points/application/config.py, main.py, core/authorization_matrix.py (rows 68–69), category/schemas.py, category/service.py, tests/test_points_config_api.py, tests/test_authorization_matrix.py, tests/test_category_tree.py
**Notes**:
- Validation lives in the application layer, not in pydantic ge/le, so the 400 errors carry Polish messages.
- The stale check returns 409 „Konfiguracja została zmieniona w międzyczasie.”
- No cache headers on the admin/config routes.
- Category PUT is a full replace: an omitted size_class resets to inherit.
- Possible standard to suggest later: Polish 400 errors through application-side validation.

**Wave 3 resolved** (Groups 3 and 8).

## 2026-11-19T14:21:29Z - Group 10 Complete (Wave 4)

**Steps**: 10.1 through 10.8 completed. The tests were run first and failed (9 failed before implementation).
**Standards Applied**:
- From plan: frontend/components.md, frontend/data-fetching.md, global/validation.md, frontend/accessibility.md, global/minimal-implementation.md, testing/frontend-testing.md
- From INDEX.md: frontend/css.md, frontend/responsive.md
- Discovered: none
**Tests**: all group files pass. Full vitest: 33 failed / 1913 passed (= baseline). Typecheck 0. ESLint 0 errors and 1 pre-existing warning.
**Visual**: category edit ✓, config page ✓. Category list ⚠: kept as a nested ul instead of a table, because accessibility.md requires editable trees to be nested lists.
**Files Modified**:
- api/categories.ts, api/points.ts
- hooks/usePointsConfig.ts, utils/categoryTree.ts
- features/admin/{CategoryFormPage,CategoryListPage,PointsConfigPage,pointsConfigForm}
- app/admin/(shell)/points/page.tsx
- Sidebar, MobileDrawer
- tests and typed fixtures (also AppPage, extension-points, ItemQuickAddForm and pages, which tsc flagged)
**Notes**:
- POINTS_KEY is exported from hooks/usePointsConfig.ts.
- The nav label is "Points" and uses the lucide Coins icon.

## 2026-11-19T14:23:26Z - Group 4 Complete (Wave 4)

**Steps**: 4.1 through 4.8 completed (red phase observed)
**Standards Applied**:
- From plan: backend/models.md (ACLs; Core refs for wants and inventory), backend/queries.md, global/error-handling.md, backend/time.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: points module-boundary rules
- Discovered: none
**Tests**: 12 passed (test_points_awards). Regression: 242 passed (confirm, exchange, swap, personal, event, wants lifecycle, term-end scan). mypy 15, ruff 64.
**Files Modified**: points/domain/awards.py, points/application/awards.py, points/service.py, points/infrastructure/{users,families,wants,inventory}_acl.py, groups/infrastructure/points_acl.py, groups/application/term_item_listings.py (1 call after _may_confirm), tests/test_points_awards.py
**Notes**:
- Award posted before the listing-preference delete, so locks are taken accounts first, then items.
- The source-key skip runs after planning, which matters only in the parallel race (Group 5).
- users_acl.display_names is ready for Group 9.

**Wave 4 resolved** (Groups 4 and 10).

## 2026-11-19T14:29:10Z - Group 9 Complete (Wave 5)

**Steps**: 9.1 through 9.5 completed (red phase observed)
**Standards Applied**:
- From plan: backend/security.md (personalised cache headers), backend/queries.md, backend/api.md, testing/backend-testing.md, backend/models.md, global/minimal-implementation.md
- From INDEX.md: backend/time.md
- Discovered: none
**Tests**: 4 passed (test_points_me_api), 21 including the boundary and clock guards; mypy 15
**Files Modified**: points/application/reads.py (created), points/router.py, points/schemas.py, points/infrastructure/users_acl.py (caller_party_id; fixed the display_names dict(Result) bug), tests/test_points_me_api.py
**Notes**:
- Organizations and new users get {0,0} and an empty page; no account is created.
- Repo-wide ruff is at 76 while sibling groups 5 and 6 are still running; re-check once wave 5 resolves.
- Possible standard: use dict(result.all()), never dict(Result).

## 2026-11-19T14:33:22Z - Group 6 Complete (Wave 5)

**Steps**: 6.1 through 6.8 completed (red phase observed)
**Standards Applied**:
- From plan: backend/security.md (row 70 placement), backend/api.md, backend/time.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: backend/models.md, backend/queries.md, global/minimal-implementation.md
- Discovered: tests/test_membership_definition_guard.py (organizer exclusion via group_ids_for)
**Tests**: 118 passed in the group files; 264 passed in the regression/smoke run; mypy 15; ruff 69 (the extra 5 are in Group 5's in-progress test file)
**Files Modified**: groups/application/attendance_points.py (created), groups/schemas.py, groups/application/terms.py, groups/application/memberships.py, groups/router/circles.py, groups/infrastructure/points_acl.py, points/service.py, core/authorization_matrix.py (row 70), tests/test_term_attendance_points.py, tests/test_authorization_matrix.py, tests/test_term_attendees.py
**Notes**:
- The live present_count excludes active organizers, matching the close rule.
- TermResponse is unchanged, and a test pins that.
- Group 7 still has to add: the post-close 409 in update_term, the closed-list filter in list_term_attendees, and attendee_count for closed terms.
- Possible standard: the lock + rollback-before-raise pattern.

## 2026-11-19T14:36:59Z - Group 5 Complete (Wave 5)

**Steps**: 5.1 through 5.5 completed
**Standards Applied**:
- From plan: global/error-handling.md, testing/backend-testing.md, backend/queries.md, global/minimal-implementation.md, global/commenting.md
- Discovered: the purge pattern from test_item_owner_inventory_migration.py
**Tests**:
- 98 passed: contexts, term-item listings, personal pickup, event reservations, awards.
- 8 passed: contexts followed by the migration tests in the same session, so no rows leaked.
- mypy 15 and ruff 64, both at baseline.
**Files Modified**: groups/application/term_item_listings.py (confirm writes wrapped in mapped_transaction_conflicts), tests/test_points_awards_contexts.py
**Notes**:
- The parallel confirms produce [200, 409] and post exactly one award.
- When fulfil fails, the award is rolled back.
- committed_client and _purge are local to the test file.
- Possible standard: tests that commit rows must purge them in finally.

**Wave 5 resolved** (Groups 5, 6 and 9). Repo ruff is back to 64.

## 2026-11-19T20:22:48Z - Group 12 Complete (Wave 6)

**Steps**: 12.1 through 12.7 completed. The run was restarted after a rate limit; no partial work from the first attempt survived.
**Standards Applied**:
- From plan: frontend/components.md, frontend/data-fetching.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: dayjs.utc().local() for naive UTC occurred_at
**Tests**: 13 passed. 2 routeManifest failures, both pre-existing baseline failures (also seen in the Group 10 baseline run). Typecheck 0. ESLint clean.
**Visual**: screen:profile-points ✓. points-history-row ⚠: the spec's labels win over the mockup's.
**Files Modified**: api/points.ts, hooks/useMyPoints.ts, features/points/{pointsLabels.ts,PointsHistoryRow.tsx,AccountPointsView.tsx}, app/(site)/(panel)/account/points/page.tsx, features/account/AccountView.tsx (Moje punkty row), routing/paths.ts, test/AccountPointsView.test.tsx, test/routeManifest.test.ts

## 2026-11-19T20:27:37Z - Group 7 Complete (Wave 6)

**Steps**: 7.1 through 7.8 completed. Resumed after a rate limit; the cut-off run had written no group 7 code. The red phase was observed (ImportError).
**Standards Applied**:
- From plan: backend/time.md, global/error-handling.md (job: WARNING plus retry, other failures logged once), backend/queries.md, testing/backend-testing.md
- From INDEX.md: backend/models.md, global/minimal-implementation.md, global/commenting.md
- Discovered: membership definition guard, so _not_an_organizer is reused
**Tests**: 7 passed (close). Regression: 312 passed, 1 failed. The failure is the pre-existing stale test_migration0053 assertion (group_id renamed to circle_group_id), one of the 2 known backend failures. ruff 64, mypy 15.
**Files Modified**:
- points/domain/awards.py, points/application/awards.py, points/service.py
- groups/infrastructure/points_acl.py
- groups/application/{attendance_points,terms,memberships}.py
- groups/router/circles.py (POST …/attendance/close, covered by existing row 27)
- main.py (_run_attendance_close every 15 min)
- tests/test_term_attendance_close.py
**Deviation**: also modified points/infrastructure/users_acl.py (eligible_persons by party id), which is not in this group's Files to Modify. It is a low-risk backend file and no sibling touches it.
**Notes**:
- The award_attendance signature drops the unused term_id.
- Spec gap: organizers of terms in soft-deleted groups are not excluded. For Group 14 or the user to decide.

**Wave 6 resolved** (Groups 7 and 12).

## 2026-11-19T20:31:54Z - Group 13 Complete (Wave 7)

**Steps**: 13.1 through 13.5 completed
**Standards Applied**:
- From plan: global/commenting.md, global/conventions.md
- From INDEX.md: backend/migrations.md (runbook structure)
- Discovered: CLAUDE.md Secrets rule (no secret values in docs)
**Tests**: two grep doc checks pass; a secrets grep over the diff found nothing
**Files Modified**: .maister/docs/project/architecture.md (points section, package tree, 0103–0105 runbook), .maister/docs/INDEX.md, CHANGELOG.md (5 Polish bullets)
**Notes**:
- The runbook notes that the 0105 downgrade nulls the close columns of every closed term.
- Follow-ups for Group 14:
  - Reword the frontend bullet once Group 11 is done.
  - Update the boundary-test wording if it gets tightened to equality.
- Standards suggestions collected for finalization:
  - singleton config table with updated_at 409
  - Polish 400s through application-layer validation
  - dict(result.all())
  - lock and roll back before raising
  - tests purge committed rows in finally

## 2026-11-19T20:38:01Z - Group 11 Complete (Wave 7)

**Steps**: 11.1 through 11.8 completed (red phase observed)
**Standards Applied**:
- From plan: frontend/components.md (resolveAttendanceView), frontend/accessibility.md, frontend/data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md
- From INDEX.md: frontend/css.md, global/commenting.md
- Discovered: none
**Tests**: 52 passed across 4 files. Typecheck 0. ESLint: 0 errors, 3 pre-existing warnings.
**Regression found**: AppPage.test.tsx "Konto without an organization…" now expects 7 links but gets 8. Group 12 added the "Moje punkty" row, so the test needs updating. Fix in Group 14.
**Visual**:
- term form, picker, open list and closed list ✓
- ⚠ CLOSED help text, NOT_STARTED banner and level-0 banner use wording the spec does not define
**Files Modified**:
- api/{terms,groups,points}.ts
- hooks/{useAttendanceRules,useTermAttendance,useTermAttendees}.ts
- features/terms/{components/AttendancePointsPicker.tsx,termDraft.ts,TermEditForm.tsx,AddTermView.tsx}
- features/panel/AppDataContext.tsx
- features/meetings/{attendanceViewState.ts,TermAttendeesPage.tsx}
- tests
**Notes**:
- No picker in the first-term stepper.
- The level is sent only when changed.
- Mutations await invalidation in finally.

**Wave 7 resolved** (Groups 11 and 13).

## 2026-11-19T21:19:04Z - Group 14 Complete (Wave 8)

**Steps**: 14.1 through 14.6 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md, backend/security.md (R8 probe), backend/time.md
**Gap tests added (2)**:
- R8: no "point" key in the item, details, actions or search responses.
- WISHLIST_MATCH bonus on a SWAP leg.
**Regressions caused by the feature, all fixed (stale test expectations)**:
- AppPage Konto links: „Moje punkty” added.
- panelPages.ts: PANEL_PAGES now includes /account/points.
- test_wants_scan_removed: the job list now includes _run_attendance_close.
**Follow-ups done**:
- Points boundary test tightened to equality.
- architecture.md: boundary and frontend bullets updated.
**Open issue (user decision)**: the soft-deleted-group gap is reachable. If a group is soft-deleted after its term starts, auto-close still closes the term and awards points, and the organizer is not excluded. A probe showed ORG +10 and GUEST +10. Options:
- (a) Filter the job's candidates with live_group_clause.
- (b) Use a deleted-inclusive organizer exclusion.
- (c) Accept the behaviour.

## 2026-11-19T21:19:04Z - Implementation Complete

**Total Steps**: 96 completed (14 groups, 8 waves; 3 resumes after API auth and rate-limit interruptions)
**Test Suite**:
- Full backend: 1672 passed, 2 failed. Both are pre-existing stale tests: 0053 circle_group_id, and owner-items location_name.
- Matcher: 125 passed.
- Frontend: vitest 33 failed / 1945+ passed, identical to the baseline set. Typecheck 0.
- mypy 15 and ruff 64, both at baseline.
**Standards suggestions collected**:
- Singleton config table with an updated_at 409.
- Polish 400s through application-side validation.
- dict(result.all()).
- Lock, then roll back before raising.
- Tests purge committed rows in finally.
- Index names ≤63 chars.
- Mutation hooks invalidate in finally.
- Update test_wants_scan_removed and panelPages when adding a job or page.

## 2026-11-20T07:20:47Z - Phase 8 gate: soft-deleted group decision (option b)

**Decision (user)**: (b) organizer exclusion deleted-inclusive; guests of a soft-deleted group's started term are still paid.
**Change**: `attendance_points._not_an_organizer` now uses `membership.holds_active_leadership` (no deleted filter; signature widened to accept a correlated column) instead of `group_ids_for(organizer_only=True)`.
**Test**: `test_closeDueAttendance_groupSoftDeletedAfterStart_paysGuestNotOrganizer`; attendance close/points/attendees + membership guard: 23 passed. mypy 15 (baseline), ruff clean.
**Docs**: architecture.md "Known limits" replaced with a "Soft-deleted groups" bullet; INDEX.md known-limit removed.

## 2026-11-20T08:05:49Z - Phase 11 fix loop (cycle 1)

**User choice**: fix all; W2 = cap month of the close; W8 = keep the PARTY-debit check as a safeguard.
- W1: `wants_acl.wanted_at_reservation` (one EXISTS per leg) adds `wants.created_at <= reservation.created_at`; test case `createdAfterTake`.
- W2: `attendance_cap_month(clock.local_now())` at close; `award_attendance` no longer takes `occurs_on`; test `test_close_pastTermsOfTwoMonths_closedTogether_shareOneCloseMonthCap`; spec amended.
- W3: `LedgerInvariantError(RuntimeError)` replaces `ValueError` in `post_points` (500, not 400); ledger tests updated.
- W4: `ledger.existing_source_ids` (one IN query) in `award_attendance`.
- W5: `usePointsConfig.update` invalidates `[POINTS_KEY]`; new `usePointsConfig.test.tsx`.
- W6: `TermAttendeeResponse.is_organizer` (same `holds_active_leadership` rule); the UI labels organizer rows and „Teraz: X z Y” counts only non-organizers; backend and frontend tests.
- W7: the close dialog warns „Za mało obecnych (N z min. M) — punkty nie zostaną naliczone.” when level > 0 and below the minimum.
- W9: architecture.md membership caller list, award and close bullets; INDEX.md.
**Checks**: 82 points/attendance backend tests + 16 attendee tests pass; vitest attendee/points 34 pass; typecheck 0; mypy 15; ruff and eslint clean on the changed files.

## 2026-11-20T08:42:35Z - Phase 11 re-verification

**Full suite**: backend 1675/2 (baseline), matcher 125, vitest 1948/33 (baseline by name), typecheck 0, mypy 15, ruff 64; 0 regressions.
**Re-checks**: code review clean (0/0/3), reality ready (~98%, 4 resolved), completeness 2 doc warnings.
**Follow-up fixes (trivial)**: architecture.md ledger contract now names `LedgerInvariantError`; spec.md amended for W1 and W6; `domain/awards.py` docstring says month of close; organizer note linked via `aria-describedby` (TermAttendeesPage 14/14, typecheck 0).
**Verdict**: passed; canonical report rewritten with the fix history.
