# Implementation Plan: Join a PRIVATE group with a 6-digit access code (replacing GroupJoinRequest)

## TL;DR
9 task groups, 62 steps, about 48 tests in the implementation groups plus at most 10 from the review group. The backend chain is DB column (1), then 429 and limiter (2), then the join-code API (3), then join-request removal (4). Groups 1 and 2 are independent of each other.
The frontend starts with API/hooks/utils (5), which feeds the visitor UI (6) and the organizer UI (7). Groups 6 and 7 touch no common file. Frontend removal (8) follows 6.
The frontend mocks every API call in tests, so groups 5–8 do not wait for the backend; spec R9/R15 is the shared contract. Group 9 reviews test gaps, runs the R31 removal gate, edits the R32 prose and runs the full suites.

## Key Decisions
- Migration 0060 (drop `group_join_requests` and `notifications.join_request_id`) ships in Group 4, together with the ORM removals, not in Group 1. If it landed earlier, `/access` (`public_view.py` still queries join requests) and every `Notification` load (the model still maps `join_request_id`) would fail in the Group 3 tests.
- Group 3 adds the join-code feature beside the old join-request code, and Group 4 then deletes the old code. Groups 3 and 4 both edit `service.py`, `schemas.py`, `router/__init__.py`, `authorization_matrix.py` and `test_authorization_matrix.py`, so they run strictly in sequence. This order also lets Group 3 copy the test helpers out of `test_group_join_requests_router.py` before Group 4 deletes that file (R13).
- The "join_code absent from responses" exact-key-set assertions go in Group 4 (`test_group_access.py`). Group 4 removes `join_request` from `/access`, so the key set is final only at that point.
- `RequestAccessDialog.tsx` is deleted in Group 6, not Group 8. `PrivateGroupGate` is its only importer, and the `ModalSheet`/theme test swaps to `JoinByCodeSheet` belong with the new sheet. Group 8 keeps the pending-actions and API/notification-type removal.
- The `api/groups.ts` join-request section and `GroupAccessDetails.join_request` are removed in Group 8, not Group 5. `PendingActionsHost`/`usePendingJoinRequests` (Group 8) and `termAccess.ts` (Group 6) still read them until then, and `npx tsc -b` must stay green after every group.
- The expected test count (about 48–58) is above the generic 16–34 guidance. The feature spans 8 implementation groups across two stacks, and the spec's Testing Approach sets these counts. Each group stays within 2–8 new or rewritten tests.

## Open Questions / Risks
- **Contract drift between stacks:** frontend groups 5–8 run against mocks. Field names (`code`, `created`), status codes and Polish messages must match spec R7–R9/R16 exactly. Group 9 includes a manual two-account check (Success Criterion 1).
- **Shared-file contention:** see the "Shared files" table. Every file that two groups touch is ordered by a dependency, so no two concurrently runnable groups edit the same file.
- **mypy baseline (~32):** Groups 2–4 add or remove typed modules. Each runs mypy on the touched paths, and Group 9 checks that the total is no worse than the baseline.
- **Large frontend test rewrites** (`TermPage.test.tsx` private-gate describe at l.569-731, `PendingActionsHost.test.tsx` at l.544-733) can hide regressions. Group 9's gap review re-reads them against R22–R24/R30.
- **TaskCreate is unavailable** in this planner run, so group-level task items were not created. The markdown checkboxes and the HTML companion's progress markers are the tracking source.

## Overview
Total Steps: 62
Task Groups: 9
Expected Tests: about 48 in groups 1–8, plus at most 10 in Group 9 (about 48–58 total)

## Implementation Steps

### Task Group 1: Database Layer — `groups.join_code` column (migration 0059)
**Dependencies:** None
**Files to Modify:** src/backend/app/groups/models.py, src/backend/alembic/versions/0059_group_join_code.py, src/backend/tests/test_group_join_code_migrations.py
**Estimated Steps:** 4

- [ ] 1.0 Complete the database layer (R1, R2)
  - [ ] 1.1 Write 2 focused migration tests in `tests/test_group_join_code_migrations.py`, following `tests/test_group_soft_delete_migration.py`:
    - `test_downgrade0058_dropsJoinCode_upgradeHeadRestoresIt`: after `downgrade 0058` the column is absent; after `upgrade head` it is `VARCHAR(6)`, nullable, with no index.
    - `test_insertGroup_withoutCode_joinCodeIsNull`: a new group row has `join_code IS NULL` (no backfill).
  - [ ] 1.2 Add `join_code: Mapped[str | None] = mapped_column(String(6), nullable=True)` after `default_capacity` on `Group` in `app/groups/models.py`. Do not expose it in any schema.
  - [ ] 1.3 Create `alembic/versions/0059_group_join_code.py` with `revision = "0059"` and `down_revision = "0058"`. `upgrade()` runs `op.add_column("groups", sa.Column("join_code", sa.String(6), nullable=True))`, with no backfill and no index. `downgrade()` drops the column.
  - [ ] 1.4 Run ONLY the 2 new tests: `uv run python -m pytest tests/test_group_join_code_migrations.py`, plus `uv run python -m ruff check` on the touched files.

**Acceptance Criteria:**
- The 2 tests pass.
- `alembic downgrade 0058 && alembic upgrade head` succeeds.
- The column is nullable `VARCHAR(6)` with no index, placed after `default_capacity` in the model.

### Task Group 2: Backend Core — 429 exception/handler and join-code limiter
**Dependencies:** None
**Files to Modify:** src/backend/app/core/errors.py, src/backend/app/groups/application/join_code_limiter.py, src/backend/tests/test_join_code_limiter.py, src/backend/tests/conftest.py
**Estimated Steps:** 5

