# Codebase Analysis Report

**Date**: 2026-09-24
**Task**: Access requests for PRIVATE groups, handled on the existing TermPage route
**Description**: PRIVATE groups are handled by the same TermPage component and route (`/:organizationSlug/grupa/:groupId/term/:termId`, `src/frontend/src/pages/krag/TermPage.tsx`). A visitor must be logged in and send an ACCESS REQUEST through a dialog opened by "Poproś o dostęp". This dialog replaces `JoinPrivateGroupDialog` and has no name or child fields, because identity comes from the account. The organizer is notified and approves or rejects the request. Approved members see the full term view (the current `PublicTermView`). Based on `analysis/research-context/research-report.md` and `fsm-research-report.md`.
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

---

## Summary

The codebase already has a close template for this feature. `SwapProposal` has a status enum (PROPOSED/ACCEPTED/REJECTED), accept and reject endpoints, notifications that carry a loose `proposal_id` pointer, and an organizer-side pending-actions modal. A new `GroupJoinRequest` entity (migration 0037) can follow that template almost one-to-one.

Two backend blockers have to be fixed first, or the feature will be either unreachable or bypassable:
- **B13:** `get_public_circle_view` always returns a reduced response for PRIVATE groups, even to members and organizers. It also skips the `term_id` check for PRIVATE groups.
- **B14:** `POST /api/memberships` and `POST /api/groups/public/{id}/join` both let any logged-in user join any group immediately.

On the frontend, the TermPage currently branches on `visibility` and blocks members too. It needs to branch on the server-derived `can_view_content` and a request status instead.

---

## Files Identified

### Primary Files (backend)

**src/backend/app/groups/models.py** (351 lines)
- `_enum_column` L26-33, `SwapProposalStatus` L55-58, `GroupVisibility` L74-84 (its docstring describes the join-link path and must be rewritten), `Membership` L149, `SwapProposal` L299-336.
- The new `GroupJoinRequestStatus` enum and `GroupJoinRequest` entity go here.

**src/backend/app/groups/application/public_view.py** (506 lines)
- `get_public_circle_view` L163: the PRIVATE branch at L190-211 always returns a reduced view and runs before the `term_id` validation, so a wrong termId returns 200 instead of 404 (B13).
- `get_group_access` L285: reuses the reduced view at L302 and redundantly reloads the group at L303. Its `is_attending` check (L316-318) looks only at guardians, so it is always False for PRIVATE groups. The flags are computed at L320-322 (`can_view_content = member || organizer`, `can_join = not ...`).
- `create_rsvp` L339: the PRIVATE gate is at L370-381.
- `join_private_group` L452-506: to be deleted. It creates a Membership immediately (L479-489), never persists `child_count`, and runs an N-query loop with an `assert` (L490-498).
- Docstrings that mention the join path: L299-301, L372-374.

**src/backend/app/groups/application/memberships.py** (192 lines)
- `create_membership` L23-39 is the self-join bypass (B14) and is to be removed.
- `_is_active_member` L58-63 loads all memberships.
- `formalize_group_from_term` creates a Membership at L149-158.

**src/backend/app/groups/application/term_item_listings.py** (804 lines)
- Template use cases: `propose_swap` L419 (add, flush, `notifications_bridge.create_notification(link_path=..., proposal_id)`, commit), `accept_swap_proposal` L516, `reject_swap_proposal` L584 (ownership check raises `AccessDenied`; a non-pending status raises `BusinessConflictException` "...już rozstrzygnięta").

**src/backend/app/groups/infrastructure/repository.py** (471 lines)
- The swap section at about L431-471 (`db.get`, `status.in_`, `id.desc()`) is the template for the join-request repository functions. Repositories never commit.

**src/backend/app/groups/schemas.py** (630 lines)
- `GroupAccessDetails` L293 and `GroupAccessResponse` L308 are to be extended with request status.
- `SwapProposalResponse` L525-550 (`from_attributes`) is the template.
- `JoinGroupRequest`/`JoinGroupResponse` L357-376 and `CreateMembershipRequest` L129-131 are to be deleted. The module docstring at L2 mentions them.

