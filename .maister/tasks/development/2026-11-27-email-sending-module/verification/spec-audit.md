# Spec Audit: app/email sending module (stages 1+2), pre-implementation

## TL;DR
Verdict: **pass-with-concerns** (⚠️ Mostly Compliant). Every user decision in `requirements.md` / `scope-clarifications.md` maps to a spec requirement, and almost every claim the spec makes about the codebase checks out (paths, signatures, test pins, matrix gaps, migration numbering, guard tests, slugs, 401 behaviour).
Counts: **0 critical, 1 high, 9 medium, 15 low**.
The one high finding is the job's result write. It guards only the SENT branch with `status = 'SENDING'`, so a retryable or permanent outcome can overwrite a status the webhook already raised. That breaks "an event never lowers the status" and can re-send a mail that was already delivered.
Most of the medium findings are concurrency or retry edges (webhook replay memory vs. provider retries, single use of account tokens) and frontend view states that are not specified.

## Key Decisions
- High, not critical, for the result-write race: it needs a provider timeout (or late 2xx) while the webhook lands within the same send window. It is rare, but it breaks Success Criterion 6 and the ADR-004 duplicate policy.
- The webhook replay/retry gap is medium: it only loses events after a first processing failure. Suppressions are the reputation guard, though, so the fix is cheap and recommended.
- Explicit refinements of user decisions (I-2 refined with ON CONFLICT on the single path, I-5 overriding ADR-005, rows 80/81 split, row 82 added) are documented in Key Decisions, so they are not findings. Two ADR-009 deviations are not flagged as deviations (L-1).
- Copy that the mockups do not cover is listed separately (section 7). It is not counted as a defect, except where the spec gives no copy at all (M-8).

## Open Questions / Risks
- Stage 1 (EMAIL_ENABLED=true, EMAIL_NOTIFICATIONS_ENABLED=false): the banner, `/verify-email` success and `/settings` all promise notification mails that will not be sent for at least a week (M-7). Should the copy or the visibility be gated on the second flag?
- `/reset-password` behind `AuthGuard requireAuth={false}` makes a reset link unusable while logged in, and gives a logged-in Google-only user no way to set a password (M-9). This was a user-confirmed reuse, but the consequence was likely not visible.
- Should `EMAIL_NOTIFICATIONS_ENABLED=false` also stop bell rows already queued (an emergency stop), or only new enqueues (M-4)?
- Mailgun webhook retries carry the original signature/timestamp. With a 5-minute skew and a token memory written before processing, a failed first delivery can never be recovered (M-1). Accept, or record the token only after success?

---

## 1. Requirement coverage (requirements.md → spec)

| Req / decision | Spec location | Status |
|---|---|---|
| Phase 1: scope 1+2, separate `EMAIL_LINK_SIGNING_SECRET`, Mailpit `dev` profile | Out of Scope, R11, R15 | ✅ |
| C-1 verification inside `register` before commit | R12 `issue_verification` inside `_bootstrap_registration` savepoint | ✅ (verified: `users/service.py:318-351`) |
| C-2 `EMAIL_NOTIFICATIONS_ENABLED` default false | R5, R15, Technical Approach | ✅ (see M-4 on semantics) |
| I-1 stale expiry | `expires_at` + R7 step 2 | ✅ |
| I-2 `db.add` single / ON CONFLICT batch | R5, Key Decision 1 (explicit refinement for `term_confirmation:`) | ✅ |
| I-3 deterministic `term_confirmation` key | R4 | ✅ |
| I-4 `email_verified` on `/me` only | R14 | ✅ |
| I-5 COMPLAINT lifted by support only | Key Decisions, R12, runbook step 8 | ✅ |
| I-6 reset confirm verifies email | R12 | ✅ |
| Phase 5 reuse (AuthLayout, ToggleRow/Switch, HintCard look, useCallback writes, no useMutation) | F1–F8, Reusable Components | ✅ |
| Req 12 "rows 74–80" | R16 (74–82, split explained) | ✅ explicit deviation |
| Req 12 clock helpers "Warsaw→UTC and start of Warsaw day" | R16 adds only `local_to_utc` | ✅ (start of day is computed by the caller, acceptable) |
| Req 20 "`email_verified` in `UserProfileResponse`" | R14 `MyProfileResponse` | ✅ (consistent with I-4, which is binding) |
| Req 3 "TRANSACTIONAL rows expire with their token" | `expires_at` = token expiry, password_changed +24 h | ✅ |
| Req 8 "no `mcp:*`" | rows 80/81 `("READ",)`/`("EDIT",)` | ✅ |
| Scope clarification "TRANSACTIONAL exempt from cap" | Key Decision: counted, never skipped | ✅ |