- [ ] 2.0 Complete the 429 plumbing and the limiter (R3, R4, R5)
  - [ ] 2.1 Write 6 focused tests in `tests/test_join_code_limiter.py`. Five are pure unit tests on a `JoinCodeLimiter(clock=fake)`:
    - The user key blocks on the 11th `check` after 10 failures, and the window slides after 15 min.
    - The group key blocks at 30 failures spread across different parties.
    - `clear()` resets the user key only; the group key keeps counting.
    - `retry_after_seconds` is the longest wait among the exceeded keys, `max(1, ceil(wait))`, uses `ts[len - limit]` under overshoot, and the message reads `Za dużo prób wpisania kodu — spróbuj ponownie za {n} min` with `n = ceil(s/60)`.
    - Pruning deletes keys whose lists become empty.

    The sixth test is a handler test. It mounts a minimal FastAPI app with `register_exception_handlers` and a route raising `TooManyAttemptsException("x", 61)`, then asserts status 429, the standard envelope with `message == "x"`, and header `Retry-After: 61`.
  - [ ] 2.2 `app/core/errors.py`:
    - Add `TooManyAttemptsException(Exception)` with `message: str` and `retry_after_seconds: int`, and no join-code wording.
    - Give `_envelope` an optional `headers` param.
    - Add a 429 "Too Many Requests" handler that only adds `Retry-After`.
    - Register it in `register_exception_handlers` before the `ValueError`/`Exception` handlers.
  - [ ] 2.3 Create `app/groups/application/join_code_limiter.py`:
    - A `JoinCodeLimiter` with `clock: Callable[[], float] = time.monotonic`, and synchronous `check(party_id, group_id)`, `record_failure(party_id, group_id)`, `clear(party_id, group_id)` and `reset()`.
    - Keys `(party_id, group_id)` (10 per 900 s) and `group_id` (30 per 3600 s). A key is exceeded when `len >= limit`, the wait is `ts[len-limit] + window - now`, touched keys are pruned and empty keys deleted.
    - Expose a module-level singleton `limiter`.
    - Add a docstring caveat: single-process, in-memory.
    - Reuse: the in-process store pattern from `app/oauth2/stores.py`.
  - [ ] 2.4 `tests/conftest.py`: add an autouse fixture that imports `app.groups.application.join_code_limiter` inside the fixture body (as `freeze_local_now` does at l.122-126) and calls `limiter.reset()` before and after each test.
  - [ ] 2.5 Run ONLY `tests/test_join_code_limiter.py`, plus `uv run python -m mypy app/core/errors.py app/groups/application/join_code_limiter.py` and ruff on the touched files.

**Acceptance Criteria:**
- The 6 tests pass.
- The 429 response carries the standard envelope and an integer `Retry-After`. No existing error handler's behavior changes.
- The limiter has no I/O, no lock and no new dependency. `time.monotonic` is used (allowed by `time.md`), and `tests/test_domain_clock_guard.py` stays green.

### Task Group 3: Backend API — join-code use cases, router, schemas, matrix row
**Dependencies:** 1, 2
**Files to Modify:** src/backend/app/groups/application/join_code.py, src/backend/app/groups/router/join_code.py, src/backend/app/groups/router/__init__.py, src/backend/app/groups/schemas.py, src/backend/app/groups/service.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_group_join_code.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 10

- [ ] 3.0 Complete the join-code API (R6–R11)
  - [ ] 3.1 Create `tests/test_group_join_code.py` by copying the helpers from `tests/test_group_join_requests_router.py:24-58` (`_register`, `_auth`, `_create_circle_and_term(private=True)`), with two fixes: build Term dates from `clock.local_now()` instead of `date.today()` (l.42), and annotate `_register` as `-> tuple[str, uuid.UUID]`.
  - [ ] 3.2 Write 7 focused integration tests in `tests/test_group_join_code.py`:
    - `test_getJoinCode_twice_returnsSameCode_regenerateRotatesIt`: the second GET returns the same 6-digit code. After regenerate, redeeming the old code returns 409 and the new code returns 200.
    - `test_getAndRegenerateJoinCode_errorOrder_404_403_409`: parametrized over both organizer endpoints. Unknown or soft-deleted → 404, member → 403, PUBLIC → 409 with `Grupa jest publiczna — kod dostępu nie jest potrzebny`.
    - `test_redeemJoinCode_validCode_createdTrue_accessViewable_rsvp201`: 200 `{created: true}`, then `/access` `can_view_content`, then RSVP 201.
    - `test_redeemJoinCode_errors_401_404_400_sameMessage409`: anonymous → 401; PUBLIC or unknown → 404; body `{"code": "12345"}` → 400; a wrong code and a "no code yet" group both return 409 with the identical message `Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie`.
    - `test_redeemJoinCode_memberOrOrganizer_createdFalse_noInsert_clearsUserKey`: the membership count is unchanged, and the user key is empty afterwards (inspect `limiter`).
    - `test_redeemJoinCode_eleventhAttempt_returns429WithIntegerRetryAfter`: after 10 wrong codes, the 11th attempt is 429 even with the correct code, and `Retry-After` parses as an int.
    - `test_getJoinCode_staleDataError_neverNoneOr500`, parametrized over two variants using the Testing Approach technique (monkeypatch the getter `join_code.py` resolves through; behind the ORM, run `UPDATE groups SET updated_at = updated_at + interval '1 second'`, plus `join_code='123456'` in variant A, and commit; call `db_session.rollback()` before asserting). Variant A returns `123456`; variant B generates a code and returns 200.
  - [ ] 3.3 In `tests/test_authorization_matrix.py`, add a join-code parametrize: `POST /api/groups/public/42/join-code` → AUTHENTICATED, `GET /api/groups/42/join-code` → row 26 READ, `POST /api/groups/42/join-code/regenerate` → row 27 EDIT. Add 1 regression test: evaluating the matrix with the join-code row removed resolves the redeem path to row 27 EDIT. Leave the join-request parametrize (l.115-135) for Group 4.
  - [ ] 3.4 `app/groups/schemas.py`: add `JoinCodeResponse{code: str}`, `RedeemJoinCodeRequest{code: str = Field(pattern=r"^[0-9]{6}$")}` and `RedeemJoinCodeResponse{created: bool}`. Do not add `join_code` to any other schema.
  - [ ] 3.5 Create `app/groups/application/join_code.py`:
    - Port `_get_private_group` and `_get_caller_party_id` from `join_requests.py:52-75`; the latter returns only `profile.party_id: uuid.UUID`.
    - `_generate_code()` uses `secrets.randbelow(10**6)`, zero-padded to 6.
    - `get_join_code(db, principal, group_id)`: 404 → 403 → PUBLIC 409; lazily generate and commit when the code is null. On `StaleDataError`: `rollback()`, re-read via `get_group` (never touch the pre-rollback instance), then PUBLIC → 409, code → return it, null → generate and commit once more (a second failure propagates to the global 409 handler).
    - `regenerate_join_code`: same checks, always writes a new code and commits.
    - `redeem_join_code`, in R9 order: 401 → 404 (unknown, soft-deleted or PUBLIC) → `limiter.check` → null or mismatched code (compared with `secrets.compare_digest`) → `record_failure` + 409 → organizer or `_is_active_member` → `limiter.clear` + `{created: False}` → otherwise `add_active_membership`, commit, `limiter.clear`, `{created: True}`.
    - Never log the submitted code.
    - Reuse: `get_group`, `_is_active_organizer`/`_require_active_organizer` (`circles.py:167,356,364`), `add_active_membership`/`_is_active_member` (`memberships.py:28,59`), `get_profile_by_principal`.
  - [ ] 3.6 `app/groups/service.py`: import and re-export `get_join_code`, `regenerate_join_code` and `redeem_join_code` (add them to `__all__`).
  - [ ] 3.7 Create `app/groups/router/join_code.py`. Declare `POST /public/{group_id}/join-code` with `Depends(require_any())` first, then `GET /{group_id}/join-code` and `POST /{group_id}/join-code/regenerate`, using the same principal dependencies as the other organizer group routes under rows 26/27.
  - [ ] 3.8 `app/groups/router/__init__.py`: include the new router right next to the join-requests router (Group 4 removes the old one, leaving the new router in its slot).
  - [ ] 3.9 `app/core/authorization_matrix.py`: add `(_methods("POST"), r"^/api/groups/public/[^/]+/join-code$", "AUTHENTICATED")` with a comment explaining why it precedes row 27. Place it directly after the join-request row (l.107-117), still ahead of row 27. Do not remove the join-request row yet.
  - [ ] 3.10 Run ONLY `tests/test_group_join_code.py`, `tests/test_authorization_matrix.py` and `tests/test_domain_clock_guard.py`, plus mypy and ruff on the touched paths.

