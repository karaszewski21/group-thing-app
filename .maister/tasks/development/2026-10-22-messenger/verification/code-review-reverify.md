# Code Review Re-verification: Fix Cycle 1

**Date**: 2026-10-22
**Path**: working tree on `feat/private-group-join-by-code` (uncommitted; messaging files untracked)
**Scope**: a focused re-check of the 11 fixes listed in `implementation-verification.md`, plus any regressions they caused
**Status**: Resolved. No critical issues; 1 low warning and 6 info items are new.

## TL;DR

- All 11 fixes are **resolved**. Nothing is residual.
- **H1 is fixed correctly.** `useThread` now keeps a cursor that only server fetches move; `send` and `loadOlder` copy it through unchanged. A message that crosses mine is picked up by the next `after=` poll. Both the no-cursor branch and the poll branch merge into the cache as it stands *after* the request. Tests cover the crossing message, remount, a send during an in-flight first poll, and `has_more` paging.
- **The send-path transaction fix is correct under async SQLAlchemy:**
  - `expire_on_commit=False`, plus the commit before `check_text`, means no connection sits idle in a transaction during moderation.
  - After the `FOR UPDATE` lock and `expire_all()`, every ORM object the function uses is re-loaded. The conversation comes from `db.get(populate_existing=True)`, and the group and term from `db.get`, which refreshes expired identities. Membership and attendance checks are Core `EXISTS`. The message is new.
  - No expired attribute is read without an await, so there is no MissingGreenlet risk.
  - A 409 or 403 under the lock rolls back when `get_db` closes the session.
- **No regressions found** in the renamed groups helpers, matrix renumbering, the indexes in `models.py` versus the `0061` migration, or the frontend dedupe.
- The new findings are small:
  - the architecture doc overstates a read-marker guarantee;
  - timed-out moderation calls can pile up in the default thread pool;
  - a few test and dedupe gaps.

## Open Questions / Risks

1. **Read marker covers crossing messages (doc accuracy and product question).** `send_message` upserts the sender's marker to their own `created_at` (`app/messaging/application/messages.py:131`). A crossing message that committed just before mine (earlier `created_at`) is therefore counted as read before the client has fetched it. The open thread still shows it, because H1 is fixed. But it never counts as unread, and `useThreadReadMarker` skips marking when the newest message is mine. `.maister/docs/project/architecture.md` (Messaging, "Send ordering") claims that "a read marker never covers a message the client has not seen", which is not true. Either soften the doc or accept the behaviour explicitly. **Severity**: info.
2. **Hung classifier risk.** `asyncio.wait_for(asyncio.to_thread(...), 5s)` (`app/moderation/text_guard.py:250-252`) stops the request waiting, but the worker thread keeps running. If the model hangs, every send leaves a stuck thread in asyncio's shared default executor (min(32, CPU+4) threads). The per-party limiter is 30/min, but there is no global limit. The same executor serves image processing and storage I/O (`app/storage/service.py:69-93`, `app/product/service.py:432`, `app/users/service.py:161`). The docstring already acknowledges this. A dedicated small executor, or a circuit breaker after N timeouts, would contain it. **Severity**: warning (low).
3. **The "rechecked under lock" test uses the same session.** `test_sendMessage_groupDeletedDuringModeration_recheckedUnderLockReturns409` (`tests/test_conversation_messages.py:367-394`) changes the group through the request's own `db_session`. It proves that `expire_all()` is needed (the stale identity-map `Group` would otherwise pass), but it does not exercise a second connection. There is no test for the 403 branch (membership ended during moderation). The logic is correct by inspection. **Severity**: info.
4. **Remaining race window (accepted design).** Re-checking access under the conversation lock does not lock membership or attendance rows. A revocation that commits between the re-check and the insert can still let one message through. The window is microseconds, so this is acceptable and not a defect.

## Issue-by-issue verification

