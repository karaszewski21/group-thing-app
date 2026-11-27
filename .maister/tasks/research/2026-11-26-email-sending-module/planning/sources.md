# Research Sources — moduł wysyłki e-maili

## TL;DR
All codebase paths below were verified to exist on 2026-11-26. Core seams: `app/outbox/` (registry allows several handlers per event), `app/notifications/` (13 `NotificationKind` values), APScheduler jobs in `app/main.py`, `app/config.py` settings. A prior ADR-009 (handover research) already proposes email as an outbox handler; it is the baseline to verify. External sources are official provider pages, RFCs and regulator guidance, cited with access date.

## Key Decisions
- Prior research outputs are listed as primary sources — they hold the integration decision and settings names already agreed.
- `.env.example` is a source by variable name only — secrets rule; `.env` is never read.

## Open Questions / Risks
- The frontend settings view with fake e-mail toggles cited by ADR-009 (`UstawieniaView.tsx`) was not found by Grep — gatherer 5 to confirm whether it was removed or renamed.

---

## Codebase Sources

### Delivery infrastructure (gatherer: codebase-infra)
- `src/backend/app/outbox/models.py` — outbox row, status/attempt columns
- `src/backend/app/outbox/service.py` — `append` API
- `src/backend/app/outbox/dispatcher.py` — at-least-once dispatch, retries, FAILED
- `src/backend/app/outbox/registry.py` — `register_handler`/`get_handlers` (multi-handler)
- `src/backend/app/outbox/scheduler.py` — dispatch loop
- `src/backend/app/notifications/models.py` — `Notification`, `NotificationKind` (L37-65), pre-rendered 500-char message
- `src/backend/app/notifications/service.py`, `repository.py`, `router.py`, `schemas.py`
- `src/backend/app/notifications/outbox_listener.py` — handlers for pledge/term-ended events (L47-50)
- `src/backend/app/storage/outbox_listener.py` — `storage.objects_delete` handler
- `src/backend/app/product/embeddings.py`, `src/backend/app/wants/application/embeddings.py` — `embeddings.requested`
- `src/backend/app/wants/application/bells_due.py`, `src/backend/app/wants/infrastructure/outbox_acl.py` — outbox via ACL pattern
- `src/backend/app/groups/infrastructure/outbox_bridge.py` — groups → outbox
- `src/backend/app/main.py` — lifespan, `_run_term_end_scan`, `_run_attendance_close`, `_run_media_sweep`, `_run_embedding_reconcile`, `AsyncIOScheduler.add_job` (~L79-260)
- `src/backend/app/config.py` — `Settings` (pattern for `EMAIL_*` names, feature flags like `embeddings_enabled`, `google_client_id`)
- `src/backend/app/core/clock.py` — Warsaw formatting helpers (`format_term_when`)
- `src/backend/app/db.py` — `mapped_transaction_conflicts`
- `src/backend/app/users/models.py` — `UserProfile.email` nullable (L62)
- `src/backend/app/users/service.py` — `register` (L328), `is_email_registered` (L279), `bootstrap_person_account`, email normalisation
- `src/backend/app/auth/models.py` — `user_identities.email`/`email_verified` (L91-92)
- `src/backend/app/auth/service.py`, `router.py`, `google.py` — login/register/Google; no reset/verification flow found
- `src/backend/app/families/` (`members.py`, `guardians.py`, `primary_contact.py`, `bootstrap.py`) — profiles without own email, guardian contact

### Trigger emitters (gatherer: codebase-triggers)
- `src/backend/app/groups/application/` — `pledges.py`, `term_item_listings.py`, `item_actions.py`, `event_reservations.py`, `reservation_context.py`, `my_reservations.py`, `terms.py`, `term_end_scan.py`, `attendance.py`, `attendance_points.py`, `term_payments.py`, `memberships.py`, `join_code.py`, `group_roles.py`, `circles.py`
- `src/backend/app/groups/domain/pledge_events.py`, `swap_events.py`
- `src/backend/app/events/service.py`, `page.py`, `router.py`
- `src/backend/app/inventory/` (`application/`, `service.py`)
- `src/backend/app/wants/application/match_notifications.py`, `bells_due.py`, `writes.py`; `src/matcher/matcher/` (expiry/reminder sweep)
- `src/backend/app/messaging/application/messages.py`, `conversations.py`, `access.py`
- `src/backend/app/points/` (`application/`, `service.py`)
- `src/backend/app/moderation/service.py`, `src/backend/app/media/service.py`
- Grep patterns: `NotificationKind\.`, `create_notification|notify`, `outbox.*append|outbox_acl.append`, `register_handler`

