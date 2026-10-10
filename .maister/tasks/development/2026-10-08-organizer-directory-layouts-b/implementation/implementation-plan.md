# Implementation Plan: B — Public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts

## Overview
Total Steps: 92
Task Groups: 15 (6 backend, 9 frontend)
Expected Tests: ~77 in the implementation groups, plus up to 10 in the two review groups (4 backend, 6 frontend), so about 77–87 in total

This feature is far larger than the usual 16–34 test band. It has 19 requirements, two endpoints, query-count budgets, 9 blocks, 3 new layouts and a new page, so each group keeps its own 2–8 test limit and the total grows with the number of groups.

Spec: `implementation/spec.md` (AUTHORITATIVE, including "Revision 2026-10-09 (audit)").
Design (BINDING): `analysis/design-context/INDEX.md` + `analysis/design-context/ascii/ui-mockups.md`. Coverage: `implementation/visual-coverage.md`.

Path roots used below:
- Backend: `src/backend/` (app in `src/backend/app`, tests in `src/backend/tests`). Run tests with `cd src/backend && uv run python -m pytest <files> -q`.
- Frontend: `src/frontend/src/` (tests in `src/frontend/src/test`). Run tests with `cd src/frontend && npx vitest run <files>`.
- mypy: `cd src/backend && uv run python -m mypy app`. The HEAD baseline is about 32 errors, and no new errors are allowed. Lint the backend with `uv run ruff check app tests`.

Backend testing follows the actual pytest + httpx + testcontainers conventions in `src/backend/tests` (`conftest.py`, `fake_storage.py`, the builders in `test_public_term.py`). It does not follow the Spring text in `standards/testing/backend-testing.md`.

---

## Implementation Steps

# ===================== COMMIT 1: B-backend =====================

### Task Group 1: Migration 0053, routing safety & authorization matrix
**Dependencies:** None
**Files to Modify:** src/backend/app/groups/models.py, src/backend/alembic/versions/0053_terms_circle_occurs_on_index.py, src/backend/app/organizations/slugs.py, src/backend/app/core/authorization_matrix.py, .maister/docs/standards/backend/security.md, src/backend/tests/test_authorization_matrix.py, src/backend/tests/test_organizations.py, src/backend/tests/test_terms_circle_occurs_on_index_migration.py
**Estimated Steps:** 7

- [x] 1.0 Complete migration, slug and matrix layer
  - [x] 1.1 Write 6 focused tests
    - `test_authorization_matrix.py`:
      - `GET /api/groups/public/organizers/x` and `GET /api/groups/public/organizers/x/terms` resolve to PUBLIC
      - `POST /api/groups/public/organizers/x` does NOT resolve to PUBLIC
      - Regressions: `GET /api/groups/public/<uuid>` and `GET /api/groups/public/<uuid>/access` still resolve to PUBLIC
      - `GET /api/groups/<uuid>` is still READ (row 26)
    - `test_organizations.py`: `access`, `terms` and `terminy` are rejected as reserved slugs (parametrized)
    - `test_terms_circle_occurs_on_index_migration.py`: after upgrade, `ix_terms_circle_group_id_occurs_on` exists on `terms(circle_group_id, occurs_on)`, and downgrade to 0052 drops it. Follow the precedent in `test_organization_page_layout_migration.py`.
  - [x] 1.2 Add `Index("ix_terms_circle_group_id_occurs_on", "circle_group_id", "occurs_on")` to `Term.__table_args__` in `app/groups/models.py`. Keep the existing `ix_terms_circle_group_id`.
  - [x] 1.3 Create `alembic/versions/0053_terms_circle_occurs_on_index.py`
    - `revision = "0053"`, `down_revision = "0052"`
    - `upgrade` runs `op.create_index(...)` and `downgrade` runs `op.drop_index(...)`
    - The docstring explains the rationale: upcoming-term queries filter on `circle_group_id IN (…)` and `occurs_on >= now`, and the LATERAL next-term lookup depends on this index
    - Check that `alembic revision --autogenerate` would produce no diff
  - [x] 1.4 Add `"access"`, `"terms"` and `"terminy"` to `RESERVED_SLUGS` in `app/organizations/slugs.py`. The comments name the backend sub-paths under `/public/organizers/{slug}` and the frontend route `/:slug/terminy`.
  - [x] 1.5 Insert the PUBLIC row `GET ^/api/groups/public/organizers/[^/]+(/terms)?$` immediately before the existing `^/api/groups/public/[^/]+$` row (about l.86) in `app/core/authorization_matrix.py`. Add a comment explaining why it sits ahead of the `/public/[^/]+/access` row and row 26 (first match wins).
  - [x] 1.6 Update `.maister/docs/standards/backend/security.md` (L-2)
    - New location wording: "The matrix lives only in `app/core/authorization_matrix.py`. It is a reference table verified by tests (`resolve_requirement` is used only in `tests/test_authorization_matrix.py`). Each route enforces its row through `Depends(require_any(...))`, or through no dependency for PUBLIC rows."
    - Remove the "25 entries" claim and any statement that `auth_deps.py` re-exports the matrix
    - Document the new PUBLIC row and why it is placed where it is
  - [x] 1.7 Ensure the group tests pass
    - `uv run python -m pytest tests/test_authorization_matrix.py tests/test_organizations.py tests/test_terms_circle_occurs_on_index_migration.py -q` (only the new tests plus their files)

**Acceptance Criteria:**
- The 6 tests pass
- Migration 0053 is reversible, and the model and migration agree (no autogenerate drift)
- The matrix row is ordered before the generic `/public/{id}` rows. All existing matrix tests still pass.
- `PAGE_LAYOUT_KEYS` is NOT touched in this group

---

### Task Group 2: Cross-module ACL, bridges & query-count helper
**Dependencies:** None
**Files to Modify:** src/backend/app/organizations/service.py, src/backend/app/groups/infrastructure/organizations_acl.py, src/backend/app/groups/infrastructure/circulation_bridge.py, src/backend/app/circulation/service.py, src/backend/app/circulation/application/inventory_items.py, src/backend/app/circulation/infrastructure/repository.py, src/backend/app/groups/infrastructure/product_bridge.py, src/backend/app/product/service.py, src/backend/app/product/infrastructure/repository.py, src/backend/tests/conftest.py, src/backend/tests/test_organizer_bridges.py
**Estimated Steps:** 6

- [x] 2.0 Complete ACL and bridge layer
  - [x] 2.1 Write 5 focused tests in `tests/test_organizer_bridges.py`, seeded through `db_session` following `test_term_item_listings.py` and `test_product_photos.py`
    - `get_owner_party_id` returns the OWNER role's party for an organization, and returns `None` when the owner `OrganizationMembership.valid_to` is set
    - `list_available_items_with_product` returns `{item_id: AvailableItemView(item_id, product_id, product_name, condition)}` only for non-deleted items with an AVAILABLE balance, and issues 0 statements for empty input
    - `first_approved_photo_by_product` returns the APPROVED photo with the lowest `sort_order` per product, ignores non-APPROVED photos, and issues 0 statements for empty input
    - `count_queries` collects statements and ignores `SAVEPOINT` / `RELEASE` / `ROLLBACK TO`
  - [x] 2.2 Add `get_owner_party_id(db, organization_id) -> uuid.UUID | None` to `app/organizations/service.py`
    - Select `OrganizationRole.party_id` joined to `OrganizationMembership` on `from_role_id`, with `to_organization_id = id`, `role_type = OWNER` and `valid_to IS NULL`
    - This is the reverse of `get_own_organization` (l.77)
    - Expose `get_organization_by_slug` and `get_owner_party_id` as pass-throughs in `groups/infrastructure/organizations_acl.py` (`__all__` and docstring)
  - [x] 2.3 Add `list_available_items_with_product(db, item_ids)`
    - Implement it in the circulation repository and application (`inventory_items.py`): one join of `InventoryItem` → `InventoryBalance` (AVAILABLE) → `Product`, with `deleted_at IS NULL` and `item_id IN (…)`
    - Re-export it from `app/circulation/service.py` and pass it through `groups/infrastructure/circulation_bridge.py`
    - `AvailableItemView` is a NamedTuple or dataclass
    - Return early on empty input
  - [x] 2.4 Add `first_approved_photo_by_product(db, product_ids) -> dict[product_id, ProductPhoto]`
    - In the product module (service plus repository, wherever existing photo queries live): `DISTINCT ON (product_id)` with `status = APPROVED`, ordered by `product_id, sort_order, id`
    - Expose it through `groups/infrastructure/product_bridge.py`, following the `product_ids_with_unmoderated_photos` early-return pattern
  - [x] 2.5 Add the `count_queries(engine)` context manager to `tests/conftest.py`
    - Use a `before_cursor_execute` listener on `engine.sync_engine` that collects statement texts and skips savepoint statements
    - Remove the listener in `finally`
  - [x] 2.6 Ensure the group tests pass: `uv run python -m pytest tests/test_organizer_bridges.py -q`