| # | Issue | Result | Evidence |
|---|-------|--------|----------|
| 1 | **H1**: a crossing message was lost | **Resolved** | `src/frontend/src/hooks/useThread.ts:23-30` adds a `cursor` documented as moved only by server fetches. Cursor sources: `:76` (newest page), `:79-86` (poll pages); `send` (`:125-129`) and `loadOlder` (`:105-109`) copy `prev?.cursor` unchanged. Server `after=` is a strict `(created_at, id) >` keyset, ascending (`app/messaging/infrastructure/repository.py:102-108`), so mine plus the crossing message come back and `mergeMessages` dedupes by id (`useThread.ts:46-52`). Tests: `src/frontend/src/test/useThread.test.tsx:148` (crossing), `:172` (remount resumes from server cursor `m1`). |
| 2 | **No-cursor branch overwrite race**, and the `has_more` poll loop | **Resolved** | No-cursor branch re-reads the cache after the await and merges (`useThread.ts:70-77`); poll branch likewise (`:87-88`). Loop bounded by `POLL_MAX_PAGES = 5` (`:17`, `:81-86`) and breaks on `!has_more` or an empty page. Tests: `useThread.test.tsx:193` (first message sent during an in-flight first poll is kept), `:224` (paging with `has_more`). Error mid-loop discards fetched pages but leaves the cursor in place, so the next poll retries — no loss. |
| 3 | **Moderation inside an open transaction** | **Resolved** | `app/messaging/application/messages.py:97-112` does the access/body check, then the limiter, then `db.commit()`, then `check_text` (`:114-120`) outside any transaction. `lock_conversation_for_send` (`repository.py:119-128`) autobegins and takes `FOR UPDATE`, then `expire_all()` (`messages.py:123`). Re-fetch: `get_conversation` uses `db.get(..., populate_existing=True)` (`repository.py:43`); `resolve_access` uses `get_group_including_deleted`/`get_term_any` = `db.get` (`app/groups/infrastructure/repository.py:76-77,409-410`), which reload expired identities inside the awaited call. Organizer, membership and attendance checks are queries (`app/groups/application/circles.py:356-363`; `app/groups/infrastructure/repository.py:285-317`). After `expire_all`, only fresh objects, the new `Message` and plain values (`me`, `conversation_id`) are touched, so there is **no MissingGreenlet path**. `_ensure_writable` under the lock gives 409 (`messages.py:128,137-139`), and `AccessDeniedException` gives 403 (`access.py:51-52,68-69`). Both raise before the commit, and `get_db`'s `async with` (`app/db.py:18-21`) rolls back and releases the lock. Session state is consistent: `expire_on_commit=False` (`app/db.py:15`), so the pre-commit `Access`/`Conversation` stay readable, but they are discarded (`_`) and replaced. |
| 4 | **Moderation timeout** | **Resolved** (see Risk 2) | `app/moderation/text_guard.py:17-20` defines `INFERENCE_TIMEOUT_SECONDS = 5.0`. `:92-102` wraps the call in `wait_for(to_thread(...))`, and `TimeoutError` maps to `ModerationUnavailable` (503) with a `reason=timeout` log. `TimeoutError` is the builtin alias on Python 3.11+. Test: `tests/test_conversation_messages.py:347`. |
| 5 | **Limiter is atomic and counts rejected and 503 attempts** | **Resolved** | `app/messaging/application/send_limiter.py:299-303`: check and append with no await between them, and a blocked attempt is not recorded. It is called before `commit`/`check_text` (`messages.py:102-112`), so 400 moderation rejections and 503s are counted. Invalid bodies (`:99-101`) are not counted, which is reasonable. Tests: `tests/test_message_send_limiter.py:24,44`, `tests/test_conversation_messages.py:263,318`. |
| 6 | **`hide_parameters=True`** | **Resolved** | `src/backend/app/db.py:11-13`. The send-path logs carry ids only, never the body (`messages.py:105-110,117-119`). |
| 7 | **OAuth `mcp:*` scopes removed from `/api/conversations`** | **Resolved** | `app/core/authorization_matrix.py`: rows 53-54 are `("READ",)` and `("EDIT",)`, and later rows are renumbered 55-65 consistently. Cross-references inside the file were updated ("row 58's", "row 58's and row 43's"), and no stale external references were found. `app/messaging/router.py:33-36` adds local `ReadPrincipal`/`EditPrincipal` aliases over `require_any("READ")` and `require_any("EDIT")`. All 9 routes use them (`router.py:52,57,68,80,92,99,108,121,128`). `app.core.auth_deps` is imported only for `Principal` and `require_any`, never for its scope-bearing aliases. Tests: `tests/test_authorization_matrix.py:85-88,111-130` (an mcp token gets 403, a login token gets 200). |
| 8a | `read_only_reason`, `term_title`, `item_counterpart` helpers | **Resolved** | `app/messaging/application/access.py:27-37`, used by `group_access`/`term_access` and by the inbox (`inbox.py:180`). `conversations.py:31-43`, used by `_to_response` (`:192,205`) and the inbox (`inbox.py:142,175,185`). |
| 8b | `chat_audience` collapsed and groups helpers renamed | **Resolved** | `app/groups/application/chat_audience.py` (36 lines) keeps only the composed reads. Renames: `_is_active_organizer` → `is_active_group_organizer` (`circles.py:356`; every caller updated in `terms.py`, `join_code.py`, `public_view.py`, `memberships.py` docstring); `_ordered_group_member_party_ids` → `list_group_member_party_ids` (`exchange_summary.py:56`, callers updated). `has_active_membership`/`has_active_attendance` are in the repository (`app/groups/infrastructure/repository.py:285-317`). Re-exports: `app/groups/service.py`, and the single ACL `app/messaging/infrastructure/groups_acl.py`. A grep for the old names finds nothing. `is_active_group_organizer` uses `find_current_leadership`, which does not filter `Group.deleted_at`, so organizers keep read access to a soft-deleted Circle's chat as intended. |
| 8c | `last_messages_for` via LATERAL | **Resolved** | `app/messaging/infrastructure/repository.py:302-323`: one statement, `LIMIT 1` per conversation, ordered by `(created_at DESC, id DESC)`, which the composite index serves. |
| 8d | `_count_unread_where` | **Resolved** | `repository.py:288-299`, shared by `sum_unread` (`:267-280`) and `count_unread` (`:283-285`). The inner `join(Message, …)` is correct for a count. |
| 8e | `is_active_attendee` via EXISTS | **Resolved** | `app/groups/application/public_view.py:392-396` calls `repository.has_active_attendance` (EXISTS). The new schema field is `app/groups/schemas.py:366-367`. Tests: `tests/test_group_access.py:186-189` and the key-set update at `:383`. |
| 8f | Indexes declared in `models.py` | **Resolved** | `app/messaging/models.py:32-56,97-99,116-122` match `alembic/versions/0061_messaging.py:74-97,117-121,141-146` by name, columns, uniqueness and partial `WHERE`. |
| 9a | `useOpenAndNavigate`, `openConversation(target)`, `utils/messagesPaths.ts` | **Resolved** | `src/frontend/src/hooks/useOpenAndNavigate.ts`; `hooks/useOpenConversation.ts:16-46` (a `ChatTarget` plus a `GET_OR_CREATE` record); `utils/messagesPaths.ts`. Used by `GroupDetailsPage`, `TermAttendeesPage`, `ItemDetailPage`, `PublicTermView`, `InboxPage`, `ThreadPage` and `MessagesButton`. One small leftover: `router.tsx:123,127` still hard-codes `"/panel/wiadomosci"` (info N5). |
| 9b | `ChatRow` calls the hook itself; TermPage props removed | **Resolved** | `src/frontend/src/pages/term/views/PublicTermView.tsx:274-285`: the hook is called before the early return, which respects the rules of hooks. `TermPage.tsx` now passes only `chatAccess={view}`, and the gate flags come from the server (`termViewState.ts` `content` variant). |
| 9c | Focus rings | **Resolved** | `ThreadPage.tsx:29` (`FOCUS_RING`) is applied to the back button, item link, log, older button and the error/unavailable actions. `MessageComposer.tsx:422`, `PublicTermView.tsx` `CHAT_BUTTON`, `GroupDetailsPage` `GroupChatCard`, `TermAttendeesPage` and `ItemDetailPage` buttons all have `focus-visible:outline-*`. |
| 9d | GroupDetailsPage chat card gate | **Resolved** | `GroupDetailsPage.tsx:27-30,56`: `group && isPrivate && (status === "ready" \|\| status === "error")`. `useJoinCode.ts:46-51` maps a 403 to `"denied"`, so non-organizers are excluded and a transient error does not hide the card. Tests: `src/frontend/src/test/GroupDetailsPage.test.tsx:181-209`. |
| 10a | Inbox polls every 20 s | **Resolved** | `src/frontend/src/hooks/useConversations.ts:9,27-29` (`refetchIntervalInBackground: false`). Test: `test/useConversations.test.tsx:20`. |
| 10b | Composer focus on mount and after send | **Resolved** | `src/frontend/src/pages/messages/MessageComposer.tsx:26-28,45`. Tests: `test/MessageComposer.test.tsx:32,38,50`; `test/ThreadPage.test.tsx:202,209` (read-only does not steal focus). |
| 10c | Mark-read skipped when the newest message is mine | **Resolved** | `src/frontend/src/pages/messages/useThreadReadMarker.ts:18`, wired at `ThreadPage.tsx:40-41`. Test: `test/ThreadPage.test.tsx:194`. |
| 11 | Messaging section in the architecture doc | **Resolved** (with one inaccuracy, N1) | `.maister/docs/project/architecture.md`, `## Messaging (app/messaging/)`, covers routes, matrix rows 53-54, kinds, per-request access, read markers, send ordering, keyset cursor, polling, moderation and the per-worker limiter caveat. |

