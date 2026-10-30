# Implementation Plan: Public event page (Term-style)

## TL;DR
The plan has 10 task groups and 75 steps: 5 backend groups, 4 frontend groups and a final test review.
Backend order: migration 0071 → slugs/ACLs/`/attending` → sign-up/withdraw → detail read model + OG → messaging EVENT kind. The migration has no dependencies, and messaging waits for both it and attendance.
Frontend order: data layer → presentational components → page composition/routing → app-wide links, Spotkania and Messages. The frontend codes against the exact key sets in `spec.md`, so it does not wait for the backend.
The 7 design screens and 4 components are covered by Groups 7 and 8 (see `visual-coverage.md`). Expected tests: 52 across the implementation groups, plus at most 10 from the review.

## Key Decisions
- **`/attending` and the batched org lookup ship together in Group 2.** M5's `count_queries` guard (1 vs 3 authors) only makes sense where `resolve_author_slugs` is introduced. The attending test seeds attendances via SQL because the sign-up endpoint doesn't exist yet (allowed by backend-testing.md). It lives in `test_events.py`, not `test_event_attendance.py`.
- **The OG preview and the "event" reserved slug are folded into the detail group (Group 4).** Both are the public read surface of one URL. This keeps the backend at 5 groups and Group 4 at 8 tests.
- **ACL modules grow with their first consumer.** `users_acl`/`organizations_acl`/`groups_acl.derive_party_slug` arrive in Group 2. `create_guest_profile` arrives in Group 3. `list_display_names`, the listing-preference select and the circulation/product ACLs arrive in Group 4. Nothing is stubbed ahead of use (minimal-implementation.md).
- **`resolveEventView` moves with the page (Group 8), not the data layer.** Changing its union breaks `EventPage.tsx`'s `switch`, so both change in one group. Group 6 only adds fields and types, which don't break existing callers. It patches existing fixtures (`author_slug` + new detail keys) so `tsc` stays green in the meantime.
- **`EventEditView` and `EventCreateView` call sites go in Group 9 with the AppPage tests.** The M1 create-flow rewrite and the edit back link both live in `AppPage.test.tsx`, so one group owns that file's behavioural changes.
- **Messaging runs a small regression guard.** Group 5 also re-runs the three existing messaging test files, because a missing EVENT branch in any kind switch would break the inbox for every user (spec risk). It still does not run the whole suite.
- **Tests per group are capped at 2–8.** The feature total (about 52–62) is above the generic 16–34 range because there are 9 implementation groups spanning two stacks plus migration and messaging. The per-group caps still hold.

## Open Questions / Risks
- **Hot shared files serialize most backend work.** `app/events/service.py` is touched by Groups 2, 3, 4 and 5; `app/events/router.py` and `schemas.py` by 2, 3 and 4; `app/core/authorization_matrix.py` and `tests/test_authorization_matrix.py` by 2, 3 and 5. Only Group 1 can run alongside the start of the backend chain.
- **Frontend/backend contract drift.** The frontend groups code against the spec's key sets before the backend exists. Typed fixtures with no `as` casts (frontend-testing.md) are the only guard until end-to-end verification.
- **Fixture churn in `AppPage.test.tsx`.** Group 6 touches it (fixture keys only) and so does Group 9 (behaviour). Both declare it, so the executor serializes them.
- **Old `/events/<id>` links break with no redirect.** This is accepted by the user and stays out of scope.
- **Term must stay byte-identical.** `AccountMergeForm` gets new optional props whose defaults are the current copy. Group 8 must re-run the Term merge tests that touch it.

## Overview
Total Steps: 75
Task Groups: 10 (9 implementation + Test Review & Gap Analysis)
Expected Tests: 52 in the implementation groups (each within 2–8), plus up to 10 gap tests, for roughly 52–62 in total

Commands:
- Backend: from `src/backend`, run `uv run python -m pytest tests/<file>.py`, `uv run python -m ruff check <paths>` and `uv run python -m mypy <paths>`. The mypy baseline is about 32 errors at HEAD, and no new errors may be added.
- Frontend: from `src/frontend`, run `npx vitest run src/test/<file>` and `npx tsc -p tsconfig.app.json --noEmit`.

Paths below are relative to the repo root. Backend files are under `src/backend/`, frontend files under `src/frontend/src/`.

## Implementation Steps

### Task Group 1: Database Migration & Messaging Models
**Dependencies:** None
**Files to Modify:** src/backend/alembic/versions/0071_event_conversations.py, src/backend/app/messaging/models.py, src/backend/tests/test_event_conversations_migration.py, src/backend/tests/test_messaging_migration.py
**Estimated Steps:** 6

- [ ] 1.0 Complete database migration layer
  - [ ] 1.1 Write 2 focused tests in `tests/test_event_conversations_migration.py` and update 1 test
    - `test_downgradeTo0070ThenUpgradeHead_succeeds`: the event column, both indexes and the FK exist after re-upgrade (pattern: `tests/test_locations_migration.py`, `tests/test_group_soft_delete_migration.py`).
    - `test_insertDuplicateEventConversation_violatesUniqueIndex`: a second `kind='EVENT'` row with the same `event_id` raises `IntegrityError` on `uq_conversations_event_id`.
    - Update `tests/test_messaging_migration.py`: add `"fk_conversations_event_id_events": ("event_id", "events")` to `CONVERSATION_FKS` (6 FKs, M2).
  - [ ] 1.2 Write the `0071_event_conversations.py` upgrade (revises `0070`)
    - Add nullable `conversations.event_id` UUID.
    - Add FK `fk_conversations_event_id_events` → `events.id` with `ON DELETE CASCADE`.
    - Add partial unique `uq_conversations_event_id` on `(event_id)` `postgresql_where=kind = 'EVENT'`.
    - Add plain `ix_conversations_event_id` for the cascade lookup (L4; mirrors `ix_conversations_group_id`).
    - Drop and recreate `fk_messages_conversation_id_conversations` and `fk_conversation_reads_conversation_id_conversations` with `ondelete="CASCADE"` (names from 0061).
  - [ ] 1.3 Write the downgrade in reverse dependency order
    - `DELETE FROM conversations WHERE kind = 'EVENT'` while the cascades are still active.
    - Recreate both FKs with no `ON DELETE`.
    - Drop `ix_conversations_event_id`, then `uq_conversations_event_id`, then the FK, then the column.
  - [ ] 1.4 Align ORM models in `app/messaging/models.py`
    - `ConversationKind.EVENT` (`kind` stays `String(10)`).
    - `Conversation.event_id` (`ForeignKey("events.id", ondelete="CASCADE")`, nullable) plus both `Index` entries in `__table_args__`.
    - `ondelete="CASCADE"` on `Message.conversation_id` and `ConversationRead.conversation_id`; no `relationship()`.
    - Update the docstring to list EVENT.
  - [ ] 1.5 Check the autogenerate diff is empty
    - Run `uv run python -m alembic check`, or review an autogenerate run without writing it, so the ORM and 0071 match.
  - [ ] 1.6 Ensure migration tests pass
    - Run only `tests/test_event_conversations_migration.py` and `tests/test_messaging_migration.py`.
    - Run ruff and mypy on the touched files.

