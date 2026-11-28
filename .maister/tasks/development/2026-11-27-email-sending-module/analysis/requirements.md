# Requirements: app/email module (research stages 1+2)

## TL;DR
Build the email channel designed in research `2026-11-26-email-sending-module`. It covers the 3 account mails (verify, reset, password changed) and 7 existing bell kinds, sent through Mailgun EU. Sending runs from our own `email_messages` queue (the transactional outbox) and a send job. On top come opt-out preferences, RFC 8058 unsubscribe, a full webhook with suppression, and account tokens. The frontend gets `/settings`, `/verify-email`, `/reset-password`, `/unsubscribe`, a Home banner, a login link and an Account row. Two flags control it: `EMAIL_ENABLED` and `EMAIL_NOTIFICATIONS_ENABLED`. The Phase 4 mockups are binding.

## Key Decisions
- Architecture follows ADR-001..010 of the research — already decided at research convergence, so there are no Phase 5 technical questions
- Scope = stages 1+2; stage-3 bell kinds are a separate task — Phase 1 answer
- Separate `EMAIL_LINK_SIGNING_SECRET`; Mailpit under compose profile `dev` with `SmtpSender` — Phase 1 answers
- Verification token and mail are issued inside `users.service.register` before its commit; `EMAIL_NOTIFICATIONS_ENABLED` (default false) is the stage-2 switch — Phase 2 critical decisions
- Stale-queue expiry; `db.add` single path plus `INSERT … ON CONFLICT` batch path; deterministic `term_confirmation` key; `email_verified: bool|null` on `/me` only; COMPLAINT lifted by support only; reset confirm verifies the email — Phase 2 important decisions
- Reuse only existing UI primitives and hook conventions, with no new UI libraries; mockups are the only visual source, and the support address, sender name and domain come from env — Phase 5 answers

## Open Questions / Risks
- D14 privacy policy and the Mailgun DPA are rollout prerequisites outside the code
- Support address shown in the suppression notice: proposed source is `EMAIL_REPLY_TO_ADDRESS`, returned by `GET /api/email/preferences` (spec to confirm; no new env var unless needed)

## Initial description
Implement the `app/email` sending module from research `.maister/tasks/research/2026-11-26-email-sending-module`. Full design: `analysis/research-context/high-level-design.md` and `decision-log.md`.

## Q&A
### Phase 1
1. Scope? → Stages 1+2.
2. Link signing key? → A separate `EMAIL_LINK_SIGNING_SECRET`.
3. Mailpit? → Yes, under compose profile `dev`.

### Phase 2 (decision gate)
- C-1: the verification mail is created inside `users.service.register`, atomically.
- C-2: a second flag, `EMAIL_NOTIFICATIONS_ENABLED`, default false. The user asked what "warm-up" means; it was explained, then confirmed.
- I-1: stale queue rows expire. NOTIFICATION rows older than 24 h → SKIPPED `expired`; TRANSACTIONAL rows expire with their token.
- I-2: `db.add` for the single `create_notification`, `INSERT … ON CONFLICT DO NOTHING` for `create_notifications`. The user asked "why not the outbox?". Answer: `email_messages` is the transactional outbox, and `outbox_entries` has no backoff and re-runs every handler.
- I-3: a deterministic key `term_confirmation:<reservation_id|proposal_id>:<party_id>`.
- I-4: `email_verified: bool | null` on `/api/people/me` only. The banner shows only when it is false.
- I-5: a COMPLAINT suppression is lifted by support only.
- I-6: a successful reset confirm sets `email_verified_at` when the token's email snapshot equals the profile email.

### Phase 5
1. User journey confirmed:
   - a new password registration gets the verification mail right away;
   - existing accounts see the Home banner (and the state on `/settings`);
   - Google accounts are verified by the backfill and by the bootstrap;
   - settings are reached via Konto → „Powiadomienia e-mail”.
2. Reuse confirmed:
   - `AuthLayout` and `authStyles` for the public pages;
   - `ToggleRow` and `Switch` from `appComponents.tsx`, with `WantNotificationToggle`'s optimistic save and revert;
   - the `HintCard` look for the banner;
   - `useCallback` writes with invalidation (as in `useUpdateMyProfile`);
   - no `useMutation` and no new UI libraries.
3. Visuals: the Phase 4 mockups only. Support address, sender name and domain are configuration.

## Visual assets
`analysis/design-context/INDEX.md` lists 9 screens and 2 components:
- `/settings` in 4 states
- Home banner
- Account row
- login link
- password reset request
- password reset with token
- `/verify-email`
- `/unsubscribe`
- the notification and `verify_email` mail templates

All are binding for layout, copy, field order and states.

