# Specification: B — Public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts

## Goal
Give every organizer's public page (`/:slug`) real directory content: public circles, upcoming terms, exchange items and needed items. The data comes from a new anonymous, privacy-safe read model with a constant query count. The new data powers three new layouts (SCHEDULE, CIRCLES, EXCHANGE), an updated CLASSIC, LINKS directory buttons, a new `/:slug/terminy` agenda page, and data-driven "Polecany" badges in the A2 editor. The work builds on A2 (commit `c026f28`).

## Scope

**In scope**
- **Backend**
  - The `GET /api/groups/public/organizers/{slug}` and `GET /api/groups/public/organizers/{slug}/terms` endpoints.
  - ACL and bridge batch functions.
  - A PUBLIC row in the authorization matrix.
  - `RESERVED_SLUGS` additions.
  - `thumb_url` on the public term page's item listings.
  - Migration 0053 (index).
  - The query-count test infrastructure.
  - A fix to `security.md`.
- **Frontend**
  - API functions and hooks.
  - Extension of the A2 layout contract.
  - 9 directory blocks plus the empty-state, skeleton and ghost changes.
  - SCHEDULE, CIRCLES and EXCHANGE layouts, the CLASSIC update and LINKS directory buttons.
  - 3 SVG thumbnails.
  - `PAGE_LAYOUT_KEYS` parity.
  - The `/:slug/terminy` page.
  - Data-driven "Polecany" badges.
  - The term-page listing thumbnail.

**Out of scope**
- Any write, RSVP or reservation from the directory. B is read-only, and every action happens on the existing term page.
- A public circle page.
- `about` content, tagline, location and links (task C).
- Gallery and photo counts (D2).
- Paid or custom layouts (E).
- A paged exchange-items endpoint ("Pokaż wszystkie").
- Invalidating the `organizerPage`/`organizerTerms` cache after an editor save.
- The `gallery`, `testimonials` and `week-strip` variants.

## User Stories
- As an anonymous parent who opens a shared `/:slug` link, I want to see the organizer's groups, upcoming terms and items on offer, so that I can pick a term and act on its page.
- As a parent, I want a full list of all upcoming terms that I can filter by group (`/:slug/terminy`), so that I can plan ahead.
- As an organizer, I want to pick a layout that fits my activity (schedule, groups, exchange), with a "Polecany" hint based on my real data, so that my page highlights what matters.
- As an organizer viewing my own page, I want ghosts with panel links where data is missing, so that I know what to add. Visitors never see these ghosts.
- As a parent on a term page, I want a photo thumbnail next to each offered item, so that I can recognize items quickly.

## Core Requirements

1. **R1 — `GET /api/groups/public/organizers/{slug}`**
   - It is public and returns `OrganizerPageResponse` (contract in §API).
   - It never exposes person names, party ids, avatars or child data.
   - It returns 404 when the slug lookup finds no Organization or the Organization has no active owner. The 404 comes only from those lookups, never from a `k-` prefix check. Pseudo `k-…` slugs give 404 simply because they resolve to no Organization.
   - It returns 200 with empty arrays, zero counts and `family_count: null` when the owner has no qualifying PUBLIC circles.
   - It issues at most 12 SQL statements, and the count is the same for 1 and 5 circles.
2. **R2 — `GET /api/groups/public/organizers/{slug}/terms?page&size&group_id`**
   - It is public and returns `Page[OrganizerTermResponse]`.
   - It lists every future term of the owner's qualifying PUBLIC circles, with no 60-day window, ordered by `occurs_on ASC, id ASC`.
   - A `group_id` outside those circles gives a 200 with an empty page.
   - An invalid `page`, `size` or `group_id` gives a 400.
   - Unknown or ownerless slugs give a 404.
   - The query count is constant.
3. **R3 — Circle qualification (strict).** A circle is listed only if all of these hold:
   - `Group.visibility = PUBLIC`
   - there is a `Leadership` with `valid_to IS NULL`
   - that leadership's `from_role_id` is a `GroupRole` with `role_type = ORGANIZATOR`, `party_id = owner_party_id` and `GroupRole.valid_to IS NULL`
4. **R4 — Time base.** Every `occurs_on` comparison binds the server-local naive `datetime.now()` as a parameter. `func.now()` and `utcnow` are never used. "Upcoming" means `occurs_on >= now`. The window is `now <= occurs_on < now + 60 days`.
   - The existing term page picks its default term from `occurs_on >= today at midnight` (`public_view.py:228`), so a term earlier today counts as "next" there but not in the directory.
   - This is intentional and harmless, because every directory link carries an explicit `term_id`. The existing term-page behavior is not changed.
5. **R5 — Exchange eligibility.** It mirrors the public term listing rules exactly. For each circle's `next_term`:
   - Eligible listers are the active attendees (`TermAttendance.withdrawn_at IS NULL`) plus the circle's current leader, which is the owner.
   - The item must have an `ItemListingPreference` owned by an eligible lister.
   - The item must not be soft-deleted, and its balance must be `AVAILABLE`.
   - Items are deduplicated by `item_id`, keeping the earliest `occurs_on` (ties broken by `term_id`).
   - `counts` cover the full deduplicated set. `items` are capped at 12.
   - `thumb_url` comes only from an APPROVED photo with the lowest `sort_order`. It is `null` when there is no such photo or storage is unconfigured.
6. **R6 — `family_count`.** Count the distinct families with an active `FamilyMembership` (any role) whose member party has an active `Membership` (`valid_to IS NULL`) in any qualifying circle. Exclude every family the owner party belongs to. The value is `null` when the count is below 3.
7. **R7 — Matrix.** Add a PUBLIC row `GET ^/api/groups/public/organizers/[^/]+(/terms)?$` ahead of the `/public/[^/]+/access` row and row 26. Add matrix tests and update `security.md`.
8. **R8 — Routing safety.**
   - Include the new organizer router first in `groups/router/__init__.py`.
   - Add `access`, `terms` and `terminy` to `RESERVED_SLUGS`.
9. **R9 — ACL and bridges.**
   - `organizations_acl.get_organization_by_slug` and `organizations_acl.get_owner_party_id` (new `organizations.service.get_owner_party_id`).
   - `circulation_bridge.list_available_items_with_product(item_ids)` (term-page thumbnails).
   - `circulation_bridge.available_items_with_product_select()` — an unexecuted select the organizer exchange queries join (since 2026-10-10).
   - `product_bridge.first_approved_photo_by_product(product_ids)`.
10. **R10 — Term page `thumb_url`.**
    - `PublicItemListingResponse.thumb_url: str | None` is filled through one batched item→product lookup and one batched photo lookup, so no per-item queries are added.
    - It is wired into **both** public circle routes, including `/access`, which the term page actually calls.
    - The frontend renders a 48×48 thumbnail in `ListingRow`.
11. **R11 — Migration 0053.** Add `ix_terms_circle_group_id_occurs_on` on `terms(circle_group_id, occurs_on)`, with a reversible migration and the model kept in sync.
12. **R12 — Frontend data.**
    - `getOrganizerPage` and `getOrganizerTerms`.
    - `useOrganizerPage` (`useQuery`).
    - `useOrganizerTerms` (`useInfiniteQuery`, size 20, `group_id` in the key).
    - Directory loading never blocks first paint.
13. **R13 — Extend the A2 contract.**
    - Add `directory` and `directoryStatus` to `OrganizerPageData`.
    - Add `when` to `BlockSlot`.
    - Add `mode` to `BlockProps`.
    - Replace `recommended` with `recommendWhen`.
    - Add per-block `directory` and `isEmpty` metadata.
14. **R14 — Renderer rules.** In priority order: the `when` filter, the skeleton while loading, unavailable handling, the empty-or-ghost rule, the primary-empty fallback (see §Renderer).
15. **R15 — Blocks.**
    - New: `stats`, `upcoming-terms` (`list`/`compact`), `next-term-cta`, `agenda` (with circle chips), `circles-grid` (`cards`/`featured`, embedding the anonymous circle visual), `exchange-counts`, `exchange-board` (with mode tabs), `needed-items`.
    - Also: `EmptyStateBlock`, `BlockSkeleton`, and a modified `GhostBlock`, `HeroBlock` (`compact`) and `LinkStackBlock`.
