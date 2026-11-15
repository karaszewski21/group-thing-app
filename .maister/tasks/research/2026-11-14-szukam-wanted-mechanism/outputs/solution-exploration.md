# Solution Exploration: "Szukam" (wanted) mechanism

## TL;DR
- Nine decision areas, 50 alternatives. The first area (who sees a want, who is notified) constrains every later one, and it is a product decision the research cannot settle.
- Recommended path: a private, seeker-owned want with optional search-shaped filters, in its own backend module, matched both ways through the outbox into a unique (want, item) table, with grouped in-app notifications to the seeker.
- The brief's "notifies both sides" is kept as a designed second step: an anonymous, aggregated, switchable owner signal (1B). It has no precedent on any of the eleven platforms, so it is an experiment, and shipping only the first step does not meet the brief's wording.
- Group-scoped or public wants are the costliest branch: they need a response channel, a seeker-identity rule, a report entry point and legal review, none of which exist.
- Confidence: medium. Code fit is high; Polish match quality, reverse-match cost and the legal points are unmeasured or unreviewed.

## Key Decisions
- Stage the product shape: private seeker alert first (1A), anonymous owner signal second behind a switch (1B) — the first half has precedent and ready code, the second is what the brief asked for and is unproven.
- Treat the want as the one standing-demand object (2A) — a private matched want is a saved-search alert in function; building a second parallel list is what the brief's exclusion should mean.
- New want entity with a required name and optional structured filters (3.1B), plus a unique (want, item) match table (3.2A), in a new module with ACLs (3.3A) — search already filters on these fields, and nothing else deduplicates alerts.
- Match in both directions from outbox events raised at the listing write points (4.1C), with the existing full-text plus trigram recipe under a stricter threshold (4.2A), on takeable items only (4.3B) — no new infrastructure, and no alerts for items the seeker cannot take.
- Grouped in-app notifications with pair deduplication, a per-want mute and a database-count cap in the same increment (5B) — the system has no notification controls today.
- Default expiry with a reminder and one-tap extension (6.1B); closing by the seeker, prompted after a reservation (6.2B) — auto-closing has no hook in the code and no source.
- Existing synchronous text checks plus a database-count cap (7B) for a private want; the community rule set (7C) becomes mandatory the moment anyone else can read a want.
- Response through the existing take/propose flow only (8A); keep both UI entries on one form and one hook, and let the empty-search prompt carry the active filters (9A).

## Open Questions / Risks
- Who is notified: the recommendation stages "both sides". If the user wants the literal brief from day one, 1A and 1B ship together and the first increment grows by an owner notification kind, an off switch and a legal check.
- Visibility: private (recommended), group-scoped or public. Choosing 1C, 1D or 1E changes the recommendations in areas 5, 7, 8 and 9.
- Scope line: a private matched want is functionally a saved-search alert, which the brief excluded "as a separate feature". Recommendation 2A reads the exclusion as "no second, parallel list"; the user must confirm that reading.
- Match quality on inflected Polish is unmeasured. The 4.2A threshold cannot be set responsibly without a labelled sample of real want/item pairs.
- Reverse-match cost is argued, not measured; the expected numbers of wants and items are assumed ("thousands").
- The owner signal (1B) computed for a PRIVATE item tells its owner that demand exists outside the item's audience. It leaks nothing to the seeker, but it is a new kind of information flow and needs a deliberate yes or no.
- Legal: Article 9 GDPR (wants revealing health or belief), Article 398 of the Polish Electronic Communications Law and the DSA report duty rest on commentary. A lawyer must confirm before owner notifications, visible wants or e-mail.
- The bell shows the newest 50 rows and nothing is deleted; even grouped match rows can push action prompts (`SWAP_PROPOSED`, `TERM_CONFIRMATION_NEEDED`) out of view.
- Numbers are product guesses everywhere: expiry period, cap on active wants, grouping window. No source gives tested values.

## Problem Reframing

### Research Question
How should the platform implement a "szukam" (wanted / in-search-of) mechanism — data model, matching, notifications, visibility, moderation and UX — based on the best patterns used by comparable platforms, and how does it fit the existing architecture?

The user's wording at intake: "wanted posts: a user states what they look for, the system matches it to listed items and notifies both sides", following the best patterns. The research found that the best patterns cover the form, lifecycle, limits and seeker alerts, and do not cover owner notification (report §4.3, medium confidence). This document keeps "both sides" on the table as a real alternative in area 1 and does not treat the mock's seeker-only promise as settled.

### How Might We Questions
1. How might we let a seeker state a need once and hear about matching items, while not building a second saved-search list beside it?
2. How might we honour "notifies both sides" while not sending owners messages they did not ask for and no platform has tested?
3. How might we match short Polish wants to item names well enough for a yes/no alert, while staying on stock PostgreSQL 18 and the existing folded columns?
4. How might we react to a newly listed item, while keeping inventory free of imports from groups and the listing transaction short?
5. How might we add the system's first recommendation-type notification, while keeping action prompts visible in a bell with no preferences, caps or deduplication?
6. How might we keep wants fresh and honest, while never tying a want to giving first?
7. How might we leave room for wants that other people can see, while not paying now for the moderation, response channel and legal work they need?

### Reading guide
- Areas are ordered so that earlier choices constrain later ones. Each area states its dependency on earlier areas.
- Effort is relative within an area: S, M, L, XL.
- "Inference" marks a conclusion of this exploration or of the research synthesis, not a sourced fact.
- Report sections are cited as "report §n"; findings files as `[file §id]` (in `analysis/findings/`).

## Explored Alternatives

### Area 1: Product shape — visibility and who is notified

The governing decision. It merges the brief's open questions 1 (who is notified) and 2 (visibility) because they are not independent: an owner can only answer a want they can see or are told about.

#### 1A. Private seeker alert

A want is a private list entry under the seeker's account. The system matches it to listed items and tells the seeker only; the owner hears about it when the seeker takes the item or proposes a swap, through the existing notifications.

- **Pros**: matches the shipped mock and the earlier search task ("nigdy w wynikach"); the only shape with platform precedent (saved-search alerts on OLX, Gumtree, Wallapop, Craigslist, Trash Nothing); most code exists; nobody else reads the text, so most abuse scenarios disappear.
- **Cons**: does not meet the brief's "notifies both sides" in the literal sense; owners never learn of unmet demand; adds nothing when nobody lists the item; functionally a saved-search alert (see area 2).
- **Best when**: the goal is a dependable first version and the owner side can wait for evidence.
- **Evidence**: report §9.1 option A, §6.4, §4.3; `[codebase-frontend-wanted-mock §F1, F3, F5]`. Confidence: high for fit and precedent.
- **Effort**: M (the baseline every other alternative builds on).

#### 1B. Private want with an anonymous owner signal

Wants stay private. The owner of a matching item is told that someone is looking for it, without the seeker's identity or text — as an aggregated count on the owner's own item surfaces and at most one grouped notification per item, opt-out, behind a feature switch.

