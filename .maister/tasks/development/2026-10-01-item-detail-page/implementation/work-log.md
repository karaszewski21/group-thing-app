# Work Log

## 2026-10-01 - Implementation Started

**Total Steps**: 60
**Task Groups**: 1 DB (photos, 0045), 2 BE read (details/status/history), 3 BE mutations (photos/description/guards), 4 BE notifications+links+slugs, 5 FE api/hooks, 6 FE item page, 7 FE entry points + panel cleanup, 8 test review + gates

**Wave plan**: W1: 1, 4, 5 · W2: 2, 6, 7 · W3: 3 · W4: 8

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

## 2026-10-01 - Group 1 Complete (wave 1)

**Steps**: 1.1-1.5 completed
**Standards Applied**:
- From plan: backend/models.md, backend/migrations.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 3 passed (tests/test_inventory_item_photo_model.py)
**Files Modified**: alembic/versions/0045_inventory_item_photos.py (created), app/circulation/models.py (InventoryItemPhoto), tests/test_inventory_item_photo_model.py (created)
**Notes**: Local DB at 0045 (round trip verified). Autogenerate is not wired (env.py has no target_metadata) -> drift checked manually; candidate standards note for migrations.md.

## 2026-10-01 - Group 5 Complete (wave 1)

**Steps**: 5.1-5.7 completed
**Standards Applied**:
- From plan: frontend/data-fetching.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 5 passed (src/test/useItemDetail.test.tsx)
**tsc**: baseline 57 (implementation/tsc-baseline.txt, + 19 known vitest failures listed) -> 59; the 2 new are the expected transient PanelDataContext.tsx updateInventoryItem callers (L1275, L1314), removed by Group 7.
**Files Modified**: api/items.ts (created), api/inventories.ts (updateInventoryItem id: string), hooks/useTermAttendees.ts (export hasStatus), hooks/useItemDetail.ts (created: useItemDetail/useItemHistory/useItemEditing), test/useItemDetail.test.tsx (created)
**Notes**: Mutations reject with serverMessageOr Polish message; photoBusy until refetch settles; movePhoto reads cached order.

## 2026-10-01 - Group 4 Complete (wave 1)

**Steps**: 4.1-4.7 completed
**Standards Applied**:
- From plan: backend/api.md, backend/security.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/coding-style.md
- Discovered: DDD bridges rule (notifications_bridge, staged before single commit)
**Tests**: 85 passed (test_term_item_listings, test_pledge_fulfillment, test_organizations, test_swap_proposal_model); 7 new, red first
**Files Modified**: app/notifications/models.py (ITEM_RESERVED_FOR_PICKUP), app/groups/application/term_item_listings.py (taker notification + 6 link repoints, slug import removed), app/groups/application/pledge_fulfillment.py (link repoint), app/organizations/slugs.py ("product"), tests x3
**Notes**: No new ruff/mypy findings (pre-existing remain). Frontend kind union handled in Group 7.

## 2026-10-01 - Design change mid-implementation (user)

- Gallery photos moved from InventoryItem to the catalog **Product** (shared by all items of a product).
- Photo + description endpoints moved to the **product module**: `GET/POST /api/products/{product_id}/photos`, `DELETE .../photos/{photo_id}`, `PUT .../photos/order`, `PATCH /api/products/{product_id}/description`. Authorization: EDIT (same as existing product endpoints); item page shows editors only to the item owner.
- Group 1 redone: migration rewritten in place as `0045_product_photos.py`, model `ProductPhoto` in app/product/models.py, `InventoryItemPhoto` removed; tests `tests/test_product_photo_model.py` (3 passed); local DB at 0045 (round trip OK).
- Running Groups 2 and 6 notified; spec + plan amendment requested; Group 3 to be re-scoped to the product module.

## 2026-10-01 - Group 6 Complete (wave 2)

