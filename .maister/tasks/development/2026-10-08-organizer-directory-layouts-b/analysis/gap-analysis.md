# Gap Analysis: B — Public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts

## Summary
- **Risk Level**: Medium. The work is additive behind a new anonymous endpoint, but it touches shared seams: route order, the authorization matrix, the A2 registry and renderer contract, and the editor props. It also carries a privacy and query-budget contract.
- **Estimated Effort**: High. About 14 backend and 20 frontend files across 4 bounded contexts. The A2 frontend contract has to be extended before any B block can be written.
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations (read-only aggregation), ui_heavy

## Task Characteristics
- Has reproducible defect: no. The route collision is a latent design hazard, not an existing bug, and clarification 3 already resolves it.
- Modifies existing code: yes. Affected: the matrix, `router/__init__.py`, `organizations/service.py`, the ACL and bridges, `PublicItemListingResponse`, `page_layouts.py`, `types.ts`, `registry.ts`, `LayoutRenderer.tsx`, `PublicOrganizationPage.tsx`, `LayoutTab.tsx` and `EditorSheet.tsx`.
- Creates new entities: yes. New endpoints, response schemas, use case, hooks, 6+3 blocks and 3 layouts. No new DB tables.
- Involves data operations: yes, read-only. It is a public projection of Groups, Terms, Attendance, ItemListingPreference, InventoryItem, Product and ProductPhoto.
- UI heavy: yes.

## Gaps Identified

### Missing Features (backend)
| # | Gap | Evidence |
|---|-----|----------|
| BE-1 | No way to resolve groups from an organization slug. `organizations/service.get_owner_party_id` does not exist, and the ACL lacks `get_organization_by_slug` and `get_owner_party_id`. | `organizations_acl.py` (31 l.) exposes only `get_organizer_theme`. `service.py` l.69 `get_organization_by_slug` returns None. `Organization.party_id` is the org's own party, not the owner's. |
| BE-2 | No `GET /api/groups/public/organizers/{slug}` and no `/terms`. | No `organizer` router in `groups/router/`. |
| BE-3 | No `OrganizerPageResponse`, `OrganizerTermResponse` or nested shapes. | `groups/schemas.py` has only per-circle and per-term public shapes. |
| BE-4 | No batched multi-group read queries. The following are missing: owner's PUBLIC circles via an active leadership join, next term per group (DISTINCT ON), upcoming term window, `.in_(term_ids)` needed items, eligible listers for many terms, and `family_count`. | `repository.py` has only per-group or per-term variants, except `count_active_attendances_by_term` (l.373) and `list_item_listing_preferences_for_parties` (l.472). |
| BE-5 | No `circulation_bridge.list_available_items_with_product(item_ids)` and no `product_bridge.first_approved_photo_by_product(product_ids)`. | Bridges are listed in `__all__` and have no such functions. |
| BE-6 | No PUBLIC matrix row for `/public/organizers/...`. | Today the path falls through to row 26 (l.125, READ). Reality check: `^/api/groups/public/[^/]+/access$` (l.93) would also match the slug `access`, which is another reason the explicit row must precede it. |
| BE-7 | No query-count test infrastructure. | No `before_cursor_execute` listener anywhere in `tests/`. |
| BE-8 | No `thumb_url` on `PublicItemListingResponse` (clarification 1). | `schemas.py` l.264. Public listing construction loops per item in `term_item_listings.py`, so the thumb lookup there must be one batched call. |
| BE-9 | `RESERVED_SLUGS` lacks `access` and `terms` (clarification 3). | `organizations/slugs.py` l.18. |

### Missing Features (frontend)
| # | Gap | Evidence |
|---|-----|----------|
| FE-1 | No `getOrganizerPage` / `getOrganizerTerms` and no `useOrganizerPage` / `useOrganizerTerms`. The infinite variant is the first `useInfiniteQuery` in the codebase. | `api/groups.ts`, `hooks/` |
| FE-2 | Blocks missing: `stats`, `agenda`, `next-term-cta`, `circles-grid` (`cards` / `featured`), `circle-visual:mini`, `exchange-counts`, `exchange-board`, `needed-items`, `upcoming-terms` (`list` / `compact`). That is 9 blocks, the task's 6 plus clarification 2. | `blocks/` holds only Hero, Share, LinkStack, Footer, Ghost and ShareButton. |
| FE-3 | No SCHEDULE, CIRCLES or EXCHANGE layouts, SVG thumbnails, or `PAGE_LAYOUT_KEYS` entries. | `registry.ts` has 2 entries. `page_layouts.py` is `frozenset({"CLASSIC","LINKS"})`. |

