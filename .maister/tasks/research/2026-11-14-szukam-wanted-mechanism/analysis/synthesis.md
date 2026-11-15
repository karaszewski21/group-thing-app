# Synthesis: "Szukam" (wanted) mechanism

## TL;DR
- None of the eleven platforms matches a wanted post to listings or tells an item's owner about a want. Machine matching exists only as the seeker's own saved search or keyword alert. "Notify both sides" is new ground, not a copied pattern.
- The codebase is close to a private, seeker-side want (routes, mock UI, search text columns, outbox, in-app notifications, text moderation) and far from a two-sided or public one (no "item listed" signal, no reverse matching, no notification preferences or deduplication, no owner-to-seeker flow).
- Needed items are a different concept; their structured form was tried and removed. Keep them separate.
- Overall confidence: medium. Code facts are high; "no platform does this" is medium (inferred from documentation); scale, match quality in Polish and the legal points are unmeasured or unreviewed.

## Key Decisions
- Treat owner-side notification as novel and unproven — no source among eleven platforms or the engineering write-ups shows it; the nearest precedents are opt-in (Trash Nothing alert on Requests) or request-first products with unlisted supply (Peerby).
- Report the mock/brief difference as an open product decision, not resolve it — the mock promises a notification to the seeker only; the brief says "notifies both sides".
- Recommend "keep separate" for needed items — owner, scope, response and lifecycle all differ in code, and migrations 0018–0020, 0063, 0067–0068 removed the structure a merge would need.
- Rule out `app/search` as the home of the feature — it is read-only by design and importable only from `app/main.py`.
- Resolve two gatherer contradictions from code: the outbox poll is 60 s (docstring says 30 s); the backend has 11 notification kinds, the frontend union has 12 because it still lists the removed `PLEDGE_ITEM_REGISTERED`.

## Open Questions / Risks
- Product shape is undecided: private alerts only, public wanted posts, or both; and whether owners are notified at all.
- A private want with automatic matching is functionally a saved-search alert, which the brief excludes "as a separate feature". The scope line needs confirming.
- No measurement exists for match quality on short Polish texts with `'simple'` + trigram, or for scan cost; the number of items and wants to expect is an assumption ("thousands").
- Article 9 GDPR (wants that reveal health or belief) and Article 398 of the Polish Electronic Communications Law rest on commentary; a lawyer must confirm before public wants, owner notifications or email.
- The bell shows the newest 50 rows and nothing is deleted; match notifications can push action prompts out of view.

---

## 1. Research question

How should the platform implement a "szukam" (wanted / in-search-of) mechanism — data model, matching, notifications, visibility, moderation and UX — based on the best patterns used by comparable platforms, and how does it fit the existing architecture?

Inputs: 15 findings files from 7 gatherers (3 codebase, 4 external), the brief and the plan. Code paths below are relative to `src/backend/app/` or `src/frontend/src/` unless written in full. Findings files are cited as `[file §id]`.

## 2. Verification of the points raised in the gatherers' summaries

Each point was checked against the findings files; two were also checked against the code where gatherers disagreed.

| # | Point | Verdict | Basis |
|---|---|---|---|
| 1 | No platform matches wants to listings or notifies the owner | Borne out, at medium confidence | `[external-gift-platforms-patterns §"Features absent"]` (medium, "absence is inferred from documentation, not from using the apps"); `[external-classifieds-patterns §P1]` (medium); `[external-matching-alerts-notifications §Open Questions]` ("all examples notify the seeker only") |
| 2 | Mock promises only a seeker notification; brief says both sides | Borne out, high | `[codebase-frontend-wanted-mock §F1, F3, F5, table]`; `planning/research-brief.md:4` |
| 3 | Needed items are separate; structured form was removed | Borne out, high for facts, medium for the reasons | `[codebase-needs-signals-needed-items §F1, F10]`; `[codebase-frontend-needed-items-and-reuse §A6]` |
| 4 | No "item listed" signal; `app/search` cannot host it; matching is one way | Borne out, high — with one precision: the boundary test checks imports, not writes; the read-only role is documented, not test-enforced | `[codebase-items-search-visibility-signals-boundaries §2, §3.1]`; `[codebase-items-search-supply-and-matching §3]` |
| 5 | Notifications in-app only, no preferences, digests, caps, dedup | Borne out, high | `[codebase-needs-signals-notifications-outbox §F4, F5]` |
| 6 | `'simple'` config on PostgreSQL 18; Polish stemmer in PostgreSQL 19 RC | Borne out; facts high, stemmer quality unconfirmed, GA date not published | `[external-matching-alerts-matching §3.1, §3.2]` |
| 7 | Stored `tsquery` cannot be indexed for `@@`; scan is adequate | First half high (operator-class tables); second half medium, "reasoning from the sources above, not a measured result" | `[external-matching-alerts-matching §2.2, §2.4]` |
| 8 | GDPR and Polish electronic-communications points need a lawyer | Borne out; sources are law-firm commentary, unofficial mirrors and legal press | `[external-ux-trust-abuse-privacy §3.1–3.3]`; `[external-ux-trust-lifecycle-notifications §2.4]` |
| 9 | `PUT /api/products/{id}` may lack an ownership check | Unverified; the gatherer says "Not traced further (medium)". Out of scope | `[codebase-items-search-supply-and-matching §Open Questions]` |

