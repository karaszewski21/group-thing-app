# Implementation Plan: PRIVATE group term access requests (B13 + B14)

## Overview
Total Steps: 75
Task Groups: 11 (10 implementation + 1 test review / full-suite gate)
Expected Tests: ~62-80 new or rewritten. That is 2-8 new tests per implementation group plus up to 10 gap tests, together with about 19 rewritten existing backend tests and the 5 TDD red-gate tests. The count is above the usual 16-34 because the spec lists new behaviour on both backend and frontend and requires specific rewrites (spec "Testing approach").

Primary input: `implementation/spec.md` (R1-R16, Decision Record S-1..S-6, audit resolutions M-1, M-2, m-1..m-11).
Binding design input: `analysis/design-context/INDEX.md` + `analysis/design-context/ascii/ui-mockups.md` (coverage: `implementation/visual-coverage.md`).

Paths below are relative to the repo root. Backend commands run in `src/backend`, frontend commands in `src/frontend`.

**TDD red gate (must go green):** `uv run pytest -q tests/test_private_group_access_defects.py`. Red tests 3 and 4 (B14) go green in Group 1. Red tests 1 and 2 (B13) go green in Group 2, and test 5 (privacy guard) must stay green throughout. Every backend group re-runs this file together with its own tests.

## Implementation Steps

### Task Group 1: Backend B14 — remove self-join paths + shared membership helper + test seeding rewrites
**Dependencies:** None
**Files to Modify:** src/backend/app/groups/application/memberships.py, src/backend/app/groups/router/memberships.py, src/backend/app/groups/router/circles.py, src/backend/app/groups/application/public_view.py, src/backend/app/groups/schemas.py, src/backend/app/groups/service.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_circles_router.py, src/backend/tests/test_exchange_summary.py, src/backend/tests/test_group_privacy.py, src/backend/tests/test_add_active_membership.py
**Estimated Steps:** 8

- [x] 1.0 Complete B14 removal and R6 helper
  - [x] 1.1 Write 2-3 focused tests in `tests/test_add_active_membership.py`
    - `test_addActiveMembership_newParty_createsActiveMemberRoleAndMembership`: `valid_from=today`, `valid_to=None`, MEMBER group role reused or created, and no commit inside the helper (the caller commits)
    - `test_formalizeGroupFromTerm_afterRefactor_createsMemberships`: regression through the existing formalize path
    - Import only from `app.groups.service`
  - [x] 1.2 Add `add_active_membership(db, group_id, party_id) -> Membership` to `application/memberships.py` (R6)
    - Body: `get_or_create_active_group_role(MEMBER)`, then `Membership(valid_from=today, valid_to=None)`, then `db.flush()`, with no commit
    - Refactor the `formalize_group_from_term` loop (memberships.py ~L149-158) to call it. The caller keeps the "already a member" check.
    - Re-export it via `service.py` (import + `__all__`)
  - [x] 1.3 Rewrite the test seeding helpers **before** deleting the endpoints (spec "Required rewrites")
    - `tests/test_circles_router.py` `_join_group_as_family_guardian` (L52-65) and `tests/test_exchange_summary.py` `_join_group_as_family_guardian` (L66-83), plus the direct `POST /api/memberships` at L313
    - Each helper gains a `db_session: AsyncSession` parameter. It resolves the registered user's party (for example a `UserProfile` lookup), calls `add_active_membership`, then flushes and commits per conftest SAVEPOINT semantics.
    - Every affected test function adds the `db_session` fixture parameter and passes it through
  - [x] 1.4 Delete `POST /api/memberships`
    - the route in `router/memberships.py` L25-33
    - `create_membership` in `application/memberships.py` L23-39
    - `CreateMembershipRequest` in `schemas.py`
    - the `service.py` import and `__all__` entry
    - the module docstring of `router/memberships.py` ("create / end" → "end")
    - Keep `POST /api/memberships/{id}/end` and matrix row #31
  - [x] 1.5 Delete `POST /api/groups/public/{id}/join`
    - the route in `router/circles.py` L166-186
    - `join_private_group` in `public_view.py` L452-506
    - `JoinGroupRequest` / `JoinGroupResponse`
    - the `service.py` entries
    - the stale `schemas.py` L2 docstring
    - the `/join` matrix row and its comment (`authorization_matrix.py` L95-101). Leave its slot, before blanket row 27, for the join-requests row that Group 4 adds.
  - [x] 1.6 Remove the `/join` tests
    - `test_circles_router.py` L191-279, plus the `resolve_requirement` import if it becomes unused
    - `test_group_privacy.py` L216-245, plus its NOTE/docstring
  - [x] 1.7 Run `ruff check` / `mypy` on the touched modules and fix any dangling imports
  - [x] 1.8 Ensure Group 1 tests pass
    - `uv run pytest -q tests/test_add_active_membership.py tests/test_circles_router.py tests/test_exchange_summary.py tests/test_group_privacy.py tests/test_private_group_access_defects.py`
    - Do NOT run the entire suite

**Acceptance Criteria:**
- Red tests `test_createMembership_outsiderSelfJoinsPrivateGroup_isNotPossible` and `test_joinPrivateGroup_outsiderWithoutApproval_isNotPossible` pass (404/405, no membership created). Red test 5 still passes.
- The 2-3 new helper tests pass, and the 3 + 8 rewritten tests in `test_circles_router.py` / `test_exchange_summary.py` pass without using any removed endpoint
- `grep -rn "create_membership\|join_private_group\|JoinGroupRequest\|CreateMembershipRequest" src/backend/app` returns nothing
- `/api/memberships/{id}/end` still works, and row #31 is unchanged

---

