# Decision Log — Join a PRIVATE group by access code

## TL;DR
Eight ADRs, all **Accepted**, one per decision area converged by the user in Phase 4.
The most consequential: ADR-001 (6 digits, a user correction from the researched 9, made safe only by a per-group failure budget, with a deliberately accepted 1-hour DoS window), ADR-003 (in-process limiter that assumes one uvicorn process) and ADR-006 (complete removal of the join-request mechanism, including dropping its table, because the app is not in production).
The other ADRs keep the existing access resolver and RSVP path untouched and add a single new public endpoint.

## Key Decisions
- ADR-001: 6-digit code + dual-key limiter (10/15 min per user+group, 30/1 h per group) — matches the user's reference; the per-group key bounds guessing independently of the number of accounts.
- ADR-003: in-process sliding-window limiter + typed 429 — single process verified, zero dependencies, no optimistic-lock collisions.
- ADR-006: delete everything related to join requests in one change (revision 0060) — not in production, so no data to preserve.

## Open Questions / Risks
- ADR-001 residual risk: a sustained attacker succeeds with ≈26 % probability per year against one group (30 guesses/h × 8 760 h of 10^6 values); expected ≈1.9 years. Accepted.
- ADR-001/003 accepted DoS: exhausting a group's budget blocks legitimate visitors for up to 1 h; regeneration does not lift it.
- ADR-003 assumes one uvicorn process; adding workers or instances invalidates the guarantee and must trigger a DB-backed limiter.

---

<a id="adr-001"></a>
## ADR-001: 6-digit numeric code protected by a dual-key failure limiter

### Status
Accepted

### Context
The user wants the organizer to share a short code, modelled on another app they use. Research and exploration assumed that reference was a **9-digit** code (29.9 bits) and recommended 9 digits + a per-user limiter (alternative 1A) with Crockford-8 as fallback. In Phase 4 the user **corrected the reference to 6 digits** (10^6 values, ≈19.9 bits). At 6 digits a per-user limiter alone is insufficient: multiple accounts multiply the guessing rate, and NIST SP 800-63B requires throttling for any secret below 64 bits.

### Decision Drivers
- Match the user's reference product (6 digits, numeric keypad, read-aloud friendly `123 456`).
- Bound the guessing rate per group regardless of how many accounts an attacker controls.
- Reuse the existing numeric input contract (`validation.md`: `type="text" inputMode="numeric" pattern="[0-9]*"`).
- No new dependencies.

### Considered Options
1. 9 digits + per-(user, group) limiter (exploration 1A).
2. 8-char Crockford Base32, limiter optional (1B).
3. 10–12 digits, no limiter (1C).
4. Link-only opaque token (1D).
5. **6 digits + per-(user, group) 10 failures/15 min + per-group 30 failures/1 h ("6B").**

### Decision Outcome
Chosen option: 5, because it is the format the user actually expects and the per-group budget makes the expected brute-force time ≈ 5·10^5 / 30 per h ≈ 16 700 h ≈ **1.9 years**, independent of the number of attacker accounts. Generation: `"".join(secrets.choice("0123456789") for _ in range(6))`; verification: `secrets.compare_digest`; request validation `^[0-9]{6}$`; display `123 456`. The limiter is checked **before** comparing the code and every failure is recorded on **both** keys; success clears only the per-(user, group) key.

### Consequences

#### Good
- Familiar UX (numeric keypad, `autoComplete="one-time-code"`, no O/0 or I/1 confusion).
- Security does not degrade with more attacker accounts.
- One shared parser and input pattern on both visitor and organizer sides.

#### Bad
- **Accepted DoS (user-acknowledged):** anyone with an account can deliberately burn a group's 30-failure budget and lock out legitimate visitors, including ones with the correct code, for up to 1 h; one account can do it alone in ~45 min. Regenerating the code does not lift the block.
- Residual success probability is not negligible for a determined, patient attacker (≈2.2 % per 30 days, ≈26 % per year of continuous attack). The prize is membership of a small social group, and the attack is noisy (continuous 429s).
- Security relies entirely on the limiter being correct and on the single-process deployment (ADR-003).

---

<a id="adr-002"></a>
## ADR-002: Store the code as a plaintext nullable column on `groups`

### Status
Accepted

### Context
The organizer must be able to view and copy the code at any time (group page, stepper). A group has exactly one code; rotation replaces it. Codes are verified per group id, never looked up by value.