**Acceptance Criteria:**
- The 7 integration tests, the regression test and the new matrix cases pass.
- The redeem order is 401 → 404 → 429 → 409 → 200. Wrong and missing codes give identical 409s, and both 200 paths clear only the user key.
- The lazy GET never returns `None` and never a 500 after a concurrent write (SC8).
- `join_code` appears only in `JoinCodeResponse`.

### Task Group 4: Backend Removal — GroupJoinRequest end to end (migration 0060)
**Dependencies:** 3
**Files to Modify:** src/backend/alembic/versions/0060_drop_group_join_requests.py, src/backend/tests/test_group_join_code_migrations.py, src/backend/app/groups/models.py, src/backend/app/groups/schemas.py, src/backend/app/groups/service.py, src/backend/app/groups/router/__init__.py, src/backend/app/groups/application/join_requests.py (delete), src/backend/app/groups/router/join_requests.py (delete), src/backend/app/groups/application/public_view.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/infrastructure/notifications_bridge.py, src/backend/app/notifications/models.py, src/backend/app/notifications/schemas.py, src/backend/app/notifications/service.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_authorization_matrix.py, src/backend/tests/test_group_access.py, src/backend/tests/test_group_soft_delete_reads.py, src/backend/tests/test_private_group_access_defects.py, src/backend/tests/test_add_active_membership.py, src/backend/tests/test_group_join_request_model.py (delete), src/backend/tests/test_group_join_requests_router.py (delete), src/backend/tests/test_group_join_requests_decisions.py (delete)
**Estimated Steps:** 8

- [ ] 4.0 Complete the backend removal (R10 removal half, R12–R14)
  - [ ] 4.1 Write or update 6 focused tests:
    - `tests/test_group_join_code_migrations.py`: add `test_downgrade0059_recreatesJoinRequestsUuidShape_upgradeHeadDropsIt`. On upgrade, seeded `GROUP_JOIN_%` notifications are deleted. After `downgrade 0059`, the table exists with UUID `id`/`group_id`/`requester_party_id`/`term_id`, `pk_group_join_requests`, the partial unique index on PENDING, and `notifications.join_request_id UUID NULL`. After `upgrade head`, both are gone.
    - `tests/test_group_access.py`: exact key sets without `join_request` (l.68, 86, 107) that also assert `join_code` is absent from `GET /api/groups/{id}`, `GET /api/groups/public/{id}` and `/access` (SC2). Drop `NoJoinRequest` from the test names at l.91/l.112, delete the l.123 assertion, update the l.2 docstring, and remove `_request_access`.
    - `tests/test_group_access.py`: rewrite the l.316/344/366/393 flows as join-code flows (GET code as organizer, then redeem, then `/access`), or delete the ones the join-code tests already cover. Keep at most 2.
    - `tests/test_group_soft_delete_reads.py`: replace l.192-209 and the l.243-245 entry with "redeem on soft-deleted group → 404" sending `{"code": "123456"}`.
    - `tests/test_authorization_matrix.py`: delete the l.115-135 parametrize, and move its l.124 case (`POST /api/groups/public/42/join` → EDIT) and l.125 case (`/api/memberships/42/end` → EDIT) into the join-code parametrize. Keep l.138-147.
  - [ ] 4.2 Create `alembic/versions/0060_drop_group_join_requests.py` (`down_revision = "0059"`).
    - Upgrade, in order: `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'` (precedent `0042:48-51`), drop `notifications.join_request_id`, drop table `group_join_requests`. No sequence.
    - Downgrade, in reverse: recreate the post-0041 UUID table (`gen_random_uuid()` PK `pk_group_join_requests`, FK names per `0041:107-109,163-170`, `status VARCHAR(20)`, `created_at`/`updated_at TIMESTAMP NOT NULL`), then its indexes and the partial unique index on PENDING, then `notifications.join_request_id UUID NULL`.
    - The docstring lists these types and notes that deleted notifications are not restored.
  - [ ] 4.3 Delete `app/groups/application/join_requests.py`, `app/groups/router/join_requests.py`, `tests/test_group_join_request_model.py`, `tests/test_group_join_requests_router.py` and `tests/test_group_join_requests_decisions.py`. First confirm that Group 3's copied helpers in `tests/test_group_join_code.py` are self-contained.
  - [ ] 4.4 Edit the groups BC per R14:
    - `models.py`: remove `GroupJoinRequestStatus` (l.63-67) and `GroupJoinRequest` (l.195-224); rewrite the `GroupVisibility` docstring (l.84-90) to "join with the organizer's access code".
    - `schemas.py`: remove the import at l.17 (keep `Literal`), the prose at l.357/362-363, the field `join_request` at l.368, and the schemas at l.718-752.
    - `service.py`: remove the imports at l.42-49 and the `__all__` entries.
    - `router/__init__.py`: remove l.1, 16 and 35.
    - `public_view.py`: remove `_GATE_JOIN_REQUEST_STATUSES`, the docstring at l.370-374, the block at l.399-407, `join_request=` at l.417, the related imports, and the prose at l.455-457 (keep the `cast`).
    - `repository.py`: remove l.3, the imports at l.41-42 and the section at l.686-761.
    - `notifications_bridge.py`: remove l.28 and l.37.
  - [ ] 4.5 Edit the notifications BC: in `notifications/models.py` remove the docstring at l.48-50, the kinds at l.63-65 and the column at l.91-96; in `notifications/schemas.py` remove l.23; in `notifications/service.py` remove l.40, 47-49 and 59.
  - [ ] 4.6 `app/core/authorization_matrix.py`: remove the join-request row (l.107-117), and edit the l.94-99 comment to drop only the `/join_request` mention.
  - [ ] 4.7 Update the prose only in `tests/test_private_group_access_defects.py` (l.1-7, B14 becomes "only with the organizer's access code") and `tests/test_add_active_membership.py:1-2`.
  - [ ] 4.8 Run ONLY the changed and new test files (`test_group_join_code_migrations.py`, `test_group_access.py`, `test_group_soft_delete_reads.py`, `test_authorization_matrix.py`, `test_private_group_access_defects.py`, `test_add_active_membership.py`, `test_group_join_code.py`), mypy and ruff on `app/groups app/notifications app/core`, and `rg -i "join.?request|GROUP_JOIN_|join-requests|request_?access" src/backend -g '!src/backend/alembic/versions/**'` (expect no output).

