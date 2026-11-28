# Work Log

## 2026-11-27T11:26:56Z - Implementation Started

**Total Steps**: 117
**Task Groups**: 1 Platform config/clock/deps; 2 DB migrations & models; 3 Email core; 4 Profile verification & Google; 5 Enqueue & notifications hook; 6 Send job & recipient ACL; 7 Webhook & suppressions; 8 Preferences & unsubscribe API; 9 Account tokens & auth endpoints; 10 App wiring & guards; 11 FE API/hooks/shared; 12 FE routing & slugs; 13 FE /settings; 14 FE reset password & login link; 15 FE verify-email & unsubscribe; 16 FE home banner & account row; 17 FE route manifest & SSR; 18 Docs/changelog/runbook; 19 Test review
**Waves**: W1 [1,2,11,12] · W2 [3,4,13,14,15,16] · W3 [5,6,7,17] · W4 [8,9] · W5 [10] · W6 [18] · W7 [19]
**Baseline**: 32 vitest, 2 stale backend tests, mypy 15, ruff 64. Unrelated uncommitted search changes left untouched.

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-11-27T11:31:26Z - Group 1 Complete (wave 1)

**Steps**: 1.1–1.7
**Standards Applied**:
- From plan: global/conventions, global/minimal-implementation, global/error-handling, backend/time, testing/backend-testing
- From INDEX.md: project/tech-stack, backend/security
- Discovered: existing Settings validator patterns; the `Settings(_env_file=None)` pattern in test_moderation_config.py
**Tests**: 18 passed (14 new + 4 regression); mypy 15 (baseline), ruff 64 (baseline)
**Files Modified**: app/config.py, app/core/clock.py, tests/conftest.py, tests/test_email_config.py (new), pyproject.toml, uv.lock, .env.example, docker-compose.yml
**Notes**: jinja2 3.1.6 needed `uv add --system-certs` because of a TLS UnknownIssuer error. Mailpit runs as axllent/mailpit:v1.27.10 under profiles [dev]. `email_configuration_errors` holds names only. Blank env values fall back to the field default.

## 2026-11-27T11:31:26Z - Group 12 Complete (wave 1)

**Steps**: 12.1–12.5
**Standards Applied**:
- From plan: frontend/components (routing facade), testing/frontend-testing, testing/backend-testing
- From INDEX.md: backend/security (reserved-slug parity), global/minimal-implementation (no stub pages)
- Discovered: the appRoutes.ts parity rule — RESERVED_SLUGS must equal the top-level page segments
**Tests**: frontend 25/26 (expected: the parity assertion stays red until groups 13–15 add the settings, verify-email, reset-password and unsubscribe pages); typecheck 0; backend test_organizations 48 passed
**Files Modified**: routing/paths.ts, utils/appHelpers.ts, routing/reservedSlugs.ts, backend organizations/slugs.py, test/reservedSlugs.test.ts, test/proxy.test.ts, tests/test_organizations.py
**Notes**: proxy.ts unchanged (PROTECTED_PREFIXES lives in paths.ts). The runbook slug-collision query (L-15) belongs to group 18.

## 2026-11-27T11:34:03Z - Group 2 Complete (wave 1)

**Steps**: 2.1–2.8
**Standards Applied**:
- From plan: backend/models, backend/migrations, backend/queries, testing/backend-testing
- From INDEX.md: global/commenting, global/minimal-implementation
- Discovered: ruff format on new files
**Tests**: 6 passed (4 new + 2 user_identities migration regression); mypy 15, ruff 64 (baseline)
**Files Modified**: app/email/{__init__,models}.py, app/email/infrastructure/__init__.py, app/auth/models.py (AccountToken), app/users/models.py (email_verified_at), alembic 0110/0111/0112, tests/test_email_migrations.py
**Notes**: `send_after`, `expires_at` and `status` have no defaults, so writers must set them. Runbook (group 18): 0110 downgrade lossy, 0111 loses verifications, 0112 downgrade no-op. app.email.models not imported anywhere yet (group 10).

## 2026-11-27T11:39:42Z - Group 11 Complete (wave 1)

