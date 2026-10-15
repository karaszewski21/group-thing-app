# Implementation Plan: Group (Circle) Soft Delete with Admin Restore

## Overview
Total Steps: 70
Task Groups: 10
Expected Tests: ~45-60 new/updated tests in total (2-8 per implementation group, max 10 in the review group), plus 2 pre-existing red tests that must turn green unchanged

Source: `implementation/spec.md`. The final "Audit Resolutions (binding)" section of the spec overrides conflicting text and is reflected here:
- M1: ADMIN without a `UserProfile` may delete or end a leadership (`EntityNotFoundException` from `get_profile_by_principal` is caught, party id becomes `None`).
- M2: the `remove_leadership` ownership check lives in the service. Its signature takes the caller, and the direct call in `tests/test_group_join_requests_router.py:352` must be updated.
- M3: the 409 message is pinned exactly.
- L1: `sync_pledge_fulfillment` and `list_swap_proposals_for_my_item` stay live. `fulfill_pledge` is blocked on purpose (it goes through `get_term`).
- L2: the Deleted view gets a visible "Actions" header, and `AdminTable` is unchanged.
- L4: `load()` tolerates 404 from `getGroup`, `getTerms` and `getNeededItems`.
- L6: existing frontend tests are updated.

Paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`.
- Backend commands run from `src/backend`: `uv run python -m pytest|ruff|mypy`.
- Frontend commands run from `src/frontend`: `npx vitest run <file>`, `npx tsc -p tsconfig.app.json --noEmit`.

SECRETS RULE (repeat in every subagent prompt): never print secret values. No `env`/`printenv`, no `cat .env`, no `docker inspect` env sections. Check presence only.

TDD anchor: `src/backend/tests/test_group_soft_delete.py` already contains 2 red tests (`test_deleteGroup_activeOrganizer_hidesGroupAndKeepsLeadership`, `test_endLeadership_otherOrganizer_returns403`). They must pass **unchanged**. New tests are appended to that file or placed in sibling files. The existing two test bodies are never edited.

## Implementation Steps

### Task Group 1: Database Layer (migration 0056 + Group model)
**Dependencies:** None
**Files to Modify:** src/backend/alembic/versions/0056_group_soft_delete.py, src/backend/app/groups/models.py, src/backend/tests/test_group_soft_delete_migration.py
**Estimated Steps:** 5

- [x] 1.0 Complete database layer
  - [x] 1.1 Write 2 focused tests in `tests/test_group_soft_delete_migration.py`, following `tests/test_organization_page_layout_migration.py`
    - `test_upgrade0056_addsDeletedColumnsAndFk`: `groups.deleted_at` (timestamp without time zone, nullable), `groups.deleted_by_party_id` (uuid, nullable), FK `fk_groups_deleted_by_party_id_parties` → `parties.id`
    - `test_downgrade0056_dropsFkAndColumns`: after downgrade to `0055` the FK and both columns are gone, and upgrading back to head works
  - [x] 1.2 Create `alembic/versions/0056_group_soft_delete.py` (revision `"0056"`, down_revision `"0055"`), template `0029_term_attendance_withdrawn_at.py`
    - upgrade: `add_column groups.deleted_at sa.DateTime() nullable=True`, `add_column groups.deleted_by_party_id postgresql.UUID(as_uuid=True) nullable=True`, `create_foreign_key("fk_groups_deleted_by_party_id_parties", "groups", "parties", ["deleted_by_party_id"], ["id"])`
    - downgrade: drop the FK, then `deleted_by_party_id`, then `deleted_at`
    - No index and no data migration (spec req 1)
  - [x] 1.3 Add to `Group` in `app/groups/models.py`:
    - `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)`, same shape as `NeededItem.deleted_at`
    - `deleted_by_party_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("parties.id", name="fk_groups_deleted_by_party_id_parties"), nullable=True)`, a plain FK-id column with no `relationship()` (models.md)
  - [x] 1.4 Verify that autogenerate shows no drift for `groups`. If the project has a model/migration sync check, run it, otherwise inspect `alembic check` output if available
  - [x] 1.5 Ensure the database-layer tests pass
    - Run ONLY `uv run python -m pytest tests/test_group_soft_delete_migration.py -q`

**Acceptance Criteria:**
- Both migration tests pass, and upgrade/downgrade round-trips cleanly
- The model columns match the migration (names, nullability, FK name)
- No index and no data migration added

---

### Task Group 2: Backend Domain Services and Getters (write side, ownership)
**Dependencies:** 1
**Files to Modify:** src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/application/circles.py, src/backend/app/groups/application/terms.py, src/backend/app/groups/schemas.py, src/backend/app/groups/service.py, src/backend/tests/test_group_soft_delete_service.py, src/backend/tests/test_group_join_requests_router.py
**Estimated Steps:** 10

- [x] 2.0 Complete the service and getter layer
  - [x] 2.1 Write 7 focused service-level tests in `tests/test_group_soft_delete_service.py`, calling `service.*` directly with `db_session`, like `test_group_join_requests_router.py`:
    - `test_softDeleteGroup_activeOrganizer_stampsDeletedAtAndActorAndKeepsLeadership`
    - `test_softDeleteGroup_nonOrganizer_raisesAccessDenied`
    - `test_softDeleteGroup_upcomingTermWithActiveRsvp_raisesConflictWithNearestDate`, using `freeze_local_now` and two upcoming terms. It asserts the exact M3 message with `clock.format_term_day(nearest.occurs_on)`
    - `test_softDeleteGroup_withdrawnRsvpOrPastTerm_doesNotBlock`
    - `test_getGroup_deletedGroup_raisesEntityNotFound_butIncludingDeletedReturnsIt`
    - `test_restoreGroup_liveGroup_raisesConflict`, plus deleted → cleared columns
    - `test_removeLeadership_otherOrganizer_raisesAccessDenied`
  - [x] 2.2 Repository getters (`app/groups/infrastructure/repository.py`)
    - `get_group` (~:67) returns `None` when `deleted_at IS NOT NULL`
    - add `get_group_including_deleted` (plain `db.get`)
    - `get_term` (~:249) joins `Group` and filters `Group.deleted_at.is_(None)`
    - add `get_term_any` (plain `db.get`)
  - [x] 2.3 Repository query `find_nearest_blocking_term_date(db, group_id, now) -> datetime | None`
    - A single `select(func.min(Term.occurs_on))` over terms of the group with `occurs_on >= now`, `EXISTS` a `TermAttendance` with `withdrawn_at IS NULL` (pattern from repository.py:387-418)
    - Bound parameters only, no N+1 (queries.md)
  - [x] 2.4 Moderation repository with a `deleted: bool` parameter on `count_groups` (~:80) and `list_groups_for_moderation` (~:84)
    - Both use the same predicate (`IS NULL` / `IS NOT NULL`)
    - Deleted mode sorts by `deleted_at DESC, id`, live mode keeps `created_at DESC, id`
    - Outer-join `UserProfile` on `party_id = groups.deleted_by_party_id` to get the deleted-by name
    - Extend the existing query, do not duplicate it
    - `list_groups` (~:62) gets `Group.deleted_at.is_(None)` (A2)
  - [x] 2.5 `schemas.py`: `ModerationGroupResponse` gains `deleted_at: datetime | None = None` and `deleted_by_name: str | None = None`. The circles mapping fills them, and they are null in live mode
  - [x] 2.6 `circles.py`: add `get_group_including_deleted` (404 via `EntityNotFoundException`) and `soft_delete_group(db, group_id, actor_party_id: uuid.UUID | None, is_admin: bool)`, template `soft_delete_needed_item`
    - `get_group` → unless admin, `_require_active_organizer` (403; a missing party id means 403 for non-admins)
    - blocking-term query using `clock.local_now()` (module attribute call) → `BusinessConflictException(f"Grupy nie można usunąć — na termin {clock.format_term_day(occurs_on)} są zapisy. Spróbuj po tym terminie albo gdy uczestnicy się wypiszą.")`
    - `deleted_at = datetime.utcnow()`, `deleted_by_party_id = actor_party_id`, single commit
    - No Leadership change and no notifications
  - [x] 2.7 `circles.py`: add `restore_group(db, group_id)`
    - `get_group_including_deleted` (404)
    - `deleted_at is None` → `BusinessConflictException("Grupa nie jest usunięta")`
    - otherwise clear both columns and commit once
  - [x] 2.8 `circles.remove_leadership` (M2): extend the signature to `remove_leadership(db, leadership_id, valid_to, caller_party_id: uuid.UUID | None, is_admin: bool)`
    - 404 if the Leadership is unknown
    - unless admin, `_is_active_organizer(db, leadership.to_group_id, caller_party_id)` else `AccessDeniedException`
    - It must NOT read `deleted_at` (B5)
    - Update the direct call in `tests/test_group_join_requests_router.py:352` to pass the organizer's party id (or `is_admin=True`)
  - [x] 2.9 Wire the new functions
    - `terms.py`: add `get_term_any` (404 only when the row is missing). `terms.get_term` keeps its signature and now filters through the repository
    - `service.py`: export `soft_delete_group`, `restore_group`, `get_group_including_deleted`, `get_term_any`. Update `list_groups_for_moderation`/count call signatures in circles to pass `deleted`
  - [x] 2.10 Ensure the service-layer tests pass
    - Run ONLY `uv run python -m pytest tests/test_group_soft_delete_service.py tests/test_group_join_requests_router.py -q`

**Acceptance Criteria:**
- The 7 service tests pass, and `test_group_join_requests_router.py` stays green with the new `remove_leadership` signature
- The 409 message matches M3 exactly, and the nearest blocking term is chosen by one `MIN` query
- `deleted_at` uses `datetime.utcnow()`, and "upcoming" uses `clock.local_now()` via the module attribute (time.md)
- The Leadership is untouched by delete. Restore of a live group → 409, unknown → 404

---

### Task Group 3: Backend Routes, Authorization Matrix and Security
**Dependencies:** 2
**Files to Modify:** src/backend/app/groups/router/circles.py, src/backend/app/groups/router/leaderships.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_authorization_matrix.py, src/backend/tests/test_group_soft_delete.py, src/backend/tests/test_groups_moderation.py
**Estimated Steps:** 9

- [x] 3.0 Complete the routes and security layer
  - [x] 3.1 Write 8 focused HTTP and matrix tests. The 2 existing red tests in `tests/test_group_soft_delete.py` stay **unchanged**.
    - In `tests/test_group_soft_delete.py`, add:
      - `test_deleteGroup_nonOrganizer_returns403`
      - `test_deleteGroup_admin_returns204AndRecordsAdminAsActor`
      - `test_deleteGroup_alreadyDeleted_returns404`
      - `test_deleteGroup_upcomingTermWithActiveRsvp_returns409WithDate`
      - `test_endLeadership_organizerOnDeletedGroup_returns200`
      - `test_assignLeadership_nonAdmin_returns403`
    - In `tests/test_groups_moderation.py`, add:
      - `test_listModeration_deletedTrue_listsOnlyDeletedSortedWithActorAndTotal`. Also assert the default list excludes deleted groups
      - `test_restoreGroup_admin_returns204AndGroupReadableAgain`, with extra asserts for non-admin → 403, live → 409 and unknown id → 404 in the same or a sibling test
    - In `tests/test_authorization_matrix.py`, add one parametrized test:
      - DELETE `/api/groups/x` → EDIT
      - POST `/api/groups/x/restore` → `("ADMIN",)`
      - POST `/api/leaderships` → `("ADMIN",)`
      - POST `/api/leaderships/x/end` → EDIT
      - The existing guards stay: GET `/api/groups/x` → READ, `/mine/attendances`, `/public/...`
      - Also assert that an ADMIN login token carries EDIT (L5)
  - [x] 3.2 Matrix (`app/core/authorization_matrix.py`, first match wins)
    - Widen `(_methods("PATCH"), r"^/api/groups/[^/]+$", EDIT)` to `_methods("PATCH", "DELETE")`, keeping its position after the `/mine` and `/public` rows
    - Insert `(_methods("POST"), r"^/api/groups/[^/]+/restore$", ("ADMIN",))` right after the `GET ^/api/groups/moderation$` ADMIN row, before the blanket GET READ and POST EDIT rows
    - Insert `(_methods("POST"), r"^/api/leaderships$", ("ADMIN",))` right before `POST ^/api/leaderships(/.*)?$` EDIT
  - [x] 3.3 `router/circles.py`: add `DELETE /api/groups/{group_id}` → 204 next to PATCH, template `router/terms.py:130-133`
    - `EditPrincipal`
    - `is_admin = "PERMISSION_ADMIN" in principal.authorities`
    - resolve the profile with `get_profile_by_principal`, catching `EntityNotFoundException` → `None` (M1, pattern `public_view.py:355-358`)
    - call `service.soft_delete_group`
  - [x] 3.4 `router/circles.py`: add `POST /api/groups/{group_id}/restore` → 204 with `ModerationPrincipal`, calling `service.restore_group`
  - [x] 3.5 `router/circles.py`: `GET /api/groups/moderation` gains `deleted: bool = False` and passes it through. It stays registered before `/{group_id}`
  - [x] 3.6 `router/leaderships.py`
    - `POST /api/leaderships` uses an ADMIN principal (`require_any("ADMIN")`), and the service is unchanged
    - `POST /api/leaderships/{id}/end` stays EDIT. It resolves the caller party id (M1 catch) and the `is_admin` flag, and passes them to `service.remove_leadership`
  - [x] 3.7 Check that each matrix row mirrors its route `Depends(require_any(...))` (security.md)
  - [x] 3.8 Run `uv run python -m pytest tests/test_group_soft_delete.py -q` and confirm that **both original red tests are now green, unchanged**
  - [x] 3.9 Ensure the route-layer tests pass
    - Run ONLY `uv run python -m pytest tests/test_group_soft_delete.py tests/test_groups_moderation.py tests/test_authorization_matrix.py -q`

**Acceptance Criteria:**
- Both pre-existing red tests pass without edits, and the new route, matrix and moderation tests pass
- DELETE: 204/403/404/409. Restore: 204/403/404/409. Moderation `?deleted=true` lists only deleted groups with a consistent total
- `POST /api/leaderships` is ADMIN only. End-leadership returns 403 for non-organizer non-admins
- The matrix order is verified by tests, and existing matrix guards stay green

---

### Task Group 4: Backend Read Isolation (Table A) and Keep-Live Switches (Table B1/B2)
**Dependencies:** 3
**Files to Modify:** src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/application/terms.py, src/backend/app/groups/application/term_item_listings.py, src/backend/app/groups/router/circles.py, src/backend/tests/test_group_soft_delete_reads.py
**Estimated Steps:** 9

- [x] 4.0 Complete read isolation
  - [x] 4.1 Write 8 focused read-path tests in `tests/test_group_soft_delete_reads.py`. Soft-delete through `DELETE` or by setting `row.deleted_at` directly. Each test covers one A-row cluster:
    - `test_peopleLeaderships_and_familyMemberships_excludeDeletedGroup` (A4, A5)
    - `test_postGroupsMine_afterDelete_doesNotReturnDeletedGroup` (A4 via `get_own_circle`; no 500)
    - `test_listGroups_and_publicOrganizerDirectory_excludeDeletedGroup` (A2, A10, including `/terms`)
    - `test_myAttendances_and_myPledges_excludeDeletedGroup` (A8, A9)
    - `test_termsModeration_itemsAndTotal_excludeDeletedGroup` (A7)
    - `test_termsByCircle_termById_neededItemsByTerm_createPledge_return404` (A6, A11, A12, A13)
    - `test_groupLeadershipLeadershipsMemberships_return404` (A14)
    - `test_pendingJoinRequestsInbox_excludesDeletedGroup` (A15 via A4)
  - [x] 4.2 Leadership and membership listings, CRITICAL (`repository.py`)
    - `list_active_leaderships_for_role_ids` (~:192) joins `Group` on `Leadership.to_group_id` and filters `Group.deleted_at.is_(None)`
    - Same for `list_active_memberships_for_role_ids` (~:235)
    - Check that the callers (`users/router.py:131`, `families/repository.py:86`, `_is_active_member`, `get_own_circle`, `list_my_pending_join_requests`) need no change
  - [x] 4.3 Other listing predicates (`repository.py`)
    - A7: `count_terms` and `list_terms_for_moderation` join `Group` and filter with the same predicate in both
    - A8: `list_my_attendances_joined`
    - A9: `list_my_pledges_joined`
    - A10: `_qualifying_owner_circles` (~:674), a single predicate covering the directory helpers
    - Leave `list_group_names` (B3) and `list_pending_join_requests_for_groups` (A15) unfiltered
  - [x] 4.4 Guards in `terms.py`
    - A11: `list_terms_with_counts` calls `get_group` first
    - A12: `list_needed_item_views` calls `get_term(term_id)`, and `get_needed_item_view` calls `get_term(item.term_id)`
    - A13: `get_needed_item` calls `get_term(needed_item.term_id)` after the existing deleted-item check. This blocks `create_pledge`, `list_pledges`, `fulfill_pledge` and `_require_needed_item_organizer` (L1: `fulfill_pledge` blocked on purpose)
  - [x] 4.5 Router guards (A14) in `router/circles.py`
    - `get_current_leadership` (~:319), `list_leaderships` (~:330) and `list_memberships_for_circle` (~:339) `await service.get_group(db, group_id)` first
    - Do NOT change the service-level `get_current_leadership` (it is used by `_is_active_organizer` and the slug resolver)
  - [x] 4.6 Keep-live switches in `term_item_listings.py`
    - B1: `_resolve_transaction_reservations_for_action` (~:962) → `get_term_any`
    - B2: `list_my_term_item_listings` (~:385) and `list_my_active_taken_term_item_listings` (~:400) → `get_term_any`. They still pass through `_require_term_eligibility`
    - All other `get_term` calls (:440/:468/:480/:600/:715) stay filtered
  - [x] 4.7 Confirm with grep that `sync_pledge_fulfillment`, `list_swap_proposals_for_my_item`, `withdraw_*`, `reject_swap_proposal`, `end_membership`, `term_end_scan` and `circulation find_reservation_term` do not route through the filtered getters (L1, B3, B4, B6). Make no code changes there
  - [x] 4.8 Run the domain-clock guard `tests/test_domain_clock_guard.py` (no `datetime.now()`/`date.today()` added under `app/groups/application` and `app/groups/router`)
  - [x] 4.9 Ensure the read-isolation tests pass
    - Run ONLY `uv run python -m pytest tests/test_group_soft_delete_reads.py tests/test_domain_clock_guard.py tests/test_group_soft_delete.py -q`

**Acceptance Criteria:**
- The 8 read-path tests pass, so every A-row returns 404 or omits the deleted group
- Count queries share the list predicate (A3, A7)
- Explicit predicates only, with no global ORM filter (`with_loader_criteria` is not used)
- The B1/B2 switch is in place, and the other `get_term` call sites stay filtered

---

### Task Group 5: Backend Keep-Live Regression (Table B + L1)
**Dependencies:** 4
**Files to Modify:** src/backend/tests/test_group_soft_delete_keep_live.py
**Estimated Steps:** 4

- [x] 5.0 Prove the keep-live paths still work for a deleted group
  - [x] 5.1 Write 6 focused tests in `tests/test_group_soft_delete_keep_live.py`. Reuse the helpers and fixtures from the existing listing, transaction and term-end-scan tests:
    - `test_confirmOrCancelTransaction_onDeletedGroupTerm_stillResolves` (B1)
    - `test_mineAsTakerAndMineListings_onDeletedGroupTerm_stillAnswer` (B2)
    - `test_withdrawAttendance_onDeletedGroup_succeeds` (B4); also `withdraw_pledge`/GET `/api/pledges/{id}` if cheap
    - `test_scanForTermEnded_deletedGroupTerm_stillProcessed` (B3)
    - `test_syncPledgeFulfillment_onDeletedGroup_stillWorks` (L1)
    - `test_listSwapProposalsForMyItem_onDeletedGroup_stillAnswers` (L1)
  - [x] 5.2 If any keep-live test fails, fix it only by switching that call site to `get_term_any`/`get_group_including_deleted`. Record any such change in the work log (it widens Table B)
  - [x] 5.3 Re-run the Group 4 read tests to make sure no fix in 5.2 re-opened an A-row
  - [x] 5.4 Ensure the keep-live tests pass
    - Run ONLY `uv run python -m pytest tests/test_group_soft_delete_keep_live.py tests/test_group_soft_delete_reads.py -q`

**Acceptance Criteria:**
- All 6 keep-live tests pass, and the Group 4 tests stay green
- Any extra escape-hatch usage is justified and logged

---

### Task Group 6: Frontend API Module and Moderation Hook
**Dependencies:** None (API contract fixed in spec; tests mock the API, so this group can run in parallel with Groups 1-5)
**Files to Modify:** src/frontend/src/api/groups.ts, src/frontend/src/hooks/useModerationGroups.ts, src/frontend/src/test/useModerationGroups.test.tsx
**Estimated Steps:** 5

- [x] 6.0 Complete the API and hook layer
  - [x] 6.1 Write 3 focused tests in `src/test/useModerationGroups.test.tsx`, with explicit `vitest` imports, `vi.mock("../api/groups")` and `createQueryWrapper`:
    - `requests getGroupsForModeration(page, deleted) and keys by deleted`: switching `deleted` refetches with `(1, true)`
    - `restore calls restoreGroup and invalidates the moderationGroups prefix`
    - `restore rethrows extractProblemMessage(err)`
  - [x] 6.2 `api/groups.ts`
    - add `deleteGroup(id)` → `api.delete(\`/groups/${id}\`)` and `restoreGroup(id)` → `api.post(\`/groups/${id}/restore\`, undefined)`
    - `getGroupsForModeration(page, deleted = false)` appends `deleted=true` only when it is true
    - `ModerationGroupResponse` gains `deleted_at: string | null`, `deleted_by_name: string | null`
  - [x] 6.3 `hooks/useModerationGroups.ts`
    - signature `useModerationGroups(page, deleted)`, key `["moderationGroups", deleted, page]`
    - add a `restore(groupId)` callback following the `useModerationPhotos.remove` template: `throw new Error(extractProblemMessage(err))` on failure, then `await queryClient.invalidateQueries({ queryKey: ["moderationGroups"] })`
    - otherwise the return shape is unchanged, with a stable empty fallback (data-fetching.md)
  - [x] 6.4 Update the existing callers to pass `deleted` (AdminGroupsPage is finished in Group 9; keep it compiling with `false` for now)
  - [x] 6.5 Ensure the hook tests pass
    - Run ONLY `npx vitest run src/test/useModerationGroups.test.tsx`
    - Run `npx tsc -p tsconfig.app.json --noEmit`

**Acceptance Criteria:**
- The 3 hook tests pass, and `tsc` is clean
- The query key has the prefix first, then the params. The mutation awaits invalidation of the whole prefix

---

### Task Group 7: Panel DeleteGroupDialog Component
**Dependencies:** None (pure presentational component; can run in parallel with Group 6)
**Files to Modify:** src/frontend/src/pages/panel/DeleteGroupDialog.tsx, src/frontend/src/test/DeleteGroupDialog.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:delete-group-dialog
  locator: "Mockup 2: DeleteGroupDialog, default state" (anchor #delete-group-dialog, lines ~78-115)
  acceptance: `fixed inset-0 z-[70] bg-scrim px-4` scrim; card `max-w-[340px] rounded-[24px] bg-paper p-5`; `role="alertdialog" aria-modal="true"`, aria-labelledby title `Usunąć grupę „{name}”?`, aria-describedby body `Grupa zniknie dla uczestników. Jeśli to pomyłka, napisz do nas — przywrócimy ją.` ("napisz do nas" is plain text); button order `Anuluj` (border-line bg-cream, initial focus) then `Usuń grupę` (bg-danger text-paper, min-h-[44px]); Esc on the dialog element (ignoring `defaultPrevented`) and a scrim click both cancel; Tab/Shift+Tab trapped via `trapFocus`; `useRegisterOpenSheet(true)`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:delete-group-dialog-busy
  locator: "Mockup 3: DeleteGroupDialog, busy state" (anchor #delete-group-dialog-busy, lines ~116-137)
  acceptance: danger button label becomes `Usuwanie…` in place; both buttons disabled; `aria-busy="true"` on the danger button; Esc and scrim ignored while busy; focus moves to the dialog container (`tabIndex={-1}`) when the focused button becomes disabled
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:delete-group-dialog-error
  locator: "Mockup 4: DeleteGroupDialog, inline error" (anchor #delete-group-dialog-error, lines ~138-179)
  acceptance: `<p role="alert" className="text-sm font-semibold text-danger">` placed between the body and the buttons; shows the rejected `onConfirm` Error message verbatim; dialog stays open; the error clears on retry; focus returns to `Anuluj` after the error appears
**Estimated Steps:** 5

- [x] 7.0 Complete DeleteGroupDialog
  - [x] 7.1 Write 4 focused tests in `src/test/DeleteGroupDialog.test.tsx` (explicit vitest imports):
    - `focuses Anuluj initially and renders the title and body copy`
    - `Esc and Anuluj call onClose`
    - `confirm shows Usuwanie… with both buttons disabled while pending`, using a deferred promise
    - `rejected onConfirm shows role=alert message and keeps dialog open`
  - [x] 7.2 Create `pages/panel/DeleteGroupDialog.tsx` by cloning `pages/organizer/editor/UnsavedChangesDialog.tsx`
    - props `{ group: GroupResponse; onConfirm: () => Promise<void>; onClose: () => void }`
    - local `busy` and `error` state
    - copy and classes per the Visual References
  - [x] 7.3 Add keyboard and focus behavior
    - `trapFocus` from `components/krag/trapFocus.ts`
    - `useRegisterOpenSheet(true)` from `components/shared/openSheets.ts`
    - Esc on the dialog element, ignoring `defaultPrevented` events
    - focus on the container when busy, and back to `Anuluj` after an error
  - [x] 7.4 Check against accessibility.md: modal sheet rules, unique ids for `aria-labelledby`/`aria-describedby`, and 44px touch targets
  - [x] 7.5 Ensure the dialog tests pass
    - Run ONLY `npx vitest run src/test/DeleteGroupDialog.test.tsx`

**Acceptance Criteria:**
- The 4 dialog tests pass
- Implementation matches each `acceptance` criterion declared in the Visual References (default, busy and error states)

---

### Task Group 8: Panel Integration (SpotkaniaView trash, PanelDataContext delete + resilient load)
**Dependencies:** 6, 7
**Files to Modify:** src/frontend/src/pages/panel/views/SpotkaniaView.tsx, src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/api/groups.ts, src/frontend/src/test/PanelPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:delete-group-trigger
  locator: "Mockup 1: Spotkania view, trash trigger" (anchor #delete-group-trigger, lines ~42-77)
  acceptance: the trash button keeps its aria-label `Usuń grupę {name}`, classes and icon; adds `aria-haspopup="dialog"`; `onClick` opens `DeleteGroupDialog` for that group (never calls `endLeadership`), stores the opener element, and renders the dialog inside `SpotkaniaView` (organizer theme scope); on close focus returns to the opener
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:panel-spotkania-after-delete
  locator: "Mockup 5: Spotkania view after a successful delete" (anchor #panel-spotkania-after-delete, lines ~180-228)
  acceptance: after success the dialog closes, toast `Usunięto grupę` is shown, the tile disappears, the `Grupy · N` count updates; focus falls back to `main[tabindex=-1]` because the opener is gone; empty state `Nie masz jeszcze żadnej grupy.` (or the guest variant when no active leadership remains)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:delete-group-dialog-error
  locator: "Mockup 4" (anchor #delete-group-dialog-error, lines ~138-179)
  acceptance: the 409 server message reaches the dialog verbatim through `handleRemoveGroup` rethrowing `new Error(serverMessageOr(err, "Nie udało się usunąć grupy. Spróbuj ponownie."))` (403 → `ACCESS_DENIED_MESSAGE`); no toast on failure; closing the dialog after a failed attempt calls `load()`
**Estimated Steps:** 7

- [x] 8.0 Complete panel integration
  - [x] 8.1 Update `src/test/PanelPage.test.tsx` and write 5 focused tests:
    - First, add `deleteGroup: vi.fn()` to the `../api/groups` mock (L6). Drop `endLeadership` from it once the API function is removed
    - `trash opens the delete dialog`
    - `confirm calls deleteGroup (not endLeadership) and shows Usunięto grupę`
    - `cancel calls nothing`
    - `409 message is shown inline in the dialog`
    - `load survives a 404 from getGroup (and from getTerms/getNeededItems) for one group`
  - [x] 8.2 `PanelDataContext.handleRemoveGroup(groupId): Promise<void>`
    - `await deleteGroup(groupId)` → `showToast("Usunięto grupę")` → `await load()`
    - on failure, rethrow `new Error(serverMessageOr(err, "Nie udało się usunąć grupy. Spróbuj ponownie."))`
    - no shared `busy`, no `endLeadership`, and drop that import
  - [x] 8.3 `PanelDataContext.load()` (L4): add one local helper used by both the organizer (~442) and guest (~448-450) `Promise.all` sites
    - `hasStatus(err, 404)` → skip that group, including its follow-up `getTerms`/`getNeededItems` data
    - any other error is rethrown
  - [x] 8.4 `SpotkaniaView.tsx`: trash `onClick` sets the `pendingDeleteGroup` and the opener ref, and adds `aria-haspopup="dialog"`
    - render `<DeleteGroupDialog>` inside the view
    - `onClose` returns focus to the opener, falling back to `main[tabindex=-1]`
    - after a failed attempt followed by close, call `load()`
  - [x] 8.5 Remove `endLeadership` and `assignLeadership` (plus `AssignLeadershipRequest` if then unused) from `api/groups.ts`: grep shows no remaining callers outside PanelDataContext. Keep `LeadershipResponse` if still referenced
  - [x] 8.6 Run `npx tsc -p tsconfig.app.json --noEmit`
  - [x] 8.7 Ensure the panel tests pass
    - Run ONLY `npx vitest run src/test/PanelPage.test.tsx src/test/DeleteGroupDialog.test.tsx`
    - Compare against the known pre-existing PanelPage failures on main (see Group 10). New failures are not acceptable

**Acceptance Criteria:**
- The 5 new panel tests pass, and no PanelPage test that passed on main now fails
- The trash never calls `endLeadership`, and `load()` survives a single deleted group
- Implementation matches each `acceptance` criterion declared in the Visual References

---

### Task Group 9: Admin Groups Page (Active/Deleted toggle + Restore)
**Dependencies:** 6
**Files to Modify:** src/frontend/src/pages/AdminGroupsPage.tsx, src/frontend/src/components/moderation/DeletedGroupRow.tsx (or inline in the page file), src/frontend/src/test/AdminGroupsPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-groups
  locator: "Mockup 6: Admin Groups, Active view" (anchor #admin-groups-active, lines ~229-260)
  acceptance: `HStack role="group" aria-label="Group status"` with `Active` / `Deleted` Buttons using `aria-pressed` and solid/outline variants (template `PhotoModerationPage` `STATUS_FILTERS`); the toggle renders above the loading/error/empty branches; changing it resets the page to 1; the Active table columns are unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-groups-deleted
  locator: "Mockup 7: Admin Groups, Deleted view" (anchor #admin-groups-deleted, lines ~261-301)
  acceptance: column order Name / Organizer / Members / Terms / Created / Deleted at / Deleted by / Actions; "Deleted at" formatted `DD.MM.YYYY HH:mm` via `dayjs` from `utils/dayjs`; "Deleted by" shows the name or italic `Unknown` when null; a **visible** "Actions" header (L2, headers unique, `AdminTable` unchanged); footer `Showing N of M deleted circle(s)`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:admin-group-restore-button
  locator: "Mockup 7" Actions cell (anchor #admin-groups-deleted, lines ~261-301)
  acceptance: `Button size="sm"` with `aria-label="Restore {name}"`, no confirm; busy label `Restoring…` (disabled); on error `Text role="alert" fontSize="13px" color="red.500"` in the cell with the server message verbatim; on success the row leaves the Deleted list (prefix invalidation) and focus moves to the "Deleted" filter button; per-row busy/error state lives in `DeletedGroupRow`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-groups-deleted-empty
  locator: "Mockup 8: Admin Groups, Deleted view, empty and other states" (anchor #admin-groups-deleted-empty, lines ~302-326)
  acceptance: `EmptyState title="No deleted circles"` in Deleted mode; the existing `Loading...` and `Error: {message}` states are unchanged, and the toggle stays visible in all three
**Estimated Steps:** 6

- [x] 9.0 Complete the admin page
  - [x] 9.1 Update `src/test/AdminGroupsPage.test.tsx` and write 4 focused tests
    - First, change the existing call assertions `(1)`/`(2)` → `(1, false)`/`(2, false)` (L6)
    - `toggling to Deleted requests getGroupsForModeration(1, true) and shows Deleted at / Deleted by / Actions columns`
    - `Restore calls restoreGroup and refetches`
    - `restore error shows role=alert in the row`
    - `Deleted empty state shows No deleted circles`
  - [x] 9.2 Add the toggle state `deleted` to `AdminGroupsPage.tsx`: it resets the page to 1 and passes `useModerationGroups(page, deleted)`. Render the toggle above the loading/error/empty branches
  - [x] 9.3 Deleted-mode columns and footer copy: the extra columns render only when `deleted`, with a visible "Actions" header, the `dayjs` format and the `Unknown` fallback
  - [x] 9.4 `DeletedGroupRow` restore cell (in `components/moderation/DeletedGroupRow.tsx` or a local component, modelled on `PhotoModerationCard`)
    - owns its `busy`/`error` state and calls the hook's `restore`
    - on success, focus moves to the Deleted toggle button (ref passed down)
  - [x] 9.5 Run `npx tsc -p tsconfig.app.json --noEmit`
  - [x] 9.6 Ensure the admin tests pass
    - Run ONLY `npx vitest run src/test/AdminGroupsPage.test.tsx`

**Acceptance Criteria:**
- The 4 new tests and the updated existing AdminGroupsPage tests pass
- English copy throughout, and server errors are shown verbatim
- Implementation matches each `acceptance` criterion declared in the Visual References

---

### Task Group 10: Test Review, Gap Analysis and Full-Suite Verification
**Dependencies:** All previous groups (1-9)
**Files to Modify:** src/backend/tests/test_group_soft_delete*.py, src/backend/tests/test_groups_moderation.py, src/frontend/src/test/DeleteGroupDialog.test.tsx, src/frontend/src/test/PanelPage.test.tsx, src/frontend/src/test/AdminGroupsPage.test.tsx (append-only, only if gaps found)
**Estimated Steps:** 10

- [x] 10.0 Review and fill critical gaps
  - [x] 10.1 Review the tests from Groups 1-9 (~45 tests). Map each spec A-row, B-row, requirement 1-20 and Audit Resolution M1-M3/L1-L6 to at least one test
  - [x] 10.2 Analyze gaps for this feature only. Likely candidates:
    - ADMIN without a `UserProfile` deletes → `deleted_by_party_id NULL`, and the admin list shows `Unknown` (M1)
    - ADMIN ending a leadership on any group (M1/M2)
    - PATCH on a deleted group → 404
    - public `/rsvp` on a deleted group → 404
    - join-request create on a deleted group → 404
    - `fulfill_pledge` on a deleted group → 404 (L1)
  - [x] 10.3 Write up to 10 additional strategic tests, only for the gaps found
  - [x] 10.4 Run all feature-specific tests:
    - `uv run python -m pytest tests/test_group_soft_delete.py tests/test_group_soft_delete_service.py tests/test_group_soft_delete_reads.py tests/test_group_soft_delete_keep_live.py tests/test_group_soft_delete_migration.py tests/test_groups_moderation.py tests/test_authorization_matrix.py tests/test_group_join_requests_router.py tests/test_domain_clock_guard.py -q`
    - `npx vitest run src/test/DeleteGroupDialog.test.tsx src/test/PanelPage.test.tsx src/test/AdminGroupsPage.test.tsx src/test/useModerationGroups.test.tsx`
  - [x] 10.5 Full backend suite: `uv run python -m pytest -q` from `src/backend`. Any failure in groups, families, users, circulation or term-item-listing tests is a regression, since A4/A5/A6 change shared getters. Fix it or escalate
  - [x] 10.6 Backend static checks
    - `uv run python -m ruff check app tests` and `uv run python -m mypy app`
    - Compare against the HEAD baseline: mypy is around 32 errors at HEAD, and ruff has pre-existing errors on untouched lines
    - New errors on touched lines are not acceptable
    - Pre-existing errors on untouched lines are not to be fixed
  - [x] 10.7 Full frontend suite: `npx vitest run` from `src/frontend`
    - Known pre-existing failures on main: **11 tests** in PanelPage, auth, foundation, TermPage and extension-points
    - Record the exact failing test names before and after. Only those 11 may fail, and any new failure is a regression
  - [x] 10.8 `npx tsc -p tsconfig.app.json --noEmit` must be clean
  - [x] 10.9 Confirm the 2 original red tests in `tests/test_group_soft_delete.py` are byte-identical to the red-gate version (`git diff` on those functions shows only appended tests)
  - [x] 10.10 Suggest (do not apply) a standards update: `standards/backend/models.md` still says soft delete is not used. Propose it via `/maister:standards-update` in the work log

**Acceptance Criteria:**
- All feature tests pass (~45-60 total), with no more than 10 added in this group
- The full backend suite has no new failures. The full frontend suite has no failures beyond the 11 known pre-existing ones
- ruff and mypy are at or below the HEAD baseline, and tsc is clean
- Both original red tests pass unchanged

## Execution Order

1. Group 1: Database Layer (5 steps)
2. Group 2: Backend Domain Services and Getters (10 steps, depends on 1)
3. Group 3: Backend Routes, Matrix and Security (9 steps, depends on 2; turns the red tests green)
4. Group 4: Backend Read Isolation + B1/B2 switches (9 steps, depends on 3; shares repository.py, terms.py and router/circles.py with 2 and 3, so it runs serially)
5. Group 5: Backend Keep-Live Regression (4 steps, depends on 4)
6. Group 6: Frontend API + Hook (5 steps, no dependency; can run in parallel with Groups 1-5)
7. Group 7: DeleteGroupDialog (5 steps, no dependency; can run in parallel with Groups 1-6)
8. Group 8: Panel Integration (7 steps, depends on 6 and 7; shares `api/groups.ts` with 6)
9. Group 9: Admin Groups Page (6 steps, depends on 6; can run in parallel with 7 and 8, with no shared files)
10. Group 10: Test Review + Full Suites (10 steps, depends on all)

Critical path: 1 → 2 → 3 → 4 → 5 → 10. The frontend track (6 → 7/8/9) runs alongside it.

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- global/ (always applicable)
  - error-handling.md: typed 404/403/409 exceptions
  - validation.md
  - minimal-implementation.md: no global filter, no notifications, no confirm on restore; remove dead `endLeadership`/`assignLeadership`
  - coding-style.md, commenting.md, conventions.md
- backend/
  - models.md: nullable `DateTime()`, plain FK-id column, named constraint
  - migrations.md: `0056`, reversible, schema only
  - queries.md / jooq.md: bound params, shared count/list predicate, single `MIN` query
  - security.md: matrix rows mirror `require_any`, ownership checks in the service, first-match order tested
  - time.md: `datetime.utcnow()` for audit fields, `clock.local_now()` via the module attribute, `clock.format_term_day`, `freeze_local_now`
  - api.md: 204 responses and a query flag on the existing collection
- frontend/
  - accessibility.md: alertdialog, trap, Esc, focus return with `main[tabindex=-1]` fallback, `useRegisterOpenSheet`, `aria-pressed`, `role="alert"`
  - data-fetching.md: prefix-first keys, awaited prefix invalidation, `extractProblemMessage`, `dayjs` from `utils/dayjs`
  - css.md / components.md: Tailwind tokens in the panel, Chakra props in the admin, single-responsibility dialog and row
- testing/
  - backend-testing.md: integration-first, `test_action_condition_expected` naming, testcontainers PG
  - frontend-testing.md: explicit vitest imports, `createQueryWrapper`, `vi.mock` factories with `vi.resetAllMocks()`, files in `src/test/`

## Notes

- Test-driven: each group starts with 2-8 tests. The exception is Group 3, whose red tests already exist and are kept unchanged.
- Run incrementally: after each group, run only the new and touched tests. The full suites run only in Group 10.
- Mark progress: check off steps as they complete.
- Reuse first: `soft_delete_needed_item`, `find_item_including_deleted`, `_is_active_organizer`, `UnsavedChangesDialog`, `PhotoModerationPage`/`PhotoModerationCard`, `useModerationPhotos.remove` and the existing test helpers (`_register_organizer`, `_auth_headers`, `_create_circle_with_term`, `_authed_headers`, `_grant_admin_and_relogin`).
- Line numbers in the spec may drift (L7). Locate functions by name.
- Secrets: never print secret values in any step or subagent output.