## 3. Cross-source analysis

### 3.1 Findings confirmed by more than one source

| Finding | Sources that agree | Confidence |
|---|---|---|
| Wants on platforms are answered by a person, not by the system | Gift gatherer (5 platforms), classifieds gatherer (6), UX gatherer (Trash Nothing, Freegle) | High for the documented flows |
| The seeker's machine tool is a standing query (saved search, keyword or tag alert) | Trash Nothing, Freecycle, Bunz; OLX, Gumtree, Wallapop, Craigslist, Facebook; Funda as the engineering case | High |
| Needed items are a per-term organizer list, unrelated to listed items | Backend gatherer (models, services, migrations), frontend gatherer (UI), earlier search task (`.maister/tasks/development/2026-11-12-global-search-group-description/analysis/codebase-analysis.md:28,48`) | High |
| A want was intended as a private per-user list | Mock UI under the logged-in panel and "Konto"; earlier task: "listy „szukam” … nigdy w wynikach" and ranking rule (1) | High for quotes, medium for the reading |
| Matching should run asynchronously | AWS, Funda, the polling post (three independent sources); codebase has the outbox and warns about the long listing transaction | High |
| Expiry by default | Freecycle and Trash Nothing (90 days), OLX (30 days), Craigslist (7–45), GDPR Art. 5(1)(e) | High for practice; the right period is unsupported by data |
| Text hygiene: no contact details, no money | Freecycle, Trash Nothing, Olio, Buy Nothing; codebase already has `ensure_no_contact_info` for public listing text | High |
| Offer-first or ratio rules are rejected | Freecycle (forbidden), Freegle (called discriminatory), Buy Nothing (no cap) | High |
| Group several matches into one notification | NN/g (more than five), the polling post (first-run summary), LinkedIn (grouping), Funda (daily email) | High for guidance, medium for transfer |

### 3.2 Contradictions and how they stand

| Contradiction | Resolution |
|---|---|
| Outbox poll interval: "30 s" (`[…visibility-signals-boundaries §2.6]`) vs "60 s" (`[…notifications-outbox §F8]`) | Resolved from code: `outbox/scheduler.py:16` `DEFAULT_INTERVAL_SECONDS = 60`; `main.py:87` docstring is stale. Use 60 s. |
| Notification kinds: 11 (backend gatherer) vs 12 (frontend gatherer) | Resolved from code: `notifications/models.py:51-61` has 11; `api/notifications.ts:3-15` has 12 because it still lists `PLEDGE_ITEM_REGISTERED`, whose rows migration 0063 deleted. Both gatherers were right about their side. |
| Gift platforms: "a want is a peer of an offer, same form" (P1) vs classifieds: "a wanted post must be its own object, never a listing with a flag" | Not a real conflict. Gift platforms have one post entity with an explicit type (offer / wanted). Classifieds that reuse the offer form with no type get misfiled offers and trade buyers (Gumtree, Craigslist, OLX snapshots). Common ground: an explicit type. Inference for this codebase: an item is an inventory row with a ledger balance, so a want cannot be an item with a flag in any case. |
| Limits on wants: Freecycle "sparingly", weekly cap vs Freegle "no restrictions" vs Buy Nothing "as often as they'd like" | Unresolved; a difference of community culture. No platform publishes data on the effect of caps. Product decision. |
| Expiry length: 90 days (gift networks) vs 30 days (OLX) vs 7–45 (Craigslist) | Unresolved; "no source gives a tested optimal period for wants". Note that in a matching model a want needs no bumping, so a long period costs less feed noise than on those platforms (inference from `[…lifecycle-notifications §1.2]`). |
| Alert frequency: Wallapop daily (2019 reports) vs instant (current page) | Read as a change over time; medium. |
| Vinted saved-search alerts: absent from the official notification list vs reported by two third-party sources | Unconfirmed officially; medium that they exist. |
| Facebook Marketplace "wanted" option: absent (MoneySavingExpert) vs claimed by unopened third-party pages | Medium for absent. |
| Empty-search copy: "dasz znać, czego potrzebujesz" (you tell others) vs "damy znać" in four other places (we will tell you) | A wording inconsistency in the mock itself (`features/search/SearchView.tsx:260-281`); it happens to mirror the open product question (public vs private). Not evidence of intent either way. |
| Brief: "notifies both sides" vs mock and earlier task documents: seeker only | Unresolved by design; reported as an open product decision. |