**Acceptance Criteria:**
- The 6 new or updated tests pass, and so do the existing tests in the touched files.
- `alembic downgrade 0059 && alembic upgrade head` succeeds, and the downgrade rebuilds the post-0041 UUID shape.
- No backend identifier outside `alembic/versions` matches the R31 pattern.
- `/access` and the group DTOs have their final exact key sets, without `join_request` or `join_code`.

### Task Group 5: Frontend Data Layer — joinCode utils, API, hooks, 429 messages
**Dependencies:** None
**Files to Modify:** src/frontend/src/utils/joinCode.ts, src/frontend/src/api/groups.ts, src/frontend/src/api/problem.ts, src/frontend/src/hooks/useJoinCode.ts, src/frontend/src/hooks/useGroupTerms.ts, src/frontend/src/hooks/useTermAccess.ts, src/frontend/src/test/joinCode.test.ts, src/frontend/src/test/serverMessageOr.test.ts, src/frontend/src/test/useJoinCode.test.tsx, src/frontend/src/test/useGroupTerms.test.tsx, src/frontend/src/test/useTermAccess.test.ts
**Estimated Steps:** 8

- [ ] 5.0 Complete the frontend data layer (R15 additions, R16–R20)
  - [ ] 5.1 Write 8 focused tests, with explicit `vitest` imports, `createQueryWrapper()` and `vi.mock("../api/groups")`:
    - `joinCode.test.ts`, 2 tests:
      - `parseJoinCode` table: `""`/`"  "` → `null`; `"482913"`, `"482 913"` and `"482-913"` → `"482913"`; `"48291"`, `"4829134"` and `"48a913"` → `undefined`; a leading zero is kept.
      - `formatJoinCode("482913") === "482 913"`.
    - `serverMessageOr.test.ts`: add one case where a 429 `ApiError` passes the server message through, and one checking the new `ACCESS_DENIED_MESSAGE` text.
    - `useJoinCode.test.tsx`, 2 tests:
      - The `status` mapping: resolved → `ready` with the code; `ApiError(403)` → `denied`; `ApiError(500)` → `error` with `error` set; `enabled: false` → no call.
      - `regenerate()` invalidates `JOIN_CODE_KEY` (the refetch shows the new code), and on an `ApiError(409)` it rejects with the server message, never `409 Conflict`.
    - `useGroupTerms.test.tsx`, 1 test: wraps `getTerms(groupId…)`, with no call while disabled.
    - `useTermAccess.test.ts`, 1 test: `joinWithCode("482913")` calls `redeemJoinCode`, awaits the invalidation of `["groupAccess", groupId]`, and rethrows `new Error(serverMessageOr(err, "Nie udało się dołączyć — spróbuj ponownie"))`.
  - [ ] 5.2 Create `utils/joinCode.ts` with `parseJoinCode(raw): string | null | undefined`, which strips spaces and hyphens and follows the `parseCapacity` model (`panelHelpers.ts:117-123`), and `formatJoinCode(code): string`.
  - [ ] 5.3 `api/groups.ts`: add `JoinCodeResponse`, `RedeemJoinCodeResponse`, `getJoinCode(groupId)` (`GET /api/groups/{id}/join-code`), `regenerateJoinCode(groupId)` (`POST …/join-code/regenerate`) and `redeemJoinCode(groupId, code)` (`POST /api/groups/public/{id}/join-code`, body `{code}`). Add only; the join-request removal happens in Group 8.
  - [ ] 5.4 `api/problem.ts`: `serverMessageOr` passes 429 server messages through, and `ACCESS_DENIED_MESSAGE` becomes `Nie masz uprawnień do tej akcji. Zaloguj się ponownie albo poproś organizatora o kod dostępu.`
  - [ ] 5.5 Create `hooks/useJoinCode.ts`:
    - Export `JOIN_CODE_KEY`, and key the query by `[JOIN_CODE_KEY, groupId]`.
    - Return `{code, status, error, refetch, regenerate}` in app shape.
    - `regenerate` uses `useCallback` + `regenerateJoinCode` + `await queryClient.invalidateQueries({queryKey: [JOIN_CODE_KEY]})`, and rethrows `new Error(serverMessageOr(err, "Nie udało się wygenerować kodu — spróbuj ponownie"))`.
    - Reuse: the `useCategories.ts:40-60` write pattern.
  - [ ] 5.6 Create `hooks/useGroupTerms.ts` (`groupId`, `{enabled}`), wrapping `getTerms` from `api/terms.ts:66`, with a stable empty fallback.
  - [ ] 5.7 `hooks/useTermAccess.ts`: add `joinWithCode(code)` per R20 and add it to the result type.
  - [ ] 5.8 Run ONLY the 5 test files above, plus `npx tsc -b` and `npm run lint` from `src/frontend`.

**Acceptance Criteria:**
- The 8 tests pass, and `tsc -b` and lint are clean.
- Each query has exactly one key prefix constant, and writes `await` their invalidation.
- No error path surfaces raw HTTP status text, and 409/429/400/503 messages pass through verbatim.

