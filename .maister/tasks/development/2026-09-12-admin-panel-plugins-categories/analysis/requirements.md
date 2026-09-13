# Requirements — Admin Panel: Plugin & Category Management

## Initial description
"Panel dla admina, gdzie będę potrzebowała np. dodawanie pluginów i kategorii do rzeczy."
(Admin panel where the user will need e.g. adding plugins and categories for items.)

## User journey
- **Who**: a new `ADMIN`-permission holder (today: only the seeded dev `admin` account;
  granting `ADMIN` to a real account is manual/migration-only, see technical decision below —
  no self-service promotion flow in this task).
- **Discovery**: existing Sidebar nav, same visual pattern as the current "Products"/"Plugins"
  items. A new "Categories" nav item appears, gated on `permissions.includes("ADMIN")`. The
  existing "Plugins" nav item's gate becomes
  `permissions.includes("PLUGIN_MANAGEMENT") || permissions.includes("ADMIN")` (coexistence,
  not replacement).
- **No new shortcut entry points** — explicitly decided against a "manage categories" link
  from `ProductFormPage`; Sidebar is the only entry point, consistent with Products/Plugins.

## Existing code reuse (confirmed via pattern-mining + mockups)
- **`ProductListPage.tsx` + `ProductFormPage.tsx`** are the direct structural template for
  `CategoryListPage`/`CategoryFormPage` — table, `ConfirmDialog`, `EmptyState`,
  `PrimaryButton`, permission-gated "+ Add" button, full Edit/Delete row actions.
- **`app/product/{router,service,schemas,models}.py`** is the direct backend template for the
  new `app/category/` module — flat, function-based service, `EntityNotFoundException`,
  `IntegrityError`→`BusinessConflictException` (409) pattern for delete-with-references.
- **`app/plugin/router.py`'s `ManagementPrincipal`** is the template for the new `ADMIN`
  gating shape (`Annotated[Principal, Depends(require_any(...))]`).
- **`useProducts.ts`** is the template for the new `useCategories()` hook.
- Screen chrome/copy stays **English** (matching the existing admin Chakra shell's Products/
  Plugins convention), even though the category *data* itself (seeded names) is Polish.

## Visual assets
Generated in Phase 4 — `analysis/design-context/ascii/ui-mockups.md` +
`analysis/design-context/INDEX.md` (5 items: `screen:category-list`,
`screen:category-list-empty`, `screen:category-form`, `screen:category-delete-blocked`,
`component:sidebar-admin-nav`).

## Functional requirements summary

### Backend
1. New `Permission.ADMIN` in `app/auth/models.py`.
2. New Alembic migration (revises current head): creates `categories` table (`category_seq`,
   `id`, `name` UNIQUE, `description` nullable, `sort_order` int, `created_at`/`updated_at`),
   seeds 5 rows with **Polish** names (Zabawka, Książka, Gra, Ubranie, Inne — see
   `scope-clarifications.md` decision 5) in that display order (`sort_order` 0-4), adds
   `products.category_id` FK NOT NULL, backfills it from the existing
   `products.category` enum column by matching the old token to its seeded row, then drops
   `products.category` and the now-unused `ProductCategory` enum type/column.
   Also grants `ADMIN` to the seeded dev `admin` account (bootstrapping — manual/seed-only,
   no promotion UI/endpoint in this task).
3. New `app/category/` module (`models.py`, `schemas.py`, `service.py`, `router.py`):
   - `GET /api/categories` (list, ordered by `sort_order`, includes `product_count` via one
     aggregated `GROUP BY` query — not N+1), `GET /api/categories/{id}`: gated `READ`
     (`ReadPrincipal`, mirroring `app/product/router.py`).
   - `POST /api/categories`, `PUT /api/categories/{id}`, `DELETE /api/categories/{id}`: gated
     `ADMIN` only.
   - `PATCH /api/categories/{id}/move` (or similar) for the up/down reorder action — swaps
     `sort_order` with the adjacent category. Gated `ADMIN`.
   - `DELETE` rejects with 409 (`CategoryHasProductsException`, a `BusinessConflictException`
     subclass) if any `Product` still references the category, caught around the
     `IntegrityError` from `db.flush()`/`db.commit()`, mirroring
     `ProductHasInventoryItemsException`.
4. `AUTHORIZATION_MATRIX` (`app/core/authorization_matrix.py`): two new rows for category
   routes (GET → `("READ", "mcp:read")`, mutations incl. move → `("ADMIN",)`), inserted
   before any blanket catch-all, following the product router's existing rows 11/17 pattern.
