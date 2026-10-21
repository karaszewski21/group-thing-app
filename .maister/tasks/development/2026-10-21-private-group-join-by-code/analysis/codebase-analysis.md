# Codebase Analysis Report

**Date**: 2026-10-21
**Task**: Join a PRIVATE group with a 6-digit organizer access code, and fully remove the GroupJoinRequest ("poproś o dostęp") mechanism
**Description**: Plaintext `groups.join_code`; lazy get-or-create `GET /api/groups/{id}/join-code`; `POST .../join-code/regenerate`; redeem `POST /api/groups/public/{id}/join-code` behind a dual in-process limiter (429). Remove GroupJoinRequest across backend, frontend, notifications, tests and migrations (0059 adds the column, 0060 drops the table). Design: `analysis/research-context/high-level-design.md`
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)
**Baseline**: HEAD `1f92648`, Alembic head `0058` (single head)

---

## TL;DR
- Most of this task is removal. GroupJoinRequest appears in 23 backend files (401 hits), in about 12 frontend source files and in 9 frontend test files. Two backend modules, three backend test files, one hook and one dialog get deleted outright.
- The new code fits existing patterns. Membership is granted the way join-request approval grants it today. The organizer guard is `_require_active_organizer` in `circles.py`. The authorization matrix needs one new AUTHENTICATED row for redeem.
- There are three real gaps. `errors.py` has no way to send custom headers, so 429/Retry-After support has to be added. `Group.updated_at` doubles as the optimistic-lock version, so a lazy code write on a GET can raise 409 under a race. `add_active_membership` has no uniqueness guard, so a double submit can create duplicate memberships.
- The design's line references are mostly correct. 7 backend and 5 frontend discrepancies are listed below.

## Key Decisions
- **Model the new application module on `join_requests.py`, then delete it.** Copy the caller-party lookup (401), the private-group lookup (404) and the grant pattern (`if not _is_active_member: add_active_membership; commit`) into `application/join_code.py`. This reuses code that is already tested and keeps the same error order.
- **Add a `headers` param to `_envelope` and a new `TooManyAttemptsException` (429 + Retry-After) in `app/core/errors.py`.** No error response sets headers today. Register the handler before the generic `ValueError`/`Exception` handlers.
- **Put the limiter in its own module (e.g. `app/core/rate_limit.py`), modeled on `app/oauth2/stores.py`.** That file already uses dict + `asyncio.Lock` module singletons with lazy pruning. Use `time.monotonic`, which the domain-clock guard allows. Add `reset()` plus an autouse fixture in `tests/conftest.py`.
- **Lazy GET: catch `StaleDataError`, roll back, re-read and return the stored code.** Without this, a race on a plain GET returns 409. For regenerate, returning 409 on a race is fine.
- **Keep `join_code` out of every existing response schema** (`GroupResponse`, `PublicCircleResponse`, `ModerationGroupResponse`). Only `JoinCodeResponse` exposes it.
- **Frontend: use `useCallback` + api call + `await invalidateQueries`, not `useMutation`.** `useMutation` is used nowhere in the codebase. The convention lives in `hooks/useCategories.ts:48-60`.
- **Visitor sheet: build on `components/krag/ModalSheet.tsx`, not the panel ModalSheet.** The krag one has Esc, focus trap, focus return and `useRegisterOpenSheet`.
- **Migration 0060 should only `drop_column` / `drop_table` and delete `GROUP_JOIN_%` notifications.** `join_request_id` has no FK or index, `kind` is VARCHAR(30) and not a PG enum, and the sequence is already gone since 0041. Do not drop it again.

