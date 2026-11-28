# Reality Check: e-mail sending module (stages 1 and 2)

## TL;DR
- **Status: ⚠️ Issues Found, deployable for stage 1.** The account mails and the bell mail work end to end in code and in tests. I found no critical gap.
- I traced every path the brief named. Each one connects, and the frontend request and response shapes match the backend exactly.
- I re-ran 3 files (24 tests, all pass): `test_email_flows`, `test_email_webhook` and `test_email_preferences`.
- Warnings: the `List-Unsubscribe` URL answers a GET with a JSON 405. A password reset does not end existing sessions. Nothing limits the public reset POST per client address. Most existing password users are unverified, so stage-2 bell mail will reach few people at first.
- None of these blocks stage 1 (account mails only). Fix the 405 before stage 2 (bell mail).

## Key Decisions
- I classified the stage-2 reach problem (existing password accounts have `email_verified_at` NULL and are skipped as `unverified`) as a planned behaviour with a business risk, not a defect. The spec makes verification a gate on purpose, and the Home banner is the recovery path.
- I treated the missing per-address HTTP rate limit as a warning, not a blocker. The spec puts it out of scope (D12), but `nginx.conf` already has a `limit_req` zone, so the fix is cheap.
- I did not run the full suites (`skip_test_execution: true`). I relied on `verification/test-suite-results.md`: backend 2050 passed with 2 baseline failures, frontend 49 baseline failures, matcher 125 passed, no regressions.

## Open Questions / Risks
- How many active users are verified when stage 2 starts? Only Google accounts (backfill 0112), new registrations and people who use the banner can receive bell mail. Measure `skip_reason='unverified'` during stage 1.
- Product owner: should a password reset end other sessions? Today a stolen JWT stays valid after the victim resets (same accepted "no JWT revocation" risk as Google sign-in).
- The working tree also holds a change that is not part of this task: a „Zarezerwowane” tile in `HomeView.tsx` that uses `useMyReservations`. It sits in the same file as the banner. Decide whether it ships with this change.

---

## 1. Verification reports available
| Report | State |
|---|---|
| `verification/spec-audit.md` | 0 critical, 1 high, 9 medium, 15 low; all resolved in the spec's "Audit resolution" table |
| `verification/test-suite-results.md` | passed_with_issues, 0 regressions |
| `implementation/implementation-plan.md` | 136 `[x]`, 0 `[ ]` |
| `implementation/visual-coverage.md` | 11/11 design IDs covered; copy deviations (M-7, single sender address) documented |
| code review, pragmatic review, production readiness, visual fidelity | not yet available (they run in parallel) |

## 2. Claims vs reality, traced paths