- **Pros**: delivers "both sides" with no public text and no browsing surface to pollute; reuses the same match table as 1A; identity stays hidden, so no seeker-privacy rule is needed for names.
- **Cons**: no precedent on any of the eleven platforms or in the engineering sources; the owner did not ask for the message; for an already listed item it changes little, because take/propose notifies the owner once the seeker acts (inference, synthesis I2); needs a new notification kind, an off switch and a legal look at consent; for PRIVATE items it tells the owner that outside demand exists.
- **Best when**: the user holds to "both sides" and accepts it as an experiment with conservative defaults and a way to turn it off.
- **Evidence**: report §9.1 option D, §4.3; synthesis I1, I2; nearest precedent is the opt-in Trash Nothing alert on Requests. Confidence: low (novel).
- **Effort**: M on top of 1A.

#### 1C. Group-scoped wants

A want is visible to members of the seeker's groups (all of them, or one chosen group), who can answer it. The system may also match and notify as in 1A.

- **Pros**: mirrors gift-community practice (Freecycle town group, Buy Nothing private community); reuses `parties_share_group` and the "mine" scope; a bounded, known audience limits begging, trade buyers and exposure; can prompt people to list items they had not listed.
- **Cons**: needs a response channel that does not exist (no owner-initiated flow, no want-anchored conversation), a rule for showing the seeker's name, a report entry point and the Article 9 question; smaller audience than public; contradicts the earlier "never in results" intent if wants surface in search.
- **Best when**: groups are active enough that members read each other's requests, and unlisted supply matters more than listed supply.
- **Evidence**: report §9.1 option C, §4.1, §6.2; `groups/infrastructure/visibility.py:41-59`. Confidence: medium.
- **Effort**: L.

#### 1D. Public wanted board

Wants are browsable by anyone (or any logged-in user) and answered by hand, as on Freecycle, Gumtree UK or Craigslist.

- **Pros**: the classic pattern with the widest audience; creates supply by asking (Freegle: requests prompt offers); works for items nobody has listed.
- **Cons**: every documented failure mode applies — begging, trade buyers, misfiled offers, stale posts, weak categorisation; needs moderation capacity, a response channel, a public route and reserved slug, a report entry point and personalised cache handling; the classifier detects harm, not spam or begging; Article 9 exposure is highest.
- **Best when**: the platform has moderation capacity and wants a community noticeboard more than a matching tool.
- **Evidence**: report §9.1 option B, §5.2, §9.6; `[external-classifieds-patterns §P1]`. Confidence: high for the pattern, medium to low for how well it works.
- **Effort**: XL.

#### 1E. Seeker-chosen audience per want

Each want carries a visibility choice — private (default), my groups, or everyone — as in the Buy Nothing app's visibility toggle.

- **Pros**: one model covers 1A, 1C and 1D; the seeker controls exposure per want, which also answers part of the sensitive-want concern; default private keeps the safe behaviour.
- **Cons**: costs everything 1D costs, plus a choice most users will not change (NN/g: defaults stick); three behaviours to test and explain; the unproven parts ship at once.
- **Best when**: the end state is known to include visible wants and the team prefers one release over three.
- **Evidence**: report §4.1 (Buy Nothing column), §5.1 P11; `[external-gift-platforms-comparison]`. Confidence: medium for the pattern, low for transfer.
- **Effort**: XL.

#### Area 1 recommendation

**Recommended: 1A as the first increment, 1B as a designed second increment behind a switch; 1C as the candidate third step.** Reason: it puts the half with precedent and ready code first and still delivers the brief's "both sides" in its lowest-risk form, as a measurable experiment.

- **This is not a quiet narrowing**: 1A alone does not satisfy the user's wording. The staging is a proposal the user must accept or overrule. If overruled, ship 1A and 1B together; the model in area 3 is the same either way.
- **Would change if**: the user wants the literal brief on day one (then 1A+1B together); groups turn out to be where exchanges start (then 1C moves ahead of 1B); a lawyer rules out unrequested owner messages (then 1B becomes owner opt-in only, the Trash Nothing shape).
- **Depends on**: nothing earlier. Constrains areas 2, 5, 7, 8 and 9.

### Area 2: Scope line against saved searches

The brief chose wanted posts and excluded "saved searches and search alerts as a separate feature". A private matched want (1A) does the same job as a saved-search alert, so the line has to be drawn on purpose.

#### 2A. The want is the single standing-demand object

Accept the overlap: one list, one entity, one notification kind. A want may be search-shaped and may be created from a search, and no separate saved-search feature is built beside it.

- **Pros**: one concept for users ("szukam"); no duplicate storage, matching or notification path; reads the exclusion as it was most likely meant — do not build a second, parallel list (inference, synthesis I3).
- **Cons**: needs the user's explicit confirmation; a want with only filters and no name would be a pure saved search, so the name stays required.
- **Best when**: area 1 lands on 1A or 1B.
- **Evidence**: synthesis I3; `[external-gift-platforms-patterns §P10]`; `api/search.ts:16-24`. Confidence: high for the equivalence, medium for the reading of intent.
- **Effort**: S (no extra work; it is a framing).

#### 2B. Keep wants deliberately unlike a search

A want is a name and an optional description, with no filters, so that it stays a "post" and never a stored query.

- **Pros**: clearest distance from the excluded feature; smallest form; equals the mock's list path.
- **Cons**: every match is nationwide and text-only; reverse matching loses its only indexable pre-filter; throws away the search filter shape the frontend already has.
- **Best when**: the user reads the exclusion strictly and accepts weaker matching for it.
- **Evidence**: report §9.2 option C; AWS pre-filter guidance in report §9.3. Confidence: medium.
- **Effort**: S.

#### 2C. Make the difference structural: a want is seen by someone

Define a want as demand that reaches other people (an owner signal, group members or the public), which a saved search never does. The private-only version is then not shipped on its own.

- **Pros**: an unambiguous line; aligns with the brief's "notifies both sides".
- **Cons**: forces the unproven half (1B, 1C or 1D) into the first release; removes the low-risk first step.
- **Best when**: the user rejects 1A as "just saved searches".
- **Evidence**: report §9.1; synthesis I1, I3. Confidence: medium (inference).
- **Effort**: L (it pulls area 1 forward).

#### Area 2 recommendation

**Recommended: 2A.** Reason: the equivalence is a fact of the design, and one demand object costs least and confuses least.

- **Would change if**: the user confirms the exclusion was meant strictly (then 2B) or says a private list is not what was asked for (then 2C, with 1A+1B together).
- **Depends on**: area 1. Under 1C, 1D or 1E the overlap mostly disappears and this area needs no decision.

### Area 3: Data model and module home

Two shapes are ruled out by the evidence and not carried as alternatives: extending `needed_items` (reverses migrations 0018–0020, 0063, 0067–0068; organizer-only, term-scoped; report §7) and a want as an inventory item or listing with a flag (an item is a ledger-backed row; platforms that mix wants into the offer form get misfiling; report §9.2 options A and B).

#### 3.1A. Name-only want

Owner, name, optional description, status, expiry. No filters.

