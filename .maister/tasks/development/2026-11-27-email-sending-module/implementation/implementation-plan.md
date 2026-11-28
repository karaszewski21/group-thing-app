# Implementation Plan: app/email sending module (rollout stages 1+2)

## TL;DR
19 task groups (10 backend, 7 frontend, 1 docs, 1 test review), 117 steps, about 91–125 focused tests.
The backend builds outward from two independent roots (config/clock and the 0110–0112 data layer) to the email core (rules, links, rendering, senders), then enqueue, send job, webhook, preferences/unsubscribe and account tokens, and ends with app wiring (lifespan, job, matrix, guards).
The frontend starts from two independent roots (API/hooks and routing plumbing), then builds four page groups and a final route/SSR fixture group.
Docs and the runbook follow once backend and frontend are done, and the Test Review group closes the plan. No step commits: all work stays uncommitted.

## Key Decisions
- The spec's 11 test groups are re-cut into implementation groups so that no group exceeds 8 tests and no two unordered groups share a file. Webhook and preferences/unsubscribe are separate groups (serialised on `app/email/router.py`), and profile exposure is split from account tokens (serialised on `users/service.py`).
- `app/main.py` is edited by exactly two groups, in order. Group 7 includes `email_router` (so the webhook tests can reach it through `client`), and group 10 adds the lifespan checks, the sender wiring and the `_run_email_send` schedule.
- `tests/conftest.py` is edited by group 1 (both email flags forced to `false`) and group 3 (the `fake_email_sender` fixture, which needs the sender types).
- All matrix rows, the boundary/clock guard tests and `test_authorization_matrix.py` live in one group (10), because the matrix is a reference table checked by tests, not a runtime gate. Routes enforce through `Depends(require_any(...))` from the group that writes them.
- The frontend groups code against the spec's HTTP contract, so they do not depend on the backend groups and can run alongside them.
- The `MyProfileResponse` type change (group 11) owns every typed test fixture that `tsc` flags for the missing `email_verified`, including `ssrSafety.test.tsx`. Group 17 later adds that file's page cases.
- Backend `organizations/slugs.py` and frontend `reservedSlugs.ts` change in the same group (12), because the spec requires them "together" and a parity test covers both.
- The last group is test review, not a commit or push step. Verification and finalization belong to the calling workflow.

## Open Questions / Risks
- `.maister/docs/project/architecture.md` already has uncommitted edits in the working tree (git status). Group 18 must edit it in place and keep those edits.
- The hook sits on the shared bell path (`notifications/service.py`). A failure there breaks every notifying write path. Group 5 must keep `test_notifications.py`, `test_wants_notifications.py` (pins at l.92/l.115 unchanged with flags off), `test_term_end_scan.py` and `test_points_purchase_flow.py` green.
- `MyProfileResponse` touches about 12 frontend test fixtures. Group 11 has to fix every one that `npm run typecheck` flags, or later groups inherit typecheck noise.
- Baseline noise: 32 vitest, 2 stale backend tests, mypy 15, ruff 64. Every group compares against this baseline, not against zero.
- The task system (`TaskCreate`/`TaskUpdate`) was not available to the planner. Group-level task items were not created, so the markdown checkboxes are the only progress tracker.
- Copy that is not in the mockups (BOUNCE text, the `scope=all` done text, loading/error copy, the „wkrótce” note) is proposed in the spec and still needs a product read. It is implemented exactly as the spec gives it.

## Overview
Total Steps: 117
Task Groups: 19
Expected Tests: ~91–125. Implementation groups have 2–8 each: backend 56–68, frontend 33–45, docs 2. The review group adds at most 10. An `it.each` table counts as one test.

## Implementation Steps

> Rules for every group:
> - **SECRETS:** never print secret values. Do not run `env`, `printenv`, `docker inspect` or `cat .env`, and never write a value into code, tests, docs or reports. Refer to configuration by variable name only, and check presence only.
> - **No git commits** in any step. Leave the work uncommitted.
> - Backend commands run from `src/backend`: `uv run --no-sync python -m pytest tests/<file>`, `uv run --no-sync python -m mypy app`, `uv run --no-sync python -m ruff check .`.
> - Frontend commands run from `src/frontend`: `npm test -- <file>`, `npm run typecheck`, `npm run lint`.
> - Compare against the baseline (32 vitest, 2 stale backend, mypy 15, ruff 64). Never introduce a new failure.

### Task Group 1: Backend Platform: Config, Clock & Dependencies
**Dependencies:** None
**Files to Modify:** `src/backend/app/config.py`, `src/backend/app/core/clock.py`, `src/backend/tests/conftest.py`, `src/backend/pyproject.toml`, `src/backend/uv.lock`, `.env.example`, `docker-compose.yml`, `src/backend/tests/test_email_config.py`
**Estimated Steps:** 7

- [x] 1.0 Complete the backend platform layer
  - [x] 1.1 Write 4-6 focused tests in `tests/test_email_config.py`
    - `email_configuration_errors` is empty while `EMAIL_ENABLED=false`, and lists the variable names per backend: always `EMAIL_FROM_ADDRESS`, `EMAIL_LINK_SIGNING_SECRET` (< 32 chars invalid) and `APP_PUBLIC_BASE_URL` (`https://` or `http://localhost…`); `mailgun` adds `EMAIL_PROVIDER_API_URL` (`https://`), `EMAIL_PROVIDER_API_KEY` and `EMAIL_WEBHOOK_SIGNING_KEY`; `smtp` adds `EMAIL_SMTP_HOST` (parametrised)
    - an empty or whitespace placeholder reads as `None`, and an empty bool reads as its default
    - `clock.local_to_utc` round-trips a winter and a summer Warsaw time (DST)
    - use dummy test strings only, never real values
  - [x] 1.2 Add the R15 settings to `app/config.py`
    - the 14 settings with the spec's types and defaults (`EMAIL_BACKEND` `Literal["mailgun","smtp","log"]` default `log`, `EMAIL_FROM_NAME` `Gooo`, `EMAIL_DAILY_CAP` int ≥ 0 default 100, `EMAIL_SMTP_PORT` 1025)
    - one `mode="before"` validator: blank → `None` (bools: blank → default)
    - the `email_configuration_errors` property returns names only
    - reuse the existing `*_configured`/validator style in `Settings`
  - [x] 1.3 Add `local_to_utc(naive_local) -> naive UTC` to `app/core/clock.py` (uses `warsaw_zone`, mirror of `utc_to_local`)
  - [x] 1.4 Run `uv add jinja2` from `src/backend` and keep the updated `uv.lock` (shipped with the change)
  - [x] 1.5 Force `os.environ["EMAIL_ENABLED"] = "false"` and `os.environ["EMAIL_NOTIFICATIONS_ENABLED"] = "false"` in `tests/conftest.py` beside the MODERATION/EMBEDDINGS lines, before `app.config` is imported
  - [x] 1.6 Add the infrastructure entries (SECRETS rule: names and empty placeholders only)
    - `.env.example`: a commented `EMAIL_*` + `APP_PUBLIC_BASE_URL` block with empty values
    - `docker-compose.yml`, backend `environment`: `${NAME:-}`, with `${EMAIL_ENABLED:-false}` and `${EMAIL_NOTIFICATIONS_ENABLED:-false}`
    - a `mailpit` service with a pinned image tag, `profiles: ["dev"]`, SMTP 1025 on the compose network and its UI on `127.0.0.1:8025`
  - [x] 1.7 Ensure the group's tests pass
    - run only `tests/test_email_config.py`, then `mypy app` and `ruff check .` against the baseline

**Acceptance Criteria:**
- The 4-6 tests pass
- `jinja2` is in `pyproject.toml` and `uv.lock`
- No setting value appears in any log, test output or file; `.env.example` has empty placeholders only

### Task Group 2: Database Layer: Migrations 0110–0112 & Models
**Dependencies:** None
**Files to Modify:** `src/backend/app/email/__init__.py`, `src/backend/app/email/infrastructure/__init__.py`, `src/backend/app/email/models.py`, `src/backend/app/auth/models.py`, `src/backend/app/users/models.py`, `src/backend/alembic/versions/0110_email_tables.py`, `src/backend/alembic/versions/0111_email_verified_at.py`, `src/backend/alembic/versions/0112_backfill_google_verified.py`, `src/backend/tests/test_email_migrations.py`
**Estimated Steps:** 8