No user decision was dropped.

## 2. Claims verified against the codebase

| Spec claim | Evidence | Result |
|---|---|---|
| `create_notification` sets no id; `NotificationEntry` has 4 fields | `app/notifications/service.py:38-74` | ✅ |
| `create_notifications` is one multi-row Core INSERT with explicit id/timestamps | `service.py:77-104` | ✅ |
| `TERM_CONFIRMATION_NEEDED` is created only through the single path, inside outbox handlers | `app/notifications/outbox_listener.py:102-108, 134-143`; no batch caller | ✅ (so the batch path never needs proposal/reservation ids) |
| Dispatcher commits after a failing handler and has no backoff | `app/outbox/dispatcher.py:71-93` | ✅. The "IntegrityError loop" rationale is correct: with `db.add`, the duplicate surfaces at the dispatcher's `db.commit()`, outside its `try` |
| `bells_due` runs in a savepoint; WANT_MATCH via `create_notifications` | `app/wants/application/bells_due.py:85`, `match_notifications.py:207` | ✅ |
| `_entry` passes `topic_id=want.id` | `match_notifications.py:111-119`: `_entry(party_id, kind, message, link_path)` takes no want | ⚠️ needs a new parameter (L-5) |
| Test pins `test_wants_notifications.py:92` (`["INSERT"]`) and `:115` (`statements == []`) | file lines 92, 115 | ✅ |
| Test env flags | `tests/conftest.py:53-54` sets MODERATION/EMBEDDINGS env only | ⚠️ `EMAIL_ENABLED=false` must be added (L-6); `Settings` reads `.env` (`config.py:22`) |
| `fake_embedder` model fixture | `tests/conftest.py:296-306` | ✅ |
| `_bootstrap_registration` savepoint, `register` retry loop | `users/service.py:318-351` | ✅ |
| Import-cycle claim (users.service must not import auth.service) | `auth/service.py:20` imports `app.users.service`; `users/service.py:16` imports only `app.auth.models`; `app/auth/__init__.py` empty | ✅ cycle-free as designed |
| `_bootstrap_google_account`, `_log_in_linked` | `auth/service.py:69-117` | ✅ (`_log_in_linked` must read the profile before its commit; implementable) |
| `_to_my_profile_response` builds all three `/me` responses | `users/router.py:62-96` | ✅ |
| Only `create_account_and_profile` writes `user_profiles.email` | `users/service.py:77-82`; also used by `families/guardians.py:32`, `families/bootstrap.py:58` (same constructor) | ✅ |
| Unique `lower(email)` on profiles (reset lookup is unambiguous) | `alembic/versions/0016_unique_user_profile_email.py:32-38` | ✅ |
| Latest migration 0109, string revisions, `SET LOCAL lock_timeout` precedent | `0109_points_offers.py:42-43,85` | ✅ 0110–0112 are free |
| Matrix: rows ≤ 73 used, 70/71 taken, catch-all last, no broader `/api/auth` or `/api/email` rule before 69/73 | `app/core/authorization_matrix.py:38-275` | ✅ the planned placement cannot be shadowed |
| No 410 exception or handler exists | `app/core/errors.py` (404/409/400/403/429/503 only) | ⚠️ needs a route-local envelope like `_GOOGLE_ERRORS` (L-2) |
| Clock: `local_now`, `utc_to_local`, `format_term_when`, `warsaw_zone`; no `local_to_utc` | `app/core/clock.py:33-66` | ✅ |
| Clock guard forbids `datetime.now(`/`date.today(` only | `tests/test_domain_clock_guard.py:28-37` | ✅ (`utcnow()` stays allowed) |
| Boundary test pattern `_POINTS_IMPORTERS` | `tests/test_module_boundaries.py:103-139` | ✅ |
| `TRANSACTION_CONFLICTS`, engine `hide_parameters=True` | `app/db.py:16,22` | ✅ (DB errors in `logger.exception` will not leak bound addresses) |
| Router order, `system_router` last; job shape | `app/main.py:131-153, 245-257, 286-307` | ✅ |
| Single uvicorn worker (replay memory, `max_instances=1`) | `Dockerfile:84`, `docker-compose.yml:28` | ✅ |
| `jinja2` absent, `python-multipart` present (form unsubscribe) | `pyproject.toml:17`, `uv.lock` | ✅ |
| `architecture.md` l.480 "In-app notifications only" | line 480 | ✅ |
| `settings` reserved in both lists | `organizations/slugs.py:37`, `routing/reservedSlugs.ts:11` | ✅ |
| `PROTECTED_PREFIXES`, `View`, `ACCOUNT_SUBVIEWS` | `routing/paths.ts:3-26,142-160`, `utils/appHelpers.ts:13-23` | ✅ |
| Frontend logs out only on a 401 with a token | `api/client.ts:41-48` | ✅ the token routes never return 401 |
| `HintCard.onDismiss` required, `ToggleRow` has no `disabled`, `Switch` has `disabled` | `components/shared/appComponents.tsx:19-123` | ✅ (both are listed as small extensions) |
| `usePanelReload` "when a panel is mounted" | `features/panel/appDataStore.ts:10-23`: `useAppData()` **throws** outside `AppDataProvider` | ❌ M-5 |
| Route tests and fixtures exist | `src/test/{reservedSlugs,routeManifest,proxy,ssrSafety}.test.*`, `panelPages.ts` | ✅ `routeManifest.test.ts` `PANEL` list needs `/settings` |
| AuthGuard `requireAuth={false}` redirects logged-in users | `auth/AuthGuard.tsx:40-45` | ✅ the claim is accurate (consequence: M-9) |