- **Pros**: smallest form and table; matches NN/g's "name first" guidance and the mock's list path.
- **Cons**: text-only, nationwide matching; no pre-filter for the reverse direction; the empty-search prompt cannot keep the user's filters.
- **Best when**: 2B is chosen.
- **Evidence**: report §9.2 option C, §5.1 P2, P12. Confidence: medium-high.
- **Effort**: S.

#### 3.1B. Name plus optional structured filters

As 3.1A, plus optional columns in the shape search already filters on: category (any node), offer mode, locality and radius. Only the name is required.

- **Pros**: gives the indexable pre-filter for reverse matching; the empty-search prompt can carry active filters; a want can be opened as a search; a `locality_id` can be held directly; leaves room for a visibility column later.
- **Cons**: more form to design; condition has equality only and no platform asks for it on a want, so it is best left out; 21 of 54,440 localities have no point.
- **Best when**: 2A is chosen and matching quality matters.
- **Evidence**: report §9.2 option D, §6.1; `search/application/search.py:272-348`. Confidence: medium-high for the entity, medium for the field set.
- **Effort**: M.

#### 3.1C. Want as a stored search query

Store the name plus the serialised search parameters (one JSON or query-string column) and replay them as a search.

- **Pros**: no schema change when search gains a filter; trivially opened as a search URL; the purest form of 2A.
- **Cons**: filters are not plain columns, so the reverse direction cannot pre-filter with indexes or join category subtrees and radius in SQL; ties the stored shape to a module that may not be imported; validation moves to read time.
- **Best when**: matching is forward-only (4.1A).
- **Evidence**: report §9.3 (pre-filter by plain columns; no index for `@@` on a query column); `api/search.ts:16-24`. Confidence: medium (inference).
- **Effort**: S to store, L to match in reverse.

#### 3.2A. Unique (want, item) match table

Every match is recorded once under a unique key; the row feeds deduplication, the "matches for this want" list, the match count and grouped notifications.

- **Pros**: the only deduplication the system would have; survives the outbox's at-least-once delivery (`INSERT … ON CONFLICT DO NOTHING … RETURNING`); gives the mock's match count a real source; reusable by the 1B owner signal.
- **Cons**: one more table; loose item pointers need staleness handling, as listing preferences already do.
- **Best when**: almost always.
- **Evidence**: report §9.2 cross-cutting choices, §5.1 P9; Funda; `groups/models.py:356-360`. Confidence: high.
- **Effort**: S.

#### 3.2B. Per-want watermark, no pair rows

Each want stores "matched up to" and the matcher only considers items listed after it; matches are computed on read.

- **Pros**: no match rows to store or clean; simple forward model.
- **Cons**: no record of what was already announced, so re-listed or released items repeat or vanish; the match list and count become a live query per want; no input for the 1B owner signal.
- **Best when**: matching is forward-only and notifications are pull-only (5D).
- **Evidence**: polling-post pattern in `[external-matching-alerts-notifications]`; report §9.3. Confidence: medium.
- **Effort**: S.

#### 3.2C. Deduplicate on the notification row

Add a unique key to `notifications` (recipient, kind, subject) and let the notification be the match record.

- **Pros**: no new table; fixes missing deduplication for other kinds too.
- **Cons**: couples match history to a table that is never cleaned and shows only its newest 50 rows; grouping several matches into one row breaks the key; wording and kind belong to `app.notifications`, not to the producer.
- **Best when**: one row per match (5A) is acceptable.
- **Evidence**: `alembic/versions/0022_notifications_schema.py:61-67`; `[codebase-needs-signals-notifications-outbox §F4, F5]`. Confidence: medium.
- **Effort**: M (a migration on a shared table).

#### 3.3A. New module with its own ACLs

A new backend module owns the want and match tables, the matcher and the API, and reaches groups, inventory, product, category and locations through one ACL file per foreign module.

- **Pros**: follows the established, test-guarded boundary pattern; keeps `app/groups`, already the largest context, from growing; a later `search/infrastructure/wants_acl.py` could read it.
- **Cons**: small copies of search's private builders (`_matching`, `_near`, subtree CTE), as with the parity-tested link builders; facade exports for the ACLs were only checked for the names search uses.
- **Best when**: the feature is expected to grow (1B, 1C).
- **Evidence**: report §6.3, §9.2; `tests/test_module_boundaries.py:17,54-97,100-111`. Confidence: high.
- **Effort**: M.

#### 3.3B. Inside `app/groups`

Wants live beside listing preferences, the visibility predicate and the notification bridge.

- **Pros**: no ACLs for the hardest dependencies (visibility, listing rows, takeability); the "listed" signal and its consumer sit in one module.
- **Cons**: a want is an account-level object with no group; enlarges the largest context; mixes a new concept with needed items, which the research says to keep apart.
- **Best when**: the feature is certain to stay small.
- **Evidence**: report §9.2 module home; synthesis §4.2. Confidence: medium.
- **Effort**: S to M.

#### 3.3C. Split: wants module owns the data, groups owns the matcher

The new module stores wants and matches and serves the API; `app/groups` runs the matching statements, because the listing rows and visibility rules are its own.

- **Pros**: visibility and takeability logic is not re-expressed through an ACL; want storage still has a clean home.
- **Cons**: groups must then read want rows, a dependency in the direction no current pattern uses; two modules to change for every matching rule.
- **Best when**: correlated visibility through an ACL proves awkward in the design phase.
- **Evidence**: `inventory/application/inventory_items.py:38-40,91-93` (callback precedent); report §6.3. Confidence: low to medium (inference).
- **Effort**: M.

#### Area 3 recommendation

**Recommended: 3.1B (only the name required), 3.2A, 3.3A.** Reason: search-shaped columns are what make reverse matching cheap, the pair table is the only deduplication available, and a separate module is the pattern the boundary tests already enforce.

- **Would change if**: 2B is chosen (then 3.1A); matching ends up forward-only (then 3.1C and 3.2B become viable); the design phase finds the visibility predicate cannot be reached cleanly through an ACL (then 3.3C).
- **Depends on**: area 2 for the entity shape; area 1 only in that a visibility column should be addable later without reshaping the table.
- **Open sub-choice**: photos on a want. For a private want a photo has no reader; deferred.

### Area 4: Matching — timing, trigger and text comparison

Fixed by the evidence regardless of the alternative: every match passes the visibility predicate (`items_visible_to` or its correlated form) and is re-checked with `can_view_item` at read time; the seeker's own items are excluded; plain-column pre-filters run before text (report §9.3, synthesis I8).

#### 4.1A. Forward only, periodic re-run

Each active want is re-run as a search-shaped select on a schedule; new results become matches.

- **Pros**: no reverse logic and no signal at the listing write points; reuses want-to-items selects and indexes.
- **Cons**: one query per want per run conflicts with the constant-statement convention; delay; first-run flood.
- **Best when**: there are few wants and timeliness does not matter.
- **Evidence**: report §9.3 "when to match" option A; `tests/test_search_api.py:106,219`. Confidence: medium.
- **Effort**: S.

#### 4.1B. Reverse only, on each newly listed item

