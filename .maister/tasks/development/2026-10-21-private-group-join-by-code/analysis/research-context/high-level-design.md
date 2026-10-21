# High-Level Design: Join a PRIVATE group by a 6-digit access code

## TL;DR
A PRIVATE group gets one organizer-controlled **6-digit numeric code** stored in plaintext on `groups.join_code`, created lazily on the organizer's first view and rotated only by an explicit "Wygeneruj nowy kod".
A logged-in visitor on the term page enters the code (or arrives via a `?code=` link that auto-submits once), the backend verifies it **per group** with `secrets.compare_digest` behind a **two-key in-process limiter** (10 failures/15 min per user+group, 30 failures/1 h per group → 429), and calls the unchanged `add_active_membership` — after which `/access` and RSVP work exactly as they do today.
The whole "poproś o dostęp" tree (backend, frontend, notifications, tests, table) is deleted in the same change; migration 0059 adds the column, 0060 drops the request schema.

## Key Decisions
- 6-digit numeric code + dual in-process limiter (variant 6B) — user corrected the reference from 9 to 6 digits; the per-group key bounds guessing at ~1.9 years expected regardless of how many accounts attack (ADR-001).
- Plaintext nullable `groups.join_code` String(6), no index, never in public/general DTOs — organizer must re-read and copy it; a hash of 10^6 values is trivially reversible anyway (ADR-002).
- Limiter as a module-level sliding-window store on `time.monotonic` with an injectable clock, new `TooManyAttemptsException` → 429 + `Retry-After` — single uvicorn process (docker-compose.yml:45, Dockerfile:50), no dependency, no DB writes on failures (ADR-003).
- Lazy get-or-create on organizer `GET /api/groups/{id}/join-code`, explicit regenerate with confirm, no expiry, no backfill (ADR-004).
- `JoinByCodeSheet` on the shared `ModalSheet`, opened from a new `canEnterCode` gate branch; `?code=` prefill + one-shot auto-submit, then strip (ADR-005).
- Full removal of join requests (app is not in production): code tree, `GROUP_JOIN_*` kinds, `notifications.join_request_id`, `group_join_requests` in revision 0060; no pre-deploy count check (ADR-006).
- Redeem error order 401 → 404 → 429 → 409 (one generic Polish message) → 200 idempotent `{created}` (ADR-007).
- `JoinCodeCard` on `GroupDetailsPage` and on the `CreateGroupStepper` done screen, hidden when the GET returns 403 (ADR-008).

## Open Questions / Risks
- **Brute-force residual risk is real, not negligible**: with the group capped at 30 guesses/h, an attacker who sustains the attack succeeds with ≈2.2 % probability per 30 days and ≈26 % per year (systematic enumeration: 30 × 24 × 365 = 262 800 of 10^6 values). Expected time ≈1.9 years. Accepted by the user; regeneration does not reset this risk, it only revokes a leaked code.
- **Accepted DoS**: anyone with an account can deliberately exhaust a group's 30-failure budget and block legitimate visitors (including ones holding the right code) for up to 1 h; a single account can do it alone in ~45 min (10 per 15-min window). Organizer regeneration does not lift the block — it lapses on its own.
- Limiter state is lost on restart and would weaken linearly if uvicorn ever runs with `--workers > 1` (must be revisited before scaling — see Out of scope).
- **Which term does "Kopiuj link z kodem" target on `GroupDetailsPage`?** The page loads no terms today (it shows group details + attendees only). Assumption: the card receives an optional `termId`; the stepper passes `createdTermId`, the group page passes the group's nearest upcoming term if the spec finds a cheap existing source, otherwise only "Kopiuj kod" is shown there. To be settled in the specification.
- No uniqueness on active memberships (OQ-8): a double submit can create two active `Membership` rows; mitigated only by the `_is_active_member` guard and the busy-disabled submit.
- `returnTo` is not validated as a same-origin path (OQ-10); `?code=` links will traverse login more often. Out of scope here.

---

## Design Overview

**Business context.** Signing up for a term in a PRIVATE group is painful today: a visitor must "poprosić o dostęp", wait for the organizer to approve, and come back — the organizer's decision loop sits between the link and the RSVP. Organizers already share term links in chats; the reference product the user knows lets the organizer share a **short numeric code** instead. Visitors benefit (link tap → member → RSVP in one sitting) and organizers keep control (only people they give the code to get in).

**Chosen approach.** A **shared group secret** replaces the **request/approve workflow**. The code lives as a single **plaintext column** on `groups`, is created **lazily** when the organizer first looks at it, and is verified **per group** (the group id is already in every term link) using constant-time comparison behind a **two-key in-process attempt limiter**. Redeeming a valid code calls the existing membership primitive `add_active_membership`, so the **`/access` resolver, the RSVP guard and the gate shell stay unchanged**. On the frontend, the private gate swaps its request branch for a **"Mam kod dostępu" sheet** built on the shared `ModalSheet`, and organizers get a **`JoinCodeCard`** with copy/regenerate actions. The architectural style stays a **modular monolith** (the groups bounded context inside the FastAPI microkernel) with a thin router → application use case → repository layering.

