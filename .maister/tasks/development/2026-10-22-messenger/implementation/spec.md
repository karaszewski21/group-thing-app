# Specification: Messenger (item questions, group chat, term chat)

## TL;DR
- Add an `app/messaging` bounded context with three tables (migration 0061): `conversations` (ITEM / GROUP / TERM), `messages` and `conversation_reads`. There is no participant table; access is computed per request, and soft-deleted groups count for both access checks and the inbox.
- Add 9 endpoints under `/api/conversations`, with the literal routes declared before `/{id}`. ITEM threads are unique per (item, asker, current owner). A GROUP chat goes read-only when its group is soft-deleted or switched to PUBLIC. Sends are moderated, rate-limited, serialized per conversation and never notify the bell.
- On the frontend, add a 💬 badge button (20 s poll), `InboxPage`, and `ThreadPage` (one `["thread", …]` query polling `after=` every 5 s and merging into the cache). Audit timestamps are parsed with `dayjs.utc(x).local()`, Polish error copy comes through `serverMessageOr`, and the 7 binding mockups use theme tokens only.

## Key Decisions
- **No participant table.** Access is computed from current data, so later joiners see the full history and anyone who leaves loses access. Only `conversation_reads` stores state per party.
- **An ITEM conversation is unique per `(item_id, asker_party_id, owner_party_id)`** (user decision). After a GIVE or SWAP, "Zapytaj o rzecz" opens a new thread with the new permanent owner. The old thread stays readable and writable for its two parties.
- **A GROUP chat is read-only while its group is PUBLIC** (user decision). Participants are computed as usual. Writing reopens if the group switches back to PRIVATE. Get-or-create on a PUBLIC group returns an existing chat (read-only); when no chat exists yet it returns **409** "Czat grupy jest dostępny tylko w grupach prywatnych". We chose 409 over 404 because the group exists; only its state forbids a new chat.
- **One `read_only_reason` field** (`null | "GROUP_DELETED" | "GROUP_PUBLIC"`) replaces the boolean `read_only`. A deleted group takes precedence. The field drives the header copy, the banner copy and the 409 text.
- **Chat membership checks and the audience query include soft-deleted groups** through new repository queries with no `Group.deleted_at` filter. The existing private helpers, and the callers that use them, stay unchanged.
- **Messages in a conversation are committed in `created_at` order.** Send takes `SELECT … FOR UPDATE` on the conversation row and only then stamps `created_at`, as `max(utcnow, last_message_at + 1 µs)`. Commit order and the cursor order then match. An `after=` poll cannot skip a row, and GREATEST mark-read can only cover messages the client already holds. We rejected an overlap window because it fixes the poll but not the read-marker gap. A sequence column alone would not help, because sequences are assigned at insert time, not at commit time.
- **Cross-context ids are real FKs** (`item_id`, `group_id`, `term_id`), following `models.md` ("plain FK id column"). Items, groups and terms are only ever soft-deleted, and `circulation.reservations.term_id` already sets the precedent.
- **The server builds `title`; the client formats every time.** The TERM title is `"Termin: " + clock.format_term_day(occurs_on) + " HH:MM"`. `subtitle` is dropped because no screen renders it.
- **Item imagery is a fixed placeholder**: a neutral 📦 tile in both the thread header and the inbox. The real thumbnail needs the product BC's photo lookup plus storage, which is not available through the `list_item_refs` join.
- **The "Czat terminu" button uses a new server flag, `access.is_active_attendee`**, which ignores withdrawn attendances. `is_attending` keeps its meaning, so `TermFooter` is unchanged.
- **Avatars are initials only.** The inbox lists only conversations that have messages, newest 100. The badge counts unread messages, not conversations. Mark-read takes a `message_id`, and the cursors are message ids. `sender_is_organizer` reflects the current organizer. Asking about your own item is 409. Get-or-create on a soft-deleted group, on its term, or on a deleted item returns 404 when no conversation exists yet.

## Open Questions / Risks
- **Late joiners.** A new member of a busy PRIVATE group starts with the whole history unread, so the badge shows "9+". This is accepted.
- **Organizer change.** A new organizer gains the full history and the previous one loses it. This is accepted.
- **Names in public term chats.** Attendees' display names are already public: `PublicCircleResponse.guardians`, rendered by `AttendeeList` and `GroupVisualization`. The new exposure is message content, which is visible to every active attendee and the organizer.
- **ITEM threads after an ownership change.** An asker can hold two threads about the same item, one per owner. Both appear in the inbox under the same item name. This is accepted (user decision).
- **A PUBLIC group with an old chat.** Its chat stays listed and read-only. The term page and GroupDetailsPage hide "Czat grupy" (PRIVATE only), so the chat is reachable only from the inbox or a deep link.
- **Rate limits are kept in memory per uvicorn worker**, like `join_code_limiter`, and a restart resets them.
- **Send serialization.** Concurrent sends to one conversation queue on the row lock. Moderation runs before the lock is taken, so the wait lasts only for the insert and commit.
- **Moderation latency.** With `moderation_text_enabled`, every send waits for Bielik and can fail with 503. The composer keeps the text.
- **Guest attendees** (no account) cannot use the chat and are not counted in `participant_count`. If they later merge into an account, they see the term history.

## Goal
Let a logged-in user ask an item's owner about the item, and let PRIVATE-group members and term attendees talk with their organizer in Messenger-style threads. Unread state shows as a polled badge on the inbox button.

## User Stories
- As a visitor on someone else's item page, I want to tap "Zapytaj o rzecz" so that I can ask the owner about the item without exchanging contact details first.
- As an item owner, I want to see questions about my items in an inbox with an unread badge so that I can reply.
- As a member of a PRIVATE group, I want to open "Czat grupy" from a term page so that I can talk with the organizer and the other members.
- As a term attendee, I want to open "Czat terminu" so that I can coordinate with the organizer and the other attendees.
- As an organizer, I want "Czat grupy" on my group's details page and "Napisz do uczestników" on the term attendee list so that I can reach my people.
- As any participant, I want new messages to appear without reloading, and to know when a chat has become read-only, so that I don't miss or lose anything.

## Core Requirements

### Data model (migration `0061_messaging.py`)
1. **`conversations`** (`BaseEntity`):
   - `kind` is `String(10)`, holding a `ConversationKind` StrEnum: ITEM, GROUP or TERM.
   - Nullable FK id columns (L2):
     - `item_id` → `inventory_items` (`fk_conversations_item_id_inventory_items`);
     - `group_id` → `groups` (`fk_conversations_group_id_groups`);
     - `term_id` → `terms` (`fk_conversations_term_id_terms`).
   - `asker_party_id` and `owner_party_id` are FKs to `parties`. Both are set only for ITEM, at creation.
   - `last_message_at` is a nullable naive-UTC `DateTime`.
   - Rules by kind:
     - ITEM rows carry `item_id`, `asker_party_id` and `owner_party_id`;
     - GROUP rows carry `group_id`;
     - TERM rows carry `term_id` and the term's `group_id`.
   - Partial unique indexes:
     - `uq_conversations_group_id` on `(group_id)` WHERE `kind = 'GROUP'`;
     - `uq_conversations_term_id` on `(term_id)` WHERE `kind = 'TERM'`;
     - `uq_conversations_item_id_asker_party_id_owner_party_id` on `(item_id, asker_party_id, owner_party_id)` WHERE `kind = 'ITEM'` (user decision 1).
   - Plain indexes: `ix_conversations_asker_party_id`, `ix_conversations_owner_party_id` and `ix_conversations_group_id`.
