# Pragmatic Review — Join a PRIVATE group by access code (re-verification, cycle 3, final)

Scope: all working-tree changes vs HEAD under `src/`. Project scale: small app, single uvicorn process, no production data. Standard applied: `.maister/docs/standards/global/minimal-implementation.md`. Cycle 3 changed only the frontend:
- TermPage now writes the code before the redeem, and `redeemStarted` replaces `signedOut`.
- The settle effect was adjusted.
- PrivateGroupGate gives the sheet a `key`.
- New TermPage tests were added.

## TL;DR

- **Status: Appropriate.** There are no Critical or Warning findings. TermPage is 160 lines (152 in cycle 2), with 3 `useState`, 0 refs and 1 effect. About 75 of those lines are the `#code=` / storage / guard logic.
- **That logic is still proportionate after three fix cycles.** Each guard pins a distinct, tested path. Cycle 3 swapped one guard for another rather than stacking a new one, and added one `key` attribute.
- **No clearly simpler design has the same behavior.** The best candidate reads storage once at mount (C3-4). It drops `redeemStarted` but adds a state of its own, saves about 2 lines, and changes one edge case. Not recommended.
- R1, R3, R4 and C2-3 are **residual-optional**. They stay unfixed by user choice, and none blocks.

## Open Questions / Risks

1. **`redeemStarted` is never reset** (`TermPage.tsx:61`). If React Router reuses the same TermPage instance for another group's term, a stored code for that group is ignored. A stored code can only exist after a login round trip, which unmounts TermPage, so this cannot happen today. Low risk. If it ever matters, give the route element a key, e.g. `key={groupId}`.
2. **The same code linked again while its 409 sheet is open is not resubmitted** (`PrivateGroupGate.tsx:114`). The key is unchanged, so the sheet is not remounted, and `autoSubmitted` stays set, so the old error stays visible. That retry would get a 409 again anyway, so I accept this.
3. **A hand-typed code is written to storage before every redeem** (`TermPage.tsx:99`). A 401 keeps it, as in cycle 2. Every other outcome removes it. Accepted.
4. **Cycle-2 Risk 2 is closed.** The test at `TermPage.test.tsx:879` now checks storage both during the redeem and after the 401. The test at `:682` checks that a typed code redeems exactly once, which is the path `redeemStarted` protects.
5. These are unchanged and accepted:
   - the limiter is single-process (ADR-003);
   - each blocked attempt logs a WARNING;
   - toast pills can overlap.

## Re-verification (cycle 3)

### TermPage `#code=` logic: size and moving parts

| Metric | Cycle 1 | Cycle 2 | Cycle 3 |
|--------|---------|---------|---------|
| TermPage LOC | 133 | 152 | 160 |
| Lines spent on the code link: storage helpers `:15-41`, read `:58-62`, opener `:70-80`, effect `:82-93`, `onJoin` `:95-114` | ~55 | ~70 | ~75 |
| `useState` in TermPage | 2 | 3 (`sheet`, `openedFor`, `signedOut`) | 3 (`sheet`, `openedFor`, `redeemStarted`) |
| Refs in TermPage | 0 | 0 | 0 |
| Effects in TermPage | 1 | 1 | 1 |
| Guards across the flow | 2 (`openedFor`, sheet `autoSubmitted` ref) | 3 (adds `signedOut`) | 3 guards (`openedFor`, `redeemStarted`, `autoSubmitted`) plus one remount `key` |
| New runtime dependencies | 0 | 0 | 0 |

Each guard has one job:
- `openedFor` opens the sheet once per link code.
- `redeemStarted` stops the page from reacting to its own write. Without it, a hand-typed code saved by `onJoin` at `:99` would show up as a "link code" on the next render. That would reopen the sheet with `autoSubmit` and a new key, and redeem twice.
- `autoSubmitted` stops StrictMode from running the effect twice.
- The `key` resets the sheet when a different link code arrives.

None of these overlaps another. Each is pinned by its own test: `:682`, `:779`, `:879` and `:933`.

### Findings

