# Implementation Plan: Product-page reservations, physical location, reserved items on lists, item visibility

## TL;DR
- The plan has 17 task groups and 119 steps, in slice order. Groups 1–9 are S1, groups 10–12 are S2, groups 13–15 are S3, then docs (16) and test review with the full suites (17).
- S1 runs backend first: 0074/0075 → inventory location API → `PersonalContext` and `POST /api/items/{id}/take|propose` → removing the old routes and migrating 17 test files, plus `/actions` v2. After that come the frontend API/hooks, then the product page and Moje rzeczy in parallel, then the tile cleanup.
- The term-page take tests are deleted only in Group 9, after Group 7 has added their product-page equivalents (C7).
- S2 and S3 each run backend groups first, then frontend. Each group writes 2–8 focused tests first and runs only those.

## Key Decisions
- **The backend is split into "add" and "remove" groups.** Group 3 adds `PersonalContext` and the unified endpoint while the old routes still work. Group 4 then removes the old routes and migrates every dependent test file in one place. The app and the test suite keep importing cleanly between groups, and the removal is easy to review.
- **`/actions` v2 (Group 5) is separate from the write endpoint (Group 3).** It has its own statement-count and viewer-filter tests. It depends on Group 3 only for `load_for_reservation`/`require_ended`, which the `party_reservation` flags reuse.
- **`tsc` is expected to be clean only from Group 9 onward.** Group 6 changes the `useItemTake` signature and deletes the old take APIs, but the term page keeps using them until Group 9 removes them (they cannot be removed earlier, because of C7). Groups 6–8 therefore verify with Vitest, which does not type-check, and Group 9 must end with a clean `tsc -p tsconfig.app.json`.
- **Slices are strict gates.** Group 10 (the first S2 group) depends on all S1 groups, and Group 13 (the first S3 group) depends on Group 12. Each slice can then ship on its own, as the spec requires.
- **`include_private` arrives in S3, not S2.** Group 11 adds `viewer_party_id` to `get_public_circle_view`/`list_public_term_item_listings`. Group 14 adds the `include_private` parameter and its complete opt-in caller list, together with the column it filters on.
- **The `party_reservation` flags share predicates with the write paths.** Group 5 extracts the confirm/cancel/accept eligibility checks used by `_resolve_transaction_reservations_for_action` and `_require_recipient_to_confirm_gift` into shared predicates, so the read flags cannot drift from the write rules.
- **The docs group has no automated tests.** It is documentation-only, so its first step is a cross-check list instead of tests.

## Open Questions / Risks
- **Dirty branch precondition.** Migration 0073 is untracked and the event-reservation work is uncommitted on `feat/events-plugin`. The operator should commit or stabilise it before Group 1, because 0074 revises 0073.
- **Wide test blast radius in Group 4.** It migrates 17 backend test files (`test_term_item_listings.py` alone has about 79 references). Assertions must be moved, never loosened. The competing-proposal assertion in `test_term_item_listings.py` flips to 409 only in Group 10.
- **The party-actions block has no mockup.** Groups 7 and 12 implement it from the R8.6 copy, reusing the existing `ItemContextActions` button styles.
- **Migration chain in `test_event_reservations_migration.py`.** It downgrades to 0072 through 0076 → 0075 → 0074. Its fixture must leave no open no-context rows and no PRIVATE rows, or the guarded downgrades refuse. Groups 1 and 13 both touch it.
- **Shared-file contention.** `src/backend/app/groups/schemas.py`, `term_item_listings.py`, `groups/infrastructure/repository.py` and `core/authorization_matrix.py` are touched by several groups. They are declared in each one, so the executor serialises them.
- **Baselines.** mypy has about 32 errors on HEAD (no new ones may be added). About 13 frontend test failures are pre-existing on HEAD (OrganizerEditor is flaky). Group 17 compares against both baselines.
- **Accepted risks carried from the spec:** L7 (no discriminator column for personal reservations, pinned by a test in Group 3), C2 (PRIVATE is lost when the preference row is deleted), and the pre-existing offered-item proposal race (out of scope).

## Overview
Total Steps: 119
Task Groups: 17 (9 in S1, 3 in S2, 3 in S3, plus docs and the final test review)
Expected Tests: about 85–115 new or rewritten focused tests (2–8 per group across 15 implementation groups, plus at most 10 in Group 17), on top of the migrated existing backend files (17) and frontend files (about 10)

**Secrets rule (applies to every group).** Never print secret values to tool output. Do not run `env`, `printenv`, `docker compose exec <svc> env`, `docker inspect` (Env section) or `cat .env` unfiltered. Check configuration by presence only. Never write secret values into reports, task folders, screenshots or commits.

## Implementation Steps

---

## Slice S1: physical location, product page, personal context, single endpoint, tiles, party actions

### Task Group 1: S1 Database migrations (0074 personal pickup, 0075 inventory location)
**Dependencies:** None (precondition: 0073 and the event-reservation work committed or stabilised on the branch)
**Files to Modify:** `src/backend/alembic/versions/0074_personal_pickup_reservations.py`, `src/backend/alembic/versions/0075_inventory_location.py`, `src/backend/app/circulation/models.py`, `src/backend/app/circulation/application/reservations.py`, `src/backend/tests/test_personal_pickup_migration.py`, `src/backend/tests/test_inventory_location_migration.py`, `src/backend/tests/test_circulation_bulk_cancel.py`, `src/backend/tests/test_event_reservations_migration.py`
**Estimated Steps:** 6

**Secrets:** this group touches database infrastructure (testcontainers, Alembic). Never print secret values: no `env`/`printenv`/`.env` dumps, presence checks only.

- [x] 1.0 Complete the S1 schema layer
  - [x] 1.1 Write 2–8 focused tests
    - `tests/test_personal_pickup_migration.py`:
      - `test_downgradeThenUpgrade_0074_roundTrips`;
      - `test_insertOpenReservation_noContext_allowedAfter0074`;
      - `test_insertOpenReservation_bothContexts_violatesContextCheck`;
      - `test_downgrade0074_openNoContextRows_refusesNamingRecovery`, parametrised over a PENDING-proposal row (an unpaired CONFIRMED SWAP leg behind a PROPOSED `SwapProposal`) and a personal GIFT row. It asserts the `RuntimeError` text names reject / cancel-transaction / restore-dump.
    - `tests/test_inventory_location_migration.py`:
      - `test_downgradeThenUpgrade_0075_roundTrips`, which checks the column, `fk_inventories_location_id_locations` and the partial `ix_inventories_location_id`.
    - Flip the existing "exactly one context" tests to "allowed", without loosening the `bothContexts` case:
      - `tests/test_circulation_bulk_cancel.py:150-169`: only "both" raises;
      - `tests/test_event_reservations_migration.py:190-203`: `noContext` becomes allowed after 0074. Ensure its fixture has no open no-context rows, so the chained downgrade to 0072 passes.
  - [x] 1.2 Model changes in `circulation/models.py`
    - `Reservation` `CheckConstraint("num_nonnulls(term_id, event_id) <= 1", name="ck_reservations_context")`.
    - `Inventory.location_id: Mapped[uuid.UUID | None]`, a plain FK id to `locations.id` with no `relationship()` (`standards/backend/models.md`). The legacy `location` text column is untouched.
  - [x] 1.3 Write `0074_personal_pickup_reservations.py` (revises `0073`)
    - In `upgrade`: `SET LOCAL lock_timeout = '5s'`, drop `ck_reservations_context`, then recreate it as `num_nonnulls(term_id, event_id) <= 1`.
    - In the guarded `downgrade`:
      - count rows with `status IN ('PENDING','CONFIRMED') AND term_id IS NULL AND event_id IS NULL`;
      - if there are any, raise `RuntimeError` naming the recovery: (a) reject pending personal proposals via `POST /api/swap-proposals/{id}/reject`, (b) cancel accepted personal swaps and personal GIFTs via `POST /api/reservations/{id}/cancel-transaction`, or (c) restore a pre-0074 dump;
      - otherwise restore the 0073 check under the same `lock_timeout`.
  - [x] 1.4 Write `0075_inventory_location.py` (revises `0074`)
    - Add the nullable `inventories.location_id` and `fk_inventories_location_id_locations` (no `ON DELETE`).
    - Add `ix_inventories_location_id` with `postgresql_where=location_id IS NOT NULL`.
    - The downgrade drops the index, then the FK, then the column (reverse dependency order). Its docstring notes that the downgrade loses every owner's location setting.
  - [x] 1.5 Relax the `create_reservation` guard
    - In `circulation/application/reservations.py`, change the `ValueError` from "exactly one" to "not both" (`term_id` and `event_id` both set). Keep the keyword-only signature.
  - [x] 1.6 Ensure the migration-layer tests pass
    - Run only the tests in 1.1 (`uv run python -m pytest tests/test_personal_pickup_migration.py tests/test_inventory_location_migration.py tests/test_circulation_bulk_cancel.py tests/test_event_reservations_migration.py` from `src/backend`).

**Acceptance Criteria:**
- The tests from 1.1 pass. Both migrations round-trip, and the 0074 downgrade refuses with the recovery text while open no-context rows exist.
- `alembic upgrade head` reaches 0075, and the model's `CheckConstraint` matches the DB.
- No "exactly one" test was deleted; each was flipped to the new rule.

---

### Task Group 2: S1 Inventory physical location API (circulation)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/circulation/infrastructure/locations_acl.py` (new), `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/application/inventory.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/router.py`, `src/backend/app/circulation/service.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_inventory_location.py` (new)
**Estimated Steps:** 7