**Key decisions:**
- 6 digits (user correction from 9) made safe by a per-group failure budget, not by entropy (ADR-001).
- Plaintext column, no index, verified by group id — organizer can always view/copy (ADR-002).
- In-process limiter + new 429 handler — single process, zero dependencies (ADR-003).
- Lazy generation + explicit regenerate — no backfill, no new side effects in create/update (ADR-004).
- Sheet + `?code=` one-shot auto-submit — the shortest link-to-RSVP path (ADR-005).
- Delete the join-request mechanism entirely in one change (ADR-006).
- No-oracle error order with idempotent success (ADR-007).
- Organizer card on group page + stepper done screen (ADR-008).

---

## Architecture

### System Context (C4 Level 1)

```
  +---------------------+        term link (+ ?code=123456)        +----------------------+
  |  Organizer          |  ---- shares via chat / verbally ------> |  Visitor             |
  |  (logged-in user,   |                                          |  (anonymous or       |
  |   active organizer) |                                          |   logged-in user)    |
  +----------+----------+                                          +----------+-----------+
             |  HTTPS (browser SPA)                                           |  HTTPS (browser SPA)
             |  view / copy / regenerate code                                 |  login, enter code, RSVP
             v                                                                v
  +-------------------------------------------------------------------------------------------+
  |                         aj platform (group-thing-app)                                     |
  |   React SPA + FastAPI backend; groups bounded context owns PRIVATE gating and join codes  |
  +---------------------------------------------+---------------------------------------------+
                                                |  SQL (asyncpg)
                                                v
                                   +---------------------------+
                                   |  PostgreSQL               |
                                   |  groups.join_code (new)   |
                                   +---------------------------+
```

The only external interaction that matters is **human-to-human**: the organizer passes the code or the code-carrying term link to visitors out of band (chat, voice, paper). No e-mail, SSO or third-party service is involved, and no notification is sent on join.

### Container Overview (C4 Level 2)

```
+--------------------------------------------------------------------------------------------------+
| Browser: React SPA (Vite, TanStack Query v5)                                                     |
|                                                                                                  |
|  Visitor side                                   Organizer side                                   |
|  +------------------------------+               +---------------------------------+              |
|  | TermPage (route, no guard)   |               | GroupDetailsPage                |              |
|  |  - reads/strips ?code=       |               |  + JoinCodeCard (PRIVATE only,  |              |
|  |  - useTermAccess (+joinWith- |               |    hidden on 403)               |              |
|  |    Code mutation)            |               | CreateGroupStepper done screen  |              |
|  |  PrivateGroupGate            |               |  + JoinCodeCard                 |              |
|  |   loginRequired | canEnter-  |               | useJoinCode (query + regenerate)|              |
|  |   Code -> JoinByCodeSheet    |               +----------------+----------------+              |
|  +--------------+---------------+                                |                               |
|                 |  api/groups.ts: redeemJoinCode / getJoinCode / regenerateJoinCode              |
+-----------------+------------------------------------------------+-------------------------------+
                  | JSON/HTTPS  POST /api/groups/public/{id}/join-code                               
                  |             GET  /api/groups/{id}/join-code                                     
                  |             POST /api/groups/{id}/join-code/regenerate                          
                  v                                                                                  
+--------------------------------------------------------------------------------------------------+
| FastAPI backend (single uvicorn process)                                                         |
|                                                                                                  |
|  core: authorization_matrix (first-match rows)  core: errors (+TooManyAttemptsException -> 429)  |
|                                                                                                  |
|  groups BC:                                                                                      |
|   router/join_code.py --> application/join_code.py --(check/record/clear)--> join-code limiter   |
|        |                     |  get_or_create / regenerate / redeem          (in-memory dict,    |
|        |                     |                                                 time.monotonic)   |
|        |                     +--> add_active_membership (unchanged)                              |
|        |                     +--> repository.get_group (404 incl. soft-deleted)                  |
|   router/public (/access, /rsvp) --> public_view.py (join_request branch removed)                |
|                                                                                                  |
|  notifications BC: GROUP_JOIN_* kinds and join_request_id removed                                |
+-----------------------------------------------+--------------------------------------------------+
                                                | SQLAlchemy 2.0 async / asyncpg                     
                                                v                                                    
+--------------------------------------------------------------------------------------------------+
| PostgreSQL 18: groups(+join_code VARCHAR(6) NULL), group_roles, memberships, notifications       |
|               (-join_request_id); group_join_requests DROPPED (Alembic 0059 -> 0060)             |
+--------------------------------------------------------------------------------------------------+
```

