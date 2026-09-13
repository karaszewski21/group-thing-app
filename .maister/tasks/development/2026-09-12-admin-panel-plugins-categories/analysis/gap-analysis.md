# Gap Analysis: Admin Panel — Plugins & Product Categories

## Summary
- **Risk Level**: High (escalated from codebase-analysis's "Medium" — see Recommendations for why)
- **Estimated Effort**: High
- **Detected Characteristics**: creates_new_entities, modifies_existing_code, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes — `Product.category` column type, `app.plugin.router` permission gating, `app.groups` DDD-module schemas/repository, `router.tsx`, `Sidebar.tsx`
- Creates new entities: yes — `Category` (backend module + table), `Permission.ADMIN`
- Involves data operations: yes — new migration creates `categories`, backfills `products.category_id` from the existing enum column, and the new module needs full CRUD
- UI heavy: yes — new `CategoryListPage`/`CategoryFormPage`, nav gating changes, and (per gap analysis below) at least 6 existing product/panel forms need to switch from a static category list to a fetched one

## Gaps Identified

### Missing Features
- **`Category` entity/table**: does not exist. Was removed in `alembic/versions/0006_product_category_enum.py`. That migration's `downgrade()` function is a near-complete template for the new `categories` table shape (`id` via `category_seq`, `name`, `description`, `created_at`/`updated_at`) — `app/core/base_model.py`'s `BaseEntity` docstring already lists `categories` among the tables it was designed for, confirming `category_seq` as the expected sequence name.
- **`app/category/` module**: does not exist (router/service/models/schemas). `app/product/` (flat, function-based, `EntityNotFoundException`/`BusinessConflictException` pattern) is the correct template, exactly as locked decision #1 states.
- **`Permission.ADMIN`**: does not exist in `app/auth/models.py` (only `READ`, `EDIT`, `PLUGIN_MANAGEMENT`).
- **Admin-granting mechanism**: no API/UI exists to grant any permission to a user today — `alembic/versions/0002_seed_dev_users.py` is the only mechanism (raw SQL `INSERT`, dev accounts `viewer`/`editor`/`admin`). Confirmed still true.

### Incomplete Features
- **Frontend permission-awareness — CORRECTION to codebase-analysis**: the codebase analysis stated "the client currently does **not** decode the JWT" and flagged a new JWT-decoding mechanism as a likely requirement. This is **incorrect** — `src/frontend/src/auth/AuthContext.tsx` already decodes the JWT's `permissions` claim (`decodeJwtPayload`) and exposes it as `permissions: string[]` via `useAuth()`. `Sidebar.tsx`, `ProductListPage.tsx`, and `PluginListPage.tsx` all already consume it (`permissions.includes("PLUGIN_MANAGEMENT")` / `"EDIT"`). **No new mechanism is needed** — admin gating is simply `permissions.includes("ADMIN")` using the existing hook, in both `Sidebar.tsx` (nav item visibility) and a route-level guard (or component-level check, matching current convention — there is no existing route-level permission guard component, only component-level checks).

### Behavioral Changes Needed
- `Product.category`: from `ProductCategory` StrEnum column (VARCHAR) → FK to `categories.id`. This reverses the exact upgrade path of migration `0006`.
- `app/plugin/router.py`'s three `ManagementPrincipal`-gated routes (manifest PUT, enabled PATCH, descriptor DELETE): need `"ADMIN"` added to their `require_any(...)` call (see Decision 3 below for coexist-vs-replace).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | Plugins reachable via Sidebar (gated on `PLUGIN_MANAGEMENT`); Categories not reachable (no screen exists) | Both reachable via new/adjusted Sidebar items gated on `ADMIN` (and/or `PLUGIN_MANAGEMENT`), same nav pattern as Products/Plugins | ✅ — no new nav paradigm needed, matches existing `NavItem` pattern exactly |
| Discoverability | 7-8/10 for existing Plugins item (standard sidebar pattern) | 8/10 for new Categories item — identical visual treatment to Products/Plugins | ✅ |
| Flow Integration | Category values are invisibly hardcoded inside every product/item form | Categories become a real, admin-editable list — but **only if every consumer switches to fetching it** (see Critical Decision 2) | ⚠️ — conditional on scope decision |
| Multi-Persona | N/A (no admin concept) | ADMIN-only for category mutation; READ-permission users still need read access to categories to use product/item forms | ⚠️ — see Critical Decision 4, a real regression risk if mis-gated |

## Data Lifecycle Analysis

### Entity: Category

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing — needs `POST /api/categories` in new `app/category/router.py` | Missing — `CategoryFormPage` (new) | Missing — new route in `router.tsx` + Sidebar link | ❌ |
| READ | Missing — needs `GET /api/categories`, `GET /api/categories/{id}` | Missing — `CategoryListPage` (new) | Missing | ❌ |
| UPDATE | Missing — needs `PUT /api/categories/{id}` | Missing — `CategoryFormPage` edit mode | Missing | ❌ |
| DELETE | Missing — needs `DELETE /api/categories/{id}`, must reject (409, `BusinessConflictException` subclass e.g. `CategoryHasProductsException`) if referenced by any `Product`, mirroring `ProductHasInventoryItemsException`'s `IntegrityError`-catch pattern in `app/product/service.py` | Missing — `ConfirmDialog` reuse | Missing | ❌ |

**Completeness**: 0% (entity does not exist at all yet — expected, this is new-capability work, not a partial-implementation gap)

**Orphaned Operations (the real gap — not the "doesn't exist yet" backend/UI, but the *existing* multi-touchpoint consumers of the category concept)**:

Every one of the following currently treats "categories" as a **static, hardcoded, synchronous** list (`PRODUCT_CATEGORIES`/`CATEGORY_LABELS`/`CATEGORY_COLORS` from `src/frontend/src/utils/productCategory.ts`). Once `Product.category` becomes an FK to a real, admin-editable `Category` table, every one of these becomes a potential orphan — either showing stale/wrong options, or (worse) submitting a `category` value that no longer round-trips to a valid `category_id`:

1. `src/frontend/src/pages/ProductListPage.tsx` — category filter dropdown + list badges
2. `src/frontend/src/pages/ProductFormPage.tsx` — category `<select>` on product create/edit (**submits the category value to the backend** — this one is not just cosmetic, it must produce a valid FK)
3. `src/frontend/src/pages/ProductDetailPage.tsx` — label display
4. `src/frontend/src/pages/CarbonFootprintLandingPage.tsx` — label display
5. `src/frontend/src/components/shared/ItemQuickAddForm.tsx` — category `<select>`, feeds `resolveProduct({name, category})` (**submits to backend**)
6. `src/frontend/src/components/shared/NeededItemQuickAddForm.tsx` — category `<select>` (**submits to backend**)
7. `src/frontend/src/components/panel/EditTermDialog.tsx` — category `<select>` (**submits to backend**)
8. `src/frontend/src/pages/panel/views/RzeczyView.tsx` — category `<select>` filter

Four of these (#2, #5, #6, #7) **construct and submit** a category value as part of a create/resolve request. If the backend's `category` field changes type from a closed enum string to an FK id, these forms literally cannot keep working off the hardcoded `PRODUCT_CATEGORIES` array — any admin-added category is invisible to them, and if the enum's original 5 string values are dropped/renamed by an admin post-migration, these forms would submit invalid data. **This is not optional polish; it's required for correctness**, not just discoverability. See Critical Decision 2.

**Missing Touchpoints**: none beyond the above — this is the complete set of category-consuming UI (confirmed via `grep -r "PRODUCT_CATEGORIES\|CATEGORY_LABELS\|CATEGORY_COLORS"`).

### Cross-bounded-context impact (NOT flagged in codebase-analysis — new finding)

`app/groups/` (the DDD-layered bounded context per project convention) directly imports and re-exposes `ProductCategory`:

- `app/groups/infrastructure/repository.py:14` — `from app.product.models import Product, ProductCategory`; `find_needed_item`/`list_needed_items_for_term` (lines ~184-251) do an explicit `.join(Product, NeededItem.product_id == Product.id)` and return `Row[tuple[NeededItem, str, ProductCategory]]`, i.e. `Product.category` is selected directly as a typed enum value.
- `app/groups/schemas.py:132` — `NeededItemResponse.product_category: ProductCategory`
- `app/groups/schemas.py:208` — `PublicNeededItemResponse.product_category: ProductCategory` — this is exposed on the **unauthenticated public circle/term page** (`GET /api/groups/public/{id}`), a currently-active, recently-touched feature per git log ("Potrzebne rzeczy" / needed-items UI work in the last several commits).
- Frontend: `src/frontend/src/api/groups.ts:110` — `product_category: ProductCategory` on the response type consumed by the Panel's "Rzeczy"/needed-items views.

Once `Product.category` is an FK, this join and these DTOs cannot keep returning a bare `ProductCategory` string — they need to either join through to `Category` and expose `product_category_id`/`product_category_name`, or otherwise resolve what a "category" means on a `NeededItem`. This is a real API contract change reaching into a second bounded context and a public, unauthenticated endpoint — flagged as Critical Decision 1.

## Defect Analysis
N/A — no reproducible defect, this is new-capability + modification work.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **`app.groups` cross-context breakage**: `NeededItemResponse.product_category`, `PublicNeededItemResponse.product_category` (the latter on a public, unauthenticated endpoint), and `repository.py`'s typed join all currently assume `Product.category` is a `ProductCategory` enum. Reversing it to an FK breaks these.
   - Options: (A) Join through to `Category` and rename the field(s) to `product_category_id` + `product_category_name` (breaking response-shape change, propagated to `src/frontend/src/api/groups.ts` and every Panel "Rzeczy"/needed-items consumer of that field); (B) Keep a `product_category` field but change its type to the joined category's name (string) rather than a closed enum, minimizing frontend churn but losing type safety; (C) Scope this task to exclude `app.groups` entirely and leave `NeededItem`'s category display broken/stale until a follow-up task.
   - Recommendation: (A) — join through and expose both id and name, consistent with `standards/backend/models.md`'s cross-module FK-id convention. The app is pre-production (no backward-compat constraint per project convention), so a clean breaking change is acceptable and preferable to (B)'s type-safety loss or (C)'s silent breakage of an actively-developed feature.

2. **Frontend category consumers must go dynamic, not just the new admin screens**: the 8 files listed under "Orphaned Operations" above hardcode categories. At minimum, the 4 that submit category data to the backend (`ProductFormPage`, `ItemQuickAddForm`, `NeededItemQuickAddForm`, `EditTermDialog`) must fetch the live category list once `category` becomes an FK — hardcoding a value that isn't a valid `category_id` will fail at the API.
   - Options: (A) Expand scope to introduce a shared `useCategories()` hook (mirroring `useProducts.ts`) and migrate all 8 consumers off `utils/productCategory.ts`'s static exports; (B) Migrate only the 4 that submit data, leave the other 4 read-only displays on the static list (risk: display labels silently go stale as admin renames/adds categories); (C) Keep scope to only the new admin screens and accept that product/item creation forms break or need a separate follow-up task.
   - Recommendation: (A). This is implied by, not additional to, the already-locked decision to make `Category` a real FK-backed entity — the locked scope note ("re-point `Product.category` at it") is silently incomplete without this, since nothing in the codebase can submit a valid category value otherwise.

3. **Plugin-management gating: coexist or replace `PLUGIN_MANAGEMENT`?** `app/plugin/router.py`'s `ManagementPrincipal = Annotated[Principal, Depends(require_any("PLUGIN_MANAGEMENT"))]` gates exactly 3 routes (manifest PUT, enabled PATCH, descriptor DELETE). The task description explicitly asks the gap-analyzer to surface this.
   - Options: (A) `require_any("PLUGIN_MANAGEMENT", "ADMIN")` — coexist, additive, no regression for the existing dev `editor`/`admin` seed accounts; (B) Replace `PLUGIN_MANAGEMENT` with `ADMIN` everywhere (would require a migration to re-grant `ADMIN` to the seeded dev `admin` account and effectively retires `PLUGIN_MANAGEMENT` as a permission, though it stays a defined enum value/historical data unless cleaned up).
   - Recommendation: (A) — matches the user's stated intent ("one ADMIN permission gating the whole admin section") without a destructive/breaking change to a permission that's already seeded and tested-by-implication in production-shaped dev data. Frontend `Sidebar.tsx`'s `hasPluginManagement` check similarly becomes `permissions.includes("PLUGIN_MANAGEMENT") || permissions.includes("ADMIN")`.

4. **Category READ must NOT be ADMIN-gated, only category WRITE** — a genuine regression risk, not just a nice-to-have. If `GET /api/categories` is gated the same as mutations (`ADMIN`-only, mirroring how the 3 plugin *management* routes are gated), then the existing `editor` account (permissions `READ`, `EDIT`, no `ADMIN`) — which today can freely create/edit products via `ProductFormPage` — **loses the ability to populate the category dropdown and thus loses the ability to create/edit products at all**. This would be a hard regression of existing, working functionality.
   - Options: (A) `GET /api/categories(/.*)?` gated by generic `require_any("READ", "mcp:read")` (mirroring `app/product/router.py`'s `ReadPrincipal` and `app/plugin/router.py`'s plain `("READ",)` GET rows — plugin GETs are explicitly *not* gated by `PLUGIN_MANAGEMENT`, same precedent applies here), while `POST`/`PUT`/`DELETE /api/categories` require `ADMIN`; (B) Gate all category routes (including GET) behind `ADMIN`.
   - Recommendation: (A) — required to avoid regressing the `editor` persona's existing product-management workflow. This must also get its own `AUTHORIZATION_MATRIX` rows (two, following rows 11/17's product pattern: one GET row on `("READ", "mcp:read")`, one POST/PUT/DELETE row on `("ADMIN",)`), not a single combined row.

### Important (Should Decide)

1. **Data migration seed content**: the new migration should create `categories` (per `0006`'s `downgrade()` template) and seed exactly 5 rows — one per existing `ProductCategory` value — then backfill `products.category_id` by matching the old string column, then drop the old column and add the `NOT NULL` FK.
   - Default: seed the 5 rows using the existing human-friendly labels from `CATEGORY_LABELS` ("Toy", "Book", "Game", "Clothing", "Other") as `name`, not the raw enum tokens ("TOY", "BOOK", ...) — gives admins sensible starting data instead of shouting-case tokens, and the enum token itself no longer needs to be preserved anywhere once the FK backfill is done by matching old `products.category` string → new `categories.name`-derived mapping (matched by position/value, not by re-parsing the label).
   - Rationale: cosmetic but visible immediately in the new `CategoryListPage` — worth getting right on first seed rather than a follow-up rename migration.

2. **Admin bootstrapping mechanism** (per task instructions, item (d)): no in-app way exists to grant `ADMIN` (or any permission) to a real (non-seeded) user.
   - Options: (A) Leave manual-only for this task (a new seed/data migration grants `ADMIN` to the existing dev `admin` account only, consistent with how `PLUGIN_MANAGEMENT` was originally seeded — no new UI/endpoint); (B) Build a minimal permission-grant endpoint/UI as part of this task.
   - Default: (A) — building a general permission-management UI is a meaningfully separate feature or the codebase-analysis explicitly calls "out of scope unless requested," and the locked decisions don't mention it. Flag as a known limitation in the spec rather than silently expanding scope.

3. **`RzeczyView.tsx`/panel "Rzeczy" (mobile Tailwind) category consumption**: this file is part of the guest/organizer-facing mobile Panel, architecturally separate from the admin Chakra shell (per project memory: pages/panel is a different, non-admin surface). It's included in the orphaned-operations list above (#8) because it also hardcodes `PRODUCT_CATEGORIES`, but whether to also migrate the mobile Panel surface to the dynamic category list in *this* task, versus treating it as a follow-up once the admin/product-side dynamic-category plumbing exists, is a scope-boundary question.
   - Default: include it — it's a read-only filter dropdown (not a data-submitting form), same shared `useCategories()` hook covers it at near-zero incremental cost once built for the other 4 consumers.

## Integration Points Summary

- **Backend routing**: new `app/category/router.py` mounted in the FastAPI app alongside `product`/`plugin` routers; new `AUTHORIZATION_MATRIX` rows (GET → `READ`, mutations → `ADMIN`) inserted before the row-25 catch-all, following rows 11/17's product pattern.
- **Schema/migration**: new Alembic migration (revises the current head, `0024_outbox_schema.py`) — creates `categories` + `category_seq`, seeds 5 rows, adds `products.category_id` FK, backfills, drops `products.category` (enum column) — largely mirrors `0006`'s `downgrade()` in reverse plus a data backfill step `0006` didn't need.
- **`app/groups` DDD module**: `infrastructure/repository.py`'s join and `schemas.py`'s two response DTOs need updating to work off the new FK (Critical Decision 1) — this is the highest-risk integration point, reaching into a second bounded context and a public unauthenticated endpoint.
- **Frontend data layer**: new `api/categories.ts` (mirrors `api/products.ts`); new `useCategories()` hook (mirrors `useProducts.ts`); 8 existing consumers of `utils/productCategory.ts` need migration (Critical Decision 2).
- **Frontend routing/nav**: `router.tsx` gets `categories`, `categories/new`, `categories/:id/edit` siblings inside `Layout()`'s children; `Sidebar.tsx` gets a new `ADMIN`-gated `NavItem` for Categories and an updated (not new-mechanism) gate for the existing Plugins `NavItem`.
- **Auth**: `app/auth/models.py`'s `Permission` enum gains `ADMIN`; a new seed/data migration grants it to the dev `admin` account; frontend gating reuses the *already-existing* `useAuth().permissions` (no new JWT-decoding mechanism needed — correction to codebase-analysis).

## Recommendations
1. Resolve Critical Decisions 1 and 2 before specification/planning — they materially change the file count and risk profile from what the locked scope note implies (a "Category CRUD module + 2 admin pages" reading understates the actual blast radius by roughly 2x: 8 frontend consumer files plus a second backend bounded context).
2. Treat Critical Decision 4 (category READ must stay open to `READ`/`EDIT` users, not `ADMIN`-only) as a hard correctness requirement, not a style preference — getting this wrong regresses the existing `editor` persona's ability to manage products.
3. Since the project is pre-production (no backward-compatibility constraint per project convention), prefer the cleaner breaking-change options (1A, 2A) over compatibility-preserving half-measures — this matches how `0006` itself was a clean, non-additive schema change.
4. Add first backend tests for both the new `category` module and the still-uncovered `plugin` module in the same pass, per codebase-analysis's existing recommendation — `test_authorization_matrix.py`'s pattern extends directly to the new ADMIN/category rows.

## Risk Assessment
- **Complexity Risk**: High — a schema reversal, a new bounded-context-crossing FK, and 8+ frontend consumer migrations, not just 2 new admin pages.
- **Integration Risk**: High — `app.groups`' public, unauthenticated endpoint (`PublicNeededItemResponse`) is a previously-unflagged integration point; a mis-scoped fix here has user-facing blast radius beyond the admin panel itself.
- **Regression Risk**: Medium-High — Critical Decision 4 (category READ gating) is a concrete regression vector for the existing `editor` persona if mis-implemented; Critical Decision 3 (plugin gating coexist-vs-replace) is a lower-severity regression vector for the same reason.
