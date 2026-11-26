# Production Readiness Report (re-verification 1)

## TL;DR
- **GO WITH MITIGATIONS**, unchanged. Deploy with both client IDs empty (the feature is inert). Enable Google sign-in only after D14 and https.
- **All five targeted findings are resolved:** W1 JWKS backoff and grace, W6 outcome logs, W7 runbook, I11 0107 downgrade `lock_timeout`, I9 whitespace client ID.
- **No code blockers. No regressions.** Backend 1792/1794 and frontend 2084/2117 pass; every failure is a HEAD baseline failure or a known flake.
- **Residual items** are deferred or operator tasks: D12 rate limit, D13 CSP/COOP, D14 prerequisites, Cloud Console origins, the production `.env` check and pip-audit.

**Date**: 2026-11-25
**Path**: uncommitted working tree on `feature/global-search-group-description` (Google sign-in / sign-up; `git diff --stat`: 31 tracked files, plus the untracked new files)
**Target**: production
**Status**: With Concerns (deferred and operator items only)

## Key Decisions
- **Deploying and enabling are judged separately**, as in the first pass. With both IDs empty, both routes return 503 and the button is hidden, so the deploy carries low risk. D14 and TLS gate only the *enabling* step.
- **Deferred items stay warnings, not blockers.** The spec defers D12 and D13. To create an account, a Google-signed ID token is required, and the nonce route does no database work. `/api/auth/login` and `/api/auth/register` have no rate limit either; that gap predates this change.
- **Operator tasks are listed as residual.** They are not code defects, so they do not count against the code score. They do have to be done before enabling.

## Open Questions / Risks
- **Rollback after the first Google-only account** is still a restore or the kill switch; there is no schema rollback. The runbook now puts the kill switch first and warns that a dump restore loses every write made after the dump.
- **Key rotation during a Google outage.** If Google rotates to a new `kid` while the JWKS endpoint is down, tokens signed with the new key get a 503 until a fetch succeeds. The 60 s backoff limits retries to one per minute. This is correct fail-closed behaviour.
- **The production `.env` and TLS termination** in front of nginx :5174 are outside the repo and were not verified (presence-only checks are needed on the VPS).
- **The frontend does not trim `NEXT_PUBLIC_GOOGLE_CLIENT_ID`** (see I-new below). It fails safe when the value is whitespace only.

## Executive Summary
- **Recommendation**: GO with mitigations (deploy with the feature off; enable after D14, https, the Cloud Console origins and the `.env` check)
- **Overall Readiness**: 90% (was 85%)
- **Deployment Risk**: Low with the feature off; Low–Medium once enabled (was Medium)
- **Counts**: Blockers 0, Concerns 2 (both deferred), Recommendations 6 (operator or deferred items plus one new info)

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 97% | Ready (I9 resolved; production `.env` is operator-verified) |
| Monitoring | 85% | Ready for this scope (W6 resolved; no project-wide metrics or error tracking) |
| Resilience | 95% | Ready (W1 resolved) |
| Performance | 85% | Ready (timeouts set; rate limit deferred, D12) |
| Security | 85% | With concerns (D12 and D13 deferred; pip-audit not run) |
| Deployment | 92% | Ready (W7 and I11 resolved; restore-only rollback is inherent) |

## Re-check of previous findings

