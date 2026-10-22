# Code Review Report

**Date**: 2026-10-22
**Path**: working tree vs HEAD (`feat/private-group-join-by-code`). Covers `src/backend/app/messaging/**`, `alembic/versions/0061_messaging.py`, `app/groups/application/chat_audience.py`, the modified groups/circulation/users/core files, and the frontend api, hooks, pages and entry points.
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issues. Authorization holds on all 9 endpoints: 404 comes before 403, cursor and mark-read ids are scoped to their conversation (400), and the inbox audience matches `resolve_access`.
- The `FOR UPDATE` + monotonic `created_at` send path, the GREATEST read markers and the savepoint get-or-create are correct. Message bodies render as React text, so there is no XSS.
- Main warnings: (1) `POST /item` reveals the owner's display name without sending a message, so names can be enumerated; (2) the inbox's `DISTINCT ON` last-message query reads every message of up to 100 conversations; (3) `useThread`'s no-cursor path overwrites the cache and can briefly drop a just-sent message; (4) the send path holds an open DB transaction during moderation inference.
- Quality: the read-only rule and the TERM title are duplicated in `access.py`/`conversations.py` and `inbox.py`; the open-and-navigate flow is copied 4 times on the frontend.

## Open Questions / Risks
1. **Owner name before any message (W1).** gap-analysis decided "owner name in the thread only". But opening a thread needs no message and the owner never sees an empty thread. Any logged-in user can therefore map item to owner name for 20 items/hour per worker (re-opens are free). Is this enumeration accepted, or should `counterpart_name` stay hidden (or read "Właściciel") until the first message exists?
2. **Moderation inside an open transaction (W4).** Moderation latency is accepted, but holding a pooled connection idle-in-transaction during `asyncio.to_thread(classifier.scores)` is a separate pool-pressure risk. Messaging is the highest-volume moderated field.
3. **`mcp:read` / `mcp:edit` scopes reach private DMs (I10).** This follows the notifications rows. Confirm that third-party OAuth clients should be able to read and send private messages.
4. Thread polling costs about 10 statements per open thread every 5 s (W7). Fine at current scale, but worth watching.

## Summary
- **Critical**: 0 issues
- **Warnings**: 7 issues
- **Info**: 14 issues

## Verified correct (focus areas)
- **IDOR / authz**
  - `GET/POST /{id}*` all go through `load_accessible` or `get_conversation` → `resolve_access` (`application/access.py:72-87`, `application/messages.py:39-47`).
  - ITEM access is limited to the asker and the original owner.
  - GROUP access requires the active organizer or an active member.
  - TERM access requires the active organizer or a non-withdrawn attendee.
  - Cursor and mark-read anchors are filtered by `conversation_id` (`infrastructure/repository.py:77-85`), so a foreign id gets 400. Tests at `tests/test_conversation_messages.py:192-212`.
- **Matrix**
  - `authorization_matrix.py:211-212`: GET → READ/mcp:read, POST → EDIT/mcp:edit.
  - Routes enforce them via `ReadPrincipal`/`EditPrincipal` (`router.py:33-34`).
  - No earlier row shadows `/api/conversations`.
- **Inbox audience consistency**
  - `_audience_filter` (`repository.py:193-218`) mirrors `resolve_access`:
    - ITEM: asker or owner;
    - GROUP: led or member groups;
    - TERM: attended terms, or led groups via `conversations.group_id = term.circle_group_id`.
  - Soft-deleted Circles are included on both sides.
- **Send ordering**
  - `lock_conversation_for_send` uses `SELECT … FOR UPDATE`, which re-reads `last_message_at` after the previous holder commits (READ COMMITTED). `created_at = max(utcnow, last+1µs)`.
  - Commit order therefore equals `(created_at, id)` order. Moderation runs before the lock, so the lock is never held across inference.
- **Read markers**: `ON CONFLICT … SET last_read_at = GREATEST(existing, excluded)` (`repository.py:167-190`). Marks never move backwards.
- **Savepoint get-or-create**: `begin_nested` + flush. On `IntegrityError`, the code re-selects the winner and returns `created=False`, so the limiter does not record (`conversations.py:128-144`). Re-raises if no winner exists (e.g. an FK violation).
- **Read-only / soft-delete**: `GROUP_DELETED` takes precedence over `GROUP_PUBLIC` (PUBLIC applies to GROUP only). Send gets 409; read, paging and mark-read still work. A deleted item's thread stays writable. All of this matches spec requirements 9, 10, 12 and 13.
- **Cursor tie-break**: tuple comparison `(created_at, id)` with matching `ORDER BY`. The `before` path reverses the DESC page. The client `mergeMessages` sorts by `(created_at, id)`, and lexicographic order of ISO fraction strings is chronological.
- **XSS**: `MessageBubble.tsx:67` and `InboxPage.tsx:108` render `body` as JSX text, with no `dangerouslySetInnerHTML` anywhere in the feature.
- **Polling / cleanup**
  - Polling uses React Query `refetchInterval` (20 s unread, 5 s thread) with `refetchIntervalInBackground: false`. There are no hand-rolled timers to leak.
  - Unread polling is disabled when logged out, and the username is in every key.
