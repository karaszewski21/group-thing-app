# Specification: Featured items („Wyróżnione rzeczy”)

## TL;DR
Owners mark up to N of their listed items as featured with a „⭐ Wyróżnij” toggle in „Moje rzeczy”. N comes from a new admin settings page (`/admin/settings`, default 3, range 0–20, 0 turns featuring off).
The mark is a nullable `featured_at` on `item_listing_preferences`, so it disappears with the listing. It is set through a dedicated idempotent `PUT /api/item-listing-preferences/{item_id}/featured` (hidden items 404 first). The cap is serialised by an owner Party-row lock taken `FOR NO KEY UPDATE`.
Featured items show a dark „⭐ Wyróżnione” pill and come first (most recently featured first) on term, event, owner, profile and organization pages. Search, wants cards and the order of „Moje rzeczy” stay as they are.
The limit lives in a new `app/settings` module with a single-row typed table `app_settings`, behind ADMIN `GET/PUT /api/admin/settings` (matrix row 74).

## Key Decisions
- **Featured state is `item_listing_preferences.featured_at`** (nullable, naive UTC). It orders the featured items (most recent first) and is deleted together with the listing row on unlist and on every hand-over. Clients only ever get `is_featured: bool`.
- **The limit is stored in a new `app/settings` module with a single-row typed table** `app_settings.max_featured_items` (the user's choice). It does not go on `points_config`. Groups read it only through `groups/infrastructure/settings_acl.py`.
- **Two revisions, 0110 and 0111.** The migrations standard keeps "additive nullable columns … in a separate revision from new tables": 0110 creates `app_settings` and its seed row, 0111 adds `featured_at` and its partial index.
- **Schema and seed share revision 0110, as a recorded exception.** The real reason: `load_settings` reads the row with `scalar_one()`, so a head that has the table but not the row would make every featuring and the admin GET fail with a 500. `points_config` kept its seed separate (0103 schema, 0105 seed), but only because nothing read the row between those two revisions. Here the first reader ships together with the table.
- **The 0111 partial index is built in the migration's transaction, not concurrently.** `item_listing_preferences` holds one row per listed item, so the table is small. The index predicate matches no row when it is built, because every `featured_at` is NULL. `SET LOCAL lock_timeout = '5s'` bounds the brief lock. `CREATE INDEX CONCURRENTLY` would add an `autocommit_block()` and a non-transactional revision without any benefit.
- **Plain, unguarded, lossy downgrades.** A featured mark is presentation state with no ledger link and nothing that would be exposed or corrupted, so losing it is acceptable. The 0106 precedent loses prices the same way. There is no image-only rollback: downgrade from the new image.
- **Visibility first, then the lock order owner Party row (`FOR NO KEY UPDATE`) → item → preference.** The toggle never takes point accounts.
  - Every insert, or FK-column update, of a row referencing `parties.id` takes `FOR KEY SHARE` on the parent Party row (for example the owner notification in take/propose, `point_transactions.counterparty_party_id`, a first preference insert or `fulfill_exchange`). Those paths take the Party lock after the item or preference lock.
  - A plain `FOR UPDATE` on the Party row would conflict with that `FOR KEY SHARE` and could deadlock with another user's take, propose or confirm.
  - `FOR NO KEY UPDATE` (SQLAlchemy `with_for_update(key_share=True)`) does not conflict with `FOR KEY SHARE`, but it does conflict with itself. So toggles of one owner still serialise, and the FK checks never wait on the toggle.
  - The `media/service.py::_lock_owner` precedent uses a plain `FOR UPDATE`. It is not copied verbatim.
- **The toggle is idempotent.** Re-featuring an item that is already featured keeps its `featured_at` and skips the cap check. Unfeaturing is always allowed. Lowering the limit keeps the existing marks.
- **The owner never sees the limit.** There is no N/limit hint. The cap reaches the owner only through the 409 message.
- **Cap message with the Polish plural.** N = 1 gives „Możesz wyróżnić maksymalnie 1 rzecz.”; any other N gives „Możesz wyróżnić maksymalnie {N} rzeczy.”. Polish uses „rzeczy” for 2–4 and also for 5 and more, so only N = 1 differs. N = 0 never reaches this message, because limit 0 gets the "disabled" message.
- **Accepted side effect: the toggle bumps `updated_at`.** Every toggle bumps `item_listing_preferences.updated_at` (the `version_id_col`), which moves `matchable_listings.changed_at`. The wants matcher then re-reads that listing in its next window. This is harmless (the matcher's upserts are idempotent), and the re-read counts toward `WINDOW_MAX_LISTINGS` (300). Toggles are rare and capped at a few per owner. Bypassing the ORM version column only for this write would break the optimistic-locking contract of `BaseEntity`, so the bump is kept.
- **Mockups and the existing app conflict on three details; the existing app wins.**
  - Errors use the existing bottom `ToastPill` (`bg-ink`), as the mockup's own note says („istniejącym toastem”), not the red top toast drawn in it.
  - The featured pill goes first in the „Moje rzeczy” chip row.
  - The „Settings” nav entry goes right after „Points” in `Sidebar.tsx` and `MobileDrawer.tsx`. Other entries keep their current positions, even where the mockup draws them elsewhere.
- **The term page relies on a stable client sort.** The client only has `is_featured`, so `termViewModel` puts featured items first, keeps the server's relative order among them (the server sorts them `featured_at DESC`), then sorts the rest newest first, and only then slices to 3.

## Open Questions / Risks
- Guests may see a change up to 60 s late because of the shared cache (`s-maxage=60`). This is accepted.
- A limit above 3 means that on event and term previews only the 3 most recently featured items show. The others sit behind „Pokaż więcej”, and the owner items page also shows featured items first.
- `set_item_listing_preference` rewrites `owner_party_id` on every save, and the cap counts by `owner_party_id`. This is harmless while a user's party is stable, so it is noted, not changed.
- Featuring bumps the preference's `updated_at` (its `version_id_col`). A concurrent mode or visibility PUT that holds a stale object may get a 409. This is acceptable and handled by the existing toast + refresh.
- Many exact key-set tests (about 9 backend files) and the typed frontend fixtures must gain `is_featured`. Missing one fails loudly, not silently.
- **Migration and matrix numbering will collide at merge.** The main checkout has an uncommitted email module that uses migrations 0110–0112 and probably matrix row 74. The user decided to keep 0110/0111 and row 74 in this worktree and to renumber at merge.
  - The implementation plan must include an explicit merge step that renumbers both revisions, updates their `revision`/`down_revision`, the migration test and the runbook line, and renumbers the matrix row and its test.

## Goal
Let an owner promote a few of their listed items, up to an admin-controlled limit, so that those items stand out with a badge and lead the lists on term, event and owner pages.

## User Stories
- As an owner, I want to mark my best listed items as featured in „Moje rzeczy” so that visitors see them first.
- As an owner, I want a clear message when I hit the limit or when featuring is turned off, so that I know why my click had no effect.
- As a visitor (a guest or logged in), I want featured items to carry a visible „⭐ Wyróżnione” badge and come first on term, event and owner pages, so that I notice them quickly.
- As an admin, I want to set how many items one user may feature (0–20, 0 = off) on an admin settings page, so that I can tune or switch off the feature without a deploy.

## Core Requirements

### Featured toggle (owner)
1. `PUT /api/item-listing-preferences/{item_id}/featured` with body `{featured: StrictBool}` (`extra="forbid"`).
   - A missing field, or any non-boolean value (`1`, `"true"` and so on), is a 400.
   - Login EDIT or `mcp:edit`, matched by the existing matrix row 60.
   - Returns `ItemListingPreferenceResponse` with `is_featured`.
2. Errors are checked in this order:
   1. The item is missing, or hidden from the caller → 404. `require_item_visible(db, item_id, profile.party_id)` (`groups/application/item_visibility.py`) runs first, before any lock, so another owner's PRIVATE listing is never revealed by a 403.
   2. The item is not the caller's own PERSONAL-inventory item → 403. This is the same ownership check as `set_item_listing_preference`, done after `inventory_bridge.get_item_for_update`.
   3. No listing preference row (a DRAFT) → 409 „Wystaw rzecz, aby ją wyróżnić.”.
   4. Only when featuring an item that is not featured yet: limit 0 → 409, then the cap → 409 (point 3).
   5. Only then is the change written.
3. Featuring an item that is not featured yet:
   - When `max_featured_items == 0` → 409 „Wyróżnianie rzeczy jest teraz wyłączone.”.
   - Otherwise, when the caller's other featured preferences (same `owner_party_id`, excluding this item) number `>= max_featured_items` → 409. N = 1 gives „Możesz wyróżnić maksymalnie 1 rzecz.”; any other N gives „Możesz wyróżnić maksymalnie {N} rzeczy.” (N = the current limit).
   - Otherwise set `featured_at` to now, in naive UTC like every audit timestamp.
4. Featuring an item that is already featured returns 200 unchanged: no cap check, and `featured_at` is kept. Unfeaturing sets `featured_at` to NULL and is always allowed, including at limit 0. Unfeaturing an item that is not featured is a no-op.
5. Any mode (GIFT/SWAP/POINTS), PUBLIC or PRIVATE, reserved or not may be featured. PRIVATE listings count toward the cap.
6. Concurrency: after the visibility check, inside `mapped_transaction_conflicts`, take the locks in this order:
   1. The caller's Party row with `SELECT Party.id … FOR NO KEY UPDATE` (`with_for_update(key_share=True)`). Do not use the plain `FOR UPDATE` of `_lock_owner`; see Key Decisions.
   2. The item (`get_item_for_update`).
   3. The preference (`repository.lock_item_listing_preference`).

   Read the limit and count the other featured items under these locks. Two parallel featurings at the cap cannot both succeed. A take, propose or confirm on the same owner's item, running in parallel, must not deadlock with the toggle.
7. The mark clears automatically when the listing row is deleted: unlist via the preference PUT with `mode: null`, and a confirmed GIFT/SWAP/POINTS hand-over. Changing the mode or visibility through the preference PUT keeps the mark, because the row is updated in place.
8. Lowering the limit never removes existing marks. It only blocks new ones until the owner is under the limit.

### Read model
9. `item_listing_preferences_select` also selects `featured_at`. Each consumer projects its columns explicitly, so `featured_at` must also be added to every consumer's outer select:
   - `repository.py::list_listed_items_for_parties` (around l.1023–1036, the term page).
   - `repository.py::_owner_listed_items` (around l.1238–1253, owner, profile and organization pages).
   - The `events/page.py::_listed_items_by_party` window subquery and outer select (l.74–95). Also update its docstring (l.64–69), which says "3 newest".
   - The `_my_items` select (Moje rzeczy).

   Docstrings that describe the old order („oldest first” / „newest first”) are updated to name the featured-first key. Every listed-item response maps the column to `is_featured: bool` and never exposes the timestamp:
   - `PublicItemListingResponse` (term page)
   - `EventParticipantItemResponse` (event page)
   - `OwnerItemCardResponse` (owner items page, profile and organization recent items)
   - `MyInventoryItemResponse` (Moje rzeczy; false for drafts)
   - `ItemListingPreferenceResponse`
   - `ItemActionsResponse` (product page): `preference is not None and preference.featured_at is not None`. Hidden items already 404 in `item_actions.py`.
10. `is_featured` is public listing information, like `mode`. It is not a points field, so the R8 probe allowlist is unchanged.

### Ordering (featured first)
11. In SQL, the leading key everywhere is `featured_at DESC NULLS LAST`, followed by each query's existing keys:
    - Term page `list_listed_items_for_parties`: then `created_at, item_id`.
    - Event page window in `events/page.py::_listed_items_by_party`: the `row_number()` window order becomes `featured_at DESC NULLS LAST, created_at DESC, item_id`, so featured items fill the 3-item preview. `items_total` is unchanged.
    - Owner items `list_owner_listed_items_page`, in every mode tab: then `created_at DESC, item_id`. This also covers profile and organization recent items, which share the function.
12. Frontend `features/terms/termViewModel.ts::buildAttendees` sorts each lister's items before `slice(0, PREVIEW_ITEM_LIMIT)`. Featured items come first and keep the server's relative order. The rest follow, newest first.
13. Unchanged: search ordering and results, „Moje rzeczy” order (newest first), the browse/mine term-item-listing lists, and wants match, suggestion and similar cards.

### Badge
14. `ItemTileBadges` gains a `featured` prop. It renders the first pill „⭐ Wyróżnione” in the pill shape of the current size, with `bg-ink text-on-ink`; the ⭐ sits in an `aria-hidden` span. The row renders even when it has no mode and no reservation.
15. `ItemCard` gains a `featured` prop. It renders the right-corner badge in the existing `CORNER_BADGE`/marker position, with `bg-ink text-on-ink` and the label „⭐ Wyróżnione” (⭐ `aria-hidden`). It takes precedence over `marker`; no caller passes both.
16. Where the badge shows:
    - Term and event participant previews (`ParticipantItemsPreview` → `ItemTileBadges`).
    - Owner items page, profile items and organization recent items (`ItemCard`).
    - The product page header (`ItemHeader`, md pill before the mode pills, visible to every viewer).
      - `featured` is gated on `view.kind` exactly like `mode`: false while loading or when `view.kind === "hidden"`, else `actions.data?.is_featured`.
      - The badge row's wrapper condition becomes `mode || featured || reservation || isPrivate || statusAsPill`.
    - The „Moje rzeczy” card chip row, as the first chip (the mockup wins here).
    - Not on search cards and not on wants cards.

### „Moje rzeczy” toggle UI
17. A new `FeaturedToggle` button sits next to `VisibilityToggle`, only for listed items (hidden on drafts):
    - `type="button"`.
    - It takes an `itemName` prop and carries a stable `aria-label` „Wyróżnij: {itemName}” that is the same in both states. The state is carried only by `aria-pressed`. This follows `VisibilityToggle`'s item-named labels, so a list of cards stays unambiguous.
    - The visible text may change: „⭐ Wyróżnij” off, „⭐ Wyróżnione” on (ink tone), with ⭐ `aria-hidden`. The `aria-label` overrides the visible text for assistive technology.
    - Native `disabled` only while busy.
    - It is shown even when the limit is 0, because the owner does not know the limit.
18. `AppDataContext.setItemFeatured(itemId, featured)`:
    - On success, updates the local item flag (the `itemsSeqRef` pattern of `setItemVisibility`).
    - On error, shows the server message through the existing `ToastPill` toast (`serverMessageOr(err, "Nie udało się zapisać wyróżnienia — spróbuj ponownie")`) and calls `refreshItems()`.
    - Every other save that replaces the panel copy of an item's listing also sets `is_featured`, so the chip and toggle never go stale after unlist and relist:
      - `AppDataContext.setItemMode` sets `is_featured: saved?.is_featured ?? false`. The flag is false when the listing is cleared, and false for a newly created listing.
      - `setItemVisibility` sets it from `saved?.is_featured` when a saved preference is returned.

### Admin settings
19. New module `app/settings`:
    - Model `AppSettings` on `BaseEntity`, table `app_settings` with the singleton index `uq_app_settings_singleton` on `((true))`.
    - `max_featured_items INTEGER NOT NULL` under `ck_app_settings_max_featured_items_range` (0–20).
    - Seed row with value 3.
20. `GET /api/admin/settings` and `PUT /api/admin/settings` are ADMIN only, on a new matrix row 74 `^/api/admin/settings$` (GET, PUT), placed before the catch-all.
    - Response `{max_featured_items, updated_at}`.
    - The PUT is a full replace with the `updated_at` the client read, `extra="forbid"`, with `max_featured_items` as `StrictInt` (a non-integer is a 400).
    - A mismatch is 409 „Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.”.
    - Bounds are checked in the application layer with Polish 400s: „Limit wyróżnionych rzeczy musi być liczbą całkowitą ≥ 0.” / „… ≤ 20.”.
    - No cache headers, as for the points config.
21. Frontend admin page `/admin/settings`, built in Chakra like `PointsConfigPage`:
    - Heading „Ustawienia”, subtitle „Ogólne ustawienia aplikacji”, section „Wyróżnione rzeczy”.
    - Field „Limit wyróżnionych rzeczy” (`type="text" inputMode="numeric" pattern="[0-9]*"`, raw string in state), with the help text „Ile rzeczy jeden użytkownik może wyróżnić naraz (0–20). 0 = wyróżnianie wyłączone. Po zmniejszeniu limitu istniejące wyróżnienia zostają.”.
    - Inline `role="alert"` validation with `aria-invalid`/`aria-describedby`, and Save disabled while the field is invalid.
    - The server's 409 and 400 messages are shown verbatim.
    - Nav entry „Settings” right after „Points” in `Sidebar.tsx` and `MobileDrawer.tsx`; the other entries do not move.

### Migrations and docs
22. **0110 `app_settings`**: create the table, its singleton index and CHECK, and seed one row (explicit `id`, `created_at`, `updated_at`, value 3). The downgrade drops the table.
23. **0111 `featured_items`**: under `SET LOCAL lock_timeout = '5s'`, add `item_listing_preferences.featured_at TIMESTAMP NULL` (no backfill) and the partial index `ix_item_listing_preferences_owner_party_id_featured` on `(owner_party_id) WHERE featured_at IS NOT NULL`.
    - The index is built in the same transaction, not concurrently (small table, empty predicate at creation; see Key Decisions).
    - The downgrade drops the index, then the column.
24. `architecture.md` gets the `app/settings` module, matrix row 74, the featured-items rules and a 0110–0111 runbook line:
    - `pg_dump` first.
    - Backend before web.
    - No image-only rollback past 0111 (an old image does not start on an unknown revision).
    - `downgrade 0109` from the new image is unguarded and loses every featured mark and the settings row.

    `INDEX.md` gets a matching summary line.
25. **Merge renumbering step** (planned, not optional). Before merging into main, renumber 0110/0111 and matrix row 74 past the main checkout's email module (0110–0112). This covers the revision ids and `down_revision`, the file names, the migration test, the runbook line, the matrix row comment and `test_authorization_matrix.py`.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Fidelity: mid-fidelity HTML on the app's Tailwind tokens (`src/frontend/src/app/globals.css`; no hex colours, `test/themeTokenUsage.test.tsx`).

| ID | Mockup | Implemented in | Key elements |
|----|--------|----------------|--------------|
| screen:my-items-featured-toggle | `analysis/design-context/mockups/moje-rzeczy-prze-cznik-wyr-nij.html` | `features/items/MyItemsView.tsx` + new `features/items/FeaturedToggle.tsx` | Toggle beside „Publiczna / Prywatna”, listed items only, no N/limit; „⭐ Wyróżnione” chip in the chip row |
| screen:my-items-featured-errors | `analysis/design-context/mockups/moje-rzeczy-limit-osi-gni-ty.html` | `features/panel/AppDataContext.tsx` toast | 409 toasts „Możesz wyróżnić maksymalnie 3 rzeczy.” / „Wyróżnianie rzeczy jest teraz wyłączone.”, then the list refreshes. Rendered in the existing bottom `ToastPill`, not the red top toast drawn in the mockup |
| screen:term-page-featured-first | `analysis/design-context/mockups/strona-terminu-wyr-nione-pierwsze.html` | `features/terms/termViewModel.ts`, `components/shared/ParticipantItemsPreview.tsx` | Featured first in each lister's 3-item preview, with the pill |
| screen:event-page-featured-first | `analysis/design-context/mockups/strona-eventu-wyr-nione-pierwsze.html` | `app/events/page.py` window, `features/events/eventViewModel.ts` | Featured first in the 3-item window, with the pill |
| screen:owner-items-featured-first | `analysis/design-context/mockups/strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.html` | `features/items/blocks/OwnerItemsList.tsx`, `features/profile-public/blocks/ProfileItems.tsx`, `features/organization-public/blocks/RecentItemsBlock.tsx` | Featured tiles first in every tab, right-corner ink badge |
| screen:product-page-featured-badge | `analysis/design-context/mockups/strona-produktu-badge.html` | `features/product/blocks/ItemHeader.tsx` | md pill before the mode pills, from `ItemActionsResponse.is_featured` |
| screen:admin-settings | `analysis/design-context/mockups/panel-admina-ustawienia.html` | new `features/admin/SettingsPage.tsx`, route `app/admin/(shell)/settings/page.tsx`, nav | „Ustawienia” page, field 0–20, help text, the 409 and validation states, nav „Settings” after „Points” |
| component:featured-pill | `analysis/design-context/mockups/strona-terminu-wyr-nione-pierwsze.html` | `components/shared/ItemTileBadges.tsx` | First pill „⭐ Wyróżnione”, `bg-ink text-on-ink`, ⭐ `aria-hidden` |
| component:item-card-featured-marker | `analysis/design-context/mockups/strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.html` | `components/shared/ItemCard.tsx` | Right-corner badge in the marker slot, ink tone |
| component:featured-toggle | `analysis/design-context/mockups/moje-rzeczy-prze-cznik-wyr-nij.html` | `features/items/FeaturedToggle.tsx` | Button with `aria-pressed`, ink when on |

## Reusable Components

### Existing Code to Leverage

**Backend**

| Code | Path | Use |
|------|------|-----|
| `ItemListingPreference` | `src/backend/app/groups/models.py` | Gains `featured_at` and a read-only `is_featured` attribute, so `from_attributes` responses can map it |
| `set_item_listing_preference` | `src/backend/app/groups/application/term_item_listings.py` | Template for the ownership check and lock re-check; deletes the row on unlist (so the mark clears) |
| `_count_other_points_offers` | `src/backend/app/groups/application/term_item_listings.py` | Template for the cap: count the owner's others, exclude this item, Polish 409 |
| `lock_item_listing_preference`, `item_listing_preferences_select`, `list_listed_items_for_parties`, `_owner_listed_items` / `list_owner_listed_items_page`, `_my_items` | `src/backend/app/groups/infrastructure/repository.py` | Lock helper; the shared select gains the column; the ordering sites |
| `_listed_items_by_party` | `src/backend/app/events/page.py` | The window function gains the leading key (via the existing `events/infrastructure/groups_acl.py`) |
| `owner_pages.py`, `organization_page.py`, `OwnerItemCardResponse` | `src/backend/app/pages/application/`, `src/backend/app/pages/schemas.py` | Carry the flag through the existing `pages/infrastructure/groups_acl.py` |
| `item_actions.py` | `src/backend/app/groups/application/item_actions.py` | Already reads the preference; adds `is_featured` |
| `_lock_owner` | `src/backend/app/media/service.py` | Party-row mutex pattern, but taken as `FOR NO KEY UPDATE` (`key_share=True`) instead of its plain `FOR UPDATE`. Groups already imports `app.party` (`groups/application/circles.py`) |
| `require_item_visible` | `src/backend/app/groups/application/item_visibility.py:40` (used by take/propose, `term_item_listings.py:878, 893`) | The first check on the toggle path: hidden → 404 before 403 |
| `mapped_transaction_conflicts` | `src/backend/app/db.py` | 40P01/40001 → 409 around the toggle and the settings PUT |
| `PointsConfig`, `load_config`/`update_config`/`_INTEGER_FIELDS`, `PointsConfigChangedException`, points router/schemas, `uq_points_config_singleton` | `src/backend/app/points/` | Template for the whole settings stack: singleton row, fresh read, full replace + `updated_at` → 409, application-layer Polish 400s, ADMIN router |
| `points_acl.max_points_offers` | `src/backend/app/groups/infrastructure/points_acl.py` | Template for `settings_acl.max_featured_items` |
| Matrix rows 60 and 68 | `src/backend/app/core/authorization_matrix.py` | Row 60 already covers `/featured`; row 68 is the ADMIN row pattern |
| 0109 (seed with explicit timestamps, `_NOW_UTC`), 0076 (`lock_timeout`) | `src/backend/alembic/versions/` | Migration templates |

**Tests (backend)**

| Code | Path | Use |
|------|------|-----|
| `test_points_listing.py` | `src/backend/tests/` | Second-`AsyncSession` race template |
| `test_points_config_api.py` | `src/backend/tests/` | Settings API test template |
| `test_points_offers_migration.py` | `src/backend/tests/` | Downgrade-then-upgrade template |
| `test_module_boundaries.py` | `src/backend/tests/` | Rule pattern for the new module |

**Frontend**

| Code | Path | Use |
|------|------|-----|
| `ItemTileBadges` | `src/frontend/src/components/shared/ItemTileBadges.tsx` | `PILL_SIZE`, the pill classes and the `" "` separator pattern |
| `ParticipantItemsPreview` | `src/frontend/src/components/shared/ParticipantItemsPreview.tsx` | `ParticipantPreviewItem` gains `featured` |
| `ItemCard` | `src/frontend/src/components/shared/ItemCard.tsx` | `CORNER_BADGE` and the marker slot |
| `VisibilityToggle` | `src/frontend/src/features/items/VisibilityToggle.tsx` | Tone, size and test template for `FeaturedToggle` |
| `setItemVisibility`, `serverMessageOr`, `showToast`, `refreshItems` | `src/frontend/src/features/panel/AppDataContext.tsx` | Mutation, toast and refresh pattern |
| `PointsConfigPage`, `pointsConfigForm.ts`, `usePointsConfig`, `api/points.ts` | `src/frontend/src/features/admin/`, `src/frontend/src/hooks/`, `src/frontend/src/api/` | Template for the admin page, the integer parsing and rules, the query hook and the API module |
| `NavItem` / `MobileNavItem` | `src/frontend/src/components/layout/Sidebar.tsx:90`, `MobileDrawer.tsx:99` | Admin nav entries |
| `features/events/eventViewModel.ts`, `features/terms/termViewModel.ts` | `src/frontend/src/features/` | Map the flag; the term comparator changes |

### New Components Required

**Backend**

| Component | Why existing code cannot be reused |
|-----------|------------------------------------|
| `app/settings` module (`models.py`, `schemas.py`, `service.py`, `router.py`) | The user chose a generic settings home over `points_config`. It holds one key for now and nothing speculative |
| `groups/infrastructure/settings_acl.py` | Cross-context reads must go through an ACL |
| `set_item_featured` service, `SetItemFeaturedRequest` and the `/featured` route | No write path exists. Folding the flag into the full-replace preference PUT would make every mode or visibility save carry and re-validate it |
| A repository helper that locks the owner Party row | Groups has no Party lock today. It is one statement, following `_lock_owner` |
| Migrations 0110 and 0111 | Required by the schema change |

**Frontend**

| Component | Why existing code cannot be reused |
|-----------|------------------------------------|
| `FeaturedToggle.tsx` | `VisibilityToggle` is a two-option segmented control; featuring is a single pressed or unpressed button |
| `SettingsPage.tsx` + route `app/admin/(shell)/settings/page.tsx`, `api/settings.ts`, `hooks/useAppSettings.ts` (query key prefix constant, e.g. `APP_SETTINGS_KEY`) | A new resource. A small settings form helper only if `pointsConfigForm.ts`'s integer parsing cannot be imported as is |

## Technical Approach
- **Data flow, write.** The `/items` card toggle calls `AppDataContext.setItemFeatured`, then `api/itemListingPreferences.ts::setItemFeatured`, then `PUT …/{item_id}/featured`. The service `set_item_featured` resolves the caller's profile, then inside `mapped_transaction_conflicts`:
  1. `require_item_visible` (404 for a missing or hidden item).
  2. Lock the Party row `FOR NO KEY UPDATE`, then the item (ownership → 403), then the preference (409 when missing).
  3. When featuring and not yet featured, read the limit via `settings_acl.max_featured_items`, then check limit 0, then count the others.
  4. Set or clear `featured_at`, commit, refresh, return the preference.
- **Data flow, read.** One column is added to the shared `item_listing_preferences_select`, to each consumer's outer select (Core Requirement 9) and to the `_my_items` select. Each response builder maps `is_featured = featured_at IS NOT NULL`. No extra statements, so the statement counts stay constant.
- **Ordering.** Done in SQL only (leading `featured_at DESC NULLS LAST`), plus the one client re-sort in `termViewModel`, which uses a stable `Array.prototype.sort` with the featured-first comparator. `eventViewModel` keeps the server order. The owner-page pagination stays deterministic because `item_id` is the final key.
- **Settings.** `load_settings` reads the singleton row fresh on every use, so a limit change applies to the next toggle. `update_settings` locks the row `FOR UPDATE`, compares `updated_at` (normalised to naive UTC), sets the value and commits. `app.main` mounts the router.
- **Boundaries.**
  - `app.settings` is imported only by `app/main.py` and `groups/infrastructure/settings_acl.py`.
  - Code in `app/settings` imports only `app.core`, `app.db` and `app.settings`.
  - Both rules are enforced in `tests/test_module_boundaries.py`.
- **Caching.** Personalised public routes keep `set_personalised_cache_headers`. The admin settings routes send no cache headers. The frontend settings mutation awaits invalidation of the settings key prefix.

## Implementation Guidance

### Testing Approach
- Write 2–8 focused tests per implementation step group. Test verification runs only the new and updated tests, not the entire suite.
- **Settings backend** (`tests/test_app_settings_api.py`):
  - Exact key set.
  - 403 for a non-admin.
  - 400 below 0 and above 20, with the Polish messages.
  - Round trip.
  - 409 on a stale `updated_at`.
  - Matrix row 74 resolution.
- **Migration** (`tests/test_featured_items_migration.py`): downgrade to 0109, then upgrade to head. Check the seed value 3, the CHECK, and the column and index present.
- **Toggle backend** (`tests/test_item_featured.py`):
  - Feature/unfeature round trip.
  - Draft → 409.
  - Someone else's visible item → 403; a missing item → 404; someone else's hidden PRIVATE item → 404.
  - A non-boolean `featured` → 400.
  - Cap → 409 with N (including the singular „1 rzecz” at limit 1), and limit 0 → 409.
  - Re-feature keeps `featured_at`.
  - A lowered limit keeps existing marks.
  - The mark is cleared by unlist and by a confirmed GIFT hand-over.
  - A two-session race at the cap lets only one succeed.
  - Optional: a two-session test where a toggle holds the owner's Party lock while another user takes that owner's item; neither may deadlock.
- **Ordering backend** (in the same file, or in the existing page test files):
  - Term page: the featured item comes first.
  - Event page: a featured item older than the 3 newest still appears in the window, and `items_total` is unchanged.
  - Owner items page: featured first in the „Wszystkie” tab and in a mode tab.
  - Organization or profile recent items: featured first.
- **Key-set updates (backend)**: `test_event_page.py`, `test_organizer_page.py`, `test_owner_items_page.py`, `test_item_visibility.py` (PREFERENCE_KEYS), `test_my_items_page.py`, `test_item_listing_status.py`, `test_public_term.py` (`PUBLIC_ITEM_LISTING_KEYS`, around l.698), `test_term_item_listings_router.py` (the exact `frozenset` of `/inventory-items/mine` rows, around l.265), and the item-actions shape tests. Also `test_authorization_matrix.py` (`/featured` → row 60, `/api/admin/settings` → row 74) and `test_module_boundaries.py`.
- **Frontend**:
  - `ItemTileBadges` renders the featured pill first, with ⭐ hidden from assistive tech.
  - `ItemCard` renders the featured corner badge.
  - `termViewModel` puts featured first before the slice, keeping the server's order among featured items.
  - `FeaturedToggle`: a stable `aria-label` „Wyróżnij: {itemName}” in both states, `aria-pressed` toggling, the visible text.
  - `AppDataContext.setItemFeatured`: the toast and refresh on a 409.
  - `AppDataContext.setItemMode`: after unlisting a featured item and listing it again, the featured chip and the pressed state are gone.
  - `SettingsPage`: load, inline validation, the 409 shown verbatim.
  - The `ItemHeader` pill.
  - Every typed fixture factory gains `is_featured` (no casts).

### Standards Compliance
- `standards/backend/models.md`:
  - Columns: naive-UTC `*_at` column, explicit `ck_`/`ix_`/`uq_` names, a `BaseEntity` singleton.
  - Cross-context access only through `infrastructure/*_acl.py`.
  - Every item path goes through `require_item_visible` first, so a hidden item returns 404 before 403/409.
  - Listing visibility stays safe by default (`include_private=False` untouched).
- `standards/backend/migrations.md`:
  - The nullable column in a separate revision from the new table.
  - A recorded schema+seed exception (0109 precedent).
  - `lock_timeout` in 0111.
  - Reverse-order downgrades, plain lossy because no guarded data exists.
  - A downgrade-then-upgrade test.
  - A runbook line in `architecture.md`.
- `standards/backend/queries.md`: ordering in SQL, no N+1, constant statement counts.
- `standards/backend/security.md`: new matrix row 74 (ADMIN), enforced with `Depends(require_any("ADMIN"))`; the toggle under row 60 (EDIT/`mcp:edit`).
- `standards/backend/api.md`: a sub-resource PUT, idempotent; plural resource naming.
- `standards/global/error-handling.md`: Polish 409s through `BusinessConflictException`, `mapped_transaction_conflicts`.
- `standards/global/validation.md`:
  - Server-side bounds.
  - An integer input as `type="text" inputMode="numeric" pattern="[0-9]*"`, with the inline `role="alert"` + `aria-invalid`/`aria-describedby`.
  - Submit disabled while invalid.
- `standards/global/minimal-implementation.md`: one settings key, no counter endpoint, no timestamp exposed.
- `standards/frontend/components.md`, `css.md`, `accessibility.md`:
  - Feature code in `src/features/`, a thin route file.
  - Tokens only.
  - `aria-pressed` on the toggle, `aria-hidden` emoji.
  - `{" "}` separators outside hidden spans.
- `standards/frontend/data-fetching.md`: the TanStack hook in `src/hooks/` wraps `src/api/settings.ts`; the mutation awaits invalidation of the prefix; server messages are passed through verbatim.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: integration-first tests, exact key sets, `test_<operation>_<scenario>_<expected>` naming, typed fixtures, explicit Vitest imports.

## Out of Scope
- Search ordering and a search badge; wants match, suggestion and similar cards.
- An owner-visible limit or an N/limit counter; any owner read of the limit.
- Changing the order of „Moje rzeczy”, or of the browse/mine term-item-listing lists.
- Paid or promoted featuring, featured expiry, admin moderation of featured items.
- Moving any existing setting into `app_settings`.
- Featuring drafts, or keeping a mark across unlist/relist.

## Success Criteria
- An owner can feature up to N listed items. The (N+1)-th attempt returns the 409 with N. At limit 0 every new featuring returns the "disabled" 409. A race at the cap never yields more than N featured items.
- On term, event, owner, profile and organization pages, featured items appear before all non-featured ones and most recently featured first. On the event and term previews they take the 3 slots.
- The badge shows in every listed placement and nowhere in search or on wants cards.
- An admin can change the limit on `/admin/settings`, and a stale save returns the 409 message. Non-admins get 403.
- Unlist and hand-over clear the mark. Lowering the limit keeps the existing marks.
- Migrations 0110–0111 upgrade and downgrade cleanly. All new and updated backend and frontend tests pass, with no new mypy, ruff, typecheck or ESLint findings beyond the recorded baseline.
