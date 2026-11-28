# Codebase Analysis Report

**Date**: 2026-11-27
**Task**: Implement the `app/email` sending module (queue, sender job, provider adapters, templates, webhook/suppressions, opt-out, account tokens, verification/reset, frontend pages)
**Description**: Implement the app/email sending module designed in research `.maister/tasks/research/2026-11-26-email-sending-module` (design: `analysis/research-context/high-level-design.md` and `decision-log.md`): `email_messages` queue inserted in the same transaction as bells via a hook in `notifications.service` (and an auth ACL for account mails), `_run_email_send` job, `EmailSender` port with Mailgun EU/SMTP/log adapters, Jinja2 templates, HMAC webhook + `email_suppressions`, opt-out `email_preferences` with RFC 8058 unsubscribe, `account_tokens` for verification/reset, `user_profiles.email_verified_at` + Google backfill, frontend `/settings`, `/verify-email`, `/reset-password`, `/unsubscribe`, banner, LoginForm link.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery+Code Analysis (backend), Context Discovery (tests/guards/migrations/config), Pattern Mining (frontend))

---

## TL;DR
- No email code exists at all (architecture.md l.480 says "In-app notifications only"). This is a new bounded context, `app/email`, plus migration 0110 onward, `jinja2` as a new dependency, and four new frontend routes.
- The one place every bell is created is `app/notifications/service.py`: `create_notification` (`db.add`, one row) and `create_notifications` (one Core INSERT for many rows). A hook there covers all 13 `NotificationKind`s from 4 caller groups, with no change to the callers.
- Collapsing and muting `WANT_MATCH_FOUND` happens outside the service, in `wants/application/match_notifications.py`. That code deletes notification rows after they are created, so `email_messages.notification_id` must be a loose UUID with no FK.
- Import cycles (auth ↔ users, and notifications → email) and tests that pin statement counts (`test_wants_notifications.py:92,115`) are the main implementation risks.
- The overall scope is large, but every piece has a direct precedent: the points module boundary, the Google nonce key derivation, the embeddings setter and flag, the 0107 migration plus its round-trip test, and `WantNotificationToggle`.

## Key Decisions
- Hook enqueueing into `notifications.service.create_notification(s)`, not into each caller — every bell already passes through those two functions, all in the caller's transaction.
- `app.email` must not import `app.notifications`. Pass plain values (the kind as a string, party_id, message, link_path, notification id) — otherwise notifications → email → notifications is a cycle. Notifications reaches email through its own `notifications/infrastructure/email_acl.py`, which is a new directory.
- `create_notification` must set `id=uuid4()` explicitly, because the ORM default only applies at flush and the service never flushes. `create_notifications` already builds explicit ids.
- `email_messages.notification_id` is a loose UUID with no FK, because want-match collapsing deletes unread rows (`match_notifications.py:162`, `writes.py::_drop_unread_match_row`).
- Batch path: one INSERT per call no matter how many rows (Core `insert().values([...])` + `on_conflict_do_nothing`). The relative statement-count budgets (`test_term_end_scan.py:808-815`, `test_points_purchase_flow.py:443`) keep working. Only the absolute pins in `test_wants_notifications.py` change.
- Do not route email through `outbox_entries`. Use a dedicated queue drained by an APScheduler `_run_email_send` job, modelled on `_run_embedding_reconcile` (always scheduled, gated by a flag, one INFO summary line).
- Enqueue the registration verification mail from `users.router.register` after `service.register`, or from an auth-side function via an `auth/infrastructure/email_acl.py`. This avoids the auth.service ↔ users.service import cycle.
- Expose `email_verified` only on `/api/people/me` (`_to_my_profile_response`), not on the shared `UserProfileResponse` used by `/api/people/{id}` and `/by-party/{party_id}`.
- Token endpoints (verify, reset, unsubscribe) return 400/404/410, never 401. `api/client.ts` 41-48 clears the session and redirects to `/login` on any 401 while a token is stored.
- Derive the HMAC keys (unsubscribe links, account tokens) from `JWT_SECRET` the same way `auth/google.py` 85-90 does (`decode_base64_hmac_key` + a purpose label). The Mailgun webhook signing key stays a separate setting.
- Frontend data access: query hooks plus `useCallback` writes that call `invalidateQueries` (the `useUpdateMyProfile`/`useWants` pattern). `useMutation` is used nowhere, even though the standards doc mentions mutations.

