# External providers — transactional email comparison matrix

All sources accessed **2026-11-26**. Prices in the currency the vendor shows (USD unless stated), excluding VAT.

## TL;DR
- Only five of the eleven providers keep message data in the EU on their default or low-cost plans: **Mailgun EU region**, **Brevo**, **Mailjet**, **Scaleway TEM** and **EmailLabs**. MailerSend says its hosting is in the EU but does not name a country.
- **Resend's eu-west-1 is a sending region only.** Its account data (logs, metadata, API records) stays in the US, under SCCs and DPF. **Postmark** has no EU region. **SendGrid** offers EU data residency only from Pro ($89.95+/mo), with a dedicated IP.
- At 1k/10k/50k emails a month: the cheapest are SES (~$0.10/$1/$5) and Scaleway (~€0.18/€2.4/€12.4). Mailgun EU, Postmark, MailerSend and Resend cost $0–35 at 10k. At 50k, Resend Pro is $20 and Mailgun Foundation is $35.
- Native idempotency keys are documented only by **Resend** (24 h window) and **Brevo** (30 min window). Everyone else needs dedupe in the app, which the aj outbox gives anyway.
- Webhook signing: Resend uses Svix headers and Mailgun uses HMAC-SHA256. **Postmark has no HMAC signatures** (basic auth plus IP allowlist only). SES delivers events through SNS/EventBridge, so it needs extra AWS plumbing. Scaleway webhooks are a v1alpha1 beta tied to Scaleway Topics & Events (SNS).

## Key Decisions
- Where vendors use different storage mechanisms, residency is judged on **where message data and logs are stored**, not where the mail is sent from (Resend shows the two differ).
- A price is marked **UNVERIFIED** when the official page could not be fetched or gave conflicting figures.

## Open Questions / Risks
- **Brevo** transactional prices: the official pricing page returned only its title, and the help centre returned 403. Every Brevo paid-tier number is UNVERIFIED and comes from third-party sources that disagree.
- **Scaleway**: the product and pricing pages returned 403. Numbers come from search snippets of Scaleway's own pages, so confidence is medium. The docs conflict on the default monthly quota (10,000 vs an older 500/5,000).
- **MailerSend Starter**: the pricing page left the price blank. The help page says $35/mo for 50k, but one snippet says $25. The yearly price is $31.50 or $28 depending on the source.
- **Mailjet** 50k plan base price and **SendGrid** price per volume tier were not shown on the fetched pages.
- **EmailLabs** "Essential 30" says "up to 100 000 emails/month", which contradicts the plan name (30K slider). The free plan only allows test addresses until company details are provided.
- **Deliverability**: there is no independent, same-methodology 2026 benchmark covering all candidates. The only 2026 figure found (Postmark 93.8% inbox, EmailTooltester 2026) is quoted second-hand by a competitor (SMTP2GO).
- Not verified for: Mailgun/MailerSend/SES idempotency (no documentation found, so treated as absent), MailerSend webhook signature scheme, and SMTP2GO EU data location.

---

## 1. Matrix — residency, legal, price

