# Scope Clarifications (Phase 2)

## TL;DR
Scope expanded with withdraw (logged-in, self only) and cascade delete of event chat. Event page uses event-only component copies (Term components untouched), author's org theme, author first as "Organizator", sign-up closed after event end, no capacity, OG preview added, guest merge reused, guest names moderated, item links to /<slug>/product/<id>.

## Key Decisions
- Withdraw: logged-in participant withdraws themselves (idempotent, sets withdrawn_at); guests cannot — like Term (critical)
- Event chat on delete: conversations.event_id ON DELETE CASCADE (critical)
- `/events/:eventId/edit` stays; its back link / post-save navigation use the slug URL
- Theme: author's own Organization theme if they own one, else default palette
- Author shown first in participants list labelled "Organizator" with their items; author has no sign-up button
- Sign-up rejected (409) after ends_at (or starts_at if no end); page shows "Wydarzenie się zakończyło"; list and chat remain
- No capacity in v1
- OG link preview for /<slug>/event/<id> added in app/system/router.py (mirroring term preview)
- Guest merge: reuse AccountMergeForm with localStorage key `guest_profile_id:event:<id>`; backend merge unchanged
- Components: **event-only copies** (user chose NOT to parametrize Term components) — Term page stays untouched; event versions styled identically using shared uiStyles
- Participant item click → `/<slug>/product/<id>`
- Guest name runs through check_text moderation

## Open Questions / Risks
- Event-only copies duplicate Term styling — drift risk; mitigate by reusing `uiStyles.ts` classes and shared primitives (Avatar, SafeImage, ModalSheet, AuthGateSheet, TermPlaceLine)
- Messaging EVENT branch must cover every `group_id`-asserting path (access.py, inbox.py, conversations.py) or the inbox breaks for users with event chats
- EventResponse (list/create/patch) needs author slug so EventCard / EventEditView / post-create navigation can build the new URL
