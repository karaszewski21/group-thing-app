# Specification: Join a PRIVATE group with a 6-digit access code (replacing GroupJoinRequest)

> Revision 2 (2026-10-21): resolves the spec audit (`verification/spec-audit.md`, M1–M9, L1–L12) using the user's binding decisions. See "Audit resolution" at the end.

## TL;DR
Every PRIVATE group gets one 6-digit code, stored in plaintext in `groups.join_code`. The code is created lazily on the organizer's first GET (with one bounded retry after a concurrent write), and only "Wygeneruj nowy kod" rotates it.
Organizers see the code in a presentational `JoinCodeCard`, fed by its host page (GroupDetailsPage, stepper done screen). Visitors enter it in a `JoinByCodeSheet` (`<form noValidate>`). TermPage owns `?code=` and the sheet state, and auto-submits a valid `?code=` once. On success the visitor becomes an active member through the unchanged `add_active_membership`.
Redeem follows 401 → 404 → 429 → 409 → 200 `{created}`, behind an in-process limiter with two keys: 10 failed attempts per 15 min per (party, group), and 30 per hour per group. Any correct-code 200 clears that user's key.
The "poproś o dostęp" mechanism is deleted end to end: backend, frontend, notifications, tests, the table (migrations 0059 and 0060) and two `.maister` prose items.

## Key Decisions
- 6-digit numeric code bounded by a per-group failure budget rather than by entropy — the user chose 6 digits; at 30 failures per hour per group, expected guessing time is about 1.9 years (ADR-001).
- Plaintext nullable `groups.join_code` VARCHAR(6), no index, exposed only through the organizer endpoints — organizers must be able to read and copy it, and hashing 10^6 values adds no protection (ADR-002).
- In-process sliding-window limiter at `app/groups/application/join_code_limiter.py` with an injectable clock and `reset()` — the app runs as a single uvicorn process, so this needs no new dependency and no DB writes. It has a single consumer, so it lives in the groups BC rather than in core (ADR-003, scope decision 8).
- Lazy get-or-create GET plus an explicit regenerate; no expiry, no backfill. On `StaleDataError` the GET rolls back, re-reads and re-decides once: PUBLIC → 409, code present → return it, still null → generate one more time; a second failure goes to the existing 409 handler. It never returns `None` or a 500 (ADR-004, clarification 2, audit M1).
- `JoinByCodeSheet` is built on the krag `ModalSheet` as a `<form noValidate>`: Enter submits, and a pasted `482 913`/`482-913` is accepted and normalized by `parseJoinCode` (ADR-005, audit M3).
- TermPage owns `?code=`, the one-shot guard, the sheet's open state and the join callback. `PrivateGroupGate` only renders the button and the sheet from props. A malformed `?code=` is stripped at once and opens the sheet empty (audit M2).
- The host page calls `useJoinCode` (and, on GroupDetailsPage, `useGroupTerms`) and passes `code`, `status`, `regenerate`, `onRetry` and `termId` to a presentational `JoinCodeCard`, so each query has exactly one subscriber (`data-fetching.md`, audit M4).
- "Kopiuj kod" copies the raw 6 digits (`482913`); the card displays `formatJoinCode` (`482 913`) (audit M3).
- Join requests are deleted in full, with no data migration — the app has no production data (ADR-006, clarification 3).
- Redeem returns one 409 message for both "wrong code" and "no code yet", and returns idempotent 200 `{created:false}` to members and organizers — the response leaks nothing, and the organizer case matches `/access` (ADR-007, scope decision 6). That `{created:false}` path also clears the caller's (party, group) limiter key; the group key is never cleared (user decision 5).
- `JoinCodeCard` appears on GroupDetailsPage and on the stepper done screen, only for PRIVATE groups; 403 renders nothing, loading renders a skeleton, other errors render an inline retry — `GroupResponse` stays free of the code (ADR-008, audit M5).
- Frontend writes use `useCallback` + api call + `await invalidateQueries` with local busy state, not `useMutation`. Errors are rethrown as `new Error(serverMessageOr(err, fallback))`, so no dialog ever shows `409 Conflict` (`useCategories.ts` pattern, audit M9).
- The regenerate confirm reuses `ConfirmDeleteDialog`, extended with optional `tone` and `busyLabel` props — the change is additive and keeps z-70, trapFocus, Esc and the sheet registry.
- "Kopiuj link z kodem" on GroupDetailsPage targets the nearest term with `occurs_on` on or after the start of today, loaded by a new `useGroupTerms`. With no such term, only "Kopiuj kod" is shown (clarification 1, scope decision 7).
- `AuthGateLinks` is unchanged ("Zaloguj się" + "Nie masz konta? Zarejestruj się"); the mockup's "Załóż konto" label was an approximation (audit L10).

## Open Questions / Risks
- **Accepted consequence (explicit):** a member who joins by code is invisible to the organizer until they RSVP, because `list_group_members` lists RSVP attendees only. Nobody can remove them: `POST /api/memberships/{id}/end` is self-only and has no UI. Regenerating the code only blocks new joins. Follow-ups: an organizer list of active members, member removal, and a "dołączył(a) kodem" notification.
- **Residual brute force:** a sustained attack on a group succeeds with about 2.2% probability per 30 days and about 26% per year. Regenerating revokes a leaked code but does not reset this risk. Accepted.
- **Accepted DoS:** any account can use up a group's 30-per-hour budget and block every visitor, including those holding the right code, for up to 1 h. One account can do this alone in about 45 min. Regenerating does not lift the block.
- **Single process only:** limiter state is lost on restart and weakens if uvicorn ever runs with more than one worker. A docstring caveat is required, and a DB-backed limiter is a follow-up.
- **Duplicate memberships:** concurrent redeems can still insert two active memberships, because there is no unique index. This is mitigated, not prevented, by the in-request `_is_active_member` re-check, the busy-disabled submit and the one-shot `?code=` ref. A partial unique index is a follow-up.
- **Code not on the panel link:** the panel's "Kopiuj link do terminu" (`PanelDataContext.tsx:905-911`) still carries no code. Visitors arriving through it must type the code. Adding it is a follow-up.
- **Focus after an auto-opened sheet:** with no opener button, closing the sheet returns focus to the `main[tabindex=-1]` fallback (`ModalSheet.tsx:37-41`), as `accessibility.md` allows. On success the gate unmounts anyway.
- **Deviation from the HLD:** the HLD writes `TooManyAttemptsException(message, retry_after)`; this spec names the second argument `retry_after_seconds`. Same shape, clearer unit.

## Goal
Let a logged-in visitor who holds the organizer's 6-digit code become a member of a PRIVATE group in one sitting, with no organizer action. Remove the request/approve mechanism completely.

## User Stories
- As an **organizer** of a PRIVATE group, I want to see, copy and share my group's access code (or a term link that carries it), so that the people I invite can join without waiting for my approval.
- As an **organizer**, I want to generate a new code after a leak, so that the old code stops working while existing members stay in.
- As a **logged-in visitor** on a private term page, I want to type the code I was given and see the term right away, so that I can RSVP in the same sitting.
- As an **anonymous visitor** following a `?code=` link, I want the code to survive login and be applied automatically, so that I don't have to retype it.
- As a **member** opening an old `?code=` link, I want to land on the term directly, without errors.

## Core Requirements

