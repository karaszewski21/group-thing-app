# Code Review Report

**Date**: 2026-09-24
**Path**: working tree vs HEAD a0e784c (38 modified/deleted files + 16 untracked), task `2026-09-24-private-group-access-requests`
**Scope**: all (quality, security, performance, best practices)
**Status**: Issues Found (no critical issues)

## Summary
- **Critical**: 0 issues
- **Warnings**: 5 issues
- **Info**: 9 issues

### What was verified and found correct
- **PRIVATE content privacy.** `get_public_circle_view(..., include_private_content)` has a default of False. Its only caller that sets True is `get_group_access`, which derives the flag from server-resolved `is_member or is_organizer` (`public_view.py:319-329`). `GET /api/groups/public/{id}` (`router/circles.py:127`) and `system/router.py:85,98` keep the reduced shape. The reduced branch skips `term_id` validation. `is_attending` is computed from the post-flag guardians list, so an outsider always gets False.
- **`join_request` contents.** It is the caller's own latest request only (`find_latest_join_request` filters by `profile.party_id`). It is surfaced only for PRIVATE groups to identified non-members, and only when the status is PENDING or REJECTED.
- **Authorization matrix.**
  - The new explicit `POST ^/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?$` → AUTHENTICATED row sits ahead of blanket rows 26 and 27 (first match wins).
  - Approve and reject fall to row 27 (EDIT), and both GET lists fall to row 26 (READ).
  - The literal `/mine/join-requests` route is registered before `/{group_id}/join-requests`.
  - Organizer checks happen at action time through `_require_active_organizer`. Requester ownership on withdraw is checked in the service (`join_requests.py:133-134`).
- **Self-join paths.** Both are removed: `POST /api/memberships` and `POST /api/groups/public/{id}/join`, together with their schemas, facade entries and matrix row.
- **Idempotency and races.**
  - A pre-check returns an existing PENDING row.
  - The insert runs inside `begin_nested()`. An `IntegrityError` re-selects the winning row, or re-raises if none is found.
  - The notification is staged only after a successful flush, so the fallback path stages none.
  - A lost race on decide or withdraw is caught by the `updated_at` `version_id_col` and becomes `StaleDataError`. The global handler maps it to 409, and the request's session is discarded, which rolls back the membership flushed by `add_active_membership`.
- **Migrations.**
  - 0037 creates an explicit sequence, the PK and 3 named FKs, `ix_group_join_requests_group_id` and the partial unique index. Its downgrade runs `OWNED BY NONE`, then drops the table, then drops the sequence, so it is reversible.
  - 0038 adds and drops a nullable column.
- **Queries.** There is no N+1 in the pending list: one leadership query, one joined request+group-name query, and one batched profile-name query.
- **Frontend.**
  - The `useTermAccess` sequence counter makes the latest request win.
  - The `PrivateGroupGate` focus/visibilitychange listeners are attached only while `pending` and are removed in the effect cleanup.
  - The dialog has initial focus on „Wyślij”. Esc, ✕, overlay click and Anuluj all close it, but not while busy, and cancel returns focus to the trigger.
  - A 409 on a panel decision shows „Prośba została już rozstrzygnięta.” with „Rozumiem”.
  - A failure of `listMyPendingJoinRequests` is swallowed and treated as an empty list.
  - The 401 `returnTo` value is the same-origin path + search, URI-encoded.

---

## Critical Issues
None.

---

## Warnings

### W1. `useTermAccess` keeps the previous term/group's data when `groupId`/`termId` change; a failed fetch then leaves the wrong term on screen with no error
- **Location**: `src/frontend/src/hooks/useTermAccess.ts:37-58`; `src/frontend/src/pages/krag/TermPage.tsx:66-75` (view branch); `src/frontend/src/router.tsx:123` (the `<TermPage />` element has no `key`, so the component instance survives a param change)
- **Category**: best_practices / correctness
- **Description**:
  - State is not reset when the route params change. After in-app navigation from term A to term B, the page renders term A's data under term B's URL until the new response arrives. That response is not marked stale, because `isStale` compares only tokens.
  - If the fetch for B fails (for example a 404 for a deleted or foreign term), the hook keeps `ready` with `refreshError` set. The `view` branch never shows `refreshError`, so the user sees term A indefinitely.
  - The previous hook set `error`, which rendered „Nie znaleziono”. This is a behaviour regression.
  - The same pattern affects the gate branch: data from group X can be shown for group Y until the new response arrives.
  - This is not a cross-user privacy leak, because the user was allowed to see X.
- **Recommendation**: Record the `(groupId, termId)` the data was fetched for (alongside `forToken`) and treat a mismatch like a first load. Either reset to `loading` in an effect keyed on `groupId`/`termId`, or add `forKey` to the `ready` state and return `error` when the fetch for a new key fails. An alternative is `key={`${groupId}-${termId}`}` on the route element.
- **Fixable**: true

