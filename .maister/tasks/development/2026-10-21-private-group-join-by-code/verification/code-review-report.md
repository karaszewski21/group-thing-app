# Code Review Report

**Date**: 2026-10-21
**Path**: working tree vs HEAD under `src/` (cycle 3 delta: `TermPage.tsx`, `PrivateGroupGate.tsx`, `TermPage.test.tsx`)
**Scope**: all (quality, security, performance, best practices)
**Cycle**: re-verification 3 (final)
**Status**: ⚠️ Issues Found (no critical; the only warning is the accepted residual W1)

## TL;DR
- I17 and G2 are **resolved**. Write-before-redeem makes the 401 case independent of redirect timing, and `key={initialCode}` remounts the sheet for a second link. W1 is still the accepted residual, and I18 is accepted by design.
- The ordering is correct for every case checked: effect order (child auto-submit runs before the parent settle effect), StrictMode, a typed code, a link code, a second link, 409/429/success/401 cleanup, and blocked storage.
- `redeemStarted` never suppresses a later `#code=` link, because the hash always wins. It only hides *stored* entries, and in the same group those can only be `onJoin`'s own.
- There are 2 new info items, neither blocking. I19: `redeemStarted` is not scoped to `groupId`. I20: overlapping redeems share one storage key. The code is still in no URL or log. tsc and eslint are clean, and vitest is 65/66 (the only failure is the pre-existing `Imię` test).

## Open Questions / Risks
- **W1 (accepted residual, OQ-8).** Concurrent redeems can still create duplicate active memberships. Tracked as a follow-up. The backend is unchanged.
- **Pre-existing failing test (unrelated).** `TermPage.test.tsx` "anonymous: 'Zaloguj się, żeby się zapisać' …" (the `Imię` label) still fails. It is outside this diff, but it keeps the suite red at merge.
- **Implicit coupling: the effect order.** The settle effect (`TermPage.tsx:88-91`) relies on `JoinByCodeSheet`'s auto-submit effect running first, in the same commit. React guarantees child-before-parent passive effects, so the code is correct today. The comment at `:88` says what happens but not why it is safe. If auto-submit were ever deferred (for example, until after a sheet animation), a stored entry would be neither removed nor taken over until the deferred submit runs. It would still be consumed, so this is not a defect. A one-line comment would help future editors.
- **Behaviour note (not a defect).** A hand-typed code is now in sessionStorage while its redeem is in flight. If the visitor reloads the page (F5) mid-request, the code is auto-submitted once more after the reload. The server is idempotent for an existing member: access resolves to `view` and the entry is removed. A 409 also removes it. This is harmless, and the exposure is the same as ADR-005 already accepts.
- **I19 and I20** are narrow edge cases (see below). Fix them now only if they are cheap. Both are one-liners.

## Summary
- **Critical**: 0
- **Warnings**: 1 (W1, accepted residual)
- **Info**: 13. That is 10 residual from cycle 0, I18 (accepted by design), and I19 and I20, which are new. I17 and G2 are resolved.

## Re-verification (cycle 3)

| ID | Cycle-2 finding | Result | Evidence |
|----|-----------------|--------|----------|
| W1 | Concurrent redeem can create duplicate active memberships | **Residual (accepted, OQ-8)** | No backend change in this cycle. Not re-escalated. |
| I17 | 401 write-back runs after the redirect has started | **Resolved** | `TermPage.tsx:97-100`: `writePendingCode(groupId, code)` runs synchronously before `joinWithCode`. So the entry is on disk before `fetch` is issued, and long before `client.ts:41` assigns `location.href`. The catch (`:104-106`) only *removes* on non-401, so no write races the navigation. Test: `TermPage.test.tsx:879-899` asserts the entry exists *during* the redeem and still exists after the 401. |
| G2 | A second `#code=` link while a sheet is open was not re-submitted | **Resolved** | `PrivateGroupGate.tsx:114` `key={codeSheet.initialCode}`: a new code remounts the sheet with a fresh `autoSubmitted` ref and `raw` state. The hash wins over `redeemStarted` (`TermPage.tsx:62`). Test: `TermPage.test.tsx:779-807` (409 on the first link, then a `<Link>` to `#code=582913`): the second redeem happens once, with the new value in the field, no stale alert, and the hash stripped. |
| I18 | Profile-less account gets a manual login loop | **Accepted by design** (spec) | Unchanged. Write-before-redeem keeps the same once-per-manual-login behaviour. |
| I2-I9, I11, I12 | Residual info items | Unchanged | Not touched by this delta. |

