# Reality Check (re-verification, cycle 1): "Szukam" (wanted) mechanism

## TL;DR
- **Status: ⚠️ Issues Found (nothing blocks merge).** Both previous warnings are fixed in the code. W2 (the cap link) is resolved. W1 (no live run) is now owned by Phase 12, which runs next.
- All five re-traced journeys hold in the real code: the cap of 30 with its link, the closing prompt after a take, a want withdrawn during a scan, bell rows written through `create_notifications`, and the 0099 downgrade.
- The new behaviours have their own tests: the status filter, `create_notifications` (ids in entry order, one INSERT, no statement when empty) and the downgrade deleting WANT_* rows. Not tested: the `FOR UPDATE` wait under a truly concurrent transaction, and the prompt reopening on a second take.
- No new critical or warning gaps. What remains is info only (I5, I6, I7, I8, Polish texts still marked "to confirm", the old screenshot).

## Key Decisions
- I used `verification/test-suite-results.md` as given (backend 2 / 1469, Vitest 33 / 1824, all failures are baseline ids) and ran no tests. Reading the code and the tests was enough evidence.
- I1 (auto-extension on the match page, FR-L-02) and I3 (the /add tile links to the form, FR-F-40) are closed **by user decision**. They are no longer open questions.
- W10 (the sweep holds locks during the match; the window is unbounded after downtime) and W11 (no per-user rate limit) are recorded risks the user accepted. They are not raised again.

## Open Questions / Risks
- Phase 12 must still cover the live chain: Next proxy → `/api/wants` → DB → APScheduler job → bell → click. Until it runs, none of the evidence comes from a live stack.
- The row lock in `_wants_to_notify` (`with_for_update`, id order) is right by PostgreSQL semantics: under READ COMMITTED, a row updated concurrently is re-checked against `status = ACTIVE` once the lock is granted. No test runs two connections, though. The withdrawal test makes the update in the same session, so it proves the filter, not the wait. Low risk.

---

## 1. Previous gaps: resolved or residual

| Previous gap | State | Evidence |
|---|---|---|
| W1: no live end-to-end run | **Residual, scheduled.** It is Phase 12 (E2E) of this workflow | No `visual-fidelity.md` yet |
| W2: "Zobacz listę" keyed on the message text | **Resolved** | `hooks/useWants.ts:26-34` `WantWriteError` keeps `status` (`ApiError.status`, or `null` without a response). `WantFormView.tsx:164` sets `capReached = !want && err instanceof WantWriteError && err.status === 409`. Tests `WantFormView.test.tsx:349` ("follows a create's 409 status, not the message's wording": a 400 carrying the cap text shows no link) and `:367` (no link on an edit 409), plus `useWants.test.tsx:126-136` |
| I1: auto-extension on "seen" | **Closed by user decision** (FR-L-02 stays) | - |
| I2: no prompt after a swap proposal | Unchanged, by spec (FR-F-50) | `useItemTake.ts:110-112`: SWAP opens the picker, and `takenItemId` is never set |
| I3: the /add tile links to the form | **Closed by user decision** (FR-F-40 stays) | - |
| I4: a want withdrawn mid-run still gets a bell row | **Resolved** | `match_notifications.py:55-77`: `Want.status == ACTIVE` plus `.with_for_update()` in id order. Test `test_wants_scan.py:233` `test_writeBellRows_wantWithdrawnAfterItsPairWasStored_noRowAndPointerUntouched` |
| I5: up to 15 min late expiry | Residual (harmless) | `scan.py:_expire` unchanged |
| I6: the bell is not polled | Residual (not new, affects every kind) | `hooks/useNotifications.ts` unchanged |
| I7: "brak" on a wants load error in Konto | Residual (cosmetic) | `AccountView.tsx:12-15,28` uses only `data` and `loading`, not `error` |
| I8: items that become takeable later are never matched; the match list is unbounded | Residual, accepted risk (ADR-009) | - |
| I9: housekeeping | **Partly resolved** | `CLOSE_OUTCOMES` and `WantMatchResponse.subtitle` are gone (grep finds no matches). `standards/backend/time.md:9` now lists `app/search` and `app/wants`. Still open: the Polish texts marked "to confirm" and the old mock screenshot in the user guide |