5. `app/plugin/router.py`: `ManagementPrincipal` becomes
   `require_any("PLUGIN_MANAGEMENT", "ADMIN")`. Corresponding `AUTHORIZATION_MATRIX` rows
   (20-22) updated to the same two-permission tuple.
6. `app/groups/` (second bounded context): `infrastructure/repository.py`'s
   `find_needed_item`/`list_needed_items_for_term` join through `Category` instead of
   selecting the bare enum; `schemas.py`'s `NeededItemResponse` and
   `PublicNeededItemResponse` (the latter on the **public, unauthenticated**
   `GET /api/groups/public/{id}` endpoint) change `product_category: ProductCategory` →
   `product_category_id: int` + `product_category_name: str`.
7. `src/frontend/src/api/groups.ts`'s response type and every Panel "Rzeczy"/needed-items
   consumer of `product_category` updated to the new id+name shape.

### Frontend
1. New `src/frontend/src/api/categories.ts` (mirrors `api/products.ts`):
   `getCategories()`, `getCategory(id)`, `createCategory(request)`,
   `updateCategory(id, request)`, `deleteCategory(id)`, `moveCategory(id, direction)`.
2. New `src/frontend/src/hooks/useCategories.ts` (mirrors `useProducts.ts`).
3. New `src/frontend/src/pages/CategoryListPage.tsx`, `CategoryFormPage.tsx` — per Phase 4
   mockups: table with name/description/product_count/actions columns, up/down arrow reorder
   buttons, `+ Add Category` (ADMIN-gated), row Edit/Delete, `ConfirmDialog` before delete
   with an additive `error` prop to surface the 409 `CategoryHasProductsException` message
   (NOT swallowed by a generic fallback string — explicit anti-pattern fix per gap-analysis/
   pattern-mining findings), `EmptyState` for zero rows.
4. `src/frontend/src/router.tsx`: new `categories`, `categories/new`, `categories/:id/edit`
   routes as `Layout()` children, alongside the existing `products`/`plugins` entries.
5. `src/frontend/src/components/layout/Sidebar.tsx`: new `ADMIN`-gated "Categories" `NavItem`;
   existing Plugins `NavItem` gate updated to `PLUGIN_MANAGEMENT || ADMIN`.
6. **8 existing consumers migrated off `utils/productCategory.ts`'s static
   `PRODUCT_CATEGORIES`/`CATEGORY_LABELS`/`CATEGORY_COLORS`** onto the new `useCategories()`
   hook: `ProductListPage.tsx`, `ProductFormPage.tsx`, `ProductDetailPage.tsx`,
   `CarbonFootprintLandingPage.tsx`, `ItemQuickAddForm.tsx`, `NeededItemQuickAddForm.tsx`,
   `EditTermDialog.tsx`, `RzeczyView.tsx` (Panel). `CATEGORY_LABELS`/`CATEGORY_COLORS` are
   retired (colors dropped for v1 per technical decision).
7. `ProductCategory` TS type in `api/products.ts` (currently a hardcoded string-literal union)
   updated to reflect the FK relationship (`category_id: number`, with category name resolved
   via `useCategories()`, not embedded).

## Reusability opportunities
Documented above under "Existing code reuse" — this task is designed to reuse
`ProductListPage`/`ProductFormPage`/`app/product/*` as close 1:1 templates, minimizing new
patterns introduced.

## Scope boundaries (explicitly OUT of scope, per user decisions)
- No fix to existing `PluginListPage`/`PluginFormPage`/`PluginDetailPage` UI gaps (raw-JSON
  manifest form, unwired `deletePlugin()`) — gating only.
- No general permission-grant API/UI (admin bootstrapping stays migration/seed-only).
- No category colors in v1.
- No drag-and-drop reordering (up/down buttons only, no new DnD dependency).
- No "manage categories" shortcut link from `ProductFormPage`.
- No new `UserRoleType`/business-role concept — `ADMIN` is purely a `Permission`-axis addition.

## Technical considerations
See `analysis/technical-clarifications.md` and `analysis/scope-clarifications.md` for the
full decision log with rationale. Key risk carried into planning: the `app.groups` DTO
breaking change reaches a public, unauthenticated endpoint (`PublicNeededItemResponse`) and
must be coordinated with the corresponding frontend consumer update in the same task group to
avoid a broken intermediate state.