### Verification of the cycle 3 changes

**Effect order (link code, logged in, `canEnterCode`)** (`TermPage.tsx:62-114`, `JoinByCodeSheet.tsx:54-81`)
1. In the render where access settles, `linkCode` is the hash code. The render-phase `setOpenedFor`/`setSheet` (`:74-80`) re-renders before commit, so the sheet is mounted in the same commit as the settle effect's dependency change.
2. Passive effects run children first. The sheet's auto-submit effect (`:76-81`) calls `submit`, which calls `onJoin(code)`. The synchronous prefix of `onJoin`, `writePendingCode` and `setRedeemStarted(true)`, runs inside that effect.
3. Then the parent settle effect runs, with the closure from that render (`pendingCode` = the hash code). The kind is `canEnterCode` and the code is valid, so it does **not** remove the entry. It strips the hash (`:92`).
4. On the next render, `hashCode === null` and `redeemStarted === true`, so `pendingCode === null` and `linkCode === null`. `openedFor` resets, and the sheet stays (it is not touched when `linkCode` is null).
5. On settle: success removes the entry (`:109`), and 409/429/network/other errors remove it (`:104-106`). A 401 keeps it, and `client.ts` navigates to `/login?returnTo=pathname+search`.
- **No orphan entry is possible.** The settle effect skips removal only for a *valid* code in `canEnterCode`. Every such state mounts a sheet with `autoSubmit: true` under a key equal to the code. A fresh instance always auto-submits, so `onJoin` takes over the entry. A malformed code takes the removal branch (`:89`), and so do `view`, a stale link and other gates.

**StrictMode** (verified by reading the code and by `TermPage.test.tsx:933-942`)
- The double render is pure. The render-phase setState is guarded and converges.
- The simulated unmount/remount re-runs both effects. The sheet's `autoSubmitted` ref survives, so there is no second `onJoin`. The settle effect's second run repeats a no-removal plus `navigate(replace)`, which is idempotent.
- `setRedeemStarted(true)` is called from an effect, not from render, so it is not double-invoked.

**Hand-typed code** (sheet opened via `onOpenSheet`, key `""`)
- `onJoin` writes the entry and sets `redeemStarted`. Both run synchronously in the submit handler's continuation, and React batches them, so no render sees a stored entry with `redeemStarted === false`. The sheet therefore cannot be reopened from storage mid-redeem.
- A 401 keeps the code for after login, which matches the doc comment at `:50-51` (and the cycle-2 behaviour note). Other outcomes remove it.

**Second link (G2) and `redeemStarted` suppression**
- `pendingCode = hashCode ?? (redeemStarted ? null : readPendingCode(groupId))` (`:62`). A new `#code=` is never suppressed. After a 409 (entry removed, `redeemStarted` true), opening link B in the same document updates `location.hash`, so `linkCode = B` differs from `openedFor` (`null`). The sheet gets `{B, autoSubmit}`, and the key change remounts it, so B auto-submits once.
- Opening the *same* code again while its 409 sheet is still open keeps the key, so it does not resubmit. The sheet stays open with that code and its error, and the visitor can press "Dołącz". This is acceptable, because the code already failed once.
- `redeemStarted` hides only *stored* entries. For the same group, the only way an entry can appear after a redeem has started is through `onJoin`, or through the `loginRequired` branch. The `loginRequired` branch keeps the hash in the URL, and the hash wins. Logging in through `/login` unmounts `TermPage`, and the remount resets the flag. So the flag cannot wrongly suppress a legitimate same-group code. A cross-group case exists: see I19.

**Blocked storage**: `writePendingCode` and `readPendingCode` swallow every exception (`:23-41`), so a hash link still redeems exactly once (`TermPage.test.tsx:914-931`). Only survival through a 401 is lost, as documented.