### Task Group 6: Frontend Visitor UI — PrivateGroupGate, JoinByCodeSheet, TermPage `?code=`
**Dependencies:** 5
**Files to Modify:** src/frontend/src/pages/krag/termAccess.ts, src/frontend/src/pages/krag/PrivateGroupGate.tsx, src/frontend/src/components/krag/JoinByCodeSheet.tsx, src/frontend/src/components/krag/RequestAccessDialog.tsx (delete), src/frontend/src/pages/krag/TermPage.tsx, src/frontend/src/components/krag/AuthGateSheet.tsx, src/frontend/src/test/TermPage.test.tsx, src/frontend/src/test/termAccess.test.ts, src/frontend/src/test/ModalSheet.test.tsx, src/frontend/src/test/themeTokenUsage.test.tsx, src/frontend/src/test/themeDefects.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/brama-grupy-prywatnej-zalogowany.html
  element: screen:private-gate-logged-in
  locator: line 265, `#mockup-content` → the single `.phone` → `.card.gate` (h2 lock heading, `p.body`, `button.open-code`)
  acceptance: The gate keeps the unchanged `KragStage`/`GroupHeader`/`CARD` shell and the heading "Ta grupa jest prywatna" with an `aria-hidden` lock. Body: "Zajęcia i lista uczestników są widoczne tylko dla członków. Wpisz kod dostępu od organizatora, aby dołączyć." Then one `BTN_PRIMARY BTN_SM` "Mam kod dostępu" (top margin about 12px), and no "Poproś o dostęp". Focus returns to that button when a sheet it opened closes.
- mockup: analysis/design-context/mockups/brama-grupy-prywatnej-anonim.html
  element: screen:private-gate-anonymous
  locator: line 265, `#mockup-content` → first `.col` (default copy) and second `.col` (`?code=` copy); each `.card` holds the h2, `p.body` and `.auth-links`
  acceptance: The default body ends "Zaloguj się, aby wpisać kod dostępu." With `?code=` (`hasCodeParam`), the body ends "Masz kod? Zaloguj się, żeby go użyć." The auth links render through the unchanged `AuthGateLinks` ("Zaloguj się" + "Nie masz konta? Zarejestruj się"), which overrides the mockup's "Załóż konto". `returnTo` = pathname + search, so the code survives login.
- mockup: analysis/design-context/mockups/wpisz-kod-dost-pu-joinbycodesheet.html
  element: screen:join-by-code-sheet
  locator: line 265, first `.col` (sheet over the dimmed gate card, value "482 913") and second `.col` `.states` (six `.state` tiles: Pusty, Niepoprawny format, Wysyłanie, 409, 429, Inny błąd)
  acceptance: The sheet sits on the krag `ModalSheet` over the dimmed gate, with title "Wpisz kod dostępu" and a close ✕. The six states: empty → submit disabled, no alert; invalid → "Kod ma 6 cyfr" alert, submit disabled; busy → "Dołączanie…", `aria-busy`, Anuluj disabled; 409 → "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie"; 429 → "Za dużo prób wpisania kodu — spróbuj ponownie za 15 min"; other → "Nie udało się dołączyć — spróbuj ponownie". On every server error the input is kept and `aria-invalid="true"`.
- mockup: analysis/design-context/mockups/wpisz-kod-dost-pu-joinbycodesheet.html
  element: component:join-by-code-sheet
  locator: line 265, any `.sheet` block: `.sheet-h` → `label.lbl` → `input.field` → `p.hint` → `p.err[role=alert]` → `.actions`
  acceptance: Field order is label "Kod dostępu" → input (`type=text inputMode=numeric pattern=[0-9]* autoComplete=one-time-code`) → hint "6 cyfr, np. 123 456" → `role=alert` slot (linked by `aria-describedby`) → `BTN_GHOST` "Anuluj" + `BTN_PRIMARY` "Dołącz". It is wrapped in `<form noValidate>`, so Enter submits, and a spaced "482 913" counts as valid. It uses krag tokens only, with no legacy utilities.
**Estimated Steps:** 8

- [ ] 6.0 Complete the visitor UI (R21–R24, R30 visitor half)
  - [ ] 6.1 Write 8 focused tests in `TermPage.test.tsx`, replacing the private-gate describe at l.569-731 and updating l.11, 21-22, 123, 516-540 and 788. Use `mockAuth` + `rerender` and `vi.mock("../api/groups")` with `redeemJoinCode`:
    - A logged-in non-member sees "Mam kod dostępu" and no "Poproś o dostęp".
    - The sheet traps Tab, closes on Esc, and returns focus to "Mam kod dostępu".
    - Invalid input ("48291") → submit disabled and the "Kod ma 6 cyfr" alert.
    - Pasting "482 913" + Enter → exactly one `redeemJoinCode(groupId, "482913")`.
    - A 409 shows the server text inline, and the sheet stays open with the input kept.
    - A 200 shows the term content and the "Dołączono do grupy" toast.
    - `?code=482913&x=1` → exactly one redeem, and only `code` is removed (`x=1` kept). A malformed `?code=12ab` → no redeem, the param is removed, and the sheet opens empty.
    - Token change (M8, rewriting the l.710 test): render with `token:null` + `?code=482913` (`loginRequired`, and `returnTo` contains `code=482913`). Rerender with a token while `getGroupAccess` is pending → no redeem. Resolve it to `canEnterCode` → exactly one redeem, and the param is removed.

    Also update `termAccess.test.ts` (l.25, 37-50) to the `loginRequired | canEnterCode` union.
  - [ ] 6.2 `pages/krag/termAccess.ts`: change `PrivateGate` to `loginRequired | canEnterCode`, and remove the pending/rejected derivation.
  - [ ] 6.3 Create `components/krag/JoinByCodeSheet.tsx` per R23:
    - Built on the krag `ModalSheet` (Esc, `trapFocus`, focus return, `useRegisterOpenSheet`).
    - Props: `initialCode`, `autoSubmit`, `onSubmit`, `onClose`.
    - A `<form noValidate>` with raw-string state and `parseJoinCode` gating.
    - A busy state that blocks Esc and overlay close.
    - The server error in the alert slot, cleared on edit.
    - A one-shot auto-submit ref (StrictMode-safe).
    - Reuse: `CapacityField` (`panelComponents.tsx:174-208`) as the input template; `kragStyles` `FIELD`/`ERROR_TEXT`/`BTN_PRIMARY`/`BTN_GHOST`.
  - [ ] 6.4 `pages/krag/PrivateGroupGate.tsx`: keep the shell. Remove canRequest/pending/rejected/withdraw, `showDialog`, `createConflict` and the polling at l.52-67. Add the props `hasCodeParam`, `sheetOpen`, `onOpenSheet`, `onCloseSheet`, `initialCode`, `autoSubmit` and `onJoin`. Render the `loginRequired` and `canEnterCode` bodies, and render `JoinByCodeSheet` as the `KragStage` overlay while `sheetOpen`.
  - [ ] 6.5 `pages/krag/TermPage.tsx`, per R24:
    - Own `sheetOpen`, `sheetInitialCode`, `sheetAutoSubmit` and a `useRef<Set<string>>` of consumed `${groupId}:${rawCode}` keys.
    - Read `code` via `useSearchParams` only when `/access` is ready and `!isStale`.
    - `view` → strip the param. `loginRequired` → keep it and pass `hasCodeParam`. Malformed → strip and open the sheet empty. Valid → open with the code and auto-submit, and strip when the promise settles.
    - Strip with `setSearchParams(…, {replace: true})`, removing only `code`.
    - The `onJoin` wrapper closes the sheet and shows the `useToast` "Dołączono do grupy" `role="status"` pill.
    - Update the prose at l.9-11.
  - [ ] 6.6 Delete `components/krag/RequestAccessDialog.tsx`, and update the `AuthGateSheet.tsx:15` prose.
  - [ ] 6.7 Swap the test lists:
    - `ModalSheet.test.tsx`: replace the import at l.5 with `JoinByCodeSheet`, drop `createJoinRequest` from the l.10 mock, and swap the component in l.158-194 (the registry count stays `3`).
    - `themeTokenUsage.test.tsx`: delete l.6, l.8-10 and l.146-160; put `components/krag/JoinByCodeSheet.tsx` at l.81 of `NO_LEGACY_UTILITY_FILES`; retarget the "no dead `kg-modal-overlay`" describe to `JoinByCodeSheet`.
    - `themeDefects.test.tsx:91`: replace the entry in `IN_SCOPE_FILES` with `JoinByCodeSheet`.
  - [ ] 6.8 Run ONLY `TermPage.test.tsx`, `termAccess.test.ts`, `ModalSheet.test.tsx`, `themeTokenUsage.test.tsx` and `themeDefects.test.tsx`, plus `npx tsc -b` and `npm run lint`.