---

## 3. High

### H-1 The result write can lower a webhook-raised status and re-send a delivered mail
- **Spec:** R7 step 7 ("The status becomes `SENT` only if it is still `SENDING`"); Technical Approach, lock shape ("the precedence rule and the `CASE WHEN status = 'SENDING'` result write keep the higher status"); R10 status precedence; Success Criterion 6.
- **Gap:** Only the **sent** branch is guarded. The **retryable** branch (`PENDING`, `attempts+1`) and the **permanent** branch (`FAILED`) are unconditional. Scenario: Mailgun accepts the message but our call times out after 10 s → `RetryableSendError('timeout')`. Meanwhile `delivered` (or `failed`/`complained`) arrives, is found by `v:email_message_id`, and raises the row from `SENDING` to `DELIVERED`/`BOUNCED`. The result write then sets `PENDING`, so the mail is sent again, and a COMPLAINED/BOUNCED status is erased.
- **Also ambiguous:** in the sent branch, the spec does not say whether `sent_at`, `provider_message_id` and the token removal still apply when the status is already DELIVERED. They must, or the daily cap undercounts and a raw token stays at rest in a final-state row.
- **Also unspecified:** what an event does to a row in `PENDING`, `FAILED` or `SKIPPED`. The precedence list starts at `SENDING`.
- **Category:** Incorrect / ambiguous. **Severity:** High, because it violates a stated invariant on the security- and reputation-relevant path.
- **Fix:**
  - In the `UPDATE … FROM (VALUES …)`, apply every outcome only `WHERE status = 'SENDING'`. When the status is already higher, still set `sent_at` and `provider_message_id` (`COALESCE`) and remove the token.
  - In R10, state that an event on a `PENDING`/`FAILED` row raises it to the event status, because the provider proves it was sent. That stops a duplicate resend. An event on `SKIPPED` is ignored.
  - Add a send-job test for "retryable outcome after DELIVERED keeps DELIVERED".