| Provider | EU data residency | DPA / transfer basis | Free tier | ~1k/mo | ~10k/mo | ~50k/mo |
|---|---|---|---|---|---|---|
| **Resend** | ❌ Sending region eu-west-1 exists, but "account data, including email metadata, logs, and API records" stays in the US | Art. 28 DPA pre-signed for every account; EU SCCs (2021/914) + UK SCCs + EU-US DPF | 3,000/mo, **100/day cap**, 1 domain… 3 domains | $0 | $20 (Pro 50k) | $20 (Pro 50k) |
| **Postmark** | ❌ "No current plans" for EU servers; Chicago-area DC + AWS | Standard DPA with SCCs; owned by ActiveCampaign (US) | 100/mo developer, no overage | $15 (Basic 10k) | $15 Basic / $16.50 Pro | $66–87 (computed: base + 40k × overage) |
| **Amazon SES (eu-central-1)** | ✅ Region-scoped (identities, suppression list, SNS topics per region); AWS is a US company | AWS DPA (not fetched) | No SES-specific free tier; new AWS accounts get up to $200 credits over 6 months | $0.10 | $1.00 | $5.00 (à la carte $0.10/1k + $0.12/GB attachments) |
| **Mailgun (EU region)** | ✅ "message data never leaves the region in which it is processed": messages, logs, suppressions and domains are region-bound; account/billing/API keys replicated globally | Sinch (Swedish parent) GDPR programme, EU DPO; DPA not fetched | 100/day, 1-day logs | $0 | $15 (Basic 10k) | $35 (Foundation 50k) |
| **Brevo** | ✅ Brevo help centre: OVH France/Germany + Google Cloud Belgium. A third-party scan claims transactional mail goes through a US provider (unconfirmed) | DPA = Appendix 3 of the terms of use; French company | 300/day (~9k/mo), transactional included | $0 | $0 if ≤300/day | **UNVERIFIED** (third-party: $15–55) |
| **MailerSend** | ◐ "certified data storage center located in the European Union" (country not named; third-party: Google Belgium) | DPA; US entity under DPF; EU representative | 500/mo, 100 API requests/day, 1 domain | $7 (Hobby 5k) | ~$14.50 (Hobby + 5k × $1.50) or Starter | $35 Starter (help page; **conflicting $25**) |
| **Mailjet** | ✅ Google Cloud Frankfurt + Saint-Ghislain (BE) for EU-deployed accounts; part of Sinch | Sinch DPA, dpo@sinch.com | 6,000/mo, 200/day | $0 | $17.10/mo yearly (Essential 15k); monthly price **UNVERIFIED** ($17–19) | **UNVERIFIED** base; overage €1.39/1k on Essential 50k |
| **Scaleway TEM** | ✅✅ Only fr-par region; FAQ: whole stack managed in the EU, no non-EU sub-processors; French company | Scaleway DPA (not fetched) | 300/mo (Essential, pay-as-you-go) | ~€0.18 | ~€2.43 | ~€12.43 Essential (€0.25/1k), or Scale €80 (100k incl., dedicated IP, SLA) |
| **SendGrid (Twilio)** | ◐ EU data residency **only on Pro/Premier** with a dedicated EU IP and an EU subuser | Twilio DPA | **60-day trial**, 100/day (no permanent free plan) | $19.95+ (Essentials) | $19.95+ | **UNVERIFIED** tier; EU residency needs Pro **$89.95+** |
| **SMTP2GO** (optional) | **UNVERIFIED** (NZ company) | not checked | 1,000/mo | $0 | $10 (Starter 10k) | ~$50 (computed: $10 + 40k × $1) |
| **EmailLabs** (PL, optional) | ✅ "located in CEE (Beyond Data Center)", all processing in the EEA; Vercom S.A., Poznań | DPA not mentioned on the pricing page | 9,000/mo (300/day), but **test addresses only** until company details are given | €0 / €29 | €29 (€23 promo 3 mo) | €29 (volume claim conflicting) |

Legend: ✅ data stored in the EU · ✅✅ EU vendor, EU-only stack · ◐ partial or conditional · ❌ US storage.

## 2. Matrix — integration features

