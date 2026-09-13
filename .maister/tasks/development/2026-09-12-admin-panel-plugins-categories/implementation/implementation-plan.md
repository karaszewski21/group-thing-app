# Implementation Plan: Admin Panel — Managing Plugins and Product Categories

## Overview

Total Task Groups: 9 (7 implementation + 1 existing-test-rewrite + 1 final testing group)
Total Steps: ~85 (see per-group counts below)
Expected New/Rewritten Tests: ~26 new (2-8/group × 7 groups) + up to 10 strategic (final group) + **16 existing tests rewritten** (not counted against the 2-8/group budget — these are mandatory fixes for tests broken by the `category` → `category_id`/`Category` rename, not new coverage)

This is a **high-risk** task (DB migration, a breaking DTO change reaching a public unauthenticated endpoint, 17+ frontend touch files, 6 backend files, 16 existing tests to rewrite). Group count and per-group scope exceed the "Large (9+ files): 5-6 groups" default specifically because two of the nine groups are deliberately widened (see "Atomicity/sequencing" below) to prevent a broken intermediate import/compile state — splitting them further would create a state where the backend fails to import or the frontend fails to type-check between groups.

### Independent verification sweep (required by orchestrator instructions)

Before finalizing groups, a fresh repo-wide grep was run across `src/backend` and `src/frontend` for `ProductCategory`, `category:`/`category=`, and `product_category` (case-insensitive), independent of spec.md's own touch-file list. Results:

- **Confirmed all 4 carried-forward known gaps** are real and still present in the current tree:
  1. `src/backend/tests/test_circulation.py` (lines 33, 101 — confirmed: `json={"name": "Klocki Duplo"/"Miś Uszatek", "category": "TOY"}`), `test_notifications.py` (line 46), `test_pledge_fulfillment.py` (line 35) — all POST `category: "TOY"/"OTHER"` to `/api/products/resolve`.
  2. `src/frontend/src/api/groups.ts` — confirmed line 2 (`import type { ProductCategory } from "./products"`) and line 110 (`product_category: ProductCategory`).
  3. `src/frontend/src/components/layout/Sidebar.tsx` — confirmed two independent `hasPluginManagement` gates: line 94 (`NavItem` itself, covered by spec.md) and line 97 (`{hasPluginManagement && <PluginMenuItems />}`, NOT covered by spec.md's derivation — an ADMIN-only principal would see the Plugins nav link render but the plugin-contributed sub-items would stay hidden).
  4. `plugins/server-sdk.ts`'s `getProducts` (lines 83-88) — confirmed: forwards `params` verbatim as a query string with no field allowlisting, so a plugin-supplied `category` filter silently becomes a no-op once `/api/products`'s query param renames to `category_id`, identical in effect to the already-accepted `PluginMessageHandler.ts:108` limitation.
- **No additional undiscovered files were found beyond spec.md's list + the 4 known gaps.** The full grep result sets (`ProductCategory`: 10 backend + 14 frontend files; `product_category`: 11 files; ad-hoc `category`-token backend sweep: 17 files) resolve entirely to files already named in spec.md, the known-gaps list, or historical Alembic migrations (`0006_product_category_enum.py`, `0018_needed_item_add_product_id.py`, `0019_needed_item_backfill_product_id.py`, `0002_seed_dev_users.py`) that are correctly left untouched (migrations are immutable history).
- **Correction to spec.md's existing-test tally**: spec.md states "13 existing test files (3 backend + 10 frontend)" — this predates the known-gaps list being folded in. With the 3 known-gap backend files added, the verified total is **16 existing test files (6 backend + 10 frontend)**. This plan's Task Group 3 and Task Group 8 scope reflect 16, not 13.
- `plugins/sdk.ts`'s doc-comment (line 34, documents `{ category: 1, ... }` as a valid filter) and `plugins/server-sdk.ts` itself are **not modified** by any group below — mirroring the already-accepted treatment of `PluginMessageHandler.ts`. This is intentional (see Task Group 3's Known Limitations note), not an oversight.

### Atomicity / sequencing (why some groups are wider than usual)

Two groups are deliberately scoped wider than a typical 4-8 file group, because the `category` (enum) → `category_id`/`Category` (FK) rename creates hard **import-time** (Python) and **type-check-time** (TypeScript) breakage, not just logical breakage — a partial rename leaves the application unable to start at all, not merely buggy:

- **Task Group 3** combines the `app/product/*` conversion, the `app.groups` cross-bounded-context DTO rename, AND their 6 broken backend tests into one group. Reason: `app/groups/infrastructure/repository.py` imports `ProductCategory` from `app.product.models` — if `app/product/models.py` drops that enum in a separate, earlier-completed group, `app.groups` (and therefore `app.main` at import time, since `main.py` registers `groups_router`) fails to import until the `app.groups` half of the rename also lands. Splitting this into two groups would mean the backend cannot boot between them.
- **Task Group 5** combines the new `api/categories.ts`/`useCategories.ts` data layer, the DTO-shape rename across `api/products.ts`/`api/terms.ts`/`api/groups.ts`/`hooks/useProducts.ts`/`utils/itemQuickAdd.ts`/`utils/neededItemQuickAdd.ts`, AND all direct UI consumers (`ProductListPage.tsx`, `ProductFormPage.tsx`, `ProductDetailPage.tsx`, `CarbonFootprintLandingPage.tsx`, `ItemQuickAddForm.tsx`, `NeededItemQuickAddForm.tsx`, `EditTermDialog.tsx`, `RzeczyView.tsx`, `PanelDataContext.tsx`) plus retirement of `utils/productCategory.ts`'s category constants into one group. Reason: renaming the shared types alone would leave every consumer file failing to type-check (`tsc`/`vitest` would not run cleanly) until the consumers are updated in the same pass.

Task Group 3 must execute immediately after Task Group 2 with nothing else interleaved; Task Group 5 must execute immediately after Task Group 3 with nothing else interleaved. Do not attempt to parallelize or checkpoint mid-way through either group.

## Implementation Steps