2. **`messages`** (`BaseEntity`):
   - `conversation_id` is an FK to `conversations` (`fk_messages_conversation_id_conversations`);
   - `sender_party_id` is an FK to `parties`;
   - `body` is `String(1000)`, not null;
   - `ix_messages_conversation_id_created_at_id` covers `(conversation_id, created_at, id)`.
3. **`conversation_reads`** (`BaseEntity`):
   - `conversation_id` is an FK; `party_id` is an FK to `parties`; `last_read_at` is a non-null naive-UTC timestamp;
   - `uq_conversation_reads_conversation_id_party_id` makes each (conversation, party) pair unique.
4. **Downgrade** drops `conversation_reads`, then `messages`, then `conversations`, each with its indexes and FKs. A round-trip test covers it.
5. **Models and hot-row statements.** There is no `relationship()`. Hot rows are written with Core statements, and the ORM `Conversation` instance is never modified in the send or read path (L7):
   - 5a. **Conversation update:** `last_message_at = GREATEST(coalesce(last_message_at, :t), :t)` and `updated_at = :t`.
   - 5b. **Read upsert:** `insert(conversation_reads)` with explicit `created_at` and `updated_at` (`updated_at` has no column default, see `base_model.py:59`), plus `on_conflict_do_update` that sets `last_read_at = GREATEST(conversation_reads.last_read_at, excluded.last_read_at)` and `updated_at = :now`.

### Access rules (computed per request, 404 before 403)
6. **ITEM.** The caller's party must be `asker_party_id` or `owner_party_id` of that row. An earlier owner keeps access to threads that were opened with them.
7. **GROUP.**
   - The group is loaded with `get_group_including_deleted`; a missing group returns 404.
   - The caller must be the group's active organizer (`is_active_group_organizer`) or hold an active Membership (`is_active_group_member`). Both checks include soft-deleted groups (requirement 24). Otherwise the call returns 403.
   - Visibility does not gate reading. A currently PUBLIC group makes the chat read-only (requirement 9) and does not cause a 403.
8. **TERM.**
   - The term is loaded with `get_term_any`; a missing term returns 404.
   - The caller must be the active organizer of the term's group, or have a non-withdrawn attendance on the term. Otherwise the call returns 403.
   - The chat stays open after the term ends, whatever the group's visibility.
9. **Read-only.** `read_only_reason` is resolved in this order:
   - `"GROUP_DELETED"`: GROUP or TERM, when the group is soft-deleted. Send returns 409 "Grupa usunięta — czat jest tylko do odczytu".
   - `"GROUP_PUBLIC"`: GROUP only, when the group is PUBLIC. Send returns 409 "Grupa jest publiczna — czat jest tylko do odczytu".
   - otherwise `null`.
   - In a read-only chat, reading, paging and mark-read still work.
10. **Deleted item.** An ITEM conversation stays readable and writable after its item is soft-deleted, and `item.deleted` is `true`.
11. **Missing profile.** A caller without a profile gets 401: `AuthenticationRequiredException`, mapped the same way as `_get_caller_party_id` in `app/groups/application/join_code.py:36-44` (L1).

### Endpoints (`/api/conversations`; GET needs READ or mcp:read, POST needs EDIT or mcp:edit)
12. **`POST /item {item_id}`** returns 201 with a `ConversationResponse` when it creates the conversation, or 200 when one already exists. Checks run in this exact order (M6):
    1. `find_item_including_deleted`: an unknown item returns 404.
    2. Resolve the current permanent owner: `resolve_owning_inventory` → `Inventory.owner_user_id` → profile → `party_id`. This works for soft-deleted items too. If the caller is the owner, return 409 "Nie możesz zapytać o własną rzecz".
    3. If a conversation exists for `(item, me, current owner)`, return 200, even when the item is deleted.
    4. If the item is soft-deleted, return 404.
    5. Call `send_limiter.check_new_conversation(me)`, which raises 429. Insert in a savepoint, call `record_new_conversation(me)`, and return 201.
    6. A unique-index race loser re-selects the winning row and returns 200 without recording.
13. **`POST /group {group_id}`** and **`POST /term {term_id}`** check in this order:
    1. Missing group or term returns 404.
    2. Access per requirement 7 or 8 returns 403 on failure.
    3. An existing conversation returns 200 with its current `read_only_reason`.
    4. A soft-deleted group, or a term of one, returns 404.
    5. GROUP only: a PUBLIC group returns 409 "Czat grupy jest dostępny tylko w grupach prywatnych".
    6. Insert in a savepoint and return 201; a race loser returns 200.
    - Any eligible participant may create the chat. These calls are not rate-limited.
14. **`GET /`** is the inbox. It returns my accessible conversations that have `last_message_at IS NOT NULL`, ordered by `last_message_at DESC, id DESC`, newest 100. Each row carries:
    - `id`, `kind` and `title`, which the server builds (L6):
      - ITEM: the item's product name;
      - GROUP: the group name;
      - TERM: `"Termin: {clock.format_term_day(occurs_on)} {occurs_on:%H:%M}"`, for example "Termin: śr 29.10 17:00";
    - `item` (`id`, `name`, `deleted`) for ITEM, with no thumbnail (M10);
    - `counterpart_name` for ITEM;
    - `group_name` for GROUP and TERM;
    - `term_occurs_on` for TERM, as naive Warsaw wall-clock time;
    - `last_message`: `body`, `sender_name`, `is_mine`, `sender_is_organizer` and `created_at`;
    - `unread_count` and `read_only_reason`.
    - The query count is fixed (requirement 21 and Success Criterion 8).
15. **`GET /unread-count`** returns `{count}`, the exact, uncapped sum of unread messages across every accessible conversation (L8):
    - it applies no LIMIT 100;
    - it includes read-only chats;
    - a message is unread when `created_at > coalesce(last_read_at, '-infinity')` and `sender_party_id <> me`;
    - capping at "9+" is display-only (requirement 30);
    - the query count is fixed.
16. **`GET /{id}`** returns `ConversationResponse`: the inbox row fields without `last_message`, plus `participant_count` for GROUP and TERM.
    - `participant_count` is the number of distinct account-backed parties (`UserProfile.account_user_id IS NOT NULL`) among the current organizer plus the active members (GROUP) or the non-withdrawn attendees (TERM). Guest profiles are not counted (L4).
17. **`GET /{id}/messages?before=<message_id>|after=<message_id>`** returns `{items, has_more}`.
    - Items are ascending by `(created_at, id)`, 50 per page.
    - With no cursor it returns the newest 50; `has_more` means older messages exist.
    - `before` returns the 50 immediately older.
    - `after` returns up to 50 strictly newer, oldest first; `has_more` means more newer messages exist.
    - Both cursors at once, or a cursor id from another conversation, returns 400.
    - Each message carries `id`, `body`, `created_at`, `is_mine`, `sender_name` and `sender_is_organizer`.
    - Requirement 18's serialization guarantees that `after=` never skips a committed row (M8).
