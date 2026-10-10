# Codebase Analysis Report

**Date**: 2026-10-09
**Task**: B — public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts
**Description**: Backend: GET /api/groups/public/organizers/{slug} (with needed_items, and /terms with pagination), ACL functions, a PUBLIC row in the authorization matrix before row 26, batch functions in the bridges, a constant-query-count test, and thumb_url on the public list. Frontend: the agenda, circles-grid, circle-visual:mini, exchange-board, needed-items and stats blocks; the SCHEDULE, CIRCLES and EXCHANGE layouts in the A2 registry (plus keys in page_layouts.py and the parity test); a data-driven "Polecany" (recommended) badge rule that replaces A2's static `recommended`. Builds on A2 (commit c026f28).
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Pattern Mining)

---

## Summary

Every piece B needs already exists in the codebase: a public endpoint template, pagination, ACL/bridge conventions, batched repository queries, thumbnails through storage, and the A2 layout registry with its renderer. Nothing has to be built from scratch, but some pieces need care. The main risks are in the details:

- a **route collision** with `GET /api/groups/public/{group_id}/access`
- the **per-item N+1 helpers** in `term_item_listings.py`, which must not be reused
- `organizations/service.get_owner_party_id`, which is **missing**
- **no query-count test infrastructure**
- an **A2 frontend contract much smaller than the HLD** (no `when` / `isEmpty` / `recommendWhen`, and no organizer data in `LayoutTab`)

Three existing frontend tests will break by design and must be updated.

---

## Files Identified

### Primary Files (backend)

**src/backend/app/core/authorization_matrix.py** (256 lines)
- `_RAW_MATRIX` holds 76 tuples. "Row 26" is a comment label at l.125: `(GET, ^/api/groups(/.*)?$, READ)`.
- The public group block is at l.81–120: `/public/[^/]+$` (l.86), `/access` (l.93), rsvp, merge, join-requests, PATCH (l.115), moderation.
- The new PUBLIC row goes inside this block, before PATCH and row 26. Without it, `/organizers/x` falls through to row 26 (READ).
- `app/core/auth_deps.py` (38 lines) only re-exports. security.md gives this location, which is out of date.

**src/backend/app/groups/router/circles.py** (339 lines)
- Holds the template `get_public_circle` (l.112) and `GET /public/{group_id}/access` (l.132, `group_id: uuid.UUID`).
- **Collision**: `/public/organizers/access` would match `/access` and fail UUID validation with a 400.
- Paginated example: `list_groups_for_moderation` (l.248).

**src/backend/app/groups/router/__init__.py** (34 lines)
- Sub-router registration order matters and is documented. The new `organizer_page` router must be included **first**.

**src/backend/app/groups/application/public_view.py** (474 lines)
- Contains `get_public_circle_view`, `_resolve_organizer` and the PRIVATE reduced branch.
- It picks the nearest term in Python. That is an anti-pattern for B: use SQL instead.
- The new `application/organizer_page.py` goes beside it.

**src/backend/app/groups/infrastructure/repository.py** (637 lines)
- Batched helpers that can be reused:
  - `count_active_attendances_by_term` (l.373, returns `{term_id: (count, children)}`)
  - `list_organizer_role_ids_for_party` (l.147; does not filter `GroupRole.valid_to`)
  - `list_active_leaderships_for_role_ids` (l.164)
  - `list_item_listing_preferences_for_parties` (l.472)
  - `list_groups_for_moderation` (l.56; aggregated LEFT JOIN / GROUP BY template)
  - `list_terms_for_moderation` (l.236; offset/limit)
- Needs an `.in_(term_ids)` sibling of `list_needed_items_with_product_for_term` (l.278).

**src/backend/app/groups/application/term_item_listings.py** (1002 lines)
- Defines the eligibility rule (`_list_eligible_lister_party_ids` l.351: active attendees + organizer) and availability (`_is_item_available` l.229: balance AVAILABLE).
- Its helpers query per item (2–3 queries per item or term). **Do not reuse them.** Reimplement them batched.

**src/backend/app/groups/infrastructure/organizations_acl.py** (31 lines)
- The only path from groups to organizations. Add `get_organization_by_slug` and `get_owner_party_id` pass-throughs.

