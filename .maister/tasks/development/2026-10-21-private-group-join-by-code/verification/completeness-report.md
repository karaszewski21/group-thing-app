# Completeness Report: Join a PRIVATE group with a 6-digit access code

Re-verification, cycle 3 (final), checked 2026-10-21 by implementation-completeness-checker after the Phase 11 cycle-3 fixes. It checks:
- `implementation/implementation-plan.md` (9 groups, 62 steps, new pointer at l.250)
- `implementation/spec.md` ("Post-verification amendments (2026-10-21)", l.445ff)
- `implementation/work-log.md`, final entry "Verification fixes (Phase 11, cycle 3)" (l.141-146)
- the working tree (`TermPage.tsx`, `PrivateGroupGate.tsx`, `TermPage.test.tsx`, and the files with residual items)

## TL;DR
- **Status: passed_with_issues.** There are no critical issues and no warnings. 4 info items remain open; all are cosmetic or wait on Phase 12.
- **Resolved in cycle 3:** the plan Groups 6/7 pointer (`implementation-plan.md:250`) and the missing spec coverage of the TTL, the 401 write-back and write-before-redeem (`spec.md:449-454`). The spec now matches the code.
- **Residual (info, unchanged):** the sr-only separator (`JoinCodeCard.tsx:56-57`), the 135-character comment (`ConfirmDeleteDialog.tsx:21`) and `#12604D` (`JoinCodeCard.tsx:55`). The SC1 manual check is pending for Phase 12.
- **R31 gate, re-run with the spec's command:** `rg` exits 1 with no output, which is a pass. Plan: 71/71 `[x]`. Standards: 19 apply, 19 followed, 3 with info notes.

## Open Questions / Risks
- **The SC1 manual two-account check is not recorded.** The automated paths are covered: `TermPage.test.tsx:820` (login round trip) and `:879` (a 401 keeps the code). The manual check belongs to Phase 12 and should be logged there.
- **G5 and I18 are accepted by design, not fixed.**
  - G5: the next account to log in on the same tab within 1h redeems the kept code.
  - I18: an account with no profile gets the code re-sent after each manual login.
  - Both are written down in `spec.md:453`. This is a recorded product risk, not a documentation gap.
- **Frontend suite.** The cycle-3 work-log entry (l.146) reports 1016 passed and 6 failed, exactly the pre-existing set. The OrganizerEditor flake from cycle 2 did not recur in that run. This checker did not re-run the suites; it re-ran only the R31 gate.
- **Accepted risks are unchanged:**
  - The limiter runs in a single process.
  - An attacker can exhaust the group key (DoS).
  - A concurrent redeem can create duplicate memberships (W2/OQ-8, a follow-up by user decision).
  - Members who joined by code are invisible to the organizer.

---

## Re-verification (cycle 3)

### Cycle-2 items re-checked

| # | Cycle-2 item | Severity | Cycle 3 | Evidence | Fixable |
|---|---|---|---|---|---|
| 2 | Plan Groups 6/7 have no amendment pointer | info | **Resolved** | `implementation-plan.md:250`, between the Group 6 acceptance criteria and the Group 7 heading: "> Groups 6/7 were amended after verification (`#code=` fragment, sessionStorage through login, write-before-redeem, sheet `key`): see spec.md 'Post-verification amendments (2026-10-21)'." The step bodies at l.187-247 still say `?code=`, which is acceptable now that the pointer is there. | n/a |
| 4 | sr-only code with no `{" "}` separator | info | **Residual** | `JoinCodeCard.tsx:56-57`: the `aria-hidden` span with `formatJoinCode(code)` sits directly before the `sr-only` span. Screen reader output is still correct because the visual span is hidden. The standard's rule targets visible text next to sr-only text, so the gap is only stylistic. | true (insert `{" "}` between the spans) |
| 5 | 135-character comment in `ConfirmDeleteDialog` | info | **Residual** | `ConfirmDeleteDialog.tsx:21` is still 135 characters. Lines 120 (156 characters) and 129 (135 characters) are long JSX class strings. | true (rewrap) |
| 6 | Hard-coded `#12604D` | info | **Residual** | `JoinCodeCard.tsx:55` uses `text-[#12604D]`. The same literal already appears in code this task did not add: `GroupDetailsPage.tsx:195` and `TermAttendeesPage.tsx:168`. It follows the local pattern. | true (optional mint-ink token, best done as a separate cleanup) |
| 7 | SC1 manual two-account check | info | **Pending (Phase 12)** | `spec.md:408` requires it. The work-log has no record of it yet, which is expected before Phase 12. | true (record it in Phase 12) |
| 8 | Spec amendments do not cover the 401 write-back or the TTL | info | **Resolved** | `spec.md:449-454` now has sub-bullets for each of these: the `{code, savedAt}` entry is ignored after 1h; `onJoin` writes the code before `joinWithCode` and removes it on every result except a 401; the `redeemStarted` guard (formerly `signedOut`); G5/I18 by design; `JoinByCodeSheet` is keyed on `initialCode` (G2). | n/a |