- [x] 2.0 Complete the database layer
  - [x] 2.1 Write 3-4 focused tests in `tests/test_email_migrations.py` (template: `tests/test_user_identities_migration.py`)
    - 0110 creates the four tables with the named constraints and indexes (inspect `pg_constraint`/`pg_indexes` for a representative set incl. `ck_email_messages_skipped_reason` and the two partial indexes)
    - downgrade-then-`upgrade head` round trip through 0109, restoring head + `engine.dispose()` in `finally`
    - the 0112 backfill sets `email_verified_at` only for a verified identity whose email matches the profile case-insensitively; it skips an unverified, a mismatching and an already-set row
  - [x] 2.2 Create the `app/email` package skeleton (`__init__.py`, `infrastructure/__init__.py`) and `models.py`
    - `EmailMessage`, `EmailPreference`, `EmailSuppression` on `BaseEntity`
    - string enums via a module-local `_enum_column`
    - the R2 columns, `payload` JSONB server default `'{}'`
    - `notification_id` and `source_message_id` as loose UUIDs with no FK
  - [x] 2.3 Map `AccountToken` + `AccountTokenPurpose` (`VERIFY_EMAIL`, `PASSWORD_RESET`) in `app/auth/models.py` with R2's columns
  - [x] 2.4 Map `email_verified_at` on `UserProfile`, with a docstring stating the invariant: any future writer of `user_profiles.email` must clear `email_verified_at`
  - [x] 2.5 Write `0110_email_tables.py`
    - `SET LOCAL lock_timeout = '5s'` first
    - every `pk_`/`fk_`/`uq_`/`ck_`/`ix_` name from R2: FKs to `parties` with no ON DELETE rule, `account_tokens.user_id` ON DELETE CASCADE
    - partial indexes `WHERE status = 'PENDING'` / `'SENDING'`
    - `ck_email_suppressions_address_normalized` (`= lower(btrim(...))`)
    - the downgrade drops in reverse dependency order
  - [x] 2.6 Write `0111_email_verified_at.py`: a nullable TIMESTAMP with `lock_timeout`; the downgrade drops the column
  - [x] 2.7 Write `0112_backfill_google_verified.py`
    - the data-only `UPDATE`: `timezone('utc', now())`, joined on `identity.user_id = profile.account_user_id`, `email_verified`, `lower()` equality, only `email_verified_at IS NULL`
    - `lock_timeout`
    - a documented no-op downgrade
  - [x] 2.8 Ensure the database tests pass
    - run only `tests/test_email_migrations.py` plus `tests/test_user_identities_migration.py`

**Acceptance Criteria:**
- The 3-4 tests pass
- `alembic upgrade head` reaches 0112. Constraint names match R2 exactly
- The recipient address is never a column of `email_messages`

### Task Group 3: Email Core: Rules, Links, Rendering & Senders
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/email/rules.py`, `src/backend/app/email/links.py`, `src/backend/app/email/rendering.py`, `src/backend/app/email/senders.py`, `src/backend/app/email/templates/base.html.j2`, `src/backend/app/email/templates/base.txt.j2`, `src/backend/app/email/templates/verify_email.html.j2`, `src/backend/app/email/templates/verify_email.txt.j2`, `src/backend/app/email/templates/password_reset.html.j2`, `src/backend/app/email/templates/password_reset.txt.j2`, `src/backend/app/email/templates/password_changed.html.j2`, `src/backend/app/email/templates/password_changed.txt.j2`, `src/backend/app/email/templates/notification.html.j2`, `src/backend/app/email/templates/notification.txt.j2`, `src/backend/tests/conftest.py`, `src/backend/tests/test_email_rendering.py`, `src/backend/tests/test_email_senders.py`
**Visual References:**
- mockup: analysis/design-context/mockups/maile-powiadomienie-i-weryfikacja.html
  element: screen:emails
  locator: "Szablon notification (generyczny)" state, lines 267-273 (header, h2 subject, message, CTA button, footer)
  acceptance: notification mail is a single 600 px column with inline CSS. Order: brand header → subject as h2 → bell message → CTA button with the full URL as text below it → footer „Dostajesz ten mail, bo masz włączone powiadomienia „<label>”.” then the links „Wypisz się z tej kategorii” · „Ustawienia powiadomień”. The mail carries the List-Unsubscribe headers.
- mockup: analysis/design-context/mockups/maile-powiadomienie-i-weryfikacja.html
  element: screen:emails
  locator: "Szablon verify_email" state, lines 273-281
  acceptance: verify_email mail has the subject „Potwierdź swój adres e-mail”, the body „Cześć <first_name>! Kliknij przycisk, żeby potwierdzić adres. Link jest ważny 48 godzin.”, the CTA „Potwierdź adres”, „Jeśli to nie Ty, zignoruj tę wiadomość.” and the account-mail footer „Wiadomość o Twoim koncie w <brand>, wysyłana niezależnie od ustawień powiadomień.”. It has no List-Unsubscribe headers and no unsubscribe link.
**Estimated Steps:** 8

- [x] 3.0 Complete the email core layer
  - [x] 3.1 Write 6-8 focused tests across `tests/test_email_rendering.py` and `tests/test_email_senders.py`
    - rules helpers in one parametrised test: `is_quiet` at 21:59/22:00/06:59/07:00, `want_match_day` 23:00 → next day, `next_send_after` per attempt, `category_enabled` with an `ALL=false` row
    - `sign_unsubscribe`/`verify_unsubscribe` round trip, plus rejects for a tampered signature, an uppercase party id (canonicalised, accepted) and the `ALL` category
    - rendering: `StrictUndefined` raises; `<script>` in a bell message is escaped in HTML; Polish characters and a Warsaw `format_term_when` date in `password_changed`; `link_path=None` CTA → `base_url + "/"`
    - headers: `List-Unsubscribe`/`List-Unsubscribe-Post`/`List-Id` only on NOTIFICATION mail; `Auto-Submitted` always; `Reply-To` when set
    - `MailgunSender` via `httpx.MockTransport`: form fields (`o:tracking=no`, `v:email_message_id`, `h:` headers), Basic `api:<key>` with a dummy key, the `id` stripped of `<>`, and 2xx/4xx/429/5xx/timeout classification (parametrised)
    - `SmtpSender`: `SMTPRecipientsRefused` → permanent
  - [x] 3.2 Write `rules.py` (pure constants and functions)
    - `KIND_RULES` for exactly the 7 kinds with the R4 subjects and CTAs
    - `CATEGORY_DEFAULTS`, `WANTS_DEFAULT_ENABLED`, `VISIBLE_CATEGORIES`, `CATEGORY_LABELS`
    - key builders for `notification:`, `want_match:`, `term_confirmation:`, `auth:` and `auth:<id>:changed`
    - all R4 constants and the four helpers
  - [x] 3.3 Write `links.py`
    - `sign_unsubscribe(party_id, category)` → `1.<CATEGORY>.<party_id>.<b64url-nopad HMAC-SHA256("1|CAT|pid")>` with `EMAIL_LINK_SIGNING_SECRET`
    - `verify_unsubscribe` canonicalises the party id and uses `compare_digest`; it returns `None` on any failure or a missing secret
  - [x] 3.4 Write the 10 Jinja2 templates from R8 (base + 4 pairs). Inline CSS only in `base.html.j2`, no tracking, no promotional blocks
  - [x] 3.5 Write `rendering.py`
    - `Environment(FileSystemLoader(app/email/templates), select_autoescape(("html","html.j2")), StrictUndefined)`
    - `render(template, context) -> RenderedEmail(subject, html, text)` with the shared context (`brand`, `base_url`, `settings_url`, `first_name`)
  - [x] 3.6 Write `senders.py`
    - `EmailSender` Protocol, `OutgoingEmail`, `SendResult`, `PermanentSendError`/`RetryableSendError(code)`
    - a header builder for every mail and for NOTIFICATION mail
    - `MailgunSender` (`httpx.Timeout(10, connect=5)`), `SmtpSender` (`asyncio.to_thread`, `smtplib.SMTP(..., timeout=SEND_TIMEOUT)`, multipart/alternative, generated `Message-ID`) and `LogSender` (logs the id and template only)
    - `set_sender`/`get_sender`/`build_sender(settings)`
    - reuse the httpx and "never log credentials" pattern of `auth/google.py`
  - [x] 3.7 Add a `fake_email_sender` fixture to `tests/conftest.py`, modelled on `fake_embedder`: it captures `OutgoingEmail`s, can be told to raise either error, and resets the sender afterwards
  - [x] 3.8 Ensure the email core tests pass
    - run only `tests/test_email_rendering.py` and `tests/test_email_senders.py`

**Acceptance Criteria:**
- The 6-8 tests pass
- Templates match the screen:emails acceptance criteria above
- No address, key or body is logged by any sender

### Task Group 4: Profile Verification Exposure & Google Sign-in
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/users/schemas.py`, `src/backend/app/users/router.py`, `src/backend/app/users/service.py`, `src/backend/app/auth/service.py`, `src/backend/tests/test_my_profile.py`, `src/backend/tests/test_google_login.py`
**Estimated Steps:** 6