**Acceptance Criteria:**
- The 3 tests pass. Upgrade → downgrade → upgrade is clean.
- `CONVERSATION_FKS` lists 6 FKs, and the messages/reads FKs cascade.
- The ORM metadata matches the migration (no autogenerate drift).

### Task Group 2: Event Slugs, Cross-Context ACLs & Attending List
**Dependencies:** None
**Files to Modify:** src/backend/app/organizations/service.py, src/backend/app/groups/domain/organizer_slug.py, src/backend/app/events/infrastructure/users_acl.py, src/backend/app/events/infrastructure/organizations_acl.py, src/backend/app/events/infrastructure/groups_acl.py, src/backend/app/events/service.py, src/backend/app/events/schemas.py, src/backend/app/events/router.py, src/backend/app/events/models.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_events.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 8

- [ ] 2.0 Complete event slug and attending-list layer
  - [ ] 2.1 Write 5 focused tests
    - In `tests/test_events.py` (update `EVENT_KEYS` with `author_slug`):
      - `test_createEvent_authorOwnsOrganization_authorSlugIsOrgSlug`
      - `test_createEvent_authorWithoutOrganization_authorSlugMatchesTermOrganizerSlug`: `k-…`, equal to `derive_organizer_slug` for the same party.
      - `test_listAttending_onlyActiveAttendances_orderedByStartsAt`: seeds `event_attendances` rows via SQL plus `await db_session.commit()`, including one withdrawn row that must be excluded.
      - `test_listAttending_eventsByOneVsThreeAuthors_queryCountConstant`: `count_queries(engine)`, M5.
    - In `tests/test_authorization_matrix.py`: `GET /api/events/attending` → READ (and `/mine` still READ).
  - [ ] 2.2 Add `get_own_organizations_by_party_ids(db, party_ids) -> dict[UUID, Organization]` to `app/organizations/service.py`
    - One statement joining `OrganizationMembership`/`OrganizationRole`/`Organization` with `role_type == OWNER`, `valid_to IS NULL` and `party_id IN (…)`.
    - Return `{}` for empty input without querying. `get_own_organization` is unchanged.
  - [ ] 2.3 Add `derive_party_slug(party_id, organization_slug)` to `app/groups/domain/organizer_slug.py`
    - It returns the org slug, else `_fallback_organizer_slug(f"party:{party_id}")`.
    - `derive_organizer_slug` delegates to it for the party case, with byte-identical output (existing term slug tests must stay green).
  - [ ] 2.4 Create the events ACL modules under `app/events/infrastructure/`
    - None of them imports `..schemas`, and each starts with a module docstring stating the ACL rule (L1).
    - `users_acl.py`, the guest identity facade: `find_caller_profile(db, principal|None)` (returns `None` for a missing token or profile), `get_caller_profile`, and the re-exported `AVATAR_UPLOAD_DISABLED_MESSAGE`.
    - `organizations_acl.py`: `get_own_organization(party_id)` and `get_own_organizations_by_party_ids(party_ids)`.
    - `groups_acl.py`: `derive_party_slug`.
  - [ ] 2.5 Route existing direct imports through the ACLs in `app/events/service.py`
    - Replace the direct `app.users.service` imports (`get_profile_by_principal`, `AVATAR_UPLOAD_DISABLED_MESSAGE`) and the `is_author` lookup with `users_acl`.
    - Shared platform imports (`app.core`, `app.moderation`, `app.outbox`, `app.storage`) stay direct.
  - [ ] 2.6 Add `author_slug: str` to `EventResponse` and add `resolve_author_slugs(db, author_party_ids) -> dict`
    - `resolve_author_slugs` makes one `organizations_acl.get_own_organizations_by_party_ids` call and feeds the results to `groups_acl.derive_party_slug`.
    - Wire it into the create, patch and mine responses.
  - [ ] 2.7 Add `list_attending_events` and the `/attending` route
    - `service.list_attending_events(db, principal)`: `Event` JOIN active `EventAttendance` (`withdrawn_at IS NULL`) for the caller's party, ordered by `starts_at` then `id`.
    - `GET /api/events/attending` (`ReadPrincipal`) is declared before `/{event_id}` and returns `list[EventResponse]` with locations batched via `locations_acl` and slugs via `resolve_author_slugs`.
    - Matrix: replace the `/mine` row with `GET ^/api/events/(mine|attending)$` → READ, mcp:read, above any PUBLIC detail row.
    - Update the `EventAttendance` docstring in `models.py` to name its writers and readers (L5).
  - [ ] 2.8 Ensure Group 2 tests pass
    - Run only `tests/test_events.py` and `tests/test_authorization_matrix.py` (plus the existing organizer-slug tests in groups, if present, to prove `derive_organizer_slug` is unchanged).
    - Run ruff and mypy on the touched modules.

**Acceptance Criteria:**
- The 5 tests pass, and every `EventResponse` (create/patch/mine/attending) has exactly the base keys plus `author_slug`.
- `/attending` query count is identical for 1 vs 3 authors.
- `app/events` imports business contexts only via `infrastructure/*_acl.py`.

### Task Group 3: Attendance Sign-up & Withdraw API
**Dependencies:** 2
**Files to Modify:** src/backend/app/events/service.py, src/backend/app/events/schemas.py, src/backend/app/events/router.py, src/backend/app/events/infrastructure/users_acl.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_event_attendance.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 9