### Task Group 2: Backend B13 — member/organizer content from `/access`
**Dependencies:** 1 (shares `public_view.py`, `service.py`)
**Files to Modify:** src/backend/app/groups/application/public_view.py, src/backend/tests/test_group_access.py
**Estimated Steps:** 5

- [x] 2.0 Complete B13 fix
  - [x] 2.1 Write 2-4 focused tests in `tests/test_group_access.py`
    - `test_getGroupAccess_privateMember_returnsFullContentAndIsAttending`: seed a member with `add_active_membership`, RSVP, and assert `next_term` is populated and `is_attending` is true
    - `test_getGroupAccess_privateMemberForeignTermId_returns404`: a term of another group
    - `test_getPublicCircleView_privateGroup_staysReducedForMember`: `GET /api/groups/public/{id}` stays reduced
  - [x] 2.2 `get_public_circle_view` gains `include_private_content: bool = False` (R2)
    - The reduced PRIVATE branch runs only when the flag is false
    - When the flag is true, validate `term_id`: an unknown term or another group's term raises `EntityNotFoundException` (404)
    - When the flag is false, do no `term_id` validation for PRIVATE (the reduced 200 must not reveal whether a term exists)
  - [x] 2.3 Reorder `get_group_access`
    1. Resolve the profile, `is_organizer` and `is_member` first
    2. Build the view with `include_private_content = is_member or is_organizer`
    3. Drop its own `get_group` call (L303) and read `group_response.visibility` from the view (single group load, audit m-5)
    - An invalid or expired token degrades to anonymous. PENDING or REJECTED requests never unlock content.
  - [x] 2.4 Leave `can_join` in place for now (Group 6 replaces it with `join_request`). Update only the flag-related docstrings.
  - [x] 2.5 Ensure the tests pass: `uv run pytest -q tests/test_group_access.py tests/test_private_group_access_defects.py`

**Acceptance Criteria:**
- All 5 red-gate tests pass (1 and 2 turn green here; 5 stays green)
- The 2-4 new tests pass. Existing `test_group_access.py` tests still pass (the `can_join` asserts are unchanged until Group 6).
- The outsider/anonymous PRIVATE response is unchanged (reduced, 200, even for a wrong `term_id`)

---

### Task Group 3: Backend data layer — `GroupJoinRequest` entity, migrations 0037/0038, notification pointer and kinds
**Dependencies:** None
**Files to Modify:** src/backend/app/groups/models.py, src/backend/alembic/versions/0037_group_join_requests.py, src/backend/alembic/versions/0038_notification_join_request_id.py, src/backend/app/notifications/models.py, src/backend/app/notifications/schemas.py, src/backend/app/notifications/service.py, src/backend/app/groups/infrastructure/notifications_bridge.py, src/backend/tests/test_group_join_request_model.py
**Estimated Steps:** 8

- [x] 3.0 Complete join-request persistence layer
  - [x] 3.1 Write 3-5 focused tests in `tests/test_group_join_request_model.py` (template `tests/test_swap_proposal_model.py`)
    - A second PENDING row for the same (requester, group) raises `IntegrityError` (partial unique index)
    - A new PENDING row is allowed after REJECTED and after WITHDRAWN
    - Every `NotificationKind` value is ≤ 30 characters (covers the 3 new kinds)
    - `Notification.join_request_id` round-trips through `notifications.service.create_notification`
  - [x] 3.2 Add `GroupJoinRequestStatus` (PENDING, APPROVED, REJECTED, WITHDRAWN) and `GroupJoinRequest(BaseEntity)` to `app/groups/models.py` (R3)
    - Table `group_join_requests`, sequence `group_join_request_seq`
    - Columns: `group_id`, `requester_party_id`, `term_id` (nullable), and `status` via `_enum_column(GroupJoinRequestStatus, 20)`
    - Plain FK-id columns and no `relationship()`. The partial index is **not** in `__table_args__` (pledges precedent, audit m-7).
  - [x] 3.3 Rewrite the `GroupVisibility` docstring (models.py L74-84) to describe the request/approve flow
  - [x] 3.4 Migration `0037_group_join_requests.py` (`revision="0037"`, `down_revision="0036"`)
    - Explicit sequence via the `0031` helpers
    - `pk_group_join_requests`
    - 3 named FKs: `fk_group_join_requests_group_id_groups`, `..._requester_party_id_parties`, `..._term_id_terms`
    - `ix_group_join_requests_group_id`
    - Partial unique index `uq_group_join_requests_pending_requester_group` on `(requester_party_id, group_id) WHERE status = 'PENDING'` (template `0023` L51-57)
    - Reversible downgrade: `OWNED BY NONE`, drop table, drop sequence
  - [x] 3.5 Migration `0038_notification_join_request_id.py` (`down_revision="0037"`, template `0032`)
    - Nullable `join_request_id BIGINT` on `notifications`, with no FK
    - Reversible
  - [x] 3.6 Notifications (R4)
    - Add `GROUP_JOIN_REQUESTED`, `GROUP_JOIN_APPROVED`, `GROUP_JOIN_REJECTED` to `NotificationKind`, and update the kind docstring to name the recipients
    - Add `Notification.join_request_id` and `NotificationResponse.join_request_id: int | None = None`
    - `notifications.service.create_notification` and `notifications_bridge.create_notification` gain an optional `join_request_id` pass-through
  - [x] 3.7 Verify the migrations: `uv run alembic upgrade head`, then `uv run alembic downgrade 0036`, then `uv run alembic upgrade head` against the dev DB (Success Criterion 5)
  - [x] 3.8 Ensure the tests pass: `uv run pytest -q tests/test_group_join_request_model.py tests/test_notifications.py`

