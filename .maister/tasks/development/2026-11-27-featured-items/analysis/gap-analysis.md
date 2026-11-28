# Gap Analysis: Featured items (wyróżnione rzeczy)

## TL;DR
- Nothing like "featured" exists yet. The gap is a new flag on the listing, an admin cap, a badge, and featured-first ordering in 3 server queries plus 1 client re-sort.
- The whole feature is additive and follows existing patterns (the POINTS offer cap, `points_config`, `VisibilityToggle`, the `ItemTileBadges` pill). There are no orphaned operations once the planned toggle ships.
- New finding: the agreed „N/limit” hint in „Moje rzeczy” cannot work as things stand. Only admins can read the limit (`GET /api/points/config`), and owners never see the POINTS limit either. The count and limit must reach the owner somehow (critical decision).
- Risk is low to medium and effort medium. The work is broad: about 12 backend and 13 frontend files, migration 0110, and about 7 exact key-set test files.

## Key Decisions
- Characteristics: creates_new_entities (a new flag and setting) + modifies_existing_code (orderings, schemas, UI) + involves_data_operations (feature/unfeature) + ui_heavy (badge, toggle, admin field). There is no defect. The prompt describes a new feature, with no error language.
- Change type is **additive**, compatibility **moderate**. Response shapes gain a key (`is_featured`), and existing orders only gain a leading sort key. Items that are not featured keep their current relative order.
- The lifecycle is complete by construction. Unlist (`term_item_listings.py:259`) and confirm hand-over (`:1359`, all reservation types incl. POINTS SALE) delete the preference row. `soft_delete_item` refuses while a listing stands (`inventory_items.py:318`). So a featured flag on `item_listing_preferences` can never be orphaned.
- A mode or visibility change keeps the flag. `set_item_listing_preference` updates the existing row in place (`term_item_listings.py:284-290`), so `featured_at` survives GIFT→SWAP→POINTS switches. This matches the "tied to the listing" decision.

## Open Questions / Risks
- `set_item_listing_preference` rewrites `owner_party_id = profile.party_id` on every save (`:287`). The cap counts by `owner_party_id`. This is harmless while a user's party is stable, but it is worth a line in the spec.
- The event preview shows 3 items per participant (`PREVIEW_ITEM_LIMIT = 3`). If the admin sets the cap above 3, some featured items fall behind „Pokaż więcej”. The admin bounds decision affects this.
- `termViewModel.ts` re-sorts newest first and slices to 3 on the client. If this step is missed, the server order is silently undone on term pages.
- Anonymous public responses are cached with `s-maxage=60`, so guests may see a toggle up to 60 s late. This is accepted existing behaviour.
- There is no gold/yellow colour token in `app/globals.css`, and `themeTokenUsage.test.tsx` forbids hex values. A distinct badge colour means either an existing token or a new token with a dark-mode pair.

## Summary
- **Risk Level**: Low-Medium
- **Estimated Effort**: Medium
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: yes (a column and a config field, not a new table)
- Involves data operations: yes
- UI heavy: yes

## Gaps Identified

### Missing Features
- **Featured flag**: no column. `item_listing_preferences` (`groups/models.py:437-485`) has mode/visibility/points_price only.
- **Cap setting**: `_INTEGER_FIELDS` in `points/application/config.py:18-32` has `max_points_offers` (0–100) but no featured limit. `PointsConfig` model, schemas and migration need a `max_featured_items` column.
- **Write path**: there is no endpoint to feature or unfeature. Matrix row 60 (`/api/item-listing-preferences(/.*)?`, EDIT) already covers a `/featured` sub-route.
- **Owner-visible limit/count**: `MyInventoryItemsPageResponse` (`groups/schemas.py:849`) has `counts {GIFT,SWAP,POINTS}`, total, page and size. It carries no featured count or limit, and the config GET is ADMIN-only (matrix row 68).
- **Badge**: `ItemTileBadges.tsx` renders mode pills and the reserved pill only. `ItemCard.tsx` has no featured marker.
- **Toggle**: `MyItemsView.tsx` has `VisibilityToggle` (l.572-583) but no featured toggle. `AppDataContext.tsx` has no `setItemFeatured`.
- **Admin field**: `PointsConfigPage.tsx` and `pointsConfigForm.ts` have no field for the limit.

