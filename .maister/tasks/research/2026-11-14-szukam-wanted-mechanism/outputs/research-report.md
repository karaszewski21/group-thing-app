# Research Report: "Szukam" (wanted) mechanism

## TL;DR
- None of the eleven platforms matches a wanted post to listings or tells an item's owner that someone wants it; machine matching exists only as the seeker's own saved search or keyword alert. "Notify both sides" is new ground with no proven pattern behind it (confidence: medium, inferred from documentation).
- Recommended first step: a private want (name plus optional search-shaped filters, default expiry) in its own backend module, matched to listings in both directions through the outbox into a unique (want, item) match table, with an in-app notification to the seeker only.
- Owner-side notification and public or group-visible wants are separate, later decisions; they need an opt-out, a seeker-identity rule, a response channel and legal review, none of which exist today.
- Per-term needed items are a different concept and stay separate; their structured form was already tried and removed.
- Overall confidence: medium — code facts are high; match quality in Polish, scan cost and the legal points are unmeasured or unreviewed.

## Key Decisions
- Start from the seeker-only private want — it is what the shipped mock promises, what the earlier search task assumed, and the only half with platform precedent (saved-search alerts) and ready code.
- Treat owner notification as an experiment, not a best pattern — no platform or engineering source shows it; the owner did not ask for the message and the existing take/propose flow already notifies the owner once the seeker acts.
- Keep needed items separate — author, scope, response and lifecycle differ in code; migrations 0018–0020, 0063 and 0067–0068 removed the product link and the pledge-to-reservation link.
- New module with its own ACLs, not `app/search` — `app/search` is documented as read-only and may be imported only by `app/main.py`.
- Match asynchronously in both directions, deduplicate on (want, item) — three independent sources recommend it; the outbox exists; nothing else prevents repeat alerts.
- Use the existing `'simple'` full-text plus trigram recipe with a stricter threshold and measure before adding a Polish dictionary or embeddings — PostgreSQL 18 has no Polish stemmer, PostgreSQL 19 is a release candidate, and no quality measurement exists.
- In-app notifications only at the start, with grouping, a per-want mute and a database-count cap shipped together with the feature — the system has no preferences, deduplication or caps today.

## Open Questions / Risks
- Product decision: does a match notify only the seeker (mock) or both sides (brief)? The research cannot settle it; it can only say the second has no precedent.
- Product decision: are wants private, visible to group members, or public? Public wants bring begging, trade buyers, stale posts and an Article 9 GDPR question.
- Scope: a private want with matching is functionally a saved-search alert, which the brief excludes "as a separate feature". Confirm the line.
- Polish inflection: exact-word matching misses inflected forms; trigram tolerance is unmeasured. Match precision and recall are unknown until tested on real pairs.
- Scan cost of reverse matching is argued, not measured; expected numbers of wants and items are assumed.
- Legal: Article 9 GDPR (wants revealing health or belief), Article 398 of the Polish Electronic Communications Law (consent per channel) and the DSA report duty rest on commentary and unofficial mirrors. A lawyer must confirm before public wants, owner notifications or email.
- The bell shows only the newest 50 rows; match rows can push action prompts (`SWAP_PROPOSED`, `TERM_CONFIRMATION_NEEDED`) out of view.
- Out-of-scope observation, unverified: `PUT /api/products/{id}` may lack an ownership check (see Appendix D).

---

**Research type**: mixed (literature + technical) · **Date**: 2026-11-14 · **Researcher**: research-synthesizer agent, from the findings of seven gatherers

## Table of Contents
1. Executive summary
2. Research objectives
3. Methodology
4. Platform comparison (success criterion 1)
5. Proven patterns and known failure modes (success criterion 2)
6. Map of existing code (success criterion 3)
7. Relation to needed items (success criterion 4)
8. Findings summary
9. Options and trade-offs per decision area (success criterion 5)
10. Conclusions and recommendations
11. Sub-questions: status
12. Appendices

Conventions: backend paths are relative to `src/backend/app/`, frontend paths to `src/frontend/src/`, unless written in full. `[file §id]` points to a file in `analysis/findings/`. Every external page was opened on 2026-11-14 through a text-extraction tool; quoted wording should be re-checked on the page before reuse. "Inference" marks a conclusion of the gatherer or of this synthesis, not a sourced fact.

---

## 1. Executive summary

**What was researched.** How to add wanted posts ("szukam") to the platform: what comparable platforms do, which techniques fit PostgreSQL 18 and Polish text, and what the existing code offers or blocks.

**How.** Seven parallel gatherers. Three read the codebase (supply side and search; needed items, notifications, outbox, moderation; frontend). Four read external sources (five gift platforms; six classifieds and marketplaces; matching and alert delivery; UX, trust and privacy). Each claim carries a file or URL and a confidence level.

**Key findings.**
1. Platforms split the problem in two and never join the halves: a public wanted post that people answer by message, and a private standing query that the system matches for the seeker. No platform matches a wanted post to listings, and none notifies the owner of a matching item.
2. Where wanted posts exist they are minimal (title, free text, optional photo, coarse location), expire on a fixed period (90 days on the two gift networks that document it, 30 on OLX), are closed by the seeker and are throttled, never tied to giving first.
3. The frontend already ships a disconnected mock (`/wanted`, `/add/hunting`, a tile, an account row, an empty-search prompt). Its copy promises one thing: a notification to the seeker when a matching item is added. The brief says "notifies both sides".
4. The backend has the supply side ready (listing record, folded full-text and trigram columns, category tree, locality points, a visibility predicate) and the plumbing (outbox, in-app notifications, synchronous text moderation). It lacks an "item listed" signal, any reverse matching, and any notification deduplication, grouping, preference or cap.
5. Needed items are an organizer's per-term bring-list answered by a pledge that moves no item. They share only moderated free text with a want.
6. On PostgreSQL a want can be stored as a `tsquery` and matched with `@@` against a new item's `tsvector`, but no index serves that predicate; a scan over wants pre-filtered by plain columns is the realistic plan at small scale (reasoned, not measured). PostgreSQL 18 has no Polish stemmer.

**Main conclusions.** Build the seeker-side want first; it has precedent and most of the code. Treat owner notification and public visibility as separate decisions with their own controls. Keep needed items apart. Ship volume controls with the first version.

---

## 2. Research objectives

**Primary question.** How should the platform implement a "szukam" mechanism — data model, matching, notifications, visibility, moderation and UX — based on the best patterns used by comparable platforms, and how does it fit the existing architecture?

**Sub-questions.** Q1 post structure · Q2 matching and Polish text · Q3 notifications and fatigue · Q4 visibility and identity · Q5 lifecycle and link to reservations · Q6 abuse · Q7 UX and the mock · Q8 needed items · Q9 code reuse and boundaries. Status per question is in section 11.

**Included.** Eleven platforms; post structure; matching; notifications; visibility; lifecycle; moderation; UX; fit with `app/search`, `app/inventory`, `app/groups`, notifications, visibility, localities, categories.

**Excluded.** Saved searches as a separate feature (noted where they overlap, and they overlap heavily — see 9.1); `/search` relevance; implementation and specification; monetisation.

---

## 3. Methodology

- **Approach**: parallel mixed research. Codebase gatherers traced models, services, routers, migrations and tests; external gatherers filled a fixed comparison template per platform or technique.
- **Sources**: 15 findings files from 7 gatherers; 11 platforms plus reference products (Peerby, Sharetribe, Freegle, Funda); PostgreSQL 18 and 19 documentation; UX and legal commentary. Lists are in Appendix A.
- **Frameworks**: component and flow analysis with a reuse verdict (as is / extend / new) for code; row-per-platform comparison; option tables for techniques; trade-off analysis for decisions.
- **Confidence scale**: high (code, or several first-party sources), medium (one source or inferred), low (assumption or snippet).
- **Synthesis checks**: each headline point from the gatherers' summaries was re-read in the findings file. Two disagreements between gatherers were settled from code: the outbox poll interval is 60 s (`outbox/scheduler.py:16`; the `main.py:87` docstring says 30 s) and the backend has 11 notification kinds (`notifications/models.py:51-61`) while the frontend union lists 12, still including the removed `PLEDGE_ITEM_REGISTERED` (`api/notifications.ts:3-15`).