**Acceptance Criteria:**
- The 3-5 new tests pass, and the existing `test_notifications.py` still passes
- Migrations 0037 and 0038 apply and downgrade cleanly to 0036
- The model follows `standards/backend/models.md` (explicit sequence, string enum, `updated_at` version column)

---

### Task Group 4: Backend requester lifecycle — create / withdraw use cases, public routes, matrix row
**Dependencies:** 1, 3
**Files to Modify:** src/backend/app/groups/application/join_requests.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/router/join_requests.py, src/backend/app/groups/router/__init__.py, src/backend/app/groups/schemas.py, src/backend/app/groups/service.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_group_join_requests_router.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 8

- [x] 4.0 Complete requester side of the request lifecycle
  - [x] 4.1 Write up to 8 focused tests in `tests/test_group_join_requests_router.py` (httpx `client`, per-file helpers, organizer seeded via existing circle creation)
    - `test_createJoinRequest_anonymous_returns401`
    - `test_createJoinRequest_publicGroup_returns404`
    - `test_createJoinRequest_success_returns201PendingAndNotifiesOrganizer`: `GROUP_JOIN_REQUESTED` with `join_request_id` and term `link_path` `/{slug}/grupa/{gid}/term/{tid}`
    - `test_createJoinRequest_duplicate_returnsSameIdWithoutSecondNotification` (S-3)
    - `test_createJoinRequest_memberOrOrganizer_returns409`
    - `test_createJoinRequest_foreignTermId_returns404`
    - `test_withdrawJoinRequest_stranger_returns403`
    - `test_withdrawJoinRequest_owner_setsWithdrawnWithoutNotification`, which also asserts that a second withdraw returns 409
    - Also add parametrized `resolve_requirement` cases to `tests/test_authorization_matrix.py`:
      - create and withdraw → AUTHENTICATED
      - `GET /api/groups/mine/join-requests` and `GET /api/groups/{gid}/join-requests` → READ
      - approve and reject → EDIT
      - the old `/join` path → falls to row 27
      - `/api/memberships/{id}/end` → unchanged
  - [x] 4.2 Schemas in `schemas.py` (R7)
    - `CreateJoinRequestRequest { term_id: int | None = None }`
    - `JoinRequestResponse` (`from_attributes`, modelled on `SwapProposalResponse`)
    - `PendingJoinRequestResponse`
    - `JoinRequestSummary { id, status: Literal["PENDING","REJECTED"] }`
  - [x] 4.3 Repository functions in `infrastructure/repository.py`: get request by id, get the PENDING request for (requester, group), get the latest request for (requester, group) by highest id, and insert. Repositories never commit.
  - [x] 4.4 `application/join_requests.py`: `create_join_request` implementing the R5 checks in order
    1. Account profile via `get_profile_by_principal`, else 401
    2. The group exists and is PRIVATE, else 404
    3. The term belongs to the group, else 404
    4. Not the organizer and not a member (`_is_active_organizer` / `_is_active_member`), else 409 „Masz już dostęp do tej grupy”
    5. An active organizer exists, else 409 „Ta grupa nie ma teraz organizatora”
    6. An existing PENDING request is returned as-is
    7. Insert inside `begin_nested()` with the `IntegrityError` → re-select fallback (template `circulation/application/inventory.py` L40-64)
    8. Stage the `GROUP_JOIN_REQUESTED` notification only after the savepoint insert and flush succeed (m-6). The notification carries the Polish message and a `link_path` from `slug_resolver.resolve_organizer_slug`, or `/panel` when there is no term. The fallback path stages no notification.
    - End with a single trailing commit
  - [x] 4.5 `withdraw_join_request`
    - Request in the group, else 404
    - The caller is the requester, else 403
    - Status is PENDING, else 409 „Ta prośba została już rozstrzygnięta”
    - Result: WITHDRAWN, no notification, one commit
  - [x] 4.6 New router `router/join_requests.py`
    - `POST /api/groups/public/{group_id}/join-requests` (201, `require_any()`)
    - `POST /api/groups/public/{group_id}/join-requests/{request_id}/withdraw` (200, `require_any()`)
    - Register it in `router/__init__.py` after `circles`
    - Routers import only `app.groups.service`. Re-export the use cases in `service.py`.
  - [x] 4.7 Matrix (R8): insert `POST ^/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?$` → AUTHENTICATED in the old `/join` slot, before blanket row 27, with a comment explaining the ordering. Update the `/access` row comment (`can_join` → `join_request`).
  - [x] 4.8 Ensure the tests pass: `uv run pytest -q tests/test_group_join_requests_router.py tests/test_authorization_matrix.py tests/test_private_group_access_defects.py`

**Acceptance Criteria:**
- The up-to-8 router tests and the new matrix cases pass
- A duplicate create never yields "Data integrity violation", and the idempotent path returns 201 with the same id
- Backend layering: the router imports only `app.groups.service`, and the application layer uses repository functions

---

### Task Group 5: Backend organizer decisions — approve / reject, pending lists, StaleDataError → 409
**Dependencies:** 4
**Files to Modify:** src/backend/app/groups/application/join_requests.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/router/join_requests.py, src/backend/app/groups/service.py, src/backend/app/core/errors.py, src/backend/tests/test_group_join_requests_decisions.py, src/backend/tests/test_stale_data_error_handler.py
**Estimated Steps:** 7

