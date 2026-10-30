# Requirements — Public event page (Term-style)

## TL;DR
Rebuild the public event page at `/<organizer-slug>/event/<eventId>` (old `/events/:eventId` page route removed, no redirect) in Term styling: header → banner → date/place card → chat button → "Zapisani i ich rzeczy" (author first as Organizator, read-only items) → guest merge card → sticky footer CTA. Sign-up for logged-in + guests, withdraw for logged-in, EVENT chat kind (cascade on delete), OG preview, attended events listed in "Spotkania". Logic lives in `app/events` with ACLs and a batched items query.

## Key Decisions
- Architecture: events BC + `infrastructure/*_acl.py` (groups listing prefs, circulation availability, users/parties for guest profile); one batched items query with `count_queries` test
- Event-only frontend component copies in `pages/events/components/` (Term components untouched), styled via shared `uiStyles` and primitives
- Participants see attended events in "Spotkania" (new `GET /api/events/attending`)
- The 7 approved mockups in `analysis/design-context/mockups/` are binding

## Initial description (user, Polish)
"poprawka eventu — dodanie strony event na podobę terminu. Routing z slug organizatora lub losowy. Strona eventu jest zawsze publiczna. Zapis na wydarzenie. Układ strony: baner - termin - lista zapisanych i ich rzeczy (taka sekcja jak na terminie), czat eventu. Bez 'potrzebne rzeczy' - event nie ma takiej opcji (jednorazowe wydarzenie). Ma przyjmować style jak termin."

## Q&A (all rounds)
### Phase 1
- Routing: `/<organizer-slug>/event/<eventId>`, slug cosmetic (UUID id); old `/events/:eventId` page route removed, no redirect.
- Sign-up: logged-in (one click) + guests (name → anonymous profile).
- Items: read-only; no take/swap.
- Chat: "Czat wydarzenia" button → EVENT thread in Messages.
### Phase 2
- Withdraw: logged-in participant withdraws self (idempotent, sets withdrawn_at); guests cannot.
- Chat on event delete: `conversations.event_id` ON DELETE CASCADE.
- `/events/:eventId/edit` stays; back link / post-save nav go to slug URL.
- Theme: author's Organization theme if they own one, else default.
- Author first in list, labelled "Organizator", with their items; no sign-up button for author.
- Sign-up rejected (409) after ends_at (or starts_at if no end); page shows "Wydarzenie się zakończyło"; list + chat remain.
- No capacity.
- OG preview for `/<slug>/event/<id>` in `app/system/router.py`.
- Guest merge: reuse AccountMergeForm, localStorage key `guest_profile_id:event:<id>`.
- Components: event-only copies (do not parametrize Term components).
- Item click → `/<slug>/product/<id>`.
- Guest name moderated via `check_text`.
### Phase 5
- Architecture: events BC + ACLs (not reusing groups functions directly).
- Journey: create at /add/event → land on /<slug>/event/<id> → share link (OG preview); EventCard in Spotkania links to the new URL; participants also see attended events in Spotkania (`GET /api/events/attending`).
- Reuse: copies in `pages/events/components/` (EventWhenCard, EventAttendeeList, EventFooter, EventChatRow) + uiStyles, Avatar, SafeImage, ModalSheet, AuthGateSheet, AccountMergeForm, useAccountGate, useOpenAndNavigate, AddToCalendarButton.
- Visuals: approved mockups are sufficient.

## Visual assets
`analysis/design-context/INDEX.md` — screens: event-anonymous, event-participant, event-author, event-guest-signup, event-guest-merge, event-ended, event-empty; components: event-when-card, event-attendee-list, event-chat-row, event-footer.

## Functional requirements
1. Public GET of event detail (no auth) returns: event fields, banner_url, author display name + author_slug, organization theme (or null), location as public location, participants [{party_id, display_name, is_author}], item listings per participant (read-only, AVAILABLE only), attendee_count, is_author, is_attending (viewer), has_ended.
2. `POST /api/events/{id}/attendances` PUBLIC with OptionalPrincipal: logged-in → attach caller's party (idempotent); anonymous → guest name (check_text) → new party/profile; returns user_profile_id + attached_to_account. 409 after end; author can't sign up.
3. Withdraw endpoint for logged-in self (idempotent).
4. Messaging: ConversationKind.EVENT, `conversations.event_id` FK ON DELETE CASCADE, partial unique index, `POST /api/conversations/event`, access = author or active attendee (logged-in), EVENT branches in inbox/thread/title.
5. OG preview route for `/{slug}/event/{id}`.
6. `GET /api/events/attending` + Spotkania lists attended events.
7. Responses used for links (EventResponse list/create/patch) include author_slug so EventCard/EventEditView/post-create navigation build `/<slug>/event/<id>`.
8. Frontend: route `/:organizationSlug/event/:eventId` before catch-all; remove `/events/:eventId` page route; "event" in RESERVED_SLUGS; `eventPath(slug, id)`.
9. Authorization matrix rows for every new route; PUBLIC sign-up before EDIT rows.

## Reusability
Term page patterns (create_rsvp branches, ChatRow, AttendeeList, TermCard, TermFooter, useTermSignUp, useGuestMerge), `derive_organizer_slug` rule (needs party-only variant), batched listing query (`organizer_page` / `repository._exchange_candidates`), `public_term_preview` OG pattern, messaging TERM kind as template.

## Scope boundaries
Out: take/swap on events, capacity, needed items, group visualization, embedded chat, short public code, redirect from old URL, author removing participants, guest withdraw.

## Technical considerations
Migration 0071 (conversations.event_id + index). Messaging `group_id` assertions must get EVENT branches. Public payload exposes display names only. Event times naive Warsaw; "now" via `clock.local_now()`. Update exact key-set tests (`test_event_page.py`, `test_events.py`).
