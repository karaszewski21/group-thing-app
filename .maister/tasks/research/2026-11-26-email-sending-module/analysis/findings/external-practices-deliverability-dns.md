# External practices — deliverability, DNS, headers

All sources accessed 2026-11-26. Aligned with `external-providers-recommendation.md` (Mailgun EU default, Brevo/Scaleway/Resend alternatives); records below are provider-neutral with placeholders.

## TL;DR
- At aj's scale (~1k–10k/month, far below 5,000/day to Gmail or Outlook) the *bulk-sender* tier does not apply, but publish SPF **and** DKIM **and** DMARC with alignment anyway: it is cheap, Microsoft and Google recommend it for everyone, and Google's bulk status is permanent once crossed (subdomain volume counts toward the parent).
- Send from a dedicated subdomain (e.g. `mail.<domain>`) with the provider's DKIM key (2048-bit), a custom Return-Path/bounce domain on the same subdomain (SPF alignment), and a DMARC record ramped `p=none` (≥1 week, with `rua`) → `quarantine` → `reject`.
- One-click unsubscribe (RFC 8058) is required only for "marketing and subscribed" mail. Transactional mail (password reset, reservation confirmation) is exempt. aj's optional notification mail (new message, want match, digests) counts as "subscribed", so it should carry `List-Unsubscribe` + `List-Unsubscribe-Post`.
- Warm-up at this volume is mostly just "start small and engaged": a new subdomain has no reputation even on a warm shared IP. Watch Google Postmaster Tools; keep spam rate < 0.1% (never ≥ 0.3%).
- DMARC is now RFC 9989 (May 2026, obsoletes RFC 7489): `pct` is deprecated in favour of `t=y`, and there is a new `np` tag. Many receivers still read `pct`, so use both during the ramp.

## Key Decisions
- Use a sending subdomain, not the apex — this isolates reputation from any human mailbox on the apex and lets the apex DMARC be stricter later. Customer.io notes the subdomain is "always new" to inbox providers, so it needs its own gentle start.
- Comply with the bulk-sender rules from day one even though aj is under the threshold. The cost is a few DNS records, and it avoids a cliff if a large group term reminder ever spikes volume. Google's bulk status is sticky.
- Classify every email stream as `transactional` or `notification` in code. Only `notification` gets the List-Unsubscribe headers and a footer link. Transactional mail gets neither, so a click cannot suppress a password reset.
- Keep Mailpit (`axllent/mailpit`) as a dev-only compose service. It checks List-Unsubscribe syntax, HTML compatibility and links, and it has a chaos mode for SMTP errors.

## Open Questions / Risks
- **Domain choice.** The apex domain is unknown. Is it the brand domain (`gooo`?) or something else? Placeholders are used here.
- **Apex DMARC.** If the apex already has a DMARC record with `sp=reject` and no record on the subdomain, then the subdomain inherits that policy. Publish an explicit `_dmarc.mail.<domain>` record.
- **Microsoft rejection date.** Microsoft says non-compliant high-volume mail goes to Junk since 5 May 2025, with rejection (550 5.7.515) at an unannounced future date. Mailgun's blog claimed rejection started on 5 May, so the sources conflict. This matters only above 5k/day.
- **`t=` tag support.** RFC 9989 `t=` adoption among receivers is uneven (vendor reports). This is medium confidence. Keep `pct` during the ramp.
- **Domain reputation in Postmaster Tools.** Customer.io says the v1 domain-reputation metric is being retired. Check which metrics Postmaster Tools v2 shows.

---

## 1. Mailbox-provider sender rules

