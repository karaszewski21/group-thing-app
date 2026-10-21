# Production Readiness Report

**Date**: 2026-10-21
**Path**: working-tree changes vs HEAD in `group-thing-app` (task `2026-10-21-private-group-join-by-code`)
**Target**: production
**Status**: Ready (with concerns), re-verification cycle 3 (final)

## TL;DR
- **GO with mitigations** (unchanged from cycles 1-2). There are 0 blockers. B1 is still resolved: the code is not in any request URL, `returnTo` or log line. `api/client.ts` is unchanged vs HEAD, and its 401 redirect uses `pathname + search` only.
- Cycle-3 changes: `onJoin` writes `{code, savedAt}` to sessionStorage *before* `joinWithCode` and removes it on success or any non-401 error. A `redeemStarted` guard stops the page from re-reading its own entry, and `JoinByCodeSheet` is keyed by `initialCode`. None of these adds a URL, a header or a log.
- Writing the code before the redeem removes the cycle-2 write-after-redirect ordering question. The code is persisted before `fetch` is called.
- Tests: 70/71 passed, and the only failure is the pre-existing `Imię` test. `tsc` exits 0. C3, C4 and C5 remain low or pre-existing residuals.

## Open Questions / Risks
1. **Outer TLS proxy (still unconfirmed)**: if a proxy sits in front, it must pass 429 + `Retry-After` through unchanged. With `#code=` it cannot log the code.
2. **Entry present while the redeem is in flight (info, ADR-005)**: a logged-in visitor's code now sits in sessionStorage for the duration of the POST. The scope is per tab and same-origin, it has a 1h TTL, and it is removed on any non-401 result. If the tab reloads mid-request, the entry survives. The next mount then either clears it (the redeem succeeded, so access is `view`) or auto-submits once more (the redeem is idempotent). Closing the tab drops it.
3. **`redeemStarted` is one-way per mount (info)**: this is the same as the cycle-2 `signedOut`. After the first redeem this TermPage instance ignores stored codes; a `#code=` hash still takes priority. A 401 always triggers a full-page load, so the page remounts after login.
4. **Sheet `key={initialCode}` (info)**: the code is held in React's fiber tree only, never in the DOM, a URL or a log. An identical code does not remount the sheet, which is intended.
5. **Rollback is lossy (unchanged)**: join codes and `GROUP_JOIN_*` notifications are dropped on downgrade. This is documented in the 0060 docstring.
6. **Acknowledged (ADR-001..008, not blockers)**: the single-process in-memory limiter, the 6-digit brute-force residual, and the group-budget DoS.
7. Resolved and no longer open: cycle-2 Open Question 2 (write-after-redirect ordering).

## Re-verification (cycle 3)

| ID | Item | Result | Evidence |
|----|------|--------|----------|
| B1 | Code in any request URL or log | **Still resolved** | See the checklist below |
| P1 | Persist before redeem | **OK** | `TermPage.tsx:95-114`: `writePendingCode(groupId, code)` + `setRedeemStarted(true)` run before `await joinWithCode(code)`. In the `catch`, the entry is removed unless `err.cause` is an `ApiError` with status 401, and the error is rethrown. On success the entry is removed, the sheet closes and the toast shows. Test: `TermPage.test.tsx` "#code= is in sessionStorage while its redeem runs and stays there after a 401" |
| P2 | `redeemStarted` guard | **OK** | `TermPage.tsx:61-62`: `pendingCode = hashCode ?? (redeemStarted ? null : readPendingCode(groupId))`. The page's own in-flight entry cannot reopen the sheet or trigger a second auto-submit. Tests: "under StrictMode redeems exactly once", "survives the login round trip … then redeems once", "with blocked sessionStorage still redeems exactly once" |
| P3 | Sheet `key` | **OK** | `PrivateGroupGate.tsx:113-114` `<JoinByCodeSheet key={codeSheet.initialCode} …>`. A new link code remounts the sheet with fresh state. Test: "a new #code= while a 409 sheet is open shows the new code and redeems it once" |
| C3 | Limiter keys pruned only when revisited | **Residual** (low) | Backend unchanged in this cycle |
| C4 | Stale SPA tabs hit removed `join-requests` endpoints | **Residual** (low, accepted) | Reload resolves it |
| C5 | Pre-existing platform gaps | **Residual** (pre-existing) | Liveness-only `/api/health`, no `backend` compose healthcheck, no error tracking |