### 3.3 Confidence by area

| Area | Confidence | Reason |
|---|---|---|
| Codebase map (what exists, what is missing) | High | Read from code with file and line; two cross-gatherer discrepancies resolved from code |
| Platform comparison: what each platform has | High for Freecycle, Trash Nothing, Buy Nothing, Craigslist, Gumtree UK; medium for OLX (help centre behind login, read as excerpts), Vinted alerts, Facebook, Wallapop; low for Olio details and current Bunz | First-party pages where they opened; text-extraction tool, wording not re-checked |
| "No platform matches wants or notifies owners" | Medium | Absence inferred from documentation, not from using the apps |
| Failure modes | Medium to low | Single-page snapshots, a 2007 forum thread, reviews, one journalist's test |
| Needed items: keep separate | High for the facts; the recommendation is medium-high | Code and migration history; the final call is a product decision |
| Matching technique on PostgreSQL | High for what PostgreSQL supports; medium for "a scan is enough"; low for match quality in Polish | Documentation read; nothing measured; no test corpus |
| Notification delivery | High for the current state and for general guidance; medium for transfer to match alerts; no tested numeric cap | General push/email research, one marketplace-type case at 1,000 times the scale |
| Privacy and law | Medium for the texts, low for their application | Commentary and unofficial mirrors |
| UX of the form and entry points | High for the guidance, medium for the application | No study of wanted-post forms exists |

## 4. Patterns and themes

### 4.1 Patterns on the platforms

| Pattern | Evidence | Prevalence | Quality of evidence |
|---|---|---|---|
| P-A. Two halves that are never joined: a public wanted post that nobody matches, and a private standing query that is matched but that suppliers never see | `[external-classifieds-patterns §TL;DR, P1]`; `[external-gift-platforms-patterns §P10]` | 11 of 11 fit one or both halves | High for the split |
| P-B. Minimal want: title, free text, optional photo, coarse location; category optional or a tag; no condition | `[external-gift-platforms-patterns §P2]`; `[external-classifieds-patterns §P2]` | All platforms that have wants | High |
| P-C. Explicit type and explicit outcome states (open, satisfied, withdrawn, expired) | Trash Nothing API; Freecycle "Mark as received"; Buy Nothing "Fulfilled" | 3 of 5 gift platforms documented | High |
| P-D. Fixed expiry, no reopening, repost as new | Freecycle, Trash Nothing 90 days; OLX 30 days with an e-mail before expiry | 4 documented | High / medium (OLX source from 2018) |
| P-E. Throttle wants, never condition them on giving | Freecycle cap; Trash Nothing repost interval; Freegle and Buy Nothing no cap | Split culture | High for the rules, none for their effect |
| P-F. Text hygiene and declared resale | Freecycle, Trash Nothing (`reselling` flag), Olio, Buy Nothing | 4 of 5 gift platforms | High |
| P-G. Alert mechanics: cap about 50, daily digest default, validity about 90 days, one-click off | OLX, Gumtree AU/UK, Wallapop | 3–4 classifieds | High for Gumtree, medium for others |
| P-H. Request-first with pushed requests (outside the eleven) | Peerby, Sharetribe reverse marketplace | 2 references | Medium for the model, low for the numbers |

### 4.2 Patterns in the codebase that a want would follow