- [x] 5.0 Complete organizer side of the lifecycle
  - [x] 5.1 Write up to 8 focused tests in `tests/test_group_join_requests_decisions.py`, plus 1 in `tests/test_stale_data_error_handler.py`
    - `test_approveJoinRequest_organizer_createsMembershipSetsApprovedAndNotifiesRequester` (`GROUP_JOIN_APPROVED`, term `link_path`, `join_request_id`)
    - `test_approveJoinRequest_requesterAlreadyMember_noDuplicateMembership`
    - `test_decideJoinRequest_secondDecision_returns409`
    - `test_rejectJoinRequest_organizer_setsRejectedAndNotifiesRequester` (`GROUP_JOIN_REJECTED`, S-5 term link)
    - `test_decideJoinRequest_nonOrganizer_returns403`
    - `test_decideJoinRequest_requestFromOtherGroupPath_returns404`
    - `test_listMyPendingJoinRequests_returnsOnlyOrganizedGroupsOldestFirstWithNames`; a non-organizer gets `[]`
    - `test_listGroupJoinRequests_organizer200OnlyPending_nonOrganizer403_unknown404` (S-1)
    - `test_staleDataError_handler_returns409WithPolishMessage`: a unit-level mapping test that registers a throwaway route raising `StaleDataError`
  - [x] 5.2 `approve_join_request` / `reject_join_request`
    - Request in the group, else 404
    - `_require_active_organizer` at action time, else 403
    - Status is PENDING, else 409
    - Approve adds a membership via `add_active_membership` only if `_is_active_member` is false, then sets APPROVED. Reject sets REJECTED.
    - Stage the requester notification with its Polish message, then one commit
    - Approve is still allowed after a switch to PUBLIC (decision 13)
  - [x] 5.3 `list_my_pending_join_requests`: `list_active_leaderships_for_party` group ids, then one PENDING-request query that joins the group names, then `repository.list_profile_names_by_party_ids` in batch, oldest first. There is no N+1.
  - [x] 5.4 `list_group_pending_join_requests`: group exists (404), `_require_active_organizer` (403), then the same repository query and name resolution scoped to one group
  - [x] 5.5 Routes in `router/join_requests.py`
    - Declare `GET /api/groups/mine/join-requests` (`ReadPrincipal`) **before** `GET /api/groups/{group_id}/join-requests`
    - `POST /api/groups/{group_id}/join-requests/{request_id}/approve|reject` (`EditPrincipal`, 200)
    - Re-export via `service.py`
  - [x] 5.6 R9: register a `sqlalchemy.orm.exc.StaleDataError` handler in `app/core/errors.py` `register_exception_handlers`. It returns 409 "Conflict" with „Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie” in the existing envelope `{status, error, message, field_errors}`.
  - [x] 5.7 Ensure the tests pass: `uv run pytest -q tests/test_group_join_requests_decisions.py tests/test_stale_data_error_handler.py tests/test_group_join_requests_router.py tests/test_private_group_access_defects.py`

**Acceptance Criteria:**
- The up-to-8 decision tests and the handler test pass
- `GET /api/groups/mine/join-requests` does not return 422 (route order correct)
- The pending list uses a constant number of queries regardless of the number of rows

---

### Task Group 6: Backend `/access` DTO — `join_request` replaces `can_join`
**Dependencies:** 2, 5
**Files to Modify:** src/backend/app/groups/application/public_view.py, src/backend/app/groups/schemas.py, src/backend/tests/test_group_access.py
**Estimated Steps:** 5

- [x] 6.0 Complete `/access` DTO change (R10)
  - [x] 6.1 Write 3-5 focused tests in `tests/test_group_access.py`
    - `test_getGroupAccess_requestLifecycle_joinRequestPendingThenRejectedThenNullAfterWithdraw`
    - `test_getGroupAccess_pendingOrRejectedCaller_nextTermIsNone` (privacy regression)
    - `test_getGroupAccess_approvedMember_fullContentAndRsvpReturns201`: approve, then RSVP 201, then `is_attending` true
    - `test_getGroupAccess_exMemberLatestApproved_joinRequestNull`
  - [x] 6.2 In `GroupAccessDetails`, drop `can_join` and add `join_request: JoinRequestSummary | None`. Update the docstrings.
  - [x] 6.3 In `get_group_access`, set `join_request` only when all of these hold:
    - the group is PRIVATE
    - the caller is identified and is neither a member nor the organizer
    - the caller's latest request (highest id) is PENDING or REJECTED
    - Otherwise it is null. There is no `can_join` shim.
  - [x] 6.4 Update the existing `test_group_access.py` asserts
    - 3 full-dict asserts: `can_join` → `join_request: None`
    - the anonymous PRIVATE `can_join=True` assert → `join_request is None`, keeping `next_term is None`
  - [x] 6.5 Ensure the tests pass: `uv run pytest -q tests/test_group_access.py tests/test_private_group_access_defects.py`, then `grep -rn can_join src/backend/app` returns nothing

**Acceptance Criteria:**
- The 3-5 new tests and the updated existing asserts pass. All 5 red-gate tests pass.
- PENDING/REJECTED callers and outsiders still get the reduced response

---

### Task Group 7: Frontend data layer — API modules, 401 returnTo, `useTermAccess` rewrite
**Dependencies:** None (the contract is fixed by spec R7/R10/R11; the backend is mocked in frontend tests)
**Files to Modify:** src/frontend/src/api/groups.ts, src/frontend/src/api/notifications.ts, src/frontend/src/api/client.ts, src/frontend/src/hooks/useTermAccess.ts, src/frontend/src/test/useTermAccess.test.ts, src/frontend/src/test/apiClient.test.ts
**Estimated Steps:** 6

