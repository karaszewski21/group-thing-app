# Research Plan — moduł wysyłki e-maili (aj)

## TL;DR
Mixed research (literature + technical), five parallel gatherers: two codebase (delivery infrastructure; trigger inventory), two external (provider comparison; deliverability/GDPR/unsubscribe/templating/testing practices) and one for prior decisions + frontend surfaces. The starting hypothesis to verify, not re-derive, is ADR-009 from `2026-10-13-handover-reminders-beyond-notifications`: email as an extra outbox handler behind a provider-agnostic `EmailSender` port with an `httpx` adapter, verified + opted-in addresses only, `(outbox entry, recipient)` dedupe, signed unsubscribe. Synthesis yields a provider recommendation (+ alternative), an `app/email` module sketch and a prioritised trigger table.

## Key Decisions
- Research type mixed — the brief combines provider/practice questions (literature) with trigger and integration questions (codebase).
- ADR-009 treated as the baseline hypothesis — a prior research task already chose the integration seam; this task confirms or challenges it with current code (Google sign-in, wants, points, events landed since) and adds provider choice and the trigger inventory it lacked.
- Five gatherers, not four — prior decisions and frontend surfaces (account/settings, auth pages, unsubscribe/verify landing routes, reserved slugs) are split from the backend infra gatherer so neither is overloaded.
- HTTP API preferred as evaluation default over SMTP — `httpx` is already a runtime dependency (minimal-dependency convention); SMTP kept as a comparison axis, not excluded.

## Open Questions / Risks
- Budget and hard EU data-residency requirement are unconfirmed with the user — gatherers report both EU-hosted and US-hosted-with-DPA options; synthesis states the assumption.
- `users.email` is nullable (`app/users/models.py:62`) — family-created profiles (children/guardian-managed) may have no address or share the guardian's; recipient resolution rules need evidence from `app/families/`.
- Emails today are unverified; Google accounts arrive with verified email. Verification is a prerequisite for non-auth mail — scope it in synthesis without designing the implementation.
- Provider pricing/free tiers change often — external gatherers must cite the page and access date (2026-11-26).
- No password reset exists in `app/auth` (grep found no reset/forgot) — to confirm; Google-only accounts have no recovery (accepted risk in architecture.md), which reset-by-email would address.

---

## 1. Research Overview

**Question**: Jak wdrożyć moduł wysyłki e-maili w aj (FastAPI + Next.js, VPS, docker compose) z użyciem zewnętrznego dostawcy i w jakich momentach aplikacji maile powinny być wysyłane?

**Sub-questions** (from the brief):
1. Which transactional provider fits (EU/GDPR + DPA, price at small scale, deliverability, HTTP API vs SMTP, Python SDK, bounce/complaint webhooks, templates, free tier)?
2. How does sending plug into the existing architecture: outbox (`embeddings.requested`, `storage.objects_delete`, `wants.bells_due`, groups pledge/term events), notifications (bell kinds), APScheduler jobs, ACLs, config/env, tests?
3. Which app events warrant an email; mandatory transactional vs opt-in notification vs digest?
4. Preferences and unsubscribe (List-Unsubscribe, RFC 8058), Polish HTML + text templates, Europe/Warsaw dates.
5. Deliverability: SPF/DKIM/DMARC, sending subdomain, warm-up, bounce/suppression.

**Type**: Mixed (literature + technical; light requirements from prior research).

**In scope**: provider comparison, integration pattern, trigger inventory, preferences/unsubscribe, templates, DNS, bounces.
**Out of scope**: writing code, marketing/newsletters, SMS/push.
**Constraints**: Polish users and copy, GDPR, small-scale VPS docker-compose deploy, secrets only in `.env` (names only in findings).

## 2. Methodology

**Primary approach**
- Codebase: targeted reading of known modules (verified to exist) + Grep sweeps for emitters (`create_notification`, `NotificationKind.`, `outbox.*append`, `register_handler`, `add_job`) and for auth/account flows. Every claim cites `file:line`.
- External: official provider docs and pricing pages first (WebFetch), WebSearch for independent deliverability comparisons; RFCs and regulator guidance (UODO/EDPB, Google/Yahoo bulk-sender rules) for practices.
- Prior decisions: read prior research outputs and decision logs; record what is already decided vs open.

**Fallbacks**
- If a provider page blocks fetching, use its docs/API reference or a dated third-party comparison and mark confidence lower.
- If an emitter is not found by name, trace from `NotificationKind` enum values and router endpoints backwards.

**Analysis framework**
- Technical: component identification (outbox, dispatcher, registry, notifications, scheduler, config) → flow analysis (domain write → outbox row → handler → bell) → integration mapping (where an email handler attaches, idempotency, retries, failure states).
- Requirements: event inventory → recipient → urgency → classification (transactional-mandatory / notification-opt-in / digest) → MVP vs later.
- Literature: weighted provider matrix (EU residency/DPA, price at 1k/10k/50k msgs/month, deliverability reputation, API ergonomics/Python, webhooks + suppression, templating, free tier, ops burden) → trade-offs → applicability to aj.