**Code never in a URL or a log**
- The hash is stripped with `navigate(replace)` (`:92`). `returnTo` uses `pathname + search` (`client.ts:40`, `AuthGateSheet.tsx`). The redeem sends the code in the POST body.
- No `console.*` calls are in `TermPage.tsx`, `PrivateGroupGate.tsx`, `JoinByCodeSheet.tsx` or `useTermAccess.ts`.
- The React `key` is the code. Keys are not rendered into the DOM or the URL. They appear only in React DevTools, in the visitor's own browser, which is no new exposure.

**Tests**
- G2 test (`:779-807`): it uses a real `<Link>` inside the same `MemoryRouter`, which faithfully models a same-document hash navigation. It asserts the redeem count before and after.
- The reworked 401 test (`:879-899`): it holds the redeem promise open and checks storage *during* the redeem, then after the 401. This tests the ordering property directly rather than only the outcome. Good.
- The stale-link test (`:757-777`) asserts that the entry is removed after a 409.

### New in cycle 3

- **I19 (correctness, edge case; severity: info; fixable: true)**: `redeemStarted` is not scoped to `groupId`.
  - **Locations**: `src/frontend/src/pages/krag/TermPage.tsx:61-62`, and `src/frontend/src/router.tsx:162-163`, which has no `key`, so the `TermPage` instance is reused across in-app navigation between terms and groups.
  - **What happens**: after any redeem in group A, the visitor navigates in-app to group B's term page, and the same instance keeps `redeemStarted === true`. A valid `pendingJoinCode:B` entry is then not read, and the sheet does not auto-open. Such an entry would come from an earlier anonymous visit to a B link in this tab, within the 1-hour TTL.
  - **Impact**: very narrow. The visitor can still press "Mam kod dostępu" and type the code, and the leftover entry expires after its TTL. The cycle-2 `signedOut` flag had the same scoping, but there a reload always followed. `redeemStarted` is set on *every* redeem, so the instance can live on.
  - **Fix**: store the group instead of a boolean, `const [redeemStartedFor, setRedeemStartedFor] = useState<string | null>(null)`, and read storage only when `redeemStartedFor !== groupId`.
- **I20 (correctness, edge case; severity: info; fixable: true)**: overlapping redeems share one storage key.
  - **Locations**: `TermPage.tsx:104-109`, `PrivateGroupGate.tsx:114`, `JoinByCodeSheet.tsx:40,56,84`.
  - **What happens**: a second link (G2) that arrives while the first redeem is still in flight changes the key. That unmounts the busy sheet, bypassing the busy-close guard the sheet documents, and starts a second `onJoin`. If the first redeem then settles with a non-401, it removes the entry the second one wrote. If the second then gets a 401, its code is lost through login. If the first one succeeds, `setSheet(null)` also closes the second sheet mid-flight, so the second redeem's result is not shown anywhere.
  - **Impact**: this needs two different links opened within one request round trip. The URL stays clean, so nothing leaks, and the recovery is to click the link again.
  - **Fix**: on a 401, re-write the entry (`writePendingCode(groupId, code)` in the catch), so it no longer depends on the other call. Or remove the entry only when the stored code equals the call's own code. Optionally, ignore a new link while the sheet is busy.

### Static checks and tests (cycle 3)
- `tsc -p tsconfig.app.json --noEmit`: ✓ (exit 0)
- eslint (`TermPage.tsx`, `PrivateGroupGate.tsx`, `TermPage.test.tsx`): ✓ (no output)
- vitest `TermPage.test.tsx` + `useTermAccess.test.ts`: 65 passed, 1 failed. The failure is the pre-existing `Imię` test in "sign-up footer", which is unrelated.
- Backend: not re-run, since no backend file changed in this cycle.

## Re-verification (cycle 2)

