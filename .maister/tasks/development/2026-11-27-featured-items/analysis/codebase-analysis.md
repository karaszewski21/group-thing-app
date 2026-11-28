# Codebase Analysis Report

**Date**: 2026-11-27
**Task**: Featured items (wyróżnione rzeczy) per owner party
**Description**: An owner marks some of their own listed items as featured; the max number of featured items per owner is configurable from the admin panel (default 3 for now); featured items get their own badge; on term pages and event pages featured items appear first on the list.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis (data flow & ordering), Pattern Mining)

---

## TL;DR
- Nothing like "featured" exists yet. The natural home is the `item_listing_preferences` row (one per listed item, joined by every public list, deleted on unlist and on GIFT/SWAP hand-over, so the flag clears itself).
- The per-owner cap has a direct precedent: `max_points_offers` on the singleton `points_config` + `_count_other_points_offers` + a Polish 409, all reachable from groups only via `groups/infrastructure/points_acl.py`.
- "Featured first" touches three server orderings (term SQL, event window function, owner items page) **and** the frontend `termViewModel.ts`, which re-sorts term items newest-first and slices to 3, so it would undo a server-side order.
- Effort: moderate (about 25 files across both stacks, one migration 0110), risk medium-low (additive column, existing locking and cap patterns, but many exact key-set tests to update).

## Key Decisions
- **Store the flag as `featured_at` (nullable naive-UTC timestamp) on `item_listing_preferences`**. It gives a stable "most recently featured first" order, clears itself when the listing row is deleted, and every public list already joins the row.
- **Put the cap in `points_config.max_featured_items` (default 3)** and reuse the admin Points page, the `_INTEGER_FIELDS` validation and the `updated_at` 409. It is the only admin settings table. A generic settings table would be a speculative abstraction (minimal-implementation standard). The cost is that a non-points setting sits on a "points" table.
- **Use a dedicated `PUT /api/item-listing-preferences/{item_id}/featured {featured: bool}`**. Matrix row 60 (`(/.*)?`, EDIT) already covers it. Folding the flag into the full-replace preference PUT would make every mode or visibility save carry and re-validate the flag.
- **Serialise the cap by locking the owner's Party row** (`media/service.py::_lock_owner` precedent), then the preference row `FOR UPDATE`. Count the owner's other featured rows, excluding this item, so re-saving is idempotent.
- **Sort in SQL, plus the one existing frontend re-sort** (`termViewModel.ts`). No sorting in Python (fixed-statement-count convention). Search ordering stays as it is.

## Open Questions / Risks
- **Lowering the admin limit**: should existing extras keep their flag (the precedent: `max_points_offers` does not un-list) or be trimmed? Recommendation: keep them and block new ones.
- **PRIVATE listings**: may they be featured? They are hidden from guests, so a featured PRIVATE item only shows to members of a shared private group. Probably allowed, with no special rule.
- **Owner items page and profile/organization layouts** share `list_owner_listed_items_page`. Ordering featured-first there is cheap but not requested. It needs a product decision.
- **Should the flag survive unlist/relist?** On the preference row it does not. That is likely intended, but confirm.
- **Event preview limit of 3 vs a cap of 3**: with the featured key first in the window, featured items fill the 3-slot preview. A cap above 3 means some featured items fall into "Pokaż więcej".
- **Cache**: anonymous public responses use `s-maxage=60`, so guests may see a toggle up to 60 s late. This is acceptable and matches the existing behaviour.
- **Exact key-set tests** in about 7 backend test files need updating. Missing one gives red tests, not silent bugs.
- **Lock-order interaction** with the POINTS path (owner point account → item → preference). The featured path should be party row → item (ownership) → preference and never take point accounts, so there is no cycle. This should be written down in the spec.

---

## Summary

Listed items are modelled by `ItemListingPreference` (one row per ACTIVE item, owner, mode, visibility, points price). It is the shared join behind the term page, the event page, the owner items pages, search and "Moje rzeczy". The owner write path, the per-owner offer cap, the admin integer config, the badge pills and the per-item toggle UI all have close, recent precedents from the POINTS-offers work (migration 0109). The feature is therefore mostly pattern replication. The one trap is the term page: the client regroups and re-sorts listings.

