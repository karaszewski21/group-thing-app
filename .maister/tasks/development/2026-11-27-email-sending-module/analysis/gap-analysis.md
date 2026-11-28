# Gap Analysis: app/email sending module (rollout stages 1+2)

## TL;DR
- Nothing for email exists today. The gap is a new bounded context (`app/email`, 4 tables + 1 column + backfill, a job, 3 sender adapters, a webhook) plus account-token flows in `auth`/`users` and 4 frontend routes. Every piece has a direct precedent in the repo.
- The research ADRs and Phase 1 answers settle almost all of the design. What is left is a small set of call-site and policy details. Six need the user's decision; the rest are listed below as defaults.
- The biggest real gaps found by the code check: `users.service.register` commits inside the service, so the verification mail cannot simply be enqueued "after" the commit and stay atomic. Shipping stages 1 and 2 together removes the T-only warm-up week unless a switch exists. Outbox handler failures commit partial bells (pre-existing), which can duplicate `TERM_CONFIRMATION_NEEDED` mails. Rows queued while `EMAIL_ENABLED=false` (after it was true) would send in a stale burst.
- Risk: medium-high (the hook sits on every notifying write path; there are public token and webhook endpoints). Effort: high.

## Key Decisions
- Characteristics: creates_new_entities, modifies_existing_code, involves_data_operations and ui_heavy are true. has_reproducible_defect is false: this is a feature with no defect report.
- Change type is additive. Existing bell behaviour stays as it is. The one change in existing semantics is `create_notification` assigning `id=uuid4()` explicitly. Compatibility: strict for the bell path and existing auth (login, register, Google), flexible for the new surfaces.
- Migrations are renumbered from the HLD: `0110_email_tables`, `0111_email_verified_at`, `0112_backfill_google_verified` (0109 is points offers).
- HLD values taken as given (not re-asked): token lifetimes ~1 h reset / ~48 h verify; the DB request limit ≤1/60 s and ≤5/h per account and purpose; HTTP rate limiting out of scope (D12); enqueue is a no-op and the request endpoints return 503 when `EMAIL_ENABLED=false`; the verification mail is sent at `POST /api/auth/register` (ADR-006); `email_messages` purge is out of scope (stretch); webhook replay protection in process memory (single instance).

## Open Questions / Risks
- The privacy policy (D14) and the Mailgun DPA are prerequisites of stage 2 / stage 1 respectively. They are operator or legal work, not code, but they gate turning on what this task builds.
- Mailgun keeps its own bounce and complaint lists. Clearing a local BOUNCE on re-verification does not unblock an address that Mailgun itself suppresses, so the verification mail to that address may be dropped on Mailgun's side. Operator runbook note; an API-based removal is out of scope.
- `outbox/dispatcher.py` 68-87 commits the session even when a handler raises, so bells staged before the failure persist and a retry stages them again with new ids (pre-existing). With the hook, each duplicate bell also gets a mail unless the key is deterministic (decision I-3).
- The hook's statement is issued inside callers' transactions. A Core `INSERT` autoflushes pending ORM objects earlier than today, which moves where a caller's IntegrityError surfaces (decision I-2).
- `families/guardians.py` only reads `profile.email`. Today the only writer of `user_profiles.email` is `create_account_and_profile`, so the "clear `email_verified_at` on email change" invariant has no current write path to guard. Any future email-change path must keep it.
- Baseline noise (32 vitest, 2 stale backend, mypy 15, ruff 64) must be compared against during verification.

---

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: High (~25–35 new backend files, ~15 frontend files, 3 migrations, ~10 touched hub files)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`notifications/service.py`, `users/{models,router,schemas,service}.py`, `auth/{router,service}.py`, `main.py`, `config.py`, `core/authorization_matrix.py`, `core/clock.py`, `organizations/slugs.py`, `wants/application/match_notifications.py` for `topic_id`; frontend `LoginForm`, `AccountView`, `HomeView`, `paths.ts`, `proxy.ts`, `reservedSlugs.ts`, `api/people.ts`)
- Creates new entities: yes (`email_messages`, `email_preferences`, `email_suppressions`, `account_tokens`, `user_profiles.email_verified_at`)
- Involves data operations: yes
- UI heavy: yes (1 panel page, 3 public pages, banner, 2 entry links)

## Gaps Identified

