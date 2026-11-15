# Decision Log

## TL;DR
- 13 records. Twelve carry a Phase 4 decision of the user; eight of those also contain values or mechanisms proposed by the designer. One record (ADR-006) is a proposal only.
- The most consequential: a private seeker alert first (ADR-001), a periodic scan with a creation-time marker instead of events at the listing write points (ADR-005), and one match statement for both directions (ADR-006).
- Hard to reverse later: the module boundary (ADR-004), the unique (want, item) table with hard delete (ADR-003), and the meaning of "takeable" (ADR-008).
- Nothing marked "Proposed" is settled. The list of proposals is in `high-level-design.md`, section "Proposals to confirm".

## Key Decisions
- Private want, seeker notified only, owner signal as a second step — precedent and ready code first (ADR-001).
- Scan with a time marker, not outbox events — no change to listing write paths, at the cost of delay and missed re-availability (ADR-005).
- One statement for forward and reverse matching — a pair cannot match in one direction and not the other (ADR-006).
- Notifications written by the scan, replaced while unread — at most one row per want per run (ADR-009).
- Hard delete 30 days after closing — the retention decision, with no reader left for the row (ADR-003, ADR-010).

## Open Questions / Risks
- Thresholds (ADR-007) and the scan cost (ADR-005, ADR-006) rest on reasoning, not measurement.
- ADR-008 leaves out items reachable only through a shared term or event after their pickup place was deleted.
- ADR-009 changes `app.notifications` by one writer function; ADR-004 widens one parameter type in `app.groups`. Both are small but touch shared code.
- ADR-001's second step has no precedent on any reviewed platform and waits for legal review.

## How to read the status
- **Accepted (user, Phase 4)**: decided by the user in the convergence phase. Binding.
- **Proposed (designer)**: filled in by this design because Phase 4 left it open. Needs the user's confirmation.
- A record can hold both; the "Decided by" line says which part is which.

Alternatives are described in full in [solution-exploration.md](solution-exploration.md); each record names the area it draws on.

---

## ADR-001: Private seeker alert first, owner signal second

### Status
Accepted (user, Phase 4)

**Decided by**: user.

### Context
The brief says the system "notifies both sides". None of eleven reviewed platforms matches wants to listings or tells an item's owner about a want; machine matching exists only as the seeker's own alert. The shipped mock promises a notification to the seeker only. Telling the owner has no precedent and adds little for an item that is already listed, because take and propose notify the owner once the seeker acts.

### Decision Drivers
- Precedent and existing code for the seeker side.
- No tested pattern for an unrequested message to the owner.
- Abuse and legal exposure grow as soon as another person reads a want.

### Considered Options
1. 1A Private seeker alert
2. 1B Private want with an anonymous owner signal
3. 1C Group-scoped wants
4. 1D Public wanted board
5. 1E Seeker-chosen audience per want

See solution-exploration.md, Area 1.

### Decision Outcome
Chosen option: 1A in v1, with 1B as a designed second increment behind a switch, because the first half has precedent and ready code and the second can be measured and turned off.

### Consequences

#### Good
- v1 needs no seeker-identity rule, no response channel and no report entry point.
- The match table built for v1 is the input of the owner signal later.

#### Bad
- v1 does not meet "notifies both sides" literally; the owner hears only when the seeker acts.
- Owners of unlisted items are never reached; a want does not create supply.
- The second step still needs a legal check and a decision for PRIVATE items.

---

## ADR-002: The want is the single standing-demand object

### Status
Accepted (user, Phase 4)

**Decided by**: user.

### Context
A private want that is matched automatically does the same job as a saved-search alert, which the brief excluded "as a separate feature". The line had to be drawn on purpose.

### Decision Drivers
- One concept for users.
- No second storage, matching or notification path.
- A want must stay more than a stored filter set.

### Considered Options
1. 2A The want is the single standing-demand object
2. 2B Keep wants deliberately unlike a search (name only)
3. 2C A want is defined by being seen by someone

See solution-exploration.md, Area 2.

### Decision Outcome
Chosen option: 2A, with the name required, because the equivalence is a fact of the design and one demand object costs least.

### Consequences

#### Good
- The empty-search prompt can hand its query and filters to the want form.
- No saved-search feature is built beside wants.

#### Bad
- The feature overlaps the excluded one in function; this is accepted, not avoided.
- A filter-only want is not possible.

---

## ADR-003: Want and match tables; hard delete after retention

### Status
Accepted (user, Phase 4) for the shape; Proposed (designer) for names, columns and the delete mechanism