**Acceptance Criteria:**
- The 5 tests pass
- Cross-module access goes only through the ACL and bridge modules (`standards/backend/models.md`)
- No presigned URLs. Photo resolution returns entities only, and URL building happens in the application layer.

---

### Task Group 3: Organizer page read model (`GET /api/groups/public/organizers/{slug}`)
**Dependencies:** 1, 2
**Files to Modify:** src/backend/app/groups/schemas.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/application/organizer_page.py, src/backend/app/groups/router/organizer_page.py, src/backend/app/groups/router/__init__.py, src/backend/app/groups/service.py, src/backend/tests/test_organizer_page.py
**Estimated Steps:** 7

- [x] 3.0 Complete the main read-model endpoint
  - [x] 3.1 Write 8 focused tests in `tests/test_organizer_page.py`, using HTTP builders from `test_public_term.py` plus `db_session` seeding and `fake_storage`
    1. Directory shape matches the contract, and a recursive walk finds no forbidden key (`display_name`, `lister_party_id`, `lister_display_name`, `party_id`, `claimed_by_name`, `claimed_by_party_id`, `guardians`, `organizer_display_name`)
    2. PRIVATE circles and circles with a revoked `GroupRole` or `Leadership` are excluded from every field
    3. 404 cases and the empty case:
       - 404 for an unknown slug, a `k-…` pseudo-slug and an organization without an active owner
       - `GET /api/groups/public/organizers/access` is answered by the organizer route (404 envelope, not the `/access` route)
       - an owner without circles gets a 200 with empty arrays, zero counts and `family_count: null`
    4. Time window: past and 60-day-plus terms are excluded from `upcoming_terms` and `upcoming_term_count` but a 60-day-plus term still appears as `next_term`
    5. `family_count`: null with 2 families, 3 with 3 families, and the owner's family is excluded
    6. Exchange eligibility:
       - only listings by eligible listers count (active attendees plus the owner; a withdrawn attendee's item is excluded)
       - AVAILABLE only, deduplicated to the nearest term
       - `counts` per mode are always 3 keys
    7. `thumb_url` is `https://cdn.test/…` only from an APPROVED photo (lowest `sort_order`), and null when the photo is not approved or storage is unconfigured
    8. `needed_items` carries a `claimed` flag (a pledge not WITHDRAWN), excludes deleted items, and exposes no names
  - [x] 3.2 Add the Pydantic schemas to `app/groups/schemas.py`: `OrganizerNextTermResponse`, `OrganizerCircleResponse`, `OrganizerTermResponse`, `OrganizerExchangeCounts` (GIFT/SWAP/LEND, all present), `OrganizerExchangeItemResponse`, `OrganizerExchangeResponse`, `OrganizerNeededItemResponse`, `OrganizerStatsResponse` and `OrganizerPageResponse`. Use explicit allowlisted fields only.
  - [x] 3.3 Add `list_owner_public_circles(db, owner_party_id, now, window_end, limit=30)` to `app/groups/infrastructure/repository.py` (statement 3)
    - Joins and filters:
      - `Leadership` with `valid_to IS NULL`
      - `GroupRole` with ORGANIZATOR, `party_id = owner` and `valid_to IS NULL`
      - `visibility = PUBLIC`
    - Next term: `LEFT JOIN LATERAL (… WHERE circle_group_id = groups.id AND occurs_on >= :now ORDER BY occurs_on, id LIMIT 1)` via `.lateral()` and `outerjoin(..., true())`
    - A correlated window-count subquery
    - `ORDER BY next_occurs_on NULLS LAST, name, id LIMIT 30`
    - An unscoped `DISTINCT ON` over terms is forbidden. `now` is always a bound parameter, never `func.now()` or `utcnow`.
  - [x] 3.4 Add the remaining batched repository queries (statements 4–8)
    - `list_upcoming_terms_for_groups(db, group_ids, now, window_end, limit=10)` (joins `Group` for `group_name`)
    - `count_member_families_for_groups(db, group_ids, exclude_party_id)`: `COUNT(DISTINCT to_family_id)` over Membership → GroupRole.party_id → FamilyRole → FamilyMembership, excluding the owner's families through a subquery. Import `families.models` as in `exchange_summary.py`.
    - `list_needed_items_with_product_for_terms(db, term_ids)`: the `.in_()` sibling of l.278, with a `claimed` EXISTS over a Pledge whose status is not WITHDRAWN, and `deleted_at IS NULL`
    - `list_active_attendee_parties_for_terms(db, term_ids)`
    - Reuse `count_active_attendances_by_term` (l.373) and `list_item_listing_preferences_for_parties` (l.472)
  - [x] 3.5 Create `app/groups/application/organizer_page.py` with `get_organizer_page(db, slug, storage)`
    - `_resolve_owner(db, slug)` raises `EntityNotFoundException` when either lookup returns `None`. There is NO `k-` prefix check (L-3).
    - Bind `now = datetime.now()` (naive, server local) and `window_end = now + 60 days`
    - When the circle list is empty, return the empty response early (skip statements 4–11)
    - Skip conditional statements 7, 9, 10 and 11 when their inputs are empty, or when storage is `None` for statement 11
    - Python assembly:
      - `eligible[term] = {owner} ∪ attendees`
      - the candidate term is the earliest eligible next term
      - dedup by `item_id` (ties broken by `term_id`), then counts over the full set
      - sort by `occurs_on, product_name, item_id`, slice to 12, then `thumb_url = storage.public_url(photo.thumb_key)` (photos looked up only for the 12)
    - Stats: `circle_count = len(circles)`, `upcoming_term_count` as the sum, `family_count` null below 3
    - Do not use any per-item helpers from `term_item_listings.py`
  - [x] 3.6 Wire the route
    - Create `app/groups/router/organizer_page.py` with `GET /api/groups/public/organizers/{slug}`
      - no auth dependency
      - the docstring names its matrix row
      - dependencies `DbSession` and `Storage = Annotated[ObjectStorage | None, Depends(get_storage)]` (pattern from `app/product/router.py:42`)
    - Include it FIRST in `app/groups/router/__init__.py`, with a comment on the `/public/{group_id}/access` collision
    - Re-export `get_organizer_page` from `app/groups/service.py`
  - [x] 3.7 Ensure the group tests pass: `uv run python -m pytest tests/test_organizer_page.py -q`

**Acceptance Criteria:**
- The 8 tests pass
- Response bodies come only from the explicit schemas. No forbidden key appears.
- The repository uses only bound parameters, explicit ordering and SQL-level LIMIT (`standards/backend/queries.md`, `jooq.md`)

---

### Task Group 4: Organizer terms endpoint & query-count budgets
**Dependencies:** 3
**Files to Modify:** src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/application/organizer_page.py, src/backend/app/groups/router/organizer_page.py, src/backend/app/groups/service.py, src/backend/tests/test_organizer_terms.py, src/backend/tests/test_organizer_page_queries.py
**Estimated Steps:** 5

- [x] 4.0 Complete `/terms` and the statement-count guarantees
  - [x] 4.1 Write 6 focused tests
    - `tests/test_organizer_terms.py`:
      1. All future terms (beyond 60 days too) ordered by `occurs_on ASC, id ASC`, with correct `{items, total, page, size}` across 2 pages
      2. A `group_id` of a foreign or non-qualifying circle gives a 200 with `{items: [], total: 0}`, and a qualifying `group_id` narrows the result
      3. A non-UUID `group_id`, `size=101` and `page=0` each give 400 (app `RequestValidationError` convention)
      4. An unknown slug gives 404
    - `tests/test_organizer_page_queries.py`:
      5. Main endpoint: with each circle seeded with a term, an attendee, a listed item with an approved photo and a needed item, `count(1 circle) == count(5 circles)` and `≤ 12`
      6. `/terms`: the statement count is equal for 1 vs 5 circles and for 1 vs 25 terms (≤ 5)
  - [x] 4.2 Add `_owner_public_terms_select(owner_party_id, now, group_id)` to the repository. It reuses the qualifying-circle join from statement 3 with no circle limit, plus `occurs_on >= now` and the optional `Group.id = group_id`. Build `count_owner_public_terms` and `list_owner_public_terms_page` (with `Group.name`, `ORDER BY occurs_on, id`, `OFFSET`/`LIMIT`) on top of it.
  - [x] 4.3 Add `list_organizer_terms(db, slug, params, group_id)` in `application/organizer_page.py`. It uses `_resolve_owner`, count, page, then `count_active_attendances_by_term`, which is skipped for an empty page. Return `Page[OrganizerTermResponse]` and re-export it from `service.py`.
  - [x] 4.4 Add the route `GET /api/groups/public/organizers/{slug}/terms` with `Pagination` and `group_id: uuid.UUID | None = None`. Confirm that invalid values produce 400, not 422.
  - [x] 4.5 Ensure the group tests pass: `uv run python -m pytest tests/test_organizer_terms.py tests/test_organizer_page_queries.py -q`

**Acceptance Criteria:**
- The 6 tests pass
- Main endpoint ≤ 12 statements, constant for 1 vs 5 circles. `/terms` ≤ 5 statements, constant.
- Pagination is enforced in SQL

---

### Task Group 5: Term-page `thumb_url` on `/public/{id}` and `/public/{id}/access`
**Dependencies:** 2, 4 (4 because of the shared `schemas.py` and `test_organizer_page_queries.py`)
**Files to Modify:** src/backend/app/groups/schemas.py, src/backend/app/groups/application/public_view.py, src/backend/app/groups/router/circles.py, src/backend/tests/test_organizer_page_queries.py
**Estimated Steps:** 5

- [x] 5.0 Complete the term-page thumbnail backend
  - [x] 5.1 Write 3 focused tests, appended to `tests/test_organizer_page_queries.py`
    - On `GET /api/groups/public/{id}/access`: exactly 1 statement touching `product_photos` for both 1 and 5 listings
    - On `/access`: `thumb_url == "https://cdn.test/…/w400.webp"` for a listing with an APPROVED photo, and `null` for one without
    - On `GET /api/groups/public/{id}`: one assertion that `thumb_url` is present and filled for an APPROVED photo
  - [x] 5.2 Add `thumb_url: str | None = None` to `PublicItemListingResponse` in `schemas.py`. The change is additive and leaves every other field unchanged.
  - [x] 5.3 Update `app/groups/application/public_view.py`
    - `get_public_circle_view(..., storage: ObjectStorage | None = None)`: after `list_public_term_item_listings`, when storage is set and listings exist, call `circulation_bridge.list_available_items_with_product(item_ids)` and then `product_bridge.first_approved_photo_by_product(product_ids)`. That is 2 statements regardless of item count.
    - `get_group_access(..., storage: ObjectStorage | None = None)` passes `storage=storage` into its `get_public_circle_view` call (about l.334)
    - The OG-preview callers in `system/router.py` (l.89, l.104) stay storage-less
  - [x] 5.4 In `app/groups/router/circles.py`, add the `storage: Storage` dependency to BOTH `get_public_circle` and `get_group_access` (about l.132) and pass it through
  - [x] 5.5 Ensure the group tests pass
    - `uv run python -m pytest tests/test_organizer_page_queries.py -q`
    - Run a narrow regression on the modified public views: `uv run python -m pytest tests/test_public_term.py tests/test_term_item_listings_router.py -q`

**Acceptance Criteria:**
- The 3 tests pass. The existing public-term tests still pass.
- No per-item queries are added. Only APPROVED photos are used, through public CDN URLs.

---

### Task Group 6: Backend test review, quality gates & B-backend commit boundary
**Dependencies:** 1, 2, 3, 4, 5
**Files to Modify:** src/backend/tests/test_organizer_page.py, src/backend/tests/test_organizer_terms.py, src/backend/tests/test_organizer_page_queries.py
**Estimated Steps:** 6

- [x] 6.0 Review backend tests and close the commit
  - [x] 6.1 Review the tests from groups 1–5 (28 tests)
  - [x] 6.2 Analyze gaps for this feature only. Candidates:
    - the 30-circle and 10-term limits
    - ordering of `circles` (`NULLS LAST`, then name)
    - the R4 boundary (a term earlier today is excluded)
    - an item listed on two next terms dedups to the earlier one
  - [x] 6.3 Write up to 4 additional strategic tests
  - [x] 6.4 Run the backend feature tests only: `uv run python -m pytest tests/test_organizer_bridges.py tests/test_organizer_page.py tests/test_organizer_terms.py tests/test_organizer_page_queries.py tests/test_authorization_matrix.py tests/test_organizations.py tests/test_terms_circle_occurs_on_index_migration.py tests/test_public_term.py -q`
  - [x] 6.5 Quality gates
    - `uv run ruff check app tests` is clean
    - `uv run python -m mypy app` has an error count ≤ the HEAD baseline (about 32) and no new errors in touched files
    - Confirm that `app/organizations/page_layouts.py` is unchanged
  - [x] 6.6 **COMMIT BOUNDARY: B-backend.** Stop here so the user can commit
    - Record in the work-log the pre-deploy check `SELECT id, slug FROM organizations WHERE slug IN ('access','terms','terminy');`, with a note to tell the user if any row exists before deploying
    - Do not run git commands. The user makes the commit.

**Acceptance Criteria:**
- All backend feature tests pass (about 28–32)
- No more than 4 additional tests
- ruff is clean, and mypy does not rise above the baseline
- The backend changes are ready for the user's B-backend commit

---

# ===================== COMMIT 2: B-frontend =====================

### Task Group 7: Frontend data layer (API types, functions, hooks)
**Dependencies:** 6
**Files to Modify:** src/frontend/src/api/groups.ts, src/frontend/src/hooks/useOrganizerPage.ts, src/frontend/src/hooks/useOrganizerTerms.ts, src/frontend/src/test/useOrganizerPage.test.tsx, src/frontend/src/test/useOrganizerTerms.test.tsx, src/frontend/src/test/TermPage.test.tsx
**Estimated Steps:** 6

- [x] 7.0 Complete the frontend data layer
  - [x] 7.1 Write 5 focused tests (`createQueryWrapper`, `vi.mock("../api/groups")`)
    - `useOrganizerPage.test.tsx`:
      - success returns `data`, `loading` false and `error` null
      - a 404 `ApiError` gives `notFound: true`
    - `useOrganizerTerms.test.tsx`:
      - `fetchNextPage` appends page 2 to the flattened `terms`, and `hasNextPage` turns false at the end
      - changing `groupId` refetches with `group_id` (the key contains `groupId ?? null`)
      - `enabled: false` issues no request
  - [x] 7.2 Update `api/groups.ts`
    - Add `OrganizerNextTerm`, `OrganizerCircle`, `OrganizerTerm`, `ExchangeMode`, `OrganizerExchangeItem`, `OrganizerNeededItem`, `OrganizerStats` and `OrganizerPageResponse` (snake_case, mirroring the backend)
    - `getOrganizerPage(slug)` uses `encodeURIComponent`
    - `getOrganizerTerms(slug, page, groupId?)` uses `pageParams` and returns `Page<OrganizerTerm>`
    - Add `thumb_url: string | null` to `PublicItemListingResponse`
  - [x] 7.3 Grep `src/` for typed `PublicItemListingResponse` / `PublicCircleResponse` literals
    - Add `thumb_url: null` to both listings in `TermPage.test.tsx` (about l.66–84) and to any other typed literal found
    - `as`-cast fixtures need no change
  - [x] 7.4 Add `hooks/useOrganizerPage.ts`
    - `ORGANIZER_PAGE_KEY = "organizerPage"`, key `[ORGANIZER_PAGE_KEY, slug]`
    - Return `{data, loading, notFound, error, refetch}`, copying the `usePublicOrganization` shape and using `hasStatus` from `useTermAttendees`
  - [x] 7.5 Add `hooks/useOrganizerTerms.ts`, the first `useInfiniteQuery`
    - `ORGANIZER_TERMS_KEY = "organizerTerms"`, key `[ORGANIZER_TERMS_KEY, slug, groupId ?? null]`, size 20
    - `initialPageParam: 1`
    - `getNextPageParam: last.page * last.size < last.total ? last.page + 1 : undefined`
    - Return `{terms (stable empty fallback), total, loading, notFound, error, hasNextPage, fetchNextPage, fetchingNextPage, nextPageError}`, plus `refetch` for the retry UIs
    - Optional `enabled` flag, defaulting to true. No invalidation after editor saves.
  - [x] 7.6 Ensure the group tests pass: `npx vitest run src/test/useOrganizerPage.test.tsx src/test/useOrganizerTerms.test.tsx src/test/TermPage.test.tsx`, then `npx tsc -b`

**Acceptance Criteria:**
- The 5 new tests pass, and `TermPage.test.tsx` still passes
- `tsc -b` is clean
- Hooks follow `standards/frontend/data-fetching.md`: prefix-constant keys, stable fallbacks, `error: string | null`

---

### Task Group 8: Layout contract, renderer rules, supporting blocks & page wiring
**Dependencies:** 7
**Files to Modify:** src/frontend/src/pages/organizer/layouts/types.ts, src/frontend/src/pages/organizer/layouts/registry.ts, src/frontend/src/pages/organizer/LayoutRenderer.tsx, src/frontend/src/pages/organizer/PublicOrganizationPage.tsx, src/frontend/src/pages/organizer/PageFrame.tsx, src/frontend/src/pages/organizer/blocks/BlockSkeleton.tsx, src/frontend/src/pages/organizer/blocks/EmptyStateBlock.tsx, src/frontend/src/pages/organizer/blocks/GhostBlock.tsx, src/frontend/src/pages/organizer/blocks/nearestTerm.ts, src/frontend/src/pages/krag/components/termLabels.ts, src/frontend/src/pages/organizer/editor/EditorSheet.tsx, src/frontend/src/pages/organizer/editor/LayoutTab.tsx, src/frontend/src/test/organizerDirectorySupport.test.tsx, src/frontend/src/test/PublicOrganizationPage.test.tsx, src/frontend/src/test/OrganizerEditor.test.tsx, src/frontend/src/test/LayoutRenderer.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:owner-edit-empty
  locator: section "owner-edit-empty" (visitor empty state vs owner ghosts, loading skeletons, directory-unavailable rules)
  acceptance: visitors never see ghosts and the owner never sees EmptyStateBlock; while loading, directory slots show skeletons; when the directory is unavailable, visitors see no directory slots (primary → generic empty state) and the owner sees neutral ghosts; hero, share and footer always render
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:empty-state-visitor
  locator: section "empty-state-visitor"
  acceptance: TermsIcon, title per layout (SCHEDULE/CLASSIC "Brak zaplanowanych zajęć", CIRCLES "Brak grup do pokazania", EXCHANGE "Na razie nic tu nie ma" plus a `<details>` "Jak to działa?", unavailable "Brak informacji do pokazania"), body "Zajrzyj tu wkrótce albo udostępnij stronę znajomym.", ShareButton "Udostępnij stronę"; token classes only, not the Chakra `EmptyState`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:ghost-directory
  locator: section "ghost-directory"
  acceptance: the GHOST_COPY title, body and CTA for all 8 directory blocks per the spec's owner ghost copy table (body ends with "Widzisz to tylko Ty."); the CTA is a `<Link>` with `min-h-[44px]` and a focus ring; the unavailable variant keeps the title, uses the body "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji." and has no CTA
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:block-skeleton
  locator: section "block-skeleton"
  acceptance: pulse bars `bg-line/60 animate-pulse motion-reduce:animate-none`, `aria-hidden`, inside an `aria-busy="true"` container; `rows` and `grid` shapes
**Estimated Steps:** 9

- [x] 8.0 Complete the contract and renderer foundation
  - [x] 8.1 Write 7 focused tests in `organizerDirectorySupport.test.tsx` and `PublicOrganizationPage.test.tsx`
    1. `nearestTerm`:
       - returns `upcoming_terms[0]` when the window is not empty
       - otherwise falls back to the earliest `circles[].next_term` (ties broken by circle id), mapped to the `OrganizerTerm` shape
       - returns `null` when no circle has a next term
    2. `GhostBlock`: a directory ghost renders its title, body and CTA link to the panel route, and the `unavailable` variant renders the neutral body with no link
    3. `EmptyStateBlock`: per-layout copy, the EXCHANGE `<details>`, the unavailable copy, and the Share button
    4. `BlockSkeleton` renders an `aria-busy` container with `aria-hidden` bars for both shapes
    5. `isRecommended` returns false for every layout while `directoryStatus === "loading"`, and LINKS is recommended when the directory is unavailable or has 0 circles
    6. `PublicOrganizationPage`: a rejected `getOrganizerPage` leaves hero, share and footer rendered (`PublicOrganizationPage.test.tsx`)
    7. `PublicOrganizationPage`: the organization payload alone gates first paint, so the hero renders while `getOrganizerPage` is pending
  - [x] 8.2 Extend `layouts/types.ts`
    - add the new `BlockId` union members
    - `BlockSlot.when?: {minCircles?; maxCircles?}`
    - `OrganizerPageData = {organization; directory: OrganizerPageResponse | null; directoryStatus}`
    - `BlockProps.mode: RenderMode`
    - replace `recommended` with `recommendWhen?`
  - [x] 8.3 Add `blocks/nearestTerm.ts`. Add `EXCHANGE_MODE_LABELS = {GIFT: "Oddam", SWAP: "Zamienię", LEND: "Wypożyczę"}` and `EXCHANGE_MODE_TONE` (`bg-primary-soft` / `bg-accent-soft` / `bg-teal-soft` plus foreground classes) to `pages/krag/components/termLabels.ts`. Do not copy `ITEM_MODE_STYLE`.
  - [x] 8.4 Create `BlockSkeleton.tsx` (shape prop `rows | grid`) and `EmptyStateBlock.tsx` (props `layoutKey`, `unavailable?`). Extend `GhostBlock.tsx` with the 8 `GHOST_COPY` entries, the optional `cta: {label, to}`, and the `unavailable` prop. Keep the `about` entry unchanged.
  - [x] 8.5 Update `LayoutRenderer.tsx`
    - Add `BlockDefinition = {Component | null; directory?: true; isEmpty?(data)}` next to `BLOCKS`. `isEmpty` is evaluated only when the directory is ready.
    - Implement the per-slot rule order:
      1. the `when` filter; while loading or unavailable, only the first slot per block id matches
      2. skeleton while loading
      3. unavailable: the visitor skips the slot (primary → generic `EmptyStateBlock`); the owner sees the neutral ghost
      4. `isEmpty`: the visitor skips the slot (primary → the layout's `EmptyStateBlock`); the owner sees the CTA ghost
      5. otherwise render `<Component data variant mode/>`
  - [x] 8.6 In `registry.ts`, replace `recommended` with `recommendWhen` (LINKS: unavailable or 0 circles; CLASSIC: none) and add `isRecommended(layout, data)`. In `EditorSheet.tsx`, add the required `pageData: OrganizerPageData` prop. In `LayoutTab.tsx`, add the `data` prop and use `isRecommended(layout, data)`, keeping the `aria-describedby` badge pattern.
  - [x] 8.7 Extract `PageFrame` and `NotFoundFrame` into `pages/organizer/PageFrame.tsx` and reuse them. In `PublicOrganizationPage.tsx`, call `useOrganizerPage(slug)` and derive `directoryStatus` (pending → `loading`, any error including 404 → `unavailable`, otherwise `ready`). Pass the composed data to `LayoutRenderer` and `pageData` to `EditorSheet`. The organization payload alone gates first paint.
  - [x] 8.8 Keep the existing suites green, as intentionally changed tests
    - Add a file-level `vi.mock("../api/groups", …)` to `PublicOrganizationPage.test.tsx` and `OrganizerEditor.test.tsx`, with `getOrganizerPage` resolved in `beforeEach` with an explicit fixture (after `vi.resetAllMocks()`). No test may fall through to a real request.
    - Adapt `LayoutRenderer.test.tsx`'s static `["LINKS"]` recommended assertion to `isRecommended`. The full layout table comes in group 11.
  - [x] 8.9 Ensure the group tests pass: `npx vitest run src/test/organizerDirectorySupport.test.tsx src/test/PublicOrganizationPage.test.tsx src/test/OrganizerEditor.test.tsx src/test/LayoutRenderer.test.tsx`, then `npx tsc -b`

**Acceptance Criteria:**
- The 7 new tests pass, and the adapted existing suites pass
- Implementation matches every `acceptance` criterion in Visual References above
- A directory error never breaks `/:slug`
- Role tokens only (no hex, no `kg-*`)

---

### Task Group 9: Term directory blocks (stats, upcoming-terms, next-term-cta, agenda + chips)
**Dependencies:** 7, 8
**Files to Modify:** src/frontend/src/pages/organizer/blocks/StatsBlock.tsx, src/frontend/src/pages/organizer/blocks/UpcomingTermsBlock.tsx, src/frontend/src/pages/organizer/blocks/NextTermCtaBlock.tsx, src/frontend/src/pages/organizer/blocks/AgendaBlock.tsx, src/frontend/src/pages/organizer/blocks/AgendaList.tsx, src/frontend/src/pages/organizer/blocks/CircleFilterChips.tsx, src/frontend/src/test/organizerBlocks.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:stats
  locator: section "stats"
  acceptance: `tiles3`; tiles only for `circle_count > 0` ("grupa/grupy/grup"), `upcoming_term_count > 0` ("termin/terminy/terminów w 60 dni") and non-null `family_count` ("rodzina/rodziny/rodzin") via `pluralPl`; `isEmpty` when fewer than 2 tiles
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:upcoming-terms
  locator: section "upcoming-terms"
  acceptance:
    - `list` has the heading "Najbliższe terminy", date-tile rows with the group name and "dd · HH:mm · zapisanych: N" (count omitted at 0), and the footer "Wszystkie terminy (N) →" to `/${slug}/terminy` only when `stats.upcoming_term_count > upcoming_terms.length`
    - an empty window renders one `nearestTerm` row plus "Wszystkie terminy →" without a count
    - `compact` has the heading "Najbliższe spotkania" and at most 3 chips "dd D MMM ›"
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:next-term-cta
  locator: section "next-term-cta"
  acceptance: a card with the eyebrow "NAJBLIŻSZE ZAJĘCIA", a date tile, the group name, "dddd, D MMMM · HH:mm", "zapisanych: N" and the CTA "Zobacz i zapisz się →" linking to `/${slug}/grupa/${group_id}/term/${term_id}`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:agenda
  locator: section "agenda"
  acceptance:
    - the heading "Plan zajęć", with days grouped under `<h3>` uppercase "dddd, D MMMM" (Polish dayjs)
    - each row is one link with the time, group name, "zapisanych N" and a one-line description
    - "Pokaż kolejne terminy" is hidden without a next page
    - a skeleton shows during the first load
    - first-page error: "Nie udało się wczytać terminów." + "Spróbuj ponownie"; next-page error: "Nie udało się wczytać kolejnych terminów." + retry
    - a filtered empty result shows "Brak zaplanowanych zajęć" + "Pokaż wszystkie grupy"
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:circle-filter-chips
  locator: section "agenda" (chip row)
  acceptance: rendered only with ≥2 circles; "Wszystkie" first, then each circle name; `role="radiogroup"` with roving tabindex via `nextIndex`; horizontal scroll without page scroll; touch targets ≥44px
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:block-library
  locator: section "block-library" (shared visual patterns)
  acceptance: serif section headings in `px-6 pt-6`, `rounded-2xl border-line bg-paper` cards, TermPreviewCard-style date tiles
**Estimated Steps:** 7

- [x] 9.0 Complete the term blocks
  - [x] 9.1 Write 8 focused tests in `organizerBlocks.test.tsx` (MemoryRouter + `createQueryWrapper`, `vi.mock("../api/groups")`)
    1. `StatsBlock` renders 3 tiles with Polish plurals, and its `isEmpty` is true with 1 tile
    2. `UpcomingTermsBlock list`: rows link to the term page; "Wszystkie terminy (N)" shows only when N > the row count; an empty window falls back to a `nearestTerm` row and "Wszystkie terminy →"
    3. `UpcomingTermsBlock compact` renders at most 3 chips
    4. `NextTermCtaBlock` renders the date, count and CTA href
    5. `AgendaBlock` groups by day with uppercase Polish headers, and "Pokaż kolejne terminy" fetches page 2 and then disappears
    6. `CircleFilterChips` is a radiogroup, arrow keys move focus, and selecting a circle refetches with `group_id`
    7. `AgendaBlock` first-page error shows the retry text, and clicking "Spróbuj ponownie" refetches
    8. A filtered empty result shows "Brak zaplanowanych zajęć", and "Pokaż wszystkie grupy" resets
  - [x] 9.2 Create `StatsBlock.tsx` (`tiles3`) and export its `isEmpty` predicate (fewer than 2 tiles)
  - [x] 9.3 Create `UpcomingTermsBlock.tsx` (`list` and `compact`, `nearestTerm` fallback; `isEmpty` = `nearestTerm(directory) === null`)
  - [x] 9.4 Create `NextTermCtaBlock.tsx` (`card`; `isEmpty` = `nearestTerm` is null)
  - [x] 9.5 Create the shared `AgendaList.tsx` (day grouping by `YYYY-MM-DD`, row links, dayjs from `utils/dayjs.ts`) and `CircleFilterChips.tsx` (radiogroup, `nextIndex` roving)
  - [x] 9.6 Create `AgendaBlock.tsx` (`by-day`)
    - `useOrganizerTerms(slug, groupId)` with local chip state
    - skeleton, error with retry, next-page error, filtered empty with reset
    - `isEmpty` = every `circles[].next_term` is null
  - [x] 9.7 Ensure the group tests pass: `npx vitest run src/test/organizerBlocks.test.tsx`

**Acceptance Criteria:**
- The 8 tests pass
- Implementation matches every `acceptance` criterion in Visual References above
- Every term link uses `/${slug}/grupa/${group_id}/term/${term_id}`. No names or identities are rendered.

---

### Task Group 10: Circle & exchange directory blocks
**Dependencies:** 7, 8
**Files to Modify:** src/frontend/src/pages/organizer/blocks/CirclesGridBlock.tsx, src/frontend/src/pages/organizer/blocks/CircleVisualMini.tsx, src/frontend/src/pages/organizer/blocks/ExchangeCountsBlock.tsx, src/frontend/src/pages/organizer/blocks/ExchangeBoardBlock.tsx, src/frontend/src/pages/organizer/blocks/ExchangeItemCard.tsx, src/frontend/src/pages/organizer/blocks/NeededItemsBlock.tsx, src/frontend/src/test/organizerCirclesExchangeBlocks.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:circles-grid
  locator: section "circles-grid"
  acceptance:
    - `cards` has the heading "Nasze grupy"; each card shows the name, "zapisanych: N · K terminy" and "nast.: dd D MMM, HH:mm", and links to the next term's page, or to `/${slug}/terminy?group_id=${id}` with "brak zaplanowanych terminów"
    - `featured` has the heading "Nasza grupa"; its card holds CircleVisualMini, the name, the next term, the counts and the CTA "Zobacz zajęcia →" (same target rule)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:circle-visual-mini
  locator: section "circle-visual-mini"
  acceptance:
    - `min(attendee_count, 16)` anonymous seats placed with `getCirclePosition` / `getPitchPosition` / `getTablePosition` by `layout_mode`, a "+N" chip beyond 16, and a center marker
    - `role="img"` with an `aria-label` built by `pluralPl` ("Zapisana 1 rodzina" / "Zapisane 2 rodziny" / "Zapisanych 5 rodzin"), seats `aria-hidden`
    - not rendered at 0 attendees
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:exchange-counts
  locator: section "exchange-counts"
  acceptance:
    - `tiles3` has the heading "Wymiana rzeczy" and 3 tiles Oddam / Zamienię / Wypożyczę in tones `bg-primary-soft` / `bg-accent-soft` / `bg-teal-soft`
    - a tile with count > 0 links to the term page of the first item of that mode, and a tile at 0 is plain
    - the `tabs` variant is delivered as the tab strip inside exchange-board (L-6)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:exchange-board
  locator: section "exchange-board"
  acceptance:
    - `grid2` tabs "Wszystko N", "Oddam N", "Zamienię N", "Wypożyczę N" in a `role="tablist"` with `aria-controls` on the board
    - a tab at 0 is disabled, and the selected tab is `bg-ink text-on-ink`
    - tabs filter `items` on the client
    - the board is a 2-column grid of ≤12 cards with no lister
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:exchange-item-card
  locator: section "exchange-board" (card)
  acceptance: one link to the item's term page; a square `rounded-xl` SafeImage thumb, or PhotoPlaceholder when `thumb_url` is null; the name with `line-clamp-2`; a mode pill (EXCHANGE_MODE_LABELS/TONE) plus `CONDITION_LABELS`; "odbiór: dd D MMM"
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:needed-items
  locator: section "needed-items"
  acceptance:
    - `list` has the heading "Potrzebne na najbliższe zajęcia"; rows show BringsIcon, the product name and "dd D MMM"
    - an open item has a "Zobacz →" link to the term page
    - a claimed item shows a check mark and the "Zapewnione" pill (`bg-primary-soft`), never a name
**Estimated Steps:** 7

- [x] 10.0 Complete the circle and exchange blocks
  - [x] 10.1 Write 7 focused tests in `organizerCirclesExchangeBlocks.test.tsx`
    1. `CirclesGridBlock cards`: a card with a next term links to the term page, and a card without one links to `/${slug}/terminy?group_id=…` with "brak zaplanowanych terminów"
    2. `CirclesGridBlock featured` renders `CircleVisualMini` with 16 seats plus "+4" for 20 attendees and the pluralized aria-label, and renders no visual at 0
    3. `ExchangeCountsBlock`: tiles show the counts, a tile > 0 is a link and a tile at 0 is not
    4. `ExchangeBoardBlock`: a click on "Zamienię" filters the cards to SWAP, a 0-count tab is disabled, and the tablist semantics are present
    5. `ExchangeItemCard`: the image renders when `thumb_url` is set, the placeholder when it is null, and no lister text appears
    6. `NeededItemsBlock`: an open row has "Zobacz →", and a claimed row has the "Zapewnione" pill with no name
    7. `isEmpty` predicates: circles-grid (empty circles), exchange-counts (sum 0), exchange-board (no items), needed-items (empty)
  - [x] 10.2 Create `CircleVisualMini.tsx`: geometry from `utils/layoutPositions.ts` only, anonymous seats, and it does NOT reuse `GroupVisualization`
  - [x] 10.3 Create `CirclesGridBlock.tsx` (`cards`, `featured`; `isEmpty` = circles empty)
  - [x] 10.4 Create `ExchangeCountsBlock.tsx` (`tiles3`; `isEmpty` = GIFT + SWAP + LEND = 0)
  - [x] 10.5 Create `ExchangeItemCard.tsx` (SafeImage from `pages/product/ItemGallery.tsx`, PhotoPlaceholder) and `ExchangeBoardBlock.tsx` (`grid2` with mode tabs; `isEmpty` = items empty)
  - [x] 10.6 Create `NeededItemsBlock.tsx` (`list`; `isEmpty` = `needed_items` empty)
  - [x] 10.7 Ensure the group tests pass: `npx vitest run src/test/organizerCirclesExchangeBlocks.test.tsx`

**Acceptance Criteria:**
- The 7 tests pass
- Implementation matches every `acceptance` criterion in Visual References above
- SWAP is labelled "Zamienię" everywhere. Role tokens only.

---

### Task Group 11: Layouts, hero compact, LINKS directory buttons, block registration & PAGE_LAYOUT_KEYS
**Dependencies:** 8, 9, 10
**Files to Modify:** src/frontend/src/pages/organizer/blocks/HeroBlock.tsx, src/frontend/src/pages/organizer/blocks/LinkStackBlock.tsx, src/frontend/src/pages/organizer/layouts/registry.ts, src/frontend/src/pages/organizer/LayoutRenderer.tsx, src/frontend/src/assets/layouts/schedule.svg, src/frontend/src/assets/layouts/circles.svg, src/frontend/src/assets/layouts/exchange.svg, src/frontend/src/test/LayoutRenderer.test.tsx, src/backend/app/organizations/page_layouts.py, src/backend/tests/test_organizations.py
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-classic
  locator: section "layout-classic"
  acceptance: order `hero:cover`, `share`, `stats`, `about`, `upcoming-terms:list` (primary), `exchange-counts:tiles3`, `footer`; column frame
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-schedule
  locator: section "layout-schedule"
  acceptance: order `hero:compact`, `next-term-cta:card`, `agenda:by-day` (primary), `about`, `exchange-counts:tiles3`, `footer`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-circles
  locator: section "layout-circles"
  acceptance: order `hero:cover`, `share`, `circles-grid:cards` {minCircles 2, primary} / `circles-grid:featured` {maxCircles 1, primary}, `about`, `exchange-counts:tiles3`, `footer`; exactly one primary is active for 0, 1 and 2+ circles
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-exchange
  locator: section "layout-exchange"
  acceptance: order `hero:compact`, `exchange-board:grid2` (primary, carrying the mode tabs), `needed-items:list`, `upcoming-terms:compact`, `about`, `footer`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-links
  locator: section "layout-links"
  acceptance: centered frame, `hero:centered`, `link-stack` (primary), `about`, `footer`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:link-stack-directory
  locator: section "layout-links" (button stack)
  acceptance:
    - buttons in order:
      1. "Najbliższe zajęcia · dd D.MM HH:mm" from `nearestTerm` (filled `bg-primary`)
      2. "Wszystkie terminy (N)" when `upcoming_term_count > 0`, to `/${slug}/terminy`
      3. "Wymiana rzeczy (N)" when the counts sum to > 0, to the term of `exchange.items[0]`, else the nearest term
      4. "Udostępnij stronę", filled only when it is the only button
    - while loading, 2 skeleton bars above Share
    - when unavailable, Share only
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:hero-compact
  locator: section "layout-schedule" (top bar)
  acceptance: a `bg-paper border-b border-line` bar with a 56px initials avatar, the name, the address and an inline ShareButton (`min-h-[44px]`)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:owner-edit-empty
  locator: section "owner-edit-empty" (per-layout behaviour)
  acceptance: for each new layout, an empty primary gives the layout's EmptyStateBlock + Share for the visitor and the CTA ghost for the owner
**Estimated Steps:** 8

- [x] 11.0 Complete the layouts and registry
  - [x] 11.1 Write 8 focused tests (intentionally changed `LayoutRenderer.test.tsx`, plus 1 backend test)
    1. The registry has 5 keys (CLASSIC, SCHEDULE, CIRCLES, EXCHANGE, LINKS), with labels and thumbnail alt "Szkic układu <label>"
    2. Exactly one active primary for 0, 1 and 2 circles in every layout, with CIRCLES using `featured` at 1 and `cards` at 2
    3. While loading, directory slots render skeletons, with only one per block id for `when` variants
    4. When unavailable, the visitor sees no directory slots (primary → generic empty state + Share) and the owner sees neutral ghosts; hero and footer stay
    5. An empty primary gives the visitor the layout's EmptyStateBlock + Share and the owner the CTA ghost
    6. The `recommendWhen` table (SCHEDULE ≥4 terms in 14 days, CIRCLES ≥2 circles, EXCHANGE ≥4 items, LINKS unavailable or 0 circles, CLASSIC never) replaces the static `["LINKS"]`
    7. `LinkStackBlock` buttons per the ready, loading and unavailable states, and `HeroBlock compact` renders the name and an inline Share (SCHEDULE render)
    8. Backend `test_organizations.py`: PATCH accepts `page_layout: "SCHEDULE"`
  - [x] 11.2 Add the `compact` variant to `HeroBlock.tsx`
  - [x] 11.3 Add the directory buttons and loading/unavailable handling to `LinkStackBlock.tsx`. It is not a renderer directory block, so it handles loading itself.
  - [x] 11.4 Register all 8 directory blocks in the `BLOCKS` map of `LayoutRenderer.tsx` with `directory: true` and their `isEmpty` predicates. `about` stays `{Component: null}`.
  - [x] 11.5 In `registry.ts`, update CLASSIC to the new composition and add SCHEDULE ("Plan zajęć" / "Gdy masz wiele zajęć w tygodniu."), CIRCLES ("Grupy" / "Twoje grupy na jednej stronie.") and EXCHANGE ("Wymiana" / "Tablica rzeczy do oddania i wymiany."), each with `recommendWhen`. LINKS is unchanged apart from its `recommendWhen`.
  - [x] 11.6 Add `assets/layouts/{schedule,circles,exchange}.svg` in the style of `classic.svg` and `links.svg` (same viewBox, neutral strokes)
  - [x] 11.7 Set `PAGE_LAYOUT_KEYS = frozenset({"CLASSIC", "CIRCLES", "EXCHANGE", "LINKS", "SCHEDULE"})` in `src/backend/app/organizations/page_layouts.py`, as a single literal with double quotes. It ships in the frontend commit together with the frontend registry, for the parity test.
  - [x] 11.8 Ensure the group tests pass
    - `npx vitest run src/test/LayoutRenderer.test.tsx src/test/organizerKeyParity.test.ts`
    - `cd src/backend && uv run python -m pytest tests/test_organizations.py -q`

**Acceptance Criteria:**
- The 8 tests pass. `organizerKeyParity.test.ts` passes unchanged with 5 keys.
- Implementation matches every `acceptance` criterion in Visual References above
- Exactly one primary slot is active for any circle count

---

### Task Group 12: Editor data-driven "Polecany" badges
**Dependencies:** 11
**Files to Modify:** src/frontend/src/pages/organizer/editor/LayoutTab.tsx, src/frontend/src/test/OrganizerEditor.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:editor-layout-tab
  locator: section "editor-layout-tab"
  acceptance: 5 layout cards in the existing 2-column grid, each with its SVG thumbnail and label; several "Polecany" pills can show at once
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:layout-card-badge
  locator: section "editor-layout-tab" (card badge)
  acceptance: the "Polecany" pill comes from `isRecommended(layout, data)` and is linked through `aria-describedby`; no badge at all while the directory is loading
**Estimated Steps:** 3

- [x] 12.0 Complete the editor badges
  - [x] 12.1 Write 4 focused tests in `OrganizerEditor.test.tsx` (about l.241), asserted explicitly from fixture data
    1. With ≥2 circles and ≥4 terms within 14 days, both "Plan zajęć" and "Grupy" are Polecany, and all 5 cards render
    2. With 0 circles, only "Wizytówka" is Polecany
    3. With a pending `getOrganizerPage`, no badge appears
    4. With a rejected `getOrganizerPage`, only "Wizytówka" is Polecany
  - [x] 12.2 Verify and finish `LayoutTab.tsx`: 5 cards in the 2-column grid, badges only through `isRecommended`, the `aria-describedby` pattern intact, and the thumbnail alt text. Adjust only what the tests reveal.
  - [x] 12.3 Ensure the group tests pass: `npx vitest run src/test/OrganizerEditor.test.tsx`

**Acceptance Criteria:**
- The 4 tests pass
- Implementation matches every `acceptance` criterion in Visual References above

---

### Task Group 13: `/:slug/terminy` page (OrganizerTermsPage)
**Dependencies:** 7, 8, 9
**Files to Modify:** src/frontend/src/pages/organizer/OrganizerTermsPage.tsx, src/frontend/src/router.tsx, src/frontend/src/test/OrganizerTermsPage.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:organizer-terms
  locator: section "screen-terminy"
  acceptance:
    - inside OrganizerThemeScope and PageFrame: a back link "‹ <name>" to `/${slug}` (`min-h-[44px]`), the `<h1>` "Wszystkie terminy", and "N zaplanowanych" (`pluralPl`)
    - chips when there are ≥2 circles, then AgendaList, then "Pokaż więcej" (disabled "Wczytywanie…" while fetching, hidden without a next page), an `aria-live="polite"` region "Wczytano N kolejnych terminów", and FooterBlock
    - states: a skeleton on first load; empty "Brak zaplanowanych zajęć" (+ "Pokaż wszystkie grupy" when a chip is active); NotFoundFrame on a 404; first-page and next-page error texts with "Spróbuj ponownie"
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:agenda
  locator: section "agenda" (shared AgendaList)
  acceptance: the same day grouping and row format as AgendaBlock, through the shared `AgendaList`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:circle-filter-chips
  locator: section "agenda" (chip row)
  acceptance: the chip selection syncs to the `group_id` search parameter with `replace`; only `group_id` values in `directory.circles[].id` are honored
**Estimated Steps:** 5

- [x] 13.0 Complete the agenda page
  - [x] 13.1 Write 7 focused tests in `OrganizerTermsPage.test.tsx` (MemoryRouter with initial entries, `vi.mock("../api/groups")`)
    1. Renders the back link, the heading, the "N zaplanowanych" count and the terms grouped by day, in the organizer theme
    2. Selecting a chip refetches with `group_id` and updates the URL
    3. A valid `?group_id=` preselects the chip and waits for the directory before requesting terms; an unknown or malformed value falls back to "Wszystkie" and is dropped from the URL
    4. "Pokaż więcej" loads page 2, shows "Wczytywanie…" while fetching, announces "Wczytano N kolejnych terminów", and is hidden at the end
    5. The empty state shows "Brak zaplanowanych zajęć", and with a chip active, "Pokaż wszystkie grupy" resets it
    6. An organization 404 or terms 404 renders NotFoundFrame
    7. A first-page 5xx shows "Nie udało się wczytać terminów." and "Spróbuj ponownie" refetches
  - [x] 13.2 Add `{ path: "/:organizationSlug/terminy", element: <OrganizerTermsPage /> }` to `router.tsx`, before the `/:organizationSlug` catch-all, with no AuthGuard and a comment that `terminy` is in `RESERVED_SLUGS`
  - [x] 13.3 Data in `OrganizerTermsPage.tsx`
    - `usePublicOrganization`, `useOrganizerPage` and `useOrganizerTerms(slug, groupId, {enabled})`
    - Sanitize `group_id` (M-5): use it only when it matches `circles[].id`. While a parameter is present and the directory is unresolved, keep `enabled: false`. An invalid value or an unavailable directory means "Wszystkie", and the value is removed from the URL with `replace`.
  - [x] 13.4 Render: PageFrame / NotFoundFrame from `PageFrame.tsx`, CircleFilterChips, AgendaList, BlockSkeleton, the load-more button, the aria-live region, FooterBlock and all error states
  - [x] 13.5 Ensure the group tests pass: `npx vitest run src/test/OrganizerTermsPage.test.tsx`

**Acceptance Criteria:**
- The 7 tests pass
- Implementation matches every `acceptance` criterion in Visual References above
- The UI never sends an unvalidated `group_id`

---

### Task Group 14: Term-page listing thumbnail
**Dependencies:** 7
**Files to Modify:** src/frontend/src/pages/krag/components/termSectionTypes.ts, src/frontend/src/pages/krag/components/AttendeeList.tsx, src/frontend/src/pages/krag/PublicTermView.tsx, src/frontend/src/test/listingThumb.test.tsx
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:term-page-listing-thumb
  locator: section "term-page-thumbnail" (before/after ListingRow)
  acceptance: in PublicTermView, each listing row shows the thumbnail left of the item link (`flex gap-3`); private rows are unchanged
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:listing-thumb
  locator: section "term-page-thumbnail" (thumb tile)
  acceptance: a 48×48 `rounded-xl shrink-0 bg-cream` tile rendered only when `thumbUrl !== undefined`; SafeImage with `alt=""` and `placeholderSize={20}`, or PhotoPlaceholder when it is null; placed outside the item link
**Estimated Steps:** 5

- [x] 14.0 Complete the listing thumbnail
  - [x] 14.1 Write 3 focused tests in `listingThumb.test.tsx` (render `AttendeeList` / `PublicTermView` rows)
    1. `thumb_url` set: an img with `alt=""` is rendered inside a 48px tile next to the item link
    2. `thumb_url: null`: the PhotoPlaceholder tile is rendered
    3. `thumbUrl` undefined (private row): no tile is rendered
  - [x] 14.2 Add `thumbUrl?: string | null` to `ListingRowVM` in `termSectionTypes.ts`
  - [x] 14.3 Render the tile in `ListingRow` (`AttendeeList.tsx`) only when `thumbUrl !== undefined`
  - [x] 14.4 Set `thumbUrl: listing.thumb_url` in `PublicTermView.toListingRow` only
  - [x] 14.5 Ensure the group tests pass: `npx vitest run src/test/listingThumb.test.tsx src/test/TermPage.test.tsx`

**Acceptance Criteria:**
- The 3 tests pass, and `TermPage.test.tsx` still passes
- Implementation matches every `acceptance` criterion in Visual References above

---

### Task Group 15: Frontend test review, theme-token lists & B-frontend commit boundary
**Dependencies:** 7, 8, 9, 10, 11, 12, 13, 14
**Files to Modify:** src/frontend/src/test/themeTokenUsage.test.tsx, src/frontend/src/test/themeDefects.test.tsx, src/frontend/src/test/organizerBlocks.test.tsx, src/frontend/src/test/organizerCirclesExchangeBlocks.test.tsx, src/frontend/src/test/OrganizerTermsPage.test.tsx, src/frontend/src/test/LayoutRenderer.test.tsx
**Estimated Steps:** 6

- [x] 15.0 Review the frontend tests and close the commit
  - [x] 15.1 Review the tests from groups 7–14 (49 new or changed tests)
  - [x] 15.2 Add every new file to the file lists in `themeTokenUsage.test.tsx`, and in `themeDefects.test.tsx` where it lists files
    - all new blocks: StatsBlock, UpcomingTermsBlock, NextTermCtaBlock, AgendaBlock, AgendaList, CircleFilterChips, CirclesGridBlock, CircleVisualMini, ExchangeCountsBlock, ExchangeBoardBlock, ExchangeItemCard, NeededItemsBlock, EmptyStateBlock, BlockSkeleton
    - `nearestTerm.ts`, `PageFrame.tsx` and `OrganizerTermsPage.tsx`
    - `pages/krag/components/termLabels.ts`, if it is not already covered
  - [x] 15.3 Analyze gaps for this feature only. Candidates:
    - forbidden identity text absent from a full CLASSIC render
    - SCHEDULE "Pokaż kolejne terminy" through the full renderer
    - the EXCHANGE tile link target
  - [x] 15.4 Write up to 6 additional strategic tests
  - [x] 15.5 Run the feature tests only: `npx vitest run src/test/useOrganizerPage.test.tsx src/test/useOrganizerTerms.test.tsx src/test/organizerDirectorySupport.test.tsx src/test/organizerBlocks.test.tsx src/test/organizerCirclesExchangeBlocks.test.tsx src/test/LayoutRenderer.test.tsx src/test/OrganizerEditor.test.tsx src/test/PublicOrganizationPage.test.tsx src/test/OrganizerTermsPage.test.tsx src/test/listingThumb.test.tsx src/test/TermPage.test.tsx src/test/organizerKeyParity.test.ts src/test/themeTokenUsage.test.tsx src/test/themeDefects.test.tsx`
  - [x] 15.6 Quality gates and the **COMMIT BOUNDARY: B-frontend**
    - `npx tsc -b` and `npm run lint` are clean
    - `uv run python -m pytest tests/test_organizations.py -q` passes (the `PAGE_LAYOUT_KEYS` change)
    - Stop so the user can commit. Do not run git commands.

**Acceptance Criteria:**
- All frontend feature tests pass (about 55–61), and the parity and theme-token tests pass
- No more than 6 additional tests
- The frontend changes, including `page_layouts.py`, are ready for the user's B-frontend commit

---

## Execution Order

**Commit 1 — B-backend**
1. Group 1: Migration, slugs & matrix (7 steps). Can run in parallel with Group 2.
2. Group 2: ACL, bridges & `count_queries` (6 steps). Can run in parallel with Group 1.
3. Group 3: Organizer page read model (7 steps, depends on 1 and 2)
4. Group 4: `/terms` & query budgets (5 steps, depends on 3)
5. Group 5: Term-page `thumb_url` backend (5 steps, depends on 2 and 4)
6. Group 6: Backend review & gates, then the **commit boundary** (6 steps, depends on 1–5)

**Commit 2 — B-frontend** (starts only after the Group 6 boundary)
7. Group 7: Frontend data layer (6 steps, depends on 6)
8. Group 8: Contract, renderer & page wiring (9 steps, depends on 7)
9. Group 9: Term blocks (7 steps, depends on 7 and 8). Can run in parallel with Groups 10 and 14.
10. Group 10: Circle & exchange blocks (7 steps, depends on 7 and 8). Can run in parallel with Groups 9 and 14.
11. Group 14: Term-page listing thumbnail (5 steps, depends on 7). Can run in parallel from Group 8 onward.
12. Group 11: Layouts, hero compact, LINKS & `PAGE_LAYOUT_KEYS` (8 steps, depends on 8, 9 and 10)
13. Group 13: `/:slug/terminy` (5 steps, depends on 7, 8 and 9). Can run in parallel with Groups 10 and 11.
14. Group 12: Editor badges (3 steps, depends on 11)
15. Group 15: Frontend review & gates, then the **commit boundary** (6 steps, depends on 7–14)

Files shared between groups (the executor runs these groups one after another):
- `schemas.py` and `test_organizer_page_queries.py`: Groups 3, 4, 5 and 6
- `test_organizations.py`: Groups 1 and 11
- `registry.ts`, `LayoutRenderer.tsx` and `LayoutRenderer.test.tsx`: Groups 8 and 11
- `LayoutTab.tsx` and `OrganizerEditor.test.tsx`: Groups 8 and 12

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`
  - minimal-implementation: only the items under "Explicitly not built" are excluded; no `BlockSlot.props`, variants registry, `hero:color` or `circle-visual` block id
  - error-handling and validation: 400 via `RequestValidationError`, `EntityNotFoundException` → 404
  - conventions, coding-style, commenting
- `backend/`
  - api.md: RESTful GET, pagination envelope
  - queries.md and jooq.md: bound `now`, no N+1, explicit ORDER BY, SQL LIMIT, EXISTS for `claimed`
  - models.md: ACL and bridges only; `Index` on the model
  - migrations.md: small and reversible, 0053
  - security.md: PUBLIC row ordering with a comment; updated in Group 1
- `frontend/`
  - data-fetching.md: hooks in `src/hooks`, prefix keys, dayjs from `utils/dayjs.ts`
  - components.md: one block per file
  - css.md: role tokens only, no hex or `kg-*`
  - accessibility.md: radiogroup, tablist, `aria-live`, `aria-busy`, `role="img"`, 44px targets
  - responsive.md: 430px column, chip scroll
- `testing/`
  - frontend-testing.md: `src/test/`, `vi.mock` factories, `createQueryWrapper`, `vi.resetAllMocks`
  - backend testing: follow the actual pytest conventions in `src/backend/tests`, not the outdated Spring text

## Notes

- **Test-driven:** each group starts with 2–8 tests.
- **Run incrementally:** after each group, run only that group's tests (plus the narrowly listed regression files).
- **Mark progress:** check off steps as they are completed.
- **Reuse first:** `count_active_attendances_by_term`, `list_item_listing_preferences_for_parties`, `Pagination`/`Page`, `usePublicOrganization` shape, `hasStatus`, `nextIndex`, `SafeImage`, `PhotoPlaceholder`, `layoutPositions`, `CONDITION_LABELS`, `pluralPl`, `utils/dayjs.ts`, `OrganizerThemeScope`, `ShareButton`, `FooterBlock`.
- **Commit split (I-10):** the backend groups (1–6) finish before any frontend group. `PAGE_LAYOUT_KEYS` changes only in Group 11, inside the frontend commit. The user makes both commits, and the executor only stops at the boundaries.
- **Migration numbering:** this task takes 0053. Task C must use 0054 or later.
- **mypy baseline:** about 32 errors at HEAD. Invoke it as `uv run python -m mypy app`.
