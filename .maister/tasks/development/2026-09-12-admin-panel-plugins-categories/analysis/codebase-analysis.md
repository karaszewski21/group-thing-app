# Codebase Analysis Report

**Date**: 2026-09-12
**Task**: Admin panel — managing plugins and product categories ("rzeczy" = items) for a new admin role
**Description**: Admin panel — managing plugins and product categories ("rzeczy" = items), for a new admin role that doesn't exist yet in group-thing-app (Python/FastAPI backend + React/TypeScript frontend).
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

---

## Summary

Plugin management already exists as a complete, permission-gated backend + partial frontend feature — the task there is mostly UI polish (wire up Edit/Delete, replace the raw-JSON form) plus role work. Product **category** management does not exist as a manageable entity at all: `ProductCategory` is a closed Python `StrEnum` stored as a plain string column, and a real `Category` table/module was **deliberately removed** in a prior migration (`0006_product_category_enum.py`). There is also no "admin" concept anywhere in the codebase today — authorization is a flat `Permission` StrEnum (`READ`, `EDIT`, `PLUGIN_MANAGEMENT`) granted per-user, with no `ADMIN` role and no frontend permission-based gating at all. This makes the task two independent problems: (1) build an admin permission + gated UI/routes for plugin management (low risk, existing template), and (2) decide — before implementing — whether "category management" means resurrecting a real `Category` entity (schema-reversing, higher risk) or a lighter-weight admin view over the static enum/label map (no backend change, frontend-only).

---

## Files Identified

### Primary Files

**`src/backend/app/plugin/models.py`**
- `PluginDescriptor` (string-slug PK, own optimistic-lock timestamp pattern, not `BaseEntity`) and `PluginObject` (`BaseEntity`-backed).
- Directly relevant: this is the entity the admin panel's "plugins" screen manages.

**`src/backend/app/plugin/router.py`**
- Full route set: `PUT .../manifest` (upsert), `GET` list/detail, `DELETE`, `PATCH .../enabled`.
- Already gated by three permission tiers via `require_any(...)`: `ReadPrincipal`, `EditPrincipal`, `ManagementPrincipal = require_any("PLUGIN_MANAGEMENT")`.
- This is the closest existing precedent for admin-only route gating.

**`src/backend/app/plugin/service.py`**
- Function-based service, three logical groups: `PluginDescriptorService` (upsert/list/get/delete/set_enabled), `PluginDataService`, `PluginObjectService`.
- Template for how a new admin-adjacent service module should be structured (flat, function-based, `EntityNotFoundException` for 404s).

**`src/backend/app/product/models.py`**
- Confirms `ProductCategory(enum.StrEnum)` = `TOY, BOOK, GAME, CLOTHING, OTHER`, stored via `_enum_column` (plain VARCHAR, `native_enum=False`).
- Docstring explicitly states the standalone `app.category` module was removed in favor of this inline dictionary — **no `Category` DB entity exists today**.

**`src/backend/app/product/router.py` / `service.py`**
- Full CRUD for products (list/get/create/update/delete/resolve), gated only by generic `READ`/`EDIT` (no organizer/admin-only gating).
- Explicitly named by Pattern Mining as **the best backend CRUD template** if `Category` needs to become a real entity again (function-based service, `IntegrityError` → `BusinessConflictException` pattern for delete-with-references).

**`src/backend/app/auth/models.py`**
- `Permission(enum.StrEnum)`: `READ`, `EDIT`, `PLUGIN_MANAGEMENT` — the **only** permission values that exist anywhere. No `ADMIN` value. This is the file that must gain a new member (e.g. `ADMIN` or `CATEGORY_MANAGEMENT`) for the new admin role.

**`src/backend/app/core/authorization_matrix.py`**
- `AUTHORIZATION_MATRIX`: ordered `(methods, path-regex, requirement)` tuples, first-match-wins, `resolve_requirement(method, path)`. Plugin rows (20-22) are the exact pattern to copy for new admin routes. Tested directly by `test_authorization_matrix.py`.

