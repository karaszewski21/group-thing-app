# Research Plan: "Szukam" (wanted) mechanism

## TL;DR
- Mixed research: three codebase gatherers map what a wanted post would reuse or touch, four external gatherers collect how comparable platforms do it and how matching and alerts are built.
- Seven parallel gatherers with non-overlapping scopes; configuration is folded into the codebase gatherers, not a separate one.
- The frontend already ships a mock "Szukam" (`/wanted`, `/add/hunting`, an empty-search entry point) with no backend; it is treated as the current statement of product intent.
- Matching research is limited to what runs on PostgreSQL 18 with `fold_pl()` full-text and trigram indexes, plus small models on the app server; a separate search engine is compared only as a reference point.

## Key Decisions
- Seven gatherers, not five — eleven platforms are too many for one gatherer, so platforms are split into gift/free-sharing and classifieds/marketplaces.
- A separate frontend gatherer — the mock wanted UI and the needed-items UI are a distinct body of evidence from the backend modules.
- No configuration gatherer — the relevant configuration is four files, read by the backend gatherer that owns the topic.
- Platform facts need a first-party source (help centre, product blog, the app itself) where one exists — third-party articles about these products go stale quickly.
- Every finding carries a confidence level (high, medium, low) per the methodology reference — success criterion 5 asks for it.

## Open Questions / Risks
- External URLs in `sources.md` are entry points and were not fetched during planning; gatherers must confirm each one and record the date read.
- Several platforms (Vinted, Wallapop, Facebook Marketplace) may have no wanted feature at all; "absent, and why" is a valid finding and must be recorded as such, not skipped.
- Help-centre pages behind logins or regional redirects (Olio, Buy Nothing, Bunz) may be unreachable; Bunz may no longer operate in its original form.
- The mock UI and the brief may disagree on fields (the mock has a name, a description and offer modes; the brief adds category, condition, location, expiry, photos). The research reports the difference; it does not resolve it.
- Whether wanted posts are personal, group-scoped or both is a product decision the research can inform but not make.

## Research Overview

**Research question**: How should the platform implement a "szukam" (wanted / in-search-of) mechanism — data model, matching, notifications, visibility, moderation and UX — based on the best patterns used by comparable platforms, and how does it fit the existing architecture?

**Research type**: Mixed — literature (industry patterns) and technical (codebase fit).

**Scope**: as in `planning/research-brief.md`. Included: wanted-post structure, matching, notifications, visibility, lifecycle, moderation, UX, fit with existing code. Excluded: saved searches as a feature of their own, `/search` relevance work, implementation and specification, monetisation.

**Sub-questions**

| # | Sub-question | Gatherers |
|---|--------------|-----------|
| Q1 | What does a wanted post consist of on comparable platforms (fields, expiry, photos, limits)? | 4, 5 |
| Q2 | When and how are wants matched to items, and how is that done on PostgreSQL in Polish? | 1, 6 |
| Q3 | Who is notified, how often, and how is alert fatigue avoided? | 2, 6 |
| Q4 | Who may see a want and the seeker's identity; how does this relate to PRIVATE items and groups? | 1, 4, 5, 7 |
| Q5 | What is the lifecycle (create, edit, fulfil, expire, renew, delete) and how does it link to take/propose reservations? | 2, 4, 5 |
| Q6 | How is abuse handled (text moderation, contact info, spam limits)? | 2, 7 |
| Q7 | Where are wants created, browsed and answered ("I have this"), and what does the existing mock already promise? | 3, 7 |
| Q8 | Should per-term needed items be extended, replaced or kept separate? | 2, 3 |
| Q9 | Which existing modules, tables and ACLs would be reused or touched, and what module boundary rules apply? | 1, 2, 3 |

## Methodology

**Primary approach**: hybrid, run in parallel.
- Technical part: iterative codebase reading — locate files, read models and services, trace one write flow and one read flow end to end, note boundary rules and tests.
- Literature part: multi-source review per platform and per technique, recorded in a fixed comparison template so platforms can be compared row by row.