| Claim | Reality (evidence) | Verdict |
|---|---|---|
| A bell and its mail row commit atomically | `notifications/service.py::create_notification` adds the `Notification` with a pre-generated id, then `email_acl.stage(...)` → `email/service.py::stage_notification_email`, which uses `db.add` for `notification:` keys and Core `ON CONFLICT DO NOTHING` for `term_confirmation:` keys. Same session, no commit. The batch path `create_notifications` → `enqueue_notification_emails` adds one multi-row insert or nothing. `test_email_enqueue.py` includes a rollback test | ✅ |
| 7 bell kinds are mailed | `rules.KIND_RULES` covers TERM_ITEM_LISTING_TAKEN, SWAP_PROPOSED/ACCEPTED/REJECTED, TERM_CONFIRMATION_NEEDED, RESERVATION_CANCELLED and WANT_MATCH_FOUND. The producers are `groups/application/term_item_listings.py`, `event_reservations.py`, `notifications/outbox_listener.py` (the confirmations carry `proposal_id`/`reservation_id`) and `wants/application/match_notifications.py` (delete-and-reinsert collapse, `topic_id=want.id` gives one mail per want per day) | ✅ |
| Send job, late binding, outcome writes | `main.py` registers `_run_email_send` every 60 s with `max_instances=1`, only while `EMAIL_ENABLED`. `sending.run_send_batch` runs recover → expire → claim (SKIP LOCKED, TRANSACTIONAL only during quiet hours or while notifications are off) → commit. It then binds recipient, suppression, preferences and the daily count → writes the skips → commits → sends with no transaction open → writes the outcomes `WHERE status='SENDING'`. The token is removed in every final state | ✅ |
| Rendering | Jinja `StrictUndefined`, HTML autoescaped. Links use `APP_PUBLIC_BASE_URL`, and startup refuses to run unless it is `https://` (or `http://localhost` in dev). The CTA falls back to `/`. The footer links `/unsubscribe?token=` (the Next page). The header links `/api/email/unsubscribe/{token}` (the backend) | ✅ |
| Mailgun sender | `{API_URL}/messages`, Basic `api:key`, `o:tracking=no`, `v:email_message_id`, `h:` headers. 4xx (except 429) is permanent; 429, 5xx, timeouts and transport errors are retried | ✅ |
| Register → verification mail | `users/service.py::_bootstrap_registration` → `account_tokens.issue_verification` → `email_acl.enqueue_verify_email`, in the registration transaction. Confirmed by `test_register_verifyMailSentInQuietHours_linkConfirmsAndMeIsVerified` | ✅ |
| Reset, including Google-only accounts | Always 202 (503 while email is off). Rate limited per user, 1 per minute and 5 per hour. Confirm claims the token atomically, sets `password_hash` (also when it was NULL), invalidates the other reset tokens, verifies the address when the snapshot matches and queues `password_changed`. Covered end to end, login included, by `test_passwordReset_googleOnly…` | ✅ |
| Webhook → suppression | HMAC with `compare_digest`, 5 min skew, in-memory replay check. Core writes in one transaction, then the token is recorded; failures answer 503. Precedence is monotonic and SKIPPED stays SKIPPED. A permanent `failed` gives BOUNCE; `complained` gives COMPLAINT and switches the category off. nginx `location /api/` reaches it | ✅ |
| One-click unsubscribe | A form-encoded POST (RFC 8058) or an empty body means scope `category`; JSON `{scope}` comes from the page. The token is HMAC-signed and never expires; matrix row 78 is PUBLIC. Proven end to end through the actual header in `test_bellFromAGiftTake_…` | ✅ (POST). GET: see W1 |
| Frontend ↔ backend contracts | `api/auth.ts` calls `/auth/password-reset` (202, no body: `withoutBody` swallows the JSON parse), `/password-reset/confirm` (204: the client returns `undefined`), `/email-verification` (POST `{}`, EDIT), `/email-verification/confirm` and `/account-tokens/lookup` `{token,purpose}` → `{email}`. These match `auth/router.py`. `api/email.ts` `EmailPreferencesResponse` has the same fields as `email/schemas.py` (`email`, `email_verified`, `suppression`, `support_address`, `notifications_live`, `all_enabled`, `categories[{category,enabled}]`), and the PUT `{category,enabled}` and unsubscribe `{scope}` → `{category,scope}` also match | ✅ |
| Interplay of cookies, 401 and tokens | The token routes are PUBLIC with no auth dependency and no global auth middleware, so a stale Bearer sent by `api/client.ts` cannot trigger the client's 401 → `clearSession` redirect. Bad tokens answer 404/410, never 401. `/settings` is in `PROTECTED_PREFIXES`. The 3 token pages have `referrer: no-referrer`. Reset success clears the session and reloads the whole document to `/login` | ✅ |
| Flags | `EMAIL_ENABLED=false`: no enqueue, no job, no sender, the request routes answer 503, `email_verified` is null and the banner is hidden. `EMAIL_NOTIFICATIONS_ENABLED=false`: no bell enqueue, and the claim takes TRANSACTIONAL rows only, so queued bell rows expire after 24 h (emergency stop). Startup refuses to run with missing variables and names them, never their values. Compose passes every variable with empty defaults | ✅ |
| Migrations and runbook | 0110–0112 exist with `lock_timeout`, plus a round-trip test (`test_email_migrations.py`). 0112 backfills only Google identities. The runbook is in `architecture.md` §"Deploy / rollback for e-mail", with the presence-only secret checks | ✅ |

**Functional completeness:** about 95% of stages 1 and 2 as specified. The missing part is robustness, not features (W1–W4).

## 3. Gaps

### Critical
None.

