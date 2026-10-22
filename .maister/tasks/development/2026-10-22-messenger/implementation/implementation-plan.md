# Implementation Plan: Messenger (item questions, group chat, term chat)

## TL;DR
- 10 task groups and 73 steps: 5 backend groups, 4 frontend groups and a final test review. About 50–74 focused tests.
- The backend chain is DB (1) + cross-BC functions (2) → messaging core (3) → conversation API (4) → messages, read markers and inbox API (5).
- The frontend chain is the data layer (6) → thread page (7) → inbox, top bar and routes (8). The entry points (9) need groups 2 and 6.
- The frontend groups build against the API contract in spec requirements 14–19 and 28, and mock `api/conversations`, so they do not wait on the backend.
- Every UI group carries binding `Visual References`. `visual-coverage.md` maps all 10 design IDs.

## Key Decisions
- **The backend API is split into two groups.** Group 4 covers get-or-create, access and `GET /{id}`. Group 5 covers messages, read markers, the inbox and the unread count. Together the spec's 30+ test scenarios do not fit one 2–8 test group. Both edit `app/messaging/router.py`, `schemas.py`, `service.py` and `tests/test_group_term_conversations.py`, so group 5 depends on group 4.
- **Group 5 adds `GET /` and `GET /unread-count` above the `/{id}` routes that group 4 declared.** Group 4 declares `POST /item|/group|/term` before `GET /{id}` and adds the ordering comment.
- **The repository's hot-row Core statements live in group 3.** That covers the FOR UPDATE lock, the GREATEST bump (5a), the read upsert (5b), the cursor queries and the inbox/unread aggregates. They are tested against `db_session` there, so groups 4 and 5 only compose them.
- **Shared files have one owner each:**
  - `tests/conftest.py` (limiter reset): group 3 only;
  - `app/main.py` and `authorization_matrix.py`: group 4 only;
  - `router.tsx` and `themeTokenUsage.test.tsx`: group 8 only;
  - `termViewState.ts` and `api/groups.ts`: group 9 only;
  - `tests/test_group_access.py`: group 2 only.
- **ThreadPage is built before the inbox and routes** (group 7 → group 8). Group 8 can then register both routes and add all 5 new files to `NO_HEX_FILES` in one edit.
- **The groups chat-audience functions go in a new `app/groups/application/chat_audience.py`**, re-exported by `service.py`. The existing private helpers stay unchanged (H1).
- **Tests are bundled by scenario**: one test function covers a full flow, such as soft-deleted group → GET/messages/read/send/inbox. This keeps each group within 2–8 tests and still covers every spec scenario.

## Open Questions / Risks
- **The test total (~50–74) is above the usual 16–34 guideline.** This is a complex, multi-BC feature (about 40 files), and every group stays within its 2–8 limit.
- **The frontend could drift from the backend contract.** Groups 6–9 build against the spec's field names. Group 10 checks the `api/conversations.ts` types against `app/messaging/schemas.py`.
- **The `count_queries` budget test (group 5) depends on how group 3 shaped its queries.** If the audience or labels steps grow per row, the fix belongs in the group 3 repository code.
- **The mypy baseline is 23 errors and must not grow.** Core statements with `on_conflict_do_update` and `func.greatest` often need explicit typing.

## Overview
- Total steps: 73
- Task groups: 10 (9 implementation + test review)
- Expected tests: ~50–74 (50–64 across groups 1–9, plus up to 10 in group 10)

All backend paths are relative to `src/backend/` and all frontend paths to `src/frontend/src/`. Backend commands run from `src/backend` as `uv run python -m pytest|mypy|ruff`. Frontend commands run from `src/frontend` as `npm test -- <files>`, `npx tsc -b` and `npx eslint <files>`.

## Implementation Steps

### Task Group 1: Database Layer (messaging models + migration 0061)
**Dependencies:** None
**Files to Modify:** `app/messaging/__init__.py`, `app/messaging/models.py`, `alembic/versions/0061_messaging.py`, `tests/test_messaging_migration.py`
**Estimated Steps:** 6

- [ ] 1.0 Complete the messaging database layer
  - [ ] 1.1 Write 2-3 focused tests in `tests/test_messaging_migration.py`. Model them on `tests/test_locations_migration.py` and `tests/test_group_soft_delete_migration.py`.
    - Downgrade to `0060`, then upgrade to head.
    - Assert that the tables `conversations`, `messages` and `conversation_reads` exist.
    - Assert that the partial unique indexes `uq_conversations_group_id`, `uq_conversations_term_id` and `uq_conversations_item_id_asker_party_id_owner_party_id` exist, together with their `WHERE kind = ...` predicates.
    - Assert `uq_conversation_reads_conversation_id_party_id` and the named FKs (`fk_conversations_item_id_inventory_items`, `fk_conversations_group_id_groups`, `fk_conversations_term_id_terms`, `fk_messages_conversation_id_conversations`).
  - [ ] 1.2 Create `app/messaging/models.py` with a `ConversationKind` StrEnum (`ITEM`, `GROUP`, `TERM`) and three `BaseEntity` models with no `relationship()`.
    - `Conversation`:
      - `kind` is `String(10)`;
      - `item_id`, `group_id` and `term_id` are nullable FK ids;
      - `asker_party_id` and `owner_party_id` are nullable FKs to `parties`;
      - `last_message_at` is a nullable naive `DateTime`.
    - `Message`:
      - `conversation_id` is an FK;
      - `sender_party_id` is an FK to `parties`;
      - `body` is `String(1000)`, not null.
    - `ConversationRead`:
      - `conversation_id` and `party_id` are FKs;
      - `last_read_at` is not null.
    - Reuse: `app/core/base_model.py` `BaseEntity`. Use string-backed enums, following `standards/backend/models.md`.
  - [ ] 1.3 Write `alembic/versions/0061_messaging.py` `upgrade()` with `down_revision = "0060"`. Model it on `0057_locations.py`.
    - UUID PKs use `server_default=gen_random_uuid()` and are named `pk_<table>`.
    - FK, index and unique names are explicit (`fk_`/`ix_`/`uq_`).
    - The partial unique indexes use `postgresql_where`.
    - Add `ix_conversations_asker_party_id`, `ix_conversations_owner_party_id`, `ix_conversations_group_id` and `ix_messages_conversation_id_created_at_id` on `(conversation_id, created_at, id)`.
  - [ ] 1.4 Write `downgrade()` in reverse dependency order: `conversation_reads`, then `messages`, then `conversations`. Drop indexes and FKs before each table (spec requirement 4).
  - [ ] 1.5 Add `app/messaging/__init__.py`. Check that the models import cleanly and that a `Conversation` row can be inserted. A quick assert can go inside the round-trip test.
  - [ ] 1.6 Ensure the database layer tests pass.
    - Run only `uv run python -m pytest tests/test_messaging_migration.py`.
    - Do NOT run the entire test suite.

**Acceptance Criteria:**
- The 2-3 migration tests pass. Upgrade, then downgrade to 0060, then upgrade again all succeed.
- All constraint and index names match spec requirements 1–3 exactly.
- The models have no `relationship()`, and `updated_at` is still the `version_id_col` from `BaseEntity`.

### Task Group 2: Cross-Context Public Functions (groups, circulation, users)
**Dependencies:** None
**Files to Modify:** `app/groups/infrastructure/repository.py`, `app/groups/application/chat_audience.py` (new), `app/groups/application/public_view.py`, `app/groups/schemas.py`, `app/groups/service.py`, `app/circulation/infrastructure/repository.py`, `app/circulation/service.py`, `app/users/service.py`, `tests/test_messaging_cross_context.py` (new), `tests/test_group_access.py`
**Estimated Steps:** 8