### W2. `RequestAccessDialog` has no focus trap, and focus is lost after a successful submit or a 409
- **Location**: `src/frontend/src/components/krag/RequestAccessDialog.tsx:78-83` (dialog container); `src/frontend/src/pages/krag/PrivateGroupGate.tsx:208-217` (`onSubmitted` / `onConflict`)
- **Category**: best_practices (accessibility)
- **Description**:
  - The dialog declares `aria-modal="true"`, but Tab and Shift+Tab can leave the sheet into the page behind it, which is still interactive.
  - After „Wyślij” succeeds, `onSubmitted` closes the sheet without restoring focus. The trigger „Poproś o dostęp” is then unmounted, because the gate becomes `pending`, so focus falls to `<body>`. The `role="status"` live region announces the new state, but keyboard users lose their position.
- **Recommendation**:
  - Add a minimal Tab/Shift+Tab loop, following the existing sheets if one of them already has one.
  - After a submit or conflict, move focus to a stable element, such as the card heading (with `tabIndex={-1}`) or the „Sprawdź ponownie” button.
- **Fixable**: true

### W3. The RSVP `"Konto"` placeholder can create an anonymous attendee named „Konto”
- **Location**: `src/frontend/src/components/krag/RsvpDialogLoggedIn.tsx:17,70`; `src/frontend/src/pages/krag/TermPage.tsx:382` (the logged-in dialog is now chosen on `isLoggedIn` alone)
- **Category**: quality / data integrity
- **Description**:
  - `POST /groups/public/{id}/rsvp` is PUBLIC and silently degrades to the anonymous path when the principal cannot be resolved (`public_view.py create_rsvp`).
  - If a stored token no longer resolves to an account profile (expired or revoked), and `displayName` is still null, a PUBLIC-group RSVP creates a new anonymous Party/UserProfile with display name „Konto”. It does not attach to the account.
  - This is a narrow window, because an expired token usually triggers the 401 redirect elsewhere first. The result, though, is a junk attendee visible to the group.
- **Recommendation**:
  - Block „Zapisz” until `displayName` resolves. Only the display text needs to render without it, not the submit.
  - Alternatively, make the backend treat `guardian_name` as optional when a principal is present, and reject an unresolvable principal on this path instead of degrading.
- **Fixable**: true

### W4. The race paths have no integration tests (IntegrityError fallback, optimistic-lock 409 on decide/withdraw)
- **Location**: `src/backend/app/groups/application/join_requests.py:104-112` (savepoint fallback); tests: `tests/test_group_join_requests_router.py`, `tests/test_group_join_requests_decisions.py`, `tests/test_stale_data_error_handler.py:13`
- **Category**: best_practices / testing
- **Description**:
  - The partial unique index is tested at model level. `test_createJoinRequest_duplicate_...` exercises only the pre-check path, not the `except IntegrityError` re-select.
  - The `StaleDataError` → 409 mapping is tested only as a handler unit test. No test drives approve against withdraw, or two approvals, with stale in-memory versions to prove that:
    - the 409 is actually produced
    - the membership flushed by `add_active_membership` is not persisted
  - These are the highest-risk paths in the feature.
- **Recommendation**: Add two integration tests:
  1. Force the fallback, for example by monkeypatching `repository.find_pending_join_request` to return None on its first call while a PENDING row exists. Assert 201, the same id, and no second notification.
  2. Load the request in two sessions, withdraw in one, and approve in the other. Assert 409 and that no active membership exists.
- **Fixable**: true

### W5. `create_join_request` lets any logged-in outsider probe which term ids belong to a PRIVATE group
- **Location**: `src/backend/app/groups/application/join_requests.py:79-82`
- **Category**: security (information disclosure, low impact)
- **Description**:
  - R2 deliberately skips `term_id` validation for outsiders on `/access`, so that term existence is not revealed.
  - `POST /join-requests` with an arbitrary `term_id` returns 404 for a foreign or unknown term, and 201 for a real term of the group. After the first request, later calls are idempotent 201s with no new notification.
  - An authenticated non-member can therefore enumerate the term ids of a PRIVATE group. They learn only existence and ids, not content.
  - The behaviour is spec-mandated (R5 step 3), but it contradicts R2's stated intent.
- **Recommendation**: Treat `term_id` as best-effort link context. For a foreign or unknown term, store `NULL` (and link to `/panel`) instead of returning 404. Alternatively, accept the risk explicitly in the spec. This needs a product decision.
- **Fixable**: false (spec decision)

---

## Informational

### I1. The `join_request_id` doc comment is inaccurate
- **Location**: `src/frontend/src/api/notifications.ts:32-35`
- **Description**: The comment says the field is "populated only for `GROUP_JOIN_REQUESTED`". The backend sets it for all three `GROUP_JOIN_*` kinds (`join_requests.py` `_decide_join_request`).
- **Suggestion**: Change it to "populated for the `GROUP_JOIN_*` kinds". **Fixable**: true