### Warnings
| ID | Gap | Location | Fixable | Suggestion |
|---|---|---|---|---|
| W1 | `List-Unsubscribe` points at `/api/email/unsubscribe/{token}`, which has only a POST route. A client that opens the header URL in a browser (a GET, which some mail apps and webmail fallbacks do) gets FastAPI's JSON `405 Method Not Allowed`. RFC 8058 allows the GET but requires that it unsubscribe nothing; it should land on a page. | `app/email/router.py` (POST only); `app/email/senders.py::build_headers` | yes, ~30 min | Add `GET /api/email/unsubscribe/{token}` returning `303` to `{APP_PUBLIC_BASE_URL}/unsubscribe?token=…` with no side effect and a PUBLIC matrix row (methods `GET, POST` on row 78). Add one test. Do this before stage 2 |
| W2 | A password reset does not invalidate existing login JWTs. A hijacked session survives the victim's reset; only the browser that resets is logged out (`clearSession`). | `app/auth/account_tokens.py::confirm_password_reset` | yes, medium effort (token versioning) | Accept explicitly in `architecture.md` under accepted risks (today it is listed only for Google sign-in), or add a `users.token_version` claim later |
| W3 | Nothing limits the PUBLIC `POST /api/auth/password-reset` per client address. The per-user limit (5 per hour) still lets a script mail 5 resets an hour to every known address. Those mails count toward `EMAIL_DAILY_CAP` (both streams), so they can use up the cap and push the day's bell mail into SKIPPED `daily_cap`. | `src/frontend/nginx.conf`; `app/email/sending.py::_bind` | yes, ~15 min | Add `location = /api/auth/password-reset` (and `/api/auth/email-verification`) with `limit_req zone=public_reads burst=5`, the same pattern as `/api/public/search` |
| W4 | Stage-2 reach: every existing password account has `email_verified_at IS NULL`, so its bell mail is SKIPPED `unverified` until the user clicks the banner. The stated problem ("people missed takes and swaps") is solved only for verified users. | 0112 backfills Google only (by design) | product decision | During stage 1, track `SELECT count(*) FROM user_profiles WHERE email_verified_at IS NOT NULL`. Optionally send a one-off verification mail to active accounts before stage 2 |

### Info
| ID | Note | Location | Suggestion |
|---|---|---|---|
| I1 | The daily-cap WARNING says "notification mail waits", but those rows become SKIPPED `daily_cap` for good and are never sent. | `sending.py::_bind` | Reword the log line ("is skipped"), or document it in the runbook |
| I2 | An `asyncio.wait_for` timeout on the SMTP sender leaves the worker thread running, so a late success can be retried as a duplicate. This affects Mailpit only, in dev. | `senders.py::SmtpSender` | Accept |
| I3 | An unrelated change is in the same working tree: the „Zarezerwowane” tile in `HomeView.tsx`. | `src/frontend/src/features/panel/HomeView.tsx` | Separate it, or name it in the commit |
| I4 | The replay memory is per process and assumes one backend instance (documented). | `webhooks.py` | Revisit before scaling out |
| I5 | No ADR replaces handover ADR-009 for the two documented deviations (the quiet-hours claim filter and the `want_match` day), as the work-log notes. | docs | Write a short ADR |

## 4. Integration points
- **Data flow:** domain write → bell plus `email_messages` (same transaction) → 60 s job → Mailgun → webhook → status and suppression → next run's late binding. Each step is verified in code, and `test_email_flows.py` exercises the whole chain.
- **API contracts:** frontend and backend shapes match, and status codes (202/204/404/410/503) map to the view states.
- **Database:** 0110–0112 have explicit names and `lock_timeout`, and the downgrade path is documented as lossy.
- **Auth:** matrix rows 74–82 (PUBLIC auth-flow POSTs; `READ`/`EDIT` without `mcp:*` for the preferences and the resend).
- **Deploy:** nginx `/api/` → backend covers the webhook and the one-click POST. Compose passes all `EMAIL_*` variables and `APP_PUBLIC_BASE_URL`. Startup refuses to run with incomplete configuration and has no restart policy (in the runbook).

## 5. Pragmatic action plan
| # | Task | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Add `GET /api/email/unsubscribe/{token}` that answers 303 to the `/unsubscribe?token=` page, plus the matrix entry and a test | GET answers 303 to the page and the preference stays unchanged; the matrix test passes | High (before stage 2) | 30 min |
| 2 | Add `limit_req` locations in nginx for `/api/auth/password-reset` and `/api/auth/email-verification` | A burst over the limit gets the JSON 429 envelope | Medium | 15 min |
| 3 | Record "a reset does not revoke other sessions" as an accepted risk, or schedule token versioning | Listed in the accepted risks in `architecture.md` | Medium | 10 min (doc) |
| 4 | Add a stage-1 runbook step: measure the verified share and the `skip_reason` distribution before you set `EMAIL_NOTIFICATIONS_ENABLED=true` | A query is in step 6 of the runbook | Medium | 10 min |
| 5 | Reword the daily-cap log line (I1) and separate the unrelated HomeView tile (I3) | The log text matches the behaviour; the commit holds only this task's changes | Low | 10 min |

## 6. Completion verdict
**⚠️ Gaps, functionally complete.** The module does what the stage-1 and stage-2 requirements ask, end to end: verification, reset (including Google-only accounts), the password-changed mail, the 7 bell kinds, preferences, one-click unsubscribe, webhook suppressions, quiet hours, the warm-up flags and the daily cap. The traced code paths and the integration tests back this up. It is ready for **stage 1** (account mails only). Before **stage 2**, fix W1, decide W3 and W4, and record W2.

---

## Re-verification (cycle 3, final)