- [ ] 3.0 Complete attendance command layer
  - [ ] 3.1 Write 7 focused tests
    - In `tests/test_event_attendance.py`, using `freeze_local_now` and exact key sets for `EventAttendanceResponse`:
      - `test_signUp_loggedInTwice_returns201SameAttendance`
      - `test_signUp_guestName_createsUnattachedProfile_blankNameReturns400`
      - `test_signUp_afterEventEnded_returns409`
      - `test_signUp_asAuthor_returns409`
      - `test_withdraw_twice_returns204_thenSignUpAgainSucceeds`
      - `test_withdraw_withoutToken_returns401`
    - In `tests/test_authorization_matrix.py`: `POST …/attendances` → PUBLIC, `POST …/attendances/withdraw` → EDIT (one parametrized case).
  - [ ] 3.2 Add schemas
    - `EventAttendanceRequest` (`model_config = ConfigDict(extra="forbid")`, `guest_name: str | None = None`).
    - `EventAttendanceResponse` (`id`, `event_id`, `user_profile_id`, `attached_to_account`).
  - [ ] 3.3 Add the shared `has_ended(event)` and Polish error constants
    - `has_ended(event)`: `clock.local_now() >= (ends_at or starts_at)`.
    - Constants: `EVENT_ENDED_MESSAGE` ("Wydarzenie się zakończyło."), `AUTHOR_SIGN_UP_MESSAGE` ("Organizator nie zapisuje się na własne wydarzenie."), and the guest-name messages ("Podaj swoje imię.", "Imię może mieć najwyżej 255 znaków.").
  - [ ] 3.4 Add `users_acl.create_guest_profile(db, name)`
    - Same shape as `create_rsvp`: new party → `UserProfile(account_user_id=None)` → `create_solo_family_for_party`, with the deferred families import.
  - [ ] 3.5 Implement `service.sign_up(db, principal|None, event_id, guest_name)`
    - Load the event `with_for_update(read=True)` (404, L3), then 409 if it has ended.
    - Classify the caller via `users_acl.find_caller_profile`:
      - Account-backed caller: 409 for the author; return the existing active row; otherwise insert inside `begin_nested` and re-select on `IntegrityError`.
      - Anonymous caller (also an invalid or expired token, L9): trim, blank → 400, over 255 → 400, `check_text(TextField.PROFILE_NAME, name)`, `create_guest_profile`, insert.
    - Commit.
  - [ ] 3.6 Implement `service.withdraw(db, principal, event_id)`
    - 404 for an unknown event, then `get_caller_profile` (401), then `withdrawn_at = datetime.utcnow()` on the active row if one exists. Commit. Idempotent (template: `groups/application/attendance.withdraw_attendance`).
  - [ ] 3.7 Add routes in `app/events/router.py`
    - `POST /api/events/{id}/attendances` (`OptionalPrincipal`, 201 also when idempotent).
    - `POST /api/events/{id}/attendances/withdraw` (`EditPrincipal`, 204).
  - [ ] 3.8 Add matrix rows in the spec order
    - `POST ^/api/events/[^/]+/attendances$` → PUBLIC, anchored so withdraw never matches, placed before the EDIT rows.
    - `POST ^/api/events/[^/]+/attendances/withdraw$` → EDIT, mcp:edit.
    - Keep the existing PATCH/DELETE/create/banner rows unchanged.
  - [ ] 3.9 Ensure attendance tests pass
    - Run only `tests/test_event_attendance.py` and `tests/test_authorization_matrix.py`.
    - Run ruff and mypy on the touched modules.

**Acceptance Criteria:**
- The 7 tests pass.
- Sign-up is idempotent under double submit, rejects the author and ended events with 409, and moderates guest names.
- Withdraw is idempotent, logged-in only, and 404-before-401 for unknown events.

### Task Group 4: Public Event Detail Read Model & OG Preview
**Dependencies:** 3
**Files to Modify:** src/backend/app/events/page.py, src/backend/app/events/schemas.py, src/backend/app/events/router.py, src/backend/app/events/service.py, src/backend/app/events/infrastructure/users_acl.py, src/backend/app/events/infrastructure/groups_acl.py, src/backend/app/events/infrastructure/circulation_acl.py, src/backend/app/events/infrastructure/product_acl.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/service.py, src/backend/app/system/router.py, src/backend/app/system/public_preview.py, src/backend/app/organizations/slugs.py, src/backend/tests/test_event_page.py, src/backend/tests/test_public_preview.py
**Estimated Steps:** 9

- [ ] 4.0 Complete public detail and preview layer
  - [ ] 4.1 Write 8 focused tests
    - In `tests/test_event_page.py` (update `DETAIL_KEYS` to the exact spec set, plus exact participant and item key sets):
      - `test_getEvent_withAttendees_authorFirstThenSignUpOrder_isMeAndIsAuthorFlags`
      - `test_getEvent_participantItems_onlyAvailableListedItems`
      - `test_getEvent_anonymousOrInvalidToken_returns200NotAuthorView`
      - `test_getEvent_afterEnd_hasEndedTrue`
      - `test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant`
    - In `tests/test_public_preview.py`:
      - `test_eventPreview_rendersTitleAndOgImage`
      - `test_eventPreview_invalidUuid_returnsPlainIndex`
      - `test_eventPreview_reservedFirstSegment_notServedByPreview` (`/api/event/<uuid>` keeps its JSON 404, L10)
  - [ ] 4.2 Add the unexecuted listing-preference select in `app/groups/infrastructure/repository.py`
    - `item_listing_preferences_select(party_ids)` returning `(item_id, owner_party_id, mode)`; re-export it from `app.groups.service`.
  - [ ] 4.3 Extend the ACLs
    - `groups_acl.item_listing_preferences_select`.
    - `circulation_acl.available_items_select()` wrapping `available_items_with_product_select`.
    - `product_acl.first_approved_photo_by_product`.
    - `users_acl.list_display_names(party_ids) -> {party_id: (name, has_account)}` via `list_chat_profiles_by_party_ids` (one IN query).
  - [ ] 4.4 Add detail schemas in `app/events/schemas.py`
    - `EventOrganizationResponse` (`name`, `primary_color`, `accent_color`, `palette_preset`).
    - `EventParticipantItemResponse` (`item_id`, `product_name`, `mode`, `thumb_url`).
    - `EventParticipantResponse` (`party_id`, `display_name`, `is_author`, `is_me`, `items`).
    - `EventDetailResponse(EventResponse)` adds exactly `banner_url`, `attendee_count`, `is_author`, `author_display_name`, `organization`, `participants`, `is_attending`, `has_ended`. Keep `location` as `LocationRefResponse`.
  - [ ] 4.5 Implement `app/events/page.get_event_page(db, event_id, principal|None, storage)`
    - Load in this order:
      1. Event (404)
      2. Banner
      3. Location
      4. Viewer profile
      5. One author-organization lookup, reused for `organization`, `author_display_name` (org name, else profile name) and `author_slug`
      6. Active attendances, ordered by `created_at`, `id`
      7. Display names (one IN query)
      8. Items: one statement joining the listing-preference select with the available-items select, ordered by product name `COLLATE "C"`, then item id
      9. Thumbnails: one query, skipped when storage is `None`
    - Author first, unresolved attendee profiles skipped, and `attendee_count`/`is_attending`/`is_me` derived in memory.
  - [ ] 4.6 Switch `GET /api/events/{id}` (`OptionalPrincipal`) to `page.get_event_page`
    - Confirm the PUBLIC matrix row `GET ^/api/events/[^/]+$` sits below the `(mine|attending)` row. Never return 401 for a bad token.
  - [ ] 4.7 Add the OG preview
    - `service.get_event_preview(db, event_id, storage)` returns the event, place name and w1600 banner URL.
    - `public_preview.render_public_event_meta`: title = name; description = `clock.format_term_when(starts_at)` + ` · {place}` + ` {description}`; `og:image` = banner.
    - `app/system/router.py`: `GET /{organization_slug}/event/{event_id}` placed before `/{organization_slug}`. It delegates to `spa_fallback` for reserved or dotted first segments, and returns the plain index for an invalid UUID or unknown event.
  - [ ] 4.8 Add "event" to the second-segment group of `RESERVED_SLUGS` in `app/organizations/slugs.py`
  - [ ] 4.9 Ensure detail and preview tests pass
    - Run only `tests/test_event_page.py` and `tests/test_public_preview.py`.
    - Run ruff and mypy on the touched modules.

