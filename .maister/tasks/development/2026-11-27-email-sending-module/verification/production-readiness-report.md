# Production Readiness Report

## TL;DR
- **Recommendation: GO WITH MITIGATIONS.** You can deploy migrations 0110–0112 and the images with `EMAIL_ENABLED=false` now. Fix W1 before stage 1 (`EMAIL_ENABLED=true`).
- 0 blockers, 7 concerns (warning), 6 info. Deployment risk: **Medium**. Overall readiness: ~80 %.
- The config, fail-fast startup, kill switches, the runbook, token and address hygiene in the app's own log lines, and the webhook signature handling are solid.
- Main gaps are in the infrastructure around the code. Reset and verify tokens end up in the nginx and uvicorn access logs (W1). No HTTP rate limit covers the new PUBLIC POSTs (W2). A wrong Mailgun key fails every queued mail permanently (W3).

## Key Decisions
- Bell mail switching on (stage 2) and the webhook replay memory are treated as already accepted by the spec (single backend instance, D12 "no HTTP rate limit", no purge). They are reported as concerns, not blockers.
- The missing HTTP rate limit (checklist: blocker) is downgraded to a warning for three reasons. The spec explicitly puts it out of scope (D12). Mail-sending routes have a per-account DB limit (1/60 s, 5/h). The same bcrypt-per-request exposure already exists on `POST /api/auth/login`.
- No Sentry or metrics stack exists project-wide. This is not a new gap introduced by this feature, so it is a concern and not a blocker.
- Unrelated search changes in the working tree were excluded.

## Open Questions / Risks
- Does Mailgun re-sign a webhook on each retry? If not, every retry after a failed first delivery is rejected as `stale` (5 min skew). The runbook covers this by having the operator check Mailgun's event log after an outage. Confirm the behaviour during the stage-1 seed test.
- External TLS termination in front of nginx :5174, and the host-published backend port `8080:8080`, are outside this feature. The webhook and unsubscribe URLs assume `https://<app>`.
- D14 privacy policy and the Mailgun DPA are prerequisites outside the code (stage 0). Retention of `email_messages.payload.message` (bell text) and `account_tokens.email` (address snapshots) is unbounded (W5).

**Date**: 2026-11-27
**Path**: `src/backend/app/email/`, `src/backend/app/auth/account_tokens.py` + router, `app/config.py`, `app/main.py`, migrations 0110–0112, `docker-compose.yml`, `.env.example`, `src/frontend/nginx.conf`, `architecture.md` runbook
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: ~80 %
- **Deployment Risk**: Medium
- **Blockers**: 0  Concerns: 7  Recommendations: 6

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95 % | Ready: names-only `.env.example`, compose passthrough with safe defaults, blank-is-unset validator, fail-fast `_check_email_settings` naming variables only |
| Monitoring | 65 % | With concerns: good INFO/ERROR lines (`app` logger at INFO), but no alerting or error tracking; detection depends on `grep "FAILED after"` and logs reset on container recreate |
| Resilience | 80 % | With concerns: retry/backoff, permanent vs retryable, per-send `wait_for` 10 s, stuck recovery, job never re-raises; a shutdown mid-batch turns transactional rows FAILED, and a 401/403 from Mailgun is permanent |
| Performance | 85 % | Ready: batch of 50, constant statement count, partial indexes on pending/sending, `sent_at` index, `max_instances=1`, `SKIP LOCKED` |
| Security | 70 % | With concerns: HMAC webhook with `compare_digest` + skew + replay memory, hashed single-use tokens, autoescaped Jinja, `no-referrer`, no-store; tokens leak via access logs, no HTTP rate limit |
| Deployment | 90 % | Ready: staged rollout, kill switches, `lock_timeout`, lossy-downgrade runbook, dump first, slug-collision check, DNS/DMARC ramp, presence-only checks |