- [x] 4.0 Complete the profile exposure layer
  - [x] 4.1 Write 3-4 focused tests
    - `tests/test_my_profile.py`: `/api/people/me` `email_verified` is true / false / null (null while `EMAIL_ENABLED=false` or with no email, via `monkeypatch.setattr(settings, …)`), and `/api/people/{id}` keeps its exact key set without it. Update the `ME_KEYS` pin (~l.122)
    - `tests/test_google_login.py`: a new Google account gets `email_verified_at`, and a linked sign-in sets it only when Google verifies an email equal (case-insensitively) to the profile email while the column is NULL
  - [x] 4.2 Add `MyProfileResponse(UserProfileResponse)` with `email_verified: bool | None` to `users/schemas.py`
  - [x] 4.3 Use it only in `_to_my_profile_response` (GET and both PATCH `/api/people/me` routes) in `users/router.py`
  - [x] 4.4 Add the keyword `email_verified: bool = False` to `bootstrap_person_account` in `users/service.py`; it sets `email_verified_at` at creation
  - [x] 4.5 In `auth/service.py`, make `_bootstrap_google_account` pass `email_verified=claims.email_verified`, and make `_log_in_linked` set the column under R3's rule
  - [x] 4.6 Ensure the profile tests pass
    - run only `tests/test_my_profile.py` and `tests/test_google_login.py`

**Acceptance Criteria:**
- The 3-4 tests pass
- `email_verified` never appears on `/api/people/{id}` or `/by-party/{party_id}`

### Task Group 5: Enqueue Service & Notifications Hook
**Dependencies:** 2, 3
**Files to Modify:** `src/backend/app/email/service.py`, `src/backend/app/notifications/service.py`, `src/backend/app/notifications/infrastructure/__init__.py`, `src/backend/app/notifications/infrastructure/email_acl.py`, `src/backend/app/wants/application/match_notifications.py`, `src/backend/tests/test_email_enqueue.py`
**Estimated Steps:** 6

- [x] 5.0 Complete the enqueue layer
  - [x] 5.1 Write 6-8 focused tests in `tests/test_email_enqueue.py` (helpers from `tests/test_notifications.py`)
    - an MVP bell creates one PENDING row with `notification:<id>`, the category and `{message, link_path}`; a non-MVP kind creates none
    - each flag off (`EMAIL_ENABLED`, `EMAIL_NOTIFICATIONS_ENABLED`) gates it (parametrised)
    - three same-day `WANT_MATCH_FOUND` entries with `freeze_local_now` give one row, incl. 23:00 → next-day key
    - a retried `TERM_CONFIRMATION_NEEDED` (same proposal/reservation + party) gives no second row and no error
    - `count_queries`: with the flags on, `write_bell_rows`' batch issues `["INSERT","INSERT"]` (a new pin beside the unchanged `test_wants_notifications.py:92`), and empty input issues zero
    - a rollback drops both the bell and the mail
  - [x] 5.2 Write `app/email/service.py`
    - `NotificationEmail` frozen dataclass
    - `stage_notification_email` (`db.add` for `notification:`, one Core `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` for `term_confirmation:`)
    - `enqueue_notification_emails`: one multi-row Core insert with explicit `id`/`created_at`/`updated_at`, or no statement
    - `enqueue_transactional` (no-op while `EMAIL_ENABLED=false`) and `clear_bounce_suppression`
    - shared rules: no reads, no commit, never raises on recipient matters, `send_after = utcnow()`, `expires_at = utcnow() + NOTIFICATION_TTL`
  - [x] 5.3 Create `notifications/infrastructure/{__init__,email_acl}.py`: `stage(...)`/`enqueue(...)` convert the kind to `.value` and call `app.email.service`
  - [x] 5.4 Edit `notifications/service.py`
    - `NotificationEntry` gets the last field `topic_id: uuid.UUID | None = None`
    - `create_notification` sets `id = uuid.uuid4()` and calls `email_acl.stage` with `proposal_id`/`reservation_id`
    - `create_notifications` calls `email_acl.enqueue` with the returned ids zipped to the entries
  - [x] 5.5 In `wants/application/match_notifications.py`, give `_entry` the keyword `topic_id=None`; `write_bell_rows` passes `topic_id=want.id` only for `WANT_MATCH_FOUND`
  - [x] 5.6 Ensure the enqueue tests pass
    - run `tests/test_email_enqueue.py`
    - re-run the unchanged pins: `tests/test_wants_notifications.py`, `tests/test_notifications.py`

**Acceptance Criteria:**
- The 6-8 tests pass, and `test_wants_notifications.py` passes unedited (flags off)
- The hook costs 0 or 1 statement per call

### Task Group 6: Send Job & Recipient ACL
**Dependencies:** 2, 3
**Files to Modify:** `src/backend/app/email/sending.py`, `src/backend/app/email/infrastructure/users_acl.py`, `src/backend/tests/test_email_sending.py`
**Estimated Steps:** 7

- [x] 6.0 Complete the send-job layer
  - [x] 6.1 Write 8 focused tests in `tests/test_email_sending.py`
    - seed rows with Core inserts and use `fake_email_sender`
    - every `skip_reason` incl. `expired` (parametrised: organization, no_address, unverified, suppressed, category_disabled, daily_cap)
    - quiet hours and `EMAIL_NOTIFICATIONS_ENABLED=false` claim only TRANSACTIONAL rows (parametrised, `freeze_local_now`)
    - retryable → backoff `send_after`, then FAILED at `MAX_ATTEMPTS` with the ERROR line `FAILED after`
    - stuck SENDING: NOTIFICATION → PENDING, TRANSACTIONAL → FAILED `stuck_sending`
    - H-1: a row raised to DELIVERED during the send keeps DELIVERED on a retryable or permanent outcome; a sent outcome still sets `sent_at` and removes the token
    - the token is gone at every final state incl. permanent → FAILED
    - `count_queries`: constant for 1 vs 20 rows
    - `caplog` contains no address, token or subject
  - [x] 6.2 Write `infrastructure/users_acl.py::get_recipients_by_party_ids` (one statement through Core table refs or the users read helpers: party type, email, `email_verified_at`, display name). Reuse the shape of `wants/infrastructure/users_acl.py`
  - [x] 6.3 `sending.py` steps 1–3, one statement each
    - recover stuck rows; expire rows past `expires_at` (token removed)
    - claim up to `BATCH_SIZE` rows ordered by `send_after`, `FOR UPDATE SKIP LOCKED`, `RETURNING`, with the TRANSACTIONAL-only filter during quiet hours or while notifications are off; commit
  - [x] 6.4 Steps 4–5
    - the four binding reads (recipients, suppressions, preferences, the sent-today count since `clock.local_to_utc(Warsaw midnight)`)
    - decide in R7's order (TRANSACTIONAL: only `no_address`) with one WARNING per run at the cap
    - one skip-write statement, then commit
  - [x] 6.5 Step 6: render (R8) and `asyncio.wait_for(get_sender().send(...), SEND_TIMEOUT)` with no transaction open; a render error → permanent `render_error`, a timeout → retryable `timeout`
  - [x] 6.6 Step 7 and logging
    - one `UPDATE … FROM (VALUES …)` with `CASE` guarded by `status = 'SENDING'`, `COALESCE` for `sent_at`/`provider_message_id`, `payload - 'token'` for sent/permanent; commit
    - the ERROR lines and the single `email send: claimed=… sent=… skipped=… retried=… failed=… expired=… recovered=…` line (INFO when non-zero, else DEBUG)
  - [x] 6.7 Ensure the send-job tests pass
    - run only `tests/test_email_sending.py`

**Acceptance Criteria:**
- The 8 tests pass
- Constant statement count per run. No address, token, subject or body in logs or `last_error`

### Task Group 7: Mailgun Webhook & Suppressions
**Dependencies:** 1, 2, 3
**Files to Modify:** `src/backend/app/email/webhooks.py`, `src/backend/app/email/router.py`, `src/backend/app/main.py`, `src/backend/tests/test_email_webhook.py`
**Estimated Steps:** 5