- [x] 2.0 Complete the inventory-location backend
  - [x] 2.1 Write 2–8 focused tests in `tests/test_inventory_location.py`
    - `test_getMineLocation_noPersonalInventory_returnsNull`;
    - `test_putMineLocation_ownLocation_returnsRefAndPersists` (exact key set of `InventoryLocationResponse` / `LocationRefResponse`);
    - `test_putMineLocation_otherOwnersLocation_returns403`;
    - `test_putMineLocation_unknownOrSoftDeleted_returns404`;
    - `test_putMineLocation_null_clearsLocation`;
    - `test_getMineLocation_softDeletedLater_rendersWithDeletedAt`.
    - Add matrix assertions to `tests/test_authorization_matrix.py`: `PUT /api/inventories/mine/location` needs EDIT, and GET is still covered by the READ row.
  - [x] 2.2 Create `circulation/infrastructure/locations_acl.py` with `get_owned_location(db, location_id, owner_party_id)`
    - It returns 404 for an unknown or soft-deleted id and 403 for another owner's (404-before-403), and returns the narrow `LocationRefResponse`.
    - Templates: `groups/infrastructure/locations_acl.py`, `events/infrastructure/locations_acl.py`, `locations/service.get_own_location`.
  - [x] 2.3 Repository changes in `circulation/infrastructure/repository.py`
    - Add `party_id` to the `_user_profiles` Core ref (`:65`).
    - Add `find_party_id_by_user_id(db, user_id)`.
    - Add the read/write of `Inventory.location_id` on the PERSONAL inventory.
    - Do not import `app.users.service` (audit L5).
  - [x] 2.4 Add the use cases in `circulation/application/inventory.py`
    - `get_my_inventory_location(db, principal)`: uses `find_personal_inventory` and returns `null` when there is no PERSONAL inventory or no location. A soft-deleted location still renders for its owner, with `deleted_at` set.
    - `set_my_inventory_location(db, principal, data)`: uses `get_or_create_personal_inventory`, `identity.get_user_id_by_principal` → `find_party_id_by_user_id` → `get_owned_location`, then a single commit.
  - [x] 2.5 Add the schemas and routes
    - `InventoryLocationResponse {location: LocationRefResponse | null}` and `SetInventoryLocationRequest {location_id: uuid | null}` in `circulation/schemas.py`.
    - `GET|PUT /api/inventories/mine/location` in `circulation/router.py`, declared **before** `GET /api/inventories/{inventory_id}`.
  - [x] 2.6 Add the authorization matrix row
    - `PUT ^/api/inventories/mine/location$` → `("EDIT","mcp:edit")`, ahead of rows 38–39, enforced with `Depends(require_any(...))`.
  - [x] 2.7 Ensure the inventory-location tests pass
    - Run only `tests/test_inventory_location.py` and `tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- The tests from 2.1 pass.
- Circulation has no import from `app.users.service` or `app.locations` outside `locations_acl.py`.
- `/api/inventories/mine/location` is not shadowed by `/{inventory_id}`.

---

### Task Group 3: S1 PersonalContext and unified reservation endpoint
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/groups/application/reservation_context.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/router/item_reservations.py` (new), `src/backend/app/groups/router/__init__.py`, `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/domain/item_privacy.py`, `src/backend/app/circulation/application/item_details.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/service.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_personal_pickup.py` (new), `src/backend/tests/test_item_reservations_router.py` (new)
**Estimated Steps:** 8