**src/backend/app/organizations/service.py** (178 lines)
- `get_organization_by_slug` (l.69) returns None when not found.
- `get_own_organization` (l.77) is the reverse join template.
- **Add `get_owner_party_id(org_id)`.** It selects `OrganizationRole.party_id` where OWNER and `valid_to IS NULL`.

**src/backend/app/groups/infrastructure/circulation_bridge.py** (242 lines)
- The ACL from groups to circulation, with `__all__`. Batch precedent: `list_active_hand_over_reservations_for_terms`.
- Add `list_available_items_with_product(item_ids)`.

**src/backend/app/groups/infrastructure/product_bridge.py** (48 lines)
- Batch precedent: `product_ids_with_unmoderated_photos(db, Collection[UUID]) -> set`, with an early return on empty input.
- Add `first_approved_photo_by_product(product_ids)`: DISTINCT ON product, APPROVED only, lowest `sort_order`.

**src/backend/app/groups/schemas.py** (721 lines)
- Existing public shapes: `PublicNeededItemResponse` (l.250), `PublicItemListingResponse` (l.264), `OrganizerTheme` (l.292), `PublicCircleResponse` (l.302).
- Add `OrganizerPageResponse` and `OrganizerTermResponse`, with no names and no party IDs.

**src/backend/app/groups/service.py** (168 lines)
- The facade. Re-export the new use case here (the public_view re-export is around l.64).

**src/backend/app/organizations/page_layouts.py** (19 lines)
- `PAGE_LAYOUT_KEYS = frozenset({"CLASSIC","LINKS"})` must stay **a single literal with double quotes**, because the frontend test parses it with a regex.
- Also defines `FALLBACK_PAGE_LAYOUT`, and `resolve_page_layout(stored)`, which takes `stored` (the HLD says `org`).

### Primary Files (frontend)

**src/frontend/src/pages/organizer/layouts/types.ts** (34 lines)
- `BlockId` is `hero | share | about | link-stack | footer`.
- `BlockSlot{block, variant?, primary?}`, `OrganizerPageData{organization}`, `recommended?: true`.
- Extend it additively: new BlockIds, `when`, `directory`/`directoryStatus`, `mode` in BlockProps, `recommendWhen`.

**src/frontend/src/pages/organizer/layouts/registry.ts** (45 lines)
- Contains CLASSIC and LINKS (static `recommended`), `resolveLayout` and `FALLBACK_LAYOUT`. Add the 3 layouts here.

**src/frontend/src/pages/organizer/LayoutRenderer.tsx** (46 lines)
- `BLOCKS: Record<BlockId, ComponentType|null>`. A `null` block is skipped for a visitor and shown as a ghost for the owner.
- There is no `isEmpty`/`when`. Add a `when` filter, skeletons and visitor hide-on-empty.

**src/frontend/src/pages/organizer/PublicOrganizationPage.tsx** (135 lines)
- Uses `usePublicOrganization` + `useMyOrganization` and passes `data={{organization}}`.
- Must add directory data **without blocking first paint**.

**src/frontend/src/pages/organizer/editor/LayoutTab.tsx** (78 lines) and **EditorSheet.tsx** (214 lines)
- `LayoutTab` reads module-level `LAYOUTS` and gets no organizer data. To compute "Polecany", thread `OrganizerPageData` through `EditorSheet` (l.168).

**src/frontend/src/api/groups.ts** (516 lines)
- Add types plus `getOrganizerPage` and `getOrganizerTerms`, using `encodeURIComponent` on the slug.

**New hooks**: `src/frontend/src/hooks/useOrganizerPage.ts` (key `"organizerPage"`) and `useOrganizerTerms.ts` (key `"organizerTerms"`). Template: `usePublicOrganization.ts` (37 lines).

**New blocks**: `src/frontend/src/pages/organizer/blocks/{Agenda,CirclesGrid,CircleVisual,ExchangeBoard,NeededItems,Stats}Block.tsx`

**New assets**: `src/frontend/src/assets/layouts/{schedule,circles,exchange}.svg`

### Related Files