### Backend: data and errors
- **R1** Add `Group.join_code: Mapped[str | None]` as `String(6)`, nullable, after `default_capacity` in `app/groups/models.py`. Never include it in `GroupResponse`, `PublicCircleResponse`, `ModerationGroupResponse`, `/access`, notifications or logs.
- **R2** Migration `0059_group_join_code.py` (down revision `0058`) adds `groups.join_code VARCHAR(6) NULL` with no backfill and no index. The downgrade drops the column.
- **R3** Add `TooManyAttemptsException(message: str, retry_after_seconds: int)` to `app/core/errors.py`. It subclasses `Exception` directly (not `ValueError` or `BusinessConflictException`) and holds no join-code wording.
  - `_envelope` gains an optional `headers` param.
  - A 429 "Too Many Requests" handler returns the standard envelope with the exception's `message` and a `Retry-After: <retry_after_seconds>` header. It only adds the header; it builds no text.
  - Register it in `register_exception_handlers` before the `ValueError`/`Exception` handlers.

### Backend: limiter
- **R4** Create `app/groups/application/join_code_limiter.py`: a module-level sliding-window store whose constructor takes `clock: Callable[[], float] = time.monotonic`. All methods are synchronous (no lock is needed in one event loop).
  - Key `(party_id, group_id)`: limit 10 per 15 min. Cleared by that party's correct-code redeem (R9 steps 5 and 6).
  - Key `group_id`: limit 30 per hour. Never cleared.
  - **Threshold:** after pruning, a key is exceeded when `len(timestamps) >= limit`. So 10 failures are allowed, and the 11th attempt is blocked before comparison.
  - **Wait:** for an exceeded key, `wait = ts[len - limit] + window − now`. This stays correct when in-flight requests overshoot the budget.
  - `check(party_id, group_id)` raises `TooManyAttemptsException` with the longest wait among the exceeded keys. `retry_after_seconds = max(1, ceil(wait))`. The message is built here (groups BC): `Za dużo prób wpisania kodu — spróbuj ponownie za {n} min`, with `n = ceil(retry_after_seconds / 60)`.
  - `record_failure()` appends `now` to both keys.
  - `clear()` drops the user key only.
  - Expired timestamps are pruned on the touched keys. A key whose list becomes empty is deleted, so the dict stays bounded.
  - `reset()` clears all state for tests.
  - A docstring caveat states that it is single-process and in-memory.
- **R5** An autouse fixture in `tests/conftest.py` calls the limiter's `reset()` around every test. Import the limiter module inside the fixture body (as `freeze_local_now` does at `conftest.py:122-126`), so the module-top `os.environ` setup still runs before any `app` import.

### Backend: use cases and API
- **R6** Create `app/groups/application/join_code.py`, porting `_get_private_group` and `_get_caller_party_id` from `join_requests.py:52-75`. The ported `_get_caller_party_id` returns only `profile.party_id`, typed `uuid.UUID` (drop `display_name`, which no join-code use case needs). Codes are generated with `secrets` (6 digits, zero-padded) and compared with `secrets.compare_digest`.
- **R7** `GET /api/groups/{group_id}/join-code` (organizer):
  - Error order: 404 unknown or soft-deleted group → 403 not an active organizer → 409 PUBLIC group (`Grupa jest publiczna — kod dostępu nie jest potrzebny`) → 200 `{"code": "482913"}`.
  - When the column is null, generate a code and commit.
  - On `StaleDataError` from that commit (any concurrent write bumps `updated_at`, e.g. a rename or a visibility change):
    1. `rollback()`, then re-read with `get_group` (404 if it was soft-deleted meanwhile). Never read attributes of the pre-rollback instance; under AsyncSession an expired lazy load raises `MissingGreenlet`.
    2. Group is now PUBLIC → the PUBLIC 409.
    3. Code present → return it.
    4. Code still null → generate and commit one more time. If that commit also raises `StaleDataError`, let it propagate to the existing global `StaleDataError` 409 handler.
  - The organizer check is not repeated after the re-read; the 403 was decided at the start of the request.
  - It never returns `None` and never returns a 500.
  - Falls under matrix row 26 (READ).
- **R8** `POST /api/groups/{group_id}/join-code/regenerate`: same checks as R7, always writes a new code and commits, returns 200 `{code}`. A race surfaces as the existing `StaleDataError` 409. Limiter counters are untouched. Falls under matrix row 27 (EDIT).
- **R9** `POST /api/groups/public/{group_id}/join-code`, body `{code}`, validated by `Field(pattern=r"^[0-9]{6}$")` (400 "Validation failed" on violation). Order:
  1. 401: no principal, or principal without a profile.
  2. 404: unknown, soft-deleted or PUBLIC group.
  3. 429: `limiter.check`, run before any comparison.
  4. 409: null or mismatched code. The message is the same in both cases: `Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie`. The failure is recorded on both keys.
  5. Active organizer, or `_is_active_member` (re-checked inside this request): `limiter.clear` (user key only), 200 `{created:false}`, no insert.
  6. Otherwise `add_active_membership`, commit, `limiter.clear`, 200 `{created:true}`.
- **R10** Authorization matrix:
  - Remove the join-requests row (l.107-117).
  - Edit the comment at l.94-99: drop only the `/join_request` mention at l.94 and keep the rest, which documents the `/access` row.
  - Add `(_methods("POST"), r"^/api/groups/public/[^/]+/join-code$", "AUTHENTICATED")` in the same slot, before row 27, with a comment explaining why it precedes row 27.
  - The route uses `Depends(require_any())`.
- **R11** Add the schemas `JoinCodeResponse`, `RedeemJoinCodeRequest` and `RedeemJoinCodeResponse`. Re-export the three use cases from `app/groups/service.py`. Create `app/groups/router/join_code.py`, declaring the literal `/public/` path before `{group_id}`, and register it in `router/__init__.py` in the old router's slot.

### Backend: removal
- **R12** Migration `0060_drop_group_join_requests.py`, in this order:
  1. `DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'` (precedent: 0042:48-51).
  2. Drop `notifications.join_request_id`. It is a loose column with no FK or index.
  3. Drop table `group_join_requests`.

  Do not touch the sequence; 0041 already dropped it, and the downgrade creates none. The downgrade recreates the post-0041 shape, not the 0037/0038 BigInteger shape. Its docstring lists these types:
  - `id UUID` PK, `server_default=gen_random_uuid()`, `pk_group_join_requests` (`0041:338-347`)
  - `group_id`, `requester_party_id`, `term_id` as `UUID` with the unchanged FK names (`0041:107-109`, `0041:163-170`)
  - `status VARCHAR(20)`, `created_at TIMESTAMP NOT NULL`, `updated_at TIMESTAMP NOT NULL` (`0037:51-56`)
  - the same indexes and the partial unique index on PENDING
  - `notifications.join_request_id UUID NULL` (`0041:127`)

  Downgrade order is the reverse of the upgrade: create the table, then its indexes, then add the column. Deleted notifications are not restored.
- **R13** Delete:
  - `app/groups/application/join_requests.py`
  - `app/groups/router/join_requests.py`
  - `tests/test_group_join_request_model.py`
  - `tests/test_group_join_requests_router.py`. Copy the helpers at l.24-58 into `tests/test_group_join_code.py` first, with two fixes: build Term dates from `clock.local_now()` instead of `date.today()` (l.42), and annotate `_register` as `tuple[str, uuid.UUID]`.
  - `tests/test_group_join_requests_decisions.py`. Its `StaleDataError` technique (l.312-350) is restated in the Testing Approach before the file goes.