- [x] 3.0 Complete the personal context and the unified take/propose endpoint
  - [x] 3.1 Write 2–8 focused tests
    - `tests/test_personal_pickup.py`:
      - `test_takeItem_personalGift_createsNoContextReservationAndNullContext`;
      - `test_takeItem_personalOwnerWithoutLocation_returns409`;
      - `test_proposeItemSwap_personal_acceptPairsNoContextLegsWithNullTermFields` (the reservation-derived context at accept);
      - `test_confirmTransaction_personalGift_recipientConfirmsImmediately_giverRefused`;
      - `test_cancelTransaction_personalGift_giverCancelsImmediately`;
      - `test_takeItem_personal_notificationCopyForOwnerAndTaker` (plus the `SWAP_ACCEPTED` "— odbiór osobisty" suffix);
      - `test_termEndScan_personalReservation_sendsNoPrompt`;
      - `test_deleteEvent_openReservation_leavesNoOpenNoContextRow` (L7 guard).
    - `tests/test_item_reservations_router.py`:
      - `test_postTake_contextRefValidation_returns422`, parametrised over PERSONAL with an id, and TERM/EVENT without one;
      - `test_postTake_termAndEventContexts_reserve`;
      - `test_postTake_swapMode_returns409`.
  - [x] 3.2 Add `PersonalContext` in `reservation_context.py`
    - A frozen dataclass with `kind = "PERSONAL"`, following the protocol table in spec R4.1:
      - `require_open`/`require_ended`: no-op;
      - `require_eligibility`: the owner passes and PUBLIC passes; it raises `RuntimeError` on a reservation-derived instance;
      - `reservation_kwargs() == {}`;
      - `pickup_phrase() == "odbiór osobisty"`;
      - `accepted_swap_fields` all `None`;
      - `to_response() is None`;
      - `allows_visibility` → `True`.
    - `load_personal_context(db, item_id)`: resolves the preference owner (404 when not listed), requires a live location on the owner's PERSONAL inventory (409 "Właściciel nie ustawił miejsca odbioru"), and sets `item_visibility = PUBLIC` until S3.
    - `PersonalContext.for_reservation()`: field-free.
    - `load_for_reservation`: returns it for an open (PENDING/CONFIRMED) no-context reservation and `None` for a terminal one, so the "Wydarzenie … usunięte" path is unchanged.
    - Add `pickup_phrase()` to `TermContext`/`EventContext` ("<termin> — <nazwa>" via `clock.format_term_when`).
  - [x] 3.3 Bridge the owner location
    - Add `circulation_bridge.get_personal_inventory_live_location_id(db, owner_party_id)`, backed by a circulation repository select joining the PERSONAL inventory to its location and treating soft-deleted as `None`. It is used by `load_personal_context`.
  - [x] 3.4 Lifecycle changes in `term_item_listings.py`
    - Build the notification copy in `_take` (`:534-550`) and in accept (`:811`) from `context.pickup_phrase()`, through `clock.fit_notification_message` with `link_path=/product/{item_id}`.
    - Use the personal copy from spec R4.6 for the owner (`TERM_ITEM_LISTING_TAKEN`) and the taker (`ITEM_RESERVED_FOR_PICKUP`).
    - Accept (`:844`) uses `context.accepted_swap_fields(db)`.
  - [x] 3.5 Use cases and schemas
    - Add `take_item(db, principal, item_id, data)`/`propose_item_swap(db, principal, item_id, data)`:
      - resolve the caller;
      - build the context by `data.context.kind` (`load_term_context`/`lock_event_context`/`load_personal_context`);
      - delegate to `_take`/`_propose`.
      - Leave a placeholder-free seam for the S3 `require_item_visible` call, which goes first.
    - Add to `groups/schemas.py`:
      - `ReservationContextRef {kind: "PERSONAL"|"TERM"|"EVENT", id}`, whose `model_validator` requires `id` for TERM/EVENT and forbids it for PERSONAL;
      - `ItemTakeRequest`, `ItemProposeRequest` and `ItemTakeResponse {item_id, product_name, context: ItemContextResponse | null}`.
    - Make `AcceptedSwapProposalResponse.term_occurs_on`/`group_name` nullable.
  - [x] 3.6 Router and matrix
    - New `groups/router/item_reservations.py` with `POST /api/items/{item_id}/take` and `POST /api/items/{item_id}/propose`, both `Depends(require_any(...EDIT, mcp:edit))`, registered in `groups/router/__init__.py`.
    - Matrix row `POST ^/api/items/[^/]+/(take|propose)$` → `("EDIT","mcp:edit")` next to `/actions`, plus a row in `test_authorization_matrix.py`.
  - [x] 3.7 Read models
    - `item_privacy.derive_status` and `ItemStatus`/`ItemStatusResponse.personal_pickup: bool`: true when the active reservation behind RESERVED/IN_TRANSIT has no context (`circulation/application/item_details.py`, `circulation/schemas.py`).
    - `ReservationDetailResponse.personal_pickup: bool`: true when the reservation is open and has no context (`circulation/service.py`).
    - Update the affected exact key-set assertions.
  - [x] 3.8 Ensure the personal-context tests pass
    - Run only `tests/test_personal_pickup.py`, `tests/test_item_reservations_router.py` and `tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- The tests from 3.1 pass.
- Take, propose, accept, confirm and cancel share one code path, with no `None`-branching on the context.
- The old term/event take/propose routes still work at the end of this group (they are removed in Group 4).

---

### Task Group 4: S1 Legacy take/propose route removal and backend test migration
**Dependencies:** 3
**Files to Modify:** `src/backend/app/groups/router/term_item_listings.py`, `src/backend/app/groups/router/event_item_listings.py`, `src/backend/app/groups/router/__init__.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/events/schemas.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_item_reservations_router.py`, `src/backend/tests/test_domain_clock_guard.py`, `src/backend/tests/test_event_item_reservations.py`, `src/backend/tests/test_event_reservation_delete.py`, `src/backend/tests/test_event_reservation_readers.py`, `src/backend/tests/test_exchange_summary.py`, `src/backend/tests/test_group_soft_delete_keep_live.py`, `src/backend/tests/test_handover_copy_api.py`, `src/backend/tests/test_item_details.py`, `src/backend/tests/test_item_history.py`, `src/backend/tests/test_item_listing_status.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_reservation_write_guards.py`, `src/backend/tests/test_term_clock_regressions.py`, `src/backend/tests/test_term_end_scan.py`, `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_term_item_listings_router.py`
**Estimated Steps:** 6

- [x] 4.0 Complete the move to the single reservation write path
  - [x] 4.1 Write 2–8 focused tests
    - `tests/test_item_reservations_router.py`: `test_removedTakeProposeRoutes_returns404or405`, parametrised over `POST /api/term-item-listings/{id}/take|propose` and `POST /api/events/{id}/items/{id}/take|propose`.
    - `tests/test_authorization_matrix.py`: `test_matrix_removedReservationRows_absent`. The GET `term-item-listings` rows and the swap-proposal/reservation action rows stay.
  - [x] 4.2 Remove the old routes and use cases
    - The POST take/propose routes in `groups/router/term_item_listings.py`, and the take/propose routes in `groups/router/event_item_listings.py`. If that router becomes empty, delete the file and unregister it in `__init__.py`.
    - The use cases `take_item_listing`, `take_event_item`, `propose_swap` and `propose_event_swap`.
    - The schemas `TakeTermItemListingRequest`, `ProposeSwapRequest`, `EventTakeRequest`, `EventProposeRequest` and `EventTakeResponse`.
  - [x] 4.3 Remove the matrix rows
    - Row 58 `POST ^/api/term-item-listings(/.*)?$`, row 61 `POST ^/api/term-item-listings/[^/]+/propose$`, and `POST ^/api/events/[^/]+/items/[^/]+/(take|propose)$`.
    - Re-verify the first-match-wins order for the remaining rows.
  - [x] 4.4 Migrate the 17 backend test files listed in the spec (audit M7)
    - Move their calls to `POST /api/items/{id}/take|propose` with a TERM/EVENT `context` (or to `take_item`/`propose_item_swap`), through one per-file `_take(client, headers, item_id, context, ...)` helper.
    - Assertions are moved, never deleted or loosened.
    - The `test_term_item_listings.py` competing-proposal case keeps its current expectation until Group 10.
  - [x] 4.5 Update `test_domain_clock_guard.py`
    - Update its module/function references to the new use-case names, so the guard still covers `app/groups/application` and `app/groups/router`.
  - [x] 4.6 Ensure the migrated and new tests pass
    - Run only the 17 migrated files plus `tests/test_item_reservations_router.py` and `tests/test_authorization_matrix.py`.
    - Run `grep` for the removed names (`take_item_listing|propose_swap|take_event_item|propose_event_swap|TakeTermItemListingRequest|EventTakeRequest`) and expect no hits under `src/backend`.

**Acceptance Criteria:**
- The tests from 4.1 pass, and all 17 migrated files pass.
- The only reservation-creating writes are `POST /api/items/{id}/take|propose`.
- The removed names have no remaining references in the backend.

---

### Task Group 5: S1 `/actions` v2 read model (contexts, location, personal pickup, party reservation)
**Dependencies:** 2, 3
**Files to Modify:** `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/router/item_actions.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/infrastructure/events_acl.py`, `src/backend/app/groups/infrastructure/slug_resolver.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/groups/infrastructure/locations_acl.py`, `src/backend/tests/test_item_actions.py`, `src/backend/tests/test_party_reservation_actions.py` (new)
**Estimated Steps:** 8

- [x] 5.0 Complete the `/actions` v2 read model
  - [x] 5.1 Write 2–8 focused tests
    - `tests/test_item_actions.py`: replace the hint, `context` and "both params 400" tests with:
      - `test_getItemActions_exactKeySet` (the new `ItemActionsResponse`, `ItemContextOptionResponse`, `ItemLocationResponse`);
      - `test_getItemActions_contexts_ownerEligibleUpcomingOrderedTermWinsTieMax5`;
      - `test_getItemActions_contexts_viewerFilterBeforeLimit`: an owner with 5 invisible PRIVATE-circle terms and 1 visible event, where the event is still returned;
      - `test_getItemActions_location_shapedPerViewer` (OWN all three fields; OTHER name only, `null` when soft-deleted/unset; anonymous `null`; never coordinates);
      - `test_getItemActions_personalPickupAvailable_rules`;
      - `test_getItemActions_statementCount_oneVsFiveContextsEqual` (`count_queries(engine)`).
    - `tests/test_party_reservation_actions.py`:
      - `test_partyReservation_nonParty_null`;
      - `test_partyReservation_personalGift_receiverCanConfirm_giverCanCancelOnly`;
      - `test_partyReservation_pairedSwap_bothCanConfirmAndCancel`;
      - `test_partyReservation_unpairedSwapLeg_allFalse`;
      - `test_partyReservation_pendingProposal_ownerCanAcceptReject_proposerNone`;
      - `test_partyReservation_termNotEnded_confirmCancelFalse`.
  - [x] 5.2 Add `repository.list_upcoming_owner_terms_for_viewer(owner_party_id, viewer_party_id | None, now, limit=5)`
    - One statement, modelled on `nearest_public_term_for_party`/`_qualifying_owner_circles`.
    - The owner-eligible terms are those where the owner leads the circle or holds a non-withdrawn RSVP, with `starts_at >= now`.
    - The viewer-visibility filter (PUBLIC circle, or the viewer leads the circle or holds an RSVP on it) goes in the `WHERE`, followed by `ORDER BY starts_at` and `LIMIT`.
    - It returns the circle id, circle visibility, location id and a computed `viewer_eligible` column, all with bound parameters.
  - [x] 5.3 Events ACL
    - New batched `events_acl.eligible_event_ids(viewer_party_id, event_ids)` (author or active account attendee), based on `is_event_eligible`.
    - Use `list_upcoming_events_for_parties([owner], now, limit=5)` and the batched `author_slugs`.
  - [x] 5.4 Slug resolver
    - New batched `slug_resolver.resolve_organizer_slugs(db, group_ids)`, replacing the per-term `resolve_organizer_slug` in this read model.
  - [x] 5.5 Rewrite `item_actions.py`
    - Drop the `term`/`event` query params and the 400 rule.
    - Merge the terms and events, sort by `starts_at` (a term wins a tie) and cap at 5.
    - One batched location lookup for the context location ids (`locations_acl`).
    - Set `eligible` per context: the viewer is logged in, not the owner, and passes the context's rule (computed in batch).
    - Shape the viewer location from the owner's PERSONAL inventory through `circulation_bridge`.
    - `personal_pickup_available` = logged in, not the owner, `available`, a non-null mode, and a live location.
  - [x] 5.6 Party reservation
    - Extract shared predicates from `term_item_listings.py` (`_resolve_transaction_reservations_for_action`, `confirm_race_rules._require_recipient_to_confirm_gift`, the accept/reject owner check).
    - Build `ItemPartyReservationResponse {role, reservation_id, proposal_id, reservation_type, personal_pickup, can_confirm, can_cancel, can_accept, can_reject}` from them, using `load_for_reservation(...).require_ended()`.
    - Return it only to a party of the active reservation or of a PROPOSED proposal.
  - [x] 5.7 Schemas and router
    - `ItemActionsResponse` with `mode`, `visibility` (always `null` until S3), `available`, `reservation` (always `null` until S2), `party_reservation`, `owner`, `viewer` (`ANONYMOUS|OWN|OTHER`), `location`, `contexts` and `personal_pickup_available`.
    - The `groups/router/item_actions.py` signature has no query params.
  - [x] 5.8 Ensure the `/actions` tests pass
    - Run only `tests/test_item_actions.py` and `tests/test_party_reservation_actions.py`.

**Acceptance Criteria:**
- The tests from 5.1 pass.
- The statement count is equal for 1 and 5 contexts.
- No response gives a non-owner the address, coordinates, `google_place_id` or notes.
- The flags come from the same predicates as the write paths.

---

### Task Group 6: S1 Frontend API clients and hooks
**Dependencies:** 4, 5
**Files to Modify:** `src/frontend/src/api/itemReservations.ts` (new), `src/frontend/src/api/itemActions.ts`, `src/frontend/src/api/eventItems.ts` (delete), `src/frontend/src/api/termItemListings.ts`, `src/frontend/src/api/reservations.ts`, `src/frontend/src/api/inventories.ts`, `src/frontend/src/api/items.ts`, `src/frontend/src/hooks/useMyInventoryLocation.ts` (new), `src/frontend/src/hooks/useItemActions.ts`, `src/frontend/src/pages/term/hooks/useItemTake.ts`, `src/frontend/src/test/useItemTake.test.tsx`, `src/frontend/src/test/useMyInventoryLocation.test.tsx` (new), `src/frontend/src/test/useItemActions.test.tsx` (new)
**Estimated Steps:** 7

- [x] 6.0 Complete the frontend data layer for S1
  - [x] 6.1 Write 2–8 focused tests (Vitest, `createQueryWrapper()`, `vi.mock` API modules, typed fixtures with no `as` casts)
    - `useItemTake.test.tsx`, rewritten:
      - a personal GIFT calls `takeItem(id, {context:{kind:"PERSONAL"}, reservation_type})`;
      - a TERM target sends `{kind:"TERM", id}`;
      - SWAP opens the picker, then `proposeItemSwap` with the context;
      - success awaits invalidation of the listed prefixes;
      - an anonymous caller hits the account gate.
    - `useMyInventoryLocation.test.tsx`: get returns the ref, and set awaits invalidation of its prefix and `item-actions`.
    - `useItemActions.test.tsx`: the key includes the viewer id, so a login change refetches.
  - [x] 6.2 `src/api/itemReservations.ts`
    - `takeItem(itemId, ItemTakeRequest)` and `proposeItemSwap(itemId, ItemProposeRequest)`.
    - Types `ReservationContextRef` (uppercase `kind`) and `ItemTakeResponse`.
  - [x] 6.3 Types and cleanup
    - Move `ItemContextResponse` from `eventItems.ts` to `itemActions.ts`. Add `ItemContextOptionResponse`, `ItemLocationResponse`, `ItemPartyReservationResponse` and the new `ItemActionsResponse` (with `reservation: null` and `visibility: null` typed for later slices).
    - `getItemActions(itemId)` takes no context.
    - Delete `src/api/eventItems.ts`, and delete `takeTermItemListing`/`proposeSwap` from `termItemListings.ts`.
    - `AcceptedSwapProposalResponse.term_occurs_on`/`group_name` become `string | null`.
    - `ReservationDetailResponse.personal_pickup: boolean` (`reservations.ts`); `ItemStatusResponse.personal_pickup: boolean` (in the module that holds it).
  - [x] 6.4 Location API and hook
    - `getMyInventoryLocation`/`setMyInventoryLocation` in `src/api/inventories.ts`.
    - `src/hooks/useMyInventoryLocation.ts`: a prefix-constant key, an app-shaped return, and a mutation that awaits invalidation of its own prefix and `item-actions`.
  - [x] 6.5 `useItemActions`
    - Drop the context parameter. The key is `[ITEM_ACTIONS, itemId, viewerUserId | null]`, with `viewerUserId` from `useAuth()` (audit L9). The prefix constant is unchanged.
  - [x] 6.6 `useItemTake` refactor
    - `take(itemId, mode, target)`/`confirm` with `TakeTarget = {kind:"PERSONAL"} | {kind:"TERM"|"EVENT", id, name, starts_at, path}`, and no `context` dependency.
    - Keep the swap picker, busy state, success state and account gate.
    - Await invalidation of `item-actions`, `itemDetails`, `owner-items`, `event`, `organizer-page`, `notifications`, `groupAccess` and `my-inventory-items`.
  - [x] 6.7 Ensure the data-layer tests pass
    - Run only the 3 test files from 6.1 with Vitest. `tsc` is expected to fail in the term page until Group 9 (see Key Decisions), so do not fix it here by keeping the old APIs.

**Acceptance Criteria:**
- The tests from 6.1 pass.
- `eventItems.ts` and the old take/propose functions are gone.
- No query key carries the auth token.

---

### Task Group 7: S1 Product page UI (three actions, sheets, party actions)
**Dependencies:** 6
**Files to Modify:** `src/frontend/src/pages/product/itemActionsViewState.ts`, `src/frontend/src/pages/product/ItemContextActions.tsx`, `src/frontend/src/pages/product/ItemDetailPage.tsx`, `src/frontend/src/pages/product/ItemStatusCard.tsx`, `src/frontend/src/pages/product/ChooseContextSheet.tsx` (new), `src/frontend/src/pages/product/PersonalPickupSheet.tsx` (new), `src/frontend/src/pages/product/PartyReservationActions.tsx` (new), `src/frontend/src/test/itemActionsViewState.test.ts`, `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/ItemStatusCard.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/strona-produktu-zalogowany-3-akcje.html
  element: screen:product-logged-in
  locator: "#mockup-content" body, lines 248–270 (".card.loc" at 253, "Gdzie jeszcze można odebrać" at 256, "Jak chcesz odebrać?" at 261)
  acceptance: the header intent badge; the "📍 Lokalizacja przedmiotu" card with the name and "Dokładny adres ustalicie na czacie."; the read-only context list (day, name, event tag, 📍 place, time); then, in this order under "Jak chcesz odebrać?", "Odbiorę osobiście", "Wybieram termin", "💬 Napisz o przedmiocie"