### Incomplete Features (A2 contract must grow)
| # | Currently | Needs |
|---|-----------|-------|
| IC-1 | `OrganizerPageData = {organization}` | `+ directory: OrganizerPageResponse \| null`, `directoryStatus: "loading" \| "ready" \| "unavailable"` |
| IC-2 | `BlockSlot = {block, variant?, primary?}` | `+ when?: {minCircles?, maxCircles?}`, and possibly `props?: {limit}` for `upcoming-terms:compact` (3) and `exchange-board` (≤12) |
| IC-3 | `BlockProps = {data, variant?}`; `BLOCKS: Record<BlockId, Component \| null>` | `mode` in props. A per-block `isEmpty(data)` (HLD `BlockDefinition`). Directory skeleton while loading. Visitor hide-on-empty. Primary-empty fallback (`empty-state:visitor` + `link-stack`). Owner ghosts per directory block. |
| IC-4 | `recommended?: true` static on LINKS | `recommendWhen?: (d) => boolean`. `LayoutTab` must receive `OrganizerPageData`, threaded through `EditorSheet` l.168. |
| IC-5 | `PublicOrganizationPage` passes `data={{organization}}` | Compose the directory in parallel (`useOrganizerPageData`) without gating first paint. A directory 404 or error means `unavailable`, and directory blocks disappear. |
| IC-6 | CLASSIC = hero / share / about(primary) / footer; LINKS link-stack = share only | HLD §6.3 CLASSIC = hero, stats, about, **upcoming-terms:list (primary)**, exchange-counts, gallery, footer. HLD LINKS link-stack computes "Najbliższe zajęcia", "Wszystkie terminy (N)" and "Wymiana rzeczy (N)" from the directory. Not named in task B (see decision I-1). |
| IC-7 | `GHOST_COPY` keyed for A2 blocks | Owner ghost copy and CTA for each new directory block |

### Behavioral Changes Needed
- The "Polecany" badge changes from static (LINKS always) to data-driven. 3 tests break intentionally: `LayoutRenderer.test.tsx` (keys and recommended), `OrganizerEditor.test.tsx:241`, and `PublicOrganizationPage.test.tsx` (now needs an `api/groups` mock).
- The public term page item card gains a thumbnail (clarification 1).
- The editor picker shows 5 cards instead of 2. The 2-column grid layout already handles this.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (visitor) | `/:slug` shows a card plus share only; circles and terms are reachable only via a direct term link | `/:slug` lists circles, agenda and exchange, with deep links to `/:slug/grupa/:gid/term/:tid` | Improves |
| Reachability (owner) | The picker has 2 layouts | 5 layouts in the same sheet | Improves |
| Discoverability of groups and terms | 2/10 (needs a shared link) | 8/10 (the primary slot of the chosen layout) | +6 |
| Discoverability of the right layout | 4/10 (static badge) | 7/10 (data-driven "Polecany") | +3 |
| Flow integration | — | The organizer page now feeds the term page, where RSVP and exchange actions happen. No new action surface on the organizer page. | Neutral to good |
| Personas | Visitor: anonymous, no empty ghosts. Logged-in visitor: same. Owner: ghosts and the editor. | The same three personas, now with directory skeleton, hidden and ghost states | Needs a per-block state table (decision I-2) |

## Data Lifecycle Analysis
The task is read-only projection. Create, update and delete happen elsewhere and are already complete, so this module checks that the read side does not orphan anything and does not leak data.

| Entity | Backend READ (new) | UI | Access | Write side exists? |
|--------|-------------------|----|--------|--------------------|
| Public circles of owner | BE-2 query | circles-grid / circle-visual | CIRCLES layout, primary slot | yes (circles.py) |
| Upcoming terms | `upcoming_terms` + `/terms` | agenda / upcoming-terms / next-term-cta | SCHEDULE and EXCHANGE | yes (terms.py) |
| Exchange items | `exchange.items`, `exchange.counts` | exchange-board / exchange-counts | EXCHANGE layout, linking to the term page | yes (listing preference and term page) |
| Needed items | `needed_items` | needed-items | EXCHANGE | yes (terms.py) |
| Stats | `stats` | stats | not in any HLD B layout (only CLASSIC per HLD) | n/a |