- [x] 7.0 Complete the webhook layer
  - [x] 7.1 Write 7-8 focused tests in `tests/test_email_webhook.py` (sign payloads with a dummy test key via `monkeypatch`)
    - a valid HMAC moves SENT → DELIVERED
    - a bad signature, a stale timestamp, a replay and a missing key each give 401 with no detail (parametrised)
    - out-of-order events never lower the status (COMPLAINED then delivered stays COMPLAINED)
    - permanent `failed` → BOUNCED + BOUNCE suppression; `complained` → COMPLAINT (outranks an existing BOUNCE) + the NOTIFICATION category set to `enabled=false`
    - an unknown message or a non-UUID `email_message_id` → 200 `{}`; unparseable JSON → 400
    - PENDING/FAILED rows are raised (token removed); a SKIPPED row keeps SKIPPED but still suppresses
    - M-1: a forced processing failure → 503, and the same signed payload is accepted on retry
  - [x] 7.2 Write `webhooks.py`'s signature check
    - `hmac(EMAIL_WEBHOOK_SIGNING_KEY, timestamp + token, sha256)` + `compare_digest`, `|now - ts| <= WEBHOOK_MAX_SKEW`
    - the bounded in-process replay memory (5 min, ≤ 10 000), recorded only after commit
    - one INFO line `email webhook rejected: reason=…`
  - [x] 7.3 Apply events with Core statements in one transaction
    - lookup by `user-variables.email_message_id` (defensive UUID parse), else the normalised `message-id`
    - precedence `COMPLAINED > BOUNCED > DELIVERED > SENT > SENDING`; PENDING/FAILED raised; SKIPPED kept; `event_at`
    - suppression upsert with `ON CONFLICT … DO UPDATE … WHERE excluded.reason = 'COMPLAINT'`; preference upsert; explicit `updated_at`
    - `TRANSACTION_CONFLICTS` → one WARNING + 503; other failures → `logger.exception` + 503
  - [x] 7.4 Create `router.py` with `POST /api/email/webhooks/mailgun` (no auth dependency, PUBLIC) and include `email_router` in `main.py` before `system_router`
  - [x] 7.5 Ensure the webhook tests pass
    - run only `tests/test_email_webhook.py`

**Acceptance Criteria:**
- The 7-8 tests pass
- Events are idempotent and never lower a status. The signing key never appears in logs

### Task Group 8: Preferences & Unsubscribe API
**Dependencies:** 5, 6, 7
**Files to Modify:** `src/backend/app/email/router.py`, `src/backend/app/email/schemas.py`, `src/backend/app/email/service.py`, `src/backend/app/email/infrastructure/users_acl.py`, `src/backend/tests/test_email_preferences.py`
**Estimated Steps:** 6

- [x] 8.0 Complete the preferences and unsubscribe layer
  - [x] 8.1 Write 6-8 focused tests in `tests/test_email_preferences.py`
    - GET defaults with an exact key set (`email`, `email_verified`, `suppression`, `support_address`, `notifications_live`, `all_enabled`, `categories`), and `notifications_live` true/false by flag (parametrised)
    - PUT upsert round trip; an unknown category → 400 „Nieznana kategoria powiadomień.”
    - one-click form POST (`List-Unsubscribe=One-Click`) with no auth → 200 `{category, scope}`, idempotent on repeat
    - JSON `{scope: "all"}` writes `ALL=false`
    - a bad signature or a missing secret → 404 „Nie rozpoznajemy tego linku.”
    - `suppression` and `support_address` reflect a BOUNCE row and `EMAIL_REPLY_TO_ADDRESS`
    - login-only: an `mcp:*` token → 403
  - [x] 8.2 Add `find_party_id_by_principal` plus the profile email/verification read to `users_acl.py`
  - [x] 8.3 Add the preference read and Core upsert (explicit `updated_at`) and the suppression lookup to `service.py`
  - [x] 8.4 Write `schemas.py`: `EmailPreferencesResponse`, the category item, `PreferenceUpdateRequest` (`category: str`), `UnsubscribeRequest`/`UnsubscribeResponse`
  - [x] 8.5 Extend `router.py`
    - `POST /api/email/unsubscribe/{token}`: JSON, form/multipart or empty body → scope; no auth
    - `GET /api/email/preferences` (READ) and `PUT /api/email/preferences` (EDIT), login-only like the `/api/wants` routes (rows 66–67)
    - category checked in the handler against `ALL` + `VISIBLE_CATEGORIES`
    - no profile → 404
    - a route-local `status → (error, Polish message)` map modelled on `_GOOGLE_ERRORS`
  - [x] 8.6 Ensure the preferences tests pass
    - run only `tests/test_email_preferences.py`

**Acceptance Criteria:**
- The 6-8 tests pass
- No route here returns 401 for a bad token. Responses use the exact key set

### Task Group 9: Account Tokens & Auth Endpoints
**Dependencies:** 4, 5
**Files to Modify:** `src/backend/app/auth/account_tokens.py`, `src/backend/app/auth/infrastructure/__init__.py`, `src/backend/app/auth/infrastructure/email_acl.py`, `src/backend/app/auth/router.py`, `src/backend/app/users/service.py`, `src/backend/tests/test_account_tokens.py`
**Estimated Steps:** 7

- [x] 9.0 Complete the account-token layer
  - [x] 9.1 Write 8 focused tests in `tests/test_account_tokens.py` (flags on via `monkeypatch`)
    - register enqueues one `verify_email` row (`auth:<token_id>`) in the same commit
    - `POST /password-reset` is always 202 (existing, missing, Google-only, rate-limited; parametrised) and 503 with email disabled
    - expired or used → 410, unknown → 404, never 401 (parametrised over the confirm routes and the lookup)
    - a reset sets the password of a Google-only account, marks the email verified on a snapshot match, and enqueues `password_changed`
    - verify with a snapshot mismatch → 410; a verify clears BOUNCE but not COMPLAINT
    - two concurrent confirms (two sessions, `asyncio.gather`): exactly one 204, the other 410 (M-2)
    - the lookup has no side effects (a later confirm still succeeds)
    - every response carries `Cache-Control: no-store`
  - [x] 9.2 Create `auth/infrastructure/{__init__,email_acl}.py`, wrapping `enqueue_transactional` and `clear_bounce_suppression`
  - [x] 9.3 Write `auth/account_tokens.py` (imports only `app.auth.models`, `app.users.models`, `app.core`, `app.config` and the ACL)
    - `issue_verification`, `request_verification`, `request_password_reset` with the rate limits (< 1 per 60 s, ≤ 5 per hour per user and purpose)
    - `lookup`
    - the atomic claim `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING`, with the 404/410 split by a follow-up read
    - `confirm_verification`, `confirm_password_reset` (`hash_password`, other resets marked used, I-6)
    - `AccountTokenNotFound`/`AccountTokenGone`
    - `secrets.token_urlsafe(32)` + SHA-256 hex
  - [x] 9.4 Call `issue_verification` inside `_bootstrap_registration`'s savepoint in `users/service.py`, after the bootstrap and before the commit (C-1)
  - [x] 9.5 Add the five routes to `auth/router.py` (rows 74, 75, 76, 77, 82)
    - Pydantic bodies (normalised email, `password` `min_length=1`)
    - the route-local 404/410/503 map with the spec's Polish messages
    - `Cache-Control: no-store` on every response
    - `require_any("EDIT")` on the resend
  - [x] 9.6 Check that no raw token, address or password reaches a log (`caplog` assertion inside the 9.1 tests)
  - [x] 9.7 Ensure the account-token tests pass
    - run only `tests/test_account_tokens.py`, then `tests/test_google_login.py` to confirm no regression

**Acceptance Criteria:**
- The 8 tests pass
- Forgot-password never reveals an account. Single use holds under concurrency
- No `auth.service` ↔ `users.service` import cycle

### Task Group 10: App Wiring: Lifespan, Send Job Schedule, Matrix & Guards
**Dependencies:** 6, 8, 9
**Files to Modify:** `src/backend/app/main.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_module_boundaries.py`, `src/backend/tests/test_domain_clock_guard.py`, `src/backend/tests/test_email_config.py`
**Estimated Steps:** 6