- [ ] 2.0 Complete the cross-context public functions
  - [ ] 2.1 Write 5-7 focused tests. Most go in `tests/test_messaging_cross_context.py`; the attendee flag test goes in `tests/test_group_access.py`.
    - `is_active_group_member` and `is_active_group_organizer` are both true for a **soft-deleted** group, and false for an ended Membership.
    - `get_chat_audience_for_party` returns led groups, member groups and attended terms, including soft-deleted and PUBLIC groups, and excludes a withdrawn attendance.
    - `list_chat_group_refs`, `list_chat_term_refs` and `list_current_organizer_party_ids` return the documented tuple shapes, and run zero queries for empty input (use `count_queries`).
    - `circulation.list_item_refs` returns `(name, deleted_at)`, including soft-deleted items. Its query count is the same for 1 item and 3 items, and it runs no query for `[]`.
    - `users.list_chat_profiles_by_party_ids` returns `(display_name, has_account)`, with `has_account=False` for a guest profile.
    - `test_group_access.py`: for a withdrawn attendee, `access.is_active_attendee` is false while `is_attending` stays true. For an active attendee it is true. Update any exact key-set assertion on `access` to include the new key; do not loosen it.
  - [ ] 2.2 Add new groups repository statements to `app/groups/infrastructure/repository.py`. None of them joins `Group` or filters on `deleted_at`, and none reuses `list_active_*_for_role_ids` (spec requirements 24b and 24e):
    - `has_active_membership(db, group_id, party_id)`: `Membership` ⨝ `GroupRole` (`MEMBER`, `valid_to IS NULL`);
    - `list_led_group_ids_for_party`, `list_member_group_ids_for_party` and `list_attended_term_ids_for_party` (`withdrawn_at IS NULL`);
    - batched lookups:
      - `list_chat_group_refs(ids) → {id: (name, visibility, deleted_at)}`, modelled on `list_group_names` (:80);
      - `list_chat_term_refs(ids) → {id: (group_id, occurs_on)}`;
      - `list_current_organizer_party_ids(group_ids) → {group_id: party_id}`.
  - [ ] 2.3 Create `app/groups/application/chat_audience.py` with public functions (spec requirements 24a–24f):
    - `is_active_group_organizer`: wraps `circles._is_active_organizer`;
    - `is_active_group_member`: over `has_active_membership`;
    - `list_group_member_party_ids`: from `exchange_summary._ordered_group_member_party_ids`;
    - `list_active_attendee_party_ids`: over `list_active_attendances_for_term`;
    - `get_chat_audience_for_party`: returns three id sets;
    - the three batched ref lookups.
    - Do not change `memberships._is_active_member` or its callers (`join_code.py:137`, `public_view.py:375,439`).
  - [ ] 2.4 Re-export the new functions from `app/groups/service.py` (flat `__all__`). Also export `get_group_including_deleted` and `get_term_any` if they are not exported yet.
  - [ ] 2.5 Add `is_active_attendee: bool` to `GroupAccessDetails` (`app/groups/schemas.py:354`). Compute it in `public_view.get_group_access` (:355-400):
    - it is true when `profile is not None` and the shown term has a non-withdrawn attendance by the caller;
    - it takes one query via `list_active_attendances_for_term`, or is `False` when there is no term;
    - `is_attending` is unchanged (spec requirement 39).
  - [ ] 2.6 Add `list_item_refs(db, item_ids) -> dict[UUID, tuple[str, datetime | None]]` to `app/circulation/service.py`.
    - It calls a new repository function: one `InventoryItem` ⨝ `Product` select with `InventoryItem.deleted_at`, modelled on `list_product_names_for_items` (`repository.py:224-236`).
    - It returns `{}` without a query for empty input and loads no row per item (M2).
    - Also make sure `find_item_including_deleted` and `resolve_owning_inventory` are exported from `service.py`.
  - [ ] 2.7 Add `list_chat_profiles_by_party_ids(db, party_ids) -> dict[UUID, tuple[str, bool]]` to `app/users/service.py`.
    - It is one batched statement over `UserProfile` with `has_account = account_user_id IS NOT NULL`, and returns `{}` for empty input.
  - [ ] 2.8 Ensure the cross-context tests pass.
    - Run only `tests/test_messaging_cross_context.py tests/test_group_access.py`.
    - Run `uv run python -m mypy app/groups app/circulation app/users`; there must be no new errors.

**Acceptance Criteria:**
- The 5-7 tests pass, and the existing `test_group_access.py` still passes after its key set is updated.
- Every new batched function runs exactly one statement for non-empty input and none for empty input.
- No existing private helper or its callers changed. Messaging can use only public `service.py` names.

### Task Group 3: Messaging Core (moderation field, send limiter, ACLs, repository)
**Dependencies:** 1, 2
**Files to Modify:** `app/moderation/text_guard.py`, `app/messaging/application/__init__.py`, `app/messaging/application/send_limiter.py`, `app/messaging/infrastructure/__init__.py`, `app/messaging/infrastructure/groups_acl.py`, `app/messaging/infrastructure/circulation_acl.py`, `app/messaging/infrastructure/users_acl.py`, `app/messaging/infrastructure/repository.py`, `tests/conftest.py`, `tests/test_message_send_limiter.py` (new), `tests/test_messaging_repository.py` (new)
**Estimated Steps:** 8

- [ ] 3.0 Complete the messaging core
  - [ ] 3.1 Write 6-8 focused tests.
    - `test_message_send_limiter.py`, modelled on `tests/test_join_code_limiter.py`:
      - the 31st message within 60 s raises `TooManyAttemptsException` with "Za dużo wiadomości — spróbuj ponownie za chwilę." and a Retry-After value;
      - the 21st new conversation within an hour raises "Za dużo nowych rozmów — spróbuj ponownie za {n} min";
      - `check_*` without `record_*` never trips the limit.
    - `test_messaging_repository.py`, seeded through the models with `db_session`:
      - keyset `before` and `after` return the correct 50-row windows and `has_more` (51st row);
      - an anchor id from another conversation is rejected;
      - `bump_last_message_at` keeps GREATEST and `upsert_read_marker` never moves `last_read_at` backwards;
      - the unread aggregate excludes the caller's own messages and respects `last_read_at`;
      - the inbox/unread selection includes ITEM rows for asker and owner, GROUP rows in led ∪ member, TERM rows in attended ∪ led-group, and excludes `last_message_at IS NULL`.
  - [ ] 3.2 Add `TextField.MESSAGE_BODY` to `app/moderation/text_guard.py`, with the `MESSAGES` entry "Wiadomość narusza zasady społeczności. Zmień ją i spróbuj ponownie." Do not apply the contact-info rule (spec requirement 22).
  - [ ] 3.3 Create `app/messaging/application/send_limiter.py` as an in-memory sliding window modelled on `join_code_limiter.py`:
    - `check_message` / `record_message`: 30 per 60 s per party;
    - `check_new_conversation` / `record_new_conversation`: 20 per hour per party;
    - plus `reset()`.
  - [ ] 3.4 In `tests/conftest.py`, add an autouse `reset_message_limiter` fixture next to `reset_join_code_limiter` (:130).
  - [ ] 3.5 Create the ACL modules. They are the only places messaging imports other BCs, and they import only public `service.py` names and no `..schemas` (spec requirement 27):
    - `groups_acl.py`: group and term loading (including deleted), the organizer and member checks, the audience, the batched refs, the organizer map, member and attendee party ids;
    - `circulation_acl.py`: `find_item_including_deleted`, the owner party resolution (`resolve_owning_inventory` → `Inventory.owner_user_id` → users profile → `party_id`), and `list_item_refs`;
    - `users_acl.py`: profile by principal (a missing profile raises `AuthenticationRequiredException`, mapped as in `join_code.py:36-44`), and `list_chat_profiles_by_party_ids`.
  - [ ] 3.6 Create the reads and the cursor queries in `app/messaging/infrastructure/repository.py`:
    - the conversation lookups: by id, by `(item, asker, owner)`, by group, by term;
    - `get_message_anchor(conversation_id, message_id)`;
    - `list_messages_page(conversation_id, before|after|None)`:
      - `before` reads 51 rows `DESC` and reverses them;
      - `after` reads 51 rows ascending;
      - with no cursor it reads the newest 51 and reverses them.
  - [ ] 3.7 Add the hot-row Core statements and the aggregates to the repository:
    - `lock_conversation_for_send`: `SELECT last_message_at … FOR UPDATE`;
    - `insert_message`;
    - `bump_last_message_at` (5a: `GREATEST(coalesce(last_message_at, :t), :t)` and `updated_at = :t`);
    - `upsert_read_marker` (5b: explicit `created_at`/`updated_at`, `on_conflict_do_update` with GREATEST);
    - `select_inbox_rows(me, led, member, attended, limit=100)`: one statement with a left-joined read row and a grouped unread count;
    - `sum_unread(...)`: the same filter with no LIMIT;
    - `last_messages_for(conversation_ids)`: `DISTINCT ON (conversation_id)`.
    - All values are bound parameters with explicit ordering, following `standards/backend/queries.md` and `jooq.md`.
  - [ ] 3.8 Ensure the core tests pass.
    - Run only `tests/test_message_send_limiter.py tests/test_messaging_repository.py tests/test_join_code_limiter.py`.
    - Then run mypy and ruff on `app/messaging app/moderation`.