The fix cycle also resolved the other code-review items listed in the work log: W4 (`create_notifications`), W5/W6 (the runbook's verify step and rollback order), W7 (the downgrade), W8 (`logger.exception`), W3 (the hook replaces useState + useEffect) and W9 (standards).

## 2. Re-traced journeys

### 2.1 Create at the cap of 30
`WantFormView.submit` → `useWants().create` → `write` → `passingMessageThrough` → `createWant`. The server's `_ensure_below_cap` raises `ActiveWantCapReached`, a `BusinessConflictException` (409) (`writes.py:86`, `errors.py:39`). The client wraps it in `WantWriteError(status 409)`. The form shows the server message verbatim with the "Zobacz listę" link to `/wanted` and keeps its fields filled. The link is tied to create + 409. The create path raises no other 409 (the other create errors are `ValueError` → 400, and the forward match's 503), so the link cannot appear for the wrong reason. **Holds.**

### 2.2 Take → closing prompt (`ItemPickupActions.tsx:40-52,88`, `useWantsMatchingItem.ts`)
- **Trigger**: `performTake` clears `takenItemId` and sets it again after a successful take (`useItemTake.ts:115,120`). The guard `isLoggedIn ? take.takenItemId : null` keeps guests out. `useWantsMatchingItem(itemId)` queries `[wants, "matching", token, itemId]` → `getMyWants(itemId)`.
- **Ordering**: `showClosePrompt` requires `!take.takeSuccess`, so after a term or event take the prompt waits for the "Wzięte!" sheet. After a personal take it opens right away, next to the toast. Tests: `ItemDetailPage.test.tsx:866,890`.
- **Close**: `CloseWantSheet.closeAll` sends `closeWant(FULFILLED)` per want → `invalidateQueries([wants])`. The matching query is still active, so it refetches. On a real server the closed wants drop out, the list is empty, and the sheet unmounts before `onClose` sets `promptDismissed`. Both paths end closed. A partial failure keeps the sheet open with only the failed wants left (after the refetch) and an inline error. 409 and 404 count as done.
- **"Szukam dalej"**: sets `promptDismissed`. The hook gets `null` and goes idle, with no refetch (the test asserts exactly 1 call).
- **Second take** (only possible after the reservation is cancelled, because the item is reserved after the first take): `takenItemId` goes null → id across an `await`, so these are two renders. `promptFor !== takenItemId` resets `promptDismissed`. The cached result shows at once and a refetch follows (staleTime 0). **Holds by reading, but no test covers it** (L1).

### 2.3 Scan with a want withdrawn mid-run (`match_notifications.write_bell_rows`)
`_wants_to_notify` selects and locks, in one statement, only ACTIVE wants with notifications on.
- A withdrawal committed before the statement: excluded.
- A withdrawal in flight: the lock waits for it, then re-checks the row and excludes it.
- A withdrawal after the lock: waits for the run. If the want was pointed, `updated_at` has moved, and the seeker's write gets the existing stale-version 409 (accepted earlier).

The excluded want gets no bell row. Its old unread row is neither deleted nor counted, and its pointer stays as it was (the test asserts `(first_row.id, 1)`). `_point_wants_at_rows` repeats the ACTIVE filter as a second safeguard. **Holds.**

### 2.4 Bell rows through `create_notifications` (`notifications/service.py:75-102`)
`create_notifications` writes one multi-row INSERT with ids generated in the app, in entry order, and returns them. `write_bell_rows` puts the match entries first and the expiring ones after, then zips `pointed` with `written[:len(pointed)]` (`strict=True`). This depends on the entry order, which the code guarantees and which `test_createNotifications_severalEntries_distinctIdsInEntryOrderInOneStatement` asserts (exactly one INSERT, ids match the rows). The per-row `created_at`/`updated_at` avoid the single-default problem of a multi-row insert. **Holds.**

### 2.5 0099 downgrade (`alembic/versions/0099_wants.py:149-162`)
The downgrade sets `lock_timeout`, then `DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND','WANT_EXPIRING')`, then drops in reverse dependency order. So no rows remain with a kind that the older code cannot read. `test_migration0099_downgradeUpgrade_roundTrip` seeds one WANT_MATCH_FOUND and one SWAP_PROPOSED row, downgrades to 0098, asserts that only SWAP_PROPOSED remains, and always upgrades back to head in `finally`. **Holds.**

## 3. Do the new behaviours have their own tests? (the test-suite runner's question)