### Tests (patterns for an email handler test)
- `src/backend/tests/test_outbox.py`, `test_notifications.py`, `test_wants_notifications.py`, `test_auth_cookie.py`, `test_module_boundaries.py`, `conftest.py`

### Frontend (gatherer: prior-decisions)
- `src/frontend/src/features/account/AccountView.tsx` — account menu/settings
- `src/frontend/src/features/auth/` — `RegisterForm.tsx`, `LoginForm.tsx`, `SocialAuthButtons.tsx`, `useGoogleSignIn.ts`
- `src/frontend/src/proxy.ts` — `PROTECTED_PREFIXES`, rewrites
- `src/frontend/src/routing/reservedSlugs.ts`, `paths.ts`, `navigation.tsx`

## Documentation Sources

### Project documentation
- `.maister/docs/INDEX.md`
- `.maister/docs/project/architecture.md` — outbox/bell design, "In-app notifications only" (L480), Google sign-in (L530-540)
- `.maister/docs/project/tech-stack.md` — pinned deps (`httpx` present), env var conventions
- `.maister/docs/standards/global/error-handling.md`, `conventions.md`, `minimal-implementation.md`
- `.maister/docs/standards/backend/security.md`, `models.md`, `migrations.md`, `time.md`, `api.md`
- `.maister/docs/standards/testing/backend-testing.md`
- `CHANGELOG.md`, `README.md`

### Prior research (baseline decisions)
- `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/decision-log.md` — ADR-009 (L299-321): email as outbox handler, `EmailSender` port, settings names
- `.../outputs/research-report.md` — F8 email unverified, no preferences (L108-115)
- `.../outputs/high-level-design.md`, `solution-exploration.md`
- `.../analysis/findings/notifications-infra-backend-model-emitters.md`, `notifications-infra-delivery-scheduling.md`, `prior-decisions-reminders-channels.md`, `external-patterns-channels.md`
- `.maister/tasks/research/2026-11-25-google-login/outputs/decision-log.md`, `research-report.md`

### Code documentation
- Module docstrings in `app/outbox/registry.py`, `app/notifications/models.py`, `app/wants/application/bells_due.py`

## Configuration Sources
- `docker-compose.yml` — services `postgres`, `backend`, `matcher`, `web`, `frontend` (nginx); where a Mailpit dev service would go
- `.env.example` — variable names only
- `src/backend/pyproject.toml`, `src/backend/uv.lock` — `httpx`, `jinja2` presence
- `src/backend/app/config.py`

## External Sources (accessed 2026-11-26; cite URL + date)

### Providers
- Resend — https://resend.com/pricing, https://resend.com/docs (regions, webhooks, idempotency)
- Postmark — https://postmarkapp.com/pricing, https://postmarkapp.com/developer, EU/DPA page
- Amazon SES — https://aws.amazon.com/ses/pricing/, SES docs (eu-central-1, SNS bounce/complaint, sandbox exit)
- Mailgun — https://www.mailgun.com/pricing/, EU region docs
- Brevo — https://www.brevo.com/pricing/, transactional API docs
- MailerSend — https://www.mailersend.com/pricing, docs
- Mailjet — https://www.mailjet.com/pricing/, docs
- Scaleway Transactional Email — https://www.scaleway.com/en/transactional-email-tem/, pricing
- SendGrid — https://sendgrid.com/pricing/
- Optional: SMTP2GO, an EU-native provider; one or two dated independent deliverability benchmarks

### Practices and law
- RFC 8058 (one-click unsubscribe), RFC 2369 (List-* headers), RFC 7489 (DMARC), RFC 7208 (SPF), RFC 6376 (DKIM)
- Google email sender guidelines — https://support.google.com/a/answer/81126
- Yahoo sender best practices — https://senders.yahooinc.com/best-practices/
- GDPR art. 6, 13, 28 (DPA); EDPB guidance; UODO (uodo.gov.pl)
- Polish Prawo komunikacji elektronicznej (PKE, 2024) / ustawa o świadczeniu usług drogą elektroniczną — consent for commercial communication vs service messages
- Mailpit — https://mailpit.axllent.org/docs/
- Jinja2 — https://jinja.palletsprojects.com/ (autoescape); MJML — https://mjml.io/
- Product references for batching/digests: Meetup, Eventbrite (cited in prior research)