**Status: ✅ Ready (stage 1 and stage 2, once the runbook preconditions are met).** Every first-pass gap is either resolved or a documented, accepted residual. The end-to-end paths still connect.

For test results I relied on `verification/test-suite-results-reverify-2.md`, and ran no suites in this pass (`skip_test_execution: true`). Backend: 2079 passed, 2 baseline failures. Frontend: 49 baseline failures; `apiClient.test.ts` 7/7 passed; typecheck 0. Matcher: 125 passed. 0 regressions.

### Per-gap status
| ID | Status | Evidence |
|---|---|---|
| W1 GET on the `List-Unsubscribe` URL | ✅ Resolved | `app/email/router.py::unsubscribe_link` (GET) returns `303` to `{APP_PUBLIC_BASE_URL}/unsubscribe?token=<quoted>` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. It has no read and no write. Matrix row 78 is now `GET, POST` PUBLIC, and `tests/test_email_preferences.py:189` covers it (`follow_redirects=False`) |
| W2 a reset does not revoke JWTs | ✅ Accepted residual, documented | `architecture.md` lists it as an accepted risk in both the Google sign-in and the E-mail sections (sessions live up to 1 h) |
| W3 no per-address limit | ✅ Resolved, minor residual | `nginx.conf` adds the `auth_flows` zone (10 r/min, burst 5, the JSON 429 envelope) on the 5 account-token routes and on `/api/email/unsubscribe/`. The Mailgun webhook stays unlimited under `/api/`. Residual (info): RFC 8058 one-click POSTs from Gmail or Yahoo arrive from shared provider IPs. At today's volume (`EMAIL_DAILY_CAP` 100) that is harmless. If volume grows, raise the burst or exempt the POST, so that a 429 never drops an unsubscribe |
| W4 stage-2 reach | ✅ Mitigated, product residual | Runbook step 6 now has a precondition: a query for `verified_pct` plus the `status, skip_reason` distribution, with guidance to prompt verification before setting `EMAIL_NOTIFICATIONS_ENABLED=true` |
| I1 wording of the cap log line | ✅ Resolved | `sending.py:331`: "…further notification mail is skipped" |
| I2 SMTP duplicate on timeout | Unchanged, accepted | Mailpit in dev only. The new cooperative stop with requeue and the compose `stop_grace_period: 25s` reduce the crash-window duplicates |
| I3 unrelated HomeView tile | Open (process) | Still in the working tree. Keep it out of the commit, or name it |
| I4 per-process replay memory | Unchanged, documented | Single backend instance |
| I5 ADR replacing ADR-009 | Unchanged | A documentation follow-up |

### End-to-end paths after the fixes
- **Frontend API contracts after the `client.ts` change:**
  - `request()` now returns `undefined` for 204/205 and for any empty 2xx body, and parses JSON otherwise. So `auth.ts` dropped `withoutBody` and calls `api.post` directly.
  - The 202 replies with no body (`/auth/password-reset`, `/auth/email-verification`) and the 204 confirms resolve to `void`. `/auth/account-tokens/lookup` still returns `{email}`.
  - The `/email/*` shapes are unchanged and still match `email/schemas.py`. The 401 → `clearSession` branch is untouched and cannot fire on the PUBLIC token routes.
- **Unsubscribe GET → page → POST:**
  - A mail client's GET on `/api/email/unsubscribe/{token}` goes through nginx `location /api/email/unsubscribe/` (limited) to the backend, which answers `303` to `/unsubscribe?token=…`. Next serves the page (`no-referrer`).
  - `UnsubscribePage` reads `token` from the query and names the category with `parseUnsubscribeCategory`. On a click it POSTs `{scope}` as JSON to the same backend path, gets `200 {category, scope}`, and shows „Gotowe”. A bad signature returns 404 and the page shows „Nieprawidłowy link”.
  - The RFC 8058 one-click form POST still works with scope `category`.
  - The token is masked in nginx access logs (`$loggable_uri`, no query, no referer).
- **The other changes do not alter the contracts:**
  - Mailgun 401/403/404 are now retryable, so a misconfigured key does not drop mail before `MAX_ATTEMPTS`.
  - The 72-byte bcrypt password limit is on register, reset, login and family accounts.
  - The cooperative send-job stop requeues claimed rows.

### Final verdict
**✅ Complete for the intended purpose.** Account mails, the 7 bell kinds, preferences, unsubscribe (GET redirect, page and one-click), webhook suppressions, quiet hours and the warm-up flags all work end to end. Open items:
- **Residuals:** the documented JWT non-revocation, and the shared-IP rate-limit note for one-click POSTs.
- **Process:** the unrelated HomeView tile is still in the working tree.