## Open Questions / Risks
- **Daily topic key + DO NOTHING**: if `WANT_MATCH_FOUND` emails are deduped per want per day, a later bell the same day with a higher count is not emailed again. The design needs to confirm this is acceptable.
- **Outbox handler retries**: the `outbox_listener.py` handlers run without a savepoint. A retried handler creates duplicate bells with new ids, so a `notification:<id>` dedupe key will not stop a duplicate email. `bells_due` is safe because its `begin_nested()` rolls back the email insert too.
- **Organization parties**: notifications can target ORGANIZATION parties (`match_notifications.py` 99-101), and organizations have no `UserProfile`/email. The design must decide between skipping them and resolving to founders or organizers.
- **Google backfill of `email_verified_at`**: `user_identities.email` is a nullable snapshot and can differ from `user_profiles.email`. The backfill must match only rows where the snapshot is verified and equals the profile email (case-insensitive).
- **The `email_verified_at` invariant**: today only the `create_account_and_profile` constructor (`users/service.py` 77-82) writes `user_profiles.email`, and there is no email-change path. If one is added later, it must reset verification.
- **Reserved-slug parity test**: `reservedSlugs.ts` already lists `settings`, but no `/settings` route exists, so `src/test/reservedSlugs.test.ts` is probably failing now. Adding `/settings` fixes it. `verify-email`, `reset-password` and `unsubscribe` must be added to both the backend and frontend lists.
- **Quiet hours / day key**: `app/core/clock.py` has no Warsaw→UTC helper, so one must be added (the clock guard applies to the new `app/email`).
- **Secrets and PII**: never log tokens, recipient addresses or provider keys. `last_error` must not contain an address. The `.env.example` and compose entries carry names and placeholders only.
- **Compose profiles**: a `mailpit` dev service with `profiles: ["dev"]` would be the first use of profiles in `docker-compose.yml`.
- **Public POST abuse**: the forgot-password and resend-verification POSTs are PUBLIC. Consider an nginx `limit_req` zone like the existing `public_reads` (`src/frontend/nginx.conf`).
- **Baseline noise**: 32 vitest failures, 2 stale backend tests, mypy 15 and ruff 64 already exist (memory, 2026-11-26). Verification must compare against this baseline.

---

## Summary

The email module is new, but it fits cleanly into existing seams. Every in-app bell passes through two functions in `app/notifications/service.py`, so one hook there queues the email in the same transaction. Account mails (verification, reset) hook into the `auth`/`users` registration and Google flows. The codebase already has close templates for every part: the module boundary and clock guards, the setter-based adapters (`set_embedder`/`set_classifier`), the lifespan scheduler jobs, the 0107 migration plus its round-trip test, the PUBLIC auth-flow POST rows in the authorization matrix, and the panel/public page patterns on the frontend.

---

## Files Identified

### Primary Files

**src/backend/app/notifications/service.py** (147 lines)
- `NotificationEntry` (38-45; party_id, kind, message, link_path), `create_notification` (48-74, `db.add` only, no id set), `create_notifications` (77-104, one Core insert, explicit ids, returns ids), `delete_unread_notifications` (107-119).
- This is where the email enqueue hook goes. It currently imports only `app.core.errors` and its own models/repository.

**src/backend/app/notifications/models.py**
- `NotificationKind` (22-50, 13 members), `Notification` (53-99). Decides which kinds get emails, mapped to templates by string value.

**src/backend/app/wants/application/match_notifications.py**
- `write_bell_rows` (147-217): muting via `_wants_to_notify` (57-79), deletion of the previous unread row (162), count summing (166-170), the `create_notifications` call (207), positional slicing (213), `_entry` (112-120). `want.id` is available at 177-196 for a topic key.

**src/backend/app/main.py** (307 lines)
- Job pattern (`_run_attendance_close` 93-100, `_run_embedding_reconcile` 131-153), lifespan (199-267: checks, startup info line, setters, outbox, scheduler `add_job` 248-257, shutdown reset), routers (287-307; `system_router` catch-all last). Gets `_run_email_send`, the `set_email_sender` wiring, the webhook/unsubscribe/account routers and the config checks.

**src/backend/app/config.py** (102 lines)
- `Settings` with optional groups and `*_configured` properties (85-99), `mode="before"` validators, bool flags. New `EMAIL_*`/`MAILGUN_*`/`SMTP_*` settings go here.

