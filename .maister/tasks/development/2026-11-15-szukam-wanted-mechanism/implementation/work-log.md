# Work Log

## 2026-11-15T16:59:20Z - Implementation Started

**Total Steps**: 139
**Task Groups**: 1 Test and static-check baseline · 2 Groups visibility annotations · 3 Moderation fields and notification kinds and writers · 4 Wants data model and migration 0099 · 5 Wants domain rules, links and anti-corruption layers · 6 Match statement · 7 Match statement measurement and index decision · 8 Want writes, lifecycle transitions and want API · 9 Match list API · 10 Scan job, sweep and scheduler wiring · 11 Frontend data layer and paths · 12 Shared component changes · 13 Want list view · 14 Want form view · 15 Match list view · 16 Routes, entry points and mock removal · 17 Closing prompt on the item page · 18 Project documentation · 19 Test review, gap analysis and baseline comparison

**Mode**: parallel waves. Task-tracking tool unavailable in this session; the plan's checkboxes are the progress source.
**Standing rules**: no git writes; secrets never printed; no new test failures against `implementation/baseline/`.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## Baseline (Group 1)

Recorded 2026-11-15 at HEAD `92659eb` (branch `feature/global-search-group-description`), before any source change. Raw lists are in `implementation/baseline/`.

**Preconditions**: Docker answered (`docker info` exit 0). `git status --short` showed the untracked `implementation/work-log.md` and two modified tracked files, both in the task folder (`dashboard-data.js`, `orchestrator-state.yml`); nothing outside the task folder. No source file changed in this group and no command changed a tracked file.

| Check | Command | Result | File |
|-------|---------|--------|------|
| Backend tests | `uv run python -m pytest -q` | 2 failed, 1352 passed, 0 errors (20 min 58 s) | `baseline/backend-pytest.txt` |
| Backend types | `uv run python -m mypy app` | 15 errors in 8 files (255 checked) | `baseline/backend-mypy.txt` |
| Backend lint | `uv run python -m ruff check` | 65 errors (56 E501, 8 I001, 1 UP017) | `baseline/backend-ruff.txt` |
| Frontend tests | `npm run test` | 33 failed, 1677 passed (1710); 12 of 164 files failed | `baseline/frontend-vitest.txt` |
| Frontend types | `npm run typecheck` | 0 errors | `baseline/frontend-typecheck.txt` |
| Frontend lint | `npm run lint` | 38 problems: 10 errors, 28 warnings | `baseline/frontend-lint.txt` |

**Backend failing set (2)**
- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` (expects `location_name` None, gets a locality label)
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` (expects column `group_id`, finds `circle_group_id`)

**Frontend failing set (33 tests in 12 files; test ids in `baseline/frontend-vitest.txt`)**
- `AppPage.test.tsx` 12, `EventPage.test.tsx` 7, `PublicLayout.test.tsx` 3, `extension-points.test.tsx` 2, `routeManifest.test.ts` 2, and 1 each in `foundation.test.tsx`, `ItemDetailPage.test.tsx`, `OrganizerItemRoute.test.tsx`, `ParticipantItemsPreview.test.tsx`, `PendingActionsHost.test.tsx`, `reservedSlugs.test.ts`, `TermPage.test.tsx`.
- Flaky: none. The 12 failing files were run a second time and the same 33 tests failed. `OrganizerEditor` passed.