**Fallback strategies**
- A platform's help centre is unreachable: use the app store listing, the product blog or changelog, then reputable third-party coverage; mark confidence medium or low.
- A platform has no wanted feature: record the nearest substitute (saved search, follow, group post) and any stated reason.
- A codebase area is larger than expected: read the model, the service entry points and the tests first; cite the rest by path.

**Analysis framework**
- Codebase: component inventory, flow tracing, integration mapping, reuse assessment (reuse as is / extend / new), boundary constraints.
- Platforms: one row per platform with the same columns — has wanted posts, post fields, where it lives, matching and alerts, response flow, visibility, expiry and renewal, limits and moderation, known problems, sources.
- Techniques: option, how it works, fit with the stack, cost at this scale, risks, sources.
- Confidence: high (several independent or first-party sources, or code), medium (one source or inferred), low (assumption).

## Data Sources

Full manifest with paths in `planning/sources.md`. Summary:

- **Codebase (backend)**: `src/backend/app/search`, `inventory`, `product`, `category`, `locations`, `groups` (needed items, pledges, visibility, membership, listing preferences), `notifications`, `outbox`, `moderation`, `messaging` (send limiter), `core`; tests in `src/backend/tests`; migrations in `src/backend/alembic/versions`.
- **Codebase (frontend)**: mock wanted UI in `src/frontend/src/features/search/WantedView.tsx`, `features/add/HuntingCreateView.tsx`, `utils/mocks.ts`; needed-items UI; notifications, search and item pages.
- **Documentation**: `.maister/docs/INDEX.md`, `project/architecture.md`, `project/tech-stack.md`, backend and frontend standards, earlier research and development task folders.
- **Configuration**: `src/backend/pyproject.toml`, `docker-compose.yml`, `.env.example` files (placeholders only), `src/frontend/package.json`.
- **External**: platform help centres and product pages; PostgreSQL documentation; search-engine documentation on reverse search; UX and trust-and-safety literature.

## Research Phases

1. **Locate and confirm** — each gatherer confirms its sources exist (files by Glob, URLs by fetch) and notes what is missing.
2. **Collect** — codebase gatherers read models, services, routers and tests; external gatherers fill the comparison template per platform or per technique.
3. **Trace and deepen** — codebase gatherers trace the flows named in their focus (below); external gatherers follow up on gaps and look for reported failure modes.
4. **Record** — findings written to `analysis/findings/[prefix]-*.md` with file and line references or URLs, the date read, and a confidence level per claim.
5. **Cross-check (synthesis stage)** — match platform patterns against codebase constraints; flag contradictions between sources.

## Gathering Strategy

### Instances: 7 (max 8)

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|-------------|------------|-------|---------------|
| 1 | codebase-items-search | Supply side and matching base: search, inventory, products, categories, localities, visibility | Glob, Grep, Read | codebase-items-search |
| 2 | codebase-needs-signals | Demand side today and signalling: needed items and pledges, notifications, outbox and scheduler, moderation, rate limits | Glob, Grep, Read | codebase-needs-signals |
| 3 | codebase-frontend | Existing mock "Szukam" UI, needed-items UI, notifications and search UI, routing | Glob, Grep, Read | codebase-frontend |
| 4 | external-gift-platforms | Wanted mechanisms on free-sharing and swap platforms | WebSearch, WebFetch | external-gift-platforms |
| 5 | external-classifieds | Wanted mechanisms (or their absence) on classifieds and second-hand marketplaces | WebSearch, WebFetch | external-classifieds |
| 6 | external-matching-alerts | Matching techniques and notification delivery patterns | WebSearch, WebFetch | external-matching-alerts |
| 7 | external-ux-trust | UX patterns for demand-side posts and trust-and-safety practice | WebSearch, WebFetch | external-ux-trust |

### What each gatherer collects

