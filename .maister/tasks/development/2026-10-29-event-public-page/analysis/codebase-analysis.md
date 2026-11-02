# Codebase Analysis Report

**Date**: 2026-10-29
**Task**: Public event page modelled on the public Term page (slug or random-id routing, always public, sign-up, attendees and their items, event chat)
**Description**: Poprawka eventu — dodanie publicznej strony wydarzenia (event) na wzór strony terminu (Term). Routing: slug organizatora lub losowy identyfikator. Strona eventu zawsze publiczna. Zapis na wydarzenie. Układ: baner → termin (data/godzina/miejsce) → lista zapisanych i ich rzeczy (jak na terminie) → czat eventu. Bez "potrzebne rzeczy". Style jak termin.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Pattern Mining)

---

## TL;DR
A basic public `/events/:eventId` page already exists (banner, date, place, description), but it has no attendees, items, sign-up or chat, and it doesn't use the Term page's styling. On the backend, `app/events` already has the `event_attendances` table (migration 0070). Nothing reads or writes it yet. Most of the Term page UI can be reused once its hard-coded "zajęcia" copy is turned into props. The work splits into three parts: (a) slug routing, which is cheap; (b) sign-up plus a read-only list of attendees and their items (medium); (c) event chat, which needs a messaging migration and EVENT branches across about 8 places (medium). Taking or swapping items on an event is out of scope for v1 because `Reservation.term_id` is NOT NULL.

## Key Decisions
- **Extend `app/events` rather than reuse groups/terms.** `EventAttendance` already exists. We copy the `create_rsvp` branches (logged-in vs anonymous party) without `child_count`, family or guest-merge.
- **Make the slug cosmetic, not a security boundary, as on the Term page.** The route is `/:organizationSlug/event/:eventId`, the backend loads by id, and `EventDetailResponse` gains `author_slug` (organization slug, else `k-<hash(party)>`). `/events/:eventId` stays as the "random identifier" form. A real short code would need migration 0071 plus a unique index and is optional.
- **Items are read-only in v1.** Attendees and the author each get their `ItemListingPreference` items with balance AVAILABLE, linking to item detail. Take/swap would need a circulation change (`Reservation.term_id` NOT NULL FK terms).
- **Chat is a button that navigates away, like the Term `ChatRow`, not embedded.** It reuses `/messages/:id`. It needs `ConversationKind.EVENT`, a `conversations.event_id` column and `event_access`.
- **Parametrize the Term components (`TermCard`, `AttendeeList`, `TermFooter`) instead of forking them.** Compose a slim `PublicEventView` from `uiStyles.ts` (`PAGE_SHELL`, `CARD`, `BTN_*`) and avoid the `PublicTermView` monolith.

## Open Questions / Risks
- **Routing:** must `/events/:id` keep working, redirect to the slug form, or both? "event" has to be added to `RESERVED_SLUGS` (backend `organizations/slugs.py` only has "events"; checked) and kept in sync with `router.tsx`.
- **Random identifier:** is the UUID enough, or is a short public code wanted? A short code means a migration plus a new public lookup route.
- **Anonymous sign-up:** should guests sign up the same way as on a term (party, profile and solo family with no account)? Guests can't chat because conversations are logged-in only. Is guest-merge into an account needed?
- **Withdrawal:** `delete_event` raises 409 while there are active attendees. Withdrawal is therefore required, and the author's delete UX needs a decision.
- **Organizer theme:** `OrganizerThemeScope` needs an organization theme. An event's author is a person party, so a cross-context lookup to organizations is needed (new ACL).
- **Chat blast radius:** messaging code assumes `group_id is not None` (`inbox._to_row`, `conversations._to_response`, the `Access` NamedTuple). An EVENT branch touches inbox, thread header and audience filtering, so regressions are possible across all chats.
- **N+1 risk:** the term listings path (`term_item_listings.py`) is N+1 per item. For events, use the batched pattern (`organizer_page.py` / `repository._exchange_candidates`) and assert it with `count_queries`.
- **OG preview:** `app/system/router.py` has no event route. Shared links will have no preview unless one is added.

---

## Summary

The event bounded context (`app/events`, ~700 lines) is recent and clean. It has `Event`, `EventBanner` and an unused `EventAttendance`, plus a PUBLIC `GET /api/events/{id}` detail endpoint. The public Term page provides proven patterns and reusable pieces: OptionalPrincipal RSVP, attendee/item view models, `GroupHeader`, `AttendeeList`, `TermCard`, `TermFooter`, `AuthGateSheet`, `uiStyles.ts` and the chat entry button. The main new backend work is attendance endpoints, an attendee/item read model and an EVENT conversation kind. The main frontend work is a restyled `EventPage` composed from parametrized Term components.

---

## Files Identified

### Primary Files