## What Was Verified (passes)
- **Config** (`app/config.py`): every e-mail variable is optional with a default. The `mode="before"` validator turns blank compose placeholders into defaults or `None`. `email_configuration_errors` returns variable **names** only and covers each backend: mailgun needs an https API URL, a key and a webhook key; smtp needs a host; the link secret must be at least 32 characters; the base URL must be https or http://localhost.
- **Fail-fast** (`app/main.py::_check_email_settings`): it runs second in the lifespan, right after `clock.check_timezone()` and before the DB contract checks. It raises `RuntimeError` listing the names and logs `EMAIL_ENABLED=… EMAIL_NOTIFICATIONS_ENABLED=… EMAIL_BACKEND=…`. It WARNs when the flag is on and the backend is not mailgun. The sender and the job are wired only while `EMAIL_ENABLED=true`, and `set_sender(None)` runs on shutdown.
- **Compose**: `EMAIL_ENABLED`/`EMAIL_NOTIFICATIONS_ENABLED` default `false`. Mailpit is pinned (`axllent/mailpit:v1.27.10`), runs only under `profiles: ["dev"]`, keeps SMTP on the compose network only and binds its UI to 127.0.0.1.
- **`.env.example`**: names with empty values plus documentation. No secrets in tracked files.
- **Logging lines**:
  - `email send: claimed=… sent=… skipped=… retried=… failed=… expired=… recovered=…` (INFO when anything happened, DEBUG otherwise).
  - `email message <id> FAILED after N attempts: <code>` and `… FAILED: stuck_sending` (ERROR).
  - `email daily cap of N reached` (WARNING, once per run).
  - `email webhook rejected: reason=not_configured|bad_signature|stale|replay` (INFO).
  - `email webhook lost a race` (WARNING) and `email webhook processing failed` (exception).
  - None of these carry an address, token, subject or body. `last_error` holds short codes only.
- **Error handling**: Mailgun 2xx means sent. 4xx other than 429 is permanent. 429 and 5xx are retryable. Timeout and transport errors are retryable. Backoff is 1/5/15/60/240 min with 6 attempts, then FAILED with an ERROR line. The job catches `TRANSACTION_CONFLICTS` as a WARNING and everything else with `logger.exception`. Outcomes are written only `WHERE status='SENDING'`. Tokens are removed from `payload` at every final state.
- **Webhook**: answers 400 for a non-object body, 401 with an empty body for any rejection, 503 on processing failure (Mailgun retries), and 200 `{}` for unknown messages. The replay token is recorded only after commit. Status ranking never lowers a status. COMPLAINT suppresses the address and disables the category.
- **nginx**: `/api/email/*` and `/api/auth/*` fall under `location /api/` → `proxy_pass http://backend:8080` with no redirect or rewrite, so POST bodies pass through, including the RFC 8058 one-click form body. `client_max_body_size 16m` bounds the webhook body.
- **Privacy**: `email_messages` stores no address. The address is bound late from `user_profiles` at send time. Raw tokens are stored only as SHA-256 in `account_tokens`; the raw token lives in `payload` until a final state removes it. The three token pages set `referrer: no-referrer`. Account-token replies carry `Cache-Control: no-store`. Forgot-password always answers 202.
- **Runbook** (`architecture.md` §"Deploy / rollback for e-mail (migrations 0110–0112)"):
  - Stages 0/1/2, kill switches first, a `pg_dump` first, and the slug-collision query.
  - It states there is no image-only rollback past 0110, and documents the lossy, unguarded `downgrade 0109` from the new image.
  - DNS: EU-region domain, SPF, DKIM 2048, MX, DMARC `p=none` → quarantine → reject. Webhooks for delivered/failed/complained.
  - Presence-only variable checks, plus the verify steps (startup line, send line, `FAILED after`, seed test spf/dkim/dmarc=pass, DELIVERED statuses, POST passthrough).
  - Mailgun-side suppressions and the COMPLAINT lift by support.
- **Tests** (`verification/test-suite-results.md`): every `test_email_*` and `test_account_tokens` test passes. The migration downgrade-then-upgrade tests exist (`tests/test_email_migrations.py`). No new regressions.
- **Dependencies**: only `jinja2>=3.1.6` is added, at a version with the 2024–2025 sandbox CVEs fixed. Templates are file-based and not user-supplied, and HTML is autoescaped with `StrictUndefined`.

## Blockers (Must Fix)
None.

## Concerns (Should Fix)

### W1 — Account and unsubscribe tokens are written to access logs (security, warning)
- **Location**:
  - The nginx `frontend` service (`src/frontend/nginx.conf`) uses the default `access_log`, which logs `$request`.
  - The uvicorn CMD in `docker-compose.yml:28` and `src/backend/Dockerfile:84/98` leaves the access log on (the default).