**`src/backend/app/core/_auth/dependencies.py`**
- `require_any(*permission_names)` — the dependency factory used for all route-level gating. No new mechanism needed, just a new permission string.

**`src/frontend/src/pages/PluginListPage.tsx`, `PluginFormPage.tsx`, `PluginDetailPage.tsx`**
- Existing admin-shell (Chakra/AppShell) plugin screens. List has **no Edit/Delete actions**; form is a raw JSON `<Textarea>` (anti-pattern, flagged for replacement, not reuse).

**`src/frontend/src/pages/ProductListPage.tsx`, `ProductFormPage.tsx`**
- Explicitly identified as **the best frontend template**: complete list+create+edit+delete flow, `ConfirmDialog` before delete, `EmptyState`, multi-field form with validation, permission-gated `+ Add` button.

**`src/frontend/src/utils/productCategory.ts`**
- `PRODUCT_CATEGORIES`, `CATEGORY_LABELS`, `CATEGORY_COLORS` — the static map that stands in for a `Category` entity today. If categories stay a closed enum, the admin "Categories" screen is a read-only view over this file, not a CRUD screen.

**`src/frontend/src/router.tsx`**
- Flat route list inside `Layout()`; `products`/`plugins` routes live here (lines ~106-110). New admin routes are added here as siblings, before the `/:organizationSlug` catch-all.

**`src/frontend/src/auth/AuthGuard.tsx`**
- Binary `requireAuth` check only — **no role/permission-based gating exists in the frontend at all**. A new guard variant or continued ad-hoc component-level check (`permissions.includes(...)`) is needed for admin routes.

### Related Files

**`src/backend/app/organizations/slugs.py`**
- `RESERVED_SLUGS` frozenset already contains `"admin"` (pre-reserved, currently unused). Must be updated if any *other* new top-level route segment is introduced; docstring explicitly instructs updating this set when adding routes.

**`alembic/versions/0002_seed_dev_users.py`**
- Only mechanism that grants permissions today: hardcoded dev accounts (`admin`/`admin123` has `READ, EDIT, PLUGIN_MANAGEMENT`). No in-app permission-granting UI or endpoint exists anywhere.

**`alembic/versions/0006_product_category_enum.py`**
- The migration that removed the prior `Category` table/module in favor of the inline enum — relevant precedent/warning for anyone reintroducing a `Category` entity.

**`src/frontend/src/api/plugins.ts`, `src/frontend/src/api/products.ts`, `src/frontend/src/api/client.ts`**
- Thin `api.get/post/put/patch/delete` wrappers with `ApiError`. Templates for a hypothetical `api/categories.ts` if a real entity is introduced.

**`src/frontend/src/components/shared/ConfirmDialog.tsx`, `EmptyState.tsx`, `PrimaryButton.tsx`, `Icons.tsx`**
- Shared UI atoms used by `ProductListPage`; reusable for a new Category/admin screen.

**`src/frontend/src/components/layout/AppShell.tsx`, `Sidebar.tsx`**
- The shell/nav that admin pages mount inside. `Sidebar.tsx` already does inline `permissions.includes("PLUGIN_MANAGEMENT")` checks — the current de facto pattern for nav-item gating.

**`src/frontend/src/pages/panel/panelComponents.tsx`, `PanelDataContext.tsx`, `panelHelpers.ts`**
- The **mobile/Tailwind** consumer-facing "Panel" UI (GUEST/ORGANIZER). Confirmed by all four agents to be architecturally and visually separate from the admin shell — not a template to copy for this feature, though `PanelDataContext`'s URL-driven `View` pattern (`/panel/:view`) is a reasonable structural precedent if the admin section grows its own sub-views (`/admin/:view`).