**Acceptance Criteria:**
- The 6-8 tests pass.
- The limiter state is reset between tests by the autouse fixture.
- Messaging imports other BCs only through the three ACL modules.
- The inbox and unread selection each take one statement, whatever the row count.

### Task Group 4: Conversation API (get-or-create, access, by-id, router wiring, matrix)
**Dependencies:** 3
**Files to Modify:** `app/messaging/schemas.py`, `app/messaging/service.py`, `app/messaging/application/access.py`, `app/messaging/application/conversations.py`, `app/messaging/router.py`, `app/main.py`, `app/core/authorization_matrix.py`, `tests/test_authorization_matrix.py`, `tests/test_item_conversations.py` (new), `tests/test_group_term_conversations.py` (new)
**Estimated Steps:** 8

- [ ] 4.0 Complete the conversation API
  - [ ] 4.1 Write 7-8 focused integration tests through `client`, with per-file `_register`/`_auth` helpers and exact key sets.
    - `test_item_conversations.py`:
      - (a) 201, then 200 with the same id; own item 409 "Nie możesz zapytać o własną rzecz"; unknown item 404;
      - (b) a lent-out item resolves to the permanent owner's party;
      - (c) a deleted item without a thread returns 404, and with an existing thread returns 200;
      - (d) after an ownership change (GIVE/SWAP, or by setting `Inventory.owner_user_id` through SQL), the same asker gets 201 with a different id, and the old thread's `GET /{id}` is still 200 for both original parties;
      - (e) the 21st new conversation returns 429, and re-opening an existing one at the limit returns 200;
      - (f) a third party gets 403 on `GET /{id}`, and a random UUID gets 404.
    - `test_group_term_conversations.py`:
      - (g) GROUP: member and organizer get 201/200, a non-member 403, a missing group 404, and a PUBLIC group with no chat 409 "Czat grupy jest dostępny tylko w grupach prywatnych";
      - TERM: an active attendee and the organizer pass, a withdrawn attendee gets 403, and a term after its date can still be opened.
    - `test_authorization_matrix.py`: cases for `GET /api/conversations`, `GET /api/conversations/unread-count`, `POST /api/conversations/item` and `POST /api/conversations/{id}/read`.
  - [ ] 4.2 Create `app/messaging/schemas.py`:
    - `ConversationResponse`: `id`, `kind`, `title`, `item {id, name, deleted}`, `counterpart_name`, `group_name`, `term_occurs_on`, `unread_count`, `read_only_reason`, `participant_count`;
    - request bodies `{item_id}`, `{group_id}` and `{term_id}`.
    - Use exactly the fields of spec requirements 14 and 16. Do not add `subtitle` or a thumbnail.
  - [ ] 4.3 Create `app/messaging/application/access.py` `resolve_access(db, conversation, party_id)`. It returns `{read_only_reason, organizer_party_id}` or raises 404/403 (spec requirements 6–9):
    - ITEM: the caller must be the asker or the owner;
    - GROUP: `get_group_including_deleted`, then the organizer or member check;
    - TERM: `get_term_any`, then the organizer or non-withdrawn attendance check;
    - `read_only_reason` is `GROUP_DELETED`, then `GROUP_PUBLIC` (GROUP only), then `None`.
  - [ ] 4.4 Create `app/messaging/application/conversations.py`:
    - `open_item_conversation` in the exact order of spec requirement 12: 404 → own 409 → existing 200 → deleted 404 → `check_new_conversation` → insert in `begin_nested()` → `record_new_conversation` → 201. On `IntegrityError` the race loser re-selects and returns 200 without recording.
    - `open_group_conversation` / `open_term_conversation` in the order of spec requirement 13. They are not rate-limited.
    - `get_conversation` builds the server `title` (ITEM: product name; GROUP: group name; TERM: `"Termin: " + clock.format_term_day(occurs_on) + " HH:MM"`).
    - `participant_count` counts distinct account-backed parties among the organizer plus the members or non-withdrawn attendees.
    - Each function returns a `(response, created)` flag so the router can choose 201 or 200.
  - [ ] 4.5 Create `app/messaging/router.py` with prefix `/api/conversations` and `ReadPrincipal`/`EditPrincipal` aliases, as in `app/groups/router/join_code.py:21-22`.
    - Declare the literal `POST /item`, `POST /group` and `POST /term` **before** `GET /{id}`, with the ordering comment as in `join_code.py:24`.
    - Each route uses `Depends(require_any(...))`.
  - [ ] 4.6 Create `app/messaging/service.py` (flat `__all__` facade). Register the router in `app/main.py` after `notifications_router` and before `system_router`, which stays last.
  - [ ] 4.7 Add the matrix rows to `app/core/authorization_matrix.py` next to the notifications rows (:206-207), before the catch-all "# 25":
    - `GET ^/api/conversations(/.*)?$ → ("READ","mcp:read")`;
    - `POST ^/api/conversations(/.*)?$ → ("EDIT","mcp:edit")`.
  - [ ] 4.8 Ensure the conversation API tests pass.
    - Run only `tests/test_item_conversations.py tests/test_group_term_conversations.py tests/test_authorization_matrix.py`.
    - Then run mypy on `app/messaging app/core/authorization_matrix.py`.

**Acceptance Criteria:**
- The 7-8 tests pass, and the existing matrix tests still pass.
- 404 always comes before 403, and the check order matches spec requirements 12 and 13 exactly.
- Get-or-create is race-safe through a savepoint plus re-select. A re-open at the rate limit returns 200.
- `system_router` is still the last router included.