18. **`POST /{id}/messages {body}`** returns 201 with a `MessageResponse`. The order is:
    1. access (404 / 403);
    2. read-only (409, requirement 9);
    3. body validation: the application layer trims the body and requires 1–1000 characters, otherwise it raises `ValueError("Wiadomość musi mieć od 1 do 1000 znaków")`, which maps to 400 with no `fieldErrors` (M5). The request schema declares `body: str` with no Pydantic length constraints;
    4. `send_limiter.check_message(me)` (429);
    5. `check_text(TextField.MESSAGE_BODY, body)` (400 rejected, 503 unavailable);
    6. Core `SELECT last_message_at … FOR UPDATE` on the conversation row;
    7. `now = max(datetime.utcnow(), last_message_at + 1 µs)`;
    8. insert the message with `created_at = now`;
    9. update the conversation (5a);
    10. upsert the sender's read marker to `now` (5b);
    11. `record_message(me)`, then commit.
    - It writes no notification and no outbox event.
19. **`POST /{id}/read {message_id}`** returns 204.
    - It upserts `last_read_at = GREATEST(existing, message.created_at)` (5b).
    - A `message_id` from another conversation returns 400.
    - It is allowed on read-only conversations.
    - Under requirement 18, every message with an earlier `created_at` was committed before the marked one, so it was already visible to the poll that delivered the marked message (M8).
20. **Authorization matrix.** Add these rows to `app/core/authorization_matrix.py` next to the notifications rows (`:206-207`), before the catch-all "# 25":
    - `GET ^/api/conversations(/.*)?$ → ("READ","mcp:read")`;
    - `POST ^/api/conversations(/.*)?$ → ("EDIT","mcp:edit")`.
    - Every route enforces its row with `Depends(require_any(...))`, using `ReadPrincipal` / `EditPrincipal` built from `app.core.auth_deps` (L1).
    - `tests/test_authorization_matrix.py` gets cases for `GET /api/conversations`, `GET …/unread-count`, `POST …/item` and `POST …/{id}/read`.
21. **Router.**
    - Register the router in `app/main.py` before `system_router`, which stays last.
    - **Declare the literal paths `GET /unread-count`, `POST /item`, `POST /group` and `POST /term` before every `/{id}` route** (M3), with a comment like the one at `app/groups/router/join_code.py:24`.

### Safety
22. **Moderation field.** Add `TextField.MESSAGE_BODY` to `app/moderation/text_guard.py`, with the `MESSAGES` entry "Wiadomość narusza zasady społeczności. Zmień ją i spróbuj ponownie." The contact-info rule does not apply.
23. **Rate limiter.** `app/messaging/application/send_limiter.py` is an in-memory sliding window modelled on `join_code_limiter.py`:
    - 30 messages per 60 s per party. On breach it raises `TooManyAttemptsException` "Za dużo wiadomości — spróbuj ponownie za chwilę." with `Retry-After`.
    - 20 new ITEM conversations per hour per party. On breach it raises "Za dużo nowych rozmów — spróbuj ponownie za {n} min".
    - `check_*` and `record_*` are separate calls, and `record_*` runs only after a successful insert. It exposes `reset()`.
    - An autouse `reset_message_limiter` fixture in `tests/conftest.py` resets it.

### Cross-context public functions (no private-name imports)
24. **`app/groups/service.py`** exports the following. Existing private helpers and their callers, such as `memberships._is_active_member` used at `join_code.py:137` and `public_view.py:375,439`, are **not** changed (H1).
    - 24a. `is_active_group_organizer(db, group_id, party_id)`: a public wrapper over `circles._is_active_organizer`, which already ignores `deleted_at` through `find_current_leadership`. The name avoids a clash with `app/users/service.py:270 is_active_organizer` (L11).
    - 24b. `is_active_group_member(db, group_id, party_id)`: built on a **new** `repository.has_active_membership(db, group_id, party_id)`. That is one statement over `Membership` ⨝ `GroupRole` (`party_id`, `MEMBER`, `valid_to IS NULL`), with **no `Group` join and no `deleted_at` filter**.
    - 24c. `list_group_member_party_ids(db, group_id)`: from `exchange_summary._ordered_group_member_party_ids`, which has no deleted filter.
    - 24d. `list_active_attendee_party_ids(db, term_id)`: over `repository.list_active_attendances_for_term`, which has no group filter.
    - 24e. `get_chat_audience_for_party(db, party_id)`: three **new** repository statements with no `Group` join and no `deleted_at` filter. They must not reuse `list_active_memberships_for_role_ids` or `list_active_leaderships_for_role_ids` (H1):
      - `list_led_group_ids_for_party`: `Leadership` ⨝ `GroupRole` (`ORGANIZATOR`, `valid_to IS NULL`);
      - `list_member_group_ids_for_party`: `Membership` ⨝ `GroupRole` (`MEMBER`, `valid_to IS NULL`);
      - `list_attended_term_ids_for_party`: `TermAttendance`, `withdrawn_at IS NULL`.
      - All visibilities are included; read-only state is applied per row (requirement 9).
    - 24f. Batched lookups, each one statement or none for empty input:
      - `list_chat_group_refs(ids) → {id: (name, visibility, deleted_at)}`;
      - `list_chat_term_refs(ids) → {id: (group_id, occurs_on)}`;
      - `list_current_organizer_party_ids(group_ids) → {group_id: party_id}`.
25. **`app/circulation/service.py`** exports `list_item_refs(db, item_ids) -> {id: (name, deleted_at)}`. It is one join, `InventoryItem` ⨝ `Product` with `InventoryItem.deleted_at`, modelled on `repository.list_product_names_for_items` (`circulation/infrastructure/repository.py:224-236`). It includes soft-deleted items, returns `{}` with no query for empty input, and loads no row per item (M2). The single-item owner lookup in requirement 12 uses the existing `find_item_including_deleted` and `resolve_owning_inventory`. That path handles one item per call and never runs in the inbox.
26. **`app/users/service.py`** exports `list_chat_profiles_by_party_ids(db, party_ids) -> {party_id: (display_name, has_account)}`. It is one batched statement and feeds names and `participant_count`.
27. **ACL modules.** Messaging reaches other contexts only through `infrastructure/groups_acl.py`, `circulation_acl.py` and `users_acl.py`.