**`src/backend/app/users/models.py`**
- `UserRoleType` (`USER`, `ORGANIZATOR`) — a separate, unrelated business/domain role concept (circle-organizing eligibility). Explicitly **not** the right place to add "admin"; flagged by two agents as a conflation risk to avoid.

**`.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/implementation/spec.md`**
- Contains the original full `/api/categories` REST CRUD spec from before the Java→Python migration, useful reference if `Category` is reintroduced.

---

## Current Functionality

### Plugin management (largely built)
- Backend: full CRUD-ish surface (create/upsert via manifest PUT, read list/detail, update via manifest PUT or enabled PATCH, delete), already gated by a dedicated `PLUGIN_MANAGEMENT` permission distinct from generic `READ`/`EDIT`.
- Frontend: list/detail/form pages exist under the AppShell admin layout, but the list has no Edit/Delete row actions (`deletePlugin()` is exported and unit-tested but never called from any UI — dead capability), and the form is a raw JSON textarea rather than structured fields.
- **Gap is almost entirely frontend UX + wiring a new admin permission**, not backend architecture.

### Category management (does not exist as an entity)
- `ProductCategory` is a closed `StrEnum` on the `Product` model, stored as a VARCHAR column. There is no `Category` table, no `CategoryResponse`, no category router/service.
- The category list is duplicated in three places: backend enum (`product/models.py`), frontend type union (`api/products.ts`), and frontend label/color maps (`utils/productCategory.ts`).
- This was a **deliberate prior removal** (migration `0006_product_category_enum.py`, explicit docstring). Reintroducing per-row CRUD requires a schema migration reversing that decision — this is a design decision to confirm with the user before scoping backend work, not an oversight.

### Authorization (no admin concept exists)
- Auth is JWT-based; `Principal` carries a `frozenset[str]` of `PERMISSION_*` authorities decoded from the `permissions`/`scopes` JWT claim.
- `require_any(*names)` dependency factory gates routes; `AUTHORIZATION_MATRIX` is a parallel first-match-wins documentation/test surface (`resolve_requirement`) that must be kept in sync with route-level `Depends(require_any(...))` calls.
- Only 3 permissions exist today: `READ`, `EDIT`, `PLUGIN_MANAGEMENT`. No `ADMIN`. No admin-granting UI/endpoint — permissions are only ever seeded via Alembic migration or manual SQL.
- Frontend has zero permission-based route gating — `AuthGuard` only checks authentication. Component-level checks (`permissions.includes("PLUGIN_MANAGEMENT")`) are the only precedent for "is this user allowed to see this."

### Key Components/Functions

- **`require_any(*permission_names)`** (`app/core/_auth/dependencies.py`): any-of permission check, 401 if unauthenticated, 403 if authenticated but lacking all listed permissions.
- **`resolve_requirement(method, path)`** (`app/core/authorization_matrix.py`): matrix lookup used by `test_authorization_matrix.py`; new admin routes need a new row here.
- **`PluginDescriptorService.upsert_manifest`**: create-or-refresh-but-preserve-`enabled` pattern — relevant if a similar "manifest re-upload shouldn't reset admin toggles" concern applies to categories.
- **`ConfirmDialog`**: reusable delete-confirmation component, already used by `ProductListPage`, should be reused for both plugin-delete (currently missing) and any category-delete UI.

### Data Flow

Backend: request → `require_any(...)` dependency (via JWT `Principal`) → router handler → function-based service → SQLAlchemy async session → Postgres. Frontend: page component → `api/<entity>.ts` wrapper (`api.get/post/put/patch/delete` in `api/client.ts`, attaches bearer token, throws `ApiError` on non-2xx) → backend router.

---

## Dependencies

### Imports (What This Depends On)