| Pattern | Where | Maturity |
|---|---|---|
| One ACL file per foreign module; closed read-only modules guarded by an AST test | `search/infrastructure/*_acl.py`, `tests/test_module_boundaries.py:17,54-97` | Established, test-enforced |
| Inventory never imports groups; groups-side work runs through an injected callback before commit | `inventory/application/inventory_items.py:38-40,91-93` | Established, one user |
| Producer names the event and the facts; notifications owns kind and wording | `groups/application/pledges.py:38-66`, `notifications/outbox_listener.py:53-74` | Established, four event types |
| Periodic idempotent scan: bounded window, marker row in the same transaction, single commit | `groups/application/term_end_scan.py` | Established, one job |
| Synchronous text moderation in the write request: contact-info rule, then classifier | `groups/application/terms.py:279-292`, `moderation/text_guard.py:89-120` | Established; fails with 503 when the classifier is down |
| Safe-by-default listing selects (PUBLIC only unless opted in); hidden items 404 first | `groups/infrastructure/repository.py:771-786`, `groups/application/item_visibility.py:28-44` | Established, standard in `standards/backend/models.md` |
| Constant statement count regardless of rows | `tests/test_search_api.py:106,219` | Established, test-pinned |
| Frontend: `api/*.ts` + hook with a prefix key; one `resolve…View()` per page; `ConfirmDeleteDialog` | `hooks/useNeededItems.ts:16-50`, `features/search/searchViewState.ts:43-56` | Established standards |

### 4.3 Themes

- **Consistency**: the external evidence is consistent on what platforms do and thin on how well it works. No platform publishes fulfilment rates, cap effects or alert precision.
- **Maturity gap**: the supply side (search, visibility, reservations) is mature and test-pinned; the signalling side (notifications, limits) is minimal: one in-app list, no preferences, in-memory limiters, a single process.
- **Direction asymmetry**: everything indexed serves "one query against many items". The reverse direction (one new item against many wants) is unsupported in three places at once: text indexes, the radius predicate (`_near` takes the radius as a Python value) and the visibility predicate (`items_visible_to` takes the viewer as a value).

## 5. Key insights

### I1. The brief's core promise has no precedent (confidence: medium)
**Evidence**: absence tables in both platform files; the notifications gatherer found seeker-only examples in every engineering source.
**Inference (mine)**: the brief's premise "best patterns" covers the form, lifecycle, limits and seeker alerts. It does not cover automatic matching of a want to listings with owner notification. That part must be treated as an experiment with its own off switch and conservative defaults, because the owner "did not ask for it" (`[…lifecycle-notifications §2.2]`) and it is "the side with the higher spam risk" (`[…matching-alerts-notifications §Open Questions]`).
**Counterweight**: Flynn and Lake (people help when asked directly, medium) and Peerby (requests pushed to neighbours, company claims) suggest a direct, specific ask to an owner can work. Neither tests it on listed items.

### I2. Why owner notification adds less here than it seems (confidence: medium, inference)
**Evidence**: a listed item is already offered to anyone who may see it; the seeker who gets a match can take or propose at once (`groups/router/item_reservations.py:44-56`); take and propose already notify the owner (`groups/application/term_item_listings.py:640-707,848-856`).
**Inference**: for listed items, telling the seeker is sufficient to complete the exchange, and the owner hears about it when the seeker acts. An owner notification earns its place only where it changes behaviour: nudging an owner whose item is listed elsewhere (other mode, other scope), or prompting someone to list an item they have not listed. The second case is the Peerby model and needs a channel that does not exist (no conversation is anchored to a want, `messaging/models.py:20-60`).

### I3. A private want with matching is a saved-search alert under another name (confidence: high for the equivalence, product reading mine)
**Evidence**: `[external-gift-platforms-patterns §P10]` calls it "the overlap with the excluded saved searches feature"; the frontend `SearchFilters` type "plus `q` is a ready description of what I am looking for" (`api/search.ts:16-24`).
**Implication**: the brief excludes saved searches "as a separate feature" while choosing wanted posts. If the product stays private and seeker-only, the two converge and the exclusion mostly means "do not build a second, parallel list". This should be confirmed with the user.

### I4. Needed items are not a starting point (confidence: high)
**Evidence**: `groups/models.py:271-285` (term FK NOT NULL, no author, no category); organizer-only writes (`groups/application/terms.py:264-276`); pledge is a pure declaration (`groups/models.py:288-307`); migrations 0018–0020, 0063, 0067–0068 removed the category, the product link and the pledge-to-reservation link, wiping rows.
**Implication**: extending needed items would reverse decisions taken on 2026-10-26/27. Shared ground is limited to moderated free text, soft delete and the outbox event pattern.