## Open Questions / Risks
- **Lazy-write 409 race.** Concurrent lazy GETs, regenerate and `update_group` all bump the versioned `updated_at`. The recommended mitigation is catch → rollback → re-read. Without it, an organizer can see a 409 on a page that only reads.
- **Duplicate memberships.** `add_active_membership` has no uniqueness constraint. A redeem double submit (two tabs, or a retry) can insert two active memberships. Mitigate with an in-request `_is_active_member` re-check, or with a 409 on conflict. A partial unique index is out of scope unless the operator wants it.
- **Retry-After cannot be read client-side.** `ApiError` (`api/client.ts:1-13`) does not carry headers. The "{n} min" text has to come from the server's `message`, and `serverMessageOr` must pass 429 messages through.
- **The limiter is single-process.** Like the OAuth2 stores, it resets on restart and does not work across workers. Document this in a docstring caveat.
- **No shared toast host.** `useToast` returns state only, and each page renders its own `role=status` pill. `GroupDetailsPage` sits outside `PanelDataProvider`, so it cannot use the panel toast.
- **No confirm dialog fits regenerate.** `ConfirmDeleteDialog` hard-codes `bg-danger` and "Usuwanie…". Regenerate needs a non-danger variant. If it opens over the stepper, it must use the z-70 alertdialog pattern.
- **Lazy generation bumps `Group.updated_at`.** This is a minor audit-timestamp side effect, and acceptable.

---

## Discrepancies vs research design

### Backend
1. **`tests/test_authorization_matrix.py` line numbers are wrong.** The design says l.128-148. The join-request parametrize block is actually l.115-127 (rows l.118-123), and `test_resolveRequirement_joinRequestRoutes_resolveToExpectedRow` is l.128-135. Keep l.124 (`POST /api/groups/public/42/join` → EDIT) and l.125 (`/api/memberships/42/end` → EDIT), which are not join-request cases. Also keep l.138-147, which are organizer-page tests.
2. **`tests/test_group_soft_delete_reads.py` has a second site.** Besides `test_pendingJoinRequestsInbox_excludesDeletedGroup` (l.192-209), `test_mutationsOnDeletedGroup_return404` has a "join request" entry at l.243-245 that posts to `/public/{id}/join-requests`. Remove it, or replace it with a join-code redeem expecting 404.
3. **Wrong source references for the helpers to port.**
   - `join_requests.py` l.52-59 is `_get_caller_party_id`, and l.71-75 is `_get_private_group` (PUBLIC → 404).
   - `_require_active_organizer` is defined in `app/groups/application/circles.py:364`, not in `join_requests.py`.
   - The 401 comes from `AuthenticationRequiredException` in `app.core.auth_deps`, not from `errors.py`.
   - `_get_caller_party_id` is annotated `-> tuple[int, str]`, but `party_id` is a `uuid.UUID`. Fix the annotation when porting.
4. **Stale prose and imports the design does not list:**
   - `tests/test_private_group_access_defects.py:1-7` (docstring)
   - `tests/test_add_active_membership.py:1-2`
   - `app/groups/schemas.py:357, 362-363`. Also remove the `GroupJoinRequestStatus` import at l.17, but keep the `Literal` used at l.387.
   - `app/core/authorization_matrix.py:94` (comment)
   - `app/groups/infrastructure/repository.py:3`
   - `app/notifications/models.py:48-50`
   - `app/notifications/service.py:47-49`
5. **`public_view.py` `create_rsvp` comment (l.455-457).** It mentions join requests, but the `cast` it sits next to is still used. Edit the prose only.
6. **The `join_request_id` column needs no FK/index cleanup**, and `kind` needs no enum or CHECK change. Migration 0060 still needs an explicit `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'` (precedent: 0042:48-51). The sequence was already dropped in 0041.
7. **0060 downgrade** must recreate `group_join_requests` in its post-0041 UUID shape, not the original 0037 shape.

