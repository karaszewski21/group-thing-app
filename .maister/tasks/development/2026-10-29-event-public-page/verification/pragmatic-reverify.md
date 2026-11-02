# Pragmatic Re-verification: fix cycle 1

**Scope:** only the Phase 11 fix-cycle changes (work-log entry 2026-10-30T11:15:31Z). The rest of the feature was covered in `pragmatic-review.md`.
**Status:** ✅ Appropriate. No new Critical, High or Medium findings. One new Low/Info note.

## TL;DR

- Every fix is the smallest change that solves its problem.
- None of them adds abstractions, dependencies, configuration or speculative code.
- The guest sign-up path now reads the event twice: a plain read, then a `FOR SHARE` read. This is the only extra complexity added, and it is justified: it keeps the moderation call out of the lock and keeps 404/409 ahead of moderation.
- The 7 Info items from the first review (I-1 to I-7) are all still in the code. The user chose not to fix them this cycle, so they are listed below as open, not as new findings.

## Key Decisions

- I accepted the double event read in `sign_up` as proportionate. The other option, moderating first and then doing one locked read, is about 1 line shorter. But it would send names to moderation for events that are missing or have ended, and it would change which error comes first.
- I did not count the new `_alembic` helper in `test_event_party_indexes_migration.py` as duplication. The same helper is already copied in 16 migration test files. That pattern predates this task and is out of scope.

## Open Questions / Risks

- None from the fix cycle.

## Fix-by-fix assessment

| Fix | Location | Verdict |
|-----|----------|---------|
| W1 callable `re.sub` replacement | `src/backend/app/system/public_preview.py:57` | ✅ One line plus a one-line comment. This is the idiomatic fix. |
| W2 party indexes | `src/backend/alembic/versions/0072_event_party_indexes.py`, `tests/test_event_party_indexes_migration.py` | ✅ Two `create_index` calls. The downgrade drops in reverse order, as `migrations.md` requires. The partial index matches the `withdrawn_at IS NULL` filter. The round-trip test follows the existing per-migration pattern. |
| W3 sign-up ordering + `_require_open` | `src/backend/app/events/service.py:380-436` | ✅ `_require_open` is an 6-line helper used twice: before moderation and again under the lock. This replaces a duplicated check rather than adding a layer. See L-1 for a note on the double read. |
| W4 remount on `eventId` change | `src/frontend/src/pages/events/EventPage.tsx:38-45` | ✅ A 3-line wrapper with `key={eventId}`. This is the standard React way to reset per-entity state, and it beats manual reset effects. |
| W5 `canSignUp` empty copy | `EventAttendeeList.tsx:76-106`, `EventPage.tsx:154,179,190` | ✅ One boolean prop. Only `visitor` sets it; the shell defaults it to `false`. It adds no branching beyond the one sentence. |
| W6 verb plural | `EventAuthorCard.tsx:56` | ✅ Reuses the existing `utils/plural.ts` `pluralPl` and adds no new helper. |
| I1 author name fallback | `src/backend/app/events/page.py:34,116` | ✅ A module constant used in a `dict.get` default. |
| I3 `useEvent.remove` invalidates conversations | `src/frontend/src/hooks/useEvent.ts:84-95` | ✅ One extra `invalidateQueries` inside the existing `Promise.all`, following `data-fetching.md`. |
| W7, W10, W11, I5 | 0071 `lock_timeout`, docs, docstring, `maxLength` | ✅ One-liners or documentation. Nothing to simplify. |

## New findings

### L-1 (Low / Info): the guest path reads the event twice

- **Location:** `src/backend/app/events/service.py:399-406`
- **Evidence:** when the caller is not attached, the code calls `_require_open(await db.get(Event, event_id), event_id)` before `check_text`. After that comes `db.get(..., with_for_update={"read": True}, populate_existing=True)`.
- **Assessment:** the cost is one extra primary-key SELECT, on guest sign-ups only. The benefit is that no moderation call runs for an event that is missing or has ended, and the error order stays 404/409 → 400/422. `test_signUp_guest_moderatesNameBeforeLockingEvent` pins the ordering. The cost is worth paying.
- **Fixable:** yes, but not recommended. **Suggestion:** none. If anything, add one short comment saying the first read exists to avoid moderating names for closed events. The docstring already mostly says this.

## Still open from the first review (not re-flagged)

All of these were confirmed still present in the working tree:

| ID | Location | Item |
|----|----------|------|
| I-1 | `src/frontend/src/pages/events/eventViewState.ts:16` | `EventContentView` is exported but unused. |
| I-2 | `eventViewState.ts:13,47` | `visitor.isLoggedIn` is never read by `EventPage`. |
| I-3 | `src/frontend/src/hooks/useEvent.ts:30` | `refreshError` is returned, but only a test reads it. |
| I-4 | `EventPage.tsx` (`withdraw` footer) | `busy={false}` is always constant. |
| I-5 | `src/backend/app/events/page.py:37` vs `service.list_active_attendee_party_ids` | Two queries list the active attendees. |
| I-6 | `page.py:105` | Uses the 2-statement `get_own_organization` although a batched variant exists. |
| I-7 | `service.py:408` and others | Readability nits: `if profile is not None and attached:`, the positional `Access(...)`, and duplicated retry markup in `EventPage`. |

The caller's brief numbers these I6–I11 in the aggregated verification report. The content is the same.

## Summary statistics

- Fix cycle: about 12 small changes, 1 new migration (2 indexes), 1 new test file, 0 new dependencies, 0 new abstractions.
- New issues: Critical 0, High 0, Medium 0, Low/Info 1 (no action needed).

## Conclusion

The fix cycle is proportionate and adds no over-engineering. No action is required before commit. The 7 Info cleanups from the first review are still optional follow-ups, about 25 minutes in total.
