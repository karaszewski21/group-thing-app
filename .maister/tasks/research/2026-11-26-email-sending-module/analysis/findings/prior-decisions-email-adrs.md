# Prior decisions on email (handover research ADR-009, Google-login research, architecture.md)

## TL;DR
- Email was designed once already: ADR-009 (2026-10-13 handover research) chose **an extra outbox handler behind a provider-agnostic `EmailSender` port with an `httpx` adapter + log adapter**, `email_deliveries` dedupe, verified + opted-in addresses only, signed unsubscribe + `List-Unsubscribe`, and seven named settings. Status "Accepted, gated to Phase 3". **None of Phase 1-3 was built**; only Phase 0 shipped (fake e-mail/SMS toggles removed).
- The Google-login research (2026-11-25, implemented) deferred **D8 email verification**, **D10 password reset and account deletion**, **D4 set first password** and **D1 link Google**; it explicitly blocks auto-linking because aj emails are unverified. Architecture.md lists "no recovery path" for Google-only accounts as an accepted risk.
- architecture.md says "In-app only"/"In-app notifications only: no e-mail and no push" for wants bells (L411, L480). No other email channel statement exists; there is no email code, setting or column anywhere in `src/`.

## Key Decisions
- Email = additional outbox handler on existing wire strings, no domain change — reuses `outbox/registry.py` multi-handler seam (ADR-009).
- Provider-agnostic HTTP API via `httpx`, not a vendor SDK and not SMTP — minimal dependencies, one swappable adapter (ADR-009 options 2/3 rejected).
- Never send synchronously inside request handlers (ADR-009 option 4 rejected).
- Opt-in default false, consent timestamp stored, verified address required (RODO) (ADR-009).
- Dedupe per `(outbox entry, recipient)` because outbox is at-least-once per handler set (ADR-009).
- No auto-linking by email until email verification (D8) exists (Google ADR-005).
- Email last in the phased plan because it has the largest prerequisite set (ADR-010).

## Open Questions / Risks
- ADR-009 was written for handover reminders only; transactional auth mail (verify, reset) is listed as Phase 3 verification flow but password reset was never in ADR-009 — it comes from Google D10.
- ADR-009 references `UstawieniaView.tsx` and `users/models.py:47-68`; both locations are stale (the view was removed in Phase 0 and later the panel moved to Next.js `features/account/AccountView.tsx`).
- The handover events ADR-009 would hook (`groups.handover_reminder_due`, `groups.term_rescheduled`, `groups.handover_cancelled`, `groups.handover_party_withdrew`) do **not exist** — Phases 1-2 were never implemented, so an email module cannot start from those triggers.
- Open question from the handover report never answered: both reminders by email or evening only; sending domain and provider (`high-level-design.md:481`).
- Moderation worker poller must not claim email events (outbox marks unknown types PROCESSED) — risk recorded in ADR-009 Bad consequences; re-verify.

---

## 1. ADR-009 (handover research, 2026-10-13)

**Source**: `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/decision-log.md:299-330`
**Confidence**: High (direct text)

- Title: "Email as an additional outbox handler behind a provider-agnostic port". Status: "Accepted (gated to Phase 3; the user approved leaving "in-app only")" (`:301-302`).
- Context (`:305`): addresses exist for all handover parties but are unverified, no preference/consent/unsubscribe; `httpx` already a dependency; outbox registry allows several handlers per event; delivery is at-least-once per handler set; "The user has no provider preference."
- Drivers (`:307-312`): domain code must not change; provider swappable via one adapter; RODO opt-in, consent evidence, unsubscribe; no duplicates under outbox retries; secrets only as key names.
- Options (`:314-319`): (1) chosen; (2) provider SDK; (3) SMTP library; (4) synchronous send in request handlers.
- Outcome (`:321`), quoted:
  > Emails go only to verified, opted-in addresses (`email_reminders_enabled` default false, `email_consent_at` stored). Each send is deduplicated by `(outbox entry, recipient)`. Unsubscribe uses a signed link plus `List-Unsubscribe`. Settings keys (names only): `EMAIL_ENABLED`, `EMAIL_PROVIDER_API_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_LINK_SIGNING_SECRET`, `APP_PUBLIC_BASE_URL`. Phase 0 removes the fake toggles; Phase 3 brings a real one back.
