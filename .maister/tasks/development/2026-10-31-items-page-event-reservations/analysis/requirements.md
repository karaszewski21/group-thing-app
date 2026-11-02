# Requirements

## TL;DR
The feature has four parts:
- A public owner items page at `/<org-slug>/items` and `/<party-id>/items`, with the owner's nearest public date or a chat-only state.
- A shared "Zapisani i ich rzeczy" preview on the event and term pages: the 3 newest items plus "Pokaż więcej" leading to the owner items page.
- A public item page with context actions (Weź / Zamienię / Napisz) driven by `?term`/`?event`.
- Full item reservation on events (take and swap), plus a "recently added items" block on the organizer page, in the Giełda layout only.

## Key Decisions
- The item page is public for ACTIVE items, and actions go through the account gate.
- Chat uses the per-item ITEM conversation.
- The nearest date comes from terms in PUBLIC circles that the owner leads or attends, and from events the owner authored or attends.
- Event reservations are gated on `starts_at`. Withdrawing does not cancel a reservation. Deleting the event cancels its reservations and notifies people.
- The term-end confirmation scan is extended to events.
- Item cards on the owner page carry the nearest `?term`/`?event`.
- A viewer who is not eligible sees "Zapisz się" and "Napisz".
- "Pokaż więcej" leads to `/<owner>/items` with the context.
- The inline take buttons on the term page stay.
- Editing `starts_at` is allowed.
- The person URL uses the party id. An org owner's party-id URL redirects to `/<slug>/items`.
- Existing notification kinds are reused for take, swap and confirmation. Only `RESERVATION_CANCELLED` is added, for cancellations caused by event deletion (gate decision).
- `ReservationContext` (Term | Event) lives in groups. New routes are `POST /api/events/{id}/items/{item_id}/take|propose`. A new public endpoint is `GET /api/items/{id}/actions?term=|event=`.
- The organizer page gets a new "recently added items" block only in the Giełda (EXCHANGE) layout for now.

## Open Questions / Risks
- "Na tą chwilę Giełda" is read as: add the new block only to the EXCHANGE layout and keep the existing exchange board there. The spec should state where the block sits relative to ExchangeBoardBlock.

## Initial description (user, Polish)
1) nowa strona listy rzeczy, potrzebna do przeglądu rzeczy user/organizatora. Jeżeli user /id-user/items, organizator /slug-organizacji/items. Na stronie rzeczy podajemy też najbliższy termin właściciela, gdzie może dojść do odbioru/wymiany. Jeżeli osoba nie ma żadnych przyszłych terminów — tylko można napisać na chat.
2) Strona wydarzenia i terminu — Zapisani i ich rzeczy — 3 pierwsze dodane ostatnio, Pokaż więcej, link do strony rzeczy. Do strony rzeczy dodajemy params ?term=id-terminu, ?event=id-event i pokazujemy buttony weź, zamienię w celu rezerwacji przedmiotu, oraz też napisz — czat.
3) implementujemy możliwość rezerwacji przedmiotu na evencie.

## Q&A (all rounds)

### Phase 1
- Item page for anonymous visitors → public for ACTIVE listed items. Take, swap and chat trigger `useAccountGate`.
- Chat-only → the existing per-item ITEM conversation.
- Nearest owner date → terms (led or attended) plus events (authored or attended).
- Event reservation timing → like terms: reserve until `starts_at`, then confirm or cancel after `starts_at`. Withdrawing does not cancel.

### Phase 2
- Event deletion with open reservations → cancel them (swap-locked items released) and notify both sides.
- Hand-over prompt → extend `term_end_scan` to events past `starts_at`. Reuse TERM_CONFIRMATION_NEEDED with event wording and link, add an idempotency marker, and teach `pendingActions.ts` to read `/event/` links.
- Nearest-date privacy → PUBLIC, non-deleted circles plus events only.
- Items-page context → option A: cards carry the owner's nearest `?term=`/`?event=`. Without an upcoming date there is no param and chat only. A stale context shows "odbyło się" with a hint about the next date.
- Ineligible viewer → hide Weź/Zamienię. Show "Zapisz się" (a link to the term or event page) and "Napisz".
- "Pokaż więcej" → `/<owner>/items?event=|term=`, using one shared preview component on both pages.
- Inline term take buttons → keep them. Item names link with `?term=`.
- Editing event `starts_at` with open reservations → allowed.
- `/<user-id>/items` → party id. Add UUID detection and a guard against UUID-shaped org slugs.
- Notifications → existing kinds, with event wording and `link_path`. Gate amendment: only `RESERVATION_CANCELLED` is added, for event-deletion cancellations.
- An org owner's party-id URL → redirect to `/<slug>/items`.

