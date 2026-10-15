# Specification: Group (Circle) Soft Delete with Admin Restore

## Goal
Replace the panel trash action, which today silently ends the organizer's Leadership and leaves a public, joinable, leaderless group, with a confirmed **soft delete** of the Group. A deleted Group behaves as nonexistent everywhere except for a few explicitly listed keep-live paths, and an ADMIN can restore it. Close the two Leadership ownership holes (`POST /api/leaderships`, `POST /api/leaderships/{id}/end`) that would otherwise let any user take over a group and then delete it.

## User Stories
- As an **organizer**, I want the trash icon on my group tile to ask for confirmation and then really delete the group, so it no longer shows up for participants or the public.
- As an **organizer**, I want to be told when I cannot delete a group because people are signed up for an upcoming term, and to see which date is blocking it.
- As a **participant or visitor**, I want a deleted group's links to answer "not found" instead of showing a group with no organizer.
- As an **admin**, I want to list deleted groups (when and by whom) and restore one with a single click, so I can undo a mistaken deletion when support asks.
- As an **organizer**, I want my group to be safe from other users who might assign themselves as its organizer or end my Leadership.

## Core Requirements

### Backend: data and write side
1. **Migration `0056_group_soft_delete.py`** (revision `"0056"`, down_revision `"0055"`). Adds `groups.deleted_at TIMESTAMP NULL` and `groups.deleted_by_party_id UUID NULL` with FK `fk_groups_deleted_by_party_id_parties` → `parties.id`. The downgrade drops the FK and then both columns. No data migration: groups orphaned by the old bug stay as they are. No index, because group reads go by PK and listings are small.
2. **Model**: `Group.deleted_at: Mapped[datetime | None]` (`DateTime()`, same shape as `NeededItem.deleted_at`) and `Group.deleted_by_party_id: Mapped[uuid.UUID | None]` (plain FK-id column, no `relationship()`, per models.md).
3. **`DELETE /api/groups/{group_id}`** → **204**.
   - 404 if the group is unknown or already deleted (through `get_group`).
   - 403 unless the caller is the group's **active organizer** or holds **ADMIN**.
   - 409 `BusinessConflictException` if any **upcoming** term of the group (`Term.occurs_on >= clock.local_now()`) has at least one `TermAttendance` with `withdrawn_at IS NULL`. The message names the **nearest** blocking term: `"Grupy nie można usunąć — na termin {clock.format_term_day(occurs_on)} są zapisy. Spróbuj po tym terminie albo gdy uczestnicy się wypiszą."` (renders e.g. "…na termin wt 21.10 są zapisy…"). The check applies to ADMIN deletes as well.
   - On success it sets `deleted_at = datetime.utcnow()` (naive UTC audit timestamp, per time.md) and `deleted_by_party_id` = the caller's party id. An ADMIN without a `UserProfile` gets `NULL`. Single commit. The **Leadership is not touched**. No notifications are sent.
4. **`POST /api/groups/{group_id}/restore`** (ADMIN only) → **204**.
   - 404 if the group is unknown (looked up through `get_group_including_deleted`).
   - 409 `BusinessConflictException("Grupa nie jest usunięta")` if `deleted_at IS NULL`.
   - On success it clears both `deleted_at` and `deleted_by_party_id`. Single commit. No notifications.