| Container | Responsibility |
|---|---|
| React SPA | Renders the private gate and code sheet for visitors, the code card for organizers; owns `?code=` handling and copy-to-clipboard. |
| FastAPI backend | Authorizes (matrix + service ownership checks), generates/rotates/verifies codes, throttles failures, creates memberships. |
| In-process limiter | Holds recent failure timestamps per (party, group) and per group; lives and dies with the uvicorn process. |
| PostgreSQL | Persists the code on `groups`; memberships via the existing `group_roles`/`memberships` tables. |

### End-to-end visitor flow (term link → RSVP)

```mermaid
sequenceDiagram
    autonumber
    actor O as Organizer
    actor V as Visitor
    participant SPA as React SPA (TermPage / PrivateGroupGate)
    participant API as FastAPI groups BC
    participant L as Join-code limiter (in-process)
    participant DB as PostgreSQL

    O->>SPA: Open GroupDetailsPage / stepper done screen
    SPA->>API: GET /api/groups/{id}/join-code
    API->>DB: get_group, require active organizer, join_code IS NULL? generate + commit
    API-->>SPA: 200 {code:"482913"}
    O-->>V: shares /:slug/grupa/{id}/term/{termId}?code=482913

    V->>SPA: open link
    SPA->>API: GET /api/groups/public/{id}/access
    alt anonymous
        API-->>SPA: reduced payload (all flags false)
        SPA-->>V: gate loginRequired -> /login?returnTo=<path + ?code=>
        V->>SPA: login/register, returns to same URL with ?code=
        SPA->>API: GET /access (now with token)
    end
    API-->>SPA: can_view_content=false (PRIVATE, not member)
    SPA->>SPA: gate canEnterCode; open JoinByCodeSheet prefilled; auto-submit once
    SPA->>API: POST /api/groups/public/{id}/join-code {code}
    API->>API: caller party (401) -> group PRIVATE & not deleted (404)
    API->>L: check(party, group)
    alt budget exhausted
        L-->>API: retry_after
        API-->>SPA: 429 + Retry-After + Polish message
    else allowed
        API->>DB: read groups.join_code
        alt null or mismatch (compare_digest)
            API->>L: record_failure(party, group) on both keys
            API-->>SPA: 409 "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie"
        else match
            API->>DB: if not active member: add_active_membership + commit
            API->>L: clear(party, group)
            API-->>SPA: 200 {created: true|false}
        end
    end
    SPA->>SPA: strip ?code= (replace:true); invalidate groupAccess
    SPA->>API: GET /access
    API-->>SPA: full payload, can_view_content=true
    SPA-->>V: PublicTermView
    V->>SPA: "Zapisz się"
    SPA->>API: POST /api/groups/public/{id}/rsvp (unchanged PRIVATE guard: active member)
    API-->>SPA: 201
```

---

## Key Components

