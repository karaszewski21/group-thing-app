# Gap Analysis: Messenger (item questions, group chat, term chat)

## TL;DR
- Messaging is entirely new: there is no conversation or message model, no inbox and no unread state. The gap is a whole new `app/messaging` BC plus about 10 small insertions into existing files.
- Most of the audience logic already exists as private groups helpers (`_ordered_group_member_party_ids`, `list_active_attendances_for_term`, `_is_active_organizer`). The frontend already gets per-group `is_member`, `is_organizer` and `is_attending` from `GET /api/groups/public/{id}/access`. Codebase analysis said "no organizer flag", which is only partly true.
- **Two reachability gaps** need a decision. First, only `join_code` (PRIVATE groups) ever creates a `Membership`, so a PUBLIC group's chat would contain only the organizer. Second, members have no page listing their groups: `/panel/grupy/:id` is linked only from the organizer's "Prowadzę" tiles. As a result, a member could find the group chat only in the inbox.
- Notifications are in-app only: there is no mailer and no push. An inbox badge that is polled for its count therefore makes bell rows for chat mostly redundant. Choosing badge-only removes the whole outbox fan-out.
- Risk is Medium and effort is High. The work is additive (change type "additive", compatibility "strict" for existing endpoints).

## Key Decisions
- **Characteristics:** `creates_new_entities` (no messaging exists), `modifies_existing_code` (item page, layout, term page, authorization matrix, groups service, NotificationKind), `involves_data_operations` (Conversation, Message, read markers) and `ui_heavy` (inbox, thread, entry points). There is no reproducible defect.
- **Dynamic participant resolution is settled by (e)**, so group and term chats should not snapshot participants into `conversation_participants`. Read access is computed from current Membership or attendance plus the current leadership. Only a per-party read marker row (`last_read_at`) is stored, created lazily. This contradicts the codebase analysis's snapshot recommendation; the spec must follow (e).
- **Reuse the existing access flags for gating** (`GroupAccessDetails.is_member/is_organizer/is_attending`). `termViewState.ts` currently drops `is_organizer`; it has to be threaded through. No new organizer flag is needed on `GroupResponse`.

## Open Questions / Risks
- **Unread counts with dynamic audiences.** An inbox query must list group and term chats for every group where I'm a member or organizer, and for every term I attend, even if I have never opened them. That means a UNION over memberships, attendances and leadership, then joining messages after my read marker. The query-count budget is tight, and a `count_queries` 1-vs-3 test is mandatory.
- **Organizer change.** With dynamic resolution, a new organizer gains access to the full history and the previous organizer loses it. This follows from (e), so the risk is only documented here.
- **Name exposure in group chats.** Term attendees will see each other's display names. On a PUBLIC term this may reveal more than the public term view does today. This needs verification against the copy and privacy expectations in the spec.
- **Per-process rate limiter.** The limiter keeps its state in memory, so it applies per uvicorn worker. This is acceptable for MVP but should be stated in the spec.
- **Moderation latency and 503s on every send** when `moderation_text_enabled` is on. The UI needs a retry state.
- **Guest RSVPs** (no account) are excluded, which was assumed in clarifications. If `account_merge` later attaches the guest party to an account, dynamic resolution gives that person the full term history. This is consistent with (e).

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: High (a new BC with 3 entities, migration 0061, about 7 endpoints, an inbox aggregate query, 2 new pages and 4 entry points)
- **Detected Characteristics**: creates_new_entities, modifies_existing_code, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (small insertions)
- Creates new entities: yes
- Involves data operations: yes
- UI heavy: yes

## Gaps Identified

### Missing Features
- **Conversation, Message and read-marker persistence.** Nothing exists. Searches for `conversation`, `message` models and `websocket`/`sse` return no hits outside notifications.
- **Item question entry.** `ItemDetailsResponse` (circulation/schemas.py:189) exposes only `is_owner`. The owner has to be resolved on the server through `resolve_owning_inventory` → `Inventory.owner_user_id` → profile → party.
- **Inbox, thread page and unread badge.** No routes exist. `PublicLayout.tsx:35` has only `NotificationBell` and `AccountMenu`.
- **Group and term chat entry points.** None exist. `TermPage` already has `access.is_attending` and `access.can_view_content`, and `GroupDetailsPage` is organizer-reachable only.
- **Public groups-service functions** for "is organizer", "active member party ids" and "active attendee party ids". The logic exists only as private helpers:
  - `circles._is_active_organizer:356`;
  - `exchange_summary._ordered_group_member_party_ids:56`;
  - `repository.list_active_attendances_for_term:477`.