| Provider | HTTP API | SMTP | Python SDK | Webhooks (bounce/complaint/delivered) + signing | Suppression | Idempotency | Templates | Sandbox / test | Rate limit | Approval friction |
|---|---|---|---|---|---|---|---|---|---|---|
| **Resend** | ✅ `api.resend.com`, Bearer | ✅ | `resend` 2.56.0 (github resendlabs, de facto official) | ✅ `email.bounced/complained/delivered/delivery_delayed/failed/suppressed` + `suppression.added`; **Svix** `svix-id/timestamp/signature` | ✅ (suppression events) | ✅ `Idempotency-Key`, 24 h, ≤256 chars, 409 on mismatch | ✅ | test addresses (not fetched) | **10 req/s per team** default | Low (self-serve) |
| **Postmark** | ✅ `X-Postmark-Server-Token` | ✅ | community only (no official, not fetched) | ✅ Bounce, SpamComplaint, Delivery…; **no HMAC**: basic auth + IP allowlist; retries 1–15 min, then disabled after 48 h | ✅ API (dump/create/delete), per stream | ❌ not documented | ✅ | ✅ `POSTMARK_API_TEST` token | not fetched | Medium (manual account approval is commonly reported, not verified) |
| **SES** | ✅ SESv2 | ✅ (per-region credentials) | `boto3` (official) | via configuration sets → **SNS/EventBridge/Firehose**: Send, Delivery, Bounce, Complaint, DeliveryDelay, Subscription… | ✅ account-level, per region | ❌ | ✅ (SES templates) | ✅ sandbox + mailbox simulator | Sandbox 1/s, 200/24 h | **High**: sandbox, production request, "initial response within 96 hours" |
| **Mailgun EU** | ✅ `api.eu.mailgun.net` | ✅ | `mailgun` 1.10.0 (2026-10-21), **official** | ✅ delivered/complained/unsubscribed/…; **HMAC-SHA256(timestamp+token)** with a webhook signing key, replay check | ✅ bounces/complaints/unsubscribes API (medium confidence) | ❌ not found | ✅ | test mode flag (not fetched) | `/messages` 80k calls/10 s; 429 + `X-RateLimit-*` | Medium: card needed for custom domain; possible business review (third-party) |
| **Brevo** | ✅ `api.brevo.com/v3/smtp/email`, `api-key` header | ✅ | official SDK (not fetched) | ✅ transactional webhooks (not fetched in detail) | ✅ (not fetched) | ✅ `idempotencyKey` (30 min; body `headers` vs header placement is ambiguous) | ✅ | not fetched | not fetched | Low–medium |
| **MailerSend** | ✅ | ✅ | official (not fetched) | ✅ delivered/soft/hard bounce/spam complaint; "secret webhook key" (scheme not documented on the page); retries at 10 s and 100 s, 3 s timeout | ✅ | ❌ not found | ✅ (1 on Free) | not fetched | Free: 100 API requests/day | Low–medium |
| **Mailjet** | ✅ v3.1 | ✅ | `mailjet-rest` (not fetched) | ✅ (on Free) | ✅ | ❌ not checked | ✅ | not fetched | Free 200/day | Low–medium |
| **Scaleway TEM** | ✅ `…/transactional-email/v1alpha1/regions/fr-par/emails` | ✅ | generic Scaleway SDK only (TEM coverage unverified); plain httpx works | ◐ **beta**, quota on request, delivered through Scaleway **Topics & Events (SNS)**; hard/soft bounce, mailbox full, spam | blocklists (medium) | ❌ | ❌/limited (not verified) | — | Default quota 10k/mo (docs conflict), raised by support after payment + identity validation | Medium (identity and payment validation) |
| **SendGrid** | ✅ | ✅ | `sendgrid` (official) | ✅ Event Webhook (signed, not fetched) | ✅ | ❌ | ✅ dynamic templates | sandbox mode (not fetched) | not fetched | Medium; free trial ends after 60 days |
| **SMTP2GO** | ✅ | ✅ | not checked | ✅ (not fetched) | ✅ | ❌ | ✅ | — | — | Low |
| **EmailLabs** | ✅ | ✅ | not checked | ✅ "unlimited webhooks" on PRO only | — | — | ✅ | trial: test addresses only, 100/day | — | Medium (company details, sales contact for the trial) |

DKIM setup: every provider listed uses DNS records (TXT or CNAME) on a sending domain. SES Easy DKIM uses CNAMEs per region, built from `SigningHostedZone`, and a custom MAIL FROM needs an MX record for the region-specific feedback endpoint. The other providers' DKIM docs were not fetched; the effort is comparable (2–4 records plus SPF include plus DMARC).

---

## 3. Per-provider evidence