- **R14** Edit to remove every join-request identifier:
  - `app/groups/models.py`: `GroupJoinRequestStatus` l.63-67, `GroupJoinRequest` l.195-224. Rewrite the `GroupVisibility` docstring l.84-90 to "join with the organizer's access code".
  - `app/groups/schemas.py`: import l.17 (keep the `Literal` used at l.387), prose l.357 and 362-363, field `join_request` l.368, schemas l.718-752.
  - `app/groups/service.py`: imports l.42-49 and the `__all__` entries.
  - `app/groups/router/__init__.py`: l.1, 16, 35.
  - `app/groups/application/public_view.py`: `_GATE_JOIN_REQUEST_STATUSES` l.349-351, docstring l.370-374, block l.399-407, `join_request=` l.417, the related imports, and the prose at l.455-457 (keep the `cast`).
  - `app/groups/infrastructure/repository.py`: l.3, imports l.41-42, section l.686-761.
  - `app/groups/infrastructure/notifications_bridge.py`: l.28, 37.
  - `app/notifications/models.py`: docstring l.48-50, kinds l.63-65, column l.91-96.
  - `app/notifications/schemas.py`: l.23.
  - `app/notifications/service.py`: l.40, 47-49, 59.
  - `app/core/authorization_matrix.py`: see R10.

  Backend tests:
  - `tests/test_group_access.py`:
    - l.2 docstring: drop the `join_request` mention.
    - Drop `join_request` from the key sets at l.68, 86 and 107.
    - Rename the tests at l.91 and l.112 to drop `NoJoinRequest`.
    - Delete the l.123 `body["access"]["join_request"]` assertion (it would raise `KeyError`).
    - Remove `_request_access`, and rewrite l.316/344/366/393 as code flows or delete them.
  - `tests/test_authorization_matrix.py`:
    - Remove the parametrize at l.115-135. Its l.124 case (`POST /api/groups/public/42/join` → EDIT) and l.125 case (`/api/memberships/42/end` → EDIT) move into the new join-code parametrize. Keep l.138-147.
    - Add `POST /api/groups/public/42/join-code` → AUTHENTICATED, plus `GET /api/groups/42/join-code` → row 26 and `POST /api/groups/42/join-code/regenerate` → row 27.
    - Add the HLD regression test: evaluating the matrix with the join-code row removed resolves the redeem path to row 27 EDIT.
  - `tests/test_group_soft_delete_reads.py`: replace l.192-209 and the l.243-245 entry with "redeem on soft-deleted group → 404". The request must send a valid body (`{"code": "123456"}`); `{}` returns 400 before 404.
  - `tests/test_private_group_access_defects.py`: rewrite the l.1-7 prose, including B14 at l.6-7 ("no endpoint may grant membership without the organizer's approval"). That rule is now "only with the organizer's access code".
  - Prose only: `tests/test_add_active_membership.py:1-2`.

### Frontend: API and hooks
- **R15** `api/groups.ts`:
  - Remove the docstring l.13-16, `GroupAccessDetails.join_request` l.268-271, and the section l.461-516.
  - Add `getJoinCode`, `regenerateJoinCode` and `redeemJoinCode`, plus their types.
  - `api/notifications.ts`: remove the kinds l.15-17 and `join_request_id` l.33-37.
- **R16** `api/problem.ts`:
  - `serverMessageOr` also passes 429 server messages through.
  - `ACCESS_DENIED_MESSAGE` becomes `Nie masz uprawnień do tej akcji. Zaloguj się ponownie albo poproś organizatora o kod dostępu.`
- **R17** New `utils/joinCode.ts`:
  - `parseJoinCode(raw)` returns `null` for empty input, the 6-digit string when valid, and `undefined` when invalid. It strips spaces and hyphens first, following the `parseCapacity` model. TermPage also uses it to validate `?code=`.
  - `formatJoinCode(code)` returns `"482 913"`.
- **R18** (see Post-verification amendments) New `hooks/useJoinCode(groupId, {enabled})`:
  - A query keyed by a `JOIN_CODE_KEY` prefix plus `groupId`.
  - Returns `code: string | null`, `status: "loading" | "ready" | "denied" | "error"` (`denied` = `ApiError` 403; `error` = any other failure), `error: string | null`, `refetch(): Promise<void>` and `regenerate()`.
  - `regenerate()` uses `useCallback` + `regenerateJoinCode` + `await invalidateQueries([JOIN_CODE_KEY])`. On failure it rethrows `new Error(serverMessageOr(err, "Nie udało się wygenerować kodu — spróbuj ponownie"))`, so `ConfirmDeleteDialog` never shows a raw `409 Conflict`.
  - Exactly one subscriber per screen: the host page (R27, R28). `JoinCodeCard` never calls it.
- **R19** New `hooks/useGroupTerms(groupId, {enabled})` wraps `getTerms`. Callers pick the earliest term with `occurs_on` on or after `dayjs().startOf("day")`, using `dayjs` from `src/utils/dayjs.ts`.
- **R20** `hooks/useTermAccess` gains `joinWithCode(code)`: `redeemJoinCode`, then `await invalidateQueries(["groupAccess", groupId])`. Errors are rethrown as `new Error(serverMessageOr(err, "Nie udało się dołączyć — spróbuj ponownie"))`. `serverMessageOr` passes the server text through for 409, 429, 400 and 503, and maps 403 to `ACCESS_DENIED_MESSAGE` (`api/problem.ts:67-79`).

### Frontend: visitor
- **R21** `pages/krag/termAccess.ts`: `PrivateGate` becomes `loginRequired | canEnterCode`. The pending/rejected derivation is removed.
- **R22** (see Post-verification amendments) `PrivateGroupGate.tsx` keeps its shell (`KragStage`, `GroupHeader`, `CARD`, heading `Ta grupa jest prywatna`) and its existing props. Remove canRequest/pending/rejected/withdraw, `showDialog`, `createConflict` and the focus/visibilitychange polling (l.52-67). It owns no sheet or `?code=` state.
  - New props, all supplied by TermPage (R24):
    - `hasCodeParam: boolean` — selects the `loginRequired` copy.
    - `sheetOpen: boolean`
    - `onOpenSheet(): void` — called by "Mam kod dostępu".
    - `onCloseSheet(): void`
    - `initialCode: string` — `""` when none.
    - `autoSubmit: boolean`
    - `onJoin(code: string): Promise<void>` — TermPage's wrapper around `joinWithCode`.
  - When `sheetOpen`, the gate renders `JoinByCodeSheet` as its `KragStage` overlay, forwarding `initialCode`, `autoSubmit`, `onJoin` (as `onSubmit`) and `onCloseSheet` (as `onClose`).
  - `loginRequired`: body text `Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby wpisać kod dostępu.`, or `Masz kod? Zaloguj się, żeby go użyć.` when `hasCodeParam`, plus the unchanged `AuthGateLinks` (`returnTo` = pathname + search).
  - `canEnterCode`: body text `Zajęcia i lista uczestników są widoczne tylko dla członków. Wpisz kod dostępu od organizatora, aby dołączyć.` and a primary `Mam kod dostępu` button that calls `onOpenSheet`. Focus returns to it when a sheet it opened closes.
- **R23** New `components/krag/JoinByCodeSheet.tsx` on the krag `ModalSheet`:
  - Props: `initialCode: string`, `autoSubmit: boolean`, `onSubmit(code: string): Promise<void>`, `onClose(): void`.
  - Body is a `<form noValidate>`. Enter in the field and the `Dołącz` button both submit through the form's submit handler, so the browser never blocks a spaced value with its native `pattern` tooltip.
  - Title `Wpisz kod dostępu`; one field labeled `Kod dostępu` with hint `6 cyfr, np. 123 456`.
  - Input: `type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code"`, raw string in state (initialized from `initialCode`). `pattern` stays only as the mobile keyboard hint. Pasted `482 913` or `482-913` is accepted; `parseJoinCode` normalizes it before `onSubmit`.
  - States:
    - Empty input (`parseJoinCode` → `null`): no alert, `aria-invalid="false"`, submit disabled.
    - Invalid input (`undefined`): inline `role="alert"` with `Kod ma 6 cyfr`, `aria-invalid="true"`, `aria-describedby` to the alert, submit disabled.
    - Busy: the submit reads `Dołączanie…`, is disabled and has `aria-busy`; `Anuluj` is disabled and Esc/overlay close are ignored, so the sheet cannot close mid-request.
    - Server error: the message from `onSubmit`'s rejection (409 and 429 verbatim, otherwise the R20 fallback) in the same alert slot, with `aria-invalid="true"`. The sheet stays open with the input kept. Editing the input clears the server error.
  - Auto-submit: when `autoSubmit` is true and `initialCode` parses to a code, the sheet submits once on mount (a sheet-local ref, safe under StrictMode).
  - Buttons `Anuluj` / `Dołącz`.