## New findings

### Critical
None.

### Warnings

**N2: Timed-out moderation threads are never reclaimed (low).**
- **Location**: `src/backend/app/moderation/text_guard.py:250-252`
- **Problem**: see Risk 2. While the model is hung, each send adds a stuck thread to the shared default executor. That can stall unrelated `to_thread` work: image processing and storage I/O.
- **Recommendation**: run moderation on a dedicated bounded `ThreadPoolExecutor` (`loop.run_in_executor`), or trip a short circuit breaker after consecutive timeouts so later sends fail fast with 503.
- **Fixable**: false (design choice).

### Informational

**N1: Architecture doc overstates the read-marker guarantee.**
- **Location**: `.maister/docs/project/architecture.md`, "Send ordering" bullet; the behaviour is at `src/backend/app/messaging/application/messages.py:131`.
- **Problem**: see Risk 1.
- **Fix**: reword it, e.g. "sending moves the sender's marker to their own message, so a message that crossed it is not counted as unread". Alternatively, change the behaviour deliberately.
- **Fixable**: true (doc).

**N3: No test for the 403 branch under the lock, and the 409 test uses the request's own session.**
- **Location**: `src/backend/tests/test_conversation_messages.py:367-394`
- **Suggestion**: add a test that ends the membership during moderation, either from a second session or committed SQL, and expects 403.
- **Fixable**: true.