### Frontend
28. **`src/api/conversations.ts`** holds the snake_case types and the functions for all 9 endpoints. `read_only_reason` is typed `"GROUP_DELETED" | "GROUP_PUBLIC" | null`.
29. **Hooks** live in `src/hooks/` and use the app shape: a stable empty fallback, `loading`, `error: string | null` and `refetch`.
    - `useUnreadMessages`: key `["unreadMessages", username]`, `enabled: token !== null`, `refetchInterval: 20_000`, `refetchIntervalInBackground: false`.
    - `useConversations`: the inbox, key `["conversations", username]`.
    - `useConversation(id)`: the thread header, with `notFound` (404 or 400) and `denied` (403).
    - **`useThread(id)`** (M7):
      - It uses exactly **one** `useQuery`, key `["thread", username, id]`, with `refetchInterval: 5_000` and `refetchIntervalInBackground: false`. The data is `{ items, hasOlder }`.
      - The `queryFn` reads the cache with `queryClient.getQueryData(key)`:
        - When there is no cached data, or `items` is empty (an empty thread), it fetches the newest page with no cursor and returns `{ items, hasOlder: has_more }`.
        - Otherwise it fetches `after=<last item id>` and then merges into the **current** cache, read again after the await so that a concurrent `loadOlder` or `send` is kept. The merge dedupes by id, sorts by `(created_at, id)` and keeps `hasOlder`.
        - When the `after=` page returns `has_more`, the next interval tick continues from there.
      - `loadOlder()` is a `useCallback`. It calls `getMessages(id, { before: first.id })`, prepends the page with `setQueryData` (deduped), and sets `hasOlder` from `has_more`. Its only `useState` is a `loadingOlder` flag.
      - `send(body)` calls `postMessage`, appends the returned message with `setQueryData` (deduped), and `await`s `invalidateQueries({ queryKey: ["conversations"] })`.
      - `markRead(messageId)` calls `markConversationRead` and then awaits invalidation of `["unreadMessages"]` and `["conversations"]`.
      - There is no `useState` + `useEffect` fetching and no `useInfiniteQuery`.
    - Get-or-create callbacks (`openItemConversation`, `openGroupConversation`, `openTermConversation`) are `useCallback`s that `await invalidateQueries`. They map errors with `chatErrorMessage` (requirement 41) and do not use `useMutation`.
30. **`MessagesButton`** (`components/shared/MessagesButton.tsx`):
    - It is a 💬 link to `/panel/wiadomosci`, placed before `NotificationBell` in `PublicLayout`.
    - The badge reuses the NotificationBell classes, shows "9+" above 9 and is hidden at 0.
    - The `aria-label` is "Wiadomości (N nieprzeczytane)", or "Wiadomości" when there are none.
31. **Routes.** `/panel/wiadomosci` (`InboxPage`) and `/panel/wiadomosci/:conversationId` (`ThreadPage`) go under `PublicLayout` inside `AuthGuard`, next to `/panel/terminy/:termId`.
32. **`InboxPage`** (`pages/messages/InboxPage.tsx`) uses `PhoneFrame` and `PanelNavBar` with no active tab, and has the heading "Wiadomości". Each row shows:
    - the kind chip: "Rzecz", "Grupa" or "Termin";
    - the leading visual:
      - ITEM: the fixed 📦 placeholder tile (M10);
      - GROUP: the group's initials `Avatar`;
      - TERM: 📅;
    - the server `title`;
    - the preview, prefixed "Ty:" when `is_mine`, "Organizator:" when `sender_is_organizer`, or otherwise "{sender_name}:";
    - the time from `formatInboxTime(last_message.created_at)` (requirement 40);
    - bold text and a count when `unread_count > 0`.
    - Read-only chats stay listed.
    - While loading the page shows a skeleton. With no rows it shows a dashed empty card reading "Nie masz jeszcze rozmów. Zapytaj o rzecz na jej stronie albo napisz na czacie swojej grupy lub terminu." On error it shows an inline error with a retry.
33. **`ThreadPage`** (`pages/messages/ThreadPage.tsx`) derives one view state with `resolveThreadView(...)` in `pages/messages/threadViewState.ts`. The kinds are `loading | notFound | denied | error | readOnly | ready`; `readOnly` carries the `reason`. The page only `switch`es over `view.kind`.
    - It is full height (`h-[calc(100dvh-57px)]`) with no PanelNavBar.
    - Header: a back control, then the leading visual (the 📦 tile for ITEM, the group initials for GROUP or TERM), then the title.
      - ITEM: the item name, then "Rozmowa z: {counterpart_name} · zobacz rzecz", linking to `/product/:id`. A deleted item shows "(usunięte)" and no link.
      - GROUP: "{group_name} · czat grupy". TERM: "{group_name} · czat terminu".
      - The second line, by priority (L5): `GROUP_DELETED` gives "Grupa usunięta", `GROUP_PUBLIC` gives "Grupa publiczna", and otherwise it shows `plural(participant_count)` "N uczestników".
    - Messages: a scrollable list with day separators from `formatDaySeparator` (requirement 40). It sticks to the bottom when new messages arrive, and offers "Wcześniejsze wiadomości" when `hasOlder`.
    - Bubbles follow `component:message-bubble`, and the time under each bubble comes from `formatBubbleTime`. In GROUP and TERM chats, others' messages show the sender's name and initials `Avatar`, plus an "Organizator" chip when `sender_is_organizer`.
    - The sticky composer follows `component:message-composer`:
      - a labelled textarea where Enter inserts a new line;
      - "Wyślij", disabled when the trimmed text is empty or over 1000 characters;
      - the counter "n / 1000";
      - a `role="alert"` error underneath, using `chatErrorMessage(err, "Nie udało się wysłać — spróbuj ponownie")`. The text stays in the field.
    - `readOnly` replaces the composer with a banner: "Grupa usunięta — czat jest tylko do odczytu" (`GROUP_DELETED`) or "Grupa jest publiczna — czat jest tylko do odczytu" (`GROUP_PUBLIC`).
    - `notFound` shows "Nie znaleziono rozmowy." and `denied` shows "Nie masz dostępu do tej rozmowy.", each with a link back to the inbox.
    - `useThreadReadMarker(view.kind, lastId)` marks the newest **held** message read whenever its id changes, in the `ready` and `readOnly` views.
34. **"Zapytaj o rzecz"** goes in `ItemViewContent` (`pages/product/ItemDetailPage.tsx`) under `ItemStatusCard`.
    - It shows when `!item.is_owner && !deleted`.
    - It calls `openItemConversation` and navigates to the returned id, which may be a new thread after an ownership change. An error appears inline.
35. **Term page** (M4):
    - `TermViewState.content` gains `isOrganizer`, `isMember` and `isActiveAttendee`, read from `access.is_organizer`, `access.is_member` and `access.is_active_attendee`. They come from the server only, and never from `guest.isAttending`, which is true for anonymous guests.
    - `PublicTermView` renders "💬 Czat terminu" when `isLoggedIn && (isActiveAttendee || isOrganizer)`.
    - It renders "👥 Czat grupy" when `isLoggedIn && group.visibility === "PRIVATE" && (isMember || isOrganizer)`.
    - The buttons use the `paper`/`line` pill style (requirement 42).
36. **GroupDetailsPage.** A new `messageGroupCard` slot, in the JoinCodeCard style, sits above the join-code card. It reads "Czat grupy / Napisz do wszystkich członków grupy. / 💬 Otwórz czat grupy", and shows when `isPrivate && joinCode.status === "ready"`.
37. **TermAttendeesPage.** `TermHeadCard` gets a "💬 Napisz do uczestników" button that calls `openTermConversation`.
38. **No bell rows.** Nothing is added to `NotificationKind`, `NotificationBell` or `PendingActionsHost`.
39. **`GroupAccessDetails.is_active_attendee`** (backend, M4):
    - `public_view.get_group_access` computes it as `profile is not None` and the shown term has a non-withdrawn attendance by the caller. That is one query over `list_active_attendances_for_term`, or `False` when there is no term.
    - `is_attending` is unchanged, so `TermFooter` behaves as before.
    - `api/groups.ts` `GroupAccessDetails` gains the field, and any exact key-set assertion on `access` is updated (not loosened).
