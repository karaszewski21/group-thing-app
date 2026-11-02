# Gap Analysis: Public event page modelled on the Term page

## TL;DR
Today an event has a public page at `/events/:eventId` (banner, date, place, description), but there is no way to sign up, no participant or item list, no chat, and it doesn't use the Term styling. `EventAttendance` exists in the database, but nothing writes to it or reads it (only `count_attendees` does). The work adds the following to an existing module: the slug route `/<slug>/event/<id>` (the old one goes), sign-up for logged-in users and guests, a read-only list of participants and their items, and a new EVENT conversation kind. Risk is medium. Effort is medium-high.

Two lifecycle gaps block the work if we stay silent on them:
- **No way to withdraw.** A signed-up participant can never leave, and the author can then never delete the event (it returns 409 forever).
- **The new chat FK blocks deletes.** `conversations.event_id` would stop the event's hard delete.

## Key Decisions
- **Characteristics:** modifies_existing_code, creates_new_entities, involves_data_operations and ui_heavy are true. has_reproducible_defect is false. "Poprawka" here means extending the feature; there's no crash or failure scenario.
- **Change type:** additive plus modificative. The public route is replaced, `EventDetailResponse` is extended, and the Term components get parametrized. Compatibility is "moderate". The Term page must not regress. Public `/events/:id` links break, as the user accepted.
- **Guest-to-account merge is almost free.** `merge_anonymous_profile` (`app/groups/application/account_merge.py:25`) updates the profile in place and keeps `party_id`. Event attendances therefore follow the guest automatically. Only the frontend key `guest_profile_id:<…>` and the reuse of `AccountMergeForm` need adapting.
- **Slug rule.** We reuse `derive_organizer_slug` (`groups/domain/organizer_slug.py`) and the `organizations_acl.get_own_organization(author_party_id)` pattern. The current function takes a `group_id`, so it needs a party-only variant.
- **"event" in RESERVED_SLUGS.** It's a second segment (`/:slug/event/:id`). We add it to RESERVED_SLUGS the same way "group" was added (comment at `organizations/slugs.py`). It doesn't collide functionally, but it stays consistent.

## Open Questions / Risks
- **Messaging blast radius.** `assert conversation.group_id is not None` sits at `messaging/application/access.py:88` and `inbox.py:101`. `inbox.py:63` builds labels from `group_id`. `ThreadPage.tsx:159` / `InboxPage.tsx:58` switch on kind. If EVENT is missed in any branch, the inbox crashes for every user who has an event chat.
- **Item pages require login.** `/product/:id` and `/:slug/product/:id` are behind AuthGuard. An anonymous visitor who clicks an item on the always-public event page goes to login. That matches Term, but it's worth stating.
- **Public exposure.** Participants' display names and their items become visible to anyone with the URL. Only display names should go out (as on the public Term page). There must be no party ids, emails or locations of attendees.
- **N+1.** The Term listings path (`term_item_listings.py` `_build_listing_views`) is N+1. The event path must use the batched pattern (`repository.list_item_listing_preferences_for_parties` l.676 / `_exchange_candidates`) and be asserted with `count_queries`.
- **Old links.** No catch-all 404 route exists in `router.tsx`. A removed `/events/<id>` falls to the React Router default error element, not a friendly 404.
- **Anonymous sign-ups are unthrottled.** As with Term (`create_rsvp` has no moderation check on `guardian_name`), each anonymous sign-up creates a party, a profile and a solo family. `check_text` moderation on the guest name is recommended.

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium-High (~25 files across 3 bounded contexts plus migration 0071)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: yes (EVENT conversation kind, `conversations.event_id`, attendance endpoints and read model)
- Involves data operations: yes (EventAttendance CRUD, Conversation create/read)
- UI heavy: yes

## Gaps Identified

### Missing Features
- **Sign-up endpoint.** No route writes `EventAttendance` (model docstring at `events/models.py:95`: "Nothing reads or writes it yet"). Needed: `POST /api/events/{id}/attendances`, PUBLIC with OptionalPrincipal. Logged-in is idempotent. Anonymous creates party, `UserProfile` and solo family, mirroring `groups/application/public_view.py:408` `create_rsvp` without `child_count` or visibility checks.
- **Participants and items read model.** `EventDetailResponse` only has `attendee_count`. Needed:
  - `participants[]` (display names)
  - items of attendees plus the author (`ItemListingPreference` + AVAILABLE balance, batched, cross-context to groups and circulation through an ACL)
  - `is_attending` / `is_active_attendee`
  - `author_slug` and the author's organization theme
