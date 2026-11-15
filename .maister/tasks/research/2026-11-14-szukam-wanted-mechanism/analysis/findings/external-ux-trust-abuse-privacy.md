# External trust-and-safety findings: spam and begging, contact leaks, seeker privacy, GDPR

## TL;DR
- The two large gift networks disagree on limits: one lets moderators cap wanted posts per member per week and says to use them "sparingly"; the other advises no numeric limits and a quiet word instead. Both reject "offer before you ask" rules.
- Contact-detail filtering is a known but leaky control; the research and practitioner consensus is to keep it light and to make staying on the platform worth more. Moving a conversation to an outside messenger is the first step of the dominant Polish classifieds scam.
- A want can reveal health, religion or similar facts about the seeker. EU case law treats data that indirectly reveals such facts as special-category data, so sensitive wants need restricted visibility or an identity-hiding option.
- Storage limitation and data minimisation in GDPR Article 5 support a default expiry and a short form.
- A report mechanism is required by the Digital Services Act for hosting services of any size.

## Key Decisions
- Do not adopt a give-to-ask ratio or an offer-first gate — both networks reviewed forbid or advise against it, on fairness and because it can be faked.
- Prefer a per-member posting cap plus first-post moderation over reputation gates — these are the controls actually documented; no evidence was found for reputation thresholds on wanted posts.
- Treat contact-detail blocking as friction, not as a guarantee — every source that describes it also says it is easy to get around.
- Treat the content of a want as possibly sensitive personal data by default — the CJEU reading of Article 9 is broad and regulators' guidance is unsettled.

## Open Questions / Risks
- No published data on how much spam or begging wanted posts attract, or on the effect of caps. Evidence is rules and moderator guidance only.
- No source describes an anonymous or pseudonymous wanted post as a designed feature; the privacy argument here is built from law, not from product precedent.
- The legal points are summaries from commentary and unofficial mirrors of the legal texts, not legal advice; a lawyer should confirm how Article 9 and the Polish electronic communications act apply.
- Scams aimed specifically at people who post wanted adverts: no authoritative source was opened (only search snippets about classifieds in general).

All URLs below were opened on 2026-11-14 unless marked "unconfirmed".

---

## 1. Spam and begging controls

### Finding 1.1: Per-member weekly cap allowed; banning wants or requiring an offer first is not
**Source**: https://www.freecycle.org/pages/ModManual/LocalDecisions (Freecycle moderator manual)
**Source type**: First-party community rules (cited as an example of a pattern)
**Evidence**: Moderators "may not forbid Wanted posts" or require "members to post an offer post before a wanted post", but "may limit the number of Wanted posts by a member each week." General principle: "the more freedom we can give the members the better."
**Confidence**: High.

### Finding 1.2: "Use sparingly" as a stated norm, with limits left to each group
**Source**: https://freecycle.org/pages/guidelines
**Source type**: First-party community rules
**Evidence**: "WANTED POSTS ARE TO BE USED SPARINGLY." "Numerical limits on Wanted posts vary by local group." Also "NO POLITICS, NO SPAM, NO MONEY", and "NO SWAPS/TRADING PLEASE" (this network is gift-only).
**Context**: The page has no explicit rule on sob stories or begging. No concrete number for the cap was found.
**Confidence**: High for the text; the typical cap value is unconfirmed.

### Finding 1.3: The opposite position — no numeric limits, personal moderation
**Source**: https://wiki.ilovefreegle.org/Best_Practice_Notes (Freegle volunteer wiki)
**Source type**: Volunteer-network moderator guidance
**Evidence**: There should be "no restrictions on the number of wanted posts or number of items requested." Over-enthusiastic requesters are "better dealt with by a friendly quiet word than a rule." "People, including us, overestimate the number of Wanted posts"; most groups have more offers than wanteds. An offer-first rule is called discriminatory for first posts, easy to fake and a deterrent to new members. "New member moderation will pick up spammers and any misposts."
**Context**: The perceived flood of wants is larger than the real one, according to people who see the dashboards. Spam is caught by moderating a member's first posts, not by ratios.
**Confidence**: High for the guidance; medium for the underlying claim (no figures given).

### Finding 1.4: Repost intervals are longer for requests than for offers
**Source**: https://trashnothing.com/help
**Source type**: Platform help centre
**Evidence**: "With most groups, you can repost Offers after a few days and Requests after a couple weeks."
**Context**: A cool-down on re-posting the same want is an existing control against repetition.
**Confidence**: High.