## 4. Medium

### M-1 Webhook replay memory vs. provider retries, and the write style
- **Spec:** R10 check ("the token unseen in an in-process memory"), Response; Open Questions (single instance).
- **Gap:**
  - The spec does not say when the token enters the memory. If it is recorded before the DB write and that write fails, the 5xx makes Mailgun retry the same payload (same `signature.token`). The retry is then rejected as `replay` (or as `stale` after 5 min), and a BOUNCE or COMPLAINT is lost for good.
  - An ORM update of `email_messages` would also hit the `updated_at` `version_id_col` check (`BaseEntity`) against the job's concurrent Core write. That raises `StaleDataError` and a 500.
- **Fix:**
  - Record the token only after the transaction commits.
  - Write the status, the suppression upsert and the preference upsert as Core statements (no version check) in one transaction. Map `TRANSACTION_CONFLICTS` to a 5xx without recording the token.
  - Write the accepted limit "retries older than `WEBHOOK_MAX_SKEW` are rejected" into the runbook.
  - Parse `user-variables.email_message_id` defensively: a non-UUID value counts as unknown and gets 200.

### M-2 Single use of account tokens under concurrency is unspecified
- **Spec:** R12 `confirm_verification`, `confirm_password_reset` ("Validates the token … marks this token … used").
- **Gap:** With read-then-set through the ORM, two concurrent confirms both pass validation. On a reset, both set a password (the last one wins). The `AccountToken` version check makes one of them fail with an unmapped `StaleDataError` (500). For a reset this is a single-use guarantee on a credential path.
- **Fix:** Claim with one statement: `UPDATE account_tokens SET used_at = now WHERE token_hash = :h AND purpose = :p AND used_at IS NULL AND expires_at > now RETURNING …`. No row means a 404/410 split by a follow-up read. Then apply the side effects in the same transaction. Add a test that a second confirm of the same token returns 410.

### M-3 Precedence of the account-token mail when a newer token is issued
- **Spec:** R12 `issue_verification` ("marks the user's earlier unused tokens of the purpose used").
- **Gap:** The earlier token's queued mail stays PENDING and is sent with a dead link. The user then gets two mails and the first link answers 410. The rate limit makes this rare, but registration followed by an immediate banner resend hits it.
- **Fix:** Either skip PENDING `auth:` rows of revoked tokens (the job would need a read of `auth`, which the spec avoids by design), or accept it and say so in Open Questions. Recommendation: accept and document it.

### M-4 `EMAIL_NOTIFICATIONS_ENABLED=false` is not an emergency stop
- **Spec:** Technical Approach, Flags ("only the bell hook goes quiet"); runbook step 6.
- **Gap:** Bell rows queued before the flag flip keep being claimed and sent for up to 24 h. An operator who flips the flag on a complaint spike expects sending to stop, and only `EMAIL_ENABLED=false` does that, which also stops password resets.
- **Fix:** While the flag is false, the claim filter (R7 step 3) also takes only TRANSACTIONAL rows, the same mechanism as quiet hours, so held rows simply expire. Or state the current behaviour explicitly in the runbook.

### M-5 `usePanelReload()` cannot be called "when a panel is mounted"
- **Spec:** F1 ("trigger `usePanelReload()` when a panel is mounted"); F7 runs outside the panel.
- **Evidence:** `features/panel/appDataStore.ts:10-15`: `useAppData()` throws `"useAppData must be used within AppDataProvider"`. Hooks cannot be called conditionally. `/verify-email` (`app/(public)/verify-email`) has no provider, while `/settings` and the Home banner do.
- **Fix:** Add an optional variant, e.g. `useOptionalPanelReload()` built on `useContext(AppDataContext)` that returns a no-op without a provider. Use it in `useEmailVerificationRequest` and in the confirm write. Add a test that renders `VerifyEmailPage` without a provider.