- **N+1**
  - The inbox has a fixed statement count: profile, 3 audience, rows, last messages, item refs, group refs, term refs, organizers, profiles.
  - Message pages use one batched names lookup.

## Critical Issues
None.

## Warnings

### W1. Owner identity disclosed by `POST /api/conversations/item` without any message (security / privacy)
- **Location**: `src/backend/app/messaging/application/conversations.py:40-69` (via `_to_response`, `conversations.py:167-183`)
- **Description**: Opening an ITEM conversation creates the row and returns `counterpart_name` (the owner's display name) right away. The item API hides owner identity (codebase-analysis.md:199). The owner never sees the empty thread, because the inbox filters `last_message_at IS NOT NULL`.
- **Risk**: Any logged-in user can collect owner names item by item: 20 new threads/hour per party per worker, unlimited re-opens, and the owner is never notified.
- **Recommendation**: Return `counterpart_name = null` (UI: "Właściciel") for an ITEM thread with no messages, or until the owner has sent one. Alternatively, create the ITEM row lazily on the first send. Needs a product decision (see Open Questions).
- **Fixable**: false (decision needed)

### W2. Inbox last-message query scans every message of up to 100 conversations (performance)
- **Location**: `src/backend/app/messaging/infrastructure/repository.py:299-312` (`last_messages_for`)
- **Description**: `SELECT DISTINCT ON (conversation_id) … WHERE conversation_id IN (…100 ids) ORDER BY conversation_id, created_at DESC, id DESC`. Postgres has no skip-scan here, so it reads (or sorts) every message row of those conversations to keep the first of each. Cost grows with total chat history, not with 100.
- **Recommendation**: `last_message_at` is set exactly to the newest message's `created_at`, and `created_at` is strictly unique per conversation. So join `Message ON conversation_id = c.id AND created_at = c.last_message_at`, which is one index probe per conversation on `ix_messages_conversation_id_created_at_id`. A `LATERAL (… ORDER BY created_at DESC, id DESC LIMIT 1)` also works. The join can even be folded into `select_inbox_rows`.
- **Fixable**: true

### W3. `useThread` no-cursor path replaces the cache instead of merging (correctness, cache race)
- **Location**: `src/frontend/src/hooks/useThread.ts:64-66`
- **Description**: When the cache is empty, or the thread has no messages yet, every poll takes the "newest page" branch and returns `page.items` as-is. If the user sends the first message of a thread while that poll is in flight, `send()` writes the message into the cache. The poll then resolves with a page fetched before the send committed and overwrites the cache, so the sent message disappears until the next 5 s poll. The `after=` branch (`:68-70`) already merges correctly against the post-request cache.
- **Recommendation**: In the no-cursor branch, also read `getQueryData(key)` after the await and return `mergeMessages(current?.items ?? [], page.items)` with `hasOlder: page.has_more`.
- **Fixable**: true

### W4. Send holds an open transaction and pooled connection across moderation inference (performance / resilience)
- **Location**: `src/backend/app/messaging/application/messages.py:84-100`
- **Description**: `load_accessible` runs SELECTs, which autobegin a transaction. Then `await check_text(...)` runs the classifier in a thread before the lock and insert. During inference the connection sits idle in transaction. At 30 messages/min per user this is the busiest moderated write and can exhaust the pool under load. Other moderated paths (`groups/application/circles.py:247`) share the pattern, but with far lower volume.
- **Recommendation**: End the read transaction before moderation (`await db.commit()` after the access and validation checks, or run them in a short read-only block), then re-open for the lock/insert/commit. Re-checking read-only under the lock would also close the small window where a group is deleted mid-send.
- **Fixable**: true

### W5. Read-only rule and TERM title duplicated between `GET /{id}` and the inbox (quality)
- **Location**:
  - read-only: `src/backend/app/messaging/application/access.py:26-31` vs `src/backend/app/messaging/application/inbox.py:102-108`;
  - title: `src/backend/app/messaging/application/conversations.py:194` vs `inbox.py:113`.
- **Description**: The precedence (DELETED > PUBLIC, PUBLIC only for GROUP) and the `"Termin: {format_term_day} {HH:MM}"` format are implemented twice. Spec requirement 14 requires them to match. They match today, but nothing enforces it.
- **Recommendation**: Make `_read_only_reason(kind, deleted_at, visibility)` take plain values and call it from both places. Add a `term_title(occurs_on)` helper (for example in `access.py` or a small `labels.py`).
- **Fixable**: true

### W6. Open-and-navigate flow copied in four components (quality)
- **Location**:
  - `src/frontend/src/pages/panel/GroupDetailsPage.tsx:161-171`
  - `src/frontend/src/pages/panel/TermAttendeesPage.tsx:137-147`
  - `src/frontend/src/pages/product/ItemDetailPage.tsx:183-193`
  - `src/frontend/src/pages/term/views/PublicTermView.tsx:294-304`
- **Description**: Each copy has the same `busy`/`error` state, `navigate('/panel/wiadomosci/' + id)`, and the same fallback string literal, which also lives as `OPEN_FALLBACK` in `useOpenConversation.ts`.
- **Recommendation**: Have `useOpenConversation` (or a small `useOpenAndNavigate(call)`) return `{ open, busy, error }` and do the navigation. Each site then only renders a button and the error text. Remove the duplicated fallback literal (the hook already rejects with Polish copy).
- **Fixable**: true

### W7. Per-poll cost of the thread (performance)
- **Location**: `src/frontend/src/hooks/useThread.ts:72-73`; backend path `application/messages.py:39-47,59-78`, `application/access.py:39-52,34-36`
- **Description**: Each 5 s `after=` poll runs about 9-10 statements:
  - user and profile;
  - the conversation;
  - the group;
  - leadership plus role (organizer check);
  - membership;
  - organizer again (`_organizer_party_id` repeats the leadership lookup that `is_active_group_organizer` just did);
  - the anchor and the page.

  Every new message also triggers a mark-read POST with another full access check, plus invalidation and a refetch of the unread count (5 more statements).
- **Recommendation**:
  - Have `is_active_group_organizer` return or reuse the organizer party id, which drops one query.
  - Consider returning `last_message_id` from `GET /{id}`, or a cheap HEAD-style check, if scale grows.
  - Skip the mark-read POST when the newest message `is_mine` (the send already upserted the marker; see I13).
- **Fixable**: true

## Informational

- **I1 Unread count needs heap fetches** — `repository.py:221-236,266-296`. The unread join filters `sender_party_id <> me`, which is not in `ix_messages_conversation_id_created_at_id`, so every candidate row is a heap visit. This runs every 20 s per logged-in user. Suggestion: a covering index `(conversation_id, created_at) INCLUDE (sender_party_id)` (or adding it to the existing index) enables index-only scans. Fixable: true.
- **I2 Audience materialised as IN lists** — `groups/application/chat_audience.py:160-165`, `repository.py:193-218`. Three round trips per inbox/unread call. `attended_term_ids` grows forever because past terms stay included. Suggestion: inline the three selects as subqueries in `_audience_filter` (one statement, no bind-parameter explosion). Fixable: true.
- **I3 `after=` poll ignores `has_more`** — `useThread.ts:68-70`. After a long hidden-tab period, the thread catches up 50 messages per 5 s, and `useThreadReadMarker` marks the partial tail read in the meantime. No data is lost. Suggestion: immediately re-poll (or loop) while `has_more`. Fixable: true.
- **I4 Limiter check/record not atomic within one worker** — `application/messages.py:90-98`, `send_limiter.py:31-36`. `check_message` and `record_message` straddle the moderation and DB awaits, so concurrent bursts from one party in one worker can exceed 30/min. This is not the accepted "per-worker" risk; it happens inside a worker. Suggestion: reserve the slot in `check` and release it on failure. Fixable: true.
- **I5 No CHECK constraints on kind-specific columns** — `alembic/versions/0061_messaging.py:47-73`. Nothing prevents an ITEM row with NULL `asker_party_id`. NULLs would also silently defeat `uq_conversations_item_id_asker_party_id_owner_party_id`. Suggestion: add `ck_conversations_kind_columns`. Fixable: true.
- **I6 Matrix rows unnumbered** — `app/core/authorization_matrix.py:208-212`. Every other row carries a `# N` index comment, and the next block is still labelled "53-54". Suggestion: number them and renumber the following comments, or note "unnumbered" consistently. Fixable: true.
- **I7 `SendMessageRequest.body` unbounded at the schema** — `app/messaging/schemas.py:91-95`. Intentional (spec M5, Polish 400), but a multi-MB body is parsed and stripped before rejection. Suggestion: a generous Pydantic `max_length` (e.g. 10 000) still leaves the 1-1000 Polish message to the service. Fixable: true.
- **I8 Group-chat card gated by the join-code fetch** — `src/frontend/src/pages/panel/GroupDetailsPage.tsx:52`. `joinCode.status === "ready"` stands in for "organizer". A failed or regenerating join-code fetch hides the chat entry point. Suggestion: gate on an explicit organizer flag if one is available. Fixable: true.
- **I9 Read-only copy duplicated across tiers** — `ThreadPage.tsx:19-27` vs `application/messages.py:28-31`. The spec fixes the copy, so this is acceptable. Mention only.
- **I10 OAuth `mcp:*` scopes reach DMs** — `router.py:33-34`, `authorization_matrix.py:211-212`. Consistent with notifications; confirm intent (Open Question 3).
- **I11 `assert` used for invariants in request paths** — `access.py:82,85`, `conversations.py:107,168,181`, `inbox.py:92,99,111`. `python -O` strips these. Suggestion: narrow types with explicit checks, or accept as typing aids. Fixable: true.
- **I12 `is_active_attendee` loads every attendance row** — `app/groups/application/public_view.py:387-396`. This runs on every term-page access call. Suggestion: an `EXISTS` (like `has_active_membership`). Fixable: true.
- **I13 Redundant mark-read after own send, and marking while scrolled up** — `src/frontend/src/pages/messages/useThreadReadMarker.ts:14-21`. When the newest message `is_mine`, the server already upserted the marker. Messages that arrive while the reader is scrolled up are marked read unseen (a UX choice). Fixable: true.
- **I14 Magic header height** — `ThreadPage.tsx:80` `h-[calc(100dvh-57px)]` couples the page to the top-bar height. Suggestion: a CSS variable/token or a flex layout. Fixable: true.

## Standards compliance notes
- `models.md`: no `relationship()`, plain FK ids, `BaseEntity`, string-backed enum, and ACL modules for groups, circulation and users. Compliant. `app.moderation.text_guard` is imported directly from `application/messages.py`, as other contexts do.
- `migrations.md`: explicit `pk_`/`fk_`/`ix_`/`uq_` names, partial unique indexes, reverse-order downgrade, and a round-trip test (`tests/test_messaging_migration.py`). Compliant.
- `queries.md`: bind parameters throughout, explicit ordering, SQL-level LIMIT, no N+1. W2 and I1 are optimisation gaps, not violations.
- `data-fetching.md`:
  - hooks in `src/hooks/`, prefix-constant keys, and the module-level empty fallback all comply;
  - `loading = isPending`, `error: string | null` and `refetch(): Promise<void>` comply;
  - dayjs comes from `utils/dayjs`;
  - mutations await `invalidateQueries` on the resource prefix.
- `accessibility.md`: `role="log"`, `role="alert"` errors, sr-only spacing outside the hidden span (`MessageBubble.tsx`, `InboxPage.tsx:112-113`). Compliant.
- `time.md`: audit times use `datetime.utcnow()`, TERM titles use `clock.format_term_day`, and the frontend parses audit times with `dayjs.utc().local()`. Compliant.

## Metrics
- Max function length: ~55 lines (`conversations.py` `_to_response`, 53 lines; `ThreadPage.tsx` `ThreadHeader`, ~56 lines)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 1 privacy/enumeration (W1); 0 injection or XSS
- N+1 query risks: 0 (W2 is a scan-cost issue, not N+1)
- Files analysed: ~45 (backend 22, frontend 23, excluding tests read selectively)

## Prioritized Recommendations
1. Decide W1: hide `counterpart_name` until the first message, or create ITEM threads lazily.
2. Rewrite `last_messages_for` as an equality join on `last_message_at` (W2) and add the covering index for the unread aggregate (I1).
3. Merge instead of replace in `useThread`'s no-cursor path (W3).
4. End the read transaction before `check_text` in `send_message` (W4).
5. Extract `_read_only_reason`/`term_title` (W5) and a shared open-and-navigate hook (W6).
6. Reduce per-poll statements: reuse the organizer id, and skip mark-read for own messages (W7, I13).
7. Hygiene: CHECK constraints (I5), matrix numbering (I6), the `is_active_attendee` EXISTS (I12), and limiter slot reservation (I4).