---

## Files Identified

### Primary Files (backend)

**src/backend/app/groups/models.py** (554 lines)
- `ItemListingPreference` (l.437-485, table `item_listing_preferences`): item_id unique loose pointer, owner_party_id FK, mode, visibility, points_price + CHECKs (l.453-462). Add `featured_at` here.

**src/backend/app/groups/application/term_item_listings.py** (1388 lines)
- `set_item_listing_preference` (l.216-305): the lock order and re-check, with the 409 `OFFER_CHANGED_MESSAGE`. `_count_other_points_offers` (l.157-170) and `_points_price` (l.173-213) are the cap template. `_my_inventory_item_responses` (l.351-392). `list_public_term_item_listings` (l.663-719). The preference is deleted on unlist (l.259) and in `confirm_transaction` (l.1359). The new `set_item_featured` goes here.

**src/backend/app/groups/infrastructure/repository.py** (1410 lines)
- `_visible_preferences` (l.804-819), `item_listing_preferences_select` (l.857-877; add the column), `with_pending_proposer` (l.973), `list_listed_items_for_parties` (l.1001-1037, ORDER BY created_at, item_id, at l.1035), `_owner_listed_items` / `list_owner_listed_items_page` (l.1234-1299, ORDER at l.1295), `_my_items` / `list_my_items` (l.908-970), `lock_item_listing_preference` (l.790).

**src/backend/app/groups/router/term_item_listings.py**
- PUT `/api/item-listing-preferences/{item_id}` (l.46-56, EditPrincipal). The new `/featured` route goes beside it.

**src/backend/app/groups/schemas.py** (1138 lines)
- `PublicItemListingResponse` (l.438), `SetItemListingPreferenceRequest` (l.760-788), `ItemListingPreferenceResponse` (l.791-801), `MyInventoryItemResponse` (l.804-838), `ItemActionsResponse` (l.991-1010). Add `is_featured` to each.

**src/backend/app/events/page.py** (219 lines)
- `_listed_items_by_party` (l.58-131): `row_number() OVER (PARTITION BY owner_party_id ORDER BY created_at DESC, item_id)` (l.86-91), items_total (l.92), `PREVIEW_ITEM_LIMIT = 3` (l.55). The featured key must come first in the window ORDER BY.

**src/backend/app/events/schemas.py**
- `EventParticipantItemResponse` (l.69-80). Add `is_featured`.

**src/backend/app/points/models.py** (253 lines), **points/application/config.py** (136 lines), **points/schemas.py**, **points/application/pricing.py**, **points/service.py**
- `PointsConfig` (l.222-253). `_INTEGER_FIELDS` (l.18-32), `_validate`, `update_config` (l.117-136). `PointsConfigResponse` (l.15-42), `UpdatePointsConfigRequest` (l.45-71, extra=forbid). Getter `max_points_offers` (pricing.py:23) is re-exported in `service.__all__` (l.14, 46).

**src/backend/app/groups/infrastructure/points_acl.py** (99 lines)
- `max_points_offers` passthrough (l.49-63). Add `max_featured_items`.

