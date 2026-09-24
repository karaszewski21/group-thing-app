# Specification: PRIVATE group term in TermPage — login + access request approved by the organizer

## Goal
Serve PRIVATE groups on the existing term route (`/:organizationSlug/grupa/:groupId/term/:termId`). A logged-in non-member sends an access request through a confirm-only dialog. The group's active organizer approves or rejects it from the panel's pending-actions modal, and an approved member then sees the full term view. The same change closes two verified defects:
- **B13:** PRIVATE members and organizers get reduced content, and a wrong `term_id` returns 200.
- **B14:** users can self-join via `POST /api/memberships` and `POST /api/groups/public/{id}/join`.

## Overview

| Aspect | Decision |
|---|---|
| Route | Unchanged. `TermPage` becomes a thin switch over a `TermAccess` union computed by a pure `resolveTermAccess`. |
| View branch | The existing `PublicTermView`, unchanged apart from the S4 fix. It is not renamed. |
| Gate branch | `PrivateGroupGate`, evolved in place from `PrivateGroupAccessDenied`. It has 4 states: `loginRequired`, `canRequest`, `pending`, `rejected`. |
| Request dialog | `RequestAccessDialog` (confirm only). It replaces `JoinPrivateGroupDialog`, which is deleted. |
| Backend lifecycle | New `GroupJoinRequest` entity (PENDING / APPROVED / REJECTED / WITHDRAWN), 5 endpoints, 3 notification kinds, `notifications.join_request_id` pointer, global `StaleDataError` → 409 handler. |
| Organizer UI | A server-backed "Prośba o dostęp" item in `GlobalPendingActionsModal`, plus bell rows. There is no card on the term page. |

### Task characteristics driving this spec
- `has_reproducible_defect`: B13 and B14 have TDD red tests in `src/backend/tests/test_private_group_access_defects.py` (4 fail, 1 passes as a guard). All 5 must pass.
- `modifies_existing_code`, `creates_new_entities`, `involves_data_operations`, `ui_heavy`.
- Risk: medium-high. The work removes authorization paths, edits the first-match authorization matrix, and widens a public read to members.

---

## User Stories
1. As a **parent with a link to a PRIVATE group's term**, I want to log in and ask the organizer for access, so that I can see the term and sign up once approved.
2. As a **requester waiting for a decision**, I want to see that my request is pending, check again, or withdraw it, so that I am never stuck guessing.
3. As a **rejected requester**, I want a gentle message and a way to ask again, so that an honest mistake can be corrected.
4. As an **approved member or organizer of a PRIVATE group**, I want the full term view (date, attendees, needed items, RSVP), so that the group works like a PUBLIC one for insiders.
5. As an **organizer**, I want every pending request shown in my panel until I decide on it, so that no request gets lost after I dismiss a notification.
6. As the **product owner**, I want no path that grants membership without organizer approval, so that "private" really means private.

## User Journeys (binding flow)

**Requester**
1. Receives a term link to a PRIVATE group from the organizer.
2. Opens it anonymously and sees `loginRequired` (Mockup 3). Logs in or registers with `returnTo` pointing back to the term.
3. Lands on the same URL. `useTermAccess` refetches with the token, and the gate shows `canRequest` (Mockup 4).
4. Clicks „Poproś o dostęp”, which opens `RequestAccessDialog` (Mockup 7), and confirms with „Wyślij”. The request is created and the gate refetches into `pending` (Mockup 5).
5. While pending, the page refetches on window focus or on the tab becoming visible, and on „Sprawdź ponownie”. „Wycofaj prośbę” withdraws the request and returns to `canRequest`.
6. When the organizer decides, the requester sees:
   - A `GROUP_JOIN_APPROVED` or `GROUP_JOIN_REJECTED` notification in the panel bell, linking to the term.
   - After approval, a fresh load or refetch shows `PublicTermView`, where the requester can RSVP normally. There is no auto-RSVP.
   - After rejection, the page shows `rejected` (Mockup 6) with „Poproś ponownie”, which reopens the dialog. There is no cooldown.

**Organizer**
1. Receives `GROUP_JOIN_REQUESTED` in the bell (Mockup 11).
2. On the next panel load, `GlobalPendingActionsModal` shows a „Prośba o dostęp” item from the server list (Mockup 9) with Zatwierdź / Odrzuć / Później.
3. Zatwierdź creates membership and notifies the requester. Odrzuć notifies the requester. Później hides the item until the panel is remounted (a full page reload, or leaving and re-entering the panel so the panel provider remounts). Silent reloads do not bring it back (see R16).
4. Any 409 on a decision shows „Prośba została już rozstrzygnięta.” with „Rozumiem” (Mockup 10).

---

## Core Requirements

### Backend

**R1 — B14: remove the self-join paths.**
- Delete `POST /api/memberships`:
  - the route in `app/groups/router/memberships.py` L25-33
  - `create_membership` in `app/groups/application/memberships.py` L23-39
  - `CreateMembershipRequest` in `schemas.py`
  - the `service.py` import and `__all__` entry
- Keep `POST /api/memberships/{id}/end` and its matrix row #31.
- Delete `POST /api/groups/public/{id}/join`:
  - the route in `router/circles.py` L166-186
  - `join_private_group` in `public_view.py` L452-506
  - `JoinGroupRequest` and `JoinGroupResponse`
  - the matrix row and its comment (`authorization_matrix.py` L95-101)
  - the `service.py` entries
  - the stale docstrings, including:
    - `schemas.py` L2
    - the `app/groups/router/memberships.py` module docstring ("create / end a circle membership" → "end")
    - `src/frontend/src/components/krag/AuthGateSheet.tsx` L13 (mentions `PrivateGroupAccessDenied` → `PrivateGroupGate`)
- Both removed paths must return 404 or 405, and must create no membership.

**R2 — B13: member and organizer content from `/access`.**
- `get_public_circle_view` gains an `include_private_content` flag, default false. The reduced PRIVATE branch applies only when the flag is false.
- With the flag true, `term_id` is validated: an unknown term, or a term of another group, raises 404.
- With the flag false, a PRIVATE group keeps the reduced 200 response and does no `term_id` validation. This avoids revealing whether a term exists.
- `get_group_access` works in this order:
  1. Resolve the caller's profile, `is_organizer` and `is_member` first.
  2. Build the view with `include_private_content = is_member or is_organizer`.
  3. Use a single group load. `get_group_access` removes its own `get_group` call at L303 and reads visibility from the returned view (`group_response.visibility`). `get_public_circle_view` keeps its one internal group load.
- `is_attending` then works for PRIVATE members.
- `GET /api/groups/public/{id}` stays as it is: always reduced for PRIVATE.
- The flag comes only from server-side roles. A PENDING or REJECTED request never unlocks content, and an invalid or expired token degrades to the anonymous branch.