- mockup: analysis/design-context/mockups/strona-produktu-niezalogowany.html
  element: screen:product-anonymous
  locator: lines 248–265 (context list at 254, gate at 260–261)
  acceptance: no location block; the context list is shown; the gate copy "Chcesz tę rzecz? Zaloguj się, żeby zarezerwować lub napisać do właściciela." with "Zaloguj się" and "Załóż konto" through `useAccountGate`/`AuthGateSheet`; no reserve or chat buttons
- mockup: analysis/design-context/mockups/strona-produktu-m-j-przedmiot.html
  element: screen:product-own
  locator: lines 250–265 (badges 250, ".card.loc" 253, context list 257, note 262)
  acceptance: the location card shows the name, the address and "(widzisz tylko Ty)", with a "Zmień w „Moje rzeczy”" link; the note "To Twoja rzecz. Inni mogą ją zarezerwować osobiście albo na Twoich terminach."; no reserve actions (the 🔒 badge and visibility line come in Group 15)
- mockup: analysis/design-context/mockups/strona-produktu-zarezerwowana.html
  element: screen:product-reserved
  locator: lines 250–260 (status ".status" 253, ".card.loc" 254)
  acceptance: S1 party view only. The status card reads "Zarezerwowana" (or "W drodze" for IN_TRANSIT) with "Odbiór osobisty — szczegóły ustalacie na czacie." and no date or calendar button for `personal_pickup`. Party buttons ("Potwierdzam przekazanie", "Anuluj rezerwację", "Przyjmij zamianę"/"Odrzuć") sit above the chat button, using the existing `ItemContextActions` button styles (no mockup, R8.6 copy). The chat stays enabled.
- mockup: analysis/design-context/mockups/arkusz-wybieram-termin.html
  element: screen:sheet-choose-term
  locator: ".sheet", lines 249–256
  acceptance: the title "Wybierz termin odbioru"; the hint "Pokazujemy terminy i wydarzenia, w których bierzesz udział razem z <owner>."; a radio fieldset of the eligible contexts only; GIFT has a primary reserve button; SWAP shows the note "<owner> chce się zamienić — w następnym kroku wybierzesz rzecz, którą zaproponujesz." and the button "Dalej: wybierz rzecz na zamianę"
- mockup: analysis/design-context/mockups/arkusz-odbior-osobi-cie.html
  element: screen:sheet-personal-pickup
  locator: ".sheet", lines 249–255
  acceptance: the title "Odbiór osobisty"; "📍 <location name>" only (no address); "Dokładny adres i godzinę ustalicie z <owner> na czacie — nie udostępniamy adresu w aplikacji."; the GIFT or SWAP body copy from R5.7; the buttons "Rezerwuję i piszę do <owner>" and "Anuluj"
**Estimated Steps:** 9

- [x] 7.0 Complete the product page as the reservation surface
  - [x] 7.1 Write 2–8 focused tests
    - `itemActionsViewState.test.ts`: one `it.each` table over every kind (`loading`, `hidden`, `error`, stale and refresh-error rows, `own`, `anonymous`, `choose` with and without a location or eligible contexts, `reserved` for a party, `unavailable` for a non-party).
    - `ItemDetailPage.test.tsx`, replacing the "context actions" block at 422–651:
      - logged-in: the 3 actions, the location block and the context list;
      - "Odbiorę osobiście" with `location === null` is `aria-disabled` with an `aria-describedby` hint, and its handler is guarded;
      - "Wybieram termin" with a TERM context reserves with `{kind:"TERM", id}`, and with an EVENT context with `{kind:"EVENT", id}`. These are the C7 replacements for the `TermPage.test.tsx` take tests;
      - SWAP via the sheet opens `SwapProposeDialog`;
      - a personal success opens the ITEM chat, and a chat failure still shows the reservation plus a separate error;
      - the anonymous gate;
      - the party buttons call `confirmTransaction`/`cancelTransaction`/`acceptSwapProposal`/`rejectSwapProposal`, show their hints, and a `TERM_ALREADY_RESOLVED` 409 shows its message and refetches.
    - `ItemStatusCard.test.tsx`: the `personal_pickup` copy for RESERVED and IN_TRANSIT, with no calendar button.
  - [x] 7.2 Rewrite `itemActionsViewState.ts`
    - A pure discriminated union: `loading`, `hidden`, `error`, `own{location,contexts,visibility,partyReservation}`, `anonymous{owner,mode,contexts}`, `reserved{reservation,partyReservation,location}`, `unavailable{owner}` and `choose{owner,mode,location,contexts,eligibleContexts,personalPickup}`.
    - In S1, `reserved` is chosen when `party_reservation` is non-null.
  - [x] 7.3 `ItemDetailPage.tsx`
    - Remove `itemContextFrom` and every read of `?term=`/`?event=`.
    - Switch only on `view.kind`, and render the header intent badge.
  - [x] 7.4 `ItemContextActions.tsx`
    - The location block per viewer and the read-only context list ("Gdzie jeszcze można odebrać" / "Terminy i wydarzenia, na których bywa <owner>").
    - The three actions with the `aria-disabled` hints from R5.5, and the chat via `chat.open({kind:"ITEM", id})` in every non-own, non-hidden state.
    - The anonymous gate, and the own-view copy (R5.11).
  - [x] 7.5 `ChooseContextSheet.tsx`
    - A `ModalSheet` with `useRegisterOpenSheet(open)`, a radio fieldset with a legend, `type="button"` everywhere, and focus return to the opener.
    - GIFT calls `confirm` with the target. SWAP continues to `SwapProposeDialog`, and success shows `TakeSuccessSheet`.
  - [x] 7.6 `PersonalPickupSheet.tsx`
    - The R5.7 copy and the GIFT/SWAP branches. SWAP proposes with `{kind:"PERSONAL"}`.
    - On success, call `useOpenAndNavigate().open({kind:"ITEM", id})`. A chat failure is shown separately through `extractProblemMessage` while the page shows `reserved`.
  - [x] 7.7 `PartyReservationActions.tsx`
    - The buttons from the `can_*` flags.
    - The hints: the GIFT giver, the proposer waiting, and "Potwierdzicie po terminie.".
    - `type="button"`, disabled while busy, verbatim `extractProblemMessage`, a refetch on `TERM_ALREADY_RESOLVED`, and awaited invalidation of the R8.6 prefixes.
    - Rendered in the `reserved` and `own` views above the chat button.
  - [x] 7.8 `ItemStatusCard.tsx`
    - When `status.personal_pickup`: "Zarezerwowana" or "W drodze" with "Odbiór osobisty — szczegóły ustalacie na czacie.", and no date or calendar button.
  - [x] 7.9 Ensure the product-page tests pass
    - Run only the 3 test files from 7.1.

**Acceptance Criteria:**
- The tests from 7.1 pass, including product-page take coverage for both TERM and EVENT contexts (C7 precondition for Group 9).
- The page has no reads of `?term=`/`?event=`.
- The implementation matches each `acceptance` criterion in the Visual References above.

---

