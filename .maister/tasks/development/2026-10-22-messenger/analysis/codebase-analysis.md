# Codebase Analysis Report

## TL;DR
- The codebase has no messaging, chat, conversation or realtime (WebSocket/SSE) code. The messenger is a new capability and should become a new layered bounded context, `app/messaging`, modelled on `app/groups`.
- Every building block it needs already exists: party-keyed identity, the notifications BC (`create_notification` plus the outbox), the cross-BC ACL pattern, `require_any` auth plus the authorization matrix, text moderation, the in-memory rate limiter, polling hooks and the mobile UI kit (PhoneFrame, ModalSheet, Avatar, the NotificationBell badge).
- The hard parts are an N+1-free inbox query with unread counts, broadcast fan-out without flooding notifications, choosing the broadcast audience (Membership, RSVPs, or both, and guest attendees), and the missing public groups-service functions.
- Overall: **Complex** (about 25 or more new or changed files across 3 BCs, a migration, the matrix and the SPA). Risk is **Medium**: it is mostly additive, with few changes to existing behaviour.

## Key Decisions
- **Build a new `app/messaging` BC in the layered form** (domain/application/infrastructure/router). Do not extend notifications. Notifications are one-way 500-character pre-rendered strings with a 50-row cap, so they cannot hold threads.
- **Key participants, senders and recipients by `party_id`.** Notifications, attendance, pledges, swaps and roles already do this, and `account_merge` keeps `party_id` stable. Circulation's `users.id` is converted to a party only inside `circulation_acl`.
- **Start an item conversation from `item_id` only and resolve the owner on the server.** `ItemDetailsResponse` deliberately exposes no owner ids, only `is_owner`. The chain is `resolve_owning_inventory` → `Inventory.owner_user_id` → `get_profile_by_account_user_id` → `party_id`. The endpoint is a get-or-create guarded by a partial unique index.
- **Use a new route prefix, `/api/conversations`.** Broadcast routes under `/api/groups` or `/api/terms` would be caught by the blanket matrix rows (129-130, 160-161). Add the new rows before the catch-all at line 248.
- **Poll instead of using realtime.** Add a cheap unread-count endpoint polled every 15–30 s with `refetchInterval` as a function (never in background), and poll the thread only while it is open. No WebSocket or SSE infrastructure exists.
- **Send direct-message notifications synchronously and broadcast notifications through the outbox.** Direct messages call `create_notification` in the same transaction (low latency). Broadcasts emit a single `messaging.message_posted` outbox event whose handler fans out per recipient (up to 60 s delay), collapsing to one unread NEW_MESSAGE per conversation.
- **Bump `last_read_at` and `last_message_at` with Core `update()`.** `updated_at` is the optimistic-lock `version_id_col`. ORM updates on these hot rows would cause 409s when several tabs or senders act at once.
- **Use keyset pagination for messages and offset pagination (the existing `Pagination`) for the inbox.** No cursor pagination exists today. `(created_at, id)` DESC is the right shape for threads.
- **Make the thread and inbox standalone pages at `/panel/wiadomosci` and `/panel/wiadomosci/:conversationId`.** They follow the `/panel/terminy/:termId` pattern, sit outside `PanelDataContext` (1288 lines), and the thread page has no PanelNavBar.
- **Have the backend return `is_mine` per message and `is_organizer` where organizer actions are gated.** The frontend has no shared "me"/party_id hook, and `useJoinCode` can only infer organizer status for PRIVATE groups.

## Open Questions / Risks
- **Audience definition.** A group has two notions of "member": standing `Membership` (GroupRole MEMBER) and "anyone with a non-withdrawn RSVP". The spec must pick one or the union.
- **Guest attendees.** Anonymous RSVP parties (`account_user_id=None`) cannot log in and no mailer exists, so they cannot receive term broadcasts.
- **Later joiners.** Broadcast participants can be snapshotted at send/creation time, which keeps unread state as simple SQL, or resolved at read time, which covers later joiners but makes unread state complex.
- **Moderation on a hot path.** Bielik-Guard runs in-process on one ONNX thread. When enabled, every send pays inference latency and can return 503 (`ModerationUnavailable`).
- **Per-process rate limiter.** The `join_code_limiter` pattern is in-memory, so its limits apply per uvicorn worker.
- **Inbox N+1 and query budget.** The list needs last message, unread count, counterpart names and the item/group/term label. This needs fixed-count queries and a `count_queries` 1-vs-3 test.
- **Notification noise.** Without collapsing, every message would create a bell row and push older rows past the 50-row cap. `PendingActionsHost` must ignore message kinds.
- **`dayjs` `relativeTime` plugin is not loaded.** `fromNow()` would fail. Add the plugin or use the existing formats.
- **Stale docstring.** `main.py` says the outbox interval is 30 s, but `DEFAULT_INTERVAL_SECONDS` is 60.