### M-6 Token-lookup query can flip a success screen back to "invalid"
- **Spec:** F1 `useAccountTokenLookup(token, purpose)` ("a query with no retry"); F6/F7 view states.
- **Gap:** With the default `staleTime: 0` and refetch-on-focus, after a successful confirm the lookup refetches on window focus. It returns 410, and a `resolve…View()` that derives from the lookup shows "Link wygasł". This is the "stale/refresh-error row" case that the components standard requires.
- **Fix:** Set `staleTime: Infinity`, `refetchOnWindowFocus: false` and `refetchOnReconnect: false`. Specify the precedence in `resolveVerifyEmailView` and `resolveResetPasswordView`: confirm success > confirm error > lookup. Add `it.each` rows for "success, then lookup 410".

### M-7 Stage-1 copy promises mails that are switched off
- **Spec:** F3 ("Dzięki temu dostaniesz maila, gdy ktoś weźmie Twoją rzecz…"), F7 success ("Od teraz możesz dostawać powiadomienia e-mail"), F2 switches. Runbook step 6 keeps `EMAIL_NOTIFICATIONS_ENABLED=false` for at least a week.
- **Gap:** During the warm-up, `email_verified` is non-null, so the banner shows and users verify. They are then promised mail that is not sent, and `/settings` switches look effective.
- **Fix (product decision):**
  1. Accept it, since the gap is about a week.
  2. Add `notifications_enabled: bool` to `GET /api/email/preferences` and show an info line on `/settings`.
  3. Keep the banner hidden until the second flag is on. Verification still works from `/settings`.

  Record the choice in the spec.

### M-8 Unspecified error states and copy on the token pages and the toggle revert
- **Spec:** F2 ("a `role="alert"` message below its row", with no text given), F6/F7/F8 (states cover only 404/410/503).
- **Gap:**
  - Network or 5xx failures of the lookup, the confirm POST, the unsubscribe POST and the reset request have no view kind and no copy.
  - The `/settings` revert alert has no text.
  - The `unknown` address state (EMAIL_ENABLED off, or the profile has no email) has no copy and no defined address line.
  - There is no loading state for the token pages.
- **Fix:**
  - Add an `error` kind with a retry to the three `resolve…View()` functions, plus `loading`.
  - Give the alert copy, e.g. „Nie udało się zapisać. Spróbuj ponownie.”, reusing `extractProblemMessage` for server messages.
  - Define what `/settings` shows without an address.

### M-9 Reset link unusable while logged in; a logged-in Google-only user cannot set a password
- **Spec:** F6 (`AuthGuard requireAuth={false}`), R8 password_reset Google-only copy ("Możesz też ustawić hasło"), the password_changed mail ("Jeśli to nie Ty, ustaw nowe hasło").
- **Evidence:** `auth/AuthGuard.tsx:40-45` redirects any logged-in visitor away, `?token=` included.
- **Gap:** A user who opens the mail on a device where they are logged in lands on Home. The link looks broken, and the token is not consumed. A logged-in Google-only user has no path to set a password without logging out first.
- **Fix:** Guard only the no-token request form, and let the `?token=` branch render for everyone. Or keep the guard and state the limitation explicitly. This was a user-confirmed reuse ("`AuthGuard requireAuth={false}` for reset only"), so put the question to the user.

### M-10 `resolveEmailSettingsView` state precedence is not defined
- **Spec:** F2 lists `verified`, `unverified`, `sent`, `complaint`, `bounce`, `unknown`.
- **Gap:** Combinations are possible: BOUNCE plus unverified, COMPLAINT plus unverified, `sent` after a bounce. The order decides the copy and whether the resend button shows (it shows in `bounce`, not in `complaint`).
- **Fix:** State the order `complaint > sent > bounce > unverified > verified`, with `unknown` when `email_verified === null` (and COMPLAINT still shown when known). Table-test the combinations.

## 5. Low

