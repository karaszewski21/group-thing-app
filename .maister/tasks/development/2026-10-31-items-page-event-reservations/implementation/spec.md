# Specification: Owner items page, participants preview, context item page, event reservations

## TL;DR
- New public owner items page at `/<org-slug>/items` and `/<party-id>/items`. It shows the owner's nearest public term or event, or a chat-only notice, and a paginated, filterable grid whose cards link with a `?term=`/`?event=` context.
- One shared "Zapisani i ich rzeczy" preview (3 newest items, then "Pokaż więcej (N)" linking to the owner items page) replaces the two near-duplicate toggles on the event and term pages.
- The item page is public for ACTIVE items. A new `GET /api/items/{id}/actions` endpoint drives a pure `itemActionsViewState.ts` with an explicit precedence order over its states (Weź, Zamienię, Napisz, Zapisz się, stale, own).
- Item reservations work on events end to end:
  - migration 0073;
  - `ReservationContext` (Term | Event) in groups, reading events only through `app.events.models` and Core tables;
  - event take/propose routes (event locked `FOR SHARE`);
  - event branches in every context reader, including the success sheets;
  - the end-of-event prompt;
  - atomic cancel-on-delete before `starts_at`, with the new `RESERVATION_CANCELLED` kind; delete after `starts_at` is refused while anything is open.
- The organizer page's EXCHANGE layout gets an "Ostatnio dodane rzeczy" block.

## Key Decisions
- **`ReservationContext` (Term | Event) in `app/groups/application`** — one code path for take, propose, accept and confirm/cancel. The term routes and their responses stay the same, apart from an additive `event_id` on the shared read responses.
- **No ACL import cycles** — groups (`groups/infrastructure/events_acl.py`) reads events only through `app.events.models` (`Event`, `EventAttendance`). Circulation reads them through Core `table()` references in `circulation/infrastructure/repository.py`, as it already does for `_terms`/`_groups`. Neither ever imports `app.events.service`. `app.events.models` imports only SQLAlchemy, `app.core` and `app.moderation`, so the existing events → groups and events → circulation ACLs stay one-directional at module level, as `models.md` requires.
- **Author slugs without importing events** — both sides compute them from the owner's Organization slug (groups: `organizations_acl`; circulation: a Core `organizations` reference) plus the pure `app.groups.domain.organizer_slug.derive_party_slug`. That module has no imports beyond `hashlib`/`uuid`, and circulation already imports groups.
- **Reservation context constraint (accepted at the gate)** — at most one of `term_id`/`event_id` is set, PENDING/CONFIRMED rows have exactly one, and `event_id` is `ON DELETE SET NULL`. Terminal history survives an event delete, while an open reservation can never be orphaned.
- **Migration 0073 downgrade is guarded** — it refuses to run while any reservation has `term_id IS NULL`, because those rows are ledger-linked. The error message names the recovery path, and `architecture.md` gets a runbook entry. Without such rows the downgrade is fully reversible.
- **Event delete rules (user decisions)** — delete stays refused while anyone is actively signed up (the existing rule).
  - Once no one is signed up but reservations remain:
    - before `starts_at`: delete cancels every open reservation and swap atomically and notifies both sides with the new `RESERVATION_CANCELLED` kind;
    - at or after `starts_at` (`clock.local_now() >= starts_at`): delete is refused with 409 while anything is open.
  - So the cancel-and-notify dialog appears only after all attendees have withdrawn but reservations remain, before the event starts.
