# Code Review Re-verification

**Date**: 2026-11-27
**Scope**: Only the code changed since the first pass (`code-review-report.md`): app/auth/{account_tokens,router}.py, app/users/schemas.py, app/email/{senders,sending,links,webhooks,router,rules}.py, app/core/access_log.py, app/config.py, app/main.py, app/core/authorization_matrix.py row 78, frontend src/api/{client,auth}.ts, plus the related tests (read, not run).
**Status**: ⚠️ Issues Found (no critical, no regressions found)

## TL;DR
- Both warnings are resolved. W1: 72-byte limit with a Polish 400, the claim before the hash, bcrypt in `to_thread`. W2: 401/403/404 retry, with one ERROR per run.
- I1, I2, I3, I5, I8 (bounded) and I15 are resolved. I7 is only partly done: the replay-memory prune is still a full scan.
- New code (access-log redaction, GET unsubscribe 303, graceful send finish, `normalize_address`) has no security regression.
- One new warning: the 15 s shutdown wait is shorter than a full batch (up to 50 × 10 s), so a restart mid-batch can still leave TRANSACTIONAL mail that was never sent marked `stuck_sending`.

## Key Decisions
- Login (`LoginRequest.password`, auth/router.py:72) still has no 72-byte limit. It predates this task, so it is listed as residual info, not a regression.

## Open Questions / Risks
- Tokens in `/reset-password?token=` and `/verify-email?token=` are served by Next/nginx. The uvicorn filter does not cover those logs.
- A Mailgun webhook body over 64 KiB now gets a 400, and Mailgun retries non-2xx replies, so such an event would be retried and then dropped. Real event payloads are far smaller.

## Summary
- **Critical**: 0
- **Warnings**: 1 (new)
- **Info**: 5 (2 residual from the first pass, 3 new)

## Earlier findings

