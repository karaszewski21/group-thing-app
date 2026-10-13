# External Evidence: Do Reminders and Commitment Devices Reduce No-Shows?

Category: external-ux-patterns (instance 4). All sources accessed 2026-10-13.
**Analogue warning:** nearly all quantitative evidence comes from healthcare appointments or events, not P2P item handovers. Treat effect sizes as directional.

---

## 1. Reminder effectiveness (meta-analytic)

### 1.1 Robotham et al. 2016, BMJ Open: digital notifications and clinic attendance
- 26 articles included; 21 in the primary meta-analysis (8,345 patients with text notifications vs 7,731 without).
- Attendance RR = 1.23 (67% vs 54%).
- No-show RR = 0.75 (15% vs 21%), i.e. 25% fewer no-shows.
- "**Multiple notifications were significantly more effective at improving attendance than single notifications.**"
- Timing: not tested as a moderator. In 9 studies notifications went out 48 hours or less before the appointment.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC5093388/ (DOI 10.1136/bmjopen-2016-012116)
- Confidence: High (fetched abstract).

### 1.2 Gurol-Urganci et al. 2013, Cochrane CD007458: mobile phone messaging reminders
- 8 RCTs, 6,615 participants.
- Text reminders increase attendance compared with no reminder and with postal reminders.
- Text reminders perform about the same as phone-call reminders, and two studies found them cheaper per attendance.
- Evidence quality: low to moderate.
- Sources: https://pubmed.ncbi.nlm.nih.gov/24310741/ ; https://www.cochrane.org/evidence/CD007458_mobile-phone-messaging-reminders-attendance-healthcare-appointments ; summary https://www.aafp.org/pubs/afp/issues/2013/0701/p20.html
- Confidence: High (multiple consistent sources, via search).

### 1.3 Timing
- No head-to-head RCT comparing 24h, 48h and 72h was found.
- A VA comparison, reported secondhand, found 24h and 48h reminder calls better than 72h. In an RCT, a call 1 day before cut no-shows from 26% to 19%, though cancellations rose. https://acofp.org/news-and-publications/journal/article-detail/vol-12-no-5-(2020)-september-october-2020/evaluation-clinical-no-show-rates-setting-outpatient-internal-medicine-residency-clinic (Confidence: Medium; original VA paper not located)
- A 2026 medRxiv preprint, reported secondhand: a single reminder about 24 hours before gave the largest reduction (RR 0.76 vs none). Cited via https://www.entagl.com/blog/reduce-no-shows-reminders-confirmation-calls (Confidence: Low)
- Practice benchmarks:
  - Eventbrite: 48h for in-person events; 48h + 2h + 10min for online.
  - Calendly: 24h email + 30min SMS.
  - Olio FWH: 10h.
  - Meetup: 7d, 1d, and day-of.
  - See external-patterns-apps.md.
- **Conclusion:** two touchpoints, roughly the day before (T-24h to T-48h) plus a short same-day nudge (T-2h, or the morning of the Term), match both the "multiple > single" finding and industry practice. Confidence: Medium.

### 1.4 Reminder side effect: more cancellations
- Reminders raise cancellations as well as attendance (the residency RCT above).
- For our app this is desirable: an early "can't make it" frees the item for someone else, as Olio FWH's "No" button does.

---

## 2. Commitment devices and implementation intentions

### 2.1 Martin, Bassi & Dunbar-Rees 2012, J R Soc Med: "Commitments, norms and custard creams"
- Setting: 2 NHS practices, Feb–May 2011. Uncontrolled before/after comparison.
- Interventions and results:
  - Patients **repeating their appointment date and time back** to staff: DNAs down 3.5%.
  - Patients **writing their own appointment date and time** on the card: DNAs down 18% (p<0.05).
  - Adding social-norm signage ("X patients attended"): DNAs down 31.7% for the combined package. DNAs rose when the interventions were paused and fell 29.6% when they were reinstated.
  - A 4-digit reference number written by staff did not work: DNAs rose, attributed to staff non-compliance.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC3308641 (fetched). Confidence: High for what was reported; Medium for causality (no control group).
- Design implication: make the user actively commit, e.g. tap "I'll bring it on <date time>", rather than passively receive information. Social-norm copy such as "92% of your group's handovers happened on time" also helps, but only if it is true.

### 2.2 Milkman, Beshears, Choi, Laibson & Madrian 2011, PNAS: implementation-intention prompts
- All participants received a reminder mailing with clinic times.
- Results:
  - Control vaccination rate: 33.1%.
  - Prompt to write down the **date only**: +1.5 pp (not significant).
  - Prompt to write down the **date and time**: +4.2 pp (significant).
- Sources: https://www.nber.org/papers/w17183 ; https://www.hks.harvard.edu/publications/using-implementation-intentions-prompts-enhance-influenza-vaccination-rates ; https://clinicaltrials.gov/study/NCT01207232
- Confidence: High.
- Implication: a reminder works better when it pushes a concrete "when", for example "Pack it tonight", "Set a reminder at 18:00", or adding the event to the user's own calendar.

### 2.3 Gollwitzer & Sheeran 2006, meta-analysis of implementation intentions
- 94 independent tests. Medium-to-large effect on goal attainment, d ≈ 0.65.
- Source: https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f (Adv. Exp. Soc. Psychol. 38:69–119, doi 10.1016/S0065-2601(06)38002-1).
- Confidence: High for the citation and headline d; Low for the per-domain splits seen in secondary blogs.

---

## 3. Free vs paid: why free handovers are at higher risk
- PheedLoop, check-in data from 1,070+ events: median no-show rate about 20% overall, **28% for free events vs 17% for paid**. Price was the strongest predictor, and registration friction did not explain the gap once price was controlled for. https://pheedloop.com/blog/event-data-lab-report-06 (Confidence: Medium, vendor data but large n)
- Skift (informal): free events see 40–60% no-shows, paid events 10–20%. https://meetings.skift.com/2025/11/26/no-shows-create-stress-wreak-havoc-on-events/ (Confidence: Low)
- Relevance: our handovers are free (gift, lend, swap) and have no sunk cost. TGTG relies on prepayment, which does not apply here, so reminders, commitment and social accountability within the group have to do that job. A swap has some built-in reciprocity, since both sides bring something; a gift does not.

---

## 4. Evidence summary for synthesis

| Claim | Strength | Source |
|---|---|---|
| Digital reminders cut no-shows by about 25% (RR 0.75) | High (meta-analysis, healthcare) | PMC5093388 |
| Multiple reminders beat a single reminder | High (meta-analysis) | PMC5093388 |
| SMS is about as effective as calls and better than post or nothing | Moderate (Cochrane, low–moderate quality evidence) | CD007458 |
| 24–48h beats 72h | Low–Medium (secondhand) | acofp.org |
| Active self-written commitment cut no-shows by 18%; with norms, 31.7% | Medium (uncontrolled) | PMC3308641 |
| A date+time plan prompt adds about 4 pp on a 33% base | High (field RCT) | NBER w17183 |
| Free commitments have more no-shows than paid ones | Medium | PheedLoop |
| Reminders also raise early cancellations | Medium | acofp.org |
