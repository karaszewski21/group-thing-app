# Production Readiness Re-verification

## TL;DR
- **Recommendation: GO.** It was GO WITH MITIGATIONS. Stage 1 (`EMAIL_ENABLED=true`) is now acceptable. Stage 2 still waits for W5 and W6, which are deferred by decision, and for D14.
- Resolved: W1, W2, W3, W7, I1, I2, I4. Partly resolved, with a residual: W4. Deferred: W5, W6.
- New issues: 0 critical and 2 warnings, both small config or runbook items. N1 is the 15 s shutdown wait against Docker's 10 s stop timeout. N2 is the `auth_flows` bucket, which is per proxy IP if a TLS proxy fronts nginx.
- Evidence:
  - `nginx -t` passes on `nginx:1.27-alpine`.
  - `test_email_config` and `test_email_senders` pass (43 tests).
  - `test_email_sending`, `test_email_preferences`, `test_email_flows` and `test_authorization_matrix` pass (163 tests).

## Key Decisions
- I re-checked only the changes the coordinator listed. The original report is unchanged.
- W4 is marked residual, not resolved. The 15 s drain is longer than the default container stop grace of 10 s, and compose does not set `stop_grace_period`.
- N2 is a warning and not a blocker. It matters only if a proxy, load balancer or CDN fronts nginx. `architecture.md:816` already documents the real-IP fix for the older zone, but the e-mail runbook does not repeat it for a 10 r/min zone, where the impact is much larger.

## Open Questions / Risks
- Is there a TLS proxy in front of nginx :5174 on the VPS? If so, add the `set_real_ip_from` lines before stage 1. Otherwise all users share one 10 r/min bucket for reset, verify, lookup and unsubscribe (N2).
- The nginx error log still prints the full request line, `?token=` included, when an upstream call fails. This is documented as accepted in `architecture.md:681`. The exposure is limited to the moments when web or backend is down.
- Whether Mailgun re-signs a webhook on each retry is still unconfirmed (from the original report).

**Date**: 2026-11-27 · **Target**: production · **Status**: Ready (stage 1)

## Per-finding status
| ID | Original | Status | Evidence |
|---|---|---|---|
| W1 tokens in access logs | warning | **Resolved** | nginx: an http-level `log_format token_safe` logs `$request_method $loggable_uri`, where `$uri` carries no query. A `map` masks `/api/email/unsubscribe/` as `[redacted]`, and the referer is not logged. A server-level `access_log … token_safe` replaces the image's `main` log, and no location overrides it. Backend: `app/core/access_log.py::TokenRedactingFilter` rewrites the record args and message (the unsubscribe path, `token=` and `_token=`). The lifespan installs it on `uvicorn.access` once, idempotently. Tested in `test_email_config.py`. Residual: the nginx error log on upstream failure (accepted, documented). |
| W2 no HTTP rate limit | warning | **Resolved** (see N2) | The `auth_flows` zone runs at 10 r/m with burst 5 `nodelay` and returns the 429 JSON envelope. It covers the exact regex of the 5 auth token routes and the `/api/email/unsubscribe/` prefix (GET and POST). The webhook stays unlimited on `/api/`. `confirm_password_reset` now claims the token before hashing, so an unknown token costs no bcrypt, and runs the hash in `asyncio.to_thread`. The claim and the password write share one transaction, so a failure rolls the claim back. `check_password_length` enforces 72 bytes on the reset schema. `nginx -t` OK. |
| W3 Mailgun 401/403 permanent | warning | **Resolved** | `_RETRYABLE_CLIENT_STATUSES = {401, 403, 404, 429}`. `_log_credential_error` logs one ERROR per run: `provider rejected credentials or domain (code=…)`. Rows still end FAILED after 6 attempts (about 5 h of backoff); a reset token expires earlier anyway, after 1 h. The runbook greps were extended. |
| W4 shutdown loses in-flight mail | warning | **Residual** (N1) | The send job now records `_email_send_in_flight`. On shutdown the lifespan pauses the scheduler and runs `_finish_email_send(15.0)` (`asyncio.wait`, no cancel) before `shutdown(wait=False)`. Correct, but compose has no `stop_grace_period`, so Docker SIGKILLs at 10 s. |
| W5 retention | warning | **Deferred** (by decision) | Prerequisite for stage 2 / D14. |
| W6 alerting | warning | **Deferred** (by decision) | The runbook now adds a `SELECT last_error, count(*) … WHERE status='FAILED'` check, which helps manual detection. |
| W7 GET on List-Unsubscribe | warning | **Resolved** | `GET /api/email/unsubscribe/{token}` returns a 303 to `{APP_PUBLIC_BASE_URL}/unsubscribe?token=<quoted>`. It has no side effects and sends `no-store` and `no-referrer`. The Location comes from config, not from the Host header, so it is no open redirect. Matrix row 78 is GET+POST PUBLIC, covered by the passing matrix tests. |
| I1 localhost base URL | info | **Resolved** | `_LOCAL_BASE_URL.fullmatch` accepts `http://(localhost\|127.0.0.1)(:port)?(/…)?` only, so `http://localhost.evil.tld` is rejected. |
| I2 password bounds | info | **Resolved** (max) / residual (min) | The 72-byte max is enforced. There is still no minimum length; this predates the feature and is a product decision. |
| I4 runbook greps | info | **Resolved** | Step 5 greps `FAILED after\|FAILED: (stuck_sending\|http_401\|http_403\|http_404)\|provider rejected credentials`. It also checks frontend logs for the absence of `?token=`, a 429 after more than 6 reset requests, and the 303 on GET. |
| I3, I5, I6 | info | Unchanged | They were not in the fix list. |

## New issues
- **N1 — warning, resilience, fixable.**
  - Location: `docker-compose.yml` (backend service) and `app/main.py` (`_EMAIL_SEND_SHUTDOWN_WAIT_SECONDS = 15.0`).
  - Issue: on `docker compose up -d backend` or `stop`, Docker sends SIGKILL after 10 s by default. uvicorn first drains connections and only then runs the lifespan shutdown, so the 15 s drain is cut short. The batch's outcome write may never happen. Impact stays low because sends are usually sub-second, and recovery is the documented 10-minute `stuck_sending`.
  - Suggestion: set `stop_grace_period: 25s` on the backend service, or lower the drain to 8 s.
- **N2 — warning, security/availability, fixable.**
  - Location: `src/frontend/nginx.conf` (`auth_flows` keyed on `$binary_remote_addr`) and the runbook §"Deploy / rollback for e-mail".
  - Issue: behind a TLS proxy, load balancer or CDN, every visitor shares the proxy's single 10 r/min bucket. Password reset, verification and unsubscribe would then fail with 429 for everyone under modest load. Without such a proxy it is fine. CGNAT users share a bucket too, which is acceptable at 10/min with burst 5.
  - Suggestion: add to runbook step 4 the `set_real_ip_from <proxy CIDR>; real_ip_header X-Forwarded-For; real_ip_recursive on;` check from `architecture.md:816`, or confirm that no proxy fronts nginx.

## Next Steps
1. Before stage 1: confirm whether a TLS proxy fronts nginx and apply N2 if so. Add `stop_grace_period` (N1).
2. Proceed with runbook steps 4–5, including the new log and 429 checks.
3. Before stage 2: W5 (retention in D14 plus a purge job) and W6 (persistent logs plus a failure alert).