**Acceptance Criteria:**
- The 8 tests pass.
- The detail key set exactly matches the spec, and the query count does not grow with participants or items.
- Anonymous and invalid-token requests get the visitor payload.
- The OG preview shows title, date/place and banner, and reserved paths are untouched.

### Task Group 5: Messaging EVENT Conversation Kind
**Dependencies:** 1, 3
**Files to Modify:** src/backend/app/events/service.py, src/backend/app/messaging/infrastructure/events_acl.py, src/backend/app/messaging/application/access.py, src/backend/app/messaging/application/conversations.py, src/backend/app/messaging/application/inbox.py, src/backend/app/messaging/infrastructure/repository.py, src/backend/app/messaging/schemas.py, src/backend/app/messaging/router.py, src/backend/app/messaging/service.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_event_conversations.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 9

- [ ] 5.0 Complete EVENT chat layer
  - [ ] 5.1 Write 5 focused tests
    - In `tests/test_event_conversations.py`:
      - `test_openEventConversation_firstThenSecond_returns201Then200`
      - `test_openEventConversation_access_authorAndAttendeeOk_withdrawnGets403_anonymousGets401`
      - `test_inbox_mixedKinds_showsEventTitleAndUnreadCount`
      - `test_deleteEvent_afterWithdrawals_cascadesConversationMessagesAndReads`
    - In `tests/test_authorization_matrix.py`: `POST /api/conversations/event` → EDIT (L8).
  - [ ] 5.2 Add chat-support reads to `app/events/service.py`
    - `has_active_attendance(event_id, party_id)`
    - `list_active_attendee_party_ids(event_id)`
    - `list_chat_event_ids_for_party(party_id)`: authored ∪ actively attended, one statement
    - `list_chat_event_refs(event_ids) -> {id: (name, author_party_id)}`: one IN query, `{}` for empty input
    - `app/events` never imports messaging.
  - [ ] 5.3 Create `app/messaging/infrastructure/events_acl.py`
    - Re-exports `Event`, `get_event` and the four functions above. It is the only place messaging touches events.
  - [ ] 5.4 Update `application/access.py`
    - `Access.event: events_acl.Event | None = None`.
    - `event_access`: author or active attendee, else 403; `read_only_reason=None`; `organizer_party_id = author_party_id`.
    - `resolve_access` gets explicit TERM and EVENT branches, replacing the fall-through `assert term_id`.
  - [ ] 5.5 Update `infrastructure/repository.py`
    - Add `find_event_conversation`.
    - `_audience_filter`, `select_inbox_rows` and `sum_unread` take `event_ids` with a `kind = 'EVENT' AND event_id IN (…)` clause (skipped when empty).
  - [ ] 5.6 Update `application/conversations.py`
    - `open_event_conversation`: get event → 404, `event_access`, find or `_insert_or_reselect`.
    - `_to_response` EVENT branch before the group assert: title = event name; `group_name`/`term_occurs_on` null; `participant_count` = account-backed author + active attendees.
  - [ ] 5.7 Update `application/inbox.py`
    - `list_inbox`/`count_unread` fetch `event_ids` via `events_acl.list_chat_event_ids_for_party`.
    - `_Labels.event_refs`; `_to_row` EVENT branch (title = name, organizer = author, reason `None`).
    - Update the docstring statement count.
  - [ ] 5.8 Wire the endpoint
    - `schemas.OpenEventConversationRequest{event_id}`.
    - `router` `POST /event` via `_respond` (201 when created, 200 when it exists).
    - `service` re-exports `open_event_conversation`.
    - Matrix row 54 comment lists `/event`.
    - Update the messaging docstrings ("GROUP, TERM and EVENT").
  - [ ] 5.9 Ensure messaging tests pass
    - Run `tests/test_event_conversations.py` and `tests/test_authorization_matrix.py`.
    - As a regression guard for the kind switches, also run the existing `tests/test_conversation_messages.py`, `tests/test_messaging_repository.py` and `tests/test_messaging_cross_context.py`.
    - Run ruff and mypy on the touched modules.

**Acceptance Criteria:**
- The 5 new tests pass, and the existing messaging test files stay green.
- Every kind switch (`access`, `conversations`, `inbox`, `repository`) has an explicit EVENT branch.
- Deleting an event removes its conversation, messages and reads through the DB cascade.