---

## Decisions the product owner must make

| # | Decision | Options | Analysis default |
|---|----------|---------|------------------|
| 1 | Who receives a **group** message | (a) standing Membership only; (b) anyone with an active RSVP on any term; (c) union | (c) union, excluding the organizer |
| 2 | Who receives a **term** message | active (non-withdrawn) attendees; include or exclude guest RSVPs | Account-holding attendees only; show the organizer how many guests cannot be reached |
| 3 | **Reply model** for broadcasts | (a) one-way announcement; (b) group chat where everyone sees replies; (c) replies go privately to the organizer | (a) or (c). (b) adds moderation and noise problems |
| 4 | **Later joiners** | see past broadcasts or not | Snapshot recipients at send time; later joiners see nothing earlier |
| 5 | **Item conversation uniqueness** | one thread per (item, asker) or a new one each time | One per (item, asker, owner); reopen the existing thread |
| 6 | **Contact-info rule** (`ensure_no_contact_info`) on message bodies | apply / don't apply | Product call. The rule exists so that exchanges happen in-app, but blocking phone numbers in private chat may frustrate users meeting for a hand-off |
| 7 | **Text moderation** (`check_text`) on messages | on / off / async flag | On, behind `moderation_text_enabled` like other fields |
| 8 | **Rate limits** | e.g. 30 messages/min per party; 10 broadcasts/h per organizer | As listed |
| 9 | **Item lifecycle** | what happens to the thread when the item is deleted or changes owner | Keep the thread readable and show the item as "(usunięte)". The thread keeps the original owner party |
| 10 | **Message limits and editing** | body max length; edit/delete own messages | 2000 characters; no edit in MVP; optional soft delete |
| 11 | **Freshness** | polling interval vs realtime | 20 s unread-count poll; 5–10 s while a thread is open |
| 12 | **Navigation entry** | 5th PanelNav tab, an icon beside NotificationBell, or an AccountMenu item | Icon with badge beside the bell (PanelNav stays 4 tabs) |
| 13 | **Leaving / muting / blocking / reporting** | in scope or not | Out of scope for MVP, but the model leaves room (`left_at`) |
| 14 | **Organization-owned items** | Organizations cannot own items today | No change; the organizer item route only re-themes |

---

## Summary

The aj platform has no conversation or message model, no inbox UI and no realtime transport. The only nearby concepts are one-way notifications and free-text notes. The moderation docstring ("exchanges are arranged inside the app") gives the product reason for an in-app messenger. Integration points are well defined:
- the item page (with server-side owner resolution);
- the group details page and the organizer's term attendees page (broadcast compose);
- the notifications BC (bell, plus outbox fan-out);
- the authorization matrix;
- the SPA router under `PublicLayout`.

Following existing conventions closely (party ids, ACL modules, Core updates, TanStack hooks, Tailwind tokens) keeps the risk moderate.

---

## Files Identified

Paths are relative to `src/backend/` (backend) and `src/frontend/src/` (frontend). Line counts come from the explorers' references where known.

### Primary Files (to be created)

**`app/messaging/` (new BC)**
- `models.py`: `Conversation`, `ConversationParticipant`, `Message`, and `ConversationKind {DIRECT_ITEM, GROUP_BROADCAST, TERM_BROADCAST}`.
- `schemas.py`.
- `service.py`: flat `__all__` facade.
- `domain/message_events.py`: the `messaging.message_posted` string constant.
- `application/conversations.py`, `messages.py`, `read_markers.py`, `send_limiter.py`.
- `infrastructure/repository.py`, `groups_acl.py`, `circulation_acl.py`, `users_acl.py`, `notifications_bridge.py`, `outbox_bridge.py`.
- `router.py`: `/api/conversations`.