### Frontend
8. **`PendingActionsHost.test.tsx:400` is missing from the design's test plan.** It sits outside the join-request describe block and asserts invalidation of `PENDING_JOIN_REQUESTS_KEY` (`invalidationsAtEmit` `[2]` → `[1]`).
9. **`TermPage.test.tsx:710` asserts "Prośba wysłana".** This token-change retry test has to be rewritten, not deleted.
10. **`PublicLayout.test.tsx`** mocks `groups` only for join requests (l.20-24, 52, 139, 142-147). The mock and the "no join-request fetch" assertions go away. **`CreateGroupStepper.test`** has a `PRIVATE_DONE` fixture (l.73-74, used 254-278) whose copy changes, and the test needs a `getJoinCode` mock.
11. **Theme test lists are not covered by the design:**
    - Add `JoinByCodeSheet` to `themeDefects.test.tsx` `IN_SCOPE_FILES` (l.83-127) and to `NO_LEGACY_UTILITY_FILES`.
    - Do **not** add `JoinCodeCard` (panel, uses mint) to `NO_LEGACY_UTILITY_FILES` (l.74-97).
    - Remove `RequestAccessDialog` from `themeTokenUsage.test.tsx` (l.6, 8-10, 81, 146-160).
    - In `ModalSheet.test.tsx` (l.158-194), the registry count of 3 includes `RequestAccessDialog`. Update it.
12. **Design assumptions that don't match the codebase:**
    - The design assumes a `useMutation` hook, a shared toast and a readable Retry-After header. None of these exist (see Key Decisions and Risks).
    - There are two ModalSheet implementations. The krag one has Esc and focus trap. The panel one (`pages/panel/panelComponents.tsx:213`) has neither.
    - `GroupDetailsPage` currently loads no terms. Use `api/terms.ts:66 getTerms(circleGroupId)` (matrix row 32, READ), and skip the call for PUBLIC groups via `group.visibility`.

All other frontend line references in the design checked out as accurate.

---

## Summary

The GroupJoinRequest mechanism is self-contained and safe to remove:
- **Backend:** the model, schemas, application module, router, repository section, notification kinds and column, 6 matrix rows, and 3 dedicated test files, plus edits in about 20 other files.
- **Frontend:** the API section, a hook, a dialog, the `jr:` pending actions, and the PrivateGroupGate body.
- **Bell:** the notification bell never references `GROUP_JOIN_*`.

The new join-code feature reuses the existing organizer/member guards, the membership grant path, the error envelope and the matrix machinery. It needs three small infrastructure additions: a header-capable 429 handler, an in-process limiter with a test reset, and a StaleDataError-tolerant lazy write.

---

## Files Identified

### Primary Files — Backend (modify)

**app/groups/models.py**
- `GroupJoinRequestStatus` (l.63-67), `GroupVisibility` docstring (l.84-90), `GroupJoinRequest` (l.195-224): remove.
- `Group` (l.96-130): add `join_code: Mapped[str | None] = mapped_column(String(6), nullable=True)` after `default_capacity` (l.129). `String` is already imported.

**app/groups/schemas.py**
- Remove `CreateJoinRequestRequest`, `JoinRequestResponse`, `PendingJoinRequestResponse` and `JoinRequestSummary` (l.718-752), the `join_request` field (l.368), the related prose (l.357, 362-363) and the import at l.17.
- Add `JoinCodeResponse`, `RedeemJoinCodeRequest` (pattern `^\d{6}$` → 400 "Validation failed") and `RedeemJoinCodeResponse`.

**app/groups/service.py**
- Remove the join-request imports (l.42-49) and `__all__` entries (l.112, 120, 143, 153, 167, 181).
- Re-export the join-code functions.

**app/groups/router/__init__.py**
- Remove `join_requests` (l.1, 16, 35).
- Include the new `join_code` router. The include order is organizer_page, circles, join_requests, leaderships, …

**app/groups/application/public_view.py**
- Remove `_GATE_JOIN_REQUEST_STATUSES` (l.349-351), the docstring (l.370-374), the block (l.399-407) and `join_request=` (l.417).
- Edit the comment at l.455-457.
- `get_group_access` (l.354-420) already reports `is_member` after a redeem, so no logic change is needed.

**app/groups/infrastructure/repository.py**
- Remove the docstring line (l.3), the imports (l.41-42) and the section at l.686-761:
  - `get_join_request`
  - `find_pending_join_request`
  - `find_latest_join_request`
  - `has_join_request_closed_since`
  - `PENDING_JOIN_REQUESTS_LIMIT`
  - `list_pending_join_requests_for_groups`
