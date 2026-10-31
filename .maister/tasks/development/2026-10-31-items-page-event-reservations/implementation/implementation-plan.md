# Implementation Plan: Owner items page, participants preview, context item page, event reservations

## TL;DR
18 task groups, 105 steps: 9 backend groups, 7 frontend groups, then a test review and a documentation group.
- The backend starts with three independent groups: the 0073 schema and shared infrastructure, the authorization matrix, and the participants-preview read models.
- The read paths (owner items, item actions, circulation readers) and the reservation write paths (ReservationContext, the end-of-event scan, event delete) then build on those three.
- Each frontend group depends only on the backend group whose API it consumes.
- Test review and documentation close the plan.

## Key Decisions
- **`groups/infrastructure/events_acl.py` is written in full in Group 1** (event lookup, `FOR SHARE` lock, eligibility, upcoming events, events in a start window, author slug) — Groups 3, 5, 7 and 8 all read events. If each of them edited the ACL, all four would have to run one after another.
- **All authorization-matrix rows go in one standalone group (Group 2)** — `core/authorization_matrix.py` and its test file would otherwise be touched by four route groups. The rows are pure regex data and can land before their routes.
- **The `_for_events` circulation readers (hand-over list, reservation-id select, open-reservations-by-event) belong to Group 6** — the circulation repository and bridge then change in only two groups (1 and 6). The scan (Group 8) and delete (Group 9) only call them.
- **Event delete tests go in a separate file, `tests/test_event_reservation_delete.py`** — `tests/test_event_item_reservations.py` (Group 5) and the delete group can then be written independently. The spec lists the delete cases under the first file; the coverage is the same.
- **The take flow (Group 13) is split from the item-page view state (Group 14)** — the generalised `useItemTake`/`TakeSuccessSheet` is shared with the term page and only needs the event write API (Group 5). The view state needs the actions read model (Group 7).
- **The item page sends a context parameter only when exactly one of `?term`/`?event` is present** — with both, it sends neither and renders `noContext`. This avoids the endpoint's 400 for a malformed URL.
- **The organizer "Ostatnio dodane rzeczy" block (Group 12) uses the owner-items shared card as its visual reference** — no dedicated mockup exists. The spec says it reuses the shared item card and the `UpcomingTermsBlock` header styling.
- **Group 15 (status card, success sheet, pending actions) has no Visual References** — no design-context screen covers these surfaces. They keep the existing component styling and gain only an event branch.

## Open Questions / Risks
- **Shared-file contention limits parallelism.** Groups that edit the same files must run one after another:
  - `groups/schemas.py`: Groups 3, 4, 5, 7.
  - `groups/router/__init__.py`: Groups 5, 7.
  - `events/schemas.py`, `events/page.py`, `tests/test_event_page.py`: Groups 4, 9.
  - `api/events.ts`: Groups 10, 16.
  - `api/groups.ts`: Groups 10, 12.
  - `src/test/TermPage.test.tsx`: Groups 10, 13.
  - `router.tsx`: Groups 11, 14.
- **About 13 context readers.** Group 6 and Group 5 (`_resolve_transaction_reservations_for_action`, accept) must cover every row of the spec's reader table. Group 17 cross-checks the table against tests.
- **Term regression gate.** Group 5 refactors `term_item_listings.py` (951 lines) onto `ReservationContext`. The existing `test_term_item_listings*.py` and `test_reservation_write_guards.py` must pass unchanged. A failure there blocks every later group that depends on Group 5.
- **Import cycles.** `events_acl` must import only `app.events.models`, and circulation must reach events only through Core tables. Group 1 adds a subprocess import test that guards the first rule.
- **Strict key-set tests change on purpose** in Groups 3, 4, 6, 9 and 14. Each update must change the expected set exactly as specified and must never loosen the assertion.

## Overview
Total Steps: 105
Task Groups: 18 (16 implementation, 1 test review, 1 documentation)
Expected Tests: ~70-100 (16 implementation groups at 2-8 each, plus up to 10 gap tests)

Paths: backend under `src/backend/` (app code in `src/backend/app/`, tests in `src/backend/tests/`); frontend under `src/frontend/src/`.

## Implementation Steps

### Task Group 1: Reservation Schema & Shared Infrastructure
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0073_event_reservations.py`, `src/backend/app/circulation/models.py`, `src/backend/app/circulation/application/reservations.py`, `src/backend/app/circulation/application/reservation_transitions.py`, `src/backend/app/circulation/service.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/groups/infrastructure/events_acl.py`, `src/backend/app/notifications/models.py`, `src/backend/tests/test_event_reservations_migration.py`, `src/backend/tests/test_circulation_bulk_cancel.py`, `src/backend/tests/test_notifications.py`
**Estimated Steps:** 8

- [x] 1.0 Complete reservation schema and shared infrastructure layer
  - [x] 1.1 Write 6-8 focused tests
    - `test_event_reservations_migration.py`:
      - `downgrade 0072` then `upgrade head` succeeds;
      - the downgrade refuses while a `term_id IS NULL` row exists, and the message names the recovery path;
      - CHECK `ck_reservations_context` rejects an open row with no context and a row with both contexts;
      - deleting an event sets `event_id` to NULL on a terminal (CANCELLED/COMPLETED) row.
    - `test_circulation_bulk_cancel.py`:
      - `cancel_reservations_without_commit` releases balances and skips terminal rows;
      - it does not commit: a session rollback restores the PENDING rows;
      - `create_reservation` raises `ValueError` with zero or two contexts.
    - `test_notifications.py`: `RESERVATION_CANCELLED` round-trips through persistence and `GET /mine`.
    - Import guard (subprocess): importing `app.groups.infrastructure.events_acl` does not load `app.events.service`.
  - [x] 1.2 Create `0073_event_reservations.py` (`down_revision` 0072)
    - `term_id` becomes nullable.
    - Add `event_id UUID NULL` with FK `fk_reservations_event_id_events` (`ON DELETE SET NULL`).
    - Add CHECK `ck_reservations_context`: `num_nonnulls(term_id, event_id) <= 1 AND (status NOT IN ('PENDING','CONFIRMED') OR num_nonnulls(term_id, event_id) = 1)`.
    - Add the partial index `ix_reservations_event_id` (`WHERE event_id IS NOT NULL`).
    - `downgrade()`:
      - when rows with `term_id IS NULL` exist, raise an error that names the recovery path: cancel and purge event reservations and their ledger references manually, or restore a pre-0073 backup;
      - otherwise drop the CHECK, the index, the FK and the column, then restore NOT NULL (reverse order).
  - [x] 1.3 Update `Reservation` in `circulation/models.py`
    - `term_id: Mapped[uuid.UUID | None]`.
    - New `event_id: Mapped[uuid.UUID | None]`: a plain FK-id column with no `relationship()`.
    - Declare the `CheckConstraint` and the partial `Index` in `__table_args__`.
    - Confirm `alembic revision --autogenerate` reports no drift, then delete the generated file.
  - [x] 1.4 Context kwargs on `create_reservation`
    - `circulation.service.create_reservation(..., term_id=None, event_id=None)` raises `ValueError` unless exactly one is given.
    - `circulation_bridge.create_reservation` takes the same kwargs.
    - Existing term callers pass `term_id=` by keyword. `CreateReservationRequest` stays term-only.
  - [x] 1.5 Add `cancel_reservations_without_commit(db, reservation_ids)` in `reservation_transitions.py`
    - Lock the rows `FOR UPDATE`, skip terminal rows, and apply the `_cancel` transition (CANCELLED, balance released) without the party check.
    - Flush only; never commit.
    - Export it from `circulation.service` and `groups/infrastructure/circulation_bridge.py`.
  - [x] 1.6 Add `RESERVATION_CANCELLED` to `NotificationKind` (`notifications/models.py`)
    - Extend the docstring's recipient list: it "goes to both parties of a reservation or swap cancelled because its event was deleted".
    - No migration is needed (non-native `VARCHAR(30)`, 21 characters).
  - [x] 1.7 Create `groups/infrastructure/events_acl.py`
    - Import only `app.events.models` (`Event`, `EventAttendance`), plus `organizations_acl` and `groups.domain.organizer_slug.derive_party_slug` for slugs.
    - Functions:
      - `get_event(db, event_id)`;
      - `lock_event_for_share(db, event_id)`;
      - `is_event_eligible(db, event, party_id)`: the author, or an active attendance whose party has an `account_user_id`;
      - `list_upcoming_events_for_parties(db, party_ids, now)`: authored or actively attended, earliest first, with attendee count and location name;
      - `list_events_starting_between(db, start, end)`;
      - `author_slugs(db, events)`.
    - Reuse: `sign_up`'s `FOR SHARE` pattern from `events/service.py`.
  - [x] 1.8 Ensure the Group 1 tests pass
    - Run ONLY the tests written in 1.1 (`uv run python -m pytest tests/test_event_reservations_migration.py tests/test_circulation_bulk_cancel.py tests/test_notifications.py` from `src/backend`).

**Acceptance Criteria:**
- The 6-8 tests pass.
- The migration upgrades and downgrades cleanly; the downgrade is guarded while event rows exist.
- Autogenerate reports no drift for `reservations`.
- `events_acl` imports only model modules from events.

### Task Group 2: Authorization Matrix Rows
**Dependencies:** None
**Files to Modify:** `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 3