**Backend:**
- `core/pagination.py` (42 lines): `PageParams` (page >= 1, size default 20, max 100), `Pagination` dependency, `Page[T]`.
- `groups/router/terms.py` (134 lines)
- `groups/application/circles.py` (263 lines)
- `groups/application/terms.py` (265 lines): `list_terms_with_counts` (l.58), `list_needed_item_views` (l.180, `claimed` flag).
- `groups/application/exchange_summary.py` (270 lines): imports `families.models` directly, which is the precedent for the `family_count` join.
- `groups/application/memberships.py` (233 lines): `_resolve_party_families` (l.65).
- `groups/models.py` (406 lines): Term (l.215, only index `ix_terms_circle_group_id`), TermAttendance (l.284), ItemListingPreference (l.313), GroupVisibility (l.83), GroupLayoutMode (l.70).
- `groups/domain/organizer_slug.py` (34 lines): `k-…` slugs have no Organization and should give a 404.
- `groups/infrastructure/slug_resolver.py` (36 lines)
- `organizations/slugs.py` (71 lines): `RESERVED_SLUGS`, an alternative fix for the collision.
- `organizations/router.py` (72 lines): the simplest public endpoint template.
- `organizations/models.py` (141 lines) and `organizations/schemas.py` (91 lines)
- Product thumbnails:
  - `product/models.py` (121 lines): ProductPhoto l.60–121, `thumb_key = {key}/w400.webp`
  - `product/service.py` (526 lines): `photo_view` / `PhotoView` l.334–373
  - `storage/service.py` (129 lines): `get_storage` returns None when Spaces is unconfigured
- `circulation/models.py` (353 lines): InventoryItem l.171, InventoryBalance l.206, BalanceStatus, ItemCondition.
- `circulation/service.py` (99 lines; its `__all__` needs the new function) and `circulation/infrastructure/repository.py` (379 lines).
- `families/models.py` (100 lines)
- `core/errors.py`: RequestValidationError gives **400**, not 422.

**Frontend:**
- Blocks: `blocks/Hero` (37), `Share` (16), `LinkStack` (16), `Footer` (8), `Ghost` (28, `GHOST_COPY`), `ShareButton` (50)
- Editor: `editor/draft.ts` (62), `PreviewCards.tsx` (49; `TermPreviewCard` / `ProductPreviewCard` visual references)
- API: `api/pagination.ts` (18; `Page<T>`, `PAGE_SIZE`, `pageParams()`), `api/organizations.ts` (56)
- Layout math: `pages/krag/GroupVisualization.tsx` (323) and `utils/layoutPositions.ts` (138). **Reuse the math only.**
- Term and item pieces: `KragStage.tsx`, `TermCard.tsx`, `NeededItemsSection.tsx`, `termLabels.ts`
- `pages/panel/panelHelpers.ts`: mode labels. Do **not** copy `ITEM_MODE_STYLE`, which uses hex and mint/lime colors.
- Shared components: `components/shared/{Pagination,EmptyState,Avatar,Icons}.tsx`
- Utilities: `utils/dayjs.ts`, `utils/plural.ts`, `utils/productCategory.ts` (`CONDITION_LABELS`)
- `router.tsx`: term link pattern `/:slug/grupa/:groupId/term/:termId` (l.154).

---

## Current Functionality

- **Organizer resolution**: the groups module never resolves an organization from a slug today. The A1/A2 public organizer page (`GET /api/organizations/public/{slug}`) returns only the organization card and theme. There is no circles, terms or exchange data.
- **Owner to circles path**: owner party → `GroupRole(ORGANIZATOR)` → `Leadership(valid_to IS NULL)` → `Group(visibility=PUBLIC)`. Today this takes 2 queries via repository helpers, and it can become one join.
- **Upcoming terms**: these are computed in Python (`date.today()` in public_view, `datetime.now()` in browse). `Term.occurs_on` is a naive DateTime.
- **Public term item listings**: they expose `lister_display_name`, `lister_party_id` and `claimed_by_*`. **The directory must not expose these.** No public listing response has a thumbnail.
- **Frontend layouts**: A2 shipped the narrow contract (A2 gap-analysis I-6 option A):
  - no `recommendWhen`, `BlockDefinition`/`isEmpty`, `when`, `directory`, or empty-state block
  - `BlockProps = {data, variant?}`
  - "Polecany" is a static flag on LINKS

### Key Components/Functions

