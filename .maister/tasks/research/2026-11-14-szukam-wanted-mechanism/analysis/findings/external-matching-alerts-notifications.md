# External findings: alert delivery for matches (immediate versus digest, caps, quiet hours, unsubscribe, fatigue evidence)

## TL;DR
- Too many or irrelevant notifications make people switch them off: in a 2021 YouGov poll 39% of US adults said they turn notifications off entirely when they come too often and 8% delete the app.
- The proven shape at scale is one gateway that deduplicates, caps, delays and groups notifications; LinkedIn reports it "cut member complaints in half" with such a system.
- Batching has experimental support: a randomized field experiment (n = 237) found people receiving notifications in three daily batches felt more attentive and in control; switching notifications off entirely raised anxiety.
- Production saved-search systems split channels: an immediate signal per match and a daily email built from stored matches (Funda).
- Give control per want and per type inside the product, and one-click unsubscribe in any email (RFC 8058).

## Key Decisions
- Group matches instead of sending one notification each when several arrive together — NN/g recommends combining when more than five would be sent at once; the first run of a new want is the obvious case.
- Build digests from a stored match table, not from re-running queries — the pattern Funda uses; it also gives deduplication for free.
- Put caps and duplicate filtering in one place that every match notification passes through — the gateway pattern; per-feature rules were the stated cause of LinkedIn's problem.
- Offer mute per want, not only a global switch — a global off loses the user for every want; NN/g asks for in-app controls per notification type.
- Do not treat "no notifications" as the safe default — the batching experiment found the never-notified group more anxious, with few of the benefits.

## Open Questions / Risks
- No opened source measures alert fatigue for wanted-post or saved-search alerts specifically; the evidence is general push/email research and one marketplace-type case (Funda). Confidence in transfer: medium.
- No opened source gives a tested numeric cap (per day or per week) for match alerts; any number chosen is a product decision.
- Quiet hours: the only opened first-party evidence is LinkedIn timing delivery by member locale (not sending while the member is asleep). No source with a measured effect of quiet hours was opened.
- The owner-side notification ("someone is looking for what you listed") appears in no opened engineering source; all examples notify the seeker only. This is a gap, and the side with the higher spam risk.
- The primary paper on notification volume and stress (Pielot, Church, de Oliveira 2014) was downloaded but could not be read (binary PDF); its figures are cited here only through NN/g and are otherwise unconfirmed.
- Survey figures come from a US sample and from 2021; Polish users may differ.

All URLs below were opened on 2026-11-14.

---

## 1. Evidence on notification fatigue

### 1.1 What people do when there are too many
- YouGov, fieldwork 2021-06-03, 1,167 US adults, margin of error 4.2%: when notifications are too frequent, 42% change settings, 39% turn notifications off entirely, 8% delete the app, 9% do nothing.
- Tolerance depends on the type: 62% accept personal messages several times a day; for brand promotions only 6% accept more than once a day (19% a few times a week, 18% once a week, 17% less often).
- Source: https://yougov.com/en-us/articles/36287-how-consumers-feel-about-push-notifications-2021 — confidence high for the figures, medium for transfer (US, 2021).
- Relevance: a match alert sits between a personal message and a promotion. It is asked for (the user created the want), which argues for higher tolerance, but each irrelevant match moves it toward the promotion end (inference; confidence medium).

### 1.2 Usability guidance
- NN/g, "Five Mistakes in Designing Mobile Push Notifications" (2018-11-18): cites a 2016 study with an average of 56 notifications a day per user; advises fewer and more meaningful notifications; warns that bursts lead users to disable notifications or delete the app.
- Do not alert on every small event; "provide relevant content aimed to inform and engage".
- Defaults are rarely changed, so the sender cannot rely on user settings to excuse volume.
- Controls belong inside the app, per notification type; ideally a user-set maximum per period or minimum importance.
- Combine notifications when more than five would be sent at once (grouped "likes" as the example).
- Source: https://www.nngroup.com/articles/push-notification/ — confidence high.

