# Moderation Architecture: Legal Context (EU DSA + GDPR)

Category: `moderation-architecture`. Gathered 2026-10-01. This is not legal advice. Article texts were checked through https://www.eu-digital-services-act.com (a mirror of Regulation (EU) 2022/2065). The EUR-Lex HTML returned empty content when fetched.

---

## 1. Which DSA tier applies to this app

### Finding 1.1: The app is a "hosting service". Whether it is also an "online platform" depends on public dissemination
- Hosting means storing information provided by a recipient of the service, which is what Art. 6(1) covers.
- Recital 14 says "dissemination to the public" means making content available to a "potentially unlimited number of persons". It *excludes* "closed groups consisting of a finite number of pre-determined persons".
- Where access requires admittance to a group, content counts as public only if users are "automatically registered or admitted without a human decision".
- Consequences for this app:
  - If items are visible only inside invite- or approval-based groups, the app is arguably a plain hosting service for that content.
  - The public pages (`/:slug/grupa/:groupId/term/:termId`, with Open Graph meta injection in `app/system/router.py`, see `docker-compose.yml` comments) push it toward being an "online platform".
  - Plan for platform-level duties.

**Sources**: Art. 6 https://www.eu-digital-services-act.com/Digital_Services_Act_Article_6.html ; Recital 14 via https://www.cms-digitallaws.com/en/dsa/recital-14/ ; repo `docker-compose.yml` (frontend-build comment).
**Confidence**: Medium. The classification is a legal judgment, and the public-page behavior needs product confirmation.

### Finding 1.2: Micro and small enterprises are exempt from most platform-specific duties
- Art. 19(1): Section 3 (online platform duties, Arts. 20-28) "shall not apply to providers of online platforms that qualify as micro or small enterprises", except Art. 24(3). The exemption does not apply to VLOPs.
- Micro means <10 staff and ≤€2M turnover or balance sheet. Small means <50 staff and ≤€10M (Recommendation 2003/361/EC).
- **Exempt** while small:
  - Art. 20 internal complaint system;
  - Art. 21 out-of-court dispute bodies;
  - Art. 22 trusted flaggers;
  - Art. 23 misuse measures;
  - Art. 24(5) submission of statements of reasons to the DSA Transparency Database;
  - Art. 15 transparency reports (exempted by Art. 15(2)).
- **Not exempt** (these apply to *all* hosting services): Arts. 11-14, 16, 17 and 18.

**Sources**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_19.html ; .../Article_15.html ; https://www.lewissilkin.com/en/insights/2023/10/20/hosting-providers-online-platforms-ready-comply-your-dsa-content-moderation-february-2024
**Confidence**: High.

---

## 2. DSA obligations that apply regardless of size

### Finding 2.1: Art. 14, terms and conditions must disclose the moderation tooling
- The terms must include "information on any policies, procedures, measures and tools used for the purpose of content moderation, including algorithmic decision-making and human review", in clear language.
- Art. 14(4) requires providers to act "in a diligent, objective and proportionate manner".
- **Implication**: the regulamin (terms of service) must state that names, descriptions and photos are checked automatically by AI models, with human review.

**Source**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_14.html. **Confidence**: High.

### Finding 2.2: Art. 16, notice-and-action
Hosting providers must provide an easy-to-access electronic mechanism that lets anyone report specific illegal content. Notices should allow:
- (a) a reasoned explanation;
- (b) the exact URL;
- (c) the reporter's name and email;
- (d) a bona-fide statement.

Further requirements:
- Send a confirmation of receipt (Art. 16(4)).
- Notify the reporter of the decision "without undue delay", with redress information (16(5)).
- Process notices "in a timely, diligent, non-arbitrary and objective manner" and disclose any "automated means" used (16(6)).
- A valid notice can create "actual knowledge" (16(3)), which ends the Art. 6 liability shield unless the provider acts expeditiously.

**Implication**: a "Report" button on item, photo and public pages that creates a report row and routes the item to `NEEDS_REVIEW`. The same review queue serves both AI flags and user reports.
**Source**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_16.html. **Confidence**: High.