16. **R16 — Layouts.** Add SCHEDULE, CIRCLES and EXCHANGE, update CLASSIC to the HLD composition, and add the LINKS directory buttons. Add SVG thumbnails. Add `PAGE_LAYOUT_KEYS` entries in the frontend commit.
17. **R17 — `/:slug/terminy`.** The full agenda, with circle chips, "Pokaż więcej", the organizer theme, a back link and the empty, loading and 404 states.
18. **R18 — Polecany.** Badges are data-driven and several can show at once:
    - SCHEDULE: at least 4 terms within 14 days
    - CIRCLES: at least 2 circles
    - EXCHANGE: at least 4 items
    - LINKS: directory unavailable or 0 circles
    - CLASSIC: never
    - no badge at all while the directory is loading
19. **R19 — Delivery.** Two commits: B-backend first, then B-frontend. `PAGE_LAYOUT_KEYS` ships with the frontend registry.

## Visual Design

The mockups in `analysis/design-context/` (`INDEX.md` + `ascii/ui-mockups.md`) are **binding inputs**. The implementation-planner attaches `Visual References` (by the IDs below) to the UI task groups. Fidelity is **structural/approximate**: ASCII layout, Polish copy, role tokens and spacing classes. They are not pixel-perfect. The visual language follows the A2 page:
- cream canvas and a `max-w-[430px]` column
- serif section headings in `px-6 pt-6`
- `rounded-2xl border-line bg-paper` cards
- `TermPreviewCard` date tiles and CTAs
- `ProductPreviewCard` exchange cards

| ID | Covered by |
|----|-----------|
| screen:layout-classic | CLASSIC composition (§Layouts) |
| screen:layout-schedule | SCHEDULE + HeroBlock `compact` |
| screen:layout-circles | CIRCLES with `when` (`cards` vs `featured`) |
| screen:layout-exchange | EXCHANGE (board with mode tabs) |
| screen:layout-links | LinkStackBlock directory buttons |
| screen:owner-edit-empty | Renderer rules, EmptyStateBlock, GhostBlock CTA/neutral, BlockSkeleton |
| screen:organizer-terms | OrganizerTermsPage |
| screen:editor-layout-tab | LayoutTab: 5 cards, data-driven badges |
| screen:term-page-listing-thumb | ListingRow thumbnail |
| component:block-library, component:stats, component:upcoming-terms, component:next-term-cta, component:agenda, component:circle-filter-chips, component:circles-grid, component:circle-visual-mini, component:exchange-counts, component:exchange-board, component:exchange-item-card, component:needed-items, component:empty-state-visitor, component:ghost-directory, component:block-skeleton, component:link-stack-directory, component:hero-compact, component:layout-card-badge, component:listing-thumb | §Blocks, one subsection per component |

Two deliberate composition simplifications keep the same visual result, as the mockup note on `circle-visual` allows:
- **Mode tabs belong to `exchange-board`.** In EXCHANGE they are rendered by `exchange-board:grid2`, not by a separate `exchange-counts:tabs` slot. Two sibling blocks would otherwise need shared filter state. **The user accepted this on 2026-10-09 (audit L-6).** The `tabs` variant of `component:exchange-counts` is delivered as the tab strip inside `exchange-board`.
- **The circle visual is part of `circles-grid:featured`.** It is rendered inside that card by a non-block component, `CircleVisualMini`. CIRCLES has no separate `circle-visual` slot.

There are also two token and copy decisions:
- **CIRCLES uses `hero:cover`.** It already renders the primary color band, so no alias `color` variant is added.
- **SWAP is labelled "Zamienię"** everywhere, per the mockups. This overrides the HLD's "Wymienię".

## API Contracts

All datetimes are naive ISO strings (for example `"2026-10-12T16:30:00"`), which is the existing convention. Every response is built from an explicit Pydantic model with an allowlist of fields.

### `GET /api/groups/public/organizers/{slug}` → 200 `OrganizerPageResponse`

| Field | Type | Rule |
|---|---|---|
| `circles[]` | `OrganizerCircleResponse` | At most 30 qualifying circles. Sorted by `next_term.occurs_on ASC NULLS LAST`, then `name ASC`, then `id`. |
| `circles[].id` | uuid | |
| `circles[].name` | str | |
| `circles[].layout_mode` | `CIRCLE` / `PITCH` / `TABLE` | `GroupLayoutMode` |
| `circles[].next_term` | `{id: uuid, occurs_on: datetime, attendee_count: int}` or null | The earliest term with `occurs_on >= now` (no window). `attendee_count` counts active attendances (0 if none). |
| `circles[].upcoming_term_count` | int | Terms in the 60-day window |
| `upcoming_terms[]` | `OrganizerTermResponse` | At most 10, within the 60-day window, ordered by `occurs_on ASC, id` |
| `exchange.counts` | `{GIFT: int, SWAP: int, LEND: int}` | Over the full deduplicated eligible set (R5). Each key is always present. |
| `exchange.items[]` | `OrganizerExchangeItemResponse` | At most 12, ordered by `occurs_on ASC`, then `product_name ASC`, then `item_id` |
| `exchange.items[].item_id` | uuid | |
| `exchange.items[].product_name` | str | |
| `exchange.items[].condition` | str | An `ItemCondition` value |
| `exchange.items[].mode` | `GIFT` / `SWAP` / `LEND` | `ItemListingPreference.mode` |
| `exchange.items[].thumb_url` | str or null | |
| `exchange.items[].term_id` | uuid | The nearest eligible term |
| `exchange.items[].group_id` | uuid | |
| `exchange.items[].occurs_on` | datetime | |
| `needed_items[]` | `OrganizerNeededItemResponse` | For every circle's `next_term`. Excludes deleted needed items. Ordered by `occurs_on ASC`, then `product_name ASC`, then `id`. At most 12 (`NEEDED_ITEMS_LIMIT`, SQL `LIMIT`). |
| `needed_items[].id` | uuid | The needed item id |
| `needed_items[].term_id` | uuid | |
| `needed_items[].group_id` | uuid | |
| `needed_items[].product_name` | str | |
| `needed_items[].claimed` | bool | True when there is a pledge with status not `WITHDRAWN`, the same rule as `list_needed_item_views` |
| `stats.circle_count` | int | `len(circles)` |
| `stats.upcoming_term_count` | int | Sum of `circles[].upcoming_term_count` |
| `stats.family_count` | int or null | R6. Null when below 3. |

`OrganizerTermResponse` has these fields: `term_id`, `group_id`, `group_name`, `occurs_on`, `description` (str or null), `attendee_count`.

**Forbidden keys anywhere in the payload** (asserted by a test):
- `display_name`
- `lister_party_id`
- `lister_display_name`
- `party_id`
- `claimed_by_name`
- `claimed_by_party_id`
- `guardians`
- `organizer_display_name`
- any child field

**Errors**
- 404 (`EntityNotFoundException` envelope) when the slug resolves to no Organization or the Organization has no active owner.

### `GET /api/groups/public/organizers/{slug}/terms?page=1&size=20&group_id=<uuid>` → 200 `Page[OrganizerTermResponse]`

- The response shape is `{items, total, page, size}` (`app/core/pagination.py`). Pages start at 1, `size` defaults to 20, and the maximum is 100.
- It contains all terms with `occurs_on >= now` of the qualifying circles, with no window, ordered by `occurs_on ASC, id ASC`.
- `group_id`, when given, narrows the result to that circle. A circle that does not qualify gives `{items: [], total: 0, …}`.
- Errors:
  - 400 (app convention via `RequestValidationError`, not 422) for `page < 1`, `size > 100`, or a non-UUID `group_id`
  - 404 as above

### `PublicItemListingResponse` (existing, `GET /api/groups/public/{group_id}`)

The change is additive: `thumb_url: str | None`. Every other field is unchanged.

## Backend Design