## Functional requirements summary
### Backend
1. **Queue.** An `app/email` module owns `email_messages`, `email_preferences` and `email_suppressions`.
   - Rows are written in the caller's transaction:
     - bell rows via a hook in `notifications.service.create_notification(s)`;
     - account rows via `auth/infrastructure/email_acl`.
   - The hook costs exactly one extra statement per call and none for empty input.
   - Nothing is enqueued when `EMAIL_ENABLED=false`. Bell rows are also not enqueued when `EMAIL_NOTIFICATIONS_ENABLED=false`.
2. **MVP bell kinds.** `TERM_ITEM_LISTING_TAKEN`, `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`, `RESERVATION_CANCELLED` (category RESERVATIONS) and `WANT_MATCH_FOUND` (category WANTS).
   - Keys:
     - `notification:<id>`;
     - `want_match:<want_id>:<Warsaw day>` via `NotificationEntry.topic_id`;
     - `term_confirmation:<reservation|proposal>:<party>`.
   - `WANTS_DEFAULT_ENABLED` is a single constant.
3. **Send job `_run_email_send`.** Runs every 60 s with a batch of 50 and claims rows with `FOR UPDATE SKIP LOCKED`.
   - Late binding of recipient, verification, party type, suppression, preferences and `EMAIL_DAILY_CAP`.
   - SKIPPED rows carry a `skip_reason`:
     - `no_address`
     - `unverified`
     - `organization`
     - `suppressed`
     - `category_disabled`
     - `daily_cap`
     - `expired`
   - Quiet hours 22–07 Warsaw apply to NOTIFICATION rows only.
   - Backoff 1/5/15/60/240 min, `MAX_ATTEMPTS` 6.
   - A row stuck in SENDING for more than 10 min goes back to PENDING (NOTIFICATION) or to FAILED (TRANSACTIONAL).
   - Raw tokens are nulled from `payload` once a row reaches a final state.
   - One log line per run.
   - No addresses, tokens or mail content in logs or in `last_error`.
4. **Adapters.** `EmailSender` port with:
   - `MailgunSender` (httpx form POST, EU base URL from env, tracking off, `v:email_message_id`, errors classified as permanent or retryable);
   - `SmtpSender` (stdlib smtplib via `to_thread`, Mailpit);
   - `LogSender`;
   - `FakeEmailSender` in tests.
   - Wired with `set_sender()`/`get_sender()` in the lifespan, chosen by `EMAIL_BACKEND`.
5. **Templates.** Jinja2 (new dependency) with autoescape and `StrictUndefined`, in `html.j2`/`txt.j2` pairs on a shared base.
   - Templates: `verify_email`, `password_reset` (variant for Google-only accounts), `password_changed`, and a generic `notification` rendered from the bell snapshot.
   - List-Unsubscribe headers on NOTIFICATION mails only.
6. **Webhook.** `POST /api/email/webhooks/mailgun` checks the HMAC with `EMAIL_WEBHOOK_SIGNING_KEY`, accepts a timestamp at most 5 min off, and rejects replayed tokens using an in-process memory.
   - `delivered`, `failed` (permanent) and `complained` events. Status never goes down: COMPLAINED > BOUNCED > DELIVERED > SENT.
   - BOUNCE and COMPLAINT create suppressions. A complaint also disables the mail's category.
   - Unknown messages get 200.
7. **Unsubscribe.** `POST /api/email/unsubscribe/{token}` is PUBLIC and covers both the RFC 8058 one-click and the page's scope `category|all`.
   - The token is an HMAC over party + category + format version, signed with `EMAIL_LINK_SIGNING_SECRET`. It does not expire.
8. **Preferences.** `GET`/`PUT /api/email/preferences` for logged-in users (READ/EDIT, no `mcp:*`). The response includes:
   - the categories visible in MVP (RESERVATIONS, WANTS);
   - the ALL switch;
   - suppression state;
   - the support address.
9. **Account tokens.** An `account_tokens` table (auth module): SHA-256 hash, purpose `VERIFY_EMAIL` or `PASSWORD_RESET`, email snapshot, expiry 1 h for reset and 48 h for verification, `used_at`. Issuing a new token invalidates the earlier unused ones.
   - Request limits in the DB: ≤1 per 60 s and ≤5 per hour.
   - Endpoints:
     - `POST /api/auth/password-reset`: always a neutral 202, or 503 when email is disabled.
     - `POST /api/auth/password-reset/confirm`: sets the password, also for a Google-only account; marks the email verified when it matches; enqueues the password-changed mail.
     - `POST /api/auth/email-verification`: logged-in resend.
     - `POST /api/auth/email-verification/confirm`: PUBLIC. Sets `email_verified_at` and clears a BOUNCE suppression.
   - Token errors use 400/404/410, never 401.
10. **Verification column.** `user_profiles.email_verified_at`:
    - set by verification confirm, by reset confirm when the email matches, and by Google bootstrap/sign-in when Google reports the email verified and equal;
    - backfilled from `user_identities` in a data migration;
    - `email_verified: bool | null` on `/api/people/me` only.