| ID | Severity | Location | Finding | Simplification | Fixable |
|----|----------|----------|---------|----------------|---------|
| C3-1 | Info, proportionate | `src/frontend/src/pages/krag/TermPage.tsx:97-109` | **Write before redeem.** `api/client.ts:36-41` sets `location.href` before the promise rejects. A save in the `catch`, as in cycle 2, relied on the `catch` running before the page unloads. Writing first and removing on every non-401 outcome is the smallest fix that does not depend on that timing. Cost: one line moved and one comment. | None. | n/a, keep |
| C3-2 | Info, proportionate | `TermPage.tsx:59-62`, `:100` | **`redeemStarted` replaces `signedOut`.** It is the same size: one state and one ternary. The meaning is clearer, "after a redeem, storage belongs to `onJoin`", and it covers the new write-before-redeem path, which `signedOut` could not. | See C3-4 for the only alternative. It is not better. | Optional, no smaller equivalent |
| C3-3 | Info, proportionate | `TermPage.tsx:82-93` | **Settle effect.** It is 12 lines with three outcomes: store for `loginRequired`; keep a valid code for `canEnterCode` (`onJoin` owns it from then on); clear otherwise. Then it strips the hash. Every branch is reachable and tested. | The R1 merge (open the sheet from here and drop `openedFor`) still applies. | Yes, optional (R1) |
| C3-4 | Info | `TermPage.tsx:61-62` | **Considered alternative: read storage once at mount.** `const [storedCode] = useState(() => readPendingCode(groupId)); const pendingCode = hashCode ?? storedCode;` then drop `redeemStarted`. Writes from `onJoin` then never reach the render. It is not clearly simpler: it is still one state, saves about 2 lines, and changes behavior. A logout on the page after a 409 would write the already-rejected code back to storage, through the `loginRequired` branch at `:84-86`, and the next login would auto-submit it. | Not recommended. Keep the current design. | n/a |
| C3-5 | Info, proportionate | `src/frontend/src/pages/krag/PrivateGroupGate.tsx:114` | **`key={codeSheet.initialCode}`.** This is the idiomatic React way to reset a component. It replaces any need for reset logic inside the sheet (`raw`, `serverError`, `autoSubmitted`) when a new link code arrives over an open 409 sheet. Cost: one attribute. | None. See Risk 2 for the one edge case, which is accepted. | n/a, keep |
| C3-6 | Info, proportionate | `src/frontend/src/test/TermPage.test.tsx:779`, `:879` | **New and changed tests.** `:779` covers the `key` remount. `:879` now checks storage during the redeem as well as after the 401, which closes cycle-2 Risk 2. The join-by-code `describe` has about 17 cases. Each still covers a separate state. | None. | n/a |

**Against `minimal-implementation.md`:** the cycle-3 code passes. No stubs, no speculative abstraction and no unused code (`ApiError` is used at `:104`, and `redeemStarted` is read at `:62`). The storage helpers are still local to their single consumer. The `#code=` flow has stabilised: the cycle-3 delta is about 8 lines, and it replaced a guard instead of adding one.

### Residual-optional items (left unfixed by user choice)

| ID | Status | Location now | Simplification | Fixable |
|----|--------|--------------|----------------|---------|
| R1 | **Residual-optional** | `TermPage.tsx:70-80` (render-phase `openedFor`), `:82-93` (effect) | Open the sheet from the effect and drop `openedFor`. This still works with `redeemStarted`. It saves about 6 lines and one state, at the cost of one extra commit before the sheet appears. | Yes, 15 min |
| R3 | **Residual-optional** | `src/backend/tests/test_group_join_code.py:214`, `:230`, `:262` | Fold the `caplog` assertions into `:214`. This removes one HTTP limiter test. | Yes, 10 min |
| R4 | **Residual-optional** | `src/backend/tests/test_group_join_code_migrations.py:56`, `:118` | Inline the two alias lines. | Yes, 2 min |
| C2-3 | **Residual-optional** | `TermPage.tsx:22-32` | Destructure the parsed entry inside the existing `try`, using a single typeof chain. This saves about 2 lines and one cast. | Yes, 5 min |

### Cycle-3 conclusion

The cycle-3 changes are proportionate for a small single-process app, so the review passes with no blockers.
- **What it fixed:** cycle 3 closed a redirect race and the reset of a sheet when a new link arrives.
- **What it cost:** about 8 net lines and one attribute.
- **Simpler designs:** none with the same behavior. I checked the read-once-at-mount design (C3-4) and rejected it.
- **What is left:** four optional items, R1, R3, R4 and C2-3, about 32 minutes in total, all residual-optional.

---

