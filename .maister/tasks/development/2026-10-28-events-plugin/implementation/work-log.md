# Work Log

## 2026-10-28T12:41:16Z - Implementation Started

**Total Steps**: 67
**Task Groups**: 1 Database Layer; 2 Event Creation API; 3 Banner Upload API; 4 Host Plugin Infrastructure; 5 Plugin SDK & Dev Serving; 6 Host Event Create View; 7 Events Plugin Scaffold & Domain; 8 Events Plugin Form & Location Sheet; 9 Events Plugin Save Flow; 10 Plugin Developer Docs; 11 Test Review & Gap Analysis
**Waves (planned)**: W1 = 1,4,5 · W2 = 2,6,7 · W3 = 3,8,10 · W4 = 9 · W5 = 11

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-10-28T12:44:02Z - Group 5 Complete (Wave 1)

**Steps**: 5.1 through 5.6 completed
**Standards Applied**:
- From plan: backend/plugin-auth.md, testing/frontend-testing.md, global/conventions.md, global/minimal-implementation.md
- Discovered: global/commenting.md (doc comments in plugins/sdk.ts)
**Tests**: 12 passed (plugin-sdk.test.ts + plugin-sdk-auth.test.ts; 2 new)
**Files Modified**: src/frontend/src/test/plugin-sdk.test.ts, src/frontend/src/plugin-sdk/host-app.ts, src/frontend/src/plugin-sdk/this-plugin.ts, plugins/sdk.ts, src/frontend/package.json, src/frontend/.gitignore
**Notes**: uploadImage payload is { url, file } per spec; build:sdk copies bundle to public/assets (git-ignored); full build script unchanged; types.ts untouched.

## 2026-10-28T12:44:57Z - Group 1 Complete (Wave 1)

**Steps**: 1.1 through 1.6 completed
**Standards Applied**:
- From plan: backend/models.md, backend/migrations.md, backend/time.md, testing/backend-testing.md
- From INDEX.md: global/commenting.md, global/minimal-implementation.md
**Tests**: 2 passed (tests/test_events_migration.py); ruff + mypy app/events clean
**Files Modified**: src/backend/alembic/versions/0070_events.py, src/backend/app/events/__init__.py, src/backend/app/events/models.py, src/backend/tests/test_events_migration.py
**Notes**: uq_event_banners_event_id is a UNIQUE constraint; EventBanner.status reuses ModerationStatus; business keys on immutable columns; Event has no deleted_at.

## 2026-10-28T12:47:33Z - Group 4 Complete (Wave 1)

**Steps**: 4.1 through 4.8 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, frontend/components.md, backend/plugin-auth.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md, global/error-handling.md
- Discovered: global/validation.md (allowlist over blocklist for UPLOAD_IMAGE_RULES)
**Tests**: plugins.test.tsx 19/19 passed (12 new cases); tsc clean. extension-points.test.tsx has 2 PRE-EXISTING failures (reproduced on clean HEAD copy) — tracked as follow-up.
**Files Modified**: plugins/extensionPoints.ts, plugins/resolveExtensionPoints.ts (new), plugins/PluginContext.tsx, plugins/PluginFilterBar.tsx (import only — it did import the moved type at HEAD), plugins/PluginFrame.tsx, plugins/PluginMessageHandler.ts, plugins/usePluginMessageHandler.ts (new), hooks/usePlugins.ts (new), test/plugins.test.tsx
**Notes**: shared helpers pluginAuthHeaders/toPluginFetchResult; admin PluginProvider unchanged (ignores done); onDone(pluginId, payload).

## 2026-10-28T12:47:33Z - Wave 1 resolved (Groups 1, 4, 5)

## 2026-10-28T12:52:05Z - Group 6 Complete (Wave 2)