11. **Migrations.** `0110` tables, `0111` column, `0112` backfill. Each has explicit constraint names and `lock_timeout`, plus a downgrade-then-upgrade test.
12. **Authorization matrix.** Rows 74–80 with tests.
    - `app/email` goes into the module boundary test (points-style importer set) and the domain clock guard.
    - New clock helper(s) for Warsaw→UTC and the start of the Warsaw day.
13. **Config.** `EMAIL_ENABLED`, `EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_BACKEND`, `EMAIL_PROVIDER_API_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO_ADDRESS`, `EMAIL_LINK_SIGNING_SECRET`, `EMAIL_WEBHOOK_SIGNING_KEY`, `EMAIL_DAILY_CAP`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `APP_PUBLIC_BASE_URL`.
    - These go into `config.py` (with a fail-fast lifespan check), `.env.example` (names only) and the compose backend environment.
    - Startup log line with the flags. Values are never logged.
    - Mailpit service under `profiles: ["dev"]` with a pinned image.

### Frontend
14. **`/settings`** (panel, protected). Built per the mockup:
    - address and badge;
    - resend button with cooldown;
    - suppression notice with toggles disabled;
    - ALL and category switches with optimistic save and revert;
    - a locked transactional row.
15. **Home banner.** Shown only when `email_verified === false`. Has before and after sending states, no dismiss.
16. **AccountView.** A „Powiadomienia e-mail” row above logout.
17. **LoginForm.** A „Nie pamiętasz hasła?” link to `/reset-password`.
18. **Public pages.** `/reset-password` (request, sent, 503; with token: form, expired/used, success with a full reload to `/login`), `/verify-email` (confirm on click only, success, invalid state, resend for logged-in users) and `/unsubscribe` (choice, done, invalid).
    - Each page has a `resolve…View()` in a `*ViewState.ts` with `it.each` tests.
19. **Routing.**
    - Reserved slugs `verify-email`, `reset-password`, `unsubscribe` in both lists;
    - `/settings` in `PROTECTED_PREFIXES`, `View` and `ACCOUNT_SUBVIEWS`;
    - updates to the route manifest, panel pages and proxy tests;
    - `ssrSafety` cases.
20. **API and hooks.** API functions in `api/auth.ts` and a new `api/email.ts`; hook `useEmailPreferences`; `email_verified` in `UserProfileResponse`. Invalidate both `MY_PROFILE_KEY` and AppData after verification.

## Reusability opportunities
- **Backend:**
  - the points importer-set boundary test pattern;
  - the embeddings `set_embedder`/`is_enabled` setter and its fake fixture;
  - the `google.py` httpx usage and `compare_digest`;
  - the `0107_user_identities.py` migration and round-trip test;
  - matrix rows 72/73 as a template;
  - the `create_notifications` Core insert style;
  - `clock.fit_notification_message`;
  - `bootstrap_person_account`.
- **Frontend:**
  - `AuthLayout`, `authStyles`, `LoginPage` (`AuthGuard requireAuth={false}` for reset only);
  - `ToggleRow`/`Switch`, `HintCard` styling, `ListCard`;
  - `useMyProfile`/`useUpdateMyProfile`, `useGoogleSignIn`'s COPY-by-status map;
  - `wantedListViewState.ts` and its test;
  - `renderWithRoute`, `createQueryWrapper`, `ssrSafety`.

## Scope boundaries
**In:** everything above.

**Out:**
- stage-3 new bell kinds;
- reminders and digests;
- chat-message mail;
- email change flow;
- auto-linking Google accounts;
- guardian invite;
- moderation and payment mails;
- `mailto:` unsubscribe;
- admin log UI;
- template localisation;
- account deletion with suppression hashing;
- purging `email_messages`;
- fixing the outbox dispatcher duplicate-bell bug;
- HTTP rate limiting;
- organization recipient routing;
- child → guardian routing;
- `WANT_EXPIRING`/`PLEDGE_*`/`NEEDED_ITEM_REMOVED` by mail.

## Technical considerations
- **Import cycles:** `app.email` must not import `app.notifications`, so kinds are passed as strings. `users.service` must not import `auth.service`.
- **Hook timing:** `create_notification` must assign its id before `db.add`.
- **Tests:** `tests/test_wants_notifications.py:92` must be updated, because it pins exactly one INSERT.
- **Collapsed bells:** a collapsed `WANT_MATCH` bell deletes its notification row, so `email_messages.notification_id` has no FK.
- **Frontend 401:** the frontend clears the session on any 401.
- **Pre-existing baseline:** 32 vitest, 2 stale backend tests, mypy 15, ruff 64. Commands use `uv run --no-sync python -m …` from `src/backend`.
- **Commits:** none without asking (user rule).
- **Secrets:** never printed, anywhere.
