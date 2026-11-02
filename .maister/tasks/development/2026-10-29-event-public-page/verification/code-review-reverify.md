# Code Review Re-verification (fix cycle 1)

## TL;DR
- All four prior warnings are fixed. W3 is fixed for the row lock, but one small part remains: the transaction and its DB connection still stay open while moderation runs.
- I1 and I7 are fixed. I2, I3, I4 and I8 are still open; nobody chose to fix them. I6 is partly addressed by `lock_timeout`.
- The reordered `sign_up` is correct:
  - **Race window:** an event deleted or ended between the unlocked pre-check and the lock is caught by `_require_open` on the locked re-read, which returns 404 or 409.
  - **`populate_existing=True`:** needed, so the locked read refreshes the instance already in the identity map.
  - **Error order:** 404 comes before 409 (ended), which comes before 400 (name) or 409 (author).
  - **Guest profile:** still created under the `FOR SHARE` lock, and creating it does not call moderation again.
- No new bugs that break behaviour. There are 4 new info items.
- Status: ⚠️ Issues Found (0 critical, 0 warning, 7 info).

## Key Decisions
- The W3 leftover is rated info rather than warning. Plain SELECTs take no row locks, so author PATCH/DELETE are no longer blocked. What remains is pool use during a burst of anonymous sign-ups, which overlaps the open W8 (guest rate limit) item.

## Open Questions / Risks
- Tests were not re-run in this pass, because they need Docker and testcontainers. Pass counts are taken from the work-log.

**Date**: 2026-10-30
**Path**: fix-cycle files listed in implementation/work-log.md (2026-10-30T11:15:31Z)
**Scope**: all

## Prior findings

| ID | Status | Evidence |
|----|--------|----------|
| W1 | Resolved | `public_preview.py:56-57` uses a callable replacement `lambda _: title_tag`. `test_public_preview.py:242-251` asserts that `Swap \o/ \1` is rendered literally in the title and in og:title. |
| W2 | Resolved | `0072_event_party_indexes.py` adds `ix_events_author_party_id` and a partial `ix_event_attendances_party_id WHERE withdrawn_at IS NULL`. The models match (`models.py:35`, `models.py:110-114`). Every party-side query (`service.py:309`, `:324`, `:351`) filters on `withdrawn_at IS NULL`, so the partial predicate can be used. |
| W3 | Resolved (lock); residual info N1 | `service.py:397-400`: validation and `check_text` now run before the `FOR SHARE` get at `:401-404`. Ordering test: `test_event_attendance.py:264`. |
| W4 | Resolved | `EventPage.tsx:38-41` wraps `<EventPageContent key={eventId}>`. The router-state toast effect (`:70-77`) lives in the keyed child, so it fires on mount for the new event and clears its state with `replace`. |
| I1 | Resolved | `page.py:113-117` falls back to `names.get(author_party_id, (UNKNOWN_AUTHOR_NAME,))[0]`. |
| I2 | Open (not selected) | `public_preview.py:94-98` still puts the full description into og:description. |
| I3 | Open (not selected) | No test reaches the IntegrityError re-select branch (`service.py:413-418`). |
| I4 | Open (UX decision) | Unchanged. |
| I5 | N/A (intended) | Unchanged. |
| I6 | Partially mitigated | 0071 now sets `SET LOCAL lock_timeout = '5s'` (`0071:45`). FK validation still runs fully under the lock, and the downgrade does not set a timeout (see N2). |
| I7 | Resolved | `EventGuestSignUpSheet.tsx:56` sets `maxLength={255}`. |
| I8 | Open (not selected) | No redirect for the old `/events/:eventId` route. |

