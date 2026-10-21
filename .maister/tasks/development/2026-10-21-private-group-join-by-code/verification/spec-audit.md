# Spec Audit: Join a PRIVATE group with a 6-digit access code (pre-implementation)

## TL;DR
Verdict: **pass-with-concerns** (Mostly Compliant). Counts: 0 critical, 0 high, 9 medium, 12 low.
Almost every file:line reference and reuse target checks out against the current code. Three places matter most. The 0060 downgrade shape and the "do not touch the sequence" rule are correct. The authorization-matrix row placement is correct. The limiter's check-before-compare ordering is sound.
The concerns are interface and coverage gaps, not wrong design. The main ones: the lazy GET's re-read can still return a null code; nobody clearly owns the `?code=` sheet between TermPage, the gate and the sheet; the theme test-list instructions point at the wrong file; and several test files that will break are not listed.

## Key Decisions
- No finding is rated High. Each gap either fails loudly in the test suite (theme lists, mocks, labels) or needs a rare race to trigger (null re-read after `StaleDataError`). None silently breaks the core flow, so all of them are Medium at most.
- The ADRs were treated as settled. A lazy write under a READ-gated GET, 404 before 429, a generic 409, and 6 digits were not challenged. Only places where the spec departs from the ADRs/HLD were recorded, and all of those are Low.
- I treated the six mockups as binding. Where a mockup contradicts an "unchanged" component (the `AuthGateLinks` copy), I flagged it and did not choose a side.

## Open Questions / Risks
- After a lazy-GET `StaleDataError`, should the re-read retry generation once when it still finds `join_code IS NULL`, or answer 409? The spec says "return the stored code", which returns `None` → 500 (see M1).
- Who owns the sheet's open state and the `?code=` strip handshake: TermPage, or `PrivateGroupGate`? R22 and R24 each own part of it (see M2).
- Does "Kopiuj kod" copy `482913` or `482 913`? This combines with the `pattern="[0-9]*"` input (see M3).
- Mockup `brama-grupy-prywatnej-anonim.html` shows "Załóż konto", while the real `AuthGateLinks` (stated as unchanged) reads "Nie masz konta? Zarejestruj się" (see L10).

---

## Summary

| Area of interest | Result |
|---|---|
| Lazy GET `StaleDataError` rollback/re-read under AsyncSession | Mechanically sound. `db.get` re-SELECTs an expired identity after `rollback()`. `expire_on_commit=False` is set in `app/db.py:13` and the test fixture `conftest.py:101-106`; `join_transaction_mode="create_savepoint"` makes `rollback()` safe in tests. **Gap:** the re-read can still return `join_code=None` or a group that is now PUBLIC (M1). The only existing test precedent for the technique is in a file this spec deletes (L5). |
| Alembic 0060 downgrade shape | **Correct.** 0041 dropped `group_join_request_seq` (`0041_baseentity_id_uuid.py:275`, `DROP SEQUENCE IF EXISTS` at l.363-364) and retyped the PK, the 3 FK columns and `notifications.join_request_id` to UUID (l.107-109, l.127). The FK constraint names are unchanged (l.163-170). The spec does not state the UUID type of the re-added `join_request_id` or of the columns (L4). |
| Authorization matrix row placement | **Correct.** The join-requests row is at `authorization_matrix.py:107-117`, before row 26 (l.134) and row 27 (l.135). No earlier row matches `POST /api/groups/public/{id}/join-code`. GET and regenerate fall to rows 26 and 27 and collide with nothing. The "comment at l.94" should be edited, not removed (L7). |
| Limiter check-before-compare / Retry-After | The order is sound and matches ADR-001/007. The threshold (`>=`), the integer rounding of `Retry-After`, and the wait formula when a key overshoots its budget are not defined (L2). |
| `?code=` one-shot across login and token change | The `isStale` gate works on the current `useTermAccess`. After a `/login` round-trip the cached `forToken:null` data is stale, `refetchOnMount` refetches it (no `staleTime`, `api/queryClient.ts`), and TermPage shows the skeleton meanwhile (`TermPage.tsx:37`). **Gaps:** ownership of the sheet and the strip handshake (M2), a malformed `?code=` (M2), and no test for the token-change path (M8). |
| 403-hiding of JoinCodeCard | 403 and PUBLIC are specified. Loading and non-403 errors are not (M5). R25 and R27 contradict each other on which component owns `useJoinCode` (M4). |
| Theme test lists | **Wrong file.** `NO_LEGACY_UTILITY_FILES` lives in `themeTokenUsage.test.tsx:74`, not in `themeDefects.test.tsx`. The spec also never says to remove `RequestAccessDialog` from `themeDefects.test.tsx:91` (M6). |
| Test files touched by the removal | Mostly covered. Omissions: `GroupDetailsPage.test.tsx` (l.10 mock, l.77 label, terms mock), `themeDefects.test.tsx:91`, `ModalSheet.test.tsx:5,10`, `PendingActionsHost.test.tsx:19,399`, `test_group_access.py` (l.2, l.91, l.112, l.123), and `test_group_soft_delete_reads.py` (body must be a valid code) (M7, L8). |