- `app/core/_auth/*` (principal decoding, `require_any`, token extraction) — used by every gated router, including plugin/product and any new admin router.
- `app/core/authorization_matrix.py` — read by `resolve_requirement`, tested independently.
- SQLAlchemy 2.0 async + `BaseEntity` mixin — required for any new `Category` entity if reintroduced (per `standards/backend/models.md`).
- Chakra UI (admin AppShell) vs Tailwind (Panel) — two disconnected frontend styling systems; admin work must stay in the Chakra/AppShell system.

### Consumers (What Depends On This)

- **`app/plugin/router.py`**: consumes `Permission.PLUGIN_MANAGEMENT` and `AUTHORIZATION_MATRIX` rows 20-22.
- **`app/product/router.py`**: consumes generic `READ`/`EDIT` only — no admin-specific gating yet, would need updating if category management moves into this module or a sibling module reusing its permission scheme.
- **`Sidebar.tsx`**, **`PluginListPage.tsx`**: consume `permissions.includes("PLUGIN_MANAGEMENT")` from the decoded JWT (client currently does **not** decode the JWT — `api/client.ts` only stores/attaches the raw token; permission-list access on the frontend happens some other way per-component, worth verifying exact source during implementation).
- **`router.tsx`** consumers: `Layout()`'s children array, `RESERVED_SLUGS` in `organizations/slugs.py` (must match top-level routes).

**Consumer Count**: Plugin permission touches ~4-5 files (router, matrix, seed migration, 2 frontend files). Category has zero current consumers since no entity exists — impact is scoped entirely to new code.

**Impact Scope**: Medium — most changes are additive (new permission, new routes, new pages) rather than modifications to widely-consumed shared code. The one genuinely high-impact decision is whether to resurrect the `Category` entity, which would touch a migration, a new backend module, and 3 places that currently duplicate the static category list on the frontend.

---

## Test Coverage

### Test Files

- **`src/backend/tests/test_authorization_matrix.py`**: pattern to follow for asserting new permission/matrix rows — plain `resolve_requirement(method, path) == (...)` assertions, no DB/client needed.
- **`src/frontend/src/test/PanelPage.test.tsx`**: covers `is_organizer`/role-gating behavior — closest existing pattern for testing admin nav-item gating, though it targets the unrelated `UserRoleType` system.

### Coverage Assessment

- **Test count**: No dedicated plugin tests (`test_plugin*.py` absent), no category tests (none exist to test), no `*Plugin*`/`*Product*` frontend test files.
- **Gaps**: Plugin router/service has zero backend test coverage today despite being feature-complete. Any new admin-permission work should add both a matrix-resolution test and basic router-level 401/403/200 coverage, since this is the one area with an existing lightweight test pattern to extend.
- Test gate: `uv run pytest` from `src/backend` (per project memory).

---

## Coding Patterns

### Naming Conventions

- **Permission constants**: `Depends(require_any("PERMISSION_NAME"))`, aliased as `ReadPrincipal`/`EditPrincipal`/`ManagementPrincipal` at router top.
- **API functions**: `get<Entities>()`, `get<Entity>(id)`, `create<Entity>(request)`, `update<Entity>(id, request)`, `delete<Entity>(id)`.
- **Request/response types**: `Create<Entity>Request` / `Update<Entity>Request` / `<Entity>Response` per API file.
- **Files**: one API client per entity (`api/<entity>.ts`), one list page + one form page + optional detail page per entity.

### Architecture Patterns