- [x] 7.0 Complete frontend data layer
  - [x] 7.1 Write 5-6 focused tests
    - `src/test/useTermAccess.test.ts` (`renderHook`, `vi.mock("../api/groups")`):
      - a refetch error keeps `ready` with `refreshError`
      - out-of-order responses: the latest request wins
      - a token change gives `isStale` until the response arrives
      - a token-change fetch that fails leaves `ready`, `isStale === true` and `refreshError` set, and a later successful `refetch` clears both (M-1)
    - `src/test/apiClient.test.ts`: a 401 redirects to `/login?returnTo=<encoded pathname+search>` and does not redirect when already on `/login` (m-1)
  - [x] 7.2 `api/groups.ts`
    - Add the types `JoinRequestStatus`, `JoinRequestSummary`, `JoinRequestResponse`, `PendingJoinRequestResponse`, and `join_request` on `GroupAccessDetails`
    - Add the functions `createJoinRequest(groupId, termId?)`, `withdrawJoinRequest`, `listMyPendingJoinRequests`, `approveJoinRequest`, `rejectJoinRequest`
    - Remove `createMembership` and `CreateMembershipRequest`, and update the section comment
    - Leave `can_join` and `joinPrivateGroup*` for Group 8, which deletes their consumers in the same step
    - No frontend function for the per-group list (S-1)
  - [x] 7.3 `api/notifications.ts`: add the 3 kinds to `NotificationKind` and `join_request_id?: number | null` to `NotificationResponse`
  - [x] 7.4 `api/client.ts` L37-42: redirect to `/login?returnTo=${encodeURIComponent(pathname + search)}`, keeping the not-on-`/login` guard
  - [x] 7.5 Rewrite `hooks/useTermAccess.ts` per FSM §7.3
    - States: `loading | error{message} | ready{data, forToken, refreshError}`
    - A monotonic request-sequence ref
    - A refetch failure keeps `ready` and sets `refreshError`, including a token-change failure. Only a failed first load gives `error`.
    - Returns `{state, isStale, refetch}`, with `refetch` stable per `(groupId, termId, token)`
    - Keep existing consumers compiling: adapt the `TermPage` call site minimally if its shape changes (Group 8 owns the full switch)
  - [x] 7.6 Ensure the tests pass: `npx vitest run src/test/useTermAccess.test.ts src/test/apiClient.test.ts`

**Acceptance Criteria:**
- The 5-6 new tests pass
- `useTermAccess` never leaves the state in `loading` after a failed refetch or token-change fetch
- No frontend reference to `createMembership` remains

---

### Task Group 8: Frontend TermPage switch — `resolveTermAccess`, `PrivateGroupGate`, `RequestAccessDialog`
**Dependencies:** 7
**Files to Modify:** src/frontend/src/pages/krag/termAccess.ts, src/frontend/src/pages/krag/TermPage.tsx, src/frontend/src/pages/krag/PrivateGroupGate.tsx, src/frontend/src/pages/krag/PrivateGroupAccessDenied.tsx (delete), src/frontend/src/components/krag/RequestAccessDialog.tsx, src/frontend/src/components/krag/JoinPrivateGroupDialog.tsx (delete), src/frontend/src/components/krag/AuthGateSheet.tsx, src/frontend/src/api/groups.ts, src/frontend/src/test/termAccess.test.ts, src/frontend/src/test/TermPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-page-access-switch
  locator: "Mockup 1: TermPage access switch", lines 49-81
  acceptance: `loading` → `KragStageMessage` „Wczytywanie...”; `error` → „Nie znaleziono”; `view` → `PublicTermView` unchanged (also while `isStale`); gate + `isStale` + no `refreshError` → „Wczytywanie...”; gate + `isStale` + `refreshError` → `PrivateGroupGate stale`; the `visibility === "PRIVATE"` branch is removed
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:private-group-gate
  locator: "Mockup 2: PrivateGroupGate shell", lines 82-109
  acceptance: `KragStage` + `GroupHeader` (eyebrow „Krąg”, group name, „Prowadzi: …” / „Brak organizatora”, „← Wróć”) + exactly one `.kg-card` with `<h2>` „Ta grupa jest prywatna” and a decorative 🔒 `aria-hidden`; no term date, attendees, needed items or footer; dialog rendered in the `overlay` slot; `stale` mode shows only header + heading + `.kg-error role="alert"` „Nie udało się odświeżyć strony — spróbuj ponownie.” + `kg-btn-primary` „Spróbuj ponownie” (busy „Sprawdzanie…”, `aria-busy`)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-gate-login
  locator: "Mockup 3: State loginRequired", lines 110-137
  acceptance: copy „Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby poprosić organizatora o dostęp.”; `AuthGateLinks` (Zaloguj się / Zarejestruj się) with `returnTo`, without `onGuest`; no auth-only API call
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-gate-can-request
  locator: "Mockup 4: State canRequest", lines 138-166
  acceptance: explanation copy ending „Poproś organizatora o dostęp — dostaniesz powiadomienie, gdy podejmie decyzję.”; `kg-btn-primary` „Poproś o dostęp” (marginTop 12, padding 10px 18px, 13px) opens the dialog; `.kg-error` „Ta grupa nie ma teraz organizatora — nie można wysłać prośby.” shown only while `createConflict` is set, the state is `canRequest` and the refetched `group.organizer_display_name` is null; the flag clears on the next dialog open
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-gate-pending
  locator: "Mockup 5: State pending", lines 167-205
  acceptance: always-mounted `role="status" aria-live="polite"` region containing `.kg-status-line` „⏳ Prośba wysłana — czeka na akceptację organizatora” (⏳ `aria-hidden`); the date line may be omitted (S-6); wrapping flex row, gap 8, with „Sprawdź ponownie” (primary, busy „Sprawdzanie…”, `aria-busy`) and „Wycofaj prośbę” (ghost, busy „Wycofywanie…”, disabled, `aria-busy`); withdraw error → `.kg-error role="alert"` „Nie udało się wycofać prośby — spróbuj ponownie”; focus and visibilitychange listeners are attached only in `pending` and removed on leave or unmount; no polling
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:private-gate-rejected
  locator: "Mockup 6: State rejected", lines 206-229
  acceptance: gentle copy „Organizator nie zatwierdził tym razem Twojej prośby. Jeśli to pomyłka, możesz poprosić ponownie.” with no red/danger styling; primary „Poproś ponownie” opens the same dialog; no cooldown
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:request-access-dialog
  locator: "Mockup 7: RequestAccessDialog", lines 230-269
  acceptance: `role="dialog" aria-modal="true"` with `aria-labelledby` → `<h3>` „Poprosić o dostęp?”; ✕ `aria-label="Zamknij"`; body „Wyślesz prośbę do organizatora grupy „{name}” (bold). Zobaczy Twoje imię z konta i zdecyduje, czy dodać Cię do grupy.”; full-width „Wyślij” (initial focus; busy „Wysyłanie…”, disabled, `aria-busy`) and ghost „Anuluj” (disabled while busy); overlay `rgba(20,28,24,0.55)`, z 60, sheet max 430px, radius 24px 24px 0 0, padding 20; Anuluj/✕/overlay/Esc close it (not while busy) and focus returns to the trigger; other errors → `.kg-error role="alert"` „Nie udało się wysłać prośby — spróbuj ponownie” with the sheet kept open
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: flow:private-gate-states
  locator: "Mockup 8: Gate state flow", lines 270-292
  acceptance: loginRequired → canRequest → pending → view | rejected; withdraw → canRequest; rejected → dialog → pending; every transition is driven by a server refetch (no local `joined` flag)
