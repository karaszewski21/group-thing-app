# Scope Clarifications (Phase 2 decision gate)

## TL;DR
All 8 gap-analysis decisions are settled, each with the recommended option. The verification mail is created inside `users.service.register`, atomically. Bell mails sit behind a second flag, `EMAIL_NOTIFICATIONS_ENABLED`, which defaults to false so the domain can warm up first. The queue is our own `email_messages` table, which acts as the outbox; mails do not go through `outbox_entries`.

## Key Decisions
- C-1 Inside register: the auth-side `account_tokens.issue_verification` is called in `users.service.register` before its commit — atomic, and avoids the users↔auth import cycle
- C-2 Second flag `EMAIL_NOTIFICATIONS_ENABLED` (default false): while it is off the notifications hook enqueues nothing — keeps the account-mail-only warm-up and the D14 privacy-policy gate without a code change
- I-1 Expire stale rows: NOTIFICATION rows older than 24 h → SKIPPED `expired`; TRANSACTIONAL rows past their token expiry are expired too — no burst of outdated mail after re-enabling
- I-2 `db.add(EmailMessage)` for single `create_notification`; one `INSERT … ON CONFLICT DO NOTHING` for `create_notifications` — the user asked "why not the outbox?"; answer: `email_messages` IS the transactional outbox (ADR-003); `outbox_entries` has no backoff, re-runs every handler and would duplicate bells
- I-3 Deterministic key `term_confirmation:<reservation_id|proposal_id>:<party_id>` for TERM_CONFIRMATION_NEEDED — blocks duplicate mails from outbox retries; the duplicate bell itself is a pre-existing bug, out of scope
- I-4 `/api/people/me` `email_verified: bool | null` (null = email disabled or no address); banner only on false; reset shows the Polish 503
- I-5 COMPLAINT suppression lifted only by support; `/settings` shows an info line and disabled toggles
- I-6 Successful password-reset confirm sets `email_verified_at` when the token's email snapshot equals the profile email

## Open Questions / Risks
- Assumptions from the gap analysis stand: `topic_id: UUID | None` on `NotificationEntry`; backoff 1/5/15/60/240 min, MAX_ATTEMPTS 6, stuck SENDING 10 min; `EMAIL_DAILY_CAP` default 100 from Warsaw midnight (TRANSACTIONAL exempt); stdlib smtplib via `to_thread`; query + `useCallback` writes (no `useMutation`); token lifetimes 1 h / 48 h; no HTTP rate limit; no purge; migrations 0110 tables / 0111 column / 0112 backfill.
