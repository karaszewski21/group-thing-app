# Phase 1 Clarifications

## TL;DR
Build rollout stages 1+2 of the research design: account mails plus the 7 MVP bell kinds, with preferences, unsubscribe, webhook and the frontend surfaces. The unsubscribe key is a separate `EMAIL_LINK_SIGNING_SECRET`. Dev gets a Mailpit service under the compose `dev` profile, with an SMTP adapter.

## Key Decisions
- Scope = stages 1+2 — new bell kinds (stage 3: TRANSACTION_CANCELLED, TERM_RESCHEDULED) become a separate task
- Unsubscribe links signed with a separate `EMAIL_LINK_SIGNING_SECRET` — rotating JWT_SECRET must not break links in mails already sent (research ADR)
- Mailpit under `profiles: ["dev"]` with a pinned image, plus `SmtpSender` — local preview of real HTML/text and headers

## Q&A
1. **Scope?** → Stages 1+2 (recommended).
2. **Link signing key?** → Separate secret (recommended).
3. **Mailpit in compose?** → Yes, profile dev (recommended).