40. **`pages/messages/messageTime.ts`** (H2, L6) is the only place messaging formats time. It imports `dayjs` from `utils/dayjs.ts`.
    - `parseAuditTime(x)` returns `dayjs.utc(x).local()`. It is used for every `created_at` and `last_message_at`, following `components/moderation/DeletedGroupRow.tsx:36`.
    - `term_occurs_on` is never converted. It is not formatted on the client, because the TERM title comes from the server.
    - `formatBubbleTime(x)` gives `HH:mm`.
    - `formatInboxTime(x)`:
      - today: `HH:mm`;
      - yesterday: "wczoraj";
      - 2–6 days ago: `ddd` (pl: "pon", "wt", "śr" …);
      - earlier in the same year: `DD.MM`;
      - otherwise `DD.MM.YYYY`.
    - `formatDaySeparator(x)`:
      - today: "dzisiaj";
      - yesterday: "wczoraj";
      - same year: `dddd, D MMMM` ("poniedziałek, 20 października");
      - otherwise `dddd, D MMMM YYYY`.
    - The day grouping uses the local day of `parseAuditTime`.
41. **`chatErrorMessage(err, fallback)`** in `api/conversations.ts` (M5) is used by every messaging callback and inline error:
    - 403 gives "Nie masz dostępu do tego czatu.";
    - 404 gives "Nie znaleziono — mogło zostać usunięte.";
    - anything else goes through `serverMessageOr(err, fallback)`. That passes the Polish 400, 409, 429 and 503 messages through and replaces generic envelopes such as "Validation failed" with the fallback.
    - The fallbacks are:
      - "Nie udało się otworzyć rozmowy — spróbuj ponownie" (get-or-create);
      - "Nie udało się wysłać — spróbuj ponownie" (send);
      - "Nie udało się wczytać wiadomości" (list errors).
    - `extractProblemMessage` is not used for messaging copy.
42. **Theme tokens** (M9):
    - Add `components/shared/MessagesButton.tsx`, `pages/messages/InboxPage.tsx`, `ThreadPage.tsx`, `MessageBubble.tsx` and `MessageComposer.tsx` to `NO_HEX_FILES` in `test/themeTokenUsage.test.tsx`. They may use the `mint` utilities the mockups need: the badge, the group chip and the "Organizator" chip.
    - The additions to `pages/term/views/PublicTermView.tsx` and `pages/product/ItemDetailPage.tsx` must not use `mint` or `lime` utilities, because both files are in `NO_LEGACY_UTILITY_FILES`.
    - The mockups' `#12604D` chip text maps to **`text-primary-fg`** (`--color-primary-fg: #117b63`).
    - `themeDefects.test.tsx` `IN_SCOPE_FILES` is not extended. That list covers the organizer public pages and runs the same no-hex check, so `NO_HEX_FILES` already covers the new files.

## Visual Design
The mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to the UI task groups. Fidelity is high: rendered HTML using the app's tokens.

| ID | Mockup | Key elements |
|----|--------|--------------|
| `screen:topbar-inbox-icon` | `analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html` | 💬 40 px button before the bell; mint badge with count, "9+" above 9, hidden at 0 |
| `screen:inbox` | `analysis/design-context/mockups/skrzynka-wiadomo-ci.html` | "‹ Wróć", "Wiadomości"; rows with kind chip (item accent-soft, group mint-soft, term teal-soft), title, ellipsized preview with sender prefix, time ("12:41", "wczoraj", "pon", "12.10"), unread bold + count; empty dashed card; skeleton; PanelNavBar. Per-item emoji in the mockup become the fixed 📦 placeholder |
| `screen:thread-item` | `analysis/design-context/mockups/rozmowa-o-rzeczy.html` | Header: back, thumb (📦 placeholder tile), item name, "Rozmowa z: … · zobacz rzecz"; cream message area; day pills; sticky composer; error variant under the composer |
| `screen:thread-group` | `analysis/design-context/mockups/czat-grupy-i-terminu.html` | Initials and "{group} · czat grupy", "12 uczestników" (or "Grupa usunięta" when read-only); sender name above others' bubbles with "Organizator" chip; read-only banner replaces the composer |
| `screen:item-ask-button` | `analysis/design-context/mockups/zapytaj-o-rzecz-na-stronie-rzeczy.html` | "💬 Zapytaj o rzecz" pill under the status card; hidden for the owner |
| `screen:term-chat-buttons` | `analysis/design-context/mockups/przyciski-czatu-na-stronie-terminu.html` | "💬 Czat terminu" plus "👥 Czat grupy" (PRIVATE); only "Czat terminu" for a PUBLIC group |
| `screen:organizer-entry` | `analysis/design-context/mockups/wej-cia-organizatora.html` | GroupDetailsPage "Czat grupy" card above "Kod dostępu"; TermHeadCard "💬 Napisz do uczestników" |
| `component:message-bubble` | `analysis/design-context/mockups/rozmowa-o-rzeczy.html` | Mine: `bg-primary text-on-primary`, right, bottom-right radius 6. Theirs: `bg-paper border-line`, left. `max-w-[80%] rounded-[18px] whitespace-pre-line break-words`, time beneath |
| `component:message-composer` | `analysis/design-context/mockups/rozmowa-o-rzeczy.html` | Cream rounded textarea, "Wyślij" primary, "Enter — nowa linia" hint, "n / 1000", `role="alert"` error |
| `component:inbox-badge` | `analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html` | NotificationBell badge classes (`components/shared/NotificationBell.tsx`) |

Use only Tailwind tokens from `index.css`, following requirement 42. `#12604D` maps to `text-primary-fg`. The mockups do not show the PUBLIC read-only variant; it reuses the deleted-group variant with the copy from requirement 33.

## Reusable Components