**Steps**: 6.1-6.8 completed
**Standards Applied**:
- From plan: frontend/components.md, data-fetching.md, css.md, accessibility.md, responsive.md, testing/frontend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: none
**Tests**: 8 passed (src/test/ItemDetailPage.test.tsx)
**tsc**: no new errors in pages/product/*, router.tsx, new test
**Files Modified**: pages/product/ItemDetailPage.tsx, ItemGallery.tsx, ItemTimeline.tsx (created), router.tsx (/product/:id, /product/:id/edit), test/ItemDetailPage.test.tsx (created)
**Visual**: all 10 refs matched; gallery editor adds shared-photos hint (design change).
**Notes**: Finished before receiving the "endpoints move to product module" message — api/items.ts + hooks still call /inventory-items/{id}/photos|description. Follow-up frontend step scheduled with Group 3 (wave 3).

## 2026-10-01 - Group 7 Complete (wave 2; first run stalled, resumed)

**Steps**: 7.1-7.9 completed
**Standards Applied**:
- From plan: frontend/components.md, accessibility.md, css.md, global/minimal-implementation.md, testing/frontend-testing.md
- From INDEX.md: frontend/data-fetching.md
- Discovered: none
**Tests**: RzeczyViewCategory 15/0, TermPage 31/5, PanelPage 103/8 — failures exactly the baseline set; 4 new/updated tests pass
**tsc**: 57 total; transient Group 5 errors gone; only new was ItemDetailPage.test TS2307 (cleared once Group 6 landed)
**Files Modified**: panelIcons.tsx (EyeIcon), RzeczyView.tsx, WypozyczoneView.tsx, PanelDataContext.tsx (dead editor state + products catalog fetch removed), PublicTermView.tsx (listing title link), api/notifications.ts (new kind), tests x3
**Notes**: LoanRow itemId typed number (panel type drift, follow-up).

## 2026-10-01 - Group 2 Complete (wave 2)

**Steps**: 2.1-2.9 completed
**Standards Applied**:
- From plan: backend/queries.md, backend/models.md, backend/api.md, backend/security.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md, global/commenting.md
- Discovered: none
**Tests**: 8 passed (test_item_details.py 6, test_item_history.py 2)
**Files Modified**: circulation/domain/item_privacy.py (new), application/item_details.py (new), application/identity.py (find_user_id_by_principal), application/movements.py (get_item_history), infrastructure/repository.py (Core refs, single history query, list_product_photos), schemas.py, service.py, router.py (GET details/history, ReadPrincipal), product/service.py (get_shared_description read-only), tests x2
**Notes**: Photos read from ProductPhoto by product_id. No app.groups import in circulation. Pre-existing ruff E501 / mypy errors untouched. Gap-test ideas for Group 8: no-user principal labels, RETURNING, GIFT entry.

## 2026-10-01 - Group 6 follow-up (product-module endpoints)

Group 6 applied the second design change before finishing: api/items.ts photo/description functions now take productId and call /api/products/{productId}/photos|/photos/{photoId}|/photos/order|/description (renamed addProductPhoto/deleteProductPhoto/reorderProductPhotos/updateProductDescription; type ProductPhotoResponse); useItemEditing reads product_id from cached details. ItemDetailPage + useItemDetail tests: 13 passed. No separate frontend step needed in wave 3.

## 2026-10-01 - Rework steps 5.8 + 6.9 Complete (wave 3)

**Standards Applied**: frontend/data-fetching.md, testing/frontend-testing.md, global/minimal-implementation.md
**Tests**: 13 passed (ItemDetailPage 8, useItemDetail 5); incl. re-point test (next description save uses the new product_id)
**tsc**: 56 vs 57 baseline, 0 new; eslint clean
**Files Modified**: api/products.ts (photo/description fns + types), api/items.ts (GETs only), hooks/useItemDetail.ts (useItemEditing(itemId, productId)), pages/product/ItemDetailPage.tsx, ItemGallery.tsx, tests x2

## 2026-10-01 - Group 3 Complete (wave 3; product module)

**Steps**: 3.1-3.7 completed
**Standards Applied**:
- From plan: backend/api.md, security.md, queries.md, models.md, global/error-handling.md, global/validation.md, testing/backend-testing.md
- From INDEX.md: global/minimal-implementation.md
- Discovered: central validation handler returns 400 (legacy envelope with fieldErrors), not 422
**Tests**: 46 passed (product photos 5, description 2, matrix +1, plus Group 1/2 suites)
**Files Modified**: app/product/schemas.py, service.py (_lock_product FOR UPDATE, list/add/remove/reorder photos, set_shared_description), router.py (5 routes, EditPrincipal/ReadPrincipal), circulation/schemas.py (photos -> ProductPhotoResponse), core/authorization_matrix.py (PATCH on row 17), tests x3
**Notes**: Validation -> 400 not 422 (spec says 422). Frontend useItemDetail treats 422 as notFound for malformed ids — should be 400 (fix in Group 8). product imports nothing from circulation.

## 2026-10-01 - Group 8 Complete (wave 4)

**Steps**: 8.1-8.6 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/minimal-implementation.md
**Gap tests**: 7 (RETURNING end-to-end, malformed id -> 400, privacy labels with no user/display name, fulfilled GIFT history entry, gallery fallback to product_photo_url, back-link fallback, 400 notFound in hook)
**Production fix**: hooks/useItemDetail.ts notFound on 404 or 400 (was 422 — backend central handler returns 400)
**Gates**:
- Backend: full pytest 511 passed / 0 failed; ruff 106 vs 109 at HEAD, 0 new; alembic current 0045 (head)
- Frontend: vitest 348 passed / 19 failed = exactly the baseline set; tsc 56 vs 57 baseline, 0 new
- Greps: no Number( on item ids; no app.groups import in circulation; product imports nothing from circulation; no user/inventory/reservation/transaction ids in ItemDetailsResponse/ItemHistoryEntryResponse

## User request during finalization
"rozdziel komponenty edycji i szczegółów produktu" — refactor splitting ItemDetailPage.tsx/ItemGallery.tsx into view vs edit component files dispatched (behaviour unchanged).

## 2026-10-01 - Refactor: view vs edit components (user request)

pages/product split: ItemDetailPage.tsx (shell only), ItemDetailsView.tsx (view), ItemEditView.tsx (edit + EditableField), ItemFieldEditors.tsx (name/category, condition, description editors + useFieldSave/SaveCancel private), ItemReadOnlyParts.tsx (ReadOnlyCards, DescriptionText — shared), itemPageShared.ts (HistoryState, MAX_ITEM_PHOTOS, FIELD_LABEL, PRIMARY_BTN), ItemGallery.tsx (view: ItemGallery, SafeImage), ItemGalleryEditor.tsx (ItemPhotoStrip, ItemGalleryEditor). Markup/copy/classes moved verbatim.
**Gates**: ItemDetailPage tests 10/10; tsc 0 new; eslint src/pages/product clean.

## 2026-10-01 - Implementation Complete

**Total Steps**: all plan checkboxes [x] (incl. rework 5.8/6.9)
**Test Suite**: backend 511 passed; frontend 348 passed / 19 baseline failures (0 new); tsc 0 new; migration 0045 (head)
**Design changes during implementation**: photos -> Product (ProductPhoto); photo/description endpoints -> product module (/api/products/{id}/..., EDIT); validation errors are 400 (not 422).

## 2026-10-01 - Refactor 2: standalone pages, no shell (user request)

"nie chcę żadnej powłoki, chcę osobny DetailPage i EditPage": /product/:id -> ItemDetailPage (no mode prop, ItemViewContent private), /product/:id/edit -> ItemEditPage (own guard, ItemEditContent + EditableField private). Shared parts: ItemLoadStates.tsx, ItemBackButton.tsx, ItemReadOnlyParts.tsx; ItemDetailsView.tsx/ItemEditView.tsx removed. Tests 15 passed (page tests 10); tsc 0 new; eslint only the 2 pre-existing router.tsx errors.

## 2026-10-01 - Verification fixes (Phase 11, iteration 1)

User: owner-only product edits + fix all warnings 2-9.
**Backend** (516 passed full suite; gates 66 passed; ruff clean on touched files):
1. Product photo/description mutations require the caller to own a live item of the product (home-inventory owner rule, single EXISTS via Core table refs, no circulation import) -> 403; existence 404 first. Borrower 403, lending owner allowed.
2. Cleared description stores "" marker; reader falls back to Product.description only when key absent.
3. delete_product deletes the product's photos first (409 for item references unchanged).
4. Gallery URL fullmatch (http(s), host, no whitespace/control chars); photo_ids max_length=10.
5. Single photo read: circulation duplicate removed; item_details uses product_service.product_photos (sort_order, created_at).
**Frontend** (36 passed; tsc 0 new; eslint clean):
- Stale product_id guard (writes refused until refetched product_id matches; pencils disabled while refetching; lock banner + retry on failed refetch)
- "Gotowe"/"Wróć do podglądu" use replace (no back loop)
- Rename hint (photos/description belong to the product)
- category_name string|null with "Bez kategorii"; MAX_PRODUCT_PHOTOS; CopyIcon formatting; gallery doc comment
- 403 shows ACCESS_DENIED_MESSAGE inline
**Docs**: spec, plan, visual-coverage, scope-clarifications updated to final state (400 not 422, two standalone pages, owner-only product edits).
**Known follow-up**: core access_denied_handler always returns "Access denied", so the Polish 403 reason never reaches clients.
