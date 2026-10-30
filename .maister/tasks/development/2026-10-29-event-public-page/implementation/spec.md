# Specification: Public event page (Term-style)

## TL;DR
Rebuild the public event page at `/<organizer-slug>/event/<eventId>` in Term styling (header → banner → date/place card → description → chat button → "Zapisani i ich rzeczy" → guest-merge / author card → sticky footer). The old `/events/:eventId` page route is removed with no redirect.
Backend logic stays in `app/events`, which gains attendance sign-up/withdraw, a batched participants+items read model, `author_slug` on every event response, `GET /api/events/attending` and an OG preview. It reads other business contexts only through new `infrastructure/*_acl.py` modules; organization lookups are batched.
Messaging gains an `EVENT` conversation kind. Migration 0071 adds `conversations.event_id` (FK `ON DELETE CASCADE`), turns the `messages`/`conversation_reads` FKs into cascades so deleting an event really cascades, and adds a partial unique index.
On the frontend, event-only components go in `pages/events/components/` (Term components are not modified), alongside a discriminated `resolveEventView` with `isStale` (the token is kept out of the query key), EVENT branches in Inbox/Thread, and attended events in Spotkania. Spec-audit decisions and fixes are applied (see "Audit amendments").

## Key Decisions
- **Cascading delete needs two more FKs.** `fk_messages_conversation_id_conversations` and `fk_conversation_reads_conversation_id_conversations` currently have no `ON DELETE` action (migration 0061). Without changing them, a cascade from `events` → `conversations` would fail as soon as a message exists. Migration 0071 recreates both with `ON DELETE CASCADE`. `app/events` never imports messaging.
- **The detail payload keeps `location` as `LocationRefResponse`, not `PublicLocationResponse`.** `EventEditView` needs `location.id`. `buildMapsUrl` only needs the address and place id. The ref already exposes no owner and no coordinates, so it satisfies the "public location" requirement.
- **Participants are nested with their items.** Each participant carries `party_id`, `display_name`, `is_author`, `is_me` and `items[]`. The server computes `is_me` because the frontend auth context has no party id, and the "To Ty" pill needs it.
- **The organizer label is the author's Organization name, else their profile display name.** It is returned as `author_display_name` and used both in the header chip and as the author row's name, matching the mockups ("Fundacja Zielony Krąg").
- **`author_slug` comes from a party-only slug rule.** The new `derive_party_slug(party_id, organization_slug)` in `groups/domain/organizer_slug.py` is reused by `derive_organizer_slug`, so an organizer's event and term URLs share one prefix.
- **Items are fetched in one statement.** The groups ACL exposes an unexecuted `ItemListingPreference` select, the circulation ACL exposes the existing `available_items_with_product_select()`, and events joins the two. Product thumbnails come from one more batched query. The query count is constant.
- **The anonymous footer is always "＋ Zapisz się na wydarzenie" (user decision, M3).** This applies on every anonymous screen, including `screen:event-empty`, whose "Zaloguj się, żeby się zapisać" copy is overridden. The CTA opens the guest sheet, and the sheet's "Masz konto? Zaloguj się" link is the only login entry. There is no "Zaloguj się" footer variant, and `AuthGateSheet`/`useAccountGate` are not used on the event page.
- **The token stays out of the `useEvent` query key (user decision, M4).** This follows `standards/frontend/data-fetching.md`. The query key is `[EVENT_KEY, eventId]`, and the `queryFn` returns `{ data, forToken }`, mirroring `useTermAccess`. A token change refetches the data. Until the new response arrives, the old data stays on screen flagged `isStale`, and `resolveEventView` takes `isStale` as an input.
- **The post-create toast is handed over through router state (user decision, M1).** `EventCreateView` calls `navigate(eventPath(…), { state: { toast } })`. `EventPage` shows the toast once on mount with its own `useToast`, then clears the history state with a `replace` navigation to the same path without state.
- **Organization lookups are batched (M5).** A new `organizations_service.get_own_organizations_by_party_ids` resolves all authors in one statement, exposed through the events `organizations_acl`. It serves create, patch, mine and attending. The detail page reuses its single author-organization lookup for both `author_slug` and the theme.
- **The ACL rule applies to business contexts (L1).** Events reaches other business contexts (users/parties/families, organizations, groups, circulation, product, locations) only through `infrastructure/*_acl.py`. Shared platform modules (`app.core`, `app.moderation`, `app.outbox`, `app.storage`) may still be imported directly, as they are today. `AVATAR_UPLOAD_DISABLED_MESSAGE` moves behind `users_acl`.
- **All user-facing copy is gender-neutral.** The merge card reads "Zapisano Cię jako gościa ✓", and the empty-state copy no longer addresses the reader with a gendered form.
- **`AccountMergeForm` gets optional `title`/`hint` props.** The defaults are the current Term copy, so the event merge card can show the mockup copy while Term behaviour stays byte-identical.
- **Guest names are moderated with the existing `TextField.PROFILE_NAME`.** No new moderation field is added.

## Open Questions / Risks
- **An expired token on sign-up is treated as anonymous (L9, accepted and documented).** It does not return 401. A caller whose token has expired falls into the guest branch, so with no `guest_name` they get 400 "Podaj swoje imię.", exactly as Term RSVP behaves. In practice the frontend clears an expired token on load, so the page renders as anonymous and opens the guest sheet.
- **Old `/events/<id>` links will show React Router's default error page.** `router.tsx` has no catch-all or `errorElement`, and the user accepted the break without a redirect.
- **The messaging change has a wide blast radius.** If any kind switch lacks an EVENT branch, the inbox breaks for every user who has an event chat. The inbox test with mixed kinds is the guard.
- **Anonymous sign-ups stay unthrottled.** Each one creates a party, a profile and a solo family. Moderation covers the name only, as on Term.
- **Withdraw stays possible after an event ends, but the UI hides it** (the ended footer replaces it). An ended event that still has attendees can't be deleted. That's accepted, because the event is historical.

## Goal
Make an event a shareable, always-public page in the Term design language. People can sign up (as a logged-in user or as a guest) and withdraw (logged-in only). The page shows who is coming and which items they share (read-only), and attendees can talk in an event chat.