- [x] 10.0 Complete the app-wiring layer
  - [x] 10.1 Write 5-6 focused tests
    - `test_module_boundaries.py`: the `app.email` importer set = {`app.main`, `app.notifications.infrastructure.email_acl`, `app.auth.infrastructure.email_acl`}, and an inner-import test (outside `infrastructure/` only `app.core`, `app.db`, `app.config`, `app.email`; never `app.notifications`). Update the module docstring
    - `test_domain_clock_guard.py`: add `app/email` to `_GUARDED_DIRS`
    - `test_authorization_matrix.py`: `resolve_requirement` for rows 74–82 (parametrised), plus the ordering test asserting 73, 74, 75, 76, 82, 77 and rows 78–81 after 69
    - `test_email_config.py`: the lifespan `RuntimeError` names only variables, and the non-mailgun WARNING `EMAIL_BACKEND=<log|smtp> with EMAIL_ENABLED=true: …` (caplog, dummy values)
  - [x] 10.2 Add the matrix rows to `authorization_matrix.py`
    - 74, 75, 76, 82 (PUBLIC POST), then 77 (`("EDIT",)`), directly after row 73
    - 78, 79 (PUBLIC POST), 80 (`GET ^/api/email/preferences$` READ), 81 (PUT EDIT) after row 69
    - each with a justification comment like rows 72/73
  - [x] 10.3 Wire the lifespan in `main.py` (SECRETS rule: names only, never values)
    - after `clock.check_timezone()`, raise on `email_configuration_errors`
    - the INFO line `EMAIL_ENABLED=%s EMAIL_NOTIFICATIONS_ENABLED=%s EMAIL_BACKEND=%s` and the non-mailgun WARNING
    - `set_sender(build_sender(settings))` when enabled, reset to `None` on shutdown
  - [x] 10.4 Add `_run_email_send` in `main.py`, modelled on `_run_embedding_reconcile`
    - its own session; `TRANSACTION_CONFLICTS` → one WARNING; other errors → `logger.exception`, never re-raised
    - scheduled every 60 s with `coalesce`, `max_instances=1`, `misfire_grace_time=None`, only when `settings.email_enabled`
  - [x] 10.5 Run `mypy app` and `ruff check .` and fix every new finding (compare with baseline 15 / 64)
  - [x] 10.6 Ensure the wiring tests pass
    - run only the four test files above, then the backend email files `tests/test_email_*.py` and `tests/test_account_tokens.py` as one feature run

**Acceptance Criteria:**
- The 5-6 tests pass; matrix order 73, 74, 75, 76, 82, 77 is asserted
- The app starts with `EMAIL_ENABLED=false` and schedules no email job; no config value is logged

### Task Group 11: Frontend API, Hooks & Shared Component Extensions
**Dependencies:** None
**Files to Modify:** `src/frontend/src/api/auth.ts`, `src/frontend/src/api/email.ts`, `src/frontend/src/api/people.ts`, `src/frontend/src/hooks/useMyProfile.ts`, `src/frontend/src/hooks/useEmailPreferences.ts`, `src/frontend/src/hooks/useEmailVerificationRequest.ts`, `src/frontend/src/hooks/useAccountTokenLookup.ts`, `src/frontend/src/features/panel/appDataStore.ts`, `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/profile-public/ProfileAppearancePage.tsx`, `src/frontend/src/components/shared/appComponents.tsx`, `src/frontend/src/test/useEmailHooks.test.tsx`, `src/frontend/src/test/ssrSafety.test.tsx`, `src/frontend/src/test/AddTermViewAttendancePoints.test.tsx`, `src/frontend/src/test/AppDataContextItemMode.test.tsx`, `src/frontend/src/test/AppDataContextNeededItems.test.tsx`, `src/frontend/src/test/AppPage.test.tsx`, `src/frontend/src/test/GroupFormDescription.test.tsx`, `src/frontend/src/test/ItemCreateView.test.tsx`, `src/frontend/src/test/panelSessionHydration.test.tsx`, `src/frontend/src/test/PaymentForms.test.tsx`, `src/frontend/src/test/PendingActionsHost.test.tsx`, `src/frontend/src/test/ProfileAppearancePage.test.tsx`, `src/frontend/src/test/useOrganizationHooks.test.tsx`
**Estimated Steps:** 7

- [x] 11.0 Complete the frontend data layer
  - [x] 11.1 Write 4-6 focused tests in `src/test/useEmailHooks.test.tsx` (explicit vitest imports, `createQueryWrapper`, `vi.mock` API factories)
    - `useEmailPreferences.update` awaits invalidation of `EMAIL_PREFERENCES_KEY`
    - `useEmailVerificationRequest`: `sent` + `secondsLeft` counts down 60 s with `vi.useFakeTimers({ toFake: ["Date"] })`; a 503 maps to „Wysyłka maili jest chwilowo niedostępna. Spróbuj później.”
    - `useAccountTokenLookup` does not refetch on focus or reconnect and keeps its data (`staleTime: Infinity`, `retry: false`)
    - `useOptionalPanelReload()` is a no-op without `AppDataProvider`
  - [x] 11.2 Add to `api/auth.ts`: `requestPasswordReset`, `confirmPasswordReset`, `requestEmailVerification`, `confirmEmailVerification`, `lookupAccountToken`
  - [x] 11.3 Create `api/email.ts`: `getEmailPreferences`, `updateEmailPreference`, `unsubscribe(token, scope)`, and the types `EmailPreferencesResponse` (incl. `notifications_live`, `support_address`), `EmailCategory`, `Suppression`
  - [x] 11.4 Add `MyProfileResponse = UserProfileResponse & { email_verified: boolean | null }` to `api/people.ts`
    - returned by `getMyProfile`, `updateMyProfile`, `updateMyProfileAppearance`
    - typed through `useMyProfile`, `AppDataContext` and `ProfileAppearancePage`
    - fix every typed test fixture that `npm run typecheck` flags (list above, incl. `ssrSafety.test.tsx`), with no `as` casts
  - [x] 11.5 Write the hooks in `src/hooks/`
    - `useEmailPreferences` (prefix constant `EMAIL_PREFERENCES_KEY`, app-shaped return, `update` as a `useCallback` write)
    - `useEmailVerificationRequest`
    - `useAccountTokenLookup` with the M-6 options
    - no `useMutation`
    - after a verify confirm or a resend: await invalidation of `MY_PROFILE_KEY` + `EMAIL_PREFERENCES_KEY`, then `useOptionalPanelReload()`
  - [x] 11.6 Make the shared-component extensions
    - `useOptionalPanelReload()` in `appDataStore.ts` (reads `useContext(AppDataContext)`; `usePanelReload` unchanged)
    - `appComponents.tsx`: `HintCard.onDismiss` optional (✕ only when given), `ToggleRow` passes `disabled` to `Switch`
  - [x] 11.7 Ensure the frontend data tests pass
    - run only `src/test/useEmailHooks.test.tsx`, then `npm run typecheck` (0 errors) and `npm run lint`

**Acceptance Criteria:**
- The 4-6 tests pass; typecheck stays at 0
- Existing `HintCard`/`ToggleRow` callers render unchanged

### Task Group 12: Frontend Routing Plumbing & Reserved Slugs
**Dependencies:** None
**Files to Modify:** `src/frontend/src/routing/paths.ts`, `src/frontend/src/proxy.ts`, `src/frontend/src/utils/appHelpers.ts`, `src/frontend/src/routing/reservedSlugs.ts`, `src/backend/app/organizations/slugs.py`, `src/frontend/src/test/reservedSlugs.test.ts`, `src/frontend/src/test/proxy.test.ts`, `src/backend/tests/test_organizations.py`
**Estimated Steps:** 5

- [x] 12.0 Complete the routing plumbing
  - [x] 12.1 Write 3-4 focused tests
    - `reservedSlugs.test.ts`: the parity list includes `verify-email`, `reset-password` and `unsubscribe`
    - `proxy.test.ts`: `/settings` is protected (guest → `/login` 307); `/verify-email`, `/reset-password` and `/unsubscribe` are not
    - `tests/test_organizations.py`: creating an organization with each new slug is rejected (parametrised)
  - [x] 12.2 Add `settings` to `View` (`paths.ts`), `PROTECTED_PREFIXES` (`proxy.ts`) and `ACCOUNT_SUBVIEWS` (`appHelpers.ts`)
  - [x] 12.3 Add `verify-email`, `reset-password` and `unsubscribe` to `routing/reservedSlugs.ts` and `app/organizations/slugs.py::RESERVED_SLUGS`
  - [x] 12.4 Leave the three token routes out of `PROTECTED_PREFIXES`
  - [x] 12.5 Ensure the routing tests pass
    - run only `reservedSlugs.test.ts`, `proxy.test.ts` and `uv run --no-sync python -m pytest tests/test_organizations.py`

**Acceptance Criteria:**
- The 3-4 tests pass
- The backend and frontend reserved-slug lists stay in parity