| # | Finding | Spec ref | Fix |
|---|---|---|---|
| L-1 | Two ADR-009 deviations are not flagged as deviations: quiet hours as a claim filter (ADR-009 and the HLD test say "the job moves `send_after` to 07:00"), and the `want_match` day of the effective window (ADR-009: `clock.local_now()` at enqueue). Both are sound. | Key Decisions, R4 | Prefix both with "deviates from ADR-009" and give the reason (one mail for 23:00 + 08:00 matches). |
| L-2 | No 410 exception or handler exists, and Pydantic `Literal` failures yield the generic 400 "Validation failed", not „Nieznana kategoria powiadomień.” | R11 PUT, R13 | Use a route-local error map like `_GOOGLE_ERRORS` (`auth/router.py:116-160`) for 404/410/503. Validate `category` as a `str` in the handler for the Polish 400. |
| L-3 | Matrix order of row 82 relative to 77 is undefined ("74, 75, 76, 82 … and 77"), yet the test asserts "incl. order". | R16 | Write out the exact sequence (e.g. 74, 75, 76, 82, 77). |
| L-4 | `standards/backend/security.md` names rows 72/73 as the only auth-flow PUBLIC POST exception. It is missing from the docs list. | Technical Approach, Docs | Add 74–79/82 and the HMAC-webhook exception to `security.md` and INDEX. |
| L-5 | `_entry(party_id, kind, message, link_path)` has no want parameter, and is also used for `WANT_EXPIRING`. | R6 | Add `topic_id: uuid.UUID | None = None` to `_entry`, passed only for MATCH. |
| L-6 | Test env: `Settings` reads `.env`, and conftest forces only MODERATION/EMBEDDINGS. | Testing Approach | Add `os.environ["EMAIL_ENABLED"] = "false"` and `EMAIL_NOTIFICATIONS_ENABLED` to `tests/conftest.py:53`. |
| L-7 | `tests/test_my_profile.py:122-128` pins `ME_KEYS`, and it will change. | R14 | Add it to the test plan, group 8. |
| L-8 | `link_path` is nullable on bells. All 7 MVP producers set it today, but the template has no fallback. | R8 | CTA to `base_url + "/"` (or hide it) when `link_path` is null. |
| L-9 | httpx `timeout=10` is per phase (connect/write/read/pool), and `SmtpSender` has no timeout. The "50 × 10 s ≤ 500 s" bound is optimistic. With one worker and `max_instances=1` the risk is limited to crash windows. | R9, Key Decision 18 | Use `httpx.Timeout(10, connect=5)` plus an `asyncio.wait_for(…, SEND_TIMEOUT)` wrapper, and `smtplib.SMTP(timeout=SEND_TIMEOUT)`. |
| L-10 | The commit between the skip write (step 5) and the network calls (step 6) is implied ("no DB transaction open") but not listed. | R7 | Add "Commit." after step 5. |
| L-11 | `EMAIL_BACKEND=log` (the default) with `EMAIL_ENABLED=true` silently marks account mails SENT in production. `smtp` has no TLS. | R15 | Log a startup WARNING when the backend is not `mailgun` and `APP_PUBLIC_BASE_URL` starts with `https://`. |
| L-12 | `ALL`-category tokens are never produced by any mail. F8's "an ALL token shows only the second button" is speculative (minimal-implementation standard). | R11, F8 | Drop it, or name where `ALL` tokens are issued. |
| L-13 | A `term_confirmation:` key dedups forever. A second legitimate prompt for the same proposal/reservation and party (if one ever exists) would never be mailed. | R4 | Accept it and note it next to the duplicate-bell risk. |
| L-14 | Frontend type: the PATCH `/me` responses become `MyProfileResponse` too (`users/router.py:80-96`), but F1 changes only `getMyProfile`. | F1, R14 | Type `updateMyProfile` and `updateMyProfileAppearance` as `MyProfileResponse` as well. |
| L-15 | New reserved slugs could collide with an existing Organization slug. The `LoginForm` link inside `AuthSheet` must also close the sheet when it navigates. Token query strings: consider `Referrer-Policy: no-referrer` on the token pages. | R16, F5, F6–F8 | Add a pre-deploy `SELECT slug FROM organizations WHERE slug IN (…)` to the runbook. Close the sheet on link click. Add a `referrer` meta on the 3 pages. |

