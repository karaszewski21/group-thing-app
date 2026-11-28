# Work Log

## 2026-11-27T13:20:07Z - Implementation Started

**Total Steps**: 58 (53 now, 5 deferred in Group 10)
**Task Groups**: 1 Database layer; 2 App settings module; 3 Featured toggle API; 4 Read model & ordering; 5 Frontend badges & views; 6 Moje rzeczy toggle; 7 Admin settings page; 8 Docs; 9 Test review; 10 Merge renumber (DEFERRED, not run)
**Waves planned**: W1 G1 · W2 G2 · W3 G3+G7 · W4 G4 · W5 G5 · W6 G6+G8 · W7 G9
**Note**: TaskCreate/TaskList unavailable in this session — plan checkboxes + HTML markers are the tracker.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

### Group 1: Database Layer
**From Implementation Plan**: backend/migrations.md, backend/models.md, testing/backend-testing.md
**From INDEX.md**: global/commenting.md, global/minimal-implementation.md
**Discovered During Execution**: none

## 2026-11-27T13:25:33Z - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.6 completed
**Tests**: 3 passed (test_featured_items_migration.py); test_points_offers_migration.py still green (8 total); alembic heads = 0111
**Files Modified**: alembic/versions/0110_app_settings.py, 0111_featured_items.py (new), app/settings/__init__.py, app/settings/models.py (new), app/groups/models.py, tests/test_featured_items_migration.py (new)
**Notes**: Worktree had no backend venv; created via `uv sync --frozen --system-certs` with VIRTUAL_ENV unset (shell VIRTUAL_ENV points at group-thing-ai). Later groups must `unset VIRTUAL_ENV`. Group 10 must also update the 0109 downgrade target in the migration test.

### Group 2: App Settings Module
**From Implementation Plan**: backend/security.md, backend/api.md, global/error-handling.md, global/validation.md, testing/backend-testing.md
**From INDEX.md**: backend/models.md, global/minimal-implementation.md
**Discovered During Execution**: tests/test_module_boundaries.py AST guard pattern

## 2026-11-27T13:29:15Z - Group 2 Complete (wave 2)

**Steps**: 2.1 through 2.7 completed
**Tests**: 140 passed (test_app_settings_api.py, test_authorization_matrix.py, test_module_boundaries.py)
**Files Modified**: app/settings/{schemas,service,router}.py, app/groups/infrastructure/settings_acl.py (new), app/main.py, app/core/authorization_matrix.py (row 74), tests/test_app_settings_api.py (new), tests/test_authorization_matrix.py, tests/test_module_boundaries.py
**Notes**: mypy app = 19 in the worktree venv: 15 baseline + 4 import-not-found (numpy/tokenizers not installed in worktree venv) — none in touched files. Group 10 must rename test_resolveRequirement_adminSettingsRoutes_getAndPutAdminRow74 with the row.

### Group 3: Featured Toggle API
**From Implementation Plan**: backend/models.md, backend/queries.md, backend/api.md, backend/security.md, global/error-handling.md, testing/backend-testing.md
**From INDEX.md**: backend/time.md, global/validation.md, global/commenting.md
**Discovered During Execution**: none

### Group 7: Frontend Admin Settings Page
**From Implementation Plan**: frontend/components.md, frontend/data-fetching.md, frontend/accessibility.md, global/validation.md, testing/frontend-testing.md
**From INDEX.md**: global/minimal-implementation.md, global/commenting.md
**Discovered During Execution**: backend settings/service.py messages (copied verbatim client-side)

## 2026-11-27T13:38:25Z - Groups 3 and 7 Complete (wave 3)

**Group 3**: steps 3.1–3.6; 129 passed (test_item_featured.py 13 cases + authorization matrix); mypy 19 (= worktree baseline), ruff 64. Files: groups/schemas.py, groups/infrastructure/repository.py (lock_owner_party FOR NO KEY UPDATE, count_other_featured_preferences), groups/application/term_item_listings.py (set_item_featured, _featured_cap_message), groups/router/term_item_listings.py (PUT …/featured), tests/test_item_featured.py (new), tests/test_authorization_matrix.py. Known: tests/test_item_visibility.py PREFERENCE_KEYS now lacks is_featured — fixed in Group 4.2.
**Group 7**: steps 7.1–7.6; 11 passed (SettingsPage + Sidebar), typecheck 0, lint clean on touched files (39 pre-existing repo findings). Files: api/settings.ts, hooks/useAppSettings.ts, features/admin/settingsForm.ts, features/admin/SettingsPage.tsx, app/admin/(shell)/settings/page.tsx (new), Sidebar.tsx, MobileDrawer.tsx, test/SettingsPage.test.tsx (new), test/Sidebar.test.tsx. Ran npm ci in worktree. settingsForm.ts added because pointsConfigForm parsers are private.