---

## 4. Platform comparison

### 4.1 Gift and swap platforms

Sources: `[external-gift-platforms-comparison]`. "n.d." = not documented on the pages read (not the same as absent).

| | Freecycle | Trash Nothing | Olio | Buy Nothing (app) | Bunz |
|---|---|---|---|---|---|
| Wanted type | "Wanted" | "wanted", shown as "Requests" | "Wanted", non-food only | "Ask" | "ISO" |
| Fields | Type, town, title, general location, description, up to 3 photos, optional preset tags | Title, content, photos, map point, expiration, `reselling` flag | n.d.; a specific item required, representative photo recommended | Optional photo, title, description, optional category, location, visibility toggle, optional private community | 2016: images, title, description, "what you want in return", location; current n.d. |
| Who sees it | Town group or own Friends Circle | Group members; some public | n.d. | App-wide, a radius, or one private community (seeker chooses) | Nearby users (unconfirmed for the current app) |
| How givers answer | Private message or e-mail | Private message | "at their own discretion" | Comment or "interested", then message | Like, comment, chat |
| Want matched to listings | Absent | Absent | Absent (n.d.) | Absent | Absent |
| Owner told about a matching want | Absent | Only if the giver saves an alert on Requests | Absent (n.d.) | Absent | Absent |
| Seeker alerts | Tag alerts, in-site counter | Keyword alerts on Offers and/or Requests, e-mail or push, digests | n.d. | n.d. | Saved searches (2025 release notes) |
| Expiry | 90 days, fixed | 90 days | Offers 1–28 days; wanted n.d. | n.d. | n.d.; visibility decays |
| Renewal | New post only | "Repost" pre-fills; repost count kept 90 days | n.d. | Repost encouraged | Repost for BTZ (snippet) |
| Closing | "Mark as received" / "Cancel post" | satisfied / withdrawn / expired | n.d. | "Fulfilled", post stays visible | Hide or delete |
| Limits | "Used sparingly"; weekly cap allowed | Requests repostable after about two weeks | Vague requests removed | None; identical flooding removed | "No spamming" |
| Offer-first rule | Forbidden to require | not found | not found | not found | n/a |
| Confidence | High | High | High for policy, low for mechanics | High; expiry unconfirmed | Medium to low; status after 2026-09-01 unconfirmed |

Key sources: Freecycle https://freecycle.helpscoutdocs.com/article/30-make-a-post , https://freecycle.helpscoutdocs.com/article/97-alerts , https://freecycle.helpscoutdocs.com/article/287-settings , https://www.freecycle.org/pages/ModManual/LocalDecisions ; Trash Nothing http://trashnothing.com/api/v1.4/trashnothing-openapi.yaml , https://trashnothing.com/help/how-do-i-create-a-search-alert , https://trashnothing.com/help/what-are-the-rules-and-guidelines ; Olio https://help.olioapp.com/en/articles/12240702-wanted ; Buy Nothing https://help.buynothingproject.org/article/65-how-to-start-posting-in-buynothing , https://docs.buynothingproject.org/guidelines ; Bunz https://apps.apple.com/ca/app/bunz/id1068061556 , https://betakit.com/the-problem-is-me-bunz-owner-brings-in-gen-z-pranksters-to-save-dying-platform/ .

### 4.2 Classifieds and marketplaces

Source: `[external-classifieds-platform-comparison]`.

| | OLX (Poland) | Vinted | Facebook Marketplace / groups | Gumtree (UK / AU) | Wallapop | Craigslist |
|---|---|---|---|---|---|---|
| Wanted posts | In practice, as ordinary adverts ("Kupię…", "Przyjmę…", "Poszukujemy…"); no type or filter | Forbidden: "requests for an item" are reportable | Marketplace: none (medium). Groups: ISO / "wanted" / "szukam" by convention | UK: "Stuff Wanted" and two more wanted categories. AU: unconfirmed | Reported as forbidden ("compro…/busco…") | "wanted" category |
| Fields | Normal advert form | — | Free-form group post | Normal advert form | — | Title, location, body |
| Visibility | Public, mixed into categories | — | Group members | Public, radius filter | — | Public, per city |
| Want matched to listings | None | — | None | None | — | None |
| Owner told about a want | None | — | None (sellers search the group by hand) | None | — | None |
| Seeker alerts | "Obserwuj wyszukiwanie", app and e-mail, daily as observed | Saved filters, follow a member; alerts unconfirmed officially | New-listing notifications (2021 report) | Saved search; UK daily e-mail; AU up to 50, valid 90 days, immediate/daily/weekly | Saved search with a bell | Saved search with e-mail alerts |
| Expiry | 30 days, e-mail before expiry, extend or reactivate | — | None; sinks in the feed | Unconfirmed for goods | — | Free postings 7–45 days; renew every 48–72 h |
| Limits, moderation | 50 followed searches; per-category advert limits; wanted adverts for animals forbidden | Removal, warning or ban | Admin rules per group | Wrong-category adverts removed | — | "overposted, cross-posted, nonlocal" prohibited |
| Known problems | Trade buyers ("skup") dominate "kupię"; alerts reported imprecise | Forum closed Jan 2024 over moderation load | Alerts reported sporadic | Misfiled for-sale adverts; 70 % in "Miscellaneous"; scams aimed at wanted posters (AU, snippet) | — | For-sale posts and dealers in "wanted" |
| Confidence | High for practice, medium to low for rules (help centre behind login) | High for the ban, medium for alerts | Medium | High (UK category, AU alerts) | Low to medium for the ban, high for saved search | High |

Key sources: OLX https://www.olx.pl/oferty/q-kupi%C4%99/ , https://www.olx.pl/oddam-za-darmo/q-przyjm%C4%99/ , https://blog.olx.pl/2018/10/22/houston-mamy-problem-czyli-emisja-a-promowanie-ogloszenia/ ; Vinted https://www.vinted.co.uk/help/288-guide-to-reporting , https://www.vinted.co.uk/help/433-how-notifications-work ; Facebook https://www.moneysavingexpert.com/family/facebook-selling/ , https://www.facebook.com/policies_center/commerce ; Gumtree https://www.gumtree.com/for-sale/stuff-wanted , https://help.gumtree.com.au/articles/en_US/KB_Article/Creating-Search-Alerts-AU/?l=en_US&fs=RelatedArticle ; Wallapop https://es.wallapop.com/motor-y-accesorios/remolque ; Craigslist https://www.craigslist.org/search/area/newyork?cat=waa , https://www.craigslist.org/about/help/account/features/searches .

### 4.3 What the comparison says

**Evidence.** Across all eleven platforms, no page read describes (a) automatic matching of a wanted post to listings, (b) a notification to the owner of a matching item, or (c) a structured "I have this" answer that links a listed item to a want. Gift gatherer: "Automatic want-to-item matching with two-sided notification is not offered by any of the five platforms … A matching feature would be new ground relative to this group, not a copied pattern." Classifieds gatherer: "Informing the owner of a matching item has no precedent among these six platforms." Matching gatherer: "The owner-side notification … appears in no opened engineering source; all examples notify the seeker only. This is a gap, and the side with the higher spam risk."

**Confidence: medium.** Absence is inferred from help, policy and API pages, not from using the apps; several help centres were unreadable (OLX, Gumtree UK, Facebook, Bunz) and Olio does not document its wanted listing. No platform states why it has no matching; the gift gatherer notes it "may reflect product age and volunteer-run models rather than a judgement that matching does not work".