**src/backend/app/events/models.py**
- `Event` (l.34; `author_party_id` NOT NULL, no slug or code), `EventBanner` (l.62), `EventAttendance` (l.95, partial unique on active attendee, unused).
- Attendance becomes live. A slug/code column would only be needed for real short codes.

**src/backend/app/events/service.py**
- `create_event` l.120, `get_event`, `count_attendees` l.158, `is_author`, `update_event`, `delete_event` l.233 (409 when attendees exist), `set_event_banner` l.263.
- Add sign-up and withdraw, attendee and item listing, and author slug and theme resolution.

**src/backend/app/events/router.py** (mounted at main.py:163)
- `GET /api/events/{id}` PUBLIC with OptionalPrincipal. The other routes are author-only.
- New routes: `POST /{id}/attendances` (PUBLIC, OptionalPrincipal) and withdraw. The detail payload gains participants, listings, author_slug and theme.

**src/backend/app/events/schemas.py**
- `EventDetailResponse` gets new fields. New attendance request/response schemas (extra=forbid).

**src/backend/app/core/authorization_matrix.py**
- Events rows l.201-208 (first match wins). New PUBLIC POST rows must come before the EDIT rows.

**src/backend/app/messaging/** (models.py, application/access.py l.61/78, application/conversations.py l.56-131/175, application/inbox.py l.40-128, infrastructure/repository.py l.46-76/194/202-213, router.py, schemas.py)
- These need the EVENT kind, an `event_id` column, `event_access`, and an `infrastructure/events_acl.py`.

**src/frontend/src/pages/events/EventPage.tsx** (~188 lines)
- The current public page, built on PhoneFrame with ad-hoc styles. It gets rebuilt in the Term style.

**src/frontend/src/pages/events/eventViewState.ts**
- `resolveEventView` (loading/notFound/error/content). Extend it with isAuthor / isAttending / isActiveAttendee.

**src/frontend/src/api/events.ts**, **src/frontend/src/hooks/useEvent.ts**
- Add sign-up and withdraw API calls and mutations. Today the key `["event", eventId, token]` includes the token. Consider the `useTermAccess` stale-data pattern if data must survive a login.

**src/frontend/src/router.tsx** (10.2k)
- Add `/:organizationSlug/event/:eventId` before the catch-all and keep `/events/:eventId`.

**src/frontend/src/utils/appHelpers.ts**
- `eventPath` l.100, `eventEditPath` l.104, EDIT_PATH l.128, and `termPublicPath` l.265-270 as the model for an `eventPublicPath`.

### Related Files (reuse / reference)

- **src/backend/app/groups/application/public_view.py**: `get_public_circle_view` l.203, `get_group_access` l.349, `create_rsvp` l.408 (the sign-up branches to copy).
- **src/backend/app/groups/application/term_item_listings.py**: `_list_eligible_lister_party_ids` l.367, `_is_item_available` l.245, `_build_listing_views` l.329 (N+1).
- **src/backend/app/groups/infrastructure/repository.py**: `list_item_listing_preferences_for_parties` l.676, `_exchange_candidates`, `list_nearest_exchange_items` l.1003 (batched).
- **src/backend/app/groups/models.py**: `TermAttendance` l.255, `ItemListingPreference` l.284.
- **src/backend/app/groups/domain/organizer_slug.py**, **infrastructure/slug_resolver.py**: the slug rule.
- **src/backend/app/organizations/slugs.py**: `RESERVED_SLUGS` (add "event").
- **src/backend/app/events/infrastructure/locations_acl.py**: `LocationRefResponse` (Term uses `PublicLocationResponse` with lat/lng for the Maps link).
- **src/backend/app/circulation/models.py:278**: `Reservation.term_id` NOT NULL (the reason take/swap is out of scope).
- **src/backend/app/groups/application/chat_audience.py**, **messaging/infrastructure/groups_acl.py**: the ACL pattern.
- **src/backend/app/system/router.py**: OG meta (optional event preview).
- **src/frontend/src/pages/term/TermPage.tsx**, **views/PublicTermView.tsx** (ChatRow l.268-319): layout reference.
- **src/frontend/src/pages/term/components/** `GroupHeader.tsx`, `AttendeeList.tsx`, `termSectionTypes.ts`, `TermCard.tsx`, `TermFooter.tsx`, `TermPageSkeleton.tsx`; **modals/AuthGateSheet.tsx**; **hooks/useAccountGate.ts**, `useTermSignUp.ts`; **termViewModel.ts**.
- **src/frontend/src/theme/OrganizerThemeScope.tsx**.
- **src/frontend/src/components/shared/** `uiStyles.ts`, `ModalSheet`, `ToastPill`, `TermPlaceLine`, `AddToCalendarButton`, `Avatar`, `ConfirmDeleteDialog`.
- **src/frontend/src/api/conversations.ts** (ConversationKind l.4), `hooks/useOpenConversation.ts`, `useOpenAndNavigate.ts`, `pages/messages/ThreadPage.tsx` l.159, `InboxPage.tsx` l.52.
- **src/frontend/src/pages/meetings/TermCards.tsx:165** `EventCard`; `pages/add/EventCreateView.tsx` (copy-link targets may change).

---

## Current Functionality

`EventPage` loads `getEvent` and renders, in order: banner, "Wydarzenie" pill, title, date/time, place, description, add-to-calendar, copy-link, and author edit/delete. `attendee_count` is returned but nobody can sign up. The only listing of events is `useMyEvents`, which shows the author's own events.

### Key Components/Functions
- **get_event / EventDetailResponse**: public detail with `banner_url`, `attendee_count`, `is_author`.
- **EventAttendance**: an attendance table shaped like `TermAttendance`, without `child_count`.
- **create_rsvp (groups)**: the reference for anonymous and logged-in sign-up.
- **buildAttendees (termViewModel.ts)**: the reference for mapping attendees to `AttendeeVM`.
- **ChatRow (PublicTermView)**: opens the chat through `useOpenAndNavigate().open({kind, id})`.

### Data Flow (target)
`GET /api/events/{id}` (OptionalPrincipal) → service loads the event, banner, location (ACL), author slug/theme (organizations ACL), active attendances → lister parties (attendees + author) → `ItemListingPreference` + AVAILABLE balance (batched ACL) → `EventDetailResponse` → `useEvent` → `resolveEventView` → `eventViewModel` → `PublicEventView` (OrganizerThemeScope > GroupHeader + banner > TermCard > AttendeeList > chat button > TermFooter sign-up).

---

## Dependencies

### Imports (What This Depends On)
- parties / user profiles / families (anonymous sign-up): through ACLs
- organizations (slug, theme): new ACL
- groups `ItemListingPreference` + circulation balances (items): ACL or a neutral batched query
- locations ACL; storage (banner); `clock`; moderation `check_text`

### Consumers (What Depends On This)
- **EventPage / EventEditView / EventCard / MeetingsView / EventCreateView**: use `api/events.ts` and `useEvent`
- **messaging (new)**: `events_acl` for chat access
- **tests**: `test_events.py`, `test_event_page.py` (DETAIL_KEYS exact key set must be updated), `EventPage.test.tsx`

**Consumer Count**: about 8 files
**Impact Scope**: Medium. Events are contained, but the messaging change touches every conversation path.

---

## Test Coverage

### Test Files
- Backend: `test_events.py`, `test_event_page.py`, `test_event_banners.py`, `test_events_migration.py`, `test_public_term.py`, `test_term_attendees.py`, `test_term_item_listings_router.py`, `test_group_term_conversations.py`, `test_conversation_messages.py`, `test_messaging_cross_context.py`, `test_messaging_repository.py`, `test_messaging_migration.py`, `test_authorization_matrix.py`, `test_public_preview.py`
- Frontend: `EventPage.test.tsx`, `eventViewState.test.ts`, `eventDraft.test.ts`, `TermPage.test.tsx`, `termViewModel.test.ts`, `termViewState.test.ts`, `TermPlaceLine.test.tsx`

### Coverage Assessment
- **Test count**: good baseline around event CRUD, banner and Term flows.
- **Gaps**: no tests for event attendance, the attendee/item read model, the EVENT conversation kind, the slug route or an event view model. Needed: migration 0071 downgrade/upgrade, matrix rows, `count_queries` for listings, exact key-set updates, and an `it.each` table for the extended `resolveEventView`.

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase `.tsx` (`PublicTermView`, `AttendeeList`). View state is in `*ViewState.ts`, view models in `*ViewModel.ts`.
- **Functions**: backend snake_case services (`create_rsvp`, `list_my_events`), frontend camelCase hooks `useX`.
- **Files**: migrations `NNNN_snake.py` (next is `0071`), tests `tests/test_<feature>.py`, `src/test/<Name>.test.tsx`.

### Architecture Patterns
- **Backend**: router → service → (application) → infrastructure ACLs. No `relationship()`. Batched `IN` lookups. Polish typed errors with 404→403→409 order. `with_for_update`. One matrix row per route. Public payloads expose display names only.
- **Frontend**: API module plus a TanStack Query hook with an exported key prefix. A pure `resolve…View` with a `switch` on `view.kind`. Tailwind v4 tokens through `uiStyles.ts`. Polish copy. Accessible sheets (`ModalSheet`, `useRegisterOpenSheet`).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~25 files to touch (backend events, messaging, matrix, migration, frontend page, components, router, tests) | High |
| Dependencies | parties, profiles, families, organizations, groups listings, circulation, locations, messaging | High |
| Consumers | ~8 direct | Medium |
| Test Coverage | Good baseline, new behaviour untested | Medium |

### Overall: Complex
Each part is moderate on its own: routing is low, sign-up and read-only items are medium, chat is medium. Together they span three bounded contexts plus a migration. Splitting the work into the three increments (a/b/c) keeps each one reviewable.

---

## Key Findings

### Strengths
- The `EventAttendance` schema already exists with the right partial unique index.
- The detail endpoint is already PUBLIC with OptionalPrincipal.
- The Term UI is componentized and `uiStyles.ts` centralizes the styles.
- The messaging kind pattern (TERM) is a clear template for EVENT.

### Concerns
- Hard-coded Term copy ("zajęcia", "rodziny") in `AttendeeList`, `TermCard` and `TermFooter`.
- `PublicTermView` is a monolith. Don't replicate it.
- Messaging asserts `group_id is not None`.
- The term listing path is N+1.
- The `organizer_slug ?? "krag"` fallback pattern.

### Opportunities
- Parametrize the shared Term components (eyebrow, labels, optional `endsAt`) so both pages benefit.
- Add a batched listings query that both terms and events can use.
- Add an OG preview for events in `system/router.py`.

---

## Impact Assessment

- **Primary changes**: `app/events/{models?,schemas,service,router}.py`, new `app/events/infrastructure/*_acl.py`, `authorization_matrix.py`, `alembic/versions/0071_*.py` (conversations.event_id), messaging (kind, access, conversations, inbox, repository, router, schemas, `events_acl.py`), `organizations/slugs.py`; frontend `EventPage.tsx` (+ new `PublicEventView`, `eventViewModel.ts`, `useEventSignUp.ts`), `eventViewState.ts`, `api/events.ts`, `useEvent.ts`, `router.tsx`, `appHelpers.ts`.
- **Related changes**: `TermCard`, `AttendeeList`, `TermFooter` (props for copy), `api/conversations.ts`, `ThreadPage`, `InboxPage`, `EventCard` / `EventCreateView` copy-link targets.
- **Test updates**: new backend tests for attendance, listings, the event conversation, the migration and the matrix. Update the DETAIL_KEYS exact set. Frontend tests for EventPage, the view-state table and the view model. `TermPage.test.tsx` must keep passing after the component parametrization.

### Risk Level: Medium
The events changes are additive and well isolated. The risk is concentrated in the messaging generalization, which touches every conversation path, and in the shared Term component refactor, which could regress the Term page. Anonymous sign-up creates parties and profiles, so moderation and abuse limits deserve the same treatment as term RSVP.

---

## Recommendations (new capability on an existing module)

1. **Backend, events:** add `POST /api/events/{id}/attendances` (PUBLIC, OptionalPrincipal; logged-in uses the existing party and is idempotent; anonymous creates party + profile + solo family through ACLs; body `{guest_name}` with check_text moderation) and `POST /api/events/{id}/attendances/withdraw` (or a mine-scoped withdraw like the groups one). Extend detail with `participants[]` (display names only), `item_listings[]` (batched), `author_slug`, `organization` theme, and `is_attending`/`is_active_attendee`. Add matrix rows before the EDIT rows.
2. **Backend, messaging:** migration 0071 adds `conversations.event_id` FK, `uq_conversations_event_id WHERE kind='EVENT'` and `fk_`/`ix_` names, with a downgrade test. Add EVENT to the kind enum. `POST /api/conversations/event` get-or-create using `_insert_or_reselect`. Add `event_access` (author or active attendee) and EVENT branches in `resolve_access`, `_to_response`, `_audience_filter` and inbox labels. Relax the group asserts per kind.
3. **Frontend:** add a `/:organizationSlug/event/:eventId` route, "event" in `RESERVED_SLUGS` on both sides, and `eventPublicPath`. Build `PublicEventView` from `PAGE_SHELL`, `OrganizerThemeScope`, `GroupHeader` + banner, a parametrized `TermCard` (eyebrow "Wydarzenie", `endsAt`), a parametrized `AttendeeList`, a chat button (when `is_author || is_active_attendee`), and `TermFooter` with a label prop. Add `useEventSignUp` (gate → guest dialog / direct) without `child_count`. Leave out `NeededItemsSection`, `GroupVisualization`, RSVP family logic and guest-merge.
4. **Testing:** follow `test_public_term.py` (slug hash, display-names-only), `test_group_term_conversations.py` (chat access) and `count_queries` for listings. Update the frontend `it.each` view-state table.

---

## Next Steps

Run gap-analyzer to confirm the open questions (the `/events/:id` form vs slug, a short code or not, guest sign-up and merge, the author's delete behaviour once attendees exist, an OG preview). Then split the specification into increments (a) routing + restyle, (b) sign-up + attendees/items, (c) event chat.