**Decided by**: user — name plus optional filters (3.1B), unique (want, item) table (3.2A), deletion 30 days after closing. Designer — table names `wants`, `want_matches`; the precomputed match columns; hard delete with no `deleted_at`; `ON DELETE` rules.

### Context
Search already filters on category, offer mode, locality and radius, so the same columns on a want make matching cheap and let a want be created from a search. The system has no deduplication for notifications; a unique pair row is the only one available. The retention decision asks for closed wants and their matches to be deleted.

### Decision Drivers
- Plain-column pre-filters for the reverse direction.
- One memory of what was already matched.
- Model and migration standards (UUID keys, naming, naive-UTC audit times, loose cross-module item pointers).
- Storage limitation for personal text.

### Considered Options
1. 3.1A Name-only want
2. 3.1B Name plus optional structured filters
3. 3.1C Want as a stored search query
4. 3.2A Unique (want, item) match table
5. 3.2B Per-want watermark, no pair rows
6. 3.2C Deduplicate on the notification row
7. Soft delete with `deleted_at` versus hard delete after retention (designer)

See solution-exploration.md, Area 3.

### Decision Outcome
Chosen option: 3.1B with 3.2A, and hard delete, because filters as columns are what the matcher joins on, the pair table is the only deduplication, and after retention nothing reads the row.

### Consequences

#### Good
- The pair row serves deduplication, the match list, the counter and the later owner signal.
- No `deleted_at`, no partial unique indexes; the `status` column is the soft state for 30 days.
- Condition is left out, so no ordering of conditions has to be invented.

#### Bad
- Match history is lost with the want, so conversion must be measured inside the retention period.
- A notification can outlive its want and link to a not-found page.
- Loose item pointers go stale; the match list must filter at read time.
- The want row carries derived columns (`name_folded`, `name_query`, `short_words_query`) that must stay in step with `fold_pl()`.

---

## ADR-004: New module `app/wants` with its own ACLs

### Status
Accepted (user, Phase 4) for the module; Proposed (designer) for its name and its place in the boundary guard

**Decided by**: user — a new backend module with its own ACLs (3.3A). Designer — the name `app/wants`, one ACL file per foreign module, adding the module to `tests/test_module_boundaries.py`.

### Context
`app/search` is read-only by design and importable only from `app/main.py`, so it can neither host the feature nor lend its private query builders. `app/groups` is the largest context and is group-centred; a want is an account-level object. The codebase has a test-enforced pattern of one ACL per foreign module.

### Decision Drivers
- Follow the boundary pattern the tests enforce.
- Keep `app/groups` from growing.
- Leave room for the second step.

### Considered Options
1. 3.3A New module with its own ACLs
2. 3.3B Inside `app/groups`
3. 3.3C Split: wants module owns the data, groups owns the matcher

See solution-exploration.md, Area 3.

### Decision Outcome
Chosen option: 3.3A, named `app/wants`, because it is the established pattern and keeps the new concept apart from needed items and listing preferences.

### Consequences

#### Good
- Dependencies point one way: wants reads other modules; none of them imports wants.
- `app/search` can later read wants through its own ACL.

#### Bad
- Small copies of search's builders (radius, category tree, link paths), kept honest by a parity test for the links.
- `app/groups` must accept a column where `owner_shares_group_with` takes a value today. If that proves awkward, 3.3C is the fallback.
- Nine ACL files for one feature.

---

## ADR-005: Periodic scan with a creation-time marker

### Status
Accepted (user, Phase 4) for the mechanism; Proposed (designer) for the interval, the overlap and the marker table

**Decided by**: user — 4.1D, a periodic scan with a marker for new listings, the scan window being the notification grouping window; fallbacks named by the user: a marker by id, then 4.1C. Designer — 15-minute interval, 5-minute overlap, the `want_scan_markers` row, the single transaction.

### Context
No signal exists when an item becomes listed. The brainstormer recommended outbox events at the two listing write points (4.1C); the user chose a scan that touches neither write path. The design verified that the listing row is a `BaseEntity` whose `created_at` is set once at insert and that re-listing creates a new row. Ids are `uuid4`, so a marker by id is not possible.

### Decision Drivers
- No change to the inventory or groups write paths; no longer listing transaction.
- A constant number of statements per run.
- One window for matching and for grouping notifications.
- An existing model: `term_end_scan`.

### Considered Options
1. 4.1A Forward only, periodic re-run per want
2. 4.1B Reverse only, on each newly listed item
3. 4.1C Both directions, outbox events at the listing write points
4. 4.1D Both directions, periodic set-based scan with a marker

See solution-exploration.md, Area 4.