| Component | Purpose | Responsibilities | Key Interfaces | Dependencies |
|---|---|---|---|---|
| **Join-code use cases** (`app/groups/application/join_code.py`, new) | Own the code lifecycle and redemption rules. | - `get_or_create_join_code` (organizer, PRIVATE, lazy generate + commit)<br>- `regenerate_join_code` (organizer, overwrite + commit)<br>- `redeem_join_code` (error order, limiter, membership)<br>- generation via `secrets.choice("0123456789")` × 6 | re-exported from `app/groups/service.py` | repository (`get_group`), `_require_active_organizer`, `add_active_membership`, `_is_active_member`, limiter, `errors` |
| **Join-code limiter** (`app/groups/application/join_code_limiter.py`, new) | Bound guessing per user and per group. | - `check(party_id, group_id)` raises `TooManyAttemptsException(retry_after)`<br>- `record_failure` appends to both keys<br>- `clear(party_id, group_id)` drops the user key on success<br>- prunes expired timestamps of touched keys | module-level instance; constructor takes `clock: Callable[[], float] = time.monotonic` | none (stdlib) |
| **Join-code router** (`app/groups/router/join_code.py`, new; replaces `router/join_requests.py`) | HTTP surface for the three endpoints. | - binds schemas, principal dependency<br>- no business logic | registered in `router/__init__.py` in the old router's slot | use cases, `require_any()` |
| **429 error type** (`app/core/errors.py`, changed) | Typed throttling failure. | - `TooManyAttemptsException(message, retry_after)`<br>- handler: standard envelope, status 429, `Retry-After` header | `register_exception_handlers` (errors.py:144-162), registered before the generic `Exception` handler | — |
| **Authorization matrix** (`app/core/authorization_matrix.py`, changed) | Coarse route gating. | - remove `POST …/join-requests(/…/withdraw)?` row (l.107-117)<br>- add `POST ^/api/groups/public/[^/]+/join-code$ → AUTHENTICATED` in the same slot (before row 27) | first-match table | — |
| **Public access resolver** (`public_view.py`, changed) | Unchanged behavior; join-request branch removed. | - PRIVATE: `can_view_content = is_member or is_organizer`<br>- `GroupAccessDetails.join_request` field removed | `GET /api/groups/public/{id}/access`, `POST …/rsvp` | — |
| **PrivateGroupGate + JoinByCodeSheet** (frontend, changed/new) | Visitor entry point. | - gate union `loginRequired \| canEnterCode`<br>- sheet: one field, shared parser, inline `role="alert"`, busy state, server message passthrough | props: `join(code)` from host page, `initialCode`, `autoSubmit` | `ModalSheet`, `useTermAccess`, `utils/joinCode` |
| **TermPage `?code=` handling** (frontend, changed) | Deep-link convenience. | - read once `/access` loaded and not stale<br>- `view` → strip; `loginRequired` → keep; `canEnterCode` → open + auto-submit once, then strip | `useSearchParams`, `replace: true` | gate, `useTermAccess` |
| **JoinCodeCard + useJoinCode** (frontend, new) | Organizer view/copy/rotate. | - shows `123 456` (mono, sr-only full value)<br>- "Kopiuj kod", "Kopiuj link z kodem" (when a term is known), "Wygeneruj nowy kod" (confirm sheet)<br>- hidden on 403 | `useJoinCode(groupId, enabled)` → `{data, loading, error, refetch, regenerate}` | `api/groups.ts`, `queryClient`, toast, `termPublicPath` |
| **Alembic 0059 / 0060** (new) | Schema change and removal. | - 0059 add `groups.join_code`<br>- 0060 delete `GROUP_JOIN_%` notifications, drop `notifications.join_request_id`, drop `group_join_requests` | `alembic upgrade head` before uvicorn (docker-compose.yml:45) | 0058 head |

### Change inventory (new / changed / deleted)

**Backend — new**
- `app/groups/application/join_code.py`, `app/groups/application/join_code_limiter.py`, `app/groups/router/join_code.py`
- `alembic/versions/0059_group_join_code.py`, `alembic/versions/0060_drop_group_join_requests.py`
- `tests/test_group_join_code.py`, `tests/test_join_code_limiter.py`, `tests/test_group_join_code_migrations.py`

**Backend — changed**
- `app/groups/models.py` — add `Group.join_code: Mapped[str | None] = String(6)`; delete `GroupJoinRequestStatus` (l.63-67) and `GroupJoinRequest` (l.195-223); rewrite `GroupVisibility` docstring (l.84-90) to "join with organizer's access code".
- `app/groups/schemas.py` — delete 4 join-request schemas (l.718-752) and `GroupAccessDetails.join_request` (l.368); add `JoinCodeResponse`, `RedeemJoinCodeRequest`, `RedeemJoinCodeResponse`.
- `app/groups/service.py` — drop 6 re-exports (l.42-48, `__all__`), add 3.
- `app/groups/router/__init__.py` — swap import/registration (l.16, l.35) and docstring.
- `app/groups/application/public_view.py` — remove `_GATE_JOIN_REQUEST_STATUSES` (l.349-351), block l.399-407, `join_request=` l.417, imports l.39/43, docstrings l.370-374/455-457.
- `app/groups/infrastructure/repository.py` — delete `GroupJoinRequest` section (l.686-761) and imports.
- `app/groups/infrastructure/notifications_bridge.py` — drop `join_request_id` kwarg (l.28, 37).
- `app/notifications/models.py` (3 kinds l.63-65, column l.94-96), `schemas.py` (l.23), `service.py` (l.40-59).
- `app/core/authorization_matrix.py`, `app/core/errors.py` — as in the component table.
- Tests: `test_group_access.py` (drop `_request_access`, rewrite l.316/344/366/393 to code flow, key-sets l.53/73/91/112), `test_authorization_matrix.py` (l.128-148), `test_group_soft_delete_reads.py` (replace l.192-209 with "redeem on soft-deleted group → 404").

**Backend — deleted**
- `app/groups/application/join_requests.py`, `app/groups/router/join_requests.py`
- `tests/test_group_join_requests_router.py`, `tests/test_group_join_requests_decisions.py`, `tests/test_group_join_request_model.py`
- Migrations 0037/0038/0041 stay untouched as history.

**Frontend — new**
- `components/krag/JoinByCodeSheet.tsx`, `components/panel/JoinCodeCard.tsx`, `hooks/useJoinCode.ts`, `utils/joinCode.ts` (`parseJoinCode` → `null | string | undefined`, `formatJoinCode` → `"123 456"`; shared by visitor and organizer sides, so not in `pages/panel/panelHelpers.ts`).