### Task Group 5: Messages, Read Markers & Inbox API
**Dependencies:** 4
**Files to Modify:** `app/messaging/schemas.py`, `app/messaging/service.py`, `app/messaging/application/messages.py`, `app/messaging/application/read_markers.py`, `app/messaging/application/inbox.py`, `app/messaging/router.py`, `tests/test_conversation_messages.py` (new), `tests/test_conversation_inbox.py` (new), `tests/test_group_term_conversations.py`
**Estimated Steps:** 8

- [ ] 5.0 Complete the messaging, read-marker and inbox endpoints
  - [ ] 5.1 Write 8 focused integration tests.
    - `test_conversation_messages.py`:
      - (a) whitespace-only and 1001-character bodies return 400 "Wiadomość musi mieć od 1 do 1000 znaków" with no `fieldErrors`;
      - (b) with 60 messages, the default page is the newest 50 with `has_more: true`, `before=<first>` returns 10 with `has_more: false`, `after=<last>` returns only newer messages, both cursors at once return 400, and a foreign cursor returns 400;
      - (c) `is_mine`, `sender_name` and `sender_is_organizer` are correct; consecutive sends have strictly increasing `created_at`; no `notifications` row is created;
      - (d) a moderation rejection (patch `check_text`) returns 400 with the `MESSAGE_BODY` copy and writes no row, and the 31st send returns 429 with `Retry-After`.
    - `test_conversation_inbox.py`:
      - (e) B's unread count equals A's message count, uncapped above 9; own messages never count; marking the latest read gives 0, and marking an older id afterwards keeps 0; `GET /unread-count` returns 200 (route not shadowed);
      - (f) `count_queries` is equal for `GET /api/conversations` and for `/unread-count` between 1 conversation of each kind (3) and 3 of each kind (9), for the same caller with the same role kinds (M1);
      - (g) `participant_count` excludes a guest attendee, and the inbox row has the exact key set including `last_message`.
    - `test_group_term_conversations.py`, read-only flow:
      - (h) for a soft-deleted group, the member **and** the organizer get GET 200, messages 200 and read 204, send returns 409 "Grupa usunięta — czat jest tylko do odczytu", and the row stays in both inboxes;
      - after a PRIVATE→PUBLIC toggle, `read_only_reason` is `GROUP_PUBLIC`, send returns 409, and get-or-create returns 200; after toggling back, send returns 201;
      - a soft-deleted item's thread still accepts sends (201), and after an ownership change the old ITEM thread accepts sends from both original parties.
  - [ ] 5.2 Extend `app/messaging/schemas.py`:
    - `MessageResponse` (`id`, `body`, `created_at`, `is_mine`, `sender_name`, `sender_is_organizer`);
    - `MessagePage {items, has_more}`;
    - `InboxRowResponse` (the `ConversationResponse` fields without `participant_count`, plus `last_message`);
    - `UnreadCountResponse {count}`;
    - `SendMessageRequest {body: str}` with no Pydantic length constraints;
    - `MarkReadRequest {message_id}`.
  - [ ] 5.3 Create `app/messaging/application/messages.py`:
    - `list_messages`: access, then the cursor validation (400), then the repository page plus batched sender names and the organizer map.
    - `send_message` in the order of spec requirement 18:
      1. access;
      2. read-only check (409);
      3. trim and check 1–1000 characters (`ValueError` with the Polish text);
      4. `check_message` (429);
      5. `check_text(TextField.MESSAGE_BODY)`;
      6. `FOR UPDATE`;
      7. `now = max(utcnow, last_message_at + 1µs)`;
      8. insert the message;
      9. bump the conversation (5a);
      10. upsert the sender's read marker (5b);
      11. `record_message`, then commit.
    - No notification and no outbox event.
  - [ ] 5.4 Create `app/messaging/application/read_markers.py` `mark_read`:
    - it checks access, which is allowed when read-only;
    - a `message_id` from another conversation returns 400;
    - it upserts GREATEST to `message.created_at` and commits.
  - [ ] 5.5 Create `app/messaging/application/inbox.py` with `list_inbox` and `count_unread` in fixed queries:
    1. profile;
    2. audience (3 statements);
    3. one conversations/unread statement (LIMIT 100 for the inbox; SUM with no LIMIT for unread);
    4. `DISTINCT ON` last messages;
    5. batched labels: item refs, group refs, term refs, organizers, profiles.
    - Read-only rows are listed and counted. Titles follow spec requirement 14.
  - [ ] 5.6 Add the routes to `app/messaging/router.py`:
    - put `GET /` and `GET /unread-count` **above** `GET /{id}`, next to the literal POSTs from group 4;
    - add `GET /{id}/messages` (`before`/`after` query params), `POST /{id}/messages` (201) and `POST /{id}/read` (204), each with `Depends(require_any(...))`.
  - [ ] 5.7 Export the new use cases from `app/messaging/service.py`. Check that `ValueError` maps to 400 through the existing handler at `app/core/errors.py:153`, with no `fieldErrors`.
  - [ ] 5.8 Ensure the message, read and inbox tests pass.
    - Run only `tests/test_conversation_messages.py tests/test_conversation_inbox.py tests/test_group_term_conversations.py tests/test_item_conversations.py`.
    - Then run `uv run python -m mypy app/messaging` and `uv run python -m ruff check app/messaging tests/test_conversation_*.py`.

**Acceptance Criteria:**
- The 8 tests pass, and the group 4 tests still pass.
- `count_queries` is identical for 3 and 9 conversations, for both the inbox and the unread count (Success Criterion 8).
- Every route declared after `/{id}` has a non-literal second segment, and `/unread-count` is reachable.
- Commit order equals `(created_at, id)` order through the row lock plus the strictly increasing `created_at`.

### Task Group 6: Frontend Messaging Data Layer (API, hooks, time, errors)
**Dependencies:** None (builds against the spec contract in requirements 14–19 and 28; tests mock `api/conversations`)
**Files to Modify:** `api/conversations.ts` (new), `hooks/useUnreadMessages.ts` (new), `hooks/useConversations.ts` (new), `hooks/useConversation.ts` (new), `hooks/useThread.ts` (new), `hooks/useOpenConversation.ts` (new), `pages/messages/messageTime.ts` (new), `test/messageTime.test.ts` (new), `test/chatErrorMessage.test.ts` (new), `test/useUnreadMessages.test.tsx` (new), `test/useThread.test.tsx` (new)
**Estimated Steps:** 7