- Bad consequences (`:330-333`): largest prerequisite set (DNS SPF/DKIM, verification UX, consent text, privacy notice); reach limited to opted-in verified users; moderation worker's outbox poller must not claim these events.

### Related ADRs
- ADR-004 (reminder markers, `decision-log.md:125-157`): driver "Channel handlers (in-app now, email later) must not need cross-BC queries" (`:134`); payloads carry `recipient_party_id`, Term data and item lines, "each channel handler renders its own text" (`:143`); "The email handler (Phase 3) attaches to the same events without new queries" (`:150`). Design principle worth keeping: **outbox payloads self-contained, rendering per channel**.
- ADR-010 (phasing, `:336-360`): Phase 0 → 1 agenda → 2 reminders/commitment → 3 email; email last because of "the larger email prerequisite set" (`:355`).

### Phase 3 data model and API (designed, not built)
**Source**: `.../outputs/high-level-design.md:206-231, 338, 370-373, 448, 466, 481`
- `user_profiles` columns: `email_verified_at DateTime NULL`, `email_reminders_enabled bool NOT NULL DEFAULT false`, `email_consent_at DateTime NULL` (`:210`).
- `email_verification_tokens`: `BaseEntity` + `profile_id`, `token_hash` (never raw), `expires_at`, `used_at`; index on `token_hash` (`:211`).
- `email_deliveries`: `dedupe_key` UNIQUE `<outbox_entry_id>:<recipient_party_id>`, `recipient_party_id`, `event_type`, `status` SENT/FAILED/SKIPPED, `provider_message_id`, `last_error` — "no address, no body" (`:212`).
- Endpoints (`:228-231`): `POST /api/users/me/email-verification` (rate-limited per profile); `POST /api/email-verifications/{token}/confirm` (single-use, hashed); `PUT /api/users/me/notification-preferences` (opt-in requires verified email, stores consent timestamp); `POST /api/email-unsubscribes/{signed_token}` (no login, signed with `EMAIL_LINK_SIGNING_SECRET`, idempotent). Note: these URL shapes predate current conventions (`/api/people/me` is the current self resource, see architecture.md:143).
- UI (`:338`): Settings P0 remove fake toggles; P3 real "Przypomnienia e-mail" with verification state and consent text; actions "Wyślij link weryfikacyjny, włącz/wyłącz".
- Acceptance criterion (`:448`): "no email is sent to an unverified or non-opted-in address; each event produces at most one email per recipient even under outbox retries; unsubscribe works without login."
- Risk row (`:466`): deliverability/RODO → opt-in + verification, SPF/DKIM, consent timestamp, unsubscribe, `List-Unsubscribe`.
- Open (`:481`): "both reminders by email, or evening only? Sending domain and provider to be chosen at Phase 3."
- Research report recommendation (`research-report.md:293-296`): one provider over `httpx`, preconditions verification, per-user preference, unsubscribe, RODO consent, SPF/DKIM, idempotent handler; default cadence "the evening-before email only".
- Report also rejects SMS/Messenger/Telegram for now (`research-report.md:298`).

### Earlier history: "in-app only" was a scope cut, never a merit decision
**Source**: `.../analysis/findings/prior-decisions-reminders-channels.md:9-62, 219`
- T16, lend lifecycle HLD and private-group access requests each put email/push/SMS out of scope (F1.1-F1.3); "never evaluated on merit" (`:219`).
- F1.5 (`:42-46`): moderation (DSA) task floated "E-mail field + mailer" for anonymous "Zgłoś" reporters — still open.
- F1.6 (`:50-57`): registered users have an email; anonymous RSVP guests and lightweight family members have `email=None`.