Verified as accurate, with no finding: `join_requests.py:52-75`; `circles.py:167/356/364`; `memberships.py:28/59`; `users/service.py:97`; `_auth/dependencies.py:21-39`; `errors.py` (`_envelope` l.71, handlers l.144-162); `models.py:63-67`, `l.84-90`, `l.195-224`; `schemas.py:17/357/362-363/368/387/718-752`; `service.py:42-49`; `router/__init__.py:1/16/35`; `public_view.py:349-351/370-374/399-407/417` (`cast` is used elsewhere, so keeping it is correct); `repository.py:3/41-42/686-761`; `notifications_bridge.py:28/37`; `notifications/models.py:48-50/63-65/91-96`; `notifications/schemas.py:23`; `notifications/service.py:40/47-49/59`; 0042 l.48-51 precedent; `test_authorization_matrix.py:115-135`; `test_group_join_requests_router.py:24-58`; `api/groups.ts:13-16/268-271/461-516`; `api/notifications.ts:15-17/33-37`; `api/problem.ts:67-79`; `api/terms.ts:66`; `panelHelpers.ts:117-123/158`; `panelComponents.tsx:174-208`; `HomeView.tsx:60-66`; `PublicOrganizationPage.tsx:74,100`; `useCategories.ts:40-60`; `pages/krag/hooks/useToast.ts`; `PrivateGroupGate.tsx:52-67`; `GroupDetailsPage.tsx:11`; `GroupFormFields.tsx:74`; `CreateGroupStepper.tsx` done screen; `TermPage.test.tsx` 11/21-22/123/516-540/569-731/710/788; `PendingActionsHost.test.tsx` 19/28-32/133/400/544-733; `PublicLayout.test.tsx` 20-24/52/139-147; `CreateGroupStepper.test.tsx` 73-74/254-278; `ModalSheet.test.tsx` 158-194; `themeTokenUsage.test.tsx` 6/8-10/81/146-160. `test_domain_clock_guard.py` forbids only `datetime.now(` and `date.today(`, so `time.monotonic` is allowed. `notifications.kind` has no CHECK constraint, so deleting rows by kind is enough. `PanelPage.test.tsx` is not affected: its stepper fixture group is PUBLIC (`PanelPage.test.tsx:218`), so no card renders.

---

## Critical Issues
None.

## Important Gaps (Medium)

### M1. Lazy-GET re-read after `StaleDataError` can return a null code (→ 500) or a now-PUBLIC group
- **Spec section:** R7, Technical Approach "Lazy write", Key Decisions (ADR-004 / clarification 2)
- **Evidence:** `updated_at` is the `version_id_col` for every column write (`app/core/base_model.py:63-68`), so *any* concurrent write to the group raises `StaleDataError` on the lazy write. That includes an organizer's `PATCH /api/groups/{id}` rename or a visibility change. Only one cause, a concurrent lazy GET, leaves a code behind. After `rollback()` + `get_group`, `join_code` can still be `NULL`, and `visibility` can be `PUBLIC`. "Return the stored code" then returns `None` into `JoinCodeResponse.code: str`, which fails response validation (500) or leaks a code for a PUBLIC group.
- **Fix:** After the rollback, re-run the decision once:
  1. Re-read with `get_group`; 404 if it was soft-deleted in the meantime.
  2. If the group is PUBLIC, raise the PUBLIC 409.
  3. If a code is present, return it.
  4. If it is still null, generate and commit once more, and let a second `StaleDataError` reach the global 409 handler.

  Never read attributes of the pre-rollback `group` instance, because under AsyncSession an expired lazy load raises `MissingGreenlet`. Add a test variant where the concurrent write does not set a code.