- **Completeness (scope)**: 100% for the 3 B layouts.
- **Orphaned operations**:
  - **`stats` block is orphaned in B.** HLD §6.3 puts `stats` only in CLASSIC. SCHEDULE, CIRCLES and EXCHANGE do not use it. If B builds `stats` without changing CLASSIC, the block renders nowhere (READ without a placement), and the same applies to the `stats` payload. See decision C-1.
  - `upcoming-terms:list` is used only by HLD CLASSIC, while `:compact` is used by EXCHANGE.
- **Missing touchpoints**: CLASSIC and LINKS directory integration (HLD §6.3) — see decision I-1. There is no invalidation of `organizerPage` after editor actions, which is fine: the directory does not depend on layout or palette (decision I-6).

## Privacy & Query-Budget Gaps (constraints the spec must pin)
- `list_organizer_role_ids_for_party` (repository l.147) does **not** filter `GroupRole.valid_to`. The leadership row is filtered (`valid_to IS NULL`). Whether a revoked organizer role should also hide groups is decision I-3.
- Time base: every `occurs_on` comparison in the app uses **server-local naive `datetime.now()`** (`term_item_listings.py` l.428 and l.899–901, `term_end_scan.py` l.65–67). The new SQL must pass `datetime.now()` as a bind parameter, not `func.now()` (DB session TZ/UTC) or `utcnow`. Getting this wrong shows past terms or hides imminent ones.
- Moderation of exchange items: the public listing does not filter at read time. Instead, setting a mode is refused while the product has unmoderated photos (`term_item_listings.py` l.137), and the withdraw cleanup handles stragglers. The directory must mirror the public-term eligibility rules exactly:
  - active attendees plus the current leader (`_list_eligible_lister_party_ids` l.351)
  - balance AVAILABLE
  - thumbnail only from APPROVED photos
- `family_count`: the HLD says "from PUBLIC group members, null < 3" without defining member. See decision I-4.
- Query budget: the HLD says "about 12 constant". The spec must fix the exact assertion (decision I-5).

## Issues Requiring Decisions

### Critical
1. **C-1 — `stats` and `upcoming-terms:list` have no placement in the B layouts.**
   - The task lists `stats` as a B block, but HLD §6.3 uses it (and `upcoming-terms:list`) only in CLASSIC.
   - Options:
     - (A) Also update CLASSIC to the HLD composition: hero, stats, about, upcoming-terms:list (primary), exchange-counts, footer. Gallery is deferred to D2.
     - (B) Place `stats` in one B layout instead, for example CIRCLES under hero.
     - (C) Build the blocks but leave them unplaced (dead code, which violates minimal-implementation.md).
   - Recommendation: **A**. It matches the HLD, gives CLASSIC users the directory immediately, and avoids orphaned blocks.
   - Caveat: CLASSIC's primary moves from `about` to `upcoming-terms`. Existing CLASSIC organizers with no terms then rely on the primary-empty fallback, and `LayoutRenderer.test.tsx` changes.

### Important
1. **I-1 — LINKS `link-stack` directory buttons.**
   - HLD: the "Najbliższe zajęcia · <date>", "Wszystkie terminy (N)" and "Wymiana rzeczy (N)" buttons are computed from the directory. A2 renders only Udostępnij.
   - Options:
     - (A) Add them in B.
     - (B) Defer to C, which adds `links`.
   - Default: **A**, so that once directory data exists, LINKS uses it, and the "no directory → LINKS" badge rule stays coherent.
   - Open sub-question: what "Wszystkie terminy" targets. Recommend an anchor to SCHEDULE content, or the first term, since `/:slug` has no terms subroute.