### Files
| File | Change |
|---|---|
| `app/groups/router/organizer_page.py` | **New.** 2 routes, no auth dependency, each with a docstring naming its matrix row. `DbSession` plus a `Storage` dependency (`Annotated[ObjectStorage \| None, Depends(get_storage)]`, the same alias pattern as `app/product/router.py:42`). `/terms` uses `Pagination` and `group_id: uuid.UUID \| None = None`. |
| `app/groups/router/__init__.py` | Import `organizer_page` and include it **first**, with a comment on the `/public/{group_id}/access` collision |
| `app/groups/router/circles.py` | **Both** `get_public_circle` (`GET /api/groups/public/{group_id}`) **and** `get_group_access` (`GET /api/groups/public/{group_id}/access`, l.132) gain the `storage: Storage` dependency and pass it to the service. `/access` is what the frontend term page actually calls (`TermPage` → `useTermAccess` → `getGroupAccess`). |
| `app/groups/application/organizer_page.py` | **New.** `get_organizer_page(db, slug, storage)` and `list_organizer_terms(db, slug, params, group_id)`. A private `_resolve_owner(db, slug)` raises `EntityNotFoundException` when the slug lookup or the owner lookup returns `None`. There is **no** `slug.startswith("k-")` check (a real organization may have a `k-…` slug, such as `k-pop-dzieci`). A pseudo-slug gives 404 only because it does not resolve to an Organization. Assembly and dedup happen in Python over batched rows. |
| `app/groups/application/public_view.py` | `get_public_circle_view(..., storage: ObjectStorage \| None = None)`. After `list_public_term_item_listings`, one batched thumb resolution builds `thumb_url` per listing. `get_group_access(db, group_id, term_id, principal, storage: ObjectStorage \| None = None)` passes `storage=storage` into its `get_public_circle_view` call (l.334). The OG-preview callers in `system/router.py` (l.89, l.104) stay storage-less. |
| `app/groups/service.py` | Re-export `get_organizer_page` and `list_organizer_terms` |
| `app/groups/schemas.py` | **New:** `OrganizerNextTermResponse`, `OrganizerCircleResponse`, `OrganizerTermResponse`, `OrganizerExchangeCounts`, `OrganizerExchangeItemResponse`, `OrganizerExchangeResponse`, `OrganizerNeededItemResponse`, `OrganizerStatsResponse`, `OrganizerPageResponse`. **Modified:** `PublicItemListingResponse.thumb_url`. |
| `app/groups/infrastructure/repository.py` | New batched queries (see the query plan) |
| `app/groups/infrastructure/organizations_acl.py` | Add `get_organization_by_slug` and `get_owner_party_id` pass-throughs to `__all__`, and update the docstring |
| `app/organizations/service.py` | **New** `get_owner_party_id(db, organization_id) -> uuid.UUID \| None`. It selects `OrganizationRole.party_id` joined to `OrganizationMembership` on `from_role_id`, with `to_organization_id = id`, `role_type = OWNER` and `OrganizationMembership.valid_to IS NULL`. It is the reverse of `get_own_organization`. |
| `app/groups/infrastructure/circulation_bridge.py` + `app/circulation/service.py` (`__all__`/re-export) + `app/circulation/application/inventory_items.py` + `app/circulation/infrastructure/repository.py` | **New** `list_available_items_with_product(db, item_ids) -> dict[item_id, AvailableItemView]`, where `AvailableItemView` is a small NamedTuple or dataclass with `item_id`, `product_id`, `product_name` and `condition`. It is one join of `InventoryItem` to `InventoryBalance` (status AVAILABLE) and `Product`, with `deleted_at IS NULL` and `item_id IN (…)`. It returns early on empty input. Since 2026-10-10 it is built on the new unexecuted `available_items_with_product_select()`, which the organizer exchange queries join in SQL. |
| `app/groups/infrastructure/product_bridge.py` + `app/product/service.py` | **New** `first_approved_photo_by_product(db, product_ids) -> dict[product_id, ProductPhoto]`. It uses `DISTINCT ON (product_id)` with `status = APPROVED`, ordered by `product_id, sort_order, id`, and returns early on empty input. The thumb URL is `storage.public_url(photo.thumb_key)`, computed in the application layer. Presigned URLs are never used. |
| `app/core/authorization_matrix.py` | New PUBLIC row with an explanatory comment, inserted immediately **before** the existing `^/api/groups/public/[^/]+$` row (l.86) |
| `app/organizations/slugs.py` | Add `"access"`, `"terms"` and `"terminy"` to `RESERVED_SLUGS`, with comments: the backend sub-paths under `/public/organizers/{slug}` and the frontend second-segment route `/:slug/terminy` |
| `app/groups/models.py` | Add `Index("ix_terms_circle_group_id_occurs_on", "circle_group_id", "occurs_on")` to `Term`, so autogenerate stays in sync |
| `alembic/versions/0053_terms_circle_occurs_on_index.py` | **New.** `revision = "0053"`, `down_revision = "0052"`. `upgrade` runs `DROP INDEX CONCURRENTLY IF EXISTS` then `create_index(..., postgresql_concurrently=True)`, and `downgrade` runs `DROP INDEX CONCURRENTLY IF EXISTS`, both inside `autocommit_block()`; `alembic/env.py` uses `transaction_per_migration=True`. The docstring gives the rationale: the upcoming-term queries filter on `circle_group_id IN (…)` and `occurs_on >= now`. The existing `ix_terms_circle_group_id` stays. |
| `.maister/docs/standards/backend/security.md` | Reword the location: "The matrix lives only in `app/core/authorization_matrix.py`. It is a reference table verified by tests (`resolve_requirement` is used only in `tests/test_authorization_matrix.py`). Each route enforces its row through `Depends(require_any(...))`, or through no dependency for PUBLIC rows." `auth_deps.py` does **not** re-export the matrix. Drop the stale "25 entries" claim. Document the new PUBLIC row and why it is placed where it is. |
| `app/organizations/page_layouts.py` | Change `frozenset({"CLASSIC", "CIRCLES", "EXCHANGE", "LINKS", "SCHEDULE"})`. It stays a single literal with double quotes. **Ships in the frontend commit.** |

### Query plan — main endpoint (at most 10 statements since the 2026-10-10 verification fixes; budget 12)
Here "Q" means circles that qualify under R3. `now` is bound as a parameter.

1. **Organization by slug**: `organizations_acl.get_organization_by_slug`. If none, return 404.
2. **Owner party**: `organizations_acl.get_owner_party_id`. If none, return 404.
3. **Circles with next term and count** (new repository `list_owner_public_circles(db, owner_party_id, now, window_end, limit=30)`).
   - Select `Group.id`, `name` and `layout_mode`.
   - Inner join `Leadership` (`to_group_id`, `valid_to IS NULL`).
   - Inner join `GroupRole` (`id = from_role_id`, ORGANIZATOR, `party_id = owner`, `valid_to IS NULL`), and filter on `visibility = PUBLIC`.
   - `LEFT JOIN LATERAL (SELECT id, occurs_on FROM terms WHERE circle_group_id = groups.id AND occurs_on >= :now ORDER BY occurs_on, id LIMIT 1) AS next_term ON true` (SQLAlchemy: `.lateral()` with `outerjoin(..., true())`). This gives the next term's `id` and `occurs_on`.
     - It is scoped per circle and driven by the `ix_terms_circle_group_id_occurs_on` index, so its cost grows with the organizer rather than the platform.
     - An unscoped `DISTINCT ON` derived table over all terms is **forbidden**.
   - Add a correlated scalar subquery counting terms in `[now, window_end)`. It is filtered by `circle_group_id = groups.id` and uses the same index.
   - Order by `next_occurs_on NULLS LAST`, `name`, `id`, with `LIMIT 30`.
   - If this returns no rows, skip statements 4–10 and return the empty response.
4. **Upcoming terms** (`list_upcoming_terms_for_groups(db, group_ids, now, window_end, limit=10)`): `Term` join `Group` (for `group_name`), filtered on `circle_group_id IN Q` and the window, ordered by `occurs_on, id`, `LIMIT 10`.
5. **Attendance counts**: reuse `count_active_attendances_by_term` over the union of the next-term ids and the upcoming-term ids.
6. **Family count** (`count_member_families_for_groups(db, group_ids, exclude_party_id)`): one `COUNT(DISTINCT FamilyMembership.to_family_id)`.
   - Path: `Membership` (`to_group_id IN Q`, `valid_to IS NULL`) → `GroupRole` (`from_role_id`) `.party_id` → `FamilyRole` (`party_id`, `valid_to IS NULL`) → `FamilyMembership` (`from_role_id`, `valid_to IS NULL`).
   - Filter: `to_family_id NOT IN` (the families of the owner party through the same `FamilyRole`/`FamilyMembership` path, as a subquery).
   - `families.models` is imported in the repository, following the `exchange_summary.py` precedent.
7. **Needed items** (`list_needed_items_with_product_for_terms(db, term_ids, limit=12)`, the `.in_()` sibling of the l.278 function): `NeededItem` join `Product`, plus a `claimed` EXISTS subquery over `Pledge` with status not `WITHDRAWN`, filtered on `deleted_at IS NULL`, `LIMIT 12`. Skip it when there are no next terms.
8. **Exchange counts** (`count_exchange_items_by_mode`): `GROUP BY mode` over the shared exchange-candidate subquery. Skip 9–10 when it returns nothing.
9. **Exchange items** (`list_nearest_exchange_items`, `LIMIT 12`): the same subquery ordered by `occurs_on`, `product_name COLLATE "C"` (code-point order, as the former Python sort), `item_id`.
10. **Photos**: `product_bridge.first_approved_photo_by_product(product ids of the top 12)`. Skip it when `storage is None`.