- **Event chat.** `ConversationKind` is only ITEM/GROUP/TERM (`api/conversations.ts:4`, messaging models). Needed:
  - migration 0071 with `conversations.event_id` and a partial unique index
  - `events_acl` in messaging
  - an `event_access` rule (author or active logged-in attendee)
  - a get-or-create route
  - EVENT branches in access, conversations, inbox and repository (lines 46-76 and 202-213), plus `ThreadPage` / `InboxPage`
- **Slug route.** `/:organizationSlug/event/:eventId` doesn't exist. `eventPath()` (`utils/appHelpers.ts:100`) returns `/events/:id`.
- **Term styling.** `EventPage.tsx` uses ad-hoc styles. It should be built with `PAGE_SHELL`, `OrganizerThemeScope`, `GroupHeader`, `TermCard`, `AttendeeList`, the ChatRow pattern and `TermFooter`.

### Incomplete Features
- **`EventResponse` (list/create/patch) has no slug.** `EventCard` (`pages/meetings/TermCards.tsx:174,190`) and `EventEditView` (`:43,48`) build `eventPath(id)` from it. Once the old route is removed, all of them need the author slug. Add `author_slug` (or `public_path`) to `EventResponse`, not only to `EventDetailResponse`.
- **`useEvent` key `["event", id, token]`.** After a guest signs up or a user logs in through the gate, the data must refresh. Mutations must invalidate the `event` prefix (data-fetching standard).
- **`resolveEventView`** (`eventViewState.ts`) has to cover attending, author and ended states. It needs an `it.each` table.