### I5. The first increment is mostly wiring, the second is mostly new (confidence: high for the inventory, medium for the effort reading)
**Evidence**: reuse maps in the three codebase files.
- Private want + seeker notification: routes, gate, reserved slug, mock views, category and locality pickers, item card, bell, `fold_pl()`, `products.search_vector`, visibility predicate (want→items direction), outbox, `create_notification`, `check_text`, `ensure_no_contact_info` exist. New: the want table and module, a "listed" signal at two write points, a match table, one notification kind, a database-count cap.
- Owner notification or public wants: additionally need a seeker-identity privacy rule (`item_privacy.py` has none), an owner→seeker flow (every reservation starts from the receiver), a want-anchored conversation or equivalent, notification preferences, a public route and reserved slug, a report entry point, and the Article 9 question.

### I6. Polish inflection is the main match-quality risk and there is no cheap, proven fix today (confidence: medium)
**Evidence**: `'simple'` config, `plainto_tsquery` ANDs all words (`search/application/search.py:199-217`); descriptions have no trigram index; PostgreSQL 18 has no Polish stemmer; hunspell on 18 needs a custom image on every environment and loads per session; PostgreSQL 19 is at RC 2 with a Snowball stemmer of unconfirmed quality that expects diacritics, while `fold_pl()` strips them.
**Implication**: the realistic start is the existing recipe (full-text OR trigram on the name OR category) with a stricter cut-off than search uses, because search has "no minimum-rank cut-off" (`[…supply-and-matching §3.2]`) and an alert needs a yes/no decision. Quality must be measured on real pairs before any dictionary or embedding work.

### I7. Notification volume control has to arrive with the feature, not after (confidence: high)
**Evidence**: no dedup, retention, preferences or caps (`notifications/service.py`, `alembic/versions/0022_notifications_schema.py:61-67`); newest 50 rows only (`notifications/repository.py:12-32`); `derivePendingActions` depends on `SWAP_PROPOSED` and `TERM_CONFIRMATION_NEEDED` rows being present (`components/layout/pending/pendingActions.ts:55-77`).
**Implication**: a match table with a unique (want, item) key, grouping of first-run matches and a per-want mute are prerequisites. This is the first notification kind in the system that is a recommendation, not a report of someone's action (`[…notifications-outbox §F2]`).

### I8. Visibility has to be applied at match time and again at read time (confidence: high)
**Evidence**: `items_visible_to` (`groups/infrastructure/visibility.py:91-108`); "a match that skips it would leak PRIVATE items"; `can_view_item` is already re-run by take/propose; a seeker outside the owner's groups can reserve only through the PERSONAL context when the item has a live place (`groups/application/reservation_context.py`).
**Implication**: a match should also consider takeability, or it will notify people about items they cannot take (`[…notifications-outbox §F15]`).

## 6. Relationships and dependencies

```
seeker ── creates ──> WANT (new; name + optional filters; status; expiry)
                        │  text checks: ensure_no_contact_info -> check_text (moderation)
                        │  cap: database count (new)
                        ▼
      forward match on create (ordinary search-shaped select over listed items)
                        │
ITEM listed ────────────┤  write points (no signal today):
  inventory.register_item + on_registered hook      (item created listed)
  groups.set_item_listing_preference, insert branch (first listing)
  inventory._release via groups callers             (available again; optional)
                        │
      reverse match on new item (filtered scan over active wants)
                        │   visibility: items_visible_to / parties_share_group
                        ▼
                MATCH (want_id, item_id) unique  ── dedup, list, digest input
                        │
                        ▼  outbox event (60 s poll) -> notifications listener
                NOTIFICATION to seeker (in-app; new kind; link_path = item page)
                        │
                        ▼
      item page -> POST /api/items/{id}/take|propose (existing; notifies owner and taker)
```

Integration points and their constraints:
- `app.search`: cannot be imported; its `_matching`, `_near`, `_category_subtree` are private. A wants module needs its own ACLs over `app.groups.service`, `app.inventory.service`, `app.product`, `app.locations`, and copies of small builders (precedent: duplicated link builders pinned by a parity test, `tests/test_module_boundaries.py:100-111`).
- `app.inventory` → `app.groups` direction is forbidden; the listing knowledge lives in `app.groups`.
- `app.notifications` never imports producers; a new producer adds outbox event types or its own bridge.
- Frontend: the bell follows `link_path` and needs no change; the `NotificationKind` union must grow; a match kind must stay out of `derivePendingActions`.

## 7. Gaps and uncertainties