A newly listed item is compared with active wants; nothing runs when a want is created.

- **Pros**: timely; one code path.
- **Cons**: a new want sees nothing already listed, which is the seeker's first expectation.
- **Best when**: never on its own; listed for completeness as the percolator-only model.
- **Evidence**: report §9.3 option B. Confidence: high.
- **Effort**: M.

#### 4.1C. Both directions, driven by outbox events at the listing write points

Forward once when a want is created (a capped summary), reverse when an item becomes listed. The signal is raised at `register_item` (through `on_registered`) and the insert branch of `set_item_listing_preference`, travels through the outbox, and a consumer runs one set-based statement per event.

- **Pros**: complete; the event is atomic with the listing; three independent sources recommend buffering; no new dependency direction because the listing knowledge is already in groups; the listing transaction is not lengthened.
- **Cons**: two code paths; the reverse direction needs correlated forms of the radius and visibility predicates; up to 60 s delay; at-least-once delivery needs an idempotent consumer (3.2A provides it); release and edit events are still undecided.
- **Best when**: timeliness matters and 3.2A is in place.
- **Evidence**: report §9.3 option C and "outbox", §6.1, R4, R5; `outbox/scheduler.py:16`. Confidence: medium (mechanics documented, cost unmeasured).
- **Effort**: M to L.

#### 4.1D. Both directions, by a periodic set-based scan with a marker

No signal at the write points. A scheduled job, modelled on `term_end_scan`, joins listings created since the last marker against all active wants in one statement, and new wants against current listings in another.

- **Pros**: touches neither the inventory nor the groups write paths; constant statement count by construction; the scan window doubles as the grouping window for notifications (5B).
- **Cons**: delay equal to the interval; items that become available again or are edited are missed unless the marker logic grows; relies on a trustworthy creation time on the listing row (assumed, not traced).
- **Best when**: changing the listing write points proves invasive, or a few minutes' delay is acceptable.
- **Evidence**: `groups/application/term_end_scan.py` pattern, report §6.1; report §9.3 "periodic scan". Confidence: low to medium (inference of this exploration).
- **Effort**: M.

#### 4.2A. Existing recipe with a stricter threshold

Folded `'simple'` full-text (all words) OR trigram word similarity on the folded name OR category match, with a minimum-similarity cut-off that search itself does not have.

- **Pros**: reuses `fold_pl()`, `products.search_vector` and the name trigram index; no new infrastructure; works on stock PostgreSQL 18.
- **Cons**: inflected forms match only through trigram on the name; the threshold is untuned and short words give false positives; descriptions have no trigram index.
- **Best when**: starting out, with a measurement step before the threshold is fixed.
- **Evidence**: report §9.3 text options A and B, R5, R6; synthesis I6. Confidence: high that it works mechanically, low for quality in Polish.
- **Effort**: S.

#### 4.2B. Category-led matching

Lean on structure instead of language: the form nudges the seeker to pick a category, and a match needs the category subtree plus a loose text signal (any word, or trigram), not all words.

- **Pros**: sidesteps Polish inflection for the strongest signal; category is an indexable pre-filter; `CategoryTreePicker` exists with `mode="any"`.
- **Cons**: seekers categorise badly (Gumtree: 70 % of wanted adverts in "Miscellaneous"); a required or nudged category lengthens the form against NN/g guidance; broad categories produce noisy alerts.
- **Best when**: the measurement shows text-only precision is too low.
- **Evidence**: report §5.2 (weak categorisation), §9.3 pre-filter guidance, §6.1. Confidence: low to medium (inference).
- **Effort**: S to M.

#### 4.2C. Polish lemmatisation

Real lemmas through one of: a hunspell dictionary on PostgreSQL 18, the Snowball Polish stemmer in PostgreSQL 19, or an application lemmatiser (Morfeusz 2).

- **Pros**: addresses the main match-quality risk at its root.
- **Cons**: hunspell needs a custom database image in every environment including test containers, loads per session and conflicts with the `fold_pl()` folding order; PostgreSQL 19 is a release candidate with no published GA date and a stemmer of unconfirmed quality; Morfeusz adds a native dependency with an unchecked licence; all require rebuilding stored vectors.
- **Best when**: a measurement shows 4.2A misses too many inflected forms and PostgreSQL 19 is generally available.
- **Evidence**: report §9.3 text options D, E, F, R10; `[external-matching-alerts-matching §3.1, §3.2]`. Confidence: high for the facts, unconfirmed for quality.
- **Effort**: L.

#### 4.2D. Small embedding model with pgvector

Embed want and item text and match by vector distance, optionally combined with 4.2A.

- **Pros**: semantic matches across wording and inflection; a small model would fit the "small models on the app server" rule.
- **Cons**: an extension in the database image, a model in the app process, re-embedding on edits; the yes/no distance threshold for three-word Polish wants is unknown; CPU and memory are unconfirmed.
- **Best when**: lexical matching has been measured and found inadequate.
- **Evidence**: report §9.3 text option G; tech-stack constraint on small models. Confidence: medium.
- **Effort**: XL.

#### 4.3A. Any visible listed item counts

A match is any listed item the seeker may see, whatever its reservation state.

- **Pros**: simplest predicate; equals what search shows (the listed base select includes RESERVED and IN_TRANSIT).
- **Cons**: alerts for items the seeker cannot take; a correctly shown PRIVATE item can still be refused at take/propose.
- **Best when**: matches are only a pull list (5D), never a notification.
- **Evidence**: `inventory/infrastructure/repository.py:269-314`; report §6.3. Confidence: high.
- **Effort**: S.

#### 4.3B. Takeable items only

A match must be AVAILABLE, have no pending proposal, and be reachable by the seeker through some reservation context (a shared group or event, or the personal context when the item has a live place).

- **Pros**: every alert is actionable; avoids "notify people about items they cannot take".
- **Cons**: a stricter and more expensive predicate; an item that becomes takeable later is missed unless release is also a signal.
- **Best when**: matches produce notifications (5A to 5C).
- **Evidence**: report §6.3, §9.3; `[codebase-needs-signals-notifications-outbox §F15]`; `groups/application/reservation_context.py:48-58`. Confidence: high for the problem, medium for the predicate's cost.
- **Effort**: M.

#### 4.3C. Record every visible match, notify only when takeable

Store the pair for any visible item, mark it "reserved" in the list, and notify when it is or becomes takeable, with reservation release as a further signal.

- **Pros**: the match list is complete while alerts stay actionable; handles released reservations.
- **Cons**: a third write point inside inventory, which has no listing knowledge; pair state to maintain; no source says release should re-trigger.
- **Best when**: scarce items are often reserved and released.
- **Evidence**: `inventory/application/reservation_transitions.py:80-84`; report §9.3 open decisions. Confidence: low to medium.
- **Effort**: L.

#### Area 4 recommendation

**Recommended: 4.1C, 4.2A, 4.3B.** Reason: both directions through the outbox is the documented pattern on machinery that exists, the current text recipe is the only one with no operating cost, and alerts for untakeable items would spend the seeker's attention for nothing.