- **A message body moderation field** (`TextField.MESSAGE_BODY`) and its Polish error message.
- **A send rate limiter.** The template is `join_code_limiter.py`, which uses in-memory windows.

### Incomplete Features
- **Organizer flag on the frontend.** It exists in `api/groups.ts:263-267` (`GroupAccess`) and `api/people.ts:24`, which is global role, not per group. `termViewState.ts:30` passes only `isAttending` and drops `is_organizer`/`is_member`.
- **Member navigation to groups.** `GroupDetailsPage` says "The backend lets the group's organizer and its members in", but the only link to it is under "Prowadzę" (`SpotkaniaView.tsx:192`). Members reach a group only through term links (`HomeView.tsx:176`).
- **Memberships for PUBLIC groups.** `add_active_membership` is called only from `join_code.py:144`, so PUBLIC groups never gain Membership rows.

### Behavioral Changes Needed
- `NotificationKind` will gain message kinds unless the decision is badge-only. `PendingActionsHost` must ignore them.
- `termViewState` must expose `isOrganizer`/`isMember` so it can render chat entry points.

## User Journey Impact Assessment

| Journey | Current | After (recommended) | Assessment |
|---|---|---|---|
| Asker → item owner | Item page, no contact path | "Zapytaj o rzecz" on item page → thread | ✅ 8/10 |
| Owner sees question | Nothing | Inbox badge in top bar → inbox → thread | ✅ 8/10 if the badge is polled; ⚠️ if bell only, because the bell is not polled |
| Organizer → group chat | Nothing | Card on `GroupDetailsPage` (reached from "Prowadzę") | ✅ 7/10 |
| Member → group chat | Nothing; no member group list | Inbox only (after the first message), or a button on TermPage | ⚠️ 4/10 inbox only; 7/10 with a TermPage button |
| Organizer → term chat | Nothing | Button in `TermAttendeesPage` TermHeadCard and on TermPage | ✅ 7/10 |
| Attendee → term chat | Nothing | Button on TermPage when `is_attending`, plus the inbox | ✅ 7/10 |
| PUBLIC group chat | n/a | Audience = organizer only (no Memberships) | ❌ a dead-end chat unless decided |

## Data Lifecycle Analysis

### Entity: Conversation (direct item thread)
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | none (planned get-or-create `POST /api/conversations`) | none (planned item-page button) | none | ❌ to build |
| READ | none | none (inbox/thread) | none (route plus badge) | ❌ to build |
| UPDATE | n/a (read marker only) | auto-mark-read on open | n/a | ❌ to build |
| DELETE | none; leave/hide not in scope | none | none | out of MVP (decision) |

### Entity: Conversation (group/term chat)
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | lazy get-or-create per group/term (unique index) | entry buttons | organizer: GroupDetailsPage/TermAttendeesPage; member: **no page** | ⚠️ the member path is missing |
| READ | dynamic audience check | thread/inbox | inbox plus entry buttons | ❌ to build |

### Entity: Message
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | `POST /{id}/messages` (moderation, limiter) | composer | thread page | ❌ to build |
| READ | keyset `GET /{id}/messages` | bubbles | thread page | ❌ to build |
| UPDATE | none | none | none | out of MVP (decision) |
| DELETE | none | none | none | out of MVP (decision) |

**Completeness (current):** 0%. The feature is new. If CREATE and READ are both built, the planned completeness is 100% for MVP operations, with UPDATE and DELETE cut deliberately.
**Orphaned operations (planned design):** two risks, each with a decision below. Members can READ the group chat only through the inbox and have no entry point. The PUBLIC group chat has CREATE but no audience to READ it.
**Missing touchpoints:**
- the member-facing group screen;
- the TermPage chat button for attendees;
- the item page "ask" button for organizer-themed item routes (`/:slug/produkt/:id` reuses `ItemDetailBody`, so it is covered by the same component);
- the inbox entry in the top bar.