**Steps**: 11.1–11.7
**Standards Applied**:
- From plan: frontend/data-fetching, frontend/components, frontend/accessibility, testing/frontend-testing
- From INDEX.md: global/error-handling, global/minimal-implementation
- Discovered: backend/security error envelope `{status, error, message}` → serverMessageOr reads `message`
**Tests**: 6 new passed; 235/248 in touched files. The 13 failures (12 AppPage, 1 PendingActionsHost) reproduce with the HEAD versions and are part of the baseline. Typecheck 0; lint has no findings in touched files.
**Files Modified**: api/auth.ts, api/email.ts (new), api/people.ts (MyProfileResponse), hooks useMyProfile/useEmailPreferences/useEmailVerificationRequest/useAccountTokenLookup, panel/appDataStore.ts (useOptionalPanelReload), AppDataContext.tsx, ProfileAppearancePage.tsx, appComponents.tsx (HintCard onDismiss optional + ctaDisabled, ToggleRow disabled), ~10 test fixtures typed (casts removed)
**Notes**: The `withoutBody()` wrapper in auth.ts handles empty 202 bodies, because client.ts parses JSON on any non-204. Hook contracts for groups 13–16 are recorded in the group report. Standard suggestion: success replies without a body must not be parsed as JSON.

## 2026-11-27T11:39:42Z - Wave 1 resolved (groups 1, 2, 11, 12) — dispatching wave 2: 3, 4, 13, 14, 15, 16

## 2026-11-27T11:45:36Z - Group 4 Complete (wave 2)

**Steps**: 4.1–4.6
**Standards Applied**:
- From plan: backend/models, backend/security, backend/api, testing/backend-testing
- From INDEX.md: backend/time, global/minimal-implementation
- Discovered: `expire_on_commit=False` in app/db.py, so `_log_in_linked` does a single commit
**Tests**: 46 passed (my_profile + google_login); 146 regression passed; mypy 15; touched files ruff-clean
**Files Modified**: users/schemas.py (MyProfileResponse), users/router.py, users/service.py (bootstrap email_verified kw), auth/service.py, tests/test_my_profile.py (ME_KEYS + PROFILE_KEYS), tests/test_google_login.py
**Notes**: `email_verified` is null unless email is enabled and the profile has an address. Other profiles' routes are unchanged. Repo ruff is at 67 because of Group 3 files still in progress; recheck when Group 3 reports.

## 2026-11-27T11:45:52Z - Group 16 Complete (wave 2)

**Steps**: 16.1–16.5
**Standards Applied**:
- From plan: frontend/components, frontend/accessibility, frontend/data-fetching, testing/frontend-testing
- From INDEX.md: global/minimal-implementation
- Discovered: none
**Tests**: 19 passed (VerifyEmailBanner + AccountPointsView); typecheck 0; eslint clean. An accidental full-suite run with siblings mid-edit showed 54 failures; recheck against the baseline after wave 2.
**Files Modified**: features/email/VerifyEmailBanner.tsx (new), panel/HomeView.tsx, account/AccountView.tsx, test/VerifyEmailBanner.test.tsx (new), test/AccountPointsView.test.tsx
**Notes**: ✉️ emoji icon (appIcons has no mail icon). The banner is placed under the h1 greeting. Group 17: SSR fixture email_verified=false is safe.

## 2026-11-27T11:45:52Z - Group 13 Complete (wave 2)

**Steps**: 13.1–13.6
**Standards Applied**:
- From plan: frontend/components, frontend/accessibility, frontend/data-fetching, frontend/css, testing/frontend-testing
- From INDEX.md: global/minimal-implementation, global/commenting
- Discovered: repo code is formatted at 120 columns (no prettier config)
**Tests**: 20 passed (13-row it.each table + 7 view tests); eslint clean. tsc shows 3 TS2307 errors in group 14/15 test files whose modules are still pending.
**Files Modified**: app/(public)/(panel)/settings/page.tsx, features/email/{emailSettingsViewState.ts, EmailCategoryToggle.tsx, EmailSettingsView.tsx}, test/emailSettingsViewState.test.ts, test/EmailSettingsView.test.tsx
**Notes**: Address precedence: complaint > unknown > sent > bounce > unverified > verified. Bounce and complaint both show the „Wstrzymane” badge. Suggested standard: add a .prettierrc with printWidth 120.

## 2026-11-27T11:46:29Z - Group 15 Complete (wave 2)

**Steps**: 15.1–15.7
**Standards Applied**:
- From plan: frontend/components, frontend/accessibility, frontend/data-fetching, testing/frontend-testing
- From INDEX.md: global/validation, global/minimal-implementation
- Discovered: LoginForm alert style reused
**Tests**: 40 passed (2 view-state tables + 8 page tests); typecheck 0; eslint clean
**Files Modified**: app/(public)/verify-email/page.tsx, app/(public)/unsubscribe/page.tsx (server routes, metadata referrer no-referrer, robots noindex), features/email/{VerifyEmailPage, verifyEmailViewState, UnsubscribePage, unsubscribeViewState, unsubscribeToken}.ts(x), 4 test files
**Notes**: Visual deviations come from AuthLayout: the emoji sits under the title and the address or label is not bold, because subtitle is typed string. Copy for loading, error and resend is proposed. EMAIL_CATEGORY_LABELS may duplicate the /settings labels; group 19 or the review can unify them.