### Existing Code to Leverage
| Need | Existing code |
|------|---------------|
| BC layering, ACL pattern | `app/groups/` (domain / application / infrastructure / router, `service.py` facade), `app/groups/infrastructure/locations_acl.py` |
| Base entity, errors | `app/core/base_model.py`; `app/core/errors.py` (`EntityNotFoundException`, `AccessDeniedException`, `BusinessConflictException`, `TooManyAttemptsException` → 429 + Retry-After, `ValueError` → 400 handler at `:153`) |
| Auth | `app.core.auth_deps` (`require_any`, `Principal`, `AuthenticationRequiredException`); `ReadPrincipal`/`EditPrincipal` aliases as in `app/groups/router/join_code.py:21-22`; profile → 401 as in `app/groups/application/join_code.py:36-44`; `app/users/service.py` `get_profile_by_principal`, `get_profile_by_account_user_id` |
| Organizer / member / attendee logic | `circles._is_active_organizer` (:356, deleted-agnostic), `exchange_summary._ordered_group_member_party_ids` (:56), `repository.list_active_attendances_for_term` (:477), `get_group_including_deleted` (:76), `get_term_any` (:295), `list_group_names` (:80, model for `list_chat_group_refs`), `list_organizer_role_ids_for_party` / `list_member_role_ids_for_party` (model for the new audience statements) |
| Term access flags | `app/groups/application/public_view.py` `get_group_access` (:355-400), `GroupAccessDetails` (`schemas.py:354`) |
| Item owner, item refs | `app/circulation/service.py` `find_item_including_deleted`, `resolve_owning_inventory`; `circulation/infrastructure/repository.py:224-236` `list_product_names_for_items` (model for `list_item_refs`) |
| Server titles | `app/core/clock.py` `format_term_day` |
| Rate limiting | `app/groups/application/join_code_limiter.py` and its conftest reset fixture |
| Moderation | `app/moderation/text_guard.py` `check_text`, `TextField`, `MESSAGES` |
| Migration and tests | `alembic/versions/0057_locations.py`; `tests/test_locations_migration.py`, `tests/test_group_soft_delete_migration.py`; `count_queries` (`tests/conftest.py:81`); `tests/test_authorization_matrix.py`; `tests/test_join_code_limiter.py` |
| Frontend badge and polling | `components/shared/NotificationBell.tsx`, `hooks/useNotifications.ts`, `hooks/useItemDetail.ts` + `test/useItemDetail.test.tsx:150-164` (interval assertions) |
| Frontend errors and time | `api/problem.ts` `serverMessageOr` (:67), `hasStatus`; `components/moderation/DeletedGroupRow.tsx:36` (`dayjs.utc().local()`); `utils/dayjs.ts` (utc plugin, `pl` locale) |
| Frontend hooks and API | `hooks/useJoinCode.ts`, `useGroupDetails.ts`; `api/client.ts`; `src/api/queryClient.ts` |
| UI kit | `components/shared/Avatar.tsx`, `PhoneFrame`, `uiStyles.ts`, `components/panel/JoinCodeCard.tsx`, `pages/panel/PanelNav.tsx` `PanelNavBar`, `pages/panel/panelIcons.tsx` `BackIcon`, `pages/product/ItemFieldEditors.tsx` (textarea, counter, `role=alert`), `utils/plural.ts` |
| View state | `pages/term/termViewState.ts`, `test/termViewState.test.ts` |
| Integration slots | `PublicLayout.tsx` nav, `ItemDetailPage.tsx` `ItemViewContent` (`ItemStatusCard` :153), `pages/term/views/PublicTermView.tsx`, `pages/panel/GroupDetailsPage.tsx` (`joinCodeCard` slot), `pages/panel/TermAttendeesPage.tsx` `TermHeadCard` (:127) |
| Theme tests | `test/themeTokenUsage.test.tsx` (`NO_HEX_FILES` :57, `NO_LEGACY_UTILITY_FILES` :70) |

### New Components Required
| New | Why existing code cannot serve |
|-----|-------------------------------|
| `app/messaging` (models, schemas, service, `application/{access, conversations, messages, read_markers, send_limiter}`, `infrastructure/{repository, groups_acl, circulation_acl, users_acl}`, router) | Nothing stores threads. Notifications are one-way 500-character strings capped at 50 rows |
| Migration `0061_messaging.py` + `tests/test_messaging_migration.py` | New tables |
| Groups: `has_active_membership`, three audience statements, three batched ref lookups, public wrappers (req. 24) | Today's member and audience helpers filter out soft-deleted groups (`repository.py:218-230, 265-277`), are private, or are per-row |
| `circulation.list_item_refs`; `users.list_chat_profiles_by_party_ids` | No batched `(name, deleted_at)` or `(name, has_account)` lookup exists |
| `GroupAccessDetails.is_active_attendee` | `is_attending` counts withdrawn rows; changing it would alter `TermFooter` |
| `send_limiter.py` | `join_code_limiter` is keyed and worded for codes |
| `api/conversations.ts` (+ `chatErrorMessage`), `useUnreadMessages`, `useConversations`, `useConversation`, `useThread`, get-or-create callbacks | New resource |
| `MessagesButton`, `InboxPage`, `ThreadPage`, `threadViewState.ts`, `messageTime.ts`, `MessageBubble`, `MessageComposer` | New screens and helpers. The bubble and composer are shared by all thread kinds |

## Technical Approach
- **Layering.**
  - The router resolves the profile and calls the application functions, which commit.
  - Repositories only read, except for the Core hot-row statements.
  - `application/access.py` `resolve_access(db, conversation, party_id)` returns `{read_only_reason, organizer_party_id}` or raises 404 / 403. Every by-id endpoint shares it.
- **Inbox and unread in fixed queries.**
  1. Profile.
  2. `groups_acl.get_chat_audience_for_party`: three statements.
  3. One conversations query, filtered by:
     - `kind='ITEM' AND :me IN (asker, owner)`;
     - OR `kind='GROUP' AND group_id IN (led ∪ member)`;
     - OR `kind='TERM' AND (term_id IN attended OR group_id IN led)`;
     - and `last_message_at IS NOT NULL`.

     It left-joins my `conversation_reads` row and a grouped unread count.
  4. `DISTINCT ON (conversation_id)` for the last message, restricted to the ≤100 selected ids.
  5. Batched labels: `list_item_refs`, group and term refs, organizers, `list_chat_profiles_by_party_ids`.
  - `unread-count` runs steps 1–3 as one `SUM`, with no LIMIT.
  - A read-only row is still listed and still counted.
- **Cursor queries.**
  - The anchor `(created_at, id)` is read with the conversation filter.
  - `before`: `< anchor ORDER BY created_at DESC, id DESC LIMIT 51`, then reversed.
  - `after`: `> anchor ORDER BY created_at, id LIMIT 51`.
  - The 51st row sets `has_more`.
- **Ordering guarantee (M8).**
  - The send path's row lock plus the strictly increasing `created_at` (requirement 18) make the per-conversation `(created_at, id)` order equal to commit order. When an `after=` poll sees message M, it sees every earlier message too.
  - The client marks only the newest message it holds, so GREATEST never covers an unseen message.
  - In a long-unread thread, the first visit shows the newest 50. Marking the newest of them read also clears older messages, which the user can still page back to. This is accepted Messenger behavior.
- **Get-or-create race.** Insert inside `begin_nested()`. On `IntegrityError` against the partial unique index, re-select. This works under the test `db_session` (`join_transaction_mode="create_savepoint"`).
- **Time.**
  - Audit timestamps are naive UTC (`datetime.utcnow()` or the `BaseEntity` default).
  - The server uses `occurs_on` only for the TERM title (`clock.format_term_day`, Warsaw wall-clock, no conversion).
  - No business rule compares against the current time, so `clock.local_now()` is not needed.
  - The client parses audit times per requirement 40.
- **Frontend data flow.**
  - Pages own the hooks and pass callbacks down: ThreadPage gives `send` to `MessageComposer`.
  - Get-or-create callbacks navigate to `/panel/wiadomosci/{id}`.
  - `useThreadReadMarker` is the only side-effect hook.