### Resend
- **Pricing**: https://resend.com/pricing. Free: 3,000/mo, "The Free plan is limited to 100 emails per day". Pro $20/mo for 50,000 and $35/mo for 100,000, overage $0.90/1k. Scale from $90 (100k). Dedicated IP $30/mo on Scale only, and only above 3,000/day. Retention 30 days. Domains: Free 3, Pro 10. Confidence: high.
- **Regions**: https://resend.com/docs/dashboard/domains/regions. Sending regions are us-east-1, eu-west-1, sa-east-1 and ap-northeast-1. The region "does not control where customer data is stored"; account data incl. "email metadata, logs, and API records" is kept in the US "regardless of the sending region you select". Confidence: high.
- **DPA**: https://resend.com/legal/dpa and https://resend.com/security/gdpr (via search). A pre-signed Art. 28 DPA, EU SCCs (Decision 2021/914, Module Two) and UK SCCs, plus EU-US DPF participation. Confidence: medium-high (the full text was not opened).
- **Idempotency**: https://resend.com/docs/dashboard/emails/idempotency-keys. `Idempotency-Key` header (`Resend-Idempotency-Key` for SMTP), kept "for **24 hours**", 1–256 chars. A duplicate returns the same response. 409 `invalid_idempotent_request` / `concurrent_idempotent_requests`. Confidence: high.
- **API and limits**: https://resend.com/docs/api-reference/introduction. "The default maximum rate limit is 10 requests per second per team"; 429 when exceeded. Confidence: high.
- **Webhooks**: https://resend.com/docs/dashboard/webhooks/event-types (11 email event types incl. bounced, complained, delivered, suppressed) and https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests (Svix headers, raw body required). Confidence: high.
- **Python SDK**: https://pypi.org/pypi/resend/json, version 2.56.0, repo github.com/resendlabs/resend-python.

### Postmark
- **Pricing**: https://postmarkapp.com/pricing. 10k/mo costs Basic $15.00 (overage $1.80/1k), Pro $16.50 ($1.30), Platform $18.00 ($1.20). Developer tier is 100/mo with no overage. Dedicated IP from $50/mo at ≥300k/mo on Pro+. Retention 45 days by default. **The 50k figures are computed** from base + overage, not listed. Confidence: high (the computation is mine).
- **EU**: https://postmarkapp.com/euprivacy and https://postmarkapp.com/support/article/1218-gdpr-faq (via search). Primary DC outside Chicago plus AWS, "no current plans" for EU servers. SCCs are signed together with the DPA. Confidence: high.
- **API and test mode**: https://postmarkapp.com/developer/user-guide/send-email-with-api. `POSTMARK_API_TEST` token. Batch of 500 messages / 50 MB. No idempotency documented. Confidence: high.
- **Webhooks**: https://postmarkapp.com/developer/webhooks/webhooks-overview. "Postmark does not currently support HMAC webhook signature verification". Basic auth in the URL plus IP allowlisting. Retries at 1, 5, 10, 10, 10, 15 min; an event type is disabled after 48 h of failures. Dedupe by `MessageID` / `X-PM-Webhook-Trace-Id`. Confidence: high.

### Amazon SES (eu-central-1)
- **Pricing**: https://aws.amazon.com/ses/pricing/. À la carte is "$0.10 per 1,000 emails" plus $0.12/GB attachments, "no minimum fees". New plan tiers: Essentials $0.16/1k, Pro $0.22/1k + $105/mo per region, Enterprise $0.23/1k + $500/mo. Free tier is only AWS credits ("up to $200", 6 months). Dedicated IP $24.95/mo; managed IPs $15/mo + $0.08/1k. Confidence: high.
- **Sandbox**: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html. Verified recipients only, "maximum of 200 messages per 24-hour period", "1 message per second". Sandbox status is per region. AWS Support gives "an initial response to your request within 96 hours". The request needs a website URL and an acknowledgement of bounce/complaint handling. Confidence: high.
- **Regionality**: https://docs.aws.amazon.com/ses/latest/dg/regions.html. Identities, Easy DKIM, the suppression list, SNS topics and SMTP credentials are all per region. The eu-central-1 endpoint itself was not fetched; it is listed in https://docs.aws.amazon.com/general/latest/gr/ses.html. Confidence: high for regionality, medium for the endpoint name.
- **Events**: https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html. Configuration sets publish Send, RenderingFailure, Reject, Delivery, Bounce, Complaint, DeliveryDelay, Subscription, Open and Click to CloudWatch, Firehose, Pinpoint, SNS or EventBridge. A webhook into FastAPI means an SNS HTTPS subscription (confirmation handshake plus SNS message signature verification). Confidence: high.