### Decision Drivers
- Organizer can re-read and copy the code (product requirement).
- `models.md`: prefer plain columns; don't over-index.
- Minimal implementation: no history, expiry or per-invite features were requested.

### Considered Options
1. **Plaintext nullable `groups.join_code` String(6), no index, no uniqueness (2A).**
2. Separate `group_join_codes` table with expiry/max-uses/revocation (2B).
3. sha256 hash with show-once semantics (2C).
4. HMAC-derived code, nothing stored (2D).

### Decision Outcome
Chosen option: 1, because it supports view/copy/regenerate with one additive column, and hashing a 10^6-value space gives no real protection (any hash is reversible by enumerating one million candidates). The column is never included in `GroupResponse`, `PublicCircleResponse`, `/access` or notifications; it is read only by the two organizer endpoints and by redeem (via `get_group`, which already 404s soft-deleted groups).

### Consequences

#### Good
- One additive revision (0059), no index, no backfill.
- Code shares the group's lifecycle and soft-delete semantics for free.
- PRIVATE → PUBLIC → PRIVATE keeps the code; redeem 404s for PUBLIC anyway, so no clearing branch is needed.

#### Bad
- Plaintext at rest: anyone with DB read access sees codes (they would also see all member data).
- Writing the code bumps `groups.updated_at` (optimistic-lock column), so an organizer's concurrent stale PATCH gets the existing 409 — rare and already handled.
- No audit trail of rotations.

---

<a id="adr-003"></a>
## ADR-003: In-process sliding-window limiter with a typed 429

### Status
Accepted

### Context
The application has no rate limiting, no Redis, no 429 handler. ADR-001 depends on a correct limiter. The backend runs a single uvicorn process (`docker-compose.yml:45` and `src/backend/Dockerfile:50` start uvicorn without `--workers`), and the OAuth2 stores already accept in-memory, single-instance state (`security.md`).

### Decision Drivers
- Correctness of ADR-001's two budgets.
- No new dependency, no schema for counters.
- Failures must count even though the request's DB transaction raises/rolls back.
- Testability without real waiting; `time.md` forbids wall-clock reads for domain time.

### Considered Options
1. **Module-level dict of failure timestamps, sliding window on `time.monotonic` with an injectable clock (3A).**
2. DB-backed counter table or Core `UPDATE` (3B).
3. No limiter, rely on entropy (3C) — incompatible with 6 digits.
4. nginx `limit_req` only (3D) — per-IP, cannot key on user or group.

### Decision Outcome
Chosen option: 1, because a single process makes in-memory state authoritative, it records failures independently of transaction rollback, and it avoids bumping `groups.updated_at`. Shape: a small limiter object (`check`, `record_failure`, `clear`, test-only reset) with rules `(party_id, group_id)` 10/900 s and `group_id` 30/3600 s; expired timestamps of touched keys are pruned on `check`. A new `TooManyAttemptsException(message, retry_after)` in `app/core/errors.py` maps to 429 with the standard envelope, a `Retry-After` header and a Polish message; the frontend's `serverMessageOr` passes 429 through.

### Consequences

#### Good
- ~One small module, pure-unit testable with a fake clock.
- No writes on the failure path; no lock interaction with organizer edits.
- First 429 handling in the app, reusable later.

#### Bad
- State resets on restart (an attacker gains at most one fresh budget per restart).
- Breaks silently if the app ever runs more than one worker/instance — must be replaced by a DB-backed limiter first (recorded as a follow-up).
- Small overshoot possible under concurrent requests (check and record are separated by DB awaits).
- Tests must reset the shared instance between cases.

---

<a id="adr-004"></a>
## ADR-004: Lazy generation on the organizer's first read; explicit regeneration only

### Status
Accepted

### Context
Existing PRIVATE groups have no code. PRIVATE is the default visibility for organizers without an Organization (`panelHelpers.ts:25-29`), and `test_group_privacy.py:139-162` asserts that flipping visibility has no side effects.

### Decision Drivers
- No data migration (Python `secrets` cannot run in SQL migrations cleanly).
- No new side effects in group creation/update.
- Code must simply "be there" when the organizer looks.

### Considered Options
1. **Lazy get-or-create on `GET /api/groups/{id}/join-code` + `POST …/regenerate` (4A).**
2. Eager generation on create/PRIVATE switch + backfill (4B).
3. Explicit "Wygeneruj kod" action with a "no code" state (4C).
4. Lazy + automatic periodic rotation/expiry (4D).