- [x] 2.0 Complete authorization matrix layer
  - [x] 2.1 Write 4-6 focused matrix tests
    - Anonymous GET is allowed (PUBLIC) for:
      - `/api/groups/public/organizers/{slug}/items`;
      - `/api/groups/public/parties/{id}/items`;
      - `/api/inventory-items/{id}/details`;
      - `/api/items/{id}/actions`.
    - `POST /api/events/{id}/items/{item}/take|propose` requires EDIT.
    - The ordering holds: the parties row matches before the blanket `/api/groups` READ row, and the `/details` row before row 40 (`/api/inventory-items/**` GET READ). Other `/api/inventory-items` GETs stay READ.
  - [x] 2.2 Add the Requirement 34 rows
    - Extend the PUBLIC organizers regex to `(/terms|/items)?`.
    - Add PUBLIC `GET ^/api/groups/public/parties/[^/]+/items$` ahead of the `/api/groups` READ row.
    - Add PUBLIC `GET ^/api/inventory-items/[^/]+/details$` ahead of row 40.
    - Add PUBLIC `GET ^/api/items/[^/]+/actions$`.
    - Add EDIT `POST ^/api/events/[^/]+/items/[^/]+/(take|propose)$` in the events block.
  - [x] 2.3 Ensure the matrix tests pass
    - Run ONLY `tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- The 4-6 tests pass.
- First-match-wins ordering is verified for every new row.

### Task Group 3: Owner Items & Organizer Read Models (backend)
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/groups/application/owner_items.py`, `src/backend/app/groups/application/organizer_page.py`, `src/backend/app/groups/router/organizer_page.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/organizations/service.py`, `src/backend/tests/test_owner_items_page.py`, `src/backend/tests/test_organizer_page.py`
**Estimated Steps:** 8

- [x] 3.0 Complete owner items read-model layer
  - [x] 3.1 Write 6-8 focused tests (`test_owner_items_page.py`, plus updates to `test_organizer_page.py`)
    - Organization-slug variant: exact response key set and `Cache-Control: public, max-age=0, s-maxage=60`.
    - 404s: unknown slug, `k-` slug, and a party with no user profile. The party-id variant also has a success case.
    - `mode=GIFT` filters items while `counts` ignores it; ordering is by preference `created_at DESC`, then id; `page`/`size` pagination works.
    - `nearest`:
      - excludes private-circle terms;
      - picks the earliest of the term and event candidates;
      - an attended term's `path` uses the circle organizer's slug.
    - `count_queries` is the same for 1 and 5 listed items.
    - Organizer page: `recent_items` (4 newest) and `owner_nearest` appear even with no circles, and the key set is updated.
    - A UUID-shaped organization name gets a non-UUID slug (`_generate_unique_slug` guard).
  - [x] 3.2 Add repository queries (`groups/infrastructure/repository.py`)
    - An owner listed-items page select: preferences joined with ACTIVE+AVAILABLE items via `circulation_bridge.available_items_with_product_select`, `added_at` from the preference's `created_at`, SQL `LIMIT`/`OFFSET`.
    - A grouped mode-count query.
    - `nearest_public_term_for_party(party_id, now)`:
      - covers terms of PUBLIC, non-deleted circles the party leads or actively attends, with `occurs_on >= now`;
      - returns `LIMIT 1` with the attendee count and location name.
    - Reuse: `_qualifying_owner_circles`, `item_listing_preferences_select`, `count_active_attendances_by_term`.
  - [x] 3.3 Implement `groups/application/owner_items.py`
    - Resolve the owner: organization slug via `_resolve_owner`; party id via its profile, else 404.
    - Build `OwnerItemsPageResponse`: thumbnails via `_listing_thumb_urls`, `owner.slug` = the Organization slug or null.
    - Compute `nearest` from the repository term plus `events_acl.list_upcoming_events_for_parties`, taking the earlier.
      - Term path: `/{resolve_organizer_slug(group_id)}/group/{group_id}/term/{id}`.
      - Event path: `/{author_slug}/event/{id}`.
    - Expose `get_owner_nearest(db, party_id)`, `list_owner_recent_items(db, party_id, limit)` and `count_owner_items(db, party_id)` for Groups 7 and 3.6.
    - Use `clock.local_now()` only.
  - [x] 3.4 Add schemas in `groups/schemas.py`
    - `OwnerItemsPageResponse`, `OwnerSummaryResponse`, `OwnerItemCardResponse {item_id, product_name, condition, mode, thumb_url, added_at}`, `OwnerNearestDateResponse {kind, id, name, starts_at, location_name, attendee_count, path}`, `OwnerItemCountsResponse {GIFT, SWAP}`.
  - [x] 3.5 Add routes in `groups/router/organizer_page.py`
    - `GET /api/groups/public/organizers/{slug}/items` and `GET /api/groups/public/parties/{party_id}/items`.
    - Use the `Pagination` dependency (default 20) and an optional `mode`; set `CACHE_CONTROL`.
    - Add no auth dependency (PUBLIC rows).
  - [x] 3.6 Organizer page: add `recent_items` and `owner_nearest` to `OrganizerPageResponse`
    - Compute both before the no-circles early return; compute `owner_nearest` only when `recent_items` is non-empty.
    - `_empty_page(recent_items, owner_nearest)` becomes a function taking the two values.
  - [x] 3.7 Slug guard: `organizations/service.py::_generate_unique_slug` treats UUID-shaped candidates as reserved.
  - [x] 3.8 Ensure the owner-items tests pass
    - Run ONLY `tests/test_owner_items_page.py` and `tests/test_organizer_page.py`.

**Acceptance Criteria:**
- The 6-8 tests pass.
- The statement count is constant in the number of items.
- Private-circle dates never appear.
- `k-` slugs return 404.

### Task Group 4: Participants Preview Read Models (backend)
**Dependencies:** None
**Files to Modify:** `src/backend/app/events/page.py`, `src/backend/app/events/schemas.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/tests/test_event_page.py`, `src/backend/tests/test_public_term.py`
**Estimated Steps:** 5