- **Before fixing thresholds**: run `EXPLAIN ANALYZE` on the reverse statement at realistic row counts and score a small labelled set of real Polish want/item pairs (report R6).
- **Would change if**: write-point changes prove invasive or a delay of minutes is fine (then 4.1D); measured precision is poor (then add 4.2B before 4.2C); PostgreSQL 19 reaches GA with a usable stemmer (revisit 4.2C); release of reservations turns out to be common (then 4.3C).
- **Depends on**: 3.1B for the pre-filter columns and 3.2A for idempotency. Under 3.1A or 3.1C the reverse direction loses its pre-filter and 4.1A or 4.1D becomes the realistic choice.

### Area 5: Notification delivery and controls

Who is notified is decided in area 1. This area decides how. E-mail and push are not alternatives here: nothing exists, addresses are unverified and unconsented, and the earlier ADR-009 deferred e-mail (see Deferred Ideas).

#### 5A. One in-app row per match

Each new pair creates a notification with a link to the item.

- **Pros**: exists today; a new kind needs no migration; immediate.
- **Cons**: floods on the first run and for popular wants; pushes action prompts out of the 50-row bell.
- **Best when**: wants are few and narrow.
- **Evidence**: report §9.4 delivery option A; `notifications/repository.py:12-32`. Confidence: high.
- **Effort**: S.

#### 5B. Grouped in-app rows

One summary when a want is created ("n items already match"), then at most one row per want per window, linking to the want's match list.

- **Pros**: protects the bell; follows NN/g (combine above five) and the polling post's first-run summary; the match table supplies the counts.
- **Cons**: needs a delayed or periodic step; a short delay on scarce items; the window length is a guess.
- **Best when**: matches produce bell rows at all.
- **Evidence**: report §9.4 option B, §5.1 P10, R7; synthesis I7. Confidence: medium-high for the shape, low for the numbers.
- **Effort**: M.

#### 5C. Daily digest row

One in-app row per day per seeker, built from the match table.

- **Pros**: lowest volume; Funda's default; batching improved well-being in Fitz et al. (n = 237).
- **Cons**: an item may be gone by the time it is read, so a liveness check is needed; with in-app only, a digest is just a slower grouped row.
- **Best when**: e-mail exists.
- **Evidence**: report §9.4 option C; `[external-matching-alerts-notifications]`. Confidence: medium.
- **Effort**: M.

#### 5D. Pull only: a count, no bell rows

No notification. The want list, the "Konto" row and the add tile show a live count of new matches.

- **Pros**: zero fatigue risk; the mock already has a match count; nothing to mute or cap.
- **Cons**: breaks the mock's promise, repeated five times, "Damy znać"; a seeker who does not return never learns of a match.
- **Best when**: notification volume is judged too risky for a bell with no controls.
- **Evidence**: `[codebase-frontend-wanted-mock §F1, F3]`; report §6.4. Confidence: medium (inference).
- **Effort**: S.

#### Area 5 recommendation

**Recommended: 5B, with the count from 5D shown on the want list as well.** Reason: it keeps the promise to tell the seeker while protecting a bell that has no controls of its own.

- **Controls that ship in the same increment**: one alert per (want, item) pair; a per-want mute; a per-user cap as a database count; skipping items no longer listed or takeable at send time; keeping the new kind out of `derivePendingActions`; passing text through `clock.fit_notification_message`.
- **Would change if**: the product stays very small (5A is enough for a while); e-mail is taken up (5C becomes the e-mail default).
- **Depends on**: 3.2A (grouping and counts need the pair table) and area 1 (under 1B the owner signal uses the same grouping, per item instead of per want, and adds an account-level off switch).

### Area 6: Lifecycle — expiry, closing and the link to reservations

States with strong support regardless of the alternative: open, fulfilled, withdrawn, expired (Trash Nothing API; report §9.5).

#### 6.1A. Fixed period, silent expiry, repost as new

A want lives a fixed 90 days, ends without notice and can be reposted from a pre-filled form.

- **Pros**: the documented gift-network model (Freecycle, Trash Nothing); no reminder machinery.
- **Cons**: reposting exists there to bump a feed; a matched private want has no feed, so silent expiry just loses the alert without the seeker noticing.
- **Best when**: wants are public posts in a feed.
- **Evidence**: report §5.1 P6, §9.5. Confidence: high for the practice.
- **Effort**: S.

#### 6.1B. Default expiry with a reminder and one-tap extension

A default period (90 days is the better-supported starting value), one in-app reminder before the end, and an "extend" action that keeps the same want and its matches.

- **Pros**: storage limitation is respected; nobody loses an alert silently; the periodic-scan pattern exists for the reminder.
- **Cons**: one more notification kind; the OLX source for reminders is from 2018 and is about adverts, not wants; the period is a guess.
- **Best when**: wants are private and matched.
- **Evidence**: report §9.5, §5.1 P6, R8; GDPR Art. 5(1)(e) via commentary. Confidence: medium.
- **Effort**: S to M.

#### 6.1C. Seeker-chosen expiry

The form asks how long the want should stay open, within a maximum.

- **Pros**: fits one-off needs ("before Saturday") and standing ones; Trash Nothing's API carries an expiration field.
- **Cons**: one more field on a form that should be one field long; most users keep the default.
- **Best when**: time-bound needs turn out to be common.
- **Evidence**: report §4.1 (Trash Nothing fields), §5.1 P12. Confidence: medium.
- **Effort**: S.

#### 6.1D. No expiry, periodic "still looking?" check-in

A want stays open until closed; the system asks from time to time and closes on no answer.

- **Pros**: no arbitrary period; stale wants are removed by evidence of disuse.
- **Cons**: no source for check-ins on wants; the storage-limitation argument is weaker; more notifications in a system without controls.
- **Best when**: there is data showing wants outlive any fixed period.
- **Evidence**: report §5.1 "not a proven pattern", Appendix B. Confidence: low.
- **Effort**: M.

#### 6.2A. Manual closing only

The seeker marks a want as found or withdraws it.

- **Pros**: what every platform does; nothing to build beyond two actions.
- **Cons**: stale wants after the need is met (one documented complaint), softened by expiry.
- **Best when**: always available as the base.
- **Evidence**: report §5.1 P5, §5.2. Confidence: high.
- **Effort**: S.

#### 6.2B. Prompt to close after a reservation of a matched item

When the seeker takes or agrees a swap for an item that is in the want's match list, the interface offers "found it — close this want?".

- **Pros**: catches the common fulfilment path without guessing; needs no change to reservations, only a lookup in the match table.
- **Cons**: frontend-led; misses fulfilment outside matched items.
- **Best when**: 3.2A exists.
- **Evidence**: report §9.5 recommendation; `features/product/useItemTake.ts:21-141`. Confidence: medium.
- **Effort**: S.

#### 6.2C. Automatic closing through a reservation origin

Reservations carry the want they came from and a completed one closes the want.