### Decision Outcome
Chosen option: 1, because both organizer surfaces (ADR-008) call the GET whenever they show a PRIVATE group, so "no code yet" is unreachable in practice, and it needs neither backfill nor changes to existing use cases. Order: 404 (missing/soft-deleted) → 403 (not an active organizer) → 409 (PUBLIC) → generate if null + commit. Regeneration overwrites and commits after a UI confirmation; no expiry.

### Consequences

#### Good
- Zero changes to group creation/update and their tests.
- Pre-existing PRIVATE groups get a code on first view.

#### Bad
- A GET with a write (precedent: `get_or_create_active_group_role`).
- A visitor redeeming before the organizer ever opened the card gets the generic 409 (correct, since nobody could have shared a code).
- A leaked code stays valid until the organizer acts.

---

<a id="adr-005"></a>
## ADR-005: `JoinByCodeSheet` on `ModalSheet` with `?code=` prefill and one-shot auto-submit

### Status
Accepted

> **Superseded (2026-10-21)** in part by `implementation/spec.md` "Post-verification amendments". The link carries the code in a `#code=` fragment and keeps it across login in sessionStorage (`pendingJoinCode:{groupId}`), not in `?code=` and `returnTo`.
### Context
The user's goal is a smoother sign-up for a term in a private group. The term link is the shared artefact; the route has no `AuthGuard`, and `returnTo = pathname + search` already survives login and registration, so a `?code=` parameter reaches the page after login with no new plumbing. The existing `RequestAccessDialog` has hand-rolled modal chrome; the shared `ModalSheet` provides focus trap, Esc, scrim, focus return and `useRegisterOpenSheet`.

### Decision Drivers
- Fewest steps from link to RSVP.
- Accessibility standard for blocking dialogs.
- Keep the tested gate shell; add one branch instead of rewriting.

### Considered Options
1. **Sheet opened by "Mam kod dostępu"; `?code=` prefill + one-shot guarded auto-submit, then strip (5A).**
2. Inline field in the gate card (5B).
3. Sheet with prefill only, manual "Dołącz" (5C).
4. Dedicated `/join/:groupId` route (5D).

### Decision Outcome
Chosen option: 1, because a code-carrying link becomes "tap → (login) → member → RSVP" without typing, while the typed path is two taps. `TermPage` acts on `?code=` only once `/access` is loaded and not stale: `view` → strip; `loginRequired` → keep it (it rides `returnTo`); `canEnterCode` → open the sheet prefilled and submit once (ref guard), then strip with `replace: true` whatever the outcome. The mutation lives in the host hook (`useTermAccess.joinWithCode`) and is passed to the sheet as a prop; success awaits invalidation of the `groupAccess` prefix.

### Consequences

#### Good
- Reuses `ModalSheet` accessibility guarantees; deletes hand-rolled dialog code.
- No polling (nothing is pending server-side any more).
- Members opening a code link see the content directly and the parameter is cleaned up.

#### Bad
- A bad code in a link spends one limiter attempt automatically.
- Guarded effect + strip logic add test cases.
- The code briefly appears in the URL/history before stripping (revocable secret).

---

<a id="adr-006"></a>
## ADR-006: Remove the join-request mechanism completely in one change

### Status
Accepted

### Context
"Poproś o dostęp" is a closed tree: 13 backend modules touched, 23 frontend files, 7 backend test files, migrations 0037/0038 (+0041 reshaping). Nothing outside it depends on it. The user confirmed the **app is not in production**, so PENDING rows carry no real users. `NotificationKind` is string-backed, so rows with removed kinds would fail to load.

### Decision Drivers
- No dead code or orphaned schema (`minimal-implementation.md`).
- Reversible, ordered migrations with a downgrade→upgrade test (`migrations.md`).
- Additive change before destructive change.

### Considered Options
1. **Abandon PENDING rows; delete the whole tree; 0060 removes the schema — no pre-deploy count check, no script (6A, simplified).**
2. Auto-approve script with the old image before deploy (6B).
3. Keep the table read-only for a release, drop later (6C).
4. Notify requesters once with the organizer's code (6D).