## 2026-11-27T11:46:43Z - Group 14 Complete (wave 2)

**Steps**: 14.1–14.7
**Standards Applied**:
- From plan: frontend/components, frontend/accessibility, global/validation, frontend/data-fetching, testing/frontend-testing
- From INDEX.md: backend/security (Referrer-Policy), global/minimal-implementation
- Discovered: components.md rule on full reload after a session change
**Tests**: 37 passed (17-row table + 5 page + 15 auth tests); 241 related passed; typecheck 0; eslint clean
**Files Modified**: app/(public)/reset-password/page.tsx, features/auth/{ResetPasswordPage.tsx, resetPasswordViewState.ts, LoginForm.tsx, AuthTabs.tsx, AuthSheet.tsx}, tests resetPasswordViewState/ResetPasswordPage/auth
**Notes**: Only the request form sits behind AuthGuard requireAuth=false (M-9). After success, clearSession() leaves the in-memory AuthContext token until the reload to /login. AuthLayout subtitle is a string, so the email cannot be bolded; follow-up: widen it to ReactNode.

## 2026-11-27T11:47:24Z - Group 3 Complete (wave 2)

**Steps**: 3.1–3.8
**Standards Applied**:
- From plan: backend/security, global/error-handling, global/minimal-implementation, backend/time, testing/backend-testing
- From INDEX.md: global/commenting, global/coding-style
- Discovered: the auth/google.py httpx and no-logging pattern
**Tests**: 30 passed (8 functions); mypy 15, ruff 64 (baseline)
**Files Modified**: app/email/{rules,links,rendering,senders}.py, 10 templates, tests/conftest.py (FakeEmailSender + fake_email_sender), tests/test_email_rendering.py, tests/test_email_senders.py
**Notes**: Contracts:
- `render(template, context)` context keys: notification {kind, message, link_path, unsubscribe_token}; verify_email {token}; password_reset {token, google_only}; password_changed {changed_at}; optional `display_name` on all.
- Treat any exception from `render` as `render_error`.
- `build_headers(unsubscribe_token=...)` only for NOTIFICATION mail.
- Key builders live in rules.
- Failure codes: http_<status>, timeout, transport, smtp_refused.
- Lifespan: `set_sender(build_sender(settings))`.

## 2026-11-27T11:47:24Z - Wave 2 resolved (groups 3, 4, 13, 14, 15, 16) — dispatching wave 3: 5, 6, 7, 17

## 2026-11-27T11:54:38Z - Group 5 Complete (wave 3)

**Steps**: 5.1–5.6
**Standards Applied**:
- From plan: backend/queries, backend/models, global/error-handling, testing/backend-testing
- From INDEX.md: backend/time, backend/models (cross-context ACL)
- Discovered: global/commenting
**Tests**: 8 new passed; 81 regression passed (notifications, wants_notifications pins unchanged, term_end_scan, points_purchase_flow, wants_bells_due, module_boundaries); mypy 15, ruff 64
**Files Modified**: app/email/service.py (new), notifications/infrastructure/{__init__,email_acl}.py (new), notifications/service.py (topic_id, explicit id, hook calls), wants/application/match_notifications.py (_entry topic_id), tests/test_email_enqueue.py
**Notes**:
- Public API: `NotificationEmail` dataclass, `stage_notification_email`, `enqueue_notification_emails`, `enqueue_transactional(db, *, template, party_id, idempotency_key, expires_at, payload)` (no-op while email is disabled), `clear_bounce_suppression(db, address)`.
- `email_acl` imports `NotificationEntry` only under TYPE_CHECKING.
- Group 10: allow notifications/infrastructure/email_acl.py as an importer of app.email.

## 2026-11-27T11:54:53Z - Group 7 Complete (wave 3)