### Finding 1.5: Reciprocity conditions on requests are banned in the gift model
**Source**: https://ar5iv.labs.arxiv.org/html/2211.09043 (Herdağdelen, Adamic, State, 2023)
**Source type**: Peer-reviewed study describing group rules
**Evidence**: "Reciprocity is explicitly forbidden (asking for a need and offering another gift in return is forbidden)."
**Context**: This is a gift-only norm. A platform that also supports swaps cannot copy it as is; it shows that "what I offer in return" is a distinct element that gift communities deliberately exclude.
**Confidence**: High.

### Finding 1.6: Gift-style exchange builds more solidarity than negotiated exchange
**Source**: http://news.berkeley.edu/2012/05/29/freecycling/ (UC Berkeley news on Willer, Flynn, Zak, Administrative Science Quarterly, 2012)
**Source type**: University summary of peer-reviewed research (paper not read in full)
**Evidence**: Survey of more than 1,300 users of a gift network and a classifieds site; the gift network "is uniquely good at generating pro-group sentiments like group identification and solidarity." Receiving increases identification, which motivates giving.
**Context**: Wants that lead to gifts feed this loop; the study says nothing about wanted posts specifically.
**Confidence**: Medium.

### Finding 1.7: Reputation as a control — no evidence for wanted posts
**Source**: https://www.sharetribe.com/academy/how-to-discourage-people-from-going-around-your-payment-system/ (Juho Makkonen, 5 January 2016, updated 3 March 2026)
**Evidence**: Reviews are described as an incentive for good behaviour on both sides, usually available only after a completed on-platform transaction. Nothing found ties a reputation threshold to the right to post wants.
**Confidence**: Low (gap).

---

## 2. Contact-information leaks and off-platform deals

### Finding 2.1: Filtering contact details works as friction and is easy to bypass
**Source**: https://www.sharetribe.com/academy/how-to-discourage-people-from-going-around-your-payment-system/
**Source type**: Practitioner article by a marketplace-platform founder
**Evidence**: One large rental platform strips emails and phone numbers from messages, but "it is always possible to circumvent this limitation", for example by spelling out a number. Removing messaging "will simply not work"; too many barriers "will create friction on your site". Rule offered: "Provide value to get value."
**Confidence**: High for the practitioner view.

### Finding 2.2: Limiting communication is one of six modelled levers, each with a trade-off
**Source**: https://econpapers.repec.org/RePEc:inm:ormnsc:v:70:y:2024:i:3:p:1529-1553 (Hagiu and Wright, "Marketplace Leakage", Management Science 70(3), 2024 — abstract only)
**Source type**: Peer-reviewed economics paper
**Evidence**: Strategies analysed: "investing in transaction benefits, limiting communication, charging referral fees, using price-parity clauses, introducing seller competition" and "hiding sellers that try to induce too much leakage."
**Context**: The paper is about fee avoidance. On a free gift-and-swap platform the motive to keep people on the platform is safety and moderation, not revenue, so only "transaction benefits" and "limiting communication" carry over.
**Confidence**: Medium (abstract only).

### Finding 2.3: Automated detection needs human review
**Source**: https://www.latentview.com/blog/how-to-prevent-disintermediation-at-the-marketplace/ (vendor blog, updated 16 August 2026)
**Source type**: Vendor case description, self-reported
**Evidence**: A model scores messages 0 to 1 for off-platform intent and was "also used to obfuscate any contact information"; "ML models may not always be accurate", so flagged cases go to support staff. No detection or false-positive rates are given.
**Confidence**: Low to medium.

### Finding 2.4: Moving the conversation to an outside messenger is the first warning sign of the main Polish classifieds scam
**Source**: https://www.instalki.pl/news/bezpieczenstwo/cert-ostrzega-nowa-fala-oszustw-na-olx-wlasnie-ruszyla/ (13 May 2026, reporting a CERT Orange Polska warning)
**Source type**: Tech press reporting a telecom security team; the original advisory was not opened
**Evidence**: After an advert is posted, a supposed buyer proposes continuing on WhatsApp; "Właśnie to przeniesienie komunikacji jest pierwszym sygnałem ostrzegawczym." A link to a fake payment or bank page follows.
**Context**: A public want that shows a phone number or handle invites exactly this approach: strangers contact the seeker outside the platform with an "I have it, pay for the courier" story. Keeping first contact inside platform messaging, and keeping contact details out of the want text, removes the opening.
**Confidence**: Medium.

