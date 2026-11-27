# External practices — compliance (RODO/PKE) and engineering (templates, idempotency, digests, retention)

All sources accessed 2026-11-26. This is not legal advice. Where a finding is a legal interpretation, it is marked as such.

## TL;DR
- Polish e-mail consent rules now live in **art. 398 PKE** (Dz.U. 2024 poz. 1221, in force 10 Nov 2024). **art. 10 UŚUDE was repealed** by art. 26 pkt 3 of the PKE introductory act (Dz.U. 2024 poz. 1222). Art. 398 requires prior consent only for **commercial information / direct marketing**. Service mail (account, reservations, messages, a want the user created) is not commercial information, so it needs no PKE consent.
- The GDPR basis is art. 6(1)(b) (contract performance) for transactional and requested-service mail. Optional notification mail can rest on 6(1)(b) or 6(1)(f) with an easy opt-out. Promotional or re-engagement mail needs PKE consent (GDPR standard, per channel), and the art. 21 objection right applies.
- Engineering: the outbox is at-least-once, so the email consumer must be idempotent (a send-log row with a unique key claimed before the provider call, and the provider idempotency key set to the same id where supported). Use Jinja2 with explicit autoescape and `StrictUndefined`, plus a text/plain twin. MJML is optional (Node-only officially). Python/JSON APIs handle the RFC 2047/UTF-8 encoding of Polish diacritics.
- Digests: transactional and time-critical mail bypasses batching. Chat-like events (new message) are delayed and coalesced, and sent only if still unread. Want matches and group activity suit a daily digest. All windows are computed on the Europe/Warsaw clock.

## Key Decisions
- Do not ask for a "consent to e-mail notifications" checkbox at registration. The registration consent belongs to marketing only, and aj sends none. Notification e-mail is a service feature with per-type preferences and an opt-out link. Rationale: art. 398 PKE scope is commercial information; GDPR 6(1)(b)/(f) covers the rest. Bundling consent would also make it non-free (GDPR art. 7(4)).
- Treat any mail that promotes things the user did not ask about ("new items near you", "we miss you", newsletters) as marketing: it needs separate, unticked, per-channel consent, recorded with a timestamp and text version. Keep it out of the MVP.
- Send log: store metadata only (no rendered body). Keep 90 days for operations and keep suppressions until erased. Rationale: GDPR art. 5(1)(c)/(e) minimisation and storage limitation, while suppression must outlive the send log to honour opt-outs.
- Idempotency key = `sha256(outbox_event_id + recipient_party_id + template)` or the send-log UUID, unique in the DB and passed to the provider when supported.

## Open Questions / Risks
- **Want-match mail is a grey zone** (legal interpretation). It promotes other users' listings, but the user explicitly requested it by creating a want. Low risk if it is sent only for the user's own active wants, with an opt-out. Unsolicited "suggestions" (SUGGESTION/SIMILAR tiers) are closer to marketing, so keep them in-app only or ask for consent. Owner and lawyer to confirm.
- **No UODO guidance found** specifically on transactional vs notification e-mail. The 6(1)(b) position comes from GDPR text, recital 47 and secondary commentary. A 2025 UKE letter (23 Sep 2025) on art. 398/421/423 is referenced in a Sejm interpellation answer but was not read: https://api.sejm.gov.pl/sejm/term10/interpellations/attachment/ATTDMGHNP/i12337-o1.pdf
- **Family/guardian accounts**: e-mail to minors' addresses or about minors should go to the guardian. The legal basis is the guardian's contract. Not researched further.
- The privacy notice (art. 13 RODO) must be updated to name the e-mail provider as processor (and any US transfer if Resend or Postmark is chosen).

---

## 1. Polish law — Prawo komunikacji elektronicznej (PKE)