### Mailgun (EU)
- **Pricing**: https://www.mailgun.com/pricing/. Free $0 at 100/day with 1-day logs. Basic $15 for 10k (overage from $1.80) with "No daily email limit". Foundation $35 for 50k (overage from $1.30, 5-day logs). Scale $90 for 100k (30-day logs). Dedicated IP: the FAQ says one is included from Foundation 100k, extra IPs $59/mo. Confidence: high. A competitor claims the permanent free plan was removed; Mailgun's page still shows it.
- **EU residency and API**: https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview. Base URL `https://api.eu.mailgun.net/`. "message data never leaves the region in which it is processed"; account metadata, users, billing and API keys are replicated globally. Rate limits are `/messages` 80,000 calls/10 s, others 300 req/s, with `X-RateLimit-*` headers. Confidence: high.
- **Webhooks**: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks. "Hex-encoded HMAC-SHA256 of `timestamp + token`, keyed with your Webhook Signing Key", with a token-reuse replay check. Confidence: high.
- **SDK**: https://pypi.org/pypi/mailgun/json, version 1.10.0 (2026-10-21), "the official Python SDK for Mailgun". Confidence: high.
- **Region choice**: a domain's region cannot be changed after creation (third-party guide via search). Confidence: medium.

### Brevo
- **Free tier**: 300/day, transactional included (multiple sources plus brevo.com/features/email-api title "300 emails/day to start"). Confidence: medium-high.
- **Paid**: **UNVERIFIED.** https://www.brevo.com/pricing/ returned only its title, and help.brevo.com returned 403. Third-party figures: $15/mo for 20k (Moosend, mid-2025), "from $9/mo" Starter (2026 review), 60k $55 (comparison). Credits work for both marketing and transactional mail.
- **Residency**: https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location (via search). Servers in the EU, OVH in France/Germany, Google Cloud in Belgium. A third-party claim of a US transactional path (https://scan.meetergo.com/en/vendors/brevo-sending) is unconfirmed; check the sub-processor list. Confidence: medium.
- **Idempotency**: https://developers.brevo.com/docs/heterogenous-versions-batch-emails and the 2021 changelog (via search). `idempotencyKey`; a duplicate within 30 min returns `duplicate_parameter`. Placement is ambiguous (body `headers` object vs HTTP header). Confidence: medium.

### MailerSend
- **Pricing**: https://www.mailersend.com/pricing. Free 500/mo (1 domain, 1 template, 1 webhook, 100 API requests/day, 1-day retention). Hobby $7/mo for 5k (overage $1.50). The Starter/Professional price fields were blank. https://www.mailersend.com/help/plans-features-and-limits (via search): Starter $35/mo ($31.50 yearly) for 50k, overage from $1.30. Confidence: medium; the figures conflict.
- **Residency**: https://www.mailersend.com/legal/security-statement (via search). Hosted in "a certified data storage center located in the European Union"; DPF; DPA at https://www.mailersend.com/legal/data-processing-addendum. Confidence: medium.
- **Webhooks**: https://www.mailersend.com/help/webhooks. Delivery, soft/hard bounce and spam complaint events; a "secret webhook key" (scheme not on the page); retries at 10 s and 100 s with a 3 s timeout. Confidence: medium.

### Mailjet
- **Pricing**: https://www.mailjet.com/pricing/. Free 6,000/mo at 200/day with APIs, SMTP and webhooks. Essential and Premium are $17.10 and $26.10/mo billed annually for 15k. https://documentation.mailjet.com/hc/en-us/articles/13710460449563 (via search): overage on Essential 15k is €2.31/1k, on Essential 50k €1.39/1k. Overage cannot be switched off. Confidence: medium.
- **Residency**: https://documentation.mailjet.com/hc/en-us/articles/360042712274 (via search). Data stored "exclusively within the European Union", Google Cloud Frankfurt and Saint-Ghislain. The Sinch privacy policy says hosting depends on the selected deployment region. Confidence: medium-high.

### Scaleway Transactional Email
- **Access**: every scaleway.com page fetched returned **403**. The figures below come from search snippets of Scaleway's own pricing and docs pages (https://www.scaleway.com/en/pricing/managed-services/, https://www.scaleway.com/en/docs/transactional-email/reference-content/tem-capabilities-and-limits/, https://www.scaleway.com/en/docs/transactional-email/faq/). Confidence: medium.
- **Price**: Essential has 300 free/mo per organisation, then +€0.25/1k pay-as-you-go, 5 domains. Scale €80/mo with 100k included, then €0.20/1k, dedicated IP and 99.9% SLA.
- **Residency**: only the fr-par region; "whole stack managed by Scaleway within the EU, with no non-EU sub-processors" (FAQ).
- **Limits**: default 10,000/mo (an older doc said 500/5,000), no hourly quota since 2023-12-01. Raises go through support after payment and identity validation.
- **Webhooks**: https://www.scaleway.com/en/docs/transactional-email/how-to/create-webhooks. v1alpha1 **beta**, quota on request, delivered via Scaleway Topics & Events (SNS ARN).

### SendGrid (Twilio)
- **Pricing**: https://www.twilio.com/en-us/products/email-api/pricing. Free is "$0/mo for 60 days" at 100/day. Essentials from $19.95/mo, Pro from $89.95/mo (1 dedicated IP). The price per volume tier was not shown. Confidence: high for the listed figures.
- **EU residency**: https://www.twilio.com/en-us/blog/products/data-residency-for-email-eu and https://www.twilio.com/docs/sendgrid/data-residency/faq (via search). "available … on Pro and Premier Packages"; shared-IP customers must upgrade; needs an EU dedicated IP and an EU subuser. Confidence: medium-high.

### SMTP2GO (optional)
- https://www.smtp2go.com/pricing/. Free 1,000/mo. Starter $10/mo for 10k (+$1/1k, 30-day reports). Professional $75/mo for 100k (dedicated IP, $0.85/1k). EU data location not checked. Confidence: high for the prices.

### EmailLabs (Polish, optional)
- https://emaillabs.io/en/pricing/. Startup €0 up to 9,000/mo (300/day), 1-day logs. Essential 30 at €23 (promo for 3 months) / €29, "Up to 100 000 emails per month" (conflicts with the plan name). PRO 100 at €69 promo / €115 with a dedicated IP and 15-day logs. Overage €1.02/1k on PRO. Servers in "CEE (Beyond Data Center)", processing in the EEA. Vercom S.A., Poznań. The trial without company details is limited to test addresses at 100/day. A DPA is not mentioned on the page. Confidence: medium.

### Deliverability reputation (weak evidence)
- https://www.smtp2go.com/blog/best-transactional-email-services/ (via search) cites an EmailTooltester 2026 test (4 rounds, GlockApps seeds) in which Postmark averaged **93.8%** inbox placement and SMTP2GO 95.5%. The source is a competitor, so treat it as directional only.
- https://mailtrap.io/blog/email-deliverability-comparison/ (vendor test, June 2026) had no per-provider numbers in the snippets.
- No 2026 numbers were found for SES, Brevo, Mailgun or Resend. At this volume, deliverability will depend mostly on our own SPF/DKIM/DMARC alignment, content and complaint rate on shared IPs. A seed test on our own domain before go-live is advisable.