| ID | Cycle-1 finding | Result | Evidence |
|----|-----------------|--------|----------|
| W1 | Concurrent redeem can create duplicate active memberships | **Residual (accepted, OQ-8)** | The backend has not changed since cycle 1. `join_code.py:150-158` is still check-then-insert. Not re-escalated. |
| I13 | A link code is lost after a 401 on redeem | **Resolved** (see I17 for the ordering caveat) | `TermPage.tsx:94-100`: when `err.cause` is an `ApiError` with status 401, `onJoin` calls `writePendingCode(groupId, code)` and then `setSignedOut(true)`. `useTermAccess.ts:62` preserves the cause with `new Error(msg, { cause: err })`. Test: `TermPage.test.tsx:848-859`. |
| I14 | No blocked-storage test and no StrictMode test | **Resolved** | `TermPage.test.tsx:874-891` stubs a `sessionStorage` that throws on every method: one redeem, and the hash is stripped. `:893-902` renders under `<StrictMode>`: one redeem, and the hash is stripped. |
| I15 | A pending code lingers for the tab's lifetime | **Resolved** | `TermPage.tsx:16,22-32`: the entry is stored as `{code, savedAt}` with a 1-hour TTL, and malformed or stale entries read as `null`. Test: `TermPage.test.tsx:861-872`. |
| I16 | The decision log was out of date | **Resolved** | `decision-log.md:177` (ADR-005) and `:285` (ADR-008) now carry "Superseded (2026-10-21) in part by … Post-verification amendments" notes. |
| I2-I9, I11, I12 | Residual info items | Unchanged | Not touched by the cycle 2 delta. |

### Verification of the cycle 2 changes

**401 write-back** (`TermPage.tsx:90-106`, `useTermAccess.ts:57-67`, `api/client.ts:36-50`)
- Sequence for a logged-in visitor with `#code=`:
  1. On the settled `canEnterCode` render, the sheet opens with `autoSubmit`.
  2. The effect removes the storage entry and strips the hash (`:86-87`).
  3. The sheet auto-submits once (`JoinByCodeSheet.tsx:76-81`).
  4. The redeem gets a 401.
  5. `client.ts` removes the token, sets `window.location.href = /login?returnTo=pathname+search`, reads the body, and throws `ApiError(401)`.
  6. `joinWithCode` wraps it, preserving the cause.
  7. `onJoin` writes `{code, savedAt}`, sets `signedOut`, and rethrows. The sheet shows the message until the page unloads.
  8. After login, `returnTo` brings the visitor back, `readPendingCode` returns the code, and it is auto-submitted once.
- The `instanceof` chain is sound. `redeemJoinCode` is a bare `api.post` (`api/groups.ts:484-485`), so `err` in `joinWithCode` is the `ApiError` itself.
- Only 401 is kept. A 409 (wrong or stale code) or a 429 does not write anything back, so a bad code cannot loop.
- **Interleaving check.** `writePendingCode` and `setSignedOut(true)` run synchronously in the same continuation. React batches the state update, so no render can happen in between. Without that guarantee, a render with `pendingCode = readPendingCode(...)` and `openedFor === null` would reopen the sheet, and the effect would clear storage again. That cannot happen here. The next render already has `signedOut === true`, which gives `pendingCode === null` and `linkCode === null`. `openedFor` stays `null`, the effect returns early at `:81`, and the stored code survives.
- **StrictMode.** `setSignedOut` runs in an async event continuation, not in render or an effect, so it is not double-invoked. A double render with `signedOut === true` is pure. The StrictMode test covers the success path, and the 401 path uses the same render logic.
- **Can `signedOut` get stuck?** It is component state with no reset path. It is only reachable after a 401, and `client.ts:39-41` always navigates away then, because `TermPage` is never at `/login`. The full reload remounts with `signedOut = false`. No `beforeunload` handler exists in `pages/krag`, `JoinByCodeSheet` or `useTermAccess` that could cancel the navigation. It is also not keyed by `groupId`, but that cannot be observed for the same reason. Not a finding.
- **Ordering versus the redirect.** The write happens after `window.location.href` has been assigned. See I17.

**TTL** (`TermPage.tsx:16,22-41`)
- `JSON.parse` in try/catch covers these cases:
  - A cycle-1 plain-string entry: JSON of digits parses to a number and is rejected by `typeof object`; anything else throws and is caught.
  - Non-object values, a missing `code` or `savedAt`, or wrong types are all rejected.
  - A `NaN` `savedAt` fails the `<` comparison, so it is ignored.