### Task Group 8: S1 Moje rzeczy inventory location and immediate personal confirm/cancel
**Dependencies:** 6
**Files to Modify:** `src/frontend/src/pages/items/MyItemsView.tsx`, `src/frontend/src/pages/items/InventoryLocationCard.tsx` (new), `src/frontend/src/test/MyItemsView.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/mockups/moje-rzeczy-lokalizacja-i-widoczno.html
  element: screen:my-items-location-visibility
  locator: the "📍 Gdzie są moje rzeczy?" card at line 249 (the location part only; the per-item toggle rows at 255–262 belong to Group 15)
  acceptance: a card labelled "📍 Gdzie są moje rzeczy?" with `LocationPicker` (creating through the `useMyLocations` `create` prop), and below it the hint "Inni zalogowani zobaczą tylko nazwę miejsca (np. „Dom – Mokotów”), nigdy adres. Bez lokalizacji nie da się zarezerwować „osobiście”."; a soft-deleted location shown with "(usunięte)"
**Estimated Steps:** 5

- [x] 8.0 Complete the S1 changes to Moje rzeczy
  - [x] 8.1 Write 2–8 focused tests in `MyItemsView.test.tsx`
    - picking a location calls `setMyInventoryLocation`, and clearing sends `null`;
    - the hint copy renders;
    - a personal GIFT shows "Potwierdź" immediately for the receiver and only "Anuluj" for the giver;
    - a personal SWAP shows both buttons to either party, and an unpaired leg shows neither;
    - an accepted personal swap with a null `term_occurs_on`/`group_name` shows "Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie.".
  - [x] 8.2 `InventoryLocationCard.tsx`
    - Uses `useMyInventoryLocation` and `LocationPicker`, passing the host hook's `create` down as a prop (data-fetching standard). Rendered at the top of `MyItemsView`.
  - [x] 8.3 R5a in `MyItemsView.tsx` (`:120-135`)
    - `hasEnded = reservation.personal_pickup || term_occurs_on has passed`. Keep the GIFT recipient-only "Potwierdź" rule, and keep the unpaired-leg rule.
  - [x] 8.4 Accepted-swap null handling (`:178-185`)
    - The personal copy with no date when `term_occurs_on`/`group_name` are null.
  - [x] 8.5 Ensure the Moje rzeczy tests pass
    - Run only `MyItemsView.test.tsx` and `MyItemsViewCategory.test.tsx`.

**Acceptance Criteria:**
- The tests from 8.1 pass.
- Confirm/cancel for personal reservations are available immediately.
- The location card matches the `acceptance` criteria above.

---

### Task Group 9: S1 Tile cleanup, intent badges and term-page take removal
**Dependencies:** 7, 8
**Files to Modify:** `src/frontend/src/pages/term/components/termLabels.ts`, `src/frontend/src/components/shared/ItemTileBadges.tsx` (new), `src/frontend/src/components/shared/ParticipantItemsPreview.tsx`, `src/frontend/src/pages/term/views/PublicTermView.tsx`, `src/frontend/src/pages/term/components/AttendeeList.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeItemCard.tsx`, `src/frontend/src/pages/organizer/blocks/RecentItemsBlock.tsx`, `src/frontend/src/pages/owner/OwnerItemsPage.tsx`, `src/frontend/src/pages/product/useItemRoutes.ts`, `src/frontend/src/pages/events/components/EventAttendeeList.tsx`, `src/frontend/src/pages/term/termViewModel.ts`, `src/frontend/src/test/ItemTileBadges.test.tsx` (new), `src/frontend/src/test/ParticipantItemsPreview.test.tsx`, `src/frontend/src/test/OwnerItemsPage.test.tsx`, `src/frontend/src/test/organizerCirclesExchangeBlocks.test.tsx`, `src/frontend/src/test/TermPage.test.tsx`, `src/frontend/src/test/LayoutRenderer.test.tsx`, `src/frontend/src/test/EventComponents.test.tsx`, `src/frontend/src/test/OrganizerItemRoute.test.tsx`, `src/frontend/src/test/AppPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/strona-terminu-rzeczy-uczestnik-w.html
  element: screen:term-participant-items
  locator: the ".prow" rows, lines 250–256
  acceptance: each row is a single link to `/product/{id}` with the thumbnail, name and intent pill; no take/swap button on any row (the reserved pill comes in Group 12)
- mockup: analysis/design-context/mockups/strona-terminu-rzeczy-uczestnik-w.html
  element: component:intent-badge
  locator: the pills inside the ".prow" rows, lines 252–253
  acceptance: text pills "Chcę oddać" (GIFT, `bg-primary-soft text-primary-fg`) and "Chcę się zamienić" (SWAP, `bg-accent-soft text-accent-fg`), toned through `EXCHANGE_MODE_TONE`
- mockup: analysis/design-context/mockups/strona-organizatora-tablica-wymiany-i-liczniki.html
  element: screen:organizer-exchange-board
  locator: the ".grid4" tiles at line 251 (the tiles only; the counts and tabs at 249–250 belong to Group 12)
  acceptance: an `ItemCard` with the thumbnail, name, "Stan: …" and the intent pill; the whole tile is a stretched link to the product page; no date chip and no pickup chip-link
- mockup: analysis/design-context/mockups/rzeczy-w-a-ciciela-niezalogowany.html
  element: screen:owner-items-anonymous
  locator: the ".grid" tiles at line 250, and "Najbliżej" at 248
  acceptance: "Najbliżej: …" is kept under the heading; the tiles show the intent pill and link to the product page (the reserved pill comes in Group 12)
**Estimated Steps:** 8

- [x] 9.0 Complete the S1 tiles
  - [x] 9.1 Write 2–8 focused tests
    - `ItemTileBadges.test.tsx`: the GIFT and SWAP pill text and tone.
    - `ParticipantItemsPreview.test.tsx`: the row is one link to `/product/{id}` with no buttons (fixes `:91`).
    - `OwnerItemsPage.test.tsx`: the tile link, the intent pill, and that "Najbliżej" is kept.
    - `organizerCirclesExchangeBlocks.test.tsx:151,192`: no pickup chip, and the card links to the product page.
    - `TermPage.test.tsx`: no take/swap buttons on the listing rows, and the "Ja to przyniosę" pledge guest-merge still works.
  - [x] 9.2 `termLabels.ts`
    - Add `INTENT_LABELS = {GIFT:"Chcę oddać", SWAP:"Chcę się zamienić"}`.
    - Delete `PREVIEW_MODE_LABELS`, `PICKUP_MODE_LABELS` and `TAKE_ACTION_LABELS`, and remove the tile uses of `EXCHANGE_MODE_LABELS`.
  - [x] 9.3 `components/shared/ItemTileBadges.tsx`
    - The text intent pill only. The `reservation` prop is added in Group 12, not stubbed now.
  - [x] 9.4 `ParticipantItemsPreview.tsx`
    - Drop the `renderActions` slot. Make the row a single stretched link to `/product/{id}` (no query) with `ItemTileBadges`.
  - [x] 9.5 Term page
    - Remove the `PublicTermView.toListingRow` actions, its `useItemTake` usage and its `SwapProposeDialog`/`TakeSuccessSheet`.
    - Remove `AttendeeList.ListingActions`/`actionTone`.
    - Keep `useGuestMerge` only on the pledge rows.
  - [x] 9.6 Organizer and owner tiles
    - `ExchangeItemCard`/`ItemCard`: remove the date chip and the `pickup` chip-link, make the tile a stretched link, and add the badges. Update `RecentItemsBlock` and `OwnerItemsPage` the same way.
    - `organizerItemPath` drops its `context` param, and `itemContextQuery`/`nearestItemContext`/URL `ItemContext` are deleted from `useItemRoutes.ts`.
    - Update every call site, including the event page.
  - [x] 9.7 Migrate the frontend tests
    - Delete the `TermPage.test.tsx` take tests (226, 256, 291, 493–602, 1220) now that their Group 7 equivalents exist. Keep the pledge guest-merge tests.
    - Update `LayoutRenderer.test.tsx:416–427`, `EventComponents.test.tsx`, `OrganizerItemRoute.test.tsx` and `AppPage.test.tsx:156–157`, using typed fixtures.
  - [x] 9.8 Ensure the tile tests pass and `tsc` is clean
    - Run only the test files listed in this group.
    - Run `tsc -p tsconfig.app.json` from `src/frontend`. It must be clean from this group on.

**Acceptance Criteria:**
- The tests from 9.1 pass, and `tsc -p tsconfig.app.json` is clean.
- No tile renders a take or swap button. Every tile shows an intent badge and links to the product page.
- The implementation matches each `acceptance` criterion in the Visual References above.

---

## Slice S2: reserved items on lists

### Task Group 10: S2 Listed-items select, pending-proposal guard and reservation-read privacy
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9 (S1 complete)
**Files to Modify:** `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/service.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/events/infrastructure/circulation_acl.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/exchange_summary.py`, `src/backend/app/groups/schemas.py`, `src/backend/tests/test_reserved_listings.py` (new), `src/backend/tests/test_circulation.py`, `src/backend/tests/test_organizer_bridges.py`, `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_exchange_summary.py`
**Estimated Steps:** 7

- [x] 10.0 Complete the S2 data and guard layer
  - [x] 10.1 Write 2–8 focused tests
    - `tests/test_reserved_listings.py`:
      - `test_listedItemsSelect_includesReservedAndInTransitWithReserver_excludesDeleted`;
      - `test_takeItem_pendingProposal_returns409`;
      - `test_takeAndPropose_concurrent_secondReturns409`, using two sessions and the `FOR UPDATE` row.
    - `tests/test_circulation.py`:
      - `test_listReservations_nonParty_returnsEmpty`;
      - `test_getReservation_nonParty_returns404`;
      - `test_getReservation_party_returnsDetail`.
    - Flip `tests/test_organizer_bridges.py::test_listAvailableItemsWithProduct_onlyLiveAvailableItems_returnsViews` to the new select.
    - `tests/test_term_item_listings.py`: flip the competing-proposal case to 409, and assert that browse no longer exposes the proposer's reservation or party id.
  - [x] 10.2 `listed_items_with_product_select()`
    - In the circulation repository, replacing `available_items_with_product_select`.
    - Returns `(item_id, product_id, product_name, condition, balance_status, reserved_by_user_id)` for live items whose balance is AVAILABLE, RESERVED or IN_TRANSIT. `reserved_by_user_id` comes from one `DISTINCT ON` / correlated subquery over the newest active reservation.
    - Re-export it through `circulation_bridge` and `events/infrastructure/circulation_acl.py`.
    - The remaining `list_available_items_with_product` callers keep an explicit AVAILABLE filter.
  - [x] 10.3 Pending-proposal guard
    - New `repository.lock_item_listing_preference` (`with_for_update()`, `populate_existing`).
    - In `_take`/`_propose`, after the context and eligibility gates: lock the row, then require the balance to be AVAILABLE (409 "Ta rzecz jest już zajęta"), then require no PROPOSED proposal (409 "Ktoś już zaproponował zamianę za tę rzecz").
  - [x] 10.4 Reservation-read party check
    - In `circulation.service`: `GET /api/reservations?item_id=` filters to `reserved_by_user_id` or `giver_user_id` equal to the caller, and `GET /api/reservations/{id}` returns 404 to a non-party. Row 42 is unchanged.
  - [x] 10.5 Takeability semantics
    - `_resolve_listing_status` drops the PROPOSED-swap proposer fallback, and `BrowseTermItemListingResponse` no longer exposes it.
    - `list_browsable_term_item_listings` also excludes items with a PROPOSED proposal.
    - `exchange_summary._is_item_available` returns false when a PROPOSED proposal targets the item.
  - [x] 10.6 Check the remaining callers
    - Re-check every remaining caller of the old select, listed by `grep`, and confirm each one keeps AVAILABLE-only semantics.
  - [x] 10.7 Ensure the S2 guard tests pass
    - Run only the 5 test files in this group.