## Focus checks
- **`sign_up` race:** if the event is deleted after the pre-check, the locked `db.get` returns `None`, giving 404. If the event ends after the pre-check, `has_ended` is checked again under the lock, giving 409. Correct.
- **Double get with `populate_existing`:** SQLAlchemy skips the identity-map shortcut when `with_for_update` is set, but it would keep the stale attributes without `populate_existing`. The flag is needed and correct. Cost: one extra SELECT, guest path only.
- **Error order:** guest: 404 > 409 ended > 400 blank/too long > 400 moderation. Logged-in: 404 > 409 ended > 409 author. This matches the earlier order. The only change: a nonexistent event with an invalid name now returns 404 where it used to return 400, which is the better answer.
- **Guest profile under the lock:** `users_acl.create_guest_profile` (party, profile, solo family) runs after the `FOR SHARE` get, in the same transaction as the attendance. It makes no moderation or network calls.
- **0072 partial index:** the predicate text is the same as the queries' `withdrawn_at IS NULL`, so the planner can use it for `list_chat_event_ids_for_party`, `list_attending_events` and `_find_active_attendance`. (The last one is already served by the unique `(event_id, party_id)` partial index.)
- **`SET LOCAL lock_timeout` with `transaction_per_migration=True`** (`alembic/env.py:33,45`): the setting lasts only for 0071's own transaction, so it does not leak into 0072 or later revisions. It works in offline SQL mode too. Correct.
- **Keyed remount:** `useEvent` data comes from the query cache, keyed by `[EVENT_KEY, eventId]`, so a remount for an already-visited event shows cached data without flashing a skeleton. Toast and sheet state reset per event, which is the intended behaviour.

## New findings (all info)

### N1. The guest path still holds a transaction and connection across moderation
- **Location**: `src/backend/app/events/service.py:395-400`
- `find_caller_profile` and the unlocked pre-check `db.get` start the session's transaction automatically. So `check_text` runs while a pooled connection stays checked out, though with no row locks. A burst of unthrottled guest sign-ups (W8 is still open) can still drain the pool.
- **Suggestion**: after the pre-check, end the read-only transaction (`await db.rollback()` or `commit()`) before `check_text`. Capture `attached` first; it already is. Make sure no expired ORM attribute is read afterwards in the guest branch. Alternatively, accept this and rely on rate limiting (W8).
- **Fixable**: true

### N2. The 0071 downgrade recreates the same FKs without `lock_timeout`
- **Location**: `src/backend/alembic/versions/0071_event_conversations.py:65-67`
- `downgrade()` calls `_recreate_child_fks(None)` on `messages` and `conversation_reads` with no timeout. A rollback could therefore queue behind long queries, which is exactly what the upgrade now guards against.
- **Suggestion**: add the same `op.execute("SET LOCAL lock_timeout = '5s'")` at the top of `downgrade()`.
- **Fixable**: true

### N3. Deleting an event does not invalidate the unread badge
- **Location**: `src/frontend/src/hooks/useEvent.ts:91-95`
- `remove` now invalidates `CONVERSATIONS_KEY` but not `UNREAD_MESSAGES_KEY`. The deleted chat's unread count stays on the badge until the next 20 s poll.
- **Suggestion**: also invalidate `UNREAD_MESSAGES_KEY` in the same `Promise.all`.
- **Fixable**: true

### N4. No test for the window between the pre-check and the lock
- **Location**: `src/backend/tests/test_event_attendance.py` (sign-up tests)
- The re-check under the lock is correct, but nothing exercises an event that ends or is deleted between the two reads.
- **Suggestion**: monkeypatch `check_text` to delete the event (or move `starts_at` into the past and commit), then assert 404 or 409 and that no guest profile was created.
- **Fixable**: true

## Metrics
- Max function length: `sign_up` is about 45 lines (unchanged in scale).
- Max nesting depth: 4 (`sign_up`, IntegrityError branch).
- Potential vulnerabilities: 0.
- N+1 query risks: 0. Missing-index risks: 0 (W2 closed).

## Prioritized Recommendations
1. N1: end the read transaction before moderation, or ship W8 rate limiting.
2. N2: add `lock_timeout` to the 0071 downgrade.
3. N3: invalidate the unread badge on event delete.
4. N4 and I3: add the race-window and IntegrityError tests.
5. Optional: I2 (truncate og:description), I8 (legacy redirect).