**Frontend — changed**
- `pages/krag/PrivateGroupGate.tsx` (keep shell; remove request/pending/rejected/withdraw + focus polling), `pages/krag/termAccess.ts` (union `loginRequired | canEnterCode`), `pages/krag/TermPage.tsx` (`?code=`), `hooks/useTermAccess.ts` (add `joinWithCode`), `api/groups.ts` (remove l.461-516 + `join_request` l.268-271; add 3 functions/types; docstring l.13-16), `api/notifications.ts` (kinds l.15-17, field l.33-37), `api/problem.ts` (pass 429 through `serverMessageOr`; new `ACCESS_DENIED_MESSAGE` text), `components/pending/PendingActionsHost.tsx` and `pendingActions.ts` (cut join-request branch, `jr:` key, 2nd parameter), `pages/panel/GroupDetailsPage.tsx` (label l.11 + card), `components/panel/GroupFormFields.tsx` (option l.74), `components/panel/CreateGroupStepper.tsx` (done screen l.138-170).
- Tests: `TermPage.test.tsx`, `termAccess.test.ts`, `PendingActionsHost.test.tsx`, `PublicLayout.test.tsx`, `ModalSheet.test.tsx` (swap `RequestAccessDialog` → `JoinByCodeSheet`), `themeTokenUsage.test.tsx` / `themeDefects.test.tsx` (file lists), `GroupDetailsPage.test.tsx`, `CreateGroupStepper.test.tsx`.

**Frontend — deleted**
- `components/krag/RequestAccessDialog.tsx`, `hooks/usePendingJoinRequests.ts`.

**Prose** — `snoozeStore.ts:3-4`, `AuthGateSheet.tsx:15`, `TermPage.tsx:9-11`, `test_add_active_membership.py:1-2`, user guide l.214 of the 2026-10-19 task, DEV22 state marked superseded.

---

## Data Flow

1. **Code creation (organizer).** `GET /api/groups/{id}/join-code` → load group (404 if missing/soft-deleted) → active organizer check (403) → PRIVATE check (409) → if `join_code IS NULL`, generate 6 digits with `secrets.choice`, assign, commit (bumps `updated_at`, the optimistic-lock column) → return `{code}`.
2. **Rotation (organizer).** `POST …/join-code/regenerate` → same checks → overwrite → commit → `{code}`. The old code stops working immediately; existing memberships are untouched (the code is never re-checked after joining). Limiter counters are not reset.
3. **Distribution.** Out of band. The SPA builds the share link from `window.location.origin + termPublicPath(group, termId) + "?code=" + code` (never from `location.href`).
4. **Redemption (visitor).** Body `{code}` validated by Pydantic `^[0-9]{6}$` (400 on violation; the client normalizes spaces/hyphens first). Use case runs the 401 → 404 → 429 → 409 → 200 sequence; success inserts MEMBER `GroupRole` + `Membership(valid_from = clock.local_now().date())` through `add_active_membership` and commits once.
5. **Limiter state.** Two maps of failure timestamps in process memory: key `(party_id, group_id)` keeps ≤10 entries for 15 min, key `group_id` keeps ≤30 entries for 1 h. Never persisted; never logged with the submitted code.
6. **Exit.** The SPA invalidates the `groupAccess` query prefix, `/access` now returns full content, `PublicTermView` renders and RSVP goes through the unchanged PRIVATE guard in `create_rsvp`.

What is never exposed: the code is absent from `GroupResponse` (`GET /api/groups/{id}` is READ without an organizer check, `router/circles.py:303-307`), `PublicCircleResponse`, `/access`, notifications and logs.

---

## Integration Points

| Existing piece | Interaction | Change |
|---|---|---|
| `add_active_membership` (groups BC) | Called by redeem to create MEMBER role + membership (flush, caller commits) | none |
| `get_group_access` / `create_rsvp` (`public_view.py`) | Consumes the resulting membership | only the `join_request` branch/field removed |
| `_require_active_organizer`, `_get_caller_party_id` patterns | Reused for organizer endpoints and the 401 step (ported from `join_requests.py` l.52-59, l.71-75) | moved into the new module |
| Authorization matrix | New AUTHENTICATED row for redeem; GET uses row 26 (READ), regenerate row 27 (EDIT) | 1 row removed, 1 added |
| `errors.py` handler registry | New 429 handler | additive |
| Notifications BC | Loses 3 kinds + `join_request_id` | removal; bell renders by `message`/`link_path`, unaffected |
| Alembic chain | 0058 → 0059 → 0060 | additive then destructive |
| `ModalSheet`, `useRegisterOpenSheet`, `trapFocus` | Host the visitor sheet and the regenerate confirm | none |
| Auth redirect (`AuthGateLinks`, `LoginPage`, onboarding) | Carries `?code=` through `returnTo = pathname + search` | none |
| `queryClient` (no retry on 4xx), `extractProblemMessage`, `serverMessageOr` | Error surfacing | `serverMessageOr` passes 429 |
| `PendingActionsHost` | Loses join-request prompts; swap/confirm prompts stay | removal |