### Missing Features (verified absent)
- **Email module**: no `app/email`, no sender, no templates, no `jinja2` in `pyproject.toml`. `architecture.md` says "In-app notifications only".
- **Account tokens / reset / verification**: `auth/router.py` has only `/login`, `/google/nonce`, `/google`. There is no password-change or reset endpoint anywhere, and no `email_verified_at`.
- **Preferences / unsubscribe / webhook**: none.
- **Frontend**: no `/settings` route under `app/(public)/(panel)/` (the folder lists account, add, events, family, groups, home, items, meetings, messages, organization, places, points, profile, terms, wanted), although `settings` is reserved in `reservedSlugs.ts:11` and `organizations/slugs.py:37`. No `/verify-email`, `/reset-password` or `/unsubscribe`.
- **Compose**: no `profiles:` usage and no mailpit service.

### Incomplete Features
- **`create_notification`** (`notifications/service.py` 48-74) sets no id, so a hook cannot key `notification:<id>` until an explicit `uuid4()` is assigned.
- **`NotificationEntry`** (38-45) has no `topic_id`. It needs an optional in-memory `topic_id: uuid.UUID | None = None` as the last field (frozen dataclass, existing callers unaffected), set by `wants/application/match_notifications.py::_entry` for `WANT_MATCH_FOUND`.
- **Google sign-in** stores `UserIdentity.email_verified` but nothing marks the profile verified.

### Behavioral Changes Needed
- Every MVP-kind bell also queues an `email_messages` row in the same transaction.
- Registration additionally issues a VERIFY_EMAIL token and queues a mail.
- `/api/people/me` gains `email_verified` (own profile only; the shared `UserProfileResponse` stays unchanged for `/api/people/{id}`).
- `test_wants_notifications.py:92` statement pin changes from `["INSERT"]` to the new exact sequence; l.115 (zero statements for empty input) must still hold.

## Codebase Facts Verified in This Phase
| Fact | Evidence | Consequence |
|---|---|---|
| `register` commits inside the service | `users/service.py` 328-353, `await db.commit()` at 351 | Enqueueing in the router after `service.register` is a second transaction (decision C-1) |
| `users.router` already imports `app.auth.service` | `users/router.py:11` | A router-side call into auth adds no new cycle |
| `users.service` imports only `app.auth.models` from auth | `users/service.py:16` | A new auth-side module that imports only `auth.models`, `app.core` and the email ACL can be called from `users.service` without a cycle |
| `auth.service` imports `users.service` | `auth/service.py:20` | `users.service` must not import `auth.service` |
| Outbox handler failure still commits staged writes | `outbox/dispatcher.py` 68-87 (`except` → attempts += 1 → `db.commit()`) | Partial bells plus their email rows persist, and the retry duplicates them (decision I-3) |
| `TERM_CONFIRMATION_NEEDED` is created in outbox handlers, one per party in a loop | `notifications/outbox_listener.py` 102-110, 133-145 | The only MVP kind exposed to the retry duplicate |
| Other MVP kinds are synchronous in request transactions | `term_item_listings.py` 853/1015/1163/1188/1235, `event_reservations.py:130` | Atomic with the domain write |
| `app/auth` and `app/notifications` have no `infrastructure/` directory | `ls app/auth` | Both ACLs are new directories |

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability: settings | none | `/account` → "Ustawienia" → "Powiadomienia e-mail" → `/settings`; footer and one-click links in every notification mail | ✅ |
| Reachability: reset | none (Google-only accounts have no recovery at all) | `LoginForm` "Nie pamiętasz hasła?" (also inside `AuthSheet`) → `/reset-password` | ✅ |
| Reachability: verification | none | Home banner + `/settings` button; link in the registration mail → `/verify-email` | ✅ |
| Discoverability | n/a | banner 9/10, login link 8/10, settings row 6/10 (secondary menu, a standard place) | acceptable |
| Flow integration | — | Token pages are public and work without a session; reset ends with a full reload to `/login` (`documentNavigation`); verify invalidates `MY_PROFILE_KEY` | ✅ |
| Multi-persona | — | Password accounts, Google-only accounts (reset = set first password), organizations (SKIPPED `organization`, no UI), children (`email=None`, SKIPPED `no_address`) | ⚠️ organizations get no mail (accepted, ADR-007) |

## Data Lifecycle Analysis

