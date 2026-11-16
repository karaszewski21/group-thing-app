# Pragmatic Re-verification (cycle 1): "szukam" (wanted posts)

## TL;DR

- Status: **Appropriate**. All 3 warnings (W1–W3) are resolved. Of the 7 info items, I1, I2 and I5 are resolved, I4 is mostly resolved, I3 is still open and I6/I7 were accepted as they are.
- The fixes did not add complexity that fails to pay for itself. `WantWriteError` (12 LOC), `useWantsMatchingItem` (19 LOC), the `FOR UPDATE` lock with its ACTIVE filter, and `create_notifications` are each sized to the problem they solve.
- 0 critical, 0 warning, and 5 small info items remain: a stale docstring, a stale comment and an optional switch to `useWants().close`, a two-state prompt reset that could be one state, a redundant UPDATE filter, and optional ORM inserts in `create_notifications`.
- None of the remaining items blocks the release. The total optional cleanup is about 30 min and about −15 LOC.

## Key Decisions

- **`WantWriteError` is kept.** Rethrowing `ApiError` with its message swapped would mean changing a shared class or relying on a subclass trick. A 12-line class next to the only wrapper that needs it is the smaller change. It follows the existing `*LoadError extends Error` pattern (`features/*/…Context.ts`).
- **The separate `hooks/useWantsMatchingItem.ts` is kept.** `standards/frontend/data-fetching.md` puts query hooks in `src/hooks/`. A separate hook avoids loading every `useWants` write callback into the product page, and its key sits under `[WANTS_KEY]`, so every wants write refreshes it.
- **`.with_for_update()` plus the `status == ACTIVE` filter in `_wants_to_notify` is kept.** It closes a real race (a withdrawal or edit committed mid-scan) without adding a statement. Locking in id order prevents deadlocks between overlapping runs. The cost is longer locks during the run, and that was already recorded as accepted risk W10.

## Open Questions / Risks

- Unchanged from the previous review: `want_matches.opened_at` and `source` are written and never read (I6). Keep them only if the release-gate query actually uses them.

---

## 1. Previous findings

| Previous finding | Result | Evidence |
|---|---|---|
| W1 unused notification replace path | **Resolved** | `replace_unread_notifications`, `WrittenNotification` and `previous_id` are gone (no hits under `src/`). `create_notifications(db, entries) -> list[UUID]` is at `app/notifications/service.py:75-102`. The ACL re-exports only what is used (`wants/infrastructure/notifications_acl.py:9-21`). The tests became `createNotifications_*` (`tests/test_wants_notifications.py:78,115`) |
| W2 two "matching wants" paths (dead `findMatching`, `useEffect` fetch) | **Resolved** | `findMatching` is removed. `ItemPickupActions.tsx:51` uses `useWantsMatchingItem`, and there is no `useState`+`useEffect` fetch. `CloseWantSheet.tsx:35` gives a one-line reason for its direct API call |
| W3 cap error recognised by text | **Resolved** | `WantFormView.tsx:164` checks `err instanceof WantWriteError && err.status === 409`. The hard-coded Polish text is gone from production code; it is left only in test fixtures, which is correct |
| I1 `CLOSE_OUTCOMES` | **Resolved** | Removed |
| I2 `WantMatchResponse.subtitle` | **Resolved** | Removed from both sides. The remaining `subtitle` hits belong to search, terms and auth |
| I3 copied haversine | **Residual (accepted, low)** | `wants/application/matcher.py:58,102` and `search/application/search.py:133,195` are unchanged. Still only two copies, so leaving it is fine |
| I4 small backend inconsistencies | **Mostly resolved** | `WantMatchNotFound` is now in `errors.py:26`. `resume_want` calls `_start_new_period` (`writes.py:284,305`). **Residual:** the `category_acl.py:1-4` docstring still promises "its existence check and its name and path" |
| I5 frontend duplication | **Resolved** | The wanted views no longer declare their own `FOCUS`/`FOCUS_RING` (the other copies across the app predate this task and are out of scope). `agoLabel` is shared from `wantText.ts:62` and used by both views. Keeping two action-runner copies was accepted as before |
| I6 `opened_at`/`source` measurement-only columns | **Unchanged (by design)** | See Open Questions |
| I7 scan log count statement | **Unchanged (by design)** | Not a defect |

## 2. Did the fixes add complexity that does not pay for itself?

| Fix | Size | Verdict |
|---|---|---|
| `WantWriteError` (`hooks/useWants.ts:24-42`) | 12 LOC + 2 test asserts | **Pays for itself.** It replaces a three-copy text/number coupling with a status check. It wraps the existing `extractProblemMessage`, so messages still come through verbatim, as the data-fetching standard requires |
| `hooks/useWantsMatchingItem.ts` | 19 LOC | **Pays for itself.** It replaced a hand-written `useEffect` fetch plus the dead `findMatching`, so there is now one path. `enabled: token !== null && …` repeats the `isLoggedIn` gate in `ItemPickupActions.tsx:44`, which is harmless |
| `promptDismissed` + `promptFor` (`ItemPickupActions.tsx:45-52`) | 2 states + a reset during render | **Acceptable, slightly heavier than needed.** It is needed: closing one of several wants invalidates `[WANTS_KEY]`, the matching query refetches, and without the flag the prompt would reopen (the changed ItemDetailPage assertion covers this). See R2 for a one-state version |
| `.with_for_update()` + ACTIVE filter (`match_notifications.py:55-77`) | +3 lines, 0 statements | **Pays for itself.** It is a correctness fix at no statement cost |
| `create_notifications` (`notifications/service.py:75-102`) | 28 LOC | **Acceptable.** One INSERT returning ids in entry order is what the caller needs. Setting `created_at`/`updated_at` by hand is the only unusual part, and the docstring explains it. See R5 for an optional ORM form |

