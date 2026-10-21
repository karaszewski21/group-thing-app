# Reality Check: join a private group by code (re-verification, cycle 3, final)

## TL;DR
- **Status: ⚠️ Issues Found. Nothing critical, high or low-and-actionable. The code is done; the only open item is the Phase 12 runtime run (SC1/SC7).** Traced again end to end: link → gate → login/registration → return without the hash → auto-submit → view → RSVP, plus the 401 → reload → login → auto-redeem branch.
- **Resolved since cycle 2:** G2 (`key={codeSheet.initialCode}` at `PrivateGroupGate.tsx:114`, tested at `TermPage.test.tsx:779`), G4/G5 (spec amendment `spec.md:449-453`), and code-review I17 (the code is now written *before* the redeem, `TermPage.tsx:97-100`, so the 401 redirect no longer races the write-back).
- `redeemStarted` (`TermPage.tsx:61-62`) correctly stops the page's own pre-written entry from reopening or re-submitting the sheet. It does **not** block a different `#code=` link, because `hashCode` takes precedence over the guard.
- Tests were not re-run here. From `verification/test-suite-results.md`: backend 860/860; frontend 1015/1022 (6 failures that already existed, plus 1 flaky OrganizerEditor test in an untouched file); `tsc -b` clean; TermPage 57/58 in each of 3 runs (the failure is the pre-existing sign-up-footer test).

## Open Questions / Risks
- **There is still no runtime evidence (SC1/SC7).** Everything here comes from reading code and from vitest runs with the API mocked. The full real sequence (a real `client.ts` 401 → `window.location.href` reload → login → auto-redeem) has never run as one piece. Phase 12 must include step (i).
- **New, Info:** `TermPage`'s `sheet`/`openedFor`/`redeemStarted` state is not reset when `groupId`/`termId` change. The route element is not keyed, so React Router reuses the instance. If a link sheet (`autoSubmit: true`) is still open after a 409 and the user navigates *inside the SPA* to another private group's term page, the sheet can come back over that group's gate. If that group's access was not cached, the remounted sheet auto-submits the old code to the new group. This is very hard to reach: the `#code=` link has to arrive via in-app SPA navigation, then the user has to press Back/Forward while the modal is open. The worst outcome is one failed attempt (409) counted against that group's limiter. See G8.
- **New, Info:** the key remount bypasses the sheet's "cannot close while busy" rule. If a second link arrives while the first redeem is still in flight, two redeems run concurrently, and the first one's `writePendingCode(null)` can remove the second one's entry. This only matters if the second redeem then gets a 401. The window is about one round-trip. See G9.
- **Accepted, recorded in the spec:** G5 (a kept code is redeemed by the next account to log in in that tab within 1h) and I18 (a profile-less account gets a backend 401, `client.ts` logs it out, and every manual login re-sends the code, until onboarding or the 1h TTL ends it). Product owner: please confirm that I18's "one manual login per loop" is acceptable for profile-less accounts. It only affects users who skipped onboarding.
- Accepted earlier and unchanged: the group-wide limiter can lock out a whole group (DoS); the limiter runs in a single process; the organizer is not notified when someone joins; PUBLIC→PRIVATE brings back the old code; the copy-link term can go stale; login in another tab loses the code (G3).

## Re-verification (cycle 3)

### What changed (checked in code)

| Change | Where | Verified |
|---|---|---|
| Pending code written before the redeem; removed on success or on any non-401 error; kept on a 401 | `TermPage.tsx:95-114`. `writePendingCode(groupId, code)` is the first statement of `onJoin`; the catch keeps the entry only when `err.cause` is an `ApiError` with status 401 (cause chain from `useTermAccess.ts:62`) | ✅ This removes the cycle-2 ordering dependency (I17). `client.ts:37-41` sets `window.location.href` and then still `await`s `response.json()` (l.46) before throwing. The old catch-side write could therefore lose a race with unload; the pre-written entry cannot. |
| `redeemStarted` replaces `signedOut` | `TermPage.tsx:61-62`: `pendingCode = hashCode ?? (redeemStarted ? null : readPendingCode(groupId))`; set in `onJoin` l.100 | ✅ Set in the same synchronous tick as the write, so no render can read the page's own entry before the guard is on. |
| Sheet keyed on its initial code (G2) | `PrivateGroupGate.tsx:114` `key={codeSheet.initialCode}` | ✅ The new link code gets a fresh `useState(initialCode)`, no stale alert, and a fresh `autoSubmitted` ref. Test `TermPage.test.tsx:779`. |
| Spec amendment (G4/G5) | `spec.md:449-453`: `{code, savedAt}` + 1h TTL, write-before-redeem, keep on 401, the `redeemStarted` guard, G5 and I18 recorded as by design | ✅ Matches the shipped code. |