- **Issue**: the mailed links are `/reset-password?token=…`, `/verify-email?token=…` and `/unsubscribe?token=…`. A click is a GET through nginx, and nginx logs the full query string. The frontend then POSTs the unsubscribe token in the backend path `/api/email/unsubscribe/<token>`, and uvicorn's access log writes that path, including the party id. A reset token is valid for 1 h and grants a password change, so anyone who can read `docker compose logs` in that window can take over the account. This contradicts success criterion 4 ("No log line … contains … token") at the infrastructure level.
- **Fixable**: true.
- **Suggestion**:
  - In nginx, add a `log_format` that logs `$uri` instead of `$request`, or set `access_log off` / a `map`-based conditional for `^/(reset-password|verify-email|unsubscribe)` and `^/api/email/unsubscribe/`.
  - Run uvicorn with `--no-access-log`, or add a logging filter that masks `/api/email/unsubscribe/…`.
  - Do this before stage 1.

### W2 — No HTTP rate limit on the new PUBLIC POSTs (security / performance, warning)
- **Location**: `src/frontend/nginx.conf` limits only `/api/public/search` and `/api/categories`. The new PUBLIC rows 74–76 and 78–79 plus row 82 have no limit.
- **Issue**: `POST /api/auth/password-reset/confirm` runs a synchronous bcrypt `hash_password` **before** the token is claimed (`account_tokens.confirm_password_reset`). So any garbage token costs one bcrypt on the single uvicorn worker's event loop, which also stalls APScheduler and the outbox poller. Forgot-password requests are bounded only per account (5/h), so an attacker can trigger up to 5 reset mails per hour per known address. Those mails are not covered by `EMAIL_DAILY_CAP`, which holds back only NOTIFICATION mail, so they spend Mailgun quota and sender reputation. The spec accepts this (D12), and `/api/auth/login` already has the same bcrypt exposure.
- **Fixable**: true.
- **Suggestion**:
  - Add a `limit_req zone=auth_flows` (for example 1–2 r/s with a small burst, per address) on `location ~ ^/api/auth/` and `^/api/email/unsubscribe/`, reusing `@too_many_requests`.
  - Optionally claim or look up the token before hashing, and run bcrypt in `asyncio.to_thread`.

### W3 — A Mailgun 401/403 (bad or rotated key, wrong region URL) fails every queued mail permanently (resilience, warning)
- **Location**: `src/backend/app/email/senders.py::MailgunSender.send`. Any 4xx other than 429 raises `PermanentSendError`.
- **Issue**: a configuration error is not a per-message rejection. With a wrong key or a US-region URL, each claimed row, transactional ones included, goes straight to FAILED with no retry. Reset links are lost until users ask again. The ERROR lines show `http_401`, but nothing re-queues the rows.
- **Fixable**: true.
- **Suggestion**:
  - Treat 401/403/404 (auth, domain or URL problems) as retryable, or as a "stop the batch" condition with one ERROR line.
  - Operationally, run the seed test right after the flag flip (runbook step 5) and keep `EMAIL_ENABLED=false` until it passes.

### W4 — Graceful shutdown cancels an in-flight batch, and transactional rows then fail as `stuck_sending` (resilience, warning)
- **Location**: `app/main.py` lifespan, `_term_end_scheduler.shutdown(wait=False)`, together with `sending._recover_stuck`.
- **Issue**: every flag change in the runbook is a `docker compose up -d backend` (container recreate). A batch caught between claim and result write leaves rows SENDING. After 10 min, NOTIFICATION rows are re-queued, but TRANSACTIONAL rows go to FAILED (by design, ADR-004), so a reset or verify mail is silently lost. The window is small, since sends take well under 1 s, but it opens on every deploy.
- **Fixable**: true.
- **Suggestion**:
  - Let the running send job finish within the container stop grace period, for example by awaiting the current job with a bound of about 10 s before `shutdown`.
  - Or document "check `FAILED: stuck_sending` after a recreate" in the runbook verify step.

### W5 — Unbounded retention of personal data (privacy / deployment, warning)
- **Location**: `email_messages.payload.message` (bell text, which can name other users), `email_messages` rows in general, and `account_tokens.email` (address snapshots). See migration 0110.
- **Issue**: "Purging `email_messages`/`account_tokens`" is out of scope, so both tables grow forever and keep address snapshots and message text indefinitely. Party ids have no ON DELETE rule. This is relevant to the D14 privacy policy (GDPR storage limitation) before stage 2.
- **Fixable**: false (policy decision plus a follow-up job).
- **Suggestion**: state a retention period in D14. Add a follow-up purge job, for example deleting final-state `email_messages` after 90 days and used or expired `account_tokens` after 30 days. Track it as a stage-2 prerequisite.