### Behavioral Changes Needed
- The public route moves from `/events/:eventId` (removed, no redirect) to `/<slug>/event/<eventId>`. The slug is cosmetic and never validated, as on Term.
- `delete_event` stays 409 while there are active attendees (`service.py:233`). Without withdrawal this becomes permanent (see the critical decision).
- The shared Term components (`TermCard`, `AttendeeList`, `TermFooter`) get copy and props parameters ("Wydarzenie" eyebrow, no "zajęcia"/"rodziny" wording, no child count). Term defaults must stay byte-identical.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | `/events/:id` from `EventCard` (author's Spotkania) and copy-link | `/<slug>/event/:id` from the same places, plus Messages inbox (EVENT thread) | ✅ (old shared links break; accepted) |
| Discoverability of sign-up | 1/10 (doesn't exist) | 9/10 (primary `TermFooter` button) | +8 |
| Discoverability of chat | n/a | 8/10 ("Czat wydarzenia" row, Term ChatRow pattern) | ✅ |
| Flow Integration | Dead end for visitors (view only) | Sign up → see self in list → chat → Messages | ✅ |
| Multi-persona | Author: edit/delete. Visitor: read only | Author: edit/delete/chat. Logged-in: sign up/chat/(withdraw?). Guest: sign up/merge. Anonymous viewer: read | ⚠️ withdraw undecided |

## Data Lifecycle Analysis

### Entity: EventAttendance

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (sign up) | none (no route) | none | none | ❌ (in scope) |
| READ (list) | `count_attendees` only (`service.py:163`) | count not rendered as a list | — | ❌ (in scope) |
| UPDATE | n/a (no fields; no child_count) | n/a | n/a | n/a |
| DELETE (withdraw) | none. `withdrawn_at` column exists. `delete_event` hard-deletes rows | none | none | ❌ **not in the user's scope** |

**Completeness today**: 0%. After the planned scope: 67% (CREATE and READ), or 100% if withdraw is added.
**Orphaned operations**: CREATE without DELETE. A participant can't leave, and the author's delete is blocked by 409 forever.
**Missing touchpoints**: event withdraw button; author's EventCard (Spotkania) could show the attendee count (nice-to-have); "Moje zapisy"/meetings list for events the user signed up for. Today `useMyEvents` lists only authored events, so an attendee has no path back to the event except Messages or the link.

### Entity: Conversation (EVENT)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | new get-or-create | "Czat wydarzenia" button | author + active logged-in attendee | planned |
| READ | inbox + thread (needs EVENT branches) | `InboxPage` / `ThreadPage` | Messages nav | planned |
| DELETE | hard delete of event → FK conflict | — | — | ❌ undecided |

### Entity: participant items (read-only projection)
READ only, by design (user decision). No orphan: items are created and managed in "Moje rzeczy" (`ItemListingPreference`). Only items with a GIFT/SWAP listing preference and AVAILABLE balance are shown.

## Issues Requiring Decisions

### Critical
1. **Withdrawal ("wypisz się").** There's no withdraw today. A signed-up participant can't leave, and `delete_event` returns 409 forever once anyone signs up.
   - Options: (A) logged-in withdraw (`POST /api/events/{id}/attendances/withdraw`, mine-scoped, idempotent, sets `withdrawn_at`); guests can't withdraw, as on Term. **[recommended]** (B) A plus the author can remove participants. (C) No withdraw (accept a permanently undeletable event).
   - Recommendation: A. It's the minimal fix for the orphaned DELETE and the delete deadlock.
2. **Event deletion vs the EVENT conversation.** `delete_event` hard-deletes the row. A `conversations.event_id` FK would make delete fail as soon as the author opens the chat.
   - Options: (A) the FK uses `ON DELETE CASCADE`, so the conversation and its messages go with the event. **[recommended]** Delete is only allowed with zero active attendees anyway. (B) `ON DELETE SET NULL` and the thread stays read-only with a "(usunięte)" label. (C) Block delete when a conversation exists.
   - Recommendation: A. It keeps the events context free of a dependency on messaging. Check the message and read-marker FK cascades.

### Important
3. **Fate of `/events/:eventId/edit`.** Default: keep it as is (author-only panel route; "events" stays in RESERVED_SLUGS). Only its "back" link and post-save navigation switch to the slug URL. Alternative: move it to `/<slug>/event/:id/edit`.
4. **Theme source (`OrganizerThemeScope`).** Default: the author's own Organization theme when they own one (organizations ACL by `author_party_id`), else the default palette (`theme=null`, already supported). Alternative: always the default palette.
5. **Author in the participants list.** Default: show the author as the first row with an "Organizator" label and their shared items. The author can't sign up and sees no sign-up button. Alternative: list the author's items in a separate section, or don't show the author.
6. **Sign-up after the event.** Default: reject sign-up with 409 once the event has ended (`ends_at`, or `starts_at` if there's no end, compared with `clock.local_now()`). The page shows "Wydarzenie się zakończyło" without the button, and the list and chat stay. Alternatives: allow at any time; block from `starts_at`.
7. **Capacity.** Default: no limit in v1 (Event has no capacity field; adding one needs a migration and form changes). Alternative: add an optional `capacity`.
8. **OG link preview for `/<slug>/event/<id>`.** Default: add it to `app/system/router.py`, mirroring `public_term_preview` l.80 (title, date, banner w1600). The page exists to be shared. Alternative: defer.
9. **Guest merge UI on the event page.** The backend merge already carries event attendances along. Default: reuse `AccountMergeForm` with a `guest_profile_id:event:<id>` localStorage key, as on Term (`useGuestMerge`). Alternative: no merge UI on events in v1.
10. **Shared Term components: parametrize or fork.** Default: parametrize `TermCard`, `AttendeeList` and `TermFooter` with optional props and Term defaults. `TermPage.test.tsx` is the regression guard. Alternative: fork event-specific copies (no Term regression risk, but duplicated styling).
11. **Item link target.** Default: `/<slug>/product/<id>` (OrganizerItemLayout, organizer palette), as on Term. Anonymous viewers hit the login gate. Alternative: `/product/<id>`.
12. **Moderating guest names.** Default: run `check_text` on the guest name (Term doesn't). Alternative: parity with Term (none).

## Recommendations
- Deliver in increments. (a) Slug routing, the `author_slug` fields, the restyle and removing the old route. (b) Attendance sign-up and withdraw, the batched participants/items read model, guest merge. (c) Migration 0071 and the EVENT chat.
- Add authorization matrix rows for the new PUBLIC POST and the EDIT withdraw. They must sit before the existing events EDIT rows (`authorization_matrix.py:201-208`, first match wins).
- Update the exact key sets: `DETAIL_KEYS` in `test_event_page.py`, plus the `EventResponse` keys in `test_events.py`.
- Messaging: replace the `group_id` asserts with per-kind branches. Add EVENT tests modelled on `test_group_term_conversations.py`, and an inbox test that mixes kinds.

## Risk Assessment
- **Complexity Risk**: Medium. Three bounded contexts (events, groups listings, messaging) plus a migration.
- **Integration Risk**: Medium-high in messaging (inbox and access paths are shared by every chat). Medium for the cross-context items read.
- **Regression Risk**: Medium. The Term page through the shared components, plus all chats through the messaging changes.