**Estimated Steps:** 9

- [x] 8.0 Complete TermPage access switch and gate
  - [x] 8.1 Write focused tests: 1 table test plus up to 7 TermPage tests
    - `src/test/termAccess.test.ts`: an `it.each` table of `resolveTermAccess` covering PUBLIC, PRIVATE member, organizer, anonymous, logged in with no request, PENDING, REJECTED, and `identified=false` with PENDING in the data
    - `src/test/TermPage.test.tsx`
      - Update the `access()` factory: `join_request: null`, no `can_join`
      - **Add** `createJoinRequest: vi.fn()` and `withdrawJoinRequest: vi.fn()` to the `...actual`-spread `../api/groups` mock (L10-13) (m-8)
      - New tests:
        - canRequest → „Poproś o dostęp” → „Wyślij” → `createJoinRequest(7, 101)` → refetch → pending text inside `role="status"`
        - pending → „Wycofaj prośbę” → canRequest
        - REJECTED → „Poproś ponownie” visible
        - 409 on create with the refetched `organizer_display_name: null` → the no-organizer line
        - pending + `visibilitychange` with `can_view_content=true` → term content shown
        - stale failure (M-1): after a token change the second `getGroupAccess` rejects, the error line and „Spróbuj ponownie” show without „Wczytywanie...”, and a successful retry renders the resolved state
      - Keep the existing anonymous PRIVATE test, updated to the new loginRequired copy
  - [x] 8.2 Create the pure module `pages/krag/termAccess.ts` with no JSX: the `PrivateGate` / `TermAccess` types and `resolveTermAccess(data, identified)` (research §6.2)
  - [x] 8.3 Evolve `PrivateGroupAccessDenied.tsx` into `PrivateGroupGate.tsx` and delete the old file and export (R13)
    - Props: `groupId`, `termId`, `group`, `gate`, `refetch`, `refreshError`, `stale`
    - Local `RequestFlow` (`idle | submitting | failed`), withdrawing and checking busy flags, and a `createConflict` flag
    - A non-null `refreshError` renders a `.kg-error` line and never replaces the page
  - [x] 8.4 Create `components/krag/RequestAccessDialog.tsx` from the markup of `JoinPrivateGroupDialog`, with the form fields removed. Delete `JoinPrivateGroupDialog.tsx`.
    - Props: `groupId`, `termId`, `groupName`, `onClose`, `onSubmitted`, `onConflict`
    - Behaviour for 2xx, 409 and other errors per R14
  - [x] 8.5 Rewrite the body of `TermPage()` (L53-85) as a thin switch per the R12 render table, with `identified = state.forToken !== null`
  - [x] 8.6 `api/groups.ts`: remove `can_join` and the `joinPrivateGroup` / `JoinGroupRequest` / `JoinGroupResponse` block, now that their consumers are gone
  - [x] 8.7 `AuthGateSheet.tsx` L13 docstring: `PrivateGroupAccessDenied` → `PrivateGroupGate` (m-11)
  - [x] 8.8 Do not use `components/shared/ConfirmDialog` on krag pages. Use `.kg-*` classes and inline styles (css.md).
  - [x] 8.9 Ensure the tests pass: `npx vitest run src/test/termAccess.test.ts src/test/TermPage.test.tsx`

**Acceptance Criteria:**
- The table test and the up-to-7 new TermPage tests pass. The existing TermPage tests still pass.
- Each Visual References `acceptance` item above is met (copy, roles, `aria-*` attributes, busy labels, focus behaviour)
- `grep -rn "can_join\|joinPrivateGroup\|JoinPrivateGroupDialog\|PrivateGroupAccessDenied" src/frontend/src` returns nothing

---

### Task Group 9: Frontend `PublicTermView` S4 fix + a11y side fixes
**Dependencies:** 8 (shares `TermPage.tsx`, `TermPage.test.tsx`)
**Files to Modify:** src/frontend/src/pages/krag/TermPage.tsx, src/frontend/src/pages/krag/components/NeededItemsSection.tsx, src/frontend/src/pages/krag/components/AttendeeList.tsx, src/frontend/src/test/TermPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-page-access-switch
  locator: "Mockup 1: TermPage access switch", the `view` branch, lines 49-81
  acceptance: a PRIVATE member/organizer sees `PublicTermView` (date, attendees, needed items, RSVP) with no guest CTAs; a logged-in user with an empty `displayName` gets `RsvpDialogLoggedIn`, not the guest dialog