### Decision Outcome
Chosen option: 1, because there is no production data to protect. Revision **0059** (down 0058) adds `groups.join_code`; revision **0060** (down 0059) deletes `notifications` rows with `kind LIKE 'GROUP_JOIN_%'`, drops `notifications.join_request_id`, then drops `group_join_requests`. Its downgrade re-creates the table in the post-0041 UUID shape (`pk_group_join_requests`, 3× `fk_group_join_requests_*`, `ix_group_join_requests_group_id`, partial `uq_group_join_requests_pending_requester_group`) and then the column; deleted rows are not restored (documented in the docstring, precedent 0041/0048). Applied migrations 0037/0038/0041 are not edited. Code, schemas, auth-matrix row, notification kinds, frontend pieces and tests are deleted in the same change.

### Consequences

#### Good
- One coherent cutover; no compatibility shims.
- Notification enum, DTOs and frontend types shrink.

#### Bad
- Downgrade cannot restore data.
- Many test files change at once (larger review).
- If the production assumption were wrong, pending requesters would be silently dropped.

---

<a id="adr-007"></a>
## ADR-007: Redeem error order 401 → 404 → 429 → 409 → 200 idempotent

### Status
Accepted

### Context
The visitor must not learn whether a group has a code or what state it is in. The frontend replaces any 403 with a global "Nie masz uprawnień…" message, while 409 messages pass through verbatim. Members may open code-carrying links.

### Decision Drivers
- No existence/state oracle (prior decisions A4/L9); 401 before 404/403 (L8).
- Polish server messages reach the user unchanged.
- Idempotency for members.

### Considered Options
1. **401 → 404 (unknown/deleted/PUBLIC) → 429 → 409 one generic message (wrong code or no code) → 200 `{created}` (7A).**
2. Distinct statuses: 403 wrong code, 409 already member, 404 no code (7B).
3. Always 200 with a result enum (7C).

### Decision Outcome
Chosen option: 1, because it leaks nothing, fits the existing exception/handler set (`BusinessConflictException`, `EntityNotFoundException`) plus the new 429, and keeps the frontend to one error branch. Existing members with a correct code get `200 {"created": false}` and no duplicate membership.

### Consequences

#### Good
- Same 404 surface as other PRIVATE endpoints; no oracle.
- Members' deep links never error.

#### Bad
- A member submitting a wrong code gets 409 (unreachable from the UI, which resolves `view` first).
- A locked-out caller with the correct code still gets 429 (by design of check-before-compare).

---

<a id="adr-008"></a>
## ADR-008: `JoinCodeCard` on `GroupDetailsPage` and the `CreateGroupStepper` done screen

### Status
Accepted

> **Superseded (2026-10-21)** in part by `implementation/spec.md` "Post-verification amendments". The card's link uses `#code=`, not `?code=`. The hook is `useJoinCode`, keyed `joinCode`, and returns `{code, status: idle|loading|ready|denied|error, refetch, regenerate}`.
### Context
Organizers meet a new PRIVATE group first on the stepper's done screen (PRIVATE is the default for Organization-less founders) and later on `/panel/grupy/:groupId`, which members can also open. `GroupResponse` has no `is_organizer` flag, and the code must not be added to it.

### Decision Drivers
- Code available at first contact and on return.
- Keep the secret out of general DTOs.
- Follow `data-fetching.md` hook conventions.

### Considered Options
1. **Card on group page + stepper; visibility decided by the GET (hidden on 403) (8A).**
2. Group page only (8B).
3. Code in `GroupResponse` + `is_organizer` (8C).
4. Share sheet on the public term page (8D).

### Decision Outcome
Chosen option: 1, because it covers both moments with one hook and one component. `useJoinCode(groupId, enabled)` (query key prefixed `groupJoinCode`, enabled only for PRIVATE, no retry on 4xx) returns `{data, loading, error, refetch, regenerate}`; `regenerate` awaits invalidation of the prefix and surfaces `extractProblemMessage` text. The card shows the code as `123 456` with actions "Kopiuj kod", "Kopiuj link z kodem" (link = `origin + termPublicPath(group, termId) + "?code="`), and "Wygeneruj nowy kod" behind a confirm sheet.

### Consequences

#### Good
- One component reused on two surfaces; no DTO changes.
- Members never see the card.

#### Bad
- Members trigger one extra (403) request per page view.
- "Kopiuj link z kodem" needs a term id; the stepper has one, `GroupDetailsPage` currently loads no terms — the spec must pick the target term or show only "Kopiuj kod" there.
- Two surfaces to keep in copy-sync.