### Finding 2.5: Gift networks already hide email and tell members never to send money
**Sources**: https://trashnothing.com/help ; https://freecycle.org/pages/guidelines
**Evidence**: "The email address you sign up with is not shown to other members." "Never send money for anything offered on Freecycle™ (this includes money for shipping/couriers)." Members are advised to "only give your phone number to one person at a time".
**Context**: A plain warning ("never pay to receive a gift") next to responses to a want is an established convention.
**Confidence**: High.

### Finding 2.6: Report and block are standard, and a report channel is a legal duty
**Sources**: https://trashnothing.com/help ; https://dsa-ipj.pages.dev/article/19 (unofficial mirror of Regulation (EU) 2022/2065; not the EUR-Lex text)
**Evidence**: A "Report" button appears below every post; a blocked user can no longer send messages. The DSA's small-enterprise exclusion covers "Section 3 of this Chapter, with the exception of Article 24(3)" for micro and small online platforms; the mirror's commentary states that the hosting duties in Articles 16–17 (notice and action, statement of reasons) still apply to them.
**Context**: Wanted posts are user content like any other and need the same report entry point.
**Confidence**: High for the product pattern; medium for the legal reading (unofficial source).

---

## 3. Seeker anonymity and privacy of what someone is looking for

### Finding 3.1: Data that indirectly reveals a sensitive fact is special-category data
**Source**: https://www.insideprivacy.com/eu-data-protection/special-category-data-by-inference-cjeu-significantly-expands-the-scope-of-article-9-gdpr/ (Covington, 10 August 2022, on CJEU C-184/20, judgment of 1 August 2022)
**Source type**: Law-firm commentary; the judgment was not read
**Evidence**: The Court held that personal data "liable indirectly to reveal sensitive information concerning a natural person" falls under the Article 9(1) prohibition unless an exception applies. The commentary notes the reach is uncertain and conflicts with earlier EDPB guidance that looked at the purpose of processing.
**Context**: A want tied to a named account — a wheelchair, a blood-pressure monitor, incontinence products, a prayer rug, a maternity item — can reveal health, belief or family circumstances. Showing it publicly with the seeker's name, or sending it to item owners, is a disclosure of that inference.
**Confidence**: Medium (commentary; application to wanted posts is inferred).

### Finding 3.2: The Article 9 text and the two relevant exceptions
**Source**: https://gdpr-info.eu/art-9-gdpr/ (unofficial consolidated text)
**Evidence**: Article 9(1) prohibits processing of personal data "revealing racial or ethnic origin, political opinions, religious or philosophical beliefs", "data concerning health" and data concerning "sex life or sexual orientation". Exceptions include 9(2)(a) "explicit consent ... for one or more specified purposes" and 9(2)(e) data "manifestly made public by the data subject".
**Context**: A seeker who knowingly publishes a want may fall under 9(2)(e) for the public listing, but that does not obviously cover further uses such as profiling or pushing the want to selected owners. Options that reduce exposure: hide the seeker's identity until they accept a response, restrict visibility for flagged categories, or exclude some categories from wants.
**Confidence**: Medium for the text; low for which exception applies (needs legal review).

### Finding 3.3: Minimisation and storage limitation back a short form and an expiry
**Source**: https://gdpr-info.eu/art-5-gdpr/ (unofficial consolidated text)
**Evidence**: Personal data must be "adequate, relevant and limited to what is necessary in relation to the purposes for which they are processed" (5(1)(c)) and "kept in a form which permits identification of data subjects for no longer than is necessary" (5(1)(e)).
**Context**: An expired or fulfilled want has no remaining purpose; keeping it visible and linked to the seeker conflicts with storage limitation. This aligns the legal and the UX case for expiry.
**Confidence**: High for the text; medium for the application.

### Finding 3.4: Public comment-based interest versus private messages
**Source**: https://ar5iv.labs.arxiv.org/html/2211.09043
**Evidence**: In the studied gift groups interest is expressed in public comments and pickup is then arranged privately. Groups are local (median 0.82 of members in the same county) and mostly not prior friends.
**Context**: Group-scoped visibility is the existing privacy boundary in gift communities: wants are seen by members of a bounded local group, not by the open web. No source was found for anonymous wants.
**Confidence**: Medium.