- `datetime`, `Row` and `exists` are still used elsewhere, so keep those imports.

**app/groups/infrastructure/notifications_bridge.py**
- Remove l.28 and l.37.

**app/notifications/models.py, schemas.py, service.py**
- Remove the `GROUP_JOIN_*` kinds (models l.63-65), the `join_request_id` column (models l.91-96), the docstring (l.48-50), `schemas.py:23`, and `service.py` l.40, 47-49, 59.

**app/core/authorization_matrix.py**
- Remove the join-request rows (l.107-117) and the comment at l.94.
- Add an AUTHENTICATED row for `POST ^/api/groups/public/[^/]+/join-code$` before row 27 (l.135, `POST ^/api/groups(/.*)?$` EDIT).
- `GET .../join-code` falls through to row 26 (l.134, READ). Regenerate falls to row 27 (EDIT). Neither collides with the PATCH/DELETE (l.123), moderation (l.127) or restore (l.128) rows.

**app/core/errors.py** (162 lines)
- Add `TooManyAttemptsException(retry_after_seconds)`, a `headers` parameter for `_envelope` (l.71-83), and a 429 "Too Many Requests" handler that sets Retry-After.
- Register the handler in `register_exception_handlers` (l.144-162) before the generic handlers.

### Primary Files — Backend (delete)

- **app/groups/application/join_requests.py** (279 lines). Read it for the patterns to port before deleting.
- **app/groups/router/join_requests.py** (91 lines), with 6 routes: POST l.29, POST l.45, GET `/api/groups/mine/join-requests` l.58, GET `/api/groups/{group_id}/join-requests` l.65, POST l.72, POST l.83.

### Primary Files — Backend (create)

- **app/groups/application/join_code.py**: `get_join_code`, `regenerate_join_code`, `redeem_join_code`.
- **app/groups/router/join_code.py**: copy the route aliases from `router/join_requests.py:21-26`. Put the literal `/public/` path before `{group_id}`.
- **app/core/rate_limit.py** (suggested): the dual limiter.
- **alembic/versions/0059_group_join_code.py**: add the nullable `join_code` column (down revision 0058).
- **alembic/versions/0060_drop_group_join_requests.py**: delete `GROUP_JOIN_%` notifications, drop `notifications.join_request_id`, drop the `group_join_requests` table. The downgrade recreates the table in its post-0041 UUID shape.

### Related Files — Backend (read/reuse, no change)

- **app/groups/application/circles.py**:
  - `get_group` l.167 (404, including soft-deleted)
  - `_is_active_organizer` l.356
  - `_require_active_organizer` l.364 (403)
  - `update_group` l.228-265 (lock contention)
  - `_group_response` l.65-72
  - `GET /api/groups/{id}` l.303-306
- **app/groups/application/memberships.py**: `add_active_membership` l.28 (flush only, caller commits) and `_is_active_member` l.59.
- **app/users/service.py**: `get_profile_by_principal` l.97. Every account gets READ+EDIT (l.63).
- **app/core/_auth/dependencies.py:21-39**: `require_any` (401, then 403).
- **app/core/_auth/exception_handlers.py**: the 401 handler.
- **app/core/base_model.py:41-68**: `updated_at` as `version_id_col`.
- **app/core/clock.py** and **tests/test_domain_clock_guard.py:25-39**: the guard only scans for `datetime.now(` and `date.today(`.
- **app/oauth2/stores.py**: precedent for the in-process store.
- **app/main.py:144-145**: handler registration.
- **Alembic 0037/0038/0040/0041/0042**: history stays untouched. 0042:48-51 is the precedent for deleting notifications by kind.

### Primary Files — Frontend (paths relative to `src/frontend/src`)

**api/groups.ts**
- Remove the docstring (l.13-16), `GroupAccessDetails.join_request` (l.268-271), and the section at l.461-516:
  - types: `JoinRequestStatus`, `JoinRequestSummary`, `JoinRequestResponse`, `PendingJoinRequestResponse`
  - calls: `createJoinRequest`, `withdrawJoinRequest`, `listMyPendingJoinRequests`, `approveJoinRequest`, `rejectJoinRequest`