### Incomplete Features
- None. The feature does not exist even in part.

### Behavioral Changes Needed
- Term page: `list_listed_items_for_parties` (`repository.py:1035`) orders by `created_at, item_id`. It needs featured first, and the client `termViewModel.buildAttendees` comparator needs featured first as well, before the slice to 3.
- Event page: the window `row_number() OVER (PARTITION BY owner_party_id ORDER BY created_at DESC, item_id)` (`events/page.py:86-91`) needs featured first, so featured items take the 3 preview slots.
- Owner pages: `list_owner_listed_items_page` (`repository.py:1295`) orders by `created_at DESC, item_id`. It feeds `/…/items`, profile recent items and organization recent items (`organization_page.py::_recent_items` → `owner_pages.list_owner_recent_items`). It needs featured first, including inside a mode-filtered tab.
- Search: unchanged (decided).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (owner) | n/a | /items → item card → toggle beside „Widoczność” | ✅ one click, existing panel page |
| Discoverability (owner) | n/a (0) | 7/10: a toggle on every listed card plus the „N/limit” hint | ✅ (only if the limit reaches the owner, see critical decision) |
| Discoverability (visitor) | n/a | 8/10: a pill on tiles, featured first on term/event/owner pages | ✅ |
| Flow integration | — | No extra steps in listing. Unlist or hand-over clears the flag silently. | ✅ neutral/positive |
| Admin | /admin/points | the same page, a new field or section | ✅ 7/10 (a "points" page holds a non-points setting) |

Personas: the owner (toggle, counter, 409 at the cap), visitors including guests (badge and order; PRIVATE items only for members of a shared private circle, PUBLIC only on events), the admin (limit). Organizers get nothing new.

## Data Lifecycle Analysis

### Entity: featured mark (on ItemListingPreference)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (feature) | missing → new `PUT …/{item_id}/featured` (row 60 covers it) | missing → FeaturedToggle | /items card (decided) | ❌ now, planned |
| READ | missing → `is_featured` in term/event/owner/product/my-items responses | missing → badge | term, event, owner, profile, organization, product pages, /items | ❌ now, planned |
| UPDATE | n/a (boolean) | — | — | n/a |
| DELETE (unfeature) | same PUT `{featured:false}` + implicit on unlist/hand-over (verified `:259`, `:1359`) | same toggle | /items | ❌ now, planned |

### Entity: max_featured_items (PointsConfig)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| READ (admin) | `GET /api/points/config` (needs the field) | PointsConfigPage | /admin/points nav "Points" | planned |
| UPDATE (admin) | `PUT /api/points/config` (full replace, `updated_at` 409) | PointsConfigPage field | same | planned |
| READ (owner) | **no non-admin read exists** | „N/limit” hint | /items | ❌ gap, see critical decision |