### Round trip, re-traced (cycle 3)

| Step | Code path | Holds? |
|---|---|---|
| 1. The organizer copies the link | `JoinCodeCard`: `origin + termPublicPath + "#code=" + code` | ✅ unchanged |
| 2. An anonymous visitor opens it | `hashCode` from `location.hash`. `/access` uses `OptionalPrincipal`, so an expired or bad token is treated as anonymous and never returns 401 | ✅ |
| 3. Gate "Masz kod? Zaloguj się, żeby go użyć." | Settled `loginRequired` → effect l.84-86 writes `{code, savedAt}` and keeps the hash | ✅ test l.820 |
| 4. Login or registration | Same-tab SPA `navigate(returnTo)`, with `returnTo = pathname + search` (no fragment). The TermPage instance unmounts on `/login`, so the new one starts with `redeemStarted = false` | ✅ |
| 5. Return without the hash | A fresh TermPage reads the entry while it is under 1h old. The cached `/access` is `isStale` and refetches, and nothing happens until it settles (test l.849) | ✅ |
| 6. Auto-submit | Render-phase latch l.74-80 → `setSheet({code, autoSubmit:true})`. The child effect (sheet) runs before the parent effect, so `onJoin` writes the entry and sets `redeemStarted`. The parent effect then sees `canEnterCode` with a valid code and leaves storage alone (l.89). On the next render `pendingCode` is `null` and the latch resets without reopening anything | ✅ one redeem (tests l.735, l.933 StrictMode) |
| 7a. Success | Storage cleared, `setSheet(null)`, `invalidateQueries(["groupAccess", groupId])` → `view` → toast → RSVP | ✅ test l.720 |
| 7b. Non-401 failure (409/429/404) | Entry removed, error shown in the sheet, sheet stays open | ✅ test l.757 |
| 7c. **401** | The entry is already there before the request. `client.ts` removes `auth_token`, sets the location to `/login?returnTo=…`, and throws. The catch keeps the entry. The full reload in the same tab keeps sessionStorage. After login the flow continues at step 5 with a fresh TTL (the write-before refreshed `savedAt`) | ✅ by trace; test l.879 shows the entry is present during the request and after the 401. The real reload has not been exercised (Phase 12 step i) |

### Edge cases (cycle 3)