**Acceptance Criteria:**
- The 8 TermPage tests and the updated list tests pass, and `tsc -b` and lint are clean.
- `?code=` is redeemed at most once per `groupId:code`, never while `isStale`, and only `code` is stripped from the URL.
- The implementation matches each `acceptance` criterion in the Visual References above, with the `AuthGateLinks` copy exception.

### Task Group 7: Frontend Organizer UI — JoinCodeCard, regenerate confirm, GroupDetailsPage, stepper
**Dependencies:** 5
**Files to Modify:** src/frontend/src/components/panel/JoinCodeCard.tsx, src/frontend/src/components/shared/ConfirmDeleteDialog.tsx, src/frontend/src/pages/panel/GroupDetailsPage.tsx, src/frontend/src/components/panel/CreateGroupStepper.tsx, src/frontend/src/components/panel/GroupFormFields.tsx, src/frontend/src/test/GroupDetailsPage.test.tsx, src/frontend/src/test/CreateGroupStepper.test.tsx, src/frontend/src/test/ConfirmDeleteDialog.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/szczeg-y-grupy-z-kart-kodu-organizator.html
  element: screen:group-details-join-code-card
  locator: line 265, first `.col` (with an upcoming term: `.dl` details card → `section.jcc` → "Uczestnicy terminów" → `.toast`) and second `.col` (no upcoming term)
  acceptance: The details `<dl>` shows Widoczność = "Prywatna (dostęp z kodem)". `JoinCodeCard` sits directly under the details card and above "Uczestnicy terminów". With an upcoming term it shows "Kopiuj kod" + "Kopiuj link z kodem" + "Wygeneruj nowy kod"; without one it shows "Kopiuj kod" + "Wygeneruj nowy kod". A local `role="status"` toast pill reads "Skopiowano kod". There is no card for PUBLIC groups or for a 403 member.
- mockup: analysis/design-context/mockups/szczeg-y-grupy-z-kart-kodu-organizator.html
  element: component:join-code-card
  locator: line 265, `section.jcc` (`h3#jcc-t`, `p.lead`, `div.code`, `div.btns`)
  acceptance: `<section aria-labelledby>` with title "Kod dostępu" and lead "Podaj go osobom, które mają dołączyć do grupy." The code is monospace "482 913" with the full value in sr-only text (`{" "}` spacing rule). Buttons in order: `p-primary` "Kopiuj kod" (copies the raw `482913`), `p-secondary` "Kopiuj link z kodem" (`origin + termPublicPath + "?code="`), `p-text` "Wygeneruj nowy kod". It uses panel mint styling. Beyond the mockup (R25): a `loading` skeleton of the same height with `aria-busy`, and an `error` shell with the `role=alert` text "Nie udało się wczytać kodu dostępu." and a "Spróbuj ponownie" button.
- mockup: analysis/design-context/mockups/potwierdzenie-wygeneruj-nowy-kod.html
  element: screen:regenerate-confirm
  locator: line 265, `.alert > .box[role=alertdialog]` over the details page
  acceptance: The z-70 `alertdialog` (`ConfirmDeleteDialog` with `tone="primary"`) has title "Wygenerować nowy kod?", body "Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie.", and buttons "Anuluj" / primary "Wygeneruj nowy kod". While busy it reads "Generowanie…". A failure shows the server message inline and keeps the dialog open. Success closes it and shows the "Wygenerowano nowy kod" toast. It also works over the stepper sheet.
- mockup: analysis/design-context/mockups/kreator-ekran-ko-cowy-grupa-prywatna.html
  element: screen:stepper-done-private
  locator: line 265, `.panel-sheet` → `p.body` → `section.jcc` → "Przejdź do publicznej strony →" → "Gotowe" → `.cta`
  acceptance: The PRIVATE done copy reads "Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu." It is followed by `JoinCodeCard` with both copy buttons (`termId=createdTermId`), and then the existing CTA, "Gotowe" and public-profile link, unchanged. The PUBLIC done screen shows no card and fetches no code. The panel `ModalSheet` is unchanged.
**Estimated Steps:** 8