**Acceptance Criteria:**
- The tests from 10.1 pass.
- A second take or proposal on an item with a pending proposal returns 409, including under concurrency.
- `GET /api/reservations*` returns no other users' data.

---

### Task Group 11: S2 Reserved state on read models, counts and cache headers
**Dependencies:** 10
**Files to Modify:** `src/backend/app/circulation/domain/item_privacy.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/events/schemas.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/organizer_page.py`, `src/backend/app/groups/application/owner_items.py`, `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/infrastructure/organizations_acl.py`, `src/backend/app/groups/router/organizer_page.py`, `src/backend/app/groups/router/circles.py`, `src/backend/app/events/page.py`, `src/backend/app/events/infrastructure/groups_acl.py`, `src/backend/tests/test_reserved_listings.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_event_page.py`, `src/backend/tests/test_organizer_page.py`, `src/backend/tests/test_owner_items_page.py`, `src/backend/tests/test_organizer_page_queries.py`, `src/backend/tests/test_item_actions.py`, `src/backend/tests/test_item_details.py`
**Estimated Steps:** 9

- [x] 11.0 Complete reserved items on every list
  - [x] 11.1 Write 2–8 focused tests (mostly in `tests/test_reserved_listings.py`)
    - `test_reservedBy_perViewer_anonymousNullLoggedInNameRecipientByMe`, parametrised over the `/access` term listings, the event page, the organizer page and the owner items page;
    - `test_reservedBy_offeredItem_labelsListingOwner_pendingProposalLabelsProposer`;
    - `test_counts_organizerAvailableOnlyPlusReserved_ownerIncludesReservedEqualsItemsTotal`;
    - `test_cacheHeaders_anonymousPublic_authenticatedPrivateNoStore_invalidTokenPublic_varyAuthorization`, on all three personalised routes;
    - `test_access_termListings_statementCount_oneVsFiveIncludingReservedEqual`;
    - `test_getItemActions_pendingProposal_unavailableWithReservation`.
    - Flip the reserved-hidden tests to "listed with reservation":
      - `test_public_term.py::test_getPublicCircle_takenItem_disappearsFromPublicListings`;
      - `test_event_page.py::test_getEvent_participantItems_onlyAvailableListedItems`;
      - `test_organizer_page.py::test_getOrganizerPage_exchange_onlyEligibleAvailableItemsDedupedToNearestTerm`;
      - `test_owner_items_page.py::test_getOwnerItems_organizationSlug_exactShapeNewestFirstModeFilterAndPages`.
    - Re-baseline `test_organizer_page_queries.py`.
  - [x] 11.2 `item_privacy.reserver_label`
    - `reserver_label(recipient, viewer, display_name)` for RESERVED/IN_TRANSIT/PROPOSED_SWAP in `derive_status`: anonymous gets `None`, the recipient gets "Ty", anyone else gets the name with "inna rodzina" as the fallback.
    - LENT, RETURNING and history are unchanged. Update the module docstring with the rule change.
  - [x] 11.3 `ReservedByResponse`
    - `ReservedByResponse {by_name, by_me}`, added as `reservation` to `PublicItemListingResponse`, `EventParticipantItemResponse`, `OrganizerExchangeItemResponse`, `OwnerItemCardResponse` and `ItemActionsResponse`.
    - One groups-side resolver joins the PROPOSED `SwapProposal`, and batches the names at most once per id kind (parties, users).
  - [x] 11.4 Public term listings
    - Rebuild `list_public_term_item_listings(db, term_id, *, viewer_party_id)` as one statement (preferences ⋈ `listed_items_with_product_select()` ⟕ PROPOSED proposal), followed by one batched profile lookup by party id and one by user id.
    - Remove the per-item `_is_item_available` and the per-row `_build_listing_views`/`_resolve_listing_status`/profile loops.
    - `_listing_thumb_urls` takes the product ids from the same rows.
    - `get_group_access` passes `viewer_party_id` into `get_public_circle_view`. `GET /api/groups/public/{group_id}` keeps the anonymous defaults.
  - [x] 11.5 Event page
    - `events/page._listed_items_by_party` uses the new select and adds `reservation`. `items_total` counts every listed live item.
  - [x] 11.6 Organizer and owner counts
    - `organizer_page._build_exchange`: `OrganizerExchangeCounts {GIFT, SWAP, RESERVED}`, where GIFT/SWAP count available items only. The ranking, dedup and cap are unchanged.
    - `owner_items._counts`/`_list_owner_items`/`count_owner_items`: `OwnerItemCountsResponse {GIFT, SWAP}` includes reserved items, so GIFT + SWAP = `items_total`.
  - [x] 11.7 `/actions`
    - `available` additionally requires no PROPOSED proposal, and `reservation` is the `ReservedByResponse` for every viewer.
  - [x] 11.8 Cache headers
    - One helper in `groups/router/organizer_page.py` sets `Cache-Control` from the principal: `private, no-store` when resolved, `public, max-age=0, s-maxage=60` when anonymous or the token is invalid. It always sets `Vary: Authorization`.
    - Add `OptionalPrincipal` to `GET /api/groups/public/organizers/{slug}`, `/organizers/{slug}/items` and `/parties/{party_id}/items`. `/organizers/{slug}/terms` is unchanged.
  - [x] 11.9 Ensure the read-model tests pass
    - Run only the test files in this group.

**Acceptance Criteria:**
- The tests from 11.1 pass.
- Reserved items stay listed with `reservation`, and `by_name` is `null` for anonymous viewers, including through the public cache path.
- The list and `/access` statement counts are constant in the number of rows.
- The counts match their tabs on both pages.

---