## Issues Requiring Decisions

### Critical
1. **Group chat for PUBLIC groups** (`scope-orphan-public-group-chat`). Only `join_code` creates Memberships, so the audience is the organizer alone.
   - Options:
     - A. Group chat only for PRIVATE groups; PUBLIC groups use term chats.
     - B. For PUBLIC groups, the audience is anyone with an active RSVP on any (upcoming) term.
     - C. Show the chat anyway; it will be empty.
   - Recommendation: **A**. It keeps the settled definition (b) intact and avoids a dead end.
2. **Member entry point to the group chat** (`scope-orphan-member-group-chat`).
   - Options:
     - A. Inbox only; members see the chat after the first message.
     - B. Also add a "Czat grupy" button on TermPage when `is_member || is_organizer`.
     - C. Add a "Moje grupy" list for members.
   - Recommendation: **B**. It is cheap because the access flags already exist, and members can then open the chat before anyone has written.
3. **Notification policy** (`notification-policy`). Notifications are in-app only and the bell is not polled.
   - Options:
     - A. Badge-only: no bell rows for chat, and the polled inbox badge shows unread state.
     - B. One collapsed bell row per conversation while unread, for all kinds.
     - C. A collapsed bell row for direct item questions only; group/term chats are badge-only.
     - D. A bell row per message.
   - Recommendation: **A**. There is no extra delivery channel, so bell rows only duplicate the badge. Option A also avoids the 50-row cap pushing out pending-action rows and removes the outbox fan-out entirely. **C** is the fallback if a bell entry is wanted for item questions.

### Important (defaults proposed)
1. **Inbox location**: an icon with a badge beside the bell (default), a 5th PanelNav tab, or both. Default: the icon in the `PublicLayout` top bar, which shows on all pages, so PanelNav keeps 4 tabs.
2. **Owner identity shown to the asker**: the owner's display name and avatar inside the thread only (default); an anonymous "Właściciel"; or also on the item page. Default: name in the thread only. It is symmetric with the asker's name shown to the owner, and the item page stays id-free.
3. **Owner reply, block and report**: both sides can reply (default, since it is 1:1); block or report in MVP, or deferred. Default: defer block and report, relying on Bielik plus the rate limits.
4. **Recipient when the item is lent out**: the permanent owner (default) or the current holder.
5. **Item deleted or owner changed**: the thread stays readable and writable with the item shown as "(usunięte)" (default), or becomes read-only.
6. **MVP scope cuts**: text only; no attachments, edit, delete, typing indicators, read receipts, reactions or search (default: cut all).
7. **Message length**: 2000 characters (default) or 1000 (the bio limit).
8. **Rate limits**: 30 messages per minute per party plus 20 new item conversations per hour per party, in memory and per worker (default), or stricter.
9. **Chat creation rights**: any eligible participant lazily gets-or-creates the group/term conversation on open, one per group/term (default), or only the organizer can start it.
10. **Organizer flag delivery**: reuse `GroupAccessDetails` and thread `is_organizer`/`is_member` through `termViewState` (default); thread responses carry `is_mine` and `sender_is_organizer`.
11. **Chat after a term ends or a group is soft-deleted**: the term chat stays open for attendees and a soft-deleted group's chats become read-only (default), or both are closed.
12. **Polling cadence**: badge every 20 s and the open thread every 5 s, never in the background (default).

## Recommendations
- Build the direct-item vertical slice first: model, get-or-create, send, read, inbox and badge. Then add group/term chats with dynamic audience resolution.
- Promote the three private groups helpers to public `groups.service` functions, with batched variants for the inbox, such as "group ids where party is member or organizer" and "term ids where party attends".
- Use Core `update()` for `last_message_at` and `last_read_at` because of the `version_id_col` hot rows.
- Write a `count_queries` 1-vs-3 test for the inbox and the unread count.

## Risk Assessment
- **Complexity Risk**: Medium-High. The hardest parts are the inbox and unread aggregation across dynamic audiences.
- **Integration Risk**: Medium. The work touches the groups public API, the matrix rows (which must come before the catch-all) and termViewState.
- **Regression Risk**: Low. Changes are additive insertions and existing endpoints are unchanged.