- **Atomic cancel-on-delete through a new non-committing circulation use case** — `cancel_reservations_without_commit(db, reservation_ids)` flushes only, skips the party check (cancelled on behalf of each item's holder) and releases items. It is exported via `circulation.service` and the groups `circulation_bridge`. `delete_event` commits once.
- **Shared reservation read responses keep their keys and add only `event_id`** — `term_occurs_on` carries the context date and `group_name` the context name. `ItemStatusResponse` and `AcceptedSwapProposalResponse` also add `event_slug` for links and calendar export. This additive change to term responses is intentional; no existing test asserts those key sets.
- **Context-less terminal reservations get 409 `already_resolved`** — confirm/cancel checks the terminal status before resolving the context. A reservation whose event was deleted (both context columns NULL, status CANCELLED) answers like any already-resolved one.
- **Event confirmation prompts always carry `reservation_id`**, and the event swap scan is reservation-driven. It ignores eligibility and listing preferences, so a withdrawn attendee's open swap is still prompted.
- **Event-deletion cancellations use a new kind, `RESERVATION_CANCELLED`** (user decision). It is informational and needs no migration: the column is a non-native `VARCHAR(30)` enum with no CHECK, and the value is 21 characters. Take, swap and confirmation reuse the existing kinds.
- **The end-of-event scan triggers at `starts_at + TERM_END_GRACE`**, the same as terms, using the existing idempotency markers.
- **Organizer "Ostatnio dodane rzeczy" block** — data comes from `OrganizerPageResponse.recent_items` plus `owner_nearest`. It is a `directory` block placed in the EXCHANGE layout only, directly below `exchange-board` and above `needed-items`.
- **Item cards on `/<owner>/items` carry the page's own `?term`/`?event`** when present, otherwise the owner's nearest public date.
- **Term page preview sorts on the client**, using a new `added_at` field. The response already carries every listing.

## Open Questions / Risks
- **About 13 context readers (backend and frontend).** Any reader that is missed raises a 500 or shows a wrong status. Every row of the reader table needs its own event test.
- **Residual race in propose.** `create_reservation` and `confirm_reservation` commit mid-flow, as for terms today. The event `FOR SHARE` lock covers only the first commit. An event deleted between the reservation commit and the proposal insert leaves a proposal over a cancelled reservation. The accept and confirm gates handle it (409), and nothing stays locked.
- **Guests on the item page.** A guest event attendee (no account) is anonymous on the item page. After registering they must merge their sign-up on the event page (`useGuestMerge`) before becoming eligible. Until then the item page shows "Zapisz się", linking to the event page.
- **Prompt and `starts_at` edits.** If `starts_at` moves later after the end-of-event prompt was sent, confirming from that prompt returns 409 "jeszcze się nie rozpoczęło" until the new start. No second prompt is sent, because the markers are already set. This is acceptable and documented.
- **Strict key-set tests change on purpose:**
  - `test_event_page.py`: `DETAIL_KEYS`, `PARTICIPANT_KEYS`, `ITEM_KEYS`;
  - `test_item_details.py`: status keys;
  - `test_organizer_page.py`: `recent_items`, `owner_nearest`;
  - `test_authorization_matrix.py`;
  - frontend `OrganizerItemRoute.test.tsx` (anonymous redirect).
- **Anonymous access to `/details`.** The endpoint becomes public for ACTIVE items. An anonymous response must reveal no counterparty labels (`derive_status` with `viewer=None`) and must 404 for DRAFT or deleted items.

## Goal
Anyone can browse an owner's listed items and see where and when to pick them up. Eligible people can reserve those items (take, or propose a swap) on events as well as terms, with the same lifecycle guarantees terms have today.

## User Stories
- As a visitor, I want to open `/<owner>/items` and see the owner's available items and next public meeting, so that I know where to pick things up.
- As an event or term participant, I want to see each participant's 3 newest items and jump to all of their items, so that I find what is new quickly.
- As a logged-in attendee, I want to press Weź or Zamienię on an item page opened with `?event=`/`?term=`, so that I reserve the item for that meeting.
- As a logged-in non-attendee, I want to be told to sign up for the meeting, and still be able to write to the owner, so that I am not left at a dead end.
- As an anonymous visitor, I want the actions to lead me to create an account and then return me to the same item, so that I can reserve it afterwards.
- As an item owner, I want event reservations to notify me, to prompt me to confirm the hand-over after the event starts, and to be cancelled with notice if the event is deleted before it starts, so that nothing stays locked forever.
- As an organizer, I want my EXCHANGE organizer page to show recently added items with a link to all of them, so that visitors see fresh offers.

## Core Requirements

### Part 1: Owner items page
1. **Endpoints.** Two public endpoints return the same response:
   - `GET /api/groups/public/organizers/{slug}/items` resolves the owner via `_resolve_owner`. It returns 404 for an unknown slug and for `k-` pseudo-slugs.
   - `GET /api/groups/public/parties/{party_id}/items` resolves a party id. It returns 404 when the party has no user profile.

   Both take:
   - `page`/`size` (`Pagination`, default 20);
   - an optional `mode=GIFT|SWAP`.

   Both return `OwnerItemsPageResponse` with these fields:
   - `owner {party_id, display_name, slug}` (`slug` = the owner's Organization slug or null);
   - `nearest` (an `OwnerNearestDateResponse` or null);
   - `counts {GIFT, SWAP}`;
   - `items[]` of `{item_id, product_name, condition, mode, thumb_url, added_at}`;
   - `total`, `page`, `size`.

   Both set `Cache-Control: public, max-age=0, s-maxage=60`.
2. **List contents.** Only live items with an `ItemListingPreference` that are ACTIVE and AVAILABLE. Order is `ItemListingPreference.created_at DESC`, then item id. `counts` ignores the `mode` filter. The statement count is constant in the number of items (`count_queries`). `added_at` is naive UTC, like every audit timestamp.
3. **Owner nearest date (`OwnerNearestDateResponse`).** The earliest upcoming (`>= clock.local_now()`) of:
   - a term of a PUBLIC, non-deleted circle the owner leads or actively attends;
   - an event the owner authored or actively attends.

   Shape: `{kind: "TERM"|"EVENT", id, name, starts_at, location_name, attendee_count, path}`.
   - A term `path` is `/{resolve_organizer_slug(group_id)}/group/{group_id}/term/{id}`. It uses the circle's organizer slug, because the owner may only attend the circle.
   - An event `path` is `/{author_slug}/event/{id}`.

   Private-circle terms never appear.
4. **Route.** Frontend route `/:organizationSlug/items`, registered before the `/:organizationSlug` catch-all.
   - A UUID-shaped param selects party mode. A non-null `owner.slug` then triggers a `replace` redirect to `/<slug>/items` that keeps the query string.
   - Organization mode is themed like `OrganizerTermsPage`.
5. **Page content:**
   - the header "Rzeczy: <name>" and "N rzeczy do oddania lub zamiany";
   - either the nearest-date card or the chat-only notice "<name> nie ma teraz zaplanowanych spotkań…". The card shows "Najbliższa okazja do odbioru" and a CTA linking to `nearest.path` ("Zobacz wydarzenie i zapisz się" or "Zobacz termin i zapisz się");
   - Wszystkie/Oddam/Zamienię filter tabs with counts, which refetch with `mode`;
   - a 2-column card grid;
   - "Pokaż więcej", which loads the next page of 20.
6. **Card links.** Cards link to the item page (`organizerItemPath(owner.slug, id)`).
   - Query: the page's own `?term=`/`?event=` when present, otherwise the context from `nearest`.
   - With neither, there is no query, and the mode chip shows the mode without a date.
7. **Slug guard.** `organizations/service.py::_generate_unique_slug` treats UUID-shaped candidates as reserved.

### Part 2: Shared participants preview
8. **Event page.** In `events/page.py::_listed_items_by_party`, each participant gets their 3 newest listed items (`ItemListingPreference.created_at DESC`, capped per party with `row_number()`) plus `items_total`.
   - `EventParticipantItemResponse` gains `added_at`.
   - `EventParticipantResponse` gains `items_total`.
   - The statement count stays constant (`test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant`).
9. **Term page.** `PublicItemListingResponse` gains `added_at` (the preference's `created_at`). The client sorts newest first and computes the per-attendee total.
10. **Shared component.** `components/shared/ParticipantItemsPreview.tsx` renders up to 3 rows and replaces the in-place toggles in `EventAttendeeList.tsx` and `AttendeeList.tsx`.
    - Each row has a thumbnail, the item name as a link, a mode label, a relative "dodano …" time and an optional actions slot. The term inline Weź/Zamień buttons stay.
    - `added_at` is parsed as UTC (`dayjs.utc(...)`) before calling `fromNow()`. Add the `relativeTime` plugin to `utils/dayjs.ts`.
    - When N > 3 it ends with "Pokaż więcej (N) ›", linking to `/<party_id>/items?event=<id>` or `?term=<id>`.
11. **Item links.** Item names link to the item page with `?event=<event_id>` or `?term=<term_id>`, through `organizerItemPath` with the page's organizer slug.

### Part 3: Public item page with context actions
12. **Public details.** `GET /api/inventory-items/{id}/details` accepts `OptionalPrincipal`. Anonymous callers get 404 for items that are not `listing_status=ACTIVE` or are soft-deleted. Logged-in behaviour is unchanged.
13. **Actions endpoint.** New `GET /api/items/{item_id}/actions?term=<uuid>|event=<uuid>` (OptionalPrincipal, PUBLIC). It returns 400 when both params are given. Response fields:
    - `mode`: GIFT/SWAP, or null without a listing preference;
    - `available`: ACTIVE and AVAILABLE;
    - `owner {party_id, display_name, slug, items_total}`;
    - `context {kind, id, name, starts_at, path, has_started} | null`;
    - `viewer`: `ANONYMOUS | OWN | ELIGIBLE | NOT_ELIGIBLE`;
    - `nearest`: `OwnerNearestDateResponse | null`.

    `context` is returned only when all of these hold; otherwise it is null:
    - the context exists;
    - the owner is eligible in it;
    - it is public (an event, or a term of a PUBLIC circle), or the viewer is eligible in it.

    The `/api/items` prefix is new, next to `/api/inventory-items`. It is accepted at the gate as a viewer-facing read model, not an inventory resource.
14. **Eligibility.** Viewer eligibility is decided server-side:
    - terms: `_require_term_eligibility` semantics;
    - events: the author, or an active attendee whose party has an account.

    URL params are only hints. Take and propose re-validate everything.
15. **Item routes.** Frontend item routes `/product/:id` and `/:organizationSlug/product/:id` drop `AuthGuard`.
    - When the viewer is anonymous and `/details` returns 404, the page redirects to login with a `returnTo`. This preserves today's behaviour for non-public items.
    - The anonymous item page calls no READ-gated endpoint.
16. **View state.** Pure `pages/product/itemActionsViewState.ts::resolveItemActionsView()` returns one view kind, choosing the first match in this order. The `it.each` table mirrors it row for row, including stale-data and refresh-error rows.
    1. `loading`: details or actions pending with no cached data.
    2. `hidden`: the item is deleted.
    3. `error`: the actions query failed with no cached data while details succeeded. The card shows "Nie udało się wczytać akcji" plus retry, and the rest of the page renders. A refetch error with cached data keeps the last view.
    4. `own`: `viewer=OWN` or `details.is_owner`.
    5. `unavailable`: `available=false` or `mode=null`. Status comes from `ItemStatusCard`; the card shows only Napisz.
    6. `noContext`: `context=null`. Napisz, plus a nearest hint when `nearest` exists, otherwise "Właściciel nie ma teraz zaplanowanych spotkań".
    7. `stale`: `context.has_started`. Copy is "… już się odbył" for terms and "… już się rozpoczęło" for events, plus the nearest hint and Napisz.
    8. `anonymous`: `viewer=ANONYMOUS` with a live context. Shows Weź or Zamienię, plus Napisz.
    9. `notSignedUp`: `viewer=NOT_ELIGIBLE`.
    10. `eligible`.

    Napisz opens the account gate for anonymous viewers in every kind. `ItemContextActions` only `switch`es over `view.kind`.
17. **Actions.**
    - **Weź** (GIFT, eligible) calls take and then shows `TakeSuccessSheet`.
    - **Zamienię** (SWAP, eligible) opens `SwapProposeDialog` over the viewer's AVAILABLE SWAP items, then calls propose.
    - **Napisz** opens the ITEM conversation.
    - **Zapisz się** links to `context.path`.
    - **"Przejdź do nowego terminu"** links to the item page with the nearest context.
    - **"Zobacz wszystkie rzeczy (N) ›"** links to the owner items page.
    - For anonymous viewers every action opens `AuthGateSheet` via `pages/term/hooks/useAccountGate.ts`. The gate returns to the same URL, query included.
18. **`useItemTake`** (`pages/term/hooks/useItemTake.ts`) is generalised from `termId` to `context: {kind: "term"|"event", id, name, starts_at, path} | null`. Term callers pass their term. The event branch calls the new event endpoints.

### Part 4: Event reservations
19. **Migration `0073_event_reservations.py`:**
    - makes `reservations.term_id` nullable;
    - adds `event_id UUID NULL` with FK `fk_reservations_event_id_events` (ON DELETE SET NULL);
    - adds CHECK `ck_reservations_context`: `num_nonnulls(term_id, event_id) <= 1 AND (status NOT IN ('PENDING','CONFIRMED') OR num_nonnulls(term_id, event_id) = 1)`;
    - adds the partial index `ix_reservations_event_id` (WHERE `event_id IS NOT NULL`).

    `downgrade()`:
    - when any row has `term_id IS NULL`, raises an error that tells the operator to cancel and purge event reservations (and their ledger references) manually, or restore a pre-0073 backup;
    - otherwise drops the CHECK, the index, the FK and the column, then restores NOT NULL.
20. **Write-side signatures:**
    - `Reservation.term_id: Mapped[uuid.UUID | None]` plus `event_id: Mapped[uuid.UUID | None]` (plain FK-id column, no `relationship()`). The CHECK is declared in `__table_args__` so autogenerate reports no drift.
    - `CreateReservationRequest` keeps `term_id` required, so `POST /api/reservations` stays term-only.
    - `circulation.service.create_reservation(..., term_id: UUID | None = None, event_id: UUID | None = None)` raises `ValueError` unless exactly one is given. `circulation_bridge.create_reservation` takes the same kwargs.
21. **`ReservationContext`** (`groups/application/reservation_context.py`, Term | Event). It provides:
    - `kind`, `id`, the date (`occurs_on` / `starts_at`), `has_started`;
    - `require_eligibility(party_id)`;
    - the display name and the `when` text;
    - `link_path`;
    - the reservation write kwargs;
    - `load_for_reservation(reservation)`, which returns None when both context columns are NULL.

    `take_item_listing`, `propose_swap`, `accept_swap_proposal` and `_resolve_transaction_reservations_for_action` are parameterised on it. Term behaviour, messages and response values stay identical.
22. **Event routes** in `groups/router/event_item_listings.py`, both EDIT:
    - `POST /api/events/{event_id}/items/{item_id}/take` with body `{reservation_type}`. Returns `{item_id, product_name, context}`, where `context` has the same shape as Requirement 13.
    - `POST /api/events/{event_id}/items/{item_id}/propose` with body `{offered_item_id}`. Returns `SwapProposalResponse`.

    Both load the event `FOR SHARE` (as `sign_up` does). Errors:
    - 404: unknown event or item;
    - 403: ineligible taker or owner;
    - 409: the event has started ("Wydarzenie już się rozpoczęło"), own item, unavailable item, mode mismatch, or SWAP via take.

    Accept of an event swap also loads the event `FOR SHARE`. A deleted event (context None) gives 409.
23. **Timing:**
    - take, propose and accept are allowed while `clock.local_now() < starts_at`;
    - confirm and cancel are allowed once `clock.local_now() >= starts_at`; before that they return 409 "Wydarzenie jeszcze się nie rozpoczęło";
    - `starts_at` is read live, so edits move the gates;
    - withdrawing an attendance never cancels reservations.
24. **Confirm/cancel gate order.** `_resolve_transaction_reservations_for_action` evaluates the terminal or already-resolved status before loading the context. A reservation with no context (event deleted, status CANCELLED) yields `TermAlreadyResolvedException` (409 with `already_resolved`), never a 404 or 500.
25. **Notifications.** The existing kinds are reused with event wording: `TERM_ITEM_LISTING_TAKEN`, `ITEM_RESERVED_FOR_PICKUP`, `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`. Wording uses `format_term_when(starts_at)` and the event name, capped by `fit_notification_message`. `link_path` conventions match terms.
26. **Context readers.** Every context reader gets an event branch or is confirmed unchanged; see the Technical Approach table.
    - `ReservationResponse`: `term_id` becomes nullable and gains `event_id`.
    - `ReservationDetailResponse` (`GET /api/reservations/{id}`): the context date goes in `term_occurs_on`, plus `event_id`.
    - `ItemStatusResponse`: gains `event_id` and `event_slug`.
    - `AcceptedSwapProposalResponse`: gains `event_id` and `event_slug`; `term_id` and `group_id` become nullable.
    - Frontend: `ItemStatusCard`, `SwapAcceptSuccessSheet` and `TakeSuccessSheet` get event branches; the TS types change accordingly.
27. **End-of-event scan.** `term_end_scan` adds an event pass for events whose `starts_at + TERM_END_GRACE` falls in the window. The pass is reservation-driven and ignores eligibility and listing preferences:
    - GIFT: open reservations with that `event_id` (`list_active_hand_over_reservations_for_events`).
    - SWAP: ACCEPTED, not-yet-notified proposals whose `proposer_reservation_id` is in `reservation_ids_for_event_select(event_id)`.
      - `owner_party_id` = the profile of the proposer reservation's `reserved_by_user_id`.
      - Each party's payload carries the reservation it receives: the owner gets `proposer_reservation_id`, and the proposer gets its `paired_reservation_id`.
    - Payload: `link_path=/{author_slug}/event/{id}`, `occurs_on=starts_at`, `group_name=<event name>`.
    - The existing markers make the pass idempotent.
    - The outbox listener sets `reservation_id` on swap prompts only when the payload provides one, so term prompts are unchanged.
28. **`pendingActions.ts`.** It recognises `/…/event/{id}` links: `termId` stays null, and confirming uses `reservation_id`. It derives no action from `RESERVATION_CANCELLED`.
29. **Event delete** (`events/service.py::delete_event`, under the existing `FOR UPDATE` lock). Checks, in order:
    1. 409 `EventHasAttendees` while `attendee_count > 0` (unchanged).
    2. If open reservations or swaps exist and `clock.local_now() >= starts_at`: 409 `EventHasOpenReservations` ("Wydarzenie już się rozpoczęło i ma otwarte rezerwacje — potwierdźcie lub anulujcie przekazania").
    3. Otherwise, before deleting, it calls `events/infrastructure/groups_acl.cancel_open_event_reservations`, which delegates to `groups/application/event_reservations.py`. In the same uncommitted transaction:
       - PENDING/CONFIRMED reservations of the event, both swap legs included, are cancelled through `circulation_bridge.cancel_reservations_without_commit`, releasing the items to AVAILABLE;
       - PROPOSED and ACCEPTED proposals become REJECTED. Setting ACCEPTED to REJECTED is intentional here; term `cancel_transaction` leaves ACCEPTED alone;
       - both parties of each are notified (`RESERVATION_CANCELLED`).

    The event row is then deleted, `SET NULL` detaches the terminal rows, and `delete_event` commits once.
30. **New circulation use case: `cancel_reservations_without_commit(db, reservation_ids)`.** Same transition as `_cancel` (status CANCELLED, balance released), without the party check and without committing. It locks the rows `FOR UPDATE` and skips rows already terminal. It is exported from `circulation.service` and `groups/infrastructure/circulation_bridge.py`.
31. **New notification kind `RESERVATION_CANCELLED`.**
    - `notifications/models.py`: added to `NotificationKind`, and the docstring's recipient list says it "goes to both parties of a reservation or swap cancelled because its event was deleted". The column is `_enum_column(NotificationKind, 30)`, non-native with no CHECK, and the value is 21 characters, so no migration is needed.
    - `link_path=/product/{item_id}`.
    - Frontend: added to the `NotificationKind` union in `api/notifications.ts`. No other per-kind map exists, and `NotificationBell` renders every kind generically.
32. **Delete-dialog data.** `EventDetailResponse` gains `open_reservations {total, swaps} | null`, non-null only for the author.
    - `total` = open GIFT reservations + open swaps (PROPOSED or ACCEPTED proposals tied to the event); `swaps` = those swaps. This is exactly what step 3 of Requirement 29 would cancel.
    - `EventAuthorCard` shows the confirm dialog "Na tym wydarzeniu są N otwarte rezerwacje (w tym M zamiana)…" with the button "Usuń i anuluj rezerwacje" only when `attendee_count == 0`, `total > 0` and the event has not started.
    - When `attendee_count == 0`, `total > 0` and the event has started, the delete button is `aria-disabled` with the hint "Nie można usunąć — wydarzenie się rozpoczęło i ma otwarte rezerwacje".
    - Otherwise the existing behaviour is unchanged.

### Part 5: Organizer page block
33. **Response fields.** `OrganizerPageResponse` gains:
    - `recent_items`: the 4 newest owner items, same shape and query as Requirement 1;
    - `owner_nearest`: an `OwnerNearestDateResponse` or null, computed only when `recent_items` is non-empty.

    Both are computed before the no-circles early return. `_empty_page()` becomes a function that takes these two values.

    **Block.** New block id `recent-items` (`RecentItemsBlock`):
    - a `directory` block, empty when `recent_items` is empty, with a `GhostBlock` entry;
    - titled "Ostatnio dodane rzeczy";
    - uses the shared item cards with `owner_nearest` as their context;
    - "Zobacz więcej" links to `/<slug>/items`.

    It is added to the EXCHANGE layout only, directly after `exchange-board` and before `needed-items`.

### Cross-cutting
34. **Authorization matrix rows** (first match wins; verified in `test_authorization_matrix.py`):
    - extend the PUBLIC organizers regex to `(/terms|/items)?`;
    - PUBLIC `GET ^/api/groups/public/parties/[^/]+/items$`, ahead of the blanket `/api/groups` READ row;
    - PUBLIC `GET ^/api/inventory-items/[^/]+/details$`, ahead of row 40;
    - PUBLIC `GET ^/api/items/[^/]+/actions$`;
    - EDIT `POST ^/api/events/[^/]+/items/[^/]+/(take|propose)$`, in the events block.
35. **Docs.** `.maister/docs/project/architecture.md` replaces the "items as read-only cards" wording. It documents:
    - event reservations and `ReservationContext`;
    - the new routes;
    - the end-of-event scan;
    - the delete rules: blocked with attendees, refused after start with open reservations, cancel-and-notify before start;
    - `RESERVATION_CANCELLED`;
    - the public `/details` for ACTIVE items;
    - the owner items page;
    - a 0073 runbook entry for the guarded downgrade and its recovery path.

    Update the INDEX.md summary to match. Optionally add a line to `standards/backend/migrations.md` that allows a guarded downgrade when ledger rows would make it lossy.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs. The implementation-planner will attach `Visual References` to UI task groups.

Fidelity: mobile HTML mockups built on the app's Tailwind tokens (`src/frontend/src/index.css`), with Bricolage Grotesque headings and Figtree body text. See `analysis/design-context/design-resources.md`.

| Screen / component ID | Mockup | Implemented by | State / key elements |
|---|---|---|---|
| `screen:owner-items-nearest-term` | `mockups/owner-items-page-nearest-term.html` | `pages/owner/OwnerItemsPage.tsx`, `NearestDateCard`, shared item card | `nearest` non-null: DateTile card "Najbliższa okazja do odbioru"; CTA; filter tabs with counts; 2-column grid; chips "Weź · sob 8 lis" / "Zamienię · sob 8 lis"; "Pokaż więcej" |
| `screen:owner-items-chat-only` | `mockups/owner-items-page-no-upcoming-terms-chat-only.html` | same page | `nearest` null: "… nie ma teraz zaplanowanych spotkań"; mode-only chips, no context |
| `screen:event-participants-preview` | `mockups/event-page-participants-preview.html` | `EventAttendeeList` + `ParticipantItemsPreview` | 3 newest per participant; "dodano wczoraj"; mode label; "Pokaż więcej (12) ›"; "To Ty" pill unchanged |
| `component:participant-items-preview` | same mockup | `components/shared/ParticipantItemsPreview.tsx` | Shared by the event and term pages; term rows use the inline actions slot |
| `screen:item-gift-eligible` | `mockups/item-page-gift-eligible-we.html` | `ItemContextActions`, view `eligible` (GIFT) | Context line, Weź + Napisz, hint "Rezerwacja możliwa do startu wydarzenia…", owner row with "Zobacz wszystkie rzeczy (N) ›"; after take, `TakeSuccessSheet` (event variant) |
| `component:item-context-actions` | same mockup | `pages/product/ItemContextActions.tsx` | Action card for every view kind in Requirement 16 |
| `screen:item-swap-picker` | `mockups/item-page-swap-picker-zamieni.html` | view `eligible` (SWAP) + `SwapProposeDialog` | "Co proponujesz w zamian?", the viewer's SWAP items, "Zaproponuj zamianę" |
| `screen:item-not-signed-up` | `mockups/item-page-not-signed-up-zapisz-si.html` | view `notSignedUp` | "Zapisz się na wydarzenie ›" / "Zapisz się na termin ›", Napisz |
| `screen:item-anonymous-gate` | `mockups/item-page-anonymous-account-gate.html` | view `anonymous` + `AuthGateSheet` | Live context only; any action opens "Załóż konto, żeby zarezerwować" |
| `screen:item-stale-context` | `mockups/item-page-stale-context-termin-si-odby.html` | view `stale` | "⏱ <name> (<date>) już się odbył / rozpoczęło", next-date hint, "Przejdź do nowego terminu ›", Napisz |
| `screen:item-no-context` | `mockups/item-page-no-context-napisz-only.html` | view `noContext` | "Właściciel nie ma teraz zaplanowanych spotkań" (or the nearest hint), "Napisz do właściciela" |
| `screen:item-own` | `mockups/item-page-own-item.html` | view `own` | "To Twoja rzecz — widoczna dla uczestników …", no actions, existing Edytuj |
| `screen:event-delete-cancels` | `mockups/event-delete-cancels-reservations.html` | `EventAuthorCard` delete dialog | Shown only when `attendee_count == 0`, open reservations remain and the event has not started (Requirement 32): count line plus "Usuń i anuluj rezerwacje". After start, this state is replaced by the disabled delete with a hint. While anyone is signed up, the existing blocked-delete hint applies. |

The organizer "Ostatnio dodane rzeczy" block has no dedicated mockup. It reuses the shared item card and the `UpcomingTermsBlock` header and link styling.

## Reusable Components

### Existing Code to Leverage
Backend (`src/backend/app/`):
- `groups/application/organizer_page.py`: `_resolve_owner`, the `list_organizer_terms` page/count pattern. `groups/router/organizer_page.py`: `CACHE_CONTROL`.
- `groups/infrastructure/repository.py`: `_qualifying_owner_circles`, `item_listing_preferences_select`, `list_owner_public_terms_page`, `count_active_attendances_by_term`. `groups/infrastructure/slug_resolver.py::resolve_organizer_slug`.
- `groups/domain/organizer_slug.py::derive_party_slug`, a pure function with no imports.
- `groups/infrastructure/circulation_bridge.py`: `available_items_with_product_select`, `create_reservation`, `confirm_reservation`, `get_item_balance`. Extended with `cancel_reservations_without_commit` and the context kwargs.
- `groups/application/term_item_listings.py`: the take/propose/accept/reject/confirm/cancel flows, refactored onto `ReservationContext` rather than duplicated. Also `_require_own_available_personal_item` and `_require_term_eligibility` (`attendance.py`).
- `groups/application/term_end_scan.py`: `_scan_hand_over_reservations`, `GiveawayTermEndMarker`, `SwapProposal.term_ended_notified_at`, `TERM_END_GRACE`. `notifications/outbox_listener.py`: the TERM_ENDED handlers.
- `circulation/application/reservation_transitions.py::_cancel`: the transition logic the new non-committing use case reuses.
- `circulation/infrastructure/repository.py`: Core references `_terms`, `_groups`, `_user_profiles`, extended with `_events` and `_organizations`. `circulation/domain/item_privacy.py::derive_status`.
- `events/models.py` (`Event`, `EventAttendance`): the only events module that groups imports. `events/service.py`: the `sign_up` `FOR SHARE` pattern, `delete_event`, `resolve_author_slugs` (used inside events only). `events/page.py`: the single-statement listed-items join.
- `notifications_bridge`, `notifications/service.create_notification` (stages without committing), `core/clock.py`, `core/pagination.py`.
- `groups/application/public_view.py::_listing_thumb_urls`, `product_bridge.first_approved_photo_by_product`.
- `messaging.open_item_conversation`, which backs Napisz. `organizations/slugs.py::RESERVED_SLUGS`, which already contains `items`.

Frontend (`src/frontend/src/`):
- `pages/organizer/OrganizerTermsPage.tsx`, `blocks/AgendaResults.tsx`, `hooks/useOrganizerTerms.ts`, `api/pagination.ts`: the page shell, theming and pagination template.
- `pages/organizer/blocks/ExchangeItemCard.tsx`: generalised to a neutral card with an item href and an optional pickup href/label. Reused by `ExchangeBoardBlock`, the items page and `RecentItemsBlock`.
- `blocks/NextTermCtaBlock.tsx` and `UpcomingTermsBlock.tsx::DateTile`: the presentational part is extracted to `NearestDateCard`.
- `pages/term/hooks/useItemTake.ts`, `pages/term/hooks/useAccountGate.ts`, `pages/term/modals/SwapProposeDialog.tsx`, `TakeSuccessSheet.tsx`, `AuthGateSheet.tsx` (its `returnTo` keeps `location.search`).
- `pages/items/SwapAcceptSuccessSheet.tsx` and `MyItemsView.tsx`: they get an event branch.
- `pages/term/components/termLabels.ts`, `components/shared/Avatar`, `Icons.PhotoPlaceholder`, `product/ItemGallery.SafeImage`, `uiStyles`.
- `pages/product/useItemRoutes.ts::organizerItemPath`, `utils/appHelpers.ts::eventPath`, `organizerHelpers.organizerTermPath`.
- `hooks/useOpenAndNavigate`, `hooks/useItemDetail`, `components/pending/pendingActions.ts`.
- `pages/organizer/LayoutRenderer.tsx`, `layouts/registry.ts` (EXCHANGE), `blocks/GhostBlock.tsx`.

### New Components Required
| New element | Why existing code cannot be reused |
|---|---|
| Migration `0073_event_reservations.py` | Schema change: `term_id` NOT NULL blocks event reservations. |
| `groups/application/reservation_context.py` | No Term/Event abstraction exists; without it the flows would be duplicated. |
| `groups/infrastructure/events_acl.py` (model-only imports) | groups has no event access. It goes through `app.events.models` only, to avoid an import cycle. |
| `_events`/`_organizations` Core refs in the circulation repository | Circulation needs event dates, names and author slugs without importing events. |
| `circulation`: `cancel_reservations_without_commit` | All existing cancel paths commit and require a party; delete needs an atomic, holder-side cancel. |
| `groups/application/owner_items.py` + routes | No public endpoint lists another party's items. |
| `groups/application/item_actions.py` + `groups/router/item_actions.py` | `/details` lacks mode, owner, context and viewer eligibility. Adding them would mix bounded contexts. |
| `groups/router/event_item_listings.py` | New event-scoped paths; the term routes stay unchanged. |
| `groups/application/event_reservations.py` | No cancel-by-context operation exists. |
| `NotificationKind.RESERVATION_CANCELLED` | User decision: a clear cancellation notice. |
| `pages/owner/OwnerItemsPage.tsx`, `hooks/useOwnerItems.ts`, `api/ownerItems.ts` | New page and read model. |
| `components/shared/ParticipantItemsPreview.tsx` | Replaces two duplicate toggles. |
| `pages/product/itemActionsViewState.ts`, `ItemContextActions.tsx`, `hooks/useItemActions.ts`, `api/itemActions.ts` | New multi-state view (the `resolve…View()` pattern). |
| `pages/organizer/blocks/RecentItemsBlock.tsx` | New block id. |
| `api/eventItems.ts` | New endpoints. |

## Technical Approach

**Data flow.**
- **Owner page:** `OwnerItemsPage` → `useOwnerItems`, an infinite query keyed `[OWNER_ITEMS_KEY, ownerRef, mode]`. Statements: owner resolve, mode counts (1), page (1), thumbnails (1), nearest terms (1) and nearest events (1, through `events_acl`). The count does not grow with the number of items.
- **Item page:** `ItemDetailBody` → `useItemDetail` + `useItemActions(id, contextParam)` → `resolveItemActionsView` → `ItemContextActions` → `useItemTake({context})` → the event or term endpoints. Afterwards, invalidate the actions, item-detail and notification prefixes.

**Import direction (no cycles).**
- events → groups, through `events/infrastructure/groups_acl.py`, which imports `app.groups.service` as it does today, and gains `cancel_open_event_reservations`.
- events → circulation, through the existing `circulation_acl`.
- groups → events, through `groups/infrastructure/events_acl.py`, importing `app.events.models` only.
- circulation → events, through Core tables only.

**Context reader inventory.** Each row needs an event branch or an explicit "unchanged", plus a test.

| Reader | Change |
|---|---|
| `circulation/application/item_details.py` + `domain/item_privacy.py` | Load the event row via `_events` and `_organizations` when `event_id` is set. `ItemStatus` gains `event_id`/`event_slug`, and `term_occurs_on`/`group_name` carry the event date and name. |
| Circulation history join | Outer-join `_events` and use `coalesce(term occurs_on, event starts_at)`. Rows of a deleted event's reservations show no date; this is accepted and documented. |
| `repository.find_reservation_term`, `service.find_reservation_term_occurs_on` | Return None for event or context-less rows. The sibling `find_reservation_event` handles event rows. |
| `circulation/router.py` `GET /api/reservations/{id}` | The context date goes in `term_occurs_on`, plus `event_id`. |
| `list_active_hand_over_reservations_for_terms`, `reservation_ids_for_term_select` | Unchanged, because `term_id IN` excludes events. `_for_events` siblings are added. |
| `term_item_listings.list_my_active_taken_term_item_listings` | Unchanged by design (term-scoped; event rows are skipped). |
| `_resolve_listing_status`, `list_my_term_item_listings` | Unchanged by design (term-scoped). |
| `accept_swap_proposal` | Context comes from the proposer reservation. The owner leg is written with the same context. Event accept locks the event `FOR SHARE`. |
| `_resolve_transaction_reservations_for_action` | Terminal-status check first, then the context gate (Requirement 24). |
| `term_end_scan` | Reservation-driven event pass (Requirement 27). |
| Frontend `ItemStatusCard` | Event branch links via `eventPath(event_slug, event_id)`. |
| Frontend `SwapAcceptSuccessSheet` (fed from `MyItemsView.tsx:182-185`) | When `event_id` is set, show the event name and date, link via `eventPath(event_slug, event_id)`, and use the event id as the calendar uid. The term branch is unchanged. |
| Frontend `TakeSuccessSheet` | Generalised from `groupId`/`termId`/`organizerSlug` to a `context` prop. The term page passes its term context (link via `organizerTermPath`); the item page passes the take response's `context` (link via `context.path`, calendar uid from the context id). |
| Frontend `MyItemsView`, `pendingActions`, API types | `term_id` becomes nullable in types and `event_id`/`event_slug` are added. `pendingActions` handles `/event/` links. |

**Event eligibility.** The author, or an active `EventAttendance` whose party has an `account_user_id`, checked for both taker and owner. A guest or anonymous viewer is never eligible; the UI shows the account gate and the API answers 401/403.

**Transactions and commit points.**
- Take, propose and accept on events inherit the term flows' existing commit points. `circulation.create_reservation` and `confirm_reservation` each commit; the application service's final commit covers notifications. The event `FOR SHARE` lock is taken before the first write, so the reservation insert cannot race a delete.
- `delete_event` is the only flow promised to be fully atomic. The guards, the cancellations (`cancel_reservations_without_commit`), proposal rejections, notifications (staged only), the banner outbox and the delete itself all commit once. The DB CHECK means a missed open reservation makes the delete fail rather than orphan it.

**Frontend routes.** `/:organizationSlug/items` goes next to `/:organizationSlug/terms`. The item routes lose `AuthGuard`, and `OrganizerItemLayout` stays as the themed frame.

## Implementation Guidance

### Testing Approach
- Write 2-8 focused tests per implementation step group. Test verification runs only the new and changed tests, not the entire suite.
- **Backend:** pytest against real PostgreSQL; the `client`/`db_session` fixtures, `leaf_category_ids` per test, and `freeze_local_now` for gates.
  - `tests/test_event_reservations_migration.py`:
    - downgrade, then upgrade head;
    - downgrade refuses while `term_id IS NULL` rows exist, and the message names the recovery path;
    - the CHECK rejects an open row with no context and a row with both contexts;
    - `SET NULL` on a terminal row.
  - `tests/test_event_item_reservations.py`:
    - GIFT take plus notifications;
    - 403 for an ineligible taker or owner, and for a guest attendee;
    - 409 after `starts_at`;
    - propose → accept → confirm after start;
    - 409 for confirm before start;
    - withdraw keeps the reservation;
    - delete before start cancels both legs, releases items and sends `RESERVATION_CANCELLED` to both parties;
    - delete after start with open reservations → 409;
    - confirm on a reservation whose event was deleted → 409 `already_resolved`.
  - `tests/test_circulation_bulk_cancel.py`, or an addition to the existing reservation tests: `cancel_reservations_without_commit` does not commit (rolled back with the session), skips terminal rows, and releases balances.
  - Extend `tests/test_term_end_scan.py`: the event pass is idempotent; a withdrawn attendee's ACCEPTED swap is still prompted; swap prompts carry a per-party `reservation_id`.
  - Extend `tests/test_item_details.py`: the event status branch; anonymous ACTIVE → 200; anonymous DRAFT → 404; key sets.
  - `tests/test_notifications.py`: `RESERVATION_CANCELLED` round-trips through persistence and `/mine`.
  - `tests/test_owner_items_page.py`:
    - organization and party variants, and the 404s;
    - `mode` filter, ordering and pagination;
    - nearest excludes private circles;
    - an attended term's `path` uses the circle organizer's slug;
    - `count_queries` stays constant.
  - `tests/test_item_actions.py`:
    - viewer states and stale context;
    - a private-term context is hidden from non-eligible viewers;
    - both params → 400.
  - Update `tests/test_event_page.py` (key sets including `open_reservations`, 3 newest per party, `items_total`, query count), `tests/test_authorization_matrix.py`, `tests/test_organizer_page.py` (`recent_items`, `owner_nearest`).
  - The existing `tests/test_term_item_listings*.py` must pass unchanged; they are the term regression gate.
  - Run `test_domain_clock_guard.py`.
- **Frontend:** Vitest + RTL, `createQueryWrapper`, typed fixture factories; `vi.useFakeTimers({ toFake: ["Date"] })` for relative dates and gates.
  - `src/test/itemActionsViewState.test.ts`: an `it.each` table in the Requirement 16 order, including overlapping rows (anonymous + no context → `noContext`; anonymous + stale → `stale`; anonymous + unavailable → `unavailable`), an actions error, and a refresh error with cached data.
  - `src/test/ParticipantItemsPreview.test.tsx`: 3 newest; "Pokaż więcej (N)" href; `?event`/`?term` links; a UTC `added_at` rendered relative to the pinned clock.
  - `src/test/OwnerItemsPage.test.tsx`: nearest card vs chat-only; filter; party-to-slug redirect; card context hrefs.
  - `src/test/ItemDetailPage.test.tsx` additions: anonymous gate; eligible take showing the event `TakeSuccessSheet`; `notSignedUp`.
  - `src/test/SwapAcceptSuccessSheet.test.tsx` (or the existing `MyItemsView` test): the event branch shows the event link and calendar.
  - Updates:
    - `OrganizerItemRoute.test.tsx`: anonymous ACTIVE renders; an anonymous 404 redirects;
    - `EventPage.test.tsx`: delete dialog with reservations before start; disabled delete after start;
    - `TermPage.test.tsx`: `TakeSuccessSheet` with the term context;
    - the `pendingActions` event-link case, and `RESERVATION_CANCELLED` yielding no action;
    - a `NotificationBell.test.tsx` case rendering `RESERVATION_CANCELLED`;
    - a `RecentItemsBlock`/layout test.

### Standards Compliance
- `standards/backend/migrations.md`:
  - explicit `fk_`/`ix_`/`ck_` names;
  - reverse-order downgrade;
  - a downgrade-then-upgrade pytest;
  - an additive nullable column with no data change.
  - Documented deviation: the guarded downgrade refuses when event rows exist; recovery is covered by the runbook in `architecture.md` (Requirement 35).
- `standards/backend/models.md`:
  - a plain FK-id `event_id` column with no `relationship()`;
  - the CHECK declared in `__table_args__`;
  - cross-context access through a single `infrastructure/<other>_acl.py`, without importing `..schemas`;
  - "the other BC imports nothing back" is honoured at module level: groups imports only `app.events.models` (entity definitions, no back-imports), and circulation uses Core table references, as with `_terms`/`_groups`;
  - 404 before 403.
- `standards/backend/queries.md`: bounded statement counts tested with `count_queries`; batched `IN`; SQL-level LIMIT; `FOR SHARE`/`FOR UPDATE` where writes race.
- `standards/backend/security.md`: new `AUTHORIZATION_MATRIX` rows with tests; PUBLIC rows have no dependency; EDIT routes use `require_any`.
- `standards/backend/time.md`: every gate uses `clock.local_now()` (naive Warsaw `starts_at`); `format_term_when`; `fit_notification_message`; `test_domain_clock_guard.py`.
- `standards/backend/api.md`: plural paths and limited nesting. The `/api/items/{id}/actions` read model is noted in Requirement 13.
- `standards/frontend/components.md`: `resolveItemActionsView()` with an explicit precedence order, table-tested, with a `switch` on `view.kind`; flows live in `useItemTake`.
- `standards/frontend/data-fetching.md`:
  - hooks wrap `src/api/*.ts`;
  - prefix-constant query keys;
  - mutations await invalidation;
  - `dayjs` comes from `utils/dayjs.ts`, with `relativeTime` added there and UTC parsing for audit timestamps.
- `standards/frontend/accessibility.md`:
  - `ModalSheet` + `useRegisterOpenSheet`;
  - `type="button"`;
  - tablist with arrow keys as in `ExchangeBoardBlock`;
  - stretched-link cards;
  - blocked delete uses `aria-disabled` + `aria-describedby`;
  - `{" "}` around `sr-only` text.
- `standards/frontend/responsive.md`, `css.md`: mobile-first; tokens only.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: as above; exact key sets are updated, never loosened.
- `standards/global/minimal-implementation.md`: exactly one new notification kind (a user decision); no DIRECT chat; no event "my takes" endpoint.

## Out of Scope
- A new DIRECT/PARTY conversation kind. Chat stays per item.
- Private-circle dates on public pages.
- Cancelling reservations on attendance withdrawal.
- New notification kinds beyond `RESERVATION_CANCELLED`. Take, swap and confirmation keep the existing kinds.
- The "Ostatnio dodane rzeczy" block in non-EXCHANGE organizer layouts.
- A menu entry for the owner items page.
- An OG preview for `/<owner>/items`.
- An event-scoped "my takes" list. Status shows on the item page and in `/panel/items`.
- Removing the inline term take buttons.
- Guest (no-account) reservations.
- Event capacity (memory follow-up W9).
- Filling gaps in the Vinted fixture.
- Re-prompting after `starts_at` edits.

## Success Criteria
- `/<org-slug>/items` and `/<party-id>/items` render for anonymous visitors with the correct nearest public date or the chat-only notice. An organization owner's party-id URL redirects to the slug. Statement counts stay constant.
- Event and term pages show at most the 3 newest items per participant, with a correct "Pokaż więcej (N)" link and item links carrying the context. The event-page query count is unchanged.
- The item page renders every mockup state in the documented precedence. Anonymous ACTIVE items load without login; non-ACTIVE items still redirect to login.
- Event lifecycle:
  - an eligible attendee takes a GIFT or proposes a swap before `starts_at`;
  - the owner accepts;
  - either side confirms or cancels after `starts_at`;
  - success sheets show the event;
  - the end-of-event prompt fires exactly once, including for a withdrawn attendee's swap.
- Delete:
  - before start, deleting cancels open reservations atomically, releases items and sends `RESERVATION_CANCELLED` to both sides;
  - after start with open reservations, delete is refused;
  - confirming a reservation of a deleted event returns 409 `already_resolved`.
- The app starts without import cycles. All existing term take/swap/confirm tests pass unchanged. The migration test passes, and the downgrade refuses while event reservations exist.
- The EXCHANGE organizer layout shows "Ostatnio dodane rzeczy" below the exchange board, linking to `/<slug>/items`.
- `architecture.md` (including the 0073 runbook) and `INDEX.md` describe event reservations, and the 2026-10-29 "read-only event items" statement is removed.
