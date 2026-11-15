# Research Brief: "Szukam" (wanted) mechanism

## TL;DR
Research how to add wanted posts ("szukam") to the platform: a user states what they are looking for, the system matches it against listed items and notifies both sides.
The design should follow the best patterns from comparable gift, swap and second-hand platforms and fit the existing modules (search, inventory, needed items, notifications, visibility).
Research type: mixed (external best practices plus codebase analysis).

## Key Decisions
- Scope is wanted posts, not saved searches or search-engine improvements — chosen by the user at intake (2026-11-14).

## Open Questions / Risks
- The existing per-term "needed items" (plain names with pledges) overlap with wanted posts; the research must say whether to extend, replace or keep them separate.
- Matching free-text wants to items in Polish may need more than the current `fold_pl()` full-text and trigram search.

## Research question
How should the platform implement a "szukam" (wanted / in-search-of) mechanism — data model, matching, notifications, visibility, moderation and UX — based on the best patterns used by comparable platforms, and how does it fit the existing architecture?

Original request (Polish): "chcę wdrożyć w mój system mechanizm „szukam” — oprzeć to o najlepsze wzorce".

## Research type
Mixed: literature (industry patterns) and technical (codebase fit).

## Scope

### Included
- How comparable platforms model wanted posts: Vinted, OLX, Freecycle, Trash Nothing, Olio, Buy Nothing, Facebook Marketplace and groups, Gumtree, Wallapop, Bunz, Craigslist "wanted".
- Structure of a wanted post: free text versus category, condition, offer type (gift or swap), location and radius, expiry, photos.
- Matching wants to listed items: when it runs (on new item, on new want, both), ranking, deduplication, Polish-language text matching.
- Notifications to the seeker and to owners of matching items; frequency limits and digests.
- Visibility and privacy: who sees a want (public, logged-in, group members), seeker identity, relation to PRIVATE items and groups.
- Lifecycle: create, edit, fulfil, expire, renew, delete; link to reservations (take or propose).
- Moderation and abuse: text moderation, contact-info leaks, spam limits.
- UX patterns: where wants are created and browsed, "I have this" response flow, empty search results as an entry point.
- Fit with existing code: `app/search`, `app/inventory`, needed items in `app/groups`, notifications, visibility rules, locality and radius filter, categories.

### Excluded
- Saved searches and search alerts as a separate feature (only noted where they overlap).
- Improving search relevance or ranking of `/search` itself.
- Implementation, specification and task planning (a later development workflow).
- Paid promotion of wanted posts and monetisation.

### Constraints
- Stack: Python 3.12 + FastAPI + SQLAlchemy 2.0 async + PostgreSQL; Next.js 16 + React 19 frontend.
- Small models only on the app server; heavy AI in the separate microservice.
- Module boundaries: cross-context access through `infrastructure/*_acl.py`; read-only `app/search` and `app/pages`.
- Polish-language content; localities from the TERYT dictionary with coordinates.

## Success criteria
1. A comparison of at least six platforms' wanted mechanisms with sources.
2. A list of proven patterns and known failure modes (stale wants, spam, notification fatigue).
3. A map of the existing code the mechanism would touch or reuse, with file references.
4. A clear statement on the relation to existing needed items.
5. Recommended options for data model, matching and notifications, with trade-offs and confidence levels.