- **get_public_circle / get_group_access** (circles.py): the template for a public route. It has no auth dependency, uses `DbSession` and `OptionalPrincipal`, and its docstring names the matrix row.
- **get_organization_by_slug / get_own_organization** (organizations/service.py): the starting point for organizer resolution.
- **count_active_attendances_by_term, list_item_listing_preferences_for_parties**: batched queries B can reuse.
- **photo_view** (product/service.py): `storage.public_url(thumb_key)` for APPROVED photos. B must use **only** APPROVED photos publicly, with no presigned URLs.
- **resolveLayout, LayoutRenderer, BLOCKS, GHOST_COPY** (frontend): the extension points for layouts.

### Data Flow (target)

The visitor opens `/:slug`. `PublicOrganizationPage` renders the organization (A2 hook) immediately, while `useOrganizerPage(slug)` loads the directory in parallel. On the backend, `GET /api/groups/public/organizers/{slug}` goes through these steps:

1. The router calls `service.get_organizer_page`.
2. The ACL resolves the org by slug, then the owner party. If either is missing, it returns a 404.
3. Batched repository queries load:
   - the owner's PUBLIC circles (LIMIT 30)
   - the next term per group (DISTINCT ON), plus `upcoming_term_count`
   - the agenda window (60 days, LIMIT 10)
   - attendance counts
   - `family_count`
   - needed items and their claimed flags for the next terms
   - eligible lister parties and their preferences
4. `circulation_bridge` loads the available items with product.
5. `product_bridge` loads the first approved photo, and `storage` turns it into `thumb_url` (null when storage is unconfigured).
6. Everything is assembled into `OrganizerPageResponse`.

`/terms?page&size&group_id` returns a paginated `Page[OrganizerTermResponse]`, restricted to the owner's PUBLIC groups.

On the frontend, `LayoutRenderer` filters blocks by `when` and the directory status, shows skeletons, and hides empty blocks from visitors.

---

## Dependencies

### Imports (what the new code depends on)

- `organizations.service` via `organizations_acl`: slug lookup and owner party (new function).
- `circulation` via `circulation_bridge`: item, balance and product name (new batch function).
- `product` via `product_bridge`: first approved photo per product (new batch function).
- `storage.service.get_storage`: the thumb URL. Precedent for the `Storage` dependency: `product/router.py` l.42.
- `families.models`: the `family_count` join (precedent in `exchange_summary.py`).
- `core.pagination`, `core.errors`, `core.authorization_matrix`.

### Consumers (what depends on the touched code)

- **organizations/schemas.py**: `UpdateOrganizationRequest._known_page_layout` and the `PublicOrganizationResponse.page_layout` validator both read `PAGE_LAYOUT_KEYS`.
- **organizerKeyParity.test.ts**: parses `page_layouts.py` with a regex.
- **EditorSheet / LayoutTab / OrganizerEditor**: use the registry.
- **PublicOrganizationPage**: uses `LayoutRenderer` and the registry.
- **groups/router/__init__.py**: route order affects the existing `/public/{group_id}` routes.
- **test_authorization_matrix.py**: asserts that matrix rows resolve as expected.

**Consumer Count**: about 8 files
**Impact Scope**: Medium. Most of the change is additive (a new endpoint, new blocks and new layouts). Route ordering, the matrix and the registry shape are shared seams.

---

## Test Coverage

### Test Files

**Backend:**
- **tests/test_public_term.py** (640 lines): the best template. Data is built over HTTP, and public calls carry no headers. Helpers: `_register_organizer`, `_create_circle`, `_create_term`, `_create_needed_item`.
- **tests/test_authorization_matrix.py** (131 lines): `resolve_requirement` assertions and a parametrized table (l.110–125).
- **tests/test_pagination.py** (66 lines): pagination contract.
- **tests/test_group_privacy.py** (360 lines): PRIVATE exclusion patterns.
- **tests/test_term_item_listings.py** (2424 lines): item, preference and balance fixtures.
- **tests/test_product_photos.py**: thumbnail assertions (`https://cdn.test/{key}/w400.webp`), with approved photos seeded through `db_session`.
- **tests/test_organizations.py** (391 lines): `_create_organization`, public slug tests and the PATCH layout test.
- **tests/conftest.py** (116 lines) and **tests/fake_storage.py** (39 lines): session-scoped engine (Postgres 18 testcontainer), savepoint rollback, httpx ASGI client.

