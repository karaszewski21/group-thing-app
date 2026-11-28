# Specification: app/email sending module (rollout stages 1+2)

## TL;DR
A new `app/email` module queues mail in `email_messages` (the transactional outbox), written in the same transaction as the bell or the account write, and a 60 s `_run_email_send` job sends it through an `EmailSender` port (Mailgun EU, SMTP to Mailpit, log, and a fake in tests).
It covers the 3 account mails (verify, reset, password changed) and 7 bell kinds. It adds opt-out preferences with RFC 8058 unsubscribe, a signed Mailgun webhook that feeds `email_suppressions`, `account_tokens` in `auth`, and `user_profiles.email_verified_at` with a Google backfill (migrations 0110–0112).
`EMAIL_ENABLED` gates everything. `EMAIL_NOTIFICATIONS_ENABLED` (default false) gates bell mail at enqueue and at claim, so the account-mail warm-up runs first and the flag doubles as an emergency stop. `/settings` then shows „Powiadomienia e-mail ruszają wkrótce”.
The frontend gets `/settings`, `/verify-email`, `/reset-password` (the token form works for logged-in users too), `/unsubscribe`, a Home banner with neutral copy, a login link and an Account row, all built from the binding mockups. This revision applies the spec audit (see "Audit resolution").

## Key Decisions
- Single-row hook: `db.add(EmailMessage)` for `notification:<id>` keys. For the deterministic `term_confirmation:` key it uses one Core `INSERT … ON CONFLICT DO NOTHING` — this refines I-2: an outbox retry re-stages the same key, and `db.add` would turn that into an IntegrityError loop.
- `email_messages.expires_at` (NOT NULL) is set at enqueue (bell +24 h, token mails = token expiry, password changed +24 h) — one expiry rule (`expired`) for both streams, and the job needs no read of `auth`.
- **Deviates from ADR-009:** quiet hours are a claim filter, not a `send_after` move to 07:00. Between 22:00 and 07:00 Warsaw the job claims only TRANSACTIONAL rows, so the held rows wait with no extra writes. The same filter applies while `EMAIL_NOTIFICATIONS_ENABLED=false` (M-4), so rows already queued simply expire through `expires_at`.
- **Deviates from ADR-009:** the `want_match` day is the Warsaw date of the effective send window, not `local_now()` at enqueue. Between 22:00 and 24:00 it counts as the next day, so a 23:00 match and an 08:00 match give one mail, not two at 07:00.
- Every send outcome is written only `WHERE status = 'SENDING'`. `sent_at`/`provider_message_id` (`COALESCE`) and the token removal apply always, so a webhook-raised status is never lowered and never re-sent (H-1).
- Webhook writes are Core statements in one transaction, and the replay token is recorded only after the commit, so a failed first delivery can be retried (M-1).
- Account tokens are claimed atomically (`UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING`): single use holds under concurrency (M-2).
- M-7 (user decision): neutral banner and verify-success copy. `GET /api/email/preferences` exposes `notifications_live`. While it is false, `/settings` keeps the switches with the note „Powiadomienia e-mail ruszają wkrótce”.
- M-9 (user decision): `/reset-password?token=` renders for everyone. On success it clears an existing session and does a full reload to `/login`. Only the no-token request form keeps `AuthGuard requireAuth={false}`.
- New matrix row 82, `POST /api/auth/account-tokens/lookup` (PUBLIC, no side effects) — the binding mockups show the token's address before the click ("Dla konta …", "Kliknij, żeby potwierdzić …") and the reset page must show the expired state before the user types.
- Row "80" is split into 80 (GET, READ) and 81 (PUT, EDIT) — one matrix entry carries one requirement.
- The unsubscribe token is `1.<CATEGORY>.<party_id>.<sig>`, where the category is a mailed category (no `ALL` tokens: „Wyłącz wszystkie” is `scope=all` on a category token). The category is in clear, so the page can name it („Ten link dotyczy kategorii …”) before the POST without a read endpoint. The signature covers all three fields.
- `tests/conftest.py` forces `EMAIL_ENABLED=false` and `EMAIL_NOTIFICATIONS_ENABLED=false`, because `Settings` also reads `.env`. So `tests/test_wants_notifications.py:92` and `:115` keep their pins, and a new test pins the two-INSERT sequence with the flags on — the hook is a no-op while off.
- `EMAIL_DAILY_CAP` counts every row sent since Warsaw midnight (both streams, as Mailgun's plan limit does). Only NOTIFICATION rows are skipped (`daily_cap`).
- Result writes are batched: skips in one statement (then a commit) before sending, outcomes in one statement after the batch. Each send is capped at `SEND_TIMEOUT` (10 s, enforced by `asyncio.wait_for`), so the batch (≤ 500 s) stays shorter than the 10 min stuck threshold and a crash window stays within ADR-004's accepted duplicate/FAILED policy.
- The verification resend is allowed for verified addresses too — it is the recovery path after a BOUNCE suppression. Rate limits keep it cheap, so there is no 409.
- One `EMAIL_FROM_ADDRESS` serves both streams. The mockups' `powiadomienia@`/`konto@` pair is illustrative (requirement 13 lists a single variable).
- The support address comes from `EMAIL_REPLY_TO_ADDRESS` and is returned by `GET /api/email/preferences` as `support_address`. No new variable.
- COMPLAINT suppression is lifted only by support (I-5). This overrides ADR-005's "enabling a category clears COMPLAINT".

## Open Questions / Risks
- D14 privacy policy and the Mailgun DPA are rollout prerequisites outside the code (stage 2 / stage 1).
- Copy not in the mockups is proposed here and should get a product read: the BOUNCE state on `/settings`, the `scope=all` confirmation on `/unsubscribe`, the subjects and CTAs per kind, and the password-reset and password-changed mail bodies. The mockup's gendered "zakładałaś" becomes neutral copy, because the mail also goes out on resend.
- Mailgun keeps its own bounce and complaint lists. Clearing a local BOUNCE does not unblock an address Mailgun suppresses (operator runbook note).
- The webhook replay memory lives in process memory and assumes one backend instance.
- Forgot-password returns the same 202 body, but its timing is not equalised. Timing enumeration is accepted (no HTTP rate limit, D12).
- `email_messages.party_id` and `email_preferences.party_id` have no ON DELETE rule, like `wants.seeker_party_id`. Account deletion, when it is built, must handle them.
- Pre-existing outbox duplicate-bell bug: duplicate bells stay, but their mail is deduplicated only for `TERM_CONFIRMATION_NEEDED`. A `term_confirmation:` key deduplicates forever, so a second legitimate prompt for the same proposal or reservation and party would not be mailed. No such flow exists today (accepted, L-13).
- Accepted (M-3): a newer token marks the earlier one used, but the earlier token's queued mail still goes out with a dead link that answers 410. Rare, because of the rate limit; the job deliberately does not read `auth`.
- Accepted (M-1): a Mailgun webhook retry that arrives more than `WEBHOOK_MAX_SKEW` (5 min) after signing is rejected as stale (runbook note).
- The new reserved slugs `verify-email`, `reset-password` and `unsubscribe` could collide with an existing Organization slug. The runbook adds a pre-deploy check query.
- Copy added for unspecified states (M-8, M-7) is proposed: loading and error states, the toggle-revert alert, the unknown-address state, the „wkrótce” note and the neutral verify-success text.

## Goal
Give aj a second, email channel for the existing bells, plus account recovery and address verification, with no change to bell behaviour and with every mail traceable, opt-out-able and never sent to an unverified or suppressed address.

## User Stories
- As a new user registering with a password, I want a link to confirm my address right away so that I start getting mail about my exchanges.
- As an existing user, I want a banner on Start and a button in settings to verify my address so that I can turn mail on without re-registering.
- As anyone who forgot a password (including a Google-only account), I want a reset link by mail so that I can set a new password; the page never reveals whether an account exists.
- As a participant in an exchange, I want a mail when someone takes my item, proposes or answers a swap, a reservation is cancelled or a hand-over needs confirming, so that exchanges do not stall.
- As a seeker, I want at most one mail a day per want about new matching items.
- As a recipient, I want to switch categories off in `/settings` or with one click from a mail, so that I only get what I want.
- As the operator, I want a delivery log, bounce and complaint suppression and a daily cap so that the sending domain keeps its reputation.

## Core Requirements

### Backend — module `app/email`

**R1. Module layout and boundaries**
- New files under `src/backend/app/email/`:
  - `__init__.py`
  - `models.py`
  - `rules.py`
  - `service.py`
  - `sending.py`
  - `rendering.py`
  - `senders.py`
  - `links.py`
  - `webhooks.py` (the Mailgun signature check, the replay memory and applying events; split from the router so the router stays thin)
  - `router.py`
  - `schemas.py`
  - `infrastructure/__init__.py`
  - `infrastructure/users_acl.py`
  - `templates/` with `base.html.j2`, `base.txt.j2` and a `*.html.j2` + `*.txt.j2` pair each for `verify_email`, `password_reset`, `password_changed` and `notification`.
- `app.email` is imported only by `app/main.py`, `app/notifications/infrastructure/email_acl.py` and `app/auth/infrastructure/email_acl.py`.
- Outside `infrastructure/`, the module imports only `app.core`, `app.db`, `app.config` and `app.email`.
- `app.email` never imports `app.notifications`; kinds arrive as strings.
- The boundary test gets a points-style importer-set test and an inner-import test.
- `app/email` joins `_GUARDED_DIRS` in `tests/test_domain_clock_guard.py`.

**R2. Data model (migration 0110, file `0110_email_tables.py`)**
All four tables are on `BaseEntity` (`id` UUID PK `pk_<table>`, `created_at`, `updated_at` as `version_id_col`). Timestamps are naive UTC; enums are `String` via `_enum_column`; every constraint name is explicit.

`email_messages`:
| Column | Type | Rule |
|---|---|---|
| `idempotency_key` | `String(200)` NOT NULL | `uq_email_messages_idempotency_key` |
| `party_id` | UUID NOT NULL | `fk_email_messages_party_id_parties` (no ON DELETE rule), `ix_email_messages_party_id` |
| `stream` | `String(20)` NOT NULL | `ck_email_messages_stream`: `TRANSACTIONAL`, `NOTIFICATION` |
| `category` | `String(30)` NULL | `ck_email_messages_category_stream`: NULL ⇔ `TRANSACTIONAL` |
| `template` | `String(50)` NOT NULL | `verify_email`, `password_reset`, `password_changed`, `notification` |
| `notification_id` | UUID NULL | loose pointer, **no FK** (collapsed MATCH bells delete their row) |
| `notification_kind` | `String(50)` NULL | the bell kind string |
| `payload` | JSONB NOT NULL, server default `'{}'` | bell: `message`, `link_path`; account mail: `token` (raw, removed at any final state), `google_only`, `changed_at` |
| `status` | `String(20)` NOT NULL | `ck_email_messages_status`: `PENDING`, `SENDING`, `SENT`, `DELIVERED`, `BOUNCED`, `COMPLAINED`, `SKIPPED`, `FAILED` |
| `skip_reason` | `String(30)` NULL | `ck_email_messages_skip_reason`: NULL or one of `no_address`, `unverified`, `organization`, `suppressed`, `category_disabled`, `daily_cap`, `expired`; `ck_email_messages_skipped_reason`: `(status = 'SKIPPED') = (skip_reason IS NOT NULL)` |
| `attempts` | Integer NOT NULL, default 0 | `ck_email_messages_attempts`: `>= 0` |
| `send_after` | TIMESTAMP NOT NULL | backoff moves it; `ix_email_messages_pending_send_after` partial `WHERE status = 'PENDING'` |
| `expires_at` | TIMESTAMP NOT NULL | set at enqueue (see Key Decisions) |
| `claimed_at` | TIMESTAMP NULL | `ix_email_messages_sending_claimed_at` partial `WHERE status = 'SENDING'` |
| `sent_at` | TIMESTAMP NULL | `ix_email_messages_sent_at` (daily cap count) |
| `delivered_at`, `event_at` | TIMESTAMP NULL | `event_at` = time of the last applied webhook event |
| `provider_message_id` | `String(255)` NULL | normalised without `<>`; `ix_email_messages_provider_message_id` |
| `last_error` | `String(200)` NULL | a code only (`http_400`, `timeout`, `transport`, `smtp_refused`, `stuck_sending`, `render_error`), never an address or content |

The recipient address is never stored.

`email_preferences`:
- columns `party_id` (UUID NOT NULL, `fk_email_preferences_party_id_parties`), `category` (`String(30)` NOT NULL) and `enabled` (Boolean NOT NULL);
- `uq_email_preferences_party_id_category`;
- `ck_email_preferences_category`: `ALL`, `RESERVATIONS`, `MEETINGS`, `WANTS`, `MESSAGES`, `ORGANIZER_DIGESTS` (the full catalogue now, so no later migration);
- a missing row means the category's default from `rules`.

`email_suppressions`:
- `address_normalized` (`String(320)` NOT NULL, `uq_email_suppressions_address_normalized`, `ck_email_suppressions_address_normalized`: `address_normalized = lower(btrim(address_normalized))`);
- `reason` (`String(20)` NOT NULL, `ck_email_suppressions_reason`: `BOUNCE`, `COMPLAINT`);
- `source_message_id` (UUID NULL, loose).

`account_tokens` (owned by `auth`, mapped in `app/auth/models.py` as `AccountToken` + `AccountTokenPurpose`):
- `user_id` (UUID NOT NULL, `fk_account_tokens_user_id_users` ON DELETE CASCADE);
- `purpose` (`String(20)` NOT NULL, `ck_account_tokens_purpose`: `VERIFY_EMAIL`, `PASSWORD_RESET`);
- `token_hash` (`String(64)` NOT NULL, SHA-256 hex, `uq_account_tokens_token_hash`);
- `email` (`String(320)` NOT NULL, the normalised address snapshot);
- `expires_at` (TIMESTAMP NOT NULL) and `used_at` (TIMESTAMP NULL);
- `ix_account_tokens_user_id_purpose_created_at`.

0110 runs `SET LOCAL lock_timeout = '5s'` first, because the FKs lock `parties` and `users`. Its downgrade drops the tables in reverse order and is lossy.

**R3. Verification column (0111 `0111_email_verified_at.py`, 0112 `0112_backfill_google_verified.py`)**
- **0111** adds nullable `user_profiles.email_verified_at` TIMESTAMP and maps it on `UserProfile`. It uses `lock_timeout`; the downgrade drops the column.
- **0112** is a data revision. It sets `email_verified_at = timezone('utc', now())` on every profile with `email_verified_at IS NULL` that has a `user_identities` row with `email_verified` and `lower(identity.email) = lower(profile.email)`, joined on `identity.user_id = profile.account_user_id`. It uses `lock_timeout`. Its downgrade is a documented no-op, because the 0111 downgrade drops the column.
- Writers of the column:
  - verification confirm (R12);
  - reset confirm when the token snapshot equals the profile email (R12, I-6);
  - `bootstrap_person_account(..., email_verified=True)` for new Google accounts;
  - a linked Google sign-in when Google reports the email verified and it equals the profile email case-insensitively while the column is NULL.
- Invariant: any future writer of `user_profiles.email` must clear `email_verified_at`. Today only the `create_account_and_profile` constructor writes it; this goes in a docstring on the column.

**R4. Rules (`rules.py`, pure functions and constants only)**
- `KIND_RULES` maps the bell kind string to `(category, subject, cta_label)` for exactly these kinds:

  | Kind | Category | Subject | CTA |
  |---|---|---|---|
  | `TERM_ITEM_LISTING_TAKEN` | `RESERVATIONS` | Ktoś wziął Twoją rzecz | Zobacz szczegóły |
  | `SWAP_PROPOSED` | `RESERVATIONS` | Ktoś chce wymienić się z Tobą | Zobacz propozycję |
  | `SWAP_ACCEPTED` | `RESERVATIONS` | Twoja propozycja wymiany została przyjęta | Zobacz wymianę |
  | `SWAP_REJECTED` | `RESERVATIONS` | Twoja propozycja wymiany została odrzucona | Zobacz szczegóły |
  | `TERM_CONFIRMATION_NEEDED` | `RESERVATIONS` | Potwierdź, czy przekazanie się odbyło | Potwierdź |
  | `RESERVATION_CANCELLED` | `RESERVATIONS` | Rezerwacja została anulowana | Zobacz szczegóły |
  | `WANT_MATCH_FOUND` | `WANTS` | Mamy coś, czego szukasz | Zobacz |

  No other kind is mailed.
- `CATEGORY_DEFAULTS`:
  - `RESERVATIONS` true;
  - `WANTS` = `WANTS_DEFAULT_ENABLED = True` (the single constant);
  - `MEETINGS` true;
  - `MESSAGES` false;
  - `ORGANIZER_DIGESTS` false.
- `VISIBLE_CATEGORIES = (RESERVATIONS, WANTS)`, the categories with at least one active kind.
- `CATEGORY_LABELS`:
  - `RESERVATIONS` → „Rezerwacje i wymiany”;
  - `WANTS` → „Szukam”.
- Keys:
  - `notification:<notification_id>`;
  - `want_match:<want_id>:<YYYY-MM-DD>` for `WANT_MATCH_FOUND` with `topic_id`. The date is the Warsaw date of the effective send window: between 22:00 and 24:00 it is the next day (deviates from ADR-009, see Key Decisions);
  - `term_confirmation:<proposal_id or reservation_id>:<party_id>` for `TERM_CONFIRMATION_NEEDED` when either id is set (`proposal_id` wins), else `notification:<id>`;
  - `auth:<token_id>` for a token mail;
  - `auth:<token_id>:changed` for password changed.
- Constants:
  - `BATCH_SIZE = 50`;
  - `BACKOFF_MINUTES = (1, 5, 15, 60, 240)`;
  - `MAX_ATTEMPTS = 6`;
  - `STUCK_SENDING_AFTER = 10 min`;
  - `NOTIFICATION_TTL = 24 h`;
  - `QUIET_HOURS = 22:00–07:00`;
  - `VERIFY_TOKEN_TTL = 48 h`;
  - `RESET_TOKEN_TTL = 1 h`;
  - `TOKEN_REQUEST_MIN_INTERVAL = 60 s`;
  - `TOKEN_REQUESTS_PER_HOUR = 5`;
  - `WEBHOOK_MAX_SKEW = 5 min`;
  - `SEND_TIMEOUT = 10 s`.
- Helpers:
  - `is_quiet(local_dt)`;
  - `want_match_day(local_dt)`;
  - `next_send_after(now, attempts)`;
  - `category_enabled(rows, category)` = the `ALL` row is not false and (the category row, or its default) is true.

**R5. Enqueue (`service.py`)**
- A frozen dataclass `NotificationEmail(notification_id, party_id, kind: str, message, link_path, topic_id, proposal_id, reservation_id)`.
- `stage_notification_email(db, item)` — the single path:
  - returns at once unless `settings.email_enabled and settings.email_notifications_enabled` and the kind is in `KIND_RULES`;
  - otherwise `db.add(EmailMessage(...))` for a `notification:` key, or one Core `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` for a `term_confirmation:` key.
- `enqueue_notification_emails(db, items)` — the batch path, behind the same gates and kind filter. It issues exactly one multi-row Core `INSERT … ON CONFLICT DO NOTHING` with explicit `id`/`created_at`/`updated_at`, or no statement when nothing qualifies.
- Common to both paths:
  - no reads;
  - never raises on recipient matters;
  - never commits.
  - The row starts `PENDING` with `send_after = utcnow()` and `expires_at = utcnow() + NOTIFICATION_TTL`. The payload is `{message, link_path}`.
- `enqueue_transactional(db, *, template, party_id, idempotency_key, expires_at, payload)` adds one TRANSACTIONAL row (`category` NULL). It is a no-op when `settings.email_enabled` is false.
- `clear_bounce_suppression(db, address)` deletes a `BOUNCE` row for the normalised address (a COMPLAINT stays).

**R6. Notifications hook (`app/notifications/service.py` + new `app/notifications/infrastructure/{__init__,email_acl}.py`)**
- `NotificationEntry` gets the last field `topic_id: uuid.UUID | None = None`. It lives in memory only and is not a column.
- `create_notification` assigns `id = uuid.uuid4()` explicitly, then calls `email_acl.stage(...)` with its `proposal_id`/`reservation_id`.
- `create_notifications` calls `email_acl.enqueue(...)` with the returned ids zipped to the entries.
- The ACL converts the kind to `.value` and calls `app.email.service`.
- `wants/application/match_notifications.py::_entry` gets a new keyword `topic_id: uuid.UUID | None = None`. `write_bell_rows` passes `topic_id=want.id` only for `WANT_MATCH_FOUND`; the `WANT_EXPIRING` entries leave it None.
- Cost: no extra statement for an empty or non-MVP batch, and exactly one statement per call otherwise. The bell and its mail commit or roll back together.

**R7. Send job (`sending.py::run_send_batch(db)` + `main.py::_run_email_send`)**
- **Scheduling.**
  - Scheduled every 60 s (`coalesce`, `max_instances=1`, `misfire_grace_time=None`), only when `settings.email_enabled`.
  - Every run opens its own session.
  - A `TRANSACTION_CONFLICTS` error is one WARNING; any other error is `logger.exception` once and is never re-raised.
- **Run order.** Each step below is one statement unless noted.
  1. Recover stuck rows: `SENDING` with `claimed_at < now - STUCK_SENDING_AFTER` → NOTIFICATION back to `PENDING` (`send_after = now`), TRANSACTIONAL to `FAILED` (`last_error = stuck_sending`, token removed).
  2. Expire: `PENDING` with `expires_at <= now` → `SKIPPED`/`expired`, token removed.
  3. Claim up to 50 `PENDING` rows with `send_after <= now`, ordered by `send_after`, via `FOR UPDATE SKIP LOCKED` → `SENDING`, `claimed_at = now`, `RETURNING`. Commit.
     - During quiet hours, or while `settings.email_notifications_enabled` is false, only TRANSACTIONAL rows are claimed. NOTIFICATION rows that wait longer than their `expires_at` become `expired` in step 2.
  4. Late binding, one statement each:
     - recipients through `users_acl.get_recipients_by_party_ids` (party type, email, `email_verified_at`, display name);
     - suppressions for the claimed addresses;
     - preferences for the claimed NOTIFICATION parties;
     - the sent-today count (`sent_at >= clock.local_to_utc(Warsaw midnight)`).
  5. Decide each row. NOTIFICATION rows are checked in this order:
     1. `organization` (ORGANIZATION party);
     2. `no_address` (no profile or email);
     3. `unverified`;
     4. `suppressed`;
     5. `category_disabled`;
     6. `daily_cap` (when the count plus this run's sends reaches `EMAIL_DAILY_CAP`, with one WARNING per run).

     TRANSACTIONAL rows are checked only for `no_address`: they ignore verification, suppression, preferences and the cap.

     Write all skips in one statement, with the token removed. **Commit**, so no transaction is open during step 6.
  6. For each remaining row, render it (R8) and call `get_sender().send()` inside `asyncio.wait_for(…, SEND_TIMEOUT)`. A render error is a permanent failure (`render_error`); a `wait_for` timeout is retryable (`timeout`).
  7. Write all outcomes in one `UPDATE … FROM (VALUES …)`. Every status, `attempts`, `send_after` and `last_error` change applies only `WHERE status = 'SENDING'`, through `CASE` on the current status. Two parts apply whatever the current status is, because a webhook may have raised the row in the meantime:
     - `sent_at` and `provider_message_id` are set with `COALESCE(existing, new)` for a sent outcome;
     - `payload - 'token'` runs for a sent or permanent outcome.

     The outcomes:
     - **sent**: `SENT`.
     - **retryable**: `PENDING`, `attempts + 1`, `send_after` from the backoff, `last_error`; or `FAILED` once `attempts + 1 >= MAX_ATTEMPTS`, with an ERROR `email message <id> FAILED after <n> attempts`.
     - **permanent**: `FAILED`, `last_error`, with an ERROR `email message <id> FAILED: <code>`.

     So a row the webhook already raised to `DELIVERED`, `BOUNCED` or `COMPLAINED` keeps that status and is never re-sent.

     Commit.
- **Logging.** One line per run: `email send: claimed=… sent=… skipped=… retried=… failed=… expired=… recovered=…`, at INFO when anything is non-zero, else DEBUG. Addresses, tokens, subjects and bodies never reach a log or `last_error`.

**R8. Rendering (`rendering.py`)**
- The Jinja2 `Environment` uses `PackageLoader`/`FileSystemLoader` over `app/email/templates`, `select_autoescape(("html", "html.j2"))` and `StrictUndefined`.
- `render(template, context) -> RenderedEmail(subject, html, text)`.
- Shared context:
  - `brand` (`EMAIL_FROM_NAME`);
  - `base_url` (`APP_PUBLIC_BASE_URL`);
  - `settings_url` (`<base>/settings`);
  - `first_name` (the first word of the display name).
- `notification`:
  - subject and CTA from `KIND_RULES`, body = the bell `message`;
  - the CTA is `base_url + link_path`, rendered as a button with the URL as text below it. When `link_path` is null the CTA points to `base_url + "/"` (Start);
  - footer: „Dostajesz ten mail, bo masz włączone powiadomienia „<label>”.” · „Wypisz się z tej kategorii” (`/unsubscribe?token=…`) · „Ustawienia powiadomień” (`/settings`).
- `verify_email`:
  - subject „Potwierdź swój adres e-mail”;
  - body „Cześć <first_name>! Kliknij przycisk, żeby potwierdzić adres. Link jest ważny 48 godzin.”, CTA „Potwierdź adres” → `/verify-email?token=…`;
  - „Jeśli to nie Ty, zignoruj tę wiadomość.”
- `password_reset`:
  - subject „Ustaw nowe hasło”;
  - body „Kliknij przycisk, żeby ustawić nowe hasło. Link jest ważny godzinę.”, plus, when `google_only`, „Logujesz się przez Google. Możesz też ustawić hasło i logować się nim.”;
  - CTA „Ustaw hasło” → `/reset-password?token=…`;
  - „Jeśli to nie Ty, zignoruj tę wiadomość — hasło się nie zmieni.”
- `password_changed`:
  - subject „Hasło zostało zmienione”;
  - body „Hasło do Twojego konta zostało zmienione <clock.format_term_when(local changed_at)>.”;
  - „Jeśli to nie Ty, ustaw nowe hasło:” + a link to `/reset-password`.
- Footer of the account mails: „Wiadomość o Twoim koncie w <brand>, wysyłana niezależnie od ustawień powiadomień.”
- No tracking and no promotional blocks. The CSS is inline in `base.html.j2`.

**R9. Senders (`senders.py`)**
- The port:
  - Protocol `EmailSender.send(message: OutgoingEmail) -> SendResult(provider_message_id)`;
  - errors `PermanentSendError(code)` / `RetryableSendError(code)`;
  - `OutgoingEmail(to, subject, text, html, headers, tag, email_message_id)`.
- Headers on every mail:
  - `Auto-Submitted: auto-generated`;
  - `Reply-To` when `EMAIL_REPLY_TO_ADDRESS` is set.
- Headers on NOTIFICATION mail only:
  - `List-Unsubscribe: <{base}/api/email/unsubscribe/{token}>`;
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
  - `List-Id: <notifications.{from-domain}>`.
- `MailgunSender(api_url, api_key, transport=None)`:
  - an httpx form POST to `{EMAIL_PROVIDER_API_URL}/messages` with Basic `api:<key>` and `httpx.Timeout(10, connect=5)`. The job's `asyncio.wait_for(…, SEND_TIMEOUT)` bounds the total time;
  - fields `from`, `to`, `subject`, `text`, `html`, `h:<header>`, `o:tag`, `o:tracking=no`, `v:email_message_id`;
  - 2xx → the id from JSON `id`, stripped of `<>`;
  - 429, 5xx, timeout and transport errors → retryable;
  - any other 4xx → permanent (`http_<status>`).
- `SmtpSender(host, port)`: stdlib `smtplib.SMTP(host, port, timeout=SEND_TIMEOUT)` through `asyncio.to_thread`, a multipart/alternative `EmailMessage` with a generated `Message-ID`, no auth or TLS (Mailpit only). `SMTPRecipientsRefused` → permanent; other errors → retryable.
- `LogSender`: logs `email (log backend): message=<email_message_id> template=<tag>` and returns `log-<uuid>`.
- Wiring: `set_sender()`, `get_sender()` and `build_sender(settings)`.
  - The lifespan sets the sender by `EMAIL_BACKEND` when email is enabled, and resets it to `None` on shutdown.
  - `FakeEmailSender` lives in `tests/` (in a `fake_email_sender` fixture in `tests/conftest.py`, modelled on `fake_embedder`). It captures messages and can be told to raise either error.

**R10. Webhook (`POST /api/email/webhooks/mailgun`, `webhooks.py`)**
- **Body.** The Mailgun JSON body: `signature{timestamp, token, signature}` and `event-data`.
- **Check.**
  - `hmac(EMAIL_WEBHOOK_SIGNING_KEY, timestamp + token, sha256)`, compared with `compare_digest`, with `|now - timestamp| <= 5 min`;
  - the token unseen in an in-process memory (entries kept 5 min, at most 10 000).
  - A bad signature, a stale timestamp, a replay or a missing key → 401 with no detail, plus one INFO line `email webhook rejected: reason=<bad_signature|stale|replay|not_configured>`.
  - Unparseable JSON → 400.
- **Transaction.**
  - The status update, the suppression upsert and the preference upsert are Core statements (no ORM version check) in one transaction. Every upsert sets `updated_at` explicitly.
  - The replay token is recorded in memory only after that transaction commits. A `TRANSACTION_CONFLICTS` error or any other failure answers 503 with no detail and no token recorded, so Mailgun's retry (same token) is processed. One WARNING for a conflict; `logger.exception` otherwise.
- **Lookup.**
  - First by `event-data.user-variables.email_message_id`, parsed defensively (a non-UUID value counts as absent).
  - Else by the normalised `event-data.message.headers.message-id`.
  - No match → unknown.
- **Events.**
  - `delivered` → `DELIVERED` + `delivered_at`;
  - `failed` with `severity=permanent` → `BOUNCED` + a BOUNCE suppression;
  - `complained` → `COMPLAINED` + a COMPLAINT suppression, and for a NOTIFICATION row the upsert `email_preferences(party, category).enabled = false`;
  - temporary failures and other events are ignored.
- **Status precedence.** `COMPLAINED > BOUNCED > DELIVERED > SENT > SENDING`: an event never lowers the status. `event_at` is updated.
- **Rows outside the ranked set.**
  - On a `PENDING` or `FAILED` row, the event raises the status to the event's status: the provider proves the mail went out, which also prevents a resend. The token is removed.
  - On a `SKIPPED` row the status is left alone. The suppression and preference effects still apply.
- **Suppressions.**
  - The address comes from `event-data.recipient`, normalised.
  - Upsert `ON CONFLICT (address_normalized) DO UPDATE SET reason = 'COMPLAINT' WHERE excluded.reason = 'COMPLAINT'`, so a COMPLAINT outranks a BOUNCE.
- **Response.** 200 `{}`, also for an unknown message.

**R11. Unsubscribe and preferences (`router.py`, `links.py`)**
- **Token.**
  - `sign_unsubscribe(party_id, category)` produces `1.<CATEGORY>.<party_id>.<base64url(HMAC-SHA256(EMAIL_LINK_SIGNING_SECRET, "1|<CATEGORY>|<party_id>"))>` (no padding).
    - `<CATEGORY>` is a category of `KIND_RULES` (the mail's own category); no `ALL` token is issued.
    - `<party_id>` is the canonical lowercase UUID string.
  - `verify_unsubscribe` canonicalises the `party_id` segment before computing the HMAC and compares with `compare_digest`. The token never expires.
- **`POST /api/email/unsubscribe/{token}`** (PUBLIC, row 78):
  - **Request.** A JSON body `{scope: "category" | "all"}` from the page; a form/multipart body (`List-Unsubscribe=One-Click`) or an empty body is scope `category`.
  - **Effect.** Upserts `email_preferences` (`category` or `ALL`) to `enabled = false`. Idempotent.
  - **Response.** 200 `{category, scope}` with no redirect.
  - **Errors.** A bad or unknown token, or a missing secret → 404 „Nie rozpoznajemy tego linku.”
- **`GET /api/email/preferences`** (READ, row 80) → `EmailPreferencesResponse`:
  - `email: str | null`;
  - `email_verified: bool | null` (same rule as `/me`);
  - `suppression: "BOUNCE" | "COMPLAINT" | null`;
  - `support_address: str | null`;
  - `notifications_live: bool` (`EMAIL_ENABLED and EMAIL_NOTIFICATIONS_ENABLED`; drives the „wkrótce” note, M-7);
  - `all_enabled: bool`;
  - `categories: [{category: "RESERVATIONS" | "WANTS", enabled: bool}]` (the stored value or the default, in `VISIBLE_CATEGORIES` order).
- **`PUT /api/email/preferences`** (EDIT, row 81):
  - body `{category: str, enabled: bool}` → upsert (Core, `updated_at` set explicitly), then the same response;
  - the handler checks `category` against `ALL` + `VISIBLE_CATEGORIES` itself, so a Pydantic `Literal` failure does not produce the generic 400; another value → 400 „Nieznana kategoria powiadomień.”;
  - the PUT is allowed while unverified or suppressed (the UI disables the switches).
- **Principal.** Resolved to a party via `users_acl` (`find_party_id_by_principal`). Without a profile → 404.

### Backend — account flows in `auth` / `users`

**R12. Account tokens (`app/auth/account_tokens.py` + `app/auth/infrastructure/{__init__,email_acl}.py`)**
- **Imports.** `account_tokens.py` imports only `app.auth.models`, `app.users.models`, `app.core`, `app.config` and the auth email ACL. It never imports `auth.service` or `users.service`, so `users.service` can import it without a cycle.
- **`issue_verification(db, *, user_id, party_id, email)`**
  - It runs inside `users.service._bootstrap_registration`'s savepoint, after the bootstrap and before the commit (C-1), and does nothing while email is disabled.
  - It marks the user's earlier unused tokens of the purpose used, adds a token (`secrets.token_urlsafe(32)`, SHA-256 hash, normalised email snapshot, `expires_at = now + 48 h`) and enqueues `verify_email` (key `auth:<token_id>`, `expires_at` = the token's).
- **`request_verification(db, principal)`**
  - Resolves the profile.
  - Stays silent when there is no email, or when the rate limit (fewer than 1 in 60 s and 5 per hour per user and purpose, counted on `account_tokens`) is reached.
  - Otherwise issues as above.
- **`request_password_reset(db, email)`**
  - Looks up `lower(profile.email)` → the account user.
  - Stays silent when there is no account or the rate limit is reached.
  - Otherwise issues `PASSWORD_RESET` (1 h) and enqueues `password_reset` with `payload.google_only = password_hash IS NULL`.
- **`lookup(db, token, purpose)`** → the token's email snapshot. It raises not-found (404) or gone (410: expired or used).
- **Atomic claim (both confirms, M-2).**
  - One statement: `UPDATE account_tokens SET used_at = now, updated_at = now WHERE token_hash = :h AND purpose = :p AND used_at IS NULL AND expires_at > now RETURNING id, user_id, email`.
  - When no row comes back, a follow-up read splits the error: an unknown hash is 404, an expired or used token is 410.
  - Every side effect below runs in the same transaction, so of two concurrent confirms exactly one succeeds and the other gets 410.
  - `lookup` is a plain read and does not claim.
- **`confirm_verification(db, token)`**
  - The token is claimed atomically. Its snapshot must equal `lower(profile.email)`, else 410 (the transaction is rolled back).
  - Sets `email_verified_at` (kept if already set) and `used_at`.
  - Calls `email_acl.clear_bounce_suppression(address)` and commits.
- **`confirm_password_reset(db, token, password)`**
  - Claims the token atomically, sets `password_hash = hash_password(password)` (Google-only accounts included) and marks every other unused reset token of the user used.
  - Sets `email_verified_at` when the snapshot matches and it is NULL (I-6).
  - Enqueues `password_changed` (`auth:<token_id>:changed`, payload `changed_at`) and commits.
- **Storage.** Raw tokens exist only in the link and in the queue payload until a final state.
- **Accepted (M-3).** Reissuing marks earlier tokens used, but an earlier token's still-queued mail is sent with a dead link (410 on use).

**R13. Auth endpoints (`app/auth/router.py`, prefix `/api/auth`)**
All bodies use Pydantic with the project's 400 mapping. `app/core/errors.py` has no 410, so these routes build their 404/410/503 replies from a route-local map modelled on `_GOOGLE_ERRORS` (`auth/router.py`): `status → (error, Polish message)` rendered as `ErrorResponse`. `account_tokens.py` raises the small exceptions `AccountTokenNotFound` (404) and `AccountTokenGone` (410), and the routes translate them. The unsubscribe and preferences routes use the same pattern for their 404/400. No token endpoint returns 401.

| Row | Method & path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| 74 | `POST /password-reset` | PUBLIC | `{email}` (normalised) | 202, no body (always) | 503 „Wysyłka maili jest chwilowo niedostępna. Spróbuj później.” when email is disabled |
| 75 | `POST /password-reset/confirm` | PUBLIC | `{token, password}` (`password` `min_length=1`, as register) | 204 | 404 „Ten link jest nieprawidłowy.”; 410 „Ten link do zmiany hasła jest już nieważny.” |
| 76 | `POST /email-verification/confirm` | PUBLIC | `{token}` | 204 | 404 as above; 410 „Ten link wygasł albo został już użyty.” |
| 77 | `POST /email-verification` | `require_any("EDIT")` | none | 202, no body (always, also when silenced) | 503 as above |
| 82 | `POST /account-tokens/lookup` | PUBLIC, no side effects | `{token, purpose: "VERIFY_EMAIL" \| "PASSWORD_RESET"}` | 200 `{email}` | 404 / 410 as above |

Every response from these routes sets `Cache-Control: no-store`.

**R14. Profile exposure**
- `users/schemas.py` gets `MyProfileResponse(UserProfileResponse)` with `email_verified: bool | None`. It is null when `EMAIL_ENABLED=false` or the profile has no email; otherwise it is `email_verified_at is not None`.
- It is used only by the `/api/people/me` routes built through `_to_my_profile_response` (GET and both PATCHes). `UserProfileResponse` for `/api/people/{id}` stays unchanged, with exact key-set tests. The `ME_KEYS` pin in `tests/test_my_profile.py` (around l.122) gains `email_verified`.
- `bootstrap_person_account` gets the keyword `email_verified: bool = False`.
- In `auth/service.py`:
  - `_bootstrap_google_account` passes `email_verified=claims.email_verified`;
  - `_log_in_linked` sets the column under R3's rule.

### Backend — platform

**R15. Configuration (`app/config.py`, names only)**
| Setting | Type, default |
|---|---|
| `EMAIL_ENABLED` | bool, false |
| `EMAIL_NOTIFICATIONS_ENABLED` | bool, false |
| `EMAIL_BACKEND` | `mailgun` \| `smtp` \| `log`, default `log` |
| `EMAIL_PROVIDER_API_URL` | str \| None |
| `EMAIL_PROVIDER_API_KEY` | str \| None |
| `EMAIL_FROM_ADDRESS` | str \| None |
| `EMAIL_FROM_NAME` | str, default `Gooo` |
| `EMAIL_REPLY_TO_ADDRESS` | str \| None |
| `EMAIL_LINK_SIGNING_SECRET` | str \| None |
| `EMAIL_WEBHOOK_SIGNING_KEY` | str \| None |
| `EMAIL_DAILY_CAP` | int ≥ 0, default 100 |
| `EMAIL_SMTP_HOST` | str \| None |
| `EMAIL_SMTP_PORT` | int, default 1025 |
| `APP_PUBLIC_BASE_URL` | str \| None (no trailing slash) |

- A `mode="before"` validator turns an empty or whitespace-only placeholder into `None` (bools: empty → default).
- The property `email_configuration_errors` lists the names that are missing or invalid while `EMAIL_ENABLED=true`:
  - always: `EMAIL_FROM_ADDRESS`, `EMAIL_LINK_SIGNING_SECRET` (at least 32 characters) and `APP_PUBLIC_BASE_URL` (`https://` or `http://localhost…`);
  - `mailgun`: also `EMAIL_PROVIDER_API_URL` (`https://`), `EMAIL_PROVIDER_API_KEY` and `EMAIL_WEBHOOK_SIGNING_KEY`;
  - `smtp`: also `EMAIL_SMTP_HOST`.
- The lifespan raises a `RuntimeError` naming only the variable names, after `clock.check_timezone()`.
- Startup INFO: `EMAIL_ENABLED=%s EMAIL_NOTIFICATIONS_ENABLED=%s EMAIL_BACKEND=%s`. No value is ever logged.
- A startup WARNING `EMAIL_BACKEND=<log|smtp> with EMAIL_ENABLED=true: mail is not delivered to real inboxes` appears whenever `EMAIL_ENABLED=true` and the backend is not `mailgun`. The log backend marks mail SENT, and SMTP has no TLS.
- Also: `.env.example` (empty placeholders and a comment block), the `docker-compose.yml` backend `environment` (`${NAME:-}` / `${EMAIL_ENABLED:-false}`), and a `mailpit` service with a pinned image tag and `profiles: ["dev"]`, SMTP 1025 on the compose network and its UI on `127.0.0.1:8025`.
- `jinja2` is added with `uv add`, and `uv.lock` ships with it.

**R16. Platform hooks**
- **Clock.** `app/core/clock.py` gains `local_to_utc(naive_local) -> naive UTC`, used for the Warsaw midnight and quiet-hours checks.
- **Matrix.** The `AUTHORIZATION_MATRIX` rows:
  - directly after row 73, in this exact order: 74, 75, 76, 82 (PUBLIC POST), then 77 (`("EDIT",)`). The ordering test asserts this sequence;
  - 78 and 79 (PUBLIC POST) and 80 (`GET ^/api/email/preferences$` → `("READ",)`) and 81 (`PUT` → `("EDIT",)`) after row 69;
  - each with a justification comment like rows 72/73.
- **Routers.** `main.py` includes `email_router` before `system_router` and schedules the job.
- **Slugs.** `verify-email`, `reset-password` and `unsubscribe` go into `app/organizations/slugs.py::RESERVED_SLUGS` and `routing/reservedSlugs.ts` together.

### Frontend

**F1. API and hooks**
- `api/auth.ts`:
  - `requestPasswordReset(email)`;
  - `confirmPasswordReset(token, password)`;
  - `requestEmailVerification()`;
  - `confirmEmailVerification(token)`;
  - `lookupAccountToken(token, purpose)`.
- New `api/email.ts`:
  - `getEmailPreferences()`;
  - `updateEmailPreference({category, enabled})`;
  - `unsubscribe(token, scope)`;
  - the types `EmailPreferencesResponse`, `EmailCategory`, `Suppression`.
- `api/people.ts`: `MyProfileResponse = UserProfileResponse & { email_verified: boolean | null }`, returned by `getMyProfile`, `updateMyProfile` and `updateMyProfileAppearance`, and typed through `useMyProfile` and AppData.
- Hooks in `src/hooks/`:
  - `useEmailPreferences()` (key prefix `EMAIL_PREFERENCES_KEY`, `update(category, enabled)` as a `useCallback` write that awaits the invalidation);
  - `useEmailVerificationRequest()` (`request()`, `sending`, `sent`, `secondsLeft` with a 60 s local cooldown, `error`);
  - `useAccountTokenLookup(token, purpose)`: a query with `retry: false`, `staleTime: Infinity`, `refetchOnWindowFocus: false` and `refetchOnReconnect: false`, so a used token is never re-read into "invalid" after a successful confirm (M-6);
  - plain `useCallback` writes for the confirms.
- New `useOptionalPanelReload()` in `features/panel/appDataStore.ts`. It reads `useContext(AppDataContext)` directly and returns a no-op when there is no `AppDataProvider` (M-5); `usePanelReload` stays as it is.
- After a verification confirm or a resend request: await the invalidation of `MY_PROFILE_KEY` and `EMAIL_PREFERENCES_KEY`, then call `useOptionalPanelReload()`. It reloads on `/settings` and Home and does nothing on `/verify-email`.
- No `useMutation`. 503 maps to the Polish 503 copy.

**F2. `/settings`** (`app/(public)/(panel)/settings/page.tsx` → `features/email/EmailSettingsView.tsx`, `features/email/emailSettingsViewState.ts`)
- The view state `resolveEmailSettingsView({preferences, loading, error, sent})` has the kinds `loading`, `error` and `ready`.
- **`ready` address state precedence (M-10).**
  1. `complaint` — suppression COMPLAINT, whatever else is true;
  2. else `unknown` — when `email_verified === null` (email off or no address);
  3. else `sent` — a resend in this view succeeded;
  4. else `bounce` — suppression BOUNCE;
  5. else `unverified` — `email_verified === false`;
  6. else `verified`.

  `togglesDisabled` is true for `complaint`, `sent`, `bounce` and `unverified`. `it.each` covers the combinations: BOUNCE + unverified → bounce; COMPLAINT + unverified → complaint; sent after bounce → sent; null + BOUNCE → unknown; COMPLAINT + null → complaint.
- **Loading and error (proposed copy).**
  - `loading`: a skeleton of the address card and three rows.
  - `error` (network/5xx): `role="alert"` „Nie udało się wczytać ustawień powiadomień.” with the button „Spróbuj ponownie” (`refetch`).
- Page parts, from the mockup:
  - the header „Powiadomienia e-mail” with a back link „‹ Konto”;
  - the intro „Wybierz, o czym chcesz dostawać maile. Powiadomienia w aplikacji działają zawsze.”;
  - the card „Twój adres” with the address and a badge (Potwierdzony / Niepotwierdzony / Wstrzymane; no badge for `unknown`). For `unknown` the line shows the address, or (proposed) „Brak adresu e-mail” when `email` is null, with no resend button;
  - the unverified text „Potwierdź adres, żeby maile zaczęły przychodzić. Do tego czasu nic nie wysyłamy.” with the button „Wyślij link weryfikacyjny”;
  - the sent text „Wysłaliśmy link na <email>. Sprawdź skrzynkę (także spam).” with „Wyślij ponownie za N s” (`aria-disabled` during the cooldown), as `role="status"`;
  - the complaint text „Twój adres oznaczył nasz mail jako spam, więc przestaliśmy wysyłać powiadomienia. Jeśli to pomyłka, napisz do nas: <support_address>.”;
  - the bounce text (proposed) „Maile na ten adres nie dochodziły, więc przestaliśmy je wysyłać. Potwierdź adres jeszcze raz, żeby je wznowić.” with the resend button;
  - the section „Powiadomienia” with the switches:
    - „Wszystkie powiadomienia e-mail” / „Wyłącza każdą kategorię poniżej”;
    - „Rezerwacje i wymiany” / „Ktoś wziął Twoją rzecz, propozycje wymian, potwierdzenie po terminie”;
    - „Szukam” / „Nowe rzeczy pasujące do tego, czego szukasz (najwyżej 1 mail dziennie na wpis)”;
  - the locked row „Wiadomości o koncie” / „Weryfikacja adresu, reset i zmiana hasła” / „Zawsze włączone” (an info row, not a switch);
  - while `notifications_live === false`, an info line (`role="status"`, proposed, M-7) „Powiadomienia e-mail ruszają wkrótce. Twoje ustawienia zapiszemy już teraz.” sits directly under the „Powiadomienia” heading. The switches stay visible and keep the rules below.
- Switch behaviour:
  - Switches are disabled while `unverified`, `sent`, `complaint` or `bounce`.
  - Category switches show `all_enabled && enabled` and are disabled while ALL is off.
  - Each switch saves optimistically and reverts on failure, with a `role="alert"` message below its row (component `features/email/EmailCategoryToggle.tsx` over `ToggleRow`/`Switch`). The message is the server's Polish message via `extractProblemMessage`, else (proposed) „Nie udało się zapisać zmiany. Spróbuj ponownie.”
- `settings` is added to `View`, `PROTECTED_PREFIXES` and `ACCOUNT_SUBVIEWS`.

**F3. Home banner** (`features/email/VerifyEmailBanner.tsx`, in `features/panel/HomeView.tsx` directly under the greeting)
- Rendered only when `profile.email_verified === false`, in the `HintCard` look with no dismiss, in a `role="status"` wrapper.
- Before sending: „Potwierdź swój adres e-mail” / (neutral, user decision M-7, replacing the mockup's promise of exchange mails) „Potwierdź adres, żebyśmy mogli wysyłać Ci ważne wiadomości.” / „Wyślij link”.
- A failed request shows the inline `role="alert"` with the server message or „Nie udało się wysłać linku. Spróbuj ponownie.” (proposed).
- After sending: „Sprawdź skrzynkę” / „Wysłaliśmy link na <email>. Kliknij go, żeby potwierdzić adres.” / „Wyślij ponownie” (`aria-disabled` during the cooldown).
- `HintCard` gets an optional `onDismiss`: the ✕ renders only when it is given.

**F4. Account row**
- `features/account/AccountView.tsx`, section „Ustawienia”: a `ListCard` row „Powiadomienia e-mail” → `viewPath("settings")` above „Wyloguj się”.

**F5. Login link**
- `features/auth/LoginForm.tsx`: a `Link` „Nie pamiętasz hasła?” (`AUTH_LINK`) → `/reset-password` between the password field and the submit button.
- Inside `AuthSheet` the link navigates away and closes the sheet. `LoginForm` gets an optional `onNavigateAway` callback, which `AuthSheet`'s host wires to its `onClose`, so focus is not trapped in a stale sheet.

**F6. `/reset-password`** (`app/(public)/reset-password/page.tsx` → `features/auth/ResetPasswordPage.tsx` + `resetPasswordViewState.ts`, in `AuthLayout`)
- **Guarding (user decision M-9).** Only the no-token branch is wrapped in `AuthGuard requireAuth={false}`. The `?token=` branch renders for everyone, so a logged-in user, including a Google-only one, can use a reset link.
- **View precedence (M-6).** Confirm success > confirm error > lookup result. A lookup that changes after success never replaces the success screen.
- **Loading and error (proposed copy).**
  - `loading`: while the lookup runs, a busy state with the „Ustaw nowe hasło” title and the fields disabled.
  - `error` (network/5xx of the lookup, the request or the confirm): `role="alert"` „Coś poszło nie tak. Spróbuj ponownie.” with „Spróbuj ponownie”, which retries the failed call.
- Without a token:
  - **form**: „Nie pamiętasz hasła?” / „Podaj adres konta, wyślemy link do ustawienia nowego hasła.”, the field E-mail, „Wyślij link”, „Wróć do logowania”;
  - **sent**: „Sprawdź skrzynkę” / „Jeśli konto z adresem <email> istnieje, wysłaliśmy na nie link. Jest ważny przez godzinę.” / „Nie widzisz maila? Zajrzyj do spamu albo spróbuj ponownie za minutę.” / „Wróć do logowania”;
  - **unavailable** (503): the form with `role="alert"` „Wysyłka maili jest chwilowo niedostępna. Spróbuj później.”
- With `?token=`, after the lookup:
  - **form**: „Ustaw nowe hasło” / „Dla konta <email>”, the fields „Nowe hasło” and „Powtórz hasło”;
    - a mismatch shows the inline `role="alert"` „Hasła nie są takie same.” with `aria-invalid`/`aria-describedby`;
    - „Zapisz hasło” is `aria-disabled` while invalid;
  - **invalid** (404/410): „Link wygasł” / „Ten link do zmiany hasła jest już nieważny: minęła godzina albo został użyty.” / „Wyślij nowy link” (to the request form);
  - **success**: „Hasło zmienione” / „Możesz się teraz zalogować nowym hasłem. Wysłaliśmy też potwierdzenie na Twój adres.” / „Przejdź do logowania”.
    - On success, `clearSession()` (`auth/session.ts`) runs when a session exists.
    - The button calls `replaceDocument("/login")` for a full reload.
- **Referrer.** The page sets `<meta name="referrer" content="no-referrer">`, so the token never leaks through the Referer header.

**F7. `/verify-email`** (`app/(public)/verify-email/page.tsx` → `features/email/VerifyEmailPage.tsx` + `verifyEmailViewState.ts`, no guard, in `AuthLayout`)
- A GET has no side effects; it does the lookup only.
- The page sets `<meta name="referrer" content="no-referrer">`.
- **View precedence (M-6).** Confirm success > confirm error > lookup. The `it.each` table includes "success, then lookup 410 → success".
- **loading**: a busy state while the lookup runs. **error** (network/5xx): `role="alert"` „Coś poszło nie tak. Spróbuj ponownie.” with „Spróbuj ponownie” (proposed).
- **confirm**: „Potwierdź adres” / „Kliknij, żeby potwierdzić <email>.” / the button „Potwierdź adres”. The confirm POST happens only on click.
- **success**: ✅ „Adres potwierdzony” / (neutral, user decision M-7) „Dziękujemy, Twój adres jest potwierdzony. Możemy wysyłać Ci ważne wiadomości. Ustawienia maili zmienisz w ustawieniach.” / „Ustawienia powiadomień” → `/settings`.
- **invalid** (lookup or confirm 404/410, or a missing token): „Link nieważny” / „Ten link wygasł (48 h) albo został już użyty.”
  - A logged-in visitor sees „Wyślij nowy link” (`useEmailVerificationRequest`).
  - A guest sees „Zaloguj się, żeby wysłać nowy.” linked through `authPath("login", "/settings")`.

**F8. `/unsubscribe`** (`app/(public)/unsubscribe/page.tsx` → `features/email/UnsubscribePage.tsx` + `unsubscribeViewState.ts` + `unsubscribeToken.ts`)
- `unsubscribeToken.ts` reads the category segment; the signature is checked only by the server.
- The page sets `<meta name="referrer" content="no-referrer">`.
- **choice**: „Wypisz się z maili” / „Ten link dotyczy kategorii <label>.” / „Wyłącz tę kategorię” (`scope=category`) / „Wyłącz wszystkie powiadomienia e-mail” (`scope=all`) / „Maile o koncie (reset hasła) zawsze dochodzą.”
- **error** (network/5xx of the POST): `role="alert"` „Nie udało się zapisać. Spróbuj ponownie.” while the choice buttons stay (proposed).
- **done**: 👋 „Gotowe” / „Nie wyślemy już maili z kategorii <label>. Powiadomienia w aplikacji działają bez zmian.”; for scope all (proposed) „Nie wyślemy już żadnych powiadomień e-mail. Powiadomienia w aplikacji działają bez zmian.”; then „Zmień ustawienia powiadomień” → `/settings`.
- **invalid** (unparseable token or a POST 404): „Nieprawidłowy link” / „Nie rozpoznajemy tego linku. Ustawienia maili zmienisz po zalogowaniu.” / „Przejdź do ustawień” → `/settings`.

**F9. Routing tests and fixtures**
Update:
- `src/test/reservedSlugs.test.ts`;
- `routeManifest.test.ts` (the 3 guest-open pages);
- `panelPages.ts` (`/settings`);
- `proxy.test.ts` (`/settings` protected; the 3 public pages are not);
- `ssrSafety.test.tsx` (the 3 public pages, plus `email_verified` in the profile fixture).

The `no-referrer` policy of F6–F8 is set by `export const metadata = { referrer: "no-referrer" }` in each of the three route files. They are server files that render the `"use client"` feature entry, per the components standard.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Fidelity: high (real tokens from `globals.css`, `authStyles.ts`, `appComponents.tsx`, lucide icons, Polish copy, field order and states).

| ID | Mockup | Implemented by | States |
|---|---|---|---|
| `screen:settings-email` | `analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html` | `app/(public)/(panel)/settings/page.tsx` → `features/email/EmailSettingsView.tsx` | verified, unverified, link sent, complaint (+ derived bounce, unknown, loading, error, „wkrótce” note) |
| `screen:home-verify-banner` | `analysis/design-context/mockups/start-baner-weryfikacji-adresu.html` | `features/email/VerifyEmailBanner.tsx` in `features/panel/HomeView.tsx` | before, after sending, hidden (verified or null); description replaced by neutral copy (M-7) |
| `screen:account-settings-row` | `analysis/design-context/mockups/konto-sekcja-ustawienia.html` | `features/account/AccountView.tsx` | new row above logout |
| `screen:login-forgot-link` | `analysis/design-context/mockups/logowanie-link-nie-pamietasz-hasla.html` | `features/auth/LoginForm.tsx` (page and `AuthSheet`) | link under the password |
| `screen:reset-password-request` | `analysis/design-context/mockups/reset-hasla-prosba.html` | `features/auth/ResetPasswordPage.tsx` (no token) | form, neutral sent, 503 |
| `screen:reset-password-new` | `analysis/design-context/mockups/reset-hasla-nowe-haslo.html` | `features/auth/ResetPasswordPage.tsx` (token) | form with a validation error, expired/used, success |
| `screen:verify-email` | `analysis/design-context/mockups/potwierdzenie-adresu-verify-email.html` | `features/email/VerifyEmailPage.tsx` | confirm, success, invalid (logged in / guest) |
| `screen:unsubscribe` | `analysis/design-context/mockups/wypisanie-unsubscribe.html` | `features/email/UnsubscribePage.tsx` | choice, done, invalid |
| `screen:emails` | `analysis/design-context/mockups/maile-powiadomienie-i-weryfikacja.html` | `app/email/templates/{base,notification,verify_email}.{html,txt}.j2` | notification with List-Unsubscribe; verify_email without |
| `component:email-category-switch` | `analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html` | `features/email/EmailCategoryToggle.tsx` over `ToggleRow`/`Switch` | on, off, disabled, saving, reverted with an alert |
| `component:verify-banner` | `analysis/design-context/mockups/start-baner-weryfikacji-adresu.html` | `features/email/VerifyEmailBanner.tsx` over `HintCard` | `role="status"`, no dismiss |

Layout: the public token pages use the `AuthLayout` card, the panel page uses the panel shell with the bottom tab bar, and the mail templates are a single 600 px column with inline CSS.

## Reusable Components

### Existing Code to Leverage
| Need | Reuse | Path |
|---|---|---|
| Bell choke point | `create_notification`, `create_notifications`, `NotificationEntry` | `src/backend/app/notifications/service.py` |
| Want id for the day key | `_entry`, `write_bell_rows` | `src/backend/app/wants/application/match_notifications.py` |
| ACL shape | `notifications_bridge.py`, `wants/infrastructure/notifications_acl.py`, `wants/infrastructure/users_acl.py` | `src/backend/app/groups/infrastructure/`, `src/backend/app/wants/infrastructure/` |
| Setter port + fake fixture | `set_embedder`/`is_enabled`, `fake_embedder` | `src/backend/app/embeddings/service.py`, `src/backend/tests/conftest.py` |
| Job shape and logging | `_run_embedding_reconcile`, `_reconcile_side`, scheduler `add_job` | `src/backend/app/main.py` |
| httpx call, `compare_digest`, "never log credentials" | Google verifier | `src/backend/app/auth/google.py` |
| Password hashing | `hash_password` | `src/backend/app/core/security.py` |
| Account bootstrap | `bootstrap_person_account`, `_bootstrap_registration`, `register`, `find_party_id_by_principal`, `get_profile_by_principal`, `normalize_email` | `src/backend/app/users/service.py`, `src/backend/app/users/schemas.py` |
| `/me` response builder | `_to_my_profile_response` | `src/backend/app/users/router.py` |
| Settings validators and `*_configured` | `Settings` | `src/backend/app/config.py` |
| Matrix rows template | rows 47, 66–69, 72/73 | `src/backend/app/core/authorization_matrix.py` |
| Conflict mapping | `TRANSACTION_CONFLICTS`, `mapped_transaction_conflicts` | `src/backend/app/db.py` |
| Clock | `local_now`, `utc_to_local`, `format_term_when`, `warsaw_zone` | `src/backend/app/core/clock.py` |
| Migration + round-trip test | `0107_user_identities.py`, `test_user_identities_migration.py` | `src/backend/alembic/versions/`, `src/backend/tests/` |
| Boundary and clock guards | `_POINTS_IMPORTERS` tests, `_GUARDED_DIRS` | `src/backend/tests/test_module_boundaries.py`, `src/backend/tests/test_domain_clock_guard.py` |
| Auth card shell and styles | `AuthLayout`, `AUTH_INPUT`/`AUTH_LABEL`/`AUTH_SUBMIT`/`AUTH_LINK`, `AuthGuard`, `LoginPage` | `src/frontend/src/features/auth/`, `src/frontend/src/auth/AuthGuard.tsx` |
| Switches, hint card, list rows | `ToggleRow`, `Switch`, `HintCard`, `ListCard` | `src/frontend/src/components/shared/appComponents.tsx` |
| Optimistic save + revert | `WantNotificationToggle` | `src/frontend/src/features/wanted/WantNotificationToggle.tsx` |
| Query + `useCallback` writes | `useMyProfile`, `useUpdateMyProfile`, `useWants` | `src/frontend/src/hooks/` |
| Full reload after a session change | `replaceDocument` | `src/frontend/src/routing/documentNavigation.ts` |
| Guest login link | `authPath` | `src/frontend/src/auth/authPaths.ts` |
| Panel data reload | `useAppData`, `usePanelReload` | `src/frontend/src/features/panel/appDataStore.ts` |
| View-state pattern | `wantedListViewState.ts` + test, `termViewState.ts` | `src/frontend/src/features/` |
| Test helpers | `renderWithRoute`, `createQueryWrapper`, `ssrSafety.test.tsx` | `src/frontend/src/test/` |

Small extensions to existing code:
- `HintCard`: `onDismiss` becomes optional;
- `ToggleRow`: a `disabled` prop passed through to `Switch`;
- `bootstrap_person_account`: the `email_verified` keyword;
- `NotificationEntry`: `topic_id`;
- `create_notification`: an explicit id.

### New Components Required
| New | Why existing code does not cover it |
|---|---|
| `app/email` module (queue, rules, job, rendering, senders, links, webhook, router, users ACL) | No email capability exists. `outbox_entries` has no backoff or `send_after`, re-runs every handler and would duplicate bells (ADR-003). |
| `email_messages`, `email_preferences`, `email_suppressions`, `account_tokens`, `user_profiles.email_verified_at` | No table holds delivery state, consent, suppression, revocable one-time tokens or verification. JWTs cannot be revoked (ADR-006). |
| `notifications/infrastructure/email_acl.py`, `auth/infrastructure/email_acl.py` | The boundary rule requires one narrow entry per consumer; neither package has `infrastructure/` yet. |
| `app/auth/account_tokens.py` | It must be callable from `users.service` without importing `auth.service` (the cycle). |
| Jinja2 templates | No templating exists; autoescape and `StrictUndefined` are needed for user-written item names (ADR-008). |
| `MyProfileResponse` | `email_verified` must not leak onto other users' profiles. |
| Frontend `features/email/*` views, `ResetPasswordPage`, view-state files, `api/email.ts`, the three hooks | No settings, token or unsubscribe surfaces exist. |
| `EmailCategoryToggle` | `WantNotificationToggle` hard-codes want copy and styling; the mockup uses `ToggleRow`/`Switch`. |

## Technical Approach
- **Atomicity.** The bell hook and the account flows write `email_messages` in the caller's transaction, with no commit. The job is the only reader. The webhook and unsubscribe write only their own rows.
- **Flags.**
  - `EMAIL_ENABLED=false`: nothing is enqueued, the job is not scheduled, the request endpoints return 503, and `email_verified` is null (no banner).
  - `EMAIL_NOTIFICATIONS_ENABLED=false`: the bell hook enqueues nothing, and the job claims only TRANSACTIONAL rows. NOTIFICATION rows already queued wait and expire through `expires_at` (24 h), so flipping the flag is an emergency stop for bell mail that leaves password resets working (M-4). `/settings` (with the „wkrótce” note), `/unsubscribe` and the webhook keep working.
  - Re-enabling after a pause cannot burst stale mail, because rows past `expires_at` are skipped as `expired`.
- **Import graph.**
  - notifications → `notifications/infrastructure/email_acl` → `app.email.service`;
  - `users.service` → `app.auth.account_tokens` → `app.auth.infrastructure.email_acl` → `app.email.service`;
  - `app.email` reads users and parties only through `email/infrastructure/users_acl.py` (Core table refs or the users service read helpers).
- **Lock and transaction shape of the job.**
  - The claim is a short transaction (SKIP LOCKED, committed before any network call).
  - Sending runs with no transaction open.
  - The result write is one statement in a second short transaction.
  - The webhook may land between the two. Because every outcome is guarded by `WHERE status = 'SENDING'`, a webhook-raised status is never lowered and the row is not re-sent. `sent_at`, `provider_message_id` and the token removal still apply.
  - The webhook uses Core statements, so the BaseEntity version check never turns this race into a `StaleDataError`.
- **Statement budget.**
  - The hook issues 0 or 1 statements.
  - The job issues a constant number per run (recover, expire, claim, four binding reads, skip write, result write), independent of the batch size.
- **Frontend.**
  - The token pages are public and outside `PROTECTED_PREFIXES`. They never return 401, so `api/client.ts` never logs the user out.
  - `/reset-password` only redirects logged-in visitors away (`AuthGuard requireAuth={false}`).
  - Every multi-screen page switches over `view.kind` from a pure `resolve…View()`.
- **Docs.**
  - `.maister/docs/project/architecture.md`:
    - replace l.480 „In-app notifications only” with the email channel;
    - add a section „E-mail (`app/email/`)” (flow, flags, matrix rows 74–82, keys, job, webhook, privacy rules);
    - add Mailgun EU under External Integrations, the new tables under Database Schema, and the `EMAIL_*`/`APP_PUBLIC_BASE_URL` names under Configuration;
    - add the 0110–0112 runbook.
  - `tech-stack.md`: `jinja2` version, Mailpit image.
  - `standards/backend/security.md`: rows 74–79/82 as further auth-flow and provider PUBLIC POST exceptions next to 72/73, the HMAC-authenticated webhook, the hashed single-use account tokens with the atomic claim, and `Referrer-Policy: no-referrer` on token pages.
  - `INDEX.md`: summaries.
  - Root `CHANGELOG.md` „## Unreleased”: a Polish bullet, e.g. „maile z Gooo: potwierdzenie adresu, reset hasła (także dla kont Google), powiadomienia o rezerwacjach, wymianach i rzeczach z listy „Szukam” z ustawieniami w `/settings` i wypisem jednym kliknięciem”.
- **Runbook 0110–0112** (in `architecture.md`):
  1. `pg_dump` first. Run the read-only slug check `SELECT slug FROM organizations WHERE lower(slug) IN ('verify-email', 'reset-password', 'unsubscribe')`. It must return no rows; otherwise rename those organizations before deploying the web image.
  2. No image-only rollback past 0110: an old image fails on an unknown revision.
  3. Downgrade from the new image: `downgrade 0109` is unguarded and lossy (queue log, preferences, suppressions, tokens, verification state).
  4. Deploy with `EMAIL_ENABLED=false` → health check → set the DNS (an EU-region domain, SPF, DKIM 2048, MX, DMARC `p=none`) and the webhooks (`delivered`/`failed`/`complained` → `https://<app>/api/email/webhooks/mailgun`) → check the variables by presence only → `EMAIL_ENABLED=true` and `up -d backend`. A fail-fast error means the flag goes back to false; the backend has no restart policy.
  5. Verify: the startup line, the `email send:` line, `grep "FAILED after"`, a seed test (`spf/dkim/dmarc=pass`), DELIVERED statuses, and that nginx passes POSTs to `/api/email/*` without a redirect.
  6. After at least 1 week clean (bounce < 2 %, no complaints) and D14 published, set `EMAIL_NOTIFICATIONS_ENABLED=true`. Setting it back to false is the emergency stop for bell mail: queued bell rows are no longer claimed and expire within 24 h. Webhook retries older than 5 min are rejected as stale; check Mailgun's event log after a webhook outage.
  7. DMARC `none → quarantine → reject`.
  8. A COMPLAINT is lifted only by support: `DELETE` the suppression row and the provider-side entry.

## Implementation Guidance

### Testing Approach
- 2–8 focused tests per implementation step group. Test verification runs only the new tests, not the entire suite.
- Backend runs with `uv run --no-sync python -m pytest tests/<file>` from `src/backend`. `tests/conftest.py` (beside the MODERATION/EMBEDDINGS lines, before `app.config` is imported) sets `os.environ["EMAIL_ENABLED"] = "false"` and `os.environ["EMAIL_NOTIFICATIONS_ENABLED"] = "false"`; tests switch flags with `monkeypatch.setattr(settings, …)` and wire `fake_email_sender`.
- Planned groups:
  1. **Migrations** (`tests/test_email_migrations.py`, 3–4):
     - 0110 creates the tables and named constraints;
     - the downgrade-then-upgrade-head round trip for 0110 / 0111 / 0112;
     - the 0112 backfill sets only verified, matching, case-insensitive identities.
  2. **Enqueue hook** (`tests/test_email_enqueue.py`, 6–8):
     - an MVP bell creates one PENDING row with the right key and category;
     - a non-MVP kind creates nothing;
     - both flags gate it;
     - three same-day MATCH entries (`freeze_local_now`, incl. 23:00 → next day) create one row;
     - a retried `TERM_CONFIRMATION_NEEDED` creates no second row and no error;
     - `count_queries`: exactly one extra statement, zero for empty input; a new pin of `["INSERT","INSERT"]` beside the unchanged `test_wants_notifications.py:92`;
     - a rollback drops the bell and the mail.
  3. **Send job** (`tests/test_email_sending.py`, 8):
     - every `skip_reason` incl. `expired`;
     - quiet hours, and `EMAIL_NOTIFICATIONS_ENABLED=false`, claim only TRANSACTIONAL (parametrised);
     - retryable → backoff, then FAILED after `MAX_ATTEMPTS` with the ERROR line;
     - stuck SENDING: NOTIFICATION → PENDING, TRANSACTIONAL → FAILED;
     - a retryable or permanent outcome after a webhook raised the row to DELIVERED keeps DELIVERED; a sent outcome still sets `sent_at` and removes the token (H-1);
     - the token is removed in final states, incl. permanent → FAILED;
     - the statement count is constant for 1 vs 20 rows;
     - `caplog` has no address, token or subject.
  4. **Rendering + senders** (`tests/test_email_rendering.py`, `tests/test_email_senders.py`, 6–8):
     - `StrictUndefined` raises;
     - `<script>` in a message is escaped;
     - Polish characters and Warsaw dates;
     - List-Unsubscribe only on NOTIFICATION;
     - Mailgun via `httpx.MockTransport`: form fields, Basic auth, `o:tracking=no`, 2xx/4xx/429/5xx/timeout classification;
     - SMTP refused → permanent.
  5. **Webhook** (`tests/test_email_webhook.py`, 7):
     - a valid HMAC updates the status;
     - a bad signature, a stale timestamp or a replay → 401;
     - out-of-order events never lower the status;
     - permanent `failed` → BOUNCE; `complained` → COMPLAINT + the category off;
     - an unknown message or a non-UUID `email_message_id` → 200;
     - an event on a PENDING/FAILED row raises it, an event on a SKIPPED row keeps SKIPPED but still suppresses;
     - a processing failure → 503 and the same signed payload is accepted on retry (M-1).
  6. **Preferences + unsubscribe** (`tests/test_email_preferences.py`, 6–8):
     - GET defaults and the exact key set incl. `notifications_live` (true/false by flag);
     - PUT upsert and 400 for an unknown category;
     - one-click form POST with no auth → 200, idempotent;
     - JSON scope `all`;
     - a bad signature → 404;
     - the suppression and `support_address` fields;
     - login-only (an `mcp:*` token → 403).
  7. **Account tokens** (`tests/test_account_tokens.py` + extend `tests/test_google_login.py`, 8):
     - register enqueues `verify_email` atomically;
     - reset is always 202 (existing, missing, Google-only, rate-limited) and 503 when disabled;
     - expired or used → 410, unknown → 404, never 401;
     - reset sets the password for Google-only and marks the email verified on a match;
     - verify with a snapshot mismatch → 410; verify clears BOUNCE but not COMPLAINT;
     - two concurrent confirms of one token (two sessions, `asyncio.gather`): exactly one 204, the other 410 (M-2);
     - the lookup has no side effects (a later confirm still succeeds);
     - new and linked Google sign-ins set `email_verified_at`.
  8. **Guards, matrix, config, profile** (existing files + `tests/test_email_config.py`, 5–6):
     - the boundary importer set;
     - the clock guard dir;
     - matrix rows 74–82 incl. the order 73, 74, 75, 76, 82, 77;
     - `email_configuration_errors` per backend, a placeholder treated as unset, and the non-mailgun startup WARNING;
     - `/me` `email_verified` true/false/null while `/api/people/{id}` lacks it, with `ME_KEYS` in `tests/test_my_profile.py` updated;
     - reserved-slug parity.
  9. **Frontend view states** (`src/test/*ViewState.test.ts` for settings, reset, verify and unsubscribe: 4 files of `it.each` tables) and `unsubscribeToken` parsing. The tables include:
     - the M-10 precedence combinations;
     - loading and error rows;
     - "confirm success, then lookup 410 → success" for reset and verify (M-6).
  10. **Frontend pages** (`renderWithRoute` + `createQueryWrapper`, 8):
      - `/reset-password` request → neutral sent, and 503 alert;
      - `/reset-password?token=` while logged in renders the form; success clears the session and does a full reload (M-9);
      - mismatch alert;
      - `/verify-email` confirm only on click, rendered without `AppDataProvider` (M-5), guest vs logged-in invalid;
      - `/unsubscribe` both scopes;
      - `/settings` optimistic toggle revert with an alert;
      - disabled switches while unverified;
      - the „wkrótce” note when `notifications_live` is false.
  11. **Frontend integration** (4–6):
      - banner shown only on `false`, cooldown state;
      - AccountView row;
      - LoginForm link (in `AuthSheet` the click closes the sheet);
      - `proxy.test.ts`, `routeManifest.test.ts`, `panelPages.ts`, `reservedSlugs.test.ts`, `ssrSafety.test.tsx` cases.
- Typed fixture factories only (no `as Response` casts). Compare against the baseline: 32 vitest, 2 stale backend tests, mypy 15, ruff 64.

### Standards Compliance
- `standards/backend/models.md`: `BaseEntity`, string enums, `lazy="raise"`, loose cross-module ids, explicit names.
- `standards/backend/migrations.md`: explicit names, `lock_timeout`, separate schema/column/data revisions, a round-trip test per migration, a runbook in `architecture.md`.
- `standards/backend/security.md`: matrix rows with tests, `compare_digest`, hashed single-use tokens, no secrets or PII in logs, PUBLIC auth-flow POST rows justified like 72/73.
- `standards/backend/queries.md`: a constant statement count, batched `IN`/`VALUES` writes, SKIP LOCKED.
- `standards/backend/time.md`: `clock.local_now()`, the new `clock.local_to_utc`, the `app/email` guard, naive UTC audit columns.
- `standards/global/error-handling.md`: job conflicts as one WARNING, other failures logged once and not re-raised, Polish user messages.
- `standards/global/validation.md`: server-side validation, inline `role="alert"`, `aria-invalid`/`aria-describedby`, submit `aria-disabled` while invalid.
- `standards/global/minimal-implementation.md`: only the visible categories get switches, no admin UI, no purge, no speculative stream "D".
- `standards/global/conventions.md`: env names in `.env.example`, `uv.lock` shipped.
- `standards/frontend/components.md`: thin route files, `features/<domain>/`, the routing facade only, `resolve…View()` in `*ViewState.ts`, a full reload via `documentNavigation`.
- `standards/frontend/accessibility.md`: `role="switch"`, `role="status"`, `role="alert"`, `aria-disabled` + a handler guard for cooldowns, Polish labels.
- `standards/frontend/data-fetching.md`: hooks in `src/hooks/`, array keys with a prefix constant, awaited invalidation, `extractProblemMessage`.
- `standards/testing/backend-testing.md` and `frontend-testing.md`: integration-first, exact key sets, `freeze_local_now`, `vi.useFakeTimers({ toFake: ["Date"] })` for the cooldown, explicit vitest imports.

## Audit resolution
Source: `verification/spec-audit.md` (0 critical, 1 high, 9 medium, 15 low), plus the user decisions on M-7 and M-9.

| ID | Change in this spec |
|---|---|
| H-1 | R7 step 7: every outcome applies only `WHERE status = 'SENDING'`; `sent_at`/`provider_message_id` (`COALESCE`) and the token removal always apply. R10: events on PENDING/FAILED raise the status, SKIPPED stays. Test in group 3 |
| M-1 | R10: Core statements in one transaction, replay token recorded after the commit, 503 on failure, defensive id parse. Runbook skew note. Test in group 5 |
| M-2 | R12: atomic claim `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING`, 404/410 split by a follow-up read. Concurrent-confirm test in group 7 |
| M-3 | Accepted and documented (Open Questions, R12) |
| M-4 | R7 step 3 and Technical Approach: the claim takes only TRANSACTIONAL rows while `EMAIL_NOTIFICATIONS_ENABLED=false`; queued bell rows expire. Runbook emergency-stop note |
| M-5 | F1: `useOptionalPanelReload()` (no-op without `AppDataProvider`), plus awaited `MY_PROFILE_KEY` and `EMAIL_PREFERENCES_KEY` invalidation. Test in group 10 |
| M-6 | F1 lookup options (`staleTime: Infinity`, no focus or reconnect refetch). F6/F7 precedence: success > confirm error > lookup. Table rows in group 9 |
| M-7 | User decision: neutral banner and verify-success copy, `notifications_live` in `GET /api/email/preferences`, the „Powiadomienia e-mail ruszają wkrótce” note on `/settings` (F2, F3, F7, R11) |
| M-8 | Loading and error kinds with proposed Polish copy on `/settings`, `/reset-password`, `/verify-email` and `/unsubscribe`; toggle-revert alert copy; the unknown-address line (F2, F3, F6–F8) |
| M-9 | User decision: the token branch of `/reset-password` renders for everyone; success runs `clearSession()` and a full reload to `/login`; only the request form keeps `AuthGuard requireAuth={false}` (F6). Test in group 10 |
| M-10 | F2: precedence complaint > unknown (null) > sent > bounce > unverified > verified, with an `it.each` combinations table |
| L-1 | Both ADR-009 deviations labelled in Key Decisions and R4 |
| L-2 | R13: a route-local error map like `_GOOGLE_ERRORS`, `AccountTokenNotFound`/`AccountTokenGone`; R11 validates `category` in the handler for the Polish 400 |
| L-3 | R16: exact order 73, 74, 75, 76, 82, 77 asserted by the test |
| L-4 | Docs: `standards/backend/security.md` (+ INDEX) |
| L-5 | R6: `_entry(..., topic_id=None)`, passed only for MATCH |
| L-6 | Testing: `tests/conftest.py` forces both email flags false |
| L-7 | R14 and group 8: `ME_KEYS` in `tests/test_my_profile.py` |
| L-8 | R8: CTA falls back to `base_url + "/"` when `link_path` is null |
| L-9 | R9: `httpx.Timeout(10, connect=5)`, `asyncio.wait_for(…, SEND_TIMEOUT)`, `smtplib.SMTP(timeout=SEND_TIMEOUT)` |
| L-10 | R7 step 5: explicit commit before sending |
| L-11 | R15: startup WARNING when `EMAIL_ENABLED=true` and the backend is not `mailgun` |
| L-12 | `ALL` tokens dropped; „Wyłącz wszystkie” is `scope=all` on a category token (R11, F8) |
| L-13 | Accepted and documented (Open Questions) |
| L-14 | F1: `MyProfileResponse` also types `updateMyProfile`/`updateMyProfileAppearance` |
| L-15 | Runbook slug-collision query; the `AuthSheet` link closes the sheet (F5); `no-referrer` metadata on the 3 token pages (F6–F9); `party_id` canonicalised before the unsubscribe HMAC (R11) |

## Out of Scope
- Stage-3 bell kinds (`TRANSACTION_CANCELLED`, `TERM_RESCHEDULED`, …) and the `MEETINGS`/`MESSAGES`/`ORGANIZER_DIGESTS` switches.
- `WANT_EXPIRING`, `PLEDGE_*` and `NEEDED_ITEM_REMOVED` by mail; `ITEM_RESERVED_FOR_PICKUP` and `TERM_ALREADY_RESOLVED` never.
- Reminders, digests, chat-message mail, SUGGESTION/SIMILAR mail, marketing.
- Email change flow, auto-linking Google accounts, guardian invite, moderation and payment mails.
- `mailto:` unsubscribe, inbound mail, an admin log/preview UI, template localisation.
- Account deletion with suppression hashing.
- Purging `email_messages`/`account_tokens`.
- Fixing the outbox dispatcher duplicate-bell bug.
- HTTP rate limiting (nginx `limit_req`).
- Organization recipient routing and child → guardian routing (measured via `skip_reason`).
- Removing addresses from Mailgun's own suppression lists through the API.
- A user-side lift of a COMPLAINT.

## Success Criteria
1. A bell and its queue row commit atomically. The hook costs at most one extra statement and none for empty or non-MVP input (tests).
2. Outside quiet hours a mail reaches the provider within 2 minutes of the commit. TRANSACTIONAL mail is never delayed by quiet hours.
3. No NOTIFICATION mail goes to an unverified, suppressed, opted-out or organization recipient, and an unsubscribe takes effect by the next run (≤ 2 min).
4. No log line, `last_error` or report contains an address, token or mail content (`caplog`). Raw tokens leave `payload` at every final state.
5. Forgot-password always answers 202 without revealing the account. Every account with an address, Google-only included, can set a password.
6. Webhook events are idempotent and never lower a status. BOUNCE and COMPLAINT stop NOTIFICATION mail to that address.
7. All 11 design-context IDs are implemented with the mockup copy, field order and states. The new view-state, page and routing tests pass, with no regressions beyond the recorded baseline.
8. Migrations 0110–0112 pass their downgrade-then-upgrade tests, and the runbook is in `architecture.md`.