**Steps**: 6.1–6.4, 6.6 completed; 6.5 deferred (browser height tuning → E2E phase)
**Standards Applied**:
- From plan: frontend/components.md, frontend/data-fetching.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md
- From INDEX.md: global/commenting.md, global/minimal-implementation.md
**Tests**: eventCreateViewState.test.ts + AppPage.test.tsx — 127 passed; tsc + eslint clean
**Files Modified**: pages/add/eventCreateViewState.ts (new), pages/add/EventCreateView.tsx (rewritten), test/eventCreateViewState.test.ts (new), test/AppPage.test.tsx
**Visual**: unavailable ✓ (no role=status on static card), hub toast ✓, empty form ⚠ height unverified in browser
**Notes**: FRAME_STYLE calc(100dvh - 240px), minHeight 560px; onDone trims/caps name, showToast, invalidate [LOCATIONS_KEY], navigate /add.

## 2026-10-28T12:52:50Z - Group 7 Complete (Wave 2)

**Steps**: 7.1 through 7.6 completed
**Standards Applied**:
- From plan: plugins/CLAUDE.md (plugin-ui.css deliberately not used, per spec), frontend/css.md, global/validation.md, global/coding-style.md, global/minimal-implementation.md, global/conventions.md
- From INDEX.md: global/error-handling.md
**Tests**: npx tsc -b exit 0; Copy-table checklist 20/20 exact; mapper + rule tables verified by reading
**Files Modified**: plugins/events/{package.json, package-lock.json, vite.config.ts, tsconfig.json, index.html, manifest.json, src/vite-env.d.ts, src/styles.css, src/domain.ts}
**Notes**: tsBuildInfoFile moved under node_modules/.tmp (root .gitignore lacks *.tsbuildinfo); listMyLocations maps 401→session (spec gap); main.tsx comes in Group 8.
**Standards suggestion (pending user)**: plugin tsconfig tsBuildInfoFile under node_modules/.tmp or add *.tsbuildinfo to root .gitignore.

## 2026-10-28T12:53:34Z - Group 2 Complete (Wave 2)

**Steps**: 2.1 through 2.9 completed
**Standards Applied**:
- From plan: backend/api.md, backend/models.md, backend/security.md, backend/time.md, global/error-handling.md, global/validation.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: classifier stub pattern from tests/test_conversation_messages.py; term router _term_response pattern
**Tests**: 74 passed (test_events.py 14 cases, matrix, clock guard, migration); ruff + mypy clean on touched files
**Files Modified**: tests/test_events.py (new), tests/test_authorization_matrix.py, tests/test_domain_clock_guard.py, app/core/errors.py, app/moderation/text_guard.py, app/events/infrastructure/{__init__,locations_acl}.py, app/events/{schemas,service,router}.py, app/core/authorization_matrix.py, app/main.py
**Notes**: AccessDeniedException.public_message (additive); EventNotFound/NotEventAuthor ready for G3; both matrix rows in place; pre-existing ruff-format drift in test_domain_clock_guard.py:168 left untouched.

## 2026-10-28T12:53:34Z - Wave 2 resolved (Groups 2, 6, 7)

## 2026-10-28T12:55:48Z - Group 10 Complete (Wave 3)

**Steps**: 10.1 through 10.4 completed
**Standards Applied**: global/conventions.md, global/commenting.md, backend/plugin-auth.md
**Tests**: grep checklist all present (add.event, uploadImage, done, build:sdk, 3003, 3004, <admin-token>); secret scan clean
**Files Modified**: plugins/CLAUDE.md (+53/-5)
**Notes**: Events Plugin reference entry describes spec flow — re-check against Group 8/9 output in Group 11.

## 2026-10-28T12:56:38Z - Group 3 Complete (Wave 3)