**Steps**: 7.1–7.5
**Standards Applied**:
- From plan: backend/security, global/error-handling, backend/queries, backend/api, testing/backend-testing
- From INDEX.md: backend/models (explicit updated_at in Core), backend/time
- Discovered: defensive webhook parsing (backend/security, global/validation)
**Tests**: 12 passed (8 functions); own files mypy and ruff clean. Repo totals went above baseline (mypy 22, ruff 66) while Group 6 was still in progress; Group 6 later reported 15 and 64.
**Files Modified**: app/email/webhooks.py (new), app/email/router.py (new, prefix /api/email), app/main.py (include email_router before system_router), tests/test_email_webhook.py
**Notes**:
- `webhooks._utcnow()` calls `datetime.now(UTC)`. The clock guard forbids that once app/email joins `_GUARDED_DIRS`. Group 10 must switch it to `datetime.utcnow()` or clock.
- Replay memory is module-level; tests use fresh tokens.
- Suggested standard: provider webhooks record the replay token only after commit and answer 503 on failure.

## 2026-11-27T11:54:53Z - Group 6 Complete (wave 3)

**Steps**: 6.1–6.7
**Standards Applied**:
- From plan: backend/queries, backend/time, global/error-handling, backend/security, testing/backend-testing
- From INDEX.md: backend/models (ACL shape), global/minimal-implementation
- Discovered: asyncpg types an all-NULL VALUES column as text, so an explicit CAST is needed
**Tests**: 19 passed (8 functions); mypy 15, ruff 64
**Files Modified**: app/email/sending.py (new), app/email/infrastructure/users_acl.py (new), tests/test_email_sending.py
**Notes**:
- `run_send_batch(db) -> SendRunResult`. It commits itself, does not catch DB errors, and raises RuntimeError when no sender is set.
- Group 10's `_run_email_send` must handle TRANSACTION_CONFLICTS with a WARNING and call `logger.exception` otherwise.
- `get_recipients_by_party_ids(db, ids) -> dict[UUID, Recipient]`.

## 2026-11-27T11:57:19Z - Group 17 Complete (wave 3)

**Steps**: 17.1–17.4
**Standards Applied**:
- From plan: testing/frontend-testing, frontend/components
- From INDEX.md: frontend/data-fetching
- Discovered: the proxy login gate checked with resolveProxy
**Tests**: 62/62 in the target files; reservedSlugs parity green; typecheck 0. Full suite: 51 failed / 2282 passed.
- vs baseline 32: −3 fixed (2 stale `/search` routeManifest entries, 1 parity).
- +20 in MyItemsViewCategory.test.tsx ("No QueryClient set" at MyItemsView.tsx:126). Neither file has working-tree changes; to be checked in verification as baseline drift from HEAD 3bb3591.
- +2 caused by this feature: AppPage "Konto without an organization" expects the old menu without „Powiadomienia e-mail”; TermPage anonymous sheet asserts no link, but LoginForm now has „Nie pamiętasz hasła?”. Fix dispatched with wave 4.
**Files Modified**: test/routeManifest.test.ts, test/panelPages.ts, test/ssrSafety.test.tsx
**Notes**: Suggested standard: when a route moves between route groups, update the routeManifest PANEL/INVENTORY lists in the same change.

## 2026-11-27T11:57:19Z - Wave 3 resolved (groups 5, 6, 7, 17) — dispatching wave 4: 8, 9 + follow-up fix for the 2 feature-caused frontend test failures

## 2026-11-27T12:00:28Z - Follow-up 17b Complete (wave 4, not a plan group)

**Change**:
- AppPage.test.tsx: the expected Konto rows now include „Powiadomienia e-mail” → /settings.
- TermPage.test.tsx: the anonymous sheet allows only the /reset-password link; guest-path assertions kept.
**Standards Applied**: testing/frontend-testing
**Tests**: in those two files, failures went from 15 before to 13 after. All 13 remaining are baseline (12 AppPage „Prowadzę”, 1 TermPage „Miejsce”). Typecheck 0.

## 2026-11-27T12:03:34Z - Group 8 Complete (wave 4)

**Steps**: 8.1–8.6
**Standards Applied**:
- From plan: backend/api, backend/security, global/validation, global/error-handling, backend/queries, testing/backend-testing
- From INDEX.md: backend/models (Core upserts), global/minimal-implementation
- Discovered: backend/time (naive UTC)
**Tests**: 9 new + 39 regression passed. mypy 15. My files are ruff-clean; repo ruff is at 67 because of in-progress group 9 tests.
**Files Modified**: tests/test_email_preferences.py, email/infrastructure/users_acl.py (find_own_address), email/service.py (read_preferences, set_preference, find_suppression), email/schemas.py (new), email/router.py (3 routes)
**Notes**:
- Matrix rows for group 10: 78 POST unsubscribe PUBLIC; 80 GET preferences READ; 81 PUT preferences EDIT.
- An unsubscribe body that is not JSON counts as scope=category (RFC 8058 one-click).
- Proposed copy: „Nieprawidłowe żądanie.” and „Nie znaleziono profilu.”
- The ACL is named `find_own_address(db, username)`, not `find_party_id_by_principal`.