| ID | Status | Evidence |
|----|--------|----------|
| W1 password over 72 bytes → 500; bcrypt on the loop before the claim | **Resolved** | `users/schemas.py` `check_password_length` (UTF-8 bytes, `PydanticCustomError` → the project's 400) on `RegisterRequest` and `PasswordResetConfirmRequest` (auth/router.py:253-256). `account_tokens.py:303-304` claims first, then `await asyncio.to_thread(hash_password, …)`. The row lock is held only during the hash (~250 ms, acceptable). |
| W2 Mailgun 401/403 permanent | **Resolved** | `senders.py:30-33` makes `{401, 403, 404, 429}` retryable. `sending.py:524-532` `_log_credential_error` logs one ERROR per run naming only the code and variable names. Retries end after MAX_ATTEMPTS (~5.3 h of backoff); reset mails expire after 1 h anyway. |
| I1 cap log wording | **Resolved** | sending.py:296 "further notification mail is skipped". |
| I2 link_path host change | **Resolved** | `sending._app_path` (sending.py:388-391) keeps only strings starting with `/`. `//x` is then a path on the app host, because `base_url` is prepended. |
| I3 non-canonical UUID | **Resolved** | links.py: `str(party_id) != raw_party_id` → None, HMAC over `raw_party_id`. |
| I4 reset timing oracle | Open (accepted) | Unchanged, by design. |
| I5 reset doesn't lift BOUNCE | **Resolved** | account_tokens.py:321-325 lifts the BOUNCE when the snapshot matches, alongside the verification. |
| I6 snapshot re-check on future email writer | Open (deferred) | Unchanged. |
| I7 replay memory O(n) prune | **Residual** (info) | webhooks.py:80-82 still scans every entry. `_utcnow` is inlined (149). |
| I8 unbounded webhook body | **Resolved (partly)** | webhooks.py:46, 104: >64 KiB → 400 before `json.loads`. The body is still read fully into memory first (router `await request.body()`), so nginx `client_max_body_size` is still the real bound. |
| I9 event_at out of order | Open | Unchanged. |
| I10 httpx client per send | Open | Unchanged (senders.py MailgunSender.send). |
| I11 SMTP thread after timeout | Open (accepted) | Mailpit only. |
| I12 `_bind` length | Open | Unchanged. |
| I13 PG DETAIL in logs | Open | Unchanged, low probability. |
| I14 retention / FK | Open (deferred) | Unchanged. |
| I15 frontend withoutBody / localhost check | **Resolved** | api/client.ts: `EMPTY_BODY_STATUSES {202,204,205}` or `content-length: 0` → undefined, else `text()` + `JSON.parse`. `withoutBody` is gone, and no backend route returns 202 with a body. config.py:23 `_LOCAL_BASE_URL` uses `fullmatch` and rejects `localhost.evil.tld`. The resend-shows-"sent"-when-rate-limited copy is unchanged (neutral by design). |

## New findings

### N1 (warning) The graceful send finish waits 15 s, but a batch can run about 500 s
- **Location**: src/backend/app/main.py `_EMAIL_SEND_SHUTDOWN_WAIT_SECONDS = 15.0` and `_finish_email_send`
- **Description**: The comment says "each send times out at 10 s", but up to `BATCH_SIZE`=50 sends run one after another. A restart during a large batch still lets `shutdown(wait=False)` and process exit abandon the run. Its claimed rows stay `SENDING`. After 10 min `_recover_stuck` marks every TRANSACTIONAL row FAILED/`stuck_sending`, including rows that were never attempted. Those reset or verification links are lost even though nothing reached the provider.
- **Recommendation**: Have `run_send_batch` check a stop flag between sends. On stop, write the outcomes collected so far and put the rows not yet attempted back to `PENDING` (`WHERE status='SENDING'`), then return. A smaller per-run budget would also work.
- **Fixable**: true

### N2 (info) The access-log filter covers only uvicorn
- **Location**: src/backend/app/core/access_log.py
- **Description**: Redaction is correct for uvicorn's `(client, method, path+query, version, status)` args. Both regexes are anchored on `/api/email/unsubscribe/` and `[?&]_?token=`, and it never drops a record. The Next `web` server and nginx still log `/reset-password?token=…`, `/verify-email?token=…` and `/unsubscribe?token=…`.
- **Recommendation**: Add an nginx `log_format` or map that strips `token=`, or document the gap in the runbook.
- **Fixable**: false (infrastructure)

### N3 (info) The GET unsubscribe 303 is safe
- **Location**: src/backend/app/email/router.py `unsubscribe_link`; authorization_matrix row 78 (GET+POST PUBLIC)
- **Description**: The route has no side effects. `quote(token, safe='')` keeps the token inside the query, so there is no open redirect: the host is always `APP_PUBLIC_BASE_URL`. It sends `no-store` and `Referrer-Policy: no-referrer`, and the token is not logged. While email is off, `base_url` is empty and the redirect is relative (`/unsubscribe?…`), which is harmless.
- **Recommendation**: None.
- **Fixable**: n/a

### N4 (info) Residual outside the task: login password length
- **Location**: src/backend/app/auth/router.py:72 (`LoginRequest.password`), pre-existing
- **Description**: Under bcrypt 5, `checkpw` also refuses inputs over 72 bytes, so a login with a long password can still return a 500.
- **Recommendation**: Apply `check_password_length`, or treat a too-long password as a wrong password (401) to keep login uniform.
- **Fixable**: true

### N5 (info) The 64 KiB webhook limit returns 400, which Mailgun retries
- **Location**: src/backend/app/email/webhooks.py:46, 104
- **Description**: Mailgun treats any non-2xx (except 406) as retryable, so an oversized event is retried for hours and then dropped.
- **Recommendation**: Optionally answer an oversized but signed body with 406 (no retry) or 200 after logging. The current behaviour is acceptable.
- **Fixable**: true

## Regression checks (no issues)
- `account_tokens` → `users.schemas` import: `users/schemas.py` imports only media/organizations/profile_layouts, so there is no cycle with `users.service`.
- `rules.normalize_address` matches SQL `lower(btrim())` for ASCII whitespace and is used for both the suppression read and the match (sending.py:259, 286).
- The credential ERROR carries the code only, with no key, address or URL value.
- `set_sender(None)` after shutdown cannot break an in-flight run, because `run_send_batch` captures the sender locally (sending.py:133).
- Tests touching each fix exist: test_account_tokens, test_email_senders, test_email_sending, test_email_webhook, test_email_config (access-log filter, localhost regex) and test_email_preferences. They were not executed in this review.

## Prioritized Recommendations
1. N1: make the send batch stoppable, putting the rows not yet attempted back to PENDING on shutdown.
2. N4: give login the same 72-byte rule.
3. N2: redact `token=` in the nginx/web access logs, or document the gap.
4. I7 and I10: cheap performance cleanups when convenient.

---

## Cycle 3

**Date**: 2026-11-27
**Scope**: Round-2 changes only:
- app/email/sending.py: `_stopping`, `request_stop`/`allow_sends`, `_requeue`, `requeued`
- app/main.py: shutdown sequence
- docker-compose.yml: `stop_grace_period: 25s`
- app/core/security.py: `check_password_length`, used in auth, users and families schemas
- app/email/senders.py: `_CREDENTIAL_STATUSES`
- tests/test_email_sending.py and tests/test_login.py (read, not run)

**Status**: ✅ Clean for the reviewed scope. Two low-severity info notes remain.

### TL;DR
- N1 is resolved. The stop flag is checked before the claim and before each send, unattempted rows are requeued under `WHERE status='SENDING'` with attempts, `send_after` and payload untouched, and both happen in the same commit as the outcome write.
- N4 is resolved. The 72-byte check is a request-validation 400 that fires before any DB lookup, the same for known and unknown addresses, so it reveals nothing about account existence (test_login.py:112-130).
- The `senders.py` refactor keeps the same set: `{401, 403, 404}` are credential codes, with 429 also retryable.

### Per-finding status
| ID | Status | Evidence |
|----|--------|----------|
| N1 shutdown leaves rows SENDING | **Resolved** (small residual, C3-1) | sending.py:147 skips the run while stopping. Lines 167-175 stop before the next send and `_requeue` the rest. `_requeue` (204-211) sets PENDING and `claimed_at=NULL` only `WHERE status='SENDING'`. main.py:342-346 runs request_stop → pause → wait 8 s → shutdown → allow_sends. |
| N4 login password length | **Resolved** | `LoginRequest` validator (auth/router.py:90). The 400 is raised by Pydantic before the handler, so there is no lookup and no timing difference between known and unknown addresses. Also applied to register, reset confirm and the families create/add-guardian schemas. |
| N2 nginx/web access logs | Open (infrastructure) | Unchanged. |
| N5 oversized webhook gets 400 | Open (accepted) | Unchanged. |
| I7, I10 | Open | Unchanged. |

### Race and safety checks
- **Stop flag vs claim**: everything runs on one event loop, and the flag is a plain module bool read between awaits, so there is no torn read. A stop that arrives during the claim, bind or skip write is caught by the first loop check (index 0), and every bound row is requeued. Skipped rows are already terminal. A stop during `_write_outcomes` or `_requeue` changes nothing.
- **Requeue vs webhook**: unattempted rows were never handed to the provider, so no webhook can be in flight for them. The `status='SENDING'` guard covers stuck-row recovery anyway.
- **Requeued rows**: they keep `attempts`, so a stop does not use up retries. They keep their old `send_after` (in the past), so the next process claims them at once, in the original order.
- **Flag in tests**: `test_runSendBatch_stopRequestedMidBatch…` sets `_stopping` through `monkeypatch.setattr`, which restores `False` on teardown. No other test sets it. `allow_sends()` in the lifespan also resets it after each app shutdown, which covers lifespan-based test clients.
- **Cancellation**: `CancelledError` is a `BaseException`, so `except Exception` in `_run_email_send` and `_send_one` does not swallow it. A cancelled run never writes a wrong outcome; at worst it leaves rows SENDING (C3-1).

### New findings
#### C3-1 (info) The 8 s wait is shorter than one send's 10 s timeout
- **Location**: src/backend/app/main.py:94 (`_EMAIL_SEND_SHUTDOWN_WAIT_SECONDS = 8.0`) vs rules.py `SEND_TIMEOUT = 10.0`
- **Description**: A stop that arrives during a slow send can outlast the wait. Then `shutdown(wait=False)` cancels the job. That send's row and every unattempted row stay SENDING, and the TRANSACTIONAL ones become `stuck_sending` after 10 minutes. This is far less likely than in cycle 2, but still possible. compose now gives a 25 s grace period, so a wait of about 15 s would cover a full send.
- **Recommendation**: Either set the wait above `SEND_TIMEOUT` (it fits the 25 s compose grace), or catch `CancelledError` in the loop, run `_requeue` and the outcome write under `asyncio.shield`, then re-raise. Keep the 8 s value only for deployments that use Docker's default 10 s.
- **Fixable**: true

#### C3-2 (info) The 400 on passwords over 72 bytes also hits legacy accounts
- **Location**: app/core/security.py:24-28, applied to `LoginRequest`
- **Description**: Accounts whose passwords were hashed by a truncating bcrypt (Spring/bcrypt < 5, from before the migration) now get a 400 instead of logging in. This is not a regression: bcrypt 5.0.0 was already pinned at HEAD, so those logins already failed with a 500. They now get a clear message, and they can recover through a password reset of ≤72 bytes.
- **Recommendation**: Mention it in the CHANGELOG or the runbook. No code change needed.
- **Fixable**: false

### Summary (cycle 3)
- Critical: 0
- Warnings: 0
- Info: 2 (C3-1, C3-2)