- **R24** (see Post-verification amendments) `TermPage.tsx` owns `?code=` and the sheet state. It holds `sheetOpen`, `sheetInitialCode`, `sheetAutoSubmit`, a one-shot ref keyed by `` `${groupId}:${rawCode}` `` (so a second code link in the same mount still runs), and the `onJoin` wrapper. It reads `code` via `useSearchParams` only once `/access` is ready and not stale (`isStale` false), then:
  - `view` → strip the parameter at once.
  - `loginRequired` → keep it, and pass `hasCodeParam`.
  - `canEnterCode`, ref key not yet consumed → mark it consumed, then:
    - malformed (`parseJoinCode` not a string) → strip at once and open the sheet empty (`initialCode=""`, `autoSubmit=false`);
    - valid → open the sheet with the normalized code and `autoSubmit=true`, and strip when the `onJoin` promise settles (success or failure), whether or not the sheet is still mounted.
  - Stripping removes only `code` and keeps the other search params, with `replace: true` (precedent `PublicOrganizationPage.tsx:74,100`). The parameter is never re-applied after the strip.
  - `onJoin(code)` awaits `joinWithCode(code)` and, on success, closes the sheet and shows the `Dołączono do grupy` toast (local `useToast` + `role="status"` pill rendered by TermPage, because the gate unmounts once `/access` reports a member). On failure it rethrows for the sheet to show.
  - Focus: an auto-opened sheet has no opener, so on close focus falls back to `main[tabindex=-1]` (`ModalSheet.tsx:37-41`).

### Frontend: organizer
- **R25** New `components/panel/JoinCodeCard.tsx`, presentational (no data hooks):
  - Props: `group`, `code: string | null`, `status: "loading" | "ready" | "denied" | "error"`, `onRetry(): Promise<void>`, `regenerate(): Promise<void>`, `termId: string | null`.
  - States:
    - `denied` (403) → renders nothing.
    - `loading` → a card skeleton of the same height as the loaded card (title plus a placeholder bar, `aria-busy="true"`), so no layout shift.
    - `error` (5xx, network, 409, 404) → the card shell with the inline text `Nie udało się wczytać kodu dostępu.` (`role="alert"`) and a `Spróbuj ponownie` button that calls `onRetry`.
    - `ready` → the full card.
    - PUBLIC groups: the host disables the hook and does not render the card.
  - Title `Kod dostępu`, subtitle `Podaj go osobom, które mają dołączyć do grupy.` The code renders as `formatJoinCode` in monospace, with the full value in sr-only text.
  - Buttons:
    - `Kopiuj kod` copies the raw 6 digits (`482913`).
    - `Kopiuj link z kodem`, only when `termId` is non-null. The link is `window.location.origin + termPublicPath(group, termId) + "?code=" + code`, never built from `location.href`.
    - `Wygeneruj nowy kod`, which opens the confirm (R26).
  - Owns `useToast` and a `role="status"` pill. Toasts: `Skopiowano kod`, `Skopiowano link`, `Wygenerowano nowy kod`, `Nie udało się skopiować kodu`.
- **R26** (see Post-verification amendments) `ConfirmDeleteDialog` gains two optional props, with the current defaults so existing callers are unchanged:
  - `tone: "danger" | "primary"` (default `danger`)
  - `busyLabel` (default `Usuwanie…`)

  The regenerate confirm uses `tone="primary"`, `busyLabel="Generowanie…"`, `fallbackError="Nie udało się wygenerować kodu — spróbuj ponownie"`, title `Wygenerować nowy kod?`, body `Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie.`, and buttons `Anuluj` / `Wygeneruj nowy kod`. Its `onConfirm` awaits `regenerate()`; when that resolves, `JoinCodeCard` unmounts the dialog and shows `Wygenerowano nowy kod`. On rejection the dialog stays open and shows the rethrown message (R18).
- **R27** `GroupDetailsPage.tsx`:
  - The label at l.11 becomes `Prywatna (dostęp z kodem)`.
  - Calls `useJoinCode(group.id, {enabled: group.visibility === "PRIVATE"})` and `useGroupTerms(group.id, {enabled: joinCode.status === "ready"})`, so neither plain members (403) nor PUBLIC groups fetch terms.
  - Derives `termId` as the nearest term from the start of today, or `null` (also while terms are loading or failed).
  - Renders `JoinCodeCard` under the details card for PRIVATE groups, passing `code`, `status`, `onRetry=refetch`, `regenerate` and `termId`. With `termId` null, the card shows only `Kopiuj kod` (plus regenerate).
- **R28** `CreateGroupStepper.tsx` done screen (PRIVATE):
  - Text: `Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu.`
  - The stepper calls `useJoinCode(createdGroupId, {enabled: done screen shown && PRIVATE})` and passes `code`, `status`, `onRetry`, `regenerate` and `termId={createdTermId}` to `JoinCodeCard`. No `useGroupTerms` here.
  - PUBLIC groups show no card and fetch nothing.
  - The panel `ModalSheet` is unchanged.
- **R29** `GroupFormFields.tsx:74` option text becomes `Prywatna — (dostęp z kodem)`.

### Frontend: removal
- **R30** Delete `hooks/usePendingJoinRequests.ts` and `components/krag/RequestAccessDialog.tsx`.
  - `components/pending/pendingActions.ts`: `derivePendingActions` goes back to one parameter with `n:` keys only.
  - `PendingActionsHost.tsx`: remove every join-request block, including `joinRequestId`/`joinRequestBusy` (l.54-59) and `JoinRequestActionSheet` (l.306-377).
  - `snoozeStore.ts` l.3-4: prose only.
  - Update the prose in `TermPage.tsx:9-11` and `AuthGateSheet.tsx:15` where it mentions requests.

  Test sites:
  - `TermPage.test.tsx`: rewrite the private-gate describe l.569-731, including rewriting (not deleting) the token-change retry test at l.710. Also update l.11, 21-22, 123, 516-540 and 788.
  - `termAccess.test.ts`: l.25, 37-50.
  - `PendingActionsHost.test.tsx`: l.19, 28-32 and 133; delete the `[PENDING_JOIN_REQUESTS_KEY]` assertion at l.399; the invalidation count at l.400 goes from `[2]` to `[1]`; delete the describe at l.544-733.
  - `PublicLayout.test.tsx`: remove the groups mock (l.20-24, 52) and delete the whole "no join-request fetch" test at l.139-147 (named at l.142).
  - `CreateGroupStepper.test.tsx`: update the `PRIVATE_DONE` copy (l.73-74, 254-278) and add a `getJoinCode` mock.
  - `GroupDetailsPage.test.tsx`:
    - Extend the `../api/groups` factory at l.10 with `getJoinCode` and `regenerateJoinCode`. The default in `beforeEach` is `mockRejectedValue(new ApiError(403, …))`, so the existing tests on the PRIVATE fixture (l.23) render no card. The new card tests override it with a resolved code.
    - Add `vi.mock("../api/terms", () => ({ getTerms: vi.fn() }))`.
    - Update the l.77 assertion from `Prywatna (dostęp na prośbę)` to `Prywatna (dostęp z kodem)`.
  - `ModalSheet.test.tsx`: replace the `RequestAccessDialog` import at l.5 with `JoinByCodeSheet`, drop the `createJoinRequest` entry from the `vi.mock` at l.10, and swap the component in l.158-194. It is a 1:1 swap, so the registry count at l.191 stays `3`.
  - `themeTokenUsage.test.tsx`: delete l.6, l.8-10 and l.146-160. Replace l.81 with `components/krag/JoinByCodeSheet.tsx` in `NO_LEGACY_UTILITY_FILES` (defined at l.74-97). Retarget the `RequestAccessDialog` "no dead `kg-modal-overlay`" describe to render `JoinByCodeSheet`. Do NOT add `JoinCodeCard` to `NO_LEGACY_UTILITY_FILES`, because it uses the panel mint palette.
  - `themeDefects.test.tsx`: in `IN_SCOPE_FILES` (l.83-127), replace `components/krag/RequestAccessDialog.tsx` at l.91 with `components/krag/JoinByCodeSheet.tsx`. This file has no `NO_LEGACY_UTILITY_FILES`.