### Finding 1.1: art. 398 PKE is the consent rule for commercial e-mail
**Source**: https://arslege.pl/prawo-komunikacji-elektronicznej/k2200/a152400/ (text of art. 398); https://www.prawo.pl/biznes/zgody-marketingowe-i-kontakty-handlowe-co-mowi-prawo-komunikacji-elektronicznej,530981.html
**Evidence**: Ust. 1 prohibits using automated calling systems or telecommunications terminal equipment (incl. via interpersonal communication services) to send commercial information, including direct marketing, to a subscriber or end user, "chyba że uprzednio wyraził on na to zgodę". Ust. 2: consent can be given by providing an electronic address for that purpose. Ust. 4: breach "stanowi czyn nieuczciwej konkurencji". PKE "obowiązuje od 10 listopada 2024 r." The UKE President fines breaches of art. 398, up to 3% of revenue (per prawo.pl), and art. 448 makes it a petty offence.
**Confidence**: High (statute text via a legal database, consistent across sources).

### Finding 1.2: art. 10 UŚUDE was repealed, so the old dual regime (UŚUDE art. 10 + PT art. 172) is gone
**Source**: consolidated text of UŚUDE, Dz.U. 2024 poz. 1513: https://api.sejm.gov.pl/eli/acts/DU/2024/1513/text.html
**Evidence**: Art. 10 ("Zakazane jest przesyłanie niezamówionej informacji handlowej skierowanej do oznaczonego odbiorcy…") is shown in force until the change in footnote 9, then "(uchylony)". Footnote 9: "Przez art. 26 pkt 3 ustawy" (the Przepisy wprowadzające PKE, Dz.U. 2024 poz. 1222), which takes effect 10 Nov 2024. The Prawo telekomunikacyjne itself was repealed by the PKE package (https://www.ifirma.pl/blog/prawo-komunikacji-elektronicznej-juz-opublikowane-nowe-zasady-zgod-marketingowych-w-2024-roku/).
**Confidence**: High for the repeal of art. 10 UŚUDE (official consolidated-text footnote). Medium on the exact PT repeal provision (secondary source).
**Conflict**: Pre-enactment commentary (ifirma) treated art. 10 UŚUDE as remaining in force. The official consolidated text shows it repealed. Prefer the official text.

### Finding 1.3: consent standard and per-channel requirement
**Source**: ifirma (above); Grant Thornton summary https://grantthornton.pl/publikacja/prawo-komunikacji-elektronicznej-a-ochrona-danych-osobowych/ ; Wolters Kluwer https://www.wolterskluwer.com/pl-pl/expert-insights/jak-prowadzic-dzialania-marketingowe-zgodnie-z-rodo
**Evidence**: Art. 400 PKE applies the GDPR consent standard: voluntary, specific, informed and unambiguous, withdrawable as easily as it was given. Consent is required "w zakresie każdego kanału komunikacyjnego". Consent is not needed where the client initiated the contact. The subject is now "abonent lub użytkownik końcowy", which may include legal persons.
**Confidence**: Medium (secondary sources; art. 400 text not fetched).

### Finding 1.4 (interpretation): service notifications are not "informacja handlowa"
**Reasoning**: Commercial information is information meant to promote, directly or indirectly, goods, services or the image of an enterprise (the classic UŚUDE art. 2 pkt 2 definition, which PKE art. 398 refers to). A reservation confirmation, a new-message alert, a term reminder for a term the user RSVP'd, or an account e-mail does not promote. It performs the service. Secondary commentary agrees: "E-mail transakcyjny (potwierdzenie, status wysyłki, faktura) jest niezbędny do wykonania umowy (art. 6 ust. 1 lit. b). Marketing w tym samym mailu — wymaga zgody." (https://www.legiscope.com/blog/rodo-ecommerce-sklepy-internetowe.html)
**Risk**: Adding promotional blocks ("check out these items", "invite friends") to a service e-mail turns it into commercial information. Keep templates free of promotion.
**Confidence**: Medium (legal interpretation, no UODO/UKE guidance found).

## 2. GDPR (RODO) lawful basis

### Finding 2.1
**Sources**: GDPR art. 6(1)(b)/(f), art. 7(4), art. 21(2)–(3), recital 47 — https://eur-lex.europa.eu/eli/reg/2016/679/oj ; PARP guide https://www.parp.gov.pl/component/content/article/71129:marketing-e-mailowy-jak-prowadzic-go-w-firmie-legalnie-aby-ciagle-byl-skuteczny
**Evidence**: 6(1)(b) covers processing "necessary for the performance of a contract". Recital 47 lets direct marketing rest on legitimate interest (6(1)(f)), as PARP cites. Art. 21(3): after an objection to direct marketing, the data "shall no longer be processed for such purposes". Art. 7(4): consent tied to a service it is not needed for is not freely given.
**Context**: Under PKE, GDPR legitimate interest alone does not allow marketing **e-mail**: art. 398 consent is still required for the channel. The two regimes stack.
**Confidence**: High (regulation text). Medium on applying it to each aj stream.

### Decision table: mail type → lawful basis → consent needed? → List-Unsubscribe?

| aj mail type (examples) | Category | GDPR basis | PKE art. 398 consent? | User can turn off? | `List-Unsubscribe` + one-click? |
|---|---|---|---|---|---|
| E-mail verification, password reset, e-mail change confirm, security alert (new Google identity linked) | Transactional, security | 6(1)(b) (+6(1)(c)/(f) for security) | No | No | **No** (Gmail FAQ: transactional exempt) |
| Account deletion / data-export confirmation | Transactional | 6(1)(c) (GDPR request) / (b) | No | No | No |
| Reservation lifecycle to a party: taken/proposed/accepted/rejected/cancelled/confirm-needed | Transactional (service the user triggered) | 6(1)(b) | No | Optional (offer it, default on) | Recommended if user-disableable. Not required by Gmail |
| Term/event the user RSVP'd: changed, cancelled, reminder 24 h before | Service notification | 6(1)(b) | No | Yes (per type) | **Yes** (counts as "subscribed" mail) |
| New chat message (coalesced) | Service notification | 6(1)(b) / 6(1)(f) | No | Yes | **Yes** |
| Want MATCH for the user's own active want | Requested notification (grey zone, see Open Questions) | 6(1)(b) (user created the want) | No (interpretation) | Yes | **Yes** |
| Want SUGGESTION/SIMILAR, "new items near you", group activity digest of things not subscribed | Promotional-ish | 6(1)(a) | **Yes** (prior, per channel) | Yes (withdraw consent) | **Yes** |
| Newsletter, re-engagement, partner offers, points promotions | Marketing | 6(1)(a) (or (f) + PKE consent) | **Yes** | Yes | **Yes** (mandatory for bulk; best practice always) |
| Organizer/admin operational mail (moderation rejection, payment marked) | Transactional | 6(1)(b) | No | No | No |

Rule of thumb: if the user can turn it off, it gets the List-Unsubscribe headers and a footer link, and the link toggles exactly that preference (or "all notification e-mail"). Nothing turns off transactional mail.

## 3. Send log, retention, suppression

### Finding 3.1
**Sources**: GDPR art. 5(1)(c) minimisation and 5(1)(e) storage limitation (eur-lex above); art. 17(3)(b)/(e) and art. 21(3) on honouring objections; provider log windows (Mailgun 1–5 days, see `external-providers-recommendation.md`).
**Recommendation** (practice, medium confidence; no regulator-set period found):
- `email_messages` send log: id, idempotency key, template/stream, recipient party id, normalized address (or its hash after N days), provider message id, status (PENDING/SENT/DELIVERED/BOUNCED/COMPLAINED/FAILED), timestamps, and the error code. Do not store the rendered body or personal content. Re-render from the template if support needs it. Purge after ~90 days, or 12 months if the owner wants dispute evidence.
- `email_suppressions` keyed by normalized address: reason (hard_bounce/complaint/manual), source, and created_at. Keep it until the user deletes their account. After erasure, keep only a hash if a re-signup must not resurrect complaints (legitimate interest; document it in the RoPA).
- Preferences and consents: store marketing consent as an event (granted/withdrawn, timestamp, wording version, channel) to prove it (art. 7(1)).
- Unsubscribe requests are processed immediately. Gmail asks for ≤48 h and Yahoo for 2 days.

## 4. Templating

### Finding 4.1: Jinja2 autoescape is off by default; enable it explicitly
**Source**: https://jinja.palletsprojects.com/en/stable/api/
**Evidence**: `Template` has `autoescape=False`. "In future versions of Jinja we might enable autoescaping by default for security reasons." `select_autoescape` defaults `enabled_extensions=('html', 'htm', 'xml')` and `default=False`, and it matches case-insensitively by filename suffix. `StrictUndefined` "barks on print and iteration as well as boolean tests…".
**Recommendation**: `Environment(loader=PackageLoader("app.email","templates"), autoescape=select_autoescape(enabled_extensions=("html","html.j2"), default_for_string=True), undefined=StrictUndefined)`. Name templates `reservation_accepted.html.j2` / `.txt.j2`. A bare `.j2` suffix would not match `html`, which is a common pitfall. Text templates are unescaped, so never put user HTML in them. User-provided strings (item names, messages) are escaped in HTML. Truncate message previews and strip contact info to match existing policies.
**Confidence**: High.

### Finding 4.2: MJML vs hand-written HTML vs provider templates
**Source**: https://documentation.mjml.io/
**Evidence**: MJML compiles via the Node CLI (`mjml input.mjml -o output.html`) or `mjml2html`. CSS is inlined only with `mj-style inline="inline"`. Python ports exist (mjml-python wrapping the Rust MRML, and a pure-Python port) but are "not officially supported". `mj-raw` can carry template tags, but `mj-html-attributes` and minify can break them, so the docs suggest running the templating engine after MJML rendering.
**Recommendation for aj** (medium confidence): 5–15 templates in Polish do not justify a Node build step in the backend image. Use one hand-written, table-based responsive base layout (`base.html.j2`) with inline styles written directly. If MJML is wanted later, compile `.mjml` → `.html.j2` at dev time and commit the output (MRML via `mjml-python` avoids Node), keeping Jinja tags inside `mj-raw`. Avoid provider-hosted templates: they lock you to the vendor, sit outside code review and tests, and keep copy away from the Polish copy tables.
**Confidence**: High on MJML facts. The recommendation is judgement.

### Finding 4.3: Plain-text alternative, dark mode, accessibility
**Sources**: dark-mode practice summaries: https://www.mailgun.com/blog/email/email-dark-mode/ , https://customer.io/learn/message-composing/email-dark-mode , https://spotler.com/blog/how-to-build-emails-that-work-in-dark-mode
**Evidence**: Gmail web ignores `@media (prefers-color-scheme)`. Gmail mobile and classic Outlook invert colours. Outlook.com tags the elements it changes. Use transparent-PNG logos, a thin light border for dark logos, `<meta name="color-scheme" content="light dark">` as progressive enhancement, and avoid pure #FFF/#000.
**Recommendation**: Always send `multipart/alternative` with a real text body (not stripped HTML): the CTA URL on its own line, `lang="pl"` on `<html>`, a single primary button with the full URL repeated below it, alt text on images, no images that carry text, and the org theme colour only as an accent. Test in Mailpit's HTML check plus real Gmail and Outlook accounts.
**Confidence**: Medium (vendor blogs, consistent with each other).

### Finding 4.4: UTF-8 and Polish diacritics
**Source**: https://docs.python.org/3/library/email.policy.html
**Evidence**: `EmailPolicy` (the default for `EmailMessage`) is "intended to be fully compliant with the current email RFCs. These include … RFC 5322, RFC 2047". With `utf8=False` it supports "non-ASCII characters in headers by encoding them as RFC 2047 'encoded words'". `SMTPUTF8` (`utf8=True`) is only for servers with RFC 6531.
**Practice**: With an HTTP API adapter, send UTF-8 JSON/form strings ("Zarezerwowano przedmiot „Rower”") and the provider produces the encoded words. With the SMTP adapter (Mailpit/dev), build `email.message.EmailMessage` (policy default) and `set_content(text)` + `add_alternative(html, subtype="html")`. Never hand-assemble headers. Keep subjects ≤ ~60 characters before encoding. Use Polish typographic quotes consistently with the existing UI copy. Addresses stay ASCII; non-ASCII local parts raise `HeaderWriteError` and should be rejected at validation.
**Confidence**: High.

## 5. Idempotent sending from the outbox

### Finding 5.1
**Sources**: https://microservices.io/patterns/data/transactional-outbox.html ; provider idempotency facts from `external-providers-matrix.md` (Resend `Idempotency-Key` 24 h, Brevo `idempotencyKey` ~30 min, Mailgun none).
**Evidence**: The relay "might publish a message more than once", so "a message consumer must be idempotent", e.g. by tracking processed message IDs.
**Recommended algorithm** (engineering judgement, high confidence in the pattern):
1. The outbox handler (in-transaction with the domain write, already the aj pattern) only decides *who gets which template*. It inserts `email_messages` rows with `UNIQUE(idempotency_key)` via `INSERT … ON CONFLICT DO NOTHING`, status PENDING. If the row already existed, it skips.
2. A separate send step (an outbox handler or a short job polling `PENDING … FOR UPDATE SKIP LOCKED`, the same style as the matcher and attendance-close jobs) checks suppression, preferences and the daily cap again, renders, calls the provider with `Idempotency-Key = email_messages.id` when supported, and then stores the provider message id + SENT in a new transaction.
3. A crash between the provider 2xx and the commit leaves PENDING. The retry is deduplicated by the provider key (Resend/Brevo). On Mailgun it may send a duplicate, which is accepted for notification mail. To reduce the window, mark `SENDING` with `attempted_at` before the call and do not auto-retry a SENDING row younger than X minutes for security mail; let the user re-request instead.
4. Retries: 4xx validation → FAILED (no retry). 429/5xx/network → exponential backoff, aligned with `outbox/dispatcher.py` FAILED semantics. Log one WARNING per failure without the address (mask it).
5. Webhooks update status by provider message id, are idempotent themselves (event id unique), and write `email_suppressions`.

## 6. Notification batching and digests

### Finding 6.1
**Sources**: https://docs.suprsend.com/docs/best-practices-for-batching-digest ; https://knock.app/blog/building-a-batched-notification-engine ; https://knock.app/template-library/workflows/alerts ; https://www.atlassian.com/blog/confluence/stay-informed-with-confluence-batched-notifications ; https://www.servicenow.com/docs/r/platform-administration/email-digests.html
**Evidence**: Digests suit the "important but not urgent" layer. "Never batch security alerts, system outages, or time-sensitive warnings". Use 5–15 min windows for important alerts and hourly or daily for informational ones. Confluence batches "every ten minutes as long as there is activity". ServiceNow lets users choose the interval per notification type, and the window starts at the first event. Render per channel: full digest in e-mail, short in-app. Meetup-specific settings were **not** found (prior research cites them; unverified here).
**Applied to aj** (judgement):
| Stream | Delivery |
|---|---|
| Auth/security, reservation accepted/confirm-needed/cancelled, term cancelled | Immediate, never batched |
| New chat message | Delay ~10–15 min, coalesce per conversation, send only if the bell is still unread at send time (reuse notification read state). At most 1 per conversation per few hours |
| Term/event reminder | Scheduled (e.g. 24 h before, Warsaw clock), one per RSVP |
| Want MATCH | Batched: one e-mail per want per day (matches the existing "one unread bell row per want" rule) or a daily digest across wants |
| Group activity (new terms in my circles) | Daily or weekly digest, opt-in |
- Quiet hours: avoid sending non-urgent mail 22:00–07:00 Europe/Warsaw and defer it to 07:00. Use `clock.local_now()` per the domain-clock standard.
**Confidence**: Medium (vendor sources). The aj mapping is a design proposal.