### Task Group 13: Frontend /settings Page & Category Switch
**Dependencies:** 11, 12
**Files to Modify:** `src/frontend/src/app/(public)/(panel)/settings/page.tsx`, `src/frontend/src/features/email/EmailSettingsView.tsx`, `src/frontend/src/features/email/emailSettingsViewState.ts`, `src/frontend/src/features/email/EmailCategoryToggle.tsx`, `src/frontend/src/test/emailSettingsViewState.test.ts`, `src/frontend/src/test/EmailSettingsView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html
  element: screen:settings-email
  locator: four states in lines 267-322: "Adres potwierdzony" 267-280, "Adres niepotwierdzony" 280-293, "Link wysłany" 293-306, "Wstrzymane po skardze (COMPLAINT)" 306-322
  acceptance: page order is the header „Powiadomienia e-mail” with the back link „‹ Konto”, then the intro „Wybierz, o czym chcesz dostawać maile. Powiadomienia w aplikacji działają zawsze.”, then the card „Twój adres” (address + badge Potwierdzony / Niepotwierdzony / Wstrzymane; no badge for unknown), then the section „Powiadomienia” with the switches in this order: „Wszystkie powiadomienia e-mail”, „Rezerwacje i wymiany”, „Szukam”, then the locked row „Wiadomości o koncie” / „Zawsze włączone”. Unverified shows „Potwierdź adres, żeby maile zaczęły przychodzić. Do tego czasu nic nie wysyłamy.” + „Wyślij link weryfikacyjny”. Sent shows „Wysłaliśmy link na <email>. Sprawdź skrzynkę (także spam).” + „Wyślij ponownie za N s” (`aria-disabled`, `role="status"`). Complaint shows the spam text with `support_address`. The panel shell has the bottom tab bar with „Konto” active. Derived states (bounce, unknown, loading skeleton, error alert, the „wkrótce” note under the „Powiadomienia” heading) use the spec's F2 copy.
- mockup: analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html
  element: component:email-category-switch
  locator: the „Powiadomienia” switch list inside each state (e.g. lines 271-279 in the verified state)
  acceptance: each row is `ToggleRow` + `Switch` (`role="switch"`) with title and sublabel copy from F2. The switch is on, off, or disabled (unverified/sent/complaint/bounce, or a category while ALL is off). The save is optimistic and reverts on failure with a `role="alert"` below the row (server message or „Nie udało się zapisać zmiany. Spróbuj ponownie.”). Category switches show `all_enabled && enabled`.
**Estimated Steps:** 6

- [x] 13.0 Complete the /settings page
  - [x] 13.1 Write 6-8 focused tests
    - `emailSettingsViewState.test.ts`: one `it.each` table with loading, error and the M-10 combinations (BOUNCE + unverified → bounce, COMPLAINT + unverified → complaint, sent after bounce → sent, null + BOUNCE → unknown, COMPLAINT + null → complaint, verified) and `togglesDisabled`
    - `EmailSettingsView.test.tsx` (`renderWithRoute` + `createQueryWrapper`): optimistic toggle reverts with an alert; switches disabled while unverified; the „wkrótce” note when `notifications_live` is false; a category switch disabled while ALL is off
  - [x] 13.2 Write `emailSettingsViewState.ts`: a pure `resolveEmailSettingsView({preferences, loading, error, sent})` with kinds `loading`/`error`/`ready` and the address-state precedence
  - [x] 13.3 Write `EmailCategoryToggle.tsx` over `ToggleRow`/`Switch`, following `WantNotificationToggle` (optimistic, revert, `extractProblemMessage`)
  - [x] 13.4 Write `EmailSettingsView.tsx`: `switch (view.kind)`, the address card, the resend button through `useEmailVerificationRequest`, the switches and the locked info row, all from the mockup
  - [x] 13.5 Write the thin `app/(public)/(panel)/settings/page.tsx` rendering the `"use client"` feature entry
  - [x] 13.6 Ensure the settings tests pass
    - run only the two test files above

**Acceptance Criteria:**
- The 6-8 tests pass
- Implementation matches each `acceptance` criterion declared above

### Task Group 14: Frontend Reset Password Page & Login Link
**Dependencies:** 11
**Files to Modify:** `src/frontend/src/app/(public)/reset-password/page.tsx`, `src/frontend/src/features/auth/ResetPasswordPage.tsx`, `src/frontend/src/features/auth/resetPasswordViewState.ts`, `src/frontend/src/features/auth/LoginForm.tsx`, `src/frontend/src/features/auth/AuthSheet.tsx`, `src/frontend/src/features/auth/AuthTabs.tsx`, `src/frontend/src/test/resetPasswordViewState.test.ts`, `src/frontend/src/test/ResetPasswordPage.test.tsx`, `src/frontend/src/test/auth.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/logowanie-link-nie-pamietasz-hasla.html
  element: screen:login-forgot-link
  locator: "LoginForm (strona i AuthSheet)" state, lines 267-276 (link at line 270)
  acceptance: the `AUTH_LINK` link „Nie pamiętasz hasła?” sits right-aligned between the password field and the submit button and points to `/reset-password`. Inside `AuthSheet` the click closes the sheet through `onNavigateAway`.
- mockup: analysis/design-context/mockups/reset-hasla-prosba.html
  element: screen:reset-password-request
  locator: "Formularz" 267-270, "Zawsze ten sam komunikat (202)" 270-272, "Maile wyłączone (503)" 272-278
  acceptance: form: „Nie pamiętasz hasła?” / „Podaj adres konta, wyślemy link do ustawienia nowego hasła.”, field E-mail, „Wyślij link”, „Wróć do logowania”. Sent: „Sprawdź skrzynkę” / „Jeśli konto z adresem <email> istnieje, wysłaliśmy na nie link. Jest ważny przez godzinę.” / „Nie widzisz maila? Zajrzyj do spamu albo spróbuj ponownie za minutę.” / „Wróć do logowania”. 503: the form plus `role="alert"` „Wysyłka maili jest chwilowo niedostępna. Spróbuj później.”. All states sit in the `AuthLayout` card.
- mockup: analysis/design-context/mockups/reset-hasla-nowe-haslo.html
  element: screen:reset-password-new
  locator: "Formularz z błędem walidacji" 267-270, "Token wygasły / użyty" 270-271, "Sukces (pełne przeładowanie na /login)" 271-275
  acceptance: form: „Ustaw nowe hasło” / „Dla konta <email>”, fields in order „Nowe hasło”, „Powtórz hasło”. A mismatch shows the inline `role="alert"` „Hasła nie są takie same.” with `aria-invalid`/`aria-describedby`, and „Zapisz hasło” is `aria-disabled` while invalid. Invalid: „Link wygasł” / „Ten link do zmiany hasła jest już nieważny: minęła godzina albo został użyty.” / „Wyślij nowy link”. Success: „Hasło zmienione” / „Możesz się teraz zalogować nowym hasłem. Wysłaliśmy też potwierdzenie na Twój adres.” / „Przejdź do logowania”, which runs `replaceDocument("/login")`.
**Estimated Steps:** 7

- [x] 14.0 Complete the reset-password flow
  - [x] 14.1 Write 6-8 focused tests
    - `resetPasswordViewState.test.ts`: an `it.each` table with no token (form/sent/unavailable), token loading, lookup 404/410 → invalid, network error, mismatch, confirm success, and "confirm success, then lookup 410 → success" (M-6)
    - `ResetPasswordPage.test.tsx`: the request → neutral sent; 503 alert; `?token=` while logged in renders the form, and success calls `clearSession()` + `replaceDocument("/login")` (M-9); mismatch alert with `aria-disabled` submit
    - `auth.test.tsx`: the LoginForm link points to `/reset-password`, and in `AuthSheet` the click closes the sheet
  - [x] 14.2 Write `resetPasswordViewState.ts`: a pure `resolveResetPasswordView(...)` with precedence confirm success > confirm error > lookup
  - [x] 14.3 Write `ResetPasswordPage.tsx`
    - `switch (view.kind)`; only the no-token branch is wrapped in `AuthGuard requireAuth={false}`
    - lookup through `useAccountTokenLookup(token, "PASSWORD_RESET")`
    - styles `AUTH_INPUT`/`AUTH_LABEL`/`AUTH_SUBMIT`/`AUTH_LINK`
  - [x] 14.4 Write the thin `app/(public)/reset-password/page.tsx` with `export const metadata = { referrer: "no-referrer" }`
  - [x] 14.5 Add the „Nie pamiętasz hasła?” link and an optional `onNavigateAway` prop to `LoginForm.tsx`
  - [x] 14.6 Wire `onNavigateAway` to the sheet's `onClose` in `AuthSheet.tsx` (and `AuthTabs.tsx` if it passes `LoginForm` through)
  - [x] 14.7 Ensure the reset tests pass
    - run only the three test files above