# Earlier cycles (kept for reference)

## Re-verification (cycle 2)

### Proportionality of the new TermPage logic

| ID | Severity | Location | Finding | Simplification | Fixable |
|----|----------|----------|---------|----------------|---------|
| C2-1 | Info, proportionate | `src/frontend/src/pages/krag/TermPage.tsx:94-99`, `src/frontend/src/hooks/useTermAccess.ts:62` | **401 write-back.** With an expired token the server degrades the visitor to anonymous, so the page shows `canEnterCode` and the redeem is what gets the 401. `api/client.ts:40-41` then redirects with `returnTo` set to path plus search, which drops the fragment. These 6 lines keep the code across that redirect. `{ cause: err }` is the standard ES2022 way to keep the `ApiError` behind the user-facing message (`lib: ES2023`) and costs nothing. | None needed. Putting the code into `returnTo` instead would bring back the server-visible URL leak that the fragment design removed. | n/a, keep |
| C2-2 | Info, proportionate | `TermPage.tsx:58-60`, `:98` | **`signedOut` state.** After the write-back, the next render reads the stored code, so `pendingCode` goes from `null` to the code. `accessKind` is still `canEnterCode`, because the client only removes `localStorage` and the AuthContext token stays set. Without the guard, the effect at `:86` would clear storage again before the redirect lands. The cost is one `useState` and one ternary. | Two alternatives were considered. A `useRef` would be read during render, which is discouraged, and is no shorter. Clearing storage only on success or close would undo the cycle-1 "strip at once" design and add more branches. Keep the guard. | Optional, no smaller equivalent |
| C2-3 | Info | `TermPage.tsx:22-32` | **`{code, savedAt}` with a 1h TTL.** This is the local fix for cycle-1 Risk 1. It beats coupling `AuthContext.logout` to a TermPage storage key. The reader grew from 7 to 11 lines, mostly from narrowing `unknown` to the expected shape, which the surrounding `try/catch` already covers. | Inside the existing `try`: `const { code, savedAt } = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? {};` then `return typeof code === "string" && typeof savedAt === "number" && Date.now() - savedAt < PENDING_CODE_TTL_MS ? code : null;`. This saves about 2 lines and one cast. Cosmetic. | Yes, optional, 5 min |
| C2-4 | Info, proportionate | `src/frontend/src/test/TermPage.test.tsx:848`, `:861`, `:874`, `:893` | **The 4 new tests.** Each pins a different branch: the 401 write-back, TTL expiry, the storage `catch` path, and StrictMode (render-phase `setState` plus `autoSubmitted`). None duplicates another. The join-by-code `describe` now has 16 cases. That is above the backend's 2–8 rule of thumb, but the frontend standard sets no count and each case covers a separate state. | None. See Risk 2 for the one optional assertion. | n/a |

Against `minimal-implementation.md`, the cycle-2 code passes. Every new line has a caller and an immediate need. There are no stubs, no speculative abstractions and no unused code. The two storage helpers are still local to the file, which is right while they have one consumer.

### Cycle-1 optional items (left unfixed by user choice)

| ID | Status | Location now | Note |
|----|--------|--------------|------|
| R1 | **Residual-optional** | `TermPage.tsx:68-78` (render-phase `openedFor`) and `:80-88` (effect) | Still valid. An effect-only version would still work with `signedOut`: `pendingCode` becomes `null` and the effect returns early. It saves about 6 lines and one state, at the cost of one extra commit before the sheet appears. |
| R3 | **Residual-optional** | `src/backend/tests/test_group_join_code.py:214`, `:230`, `:262` | Unchanged. Three HTTP tests still drive the limiter to 429. Folding the `caplog` assertions into `:214` removes one integration test. |
| R4 | **Residual-optional** | `src/backend/tests/test_group_join_code_migrations.py:56`, `:118` | Unchanged. The two alias lines remain. |
| R2, R5 | No change needed | — | R2's helpers grew by the TTL (see C2-3). R5 is unchanged. |
| R6, R7 | Residual, out of scope or optional | — | Unchanged. |

### Cycle-2 statistics