### Group 4: Featured Read Model & Ordering
**From Implementation Plan**: backend/queries.md, backend/models.md, backend/security.md, testing/backend-testing.md
**From INDEX.md**: global/commenting.md
**Discovered During Execution**: R8 probe tests/test_points_valuation.py

## 2026-11-27T13:48:02Z - Group 4 Complete (wave 4)

**Steps**: 4.1 through 4.6 completed
**Tests**: 194 passed, 1 failed — the failure is pre-existing (test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath, listed in the 2026-11-26 points task's test-suite-results); mypy 19, ruff 64 (baselines)
**Files Modified**: repository.py, groups/schemas.py, term_item_listings.py, item_actions.py, events/page.py, events/schemas.py, pages/schemas.py, pages/application/owner_pages.py, tests/test_featured_items_ordering.py (new), key-set updates in test_event_page.py, test_organizer_page.py, test_owner_items_page.py, test_item_visibility.py, test_public_term.py, test_term_item_listings_router.py, test_item_actions.py
**Notes**: organization_page.py / pages groups_acl.py / events groups_acl.py needed no change. test_my_items_page.py and test_item_listing_status.py pin no affected keys.

### Group 8: Project Documentation
**From Implementation Plan**: global/conventions.md, backend/migrations.md (runbook format)
**From INDEX.md**: —
**Discovered During Execution**: none

## 2026-11-27T13:51:24Z - Group 8 Complete (wave 5, pulled forward — deps 1,2,3,4,7 done, docs-only files)

**Steps**: 8.1 through 8.4 completed
**Tests**: grep checklist 19/19 OK (9 strings × 2 files + no secret-like assignments)
**Files Modified**: .maister/docs/project/architecture.md (+28: settings/featured section, package tree, 0110–0111 runbook), .maister/docs/INDEX.md (Architecture entry sentence)
**Notes**: FeaturedToggle doc text follows the spec (Group 6 builds it) — re-check after Group 6. Group 10 must also renumber these docs.

### Group 5: Frontend Featured Badges & Featured-First Views
**From Implementation Plan**: frontend/css.md, frontend/accessibility.md, frontend/components.md, frontend/data-fetching.md, testing/frontend-testing.md
**From INDEX.md**: global/commenting.md, global/minimal-implementation.md
**Discovered During Execution**: none

## 2026-11-27T14:05:02Z - Group 5 Complete (wave 5)

**Steps**: 5.1 through 5.8 completed
**Tests**: 35 passed in the group's 5 files; typecheck 0; lint 39 (pre-existing, none in touched files)
**Files Modified**: 6 api types (is_featured), ItemTileBadges (featured + exported FeaturedLabel), ItemCard (featured corner badge), ParticipantItemsPreview, termViewModel (byFeaturedThenNewest before slice), eventViewModel, OwnerItemsList, ProfileItems, RecentItemsBlock, ItemHeader; new test ItemHeaderFeatured.test.tsx; typed fixtures in 18 test files + EventPage.test.tsx and ParticipantItemsPreview.test.tsx (outside declared list — fixture-only, needed for typecheck)
**Notes**: Full vitest in worktree: 53 failing vs 55 on a clean HEAD copy (environment differences); one NEW failure routeManifest.test.ts "has exactly the inventoried page patterns" caused by Group 7's new /admin/settings route — assigned to Group 9 to update the manifest inventory.

### Group 6: Frontend „Moje rzeczy” Featured Toggle
**From Implementation Plan**: frontend/accessibility.md, frontend/components.md, frontend/css.md, frontend/data-fetching.md, testing/frontend-testing.md
**From INDEX.md**: global/error-handling.md
**Discovered During Execution**: none

## 2026-11-27T14:09:31Z - Group 6 Complete (wave 6)

**Steps**: 6.1 through 6.6 completed
**Tests**: 33 passed in 4 files (8 new); typecheck 0; eslint 0 errors on touched files (6 pre-existing set-state-in-effect warnings)
**Files Modified**: api/itemListingPreferences.ts (setItemFeatured), features/items/FeaturedToggle.tsx (new), features/items/MyItemsView.tsx, features/panel/AppDataContext.tsx, test/FeaturedToggle.test.tsx (new), test/AppDataContextItemFeatured.test.tsx (new), test/AppDataContextItemMode.test.tsx, test/MyItemsView.test.tsx
**Notes**: Errors use the existing bottom ToastPill (intended deviation from the mockup's red top toast, per spec). Chip uses the card's chip size with the featured tone.

### Group 9: Test Review & Gap Analysis
**From Implementation Plan**: testing/backend-testing.md, testing/frontend-testing.md
**From INDEX.md**: backend/queries.md (lock semantics checked)
**Discovered During Execution**: none

## 2026-11-27T14:21:49Z - Group 9 Complete (wave 7)

**Steps**: 9.1 through 9.4 completed
**Tests added**: 5 — two-connection lock test (owner Party lock held: take + GIFT confirm don't wait, a second toggle does; mutation-checked: fails with plain FOR UPDATE), SWAP hand-over clears both marks, POINTS sale clears mark, search carries no is_featured and order unchanged, ssrSafety logged-in featured header
**Fixes**: routeManifest.test.ts ADMIN inventory gains /admin/settings
**Tests**: backend feature files 314 passed, 1 pre-existing failure; frontend feature files 126 passed, 3 pre-existing failures (routeManifest panel cases ×2, ParticipantItemsPreview "dodano" UTC) — all fail on clean HEAD; mypy 19, ruff 64, typecheck 0, eslint 39 (baselines)
**Notes**: architecture.md FeaturedToggle wording verified against code — unchanged. Propose not covered by the lock test (same FK path as take).

## Group 10 — DEFERRED
Not run (user decision): renumber 0110/0111 + matrix row 74 when rebasing onto main after the email module (0110–0112). Also update: tests/test_featured_items_migration.py downgrade target, test_resolveRequirement_adminSettingsRoutes_getAndPutAdminRow74 name, architecture.md section + runbook + INDEX.md sentence.

## 2026-11-27T14:46:36Z - Implementation Complete

**Total Steps**: 53 completed, 5 deferred (Group 10)
**Total Standards**: 16 standard files applied across groups
**Test Suite**: passed against baselines —
- Backend full: 1937 passed, 2 failed, 2 skipped (24m29s). Failures = the 2 recorded stale tests (test_owner_items_page::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath, test_terms_circle_occurs_on_index_migration::test_migration0053_downgradeUpgrade_roundTrip). No new failures.
- Frontend full: 2197 passed, 52 failed (13 files) — all pre-existing in this worktree environment (53 before Group 9's routeManifest fix; 55 on a clean HEAD copy). No new failures.
- typecheck 0, eslint 39 (baseline), mypy app 19 (15 + 4 import-not-found from the worktree venv), ruff 64.

## 2026-11-28 — E2E finding fixed
- `src/frontend/src/components/shared/ItemCard.tsx`: both corner badges now sit in one absolutely positioned `flex flex-wrap` row; the right badge (featured or `marker`) uses `ml-auto`, so on ~175–190 px tiles it drops below the offer badge instead of covering it (E2E §5.3).
- `src/frontend/src/test/ItemCard.test.tsx`: position assertions moved from `left-1.5`/`right-1.5` to the shared wrapping row and `ml-auto`.
- Checks: ItemCard tests 5/5, related suites green, `tsc --noEmit` clean, eslint clean. Phase 12 marked completed.

## 2026-11-28 — User documentation (phase 13)
- `documentation/user-guide.md` (Polish) with 16 screenshots in `documentation/screenshots/`: 13 reused from E2E, 3 recaptured after the badge fix (08 owner items desktop, 09 owner items mobile — „Wszystkie” tab, replaces the gift-tab shot —, 10 profile). Environment: E2E DB container, backend :8090 (text moderation and embeddings off), Next dev :5183.