| Case | Behaviour now | Verdict |
|---|---|---|
| **401 during the redeem** | See 7c. Order-independent now: the entry exists before `fetch` and is kept by the catch. A hand-typed code that gets a 401 is also kept and auto-redeemed after login (G5, by design). With a profile-less account the backend 401 causes a logout loop with one manual login per loop (I18, accepted, bounded by the TTL) | ✅ (I18 is accepted Info) |
| **A second link while the 409 sheet is open** (only the hash changes) | First link: 409 → entry removed → hash stripped → `linkCode` null → `openedFor` null. Second link: `hashCode` = B → `linkCode` = B → `setSheet({B, true})` → key A→B → the old sheet unmounts and a new sheet mounts with `raw = B`, no alert, and a fresh `autoSubmitted` → one redeem of B → hash stripped. Test l.779 checks 2 calls in total, the last with B, value B, no alert, hash empty. **The same code a second time** (B = A): the key does not change, so there is no remount and no auto-submit. The sheet keeps A with the 409 alert, and the user can press "Dołącz". That is acceptable, because the same code would get the same 409 | ✅ G2 resolved |
| **A different `#code=` link after a failed redeem on the same page: does `redeemStarted` block it?** | **No.** `redeemStarted` only stops `readPendingCode`. `hashCode` is checked first (`hashCode ?? …`), so a new link is always seen. Test l.779 shows exactly this: `redeemStarted` was already `true` from the first 409. What the guard *does* block is an entry in storage that this page instance did not write. That can only come from another page load, which mounts a new TermPage, so nothing reachable is lost. One theoretical gap: an SPA navigation to another group's term page keeps the same instance, so a pending entry for that group would be ignored. No reachable path creates such an entry without first unmounting the page (login, reload) | ✅ |
| **Hand-typed code, then re-renders** | "Mam kod dostępu" → `{initialCode:"", autoSubmit:false}` (key `""`). Typing only changes the sheet's local `raw`, so the key is stable and nothing remounts. Submit → `onJoin` writes the typed code to storage and sets `redeemStarted` in the same tick. Every later TermPage render (the `redeemStarted` update itself, refetches, the toast) gets `pendingCode = null`, so the latch never treats the typed code as a link code. Without the guard, the pre-write would have opened `{typed, autoSubmit:true}` under a new key, remounted, and sent a duplicate redeem. On 409 the entry is removed; on success it is removed. Covered indirectly: test l.682 (spaced code, submitted twice, in flight) checks exactly one call. No test forces an extra TermPage re-render during the in-flight hand-typed redeem (G10, Info) | ✅ |
| **Login from a different tab** | Unchanged from cycle 2. Whether sessionStorage is copied to a middle-clicked or `noopener` tab depends on the browser (current Chrome does not copy it). Tab 2 ends on the "Mam kod dostępu" gate, and the visitor types the code. Tab 1 keeps the `#code=` hash and its entry (under 1h), but AuthContext has no `storage` listener, so it stays anonymous until reloaded. After a reload it auto-submits | ⚠️ Low, accepted (G3) |
| **Storage unavailable** | `read` → null and `write` → no-op (try/catch). A logged-in visitor's hash code still redeems exactly once (test l.914). An anonymous visitor's code cannot survive login, and a 401 loses the code. Blocked sessionStorage usually means blocked localStorage too, and then login itself fails in `client.ts`. Unchanged by write-before | ✅ Info |
| **Reload or close during an in-flight redeem** (new because of write-before) | The entry stays in the tab. After a reload: if the join had already gone through on the server → `view` → the effect clears the entry. If it had not → `canEnterCode` → one auto-redeem of the code the user had already submitted. Within the 1h TTL. This is benign, and arguably the intended behaviour | ✅ Info |
| **Link B while redeem A is still in flight** | The key remount discards A's sheet (and its `busyRef`) and auto-submits B, so two concurrent redeems run. Possible outcomes: A succeeds → `setSheet(null)` closes B's sheet while B is still running, and B is harmless for a member. A fails → `writePendingCode(null)` removes B's entry, so B's code is lost only if B then gets a 401 | ⚠️ Info (G9) |
| **Link sheet open (409), then SPA navigation to another private group's term page** | `sheet` state is not reset on a param change. If the new access is not cached: skeleton → gate remounts → `JoinByCodeSheet` mounts fresh → auto-submits the old code to the new group (409, one limiter strike). If it is cached: the same sheet stays open over the other group's gate | ⚠️ Info (G8), very hard to reach |
| StrictMode, member opening a link, malformed code, PUBLIC group, TTL expiry | Unchanged; tests l.933, l.809, l.735, l.901 pass | ✅ |

### Status of cycle 2 gaps

| # | Cycle 2 gap | Status | Evidence |
|---|---|---|---|
| G1 | SC1 has no runtime evidence | **Open**: Warning, Phase 12 | Still no E2E or `visual-fidelity.md` in `verification/` |
| G2 | A second link while the sheet is open shows the old code | **Resolved** | `PrivateGroupGate.tsx:114`; test l.779 |
| G3 | Login in another tab loses the code | **Open**: Low, accepted | Unchanged |
| G4 | The amendments leave out the 401 restore and the TTL | **Resolved** | `spec.md:449-453` |
| G5 | A kept code is redeemed by the next login in the tab | **Resolved** (documented as by design) | `spec.md:453` |
| G6 | OrganizerEditor flaky test | **Open**: Info, out of scope | test-suite-results #7; 32/32 when run alone |
| G7 | Copy-link term goes stale; PUBLIC→PRIVATE brings back the old code; the panel's copy-link has no code | **Open**: Info, follow-ups | Unchanged |
| (I17) | 401 write-back raced the redirect | **Resolved** | Write-before at `TermPage.tsx:99` |

### Gaps (cycle 3)