## User Stories
- As an anonymous visitor with the link, I want to see the event, who is coming and what they share, and to sign up as a guest with only my name.
- As a guest who has signed up, I want to turn my guest profile into an account in place, so that I can chat and withdraw.
- As a logged-in user, I want to sign up with one click, see myself marked "To Ty", open the event chat, and withdraw if my plans change.
- As the event author, I want to share a link that has a rich preview, see participants and their items, chat with attendees, and edit or delete the event.
- As a participant, I want events I signed up for to show in Spotkania → "Biorę udział".

## Core Requirements
1. **Public detail:** `GET /api/events/{id}` (PUBLIC, OptionalPrincipal) returns the full page payload (exact keys under Technical Approach). An unresolvable or missing token never returns 401; it degrades to the anonymous view.
2. **Sign-up:** `POST /api/events/{id}/attendances` (PUBLIC, OptionalPrincipal).
   - Logged-in caller with an account-backed profile: attaches the caller's party. Idempotent.
   - Anonymous caller: needs `guest_name` (trimmed, non-blank, ≤255 characters, moderated) and creates a party, a profile and a solo family.
   - Responds 409 once the event has ended, and 409 for the author.
3. **Withdraw:** `POST /api/events/{id}/attendances/withdraw` (EDIT) sets `withdrawn_at` on the caller's active attendance. Idempotent: 204 even when there is nothing to withdraw. Responds 404 for an unknown event. Guests can't withdraw.
4. **Attended events:** `GET /api/events/attending` (READ) returns the caller's actively attended events, earliest first, as `EventResponse`.
5. **`author_slug` on every `EventResponse`** (create, patch, mine, attending, detail).
6. **EVENT chat:**
   - `POST /api/conversations/event` does get-or-create (201 when created, 200 when it already exists).
   - Access is limited to the author or an active attendee who is logged in.
   - The conversation appears in the inbox and the unread count, and has a title.
   - It is deleted with the event (cascade).
7. **OG preview** for `GET /{slug}/event/{eventId}`.
8. **Migration 0071:** adds the event conversation column and index, and makes the message/read FKs cascade.
9. **Authorization matrix rows** for every new route, in the order given below.
10. **Frontend route** `/:organizationSlug/event/:eventId`. The `/events/:eventId` page route is removed and `/events/:eventId/edit` is kept. `eventPath(slug, id)` is used at every call site, and post-create navigation lands on the event page.
11. **Event page:** composed from the components listed below with the binding mockup layout, states and copy. Items link to `/<author_slug>/product/<item_id>`.
12. **Spotkania:** the "Biorę udział" tab lists attended events (no edit pencil).
13. **Messages UI:** EVENT chip and icon in the inbox, and the "czat wydarzenia" header in the thread.
14. **Reserved slug:** "event" is added to the backend `RESERVED_SLUGS`.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Design tokens come from `src/frontend/src/index.css` `@theme` and classes from `components/shared/uiStyles.ts` (see `analysis/design-context/design-resources.md`). Fidelity: high (layout, order, copy, states).

**Page order (all screens):**
1. `GroupHeader`: back button, eyebrow "Wydarzenie", h1 = event name. The chip → `/<author_slug>` labelled `author_display_name` renders only when `organization !== null`: `organizerSlug` is passed only then, because a `k-…` fallback slug has no organizer page (L6).
2. Banner image (`mx-5`, aspect 16/7, `rounded-[22px]`, alt "Baner wydarzenia {name}"), only when `banner_url` is set.
3. `EventWhenCard`.
4. Description paragraph (`whitespace-pre-line`).
5. `EventChatRow`.
6. `EventAttendeeList`.
7. `EventGuestMergeCard` or `EventAuthorCard`.
8. `EventFooter`.