### 1.3 Experimental evidence on batching
- Fitz, Kushlev, Jagannathan, Lewis, Paliwal, Ariely (2019), "Batching smartphone notifications can improve well-being", Computers in Human Behavior 101, 84–94, doi:10.1016/j.chb.2019.07.016. Abstract: a "randomized field experiment (n = 237)" with groups receiving notifications "as usual, batched, or never".
- The group batched three times a day "felt more attentive, productive, in a better mood, and in greater control of their phones"; the never group "experienced higher levels of anxiety" and gained few of the benefits.
- Source: https://scholars.duke.edu/publication/1402953 — confidence high for the abstract-level findings. Details reported in search results only (delivery at fixed times of day, hourly batching showing little change, two-week duration) were not confirmed on the opened page — unconfirmed.
- Relevance: supports a digest option and argues against silence as the fallback. The study covers all phone notifications, not one app's alerts.

### 1.4 Industry case with measured results
- LinkedIn, "Air Traffic Controller: Member-First Notifications" (2018): before, each team decided on its own, giving "a non-regulated, excessive, and low-quality member notification experience" that led members to "file complaints and disable notifications".
- After routing everything through one system: it "cut member complaints in half" and produced "double digit increases in member engagement site-wide".
- Source: https://www.linkedin.com/blog/engineering/messaging-notifications/air-traffic-controller-member-first-notifications-at-linkedin — confidence high for the claims as made by the company; no unsubscribe or disable rates are published.

---

## 2. Delivery patterns

### 2.1 Immediate per match versus digest
- Funda (over 1 million saved searches): the matcher emits an event per new match that starts a push workflow; email is a daily workflow reading a feed of previously stored matches. Over 4 million matches a day become over 200,000 emails a day, which shows the aggregation ratio of the daily email.
- Source: https://blog.funda.nl/how-we-enhanced-the-saved-search-feature-with-opensearch/ (2024-03-19) — confidence high.
- LinkedIn's gateway can delay notifications and "send a group of notifications together as one notification at a later time" (example: a week of invitation reminders in one email) — section 1.4 source — confidence high.
- Reading for wanted posts (synthesis; confidence medium): a scarce, time-sensitive match (a gift item can be taken within hours) favours an immediate signal; bulk or low-urgency channels favour a digest; both draw from the same stored matches.

### 2.2 First-run summary
- A new saved criterion matches many existing items at once. One practitioner post recommends a single capped summary ("23 listings currently match - here are the 5 most recent") over a notification per item or silence.
- Source: https://happyendpoint-website-new.pages.dev/blog/building-property-alerts-app-propertyfinder-api (2026-04-28) — confidence medium (single vendor blog).
- Consistent with NN/g's rule to combine when more than five would be sent (section 1.2).

### 2.3 Frequency caps and filtering
- LinkedIn's filtering stage exists "To prevent a member from being overloaded with notifications"; it rate-limits upstream senders against accidental floods, drops duplicates, and drops notifications for content the member already engaged with or that has expired. Its "5 Rights" framing includes "the right frequency". The post names no numeric cap — section 1.4 source — confidence high.
- A report that LinkedIn set daily and monthly notification limits appeared in search results (VentureBeat) but was not opened — unconfirmed.
- NN/g suggests letting the user set a maximum number per period (section 1.2) — confidence high.
- For matches the "already engaged or expired" filter translates to: skip items the seeker already viewed, reserved or dismissed, and items no longer listed at send time (inference from the LinkedIn rule; confidence medium).

### 2.4 Timing and quiet hours
- LinkedIn uses member locale to deliver when the member is likely to engage, with the example of not sending profile-view alerts while the member is asleep; the post does not use the term "quiet hours" and gives no separate measurement — section 1.4 source — confidence medium.
- The batching experiment delivered at predictable intervals (section 1.3) — support for fixed digest times; exact times unconfirmed.
- No opened source quantifies the effect of quiet hours on opt-outs — gap.