**What this implies (inference of this synthesis).**
- The owner-side notification in the brief is **novel**. It must not be presented as a best pattern. It carries the risks of any unrequested notification: the owner did not ask for it, there is no evidence on how owners react, and the general evidence says irrelevant alerts lead people to switch notifications off (YouGov 2021: 39 % turn them off entirely when too frequent, https://yougov.com/en-us/articles/36287-how-consumers-feel-about-push-notifications-2021 ).
- The nearest precedents are weaker than the brief's idea: an **opt-in** alert a giver sets on Requests (Trash Nothing), and **request-first** products where requests are pushed to nearby people who have listed nothing (Peerby; company claim of "over 80 percent" fulfilled within 30 minutes, 2013, low confidence; https://techcrunch.com/?p=885310 ). Social-psychology research supports asking directly (Flynn and Lake 2008, medium; https://www.gsb.stanford.edu/insights/francis-flynn-if-you-want-something-ask-it ).
- Seeker-side matching is well supported as a pattern, under the name "saved search alert".

---

## 5. Proven patterns and known failure modes

### 5.1 Patterns with first-party support

| # | Pattern | Evidence | Confidence |
|---|---|---|---|
| P1 | A want has an explicit type; it is not an offer with a flag | Freecycle and Trash Nothing: one post entity with type offer / wanted; Buy Nothing Give / Ask. Where wants share the offer form with no type, offers get misfiled (Gumtree, Craigslist) | High |
| P2 | Minimal fields: title, free text, optional photo, coarse location; category optional; no condition | `[external-gift-platforms-patterns §P2]`, `[external-classifieds-patterns §P2]` | High |
| P3 | Specificity rule: reject "any clothes", "anything unwanted" | Olio wanted article; Freecycle FAQ | High |
| P4 | Text hygiene: no phone, e-mail, address, link, money; declared resale | Freecycle form and guidelines; Trash Nothing `reselling`; Olio; Buy Nothing | High |
| P5 | Seeker closes the want; explicit outcomes (satisfied, withdrawn, expired) | Trash Nothing API; Freecycle "Mark as received"; Buy Nothing "Fulfilled" | High |
| P6 | Fixed default expiry; no reopening; repost as a new, pre-filled post | Freecycle, Trash Nothing (90 days); OLX (30 days, e-mail before expiry; 2018 source, medium) | High / medium |
| P7 | Throttle wants (weekly cap, longer repost interval); never require an offer first or a give/ask ratio | Freecycle moderator manual; Trash Nothing rules; Freegle wiki; Buy Nothing sets no cap | High for the rules; no data on effect |
| P8 | Seeker alert as a standing query with a cap (about 50), a digest default, a validity period (about 90 days) and a one-click off | OLX, Gumtree AU/UK, Wallapop, Craigslist | High for Gumtree, medium for others |
| P9 | Match asynchronously; store matches; deduplicate on a stable id | AWS, Funda, polling post; microservices.io outbox pattern | High |
| P10 | Group bursts: one summary on the first run; combine when more than five | NN/g https://www.nngroup.com/articles/push-notification/ ; polling post (medium) | High for guidance |
| P11 | Controls inside the product per notification type; conservative defaults because most users never change them | NN/g | High |
| P12 | Short form: name first, infer or defer the rest; carry the failed search query into the form | NN/g EAS https://www.nngroup.com/articles/eas-framework-simplify-forms/ ; Baymard field-count research (checkout, low to medium transfer) | High for guidance, medium for application |
| P13 | Keep no-results recovery paths; a wanted prompt is an addition, not a replacement | NN/g and Baymard no-results guidance; neither lists a wanted prompt | High |
| P14 | First contact inside the platform; "never pay to receive a gift" warning | Freecycle guidelines; CERT Orange Polska warning via press (medium) | High / medium |

**Not a proven pattern:** automatic want-to-listing matching with owner notification (section 4.3); anonymous wants (no product precedent; the argument is legal, `[external-ux-trust-abuse-privacy §Open Questions]`); "still looking?" reminders and auto-closing on fulfilment for wants (no source); reputation gates on wants (no evidence).

### 5.2 Failure modes

| Failure mode | Evidence | Platform response | Confidence |
|---|---|---|---|
| Stale wants left open after the need is met | Trustpilot review of Freecycle, 2025-06-09 | Fixed expiry, one-tap "received", outcome filters; no reminder documented | Low to medium (one anecdote; the expiry rules exist on several platforms) |
| Begging and requests for expensive goods | MoneySavingExpert forum (2007); Freecycle FAQ and moderator manual | "Sparingly" norm, weekly cap, local limits on expensive items | Medium |
| Feed flooded by repeated wants | Freecycle replies on Trustpilot (2025, 2026); Buy Nothing guidelines | Repost intervals, caps, removal of identical content | Medium |
| Trade buyers take over | OLX "kupię" results: "Skup Aut…", "KUPIĘ KAŻDĄ TOYOTĘ!!!" per city; Gumtree "CASH FOR PHONES WANTED…" | None documented | Medium (single-day snapshots) |
| Offers misfiled as wants; duplicates | Gumtree 2 of first 10; Craigslist at least 3 of first 10 | Removal of wrong-category adverts | Medium |
| Weak categorisation | Gumtree: 1,121 of 1,591 wanted adverts in "Miscellaneous" | — | Medium |
| Wants answered with sales offers; resellers | Freecycle FAQ; Trash Nothing rules | Warning then removal; resale disclosure | High for the rule, medium for prevalence |
| Imprecise alerts read as spam | One journalist's test of OLX alerts (bezprawnik.pl, 2026-07-13) | — | Low |
| Notification fatigue | YouGov 2021 (US): 42 % change settings, 39 % turn off, 8 % delete the app; LinkedIn "cut member complaints in half" with one gateway | Gateway with dedup, caps, grouping | High for the figures, medium for transfer |
| Slow or inconsistent volunteer moderation | Checkbook article on Buy Nothing; Trustpilot on Freecycle approval delays | — | Medium |
| Free-text community space too costly to moderate | Vinted forum closed January 2024 | Removal of the space | High for the event; link to wants unconfirmed |
| Seekers targeted by scammers | Gumtree AU warning (snippet); move to an outside messenger as the first sign of the main Polish classifieds scam | Keep contact details out of the text | Low / medium |

Not measured anywhere: how often wants are fulfilled, whether caps help, how precise alerts are. Freegle's moderators add a counterpoint: "People, including us, overestimate the number of Wanted posts" (https://wiki.ilovefreegle.org/Best_Practice_Notes , medium).

---

## 6. Map of existing code

### 6.1 What the mechanism would reuse

| Component | Where | Verdict | Note |
|---|---|---|---|
| Routes `/wanted`, `/add/hunting`, login gate, reserved slug | `routing/paths.ts:19,24,138-139`, `routing/reservedSlugs.ts:16`, `src/backend/app/organizations/slugs.py:42`, `app/(site)/(panel)/wanted/page.tsx`, `…/add/hunting/page.tsx` | As is | Both under the client-only `(panel)` group |
| `WantedView`, `HuntingCreateView` | `features/search/WantedView.tsx:7-90`, `features/add/HuntingCreateView.tsx:9-101` | Rewrite on real data | Local state only; two create paths with different fields; delete without confirmation |
| Entry points: `/add` tile, "Konto" row, empty-search prompt | `features/add/AddView.tsx:75-82`, `features/account/AccountView.tsx:42-46`, `features/search/SearchView.tsx:260-281` | Extend | Prompt forwards only `q`; active filters are dropped; "Konto" count is the constant 3 |
| Category picker | `components/shared/CategoryTreePicker.tsx:28-46` | As is | `mode="any"` needed for a non-leaf want |
| Locality combobox; radius chips, last locality, major towns | `components/shared/LocalityCombobox.tsx:27-43`; `features/search/SearchFilters.tsx:138-214`, `features/search/lastLocality.ts` | As is; extract | `LocationSection` is private to `SearchFilters.tsx` |
| Condition and offer-type chips; `SearchFilters` type | `features/search/SearchFilters.tsx:383-422`, `api/search.ts:16-24` | Extract; type as is | The item half of the type plus `q` describes a want |
| Item card for a matches list | `components/shared/ItemCard.tsx:9-50`, `features/search/SearchResultCard.tsx:25-38` | As is | If the backend returns `ProductSearchResult`-shaped rows |
| Notification bell and hook | `components/shared/NotificationBell.tsx:12-80`, `hooks/useNotifications.ts:22-83` | As is | Renders `message`, follows `link_path`, never switches on kind |
| `NotificationKind` union | `api/notifications.ts:3-15` | Extend | Still lists removed `PLEDGE_ITEM_REGISTERED` |
| Take / propose from the item page | `features/product/useItemTake.ts:21-141`, `groups/router/item_reservations.py:44-56` | As is | No origin field, so a reservation cannot be linked back to a want |
| `fold_pl()` | `alembic/versions/0087_fold_pl.py` | As is | IMMUTABLE; usable in generated columns and indexes of a new table |
| `products.search_vector` + GIN; `ix_products_name_trgm` | `product/models.py:45-92`, `alembic/versions/0088_…`, `0094_…` | As is for want→items | Name weight A, description weight C; description has no trigram index |
| `categories.path_text`; subtree CTE | `category/models.py:26-60`; `search/application/search.py:227-234` | Column as is; CTE is private to search | Copy or ACL |
| Listed-items base select | `inventory/infrastructure/repository.py:269-314` | As is | Includes RESERVED and IN_TRANSIT; add `AVAILABLE` and "no pending proposal" for takeable-only alerts |
| Locality dictionary with points | `locations/models.py:43-69`, `alembic/versions/0097_…` | As is | A want can hold a `locality_id` directly; 21 of 54,440 have no point |
| `items_visible_to(viewer, scope)` | `groups/infrastructure/visibility.py:91-108` | As is for want→items; extend for item→wants | Viewer is a value, not a column |
| `parties_share_group` | `groups/infrastructure/visibility.py:41-59` | As is | Accepts a correlated column for one party |
| `can_view_item` / `require_item_visible` | `groups/application/item_visibility.py:28-44` | As is | Re-check at notify or read time; take/propose already call it |
| `register_item` `on_registered` hook | `inventory/application/inventory_items.py:38-40,91-93` | Extend | Runs before commit; the way inventory triggers groups-side work |
| `set_item_listing_preference` | `groups/application/term_item_listings.py:142-198` | Extend | Insert branch = "newly listed"; update branch = mode or visibility change |
| Reservation release | `inventory/application/reservation_transitions.py:80-84` | Extend if release should signal | Inside inventory, which has no listing knowledge |
| Outbox append, registry, dispatcher | `outbox/service.py:22-38`, `outbox/registry.py:13-30`, `outbox/dispatcher.py:17-77`, `outbox/scheduler.py:16` | As is | At least once; 60 s poll; handlers get `(db, payload)` |
| Producer/consumer split for notifications | `groups/application/pledges.py:38-66`, `notifications/outbox_listener.py:53-74` | Pattern | Text and kind stay in `app.notifications` |
| `create_notification` | `notifications/service.py:31-57` | As is | A new kind of up to 30 characters needs no migration |
| Periodic idempotent scan | `groups/application/term_end_scan.py`, `main.py:71-82,120-127` | Pattern | For expiry and digests: bounded window, marker row, one commit |
| `check_text`, `ensure_no_contact_info` | `moderation/text_guard.py:89-120`, `moderation/rules.py:11-36` | Extend / as is | New `TextField` avoids "Nazwa rzeczy…" wording; classifier outage gives 503 |
| ACL pattern | `search/infrastructure/*_acl.py`, `groups/infrastructure/inventory_bridge.py` | Pattern, new files | One ACL per foreign module, no `..schemas` import |
| Authorization matrix | `core/authorization_matrix.py:140-144,192,197-198` | Extend | New rows; first match wins; ownership in the application layer |

Confidence: high (all rows read from code by the gatherers).

### 6.2 What does not exist

| Missing piece | Evidence | Confidence |
|---|---|---|
| Any storage, API client, hook or DTO for wants | grep over `src/frontend/src`; `[codebase-frontend-wanted-mock §F10]` | High |
| A signal when an item becomes listed, changes or becomes available again | No outbox call in `inventory`, `product`, `category`, `locations`, `search`; `[…visibility-signals-boundaries §2]` | High |
| Reverse matching (one new item against many wants) | All text indexes are on item-side columns; `_near` binds the radius as a Python value (`search/application/search.py:163-196`); `items_visible_to` takes the viewer as a value | High |
| A minimum-rank cut-off for "is this a match" | "anything that passes the predicate is a result" (`search/application/search.py:237-269`) | High |
| Ordering of conditions ("at least GOOD") | Equality only (`search/application/search.py:307-308`) | High |
| Notification preferences, mute, digest, cap, deduplication, retention | `[…notifications-outbox §F4, F5]`; no unique key on `notifications`; rows never deleted | High |
| E-mail or push | No library, setting or code; `user_profiles.email` has no verification or consent column (`users/models.py:62`); earlier ADR-009 accepted e-mail for a later phase, not built | High |
| A persistent rate limit or daily cap | Both limiters are in-memory and per process (`messaging/application/send_limiter.py`, `groups/application/join_code_limiter.py`) | High |
| An owner-to-seeker flow | Every reservation starts from the receiver; no conversation kind is anchored to a want (`messaging/models.py:20-60`) | High; medium for the messaging gap |
| A privacy rule for showing a seeker to item owners | `inventory/domain/item_privacy.py` covers reserver and history labels only | High |
| A settings screen for notifications; a notifications page | `[codebase-frontend-needed-items-and-reuse §B5]` | High |
| A separate worker process | Single uvicorn process; scheduler and poller share the event loop (`docker-compose.yml:28`) | High |

### 6.3 Boundary rules that shape the design

- `app.search` and `app.pages` may be imported only by `app/main.py`; code outside their `infrastructure/` imports only `app.core`, `app.db`, `app.storage` and the module itself (`tests/test_module_boundaries.py:17,54-97`). The architecture document says `app.search` "owns no table and writes nothing". Precision: the test checks imports, not writes, so the read-only role is a documented rule, not a tested one. Either way a wants feature cannot import `_matching` or `_near`, and should not live there. If search ever lists wants, it would reach them through a new `search/infrastructure/wants_acl.py`. Confidence: high.
- `app.inventory` never imports `app.groups`; listing knowledge lives in `app.groups`. A "listed" signal raised from the groups listing use cases needs no new dependency (`[…visibility-signals-boundaries §3.3]`).
- Any new select over listing preferences defaults to PUBLIC and opts in to PRIVATE explicitly (`groups/infrastructure/repository.py:771-786`; `standards/backend/models.md`).
- The statement count must not grow with rows (`tests/test_search_api.py:106,219`); a matcher that loops per want or per item breaks the convention.
- A PRIVATE match that is correctly shown can still be refused at take/propose depending on the context (`groups/application/reservation_context.py:48-58`); a seeker outside the owner's groups and events can reserve only through the PERSONAL context, and only when the item has a live place. Matching that ignores this "would notify people about items they cannot take" (`[…notifications-outbox §F15]`).

### 6.4 The mock versus the brief

| Aspect | Mock today | Brief |
|---|---|---|
| Name | Yes, max 120 | Yes |
| Description | Form only, max 1000, discarded on submit | Implied |
| Offer type | Displayed as `modes`, not selectable; new wants get both | Yes |
| Category, condition, location and radius, expiry, photos | None | Yes (photos "to be considered") |
| Match count | Hard-coded number, not a link | Matching |
| Notification to the seeker | Promised in copy five times ("Damy znać, gdy ktoś doda pasującą rzecz") | Yes |
| Notification to the item owner | Not mentioned anywhere | Yes ("notifies both sides") |
| Visibility to others | None; private list under "Konto" | To be decided |
| Edit, fulfil, pause | Delete only | Yes |

Source: `[codebase-frontend-wanted-mock §table]`, high. Earlier documents agree with the mock: the search task deferred the "szukam" backend, stated that wants are "nigdy w wynikach" and planned ranking rule (1) "pasuje do listy „szukam” usera" (`.maister/tasks/development/2026-11-12-global-search-group-description/analysis/task-description.md:45,64,72`). The user guide tells users the list is a demo (`documentation/user-guide.md:12`).

**This is an open product decision, not a research result.** The mock and earlier documents describe a private, seeker-only list; the brief describes two-sided notification. One line of mock copy on the empty search state reads "dasz znać, czego potrzebujesz" (you let others know), which differs from the other four; it is an inconsistency, not evidence of intent.

---

## 7. Relation to needed items

**Statement: keep needed items and wanted posts separate. Do not extend or replace.** Confidence: high for the facts, medium-high for the recommendation (the final call is a product decision).

| Aspect | Needed item (code today) | Wanted post |
|---|---|---|
| Author | The Circle's active organizer only (`groups/application/terms.py:264-276`) | Any logged-in user |
| Scope | Exactly one Term, NOT NULL FK (`groups/models.py:271-285`) | The user's account, standing |
| Content | `name` ≤255, `description` ≤500; no category, product, location, offer type, status or expiry | Text plus optional filters |
| Response | A pledge ("Ja to przyniosę"): one active per need, by a Term participant, no item involved (`groups/models.py:288-307`, `groups/application/pledges.py:69-102`) | A listed item the seeker takes or proposes a swap for |
| Matching | None; people read the list | System matches against listed items |
| Lifecycle | Soft delete by the organizer; otherwise ends with the Term | Create, edit, fulfil, expire, renew |
| Visibility | That of the Term page, with the pledger's name | Its own rules |

History (`[codebase-needs-signals-needed-items §F10]`): migrations 0018–0020 replaced a category enum with a `product_id` FK; 0063 made a pledge "a pure declaration" by dropping `pledges.resolved_reservation_id`; 0067 deleted every pledge and needed item; 0068 replaced `product_id` with a plain `name`. The team already tried "a need points at a catalog product" and "a pledge resolves into a reservation" and removed both on 2026-10-26/27. The migration docstrings give the mechanics, not the product reasons (medium for "why").

What carries over is technique, not tables: demand-side text moderated synchronously like a product name (`groups/application/terms.py:279-292`), soft delete, and the outbox event split (`groups.pledge_claimed` → `PLEDGE_CREATED`). The frontend gatherer reached the same verdict from the UI alone and found the needed-item form "not worth reusing" (`[codebase-frontend-needed-items-and-reuse §A3, A6]`).

Open, and outside this research: whether needed items should one day be matched against listed items too. Nothing in the code prepares for it.

---

## 8. Findings summary

| # | Finding | Category | Confidence | Main sources |
|---|---|---|---|---|
| F1 | No platform matches a wanted post to listings or notifies the owner of a matching item | Platforms | Medium | Both platform pattern files; matching-alerts notifications file |
| F2 | Two halves never joined: public wanted post answered by people; private standing query matched for the seeker | Platforms | High | `[external-classifieds-patterns §P1]`, `[external-gift-platforms-patterns §P10]` |
| F3 | Wanted posts are minimal; no platform asks for condition | Platforms | High | §4 tables |
| F4 | Fixed expiry (90 or 30 days), seeker-closed, explicit outcomes | Lifecycle | High / medium | Freecycle, Trash Nothing, OLX |
| F5 | Wants are throttled, never tied to giving first; cultures differ on caps | Abuse | High for rules | Freecycle, Freegle, Buy Nothing |
| F6 | Public wants attract begging, trade buyers, misfiled offers and stale posts | Abuse | Medium to low | §5.2 |
| F7 | The mock promises a seeker notification only; the brief says both sides | Product | High | `[codebase-frontend-wanted-mock]` |
| F8 | Needed items are a separate concept; structure was added and removed | Codebase | High | `[codebase-needs-signals-needed-items]` |
| F9 | Supply side is ready: listing row, folded full-text and trigram, category subtree, locality radius | Codebase | High | `[codebase-items-search-supply-and-matching]` |
| F10 | Matching runs one way; matching code is private to `app/search`, which is closed | Codebase | High | same; boundary test |
| F11 | No "item listed" signal; three write points known | Codebase | High | `[…visibility-signals-boundaries §2]` |
| F12 | One visibility predicate must gate every match; re-check at read time | Codebase | High | `groups/infrastructure/visibility.py:91-108` |
| F13 | Notifications are in-app only with no preferences, digest, cap, dedup or retention; bell shows newest 50 | Codebase | High | `[…notifications-outbox §F1–F5]` |
| F14 | Outbox (60 s) and one in-process scheduler exist; `term_end_scan` is the model for periodic work | Codebase | High | `[…notifications-outbox §F8–F10]` |
| F15 | Synchronous text moderation and a contact-info rule exist; limiters are in-memory only | Codebase | High | `[…notifications-outbox §F11–F13]` |
| F16 | Seeker→item response exists (take/propose); owner→seeker does not; no want-anchored chat; no origin on a reservation | Codebase | High / medium | `[…notifications-outbox §F14–F17]`, `[…needed-items-and-reuse §B6]` |
| F17 | A stored `tsquery` matches with `@@` but no index serves it; pre-filter then scan | Matching | High for docs, medium for adequacy | PostgreSQL 18 docs `gist.html`, `gin.html` |
| F18 | PostgreSQL 18 has no Polish stemmer; 19 RC 2 adds Snowball Polish; hunspell on 18 is possible at operational cost | Matching | High for facts; quality unconfirmed | `[external-matching-alerts-matching §3]` |
| F19 | Alert fatigue is real; grouping, stored matches, caps and per-type controls are the documented answers | Notifications | High for sources, medium for transfer | YouGov, NN/g, LinkedIn, Funda, Fitz et al. |
| F20 | A want can reveal sensitive facts; expiry is backed by storage limitation; a report channel is a legal duty; commercial messages need per-channel consent in Poland | Legal | Medium for texts, low for application | `[external-ux-trust-abuse-privacy §3]`, `[…lifecycle-notifications §2.4]` |
| F21 | Short form, query carried from empty search, recovery paths kept | UX | High for guidance, medium for application | NN/g, Baymard |
| F22 | Request-first products push requests to people directly (outside the eleven; unlisted supply) | Platforms | Medium / low | Peerby, Sharetribe |

---

## 9. Options and trade-offs per decision area

Each area lists distinct viable approaches for the later brainstorming phase, then a recommendation. Recommendations are this synthesis's inference from the evidence above; none is a detailed design.

### 9.1 Product shape and visibility

| Option | What it is | For | Against | Evidence base |
|---|---|---|---|---|
| A. Private seeker alert | A want is a private list entry; the system matches it and tells the seeker | Matches the mock and earlier documents; platform precedent as saved-search alerts; most code exists; no new public text to police beyond the seeker's own entry; smallest privacy exposure | Functionally a saved-search alert, which the brief excludes as a separate feature; owners never learn of demand; adds nothing when nobody lists the item | High |
| B. Public wanted posts | Wants are browsable; owners answer by hand | Precedent on gift platforms; creates supply by asking (Freegle: requests prompt offers); works for unlisted items | Documented failure modes (§5.2); needs moderation capacity, a response channel that does not exist, a seeker-identity rule, a public route and slug, a report entry point; Article 9 question; contradicts the earlier "nigdy w wynikach" intent | High for the pattern, medium to low for how well it works |
| C. Group-scoped wants | Visible to members of the seeker's groups (or one chosen group) | Matches gift-community practice (town group, private community); reuses `parties_share_group` and scope "mine"; bounded audience limits abuse and exposure | Still needs a response channel and identity rule; smaller audience | Medium |
| D. Private want plus system-mediated owner notification | Wants stay private; the owner of a matching item is told "someone is looking for this" without the seeker's identity | Delivers "both sides" without public text; no browsing surface to pollute | **No precedent**; the owner did not ask; adds little for already-listed items because take/propose already notifies the owner when the seeker acts (inference); needs an off switch and consent thinking | Low (novel) |
| E. A then C or D | Ship A; add visibility or owner notification as separate increments after measuring | Limits the unproven part; keeps the model open | Two rounds of product work | — |

**Recommendation: E, starting with A.** Confidence: medium. Design the want so a visibility field can be added later without reshaping it. If the user wants "both sides" from day one, prefer D with an opt-out and anonymity over B, and say plainly that it is an experiment. Confirm with the user that A does not collide with the "no saved searches" exclusion.

### 9.2 Data model

| Option | What it is | For | Against |
|---|---|---|---|
| A. Extend `needed_items` | Add author, optional term, filters | One demand table | Reverses migrations 0020, 0063, 0067–0068; organizer-only writes and term scope are built into every path; rejected (§7) |
| B. Want as an item or listing with a flag | Reuse inventory rows | Reuses listing code | An item is a ledger-backed inventory row; platforms that mix wants into the offer form get misfiling; Vinted and Facebook define a listing as an item on offer; rejected |
| C. New want entity, name only | `name` (+ optional description), owner, status, expiry | Smallest form; matches the mock's list path | Matching on text alone; no radius; every match is nationwide |
| D. New want entity, name plus optional search-shaped filters | As C plus optional category (any node), offer mode, locality and radius, perhaps condition | The fields search already filters on (`search/application/search.py:272-348`); gives the indexable pre-filter for reverse matching; the empty-search prompt can carry active filters; a want can be opened as a search URL | More form to design; condition has equality only, no "at least" ordering; no platform asks for condition |

Cross-cutting choices:
- **Match record**: a (want, item) table with a unique key serves deduplication, the "matches for this want" list and digest input (Funda; `INSERT … ON CONFLICT DO NOTHING … RETURNING`). Without it there is no deduplication anywhere. Recommended.
- **Module home**: a new module with its own ACLs (clean boundary; some small copies, as the parity-tested link builders show) versus inside `app/groups` (listing knowledge and the notification bridge are already there; but `app/groups` is already the largest context). `app/search` is ruled out. Left to the design phase; the evidence favours a new module reached through ACLs.
- **Photos**: optional everywhere; Olio and Buy Nothing say a photo raises response on a public want. For a private want a photo has no reader. Defer.
- **Loose pointers**: listing preferences point at items without an FK (`groups/models.py:356-360`); a match table would follow the same convention and needs its own staleness handling.

**Recommendation: D with only the name required, plus the match table.** Confidence: medium-high for "new entity", medium for the field set. Which optional fields appear in the first form is a product choice; NN/g's guidance says ask for the name, infer or default the rest.

### 9.3 Matching

**When to match**

| Option | For | Against |
|---|---|---|
| A. Forward only, periodic: re-run each want as a search on a schedule | No reverse logic; reuses search-shaped selects | Delay; one query per want per run conflicts with the constant-statement convention; first-run flood |
| B. Reverse on new item only | Timely | A new want sees nothing already listed |
| C. Both: forward once on want create (capped summary), reverse on each newly listed item | Complete; matches the percolator model and the polling post | Two code paths; reverse direction needs correlated radius and visibility predicates |

**Where it runs**

| Option | For | Against |
|---|---|---|
| In the listing request | Immediate | Lengthens an already long transaction |
| Outbox event from the listing write points | Atomic with the listing; existing machinery; three sources recommend buffering | Up to 60 s delay; at-least-once, so the consumer must be idempotent |
| Periodic scan | Simple; natural home for expiry and digests | Delay; needs a marker |

**How text is compared**

| Option | Fit | Cost | Risk | Confidence |
|---|---|---|---|---|
| A. Existing recipe: `'simple'` full-text (all words) OR trigram word similarity on the folded name OR category, with a stricter threshold for alerts | Reuses columns and indexes for want→items; a scan for item→wants | Negligible | Inflected forms match only through trigram on the name; threshold must be tuned; false positives on short words | High that it works mechanically; quality unmeasured |
| B. Stored `tsquery` per want, `@@` after plain-column pre-filter | Standard PostgreSQL | Negligible at small scale | No index for `@@` on the query column; strict AND | High for docs, medium for adequacy |
| C. GiST `tsquery_ops` with `<@` as a candidate filter | Same | Extra index | Untested inference; lossy; AND-only wants | Low |
| D. Hunspell Polish dictionary on PostgreSQL 18 | Real lemmas | Custom database image on every environment including test containers; per-session load; rebuild of every stored vector and query; folding order conflict with `fold_pl()` | Brand names and slang fall through | High for the recipe, medium for cost |
| E. Wait for PostgreSQL 19 Snowball Polish | Built in | Upgrade, reindex, recompute stored vectors | RC 2 as of 2026-11-12, GA date not published; quality on short listings unconfirmed; expects diacritics | High for the release-note fact |
| F. Application lemmatiser (Morfeusz 2) | Keeps PostgreSQL stock | Native dependency; ambiguity handling; licence not checked | — | Medium |
| G. Small embedding model + pgvector | Semantic matches | Extension in the image, a model in the app process, re-embedding on edits | Yes/no threshold unknown for three-word Polish wants; CPU and memory unconfirmed | Medium |
| H. Search engine with a percolator | The reference model | A new service | Out of proportion at this scale | High that it is unnecessary now |

Other matching decisions with evidence: pre-filter by status, category subtree, mode and radius before text (AWS; the only indexable part); apply `items_visible_to` or its correlated equivalent on every match and re-check with `can_view_item` at read time; decide whether a match must be takeable (AVAILABLE, no pending proposal, a context the seeker can use); exclude the seeker's own items; decide whether a released reservation or an edited item re-triggers matching (no source; product decision).

**Recommendation: both directions (C), from the outbox, with recipe A (B is the same idea stored), behind the match table.** Confidence: medium. Do not add D–H now. Before committing to thresholds, run two cheap checks: an `EXPLAIN ANALYZE` of the reverse statement on realistic row counts, and a small labelled set of real Polish want/item title pairs to measure precision and recall. Revisit a Polish configuration when PostgreSQL 19 is generally available.

### 9.4 Notifications

**Who is notified**

| Option | For | Against |
|---|---|---|
| Seeker only | Requested by the seeker; all precedent; the mock | Does not meet the brief's "both sides" |
| Seeker and owner | The brief | No precedent; unrequested; needs its own kind, off switch and default; adds little for listed items (inference) |
| Owner only on opt-in ("tell me when someone wants what I list") | Precedent: Trash Nothing alert on Requests | A setting nobody may turn on |

**How it is delivered**

| Option | For | Against |
|---|---|---|
| A. In-app row per match | Exists; a new kind needs no migration | Floods on the first run and on popular wants; pushes action prompts out of the 50-row bell |
| B. In-app with grouping: one summary on want create, one row per want per window | NN/g, polling post; protects the bell | Needs a periodic or delayed step; slight delay on scarce items |
| C. Daily digest from the match table | Funda; Fitz et al. (batching improved well-being, n = 237) | Item may be gone by send time; needs a liveness check; in-app only today, so a digest is just a grouped row |
| D. E-mail or push | Reaches users outside the app | Nothing exists; e-mail needs verified, consented addresses, RFC 8058 unsubscribe; Polish consent rule per channel (legal review); earlier ADR-009 deferred e-mail |

Controls that the evidence asks for together: a unique (want, item) key so a pair alerts once; a per-want mute as well as any global switch; a per-user cap as a database count (number is a product guess; no source gives a tested value); skip items already viewed, reserved or no longer listed at send time (LinkedIn's "already engaged or expired" filter, inference); keep the match kind out of `derivePendingActions`; pass user text through `clock.fit_notification_message`.

**Recommendation: seeker only, in-app, option B, with the controls above shipped in the same increment.** Confidence: medium-high for the shape, low for any specific number. E-mail and push stay out until the channel decision from the earlier research is taken up and a lawyer confirms the consent position.

### 9.5 Lifecycle

| Decision | Options | Evidence |
|---|---|---|
| Default expiry | 30 days (OLX), 60, 90 (Freecycle, Trash Nothing) | No data on the best period. A matched want needs no bumping, so a longer period costs little noise (inference). Storage limitation supports having one |
| Before expiry | Silent removal (gift networks) vs reminder then close (OLX; marketplace snippets, low) | Reminder is the safer shape; unconfirmed for wants |
| Closing | Seeker marks it found (all platforms); auto-close when a reservation follows a match | Auto-close has no source and no hook: take/propose carry no origin and "nothing in take/propose would close or fulfil a want" |
| States | open, fulfilled, withdrawn, expired (Trash Nothing) | High |
| Edit | Edit in place vs replace (Funda treats an edit as a new search) | One source; decide whether an edit re-runs forward matching |

**Recommendation:** a default expiry with one reminder, seeker-driven closing with explicit outcomes, and a prompt to close after the seeker reserves a matched item instead of automatic closing. Confidence: medium; the period is a product choice.

### 9.6 Moderation and abuse

| Control | Status in code | Evidence |
|---|---|---|
| Contact-info rule then classifier, synchronously on write | Exists; add a `TextField` for wants | Precedent in needed items; a classifier outage returns 503 |
| Cap on active wants and on new wants per period | New; must be a database count | Freecycle weekly cap; in-memory limiters lose state on restart |
| Specificity rule | New; a minimum-length or "not only a category word" check is the cheap form (inference) | Olio |
| No offer-first or ratio gate | Nothing to build | Freecycle, Freegle, Buy Nothing |
| Report entry point | Needed once wants are visible to others | Trash Nothing; DSA Articles 16–17 via an unofficial mirror (medium) |
| Sensitive wants | New thinking; only matters once wants or their existence are shown to others | CJEU C-184/20 via commentary (medium); application low |

The classifier detects harm categories, not spam, begging or off-topic requests (`[…notifications-outbox §F11]`). For a private want, most abuse scenarios disappear: nobody else reads the text. This is one more argument for starting with 9.1 option A (inference).

### 9.7 Response flow

| Option | Status |
|---|---|
| Seeker opens the matched item and takes or proposes | Exists end to end; notifies both parties already |
| Owner offers a listed item to a seeker ("mam to") | New: no owner-initiated reservation, no want-anchored conversation |
| Owner without a listed item answers a public want | New: needs a message channel or a "list it now" path; `ItemCreateView` can pass navigation state after create (`features/items/ItemCreateView.tsx:89`) |

**Recommendation:** the first only, in the first increment. Confidence: high that it suffices for a private want.

### 9.8 UX entry points

- Keep both existing entries and make them one source of truth (one hook feeding the list, the count and the form). The mock's two create paths differ; pick one field set.
- The empty-search prompt should stay beside the plain "nothing found" statement and the "search everywhere" path, and can forward the active filters as well as `q` (`[codebase-frontend-wanted-mock §F7]`; NN/g, Baymard). Whether `?name=` survives a guest's login round trip was not traced.
- The match line is plain text today; where matches open (a list of item cards, or search pre-filled from the want) is undesigned.
- Asking for push permission right after saving a want is the recommended moment if push is ever added (web.dev, high).

---

## 10. Conclusions and recommendations

### 10.1 Direct answer to the research question

Implement "szukam" as a **seeker-owned want** stored in a new backend module: a required name, optional filters in the shape search already uses, a status and a default expiry. Match it to listings **in both directions**, asynchronously through the outbox, with the existing folded full-text and trigram comparison under a stricter threshold, always behind the visibility predicate, and record each pair once in a match table. Notify **the seeker**, in-app, grouped. Moderate the text with the existing synchronous checks and cap wants by a database count. Leave needed items alone.

This follows the best available patterns for everything except the brief's "notifies both sides". **No comparable platform does that.** If the product wants it, it should be added as a clearly separate, opt-out, identity-hiding experiment after the first increment, and after a lawyer has looked at the privacy and consent points.

### 10.2 Conclusions with confidence

| # | Conclusion | Confidence |
|---|---|---|
| C1 | Owner-side notification and automatic want-to-listing matching have no precedent on the eleven platforms | Medium |
| C2 | A private seeker-side want fits the existing architecture with mostly wiring | High for the inventory, medium for effort |
| C3 | Needed items stay separate | High (facts), medium-high (recommendation) |
| C4 | The feature belongs in its own module, not in `app/search` | High |
| C5 | Reverse matching is feasible on PostgreSQL 18 without new infrastructure | Medium (documented mechanics, unmeasured cost) |
| C6 | Match quality on inflected Polish is the main technical unknown | Medium |
| C7 | Notification controls must ship with the feature | High |
| C8 | Public wants bring known abuse patterns and an open legal question | Medium |

### 10.3 Recommendations

| # | Recommendation | Priority | Effort | Rationale | Risk if skipped |
|---|---|---|---|---|---|
| R1 | Decide product shape with the user: seeker only or both sides; private, group or public; and confirm the saved-search scope line | Critical, first | Small | Everything else depends on it; mock and brief disagree | Building the unproven half by default |
| R2 | Start with the private want and seeker notification | High | Medium | Precedent, ready code, smallest abuse and privacy surface | — |
| R3 | New want entity and match table in a new module with ACLs | High | Medium | Boundary rules; deduplication; list and digest source | Repeat alerts; boundary test failures |
| R4 | Raise a "listed" signal at `register_item` (via `on_registered`) and the insert branch of `set_item_listing_preference`; decide on release and edits | High | Small to medium | No signal exists | New items never matched |
| R5 | Match both ways from the outbox with the existing text recipe and a stricter threshold | High | Medium | §9.3 | Missed or noisy matches |
| R6 | Measure before tuning: `EXPLAIN ANALYZE` on realistic counts; a labelled sample of Polish pairs | High | Small | Scan adequacy and Polish quality are both unmeasured | Wrong thresholds; surprise latency |
| R7 | Ship grouping, per-want mute, a per-user cap and pair deduplication with the first version | High | Small to medium | Nothing exists; first recommendation-type notification in the system | Fatigue; action prompts pushed out of the bell |
| R8 | Give wants their own `TextField`, the contact-info rule, a database-count cap and a default expiry with a reminder | Medium | Small | §9.5, §9.6 | Stale and spammy wants |
| R9 | Legal review before public wants, owner notifications or e-mail | High before those increments | External | Findings rest on commentary | Compliance exposure |
| R10 | Do not add a Polish dictionary, embeddings or a search engine now; revisit when PostgreSQL 19 is generally available | Medium | None | Cost without measured benefit | — |
| R11 | Keep needed items unchanged | — | None | §7 | Reversing recent decisions |

### 10.4 Quality assessment of the evidence

| Strengths | Weaknesses |
|---|---|
| Code facts read with file and line; two cross-gatherer discrepancies resolved from code | "Absent on all platforms" rests on documentation, not app use |
| First-party sources for the main platform rules | OLX, Gumtree UK, Facebook, Bunz help pages unreadable; Olio undocumented |
| PostgreSQL behaviour taken from the official documentation | Nothing measured: no query plan, no match-quality sample, no volume figures |

| Opportunities | Threats |
|---|---|
| Mock, routes, pickers, bell and take/propose are reusable | Notification volume in a system with no controls |
| Search filter shape doubles as the want shape | Polish inflection lowering match recall |
| PostgreSQL 19 may bring a built-in Polish stemmer | Legal reading of Article 9 and Article 398 unreviewed |

### 10.5 Confidence by area

Overall: **medium**. The code map is high, but the central external claim rests on absence in documentation, nothing about matching was measured, and the legal points are unreviewed.

| Area | Confidence | Reason |
|---|---|---|
| Codebase map | High | Read from code with file and line |
| Platform comparison | High to low by platform | First-party pages where they opened; see the Confidence rows in section 4 |
| "No platform matches wants or notifies owners" | Medium | Absence inferred from documentation |
| Failure modes | Medium to low | Snapshots, reviews, one test |
| Needed items: keep separate | High for the facts | Code and migration history |
| Matching technique | High for the documentation, medium for adequacy, low for Polish quality | Nothing measured |
| Notification delivery | High for the current state, medium for transfer | General research; no tested cap |
| Privacy and law | Medium for the texts, low for their application | Commentary and unofficial mirrors |
| UX | High for the guidance, medium for the application | No study of wanted-post forms |

---

## 11. Sub-questions: status

| # | Question | Status |
|---|---|---|
| Q1 | What a wanted post consists of | Answered (§4, §5.1 P2) |
| Q2 | When and how to match; Polish on PostgreSQL | Answered as options; quality and cost unmeasured (§9.3) |
| Q3 | Who is notified, how often, fatigue | Answered as options; who is notified is a product decision; no tested cap (§9.4) |
| Q4 | Who may see a want and the seeker | Options given; unresolved product decision; legal review needed (§9.1) |
| Q5 | Lifecycle and link to reservations | Answered; no link from a reservation back to a want exists (§9.5) |
| Q6 | Abuse handling | Answered (§9.6) |
| Q7 | Where wants are created, browsed, answered; what the mock promises | Answered for create and the mock; browsing and "mam to" are undesigned (§6.4, §9.7) |
| Q8 | Needed items | Answered: keep separate (§7) |
| Q9 | Modules, tables, ACLs, boundaries | Answered (§6) |

---

## 12. Appendices

### Appendix A. Sources

**Findings files** (in `analysis/findings/`):
`codebase-items-search-supply-and-matching.md`, `codebase-items-search-visibility-signals-boundaries.md`, `codebase-needs-signals-needed-items.md`, `codebase-needs-signals-notifications-outbox.md`, `codebase-frontend-wanted-mock.md`, `codebase-frontend-needed-items-and-reuse.md`, `external-gift-platforms-comparison.md`, `external-gift-platforms-patterns.md`, `external-classifieds-platform-comparison.md`, `external-classifieds-patterns.md`, `external-matching-alerts-matching.md`, `external-matching-alerts-notifications.md`, `external-ux-trust-forms-entry-response.md`, `external-ux-trust-abuse-privacy.md`, `external-ux-trust-lifecycle-notifications.md`.

**Planning**: `planning/research-brief.md`, `planning/research-plan.md`.

**External sources** are listed with URLs in each findings file; the platform sources used for the comparison are repeated under the tables in section 4. Matching and delivery: PostgreSQL 18 documentation (`functions-textsearch`, `textsearch-indexes`, `gist`, `gin`, `pgtrgm`, `textsearch-dictionaries`, `sql-insert`), https://www.postgresql.org/docs/19/release-19.html , https://www.depesz.com/?p=4454 , https://snowballstem.org/algorithms/polish/stemmer.html , https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-percolate-query.html , https://aws.amazon.com/blogs/big-data/working-with-percolators-in-amazon-opensearch-service , https://blog.funda.nl/how-we-enhanced-the-saved-search-feature-with-opensearch/ , https://microservices.io/patterns/data/transactional-outbox.html , https://www.linkedin.com/blog/engineering/messaging-notifications/air-traffic-controller-member-first-notifications-at-linkedin , https://scholars.duke.edu/publication/1402953 , https://www.rfc-editor.org/rfc/rfc8058 . UX and trust: https://www.nngroup.com/articles/search-no-results-serp/ , https://baymard.com/blog/no-results-page , https://web.dev/articles/push-notifications-permissions-ux , https://wiki.ilovefreegle.org/Best_Practice_Notes , https://ar5iv.labs.arxiv.org/html/2211.09043 , https://www.insideprivacy.com/eu-data-protection/special-category-data-by-inference-cjeu-significantly-expands-the-scope-of-article-9-gdpr/ , https://gdpr-info.eu/art-9-gdpr/ , https://gdpr-info.eu/art-5-gdpr/ , https://www.prawo.pl/biznes/zgody-marketingowe-i-kontakty-handlowe-co-mowi-prawo-komunikacji-elektronicznej,530981.html .

### Appendix B. Gaps and uncertainties

- Not published by any platform: fulfilment rate of wants, effect of caps, alert precision.
- Unreadable or undocumented: OLX help centre and rules (login redirect); Gumtree UK help; Facebook Help Centre; Bunz FAQ (403) and its state after 2026-09-01; Olio wanted-listing fields, duration and visibility; Buy Nothing Ask expiry.
- Unmeasured: reverse-scan cost; match precision and recall on Polish; embedding model CPU and memory; expected numbers of wants and items.
- Untested inference: GiST `<@` candidate filter (low).
- No source: optimal expiry for wants; numeric alert cap; effect of quiet hours; "still looking?" reminders; auto-close on fulfilment; ranking wants for an owner; which item-side events should re-trigger matching; anonymous wants as a product feature.
- Legal: all points from commentary, legal press or unofficial mirrors; the Polish court ruling on service versus marketing messages was not opened.
- Code not fully traced: `?name=` through the login round trip; facade exports for a new ACL; `set_personalised_cache_headers` body; messaging internals behind the "no want-anchored conversation" statement; multi-worker scheduler behaviour.

### Appendix C. Contradictions between sources

| Topic | Positions | Standing |
|---|---|---|
| Outbox poll interval | 30 s (docstring, one gatherer) vs 60 s (constant, another) | Resolved: 60 s, `outbox/scheduler.py:16` |
| Number of notification kinds | 11 (backend) vs 12 (frontend) | Resolved: frontend union still lists removed `PLEDGE_ITEM_REGISTERED` |
| Want as peer of an offer vs own object | Gift platforms vs classifieds | Reconciled: both need an explicit type |
| Caps on wants | Freecycle cap vs Freegle and Buy Nothing none | Open; product decision |
| Expiry period | 90 vs 30 vs 7–45 days | Open; no data |
| Vinted alerts | Not in the official list vs reported by third parties | Unconfirmed |
| Facebook Marketplace wanted option | Absent vs claimed by unopened pages | Medium for absent |
| Wallapop alert frequency | Daily (2019) vs instant (current) | Read as a change over time |
| Who is notified | Brief: both sides vs mock and earlier documents: seeker | Open; product decision |

### Appendix D. Out-of-scope observation (unverified)

`PUT /api/products/{id}` is gated only by the EDIT permission at the router (`product/router.py:111-116`), and the gatherer saw no ownership check in `update_product` (`product/service.py:164-181`). It was "not traced further" (medium). Products are shared catalog rows, so a rename would change what every item of that product matches. This needs its own check; it is not part of this research.