**Information gaps**
- Fulfilment rates of wanted posts, effect of caps, alert precision: not published by any platform.
- OLX rules on wanted adverts (help centre behind login); Olio wanted-listing fields, duration, visibility; Buy Nothing Ask expiry; current Bunz state after 2026-09-01.
- CPU and memory of a small embedding model under ONNX on the app server.
- A numeric cap for alerts, an optimal expiry period, the effect of quiet hours.
- Ranking of several wants for one owner; item-side events that should re-trigger matching (edit, release): no source.
- "Still looking?" check-ins and auto-closing a want on fulfilment: no source.

**Unverified claims**
- `stored_query <@ item_query` as a GiST-indexable candidate filter (low; needs `EXPLAIN`).
- That a filtered scan is fast enough (medium; reasoning only; expected row counts unknown).
- Trigram tolerance for Polish inflection (medium; "inferred from the configuration, not from a test").
- Whether `?name=` survives the login `returnTo` round trip for a guest (`[…wanted-mock §Open Questions]`).
- Whether the facades export every name a wants ACL needs (checked only for names search uses).
- `set_personalised_cache_headers` body not read (medium).
- Multi-worker behaviour of the scheduler (inferred).
- Out of scope: `PUT /api/products/{id}` ownership check (unverified, medium).

**Unresolved**
- Seeker-only vs both sides; private vs public vs group-scoped; whether offer mode is a real field; which of the two create paths survives; whether release of a reservation counts as a new signal.

## 8. Synthesis by framework (mixed)

### 8.1 Technical: component, flow
- **What exists**: listing record (`item_listing_preferences`), matchable text (`products.search_vector`, folded name trigram, `categories.path_text`), structured attributes (category subtree, condition equality, mode, locality + radius by haversine), visibility predicate, outbox, in-app notifications, synchronous moderation, take/propose.
- **What is missing**: want storage; a signal at listing write points; reverse matching; correlated forms of `_near` and of the visibility check; a match record; notification deduplication, grouping, preferences; a database-backed cap; an owner→seeker response; a `TextField` for wants; matrix rows.
- **Flow constraints**: matching in the listing request would lengthen an already long transaction; the outbox adds up to 60 s; everything runs in one uvicorn process.

### 8.2 Literature: current practice, trade-offs, applicability

| Practice | Fits this project | Does not fit / caution |
|---|---|---|
| Minimal form, name first | Yes; the mock already has it; NN/g EAS | Weak categorisation hurts browsing (Gumtree 70 % in "Miscellaneous") — matters only if wants are public |
| Default expiry, seeker closes | Yes; also GDPR Art. 5 | Period unsupported by data |
| Seeker alert from a standing query | Yes; this is the mock's promise | Overlaps the excluded saved-search feature |
| Public wanted feed answered by message | Possible, but needs moderation capacity, a response channel and the Art. 9 answer | Failure modes documented: begging, trade buyers, stale posts, misfiling |
| Weekly cap on wants | Yes, as a database count | Cultures differ; number is a guess |
| Offer-first / ratio gate | No | Rejected by every gift network reviewed |
| Percolator / search engine | No at this scale | Operational weight |
| Owner notified of a matching want | No precedent | Experimental; needs opt-out |

### 8.3 Requirements: stated, implicit, conflicting
- **Stated** (brief): want with text and possibly category, condition, offer type, location and radius, expiry, photos; matching; notifications to both sides; visibility rules; lifecycle; moderation; UX.
- **Implicit** (mock and earlier task): a private list under "Konto"; a match count per want; wants never appear in search results; wants boost the user's own search ranking (rule 1, deferred).
- **Conflicts**: both sides vs seeker only; brief's field list vs platform practice (no platform asks for condition on a want; photos optional).

## 9. Conclusions

**Primary**
1. Build on the proven half: a seeker-owned want that is matched to new and existing listings and notifies the seeker. Evidence for every part of this exists either on platforms (alerts) or in the code (search, outbox, notifications).
2. Treat owner notification and public visibility as separate, later decisions with their own risk controls. They are the unproven half.
3. Keep needed items separate.
4. Put the feature in its own module with ACLs; do not place it in `app/search`.

**Secondary**
5. Measure match quality and scan cost on real data before choosing dictionaries, embeddings or indexes.
6. Volume controls (unique match key, grouping, per-want mute, cap) are part of the first increment.
7. The frontend union still carries a removed notification kind; the `main.py` docstring states a stale poll interval. Minor clean-ups, noted for whoever touches those files.

**Recommendations**: see `outputs/research-report.md`, sections 9 and 10, for the options per decision area and the recommended path.