### Spec amendment checked against the code

| Amendment claim | Code | Test |
|---|---|---|
| `{code, savedAt}`, ignored after 1h | `TermPage.tsx:16` (`PENDING_CODE_TTL_MS = 60 * 60 * 1000`), `:26-28`, `:37` | `TermPage.test.tsx:901` (a 2h-old entry is ignored) |
| The code is written before the redeem and removed unless the result is a 401 | `TermPage.tsx` `onJoin` calls `writePendingCode(groupId, code)` before `joinWithCode`. The catch clears it unless `err.cause` is an `ApiError` with status 401. | `TermPage.test.tsx:879` |
| `redeemStarted` guard | `TermPage.tsx:61-62`: `pendingCode = hashCode ?? (redeemStarted ? null : readPendingCode(groupId))` | `:879`; `:933` (StrictMode, exactly one redeem) |
| The settle step leaves a valid `canEnterCode` code to `onJoin` | The settle effect clears storage only when the gate is not `canEnterCode` or the code is malformed | `:735`, `:757` |
| The sheet is keyed on `initialCode` | `PrivateGroupGate.tsx:114` `key={codeSheet.initialCode}` | `TermPage.test.tsx:779` (a new `#code=` arrives while the 409 sheet is open and is redeemed once) |
| 401 detection depends on `cause` | `useTermAccess.ts:62` rethrows with `{ cause: err }` | `:879` |

### R31 gate (re-run)

Run from the repo root with the command at `spec.md:412`:

```
rg -i "join.?request|GROUP_JOIN_|RequestAccessDialog|PENDING_JOIN_REQUESTS_KEY|join-requests|request_?access" src/ -g '!src/backend/alembic/versions/**' -g '!src/backend/tests/test_group_join_code_migrations.py'
```

Result: exit 1, no output. **Pass.**

### Standards changes in cycle 3

| Standard | Verdict after cycle 3 |
|---|---|
| global/error-handling.md | Followed. The 401 check uses a typed `ApiError` through `cause`. On every other error the code clears storage and rethrows. |
| global/commenting.md | Followed. The new `TermPage.tsx` comments (the `redeemStarted` note and the write-before-redeem note) explain why. |
| global/minimal-implementation.md | Followed. `redeemStarted` replaces `signedOut` instead of adding to it, and the sheet `key` is a one-line fix. |
| frontend/accessibility.md | Followed, apart from the residual separator note (item 4). Remounting via `key` keeps the `ModalSheet` focus handling. |
| frontend/data-fetching.md | Followed. Cycle 3 adds no new fetching, and the hook still owns the query. |
| testing/frontend-testing.md | Followed. The new tests (`:779`, `:879`) use the existing wrapper and real `Date.now()` offsets. |
| All others | Unchanged from cycle 2 (see the table below). |

### Documentation (cycle 3)
- **work-log.md:** has a dated cycle-3 entry (l.141-146) covering G2, I17, G4/G5, I18 and the test totals. Complete.
- **spec.md:** the amendments now match the code (see the table above). Complete.
- **implementation-plan.md:** every step is `[x]` and the pointer is in place. Complete.
- **SC1:** the manual check is pending for Phase 12.

Documentation status: **complete**, apart from the SC1 record, which is due in Phase 12.

---

## Re-verification (cycle 2), kept for reference

### Cycle-1 findings

