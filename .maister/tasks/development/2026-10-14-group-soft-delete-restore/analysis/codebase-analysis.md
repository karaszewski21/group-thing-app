# Codebase Analysis Report

**Date**: 2026-10-14
**Task**: Soft delete of a Group (Circle) with admin restore
**Description**: Add `Group.deleted_at` + Alembic migration; `DELETE /api/groups/{id}` for the active organizer (does NOT end the Leadership); a deleted group behaves as nonexistent everywhere; admin `AdminGroupsPage` lists deleted groups with a Restore action (`POST /api/groups/{id}/restore`, ADMIN); the panel trash icon opens a confirm dialog. Current bug: panel trash (`SpotkaniaView.tsx` ~181 → `PanelDataContext.tsx:609 handleRemoveGroup`) calls `POST /api/leaderships/{id}/end` without confirmation, orphaning the group.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery + Code Analysis, Context Discovery, Pattern Mining)

---

## Summary

The write side is small and has clear templates: one nullable column (copying `NeededItem.deleted_at`), migration `0056`, a `soft_delete_group` / `restore_group` pair, two routes and two authorization-matrix rows. The hard part is the read side. Nothing filters groups centrally. `get_group` is a plain `db.get`, and about 10 repository queries plus several routes reach groups without going through it. Leadership stays active on delete, so the leadership- and membership-based reads (`/api/people/{id}/leaderships`, `/api/families/{id}/memberships`) are critical. If they are not filtered, the panel's `Promise.all(getGroup)` returns 404 and the whole panel fails to load, and `POST /api/groups/mine` also breaks. One more catch: making `get_term` aware of deleted groups must not block confirming or cancelling transactions that already hold reservations.

---

## Files Identified

### Primary Files

**src/backend/app/groups/models.py** (410 lines)
- The `Group` entity (UUID PK, `BaseEntity`, so `updated_at` is the `version_id_col`). The new `deleted_at` column goes here.
- FK-id links to groups: `Leadership.to_group_id` (151), `Membership.to_group_id` (174), `GroupJoinRequest.group_id` (195), `Term.circle_group_id` (223). There are no `relationship()`s.
- Soft-delete column template: `NeededItem.deleted_at` (255), `TermAttendance.withdrawn_at` (314).

**src/backend/app/groups/infrastructure/repository.py** (947 lines)
- `get_group` (67) = `db.get(Group, id)`, which is the main choke point.
- Queries not covered by `get_group` (each needs its own predicate): `list_groups` (62), `count_groups` (80), `list_groups_for_moderation` (84), `list_active_leaderships_for_role_ids` (192, CRITICAL), `list_active_memberships_for_role_ids` (235, CRITICAL), `get_term` (249), `count_terms` (260), `list_terms_for_moderation` (264), `list_my_pledges_joined` (351), `list_my_attendances_joined` (421), `list_pending_join_requests_for_groups` (649), `_qualifying_owner_circles` (674, one predicate covers the whole public organizer directory).
- Existing `deleted_at.is_(None)` filter precedents: 285, 313, 344, 368, 864.

**src/backend/app/groups/application/circles.py** (264 lines)
- `get_group` wrapper (143, raises `EntityNotFoundException`), `get_own_circle` (56), `update_group` (167), `assign_leadership` (193), `remove_leadership` (209), `list_active_leaderships_for_party` (246), `_is_active_organizer` / `_require_active_organizer` (254-264).
- Home for the new `soft_delete_group` / `restore_group` and the `find_group_including_deleted` escape hatch.

**src/backend/app/groups/router/circles.py** (345 lines)
- Principal aliases (54-56: `ReadPrincipal`, `EditPrincipal`, `ModerationPrincipal = require_any("ADMIN")`), moderation list (254-263), PATCH `update_group` (266-276, the template for DELETE), GET `/{group_id}` (279), and the unguarded GET `/{id}/leadership`, `/leaderships`, `/memberships` (319/330/339).