- Expired entries are ignored but not removed. They are harmless, since they live per tab and are never acted on.
- `savedAt` is refreshed whenever the `loginRequired` effect re-runs (`:82-84`), so the TTL counts from the last visit to the page while anonymous. This fits "abandoned link" semantics.
- A `savedAt` in the future, after a backwards clock change, would be accepted until the clock catches up. This is negligible, because only the page itself writes the value.
- The code read from storage is not trusted. It goes through `parseJoinCode` (`:75`), and a malformed value opens the sheet empty, without auto-submit.

**`Error` `cause` support**
- `tsconfig.app.json` sets `target`/`lib` to `ES2023`, which includes `lib.es2022.error.d.ts`. `tsc -p tsconfig.app.json` is clean.
- At runtime, `cause` is supported in Chrome 93+, Firefox 91+ and Safari 15+, all below Vite 8's default build target.
- In an engine without `cause`, `err.cause` would be `undefined`. The write-back would then be skipped silently, which degrades to the cycle-1 behaviour. Nothing breaks.

**The code is never in a URL or a log**
- The hash is stripped (`:87`) in the effect of the same commit that opens the sheet, before the auto-submit's POST can resolve. The 401 test asserts that the hash is empty.
- The `returnTo` in `client.ts:40` uses `pathname + search` only.
- The code travels in the POST body (`api/groups.ts:485`).
- No `console.*` calls are in the changed files.
- The wrapped `Error` message is the server's problem message or a constant. The `ApiError` cause carries status and body, and the backend never echoes the code. It is held in sessionStorage only, as ADR-005 accepts.

**Tests** (`TermPage.test.tsx`)
- The `waitFor` changes wrap the hash assertions (`:741,753,769,783,845,855,885,899`), because the strip now happens in an effect after the redeem. This is correct, since the assertions are asynchronous by nature.
- `beforeEach` calls `sessionStorage.clear()` (`:156`), so the 401 test's write cannot leak into the TTL test.
- The blocked-storage test restores the global in `finally`, via `vi.unstubAllGlobals()`.

### New in cycle 2

- **I17 (best_practices, fixable: true)**: the 401 write-back runs after the redirect has started.
  - **Locations**: `src/frontend/src/pages/krag/TermPage.tsx:94-99`, `src/frontend/src/api/client.ts:37-50`, `TermPage.tsx:86`.
  - **What happens**: `client.ts` sets `window.location.href` and then awaits `response.json()` before throwing. The write in `onJoin` therefore runs while the navigation is in flight. Browsers keep running the old document's JS until the new document commits, and a small, already-buffered 401 body resolves within microtasks or a task. That makes this reliable in practice, but nothing guarantees the order. A very fast `/login` response, for example a cached `index.html`, could in theory commit first.
  - **Impact**: the same failure as the old I13: the visitor has to click the link again. The URL stays clean, so there is no leak.
  - **Fix**: do not clear storage while a link-triggered redeem is pending. Keep the entry at `:86` when the sheet is opened with `autoSubmit`, and remove it in `onJoin` after success or a non-401 failure. Alternatively, write the pending code before calling `joinWithCode` and remove it on any outcome other than 401. Either way the order stops mattering, and `signedOut` is still needed to stop re-acting on the entry.
- **I18 (correctness/UX, fixable: false)**: a profile-less account gets a manual login loop.
  - **Location**: `src/backend/app/groups/application/join_code.py:36-45` (the existing 401 for a token with no `UserProfile`) combined with `TermPage.tsx:94-99`.
  - **What happens**: a profile-less account is sent to login. After it logs in again, the stored code auto-submits, gets 401 again, and is written back again with a fresh `savedAt`. Each round needs a manual login, so the loop is not automatic.
  - **Assessment**: profile-less accounts should not occur in normal sign-up flows, and the 401 semantics were settled before this cycle. Record only. If it matters, write the code back only once, for example with a `retried` flag in the stored entry.