### B1 checklist after the cycle-3 changes

| Path | Result | Evidence |
|------|--------|----------|
| 401 to `/login` redirect | Clean | `git diff HEAD -- src/frontend/src/api/client.ts` is empty. `client.ts:38-41`: `returnTo = window.location.pathname + window.location.search` (no hash). The redeem is `POST /groups/public/${groupId}/join-code` with `{ code }` in the JSON body (`api/groups.ts:485`). The other join-code calls (`:474` GET, `:479` regenerate) carry no code. |
| `returnTo` builders (grep of `src/`, excluding tests) | Clean | `client.ts:40`, `AuthGuard.tsx:35` and `AuthGateSheet.tsx:11` use `pathname + search`. `RsvpDialogLoggedIn.tsx:116` uses `pathname`. `LoginPage.tsx:23,77`, `RegisterPage.tsx:21`, `OnboardingPage.tsx:48` and `RodzinaView.tsx:13` only forward a received value. Nothing appends `location.hash`. |
| Frontend logging / navigation | Clean | No `console.*`, `location.href` or `code=` URL construction in `TermPage.tsx`, `PrivateGroupGate.tsx`, `JoinByCodeSheet.tsx` or `useTermAccess.ts`. The only `#code=` mentions are doc comments. |
| Hash strip | Clean | `TermPage.tsx:92`: the settle effect still navigates to `{pathname, search}` (replace) for every non-`loginRequired` state. |
| Backend logs | Clean | `app/groups/application/join_code.py:124-129` (429 warning) and `:152-154` (`_log_redeemed`) interpolate only `group_id`, `party_id`, `retry_after_seconds` and `created`. The `code` argument is used only in `secrets.compare_digest`. `router/join_code.py` has no logging. The backend is unchanged in this cycle. |
| nginx | Clean | `src/frontend/nginx.conf` is unchanged vs HEAD. |

**Checks run in this cycle**
- `npx vitest run src/test/TermPage.test.tsx src/test/useTermAccess.test.ts src/test/termAccess.test.ts`: 70/71 passed. All 19 "join a private group by code" tests pass. The one failure is the pre-existing "sign-up footer … login / guest choice" (`Imię`) test, the same one as in cycles 1-2.
- `npx tsc -p tsconfig.app.json --noEmit`: exit 0.

## Re-verification (cycle 2)

| ID | Item | Result | Evidence |
|----|------|--------|----------|
| B1 | Code in any request URL or log | **Still resolved** | See the checklist below |
| N1 | (cycle-1 new finding) Code lost on a 401 before it was persisted | **Resolved** | `TermPage.tsx:90-106`: the `catch` checks `err.cause instanceof ApiError && err.cause.status === 401`, then `writePendingCode(groupId, code)` + `setSignedOut(true)` and rethrows. `useTermAccess.ts:62` rethrows `new Error(serverMessageOr(...), { cause: err })`, so the original `ApiError` survives. `signedOut` makes `pendingCode` null (`TermPage.tsx:60`), so the settle effect (`:80-88`) no longer runs `writePendingCode(groupId, null)` after the code was saved. After the full-page login round trip, `readPendingCode` restores it and the sheet auto-submits. Test: `TermPage.test.tsx:848` "#code= whose redeem gets a 401 keeps the code in sessionStorage…" |
| TTL | Pending code `{code, savedAt}`, 1h | **OK** | `TermPage.tsx:16-32`: entries that are malformed, of the wrong type or older than `PENDING_CODE_TTL_MS` read as `null`, and storage exceptions are swallowed. Test: `TermPage.test.tsx:861` "a pending code older than an hour is ignored" (no sheet, no redeem). Blocked-storage test at `:874` still redeems exactly once. |
| C3 | Limiter keys pruned only when revisited | **Residual** (low) | Backend unchanged in this cycle |
| C4 | Stale SPA tabs hit removed `join-requests` endpoints | **Residual** (low, accepted) | Reload resolves it |
| C5 | Pre-existing platform gaps | **Residual** (pre-existing) | Liveness-only `/api/health`, no `backend` compose healthcheck, no error tracking |