5. **`GET /api/groups/moderation?deleted=false|true`** (ADMIN, default `false`).
   - `false` lists live groups only (today's order: `created_at DESC, id`).
   - `true` lists deleted groups only, sorted `deleted_at DESC, id`.
   - `total` comes from a count with the **same** predicate.
   - `ModerationGroupResponse` gains nullable `deleted_at: datetime | None` and `deleted_by_name: str | None`. The name comes from an outer join of `UserProfile` on `party_id = groups.deleted_by_party_id`, and is null when there is no profile. Both fields are null in the live list. The organizer, member and term columns are computed as today; the organizer is still present because the Leadership is kept.

### Backend: Leadership ownership fixes
6. **`POST /api/leaderships`** changes to **ADMIN only**: the route uses `require_any("ADMIN")` and gets a matching matrix row. The service is unchanged.
7. **`POST /api/leaderships/{leadership_id}/end`**:
   - 404 if the Leadership is unknown.
   - **403** unless the caller holds ADMIN or is the **active organizer of `leadership.to_group_id`** (`_is_active_organizer`). That check does **not** look at the group's `deleted_at`, so ending a leadership on a deleted group is allowed for its organizer or an ADMIN, and the restored group may then be leaderless.
   - Route permission stays EDIT.

### Backend: read isolation (a deleted group is nonexistent)
8. **Central getters** in `app/groups`:
   - `repository.get_group` returns `None` when `deleted_at IS NOT NULL`. A new `repository.get_group_including_deleted` is a plain `db.get`.
   - `circles.get_group` keeps its signature (404 via `EntityNotFoundException`). A new `circles.get_group_including_deleted` is used **only** by restore. The admin list uses its own query.
   - `repository.get_term` returns `None` when the term's group is deleted (join `Group`, `Group.deleted_at IS NULL`). A new `repository.get_term_any` is a plain `db.get`.
   - `terms.get_term` keeps its signature (404). A new `terms.get_term_any` (404 only when the term row is missing) is used **only** by the keep-live paths in table B.
9. **Explicit predicates** (`Group.deleted_at.is_(None)`) on every listing or join query in table A. There is **no** global ORM filter (`with_loader_criteria` was rejected in technical-clarifications.md).
10. **Guards** (`get_group` / `get_term` called up front) on routes and services that reach group data without going through the getters (table A).
11. Mutations on a deleted group return 404 through `get_group` / `get_term`, **except** the keep-live paths in table B.

#### Table A: read and mutation paths and how each is treated

| # | Location | Endpoint / consumer | Treatment |
|---|----------|---------------------|-----------|
| A1 | `repository.get_group` (repository.py:67) → `circles.get_group` (circles.py:143) | GET `/api/groups/{id}`, PATCH `/api/groups/{id}`, DELETE (new), `get_own_circle`, `assign_leadership`, `create_term` (terms.py:34), public view `/api/groups/public/{id}` + `/access` + `/rsvp` (public_view.py:211/423), join requests create/approve/reject/list-by-group (join_requests.py:72/174/277), formalize (memberships.py:187), exchange summary + family offers (exchange_summary.py:205/237), take listing (term_item_listings.py:531), accept swap (:738), OG previews (`app/system/router.py`, already catch `EntityNotFound`) | **Filter in getter** (404) |
| A2 | `repository.list_groups` (:62) | GET `/api/groups` | **Filter** `deleted_at IS NULL` |
| A3 | `repository.count_groups` (:80), `list_groups_for_moderation` (:84) | GET `/api/groups/moderation` | **Filter** with a `deleted: bool` parameter (`IS NULL` / `IS NOT NULL`), same predicate in both. In deleted mode, sort by `deleted_at DESC` and outer-join the deleted-by `UserProfile` |
| A4 | `repository.list_active_leaderships_for_role_ids` (:192) | `/api/people/{id}/leaderships` (users/router.py:131), `get_own_circle` → `POST /api/groups/mine`, `list_my_pending_join_requests` (join_requests.py:267), OnboardingPage role detection | **CRITICAL: join `Group` + filter** |
| A5 | `repository.list_active_memberships_for_role_ids` (:235) | `/api/families/{id}/memberships` (families/repository.py:86 via `list_memberships_for_party`), `_is_active_member` | **CRITICAL: join `Group` + filter** |
| A6 | `repository.get_term` (:249) → `terms.get_term` (terms.py:47) | GET `/api/terms/{id}`, PATCH `/api/terms/{id}`, needed-item create (terms.py:148) / update / delete (`_require_needed_item_organizer` :197), listings take/propose/browse/public (term_item_listings.py:440/468/480/600/715), public term view (public_view.py:246/420), `pledge_fulfillment` (:50), `_require_term_in_group` (memberships.py:123), join-request term check (join_requests.py:94), pledge notification lookup (pledges.py:44, short-circuits to "no event") | **Filter in getter** (404) |
| A7 | `repository.count_terms` (:260), `list_terms_for_moderation` (:264) | GET `/api/terms/moderation` (AdminTerms) | **Join `Group` + filter** in both (count consistent with list) |
| A8 | `repository.list_my_attendances_joined` (:421) | GET `/api/groups/mine/attendances` | **Filter** (Group already joined) |
| A9 | `repository.list_my_pledges_joined` (:351) | GET `/api/pledges/mine` | **Filter** (Group already joined) |
| A10 | `repository._qualifying_owner_circles` (:674) | public organizer directory `/api/groups/public/organizers/{slug}` + `/terms` (covers `list_owner_public_circles`, `_owner_public_terms_select`, `list_upcoming_terms_for_groups`, `count_member_families_for_groups`) | **Filter** (one predicate covers all of them) |
| A11 | `terms.list_terms_with_counts` (terms.py:58) | GET `/api/terms?circle_group_id=` | **Guard**: `get_group` first. `list_terms` (:54) is only called from public_view after `get_group`, so it needs no change |
| A12 | `terms.list_needed_item_views` (:180), `terms.get_needed_item_view` (:171) | GET `/api/needed-items?term_id=`, GET `/api/needed-items/{id}` | **Guard**: `get_term(term_id)` / `get_term(item.term_id)` |
| A13 | `terms.get_needed_item` (:160) | `create_pledge` (pledges.py:65), `list_pledges` (:102), `pledge_fulfillment`, `_require_needed_item_organizer` | **Guard**: after the existing deleted-item check, call `get_term(needed_item.term_id)`. This blocks pledging on a deleted group's needs |
| A14 | router `get_current_leadership` / `list_leaderships` / `list_memberships_for_circle` (router/circles.py:319/330/339) | GET `/api/groups/{id}/leadership`, `/leaderships`, `/memberships` | **Guard in the router**: `await service.get_group(db, group_id)` first. Do **not** change the service `get_current_leadership`, because `_is_active_organizer` and the slug resolver depend on it |
| A15 | `repository.list_pending_join_requests_for_groups` (:649) | join-request inbox | **No change**: its only caller gets `group_ids` from A4 (already filtered). `/api/groups/{id}/join-requests` is covered by A1 |
| A16 | `exchange_summary.py:51` term query, `public_view.py` joined reads | exchange summary, public view | **No change**: reached only after `get_group` (A1) |
| A17 | `assign_leadership` (circles.py:193) | POST `/api/leaderships` | Now ADMIN only (req 6), and already 404 on a deleted group through A1 |

#### Table B: deliberately keep-live paths (must keep working for a deleted group)

| # | Location | Reason | Treatment |
|---|----------|--------|-----------|
| B1 | `_resolve_transaction_reservations_for_action` (term_item_listings.py:962) → confirm-transaction / cancel-transaction | Reservations that are already locked must still resolve (clarification 4a) | Switch `get_term` → **`get_term_any`** |
| B2 | `list_my_term_item_listings` (term_item_listings.py:382) and `list_my_active_taken_term_item_listings` (:391): GET `/api/term-item-listings/mine`, `/mine-as-taker` | The frontend resolves the reservation id for a post-term confirm prompt from these two endpoints (`components/pending/pendingActions.ts` `resolvePendingReservationId`, SWAP prompts with `reservation_id = null`). Without them B1 cannot be reached for swaps | Switch `get_term` → **`get_term_any`** (they are caller-scoped and still pass through `_require_term_eligibility`) |
| B3 | `term_end_scan.py` (`_find_terms_just_ended` :64, `repository.list_group_names` :207) | The scheduler keeps processing (clarification 4d) | **No change**. Its own queries do not use the getters, and `list_group_names` stays unfiltered |
| B4 | `withdraw_attendance` (attendance.py:52), `withdraw_pledge` (pledges.py:107, `get_pledge` :97 + GET `/api/pledges/{id}`), `withdraw_join_request` (join_requests.py:150), `reject_swap_proposal` (term_item_listings.py:784), `end_membership` (memberships.py:40) | Withdrawals and self-exits allowed (clarification 4b) | **No change**: none of them go through `get_group` / `get_term` |
| B5 | `remove_leadership` (circles.py:209) | End leadership allowed on a deleted group (organizer/ADMIN) | Uses `repository.get_leadership` + `_is_active_organizer`, which ignore `deleted_at` (req 7) |
| B6 | `circulation/infrastructure/repository.py:454` `find_reservation_term` (Core `_groups`) | Historic item and reservation info (group name), used by `getReservation` in RzeczyView | **No change** |
| B7 | `slug_resolver.resolve_organizer_slug`, notification `link_path` strings | Harmless: links simply 404 | **No change** |
| B8 | Restore (`get_group_including_deleted`) | Admin undo | Including-deleted getter |

### Backend: authorization matrix (`app/core/authorization_matrix.py`, first match wins)
12. Change these rows:
    - Widen the existing row `(_methods("PATCH"), r"^/api/groups/[^/]+$", EDIT)` (line ~122) to **`_methods("PATCH", "DELETE")`**, with the same precedent as the families, needed-items and inventory-items rows. It stays **after** the `/mine` and `/public` rows and before row 26.
    - Insert **`(_methods("POST"), r"^/api/groups/[^/]+/restore$", ("ADMIN",))`** directly after the `GET ^/api/groups/moderation$` ADMIN row (line ~126) and **before** row 26 (blanket GET READ) and row 27 (blanket POST EDIT).
    - Insert **`(_methods("POST"), r"^/api/leaderships$", ("ADMIN",))`** directly **before** row 30 (`POST ^/api/leaderships(/.*)?$` EDIT). Row 30 keeps covering `/{id}/end` with EDIT.
    - The route dependencies must match: DELETE uses `EditPrincipal`, restore uses `ModerationPrincipal`, and assign uses an ADMIN principal in `router/leaderships.py`.

### Backend: routes (`app/groups/router/circles.py`)
13. Route ordering:
    - `DELETE /api/groups/{group_id}` sits next to PATCH (`EditPrincipal`, `get_profile_by_principal`). ADMIN is detected via `"PERMISSION_ADMIN" in principal.authorities`.
    - `POST /api/groups/{group_id}/restore` (`ModerationPrincipal`, 204).
    - `GET /api/groups/moderation` gets a `deleted: bool = False` query parameter. It stays registered ahead of `/{group_id}`.
    - Export the new service functions from `app/groups/service.py` (`soft_delete_group`, `restore_group`, `get_group_including_deleted`, `get_term_any` if the routers or other modules need it).

### Frontend: panel (Tailwind, Polish copy)
14. **`api/groups.ts`**: add `deleteGroup(id)` (`api.delete("/groups/{id}")`), `restoreGroup(id)` (`api.post("/groups/{id}/restore", undefined)`), and `getGroupsForModeration(page, deleted)`, which appends `deleted=true` only when it is true. `ModerationGroupResponse` gains `deleted_at: string | null` and `deleted_by_name: string | null`. Remove `assignLeadership` and `endLeadership` from the API module **only if** they have no callers left after this change. `endLeadership` is currently imported only by PanelDataContext. Otherwise keep them.
15. **`PanelDataContext.handleRemoveGroup(groupId): Promise<void>`**:
    - Calls `deleteGroup(groupId)`, then `showToast("Usunięto grupę")` and `await load()`.
    - On failure it **rethrows** `new Error(serverMessageOr(err, "Nie udało się usunąć grupy. Spróbuj ponownie."))`, so the dialog shows it inline. It shows no toast on failure and no longer uses the shared `busy` flag.
    - It no longer calls `endLeadership`, so drop the import.
16. **`PanelDataContext.load()` tolerates a single missing group**: both `Promise.all(... getGroup ...)` sites (organizer branch ~442, guest branch ~448-450) use one local helper. The helper maps `hasStatus(err, 404)` to "skip this group" and rethrows any other error.
17. **New `pages/panel/DeleteGroupDialog.tsx`**, cloned from `UnsavedChangesDialog`:
    - Props `{ group: GroupResponse; onConfirm: () => Promise<void>; onClose: () => void }`. It owns its `busy` and `error` state.
    - Copy, states, focus and keyboard behavior follow the Visual Design section.
18. **`SpotkaniaView` trash**: `onClick` opens `DeleteGroupDialog` for that group and stores the opener element. It gets `aria-haspopup="dialog"`, keeps its aria-label, classes and icon, and renders the dialog inside `SpotkaniaView` (theme scope).
    - On close it returns focus to the opener.
    - After success the opener is gone, so focus falls back to `main[tabindex=-1]` per accessibility.md.
    - If an attempt failed and the dialog is then closed, call `load()` so a group already gone in another tab disappears.

### Frontend: admin (Chakra, English copy)
19. **`hooks/useModerationGroups(page, deleted)`**: the key becomes `["moderationGroups", deleted, page]`. Add a `restore(groupId)` callback following the `useModerationPhotos` template: on error it throws `new Error(extractProblemMessage(err))`, then it does `await queryClient.invalidateQueries({ queryKey: ["moderationGroups"] })`. The return shape is otherwise unchanged.
20. **`AdminGroupsPage`**:
    - Active/Deleted toggle (`HStack role="group" aria-label="Group status"`, `Button aria-pressed`, solid/outline). The toggle is rendered above the loading, error and empty branches, and changing it resets the page to 1.
    - The Deleted view adds the columns "Deleted at" (`DD.MM.YYYY HH:mm`), "Deleted by" (italic "Unknown" when null) and an "Actions" column with a per-row Restore button (no confirm, busy "Restoring…", inline `role="alert"` error).
    - Empty state: "No deleted circles".
    - Footer: `Showing N of M deleted circle(s)`.
    - Extract a small `DeletedGroupRow` component (inside the page file or `components/moderation/`) so each row owns its `busy` and `error` state, as `PhotoModerationCard` does.

## Visual Design

Mockups in `analysis/design-context/` are **binding inputs**: the implementation-planner will attach `Visual References` to the UI task groups. Source: `analysis/design-context/ascii/ui-mockups.md` (ASCII, layout and behavior fidelity, not pixel-perfect). Index: `analysis/design-context/INDEX.md`.

| ID | Mockup anchor | Key elements |
|----|---------------|--------------|
| `component:delete-group-trigger` | `#delete-group-trigger` | SpotkaniaView tile trash, aria-label "Usuń grupę {name}" unchanged, `aria-haspopup="dialog"`, opens the dialog (no longer `endLeadership`), focus-return anchor |
| `component:delete-group-dialog` | `#delete-group-dialog` | `fixed inset-0 z-[70] bg-scrim px-4`, card `max-w-[340px] rounded-[24px] bg-paper p-5`. `role="alertdialog" aria-modal="true"`, labelled by the title `Usunąć grupę „{name}”?`, described by the body `Grupa zniknie dla uczestników. Jeśli to pomyłka, napisz do nas — przywrócimy ją.` ("napisz do nas" is plain text, not a link). Buttons: `Anuluj` (border-line bg-cream, **initial focus**) and `Usuń grupę` (bg-danger text-paper, min-h-[44px]). Esc or a scrim click cancels. Tab/Shift+Tab is trapped (`trapFocus` from `components/krag/trapFocus.ts` or the two-button cycle). `useRegisterOpenSheet(true)` |
| `component:delete-group-dialog-busy` | `#delete-group-dialog-busy` | Label `Usuwanie…` in place. Both buttons disabled, `aria-busy` on the danger button. Esc and scrim are ignored. Focus moves to the dialog container (`tabIndex={-1}`) when the focused button becomes disabled |
| `component:delete-group-dialog-error` | `#delete-group-dialog-error` | Inline `p role="alert"` (text-sm font-semibold text-danger) between body and buttons. Shows the 409 server message verbatim or the fallback `Nie udało się usunąć grupy. Spróbuj ponownie.` (403 → `ACCESS_DENIED_MESSAGE` via `serverMessageOr`). The dialog stays open, the error clears on retry, and focus returns to `Anuluj` |
| `screen:panel-spotkania-after-delete` | `#panel-spotkania-after-delete` | Dialog closes, toast `Usunięto grupę`, tile removed, `Grupy · N` updates. Empty state `Nie masz jeszcze żadnej grupy.` (or the guest variant if no active leaderships are left, which is expected) |
| `screen:admin-groups` | `#admin-groups-active` | Toggle `Active` / `Deleted` (`role=group`, `aria-label="Group status"`, `aria-pressed`, page reset). Active table unchanged |
| `screen:admin-groups-deleted` | `#admin-groups-deleted` | Columns Name / Organizer / Members / Terms / Created / **Deleted at** / **Deleted by** / **Actions** (visually hidden "Actions" header; headers must be unique for `AdminTable` keys) |
| `component:admin-group-restore-button` | `#admin-groups-deleted` | `Button size="sm"`, `aria-label="Restore {name}"`, busy label `Restoring…`, `Text role="alert" fontSize="13px" color="red.500"` error in the cell. On success the row leaves the Deleted list (prefix invalidation) and focus moves to the "Deleted" filter button |
| `screen:admin-groups-deleted-empty` | `#admin-groups-deleted-empty` | `EmptyState title="No deleted circles"`. Existing `Loading...` and `Error: {message}` states unchanged |

Copy language: **Polish** in the panel and **English** in the admin (user-confirmed). Server error messages are Polish across the backend, and the admin shows them verbatim, as it already does for other server errors.

## Reusable Components

### Existing Code to Leverage
| Need | Reuse | Path |
|------|-------|------|
| Soft-delete service shape (guard → stamp `utcnow()` → single commit, Polish 409) | `soft_delete_needed_item` | `src/backend/app/groups/application/terms.py:222-265` |
| Including-deleted getter pattern | `find_item_including_deleted` | `src/backend/app/circulation/application/inventory_items.py:94` |
| Ownership check | `_is_active_organizer` / `_require_active_organizer` | `src/backend/app/groups/application/circles.py:254-264` |
| Errors | `EntityNotFoundException`, `BusinessConflictException`, `AccessDeniedException` | `src/backend/app/core/errors.py` |
| Caller profile | `get_profile_by_principal` | `app/users/service` (already used in router/circles.py) |
| ADMIN principal | `ModerationPrincipal = require_any("ADMIN")` | `src/backend/app/groups/router/circles.py:56` |
| DELETE-204 route template | `delete_needed_item` | `src/backend/app/groups/router/terms.py:130-133` |
| Aggregated moderation query | `list_groups_for_moderation` (extend it, do not duplicate it) | `src/backend/app/groups/infrastructure/repository.py:84` |
| Active RSVP predicate | `TermAttendance.withdrawn_at.is_(None)` pattern | `repository.py:387-418` |
| Domain clock + date copy | `clock.local_now()`, `clock.format_term_day` | `src/backend/app/core/clock.py` |
| Migration template | `0029_term_attendance_withdrawn_at.py` | `src/backend/alembic/versions/` |
| Matrix widening precedent | families / needed-items / inventory-items `PATCH,DELETE` rows | `src/backend/app/core/authorization_matrix.py` |
| Backend test helpers | `_register_organizer`, `_auth_headers`, `_create_circle_with_term` (test_groups.py:28-51); `_authed_headers`, `_grant_admin_and_relogin` (test_groups_moderation.py:25/34); setting `row.deleted_at` directly (test_groups.py:439/623); the red tests in `tests/test_group_soft_delete.py` | `src/backend/tests/` |
| Panel alertdialog | `UnsavedChangesDialog` (cloned, not generalised: the props differ) | `src/frontend/src/pages/organizer/editor/UnsavedChangesDialog.tsx` |
| Focus trap / open-sheet registry | `trapFocus`, `useRegisterOpenSheet` | `src/frontend/src/components/krag/trapFocus.ts`, `src/frontend/src/components/shared/openSheets.ts` |
| Panel error copy | `serverMessageOr`, `hasStatus` | `src/frontend/src/api/problem.ts` |
| Admin toggle + per-row busy/error | `PhotoModerationPage` (`STATUS_FILTERS`, toggle), `PhotoModerationCard` | `src/frontend/src/pages/PhotoModerationPage.tsx:28-43`, `src/frontend/src/components/moderation/PhotoModerationCard.tsx` |
| Mutation hook template | `useModerationPhotos.remove` | `src/frontend/src/hooks/useModerationPhotos.ts` |
| Admin table/pagination/empty | `AdminTable`, `Pagination`, `EmptyState` (unchanged) | `src/frontend/src/components/shared/` |
| Dates | `dayjs` from `utils/dayjs` | `src/frontend/src/utils/dayjs.ts` |
| Frontend test wrappers | `createQueryWrapper`, `pageOf`, existing `vi.mock("../api/groups")` blocks | `src/frontend/src/test/queryClient.tsx`, `test/AdminGroupsPage.test.tsx`, `test/PanelPage.test.tsx:68-82` |

### New Components Required
| New element | Why existing code cannot be reused |
|-------------|------------------------------------|
| Migration `0056` + 2 `Group` columns | No deletion state exists on `groups` |
| `soft_delete_group`, `restore_group` (circles.py) | No group-deletion use case exists. They follow the `soft_delete_needed_item` template |
| `get_group_including_deleted` (repository + circles), `get_term_any` (repository + terms) | The default getters must become deleted-aware, and restore plus the keep-live paths (table B) need an escape hatch, as `find_item_including_deleted` provides |
| Repository query for the nearest upcoming term with active RSVPs (one `MIN(occurs_on)` query) | No existing query answers "nearest upcoming term of a group with an active attendance" |
| 2 routes + `deleted` query parameter | New endpoints required by requirements 3–5 |
| 3 matrix rows (1 widened, 2 inserted) | DELETE currently falls through to AUTHENTICATED, restore would resolve to EDIT, and assign must be ADMIN |
| `DeleteGroupDialog.tsx` | Its props differ from `UnsavedChangesDialog` (async confirm, busy, error, dynamic title). Chakra `ConfirmDialog` is portalled outside the organizer theme and does not register an open sheet |
| `DeletedGroupRow` (admin) | Each row needs its own busy/error state. `PhotoModerationCard` is photo-specific |

## Technical Approach

### Data flow: delete
SpotkaniaView trash → `DeleteGroupDialog` → `onConfirm` = `handleRemoveGroup(id)` → `DELETE /api/groups/{id}`. The router resolves the profile and the ADMIN flag, then calls `service.soft_delete_group(db, group_id, actor_party_id, is_admin)`. That function runs `get_group` (404), then `_require_active_organizer` unless admin (403), then the nearest-blocking-term query using `clock.local_now()` (409 with `format_term_day`), then stamps `deleted_at` / `deleted_by_party_id` and commits. Back in the panel: toast, then `load()`. Because of A4/A5 the server-filtered leadership and membership listings no longer contain the group, so it disappears. The 404-tolerant group fetch covers any leftover race.

### Data flow: restore
AdminGroupsPage (Deleted) → Restore → `useModerationGroups.restore` → `POST /api/groups/{id}/restore` → `restore_group`, which runs `get_group_including_deleted` (404), returns 409 if the group is live, otherwise clears both columns and commits. Then the hook invalidates `["moderationGroups"]`, so the Deleted and Active lists both refetch.

### Isolation strategy
- The central getters handle the single-entity reads and the mutations (A1, A6).
- Explicit predicates handle the listings (A2–A5, A7–A10).
- Guards cover the paths that bypass the getters (A11–A14).
- Escape-hatch getters are used only in B1, B2 and B8.
- There is no global ORM filter: per models.md and queries.md, predicates stay explicit and visible.
- Every A-row gets a read-path test in which the group is soft-deleted, either through the new DELETE or by setting `deleted_at` directly.

### Concurrency and locking
`Group.updated_at` is the `version_id_col`, so a soft delete or restore bumps it. A PATCH that races a DELETE may raise a stale-data error. This is accepted, because the frontend refetches.

### Persona side effects (expected, no new UI)
- An organizer whose last group was deleted is detected as GUEST (onboarding and the panel use active leaderships, which are now filtered). This matches today's behaviour after `endLeadership`.
- `POST /api/groups/mine` then creates a **new** circle for that organizer. This is consistent with "nonexistent".

## Implementation Guidance

### Testing Approach
- Write 2-8 focused tests per implementation step group. Test verification runs only the new and touched tests, not the entire suite.
- **Backend** (pytest, testcontainers PG, `tests/`; run with `uv run python -m pytest`):
  - `tests/test_group_soft_delete.py`: the **2 red tests must pass unchanged** (`test_deleteGroup_activeOrganizer_hidesGroupAndKeepsLeadership`, `test_endLeadership_otherOrganizer_returns403`). Extend the same file with:
    - delete by a non-organizer → 403
    - delete by ADMIN → 204 with `deleted_by_party_id` = the admin
    - second delete → 404
    - upcoming term with an active RSVP → 409 whose message contains the nearest date (use `freeze_local_now`); a withdrawn RSVP or a past term does not block
    - Leadership still active after delete
    - organizer ending own leadership on a deleted group → 200
    - `POST /api/leaderships` by a non-admin → 403
  - Read-path isolation (same file or a sibling `test_group_soft_delete_reads.py`), one assertion per A-row group:
    - `/api/people/{id}/leaderships` and `/api/families/{id}/memberships` exclude the group
    - `POST /api/groups/mine` no longer returns the deleted group
    - GET `/api/groups` and the public organizer directory exclude it
    - `/api/groups/mine/attendances` and `/api/pledges/mine` exclude it
    - `/api/terms/moderation` items and total exclude it
    - GET `/api/terms?circle_group_id=`, `/api/terms/{id}`, `/api/needed-items?term_id=` and POST `/api/pledges` → 404
    - `/{id}/leadership(s)` and `/memberships` → 404
  - Keep-live checks:
    - confirm/cancel-transaction on a term of a deleted group still resolves (B1)
    - `/api/term-item-listings/mine-as-taker` still answers (B2)
    - withdraw attendance works (B4)
    - `scan_for_term_ended` still processes the term (B3)
  - `tests/test_groups_moderation.py`:
    - `?deleted=true` lists only deleted groups, sorted by `deleted_at DESC`, with `deleted_at` / `deleted_by_name` set and a consistent total
    - the default list excludes deleted groups
    - restore by ADMIN → 204 and the group is readable again
    - restore by a non-admin → 403
    - restore of a live group → 409
    - restore of an unknown id → 404
  - `tests/test_authorization_matrix.py`:
    - DELETE `/api/groups/x` → EDIT
    - POST `/api/groups/x/restore` → `("ADMIN",)`
    - POST `/api/leaderships` → `("ADMIN",)`
    - POST `/api/leaderships/x/end` → EDIT
    - the existing regression guards stay green (GET `/api/groups/{id}` → READ, `/mine/attendances`, `/public/...`)
  - Migration: one upgrade/downgrade round-trip test for `0056`, following `test_organization_page_layout_migration.py`.
- **Frontend** (Vitest + Testing Library, `src/test/`, explicit `vitest` imports):
  - New `DeleteGroupDialog.test.tsx`:
    - initial focus on Anuluj
    - Esc and Anuluj call `onClose`
    - confirm shows `Usuwanie…` with disabled buttons
    - a rejected `onConfirm` shows the `role="alert"` message and keeps the dialog open
  - `PanelPage.test.tsx`:
    - trash opens the dialog
    - confirm calls `deleteGroup` (not `endLeadership`) and shows "Usunięto grupę"
    - cancel calls nothing
    - a 409 message is shown inline
    - `load()` survives one `getGroup` 404
  - `AdminGroupsPage.test.tsx`:
    - toggling to Deleted requests `getGroupsForModeration(1, true)` and shows the Deleted at / Deleted by columns
    - Restore calls `restoreGroup` and refetches
    - a restore error shows a `role="alert"`
    - the Deleted empty state shows "No deleted circles"

### Standards Compliance
- `standards/backend/models.md`: nullable timestamp column, a plain FK-id column (`deleted_by_party_id`) with no relationship, string names for constraints.
- `standards/backend/migrations.md`: `0056_group_soft_delete.py`, reversible, small and focused, FK named `fk_groups_deleted_by_party_id_parties`, schema only (no data migration).
- `standards/backend/queries.md` / `jooq.md`: bound parameters only. The count and the list share one predicate. The RSVP check is a single `MIN` query, never N+1.
- `standards/backend/security.md`: matrix rows mirror the `Depends(require_any(...))` of each route, first-match ordering is verified by tests, and ownership checks live in the service.
- `standards/backend/time.md`: `datetime.utcnow()` for `deleted_at`, `clock.local_now()` (called through the module attribute) for "upcoming", `clock.format_term_day` for the 409 copy. The domain-clock guard test must stay green.
- `standards/backend/api.md`: DELETE and restore return 204, a query flag on the existing moderation collection instead of a new literal route.
- `standards/global/error-handling.md` / `validation.md`: typed exceptions (404/403/409) and specific Polish messages.
- `standards/global/minimal-implementation.md`: no global filter, no notifications, no confirm on restore, no speculative helpers. Remove `endLeadership` / `assignLeadership` from the frontend only if nothing calls them.
- `standards/frontend/accessibility.md`: alertdialog, `aria-modal`, Tab trap, Esc on the dialog element (ignore `defaultPrevented`), focus returned to the opener with a `main[tabindex=-1]` fallback, `useRegisterOpenSheet(true)`, `aria-pressed` toggle, row-specific Restore labels, `role="alert"` errors.
- `standards/frontend/data-fetching.md`: the key is the prefix then the params `["moderationGroups", deleted, page]`; the mutation awaits invalidation of the whole prefix; errors pass through `extractProblemMessage`; stable empty fallback.
- `standards/frontend/css.md` / `components.md`: Tailwind design tokens in the panel and Chakra props in the admin; single-responsibility dialog and row components.
- `standards/testing/backend-testing.md` / `frontend-testing.md`: integration-first, `test_action_condition_expected` naming, `createQueryWrapper`, `vi.mock` factories with `vi.resetAllMocks()`.

## Out of Scope
- Hard delete and retention or purge jobs.
- Group transfer or sale (a future Leadership operation). Organizer-side restore or a "trash" view for organizers.
- Cancelling or deleting terms (so the 409 copy points at waiting or at participants withdrawing).
- Notifications to members or organizers on delete or restore.
- Cleaning up groups orphaned by the old bug (no data migration).
- The gap where the Chakra `ConfirmDialog` does not call `useRegisterOpenSheet`.
- Refreshing the stale `standards/backend/models.md` text ("soft delete not used"). This should be suggested separately via `/maister:standards-update`.
- A contact link or form for "napisz do nas" (plain text only).
- Showing the deleted state to the organizer (deleted = 404 for everyone).

## Success Criteria
- `uv run python -m pytest tests/test_group_soft_delete.py -q` passes: both red tests are green, along with the new tests.
- Every A-row path returns 404 or omits the group after a delete. Every B-row path still works for that group.
- The organizer panel and the guest panel both load after one of their groups is deleted. `POST /api/groups/mine` does not 500.
- An admin can see the deleted group (date and actor) under Deleted and restore it in one click. It then reappears in Active and on its public URL.
- Only ADMIN can call `POST /api/leaderships`. Only the active organizer or ADMIN can end a Leadership.
- The migration upgrades and downgrades cleanly. The matrix tests and the domain-clock guard are green. mypy and ruff stay at or below the HEAD baseline.
- New frontend tests pass, `tsc -p tsconfig.app.json` is clean, and the existing AdminGroupsPage and PanelPage tests are updated and pass.

## Known Limitations
- The ADMIN detection in DELETE and end-leadership reads `principal.authorities` directly (there is no existing in-service helper). An ADMIN without a `UserProfile` deletes with `deleted_by_party_id = NULL` ("Unknown" in the admin list).
- The restore 409 message is Polish (backend convention), so the English admin page shows it verbatim, as it already does for other server errors.
- B2 widens the keep-live set slightly beyond technical-clarifications.md, which named only confirm/cancel and the scheduler. Without it, swap confirm prompts on a deleted group's term could not resolve their reservation id.

---

## Audit Resolutions (binding — supersede conflicting text above)

Source: verification/spec-audit.md (pass-with-concerns), user decisions 2026-10-14.

1. **M1 — ADMIN without a user profile**: the DELETE route and the end-leadership path catch `EntityNotFoundException` from `get_profile_by_principal` (same pattern as `public_view.py:355-358`). An ADMIN without a profile may delete; `deleted_by_party_id = NULL` (admin list shows "Unknown"). Same for ending a leadership as ADMIN.
2. **M2 — `remove_leadership` ownership check lives in the service** (security standard: ownership in service). Signature extended to receive the caller (party id or None + is_admin flag); update the direct call in `tests/test_group_join_requests_router.py:352` accordingly (add to test plan).
3. **M3 — 409 date format**: use `clock.format_term_day` ("wt 21.10"); exact message pinned in a test: `Grupy nie można usunąć — na termin {format_term_day(occurs_on)} są zapisy. Spróbuj po tym terminie albo gdy uczestnicy się wypiszą.`
4. **L1 — Table B additions**: `sync_pledge_fulfillment` stays live; `list_swap_proposals_for_my_item` stays live (needed to reach reject swap and release a proposer's locked item). `fulfill_pledge` is intentionally blocked on a deleted group (via `get_term`).
5. **L2 — Actions header**: `AdminTable` unchanged; the Deleted view's action column has a visible header "Actions".
6. **L4 — panel resilience**: `PanelDataContext.load()` tolerates 404 not only from `getGroup` but also from the follow-up `getTerms` / `getNeededItems` calls for that group (skip the group's data instead of failing the whole load).
7. **L6 — existing frontend tests to update**: `AdminGroupsPage.test.tsx` call assertions `(1)`/`(2)` → `(1, false)`/`(2, false)`; `PanelPage.test.tsx` `../api/groups` mock gains `deleteGroup`.
8. Accepted/known (no change): L3 RSVP-vs-delete race (accepted, like PATCH stale-data race); L5 admin DELETE relies on ADMIN token also carrying EDIT (verify in matrix test); L7 line drift (pledges.py get_pledge :90, list_pledges :97; memberships end_membership :42); L8 test count justified by breadth.
