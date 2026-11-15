# External findings: patterns and failure modes from classifieds

## TL;DR
- Classifieds do not offer a proven pattern for "wanted post matched to listings and both sides notified". They offer two separate halves: a public wanted advert that nobody matches, and a private saved search that is matched but that sellers never see.
- The proven half is the alert: seeker-owned criteria, a cap of about 50, a daily digest by default, an expiry around 90 days, one-click switch-off.
- The public half fails in predictable ways: trade buyers, misfiled offers, duplicates, and stale posts kept alive only by manual renewal.
- Platforms built around one item per listing ban wanted listings outright, so a wanted post must be its own object, never a listing with a flag.
- Details and sources per platform are in `external-classifieds-platform-comparison.md`; finding numbers below refer to it.

## Key Decisions
- Patterns are stated only where at least one opened source supports them — each names its finding numbers.
- Reasons platforms give for having no wanted posts are recorded as "not stated" — no platform publishes one; the readings below are inferences and labelled so.

## Open Questions / Risks
- No classifieds platform was found that notifies the owner of a matching item about a want. Evidence for that half of the brief has to come from the gift-platform and matching gatherers.
- Quality evidence is thin: snapshots of single result pages and one journalist's test of alerts.
- OLX policy on wanted adverts remains unread (login-gated help centre).

## Patterns

### P1. Two models: wanted advert or saved search, rarely both joined
- Open classifieds host wanted adverts as ordinary adverts: OLX in practice (F1, F3), Gumtree UK in "Stuff Wanted" and two more wanted categories (F19), Craigslist in "wanted" (F27).
- Item marketplaces forbid them: Vinted treats "requests for an item" as reportable (F10); Wallapop is reported to reject "compro…/busco…" adverts (F25); Facebook's commerce policy requires a product offered for sale (F15) and Marketplace has no wanted function (F14).
- All six offer the saved search with alerts as the seeker's tool (F6, F12, F17, F22, F23, F26, F30).
- On no platform is the wanted advert itself matched to listings.
Confidence: high for the split; medium for "no platform matches wanted adverts" (absence of evidence in the pages opened).

### P2. A wanted advert is a normal advert with the wish in the title
- No platform in this set has wanted-specific fields. OLX, Gumtree and Craigslist reuse title, category, location, description, optional price and photos (F1, F21, F27).
- Polish convention is a leading verb: "Kupię", "Przyjmę", "Poszukuję/Poszukujemy" (F1, F3). English: "Wanted", "WANTED:", "Seeking", "Looking for" (F19, F27). Facebook groups: "wanted" posts, ISO (F14).
- OLX separates give-away and swap by a form option ("Za darmo", "Zamienię"), not by advert kind (F5).
Confidence: high.

### P3. Visibility is public, response is ordinary contact
- Wanted adverts are public and browsed by category and place (Gumtree radius 0–100 miles, Craigslist per city) (F19, F27).
- A seller answers through the same channel as for any advert; there is no "I have this" action that links an item to the want.
- In Facebook groups the audience is the group and the rules are the admins' (F16).
Confidence: high for visibility; medium for the response flow (inferred from the absence of any dedicated control on the pages read).

### P4. Lifecycle is inherited from the advert
- OLX: 30 days, e-mail before expiry, extend or reactivate (F8).
- Craigslist: 7–45 days for free postings, manual renew to the top every 48–72 hours (F29).
- No platform was found to close a wanted advert automatically when the need is met.
Confidence: medium.

### P5. Alert limits that recur
- Cap of 50 saved searches: OLX (F6), Gumtree Australia (F22).
- Alert validity of 90 days: Gumtree Australia (F22).
- Daily digest as the default or only frequency: Gumtree UK (F23), OLX as observed (F7), Wallapop at launch (F26). Immediate and weekly as options on Gumtree Australia, with immediate allowed only when the search has a keyword (F22).
- Switch-off in every e-mail: Gumtree UK and Australia (F22, F23). Per-search bell: Wallapop (F26). Global switch: OLX "Nowe ogłoszenia" (F6).
- Craigslist saved searches cannot be edited, only replaced (F30).
Confidence: high for Gumtree; medium for OLX and Wallapop.

### P6. Moderation of the demand side is by rule and by category
- Category-level bans: OLX forbids wanted adverts for animals (F4).
- Platform-level ban where a listing must be an item: Vinted (F10), Facebook commerce policy (F15).
- Anti-flood rules: Craigslist prohibits "overposted, cross-posted, or nonlocal content" (F31); OLX has per-category advert limits renewing after 30 days (F9); Facebook group admins cap posts per week and bumps (F16).
Confidence: medium to high.

## Failure modes

| Failure mode | Evidence | Confidence |
|---|---|---|
| Trade buyers take over the wanted space | OLX "kupię": "Skup Aut…", "KUPIĘ KAŻDĄ TOYOTĘ!!!" repeated per city (F2); Gumtree "CASH FOR PHONES WANTED…" (F20) | medium |
| Offers misfiled as wants | Gumtree Stuff Wanted: 2 of the first 10 are priced for-sale adverts (F20); Craigslist wanted: at least 3 of the first 10 (F28) | medium |
| Duplicates | Gumtree "Wanted tools" twice from one place (F20); OLX the same advert for two cities (F2) | medium |
| Weak categorisation of wants | Gumtree: 1121 of 1591 wanted adverts in "Miscellaneous" (F20) | medium |
| Small volume against the offer side | Gumtree: 1,591 wanted adverts for the whole UK (F19) | medium |
| Imprecise alerts read as spam | OLX: daily alerts linking to unrelated adverts, per one journalist's test (F7) | low |
| Unreliable alerts | Facebook Marketplace: reported as sporadic, by alert-app vendors only (F17) | low |
| Seekers targeted by scammers | Gumtree Australia warning about wanted rental adverts, search excerpt only (F24) | low |
| Free-text community space too costly to moderate | Vinted forum closed January 2024 (F13) | high for the event; its link to wanted posts is unconfirmed |

## Why some platforms have no wanted posts
No platform states a reason. Inferences from the sources read:
- The listing is defined as an item for sale, so a request is not a listing: Vinted's reporting guide (F10) and Facebook's "Brak przedmiotu na sprzedaż" rule (F15). Confidence: medium.
- The saved search already serves the seeker without adding public free text to moderate (F11, F26). Confidence: low (inference).

## What this means for the research question
- The classifieds evidence supports the alert mechanics (cap, digest, expiry, switch-off) and the lifecycle defaults (30-day run, reminder before expiry, manual renewal), not a matching design.
- A want that is public needs its own object and its own rules; platforms that let wants share the offer form get misfiled and trade content (F2, F20, F28).
- Category on a want matters: where it is optional or coarse, most wants fall into "Miscellaneous" (F20).
- Informing the owner of a matching item has no precedent among these six platforms. Confidence: medium (not found in any page opened).