## 3. Data Sources
See `planning/sources.md` (all codebase paths verified with Glob/ls on 2026-11-26).

## 4. Research Phases

1. **Baseline** — read ADR-009 and the handover research report; extract decisions, settings names and open preconditions (verification, consent, unsubscribe). Confirm with current code what changed since 2026-10-13.
2. **Infrastructure mapping** — outbox model/dispatcher/registry/scheduler semantics (at-least-once, retries, FAILED state, multiple handlers per event), notifications model and outbox listener, APScheduler jobs in `main.py`, `config.py` settings pattern, user/auth model (email nullability, uniqueness, Google identity `email_verified`, password-hash nullability, no reset flow), families recipient rules.
3. **Trigger inventory** — every domain event that creates a bell or outbox row, plus auth/account events that have no bell (register, Google sign-up, email change, password change, account/family member creation). Record `file:line`, recipient(s), existing bell kind, timing (immediate vs scheduled, e.g. term-end scan, attendance close, wants expiry).
4. **External: providers** — compare ≥8 candidates (Resend, Postmark, Amazon SES eu-central-1, Mailgun EU, Brevo, MailerSend, Mailjet, Scaleway TEM, SendGrid; optionally SMTP2GO, Lettermint/EU-native) on the matrix.
5. **External: practices** — SPF/DKIM/DMARC and alignment on a subdomain, Gmail/Yahoo 2024+ sender requirements, RFC 8058 one-click unsubscribe and RFC 2369, GDPR lawful basis for transactional vs notification mail (art. 6(1)(b)/(f), Polish PKE/ustawa o świadczeniu usług drogą elektroniczną consent for commercial content), DPA/SCC, retention of send logs, bounce/complaint webhooks + suppression list, templating (Jinja2 vs MJML vs provider templates, plain-text part, Polish diacritics/UTF-8), local testing (Mailpit in compose), idempotency keys.
6. **Frontend & UX surfaces** — where preferences, verification banner and unsubscribe landing pages would live (account view, auth forms, `src/proxy.ts`, reserved slugs, routing facade).
7. **Verification** — cross-check trigger list against `NotificationKind` (every kind accounted for), and provider claims against at least two sources.

## 5. Gathering Strategy

### Instances: 5