### Implementation status (verified in code, 2026-11-26)
- Grep over `src/`, `.env.example`, compose for `email_reminders_enabled|email_deliveries|email_verification|EMAIL_PROVIDER|EMAIL_ENABLED|EmailSender|email_verified_at|email_consent_at|APP_PUBLIC_BASE_URL` → only `.venv` third-party hits. **Phase 3 not built.** Confidence High.
- Grep for `handover_reminder_markers|handover_reminder_due|handover_commitments` in `src/backend/app` and `alembic` → 0 hits. **Phases 1-2 not built.** Confidence High.
- Only development task: `.maister/tasks/development/2026-10-13-handover-quick-wins-phase0/` (item 7 "remove fake e-mail/SMS toggles in Settings", `analysis/codebase-analysis.md:5, 254-255`; gap analysis `:49` also drops `emailNotifs`/`smsNotifs` state). Grep for `UstawieniaView|emailNotifs|smsNotifs` in `src/frontend/src` → 0 hits. **Phase 0 toggle removal shipped**, and the view itself no longer exists (panel rebuilt in Next.js).
- `user_profiles.email` is still `String(255) nullable` with no verification columns: `src/backend/app/users/models.py:62`. Case-insensitive unique index `uq_user_profiles_email_lower` (`src/backend/alembic/versions/0016_unique_user_profile_email.py:32`).

## 2. Google-login research (2026-11-25, implemented as migrations 0107-0108)

**Sources**: `.maister/tasks/research/2026-11-25-google-login/outputs/decision-log.md`, `high-level-design.md:21-26, 250-254`; `.maister/tasks/development/2026-11-25-google-login/documentation/user-guide.md`
**Confidence**: High

- ADR-005 (`decision-log.md:173-213`): no automatic linking by email; collision → 409, unverified Google email → 403. Rationale: "aj never verifies emails at password registration, and login JWTs cannot be revoked" (`:179`), pre-account-hijack (USENIX 2022). "3C slots in later once email verification (D8) exists" (`:208`).
- ADR-004 (`:145-167`): nullable `password_hash`; context notes "There is no password change, reset or account deletion" (`:145`); NULL is meant for a future "set first password" (D4) (`:158`).
- ADR-002 notes "no `PUBLIC_BASE_URL`, so the nginx base-URL bug (D11) does not apply" (`:54`) — relevant: an email module needs an absolute public base URL for links (ADR-009's `APP_PUBLIC_BASE_URL`), which reintroduces D11 (`resolve_base_url` behind nginx).
- Deferred list (`high-level-design.md:250-254`), every one additive (`decision-log.md:350`):
  - **D1** "Połącz z Google"/unlink in settings; **D4** set a first password for NULL-hash accounts;
  - **D7** per-user token cutoff and RISC;
  - **D8 email verification** ("would enable verified auto-linking");
  - **D10 password reset and account deletion** (CASCADE FK on `user_identities` already covers deletion);
  - **D11** `resolve_base_url` fix behind nginx; **D12** nginx `limit_req` on `/api/auth/*`; **D13** CSP;
  - **D14** privacy policy, homepage and brand verification (non-code, production prerequisite).
- Status: all D-items still deferred (no reset/verification routes; auth router has only `/login`, `/google/nonce`, `/google` at `src/backend/app/auth/router.py:80,168,179`; register at `src/backend/app/users/router.py:43`).
- User guide states plainly "nie ma resetu hasła" and "Brak odzyskiwania konta Google" (`documentation/user-guide.md:16, 25, 224`).

## 3. architecture.md statements

**Source**: `.maister/docs/project/architecture.md`
- `:411` (Wants → Bells (outbox)): "In-app only: rows in `notifications` shown by the bell. Two kinds … `WANT_MATCH_FOUND` and `WANT_EXPIRING`." Bells go through `wants.bells_due` outbox rows; the backend handler writes notifications, honouring the want's `notifications_enabled` (`:419`).
- `:480` (Wants → Known limits): "**In-app notifications only**: no e-mail and no push."
- `:541` (Google sign-in → Accepted risks): "a Google-only account has no recovery path (no set-password, reset or deletion)"; login JWTs cannot be revoked (up to 1 h).
- `:537`: email match is case-insensitive via `users.service.is_email_registered`, like `uq_user_profiles_email_lower`.
- `:534`: integration gating pattern — the feature is off unless its setting is present on both stacks (503 / no button). Same pattern used by storage (`:119`, `get_storage()` returns `None` while `SPACES_*` unset). A precedent for `EMAIL_ENABLED`/absent-provider = log adapter.
- `:62`: lifespan starts the outbox poller and APScheduler after `clock.check_timezone()` — the place an email handler/job would register.
- No other mention of email/SMTP/unsubscribe in architecture.md (grep). Points stage 1 lists "notifications out of scope" (INDEX summary).