### Finding 2.3: Art. 17, statement of reasons (SoR) for every restriction
This applies whenever content is removed, disabled, demoted or otherwise restricted on the grounds that it is illegal or incompatible with the terms. The statement must contain:
- (a) the type of decision, its territorial scope and duration;
- (b) the facts and circumstances relied on, including whether the decision came from a notice or own-initiative;
- (c) whether automated means were used;
- (d) the legal ground, if the content is illegal;
- (e) the clause of the terms, if the content breaks the terms;
- (f) redress options.

It must be "clear and easily comprehensible and as precise and specific as reasonably possible".

**Implication for the data model**: every `REJECTED` decision needs:
- a `reason_code`, which maps to a clause of the terms;
- `source` (`AI` | `USER_REPORT` | `ADMIN`);
- an `automated` flag;
- scope (item, photo or account);
- a notification to the owner with this text and an "appeal" link.

The existing `app/notifications` module (outbox-driven, pre-rendered Polish messages, `app/notifications/outbox_listener.py`) is the natural delivery channel.
**Source**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_17.html. **Confidence**: High.

**Note on pending vs rejected**: holding new content in `PENDING` for seconds before first publication is arguably not a "restriction" of published content. However, a `REJECTED` outcome is. Treat every rejection as needing a statement of reasons. **Confidence**: Medium (interpretation).

### Finding 2.4: Art. 18, report threats to life or safety
If a hosting provider becomes aware of information suggesting a criminal offence involving a threat to life or safety, it must "promptly inform the law enforcement or judicial authorities". For this app, this is a manual admin escalation path, not an automated one.
**Source**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_18.html. **Confidence**: High.

### Finding 2.5: Art. 7, voluntary AI screening does not cost the liability exemption
Providers do not lose the Art. 4-6 exemptions "solely because they, in good faith and in a diligent manner, carry out voluntary own-initiative investigations ... aimed at detecting, identifying and removing ... illegal content". Proactive AI moderation is therefore legally safe.
**Source**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_7.html. **Confidence**: High.

### Finding 2.6: Duties that start once the app grows beyond small (or if it is designated a VLOP)
These are worth designing for cheaply now, because the audit log covers most of them:
- **Art. 20**: an internal complaint system for at least 6 months after a decision. Decisions under "supervision of appropriately qualified staff, and not solely on the basis of automated means".
- **Art. 24(5)**: submit statements of reasons to the Commission's Transparency Database.
- **Art. 15**: yearly transparency report. It includes "indicators of the accuracy and the possible rate of error" of automated moderation. The `moderation_decisions` log plus human overturn rates gives this directly.

**Sources**: .../Article_20.html ; .../Article_15.html. **Confidence**: High.

### Finding 2.7: The Polish national DSA framework is still in flux
- The President of UKE has been the temporary Digital Services Coordinator since 15 May 2025, with limited powers.
- The President vetoed the first implementing act on 9 Jan 2026.
- A split bill (UC140) passed the Senate on 6 Aug 2026 with amendments and returned to the Sejm. It enters into force 30 days after publication.
- One search summary claims it was signed in September 2026, but this was **not verified**.
- The DSA itself applies directly regardless of national law. National law adds the enforcement and penalty machinery.

**Sources**: https://www.traple.pl/en/implementation-status-of-the-digital-services-act-in-poland/ (5 Jun 2025) ; https://www.techtimes.com/articles/323540/20260807/poland-passes-digital-services-act-adds-lawmakers-independence-required-watchdog.htm (7 Aug 2026).
**Confidence**: Medium for the timeline. Low for the current signature status.

---

## 3. GDPR considerations for images and moderation

### Finding 3.1: Photos are personal data when people are identifiable, but not automatically biometric
- GDPR Recital 51: "the processing of photographs should not systematically be considered to be processing of special categories of personal data". Photos count as biometric "only when processed through a specific technical means allowing the unique identification or authentication of a natural person".
- An NSFW or violence classifier does not identify people, so it does not turn photos into Art. 9 data.
- **Do not** add face recognition or face matching, because that would make the processing Art. 9 biometric.

**Source**: https://gdpr-info.eu/recitals/no-51/. **Confidence**: High.