**Estimated Steps:** 4

- [x] 9.0 Complete view-side fixes (R15)
  - [x] 9.1 Write 3 focused tests in `src/test/TermPage.test.tsx`
    - S4: logged in with `displayName: null` → the logged-in RSVP dialog opens
    - A PRIVATE member (`can_view_content: true`) sees the term content and no guest CTAs
    - Needed-items and attendee sections expose an accessible name (`getByRole("region", {name: …})` or equivalent)
  - [x] 9.2 `PublicTermView` (TermPage.tsx ~L375-390): choose the RSVP dialog on `isLoggedIn` alone, passing `displayName` through when available without blocking on it
  - [x] 9.3 Fix the dangling `aria-labelledby` in `NeededItemsSection.tsx` L36 and `AttendeeList.tsx` L50, using either a restored heading `id` or an `aria-label` with the Polish section name
  - [x] 9.4 Ensure the tests pass: `npx vitest run src/test/TermPage.test.tsx`

**Acceptance Criteria:**
- The 3 new tests pass. No dangling `aria-labelledby` references remain in the two components.

---

### Task Group 10: Frontend panel — organizer pending "Prośba o dostęp" action + bell kinds + PRIVATE label
**Dependencies:** 7
**Files to Modify:** src/frontend/src/pages/panel/PanelDataContext.tsx, src/frontend/src/pages/panel/PanelModals.tsx, src/frontend/src/test/PanelPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:panel-join-request-action
  locator: "Mockup 9: Organizer — pending action", lines 293-328
  acceptance: `ModalSheet` title „Prośba o dostęp”; body „{requester} prosi o dostęp do grupy „{group}”.” plus `text-xs text-ink-soft` „Wysłano {data}”; button row `mt-3 flex gap-2` with Zatwierdź (mint pill), Odrzuć and Później (border pills); Odrzuć has no extra confirmation; items shown one at a time; while busy both decision buttons are disabled with `aria-busy` and the labels „Zatwierdzanie…” / „Odrzucanie…”; success toasts „Prośba zatwierdzona” / „Prośba odrzucona”; other errors → `role="alert"` „Nie udało się zapisać decyzji — spróbuj ponownie”
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:panel-join-request-resolved
  locator: "Mockup 10: Organizer — already resolved (409)", lines 329-347
  acceptance: any 409 → `<p role="alert" class="mt-3 text-sm font-semibold text-danger">` „Prośba została już rozstrzygnięta.” plus a „Rozumiem” pill that dismisses and calls `load({silent: true})`; no `already_resolved === true` check (D-2)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:panel-bell-join-notifications
  locator: "Mockup 11: Bell dropdown entries", lines 348-375
  acceptance: no markup change; `GROUP_JOIN_REQUESTED` / `APPROVED` / `REJECTED` rows render the backend `message` with the existing unread dot and bold and link to `link_path`; opening a `GROUP_JOIN_REQUESTED` row marks it read and does not remove the pending action
**Estimated Steps:** 7

- [x] 10.0 Complete organizer panel action (R16)
  - [x] 10.1 Write up to 8 focused tests in `src/test/PanelPage.test.tsx`
    - Add `listMyPendingJoinRequests`, `approveJoinRequest` and `rejectJoinRequest` to the fixed `../api/groups` mock (L60-73)
    - **Required (M-2):** set `vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([])` in the shared per-test defaults after every `vi.resetAllMocks()` (for example `mockOrganizerDefaults()` or each `beforeEach`), so all existing PanelPage tests keep passing
    - New tests:
      - the item appears from the server list even when its notification is read
      - Zatwierdź → `approveJoinRequest(gid, rid)` → reload → toast
      - Odrzuć → `rejectJoinRequest`
      - 409 → „Prośba została już rozstrzygnięta.” plus „Rozumiem”
      - Później hides the item with no notification-read call
      - Później survives a silent reload (hide, then decide another item → still hidden)
      - `listMyPendingJoinRequests` resolving to `undefined` still renders the panel with no item and no crash
      - a `GROUP_JOIN_REQUESTED` bell row renders its message and links to `link_path`
  - [x] 10.2 Add `PendingJoinRequestAction { kind: "GROUP_JOIN_REQUESTED", joinRequestId, groupId, groupName, requesterName, createdAt }` (no `linkPath`) to the `PendingAction` union
  - [x] 10.3 Change `load()` (including `{silent: true}`)
    - Fetch `listMyPendingJoinRequests()` alongside notifications
    - On failure, use `[]` without a toast. Coerce any non-array result to `[]`.
    - Do not derive items from notifications. Merge them oldest first after the notification-derived items.
  - [x] 10.4 Add a provider-level hidden set, plus busy and resolved state keyed by `joinRequestId`. `load()` never clears the hidden set; it resets only when the provider remounts. The existing swap and confirm behaviour is unchanged.
  - [x] 10.5 Render the join-request item in `GlobalPendingActionsModal` (Mockups 9 and 10)
    - On a 2xx decision, mark any unread `GROUP_JOIN_REQUESTED` notification with the matching `join_request_id` as read, then `load({silent: true})`
  - [x] 10.6 `PanelModals.tsx` L170 and L248: change „(link dołączenia)” to „(dostęp na prośbę)”
  - [x] 10.7 Ensure the tests pass: `npx vitest run src/test/PanelPage.test.tsx`

**Acceptance Criteria:**
- The up-to-8 new tests pass, and every pre-existing PanelPage test still passes (M-2 default in place)
- Each Visual References `acceptance` item above is met

---