| Metric | Cycle 1 | Cycle 2 |
|--------|---------|---------|
| TermPage LOC | 133 | 152 |
| TermPage `useState` | 2 (`sheet`, `openedFor`) | 3 (adds `signedOut`) |
| Link "once" guards | 2 (`openedFor`, `autoSubmitted`) | 2. `signedOut` is a hand-off guard, not a "once" guard. |
| Open risks | 4 | 3 risks still open, 2 accepted notes; Risk 1 closed by the TTL |
| New runtime dependencies | 0 | 0 |

---

## 1. Complexity Assessment

| Area | Size now | Verdict |
|------|----------|---------|
| Backend (`join_code.py` 154 LOC incl. logging, `join_code_limiter.py` ~83, router ~48, `errors.py` +22) | ~300 LOC new, ~600 deleted | Appropriate. No infrastructure, no new dependencies. |
| Migrations 0059 / 0060 | 2 revisions, literal names | Appropriate. 0060 now reads like every other revision. |
| Frontend (TermPage 152 LOC, 133 in cycle 1; gate 142, sheet 141, card ~140, `useJoinCode` 54, `useTermAccess` +14) | ~470 new, ~1,000 deleted | Appropriate. The gate is now a pure view. Cycle 2 added about 19 lines to TermPage (C2-1 to C2-3). |
| Tests | ~50 new cases, 4 of them added in cycle 2 | Proportionate, with a small overlap (R3). |

Overall complexity: **Low to Medium**, which fits a small app.

## 2. Key Issues Found

### Critical
None.

### Warning
None. W1–W3 are resolved (see section 9), and cycle 2 added none.

### Info

**R1 — TermPage keys the link logic on the same condition in two places** (`src/frontend/src/pages/krag/TermPage.tsx:68-78` render-phase opener, `:80-88` storage and strip effect; line numbers as of cycle 2). Fixable. **Residual-optional.**
- The render phase opens the sheet through the `openedFor` state. The effect saves or clears storage and strips the hash. Both read `accessSettled`, `accessKind` and `pendingCode`.
- The split is defensible. Opening during render avoids one frame of the gate without the sheet. Using `openedFor` to adjust state from the previous render is a documented React pattern, not over-engineering.
- Simplification: because the strip is now immediate, an effect-only version would also work and drops the `openedFor` state. Add `if (accessKind === "canEnterCode") setSheet(...)` before `writePendingCode(groupId, null)` in the effect. The cost is one extra commit before the sheet appears.
- This saves about 6 lines and one `useState`. **Keep as is** unless someone finds the render-phase block confusing.

**R2 — The sessionStorage helpers are proportionate** (`TermPage.tsx:18-41`). No change needed. In cycle 2 they gained the TTL (see C2-3).
- The project's guidance says to wrap storage access in try/catch, and if storage fails the code simply doesn't survive login, which is graceful.
- The alternative, putting the code in `returnTo`, would leak it into the login URL query. So these helpers are the minimal correct mechanism.

**R3 — Three HTTP tests drive the limiter to 429** (`src/backend/tests/test_group_join_code.py:214`, `:230`, `:262`). Fixable. **Residual-optional.**
- The log test (`:230`) repeats the eleventh-attempt test (`:214`). The limiter's unit tests already cover the 30-per-group threshold.
- Simplification: fold the `caplog` assertions into the eleventh-attempt test. Optionally, also drop the 30-across-users HTTP test. Effort: about 10 minutes.

**R4 — Leftover aliases from the importlib removal** (`src/backend/tests/test_group_join_code_migrations.py:56` `table = _TABLE`, `:118` `column = _NOTIFICATION_COLUMN`). Fixable and trivial. **Residual-optional.**

**R5 — The audit logging is proportionate** (`src/backend/app/groups/application/join_code.py:121-154`). No change needed. It never logs the code, and its style matches `circles.py`.

**R6 — Toast pill markup is still duplicated** (`TermPage.tsx:114-121`, `JoinCodeCard.tsx:131-135`, plus 3 copies that predate this task). Residual and out of scope.

**R7 — JoinCodeCard's prop surface** (`src/frontend/src/components/panel/JoinCodeCard.tsx:15-23`). The spec requires this shape. Optional.

**C2-1 to C2-4** — see the cycle-2 table above. All are Info. Only C2-3 has an optional simplification.

## 3. Developer Experience

- The `#code=` flow still lives in one file, TermPage. Cycle 2 kept the new 401 path local to it, and `useTermAccess` changed only by one `{ cause }` argument. PrivateGroupGate is still a pure view.
- Each new piece of state carries a one-line "why" comment (`TermPage.tsx:58`, `:95`), and the helper's doc comment explains the TTL (`:18-21`).
- The new tests read as a list of scenarios and use the existing `renderPage` / `privateAccess` fixtures.