### Task Group 1: Database Migration & `ADMIN` Permission
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/auth/models.py`
- `src/backend/alembic/versions/0025_category_reintroduction.py` (new)
**Estimated Steps:** 9

- [x] 1.0 Complete migration + permission layer
  - [x] 1.1 Write 4 focused tests:
    - A migration-adjacent test (or direct SQL check via the test DB fixture) asserting the seed produces exactly 5 rows with Polish names `Zabawka`/`Książka`/`Gra`/`Ubranie`/`Inne` in `sort_order` 0-4.
    - A test asserting `Permission.ADMIN` exists in the enum and is distinct from `PLUGIN_MANAGEMENT`.
    - A test asserting the seeded `admin` account (from `0002_seed_dev_users.py`) has `ADMIN` after this migration.
    - A test asserting `products.category_id` is `NOT NULL` and FK-constrained to `categories.id` after upgrade (schema-introspection or an insert-with-invalid-id-fails check).
  - [x] 1.2 Add `Permission.ADMIN = "ADMIN"` to `app/auth/models.py`'s `Permission` `StrEnum` (alongside `READ`, `EDIT`, `PLUGIN_MANAGEMENT`, currently lines 22-24).
  - [x] 1.3 Author new Alembic migration `0025_category_reintroduction.py` (revises `0024_outbox_schema.py`, the current head):
    - Create `category_seq` (Postgres `Sequence`) and `categories` table: `id` BigInteger PK via `category_seq`, `name` String UNIQUE NOT NULL, `description` String nullable, `sort_order` Integer NOT NULL, `created_at`/`updated_at` per `BaseEntity` shape (mirror `0006_product_category_enum.py`'s `downgrade()` table shape, adding `sort_order`).
  - [x] 1.4 Seed 5 rows with explicitly assigned ids 1-5 (not `nextval()`-generated) and Polish names in `sort_order` 0-4: `Zabawka` (from `TOY`), `Książka` (`BOOK`), `Gra` (`GAME`), `Ubranie` (`CLOTHING`), `Inne` (`OTHER`); advance `category_seq` past 5 via `setval`.
  - [x] 1.5 Add `products.category_id` (BigInteger, nullable), backfill via literal `CASE WHEN category = 'TOY' THEN 1 WHEN category = 'BOOK' THEN 2 WHEN category = 'GAME' THEN 3 WHEN category = 'CLOTHING' THEN 4 WHEN category = 'OTHER' THEN 5 END` (positional mapping to the ids assigned in 1.4), then `ALTER COLUMN ... SET NOT NULL`, add FK `fk_products_category_id_categories` and index `ix_products_category_id` (naming convention per `standards/backend/migrations.md`).
  - [x] 1.6 Drop `products.category` column and the `ProductCategory`-backed column type.
  - [x] 1.7 Grant `ADMIN` to the seeded dev `admin` account (mirrors `0002_seed_dev_users.py`'s `INSERT INTO user_permissions ... WHERE u.username = 'admin'` pattern) — data-migration step, no other account is touched.
  - [x] 1.8 Implement `downgrade()` reversing every step in dependency order: re-add `products.category` (String, nullable), backfill from `category_id` by reverse-matching `categories.name` back to the enum token, set `NOT NULL`, drop the FK/index/`category_id` column, revoke the `ADMIN` grant from `admin`, drop `categories` table and `category_seq` sequence. Verify `alembic downgrade base` leaves a clean DB (no leftover `categories`/`category_seq`/`products.category_id`).
  - [x] 1.9 Run the 4 tests from 1.1 only (not the full suite — `skip_test_suite: true` per orchestrator state).

**Acceptance Criteria:**
- The 4 tests pass.
- `alembic upgrade head` succeeds against a clean DB; `alembic downgrade base` afterward leaves no `categories` table, `category_seq` sequence, or `products.category_id` column.
- `Permission.ADMIN` exists; only the seeded `admin` account has it after migration.
- `categories` table has exactly 5 rows: `Zabawka`(0)/`Książka`(1)/`Gra`(2)/`Ubranie`(3)/`Inne`(4).

---

### Task Group 2: Backend Category Module (CRUD) + Authorization Matrix
**Dependencies:** Task Group 1
**Files to Modify:**
- `src/backend/app/category/__init__.py` (new)
- `src/backend/app/category/models.py` (new)
- `src/backend/app/category/schemas.py` (new)
- `src/backend/app/category/service.py` (new)
- `src/backend/app/category/router.py` (new)
- `src/backend/app/core/authorization_matrix.py`
- `src/backend/app/main.py`
**Estimated Steps:** 10

- [x] 2.0 Complete category module
  - [x] 2.1 Write 8 focused tests:
    - Matrix-resolution tests (no DB) for the 2 new category rows: GET requires `("READ","mcp:read")`, mutations require `("ADMIN",)` — following `test_authorization_matrix.py`'s `resolve_requirement(...)` pattern.
    - Router-level: `GET /api/categories` succeeds (200) for a `READ`-only principal, no `ADMIN` required.
    - Router-level: `POST /api/categories` returns 403 for a non-`ADMIN` principal and 201 for an `ADMIN` principal.
    - Router-level: `DELETE /api/categories/{id}` returns 403 for non-`ADMIN`.
    - Service-level: `delete_category` on a category referenced by ≥1 product raises `CategoryHasProductsException` with the exact blocking product count in its message.
    - Service-level: `list_categories` returns rows ordered by `sort_order` with correct `product_count` per category (aggregated query, not N+1 — assert query count if a query-counting fixture exists, else assert correctness).
    - Service-level: `move_category` swaps `sort_order` with the adjacent row atomically.
  - [x] 2.2 `models.py`: `Category(BaseEntity)`, `__tablename__ = "categories"`, `__sequence_name__ = "category_seq"`; `name`, `description`, `sort_order` columns; business-key `__eq__`/`__hash__` on `name` (mirrors `Product`'s `sku`-based equality, per `standards/backend/models.md`).
  - [x] 2.3 `schemas.py`: `CreateCategoryRequest`, `UpdateCategoryRequest`, `CategoryResponse` (includes `product_count: int`), `MoveCategoryRequest` (direction up/down).
  - [x] 2.4 `service.py`: `list_categories` (ordered by `sort_order`, `product_count` via one aggregated `LEFT JOIN`/`GROUP BY` against `Product.category_id` — per `standards/backend/queries.md`), `get_category`, `create_category` (appends at `max(sort_order)+1`), `update_category`, `delete_category` (catches `IntegrityError` from the FK on `products.category_id`, raises `CategoryHasProductsException(category_id, product_count)` — a `BusinessConflictException` subclass mirroring `ProductHasInventoryItemsException` in `app/product/service.py:36-44`), `move_category` (swaps `sort_order` with the adjacent row in current order, atomic within one transaction).
  - [x] 2.5 `router.py`: `GET /api/categories`, `GET /api/categories/{id}` gated `ReadPrincipal = require_any("READ", "mcp:read")` (mirrors `app/product/router.py:30`); `POST`, `PUT /{id}`, `DELETE /{id}`, `PATCH /{id}/move` gated `AdminPrincipal = require_any("ADMIN")` (new principal, shape copied from `app/plugin/router.py:32-34`'s `ManagementPrincipal`).
  - [x] 2.6 `app/core/authorization_matrix.py`: insert 2 new rows into `_RAW_MATRIX` immediately after row 52 (`/api/notifications` POST) and before the terminal catch-all `(None, r"^.*$", "AUTHENTICATED")` — `(GET, r"^/api/categories(/.*)?$", ("READ","mcp:read"))` and `(POST|PUT|DELETE|PATCH, r"^/api/categories(/.*)?$", ("ADMIN",))`. Do NOT insert near rows 11/17 (products) — that is the file's original table, since superseded by the append-only convention established at rows 26-52.
  - [x] 2.7 `app/main.py`: import `category_router` from `app.category.router` and `app.include_router(category_router)` alongside the existing `product_router`/`plugin_router` registrations (lines ~46-47, 92-93).
  - [x] 2.8 Wire matrix rows and router `require_any(...)` together (matrix-first per `standards/backend/security.md`) — verify no route performs its own ad-hoc permission check.
  - [x] 2.9 Run the 8 tests from 2.1 only.

**Acceptance Criteria:**
- The 8 tests pass.
- `GET /api/categories`/`GET /api/categories/{id}` succeed for the seeded `editor` account (READ+EDIT, no ADMIN) — this is the task's single hard correctness requirement (regresses `ProductFormPage`'s category dropdown otherwise).
- `POST`/`PUT`/`DELETE`/`PATCH .../move` return 403 for non-ADMIN, succeed for ADMIN.
- Deleting a referenced category returns a `CategoryHasProductsException` message stating the exact blocking product count.
- `app/category/` mirrors `app/product/`'s flat, function-based structure — no DDD layering introduced.

---

### Task Group 3: Backend Category FK Rename — Product Module + Cross-Context (`app.groups`) DTO + Existing Test Rewrites
**Dependencies:** Task Group 1, Task Group 2
**Files to Modify:**
- `src/backend/app/product/models.py`
- `src/backend/app/product/schemas.py`
- `src/backend/app/product/service.py`
- `src/backend/app/product/router.py`
- `src/backend/app/product/query_service.py`
- `src/backend/app/groups/infrastructure/repository.py`
- `src/backend/app/groups/application/terms.py`
- `src/backend/app/groups/application/public_view.py`
- `src/backend/app/groups/schemas.py`
- `src/backend/tests/test_product_resolution.py`
- `src/backend/tests/test_circulation.py`
- `src/backend/tests/test_notifications.py`
- `src/backend/tests/test_pledge_fulfillment.py`
- `src/backend/tests/test_public_term.py`
- `src/backend/tests/test_groups.py`
**Estimated Steps:** 16
**Note:** See "Atomicity/sequencing" in Overview — this group must execute as one uninterrupted unit; do not checkpoint or run other groups between the `app/product/*` half and the `app.groups` half.

- [x] 3.0 Complete category FK rename across both bounded contexts
  - [x] 3.1 Write 6 focused tests (new, distinct from the 6 rewritten files below):
    - `list_products(category_id=...)` filters correctly by the new FK.
    - `create_product`/`update_product` persist `category_id` correctly (round-trip through `get_product`).
    - `get_or_create_product_by_name` matches on `(name, category_id)`, not the retired enum.
    - `GET /api/groups/public/{id}` (unauthenticated) returns `product_category_id`+`product_category_name` for a needed item.
    - `_needed_item_view()` (or its router-level equivalent) returns the correct `category_id`/`category_name` pair for a term's needed items.
    - A round-trip check: creating a product with `category_id=<seeded Zabawka id>`, then fetching it via `/api/groups/public/{id}`'s needed-items path, returns `product_category_name == "Zabawka"`.
  - [x] 3.2 `app/product/models.py`: `Product.category: Mapped[ProductCategory]` (lines 62-64) → `Product.category_id: Mapped[int]` (BigInteger, FK to `categories.id`, NOT NULL); remove the `ProductCategory` enum class and its `_enum_column` helper (lines 22-47).
  - [x] 3.3 `app/product/schemas.py`: `category: ProductCategory` on `ProductResponse` (line 48), `CreateProductRequest` (line 60), `UpdateProductRequest` (line 74), `ResolveProductRequest` (line 89) → `category_id: int`; drop `from .models import ProductCategory` (line 17).
  - [x] 3.4 `app/product/service.py`: `category: ProductCategory | None` param on `list_products` (line 54) → `category_id: int | None`; `category=data.category` in `create_product`/`update_product` (lines 79, 93) → `category_id=data.category_id`; `get_or_create_product_by_name`'s `category` param/filter (lines 98-99, 108, 121) → `category_id`/`Product.category_id == category_id`.
  - [x] 3.5 `app/product/router.py`: `category: ProductCategory | None = None` query param on `list_products` (line 38) → `category_id: int | None = None`; drop the `ProductCategory` import (line 19).
  - [x] 3.6 `app/product/query_service.py`: `category` param/filter (lines 133, 141) → `category_id`; drop `ProductCategory` from the `.models` import (line 20).
  - [x] 3.7 `app/groups/infrastructure/repository.py`: `get_needed_item_with_product` (182-193) and `list_needed_items_with_product_for_term` (196-205) — change the join to go through `Category` (via `Product.category_id`), `select(NeededItem, Product.name, Category.id, Category.name)` joining `Product` → `Category`.
  - [x] 3.8 `app/groups/application/terms.py`: `_needed_item_view()` (71-88) — update the `Row` type hint for the new 4-tuple shape, unpack `item, product_name, category_id, category_name = row`, build dict keys `"product_category_id"`/`"product_category_name"`; drop the `from app.product.models import ProductCategory` import (line 14).
  - [x] 3.9 `app/groups/application/public_view.py`: `PublicNeededItemResponse(...)` construction (211-219) — `product_category=view["product_category"]` → `product_category_id=view["product_category_id"], product_category_name=view["product_category_name"]`.
  - [x] 3.10 `app/groups/schemas.py`: `NeededItemResponse.product_category: ProductCategory` (line 132) and `PublicNeededItemResponse.product_category: ProductCategory` (line 208) → `product_category_id: int` + `product_category_name: str`.
  - [x] 3.11 Rewrite `test_product_resolution.py` (lines 32, 39, 51, 59, 74, 79, 95): `json={"name": ..., "category": "TOY"}` → `json={"name": ..., "category_id": <seeded id>}`; `body["category"] == "TOY"` → `body["category_id"] == <id>`.
  - [x] 3.12 Rewrite `test_circulation.py` (lines 33, 101), `test_notifications.py` (line 46), `test_pledge_fulfillment.py` (line 35) — same `category` → `category_id` rewrite on their shared `/api/products/resolve` POST helper calls (known gaps, independently reconfirmed in this session's grep — see Overview).
  - [x] 3.13 Rewrite `test_public_term.py` (line 80 request, line 121 assertion): `json={"name": ..., "category": "OTHER"}` → `category_id`; `body["next_term"]["needed_items"][0]["product_category"] == "OTHER"` → assert `product_category_id`/`product_category_name`.
  - [x] 3.14 Rewrite `test_groups.py` (line 74 request, line 397 assertion) — same rename.
  - [x] 3.15 Confirm (grep) no remaining reference to `ProductCategory`/`Product.category` (as opposed to `category_id`) anywhere under `app/product/` or `app/groups/`.
  - [x] 3.16 Run the 6 new tests (3.1) + all 6 rewritten test files (3.11-3.14) — not the full suite.

**Acceptance Criteria:**
- The 6 new tests pass; all 6 rewritten test files pass (no `category`/`ProductCategory` references remain in their assertions).
- `app/product/{models,schemas,service,router,query_service}.py` compile and have zero remaining `ProductCategory`/`category` (enum) references.
- `GET /api/groups/public/{id}` returns `product_category_id`/`product_category_name` for at least one seeded term with needed items — the task's highest-risk integration point (public, unauthenticated).
- `app.main` imports cleanly (`app/groups` no longer imports the retired `ProductCategory` from `app.product.models`).

---

### Task Group 4: Backend Plugin `ADMIN` Gating
**Dependencies:** Task Group 2 (shared `authorization_matrix.py` file — must land after Group 2's edits to avoid conflicting concurrent changes)
**Files to Modify:**
- `src/backend/app/plugin/router.py`
- `src/backend/app/core/authorization_matrix.py`
**Estimated Steps:** 6

- [x] 4.0 Complete plugin ADMIN-coexistence gating
  - [x] 4.1 Write 3 focused tests:
    - `ManagementPrincipal`-gated routes (manifest PUT, enabled PATCH, descriptor DELETE) succeed for a principal with only `PLUGIN_MANAGEMENT` (regression check).
    - Same 3 routes succeed for a principal with only `ADMIN`.
    - Same 3 routes return 403 for a principal with neither permission.
  - [x] 4.2 `app/plugin/router.py` line 34: `ManagementPrincipal = Annotated[Principal, Depends(require_any("PLUGIN_MANAGEMENT"))]` → `require_any("PLUGIN_MANAGEMENT", "ADMIN")`.
  - [x] 4.3 `app/core/authorization_matrix.py` rows 20-22 (manifest PUT, enabled PATCH, descriptor DELETE — the plugin domain's existing rows) — update the requirement tuple from `("PLUGIN_MANAGEMENT",)` to `("PLUGIN_MANAGEMENT", "ADMIN")`.
  - [x] 4.4 Verify no other plugin route (GET, EDIT-gated object/data routes) is touched — this task only adds `ADMIN` as an additive alternative, no other plugin behavior changes (per Out of Scope: no fix to raw-JSON manifest form or unwired delete).
  - [x] 4.5 Confirm matrix rows and router `require_any(...)` stay in lockstep (matrix-first).
  - [x] 4.6 Run the 3 tests from 4.1 only.

**Acceptance Criteria:**
- The 3 tests pass.
- Existing `PLUGIN_MANAGEMENT`-only accounts (including the seeded `admin`, which now also has `ADMIN` from Group 1 — verify the test isolates a principal with only `PLUGIN_MANAGEMENT` to catch a real regression) continue to reach all 3 previously-gated routes unchanged.
- An `ADMIN`-only principal (no `PLUGIN_MANAGEMENT`) can also reach all 3 routes.

---

### Task Group 5: Frontend Category Data Layer + All Category-Representation Consumers
**Dependencies:** Task Group 3 (backend `category_id`/`product_category_id`+`product_category_name` shapes must be final before frontend types are written to match)
**Files to Modify:**
- `src/frontend/src/api/categories.ts` (new)
- `src/frontend/src/hooks/useCategories.ts` (new)
- `src/frontend/src/api/products.ts`
- `src/frontend/src/api/terms.ts`
- `src/frontend/src/api/groups.ts`
- `src/frontend/src/hooks/useProducts.ts`
- `src/frontend/src/utils/itemQuickAdd.ts`
- `src/frontend/src/utils/neededItemQuickAdd.ts`
- `src/frontend/src/utils/productCategory.ts`
- `src/frontend/src/pages/ProductListPage.tsx`
- `src/frontend/src/pages/ProductFormPage.tsx`
- `src/frontend/src/pages/ProductDetailPage.tsx`
- `src/frontend/src/pages/CarbonFootprintLandingPage.tsx`
- `src/frontend/src/components/shared/ItemQuickAddForm.tsx`
- `src/frontend/src/components/shared/NeededItemQuickAddForm.tsx`
- `src/frontend/src/components/panel/EditTermDialog.tsx`
- `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- `src/frontend/src/pages/panel/PanelDataContext.tsx`
**Estimated Steps:** 20
**Note:** See "Atomicity/sequencing" in Overview — this group must execute as one uninterrupted unit; a partial rename leaves every listed consumer failing to type-check.

- [x] 5.0 Complete frontend category-representation migration
  - [x] 5.1 Write 7 focused tests:
    - `useCategories()` fetches and returns categories ordered by `sortOrder` (mocked `api/categories.ts`).
    - `useCategories()` exposes `remove(id)` that propagates a backend `ApiError`'s `detail` message on 409 (not swallowed).
    - `useProducts({ category_id })` passes `category_id` through to `getProducts()`'s query string (not the retired `category` string).
    - `ProductFormPage`'s category `<select>` renders options from `useCategories()`'s live data and submits `category_id`.
    - `ItemQuickAddForm`'s category `<select>` submits `resolveProduct({ name, category_id })`.
    - `ProductDetailPage`/`CarbonFootprintLandingPage` resolve the category display name from `useCategories()`'s data by id (not `CATEGORY_LABELS`).
    - `RzeczyView`'s category filter `<select>` renders from live category data.
  - [x] 5.2 New `src/frontend/src/api/categories.ts` (mirrors `api/products.ts`): `getCategories()`, `getCategory(id)`, `createCategory(request)`, `updateCategory(id, request)`, `deleteCategory(id)`, `moveCategory(id, direction)`; `Category` TS type with `productCount`/`sortOrder` (camel/snake convention matching `api/products.ts`).
  - [x] 5.3 New `src/frontend/src/hooks/useCategories.ts` (mirrors `useProducts.ts`): `{ data, loading, error, remove, move }`, `remove(id)` propagates the backend's actual `ApiError`/`detail` message rather than a generic string.
  - [x] 5.4 `api/products.ts`: remove the `ProductCategory` string-literal union; convert every field typed with it — `ProductResponse.category` (line 12), `CreateProductRequest.category` (24), `UpdateProductRequest.category` (33), `ProductSearchParams.category` (37), `ResolveProductRequest.category` (45) — to `category_id: number`; `getProducts()`'s query-string serialization (line 50) becomes `if (params?.category_id) searchParams.set("category_id", String(params.category_id))`.
  - [x] 5.5 `api/terms.ts` (line 25): `NeededItemResponse.product_category: ProductCategory` → `product_category_id: number` + `product_category_name: string`.
  - [x] 5.6 `api/groups.ts` (line 2 import, line 110): `PublicNeededItemResponse.product_category: ProductCategory` → `product_category_id: number` + `product_category_name: string` (known-gap file, independently reconfirmed this session).
  - [x] 5.7 `hooks/useProducts.ts` (lines 6, 26, 37, 48): drop the `ProductCategory` import from `api/products`; `UseProductsParams.category?: ProductCategory` → `category_id?: number`; thread through `getProducts({ ..., category_id })` in `refetch()`.
  - [x] 5.8 `utils/itemQuickAdd.ts` (lines 7, 19): `ItemQuickAddValue.category: ProductCategory` → `category_id: number`; `createEmptyItemQuickAddValue()`'s hardcoded `category: "OTHER"` default → a `category_id` default sourced from `useCategories()`'s data at the call site (not a hardcoded literal).
  - [x] 5.9 `utils/neededItemQuickAdd.ts` (lines 11, 16): same `category` → `category_id` rename and default-sourcing change.
  - [x] 5.10 `utils/productCategory.ts`: delete `PRODUCT_CATEGORIES`, `CATEGORY_LABELS`, `CATEGORY_COLORS`; keep only `CONDITION_LABELS`.
  - [x] 5.11 `pages/ProductListPage.tsx`: filter dropdown + list badges — migrate from `PRODUCT_CATEGORIES`/`CATEGORY_LABELS` to `useCategories()`'s live data, keyed by `category_id`.
  - [x] 5.12 `pages/ProductFormPage.tsx`: category `<select>` renders from `useCategories()`, submits `category_id` to the backend.
  - [x] 5.13 `pages/ProductDetailPage.tsx` (line 19 import, line 173 usage): label display via `useCategories()` lookup by id, not `CATEGORY_LABELS[product.category]`.
  - [x] 5.14 `pages/CarbonFootprintLandingPage.tsx` (line 8 import, line 114 usage): same `CATEGORY_LABELS` → `useCategories()` lookup change.
  - [x] 5.15 `components/shared/ItemQuickAddForm.tsx`: category `<select>` from `useCategories()`, submits `resolveProduct({ name, category_id })`.
  - [x] 5.16 `components/shared/NeededItemQuickAddForm.tsx`: same pattern, submits to backend with `category_id`.
  - [x] 5.17 `components/panel/EditTermDialog.tsx` (lines 139, 154): category `<select>` from `useCategories()`; `item.product_category`/`orig?.product_category` → `item.product_category_id`/`orig?.product_category_id`; submits `category_id` to backend.
  - [x] 5.18 `pages/panel/views/RzeczyView.tsx`: category `<select>` filter (read-only) from `useCategories()`'s live data.
  - [x] 5.19 `pages/panel/PanelDataContext.tsx` (import at line 47, draft state at line 148, `resolveProduct({..., category})` calls at lines 491, 519, 764, 778, 785): drop the `ProductCategory` type import from `api/products`; thread `category_id` through draft state and all 5 `resolveProduct(...)` call sites.
  - [x] 5.20 Run the 7 tests from 5.1 only; confirm (grep) no remaining `ProductCategory` import or `category:` (as a category-enum field, not e.g. `categoryId`) anywhere under `src/frontend/src` outside historical test fixtures still pending rewrite in Task Group 8.
  - [x] 5.21 (added post-hoc, outside the original 20-step estimate) Fixed 2 collateral-breakage files found by `tsc -b` that were NOT in this group's original `Files to Modify` list but broke from the shared `itemQuickAdd.ts`/`neededItemQuickAdd.ts` rename: `src/frontend/src/components/onboarding/steps/guestSteps.tsx` and `organizerSteps.tsx`, both calling `resolveProduct({ name, category: value.category })` — updated to `category_id: value.category_id` / `category_id: item.category_id`. Verified via `npx tsc -b --force`: zero errors outside the 10 known-pending Group 8 test files.

**Acceptance Criteria:**
- The 7 tests pass.
- `useCategories()` is the single source of truth for the category list on the frontend; `PRODUCT_CATEGORIES`/`CATEGORY_LABELS`/`CATEGORY_COLORS` no longer exist anywhere in the codebase.
- `api/products.ts`'s `ProductCategory` type no longer exists; no remaining import of it from any file (including `hooks/useProducts.ts`).
- All 17 files listed above render/submit categories via `useCategories()` or `category_id` — this is the full, independently-reconfirmed frontend touch-point list (13 from spec.md's Frontend items 10-11 + `api/groups.ts` known gap + `ProductDetailPage.tsx`/`CarbonFootprintLandingPage.tsx`, which reference `CATEGORY_LABELS` without directly naming the `ProductCategory` type, plus `utils/productCategory.ts` itself).
- No file in this list fails to type-check after the change (verified as part of "tests pass" for this group, since a type error here would fail `vitest`'s TS transform for any test file importing these modules).

---

### Task Group 6: Frontend Category Admin UI (`CategoryListPage`, `CategoryFormPage`, `ConfirmDialog`)
**Dependencies:** Task Group 5 (needs `useCategories()`/`api/categories.ts`)
**Files to Modify:**
- `src/frontend/src/pages/CategoryListPage.tsx` (new)
- `src/frontend/src/pages/CategoryFormPage.tsx` (new)
- `src/frontend/src/components/shared/ConfirmDialog.tsx`
- `src/frontend/src/router.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:category-list
  locator: "Mockup 2: CategoryListPage — Main View" (lines 78-119)
  acceptance: heading "Categories" + subtitle "Manage the product category dictionary"; `+ Add Category` top-right gated `isAdmin`; table columns exactly `NAME` / `PRODUCTS IN USE` / `ACTIONS`; no search/filter row; per-row `Edit`/`Delete` ghost buttons gated `isAdmin`; white bordered rounded card (`border 1px #E2E8F0`, `borderRadius 12px`); `ConfirmDialog` used for delete.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:category-list-empty
  locator: "Mockup 3: CategoryListPage — Empty State" (lines 122-143)
  acceptance: `EmptyState` renders title "No categories found", description "Create your first category to get started.", and an action button rendered ONLY when `isAdmin`.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:category-form
  locator: "Mockup 4: CategoryFormPage — Create/Edit" (lines 145-187)
  acceptance: breadcrumb "Categories / Edit Category" (or "Add New Category"); single-column `Grid` (not two-column); `name` required with red `*`; `description` optional `<Textarea>`; footer `Cancel` (outline, links to `/categories`) + `PrimaryButton` "Save Category", right-aligned above a top border.
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:category-delete-blocked
  locator: "Mockup 5: Delete-Blocked State" (lines 190-234)
  acceptance: `ConfirmDialog` stays open (not auto-closed) when the 409 error occurs; new error banner (`bg #FEE2E2`, `color #991B1B`) renders inside the dialog body above the footer buttons, `aria-live="polite"`; banner text is the verbatim backend `detail` message (e.g. `Cannot delete "Zabawka": 12 product(s) still use this category.`), not a generic fallback string; `ProductListPage`'s existing delete flow (which doesn't pass `error`) is unaffected and still closes-on-confirm.
**Estimated Steps:** 12

- [x] 6.0 Complete category admin UI
  - [x] 6.1 Write 6 focused tests:
    - `CategoryListPage` renders the table with `NAME`/`PRODUCTS IN USE`/`ACTIONS` columns from mocked `useCategories()` data.
    - `+ Add Category`, per-row `Edit`/`Delete` render only when `permissions.includes("ADMIN")`.
    - `CategoryListPage` renders `EmptyState` (with action gated on `isAdmin`) when `useCategories()` returns zero rows.
    - `CategoryFormPage` renders single-column `name`(required)/`description`(optional) fields and submits via `createCategory`/`updateCategory` depending on `isEdit`.
    - `ConfirmDialog` renders the new `error` banner (with `aria-live="polite"`) when `error` prop is set, and stays open (does not call its close callback) in that case.
    - `ProductListPage`'s existing delete flow (no `error` prop passed) is unaffected — dialog still closes on confirm, per the additive-only guarantee for `ConfirmDialog`.
  - [x] 6.2 `ConfirmDialog.tsx`: add optional `error?: string | null` prop, rendered as a banner (`bg="#FEE2E2" color="#991B1B"`) inside the dialog body above the footer buttons, `aria-live="polite"`; dialog stays open (not auto-closed) when `error` is set; no change to existing callers that don't pass it.
  - [x] 6.3 New `CategoryListPage.tsx` (structural port of `ProductListPage.tsx`): heading + `+ Add Category` (gated `permissions.includes("ADMIN")`, top-right); table (no search/filter row); up/down arrow reorder buttons per row (calls `moveCategory(id, direction)`); per-row `Edit`/`Delete` gated `ADMIN`; `ConfirmDialog` for delete; `EmptyState` for zero rows.
  - [x] 6.4 `CategoryListPage`'s delete handler propagates the backend's actual 409 `detail` (via `ApiError` from `api/client.ts`) into `ConfirmDialog`'s new `error` prop — explicit fix of the generic-catch anti-pattern in `ProductFormPage.tsx`; do NOT replicate that pattern here.
  - [x] 6.5 New `CategoryFormPage.tsx` (structural port of `ProductFormPage.tsx`, reduced to single-column `Grid`, 2 fields): `name` required, `description` optional `<Textarea>`, shared between `/categories/new` and `/categories/:id/edit` (`isEdit = Boolean(id)`), same breadcrumb/card/footer conventions.
  - [x] 6.6 `router.tsx`: add `{ path: "categories", element: <CategoryListPage /> }`, `{ path: "categories/new", element: <CategoryFormPage /> }`, `{ path: "categories/:id/edit", element: <CategoryFormPage /> }` as `Layout()` children, alongside existing `products`/`plugins` entries (~lines 99-110).
  - [x] 6.7 Accessibility pass: real `<label htmlFor>` on `name`/`description`; `aria-label` on icon-only row actions (`Edit ${category.name}` / `Delete ${category.name}`), matching `ProductListPage.tsx`'s existing pattern.
  - [x] 6.8 Self-check each Visual Reference `acceptance` criterion above against the implemented pages before marking this group done.
  - [x] 6.9-6.12 (reserved — implementer may split 6.3/6.5 into sub-steps as needed for the list/form page's internal structure)
  - [x] 6.12 Run the 6 tests from 6.1 only.

**Acceptance Criteria:**
- The 6 tests pass.
- Implementation matches each `acceptance` criterion declared in Visual References above.
- Deleting a category referenced by ≥1 product shows the exact 409 message inside the still-open `ConfirmDialog`, not a generic fallback.
- `ProductListPage`'s existing delete flow is unaffected (regression-checked).

---

### Task Group 7: Frontend Sidebar/Nav `ADMIN` Gating
**Dependencies:** Task Group 6 (nav target route `/categories` should exist before the nav item linking to it ships)
**Files to Modify:**
- `src/frontend/src/components/layout/Sidebar.tsx`
- `src/frontend/src/components/shared/Icons.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:sidebar-admin-nav
  locator: "Mockup 1: Sidebar Nav — Before/After" (lines 41-75)
  acceptance: new `NavItem to="/categories" label="Categories" icon={CategoriesIcon}` inserted directly after "Krąg grupy" and before the `hasPluginManagement` block, gated `permissions.includes("ADMIN")`; the Plugins `NavItem` gate (line 94) AND the plugin-contributed sub-menu gate (line 97, independently confirmed as a second, previously-uncovered gate) BOTH change from `{hasPluginManagement && ...}` to `{(hasPluginManagement || isAdmin) && ...}`, where `hasPluginManagement` itself (line 67) is unchanged.
**Estimated Steps:** 6

- [x] 7.0 Complete sidebar ADMIN gating
  - [x] 7.1 Write 4 focused tests:
    - `isAdmin`-only principal sees "Categories" nav item; `PLUGIN_MANAGEMENT`-only or neither-permission principal does not.
    - `PLUGIN_MANAGEMENT`-only principal sees "Plugins" NavItem AND its `PluginMenuItems` sub-items (regression check on the line-97 gate).
    - `ADMIN`-only principal (no `PLUGIN_MANAGEMENT`) sees BOTH the "Plugins" NavItem (line 94) AND its `PluginMenuItems` sub-items (line 97) — this is the known-gap fix; without it an ADMIN-only principal would see the Plugins link but not the plugin-contributed menu items.
    - A principal with neither `PLUGIN_MANAGEMENT` nor `ADMIN` sees neither "Categories" nor "Plugins"/its sub-items.
  - [x] 7.2 `Sidebar.tsx`: add `const isAdmin = permissions.includes("ADMIN");` and `{isAdmin && <NavItem to="/categories" label="Categories" icon={CategoriesIcon} />}` inserted after "Krąg grupy" and before the `hasPluginManagement` block (line 93/94 region).
  - [x] 7.3 `Sidebar.tsx` line 94: `{hasPluginManagement && (...)}` → `{(hasPluginManagement || isAdmin) && (...)}` (the NavItem itself).
  - [x] 7.4 `Sidebar.tsx` line 97 (known gap — independently reconfirmed this session): `{hasPluginManagement && <PluginMenuItems />}` → `{(hasPluginManagement || isAdmin) && <PluginMenuItems />}`.
  - [x] 7.5 `Icons.tsx`: add `export const CategoriesIcon = Tag;` (or `Tags`) following the existing one-liner `lucide-react` re-export pattern next to `ProductsIcon`/`PluginsIcon`.
  - [x] 7.6 Run the 4 tests from 7.1 only.

**Acceptance Criteria:**
- The 4 tests pass.
- Sidebar shows "Categories" only for `ADMIN` principals.
- Sidebar shows "Plugins" (NavItem AND its sub-menu items) for `PLUGIN_MANAGEMENT`-only, `ADMIN`-only, and both-permission principals; hides both for principals with neither.
- Implementation matches the Visual Reference acceptance criterion above.

---

### Task Group 8: Existing Test Suite Rewrite — Frontend (10 files)
**Dependencies:** Task Group 5
**Files to Modify:**
- `src/frontend/src/test/PanelPage.test.tsx`
- `src/frontend/src/test/pages.test.tsx`
- `src/frontend/src/test/extension-points.test.tsx`
- `src/frontend/src/test/FootprintComparisonPage.test.tsx`
- `src/frontend/src/test/ProductFootprintPage.test.tsx`
- `src/frontend/src/test/CarbonFootprintLandingPage.test.tsx`
- `src/frontend/src/test/KragGrupyPage.test.tsx`
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`
- `src/frontend/src/test/ItemQuickAddForm.test.tsx`
- `src/frontend/src/test/NeededItemQuickAddForm.test.tsx`
**Estimated Steps:** 11

This group contains **no new strategic tests** (0 of the 2-8 budget) — it exclusively rewrites existing tests broken by Task Group 5's DTO/type rename, per the Testing Approach's explicit instruction that broken tests "must be rewritten, not just left to fail."

- [x] 8.0 Rewrite all 10 broken frontend test files
  - [x] 8.1 `ItemQuickAddForm.test.tsx` / `NeededItemQuickAddForm.test.tsx`: both currently import `CATEGORY_LABELS, PRODUCT_CATEGORIES` from `utils/productCategory.ts` (retired in Group 5) and assert the `Typ` `<select>`'s option labels against them — rewrite to assert against `useCategories()`'s fetched/mocked data instead.
  - [x] 8.2 `PanelPage.test.tsx` (11 occurrences at lines 454, 478, 1243, 1247, 1343, 1367, 1370, 1381, 1450, 1490, 1545): each fixture's `category`/`product_category` field → `category_id`/`product_category_id`+`product_category_name` per its DTO; each `expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name, category: "..." })` assertion → `category_id`-based.
  - [x] 8.3 `pages.test.tsx` (lines 51, 63): two `ProductResponse` fixtures' `category` field → `category_id`.
  - [x] 8.4 `extension-points.test.tsx` (line 89): same `ProductResponse` fixture pattern.
  - [x] 8.5 `FootprintComparisonPage.test.tsx` (line 39): same `ProductResponse` fixture pattern.
  - [x] 8.6 `ProductFootprintPage.test.tsx` (line 50): same `ProductResponse` fixture pattern.
  - [x] 8.7 `CarbonFootprintLandingPage.test.tsx` (lines 48, 60): two `ProductResponse` fixtures.
  - [x] 8.8 `KragGrupyPage.test.tsx` (line 28): `NeededItemResponse`-shaped fixture's `product_category` field → `product_category_id` + `product_category_name`. (Verified: `KragGrupyPage.tsx` itself does not render the category field — this file needs a fixture-shape fix only, no component change.)
  - [x] 8.9 `PublicKragGrupyPage.test.tsx` (line 87): same `NeededItemResponse`-shaped fixture pattern, on the public/unauthenticated page's own test suite — the highest-risk file family in this rewrite, since it backs `api/groups.ts` (known gap, fixed in Group 5).
  - [x] 8.10 Confirm (grep) no remaining `category:`/`product_category:` string-literal mock fields anywhere in `src/frontend/src/test/`.
  - [x] 8.11 Run all 10 rewritten test files (not the full suite).

**Acceptance Criteria:**
- All 10 files pass after rewrite; none are left red or silently skipped.
- No test file retains a `ProductResponse`/`NeededItemResponse` fixture typed with the retired `category`/`product_category` (enum-string) shape.

---

### Task Group 9: Test Review & Gap Analysis
**Dependencies:** All previous groups (1-8)
**Files to Modify:** `src/backend/tests/*.py`, `src/frontend/src/test/*.test.tsx` (append-only — whatever files the gap analysis identifies)

- [ ] 9.0 Review and fill critical gaps
  - [ ] 9.1 Review tests from all 8 prior groups (≈45-50 new/rewritten tests across backend + frontend).
  - [ ] 9.2 Analyze gaps for THIS feature only — candidates to check: end-to-end `alembic upgrade head` → `editor`-login → create/edit product regression walk; `move_category` boundary cases (moving the first/last row); concurrent-delete race on `delete_category`; `CategoryFormPage` validation (empty `name` rejected); Sidebar gating combined with the actual JWT-decoded `permissions` array shape (not just a mocked array).
  - [ ] 9.3 Write up to 10 additional strategic tests covering the highest-value gaps found in 9.2 (prioritize the "editor regression" and "public page regression" scenarios — the two explicitly called out in spec.md's Success Criteria as the task's highest-value checks).
  - [ ] 9.4 Run feature-specific tests only (backend category/product/groups tests + frontend category/sidebar/product tests — expect roughly 45-60 total across both stacks, plus the 16 rewritten existing tests).

**Acceptance Criteria:**
- All feature tests pass.
- No more than 10 additional tests added in this group.
- The manual/scripted regression check (seeded `editor` account can still create/edit products end-to-end after the migration) is confirmed at least once.

---

## Execution Order

1. Task Group 1 — Database Migration & `ADMIN` Permission (9 steps)
2. Task Group 2 — Backend Category Module + Authorization Matrix (10 steps, depends on 1)
3. Task Group 3 — Backend Category FK Rename: Product + Cross-Context + Test Rewrites (16 steps, depends on 1, 2 — **must run immediately after 2, nothing interleaved**)
4. Task Group 4 — Backend Plugin `ADMIN` Gating (6 steps, depends on 2)
5. Task Group 5 — Frontend Category Data Layer + All Consumers (20 steps, depends on 3 — **must run immediately after 3 completes, nothing interleaved**)
6. Task Group 6 — Frontend Category Admin UI (12 steps, depends on 5)
7. Task Group 7 — Frontend Sidebar/Nav `ADMIN` Gating (6 steps, depends on 6)
8. Task Group 8 — Existing Test Suite Rewrite: Frontend (11 steps, depends on 5)
9. Task Group 9 — Test Review & Gap Analysis (4 steps, depends on 1-8)

Groups 4 and 8 have no dependency on each other or on 6/7, and can run in parallel with 6/7 once their own dependencies (2 and 5, respectively) are satisfied — but Group 4 shares `authorization_matrix.py` with Group 2 (not Group 6/7), so it may proceed concurrently with 5/6/7 once Group 2 lands.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/` — always applicable (minimal-implementation: no speculative category endpoints beyond what the up/down-reorder UI needs; commenting: no change-log comments).
- `backend/models.md` — `Category extends BaseEntity`; explicit `Sequence` PK; business-key `__eq__`/`__hash__` on `name`; cross-module references (`Product.category_id`, `app.groups`) use plain FK-id columns, never a cross-module `relationship()`.
- `backend/queries.md` — `list_categories`' `product_count` is one aggregated `GROUP BY` query, not N+1; `Product.category_id` indexed via `op.create_index` in the migration.
- `backend/migrations.md` — explicit `Sequence` (not `IDENTITY`); reversible `downgrade()`; `{pk,fk,uq,ix}_{table}_{column}` naming convention.
- `backend/security.md` — matrix-first workflow; no route performs its own ad-hoc permission check.
- `backend/api.md` — `/api/categories` plural noun, resource-based, standard HTTP status codes (201 create, 204 delete, 409 conflict).
- `frontend/accessibility.md` — real `<label htmlFor>`, `aria-label` on icon-only row actions, `aria-live="polite"` on the new error banner.

## Notes

- Test-Driven: each implementation group starts with 2-8 new tests (Groups 1,2,4,5,6,7 write 4/8/3/7/6/4 respectively = 32 new backend+frontend tests total); Group 3 writes 6 new tests distinct from its 6 rewritten files; Group 8 writes 0 new tests (pure rewrite); Group 9 adds up to 10 strategic tests.
- Existing-test rewrites (16 files: 6 backend in Group 3, 10 frontend in Group 8) are mandatory fixes, tracked separately from the 2-8-per-group new-test budget.
- Run Incrementally: each group runs only its own new/rewritten tests, never the full suite (`skip_test_suite: true` per orchestrator state).
- Mark Progress: check off steps as completed in this file.
- Reuse First: `app/product/*` is both a structural template for `app/category/` AND a direct edit target (Group 2 vs. Group 3) — do not confuse the two roles. Same duality for `hooks/useProducts.ts` (template for `useCategories.ts`, also itself edited) and `ProductListPage.tsx`/`ProductFormPage.tsx` (template for `CategoryListPage.tsx`/`CategoryFormPage.tsx`, also themselves edited for the category_id rename in Group 5).
- Known Limitations carried through unchanged (not fixed by any group above, per spec.md's Out of Scope): `plugins/PluginMessageHandler.ts`'s `getProducts` category-filter no-op, and (per this plan's independent verification) the identical no-op in `plugins/server-sdk.ts`'s `getProducts` (lines 83-88) and `plugins/sdk.ts`'s stale doc-comment (line 34). No task group above touches any of these 3 files — confirm this remains true at final review (a diff on any of them is a scope regression, not a fix).