### API contract

| Endpoint | Matrix row / dependency | Request | Responses (in evaluation order) |
|---|---|---|---|
| `GET /api/groups/{group_id}/join-code` | row 26 READ (no new row); `require_any(...)` as existing READ routes | — | 404 group unknown or soft-deleted · 403 caller is not an active organizer (`AccessDeniedException`) · 409 group is PUBLIC: `Grupa jest publiczna — kod dostępu nie jest potrzebny` · **200** `{"code": "482913"}` (generated + committed on first call) |
| `POST /api/groups/{group_id}/join-code/regenerate` | row 27 EDIT (no new row) | empty body | 404 · 403 · 409 (as above) · **200** `{"code": "<new>"}` |
| `POST /api/groups/public/{group_id}/join-code` | **new** `POST ^/api/groups/public/[^/]+/join-code$ → AUTHENTICATED`, placed where the join-requests row was (before row 27); `Depends(require_any())` | `{"code": "482913"}` — `Field(pattern=r"^[0-9]{6}$")` | 400 pattern violation (standard validation envelope) · 401 no principal or principal without party profile · 404 unknown / soft-deleted / PUBLIC group · 429 limiter (`Retry-After: <s>` header, message `Za dużo prób wpisania kodu — spróbuj ponownie za {n} min`) · 409 wrong code **or** group has no code yet — one message `Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie` · **200** `{"created": true}` new member / `{"created": false}` already an active member |

All error bodies use the existing envelope from `errors.py`; 409 text reaches the user verbatim via `serverMessageOr`.

### Limiter contract

| Key | Budget | Window | Purpose |
|---|---|---|---|
| `(party_id, group_id)` | 10 failures | 15 min sliding | Short, personal lockout for a mistyping user; caps one account's burst. Cleared on that user's success. |
| `group_id` | 30 failures | 1 h sliding | Security bound independent of the number of accounts: 5·10^5 expected guesses / 30 per h ≈ 1.9 years. Never cleared by success. |

`check` runs **before** the code comparison (so a locked-out caller learns nothing, even with the right code); a failure is recorded on **both** keys; `Retry-After` is the longest remaining wait among exceeded keys. Concurrent requests may overshoot a budget by at most the number of in-flight requests (check and record are separated by DB awaits) — accepted.

### Polish UI copy (6-digit version)

| Place | Text |
|---|---|
| Gate heading | `Ta grupa jest prywatna` (unchanged) |
| Gate, logged in | `Zajęcia i lista uczestników są widoczne tylko dla członków. Wpisz kod dostępu od organizatora, aby dołączyć.` |
| Gate, anonymous | `Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby wpisać kod dostępu.` · with `?code=`: `Masz kod? Zaloguj się, żeby go użyć.` |
| Gate button | `Mam kod dostępu` |
| Sheet | title `Wpisz kod dostępu`; label `Kod dostępu`; hint `6 cyfr, np. 123 456`; submit `Dołącz` / `Dołączanie…`; `Anuluj`; close `Zamknij` |
| Local validation | `Kod ma 6 cyfr` |
| 409 | `Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie` |
| 429 | `Za dużo prób wpisania kodu — spróbuj ponownie za {n} min` |
| Other error | `Nie udało się dołączyć — spróbuj ponownie` |
| Success toast | `Dołączono do grupy` |
| Card | title `Kod dostępu`; `Kopiuj kod`, `Kopiuj link z kodem`, `Wygeneruj nowy kod`; toasts `Skopiowano kod`, `Skopiowano link`, `Wygenerowano nowy kod`; error `Nie udało się skopiować kodu` |
| Regenerate confirm | `Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie.` — buttons `Wygeneruj nowy kod` / `Anuluj` |
| Visibility labels | form option `Prywatna — (dostęp z kodem)`; details `Prywatna (dostęp z kodem)` |
| Stepper done (PRIVATE) | `Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu.` |
| `ACCESS_DENIED_MESSAGE` | `Nie masz uprawnień do tej akcji. Zaloguj się ponownie albo poproś organizatora o kod dostępu.` |

Input contract (per `validation.md`): `type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code"`, raw string in state, `aria-invalid`/`aria-describedby` on the inline `role="alert"`, submit disabled while invalid or busy (`aria-busy`).

---

## Design Decisions