2. **I-2 — Empty, loading and unavailable behavior per block, in visitor and owner modes.**
   - Default: adopt the HLD §6.2 "Gdy pusto" column verbatim:
     - stats: fewer than 2 tiles → hidden
     - agenda: empty state "Brak zaplanowanych zajęć"
     - circles-grid: empty state
     - circle-visual: hidden at 0 attendees
     - exchange-counts: hidden at 0/0/0
     - exchange-board: empty state plus "Jak to działa?"
     - next-term-cta, needed-items and upcoming-terms: hidden
   - Owner mode shows ghosts with a CTA. A primary slot that is empty for a visitor shows `empty-state:visitor` plus `link-stack`.
   - Sub-decisions:
     - Is an `empty-state` block (visitor/owner) built in B? Recommend yes; it is required by primary-empty.
     - The owner ghost CTA target for directory blocks: "Dodaj termin" goes to `/panel`, or is copy only. Recommend a link to the existing panel route.
     - With `directoryStatus="unavailable"`, are directory blocks hidden for the owner as well? Recommend hidden for visitors and a neutral ghost for the owner.
3. **I-3 — Revoked organizer role.**
   - Should groups whose `GroupRole(ORGANIZATOR).valid_to` is set be excluded, even if the Leadership is still open?
   - Options: (A) Filter both `GroupRole.valid_to IS NULL` and `Leadership.valid_to IS NULL`. (B) Leadership only, matching today's helper.
   - Default: **A**, the stricter choice for an anonymous endpoint.
4. **I-4 — `family_count` definition.**
   - Options:
     - (A) Distinct Families reachable through an active `FamilyMembership` (any role) from parties with an active Membership in any of the owner's PUBLIC groups, excluding the owner's own family.
     - (B) Same as A, but sourced from active attendees of upcoming terms.
     - (C) Same as A, but including the owner's family.
   - Default: **A**. It is stable and follows the `exchange_summary._resolve_family_guardians` precedent. Null when below 3.
5. **I-5 — Query-count assertion.**
   - Options:
     - (A) Count(1 group) == Count(5 groups) **and** at most 12, for the main endpoint. `/terms` is asserted as constant for 1 vs 5 groups and 1 vs 25 terms.
     - (B) Equality only.
   - Default: **A**, with a reusable `count_queries` helper in `tests/conftest.py`.
   - Also: should the thumb_url addition to the public term page get its own count-stable test across 1 vs 5 items? Recommend yes.
6. **I-6 — Cache behavior.**
   - The directory is not affected by editor saves, so no invalidation of `organizerPage` or `organizerTerms` is needed.
   - Default: no invalidation, and keep the global `staleTime` default.
   - Option: a modest `staleTime` (for example 60s) for the anonymous page. Default: keep the global default.
7. **I-7 — "Polecany" tie-breaking and data source.**
   - Rules:
     - at least 2 circles → CIRCLES
     - at least 4 terms within 14 days → SCHEDULE
     - at least 4 items → EXCHANGE
     - no directory data → LINKS
   - Options:
     - (A) Allow multiple badges (every rule that holds).
     - (B) A single badge with precedence SCHEDULE > CIRCLES > EXCHANGE.
   - Default: **A**, which matches the HLD's per-layout `recommendWhen` with no tie-break.
   - Sub-defaults:
     - Count terms from `upcoming_terms` (≤10, 60-day window, filtered to 14 days).
     - Count items as the `exchange.counts` sum, not `items.length` (≤12).
     - "No directory" means `unavailable`, or ready with 0 circles.
     - While loading, show no badge at all.
     - CLASSIC is never recommended.
8. **I-8 — Agenda data source and filters.**
   - Options:
     - (A) Agenda reads only `/terms` through `useInfiniteQuery`, page size 20, filtered by `group_id` from chips shown when there are at least 2 circles.
     - (B) The first render comes from `upcoming_terms`, and `/terms` is used only for "Pokaż kolejne tygodnie".
   - Default: **A**. It has one source of truth and no duplicate merging. Chip state is local, and `group_id` is part of the query key.
9. **I-9 — Meaning of `circles[].upcoming_term_count` and `stats.upcoming_term_count`.**
   - Options: (A) future terms within the 60-day window, or (B) all future terms.
   - Default: **A**, consistent with `upcoming_terms` and a cheaper aggregate.
