# Clarifications (Phase 1)

## TL;DR
- Organizer messages to a group or a term are **group chats**: the organizer and every participant can write, and everyone sees everything. There is one conversation per group and one per term.
- The **group** chat's participants are the group's members (Membership); the **term** chat's participants are the term's attendees. Both include the organizer, and only people with accounts take part.
- New messages are delivered by **polling**, not WebSocket or SSE. Text goes through **Bielik moderation only**; contact details are allowed.
- **History:** a participant sees the whole conversation history. Participants are resolved from the current state, so someone who leaves the group or withdraws from the term loses access.

## Key Decisions
- Group and term messaging is a group chat, not one-way announcements. This was the user's choice; it works like a Messenger group.
- The group chat's audience is the members (active Membership) plus the organizer; the term chat's audience is the term's active attendees plus the organizer. The user specified both.
- Delivery is by polling. It fits the current architecture, which has no WebSocket or SSE.
- Moderation is the Bielik text guard only, with no contact-info ban, because people may need to arrange a handover.
- Late joiners see the full history. The participant list is resolved dynamically, so leaving removes access.

## Open Questions / Risks
- **Guest attendees** (no account) cannot log in, so they don't use the chat. They are party-keyed, so if they later create an account they would see the term chat. This is assumed rather than confirmed.
- **Public groups** may have no members at all, so the group chat could be just the organizer.

## Q&A
1. **Q:** How should organizer messages to a group or term work? **A:** As a group chat (the Recommended option).
2. **Q:** Who counts as "the group"? **A:** "If the user writes from the group, the members; if they write from a term, the attendees."
3. **Q:** How are messages delivered? **A:** Polling (Recommended).
4. **Q:** Which text rules apply? **A:** Bielik moderation only (Recommended).
5. **Q:** What does a late joiner see? **A:** The whole history (Recommended).