## 4. Requirements Alignment

- The implementation matches the spec's "Post-verification amendments": the fragment instead of a query, sessionStorage across login, and the immediate strip. The 401 write-back and the TTL extend the same "code survives login" requirement and add no new feature.
- Nothing speculative was added.
- Minor documentation drift remains: spec line 17 still says "`?code=`, the one-shot guard".

## 5. Context Consistency

- No `join_request` remnants were found in the app code.
- `ConfirmDeleteDialog` vs the Chakra `ConfirmDialog`: keep the current name. Renaming would collide with the existing `components/shared/ConfirmDialog.tsx`.
- No unused code was found. `ApiError` is a new import in TermPage, used at `:96`. `PENDING_CODE_TTL_MS` is used at `:28`.

## 6. Recommended Simplifications (top 3, all optional)

| # | Change | Before → After | Impact | Effort |
|---|--------|----------------|--------|--------|
| 1 | R3: merge the log assertions into the eleventh-attempt 429 test | 3 HTTP limiter tests → 2 (or 1) | 1 fewer slow integration test, about 30 fewer lines | 10 min |
| 2 | R1: open the sheet from the effect and drop `openedFor` | Render-phase block plus effect → effect only | About 6 fewer lines and one fewer state; one extra commit | 15 min |
| 3 | C2-3: destructure the parsed entry inside the existing `try` | `unknown` narrowing → a single typeof chain | About 2 fewer lines and one fewer cast | 5 min |

R4 (2 alias lines, 2 minutes) is also still open.

## 7. Summary Statistics

| Metric | Cycle 0 | Cycle 1 | Cycle 2 |
|--------|---------|---------|---------|
| PrivateGroupGate props | 12 | 10 | 10 |
| Gate-owned state or effects for the sheet | Focus ref + effect | None | None |
| Link "once" guards | 3 (Set, `stripOnSettle`, `autoSubmitted`) | 2 (`openedFor`, `autoSubmitted`) | 2, plus the `signedOut` hand-off guard |
| Migration constants exported for tests | 4 | 0 | 0 |
| `importlib` in tests | Yes | No | No |
| Unused hook fields | 1 (`error`) | 0 | 0 |
| New runtime dependencies | 0 | 0 | 0 |

## 8. Conclusion

The cycle-2 changes are proportionate for a small single-process app. They close two real gaps for about 20 lines, with no new abstractions or dependencies:
- an expired-token redirect that lost the code;
- an abandoned code that could outlive its visit.

No blockers remain. Every remaining item is Info, optional and fixable in under 35 minutes in total. R1, R3 and R4 stay residual-optional, by user choice.

## 9. Re-verification (cycle 1)

| ID | Finding (cycle 0) | Status | Evidence |
|----|-------------------|--------|----------|
| W1 | The `?code=` act-once logic was guarded three times | **Resolved** | The hash is stripped and storage cleared at once when access settles (`TermPage.tsx:80-88`). The `consumedCodes` Set and `stripOnSettle` are gone. `openedFor` is proportionate (R1). |
| W2 | PrivateGroupGate took 12 props, including 7 pass-through props | **Resolved** | It now takes one `codeSheet` object plus `hasPendingCode`, 10 props in all. The focus effect was removed. |
| W3 | The migration test loaded 0060 via importlib | **Resolved** | The test uses literals. Two trivial aliases are left over (R4). |
| I1 | The StaleDataError retry-once logic was duplicated | Residual, accepted | `join_code.py:75-100` |
| I2 | Limiter generic `_wait[K]`, tests reading private state | Residual, accepted | Cosmetic. |
| I3 | The gate had a duplicate focus return | **Resolved** | Removed along with W2. |
| I4 | JoinCodeCard takes 6 props | Residual, optional | R7 |
| I5 | `useJoinCode().error` was unused | **Resolved** | — |
| I6 | `ConfirmDeleteDialog` name | **Withdrawn** | The rename would collide with the existing `ConfirmDialog`. |
| I7 | Toast markup is duplicated | Residual, out of scope | R6 |
| I8 | Limiter thresholds are tested at unit and HTTP level | Residual | R3 |