**1. codebase-items-search**
- How an item becomes listed and searchable: `inventory_items.listing_status`, `item_listing_preferences` (offer type, visibility), the `products.search_vector` generated column, `fold_pl()`, trigram indexes, `categories.path_text`.
- How `app/search` builds its item query: `_matching`, `_items_select`, `_near`, ranking in `domain/ranking.py`, the eight ACLs, the statement budget.
- Visibility rules R1–R12 in `groups/infrastructure/visibility.py` and `item_visibility.py`; what a match must never reveal (PRIVATE items, non-shared groups).
- Locality coordinates and the radius predicate; item location rules.
- The write points where a "new item listed" signal could be raised (item create, first listing, listing preference change, reservation release).
- Module boundary rules: read-only `app/search` and `app/pages`, `tests/test_module_boundaries.py`, ACL conventions.
- Configuration: PostgreSQL version and extensions in `docker-compose.yml` and migrations 0086–0098.
- Not in scope: needed items, notifications, moderation, any frontend file.

**2. codebase-needs-signals**
- `NeededItem` and `Pledge`: model, history (migrations 0017–0020, 0023, 0063, 0067, 0068), endpoints in `groups/router/terms.py` and `pledges.py`, rules in `application/pledges.py`, domain events in `domain/pledge_events.py`. State what a needed item is and is not, as the basis for the extend/replace/separate answer.
- Notifications: `NotificationKind`, `create_notification`, the reference-id columns, `groups/infrastructure/notifications_bridge.py`, `outbox_listener.py`, `clock.fit_notification_message`; whether any delivery channel beyond the in-app list exists (email, push), and whether per-user preferences or digests exist.
- Outbox and scheduler: `outbox/registry.py`, `dispatcher.py`, `scheduler.py`, APScheduler use, `groups/application/term_end_scan.py` as the model for a periodic scan (useful for expiry and digests).
- Moderation: `moderation/text_guard.py` (`TextField`, `check_text`), `rules.py` (`ensure_no_contact_info`), classifiers and what runs on the app server.
- Rate limiting: `messaging/application/send_limiter.py`, `groups/application/join_code_limiter.py`.
- Reservations entry points a "this matches your want" response would lead to: `POST /api/items/{id}/take|propose` and `ReservationContext`.
- Authorization matrix rows for needed items and pledges.
- Configuration: `src/backend/pyproject.toml` dependencies (APScheduler, onnxruntime, tokenizers); presence of mail or push settings in `.env.example` by key name only.
- Earlier research: `.maister/tasks/research/2026-10-13-handover-reminders-beyond-notifications/outputs/` for decisions on notification channels.
- Not in scope: search internals, inventory models, frontend.

**3. codebase-frontend**
- The mock: `features/search/WantedView.tsx`, `features/add/HuntingCreateView.tsx`, `utils/mocks.ts` (`MockWant`, `MOCK_WANTS`), `features/add/AddView.tsx` ("Szukam rzeczy" tile), `features/account/AccountView.tsx`, the empty-result prompt in `features/search/SearchView.tsx`, routes `/wanted` and `/add/hunting`, `routing/paths.ts`, reserved slugs. Record exactly which fields, copy and behaviours the mock promises.
- Needed-items UI: `hooks/useNeededItems.ts`, `components/shared/NeededItemQuickAddForm.tsx`, `utils/neededItemQuickAdd.ts`, `features/terms/blocks/TermNeededItems.tsx`, `features/terms/components/NeededItemsSection.tsx`, `features/terms/hooks/useNeededItemPledge.ts`, `api/pledges.ts`, `hooks/useMyPledges.ts`.
- Reusable pieces: category picker, locality picker and radius filter (`features/search/SearchFilters.tsx`, `lastLocality.ts`), `hooks/useNotifications.ts` and how notification kinds map to links, item page actions (`features/product/`).
- Any design material mentioning "szukam" in earlier task folders (grep `.maister/tasks` for `szukam`, `wanted`, `hunting`).
- Configuration: `src/frontend/package.json` only if a dependency is relevant.
- Not in scope: backend files.