## 2026-11-27T12:08:30Z - Group 9 Complete (wave 4)

**Steps**: 9.1–9.7
**Standards Applied**:
- From plan: backend/security, backend/api, global/error-handling, backend/queries, testing/backend-testing
- From INDEX.md: backend/models, global/minimal-implementation
- Discovered: backend/time (app/auth uses naive UTC audit times)
**Tests**: 25 new (10 functions incl. concurrent confirm); 234 total with regression passed; mypy 15, ruff 64
**Files Modified**: auth/account_tokens.py (new), auth/infrastructure/{__init__,email_acl}.py (new), auth/router.py (5 routes, no-store), users/service.py (issue_verification inside the _bootstrap_registration savepoint), tests/test_account_tokens.py
**Notes**:
- Matrix rows: 74 password-reset PUBLIC, 75 /confirm PUBLIC, 76 email-verification/confirm PUBLIC, 82 account-tokens/lookup PUBLIC, 77 email-verification EDIT. Order 73,74,75,76,82,77.
- Regression to fix in group 10: tests/test_email_enqueue.py loses 8 tests because registration now queues a TRANSACTIONAL verify_email row. Filter `_mails()` to the NOTIFICATION stream.
- Suggested standard: Core UPDATEs keep ORM synchronize_session on.

## 2026-11-27T12:08:30Z - Wave 4 resolved (groups 8, 9 + 17b) — dispatching wave 5: group 10 (+ test_email_enqueue `_mails` filter, + webhooks `datetime.now` clock-guard fix)

## 2026-11-27T12:36:42Z - Group 10 Complete (wave 5)

**Steps**: 10.1–10.6, plus two extra fixes:
- webhooks `_utcnow` now uses `datetime.utcnow()` (clock guard);
- test_email_enqueue `_mails()` filtered to the NOTIFICATION stream.
**Standards Applied**:
- From plan: backend/security, global/error-handling, backend/time, testing/backend-testing
- From INDEX.md: global/commenting, global/minimal-implementation
- Discovered: the _reconcile_side and _check_similar_schema patterns
**Tests**: 270 feature and guard tests passed. Full backend suite: 2047 passed / 2 failed. Both failures are the known stale baseline tests:
- test_owner_items_page nearest_privateCircleTerm…
- test_terms_circle_occurs_on_index_migration 0053 round trip

mypy 15, ruff 64 (baseline).
**Files Modified**: app/main.py (_check_email_settings, _run_email_send every 60 s when enabled, set_sender), core/authorization_matrix.py (rows 74–82), app/email/webhooks.py, tests/test_authorization_matrix.py, test_module_boundaries.py, test_domain_clock_guard.py, test_email_config.py, test_email_enqueue.py
**Notes**:
- Frontend: the 20 MyItemsViewCategory failures are pre-existing and come from commit 3bb3591. It added `useQueryClient` at MyItemsView.tsx:126, and the test renders without a QueryClient. Not caused by this feature.
- Suggested standard: jobs in main.py copy the `_reconcile_side` error-handling shape.

## 2026-11-27T12:36:42Z - Wave 5 resolved — dispatching wave 6: group 18 (docs)

## 2026-11-27T12:43:47Z - Group 18 Complete (wave 6)

**Steps**: 18.1–18.6
**Standards Applied**:
- From plan: global/conventions, global/commenting, backend/migrations (runbook in architecture.md)
- From INDEX.md: backend/security, project/tech-stack, project/architecture
- Discovered: the CLAUDE.md secrets rule
**Checks**: doccheck.sh failed before the edits and passed after. The secret-literal grep found nothing. The unrelated "Visibility predicates" line is unchanged.
**Files Modified**:
- architecture.md: E-mail section; 0110–0112 runbook; Known limits; integrations; schema; config; packages; Mailpit
- tech-stack.md
- standards/backend/security.md: 3 subsections
- INDEX.md: 3 summaries
- CHANGELOG.md: 2 Polish bullets
**Notes**: The runbook warns that a downgrade loses every unsubscribe and recommends restoring the dump instead. Follow-up: an ADR replacing the handover ADR-009 is not written yet.