| Behaviour | Test | Verdict |
|---|---|---|
| Status filter in `_wants_to_notify` | `test_wants_scan.py:233` (withdrawn want: no row, pointer unchanged; the active want gets the summed row and its pointer) | Yes |
| Row lock (`FOR UPDATE`, id order) | none | Not tested with two connections (L2) |
| `create_notifications` | `test_wants_notifications.py:78` (3 entries, 1 INSERT, ids in order, timestamps set, unread), `:115` (empty: no statement) | Yes |
| `delete_unread_notifications` | `test_wants_notifications.py:125` | Yes |
| Downgrade deletes WANT_* rows | `test_wants_migration.py:86` | Yes |
| Cap link on create 409 only | `WantFormView.test.tsx:314,349,367`, `useWants.test.tsx:126` | Yes |
| Matching hook / prompt | `ItemDetailPage.test.tsx:866,890,921` | Yes, except a second take (L1) |

The runner saw the backend total unchanged at 1471 because the fix cycle replaced tests for the removed `replace_unread_notifications` with tests for `create_notifications` and `delete_unread_notifications`. The total stayed flat, but coverage did not shrink.

## 4. Remaining gaps

| # | Severity | Gap | Location | Fixable | Suggestion |
|---|---|---|---|---|---|
| W1 | Warning (scheduled) | No live end-to-end run | whole stack | Yes | Phase 12: create from an empty search → a second account lists a match → one scan → bell → `/wanted/:id` → take → prompt → close; withdraw and reload; hit the cap at 30 |
| L1 | Low | Prompt reset on a second take (after a cancelled reservation) has no test | `ItemPickupActions.tsx:45-50` | Yes | One Vitest case: take → "Szukam dalej" → mock a cancel → take again → the prompt shows again |
| L2 | Low | The `FOR UPDATE` wait is not tested with two connections | `match_notifications.py:75` | Yes, but costly | Optional: two `AsyncSession`s on `engine`, withdraw in the first without committing, run `write_bell_rows` in a task, commit, assert no row. Acceptable to skip |
| I5 | Info | Expiry up to 15 min late | `scan.py:_expire` | - | Leave |
| I6 | Info | The bell is not polled | `hooks/useNotifications.ts` | Yes | Separate task for every kind (`refetchInterval`) |
| I7 | Info | Konto shows "brak" when loading the wants fails | `AccountView.tsx:12-15` | Yes | Show nothing (`undefined` meta) when `error`, as the reservations row does while loading |
| I8 | Info | Late-takeable items never matched; match list unbounded | `matcher.py` | - | Accepted risk |
| I9r | Info | Polish texts marked "to confirm"; the user guide still has the old mock screenshot | work log, `documentation/user-guide.md` | Yes | Confirm the texts with product; refresh the screenshot in the user-docs phase |

No critical or high gaps.

## 5. Functional completeness
About **96%**. Every behaviour in the problem statement is implemented, wired and backed by tests. The two warnings from the first check are now either fixed (W2) or scheduled as the next phase (W1). What remains is the live run and the release gate the user already accepted (scoring the labelled Polish sample).

## 6. Pragmatic action plan

| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Phase 12 live smoke (W1), including the cap at 30 and the closing prompt | Every step behaves as traced in section 2; the backend log has one `want scan:` line per run; a withdrawn want's URL shows "Nie znaleziono" | High (next phase) | 30-45 min |
| 2 | Add the second-take prompt test (L1) | New Vitest case green | Low | 20 min |
| 3 | I7: hide the Konto meta on a load error | No "brak" when `getMyWants` rejects | Low | 15 min |
| 4 | Confirm the Polish texts; refresh the screenshot (I9r) | Texts approved; the guide shows the real form | Low | 1 h |
| 5 | Release gate (already planned) | Thresholds 0.70 / 0.60 met | Required before deploy | Follow-up task |

## 7. Completion verdict
**⚠️ Complete with gaps (merge-ready).** The fixes are real, not cosmetic. The cap link now depends on the HTTP status. The scan can no longer notify about, or point at, a want that was withdrawn mid-run. Bell rows are written in one statement with known ids. The downgrade leaves no unknown notification kinds. Each of these has a targeted test. The one remaining thing that blocks deployment is the live run (Phase 12), followed by the release gate the user already accepted.