### M2. `?code=` and sheet ownership are split between TermPage, PrivateGroupGate and JoinByCodeSheet with no interface
- **Spec section:** R22, R23, R24, Technical Approach "`?code=` lifecycle"
- **Evidence:**
  - The sheet is rendered today as the gate's `KragStage` overlay (`PrivateGroupGate.tsx:203-227`), and the gate owns `showDialog` (l.44).
  - R22 makes the gate's button open the sheet. R24 makes TermPage "open the sheet prefilled and auto-submit", then strip the parameter "after the attempt".
  - R22 lists no new gate props. The gate would need `initialCode`/`autoSubmit`, a join callback, an "attempt settled" callback, and a `hasCode` flag for the `loginRequired` copy ("Masz kod? …").
  - Several cases are unspecified:
    - A malformed `?code=` (e.g. `48291`, `abc`) never "attempts", because submit is disabled while the input is invalid (R23). The parameter is then never stripped.
    - The user can close the sheet (Esc/overlay; krag `ModalSheet.tsx:45-58` has no busy guard) while the auto-submit is in flight.
    - When auto-opened there is no opener button, so focus returns to `main` (`ModalSheet.tsx:37-41`), not to "Mam kod dostępu" as the Visual Design row states.
  - The one-shot ref is per TermPage mount. React Router reuses the element when only `:groupId`/`:termId` change, so a second code link opened in the same mount never auto-submits.
- **Fix:**
  - State the ownership: for example, TermPage owns `codeParam`, the one-shot ref and `joinWithCode`, and passes `initialCode`, `autoSubmit`, `onJoin(code)` and `hasCodeParam` to the gate, which forwards the first three to the sheet.
  - Strip in TermPage when the `joinWithCode` promise settles, independent of whether the sheet is still mounted.
  - A malformed or absent-after-normalization code opens the sheet prefilled, does not submit, and is stripped at once.
  - Key the ref by `(groupId, code)`.
  - State the focus fallback for an auto-opened sheet.
  - Remove only `code` from the search params and keep the others.

### M3. `pattern="[0-9]*"` conflicts with the spaced format the spec itself shows and accepts
- **Spec section:** R17, R23, R25 ("Kopiuj kod")
- **Evidence:** The hint is `6 cyfr, np. 123 456`. The mockup inputs hold `"482 913"` and `"482 910"` (`wpisz-kod-dost-pu-joinbycodesheet.html:265`). `parseJoinCode` strips spaces and hyphens. The card displays `482 913`. R23 still mandates `pattern="[0-9]*"`, as `validation.md` "Integer Inputs" requires. If the sheet is built as a `<form>` and the user presses Enter or the submit button, the browser's constraint validation blocks `"482 913"` with a native tooltip. The mockup's input carries no `pattern` attribute. jsdom does not enforce `pattern`, so no test can catch this. Existing krag dialogs use click handlers, not `<form>` (`RequestAccessDialog.tsx` and `RsvpDialog.tsx` have no `<form>`). The spec does not say which style to use or whether Enter submits.
- **Fix:** Either specify no `<form>` (click and Enter handled in JS), or `<form noValidate>`. Also specify that "Kopiuj kod" copies the raw 6 digits, so pasted codes need no normalization. Keep `pattern` for the mobile keyboard hint.

### M4. R25 and R27 disagree on who subscribes to `useJoinCode`, against `data-fetching.md`
- **Spec section:** R18, R25, R27, Technical Approach "Frontend data"
- **Evidence:** R25 says the card calls `useJoinCode(group.id, …)`. R27 says `GroupDetailsPage` enables `useGroupTerms` "only after the join-code GET succeeds", so the page needs the join-code query state too. That means either a second subscriber in the page, which `data-fetching.md` discourages ("passing a host hook's mutation callbacks down as props instead of re-subscribing in a child"), or a callback that is not specified. The stepper host (`CreateGroupStepper.tsx`) has the same question.
- **Fix:** Pick one shape. Option A: the host calls `useJoinCode` and passes `code`/`loading`/`denied`/`regenerate` into a presentational `JoinCodeCard`, and the page derives `termId` from `useGroupTerms`. Option B: the card owns both `useJoinCode` and, when no `termId` prop is given, `useGroupTerms`. Update R25, R27 and R28 to match.