### Phase 5
- Architecture → `ReservationContext` (Term | Event) in groups, with event data via a groups `events_acl`.
- API → `POST /api/events/{event_id}/items/{item_id}/take` and `/propose`. Term routes unchanged.
- Item page data → new `GET /api/items/{item_id}/actions?term=|event=` (OptionalPrincipal). It returns mode, owner, the resolved context, viewer state and the owner's nearest public date.
- Entry points to `/<owner>/items` →
  - "Pokaż więcej" on the event and term pages,
  - "Zobacz wszystkie rzeczy" on the item page,
  - a new organizer-page block "Ostatnio dodane rzeczy" (a few newest items plus "Zobacz więcej" → `/<slug>/items`), mirroring the terms block → `/<slug>/terms`. For now it goes only in the Giełda (EXCHANGE) layout.
  - It is not added to the menu.
- List → ACTIVE + AVAILABLE only, newest first, pages of 20 with "Pokaż więcej", and an Wszystkie/Oddam/Zamienię filter as in the mockup.
- Item routes → keep the existing `/product/:id` and `/:slug/product/:id` (`organizerItemPath`) and add a context param. Drop AuthGuard for ACTIVE items.
- Visual assets → the approved Phase 4 mockups are binding. Reuse:
  - OrganizerTermsPage / AgendaResults (list),
  - ExchangeItemCard (card),
  - NextTermCtaBlock (nearest date),
  - useItemTake / SwapProposeDialog / AuthGateSheet (reservation),
  - AskAboutItemButton (chat).

## Similar features identified
- `/:organizationSlug/terms` → OrganizerTermsPage, `list_organizer_terms` (pagination, Cache-Control, ≤5 statements).
- `events/page.py::_listed_items_by_party` → a single-join listed-items query (to be ordered by `ItemListingPreference.created_at DESC`, with a per-party cap via `row_number()` and a total count).
- `groups/application/term_item_listings.py` → take, propose, accept, reject, confirm, cancel.
- `groups/application/term_end_scan.py` → end-of-term confirmation prompts.
- `pages/term/hooks/useItemTake.ts` with `SwapProposeDialog`, `TakeSuccessSheet`, `AuthGateSheet`, `useAccountGate`.
- `EventAttendeeList.tsx` and `AttendeeList.tsx` → near-duplicate 3-item toggles, to become one shared preview.

## Visual assets
`analysis/design-context/INDEX.md` lists 11 screens and 2 components (HTML mockups in `analysis/design-context/mockups/`).

## Functional requirements summary
1. Owner items page:
   - routes `/:organizationSlug/items` and `/:partyId/items` (UUID),
   - public endpoint(s) with pagination and mode filter,
   - a nearest-public-date card or a chat-only notice,
   - cards linking with the nearest context,
   - organizer theming,
   - a redirect from an org owner's party id to the slug.
2. Participants preview:
   - backend returns the 3 newest items per participant plus `items_total` (event page, and the term page equivalent),
   - one shared frontend component,
   - "Pokaż więcej" → owner items page with the context,
   - item links carry `?event=`/`?term=`.
3. Item page:
   - public for ACTIVE items,
   - `?term`/`?event` parsed,
   - the actions endpoint,
   - `itemActionsViewState.ts` covering eligible GIFT, eligible SWAP, not attending, anonymous, own, stale, no context, unavailable,
   - Weź → take, then the success sheet,
   - Zamienię → swap picker, then propose,
   - Napisz → ITEM chat.
4. Event reservations:
   - migration 0073: `reservations.term_id` nullable, `event_id` FK, CHECK that at most one context is set and open (PENDING/CONFIRMED) reservations have exactly one (`event_id` ON DELETE SET NULL; gate decision),
   - `ReservationContext`,
   - event take and propose routes,
   - accept, reject, confirm and cancel working for event reservations,
   - item status and history, `GET /api/reservations/{id}`, MyItemsView, ItemStatusCard and pendingActions handling event context,
   - `term_end_scan` covering events,
   - event deletion cancels and notifies,
   - notifications with event wording and links.
5. Organizer page: a "recently added items" block in the EXCHANGE layout → `/<slug>/items`.

## Scope boundaries
- **In scope:** everything above.
- **Out:**
  - a new DIRECT conversation kind,
  - private-circle dates on public pages,
  - cancelling reservations on withdrawal,
  - new notification kinds other than `RESERVATION_CANCELLED`,
  - the block in non-EXCHANGE organizer layouts,
  - a menu entry for the items page,
  - an OG preview for `/<owner>/items` (optional, not required).

## Technical considerations
- Term take/swap/confirm contracts must stay byte-identical.
- The event page key sets change on purpose (`added_at`, `items_total`). Update `test_event_page.py` `ITEM_KEYS`/`PARTICIPANT_KEYS`.
- Keep the query count constant on the event page and the owner items page (`count_queries`).
- Use the domain clock `clock.local_now()`. Event `starts_at` is naive Warsaw time.
- Add authorization-matrix rows:
  - PUBLIC for the owner-items endpoints and `/api/items/{id}/actions`, plus `/details` for anonymous viewers of ACTIVE items,
  - EDIT for the event take/propose routes.
- Guests (no account) cannot reserve. Route them through the account gate.
- Reverse the 2026-10-29 event-page "items read-only" decision in the docs and tests.
- Update `.maister/docs/project/architecture.md` with event reservations.