### Task Group 6: Frontend Event Data Layer
**Dependencies:** None
**Files to Modify:** src/frontend/src/api/events.ts, src/frontend/src/api/conversations.ts, src/frontend/src/hooks/useOpenConversation.ts, src/frontend/src/hooks/useEvent.ts, src/frontend/src/hooks/useAttendingEvents.ts, src/frontend/src/utils/appHelpers.ts, src/frontend/src/test/useEvent.test.tsx, src/frontend/src/test/useOpenConversation.test.tsx, src/frontend/src/test/AppPage.test.tsx, src/frontend/src/test/eventDraft.test.ts, src/frontend/src/test/EventPage.test.tsx, src/frontend/src/test/eventViewState.test.ts
**Estimated Steps:** 7

- [ ] 6.0 Complete frontend data layer
  - [ ] 6.1 Write 5 focused tests
    - In `src/test/useEvent.test.tsx` (`createQueryWrapper`, `vi.mock("../api/events")`):
      - token change keeps the previous data with `isStale: true` until the refetch resolves
      - a failed refresh keeps the data and exposes `refreshError`
      - `signUp(guestName)` posts `guest_name` and awaits invalidation of `[EVENT_KEY]`, `[MY_EVENTS_KEY]` and `[ATTENDING_EVENTS_KEY]`
      - `withdraw()` also invalidates `CONVERSATIONS_KEY` (L7)
    - In `src/test/useOpenConversation.test.tsx`: EVENT posts to `/conversations/event`.
  - [ ] 6.2 Update `api/events.ts`
    - Add `author_slug` to `EventResponse` and the new `EventDetailResponse` keys mirroring the backend.
    - New types: `EventOrganization` (extends `OrganizerTheme` with `name`), `EventParticipant`, `EventParticipantItem` (`mode: ListingMode`), `EventAttendanceResponse`.
    - New functions: `signUpForEvent(eventId, { guest_name })`, `withdrawFromEvent`, `getAttendingEvents`, and `eventGuestProfileKey(eventId)` → `guest_profile_id:event:<id>`.
  - [ ] 6.3 Update `api/conversations.ts` and `hooks/useOpenConversation.ts`
    - `ConversationKind` adds "EVENT"; add `getOrCreateEventConversation(eventId)` and `GET_OR_CREATE.EVENT`.
    - Comments become "GROUP, TERM and EVENT".
  - [ ] 6.4 Rework `hooks/useEvent.ts` to the `useTermAccess` `forToken`/`isStale` pattern
    - Key `[EVENT_KEY, eventId]`; the `queryFn` returns `{ data, forToken }`; a `useRef`/`useEffect` refetches on token change.
    - Return `isStale` and `refreshError`, plus `signUp(guestName | null)`/`withdraw()` mutations that pass errors through `extractProblemMessage`.
  - [ ] 6.5 Add `hooks/useAttendingEvents.ts` and `eventPath`
    - `useAttendingEvents`: key `["attendingEvents", token]`, enabled when logged in, app-shaped return with a module-level empty fallback.
    - `utils/appHelpers.eventPath(organizerSlug, eventId)` → `/${slug}/event/${id}`; `eventEditPath` is unchanged.
  - [ ] 6.6 Patch existing typed fixtures for the new required keys (fixture-only, no behaviour change)
    - Files: `AppPage.test.tsx` (`EVENT`, `EVENT_FIXTURE`), `eventDraft.test.ts`, `EventPage.test.tsx`, `eventViewState.test.ts`.
    - Keys: `author_slug`, `organization`, `participants`, `is_attending`, `has_ended`, `author_display_name`. No `as` casts.
  - [ ] 6.7 Ensure data-layer tests pass
    - Run only `src/test/useEvent.test.tsx` and `src/test/useOpenConversation.test.tsx`.
    - Run `npx tsc -p tsconfig.app.json --noEmit` (it must stay green).

**Acceptance Criteria:**
- The 5 tests pass, and `tsc` is clean.
- The token is not part of the `useEvent` key, and stale data is flagged rather than dropped.
- All event types mirror the spec's backend key sets exactly.

### Task Group 7: Event Page Presentational Components
**Dependencies:** 6
**Files to Modify:** src/frontend/src/pages/events/components/EventWhenCard.tsx, src/frontend/src/pages/events/components/EventAttendeeList.tsx, src/frontend/src/pages/events/components/EventChatRow.tsx, src/frontend/src/pages/events/components/EventFooter.tsx, src/frontend/src/test/EventComponents.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/anonymous-visitor-view.html
  element: component:event-when-card
  locator: `<section class="card" aria-label="Termin wydarzenia">`, lines 260-265
  acceptance: `aria-label` "Termin wydarzenia"; date badge (dd / D); eyebrow "Termin wydarzenia"; full date with the first letter uppercased; "godz. HH:mm–HH:mm" ("godz. HH:mm" with no end); "Miejsce" block (name, address, notes, "Otwórz w Google Maps ↗" + sr-only "(nowa karta)"); action row `AddToCalendarButton` + "Kopiuj link" ghost (toast "Skopiowano link"); no capacity
- mockup: analysis/design-context/mockups/anonymous-visitor-view.html
  element: component:event-attendee-list
  locator: `<section class="att" aria-label="Zapisani na wydarzenie">`, lines 266-270
  acceptance: h2 "Zapisani i ich rzeczy"; author row first with "Organizator" pill (accent-soft); `Avatar` + name per row; read-only item links to `/<author_slug>/product/<item_id>` with 48px thumb (`SafeImage`/`PhotoPlaceholder`), product name, mode label (GIFT "Weź na stałe", SWAP "Zamiana"); the first 3 items show, then "Pokaż wszystkie (n)" / "Zwiń" with `aria-expanded`
- mockup: analysis/design-context/mockups/signed-up-participant-view.html
  element: component:event-attendee-list
  locator: own row `<span class="you">To Ty</span>`, line 267
  acceptance: the row with `is_me` shows the "To Ty" pill (primary-soft)