### B1 checklist after the cycle-2 changes

| Path | Result | Evidence |
|------|--------|----------|
| 401 to `/login` redirect | Clean | `api/client.ts:37-42` is unchanged vs HEAD: `returnTo = window.location.pathname + window.location.search`. The fragment is never included. The redeem request itself is `POST /groups/public/{groupId}/join-code` with `{code}` in the JSON body, so the 401 response carries no code in its URL either. The term page's `search` contains no code, because the link format is `#code=` only. |
| New sessionStorage write on the 401 path | Clean | It is client-side only, with the key `pendingJoinCode:{groupId}`. Nothing reads it into a URL: `readPendingCode` feeds only `pendingCode`, which goes to the sheet's `initialCode` and then to the POST body. |
| `{ cause }` rethrow | Clean | The thrown `Error.message` is `serverMessageOr(err, fallback)`, a server problem message or a Polish fallback. The code is never interpolated. The hook and TermPage have no `console.*` calls. |
| `returnTo` builders | Clean | Grep of `src/` (excluding tests): `client.ts:40`, `AuthGuard.tsx:35` and `AuthGateSheet.tsx:11` all use `pathname + search`. `RsvpDialogLoggedIn.tsx:116` uses `pathname` only. `AuthContext.tsx:161` uses a bare `/login`. |
| Hash strip | Clean | The settle effect (`TermPage.tsx:86-87`) still strips `#code=` for every non-`loginRequired` state. The 401 test asserts that the hash is empty afterwards. |
| Backend logs | Clean | The backend is unchanged in this cycle. The cycle-1 evidence (only `group_id`/`party_id`/`created`/`retry_after_seconds` logged) still holds. |

**Checks run in this cycle**
- `npx vitest run src/test/TermPage.test.tsx src/test/useTermAccess.test.ts src/test/termAccess.test.ts`: 69/70 passed. The one failure is the pre-existing "sign-up footer … login / guest choice" `Imię` test (`TermPage.test.tsx:347`), the same one as in cycle 1, listed as pre-existing in `test-suite-results.md`.
- `npx tsc -p tsconfig.app.json --noEmit`: exit 0. `Error` `{ cause }` is supported by lib `ES2023`.

## Re-verification (cycle 1)

| ID | Previous finding | Result | Evidence |
|----|------------------|--------|----------|
| B1 | Join code in nginx/uvicorn access logs via `?code=` and `returnTo` | **Resolved** | See the B1 checklist below |
| C1 | Rollback order undocumented | **Resolved** | `alembic/versions/0060_drop_group_join_requests.py` docstring: "Rollback order: run `alembic downgrade 0058` with the NEW image first … then deploy the old image", plus the data-loss notes |
| C2 | No signal for 429s / redemptions | **Resolved** | `app/groups/application/join_code.py`: `logger.warning("Join code redeem blocked group_id=%s party_id=%s retry_after_seconds=%s", …)` before re-raising; `_log_redeemed` → `logger.info("Join code redeemed group_id=%s party_id=%s created=%s", …)` on both the idempotent and the created path. The `app` logger is attached to stdout at INFO (`app/main.py:55-58`), so both lines reach `docker compose logs`. |
| C3 | Limiter keys pruned only when revisited | **Residual** (low) | `join_code_limiter.py` is unchanged: pruning happens only in `_wait` for the checked key, with no global sweep. Memory is bounded per key and reset on restart. |
| C4 | Stale SPA tabs hit removed `join-requests` endpoints | **Residual** (low, accepted) | Nothing to fix in code; a reload resolves it |
| C5 | Pre-existing platform gaps | **Residual** (pre-existing, restated) | `/api/health` exists but is liveness-only (`{"status":"UP"}`, no DB check). `docker-compose.yml` has a healthcheck only for `postgres`, none for `backend`. No error tracking (Sentry etc.). |

