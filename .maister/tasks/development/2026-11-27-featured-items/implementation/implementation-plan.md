# Implementation Plan: Featured items („Wyróżnione rzeczy”)

## TL;DR
10 task groups and 58 steps. Groups 1–9 are active (53 steps); group 10 (renumbering at merge) is DEFERRED and must not run now.
Backend chain: 1 Database → 2 Settings module → 3 Toggle API → 4 Read model and ordering. Frontend: 5 badges and featured-first views (after 4) → 6 „Moje rzeczy” toggle (after 3 and 5). 7 Admin settings page needs only 2.
After that come 8 Docs, then 9 Test review. 10 runs only when this worktree is rebased onto main after the email module lands.
Expect about 40–52 feature tests. No commit steps: the work stays uncommitted.

## Key Decisions
- **Group 3 adds `is_featured` to `ItemListingPreferenceResponse`, and group 4 adds it to every other response.** The toggle's response needs the flag from the start. The read-model groups then share `repository.py`, `groups/schemas.py` and `term_item_listings.py` with group 3, so 4 depends on 3 and the two run one after the other.
- **Group 5 updates every frontend type and every typed fixture.** All six response interfaces gain `is_featured`, so `npm run typecheck` is green after group 5. Groups 6 and 7 then only add their own tests.
- **The featured items are seeded in tests through the real `PUT …/featured`, not through SQL.** This covers the write path end to end. Only the limit is changed through SQL or the admin PUT (the spec's `test_points_listing.py` race template).
- **The optional Party-lock-vs-take deadlock test is a candidate for group 9**, not one of group 3's 8 tests. Group 3 already uses its 8 tests for the required cases.
- **Group 10 is a real group with steps, but it is gated.** Its parent step reads DEFERRED, and it runs only on the merge condition (spec Req 25). The user chose to keep 0110/0111 and row 74 here.

## Open Questions / Risks
- **The merge collision is certain.** Main's uncommitted email module uses 0110–0112 and probably matrix row 74. If group 10 is skipped at merge, the result is two Alembic heads (or a revision-id clash) and a matrix test failure.
- **The exact key-set tests span about 10 backend files and 22 frontend fixture files.** Missing one fails loudly, and the fix is mechanical.
- **Two baselines are known to fail already:** 32 vitest + 2 stale backend tests, mypy 15 (`mypy app`) and ruff 64. Verification steps compare against these numbers. Only new findings count as failures.
- **Group 4's term-page builder location is not pinned down.** `PublicItemListingResponse` and `MyInventoryItemResponse` are built in `groups/application/term_item_listings.py` (from a grep). If a builder lives elsewhere, the implementer adds that file to the group.

## Overview
Total Steps: 58 (53 active + 5 deferred)
Task Groups: 10 (8 implementation + test review + 1 deferred)
Expected Tests: about 40–42 written in groups 1–7, plus at most 10 in group 9 = **about 40–52**. This is above the usual 16–34 guide because seven implementation groups span two stacks. Each group stays within 2–8 tests.

Commands (run from `src/backend`): `uv run --no-sync python -m pytest|mypy|ruff`. Never use `uv run <tool>`. The backend tests need Docker (testcontainers).
Commands (run from `src/frontend`): `npx vitest run <files>`, `npm run typecheck`, `npm run lint`.

**Secrets rule (applies to every step that touches configuration, Docker or the database):** never print secret values. No `env`, `printenv`, `cat .env` or `docker inspect` Env sections; check only whether a value is present. Never write secret values into tests, docs or the task folder.

## Implementation Steps

### Task Group 1: Database Layer (migrations 0110–0111, models)
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0110_app_settings.py`, `src/backend/alembic/versions/0111_featured_items.py`, `src/backend/app/settings/__init__.py`, `src/backend/app/settings/models.py`, `src/backend/app/groups/models.py`, `src/backend/tests/test_featured_items_migration.py`
**Estimated Steps:** 6

- [x] 1.0 Complete database layer
  - [x] 1.1 Write 2–3 focused tests in `tests/test_featured_items_migration.py` (template `tests/test_points_offers_migration.py`)
    - `test_downgradeTo0109ThenUpgradeHead_settingsAndFeaturedColumn_restored`: after the round trip, `app_settings` has exactly one row with `max_featured_items = 3`. The column `item_listing_preferences.featured_at` exists and is nullable. The index `ix_item_listing_preferences_owner_party_id_featured` exists with predicate `featured_at IS NOT NULL`.
    - `test_appSettingsCheck_outOfRange_rejected`: an UPDATE to 21 or to −1 raises an IntegrityError on `ck_app_settings_max_featured_items_range`. A second INSERT violates `uq_app_settings_singleton`.
    - Restore head in `finally` (`alembic upgrade head` + `engine.dispose()`), as the backend-testing standard requires.
  - [x] 1.2 Create `0110_app_settings.py` (revision `0110`, down_revision `0109`)
    - `app_settings` with BaseEntity columns: `id` UUID `pk_app_settings` with `server_default=gen_random_uuid()`, plus `created_at` and `updated_at` as naive UTC, NOT NULL.
    - `max_featured_items INTEGER NOT NULL`, guarded by `CHECK (max_featured_items BETWEEN 0 AND 20)` named `ck_app_settings_max_featured_items_range`.
    - The unique index `uq_app_settings_singleton` on `((true))` (pattern of `uq_points_config_singleton`).
    - Seed one row with an explicit `id`, `created_at` and `updated_at`, value 3 (the 0109 `_NOW_UTC` pattern).
    - The module docstring records the schema+seed exception: `load_settings` reads with `scalar_one()`, so a head with the table but no row would turn every featuring into a 500.
    - The downgrade drops the table.
  - [x] 1.3 Create `0111_featured_items.py` (revision `0111`, down_revision `0110`)
    - First run `SET LOCAL lock_timeout = '5s'` (the 0076 pattern).
    - Add `item_listing_preferences.featured_at TIMESTAMP NULL`, with no backfill.
    - Build the partial index `ix_item_listing_preferences_owner_party_id_featured` on `(owner_party_id) WHERE featured_at IS NOT NULL` in the migration's transaction, not concurrently. The docstring gives the reason: the table is small and the predicate matches no row yet.
    - The downgrade drops the index first, then the column. It is a plain, lossy downgrade.
  - [x] 1.4 Add the model `app/settings/models.py::AppSettings(BaseEntity)`, table `app_settings`
    - Mirror `app/points/models.py::PointsConfig`: `max_featured_items: Mapped[int]`, plus `__table_args__` with the CheckConstraint and the singleton Index under the same names as in the migration.
    - Keep `app/settings/__init__.py` empty.
  - [x] 1.5 Extend `groups/models.py::ItemListingPreference`
    - `featured_at: Mapped[datetime | None]` (naive UTC).
    - A read-only `is_featured` property (`featured_at is not None`), so that `from_attributes` responses can map it.
    - Mirror the partial index in `__table_args__` if the model already declares its indexes there.
  - [x] 1.6 Run only the group's tests: `uv run --no-sync python -m pytest tests/test_featured_items_migration.py` (needs Docker; secrets rule: no env dumps)

**Acceptance Criteria:**
- The 2–3 migration tests pass, and `alembic heads` shows a single head, `0111`.
- The downgrade to 0109 and the upgrade back to head both run cleanly.
- `ItemListingPreference.is_featured` and `AppSettings` import cleanly, with no new mypy errors in the touched files.

---

### Task Group 2: App Settings Module (backend `app/settings`, ADMIN API, matrix row 74)
**Dependencies:** 1
**Files to Modify:** `src/backend/app/settings/schemas.py`, `src/backend/app/settings/service.py`, `src/backend/app/settings/router.py`, `src/backend/app/main.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/app/groups/infrastructure/settings_acl.py`, `src/backend/tests/test_app_settings_api.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_module_boundaries.py`
**Estimated Steps:** 7

- [x] 2.0 Complete the settings module
  - [x] 2.1 Write 6–7 focused tests (template `tests/test_points_config_api.py`)
    - `test_getSettings_admin_returnsExactKeys` checks the key set `{max_featured_items, updated_at}` and the value 3.
    - `test_getSettings_nonAdmin_forbidden` checks that GET and PUT return 403 for a logged-in non-admin.
    - `test_putSettings_outOfRange_badRequestPolish` is parametrised over −1 → „Limit wyróżnionych rzeczy musi być liczbą całkowitą ≥ 0.” and 21 → „… ≤ 20.”.
    - `test_putSettings_nonInteger_badRequest` covers `1.5`, `"3"`, an extra field and a missing field.
    - `test_putSettings_roundTrip_persistsValue` checks that the PUT returns a new `updated_at` and that a later GET returns the new value.
    - `test_putSettings_staleUpdatedAt_conflict` checks the 409 message „Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.”.
    - In `tests/test_authorization_matrix.py`: GET and PUT `/api/admin/settings` resolve to row 74.
    - In `tests/test_module_boundaries.py`: the new `app.settings` import rule.
  - [x] 2.2 `app/settings/schemas.py`
    - `AppSettingsResponse {max_featured_items: int, updated_at: datetime}`.
    - `AppSettingsUpdateRequest` (`extra="forbid"`, `max_featured_items: StrictInt`, `updated_at: datetime`).
  - [x] 2.3 `app/settings/service.py`, mirroring `points/application/config.py`
    - `load_settings(db)` reads the row fresh with `scalar_one()`.
    - `max_featured_items(db) -> int`.
    - `update_settings(db, request)`:
      - Check the bounds first, with the Polish 400s.
      - Lock the row `FOR UPDATE`, then compare `updated_at` normalised to naive UTC; a mismatch raises `AppSettingsChangedException` (409, the `BusinessConflictException` family).
      - Set the value, commit and refresh. All of this runs inside `app/db.py::mapped_transaction_conflicts`.
  - [x] 2.4 `app/settings/router.py`
    - `GET` and `PUT /api/admin/settings` with `Depends(require_any("ADMIN"))`, and no cache headers (as for the points config).
    - Mount the router in `app/main.py` next to `points_router`.
  - [x] 2.5 Matrix row 74 in `app/core/authorization_matrix.py`
    - `(_methods("GET", "PUT"), r"^/api/admin/settings$", ("ADMIN",)),  # 74`, with a short comment, placed before the catch-all.
    - It must not be shadowed by an earlier row. First match wins, so verify it with the test from 2.1.
  - [x] 2.6 ACL `app/groups/infrastructure/settings_acl.py::max_featured_items(db)`, delegating to `app.settings.service`
    - The boundary rule: `app.settings` is imported only by `app/main.py` and `groups/infrastructure/settings_acl.py`, and code in `app/settings` imports only `app.core`, `app.db` and `app.settings`.
  - [x] 2.7 Run only `tests/test_app_settings_api.py tests/test_authorization_matrix.py tests/test_module_boundaries.py`

**Acceptance Criteria:**
- The 6–7 tests pass, including row 74 resolution and the boundary rule.
- Non-admins get 403, a stale save gets the Polish 409, and an out-of-range value gets the Polish 400.
- The router is mounted, and `uv run --no-sync python -m mypy app` shows no new errors beyond the baseline of 15.

---

### Task Group 3: Featured Toggle API (backend write path)
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/router/term_item_listings.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/infrastructure/repository.py`, `src/backend/tests/test_item_featured.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 6

- [x] 3.0 Complete the featured toggle
  - [x] 3.1 Write 8 focused tests in `tests/test_item_featured.py`, plus one matrix assertion
    - `test_setItemFeatured_featureUnfeatureRefeature_keepsFeaturedAt`: a round trip returns `is_featured`. Re-featuring an item that is already featured keeps the stored `featured_at` and skips the cap.
    - `test_setItemFeatured_draft_conflict` checks the 409 „Wystaw rzecz, aby ją wyróżnić.”.
    - `test_setItemFeatured_notOwnerOrHidden_notFoundBeforeForbidden` covers three cases: someone else's visible item → 403, a missing item → 404, someone else's hidden PRIVATE listing → 404.
    - `test_setItemFeatured_nonBoolean_badRequest` is parametrised over `1`, `"true"`, `{}` and an extra field.
    - `test_setItemFeatured_capReached_conflictWithPluralN` covers three cases:
      - At limit 3, the 4th featuring gets „Możesz wyróżnić maksymalnie 3 rzeczy.”.
      - At limit 1, the 2nd gets „Możesz wyróżnić maksymalnie 1 rzecz.”.
      - PRIVATE listings count toward the cap.
    - `test_setItemFeatured_limitZero_disabledButUnfeatureAllowed` checks the 409 „Wyróżnianie rzeczy jest teraz wyłączone.” and that unfeaturing still returns 200.
    - `test_setItemFeatured_limitLowered_keepsExistingMarks`: feature 3 items, set the limit to 1, and all 3 stay featured while a new featuring gets the 409.
    - `test_setItemFeatured_unlistOrHandOver_clearsMark`:
      - Unlisting with `mode: null` and then relisting gives `is_featured` false.
      - A mode or visibility PUT keeps the mark.
      - A confirmed GIFT hand-over deletes the preference row.
    - `test_setItemFeatured_concurrentAtCap_onlyOneSucceeds`: a second-`AsyncSession` race (template `tests/test_points_listing.py`), where exactly one call succeeds and the other gets the 409.
    - In `tests/test_authorization_matrix.py`: `PUT /api/item-listing-preferences/{id}/featured` resolves to row 60.
  - [x] 3.2 Schemas in `groups/schemas.py`
    - `SetItemFeaturedRequest {featured: StrictBool}` with `extra="forbid"`.
    - Add `is_featured: bool` to `ItemListingPreferenceResponse`, read from the model property, so the timestamp is never exposed.
  - [x] 3.3 Repository helper `lock_owner_party(db, party_id)` in `groups/infrastructure/repository.py`
    - `select(Party.id).where(Party.id == party_id).with_for_update(key_share=True)`, which is `FOR NO KEY UPDATE`.
    - Add one comment saying why this is not the plain `FOR UPDATE` of `media/service.py::_lock_owner`: it must not conflict with the `FOR KEY SHARE` that inserts referencing the Party take.
  - [x] 3.4 Service `set_item_featured(db, principal, item_id, featured)` in `groups/application/term_item_listings.py`
    - Resolve the caller's profile.
    - Inside `mapped_transaction_conflicts`, in this order:
      1. `item_visibility.require_item_visible(db, item_id, profile.party_id)` → 404.
      2. `lock_owner_party`.
      3. `inventory_bridge.get_item_for_update` + the same PERSONAL-inventory ownership check as `set_item_listing_preference` → 403.
      4. `repository.lock_item_listing_preference` → none → 409 (draft).
      5. Only when featuring and `featured_at is None`:
         - Read `settings_acl.max_featured_items(db)`; 0 → 409 "disabled".
         - Count the other featured preferences with the same `owner_party_id`, excluding this item (template `_count_other_points_offers`, which uses the partial index). If the count is `>= limit` → 409 from a small `_featured_cap_message(n)` helper: n == 1 → „1 rzecz”, else „{n} rzeczy”.
         - Set `featured_at = datetime.utcnow()`.
      6. When unfeaturing, set `featured_at = None`; this is always allowed and a no-op when the item is not featured.
      7. Commit, refresh, return.
    - The toggle never takes point accounts.
  - [x] 3.5 Route `PUT /api/item-listing-preferences/{item_id}/featured` in `groups/router/term_item_listings.py`
    - Use the same principal dependency as the existing preference PUT (row 60: EDIT / `mcp:edit`).
    - Return `ItemListingPreferenceResponse`.
  - [x] 3.6 Run only `tests/test_item_featured.py` and `tests/test_authorization_matrix.py`

**Acceptance Criteria:**
- The 8 tests pass, and the error order 404 → 403 → draft 409 → limit-0 409 → cap 409 holds.
- A race at the cap never leaves more than N featured items.
- The lock order is visibility check, then Party `FOR NO KEY UPDATE`, then item, then preference. Point accounts are never locked.

---

### Task Group 4: Featured Read Model & Ordering (backend reads)
**Dependencies:** 1, 3
**Files to Modify:**
- Groups: `src/backend/app/groups/infrastructure/repository.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/item_actions.py`
- Events: `src/backend/app/events/page.py`, `src/backend/app/events/schemas.py`, `src/backend/app/events/infrastructure/groups_acl.py`
- Pages: `src/backend/app/pages/schemas.py`, `src/backend/app/pages/application/owner_pages.py`, `src/backend/app/pages/application/organization_page.py`, `src/backend/app/pages/infrastructure/groups_acl.py`
- New test: `src/backend/tests/test_featured_items_ordering.py`
- Key-set tests: `src/backend/tests/test_event_page.py`, `test_organizer_page.py`, `test_owner_items_page.py`, `test_item_visibility.py`, `test_my_items_page.py`, `test_item_listing_status.py`, `test_public_term.py`, `test_term_item_listings_router.py`, `test_item_actions.py`, `test_party_profile.py` (all under `src/backend/tests/`)

**Estimated Steps:** 6

- [x] 4.0 Complete the read model and the featured-first ordering
  - [x] 4.1 Write 6 focused tests in `tests/test_featured_items_ordering.py`, seeding featured items through `PUT …/featured`
    - `test_publicTerm_featuredItem_listedFirstWithFlag`: on the term page, the lister's featured item comes first and carries `is_featured`.
    - `test_eventPage_featuredOlderItem_insidePreviewWindow`: a featured item older than the 3 newest is inside the 3-item window, and `items_total` is unchanged.
    - `test_ownerItemsPage_featuredFirst_inAllAndModeTab`: featured items come first, most recently featured first, in the „Wszystkie” tab and in a mode tab.
    - `test_organizationOrProfileRecentItems_featuredFirst`: the shared `list_owner_listed_items_page`, as seen through the profile or organization recent items.
    - `test_itemActions_featuredListing_isFeaturedForGuestAndViewer`.
    - `test_myItems_featuredListedTrue_draftFalse`: in „Moje rzeczy” the order is unchanged (newest first).
  - [x] 4.2 Update the exact key-set assertions to include `is_featured`
    - The files: `test_event_page.py`, `test_organizer_page.py`, `test_owner_items_page.py`, `test_item_visibility.py` (PREFERENCE_KEYS), `test_my_items_page.py`, `test_item_listing_status.py`, `test_public_term.py` (`PUBLIC_ITEM_LISTING_KEYS`, about l.698), `test_term_item_listings_router.py` (`/inventory-items/mine` frozenset, about l.265), `test_item_actions.py`, and `test_party_profile.py` where it pins card keys.
    - Update the sets; never loosen them.
  - [x] 4.3 Repository (`groups/infrastructure/repository.py`)
    - `item_listing_preferences_select` gains `featured_at`.
    - The outer selects gain the column too: `list_listed_items_for_parties` (about l.1001–1036), `_owner_listed_items` (about l.1234–1253) and `_my_items` (l.908).
    - The leading order key becomes `featured_at DESC NULLS LAST` in:
      - `list_listed_items_for_parties`: then `created_at, item_id`.
      - `list_owner_listed_items_page`, in every mode tab: then `created_at DESC, item_id`.
    - Docstrings that name the old order are updated.
    - Unchanged: the `_my_items` order, search, and the browse/mine term-item-listing lists.
  - [x] 4.4 Event page (`events/page.py::_listed_items_by_party`, l.58–95)
    - The `row_number()` window order becomes `featured_at DESC NULLS LAST, created_at DESC, item_id`.
    - The outer select gains `featured_at`, passed through `events/infrastructure/groups_acl.py` if it projects the columns.
    - The docstring "3 newest" becomes "featured first, then newest".
    - `EventParticipantItemResponse` gains `is_featured: bool`.
  - [x] 4.5 Map `is_featured = featured_at is not None` in each response; never expose the timestamp
    - `PublicItemListingResponse` and `MyInventoryItemResponse` (false for drafts), built in `term_item_listings.py`.
    - `OwnerItemCardResponse`, through `pages/infrastructure/groups_acl.py`, `owner_pages.py` and `organization_page.py`.
    - `ItemActionsResponse`: `preference is not None and preference.featured_at is not None` in `item_actions.py`.
    - The R8 points allowlist is unchanged, and no extra statements are added.
  - [x] 4.6 Run only the group's test files: the new file, the 10 key-set files listed above, and `test_organizer_page_queries.py` (the statement counts stay constant)

**Acceptance Criteria:**
- The 6 new tests and the updated key-set tests pass.
- Featured items lead the term, event, owner, profile and organization lists, most recently featured first. The 3-item event preview is filled with featured items first.
- The statement-count tests are unchanged. Search, wants cards and the order of „Moje rzeczy” are unchanged.

---

### Task Group 5: Frontend Featured Badges & Featured-First Views
**Dependencies:** 4
**Files to Modify:**
- API types: `src/frontend/src/api/events.ts`, `src/frontend/src/api/groups.ts`, `src/frontend/src/api/inventories.ts`, `src/frontend/src/api/itemActions.ts`, `src/frontend/src/api/itemListingPreferences.ts`, `src/frontend/src/api/ownerItems.ts`, `src/frontend/src/api/organizations.ts` (only if it declares the recent-item card type)
- Shared components: `src/frontend/src/components/shared/ItemTileBadges.tsx`, `src/frontend/src/components/shared/ItemCard.tsx`, `src/frontend/src/components/shared/ParticipantItemsPreview.tsx`
- Feature views: `src/frontend/src/features/terms/termViewModel.ts`, `src/frontend/src/features/events/eventViewModel.ts`, `src/frontend/src/features/items/blocks/OwnerItemsList.tsx`, `src/frontend/src/features/profile-public/blocks/ProfileItems.tsx`, `src/frontend/src/features/organization-public/blocks/RecentItemsBlock.tsx`, `src/frontend/src/features/organization-public/layouts/layoutData.ts`, `src/frontend/src/features/product/blocks/ItemHeader.tsx`
- Tests: `src/frontend/src/test/ItemTileBadges.test.tsx`, `ItemCard.test.tsx`, `termViewModel.test.ts`, `ItemHeaderFeatured.test.tsx` (new), `OwnerItemsPage.test.tsx`
- Typed fixtures: `AppDataContextItemMode.test.tsx`, `AppPage.test.tsx`, `EventComponents.test.tsx`, `itemActionsViewState.test.ts`, `ItemCreateView.test.tsx`, `ItemDetailPage.test.tsx`, `ItemEditView.test.tsx`, `LayoutRenderer.test.tsx`, `listingThumb.test.tsx`, `myItemsPageMock.ts`, `MyItemsView.test.tsx`, `MyItemsViewCategory.test.tsx`, `organizationLayoutFixtures.ts`, `OrganizerItemRoute.test.tsx`, `PartyProfilePage.test.tsx`, `ssrSafety.test.tsx`, `TermPage.test.tsx`, `useItemActions.test.tsx`, `useItemTake.test.tsx`, `useMyItemsPage.test.tsx` (all under `src/frontend/src/test/`)

**Visual References:**
- mockup: analysis/design-context/mockups/strona-terminu-wyr-nione-pierwsze.html
  element: screen:term-page-featured-first
  locator: "#mockup-content" lines 216–224 (the „Kto przychodzi” participant previews; row 220 Anna's 3-item preview, row 222 the reserved+featured Hulajnoga)
  acceptance: In each lister's preview (max 3) the featured items come first, then the rest newest first. A reserved item keeps its pill. Pill order: „⭐ Wyróżnione”, then the mode pill, then the reservation pill.
- mockup: analysis/design-context/mockups/strona-terminu-wyr-nione-pierwsze.html
  element: component:featured-pill
  locator: `.pill.featured` spans in lines 220–222
  acceptance: The first pill reads „⭐ Wyróżnione” in the current PILL_SIZE shape, with `bg-ink text-on-ink`. ⭐ sits in an `aria-hidden` span with the `{" "}` separator outside it. Tokens only, no hex colours (`themeTokenUsage.test.tsx`). The row renders even with no mode and no reservation.
- mockup: analysis/design-context/mockups/strona-eventu-wyr-nione-pierwsze.html
  element: screen:event-page-featured-first
  locator: "#mockup-content" lines 216–224 (the „Uczestnicy” previews; row 222 the all-featured 3-item preview with „Pokaż więcej (5)”)
  acceptance: The preview keeps the server's order (featured first), the featured pill shows on each featured row, and the „Pokaż więcej (N)” count is unchanged.
- mockup: analysis/design-context/mockups/strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.html
  element: screen:owner-items-featured-first
  locator: "#mockup-content" lines 223–239 (the tile grid; featured tiles at lines 226 and 228)
  acceptance: Featured tiles come first in every tab, and on the profile items and the organization recent items too.
- mockup: analysis/design-context/mockups/strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.html
  element: component:item-card-featured-marker
  locator: `.cb.r.featured` corner badge in lines 226–228
  acceptance: The right-corner badge reads „⭐ Wyróżnione” in the existing `CORNER_BADGE`/marker slot, with `bg-ink text-on-ink` and ⭐ `aria-hidden`. It takes precedence over `marker`. The mode badge stays in the left corner.
- mockup: analysis/design-context/mockups/strona-produktu-badge.html
  element: screen:product-page-featured-badge
  locator: "#mockup-content" lines 217–218 (the header pills row)
  acceptance: An md pill „⭐ Wyróżnione” sits before the mode pills and is visible to every viewer. It is hidden while loading and when `view.kind === "hidden"`. The wrapper renders when `mode || featured || reservation || isPrivate || statusAsPill`.

**Estimated Steps:** 8

- [x] 5.0 Complete the featured badges and the featured-first views
  - [x] 5.1 Write 7 focused tests (explicit `import { describe, expect, it } from "vitest"`, typed fixtures, no `as` casts)
    - `ItemTileBadges.test.tsx`:
      - The featured pill renders first, ⭐ is inside `aria-hidden`, and the accessible text is „Wyróżnione”.
      - The row renders when only `featured` is set.
    - `ItemCard.test.tsx`: the featured corner badge renders and wins over `marker`.
    - `termViewModel.test.ts`: featured items come first before the slice to 3, keeping the server's relative order among them; the rest follow newest first; a 4th featured item is cut by the slice.
    - `ItemHeaderFeatured.test.tsx`:
      - The md pill shows when `is_featured` is true.
      - The pill is absent when `view.kind` is hidden or loading.
    - `OwnerItemsPage.test.tsx`: a featured card shows the corner badge.
  - [x] 5.2 Add `is_featured: boolean` to the response types and update every typed fixture
    - The types: `EventParticipantItem`, `PublicItemListingResponse`, `MyInventoryItemResponse`, `ItemActionsResponse`, `ItemListingPreferenceResponse`, `OwnerItemCard`, and the recent-item type if separate.
    - Update every typed fixture factory in the listed test files with `is_featured: false` by default, without casts.
    - `npm run typecheck` must show 0 errors.
  - [x] 5.3 `ItemTileBadges` gains a `featured` prop and renders the first pill (see the `component:featured-pill` acceptance above)
  - [x] 5.4 `ItemCard` gains a `featured` prop and renders the corner badge in the marker slot (see the `component:item-card-featured-marker` acceptance above)
  - [x] 5.5 Featured flag and order in the term and event previews
    - `ParticipantItemsPreview`: `ParticipantPreviewItem` gains `featured`, passed to `ItemTileBadges`.
    - `termViewModel.ts::buildAttendees`: a stable `sort` with a featured-first comparator, then newest first, applied before `slice(0, PREVIEW_ITEM_LIMIT)`.
    - `eventViewModel.ts`: map `is_featured` and keep the server's order.
  - [x] 5.6 Pass `featured={item.is_featured}` to `ItemCard` on the owner pages
    - `OwnerItemsList.tsx`, `ProfileItems.tsx`, and `RecentItemsBlock.tsx` (+ `layoutData.ts` mapping).
    - Not on search cards and not on wants cards.
  - [x] 5.7 `ItemHeader.tsx`
    - `featured` is gated on `view.kind` exactly like `mode`: false while loading or hidden, else `actions.data?.is_featured`.
    - Render the md pill before the mode pills, and widen the wrapper condition.
  - [x] 5.8 Run only the group's tests: `npx vitest run src/test/ItemTileBadges.test.tsx src/test/ItemCard.test.tsx src/test/termViewModel.test.ts src/test/ItemHeaderFeatured.test.tsx src/test/OwnerItemsPage.test.tsx`, then `npm run typecheck` and `npm run lint` (no new findings)

**Acceptance Criteria:**
- The 7 tests pass, typecheck shows 0 errors, and lint shows no new findings.
- Every `acceptance` item in the Visual References above holds.
- The badge appears on the term and event previews, the owner, profile and organization cards, and the product header. It does not appear on search or wants cards.

---

### Task Group 6: Frontend „Moje rzeczy” Featured Toggle
**Dependencies:** 3, 5
**Files to Modify:** `src/frontend/src/api/itemListingPreferences.ts`, `src/frontend/src/features/items/FeaturedToggle.tsx`, `src/frontend/src/features/items/MyItemsView.tsx`, `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/panel/appDataStore.ts` (only if the context value type lives there), `src/frontend/src/test/FeaturedToggle.test.tsx`, `src/frontend/src/test/AppDataContextItemFeatured.test.tsx`, `src/frontend/src/test/AppDataContextItemMode.test.tsx`, `src/frontend/src/test/MyItemsView.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/moje-rzeczy-prze-cznik-wyr-nij.html
  element: screen:my-items-featured-toggle
  locator: "#mockup-content" lines 229–265 (card chip row at line 234, featured-on card toggle lines 239–240, featured-off card lines 252–253, draft card without the toggle, note at line 265)
  acceptance: The toggle sits beside the existing „Publiczna | Prywatna” `VisibilityToggle`, only on listed items (never on drafts). There is no N/limit counter. A featured card shows the „⭐ Wyróżnione” chip as the first chip in its chip row.
- mockup: analysis/design-context/mockups/moje-rzeczy-prze-cznik-wyr-nij.html
  element: component:featured-toggle
  locator: `button.star` / `button.star.on` at lines 239–240 and 252–253
  acceptance:
    - `type="button"` with the stable `aria-label` „Wyróżnij: {itemName}” in both states. The state is carried only by `aria-pressed`.
    - The visible text is „⭐ Wyróżnij” when off and „⭐ Wyróżnione” when on (ink tone `bg-ink text-on-ink`), with ⭐ `aria-hidden`.
    - Native `disabled` only while busy. Shown even when the limit is 0.
- mockup: analysis/design-context/mockups/moje-rzeczy-limit-osi-gni-ty.html
  element: screen:my-items-featured-errors
  locator: "#mockup-content" lines 229–245 (the toasts at lines 229 and 244, the note at line 245)
  acceptance:
    - A 409 shows the server message verbatim („Możesz wyróżnić maksymalnie 3 rzeczy.” / „Wyróżnianie rzeczy jest teraz wyłączone.”) in the existing bottom `ToastPill` (`bg-ink`), not in the red top toast drawn in the mockup.
    - The fallback message is „Nie udało się zapisać wyróżnienia — spróbuj ponownie”.
    - After the error the list refreshes (`refreshItems()`).

**Estimated Steps:** 6

- [x] 6.0 Complete the „Moje rzeczy” toggle
  - [x] 6.1 Write 6 focused tests
    - `FeaturedToggle.test.tsx`:
      - The `aria-label` „Wyróżnij: Rower” is the same in both states, `aria-pressed` toggles, and the visible text changes.
      - The button is `disabled` only while busy.
    - `MyItemsView.test.tsx`:
      - The toggle shows only on listed cards, not on drafts.
      - The featured chip is the first chip.
    - `AppDataContextItemFeatured.test.tsx`:
      - A success updates the item's `is_featured`.
      - A 409 shows the server message in the toast and calls `refreshItems`.
    - `AppDataContextItemMode.test.tsx`: unlisting a featured item and listing it again leaves `is_featured` false, with the chip and the pressed state gone.
  - [x] 6.2 `api/itemListingPreferences.ts::setItemFeatured(itemId, featured)` sends `PUT /api/item-listing-preferences/{itemId}/featured` with `{featured}` and returns `ItemListingPreferenceResponse`
  - [x] 6.3 `features/items/FeaturedToggle.tsx` (tone, size and test template from `VisibilityToggle`; see the `component:featured-toggle` acceptance above)
  - [x] 6.4 `AppDataContext.tsx`
    - `setItemFeatured(itemId, featured)` follows the `itemsSeqRef` pattern of `setItemVisibility`. On error it calls `showToast(serverMessageOr(err, "Nie udało się zapisać wyróżnienia — spróbuj ponownie"))` and then `refreshItems()`.
    - `setItemMode` sets `is_featured: saved?.is_featured ?? false`.
    - `setItemVisibility` sets `is_featured` from `saved?.is_featured` when a preference is returned.
    - Expose `setItemFeatured` on the context.
  - [x] 6.5 `MyItemsView.tsx`
    - Render `FeaturedToggle` beside `VisibilityToggle` for listed items only.
    - Render the „⭐ Wyróżnione” chip as the first chip in the card chip row, reusing the pill classes of `ItemTileBadges`.
  - [x] 6.6 Run only the 4 test files of the group, then `npm run typecheck`

**Acceptance Criteria:**
- The 6 tests pass and typecheck shows 0 errors.
- The toggle, the chip and the toast behave as in the Visual References `acceptance` items above.
- The chip and the toggle never go stale after unlist and relist.

---

### Task Group 7: Frontend Admin Settings Page (`/admin/settings`)
**Dependencies:** 2
**Files to Modify:** `src/frontend/src/api/settings.ts`, `src/frontend/src/hooks/useAppSettings.ts`, `src/frontend/src/features/admin/SettingsPage.tsx`, `src/frontend/src/features/admin/settingsForm.ts` (only if `pointsConfigForm.ts` parsing cannot be imported as is), `src/frontend/src/app/admin/(shell)/settings/page.tsx`, `src/frontend/src/components/layout/Sidebar.tsx`, `src/frontend/src/components/layout/MobileDrawer.tsx`, `src/frontend/src/test/SettingsPage.test.tsx`, `src/frontend/src/test/Sidebar.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/panel-admina-ustawienia.html
  element: screen:admin-settings
  locator: "#mockup-content" lines 228–237 (nav at line 228, heading and subtitle at line 229, the „Wyróżnione rzeczy” fieldset lines 230–233, the 409 alert, the validation-error state at line 237)
  acceptance:
    - Heading and section: heading „Ustawienia”, subtitle „Ogólne ustawienia aplikacji”, fieldset/section „Wyróżnione rzeczy”.
    - The field: label „Limit wyróżnionych rzeczy” on an input with `type="text" inputMode="numeric" pattern="[0-9]*"` and the raw string in state.
    - The help text: „Ile rzeczy jeden użytkownik może wyróżnić naraz (0–20). 0 = wyróżnianie wyłączone. Po zmniejszeniu limitu istniejące wyróżnienia zostają.”.
    - Invalid input:
      - An inline `role="alert"` error, for example „Limit wyróżnionych rzeczy musi być liczbą całkowitą ≤ 20.”.
      - `aria-invalid` and `aria-describedby` on the input.
      - Save disabled while the field is invalid.
    - The server's 409 and 400 messages are shown verbatim.
    - The nav entry „Settings” sits right after „Points” in both `Sidebar` and `MobileDrawer`. The other entries keep their current positions, even where the mockup orders them differently.

**Estimated Steps:** 6

- [x] 7.0 Complete the admin settings page
  - [x] 7.1 Write 5 focused tests
    - `SettingsPage.test.tsx`:
      - The page loads and shows the value 3.
      - Typing `25` shows the ≤ 20 alert with `aria-invalid`, and Save is disabled.
      - Typing `abc` or an empty value shows an inline error.
      - A 409 from `updateAppSettings` is shown verbatim.
    - `Sidebar.test.tsx`: an admin sees „Settings” right after „Points”, linking to `/admin/settings`.
  - [x] 7.2 `api/settings.ts`
    - `AppSettingsResponse {max_featured_items: number; updated_at: string}`.
    - `getAppSettings()` → `GET /api/admin/settings`.
    - `updateAppSettings(body)` → `PUT`.
  - [x] 7.3 `hooks/useAppSettings.ts`
    - The prefix constant `APP_SETTINGS_KEY`.
    - The mutation awaits `invalidateQueries` on the prefix.
    - App-shaped return: `data`, `loading = isPending`, `error: string | null`, `refetch`.
    - `extractProblemMessage` errors are passed through verbatim (template `usePointsConfig`).
  - [x] 7.4 `features/admin/SettingsPage.tsx`, Chakra like `PointsConfigPage`
    - Reuse the integer parsing and rules of `pointsConfigForm.ts` (or `parseCapacity`).
    - Add a small `settingsForm.ts` only if those cannot be imported.
    - Save sends the `updated_at` the client read.
  - [x] 7.5 The route and the nav entries
    - The route `app/admin/(shell)/settings/page.tsx` is a thin page like `points/page.tsx`.
    - `NavItem` / `MobileNavItem` `to="/admin/settings" label="Settings"` sit right after the Points entries (`Sidebar.tsx:90`, `MobileDrawer.tsx:99`), with a lucide settings icon, for `isAdmin` only.
  - [x] 7.6 Run only `src/test/SettingsPage.test.tsx src/test/Sidebar.test.tsx`, then `npm run typecheck` and `npm run lint`

**Acceptance Criteria:**
- The 5 tests pass, typecheck shows 0 errors, and lint shows no new findings.
- Every `acceptance` item for `screen:admin-settings` holds.
- A non-admin has no nav entry, and the API's 403 applies.

---

### Task Group 8: Project Documentation (architecture + INDEX)
**Dependencies:** 1, 2, 3, 4, 7
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 4

- [x] 8.0 Complete the documentation
  - [x] 8.1 Write the verification checks first: a grep checklist of strings that must appear in `architecture.md` and `INDEX.md`
    - The strings: `app/settings`, `app_settings`, `row 74`, `featured_at`, `FOR NO KEY UPDATE`, `featured_at DESC NULLS LAST`, `0110`, `0111`, `downgrade 0109`.
    - No secret values in either file (secrets rule).
  - [x] 8.2 `architecture.md`
    - The `app/settings` module (a single-row `app_settings`, boundaries, the `settings_acl`).
    - Matrix row 74.
    - The featured-items rules:
      - The toggle endpoint and its error order.
      - The Party lock `FOR NO KEY UPDATE` and why.
      - The mark is cleared with the listing row.
      - Featured first on the term, event, owner, profile and organization pages; search, wants and „Moje rzeczy” unchanged.
    - The 0110–0111 runbook line:
      - `pg_dump` first, and backend before web.
      - No image-only rollback past 0111.
      - `downgrade 0109` from the new image is unguarded and loses every featured mark and the settings row.
  - [x] 8.3 `INDEX.md`: a matching summary sentence in the Architecture entry
  - [x] 8.4 Run the 8.1 checklist (grep) and confirm every string is present

**Acceptance Criteria:**
- Every checklist string is present, the docs match the implemented behaviour, and the docs contain no secrets.

---

### Task Group 9: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8
**Files to Modify:** `src/backend/tests/test_item_featured.py`, `src/backend/tests/test_featured_items_ordering.py`, `src/frontend/src/test/*Featured*.test.tsx`, `src/frontend/src/test/SettingsPage.test.tsx`
**Estimated Steps:** 4

- [x] 9.0 Review and fill the critical gaps
  - [x] 9.1 Review the tests from groups 1–7 (about 40–42)
  - [x] 9.2 Analyse the gaps for this feature only. Candidates:
    - A two-session test where a toggle holds the owner's Party lock while another user takes or proposes on that owner's item, and neither deadlocks.
    - SWAP and POINTS confirmed hand-overs clear the mark.
    - Search results and wants cards carry no `is_featured`, and the search order is unchanged.
    - A logged-in `initialToken` render of the product header in `ssrSafety`.
    - The R8 probe is still green.
  - [x] 9.3 Write at most 10 additional strategic tests
  - [x] 9.4 Run only the feature tests (backend: the new and updated files from groups 1–4; frontend: the files from groups 5–7). Then compare against the baselines:
    - `uv run --no-sync python -m mypy app` ≤ 15 errors.
    - `uv run --no-sync python -m ruff check .` ≤ 64.
    - `npm run typecheck` 0 errors, and lint shows no new findings.
    - The 32 vitest failures and the 2 stale backend tests that already fail are not counted as new.
    - Secrets rule: presence checks only.

**Acceptance Criteria:**
- All feature tests pass (about 40–52 in total), and no more than 10 tests were added in this group.
- No new mypy, ruff, typecheck or ESLint findings beyond the recorded baseline.

---

### Task Group 10: Migration & Matrix Renumbering at Merge — DEFERRED (conditional, do NOT run now)
**Dependencies:** 1–9, **and** the condition: this worktree is being rebased onto or merged into `main` after main's email module (migrations 0110–0112, probably matrix row 74) has landed
**Files to Modify:** `src/backend/alembic/versions/0110_app_settings.py` (renamed), `src/backend/alembic/versions/0111_featured_items.py` (renamed), `src/backend/tests/test_featured_items_migration.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_authorization_matrix.py`, `.maister/docs/project/architecture.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 5

- [~] 10.0 DEFERRED (merge renumber, not run now): DEFERRED: renumber the migrations and the matrix row past main's email module (spec Req 25)
  - The executor skips this group during this workflow and leaves it unchecked.
  - Run it only when the merge condition above is met; the operator triggers it.
  - [~] 10.1 DEFERRED (merge renumber, not run now): Update the tests first
    - `test_featured_items_migration.py`: the downgrade target becomes main's head (for example `0112` instead of `0109`), and the assertions name the new revision ids.
    - `test_authorization_matrix.py`: the settings routes expect the next free row number (for example 75), and the `/featured` route still expects row 60.
  - [~] 10.2 DEFERRED (merge renumber, not run now): Rename and re-chain the migrations
    - Rename the files to the next free numbers (for example `0113_app_settings.py` and `0114_featured_items.py`).
    - Update `revision` and `down_revision`: the first new revision points at main's head, the second at the first.
    - Update the docstrings that refer to the old numbers.
    - Confirm that `alembic heads` shows exactly one head.
  - [~] 10.3 DEFERRED (merge renumber, not run now): Renumber the matrix row: change the row comment and its explanatory comment in `authorization_matrix.py` to the new number, and keep it before the catch-all
  - [~] 10.4 DEFERRED (merge renumber, not run now): Update the docs: the runbook line in `architecture.md` (the revision numbers, the downgrade target `downgrade <main head>`, the matrix row) and the `INDEX.md` summary
  - [~] 10.5 DEFERRED (merge renumber, not run now): Run `tests/test_featured_items_migration.py`, `tests/test_authorization_matrix.py` and the email module's migration test, then `alembic heads` (needs Docker; secrets rule: no env dumps)

**Acceptance Criteria:**
- A single Alembic head, and no duplicate revision ids or matrix row numbers.
- The migration and matrix tests pass on the merged tree, and the docs name the new numbers.

## Execution Order

1. Database Layer (6 steps)
2. App Settings Module (7 steps, depends on 1)
3. Featured Toggle API (6 steps, depends on 1, 2)
4. Featured Read Model & Ordering (6 steps, depends on 1, 3)
5. Frontend Featured Badges & Featured-First Views (8 steps, depends on 4)
6. Frontend „Moje rzeczy” Featured Toggle (6 steps, depends on 3, 5)
7. Frontend Admin Settings Page (6 steps, depends on 2)
8. Project Documentation (4 steps, depends on 1, 2, 3, 4, 7)
9. Test Review & Gap Analysis (4 steps, depends on 1–8)
10. Migration & Matrix Renumbering at Merge (5 steps). DEFERRED: it runs only at merge, after 1–9.

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`:
  - Error handling: Polish 409s through `BusinessConflictException` and `mapped_transaction_conflicts`.
  - Validation: StrictBool/StrictInt, server-side bounds, and the numeric text input pattern.
  - Minimal implementation: one settings key, no counter endpoint, no exposed timestamp.
  - Commenting: a comment only on the `FOR NO KEY UPDATE` choice.
- `backend/`:
  - `models.md`: BaseEntity singleton, naive-UTC `featured_at`, cross-context access only through `settings_acl`, `require_item_visible` first.
  - `migrations.md`: the column in a separate revision from the table, the recorded schema+seed exception, `lock_timeout`, reverse-order downgrades, the migration test, the runbook line.
  - `queries.md`: ordering in SQL and constant statement counts.
  - `security.md`: row 74 ADMIN, the toggle under row 60.
  - `api.md`: a sub-resource PUT, idempotent.
  - `time.md`: audit timestamp through `datetime.utcnow()`.
- `frontend/`:
  - `components.md`: feature code in `src/features/` and a thin route file.
  - `css.md`: tokens only.
  - `accessibility.md`: `aria-pressed`, the stable `aria-label`, `aria-hidden` emoji, `{" "}` outside hidden spans, `role="alert"` validation.
  - `data-fetching.md`: the hook in `src/hooks/` wraps `src/api/settings.ts`, with a prefix key, awaited invalidation and verbatim errors.
- `testing/`:
  - Backend: flat `tests/test_<feature>.py`, `test_<operation>_<scenario>_<expected>` names, exact key sets, migration tests that restore head.
  - Frontend: explicit Vitest imports, typed fixtures without casts, tests in `src/test/`.

## Notes

- **Test-driven:** each group starts with 2–8 tests.
- **Run incrementally:** after each group, run only that group's new and updated tests.
- **Mark progress:** check off each step when it is done. Leave group 10 unchecked until the merge.
- **Reuse first:**
  - Backend templates: points config stack, `_count_other_points_offers`, `set_item_listing_preference`, `require_item_visible`, `test_points_listing.py`.
  - Frontend templates: `VisibilityToggle`, `PointsConfigPage`, `ItemTileBadges`, `ItemCard` marker slot.
- **No commits:** the user does not want commits; leave all work uncommitted.
- **Worktree only:** work only in `C:/Users/karas/Desktop/swaptime/gooo-the-best-items`. Never touch the main checkout.