**`alembic/versions/0061_messaging.py` (new)**
- Creates the three tables, with a round-trip test (`tests/test_messaging_migration.py`).
- A pointer column on notifications such as `conversation_id` (if wanted) goes in a separate revision, 0062.

**Frontend (new)**
- `api/messages.ts`.
- `hooks/useConversations.ts`, `useConversation.ts`, `useUnreadMessages.ts`.
- `pages/messages/InboxPage.tsx` and `ThreadPage.tsx`.
- A broadcast composer component (ModalSheet).
- A chat/send icon in `panelIcons.tsx`.

### Primary Files (to modify)

**`app/main.py`**
- Register the messaging router before `system_router`, which must stay last.
- Register the outbox handler in the lifespan (around lines 108-110).

**`app/core/authorization_matrix.py`**
- Add `/api/conversations` rows (GET→READ, mcp:read; POST/PATCH/DELETE→EDIT) before 247/248, using the template at 206-207.
- Extend `tests/test_authorization_matrix.py`.

**`app/notifications/models.py`** (`NotificationKind`, lines 37-59)
- Add `NEW_MESSAGE` and `GROUP_ANNOUNCEMENT` (30 characters or fewer). No DDL is needed because the column is VARCHAR(30) with no CHECK constraint.

**`app/notifications/outbox_listener.py`**
- Add the fan-out handler, or place it in messaging and register it there, matching the event type by string.

**`app/groups/service.py`** (plus `circles.py:356-366`, `exchange_summary.py:56,81`, `repository.py:240,458,477`)
- Add public functions: `is_active_organizer(group_id, party_id)`, `list_group_audience_party_ids(group_id)` and `list_term_attendee_party_ids(term_id)`.
- Mind the groups↔families import-cycle note in `memberships._resolve_party_families`.

**`app/moderation/text_guard.py`** (lines 18-27, 70) and `errors.py` (MESSAGES)
- Add `TextField.MESSAGE_BODY` and its Polish message.

**`router.tsx`** (PublicLayout children, :85-183)
- Add `/panel/wiadomosci` and `/panel/wiadomosci/:conversationId` inside `AuthGuard`.

**`pages/product/ItemDetailPage.tsx`** (ItemViewContent :103-169)
- Add a "Zapytaj o rzecz" button after `ItemStatusCard` (:153) when `!item.is_owner && !deleted`.

**`pages/groups/GroupDetailsPage.tsx`**
- Add a `messageGroupCard` ReactNode prop next to `joinCodeCard`.
- This needs a reliable organizer flag from the backend.

**`pages/.../TermAttendeesPage.tsx`** (TermHeadCard)
- Add "Napisz do uczestników terminu".

**`components/layout/PublicLayout.tsx`** (:35,42)
- Add an inbox icon with an unread badge beside `NotificationBell`.

**`api/notifications.ts`, `components/shared/pendingActions.ts`, `PendingActionsHost.tsx`**
- Mirror the new kinds.
- Make pending actions ignore message kinds.

### Related Files

**Backend: notifications and outbox**
- `app/notifications/service.py:31-57`: `create_notification` (stage only, caller commits).
- `repository.py`: `_MAX_NOTIFICATIONS=50`, `count_unread`.
- `app/outbox/`: `service.append`, `registry.register_handler`, dispatcher (FOR UPDATE SKIP LOCKED, MAX_ATTEMPTS 5), scheduler at 60 s.
- `app/groups/infrastructure/notifications_bridge.py` and `outbox_bridge.py`: bridge templates.
- `app/groups/infrastructure/locations_acl.py`: ACL template (404 before 403, batched `get_*_by_ids`).

**Backend: items and users**
- `app/circulation/models.py:153-171`: `Inventory.owner_user_id`, `InventoryItem`.
- `app/circulation/application/inventory_items.py:169`: `resolve_owning_inventory`.
- `item_details.py:45`: `ItemDetailsResponse` (`schemas.py:189`).
- `app/users/service.py:97,223,232`: `get_profile_by_principal`, `get_profile_by_party`, `get_profile_by_account_user_id`.
- `app/groups/infrastructure/repository.py:551`: `list_profile_names_by_party_ids`.
- `app/party/models.py:45`: Party.
- `app/groups/application/account_merge.py`: keeps `party_id` stable.