**src/backend/app/core/authorization_matrix.py** (263 lines)
- `_RAW_MATRIX` (37), first match wins. Group rows: PATCH `^/api/groups/[^/]+$` EDIT (122), GET moderation ADMIN (126), blanket GET READ (132), blanket POST EDIT (133), catch-all AUTHENTICATED (242). Today DELETE falls through to AUTHENTICATED and POST restore would resolve to EDIT.

**src/backend/app/groups/application/terms.py** (265 lines)
- `get_term` (47), `list_terms` / `list_terms_with_counts` (54/58, no group guard), `update_term` (103), needed-item create/update/delete (144/202/222), `get_needed_item` (160-168), `get_needed_item_view` (171/173), `list_needed_item_views` (180). `soft_delete_needed_item` (222-265) is the best service template for this task.

**src/backend/app/groups/application/term_item_listings.py** (1033 lines)
- take (531, uses `get_group`) and accept swap (738). `_resolve_transaction_reservations_for_action` (962, uses `get_term`) handles confirm/cancel and **must keep working** for terms of a deleted group.

**src/frontend/src/pages/panel/PanelDataContext.tsx** (1213 lines)
- Bug site: `handleRemoveGroup` (609-622) → `endLeadership` → toast "Usunięto grupę" → `load()`. `load()`: `getLeadershipsForPerson` (356/357), filters `valid_to` null (404/405), `Promise.all(getGroup)` (442); guest branch `getMembershipsForFamily` → `Promise.all(getGroup)` (448-450); per-group `getTerms` / `getNeededItems` (459). `myLeaderships` state (176), export (1185).

**src/frontend/src/pages/panel/views/SpotkaniaView.tsx** (286 lines)
- The trash button (178-184) calls `handleRemoveGroup` directly, with no confirmation.

**src/frontend/src/pages/AdminGroupsPage.tsx** (71 lines)
- Read-only Chakra `AdminTable` (Name/Organizer/Members/Terms/Created), `EmptyState`, `Pagination`. Needs an active/deleted filter and a Restore action.

**src/frontend/src/hooks/useModerationGroups.ts** (38 lines)
- Key `["moderationGroups", page]` → `getGroupsForModeration`. It has no mutations yet.

**src/frontend/src/api/groups.ts** (606 lines)
- `ModerationGroupResponse` (36), `getGroupsForModeration` (78), `getGroup` (82), `endLeadership` (138). Needs `deleteGroup`, `restoreGroup` and a deleted-list parameter.