### M5. JoinCodeCard states for loading and non-403 errors are not specified
- **Spec section:** R25, Success Criterion 7, mockup `szczeg-y-grupy-z-kart-kodu-organizator.html`
- **Evidence:** R25 specifies only "nothing on 403 and nothing for PUBLIC". Other cases are unspecified:
  - Loading.
  - 5xx or network error. The shared `queryClient` retries these twice (`api/queryClient.ts`).
  - 409 when the group was switched to PUBLIC after `GroupResponse` was loaded.
  - 404.

  The mockups show only the loaded states.
- **Fix:** Specify each state. For example: loading → nothing, or a one-line placeholder that avoids layout shift. Non-403 error → the card shell with `Nie udało się wczytać kodu — spróbuj ponownie` and a retry button. 409/404 → nothing.

### M6. Theme test-list instructions name the wrong file and miss a removal
- **Spec section:** R30 (`themeTokenUsage.test.tsx`, `themeDefects.test.tsx`), requirements.md "Theme test lists"
- **Evidence:**
  - `NO_LEGACY_UTILITY_FILES` is defined only in `src/frontend/src/test/themeTokenUsage.test.tsx:74-97`. `themeDefects.test.tsx` has only `IN_SCOPE_FILES` (l.83-127), so "add `JoinByCodeSheet` … to `NO_LEGACY_UTILITY_FILES`" in themeDefects is not possible.
  - `themeDefects.test.tsx:91` lists `components/krag/RequestAccessDialog.tsx`. Once that file is deleted, `readSource` throws ENOENT. The spec says only "add" for this file.
  - The `JoinCodeCard` rule has the same file mix-up: the list it must stay out of is in `themeTokenUsage.test.tsx`.
- **Fix:** Rewrite the two bullets:
  - `themeTokenUsage.test.tsx`: delete l.6, l.8-10 and l.146-160. Replace l.81 with `components/krag/JoinByCodeSheet.tsx` in `NO_LEGACY_UTILITY_FILES`. Do not add `JoinCodeCard` there. Optionally keep the "no dead kg-modal-overlay" render check retargeted to `JoinByCodeSheet`.
  - `themeDefects.test.tsx`: replace l.91 with `components/krag/JoinByCodeSheet.tsx` in `IN_SCOPE_FILES`.

### M7. `GroupDetailsPage.test.tsx` existing tests will break, and the spec lists only new tests
- **Spec section:** R27, Implementation Guidance "Frontend"
- **Evidence:**
  - `GroupDetailsPage.test.tsx:10` mocks `../api/groups` with a factory that lacks `getJoinCode` and `regenerateJoinCode`.
  - The fixture group is `visibility: "PRIVATE"` (l.23), so every existing test will mount the card and call an undefined function.
  - `../api/terms` is not mocked, which matters for `getTerms`.
  - l.77 asserts `Prywatna (dostęp na prośbę)`, and R27 changes that label.
- **Fix:** Add to R30 or R27's test notes: extend the l.10 factory with `getJoinCode` and `regenerateJoinCode` (default `mockRejectedValue(new ApiError(403, …))`, or a resolved code), add `vi.mock("../api/terms", () => ({ getTerms: vi.fn() }))`, and update l.77 to `Prywatna (dostęp z kodem)`.

### M8. No test for the riskiest `?code=` path: token change and stale `/access`
- **Spec section:** R24, Testing Approach (TermPage, about 7 tests)
- **Evidence:** The listed tests cover "`?code=` → exactly one redeem" and "anonymous `?code=` → `returnTo` keeps the code". No test covers the case where the token changes while `?code=` is present and the first refetch is still pending or has failed. That case is exactly where `isStale` must suppress the auto-submit (`useTermAccess.ts:72`, `TermPage.tsx:37`), and the existing l.710 test already shows how to drive it (`mockAuth` + `rerender`).
- **Fix:** Add a test: render with `token:null` and `?code=482913`, so the gate is `loginRequired`. Rerender with a token while the next `getGroupAccess` is a pending promise, and assert no `redeemJoinCode` call. Resolve it to `canEnterCode` and assert exactly one redeem and the parameter removed. Optionally add the failed-refetch variant, which shows the retry line and does not redeem.