### Cross-cutting
- **R31** Removal gate: this command returns nothing.

  `rg -i "join.?request|GROUP_JOIN_|RequestAccessDialog|PENDING_JOIN_REQUESTS_KEY|join-requests|request_?access" src/ -g '!src/backend/alembic/versions/**' -g '!src/backend/tests/test_group_join_code_migrations.py'` (the migration test hard-codes the dropped names on purpose)

  Case-insensitive, so it also catches `joinRequestId`, `joinRequestBusy`, `join-requests` URL strings and `_request_access`. Alembic history (0037-0042 and the 0060 drop/downgrade) is excluded.
- **R32** Prose outside `src/` (restored from the HLD inventory):
  - `.maister/tasks/development/2026-10-19-simple-group-creation-and-locations/documentation/user-guide.md:214`: "Po zalogowaniu może poprosić o dołączenie." becomes "Po zalogowaniu może dołączyć, wpisując kod dostępu od organizatora."
  - DEV22 (`.maister/tasks/development/2026-09-22-private-group-join-requests/orchestrator-state.yml`): set its status to superseded, with a note pointing to this task.

## Visual Design
The mockups in `analysis/design-context/` are binding inputs: layout, copy, field order and states. The implementation-planner will attach `Visual References` to UI task groups. All mockups are high fidelity and reuse the real tokens from `index.css`, the krag kit (`KragStage`, `GroupHeader`, `kragStyles` `CARD`/`BTN_PRIMARY`/`BTN_GHOST`/`FIELD`/`ERROR_TEXT`) and the panel classes (see `analysis/design-context/design-resources.md`).

Two exceptions to the mockups:
- The mockup's "Załóż konto" label was an approximation. The unchanged `AuthGateLinks` copy, "Zaloguj się" plus "Nie masz konta? Zarejestruj się" (`AuthGateSheet.tsx:22-43`), wins.
- The mockups show only loaded card states. The JoinCodeCard skeleton and error states come from R25.

| ID | Mockup | Components | Key elements |
|---|---|---|---|
| `screen:private-gate-logged-in` | `mockups/brama-grupy-prywatnej-zalogowany.html` | `PrivateGroupGate` (`canEnterCode`) | Unchanged shell, lock heading, logged-in body copy, `BTN_PRIMARY BTN_SM` "Mam kod dostępu". Focus returns to that button when a sheet it opened closes; an auto-opened sheet falls back to `main` (R22, R24) |
| `screen:private-gate-anonymous` | `mockups/brama-grupy-prywatnej-anonim.html` | `PrivateGroupGate` (`loginRequired`), `AuthGateLinks` | Two variants: default copy, and the `?code=` copy "Masz kod? Zaloguj się, żeby go użyć."; the existing `AuthGateLinks` ("Zaloguj się" / "Nie masz konta? Zarejestruj się") unchanged (R22, R24) |
| `screen:join-by-code-sheet` | `mockups/wpisz-kod-dost-pu-joinbycodesheet.html` | `JoinByCodeSheet` on krag `ModalSheet` | States: empty, invalid (local), busy, 409, 429, other error. Field → hint → alert → Anuluj/Dołącz order. The spaced value "482 913" in the input is valid (R23) |
| `component:join-by-code-sheet` | same | `JoinByCodeSheet` | One numeric field in a `<form noValidate>`, hint, inline `role=alert`, Anuluj/Dołącz (R23) |
| `screen:group-details-join-code-card` | `mockups/szczeg-y-grupy-z-kart-kodu-organizator.html` | `GroupDetailsPage`, `JoinCodeCard`, local toast | Card below the details card. Two variants: with an upcoming term (both copy buttons) and without (only "Kopiuj kod"). Toast pill. Visibility label "Prywatna (dostęp z kodem)" (R25, R27) |
| `component:join-code-card` | same | `JoinCodeCard` | Title, subtitle, monospace "482 913" with sr-only full value, Kopiuj kod / Kopiuj link z kodem / Wygeneruj nowy kod; plus skeleton and error states not in the mockup (R25) |
| `screen:regenerate-confirm` | `mockups/potwierdzenie-wygeneruj-nowy-kod.html` | `ConfirmDeleteDialog` `tone="primary"`, `busyLabel="Generowanie…"` | z-70 alertdialog over the page or the stepper sheet; title, body, Anuluj / Wygeneruj nowy kod (R26) |
| `screen:stepper-done-private` | `mockups/kreator-ekran-ko-cowy-grupa-prywatna.html` | `CreateGroupStepper` done, `JoinCodeCard` (`termId=createdTermId`) | New PRIVATE copy, card with both copy buttons, the existing "Przejdź do publicznej strony" / "Gotowe" / public-profile CTA kept; no card for PUBLIC (R28) |

## Reusable Components

