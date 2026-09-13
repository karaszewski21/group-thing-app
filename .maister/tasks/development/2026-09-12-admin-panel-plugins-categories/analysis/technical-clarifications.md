# Phase 5 Technical Clarifications

1. **`Category.name` uniqueness**: UNIQUE constraint in the DB. Consistent with `resolveProduct`'s
   get-or-create-by-name pattern in `app/product/service.py`.

2. **Category colors**: dropped for v1. No `color` column on `Category`; category badges show
   name only (matches the mockups). `CATEGORY_COLORS` in `utils/productCategory.ts` is retired
   along with `CATEGORY_LABELS` once the 8 consumers move to `useCategories()`. Can be
   reintroduced as a follow-up task if needed.

3. **"W użyciu" (products-in-use) count on `CategoryListPage`**: included. Backend computes it
   via a single aggregated query (`GROUP BY category_id` COUNT, joined/left-joined so
   zero-product categories still show `0`) and returns `product_count` on `CategoryResponse` —
   not an N+1 per-row query. Lets the admin see which categories are safe to delete without
   trial-and-error against the 409.

4. **No "manage categories" shortcut link from `ProductFormPage`**: admin discovers Categories
   only via the Sidebar nav item (same pattern as Products/Plugins) — no extra UI element added
   to the existing product form.

5. **Manual category ordering**: `Category` gains a `sort_order` integer column (admin-defined
   display order, not alphabetical). UI mechanism: up/down arrow buttons per row in
   `CategoryListPage` (swaps `sort_order` with the adjacent row) — no drag-and-drop library
   introduced. `GET /api/categories` (and any place that lists categories, incl. the new
   `useCategories()` hook) orders by `sort_order` rather than `name`. New categories are
   appended at the end (`max(sort_order) + 1`) by default.