**Acceptance Criteria:**
- The 6-8 tests pass
- Implementation matches each `acceptance` criterion declared above; the token never leaves through the Referer header

### Task Group 15: Frontend Verify Email & Unsubscribe Pages
**Dependencies:** 11
**Files to Modify:** `src/frontend/src/app/(public)/verify-email/page.tsx`, `src/frontend/src/app/(public)/unsubscribe/page.tsx`, `src/frontend/src/features/email/VerifyEmailPage.tsx`, `src/frontend/src/features/email/verifyEmailViewState.ts`, `src/frontend/src/features/email/UnsubscribePage.tsx`, `src/frontend/src/features/email/unsubscribeViewState.ts`, `src/frontend/src/features/email/unsubscribeToken.ts`, `src/frontend/src/test/verifyEmailViewState.test.ts`, `src/frontend/src/test/unsubscribeViewState.test.ts`, `src/frontend/src/test/VerifyEmailPage.test.tsx`, `src/frontend/src/test/UnsubscribePage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/potwierdzenie-adresu-verify-email.html
  element: screen:verify-email
  locator: "GET bez efektów ubocznych" 267-268, "Sukces" 268-269, "Wygasły / użyty / inny adres" 269-273
  acceptance: confirm: „Potwierdź adres” / „Kliknij, żeby potwierdzić <email>.” / the button „Potwierdź adres”; the POST happens only on click. Success: ✅ „Adres potwierdzony” / the neutral M-7 text „Dziękujemy, Twój adres jest potwierdzony. Możemy wysyłać Ci ważne wiadomości. Ustawienia maili zmienisz w ustawieniach.” (replacing the mockup line) / „Ustawienia powiadomień” → `/settings`. Invalid: „Link nieważny” / „Ten link wygasł (48 h) albo został już użyty.”, then „Wyślij nowy link” for a logged-in visitor or „Zaloguj się, żeby wysłać nowy.” via `authPath("login", "/settings")` for a guest. All states sit in the `AuthLayout` card.
- mockup: analysis/design-context/mockups/wypisanie-unsubscribe.html
  element: screen:unsubscribe
  locator: "Wybór" 267-269, "Potwierdzenie" 269-270, "Zły podpis" 270-274
  acceptance: choice: „Wypisz się z maili” / „Ten link dotyczy kategorii <label>.” / „Wyłącz tę kategorię” (scope=category) / „Wyłącz wszystkie powiadomienia e-mail” (scope=all) / „Maile o koncie (reset hasła) zawsze dochodzą.”. Done: 👋 „Gotowe” / „Nie wyślemy już maili z kategorii <label>. Powiadomienia w aplikacji działają bez zmian.” (scope all: the F8 all text) / „Zmień ustawienia powiadomień” → `/settings`. Invalid: „Nieprawidłowy link” / „Nie rozpoznajemy tego linku. Ustawienia maili zmienisz po zalogowaniu.” / „Przejdź do ustawień”. A POST error keeps the choice buttons and shows `role="alert"` „Nie udało się zapisać. Spróbuj ponownie.”.
**Estimated Steps:** 7

- [x] 15.0 Complete the verify-email and unsubscribe pages
  - [x] 15.1 Write 6-8 focused tests
    - `verifyEmailViewState.test.ts`: an `it.each` table with missing token, loading, error, confirm, invalid 404/410, success, and "success, then lookup 410 → success"
    - `unsubscribeViewState.test.ts`: an `it.each` table plus `unsubscribeToken` parsing (valid category, `ALL`/garbage → invalid)
    - `VerifyEmailPage.test.tsx`: no POST before the click; renders without `AppDataProvider` (M-5); guest vs logged-in invalid
    - `UnsubscribePage.test.tsx`: both scopes send the right body and show the right done text; a 404 → invalid
  - [x] 15.2 Write `unsubscribeToken.ts` (reads the category segment of `1.<CATEGORY>.<party>.<sig>` against the visible categories; never checks the signature) and the label map
  - [x] 15.3 Write `verifyEmailViewState.ts` and `unsubscribeViewState.ts` as pure resolvers (verify precedence: success > confirm error > lookup)
  - [x] 15.4 Write `VerifyEmailPage.tsx`: `useAccountTokenLookup(token, "VERIFY_EMAIL")`, confirm on click, then the awaited invalidations + `useOptionalPanelReload()`, `useEmailVerificationRequest` for the logged-in resend
  - [x] 15.5 Write `UnsubscribePage.tsx` with `switch (view.kind)` and the choice/done/invalid/error screens
  - [x] 15.6 Write the thin `app/(public)/verify-email/page.tsx` and `app/(public)/unsubscribe/page.tsx`, each with `export const metadata = { referrer: "no-referrer" }`, no guard, in `AuthLayout`
  - [x] 15.7 Ensure the page tests pass
    - run only the four test files above

**Acceptance Criteria:**
- The 6-8 tests pass
- Implementation matches each `acceptance` criterion declared above; a GET never confirms

### Task Group 16: Frontend Home Banner & Account Row
**Dependencies:** 11, 12
**Files to Modify:** `src/frontend/src/features/email/VerifyEmailBanner.tsx`, `src/frontend/src/features/panel/HomeView.tsx`, `src/frontend/src/features/account/AccountView.tsx`, `src/frontend/src/test/VerifyEmailBanner.test.tsx`, `src/frontend/src/test/AccountPointsView.test.tsx`
**Visual References:**
- mockup: analysis/design-context/mockups/start-baner-weryfikacji-adresu.html
  element: screen:home-verify-banner
  locator: "Przed wysłaniem" 267-269, "Po wysłaniu" 269-271, "Adres potwierdzony lub maile wyłączone (null): brak banera" 271-276
  acceptance: the banner sits directly under the greeting „Witaj, <name>!” / subline, above the feed blocks. It renders only when `profile.email_verified === false` and is hidden for `true` and `null`.
- mockup: analysis/design-context/mockups/start-baner-weryfikacji-adresu.html
  element: component:verify-banner
  locator: the `.hint` block in lines 267 and 269 (✉️ icon, h3, text, action link)
  acceptance: `HintCard` look in a `role="status"` wrapper with no dismiss ✕. Before sending: „Potwierdź swój adres e-mail” / the neutral M-7 text „Potwierdź adres, żebyśmy mogli wysyłać Ci ważne wiadomości.” / „Wyślij link”. After sending: „Sprawdź skrzynkę” / „Wysłaliśmy link na <email>. Kliknij go, żeby potwierdzić adres.” / „Wyślij ponownie” (`aria-disabled` during the 60 s cooldown, with a handler guard). A failure shows `role="alert"` with the server message or „Nie udało się wysłać linku. Spróbuj ponownie.”.
- mockup: analysis/design-context/mockups/konto-sekcja-ustawienia.html
  element: screen:account-settings-row
  locator: "Nowy wiersz nad wylogowaniem" state, lines 267-275 (the „Ustawienia” list)
  acceptance: in the „Ustawienia” section of `AccountView`, a `ListCard` row „Powiadomienia e-mail” → `viewPath("settings")` sits directly above „Wyloguj się”, in the same row style as its siblings.
**Estimated Steps:** 5

- [x] 16.0 Complete the Home banner and Account row
  - [x] 16.1 Write 4-5 focused tests
    - `VerifyEmailBanner.test.tsx`: shown only for `false` (`it.each` over false/true/null); after the click it shows the sent copy with `aria-disabled` „Wyślij ponownie” during the cooldown (fake Date timers); the failure alert
    - `AccountPointsView.test.tsx` (existing AccountView test file): the „Powiadomienia e-mail” row links to `/settings` and sits above „Wyloguj się”
  - [x] 16.2 Write `features/email/VerifyEmailBanner.tsx` over `HintCard` (no `onDismiss`) using `useEmailVerificationRequest`
  - [x] 16.3 Render the banner in `features/panel/HomeView.tsx` directly under the greeting, from the AppData profile
  - [x] 16.4 Add the `ListCard` row to `features/account/AccountView.tsx`
  - [x] 16.5 Ensure the banner and account tests pass
    - run only the two test files above

**Acceptance Criteria:**
- The 4-5 tests pass
- Implementation matches each `acceptance` criterion declared above

### Task Group 17: Frontend Route Manifest & SSR Fixtures
**Dependencies:** 11, 12, 13, 14, 15, 16
**Files to Modify:** `src/frontend/src/test/routeManifest.test.ts`, `src/frontend/src/test/panelPages.ts`, `src/frontend/src/test/ssrSafety.test.tsx`
**Estimated Steps:** 4

- [x] 17.0 Complete the route integration cases
  - [x] 17.1 Write 4-6 focused test cases
    - `routeManifest.test.ts`: `/verify-email`, `/reset-password` and `/unsubscribe` are guest-open pages, and no `redirect()` page sits under a layout that withholds children
    - `panelPages.ts`: add `/settings`
    - `ssrSafety.test.tsx`: `renderToString` of the three public pages and `/settings` (incl. an `initialToken` case) without browser globals
  - [x] 17.2 Fix any SSR issue surfaced in the feature entries without changing their behaviour (`useClientValue`, no `window` during render)
  - [x] 17.3 Run `npm run typecheck` and `npm run lint` and fix new findings
  - [x] 17.4 Ensure the route tests pass
    - run only the three files above plus `panelPages.test.ts`

**Acceptance Criteria:**
- The 4-6 cases pass; typecheck stays at 0; lint adds no new findings

### Task Group 18: Documentation, Changelog & Runbook
**Dependencies:** 10, 17
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`, `.maister/docs/standards/backend/security.md`, `.maister/docs/INDEX.md`, `CHANGELOG.md`
**Estimated Steps:** 6