- **Pros**: no stale wants after a matched exchange.
- **Cons**: no source; take/propose carry no origin field and nothing in them would close a want; a reservation can still be cancelled; a seeker may want several of the item.
- **Best when**: prompts are shown to be ignored.
- **Evidence**: report §9.5, §6.1 (take/propose row). Confidence: low.
- **Effort**: L.

#### Area 6 recommendation

**Recommended: 6.1B and 6.2A with 6.2B.** Reason: a matched private want should not vanish silently, and a prompt gets most of the benefit of auto-closing without touching reservations.

- **Would change if**: wants become public feed posts (then 6.1A fits better); time-bound needs dominate (add 6.1C).
- **Depends on**: area 1 (private wants make silent expiry pointless) and 3.2A.
- **Open sub-choice**: whether editing a want re-runs forward matching (Funda treats an edit as a new search; one source).

### Area 7: Moderation and abuse limits

Settled by the evidence and not an alternative: no offer-first rule and no give/ask ratio (rejected by Freecycle, Freegle and Buy Nothing). Limits must be database counts; both existing limiters are in-memory and reset on restart.

#### 7A. Limits only

A length rule and a cap on active wants; no text classifier, because nobody but the seeker reads a private want.

- **Pros**: no 503 when the classifier is down; least friction.
- **Cons**: text that later becomes visible (1B wording, 1C) would need retro-moderation; contact details sit in stored text; inconsistent with every other user text in the system.
- **Best when**: wants are certain to stay private for good.
- **Evidence**: report §9.6 closing remark. Confidence: medium (inference).
- **Effort**: S.

#### 7B. Standard synchronous checks plus a database-count cap

The contact-info rule, then the classifier, in the write request under a new `TextField` for wants; a cap on active wants per user counted in the database.

- **Pros**: the established pattern (needed items, term text); wants are clean before any later visibility step; the cap protects matching cost and the bell.
- **Cons**: a classifier outage blocks creating a want (503); the classifier does not detect spam, begging or off-topic text; the cap value is a guess.
- **Best when**: 1A or 1B.
- **Evidence**: report §9.6, R8; `moderation/text_guard.py:89-120`; `groups/application/terms.py:279-292`. Confidence: high.
- **Effort**: S.

#### 7C. Community rule set

7B plus the rules platforms use for wants others can read: a cap on new wants per period, a specificity rule (reject "anything", category-only names), a declared-resale flag, and a report entry point.

- **Pros**: answers the documented failure modes; the report channel is a legal duty once content is visible.
- **Cons**: cultures differ on caps (Freecycle caps, Freegle and Buy Nothing do not) and no data shows their effect; a specificity check in its cheap form is crude; needs someone to handle reports.
- **Best when**: 1C, 1D or 1E.
- **Evidence**: report §5.1 P3, P4, P7, §5.2, §9.6. Confidence: high for the rules, none for their effect.
- **Effort**: M to L.

#### 7D. Pre-moderation queue

A want is not active until approved, as photos are held PENDING.

- **Pros**: nothing harmful is ever shown.
- **Cons**: the admin queue handles photos only; volunteer-style approval delays are a documented complaint (Freecycle on Trustpilot); delay defeats a matching alert.
- **Best when**: a public board with staffed moderation.
- **Evidence**: report §5.2 (slow moderation); architecture notes on the photo queue. Confidence: medium.
- **Effort**: L.

#### Area 7 recommendation

**Recommended: 7B now; 7C becomes a precondition of any step where another person can read a want.** Reason: the synchronous checks cost almost nothing and keep the text fit for later visibility, while the community rules only earn their cost when there is a community reading.