- [ ] 7.0 Complete the organizer UI (R25–R29, R30 organizer test sites)
  - [ ] 7.1 Write 8 focused tests (clipboard stub via `Object.assign(navigator, {clipboard})`, Date pinned with `vi.useFakeTimers({toFake: ["Date"]})` for the nearest-term logic):
    - `GroupDetailsPage.test.tsx`, 5 tests. First extend the l.10 `../api/groups` factory with `getJoinCode`/`regenerateJoinCode` (default `mockRejectedValue(new ApiError(403, …))`), add `vi.mock("../api/terms", () => ({getTerms: vi.fn()}))`, and change the l.77 label to "Prywatna (dostęp z kodem)".
      - The card is shown for a PRIVATE organizer with "482 913", and is absent on 403.
      - The skeleton is shown while loading (`aria-busy`). On a 500, the error text appears, and "Spróbuj ponownie" refetches.
      - "Kopiuj kod" writes `482913` and shows the "Skopiowano kod" toast. With an upcoming term, "Kopiuj link z kodem" writes `${origin}${termPublicPath}?code=482913`. With no upcoming term, that button is absent.
      - "Wygeneruj nowy kod" opens the confirm, and confirming shows the new code and the "Wygenerowano nowy kod" toast.
      - A failed regenerate (`ApiError(409, "Konflikt…")`) shows the server message, not "409 Conflict", and the dialog stays open.
    - `CreateGroupStepper.test.tsx`, 2 tests: update the `PRIVATE_DONE` copy (l.73-74, 254-278) and add a `getJoinCode` mock. The PRIVATE done screen shows the code with both copy buttons; the PUBLIC done screen shows no card, and `getJoinCode` is not called.
    - `ConfirmDeleteDialog.test.tsx` (new), 1 test: the defaults (danger tone, "Usuwanie…") are unchanged, and `tone="primary"` + `busyLabel="Generowanie…"` applies the primary styling and busy label.
  - [ ] 7.2 `components/shared/ConfirmDeleteDialog.tsx`: add the optional `tone: "danger" | "primary"` (default `danger`) and `busyLabel` (default `Usuwanie…`) props. Existing callers (`DeleteGroupDialog`, `MiejscaView`) are unchanged.
  - [ ] 7.3 Create `components/panel/JoinCodeCard.tsx`:
    - Presentational, with props `group`, `code`, `status`, `onRetry`, `regenerate` and `termId`.
    - The `denied`, `loading`, `error` and `ready` states.
    - Clipboard try/catch with the "Nie udało się skopiować kodu" toast.
    - A card-local `useToast` + `role="status"` pill.
    - The regenerate confirm via `ConfirmDeleteDialog`, configured per R26.
    - Reuse: the `ShareButton.tsx` clipboard and pill markup, `useToast`, `termPublicPath`, `formatJoinCode`.
  - [ ] 7.4 `pages/panel/GroupDetailsPage.tsx`:
    - Change the l.11 label to "Prywatna (dostęp z kodem)".
    - Call `useJoinCode(group.id, {enabled: PRIVATE})` and `useGroupTerms(group.id, {enabled: status === "ready"})`.
    - Derive `termId` as the earliest term with `occurs_on >= dayjs().startOf("day")` (dayjs from `utils/dayjs.ts`; convention from `HomeView.tsx:60-66`), or `null`.
    - Render `JoinCodeCard` under the details card for PRIVATE groups.
  - [ ] 7.5 `components/panel/CreateGroupStepper.tsx`: add the PRIVATE done copy, call `useJoinCode(createdGroupId, {enabled: done && PRIVATE})`, and render `JoinCodeCard` with `termId={createdTermId}` above the existing CTAs. Use no `useGroupTerms` here.
  - [ ] 7.6 `components/panel/GroupFormFields.tsx:74`: change the option text to "Prywatna — (dostęp z kodem)".
  - [ ] 7.7 Check the card against the 4 Visual References (order, copy, button variants, sr-only spacing), and against the absence rules for PUBLIC groups and 403.
  - [ ] 7.8 Run ONLY `GroupDetailsPage.test.tsx`, `CreateGroupStepper.test.tsx`, `ConfirmDeleteDialog.test.tsx`, `DeleteGroupDialog.test.tsx` and `MiejscaView.test.tsx` (the existing confirm callers), plus `npx tsc -b` and `npm run lint`.

**Acceptance Criteria:**
- The 8 tests pass, and the existing `ConfirmDeleteDialog` callers' tests still pass.
- Each query has exactly one subscriber: the host pages own `useJoinCode`/`useGroupTerms`, and `JoinCodeCard` calls no data hook.
- No raw HTTP status text appears in the card or the dialog.
- The implementation matches each `acceptance` criterion in the Visual References above, with the skeleton/error-state exception from R25.

### Task Group 8: Frontend Removal — pending join requests, API types, notification kinds
**Dependencies:** 5, 6
**Files to Modify:** src/frontend/src/hooks/usePendingJoinRequests.ts (delete), src/frontend/src/components/pending/pendingActions.ts, src/frontend/src/components/pending/PendingActionsHost.tsx, src/frontend/src/components/pending/snoozeStore.ts, src/frontend/src/api/groups.ts, src/frontend/src/api/notifications.ts, src/frontend/src/test/PendingActionsHost.test.tsx, src/frontend/src/test/PublicLayout.test.tsx
**Estimated Steps:** 5

- [ ] 8.0 Complete the frontend removal (R15 removal half, R30 pending half)
  - [ ] 8.1 Update 2 focused tests:
    - `PendingActionsHost.test.tsx`: remove l.19 and 28-32, update l.133, delete the `[PENDING_JOIN_REQUESTS_KEY]` assertion at l.399, change the invalidation count at l.400 from `[2]` to `[1]`, and delete the describe at l.544-733. Keep one assertion that `derivePendingActions` takes a single parameter and yields only `n:` keys.
    - `PublicLayout.test.tsx`: remove the groups mock at l.20-24 and l.52, and delete the test at l.139-147.
  - [ ] 8.2 Delete `hooks/usePendingJoinRequests.ts`. In `components/pending/pendingActions.ts`, return `derivePendingActions` to one parameter with `n:` keys only.
  - [ ] 8.3 `components/pending/PendingActionsHost.tsx`: remove every join-request block, including `joinRequestId`/`joinRequestBusy` (l.54-59) and `JoinRequestActionSheet` (l.306-377). In `snoozeStore.ts`, edit the prose at l.3-4 only.
  - [ ] 8.4 In `api/groups.ts`, remove the docstring at l.13-16, `GroupAccessDetails.join_request` (l.268-271) and the join-request section (l.461-516). In `api/notifications.ts`, remove the kinds at l.15-17 and `join_request_id` (l.33-37).
  - [ ] 8.5 Run ONLY `PendingActionsHost.test.tsx`, `PublicLayout.test.tsx` and `NotificationBell.test.tsx`, plus `npx tsc -b`, `npm run lint` and `rg -i "join.?request|GROUP_JOIN_|RequestAccessDialog|PENDING_JOIN_REQUESTS_KEY|join-requests|request_?access" src/frontend/src` (expect no output).

**Acceptance Criteria:**
- The updated tests pass, and `tsc -b` and lint are clean.
- No frontend file matches the R31 pattern.
- `PendingActionsHost` still renders the remaining notification-driven actions.