- **Backend style**: flat, function-based services for simple verticals (`plugin`, `product`) — explicitly the pattern to follow here, **not** the DDD-layered style used by `groups` (domain/application/infrastructure), which is called out by two agents as overkill for this feature.
- **Backend error handling**: `EntityNotFoundException` for 404s; delete operations wrap `IntegrityError` into a dedicated `BusinessConflictException` subclass (e.g. `ProductHasInventoryItemsException`) — the template for a hypothetical `CategoryHasProductsException`.
- **Frontend state**: no global state library; per-page hooks (`useProducts.ts`) and direct API calls; Panel uses URL-driven view state (`/panel/:view`) as a structural precedent, not to be copied verbatim into Chakra admin pages.
- **Authorization-as-code**: matrix-first convention — add the `AUTHORIZATION_MATRIX` row before/alongside the router's `require_any(...)` declaration.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| Files touched (plugin admin UI + permission) | ~6-8 files (Permission enum, matrix, seed/migration, router tweaks, 2-3 frontend pages, AuthGuard/Sidebar) | Medium |
| Files touched (category, if entity reintroduced) | ~10+ files (new migration, new `app/category/*` module, matrix rows, 3 frontend files deduped, new pages) | High |
| Dependencies | Auth core (`_auth/*`), SQLAlchemy `BaseEntity`, existing `product`/`plugin` modules as templates | Medium |
| Consumers | Sidebar, AuthGuard, router.tsx, RESERVED_SLUGS, matrix, seed migration | Medium |
| Test coverage | Near-zero for plugin; none possible yet for category | Low |

### Overall: Moderate to Complex (bimodal)

The plugin-admin-UI slice of this task is Moderate: an established, permission-gated backend already exists, and the work is adding one permission plus finishing the frontend CRUD screen using `ProductListPage` as a template. The category slice is potentially Complex, contingent entirely on a scope decision: a read-only admin view over the existing static enum is Simple; reintroducing a real `Category` entity (reversing migration `0006`) is Complex and touches schema, a new backend module, and three duplicated frontend sources of truth.

---

## Key Findings

### Strengths
- Plugin backend is essentially complete and already demonstrates the exact admin-permission pattern (`PLUGIN_MANAGEMENT`) needed for this task — strong, directly reusable precedent.
- `ProductListPage`/`ProductFormPage` provide a complete, working CRUD UI template (search/sort table, confirm-delete, empty state, validated form) that can be copied for both a fixed-up Plugin UI and a Category UI.
- Authorization is centralized and code-as-documentation (`AUTHORIZATION_MATRIX` + tested `resolve_requirement`), making it low-risk to add a new permission correctly.
- `"admin"` is already a reserved slug — no naming collision risk for a `/admin` route.

### Concerns
- No `ADMIN` permission or role concept exists anywhere; must be added to a closed enum (`app/auth/models.py`) and is a schema-adjacent change (new values persisted in `user_permissions.permission`).
- No admin-granting mechanism exists in-app — after adding a permission, there is still no way for an operator to grant it to a real user without manual SQL or a new migration. This is a genuine open gap the task may need to address (e.g. a minimal permission-grant endpoint) or explicitly defer.
- "Product categories" are not a manageable entity today; this was a deliberate architectural removal, not an oversight — assuming CRUD-over-categories without confirming scope risks reversing a considered decision.
- Frontend has no permission-based route/component gating infrastructure and doesn't decode the JWT permissions claim in a shared place — needs a small new mechanism (decode-once helper or context) rather than continuing to hand-roll `permissions.includes(...)` per component.
- Existing Plugin UI has real anti-patterns (raw JSON form, unreachable delete) that should be fixed, not extended, when building the admin panel.

### Opportunities
- Deduplicate the three copies of the category list (backend enum, frontend type union, frontend label/color map) regardless of whether a real entity is introduced — worth flagging as a follow-up standard.
- Reuse `ConfirmDialog`/`EmptyState`/`PrimaryButton` consistently across both Plugin and Category admin screens to keep the admin shell visually uniform.
- Add the first backend tests for the `plugin` module as part of this work, following `test_authorization_matrix.py`'s lightweight pattern — currently zero coverage despite being feature-complete.

---

## Impact Assessment