### Decision Outcome
Chosen option: 4.1D with a time marker, every 15 minutes with a 5-minute overlap, because it needs no write-path change and the unique pair key makes the overlap and any retry harmless.

### Consequences

#### Good
- The listing code is untouched.
- Each run yields at most one notification per want without a separate grouping step.
- Downtime is caught up by a longer window.

#### Bad
- Up to 15 minutes of delay; a scarce item may be gone.
- Items that become takeable after their listing time are never matched: released reservations, rejected proposals, PRIVATE turned PUBLIC, a changed offer mode, item or product edits.
- The marker relies on `created_at` being close to commit time; the overlap is the safety margin and must be confirmed by a test.
- If the measured cost is too high, the fallback is 4.1C, which does touch the write paths.

---

## ADR-006: One match statement for both directions

### Status
Proposed (designer)

**Decided by**: designer. The user decided the behaviour: existing matches are shown at once with one query and no notification.

### Context
Matching runs in two situations: for one want against all current listings, and for new listings against all active wants. Search's builders serve only the first shape and bind the viewer, the radius and the origin as Python values. Two separate implementations of the predicates would drift.

### Decision Drivers
- A pair must match the same way in both directions.
- Constant statement count.
- One place for visibility and takeability rules.

### Considered Options
1. Two builders: a search-shaped select for the forward direction and a separate reverse statement
2. One statement over `wants` joined to listings, with a direction filter (one want, or a listing time window)
3. Forward match computed on read, never stored

### Decision Outcome
Chosen option: 2, because the predicates then exist once and forward rows land in the same table as scan rows, born seen.

### Consequences

#### Good
- No divergence between "shown at creation" and "found by the scan".
- Forward matches are remembered, so the scan never announces them.
- The closing prompt and the conversion measurement cover forward matches too.

#### Bad
- The forward plan depends on the planner using the product indexes with the want's text coming from a joined row, not a constant. This must be shown by `EXPLAIN ANALYZE`.
- Column forms of the radius, category and group-sharing rules have to be written; they cannot be imported from search.
- A slow forward match fails the create request (503 after 3 s).

---

## ADR-007: Text matching rules and starting thresholds

### Status
Accepted (user, Phase 4) for the rules; Proposed (designer) for the numbers

**Decided by**: user — a text signal is always required (full text or name trigram); a category narrows to its subtree (AND) and allows a looser threshold; words of up to 3 characters match exactly only; start strict and log opens and takes; no lemmatisation or embeddings in v1. Designer — thresholds 0.70 and 0.60, full text over name and description, the `short_words_query` column.

### Context
The database uses the `'simple'` configuration with `fold_pl()`: no Polish stemming. Inflected forms match only through trigram similarity on the name. Search has no cut-off; a notification needs a yes or no. No labelled Polish data exists.

### Decision Drivers
- A false alert costs the seeker's attention.
- Stock PostgreSQL 18, no new extension or model.
- The threshold must be tunable from measured data.

### Considered Options
1. 4.2A Existing recipe with a stricter threshold
2. 4.2B Category-led matching
3. 4.2C Polish lemmatisation
4. 4.2D Small embedding model with pgvector

See solution-exploration.md, Area 4.

### Decision Outcome
Chosen option: 4.2A as modified by the user, starting at 0.70 without a category and 0.60 with one, because it has no operating cost and can be tuned once the labelled sample is scored.

### Consequences

#### Good
- Reuses `products.search_vector`, the name trigram index and `fold_pl()`.
- A category never matches on its own, so a broad category cannot flood a want.
- Sizes and codes ("110", "XL") cannot match by accident.

#### Bad
- Inflected and reworded names will be missed until the thresholds are measured.
- The short-word rule also rejects reasonable pairs ("TV" against "telewizor").
- The numbers are guesses. Release should wait for the sample.

---

## ADR-008: What "takeable" means at match time

### Status
Accepted (user, Phase 4) for the rule; Proposed (designer) for the definition

**Decided by**: user — only items takeable at the moment of matching (4.3B). Designer — the predicate below.

### Context
A listed item can be reserved, can have a pending swap proposal, or can be reachable only through a context the seeker has no access to. A seeker outside the owner's groups and events can reserve only through personal pickup, which needs a live place on the item. A first listing already requires a live place.

### Decision Drivers
- Every alert should be actionable.
- The predicate runs for every candidate pair, so it must be cheap.

### Considered Options
1. 4.3A Any visible listed item counts
2. 4.3B Takeable only, defined as: balance `AVAILABLE`, no pending proposal, live pickup place
3. 4.3B with the full context check: personal pickup, or a shared upcoming term or event
4. 4.3C Record every visible match, notify only when takeable

