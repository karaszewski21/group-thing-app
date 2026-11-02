# Codebase Analysis Report

**Date**: 2026-10-31
**Task**: Owner items page, recent items on event/term pages linking to the item page with a `?term=`/`?event=` context, and item reservation on events
**Description**: (1) New items list page for reviewing a user's or organizer's items: user at `/<user-id>/items`, organizer at `/<organization-slug>/items`. The page shows the owner's nearest upcoming term where people can come to pick up or swap; if the owner has no future terms, it shows only chat. (2) Event and term pages: "Zapisani i ich rzeczy" shows the 3 most recently added items, plus "Pokaż więcej" and a link to the item page. The item page accepts `?term=<term-id>` / `?event=<event-id>` and shows the "weź"/"zamienię" reservation buttons plus "napisz" (chat). (3) Implement item reservation on an event.
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

---

## TL;DR
- Part (2) is half built. Both event and term pages already render "Zapisani i ich rzeczy" with 3 items and an in-place "Pokaż wszystkie (N)" toggle. What is missing: newest-first ordering (today the items are sorted by `product_name COLLATE "C"`), a "Pokaż więcej" link to the items page, and item links that carry `?term`/`?event`.
- Part (3) is the hard part. `Reservation.term_id` is a NOT NULL FK to `terms`, and roughly 10 readers (item status/privacy, history, term-end scan, confirm/cancel gates, `GET /api/reservations/{id}`, frontend `ItemStatusCard`/`MyItemsView`/`pendingActions`) assume a reservation always has a term. Migration 0073 is needed: nullable `term_id`, a new `event_id`, and a CHECK that exactly one is set.
- Part (1) needs a new public owner-items endpoint. Today the only list endpoint is `/api/inventory-items/mine`. The endpoint needs id-based owner lookup (`k-` slugs are a one-way hash), a nearest-term query, and a new PUBLIC authorization-matrix row.
- The item page cannot pick "Weź" vs "Zamienię" yet, because `ItemDetailsResponse` lacks the listing mode and the owner party, and the item routes sit behind `AuthGuard`.

## Key Decisions
- **Reservation context is Term XOR Event at the DB level** (nullable `term_id` + `event_id` + CHECK) — this is the smallest schema change that keeps existing term reservations intact.
- **Add a reservation-context abstraction (Term | Event) in groups rather than duplicating take/swap in `app/events`** — `SwapProposal`, accept/reject and confirm/cancel all live in `groups/application/term_item_listings.py`. Duplicating them would split one flow into two. The context provides `occurs_on`/`has_ended`, eligibility, notification wording/link and the context id.
- **Event eligibility = the author, or an active attendee who has an account** — guests have no `account_user_id`, and `Reservation.reserved_by_user_id` is NOT NULL. Reuse `useAccountGate`/`AuthGateSheet` and the guest merge flow.
- **Use the party id for `/<user-id>/items`** — `k-` slugs cannot be resolved back to a party, and `EventParticipantResponse.party_id` is already public.
- **Extend the existing `/api/groups/public/organizers/{slug}` family** for the organizer variant (matrix regex `(/terms|/items)?`), and add a party-id variant for users.
- **Newest-first items come from `ItemListingPreference.created_at DESC`**, capped per party with a `row_number()` window. This keeps `test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant` green.
- **Extract one shared "3 items + show more" component** — `AttendeeList.tsx` and `EventAttendeeList.tsx` are already near-duplicates, so a third copy should not be added.
- **Treat URL `?term`/`?event` as hints only.** The server re-validates context, eligibility and mode. On the item page, a pure `itemActionsViewState.ts` resolves the view.