**src/backend/app/groups/service.py** (148 lines)
- Flat facade. Imports are at L19-88 (`create_membership` L42, `join_private_group` L60) and the alphabetical `__all__` at L90-148 (L99, L117). Every new use case must be re-exported here.

**src/backend/app/groups/router/circles.py** (361 lines)
- `/access` is at L132-143 (`OptionalPrincipal`); `/join` is at L166-186 (delete it, and reuse its shape as the create-endpoint template).
- Router aliases are at L52-55. The route-order docstring at L5-10 requires literal segments before `/{group_id}`. `GET /api/groups/{group_id}` is at L295.

**src/backend/app/groups/router/memberships.py**
- Remove `POST /api/memberships` (L25-33) and keep `/end` (L36-44).

**src/backend/app/core/authorization_matrix.py**
- Rows verified in the file:
  - L81 `GET public/{id}` PUBLIC
  - L88 `GET .../access` PUBLIC
  - L93 rsvp PUBLIC
  - L94 merge PUBLIC
  - L95-101 comment and `POST .../join` AUTHENTICATED (delete)
  - L106 PATCH EDIT
  - L110 moderation ADMIN
  - **L116** GET blanket `^/api/groups(/.*)?$` READ (#26)
  - **L117** POST blanket EDIT (#27)
  - L134 `POST ^/api/memberships(/.*)?$` EDIT (#31; keep for `/end`)
  - L174-175 notifications
  - L207-208 swap accept/reject
  - L214 catch-all AUTHENTICATED
- (The Pattern Mining agent reported the blanket rows as L119/L120. Checking the file confirmed L116/L117.)

**src/backend/alembic/versions/** (new `0037_*.py`, `down_revision="0036"`)
- Templates: `0031_swap_proposal.py` (sequence helpers L36-50, `create_table` L54-79, downgrade with `OWNED BY NONE` L97-104), `0032_notification_proposal_id.py` (loose pointer column), `0023` L51-57 (partial unique index; note that it mixes data and schema, which is an anti-pattern).
- If a `join_request_id` notification column is added, it goes in a separate migration (0038).

### Primary Files (frontend)

**src/frontend/src/pages/krag/TermPage.tsx** (455 lines)
- `TermPage` L53-85: `useTermAccess` shows loading or error via `KragStageMessage` (L60/L63). If `visibility === "PRIVATE"` (L65-75) it renders `PrivateGroupAccessDenied`, which also blocks members. Otherwise it renders `PublicTermView`.
- `PublicTermView` L105-455: `gateAction` for pledge (L193) and take (L274), `AuthGateSheet` overlays (L362-406), `GroupHeader` L415, `NeededItemsSection` L429-431, `AttendeeList` L433, `TermFooter` L446, and guest localStorage L151-153.

**src/frontend/src/pages/krag/PrivateGroupAccessDenied.tsx** (87 lines)
- The current gate. When `canJoin && isLoggedIn`, "Dołącz na stałe" opens `JoinPrivateGroupDialog` (L74-84). Logged-out visitors get `AuthGateLinks` (L66-68). A local `joined` flag (L31, L47-50) triggers a refetch through `onJoined`.
- Rewrite it into a gate with loginRequired / canRequest / pending / rejected states.

**src/frontend/src/pages/krag/JoinPrivateGroupDialog.tsx** (135 lines)
- A clone of `RsvpDialog` with name and child count that calls `joinPrivateGroup` (L36). Delete it; its markup and busy/formError handling are the template for a confirm-only `RequestAccessDialog`.

**src/frontend/src/pages/krag/useTermAccess.ts** (55 lines)
- Refetches when the token changes, and a refetch keeps the existing data. It can take an optional refetch-on-focus so a member sees content after approval.

**src/frontend/src/api/groups.ts** (477 lines)
- `GroupAccessDetails` L246-253 (`can_join`) and `getGroupAccess` L263.
- `createMembership` L153-155 and `CreateMembershipRequest` L75 have no callers; remove them.
- The `joinPrivateGroup` block L320-372 is to be replaced with request, list, approve and reject API functions.

**src/frontend/src/pages/panel/PanelDataContext.tsx** (1554 lines)
- `Pending*Action` types L118-149, `parseTermIdFromLinkPath` L151-155, notification load L524-534, `openNotification` L625-647, `pendingActions` L654-684 (built from unread notifications by kind), dismiss L690-701, `acceptPendingSwap` L713, `rejectPendingSwap` L741, context exports L1323-1336, `GlobalPendingActionsModal` L1445-1545 (Akceptuj/Odrzuć/Później; title L1461) mounted at L1551.
- This is where the organizer approve/reject UI plugs in.

**src/frontend/src/api/notifications.ts**
- The `NotificationKind` union (L3-13) and response (L15-29, `proposal_id`) need the new kinds and an optional `join_request_id`.

### Related Files

- **src/backend/app/core/base_model.py**: `BaseEntity` (sequence id, `created_at`, `updated_at` as the optimistic-lock version column).
- **src/backend/app/groups/application/circles.py**: `_group_role_party_id` L172-176, `get_current_leadership` L227, `_is_active_organizer` L243, `_require_active_organizer` L251. These are the organizer-authorization helpers for approve/reject.
- **src/backend/app/groups/application/group_roles.py** (28 lines): `get_or_create_active_group_role` (flushes), for an idempotent approve.
- **src/backend/app/groups/application/pledges.py**: `_emit_pledge_event` about L32-60 (outbox alternative), fail-fast 409 pre-check L63-85, withdraw template L100-121.
- **src/backend/app/groups/application/attendance.py**: `_require_term_eligibility`. `create_pledge` has no privacy check (outside the scope of this task, but noted).
- **src/backend/app/groups/application/slug_resolver.py**: `resolve_organizer_slug`, used to build `link_path`.
- **src/backend/app/groups/infrastructure/notifications_bridge.py** L18-34: ACL (party_id, kind, message, link_path, proposal_id). Its docstring is stale.
- **src/backend/app/notifications/models.py**: `NotificationKind` L35-55, `String(30)`, `native_enum=False`, so new kinds need no migration. `proposal_id` is at L81.
- **src/backend/app/notifications/service.py** (`create_notification` L30-52 only stages the row) and **schemas.py** L12-21.
- **src/backend/app/groups/router/__init__.py** L26-31: the include order is load-bearing (circles, leaderships, memberships, terms, pledges, term_item_listings).
- **src/backend/app/groups/router/term_item_listings.py**: aliases L36-38 and accept/reject routes L108-122, the template for the approve/reject routes.
- **src/backend/app/main.py** L105: groups_router is included here (system_router last, L110).
- **src/backend/app/core/errors.py** L82-83: the global `IntegrityError` handler returns a generic 409 "Data integrity violation".
- **src/backend/app/circulation/application/inventory.py** L40-64: the lost-insert race pattern (`begin_nested` plus `IntegrityError`).
- **src/backend/app/users/service.py**: `get_profile_by_principal` and `get_profile_by_party`. An account-backed check is `profile.account_user_id is not None` (public_view L375, L387).
- **src/frontend/src/pages/krag/AuthGateSheet.tsx**: `AuthGateLinks` L16-53 and `AuthGateSheet` L62-126, for the logged-out state.
- **src/frontend/src/pages/krag/KragStage.tsx**: the stage shell and the `.kg-*` classes (kg-card, kg-btn-primary, kg-btn-ghost, kg-status-line, kg-error, kg-input).
- **src/frontend/src/api/client.ts** L37-42: a 401 clears the token and redirects to `/login`, so auth-only calls must be made only when logged in.
- **src/frontend/src/api/termItemListings.ts** L60-102: the accept/reject API function template.
- **src/frontend/src/pages/panel/PanelHeader.tsx** (bell L32-36, L99-120; generic, likely unchanged), **PanelModals.tsx** (visibility selects L160/L238; no notification logic), **panelComponents** (ModalSheet/HintCard/Field L46-130), **EditTermDialog.tsx** (member-list card L129-176, L423-480; a UI reference for a panel list of requests).
- **src/frontend/src/router.tsx** L122-123: the route already exists; no change needed.
- **src/frontend/src/pages/krag/NeededItemsSection.tsx** L36 and **AttendeeList.tsx** L50: `aria-labelledby` points to headings removed in commit 1be5983, so the sections have no accessible name. This is a side issue in files this task touches. AttendeeList also has a Tailwind flex class and a trailing space in its className.
- **src/frontend/src/components/shared/ConfirmDialog.tsx**: an English Chakra admin dialog. Do NOT use it on krag pages.

---

## Current Functionality

### Backend
- **PRIVATE term view**: `GET /api/groups/public/{id}` (PUBLIC) calls `get_public_circle_view`. For a PRIVATE group it always returns reduced data, whoever the caller is, and a wrong termId still returns 200.
- **Access resolution**: `GET /api/groups/public/{id}/access` (`OptionalPrincipal`) returns `is_member`, `is_organizer`, `is_attending` (always False for PRIVATE), `can_view_content` and `can_join`. `can_join` is true for anonymous visitors to a PRIVATE group (asserted in tests), and `next_term` is None for them.
- **Joining**: `POST /api/groups/public/{id}/join` (AUTHENTICATED) creates an active Membership at once, with no organizer involvement. `POST /api/memberships` (EDIT, and every logged-in GUEST has EDIT through registration tokens) lets anyone self-join any group.
- **RSVP**: `create_rsvp` refuses PRIVATE groups (403).

### Frontend
- The TermPage branches on `visibility`, not on access, so members of a PRIVATE group see the denial page. `PrivateGroupAccessDenied` offers a join dialog and keeps a local `joined` flag.

### Key Components/Functions
- **SwapProposal flow** (the template): create with notification, organizer/owner accept/reject, 409 when already resolved, `GlobalPendingActionsModal` on the frontend.
- **get_or_create_active_group_role**: the idempotent group-role creation used when turning an approval into a Membership.
- **_require_active_organizer**: the ownership gate for approve/reject.
- **Membership(from_role_id, to_group_id, valid_from=date.today(), valid_to=None)**: built inline in both `public_view` and `memberships`. There is no shared helper, so consider extracting one.

### Data Flow (target)
1. The visitor opens the term URL, and `useTermAccess` calls `GET /access`.
2. If `can_view_content` is false, the gate shows either login links or "Poproś o dostęp". The dialog calls `POST /api/groups/public/{id}/access-requests`. That inserts a PENDING `GroupJoinRequest` (a partial unique index allows one pending request per requester and group) and sends a notification to each active organizer (`link_path=/{slug}/grupa/{gid}/term/{tid}`, `join_request_id`).
3. The organizer's panel builds `pendingActions` from the unread notification. Approve calls `POST /api/groups/{gid}/access-requests/{rid}/approve`, which creates the GroupRole and Membership idempotently, marks the request APPROVED, and notifies the requester. Reject marks it REJECTED and notifies the requester.
4. The requester refetches (on focus or on the notification). `/access` now returns `can_view_content=true` and the full view is rendered, because `get_public_circle_view` includes private content for members and organizers.

---

## Dependencies

### Imports (what the new code depends on)
- `BaseEntity`, `_enum_column`: entity modeling.
- `circles._require_active_organizer`, `get_current_leadership`, `_group_role_party_id`: organizer authorization and notification fan-out.
- `group_roles.get_or_create_active_group_role`, `memberships._is_active_member`: approval and duplicate checks.
- `users.service.get_profile_by_principal`: requester identity (party_id; must be account-backed).
- `notifications_bridge.create_notification`, `slug_resolver.resolve_organizer_slug`: notifications.
- Exceptions: `EntityNotFound` (404), `BusinessConflictException` (409), `AccessDenied` (403), `AuthenticationRequired` (401).

### Consumers (what depends on the code being changed)
- **public_view.get_public_circle_view / get_group_access**: TermPage through `useTermAccess`, and `test_group_access.py`, `test_public_term.py`, `test_group_privacy.py`.
- **POST /api/memberships (removal)**: no frontend callers. Backend test helpers break: `test_circles_router.py` helper L52-65 (3 tests: L68, L99, L118) and `test_exchange_summary.py` helper L66-83 plus a direct post at L313 (8 tests: 124, 147, 177, 194, 236, 251, 327, 358).
- **/join (removal)**: `api/groups.ts` L320-372, `JoinPrivateGroupDialog.tsx`, `PrivateGroupAccessDenied.tsx` (L4, 30, 54-61, 74-84). Backend tests: `test_circles_router.py` L191, 218, 258, 275 (the `resolve_requirement` import at L18 is used only there) and `test_group_privacy.py` L216-235 plus the NOTE at L238-245 and the docstring at L1-5.
- **GroupAccessDetails shape**: three `test_group_access.py` tests assert the full dict (L56-62, 76-82, 97-103). The frontend `access()` factory in `TermPage.test.tsx` L77-91.
- **NotificationKind union / PanelDataContext**: `PanelPage.test.tsx`, whose `../api/groups` mock is a FIXED list (L61-73), so every new API function must be added to it (see L83-86).

**Consumer Count**: about 14 files (6 backend test files, 4 backend modules, 4 frontend modules/tests)
**Impact Scope**: Medium-High. There is a cross-cutting authorization change (removing two self-join endpoints, matrix rows), a change to a public DTO, and a new notification kind that spans backend and panel UI.

---

## Test Coverage

### Test Files
- **test_group_access.py**: 5 tests of the access flags. Three compare the full dict. L116 asserts `can_join=True` for anonymous PRIVATE; L118 asserts `next_term=None` for anonymous PRIVATE, which must stay. There is no test that a member sees content.
- **test_group_privacy.py**: RSVP 403 (L65, L84), formalize tests, join 404 (L216).
- **test_circles_router.py**: `/join` tests at L191-279; the helper uses `POST /api/memberships`; make-private via `PATCH /api/groups/{id} {"visibility":"PRIVATE"}` (L191-214).
- **test_exchange_summary.py**: relies on `POST /api/memberships` (L78, L313).
- **test_swap_proposal_model.py**: model plus a kind-length test (a template for a `≤30 chars` kind test).
- **test_term_item_listings.py / _router.py**: swap use-case and route templates (`_principal` helper L51-56).
- **test_public_term.py, test_rsvp.py, test_notifications.py, test_authorization_matrix.py** (L63 covers only the public GET; add row tests like L66-75).
- **Frontend**: `TermPage.test.tsx` mocks `getGroupAccess`, `createRsvp` and `mergeAnonymousProfile` (L10-13); the PRIVATE test is at L263-272. `PanelPage.test.tsx` has bell tests at L1910-1973 and pending modal tests at L1975-2478 (`pendingNotif` factory L1980-1992).
- **Infrastructure**: `conftest` uses a session-scoped postgres:18 testcontainer with `alembic upgrade head` (L41-57), a SAVEPOINT `db_session` (L64-81) and an httpx `client` (L84-99). There are no shared data fixtures; helpers live in each test file.

### Coverage Assessment
- **Test count**: about 25-30 existing tests touch the affected area. 11 tests break when `POST /api/memberships` is removed and about 5 when `/join` is removed.
- **Gaps (new tests needed)**:
  - Creating a request: 401 when anonymous, 404/409 for a PUBLIC group, 409 for a duplicate PENDING request, 409 when already a member.
  - Approve/reject by organizers only (403 for others), and 409 when the request is already resolved.
  - Approve creates a Membership and is idempotent.
  - Notifications in both directions.
  - A member or organizer gets full content via `/access` and the public view.
  - A wrong termId returns 404 for PRIVATE.
  - Removed endpoints return 404/405.
  - Matrix `resolve_requirement` rows.
  - Frontend gate states (login, can request, pending, rejected, member sees `PublicTermView`) and panel approve/reject.

---

## Coding Patterns

### Naming Conventions
- **Backend**: snake_case; use cases are `async def verb_noun(db, principal, id)`; `_require_*` raises and `_is_*` returns a bool; DTOs are `XRequest`/`XResponse`/`XDetails` (`from_attributes`); tables are plural (`group_join_requests`) with a `<table>_seq` sequence; constraints are named `{pk,fk,uq,ix}_{table}_{cols}` (FK: `fk_<table>_<col>_parties`).
- **Tests**: `test_<camelAction>_<condition>_<result>`, flat files, per-file helpers (`_auth`, `_register`, `_create_circle_and_term` in test_group_privacy L14-42), unique emails.
- **Frontend**: PascalCase components (one component per variant), camelCase API functions, a `VM` suffix for view models, Polish user-facing copy.

### Architecture Patterns
- **Backend layering**: models, then repository (no commit), then application (a single trailing commit and refresh), then `*_bridge` ACLs, then the `service.py` facade (`__all__`), then routers, which call only the service. Cross-bounded-context references are plain FK ids with no `relationship()`. StrEnum plus `_enum_column` (string-backed). Routes return 201 on create; literal segments come before `{id}`; new matrix rows sit before the blanket rows with a comment and `resolve_requirement` tests.
- **Frontend state**: a single data hook per page (`useTermAccess`), `gateAction` for auth-gated actions, and bottom-sheet dialogs with `busy`/`formError`. Toasts use `kg-toast role=status`. Krag pages use `.kg-*` CSS rather than Tailwind; the panel uses Tailwind `ModalSheet`. Organizer actions go through `PanelDataContext` pending actions derived from notifications.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | public_view 506, term_item_listings 804, PanelDataContext 1554, TermPage 455 | High |
| Dependencies | about 8 internal helpers/modules (circles, group_roles, memberships, users, notifications bridge, slug resolver, errors, base model) | Medium |
| Consumers | about 14 files affected (tests plus frontend) | High |
| Test Coverage | Good around swap/access/privacy, but no member-sees-content, and 16 tests break on endpoint removal | Medium |

### Overall: Complex

The pattern is well established (SwapProposal). The work is complex because of breadth rather than novelty: a new entity and migration, 4-5 use cases, matrix rows, a change to a public DTO, two endpoint removals with test fallout, a new notification kind spanning backend and panel, and a reworked TermPage gate.

---

## Key Findings

### Strengths
- `SwapProposal` is a near-exact template across every layer (model, migration 0031/0032, use cases, routes, schema, notifications, panel modal, tests).
- The organizer helpers (`_require_active_organizer`) and `get_or_create_active_group_role` already exist.
- `NotificationKind` is a non-native enum `String(30)`, so new kinds need no migration.
- The existing blanket matrix rows L116/L117 already cover `/api/groups/{id}/access-requests[...]` GET/POST.
- The TermPage route and `useTermAccess` refetch-on-token already exist, and the full view (`PublicTermView`) can be reused unchanged.

### Concerns
- **B13**: members and organizers of PRIVATE groups get a reduced view, and a wrong termId returns 200. Without fixing this, an approval has no visible effect.
- **B14**: `POST /api/memberships` and `/join` let users bypass approval entirely. Both must be closed, or the request flow is decorative.
- **Race conditions**: swap accept/reject is check-then-write with no lock and no `StaleDataError` handler (500 on a lost race). A duplicate PENDING insert hitting the partial unique index gives only the generic 409 "Data integrity violation" unless it is pre-checked or caught with `begin_nested`.
- `is_attending` is always False for PRIVATE groups (it checks guardians only).
- The frontend 409 "already_resolved" check in the panel does not match the backend swap envelope. There are `as number` casts in the modal (L1504/L1512).
- The local `joined` state in `PrivateGroupAccessDenied`: pending and rejected status must come from the server.
- Removing `POST /api/memberships` breaks 11 tests whose helpers need a replacement: seeding GroupRole plus Membership via `db_session` (test_circles_router has only the `client` fixture), RSVP plus formalize, or the new request-and-approve flow.
- Missing `aria-labelledby` targets in NeededItemsSection and AttendeeList (commit 1be5983).
- Reusing `proposal_id` for join requests would be wrong. Add a separate `join_request_id` column in its own migration, or rely on `link_path` only.

### Opportunities
- Extract a shared "create active membership" helper, used by approve, formalize and the old join paths.
- Remove the redundant group reload in `get_group_access` (L303) and the N-query loop and `assert` in `join_private_group` (which is deleted anyway).
- Add refetch-on-focus in `useTermAccess` so an approved requester sees content without reloading the page.

---

## Impact Assessment

- **Primary changes (backend)**:
  - `groups/models.py`: new status enum and entity; rewrite the `GroupVisibility` docstring.
  - New migration `0037_group_join_requests.py`, plus an optional `0038_notification_join_request_id.py`.
  - New `groups/application/join_requests.py` (request, list pending, approve, reject, optional withdraw).
  - `infrastructure/repository.py` (join-request section), `schemas.py`, `service.py`.
  - `router/circles.py`: `POST /public/{id}/access-requests`, `GET /{id}/access-requests`, `POST /{id}/access-requests/{rid}/approve|reject`; delete `/join`.
  - `router/memberships.py`: delete the POST.
  - `public_view.py`: an `include_private_content` flag for members and organizers; validate term_id for PRIVATE; delete `join_private_group`; add request status to `GroupAccessDetails`.
  - `core/authorization_matrix.py`: an explicit AUTHENTICATED row for `POST ^/api/groups/public/[^/]+/access-requests$` before L116/L117, replacing L95-101. Keep L134 for `/end`.
  - `notifications/models.py` and `schemas.py` (new kinds such as `JOIN_REQUESTED`, `JOIN_APPROVED`, `JOIN_REJECTED`, all 30 characters or fewer; optional `join_request_id`), `notifications_bridge.py`.
- **Primary changes (frontend)**:
  - `TermPage.tsx`: branch on `can_view_content`.
  - Rewrite `PrivateGroupAccessDenied.tsx` as a gate (or `PrivateGroupGate`).
  - New `RequestAccessDialog.tsx` (confirm-only); delete `JoinPrivateGroupDialog.tsx`.
  - `api/groups.ts`: extend `GroupAccessDetails`, add request/list/approve/reject, remove `joinPrivateGroup` and `createMembership`.
  - `api/notifications.ts`: new kinds.
  - `PanelDataContext.tsx`: a new pending action type, accept/reject handlers, and modal rendering.
- **Related changes**: `useTermAccess.ts` (refetch on focus), a11y fixes in `NeededItemsSection.tsx` and `AttendeeList.tsx`, and docstrings in `models.py` and `public_view.py`.
- **Test updates**:
  - Rewrite the helpers in `test_circles_router.py` and `test_exchange_summary.py`.
  - Delete or replace the `/join` tests (test_circles_router, test_group_privacy).
  - Update the full-dict asserts in `test_group_access.py`.
  - New `test_group_join_requests.py` (plus router/model tests) and matrix row tests.
  - Frontend: `TermPage.test.tsx` gate states; add the new API functions to the fixed mock in `PanelPage.test.tsx` and add pending-action tests.

### Risk Level: Medium-High

Removing the endpoints and changing matrix rows affects authorization, which is security-relevant and ordering-sensitive (first match wins). Widening the public view for members risks leaking private content if the member/organizer check is wrong. The DTO change breaks exact-dict tests and the frontend factory. Concurrency on approve/reject and duplicate requests needs explicit handling. The mitigation is that every piece has a proven in-repo template, and the test infrastructure (a real Postgres testcontainer) catches migration and constraint issues.

---

## Recommendations

**Modifying existing code and creating a new capability:**

1. **Close the bypasses first (B14).** Delete `POST /api/groups/public/{id}/join` (route, use case, schemas, matrix row L101 and comment L95-100, frontend API and dialog) and `POST /api/memberships` (route, `create_membership`, `CreateMembershipRequest`, frontend `createMembership`). Keep matrix row L134 for `/end`. Replace the test helpers by seeding GroupRole and Membership directly through `db_session`, or add a small per-file helper that drives request and approve.
2. **Fix B13 in `public_view`.** Validate `term_id` before the PRIVATE branch (404 on mismatch). Pass an `include_private_content` flag, true when the caller is an active member or organizer, so `get_public_circle_view` and `get_group_access` return the full view. Keep `next_term=None` for anonymous visitors.
3. **Add the entity, modeled on SwapProposal.** `GroupJoinRequest(BaseEntity)` with `group_id` (real FK to groups), `requester_party_id` (FK to parties, `fk_group_join_requests_requester_party_id_parties`), optional `term_id` (nullable FK, used for the notification link), `status` via `_enum_column(GroupJoinRequestStatus, 20)` with PENDING/APPROVED/REJECTED (plus WITHDRAWN if withdraw is in scope), and `decided_by_party_id`/`decided_at` if the spec wants an audit trail. Migration 0037 with an explicit sequence, a partial unique index `uq_group_join_requests_pending_requester_group` WHERE `status = 'PENDING'`, and a real downgrade.
4. **Use cases** in `application/join_requests.py`:
   - `request_group_access`: requires an account-backed profile (401/403 otherwise), 404 for a PUBLIC group or an unknown group, 409 for an existing member or an existing PENDING request (pre-check plus `begin_nested`/IntegrityError fallback), and notifies each active organizer.
   - `list_group_access_requests`: organizer only.
   - `approve_group_access_request`: organizer only; 409 if not PENDING; `get_or_create_active_group_role`, then a Membership if not already a member (idempotent), status APPROVED, notify the requester.
   - `reject_group_access_request`: same shape; status REJECTED, notify the requester.
   - Handle a concurrent decision: catch `StaleDataError` and return 409, or use `with_for_update`.
   - Use one trailing commit; re-export everything through `service.py`.
5. **Routes and matrix.** `POST /api/groups/public/{id}/access-requests` (201) needs an explicit AUTHENTICATED row before the blanket POST row, because `public/*` must not require EDIT semantics by accident; decide explicitly and add a `resolve_requirement` test. The organizer routes under `/api/groups/{id}/access-requests...` are covered by L116/L117, but add row tests for them. Register literal segments before `/{group_id}`.
6. **Access DTO.** Extend `GroupAccessDetails` with `access_request_status: PENDING|REJECTED|null` (or a small nested object), and redefine `can_join` as "can request" (logged-in, not a member, no pending request), or rename it. Update the three exact-dict tests.
7. **Frontend.**
   - TermPage branches on `access.can_view_content`, not on `visibility`.
   - The gate component has four states: logged out (`AuthGateLinks`, so no auth-only calls, which avoids the 401 redirect), can request ("Poproś o dostęp", which opens a confirm-only `RequestAccessDialog` built from the JoinPrivateGroupDialog markup with `.kg-*` classes, busy/formError and Polish copy), pending (status line), and rejected (message, and re-request if the spec allows it).
   - Derive state only from the server and drop the local `joined` flag.
   - Optionally refetch on window focus.
8. **Organizer UI.** Add a `PendingJoinRequestAction` to `PanelDataContext`, built from the new notification kind (use `join_request_id` if added, otherwise fetch the pending list for the group), with Akceptuj/Odrzuć/Później in `GlobalPendingActionsModal`. Fix the 409 envelope check and avoid `as number` casts. A per-group list in the panel is optional if the spec requires it.
9. **Testing strategy.** Integration-first per the standards (2-8 tests per group): model and constraint, use cases, router and matrix, access DTO (member sees content, wrong termId 404), and the frontend TermPage gate states plus the PanelPage pending action (remember the fixed `../api/groups` mock list).
10. **Side fix (low risk).** Restore the heading ids or change to `aria-label` in `NeededItemsSection` and `AttendeeList`.

---

## Next Steps

Invoke the gap-analyzer with this report and the research context (`research-report.md`, `fsm-research-report.md`). Open decisions to settle during gap analysis and specification:
- The exact notification kinds and whether to add a `join_request_id` column or rely on `link_path`.
- Whether withdraw and re-request after rejection are in scope.
- The replacement strategy for the 11 test helpers that depend on `POST /api/memberships`.
- Whether the organizer UI is only the global pending-actions modal, or also a per-group request list.
- Whether to redefine or rename `can_join` in the access DTO.