### Task Group 12: S2 Frontend reserved badges, counts and reserved product view
**Dependencies:** 11
**Files to Modify:** `src/frontend/src/api/itemActions.ts`, `src/frontend/src/api/ownerItems.ts`, `src/frontend/src/api/organizations.ts`, `src/frontend/src/api/events.ts`, `src/frontend/src/api/groups.ts`, `src/frontend/src/components/shared/ItemTileBadges.tsx`, `src/frontend/src/components/shared/ParticipantItemsPreview.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeItemCard.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeCountsBlock.tsx`, `src/frontend/src/pages/organizer/blocks/ExchangeBoardBlock.tsx`, `src/frontend/src/pages/organizer/blocks/RecentItemsBlock.tsx`, `src/frontend/src/pages/owner/OwnerItemsPage.tsx`, `src/frontend/src/pages/product/itemActionsViewState.ts`, `src/frontend/src/pages/product/ItemContextActions.tsx`, `src/frontend/src/pages/product/ItemDetailPage.tsx`, `src/frontend/src/pages/product/ItemStatusCard.tsx`, `src/frontend/src/hooks/useOrganizerPage.ts`, `src/frontend/src/hooks/useOwnerItems.ts`, `src/frontend/src/test/ItemTileBadges.test.tsx`, `src/frontend/src/test/organizerCirclesExchangeBlocks.test.tsx`, `src/frontend/src/test/OwnerItemsPage.test.tsx`, `src/frontend/src/test/ParticipantItemsPreview.test.tsx`, `src/frontend/src/test/itemActionsViewState.test.ts`, `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/useOrganizerPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/strona-organizatora-tablica-wymiany-i-liczniki.html
  element: component:reserved-badge
  locator: the reserved ".chip" inside the ".grid4" tiles, line 251
  acceptance: a teal-soft text pill reading "Zarezerwowana", "Zarezerwowana · przez <by_name>", or "Zarezerwowana · przez Ciebie" when `by_me`; it sits next to the intent pill, which stays
- mockup: analysis/design-context/mockups/strona-organizatora-tablica-wymiany-i-liczniki.html
  element: screen:organizer-exchange-board
  locator: ".counts" at line 249 and ".tabs" at 250
  acceptance: "N Chcę oddać · N Chcę się zamienić · N Zarezerwowane"; the four tabs "Wszystkie / Chcę oddać / Chcę się zamienić / Zarezerwowane" filter as R10.3 (GIFT/SWAP tabs exclude reserved items)
- mockup: analysis/design-context/mockups/rzeczy-w-a-ciciela-niezalogowany.html
  element: screen:owner-items-anonymous
  locator: ".tabs" at line 249, ".grid" tiles at 250
  acceptance: the three tabs stay "Wszystkie / Chcę oddać / Chcę się zamienić"; an anonymous viewer sees the reserved pill reading only "Zarezerwowana" (no name)
- mockup: analysis/design-context/mockups/strona-terminu-rzeczy-uczestnik-w.html
  element: screen:term-participant-items
  locator: the reserved ".prow" at line 252 (dimmed thumbnail)
  acceptance: the reserved row keeps its link and intent pill and adds the reserved pill
- mockup: analysis/design-context/mockups/strona-produktu-zarezerwowana.html
  element: screen:product-reserved
  locator: badges at line 250, ".status" at 253, the actions card below 254
  acceptance: the header badge reads "Zarezerwowana · przez <imię>"; parties of a personal reservation see "Odbiór osobisty — szczegóły ustalają <owner> i <reserver> na czacie.", and non-parties see "Ta rzecz jest zarezerwowana."; for non-parties both reserve actions are `aria-disabled` with the hint "Ktoś już zarezerwował tę rzecz. Jeśli rezerwacja zostanie anulowana, znów będzie dostępna."; the chat stays enabled; "Dostępna" is suppressed during a pending proposal
**Estimated Steps:** 7

- [x] 12.0 Complete the reserved state in the UI
  - [x] 12.1 Write 2–8 focused tests
    - `ItemTileBadges.test.tsx`: an `it.each` over the three reserved variants plus `null`.
    - `organizerCirclesExchangeBlocks.test.tsx`: the three-count text, and that the four tabs filter consistently with the counts.
    - `OwnerItemsPage.test.tsx`: an anonymous viewer gets a reserved pill with no name.
    - `ParticipantItemsPreview.test.tsx`: the reserved pill.
    - `itemActionsViewState.test.ts`: rows for `reserved` with a non-party viewer, and a pending proposal on an AVAILABLE balance.
    - `ItemDetailPage.test.tsx`: in the non-party reserved view, the actions are `aria-disabled` with the hint, the chat is enabled, the header badge shows, and "Dostępna" is suppressed.
    - `useOrganizerPage.test.tsx`: a login changes the key and refetches. Cover owner items the same way.
  - [x] 12.2 Types
    - `ReservedByResponse` and `reservation: ReservedByResponse | null` on every list DTO type and on `ItemActionsResponse`.
    - `OrganizerExchangeCounts.RESERVED`.
    - Update the fixture factories, typed with no casts.
  - [x] 12.3 `ItemTileBadges` reserved pill
    - Add a `reservation` prop that renders the teal-soft pill. Wire it into `ParticipantItemsPreview`, `ExchangeItemCard`/`ItemCard`, `OwnerItemsPage` and `RecentItemsBlock`.
  - [x] 12.4 Counts and tabs
    - `ExchangeCountsBlock` shows the three counts, and `ExchangeBoardBlock` gets the four client-side tab filters (R10.3).
  - [x] 12.5 Reserved product view
    - `resolveItemActionsView` picks `reserved` for every viewer when `reservation` is non-null.
    - The header badge, the status copy for parties and non-parties, the `aria-disabled` reserve actions with the hint, and the "Dostępna" suppression in `ItemStatusCard`/the header.
  - [x] 12.6 Viewer key discriminator
    - `useOrganizerPage`/`useOwnerItems` keys add `viewerUserId | null` from `useAuth()`. The prefix constants are unchanged.
  - [x] 12.7 Ensure the reserved-UI tests pass
    - Run only the test files in this group, then run `tsc -p tsconfig.app.json`.

**Acceptance Criteria:**
- The tests from 12.1 pass, and `tsc` is clean.
- Reserved tiles keep their intent badge and link.
- Anonymous viewers never see a reserver name.
- The implementation matches each `acceptance` criterion in the Visual References above.

---

## Slice S3: item visibility

### Task Group 13: S3 Visibility schema and listing preference (migration 0076)
**Dependencies:** 12 (S2 complete)
**Files to Modify:** `src/backend/alembic/versions/0076_item_listing_visibility.py` (new), `src/backend/app/groups/models.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/application/inventory_items.py`, `src/backend/tests/test_item_visibility_migration.py` (new), `src/backend/tests/test_item_visibility.py` (new), `src/backend/tests/test_event_reservations_migration.py`
**Estimated Steps:** 5

**Secrets:** this group touches database infrastructure (testcontainers, Alembic). Never print secret values: no `env`/`printenv`/`.env` dumps, presence checks only.

- [x] 13.0 Complete the visibility data layer
  - [x] 13.1 Write 2–8 focused tests
    - `tests/test_item_visibility_migration.py`:
      - `test_downgradeThenUpgrade_0076_roundTrips`;
      - `test_downgrade0076_privateRows_refusesNamingRecovery`.
    - `tests/test_item_visibility.py`:
      - `test_putPreference_visibilityWithoutMode_returns422` ("Ustaw tryb, żeby wybrać widoczność.");
      - `test_putPreference_modeAndPrivate_keepsRowReturnsVisibility`;
      - `test_putPreference_modeOnly_keepsExistingVisibility`;
      - `test_putPreference_newRow_defaultsPublic`;
      - `test_listMyInventoryItems_exposesListingVisibility`.
    - Ensure the `test_event_reservations_migration.py` fixture leaves no PRIVATE rows, so the chained downgrade passes.
  - [x] 13.2 Model
    - `ItemVisibility` StrEnum (PUBLIC/PRIVATE) in `groups/models.py`, based on `GroupVisibility`.
    - `ItemListingPreference.visibility` via `_enum_column`: VARCHAR(10), NOT NULL, `server_default 'PUBLIC'`.
  - [x] 13.3 Write `0076_item_listing_visibility.py` (revises `0075`)
    - Add the column, following 0036 as the template.
    - The guarded downgrade refuses while `visibility = 'PRIVATE'` rows exist, naming the recovery (owners clear those listings, or restore a pre-0076 dump), then drops the column.
  - [x] 13.4 Schemas and use case
    - `SetItemListingPreferenceRequest.visibility: ItemVisibility | None = None`, with a `model_validator` rejecting `visibility` together with `mode=None` (422).
    - `set_item_listing_preference` keeps the existing value when it is omitted, and new rows get PUBLIC.
    - `ItemListingPreferenceResponse.visibility`, and `MyInventoryItemResponse.listing_visibility` through the bridge.
    - Update the exact key sets.
  - [x] 13.5 Ensure the visibility-schema tests pass
    - Run only the 3 test files in this group.

**Acceptance Criteria:**
- The tests from 13.1 pass, and 0076 round-trips and refuses while PRIVATE rows exist.
- A visibility-only PUT can never delete a listing.

---

### Task Group 14: S3 Visibility enforcement gates
**Dependencies:** 13
**Files to Modify:** `src/backend/app/groups/application/item_visibility.py` (new), `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/application/reservation_context.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/application/public_view.py`, `src/backend/app/groups/application/exchange_summary.py`, `src/backend/app/groups/application/term_end_scan.py`, `src/backend/app/groups/application/organizer_page.py`, `src/backend/app/groups/application/owner_items.py`, `src/backend/app/events/page.py`, `src/backend/app/events/infrastructure/groups_acl.py`, `src/backend/app/circulation/router.py`, `src/backend/app/circulation/service.py`, `src/backend/app/messaging/application/conversations.py`, `src/backend/app/messaging/infrastructure/groups_acl.py`, `src/backend/tests/test_item_visibility.py`, `src/backend/tests/test_item_reservations_router.py`, `src/backend/tests/test_circulation.py`, `src/backend/tests/test_item_actions.py`
**Estimated Steps:** 9

- [x] 14.0 Complete the visibility enforcement
  - [x] 14.1 Write 2–8 focused tests
    - `tests/test_item_visibility.py`:
      - `test_privateItem_readPaths_strangerGets404_ownerMemberCounterpartyGet200`, parametrised over `/details`, `/history`, `/balance`, `GET /api/inventory-items/{id}` and `/actions`;
      - `test_privateItem_rsvpOnlyNonMember_gets404`;
      - `test_privateItem_lists_hiddenOnEventsPublicTermsOrganizerOwnerPage_shownOnPrivateTermForMember`;
      - `test_privateItem_take_eventOrPublicTerm409_privateTermOk_personalNeedsSharedCircle403`;
      - `test_privateItem_newItemConversation_404_existingConversationStillAccessible`;
      - `test_getItemActions_privateItem_contextsOnlyPrivateCircleTerms`.
    - `tests/test_circulation.py`: `test_listInventoryItems_inventoryId_unknown404_otherUser403_ownerIncludesPrivate`.
    - `tests/test_item_reservations_router.py`: `test_postTake_privateNonMemberPersonal_returns404Not403Or409` (pins the gate order).
  - [x] 14.2 Safe-by-default filter
    - `item_listing_preferences_select(party_ids, *, include_private=False)` and `list_item_listing_preferences_for_parties(..., include_private=False)` filter to PUBLIC by default.
  - [x] 14.3 `app/groups/application/item_visibility.py`
    - `can_view_item(db, item_id, viewer_party_id | None) -> bool`. PUBLIC or no preference means the existing rules apply. PRIVATE means the viewer is the owner, a party sharing a non-deleted PRIVATE circle with the owner (standing membership or active organizer), or a current counterparty.
    - `require_item_visible` raises 404. All lookups are batched.
  - [x] 14.4 Circulation gates
    - The circulation router calls the injected groups helper on `/details`, `/history`, `/balance` and `GET /api/inventory-items/{id}` (the `on_registered` injection pattern). Owners always pass.
    - `circulation.service`: `?inventory_id=` returns 404 for an unknown inventory and 403 for another user's.
  - [x] 14.5 Write gates
    - `take_item`/`propose_item_swap` call `require_item_visible` first, before any context is built.
    - `TermContext` carries its circle's visibility, and `allows_visibility()` → 409 "Tej rzeczy nie można zarezerwować w tym miejscu" for an event or a PUBLIC-circle term.
    - `load_personal_context` sets `item_visibility`, and `PersonalContext.require_eligibility` requires a shared PRIVATE circle for a PRIVATE item.
  - [x] 14.6 `/actions`
    - `require_item_visible` runs first. `visibility` is set for OWN.
    - For a PRIVATE item, events and PUBLIC-circle terms are omitted inside the SQL filter, so the limit is still applied after filtering.
    - `personal_pickup_available` adds the S3 rule.
  - [x] 14.7 Messaging
    - `open_item_conversation` checks `can_view_item` through `messaging/infrastructure/groups_acl.py`, only when creating a new conversation.
  - [x] 14.8 Opt-in callers
    - The complete `include_private=True` list:
      - **(a)** `get_group_access` passes `include_private = visibility == PRIVATE and (is_member or is_organizer)` through `get_public_circle_view`/`list_public_term_item_listings`;
      - **(b)** `list_browsable_term_item_listings` for a PRIVATE circle;
      - **(c)** the owner's `list_my_inventory_items`/`list_my_term_item_listings`;
      - **(d)** `exchange_summary` for a PRIVATE group;
      - **(e)** `term_end_scan`.
    - All other callers keep the default.
  - [x] 14.9 Ensure the visibility tests pass
    - Run only the test files in this group.

**Acceptance Criteria:**
- The tests from 14.1 pass.
- PRIVATE items return 404 on every item read path for everyone except the owner, shared-private-circle members and current counterparties, before any 403 or 409.
- PRIVATE items are rejected in event and public-circle contexts.
- `grep include_private=True` matches exactly the callers (a)–(e).

---

### Task Group 15: S3 Frontend visibility toggle and private badge
**Dependencies:** 14
**Files to Modify:** `src/frontend/src/api/itemListingPreferences.ts`, `src/frontend/src/api/inventories.ts`, `src/frontend/src/api/itemActions.ts`, `src/frontend/src/app/AppDataContext.tsx`, `src/frontend/src/pages/items/VisibilityToggle.tsx` (new), `src/frontend/src/pages/items/MyItemsView.tsx`, `src/frontend/src/pages/product/ItemContextActions.tsx`, `src/frontend/src/pages/product/ItemDetailPage.tsx`, `src/frontend/src/test/MyItemsView.test.tsx`, `src/frontend/src/test/VisibilityToggle.test.tsx` (new), `src/frontend/src/test/ItemDetailPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/moje-rzeczy-lokalizacja-i-widoczno.html
  element: component:visibility-toggle
  locator: the ".toggle" segmented controls, lines 255 and 258
  acceptance: a segmented "🌍 Publiczna / 🔒 Prywatna" control of two `type="button"` buttons with `aria-pressed`, the current one marked pressed; it is shown only when a mode is set