### 2.5 Relevance as the main lever
- Elastic's guidance stresses that percolation only finds matches; alerting logic is the application's job (https://www.elastic.co/blog/when-and-how-to-percolate-1) — confidence medium (dated).
- The polling post advises alerting only on events worth it (new listings, meaningful changes), not every field change — section 2.2 source — confidence medium.
- LinkedIn scores each candidate notification and may drop it, show it in-app only, or also push it — section 1.4 source — confidence high. A cheap equivalent for matches (inference; confidence medium): a strong match (all words, right category) may go out at once, a weak match (trigram or embedding only) waits for the in-app list or the digest.

### 2.6 Unsubscribe and mute
- Email: RFC 8058 defines one-click unsubscribe. The message carries `List-Unsubscribe` with an HTTPS URI and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, both covered by a valid DKIM signature; "The POST request MUST NOT include cookies, HTTP authorization, or any other context information", so the URI itself must identify what is being unsubscribed — https://www.rfc-editor.org/rfc/rfc8058 — confidence high.
- In-app: controls per notification type inside the product (NN/g, section 1.2) — confidence high.
- Per-criterion scope: Funda ties matches to the saved search id, and a replaced search stops producing feed entries (section 2.1 source) — confidence medium as evidence for per-want mute; no opened source describes a per-want mute control directly — gap. The other gatherers' platform findings may fill it.

---

## 3. Option summary

| Option | How it works | Fit with the stack | Cost at this scale | Risks | Sources |
|--------|--------------|--------------------|--------------------|-------|---------|
| Immediate notification per match | One notification when a match row is inserted | Outbox event per new match | Low | Floods on first run and on popular wants | Funda, NN/g |
| Immediate with grouping window | Hold matches briefly, send one grouped notification | Needs a delayed or periodic worker step | Low | Slight delay on scarce items | LinkedIn, NN/g |
| Daily digest from stored matches | Scheduled job reads unsent match rows per user | Periodic scan over a match table | Low | Item may be gone by send time; needs a liveness check | Funda, Fitz et al. |
| First-run capped summary | One message with the count and the top few | Part of want creation | Low | Choice of ranking for the top few | polling post, NN/g |
| Per-user cap | Stop or downgrade after N alerts per period | Counter over the match or notification table | Low | Number is a guess without data | LinkedIn, NN/g |
| Per-want mute and one-click email unsubscribe | Flag on the want; signed link in email | Small | Low | Link must work without a session | RFC 8058, NN/g |

---

## Sources opened (2026-11-14)

| URL | Used for |
|-----|----------|
| https://yougov.com/en-us/articles/36287-how-consumers-feel-about-push-notifications-2021 | Survey on reactions to frequency |
| https://www.nngroup.com/articles/push-notification/ | Usability guidance |
| https://scholars.duke.edu/publication/1402953 | Batching experiment abstract |
| https://www.linkedin.com/blog/engineering/messaging-notifications/air-traffic-controller-member-first-notifications-at-linkedin | Gateway pattern, measured results |
| https://blog.funda.nl/how-we-enhanced-the-saved-search-feature-with-opensearch/ | Push per match, daily email from stored matches |
| https://happyendpoint-website-new.pages.dev/blog/building-property-alerts-app-propertyfinder-api | First-run summary |
| https://www.elastic.co/blog/when-and-how-to-percolate-1 | Alerting is application logic |
| https://www.rfc-editor.org/rfc/rfc8058 | One-click unsubscribe |

Not readable or not opened: the Pielot et al. 2014 paper (PDF fetched from two addresses, text could not be extracted); vendor surveys from Airship, Localytics and Braze and the VentureBeat report on LinkedIn limits (seen in search results only, not used as evidence).