| # | Gap | Severity | Evidence | Action |
|---|---|---|---|---|
| G1 | SC1/SC7 have no runtime evidence, including the real 401 → reload → login → auto-redeem | **Warning** (Phase 12) | No E2E report | Phase 12 run, action 1 below |
| G3 | Login in another tab loses the code | **Low** | Browser sessionStorage semantics; no `storage` listener | Accept; an optional "zaloguj się w tej karcie" hint is a product decision |
| G8 | `sheet`/`openedFor` not reset when the route params change, so a stale auto-submit sheet can carry over to another group | **Info** | `TermPage.tsx:63,73`; the route element is not keyed (`router.tsx:162-163`) | Optional: `key={groupId + termId}` on the route element, or reset `sheet` when `groupId` changes. Not needed before merge |
| G9 | A second link during an in-flight redeem starts a second concurrent redeem; A's failure can remove B's entry | **Info** | Key remount at `PrivateGroupGate.tsx:114` discards `busyRef`; `onJoin` l.105 removes the entry unconditionally | Accept (the window is about one round-trip). Optional: remove the entry only if it still holds the same `code` |
| G10 | No test forces an extra TermPage re-render during an in-flight hand-typed redeem, so removing the `redeemStarted` guard may not fail any test | **Info** | Tests l.682/l.702 do not re-render the parent | Optional: one regression test (type a code, keep the redeem pending, force a re-render, expect 1 call) |
| I18 | A profile-less account loops through logout → login → re-send | **Info**, accepted | `spec.md:453` | Product owner confirms (see Open Questions) |
| G6 | OrganizerEditor flaky focus test | **Info** | test-suite-results #7 | Track separately |
| G7 | Copy-link term goes stale; PUBLIC→PRIVATE brings back the old code; the panel's copy-link has no code | **Info** | Unchanged | Follow-ups |

### Functional completeness
About 98%. Every success criterion is met in code and covered by automated tests. The only failure mode that could actually lose a code (a 401 during the redeem) is now handled independently of ordering, and the second-link UX gap is closed. What remains is the manual runtime evidence for SC1/SC7 (Phase 12), one accepted Low (other tab), and Info-level edges that are hard to reach and at worst cost one 409.

### Pragmatic action plan (cycle 3)

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | **Phase 12 two-account E2E** (SC1, SC7), steps (a)–(i) from the cycle 2 plan. In step (i) (non-member, corrupt `auth_token` in devtools, open a `#code=` link), also check in devtools that `sessionStorage["pendingJoinCode:<groupId>"]` exists *before* the 401 response, and that after login the page redeems **once** and then removes the entry. Add (j): with a 409 sheet open, paste a second `#code=` URL that differs only in the hash; the sheet shows the new code and redeems once | Every step passes; no raw status text appears; no 6-digit code shows up in backend access logs; screenshots match the mockups apart from the two documented exceptions | **High** | 55 min |
| 2 | Optional regression test for the `redeemStarted` guard (G10) | The test fails when the guard is removed | Low | 10 min |
| 3 | Optional: reset the sheet when `groupId`/`termId` change (G8); remove the entry only if it still holds the same code (G9) | No sheet carries over between groups | Low | 15 min |
| 4 | Product owner: confirm G3 (other tab) and I18 (profile-less loop) as accepted | Decision recorded | Low | 5 min |
| 5 | Follow-ups (G6, G7): clear `join_code` on a switch to PUBLIC; invalidate `groupTerms` from term mutations; put the code in the panel's copy-link; deflake OrganizerEditor | Tracked | Low | — |

### Completion verdict (cycle 3)
⚠️ **Gaps, none blocking.** The cycle-3 changes are correct and close everything actionable from cycle 2. Write-before-redeem makes the 401 path independent of ordering. `redeemStarted` blocks exactly the page's own entry and still lets new `#code=` links through. The sheet key fixes the second-link case and has a test. The spec matches the shipped behaviour. No Critical, High or actionable Low gaps remain. **Mark the task complete once the Phase 12 run (action 1, including steps i and j) passes.** Actions 2–4 are optional and do not block the merge.

---

## Cycle 2 record (kept for history)

### TL;DR (cycle 2)
- **Status: ⚠️ Issues Found. Nothing critical or high. Ready for the Phase 12 E2E run.** Traced in code, the `#code=` flow works end to end: link, gate, login or registration, return without the hash, auto-submit, view, RSVP. It now also survives a 401 during redeem.
- **Resolved since cycle 1:** the token-expiry/401 case (the code is restored to sessionStorage and a `signedOut` guard stops the page clearing it again), the flaky TermPage test T1, and the SC1/SC6 spec wording. A 1h TTL now bounds how long a forgotten code can sit in storage.
- **Still open:** a second `#code=` link opened while the sheet is open still shows the old code and does not auto-submit, because the sheet was **not** keyed on the code (Low). A login in another tab still loses the code (Low). The amendments do not yet describe the 401 restore or the 1h TTL (Info). SC1 still has no runtime evidence (Phase 12).
- Tests were not re-run here. From `verification/test-suite-results.md`: backend 860/860; frontend 1014/1021 (6 failures that already existed, plus 1 flaky OrganizerEditor test in an untouched file); `tsc -b` clean.