### B1 checklist: can the code reach any request URL?

| Path | Result | Evidence |
|------|--------|----------|
| Shared link | Clean | `JoinCodeCard.tsx:67` → `${origin}${termPublicPath(group, termId)}#code=${code}`. Browsers send neither the fragment in the request line nor in `Referer`, so nginx `$request` and the uvicorn access log see only `/…/term/{id}`. |
| TermPage handling | Clean | `TermPage.tsx:49` reads `location.hash`. Once access settles, it strips the hash with `navigate({pathname, search}, {replace: true})` for every state except `loginRequired`, where it calls `writePendingCode` (sessionStorage) instead. After login, `readPendingCode` restores the code; storage is cleared on settle. |
| Login / register hrefs | Clean | `AuthGateSheet.tsx:11` `returnTo = encodeURIComponent(location.pathname + location.search)`, with no hash. These are SPA `<Link>`s, so no server request is made anyway. |
| Onboarding returnTo | Clean | `RegisterPage.tsx:21` forwards the received `returnTo` unchanged to `/onboarding`. `OnboardingPage.tsx:48` navigates to it. The source has no hash, so the result has none. |
| LoginPage returnTo | Clean | `LoginPage.tsx:15-23` navigates to `returnTo`; the register link forwards the same value. |
| AuthGuard redirect | Clean | `AuthGuard.tsx:35` `location.pathname + location.search` |
| 401 redirect (`api/client.ts:38-41`) | Clean | `window.location.pathname + window.location.search`; the full-page load carries no hash (see Open Question 2 for the UX side effect) |
| API calls | Clean | `api/groups.ts:474` GET `/groups/{id}/join-code` (the code is in the response body only). `:479` POST `/groups/{id}/join-code/regenerate` (no body). `:485` POST `/groups/public/{groupId}/join-code` with `{ code }` in the JSON body. No call puts the code in a path or query. |
| Other `location.href` / hash readers | Clean | Share URLs (`ShareButton`, `TakeSuccessSheet`, `PanelDataContext`, `ItemTimeline`) are built from `origin` + path. `plugin-sdk/context.ts` reads only the plugin iframe's own hash. `index.html` loads only `/src/main.tsx` (no third-party analytics). |
| nginx | Clean | `src/frontend/nginx.conf` is unchanged vs HEAD. The default `combined` format logs `$request`, which now carries no code. |
| Backend application logs | Clean | `join_code.py` logs only `group_id`, `party_id`, `created`, `retry_after_seconds`; the `code` argument is never interpolated. `errors.py` logs only method + path (integrity/stale) and `exc_info` for unhandled exceptions. `validation_error_handler` returns `error["msg"]` only, never `input`. There is no request-body logging middleware. |
| Tests | Covered | `src/test/TermPage.test.tsx:734-837`: hash stripped after redeem; malformed code stripped; a member's hash stripped without redeem; "#code= survives the login round trip without entering any URL query" asserts `/login?returnTo=PATH` and `/register?returnTo=PATH` with no code, then exactly one redeem and storage cleared; token-change wait. Ran the file in this cycle: 52/53 passed. The one failure is the pre-existing "sign-up footer … login / guest choice" test (an `Imię` label issue), which is listed as pre-existing in `test-suite-results.md`. |

Residual (info, accepted by ADR-005): until access settles, and for the whole `loginRequired` phase, the code stays in the address-bar fragment and in browser history. This is browser-local only.