- [ ] 6.0 Complete the frontend messaging data layer
  - [ ] 6.1 Write 6-8 focused tests. Use explicit `import { describe, expect, it, vi } from "vitest"`, `createQueryWrapper()` and `vi.mock("../api/conversations", …)`.
    - `messageTime.test.ts`, with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime`:
      - `"2026-10-22T10:00:00"` renders "12:00" (Europe/Warsaw, CEST);
      - `formatInboxTime`: today `HH:mm`, "wczoraj", `ddd` for 2–6 days, `DD.MM` earlier in the same year, `DD.MM.YYYY` in an earlier year;
      - `formatDaySeparator`: "dzisiaj", "wczoraj", `dddd, D MMMM`, and `… YYYY` for an earlier year.
    - `chatErrorMessage.test.ts`: 403 gives "Nie masz dostępu do tego czatu.", 404 gives "Nie znaleziono — mogło zostać usunięte.", a Polish 409/429 passes through, and "Validation failed" becomes the fallback.
    - `useUnreadMessages.test.tsx`: `observers[0].options.refetchInterval === 20_000`, `refetchIntervalInBackground` falsy, and disabled when there is no token. Follow `useItemDetail.test.tsx:150-164`.
    - `useThread.test.tsx`:
      - `refetchInterval === 5_000`;
      - the first load fetches the newest page with no cursor;
      - a poll calls `after=<last id>` and appends, and a duplicate id is dropped;
      - `loadOlder` prepends and updates `hasOlder`;
      - `send` appends the returned message.
  - [ ] 6.2 Create `api/conversations.ts` with:
    - the snake_case types: `ConversationKind`, `ConversationResponse`, `InboxRow`, `MessageResponse`, `MessagePage`, and `read_only_reason: "GROUP_DELETED" | "GROUP_PUBLIC" | null`;
    - functions for all 9 endpoints;
    - `chatErrorMessage(err, fallback)`: 403/404 Polish copy via `hasStatus`, otherwise `serverMessageOr(err, fallback)`. Do not use `extractProblemMessage` (spec requirement 41).
  - [ ] 6.3 Create `pages/messages/messageTime.ts`. It imports `dayjs` only from `utils/dayjs.ts` and exports `parseAuditTime` (`dayjs.utc(x).local()`), `formatBubbleTime`, `formatInboxTime`, `formatDaySeparator` and a local-day key helper for grouping (spec requirement 40).
  - [ ] 6.4 Create `hooks/useUnreadMessages.ts`:
    - key `["unreadMessages", username]`;
    - `enabled: token !== null`;
    - `refetchInterval: 20_000`, `refetchIntervalInBackground: false`.
    - Also create `hooks/useConversations.ts` (key `["conversations", username]`) and `hooks/useConversation.ts`, which returns the app shape plus `notFound` (404/400) and `denied` (403).
    - Use stable module-level empty fallbacks, following `standards/frontend/data-fetching.md`.
  - [ ] 6.5 Create `hooks/useThread.ts` (M7):
    - exactly one `useQuery` with key `["thread", username, id]`, `refetchInterval: 5_000` and `refetchIntervalInBackground: false`;
    - a `queryFn` that does the first load (or empty cache) with no cursor, and otherwise fetches `after=<last id>`, then reads the cache again after the await and merges (dedupe by id, sort by `(created_at, id)`, keep `hasOlder`);
    - a `loadOlder` `useCallback` with a `loadingOlder` state;
    - `send`, which appends and awaits `invalidateQueries(["conversations"])`;
    - `markRead`, which awaits invalidation of `["unreadMessages"]` and `["conversations"]`;
    - no `useInfiniteQuery` and no effect-based fetching.
  - [ ] 6.6 Create `hooks/useOpenConversation.ts`. It exports the `openItemConversation`, `openGroupConversation` and `openTermConversation` `useCallback`s:
    - each awaits `invalidateQueries(["conversations"])` and returns the conversation id;
    - errors are mapped with `chatErrorMessage(err, "Nie udało się otworzyć rozmowy — spróbuj ponownie")`;
    - they do not use `useMutation`.
  - [ ] 6.7 Ensure the data layer tests pass.
    - Run only `npm test -- src/test/messageTime.test.ts src/test/chatErrorMessage.test.ts src/test/useUnreadMessages.test.tsx src/test/useThread.test.tsx`.
    - Then run `npx tsc -b` and `npx eslint` on the new files.

**Acceptance Criteria:**
- The 6-8 tests pass.
- `useThread` uses exactly one query, and its poll merges into the current cache without losing pages loaded by `loadOlder`.
- Every audit timestamp is parsed through `parseAuditTime`, and `term_occurs_on` is never converted.
- All messaging error copy comes through `chatErrorMessage` with the Polish fallbacks.

### Task Group 7: Thread Page UI (ThreadPage, bubble, composer, read-only, view state)
**Dependencies:** 6
**Files to Modify:** `pages/messages/ThreadPage.tsx` (new), `pages/messages/threadViewState.ts` (new), `pages/messages/MessageBubble.tsx` (new), `pages/messages/MessageComposer.tsx` (new), `pages/messages/useThreadReadMarker.ts` (new), `test/threadViewState.test.ts` (new), `test/MessageComposer.test.tsx` (new), `test/ThreadPage.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/mockups/rozmowa-o-rzeczy.html
  element: screen:thread-item
  locator: "line 264, first `.col`: `.thead` (back `.bk`, `.thumb`, `.tt` item name, `.ts` 'Rozmowa z: … · zobacz rzecz') + `.msgs` with `.day` pills; CSS lines 224-229"
  acceptance: "Full-height layout (`h-[calc(100dvh-57px)]`) with no PanelNavBar. Header order: back control, then the fixed 📦 placeholder tile (rounded-12, 40 px), then the item name and 'Rozmowa z: {counterpart_name} · zobacz rzecz' linking to `/product/:id`. A deleted item shows '(usunięte)' and no link. Cream message area. Centered day pills with 'dzisiaj', 'wczoraj' or 'poniedziałek, 20 października'."
- mockup: analysis/design-context/mockups/rozmowa-o-rzeczy.html
  element: component:message-bubble
  locator: "line 264, first `.col` `.msgs`: `.b.me` and `.line > .av + .b.them`; CSS lines 230-236"
  acceptance: "Mine: right-aligned, `bg-primary text-on-primary`, bottom-right radius 6. Theirs: left, `bg-paper border border-line`, bottom-left radius 6. Both use `max-w-[80%] rounded-[18px] whitespace-pre-line break-words`, with an `HH:mm` time from `formatBubbleTime` beneath the text inside the bubble."
- mockup: analysis/design-context/mockups/rozmowa-o-rzeczy.html
  element: component:message-composer
  locator: "line 264, first `.col` `.composer` (default) and second `.col` `.composer` + `p.err[role=alert]` (error variant); CSS lines 237-243"
  acceptance: "Sticky composer on a paper background with a top border. Cream rounded textarea labelled 'Wiadomość', placeholder 'Napisz wiadomość…'; Enter inserts a new line. Primary pill 'Wyślij', disabled when the trimmed text is empty or longer than 1000 characters. A meta row with 'Enter — nowa linia' on the left and 'n / 1000' on the right. A `role=\"alert\"` danger error underneath with copy from `chatErrorMessage(err, 'Nie udało się wysłać — spróbuj ponownie')`, and the text stays in the field."
- mockup: analysis/design-context/mockups/czat-grupy-i-terminu.html
  element: screen:thread-group
  locator: "line 264, first `.col` (group chat: `.thead` with `.av.md.mint` initials, `.tt` '{group} · czat grupy', `.ts` 'N uczestników', `.who` + `.org` chip) and second `.col` (read-only: `.ts` 'Grupa usunięta', `.ro[role=status]` banner in place of the composer); CSS lines 234-235, 244"
  acceptance: "GROUP/TERM header: initials Avatar, then '{group_name} · czat grupy' or '{group_name} · czat terminu'. Second line: 'Grupa usunięta' (GROUP_DELETED), 'Grupa publiczna' (GROUP_PUBLIC) or `plural(participant_count)` 'N uczestników'. Others' messages show the sender name above the bubble, a small initials Avatar, and an 'Organizator' mint-soft chip with `text-primary-fg` when `sender_is_organizer`. Read-only replaces the composer with a `role=\"status\"` stage-colored banner: 'Grupa usunięta — czat jest tylko do odczytu' or 'Grupa jest publiczna — czat jest tylko do odczytu'."
**Estimated Steps:** 7