### I2. The panel load adds another sequential round trip
- **Location**: `src/frontend/src/pages/panel/PanelDataContext.tsx:563-568`
- **Description**: `listMyPendingJoinRequests()` is awaited after the notifications fetch. It is independent of that fetch, so it could run concurrently. Every panel load and silent reload pays one extra RTT.
- **Suggestion**: Start both with `Promise.allSettled`. **Fixable**: true

### I3. Withdraw returns 404 or 403 depending on whether the request exists
- **Location**: `src/backend/app/groups/application/join_requests.py:129-134`
- **Description**: This reveals whether a request id exists in a group: 403 for someone else's request, 404 otherwise. The impact is negligible, because ids are sequential and carry no content.
- **Suggestion**: Optionally return 404 for someone else's request. Not required. **Fixable**: true

### I4. Membership creation is check-then-insert with no DB uniqueness
- **Location**: `src/backend/app/groups/application/join_requests.py:185-186`; `application/memberships.py` `add_active_membership`
- **Description**: `approve_join_request` checks `_is_active_member` and then inserts. A concurrent `formalize_group_from_term` for the same party could create duplicate active memberships. This is a pre-existing pattern, and the window is tiny.
- **Suggestion**: Consider a partial unique index on active memberships `(from_role_id, to_group_id) WHERE valid_to IS NULL` in a future migration. **Fixable**: false

### I5. `withdrawFailed` is never cleared on gate transitions
- **Location**: `src/frontend/src/pages/krag/PrivateGroupGate.tsx:46,178`
- **Description**: Consider this sequence: a withdraw fails, the gate later moves to `rejected` or `canRequest`, and the user submits a new request that returns to `pending`. The old „Nie udało się wycofać prośby” alert reappears.
- **Suggestion**: Reset `withdrawFailed` when `gate.kind` or `gate.requestId` changes, or key it by `requestId`. **Fixable**: true

### I6. „Później” and the sheet ✕ stay enabled while a decision is in flight
- **Location**: `src/frontend/src/pages/panel/PanelDataContext.tsx:1669,1718` (`JoinRequestActionSheet`)
- **Description**: Hiding the item mid-request still runs the decision and shows the toast. This is harmless but slightly confusing.
- **Suggestion**: Disable „Później” while `busyDecision !== null`. **Fixable**: true

### I7. Member content can stay on screen after logout
- **Location**: `src/frontend/src/pages/krag/TermPage.tsx:66-75`
- **Description**: The `view` branch renders even when `isStale`, as the spec intends, to preserve the local state of the in-page login. After a logout on this page, a PRIVATE member's term content stays visible until the anonymous refetch lands. If that refetch fails, the content stays indefinitely, because the view branch does not surface `refreshError`.
- **Suggestion**: For PRIVATE groups, show the loader when `isStale && state.forToken !== null && token === null`, which is the logout case. **Fixable**: true

### I8. `PanelDataContext.tsx` keeps growing
- **Location**: `src/frontend/src/pages/panel/PanelDataContext.tsx` (1735 lines)
- **Description**: The file now also hosts `JoinRequestActionSheet` and five more pieces of state.
- **Suggestion**: Move the sheet (and possibly the join-request state into a small hook) into its own module. **Fixable**: true

### I9. Principals without a profile get 404 instead of 401
- **Location**: `src/backend/app/groups/application/join_requests.py:131,145,237,246`
- **Description**: `withdraw`, `approve`, `reject` and the lists call `get_profile_by_principal` without mapping `EntityNotFoundException`. A principal with no account profile, for example an OAuth client token with `mcp:edit`, therefore gets a 404 "UserProfile". `create_join_request` maps the same case to 401.
- **Suggestion**: Map it consistently, for example with a small `_require_profile` helper that raises `AuthenticationRequiredException`. **Fixable**: true

---

## Metrics
- Max function length (changed code): `usePanelDataValue` (pre-existing, >1000 lines). Among new functions, the longest are `create_join_request` at about 60 lines and the `PrivateGroupGate` component at about 240 lines, which includes JSX.
- Max nesting depth: 4 levels (`PanelDataContext.decideJoinRequest`)
- Potential vulnerabilities: 1 low-impact disclosure (W5). No injection, secrets or missing-auth findings.
- N+1 query risks: 0 in new code
- Files analyzed: 54 (38 tracked changes + 16 untracked)

## Prioritized Recommendations
1. W1: reset or invalidate `useTermAccess` state when `groupId`/`termId` change, which restores the „Nie znaleziono” behaviour on a failed navigation.
2. W4: add the two race integration tests (savepoint fallback; stale approve against withdraw → 409 with no membership).
3. W3: stop submitting the „Konto” placeholder; block the submit until `displayName` resolves.
4. W2: add a focus trap and restore focus after submit in `RequestAccessDialog`.
5. W5: decide on the product side whether term-id probing is acceptable; if not, null out an invalid `term_id` instead of returning 404.
6. The Info items as cleanup (I1, I5 and I9 are quick fixes).