**R3 — `GroupJoinRequest` entity and migration 0037.**
- Status enum `GroupJoinRequestStatus`: PENDING, APPROVED, REJECTED, WITHDRAWN.
- Entity `GroupJoinRequest(BaseEntity)` in `app/groups/models.py`, table `group_join_requests`, sequence `group_join_request_seq`:

  | Column | Type | Notes |
  |---|---|---|
  | `group_id` | BIGINT NOT NULL | FK → `groups.id`, `fk_group_join_requests_group_id_groups` |
  | `requester_party_id` | BIGINT NOT NULL | FK → `parties.id`, `fk_group_join_requests_requester_party_id_parties` |
  | `term_id` | BIGINT NULL | FK → `terms.id`, `fk_group_join_requests_term_id_terms`; link context only |
  | `status` | VARCHAR(20) NOT NULL | `_enum_column(GroupJoinRequestStatus, 20)`, string-backed |
  | `created_at`, `updated_at` | TIMESTAMP NOT NULL | From `BaseEntity`. `updated_at` doubles as the decision time and as the optimistic-lock version. |

- The entity has no organizer column, because the organizer is resolved at action time. It also has no name, child count or message column.
- Migration `0037_group_join_requests.py`, with `down_revision="0036"`:
  - explicit sequence, following the `0031` helpers
  - `pk_group_join_requests`
  - the three FKs above
  - `ix_group_join_requests_group_id`
  - partial unique index `uq_group_join_requests_pending_requester_group` on `(requester_party_id, group_id) WHERE status = 'PENDING'`
  - a reversible downgrade (`OWNED BY NONE`, drop table, drop sequence)
- Rewrite the `GroupVisibility` docstring (models.py L74-84) to describe the request/approve flow instead of the join-link.

**R4 — Notifications pointer and kinds, migration 0038.**
- Migration `0038_notification_join_request_id.py` adds a nullable `join_request_id BIGINT` to `notifications`. It is a loose cross-BC pointer with no FK (template: `0032`), and it is reversible. `revision="0038"`, `down_revision="0037"`.
- The 0037 partial unique index exists only in the migration. It is not declared in the model's `__table_args__`, following the pledges precedent (`uq_pledges_active_needed_item`).
- `Notification.join_request_id` is added to the model, and `NotificationResponse.join_request_id: int | None = None` to the schema.
- `notifications_bridge.create_notification` gains an optional `join_request_id` pass-through, and `notifications.service.create_notification` accepts and stores it.
- New `NotificationKind` values:
  - `GROUP_JOIN_REQUESTED` (20 characters)
  - `GROUP_JOIN_APPROVED` (19)
  - `GROUP_JOIN_REJECTED` (19)
- No migration is needed for the kinds (`String(30)`, `native_enum=False`). Update the kind docstring to list the recipients.
- Producers, with the Polish messages built in the groups BC:

  | Kind | Recipient | Message | `link_path` | `join_request_id` |
  |---|---|---|---|---|
  | `GROUP_JOIN_REQUESTED` | the group's active organizer | `{requester display_name} prosi o dostęp do grupy „{group name}”` | term URL `/{slug}/grupa/{gid}/term/{tid}`, or `/panel` when `term_id` is null | request id |
  | `GROUP_JOIN_APPROVED` | requester | `Twoja prośba o dostęp do grupy „{name}” została zatwierdzona` | term URL, or `/panel` | request id |
  | `GROUP_JOIN_REJECTED` | requester | `Twoja prośba o dostęp do grupy „{name}” została odrzucona` | term URL, or `/panel` | request id |

- No notification is sent on withdraw.
- The slug comes from `app/groups/infrastructure/slug_resolver.resolve_organizer_slug`.

**R5 — Use cases** in the new module `app/groups/application/join_requests.py`. All are re-exported through the `app/groups/service.py` facade (imports and `__all__`). Each ends with one trailing commit, and repositories never commit.

| Use case | Rules, in check order | Result |
|---|---|---|
| `create_join_request(db, principal, group_id, term_id)` | Checks:<br>1. The caller has an account-backed profile via `get_profile_by_principal`, else `AuthenticationRequiredException` (401).<br>2. The group exists and is PRIVATE, else 404. A PUBLIC or unknown group gets 404.<br>3. If `term_id` is given, it exists and belongs to the group, else 404.<br>4. The caller is not the active organizer and not an active member, else 409 „Masz już dostęp do tej grupy”.<br>5. The group has an active organizer, else 409 „Ta grupa nie ma teraz organizatora”.<br>6. If a PENDING request already exists for (caller, group), return it: idempotent, with no new notification.<br>7. Insert inside `begin_nested()`. On `IntegrityError` from the partial unique index, re-select and return the existing PENDING row (race fallback, template `circulation/application/inventory.py` L40-64).<br>8. Stage the `GROUP_JOIN_REQUESTED` notification **only after** the insert and flush inside the savepoint succeed, because it needs `join_request_id`. Never stage it before `begin_nested()`. The fallback path (IntegrityError, then return the existing row) stages no notification. | New PENDING row plus a `GROUP_JOIN_REQUESTED` notification to the organizer. |
| `withdraw_join_request(db, principal, group_id, request_id)` | Checks:<br>1. The request exists and `request.group_id == group_id`, else 404.<br>2. The caller is the requester, else 403.<br>3. The status is PENDING, else 409 „Ta prośba została już rozstrzygnięta”. | Status becomes WITHDRAWN. No notification. |
| `approve_join_request(db, principal, group_id, request_id)` | Checks:<br>1. The request exists in the group, else 404.<br>2. The caller is the active organizer of the group at action time (`_require_active_organizer`), else 403.<br>3. The status is PENDING, else 409 „Ta prośba została już rozstrzygnięta”. | Adds an active membership through the shared helper (R6) only if the requester is not already an active member, then sets APPROVED and sends `GROUP_JOIN_APPROVED`. |
| `reject_join_request(db, principal, group_id, request_id)` | Same checks as approve. | Status becomes REJECTED and `GROUP_JOIN_REJECTED` is sent. |
| `list_group_pending_join_requests(db, principal, group_id)` | Checks:<br>1. The group exists, else 404.<br>2. The caller is the active organizer of that group (`_require_active_organizer`), else 403.<br>Then returns that group's PENDING requests, oldest first. It shares the repository query and name resolution with the cross-group list below. | List of `PendingJoinRequestResponse`. It has no frontend caller in this task; it is kept by explicit user decision for a future group view. |
| `list_my_pending_join_requests(db, principal)` | Groups where the caller is the active organizer (`list_active_leaderships_for_party`), then their PENDING requests, oldest first. Returns an empty list for non-organizers. | List with requester and group names, resolved in batch with no N+1: one request query that joins or batch-loads group names, plus `repository.list_profile_names_by_party_ids`. |

- Approving a request for a group that has since switched to PUBLIC is still allowed (decision 13). Its rows are kept.
- A lost optimistic-lock race (for example approve against withdraw, or two organizer tabs) surfaces as `StaleDataError`, which the global handler maps to 409 (R9).

**R6 — Shared helper for creating an active membership.**
- Name and place: `add_active_membership(db, group_id, party_id) -> Membership`, defined in `app/groups/application/memberships.py`.
- It is re-exported through the `app/groups/service.py` facade (import plus `__all__`), so that tests import it from `app.groups.service`, following the project rule of importing only from the facade.
- What it does: replaces the inline `Membership(...)` construction with `get_or_create_active_group_role(MEMBER)`, then a `Membership` with `valid_from=today` and `valid_to=None`, then a flush with no commit.
- Callers:
  - `approve_join_request`
  - `formalize_group_from_term`, whose loop at L149-158 is refactored to use it
  - the backend test seeding helpers (see "Required rewrites")