### Task Group 9: Test Review & Gap Analysis — removal gate and prose
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8
**Files to Modify:** src/backend/tests/test_group_join_code.py, src/frontend/src/test/TermPage.test.tsx, src/frontend/src/test/GroupDetailsPage.test.tsx, .maister/tasks/development/2026-10-19-simple-group-creation-and-locations/documentation/user-guide.md, .maister/tasks/development/2026-09-22-private-group-join-requests/orchestrator-state.yml
**Estimated Steps:** 6

- [ ] 9.0 Review the tests, fill critical gaps, and close R31/R32
  - [ ] 9.1 Review the tests from Groups 1–8 (about 48), comparing them with the spec's Testing Approach and Success Criteria 1–8.
  - [ ] 9.2 Analyze the gaps for THIS feature only. Likely candidates: the `JoinByCodeSheet` busy state blocking Esc; the group-key limiter blocking a second user over HTTP; the `GroupDetailsPage` nearest-term choice with past and future terms; a `?code=` link opened by an existing member (`view` → stripped, no redeem).
  - [ ] 9.3 Write up to 10 additional strategic tests in the existing feature test files listed above. Add no new test files unless a gap cannot fit an existing one.
  - [ ] 9.4 Run the R31 removal gate from the repo root: `rg -i "join.?request|GROUP_JOIN_|RequestAccessDialog|PENDING_JOIN_REQUESTS_KEY|join-requests|request_?access" src/ -g '!src/backend/alembic/versions/**'` must return nothing. Fix any hit in the owning file.
  - [ ] 9.5 Apply the R32 prose:
    - `user-guide.md:214`: "Po zalogowaniu może poprosić o dołączenie." becomes "Po zalogowaniu może dołączyć, wpisując kod dostępu od organizatora."
    - DEV22 `orchestrator-state.yml`: set its status to superseded, with a note pointing to `2026-10-21-private-group-join-by-code`.
  - [ ] 9.6 Run the feature tests: backend `tests/test_group_join_code*.py`, `tests/test_join_code_limiter.py`, `tests/test_group_access.py`, `tests/test_authorization_matrix.py` and `tests/test_group_soft_delete_reads.py`; frontend the Group 5–8 test files. Then run the static checks: `uv run python -m mypy` (no worse than the ~32 baseline), `uv run python -m ruff check`, `npm run lint` and `npx tsc -b`. Because the removal touches shared modules, also run the full `uv run python -m pytest` and `npm test` once (SC6).

**Acceptance Criteria:**
- All feature tests pass (about 48–58 in total), with at most 10 tests added in this group.
- The R31 command returns nothing, and the R32 prose is updated.
- mypy is no worse than the baseline, ruff, lint and `tsc -b` are clean, and the full suites are green.

## Execution Order

1. Group 1: Database Layer — `join_code` column, migration 0059 (4 steps, no dependencies)
2. Group 2: Backend Core — 429 + limiter (5 steps, no dependencies)
3. Group 5: Frontend Data Layer (8 steps, no dependencies)
4. Group 3: Backend API — join-code (10 steps, depends on 1, 2)
5. Group 6: Frontend Visitor UI (8 steps, depends on 5)
6. Group 7: Frontend Organizer UI (8 steps, depends on 5)
7. Group 4: Backend Removal (8 steps, depends on 3)
8. Group 8: Frontend Removal (5 steps, depends on 5, 6)
9. Group 9: Test Review & Gap Analysis — removal gate and prose (6 steps, depends on all)

### Shared files (sequenced by dependencies)
| File | Groups | Ordering guarantee |
|---|---|---|
| `src/backend/app/groups/models.py` | 1, 4 | 4 → 3 → 1 |
| `src/backend/tests/test_group_join_code_migrations.py` | 1, 4 | 4 → 3 → 1 |
| `src/backend/app/groups/service.py`, `schemas.py`, `router/__init__.py` | 3, 4 | 4 depends on 3 |
| `src/backend/app/core/authorization_matrix.py`, `tests/test_authorization_matrix.py` | 3, 4 | 4 depends on 3 |
| `src/backend/tests/test_group_join_code.py` | 3, 9 | 9 depends on all |
| `src/frontend/src/api/groups.ts` | 5, 8 | 8 depends on 5 |
| `src/frontend/src/test/TermPage.test.tsx`, `GroupDetailsPage.test.tsx` | 6 or 7, then 9 | 9 depends on all |

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: error-handling (typed `TooManyAttemptsException`, centralized handler, Polish messages), validation (the `parseJoinCode` null/value/undefined parser, `inputMode="numeric"` text input, inline `role="alert"`, server-side `^[0-9]{6}$`), minimal-implementation (no `useMutation`, no shared toast host, limiter kept in the groups BC), commenting, coding-style.
- `backend/`: models.md (nullable column, string-backed kinds removed in code and data together), migrations.md (two focused revisions, reversible downgrades in reverse dependency order, explicit `pk_`/`fk_`/`ix_`/`uq_` names, one downgrade→upgrade test per migration), security.md (`Depends(require_any())` + a matrix row ahead of row 27, verified by the regression test), time.md (`time.monotonic` in the limiter, `clock.local_now()` in test helpers, `test_domain_clock_guard.py`), api.md, queries.md.
- `frontend/`: data-fetching.md (hooks in `src/hooks/`, prefix-constant keys, one subscriber per query, `await invalidateQueries`, dayjs from `utils/dayjs.ts`), accessibility.md (krag `ModalSheet` trap/Esc/focus return with the `main` fallback, `useRegisterOpenSheet`, z-70 alertdialog, `role="status"` toasts, sr-only `{" "}` spacing), css.md (krag tokens only in `JoinByCodeSheet`, panel styling in `JoinCodeCard`), components.md, responsive.md.
- `testing/`: backend-testing.md (testcontainers, `client`/`db_session`, exact key sets, `test_<operation>_<scenario>_<expected>`, `uv run python -m pytest|mypy|ruff` from `src/backend`), frontend-testing.md (explicit vitest imports, `createQueryWrapper`, `vi.mock` factories + `vi.resetAllMocks()`, Date-only fake timers).

## Notes

- Test-driven: each group starts by writing its 2–8 tests.
- Run incrementally: after each group, run only that group's new and changed tests. The full suites run once, in Group 9.
- Mark progress: check off the steps as they are completed. The HTML companion uses `data-group`/`data-step` markers.
- Reuse first: the spec's "Existing Code to Leverage" table is cited in the steps above.
- Never print secret values (no env/.env dumps). Configuration checks are presence-only.