## 2026-11-27T12:43:47Z - Wave 6 resolved — dispatching wave 7: group 19 (test review)

## 2026-11-27T13:00:02Z - Group 19 Complete (wave 7)

**Steps**: 19.1–19.4
**Standards Applied**: testing/backend-testing, backend/security
**Tests**: 3 end-to-end flow tests added in tests/test_email_flows.py:
- register → verify mail in quiet hours → link confirms → /me verified
- Google-only reset through the job → new password → password_changed mail
- GIFT take bell → List-Unsubscribe one-click → DELIVERED webhook → next bell skipped as category_disabled

Feature totals: backend 380 passed, frontend 182 passed. No real bugs found.
**Files Modified**: tests/test_email_flows.py (new)

## 2026-11-27T13:00:02Z - Implementation Complete

**Total Steps**: 117 completed (19 groups, 7 waves) plus follow-up 17b
**Total Standards**: about 20 distinct standards applied across groups (see per-group entries)
**Test Suite**:
- **Backend**: full suite after the last production-code change (group 10) gave 2047 passed / 2 failed. The 2 failures are the known stale baseline tests. Group 19 then added 3 passing tests.
- **Frontend**: full suite now gives 49 failed / 2286 passed.
  - Baseline was 32. routeManifest (2) and reservedSlugs (1) are now fixed.
  - The +20 are all in MyItemsViewCategory.test.tsx. They come from HEAD commit 3bb3591, which added useQueryClient to MyItemsView with no test wrapper. No feature file is involved.
  - The remaining failing files match the baseline list exactly.
- **Typecheck**: 0. **mypy**: 15. **ruff**: 64 (all at baseline).

## 2026-11-27T14:09:08Z - Verification fix cycle 1 (W1–W9 + fixable info)

**F-A backend**:
- W1: new uvicorn.access redaction filter `app/core/access_log.py`. It also covers `_token=`.
- W2: passwords are limited to 72 bytes (Polish 400) on registration and reset. The token is claimed first, then bcrypt runs via to_thread.
- W3: Mailgun 401/403/404 are retryable, logging one ERROR per run.
- W4: GET unsubscribe answers 303 to the page; matrix row 78 is now GET+POST.
- W6: graceful finish of an in-flight send on shutdown, up to 15 s.
- W7: one shared `rules.normalize_address`; auth uses `normalize_email`.
- Info: cap log wording, link_path guard, canonical UUID in the unsubscribe token, reset lifts BOUNCE, strict localhost base URL, webhook body limited to 64 KiB.
- tests/test_email_senders.py was accidentally truncated and rebuilt from the transcript; verified by re-running it.
- 366 feature tests passed; mypy 15, ruff 64.

**F-B nginx/docs**:
- W1: `token_safe` log format with the unsubscribe path redacted.
- W5: `auth_flows` limit_req at 10r/m with burst 5; the webhook is excluded.
- W9: JWT-not-revoked risk documented.
- Runbook: new greps, verified-share query, GET 303 note.
- security.md and INDEX.md updated.
- nginx -t passes and a functional container check was run.
- Residual: the nginx error log still prints the request line when an upstream call fails. Documented as accepted.

**F-C frontend**:
- W8: one label map; categories follow server order.
- client.ts handles empty 202/204/205 replies; `withoutBody` removed.
- AuthLayout subtitle accepts a ReactNode, so the address/category is bold where the mockups show it.
- 152 tests passed; typecheck 0.

**Open**: the docs do not yet mention the 72-byte limit, the 64 KiB webhook body limit, canonical UUID tokens, reset lifting BOUNCE, or `_token=` redaction. Login and families password fields are still unbounded; this predates the feature.

## 2026-11-28T11:02:53Z — Phase 12 E2E follow-up: D1 fixed
- E2E (verification/e2e-verification-report.md): 14/14 scenarios pass; D1 minor, D2/D3 cosmetic.
- D1 fixed (user choice): `SmtpSender` builds `EmailMessage(policy=email.policy.SMTP.clone(max_line_length=998))` so a long `List-Unsubscribe` stays one plain line instead of RFC 2047 encoded-words (`app/email/senders.py`). New test `test_smtp_send_keepsLongListUnsubscribeOnOneUnencodedLine` (red before, green after); test_email_senders + test_email_sending 37 passed, ruff/mypy clean. Running local image not rebuilt.
- D2 (icons below the description on /verify-email and /unsubscribe done screens) and D3 (English login error, pre-existing) left as known.