### Open Questions / Risks (cycle 2)
- **No runtime evidence yet (SC1).** All findings come from reading code and from vitest runs with the API mocked. The 401 path has the least coverage. The test shows that the code is saved after a mocked `ApiError(401)`, but it does not run `client.ts`'s real `window.location.href` redirect, the full reload, or the redeem after login. Each half is covered separately (401 → storage; storage → redeem after login), and the halves share the same `writePendingCode`/`readPendingCode` format, but nothing has run them together.
- **Second link while the sheet is open:** the caller's brief says "key the sheet on the code", but the code has no `key` (`PrivateGroupGate.tsx:113-118`). Either that change was planned and missed, or it was dropped on purpose. Someone needs to confirm which.
- **A restored code is redeemed by whichever account logs in next in that tab** (within 1h, same group). This is by design (same tab, same person holding the code), but it is new behaviour since the 401 restore. It also applies to a code that was typed by hand and then hit a 401, not only to one from a link. Accept it, or document it.
- Accepted earlier and unchanged: the group-wide limiter can lock out a whole group (DoS); the limiter runs in a single process; the organizer is not notified when someone joins; PUBLIC→PRIVATE brings back the old code; the copy-link term can go stale.

## Re-verification (cycle 2)

### Status of cycle 1 gaps

| # | Cycle 1 gap | Status | Evidence |
|---|---|---|---|
| 1 | SC1 has no runtime evidence | **Residual**: Warning, Phase 12 | No E2E or `visual-fidelity.md` report in `verification/`. |
| 2 | Code lost on a 401 during redeem (cycle 1 "Low") | **Resolved** | `TermPage.tsx:90-106`: `onJoin` catches an error whose `cause` is an `ApiError` with status 401, calls `writePendingCode(groupId, code)` and `setSignedOut(true)`, then rethrows. The cause chain holds: `request()` throws `ApiError` (`client.ts:50`), and `useTermAccess.joinWithCode` wraps it as `new Error(msg, {cause: err})` (`useTermAccess.ts:62`). `signedOut` forces `pendingCode = null` (l.60), so the cleanup effect (l.80-88) returns early and cannot remove the restored entry. Test: `TermPage.test.tsx:848`. |
| 3 | Flaky test `TermPage.test.tsx:768` (T1) | **Resolved** | The test now waits with `await waitFor(...)` (l.769). It passed in the full run and in 3 isolated runs (test-suite-results). |
| 4 | Second link while the sheet is open | **Open**: Low | There is still no `key` on `<JoinByCodeSheet>` (`PrivateGroupGate.tsx:113`). See the trace below. |
| 5 | Login in another tab | **Open**: Low (unchanged; the TTL slightly limits the downside) | See the edge cases below. |
| 6 | SC6 / SC1 wording | **Resolved** | `spec.md:408`: SC1 says `#code=` and asks for a manual two-account check. `spec.md:411-414`: SC6 says "no new lint/ruff errors; files touched by this task are clean". `decision-log.md:177` and `:285` have "Superseded" notes. The body of `spec.md` still says `?code=` (e.g. l.7, 17, 193, 215), but l.448 says to read it as `#code=`. Acceptable. |
| 7 | Copy-link term can go stale | **Residual**: Info | `GroupDetailsPage.tsx:27-30` is unchanged. |
| 8 | PUBLIC→PRIVATE brings back the old code | **Residual**: Info | There is still no `join_code = None` in `src/backend/app`. |

### Round trip, re-traced (including the 401 path)