- mockup: analysis/design-context/mockups/moje-rzeczy-lokalizacja-i-widoczno.html
  element: screen:my-items-location-visibility
  locator: the per-item rows, lines 254–262
  acceptance: a private item shows "Prywatna: widoczna tylko w Twoich prywatnych grupach." under it; an item without a mode shows "Ustaw tryb, żeby wybrać widoczność." and no toggle
- mockup: analysis/design-context/mockups/strona-produktu-m-j-przedmiot.html
  element: screen:product-own
  locator: badges at line 250, note at 262
  acceptance: a "🔒 Prywatny" text badge in the header for a PRIVATE item; after "To Twoja rzecz…" the line "Prywatna — widzą ją tylko osoby z Twoich prywatnych grup."
**Estimated Steps:** 6

- [x] 15.0 Complete the visibility UI
  - [x] 15.1 Write 2–8 focused tests
    - `VisibilityToggle.test.tsx`: `aria-pressed` reflects the value, and a click calls back with the new value.
    - `MyItemsView.test.tsx`:
      - the toggle sends `{mode, visibility}` with the item's current mode;
      - the mode selector sends only `mode`;
      - with no mode, the hint shows and the toggle is absent;
      - a private item shows its hint.
    - `ItemDetailPage.test.tsx`: an own PRIVATE item shows the badge and the line.
  - [x] 15.2 Types and API
    - `itemListingPreferences.ts` request/response `visibility`, `MyInventoryItemResponse.listing_visibility`, and `ItemActionsResponse.visibility`.
  - [x] 15.3 `AppDataContext.setItemListingPreference(itemId, mode, visibility?)`
    - The toggle path always sends the current `mode` together with `visibility`. The existing mode-selector calls are unchanged.
  - [x] 15.4 `VisibilityToggle.tsx`
    - Wired into the `MyItemsView` rows that have a mode set, with the hint copy.
  - [x] 15.5 Product page own view
    - The "🔒 Prywatny" badge and the visibility line, read from `view.visibility`.
  - [x] 15.6 Ensure the visibility UI tests pass
    - Run only the 3 test files in this group, then run `tsc -p tsconfig.app.json`.

**Acceptance Criteria:**
- The tests from 15.1 pass, and `tsc` is clean.
- A visibility change never sends a body without a mode.
- The implementation matches each `acceptance` criterion in the Visual References above.

---

## Documentation and cross-slice test review

### Task Group 16: Architecture and documentation index
**Dependencies:** 14
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`, `src/backend/app/circulation/domain/item_privacy.py` (module docstring check only)
**Estimated Steps:** 6

- [x] 16.0 Complete the documentation updates
  - [x] 16.1 Prepare the cross-check list (no automated tests: this group is documentation only)
    - List every claim to document, each mapped to the code symbol it names (from the spec's "Docs to update").
  - [x] 16.2 Contexts and endpoints in `architecture.md`
    - `PersonalContext` (create-time vs reservation-derived) and the open-vs-terminal no-context rule.
    - The unified `POST /api/items/{id}/take|propose` and the removed routes.
    - `/actions` v2, including `contexts`, `location`, `personal_pickup_available` and `party_reservation`.
    - `inventories.location_id` and `GET|PUT /api/inventories/mine/location`.
  - [x] 16.3 Lists, privacy and visibility in `architecture.md`
    - Reserved items on lists, `ReservedByResponse` and the pending-proposal block.
    - The reserver-name rule change.
    - The cache-header rule for personalised public routes.
    - Item visibility and its 9 gates, and the reservation-read party check.
  - [x] 16.4 Runbooks in `architecture.md`
    - **0074:** the recovery split between reject and cancel, and that terminal personal rows read as deleted-event after a downgrade.
    - **0075:** a downgrade loses the locations.
    - **0076:** the PRIVATE guard and its recovery.
  - [x] 16.5 `INDEX.md`
    - Update the summary lines for `architecture.md` (and for `migrations.md` if its guarded-downgrade example list grows).
    - Record the two suggested standards from the spec in the work-log as suggestions for the user. Do not apply them without approval (`/maister:standards-update`).
  - [x] 16.6 Verify the documentation
    - Walk the 16.1 list against the final code names (`grep`), and confirm every documented symbol and route exists.

**Acceptance Criteria:**
- Every item in the spec's "Docs to update" is covered, and all names match the code.
- `INDEX.md` reflects the new architecture summary.

---

### Task Group 17: Test Review, Gap Analysis and full-suite regression
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
**Files to Modify:** `src/backend/tests/test_personal_pickup.py`, `src/backend/tests/test_reserved_listings.py`, `src/backend/tests/test_item_visibility.py`, `src/backend/tests/test_party_reservation_actions.py`, `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/MyItemsView.test.tsx` (append-only gap tests)
**Estimated Steps:** 6

**Secrets:** the full suites start Docker/testcontainers. Never print secret values: no `env`/`printenv`/`docker inspect` Env/`.env` dumps, presence checks only. Keep secrets out of results files.

- [x] 17.0 Review the tests and fill the critical gaps
  - [x] 17.1 Review the tests from Groups 1–15
    - Map each spec Success Criterion to at least one test.
  - [x] 17.2 Analyse the gaps for this feature only
    - Look in particular at the cross-slice interactions: a PRIVATE item with a pending proposal, a reserved PRIVATE item on a private term page, a personal reservation on a later-PRIVATE item, and the reserver label on PRIVATE lists.
  - [x] 17.3 Write at most 10 additional strategic tests
  - [x] 17.4 Run the feature tests
    - Run all the new and changed backend and frontend feature test files and expect them all to pass.
  - [x] 17.5 Run the full backend checks
    - From `src/backend`: `uv run python -m pytest`, `uv run python -m ruff check .`, `uv run python -m ruff format --check .`, and `uv run python -m mypy app` (no new errors over the HEAD baseline of about 32).
  - [x] 17.6 Run the full frontend checks
    - From `src/frontend`: the full Vitest suite, compared with the about 13 pre-existing HEAD failures (OrganizerEditor is flaky), with no new failures, and `tsc -p tsconfig.app.json` clean.

**Acceptance Criteria:**
- All feature tests pass, and at most 10 additional tests were added.
- The full backend suite passes, `ruff` is clean, and mypy adds no new errors over the baseline.
- The full frontend suite has no failures beyond the pre-existing set, and `tsc` is clean.

## Execution Order

1. Group 1: S1 Database migrations 0074/0075 (6 steps)
2. Group 2: S1 Inventory location API (7 steps, depends on 1)
3. Group 3: S1 PersonalContext and unified endpoint (8 steps, depends on 1, 2)
4. Group 4: S1 Legacy route removal and test migration (6 steps, depends on 3)
5. Group 5: S1 `/actions` v2 (8 steps, depends on 2, 3)
6. Group 6: S1 Frontend API and hooks (7 steps, depends on 4, 5)
7. Group 7: S1 Product page UI (9 steps, depends on 6)
8. Group 8: S1 Moje rzeczy location and personal confirm/cancel (5 steps, depends on 6)
9. Group 9: S1 Tiles and term-page take removal (8 steps, depends on 7, 8)
10. Group 10: S2 Listed select, pending guard, reservation privacy (7 steps, depends on 1–9)
11. Group 11: S2 Reserved read models, counts, cache headers (9 steps, depends on 10)
12. Group 12: S2 Frontend reserved UI (7 steps, depends on 11)
13. Group 13: S3 Visibility schema 0076 (5 steps, depends on 12)
14. Group 14: S3 Visibility enforcement (9 steps, depends on 13)
15. Group 15: S3 Frontend visibility UI (6 steps, depends on 14)
16. Group 16: Docs (6 steps, depends on 14)
17. Group 17: Test review and full suites (6 steps, depends on 1–16)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: always applicable (minimal implementation means deleting removed routes, schemas, label maps, `renderActions`, URL-context helpers and `eventItems.ts`; error handling; validation; commenting).
- `backend/`:
  - `models.md`: plain FK ids, `_enum_column`, ACL-only cross-context access, 404-before-403;
  - `migrations.md`: small revisions, explicit names, guarded downgrades, round-trip tests, `lock_timeout`;
  - `queries.md`/`jooq.md`: batched lookups, SQL-level `LIMIT` after the viewer filter, bound parameters;
  - `security.md`: matrix rows and tests for every added or removed route, `OptionalPrincipal`, no shared caching of personalised data;
  - `time.md`: `clock.local_now()`, `format_term_when`, `fit_notification_message`;
  - `api.md`.
- `frontend/`:
  - `components.md`: one pure `resolveItemActionsView`, and the page `switch`es on `view.kind`;
  - `accessibility.md`: `ModalSheet`, `useRegisterOpenSheet`, a radio fieldset, `aria-disabled` + `aria-describedby` with handler guards, text pills, stretched links, `aria-pressed`;
  - `data-fetching.md`: hooks over the API modules, prefix keys with a viewer discriminator, awaited invalidation, `extractProblemMessage` verbatim, `dayjs` from `src/utils/dayjs.ts`;
  - `css.md`, `responsive.md`.
- `testing/`:
  - `backend-testing.md`: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>`, `leaf_category_ids` per test, `count_queries`, exact key sets;
  - `frontend-testing.md`: explicit Vitest imports, `createQueryWrapper()`, typed fixtures with no casts, a pinned `Date`.

## Notes

- **Test-driven:** each group starts with 2–8 tests (Group 16 is documentation only).
- **Run incrementally:** run only the group's new and changed tests after each group. The full suites run only in Group 17.
- **Mark progress:** check off the steps as they are completed.
- **Reuse first:** prefer the components listed in the spec's "Reusable Components".
- **Commands:**
  - backend: `uv run python -m pytest|mypy|ruff` from `src/backend` (the uv trampoline breaks `uv run <tool>`);
  - frontend: Vitest and `tsc -p tsconfig.app.json` from `src/frontend`.
- **Secrets:** never print secret values to tool output, reports or commits (see the rule under Overview).