### Finding 3.2: Art. 22 applies to solely-automated decisions with significant effects, so keep a human in the loop
- Art. 22(1) gives a right not to be subject to a decision "based solely on automated processing ... which produces legal effects ... or similarly significantly affects him or her". Exceptions are in 22(2): contract, law, or consent. Art. 22(3) safeguards require "at least the right to obtain human intervention ... to express his or her point of view and to contest the decision".
- Rejecting a free item listing is arguably not "significant". However, it becomes more significant if account-level restrictions follow.
- Design rules that remove the issue:
  - an auto-reject is always appealable to a human;
  - account suspensions are never automatic.

**Source**: https://gdpr-info.eu/art-22-gdpr/. **Confidence**: High for the text. Medium for its applicability.

### Finding 3.3: Data minimisation, processors and transfers
- **EXIF/GPS stripping**: photos taken at home carry GPS coordinates, which is unnecessary personal data. Strip metadata on processing (Art. 5(1)(c) minimisation). The spaces-upload gatherer covers how. **Confidence**: High (principle).
- **External inference API = processor**: sending images and text to Hugging Face, OpenAI or similar requires a DPA (Art. 28) and, for US processing, an Art. 46 transfer mechanism (SCCs).
  - Hugging Face publishes a DPA and relies on 2021 SCCs.
  - HF Inference Endpoints state that HF "does not store any customer data in terms of payloads".
  - Selecting an EU storage region is reported to be limited to Team/Enterprise tiers.
  - **Self-hosting the model on EU infrastructure (DO AMS/FRA region) avoids the transfer question entirely.**
- **Sources**: https://cdn-media.huggingface.co/landing/assets/Data+Processing+Agreement.pdf ; https://huggingface.co/docs/inference-endpoints/en/security ; https://compound.law/en-DE/tools/hugging-face/ (secondary).
- **Confidence**: Medium. The details belong to the hf-hosting gatherer and should be cross-checked there.
- **Retention**:
  - Rejected images should be deleted from the bucket after the appeal window. 6 months mirrors DSA Art. 20 if you adopt it, otherwise use a shorter documented period.
  - Keep the audit row with a hash, not the image, beyond that period.
  - Document this in the privacy policy.
  - **Confidence**: Medium (synthesis).
- **Transparency**: the privacy notice must mention automated screening of uploads (Arts. 13-14 information duties). This overlaps with DSA Art. 14 terms disclosure. **Confidence**: High (principle).

### Finding 3.4: CSAM, separate from GDPR
- EU Regulation 2021/1232 (the "interim derogation") covers **interpersonal communication services**, not public listings, so it does not govern this app's item gallery.
  - It lapsed on 3 Apr 2026 after a Parliament vote on 26 Mar 2026.
  - A second-reading vote on 9 Jul 2026 opened the path to extend it to 3 Apr 2028.
- Generic NSFW classifiers are not CSAM detectors. If illegal material is found, the Art. 18 escalation and national reporting apply. In Poland, reporting goes through Dyżurnet.pl, NASK (not verified in this session).
- **Do not keep copies** beyond what is needed for reporting.

**Sources**: https://www.edps.europa.eu/press-publications/press-news/press-releases/2026/extension-interim-rules-combat-child-sexual-abuse-online-must-address-shortcomings-and-prevent-indiscriminate-scanning_en ; https://agora-intelligence.com/en/blog/atlas-eu-chat-control-extension-2026 (secondary).
**Confidence**: Medium (the status is volatile). Low for the Dyżurnet note.

---

## 4. Compliance checklist mapped to features (synthesis)

| Obligation | Feature | Must have now? |
|---|---|---|
| DSA 14 / GDPR 13 | Terms and privacy text about AI plus human moderation | Yes |
| DSA 16 | "Report" button, report → `NEEDS_REVIEW`, ack and decision notification | Yes, if any content is public |
| DSA 17 | Reason code + clause + automated flag + redress text in a rejection notification | Yes |
| DSA 18 | Admin escalation note in the runbook | Yes (process only) |
| GDPR 22(3) / DSA 17(3)(f) | Appeal → human review | Yes (cheap) |
| GDPR 5(1)(c) | EXIF strip, retention of rejected objects | Yes |
| GDPR 28/46 | DPA/SCC if using an external API, or self-host in the EU | Yes, if an external API is used |
| DSA 20, 24(5), 15 | Formal complaint system, Transparency DB, yearly report | Only above small-enterprise size |