**Backend: core and rate limiting**
- `app/core/base_model.py:41-68`: BaseEntity and `version_id_col`.
- `app/core/errors.py`: mapping of 149-159, 162, 203, 227-245.
- `app/core/pagination.py`: `PageParams`/`Page[T]`.
- `app/core/_auth/dependencies.py:348-366`: `require_any`.
- `app/core/clock.py`: `fit_notification_message`.
- `app/groups/application/join_code_limiter.py`: rate-limiter template.
- `app/groups/router/join_code.py:21-23,129-136`: `ReadPrincipal`/`EditPrincipal` aliases; maps a missing profile to 401.

**Backend: other**
- `app/moderation/rules.py:1-37`: `ensure_no_contact_info`.
- `app/organizations/slugs.py`: `RESERVED_SLUGS` (only relevant if a new top-level segment is added; `/panel/...` is not one).
- `alembic/versions/0057_locations.py`: migration template.
- `tests/conftest.py:42,81`: moderation off; `count_queries`.
- `tests/test_group_location_defaults.py:188-202`: query-count test template.

**Frontend: notifications and polling**
- `hooks/useNotifications.ts`, `components/shared/NotificationBell.tsx`: badge, optimistic mark-read and "9+" templates.
- `hooks/useItemDetail.ts:47-56`, `useMyOrganization.ts:49`, `test/useItemDetail.test.tsx:140-170`: polling and the polling test.

**Frontend: data-fetching templates**
- `hooks/useJoinCode.ts`, `useGroupDetails.ts`, `useCategories.ts`: data-fetching templates.
- `api/client.ts`, `api/problem.ts`, `api/people.ts:38` (`getMyProfile`).

**Frontend: UI components**
- `components/krag/ModalSheet`, `PhoneFrame`, `Avatar`, `Skeleton`, `ToastPill`/`useToast`, `uiStyles`, `ConfirmDeleteDialog`.
- `components/panel/JoinCodeCard.tsx`: organizer card style.
- `pages/panel/PanelNav.tsx`, `panelHelpers.ts`.
- `pages/organizer/PageFrame.tsx`: `min-h-[calc(100dvh-57px)]`.
- `pages/product/ItemFieldEditors.tsx:171-211`: textarea template.
- `pages/product/ItemBackButton.tsx`.
- `pages/product/ItemReadOnlyParts.tsx`: DescriptionText wrapping.

**Frontend: term page and utilities**
- `pages/term/TermPage.tsx`: `termViewState` drops `GroupAccessDetails.is_organizer`.
- `utils/dayjs.ts`, `utils/plural.ts`.

---

## Current Functionality

The codebase has no messaging. The closest existing behaviour is listed below.
- **Notifications** are one-way, pre-rendered Polish text (500 characters or fewer) for a single party, with a `link_path` and optional loose `proposal_id`/`reservation_id`. The list is capped at 50 with no pagination, has mark-read and mark-all-read, and the frontend polls nothing. The bell counts unread client-side from the 50 rows, and `getUnreadCount()` is unused.
- **Outbox**: `append` writes a JSONB event; a dispatcher running every 60 s calls the registered handlers. The notifications listener renders the Polish text.
- **Item page**: any READ principal can view any item. The response hides owner identity.
- **Organizer surfaces**: GroupDetailsPage is shared by members and organizers and infers organizer status only via the join code (PRIVATE groups only). TermAttendeesPage is organizer-only (403 for others).

### Key Components/Functions
- **`create_notification(db, *, party_id, kind, message, link_path, proposal_id, reservation_id)`**: stages a notification row; the caller commits.
- **`resolve_owning_inventory(db, item)`**: returns the permanent owner's inventory, using `home_inventory_id` while the item is lent out.
- **`get_current_leadership` / `_require_active_organizer`** (circles.py:340,364): one active leadership per group.
- **`list_active_attendances_for_term`** (repository.py:477): returns attendances excluding withdrawn ones.
- **`list_active_memberships_for_group`** (repository.py:240) and **`aggregate_active_attendances_for_group`** (:458): the two member notions.
- **`check_text(field, new, current=None)`**: moderation. It is a no-op when disabled, blank or unchanged, returns 400 on rejection and 503 when the model is unavailable.
- **`require_any(...)`**: authentication and permission dependency.

### Target Data Flow