## 6. Concurrency, transaction and security review (summary)
- **Hook atomicity.** It is correct. `db.add` joins the caller's unit of work. The Core `INSERT … ON CONFLICT` autoflushes the staged bell, which is harmless. Inside the `bells_due` and `register` savepoints, both roll back together. The FK to `parties` cannot fail for a bell that has a valid party.
- **Queue claim.** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING`, committed before HTTP, is correct with a single worker and `max_instances=1`. Stuck recovery can only race a crash, as ADR-004 accepts.
- **ON CONFLICT paths.**
  - Multi-row `DO NOTHING` with intra-statement duplicates is legal.
  - The preference and suppression upserts must set `updated_at` explicitly (BaseEntity version column), because Core bypasses the ORM version logic.
  - The COMPLAINT-outranks-BOUNCE `DO UPDATE … WHERE excluded.reason = 'COMPLAINT'` is correct.
- **Webhook vs. send result.** See H-1 and M-1.
- **HMAC and secrets.** `compare_digest` is used for the webhook and the unsubscribe signature, token hashing is SHA-256 of a 256-bit `token_urlsafe`, and the forgot-password and resend responses are neutral. Addresses are kept out of `last_error`, logs (engine `hide_parameters=True`) and sender logs. One suggestion: canonicalise `party_id` (lowercase UUID) before you verify the unsubscribe HMAC, so verification compares the canonical form.
- **Enumeration.** Forgot-password timing is accepted (Open Questions). The lookup endpoint reveals an address only for a valid, unexpired token.

## 7. Copy not covered by the mockups (needs a product read)
Already flagged by the spec: the BOUNCE text on `/settings`, the scope=all done text, subjects and CTAs for 6 of the 7 kinds (the mockup shows only SWAP_PROPOSED), the password_reset body with its Google-only variant, the password_changed body, and the neutral "Jeśli to nie Ty, zignoruj tę wiadomość." (the mockup has the gendered "zakładałaś").
Additionally not covered, and also not given in the spec (M-8):
- the toggle revert alert;
- the `unknown` address state;
- network/5xx error states on `/reset-password`, `/verify-email` and `/unsubscribe`;
- loading states;
- the API messages „Ten link jest nieprawidłowy.”, „Ten link do zmiany hasła jest już nieważny.”, „Ten link wygasł albo został już użyty.”, „Nieznana kategoria powiadomień.” and „Nie rozpoznajemy tego linku.” (only the last appears in the mockup, on the page, not as an API message).

Mockup checks that pass: every string quoted in F2–F8 matches the mockup text, including field order. The reset 503 state shows no „Wróć do logowania” link, and the spec does not add one.

## 8. Testability
- Every planned group stays within 2–8 tests. Group 3 (8) and group 7 (8) are at the limit.
- Tests to add:
  - H-1: retryable/permanent outcome after a webhook-raised status;
  - M-1: a failed webhook processing can be retried with the same token;
  - M-2: a second confirm of the same token returns 410;
  - M-5: `VerifyEmailPage` without `AppDataProvider`;
  - M-6: a refocus after success keeps the success view;
  - L-7: the `ME_KEYS` update.
- Swap them for lower-value cases in groups 3, 5, 7 and 10 to stay at ≤ 8.

## 9. Recommendations (in order)
1. Fix H-1 in R7 step 7 and R10, and add its test.
2. Specify the webhook write style and the token-recording point (M-1), and the atomic token claim (M-2).
3. Decide M-4, M-7 and M-9 with the user, and record them in Key Decisions.
4. Add `useOptionalPanelReload` (M-5), the lookup query options and view precedence (M-6), and the error/loading kinds and copy (M-8, M-10).
5. Apply the Low items as small spec edits: exact matrix order, the conftest env, `ME_KEYS`, `_entry`, the 410 envelope, the docs list and the ADR-009 deviation labels.