**4. external-gift-platforms** — Freecycle, Trash Nothing, Olio, Buy Nothing, Bunz
- Per platform, the comparison template: wanted-post name and fields, ratio or rules between offers and wants, where wants appear, matching and alerts, how a giver answers, visibility (group, radius, public), expiry and renewal, posting limits, moderation rules, reported problems.
- Community rules that shape behaviour (for example limits on wanted posts per member, "offer before you ask" norms).
- Not in scope: classifieds platforms, generic matching technology.

**5. external-classifieds** — OLX (Poland first), Vinted, Facebook Marketplace and groups, Gumtree, Wallapop, Craigslist "wanted"
- Same template. For platforms without wanted posts, the substitute (saved search, favourite seller, group post with an "ISO" convention) and any stated reason.
- Polish wording and conventions for wanted adverts ("kupię", "przyjmę", "szukam", "zamienię").
- Not in scope: gift platforms, generic matching technology.

**6. external-matching-alerts**
- Reverse search (stored queries matched against new documents): the percolation model as a reference, and its PostgreSQL equivalents — stored `tsquery` matched with `@@` against a new row's `tsvector`, trigram similarity, category and radius pre-filters, indexing options for stored queries.
- Trigger timing: on new item, on new want, both; synchronous versus outbox-driven versus periodic batch.
- Polish text: stemming and dictionary options for PostgreSQL (ispell/hunspell dictionaries, unaccent-style folding, trigram tolerance), small embedding models and `pgvector` as an option with its cost. Keep to what fits "small models on the app server".
- Ranking and deduplication of matches; avoiding repeat alerts for the same pair.
- Alert delivery: immediate versus digest, per-user caps, quiet periods, unsubscribe and mute, evidence on notification fatigue.
- Not in scope: how individual platforms present wants (gatherers 4 and 5), UX of forms (gatherer 7).

**7. external-ux-trust**
- UX: wanted-post forms (free text versus structured), empty search results as an entry point, browsing wants as a giver, the "I have this" response flow, showing match counts, prompting renewal or closure, mobile patterns.
- Trust and safety: spam and begging patterns in wanted posts, limits and cool-downs, contact-info leakage, seeker anonymity, scams aimed at seekers, reporting and blocking, the effect of wanted posts on community norms in gift groups.
- Stale-content handling: expiry defaults, reminders, auto-close on fulfilment.
- Not in scope: platform-by-platform feature inventories, matching algorithms.

### Rationale
The backend splits cleanly into the supply side that wants are matched against (items, search, visibility) and the demand and signalling side (needed items, notifications, moderation). The frontend gets its own gatherer because a mock of the feature already exists there. Platforms are divided by type because gift communities and classifieds treat wanted posts differently and eleven platforms exceed one gatherer's budget. Matching technology and UX with trust and safety are topic-based and do not depend on any single platform.

### Rules for all gatherers
- Read only; write only under `analysis/findings/` in the task directory.
- Never print secret values: no `env`, `printenv`, `cat .env` or similar. Read `.env.example` files only; check presence by key name.
- Cite every claim: file path with line numbers, or URL with the date read. Mark confidence.
- Send no project names, user names or other private details to external services.

## Success Criteria

1. A comparison of at least six platforms' wanted mechanisms in the shared template, each with sources (gatherers 4 and 5).
2. A list of proven patterns and known failure modes — stale wants, spam, notification fatigue — each with at least one source (gatherers 4–7).
3. A map of existing code the mechanism would reuse or touch, with file references and a reuse verdict per component (gatherers 1–3).
4. A clear, evidence-based statement on the relation to needed items: extend, replace or keep separate (gatherers 2 and 3).
5. At least two options each for data model, matching and notifications, with trade-offs and confidence levels (synthesis from all gatherers).
6. The existing mock UI's promised behaviour documented and compared with the brief's scope (gatherer 3).
7. All nine sub-questions answered or explicitly marked unresolved.

## Expected Outputs

- `analysis/findings/[prefix]-*.md` — one or more files per gatherer.
- Research report with the platform comparison, pattern and failure-mode catalogue, codebase fit map and recommended options.
- A statement on needed items versus wanted posts.
- A list of product decisions left to the user (scope of visibility, fields, limits, channels).