See solution-exploration.md, Area 4.

### Decision Outcome
Chosen option: 2, because it covers nearly every listed item with one join, and the full context check would add attendance and event joins per pair.

### Consequences

#### Good
- No alert for an item that is reserved or under a pending proposal.
- The PRIVATE case needs no extra rule: the visibility predicate already requires a shared private group, which is what personal pickup checks.

#### Bad
- An item whose place was deleted after listing is skipped even if a shared term would allow the take.
- An item that is busy when it is scanned is not picked up when it is released (see ADR-005).
- Take and propose can still refuse at action time; the match is a snapshot.

---

## ADR-009: Grouped notifications, replaced while unread

### Status
Accepted (user, Phase 4) for the behaviour; Proposed (designer) for the mechanism and names

**Decided by**: user — at most one row per want per scan window; one match links to the item with its name, two or more show a count and link to the match list; an unread previous row is updated; a switch per want; a count of new matches on the list and the tile, reset when the list is opened; no e-mail or push in v1. Designer — kinds `WANT_MATCH_FOUND` and `WANT_EXPIRING`; the pointer and count on the want; direct write from the scan; the reset as a POST.

### Context
Notifications are an in-app list with no preferences, grouping, caps or deduplication, and the bell shows the newest 50 rows. This is the first kind that is a recommendation. `create_notification` returns nothing, and the table has no generic subject column.

### Decision Drivers
- Protect action prompts in the bell.
- No migration on the shared `notifications` table if avoidable.
- GET requests stay free of side effects.

### Considered Options
1. 5A One in-app row per match
2. 5B Grouped in-app rows
3. 5C Daily digest row
4. 5D Pull only: a count, no bell rows
5. Mechanism: a `want_id` pointer column on `notifications` versus a pointer and count on the want (designer)
6. Mechanism: through the outbox versus written by the scan (designer)

See solution-exploration.md, Area 5.

### Decision Outcome
Chosen option: 5B with the count from 5D, the pointer kept on the want and the rows written by the scan, because the scan run is already the grouping window, the replace rule needs the row id, and the shared table stays unchanged.

### Consequences

#### Good
- At most one unread match row per want, so at most 30 per user.
- New kinds need no migration and stay out of pending actions.
- The counter comes from the match table and does not depend on the bell.

#### Bad
- `app.notifications` gains a writer that replaces an unread row and moves its time; this is new behaviour for that module.
- The bell row and the counter can disagree (one is read state, the other is seen state).
- In-app only: a seeker who does not return is not told.
- An image-only rollback needs the rows of the new kinds deleted first.

---

## ADR-010: Lifecycle as a stored status with a sweep in the scan job

### Status
Accepted (user, Phase 4) for the rules; Proposed (designer) for the mechanism

**Decided by**: user — 90 days of validity; a bell reminder 7 days before the end; extension keeps the want and its matches; an expired want stays listed with a resume action; closed wants are deleted with their matches after 30 days; manual "found" and "withdraw"; a closing prompt after a reservation or agreed swap of a matched item; a fulfilled want can be reopened during retention; a closed want drops out of the scan; optional automatic extension. Designer — the `status`, `expires_at`, `closed_at`, `reminded_at` columns; the sweep as the first part of the scan job; the reminder ignoring the per-want switch; automatic extension on; withdrawn wants hidden.

### Context
A private matched want has no feed, so silent expiry would only lose the alert unnoticed. The periodic job needed for matching can also carry the time-driven transitions.

### Decision Drivers
- Nobody loses a want silently.
- Storage limitation.
- One scheduled job, one commit.

### Considered Options
1. 6.1A Fixed period, silent expiry, repost as new
2. 6.1B Default expiry with a reminder and one-tap extension
3. 6.1C Seeker-chosen expiry
4. 6.1D No expiry, periodic check-in
5. 6.2A Manual closing only
6. 6.2B Prompt to close after a reservation of a matched item
7. 6.2C Automatic closing through a reservation origin
8. Mechanism: status derived from `expires_at` on read versus stored and moved by a sweep (designer)

See solution-exploration.md, Area 6.

### Decision Outcome
Chosen option: 6.1B and 6.2B with the manual actions of 6.2A, as a stored status moved by a sweep inside the scan job, because the purge needs a closing time and the scan already filters on the expiry time itself.

### Consequences

#### Good
- The stored status is at most one interval behind; matching is exact because it also checks `expires_at`.
- Resume and reopen are one transition with a fresh forward match.
- No change to reservations.