**Frontend:**
- `organizerKeyParity.test.ts` (24 lines)
- `LayoutRenderer.test.tsx` (84 lines)
- `OrganizerEditor.test.tsx` (418 lines)
- `PublicOrganizationPage.test.tsx`
- `usePublicOrganization.test.tsx`
- `useOrganizationHooks.test.tsx`
- `Pagination.test.tsx`
- `KragStage.test.tsx`
- `layoutPositions.test.ts`
- `themeTokenUsage.test.tsx` and `themeDefects.test.tsx`: these forbid hex colors in organizer pages, and new block files must be added to their file lists.

### Coverage Assessment

- **Test count**: the related suites are large (backend: several hundred tests in the files above; frontend: about 10 related files).
- **Gaps**:
  - **No query-count infrastructure.** No `before_cursor_execute` listener exists. Add one with `event.listen(engine.sync_engine, "before_cursor_execute", ...)` and remove it in a `finally`. Measure 1 group against 5 groups: the counts should be equal, and at most about 12.
  - No test asserts which JSON keys a public response may contain, which is the privacy check.
  - No frontend tests for infinite or paginated directory terms. `useInfiniteQuery` is not used anywhere yet.
- **Expected breakages (update intentionally)**:
  - `LayoutRenderer.test.tsx`: the asserted keys `["CLASSIC","LINKS"]` and recommended `["LINKS"]`.
  - `OrganizerEditor.test.tsx:241`: only "Wizytówka" is Polecany.
  - `PublicOrganizationPage.test.tsx`: mocks only `api/organizations`, and now also needs `api/groups`.

---

## Coding Patterns

### Naming Conventions

- **Backend functions**: snake_case. Repository functions start with `list_*` / `count_*` / `find_*`. Batch functions take a `Collection[UUID]` and return a dict or set, with an early return on empty input.
- **Backend tests**: `test_action_condition_expectedResult` (camelCase segments). HTTP-built data with helpers copied per file. No factories.
- **Frontend components**: `XBlock.tsx` exporting `XBlock({data, variant}: BlockProps)`. Hooks are `useX` with an exported key constant.
- **Layouts**: the registry key equals `page_layouts.py` key (uppercase). Labels are Polish, thumbnail alt text is "Szkic układu …", and each layout has exactly one `primary: true` slot.

### Architecture Patterns

- **Backend style**: modular monolith (DDD bounded contexts).
  - In groups: `router/` → `service.py` facade → `application/*` → `infrastructure/*` (the repository never commits; ACLs and bridges are thin async pass-throughs with `__all__` and a docstring naming the caller) → `domain/` (pure).
  - Pydantic schemas are built by hand.
  - Cross-module access goes through ACLs and bridges, never through ORM relationships.
- **Public endpoints**: no `require_any`, plus `OptionalPrincipal`. A missing entity raises `EntityNotFoundException` (404), and validation errors give a **400** with `fieldErrors`.
- **Frontend state management**: TanStack Query v5 hooks returning `{data, loading=isPending, notFound, error, refetch}`, with `hasStatus(err, 404)` and no retry on 4xx. Pagination precedent: `useModerationGroups` with `keepPreviousData`.
- **Styling**: role-token Tailwind only (`bg-primary`, `text-ink`, `bg-primary-soft`, `text-on-primary`, `border-line`). No hex colors, and no `kg-*` classes outside KragStage.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Count | ~14 backend + ~20 frontend touched or new | High |
| Dependencies | 4 cross-module (organizations, circulation, product, storage) + families models | Medium |
| Consumers | ~8 | Medium-High |
| Test Coverage | Strong templates; no query-count infrastructure; 3 frontend tests break by design | Medium |

### Overall: Complex

The work is mostly additive, but it spans two stacks and four bounded contexts. It needs a batched read model with a fixed query budget and privacy constraints. On the frontend it extends the A2 registry contract (`when`, empty-state, `recommendWhen`, `mode`) and adds six blocks and three layouts.

---

## Key Findings