**Steps**: 3.1 through 3.5 completed
**Standards Applied**:
- From plan: backend/api.md, backend/security.md, backend/queries.md, backend/models.md, backend/migrations.md (outbox staging), global/error-handling.md, testing/backend-testing.md
- From INDEX.md: backend/time.md (freeze_local_now in tests)
**Tests**: 74 passed (test_event_banners.py 5 new + test_events.py + matrix); ruff + mypy app/events clean
**Files Modified**: app/events/service.py, app/events/router.py, tests/test_event_banners.py (new)
**Notes**: FOR UPDATE lock is first DB call (verify in code review; uq_event_banners_event_id is backstop); 409 reuses AVATAR_UPLOAD_DISABLED_MESSAGE; banners public+APPROVED even with image moderation on.

## 2026-10-28T13:01:08Z - Group 8 Complete (Wave 3)

**Steps**: 8.1 through 8.7 completed
**Standards Applied**:
- From plan: frontend/accessibility.md, global/validation.md, frontend/components.md, frontend/css.md, frontend/responsive.md, plugins/CLAUDE.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
**Tests**: npm run build passed; Playwright checklist at 360px passed (standalone, no SDK)
**Files Modified**: plugins/events/src/main.tsx, pages/EventCreatePage.tsx, components/BannerPicker.tsx, LocationField.tsx, LocationSheet.tsx (all new)
**Visual**: errors ✓, picker sheet ✓, banner picker ✓, location field ✓, filled ✓ (chosen place by code only), empty ⚠ placeholder font 12px vs 15px/600
**Issues**: plugin-sdk.js blocked in dev — Vite requires crossorigin attribute on the cross-origin classic <script>; scope of Group 9 extended to fix plugins/events/index.html + docs snippet, and add .loc .ph style.
**Standards suggestion (pending user)**: shared focus-trap helper for panel plugins.

## 2026-10-28T13:01:08Z - Wave 3 resolved (Groups 3, 8, 10)

## 2026-10-28T13:05:34Z - Group 9 Complete (Wave 4)

**Steps**: 9.1 through 9.5 completed + extended scope (crossorigin on SDK script in plugins/events/index.html and plugins/CLAUDE.md snippets; .loc .ph placeholder style)
**Standards Applied**:
- From plan: frontend/accessibility.md, global/validation.md, global/error-handling.md, frontend/components.md, frontend/css.md, frontend/responsive.md, plugins/CLAUDE.md
- From INDEX.md: global/minimal-implementation.md
**Tests**: npm run build passed; Playwright at 360px with stubbed PluginSDK: create 500/401, banner 500→retry→saved, banner 400 detail→skip, done({name}) — all as specified
**Files Modified**: plugins/events/src/pages/EventCreatePage.tsx, components/{SaveProgress,SavedCard,BannerFailed}.tsx (new), components/LocationField.tsx, src/styles.css, index.html, plugins/CLAUDE.md
**Visual**: saving ⚠ (pre-POST spinner state added, fake 62% bar omitted), saved ✓, banner-failed ✓
**Notes**: Intl.DateTimeFormat pl-PL; placeholder uses ink-soft for 4.5:1 contrast; box-size/warehouse index.html have the same missing crossorigin (follow-up); .playwright-mcp/ not git-ignored (follow-up).

## 2026-10-28T13:05:34Z - Wave 4 resolved (Group 9)

## 2026-10-28T13:14:30Z - Group 11 Complete (Wave 5)

**Steps**: 11.1 through 11.5 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md
- From INDEX.md: frontend/data-fetching.md, backend/security.md, backend/models.md, backend/migrations.md
**Tests**: backend feature 82 passed; frontend feature 166 passed; tsc clean; plugin build ok; 7 tests + 1 parametrize row added
**Files Modified**: tests/test_events.py, tests/test_event_banners.py, src/frontend/src/test/{AppPage.test.tsx, plugins.test.tsx, plugin-sdk.test.ts}
**Copy parity**: all Copy-table rows exact in backend/plugin (script check)
**Notes**: observation — service.py:172-173 storage.put before try can orphan large image if thumb put fails (same as avatar pattern); extension-points.test.tsx 2 pre-existing failures unchanged.