**Failing files this task edits** (per the plan's Files to Modify)
- `test/AppPage.test.tsx`: 12 baseline failures (missing "+ Dodaj termin" link, missing "Prowadzę" heading, "· 1" / "· 2" counts).
- `test/routeManifest.test.ts`: 2 baseline failures (panel section list is one entry short of the expected 30; `PanelGate` lacks `pathname === viewPath("search")`).
- `test/ItemDetailPage.test.tsx`: 1 baseline failure ("Wróć on a directly opened page falls back to the owner's page").
- Not named in the plan but touching the same area: `test/reservedSlugs.test.ts` (static top-level segment list; a new top-level route changes it) and `test/PublicLayout.test.tsx`.
- The other 7 failing frontend files and both failing backend tests are not edited by this task.

**Static-check lines in files this task is likely to touch**: mypy `app/main.py:20` (apscheduler stubs) and `app/inventory/application/inventory_items.py:203`; lint warnings in `features/panel/AppDataContext.tsx` (3) and `features/items/MyItemsView.tsx` (2).

**Difference from project memory (2026-11-12, HEAD b8c45e0)**: memory lists 24 Vitest + 5 typecheck + 2 backend failures; this HEAD has 33 Vitest, 0 typecheck, 2 backend. The mypy count matches (15).

## 2026-11-15T17:25:21Z - Group 1 Complete (wave 1)

**Steps**: 1.1 through 1.6 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, testing/frontend-testing.md, global/conventions.md
- From INDEX.md: none
- Discovered: none
**Tests**: baseline only — backend 1352 passed / 2 failed; mypy 15; ruff 65; Vitest 1677 passed / 33 failed in 12 files; typecheck 0; lint 10 errors + 28 warnings
**Files Modified**: implementation/baseline/*.txt (6 files), this log (section "Baseline (Group 1)")
**Notes**: HEAD 92659eb. No flaky tests. Compare later runs by test id, not by count. The two "likely to touch" guesses in the baseline section (reservedSlugs, PublicLayout) are the implementer's guesses, not plan facts.

### Standards Reading Log — Group 1
**From Implementation Plan**: testing/backend-testing.md, testing/frontend-testing.md, global/conventions.md

## 2026-11-15T17:30:36Z - Group 3 Complete (wave 2)

**Steps**: 3.1 through 3.7 completed
**Standards Applied**:
- From plan: backend/queries.md, backend/models.md, global/error-handling.md, testing/backend-testing.md, global/minimal-implementation.md
- From INDEX.md: global/commenting.md
- Discovered: backend/time.md (naive UTC audit timestamps set per row in the batch insert)
**Tests**: 14 passed (tests/test_wants_notifications.py + tests/test_notifications.py); mypy 15 (baseline 15); ruff 65 (baseline 65)
**Files Modified**: app/moderation/text_guard.py, app/notifications/models.py, app/notifications/service.py, tests/test_wants_notifications.py (created)
**Notes**:
- New in `app.notifications.service`: `NotificationEntry(party_id, kind, message, link_path, previous_id)`, `WrittenNotification(id, previous_deleted)`, `replace_unread_notifications(db, entries) -> list[WrittenNotification]` (same order as entries), `delete_unread_notifications(db, notification_ids) -> set[UUID]`.
- The writer runs one `DELETE ... RETURNING` and one multi-row `INSERT` with explicit ids and timestamps; no statement for an empty list, insert only when no entry has a `previous_id`; it never commits or flushes itself.
- "To confirm" text used: WANT_NOTE message "Notatka narusza zasady społeczności. Zmień ją i spróbuj ponownie."
- tests/test_text_guard.py was run once (29 passed with the group files) before the last mypy fix and not re-run after it.

## 2026-11-15T17:30:36Z - Group 2 Complete (wave 2)

**Steps**: 2.1 through 2.4 completed
**Standards Applied**:
- From plan: testing/backend-testing.md, global/minimal-implementation.md (backend/models.md and backend/queries.md read from the INDEX summaries only)
- From INDEX.md: none
- Discovered: none
**Tests**: 27 passed (tests/test_visible_to.py + tests/test_membership_definition_guard.py); mypy 15 (baseline 15); ruff 65 (baseline 65)
**Files Modified**: app/groups/infrastructure/visibility.py (two annotations, two docstrings), tests/test_visible_to.py (3 tests, 2 helpers)
**Notes**:
- No red run was possible: the change is annotations only and the column form already worked at runtime.
- `parties_share_group` is not on the groups facade; wants code reaches the column form through `owner_shares_group_with`.
- `ruff format --check` would reformat the widened signature in visibility.py; left as is (ruff format is not a baseline check).

### Standards Reading Log — Groups 2 and 3
**Group 2 — From Implementation Plan**: testing/backend-testing.md, global/minimal-implementation.md, backend/models.md, backend/queries.md
**Group 3 — From Implementation Plan**: backend/queries.md, backend/models.md, global/error-handling.md, testing/backend-testing.md, global/minimal-implementation.md; **From INDEX.md**: global/commenting.md; **Discovered During Execution**: backend/time.md (batch insert timestamps)

## 2026-11-15T17:31:31Z - Group 4 Complete (wave 2)

**Steps**: 4.1 through 4.7 completed
**Standards Applied**:
- From plan: backend/models.md, backend/migrations.md, backend/time.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 4 passed (tests/test_wants_migration.py); mypy 15 (baseline 15); ruff 65 (baseline 65)
**Files Modified**: alembic/versions/0099_wants.py, app/wants/__init__.py, app/wants/models.py, app/wants/domain/__init__.py, app/wants/domain/status.py, tests/test_wants_migration.py (all created)
**Notes**:
- **Run-only check O1 (first half): PASSED.** PostgreSQL 18 accepts `name_query tsquery GENERATED ALWAYS AS (plainto_tsquery('simple'::regconfig, fold_pl(name))) STORED`. The fallback is NOT used. Groups 6 and 8 must not write `name_query` or `name_folded`. The second half (the column used by a match through an ORM insert) is proven by the create-and-match test of a later group.
- Entities: `Want`, `WantMatch`, `WantScanMarker` in `app.wants.models`; enums `WantStatus`, `WantMatchSource` in `app.wants.domain.status`; `Want.offer_mode` is a plain `str | None`.
- `Want.name_folded` and `Want.name_query` are deferred with raiseload: use them as column expressions only. `Want.short_words_query` must be written by a SQL expression in the statement that writes the name.
- A test or module using `Want` without the app loaded needs `import app.main` for FK resolution.
- Deviations: tests, migration and models were written before the first test run (no recorded red run); the downgrade also drops the four FK constraints explicitly; `pk_want_scan_markers` added by convention; the 0099 docstring already carries the rollback hint (delete rows of the two new notification kinds first).

### Standards Reading Log — Group 4
**From Implementation Plan**: backend/models.md, backend/migrations.md, backend/time.md, testing/backend-testing.md; **From INDEX.md**: global/minimal-implementation.md, global/commenting.md

## 2026-11-15T17:33:50Z - Group 12 Complete (wave 2)

**Steps**: 12.1 through 12.8 completed
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md
- From INDEX.md: global/commenting.md
- Discovered: ESLint react-refresh/only-export-components (a constant exported from a component file adds a lint error)
**Tests**: 59 passed in 6 files (RadiusChips, ItemCard, BottomNav, CategoryTreePicker, LocalityCombobox, SearchView); typecheck 0 (baseline 0); lint 10 errors / 28 warnings (baseline 10 / 28)
**Files Modified**: components/shared/chipStyles.ts and RadiusChips.tsx (created), features/search/SearchFilters.tsx, features/search/useSearchUrlState.ts, components/shared/ItemCard.tsx, CategoryTreePicker.tsx, LocalityCombobox.tsx, components/layout/BottomNav.tsx, utils/appHelpers.ts, test/RadiusChips.test.tsx, test/ItemCard.test.tsx, test/BottomNav.test.tsx (created), test/CategoryTreePicker.test.tsx, test/LocalityCombobox.test.tsx. test/AppPage.test.tsx not edited.
**Visual Compliance**: wanted-form.html (radius chips order and labels, picker and combobox texts) and wanted-matches.html ("nowe" marker; intent pill keeps today's labels per the spec override) matched.
**Notes**:
- New names: `RadiusChips` (`{value: number | null, onChange}`, null = "Tylko tu"), `RADII_KM` in utils/appHelpers.ts (replaces `SEARCH_RADII_KM`), `FOCUS_CLASS` / `CHIP_CLASS` / `chipTone` in chipStyles.ts, `ItemCard` prop `marker`, `CategoryTreePicker` prop `clearLabel` (rendered only with `mode="any"` and `allowRoot`), `LocalityCombobox` prop `placeholder`, `isAccountSubviewPath`.
- "Konto" is now highlighted on /wanted/..., /places/new, /places/:id/edit, /groups/new, /groups/:id, /groups/:id/edit, /family/..., and deeper paths of the other account sub-views; the match is on a segment boundary.
- Deviation: the radius list lives in utils/appHelpers.ts, not beside the chips, because of the lint rule above.
- The AppPage + PublicLayout regression run (15 failures, exactly the baseline ids) was made before the last edit that moved `RADII_KM`.

### Standards Reading Log — Group 12
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md; **From INDEX.md**: global/commenting.md; **Discovered During Execution**: lint rule react-refresh/only-export-components (step 12.3)

## 2026-11-15T17:35:05Z - Group 11 Complete (wave 2)

**Steps**: 11.1 through 11.8 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, frontend/components.md, testing/frontend-testing.md, global/coding-style.md, global/commenting.md, global/minimal-implementation.md
- From INDEX.md: frontend/accessibility.md (WantNotFound heading, decorative icon, focus ring)
- Discovered: none
**Tests**: 72 passed in 6 files (useWants, useWantMatches, wantText, pendingActions, MyItemsViewCategory, NotificationBell); typecheck 0 (baseline 0); lint 10 errors / 28 warnings (baseline 10 / 28)
**Files Modified**: routing/paths.ts, api/wants.ts (created), api/notifications.ts, hooks/useWants.ts and useWantMatches.ts (created), features/wanted/wantText.ts and WantNotFound.tsx (created), test/fixtures/wants.ts (created), test/useWants.test.tsx, useWantMatches.test.tsx, wantText.test.ts (created), test/pendingActions.test.ts, MyItemsViewCategory.test.tsx, NotificationBell.test.tsx
**Visual Compliance**: bell-rows.html matched (three rows, exact messages, unchanged bell). wanted-matches-states.html not-found frame matched with two deviations: SearchIcon instead of the "?" glyph (spec override on icons) and an h1 instead of a p for the title (accessibility standard).
**Notes**:
- `useWants()` returns `{data, loading, error, refetch, create, update, extend, close, resume, findMatching}`; `useWantMatches(id)` returns `{want, matches, loading, notFound, error, refetch, markSeen, markOpened}`; key prefix `WANTS_KEY = "wants"`, token in the key of both hooks (deviation from the useEvent template, because wants are private).
- `WantStatus` on the client includes WITHDRAWN, because the close call returns the want it just withdrew.
- The stale `PLEDGE_ITEM_REGISTERED` member was removed from the NotificationKind union; the kind list test now holds the 13 backend members.
- "To confirm": day-count rounding (`daysUntil` rounds up, `daysSince` counts full days, removal = closed_at + 30 days) and the wording "1 dzień" for one day.
- `WantNotFound` has no test of its own yet; groups 14 and 15 render it.
- Group 16 still has to remove `"add/hunting"` from `View`.

### Standards Reading Log — Group 11
**From Implementation Plan**: frontend/data-fetching.md, frontend/components.md, testing/frontend-testing.md, global/coding-style.md, global/commenting.md, global/minimal-implementation.md; **From INDEX.md**: frontend/accessibility.md

## 2026-11-15T17:41:27Z - Group 17 Complete (wave 3)

**Steps**: 17.1 through 17.7 completed
**Standards Applied**:
- From plan: frontend/accessibility.md, frontend/components.md, frontend/data-fetching.md, global/error-handling.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: none
**Tests**: CloseWantSheet 5 passed; useItemTake 9 passed; ssrSafety 17 passed; ItemDetailPage: 1 failure, the baseline id ("Wróć on a directly opened page falls back to the owner's page"). Lint 10 / 28 (baseline). Typecheck showed 1 error in a sibling's unfinished file (test/WantMatchesView.test.tsx); to be re-run after the wave.
**Files Modified**: features/product/useItemTake.ts, features/product/TakeSuccessSheet.tsx, features/product/blocks/ItemPickupActions.tsx, features/wanted/CloseWantSheet.tsx (created), test/CloseWantSheet.test.tsx (created), test/useItemTake.test.tsx, test/ItemDetailPage.test.tsx
**Visual Compliance**: close-want-sheet.html matched (one want and several wants); the only addition is the inline error line above the buttons.
**Notes**:
- Deviation from step 17.5: the item page calls `api/wants.ts` directly (`getMyWants(itemId)`, `closeWant`) instead of `useWants()`. Reasons given: mounting the hook would load the whole want list on every item page for a logged-in viewer, and the hook's `close` drops the HTTP status needed to treat 409 / 404 as done.
- 409 and 404 count as done on any attempt, not only on a retry. A failed lookup shows nothing.
- "To confirm" text: "Nie udało się zamknąć poszukiwania. Spróbuj ponownie." (fallback when the server gives no message).
- Known limit: the prompt waits only for the "Wzięte!" sheet; another dialog opened right after a personal take, before the lookup answers, could overlap with it.

### Standards Reading Log — Group 17
**From Implementation Plan**: frontend/accessibility.md, frontend/components.md, frontend/data-fetching.md, global/error-handling.md, testing/frontend-testing.md; **From INDEX.md**: global/minimal-implementation.md

## 2026-11-15T17:41:37Z - Group 13 Complete (wave 3)

**Steps**: 13.1 through 13.6 completed (tests written before the code, but first run only after the view existed: no recorded red run)
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md
- From INDEX.md: global/error-handling.md
- Discovered: none
**Tests**: 13 passed (wantedListViewState 5, WantedListView 8); lint 10 / 28 (baseline). Typecheck showed 1 error in a sibling's unfinished file; to be re-run after the wave.
**Files Modified**: features/wanted/WantedListView.tsx, features/wanted/wantedListViewState.ts, test/wantedListViewState.test.ts, test/WantedListView.test.tsx (all created)
**Visual Compliance**: wanted-list.html matched with the spec overrides (category node name, icons from appIcons.tsx). Judgement call: the header "+ Dodaj" link is rendered in the list state only (the empty state has its own "+ Dodaj poszukiwanie").
**Notes**:
- `WantedListView` takes no props, has no "use client" line and renders its own back link "‹ Konto", h1 and intro.
- The server's order is rendered as is; no client-side sort.
- "To confirm": "+ Dodaj" in the header only in the list state; day counts rendered literally ("Wygasło 0 dni temu", "Ważne jeszcze 0 dni" are possible on the last day); retry label "Spróbuj ponownie".
- For group 16: AppPage.test.tsx lines 2977-2997 change when the route is switched (the inline add test goes away).

### Standards Reading Log — Group 13
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/minimal-implementation.md; **From INDEX.md**: global/error-handling.md

## 2026-11-15T17:42:11Z - Group 5 Complete (wave 3)

**Steps**: 5.1 through 5.8 completed
**Standards Applied**:
- From plan: backend/models.md, backend/time.md, global/validation.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md
- From INDEX.md: global/error-handling.md, backend/security.md
- Discovered: none
**Tests**: 63 passed, 1 failed in the four-file run (test_wants_domain, test_module_boundaries, test_domain_clock_guard, test_membership_definition_guard); mypy 15 (baseline 15); ruff 65 (baseline 65)
**EXPECTED RED until group 8**: `tests/test_module_boundaries.py::test_appModules_importingModule_onlyMain[wants]` asserts that the importers of `app.wants` are exactly `["main.py"]`; `app/main.py` imports the module only in group 8. The assertion was left strict. Group 8 must re-run tests/test_module_boundaries.py and report it green.
**Files Modified**: app/wants/domain/{limits,validation,lifecycle,links,messages}.py, app/wants/infrastructure/{__init__,groups_acl,inventory_acl,product_acl,category_acl,locations_acl,users_acl,organizations_acl,moderation_acl,notifications_acl}.py, tests/test_wants_domain.py (all created); tests/test_module_boundaries.py, tests/test_domain_clock_guard.py (modified)
**Notes**:
- Domain exports: limits (NAME_MIN_LENGTH 3, NAME_MAX_LENGTH 80, NOTE_MAX_LENGTH 300, RADIUS_MIN_KM 1, RADIUS_MAX_KM 100, MAX_ACTIVE_WANTS 30, MATCH_TOP_N 20, VALIDITY 90 d, REMINDER_LEAD 7 d, RETENTION 30 d, AUTO_EXTENSION_WINDOW 30 d, SCAN_INTERVAL 15 min, SCAN_OVERLAP 5 min, SIMILARITY_THRESHOLD_WITHOUT_CATEGORY 0.70, SIMILARITY_THRESHOLD_WITH_CATEGORY 0.60, FORWARD_STATEMENT_TIMEOUT_SECONDS 3); validation (`clean_name`, `clean_note`, `clean_radius(radius_km, *, has_locality, locality_cleared=False)`, each raising ValueError with a Polish message); lifecycle (`WantAction`, `CLOSE_OUTCOMES`, `refusal(action, status) -> str | None`, `new_expiry(now)`, `auto_extension_due(expires_at, now)`); links (`product_path(slug, item_id)`, `want_path(want_id)`); messages (`single_match_message`, `several_matches_message`, `expiring_message` and the error-text constants; no 500-character cap applied here).
- ACL exports: groups_acl (ItemListingPreference, ItemVisibility, SwapProposal, SwapProposalStatus, VisibilityScope, derive_party_slug, items_visible_to, owner_shares_group_with, with_pending_proposer); inventory_acl (BalanceStatus, InventoryItem, ItemCondition, listed_items_with_product_select, newest_open_reservation_starts_at); product_acl (Product, first_approved_photo_by_product); category_acl (Category); locations_acl (Locality, Location); users_acl (CallerProfile(party_id, account_user_id), get_caller_profile(db, principal), 401 without a profile); organizations_acl (get_own_organizations_by_party_ids); moderation_acl (TextField, check_text, ensure_no_contact_info); notifications_acl (NotificationEntry, NotificationKind, WrittenNotification, create_notification, delete_unread_notifications, replace_unread_notifications).
- "To confirm" texts used verbatim from the spec: "Nazwa musi zawierać literę lub cyfrę.", "Notatka może mieć najwyżej 300 znaków.", "Promień można ustawić tylko razem z miejscowością.", "Promień musi mieć od 1 do 100 km.", "Wybrana kategoria nie istnieje.", "Wybrana miejscowość nie istnieje.", "To poszukiwanie nie jest aktywne. Wznów je, aby je edytować.", "Przedłużyć można tylko aktywne poszukiwanie.", "To poszukiwanie jest już zamknięte.", "To poszukiwanie jest już aktywne.", "Nie znaleziono poszukiwania.", "Nie znaleziono dopasowania.", "Szukanie dopasowań trwa zbyt długo. Spróbuj ponownie za chwilę.", plural "{n} nowych pasujących rzeczy." (12-14 and 112-114 take "nowych": the standard Polish rule, the spec names only 2-4 and 22-24).
- Deviations: notifications_acl re-exports instead of wrapping and also exports NotificationEntry / WrittenNotification; domain/ raises no typed exception (application/errors.py does in group 8).
- Not added (not in FR-X-03): a constant for the short-word length (3) and a scan-marker name. Groups 6 and 10 define them locally in their own files.

### Standards Reading Log — Group 5
**From Implementation Plan**: backend/models.md, backend/time.md, global/validation.md, global/minimal-implementation.md, global/commenting.md, testing/backend-testing.md; **From INDEX.md**: global/error-handling.md, backend/security.md

## 2026-11-15T17:42:57Z - Group 15 Complete (wave 3)

**Steps**: 15.1 through 15.8 completed (tests written before the code; both files first run after the code existed, so no recorded red run)
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/error-handling.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: none
**Tests**: 20 passed (wantMatchesViewState 12, WantMatchesView 8); typecheck 0 (baseline 0); lint 10 / 28 (baseline)
**Files Modified**: features/wanted/WantMatchesView.tsx, wantMatchesViewState.ts, WantNotificationToggle.tsx, MatchCard.tsx, test/wantMatchesViewState.test.ts, test/WantMatchesView.test.tsx (all created)
**Visual Compliance**: wanted-matches.html matched; deviation: with the switch off the filter line also ends with "· powiadomienia wyłączone" (from wantSummary, FR-F-12 / FR-F-31; the mockup's second frame does not show it). wanted-matches-states.html matched; deviations: SVG BellIcon instead of the emoji, the withdraw dialog is the centred ConfirmDeleteDialog (FR-F-36) not a bottom sheet, an expired want with no stored matches shows no heading and no grid.
**Notes**:
- `WantMatchesView` takes no props and reads the want id from `useAppParams()` as `id` (route segment `[id]`).
- Action layout depends only on the days left: at 7 days or fewer "Przedłuż o 90 dni" is primary, otherwise "Znalezione — zamknij" is primary.
- The view also calls `useWants()` for the mutations, so the page loads the wants list as well as the want and its matches.
- After a successful withdraw the page renders nothing until the navigation to /wanted lands (avoids a flash of the not-found state).
- Card order may jump a moment after load: the server sorts new matches first and the refetch after "seen" returns none as new; the server order is kept as it arrives.
- "To confirm": "wygasło dzisiaj" / "Oznaczone jako znalezione dzisiaj" for a want closed today (the list view of group 13 renders "0 dni temu" — the two views differ); "Szukam znowu" as the fulfilled action; primary-soft tone for the fulfilled notice; texts "Wczytywanie…", "Spróbuj ponownie", "Wycofywanie…", "Nie udało się zapisać zmiany. Spróbuj ponownie.", "Nie udało się zapisać zmiany.", "Nie udało się wycofać poszukiwania. Spróbuj ponownie."
- `WantNotFound` is now covered by this group's not-found test.

### Standards Reading Log — Group 15
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md, global/error-handling.md; **From INDEX.md**: global/minimal-implementation.md

## 2026-11-15T17:44:20Z - Group 14 Complete (wave 3)

**Steps**: 14.1 through 14.8 completed (tests written before the components; first run after the implementation, no recorded red run)
**Standards Applied**:
- From plan: frontend/components.md, frontend/accessibility.md, global/validation.md, global/error-handling.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 20 passed (wantFormViewState 12, WantFormView 8); typecheck 0 (baseline 0); lint 10 / 28 (baseline)
**Files Modified**: features/wanted/WantFormView.tsx, wantFormViewState.ts, WantDisclosure.tsx, OfferModeChips.tsx, test/wantFormViewState.test.ts, test/WantFormView.test.tsx (all created)
**Visual Compliance**: wanted-form.html matched with the spec override on the location block; the shared pickers keep their own styling and a prefilled locality shows as the combobox chip with "zmień". component:want-disclosure matched. wanted-form-errors.html matched with deviations: the "N/80 znaków" counter stays visible under the inline error; the disclosure is collapsed for a name-only prefill (FR-F-22 over the frame); the intro stays on create (FR-F-21).
**Notes**:
- `WantFormView` takes no props; edit mode when the route param `id` is present. Query parameters read on /add/wanted: `name` (as typed), `category`, `offer_type` (GIFT / SWAP), `locality` (7 digits), `radius` (10 / 25 / 50, only with a valid locality).
- Back link: "‹ Szukaj" (to /search rebuilt from the prefill; scope and condition are not restored) when any prefill value is present, else "‹ Dodaj"; on edit "‹ {want name}".
- Edit mode finds the want on the `useWants()` list; a non-ACTIVE want redirects to its match page; the PATCH always sends all six want fields and never `notifications_enabled` (relies on the server comparing stored values before re-matching, FR-W-06).
- No toast after save. The "letter or digit" name rule and a prefilled category id are validated by the server only.
- **Open issue**: the "Zobacz listę" link on the cap error is keyed on the cap message TEXT (constant `LIMIT_MESSAGE` in WantFormView.tsx), because `useWants` mutations rethrow a plain Error and drop the HTTP status. The cap is the only 409 on create today; if the server copy changes, the link disappears silently. A proper fix changes hooks/useWants.ts (outside this group's files).
- "To confirm" texts: "Notatka może mieć najwyżej 300 znaków.", "Nie udało się zapisać poszukiwania.", "Ładowanie poszukiwania…", "Spróbuj ponownie".
- Observation: the existing contact-details message says "Nazwa i opis…" and ends without a full stop; it is shown verbatim as decided, though this form's second field is a note.

### Standards Reading Log — Group 14
**From Implementation Plan**: frontend/components.md, frontend/accessibility.md, global/validation.md, global/error-handling.md, frontend/data-fetching.md, frontend/css.md, frontend/responsive.md, testing/frontend-testing.md; **From INDEX.md**: global/minimal-implementation.md, global/commenting.md

## 2026-11-15T17:52:21Z - Group 6 Complete (wave 4)

**Steps**: 6.1 through 6.8 completed (the matcher was written before the test file's first run: no recorded red run)
**Standards Applied**:
- From plan: backend/queries.md, backend/jooq.md, backend/models.md, backend/time.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md, global/coding-style.md
- Discovered: none
**Tests**: tests/test_wants_matcher.py 7 passed; guards 15 passed, 1 failed (the expected red `onlyMain[wants]` until group 8); mypy 15 (baseline 15); ruff 65 (baseline 65). Statement count: 1 for one want / one listing and 1 for four wants / three listings.
**Files Modified**: app/wants/application/__init__.py, app/wants/application/text_queries.py, app/wants/application/matcher.py, tests/test_wants_matcher.py (all created)
**Notes**:
- **Run-only check O1 (second half): PASSED.** Wants inserted through the ORM over asyncpg are matched through the generated `name_folded` / `name_query` columns in both text branches. No fallback; nobody writes `name_query`.
- Signatures (`app.wants.application.matcher`): `MatchedPair = tuple[UUID, UUID]` (want_id, item_id); `match_statement(*, now, source, seen_at, want_id=None, listed_after=None)`; `async match_want(db, want_id, *, now) -> list[MatchedPair]`; `async match_new_listings(db, *, listed_after, now) -> list[MatchedPair]`. `app.wants.application.text_queries`: `SHORT_WORD_MAX_LENGTH = 3`, `short_words_query(name) -> ScalarSelect` (assign the expression to the ORM attribute or use it in UPDATE values).
- Each entry function is one `db.execute`: no commit, no flush, no statement timeout (the 3 s timeout and the 57014 → 503 mapping are group 8's). Returned pairs are the INSERTED ones, in no guaranteed order.
- The reverse window is `created_at > listed_after AND created_at <= now`; the matcher does not subtract the overlap (group 10 passes marker − SCAN_OVERLAP).
- Design choices: one non-correlated recursive CTE for the category subtrees of the matchable wants, probed with EXISTS (watch its cost in group 7); the missing-point fallback is the NULL result of the haversine comparison, not a separate branch; `item_id` is the final tiebreak of the top-20 cut; the `<%` pre-filter runs at pg_trgm's default 0.6.
- For group 7: compile `match_statement(...)` with the asyncpg dialect (the default dialect renders `<%` as `<%%`).
- Deviations: `match_statement` is public (test pin and EXPLAIN); the category test reads GET /api/categories to find a leaf's parent; the soft-deleted-group and PUBLIC-only cases of the PRIVATE rule are pinned at predicate level in tests/test_visible_to.py only; threshold fixtures are nonsense words with the measured similarity band asserted as a precondition.

### Standards Reading Log — Group 6
**From Implementation Plan**: backend/queries.md, backend/jooq.md, backend/models.md, backend/time.md, testing/backend-testing.md; **From INDEX.md**: global/minimal-implementation.md, global/commenting.md, global/coding-style.md

## 2026-11-15T17:54:13Z - Group 16 Complete (wave 4)

**Steps**: 16.1 through 16.9 completed (16.8 closed by the coordinator, see the typecheck note)
**Standards Applied** (the implementer worked from the INDEX.md summaries, not the full standard files):
- From plan: frontend/components.md, frontend/data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md, frontend/accessibility.md
- From INDEX.md: global/commenting.md
- Discovered: none
**Tests**: 198 passed, 15 failed in 11 files; all 15 are baseline ids (AppPage 12, routeManifest 2, reservedSlugs 1), none new, none gone. Lint 10 / 28 (baseline).
**Typecheck**: the implementer ended at 2 errors, both in the stale git-ignored generated file `src/frontend/.next/dev/types/validator.ts` (written by a `next dev` run on 2026-11-14, still importing the deleted add/hunting page). The coordinator ran `npx next typegen` (it does not rewrite the dev folder), then removed that one stale generated file (no dev server was listening on 5173; `next dev` regenerates it). Result after that: `tsc --noEmit` exits 0 with no errors (baseline 0).
**Files Modified**: app/(site)/(panel)/wanted/page.tsx; wanted/[id]/page.tsx, wanted/[id]/edit/page.tsx, add/wanted/page.tsx (created); add/hunting/page.tsx (deleted); routing/paths.ts; features/add/AddView.tsx; features/account/AccountView.tsx; features/search/SearchView.tsx; features/search/WantedView.tsx, features/add/HuntingCreateView.tsx, test/HuntingCreateView.test.tsx (deleted); utils/mocks.ts; test/AppPage.test.tsx, addRoute.test.tsx, SearchView.test.tsx, routeManifest.test.ts, panelPages.ts, panelPages.test.ts, auth.test.tsx, ssrSafety.test.tsx. features/panel/PanelGate.tsx needed no change.
**Visual Compliance**: entry-points.html: tile and empty-search prompt matched (pill text uses the plural helper: "1 nowa", "2 nowe", "5 nowych"); deviation on the "Konto" row: the "M nowe dopasowania" part is plain text, not bold primary colour, because `ListCard`'s meta is a string and components/shared/appComponents.tsx is in no group's file list.
**Notes**:
- No reference to WantedView, HuntingCreateView, MOCK_WANTS, MockWant or "hunting" remains in src/frontend/src apart from five negative assertions in the tests.
- "Konto" row and tile: N = number of ACTIVE wants; the new-match number is summed over ACTIVE wants only.
- The two routeManifest baseline failures were left as they were (the expected list still contains /search, which lives under (public); PanelGate has no search branch).
- The prompt link is built with URLSearchParams, so a space in the name is "+", not "%20".
- "To confirm" texts: "1 nowe dopasowanie", "5 nowych dopasowań" in the "Konto" row.

### Standards Reading Log — Group 16
**From Implementation Plan**: frontend/components.md, frontend/data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md, frontend/accessibility.md (INDEX.md summaries only); **From INDEX.md**: global/commenting.md

## 2026-11-15T18:04:57Z - Group 8 Complete (wave 5)

**Steps**: 8.1 through 8.10 completed (red run recorded first: 13 failed before any implementation)
**Standards Applied**:
- From plan: backend/api.md, backend/security.md, backend/queries.md, backend/models.md, backend/time.md, global/validation.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 123 passed, 0 failed (test_wants_api, test_wants_lifecycle, test_authorization_matrix, test_module_boundaries, test_domain_clock_guard, test_membership_definition_guard); mypy 15 (baseline 15); ruff 65 (baseline 65)
**Expected red resolved**: `tests/test_module_boundaries.py::test_appModules_importingModule_onlyMain[wants]` is GREEN now that app/main.py includes the wants router.
**Statement counts**: create 9 with one match and 9 with three matches; list 3 with one want and 3 with four wants; a create rejected by the text checks issues 0 statements.
**Files Modified**: app/wants/schemas.py, app/wants/application/errors.py, reads.py, writes.py, app/wants/router/__init__.py, router/wants.py, tests/test_wants_api.py, tests/test_wants_lifecycle.py (created); app/main.py, app/core/authorization_matrix.py (rows 66-67), tests/test_authorization_matrix.py (modified). No ACL file changed.
**Notes**:
- Schemas: `CreateWantRequest`, `UpdateWantRequest`, `CloseWantRequest`, `WantResponse` (id, name, note, category_id, category_name, category_path, offer_mode, locality_id, locality_name, radius_km, notifications_enabled, status, expires_at, closed_at, created_at, match_count, new_match_count).
- Errors: `WantNotFound` (404), `WantActionRefused(message)` (409), `ActiveWantCapReached` (409), `ForwardMatchTimedOut` (503).
- Reads: `visible_matches(seeker_party_id, listed, *columns)` is the read-time filter group 9 must reuse; `load_want`, `list_wants`, `get_want`; `CATEGORY_PATH_SEPARATOR = " › "`.
- Writes (each commits and returns WantResponse): `create_want`, `update_want`, `extend_want`, `close_want`, `resume_want`; private helpers `_own_want`, `_ensure_allowed`, `_drop_unread_match_row`, `_timeout_as_unavailable`, `_set_forward_timeout`, `_ensure_below_cap`.
- The timeout is set only when a forward match will run. A PATCH sending the stored value counts as no change. A WITHDRAWN close returns the want once; every later request is 404.
- Deviations: `CLOSE_OUTCOMES` from the domain is unused (the request schema restricts the outcome); two conflict classes instead of one per message; test helpers are partly imported from other test files (`_Owner` from tests/test_wants_matcher.py, `KETY` from tests/test_search_location.py, `_auth` / `_register` from tests/test_term_item_listings.py, `FakeTextClassifier` from tests/test_text_guard.py; tests/test_wants_lifecycle.py imports helpers from tests/test_wants_api.py).
- Not run by this group: tests/test_wants_matcher.py, tests/test_wants_notifications.py, the full suite.
- Standards suggestion from the implementer (not applied): note in backend/models.md that `BaseEntity.id` passed to a UUID parameter needs `cast(uuid.UUID, entity.id)` under mypy.

### Standards Reading Log — Group 8
**From Implementation Plan**: backend/api.md, backend/security.md, backend/queries.md, backend/models.md, backend/time.md, global/validation.md, global/error-handling.md, testing/backend-testing.md; **From INDEX.md**: global/minimal-implementation.md, global/commenting.md

## 2026-11-16T07:39:38Z - Implementation Resumed

The run of 2026-11-15 stopped during wave 5 after group 8. Group 7 was interrupted after its baseline plans were saved (`measurement/plans/baseline/`, 68 files) and before `results.md`; `matcher.py` was unchanged since group 6. Wave 6 = groups 7 (resumed) and 9, in parallel.

## 2026-11-16T07:52:00Z - Group 9 Complete (wave 6)

**Steps**: 9.1 through 9.7 completed (red run recorded first: 8 failed before any implementation)
**Standards Applied**:
- From plan: backend/api.md, backend/queries.md, backend/security.md, backend/models.md, testing/backend-testing.md
- From INDEX.md: global/error-handling.md, global/commenting.md, global/minimal-implementation.md
- Discovered: backend/time.md (steps 9.5 / 9.6: `now` is `datetime.utcnow()` passed in from the router, as in group 8)
**Tests**: 16 passed (test_wants_matches_api + test_wants_api); 37 passed with test_wants_lifecycle and the three guards; mypy 15 (baseline 15; run before a last docstring-only re-wrap in writes.py); ruff 65 (baseline 65)
**Statement count**: match list 6 with one match / one owner and 6 with four matches / two owners.
**Files Modified**: tests/test_wants_matches_api.py (created); app/wants/schemas.py, app/wants/application/reads.py, app/wants/application/writes.py, app/wants/router/wants.py (modified). No ACL file changed.
**Notes**:
- New names: schemas `WantMatchMeta`, `WantMatchResponse`; reads `list_wants(db, principal, *, matched_item_id=None)`, `list_matches(db, principal, want_id, storage)`; writes `mark_matches_seen(db, principal, want_id, *, now) -> WantResponse`, `mark_match_opened(db, principal, want_id, item_id, *, now) -> None`, `WantMatchNotFound(item_id)`, private `_start_new_period(want, now)` (the one extend rule, used by `extend_want` and "seen").
- Routes: `GET /api/wants/{want_id}/matches`, `POST /api/wants/{want_id}/matches/seen` (200, the want), `POST /api/wants/{want_id}/matches/{item_id}/opened` (204), `GET /api/wants?matched_item_id=<uuid>` (malformed UUID is 400).
- Order: `reserved` ascending, new first, `score` descending, `item_id`. `subtitle` is always null. `reserved_until` is sent only for a reserved card and is null for a personal pickup or a pending proposal.
- `matched_item_id` checks the stored pair only, not the read-time filter; the counters of the returned wants still use the filter. "seen" and "opened" act on stored pairs, including pairs the filter currently hides; "seen" does not touch the unread match bell row.
- The match list issues one extra statement to tell "no such want" (404) from "no matches" (200 `[]`).
- Deviations: `WantMatchNotFound` lives in writes.py, not application/errors.py (errors.py was outside the group's file list); `WantMatchMeta.mode` is a plain `str` (no exchange-mode enum on the wants groups ACL); `extend_want` now calls `_start_new_period` (no behaviour change); some fixtures are written straight to the tables (pending `SwapProposal` rows, `WantMatch.score` / `seen_at`, `Want.expires_at`, and the "seeker now owns the item" case by changing `ItemListingPreference.owner_party_id`).
- Not covered by a test: a non-null `thumb_url`, a non-null `reserved_until`, an owner with an Organization slug in `href`.
- "To confirm" texts: "Nie znaleziono dopasowania.", "Nie znaleziono poszukiwania." (both from domain/messages.py, unchanged).

### Standards Reading Log — Group 9
**From Implementation Plan**: backend/api.md, backend/queries.md, backend/security.md, backend/models.md, testing/backend-testing.md; **From INDEX.md**: global/error-handling.md, global/commenting.md, global/minimal-implementation.md; **Discovered During Execution**: backend/time.md (steps 9.5 / 9.6)

## 2026-11-16T08:12:18Z - Group 7 Complete (wave 6) — reverse budget missed, user decision open

**Steps**: 7.1 through 7.7 completed (7.1, 7.2 and the baseline half of 7.3 reused from the interrupted run of 2026-11-15; the 68 saved baseline plans were checked for completeness and not re-run)
**Standards Applied**:
- From plan: backend/queries.md, backend/jooq.md, backend/migrations.md (read for 0100; not needed), global/conventions.md, global/minimal-implementation.md
- From INDEX.md: global/commenting.md, testing/backend-testing.md
- Discovered: none
**Tests**: tests/test_wants_matcher.py 7 passed (after the last matcher change); mypy 15 (baseline 15); ruff 65 (baseline 65). tests/test_wants_migration.py not run (no migration added).
**Files Modified**: implementation/measurement/results.md (created), measurement_db.py, explain_match.py, seed_measurement.py (modified), plans/lever-1 (17), plans/lever-2 (68), plans/index-trial (2) (created); app/wants/application/matcher.py, tests/test_wants_matcher.py (modified)
**Measurement** (details and plans in `implementation/measurement/results.md`):
- Forward budget (300 ms) MET at all four sizes: max 17 ms. At 20,000 items all 15 forward plans use `ix_products_name_trgm` and `ix_products_search_vector` (AC-07).
- Reverse budget (2 s at 500 listings x 10,000 wants) MISSED: 38.3 s baseline, 24.0 s after lever (a), 5.7 s after levers (a) + (b). The seven smaller reverse points are met (max 0.54 s).
- Levers applied: (a) window listings in a materialised CTE, name folded once per listing; (b) offer mode, category and locality compared before the names in the window direction, short words before the similarity. No interval change and no outbox fallback (left for the user).
- Cost after the levers: about 12 ms per new listing at 10,000 wants (1.1 ms at 1,000), linear in window x wants.
- Index decision: no `item_listing_preferences.created_at` index, no revision 0100; head stays `0099_wants`. Evidence: the window scan costs 0.2 to 1.2 ms; a trial index changed nothing measurable and was dropped.
- Thresholds 0.70 / 0.60 remain unmeasured (release gate).
**Notes**:
- `matcher.py`: the category rule is now listing-side ("the want's category is in the listing's category path", an array computed once per listing through a lateral join); the want-driven recursive CTE of group 6 is gone; the reverse direction reads `window_listings`. Public signatures and returned pairs unchanged.
- Deviation from step 7.1: the disposable PostgreSQL is started by `measurement_db.py serve`, not by the seed script; the scripts refuse anything but a loopback database named `wants_measure`.
- The seeded data has no groups, so the PRIVATE-listing group lookup is cheaper than it will be with real memberships. Timings come from a loaded developer machine (runs differed by up to 5%).
- Leftover container `wants-measure-pg` (exited) from the interrupted run was not touched; `measurement/__pycache__/` remains.

### Standards Reading Log — Group 7
**From Implementation Plan**: backend/queries.md, backend/jooq.md, backend/migrations.md, global/conventions.md, global/minimal-implementation.md; **From INDEX.md**: global/commenting.md, testing/backend-testing.md

## 2026-11-16T08:22:40Z - Wave 6 resolved; user decision on the reverse budget

- **Decision (user)**: the missed reverse budget at 500 listings x 10,000 wants (5.7 s against 2 s) is ACCEPTED. The scan stays a 15-minute job, no interval change, no outbox fallback, no further optimisation in this task. Group 18 records it as a known risk in architecture.md (the budget holds up to about 165 listings per window at 10,000 wants, or 500 listings at about 3,500 wants).
- Cross-check after both wave members returned: `uv run python -m pytest tests/test_wants_matcher.py tests/test_wants_matches_api.py tests/test_wants_api.py tests/test_wants_lifecycle.py -q` -> 28 passed (group 9's tests against group 7's changed matcher).
- Wave 7 = group 10.

## 2026-11-16T08:36:34Z - Group 10 Complete (wave 7)

**Steps**: 10.1 through 10.9 completed (red run recorded first: 3 collection errors, module `app.wants.application.scan` missing)
**Standards Applied**:
- From plan: backend/queries.md, backend/jooq.md, backend/time.md, backend/models.md, global/error-handling.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 25 passed (test_wants_scan, test_wants_notifications, test_wants_lifecycle); guards 16 passed; regression 23 passed (test_wants_matcher, test_wants_api, test_wants_matches_api); mypy 15 (baseline 15); ruff 65 (baseline 65)
**Statement count of one run**: 13, with one want / one listing and with five wants / five listings (limit 16).
**Files Modified**: app/wants/application/scan.py, app/wants/application/match_notifications.py, tests/test_wants_scan.py (created); app/main.py, tests/test_wants_notifications.py, tests/test_wants_lifecycle.py (modified). No ACL file, writes.py or matcher.py changed.
**Visual Compliance**: bell-rows.html matched for all three rows (one match naming the item, several with a count, the expiry reminder); each pinned by a test.
**Notes**:
- Names: `scan_wants(db, *, now=None)`, `SCAN_NAME = "wants"`, `MARKER_UNIQUE_CONSTRAINT = "uq_want_scan_markers_scan_name"` in application/scan.py; `ExpiringWant(id, seeker_party_id, name)`, `write_bell_rows(db, *, pairs, expiring, now) -> int` in application/match_notifications.py; `_run_want_scan()` in app/main.py, scheduled every `SCAN_INTERVAL`.
- Order inside one run (one transaction, one commit): expire, remind, purge, marker read (first run: window starts at now - 20 min; otherwise scanned_through - 5 min), reverse match, bell rows and pointer update, log counts, marker write, commit, one log line (INFO when pairs, notifications, expired or purged is non-zero, DEBUG otherwise).
- Job wrapper: catches `StaleDataError` and an `IntegrityError` naming the marker's unique key, rolls back, logs one WARNING; any other exception propagates.
- Deviations: the unread match row is deleted by `delete_unread_notifications` BEFORE the writer (the summed count is part of the row's text), so the writer is called insert-only and `previous_deleted` is unused; reminder rows go through the same writer call; `synchronize_session=False` on the set-based statements; a single new match whose item is no longer listed at lookup time gets no bell row (pair stays stored); the marker race is simulated on one connection.
- Open issues: bell rows take `created_at` from the writer's own `datetime.utcnow()`, not from the run's `now`; a `now` earlier than the stored `scanned_through` is not handled specially; the wrapper recognises the marker key by its name in the driver message; no test for an Organization slug in the single-match link or for the 500-character cap.
- "To confirm" texts: "{n} nowych pasujących rzeczy." for 5+, and the three bell texts as in the mockup.

### Standards Reading Log — Group 10
**From Implementation Plan**: backend/queries.md, backend/jooq.md, backend/time.md, backend/models.md, global/error-handling.md, testing/backend-testing.md; **From INDEX.md**: global/minimal-implementation.md, global/commenting.md

## 2026-11-16T08:42:41Z - Group 18 Complete (wave 8)

**Steps**: 18.1 through 18.6 completed (no unit tests; step 18.6 searches are the check, all as expected)
**Standards Applied**:
- From plan: global/conventions.md, global/commenting.md, backend/migrations.md
- From INDEX.md: backend/time.md, backend/security.md
- Discovered: none
**Tests**: none (documentation). Searches: one `## Wants` section, "0099" on 7 lines, both kind names, "Release gate" twice in architecture.md; no "HuntingCreateView" / "add/hunting" in .maister/docs/; the old guide no longer says "demo"; no secret or connection string in the three files.
**Files Modified**: .maister/docs/project/architecture.md (new section "Wants (app/wants/)" with Tables, Match statement, Scan, Notification rules, Lifecycle, API, Frontend, Known limits; new "Deploy / rollback for wants (migration 0099)"; package tree, guarded-module sentences, page count, the fold_pl bullet), .maister/docs/INDEX.md (architecture entry), .maister/tasks/development/2026-11-12-global-search-group-description/documentation/user-guide.md
**Notes**:
- Written from the code where the work log differed (the category rule is the listing-side path of group 7, not the CTE of group 6).
- Page count: the documents said 61 `page.tsx`, HEAD has 60 and the working tree 62; 62 was written.
- Added beyond the steps: `wants.short_words_query` is built with `fold_pl` but not generated, so a `fold_pl` change must recompute it too; after downtime the first scan run covers everything since the stored marker in one run (no statement timeout).
- Observations for verification: the read-time filter (`items_visible_to(seeker, ALL)`, with the counterparty branch) is wider than the match statement's visibility rule (two definitions, harmless); `matched_item_id` checks stored pairs only, so the closing prompt can name a want whose match the list hides; `CLOSE_OUTCOMES` in the domain is still unused.
- Not done, outside the group's files: standards/backend/time.md (and its INDEX summary) lists the clock-guarded packages without app/search and app/wants; the screenshot 12-lista-szukam-wypelniona.png in the old guide still shows the mock form (user-documentation phase).

### Standards Reading Log — Group 18
**From Implementation Plan**: global/conventions.md, global/commenting.md, backend/migrations.md; **From INDEX.md**: backend/time.md, backend/security.md

## 2026-11-16T09:21:59Z - Group 19 Complete (wave 9)

**Steps**: 19.1 through 19.6 completed
**Standards Applied**: From plan: testing/backend-testing.md, testing/frontend-testing.md; From INDEX.md: global/minimal-implementation.md; Discovered: none
**Tests added (6)**: backend test_listMatches_organizationsItemWithPhotoReservedForAnEvent_slugHrefThumbAndReservedUntil, test_scanWants_singleMatchOfAnOrganizationsItem_bellRowLinksToTheSlugPage, test_writeBellRows_singleMatchWhoseItemIsGone_noRowForIt_otherWantPointsAtItsOwnRow, test_matchNewListings_ownHiddenOrNotTakeableItemAndInactiveWant_noPair; frontend WantMatchesView: thumbnail + slug href card, failed "Znalezione — zamknij" inline alert. The new tests cover code that already worked, so no red run.
**Feature tests**: backend 239 passed; frontend 28 files 408 passed / 16 failed (all baseline ids)
**Full checks vs baseline** (details in implementation/baseline/final-comparison.md): pytest 2 failed / 1469 passed (same 2 ids, 26 min 9 s); mypy 15 (same lines); ruff 65 (same lines); Vitest 33 failed / 1818 passed (same 33 ids); typecheck 0; lint 10 / 28 (same file + rule set, one warning shifted 95 -> 98 in CategoryTreePicker.tsx). No new failure; no baseline id fixed or removed.
**Files Modified**: tests/test_wants_matches_api.py, tests/test_wants_scan.py, tests/test_wants_matcher.py, src/frontend/src/test/WantMatchesView.test.tsx, implementation/baseline/final-comparison.md (created)
**Notes**: 500-character cap untested (unreachable: 80 + 255 characters max); test_writeBellRows_... stands in for "no longer listed" with a random item id rather than delisting a real item.

### Standards Reading Log — Group 19
**From Implementation Plan**: testing/backend-testing.md, testing/frontend-testing.md; **From INDEX.md**: global/minimal-implementation.md

## 2026-11-16T09:21:59Z - Implementation Complete

**Total Steps**: 139 completed (19 task groups, 9 waves over 2026-11-15 and 2026-11-16)
**Test Suite**: full run by group 19 — failing set identical to the baseline in all six checks (backend 2 / 1469 passed, Vitest 33 / 1818 passed, mypy 15, ruff 65, typecheck 0, lint 10 + 28). The suite does not "pass": the baseline failures remain, none is new.
**User decision during implementation**: the reverse-scan budget miss at 500 listings x 10,000 wants (5.7 s against 2 s) accepted as a known risk.
**Open items for verification**: cap-link keyed on the message text (WantFormView); bell created_at from the writer's clock; now earlier than the marker not handled; marker conflict recognised by constraint name; two visibility definitions (read filter vs match); unused CLOSE_OUTCOMES; standards/backend/time.md lists the clock-guarded packages without app/search and app/wants; many "to confirm" Polish texts.

## 2026-11-16T10:19:05Z - Verification fixes (Phase 11, cycle 1)

**User choice**: fix all fixable issues; W10 (sweep locks during the match, unbounded window after downtime) and W11 (no per-user rate limit) stay recorded risks; auto-extension on the match page (FR-L-02) and the /add tile target (FR-F-40) stay as specified.
**Backend** (222 passed in the wants, notifications and guard files; mypy 15; ruff 65): W1 the scan reads, locks (one statement, id order) and points only ACTIVE wants, new test; W4 `replace_unread_notifications` / `WrittenNotification` / `previous_id` replaced by `create_notifications(db, entries) -> list[UUID]`; W5 runbook verify step checks `want_scan_markers.scanned_through`; W6 runbook rollback order stop -> DELETE -> start old image; W7 `downgrade()` deletes WANT_* notification rows, round-trip test asserts it; W8 `_run_want_scan` logs other failures with `logger.exception`; WantMatchNotFound moved to errors.py; CLOSE_OUTCOMES and WantMatchResponse.subtitle removed; resume_want calls _start_new_period.
**Frontend** (full Vitest 33 failed / 1824 passed, same baseline count; typecheck 0; lint 10 + 28): W2 `WantWriteError` keeps the HTTP status, the cap link shows on a create 409; W3 new `hooks/useWantsMatchingItem.ts` replaces useState + useEffect in ItemPickupActions, `findMatching` removed; subtitle removed from the card type; shared `agoLabel` gives "dzisiaj" on both views; FOCUS_CLASS reused.
**Changed assertion to review**: ItemDetailPage "personal take of a matched item" expected one `getMyWants` call; it now expects exactly two (the close sheet's `invalidateQueries([WANTS_KEY])` refetches the matching query) and that the prompt does not reopen.
**Standards**: W9 standards/backend/time.md and INDEX.md now list the six clock-guarded packages (via /maister:standards-update).

## 2026-11-16T12:54:21Z - Verification fixes (Phase 11, cycle 2)

**User choice**: fix all remaining small items.
**Backend + docs** (66 passed in the wants, guard and stale-data-handler files; mypy 15; ruff 65): architecture.md Wants section aligned with the code (no `subtitle`, `useWantsMatchingItem`, cap link on 409, scan failure logging); runbook: `alembic downgrade 0098` from the new image; TERYT refresh note for `wants.locality_id` RESTRICT; 40P01 / 40001 raised as `StaleDataError` in want writes (shared 409 text, now also around extend / close / seen) and treated as a lost race in `_run_want_scan`; one log line per scan failure, no re-raise; docstrings of category_acl.py and notifications/service.py; implementation note after FR-F-04 in spec.md.
**Frontend** (full Vitest 1833 passed / 33 failed, identical baseline ids; typecheck 0; lint 10 + 28): Polish `WANT_NETWORK_ERROR_MESSAGE` for a write with no response (to confirm: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie."); CloseWantSheet comment; second-take prompt test; AccountView shows no meta on a wants load error; prefilled locality fallback in create mode; category prefill UUID check (prefill test fixtures switched to UUIDs); `ItemCard` optional `onOpen` (click + middle-click) used by MatchCard.
**Note**: a deadlock on create now also answers 409, so the cap link can show beside the "try again" text in that rare case (documented). The full backend suite was not re-run after cycle 2.

## E2E (Phase 12) and its fixes

**E2E result**: 13 of 14 journeys passed in the live app (two fresh test accounts, 390 px); 0 critical, 1 major, 1 minor, 3 cosmetic; visual fidelity 8 match / 3 minor / 0 drift (`verification/e2e-verification-report.md`, `verification/visual-fidelity.md`). E2E moved `expires_at` of two test wants in the local database to show the expired state and the reminder.
**User choice**: fix all.
- **Major-1** (guest stuck on `/login?returnTo=…` after login or registration from the empty-search prompt): Next's client route cache kept the proxy's 307 for the protected URL, and `router.replace` committed the cached redirect. Fix: `routing/documentNavigation.ts` `replaceDocument`, a `reload` prop on the facade's `Navigate`, used by `AuthGuard` on `/login` (every login / registration now ends with a full page load, like logout). Tests in `AuthGuard.test.tsx` and `auth.test.tsx`; browser re-check of login and registration.
- **Minor-1** (SAWarning cartesian product on every scan): the recursive CTE member used a comma FROM + WHERE; now `join_from(parent, path, ...)`. Compiled SQL differs in that one line; plans and timings unchanged on the measurement database (reverse-500 6.0 s before / 5.6 s after on the same seed); guard test compiles both directions with SAWarning as error. Plans in `implementation/measurement/plans/cartesian-before|cartesian-fix/`.
- **Cosmetic-1** (404s after withdraw): the WITHDRAWN close leaves that want's queries out of the invalidation.
- **Cosmetic-2**: `LocalityCombobox` optional `labelClassName`; `RadiusChips` tighter chip class (also slightly tighter in the search filter sheet).
- **Cosmetic-3**: the "Zarezerwowano!" toast is hidden while the closing prompt is open.
**Checks**: backend 50 passed with `-W error::sqlalchemy.exc.SAWarning`; mypy 15; ruff 65; full Vitest 1834 passed / 33 failed (identical baseline ids); typecheck 0; lint 10 + 28. Local backend restarted on the current code afterwards.
**Standards suggested** (not applied): recursive CTE members built with `join_from(...)`; after a session change leave the client router with a full page load, and guest links to protected URLs point at `authPath(...)`.

## 2026-11-16T17:31:07Z - Workflow finalized (Phase 14)

**Phases**: 1, 2, 4-8, 10-14 completed; 3 and 9 skipped (no reproducible defect).
**Final full checks**: backend pytest 2 failed / 1472 passed (the 2 baseline ids, 20 min 48 s, run after all fixes); Vitest 1834 passed / 33 failed (identical baseline ids, after the E2E fixes); mypy 15; ruff 65; typecheck 0; lint 10 + 28 — no new failure in any check.
**Verification**: passed with issues after two fix cycles — 0 critical code defects, 0 open code warnings; production NO-GO only on the release gate (labelled Polish sample, follow-up task).
**E2E**: 13/14 journeys passed; all 5 defects fixed afterwards and re-checked in the browser.
**User guide**: documentation/user-guide.md (Polish, 25 screenshots).
**Standards added (user-approved)**: backend/queries.md recursive CTE members with join_from; frontend/components.md full page load after a session change; global/error-handling.md 40P01 / 40001 as retryable conflicts; testing/backend-testing.md importing helpers between test modules; earlier backend/time.md guarded-package list.
**Deviation recorded**: the empty match list shows "Znalezione — zamknij", "Przedłuż", "Wycofaj" and the extend button reads "Przedłuż" (spec: "Znalezione", "Przedłuż o 90 dni"); the guide follows the UI; left for a product decision.
**Left in the local dev DB**: test accounts (e2e-seeker/owner/fix/docs-*@example.test) and their wants and items. **Nothing committed.**