- **Primary changes**: `app/auth/models.py` (new `Permission` member), `app/core/authorization_matrix.py` (new matrix rows), `app/plugin/router.py` (reuse `ManagementPrincipal`, or add new admin-scoped principal), frontend `PluginListPage.tsx`/`PluginFormPage.tsx` (add Edit/Delete, replace JSON textarea with real fields), `router.tsx` + `AuthGuard.tsx`/`Sidebar.tsx` (new admin route + gating), a decision-dependent category slice (either a new `app/category/*` module + migration, or a read-only frontend view over `utils/productCategory.ts`).
- **Related changes**: `alembic/versions/` (seed migration or new migration for permission grant and/or category table), `organizations/slugs.py` only if a route segment other than the already-reserved `admin` is chosen.
- **Test updates**: new `test_plugin*.py` and matrix-row tests (backend), new frontend tests mirroring `PanelPage.test.tsx`'s gating pattern for admin nav visibility.

### Risk Level: Medium

Low risk for the plugin-admin slice (extending an existing, well-tested-pattern permission system onto an already-built backend). Risk rises to Medium-High specifically if category management is scoped as a full entity reintroduction, since that reverses a deliberate prior migration and touches schema plus three duplicated frontend sources of truth. Recommend resolving that scope question first, as it changes the size of this task substantially.

---

## Recommendations

**This is primarily "modifying/extending existing code" for plugins, and "creating new capability" (with a scope decision) for categories.**

1. **Resolve the category scope question with the user before backend work starts**: (a) admin view is read-only over the existing enum/label map (frontend-only, Simple), or (b) reintroduce a real `Category` entity with full CRUD (schema migration + new `app/category` module, Complex, reverses migration `0006`). This determines whether a "Categories" admin screen is a form for renaming existing labels/colors in `utils/productCategory.ts`, or a full list+CRUD page.

2. **Add the admin permission the same way `PLUGIN_MANAGEMENT` was added**: new `Permission` enum member (e.g. `ADMIN` or split `CATEGORY_MANAGEMENT`/reuse `PLUGIN_MANAGEMENT`), new `AUTHORIZATION_MATRIX` rows following rows 20-22 exactly, `require_any(...)` on the relevant router(s). Grant it via a new Alembic seed/data migration for now, consistent with how `PLUGIN_MANAGEMENT` was seeded for the dev `admin` account — flag the "no in-app grant mechanism" gap to the user as a known limitation rather than silently building a whole permission-management UI (out of scope unless requested).

3. **Fix, don't extend, the Plugin frontend anti-patterns while adding the admin gating**: replace the raw JSON `<Textarea>` form with structured fields, wire the already-exported-but-unused `deletePlugin()` into the list UI with `ConfirmDialog`, following `ProductListPage.tsx`/`ProductFormPage.tsx` structurally (table + search/sort, `+ Add` gated by permission, per-row Edit/Delete, `EmptyState`).

4. **Add frontend permission-awareness as a small shared utility** (e.g. a `usePermissions()` hook or JWT-decode helper in `api/client.ts` or a new `auth/` file) rather than continuing ad hoc `permissions.includes(...)` checks — this is currently inconsistent/scattered and worth consolidating once a second permission-gated screen is added.

5. **Testing**: add `test_plugin_router.py`/`test_plugin_service.py` (currently absent) and matrix-resolution tests for the new permission, following `test_authorization_matrix.py`. Add a frontend test for admin nav-item visibility following `PanelPage.test.tsx`'s gating-assertion style.

6. **Route wiring**: new routes as `Layout()` children in `router.tsx` alongside `products`/`plugins` (not a standalone route pair like `/panel`), since this belongs in the existing AppShell/Sidebar admin section, not a new phone-frame-style shell. `admin` slug is already reserved; no `RESERVED_SLUGS` change needed if the segment stays exactly `/admin`.

---

## Next Steps

Invoke the gap-analyzer to compare this current-state picture against the desired admin-panel behavior — in particular to pin down the category-scope decision (entity vs. enum-view) and the admin-permission-granting mechanism as explicit open questions before specification/planning proceeds.