## 2026-10-28T13:14:30Z - Wave 5 resolved (Group 11)

## 2026-10-28T13:24:28Z - Implementation Complete

**Total Steps**: 67 (66 done, 6.5 deferred to E2E)
**Waves**: 5 (W1 1,4,5 · W2 2,6,7 · W3 3,8,10 · W4 9 · W5 11)
**Test Suite**: backend FULL 908 passed. Frontend FULL 1192 passed / 9 failed — 8 failures pre-existing (identical on a clean HEAD archive: auth, extension-points x2, foundation, PendingActionsHost, PublicLayout x2, TermPage), 1 flaky (OrganizerEditor focus test: passes 3/3 in isolation). No regressions attributable to this feature.
**Follow-ups**: event list/detail + sign-ups; banner moderation; prod plugin hosting; EntityId int→UUID; crossorigin in box-size/warehouse index.html; .playwright-mcp/ gitignore; pre-existing frontend failures; orphan large image if thumb put fails (avatar pattern); iframe height tuning (6.5).

## 2026-10-28T13:50:09Z - Verification fixes (cycle 1)

**Fixed (user-selected 1,2,3,4,8)**:
1. set_event_banner: puts inside try, delete only stored keys, cleanup failure logged — + test_uploadBanner_thumbPutFails_deletesStoredLargeKeepsOldBanner
2. done payload normalized to {} (no throw); EventCreateView acts only for view.point.pluginId — + it.each (3 cases) in plugins.test.tsx
3. per-call SDK timeout; uploadImage 60 s; plugin create timeout → MESSAGES.createUnconfirmed (spec Copy table row create.unconfirmed) — + plugin-sdk.test.ts timeout test; SDK rebuilt
4. toEvent/toBanner validate only fields the plugin reads
8. architecture.md app/events section + INDEX.md line; plugins/CLAUDE.md dev setup (plugin id, npm install, admin token, symptoms); curl restored multi-line (manual Edit — shell collapsed backslash-newline)
**Tests**: backend 23 passed (events + banners); frontend 170 passed (5 files); tsc clean; build:sdk + plugin build OK; copy parity 27/27
**Not changed**: 5, 6, 7, 9 (logged)

## 2026-10-28T14:05:40Z - Re-verification (cycle 2)

**Full suite**: backend 909/909; frontend 1195 passed / 10 failed (8 pre-existing + 2 flaky focus tests: OrganizerEditor, DeleteGroupDialog — both pass in isolation); plugin build OK
**Completeness re-check**: W2, W3 resolved; new W4 (spec still said 10 s for uploadImage) fixed in spec.md/spec.html
**Follow-up list correction**: the orphaned-banner-file item is FIXED (cycle 1); .playwright-mcp/ is already git-ignored — both earlier follow-up entries are obsolete.

## 2026-10-28T15:48:10Z - E2E fixes

**C1** (critical, pre-existing): api/plugins.ts maps extension_points → extensionPoints (+ src/test/pluginsApi.test.ts with real backend shape) — plugin now renders live
**m1/6.5**: EventCreateView wrapper h-[calc(100dvh-250px)] min-h-[400px] min-[520px]:h-[calc(100dvh-314px)] — host no longer scrolls (measured)
**m2**: BannerPicker clears stale banner error · **N2/N3**: domain.ts 201-unparsable → createUnconfirmed, bad location → null (spec updated)
**Tests**: 172 passed + 2 pre-existing extension-points failures; tsc/eslint clean; plugin build OK
**Data**: dev DB migrated to 0070; E2E test users e2e-events-*, e2e-plugadmin-* (PLUGIN_MANAGEMENT), e2e-fix-*; plugin 'events' registered; stray 'Events' registration pre-existed

## 2026-10-28T15:55:55Z - Workflow finalized

All phases resolved (3, 9 skipped: no defect). Artifact reconciliation: nothing missing. Code changes uncommitted (task artifacts were committed by the user in 4f4033b/364c05c).