**src/backend/alembic/versions/** (new `0056_group_soft_delete.py`)
- Head is `0055_organization_description.py`. Templates: `0029_term_attendance_withdrawn_at.py`, `0017_needed_item_inventory_item_soft_delete.py`.

### Related Files

**src/backend/app/groups/service.py** (171 lines). Facade re-exports (imports ~20-34/~96, `__all__` ~132/~162). The new functions must be exported here.

**src/backend/app/groups/schemas.py** (814 lines). `GroupResponse` (31), `ModerationGroupResponse` (44-56). Optionally add `deleted_at` for the admin deleted list.

**src/backend/app/groups/application/public_view.py** (510 lines). `get_public_circle_view` (211) and `create_rsvp` (423) are already covered by `get_group`. OG previews in `app/system/router.py:92/107` already catch `EntityNotFound`.

**src/backend/app/groups/application/memberships.py** (234 lines). `end_membership` (42), `list_term_attendees_for_formalization` (128), formalize (187), membership listing (211) → `families/repository.py:86`.

**src/backend/app/groups/application/join_requests.py**. Covered at 72/174/277. `_requester_link_path` (45-49) builds notification links.

**src/backend/app/groups/application/exchange_summary.py**. Covered (205/237). Has its own `deleted_at` filter precedent (165).

**src/backend/app/groups/application/pledges.py**. `create_pledge` (65, only `get_needed_item`), `list_pledges` / `get_pledge` (97). Low priority.

**src/backend/app/groups/application/term_end_scan.py** (245 lines). Scheduler `_find_terms_just_ended` (64), `list_group_names` (207). Product decision needed.

**src/backend/app/circulation/infrastructure/repository.py**. `find_reservation_term` (454), Core `_groups` table (62-66) → `item_details.py:75` group-name history. Probably leave as is.

**src/backend/app/users/router.py** (138 lines). `/api/people/{id}/leaderships` (131-138), used by the panel and `OnboardingPage.tsx:33`.

**src/backend/app/groups/router/__init__.py**. Router assembly (26-34). Order is load-bearing: `organizer_page` comes before `circles`.

**src/backend/app/moderation/router.py**. ADMIN mutation template (`AdminPrincipal`, POST `/decisions` 204, DELETE `/photos/{id}` 204).

**src/backend/app/groups/router/terms.py**. DELETE-204 route template (130-133).

**src/backend/app/groups/infrastructure/notifications_bridge.py**. In-app notifications store `link_path` strings. Stale links will simply 404, so no change is needed.

**src/frontend/src/components/shared/ConfirmDialog.tsx** (91 lines). Chakra alertdialog (portalled). Used by the admin side (Category/Product list pages, `PhotoModerationCard.tsx:118`). Does NOT call `useRegisterOpenSheet` (a standards gap).

**src/frontend/src/pages/organizer/editor/UnsavedChangesDialog.tsx** (71 lines). Tailwind `role=alertdialog` `aria-modal` with `useRegisterOpenSheet(true)`, initial focus on the safe button, Esc to cancel, Tab cycling, Polish copy. Template for the panel's delete confirmation.

**src/frontend/src/pages/panel/PanelModals.tsx** (edit sheet "edit-grupa", ~200+) and **panelComponents.tsx** (`ModalSheet` 167). These are alternative places to put the delete action.

**src/frontend/src/hooks/useModerationPhotos.ts**, **pages/PhotoModerationPage.tsx**, **components/.../PhotoModerationCard.tsx**. Templates for the mutation hook, the filter toggle (`aria-pressed`, `role=group`, page reset) and per-row busy/error handling.

---

## Current Functionality

### Delete today (bug)
`SpotkaniaView` trash → `handleRemoveGroup(groupId)` finds the caller's leadership by `to_group_id` → `POST /api/leaderships/{id}/end` → toast → `load()`. The group stays live, public and joinable, with no organizer (an orphan). Nothing asks for confirmation. On top of that, `remove_leadership` (circles.py:209) and `assign_leadership` have **no ownership check**: any EDIT user can end anyone's leadership. This security issue already exists and is outside this task's scope, but it should be flagged.

### Key Components/Functions

- **repository.get_group / circles.get_group**: the single-entity lookup. Making it return 404 for deleted groups covers most mutations and the public view: `get_own_circle`, `update_group`, `assign_leadership`, GET `/api/groups/{id}`, join requests, formalize, exchange summary, the public view and `/access`, OG previews, `create_rsvp`, `create_term`, take, and accept swap.
- **_is_active_organizer / _require_active_organizer**: stay true after delete because Leadership is not ended. Every leadership-driven path therefore has to filter on the group itself.
- **soft_delete_needed_item**: the template. It sets `deleted_at = datetime.utcnow()`, has side effects, raises a Polish `BusinessConflictException` 409 on guards, and commits once.
- **find_item_including_deleted** (inventory_items.py:94): the escape-hatch pattern for restore.

### Data Flow

Organizer panel: `getLeadershipsForPerson` → `/api/people/{id}/leaderships` → `list_active_leaderships_for_party` → `repository.list_active_leaderships_for_role_ids` (no group join). Then the frontend fetches each group with `getGroup`. Once the group is soft-deleted, the leadership is still returned and `getGroup` returns 404, so `Promise.all` rejects and the panel load fails. Guest panel: `/api/families/{id}/memberships` → `list_active_memberships_for_role_ids`, which fails the same way. Server side, `get_own_circle` takes `leaderships[0]` → `get_group` → 404, which breaks `POST /api/groups/mine`. **Both role-id queries must join to groups and filter `deleted_at IS NULL`.**

### Read paths needing their own predicate or guard (consolidated)

| # | Location | Endpoint / consumer | Action |
|---|----------|---------------------|--------|
| 1 | repository.py:62 `list_groups` | GET /api/groups | `.where(deleted_at.is_(None))` |
| 2 | repository.py:80/84 `count_groups`, `list_groups_for_moderation` | GET /api/groups/moderation | filter, plus an inverse "deleted" mode with consistent counts |
| 3 | repository.py:260/264 `count_terms`, `list_terms_for_moderation` | AdminTerms | join groups and filter |
| 4 | repository.py:421 `list_my_attendances_joined` | GET /api/groups/mine/attendances | filter (Group already joined) |
| 5 | repository.py:351 `list_my_pledges_joined` | GET /api/pledges/mine | join and filter |
| 6 | repository.py:192 `list_active_leaderships_for_role_ids` | /api/people/{id}/leaderships, get_own_circle, pending join requests | **CRITICAL**: join and filter |
| 7 | repository.py:235 `list_active_memberships_for_role_ids` | /api/families/{id}/memberships | **CRITICAL**: join and filter |
| 8 | repository.py:674 `_qualifying_owner_circles` | public organizer directory + terms | one predicate covers all downstream queries |
| 9 | repository.py:649 `list_pending_join_requests_for_groups` | join-request inbox | filter (insurance) |
| 10 | terms.py:54/58 `list_terms*` | GET /api/terms?circle_group_id= | `get_group` guard |
| 11 | terms.py:47 / repository.py:249 `get_term` | GET /api/terms/{id}, listings, fulfill_pledge | make it group-aware, plus `get_term_any` for confirm/cancel |
| 12 | terms.py:171/180 needed-item views | GET /api/needed-items | follows from 11 |
| 13 | pledges.py:97 | list/get pledge | low value |
| 14 | router/circles.py:319/330/339 | GET /{id}/leadership(s), /memberships | `get_group` guard |
| 15 | memberships.py:128 | formalization attendees | follows from 11 |
| 16 | term_end_scan.py:64/207 | scheduler | product decision. Recommend continuing to process, because the reservations are real |
| 17 | circulation repo:454 | item details history | leave (historic) |
| 18 | slug_resolver, notification links | n/a | harmless |

### Mutations not blocked by `get_group`
`update_term`, needed-item create/update/delete, `create_pledge`, `fulfill_pledge`, listing take/propose/accept (via `get_term`), `remove_leadership`, `end_membership`. A group-aware `get_term` blocks most of these. Fine to keep allowing: withdraw join request / pledge / attendance, reject swap. **Must not block**: confirm/cancel transaction (`term_item_listings.py:962`), otherwise LEND/GIFT/SWAP reservations that are already locked would be stuck.

---

## Dependencies

### Imports (What This Depends On)

- SQLAlchemy 2.0 async ORM (`Mapped`, `mapped_column(DateTime(), nullable=True)`), `BaseEntity` (`app/core/base_model.py:58-68`, where the `updated_at` version column bumps on update)
- `app.core.exceptions` (`EntityNotFoundException`, `BusinessConflictException`)
- `app.core.security` `require_any`, `get_profile_by_principal`
- Alembic `op.add_column` / `op.drop_column`
- Frontend: TanStack Query v5, Chakra (admin), Tailwind (panel), `useRegisterOpenSheet`, `extractProblemMessage`

### Consumers (What Depends On This)

- **Group reads**: about 20 backend call sites through `get_group`, about 12 repository queries that bypass it, 3 unguarded routes, the scheduler, and circulation history
- **Frontend**: PanelDataContext (organizer + guest load), OnboardingPage (`getLeadershipsForPerson`), AdminGroupsPage, AdminTerms, the public circle/organizer pages, my attendances/pledges

**Consumer Count**: about 30 call sites across about 12 backend files and about 6 frontend files
**Impact Scope**: High. The "behaves as nonexistent everywhere" requirement touches every group-reaching read path, while the write changes stay local.

---

## Test Coverage

### Test Files

- **tests/test_groups.py** (762 lines): helpers `_register_organizer` (28), `_register_guest` (37), `_auth_headers` (47), `_create_circle_with_term` (51); PATCH rename (293), unknown id 404 (754); needed-item soft-delete tests (~200-290, 217/411/577 non-organizer 403, 594 second delete 404); tests that set `row.deleted_at` directly at 439/623 (pattern for testing read filters)
- **tests/test_groups_moderation.py** (182 lines): `_authed_headers` (25), `_grant_admin_and_relogin` (34), non-admin 403 (56), admin list (64), leaderless (155)
- **tests/test_authorization_matrix.py** (167 lines): PATCH group → EDIT (34), regression guards 59/75/150 (GET by id stays row-26 READ)
- **Migration tests** via alembic subprocess: `test_organization_page_layout_migration.py:23`, `test_terms_circle_occurs_on_index_migration.py`
- **Group read-path suites to extend**: test_public_preview.py, test_group_access.py, test_circles_router.py, test_organizer_page.py, test_my_attendances.py, test_group_privacy.py, test_private_group_access_defects.py
- **Frontend**: `test/AdminGroupsPage.test.tsx` (92 lines, 4 tests, mocks only `getGroupsForModeration`, uses `createQueryWrapper` and `pageOf`), `test/PanelPage.test.tsx` (mocks `../api/groups` 68-82 including `endLeadership`; `getLeadershipsForPerson` mocks 373/499/748/1457), `test/ConfirmDialog.test.tsx`
- **Fixtures**: conftest.py `engine` (73, testcontainers PG), `db_session` (99), `freeze_local_now` (118), `fake_storage` (130), `client` (135)

### Coverage Assessment

- **Test count**: strong backend integration infrastructure and helper reuse; about 7 group read-path suites to extend
- **Gaps**: no test covers `/api/leaderships/.../end`; no test clicks the panel's "Usuń grupę"; no test checks group-level filtering in the leadership/membership listings; no restore endpoint exists to copy tests from

---

## Coding Patterns

### Naming Conventions

- **Backend functions**: `soft_delete_<entity>`, `find_<entity>_including_deleted`, `list_*_for_moderation`
- **Tests**: `test_<action>_<condition>_<expected>` (e.g. `test_patchGroup_activeOrganizer_renamesInPlace`)
- **Migrations**: `NNNN_snake_case.py`, `revision = "0056"`, `down_revision = "0055"`
- **Frontend**: hooks `useX` in `src/hooks/`, API in `src/api/*.ts`, query-key prefix constant

### Architecture Patterns

- **Style**: layered `application/` (use cases) + `infrastructure/repository.py` + `router/`, behind a `service.py` facade; explicit per-query soft-delete predicates (no global filter); 204 for DELETE/POST mutations
- **Authorization**: `Depends(require_any(...))` per route, mirrored in `AUTHORIZATION_MATRIX` (first match wins) and verified by matrix tests; ownership checks live in the service
- **Timestamps**: `datetime.utcnow()` naive UTC for audit columns (time.md); the domain-clock guard allows this in `app/groups/application`
- **State Management (frontend)**: TanStack Query; mutations catch the error, rethrow `new Error(extractProblemMessage(err))`, then `await invalidateQueries([PREFIX])`; the panel uses PanelDataContext with `load()` re-fetch
- **Dialogs**: admin uses Chakra `ConfirmDialog` (keeps the dialog open with `error` on failure); the organizer panel uses Tailwind in-place alertdialogs with `useRegisterOpenSheet(true)`

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | repository.py 947, PanelDataContext 1213, term_item_listings 1033 | High |
| Dependencies | ~8 imports per touched module | Medium |
| Consumers | ~30 call sites / ~18 files | High |
| Test Coverage | strong infra, gaps on leadership/panel delete | Medium |

### Overall: Moderate (leaning Complex in breadth)

The write path is simple: 1 column, 1 migration, 2 service functions, 2 routes and 2 matrix rows. The complexity comes from coverage breadth: about 12 repository predicates plus about 5 guards, the `get_term` design decision with its confirm/cancel exception, and frontend work in two UI systems (Chakra admin, Tailwind panel).

---

## Key Findings

### Strengths
- Mature soft-delete precedents (`NeededItem`, `InventoryItem`) with matching tests and an escape-hatch getter pattern
- `get_group` already covers most single-entity reads and mutations; the public view and OG previews already handle `EntityNotFound`
- ADMIN mutation templates (`moderation/router.py`) and frontend moderation templates (photos) map directly onto restore
- A Tailwind confirm-dialog template (`UnsavedChangesDialog`) already meets the accessibility standard

### Concerns
- **Leadership/membership listings ignore group state.** Without filters, deleting a group breaks the organizer panel, the guest panel and `POST /api/groups/mine`.
- **`get_term` is a broad choke point.** Making it group-aware blocks term mutations, but transaction confirm/cancel must use a variant that ignores deleted groups.
- No central filter, so new queries can silently leak deleted groups (regression risk). Tests per read path are needed.
- `remove_leadership` / `assign_leadership` have no ownership check (pre-existing security gap, out of scope, should be flagged).
- Chakra `ConfirmDialog` does not register `useRegisterOpenSheet` (standards gap, affects the admin side if reused for restore).
- `models.md` standard is stale: it says "soft delete not currently used" and "Sequence PK", but `BaseEntity` uses a UUID PK.
- Setting `deleted_at` bumps `updated_at` (optimistic lock). Concurrent PATCH plus DELETE may raise a stale-data error, which is acceptable.
- Idempotency is undefined: deleting an already-deleted group gives 404 (via `get_group`); restoring a live group should return 409 (recommended) or a no-op 204.
- Scheduler behavior for deleted groups' terms is a product decision.

### Opportunities
- Add `find_group_including_deleted` plus one reusable predicate helper (e.g. `_live_group_ids` subquery / `Group.deleted_at.is_(None)` join) and reuse it across queries
- Extend `ModerationGroupResponse` with `deleted_at` and add a `deleted` query flag on the existing moderation list. This avoids a new literal route and the route-ordering risk.
- Fix the panel's `Promise.all` brittleness (`allSettled`) as defense in depth

---

## Impact Assessment

- **Primary changes**: models.py, new alembic `0056_group_soft_delete.py`, infrastructure/repository.py, application/circles.py, application/terms.py (`get_term` variants), application/term_item_listings.py (confirm/cancel uses the include-deleted getter), router/circles.py, service.py, schemas.py, core/authorization_matrix.py; frontend api/groups.ts, hooks/useModerationGroups.ts, pages/AdminGroupsPage.tsx, pages/panel/PanelDataContext.tsx, pages/panel/views/SpotkaniaView.tsx, a new panel confirm dialog
- **Related changes**: memberships.py, pledges.py, term_end_scan.py (decision), users/router.py and families/repository.py (via the repository filters), docs `standards/backend/models.md`
- **Test updates**: test_groups.py (delete 204, non-organizer 403, second delete 404, leadership preserved, reads 404), test_groups_moderation.py (deleted list, restore ADMIN 204, non-admin 403, restore live 409), test_authorization_matrix.py (DELETE → EDIT, restore → ADMIN, regression guards), a migration test, read-path tests (leaderships/memberships listing, public organizer directory, attendances, pledges, terms list), and a confirm/cancel-on-deleted-group test; frontend AdminGroupsPage.test.tsx (filter + restore) and PanelPage.test.tsx (trash opens dialog, confirm calls `deleteGroup` and not `endLeadership`, cancel does nothing)

### Risk Level: Medium-High

Each change is low-risk on its own, but a single missed read path makes a deleted group visible again or crashes the panel. The confirm/cancel exception protects money-like state (reservations). The cross-cutting areas (auth matrix, public pages, scheduler) raise the risk further.

---

## Recommendations

**Modifying existing code plus a defect fix (bug in the panel trash):**

1. **Root cause of the bug**: the UI conflates "remove group" with "end leadership" and has no confirmation step. Fix: the trash opens a Tailwind alertdialog (copy `UnsavedChangesDialog`: `role=alertdialog`, `aria-modal`, `useRegisterOpenSheet(true)`, initial focus on Cancel, Esc, focus trap, Polish copy). On confirm it calls the new `deleteGroup(id)` (`api.delete`) non-optimistically with busy/error state (like `EditTermDialog`), then shows the toast and runs `load()`. `handleRemoveGroup` must stop calling `endLeadership`.
2. **Model + migration**: `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)`; `0056` `op.add_column("groups", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))` with a downgrade that drops it. No `deleted_by` (no precedent; minimal implementation). An index is optional, since most reads are by PK.
3. **Getter layer**: `repository.get_group` returns None when `deleted_at` is set, and a new `find_group_including_deleted` is used only by restore. Split terms the same way: a group-aware `get_term` and a `get_term_including_deleted_group` used by `_resolve_transaction_reservations_for_action` (confirm/cancel) and, by product decision, by the scheduler.
4. **Repository predicates**: apply `Group.deleted_at.is_(None)` (join where needed) to rows 1-9 of the table above. Do the CRITICAL #6 and #7 first. Add `get_group` guards to `list_terms*` and the three router GETs (#14).
5. **Use cases**: `soft_delete_group(db, group_id, party_id)`: `get_group` (404) → `_require_active_organizer` (403) → `deleted_at = datetime.utcnow()` → single commit; Leadership stays as is. `restore_group(db, group_id)`: `find_group_including_deleted` (404) → if not deleted raise `BusinessConflictException` 409 (Polish) → `deleted_at = None` → commit. Export both from `service.py`.
6. **Routes + matrix**: `DELETE /api/groups/{group_id}` (`EditPrincipal`, 204, `get_profile_by_principal`); `POST /api/groups/{group_id}/restore` (`ModerationPrincipal`, 204). Moderation list gets a `deleted: bool = False` query parameter instead of a new literal route. Matrix: widen row 122 to `_methods("PATCH","DELETE")` (precedent: families 147, needed-items 161, inventory-items 172); insert `POST ^/api/groups/[^/]+/restore$` ADMIN after 126 and before 132. Add matrix tests and keep the regression guards green.
7. **Admin frontend**: `restoreGroup` + deleted-list parameter in api/groups.ts; `useModerationGroups(page, deleted)` with a key `["moderationGroups", deleted, page]` and a `restore` mutation (template `useModerationPhotos`, `await invalidateQueries(["moderationGroups"])`); AdminGroupsPage with an Active/Deleted toggle (`aria-pressed`, `role=group`, page reset) and a deleted-at column + Restore button with per-row busy/error (`role=alert`). A confirm before restore is optional. If Chakra `ConfirmDialog` is used, note the missing `useRegisterOpenSheet` gap.
8. **Out of scope, but report**: the missing ownership check in `remove_leadership` / `assign_leadership`; the stale `models.md` (suggest a standards update: "soft-delete via nullable `deleted_at`, getter 404 + `find_*_including_deleted`, explicit per-query predicate").

**Decisions for gap analysis / the user**: (a) scheduler behavior for terms of deleted groups (recommend: keep processing); (b) restore of a live group: 409 vs no-op; (c) whether to show deleted groups to the organizer at all (recommend no, they are nonexistent); (d) whether withdraw actions stay allowed (recommend yes); (e) restore confirmation dialog on admin (optional).

---

## Next Steps

Invoke gap-analyzer with this report. Focus on: confirming the "nonexistent everywhere" scope against the 18-row read-path table, the `get_term` split with the confirm/cancel exception, the scheduler decision, restore idempotency semantics, and the panel UX (confirm dialog placement: trash in SpotkaniaView vs the edit-grupa sheet).