### Strengths
- There are clear templates for every layer: public route, use case, schemas, ACL and bridge, pagination, and tests.
- The batched repository helpers and the aggregated-subquery template already exist.
- Thumbnail generation (w400) and the CDN `public_url` already work, and `FakeStorage` gives deterministic URLs in tests.
- The A2 registry plus the backend/frontend key-parity test make it mechanical to add layouts.
- `layoutPositions` gives tested circle geometry that the mini visual can reuse.

### Concerns
1. **Route collision**: `GET /public/{group_id}/access` captures `/public/organizers/access` and returns a 400. Register the organizer router first, or add `access` to `RESERVED_SLUGS`, or do both.
2. **`get_owner_party_id` is missing** in organizations/service, so it must be added together with an ACL pass-through.
3. **N+1 trap**: `term_item_listings` helpers query per item. Reusing them breaks the constant-query test.
4. **Privacy**: existing public listing shapes expose lister names and party IDs, so new schemas must leave them out. `family_count` must be null below 3.
5. **Matrix location and enforcement**: the matrix lives in `authorization_matrix.py`, not `auth_deps.py`. It is a reference table checked only in tests, with per-route enforcement. The row is still required by security.md, and security.md needs a location fix.
6. **400 vs 422**: the HLD §8.3/8.6 says 422, but the app returns 400. Follow the app.
7. **A2 contract gap**: the HLD §6 BlockDefinition, `isEmpty`, `when`, `recommendWhen` and `directoryStatus` don't exist yet. The HLD §6.3 layouts also reference `next-term-cta`, `exchange-counts` and `upcoming-terms:compact`, which are not in the task's block list. Scope decision needed.
8. **thumb_url ambiguity**: research-report §855 says "thumb_url on public list", but the HLD puts it only on `exchange.items[].thumb_url`. The public term page's `PublicItemListingResponse` has none. Confirm scope.
9. **Migration numbering**: the last migration is 0052, and the HLD says 0051. No migration is expected (`page_layout` is VARCHAR(64); index on `terms(circle_group_id, occurs_on)` is optional).
10. **"Polecany" needs data**: `LayoutTab` has no organizer data, so threading it through `EditorSheet` changes the editor's props.

### Opportunities
- Add a reusable query-count fixture or helper in conftest for future N+1 guards.
- Add a composite index on `terms(circle_group_id, occurs_on)` if the upcoming-term queries need it. That would be migration 0053.
- Invalidate the `organizerPage` cache after the editor saves. A2 deferred this.

---

## Impact Assessment

- **Primary changes**:
  - Backend: `authorization_matrix.py`; `groups/router/__init__.py` and a new `router/organizer_page.py`; a new `application/organizer_page.py`; `repository.py`; `schemas.py`; `service.py`; `organizations_acl.py`; `organizations/service.py`; `circulation_bridge.py`, `circulation/service.py` and the circulation repository; `product_bridge.py` and `product/service.py`; `page_layouts.py`.
  - Frontend: `types.ts`, `registry.ts`, `LayoutRenderer.tsx`, 6 new blocks, `PublicOrganizationPage.tsx`, `LayoutTab.tsx`, `EditorSheet.tsx`, `api/groups.ts`, 2 new hooks, 3 SVGs.
- **Related changes**: `organizations/slugs.py` (`RESERVED_SLUGS`, optional) and security.md (fix the matrix location).
- **Test updates**:
  - New backend tests: `test_organizer_page.py` (endpoint, 404 for `k-` slug, PRIVATE excluded, privacy keys, `family_count` threshold, terms pagination, `group_id` filter, thumb_url), the query-count test, matrix cases (new path, `/terms`, `/public/<uuid>` and `/access` still PUBLIC), and a test_organizations PATCH to a new layout key.
  - Frontend: update the 3 breaking tests; add block and layout tests, hook tests, and the theme test file lists.

### Risk Level: Medium

The changes are additive and isolated behind a new endpoint and new layouts. The risk comes from the shared seams: route order, matrix order, and the registry shape used by the editor and the public page. It also comes from the privacy leak potential on an anonymous endpoint, and from the hard constraint on query count. Existing test templates and the parity test help contain these risks.

---

## Recommendations

**New capability on existing patterns.** Follow these steps:

1. **Backend ACL**: add `organizations/service.get_owner_party_id(db, org_id)`, the reverse of `get_own_organization`. Expose it and `get_organization_by_slug` through `organizations_acl`. A missing org or owner raises `EntityNotFoundException`, giving a 404.
2. **Batched read model**: write a fixed number of SQL queries with SQL-level filters and limits. Compute upcoming terms in SQL with `occurs_on >= now`, ORDER BY and LIMIT, or DISTINCT ON for the next term per group. Reuse `count_active_attendances_by_term` and `list_item_listing_preferences_for_parties`.
   - Find eligible lister parties for all terms in one query.
   - Dedupe items by `item_id`, keeping the nearest term.
   - Compute the counts per mode from the same set.
3. **Bridges**: add `circulation_bridge.list_available_items_with_product(item_ids)`, implemented in the circulation repository and service and added to `__all__`. Add `product_bridge.first_approved_photo_by_product(product_ids)` (DISTINCT ON, APPROVED, lowest `sort_order`). The router injects `Storage`, and `thumb_url = storage.public_url(thumb_key)` or null.
4. **Router**: add a new `groups/router/organizer_page.py` and include it **first** in `router/__init__.py`. Routes:
   - `GET /public/organizers/{slug}`
   - `GET /public/organizers/{slug}/terms` (`Pagination`, `group_id: UUID | None`, limited to the owner's PUBLIC groups)

   Also consider adding `access` to `RESERVED_SLUGS` as defense in depth.
5. **Matrix**: add `(_methods("GET"), r"^/api/groups/public/organizers/[^/]+(/terms)?$", "PUBLIC")` next to l.86, with an explanatory comment. Add the matrix test cases.
6. **Query-count test**: attach a `before_cursor_execute` listener to `engine.sync_engine` with `try`/`finally` removal. Count only the GET. 1 group and 5 groups must give equal counts, at most about 12.
7. **Privacy tests**: assert an allowlist of JSON keys, with no names or party IDs. Check that PRIVATE circles are excluded and that `family_count` is null below 3.
8. **Frontend contract**: extend `types.ts` additively. Add BlockIds, `when?: (d) => boolean`, `directory` / `directoryStatus` in `OrganizerPageData`, `mode` in BlockProps, and `recommendWhen`. The renderer:
   - filters on `when`
   - shows skeletons while the directory loads
   - hides empty blocks from visitors and shows ghost or empty states to the owner, following the HLD §6 table (l.337)
9. **Blocks**: use tokens only. Reuse only the `layoutPositions` math for `circle-visual:mini`, with no `GroupVisualization` buttons. Use `PreviewCards` markup as the visual reference for agenda and exchange. Use `dayjs` from `utils/dayjs`, `pluralPl` and `CONDITION_LABELS`. Add each block file to the theme test lists.
10. **Layouts**: add SCHEDULE, CIRCLES and EXCHANGE to the registry, with SVGs and Polish copy. Add the keys to the `PAGE_LAYOUT_KEYS` literal **in the same commit**, so the parity test stays green.
11. **Polecany**: add an `isRecommended(layout, data)` helper with HLD rules (l.457):
    - at least 2 groups → CIRCLES
    - at least 4 terms in 14 days → SCHEDULE
    - at least 4 items → EXCHANGE
    - no directory → LINKS

    Thread the data via `EditorSheet` to `LayoutTab`, and remove the static `recommended`.
12. **Data fetching**: use `useOrganizerTerms` with `useInfiniteQuery` (`getNextPageParam: last.page*last.size < last.total ? last.page+1 : undefined`), or `keepPreviousData` paging following `useModerationGroups`. Invalidate `organizerPage` after the editor saves.

**Decisions to confirm before the spec**:
- thumb_url scope: directory exchange only, or also `PublicItemListingResponse`?
- Whether the HLD §6.3 extra blocks (`next-term-cta`, `exchange-counts`, `upcoming-terms:compact`) are in scope for B.
- Collision fix: router order only, or also `RESERVED_SLUGS`?
- Use 400, not 422, for validation errors.

---

## Next Steps

Invoke the gap-analyzer with this report and the HLD (`analysis/research-context/high-level-design.md`). Give special attention to the four decisions above, the A2 contract extension, and the privacy and query-budget acceptance criteria (HLD §12, l.767–768).