### Finding 1.1: Gmail — all senders vs bulk (≥ ~5,000/day to personal Gmail)
**Source**: https://support.google.com/a/answer/81126 ; FAQ https://support.google.com/a/answer/14229414
**Evidence**:
- All senders need SPF **or** DKIM, valid forward and reverse DNS (PTR), TLS, RFC 5322 format, a spam rate below 0.3%, and must not impersonate Gmail From: headers. Unsubscribe is "recommended".
- Bulk senders need SPF **and** DKIM **and** DMARC (`p=none` allowed), with the From: domain "aligned with either the SPF domain or the DKIM domain". "Marketing messages and subscribed messages must support one-click unsubscribe, and include a clearly visible unsubscribe link in the message body."
- "Keep spam rates reported in Postmaster Tools below 0.10% and avoid ever reaching a spam rate of 0.30% or higher." The DKIM key must be ≥1024 bits, and 2048 is recommended.
- FAQ: "Senders who meet the above criteria at least once are permanently considered bulk senders." Messages from subdomains are summed with the primary domain (the example is 2,500 + 2,500 = bulk).
- FAQ: "Starting November 2025, Gmail is ramping up its enforcement on non-compliant traffic". Non-compliant mail may face temporary or permanent rejection.
- FAQ: one-click unsubscribe is "required only for marketing and promotional messages". Password resets and reservation confirmations are given as transactional examples. Unsubscribes should be honoured within 48 h.
- FAQ: with no DMARC record, or only `p=none`, "delivery support or mitigation" is unavailable.

**Context**: aj will not reach 5k/day (it plans 1k–10k per month). The all-senders tier applies, and PTR and TLS are handled by the provider. Still, a `p=none` DMARC record forfeits Google's delivery support, which argues for ramping to enforcement.
**Confidence**: High (official, fetched).

### Finding 1.2: Yahoo — same shape, adds a 2-day unsubscribe deadline and stream separation
**Source**: https://senders.yahooinc.com/best-practices/
**Evidence**:
- All senders: "Implement SPF or DKIM at a minimum", spam rate < 0.3%, valid forward and reverse DNS, RFC 5321/5322.
- Bulk senders: SPF and DKIM; "Publish a valid DMARC policy with at least p=none - DMARC must pass"; `rua` strongly recommended; relaxed alignment OK; one-click List-Unsubscribe for "marketing and subscribed messages" (RFC 8058 POST highly recommended, mailto acceptable); "Honor unsubscribes within 2 days."
- "Don't send bulk/marketing email from the same IPs you use to send user mail, transactional mail, alerts, etc."

**Confidence**: High.
**Conflict**: Gmail says 48 h and Yahoo says 2 days, so they are the same in effect. aj should apply unsubscribes immediately (synchronously in the POST handler).

### Finding 1.3: Microsoft Outlook.com consumer domains (since 5 May 2025)
**Source**: https://techcommunity.microsoft.com/blog/outlook/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730
**Evidence**: The rules apply to domains "sending more than 5,000 emails per day" to outlook.com, hotmail.com and live.com. They require SPF pass, DKIM pass and DMARC at least `p=none`, aligned with SPF or DKIM. "After May 5th, 2025, Outlook will begin routing messages" that fail to Junk; "in the future (date to be announced), non-compliant messages will be rejected" (550 5.7.515). Recommended for all senders: a working opt-out link, a valid From/Reply-To that can receive replies, list hygiene, and no deceptive subjects.
**Confidence**: High for the threshold and the Junk routing. Medium for rejection timing, because Mailgun's blog (https://www.mailgun.com/blog/deliverability/microsoft-sender-requirements/) says rejection started immediately.
**Implication**: The From/Reply-To address should be a real mailbox, or at least not a bounce black hole. Avoid a bare `noreply@`, or send `Reply-To` to a monitored support address.

## 2. DMARC alignment on a subdomain and the policy ramp

### Finding 2.1: DMARC standard is now RFC 9989
**Source**: https://www.rfc-editor.org/info/rfc9989 (Proposed Standard, May 2026, obsoletes RFC 7489 and RFC 9091). Tag changes are summarised by vendors: https://powerdmarc.com/dmarcbis-rfc-update/ , https://easydmarc.com/blog/forget-dmarcbis/
**Evidence**: `pct`, `rf` and `ri` are deprecated. `t=y` (testing) is the closest replacement for partial enforcement, and `pct=1–99` has no direct equivalent. `np=` sets the policy for non-existent subdomains. A DNS tree walk replaces the Public Suffix List for finding the organizational domain. Aggregate reports are specified in RFC 9990.
**Confidence**: High that RFC 9989 exists and obsoletes RFC 7489 (rfc-editor). Medium on the exact tag semantics (vendor summaries; the RFC body was not read in full).