**N4: The list does not stay pinned to the bottom when a crossing message is inserted before the last one.**
- **Location**: `src/frontend/src/pages/messages/ThreadPage.tsx:194-206`
- **Problem**: the layout effect re-pins only when the last id or the first id changes. A crossing message inserted before my newest message (now possible because H1 is fixed) grows the content without re-scrolling, so my message can slip partly below the fold.
- **Suggestion**: also re-pin when `atBottom.current` was true and the item count changed.
- **Fixable**: true.

**N5: The router still hard-codes the inbox path.**
- **Location**: `src/frontend/src/router.tsx:123,127`
- **Suggestion**: use `INBOX_PATH` from `utils/messagesPaths.ts` so the path is defined in one place.
- **Fixable**: true.

**N6: Autofocus on thread open.**
- **Location**: `src/frontend/src/pages/messages/MessageComposer.tsx:26-28`
- **Problem**: focusing the textarea on mount opens the mobile keyboard over the history, and screen-reader users skip past the `h1` header. This was an intentional UX request, so it is noted only.
- **Suggestion**: consider limiting it to pointer:fine devices or to after the first send.
- **Fixable**: false (UX decision).

**N7: Mixed import style for the attendance check in `public_view.py`.**
- **Location**: `src/backend/app/groups/application/public_view.py:395`
- **Problem**: it calls `repository.has_active_attendance` directly, while sibling checks go through application helpers. This is consistent with layering inside the same bounded context and is noted only for uniformity.
- **Fixable**: true.

## Metrics
- Longest changed function: `send_message`, about 45 lines (`messages.py:89-134`).
- Max nesting depth: 3 levels.
- Potential vulnerabilities: 0. The OAuth scope gap is closed.
- N+1 query risks: 0. The inbox and unread paths use a fixed number of statements.
- Files re-checked: 34 (backend 20, frontend 13, docs 1).

## Prioritized Recommendations
1. Fix the doc sentence (N1), or decide whether crossing messages should stay unread.
2. Contain hung-classifier threads with a dedicated executor or a breaker (N2).
3. Add a 403-under-lock test from a second session (N3).
4. Keep the thread pinned to the bottom when a crossing message is inserted (N4).
5. Use `INBOX_PATH` in `router.tsx` (N5).