- Add `getJoinCode`, `regenerateJoinCode`, `redeemJoinCode`.

**api/notifications.ts**
- Remove the kinds (l.15-17) and `join_request_id` (l.33-37).

**api/problem.ts**
- `serverMessageOr` (l.67-79): add 429 to the statuses whose server message passes through (around l.71).
- Check whether `ACCESS_DENIED_MESSAGE` (l.59-60) copy references requesting access.

**components/pending/**
- `pendingActions.ts` (l.1, 42-54, 56, 66-71, 94-110): `derivePendingActions` goes back to one param and only `n:` keys.
- `PendingActionsHost.tsx`: remove the many blocks, including `JoinRequestActionSheet` (l.306-377).
- `snoozeStore.ts`: l.3-4.

**pages/krag/**
- `PrivateGroupGate.tsx`: keep the shell. Replace the body with the join-by-code form and the login CTA. Remove:
  - withdraw
  - `createConflict`
  - focus/visibilitychange polling (l.52-67)
  - the `canRequest` / `pending` / `rejected` states
- `termAccess.ts`: union (l.4-8), l.21-24.
- `TermPage.tsx` (52 lines): add `?code=` handling with `useSearchParams` after `ready && !isStale`. For the `setSearchParams(..., {replace})` precedent, see `PublicOrganizationPage.tsx:74,100`.

**pages/panel/**
- `GroupDetailsPage.tsx` (175 lines, label at l.11): add `JoinCodeCard` for PRIVATE groups.
- `CreateGroupStepper.tsx` (246 lines): update the PRIVATE copy at l.145 and show the code on the done screen (l.138-170).
- `GroupFormFields.tsx:74`: update the option copy.

**Delete:**
- `hooks/usePendingJoinRequests.ts` (`PENDING_JOIN_REQUESTS_KEY`)
- `components/krag/RequestAccessDialog.tsx`

**Create:**
- `components/krag/JoinByCodeSheet.tsx` (or an inline form)
- `utils/joinCode.ts` (parser, modeled on `parseCapacity` in `panelHelpers.ts:117-123`)
- a join-code hook in `hooks/`
- `JoinCodeCard` in the panel

### Related Files — Frontend

- `components/krag/ModalSheet.tsx`, `trapFocus.ts`, `components/shared/openSheets.ts`
- `components/shared/ConfirmDeleteDialog.tsx`: template for a non-danger confirm.
- `ShareButton.tsx:30, 52-58`: clipboard and status pill.
- `pages/krag/hooks/useToast.ts`
- `hooks/useGroupDetails.ts`, `hooks/useTermAccess.ts`
- `api/terms.ts:66` (`getTerms`)
- `panelHelpers.ts:158` `termPublicPath`, re-exported by `PanelDataContext.tsx:83`. The copy-link pattern is at `PanelDataContext.tsx:905-911`.
- `CapacityField` (`panelComponents.tsx:174-208`): input template.
- `AuthGateSheet.tsx:15`: its prose is still valid.
- `router.tsx:115`: the `/panel/grupy/:groupId` route.

---

## Current Functionality

PRIVATE groups currently use a request/approve flow:
1. A logged-in non-member opens a term page.
2. `GET` group access returns a `join_request` summary.
3. `PrivateGroupGate` shows "poproś o dostęp" through `RequestAccessDialog`, and the visitor creates a request.
4. The organizer gets a `GROUP_JOIN_*` notification. It appears in `PendingActionsHost` as a `jr:` action and in the panel inbox.
5. Approving grants an active membership through `add_active_membership`. Rejecting closes the request.
6. A partial unique index enforces one PENDING request per requester and group.

### Key Components/Functions

- **`_get_caller_party_id`** (`join_requests.py:52`): principal → profile party id. A missing profile raises 401.
- **`_get_private_group`** (`join_requests.py:71`): `get_group` returns 404 for missing or soft-deleted groups, then the function returns 404 if the group is not PRIVATE.
- **`_require_active_organizer`** (`circles.py:364`): 403 for non-organizers. The organizer read order is caller party → `get_group` → organizer check (`join_requests.py:273-279`).
- **Grant pattern** (`join_requests.py:207-208`): `if not _is_active_member: add_active_membership(...)`, then commit and refresh.
- **Conflict pattern** (`join_requests.py:98-101`): `BusinessConflictException("Masz już dostęp do tej grupy")`.
- **`get_group_access`** (`public_view.py:354-420`): computes `is_organizer` / `is_member` (l.384-386) and builds the join-request block.
- **`create_rsvp`** PRIVATE branch (`public_view.py:454-464`): requires an account-backed profile and an organizer or member caller.

### Data Flow (target)

**Organizer:**
1. `GroupDetailsPage` / `CreateGroupStepper` calls `GET /api/groups/{id}/join-code`.
2. The backend runs caller party (401) → `get_group` (404) → `_require_active_organizer` (403).
3. If `join_code` is null, it generates `f"{secrets.randbelow(10**6):06d}"` and commits. On `StaleDataError` it rolls back and re-reads.
4. It returns `JoinCodeResponse`.
5. Regenerate follows the same path and always writes a new code. A race returns 409.

**Visitor:**
1. `TermPage` sees `?code=` or the gate form and calls `POST /api/groups/public/{id}/join-code {code}`.
2. Schema validation returns 400 if the format is bad.
3. The backend runs caller party (401) → private group (404) → limiter check (429 + Retry-After) → `compare_digest` against the stored code (wrong code records a failure; 409 or 400 per design) → already a member? → `add_active_membership` → commit → 200.
4. The frontend invalidates `["groupAccess", groupId, …]`. `/access` now reports a member, and the gate opens.

---

## Dependencies

### Imports (what the new code depends on)
- `app.core.auth_deps`: `Principal`, `AuthenticationRequiredException`.
- `app.core.errors`: `EntityNotFoundException`, `BusinessConflictException`, `AccessDeniedException`, plus the new `TooManyAttemptsException`.
- `.circles`: `get_group`, `_require_active_organizer`, `_is_active_organizer`.
- `.memberships`: `_is_active_member`, `add_active_membership`.
- `app.users.service.get_profile_by_principal`.
- stdlib: `secrets`, `time.monotonic`, `asyncio.Lock`.
- `sqlalchemy.orm.exc.StaleDataError`.

### Consumers (what depends on the code being removed)
- Backend: `service.py`, `router/__init__.py`, `public_view.py`, `notifications_bridge.py`, the notifications model/schemas/service, the authorization matrix, and 8 test files.
- Frontend: `api/groups.ts` consumers (`PrivateGroupGate`, `PendingActionsHost`, `RequestAccessDialog`, `PublicLayout` via the pending hook), `termAccess.ts`, `pendingActions.ts`, `snoozeStore.ts`, and 9 test files.

**Consumer Count**: about 35 files touched across both stacks
**Impact Scope**: High in breadth, Low-Medium in depth. Removal is mechanical and the bell does not reference these kinds. The new feature adds a single vertical.

---

## Test Coverage

### Test Files

**Backend — delete:**
- `tests/test_group_join_request_model.py` (163)
- `tests/test_group_join_requests_router.py` (389). Before deleting it, copy out the helpers at l.24-58: `_register`, `_create_circle_and_term(private=True)` via PATCH.
- `tests/test_group_join_requests_decisions.py` (353)

**Backend — edit:**
- `tests/test_group_access.py`:
  - docstring l.2
  - key sets at l.64-69 / 82-87 / 103-108: drop `join_request`
  - l.123
  - `_request_access` helper (l.298-305)
  - tests at l.316, 344, 366 and 393: delete, or rewrite as redeem flows
- `tests/test_authorization_matrix.py`: l.115-135 (see Discrepancy 1). Add redeem/get/regenerate cases.
- `tests/test_group_soft_delete_reads.py`: l.192-209 and l.243-245.
- Prose only: `tests/test_add_active_membership.py`, `tests/test_private_group_access_defects.py`.

**Backend — new:**
- `tests/test_group_join_code.py` (2–8 tests per the standards). Cover:
  - lazy create, then the same code on a second GET
  - organizer 403 and 404 cases
  - regenerate changes the code
  - redeem success makes `/access` report a member
  - wrong code
  - 429 with Retry-After
  - 401 when anonymous
  - redeem on a PUBLIC group returns 404
- `tests/test_group_join_code_migration.py` and a 0060 migration test: downgrade, then upgrade head, per `standards/backend/migrations.md`.
- Add a limiter reset fixture (autouse in `conftest.py`).

**Frontend — edit:**
- `TermPage.test.tsx`: l.11, 21-22, 123, 516-540, the 569-731 private-gate describe (10 tests; rewrite l.710), l.788. `?code=` tests need a different `initialEntries`.
- `termAccess.test.ts`: l.25, 37-50.
- `PendingActionsHost.test.tsx`: l.19, 28-32, 133, 400, and the 544-733 describe (8 tests).
- `PublicLayout.test.tsx`, `ModalSheet.test.tsx`, `themeTokenUsage.test.tsx`, `themeDefects.test.tsx`.
- `GroupDetailsPage.test`: add `getJoinCode` / `regenerateJoinCode` / `getTerms` mocks and a PRIVATE fixture.
- `CreateGroupStepper.test`, `useTermAccess.test`, `serverMessageOr.test.ts` (add a 429 row).
- Stub the clipboard with `Object.assign(navigator, {clipboard})` (precedent `PanelPage.test.tsx:232-235`).

### Coverage Assessment
- **Existing**: the removal paths are well covered. This is why the test churn is large: about 20 backend and about 26 frontend join-request tests get deleted or rewritten.
- **Gaps**: no limiter tests exist yet, there is no test for duplicate-membership races, and no test hits a StaleDataError on a GET.

---

## Coding Patterns

### Naming Conventions
- **Backend modules**: `app/groups/application/<feature>.py` and `app/groups/router/<feature>.py`. Service functions take `(db, principal, group_id, ...)`.
- **Tests**: flat `tests/test_<feature>.py`, named `test_<operation>_<scenario>_<expected>` in camelCase.
- **Migrations**: `NNNN_snake_slug.py` with a bare `revision = "0059"`. The docstring has a lowercase title, prose, then Revision ID / Revises / Create Date.
- **Frontend**: PascalCase components, `use*` hooks in `src/hooks/`, API functions in `src/api/*.ts`.

### Architecture Patterns
- **Backend**: a functional application layer over repository functions. Errors are typed exceptions mapped centrally to the `{status, error, message, fieldErrors, timestamp}` envelope. Authorization goes through `Depends(require_any(...))` plus the `AUTHORIZATION_MATRIX` reference test.
- **Frontend state**: TanStack Query hooks with array keys. Writes go through `useCallback` + api call + `await invalidateQueries`. Polish UI copy. Accessible sheets go through the krag `ModalSheet`.
- **Input**: `type="text" inputMode="numeric" pattern="[0-9]*"`, raw string kept in state, a shared parser, and an inline `role="alert"` error with `aria-invalid` / `aria-describedby`.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~35 files modified, ~9 created, ~7 deleted | High |
| Dependencies | ~8 imports for the new module | Medium |
| Consumers | 23 backend + ~21 frontend files referencing join requests | High |
| Test Coverage | Strong existing coverage; ~46 tests to delete/rewrite, ~15-20 new | Medium (good coverage, high churn) |

### Overall: Complex

The design is simple: one new vertical that reuses existing guards. The complexity is in breadth: coordinated removal across both stacks, two migrations with reversible downgrades, and three infrastructure additions (429 handler with headers, in-process limiter, StaleData-tolerant lazy write).

---

## Key Findings

### Strengths
- The join-request code contains every pattern needed for redeem: the 401/404 helpers, the organizer guard and the grant path.
- The authorization matrix has room for the new row without collisions.
- The `join_request_id` column and the `kind` enum are loose, which makes migration 0060 simple.
- The frontend gate shell, `?code=` URL handling precedents and krag `ModalSheet` can be reused directly.

### Concerns
- Optimistic locking on `Group` turns a lazy GET into a possible 409.
- `add_active_membership` has no uniqueness guard.
- The error envelope cannot send headers.
- Retry-After is invisible to the frontend.
- There is no `useMutation`, no shared toast and no non-danger confirm dialog.

### Opportunities
- Fix the `_get_caller_party_id` return annotation (`uuid.UUID`) when porting.
- Copy the test helpers out of `test_group_join_requests_router.py` before deleting it.
- Put a single limiter reset fixture in `conftest.py` to prevent cross-test leaks.

---

## Impact Assessment

- **Primary changes**: `app/groups/{models,schemas,service}.py`, `app/groups/router/__init__.py`, `app/groups/application/public_view.py`, `app/groups/infrastructure/{repository,notifications_bridge}.py`, `app/notifications/*`, `app/core/{authorization_matrix,errors}.py`; frontend `api/groups.ts`, `api/notifications.ts`, `api/problem.ts`, `components/pending/*`, `pages/krag/{PrivateGroupGate,termAccess,TermPage}`, `pages/panel/{GroupDetailsPage,CreateGroupStepper,GroupFormFields}`.
- **Related changes**: migrations 0059/0060, the new limiter module, `tests/conftest.py`, and the theme test lists.
- **Test updates**: delete 3 backend test files, edit 5 backend and 9+ frontend test files, and add the join-code backend tests, migration tests and frontend component/hook tests.

### Risk Level: Medium

- The removal is broad but mechanical, and grep can verify it is complete (target: zero `join_request` / `JoinRequest` / `GROUP_JOIN_` hits outside Alembic history).
- The real behavioral risks are narrow: the lazy-write race, duplicate memberships, limiter correctness and test isolation, and the migration downgrade shape.
- This is a hard cutover with no backward-compatibility requirement. Any PENDING requests in production will be dropped, so confirm with the operator.

---

## Recommendations

**Implementation order (backend first):**
1. Migration 0059 and `Group.join_code`. Migration test.
2. `errors.py`: add the `headers` param to `_envelope`, `TooManyAttemptsException` and the 429 handler.
3. The limiter module, with `reset()` and an autouse fixture.
4. `application/join_code.py`, the schemas, the service re-exports, `router/join_code.py` and the matrix row with its tests. Redeem order: 401 → 400 (schema) → 404 → 429 → wrong code → already-member short-circuit → grant.
5. Remove join requests across the backend, then migration 0060 and its test.
6. Frontend API and hooks, `problem.ts` (429), `PrivateGroupGate` / `TermPage` `?code=`, `JoinCodeCard` on `GroupDetailsPage` (PRIVATE only), and the `CreateGroupStepper` done screen.
7. Remove join requests across the frontend: pending actions, `RequestAccessDialog`, the hook and the test lists.

**Guardrails:**
- Compare codes with `secrets.compare_digest`.
- Never add `join_code` to the existing response models. Assert the exact key sets in the tests.
- Lazy GET: catch `StaleDataError`, then `rollback()` and re-read (tests use `expire_on_commit=False`, `conftest.py:101-106`).
- Redeem: re-check `_is_active_member` before inserting, and treat an existing member as an idempotent success.
- Have the server put the minutes in the 429 `message` text. Keep the Retry-After header for non-browser clients.
- Run `uv run python -m pytest|mypy|ruff` from `src/backend`. Run `npm test`, `npm run lint` and `npx tsc -b` from `src/frontend`. The mypy baseline at HEAD is about 32 errors.

---

## Next Steps

Invoke the gap-analyzer with this report and `research-context/high-level-design.md`. Ask the operator to resolve these points first:
- the lazy-write race strategy
- idempotent vs 409 redeem for existing members
- the wrong-code status code
- dropping any in-flight PENDING requests