### Existing Code to Leverage
| What | Where | Use |
|---|---|---|
| `_get_caller_party_id`, `_get_private_group` | `src/backend/app/groups/application/join_requests.py:52-75` | Port into `join_code.py`: 401 and 404 steps (return only `party_id: uuid.UUID`) |
| `get_group`, `_is_active_organizer`, `_require_active_organizer` | `src/backend/app/groups/application/circles.py:167, 356, 364` | 404 incl. soft-deleted; organizer check (403); post-rollback re-read |
| `add_active_membership`, `_is_active_member` | `src/backend/app/groups/application/memberships.py:28, 59` | Grant membership (flush only, caller commits); in-request re-check |
| `get_profile_by_principal` | `src/backend/app/users/service.py:97` | Caller profile → party id |
| `AuthenticationRequiredException`, `require_any` | `app/core/auth_deps`, `app/core/_auth/dependencies.py:21-39` | 401 and the route dependency |
| `_envelope`, `BusinessConflictException`, `EntityNotFoundException`, `AccessDeniedException`, `StaleDataError` handler | `src/backend/app/core/errors.py` | Error envelope (extended with headers); 409/404/403; regenerate race and the lazy GET's second failure |
| In-process store pattern | `src/backend/app/oauth2/stores.py` | Module singleton + lazy pruning precedent for the limiter |
| Notification delete-by-kind precedent | `src/backend/alembic/versions/0042_*.py:48-51` | 0060 data step |
| Migration test precedent | `tests/test_locations_migration.py`, `tests/test_group_soft_delete_migration.py` | downgrade → upgrade head tests |
| Test helpers | `tests/test_group_join_requests_router.py:24-58` | `_register`, `_create_circle_and_term(private=True)` — copy out before deleting (with the clock and UUID fixes) |
| `StaleDataError` test technique | `tests/test_group_join_requests_decisions.py:312-350` | Restated in the Testing Approach; the file itself is deleted |
| Krag `ModalSheet` | `src/frontend/src/components/krag/ModalSheet.tsx` | Esc, trapFocus, focus return, `useRegisterOpenSheet` for the visitor sheet |
| `ConfirmDeleteDialog` | `src/frontend/src/components/shared/ConfirmDeleteDialog.tsx` | Regenerate confirm (z-70, trap, Esc, busy, inline error via `err.message` / `fallbackError`) |
| `CapacityField` / `parseCapacity` | `src/frontend/src/pages/panel/panelComponents.tsx:174-208`, `panelHelpers.ts:117-123` | Template for the numeric input and `parseJoinCode` |
| `ShareButton` clipboard + pill | `src/frontend/src/pages/organizer/blocks/ShareButton.tsx` | Clipboard try/catch + `role=status` pill markup |
| `useToast` | `src/frontend/src/pages/krag/hooks/useToast.ts` | Card-local and TermPage toast state |
| `termPublicPath` | `src/frontend/src/pages/panel/panelHelpers.ts:158` | Build the share link path |
| `getTerms` | `src/frontend/src/api/terms.ts:66` | Source for `useGroupTerms` |
| `useCategories` write pattern | `src/frontend/src/hooks/useCategories.ts:40-60` | `useCallback` + api + `await invalidateQueries` + `new Error(serverMessageOr(...))` rethrow |
| `useTermAccess` | `src/frontend/src/hooks/useTermAccess.ts` | Host for `joinWithCode`; `["groupAccess", groupId, …]` key; `isStale` gate for `?code=` |
| `serverMessageOr`, `extractProblemMessage` | `src/frontend/src/api/problem.ts:67-79` | Server message passthrough (extended with 429) |
| `setSearchParams(…, {replace})` precedent | `src/frontend/src/pages/organizer/PublicOrganizationPage.tsx:74,100` | Strip `?code=` |
| "Upcoming from the start of today" convention | `src/frontend/src/pages/panel/views/HomeView.tsx:60-66` | Nearest-term rule in GroupDetailsPage |
| `PrivateGroupGate` shell, `AuthGateLinks` | `src/frontend/src/pages/krag/PrivateGroupGate.tsx`, `components/krag/AuthGateSheet.tsx:22-43` | Kept; only the body branches and props change |

### New Components Required
| New | Why existing code can't be reused |
|---|---|
| `app/groups/application/join_code.py` | No code lifecycle exists; it replaces `join_requests.py`, whose request/approve logic goes away |
| `app/groups/application/join_code_limiter.py` | There is no rate limiting anywhere in the app; `oauth2/stores.py` is a token store, not a failure counter |
| `app/groups/router/join_code.py` | Three new routes; the old router is deleted |
| `TooManyAttemptsException` + 429 handler | No error currently sets headers or uses 429 |
| Alembic 0059, 0060 | Schema change and removal |
| `utils/joinCode.ts` | `parseCapacity` returns a number with range rules; the code must stay a zero-padded string, and it is shared by the visitor and organizer sides (so not in `panelHelpers.ts`) |
| `hooks/useJoinCode.ts`, `hooks/useGroupTerms.ts` | `data-fetching.md` forbids ad hoc `useQuery` in components; `useOrganizerTerms` needs `organizer_slug` and is paginated |
| `components/krag/JoinByCodeSheet.tsx` | `RequestAccessDialog` is deleted and had a different (message) form |
| `components/panel/JoinCodeCard.tsx` | No organizer surface for the code exists; one presentational card serves two hosts |

## Technical Approach
- **Layering:** router → application use case → repository, inside the groups BC. The use cases take `(db, principal, group_id, …)` and are re-exported from `service.py`. Membership creation goes only through `add_active_membership`, so `/access` (`get_group_access`, `public_view.py:354-420`) and the RSVP PRIVATE guard (`create_rsvp`) work without logic changes.
- **Lazy write:** the GET assigns the code and commits, which bumps `updated_at`, the `version_id_col`. That bump is acceptable. A `StaleDataError` is caught only in the GET, and only once: rollback, re-read via `get_group` (which re-SELECTs; `expire_on_commit=False` in `app/db.py:13`), then re-decide (PUBLIC → 409, code → return, null → one more generate-and-commit, whose failure goes to the global 409 handler). Regenerate lets the global 409 handler respond directly.
- **Limiter flow in redeem:** `check` runs after 404 and before reading or comparing the code. Both 409 paths (null code and mismatch) call `record_failure`. Both 200 paths call `clear` (user key only). Concurrent requests may overshoot a budget by the number of in-flight requests; this is accepted, and the R4 wait formula still reports the true wait. The submitted code is never logged.
- **Matrix:** the redeem row must come before row 27, or the blanket `POST ^/api/groups(/.*)?$` EDIT row would match first (asserted by the R14 regression test). `GET …/join-code` and `POST …/regenerate` fall through to rows 26 and 27 and collide with none of the PATCH/DELETE, moderation or restore rows.
- **Frontend data:**
  - One subscriber per query: host pages call `useJoinCode`/`useGroupTerms` and hand the results to the presentational `JoinCodeCard`.
  - `useJoinCode` is enabled for PRIVATE groups only. The shared `queryClient` does not retry 4xx, so a member's 403 costs exactly one request. 5xx and network errors are retried twice before `status: "error"`.
  - `useGroupTerms` is enabled only when `status === "ready"`, so neither plain members nor PUBLIC groups trigger a terms fetch.
  - Writes invalidate their resource prefix (`JOIN_CODE_KEY` and `["groupAccess", groupId]`) with `await`, and rethrow `new Error(serverMessageOr(err, fallback))`.
  - Retry-After is invisible to the client (`ApiError` carries no headers), so the 429 minutes come only from the server message.
- **`?code=` lifecycle (TermPage-owned, R24):**
  1. The code is kept through login via `returnTo` = pathname + search.
  2. It is evaluated only once `/access` is ready and not stale. After a token change, `isStale` holds back the auto-submit until the refetch settles (`useTermAccess.ts:72`, `TermPage.tsx:37`).
  3. A ref keyed by `groupId:code` makes it one-shot per link.
  4. It is stripped (only `code`, `replace: true`) at once for `view` or a malformed code, or when the auto-submit's `onJoin` promise settles.