- [ ] 7.0 Complete the thread page
  - [ ] 7.1 Write 5-7 focused tests.
    - `threadViewState.test.ts`: an `it.each` table covering loading, notFound (404 and 400), denied (403), error, readOnly `GROUP_DELETED`, readOnly `GROUP_PUBLIC`, and ready.
    - `MessageComposer.test.tsx`:
      - the "n / 1000" counter;
      - "Wyślij" disabled when empty, whitespace-only or 1001 characters;
      - `role="alert"` copy for 429 (server Polish text), 403 ("Nie masz dostępu do tego czatu.") and a generic error (fallback);
      - the text is kept after an error.
    - `ThreadPage.test.tsx`:
      - an ITEM header with "Rozmowa z:" and the "zobacz rzecz" link, or "(usunięte)" with no link;
      - a GROUP chat shows the sender name and the "Organizator" chip;
      - readOnly shows the banner and no textarea;
      - notFound shows "Nie znaleziono rozmowy." and denied shows "Nie masz dostępu do tej rozmowy.", each with a link to `/panel/wiadomosci`;
      - the read marker is called with the newest held id.
  - [ ] 7.2 Create `pages/messages/threadViewState.ts`.
    - `resolveThreadView({ conversation, thread })` returns `loading | notFound | denied | error | readOnly{reason} | ready`.
    - `ThreadPage` only `switch`es over `view.kind` (spec requirement 33, `standards/frontend/components.md`).
    - Model it on `pages/term/termViewState.ts`.
  - [ ] 7.3 Create `pages/messages/MessageBubble.tsx` per `component:message-bubble`.
    - It takes props for mine/theirs, body, time, and optionally sender name, initials and organizer flag. Use theme tokens only (no hex).
  - [ ] 7.4 Create `pages/messages/MessageComposer.tsx` per `component:message-composer`.
    - It receives `send` as a prop (the page owns the hooks), keeps the text on error, and clears it only on success.
    - Model the textarea, counter and `role=alert` on `pages/product/ItemFieldEditors.tsx:171-211`, with `aria-describedby` on the error.
  - [ ] 7.5 Create `pages/messages/ThreadPage.tsx`:
    - `useParams` conversation id, `useConversation` and `useThread`;
    - the header per kind; the message list with day separators (`formatDaySeparator`, grouped by the local day key);
    - stick to the bottom when new messages arrive;
    - a "Wcześniejsze wiadomości" button when `hasOlder`;
    - the composer, or the read-only banner;
    - notFound and denied states;
    - `plural` from `utils/plural.ts` for "uczestników".
  - [ ] 7.6 Create `pages/messages/useThreadReadMarker.ts`. In the `ready` and `readOnly` views it calls `markRead(lastId)` whenever the newest held message id changes. It is the only side-effect hook.
  - [ ] 7.7 Ensure the thread tests pass.
    - Run only `npm test -- src/test/threadViewState.test.ts src/test/MessageComposer.test.tsx src/test/ThreadPage.test.tsx`.
    - Then run `npx tsc -b` and `npx eslint src/pages/messages`.

**Acceptance Criteria:**
- The 5-7 tests pass.
- The implementation matches every `acceptance` criterion for `screen:thread-item`, `screen:thread-group`, `component:message-bubble` and `component:message-composer`, with the verbatim Polish copy.
- The new files contain no hex colors, and the mockups' `#12604D` is `text-primary-fg`.
- The composer and the bubbles are keyboard-reachable; the textarea is labelled and the error is announced.