10. **I-10 — Delivery split (ADR-012).**
    - Options:
      - (A) Two commits within this task: B-backend (endpoints, ACL, matrix, thumb_url schema, tests), then B-frontend (blocks, layouts, `PAGE_LAYOUT_KEYS` plus registry in the same commit for parity).
      - (B) One commit.
    - Default: **A**.
    - Caveat: `PAGE_LAYOUT_KEYS` must land with the frontend registry, not with the backend, or the parity test fails.
    - Also: clarification 1 means the frontend term-page thumb change goes in the frontend commit.
11. **I-11 — Optional composite index `terms(circle_group_id, occurs_on)` (migration 0053).**
    - Default: skip. Add it only if `EXPLAIN ANALYZE` justifies it, per the HLD's "no speculation" rule.
12. **I-12 — Docs.**
    - `security.md` names `auth_deps.py` as the matrix location, but the matrix actually lives in `app/core/authorization_matrix.py`.
    - Default: fix it in this task and add the new row to the documented table.

## Integration Points
- `app/core/authorization_matrix.py`: new PUBLIC row in the public-groups block, before l.93 `/access` and before row 26 (l.125). Add cases to `test_authorization_matrix.py`.
- `app/groups/router/__init__.py`: include the new `router/organizer_page.py` **first**.
- `app/organizations/slugs.py`: add `access` and `terms` to `RESERVED_SLUGS`.
- `app/organizations/service.py`: new `get_owner_party_id` (OWNER role, `valid_to IS NULL`). Expose it through `groups/infrastructure/organizations_acl.py`, together with `get_organization_by_slug`.
- `groups/infrastructure/circulation_bridge.py`, `circulation/service.py` (`__all__`) and the circulation repository: add `list_available_items_with_product`.
- `groups/infrastructure/product_bridge.py` and `product/service.py`: add `first_approved_photo_by_product`. Use `storage.public_url(thumb_key)` with `get_storage()`, which returns None when storage is unconfigured, giving a null `thumb_url`.
- `groups/infrastructure/repository.py`: new batched queries. `groups/application/organizer_page.py` (new) and the `groups/service.py` facade.
- `groups/schemas.py`:
  - add `OrganizerPageResponse` and `OrganizerTermResponse`
  - add `thumb_url` to `PublicItemListingResponse`
  - update the public listing builder in `term_item_listings.py` to fetch thumbs in one batch
- `app/organizations/page_layouts.py`: extend the single `PAGE_LAYOUT_KEYS` literal, which `organizerKeyParity.test.ts` parses.
- Frontend: `api/groups.ts`; `hooks/useOrganizerPage.ts`, `useOrganizerTerms.ts` (infinite) and `useOrganizerPageData`; `layouts/types.ts`, `registry.ts` and `LayoutRenderer.tsx`; `PublicOrganizationPage.tsx`; `editor/EditorSheet.tsx` and `LayoutTab.tsx`; new `blocks/*`; `assets/layouts/{schedule,circles,exchange}.svg`; term-page listing card (thumbnail); and the file lists in `themeTokenUsage` / `themeDefects` tests.

## Recommendations
- Write the frontend contract extension (IC-1..IC-4) first as a small, separately tested step, then add the blocks.
- Build the response with an allowlist and test the exact JSON key sets. Never reuse the public term listing schemas, which carry names and party ids.
- Pass `datetime.now()` as a bind parameter in every new `occurs_on` filter. Put all limits (30/10/12, the 60-day window) in SQL.
- Make the directory endpoint return 200 with empty arrays for an organization that has an owner but no PUBLIC circles. Return 404 only for a missing org or owner, including `k-…` slugs.
- For `/terms`, a `group_id` outside the owner's PUBLIC groups returns an empty 200. Invalid UUIDs and paging produce a **400** (app convention), not 422.

## Risk Assessment
- **Complexity Risk**: Medium-High. There are 9 new blocks, 3 layouts, a renderer contract change and a batched read model with dedup by `item_id` (nearest term).
- **Integration Risk**: Medium. The touch points are route ordering, matrix ordering, and the editor and renderer props shared with A2. The parity test catches key drift.
- **Regression Risk**: Medium. The 3 intentional frontend test breakages are known. The public term page gains a batched thumb query. CLASSIC changes if C-1 option A is chosen. The privacy surface is new on an anonymous endpoint, which the key-allowlist tests mitigate.