**src/backend/app/auth/router.py**
- `/api/auth` prefix, `/login` (80-115), `/google/nonce` (168-176), `/google` (179-217). This is the template for the new PUBLIC POSTs (verify, forgot-password, reset-password, resend).

**src/backend/app/auth/google.py**
- Purpose-key derivation (85-90), the httpx usage pattern (142-146), the "never log credential, cookie or email" rule.

**src/backend/app/auth/service.py**
- `_bootstrap_google_account` (99-116), `sign_in_with_google` (commit 143), `_log_in_linked`. This is where Google sign-in sets or backfills `email_verified_at`.

**src/backend/app/users/service.py**
- `create_account_and_profile` (64-92), `bootstrap_person_account` (291-315), `register` (328-353, commit 351), `is_email_registered` (279-288).

**src/backend/app/users/models.py / users/schemas.py / users/router.py**
- `UserProfile` (45-74) gets `email_verified_at`. `UserProfileResponse` (37-65) is shared. `_to_my_profile_response` (62-69) is the place to expose `email_verified` on `/me` only. The register route is at 42-53.

**src/backend/app/core/authorization_matrix.py**
- Rows 72/73 (184-188) are the auth-flow PUBLIC POST precedent. Append the new rows after 188, before the catch-all `# 25` at line 274. Rows 66-69 (263-273) are the login-only precedent for `/api/email/preferences`.

**src/backend/app/core/clock.py**
- Needs a Warsaw→UTC/day-key helper. `fit_notification_message` is at 66.

**src/frontend/src/features/auth/LoginForm.tsx** (71 lines)
- Add the "Nie pamiętasz hasła?" link after the password field (~58) using `AUTH_LINK` and the routing `Link`. It also renders inside the `AuthSheet` modal.

**src/frontend/src/features/account/AccountView.tsx**
- The "Ustawienia" section (124-135) gets a "Powiadomienia e-mail" row pointing to `viewPath("settings")`. There is a stray `},        ]}` at l.50.

**src/frontend/src/features/home/HomeView.tsx**
- Place for the verification banner, after the `<h1>` (65-67) or in the hints block (112-156) using `HintCard`/`useDismissibleHint`.

**src/frontend/src/routing/paths.ts**, **src/frontend/src/proxy.ts**, **src/frontend/src/routing/reservedSlugs.ts**, **src/backend/app/organizations/slugs.py**
- Add `settings` to `View` (3-27) and `PROTECTED_PREFIXES` (142-160). Add the new top-level slugs to both reserved lists.

### Related Files