## Open Questions / Risks
- **Item page access.** `/api/inventory-items/{id}/details` requires READ and the frontend item routes are behind `AuthGuard`. Memory says listed items should be public to anonymous users, but that is not implemented. Decide whether this task opens `/details` (PUBLIC row before row 40, `OptionalPrincipal`, 404 for non-ACTIVE items when the viewer is anonymous) or keeps login-gated links.
- **Owner chat without an item.** "Only chat" when the owner has no future terms: no DIRECT/PARTY conversation kind exists. The options are an ITEM conversation on a chosen item, or a new kind (migration plus access rules). This needs a product decision.
- **Nearest term for a regular user** has no "owned" terms. Should it be derived from the user's nearest active `TermAttendance` (`list_my_attendances_joined`), or should events count too?
- **Should events count as a "nearest upcoming term"** on the items page?
- **`/<user-id>/items` route collision.** A slugified organization name could in theory be UUID-shaped or match `k-<12hex>`. A guard in `organizations/service.py::_generate_unique_slug` is advisable.
- **Event swap timing.** Event reservations have no `occurs_on` date. Map them to `starts_at`/`ends_at`, which are naive Warsaw times, and decide which one gates confirm/cancel ("event has happened").
- **Withdrawal does not cancel reservations** (the same is true for terms today). Confirm this is acceptable for events, and also for event deletion: delete is blocked while there are sign-ups, but reservations need a policy too.
- **Previous scope conflict.** The event-page task explicitly said "Items: read-only; no take/swap" (`.maister/tasks/development/2026-10-29-event-public-page/analysis/requirements.md:19,58`). This task reverses that decision, so docs and tests need updating.
- **Privacy.** The exchange board never exposes the lister. An owner-scoped page reveals the owner by design, so keep owner fields minimal.
- **Existing N+1s.** `list_public_term_item_listings`/`list_browsable_term_item_listings` call `_is_item_available` per item. Do not reuse them for the items page.

---

## Summary

The task spans three bounded contexts: groups (terms, listings, take/swap), events (the new reservation context), and circulation (reservations, item status), plus messaging and the frontend routing/pages. The frontend for part (2) is mostly in place. Part (1) is a new read model following the `OrganizerTermsPage` template. Part (3) requires a schema migration and a cross-cutting generalisation of every `reservation.term_id` reader, which makes it the dominant source of risk.

---

## Files Identified

Paths: backend files are under `src/backend/app/`, frontend files under `src/frontend/src/`.

### Primary Files (backend)

**circulation/models.py** (368 lines)
- `Reservation` (`term_id` NOT NULL FK at about lines 278-282, `paired_reservation_id`, `reserved_by_user_id`, `giver_user_id`) and `InventoryItem` (`added_at`, `listing_status`).
- This is the migration target for event-scoped reservations.

**groups/application/term_item_listings.py** (951 lines)
- Reference flows: `take_item_listing` (473-553, GIFT only), `propose_swap` (587-674), `accept`/`reject_swap_proposal` (677-818), `confirm`/`cancel_transaction` (821-951).
- Also `set_item_listing_preference` (141-190, MAX_GIFT_ITEMS=10), `_resolve_listing_status` (254), `_build_listing_views` and `_list_eligible_lister_party_ids`.
- This is where the reservation-context abstraction plugs in.

**groups/router/term_item_listings.py** (183 lines)
- Routes: `/api/term-item-listings/{item_id}/take|propose`, `/browse`, `/mine`, `/mine-as-taker`, `/api/reservations/{id}/confirm-transaction|cancel-transaction`.

**events/page.py** (169 lines)
- `_listed_items_by_party`: a single statement joining `groups_acl.item_listing_preferences_select` with `circulation_acl.available_items_select`, ordered by product name.
- `get_event_page`: the author first, then attendees.
- Change it to newest-first, a per-party cap of 3 and a total count.

**events/schemas.py** (108 lines)
- `EventParticipantItemResponse(item_id, product_name, mode, thumb_url)`. It has no `added_at` and no per-party total.

**events/service.py** (509 lines)
- `get_event`, `has_ended` (about line 190), `has_active_attendance`, `list_active_attendee_party_ids`, `_require_open`, `sign_up`, `withdraw`.
- Basis for the new `_require_event_eligibility`.

**events/router.py** (143 lines)
- `GET /api/events/{id}` (public). New `/api/events/{id}/items/...` routes go here or into the groups router.