| # | Cycle-1 finding | Severity | Cycle 2 | Evidence |
|---|---|---|---|---|
| 1 | Spec body R18/22/24/26 drift (`invalidateQueries`, `hasCodeParam`, `?code=`) | info | **Resolved** | `spec.md:159,169,193,218`: each requirement now starts with "(see Post-verification amendments)". The bodies are still the original wording, overridden by the amendments at l.446-455, which is the intended form. |
| 2 | Plan Groups 6/7 have no amendment pointer | info | **Residual** | `implementation-plan.md:187` (Group 6 heading "TermPage `?code=`"), l.197-198, 217-218, 247, 261 (`"?code="` link) and 277 still describe the old design. `grep -i "amend\|superseded"` finds no matches in the plan. |
| 3 | ADR-005 not amended | info | **Resolved** | `decision-log.md:177`: "> **Superseded (2026-10-21)** in part by … the code in a `#code=` fragment … sessionStorage (`pendingJoinCode:{groupId}`)". ADR-008 has the matching note at l.285. |
| 4 | sr-only code without a `{" "}` separator | info | **Residual** | `JoinCodeCard.tsx:56-57`: the `aria-hidden` span and the `sr-only` span sit next to each other with no `{" "}`. The screen reader output is still correct, because the visual span is hidden. |
| 5 | 135-character doc comment in `ConfirmDeleteDialog` | info | **Residual** | `ConfirmDeleteDialog.tsx:21` is still 135 characters. L.120 (156) and l.129 (135) are long JSX class lines. |
| 6 | Hard-coded `#12604D` | info | **Residual** | `JoinCodeCard.tsx:55` `text-[#12604D]`. It copies the existing panel pattern. |
| 7 | SC1 manual two-account check | info | **Pending (Phase 12)** | `spec.md:408` now names the anonymous `#code=` → login → auto-submit path. The work-log still has no record of the manual check, as expected at this phase. |

### Cycle-2 fixes spot-checked

| Fix | Status | Evidence |
|---|---|---|
| `useTermAccess.ts` `{cause: err}` change logged | **Confirmed** | Work-log l.135: "a one-line change outside the declared files: `hooks/useTermAccess.ts` joinWithCode now rethrows with `{ cause: err }`". Code at `useTermAccess.ts:62`. |
| SC1 `#code=` wording | Confirmed | `spec.md:408` |
| SC6 reworded | Confirmed | `spec.md:413-416`: pytest, mypy no worse than baseline, `npm test`, `tsc -b`, and no new lint/ruff errors with clean touched files |
| I13: a 401 writes the code back | Confirmed in code and tests | `TermPage.tsx:59-60,96`, test at `TermPage.test.tsx:848` |
| I15: 1h TTL | Confirmed in code and tests | `TermPage.tsx:16,26-28,37`, expired-entry fixture at `TermPage.test.tsx:865` |
| I14: blocked storage and StrictMode | Confirmed | `TermPage.test.tsx:874` (sessionStorage throws `SecurityError`) and `TermPage.test.tsx:893` (StrictMode, exactly one redeem) |
| R31 gate | **Pass** | Run from the repo root with the command at `spec.md:412`: exit 1, no output |

---

## 1. Plan Completion: complete (100%), cycle-2 baseline, still valid

| Metric | Value |
|---|---|
| Checkboxes `[x]` / `[ ]` | 71 / 0 (62 steps + 9 group headers) |
| Completion | 100% |

The cycle-1 spot checks still hold:
- the `#code=` fragment link (`JoinCodeCard.tsx:67`)
- the `codeSheet` prop
- `useJoinCode` idle status and `setQueryData`
- the deferred alert

Cycle 2 changed only `TermPage.tsx`, `useTermAccess.ts` and tests.

## 2. Standards Compliance: mostly compliant (cycle-2 baseline; see the cycle-3 changes above)