**src/backend/app/outbox/** (dispatcher, registry, scheduler, service): the existing retry semantics (MAX_ATTEMPTS=5, SKIP LOCKED, no backoff). A reference for the claim loop only, not a transport for email.
**src/backend/app/notifications/outbox_listener.py**: `PLEDGE_*` (56, 68) and `TERM_CONFIRMATION_NEEDED` (102, 134, in a loop) callers. They have no savepoint, which is the retry-duplicate risk.
**src/backend/app/groups/infrastructure/notifications_bridge.py** (19-35): pass-through used by `event_reservations.py:127`, `term_item_listings.py` (:850, :857, :1012, :1160, :1185, :1232, :1286) and `terms.py:449`.
**src/backend/app/wants/infrastructure/notifications_acl.py**: re-exports the notification API to wants.
**src/backend/app/wants/application/bells_due.py**: `begin_nested()` around `write_bell_rows`.
**src/backend/app/wants/application/writes.py**: `_drop_unread_match_row` (122-128; called at 234, 283).
**src/backend/app/wants/infrastructure/users_acl.py**: the closest ACL precedent for resolving party → profile/email.
**src/backend/app/users/service.py::get_profile_by_principal / find_party_id_by_principal** (95-117): principal → party for the preferences endpoints.
**src/backend/app/auth/models.py**: `User` (`password_hash` nullable since 0108), `UserIdentity` (71-100).
**src/backend/app/core/security.py**: `hash_password` 18, `verify_password` 23, `decode_base64_hmac_key` 28.
**src/backend/app/core/text_guard.py:82**, **src/backend/app/embeddings/service.py 59-73**, **src/backend/app/storage/service.py 126-130**: setter and dependency patterns for the `EmailSender` port.
**src/backend/app/db.py**: `async_session_factory`, `TRANSACTION_CONFLICTS`, `mapped_transaction_conflicts`.
**src/backend/app/core/base_model.py**: `BaseEntity`. Core inserts must set `id`/`created_at`/`updated_at`. `_enum_column` is copied per module.
**src/backend/alembic/versions/0107_user_identities.py**, **0103_points_tables.py**, **0105_points_seed.py**, **0109_points_offers.py**: create-table, constraint/index, data-migration and add-column templates. Latest is 0109, so the new revisions start at 0110.
**src/backend/pyproject.toml / uv.lock**: `jinja2` is absent, so `uv add jinja2` and ship the lock. `httpx` is already present (0.28.1).
**.env.example**, **docker-compose.yml**, **src/frontend/nginx.conf**: new setting names, an optional dev mailpit, an optional rate limit.
**.maister/docs/project/architecture.md** (l.476/480, 553-559, 566-571), **CHANGELOG.md** ("## Unreleased", Polish bullets): docs to update.
**src/frontend/src/api/people.ts** (UserProfileResponse 5-25), **api/auth.ts**, **api/client.ts**, **api/problem.ts**, **hooks/useMyProfile.ts**, **hooks/useUpdateMyProfile.ts**, **hooks/useWants.ts**, **features/wanted/WantNotificationToggle.tsx**, **components/appComponents.tsx** (Switch/ToggleRow 19-75, HintCard 77-130, ListRowItem 449-488), **features/panel/PanelRouteStates.tsx**, **features/panel/PanelGate.tsx**, **features/auth/AuthLayout.tsx**, **features/auth/LoginPage**, **auth/AuthContext.tsx**, **auth/session.ts**, **routing/documentNavigation.ts**, **utils/appHelpers.ts** (ACCOUNT_SUBVIEWS 13-23).

---

## Current Functionality

There is no email capability. Users get in-app bells only. Accounts have no email verification and no password reset; password-less Google-only accounts cannot recover access.

### Key Components/Functions

- **create_notification**: adds one `Notification` ORM row. No flush, no explicit id.
- **create_notifications**: one Core INSERT with explicit ids and timestamps. Empty input issues no statement.
- **write_bell_rows**: the want-match bell writer that mutes, collapses (deletes the previous unread row and sums counts) and repoints wants. Runs in a savepoint from `handle_bells_due`.
- **Outbox dispatcher**: per-row commit, 5 attempts, runs every 60 s via `run_forever`.
- **Lifespan jobs**: APScheduler interval jobs (`coalesce=True`, `misfire_grace_time=None`), each opening its own session and logging exceptions without re-raising.
- **Google sign-in**: creates GUEST accounts via `bootstrap_person_account(password=None)` and stores `UserIdentity.email_verified`. Unverified Google emails get a 403.
- **Registration**: `POST /api/auth/register` (users router) → `register` → `_bootstrap_registration` savepoint → commit 351.

### Data Flow

Domain event → caller (groups/terms/events code, an outbox listener, or the wants `bells_due` handler) → `notifications.service.create_notification(s)` inside the caller's transaction → caller commits. The proposed flow adds: the hook resolves party → recipient (PERSON with `account_user_id`, an email, not suppressed, opted in), inserts an `email_messages` row (`ON CONFLICT DO NOTHING` on a dedupe key) in the same transaction → `_run_email_send` claims rows with `FOR UPDATE SKIP LOCKED`, renders the Jinja2 template, sends via the `EmailSender` adapter, marks sent or failed with retries → the Mailgun HMAC webhook writes `email_suppressions` on bounces and complaints. Account mails: register / Google / forgot-password → `account_tokens` (hashed) → an `email_messages` row → user clicks the link → frontend `/verify-email` or `/reset-password` → PUBLIC POST consumes the token.

---

## Dependencies

### Imports (What This Depends On)

- `app.core` (clock, security key derivation, errors, base_model, config): allowed for the module.
- `app.db`: sessions, `TRANSACTION_CONFLICTS`.
- `httpx`: Mailgun HTTP API (already a dependency).
- `jinja2`: **new** dependency for the templates.
- stdlib `smtplib`/`email` (or an async wrapper): SMTP adapter.
- SQLAlchemy `postgresql.insert().on_conflict_do_nothing`.
- Users/party data through an `app/email/infrastructure/*_acl.py` (party → profile email, account_user_id) using Core table refs, like the points module.

### Consumers (What Depends On This)

- **app/notifications/service.py** (via a new `notifications/infrastructure/email_acl.py`): enqueue on every bell.
- **app/auth** (via `auth/infrastructure/email_acl.py`) and/or **app/users/router.py**: verification and reset mails.
- **app/main.py**: job, routers, sender wiring.
- Indirectly every bell producer: outbox_listener, groups notifications_bridge (term_item_listings, terms, event_reservations), wants match_notifications.

**Consumer Count**: 3 direct importers (main, notifications ACL, auth ACL); about 6 indirect producer files.
**Impact Scope**: High. The hook sits on the shared bell path, so every notifying write path runs the new code in its transaction.

---

## Test Coverage

### Test Files

- **tests/test_module_boundaries.py**: copy the points pattern (`_POINTS_IMPORTERS` l.103-107, tests l.110 and l.122) for `app.email` importers = {main, notifications ACL, auth ACL}, and update the docstring at l.1-8.
- **tests/test_domain_clock_guard.py**: add `_APP_ROOT/"email"` to `_GUARDED_DIRS` (l.27-35).
- **tests/test_authorization_matrix.py**: parametrized `resolve_requirement` tests. The template is `test_resolveRequirement_googleSignInRoutes_postPublicGetAuthenticated` (l.178-190), plus the ordering tests at l.530-570.
- **tests/conftest.py**: force `EMAIL_*` env (for example a disabled or log sender) before importing `app.config` (as at l.53-54). Add a `fake_email_sender` fixture modelled on `fake_embedder` (l.295-306).
- **tests/test_notifications.py**: `_process_outbox`, `_register` → (token, party_id). The base for hook integration tests.
- **tests/test_wants_notifications.py**: l.92 pins `["INSERT"]` (becomes two statements when the hook is active), l.115 pins zero statements for empty input (must stay zero).
- **tests/test_term_end_scan.py:808-815**, **tests/test_points_purchase_flow.py:443**: relative statement budgets. These stay valid if the hook issues a constant number of statements per call.
- **tests/test_google_login.py**, **tests/test_google_token_verifier.py**: fake JWKS, a `google` fixture. Extend them for `email_verified_at` on Google sign-in.
- **tests/test_user_identities_migration.py** (+ points migration tests): the round-trip migration test template for 0110+.
- **tests/test_organizations.py**: reserved-slug test for the new slugs.
- Frontend: **src/test/reservedSlugs.test.ts**, **routeManifest.test.ts** (guest-open list ~l.175, no `redirect()` under ClientOnly ~l.183), **panelPages.ts**, **proxy.test.ts** (73-98), **ssrSafety.test.tsx** (UserProfileResponse fixture ~120-165, add `email_verified`), **auth.test.tsx** (LoginPage l.146), **AccountPointsView.test.tsx** (mock template), **useWants.test.tsx** (hook template), **wantedListViewState.test.ts** (view-state `it.each`).

### Coverage Assessment

- **Test count**: new module, so 0 existing tests. Existing guard and matrix suites give the structural coverage; plan about 2–8 tests per feature slice (queue hook, sender job, adapters, webhook, preferences/unsubscribe, tokens/verify/reset, migrations, frontend pages).
- **Gaps**: nothing tests retried outbox handlers creating duplicate bells, organization recipients, or same-day collapse behaviour. All three need explicit tests once the design decides them.

---

## Coding Patterns

### Naming Conventions

- **Modules**: `app/<bc>/{models,service,router,schemas}.py`, `application/`, `domain/`, `infrastructure/<other>_acl.py`.
- **Functions**: snake_case async services taking `db` first and keyword-only args (`*, party_id, kind, ...`).
- **Migrations**: `NNNN_<name>.py`, hand-named `pk_`/`fk_<table>_<col>_<ref>`/`ix_`/`uq_`/`ck_`, `SET LOCAL lock_timeout = '5s'` first, `target_metadata=None` (no autogenerate).
- **Tests**: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>` camelCase.
- **Frontend**: `features/<domain>/<Name>View.tsx`, thin `app/(public)/(panel)/<route>/page.tsx`, `hooks/use<Name>.ts` with `<NAME>_KEY`, `api/<resource>.ts` plain functions, `*ViewState.ts` + tests in `src/test/`.

### Architecture Patterns

- **Style**: functional async services, ports set via module-level setters (`set_x`/`get_x`), fail-fast config checks as a `RuntimeError` in the lifespan.
- **Cross-context access**: only through `infrastructure/*_acl.py`, enforced by guard tests.
- **Jobs**: APScheduler interval jobs in `main.py`, `async with async_session_factory()`, a WARNING for transaction conflicts, `logger.exception` otherwise.
- **Frontend state**: TanStack Query hooks + `useCallback` writes + `invalidateQueries`; panel views read the profile from `useAppData()`. The session changes only via `setSession`/`clearSession` + `<Navigate reload/>`.
- **UI**: Tailwind tokens (no Chakra in panel UI), `role=switch` toggles (`WantNotificationToggle`), `role=alert` errors (`bg-danger-soft text-danger`), `role=status` lines, Polish copy.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~25–35 new backend files + ~15 frontend files; touched hubs 100–310 lines | High |
| Dependencies | core, db, httpx, jinja2 (new), smtp, users/party ACLs | Medium |
| Consumers | 3 direct, ~6 indirect producers on the bell path | Medium-High |
| Test Coverage | New module; strong guard/matrix/migration test templates | Medium |

### Overall: Complex

This is a new bounded context spanning schema (several tables plus a backfill), a background job, external provider adapters, a public webhook, token-based auth flows and four frontend routes. It hooks into a hot shared write path, and several design edge cases (collapse, retries, organization recipients) need explicit decisions.

---

## Key Findings

### Strengths
- There is a single choke point for bells, in the caller's transaction, which gives atomic enqueueing for free.
- Strong precedents for every piece: the points boundary test, the Google purpose-key HMAC, the embeddings flag/setter/job, the 0107 migration + test, the matrix rows 72/73, `WantNotificationToggle`.
- `bells_due` already uses a savepoint, so a failed batch rolls back its email rows too.
- `httpx` is already a dependency; only `jinja2` is new.

### Concerns
- Import cycles: auth ↔ users, and notifications ↔ email if email imports notification types.
- Collapsed notifications make `notification_id` dangle (so no FK), and a daily dedupe key drops same-day count updates.
- Outbox listener retries without a savepoint can duplicate bells and therefore emails.
- Absolute statement-count pins in `test_wants_notifications.py`.
- The shared `UserProfileResponse` risks leaking `email_verified` on other users' profiles.
- A 401 from token endpoints would log users out via `api/client.ts`.
- PII and secrets in logs and `last_error`.

### Opportunities
- Adding `/settings` fixes the reserved-slug parity test, which is probably failing now.
- The token flow gives Google-only (password-less) accounts a recovery path (an accepted risk in architecture.md).
- The `log` adapter + dev mailpit allow local end-to-end testing without a provider key.

---

## Impact Assessment

- **Primary changes**: new `src/backend/app/email/**` (models, service/application, domain, infrastructure ACLs, adapters, templates, router(s)); `app/notifications/service.py` + new `notifications/infrastructure/email_acl.py`; `app/auth/router.py`/`service.py` (+ `auth/infrastructure/email_acl.py`); `app/users/{models,router,schemas,service}.py`; `app/main.py`; `app/config.py`; `app/core/authorization_matrix.py`; `app/core/clock.py`; `app/organizations/slugs.py`; migrations 0110+; `pyproject.toml`/`uv.lock`.
- **Frontend changes**: new `features/settings` (or email) views, `/settings` panel route (+ loading/error/not-found), public `/verify-email`, `/reset-password`, `/unsubscribe` pages, `api/auth.ts` + a new `api/email.ts`, hooks, `LoginForm` link, `AccountView` row, `HomeView` banner, `paths.ts`, `proxy.ts`/`PROTECTED_PREFIXES`, `appHelpers.ts` ACCOUNT_SUBVIEWS, `reservedSlugs.ts`, the `api/people.ts` type.
- **Related changes**: `.env.example`, `docker-compose.yml` (env + optional mailpit), optional nginx rate limit, architecture.md, CHANGELOG.md, INDEX.md.
- **Test updates**: boundary + clock guards, matrix tests, conftest env + fake sender fixture, `test_wants_notifications.py` pins, migration round-trip tests, new feature tests; frontend route manifest, proxy, ssrSafety fixture, slug parity, auth tests.

### Risk Level: Medium-High

The hook runs inside every notifying transaction, so a bug there can fail core user flows. Mitigation: the hook must never raise for recipient-resolution misses and must issue a constant number of statements. Public token and webhook endpoints are security-sensitive (HMAC verification with `compare_digest`, hashed single-use tokens, no account enumeration on forgot-password). The schema changes need a guarded/round-trip runbook like the earlier releases.

---

## Recommendations

**Creating a new capability, built on existing code:**

1. **Module layout**: `app/email` modelled on `app/points`. Imported only by `main.py`, `notifications/infrastructure/email_acl.py` and `auth/infrastructure/email_acl.py`. Outside `infrastructure/` it imports only `app.core`/`app.db`/`app.email`. Add its boundary and clock guard tests first.
2. **Enqueue API**: `enqueue_notification_emails(db, items: Sequence[PlainItem])`, where each item carries the notification id, party_id, the kind as a string, message, link_path and an optional topic key. It issues one resolve SELECT + one INSERT … ON CONFLICT DO NOTHING per call and no statements for empty input. Call it from both `create_notification` (after setting `id=uuid4()`) and `create_notifications`. Re-pin `test_wants_notifications.py:92` to the new exact sequence.
3. **Recipient rules in SQL**: only PERSON parties with `account_user_id` and a non-null email, not suppressed, opted in for the kind's category (`email_preferences` default on/off per the decision log), and for non-account mails optionally verified. Skip organizations unless the design says otherwise.
4. **Sender port**: a `set_email_sender`/`get_email_sender` setter. Adapters: `log` (default in dev and tests, never logs the address), `smtp`, `mailgun` (EU base URL via httpx). Fail fast in the lifespan when the configured provider lacks its settings.
5. **Job**: `_run_email_send` every N seconds, claims a batch with `FOR UPDATE SKIP LOCKED`, renders outside the lock where practical, records attempts and backoff, writes one INFO summary line when there is work, and a WARNING on transaction conflicts.
6. **Webhook**: PUBLIC POST verifying Mailgun's HMAC (timestamp + token, `compare_digest`, a replay window) and upserting `email_suppressions` for permanent failures and complaints. Add matrix rows after 188 with tests.
7. **Unsubscribe**: signed per-recipient/category links (a key derived from `JWT_SECRET` with a purpose label). Send the `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, add a backend one-click POST endpoint, and a frontend `/unsubscribe` page that confirms via POST, never on GET.
8. **Account tokens**: an `account_tokens` table storing only a hash (SHA-256 of a random token), with purpose, expiry, used_at and single use. Verify/reset endpoints return 400/410. Forgot-password always returns 2xx with no enumeration. A reset sets `password_hash` via `hash_password`, which also covers Google-only accounts.
9. **Verification**: `user_profiles.email_verified_at` (nullable, an additive migration separate from the new tables). Backfill from `user_identities` where `email_verified` is true and the snapshot equals the profile email case-insensitively. Set it on Google sign-in (both the bootstrap and linked paths). Expose `email_verified` on `/me` only.
10. **Migrations**: 0110 tables (`email_messages`, `email_suppressions`, `email_preferences`, `account_tokens`), 0111 the `user_profiles` column, 0112 the backfill data migration. Each gets `lock_timeout`, hand-named constraints, a round-trip test and a runbook section in architecture.md (`pg_dump` first; the downgrade loses the queue/preferences/tokens).
11. **Frontend**: `/settings` panel page with `ToggleRow`/Switch toggles (optimistic, revert + `role=alert`); public token pages without `requireAuth={false}` and outside `(standalone)`; a `/reset-password` request form wrapped like `LoginPage`; a banner via `HintCard` in `HomeView` when `email_verified === false`; after a verify, invalidate `MY_PROFILE_KEY` and reload AppData; update the slug lists, `PROTECTED_PREFIXES`, `View`, ACCOUNT_SUBVIEWS and the route/proxy/ssr tests.
12. **Testing strategy**: a fake sender fixture capturing messages; integration tests per bell kind for the enqueue (same-transaction rollback drops the email); job tests (claim, retry, suppression skip); webhook signature accept/reject; unsubscribe one-click; token expiry/reuse; the Google backfill migration test.

---

## Next Steps

Invoke the gap-analyzer with this report and the research design (`high-level-design.md`, `decision-log.md`). Ask it to settle the open questions first: organization recipients, same-day collapse/dedupe semantics, outbox-retry duplicates, the default opt-in per category, and whether account mails require a verified address. Then move on to the specification and the implementation plan, ordered: migrations + module skeleton and guards → enqueue hook → sender job and adapters → webhook/suppressions → preferences/unsubscribe → account tokens/verification/reset → frontend → docs/runbook.