### Task Group 8: Inbox, Top-Bar Messages Button & Routes
**Dependencies:** 6, 7
**Files to Modify:** `components/shared/MessagesButton.tsx` (new), `components/layout/PublicLayout.tsx`, `pages/messages/InboxPage.tsx` (new), `router.tsx`, `test/MessagesButton.test.tsx` (new), `test/InboxPage.test.tsx` (new), `test/PublicLayout.test.tsx`, `test/themeTokenUsage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html
  element: screen:topbar-inbox-icon
  locator: "line 264, first `.col` `.topbar .icons` (💬 `button.ib.inbox` before the 🔔 button) and second `.col` (the '9+' variant); CSS lines 203-205"
  acceptance: "A 40 px round 💬 link to `/panel/wiadomosci`, placed immediately before NotificationBell in the PublicLayout top bar. `aria-label` is 'Wiadomości (N nieprzeczytane)', or 'Wiadomości' at 0. The active (current-route) state uses the mint-soft background."
- mockup: analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html
  element: component:inbox-badge
  locator: "line 264, `.ib.inbox > .badge` in both `.col`s; CSS line 205"
  acceptance: "Reuses the NotificationBell badge classes (`components/shared/NotificationBell.tsx`): it shows the count, shows '9+' above 9, and is not rendered at 0."
- mockup: analysis/design-context/mockups/skrzynka-wiadomo-ci.html
  element: screen:inbox
  locator: "line 264, first `.col` `.scroll` (‹ Wróć, h2 'Wiadomości', four `.row`s with `.av`, `.chip`, `time`, `.p` preview and `.count`) and second `.col` (`.empty` dashed card and the `.sk` skeleton row); CSS lines 213-222, 262"
  acceptance: "PhoneFrame with PanelNavBar and no active tab, and the heading 'Wiadomości'. Each row, newest first: the leading visual (ITEM 📦 placeholder on accent-soft, GROUP initials Avatar on mint-soft, TERM 📅); the kind chip 'Rzecz' (accent-soft), 'Grupa' (mint-soft with `text-primary-fg`) or 'Termin' (teal-soft) before the server `title`; the time from `formatInboxTime` on the right; a one-line ellipsized preview prefixed 'Ty:', 'Organizator:' or '{sender_name}:'. Unread rows are bold with a mint count pill. Read-only chats stay listed. Empty state: a dashed card reading 'Nie masz jeszcze rozmów. Zapytaj o rzecz na jej stronie albo napisz na czacie swojej grupy lub terminu.' Loading: a skeleton row. Error: an inline error with a retry. Rows link to `/panel/wiadomosci/:id`."
**Estimated Steps:** 7

- [ ] 8.0 Complete the inbox, the top-bar button and the routes
  - [ ] 8.1 Write 5-7 focused tests.
    - `MessagesButton.test.tsx`: it shows a badge for 3, "9+" for 12, and no badge at 0; the `aria-label` text in each case; it links to `/panel/wiadomosci`.
    - `InboxPage.test.tsx`:
      - rows render the chip, the title, the "Ty:" / "Organizator:" / name preview prefixes and bold unread with a count;
      - the empty-state copy;
      - the skeleton while loading;
      - the error with a retry.
    - A routing test: `/panel/wiadomosci` renders InboxPage, not PanelPage, and `/panel/wiadomosci/:id` renders ThreadPage.
    - `test/PublicLayout.test.tsx`: add `vi.mock("../api/conversations", …)` (L9) and assert the 💬 link renders before the bell.
  - [ ] 8.2 Create `components/shared/MessagesButton.tsx`.
    - It uses `useUnreadMessages` and copies the badge classes from `NotificationBell.tsx`.
    - It renders a router `Link` with the `aria-label` rules, and only when logged in, matching NotificationBell's gating.
  - [ ] 8.3 Insert `<MessagesButton />` before `NotificationBell` in `components/layout/PublicLayout.tsx` (:35,42).
  - [ ] 8.4 Create `pages/messages/InboxPage.tsx`:
    - `PhoneFrame` + `PanelNavBar` (no active tab), a back link and the "Wiadomości" heading;
    - rows from `useConversations` per `screen:inbox`, with `formatInboxTime` and `Avatar` initials for GROUP;
    - the skeleton, empty and error states. Errors use `chatErrorMessage(err, "Nie udało się wczytać wiadomości")`.
  - [ ] 8.5 Register `/panel/wiadomosci` (InboxPage) and `/panel/wiadomosci/:conversationId` (ThreadPage) in `router.tsx`, under `PublicLayout` inside `AuthGuard` next to `/panel/terminy/:termId`. They must sit before any `/panel/*` catch-all.
  - [ ] 8.6 Add `components/shared/MessagesButton.tsx`, `pages/messages/InboxPage.tsx`, `ThreadPage.tsx`, `MessageBubble.tsx` and `MessageComposer.tsx` to `NO_HEX_FILES` in `test/themeTokenUsage.test.tsx` (:57). Do not extend `themeDefects.test.tsx` `IN_SCOPE_FILES` (spec requirement 42).
  - [ ] 8.7 Ensure the inbox and top-bar tests pass.
    - Run only `npm test -- src/test/MessagesButton.test.tsx src/test/InboxPage.test.tsx src/test/PublicLayout.test.tsx src/test/themeTokenUsage.test.tsx`.
    - Then run `npx tsc -b` and `npx eslint` on the touched files.

**Acceptance Criteria:**
- The 5-7 tests pass, and `themeTokenUsage` passes with the 5 new files listed.
- The implementation matches every `acceptance` criterion for `screen:topbar-inbox-icon`, `component:inbox-badge` and `screen:inbox`, with the verbatim Polish copy.
- `PublicLayout.test.tsx` passes with the conversations mock.
- Both routes are reachable only when logged in (AuthGuard).

### Task Group 9: Chat Entry Points (item page, term page, group details, term attendees)
**Dependencies:** 2, 6
**Files to Modify:** `pages/product/ItemDetailPage.tsx`, `api/groups.ts`, `pages/term/termViewState.ts`, `pages/term/views/PublicTermView.tsx`, `pages/term/TermPage.tsx`, `pages/panel/GroupDetailsPage.tsx`, `pages/panel/TermAttendeesPage.tsx`, `test/ItemDetailPage.test.tsx`, `test/termViewState.test.ts`, `test/TermPage.test.tsx`, `test/GroupDetailsPage.test.tsx`, `test/TermAttendeesPage.test.tsx`, `test/useTermAccess.test.ts`
**Visual References:**
- mockup: analysis/design-context/mockups/zapytaj-o-rzecz-na-stronie-rzeczy.html
  element: screen:item-ask-button
  locator: "line 264, first `.col` (`.statuscard` followed by `button.pill.ask` '💬 Zapytaj o rzecz') and second `.col` (own item: no button); CSS lines 249-250"
  acceptance: "The '💬 Zapytaj o rzecz' outlined pill (min-height 40, `border-line`, paper) sits directly under ItemStatusCard. It shows only when `!item.is_owner && !deleted`. Clicking it calls `openItemConversation` and navigates to `/panel/wiadomosci/{id}`, and an error appears inline under the pill. No `mint`/`lime` utilities (the file is in NO_LEGACY_UTILITY_FILES)."
- mockup: analysis/design-context/mockups/przyciski-czatu-na-stronie-terminu.html
  element: screen:term-chat-buttons
  locator: "line 264, first `.col` `.chatrow` (two `.chatbtn`s: '💬 Czat terminu', '👥 Czat grupy') and second `.col` `.chatrow` (only 'Czat terminu', PUBLIC group); CSS lines 255-256"
  acceptance: "A row of equal-width pill buttons (`paper`/`line`, min-height 44) between the term card and the attendees card. '💬 Czat terminu' shows when `isLoggedIn && (isActiveAttendee || isOrganizer)`. '👥 Czat grupy' shows when `isLoggedIn && group.visibility === 'PRIVATE' && (isMember || isOrganizer)`. Neither shows for an anonymous guest or a withdrawn attendee. No `mint`/`lime` utilities."
- mockup: analysis/design-context/mockups/wej-cia-organizatora.html
  element: screen:organizer-entry
  locator: "line 264, first `.col` (`section.card` 'Czat grupy' above `section.card` 'Kod dostępu') and second `.col` (`.termhead` with `button.p-primary` '💬 Napisz do uczestników'); CSS lines 245-248, 261"
  acceptance: "GroupDetailsPage: a JoinCodeCard-style card with the serif heading 'Czat grupy', the lead 'Napisz do wszystkich członków grupy.' and a full-width primary button '💬 Otwórz czat grupy', placed above the join-code card. It shows when `isPrivate && joinCode.status === 'ready'`. TermAttendeesPage: inside TermHeadCard, under the date line, a full-width primary button '💬 Napisz do uczestników' that opens the term chat. Errors appear inline."
**Estimated Steps:** 8

- [ ] 9.0 Complete the chat entry points
  - [ ] 9.1 Write 6-8 focused tests.
    - `ItemDetailPage.test.tsx`: "Zapytaj o rzecz" is shown for a non-owner and hidden for the owner and for a deleted item; clicking it calls `openItemConversation` and navigates.
    - `termViewState.test.ts`: `content` carries `isOrganizer`, `isMember` and `isActiveAttendee` from `access`, never from `guest.isAttending`.
    - `TermPage.test.tsx`, as a matrix:
      - a PRIVATE member attendee sees both buttons;
      - a PUBLIC attendee sees only "Czat terminu";
      - a withdrawn attendee who is not a member sees neither;
      - the organizer sees both (PRIVATE);
      - an anonymous guest sees none.
    - `GroupDetailsPage.test.tsx`: the "Czat grupy" card is shown for the organizer of a PRIVATE group with `joinCode.status === "ready"` and absent otherwise.
    - `TermAttendeesPage.test.tsx`: "💬 Napisz do uczestników" calls `openTermConversation` with the term id.
    - Update the `access` fixtures in `useTermAccess.test.ts`, `TermPage.test.tsx` and `termViewState.test.ts` to include `is_active_attendee`.
  - [ ] 9.2 Add `is_active_attendee: boolean` to `GroupAccessDetails` in `api/groups.ts` (:263-267). It mirrors the backend field from group 2.
  - [ ] 9.3 Extend `pages/term/termViewState.ts`: `content` gains `isOrganizer`, `isMember` and `isActiveAttendee`, read from `access.is_organizer`, `access.is_member` and `access.is_active_attendee`. Keep `isAttending` unchanged for `TermFooter`.
  - [ ] 9.4 Render the chat row in `pages/term/views/PublicTermView.tsx`, gated as in spec requirement 35.
    - The buttons call `openTermConversation` / `openGroupConversation` and navigate.
    - Thread `isLoggedIn` and the callbacks from `pages/term/TermPage.tsx` as props (the page owns the hooks).
    - Use only `paper`/`line` tokens; no `mint`/`lime`.
  - [ ] 9.5 Add the "💬 Zapytaj o rzecz" pill under `ItemStatusCard` (:153) in `ItemViewContent` (`pages/product/ItemDetailPage.tsx`) with an inline error. Use no `mint`/`lime` utilities.
  - [ ] 9.6 Add a `messageGroupCard` slot to `pages/panel/GroupDetailsPage.tsx`.
    - It is a JoinCodeCard-style card that reads "Czat grupy / Napisz do wszystkich członków grupy. / 💬 Otwórz czat grupy".
    - It sits above the join-code card and shows when `isPrivate && joinCode.status === "ready"`.
  - [ ] 9.7 Add a "💬 Napisz do uczestników" button to `TermHeadCard` (`pages/panel/TermAttendeesPage.tsx:127`). It calls `openTermConversation` and navigates, with an inline error.
  - [ ] 9.8 Ensure the entry-point tests pass.
    - Run only `npm test -- src/test/ItemDetailPage.test.tsx src/test/termViewState.test.ts src/test/TermPage.test.tsx src/test/GroupDetailsPage.test.tsx src/test/TermAttendeesPage.test.tsx src/test/useTermAccess.test.ts src/test/themeTokenUsage.test.tsx`.
    - The known TermPage sign-up-footer failure is pre-existing; ignore it.
    - Then run `npx tsc -b` and `npx eslint` on the touched files.

**Acceptance Criteria:**
- The 6-8 tests pass (pre-existing known failures excepted).
- The implementation matches every `acceptance` criterion for `screen:item-ask-button`, `screen:term-chat-buttons` and `screen:organizer-entry`.
- `themeTokenUsage` still passes: `PublicTermView.tsx` and `ItemDetailPage.tsx` use no `mint` or `lime` utilities.
- The gating uses only server flags plus `isLoggedIn`, never `guest.isAttending`.

### Task Group 10: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9
**Files to Modify:** `tests/test_conversation_messages.py`, `tests/test_conversation_inbox.py`, `tests/test_group_term_conversations.py`, `tests/test_item_conversations.py`, `test/useThread.test.tsx`, `test/ThreadPage.test.tsx`, `test/InboxPage.test.tsx` (append-only; add a new file only if a gap has no natural home)
**Estimated Steps:** 6

- [ ] 10.0 Review the tests and fill critical gaps
  - [ ] 10.1 Review the tests from groups 1–9 (about 50–64) against Success Criteria 1–17 and the Testing Approach in spec.md. List any criterion that has no test.
  - [ ] 10.2 Check the contract: compare the `api/conversations.ts` types and field names with `app/messaging/schemas.py` (inbox row, conversation, message, page, unread count, `read_only_reason` values). Fix any mismatch at its source.
  - [ ] 10.3 Analyze the gaps for this feature only. Likely candidates:
    - the get-or-create race loser (a forced `IntegrityError` path);
    - a TERM title format ("Termin: śr 29.10 17:00");
    - a `useThread` poll running concurrently with `loadOlder`;
    - an InboxPage read-only row still listed;
    - a ThreadPage "Grupa publiczna" header line.
  - [ ] 10.4 Write up to 10 additional strategic tests for the gaps found.
  - [ ] 10.5 Run all the feature tests:
    - backend, from `src/backend`: `uv run python -m pytest tests/test_messaging_migration.py tests/test_messaging_cross_context.py tests/test_group_access.py tests/test_message_send_limiter.py tests/test_messaging_repository.py tests/test_item_conversations.py tests/test_group_term_conversations.py tests/test_conversation_messages.py tests/test_conversation_inbox.py tests/test_authorization_matrix.py`;
    - frontend: every new or touched test file from groups 6–9.
  - [ ] 10.6 Run the static checks on the touched code:
    - `uv run python -m mypy app` (must stay at or below the 23-error baseline);
    - `uv run python -m ruff check` on the new and changed backend files;
    - `npx tsc -b`;
    - `npx eslint` on the new and changed frontend files.
    - Do not fix pre-existing project-wide lint or ruff debt.

**Acceptance Criteria:**
- All feature tests pass (~50–74 in total), except the documented pre-existing frontend failures.
- No more than 10 tests are added in this group.
- mypy reports no new errors against the 23-error baseline; tsc is clean; eslint and ruff report no new findings in the touched files.

## Execution Order

1. Group 1: Database Layer (6 steps)
2. Group 2: Cross-Context Public Functions (8 steps)
3. Group 6: Frontend Messaging Data Layer (7 steps)
4. Group 3: Messaging Core (8 steps, depends on 1 and 2)
5. Group 7: Thread Page UI (7 steps, depends on 6)
6. Group 9: Chat Entry Points (8 steps, depends on 2 and 6)
7. Group 4: Conversation API (8 steps, depends on 3)
8. Group 8: Inbox, Top-Bar Button & Routes (7 steps, depends on 6 and 7)
9. Group 5: Messages, Read Markers & Inbox API (8 steps, depends on 4)
10. Group 10: Test Review & Gap Analysis (6 steps, depends on all)

Dependency graph:
```
1 ─┐
   ├─> 3 ─> 4 ─> 5 ─┐
2 ─┤                │
   └────────> 9 ────┤
6 ─┬────────> 9     ├─> 10
   └─> 7 ─> 8 ──────┘
```

Shared-file ownership: each of these files is edited by exactly one group, or by groups ordered through a dependency.
- `app/messaging/router.py`, `schemas.py`, `service.py` and `tests/test_group_term_conversations.py`: groups 4 → 5.
- Group 10 appends only to test files after all the other groups are done.
- Single owner: `app/main.py` and `authorization_matrix.py` (group 4); `tests/conftest.py` (group 3); `router.tsx`, `PublicLayout.tsx` and `themeTokenUsage.test.tsx` (group 8); `termViewState.ts` and `api/groups.ts` (group 9).

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`:
  - `minimal-implementation.md`: no participant table, no `subtitle`, no thumbnail pipeline, no bell kinds;
  - `validation.md` and `error-handling.md`: server-side trim and length checks, typed exceptions, Polish copy;
  - `conventions.md`, `coding-style.md`, `commenting.md`.
- `backend/`:
  - `models.md`: `BaseEntity`, no `relationship()`, FK id columns, ACL modules, 404 before 403;
  - `migrations.md`: 0061 naming, partial unique indexes, reverse downgrade, round-trip test;
  - `queries.md` and `jooq.md`: bound parameters, fixed query count, explicit ordering, SQL LIMIT;
  - `security.md`: matrix rows plus `Depends(require_any(...))` and the matrix test;
  - `time.md`: naive-UTC audit timestamps; `occurs_on` formatted with `clock.format_term_day`, never compared;
  - `api.md`.
- `frontend/`:
  - `data-fetching.md`: hooks wrap `api/`, one thread query merged with `setQueryData`, prefix invalidation, username in keys, dayjs from `utils/dayjs.ts`;
  - `components.md`: one view state, pages own the hooks;
  - `accessibility.md`: labelled textarea, `role="alert"`, badge `aria-label`, keyboard reachability;
  - `css.md` and `responsive.md`: tokens only, mobile-first, `dvh`.
- `testing/`:
  - `backend-testing.md`: flat `tests/test_<feature>.py`, `client`/`db_session`, `count_queries`, exact key sets;
  - `frontend-testing.md`: explicit vitest imports, `createQueryWrapper`, `vi.mock` API modules, fake timers with `toFake: ["Date"]`.

## Notes

- **Test-driven:** each group starts with 2-8 focused tests.
- **Run incrementally:** after each group, run only that group's new tests, never the full ~7–8 minute backend suite.
- **Mark progress:** check off steps as they are completed.
- **Reuse first:**
  - `join_code_limiter.py`, `locations_acl.py`, `0057_locations.py`;
  - `NotificationBell.tsx`, `JoinCodeCard.tsx`, `ItemFieldEditors.tsx`, `termViewState.ts`;
  - `serverMessageOr`, `utils/dayjs.ts`, `utils/plural.ts`, `Avatar`, `PhoneFrame`, `PanelNavBar`.
- **Secrets:** never print secret values or dump env or `.env` while running tests or checks.
- **No git operations** are part of this plan.