| ID | Mockup | Requirements / key elements |
|----|--------|------------------------------|
| `screen:event-anonymous` | `mockups/anonymous-visitor-view.html` | No chat. Author row first with the "Organizator" pill. Read-only item rows. Footer "＋ Zapisz się na wydarzenie" opens the guest sheet. (Req 1, 2, 11) |
| `screen:event-participant` | `mockups/signed-up-participant-view.html` | "💬 Czat wydarzenia" row. Own row carries the "To Ty" pill. Outline footer "Wypisz się" opens a confirm dialog, then withdraws. (Req 3, 6) |
| `screen:event-author` | `mockups/author-view.html` | Chat row. No footer. The "Twoje wydarzenie" card says "Możesz je edytować. Usunąć da się dopiero, gdy nikt nie jest zapisany." and has "✏️ Edytuj" (→ `/events/:id/edit`) and "Usuń" (danger; `aria-disabled` plus a count hint while `attendee_count > 0`). |
| `screen:event-guest-signup` | `mockups/guest-sign-up-sheet.html` | `ModalSheet` titled "Zapisz się na wydarzenie" with subtitle "{name} · {ddd D MMMM, HH:mm}". Field "Twoje imię" with the hint "Imię zobaczą inni na liście zapisanych." Button "Zapisz się". Footer line "Masz konto? Zaloguj się" (login with `returnTo`). Inline `role="alert"` errors. |
| `screen:event-guest-merge` | `mockups/guest-signed-up-merge-card.html` | No footer. A card with "Zapisano Cię jako gościa ✓" (gender-neutral; replaces the mockup's "Jesteś zapisana jako gość ✓") and "Załóż konto, żeby pisać na czacie wydarzenia i móc się wypisać.", followed by the email/password fields and "Załóż konto". |
| `screen:event-ended` | `mockups/ended-event-state.html` | Disabled footer "Wydarzenie się zakończyło" for every non-author viewer. The list and chat stay. |
| `screen:event-empty` | `mockups/empty-participants-state.html` | Author row always shown. Below the list, the dashed empty copy "Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany." (gender-neutral, no "rodziny"). The footer for an anonymous viewer is "＋ Zapisz się na wydarzenie": the mockup's "Zaloguj się, żeby się zapisać" is overridden by user decision M3. |
| `component:event-when-card` | anonymous-visitor-view | Copy of `TermCard`: `aria-label` "Termin wydarzenia", date badge (`dd`/`D`), eyebrow "Termin wydarzenia", full date (first letter uppercased), "godz. HH:mm–HH:mm" (no end → "godz. HH:mm"). "Miejsce" block with name, address, notes and "Otwórz w Google Maps ↗" (sr-only "(nowa karta)"). Action row: `AddToCalendarButton` and a "Kopiuj link" ghost button (toast "Skopiowano link"). No capacity. |
| `component:event-attendee-list` | anonymous-visitor-view | `aria-label` "Zapisani na wydarzenie", h2 "Zapisani i ich rzeczy". Each row: `Avatar`, name, pill "Organizator" (accent-soft) or "To Ty" (primary-soft). Items: a link per item with a 48px thumb (`SafeImage` / `PhotoPlaceholder`), product name, and a small mode label (GIFT "Weź na stałe", SWAP "Zamiana"). The first 3 items show, then "Pokaż wszystkie (n)" / "Zwiń" (`aria-expanded`). |
| `component:event-chat-row` | signed-up-participant-view | A `CHAT_BUTTON`-style full-width button "💬 Czat wydarzenia" that calls `useOpenAndNavigate().open({ kind: "EVENT", id })`. It is disabled while busy and shows errors inline with `role="alert"`. |
| `component:event-footer` | anonymous-visitor-view | Copy of `TermFooter`. Variants: `signUp` (primary "＋ Zapisz się na wydarzenie", disabled while busy), `withdraw` (outline "Wypisz się"), `ended` (disabled "Wydarzenie się zakończyło"). |

## Reusable Components

### Existing Code to Leverage
**Backend**
- `app/events/models.py` `EventAttendance` (partial unique index on active `(event_id, party_id)`), plus `Event` and `EventBanner`. The schema is unchanged. Only the `EventAttendance` docstring changes (L5): "Nothing reads or writes it yet" becomes a description of its writers (`sign_up`/`withdraw`) and readers (page, attending, messaging access).
- `app/events/service.py`: `get_event`, `get_banner`, `count_attendees`, `_get_own_event_for_update`, `delete_event` (still 409 while active attendees exist; the DB cascade removes the chat), and the Polish error pattern.
- `app/groups/application/public_view.py` `create_rsvp`: template for the logged-in vs anonymous branches (party → `UserProfile(account_user_id=None)` → `create_solo_family_for_party`, with the deferred import).
- `app/groups/application/attendance.py` `withdraw_attendance`: template for idempotent `withdrawn_at`.
- `app/groups/domain/organizer_slug.py`: the slug rule (extended with a party-only variant).
- `app/groups/infrastructure/organizations_acl.py` `public_organization` / `PublicCircleOrganization`: template for the event organization payload.
- `app/circulation/service.available_items_with_product_select()`: live AVAILABLE items with product name.
- `app/groups/infrastructure/repository._exchange_candidates`: template for joining that select with `ItemListingPreference`.
- `app/product/service.first_approved_photo_by_product`: batched thumbnails, as in `public_view._listing_thumb_urls`.
- `app/users/service.list_chat_profiles_by_party_ids`: one IN query for `(display_name, has_account)`.
- `app/moderation/text_guard.check_text` with `TextField.PROFILE_NAME`.
- `app/organizations/service.get_own_organization`.
- `app/messaging/application/conversations._insert_or_reselect`, `_participant_count` and `term_title`; the `open_term_conversation` and `term_access` shapes.
- `app/system/router.public_term_preview` and `public_preview._inject`; `clock.format_term_when`.
- `tests/conftest.py` `count_queries`, `freeze_local_now`, and the `db_session`/`client` fixtures.

**Frontend**
- `pages/term/components/GroupHeader.tsx` and `TermPageSkeleton.tsx`, used as-is.
- `pages/term/modals/AccountMergeForm.tsx` (optional `title`/`hint` props added).
- `components/shared/uiStyles.ts` (`PAGE_SHELL`, `CARD`, `BTN_PRIMARY`, `BTN_GHOST`, `FIELD`, `ERROR_TEXT`), `ModalSheet` (registers itself with `useRegisterOpenSheet`), `ConfirmDeleteDialog` (`tone="primary"` and `busyLabel` for withdraw), `Avatar`, `AddToCalendarButton`, `ToastPill`/`useToast`, `PhotoPlaceholder`.
- `pages/product/ItemGallery` `SafeImage`; `pages/product/useItemRoutes.organizerItemPath`.
- `theme/OrganizerThemeScope.tsx`; `hooks/useOpenAndNavigate.ts`; `api/groups.ts` `writeGuestProfile`/`readValidGuestProfile` (1h TTL).
- `auth/authPaths.authPath`; `lib/googleMaps.buildMapsUrl`.
- `pages/meetings/TermCards.tsx` `EventCard`; `pages/meetings/MeetingsView.tsx` (`ListedTerm`/`byDate` already handle `EventResponse`).

### New Components Required
| New | Why reuse is not possible |
|-----|---------------------------|
| `app/events/infrastructure/users_acl.py` | **The events "guest identity" facade (L2).** It is the single events module that reaches the users, party and families contexts: caller profile, display names, and guest creation (party → profile → solo family, the same three-step shape as `create_rsvp`). The existing direct `app.users.service` imports in `events/service.py` (`get_profile_by_principal`, `AVATAR_UPLOAD_DISABLED_MESSAGE`) move here. |
| `app/events/infrastructure/organizations_acl.py` | Resolves author Organizations (slug and theme), batched. The groups ACL belongs to the groups BC. |
| `organizations_service.get_own_organizations_by_party_ids` | `get_own_organization` costs two queries per party, so a list of N authors would cost 2N. The batched variant is one statement. |
| `app/events/infrastructure/groups_acl.py` | Exposes the listing-preference select and the slug rule without importing groups models into events. |
| `app/events/infrastructure/circulation_acl.py`, `product_acl.py` | Expose the available-items select and the thumbnail lookup. |
| `app/events/page.py` | The read model (participants and items) plus the per-viewer flags. Keeps `service.py` focused on commands. |
| `app/messaging/infrastructure/events_acl.py` | The single place where messaging reads events. |
| Migration `0071_event_conversations.py` | A new column and index, plus the cascade FKs. |
| `pages/events/components/EventWhenCard`, `EventAttendeeList`, `EventChatRow`, `EventFooter` | The user chose event-only copies instead of parametrizing Term components. They differ in copy, end-time range, read-only links and the role pills. |
| `pages/events/components/EventGuestSignUpSheet`, `EventGuestMergeCard`, `EventAuthorCard` | The name-only guest sheet has no Term equivalent (`RsvpDialog` asks for a child count). The other two cards are extracted from the current `EventPage.tsx` to keep the page a thin switch. |
| `pages/events/hooks/useEventSignUp.ts` | Guest sheet, guest key, one-click sign-up and withdraw-confirm state. `useTermSignUp` is tied to families and `child_count`. |
| `hooks/useAttendingEvents.ts` | Data for the Spotkania "Biorę udział" tab. |

## Technical Approach

### Backend — schemas (`app/events/schemas.py`)
- **`EventResponse`** gains `author_slug: str`. Its key set becomes `id, name, description, starts_at, ends_at, location, created_at, updated_at, author_slug`.
- **`EventDetailResponse(EventResponse)`** has exactly these keys, in addition to the base keys: `banner_url: str|None`, `attendee_count: int` (active attendees, author excluded), `is_author: bool`, `author_display_name: str`, `organization: EventOrganizationResponse|None`, `participants: list[EventParticipantResponse]`, `is_attending: bool` (the viewer's account-backed profile has an active attendance), `has_ended: bool`.
- **`EventOrganizationResponse`** has `name`, `primary_color`, `accent_color` and `palette_preset`.
- **`EventParticipantResponse`** has `party_id`, `display_name`, `is_author`, `is_me` and `items: list[EventParticipantItemResponse]`.
  - The author always comes first, with `display_name` = `author_display_name`.
  - Active attendees follow in sign-up order (`created_at`, `id`).
  - An attendee whose profile can't be resolved is skipped.
- **`EventParticipantItemResponse`** has `item_id`, `product_name`, `mode` ("GIFT"|"SWAP") and `thumb_url: str|None`. Items are only live, AVAILABLE items carrying a listing preference, ordered by product name (`COLLATE "C"`) and then item id.
- **`EventAttendanceRequest`** (`extra="forbid"`) has `guest_name: str|None = None`. It is ignored for a logged-in caller.
- **`EventAttendanceResponse`** has `id`, `event_id`, `user_profile_id` and `attached_to_account`.

### Backend — service functions
**`app/events/service.py`**
- **`sign_up(db, principal|None, event_id, guest_name)`**
  - Checks, in order:
    1. 404 when the event doesn't exist. The event is loaded `FOR SHARE` (`with_for_update(read=True)`). This blocks a concurrent `delete_event` (which holds `FOR UPDATE`) until the sign-up commits, so a sign-up racing a delete gets a clean 404 instead of an FK `IntegrityError` → 500 (L3).
    2. 409 `EVENT_ENDED_MESSAGE` = "Wydarzenie się zakończyło." when `clock.local_now() >= (ends_at or starts_at)`, via a shared `has_ended(event)`.
  - **Logged-in caller with an account-backed profile:**
    1. Responds 409 `AUTHOR_SIGN_UP_MESSAGE` = "Organizator nie zapisuje się na własne wydarzenie." when the caller is the author.
    2. If an active row already exists, returns it.
    3. Otherwise inserts inside `begin_nested`. On an `IntegrityError` from the partial unique index, it re-selects the active row (idempotent under a double click).
  - **Otherwise (anonymous):**
    1. Validates the name: blank → 400 "Podaj swoje imię."; over 255 characters → 400 "Imię może mieć najwyżej 255 znaków."
    2. Runs `check_text(PROFILE_NAME, name)`.
    3. Calls `users_acl.create_guest_profile(name)` (party, profile, solo family) and inserts the attendance.
  - Commits and returns the attendance and profile.
  - The caller is classified via `users_acl.find_caller_profile`. A missing, invalid or expired token, or a profile without an account, takes the anonymous branch with no 401, as in Term RSVP (L9, documented under Risks).
- **`withdraw(db, principal, event_id)`:** 404 for an unknown event, then the caller's profile (401 without one), then sets `withdrawn_at = datetime.utcnow()` on the active row if one exists. Commits. Idempotent.
- **`list_attending_events(db, principal)`:** a join of `Event` and the active `EventAttendance` rows for the caller's party, ordered by `starts_at` and then `id`.
- **`resolve_author_slugs(db, author_party_ids) -> dict`:** a single call to `organizations_acl.get_own_organizations_by_party_ids` (one statement, whatever the number of authors), whose results feed `groups_acl.derive_party_slug`. Used by create, patch, mine and attending (M5). The detail page does not call it: it computes `author_slug` from the author Organization it already loads for the theme.
- **Chat support for the messaging ACL:**
  - `has_active_attendance(event_id, party_id)`
  - `list_active_attendee_party_ids(event_id)`
  - `list_chat_event_ids_for_party(party_id)` (authored ∪ actively attended, one statement)
  - `list_chat_event_refs(event_ids) -> {id: (name, author_party_id)}` (one IN query)
- **`get_event_preview(db, event_id, storage)`:** returns the event, location name and banner URL for the OG route.
- `is_author`'s direct users import is replaced by `users_acl.find_caller_profile(principal)`, which returns `None` for a missing token or profile. `get_profile_by_principal` and `AVATAR_UPLOAD_DISABLED_MESSAGE` are also imported via `users_acl` (L1).

**`app/organizations/service.py`: `get_own_organizations_by_party_ids(db, party_ids) -> dict[party_id, Organization]`** (new, M5)
- One statement joining `OrganizationMembership`, `OrganizationRole` and `Organization`, filtered by `role_type == OWNER`, `valid_to IS NULL` and `party_id IN (…)`.
- Returns an empty dict for empty input, without querying.
- `get_own_organization` keeps its current behaviour.

**`app/events/page.py`: `get_event_page(db, event_id, principal|None, storage)`**
- Loads, in order:
  1. Event (404)
  2. Banner
  3. Location (`locations_acl`)
  4. Viewer profile, or `None`
  5. Author organization (one lookup, reused for `organization`, `author_display_name` and `author_slug`)
  6. Active attendances (one query)
  7. Display names for author and attendees (`users_acl.list_display_names`, one IN query)
  8. Items: one statement joining `groups_acl.item_listing_preferences_select(party_ids)` with `circulation_acl.available_items_select()`
  9. Thumbnails (`product_acl.first_approved_photo_by_product`, one query, skipped when storage is `None`)
- `attendee_count` and `is_attending` are derived from the attendance list, with no extra query.
- The query count must not grow with the number of participants or items.

**ACL modules (`app/events/infrastructure/`)**

These are the only events modules that import other **business** contexts (users/party/families, organizations, groups, circulation, product, locations), and they must not import `..schemas`. Shared platform modules (`app.core`, `app.moderation`, `app.outbox`, `app.storage`) stay direct imports, as today (L1).

| Module | Exposes |
|--------|---------|
| `users_acl` | **Guest identity facade (L2)** spanning users, party and families: `find_caller_profile`, `get_caller_profile`, `list_display_names(party_ids) -> {party_id: (name, has_account)}`, `create_guest_profile(name)` (party → profile → solo family, deferred families import as in `create_rsvp`), and the re-exported `AVATAR_UPLOAD_DISABLED_MESSAGE` |
| `organizations_acl` | `get_own_organization(party_id)` (detail page), `get_own_organizations_by_party_ids(party_ids)` (lists) |
| `groups_acl` | `item_listing_preferences_select(party_ids)` (new unexecuted select `(item_id, owner_party_id, mode)` in the groups repository, re-exported from `app.groups.service`); `derive_party_slug` |
| `circulation_acl` | `available_items_select()`, wrapping `circulation_service.available_items_with_product_select` |
| `product_acl` | `first_approved_photo_by_product` |
| `locations_acl` | Existing, unchanged |

**Groups domain:** `derive_party_slug(party_id, organization_slug)` returns the org slug or `_fallback_organizer_slug(f"party:{party_id}")`. `derive_organizer_slug` delegates to it for the party case, with identical output.

### Backend — routes (`app/events/router.py`)

Literal paths are declared before `/{event_id}`.

| Method & path | Auth | Response |
|---------------|------|----------|
| `GET /api/events/attending` | ReadPrincipal | `list[EventResponse]`; locations batched |
| `GET /api/events/{id}` | OptionalPrincipal | `EventDetailResponse` via `page.get_event_page` |
| `POST /api/events/{id}/attendances` | OptionalPrincipal | 201 `EventAttendanceResponse` (also when idempotent) |
| `POST /api/events/{id}/attendances/withdraw` | EditPrincipal | 204 |
| Existing create / patch / mine | unchanged | `EventResponse` now carries `author_slug` |

### Authorization matrix (`app/core/authorization_matrix.py`, events block, first match wins)
1. `GET ^/api/events/(mine|attending)$` → READ, mcp:read. Replaces the `/mine` row and must stay above the PUBLIC detail row.
2. `GET ^/api/events/[^/]+$` → PUBLIC
3. `POST ^/api/events/[^/]+/attendances$` → PUBLIC. Sits before the EDIT rows and is anchored so withdraw never matches it.
4. `POST ^/api/events/[^/]+/attendances/withdraw$` → EDIT, mcp:edit
5. The existing PATCH/DELETE, `POST /api/events` and banner rows, unchanged.

`POST /api/conversations/event` is covered by row 54 (EDIT). Update its comment to list `/event`. The OG route is covered by row 10.

### Migration `alembic/versions/0071_event_conversations.py` (revises 0070)
- **Upgrade:**
  1. Add nullable `conversations.event_id` UUID.
  2. Add FK `fk_conversations_event_id_events` → `events.id` with `ON DELETE CASCADE`.
  3. Add partial unique index `uq_conversations_event_id` on `(event_id)` `WHERE kind = 'EVENT'`.
  4. Add plain index `ix_conversations_event_id` on `(event_id)`. The partial index can't serve the FK cascade lookup from `events` (L4), so this one does; the same pattern already exists as `ix_conversations_group_id`.
  5. Drop and recreate `fk_messages_conversation_id_conversations` and `fk_conversation_reads_conversation_id_conversations` with `ON DELETE CASCADE`.
- **Downgrade**, in reverse order:
  1. `DELETE FROM conversations WHERE kind = 'EVENT'` (the cascades are still active, so messages and reads go too).
  2. Recreate the two FKs without an `ON DELETE` action.
  3. Drop both indexes (`ix_conversations_event_id`, `uq_conversations_event_id`), then the FK, then the column.
- `kind` stays `String(10)`, and "EVENT" fits.
- **Existing migration test (M2):** `tests/test_messaging_migration.py` asserts the exact conversation FK set after `upgrade head`. `CONVERSATION_FKS` must gain `"fk_conversations_event_id_events": ("event_id", "events")`, giving 6 FKs.
- The ORM models must match: `Conversation.event_id` (`ondelete="CASCADE"`) and both new `Index` entries, plus `ondelete="CASCADE"` on `Message.conversation_id` and `ConversationRead.conversation_id`.

### Messaging — every file that switches on kind
| File | Change |
|------|--------|
| `messaging/models.py` | `ConversationKind.EVENT`; `event_id` column and index; docstring |
| `messaging/infrastructure/events_acl.py` (new) | Re-exports `Event`, `get_event`, `has_active_attendance`, `list_active_attendee_party_ids`, `list_chat_event_ids_for_party`, `list_chat_event_refs` from `app.events.service` |
| `messaging/application/access.py` | `Access` gains `event: events_acl.Event | None = None` (a default, so existing constructions are unchanged); new `event_access` (author or active attendee, else 403; `read_only_reason=None`; `organizer_party_id=author_party_id`); `resolve_access` gets explicit TERM and EVENT branches instead of the fall-through `assert term_id` |
| `messaging/application/conversations.py` | `open_event_conversation` (get event → 404, `event_access`, find/insert via `_insert_or_reselect`); `_to_response` gets an EVENT branch before the group assert: `title` = event name, `group_name`/`term_occurs_on` null, `participant_count` = account-backed author and active attendees |
| `messaging/application/inbox.py` | `list_inbox`/`count_unread` pass `event_ids` from `events_acl.list_chat_event_ids_for_party`; `_Labels.event_refs`; `_to_row` EVENT branch (title = name, organizer = author, reason `None`); docstring statement count updated |
| `messaging/infrastructure/repository.py` | `find_event_conversation`; `_audience_filter`, `select_inbox_rows` and `sum_unread` take `event_ids` with a `kind = EVENT AND event_id IN (…)` clause |
| `messaging/schemas.py` | `OpenEventConversationRequest{event_id}`; docstrings |
| `messaging/router.py` | `POST /event` (201 when created, 200 when it exists, via `_respond`) |
| `messaging/service.py` | Re-export `open_event_conversation` |
| `messaging/application/messages.py` | No code change; `sender_is_organizer` follows `access.organizer_party_id` (the author) |

A withdrawn attendee loses access (403), and the thread drops out of their inbox, as with TERM.

### OG preview
- **Route:** `app/system/router.py` gets `GET /{organization_slug}/event/{event_id}`, placed before `/{organization_slug}`.
- **Guard (L10):** when `organization_slug` is in `RESERVED_SLUGS` or contains a dot, the route delegates to `spa_fallback(full path)`, the same as `public_organization_preview`. A path like `/api/event/<id>` therefore keeps its real 404 JSON.
- An invalid UUID or an unknown event returns the plain index.
- **Meta tags:** `render_public_event_meta` in `public_preview.py` produces:
  - title = event name
  - description = `clock.format_term_when(starts_at)` plus ` · {place name}` when there is a place, plus ` {description}` when there is one
  - `og:image` = the banner's w1600 public URL when storage and a banner exist

### Other backend
- `app/organizations/slugs.py`: add "event" to the second-segment group.

### Frontend
**`api/events.ts`**
- Adds `author_slug` to `EventResponse`, plus `EventDetailResponse` fields mirroring the backend keys.
- New types: `EventOrganization` (extends `OrganizerTheme` with `name`), `EventParticipant`, `EventParticipantItem` (`mode: ListingMode`), `EventAttendanceResponse`.
- New functions: `signUpForEvent(eventId, { guest_name })`, `withdrawFromEvent(eventId)`, `getAttendingEvents()`, `eventGuestProfileKey(eventId)` → `guest_profile_id:event:<id>`.

**`api/conversations.ts` and `hooks/useOpenConversation.ts`**
- `ConversationKind` adds "EVENT".
- New `getOrCreateEventConversation(eventId)`.
- Comments updated from "GROUP and TERM" to "GROUP, TERM and EVENT".
- `GET_OR_CREATE.EVENT` added.

**Hooks**
- **`hooks/useEvent.ts`** follows the `useTermAccess` `forToken`/`isStale` pattern (M4, data-fetching standard):
  - Query key: `[EVENT_KEY, eventId]`. The token is no longer part of the key.
  - The `queryFn` returns `{ data, forToken: token }`.
  - A `useRef`/`useEffect` on the token triggers a refetch when the token changes.
  - Returns `isStale` (`forToken !== token` while no newer response has arrived) and keeps the data on a failed refresh (`refreshError`).
  - Adds `signUp(guestName | null)` and `withdraw()`, which pass errors through `extractProblemMessage`.
  - `signUp` awaits invalidation of `[EVENT_KEY]`, `[MY_EVENTS_KEY]` and `[ATTENDING_EVENTS_KEY]`. `withdraw` also invalidates `CONVERSATIONS_KEY` (L7), because the EVENT thread leaves the inbox.
  - `EventEditView` treats `isStale` like `loading`.
- New `hooks/useAttendingEvents.ts`: key `[ATTENDING_EVENTS_KEY = "attendingEvents", token]`, enabled when logged in, with the app-shaped return and a stable empty fallback.

**`utils/appHelpers.ts`**
- `eventPath(organizerSlug, eventId)` → `/${slug}/event/${id}`. `eventEditPath`/`EDIT_PATH` are unchanged.
- Call sites:
  - `pages/meetings/TermCards.tsx` `EventCard`: the link and the copy link use `event.author_slug`.
  - `pages/events/EventEditView.tsx`: the back link and post-save navigation use `event.author_slug`, falling back to `viewPath("meetings")` while loading.
  - `pages/events/EventPage.tsx`: copy link.
  - `pages/add/EventCreateView.tsx` `finish()`: calls `navigate(eventPath(event.author_slug, event.id), { state: { toast: savedToast(event) } })` instead of going to `/add` with `useAppData().showToast`. That toast lives in the `AppDataProvider`, which the event route doesn't mount (M1). This also covers banner-skip.

**`router.tsx`**
- Remove the `/events/:eventId` page route.
- Add `{ path: "/:organizationSlug/event/:eventId", element: <EventPage/> }` next to the term route (no AuthGuard).
- Keep `/events/:eventId/edit`.
- Update the comments ("event" is in `RESERVED_SLUGS`).

**`pages/events/eventViewState.ts` `resolveEventView`**
- Pure function. Input: `data`, `loading`, `notFound`, `error`, `isStale`, `isLoggedIn`, `guestProfileId`.
- Union:
  - `loading`
  - `notFound`
  - `error{message}`
  - `refreshing{event, error}`: data is shown but was fetched for a different token (in-page merge/login, or logout). It renders the read-only sections only: header, banner, when-card, description and attendee list. There is no chat row, footer, author card or merge card, so a logged-out viewer never sees edit/delete and a freshly merged guest never sees a stale sign-up footer. A failed refresh shows its `error` inline with a retry.
  - `author{event}`
  - `attendee{event, ended}` (`is_attending`)
  - `guestAttendee{event, guestProfileId}` (not logged in and a valid guest key)
  - `visitor{event, ended, isLoggedIn}`
- Rules: 404 wins; `isStale` with data → `refreshing`; otherwise existing data survives a refresh error.
- Exported `EventContentView = Extract<…, { event }>`.

**`pages/events/EventPage.tsx`**
- Thin route element that switches on `view.kind`:
  - `loading` → `TermPageSkeleton`
  - `notFound` → "Nie znaleziono wydarzenia."
  - `error` → the existing message and retry
  - content views → `OrganizerThemeScope theme={event.organization}` with `PAGE_SHELL` and the page order above
- It owns `useEvent`, `useToast` and `useEventSignUp`, and passes callbacks down as props.
- **Post-create toast (M1):** on mount, if `location.state?.toast` is a string, it calls `showToast` once, then clears the history state with `navigate(location.pathname, { replace: true, state: null })`, so a refresh or back navigation doesn't repeat it.
- Delete success navigates to `viewPath("meetings")`.

**`pages/events/hooks/useEventSignUp.ts`**
- `guestProfileId` state is seeded from `readValidGuestProfile(eventGuestProfileKey(id))` when not logged in.
- `openSignUp`: logged-in → `signUp(null)` with toast "Zapisano na wydarzenie"; anonymous → open the guest sheet.
- `submitGuest(name)`: client-side blank check "Podaj swoje imię." Server errors are shown inline. On success: `writeGuestProfile`, set state, close the sheet, toast.
- Withdraw-confirm state: `ConfirmDeleteDialog` with title "Wypisać się z wydarzenia?", body "Znikniesz z listy zapisanych i stracisz dostęp do czatu wydarzenia.", confirm label "Wypisz się", `tone="primary"`, busyLabel "Wypisywanie…". On success, toast "Wypisano z wydarzenia".

**Components in `pages/events/components/`**
- `EventWhenCard`, `EventAttendeeList`, `EventChatRow`, `EventFooter`, `EventGuestSignUpSheet`, `EventGuestMergeCard` and `EventAuthorCard`, as described in Visual Design.
- `EventChatRow` renders for `author`/`attendee`.
- `EventFooter`:
  - `visitor`: `signUp`, or `ended` once the event has ended
  - `attendee`: `withdraw`, or `ended` once the event has ended
  - `author`, `guestAttendee` and `refreshing`: nothing
  - There is no "Zaloguj się" variant (M3). The anonymous `signUp` label is always "＋ Zapisz się na wydarzenie" and opens the guest sheet, whose "Masz konto? Zaloguj się" link is the only login entry.
- `EventAuthorCard` keeps the existing delete flow and count hint ("Nie można usunąć — zapisał… się już N osób.").
- `EventGuestSignUpSheet` input: `FIELD`, `aria-invalid`/`aria-describedby`, Enter submits the form, and every inner button is `type="button"` except submit.

**Other frontend changes**
- `pages/term/modals/AccountMergeForm.tsx`: optional `title`/`hint` props, defaulting to the current copy.
- `pages/meetings/MeetingsView.tsx`: "Biorę udział" merges `useAttendingEvents().data` into `attending`, which is sorted with `byDate` and renders `EventCard` with `editable={false}`. `EventCard` gains `editable?: boolean` (default `true`) that hides the pencil. The tab's empty copy (`MeetingsView.tsx:197`, "Nie masz jeszcze zapisów na zajęcia.") becomes "Nie masz jeszcze żadnych zapisów." so that it also covers events (L8).
- `pages/events/components/EventGuestMergeCard.tsx` passes the gender-neutral `title` "Zapisano Cię jako gościa ✓" and the `hint` "Załóż konto, żeby pisać na czacie wydarzenia i móc się wypisać." to `AccountMergeForm`.
- `pages/messages/InboxPage.tsx`: `KIND_CHIP.EVENT` `{ label: "Wydarzenie", className: "bg-accent-soft text-accent-fg" }`; `LeadingVisual` EVENT → `RoundIcon` with "🎉".
- `pages/messages/ThreadPage.tsx`: the header suffix comes from a label map (TERM "czat terminu", GROUP "czat grupy", EVENT "czat wydarzenia").

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and updated tests, not the entire suite.
- Backend runs with `uv run python -m pytest` from `src/backend`, against a real Postgres via testcontainers. Dates come from `freeze_local_now`. Response shapes use exact key-set assertions. Names follow `test_<operation>_<scenario>_<expected>`.

**Backend**
- `tests/test_event_attendance.py` (new):
  - logged-in sign-up is idempotent (201)
  - guest sign-up creates a profile with `attached_to_account=false`, and a blank name gives 400
  - sign-up after the end gives 409
  - author sign-up gives 409
  - withdraw is idempotent (204), and signing up again works
  - withdraw without a token gives 401
  - `GET /attending` lists only active attendances, ordered
- `tests/test_event_page.py` (update `DETAIL_KEYS`):
  - author first, then `is_me`/`is_author`
  - only AVAILABLE listed items appear
  - anonymous request works with no 401
  - `has_ended` is correct
  - `count_queries` is equal for 1 vs 5 participants with items
- `tests/test_events.py` (update `EVENT_KEYS`):
  - `author_slug` is the org slug when the author owns an Organization, else `k-…`, and equals the term-page slug for the same party.
  - `count_queries` on `GET /api/events/attending` is equal for events by 1 vs 3 distinct authors (M5).
- `tests/test_event_conversations.py` (new):
  - open returns 201, then 200
  - access for the author and an active attendee; withdrawn attendee gets 403; anonymous gets 401
  - the inbox with mixed kinds shows the EVENT title and unread count
  - deleting the event (after withdrawals) cascades the conversation, messages and reads
- `tests/test_event_conversations_migration.py` (new):
  - downgrade to 0070, then upgrade to head
  - a duplicate EVENT conversation violates `uq_conversations_event_id`
- `tests/test_messaging_migration.py` (update, M2): add `fk_conversations_event_id_events` to `CONVERSATION_FKS` (6 FKs).
- `tests/test_authorization_matrix.py`:
  - cover the new rows: `/api/events/attending` is READ, attendances are PUBLIC, withdraw is EDIT
  - add `POST /api/conversations/event` → EDIT to the conversations cases (L8)
- `tests/test_public_preview.py`:
  - the event preview contains the title and `og:image`
  - an invalid UUID returns the plain index
  - a reserved first segment (`/api/event/<uuid>`) is not served by the preview (L10)

**Frontend**

Vitest with `renderWithProviders` and `createQueryWrapper`, typed fixtures (no `as` casts; add `author_slug` to every event fixture), and `vi.useFakeTimers({ toFake: ["Date"] })` where dates matter.
- `src/test/eventViewState.test.ts`: an `it.each` table covering every kind plus these rows (M4):
  - in-page merge/login: data fetched anonymously, now logged in, `isStale` → `refreshing`
  - logout: author data, now logged out, `isStale` → `refreshing` (no author controls)
  - stale with a refresh error → `refreshing` with the error
  - non-stale refresh error keeps the content view
- `src/test/EventPage.test.tsx` (rewritten for the `/:slug/event/:id` route):
  - anonymous page order, and the "＋ Zapisz się na wydarzenie" footer, including the empty state
  - guest sheet; success writes the key and shows the merge card with "Zapisano Cię jako gościa ✓"
  - the post-create toast from router state is shown once
  - the header chip is shown only when an organization exists
  - attendee chat and "Wypisz się" confirm
  - author card, with no footer
  - ended footer is disabled
  - empty copy
- `src/test/InboxPage.test.tsx` and `ThreadPage.test.tsx`: EVENT chip and header.
- `src/test/useOpenConversation.test.tsx`: EVENT posts to `/conversations/event`.
- `src/test/AppPage.test.tsx`:
  - update the event `href`s and the routes (`/:slug/event/:id`)
  - attended events appear under "Biorę udział", and the empty copy is now "Nie masz jeszcze żadnych zapisów."
  - **rewrite the create-flow tests** (around lines 2928–2948 and 2983, M1). They currently assert landing on `/add` with the toast. They must now assert navigation to `/<slug>/event/<id>` with `state.toast`, mounting a stub event route that renders the router state.
- `src/test/useEvent` coverage (in `EventPage.test.tsx` or a new `useEvent.test.tsx`): a token change keeps the data flagged `isStale` until the refetch, and `withdraw` invalidates the conversations key.

### Standards Compliance
- `standards/backend/models.md`: no `relationship()`; cross-context access only through the `infrastructure/*_acl.py` modules; batched `IN` lookups; 404 before 403; business-key equality is unchanged.
- `standards/backend/queries.md`: one join for items; `count_queries` proves there is no N+1; SQL-level ordering.
- `standards/backend/migrations.md`: reversible 0071 with explicit `fk_`/`uq_` names; downgrade runs in reverse dependency order; a downgrade-then-upgrade test.
- `standards/backend/security.md`: one matrix row per route, first match wins, enforced through `require_any` (or no dependency for PUBLIC); public payload exposes display names only.
- `standards/backend/time.md`: `clock.local_now()` for "now" and ending; naive-UTC `withdrawn_at`; `format_term_when` in the OG text.
- `standards/backend/api.md`: plural resources, limited nesting.
- `standards/global/error-handling.md`, `validation.md` and `minimal-implementation.md`: typed Polish errors; server-side validation; no speculative fields.
- `standards/frontend/components.md`: the `resolveEventView` discriminated union in a separate `*ViewState.ts`, a `switch` on `view.kind`, `Extract` sub-unions, and state flows kept in a dedicated hook.
- `standards/frontend/data-fetching.md`: TanStack hooks; the token kept out of the `useEvent` key (`forToken`/`isStale`); awaited prefix invalidation (including the conversations key on withdraw); a stable empty fallback; and mutation callbacks passed as props.
- `standards/frontend/accessibility.md`: `ModalSheet`; Enter `preventDefault` only where needed; `aria-disabled` plus hint on blocked delete; `aria-expanded` on "Pokaż wszystkie"; sr-only spacing.
- `standards/frontend/css.md` and `responsive.md`: tokens and `uiStyles` classes only; mobile-first.
- `standards/testing/backend-testing.md` and `frontend-testing.md`: as above.

## Audit amendments
Applied from `verification/spec-audit.md` and the user decisions that followed it.

| ID | Change |
|----|--------|
| M1 | The post-create toast is handed over via `navigate(path, { state: { toast } })`. `EventPage` shows it once with its own `useToast`, then clears the history state. The AppPage create-flow tests (~2928–2948, 2983) are rewritten. |
| M2 | `tests/test_messaging_migration.py` `CONVERSATION_FKS` gains `fk_conversations_event_id_events` (6 FKs). |
| M3 | The anonymous footer is always "＋ Zapisz się na wydarzenie" and opens the guest sheet; the sheet's login link is the only login entry. The empty-state mockup's "Zaloguj się" copy is overridden, and no login footer variant exists. |
| M4 | The `useEvent` token is moved out of the query key and replaced by a `forToken`/`isStale` pattern. `resolveEventView` gains `isStale` and a read-only `refreshing` view, with `it.each` rows for merge/login and logout. The `placeholderData` decision is removed. |
| M5 | Batched `organizations_service.get_own_organizations_by_party_ids` is exposed via the events `organizations_acl`, with a `count_queries` test for `/attending` (1 vs 3 authors). The detail page reuses its author-organization lookup for `author_slug`. |
| Copy | Gender-neutral copy everywhere: "Zapisano Cię jako gościa ✓"; "Zapisz się jako pierwsza osoba…"; Spotkania empty copy "Nie masz jeszcze żadnych zapisów." |
| L1 | The ACL rule is scoped to business contexts; platform modules stay direct. `AVATAR_UPLOAD_DISABLED_MESSAGE` moves behind `users_acl`. |
| L2 | `users_acl` is documented as the events "guest identity" facade over users, party and families. |
| L3 | `sign_up` loads the event `FOR SHARE`, so a sign-up racing a delete gets a 404 rather than an FK error → 500. |
| L4 | Plain `ix_conversations_event_id` added for the FK cascade lookup. |
| L5 | The `EventAttendance` docstring is updated to describe its readers and writers. |
| L6 | `organizerSlug` (the header chip) is passed only when `organization !== null`. |
| L7 | `withdraw` also invalidates `CONVERSATIONS_KEY`. |
| L8 | The `MeetingsView.tsx:197` empty copy is neutralised to cover events; `/api/conversations/event` is added to `test_authorization_matrix.py`. |
| L9 | Accepted: an expired or invalid token on sign-up takes the anonymous branch (400 without a name). Documented under Risks. |
| L10 | The OG route guards `RESERVED_SLUGS` and dotted segments by delegating to `spa_fallback`. |

## Out of Scope
- Take/swap on events (`Reservation.term_id` is NOT NULL).
- Capacity.
- Needed items.
- Group visualization.
- Embedded chat.
- A short public code.
- A redirect from `/events/:id`.
- A catch-all 404 route.
- The author removing participants.
- Guest withdraw.
- Moving `/events/:id/edit` under the slug.
- Parametrizing Term components (other than `AccountMergeForm`'s copy props).
- Rate-limiting anonymous sign-ups.
- Clearing the guest key after a merge.
- An event link inside the chat thread header.

## Success Criteria
- `/<slug>/event/<id>` renders all 7 binding screens with their copy and order. `/events/<id>` no longer matches a page route.
- Guest sign-up, merge to an account, logged-in sign-up and withdraw all work end-to-end. Sign-up after the end returns 409, and the author can't sign up.
- The detail endpoint's query count is independent of how many participants and items there are, asserted with `count_queries`.
- The EVENT chat opens for the author and active attendees only, appears in the inbox and unread count, and deleting an event removes its conversation, messages and read markers.
- Migration 0071 upgrades and downgrades cleanly.
- Every `EventResponse` carries `author_slug`, and every event link in the app uses the slug URL.
- Shared links produce an OG preview with title, date and banner.
- Attended events appear in Spotkania → "Biorę udział".
- Existing Term pages and their tests are unchanged and pass. All new and updated tests pass, along with `mypy` and `ruff` (no new errors over the baseline) and `tsc`.