## Executive Summary
- **Recommendation**: GO with mitigations (cycle 3, final). The mitigations are C3/C5 follow-ups and confirming Open Question 1; none blocks the deploy.
- **Overall Readiness**: 94%
- **Deployment Risk**: Low (no production data, single process, migrations tested, rollback documented)
- **Blockers**: 0  **Concerns**: 3 (C3, C4, C5)  **Recommendations**: 4

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | Ready. No new env vars or secrets (presence-only review; no values read). |
| Monitoring | 80% | Ready with concerns. Redeem/429 audit lines exist; liveness-only health; no error tracking (pre-existing). |
| Resilience | 94% | Ready. Typed 429 + `Retry-After`, idempotent redeem; the code is persisted before the redeem, so a 401 redirect cannot drop it. |
| Performance | 85% | Ready. C3 slow key growth, bounded and reset on restart. |
| Security | 95% | Ready. Code is out of every URL and log; the pending copy now expires after 1h. |
| Deployment | 90% | Ready. Rollback order documented in 0060; C4 stale tabs accepted. |

## Blockers (Must Fix)
None.

## Concerns (Should Fix)

### C3. Limiter keys pruned only when revisited (Performance, low): residual
- `src/backend/app/groups/application/join_code_limiter.py`: `(party, group)` and `group` keys that never come back keep up to 10 or 30 floats each for the process lifetime.
- Recommendation: an occasional sweep in `record_failure` (for example, every N calls drop keys whose newest timestamp is outside the window).

### C4. Stale SPA bundles call removed endpoints (Deployment, low): residual, accepted
- Old tabs' `PendingActionsHost` calls `GET /api/groups/mine/join-requests` and gets errors until reloaded. Cosmetic.

### C5. Pre-existing platform gaps (not introduced by this change): residual
- `GET /api/health` returns a static `{"status":"UP"}` (no DB check). The `backend` compose service has no `healthcheck`, and there is no error tracking. These do not count against this change.

## Recommendations (Nice to Have)
1. Document the 429 / `Retry-After` envelope in `standards/backend/security.md` or `api.md`.
2. Add a `backend` compose healthcheck against `/api/health`, and optionally a DB ping in it.
3. Move the limiter to Postgres or Redis before running more than one uvicorn worker (ADR-003).
4. Standard candidate: "secrets never travel in a URL query or `returnTo`; use the fragment + TTL'd sessionStorage or the POST body, and persist before any 401 redirect can drop them". `TermPage.tsx` is the reference pattern.

## Next Steps
1. Deploy. Use the rollback order in the 0060 docstring if needed.
2. Confirm Open Question 1 (the outer proxy passes 429 + `Retry-After` through).
3. Optional follow-ups: C3 sweep; backend healthcheck (C5); fix the pre-existing `Imię` test at `TermPage.test.tsx:347`.

```yaml
status: "with_concerns"
recommendation: "GO_WITH_MITIGATIONS"
report_path: ".maister/tasks/development/2026-10-21-private-group-join-by-code/verification/production-readiness-report.md"
overall_readiness: 94
deployment_risk: "low"
categories:
  configuration: { score: 100, status: "ready" }
  monitoring: { score: 80, status: "with_concerns" }
  resilience: { score: 94, status: "ready" }
  performance: { score: 85, status: "ready" }
  security: { score: 95, status: "ready" }
  deployment: { score: 90, status: "ready" }
issues:
  - source: "production_readiness"
    severity: "info"
    category: "performance"
    description: "C3 residual: limiter keys not revisited are never evicted"
    location: "src/backend/app/groups/application/join_code_limiter.py"
    fixable: true
    suggestion: "Periodic sweep of expired keys in record_failure"
  - source: "production_readiness"
    severity: "info"
    category: "deployment"
    description: "C4 residual: stale SPA tabs call removed join-requests endpoints until reload"
    location: "removed src/frontend/src/hooks/usePendingJoinRequests.ts"
    fixable: false
    suggestion: "None needed; reload resolves"
  - source: "production_readiness"
    severity: "info"
    category: "monitoring"
    description: "C5 pre-existing: /api/health is liveness-only, no backend compose healthcheck, no error tracking"
    location: "src/backend/app/system/router.py:66; docker-compose.yml"
    fixable: false
    suggestion: "Track separately"
issue_counts:
  critical: 0
  warning: 0
  info: 3
```