| # | Decision | Chosen | Rejected alternatives | ADR |
|---|---|---|---|---|
| 1 | Code format & brute-force protection | 6 digits + per-(user, group) 10/15 min + per-group 30/1 h limiter | 9 digits + per-user limiter (1A), Crockford-8 (1B), 10–12 digits (1C), link token (1D) | [ADR-001](decision-log.md#adr-001) |
| 2 | Where the code lives | plaintext `groups.join_code` String(6) | codes table (2B), hash (2C), HMAC-derived (2D) | [ADR-002](decision-log.md#adr-002) |
| 3 | Limiter placement | in-process sliding window, injectable clock, 429 handler | DB counter (3B), none (3C), nginx only (3D) | [ADR-003](decision-log.md#adr-003) |
| 4 | Generation & rotation | lazy get-or-create + explicit regenerate | eager + backfill (4B), explicit generate (4C), auto-expiry (4D) | [ADR-004](decision-log.md#adr-004) |
| 5 | Visitor UX | `JoinByCodeSheet` + `?code=` one-shot auto-submit | inline field (5B), prefill only (5C), dedicated route (5D) | [ADR-005](decision-log.md#adr-005) |
| 6 | Removal of join requests | delete everything in 0060, no pre-deploy check | auto-approve script (6B), read-only release (6C), notify once (6D) | [ADR-006](decision-log.md#adr-006) |
| 7 | Redeem response semantics | 401→404→429→409 generic→200 `{created}` | distinct statuses (7B), always-200 enum (7C) | [ADR-007](decision-log.md#adr-007) |
| 8 | Organizer surface | `JoinCodeCard` on group page + stepper, hidden on 403 | page only (8B), code in `GroupResponse` (8C), public-page share (8D) | [ADR-008](decision-log.md#adr-008) |

---

## Concrete Examples

**Example 1 — Link tap to RSVP (anonymous visitor).**
Given a PRIVATE group "Joga w parku" whose organizer copied `https://…/joga/grupa/{g}/term/{t}?code=482913` from the stepper done screen, and Ania has no session,
when Ania opens the link, logs in from the gate and lands back on the same URL with `?code=482913`,
then the sheet opens prefilled and submits once, the backend answers `200 {created:true}`, the `?code` parameter is removed from the address bar with `replace`, the page shows the term with its participant list, and Ania's "Zapisz się" returns 201.

**Example 2 — Mistyped code, then lockout.**
Given Bartek is logged in and not a member,
when he types `48291` the submit stays disabled with `Kod ma 6 cyfr`; when he submits `482910` he gets 409 `Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie` and the sheet stays open with his input,
and after his 10th failure within 15 minutes the 11th attempt — even with the correct `482913` — returns 429 with `Retry-After` and `Za dużo prób wpisania kodu — spróbuj ponownie za 15 min`. Failures from other accounts against the same group count toward its 30/h budget; once that is exhausted every visitor sees 429 until the oldest failure is an hour old.

**Example 3 — Rotation after a leak; members unaffected.**
Given the code `482913` was posted in a public channel and Ania already joined with it,
when the organizer presses `Wygeneruj nowy kod` and confirms,
then `GET` now returns e.g. `705166`, redeeming `482913` returns 409, redeeming `705166` returns 200, Ania still sees the content and can RSVP, and a member who re-opens an old `?code=482913` link is shown the term directly (the client resolves `view` before any redeem and strips the parameter).

**Example 4 — Member card visibility.**
Given Celina is a plain member of the group and opens `/panel/grupy/{g}`,
when `useJoinCode` calls `GET /api/groups/{g}/join-code`,
then the backend returns 403, the query does not retry (4xx), and the page renders without `JoinCodeCard`.

---

## Test Plan Outline

Aligned to `backend-testing.md` (real PostgreSQL via testcontainers, `client`/`db_session` fixtures, exact key-set assertions, `test_<operation>_<scenario>_<expected>` names, 2–8 tests per feature) and `frontend-testing.md` (Vitest + Testing Library, `createQueryWrapper`, `vi.mock` API modules, explicit vitest imports).

**Backend**
| File | Tests |
|---|---|
| `tests/test_group_join_code.py` (8) | 1 organizer GET creates a 6-digit code, second GET returns the same; 2 member GET → 403, unknown group → 404, PUBLIC group → 409; 3 redeem correct → 200 `{created:true}` → `/access` `can_view_content` → RSVP 201 (replaces `test_group_access.py:366`); 4 wrong code and no-code-yet → 409 with identical message, PUBLIC/soft-deleted → 404, anonymous → 401; 5 member redeem → 200 `{created:false}` and membership count unchanged; 6 regenerate invalidates old code (old 409, new 200); 7 11th failure for one user → 429 with `Retry-After`, then correct code still 429 (check-before-compare); 8 `join_code` absent from `GET /api/groups/{id}`, `GET /api/groups/public/{id}` and `/access` bodies (exact key-sets). |
| `tests/test_join_code_limiter.py` (4–5, pure unit with injected fake clock) | user key blocks at 10 within 15 min and unblocks after the window slides; group key blocks at 30 across distinct parties within 1 h; `clear` resets only the user key; `retry_after` equals the longest remaining wait; touched keys are pruned. |
| `tests/test_group_join_code_migrations.py` (2) | downgrade to 0058 → upgrade head (column round-trip); downgrade to 0059 → upgrade head (table, column, FKs/indexes re-created in post-0041 shape and dropped again). |
| `tests/test_authorization_matrix.py` (changed) | `POST /api/groups/public/42/join-code` → AUTHENTICATED; regression that without the row it would fall to row 27 EDIT; join-request paths removed. |
| `tests/test_group_access.py`, `test_group_soft_delete_reads.py` (changed) | key-sets without `join_request`; join via code instead of approve; redeem on soft-deleted group → 404. |

The module-level limiter must be reset between tests (autouse fixture calling a reset on the shared instance) so failures in one test never leak into another.

**Frontend**
| File | Tests |
|---|---|
| `TermPage.test.tsx` (7) | logged-in non-member sees `Mam kod dostępu` (no `Poproś o dostęp`); sheet traps Tab, Esc closes, focus returns to opener; invalid format → submit disabled + `role="alert"`; 409 → inline message, sheet stays open; 200 → content view; `?code=482913` → exactly one redeem call and parameter removed; anonymous with `?code=` → login link `returnTo` contains the code. |
| `termAccess.test.ts` | `canEnterCode` derivation; removed `pending/rejected` cases. |
| `GroupDetailsPage.test.tsx` (4) | card shown for PRIVATE organizer; hidden on 403; copy code → clipboard + toast; regenerate requires confirmation then shows the new code. |
| `CreateGroupStepper.test.tsx` | PRIVATE done screen shows code and both copy actions; PUBLIC shows none. |
| `ModalSheet.test.tsx`, `themeTokenUsage.test.tsx`, `themeDefects.test.tsx` | retarget from `RequestAccessDialog` to `JoinByCodeSheet`; add new files to no-hex/no-legacy lists. |
| `PendingActionsHost.test.tsx`, `PublicLayout.test.tsx` | delete the join-request describe block (8 tests) and pending-join-request assertions. |

**Manual E2E (verification phase)**: two accounts — organizer copies the link from the stepper, second account opens it logged out, logs in, lands as member, RSVPs.

---

## Out of Scope

Deferred follow-ups (captured, not designed here):
- Partial unique index on active memberships `(from_role_id, to_group_id) WHERE valid_to IS NULL` (OQ-8).
- `returnTo` same-origin validation (`startsWith("/")`) in `LoginPage`/`AuthGuard` (OQ-10).
- Organizer notification "X dołączył(a) kodem" (would need a new kind ≤30 chars).
- nginx `limit_req` as defence in depth.
- DB-backed limiter — required before running more than one uvicorn worker or instance.
- `is_organizer` flag in `GroupResponse` (would remove the 403 probe).
- "Kopiuj link z kodem" from the public term page / `ShareButton` (8D).
- Member-removal UI combined with regeneration.
- Privacy gaps outside `/access` (`/api/terms`, `/api/pledges`, `/api/needed-items`, membership list — OQ-9).
- "Wygenerowano …" rotation timestamp on the card.
- Hybrid with organizer approval, per-invite code tables with expiry/max-uses, e-mail invites, SSO, changes to PUBLIC groups.

Explicitly not done: no pre-deploy PENDING count check, no auto-approve script, no backfill of codes, no code expiry, no edits to applied migrations 0037/0038/0041.

## Success Criteria

1. A logged-in non-member holding a valid code reaches the term content and a successful RSVP with **one** code submission and no organizer action (Example 1 passes end-to-end, manual two-account check).
2. No API response other than the two organizer endpoints ever contains `join_code` (key-set tests).
3. Guessing is bounded: no single group accepts more than 30 failed redemptions per rolling hour and no (user, group) pair more than 10 per 15 minutes; a correct code submitted while locked returns 429.
4. Wrong code and "no code yet" are indistinguishable to the visitor (same status, same message).
5. After the change, `grep` over `src/` finds no `join_request`, `JoinRequest` or `GROUP_JOIN_` identifiers outside migration history, and `alembic downgrade 0058 && alembic upgrade head` succeeds.
6. Full suites green: `uv run python -m pytest|mypy|ruff` (from `src/backend`, mypy not worse than baseline) and `vitest run` / `tsc -b` / eslint.