| ID | Finding | Verdict | Evidence |
|----|---------|---------|----------|
| W1 | JWKS: no stale-on-error, no failure backoff | **Resolved** | See "W1 detail" below |
| W6 | No outcome or security-event logging | **Resolved** | See "W6 detail" below |
| W7 | Runbook: kill switch and lossy restore | **Resolved** | See "W7 detail" below |
| I11 | 0107 downgrade has no `lock_timeout` | **Resolved** | `0107_user_identities.py` `downgrade()` runs `SET LOCAL lock_timeout = '5s'` before `drop_table`; the runbook preamble states this |
| I9 | A whitespace client ID counts as configured | **Resolved (backend)** | `config.py` has a `mode="before"` `_strip_google_client_id` validator, so `google_login_configured` is `bool(stripped)`. The test `test_settings_googleLoginConfigured_followsClientId` is parametrised with `None`, `""` and `"  \t "` → False, and `"id"` → True. The frontend counterpart is I-new |
| D12 | No rate limit on the Google routes | **Residual (deferred)** | `src/frontend/nginx.conf` has only the `public_reads` zone. No `location` exists for `/api/auth/google*`, `/login` or `/register` |
| D13 | CSP/COOP not set | **Residual (deferred)** | No `Content-Security-Policy` or `Cross-Origin-Opener-Policy` in `next.config.ts` or `nginx.conf` |
| D14 | Production prerequisites | **Residual (operator, deferred)** | A domain with TLS, a privacy policy and homepage, and Google brand verification. Runbook step 7 lists them |
| — | Cloud Console Authorised JavaScript origins | **Residual (operator)** | Not verifiable from the repo |
| — | Production `.env` presence check | **Residual (operator)** | Not verified. Presence checks only: `grep -c '^GOOGLE_CLIENT_ID=.' .env`, the same for `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and `AUTH_COOKIE_SECURE` unset or `true` |
| — | pip-audit on `uv.lock` | **Residual (operator)** | Not run; the tool is not part of the project tooling. `cryptography 50.0.2` and `cffi 2.1.1` are new native dependencies |
| — | No error tracking or metrics anywhere | **Residual (info, project-wide)** | Unchanged and not counted against this change |
| — | Web image must not lead the backend | **Covered** | Runbook step 2 |

### W1 detail
`src/backend/app/auth/google.py` adds `FAILURE_BACKOFF_SECONDS = 60` and `JWKS_GRACE_SECONDS = 24 h`.

- **Recording failures**: `_refresh` records `_failed_at` and logs a WARNING that names only the exception type. A successful fetch clears `_failed_at`.
- **Backoff**: within 60 s of a failure, `_key_for` makes no new fetch. It answers through `_grace_key`, so requests queued behind the lock no longer each wait 5 s.
- **Grace**: after a failed refresh, `_grace_key` serves the last key set for up to 24 h past `_expires_at`. After that, or for an unknown `kid`, it raises `GoogleKeysUnavailable` (503), so it still fails closed.
- **Tests** in `tests/test_google_token_verifier.py`: `failureWithinBackoff_doesNotRefetch`, `expiredKeysAfterFailedRefresh_verifyWithinGrace` and `expiredKeysPastGrace_raisesKeysUnavailable`.

### W6 detail
`app/auth/router.py` now writes INFO lines with no email, subject or credential:

- `google sign-in ok: created=<bool>`
- `rejected: reason=email_unverified` (403)
- `rejected: reason=email_taken` (409)
- the existing reason codes for 401

A parametrised test in `tests/test_google_login.py` checks the lines for the unverified, email_taken and created cases.

### W7 detail
In `architecture.md`, the section "Deploy / rollback for Google sign-in" now opens with a "Kill switch first" paragraph, before the numbered steps. It says to empty both IDs, rebuild `web` and restart the backend. Both routes then return 503, and password login keeps working.

Step 6 states that a restore loses every write made since the dump (items, reservations, messages, password accounts and points) and says to prefer the kill switch. Step 1 also notes that a local uvicorn run reads `src/backend/.env`.

## Verified (unchanged since the first pass, spot-checked)
- **Feature gate**: with both IDs unset, both routes return 503. The nonce route sends `Cache-Control: no-store`.
- **Cookie**: the nonce cookie is HttpOnly, `SameSite=Lax`, has path `/api/auth/google` and expires after 600 s. `Secure` comes from `settings.auth_cookie_secure` (default true). The cookie is cleared on every sign-in response.
- **Token checks**: RS256 only, with `iss`, `aud`, `azp`, `exp`, `iat` and `nonce` checked, and a constant-time nonce compare. The JWKS client has a 5 s timeout.
- **Migrations**: 0107 and 0108 use a 5 s `lock_timeout` on both upgrade and downgrade. The 0108 downgrade is guarded, and round-trip and refusal tests exist.
- **Dependencies**: `pyjwt[crypto]`, locked; the Dockerfile uses `uv sync --frozen`.
- **Health**: `/api/health` does not depend on Google.
- **Test suite** (`test-suite-results.md`): no regressions. mypy 15 and tsc 0 are at baseline, ruff dropped from 65 to 64, and ESLint (10 errors, 28 warnings) is at baseline.

## Blockers (Must Fix)
None for deploying with the feature off.

**Before enabling in production** (not code): D14 plus TLS, the Cloud Console origin and the `.env` presence check. Without https, the `Secure` nonce cookie is dropped and GIS refuses the origin.

## Concerns (Should Fix)
1. **[warning] No rate limit on the Google routes (D12, deferred, residual)**
   - Location: `src/frontend/nginx.conf`; `/api/auth/google`, `/api/auth/google/nonce`
   - Fixable: yes
   - Suggestion: add a dedicated `limit_req_zone` and `location =` blocks for `/api/auth/google` and `/api/auth/google/nonce`, with `limit_req_status 429`, following the `public_reads` pattern. Cover `/api/auth/login` and `/api/auth/register` at the same time.
2. **[warning] CSP/COOP not set (D13, deferred, residual)**
   - Location: frontend headers (`next.config.ts` / `nginx.conf`)
   - Fixable: yes
   - Suggestion: when a CSP is introduced, allow `https://accounts.google.com/gsi/` for script, frame, connect and style. Use `Cross-Origin-Opener-Policy: same-origin-allow-popups`; `same-origin` would break the popup UX mode.