- **Migration safety:** 0060 deletes the notification rows before dropping the column, because `NotificationKind` is string-backed and the rows would otherwise fail to load. The downgrade rebuilds the post-0041 UUID table shape (R12 types, `gen_random_uuid()` PK, `pk_`/`fk_`/`ix_`/`uq_` names, partial unique index on PENDING, no sequence) and re-adds `join_request_id UUID NULL`, in the reverse of the upgrade order, as `migrations.md` requires.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and changed tests, not the entire suite, until the final full run.
- **Backend** (`backend-testing.md`: real PostgreSQL via testcontainers, `client`/`db_session`, exact key sets, `test_<operation>_<scenario>_<expected>`):
  - `tests/test_group_join_code.py`, about 8 tests:
    - lazy create, then the same code on a second GET
    - member 403 / unknown 404 / PUBLIC 409
    - redeem → `/access` `can_view_content` → RSVP 201
    - wrong code and no-code-yet give the same 409 message; PUBLIC/soft-deleted 404; anonymous 401
    - member or organizer redeem → `{created:false}` with the membership count unchanged, and that user's limiter key cleared
    - regenerate invalidates the old code
    - after 10 failures the 11th attempt gives 429 with an integer `Retry-After`, and the correct code is still 429
    - `join_code` is absent from `GET /api/groups/{id}`, `GET /api/groups/public/{id}` and `/access` (exact key sets)
    - lazy-GET `StaleDataError`, two variants: the concurrent write set a code → that code is returned; the concurrent write did not set a code → the retry generates one and returns 200
  - **StaleDataError technique** (from the deleted `test_group_join_requests_decisions.py:312-350`): monkeypatch the group getter by the exact name `join_code.py` resolves it through (e.g. `repository.get_group` if `get_group` calls through the module). The patched getter returns the group, then runs a behind-the-ORM `UPDATE groups SET updated_at = updated_at + interval '1 second'` (plus `join_code = '123456'` in the first variant) and commits. Call `db_session.rollback()` before the final assertions.
  - `tests/test_join_code_limiter.py`, 5 pure unit tests with a fake clock: user key blocks at 10 (the 11th `check`) and the window slides; group key at 30 across parties; `clear` affects the user key only; `retry_after_seconds` is the longest wait, rounded up, at least 1, and uses `ts[len - limit]` under overshoot; pruning deletes empty keys.
  - `tests/test_group_join_code_migrations.py`, 2 tests: downgrade 0058 → head; downgrade 0059 → head (table, UUID types and column round-trip).
  - Updates in `test_authorization_matrix.py` (including the row-27 regression), `test_group_access.py`, `test_group_soft_delete_reads.py` and `test_private_group_access_defects.py`, per R14.
- **Frontend** (`frontend-testing.md`: explicit vitest imports, `createQueryWrapper`, `vi.mock` API modules, clipboard stub via `Object.assign(navigator, {clipboard})`, pinned Date for the nearest-term logic):
  - `TermPage.test.tsx`, about 8 tests:
    - "Mam kod dostępu" is shown and "Poproś o dostęp" is not.
    - Sheet Tab trap, Esc and focus return.
    - Invalid input → disabled submit + alert.
    - A pasted "482 913" + Enter → one redeem with `482913`.
    - 409 → inline error, sheet open.
    - 200 → content + toast.
    - `?code=` → exactly one redeem and only `code` removed from the URL; a malformed `?code=` → no redeem, the param removed and the sheet empty.
    - Anonymous `?code=` → `returnTo` keeps the code.
    - **Token change (M8):** render with `token:null` and `?code=482913` (gate `loginRequired`). Rerender with a token while the next `getGroupAccess` is a pending promise → no `redeemJoinCode` call. Resolve it to `canEnterCode` → exactly one redeem and the param removed. Drive it with `mockAuth` + `rerender`, as the l.710 test does.
    - Plus the rewritten l.710 test.
  - `GroupDetailsPage.test.tsx`, about 5 new tests: card shown for a PRIVATE organizer; hidden on 403; skeleton while loading and the error + "Spróbuj ponownie" retry; copy → clipboard receives `482913` + toast; regenerate requires confirmation, then shows the new code (and a failed regenerate shows the server message, not `409 Conflict`). Plus the no-upcoming-term variant and the R30 mock/label updates to existing tests.
  - `CreateGroupStepper.test.tsx`: the PRIVATE done screen shows the code and both copy buttons; PUBLIC shows none.
  - `termAccess.test.ts`, `parseJoinCode`/`formatJoinCode`, `serverMessageOr` test (429 row), `useTermAccess` / `useJoinCode` hook tests (`status` mapping, regenerate rethrow), `ConfirmDeleteDialog` default vs `tone`/`busyLabel`, and the list/count updates in R30.

### Standards Compliance
- `backend/models.md`: the nullable column on `Group`; string-backed enums (kinds removed in code and data together); the code stays out of general DTOs.
- `backend/migrations.md`: two focused revisions (additive column separate from the destructive drop); reversible downgrades in reverse dependency order with explicit post-0041 UUID types; explicit constraint names; one downgrade→upgrade test per migration; separate schema and data steps (the 0060 DELETE is the documented exception, following the 0042 precedent).
- `backend/security.md`: `Depends(require_any())` + an `AUTHORIZATION_MATRIX` row placed for first-match order and verified by `test_authorization_matrix.py`, including the regression case; ownership checks in the service layer.
- `backend/time.md`: the limiter uses `time.monotonic` (allowed); membership `valid_from` comes from `clock.local_now()` inside the existing `add_active_membership`; copied test helpers use `clock.local_now()`; no `datetime.now()` in `app/groups/application` or `app/groups/router` (`test_domain_clock_guard.py`).
- `global/error-handling.md`: typed `TooManyAttemptsException` with the message built by its owner, centralized handler, Polish user messages; no raw status text reaches the UI.
- `global/validation.md`: server-side `^[0-9]{6}$`; client input as `type="text" inputMode="numeric" pattern="[0-9]*"`, raw string state, one shared parser returning `null`/value/`undefined`, inline Polish `role="alert"` with `aria-invalid`/`aria-describedby`, and submit disabled while the input is invalid. `noValidate` keeps native constraint validation from overriding that inline feedback.
- `global/minimal-implementation.md`: the limiter stays in the groups BC with a single consumer; no `useMutation`, no shared toast host, no new confirm component.
- `frontend/data-fetching.md`: hooks in `src/hooks/` over `src/api/*.ts`; one subscriber per query (host-owned hooks, presentational card); array keys with prefix constants; `await invalidateQueries`; app-shaped returns; `dayjs` imported from `src/utils/dayjs.ts`.
- `frontend/accessibility.md`: the sheet uses the krag `ModalSheet` (trap, Esc, focus return with the `main` fallback, `useRegisterOpenSheet`); the confirm is the registered z-70 alertdialog; toasts are `role="status"`; the code's full value is in sr-only text with the `{" "}` spacing rule.
- `frontend/css.md`: Tailwind with role tokens; `JoinByCodeSheet` uses only krag tokens (no legacy utilities); `JoinCodeCard` follows panel styling.
- `testing/backend-testing.md`, `testing/frontend-testing.md`: as above. Commands: `uv run python -m pytest|mypy|ruff` from `src/backend` (mypy no worse than the ~32 baseline); `npm test`, `npm run lint` and `npx tsc -b` from `src/frontend`.

## Out of Scope
- Organizer list of all active members, and removal of members (accepted consequence above)
- "Joined by code" notification
- `?code=` on the panel "Kopiuj link do terminu" (`PanelDataContext.tsx:905-911`), and "copy link with code" from the public term page or `ShareButton`
- Partial unique index on active memberships
- `returnTo` same-origin validation
- nginx `limit_req`, and a DB-backed or multi-worker limiter
- `is_organizer` in `GroupResponse` (which would remove the 403 probe)
- Esc and focus trap on the panel `ModalSheet`
- Changing the `AuthGateLinks` copy
- Rotation timestamp on the card; code expiry or max uses; per-invite codes; e-mail invites; SSO; changes to PUBLIC groups
- Privacy gaps outside `/access` (`/api/terms`, pledges, needed items, membership list)
- Backfilling codes; a pre-deploy count of PENDING requests; edits to applied migrations 0037/0038/0041