- The caller does the "already a member" check. The helper is not a new public API route.

**R7 — Endpoints.** They live in a new router module `app/groups/router/join_requests.py`, registered in `app/groups/router/__init__.py`. Include order: after `circles` is fine, because no existing route pattern collides. Routers import only `app.groups.service`.

| Method and path | Auth dependency | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/groups/public/{group_id}/join-requests` | `require_any()` (authenticated) | `{ "term_id": int \| null }` (optional) | **201** `JoinRequestResponse`. Also 201 when an existing PENDING row is returned (idempotent). | 401, 404 (group not PRIVATE or unknown; foreign term), 409 (member or organizer; no organizer) |
| `POST /api/groups/public/{group_id}/join-requests/{request_id}/withdraw` | `require_any()` | none | **200** `JoinRequestResponse` | 401, 403 (not the requester), 404, 409 (not PENDING, or lost race) |
| `GET /api/groups/mine/join-requests` | `ReadPrincipal` | none | **200** `list[PendingJoinRequestResponse]` | 401 |
| `GET /api/groups/{group_id}/join-requests` | `ReadPrincipal` | none | **200** `list[PendingJoinRequestResponse]` (that group's PENDING requests only, oldest first) | 401, 403 (not the group's active organizer), 404 (unknown group) |
| `POST /api/groups/{group_id}/join-requests/{request_id}/approve` | `EditPrincipal` | none | **200** `JoinRequestResponse` | 401, 403 (not the active organizer), 404, 409 |
| `POST /api/groups/{group_id}/join-requests/{request_id}/reject` | `EditPrincipal` | none | **200** `JoinRequestResponse` | 401, 403, 404, 409 |

Route order: FastAPI matches in registration order, so the literal `GET /api/groups/mine/join-requests` must be declared **before** `GET /api/groups/{group_id}/join-requests`. Otherwise `mine` is parsed as `{group_id}` and the request fails with 422. The `/public/...` routes are POST-only here and have a different segment count, so they cannot collide.

Schemas, all in `app/groups/schemas.py`:
- `CreateJoinRequestRequest { term_id: int | None = None }`
- `JoinRequestResponse`, modelled on `SwapProposalResponse` (`from_attributes`): `id`, `group_id`, `requester_party_id`, `term_id`, `status`, `created_at`, `updated_at`.
- `PendingJoinRequestResponse`: `id`, `group_id`, `group_name`, `term_id`, `requester_party_id`, `requester_display_name`, `created_at`.
- `JoinRequestSummary { id: int, status: Literal["PENDING","REJECTED"] }`, used by `/access`.

All error bodies use the existing envelope `{status, error, message, field_errors}`.

**R8 — Authorization matrix** (`app/core/authorization_matrix.py`; first match wins).
- **Replace** the `/join` row at the same position (before the blanket row 27) with an explicit `POST ^/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?$` → `AUTHENTICATED`. Add a comment explaining why it precedes row 27.
- `GET /api/groups/mine/join-requests` and `GET /api/groups/{gid}/join-requests` fall under blanket row 26 (READ). Approve and reject fall under blanket row 27 (EDIT). No new rows are needed; `resolve_requirement` tests pin these paths.
- Keep row #31 (`/api/memberships`), which is still needed for `/end`.
- Update the `/access` row comment, which mentions `can_join`, to mention `join_request`.
- Organizer and requester ownership checks live in the service, never in the matrix (EDIT effectively means "logged in").

**R9 — Global `StaleDataError` → 409.**
- Register a handler for `sqlalchemy.orm.exc.StaleDataError` in `app/core/errors.py` `register_exception_handlers`.
- It returns 409 "Conflict" with the Polish message „Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie”.
- This also turns today's take/swap race 500s into 409s.

**R10 — `/access` DTO.**
- `GroupAccessDetails` drops `can_join` and gains `join_request: JoinRequestSummary | None`.
- `join_request` is non-null only when **all** of these hold:
  - the group is PRIVATE
  - the caller is identified and is neither a member nor the organizer
  - the caller's **latest** request for the group (highest id) has status PENDING or REJECTED
- `join_request` is null in these cases:
  - the latest request is WITHDRAWN or APPROVED, for example for an ex-member whose membership ended
  - the caller is anonymous
  - the group is PUBLIC
- Update the `GroupAccessDetails` and `get_group_access` docstrings.

### Frontend (`src/frontend/src/`)

**R11 — Data layer.**
- `hooks/useTermAccess.ts`, rewritten according to FSM §7.3:
  - State union: `loading` | `error{message}` | `ready{data, forToken, refreshError}`.
  - A monotonically increasing request-sequence ref, so the latest request wins regardless of the order responses arrive in.
  - A failed **refetch** keeps `ready` and sets `refreshError`. Only a failed first load gives `error`.
  - This includes a fetch triggered by a token change: on failure the state stays `ready` with the old `forToken`, so `isStale` stays true and `refreshError` is set. R12 defines how that renders, so it can never hang on a loader.
  - A later successful fetch clears `refreshError`.
  - It returns `{ state, isStale, refetch }`, where `isStale = ready && forToken !== current token`.
  - `refetch` is stable across renders for the same `(groupId, termId, token)`.
- `api/groups.ts`:
  - Remove `can_join`, `createMembership`, `CreateMembershipRequest`, and the `joinPrivateGroup`, `JoinGroupRequest` and `JoinGroupResponse` block. Update the section comment.
  - Add these types: `JoinRequestStatus`, `JoinRequestSummary`, `JoinRequestResponse`, `PendingJoinRequestResponse`.
  - Add `join_request` to `GroupAccessDetails`.
  - Add these functions:

    | Function | Request |
    |---|---|
    | `createJoinRequest(groupId, termId?)` | `POST /groups/public/{gid}/join-requests` with `{term_id}` |
    | `withdrawJoinRequest(groupId, requestId)` | `POST /groups/public/{gid}/join-requests/{rid}/withdraw` |
    | `listMyPendingJoinRequests()` | `GET /groups/mine/join-requests` |
    | `approveJoinRequest(groupId, requestId)` | `POST /groups/{gid}/join-requests/{rid}/approve` |
    | `rejectJoinRequest(groupId, requestId)` | `POST /groups/{gid}/join-requests/{rid}/reject` |
- `api/client.ts` 401 redirect (L37-42): redirect to `/login?returnTo=<encodeURIComponent(pathname + search)>` instead of bare `/login`, keeping the existing "not already on `/login`" guard.
  - This is a one-line change.
  - The login route's `AuthGuard` already honours `?returnTo=` (`auth/AuthGuard.tsx` L40-45).
  - A user with an expired token who clicks „Poproś o dostęp” therefore returns to the term after logging in.
  - It applies to every 401, which strictly improves the existing behaviour.
- `api/notifications.ts`: add the 3 kinds to `NotificationKind` and `join_request_id?: number | null` to `NotificationResponse`.

**R12 — TermPage switch** (`pages/krag/TermPage.tsx`, `TermPage()` L53-85).
- New pure module `pages/krag/termAccess.ts` (no JSX) exporting the `PrivateGate` and `TermAccess` types and `resolveTermAccess(data, identified)`, following research §6.2:
  - `can_view_content` gives `view`.
  - Otherwise, not `identified` gives `loginRequired`.
  - PENDING gives `pending{requestId}`.
  - REJECTED gives `rejected`.
  - Anything else gives `canRequest`.
- `identified = state.forToken !== null`. It records whether the data was fetched with a token, not whether a token exists now.
- Render rules:

  | Hook state | Renders |
  |---|---|
  | `loading` | `KragStageMessage` „Wczytywanie...” |
  | `error` | „Nie znaleziono” |
  | `ready`, resolved to `view` | `PublicTermView` with the same props as today, including when `isStale`, so in-page login in `PublicTermView` keeps its local state as today |
  | `ready`, resolved to a gate, `isStale` and `refreshError === null` | „Wczytywanie...”, so a PENDING user never sees a flash of „Poproś o dostęp” |
  | `ready`, resolved to a gate, `isStale` and `refreshError !== null` (the fetch for the new token failed) | `PrivateGroupGate` with `stale` set: the header and card heading are shown, but the state-specific body and actions are hidden, because they came from data fetched for another token. The card shows the `.kg-error role="alert"` line „Nie udało się odświeżyć strony — spróbuj ponownie.” and a `kg-btn-primary` „Spróbuj ponownie” that calls `refetch()` (busy: „Sprawdzanie…”, `aria-busy`). A successful retry clears `isStale` and renders the correct state. |
  | `ready`, resolved to a gate, otherwise | `PrivateGroupGate`. A non-null `refreshError` is shown as the `.kg-error` line (R13). |
- Remove the `visibility === "PRIVATE"` branch.

**R13 — `PrivateGroupGate`.**
- Rename or evolve `pages/krag/PrivateGroupAccessDenied.tsx` into `pages/krag/PrivateGroupGate.tsx`. The old file and export are removed.
- Props: `groupId`, `termId`, `group`, `gate`, `refetch`, `refreshError`, `stale` (boolean, see R12).
- It keeps the `KragStage` and `GroupHeader` shell and one `.kg-card` with the heading „Ta grupa jest prywatna”. Only the card body changes per state (Mockups 2-6).
- It has no local `joined` flag, and its durable state comes only from the server.
- Local submit state: `RequestFlow = idle | submitting | failed{message}`, plus a local "withdrawing" and "checking" busy state.
- `loginRequired`: explanation copy plus `AuthGateLinks` (without `onGuest`, with `returnTo`). No auth-only API call is made in this state.
- `canRequest`:
  - Copy plus a „Poproś o dostęp” button that opens `RequestAccessDialog` in the `KragStage` `overlay` slot.
  - When a create call returns 409, the gate records a local `createConflict` flag and calls `refetch()`.
  - The no-organizer `.kg-error` line „Ta grupa nie ma teraz organizatora — nie można wysłać prośby.” is shown while `createConflict` is set, the state is still `canRequest`, and `group.organizer_display_name` is null.
  - These conditions are evaluated at render time against the **refetched** `group`, not the data from before the click, so an organizer who left after the page loaded is detected.
  - The flag clears on the next dialog open.
- `pending`:
  - A status line inside the always-mounted live region.
  - „Sprawdź ponownie” calls `refetch()`. While busy it shows „Sprawdzanie…” with `aria-busy`.
  - „Wycofaj prośbę” calls `withdrawJoinRequest`. While busy it shows „Wycofywanie…”, disabled, with `aria-busy`.
    - On success it refetches, which leads to `canRequest`.
    - On 409 it refetches.
    - On any other error it shows `.kg-error role="alert"` „Nie udało się wycofać prośby — spróbuj ponownie”.
  - It listens to window `focus` and document `visibilitychange` (when visible) and calls `refetch()`, **only while in `pending`**. The listeners are removed on state change or unmount. There is no polling.
- `rejected`: gentle copy plus „Poproś ponownie”, which opens the same dialog.
- A non-null `refreshError` shows a `.kg-error` line and never replaces the page.

**R14 — `RequestAccessDialog`** (new file `components/krag/RequestAccessDialog.tsx`; delete `components/krag/JoinPrivateGroupDialog.tsx`).
- A confirm-only bottom sheet built from the deleted dialog's markup, with the form fields removed.
- Props: `groupId`, `termId`, `groupName`, `onClose`, `onSubmitted`, `onConflict`.
- „Wyślij” calls `createJoinRequest(groupId, termId)`:

  | Outcome | Behaviour |
  |---|---|
  | 2xx | Close the sheet, then the gate calls `refetch()`, which leads to `pending`. |
  | 409 | Close the sheet, then the gate calls `refetch()` and shows the no-organizer line when applicable. |
  | Other error | Show `.kg-error role="alert"` „Nie udało się wysłać prośby — spróbuj ponownie” and keep the sheet open. |
- „Anuluj”, ✕, an overlay click and Esc all close the sheet (not while busy), and focus returns to the trigger button.
- Initial focus is on „Wyślij”.

**R15 — S4 fix and a11y side fixes.**
- In `PublicTermView`, the RSVP dialog choice uses `isLoggedIn` alone, not `isLoggedIn && displayName` (TermPage.tsx L375-390). A logged-in user whose profile name has not loaded yet must not get the guest dialog. Pass the display name through when available and do not block on it. For a logged-in user, `RsvpDialogLoggedIn` must render even when `displayName` is still empty.
- Fix the dangling `aria-labelledby` in `pages/krag/components/NeededItemsSection.tsx` L36 and `pages/krag/components/AttendeeList.tsx` L50. Use either a restored heading `id` or an `aria-label` with the section's Polish name.

**R16 — Organizer pending action** (`pages/panel/PanelDataContext.tsx`).
- New `PendingJoinRequestAction { kind: "GROUP_JOIN_REQUESTED", joinRequestId, groupId, groupName, requesterName, createdAt }`, added to the `PendingAction` union. It has no `linkPath`: the modal has no navigation button (Mockup 9), and the pending-list response carries no link.
- Source: `listMyPendingJoinRequests()`, loaded in the panel's `load()` alongside notifications. This includes `load({silent: true})`.
  - Its failure must not break the panel: treat it as an empty list and do not toast.
  - `load()` also coerces any non-array result (for example `undefined` from a reset test mock) to `[]` before storing it.
- The "Później" hidden set is provider state in `PanelDataProvider`. Neither `load()` nor `load({silent: true})` clears it, so silent reloads after decisions or on panel re-entry do not bring hidden items back. It resets only when `PanelDataProvider` remounts, for example on a full page reload.
- Join-request items are **not** derived from notifications, so there are no duplicates. They are merged into `pendingActions` oldest first, after the existing notification-derived items.
- Busy, already-resolved and session-hidden state for these items is keyed by `joinRequestId`, not `notificationId`, because a server item may have no unread notification. The existing swap and confirm behaviour stays unchanged.

| Button | Behaviour |
|---|---|
| Zatwierdź / Odrzuć | Calls `approveJoinRequest` or `rejectJoinRequest`. While busy, both decision buttons are disabled with `aria-busy` and the labels „Zatwierdzanie…” / „Odrzucanie…”.<br>On 2xx: mark any unread `GROUP_JOIN_REQUESTED` notification with the matching `join_request_id` as read, call `load({silent: true})`, and show the toasts „Prośba zatwierdzona” / „Prośba odrzucona”.<br>On **any** 409: show the already-resolved state (Mockup 10): `role="alert"` „Prośba została już rozstrzygnięta.” and „Rozumiem”, which dismisses and calls `load({silent: true})`. This is decision D-2. Do **not** copy the swap `already_resolved === true` check.<br>On other errors: `role="alert"` „Nie udało się zapisać decyzji — spróbuj ponownie”. |
| Później / ✕ | Adds `joinRequestId` to the provider's hidden set. There is no server call and no notification change. The item reappears only after a provider remount (see above). |

- In the bell, opening a `GROUP_JOIN_REQUESTED` row marks it read (existing behaviour) and does not remove the pending action.
- `PanelModals.tsx` L170 and L248: change the PRIVATE option label from „(link dołączenia)” to „(dostęp na prośbę)”.

---

## Visual Design
The mockups in `analysis/design-context/` (`INDEX.md`, `ascii/ui-mockups.md`) are **binding inputs**. The implementation planner will attach `Visual References` to UI task groups. Layout, Polish copy, states and a11y attributes are binding. Fidelity is structural and copy-level; pixel values are taken from the existing `.kg-*` and panel classes.

| ID | What it shows | Key binding elements |
|---|---|---|
| `screen:term-page-access-switch` | `TermPage` branching via `resolveTermAccess` | `view` goes to `PublicTermView` unchanged. The loading and not-found messages are reused. The stale token gives „Wczytywanie...” for the gate only (R12). |
| `component:private-group-gate` | Gate shell | `KragStage` + `GroupHeader` (eyebrow „Krąg”, title = group name, subtitle „Prowadzi: …” / „Brak organizatora”, „← Wróć”) + one `.kg-card` with an `<h2>` „Ta grupa jest prywatna” (Fraunces 17px, decorative 🔒 `aria-hidden`). There is no term date, attendee list, needed items or footer. The dialog renders in the `overlay` slot. |
| `screen:private-gate-login` | `loginRequired` | Copy „Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby poprosić organizatora o dostęp.” plus `AuthGateLinks` (Zaloguj się / Zarejestruj się with `returnTo`). |
| `screen:private-gate-can-request` | `canRequest` | Copy „… Poproś organizatora o dostęp — dostaniesz powiadomienie, gdy podejmie decyzję.” plus a `kg-btn-primary` „Poproś o dostęp” (marginTop 12, padding 10px 18px, 13px), and the no-organizer `.kg-error` line. |
| `screen:private-gate-pending` | `pending` | Always-mounted `role="status" aria-live="polite"` region with `.kg-status-line` „⏳ Prośba wysłana — czeka na akceptację organizatora” (⏳ `aria-hidden`). An optional 12px line „Wysłano {data}. Strona odświeży się sama, gdy tu wrócisz.” The date is shown only if available; `/access` does not carry it, so omitting the date part is acceptable. „Sprawdź ponownie” (primary) and „Wycofaj prośbę” (ghost) sit in a wrapping flex row with gap 8. |
| `screen:private-gate-rejected` | `rejected` | Gentle copy „Organizator nie zatwierdził tym razem Twojej prośby. Jeśli to pomyłka, możesz poprosić ponownie.” with no red, plus a primary „Poproś ponownie”. |
| `component:request-access-dialog` | Confirm sheet | `role="dialog" aria-modal="true"` `aria-labelledby` → `<h3>` „Poprosić o dostęp?”. ✕ `aria-label="Zamknij"`. Body „Wyślesz prośbę do organizatora grupy „{name}” (bold). Zobaczy Twoje imię z konta i zdecyduje, czy dodać Cię do grupy.” Full-width „Wyślij” (busy „Wysyłanie…”, disabled, `aria-busy`) and „Anuluj” ghost (disabled while busy). Overlay `rgba(20,28,24,0.55)`, z 60, sheet max 430px, radius 24px 24px 0 0, padding 20. |
| `flow:private-gate-states` | State transitions | loginRequired → canRequest → pending → view or rejected; withdraw returns to canRequest; rejected → dialog → pending. |
| `component:panel-join-request-action` | Organizer modal item | `ModalSheet` title „Prośba o dostęp”. Body „{requester} prosi o dostęp do grupy „{group}”.” and `text-xs text-ink-soft` „Wysłano {data}”. Button row `mt-3 flex gap-2`: Zatwierdź (mint pill), Odrzuć and Później (border pills). Odrzuć has no extra confirmation. Items are shown one at a time. |
| `component:panel-join-request-resolved` | 409 state | `<p role="alert" class="mt-3 text-sm font-semibold text-danger">` „Prośba została już rozstrzygnięta.” and a „Rozumiem” pill. |
| `component:panel-bell-join-notifications` | Bell rows | No markup change. The 3 new kinds render the backend `message` with the existing unread dot and bold, and link to `link_path`. |

Responsive (from the mockups): below 520px the layout is full width and the pending buttons wrap. At 520px and above there is a phone frame and the sheet stays at max 430px. The panel keeps its existing `ModalSheet` behaviour.

Do **not** use `components/shared/ConfirmDialog` (Chakra, English) on krag pages.

---

## Data Model Summary

| Entity | Change |
|---|---|
| `GroupJoinRequest` (new) | See R3. Invariant R-1: at most one PENDING row per (requester, group), enforced by the partial unique index plus a service pre-check. Terminal statuses are kept as history. There is no delete and no expiry. |
| `Notification` | New nullable `join_request_id` (loose pointer), plus 3 kinds. |
| `Membership` | No schema change. Creation paths after this task: approve (organizer) and formalize (organizer) only. |

Lifecycle:

| From | Event | To | Side effects |
|---|---|---|---|
| (none), or latest APPROVED / REJECTED / WITHDRAWN | create | PENDING | Notification to the organizer |
| PENDING | create (duplicate) | PENDING (the same row) | None |
| PENDING | approve | APPROVED | Membership if missing; notification to the requester |
| PENDING | reject | REJECTED | Notification to the requester |
| PENDING | withdraw | WITHDRAWN | None |
| Anything other than PENDING | approve / reject / withdraw | unchanged | 409 |

---

## Edge Cases and Races

| Case | Expected behaviour |
|---|---|
| Double click, or two tabs, on „Wyślij” | Idempotent: the existing PENDING row is returned. If the race hits the index, the `begin_nested` fallback re-selects it. There is never a generic "Data integrity violation". |
| Approve vs withdraw, or two organizer tabs | Status guard gives 409. A concurrent write gives `StaleDataError` and then 409 (R9). The panel shows „Prośba została już rozstrzygnięta.” |
| Requester became a member meanwhile (formalize) | Approve marks APPROVED without a duplicate membership. Create returns 409 because the caller is already a member. |
| Group has no active organizer (including an organizer who left after the page loaded) | Create returns 409, the gate refetches, and it shows the no-organizer line based on the refetched `group` (R13). |
| Organizer changes while a request is PENDING | The new organizer sees it in their list; the old organizer gets 403 on a decision. |
| PRIVATE → PUBLIC with PENDING rows | Rows are kept. Approve and reject are still allowed. `/access` gives `join_request: null` and the page shows the view. |
| Ex-member (membership ended) | The latest request is APPROVED, so `join_request` is null and the gate shows `canRequest`. |
| Wrong or foreign `term_id` | Member or organizer: 404, and the page shows „Nie znaleziono”. Outsider or anonymous: reduced 200 and the gate. Create with a foreign `term_id`: 404. |
| Expired token while the client thinks it is logged in | `/access` treats the caller as anonymous, but the data was fetched with a token (`forToken !== null`), so the gate resolves to **`canRequest`**, even for a member. Clicking „Poproś o dostęp” → „Wyślij” gets a 401. `api/client.ts` clears the token and redirects to `/login?returnTo=<term URL>` (R11), and after logging in the user lands back on the term with the correct state. Accepted behaviour. |
| Token changes in-page while the gate is shown | `isStale` shows „Wczytywanie...” until the new response arrives. If that fetch fails, the gate shows the error line plus „Spróbuj ponownie” instead (R12), never an endless loader. |
| Refetch fails in the gate | Keep the screen and show a `.kg-error` line. |
| Requester opens a `GROUP_JOIN_APPROVED` link | Fresh mount, and `/access` gives `view`. |

---

## Reusable Components

### Existing code to leverage
| What | Path | Use |
|---|---|---|
| SwapProposal template (model, statuses, 409 "already resolved") | `app/groups/models.py` L299-336; `application/term_item_listings.py` L419-621; `router/term_item_listings.py` L108-122 | Entity, use-case and route shape |
| Migration templates | `alembic/versions/0031_swap_proposal.py` (sequence helpers, downgrade), `0032_notification_proposal_id.py` (pointer column), `0023` L51-57 (partial unique index) | 0037 / 0038 |
| Organizer checks | `application/circles.py` `_is_active_organizer`, `_require_active_organizer`, `get_current_leadership`, `_group_role_party_id`, `list_active_leaderships_for_party` | Authorization, organizer fan-out, cross-group list |
| Member check | `application/memberships.py` `_is_active_member` | Create guard and approve idempotency |
| Role creation | `application/group_roles.py` `get_or_create_active_group_role` | Inside the R6 helper |
| Identity | `app.users.service.get_profile_by_principal` | Requester and organizer party |
| Names in batch | `infrastructure/repository.py` `list_profile_names_by_party_ids` | Pending list |
| Notification ACL | `infrastructure/notifications_bridge.py`; `infrastructure/slug_resolver.py` | Producers and link path |
| Race fallback | `circulation/application/inventory.py` L40-64 | Duplicate create |
| Errors | `app/core/errors.py` (`EntityNotFoundException`, `BusinessConflictException`, `AccessDeniedException`); `app/core/_auth/principal.py` `AuthenticationRequiredException` | Status mapping |
| Krag shell | `pages/krag/components/KragStage.tsx` (`overlay` prop, `KragStageMessage`), `pages/krag/components/GroupHeader.tsx`, `.kg-*` classes | Gate and dialog |
| Auth links | `components/krag/AuthGateSheet.tsx` `AuthGateLinks` | `loginRequired` |
| Panel modal | `pages/panel/PanelDataContext.tsx` `GlobalPendingActionsModal`, `load({silent})`, the `SWAP_PROPOSED` button row and the already-resolved block; `pages/panel/panelComponents.tsx` `ModalSheet` | Organizer action |
| API client | `api/client.ts` `ApiError` (`status`) | 409 detection |

### New components required
| New | Why existing code cannot be reused |
|---|---|
| `GroupJoinRequest` + enum + migrations 0037/0038 | No request concept exists. Putting a status on `Membership` would risk access leaks across 3 or more "active" queries (research §8.3). |
| `application/join_requests.py` + `router/join_requests.py` | New lifecycle. `circles.py` and `public_view.py` are already large; one module per concern follows the `term_item_listings` precedent. |
| Shared membership helper (R6) | Extraction, not new logic. It removes duplicated construction in approve and formalize, and gives tests a seeding path once `POST /api/memberships` is gone. |
| `termAccess.ts` (`resolveTermAccess`) | A pure function that is table-testable and keeps the gate outside the future FSM reducer. |
| `RequestAccessDialog.tsx` | The confirm-only content differs completely from the deleted form dialog. It reuses that dialog's markup. |
| `PrivateGroupGate.tsx` | Evolved from `PrivateGroupAccessDenied` (moved, not duplicated). |

### To delete
`join_private_group`, `create_membership`, `JoinGroupRequest`, `JoinGroupResponse`, `CreateMembershipRequest`, the `/join` and `POST /api/memberships` routes, the `/join` matrix row, the frontend `joinPrivateGroup`, `createMembership` and related types, `JoinPrivateGroupDialog.tsx`, `PrivateGroupAccessDenied.tsx` (replaced by `PrivateGroupGate.tsx`), and `can_join` everywhere.

---

## Implementation Guidance

### Suggested order
1. B14 removals and the R6 helper, with test helpers rewritten. This turns red tests 3 and 4 green.
2. B13 in `public_view`. This turns red tests 1 and 2 green, and test 5 stays green.
3. Entity, migrations 0037/0038, use cases, routes, matrix, notifications, the `/access` DTO and the `StaleDataError` handler.
4. Frontend API modules and the `useTermAccess` rewrite.
5. `termAccess`, the `TermPage` switch, `PrivateGroupGate`, `RequestAccessDialog`, and the S4 and a11y fixes.
6. Panel pending action and notification kinds.

### Testing approach
- Write 2-8 focused tests per implementation step group.
- **Per-group verification** runs only that group's new and rewritten tests, plus the red-gate file.
- **Final verification** (Success Criterion 1) runs the full backend suite (`uv run pytest` in `src/backend`) and the full frontend suite, because the removals touch about 20 existing tests across 4 backend files.
- Backend tests are integration-first: real Postgres testcontainer and the httpx `client`. Test names follow `test_<action>_<condition>_<result>`, with per-file helpers.
- Frontend tests use Vitest and Testing Library in `src/test/`, `vi.mock` API modules, and `renderWithProviders`.

**Required: TDD red gate.** All 5 tests in `src/backend/tests/test_private_group_access_defects.py` pass. Command: `uv run pytest -q tests/test_private_group_access_defects.py` in `src/backend`.

**Required rewrites (about 19 existing backend tests):**
- `tests/test_circles_router.py` helper L52-65 (3 tests) and `tests/test_exchange_summary.py` helper L66-83 plus the direct POST at L313 (8 tests): seed an active membership through `db_session` using `add_active_membership`, imported from `app.groups.service`.
  - The affected helper functions gain a `db_session: AsyncSession` parameter, and each affected test function adds the `db_session` fixture parameter and passes it through. The `client` fixture already shares the same session.
  - Resolve the registered user's party, for example with a `UserProfile` lookup through `db_session`, then flush and commit per conftest SAVEPOINT semantics.
  - Do not use the removed endpoint.
- Remove the `/join` tests: `test_circles_router.py` L191-279 (plus the unused `resolve_requirement` import, if it becomes unused), and `test_group_privacy.py` L216-245 (plus its docstring or NOTE). Coverage moves to the new join-request tests.
- `tests/test_group_access.py`: update the 3 full-dict asserts (`can_join` → `join_request: None`). Replace the anonymous PRIVATE `can_join=True` assert with `join_request is None`, and keep `next_term is None`.

**New backend tests** (for example `tests/test_group_join_requests.py`, `tests/test_group_join_requests_router.py`, plus additions to `test_group_access.py` and `test_authorization_matrix.py`):
- Model and migration: the partial unique index rejects a second PENDING row for the same (requester, group) and allows a new PENDING after REJECTED or WITHDRAWN. All kinds are ≤ 30 characters (template `test_swap_proposal_model.py`).
- Create:
  - anonymous → 401
  - PUBLIC group → 404
  - success → 201 PENDING, plus a `GROUP_JOIN_REQUESTED` notification to the organizer with `join_request_id` and the term `link_path`
  - duplicate → same id, no second notification
  - member or organizer → 409
  - no organizer → 409
  - foreign `term_id` → 404
- Approve and reject:
  - non-organizer → 403
  - approve creates an active membership, sets APPROVED and notifies the requester
  - approve when already a member → no duplicate membership
  - second decision → 409
  - reject → REJECTED plus a notification
  - request from another group's path → 404
- Withdraw: stranger → 403; owner → WITHDRAWN with no notification; after a decision → 409.
- The pending list returns only requests of groups the caller organizes, oldest first, with names. A non-organizer gets `[]`.
- Per-group list `GET /api/groups/{gid}/join-requests`:
  - the organizer gets 200 with only that group's PENDING items (not other groups' items, and not APPROVED, REJECTED or WITHDRAWN ones), oldest first
  - a non-organizer gets 403
  - an unknown group gets 404
- `/access`:
  - member (after approve) gets full content and `is_attending` works after RSVP
  - `join_request` is PENDING, then REJECTED, then null after withdraw
  - PENDING and REJECTED callers still get `next_term is None` (privacy regression)
  - member with a wrong `term_id` → 404
- After approve, an approved member's RSVP → 201.
- `StaleDataError` → 409 handler: a unit-level test of the registered handler mapping is acceptable.
- Matrix `resolve_requirement` rows:
  - create and withdraw → AUTHENTICATED
  - `GET mine/join-requests` and `GET {gid}/join-requests` → READ
  - approve and reject → EDIT
  - the `/join` path now falls to row 27
  - `/api/memberships/{id}/end` → unchanged

**Frontend tests:**
- `src/test/termAccess.test.ts`: table test of `resolveTermAccess` covering PUBLIC, PRIVATE member, organizer, anonymous, logged in with no request, PENDING, REJECTED, and `identified=false` with PENDING in the data.
- `src/test/useTermAccess.test.ts`:
  - a refetch error keeps `ready` with `refreshError`
  - out-of-order responses: the latest request wins
  - a token change gives `isStale` until the response arrives
  - a token change whose fetch fails leaves `ready`, `isStale === true` and `refreshError` set. A following successful `refetch` clears both.
- `src/test/TermPage.test.tsx`:
  - update the `access()` factory (`join_request: null`, no `can_join`)
  - the `../api/groups` mock (L10-13) spreads `...actual` and overrides only selected functions with `vi.fn()`. **Add** `createJoinRequest: vi.fn()` and `withdrawJoinRequest: vi.fn()` to those overrides, so gate tests never reach the real client. Nothing is swapped, because `joinPrivateGroup` was never mocked.
  - gate stale-failure (M-1): the first `/access` response resolves to a gate. Then the `mockAuth.token` changes and the second `getGroupAccess` rejects. After a rerender, the error line and „Spróbuj ponownie” are shown and „Wczytywanie...” is not. Clicking „Spróbuj ponownie” with a successful response renders the resolved state.
  - a 409 on create where the refetched group has `organizer_display_name: null` shows the no-organizer line
  - canRequest → dialog → „Wyślij” → API called with `(groupId, termId)`, then refetch, then the pending text inside `role="status"`
  - pending → „Wycofaj prośbę” → canRequest
  - REJECTED → „Poproś ponownie” visible
  - PRIVATE member sees the term content and no guest CTAs
  - pending plus `visibilitychange` with `can_view_content=true` → content shown
  - the S4 case: logged in with no display name gets the logged-in RSVP dialog
  - keep the existing anonymous PRIVATE test, with new copy
- `src/test/PanelPage.test.tsx`:
  - add `listMyPendingJoinRequests`, `approveJoinRequest` and `rejectJoinRequest` to the fixed `../api/groups` mock list (L61-73)
  - **Required default (M-2):** `beforeEach` runs `vi.resetAllMocks()`, which makes a bare `vi.fn()` resolve to `undefined`. Set `vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([])` in the shared per-test defaults (after the reset, where the other defaults are set), so every existing PanelPage test keeps passing.
  - `load()` coercion: a test where `listMyPendingJoinRequests` resolves to `undefined` still renders the panel with no join-request item and no crash.
  - Później survives a silent reload: hide the item, trigger a decision on another item (or `load({silent: true})`), and the hidden item stays hidden.
  - approve → API call, then reload
  - reject
  - 409 → „Prośba została już rozstrzygnięta.”
  - Później hides the item without a notification read call
  - the item comes from the server list even when its notification is read

### Standards Compliance
- `standards/backend/models.md`: `BaseEntity` with an explicit sequence and `updated_at` version, a string-backed enum via `_enum_column`, plain FK-id columns with no `relationship()`, and loose cross-BC pointers for notifications.
- `standards/backend/migrations.md`: small reversible migrations, one per concern (0037 schema, 0038 pointer), explicit sequences, and naming `pk_/fk_/uq_/ix_`.
- `standards/backend/security.md`: matrix as code with an explicit specific row before the blanket row, first match wins; role checks in services; `require_any()` for authenticated-only routes.
- `standards/backend/api.md`: plural resource nouns (`join-requests`), limited nesting, 201 on create.
- `standards/backend/queries.md`: batched name lookups with no N+1; a transaction per use case with a single trailing commit.
- `standards/global/error-handling.md` and `validation.md`: typed exceptions, centralized handlers (`StaleDataError`), fail-fast pre-checks, and specific Polish messages.
- `standards/global/minimal-implementation.md`: no expiry job, no shims for `can_join`, and dead code deleted. One documented exception: the per-group list endpoint has no frontend caller in this task and is kept by explicit user decision for a future group view. It stays backend-only, with no frontend API function.
- Frontend `components.md`, `css.md` (krag `.kg-*` plus inline styles, panel Tailwind), `accessibility.md` (live region, `role="alert"`, `aria-busy`, dialog labelling, focus return, `aria-hidden` decorative emoji) and `responsive.md`.
- `standards/testing/backend-testing.md` and `frontend-testing.md`: integration-first, 2-8 tests per group, naming, and `vi.mock` of API modules.
- Project memory: backend DDD layering, with routers importing only `app.groups.service`; public URL scheme `/:slug/grupa/:groupId/term/:termId`; pre-production, so no backward-compatibility shims.

---

## Out of Scope
- The TermView state reducer (FSM §7.2), and the `key={groupId:termId}` route remount (S15).
- Privacy hardening of `/api/terms`, `/api/needed-items`, `/api/pledges` (including POST) and `/api/groups/{id}/memberships`, and invalidating `TermAttendance` on membership end or on PUBLIC→PRIVATE. This is a separate follow-up task.
- Request expiry, an optional request message, name or child fields, and a cooldown.
- An organizer approval card on the term page, and any frontend consumer of the per-group list (the endpoint itself is in scope, backend-only).
- Auto-RSVP on approve, and notifying the organizer on withdraw.
- Email or push notifications, and polling.
- Renaming `PublicTermView`.
- Fixing the swap modal's never-firing `already_resolved` check (follow-up).

## Risks
| Risk | Mitigation |
|---|---|
| Privacy leak if the member/organizer predicate is wrong | Derive the flag only from `_is_active_organizer` / `_is_active_member`. Privacy regression tests for outsider, PENDING and REJECTED callers, plus red test 5. |
| Matrix ordering mistake | Replace the `/join` row in place, and pin with `resolve_requirement` tests for all new and neighbouring paths. |
| About 19 broken tests after the removals | Shared R6 seeding helper, and helpers rewritten before the endpoints are deleted. |
| DTO change breaks the frontend and tests | `can_join` is removed in both the backend and the frontend in the same change, and the factories are updated. |
| Gate flicker after login | `forToken` / `isStale` gate-only loader. |
| Organizer misses requests | Server-backed pending list (D-1) independent of notification read state. |
| Stale-data races | Status guards plus the global `StaleDataError` → 409 handler. |

## Success Criteria
1. All 5 tests in `test_private_group_access_defects.py` pass, and the full backend suite (`uv run pytest` in `src/backend`) is green after the rewrites.
2. `POST /api/memberships` and `POST /api/groups/public/{id}/join` return 404 or 405 and create no membership, and no frontend code references them.
3. A PRIVATE member or organizer gets full content from `/access`, and a wrong `term_id` gives them 404. Outsiders, and PENDING or REJECTED callers, get the reduced response.
4. The request lifecycle (create, idempotent duplicate, withdraw, approve, reject, re-request) behaves as the tables above describe, with the specified status codes and notifications. Both pending lists work: `GET /api/groups/mine/join-requests` covers every group the caller organizes, and `GET /api/groups/{gid}/join-requests` is organizer-only for one group (200, 403 for a non-organizer, 404 for an unknown group).
5. `alembic upgrade head` applies 0037 and 0038, and a downgrade back to 0036 succeeds.
6. `TermPage` renders `PublicTermView` for members and organizers of PRIVATE groups, and the gate in 4 states for everyone else. The gate matches the binding mockup IDs, copy and a11y attributes.
7. The organizer sees every PENDING request in `GlobalPendingActionsModal` on each panel load until it is decided, and any 409 gives the already-resolved state.
8. Frontend tests (`termAccess`, `useTermAccess`, `TermPage`, `PanelPage`) pass, and `npm run lint`, typecheck, `ruff` and `mypy` are clean.

## Decision Record (spec phase, confirmed by the user)
| # | Decision | Status |
|---|---|---|
| S-1 | Per-group list `GET /api/groups/{gid}/join-requests` is organizer-only, returns PENDING requests oldest first in the `PendingJoinRequestResponse` shape, and is backend-only (no frontend caller in this task). | Reinstated by user decision |
| S-2 | Cross-group organizer list at `GET /api/groups/mine/join-requests` (blanket row 26), used by the panel modal. | Accepted |
| S-3 | A duplicate create returns the existing PENDING request with 201 and sends no second notification. | Confirmed |
| S-4 | The stale-token loader applies to the gate only; `PublicTermView` keeps rendering on an in-page token change. | Accepted |
| S-5 | The `GROUP_JOIN_REJECTED` notification links to the term URL (or `/panel` when there is no term). | Accepted |
| S-6 | The "Wysłano {data}" line on the pending gate may be omitted, because `/access` does not carry the request date. | Accepted |

## Spec audit resolutions (`verification/spec-audit.md`)
| Finding | Resolution in this spec |
|---|---|
| M-1: stale gate stuck on the loader when the token-change fetch fails | R11: a token-change failure keeps `ready`, `isStale` and `refreshError`. R12: new render row for `isStale && refreshError` (`PrivateGroupGate` `stale` mode: error line plus „Spróbuj ponownie”). R13: new `stale` prop. Edge case updated. New tests in `useTermAccess.test.ts` and `TermPage.test.tsx`. |
| M-2: PanelPage mock resolves to `undefined` after `resetAllMocks` | R16: `load()` coerces non-array results to `[]`. Testing: a required `mockResolvedValue([])` default, plus a coercion test. |
| m-1: expired-token wording and lost `returnTo` | Edge case corrected (`canRequest`, then POST 401). Decision: **preserve `returnTo`**. `api/client.ts` redirects to `/login?returnTo=…` (R11), which `AuthGuard` already supports. |
| m-2: `linkPath` could not be built | `linkPath` dropped from `PendingJoinRequestAction` (the minimal option). No change to the response schema. |
| m-3: R6 helper unnamed, facade export unclear | `add_active_membership(db, group_id, party_id)` in `application/memberships.py`, re-exported via `app.groups.service`. Test helpers take `db_session`. |
| m-4: "Później" across reloads | The hidden set is provider state. It is not cleared by `load()` or silent reloads, only by a `PanelDataProvider` remount. Journey, R16 and a test updated. |
| m-5: single group load imprecise | R2: read `group_response.visibility` and drop the extra `get_group`. |
| m-6: notification before savepoint | R5 create step 8: stage the notification only after the savepoint insert and flush succeed. The fallback stages none. |
| m-7: 0038 `down_revision`, index declaration | R4: `down_revision="0037"`. The partial index is migration-only (pledges precedent). |
| m-8: TermPage.test mock wording | Testing: **add** `vi.fn()` overrides to the `...actual`-spread mock. Nothing is swapped. |
| m-9: no-organizer line uses stale data | R13: a `createConflict` flag, evaluated against the refetched `group`. Edge case and test updated. |
| m-10: test scope vs full-suite criterion | Testing approach: per-group verification runs the new and rewritten tests; final verification runs the full suites. |
| m-11: missing stale docstrings | R1: `router/memberships.py` module docstring and `AuthGateSheet.tsx` L13 added. |

## Known Limitations
- The requester learns about a decision only through a panel notification, a refetch on focus, or „Sprawdź ponownie”. There is no push, by design.
- `/access` does not carry the request's creation date, so the "Wysłano {data}" line on the pending gate may be omitted. It is marked optional in the mockup.
- A refresh error while in `view` is not surfaced beyond existing action toasts, because `PublicTermView` is unchanged.