### Static checks and tests (cycle 2)
- `tsc -p tsconfig.app.json`: ✓
- eslint (`TermPage.tsx`, `useTermAccess.ts`, `TermPage.test.tsx`): ✓
- vitest `TermPage.test.tsx` + `useTermAccess.test.ts`: 64 passed, 1 failed. The failure is the pre-existing `:347` `Imię` test.
- Backend: not re-run, since no backend file changed in this cycle. Cycle 1 had 20/20 passing.

## Re-verification (cycle 1)

| ID | Previous finding | Result | Evidence |
|----|------------------|--------|----------|
| W1 | Concurrent redeem can create duplicate active memberships | **Residual (accepted, OQ-8)** | `join_code.py:150-158`: still check-then-insert, with no unique index. Not re-escalated. |
| W2 | Format alert fires while typing | **Resolved** | `JoinByCodeSheet.tsx:45-52`: a `touched` flag is set on blur (`:111`) and on submit (`:89`). The alert shows immediately only for non-digits or more than 6 digits; a partial code shows nothing. Submit stays disabled until valid (`:132`). |
| W3 | `useJoinCode` shape / disabled = loading | **Resolved** | `useJoinCode.ts:149-194`: a disabled query returns `idle`, and the `error` field is removed. The shape is documented in spec amendment R18. The key name `joinCode` matches spec R18 (`JOIN_CODE_KEY`); only the decision-log text still says `groupJoinCode` (I16). |
| W4 | Regenerate makes an extra GET | **Resolved** | `useJoinCode.ts:177-185`: `setQueryData([JOIN_CODE_KEY, groupId], res)` replaces the invalidation, and the error is rethrown via `serverMessageOr`. |
| I1 | Code in nginx access log via `?code=` | **Resolved** | `JoinCodeCard.tsx:67` builds `…#code=${code}`, and `TermPage.tsx:49` reads `location.hash`. Browsers never send a fragment, so nginx `$request` and the Referer cannot contain it. |
| I2 | `stored is None` short-circuits before `compare_digest` | Residual (info) | `join_code.py:146` |
| I3 | `GET /join-code` reachable with `mcp:read` | Residual (info) | `router/join_code.py:21,39` |
| I4 | StaleDataError retry does not re-check active organizer | Residual (info) | `join_code.py:105-113` |
| I5 | Limiter keys pruned only on access | Residual (info) | `join_code_limiter.py` |
| I6 | Data DELETE inside schema migration 0060 | Residual (info, ADR-006 settled) | `0060_drop_group_join_requests.py:50` |
| I7 | GroupDetailsPage loads all terms; browser-TZ "today" | Residual (info) | `GroupDetailsPage.tsx` |
| I8 | Toast pill duplicated, with a hard-coded rgba | Residual (info) | `TermPage.tsx:95-102` (rgba at `:97`) and `JoinCodeCard.tsx` |
| I9 | Only `groupAccess` is invalidated after a join | Residual (info) | `useTermAccess.ts:57-67` |
| I10 | Migration test loaded 0060 via importlib and echoed its constants | **Resolved** | The 0060 upgrade and downgrade use literal names (`:52-95`), and `test_group_join_code_migrations.py:131-143` asserts the hard-coded `pk_`, `fk_`, `ix_` and `uq_` names and the `PENDING` predicate. |
| I11 | 404 before 401 for a profile-less token on an unknown group | Residual (info) | `join_code.py:81-82` |
| I12 | Skeleton flash before 403 hides the card | Residual (info, ADR-008) | `JoinCodeCard.tsx` |

### New code verified in this cycle