### M9. Regenerate error surfacing in `ConfirmDeleteDialog` is not specified
- **Spec section:** R18, R26
- **Evidence:** `ConfirmDeleteDialog.handleConfirm` shows `err.message` or `fallbackError` (`ConfirmDeleteDialog.tsx:56-61`). A raw `ApiError` has the message `"409 Conflict"` (`api/client.ts:7`). ADR-008 says `regenerate` "surfaces `extractProblemMessage` text". R18 is silent, and so is `fallbackError` for the regenerate confirm. The dialog closes only when the parent unmounts it after `onConfirm` resolves.
- **Fix:** In R18, `regenerate` rethrows `new Error(serverMessageOr(err, "Nie udało się wygenerować kodu — spróbuj ponownie"))`, following the `useCategories.ts:48-57` pattern. In R26, give `fallbackError` the same text and state that JoinCodeCard unmounts the dialog and shows `Wygenerowano nowy kod` on success.

## Minor Discrepancies (Low)

### L1. `_get_caller_party_id` "fix its annotation to return `uuid.UUID`" is ambiguous
- **Section:** R6. **Evidence:** It returns `tuple[int, str]` (`join_requests.py:52-59`) as `(profile.party_id, profile.display_name)`, and `party_id` is `uuid.UUID` (`users/models.py:50`). **Fix:** Say "return only `profile.party_id` as `uuid.UUID` (drop `display_name`)" or "`tuple[uuid.UUID, str]`".

### L2. Limiter threshold and `Retry-After` formula are undefined
- **Section:** R3, R4, Testing ("the 11th failure gives 429"). **Evidence:** HLD Example 2 implies blocking when `count >= limit` (the 11th *attempt* after 10 failures). The spec's wording is "11th failure". `time.monotonic` returns floats, but `Retry-After` must be an integer. With in-flight overshoot (accepted in the Technical Approach), "oldest + window − now" under-reports the wait. **Fix:**
  - A key is exceeded when `len(window) >= limit`.
  - The wait is `ts[len - limit] + window − now`.
  - Header: `max(1, ceil(wait))` seconds. Message: `ceil(seconds/60)` minutes.
  - Rename the test to "11th attempt".
  - Delete keys whose list becomes empty after pruning, so the dict stays bounded.
  - State that the methods are synchronous (no lock is needed in one event loop).

### L3. `TooManyAttemptsException` shape differs from the HLD and puts join-code wording in core
- **Section:** R3 vs HLD component table (`TooManyAttemptsException(message, retry_after)`). **Evidence:** In the spec, the constructor takes only `retry_after_seconds` and the generic handler in `app/core/errors.py` hard-codes `Za dużo prób wpisania kodu …`. The base class is unspecified. **Fix:** Use `TooManyAttemptsException(message: str, retry_after_seconds: int)`, subclassing `Exception` (not `ValueError`/`BusinessConflictException`). The groups use case builds the message, and the handler adds only the header.

### L4. 0060 downgrade column types are not spelled out
- **Section:** R12, Technical Approach "Migration safety". **Evidence:** The post-0041 shape is:
  - `id UUID PK DEFAULT gen_random_uuid()` (`0041:338-347`)
  - `group_id`, `requester_party_id`, `term_id` as UUID (`0041:107-109`)
  - `status VARCHAR(20)`, plus `created_at`/`updated_at TIMESTAMP NOT NULL` (`0037:51-56`)
  - `notifications.join_request_id UUID NULL` (`0041:127`; the model is at `notifications/models.py:94-96`)

  0037/0038 used BigInteger, so copying them verbatim is wrong. **Fix:** List these types explicitly in R12 and in the downgrade docstring. The order is create table, then indexes, then add the column, the reverse of the upgrade. State that no sequence is created.