- [x] 18.0 Complete the documentation
  - [x] 18.1 Write 2 focused checks (a doc lint, not pytest)
    - grep that `architecture.md` contains the runbook headings for 0110–0112 and no literal secret values (only variable names)
    - grep that `CHANGELOG.md` has the new bullet under „## Unreleased”
  - [x] 18.2 Update `architecture.md` in place, keeping its existing uncommitted edits
    - replace the l.480 „In-app notifications only”
    - add the section „E-mail (`app/email/`)”: flow, flags, matrix rows 74–82, keys, job, webhook, privacy rules
    - Mailgun EU under External Integrations, the new tables under Database Schema, the `EMAIL_*`/`APP_PUBLIC_BASE_URL` names under Configuration
  - [x] 18.3 Add the 0110–0112 runbook (steps 1–8 from the spec)
    - the `pg_dump` and slug-collision query, no image-only rollback, the lossy `downgrade 0109`
    - deploy with `EMAIL_ENABLED=false`, check variables by presence only (SECRETS rule), the warm-up, the `EMAIL_NOTIFICATIONS_ENABLED` emergency stop, the DMARC ramp, COMPLAINT lifted only by support
    - the Mailgun-side suppression and 5-minute-skew notes
  - [x] 18.4 Update `tech-stack.md` (the `jinja2` version from `uv.lock`, the Mailpit image tag) and `standards/backend/security.md`
    - rows 74–79/82 as auth-flow/provider PUBLIC POST exceptions next to 72/73
    - the HMAC webhook, hashed single-use tokens with the atomic claim, `no-referrer` on token pages
  - [x] 18.5 Update the `INDEX.md` summaries, and add the Polish `CHANGELOG.md` bullet under „## Unreleased”
  - [x] 18.6 Ensure the doc checks pass (re-run the 18.1 greps)

**Acceptance Criteria:**
- The 2 checks pass
- Docs name variables only and never values

### Task Group 19: Test Review & Gap Analysis
**Dependencies:** All previous groups
**Files to Modify:** `src/backend/tests/test_email_*.py`, `src/backend/tests/test_account_tokens.py`, `src/frontend/src/test/*Email*.test.tsx`, `src/frontend/src/test/*ViewState.test.ts`
**Estimated Steps:** 4

- [x] 19.0 Review and fill critical gaps
  - [x] 19.1 Review the tests from groups 1–17 (about 91–115) against the spec's 11 planned test groups and Success Criteria 1–8
  - [x] 19.2 Analyse gaps for this feature only. Likely candidates:
    - the end-to-end path bell → queue → job → fake sender → webhook DELIVERED
    - unsubscribe taking effect on the next run
    - TRANSACTIONAL mail not delayed by quiet hours
    - a token mail's `expires_at` = the token expiry
  - [x] 19.3 Write up to 10 additional strategic tests for the gaps found
  - [x] 19.4 Run the feature tests only, then check typecheck/lint/mypy/ruff against the baseline
    - backend: `tests/test_email_*.py`, `test_account_tokens.py`, `test_my_profile.py`, `test_google_login.py`, the guard/matrix files, `test_wants_notifications.py`, `test_notifications.py`
    - frontend: the new and edited files
    - baseline: 32 vitest, 2 stale backend, mypy 15, ruff 64

**Acceptance Criteria:**
- All feature tests pass (~91–125 total)
- No more than 10 additional tests added
- No regression beyond the recorded baseline

## Execution Order

1. Backend Platform: Config, Clock & Dependencies (7 steps, no dependencies)
2. Database Layer: Migrations 0110–0112 & Models (8 steps, no dependencies)
3. Email Core: Rules, Links, Rendering & Senders (8 steps, depends on 1, 2)
4. Profile Verification Exposure & Google Sign-in (6 steps, depends on 1, 2)
5. Enqueue Service & Notifications Hook (6 steps, depends on 2, 3)
6. Send Job & Recipient ACL (7 steps, depends on 2, 3)
7. Mailgun Webhook & Suppressions (5 steps, depends on 1, 2, 3)
8. Preferences & Unsubscribe API (6 steps, depends on 5, 6, 7)
9. Account Tokens & Auth Endpoints (7 steps, depends on 4, 5)
10. App Wiring: Lifespan, Send Job Schedule, Matrix & Guards (6 steps, depends on 6, 8, 9)
11. Frontend API, Hooks & Shared Component Extensions (7 steps, no dependencies)
12. Frontend Routing Plumbing & Reserved Slugs (5 steps, no dependencies)
13. Frontend /settings Page & Category Switch (6 steps, depends on 11, 12)
14. Frontend Reset Password Page & Login Link (7 steps, depends on 11)
15. Frontend Verify Email & Unsubscribe Pages (7 steps, depends on 11)
16. Frontend Home Banner & Account Row (5 steps, depends on 11, 12)
17. Frontend Route Manifest & SSR Fixtures (4 steps, depends on 11–16)
18. Documentation, Changelog & Runbook (6 steps, depends on 10, 17)
19. Test Review & Gap Analysis (4 steps, depends on all)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/`: error-handling (job conflicts as one WARNING, others logged once and not re-raised), validation (inline `role="alert"`, `aria-invalid`/`aria-describedby`), conventions (`.env.example` names, `uv.lock` shipped), minimal-implementation (only visible categories get switches, no stubs), commenting, coding-style.
- `backend/`: models.md (`BaseEntity`, string enums, loose cross-module ids, explicit names), migrations.md (`lock_timeout`, separate schema/column/data revisions, a round-trip test, a runbook in `architecture.md`), security.md (matrix rows with tests, `compare_digest`, hashed single-use tokens, no secrets/PII in logs), queries.md (constant statement counts, batched `IN`/`VALUES`, SKIP LOCKED), time.md (`clock.local_now()`, `clock.local_to_utc`, the `app/email` clock guard), api.md.
- `frontend/`: components.md (thin route files, `features/<domain>/`, routing facade only, `resolve…View()` in `*ViewState.ts`, `documentNavigation` full reload), accessibility.md (`role="switch"`/`status`/`alert`, `aria-disabled` + handler guard), data-fetching.md (hooks in `src/hooks/`, prefix keys, awaited invalidation, `extractProblemMessage`), css.md, responsive.md.
- `testing/`: backend-testing.md (integration-first, exact key sets, `freeze_local_now`, `count_queries`, migration tests restoring head), frontend-testing.md (explicit vitest imports, `renderWithRoute`, `createQueryWrapper`, `vi.useFakeTimers({ toFake: ["Date"] })`, typed fixtures without casts).

## Notes

- Test-Driven: each group starts with its focused tests.
- Run Incrementally: only the new tests run after each group; group 19 runs the feature set.
- Mark Progress: check off steps as they are completed.
- Reuse First: `fake_embedder`, `_run_embedding_reconcile`, `_GOOGLE_ERRORS`, `0107_user_identities.py` + its test, `WantNotificationToggle`, `ToggleRow`/`Switch`/`HintCard`/`ListCard`, `AuthLayout` + `authStyles`, `replaceDocument`, `authPath`, `renderWithRoute`.
- SECRETS: never print or write secret values; check configuration by presence only. This applies to every subagent prompt touching configuration or infrastructure.
- No git commits; all work stays uncommitted.