| Step | Code path | Holds? |
|---|---|---|
| 1. The organizer copies the link | `JoinCodeCard`: `origin + termPublicPath + "#code=" + code` | ✅ (unchanged) |
| 2. An anonymous visitor opens it | `hashCode` comes from `location.hash`. `/access` never returns 401: `OptionalPrincipal`, and an expired or malformed token degrades to anonymous (`circles.py:156-171`). | ✅ |
| 3. Gate shows "Masz kod?…" | Settled as `loginRequired` → effect `writePendingCode(groupId, code)` stores `{code, savedAt}`. The hash is kept. | ✅ (test l.789) |
| 4. Login or registration | Same-tab SPA navigation to `returnTo = pathname + search`. sessionStorage survives. | ✅ |
| 5. The visitor returns without the hash | TermPage remounts. The cached `/access` is `isStale` and refetches. `readPendingCode` returns the code if it is under 1h old. | ✅ by trace, TTL test l.861 |
| 6. Auto-submit | Render-phase `openedFor` latch → `setSheet({initialCode, autoSubmit:true})`. The effect clears storage. The sheet's `autoSubmitted` ref plus `busyRef` make sure only one redeem is sent, including under StrictMode. | ✅ (tests l.789, l.893) |
| 7a. Success | `invalidateQueries(["groupAccess", groupId])` → `view` → PublicTermView, toast, RSVP (backend test covers 201) | ✅ |
| 7b. **401 on redeem** (token expired or revoked after `/access`; also covers a revoked token that `/access` quietly treated as anonymous and that the frontend still holds) | `client.ts:37-42` removes `auth_token` and sets `window.location.href = /login?returnTo=pathname+search`, then throws. `onJoin` writes `{code, savedAt: now}` and sets `signedOut`. With `pendingCode` null the latch resets, no new sheet opens, and the effect does nothing. The sheet briefly shows the fallback "Nie udało się dołączyć — spróbuj ponownie" before the page reloads. A full reload in the same tab keeps sessionStorage. After login, the flow continues at step 5 with a fresh 1h TTL. | ✅ by trace; each half is tested (l.848, l.789), but the two halves have never run as one sequence |

### Edge cases

| Case | Behaviour now | Verdict |
|---|---|---|
| **Token expiry / 401 between `/access` and redeem** | The code is restored to storage and redeemed automatically after re-login (above). | ✅ Resolved |
| **Second `#code=` link while the 409 sheet is still open** (same tab, same group/term; only the hash changes, e.g. the link is pasted into the address bar) | After the first link, the hash and storage were cleared, so `openedFor` went back to `null`. The new hash gives `linkCode` = new code → `setSheet({initialCode: new, autoSubmit: true})`. But the **same** `JoinByCodeSheet` instance stays mounted. `useState(initialCode)` keeps the old `raw` and the old 409 alert, and `autoSubmitted.current` is already `true`, so nothing is submitted. The hash is stripped and the new code is lost; the user has to retype it. A different group or term changes the query key → `loading` → the sheet unmounts, so that case works. Opening the link in a new tab is a fresh mount and works. | ⚠️ Low, still open |
| **Login in another tab** | Whether sessionStorage is copied to a middle-clicked or `noopener` tab depends on the browser (current Chrome does not copy it). If it is not copied, the new tab ends on the "Mam kod dostępu" gate and the visitor types the code. The original tab keeps the `#code=` hash (`loginRequired` never strips it), and AuthContext has no `storage` listener, so it stays anonymous until reloaded. A reload picks up the token from `localStorage` and auto-submits. The 1h TTL means a long-abandoned tab does not auto-join later. | ⚠️ Low: degraded, recoverable |
| **Storage unavailable** (blocked sessionStorage) | `read` → null, `write` → no-op (try/catch on all three calls). A logged-in visitor's hash code still redeems exactly once (test l.874). An anonymous visitor's code cannot survive login, and neither can a 401-restored code. When storage is blocked, `localStorage` usually is too, so login itself fails in `client.ts` anyway. Stated in the code comment at l.39. | ✅ Info |
| Pending entry older than 1h | Ignored (test l.861). The expired entry is never deleted, but it stays in that tab only and is harmless. | ✅ Info |
| StrictMode double-invoke | One redeem (test l.893). The `openedFor` latch is idempotent during render, and the sheet's ref survives the effect being run twice. | ✅ |
| Member opens a `#code=` link / malformed code / PUBLIC group / stale 409 | Unchanged from cycle 1; tests l.778, l.735, l.757 pass. | ✅ |

### Gaps (cycle 2)