**Ask the owner about an item**
1. ItemDetailPage calls `POST /api/conversations {item_id}`.
2. `circulation_acl` resolves the owner party, then the conversation is fetched or created (with a unique partial index), then the client navigates to `/panel/wiadomosci/:id`.

**Send a message**
1. `POST /api/conversations/{id}/messages`.
2. The service checks participation (404 before 403), applies the limiter, runs `check_text`, inserts the message and runs a Core `update` on `last_message_at`.
3. For a direct conversation it calls `create_notification` (collapsed); for a broadcast it calls `outbox.append` and the handler fans out later.
4. Finally it commits.

**Read a thread**
1. `GET /api/conversations/{id}/messages?before=` returns a keyset page.
2. `POST /api/conversations/{id}/read` runs a Core `update` on `last_read_at`.

**Badge**
- `GET /api/conversations/unread-count` runs one aggregate query and is polled.

**Broadcast**
- The organizer composes in a ModalSheet; the request hits `POST /api/conversations` with kind GROUP or TERM, and `groups_acl` checks the organizer and resolves the audience party ids.

---

## Dependencies

### Imports (What messaging depends on)
- **groups**: organizer check, group audience and term attendees, group and term labels (needs new public service functions).
- **circulation**: item to owner account, item name and soft-delete state.
- **users**: `get_profile_by_principal`, profile by account or party, batched display names.
- **notifications**: `create_notification`, `NotificationKind`.
- **outbox**: `append`, `register_handler`.
- **moderation**: `check_text`, possibly `ensure_no_contact_info`.
- **core**: BaseEntity, pagination, `require_any`, errors, clock.

### Consumers (What will depend on messaging)
- **`app/main.py`**: router and outbox registration.
- **`authorization_matrix.py`** and its test.
- **Frontend**: router, PublicLayout (badge), ItemDetailPage, GroupDetailsPage, TermAttendeesPage, and optionally TermPage, NotificationBell and PendingActionsHost (by kind).

**Consumer count**: about 10 files.

**Impact scope**: Medium. Changes to existing files are small insertions. The biggest edit to existing code is adding public groups-service functions.

---

## Test Coverage

### Test Files (templates; no messaging tests exist)

**Backend**
- `tests/test_authorization_matrix.py`: matrix rows.
- `tests/test_locations_migration.py`, `test_group_soft_delete_migration.py`: migration round-trip template.
- `tests/test_group_location_defaults.py:188-202`: `count_queries` 1-vs-3 template.
- `dispatch_pending(db_session)`: drives outbox handlers in tests.
- The `join_code` limiter tests and their autouse reset fixture.

**Frontend**
- `test/NotificationBell.test.tsx`, `test/useJoinCode.test.tsx`, `test/GroupDetailsPage.test.tsx`.
- `test/useItemDetail.test.tsx:140-170`: asserts the polling interval and that `refetchIntervalInBackground` is falsy.

### Coverage Assessment
- **Test count**: 0 for messaging today.
- **Backend** needs about 6–8 test files of 2–8 tests each:
  - migration round trip;
  - item get-or-create (idempotent, owner cannot ask themself, 404 for a missing item);
  - send and read (unread math, `is_mine`, a non-participant gets 403/404);
  - broadcasts (non-organizer gets 403, audience correctness, guests excluded, outbox fan-out with collapse);
  - inbox query count 1 vs 3;
  - limiter 429;
  - matrix rows.
- **Frontend** needs tests for the API hooks (polling interval), the inbox, the thread composer (trim/empty/max length, `role=alert`), the item-page button gating, and the organizer card gating.
- **Gap**: the private groups helpers that will be made public have only indirect coverage.

---

## Coding Patterns

### Naming Conventions
- **Backend modules**: `application/<usecase>.py`, `infrastructure/<other>_acl.py` or `*_bridge.py`.
- **Enums**: StrEnum through a per-BC `_enum_column`, stored as `sa.String(n)`.
- **Constraints**: `pk_`, `fk_<table>_<col>_<ref>`, `ix_`, `uq_`.
- **Tests**: flat `tests/test_<feature>.py` with `test_<operation>_<scenario>_<expected>`.
- **Frontend**: `api/<resource>.ts` with snake_case interfaces; `hooks/use<Thing>.ts` with exported key constants; Polish route segments and copy.