- **Would change if**: area 1 lands on 1C, 1D or 1E (then 7C from the start, and a lawyer's view on Article 9 before launch).
- **Depends on**: area 1 entirely. Under 1B, moderation of the owner-facing wording is not needed as long as the signal carries no seeker text.

### Area 8: Response flow

#### 8A. Seeker acts through take/propose

A match links to the item page; the seeker takes it or proposes a swap; the existing notifications tell the owner and the seeker.

- **Pros**: exists end to end; already notifies both parties; no new privacy rule.
- **Cons**: the owner cannot act first; nothing links the reservation back to the want.
- **Best when**: 1A or 1B.
- **Evidence**: report §9.7; `groups/router/item_reservations.py:44-56`. Confidence: high.
- **Effort**: none (exists).

#### 8B. Owner's "mam to" relay

An owner who sees a want (1C, 1D) or an anonymous signal (1B) taps "offer mine"; the seeker gets a notification with the item, and still completes the exchange through take/propose.

- **Pros**: gives the owner an action without an owner-initiated reservation; under 1B it stays anonymous in both directions until the seeker acts; reuses the match table.
- **Cons**: new endpoint, kind and wording; an owner can nudge repeatedly unless limited; no precedent for the anonymous form.
- **Best when**: 1B ships and owners should be able to do something with the signal.
- **Evidence**: report §9.7 second row; `[codebase-needs-signals-notifications-outbox §F14–F17]`. Confidence: low to medium (inference).
- **Effort**: M.

#### 8C. Want-anchored conversation

A new messaging conversation kind tied to a want, between the seeker and a responder.

- **Pros**: the way every platform with visible wants is answered (private message); covers unlisted items.
- **Cons**: a new conversation kind with its own access rules; reveals identities; the main classifieds scam starts with moving the chat elsewhere, so contact-info rules must hold in messages too.
- **Best when**: 1C, 1D or 1E.
- **Evidence**: report §4.1, §5.1 P14, §6.2; `messaging/models.py:20-60`. Confidence: medium.
- **Effort**: L.

#### 8D. "List it now" path

A responder who has the item but has not listed it is taken to item creation with the want's name pre-filled; once listed, normal matching notifies the seeker.

- **Pros**: turns a want into supply without a message channel; `ItemCreateView` can already pass navigation state after create.
- **Cons**: only meaningful when wants are visible to others; item creation is a long form for a quick "I have this".
- **Best when**: 1C or 1D, as a lighter companion or substitute for 8C.
- **Evidence**: report §9.7 third row; `features/items/ItemCreateView.tsx:89`. Confidence: medium.
- **Effort**: S to M.

#### Area 8 recommendation

**Recommended: 8A only in the first increment; 8B as the companion of the 1B experiment.** Reason: for a private want the existing flow completes the exchange and already tells both parties.

- **Would change if**: area 1 lands on visible wants (then 8D first, 8C when messaging rules are settled).
- **Depends on**: area 1 entirely.

### Area 9: UX entry points

#### 9A. Two entries, one form, one source of truth

Keep the `/add` tile leading to `/add/hunting` and the "Konto" row leading to `/wanted`, backed by one hook feeding the list, the count and a single form. The empty-search prompt stays beside the other recovery paths and forwards the active filters as well as `q`.

- **Pros**: least change to shipped routes and copy; follows the no-results guidance (a wanted prompt is an addition, not a replacement); ends the mock's two differing create paths.
- **Cons**: the mock's views must be rewritten on real data; whether `?name=` survives a guest's login round trip is untraced.
- **Best when**: 3.1B, so the forwarded filters have somewhere to go.
- **Evidence**: report §9.8, §6.1, §5.1 P12, P13; `[codebase-frontend-wanted-mock §F7]`. Confidence: high for the guidance, medium for the application.
- **Effort**: M.

#### 9B. Search-first: "save as a want"

The only way to create a want is from `/search` (with or without results); `/wanted` is the list; `/add/hunting` goes away.

- **Pros**: the want is always search-shaped and pre-filled; one create path; no separate form to design.
- **Cons**: makes the feature a saved search in name as well as function, the sharpest collision with the brief's exclusion; removes the `/add` tile users already see; wording a want as a search is unnatural for "I need a pram".
- **Best when**: the user embraces the saved-search reading fully.
- **Evidence**: synthesis I3; `features/search/SearchView.tsx:260-281`. Confidence: medium (inference).
- **Effort**: S to M.

#### 9C. Dedicated form only

Wants are created only from `/add/hunting`; the empty-search prompt is removed or reduced to a plain link without forwarding.

- **Pros**: simplest wiring; no query hand-over to test.
- **Cons**: discards the best-supported entry moment (a failed search) and makes the user retype the query.
- **Best when**: 3.1A.
- **Evidence**: report §5.1 P12, P13 (against). Confidence: high.
- **Effort**: S.

#### Area 9 recommendation

**Recommended: 9A, with matches opening as a list of item cards under the want (from the match table).** Reason: it keeps the entries users already see and uses the failed search as the moment to ask, with the least retyping.

- **Would change if**: 2B/3.1A is chosen (then 9C); visible wants are chosen (a browse surface and a public route are added, which this area does not cover).
- **Depends on**: 3.1B, 3.2A and area 5 (the grouped notification links to the match list).

## Trade-Off Analysis

Ratings are from the platform's point of view: High is favourable for feasibility, user impact, simplicity and scalability. Risk is the level of risk, so Low is favourable. "Rec" marks the recommended alternative.

### Area 1: Product shape

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 1A Private seeker alert (Rec, first) | High — mostly wiring | Medium — seeker served, owner unaware | High | Low | High — model extends to others |
| 1B Anonymous owner signal (Rec, second) | Medium — new kind, switch | Unknown — no precedent; may read as noise | Medium | Medium to high, reversible by the switch | Medium |
| 1C Group-scoped wants | Medium to low — response channel missing | Medium to high in active groups | Low | Medium | Medium |
| 1D Public wanted board | Low — many missing pieces | High reach, known abuse | Low | High, hard to withdraw once public | Low — moderation load grows with use |
| 1E Seeker-chosen audience | Low | High in theory; defaults rarely change | Low | High | Medium |

Key trade-off: precedent and safety (1A) against the brief's literal wording (1B and beyond).

### Area 2: Scope line

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 2A Single demand object (Rec) | High | High — one concept | High | Low, if the user confirms | High |
| 2B Unlike a search | High | Low — weaker matches | High | Medium — noisy alerts | Low — no pre-filter |
| 2C Seen by someone | Low — pulls area 1 forward | Medium | Low | High | Medium |

### Area 3: Data model and module home

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 3.1A Name-only | High | Low to medium | High | Medium — match noise | Low |
| 3.1B Name + optional filters (Rec) | High | High | Medium | Low | High |
| 3.1C Stored search query | High to store, low to match | Medium | Medium | Medium — coupling to search's shape | Low in reverse |
| 3.2A Match table (Rec) | High | High — no repeats, real count | Medium | Low | High |
| 3.2B Watermark only | High | Low — repeats or gaps | High | Medium | Medium |
| 3.2C Dedup on notifications | Medium | Low | Medium | Medium — shared table | Low |
| 3.3A New module + ACLs (Rec) | High | Neutral | Medium — some copies | Low | High |
| 3.3B Inside groups | High | Neutral | Medium now, lower later | Medium — context bloat | Low |
| 3.3C Split | Medium | Neutral | Low | Medium — new dependency direction | Medium |

### Area 4: Matching

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 4.1A Forward periodic | High | Low — delay, flood | High | Medium — statement count grows | Low |
| 4.1B Reverse only | Medium | Low — new want sees nothing | Medium | Medium | Medium |
| 4.1C Both, outbox events (Rec) | Medium | High | Medium to low | Medium — cost unmeasured | Medium to high |
| 4.1D Both, periodic scan | Medium to high | Medium — delay | Medium to high | Medium — missed re-listings | Medium |
| 4.2A Existing recipe, stricter (Rec) | High | Medium — inflection misses | High | Medium — untuned threshold | Medium |
| 4.2B Category-led | High | Medium — more form, noisy if broad | Medium | Medium | High |
| 4.2C Lemmatisation | Low today | High if quality holds | Low | High — images, RC software | Medium |
| 4.2D Embeddings | Low | Unknown | Low | High | Medium |
| 4.3A Any visible item | High | Low — unusable alerts | High | Medium | High |
| 4.3B Takeable only (Rec) | Medium | High | Medium | Low to medium | Medium |
| 4.3C Record all, notify takeable | Low to medium | High | Low | Medium | Medium |

Key trade-off: completeness and timeliness (4.1C) against touching two write paths; cost-free text matching (4.2A) against unknown Polish quality.

### Area 5: Notification delivery

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 5A Row per match | High | Low at volume | High | High — fatigue, hidden prompts | Low |
| 5B Grouped rows (Rec) | Medium | High | Medium | Low to medium | High |
| 5C Daily digest row | Medium | Medium — stale by read time | Medium | Low | High |
| 5D Pull only | High | Low — promise broken | High | Low | High |

### Area 6: Lifecycle

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 6.1A Fixed, silent | High | Low for a private want | High | Low | High |
| 6.1B Default + reminder + extend (Rec) | High | High | Medium | Low | High |
| 6.1C Seeker-chosen | High | Medium | Medium | Low | High |
| 6.1D No expiry, check-ins | Medium | Unknown | Medium | Medium | Medium |
| 6.2A Manual closing (Rec, base) | High | Medium | High | Low | High |
| 6.2B Prompt after reservation (Rec) | High | High | High | Low | High |
| 6.2C Auto-close by origin | Low | Medium | Low | Medium — wrong closes | Medium |

### Area 7: Moderation and limits

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 7A Limits only | High | High — no friction | High | Medium — blocks later visibility | Low |
| 7B Sync checks + cap (Rec) | High | Medium — 503 on outage | High | Low | High for private wants |
| 7C Community rule set | Medium | Medium | Low | Medium — unknown effect | Medium |
| 7D Pre-moderation | Low | Low — delay | Low | Low for content, high for adoption | Low |

### Area 8: Response flow

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 8A Take/propose (Rec) | High — exists | Medium to high | High | Low | High |
| 8B "Mam to" relay | Medium | Unknown | Medium | Medium | Medium |
| 8C Want-anchored conversation | Low | High for visible wants | Low | Medium to high | Medium |
| 8D "List it now" | Medium to high | Medium | Medium | Low | High |

### Area 9: UX entry points

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 9A Two entries, one form (Rec) | High | High | Medium | Low | High |
| 9B Search-first | High | Medium | High | Medium — scope collision | Medium |
| 9C Dedicated form only | High | Low — retyping | High | Low | Medium |

## Recommended Approach

**A staged, seeker-first want: 1A → 1B, on 2A, 3.1B + 3.2A + 3.3A, 4.1C + 4.2A + 4.3B, 5B, 6.1B + 6.2A/B, 7B, 8A, 9A.**

In one paragraph: a logged-in user saves a want — a required name and optional category, offer mode, locality and radius — from the add tile, the account list or a failed search. A new backend module stores it, checks the text with the existing synchronous rules and counts it against a per-user cap. The module matches it once against current listings and afterwards against each newly listed item, through outbox events raised where items become listed, always behind the visibility predicate and only for items the seeker can take. Each (want, item) pair is recorded once. The seeker gets grouped in-app notifications and a match list; the exchange itself runs through the existing take/propose flow, which already tells the owner. The want expires by default after a reminder, and the seeker closes it, prompted after reserving a matched item. As a second, separately switchable step, the owner of a matching item sees an anonymous, aggregated demand signal.

**Primary rationale.** Every part of the first step has either platform precedent (seeker alerts, minimal form, expiry, seeker-closed outcomes, throttling) or existing code (search columns, outbox, notifications, moderation, take/propose). The only part of the brief without precedent — telling the owner — is isolated in a step that can be measured and turned off, instead of being built into the base or dropped.

**Trade-offs accepted.**
- The first increment does not meet "notifies both sides" literally; owners hear only when the seeker acts.
- Owners of unlisted items are never reached; a want does not create supply.
- Polish inflection will cause missed matches until measured and tuned.
- Up to 60 s outbox delay plus the grouping window before a seeker is told.
- Some small duplicated query builders, because `app/search` may not be imported.

**Key assumptions.** If one is wrong, the recommendation changes as stated.
- The user accepts staging "both sides". If not: ship 1A and 1B together.
- The user accepts 2A as the meaning of the saved-search exclusion. If not: 2B (weaker matching) or 2C (visible wants first).
- Wants and items number in the thousands and a pre-filtered scan is fast enough. If not: 4.1D with a longer interval, or an index strategy from the design phase.
- Trigram plus full-text gives acceptable precision on Polish names under some threshold. If not: 4.2B first, then 4.2C when PostgreSQL 19 is generally available.
- The listing write points can raise an outbox event without lengthening the listing transaction noticeably. If not: 4.1D.
- In-app only is enough for a first version. If not: the e-mail channel decision and its legal review come first.

**Confidence: medium.** High for architectural fit and for the first step's precedent; medium for effort; low for match quality, for any numeric default and for how owners will react to 1B.

**What the design phase needs from the user first**: the answers to areas 1 and 2.

## Why Not Others

**Area 1.** 1C group-scoped: a good later step, but it needs a response channel, an identity rule and a report entry point before it works at all. 1D public board: carries every documented failure mode and the highest legal exposure, and contradicts the earlier "never in results" intent. 1E seeker-chosen audience: pays for 1D on day one and adds a choice most users leave at its default.

**Area 2.** 2B: gives up the pre-filter and the forwarded search filters to keep a distinction users will not notice. 2C: forces the unproven half into the first release.

**Area 3.** 3.1A: text-only nationwide matching. 3.1C: cannot be pre-filtered or joined in the reverse direction. 3.2B: no memory of what was announced. 3.2C: ties match history to an uncleaned shared table and breaks under grouping. 3.3B: an account-level concept does not belong in the largest, group-centred context. 3.3C: introduces a dependency direction with no precedent; kept as a fallback. Extending `needed_items` or flagging an item: ruled out by the migration history and by platform evidence.

**Area 4.** 4.1A: one query per want per run and a first-run flood. 4.1B: a new want sees nothing already listed. 4.1D: a sound fallback, but it misses re-listings and rests on an untraced assumption about listing timestamps. 4.2B: seekers categorise badly; held as the first remedy if text precision is poor. 4.2C and 4.2D: real operating cost before any measured benefit. A search engine with a percolator: out of proportion at this scale. 4.3A: alerts for items that cannot be taken. 4.3C: a third write point in inventory with no evidence that release matters.

**Area 5.** 5A: floods and hides action prompts. 5C: with no e-mail it is only a slower 5B. 5D: breaks the promise the mock makes five times; its count is kept as an addition.

**Area 6.** 6.1A: silent expiry suits a feed, not a private alert. 6.1C: one more field for little gain at first. 6.1D and 6.2C: no source, and 6.2C has no hook in take/propose.

**Area 7.** 7A: leaves stored text unfit for any later visibility step. 7C: its cost is justified only when others read wants. 7D: delay defeats an alert and the queue handles photos only.

**Area 8.** 8B: only meaningful with 1B. 8C and 8D: only meaningful with visible wants.

**Area 9.** 9B: turns the feature into a saved search by name and removes an entry users already see. 9C: wastes the failed-search moment.

## Deferred Ideas

Excluded by the brief:
- **Saved searches and search alerts as a separate feature** — excluded at intake; under 2A the want covers the need, so a second list should not be built.
- **Search relevance work**, including ranking rule (1) "matches the user's szukam list" from the earlier search task — excluded; becomes possible later through a `search/infrastructure/wants_acl.py`.
- **Monetisation and paid promotion of wants** — excluded.
- **Implementation, specification and task planning** — a later development workflow.

Stretch (related, deferrable):
- **E-mail or push delivery** — nothing exists; needs verified, consented addresses, an unsubscribe mechanism and a lawyer's reading of Article 398; the earlier ADR-009 deferred e-mail.
- **A notification settings screen and global preferences** — the per-want mute and the 1B switch cover the first steps; a full preference centre is its own task.
- **Polish lemmatisation, embeddings** — revisit after the match-quality measurement and when PostgreSQL 19 is generally available.
- **Release of a reservation and item edits as matching signals** — no source; decide after seeing how often matched items are reserved and released.
- **Photos on a want** — useful only when others can see it.
- **Automatic closing through a reservation origin field** — needs a change to take/propose; revisit if prompts are ignored.
- **Group-scoped or public wants with a want-anchored conversation, report entry point and seeker-identity rule** — the third step, after legal review.
- **Owner opt-in alerts on wants** (the Trash Nothing shape) — the fallback form of 1B if unrequested signals are ruled out.

Out of scope (separate concerns):
- **Matching per-term needed items against listed items** — nothing in the code prepares for it; needed items stay unchanged.
- **Demand statistics for organizers or admins** ("most wanted, never listed") — a reporting feature the match table would make possible.
- **`PUT /api/products/{id}` ownership check** — unverified observation from the research (report Appendix D); needs its own check because a product rename changes what every item of that product matches.
- **Clean-ups noticed in passing** — the frontend `NotificationKind` union still lists the removed `PLEDGE_ITEM_REGISTERED`; the `main.py` docstring states a stale 30 s outbox interval.
- **Persistent rate limiting in general** — the in-memory limiters for messages and join codes have the same restart weakness; wants only need their own database count.