| # | Gap | Severity | Evidence | Action |
|---|---|---|---|---|
| G1 | SC1 has no runtime evidence, including the real 401 → reload → login → auto-redeem sequence | **Warning** (Phase 12) | No E2E report | Phase 12 run, plan item 1 (with step i) |
| G2 | A second link while the sheet is open shows the old code and does not auto-submit | **Low** | `PrivateGroupGate.tsx:113-118` has no `key`; `JoinByCodeSheet.tsx:41-42` keeps its ref and state | Add `key={codeSheet.initialCode}` (or a counter that `TermPage` bumps on each `setSheet` from a link) to `<JoinByCodeSheet>`, plus a test that changes only the hash while a 409 sheet is open |
| G3 | Login in another tab loses the code | **Low** | Browser behaviour around sessionStorage; no `storage` listener | Accept, or add an optional hint ("zaloguj się w tej karcie"). No code change required |
| G4 | The spec amendments leave out the 401 restore, the `signedOut` guard and the 1h TTL | **Info** | `spec.md:446-458` has no mention | Add one bullet to "Post-verification amendments" |
| G5 | A 401-restored code is redeemed by whichever account logs in next in that tab | **Info** | `TermPage.tsx:96-98` | Accept (the same person holds the code), and note it in the amendment from G4 |
| G6 | OrganizerEditor flaky focus test (in a file this task did not touch) | **Info** | test-suite-results #7 | Track separately; it does not block this task |
| G7 | Copy-link term can go stale; PUBLIC→PRIVATE brings back the old code; the panel's copy-link has no code | **Info** | Unchanged | Follow-ups |

### Functional completeness
About 97% (up from about 95%). Every success criterion is met in code and covered by automated tests, except SC1's manual run and SC7's visual fidelity, which both wait on Phase 12. The one failure mode in cycle 1 that could actually lose a code (401 during redeem) is now handled. What remains are two Low UX edges that a user can recover from.

### Pragmatic action plan (updated)

| # | Action | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | **Phase 12 two-account E2E** (SC1, SC7). (a) As organizer, use "Kopiuj link z kodem" on a PRIVATE group; the copied link contains `#code=`. (b) Open it anonymously: "Masz kod? Zaloguj się, żeby go użyć." (c) Log in, return with no `#` in the URL; the sheet auto-submits, the toast "Dołączono do grupy" appears, RSVP returns 201. (d) Repeat (b)–(c) through registration and onboarding. (e) Wrong code: the 409 copy appears in the sheet and the hash is gone. (f) 11 wrong attempts: the 429 copy shows minutes. (g) A member reopens the link: no sheet, hash stripped. (h) The backend access log has no 6-digit code in any request line. **(i) New:** log in as a non-member, remove or corrupt `auth_token` in devtools, open a `#code=` link. The redeem gets a 401 and redirects to login; after login the page auto-redeems once. | Every step passes; no raw status text appears; screenshots match the six mockups apart from the two documented exceptions | **High** | 50 min |
| 2 | Key `JoinByCodeSheet` on the link's code (G2) and add a test that changes only the hash | With a 409 sheet open, a new `#code=` shows the new code and redeems once | Low | 10 min |
| 3 | Spec amendment bullet: 401 restore, `signedOut`, 1h TTL, and that the next login in the tab redeems it (G4/G5) | The amendments describe the shipped behaviour | Low | 5 min |
| 4 | Optional: a "same tab" hint for the other-tab login case (G3) | Product decision recorded | Low | 0–15 min |
| 5 | Follow-ups: clear `join_code` on a switch to PUBLIC; invalidate `groupTerms` from term mutations; put the code in the panel's copy-link; deflake OrganizerEditor | Tracked | Low | — |

### Completion verdict (cycle 2)
⚠️ **Gaps, none blocking.** The fixes since cycle 1 are real and correct. The 401 restore is wired through the right error cause chain, and the `signedOut` guard prevents the cleanup effect from removing the restored code. The TTL is enforced and tested, and the blocked-storage and StrictMode cases are tested. The "key the sheet on the code" change for the second-link case was not made; it remains Low and optional. Mark the task complete once the Phase 12 run passes (action 1, including the new 401 step i). Actions 2–3 are cheap and are recommended before merge.

---

## Cycle 1 record (kept for history)

### TL;DR (cycle 1)
- Status ⚠️ Issues Found, no critical issues. The B1 fix (`#code=` fragment plus sessionStorage carry) kept the code out of server-visible URLs without breaking the round trip. Tests at the time: backend 860/860; frontend 1010/1017 (6 failures that already existed, plus 1 flaky test at `TermPage.test.tsx:768`).

### Re-verification (cycle 1)