#### Bad
- One more notification kind in a bell without controls.
- 90, 7 and 30 days are product guesses with no tested source.
- The prompt is frontend-led and misses fulfilment outside matched items.

---

## ADR-011: Synchronous text checks and database-count limits

### Status
Accepted (user, Phase 4)

**Decided by**: user. Designer adds only the two `TextField` names (`WANT_NAME`, `WANT_NOTE`) and the 409 for the cap.

### Context
Nobody but the seeker reads a private want, but the text should be fit for a later visibility step, and every other user text in the system is checked on write. Both existing rate limiters are in memory and reset on restart.

### Decision Drivers
- Consistency with other user text.
- Text ready for the second step.
- Limits that survive a restart.

### Considered Options
1. 7A Limits only
2. 7B Standard synchronous checks plus a database-count cap
3. 7C Community rule set
4. 7D Pre-moderation queue

See solution-exploration.md, Area 7.

### Decision Outcome
Chosen option: 7B — contact-info rule, then classifier, for the name and the note; name 3–80 characters, note up to 300; 30 active wants per user counted in the write transaction without locks; 20 best matches per want per scan run; 503 on a classifier outage. 7C is deferred to the step where a want becomes visible in a group; aggregate demand without text does not need it.

### Consequences

#### Good
- The established pattern; no new moderation machinery.
- The cap bounds matching cost and bell rows.

#### Bad
- A classifier outage blocks creating and editing wants.
- The classifier detects harm, not spam or begging.
- Without locks, concurrent requests can pass the cap by a small margin.

---

## ADR-012: Response through take and propose; want found by lookup

### Status
Accepted (user, Phase 4)

**Decided by**: user.

### Context
A matched item page already offers take and propose, and both already notify the owner and the seeker. Nothing in them refers to a want.

### Decision Drivers
- No change to the reservation flow or its locking.
- A way to offer closing and to measure conversion.

### Considered Options
1. 8A Seeker acts through take / propose
2. 8B Owner's "mam to" relay
3. 8C Want-anchored conversation
4. 8D "List it now" path
5. Link to the want: an origin field on the reservation versus a lookup in the match table

See solution-exploration.md, Area 8.

### Decision Outcome
Chosen option: 8A in v1, with the want found by a lookup in the match table, because the existing flow completes the exchange and the pair row already links item and want. 8B (with the owner signal) and 8D (with aggregate group demand) are settled later; 8C is out of scope.

### Consequences

#### Good
- No migration and no new rule in reservations.
- The lookup serves the closing prompt and the conversion query.

#### Bad
- The owner cannot act first.
- A take of an item that was never stored as a match is not linked to any want.
- Conversion is measured by a join, only while the match rows exist.

---

## ADR-013: Entry points, routes and a logged-in-only API

### Status
Accepted (user, Phase 4) for the entry points and routes; Proposed (designer) for the API shape and permissions

**Decided by**: user — 9A: the `/add` tile leads to `/add/wanted` (renamed from `hunting`), the "Konto" row to `/wanted`; one hook for the list, the count and the form; the empty-search prompt passes the query and the active filters; the form shows the name with the rest under "Doprecyzuj"; after saving, redirect to `/wanted/:id`, which also serves the bell and the count and resets the count. Designer — the `/api/wants` routes, the two matrix rows without OAuth scopes, 404 for a foreign want, no public route, the feature folder `features/wanted`, no redirect from the old path.

### Context
The mock has two disconnected create paths and a constant count. The login gate keeps the path and the query in `returnTo` in both the proxy and the client guard (read in code, not tested). GET requests accept the session cookie and must stay free of side effects.

### Decision Drivers
- Keep the entries users already see.
- One source of truth on the client.
- Private data stays behind login.

### Considered Options
1. 9A Two entries, one form, one source of truth
2. 9B Search-first: "save as a want"
3. 9C Dedicated form only
4. API: action sub-routes (`/extend`, `/close`, `/resume`, `/matches/seen`) versus a single PATCH carrying the status (designer)

See solution-exploration.md, Area 9.

### Decision Outcome
Chosen option: 9A, with action sub-routes on `/api/wants`, because each lifecycle action has its own rule (cap check, forward match, period reset) and a POST per action keeps the counter reset out of GET.

### Consequences

#### Good
- One hook feeds the list, the counts and the form.
- A failed search becomes a want without retyping.
- No public route, so no personalised-cache handling in v1.

#### Bad
- The mock's views and their tests are rewritten; `/add/hunting` stops working.
- The registration path through the gate is untraced and needs a test.
- Condition and scope are dropped when a search becomes a want.