### Entity: email_preferences
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | upsert in `PUT /api/email/preferences` and `POST /api/email/unsubscribe/{token}` (to build) | toggles in `/settings`, buttons in `/unsubscribe` | AccountView row, mail footer | ✅ planned |
| READ | `GET /api/email/preferences` (to build); missing row = default from `rules` | `/settings` | AccountView row | ✅ planned |
| UPDATE | same PUT | `role="switch"` toggles (`WantNotificationToggle` pattern) | same | ✅ planned |
| DELETE | n/a (a row's absence = default) | — | — | n/a |

### Entity: account_tokens
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | register, `POST /api/auth/email-verification`, `POST /api/auth/password-reset` | banner/settings button, `/reset-password` form | home, account, login | ✅ planned |
| READ/USE | `.../confirm` endpoints | `/verify-email`, `/reset-password?token=` | link in mail | ✅ planned |
| UPDATE | `used_at` on use and on reissue | — | — | ✅ |
| DELETE | ON DELETE CASCADE with `users`; no purge (out of scope) | — | — | accepted |

### Entity: email_messages
CREATE by the hook and ACLs; UPDATE by the job and the webhook. READ has no user UI by design (the admin log is out of scope; operators use SQL and the `email send:` log line). Not an orphan: the user-facing result is the mail itself.

### Entity: email_suppressions
CREATE by the webhook. READ is surfaced as the `/settings` info line, so `GET /api/email/preferences` must return a `suppressed` flag (or reason). DELETE: BOUNCE is cleared on verification confirm. **COMPLAINT has no removal path.** A user who reported spam and later turns toggles back on sees them "on" but never gets mail (decision I-5).

**Completeness**: 100% for preferences and tokens. Suppressions miss one removal path (COMPLAINT), which is intentional pending decision I-5.
**Orphaned Operations**: none outright. COMPLAINT suppression without a user-visible lift is a partial orphan.
**Missing Touchpoints**: none beyond the HLD. The admin email log and organization recipients are explicitly out of scope.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **C-1 Registration call site for the verification mail.** `register` commits inside `users.service`.
   - Options: **[A] Call a new auth-side `account_tokens.issue_verification(db, user_id, email)` from inside `users.service.register` before its commit** (it imports only `auth.models`, `app.core` and `auth/infrastructure/email_acl`, so there is no cycle; the account and the mail are atomic). [B] Call it from `users.router.register` after `service.register` returns, in a second commit (if that fails, the account exists without a mail and the user resends from the banner). [C] Move the commit out of `service.register` into the router (touches the IntegrityError retry loop).
   - Recommendation: A. It is atomic, adds no cycle, and leaves the retry loop alone.
2. **C-2 How stage 1 (account mails only, ≥1 week warm-up) is kept apart when stages 1+2 ship in one task.** The HLD enables kinds through the `rules` map with no runtime flag.
   - Options: **[A] Add a second flag `EMAIL_NOTIFICATIONS_ENABLED` (default false). With it off, the hook enqueues nothing, and `/settings` and the unsubscribe page still work.** [B] Ship the `rules` map with the MVP kinds commented out or empty, and enable them in a follow-up deploy commit. [C] Ship everything enabled and rely on `EMAIL_DAILY_CAP` for the warm-up.
   - Recommendation: A. One env flip moves from stage 1 to stage 2, with no code deploy and no risk of a skipped warm-up. B matches the HLD wording but needs a second release; C breaks the warm-up and the D14 gate.

### Important (Should Decide)
1. **I-1 Queued rows when `EMAIL_ENABLED` goes true → false → true.** The job is not scheduled while off, so PENDING rows wait and later send stale notifications in a burst.
   - Options: **[A] The job skips NOTIFICATION rows older than 24 h as SKIPPED `expired` and fails TRANSACTIONAL rows past their token's expiry (`expired`).** [B] Leave them; they send on re-enable. [C] Cancel all PENDING at startup when the flag is off.
   - Default: A (adds one `skip_reason` value to the CHECK, defined now in 0110 anyway).
2. **I-2 Statement shape of the hook in `create_notification` (single row).**
   - Options: **[A] `db.add(EmailMessage(...))` for the single-row path (key `notification:<id>` cannot conflict, zero statements until the caller's flush, no early autoflush), and one Core `INSERT … ON CONFLICT DO NOTHING` for `create_notifications`.** [B] Core INSERT in both paths, as the HLD says ("exactly one statement"), accepting an earlier autoflush inside callers.
   - Default: A. It keeps the caller's flush timing identical to today. The MATCH daily key, the only key that can conflict, only comes through `create_notifications`.
3. **I-3 Duplicate `TERM_CONFIRMATION_NEEDED` mails from outbox handler retries.**
   - Options: **[A] A deterministic key for this kind: `term_confirmation:<reservation_id or proposal_id>:<party_id>`, so a retried bell gets no second mail.** [B] Accept duplicates (rare: only when a later handler step raises). [C] Wrap the outbox handlers in a savepoint (fixes the bells too, but changes the shared dispatcher).
   - Default: A, with C noted as a follow-up for the pre-existing duplicate-bell bug.
4. **I-4 Hiding the email UI while email is off.** With `EMAIL_ENABLED=false`, the banner asks the user to verify and the reset link answers 503.
   - Options: **[A] `/api/people/me` returns `email_verified: bool | null`, with null when email is disabled or there is no address. The banner shows only on `false`. The reset link stays and shows the Polish 503 copy.** [B] Always show and rely on 503 messages. [C] A public `GET /api/public/email/status` flag.
   - Default: A (no extra request, no misleading banner).
5. **I-5 COMPLAINT suppression and the user's own re-enable.**
   - Options: **[A] Permanent in MVP. `/settings` shows the info line and disables the category toggles while the address is suppressed (lifting it is a support action, since Mailgun's own complaint list blocks sends anyway).** [B] An explicit re-enable in `/settings` clears the local COMPLAINT row.
   - Default: A (B would not work without also removing the address from Mailgun's list).
6. **I-6 Should a successful password-reset confirm also set `email_verified_at`?** Using the link proves the user owns the mailbox, provided the token's address snapshot equals the profile email.
   - Options: **[A] Yes, when the snapshot matches.** [B] No; verification stays a separate flow.
   - Default: A (fewer unverified Google-less users, no extra mail).

## Assumptions (sensible defaults, no question needed)
- `NotificationEntry.topic_id: uuid.UUID | None = None` (in memory only). Key `want_match:<want_id>:<YYYY-MM-DD>`. The day is the Warsaw date of the **effective send window**: an enqueue between 22:00 and 24:00 counts as the next day, so a 23:00 and a 06:00 match do not become two mails at 07:00.
- Keys: `notification:<id>`, `want_match:…`, `term_confirmation:…` (if I-3 A), `auth:<token_id>`, `auth:<token_id>:changed`.
- Job: interval 60 s, batch 50, `max_instances=1`, `coalesce`. Backoff 1, 5, 15, 60, 240 min, then FAILED (`MAX_ATTEMPTS` = 6). Stuck SENDING after 10 min. Every constant lives in `email/rules.py`.
- `EMAIL_DAILY_CAP` default 100, counted as SENT since Warsaw midnight (a new `clock` helper converting a Warsaw time to naive UTC). TRANSACTIONAL bypasses it.
- Quiet hours 22:00–07:00 Warsaw for NOTIFICATION only.
- `SmtpSender` uses stdlib `smtplib` via `asyncio.to_thread` (no `aiosmtplib`; minimal dependencies). `jinja2` is the only new dependency; ship `uv.lock`.
- `EMAIL_LINK_SIGNING_SECRET` signs unsubscribe tokens (Phase 1). Account tokens are random and SHA-256-hashed, not signed. `EMAIL_WEBHOOK_SIGNING_KEY` is separate.
- Token endpoints return 400/404/410, never 401. Forgot-password always returns 202. The webhook returns 401 on a bad signature (Mailgun is the caller, so the frontend client is unaffected).
- Frontend writes follow the codebase convention (query hooks + `useCallback` writes + `await invalidateQueries`). `useMutation` is used nowhere, despite the HLD §7 note.
- Matrix rows 74–80 as in HLD §6.1, appended after row 73. Row 77 and row 80 are login-only (no `mcp:*`), like the points `require_login_principal`.
- Reserved slugs `verify-email`, `reset-password` and `unsubscribe` are added to both lists in one change. Adding `/settings` should also fix the parity test.
- Mailpit: pinned image, `profiles: ["dev"]`, SMTP 1025 and UI 8025 bound to localhost.
- No `email_messages`/`account_tokens` purge in this task. The raw token in `payload` is nulled on every terminal state.

## Recommendations
- Build order: migrations + module skeleton + boundary/clock guards → enqueue hook (+ `topic_id`) → job + adapters + templates → webhook/suppressions → account tokens + verify/reset + Google backfill → preferences/unsubscribe → frontend → docs, runbook (0110–0112) and CHANGELOG.
- The hook must never raise on recipient matters: it does no reads, only the kind filter and the insert. Test the same-transaction rollback.
- Add `caplog` tests proving no address, token or provider key appears in logs or `last_error`.

## Risk Assessment
- **Complexity Risk**: High. Many slices, but each follows a precedent.
- **Integration Risk**: Medium-High. A shared hot write path, plus an external provider and an inbound webhook.
- **Regression Risk**: Medium. Statement pins, the slug parity test, `ssrSafety` fixtures and the `/me` response shape all change; the bell semantics do not.