| # | Previous gap | Status | Evidence / note |
|---|---|---|---|
| 1 | SC1 has no runtime evidence | **Residual** (Warning, Phase 12) | No E2E or visual-fidelity report yet. Automated coverage follows the new mechanism (`TermPage.test.tsx:788`, `:817`). |
| 2 | Stale user guide (2026-10-19) | **Resolved** | The PRIVATE copy, done-screen copy and join-by-code prose were updated; no request-flow wording remains. |
| 3 | SC6 wording | **Residual** (Info) | The spec still said "Full suites are green", although lint and ruff fail on files this task does not touch. *(Resolved in cycle 2.)* |
| 4 | Copy-link term can go stale | **Residual** (Info) | `GroupDetailsPage.tsx:27-31` uses the nearest term on or after today; `groupTerms` is not invalidated by term mutations. |
| 5 | PUBLIC→PRIVATE brings back the old code | **Residual** (Info) | No code path clears `join_code`. |
| — | Production-readiness B1 (code in access logs) | **Resolved** | Fragment link; `returnTo` leaves out the hash; code carried in sessionStorage. |

### Round-trip trace (cycle 1)

| Step | Code path | Holds? |
|---|---|---|
| 1. The organizer copies the link | `JoinCodeCard` → `origin + termPublicPath + "#code=" + code` | ✅ |
| 2. An anonymous visitor opens it | `hashCode` from `location.hash`; `/access` without a token | ✅ |
| 3. Gate "Masz kod?…" | `loginRequired` → write `pendingJoinCode:{groupId}`, keep the hash | ✅ |
| 4a. Login | `/login?returnTo=<pathname+search>` → SPA `navigate(returnTo)` in the same tab | ✅ |
| 4b. Registration | `/register` → `/onboarding` → `navigate(returnTo)` in the same tab | ✅ |
| 5. Return without the hash | Remount; cached `/access` is `isStale` and refetches on mount | ✅ by trace |
| 6. Code read from storage | `pendingCode = hashCode ?? readPendingCode(groupId)` | ✅ |
| 7. Sheet auto-submits | `canEnterCode` → `setSheet({autoSubmit:true})`; one redeem | ✅ |
| 8. View, then RSVP | Invalidate `groupAccess` → `view`; backend allows the RSVP | ✅ |

### Edge cases (cycle 1)

| Case | Behaviour | Verdict |
|---|---|---|
| Login opened in another tab | Depends on the browser; reloading the original tab recovers | ⚠️ Low |
| sessionStorage unavailable | try/catch; the code does not survive login; a logged-in visitor's hash still works | ✅ Info |
| Already a member opens a `#code=` link | Settles as `view` → stripped, no redeem | ✅ |
| Stale code (409) | Stripped at once; the sheet keeps the server message | ✅ (flaky timing) |
| Malformed `#code=` | Stripped; empty sheet | ✅ |
| PUBLIC group with `#code=` | `view` → stripped | ✅ |
| Second `#code=` link while the 409 sheet is still open | The sheet keeps the old code, no auto-submit | ⚠️ Low |
| Token expires between `/access` and the redeem | The code is lost on the 401 redirect | ⚠️ Low *(resolved in cycle 2)* |

### Gaps (cycle 1)
- **Critical:** none.
- **Warning:** 1. SC1 has no runtime evidence. Action: the Phase 12 run.
- **Low:** 2. Code lost when login happens in another tab. 3. Code lost on a mid-session 401 *(resolved in cycle 2)*. 4. Flaky test at `TermPage.test.tsx:768` *(resolved in cycle 2)*. 5. A second link while the sheet is open does not refresh the sheet *(still open, G2)*.
- **Info:** 6. SC6/SC1 wording *(resolved in cycle 2)*. 7. The copy-link term can go stale. 8. PUBLIC→PRIVATE brings back the old code. 9. The panel's copy-link has no code (accepted, out of scope).

### Action plan (cycle 1)

| # | Action | Priority | Effort | Cycle 2 status |
|---|---|---|---|---|
| 1 | Phase 12 two-account E2E (steps a–h) | High | 45 min | Pending; step (i) added |
| 2 | `waitFor` at `TermPage.test.tsx:768` | Medium | 2 min | Done |
| 3 | Reword SC6/SC1 | Low | 5 min | Done |
| 4 | Clear the pending code only after a redeem that did not end in 401; key the sheet on the code | Low | 30 min | 401 part done; sheet key not done |
| 5 | Follow-ups: clear `join_code` on a switch to PUBLIC; `groupTerms` invalidation; code in the panel's copy-link | Low | — | Open |