### W6 — No alerting or error tracking for mail failures (monitoring, warning)
- **Location**: project-wide. There is no Sentry or metrics stack, and `/api/health` does not reflect the send job.
- **Issue**: detection depends on someone running `grep "FAILED after"` weekly, and the container logs reset on recreate, which every flag flip in the runbook does. A stalled job (for example a scheduler failure) would show nothing.
- **Fixable**: false (infrastructure).
- **Suggestion**:
  - At minimum, ship container logs to persistent storage (the json-file driver with rotation, or journald) so a recreate does not erase them.
  - Add a cron/SQL check, for example `SELECT count(*) FROM email_messages WHERE status IN ('FAILED') AND updated_at > now() - interval '1 day'` and `status='PENDING' AND send_after < now() - interval '15 min'`, and alert on non-zero.

### W7 — `List-Unsubscribe` URL answers only POST (deliverability / UX, warning)
- **Location**: `senders.build_headers` produces `<{base}/api/email/unsubscribe/{token}>`, and `router.unsubscribe` is POST-only.
- **Issue**: Gmail and Yahoo use the one-click POST. Clients without RFC 8058 support open the https URL with a GET. That GET falls through to the catch-all matrix row and returns a 401/404 JSON instead of a page, so the unsubscribe looks broken to some recipients.
- **Fixable**: true.
- **Suggestion**: add `GET /api/email/unsubscribe/{token}` returning a 302 to `/unsubscribe?token=…` (with no side effect), with a matching PUBLIC GET matrix row. Alternatively, point the header at a URL that Next serves for GET and nginx proxies to the backend for POST.

## Recommendations (Nice to Have)
- **I1** (security, `config.py`): `APP_PUBLIC_BASE_URL` accepts `http://localhost…`, and the prefix check also admits `http://localhost.example.com`. Consider rejecting non-https whenever `EMAIL_BACKEND=mailgun`. Fixable: true.
- **I2** (security, `auth/router.py`): the reset password accepts length 1. A password longer than 72 bytes makes bcrypt 5.0 raise `ValueError`, which becomes a 500, and the token stays unused. The same holds for registration (pre-existing). Add `max_length` (72 bytes) and a sensible minimum on both stacks. Fixable: true.
- **I3** (resilience, `webhooks.py`): the replay memory is per process. This is fine for the single worker, but document "do not scale to more than one uvicorn worker or replica without moving it to the DB" next to the existing single-instance note. Fixable: true.
- **I4** (monitoring, runbook): add `stuck_sending` and `http_401` to the grep list in step 5. Fixable: true.
- **I5** (resilience): no circuit breaker towards Mailgun. During an outage, each batch of 50 makes 50 calls of up to 10 s each, and the batch stays within the 10-minute stuck window. Acceptable at this scale; optionally stop the batch after N consecutive retryable errors. Fixable: true.
- **I6** (deployment, `docker-compose.yml`): the backend has no restart policy (pre-existing), so a fail-fast start or a `lock_timeout` leaves it down until an operator acts. The runbook documents this, but consider `restart: on-failure:3` once the startup checks are trusted. Fixable: true.

## Next Steps
1. Before stage 1: fix **W1** (strip tokens from the nginx and uvicorn access logs). Add the **W2** nginx `limit_req` for `/api/auth/` and `/api/email/unsubscribe/`.
2. Deploy 0110–0112 with `EMAIL_ENABLED=false` per the runbook: dump, slug check, `alembic current` = `0112 (head)`.
3. Set up Mailgun EU, DNS and webhooks. Check the variables by presence only. Flip `EMAIL_ENABLED=true` and run the seed test at once (this mitigates **W3**). Watch for `FAILED:` and `http_4xx`.
4. Address **W3**/**W4** in a follow-up: treat 401/403 as retryable, and drain the job on shutdown.
5. Before stage 2: publish D14 with a retention period (**W5**), add the persistent logs and failure query (**W6**), fix the GET on `List-Unsubscribe` (**W7**), and run at least 1 clean week (bounce < 2 %, no complaints).