### Task Group 11: Test Review, Gap Analysis & Full-Suite Gate
**Dependencies:** All previous groups (1-10)
**Files to Modify:** src/backend/tests/test_group_join_requests_router.py, src/backend/tests/test_group_join_requests_decisions.py, src/backend/tests/test_group_access.py, src/frontend/src/test/TermPage.test.tsx, src/frontend/src/test/PanelPage.test.tsx (append-only gap tests)
**Estimated Steps:** 8

- [x] 11.0 Review, fill critical gaps, and run the full gates
  - [x] 11.1 Review the tests from Groups 1-10 against the spec "Testing approach" list and Success Criteria 1-8
  - [x] 11.2 Analyze gaps for THIS feature only. Likely candidates:
    - create with no active organizer → 409
    - withdraw after a decision → 409
    - approve after PRIVATE→PUBLIC is allowed
    - the old organizer gets 403 after an organizer change
    - Esc / overlay close and focus return in `RequestAccessDialog`
    - the other-error path keeps the sheet open
  - [x] 11.3 Write up to 10 additional strategic tests
  - [x] 11.4 Run the TDD red gate: `uv run pytest -q tests/test_private_group_access_defects.py` → 5 passed
  - [x] 11.5 Run the full backend suite and linters in `src/backend`: `uv run pytest`, `uv run ruff check .`, `uv run mypy app`, plus the `alembic upgrade head` / `downgrade 0036` / `upgrade head` round-trip
  - [x] 11.6 Run the full frontend suite and linters in `src/frontend`: `npx vitest run`, `npx tsc -b --noEmit`, `npx eslint .`
  - [x] 11.7 Run the final removal greps:
    - no `can_join`, `createMembership`, `joinPrivateGroup`, `JoinPrivateGroupDialog` or `PrivateGroupAccessDenied` anywhere in `src/`
    - no `/api/memberships` POST and no `/public/{id}/join` route
  - [x] 11.8 Confirm that the `visual-coverage.md` IDs are all implemented, as the Group 8/9/10 Visual References acceptance items

**Acceptance Criteria:**
- The full backend and frontend suites are green, and ruff, mypy, tsc and eslint are clean
- All 5 red-gate tests pass
- No more than 10 additional tests are added

## Execution Order

1. Group 1: Backend B14 removals + R6 helper + seeding rewrites (8 steps)
2. Group 3: Backend data layer + migrations (8 steps, independent; can run parallel with 1)
3. Group 7: Frontend data layer (6 steps, independent; can run parallel with backend groups)
4. Group 2: Backend B13 (5 steps, depends on 1)
5. Group 4: Requester create/withdraw + matrix (8 steps, depends on 1, 3)
6. Group 5: Organizer decisions + lists + StaleDataError (7 steps, depends on 4)
7. Group 6: `/access` DTO `join_request` (5 steps, depends on 2, 5)
8. Group 8: TermPage switch + gate + dialog (9 steps, depends on 7)
9. Group 10: Panel pending action (7 steps, depends on 7; can run parallel with 8/9, no shared files)
10. Group 9: S4 + a11y fixes (4 steps, depends on 8)
11. Group 11: Test review + full-suite gate (8 steps, depends on all)

Shared-file serialization notes:
- `public_view.py`: 1 → 2 → 6
- `service.py`: 1 → 4 → 5
- `schemas.py`: 1 → 4 → 6
- `authorization_matrix.py`: 1 → 4
- `api/groups.ts`: 7 → 8
- `TermPage.tsx` / `TermPage.test.tsx`: 8 → 9

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/: minimal-implementation (no shims, dead code deleted; the per-group list endpoint is the documented S-1 exception), error-handling (typed exceptions, central `StaleDataError` handler), validation, commenting (no change-log comments), coding-style
- backend/: models.md (BaseEntity, explicit sequence, string enum, no `relationship()`), migrations.md (reversible, one concern each, `pk_/fk_/uq_/ix_` naming), api.md (plural `join-requests`, 201 on create), security.md (matrix row before blanket row 27, ownership checks in services, `require_any()`), queries.md (batched names, one trailing commit)
- frontend/: components.md, css.md (krag `.kg-*` + inline; panel Tailwind), accessibility.md (live region, `role="alert"`, `aria-busy`, dialog labelling, focus return, `aria-hidden` emoji), responsive.md (below 520px full width, pending buttons wrap)
- testing/: backend-testing.md (integration-first with a real Postgres testcontainer, `test_<action>_<condition>_<result>` names, per-file helpers), frontend-testing.md (Vitest + Testing Library in `src/test/`, `vi.mock` API modules, `vi.resetAllMocks()` defaults)
- Project memory: DDD layering, where routers and tests import only from `app.groups.service`; public URL scheme `/:slug/grupa/:groupId/term/:termId`; pre-production, so no backward-compatibility shims

## Notes

- Test-Driven: each group starts with its focused tests (2-8; Group 8 adds 1 table test on top)
- Run Incrementally: each group runs only its new and rewritten tests plus the red-gate file. Only Group 11 runs the full suites.
- Mark Progress: check off steps as completed
- Reuse First: SwapProposal template, migrations 0031/0032/0023, `_require_active_organizer`, `_is_active_member`, `get_or_create_active_group_role`, `list_profile_names_by_party_ids`, `notifications_bridge`, `slug_resolver`, `inventory.py` race fallback, `KragStage` / `GroupHeader` / `AuthGateLinks`, `ModalSheet`, and the SWAP_PROPOSED button row
- Out of scope (do not implement): FSM §7.2 reducer, route-key remount, privacy hardening of `/api/terms`/`needed-items`/`pledges`, expiry/cooldown/message fields, term-page approval card, auto-RSVP, polling/email