The exchange-candidate subquery (`_exchange_candidates`, built twice, run inside 8 and 9) does the former Python assembly in SQL:
- lister terms = `(owner, t)` for every next term `t` UNION ALL `(attendee, t)` for each non-withdrawn RSVP on a next term (the term page's eligibility rule)
- `DISTINCT ON (party_id) … ORDER BY party_id, occurs_on, term_id` keeps each lister's nearest term
- joined to `ItemListingPreference` (one row per item, so no further deduplication) and to `circulation_bridge.available_items_with_product_select()`, an unexecuted circulation-owned select of live AVAILABLE items with product name and condition. Circulation tables are only referenced through that select, so the groups module still never imports circulation models.

No item-id or party-id IN-list is shipped from Python, and only the top 12 rows are loaded.

None of the per-item helpers in `term_item_listings.py` are used.

### Query plan — `/terms` (at most 5 statements, constant)
1. Organization (404 if missing).
2. Owner party (404 if missing).
3. `COUNT(*)` of `Term` joined with the qualifying-circle join from statement 3 (no circle limit), plus `occurs_on >= now`, plus an optional `Group.id = group_id`.
4. A page of rows: the same filter, with `Group.name`, ordered by `occurs_on, id`, `OFFSET`/`LIMIT`.
5. `count_active_attendances_by_term` over the page's term ids. Skip it when the page is empty.

Statements 3 and 4 share a single repository helper that builds the filtered select (`_owner_public_terms_select`) and is used for both the count and the page.

### Term page `thumb_url` (2 statements, independent of item count)
This applies to both `GET /api/groups/public/{id}` and **`GET /api/groups/public/{id}/access`**, the route the frontend term page uses. Both reach `get_public_circle_view` with the injected storage.

In `get_public_circle_view`, after `item_listings`, when `storage` is set and there are listings:
1. `circulation_bridge.list_available_items_with_product(item_ids)`, which gives `item_id → product_id`.
2. `product_bridge.first_approved_photo_by_product(product_ids)`.

The result is `thumb_url = storage.public_url(photo.thumb_key)` or `None`.

### Privacy rules (enforced by the schemas and tests)
- Only qualifying PUBLIC circles appear. PRIVATE circles, circles under a revoked role or leadership, and other organizers' circles never appear in any field, including counts, terms, items and needed items.
- No identity fields at all. Lister identity is used only server-side for eligibility.
- `family_count` is suppressed below 3.
- Thumbnails come from APPROVED photos only, through public CDN URLs.

## Frontend Design

### API and types (`src/frontend/src/api/groups.ts`)
- Add the interfaces `OrganizerNextTerm`, `OrganizerCircle`, `OrganizerTerm`, `ExchangeMode = "GIFT" | "SWAP" | "LEND"`, `OrganizerExchangeItem`, `OrganizerNeededItem`, `OrganizerStats` and `OrganizerPageResponse`. They mirror the backend field names exactly (snake_case).
- `getOrganizerPage(slug)` calls `GET /api/groups/public/organizers/${encodeURIComponent(slug)}`.
- `getOrganizerTerms(slug, page, groupId?)` uses `pageParams(page)` and adds `group_id` when it is given. It returns `Page<OrganizerTerm>`.
- Add `thumb_url: string | null` to `PublicItemListingResponse`.

### Hooks
- **`hooks/useOrganizerPage.ts`**: `ORGANIZER_PAGE_KEY = "organizerPage"`, key `[ORGANIZER_PAGE_KEY, slug]`. The return shape copies `usePublicOrganization`: `{data, loading, notFound, error, refetch}`.
- **`hooks/useOrganizerTerms.ts`**: `ORGANIZER_TERMS_KEY = "organizerTerms"`. This is the first `useInfiniteQuery` in the codebase.
  - Key: `[ORGANIZER_TERMS_KEY, slug, groupId ?? null]`.
  - `initialPageParam: 1`.
  - `getNextPageParam: (last) => last.page * last.size < last.total ? last.page + 1 : undefined`.
  - Return value: `{terms (flattened, stable empty fallback), total (from the first page, or 0), loading, notFound, error, hasNextPage, fetchNextPage, fetchingNextPage, nextPageError}`.
  - Optional `enabled` flag, defaulting to true.
- Neither hook invalidates anything after an editor save (I-6).

### Contract changes (`pages/organizer/layouts/types.ts`)
- `BlockId` becomes `"hero" | "share" | "about" | "link-stack" | "footer" | "stats" | "upcoming-terms" | "next-term-cta" | "agenda" | "circles-grid" | "exchange-counts" | "exchange-board" | "needed-items"`.
- `BlockSlot` gets `when?: { minCircles?: number; maxCircles?: number }`.
- `OrganizerPageData` becomes `{ organization; directory: OrganizerPageResponse | null; directoryStatus: "loading" | "ready" | "unavailable" }`.
- `BlockProps` becomes `{ data; variant?: string; mode: RenderMode }`.
- `PageLayoutDefinition` drops `recommended` and gains `recommendWhen?: (data: OrganizerPageData) => boolean`.
- A new `BlockDefinition` is defined in `LayoutRenderer.tsx` next to `BLOCKS`: `{ Component: ComponentType<BlockProps> | null; directory?: true; isEmpty?: (data: OrganizerPageData) => boolean }`.
  - `isEmpty` is evaluated only when `directoryStatus === "ready"`.
  - `about` stays `{Component: null}`, so it remains a ghost or hidden.

### Renderer rules (`LayoutRenderer.tsx`), per slot and in order
1. **`when`.** If `slot.when` does not match, skip the slot.
   - The circle count is `directory?.circles.length`.
   - While loading or unavailable, a slot with `when` counts as matching only when it is the first slot with that block id. This renders one skeleton or ghost, not both variants.
2. **Directory block while loading.** Render `BlockSkeleton` (shape hint by block id).
3. **Directory block while unavailable.**
   - Visitor: skip the slot. If it is the primary slot, render `EmptyStateBlock` with the generic copy.
   - Owner: render `GhostBlock` with `unavailable`.
4. **`isEmpty(data)` is true.**
   - Visitor: skip the slot. If it is the primary slot, render `EmptyStateBlock` with the layout's copy.
   - Owner: render `GhostBlock` with its CTA.
5. Otherwise render `<Component data variant mode/>`.

The owner never sees `EmptyStateBlock`, and visitors never see ghosts. `PublicOrganizationPage` adds `useOrganizerPage(slug)` and computes `directoryStatus` from it:
- `loading` while the query is pending
- `unavailable` on any error, including a 404
- `ready` otherwise

The organization payload alone still gates first paint.

### Blocks (`pages/organizer/blocks/`, tokens only, Polish copy)

Every link to a term uses `/${slug}/grupa/${group_id}/term/${term_id}`. Dates use `dayjs` from `utils/dayjs.ts`, and counts use `pluralPl`.

| Block (ID) | Data | Variants and render | isEmpty (visitor hides) | Owner ghost |
|---|---|---|---|---|
| **stats** (component:stats), `StatsBlock.tsx` | `stats` | `tiles3`. Tiles: `circle_count` if > 0 ("grupa/grupy/grup"), `upcoming_term_count` if > 0 ("termin/terminy/terminów w 60 dni"), `family_count` if not null ("rodzina/rodziny/rodzin"). | fewer than 2 tiles | see §Owner ghost copy |
| **upcoming-terms** (component:upcoming-terms), `UpcomingTermsBlock.tsx` | `upcoming_terms`, `stats`, `nearestTerm` (fallback) | `list`: heading "Najbliższe terminy"; rows with a date tile, group name and "dd · HH:mm · zapisanych: N" (the count part is omitted at 0); the footer link "Wszystkie terminy (N) →" to `/${slug}/terminy` appears when `stats.upcoming_term_count > upcoming_terms.length`. If `upcoming_terms` is empty, render one row from `nearestTerm` plus the link "Wszystkie terminy →" without a count (L-1). `compact`: heading "Najbliższe spotkania"; the first 3 terms as chips "dd D MMM ›", or one `nearestTerm` chip when the window is empty. | `nearestTerm(directory)` is null | see §Owner ghost copy |
| **next-term-cta** (component:next-term-cta), `NextTermCtaBlock.tsx` | `nearestTerm(directory)` | `card`: "NAJBLIŻSZE ZAJĘCIA", date tile, group name, "dddd, D MMMM · HH:mm", "zapisanych: N", CTA "Zobacz i zapisz się →" | `nearestTerm(directory)` is null | see §Owner ghost copy |
| **agenda** (component:agenda, component:circle-filter-chips), `AgendaBlock.tsx` + shared `AgendaList.tsx` + `CircleFilterChips.tsx` | `useOrganizerTerms(slug, groupId)` + `circles` | `by-day`: heading "Plan zajęć". Chips appear only when there are at least 2 circles: "Wszystkie" plus each circle name, as a `radiogroup` with roving tabindex via `nextIndex`. Chip state is local, and the selected `groupId` enters the query key. The list groups terms by `YYYY-MM-DD` under `<h3>` headers "dddd, D MMMM" (uppercase). Each row is one link: time, group name, "zapisanych N" and a one-line description. "Pokaż kolejne terminy" calls `fetchNextPage` and is hidden without a next page. While the first page loads, render `BlockSkeleton`. A first-page error (any non-404) shows the inline text "Nie udało się wczytać terminów." with a "Spróbuj ponownie" button that calls `refetch`; the rest of the page is unaffected. A next-page error shows "Nie udało się wczytać kolejnych terminów." with "Spróbuj ponownie". A filtered empty result shows "Brak zaplanowanych zajęć" with a "Pokaż wszystkie grupy" reset. | every `circles[].next_term` is null | see §Owner ghost copy |
| **circles-grid** (component:circles-grid, component:circle-visual-mini), `CirclesGridBlock.tsx` + `CircleVisualMini.tsx` | `circles` | `cards`: "Nasze grupy"; per circle, the name, "zapisanych: N · K terminy" and "nast.: dd D MMM, HH:mm". The card links to the next term's page, or to `/${slug}/terminy?group_id=${id}` with "brak zaplanowanych terminów". `featured` (exactly 1 circle): "Nasza grupa"; the card holds `CircleVisualMini`, the name, the next term, the counts and the CTA "Zobacz zajęcia →" (same target rule). `CircleVisualMini` is anonymous: `min(attendee_count, 16)` seats placed with `getCirclePosition` / `getPitchPosition` / `getTablePosition` by `layout_mode`, a "+N" chip beyond 16, and a center marker. It uses `role="img"` and `aria-label` built with `pluralPl` ("Zapisana 1 rodzina" / "Zapisane 2 rodziny" / "Zapisanych 5 rodzin"), with seats `aria-hidden`. It is not rendered when the next term's `attendee_count` is 0. | `circles` empty | see §Owner ghost copy |
| **exchange-counts** (component:exchange-counts), `ExchangeCountsBlock.tsx` | `exchange.counts`, `exchange.items` | `tiles3`: "Wymiana rzeczy" with 3 tiles (Oddam / Zamienię / Wypożyczę) in tones `bg-primary-soft` / `bg-accent-soft` / `bg-teal-soft`. A tile with count > 0 links to the term page of the first item with that mode; otherwise it is plain. | GIFT + SWAP + LEND = 0 | see §Owner ghost copy |
| **exchange-board** (component:exchange-board, component:exchange-item-card), `ExchangeBoardBlock.tsx` + `ExchangeItemCard.tsx` | `exchange` | `grid2`: mode tabs ("Wszystko N", "Oddam N", "Zamienię N", "Wypożyczę N") as a `role="tablist"` with `aria-controls` on the board. A tab with 0 is disabled. The selected tab is `bg-ink text-on-ink`. Tabs filter `items` on the client. The board is a 2-column grid of `ExchangeItemCard`s, each one link to the item's term page: `SafeImage` on a square `rounded-xl` tile (`PhotoPlaceholder` when `thumb_url` is null), name (`line-clamp-2`), mode pill plus `CONDITION_LABELS`, and "odbiór: dd D MMM". There is no lister. | `items` empty | see §Owner ghost copy |
| **needed-items** (component:needed-items), `NeededItemsBlock.tsx` | `needed_items` | `list`: "Potrzebne na najbliższe zajęcia"; rows show `BringsIcon`, the product name and "dd D MMM". An open item gets a "Zobacz →" link to the term page. A claimed item gets a check mark and the "Zapewnione" pill (`bg-primary-soft`), and no name. | `needed_items` empty | see §Owner ghost copy |
| **link-stack** (component:link-stack-directory), `LinkStackBlock.tsx` [MOD] | directory | `buttons`, in order:<br>1. "Najbliższe zajęcia · dd D.MM HH:mm" from `nearestTerm(directory)` when it is not null (so it works even beyond the 60-day window), filled `bg-primary`.<br>2. "Wszystkie terminy (N)" when `stats.upcoming_term_count > 0`, linking to `/${slug}/terminy`.<br>3. "Wymiana rzeczy (N)" when the sum of counts is > 0, linking to the term of `exchange.items[0]`, else the nearest term.<br>4. "Udostępnij stronę" (`ShareButton`), filled only when it is the only button.<br>While loading, show 2 skeleton bars above Share. When unavailable, show Share only. | never | — (not a directory block for the renderer: it handles loading itself) |
| **hero** (component:hero-compact), `HeroBlock.tsx` [MOD] | organization | New `compact`: a `bg-paper border-b border-line` bar with a 56px initials avatar, the name, the address and an inline `ShareButton` (`min-h-[44px]`) | never | — |

**`nearestTerm(directory)`** (L-1 fallback, in `pages/organizer/blocks/nearestTerm.ts`):
- Returns `upcoming_terms[0]` when the 60-day window is not empty.
- Otherwise it takes the circle whose `next_term` has the earliest `occurs_on` (ties broken by circle `id`) and maps it to an `OrganizerTerm`-shaped value: `term_id = next_term.id`, `group_id = circle.id`, `group_name = circle.name`, `occurs_on`, `description = null`, `attendee_count`.
- Returns `null` when no circle has a `next_term`.
- Used by `next-term-cta`, `upcoming-terms` (both variants) and the LINKS "Najbliższe zajęcia" button, so a term more than 60 days away never produces "Brak zaplanowanych zajęć" while `/:slug/terminy` lists it.

**Owner ghost copy** (`GHOST_COPY`, owner-edit only; each body ends with "Widzisz to tylko Ty.", as the existing `about` ghost does; CTA = a `<Link>`):

| Block | Title | Body | CTA → route |
|---|---|---|---|
| stats | "Statystyki" | "Statystyki pojawią się, gdy będziesz mieć więcej grup i terminów. Widzisz to tylko Ty." | "Dodaj termin →" `/panel/spotkania` |
| upcoming-terms | "Najbliższe terminy" | "Tu pokażemy Twoje najbliższe zajęcia. Widzisz to tylko Ty." | "Dodaj termin →" `/panel/spotkania` |
| next-term-cta | "Najbliższe zajęcia" | "Tu pojawi się Twój najbliższy termin. Widzisz to tylko Ty." | "Dodaj termin →" `/panel/spotkania` |
| agenda | "Plan zajęć" | "Gdy dodasz terminy, odwiedzający zobaczą tu plan zajęć. Widzisz to tylko Ty." | "Dodaj termin →" `/panel/spotkania` |
| circles-grid | "Nasze grupy" | "Tu pokażemy Twoje publiczne grupy z najbliższymi terminami. Widzisz to tylko Ty." | "Dodaj grupę →" `/panel/spotkania` |
| exchange-counts | "Wymiana rzeczy" | "Gdy rodzice z Twoich grup wystawią rzeczy do oddania, wymiany lub wypożyczenia, pokażemy tu ich liczbę. Widzisz to tylko Ty." | "Dodaj rzecz do wymiany →" `/panel/rzeczy` |
| exchange-board | "Wymiana rzeczy" | "Tu pojawią się rzeczy, które Ty i rodzice z Twoich grup wystawicie na najbliższe zajęcia. Widzisz to tylko Ty." | "Dodaj rzecz do wymiany →" `/panel/rzeczy` |
| needed-items | "Potrzebne rzeczy" | "Gdy dodasz do terminu potrzebne rzeczy, rodzice zobaczą tu, co jeszcze trzeba przynieść. Widzisz to tylko Ty." | "Dodaj potrzebną rzecz →" `/panel/spotkania` |
| about (existing) | unchanged | unchanged | none |

Neutral variant (`unavailable`): the block's title, body "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.", no CTA. The stats CTA departs from the mockup's "no CTA" because the user asked for a panel link on every directory ghost.

**Supporting components**
- **`EmptyStateBlock.tsx`** (component:empty-state-visitor). Props: `layoutKey` and `unavailable?`. It renders a `TermsIcon`, a title and a body, plus a `ShareButton` "Udostępnij stronę". The copy:
  - SCHEDULE / CLASSIC: "Brak zaplanowanych zajęć"
  - CIRCLES: "Brak grup do pokazania"
  - EXCHANGE: "Na razie nic tu nie ma", with a `<details>` "Jak to działa?" that explains that parents from the group put up items, and that a visitor signs up for a term and acts on its page
  - unavailable: "Brak informacji do pokazania"
  - the body for all cases: "Zajrzyj tu wkrótce albo udostępnij stronę znajomym."
  - It must not reuse `components/shared/EmptyState.tsx`.
- **`BlockSkeleton.tsx`** (component:block-skeleton). Pulse bars `bg-line/60 animate-pulse motion-reduce:animate-none`, `aria-hidden`, inside an `aria-busy="true"` container. A prop chooses between the `rows` and `grid` shapes.
- **`GhostBlock.tsx`** [MOD] (component:ghost-directory).
  - `GHOST_COPY` gains the entries in the table above, with an optional `cta: {label, to}` rendered as a `<Link>` (`min-h-[44px]`, focus ring).
  - With `unavailable`, it keeps the block's title and uses the body "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.", with no CTA.
- **`termLabels.ts`** [MOD]. Add `EXCHANGE_MODE_LABELS = {GIFT: "Oddam", SWAP: "Zamienię", LEND: "Wypożyczę"}` and `EXCHANGE_MODE_TONE` (soft background plus foreground classes). Do not copy `ITEM_MODE_STYLE`.

### Layouts (`registry.ts`; exactly one primary slot is active for any circle count)
| Key | Label / description / thumbnail | Frame | Blocks | recommendWhen |
|---|---|---|---|---|
| CLASSIC | "Klasyczny" / "Profil z opisem i terminami." / `classic.svg` | column | `hero:cover`, `share`, `stats`, `about`, `upcoming-terms:list` (primary), `exchange-counts:tiles3`, `footer` | never (undefined) |
| SCHEDULE | "Plan zajęć" / "Gdy masz wiele zajęć w tygodniu." / `schedule.svg` | column | `hero:compact`, `next-term-cta:card`, `agenda:by-day` (primary), `about`, `exchange-counts:tiles3`, `footer` | at least 4 `upcoming_terms` with `occurs_on` before now + 14 days |
| CIRCLES | "Grupy" / "Twoje grupy na jednej stronie." / `circles.svg` | column | `hero:cover`, `share`, `circles-grid:cards` {when minCircles 2, primary}, `circles-grid:featured` {when maxCircles 1, primary}, `about`, `exchange-counts:tiles3`, `footer` | `circles.length >= 2` |
| EXCHANGE | "Wymiana" / "Tablica rzeczy do oddania i wymiany." / `exchange.svg` | column | `hero:compact`, `exchange-board:grid2` (primary), `needed-items:list`, `upcoming-terms:compact`, `about`, `footer` | GIFT + SWAP + LEND >= 4 |
| LINKS | unchanged label and copy / `links.svg` | centered | `hero:centered`, `link-stack` (primary), `about`, `footer` | `directoryStatus === "unavailable"` or `circles.length === 0` |

- A helper `isRecommended(layout, data)` in `registry.ts` returns false whenever `directoryStatus === "loading"`, and otherwise returns `layout.recommendWhen?.(data) ?? false`.
- The thumbnail alt text is "Szkic układu <label>".
- The new SVGs go in `assets/layouts/{schedule,circles,exchange}.svg`, in the style of `classic.svg` and `links.svg`, using the same viewBox and neutral strokes.

### Editor (component:layout-card-badge)
- `EditorSheet` gets a new required prop `pageData: OrganizerPageData`, passed from `PublicOrganizationPage`.
- `LayoutTab` gets a new prop `data` and replaces `layout.recommended` with `isRecommended(layout, data)`.
- The `aria-describedby` badge pattern is unchanged.
- The 5 cards use the existing 2-column grid.

### `/:slug/terminy` (screen:organizer-terms) — `pages/organizer/OrganizerTermsPage.tsx`
- **Route.** `router.tsx` gains `{ path: "/:organizationSlug/terminy", element: <OrganizerTermsPage /> }` in the same children array, declared before the `/:organizationSlug` catch-all. It has no `AuthGuard`, and the comment notes `terminy` in `RESERVED_SLUGS`.
- **Data.**
  - `usePublicOrganization(slug)` supplies the theme and the name.
  - `useOrganizerPage(slug)` supplies the chips (`circles`).
  - `useOrganizerTerms(slug, groupId)`.
  - The `group_id` search parameter sets the initial chip. A chip change updates it with `replace` and resets the pages through the key.
  - **Sanitizing `group_id` (M-5).** The search parameter is used only when it equals one of `useOrganizerPage(slug).data.circles[].id`.
    - Until the directory resolves, the terms query waits (`enabled: false`) when a `group_id` parameter is present. Without the parameter, it starts at once with "Wszystkie".
    - An unknown or malformed value is treated as "Wszystkie" and dropped from the URL (`replace`). If the directory is unavailable, it is also treated as "Wszystkie".
    - The frontend therefore never sends an unvalidated `group_id`, and the backend's 400 is unreachable from the UI.
- **Render.** `OrganizerThemeScope(organization)`, then the shared `PageFrame`, then:
  - a back link "‹ <name>" to `/${slug}` (`min-h-[44px]`)
  - the `<h1>` "Wszystkie terminy"
  - "N zaplanowanych" (`pluralPl` of the total)
  - chips when there are at least 2 circles
  - the `AgendaList`
  - a "Pokaż więcej" button. It is disabled and reads "Wczytywanie…" while fetching, and it is hidden without a next page.
  - an `aria-live="polite"` region that announces "Wczytano N kolejnych terminów"
  - `FooterBlock`
- **States.**
  - First load: heading plus `BlockSkeleton`.
  - Empty: `EmptyStateBlock`-style copy "Brak zaplanowanych zajęć", plus "Pokaż wszystkie grupy" when a chip is active.
  - Organization 404 or terms 404: the not-found frame.
  - First-page error (any non-404, such as 5xx or a network failure): the heading, then "Nie udało się wczytać terminów." with a "Spróbuj ponownie" button (`refetch`).
  - Next-page error: "Nie udało się wczytać kolejnych terminów." with a "Spróbuj ponownie" button.
- **Refactor.** Extract `PageFrame` and the not-found frame from `PublicOrganizationPage.tsx` into `pages/organizer/PageFrame.tsx`, with `PageFrame` and `NotFoundFrame`, and reuse both.

### Term-page thumbnail (screen:term-page-listing-thumb, component:listing-thumb)
- `ListingRowVM` gains `thumbUrl?: string | null`. Only `PublicTermView.toListingRow` sets it (to `listing.thumb_url`).
- `ListingRow` renders a 48×48 `rounded-xl shrink-0 bg-cream` tile **only when `thumbUrl !== undefined`**. The tile holds `SafeImage` (`alt=""`, `placeholderSize={20}`) or the `PhotoPlaceholder` fallback, laid out as `flex gap-3`, outside the item link.
- Private rows are unchanged.

## Reusable Components

### Existing code to use
- **Backend**
  - `app/groups/router/circles.py` `get_public_circle` / `get_group_access`: the template for a public route.
  - `app/core/pagination.py`: `Pagination`, `Page[T]`.
  - `app/groups/infrastructure/repository.py`:
    - `count_active_attendances_by_term` (l.373)
    - `list_item_listing_preferences_for_parties` (l.472)
    - `list_needed_items_with_product_for_term` (l.278), the pattern for the `.in_()` sibling
    - `list_groups_for_moderation` (l.56), the aggregated-subquery template
  - `app/organizations/service.py`: `get_organization_by_slug` (l.69), and `get_own_organization` (l.77) as the pattern for `get_owner_party_id`.
  - `app/groups/infrastructure/product_bridge.py`: `product_ids_with_unmoderated_photos`, the batch and early-return pattern.
  - `app/groups/infrastructure/circulation_bridge.py`: the `__all__` pass-through pattern.
  - `app/product/models.py` `ProductPhoto.thumb_key`.
  - `app/storage/service.py` `get_storage` / `public_url`.
  - `app/product/router.py:42`: the `Storage` alias.
  - `app/groups/application/exchange_summary.py`: the precedent for importing `families.models`.
  - Test helpers: `tests/conftest.py`, `tests/fake_storage.py` (`https://cdn.test/...`), and the HTTP builders in `tests/test_public_term.py` (`_register_organizer`, `_create_circle`, `_create_term`, `_create_needed_item`). Item, preference and approved-photo seeding follows `tests/test_term_item_listings.py` and `tests/test_product_photos.py`.
- **Frontend**
  - `pages/organizer/LayoutRenderer.tsx`, `layouts/registry.ts`, `layouts/types.ts`.
  - The blocks `HeroBlock`, `ShareButton`, `FooterBlock`, `GhostBlock` and `LinkStackBlock`.
  - `editor/LayoutTab.tsx`, `EditorSheet.tsx`, `rovingIndex.ts` (`nextIndex`), and the `PreviewCards.tsx` visual patterns.
  - `hooks/usePublicOrganization.ts`, the hook template. `hasStatus` comes from `hooks/useTermAttendees`.
  - `api/pagination.ts` (`Page`, `pageParams`).
  - `utils/dayjs.ts`, `utils/plural.ts`, `utils/layoutPositions.ts` (geometry only), and `utils/productCategory.ts` `CONDITION_LABELS`.
  - `pages/product/ItemGallery.tsx` `SafeImage`.
  - `components/shared/Icons.tsx` (`PhotoPlaceholder`, `TermsIcon`, `GroupsIcon`, `BringsIcon`).
  - `theme/OrganizerThemeScope.tsx`.
  - `pages/krag/components/termLabels.ts`.

### New code and why it is needed
- **The organizer read model** (application module, schemas and router). No endpoint resolves organization → owner → circles, and the existing public shapes carry names and party ids.
- **Batched repository, bridge and service functions.** The existing ones are per-group or per-term, and the `term_item_listings.py` helpers run 2–3 queries per item, which would break the query budget.
- **`get_owner_party_id`.** It is missing today. `Organization.party_id` is the organization's own party, not the owner's.
- **Blocks, layouts, `OrganizerTermsPage`, `EmptyStateBlock` and `BlockSkeleton`.** These are new UI.
  - The shared `EmptyState.tsx` (Chakra and hex colors) and `Pagination.tsx` (numbered pages) would break the theme-token rule and the "Pokaż więcej" UX.
  - `GroupVisualization` exposes names, which is why `CircleVisualMini` is new.
- **The `count_queries` test helper.** No query-count infrastructure exists.

**Explicitly not built:**
- a `BlockSlot.props` field (the compact limit of 3 is fixed in the variant)
- a block `variants` registry
- the `gallery` and `testimonials` block ids
- a `useOrganizerPageData` hook (`PublicOrganizationPage` composes the data inline)
- a `hero:color` alias
- a separate `circle-visual` block id

## Implementation Guidance

### Testing Approach
- Write 2–8 focused tests per implementation step group. Test verification runs only the new and changed tests, not the whole suite.
- **Backend** (pytest with a Postgres testcontainer, data built over HTTP and through `db_session` seeding):
  - **`tests/conftest.py`**: a `count_queries(engine)` context manager. It attaches a `before_cursor_execute` listener to `engine.sync_engine`, collects statement texts, ignores `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` statements, and removes the listener in `finally`. Tests wrap only the GET call.
  - **`tests/test_organizer_page.py`** covers:
    - the directory shape, plus a recursive check that no forbidden key appears
    - exclusion of PRIVATE circles and of circles with a revoked `GroupRole` or `Leadership`
    - 404 for an unknown slug, a `k-…` slug and an organization without an owner; 200 with empty data for an owner without circles
    - the window: past and 60-day-plus terms are excluded from `upcoming_terms` and from the counts but stay in `next_term`
    - `family_count`: null at 2, 3 at 3, and the owner's family excluded
    - exchange: only listings by eligible listers, AVAILABLE only, deduplicated to the nearest term, counts per mode, `thumb_url` from an APPROVED photo only, and null without storage
    - `needed_items` with the `claimed` flag and no names
  - **`tests/test_organizer_terms.py`** covers:
    - ordering and pagination totals
    - a foreign `group_id` giving an empty 200
    - a non-UUID `group_id` and `size=101` giving 400
    - a 404
  - **`tests/test_organizer_page_queries.py`** covers:
    - the main endpoint: count(1 circle) == count(5 circles) and ≤ 12, with each circle seeded with a term, an attendee, a listed item with an approved photo and a needed item
    - `/terms`: constant for 1 vs 5 circles and for 1 vs 25 terms
    - the term page, measured on **`GET /api/groups/public/{id}/access`** (the route the frontend uses): exactly 1 statement on `product_photos` for both 1 and 5 listings
    - `thumb_url` set (`https://cdn.test/…/w400.webp`) for an APPROVED photo and `null` without one, asserted on `/access`, plus one assertion on `GET /api/groups/public/{id}`
  - **`tests/test_authorization_matrix.py`**:
    - GET `/api/groups/public/organizers/x` and `/x/terms` resolve to PUBLIC
    - POST on that path is not PUBLIC
    - `/api/groups/public/<uuid>` and `/<uuid>/access` still resolve to PUBLIC
    - `GET /api/groups/<id>` is still READ
  - **`tests/test_organizations.py`**: `access`, `terms` and `terminy` are reserved. PATCH accepts `SCHEDULE` (in the frontend commit, together with `PAGE_LAYOUT_KEYS`).
- **Frontend** (Vitest, Testing Library, `createQueryWrapper`, `vi.mock` of `api/groups`):
  - **New:**
    - `useOrganizerPage.test.tsx` (404 → `notFound`)
    - `useOrganizerTerms.test.tsx` (`fetchNextPage` appends page 2, `hasNextPage` turns false, a `groupId` change refetches)
    - `organizerBlocks.test.tsx` (each block renders its data and has the right links and empty rule; no names; the claimed pill; tabs filter the board; mini seats capped)
    - `OrganizerTermsPage.test.tsx` (chips, "Pokaż więcej", empty, 404)
    - an addition to the term-page thumbnail test, rendering `PublicTermView` or `AttendeeList` with `thumb_url` present and null
  - **Intentionally changed:**
    - `LayoutRenderer.test.tsx`: 5 keys; exactly one active primary for 0, 1 and 2 circles; the `when` filter; skeleton while loading; unavailable hidden for the visitor and a neutral ghost for the owner; primary empty → empty state plus Share; the `recommendWhen` table, replacing the static `["LINKS"]`
    - **Every test file that renders `PublicOrganizationPage`** adds a file-level `vi.mock("../api/groups", …)`. Because `vi.resetAllMocks()` runs in `beforeEach`, `getOrganizerPage` is resolved in `beforeEach` with an explicit fixture. No test may fall through to a real request. Today that means `OrganizerEditor.test.tsx` and `PublicOrganizationPage.test.tsx`.
    - `OrganizerEditor.test.tsx` (~l.241): badges are asserted explicitly from the fixture data:
      - 2 or more circles and 4 or more terms in 14 days → both "Plan zajęć" and "Grupy" are Polecany
      - 0 circles → only "Wizytówka"
      - a pending `getOrganizerPage` → no badge at all
      - a rejected one → only "Wizytówka"
    - `PublicOrganizationPage.test.tsx`: a directory error leaves hero, share and footer intact
    - `TermPage.test.tsx`: the typed `PublicCircleResponse` literal (l.40, `item_listings` l.66–84) gains `thumb_url: null` on both listings, otherwise `tsc -b` fails. The implementer greps `src/` for other typed `PublicItemListingResponse` literals and updates them the same way. `as`-cast fixtures such as `termViewModel.test.ts` need no change.
  - **Lists:** `themeTokenUsage.test.tsx` (and `themeDefects.test.tsx` where it lists files) gain every new block, page and component file.
  - **Parity:** `organizerKeyParity.test.ts` is unchanged and must pass with the 5 keys.

### Delivery (two commits)
1. **B-backend.** Endpoints, schemas, application module, repository, ACL and bridges, matrix and tests, `RESERVED_SLUGS`, `thumb_url` on `PublicItemListingResponse`, migration 0053 and the model index, `security.md`, and the backend tests. `PAGE_LAYOUT_KEYS` is **not** changed here.
**Pre-deploy check (B-backend):** run `SELECT id, slug FROM organizations WHERE slug IN ('access','terms','terminy');` against production.
- Any row stays reachable: the frontend catch-all still matches, and the organizer router is registered first. It would only lose its OG preview, because `system/router.py` sends reserved slugs to `spa_fallback`.
- If a row exists, tell the user before deploying.

2. **B-frontend.** API and hooks, contract, renderer, blocks, layouts, SVGs, `OrganizerTermsPage` and the route, editor badges, the term-page thumbnail, the `PAGE_LAYOUT_KEYS` literal with the backend PATCH test for a new key, and the frontend tests.

### Standards Compliance
- `standards/backend/api.md`: RESTful GET, plural resources, pagination envelope.
- `standards/global/validation.md` / `error-handling.md`: 400 for invalid parameters (app convention), `EntityNotFoundException` → 404.
- `standards/backend/queries.md` / `jooq.md`: bound parameters (including `now`), no N+1, explicit ordering, SQL-level LIMIT/OFFSET, EXISTS for `claimed`.
- `standards/backend/models.md`: cross-module access only through ACL and bridges; `Index` declared on the model.
- `standards/backend/migrations.md`: a small, reversible, single-purpose migration with sequential numbering.
- `standards/backend/security.md`: matrix row ordering with a comment, PUBLIC routes without `require_any`, updated documentation.
- `standards/frontend/data-fetching.md`: TanStack hooks in `src/hooks/` wrapping `src/api/*`, array keys with prefix constants, `dayjs` from `utils/dayjs.ts`, stable empty fallbacks.
- `standards/frontend/components.md` / `css.md`: one block per file, role tokens only, no hex, no `kg-*`.
- `standards/frontend/accessibility.md`: radiogroup and tablist semantics, touch targets of at least 44px, `aria-live`, `aria-busy`, `role="img"`.
- `standards/frontend/responsive.md`: a 430px column, horizontal chip scroll with no page scroll.
- `standards/testing/frontend-testing.md`: tests in `src/test/`, `vi.mock` factories, `createQueryWrapper`.
- `standards/global/minimal-implementation.md`: no speculative fields or blocks (see "Explicitly not built").

## Success Criteria / Acceptance
1. An anonymous `GET /api/groups/public/organizers/{slug}` returns the contract above. PRIVATE and non-qualifying circles never appear, no forbidden key appears, and `family_count` is null below 3.
2. Main endpoint statements are ≤ 12 (the test guards the actual 10) and equal for 1 and 5 circles. `/terms` is constant for 1 vs 5 circles and 1 vs 25 terms. The term page issues exactly one photo statement for 1 and 5 listings.
3. The 30/10 limits, the 60-day window and the `/terms` pagination are enforced in SQL. The exchange counts and caps (12 exchange items, 12 needed items) are enforced in SQL too (see Known Limitations).
4. Unknown, `k-…` and ownerless slugs → 404. An invalid `page`, `size` or `group_id` → 400. A foreign `group_id` → empty 200.
5. The matrix tests pass, including regressions for `/public/<uuid>`, `/access` and row 26. `GET /api/groups/public/organizers/access` reaches the organizer route.
6. The editor shows 5 layouts, and the badges follow the rules: none while loading, and several can show at once.
7. CIRCLES with 1 PUBLIC circle renders `featured` with anonymous seats, and with 2 or more it renders `cards`.
8. SCHEDULE "Pokaż kolejne terminy" and `/:slug/terminy` "Pokaż więcej" load the next `/terms` page, and the chips filter by `group_id`.
9. EXCHANGE cards show no lister and link to the term page. The tabs filter the board.
10. A directory 404 or error never breaks `/:slug`. Directory blocks disappear for visitors and show neutral ghosts for the owner. Hero, share and footer always render.
11. The real term page (data from `GET /api/groups/public/{id}/access`) shows a 48px thumbnail for listings with an APPROVED photo, and a placeholder when `thumb_url` is null.
12. The frontend/backend layout key parity test passes. The theme-token tests cover the new files. mypy (`uv run python -m mypy app`) does not rise above the HEAD baseline, and ruff is clean.

## Known Limitations
- **The exchange `items` cap of 12 is applied in SQL** (since 2026-10-10). `counts` come from a `GROUP BY` over the full eligible set, so they are uncapped; only the top 12 rows are loaded.
- **`needed_items` is capped at 12** (`NEEDED_ITEMS_LIMIT`, SQL `LIMIT`), the nearest terms' needs first, matching the exchange cap. There is no count of the hidden needs and no "show more".
- **The directory caps circles at 30**, so `stats.upcoming_term_count`, `circles[].upcoming_term_count` and everything the frontend derives from them (the "Wszystkie terminy (N)" label and the agenda's circle filter chips) cover only those 30 circles, while `/terms` is uncapped and lists every qualifying circle's terms.
- **`ix_terms_circle_group_id` is now a redundant prefix of `ix_terms_circle_group_id_occurs_on`** (migration 0053, built `CONCURRENTLY`). It is left in place in this task; dropping it belongs in a later migration.
- **The anonymous organizer endpoints send `Cache-Control: public, max-age=0, s-maxage=60`** on success: browsers always revalidate (so panel edits and RSVPs show immediately), while a shared cache, if one is added in front of the API, may serve data up to a minute old. There is no shared cache today.
- **`/terms` rejects `page` above 10 000** with 400 (`MAX_PAGE` in `core/pagination.py`, shared by every paginated endpoint).
- **The board can show fewer cards than a tab's count.** Board tabs filter at most 12 items, while the counts reflect the full set. There is no "Pokaż wszystkie" until a paged items endpoint exists.
- **`stats.circle_count` is capped at 30**, because it is derived from the limited circle list.
- **The "Wszystkie terminy (N)" label counts only the 60-day window**, while `/:slug/terminy` lists every future term.
- **HLD's next migration number changes.** This task takes **0053**. Task C (organization content, listed as `0053_organization_content.py` in `analysis/research-context/high-level-design.md` §11) **must take the next free number after 0053** (0054 or later), and D shifts accordingly. Note this when C's spec is written.

## Revision 2026-10-09 (audit)
Source: `verification/spec-audit.md` plus the user's binding decisions. Every finding was applied.

- **C-1.** `storage: Storage` is added to `get_group_access` (`GET /api/groups/public/{id}/access`) and threaded through `public_view.get_group_access` into `get_public_circle_view`. `get_public_circle` stays wired too. The thumbnail and query-count tests now target `/access`.
- **M-1.** Statement 3 uses a per-circle `LEFT JOIN LATERAL … ORDER BY occurs_on, id LIMIT 1`, and the unscoped `DISTINCT ON` is forbidden. The count subquery is scoped per circle as well.
- **M-2.** `TermPage.test.tsx` (typed `PublicCircleResponse` literal) is added to the intentionally changed tests, along with a grep for other typed literals.
- **M-3.** A file-level `vi.mock("../api/groups")` is required in every test that renders `PublicOrganizationPage`, with `getOrganizerPage` resolved in `beforeEach`. Badge tests assert data-driven outcomes explicitly.
- **M-4.** An owner ghost copy table (title, body, panel CTA) covers all 8 directory blocks. The stats ghost gains a CTA.
- **M-5.** First-page error states with retry are added for `/:slug/terminy` and `AgendaBlock`. The `group_id` search parameter is used only when it matches `directory.circles[].id`.
- **L-1 (fallback chosen).** A new `nearestTerm(directory)` helper falls back to the earliest `circles[].next_term`. It feeds `next-term-cta`, `upcoming-terms` and the LINKS "Najbliższe zajęcia" button.
- **L-2.** The `security.md` wording is corrected: the matrix is reference-only, verified by tests, and enforced per route through `Depends`. There is no re-export.
- **L-3.** The 404 comes only from lookup failure. There is no `k-` prefix check.
- **L-4.** A pre-deploy slug check SQL is added to Delivery.
- **L-5.** The `CircleVisualMini` aria-label uses `pluralPl`.
- **L-6.** The user accepted moving the exchange mode tabs into `exchange-board`.
- **L-7.** Task C must take the next free migration number after 0053.
- **L-8.** The time-base difference between the term page and the directory is documented under R4.
- **Query budget.** The main endpoint uses at most 11 statements (budget 12; superseded: 10 since 2026-10-10). `/terms` uses at most 5. The term-page thumbnail adds 2 on both `/public/{id}` and `/public/{id}/access`, regardless of item count. The LATERAL change only changes the SQL shape of statement 3, not the count.