### Architecture Patterns
- **Backend**:
  - async SQLAlchemy 2.0, no `relationship()`, batched IN lookups into dicts;
  - the application layer commits; repositories only read;
  - 404 before 403;
  - soft delete with `deleted_at` and partial unique indexes;
  - naive-UTC audit timestamps.
- **Frontend**:
  - TanStack Query v5 hooks returning `{data ?? STABLE_EMPTY, loading, error: string|null, refetch, ...}`;
  - mutations as `useCallback` + `serverMessageOr` + `await invalidateQueries`, never `useMutation`;
  - pages own the hooks and pass props down;
  - Tailwind tokens only (enforced by the `themeTokenUsage` test).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count | ~15 new backend + ~8 new frontend; ~12 modified | High |
| Dependencies | groups, circulation, users, notifications, outbox, moderation, core | Medium-High |
| Consumers | ~10 integration points | High |
| Test coverage | 0 existing; good templates available | Low (to be built) |

### Overall: Complex
The feature is new and spans three bounded contexts plus the SPA. It needs a non-trivial aggregate query (inbox with unread counts), asynchronous fan-out and product decisions about the audience. Each individual piece has a close existing template, which reduces the effort.

---

## Key Findings

### Strengths
- The party-keyed identity model and stable `party_id` across account merges suit message ownership well.
- Notifications and the outbox already provide delivery, retries and idempotent registration.
- The ACL/bridge discipline gives a clear way to read groups, circulation and users data without coupling.
- The frontend has ready badge, polling, sheet, avatar and card patterns, and a polling test template.

### Concerns
- The groups BC exposes no public functions for "organizer?", "audience" or "term attendees". These must be added carefully because of the families import cycle.
- There are two inconsistent notions of group member, and guest attendees cannot be reached.
- Optimistic locking through `updated_at` will cause 409s on hot rows unless updates go through Core.
- Moderation latency and 503s, plus a per-process limiter.
- Notifications capped at 50 rows, combined with high message volume, will push other notifications out unless messages are collapsed.
- The frontend has no organizer flag on GroupResponse and no shared party_id or "me" hook.

### Opportunities
- Wire up the unused `getUnreadCount()`. Polling the bell with the same cheap-count approach would also improve notification freshness.
- Thread `is_organizer` through `termViewState` to show organizer actions on the public term page.
- Add the `relativeTime` dayjs plugin for "5 min temu" timestamps.
- Fix the stale 30 s docstring in `main.py`.

---

## Impact Assessment

- **Primary changes**: the new `app/messaging/*`, migration 0061, the new frontend api, hooks and pages.
- **Related changes**:
  - backend: `main.py`, `authorization_matrix.py`, `NotificationKind`, the outbox listener, `groups/service.py` (new public functions), `text_guard.py`/`errors.py`;
  - frontend: `router.tsx`, `PublicLayout.tsx`, `ItemDetailPage.tsx`, `GroupDetailsPage.tsx`, the TermAttendees page, `api/notifications.ts`, `pendingActions.ts`, `panelIcons.tsx`, `utils/dayjs.ts`.
- **Test updates**:
  - new backend tests (migration, use cases, query count, limiter, fan-out);
  - the matrix test;
  - new frontend tests;
  - updates to the NotificationBell and pending-actions tests for the new kinds.

### Risk Level: Medium
The work is mostly additive with low regression risk. The risk comes from the cross-BC public functions, the outbox fan-out volume, query performance in the inbox, and the audience/privacy semantics (who can message whom). Authorization must stay strict: only participants can read, only active organizers can broadcast, and an owner cannot ask themself.

---

## Recommendations

This is a new capability. Recommended approach:

### 1. Data model (migration 0061)
- **`conversations`**:
  - `kind String(20)`;
  - loose `item_id`, `group_id`, `term_id`;
  - `created_by_party_id` FK parties;
  - `subject String(200)?`, `last_message_at`, `deleted_at`;
  - partial unique `(item_id, created_by_party_id)` WHERE `kind='DIRECT_ITEM' AND deleted_at IS NULL`;
  - index `(group_id)`, `(term_id)`.
- **`conversation_participants`**:
  - `conversation_id` FK, `party_id` FK parties;
  - `role String(20)` (OWNER/ASKER/ORGANIZER/RECIPIENT), `last_read_at`, `left_at`;
  - `uq(conversation_id, party_id)`, `ix(party_id)`.