**src/backend/alembic/versions/** (latest `0109_points_offers.py`)
- New `0110_featured_items.py`: `featured_at` column, optional partial index `(owner_party_id) WHERE featured_at IS NOT NULL`, `points_config.max_featured_items` NOT NULL with server_default 3 then dropped default (0109 `_CONFIG_COLUMNS` pattern), `SET LOCAL lock_timeout '5s'` (0076 pattern).

### Primary Files (frontend)

**src/frontend/src/features/terms/termViewModel.ts** (56 lines)
- `byNewest` (l.7-11) and `buildAttendees` (l.28-43) group by lister, sort newest and slice to 3. The comparator must put featured items first.

**src/frontend/src/components/shared/ItemTileBadges.tsx** (67 lines)
- The pill row (`PILL_SIZE`, the reserved pill, `PointsPriceLabel`). Add a featured pill, for example "⭐ Wyróżnione", using tokens only.

**src/frontend/src/components/shared/ParticipantItemsPreview.tsx** (88 lines)
- `ItemRow` / `ParticipantPreviewItem`. Pass the featured flag to the badges.

**src/frontend/src/components/shared/ItemCard.tsx** (106 lines)
- The grid tile (OFFER_BADGE l.15-19, CORNER_BADGE l.20-21, `marker` prop l.36, 85). Show the badge on owner, organization and profile pages.

**src/frontend/src/features/items/MyItemsView.tsx** (645 lines) and **features/items/VisibilityToggle.tsx** (51 lines)
- The per-item card (l.420-613) with the chips row, the mode buttons and `VisibilityToggle` (l.572-583) as the model for a new `FeaturedToggle`.

**src/frontend/src/features/panel/AppDataContext.tsx** (837 lines)
- `setItemMode` (l.502-536) and `setItemVisibility` (l.538-550) are the pattern for `setItemFeatured`: server error message to a toast, then `refreshItems()`.

**src/frontend/src/features/admin/PointsConfigPage.tsx** (346 lines), **features/admin/pointsConfigForm.ts**, **api/points.ts**, **hooks/usePointsConfig.ts**
- Add the `max_featured_items` field, for example in its own Section "Wyróżnione rzeczy" next to „Oferty „za punkty”” (l.235-248). Extend the IntegerField union (l.14) and INTEGER_RULES (l.50, kept in step with the backend).

### Related Files

- **src/backend/app/core/authorization_matrix.py**: rows 57/59/60 (l.244-246) already cover `/featured`. Rows 68/69 cover config. No change expected. Verify in tests/test_authorization_matrix.py.
- **src/backend/app/db.py:26** `mapped_transaction_conflicts`: wrap the featured write.
- **src/backend/app/media/service.py:225** `_lock_owner`: the Party-row mutex precedent.
- **src/backend/app/groups/application/item_actions.py** (l.70, 103-104): reads the preference for the product page. Expose `is_featured` and optionally the owner toggle state.
- **src/backend/app/groups/router/circles.py** (:139, :153) and **groups/application/public_view.py:193**: the term page entry points. They carry `is_featured` through `PublicItemListingResponse`.
- **src/backend/app/events/infrastructure/groups_acl.py** (l.19, 30) and **pages/infrastructure/groups_acl.py** (l.26, 49): reuse `item_listing_preferences_select` and pick up the column automatically.
- **src/backend/app/pages/application/owner_pages.py** (339 lines), **pages/application/organization_page.py** (:85, :139, :158), **pages/router/owner_pages.py** (l.29-60), **pages/schemas.py** `OwnerItemCardResponse` (l.25-36, explicit allowlist).
- **src/backend/app/search/application/search.py** (l.272-350): ordering stays unchanged. Optionally add a badge flag in ProductMeta. Note that this file has uncommitted changes in the main checkout. This worktree is separate, but be careful.
- **src/backend/app/inventory/** `update_item` (l.266-306): explicitly not the place for featured.
- Frontend DTOs: `api/groups.ts` PublicItemListingResponse (l.199-213), `api/events.ts` EventParticipantItem (l.35; its doc comment "ordered by product name" is already wrong, so fix it), `api/ownerItems.ts` OwnerItemCard, `api/inventories.ts` MyInventoryItemResponse (l.42), `api/itemListingPreferences.ts` (l.4-40), `api/itemActions.ts`, optionally `api/search.ts`.
- Frontend renderers: `features/terms/TermAttendees.tsx`, `components/shared/ParticipantList.tsx`, `features/events/eventViewModel.ts` (keeps server order), `EventAttendees.tsx`, `features/items/OwnerItemsPage.tsx`, `blocks/OwnerItemsList.tsx`, `features/product/blocks/ItemHeader.tsx` (l.15-56, owner pill precedent „🔒 Prywatny” l.36-41), `features/terms/components/termLabels.ts` (EXCHANGE_MODE_TONE).
- `app/globals.css` tokens (primary, accent, teal(-soft), orange, ink, paper, lime, mint, sage). `test/themeTokenUsage.test.tsx` forbids hex values.

---

## Current Functionality

### Key Components/Functions

- **ItemListingPreference**: the existence of the row equals the item's ACTIVE listing. It carries mode (GIFT/SWAP/POINTS), visibility and points_price. It is deleted on unlist or fulfilled hand-over.
- **set_item_listing_preference**: the owner's full-replace PUT. It takes the owner point account lock (POINTS only), then the item `FOR UPDATE` (ownership of the PERSONAL inventory), then the preference `FOR UPDATE`, re-checks, and returns 409 on a race.
- **POINTS offer cap**: `count(owner_party_id, mode='POINTS', item_id<>this) >= limit` raises `BusinessConflictException("Masz już maksymalną liczbę ofert za punkty ({limit}).")`.
- **PointsConfig**: the singleton admin config, read fresh on each use, with a full-replace PUT and an `updated_at` compare that returns 409.
- **list_listed_items_for_parties**: the term page items, oldest first, not paginated.
- **_listed_items_by_party** (events): the 3 newest per participant plus items_total, PUBLIC only.
- **list_owner_listed_items_page**: owner, profile and organization grids, newest first, paginated 20/100.
- **termViewModel.buildAttendees**: the client groups by lister, sorts newest first and slices to 3.

### Data Flow

1. The owner toggles in `/items` (MyItemsView), which calls an AppDataContext mutation, then `api/itemListingPreferences.ts` and `PUT /api/item-listing-preferences/{id}`. The service locks rows and validates, and returns the response. The client shows a toast on error and refetches.
2. Term page: `GET /api/public/groups/{id}?term_id=` (and `/access`) goes to `get_public_circle_view`, then `list_public_term_item_listings`, then the repository SQL and `PublicItemListingResponse[]`. The client's `termViewModel` (group, sort, slice to 3) feeds `TermAttendees`, then `ParticipantList`, then `ParticipantItemsPreview` and `ItemTileBadges`.
3. Event page: `GET /api/public/events/{id}` goes to `get_event_page` (author first, then attendees in sign-up order), then `_listed_items_by_party` (window top 3), then `EventParticipantItemResponse[]`. `eventViewModel` keeps the order and renders the same `ParticipantList`.
4. Admin: `/admin/points` (PointsConfigPage) uses `usePointsConfig` to call `GET/PUT /api/points/config` (ADMIN), which goes through `load_config`/`update_config`. Groups read the limit through `points_acl.max_featured_items(db)`.

---

## Dependencies

### Imports (What This Depends On)

- `app.points` (via `groups/infrastructure/points_acl.py` only; enforced by a boundary test): the config limit getter.
- `inventory_bridge.get_item_for_update`: ownership check and item lock.
- `app/db.py::mapped_transaction_conflicts`: maps 40P01/40001 to 409.
- `Party` model (row lock for the cap mutex).
- Frontend: TanStack Query hooks, `extractProblemMessage`, the toast from AppDataContext.

### Consumers (What Depends On This)

- **groups term page** (`public_view.py`, `circles.py`): the featured ordering and the flag.
- **events page** (`events/page.py` via groups_acl): the featured ordering in the window and the flag.
- **pages owner/profile/organization** (`owner_pages.py`, `organization_page.py` via groups_acl): the flag, and optionally the ordering.
- **"Moje rzeczy"** (`list_my_items`, `/api/inventory-items/mine(/page)`): the flag for the toggle.
- **product page** (`item_actions.py`): the flag for the badge.
- **search** (`search.py`): optionally the flag only.
- **admin Points page**: the new config field.

**Consumer Count**: about 7 backend read paths and 8 frontend views
**Impact Scope**: Medium. The change is additive, but many response shapes gain a key, and exact key-set tests and typed fixtures must follow.

---

## Test Coverage

### Test Files

- **tests/test_event_page.py**: key sets (l.53-54), `test_getEvent_participantWithFiveItems_returnsThreeNewestAndItemsTotal` (l.470). Extend it with a featured-first case.
- **tests/test_term_item_listings*.py**: term listings and the preference PUT. Add featured ordering and toggle tests.
- **tests/test_points_listing.py**: the cap and race template (a second `AsyncSession` with `join_transaction_mode="create_savepoint"`). Reuse it for the featured-cap race.
- **tests/test_points_config_api.py**: `CONFIG_KEYS` exact set (l.51), 403 (l.71), 400 (l.107), round trip (l.120), 409 (l.169).
- **tests/test_organizer_page.py:151**, **tests/test_owner_items_page.py**, **tests/test_my_items_page.py**, **tests/test_item_visibility.py:34** (PREFERENCE_KEYS), **tests/test_item_listing_status.py**: exact key sets.
- **tests/test_points_valuation.py**: the R8 probe allows only {points_price, held_points} among keys containing "point". `is_featured` does not collide.
- **tests/test_points_migration.py**, **tests/test_points_offers_migration.py**: the template for a 0110 downgrade-then-upgrade test.
- **tests/test_authorization_matrix.py**: confirm that `/featured` resolves to row 60 (EDIT).
- Frontend: `ItemTileBadges.test.tsx`, `ParticipantItemsPreview.test.tsx`, `termViewModel.test.ts`, `VisibilityToggle.test.tsx` (template for a FeaturedToggle test), `PointsConfigPage.test.tsx` (CONFIG fixture), `pointsConfigForm.test.ts`, `usePointsConfig.test.tsx`.

### Coverage Assessment

- **Test count**: the existing suites around every touched path are dense. Each path has integration tests with exact shapes.
- **Gaps**: nothing yet covers featured ordering, the featured cap, the cap race, or the cleanup of the featured state on unlist/hand-over. All of these are new. The pre-existing failures in the main repo (memory: 32 vitest, 2 backend stale tests) are unrelated. Take a baseline in this worktree before implementing.

---

## Coding Patterns

### Naming Conventions

- **Components**: PascalCase files in `src/features/<domain>/` and `components/shared/` (e.g. `VisibilityToggle.tsx`, so `FeaturedToggle.tsx`).
- **Functions**: snake_case services (`set_item_listing_preference`, so `set_item_featured`), private `_count_other_*` helpers. camelCase TS mutations (`setItemVisibility`, so `setItemFeatured`).
- **Files**: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>`. Migrations `NNNN_<name>.py`.
- **Columns**: timestamps `*_at` naive UTC (`featured_at`). Constraint and index names `ix_`/`uq_`/`ck_` explicit.

### Architecture Patterns

- **Style**: layered BCs (`router` → `application` → `infrastructure/repository`). Cross-BC access only via `infrastructure/*_acl.py` / `*_bridge.py`. Ordering in SQL with fixed statement counts.
- **Concurrency**: explicit lock order, `FOR UPDATE`, re-check after locking, Polish 409 messages, and `mapped_transaction_conflicts`.
- **Config**: a singleton row read fresh, admin full replace with optimistic `updated_at`.
- **State Management (frontend)**: TanStack Query hooks in `src/hooks/`, panel mutations via `AppDataContext`, badges from Tailwind tokens.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | core files 1,100-1,400 lines (repository, term_item_listings, schemas) | High |
| Dependencies | points ACL, inventory bridge, db helpers, Party | Medium |
| Consumers | ~7 backend read paths, ~8 frontend views | High |
| Test Coverage | dense integration and key-set tests on every path | Low risk (good coverage) |

### Overall: Moderate

Each piece follows a clear precedent (POINTS cap, Points config, VisibilityToggle, ItemTileBadges pill). The breadth is wide: about 12 backend and 13 frontend files plus tests. There is no new architecture.

---

## Key Findings

### Strengths
- One join point (`item_listing_preferences_select`) feeds events, pages and search through the existing ACLs, so the column propagates with little plumbing.
- Recent, well-tested precedents exist for the cap, the admin integer field, the race tests and the owner pills.
- The authorization matrix already covers the new route.

### Concerns
- The client-side re-sort in `termViewModel.ts` would silently undo the server ordering if it is missed.
- The event preview is cut to 3 by the window function. Featured items must lead the window ORDER BY, or they may never be shown.
- Using `points_config` for a non-points setting is a naming wart.
- `updated_at` is the `version_id_col`, so toggling bumps the preference version. This is harmless (`added_at` uses `created_at`), but a concurrent mode/visibility PUT holding a stale object would 409. That is acceptable.

### Opportunities
- Featured-first on the owner items, profile and organization grids costs one ORDER BY term in the shared SQL.
- Fix the wrong doc comment on `EventParticipantItem` in passing.

---

## Impact Assessment

- **Primary changes**: `groups/models.py`, the 0110 migration, `groups/infrastructure/repository.py` (select column and 2-3 ORDER BYs), `groups/application/term_item_listings.py` (new service plus response mapping), `groups/router/term_item_listings.py`, `groups/schemas.py`, `events/page.py`, `events/schemas.py`, `points/{models,schemas,application/config,application/pricing,service}.py`, `groups/infrastructure/points_acl.py`. Frontend: `termViewModel.ts`, `ItemTileBadges.tsx`, `ParticipantItemsPreview.tsx`, `ItemCard.tsx`, `MyItemsView.tsx`, new `FeaturedToggle.tsx`, `AppDataContext.tsx`, `PointsConfigPage.tsx`, `pointsConfigForm.ts`, and the API DTOs.
- **Related changes**: `pages/schemas.py` + `owner_pages.py`/`organization_page.py`, `item_actions.py` + `ItemHeader.tsx`, optionally search, and `architecture.md` (new migration and runbook line).
- **Test updates**: about 7 exact key-set test files, new featured tests (toggle, cap, race, ordering on term/event, cleanup on unlist), the config API and migration tests, and frontend fixtures (typed, no casts) plus the badge, toggle and view-model tests.

### Risk Level: Medium-Low

The schema change is additive and nullable, so a downgrade only loses featured marks (plain, unguarded). It follows proven patterns. The risk is breadth: a missed key-set test or the missed client re-sort. There is also new concurrency on the cap, which needs the race test.

---

## Recommendations

Creating a new capability on existing structures:

1. **Schema (0110)**: `item_listing_preferences.featured_at TIMESTAMP NULL`, partial index `ix_item_listing_preferences_owner_party_id_featured` on `(owner_party_id) WHERE featured_at IS NOT NULL`, and `points_config.max_featured_items SMALLINT NOT NULL` (seed 3, default dropped). Use `SET LOCAL lock_timeout = '5s'`, a plain reverse downgrade, and a downgrade-then-upgrade test.
2. **Config**: add `("max_featured_items", "Limit wyróżnionych rzeczy", 0, 20)` to `_INTEGER_FIELDS`, the response and request schemas, a getter in pricing/service (or a small new module) re-exported through `points/service.py`, and `points_acl.max_featured_items`.
3. **Write path**: `PUT /api/item-listing-preferences/{item_id}/featured` with body `{featured: bool}`. Inside `mapped_transaction_conflicts`: lock the owner Party row, then the item `FOR UPDATE` (ownership, 404 before 403), then the preference `FOR UPDATE` (missing means 409/400 "Rzecz nie jest wystawiona"). When featuring, count the other featured rows; `>= limit` gives 409 "Możesz wyróżnić maksymalnie {limit} rzeczy." Featuring an already-featured item keeps `featured_at` (idempotent). Unfeaturing sets NULL. Return `ItemListingPreferenceResponse` with `is_featured`.
4. **Reads**: add `featured_at` to `item_listing_preferences_select` and map `is_featured = featured_at is not None` into every response schema listed above. Do not expose the timestamp publicly.
5. **Ordering**: term SQL `ORDER BY (featured_at IS NULL), featured_at DESC, created_at, item_id`. Events window `ORDER BY (featured_at IS NULL), featured_at DESC, created_at DESC, item_id`. Owner page optional. `termViewModel` comparator featured first, then newest, applied before the slice.
6. **UI**: a featured pill in `ItemTileBadges` (and an `ItemCard` badge), a `FeaturedToggle` in MyItemsView shown only for ACTIVE items with a counter hint such as "2/3 wyróżnione", an AppDataContext mutation that toasts the server message, and the admin field in PointsConfigPage.
7. **Tests**: use the race test template from test_points_listing.py, ordering tests on term and event (featured item outside the 3 newest still shown), the flag cleared after unlist and after confirmed GIFT, a lowered limit keeping existing extras, and the config key-set and bounds tests.

---

## Next Steps

Invoke gap-analyzer with this report. The gate questions for the user (in Polish) are: limit lowering behaviour, PRIVATE items, the owner/profile grid ordering, flag persistence across relist, and whether the cap lives on `points_config`.
