# Requirements

## TL;DR
A PRIVATE group gets a 6-digit access code. The organizer views, copies and regenerates it on GroupDetailsPage and on the stepper's done screen. A visitor enters it in a sheet on the term page, or it is auto-submitted from `?code=`, and becomes a member immediately.
The whole "poproś o dostęp" mechanism is removed: backend, frontend, notifications, tests, and the table (migration 0060).
The architecture, API contract, limiter and copy follow the research HLD/ADRs plus the Phase 1/2 decisions. The 6 mockups are binding.

## Key Decisions
- Research ADR-001..008 are taken as-is (6 digits, plaintext column, in-process dual limiter, lazy GET + regenerate, sheet + `?code=`, full removal, 401→404→429→409→200, card on group page + stepper).
- Phase 1/2 decisions: see analysis/clarifications.md and analysis/scope-clarifications.md.
- The Phase 4 mockups are binding: layout, copy, field order and states.

## Initial description
Implement joining a PRIVATE group with a 6-digit organizer access code, replacing and fully removing GroupJoinRequest ("poproś o dostęp"). Research: .maister/tasks/research/2026-10-21-private-group-join-by-code.

## Q&A
1. **User journey (confirmed):**
   - Organizer: Spotkania tile → "Szczegóły" → GroupDetailsPage → JoinCodeCard. Alternatively, the CreateGroupStepper done screen. They copy the code or the link with the code and share it in a chat.
   - Visitor: opens the term link → logs in if needed (`returnTo` keeps `?code=`) → enters the code, or it is auto-submitted once from `?code=` → becomes a member → term view → "Zapisz się".
2. **Reuse (confirmed):**
   - Port `_get_caller_party_id` / `_get_private_group` from `join_requests.py` into the new `join_code.py`, then delete the old file.
   - Code input based on `CapacityField` / `parseCapacity`.
   - Clipboard + status pill based on `ShareButton`.
   - Confirm based on `ConfirmDeleteDialog`, adding `tone` + `busyLabel` props.
3. **Visual assets (confirmed):** only the 6 Phase 4 mockups (analysis/design-context/INDEX.md) and the Polish copy table in research HLD § "Polish UI copy".

## Functional requirements
- Backend:
  - `GET /api/groups/{id}/join-code`: organizer only, lazy generation. On StaleDataError: rollback, re-read, return the code.
  - `POST /api/groups/{id}/join-code/regenerate`.
  - `POST /api/groups/public/{id}/join-code`: redeem. Error order 401→404→429→409→200 `{created}`. An organizer redeeming gets `{created:false}`. Membership is re-checked inside the request.
  - Dual limiter: 10 failures / 15 min per (party, group); 30 failures / 1 h per group. Implemented in `app/groups/application/join_code_limiter.py` with an injectable clock and `reset()`.
  - `TooManyAttemptsException` → 429 with `Retry-After`; the minutes are in the message.
  - The code never appears in GroupResponse, PublicCircleResponse, `/access`, notifications or logs.
  - Migrations: 0059 adds `groups.join_code VARCHAR(6) NULL`. 0060 deletes `GROUP_JOIN_%` notifications, drops `notifications.join_request_id`, then drops `group_join_requests`. Its downgrade recreates the post-0041 UUID shape.
- Frontend:
  - `PrivateGroupGate` uses `loginRequired | canEnterCode`.
  - `JoinByCodeSheet` is built on the krag `ModalSheet`.
  - `TermPage` handles `?code=`: one-shot auto-submit, then strips it with `replace`.
  - `useTermAccess.joinWithCode` follows the useCallback + invalidate pattern.
  - `serverMessageOr` passes 429 through.
  - `JoinCodeCard` with `useJoinCode`; skipped for PUBLIC groups and hidden on 403.
  - `useGroupTerms`: the nearest term from the start of today. With no term, only "Kopiuj kod" is shown.
  - Local toast.
  - `ConfirmDeleteDialog` gains `tone`/`busyLabel`.
  - Visibility labels change to "dostęp z kodem".
  - Stepper copy updated.
- Removal: every join-request identifier is gone from `src/` except migration history. Includes the stale prose and tests listed in the codebase analysis and gap analysis.

## Reusability opportunities
`add_active_membership`, `_require_active_organizer`, `_is_active_member`, `get_group`, oauth2/stores.py (store pattern), `useCategories` (writes), `ShareButton` (clipboard), `ConfirmDeleteDialog`, the krag `ModalSheet`, `termPublicPath`, `getTerms`, `useToast`.

## Scope boundaries
Out of scope (follow-ups):
- Active member list and member removal for the organizer
- "Joined via code" notification
- `?code=` on the panel term link
- Unique index on active memberships
- `returnTo` validation
- nginx limit_req
- DB-backed limiter
- `is_organizer` in GroupResponse
- Esc/focus trap on the panel ModalSheet

## Technical considerations
- `updated_at` is the optimistic-lock column, so the lazy write bumps it.
- The limiter must be reset between tests (autouse fixture).
- The frontend cannot read `Retry-After`.
- Theme test lists: JoinByCodeSheet goes in IN_SCOPE/NO_LEGACY; JoinCodeCard does not go in NO_LEGACY.
- Tests to rewrite: `TermPage.test:710`, `PendingActionsHost.test:400`, `PublicLayout`, `PRIVATE_DONE`, `ModalSheet.test` registry count.
- Backend commands: `uv run python -m pytest|mypy|ruff` (from src/backend). Frontend: `npm test`, `npm run lint`, `npx tsc -b`.