- [x] 4.0 Complete participants preview read-model layer
  - [x] 4.1 Write 3-5 focused tests
    - A participant with 5 listed items returns the 3 newest (by preference `created_at`) with `items_total == 5`.
    - `ITEM_KEYS` gains `added_at` and `PARTICIPANT_KEYS` gains `items_total` (exact sets).
    - `test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant` still passes.
    - Public term listings carry `added_at` as naive UTC.
  - [x] 4.2 Rewrite `events/page.py::_listed_items_by_party`
    - Use `row_number() OVER (PARTITION BY owner_party_id ORDER BY created_at DESC, item_id)` with a cap of 3, and `count(*) OVER (PARTITION BY owner_party_id)` for `items_total`.
    - Keep it a single statement.
  - [x] 4.3 Add `EventParticipantItemResponse.added_at` and `EventParticipantResponse.items_total` in `events/schemas.py`.
  - [x] 4.4 Add `PublicItemListingResponse.added_at` (the preference's `created_at`), filled in `groups/application/public_view.py`.
  - [x] 4.5 Ensure the preview tests pass
    - Run ONLY `tests/test_event_page.py` and `tests/test_public_term.py`.

**Acceptance Criteria:**
- The 3-5 tests pass.
- The event-page query count is unchanged.

### Task Group 5: Reservation Context & Event Reservation Writes (backend)
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/groups/application/reservation_context.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/router/event_item_listings.py`, `src/backend/app/groups/router/__init__.py`, `src/backend/app/groups/schemas.py`, `src/backend/tests/test_event_item_reservations.py`
**Estimated Steps:** 8

- [x] 5.0 Complete reservation context and event write layer
  - [x] 5.1 Write 6-8 focused tests (`test_event_item_reservations.py`)
    - GIFT take by an eligible attendee returns `{item_id, product_name, context}` and sends `TERM_ITEM_LISTING_TAKEN` and `ITEM_RESERVED_FOR_PICKUP` with event wording.
    - 403 for an ineligible taker, an ineligible owner, and a guest (no-account) attendee.
    - 409 "Wydarzenie już się rozpoczęło" after `starts_at` (`freeze_local_now`).
    - Propose → accept before start → confirm after start succeeds.
    - Confirm before start returns 409 "Wydarzenie jeszcze się nie rozpoczęło".
    - Withdrawing the attendance keeps the reservation.
    - Confirm on a CANCELLED reservation with no context (seeded via SQL) returns 409 `already_resolved`.
  - [x] 5.2 Create `groups/application/reservation_context.py`
    - `TermContext | EventContext` providing:
      - `kind`, `id`, the date (`occurs_on`/`starts_at`), `has_started`;
      - `require_eligibility(party_id)` (term: `_require_term_eligibility` semantics; event: `events_acl.is_event_eligible`);
      - `display_name`, `when_text` (`clock.format_term_when`), `link_path`;
      - `reservation_kwargs()`;
      - `to_response()`, returning the `ItemContextResponse` shape;
      - `load_for_reservation(reservation)`, which returns None when both context columns are NULL.
    - `has_started` uses `clock.local_now()`.
  - [x] 5.3 Refactor `take_item_listing` and `propose_swap` onto `ReservationContext`
    - The term entry points keep their signatures, messages and response values.
    - Event entry points load the event via `events_acl.lock_event_for_share` before the first write.
  - [x] 5.4 Refactor `accept_swap_proposal`
    - The context comes from the proposer reservation, and the owner leg is written with the same context kwargs.
    - Event accept locks the event `FOR SHARE`; a context of None returns 409.
  - [x] 5.5 Change the gate order in `_resolve_transaction_reservations_for_action`
    - Check terminal or already-resolved status first (`TermAlreadyResolvedException`), then the context.
    - Event confirm/cancel are allowed only when `clock.local_now() >= starts_at`; `starts_at` is read live.
  - [x] 5.6 Event notification wording
    - Reuse the existing kinds.
    - Messages use the event name plus `format_term_when(starts_at)`, capped with `fit_notification_message`.
    - `link_path` follows the term conventions.
  - [x] 5.7 Add schemas and routes
    - Schemas: `EventTakeRequest {reservation_type}`, `EventProposeRequest {offered_item_id}`, `ItemContextResponse {kind, id, name, starts_at, path, has_started}`, `EventTakeResponse {item_id, product_name, context}`.
    - `groups/router/event_item_listings.py`: `POST /api/events/{event_id}/items/{item_id}/take|propose` with `Depends(require_any(EDIT))`; registered in `groups/router/__init__.py`.
    - Errors: 404 unknown event or item; 403 ineligible; 409 started, own item, unavailable, mode mismatch, or SWAP via take.
  - [x] 5.8 Ensure the Group 5 tests and the term regression gate pass
    - Run `tests/test_event_item_reservations.py`.
    - Run unchanged: `tests/test_term_item_listings.py`, `tests/test_term_item_listings_router.py`, `tests/test_term_item_listings_model.py`, `tests/test_reservation_write_guards.py`, `tests/test_domain_clock_guard.py`.

**Acceptance Criteria:**
- The 6-8 new tests pass.
- Every existing term take/swap/confirm test passes without edits.
- The app imports without cycles.

### Task Group 6: Circulation Context Readers (backend)
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/circulation/application/item_details.py`, `src/backend/app/circulation/domain/item_privacy.py`, `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/application/reservations.py`, `src/backend/app/circulation/router.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/service.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/tests/test_item_details.py`, `src/backend/tests/test_event_reservation_readers.py`
**Estimated Steps:** 7

- [x] 6.0 Complete circulation context reader layer
  - [x] 6.1 Write 5-7 focused tests
    - `test_item_details.py`:
      - item status for an event reservation has `event_id` and `event_slug`, `term_occurs_on` = `starts_at`, and `group_name` = the event name;
      - anonymous `/details` on an ACTIVE item returns 200 with no counterparty labels;
      - anonymous `/details` on a DRAFT or deleted item returns 404;
      - status key sets are updated.
    - `test_event_reservation_readers.py`:
      - `GET /api/reservations/{id}` for an event row returns `event_id` and the context date;
      - the history row of an event reservation shows `starts_at`;
      - the `_for_events` selects return only event rows, and the term selects exclude them.
  - [x] 6.2 Circulation repository
    - Add Core references `_events` and `_organizations`.
    - `find_reservation_term` returns None for event or context-less rows.
    - Add `find_reservation_event` (date, name, author slug via `_organizations` + `derive_party_slug`).
    - The history join outer-joins `_events` with `coalesce(term occurs_on, event starts_at)`.
  - [x] 6.3 Event branch in `item_privacy.derive_status` / `item_details`
    - `ItemStatus` and `ItemStatusResponse` gain `event_id` and `event_slug`.
    - `term_occurs_on`/`group_name` carry the event date and name.
  - [x] 6.4 `GET /api/inventory-items/{id}/details` accepts `OptionalPrincipal`
    - Anonymous callers get 404 unless the item is `listing_status=ACTIVE` and not deleted; `derive_status` runs with `viewer=None`.
    - Logged-in behaviour is unchanged.
  - [x] 6.5 Reservation responses
    - `ReservationResponse.term_id` becomes nullable and gains `event_id`.
    - `GET /api/reservations/{id}` puts the context date in `term_occurs_on`.
    - `find_reservation_term_occurs_on` returns None for event rows.
  - [x] 6.6 Add `_for_events` siblings, exported via `circulation.service` and `circulation_bridge`
    - `list_active_hand_over_reservations_for_events`, `reservation_ids_for_event_select(event_id)`, `list_open_reservations_for_event(event_id)`.
  - [x] 6.7 Ensure the reader tests pass
    - Run ONLY `tests/test_item_details.py` and `tests/test_event_reservation_readers.py`.

**Acceptance Criteria:**
- The 5-7 tests pass.
- Every circulation reader row in the spec's context-reader table has an event branch or a confirmed unchanged path.
- Anonymous `/details` leaks no counterparty data.

### Task Group 7: Item Actions Read Model (backend)
**Dependencies:** 3, 5
**Files to Modify:** `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/router/item_actions.py`, `src/backend/app/groups/router/__init__.py`, `src/backend/app/groups/schemas.py`, `src/backend/tests/test_item_actions.py`
**Estimated Steps:** 5

- [x] 7.0 Complete item actions read-model layer
  - [x] 7.1 Write 5-7 focused tests (`test_item_actions.py`)
    - `viewer` is ANONYMOUS, OWN, ELIGIBLE or NOT_ELIGIBLE for an event context; ELIGIBLE also for a term context.
    - Both `term` and `event` given → 400.
    - A started context returns `has_started=true`.
    - A private-term context is null for a non-eligible viewer and present for an eligible one.
    - An owner who is not eligible in the context → `context=null`.
    - No listing preference → `mode=null`; `owner.items_total` and `nearest` are populated.
  - [x] 7.2 Implement `groups/application/item_actions.py`
    - Load the item, its preference and availability via `circulation_bridge`; resolve the owner party; `items_total` via `owner_items.count_owner_items`.
    - The context, built via `ReservationContext`, is returned only when it exists, the owner is eligible, and it is public or the viewer is eligible.
    - Classify the viewer; `nearest` comes from `owner_items.get_owner_nearest`.
  - [x] 7.3 Add the `ItemActionsResponse {mode, available, owner {party_id, display_name, slug, items_total}, context, viewer, nearest}` schema, reusing `ItemContextResponse` and `OwnerNearestDateResponse`.
  - [x] 7.4 Add `groups/router/item_actions.py`
    - `GET /api/items/{item_id}/actions?term=|event=` with `OptionalPrincipal` and no auth dependency.
    - Register it in `groups/router/__init__.py`.
  - [x] 7.5 Ensure the item-actions tests pass
    - Run ONLY `tests/test_item_actions.py`.

**Acceptance Criteria:**
- The 5-7 tests pass.
- URL params are treated as hints only: eligibility and context visibility are decided on the server.

### Task Group 8: End-of-Event Scan (backend)
**Dependencies:** 5, 6
**Files to Modify:** `src/backend/app/groups/application/term_end_scan.py`, `src/backend/app/notifications/outbox_listener.py`, `src/backend/tests/test_term_end_scan.py`
**Estimated Steps:** 5

- [x] 8.0 Complete end-of-event scan layer
  - [x] 8.1 Write 3-5 focused tests (extend `test_term_end_scan.py`)
    - The event GIFT reservation prompts both parties with `reservation_id` and `link_path=/{author_slug}/event/{id}`; a second run sends nothing (idempotent).
    - A withdrawn attendee's ACCEPTED swap is still prompted.
    - Swap prompts carry a per-party `reservation_id`: the owner gets `proposer_reservation_id`, the proposer gets `paired_reservation_id`.
    - The existing term prompts are unchanged (the existing tests stay green).
  - [x] 8.2 Add the event pass to `term_end_scan`
    - Window: events from `events_acl.list_events_starting_between`, triggering at `starts_at + TERM_END_GRACE`.
    - GIFT: `list_active_hand_over_reservations_for_events`.
    - SWAP: ACCEPTED, not-yet-notified proposals whose `proposer_reservation_id` is in `reservation_ids_for_event_select`.
    - The pass is reservation-driven and ignores eligibility and listing preferences. It reuses the `GiveawayTermEndMarker` and `term_ended_notified_at` markers.
  - [x] 8.3 Payload
    - `occurs_on=starts_at`, `group_name=<event name>`, `link_path` as above.
    - `owner_party_id` is the profile of the proposer reservation's `reserved_by_user_id`.
  - [x] 8.4 `outbox_listener.py` sets `reservation_id` on swap prompts only when the payload provides one.
  - [x] 8.5 Ensure the scan tests pass
    - Run ONLY `tests/test_term_end_scan.py` and `tests/test_domain_clock_guard.py`.

**Acceptance Criteria:**
- The 3-5 tests pass.
- The prompt fires exactly once per party, including for a withdrawn attendee's swap.

### Task Group 9: Event Delete with Reservation Cancellation (backend)
**Dependencies:** 4, 5, 6
**Files to Modify:** `src/backend/app/groups/application/event_reservations.py`, `src/backend/app/groups/service.py`, `src/backend/app/events/infrastructure/groups_acl.py`, `src/backend/app/events/service.py`, `src/backend/app/events/schemas.py`, `src/backend/app/events/page.py`, `src/backend/app/events/router.py`, `src/backend/tests/test_event_reservation_delete.py`, `src/backend/tests/test_event_page.py`
**Estimated Steps:** 6

- [x] 9.0 Complete event delete layer
  - [x] 9.1 Write 5-7 focused tests (`test_event_reservation_delete.py`, plus updates to `test_event_page.py`)
    - Delete before start with no attendees:
      - cancels the GIFT reservation and both swap legs, and items return to AVAILABLE;
      - PROPOSED and ACCEPTED proposals become REJECTED;
      - both parties get `RESERVATION_CANCELLED`;
      - the terminal rows end up with `event_id IS NULL`.
    - Delete at or after `starts_at` with open reservations → 409 `EventHasOpenReservations`.
    - Delete with attendees → 409 `EventHasAttendees` (unchanged).
    - Atomicity: a failure injected after the cancellations leaves every reservation PENDING or CONFIRMED and the event present.
    - `open_reservations {total, swaps}` is shown to the author and null for everyone else; `DETAIL_KEYS` is updated.
  - [x] 9.2 Implement `groups/application/event_reservations.py`
    - Collect the open reservations of the event (`circulation_bridge.list_open_reservations_for_event`) and the proposals tied to it via `reservation_ids_for_event_select`.
    - Cancel them via `cancel_reservations_without_commit`, set PROPOSED and ACCEPTED proposals to REJECTED, and stage `RESERVATION_CANCELLED` (`link_path=/product/{item_id}`) for both parties through `notifications_bridge`. Never commit.
    - Add `count_open_event_reservations` returning `{total, swaps}`.
  - [x] 9.3 Export both from `groups/service.py`, and add `cancel_open_event_reservations` and `count_open_event_reservations` to `events/infrastructure/groups_acl.py`.
  - [x] 9.4 `events/service.py::delete_event` under the existing `FOR UPDATE` lock
    - Check in order: attendees (409), then started with open reservations (409 `EventHasOpenReservations`, with the spec's Polish message), then cancel.
    - Delete the row and commit once.
    - Map the new exception to 409 in `events/router.py` if it is not covered by `BusinessConflictException`.
  - [x] 9.5 `EventDetailResponse.open_reservations` (author only, else null), filled in `events/page.py`.
  - [x] 9.6 Ensure the delete tests pass
    - Run ONLY `tests/test_event_reservation_delete.py` and `tests/test_event_page.py`.

**Acceptance Criteria:**
- The 5-7 tests pass.
- `delete_event` commits exactly once.
- No open reservation is ever orphaned (the CHECK holds).

### Task Group 10: Shared Participants Preview (frontend)
**Dependencies:** 4
**Files to Modify:** `src/frontend/src/components/shared/ParticipantItemsPreview.tsx`, `src/frontend/src/pages/events/components/EventAttendeeList.tsx`, `src/frontend/src/pages/term/components/AttendeeList.tsx`, `src/frontend/src/pages/term/termViewModel.ts`, `src/frontend/src/api/events.ts`, `src/frontend/src/api/groups.ts`, `src/frontend/src/utils/dayjs.ts`, `src/frontend/src/pages/product/useItemRoutes.ts`, `src/frontend/src/test/ParticipantItemsPreview.test.tsx`, `src/frontend/src/test/EventPage.test.tsx`, `src/frontend/src/test/TermPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/event-page-participants-preview.html
  element: screen:event-participants-preview
  locator: line 235 `#mockup-content .phone`: the "Zapisani i ich rzeczy" section after the event header (organizer row, Bartek K. row with 3 items, "Ty"/"To Ty" row)
  acceptance: heading "Zapisani i ich rzeczy"; at most 3 rows per participant, newest first; each row shows thumbnail, item name link, mode label ("Weź na stałe"/"Zamiana") and "· dodano wczoraj"/"3 dni temu"/"tydzień temu"; "Pokaż więcej (12) ›" only when N > 3; "To Ty" pill unchanged
- mockup: analysis/design-context/mockups/event-page-participants-preview.html
  element: component:participant-items-preview
  locator: line 235: a single participant block (avatar, name, item rows, "Pokaż więcej (N) ›" link)
  acceptance: one shared component used by both the event and term pages; the optional actions slot carries the term page's inline Weź/Zamień buttons; the "Pokaż więcej" href is `/<party_id>/items?event=<id>` or `?term=<id>`; item links carry the same context
**Estimated Steps:** 7

- [x] 10.0 Complete shared participants preview
  - [x] 10.1 Write 4-6 focused tests (`ParticipantItemsPreview.test.tsx`, updates in `EventPage.test.tsx` and `TermPage.test.tsx`)
    - Renders the 3 newest rows.
    - The "Pokaż więcej (N) ›" href carries `?event=`/`?term=`, and the link is absent when N ≤ 3.
    - Item links carry the context via `organizerItemPath`.
    - A UTC `added_at` renders "dodano wczoraj" against a pinned clock (`vi.useFakeTimers({ toFake: ["Date"] })`).
    - The event and term pages render the preview instead of the old toggle.
  - [x] 10.2 Extend `relativeTime` in `utils/dayjs.ts` (`utc` is already extended), with the Polish locale kept.
  - [x] 10.3 Add a context-aware item link builder to `useItemRoutes.ts`: `organizerItemPath(slug, id, context?: {kind: "term"|"event", id})` appends `?term=`/`?event=`.
  - [x] 10.4 Types
    - `api/events.ts`: `EventParticipantItem.added_at`, `EventParticipant.items_total`.
    - `api/groups.ts`: `PublicItemListingResponse.added_at`.
    - Update the typed fixture factories accordingly (no casts).
  - [x] 10.5 Implement `components/shared/ParticipantItemsPreview.tsx`
    - Props: items (≤3), total, party id, context, organizer slug, optional `renderActions`.
    - Parse `added_at` with `dayjs.utc(...)`, then `fromNow()`.
  - [x] 10.6 Replace the in-place toggles
    - `EventAttendeeList.tsx` uses the preview.
    - `AttendeeList.tsx` with `termViewModel.ts` sorts newest-first by `added_at` on the client and computes per-attendee totals; the inline take buttons go through the actions slot.
  - [x] 10.7 Ensure the preview tests pass
    - Run ONLY the files in 10.1 (`npx vitest run src/test/ParticipantItemsPreview.test.tsx src/test/EventPage.test.tsx src/test/TermPage.test.tsx`) and `npx tsc -p tsconfig.app.json --noEmit`.

**Acceptance Criteria:**
- The 4-6 tests pass.
- Implementation matches each `acceptance` criterion declared in Visual References.

### Task Group 11: Owner Items Page (frontend)
**Dependencies:** 3, 10
**Files to Modify:** `src/frontend/src/api/ownerItems.ts`, `src/frontend/src/hooks/useOwnerItems.ts`, `src/frontend/src/pages/owner/OwnerItemsPage.tsx`, `src/frontend/src/pages/organizer/blocks/NearestDateCard.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeItemCard.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeBoardBlock.tsx`, `src/frontend/src/pages/organizer/blocks/NextTermCtaBlock.tsx`, `src/frontend/src/pages/organizer/blocks/UpcomingTermsBlock.tsx`, `src/frontend/src/router.tsx`, `src/frontend/src/test/OwnerItemsPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/owner-items-page-nearest-term.html
  element: screen:owner-items-nearest-term
  locator: line 235 `#mockup-content .phone`: owner header → "Najbliższa okazja do odbioru" date card → filter tabs → 2-column card grid → "Pokaż więcej"
  acceptance: header "Rzeczy: <name>" plus "N rzeczy do oddania lub zamiany"; DateTile card (month/day/weekday tile, name, full date with time, "location · N zapisanych") with CTA "Zobacz wydarzenie i zapisz się" (or "Zobacz termin i zapisz się") linking to `nearest.path`; tabs in this order: "Wszystkie 12", "Oddam 7", "Zamienię 5"; 2-column grid of cards (thumbnail or 📦 placeholder, name, condition, chip "Weź · sob 8 lis"/"Zamienię · sob 8 lis"); "Pokaż więcej" loads the next 20
- mockup: analysis/design-context/mockups/owner-items-page-no-upcoming-terms-chat-only.html
  element: screen:owner-items-chat-only
  locator: line 235 `#mockup-content .phone`: owner header → chat-only notice → grid
  acceptance: notice "<name> nie ma teraz zaplanowanych spotkań" with "Napisz w sprawie konkretnej rzeczy — umówicie się na czacie."; no date card; chips show the mode only ("Oddam"/"Zamienię"), with no date; card links carry no query
**Estimated Steps:** 7

- [x] 11.0 Complete owner items page
  - [x] 11.1 Write 4-6 focused tests (`OwnerItemsPage.test.tsx`)
    - Nearest card: CTA href and chips with the date.
    - Chat-only notice: mode-only chips and hrefs without a query.
    - Clicking a filter tab refetches with `mode` while the counts stay.
    - A party-UUID URL with a non-null `owner.slug` redirects (`replace`) to `/<slug>/items`, keeping the query.
    - A card href prefers the page's own `?event=` over `nearest`.
    - "Pokaż więcej" fetches page 2.
  - [x] 11.2 `api/ownerItems.ts` and `hooks/useOwnerItems.ts`
    - `api/ownerItems.ts`: types mirroring `OwnerItemsPageResponse` and `OwnerNearestDateResponse`; fetchers for organization and party.
    - `hooks/useOwnerItems.ts`: an infinite query keyed `[OWNER_ITEMS_KEY, ownerRef, mode]` with an app-shaped return.
  - [x] 11.3 Generalise `ExchangeItemCard`
    - Props: item href, optional pickup href/label, mode chip with an optional date.
    - Behaviour and tests stay unchanged for `ExchangeBoardBlock`.
  - [x] 11.4 Extract `NearestDateCard` from `NextTermCtaBlock`/`UpcomingTermsBlock::DateTile` (presentational only); both blocks use it.
  - [x] 11.5 Implement `pages/owner/OwnerItemsPage.tsx`
    - A UUID-shaped param selects party mode.
    - Organization mode is themed like `OrganizerTermsPage`.
    - Filter tablist with arrow keys as in `ExchangeBoardBlock`; stretched-link cards; mobile-first, tokens only.
  - [x] 11.6 Register `/:organizationSlug/items` in `router.tsx` next to `/:organizationSlug/terms`, before the catch-all.
  - [x] 11.7 Ensure the owner-items tests pass
    - Run ONLY `src/test/OwnerItemsPage.test.tsx` and `src/test/organizerCirclesExchangeBlocks.test.tsx` (card regression), plus `tsc`.

**Acceptance Criteria:**
- The 4-6 tests pass.
- Implementation matches each `acceptance` criterion declared in Visual References.

### Task Group 12: Organizer Recent Items Block (frontend)
**Dependencies:** 3, 11
**Files to Modify:** `src/frontend/src/pages/organizer/blocks/RecentItemsBlock.tsx`, `src/frontend/src/pages/organizer/LayoutRenderer.tsx`, `src/frontend/src/pages/organizer/layouts/registry.ts`, `src/frontend/src/pages/organizer/layouts/types.ts`, `src/frontend/src/pages/organizer/blocks/GhostBlock.tsx`, `src/frontend/src/api/groups.ts`, `src/frontend/src/test/LayoutRenderer.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/owner-items-page-nearest-term.html
  element: screen:owner-items-nearest-term
  locator: line 235: the 2-column item card grid only (the block has no dedicated mockup; the spec says it reuses the shared item card)
  acceptance: the block shows up to 4 shared item cards with chips carrying the `owner_nearest` date ("Weź · <date>"/"Zamienię · <date>"), or mode-only chips when `owner_nearest` is null; the header "Ostatnio dodane rzeczy" and the "Zobacz więcej" link (to `/<slug>/items`) use `UpcomingTermsBlock` header/link styling
**Estimated Steps:** 5

- [x] 12.0 Complete organizer recent items block
  - [x] 12.1 Write 2-4 focused tests (`LayoutRenderer.test.tsx`)
    - The EXCHANGE layout renders `recent-items` directly after `exchange-board` and before `needed-items`.
    - The block shows its cards and the "Zobacz więcej" href `/<slug>/items`.
    - Empty `recent_items` → the directory block is empty, with a `GhostBlock` entry in the editor.
    - Non-EXCHANGE layouts do not include it.
  - [x] 12.2 Add `recent_items` and `owner_nearest` to `OrganizerPageResponse` in `api/groups.ts`, using the types from `api/ownerItems.ts`.
  - [x] 12.3 Implement `RecentItemsBlock.tsx` with the shared `ExchangeItemCard`.
  - [x] 12.4 Register block id `recent-items` as a `directory` block in `layouts/types.ts`, `layouts/registry.ts` (EXCHANGE only), `LayoutRenderer.tsx` and `GhostBlock.tsx`.
  - [x] 12.5 Ensure the block tests pass
    - Run ONLY `src/test/LayoutRenderer.test.tsx`, plus `tsc`.

**Acceptance Criteria:**
- The 2-4 tests pass.
- The block appears in the EXCHANGE layout only.
- Implementation matches the declared `acceptance` criterion.

### Task Group 13: Context-Generic Take Flow (frontend)
**Dependencies:** 5
**Files to Modify:** `src/frontend/src/api/eventItems.ts`, `src/frontend/src/pages/term/hooks/useItemTake.ts`, `src/frontend/src/pages/term/modals/TakeSuccessSheet.tsx`, `src/frontend/src/pages/term/modals/SwapProposeDialog.tsx`, `src/frontend/src/pages/term/views/PublicTermView.tsx`, `src/frontend/src/test/useItemTake.test.tsx`, `src/frontend/src/test/TermPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/item-page-gift-eligible-we.html
  element: screen:item-gift-eligible
  locator: line 235: the action card ("Weź" button); the success sheet follows the take
  acceptance: after a successful event take, `TakeSuccessSheet` (event variant) shows the event name and date, links to `context.path`, and uses the event id as the calendar uid; the term variant still links via `organizerTermPath`
- mockup: analysis/design-context/mockups/item-page-swap-picker-zamieni.html
  element: screen:item-swap-picker
  locator: line 235: the bottom sheet "Co proponujesz w zamian?" with the item list and buttons
  acceptance: title "Co proponujesz w zamian?", subtitle "Twoje rzeczy wystawione do zamiany", a list of the viewer's AVAILABLE SWAP items with condition, buttons "Anuluj" and "Zaproponuj zamianę"; submitting calls the event propose endpoint when the context is an event
**Estimated Steps:** 5

- [x] 13.0 Complete context-generic take flow
  - [x] 13.1 Write 3-5 focused tests (`useItemTake.test.tsx`, update in `TermPage.test.tsx`)
    - With an event context, GIFT take calls `takeEventItem` and opens `TakeSuccessSheet` with the event link.
    - With an event context, SWAP calls `proposeEventSwap` after the dialog.
    - The term context still calls the term endpoints; the term page passes its term context to `TakeSuccessSheet`.
    - The mutation awaits invalidation of the item-actions, item-detail and notifications prefixes.
  - [x] 13.2 Add `api/eventItems.ts`: `takeEventItem(eventId, itemId, reservationType)` and `proposeEventSwap(eventId, itemId, offeredItemId)`, with types mirroring `EventTakeResponse`/`ItemContextResponse`.
  - [x] 13.3 Generalise `useItemTake` from `termId` to `context: {kind, id, name, starts_at, path} | null`
    - Branch the endpoints by kind; `SwapProposeDialog` is reused for both.
  - [x] 13.4 Give `TakeSuccessSheet` a `context` prop
    - Term: link via `organizerTermPath`. Event: `context.path`. Calendar uid = context id.
    - Update `PublicTermView` to pass its term context.
  - [x] 13.5 Ensure the take-flow tests pass
    - Run ONLY `src/test/useItemTake.test.tsx` and `src/test/TermPage.test.tsx`, plus `tsc`.

**Acceptance Criteria:**
- The 3-5 tests pass.
- Term take and swap behaviour is unchanged.
- Implementation matches each declared `acceptance` criterion.

### Task Group 14: Item Page Context Actions (frontend)
**Dependencies:** 7, 10, 11, 13
**Files to Modify:** `src/frontend/src/api/itemActions.ts`, `src/frontend/src/hooks/useItemActions.ts`, `src/frontend/src/pages/product/itemActionsViewState.ts`, `src/frontend/src/pages/product/ItemContextActions.tsx`, `src/frontend/src/pages/product/ItemDetailPage.tsx`, `src/frontend/src/pages/product/OrganizerItemLayout.tsx`, `src/frontend/src/router.tsx`, `src/frontend/src/test/itemActionsViewState.test.ts`, `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/OrganizerItemRoute.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/item-page-gift-eligible-we.html
  element: screen:item-gift-eligible
  locator: line 235: below the mode/status chips, the action card (context line → Weź + Napisz → hint) and then the owner row
  acceptance: context line "📅 Odbiór na: <name> · <date, time>"; primary "Weź" and secondary "💬 Napisz"; hint "Rezerwacja możliwa do startu wydarzenia. Właściciel dostanie powiadomienie."; owner row with avatar, name and "Zobacz wszystkie rzeczy (N) ›" linking to the owner items page
- mockup: analysis/design-context/mockups/item-page-gift-eligible-we.html
  element: component:item-context-actions
  locator: line 235: the action card container
  acceptance: one `ItemContextActions` card that only switches over `view.kind` (loading, hidden, error, own, unavailable, noContext, stale, anonymous, notSignedUp, eligible); the error kind shows "Nie udało się wczytać akcji" with retry while the rest of the page renders
- mockup: analysis/design-context/mockups/item-page-swap-picker-zamieni.html
  element: screen:item-swap-picker
  locator: line 235: the action card with "Zamienię" (above the sheet)
  acceptance: an eligible SWAP view shows the "Zamienię" primary button, which opens `SwapProposeDialog` (Group 13)
- mockup: analysis/design-context/mockups/item-page-not-signed-up-zapisz-si.html
  element: screen:item-not-signed-up
  locator: line 235: the action card
  acceptance: context line "📅 <name> · <date, time>"; copy "Żeby zarezerwować tę rzecz, zapisz się na wydarzenie — tam ją odbierzesz." (term variant: "na termin"); link button "Zapisz się na wydarzenie ›" or "Zapisz się na termin ›" to `context.path`; "💬 Napisz"
- mockup: analysis/design-context/mockups/item-page-anonymous-account-gate.html
  element: screen:item-anonymous-gate
  locator: line 235: the action card plus the bottom `AuthGateSheet`
  acceptance: anonymous with a live context shows "Weź"/"Zamienię" plus "Napisz"; any action opens the sheet "Załóż konto, żeby zarezerwować" ("Rezerwacje i czat wymagają konta. Wrócisz do tej rzeczy po zalogowaniu.", "Załóż konto", "Mam konto — zaloguj"); `returnTo` keeps the query
- mockup: analysis/design-context/mockups/item-page-stale-context-termin-si-odby.html
  element: screen:item-stale-context
  locator: line 235: the warning card
  acceptance: "⏱ <name> (<date>) już się odbył(a)" for terms or "… już się rozpoczęło" for events; when `nearest` exists, "<owner> ma kolejny termin: <date> · <name>" and "Przejdź do nowego terminu ›" (the item page with the nearest context); "💬 Napisz"
- mockup: analysis/design-context/mockups/item-page-no-context-napisz-only.html
  element: screen:item-no-context
  locator: line 235: the action card and the owner row
  acceptance: "Właściciel nie ma teraz zaplanowanych spotkań" (or a nearest hint when `nearest` exists); primary "💬 Napisz do właściciela" with "Umówcie się na czacie w sprawie tej rzeczy."; owner row with "Zobacz wszystkie rzeczy (N) ›"
- mockup: analysis/design-context/mockups/item-page-own-item.html
  element: screen:item-own
  locator: line 235: the card under the chips
  acceptance: "To Twoja rzecz — widoczna dla uczestników <context name>" (generic copy without a context); no Weź, Zamienię or Napisz; the existing "Edytuj" stays
**Estimated Steps:** 7

- [x] 14.0 Complete item page context actions
  - [x] 14.1 Write 6-8 focused tests
    - `itemActionsViewState.test.ts`: an `it.each` table in the Requirement 16 order. It includes the overlapping rows (anonymous + no context → `noContext`; anonymous + stale → `stale`; anonymous + unavailable → `unavailable`), an actions error, and a refresh error with cached data that keeps the last view.
    - `ItemDetailPage.test.tsx`:
      - anonymous Weź opens `AuthGateSheet`;
      - an eligible event take shows the event `TakeSuccessSheet`;
      - `notSignedUp` renders the "Zapisz się" href.
    - `OrganizerItemRoute.test.tsx`: an anonymous ACTIVE item renders; an anonymous 404 redirects to login with `returnTo`.
  - [x] 14.2 `api/itemActions.ts` and `hooks/useItemActions.ts`
    - `api/itemActions.ts`: types for `ItemActionsResponse`.
    - `hooks/useItemActions.ts`: `useItemActions(id, contextParam)` keyed `[ITEM_ACTIONS_KEY, id, contextParam]`, app-shaped return.
  - [x] 14.3 Implement the pure `resolveItemActionsView()` in `itemActionsViewState.ts`: a discriminated union over the 10 kinds, first match in the Requirement 16 order.
  - [x] 14.4 Implement `ItemContextActions.tsx`
    - Only `switch`es on `view.kind`.
    - Napisz opens the ITEM conversation via `useOpenAndNavigate`, or the account gate for anonymous viewers.
    - Owner row "Zobacz wszystkie rzeczy (N) ›".
    - Flows go through `useItemTake({context})` and `useAccountGate`.
    - `type="button"` everywhere; `useRegisterOpenSheet` for sheets.
  - [x] 14.5 Integrate into `ItemDetailPage.tsx`
    - Read `?term`/`?event`, passing a context only when exactly one is present.
    - Replace `AskAboutItemButton` for non-owners with the card; keep the owner's Edytuj.
  - [x] 14.6 Drop `AuthGuard` from `/product/:id` and `/:organizationSlug/product/:id` in `router.tsx` (`OrganizerItemLayout` stays the themed frame)
    - Anonymous viewer + `/details` 404 → redirect to login with `returnTo`.
    - The anonymous page calls no READ-gated endpoint.
  - [x] 14.7 Ensure the item-page tests pass
    - Run ONLY the three files in 14.1, plus `tsc`.

**Acceptance Criteria:**
- The 6-8 tests pass.
- Every view kind renders as declared.
- Implementation matches each `acceptance` criterion declared in Visual References.

### Task Group 15: Event Reservation Status UI & Pending Actions (frontend)
**Dependencies:** 6, 8
**Files to Modify:** `src/frontend/src/api/items.ts`, `src/frontend/src/api/reservations.ts`, `src/frontend/src/api/termItemListings.ts`, `src/frontend/src/api/notifications.ts`, `src/frontend/src/pages/product/ItemStatusCard.tsx`, `src/frontend/src/pages/items/SwapAcceptSuccessSheet.tsx`, `src/frontend/src/pages/items/MyItemsView.tsx`, `src/frontend/src/components/pending/pendingActions.ts`, `src/frontend/src/test/ItemStatusCard.test.tsx`, `src/frontend/src/test/SwapAcceptSuccessSheet.test.tsx`, `src/frontend/src/test/pendingActions.test.ts`, `src/frontend/src/test/NotificationBell.test.tsx`
**Visual References:** none. No design-context screen covers these surfaces; the existing component styling stays and only gains an event branch.
**Estimated Steps:** 6

- [x] 15.0 Complete event reservation status UI
  - [x] 15.1 Write 4-6 focused tests
    - `ItemStatusCard` with `event_id` links via `eventPath(event_slug, event_id)`.
    - The `SwapAcceptSuccessSheet` event branch shows the event name, date and link, with the event id as the calendar uid.
    - `pendingActions` parses `/…/event/{id}` links: `termId` stays null and confirm uses `reservation_id`.
    - `RESERVATION_CANCELLED` yields no pending action.
    - `NotificationBell` renders a `RESERVATION_CANCELLED` notification.
  - [x] 15.2 Types
    - `term_id` becomes nullable; add `event_id`/`event_slug` to `ItemStatus`, `AcceptedSwapProposal` and `Reservation`.
    - `NotificationKind` gains `RESERVATION_CANCELLED`.
    - Fixture factories are typed with no casts.
  - [x] 15.3 Add the event branch to `ItemStatusCard`; the term branch is unchanged.
  - [x] 15.4 Add the `SwapAcceptSuccessSheet` event branch, fed from `MyItemsView.tsx:182-185`.
  - [x] 15.5 Teach `pendingActions.ts` to handle `/event/` links, deriving no action from `RESERVATION_CANCELLED`.
  - [x] 15.6 Ensure the status UI tests pass
    - Run ONLY the files in 15.1, plus `tsc`.

**Acceptance Criteria:**
- The 4-6 tests pass.
- The TypeScript build passes with nullable `term_id`.

### Task Group 16: Event Delete Dialog (frontend)
**Dependencies:** 9, 10
**Files to Modify:** `src/frontend/src/api/events.ts`, `src/frontend/src/pages/events/components/EventAuthorCard.tsx`, `src/frontend/src/test/EventPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/event-delete-cancels-reservations.html
  element: screen:event-delete-cancels
  locator: line 235 `#mockup-content .phone`: the "Usunąć wydarzenie?" confirmation dialog over the event page
  acceptance: shown only when `attendee_count == 0`, `open_reservations.total > 0` and the event has not started; title "Usunąć wydarzenie?"; copy "Na tym wydarzeniu są N otwarte rezerwacje (w tym M zamiana). Usunięcie je anuluje — rzeczy wrócą do właścicieli, a obie strony dostaną powiadomienie." with Polish plural forms; buttons "Anuluj" and destructive "Usuń i anuluj rezerwacje"; after start, the delete button is `aria-disabled` with the hint "Nie można usunąć — wydarzenie się rozpoczęło i ma otwarte rezerwacje"; with attendees, the existing blocked hint applies
**Estimated Steps:** 4

- [x] 16.0 Complete event delete dialog
  - [x] 16.1 Write 3 focused tests (`EventPage.test.tsx`)
    - Before start, with no attendees and reservations: the dialog shows the counts and "Usuń i anuluj rezerwacje" calls delete.
    - After start: the button is `aria-disabled` with the hint linked via `aria-describedby`, and the handler is guarded.
    - With attendees: the existing hint is unchanged.
  - [x] 16.2 Add `EventDetail.open_reservations: {total, swaps} | null` to `api/events.ts` and to the fixtures.
  - [x] 16.3 `EventAuthorCard`: dialog variants
    - Use the existing `ConfirmDialog`/`ModalSheet` and `utils/plural`.
    - The started check uses dayjs from `utils/dayjs`.
  - [x] 16.4 Ensure the dialog tests pass
    - Run ONLY `src/test/EventPage.test.tsx`, plus `tsc`.

**Acceptance Criteria:**
- The 3 tests pass.
- Implementation matches the declared `acceptance` criterion.

### Task Group 17: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
**Files to Modify:** `src/backend/tests/test_event_item_reservations.py`, `src/backend/tests/test_event_reservation_readers.py`, `src/backend/tests/test_item_actions.py`, `src/backend/tests/test_owner_items_page.py`, `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/OwnerItemsPage.test.tsx`
**Estimated Steps:** 4

- [x] 17.0 Review and fill critical gaps
  - [x] 17.1 Review the tests from Groups 1-16 (about 60-90)
  - [x] 17.2 Analyse gaps for this feature only
    - Cross-check the spec's context-reader table: every row has an event test.
    - Cross-check every Requirement 1-34 against at least one test.
    - Cross-check the Success Criteria end-to-end chains (take → accept → confirm on events; delete before and after start).
  - [x] 17.3 Write up to 10 additional strategic tests
    - Candidates: an event swap reject path; anonymous `/api/items/{id}/actions` on a DRAFT item; owner items page with `?term=` overriding nearest; a reservation detail for a context-less row.
  - [x] 17.4 Run the feature-specific tests only
    - Backend: all files touched by Groups 1-9 plus the term regression gate.
    - Frontend: the files touched by Groups 10-16, plus `tsc`.

**Acceptance Criteria:**
- All feature tests pass.
- No more than 10 tests are added.

### Task Group 18: Documentation
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`, `.maister/docs/standards/backend/migrations.md`
**Estimated Steps:** 5

- [x] 18.0 Complete documentation updates
  - [x] 18.1 Write 2 documentation checks (grep-based, run from the repo root)
    - `architecture.md` no longer states that event items are read-only (the 2026-10-29 wording).
    - `architecture.md` and `INDEX.md` both mention `RESERVATION_CANCELLED`, `ReservationContext` and the 0073 runbook.
  - [x] 18.2 `architecture.md` (Requirement 35)
    - Document:
      - event reservations and `ReservationContext`;
      - the event take/propose routes and `/api/items/{id}/actions`;
      - the end-of-event scan;
      - the delete rules (blocked with attendees; refused after start with open reservations; cancel-and-notify before start);
      - `RESERVATION_CANCELLED`;
      - the public `/details` for ACTIVE items;
      - the owner items page and the organizer `recent-items` block.
    - Add the 0073 runbook entry: the guarded downgrade, its recovery path, and the `ON DELETE SET NULL` semantics.
    - Never include secret values.
  - [x] 18.3 Update the `INDEX.md` architecture summary to match.
  - [x] 18.4 Add a line to `standards/backend/migrations.md`: a guarded downgrade is allowed when ledger-linked rows would make it lossy, with the error naming the recovery path (`0073_event_reservations.py`). Update the `INDEX.md` migrations summary.
  - [x] 18.5 Ensure the documentation checks pass
    - Re-run the 2 checks from 18.1.

**Acceptance Criteria:**
- Both checks pass.
- The docs describe every new behaviour, with the 0073 runbook present.

## Execution Order

1. Group 1: Reservation Schema & Shared Infrastructure (8 steps)
2. Group 2: Authorization Matrix Rows (3 steps)
3. Group 4: Participants Preview Read Models (5 steps)
4. Group 3: Owner Items & Organizer Read Models (8 steps, depends on 1, 2)
5. Group 5: Reservation Context & Event Reservation Writes (8 steps, depends on 1, 2)
6. Group 6: Circulation Context Readers (7 steps, depends on 1, 2)
7. Group 10: Shared Participants Preview, frontend (7 steps, depends on 4)
8. Group 7: Item Actions Read Model (5 steps, depends on 3, 5)
9. Group 8: End-of-Event Scan (5 steps, depends on 5, 6)
10. Group 9: Event Delete with Reservation Cancellation (6 steps, depends on 4, 5, 6)
11. Group 11: Owner Items Page, frontend (7 steps, depends on 3, 10)
12. Group 13: Context-Generic Take Flow, frontend (5 steps, depends on 5)
13. Group 12: Organizer Recent Items Block, frontend (5 steps, depends on 3, 11)
14. Group 14: Item Page Context Actions, frontend (7 steps, depends on 7, 10, 11, 13)
15. Group 15: Event Reservation Status UI & Pending Actions, frontend (6 steps, depends on 6, 8)
16. Group 16: Event Delete Dialog, frontend (4 steps, depends on 9, 10)
17. Group 17: Test Review & Gap Analysis (4 steps, depends on 1-16)
18. Group 18: Documentation (5 steps, depends on 1-16)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`:
  - minimal implementation: exactly one new notification kind, no DIRECT chat, no event "my takes" endpoint;
  - error handling: typed 404/403/409;
  - validation: 400 for both context params;
  - commenting and coding style.
- `backend/`:
  - `models.md`: plain FK-id `event_id`, CHECK in `__table_args__`, one ACL per context, 404 before 403;
  - `migrations.md`: `fk_`/`ix_`/`ck_` names, reverse-order downgrade, downgrade-then-upgrade test, the guarded downgrade deviation documented;
  - `queries.md`: `count_queries`-constant reads, batched `IN`, SQL `LIMIT`, `FOR SHARE`/`FOR UPDATE`;
  - `security.md`: `AUTHORIZATION_MATRIX` rows with tests, PUBLIC rows without a dependency, EDIT through `require_any`;
  - `time.md`: `clock.local_now()`, `format_term_when`, `fit_notification_message`, `test_domain_clock_guard.py`;
  - `api.md`: plural paths and limited nesting.
- `frontend/`:
  - `components.md`: `resolveItemActionsView()` with `it.each`, a `switch` on `view.kind`, flows in hooks;
  - `data-fetching.md`: hooks in `src/hooks` wrapping `src/api`, prefix-constant keys, awaited invalidation, `dayjs` from `utils/dayjs.ts` with UTC parsing;
  - `accessibility.md`: `ModalSheet` + `useRegisterOpenSheet`, `type="button"`, tablist arrow keys, stretched-link cards, `aria-disabled` + `aria-describedby` for blocked delete, `{" "}` around `sr-only`;
  - `responsive.md` and `css.md`: mobile-first, tokens only.
- `testing/`:
  - backend: pytest via `uv run python -m pytest` from `src/backend`, testcontainers Postgres, `leaf_category_ids` per test, `freeze_local_now`, exact key sets updated and never loosened;
  - frontend: Vitest in `src/test` with explicit vitest imports, `createQueryWrapper`, typed fixtures, `vi.useFakeTimers({ toFake: ["Date"] })`.

## Notes

- Test-driven: each group starts with 2-8 tests.
- Run incrementally: only the new tests (and the named regression gates) after each group.
- Mark progress: check off steps as they are completed.
- Reuse first: prioritise the existing components named in the spec (`_resolve_owner`, `_listing_thumb_urls`, `ExchangeItemCard`, `DateTile`, `useAccountGate`, `AuthGateSheet`, `SwapProposeDialog`, `organizerItemPath`).
- Secrets: never print secret values (no `env`/`printenv`/`cat .env`); check configuration by presence only. Every subagent prompt that touches configuration or infrastructure must repeat this rule.
- Commands: `uv run python -m pytest|mypy|ruff` from `src/backend`. The mypy baseline is about 32 errors at HEAD; do not add new ones.
