# Code Review Report

**Date**: 2026-11-27
**Path**: app/email/**, auth account tokens, notifications/wants hooks, users, config/main/clock/matrix, migrations 0110–0112, compose/.env.example, frontend email/auth/settings files (search changes excluded)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
- Nothing critical. The concurrency core holds up: SKIP LOCKED claim, CASE-guarded outcome writes, the atomic token claim, ON CONFLICT upserts and HMAC compare_digest. No deadlock cycle was found.
- Warning: `/api/auth/password-reset/confirm` has no password length cap. bcrypt 5.0.0 raises `ValueError` above 72 bytes, so a long password returns a 500. bcrypt also runs on the event loop before the token is checked.
- Warning: Mailgun 401/403 count as permanent errors (as the spec says), so a bad API key permanently fails every queued mail, password resets included.
- Everything else is info: hardening, log/copy accuracy, minor performance, retention.

## Key Decisions
- Reviewed against spec.md. Where the code follows a spec decision (Mailgun 4xx are permanent, TRANSACTIONAL mail ignores suppression and the cap, no purge), the finding is marked `fixable: false` and the trade-off is noted.
- `datetime.utcnow()` for audit timestamps follows the project's time standard and is not flagged.

## Open Questions / Risks
- Single-instance assumptions: the webhook replay memory is in-process, and only the scheduler's `max_instances=1` keeps send runs from overlapping. A second backend instance would make stuck-row recovery and the daily cap racy.
- The password-reset request has a timing side channel: the existing-account path does extra work and commits. The neutral 202 hides the result, not the latency.
- `email_messages` keeps bell message text (user content) in `payload` forever. Without a purge it grows without bound and holds personal data indefinitely.

## Summary
- **Critical**: 0 issues
- **Warnings**: 2 issues
- **Info**: 15 issues

## Verified correct (focus areas)
- Queue claim: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 50)` plus commit before sending (sending.py:217-242, 139-146). No transaction is open during a send.
- Result writes: status, attempts, send_after and last_error change only `CASE WHEN status='SENDING'`. `sent_at`/`provider_message_id` use COALESCE and the token is removed whatever the status (sending.py:458-512). A webhook-raised status is never lowered.
- Webhook vs send: the webhook locks the single row `FOR UPDATE` and raises status by rank. PENDING/FAILED rows can be raised, SKIPPED cannot (webhooks.py:222-267). Core statements, so no StaleDataError.
- Lock order: the webhook takes message → suppression → preference. The job never touches preferences and the user PUT locks only preferences, so there is no cycle.
- Account tokens: 256-bit `secrets.token_urlsafe`, only the SHA-256 is stored, and the claim is a single `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING` (account_tokens.py:214-241). Unique `token_hash`, indexed rate-limit lookup.
- Neutral 202 on reset and resend, no 401 from any token route, `Cache-Control: no-store` on every reply (auth/router.py).
- HMAC checks use `hmac.compare_digest` (webhooks.py:134, links.py:195). The replay token is recorded only after commit, so Mailgun retries still get processed.
- Jinja autoescape matches `*.html.j2` and uses `StrictUndefined`. Tokens are `urlencode`d in links. Subjects are fixed strings, so there is no header injection.
- `referrer: "no-referrer"` and `robots: noindex` on `/verify-email`, `/reset-password` and `/unsubscribe`. `/settings` is in `PROTECTED_PREFIXES`.
- No addresses, tokens or bodies in logs or `last_error`: codes are short constants and the engine uses `hide_parameters=True` (app/db.py:16).
- Constant statement counts: the bind runs four batched reads, plus one skip write and one result write. The bell enqueue costs 0 or 1 statements.
- Secrets: `.env.example` and compose contain placeholders and `${VAR:-}` only. The startup error names variables, never values.

## Critical Issues
None.

## Warnings

### W1. Password-reset confirm: unbounded password means a 500 on bcrypt 5, and bcrypt runs before the token claim
- **Location**: src/backend/app/auth/router.py:249-251; src/backend/app/auth/account_tokens.py:300
- **Description**: `PasswordResetConfirmRequest.password` has `min_length=1` and no maximum. `uv.lock` pins bcrypt 5.0.0, whose `hashpw` raises `ValueError` for passwords over 72 bytes. That gives an unhandled 500 on a PUBLIC endpoint (the token stays unused, so nothing breaks). `hash_password` is also called synchronously on the event loop before `_claim`, so every request, valid token or not, blocks the loop for one bcrypt round.
- **Why it matters**: A legitimate user who picks a long passphrase sees an opaque error. Unauthenticated callers can make the event loop burn CPU.
- **Recommendation**: Add a 72-byte bound with a Polish 400, the same rule registration should get (RegisterRequest has the same gap, schemas.py:141, pre-existing). Consider claiming the token first and hashing after, or `await asyncio.to_thread(hash_password, …)`.
- **Fixable**: true

### W2. Mailgun 401/403 count as permanent, so a credential misconfiguration permanently fails every mail
- **Location**: src/backend/app/email/senders.py:398-401
- **Description**: Any 4xx except 429 raises `PermanentSendError`. A rotated or wrong API key, or an unverified domain (401/403), makes each claimed mail, verification and reset links included, go straight to FAILED. The token is removed, and the only trace is one ERROR per row.
- **Why it matters**: A config mistake loses users' reset and verification mail for good instead of delaying it.
- **Recommendation**: Treat 401/403 (and possibly 404 for a wrong domain URL) as retryable with a distinct code such as `http_401_config`. Or log one aggregated ERROR per run when every send fails with an auth error. This follows the spec (spec.md:295-296), so it needs the owner's decision.
- **Fixable**: false (spec decision)

## Informational

| # | Location | Category | Finding | Suggestion | Fixable |
|---|----------|----------|---------|------------|---------|
| I1 | app/email/sending.py:296 | best_practices | The daily-cap WARNING says "notification mail waits", but the rows are written `SKIPPED/daily_cap`, which is terminal. They never go out. | Reword to "notification mail skipped". | true |
| I2 | app/email/templates/notification.html.j2:3, .txt.j2:3 | security | `cta_url = base_url ~ link_path`. A `link_path` without a leading `/` (e.g. `@evil.tld` or `.evil.tld`) would change the link's host. Every producer today passes `/…` (term_item_listings, terms), so this is defence in depth. | In `_context`, use `link_path` only if it starts with `/` and not `//`, else `/`. | true |
| I3 | app/email/links.py:186-195 | security | `uuid.UUID(raw_party_id)` accepts non-canonical forms (uppercase, braces, `urn:uuid:`, no hyphens). The HMAC is checked over `str(party_id)`, so a valid token has several accepted spellings. This is harmless (same target), but it is token malleability. | Reject unless `str(party_id) == raw_party_id`. | true |
| I4 | app/auth/account_tokens.py:158-195 | security | Timing side channel on `POST /password-reset`: a known address costs the rate-limit read, `_issue` and a commit, an unknown one returns after one read. | Accepted risk, or equalise with a constant-time dummy path / a background task. Document it. | false |
| I5 | app/auth/account_tokens.py:318-321 | quality | Password-reset confirm marks the email verified (I-6) but, unlike `confirm_verification` (line 292), does not lift a BOUNCE suppression. The reset mail just reached that address. | Call `email_acl.clear_bounce_suppression(db, claimed.email)` when the snapshot matches. | true |
| I6 | app/auth/account_tokens.py:296-325 | security | A reset does not re-check that the profile email still equals the token's snapshot. This is safe today (no email writer exists), but the `UserProfile.email_verified_at` invariant comment only covers verification. | When an email-change writer is added, also invalidate open PASSWORD_RESET tokens. Extend the model's docstring. | false |
| I7 | app/email/webhooks.py:78-90 | performance | `_ReplayMemory._prune` scans all entries (≤10k) on every `seen` and `record`. Two concurrent deliveries with the same token both pass `seen` before either `record`. The effects are idempotent, so they are processed twice harmlessly. | Entries are inserted in time order, so prune from the front with `next(iter(...))` until unexpired. | true |
| I8 | app/email/webhooks.py:105-112, 148-151 | security | The body is JSON-parsed before the signature check, with no size bound in the app. | Rely on nginx `client_max_body_size`, or reject bodies over ~1 MB before `json.loads`. | true |
| I9 | app/email/webhooks.py:258 | quality | `event_at` is overwritten by every event, even an older out-of-order one. | `event_at = GREATEST(coalesce(event_at, at), at)`. | true |
| I10 | app/email/senders.py:387-390 | performance | A new `httpx.AsyncClient` (new TLS handshake) per mail. Up to 50 sequential handshakes per run. | Reuse one client for the run or the sender's lifetime (closed in lifespan shutdown). | true |
| I11 | app/email/sending.py:408; senders.py:432 | quality | `asyncio.wait_for` cancels the await, but the `to_thread` SMTP delivery keeps running. A "timeout" retry can then duplicate a mail that was in fact delivered. Mailpit only, so dev impact. | Acceptable for Mailpit. Note it in the docstring. | false |
| I12 | app/email/sending.py:249-305 | quality | `_bind` is about 57 lines (standard: ≤50) and mixes reads with the decision chain. | Extract the per-row decision into a pure `_skip_reason(row, recipient, …)`, which is also easier to table-test. | true |
| I13 | app/email/webhooks.py:163,167; app/main.py:173,175 | security | `hide_parameters=True` strips bound values, but a PostgreSQL CHECK/NOT NULL violation's `DETAIL: Failing row contains (…)` still carries row values (an address, or a payload with a token) into `logger.exception`. Unlikely given the SQL-side normalisation. | Optional: log only `sqlstate` and constraint name for `IntegrityError`. | true |
| I14 | migrations 0110 / app/email | best_practices | No retention for `email_messages`: bell `message` text and delivery metadata are kept forever. The FK to `parties` has no ON DELETE rule, so future account deletion must handle it. Both are deferred by the spec (spec.md:775). | Plan a purge (e.g. strip payload after 30 days) and record the account-deletion obligation, as was done for `seeker_party_id`. | false |
| I15 | frontend src/api/auth.ts:30-37; hooks/useEmailVerificationRequest.ts:233-235; config.py:159 | quality | (a) `withoutBody` swallows any `SyntaxError` to cope with empty 202 bodies. Handling 202/empty bodies in `api/client.ts` (as 204 is) is cleaner. (b) The UI reports "sent" when the server silently dropped the request over its 5/hour limit. (c) The `http://localhost` prefix check also accepts `http://localhost.evil.tld` (operator-set, trivial). | (a) Treat `content-length: 0` / 202 like 204 in the client. (b) Accept as neutral behaviour, or adjust the copy. (c) Match `http://localhost(:\d+)?$` or `/`. | true |

## Metrics
- Max function length: ~57 lines (`_bind`, sending.py). Everything else is ≤50.
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0 critical; 1 DoS/500 (W1); hardening items I2, I3, I8, I13
- N+1 query risks: 0 (send run: 3 + 4 + 2 statements whatever the batch size; bell enqueue: 0 or 1)
- Files analyzed: ~45 (backend 25, frontend 20)

## Prioritized Recommendations
1. W1: bound the password at 72 bytes with a Polish 400 (reset confirm and registration), and hash off the event loop or after the claim.
2. W2: decide with the owner whether Mailgun auth/config 4xx should retry instead of permanently failing account mail.
3. I2 and I3: guard `link_path` and require canonical UUIDs in unsubscribe tokens (small, cheap hardening).
4. I5: lift the BOUNCE suppression on a reset that verifies the address.
5. I1: correct the daily-cap log wording. I10: reuse the httpx client.
6. I14: plan the `email_messages` retention and account-deletion handling.