## Implementation Guidance

### Testing Approach
- Write 2–8 focused tests per implementation step group. During verification, run only the new tests, not the entire suite.
- **Backend** (flat `tests/test_<feature>.py`, integration-first through `client`, per-file `_register`/`_auth` helpers, exact key sets):
  - `test_messaging_migration.py`: downgrade to 0060 and back to head; the three partial unique indexes and the FKs are present.
  - `test_item_conversations.py`:
    - 201, then 200 for a repeat;
    - own item 409; unknown item 404;
    - a lent-out item goes to the permanent owner;
    - a deleted item without a thread returns 404, while one with a thread returns 200 and stays writable;
    - **after an ownership change, the same asker gets a new thread (201, different id) while the old thread still accepts sends from both original parties**;
    - **a re-open at the 20/h limit returns 200, not 429**.
  - `test_group_term_conversations.py`:
    - member and organizer pass; non-member 403; missing 404;
    - withdrawn attendee 403; a term after its date stays open;
    - **member and organizer of a soft-deleted group: GET 200, messages 200, read 204, send 409, and the row is still in the inbox (H1)**;
    - **PRIVATE→PUBLIC toggle: GET 200 with `GROUP_PUBLIC`, send 409, and get-or-create returns 200; for a PUBLIC group with no chat, get-or-create returns 409; after the toggle back, send returns 201**.
  - `test_conversation_messages.py`:
    - whitespace-only and 1001-character bodies return 400 with the Polish message and no `fieldErrors`;
    - `before`/`after` paging with `has_more`;
    - `is_mine`, `sender_name`, `sender_is_organizer`;
    - moderation rejection 400 with no row written;
    - 429 on the 31st send;
    - two sends in a row have strictly increasing `created_at`;
    - `GET /api/conversations/unread-count` is routed (not 400) (M3).
  - `test_conversation_inbox.py`:
    - unread math: own messages don't count, the marker clears them, and the count is uncapped above 9;
    - GREATEST: marking an older id does not raise the count;
    - **`count_queries` is equal for the inbox and for unread-count between one conversation of each kind (3 rows) and three of each kind (9 rows), for the same caller with the same role kinds** (M1);
    - `participant_count` excludes a guest attendee.
  - `test_group_access.py` (or the existing access test): `is_active_attendee` is false and `is_attending` is true for a withdrawn attendee.
  - `test_authorization_matrix.py`: cases for the new rows.