| # | Category ID | Output Prefix | Focus Area | Tools | Concrete Sources |
|---|-------------|---------------|------------|-------|------------------|
| 1 | codebase-notifications-outbox | codebase-infra | Delivery infrastructure an email module would plug into: outbox (model, `append`, dispatcher retries/backoff/FAILED, registry multi-handler), notifications module (model, kinds, service, outbox_listener, router, read state), APScheduler jobs, `config.py` settings pattern + `.env.example` names, user/auth model (email nullable/unique/lower index, `user_identities.email_verified`, nullable `password_hash`, absence of verification/reset), families recipient rules, ACL convention (`infrastructure/*_acl.py`, `wants/infrastructure/outbox_acl.py`), existing tests (`test_outbox.py`, `test_notifications.py`), compose services | Glob, Grep, Read | `src/backend/app/outbox/*`, `src/backend/app/notifications/*`, `src/backend/app/main.py` (jobs ~L79-260), `src/backend/app/config.py`, `src/backend/app/users/models.py`, `src/backend/app/users/service.py`, `src/backend/app/auth/*`, `src/backend/app/families/*`, `src/backend/app/wants/infrastructure/outbox_acl.py`, `src/backend/app/groups/infrastructure/outbox_bridge.py`, `src/backend/app/storage/outbox_listener.py`, `docker-compose.yml`, `.env.example` (names only), `src/backend/pyproject.toml`, `src/backend/tests/test_outbox.py`, `test_notifications.py`, `test_wants_notifications.py` |
| 2 | codebase-triggers | codebase-triggers | Inventory of every app event that could warrant an email, with `file:line`, recipient, existing bell kind, timing: auth/account (register, Google sign-up, login from new device n/a, password/email change, family member/guardian creation), reservations take/propose/accept/reject/confirm/cancel across TERM/EVENT/PERSONAL contexts, pledges, term changes/cancellation/end scan, attendance close + points awards, term payments (PAID mark), events create/edit/delete/attendance, group membership/join requests/join code/roles, wants MATCH/EXPIRING, messaging new message (EVENT/TERM/direct conversations), moderation rejections, media | Grep, Read | `src/backend/app/groups/application/*.py` (reservations, pledges, terms, term_end_scan, attendance, term_payments, memberships, join_code, group_roles), `src/backend/app/groups/domain/pledge_events.py`, `swap_events.py`, `src/backend/app/events/service.py`, `src/backend/app/inventory/`, `src/backend/app/wants/application/bells_due.py`, `match_notifications.py`, `src/backend/app/messaging/application/messages.py`, `conversations.py`, `src/backend/app/points/`, `src/backend/app/moderation/service.py`, `src/backend/app/auth/service.py`, `src/backend/app/users/service.py`, `src/backend/app/families/*.py`; cross-check vs `NotificationKind` in `src/backend/app/notifications/models.py:37-65` |
| 3 | external-providers | external-providers | Transactional provider comparison on the weighted matrix: EU data residency + DPA/SCC, pricing at ~1k/10k/50k per month and free tier, deliverability reputation, HTTP API + Python SDK (or plain `httpx`), SMTP availability, idempotency keys, webhooks for bounce/complaint/delivery with signature verification, suppression list API, template features, dedicated IP need, account approval friction for new domains, Polish support/billing (PLN/VAT) | WebSearch, WebFetch | Official pricing/docs/DPA pages of Resend, Postmark, Amazon SES (eu-central-1), Mailgun EU, Brevo, MailerSend, Mailjet, Scaleway TEM, SendGrid; optionally SMTP2GO and an EU-native newcomer; one or two dated independent deliverability comparisons |
| 4 | external-practices | external-practices | Deliverability & compliance & engineering practices: SPF/DKIM/DMARC alignment on a sending subdomain, Gmail/Yahoo bulk-sender rules (2024+), warm-up at low volume, RFC 8058 + RFC 2369 headers, GDPR lawful basis for transactional vs notification mail and Polish law on electronic communication consent, send-log retention, bounce/complaint handling and suppression, templating (Jinja2 autoescape + plain text, MJML or provider templates, inline CSS, dark mode, UTF-8 diacritics), local testing with Mailpit in docker compose, idempotent sending/outbox best practices, notification batching/digests (prior research cites Meetup/Eventbrite) | WebSearch, WebFetch | RFC 8058, RFC 2369, RFC 7489 (DMARC), Google Email sender guidelines, Yahoo sender best practices, UODO/EDPB guidance, ustawa o świadczeniu usług drogą elektroniczną / Prawo telekomunikacyjne→PKE art. on direct marketing consent, Mailpit docs, Jinja2 docs, MJML docs |
| 5 | prior-decisions-frontend | prior-decisions | What is already decided and where the UI surfaces would live: ADR-009 and related ADRs in the handover research, the Google-login research (verified email, no recovery), architecture.md statements about "in-app only"; frontend account/settings view (do fake e-mail toggles still exist?), auth forms (register consent checkbox), routing facade, `src/proxy.ts` `PROTECTED_PREFIXES`, reserved slugs for new public routes (e.g. `/unsubscribe`, `/verify-email`), `data-fetching` patterns | Read, Grep, Glob | `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/{decision-log,research-report,high-level-design}.md` + `analysis/findings/notifications-infra-*.md`, `prior-decisions-reminders-channels.md`, `external-patterns-channels.md`, `.maister/tasks/research/2026-11-25-google-login/` outputs, `.maister/docs/project/architecture.md` (search "In-app notifications only", Google sign-in section ~L530-540), `src/frontend/src/features/account/AccountView.tsx`, `src/frontend/src/features/auth/*`, `src/frontend/src/proxy.ts`, `src/frontend/src/routing/`, reserved-slug lists (Grep `RESERVED` in backend and frontend) |

### Rationale
The trigger inventory is wide (≈10 bounded contexts) and deserves its own gatherer separate from the narrow-but-deep infrastructure reading. External work splits naturally into "which vendor" (fast-changing commercial facts) and "how to do it right" (stable standards/law). Prior research already answered the integration seam, so a dedicated gatherer extracts those decisions and pairs them with the frontend surfaces they reference, letting synthesis focus on deltas rather than re-deriving. Configuration is folded into gatherer 1 because the email-relevant config is small (`config.py`, `.env.example`, compose).

**Secrets rule for every gatherer**: never print secret values; no `env`/`printenv`/`cat .env`/`docker inspect` env; `.env.example` and settings by name only; check presence only.

## 6. Success Criteria
- Every sub-question 1–5 answered with cited evidence (`file:line` or URL + access date).
- Provider matrix covers ≥8 providers with a justified recommendation and one alternative, under stated assumptions (EU residency, budget).
- Integration sketch states: handler attachment point, idempotency/dedupe, retry and failure semantics matching `outbox/dispatcher.py`, config names, ACL placement, clock use, test approach (fake sender + optional Mailpit), and how it relates to ADR-009 (confirmed / changed).
- Trigger table: event → code location → recipient(s) → existing bell kind → type (transactional / opt-in notification / digest) → priority (MVP / later); every `NotificationKind` value accounted for; auth flows without bells included.
- Preconditions listed: email verification, consent/preferences storage, unsubscribe token, nullable/family emails, Google-only accounts.
- DNS/deliverability checklist concrete enough for a VPS operator (records per provider, subdomain choice, DMARC policy ramp).

## 7. Expected Outputs
- `analysis/findings/<prefix>-*.md` from each gatherer.
- `analysis/synthesis.md` and `outputs/research-report.md` with provider recommendation, module sketch, trigger table, preferences/unsubscribe design notes, DNS checklist, risks.
- Optional `outputs/decision-log.md` amending/superseding ADR-009 where evidence differs.