## Success Criteria
1. A logged-in non-member holding a valid code reaches the term content and a successful RSVP with one code submission and no organizer action. This includes the anonymous `#code=` → login → auto-submit path, verified by a manual two-account check.
2. No API response other than the two organizer endpoints contains `join_code`, as shown by the exact key-set tests.
3. Guessing is bounded: at most 30 failed redemptions per group per rolling hour, and at most 10 per (user, group) per 15 minutes. A correct code submitted while locked out returns 429 with an integer `Retry-After`.
4. A wrong code and "no code yet" are indistinguishable: same status, same message.
5. The R31 command, `rg -i "join.?request|GROUP_JOIN_|RequestAccessDialog|PENDING_JOIN_REQUESTS_KEY|join-requests|request_?access" src/ -g '!src/backend/alembic/versions/**' -g '!src/backend/tests/test_group_join_code_migrations.py'` (the migration test hard-codes the dropped names on purpose), returns nothing, and the R32 prose items are updated. Both `alembic downgrade 0058 && alembic upgrade head` and `alembic downgrade 0059 && alembic upgrade head` succeed.
6. Full suites are green:
   - `uv run python -m pytest` and `mypy` (no worse than baseline) from `src/backend`.
   - `npm test` and `npx tsc -b` from `src/frontend`.
   - `ruff` / `npm run lint`: no new lint/ruff errors; files touched by this task are clean (whole-project lint/ruff debt pre-exists).
7. The six mockup screens match in layout, copy, field order and states, except the two documented exceptions (`AuthGateLinks` copy, and card skeleton/error states). The card is absent for PUBLIC groups and for non-organizers (403). No dialog or card shows a raw HTTP status text.
8. The lazy GET never answers 500 or a null code, including after a concurrent write.

## Audit resolution
| Finding | Change made |
|---|---|
| M1 lazy-GET re-read can return null / PUBLIC | R7: rollback, re-read, re-decide (PUBLIC → 409, code → return, null → one more generate; a second failure → global 409); never `None`/500. Two-variant test; SC8. |
| M2 `?code=`/sheet ownership | R22 gate prop contract; R23 sheet props and auto-submit; R24 TermPage owns `?code=`, sheet state, the ref keyed by `groupId:code`, malformed → strip and open empty, strip on settle, only `code` removed, `main` focus fallback. |
| M3 `pattern` vs spaced input | R23 `<form noValidate>`, Enter submits, spaced/hyphenated paste accepted; R25 "Kopiuj kod" copies raw `482913`; display stays `formatJoinCode`. |
| M4 hook ownership | R18 one subscriber; R25 presentational card props; R27/R28 host-owned `useJoinCode` (+ `useGroupTerms` on GroupDetailsPage). |
| M5 card loading/error states | R25: 403 → nothing, loading → skeleton, other errors → inline error + "Spróbuj ponownie", PUBLIC → hook disabled and no card. |
| M6 theme test lists | R30: `NO_LEGACY_UTILITY_FILES` edits moved to `themeTokenUsage.test.tsx` (l.81 → `JoinByCodeSheet`, describe retargeted); `themeDefects.test.tsx:91` swapped in `IN_SCOPE_FILES`. |
| M7 GroupDetailsPage existing tests | R30: l.10 factory extended (403 default), `../api/terms` mocked, l.77 label updated. |
| M8 token-change test | Testing Approach: TermPage token-change test with a pending `getGroupAccess`. |
| M9 regenerate error text | R18 rethrow `new Error(serverMessageOr(err, …))`; R26 `fallbackError` and close/toast on success. |
| L1 `_get_caller_party_id` type | R6: return only `party_id: uuid.UUID`. |
| L2 limiter numerics | R4: `>=` threshold, `ts[len - limit]` wait, `max(1, ceil)` header, `ceil(s/60)` minutes, empty keys deleted, synchronous; test renamed to "11th attempt". |
| L3 exception signature | R3: `TooManyAttemptsException(message, retry_after_seconds)`, subclasses `Exception`, message built in the groups limiter; naming deviation noted in Open Questions. |
| L4 0060 downgrade types | R12 lists the post-0041 UUID types, the reverse order and "no sequence". |
| L5 StaleDataError technique | Testing Approach restates the technique, including the M1 variant. |
| L6 copied helpers | R13: `clock.local_now()` and `uuid.UUID` annotation. |
| L7 matrix comment + regression | R10 edits (not removes) the l.94 comment; R14 moves the l.124/125 cases and adds the row-27 regression test. |
| L8 backend test sites | R14: `test_group_access.py` l.2/68/86/107/91/112/123; soft-delete redeem sends `{"code": "123456"}`; B14 prose rewritten. |
| L9 frontend test sites | R30: `ModalSheet.test.tsx` l.5/l.10 and count stays 3; `PendingActionsHost.test.tsx:399`; `PublicLayout.test.tsx:142` test deleted. |
| L10 `AuthGateLinks` vs mockup | Visual Design: the existing copy wins; "Załóż konto" was an approximation. |
| L11 sheet details | R23 empty/invalid/busy/server-error states with `aria-invalid`, Enter submits; R20 fallback string and `serverMessageOr` scope. |
| L12 removal gate | R31 case-insensitive regex with the added identifiers; SC5 aligned; R32 restores the user-guide l.214 and DEV22 prose items. |
| User decision 5 | R9 step 5 clears the user key on `{created:false}`; the group key is never cleared. |

## Post-verification amendments (2026-10-21)

- **Fragment, not query (R24, R26, ADR-005; production-readiness B1).** The shared link is `…/term/<id>#code=NNNNNN`. "Kopiuj link z kodem" builds it, and `TermPage` reads `location.hash`. Browsers never send the fragment, so the code stays out of nginx and uvicorn access logs. Read every `?code=` above as `#code=`.
- **Login keeps the code in sessionStorage, not in `returnTo`.** `returnTo` stays `pathname + search`, because a fragment inside the login URL's query would reach the server. While the gate is `loginRequired`, `TermPage` writes the code to `sessionStorage["pendingJoinCode:{groupId}"]` and keeps the hash. After login or onboarding the visitor comes back without the hash, and `TermPage` reads the code from storage. LoginPage, OnboardingPage, AuthGuard and the 401 redirect are unchanged.
  - The entry is `{code, savedAt}` and is ignored after 1h, so an abandoned link does not join a later login.
  - `onJoin` writes the code before calling `joinWithCode` and removes it on success or on any error other than a 401 (409, 429, …). On a 401 it stays, so it survives the `api/client` login redirect regardless of ordering. While the sheet holds a valid code, the settle step leaves storage to `onJoin`.
  - Guard (`redeemStarted`, formerly `signedOut`): once a redeem starts, `TermPage` stops reading storage, so its own pre-written entry never reopens or re-submits the sheet.
  - By design (G5): a kept code is redeemed by whichever account logs in next in that tab within the hour. A profile-less account (backend 401) gets it re-sent after each manual login (I18, accepted).
  - `JoinByCodeSheet` is keyed on `initialCode` (G2), so a new `#code=` arriving while the sheet is open remounts it with that code and auto-submits once.
- **Immediate strip (replaces the one-shot ref and strip-on-settle).** Nothing happens while access is unsettled or stale. Once it settles:
  - `view` clears the hash and storage.
  - `canEnterCode` clears the hash (`navigate(pathname + search, {replace: true})`) at once, and storage too unless the code is valid (then `onJoin` clears it, see above). It opens the sheet with the code and `autoSubmit`, or opens it empty when the code is malformed.
- **`useJoinCode` (R18).** A disabled query reports `status: "idle"`, and `JoinCodeCard` renders nothing for it. The `error` field is removed. `regenerate` writes the returned code with `setQueryData([JOIN_CODE_KEY, groupId], res)`, so no follow-up GET runs.
- **Gate props (R22).** `PrivateGroupGate` takes one `codeSheet: {initialCode, autoSubmit} | null` and `hasPendingCode`, replacing `sheetOpen`/`initialCode`/`autoSubmit`/`hasCodeParam`. Its own focus-return effect is removed, because `ModalSheet` already returns focus to "Mam kod dostępu".
- **Sheet validation (R23).** "Kod ma 6 cyfr", `aria-invalid` and the danger border appear only after blur or a submit attempt. Non-digit or too-long input shows them at once.