| Standard | Applies? | Reasoning / verdict |
|---|---|---|
| global/error-handling.md | Yes | Typed `TooManyAttemptsException`; the rethrow keeps the original error as `cause` so the 401 can be detected. Followed |
| global/validation.md | Yes | Server checks `^[0-9]{6}$`. Client uses `type=text inputMode=numeric`, `parseJoinCode` and a `role=alert`. The stored entry's shape is validated before use (`TermPage.tsx:26-27`). Followed |
| global/conventions.md | Yes | Existing file layout. Followed |
| global/coding-style.md | Yes | `ConfirmDeleteDialog.tsx:21` doc comment is 135 characters (residual). Info |
| global/commenting.md | Yes | Comments explain why. Followed |
| global/minimal-implementation.md | Yes | The TTL and the 401 guard are small and both are tested. Followed |
| backend/api.md | Yes | No changes in cycle 2. Followed |
| backend/models.md | Yes | No changes in cycle 2. Followed |
| backend/queries.md | Yes (light) | No new queries. Followed |
| backend/jooq.md | No | No filter-DSL services touched |
| backend/migrations.md | Yes | Unchanged since cycle 1. Followed |
| backend/security.md | Yes | The code stays in the fragment and in sessionStorage, which now expires after 1h; it is never logged. Followed |
| backend/plugin-auth.md | No | No plugin SDK changes |
| backend/time.md | Partly | It governs the backend clock. The frontend TTL uses `Date.now()` and the tests use real timestamps, so it is out of the standard's scope. Followed |
| frontend/css.md | Yes | Hard-coded `#12604D` (residual). Info |
| frontend/components.md | Yes | Followed |
| frontend/accessibility.md | Yes | `ModalSheet` handles focus, and a busy sheet cannot be closed. The `{" "}` separator rule is not applied in `JoinCodeCard` (residual). Info |
| frontend/responsive.md | Yes (light) | Followed |
| frontend/data-fetching.md | Yes | `regenerate` uses `setQueryData`, which the spec amendment allows. `joinWithCode` awaits `invalidateQueries`. Info |
| testing/backend-testing.md | Yes | Exact key sets; caplog test. Followed |
| testing/frontend-testing.md | Yes | Explicit vitest imports, `createQueryWrapper`, `vi.stubGlobal` for blocked storage, `waitFor` around hash assertions (T1). Followed |

Counts: 21 standards listed in INDEX.md, 19 apply, 19 followed. 4 have info-level notes and none has a warning-level gap.

## 3. Documentation Completeness (cycle 2: adequate; cycle 3: complete)

- **work-log.md:** has the dated cycle-2 entry, which lists T1, I13–I16, the `useTermAccess.ts` change and test totals. Complete.
- **spec.md:**
  - Pointers are in place on R18/22/24/26.
  - SC1 and SC6 have been updated.
  - R31 and SC5 are identical.
  - The amendments do not describe the 1h TTL or the 401 write-back (new info).
- **implementation-plan.md:** all steps are `[x]`. Groups 6/7 have no amendment pointer (residual info).
- **decision-log.md:** ADR-005 and ADR-008 carry Superseded notes. Done.
- **SC1:** the manual check is pending for Phase 12.


## Issues (cumulative, as of cycle 3)

| # | Source | Severity | Status | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | documentation | info | Resolved (c2) | Spec body R18/22/24/26 drift | `spec.md:159,169,193,218` | true | n/a |
| 2 | documentation | info | Resolved (c3) | Plan Groups 6/7 had no amendment pointer | `implementation-plan.md:250` | true | n/a |
| 3 | documentation | info | Resolved (c2) | ADR-005 not amended | `decision-log.md:177` | true | n/a |
| 4 | standards | info | Residual | No `{" "}` separator next to the sr-only code | `src/frontend/src/components/panel/JoinCodeCard.tsx:56-57` | true | Insert `{" "}` between the spans |
| 5 | standards | info | Residual | 135-character doc comment | `src/frontend/src/components/shared/ConfirmDeleteDialog.tsx:21` | true | Rewrap |
| 6 | standards | info | Residual | Hard-coded `#12604D` (matches the existing local pattern) | `src/frontend/src/components/panel/JoinCodeCard.tsx:55` | true | Optional: add a mint-ink token in a separate cleanup |
| 7 | documentation | info | Pending (Phase 12) | SC1 manual two-account check not recorded | `implementation/work-log.md` | true | Record it in Phase 12 |
| 8 | documentation | info | Resolved (c3) | The spec amendments did not cover the TTL, the 401 write-back or the guard | `spec.md:449-454` | true | n/a |

Known context, not counted against this task:
- 6 frontend test failures that also occur on HEAD. The cycle-2 OrganizerEditor flake did not recur in the cycle-3 run.
- Whole-project eslint and ruff debt in untouched files.
- W2 (OQ-8): duplicate memberships on concurrent redeem, a follow-up by user decision.
- G5/I18: accepted by design and recorded in `spec.md:453`.

Issue counts (open): critical 0, warning 0, info 4 (items 4, 5, 6 and 7). Items 1, 2, 3 and 8 are resolved.