**TermPage hash and sessionStorage lifecycle** (`src/frontend/src/pages/krag/TermPage.tsx:14-78`)
- `pendingCode = hashCode ?? readPendingCode(groupId)` (`:49-50`). A storage read during render is pure and cheap, and both helpers swallow exceptions (`:18-33`). With blocked storage, a hash code still works for logged-in visitors. Only the trip through login is lost, as the comment documents.
- Nothing happens until `accessSettled` (`access !== null && !isStale`, `:56`), so a token change cannot act on another token's gate. The M8 test covers this.
- **`loginRequired`**: the code is written to `pendingJoinCode:{groupId}` and the hash is kept (`:72-74`).
- **Any other settled state**: the storage entry is removed, and the hash is stripped with `replace: true`, keeping `search` (`:76-77`). This covers `view` (an existing member), `canEnterCode` and the stale-link cases.
- **Render-phase setState** (`:60-68`): this is React's documented pattern for storing information from previous renders. `setOpenedFor` and `setSheet` target the same component, are guarded by `linkCode !== openedFor`, and set deterministic values, so they converge in one extra render and are idempotent under StrictMode's double render. Once the effect clears storage and the hash, `linkCode` becomes `null`, so `openedFor` resets without touching `sheet`, and the open sheet stays open. A malformed code opens the sheet empty, without auto-submit, as spec R26 requires. The auto-submit-once guarantee lives in the sheet's `autoSubmitted` ref (`JoinByCodeSheet.tsx:76-81`), which survives StrictMode's effect re-run. The effect itself is idempotent: remove plus navigate-replace twice is harmless.
- **`PrivateGroupGate`** renders the sheet only when `!stale && gate.kind === "canEnterCode" && codeSheet` (`PrivateGroupGate.tsx` overlay). The single `codeSheet` prop removes the earlier two-prop coupling.

**The code is never in a request URL or a log**
- Shared link: `JoinCodeCard.tsx:67` uses a fragment.
- `returnTo`: `AuthGateSheet.tsx:11` (`pathname + search`, with a comment explaining why the fragment is left out), `AuthGuard.tsx:35`, and the 401 redirect in `api/client.ts:39-41` (`pathname + search`). None of these includes `location.hash`.
- API: `redeemJoinCode` POSTs `{ code }` in the body (`api/groups.ts:484-485`). Only the organizer's GET and regenerate *responses* carry it.
- Backend logging: the only logger calls in `join_code.py` are at `:137-142` (blocked: `group_id`, `party_id`, `retry_after_seconds`) and `:164-167` (redeemed: `group_id`, `party_id`, `created`). There are no exception messages containing the code. The 429 message comes from the limiter, and the 409 is a constant.
- The validation handler (`core/errors.py:120-127`) returns Pydantic's `msg` only, never `input`, and logs nothing. The global logging handlers (`:108`, `:114`, `:158`) log method and path only, or a traceback for an unhandled exception, which no code path here produces with the code in it.
- `test_group_join_code.py:231-259` asserts that neither the correct code nor the wrong code appears in any captured record.

**Audit log content**: it holds ids and outcome only. Wrong-code attempts are not logged one by one; only the lock-out is. That is enough for the abuse signal and avoids noise. The party UUID is pseudonymous.


## Critical Issues
None.

## Warnings

### W1. Concurrent redeem can create duplicate active memberships (accepted residual, fixable: false)
- **Location**: `src/backend/app/groups/application/join_code.py:150-158`
- **Status**: Not fixed, by your decision; tracked as OQ-8. Recorded here for traceability only. The earlier recommendation (a partial unique index plus a SAVEPOINT catch, or a group row lock) stands for the follow-up.

## Informational

### New in cycle 3
- **I19** (info, fixable: true; `TermPage.tsx:61-62`, `router.tsx:162-163`): `redeemStarted` is not scoped to `groupId`.
- **I20** (info, fixable: true; `TermPage.tsx:104-109`, `PrivateGroupGate.tsx:114`): overlapping redeems share one storage key.
- Details for both are under "Re-verification (cycle 3)" above.

### Resolved in cycle 3
- **I17** is resolved by write-before-redeem.
- **G2** is resolved by the sheet `key` plus hash precedence.

### Accepted by design
- **I18**: a profile-less account gets a manual login loop. See the spec.

### Resolved in cycle 2
- **I13**, **I14**, **I15** and **I16** are resolved. The original texts are kept below for traceability.

### New in cycle 1