**events/infrastructure/*_acl.py**
- `circulation_acl` (read-only), `groups_acl` (`derive_party_slug`, `item_listing_preferences_select`), `users_acl`, `organizations_acl`, `product_acl`.
- New write paths need ACL extensions plus a `notifications_acl`.

**circulation/application/reservations.py**
- `create_reservation` (line 37): requires AVAILABLE, sets RESERVED, commits.
- `find_reservation_term_occurs_on`.

**circulation/application/item_details.py** (110 lines), **circulation/domain/item_privacy.py** (156 lines)
- `find_reservation_term`, `ReservationTerm` (line 37), `derive_status`, `ItemStatus.term_id/group_id/group_name`.
- Both assume a term. `ItemDetailsResponse` lacks the listing mode and the owner party.

**circulation/infrastructure/repository.py** (436 lines)
- `available_items_with_product_select` (about line 145; no `added_at`), history join (405), `find_reservation_term` (429), `list_active_hand_over_reservations_for_terms` (301), `reservation_ids_for_term_select` (320).

**circulation/router.py**
- Line 229-234: `GET /api/reservations/{id}` returns `term_occurs_on`. This needs a neutral `occurs_on` plus `event_id`.

**groups/application/term_end_scan.py** (244 lines)
- Reads `reservation.term_id`. It must skip event reservations or get an event counterpart.

**groups/infrastructure/repository.py** (1035 lines)
- Nearest-term queries (about lines 755-1060): `_qualifying_owner_circles`, `list_owner_public_circles` (LATERAL next term), `_owner_public_terms_select`, `list_owner_public_terms_page`, `_exchange_candidates`, `list_nearest_exchange_items`.
- Also `item_listing_preferences_select` (about line 689) and `list_my_attendances_joined` (about line 593).

**groups/application/organizer_page.py** (243 lines), **groups/router/organizer_page.py**
- `get_organizer_page`, `list_organizer_terms`, `_resolve_owner` (404s for `k-` slugs).
- Public routes with `CACHE_CONTROL "public, max-age=0, s-maxage=60"`. This is the template for the items endpoint.

**core/authorization_matrix.py** (285 lines)
- Line 88: PUBLIC organizers regex. Lines 170-175: inventory rules. Lines 201-211: event rules. Row 40: `/api/inventory-items/**` GET READ. Row 46: people.
- Rules are first-match-wins.

**circulation/infrastructure/circulation_bridge.py** (under `groups/infrastructure/`)
- `create_reservation(..., term_id)`. It needs to accept the context.

### Primary Files (frontend)

**router.tsx** (262 lines)
- Routes: `/:organizationSlug/terms`, `/:organizationSlug/event/:eventId`, term page, `/product/:id` and `/:organizationSlug/product/:id` (AuthGuard via `OrganizerItemLayout`), `PANEL_VIEWS` (`/items` = `MyItemsView`), catch-all `/:organizationSlug`.
- Add `/:organizationSlug/items` before the catch-all.

**pages/product/ItemDetailPage.tsx** (271 lines)
- `ItemDetailBody`, `ItemViewContent` (reads `?edit=1`), `ItemViewFields`, `AskAboutItemButton` (about lines 244-270, `{kind:"ITEM"}`, shown when `!is_owner && !deleted_at`).
- The new take/swap/chat action row goes here.

**pages/product/useItemRoutes.ts** (33 lines)
- `organizerItemPath`, `FALLBACK_ORGANIZER_SLUG`. Add a builder for `?term`/`?event`.

**pages/product/ItemStatusCard.tsx** (124 lines)
- `partyTerm` requires term and group ids. It needs an event branch.

**pages/events/EventPage.tsx** (235 lines), **pages/events/components/EventAttendeeList.tsx** (111 lines)
- `VISIBLE_ITEMS=3`, `ParticipantItems`, read-only `ItemRow`.

**pages/term/views/PublicTermView.tsx**, **pages/term/components/AttendeeList.tsx** (128 lines), **pages/term/termViewModel.ts**
- `VISIBLE_LISTINGS=3`, `toListingRow`, inline take buttons, `ChatRow`, `buildAttendees`.

**pages/term/hooks/useItemTake.ts** (110 lines)
- `take(itemId, mode)`: GIFT goes through `takeTermItemListing` + `TakeSuccessSheet`; SWAP goes through `SwapProposeDialog` (`fetchMySwapItems`) and `proposeSwap`.
- Generalise it over `{kind: "term" | "event", id}`.

**pages/organizer/OrganizerTermsPage.tsx** (120 lines)
- The page-shell template for the items page.

### Related Files

- **events/models.py**: `Event(author_party_id, starts_at/ends_at` naive Warsaw), `EventAttendance(withdrawn_at)`. No capacity.
- **groups/models.py**: `Term(circle_group_id, occurs_on)`, `TermAttendance`, `ItemListingPreference` (284-314, `item_id` unique, mode GIFT/SWAP, `created_at`), `SwapProposal` (317-359, no `term_id`; context comes via `proposer_reservation_id`), `GiveawayTermEndMarker`.
- **groups/application/attendance.py**: term eligibility at line 37 (active `TermAttendance` or circle organizer).
- **groups/application/public_view.py**: `_listing_thumb_urls` (batched thumbnails).
- **groups/domain/organizer_slug.py**: `derive_party_slug` (one-way blake2s hash).
- **groups/infrastructure/notifications_bridge.py**, **notifications/service.py** (`create_notification`, line 31), **notifications/models.py** (kinds at 37-58, VARCHAR(30) non-native), **notifications/outbox_listener.py**.
- **messaging**: `open_item_conversation` (refuses the owner's own item, 409), `open_term_conversation`, `open_event_conversation`, `access.py`.
- **organizations/slugs.py**: `RESERVED_SLUGS` already contains `items`, `event`, `terms`, `product`. **organizations/service.py**: `_generate_unique_slug` (about lines 36-45).
- **users/router.py**: `/api/people/{id}` and `/by-party/{party_id}` require READ.
- **system/router.py**, **system/public_preview.py**: optional OG preview; `/{slug}/items` falls through to `spa_fallback`.
- **core/pagination.py**: `Pagination` dependency, `Page[T]`, default 20, max 100. **core/clock.py**: `local_now`, `format_term_when`/`format_term_day`, `fit_notification_message`.
- **Frontend organizer blocks**: `blocks/AgendaResults.tsx`, `NextTermCtaBlock.tsx`, `nearestTerm.ts`, `ExchangeBoardBlock.tsx`, `ExchangeItemCard.tsx`, `organizerHelpers.ts`; `hooks/useOrganizerTerms.ts`; `api/pagination.ts`.
- **Frontend term page**: `components/termLabels.ts` (`TAKE_ACTION_LABELS`, `EXCHANGE_MODE_LABELS`, `EXCHANGE_MODE_TONE`), modals (`SwapProposeDialog`, `TakeSuccessSheet`, `AuthGateSheet`), `hooks/useAccountGate.ts`.
- **Frontend other**: `pages/items/MyItemsView.tsx` (97-135 use `term_occurs_on`), `components/pending/pendingActions.ts` (lines 43 and 108 parse `/term/{id}` out of `link_path`).
- **Frontend api/hooks**: `api/events.ts`, `termItemListings.ts`, `items.ts`, `inventories.ts`, `groups.ts`, `conversations.ts`, `notifications.ts` (`NotificationKind` union at 8-14); hooks `useOpenAndNavigate`, `useOpenConversation`, `useEvent`, `useItemDetail`, `useOrganizerPage`, `usePublicOrganization`.
- **Frontend event state**: `eventViewState.ts` (author, attendee, guestAttendee, visitor, refreshing), `EventGuestMergeCard`, `useGuestMerge`.

---

## Current Functionality

### Key Components/Functions

- **ItemListingPreference**: a standing per-item setting (GIFT/SWAP) that is not tied to a term. It toggles `InventoryItem.listing_status` ACTIVE/DRAFT through `circulation_bridge`. PERSONAL inventory only. This is the natural "listed items" source for both the items page and events.
- **take_item_listing**: checks that the term is not past, the taker is eligible, a preference exists, the taker is not the owner, the owner is eligible, the item is AVAILABLE and the mode matches; SWAP is refused. It creates a PENDING reservation with `term_id` and sends the `TERM_ITEM_LISTING_TAKEN` and `ITEM_RESERVED_FOR_PICKUP` notifications, which link to `/product/{item_id}`. No conversation is opened.
- **propose_swap / accept / reject**: the offered item must be the proposer's own PERSONAL, AVAILABLE, SWAP-mode item. The SWAP reservation is pre-confirmed on the proposer's behalf, and a `SwapProposal` is created with status PROPOSED. Accept checks via the proposer reservation's `term_id` that the term is still in the future, pairs the legs and auto-rejects other proposals.
- **confirm/cancel_transaction**: the term must have happened (`TermAlreadyResolvedException`).
- **Events**: no take/swap at all. Items on the event page are read-only. `has_ended` is true when `local_now >= ends_at` (or `starts_at` when there is no end). Guests sign up without an account. The author cannot sign up.
- **Owner pages**: `get_organizer_page`/`list_organizer_terms` resolve organization slugs only; `k-` slugs 404. No endpoint lists another user's or organization's items.
- **Organizations never own items.** `Inventory.owner_user_id` is always a user; an Organization only brands the author party and provides the slug.

### Data Flow

- **Event page**: `GET /api/events/{id}` → `events/page.py` (a single join of preferences, available items and products, plus batched thumbnails and profiles) → `EventDetailResponse.participants[].items[]` → `EventAttendeeList` shows 3 items, then an in-place toggle.
- **Term take**: `PublicTermView` → `useItemTake` → `POST /api/term-item-listings/{item_id}/take|propose` → `term_item_listings` → `circulation_bridge.create_reservation(term_id)` → notifications.
- **Item page**: `GET /api/inventory-items/{id}/details` (READ) → `item_details.find_reservation_term` → `item_privacy.derive_status` → `ItemStatusCard`.

---

## Dependencies

### Imports (What This Depends On)
- SQLAlchemy 2.0 async with Core selects for the single-statement read models, plus Alembic.
- The `clock` module (domain time; `datetime.now()` is banned in groups by `tests/test_domain_clock_guard.py`).
- `core/pagination.py`, `core/authorization_matrix.py`, and `auth_deps` (`ReadPrincipal`/`EditPrincipal`/`OptionalPrincipal`).
- Frontend: TanStack Query 5, react-router-dom 7, Tailwind 4 (not Chakra in practice), and `dayjs` via `utils/dayjs`.

### Consumers (What Depends On This)
Readers of `Reservation.term_id`:
- `circulation/application/item_details.py`
- `circulation/domain/item_privacy.py`
- `circulation/infrastructure/repository.py` (4 queries)
- `circulation/router.py`
- `groups/application/term_end_scan.py`
- the accept/confirm/cancel flows in `groups/application/term_item_listings.py`
- frontend `ItemStatusCard.tsx`, `MyItemsView.tsx`, `pendingActions.ts`

Readers of the event-page response shape: `EventAttendeeList.tsx`, `EventPage.tsx`, and the key sets in `test_event_page.py`.

**Consumer count**: about 11 files touch `term_id` semantics.
**Impact scope**: High. Making `term_id` nullable is cross-cutting, and every reader needs an explicit event branch or guard.

---

## Test Coverage

### Test Files
- **Backend events**: `test_event_page.py` (exact `DETAIL_KEYS`/`PARTICIPANT_KEYS`/`ITEM_KEYS`, a query-count invariant, helpers `_listed_items`/`_set_balance`/`_sign_up`/`_populated_event`), `test_events.py`, `test_event_attendance.py`, `test_event_conversations.py`, `test_attendance_withdrawal.py`.
- **Backend listings**: `test_term_item_listings.py`, `test_term_item_listings_router.py`, `test_reservation_write_guards.py`, `test_public_term.py`, `test_term_end_scan.py`.
- **Backend items**: `test_item_details.py`, `test_item_listing_status.py`, `test_item_conversations.py`, `test_messaging_cross_context.py`, `test_notifications.py`.
- **Backend owner pages**: `test_authorization_matrix.py`, `test_organizer_page.py`, `test_organizer_page_queries.py`, `test_organizations.py`, `test_public_preview.py`.
- **Frontend**: `EventPage.test.tsx` (including a `matchRoutes` route test at about line 328), `TermPage.test.tsx`, `ItemDetailPage.test.tsx`, `OrganizerItemRoute.test.tsx` (asserts anonymous visitors are redirected to login), `PublicOrganizationPage.test.tsx`, `useItemDetail.test.tsx`, `useOpenConversation.test.tsx`, `NotificationBell.test.tsx`, `TermAttendeesPage.test.tsx`, `termViewState.test.ts`, `eventViewState.test.ts`, `OrganizerTermsPage.test.tsx`, `useOrganizerTerms.test.tsx`.

### Coverage Assessment
- **Test count**: the term take/swap flows and the event page are well covered (20+ relevant test files). New behaviour (event reservations, the owner-items endpoint, the item-page action view state) has no coverage.
- **Gaps**:
  - Migration test for 0073: downgrade then upgrade head. Downgrade must handle rows that have `event_id` set.
  - Regression tests showing term reservations still behave identically after `term_id` becomes nullable.
  - `term_end_scan` with event reservations present.
  - A query-count invariant for the new items endpoint.

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase `.tsx` per component; blocks live under `pages/organizer/blocks/`.
- **Functions/hooks**: `useX` in `src/hooks/` wrapping `src/api/*.ts`; `*_KEY` query-key prefix constants; view state lives in a pure `resolve…View()` in `*ViewState.ts`.
- **Backend**: router → application → infrastructure layering; cross-context access only through `infrastructure/<other>_acl.py`; `EntityNotFoundException` maps to 404, `BusinessConflictException` to 409.
- **Tests**: flat `tests/test_<feature>.py` named `test_<op>_<scenario>_<expected>`; frontend tests in `src/test/` with explicit vitest imports.

### Architecture Patterns
- **Style**: functional services plus SQLAlchemy Core read models (single statement, batched `IN` lookups); public endpoints set `Cache-Control`.
- **State management**: TanStack Query hooks returning `{data, loading, notFound, error, refetch}`; pages `switch` on `view.kind`.
- **Templates to clone**:
  - `OrganizerTermsPage` + `AgendaResults` + `useOrganizerTerms` → items page, `ItemsResults` and an infinite hook.
  - `ExchangeItemCard` grid → item cards.
  - `NextTermCtaBlock` → the nearest-term box.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | `term_item_listings.py` 951 lines, `groups/infrastructure/repository.py` 1035 lines | High |
| Dependencies | groups, events, circulation, messaging, notifications, organizations, users | High |
| Consumers | about 11 `term_id` readers, plus the event-page response consumers | High |
| Test Coverage | Strong for existing flows, none for the new ones | Medium |

### Overall: Complex
There are three features. One of them (event reservations) changes a core invariant (every reservation has a term) across three bounded contexts and needs a migration with a careful downgrade.

---

## Key Findings

### Strengths
- `ItemListingPreference` already decouples listing from terms, so it can be reused unchanged for events and the items page.
- `events/page.py` already uses the correct single-statement pattern with a query-count test.
- Mature frontend templates exist for owner-scoped public pages, paginated lists, item cards and take/swap modals.
- `RESERVED_SLUGS` already includes `items`.

### Concerns
- `term_id` NOT NULL is assumed everywhere, both in backend status derivation and in frontend link parsing.
- `SwapProposal` derives its date context through the proposer reservation's term, so it has no direct context column.
- Item routes are login-gated, so a public items page will funnel anonymous users to login.
- No owner-level chat kind exists.
- The 3-items toggle is already duplicated.

### Opportunities
- A reservation-context abstraction would clean up term coupling in circulation (a neutral `occurs_on`).
- One shared `ParticipantItemsPreview` component could serve the event page, the term page and possibly the items page.
- Opening `/details` for ACTIVE listed items would fulfil the intended public visibility recorded in memory.

---

## Impact Assessment

- **Primary changes**:
  - Migration `0073`.
  - `circulation/models.py`, `circulation_bridge`, `circulation/application/reservations.py`.
  - `term_item_listings.py` (context abstraction) and the new event take/propose routes.
  - `events/page.py` + `schemas.py` (newest-first, `total`).
  - A new owner-items read model and router in groups.
  - The authorization matrix.
  - Frontend: `router.tsx`, a new items page, `ItemDetailPage` + `itemActionsViewState.ts`, `useItemTake` generalisation, a shared items-preview component, `useItemRoutes`.
- **Related changes**:
  - `item_details.py`, `item_privacy.py`, the circulation repository queries, `circulation/router.py`, `term_end_scan.py`.
  - Notifications (event wording and link; possibly new kinds plus the frontend union).
  - `ItemStatusCard`, `MyItemsView`, `pendingActions`, `api/items.ts` (mode and owner on details).
  - Optionally the `_generate_unique_slug` guard and an OG preview.
- **Test updates**:
  - Key sets in `test_event_page.py`, `test_item_details.py` and `test_authorization_matrix.py`.
  - New `test_event_item_reservations.py`, `test_owner_items_page.py` and the migration test.
  - Frontend: `EventPage`, `TermPage` and `ItemDetailPage` tests, plus new view-state table tests.

### Risk Level: Medium-High
The reservation schema change touches money-like state (balance status, paired swap legs) and term-end processing. A missed `term_id` reader would cause 500s or wrong item status. Parts (1) and (2) are low-to-medium risk because they are additive read paths.

---

## Recommendations

**Implementation strategy (modify existing + new capability):**

1. **Phase the work**: (2) recency and links → (1) items page → (3) event reservations. The first two are additive and unblock UI. The third carries the risk.

2. **Migration 0073**:
   - `reservations.term_id` becomes nullable.
   - Add `event_id UUID NULL` with FK `fk_reservations_event_id_events`; choose ON DELETE RESTRICT, or block event delete while reservations exist.
   - Add a CHECK `(term_id IS NULL) <> (event_id IS NULL)` and a partial index on `event_id`.
   - `downgrade()` must delete or handle event reservations, and their paired legs and swap proposals, before restoring NOT NULL.
   - Add a pytest that downgrades and then upgrades to head.

3. **Reservation context**: introduce a small `ReservationContext` (kind, id, `occurs_on`/`starts_at`, `has_ended`, `require_eligibility(principal, owner_party)`, notification phrase and link) inside `groups/application`. Event data comes through a new `groups/infrastructure/events_acl.py`, not through `events` importing groups writes. Parameterise `take_item_listing`/`propose_swap`/accept/confirm/cancel on it, and keep the term behaviour byte-identical (guard it with the existing tests).

4. **Event endpoints**: add `POST /api/events/{event_id}/items/{item_id}/take|propose` (EDIT, authenticated) or the context-neutral equivalent. Add matrix rows explicitly rather than relying on the catch-all.

5. **Circulation readers**:
   - Give `item_privacy`/`item_details`/history an event branch.
   - Have `GET /api/reservations/{id}` return `event_id` + `occurs_on` and keep `term_occurs_on` for compatibility.
   - Make `term_end_scan` filter `term_id IS NOT NULL`.
   - Teach `pendingActions.ts` to parse `/event/{id}` links.

6. **Item details**: extend `ItemDetailsResponse` with `listing_mode` and `owner_party_id`, or add a context endpoint such as `GET /api/events/{id}/items/{item_id}` returning `{mode, can_take, reason}`. Add a pure `itemActionsViewState.ts` covering `none | ownItem | takeable{modes, context} | chatOnly | expired | loading`, table-tested with `it.each`.

7. **Items page**:
   - Add `GET /api/groups/public/organizers/{slug}/items` and `GET /api/groups/public/parties/{party_id}/items`: paginated `Page[T]`, newest-first by `ItemListingPreference.created_at`, `nearest_term` from the existing LATERAL queries (owner circles for organizers; attendances for users, pending a decision), and `Cache-Control` set.
   - Add PUBLIC matrix rows.
   - Keep the number of statements constant and assert it with `count_queries`.

8. **Event and term pages**: order with `row_number() OVER (PARTITION BY owner_party_id ORDER BY created_at DESC)` capped at 3, add `items_total`, and replace the in-place toggle with a "Pokaż więcej" link to the owner's items page. Item links carry `?event=`/`?term=`. Extract one shared preview component.

9. **Chat**: reuse `AskAboutItemButton` (ITEM conversation) on the item page. For the "only chat" state on the items page, pick from the open question above. The minimal option is item-level chat only.

10. **Security**: re-validate the context server-side (the item is listed, the owner is eligible in that context, and the context has not ended). Never trust URL params. Guests are gated through `useAccountGate`.

---

## Next Steps

Invoke the gap-analyzer with this report. It should prioritise resolving the Open Questions (public item-page access, owner-level chat, the regular user's "nearest term", event confirm/cancel timing, and the deletion/withdrawal policy for event reservations) before specification. It should also confirm with the user that this task reverses the previous "read-only items on events" decision.
