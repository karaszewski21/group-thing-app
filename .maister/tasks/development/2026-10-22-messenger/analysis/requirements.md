# Requirements: Messenger

## TL;DR
A Messenger-like communicator with three conversation kinds:
- **ITEM**: a 1:1 conversation about an item, between the asker and the item's permanent owner.
- **GROUP**: a chat for a PRIVATE group, open to its organizer and members.
- **TERM**: a chat for a term, open to its organizer and attendees.

The inbox is reached from a 💬 icon with an unread badge, next to the bell. Messages are text only, up to 1000 characters, checked with Bielik moderation and rate-limited. New messages arrive by polling (every 20 s for the badge, every 5 s in an open thread). No messages go to the bell.

## Key Decisions
- All decisions from `analysis/clarifications.md`, `scope-clarifications.md` and `technical-clarifications.md` are binding.
- The Phase 4 mockups are binding (`analysis/design-context/INDEX.md`).

## Initial description
"chcę zaimplementować komunikator podobny do Messengera. User może napisać ze strony produktu o dodatkowe informacje. Również organizator może napisać na swoją grupę oraz na swoim terminie."

## Q&A summary
- **Phase 1:**
  - Group and term conversations are group chats where everyone can write.
  - Group chat = members; term chat = attendees; the organizer is in both.
  - Delivery is by polling.
  - Moderation is Bielik only.
  - Participants see the full history, and the participant list is dynamic.
- **Phase 2 (critical):**
  - Group chat exists only for PRIVATE groups.
  - The term page has chat buttons for members and attendees.
  - New messages are signalled by the inbox badge only.
- **Phase 2 (important):**
  - The inbox icon sits next to the bell.
  - The owner's name and avatar are shown in the thread.
  - Block and report are deferred.
  - Questions go to the permanent owner.
  - A deleted item's thread stays writable.
  - Text only, maximum 1000 characters.
  - Rate limits: 30 messages per minute and 20 new item conversations per hour.
  - Conversations are created lazily by any participant.
  - Role flags come from `/access`.
  - A term chat stays open after the term ends; a deleted group's chat becomes read-only.
  - Polling: 20 s for the badge, 5 s in an open thread.
- **Phase 5A:**
  - Access is computed, with read markers.
  - Keyset cursor, 50 messages per page.
- **Phase 5B:**
  - The journey is confirmed (below).
  - The listed patterns are reused.
  - The mockups are the only visual source.
  - The owner sees the asker's name and avatar, with no profile link.

## User journey (confirmed)
1. **Asking about an item.** A visitor opens someone else's item page and taps "Zapytaj o rzecz". This opens the existing conversation with the owner, or creates one, and the visitor lands on the thread. The owner sees the conversation in their inbox and the badge count goes up.
2. **Members and attendees.** On the term page, an attendee or the organizer sees "Czat terminu". In a PRIVATE group, a member or the organizer also sees "Czat grupy". Either button opens the chat, creating it on first use.
3. **Organizer.** The group details page has a "Czat grupy" card (PRIVATE groups only). The term attendees list has "Napisz do uczestników", which opens the term chat.
4. **Everyone.** The 💬 icon and its counter sit in the top bar, next to the bell. `/panel/wiadomosci` shows the inbox and `/panel/wiadomosci/:id` shows a thread.

## Functional requirements
- **Backend (new `app/messaging` BC under `/api/conversations`):**
  - Get-or-create an ITEM conversation by `item_id`. The owner is resolved on the server. A user cannot ask about their own item.
  - Get-or-create a GROUP conversation by `group_id`. The group must be PRIVATE and the caller its organizer or a member.
  - Get-or-create a TERM conversation by `term_id`. The caller must be its organizer or an attendee.
  - List my conversations: last message, unread count, kind, title, counterpart or context. The query count must not grow with the number of rows.
  - Global unread count, cheap enough to poll.
  - Thread messages with `before` and `after` cursors, 50 per page. Each message carries `is_mine`, sender name and avatar, and `sender_is_organizer`.
  - Send a message: 1–1000 characters after trim, `check_text` (`TextField.MESSAGE_BODY`), rate limiter (429), and 403 when the caller has no access. Read-only conversations (soft-deleted group) return 409 or 403.
  - Mark as read (upsert into `conversation_reads`, Core statement).
  - Authorization matrix rows for the new routes.
- **Frontend:**
  - New pieces: `api/conversations.ts`, hooks (inbox, unread count, thread, get-or-create), `MessagesButton` in `PublicLayout`, `InboxPage`, `ThreadPage`.
  - "Zapytaj o rzecz" on `ItemViewContent`.
  - Term page chat buttons, using the role flags threaded through `termViewState`.
  - "Czat grupy" card on `GroupDetailsPage`; "Napisz do uczestników" on `TermAttendeesPage`.
- **Not included:** attachments, editing, deleting, typing indicators, read receipts, reactions, search, block or report, email or push, and bell notifications.

## Reusability
- **Backend:**
  - The groups BC layering and ACL modules.
  - `join_code_limiter`, `text_guard`, `get_profile_by_principal`.
  - `resolve_owning_inventory` (permanent owner).
  - Group helpers to promote to public: `_is_active_organizer`, `_ordered_group_member_party_ids`, `list_active_attendances_for_term`.
  - `list_profile_names_by_party_ids` and the avatars.
  - `count_queries` for tests.
- **Frontend:**
  - `NotificationBell` badge; `useItemDetail` polling and its test.
  - `Avatar`, `uiStyles`, `PhoneFrame`, `PanelNavBar`, the `JoinCodeCard` style.
  - The textarea from `DescriptionEditor`, `ItemBackButton`.
  - `useJoinCode`, `useCategories` and `useGroupDetails` as hook templates.
  - `ToastPill`.

## Technical considerations
- **Timestamps:** naive UTC for `created_at`, read markers and cursors.
- **Hot rows:** use Core `update()`/upsert to avoid the `updated_at` optimistic-lock 409.
- **Inbox query:** unread across dynamic audiences is a union of item conversations (two parties), group conversations (member or organizer) and term conversations (attendee or organizer). Use a fixed number of queries and test with `count_queries` at 1 vs 3 rows.
- **Uniqueness:**
  - Partial unique index per group, and per term.
  - ITEM conversations are unique per `(item_id, asker_party_id)`. The owner is stored as `owner_party_id`, captured at creation.
- **Next migration:** 0061, with a round-trip test.
- **New routes:** add `/panel/wiadomosci...` under `PublicLayout` + `AuthGuard`. No new top-level slug, so `RESERVED_SLUGS` needs no change.
- **Day separators:** need `relativeTime`, or use the existing formats from `utils/dayjs.ts`.