- **I13 (correctness/UX, fixable: true)**: an auto-submitted link code is lost when the redeem returns 401.
  - **Locations**: `src/frontend/src/pages/krag/TermPage.tsx:70-78`, `src/frontend/src/api/client.ts:37-42`.
  - **What happens**: on the first settled `canEnterCode` render, the effect removes the storage entry and strips the hash, before the auto-submitted redeem resolves. If that POST gets 401, `client.ts` hard-redirects to `/login?returnTo=pathname+search`, and the code survives nowhere. The URL stays clean, so this is not a leak.
  - **When it can happen**: the server rejects a token the client still considers valid, for example after a secret rotation or for a profile-less account (`join_code.py:51-57`), or the token expires while the sheet is open.
  - **Impact**: narrow. `AuthContext.tsx:52-67` drops expired tokens at load, which turns the common stale-token case into `loginRequired`, and that path keeps the code. Recovery is to click the link again.
  - **Fix**: in `onJoin`, on a 401, call `writePendingCode(groupId, code)`. Alternatively, defer the storage removal until the redeem settles.
- **I14 (testing, fixable: true)**: two TermPage behaviours have no test.
  - **Locations**: `src/frontend/src/test/TermPage.test.tsx` (code-link block around l.734-860), `src/frontend/src/main.tsx:13`.
  - **What is untested**:
    - sessionStorage that throws on `getItem`/`setItem`. A blocked-storage visitor with `#code=` should still redeem once.
    - The code-link flow under `<StrictMode>`. The app runs under StrictMode, so this is the path users get.
  - **Why it matters**: the code is correct by inspection. These tests would lock in the try/catch and the render-phase pattern against regressions.
- **I15 (best_practices)**: a pending code lingers if the visitor never logs in.
  - **Location**: `src/frontend/src/pages/krag/TermPage.tsx:72-74`.
  - **What happens**: an anonymous visitor who never logs in leaves `pendingJoinCode:{groupId}` in sessionStorage for the tab's lifetime. A later login in that tab, even from another term of the same group, opens and auto-submits the sheet.
  - **Assessment**: the scope is per tab and per origin, and the behaviour arguably matches intent. Exposure is no greater than the hash already in history, as ADR-005 accepts. Optionally store `{code, savedAt}` and ignore entries older than about 1 hour.
- **I16 (docs, fixable: true)**: the decision log is out of date.
  - **Locations**: `analysis/research-context/decision-log.md:299` and ADR-005, which use `?code=` (5 occurrences).
  - **What is stale**: the ADR text still says `?code=`, `groupJoinCode` and `{data, loading, error, refetch, regenerate}` with prefix invalidation. `implementation/spec.md:445-452` (the post-verification amendments) supersedes all of this.
  - **Fix**: add a one-line "superseded by spec amendments 2026-10-21" note to ADR-005 and ADR-008, so readers do not reintroduce the query-string link.

### Residual from cycle 0 (unchanged, see the table above)
I2, I3, I4, I5, I6, I7, I8, I9, I11 and I12. Their descriptions and recommendations are as in the cycle 0 report. None regressed.

## Metrics
- Max function length (changed code): `onJoin` is 18 lines. The `TermPage` component body is about 110 lines including JSX.
- Max nesting depth: 3
- Potential vulnerabilities: 0 critical, 0 warning. Info: I2 and I3. No code-in-URL or code-in-log path.
- N+1 query risks: 0
- Static checks (cycle 3):
  - tsc: ✓
  - eslint: ✓
- Tests (cycle 3): `TermPage.test.tsx` + `useTermAccess.test.ts` 65/66. The one failure is pre-existing and unrelated.
- Cycle-1 backend tests: 20/20 (unchanged since).

## Prioritized Recommendations
1. Fix or quarantine the pre-existing `Imię` label failure in `TermPage.test.tsx` ("sign-up footer"), so the suite is green at merge. It is outside this task's diff.
2. W1 follow-up (OQ-8): add the partial unique index plus a SAVEPOINT catch.
3. Optional one-liners:
   - I20: re-write the entry on a 401 in `onJoin`'s catch.
   - I19: scope `redeemStarted` to `groupId`.
   - Add a comment at `TermPage.tsx:88` noting that the child's auto-submit effect runs before this effect.
4. Residual info items (I3, I4, I8) as capacity allows.