**Completeness**: 0% today. 100% with the planned scope plus an owner-visible limit, and 75% without it (the owner's count and limit are orphaned).
**Orphaned Operations**: the limit is written by the admin but is not readable by owners, while the agreed hint needs it.
**Missing Touchpoints** (decide): search result cards, wants match/suggestion/similar cards (`features/wanted/*Card.tsx` use ItemCard), the product page header (`ItemHeader.tsx`).

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **How the owner gets „N/limit”**: the config GET is ADMIN-only.
   - Options: (A) add `featured: {count, limit}` to `GET /api/inventory-items/mine/page` (one extra COUNT, the counter refreshes with the existing invalidation); (B) a new owner read `GET /api/item-listing-preferences/featured-summary`; (C) no hint, only the 409 message „Możesz wyróżnić maksymalnie N rzeczy”.
   - Recommendation: A. The count must cover all of the owner's items, not one page. It rides the query the view already makes. `test_my_items_page.py` key sets need updating.

### Important (Should Decide)
1. **Badge look**: Default „⭐ Wyróżnione” pill as the first pill in `ItemTileBadges` with `bg-ink text-on-ink` (existing tokens, distinct from the GIFT/SWAP/POINTS/reserved tones). The alternative is a new `--color-gold` token with a dark-mode pair and a 4.5:1 check. The ⭐ is `aria-hidden` and the text is readable.
2. **Where the badge shows**: Default on term and event previews, owner/profile/organization grids (ItemCard), the product page header and „Moje rzeczy”. Not on search cards or wants cards: that avoids touching `search.py` (≤7 statements per mode; the main checkout has uncommitted changes there) and the matcher-fed cards. The alternative is to include the search badge (adds `is_featured` to ProductMeta).
3. **PRIVATE listings**: Default: allowed, and they count toward the cap. They are visible only where PRIVATE already is. Events are PUBLIC-only, so they never appear there. The alternative is to block featuring PRIVATE items with a 409.
4. **RESERVED items**: Default: may be featured and stay featured while reserved, since they remain listed. Order ignores reservation. The alternative is to block featuring while the item is reserved.
5. **Admin bounds**: Default `0–20`, seed 3, where 0 turns the feature off (the toggle is hidden when the limit is 0 and nothing is featured). The alternative is `1–10`. Note: above 3, the event preview shows only the 3 most recently featured.
6. **Order among featured items**: Default: most recently featured first (`featured_at DESC`), then the page's existing order. The alternative is the existing listing order only.
7. **Home of the limit**: Default `points_config.max_featured_items`, as its own section „Wyróżnione rzeczy” on /admin/points. The alternative is a new settings table plus admin page. That is speculative under the minimal-implementation standard.
8. **Endpoint shape**: Default dedicated `PUT /api/item-listing-preferences/{item_id}/featured {featured: bool}`, idempotent: re-featuring keeps `featured_at`. A non-listed item returns 409 „Wystaw rzecz, aby ją wyróżnić”. Lock order is owner Party row → item → preference. It never takes point accounts and is wrapped in `mapped_transaction_conflicts`. The alternative is a field on the full-replace preference PUT, which forces every mode/visibility save to carry and re-validate it.
9. **Toggle on DRAFT items**: Default: hidden for unlisted items. The alternative is shown disabled (`aria-disabled` + hint, the accessibility-standard pattern).

## Recommendations
- Migration `0110_featured_items`: `featured_at TIMESTAMP NULL`, a partial index `(owner_party_id) WHERE featured_at IS NOT NULL`, and `points_config.max_featured_items SMALLINT NOT NULL` (server default 3, then dropped, as in the 0109 pattern). Use `SET LOCAL lock_timeout='5s'`, a plain lossy downgrade, a downgrade-then-upgrade test, and a runbook line in `architecture.md`.
- Expose `is_featured` (boolean, never the timestamp) in `PublicItemListingResponse`, `EventParticipantItemResponse`, `OwnerItemCardResponse`, `MyInventoryItemResponse`, `ItemListingPreferenceResponse` and `ItemActionsResponse`.
- Sort in SQL by `(featured_at IS NULL), featured_at DESC, <existing keys>` in the three queries. Fix the `termViewModel` comparator. Fix the stale "ordered by product name" comment in `api/events.ts`.
- Cap check: count the owner's other featured rows (excluding this item) `>= limit` → Polish 409. A lowered limit keeps existing marks (decided).
- Tests: toggle, cap, cap race (the `test_points_listing.py` second-session template), cleanup on unlist and on GIFT confirm, a lowered limit, term/event/owner ordering (including a featured item outside the 3 newest), config key set and bounds, key-set updates. Frontend: badge, toggle, view model, admin form and typed fixtures.

## Risk Assessment
- **Complexity Risk**: Low. Every piece has a recent precedent.
- **Integration Risk**: Medium-low. Many response shapes change, and the client re-sort is a trap.
- **Regression Risk**: Low-medium. Existing orders gain only a leading key. Exact key-set tests fail loudly if missed. The new lock path (Party → item → preference) does not cross the POINTS lock order (owner account → item → preference) in reverse, so there is no new deadlock cycle.