### Finding 2.2: Google's recommended rollout
**Source**: https://knowledge.workspace.google.com/admin/security/recommended-dmarc-rollout
**Evidence**: "Set up DKIM and SPF at least 48 hours before setting up DMARC." Then `p=none` for about a week ("One week is usually enough time"), reviewing reports daily. Then `quarantine` on a small percentage, then "gradually increase the percentage over time to cover 100% of messages", with reject optional. Example `rua=mailto:dmarc@example.com`.
**Confidence**: High.

### Finding 2.3: Alignment mechanics (relaxed)
**Source**: RFC 9989 / RFC 7489 §3.1 (https://www.rfc-editor.org/rfc/rfc7489#section-3.1), Yahoo page above ("relaxed alignment is acceptable"), Gmail guidelines.
**Evidence/Context**: With relaxed alignment (the default `adkim=r` / `aspf=r`), `From: …@mail.<domain>` aligns with a DKIM `d=mail.<domain>` (or `d=<domain>`) and with an envelope MAIL FROM `bounce.mail.<domain>`, because they share the organizational domain. DKIM alignment is the one that survives forwarding, so make the DKIM `d=` your domain, never the provider's shared domain. SPF alignment additionally needs the provider's "custom return-path / tracking domain" feature (Mailgun puts the envelope on the sending domain itself; the matrix has per-provider details).
**Confidence**: High.

## 3. DNS record checklist template (placeholders only)

Replace `<domain>`, `<provider-…>` and the key values with what the provider dashboard shows. Do not commit real DKIM selectors or keys if they are considered sensitive. They are public DNS, but keep them out of reports anyway for consistency.

| # | Host | Type | Value (template) | Purpose / notes |
|---|------|------|------------------|-----------------|
| 1 | `mail.<domain>` | TXT | `v=spf1 include:<provider-spf-include> ~all` | SPF for the envelope domain. Use one SPF record per name, ≤10 DNS lookups, `~all` while testing and `-all` once stable. For Mailgun EU the include is the one shown in the EU domain setup. |
| 2 | `<selector>._domainkey.mail.<domain>` | TXT (or CNAME to provider) | `k=rsa; p=<provider-public-key>` | DKIM. Use 2048-bit if offered (Google recommends it, minimum 1024). Some providers use 2 CNAMEs for key rotation. |
| 3 | `mail.<domain>` | MX | `<provider-mx-1>` (prio 10), `<provider-mx-2>` (prio 10) | Needed when the provider handles bounces/replies on the subdomain (Mailgun: required for its bounce handling). |
| 4 | `<tracking-or-return-path>.mail.<domain>` | CNAME | `<provider-tracking-host>` | Optional. A custom return-path / tracking domain improves SPF alignment. Disable open/click tracking for transactional mail (privacy, plus link rewriting looks phishy). |
| 5 | `_dmarc.mail.<domain>` | TXT | Phase A: `v=DMARC1; p=none; rua=mailto:<dmarc-reports-mailbox>; adkim=r; aspf=r` | Start ≥48 h after SPF/DKIM pass. Watch reports for ≥1 week. |
| 5b | same | TXT | Phase B: `v=DMARC1; p=quarantine; pct=25; t=y; rua=mailto:<…>` → raise to `pct=100`, drop `t` | `pct` for RFC 7489 receivers, `t=y` for RFC 9989 ones. Step up weekly while reports are clean. |
| 5c | same | TXT | Phase C: `v=DMARC1; p=reject; rua=mailto:<…>` | The final state. Gmail offers delivery support only with an enforcing policy. |
| 6 | `_dmarc.<domain>` (apex) | TXT | `v=DMARC1; p=none; sp=<…>; np=reject; rua=mailto:<…>` | Make sure an apex record exists. `np=reject` blocks spoofing of non-existent subdomains, and `sp` must not undercut the subdomain record. Ramp the apex separately if it carries human mail. |
| 7 | report mailbox | — | If `rua` points to a different domain, that domain must publish `<domain>._report._dmarc.<report-domain>` TXT `v=DMARC1` | RFC 7489 §7.1 external report authorization. Or use a free aggregator (Postmark DMARC digests, dmarcian, EasyDMARC free tier). |
| 8 | Google Postmaster Tools | TXT (verification) | `google-site-verification=<token>` | Register the sending subdomain to see spam rate and authentication results. Data shows up only once volume is meaningful (roughly hundreds per day). |
| 9 | (provider) | PTR | provider-managed | PTR and TLS on shared IPs are the provider's job. Verify with a seed test. |

Verification before go-live: send to Mailpit for structure, then to a seed (`mail-tester.com` or a Gmail and an Outlook.com test account) and check `Authentication-Results: spf=pass dkim=pass dmarc=pass` with `header.from=mail.<domain>`.

## 4. Header checklist

| Header | Transactional | Notification / digest (opt-out-able) | Source |
|---|---|---|---|
| `From: "aj" <powiadomienia@mail.<domain>>` (display name encoded per RFC 2047 if it has diacritics) | yes | yes | Gmail RFC 5322 rule; Python `EmailPolicy` encodes automatically (see compliance-engineering file) |
| `Reply-To:` monitored support address, or the counterpart's relay if replies are a feature | recommended | recommended | Microsoft recommendation (1.3) |
| `Message-ID: <uuid@mail.<domain>>`, `Date:` | yes (provider usually sets them) | yes | RFC 5322 |
| `MIME-Version`, `multipart/alternative` with text/plain + text/html, UTF-8 | yes | yes | best practice; Mailpit HTML check |
| `List-Unsubscribe: <https://<app-domain>/api/email/unsubscribe/<signed-token>>, <mailto:unsubscribe+<token>@mail.<domain>>` | **no** | **yes** | RFC 2369 syntax, RFC 8058 |
| `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | **no** | **yes** | RFC 8058 |
| DKIM `h=` covering `From`, `Subject`, `List-Unsubscribe`, `List-Unsubscribe-Post` | yes | **must** cover both List-* headers | RFC 8058 §3 — providers sign added headers; verify in Mailpit/seed |
| `List-Id:` (e.g. `<notifications.mail.<domain>>`) | optional | recommended | RFC 2919; helps filtering |
| `Auto-Submitted: auto-generated` | yes | yes | RFC 3834; suppresses auto-replies/out-of-office loops |
| `X-Entity-Ref-ID` / provider tag (`o:tag`, `X-Mailgun-Tag`) with the stream name | yes | yes | stream separation in provider analytics |
| No open/click tracking pixels or link rewriting | yes | preferably | privacy (GDPR minimisation) and phishing heuristics |

### Finding 4.1: RFC 8058 one-click requirements
**Source**: https://www.rfc-editor.org/rfc/rfc8058
**Evidence**: "The List-Unsubscribe-Post header MUST contain the single key/value pair "List-Unsubscribe=One-Click"." "The List-Unsubscribe header MUST contain one HTTPS URI." "The List-Unsubscribe and List-Unsubscribe-Post headers MUST be covered by the signature." "The POST request MUST NOT include cookies, HTTP authorization, or any other context information." "The mail sender MUST NOT return an HTTPS redirect." The body is `multipart/form-data` or `application/x-www-form-urlencoded`.
**Implications for aj**:
- The token in the URI must identify the recipient and the stream on its own, without a login. Use a signed, non-guessable token (an HMAC/JWT under a purpose key derived from `JWT_SECRET`, like `aj_google_nonce`, or a random token in a table).
- The endpoint must be a PUBLIC POST that answers 200/202 directly with no redirect, accepts form encoding, and is idempotent (repeat POSTs give the same result). RFC 8058 says nothing about idempotence, so this is our own requirement.
- A GET on the same URL (a user clicking in a client that opens it) should show a confirmation page and not unsubscribe on GET, because link scanners prefetch GETs. In aj this is a Next.js page under a new reserved slug, plus a backend PUBLIC POST row in `AUTHORIZATION_MATRIX`, outside `/api/public/` like rows 72/73, or under `/api/public/`.
- An nginx/Next rewrite must not turn the POST into a redirect.

**Confidence**: High.

### Finding 4.2: RFC 2369 syntax and scope
**Source**: https://www.rfc-editor.org/rfc/rfc2369
**Evidence**: URLs in angle brackets, comma-separated, "order of preference from left to right". "These fields MUST only be generated by mailing lists, not end users."
**Context**: Notification streams behave like a list in the mailbox providers' view ("subscribed messages"). Put the HTTPS URI first and `mailto:` second (optional; it needs inbound mail routing at the provider, e.g. Mailgun Routes, so it can be skipped in the MVP since only HTTPS is mandatory).
**Confidence**: High.

## 5. Warm-up at low volume

### Finding 5.1
**Sources**: https://docs.customer.io/messaging/channels/email/deliverability/domain-warming/ ; https://mailchimp.com/resources/ip-warming/ ; https://help.mailgun.com/hc/en-us/articles/1260803448249-How-do-I-warm-up-my-IP- ; https://learn.microsoft.com/en-us/dynamics365/customer-insights/journeys/warmup-process-email-marketing
**Evidence**:
- Domain reputation is tracked separately from IP reputation. A new (sub)domain should ramp up even on warm shared IPs.
- Lower-volume senders benefit from shared IPs, so there is no dedicated IP at aj's scale.
- Set up Postmaster Tools before warm-up and stop if reputation drops to Low/Bad. Switching domains mid-warm-up resets progress.
- Microsoft says reaching full deliverability takes 4–8 weeks.

**Practical plan for aj**: Week 1 sends only transactional mail (verification, reset, reservation confirmations), which is naturally low and highly engaged. Then enable notification streams group by group. Never start with a bulk backfill such as "announce email notifications to all users". Keep a daily cap in the app (e.g. `EMAIL_DAILY_CAP`) for the first weeks, matching the Mailgun free tier of 100/day.
**Confidence**: Medium. These are vendor sources, and no Google-authored warm-up guidance was found.

## 6. Bounce, complaint and suppression handling (deliverability side)
- Treat permanent failures (SMTP 5.x.x per RFC 3463, provider `failed`/`permanent`) and complaints (FBL `complained`) as hard suppression of the address. Treat temporary 4.x.x as provider-retried, and suppress only after N consecutive soft bounces (e.g. 3 in 7 days). Gmail does not run a classic FBL for most senders, so the Postmaster spam rate is the signal there.
- Mirror the provider's suppression list in our DB (`email_suppressions(address_normalized, reason, source, created_at)`). The provider list is region-scoped and logs expire quickly (Mailgun keeps 1–5 days of logs per the provider recommendation). Check it before every send so a provider swap does not resend to bad addresses.
- A complaint on a notification stream should also turn off that user's notification email preference (Yahoo/Gmail treat complaints like unsubscribes). A complaint on transactional mail suppresses only non-essential mail. Password reset should still be attempted only on explicit user request, to keep account recovery possible.
- Webhooks must be signature-verified (see provider recommendation).
- Sources: Gmail spam-rate rules (1.1), Yahoo (1.2), Microsoft list hygiene (1.3); RFC 3463 https://www.rfc-editor.org/rfc/rfc3463 . Confidence: High for the principles, medium for the exact soft-bounce threshold (a common industry heuristic, not a standard).

## 7. Local testing — Mailpit
**Source**: https://github.com/axllent/mailpit ; https://hub.docker.com/r/axllent/mailpit
**Evidence**: Image `axllent/mailpit`. SMTP on 1025 and web UI on 8025 by default. REST API "for integration testing". HTML client-compatibility check, link check, SpamAssassin/Rspamd spam check, "chaos" configurable SMTP errors, List-Unsubscribe syntax validation. Prunes to 500 messages by default.
**Compose sketch** (dev override only, never in the production compose):
```yaml
  mailpit:
    image: axllent/mailpit:<pinned-version>
    ports: ["8025:8025"]          # UI on host; SMTP stays on the compose network (mailpit:1025)
    profiles: ["dev"]
```
**Caveat**: If the production adapter is HTTP-API-only (as recommended), Mailpit needs a second `SmtpEmailSender` adapter selected by `EMAIL_BACKEND=smtp` in dev. Alternatively, test with a fake in-memory sender (pytest) and use Mailpit only for visual/manual checks. Mailpit's env var names were not verified because the docs site (mailpit.axl.dev) failed DNS resolution during this session.
**Confidence**: High for ports, image and features. Low for env var names (unverified).
