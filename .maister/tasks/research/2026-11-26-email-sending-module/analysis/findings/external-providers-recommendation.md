# External providers — recommendation

Based on `external-providers-matrix.md`. Sources accessed 2026-11-26.

## TL;DR
- **If EU data residency is a hard requirement (the default assumption here):** use **Mailgun with the EU region** (`api.eu.mailgun.net`). Message data, logs and suppressions stay in the EU. It has an official Python SDK, HMAC-signed webhooks and a suppression API. It costs $0 at ≤100/day, $15 at 10k and $35 at 50k.
- **Alternative (an EU-owned vendor with an EU-only stack):** **Brevo** (French; 300/day free; native `idempotencyKey`), or **Scaleway TEM** if cost matters most (~€2.4 at 10k, but beta webhooks routed through SNS topics).
- **If residency is soft (a DPA with SCCs/DPF is enough):** **Resend** has the best developer experience (24 h `Idempotency-Key`, Svix-signed webhooks, $20 for up to 50k). **Postmark** is the deliverability-first choice but has no webhook HMAC and no EU region.
- **Amazon SES eu-central-1** is the cheapest and region-scoped. It is not recommended for a solo-operated VPS app because of sandbox approval (up to 96 h), SNS plumbing for bounces and AWS account overhead.

## Key Decisions
- A sending region alone does not count as residency. Resend eu-west-1 keeps logs and metadata in the US, so Resend is placed under "soft".
- Native idempotency is a tie-breaker only. The aj outbox already gives at-least-once delivery, so the email handler must dedupe by its own key (e.g. a send-log row keyed by outbox event id + recipient) whatever the provider.
- HTTP API via `httpx` over SMTP: httpx is already a backend dependency, HTTP returns a provider message id synchronously for bounce correlation, and it avoids the SMTP connection lifecycle inside the async app. Keep the provider behind a small `EmailSender` port so a swap costs one adapter. Mailgun, Brevo, Resend and Scaleway are all simple JSON or form POSTs, so no SDK is required.
- Webhook verification is mandatory for suppression. Prefer providers with HMAC or Svix signatures (Mailgun, Resend, SendGrid) over basic-auth-only (Postmark) or SNS-mediated (SES, Scaleway).

## Open Questions / Risks
- **Owner decision needed:** is EU residency hard (EU storage, and maybe an EU-owned vendor) or soft (DPA + SCC)? This flips the recommendation.
- The Mailgun free plan is 100/day. A burst (e.g. a term reminder to a big group) above 100/day needs Basic ($15). The same applies to Resend Free (100/day).
- Mailgun's DPA text and its sub-processor list were not fetched. Confirm the SCC/DPA terms with Sinch before go-live. Mailgun Technologies is a US subsidiary of Sinch (Sweden), so CLOUD Act exposure exists in principle even though message data stays EU-bound.
- Brevo paid pricing is UNVERIFIED, and a third-party claim of a US transactional path is unresolved. Check Brevo's sub-processor list if Brevo is chosen.
- No independent 2026 deliverability benchmark covers these candidates. Plan a seed test (e.g. mail-tester or GlockApps) on the chosen sending subdomain before launch.

---

## Assumptions
1. Volume is hundreds to ~10k/month at first, with a possible ~50k/month later. Mail is transactional only, no marketing.
2. Recipients are Polish and processing falls under GDPR. aj is the controller and the provider is an Art. 28 processor.
3. A single operator runs a docker compose VPS. Minimal extra infrastructure; secrets only in `.env`.
4. The backend is FastAPI async with `httpx` present. Sends happen from an outbox handler (at-least-once), so retries happen and dedupe is required.

## Scoring (weighted: residency 30, ops simplicity/approval 20, webhooks + suppression 15, price at 10k–50k 15, API/SDK/idempotency 10, deliverability evidence 10)

| Provider | Residency | Ops/approval | Webhooks+suppr. | Price | API/idem. | Deliverability | Total /100 |
|---|---|---|---|---|---|---|---|
| Mailgun EU | 26 | 15 | 14 | 13 | 7 | 6 | **81** |
| Brevo | 27 | 16 | 10 | 13 (unverified) | 9 | 5 | **80** |
| Scaleway TEM | 30 | 12 | 6 | 15 | 5 | 4 | **72** |
| Resend | 12 | 19 | 15 | 14 | 10 | 6 | **76** |
| Postmark | 10 | 14 | 9 | 10 | 6 | 9 | **58** |
| Amazon SES eu-central-1 | 22 | 6 | 10 | 15 | 5 | 7 | **65** |
| MailerSend | 22 | 15 | 10 | 12 | 6 | 5 | **70** |
| Mailjet | 26 | 15 | 10 | 10 | 6 | 5 | **72** |
| SendGrid | 8 (EU only Pro+) | 12 | 13 | 6 | 7 | 6 | **52** |
| EmailLabs | 30 | 10 | 6 | 12 | 4 | 4 | **66** |

The scores are my judgement applied to the matrix evidence, not vendor data. With residency set to soft (weight 10, other weights scaled up), Resend comes out first and Mailgun second.

## Recommendation (EU residency = hard on storage, vendor nationality soft)
**Mailgun, EU region**
- Evidence: "message data never leaves the region in which it is processed" (https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview). The official SDK is `mailgun` 1.10.0, though `httpx` is enough. Webhooks are HMAC-SHA256 signed (https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks). Pricing is Free 100/day, Basic $15/10k, Foundation $35/50k (https://www.mailgun.com/pricing/).
- Setup: create the domain in the **EU region** (it cannot be moved later). Use a sending subdomain such as `mail.<domain>` with DKIM TXT, SPF include, MX for bounces and a DMARC record. Register a webhook for `delivered`, `failed` (permanent) and `complained`. Map permanent failures and complaints to an internal suppression flag on the address.
- Gaps: no native idempotency key, so dedupe in the app. Logs last 1 day on Free/Basic and 5 days on Foundation, so keep our own send log.

## Alternative (EU residency = hard including the vendor: EU company, EU-only stack)
**Brevo** for features (300/day free, `idempotencyKey` with a 30 min window, transactional webhooks, French company, OVH and Google Belgium hosting). **Scaleway TEM** if cost and sovereignty matter most: Scaleway says no non-EU sub-processors, and it costs €0.25/1k after 300 free. Scaleway's trade-off is that bounce webhooks are a beta routed through Scaleway Topics & Events, so the integration needs either an SNS-to-HTTP subscription or polling the emails API for status.

## If residency turns out soft
**Resend**: Svix-signed webhooks with `email.bounced/complained/delivered/suppressed`, a 24 h `Idempotency-Key`, 10 req/s, $0 up to 100/day and $20 up to 50k/mo (https://resend.com/pricing). Data is stored in the US under its pre-signed DPA with SCCs and DPF (https://resend.com/docs/dashboard/domains/regions, https://resend.com/security/gdpr). The privacy notice must then name a US transfer.

## Not recommended
- **SendGrid**: no permanent free plan (60-day trial), and EU residency only from Pro $89.95+ with a dedicated IP. That is over-provisioned for this scale.
- **Amazon SES**: the cheapest, but sandbox exit (up to 96 h, manual review), per-region identities, an SNS HTTPS subscription for events and AWS IAM overhead are a poor fit for one operator. Reconsider above ~100k/month.
- **Postmark**: strong deliverability reputation, but US-only storage, no webhook HMAC, $15 minimum for any real sending, and no official Python SDK.