### L5. The `StaleDataError` test technique is not specified, and its only precedent is being deleted
- **Section:** Testing Approach ("a lazy-GET `StaleDataError` path returns the stored code"), R13. **Evidence:** The deterministic precedent (monkeypatch a repository getter, run a raw `UPDATE … updated_at = updated_at + interval '1 second'`, then `commit`) lives in `tests/test_group_join_requests_decisions.py:312-350`, which R13 deletes. **Fix:** Describe the technique in the spec. Monkeypatch the name exactly as `join_code.py` resolves it (e.g. `repository.get_group` if `get_group` calls through the module). Have the behind-the-ORM UPDATE set `join_code = '123456'`, plus an M1 variant without the code. Call `db_session.rollback()` before the final assertions, as the precedent does.

### L6. Copied test helpers carry a clock-standard violation and wrong types
- **Section:** R13 ("copy the helpers at l.24-58 first"). **Evidence:** `_create_circle_and_term` uses `date.today()` (`test_group_join_requests_router.py:42`). `backend-testing.md`/`time.md` require Term dates from `clock.local_now()`. `_register` is annotated `tuple[str, int]`, but `party_id` is a UUID. **Fix:** When copying, use `clock.local_now()` and annotate with `uuid.UUID`.

### L7. Matrix l.94: "remove the comment" should be "edit it"
- **Section:** R10. **Evidence:** The comment at `authorization_matrix.py:94-99` documents the `/access` row and only *mentions* `join_request` at l.94. **Fix:** Drop `/join_request` from l.94 and keep the comment. Also: R14 keeps the l.124/l.125 cases, which sit inside the deleted parametrize (l.115-135), so say they move into the new join-code parametrize. The HLD's regression case ("without the row it would resolve to row 27 EDIT") is missing from R14.

### L8. Backend test edits not listed, which the R31 gate or a KeyError will hit
- **Section:** R14 (backend tests), R31. **Evidence:**
  - `test_group_access.py`:
    - l.2 docstring mentions `join_request`.
    - Test names at l.91 and l.112 contain `NoJoinRequest`, which the R31 grep matches.
    - l.123 `body["access"]["join_request"]` becomes a KeyError (it is not a key set).
    - The key sets are at l.68/86/107. The HLD's l.53/73/91/112 are function starts.
  - `test_group_soft_delete_reads.py:243-245` posts `json={}`. A redeem with `{}` returns 400 (pattern validation) before 404, so the replacement must send a valid 6-digit code.
  - `test_private_group_access_defects.py:6-7` (B14 "no endpoint may grant membership without the organizer's approval") is now false. It is listed as prose, but the meaning changes.

  **Fix:** List these explicitly.

### L9. Frontend test edits not listed
- **Section:** R30. **Evidence:**
  - `ModalSheet.test.tsx:5` (import) and `l.10` (`vi.mock` with `createJoinRequest`) sit outside the cited l.158-194.
  - In the same file, the registry count stays `3` after a 1:1 swap (l.191), so "update the registry count" is misleading.
  - `PendingActionsHost.test.tsx:399` (`[PENDING_JOIN_REQUESTS_KEY]` assertion) sits next to the cited l.400.
  - `PublicLayout.test.tsx:142` names a test "no join-request fetch", which should be deleted, not just have its assertion removed.

  **Fix:** Add these lines. State that the ModalSheet count stays 3 (or say what it changes to and why).

### L10. Binding mockup contradicts the "unchanged" `AuthGateLinks` copy
- **Section:** Visual Design row `screen:private-gate-anonymous`, R22. **Evidence:** The mockup shows "Zaloguj się / Załóż konto". The real `AuthGateLinks` renders "Zaloguj się" plus "Nie masz konta? Zarejestruj się" (`components/krag/AuthGateSheet.tsx:22-43`). The spec says both "unchanged" and "mockups binding". **Fix:** State that the existing `AuthGateLinks` copy wins, and treat the mockup label as illustrative.