## Recommendations (Nice to Have)
1. **[info] D14 production prerequisites (operator, deferred, residual)**
   - Location: outside the repo (domain, TLS, privacy policy, Google brand verification)
   - Fixable: no (not code)
   - Suggestion: finish these before setting the client IDs in production.
2. **[info] Cloud Console Authorised JavaScript origins (operator, residual)**
   - Location: Google Cloud Console, OAuth Web client
   - Fixable: no (not code)
   - Suggestion: list the exact production https origin. No redirect URI is needed.
3. **[info] Production `.env` presence check (operator, residual)**
   - Location: VPS root `.env`
   - Fixable: yes
   - Suggestion: run presence-only `grep -c` checks for both IDs. Confirm `AUTH_COOKIE_SECURE` is unset or `true`. Then rebuild `web` and restart the backend. Never print the values.
4. **[info] pip-audit not run (operator, residual)**
   - Location: `src/backend/uv.lock`
   - Fixable: yes
   - Suggestion: run `uvx pip-audit` against an export of the lock (`uv export --frozen`) before release.
5. **[info] No error tracking or metrics (project-wide, residual)**
   - Location: project-wide
   - Fixable: no (an infrastructure decision)
   - Suggestion: when added, alert on bursts of `google jwks fetch failed` and on spikes in `google sign-in rejected`.
6. **[info] I-new: the frontend does not trim `NEXT_PUBLIC_GOOGLE_CLIENT_ID`**
   - Location: `src/frontend/src/lib/googleIdentity.ts:46`, `src/frontend/src/features/auth/useGoogleSignIn.ts:176`
   - Fixable: yes
   - Problem: a whitespace-only value counts as configured on the frontend. It fails safe, because the backend treats it as unset and the nonce 503 hides the button. A value with padding would reach GIS untrimmed, while the backend compares `aud` against the trimmed value.
   - Suggestion: `.trim()` the value in both places, or rely on the `.env` check (step 3) catching it.

## Next Steps
1. **Deploy** backend and web together with both client IDs empty, following the 0107–0108 runbook: dump first, confirm `alembic current` = `0108 (head)`, run the guard count.
2. **Operator tasks before enabling**: D14 (domain and TLS, privacy policy, brand verification), the Cloud Console origin, pip-audit and the presence-only `.env` check.
3. **Follow-ups**: D12 nginx `limit_req` for the auth routes; D13 CSP and COOP `same-origin-allow-popups` when a CSP lands.
4. **Enable**: set both IDs, rebuild `web`, restart the backend, then smoke-test sign-in and sign-up on the https origin, including Safari. To back out, use the kill switch.
