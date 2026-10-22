# Scope Clarifications (Phase 2)

## TL;DR
- **Group chat:** for PRIVATE groups only, with the organizer and members as participants. Public groups use term chats instead.
- **Entry points:** members reach the chat from a button on the term page; items get "Zapytaj o rzecz"; the inbox is an icon with an unread badge next to the bell.
- **Signalling:** the inbox badge only. Messages do not go into the bell.
- **MVP:** text only, up to 1000 characters, 30 messages/min and 20 new item questions per hour. Polling refreshes the badge every 20 s and an open thread every 5 s.

## Key Decisions
- **Public groups get no group chat; PRIVATE groups only.** Public groups never have Memberships, so their chat would be organizer-only. Public-group attendees are covered by the term chat.
- **The term page shows "Czat grupy" to members and "Czat terminu" to attendees (and the organizer).** Members have no list of their groups to start from, and the access flags already come back from `/access`.
- **Notifications are the inbox badge only, with no bell rows.** This avoids crowding out pending-action rows (the bell is capped at 50) and makes outbox fan-out unnecessary.
- **The inbox is an icon with a badge next to NotificationBell in PublicLayout.** It is visible on every page, and PanelNav stays at 4 tabs.
- **The item owner's name and avatar appear inside the conversation only.** This is symmetric with the asker's name being shown to the owner, and the item page stays free of user ids.
- **Both sides can reply; block and report are deferred.** Bielik moderation and rate limits are enough for the MVP.
- **A lent item's questions go to the permanent owner,** which is what `resolve_owning_inventory` already returns.
- **A deleted item's conversation stays readable and writable, with the item shown as "(usunięte)",** matching the soft-delete display convention.
- **The MVP is text only.** No attachments, editing, deleting, typing indicator, read receipts, reactions or search, per minimal implementation.
- **Messages are limited to 1000 characters.** This was the user's choice.
- **Rate limits are 30 messages/min per party and 20 new item conversations/hour per party, held in memory per worker,** following the `join_code_limiter` template.
- **Any eligible participant can create a group or term chat lazily, on open.** There is one chat per group and one per term (unique), and nobody has to wait for the organizer to start it.
- **Roles come from reusing GroupAccessDetails `is_organizer`/`is_member`, passed through `termViewState`.** Messages carry `is_mine` and `sender_is_organizer`. The flags already exist on the server.
- **The term chat stays open after the term ends; a soft-deleted group's chats become read-only.** Items may still need to be handed over after the term.
- **Polling:** the badge refreshes every 20 s, an open thread every 5 s, and nothing refreshes in a background tab, following the `useItemDetail` pattern.

## Open Questions / Risks
- Unread counts across dynamic audiences (Membership ∪ attendance ∪ organizer) need a careful aggregate query. Add a `count_queries` 1-vs-3 test.
- When the organizer changes, the new organizer gains the full history and the previous one loses it.
- Attendees of a public term will see each other's display names in the term chat.
- Rate limits apply per worker, and moderation adds latency and can return 503 when enabled.
