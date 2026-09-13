# Scope Clarifications (Phase 2)

## Critical decisions — resolved with user (all recommended options accepted)

1. **`app.groups` cross-context break**: Join through to `Category` and rename/add fields —
   `NeededItemResponse`/`PublicNeededItemResponse` gain `product_category_id` (FK) +
   `product_category_name` (string). `repository.py`'s join updated accordingly. Breaking
   API shape change accepted (pre-production, no backward-compat constraint).

2. **Frontend category consumers**: ALL 8 consumers of `utils/productCategory.ts`
   (`ProductListPage`, `ProductFormPage`, `ProductDetailPage`, `CarbonFootprintLandingPage`,
   `ItemQuickAddForm`, `NeededItemQuickAddForm`, `EditTermDialog`, `RzeczyView.tsx`) migrate
   to a new shared `useCategories()` hook (mirrors `useProducts.ts`). This also resolves
   "Important" decision 3 below (RzeczyView included).

3. **Plugin gating**: `require_any("PLUGIN_MANAGEMENT", "ADMIN")` — coexist, additive. No
   destructive change to the existing seeded `PLUGIN_MANAGEMENT` permission. Frontend
   `Sidebar.tsx`'s `hasPluginManagement` check becomes
   `permissions.includes("PLUGIN_MANAGEMENT") || permissions.includes("ADMIN")`.

4. **Category READ gating**: `GET /api/categories(/.*)?` stays on generic `require_any("READ", "mcp:read")`
   (mirrors `app/product/router.py`'s `ReadPrincipal`). Only `POST`/`PUT`/`DELETE` require
   `ADMIN`. Two separate `AUTHORIZATION_MATRIX` rows (not one combined row), following the
   product router's rows 11/17 pattern. This avoids regressing the `editor` seed account's
   ability to create/edit products.

## Important decisions — resolved with user

5. **Category seed content** (user override — do NOT reuse `CATEGORY_LABELS`'s current
   English values): seed the 5 initial rows with **Polish** names, since the category list
   is now a real, admin-editable dictionary and should match the rest of the app's Polish UI
   (unlike the current `CATEGORY_LABELS` map, which is English despite the app being
   Polish-language). Mapping from the existing enum tokens:
   - `TOY` → "Zabawka"
   - `BOOK` → "Książka"
   - `GAME` → "Gra"
   - `CLOTHING` → "Ubranie"
   - `OTHER` → "Inne"

   `CATEGORY_LABELS`/`CATEGORY_COLORS` in `utils/productCategory.ts` are retired entirely
   once the 8 consumers move to `useCategories()` (category `name` comes live from the DB;
   colors, if still wanted per-category, need a new `color` column on `Category` or a
   frontend-only fallback palette keyed by id — flag as an open spec question, not a Phase 2
   decision).

6. **Admin bootstrapping**: manual/seed-only for this task. A new seed/data migration grants
   `ADMIN` to the existing dev `admin` account, mirroring how `PLUGIN_MANAGEMENT` was
   originally seeded in `0002_seed_dev_users.py`. No general permission-grant API/UI is
   built. Flagged as a known limitation in spec.md.

## Net scope (superseding the literal "2 admin pages" reading from Phase 1)

- New `app/category/` backend module (flat, mirrors `app/product`) + migration reversing `0006`.
- `app/groups` DDD module updated (repository join + 2 response DTOs) — second bounded context.
- New `Permission.ADMIN`, coexisting with `PLUGIN_MANAGEMENT` on plugin routes.
- New `CategoryListPage`/`CategoryFormPage` under existing `AppShell`/`Sidebar`.
- New `api/categories.ts` + `useCategories()` hook; **8** existing frontend files migrated to it.
- `AUTHORIZATION_MATRIX`: new rows for category GET (`READ`) and category mutations (`ADMIN`);
  plugin management rows updated to `("PLUGIN_MANAGEMENT", "ADMIN")`.
- Data migration: create `categories` + `category_seq`, seed 5 rows (human labels), backfill
  `products.category_id`, drop old `products.category` enum column, add FK NOT NULL.