- **Frontend** (Vitest, `createQueryWrapper`, `vi.mock` API modules):
  - `useUnreadMessages` and `useThread`: `observers[0].options.refetchInterval` is 20 000 and 5 000, and `refetchIntervalInBackground` is falsy, in the `useItemDetail.test.tsx` style;
  - `useThread` merge: a poll appends, a duplicate id is dropped, and `loadOlder` prepends;
  - `messageTime`, with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`: a naive-UTC `created_at` renders in local time, plus the inbox, separator and year rules;
  - a `threadViewState` `it.each` table including `readOnly` for both reasons;
  - `MessagesButton`: badge, "9+" and hidden at 0;
  - composer: counter, disabled states, `role="alert"` copy for 429 / 403 / generic, and the text is kept;
  - entry-point gating: owner or deleted item hides "Zapytaj o rzecz"; the term-page matrix, including a withdrawn attendee (no "Czat terminu") and an anonymous guest (no buttons); the organizer card;
  - routing: `/panel/wiadomosci` renders InboxPage, not PanelPage;
  - **`test/PublicLayout.test.tsx` gains `vi.mock("../api/conversations", …)` (L9)**;
  - `themeTokenUsage.test.tsx` includes the new files (requirement 42).

### Standards Compliance
- `standards/backend/models.md`:
  - BaseEntity UUIDs, no `relationship()`;
  - plain FK id columns across BCs;
  - batched `IN` lookups, one ACL module per foreign BC;
  - 404 before 403; soft-deleted references still rendered.
- `standards/backend/migrations.md`: 0061, explicit `pk_`/`fk_`/`ix_`/`uq_` names, partial unique indexes, reverse-order downgrade, round-trip test.
- `standards/backend/security.md`: matrix rows before the catch-all, `Depends(require_any(...))` per route, matrix test.
- `standards/backend/queries.md`, `jooq.md`: bound parameters, fixed query count, explicit ordering, SQL-level LIMIT.
- `standards/backend/time.md`: naive-UTC audit timestamps; `occurs_on` is formatted with `clock.format_term_day` and never compared.
- `standards/global/validation.md`, `error-handling.md`: server-side trim and length checks, specific Polish messages, typed exceptions.
- `standards/global/minimal-implementation.md`: no participant table, no bell kinds, no `subtitle`, no thumbnail pipeline.
- `standards/frontend/components.md`: one view state for ThreadPage; pages own the hooks.
- `standards/frontend/data-fetching.md`:
  - hooks wrap `api/`, with one query per thread and cache merges via `setQueryData`;
  - prefix invalidation, username in keys;
  - dayjs from `utils/dayjs.ts`; callbacks passed down.
- `standards/frontend/accessibility.md`: labelled textarea, `role="alert"` errors, badge `aria-label`, keyboard-reachable controls.
- `standards/frontend/css.md`, `responsive.md`: tokens only (requirement 42), mobile-first, `dvh` height.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: as listed in the Testing Approach.

## Out of Scope
- Attachments, editing or deleting messages, typing indicators, read receipts, reactions, search.
- Block and report, email and push, bell notifications or `NotificationKind` additions.
- New chats for PUBLIC groups, a "Moje grupy" list for members, leaving or muting a conversation, merging ITEM threads across owners.
- Profile photos and item thumbnails in threads, profile links, inbox paging beyond 100, WebSocket or SSE.

## Success Criteria
1. **Migration.** Upgrade to head, downgrade to 0060 and upgrade again all succeed. The test asserts the three tables, the three partial unique indexes and the FKs.
2. **Item conversations.**
   - 201, then 200 with the same id; the owner gets 409; a lent-out item goes to the permanent owner's party.
   - After a GIVE, the same asker gets a new id, and the old thread still works for both original parties.
3. **Access, per kind.**
   - ITEM: a third party gets 403.
   - GROUP: a non-member gets 403, and an unknown id 404.
   - TERM: a withdrawn attendee gets 403; the organizer and active attendees get 200.
   - A random UUID returns 404 before any 403.
4. **Read-only.**
   - For a soft-deleted group, members **and** the organizer get GET 200, messages 200 and read 204; send returns 409; `read_only_reason` is `GROUP_DELETED`; the chat stays in both inboxes.
   - For a PRIVATE→PUBLIC toggle, the same holds with `GROUP_PUBLIC`, and sending works again after toggling back.
   - A soft-deleted item's thread still accepts sends.
5. **Validation and moderation.**
   - A whitespace-only or 1001-character body returns 400 with the Polish message and no `fieldErrors`.
   - A moderation rejection returns 400 with the `MESSAGE_BODY` message and writes no row.
6. **Rate limits.**
   - The 31st send in 60 s returns 429 + `Retry-After`.
   - The 21st new ITEM conversation in an hour returns 429.
   - Re-opening an existing ITEM conversation at the limit returns 200.
7. **Read markers.**
   - B's unread count equals A's message count, uncapped.
   - Marking the latest message read gives 0, and marking an older one afterwards keeps it at 0.
   - Own messages never count.
8. **Query budget.** For both `GET /api/conversations` and `GET /api/conversations/unread-count`, `count_queries` is equal between one conversation of each kind (3) and three of each kind (9) for the same caller.
9. **Paging and ordering.**
   - With 60 messages, the default page returns the newest 50 with `has_more: true`, and `before=<first>` returns 10 with `has_more: false`.
   - `after=<last>` returns only newer messages.
   - Consecutive sends have strictly increasing `created_at`.
10. **Routing.** `GET /api/conversations/unread-count` returns 200, not 400.
11. **No bell rows.** No messaging call creates a `notifications` row.
12. **Polling.** Hook tests assert `refetchInterval` 20 000 (unread) and 5 000 (thread), with `refetchIntervalInBackground` falsy. The thread uses one query whose poll merges `after=` results into the cache.
13. **Time display.** A `created_at` of `2026-10-22T10:00:00` renders as "12:00" in Europe/Warsaw (CEST). The inbox and day-separator formats follow requirement 40.
14. **View state.** The `resolveThreadView` table covers loading, notFound (404 / 400), denied (403), error, readOnly (both reasons) and ready.
15. **Entry points.**
    - "Zapytaj o rzecz" is absent for the owner and for deleted items.
    - The term-page buttons follow the PRIVATE / PUBLIC × member / active attendee / withdrawn / organizer / anonymous table.
    - The GroupDetailsPage card shows only for the organizer of a PRIVATE group.
    - The TermHeadCard button opens the term chat.
16. **Mockup fidelity.** Each screen ID matches its mockup in layout, verbatim Polish copy, tokens and states. That includes "9+", the empty state, the skeleton, the composer error, the read-only header line and the banner. Verification includes a side-by-side visual check.
17. **Quality gates.**
    - `ruff`, `mypy` (no new errors against the baseline), `tsc`, eslint and the new tests pass.
    - `themeTokenUsage` passes with the new files listed.
    - `PublicLayout.test.tsx` passes with the conversations mock.

## Audit resolution
| Finding | Resolution |
|---------|------------|
| **User decision 1**: owner change | Requirement 1: the ITEM unique index is on `(item_id, asker_party_id, owner_party_id)`. Requirements 6 and 12 cover the current-owner lookup and the new thread. Requirements 34 and 15 also apply. Tested in `test_item_conversations.py` and Success Criterion 2 |
| **User decision 2**: PRIVATE→PUBLIC toggle | Requirements 7 and 9 add `GROUP_PUBLIC` read-only. Requirement 13 returns 409 when no chat exists, and its step 3 returns an existing chat. Requirements 14 and 32 keep the chat in the inbox. Requirement 33 gives the header "Grupa publiczna" and the banner. Requirement 35 keeps the button PRIVATE-only. Success Criterion 4 |
| H1: soft-deleted membership | Requirement 24b adds `has_active_membership` with no `Group` join. Requirement 24e adds three new audience statements and does not reuse the role-id helpers. Existing callers are unchanged. Covered by a test and Success Criterion 4 |
| H2: naive-UTC parsing | Requirement 40 adds `messageTime.ts`: `dayjs.utc(x).local()` for audit times, `term_occurs_on` never converted, and pinned bubble, inbox and separator formats. Tested with fake timers; Success Criterion 13 |
| M1: count_queries design | The test compares one of each kind (3 rows) with three of each kind (9 rows) for the same caller and role kinds (Testing Approach, Success Criterion 8) |
| M2: `list_item_refs` N+1 | Requirement 25: one `InventoryItem` ⨝ `Product` join modelled on `list_product_names_for_items`, with no per-item load |
| M3: route shadowing | Requirement 21 declares the literal paths before `/{id}`. Covered by a test and Success Criterion 10 |
| M4: withdrawn attendee gating | Requirement 39 adds the new `access.is_active_attendee` and leaves `is_attending` unchanged. Requirement 35 uses the server flags plus `isLoggedIn` and never `guest.isAttending` |
| M5: English error text | Requirement 18 raises `ValueError` with Polish text (400, no Pydantic constraints). Requirement 41 adds `chatErrorMessage`: Polish 403 and 404 copy plus `serverMessageOr` with Polish fallbacks |
| M6: ITEM check order | Requirement 12 fixes the order 404 → 409 → existing 200 → deleted 404 → limiter → insert → record. A race loser does not record. A re-open at the limit returns 200 |
| M7: `useThread` mechanics | Requirement 29: one `useQuery`, a `queryFn` that merges `after=` results into the cache, `setQueryData` for `loadOlder` and `send`, the empty-thread case, and no `useInfiniteQuery` and no effect-based fetching |
| M8: out-of-order commits | Requirement 18: a `FOR UPDATE` row lock plus a strictly increasing `created_at`, so commit order equals cursor order. Requirement 19 and the Technical Approach show why GREATEST cannot cover an unseen message. The overlap window was rejected (Key Decisions) |
| M9: theme tokens | Requirement 42: the new files go in `NO_HEX_FILES`, the mint ban is respected for `PublicTermView` and `ItemDetailPage`, `#12604D` maps to `text-primary-fg`, and the `themeDefects` list stays scoped as it is |
| M10: thumb data source | Key Decisions and requirements 14, 32 and 33: a fixed 📦 placeholder tile and no `thumb_url`. The real thumbnail would need a product-BC photo lookup plus storage, which the item-ref join cannot provide |
| L1: auth module cite | Requirements 11 and 20 and the reuse table now cite `app.core.auth_deps` and `application/join_code.py:36-44` |
| L2: FK wording | Requirement 1: real FKs for `item_id`, `group_id` and `term_id`, following `models.md`. There are no hard deletes, and the `reservations.term_id` precedent exists |
| L3: names-on-public-terms risk | Open Questions reworded: the names are already public through `guardians`; the new exposure is message content |
| L4: guests in `participant_count` | Requirement 16: account-backed parties only, via `has_account` (requirement 26). Tested |
| L5: read-only header copy | Requirement 33: "Grupa usunięta" or "Grupa publiczna" replaces "N uczestników", and the banner copy covers both reasons |
| L6: date and title formats | Requirement 14: the server builds `title`, with the TERM title via `clock.format_term_day`. Requirement 40 pins every client format. `subtitle` is dropped |
| L7: Core statement details | Requirement 5: the conversation update uses `GREATEST(coalesce(...))` plus `updated_at`; the read upsert sets `created_at`/`updated_at` explicitly and uses GREATEST on conflict |
| L8: unread sum cap and limit | Requirement 15: the sum is exact, with no LIMIT and no cap; "9+" is display-only |
| L9: PublicLayout test mock | Testing Approach and Success Criterion 17: `vi.mock("../api/conversations")` in `PublicLayout.test.tsx` |
| L10: PUBLIC toggle undocumented | Superseded by user decision 2 (above); recorded in Open Questions |
| L11: `is_active_organizer` collision | Requirement 24a names it `is_active_group_organizer` |
