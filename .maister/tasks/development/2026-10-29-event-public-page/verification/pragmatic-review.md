# Pragmatic Review: Public event page (Term-style)

## TL;DR
- **Status: Appropriate. No critical issues and no warnings.** I found 7 info-level nits, each a few lines of dead or near-duplicate code.
- The backend stays lean. The ACL modules are 10–56 LOC thin re-exports (the project convention), the read model is a single 165-line `page.py`, the migration is small and reversible, and the messaging EVENT branches copy the TERM ones.
- The event-only frontend copies are about the same size as their Term originals or smaller. For example, `EventFooter` is 34 LOC against 28 for `TermFooter` (it has 3 variants), and `EventWhenCard` is 85 LOC against 79 for `TermCard`. None of them is bloated.
- The leftovers are small: an unused `EventContentView` export, the unused `visitor.isLoggedIn` field, `refreshError` (read only by tests), a withdraw `busy` prop that is always `false`, and two near-duplicate attendee queries.

## Key Decisions
- I did not flag the duplication between the event-only copies and the Term components, because the user decided it (no Term regression risk). I did check whether any copy is bigger than it needs to be. None is.
- I did not flag the thin re-export ACL modules (`circulation_acl`, `groups_acl`, `organizations_acl`, `product_acl`, and messaging's `events_acl`). They follow the project convention in `standards/backend/models.md`.
- The defaults `event_ids: Collection = ()` on `select_inbox_rows` and `sum_unread` are justified. They keep the existing `tests/test_messaging_repository.py` calls unchanged, and both production callers pass the argument explicitly.

## Open Questions / Risks
- `EventContentView` and the `{ event }` sub-union were required by the spec, following the components standard. They have no consumer yet, so keeping or removing them is a judgment call (see I-1).

## 1. Complexity Assessment
| Area | Scale indicator | Assessment |
|------|-----------------|------------|
| Project | Early-production: real business logic, DDD-lite bounded contexts, ACL per context | Medium complexity is appropriate |
| Backend events | `service.py` +201, `page.py` 165 (new), 5 ACL modules (10–56 LOC) | Proportional. Every new function has a caller. |
| Messaging | About 180 LOC across 8 files, adding EVENT branches that copy TERM | Proportional, with no new abstraction |
| Migration 0071 | 72 LOC, small `_recreate_child_fks` helper reused by upgrade and downgrade | Appropriate |
| Frontend | 7 components (16–107 LOC), 1 page hook (70), `useEvent` +86, `EventPage` 222 | Proportional. `EventPage` is a thin switch over `view.kind`. |

Overall complexity is **Medium**, which is appropriate for the project.

## 2. Key Issues Found

### Critical
None.

### High / Warning
None.

### Info

**I-1: `EventContentView` is exported but nothing uses it.** `src/frontend/src/pages/events/eventViewState.ts:16`
- A grep finds only the definition.
- The spec asked for it, but `standards/global/minimal-implementation.md` says "Unused code is debt".
- **Suggestion:** delete it, or use it as the type of `EventPage`'s `page()` helper argument. Effort: 1 minute.

**I-2: The `visitor` view carries an `isLoggedIn` field that nothing reads.** `src/frontend/src/pages/events/eventViewState.ts:13,47`
- `EventPage` never reads `view.isLoggedIn`. The footer is always "＋ Zapisz się na wydarzenie" (decision M3), and `useEventSignUp` gets `isLoggedIn` directly.
- The field exists only in the table rows of `eventViewState.test.ts`.
- **Suggestion:** remove the field and its test expectations. Effort: 5 minutes.

**I-3: `useEvent` returns `refreshError`, but only a test reads it.** `src/frontend/src/hooks/useEvent.ts:30,135`
- The page gets the same information through `error` → `resolveEventView` → `refreshing.error`, or through the content view keeping its data.
- `refreshError` is only asserted in `src/test/useEvent.test.tsx:99`.
- **Suggestion:** drop it from the result and assert `error` together with `data !== null` instead. Effort: 5 minutes.

**I-4: The `withdraw` footer variant takes a `busy` prop that is always `false`.** `src/frontend/src/pages/events/components/EventFooter.tsx:8,23` and `EventPage.tsx:129`
- Busy state is handled by `ConfirmDeleteDialog`'s `busyLabel`, so the footer never needs to be disabled.
- **Suggestion:** change the variant to `{ variant: "withdraw"; onWithdraw }` and drop `busy={false}`. Effort: 2 minutes.

**I-5: Two queries list the active attendees of an event.**
- `page._active_attendee_party_ids` (`src/backend/app/events/page.py:35`) is ordered and excludes the author.
- `service.list_active_attendee_party_ids` (`src/backend/app/events/service.py`, used by messaging) is unordered.
- The author can never attend (`sign_up` returns 409), so the author filter only guards against bad data.
- **Suggestion:** give the service function `.order_by(created_at, id)` and call it from `page.py`. That leaves one query instead of two. Effort: 5 minutes. Optional.

**I-6: The detail page uses the two-query `get_own_organization` while the batched variant exists.** `src/backend/app/events/page.py:105` and `infrastructure/organizations_acl.py`
- `get_own_organization` costs 2 statements.
- `get_own_organizations_by_party_ids(db, [author_party_id]).get(author_party_id)` costs 1 statement.
- Switching would also remove one export from the ACL.
- **Suggestion:** optional, and only one query is saved. Effort: 2 minutes.

**I-7: Minor readability nits.**
- `service.sign_up`: the check `if profile is not None and attached:` repeats the `profile is not None` test, which `attached` already implies. It is probably there for mypy narrowing. It's fine, but `if attached:` plus an `assert profile` would read more directly.
- `messaging/application/access.py:88`: `Access(None, event.author_party_id, None, None, event)` is a positional NamedTuple with 5 slots. Keyword arguments (`Access(read_only_reason=None, organizer_party_id=..., group=None, term=None, event=event)`) would avoid slot-order mistakes. The existing call sites are also positional, so this is optional.
- `EventPage.tsx:88-108`: the error-plus-retry markup appears twice (for `error` and for `refreshing`). An 8-line local `RetryNotice` component would remove the duplication. Optional.

## 3. Developer Experience
- **Discoverability: good.** Each ACL module has a short docstring that says it is the only gateway to its context.
- **Read and write paths are separated.** `page.py` holds the read model and `service.py` holds the commands.
- **The frontend follows the existing patterns:**
  - `resolveEventView` is a pure function, tested with `it.each`.
  - `useEvent` uses the same `forToken`/`isStale` shape as `useTermAccess`.
  - `useEventSignUp` holds the flow state.
  - Callbacks are passed as props, which matches `standards/frontend/data-fetching.md`.
- **No new dependencies, config files, or infrastructure.**
- **Tests are sized appropriately.** The new backend test files have 259, 232 and 120 lines, and the frontend has 196 and 137. They use exact key sets and `count_queries`.

## 4. Requirements Alignment
- Every spec requirement (1–14) has a matching implementation, and I found no features beyond the spec.
- The guest sign-up, OG preview, EVENT chat, `author_slug`, the Spotkania tab and migration 0071 all match the spec's Technical Approach.
- The only change to a Term component is the pair of optional props on `AccountMergeForm`, as the spec allows. The defaults keep the Term copy byte-identical.
- I found no speculative fields or future stubs, apart from the leftovers in I-1 to I-3.

## 5. Context Consistency
- Messaging kind switches have explicit EVENT branches in `access.resolve_access`, `conversations._to_response` and `inbox._to_row`. `resolve_access` now raises `AssertionError` for an unknown kind instead of falling through to TERM, which is an improvement.
- The groups slug rule was refactored so that `derive_organizer_slug` delegates to `derive_party_slug`. The two routes cannot drift apart.
- `service.is_author` was removed together with its only caller. `count_attendees` is still used by `delete_event`.
- I found no abandoned or half-implemented patterns. The unused code is limited to I-1 to I-4.

## 6. Recommended Simplifications (top 3)
1. **Remove the unused frontend outputs (I-1, I-2, I-3)**, about 10 LOC plus their test expectations.
   - Before: `| { kind: "visitor"; event; ended; isLoggedIn }` and `refreshError` in `UseEventResult`.
   - After: `| { kind: "visitor"; event; ended }`, and `refreshError` is gone.
2. **Simplify the `EventFooter` withdraw variant (I-4).**
   - Before: `{ variant: "withdraw"; busy: boolean; onWithdraw }`.
   - After: `{ variant: "withdraw"; onWithdraw }`.
3. **Merge the duplicate attendee queries (I-5).** `page.py` would call `service.list_active_attendee_party_ids`, now ordered, leaving one query function instead of two.

## 7. Summary Statistics
| Metric | Current | After simplifications |
|--------|---------|------------------------|
| Unused exports / fields | 4 (`EventContentView`, `visitor.isLoggedIn`, `refreshError`, withdraw `busy`) | 0 |
| Attendee-list queries in events | 2 | 1 |
| Organization statements on the detail page | 2 | 1 (optional, I-6) |
| New dependencies / infrastructure | 0 | 0 |
| Estimated LOC removed | — | about 25 to 35 |

## 8. Conclusion
**The implementation is appropriate.** Its complexity matches the project's scale and conventions. The event-only copies are not bloated, and the ACL layer is as thin as the convention allows. The remaining items are optional dead-code cleanups that would take about 20 minutes in total, and none of them blocks the work.