- mockup: analysis/design-context/mockups/empty-participants-state.html
  element: screen:event-empty
  locator: `<p class="empty">`, line 268
  acceptance: the author row is still rendered; below the list, dashed empty copy "Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany." (gender-neutral, overrides the mockup's "pierwszy")
- mockup: analysis/design-context/mockups/signed-up-participant-view.html
  element: component:event-chat-row
  locator: `<div class="chatrow">`, line 266
  acceptance: full-width `CHAT_BUTTON`-style button "💬 Czat wydarzenia" calling `onOpen`; disabled while busy; error shown inline with `role="alert"`
- mockup: analysis/design-context/mockups/anonymous-visitor-view.html
  element: component:event-footer
  locator: `<footer><button class="cta">`, line 270
  acceptance: sticky footer (`TermFooter` copy); `signUp` variant primary "＋ Zapisz się na wydarzenie" disabled while busy
- mockup: analysis/design-context/mockups/signed-up-participant-view.html
  element: component:event-footer
  locator: `<footer><button class="cta out">`, line 271
  acceptance: `withdraw` variant is an outline button "Wypisz się"
- mockup: analysis/design-context/mockups/ended-event-state.html
  element: screen:event-ended
  locator: `<footer><button class="cta" disabled>`, line 271
  acceptance: `ended` variant is a disabled "Wydarzenie się zakończyło" button
**Estimated Steps:** 7

- [ ] 7.0 Complete event presentational components
  - [ ] 7.1 Write 6 focused tests in `src/test/EventComponents.test.tsx` (`renderWithProviders`, typed fixtures, fake `Date` only)
    - `EventWhenCard` renders the "godz. 11:00–15:00" range and falls back to "godz. 11:00" with no end
    - `EventAttendeeList` puts the author first with "Organizator" and the `is_me` row with "To Ty"
    - item links point to `/<slug>/product/<id>` with the mode labels
    - "Pokaż wszystkie (n)" toggles `aria-expanded` and shows every item
    - the empty-state copy renders when there are no attendees
    - `EventFooter` renders `signUp`/`withdraw`/`ended` (disabled) variants with the exact copy
  - [ ] 7.2 Create `EventWhenCard.tsx` as a copy of `TermCard` adapted to the start–end range
    - Reuse `buildMapsUrl`, `AddToCalendarButton`, `dayjs` from `utils/dayjs`, and an `onCopyLink` prop.
  - [ ] 7.3 Create `EventAttendeeList.tsx` (`participants`, `authorSlug` props)
    - Reuse `Avatar`, `SafeImage`, `PhotoPlaceholder` and `organizerItemPath`. Expansion state is local per row.
  - [ ] 7.4 Create `EventChatRow.tsx`
    - Props `onOpen`, `busy`, `error`; `CHAT_BUTTON` classes, copied rather than imported if `ChatRow` is not exported.
  - [ ] 7.5 Create `EventFooter.tsx` with a discriminated `variant: "signUp" | "withdraw" | "ended"`
    - Props `onSignUp`/`onWithdraw`/`busy`; sticky layout as in `TermFooter`.
  - [ ] 7.6 Use only `uiStyles` classes and `@theme` tokens
    - No new custom CSS, mobile-first, sr-only spacing per accessibility.md. Term components are not modified.
  - [ ] 7.7 Ensure component tests pass
    - Run only `src/test/EventComponents.test.tsx` and `tsc`.

**Acceptance Criteria:**
- The 6 tests pass.
- Each component matches every `acceptance` criterion declared above (copy, order, pills, states).
- No file under `pages/term/components/` changed.

### Task Group 8: Event Page Composition, Sign-up Flows & Routing
**Dependencies:** 6, 7
**Files to Modify:** src/frontend/src/pages/events/eventViewState.ts, src/frontend/src/pages/events/EventPage.tsx, src/frontend/src/pages/events/hooks/useEventSignUp.ts, src/frontend/src/pages/events/components/EventGuestSignUpSheet.tsx, src/frontend/src/pages/events/components/EventGuestMergeCard.tsx, src/frontend/src/pages/events/components/EventAuthorCard.tsx, src/frontend/src/pages/term/modals/AccountMergeForm.tsx, src/frontend/src/router.tsx, src/frontend/src/test/eventViewState.test.ts, src/frontend/src/test/EventPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/anonymous-visitor-view.html
  element: screen:event-anonymous
  locator: whole phone frame, lines 257-270
  acceptance: order header (back, eyebrow "Wydarzenie", h1 name, org chip only when `organization !== null`) → banner (`mx-5`, aspect 16/7, `rounded-[22px]`, alt "Baner wydarzenia {name}") → when-card → description (`whitespace-pre-line`) → attendee list → footer "＋ Zapisz się na wydarzenie" that opens the guest sheet; no chat row
- mockup: analysis/design-context/mockups/signed-up-participant-view.html
  element: screen:event-participant
  locator: chat row (line 266) through footer (line 271)
  acceptance: "💬 Czat wydarzenia" row present; own row "To Ty"; "Wypisz się" opens `ConfirmDeleteDialog` (title "Wypisać się z wydarzenia?", body "Znikniesz z listy zapisanych i stracisz dostęp do czatu wydarzenia.", confirm "Wypisz się", `tone="primary"`, busy "Wypisywanie…"), then toast "Wypisano z wydarzenia"
- mockup: analysis/design-context/mockups/author-view.html
  element: screen:event-author
  locator: author card `<section class="card">` "Twoje wydarzenie", lines 270-271
  acceptance: chat row present; no footer; card eyebrow "Twoje wydarzenie", text "Możesz je edytować. Usunąć da się dopiero, gdy nikt nie jest zapisany."; "✏️ Edytuj" → `/events/:id/edit`; "Usuń" danger with `aria-disabled` + count hint while `attendee_count > 0`; delete success → meetings view
- mockup: analysis/design-context/mockups/guest-sign-up-sheet.html
  element: screen:event-guest-signup
  locator: `<div class="sheet" role="dialog">`, lines 266-271
  acceptance: `ModalSheet` title "Zapisz się na wydarzenie", subtitle "{name} · {ddd D MMMM, HH:mm}"; field label "Twoje imię" (`FIELD`, `aria-invalid`/`aria-describedby`), hint "Imię zobaczą inni na liście zapisanych."; submit "Zapisz się" (Enter submits); footer link "Masz konto? Zaloguj się" (`authPath` with `returnTo`); inline `role="alert"` errors; inner buttons `type="button"` except submit
- mockup: analysis/design-context/mockups/guest-signed-up-merge-card.html
  element: screen:event-guest-merge
  locator: `<section class="card merge">`, lines 270-272
  acceptance: no footer; `AccountMergeForm` with title "Zapisano Cię jako gościa ✓" (gender-neutral) and hint "Załóż konto, żeby pisać na czacie wydarzenia i móc się wypisać."; email/password fields + "Załóż konto"
- mockup: analysis/design-context/mockups/ended-event-state.html
  element: screen:event-ended
  locator: whole phone frame, lines 257-271
  acceptance: attendee list and chat row (for author/attendee) remain; every non-author viewer gets the disabled "Wydarzenie się zakończyło" footer
- mockup: analysis/design-context/mockups/empty-participants-state.html
  element: screen:event-empty
  locator: list + footer, lines 266-268
  acceptance: organizer row always shown with the empty copy; the anonymous footer is "＋ Zapisz się na wydarzenie" (M3 overrides the mockup's "Zaloguj się, żeby się zapisać")
**Estimated Steps:** 9

- [ ] 8.0 Complete event page composition
  - [ ] 8.1 Write 8 focused tests
    - In `src/test/eventViewState.test.ts`: one `it.each` table (rewritten) covering `loading`, `notFound`, `error`, `author`, `attendee`, `guestAttendee` and `visitor` (ended and not), plus the M4 rows:
      - anonymous → logged-in `isStale` → `refreshing`
      - author → logged-out `isStale` → `refreshing`
      - stale with a refresh error → `refreshing{error}`
      - non-stale refresh error keeps the content view
    - In `src/test/EventPage.test.tsx` (rewritten for `/:organizationSlug/event/:eventId`):
      - anonymous page order and "＋ Zapisz się na wydarzenie" footer, including the empty-state copy
      - guest sheet submit writes `guest_profile_id:event:<id>` and shows "Zapisano Cię jako gościa ✓"
      - router-state toast shown once, and the state is cleared
      - header chip only when `organization` is set
      - attendee sees the chat row and "Wypisz się" confirm → withdraw
      - author card with no footer
      - ended footer disabled
  - [ ] 8.2 Rewrite `pages/events/eventViewState.ts` `resolveEventView`
    - Inputs: `data`, `loading`, `notFound`, `error`, `isStale`, `isLoggedIn`, `guestProfileId`.
    - Union per spec, including the read-only `refreshing`. 404 wins.
    - Export `EventContentView = Extract<…, { event }>`.
  - [ ] 8.3 Create `pages/events/hooks/useEventSignUp.ts`
    - `guestProfileId` is seeded from `readValidGuestProfile(eventGuestProfileKey(id))`.
    - `openSignUp`: logged-in → `signUp(null)` + toast "Zapisano na wydarzenie"; anonymous → open the sheet.
    - `submitGuest(name)`: client blank check "Podaj swoje imię."; on success `writeGuestProfile` → close → toast.
    - Withdraw-confirm state.
  - [ ] 8.4 Create `EventGuestSignUpSheet.tsx` on `ModalSheet`
    - `ModalSheet` registers itself with `useRegisterOpenSheet`. Follow the picker-sheet rules in accessibility.md.
  - [ ] 8.5 Add the merge card and the author card
    - `AccountMergeForm.tsx`: optional `title`/`hint` props that default to the current Term copy (byte-identical Term rendering).
    - `EventGuestMergeCard.tsx` passes the event copy to it.
  - [ ] 8.6 Create `EventAuthorCard.tsx`
    - Extracted from the current `EventPage.tsx` delete flow: `ConfirmDeleteDialog`, the "Nie można usunąć — zapisał… się już N osób." hint, and `aria-disabled` + `aria-describedby` with a handler guard.
  - [ ] 8.7 Rewrite `EventPage.tsx` as a thin `switch (view.kind)`
    - `TermPageSkeleton`, not-found copy, error + retry.
    - Content inside `OrganizerThemeScope theme={event.organization}` + `PAGE_SHELL` in the spec page order. `GroupHeader` gets `organizerSlug` only when `organization !== null` (L6).
    - The chat row (author/attendee) uses `useOpenAndNavigate().open({ kind: "EVENT", id })`. Copy link uses `eventPath`.
    - It owns `useEvent`, `useToast` and `useEventSignUp`, passing callbacks as props.
    - Router-state toast: show it once on mount, then `navigate(pathname, { replace: true, state: null })` (M1).
  - [ ] 8.8 Update `router.tsx`
    - Remove the `/events/:eventId` page route and add `{ path: "/:organizationSlug/event/:eventId", element: <EventPage/> }` next to the term route (no AuthGuard).
    - Keep `/events/:eventId/edit` and update the comments ("event" is reserved).
  - [ ] 8.9 Ensure page tests pass
    - Run only `src/test/eventViewState.test.ts` and `src/test/EventPage.test.tsx`, plus the existing Term test files that render `AccountMergeForm`, to prove the copy is unchanged.
    - Run `tsc`.

**Acceptance Criteria:**
- The 8 tests pass, and the Term tests stay green.
- The page renders all 7 screens per their `acceptance` criteria, with no "Zaloguj się" footer variant.
- `/events/:eventId` no longer matches a page route, and `/events/:eventId/edit` still does.

### Task Group 9: App-wide Event Links, Spotkania & Messages UI
**Dependencies:** 6, 8
**Files to Modify:** src/frontend/src/pages/meetings/TermCards.tsx, src/frontend/src/pages/meetings/MeetingsView.tsx, src/frontend/src/pages/events/EventEditView.tsx, src/frontend/src/pages/add/EventCreateView.tsx, src/frontend/src/pages/messages/InboxPage.tsx, src/frontend/src/pages/messages/ThreadPage.tsx, src/frontend/src/test/AppPage.test.tsx, src/frontend/src/test/InboxPage.test.tsx, src/frontend/src/test/ThreadPage.test.tsx
**Visual References:** this group touches UI that no `design-context/INDEX.md` screen covers (Spotkania, Inbox, Thread, Add/Edit flows). Follow the existing page styling; there is no mockup contract.
**Estimated Steps:** 7

- [ ] 9.0 Complete app-wide event integration
  - [ ] 9.1 Write 5 focused tests
    - In `src/test/AppPage.test.tsx`:
      - event card `href`s use `/<author_slug>/event/<id>` (routes updated)
      - "Biorę udział" lists attended events with no edit pencil, and the empty copy is "Nie masz jeszcze żadnych zapisów."
      - create flow (rewrite ~2928–2948, 2983): after save, navigation lands on `/<slug>/event/<id>` with `state.toast`, asserted through a stub event route that renders the router state (M1)
    - In `src/test/InboxPage.test.tsx`: an EVENT row shows the "Wydarzenie" chip and the 🎉 icon.
    - In `src/test/ThreadPage.test.tsx`: an EVENT thread header shows "czat wydarzenia".
  - [ ] 9.2 Update `TermCards.tsx` `EventCard`
    - The link and copy link use `eventPath(event.author_slug, event.id)`.
    - New `editable?: boolean` (default `true`) hides the pencil.
  - [ ] 9.3 Update `MeetingsView.tsx`
    - Merge `useAttendingEvents().data` into `attending` (sorted by `byDate`) and render `EventCard editable={false}`.
    - The empty copy becomes "Nie masz jeszcze żadnych zapisów." (L8).
  - [ ] 9.4 Update `EventCreateView.tsx` `finish()`
    - `navigate(eventPath(event.author_slug, event.id), { state: { toast: savedToast(event) } })`, replacing `/add` + `useAppData().showToast`. This also covers banner-skip.
  - [ ] 9.5 Update `EventEditView.tsx`
    - Treat `isStale` like `loading`.
    - The back link and post-save navigation use `eventPath(event.author_slug, …)`, falling back to `viewPath("meetings")` while loading.
  - [ ] 9.6 Update the Messages UI
    - `InboxPage.tsx`: `KIND_CHIP.EVENT = { label: "Wydarzenie", className: "bg-accent-soft text-accent-fg" }`, and `LeadingVisual` EVENT → `RoundIcon` "🎉".
    - `ThreadPage.tsx`: header suffix from a kind → label map (TERM "czat terminu", GROUP "czat grupy", EVENT "czat wydarzenia").
  - [ ] 9.7 Ensure integration tests pass
    - Run only `src/test/AppPage.test.tsx`, `src/test/InboxPage.test.tsx` and `src/test/ThreadPage.test.tsx`.
    - Run `tsc`.
    - Grep the frontend source for leftover `/events/${` page links outside `eventEditPath`.

**Acceptance Criteria:**
- The 5 tests pass.
- Every event link in the app uses the slug URL, and post-create lands on the event page with a one-time toast.
- Attended events appear in Spotkania, and EVENT conversations render a chip, icon and thread header.

### Task Group 10: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9
**Files to Modify:** src/backend/tests/test_event_attendance.py, src/backend/tests/test_event_page.py, src/backend/tests/test_event_conversations.py, src/backend/tests/test_events.py, src/frontend/src/test/EventPage.test.tsx, src/frontend/src/test/EventComponents.test.tsx, src/frontend/src/test/useEvent.test.tsx
**Estimated Steps:** 4

- [ ] 10.0 Review and fill critical gaps
  - [ ] 10.1 Review the 52 tests from Groups 1–9 against the 14 spec requirements and the success criteria
  - [ ] 10.2 Analyze gaps for this feature only
    - Candidates:
      - sign-up race against delete → 404 (L3)
      - guest name >255 → 400 and the moderation rejection path
      - EVENT `participant_count` excludes guests
      - withdrawn attendee's thread leaves the inbox
      - `refreshing` view hides footer/author card in `EventPage`
      - logged-in one-click sign-up toast
      - "Kopiuj link" toast
  - [ ] 10.3 Write up to 10 additional strategic tests in the existing feature test files listed above
  - [ ] 10.4 Run feature-specific tests only
    - All backend `tests/test_event*.py`, `test_messaging_migration.py`, `test_authorization_matrix.py` and `test_public_preview.py`, plus the frontend event/inbox/thread/AppPage/useEvent/useOpenConversation test files. Expect about 52–62 tests.

**Acceptance Criteria:**
- All feature tests pass (about 52–62).
- No more than 10 additional tests are added.
- Every spec requirement maps to at least one passing test.

## Execution Order

1. Group 1: Database Migration & Messaging Models (6 steps, no dependencies)
2. Group 2: Event Slugs, Cross-Context ACLs & Attending List (8 steps, no dependencies)
3. Group 3: Attendance Sign-up & Withdraw API (9 steps, depends on 2)
4. Group 4: Public Event Detail Read Model & OG Preview (9 steps, depends on 3)
5. Group 5: Messaging EVENT Conversation Kind (9 steps, depends on 1, 3)
6. Group 6: Frontend Event Data Layer (7 steps, no dependencies)
7. Group 7: Event Page Presentational Components (7 steps, depends on 6)
8. Group 8: Event Page Composition, Sign-up Flows & Routing (9 steps, depends on 6, 7)
9. Group 9: App-wide Event Links, Spotkania & Messages UI (7 steps, depends on 6, 8)
10. Group 10: Test Review & Gap Analysis (4 steps, depends on 1–9)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: error-handling (typed Polish errors), validation (server-side guest-name checks, inline `role="alert"`), minimal-implementation (ACL functions added only with their first consumer), conventions, coding-style, commenting.
- `backend/`:
  - models.md: no `relationship()`, ACL-only cross-context access, batched IN lookups, 404 before 403.
  - queries.md: one join for items, `count_queries` guards, SQL-level ordering.
  - migrations.md: reversible 0071, explicit `fk_`/`uq_`/`ix_` names, reverse-order downgrade, downgrade-then-upgrade test.
  - security.md: one matrix row per route, first match wins, `require_any` or no dependency for PUBLIC.
  - time.md: `clock.local_now()`, naive-UTC `withdrawn_at`, `format_term_when`.
  - api.md.
- `frontend/`:
  - components.md: `resolveEventView` in `*ViewState.ts`, `switch` on `view.kind`, `Extract` sub-unions, flows in `useEventSignUp`.
  - data-fetching.md: `forToken`/`isStale`, awaited prefix invalidation, stable empty fallback, callbacks as props, `dayjs` from `utils/dayjs`.
  - accessibility.md: `ModalSheet`, `aria-disabled` + hint, `aria-expanded`, sr-only spacing.
  - css.md and responsive.md: `uiStyles` + `@theme` tokens, mobile-first.
- `testing/`: backend-testing.md (testcontainers, `db_session`/`client`, exact key sets, `freeze_local_now`, `count_queries`, camelCase test names) and frontend-testing.md (explicit vitest imports, `renderWithProviders`, `createQueryWrapper`, typed fixtures with no `as`, fake `Date` only).

## Notes

- Test-driven: each group starts with 2–8 tests.
- Run incrementally: only the new and updated tests after each group (Group 5 adds three existing messaging files as a regression guard).
- Mark progress: check off steps as they are completed.
- Reuse first: `create_rsvp`, `withdraw_attendance`, `_exchange_candidates`, `_insert_or_reselect`, `public_term_preview`, `TermCard`/`AttendeeList`/`TermFooter` (copied, never modified), `AccountMergeForm`, `ModalSheet`, `ConfirmDeleteDialog`, `OrganizerThemeScope` and `useOpenAndNavigate`.
- Secrets: never print `.env` or environment values. Configuration checks are presence-only.