## 3. Remaining issues

### Critical

None.

### Warning

None.

### Info

**R1. Stale docstrings and comment** (2 min)
- `src/backend/app/wants/infrastructure/category_acl.py:1-4`: the docstring still says "its existence check and its name and path", but the file only re-exports the table (this is I4's leftover). Trim it to "exposes the `categories` table".
- `src/backend/app/notifications/service.py:1-7`: the docstring still calls `create_notification` "the single cross-vertical write entrypoint". There are now three (`create_notification`, `create_notifications`, `delete_unread_notifications`). Change it to "the cross-vertical write entrypoints".
- `src/frontend/src/features/wanted/CloseWantSheet.tsx:35`: the comment says "the raw ApiError … is needed". Since `WantWriteError` now carries `status`, `useWants().close` would work too. The one real difference left is that `close` invalidates once per want instead of once overall. Either reword the comment to that reason, or switch to `close` and check `err.status`. Both are fine; the reason should just be the true one.

**R2. The prompt reset could be a single state** (`src/frontend/src/features/product/blocks/ItemPickupActions.tsx:45-52`, about 10 min)
```tsx
// before: two states plus a setState during render
const [promptDismissed, setPromptDismissed] = useState(false);
const [promptFor, setPromptFor] = useState(takenItemId);
if (promptFor !== takenItemId) { setPromptFor(takenItemId); setPromptDismissed(false); }
// after
const [dismissedFor, setDismissedFor] = useState<string | null>(null);
const promptDismissed = takenItemId !== null && dismissedFor === takenItemId;
... onClose={() => setDismissedFor(takenItemId)}
```
Trade-off: if the user cancels and then takes the same item again on the same page, the prompt does not reopen, because `useItemTake.ts:115,120` gives the same id again. That is arguably correct, since the user already dismissed the prompt for this item. This is optional. The current code is correct and uses React's documented "adjust state on prop change" pattern.

**R3. Redundant filter in the pointer UPDATE** (`src/backend/app/wants/application/match_notifications.py:135`). `pointed` is a subset of the wants that `_wants_to_notify` locked with `status == ACTIVE` in the same transaction, so `Want.status == WantStatus.ACTIVE` in `_point_wants_at_rows` cannot filter anything out. It is harmless as defence in depth. Remove it only if you want the lock to be the single stated guarantee. Optional.

**R4. Haversine copy (I3, carried over).** Still low priority at two copies.

**R5. Optional: ORM inserts in `create_notifications`** (`src/backend/app/notifications/service.py:84-101`). Building `Notification(id=uuid.uuid4(), …)` objects and calling `db.add_all(...)` gives the ids without a flush and keeps the model's `created_at`/`updated_at` defaults. SQLAlchemy 2.0 "insertmanyvalues" still batches them into one INSERT at flush. This saves about 8 LOC and the hand-set timestamps. The trade-off is that the INSERT now happens at the next flush or commit instead of at call time, so the "one statement" test would need a flush. It is not worth doing unless this file is touched again.

## 4. Developer Experience

- Better than in the previous review. A developer now finds one "wants matching item" path, one cap check that does not depend on the wording, and a notification API without a phantom replace mode.
- The remaining friction is small: two stale docstrings and one comment whose reason no longer holds (R1).

## 5. Requirements Alignment

- FR-F-04 drift: resolved. The `matched_item_id` lookup now goes through a hook in `src/hooks/`. It is a sibling hook, not part of `useWants`, which matches the intent of the spec rather than its exact wording.
- No new features or speculative surface were added by the fixes.

## 6. Context Consistency

| Indicator | Previous | Now |
|---|---|---|
| Unused production symbols | 5 | 0 |
| Data paths for "wants matching item" | 2 | 1 |
| Copies of the cap message/limit in production code | 3 | 1 (backend `domain/messages.py`) |
| Stale docs | 1 (`category_acl.py`) | 2 (`category_acl.py`, `notifications/service.py` header) + 1 stale comment (`CloseWantSheet.tsx:35`) |
| Haversine copies | 2 | 2 |

## 7. Top Recommended Actions (all optional)

1. R1: fix the two docstrings and the `CloseWantSheet` comment (2 min).
2. R2: collapse the prompt reset into one `dismissedFor` state (10 min, about −4 LOC).
3. R3/R5: leave them unless the files are touched again.

## 8. Summary Statistics

| Metric | Cycle 0 | Cycle 1 |
|---|---|---|
| Warnings | 3 | 0 |
| Info items open | 7 | 5 (R1–R5, all optional; R4 = I3) |
| New classes/hooks added by the fixes | — | 2 (`WantWriteError`, `useWantsMatchingItem`), both justified |
| New infrastructure/dependencies | 0 | 0 |

## 9. Conclusion

The verification fixes did what the previous review asked for, and they did it at the expected size. Nothing they added counts as over-engineering at this project's scale. The remaining items are cosmetic or optional and need no further verification cycle.