- **`messages`**:
  - `conversation_id` FK, `sender_party_id` FK parties;
  - `body String(2000)`, `deleted_at`;
  - `ix(conversation_id, created_at, id)`.
- **Participants**: snapshot broadcast recipients into `conversation_participants`, so unread state is one SQL path for every kind. Re-resolve the audience only if the product owner chooses "later joiners see history".

### 2. Endpoints (`/api/conversations`)
- `GET /` (paged inbox) and `GET /unread-count`.
- `POST /` with one of:
  - `{kind: "DIRECT_ITEM", item_id}`: get-or-create;
  - `{kind: "GROUP_BROADCAST", group_id, body}`;
  - `{kind: "TERM_BROADCAST", term_id, body}`.
- `GET /{id}`.
- `GET /{id}/messages?before=&limit=` and `POST /{id}/messages`.
- `POST /{id}/read`.
- Each response carries `is_mine`, the counterpart or audience label, and the item, group or term context with `deleted` markers.

### 3. Inbox query
Use a fixed number of queries:
1. a page of my participations joined with conversations, ordered by `last_message_at DESC`;
2. last messages via `DISTINCT ON (conversation_id)`, or a denormalised `last_message_id`;
3. unread per conversation via one `GROUP BY` with `COUNT(*) FILTER (WHERE created_at > last_read_at AND sender_party_id <> me)`;
4. batched names and labels through the ACLs.

Assert equal `count_queries` for 1 and 3 conversations.

### 4. Notifications
- Add `NEW_MESSAGE` (direct) and `GROUP_ANNOUNCEMENT` (broadcast).
- Set `link_path=/panel/wiadomosci/<id>` and fit the text with `fit_notification_message`.
- Skip creating a row if an unread one with the same `link_path` exists. Add an index `(party_id, kind, read_at)` if needed.
- Direct messages notify synchronously; broadcasts go through the outbox.
- `PendingActionsHost` ignores both kinds.

### 5. Safety
- Run `check_text(TextField.MESSAGE_BODY, ...)` before `db.add`.
- Add a send limiter based on `join_code_limiter`, with its own autouse reset fixture.
- Return 404 before 403.
- Map a missing profile to 401, as `join_code.py` does.

### 6. Frontend
- **Inbox page**: Avatar rows, unread dot, inline dashed empty state, PanelNavBar with no active tab.
- **Thread page**:
  - full height `h-[calc(100dvh-57px)]`, header with ItemBackButton-style back, Avatar and title;
  - `flex-1 overflow-y-auto` messages that scroll to the bottom on new messages;
  - sticky composer with a textarea modelled on DescriptionEditor (counter, trim/empty rejection, `role=alert`);
  - no PanelNavBar;
  - keep toasts from covering the composer.
- **Bubbles**: own messages `bg-primary text-on-primary`, others `bg-paper border border-line`, `rounded-[18px] max-w-[80%] whitespace-pre-line break-words`.
- **Badge** beside NotificationBell:
  - same styling;
  - `aria-label "Wiadomości (N nieprzeczytane)"`;
  - polls `unread-count` with `refetchInterval: () => token ? 20_000 : false`;
  - key `["conversations","unread", username]`.
- **Organizer compose**: a ModalSheet opened from a card in the JoinCodeCard style on GroupDetailsPage and in TermHeadCard. Gate it on a backend `is_organizer` flag added to the group response, or use `LeadershipResponse.organizer_party_id` compared with the profile's party_id.

### 7. Sequencing
1. Backend model and migration.
2. Groups, circulation and users public functions and ACLs.
3. Direct-item flow end to end (smallest vertical slice).
4. Inbox and badge.
5. Broadcasts with outbox fan-out.
6. Organizer UI.
7. Moderation and limiter hardening.

---

## Next Steps

1. Ask the product owner to resolve the "Decisions the product owner must make" table, especially items 1–6.
2. Invoke the **gap-analyzer** with this report to map current state against desired state: user journeys for asker, owner, organizer and recipient, and the message data lifecycle including item deletion and account merge.
3. Then run specification (endpoint contracts, schemas, migration DDL) and an implementation plan grouped as DB → backend use cases → notifications/outbox → frontend → tests.