### L11. Sheet details left open: empty input, server-error `aria-invalid`, Enter key, `serverMessageOr` scope
- **Section:** R20, R23. **Evidence:**
  - The mockup's empty state has submit `disabled` and `aria-invalid="false"`. The 409, 429 and other-error states set `aria-invalid="true"` (`wpisz-kod…html:265`). R23 covers only the local error.
  - R20 applies `serverMessageOr`, which also passes 400 non-field messages and 503, and maps 403 to `ACCESS_DENIED_MESSAGE` (`api/problem.ts:67-79`). R23 says "anything else → `Nie udało się dołączyć`".

  **Fix:** Specify:
  - Empty input → no alert, submit disabled.
  - Server errors use the same alert slot and set `aria-invalid="true"`.
  - Whether Enter submits.
  - The fallback string passed to `serverMessageOr` = `Nie udało się dołączyć — spróbuj ponownie`.

### L12. The R31 removal gate is weaker than its intent, and the HLD prose items were dropped
- **Section:** R31, Success Criterion 5. **Evidence:** The case-sensitive identifiers do not match:
  - `joinRequestId`/`joinRequestBusy` (`PendingActionsHost.tsx:54-59`)
  - `PENDING_JOIN_REQUESTS_KEY`
  - `join-requests` URL strings
  - `_request_access`

  SC5 omits `RequestAccessDialog`, which R31 includes. The HLD prose inventory also lists the 2026-10-19 user guide l.214 and DEV22 state, which are outside `src/`. **Fix:** Use `rg -i "join.?request|GROUP_JOIN_|RequestAccessDialog" src/ -g '!src/backend/alembic/versions/**'`, align SC5 with R31, and either restore or explicitly drop the two `.maister` prose items.

## Clarification Needed
1. M1: when the lazy-GET re-read still finds no code, should it regenerate once, or answer 409?
2. M2: should TermPage or PrivateGroupGate own the sheet state? What happens to a malformed `?code=`?
3. M3: should "Kopiuj kod" copy raw digits or the spaced format? Should the sheet use `<form noValidate>` or click handlers only?
4. M4: should the host or the card own `useJoinCode`, and should the card own `useGroupTerms`?
5. R9 step 5: does the `{created:false}` path also call `limiter.clear`? (It is unspecified. Recommend yes, for symmetry with "success clears the user key".)
6. L10: should the `AuthGateLinks` copy or the mockup copy win?

## Extra Features (beyond requirements/HLD)
- The R27 "no upcoming term → only Kopiuj kod" variant and the `useGroupTerms` hook are covered by clarification 1 and scope decision 7. Not an extra.
- The ACCESS_DENIED_MESSAGE rewording (R16) is in the HLD copy table. Not an extra.
- None found.

## Recommendations (ordered)
1. Amend R7 with the bounded re-read/retry rule (M1), and add the matching test variant (L5).
2. Add a short "`?code=` contract" subsection: owner, props, strip trigger, malformed code, focus fallback, ref key (M2). Add the M8 test.
3. Decide on M3 (raw-digit copy plus no native validation) and M4 (hook ownership), and update R23, R25, R27 and R28.
4. Fix the R30 theme-list bullets (M6). Extend the R30 and R14 test-site lists with M7, L8 and L9.
5. Tighten R3 and R4 numerics (L2, L3) and the R12 column types (L4).
6. Broaden the R31 regex (L12).

---

## Standards Consistency Notes
- `backend/migrations.md`: two focused revisions, a downgrade→upgrade test per migration, explicit names, reverse-order drops. Consistent (see L4 for types).
- `backend/security.md`: the matrix row is placed for first-match order, and `require_any()` with no args means authenticated (`_auth/dependencies.py:21-39`). Consistent.
- `backend/time.md`: the limiter's `time.monotonic` is not checked by `test_domain_clock_guard.py:25-39`. Membership dates go through `clock.local_now()` in `add_active_membership` (`memberships.py:35`). Consistent, but see L6 for test helpers.
- `testing/backend-testing.md`: an autouse limiter-reset fixture belongs in `tests/conftest.py`. Import the limiter module *inside* the fixture body, as `freeze_local_now` does at `conftest.py:122-126`, so the module-top `os.environ` setup still runs before any `app` import.
- `frontend/data-fetching.md`: R18/R20 follow the `useCategories` write pattern. M4 is the one tension (child re-subscription).
- `frontend/accessibility.md`: the krag `ModalSheet` gives trap, Esc and registry. The confirm is the z-70 registered alertdialog. Consistent. See M2 for focus return on auto-open.
- `global/validation.md`: consistent on paper. See M3 for the `pattern` versus spaced-input interaction.
