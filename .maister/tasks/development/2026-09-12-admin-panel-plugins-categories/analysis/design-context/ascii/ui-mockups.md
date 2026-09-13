# UI Mockups: Admin Panel — Plugins & Product Categories

**Generated**: 2026-09-12
**Task Path**: `.maister/tasks/development/2026-09-12-admin-panel-plugins-categories`
**Feature Type**: New Feature (Category CRUD screens) + Enhancement (Sidebar/Plugins nav gating)

## Overview

### UI Requirements
- `CategoryListPage` — new screen under the existing Chakra `AppShell`/`Sidebar`, listing the admin-editable `Category` dictionary (name, product-usage indicator, actions), `+ Add Category` gated on `ADMIN`.
- `CategoryFormPage` — new shared create/edit screen (`categories/new`, `categories/:id/edit`), single `name` field (required), optional `description`.
- `Sidebar.tsx` — new "Categories" nav item gated on `permissions.includes("ADMIN")`; existing "Plugins" nav item's gate changes from `PLUGIN_MANAGEMENT`-only to `PLUGIN_MANAGEMENT || ADMIN`.
- Delete-blocked state — 409 from `CategoryHasProductsException` surfaced verbatim to the user, not swallowed by a generic "Failed to..." fallback (per gap-analysis anti-pattern note about `ProductFormPage`/`ProductListPage`'s current generic catch blocks).

### Integration Strategy
**Decision**: Reuse `ProductListPage.tsx`/`ProductFormPage.tsx` as structural templates verbatim (same table layout, same `+ Add X` button placement/copy pattern, same `ConfirmDialog`/`EmptyState` usage, same breadcrumb+heading form header). Category screens mount as `Layout()` children in `router.tsx`, sibling to `products`/`plugins` — same `AppShell`/`Sidebar`, not a new shell.

**Rationale**: The admin Chakra shell already has one working, permission-gated CRUD pattern (`Products`). Categories are structurally simpler (2 fields vs. 6) but should look like a sibling screen, not a bespoke design. This maximizes discoverability (same visual language admins already learned on `/products`) and minimizes review surface (copy the pattern, don't invent one).

## Existing Layout Analysis

### Application Structure
Desktop admin shell = `AppShell` (`src/frontend/src/components/layout/AppShell.tsx`) wrapping a fixed-width dark `Sidebar` (`src/frontend/src/components/layout/Sidebar.tsx`, `w="220px"`, `bg="brand.900"`) + a content `Outlet`. Nav items (`NavItem`) are simple `Link`s with active-state highlighting; some are conditionally rendered based on `useAuth().permissions`. This shell is Chakra UI and text is in **English** ("Products", "Add Product", "Manage your product catalog") — distinct from the Tailwind, Polish-language mobile "Panel" surface (`src/frontend/src/pages/panel/`). Category *data* (the `name` values seeded into the new `categories` table) is Polish per `scope-clarifications.md` decision 5, but the admin screen's own chrome/labels follow the existing English admin-shell convention, matching `ProductListPage`/`ProductFormPage`.

**Key Components**:
- Layout: `src/frontend/src/components/layout/AppShell.tsx`, `src/frontend/src/components/layout/Sidebar.tsx`
- Routing: `src/frontend/src/router.tsx` (flat children array inside `Layout()`)
- List template: `src/frontend/src/pages/ProductListPage.tsx`
- Form template: `src/frontend/src/pages/ProductFormPage.tsx`
- Shared UI: `src/frontend/src/components/shared/ConfirmDialog.tsx`, `EmptyState.tsx`, `PrimaryButton.tsx`, `Icons.tsx`
- Auth: `src/frontend/src/auth/AuthContext.tsx` (`useAuth().permissions: string[]`, already JWT-decoded)

### Identified Patterns
- **List page**: heading + subtitle left, permission-gated `+ Add X` (`PrimaryButton asChild` wrapping a `Link`) right; search input + filter `<select>` row; table in a white bordered card (`border="1px solid" borderColor="#E2E8F0" borderRadius="12px"`); per-row `Edit`/`Delete` ghost buttons in an `Actions` column, gated the same as the add button; `ConfirmDialog` for delete confirmation; `EmptyState` when zero rows.
- **Form page**: breadcrumb (`Link` to list + `/` + current page label) above an `<h1>`; single white bordered card (`borderRadius="12px" p="32px"`) containing a `Grid` of labeled fields (required fields marked with a red `*`); inline error banner (`bg="#FEE2E2" color="#991B1B"`) above the footer; footer = `Cancel` (outline button, links back to list) + `PrimaryButton` submit, right-aligned, separated by a top border.
- **Error handling anti-pattern (to fix, not copy)**: both `ProductListPage`'s delete handler (swallows to hook-managed state) and `ProductFormPage`'s submit handler (`catch { setError("Failed to save product.") }`) discard the actual backend message. The Category screens must NOT copy the generic-string pattern for the delete-conflict case — the 409's `detail` message from `CategoryHasProductsException` must reach the user.
- **Nav gating**: `Sidebar.tsx` reads `useAuth().permissions` once, computes boolean flags (`hasPluginManagement`), and conditionally renders `NavItem`s — no dedicated permission-guard component exists yet, this inline-boolean style is the established convention.

## Mockups

### Mockup 1: Sidebar Nav — Before / After

**Context**: `src/frontend/src/components/layout/Sidebar.tsx`, rendered on every admin-shell page. <a id="sidebar-nav-before-after"></a>

```
BEFORE (current)                          AFTER (this task)
┌──────────────────────┐                  ┌──────────────────────┐
│ TomorrowCommerce      │                  │ TomorrowCommerce      │
│                        │                  │                        │
│ [Package] Products     │                  │ [Package] Products     │
│ [Leaf]    Carbon       │                  │ [Leaf]    Carbon       │
│           Footprint    │                  │           Footprint    │
│ [Users]   Krąg grupy   │                  │ [Users]   Krąg grupy   │
│                        │                  │ [Tag]     Categories   │◄─ NEW
│ ── if PLUGIN_MGMT ──   │                  │           (component:  │   permissions
│ [Plug]    Plugins      │                  │            sidebar-    │   .includes("ADMIN")
│ [...plugin menu items] │                  │            admin-nav)  │
└──────────────────────┘                  │                        │
                                            │ ── if PLUGIN_MGMT ──   │
                                            │    OR ADMIN ──────────│◄─ CHANGED gate
                                            │ [Plug]    Plugins      │
                                            │ [...plugin menu items] │
                                            └──────────────────────┘
```

**Integration Points**:
- New `NavItem to="/categories" label="Categories" icon={<TagIcon>}` inserted directly after "Krąg grupy" and before the `hasPluginManagement` block — keeps admin-only items grouped together at the bottom, same visual slot pattern as the existing conditional Plugins block.
- Gate: `const isAdmin = permissions.includes("ADMIN");` then `{isAdmin && <NavItem to="/categories" ... />}`.
- Existing Plugins gate changes from `{hasPluginManagement && ...}` to `{(hasPluginManagement || isAdmin) && ...}`, where `hasPluginManagement = permissions.includes("PLUGIN_MANAGEMENT")` (unchanged) — matches `scope-clarifications.md` decision 3 exactly.
- No new icon component exists yet for categories — `lucide-react`'s `Tag` (or `Tags`) is the natural choice; add `export const CategoriesIcon = Tag;` next to `ProductsIcon`/`PluginsIcon` in `Icons.tsx`, following the existing one-liner export pattern.

**Component Reuse**:
- `NavItem` (`src/frontend/src/components/layout/Sidebar.tsx`, local to the file) — reused as-is, no new nav component needed.
- `useAuth` (`src/frontend/src/auth/AuthContext.tsx`) — reused, no new permission-decoding mechanism (per gap-analysis correction: JWT decoding already exists).

---

### Mockup 2: CategoryListPage — Main View

**Context**: `/categories`, new route, rendered inside `AppShell`. Direct structural port of `ProductListPage.tsx` (list only, no search/filter row since categories are a small flat list — see Alternatives). <a id="category-list-page"></a>

```
┌──────────────┬───────────────────────────────────────────────────────────────────┐
│ TomorrowComm.│  Categories                                    [+ Add Category]   │◄─ NEW SCREEN
│              │  Manage the product category dictionary           (ADMIN only)    │
│ Products     │                                                                    │
│ Carbon Foot. │  ┌──────────────────────────────────────────────────────────────┐ │
│ Krąg grupy   │  │ NAME          │ PRODUCTS IN USE │              ACTIONS       │ │
│ ►Categories◄ │  ├──────────────────────────────────────────────────────────────┤ │
│ Plugins      │  │ Zabawka       │ 12               │        Edit    Delete     │ │
│              │  │ Książka       │ 4                │        Edit    Delete     │ │
│              │  │ Gra           │ 0                │        Edit    Delete     │ │
│              │  │ Ubranie       │ 7                │        Edit    Delete     │ │
│              │  │ Inne          │ 1                │        Edit    Delete     │ │
│              │  └──────────────────────────────────────────────────────────────┘ │
│              │  Showing 5 categories                                             │
└──────────────┴───────────────────────────────────────────────────────────────────┘

Route: src/frontend/src/router.tsx → { path: "categories", element: <CategoryListPage /> }
Page:  src/frontend/src/pages/CategoryListPage.tsx (NEW, mirrors ProductListPage.tsx)
```

**Integration Points**:
- ✅ Heading block (`<h1>` 24px/700 + 14px gray subtitle) — identical structure/typography to `ProductListPage.tsx` lines 88-96, English copy ("Categories" / "Manage the product category dictionary") to match the admin shell's existing language.
- ✅ `+ Add Category` uses `PrimaryButton asChild` wrapping `<Link to="/categories/new">`, gated `{isAdmin && (...)}` — same component, same placement (top-right, `Flex justify="space-between"`) as `ProductListPage`'s `+ Add Product`, but gated on `ADMIN` (not `EDIT`) per `scope-clarifications.md` decision 1/4.
- ✅ Table wrapped in the same white/bordered/rounded card (`border="1px solid" borderColor="#E2E8F0" borderRadius="12px"` — `ProductListPage.tsx` line 174).
- ✅ "Products in use" column surfaces the count backing the delete-block check — sourced from `GET /api/categories` response (`productCount` or similar field the backend adds), giving the admin an at-a-glance signal before they attempt delete (0 = safe to delete, N>0 = will 409).
- ✅ Edit/Delete actions column identical structure to `ProductListPage.tsx` lines 310-335 (ghost buttons, `Edit` neutral, `Delete` red `#DC2626`), gated on `isAdmin` instead of `canEdit`.
- ✅ `ConfirmDialog` reused for delete confirmation — see Mockup 4 for the blocked-delete variant.
- ✅ No search/category-filter row (unlike `ProductListPage`) — see Alternatives Considered.

**Component Reuse**:
- `PrimaryButton` (`src/frontend/src/components/shared/PrimaryButton.tsx`) for `+ Add Category`.
- `ConfirmDialog` (`src/frontend/src/components/shared/ConfirmDialog.tsx`) for delete confirmation.
- `EmptyState` (`src/frontend/src/components/shared/EmptyState.tsx`) for the zero-categories case (see Mockup 3).
- Chakra `Table.Root`/`Table.Header`/`Table.Row`/`Table.Cell` — same primitives as `ProductListPage.tsx`.
- New `useCategories()` hook (`src/frontend/src/hooks/useCategories.ts`, NEW — mirrors `useProducts.ts`) supplies `data`, `loading`, `error`, `remove`.
- New `api/categories.ts` (NEW — mirrors `api/products.ts`) for `getCategories`/`createCategory`/`updateCategory`/`deleteCategory`.

---

### Mockup 3: CategoryListPage — Empty State

**Context**: Zero categories exist (edge case; in practice the seed migration always creates 5, but the admin can delete down toward zero, and this state must still render correctly). <a id="category-list-empty-state"></a>

```
┌──────────────┬───────────────────────────────────────────────────────────────────┐
│ TomorrowComm.│  Categories                                    [+ Add Category]   │
│              │  Manage the product category dictionary                            │
│ Products     │                                                                    │
│ Carbon Foot. │                                                                    │
│ Krąg grupy   │                        No categories found                        │
│ ►Categories◄ │              Create your first category to get started.           │
│ Plugins      │                                                                    │
│              │                          [+ Add Category]                         │
│              │                                                                    │
└──────────────┴───────────────────────────────────────────────────────────────────┘
```

**Integration Points**:
- ✅ `EmptyState` component reused verbatim (`title`, `description`, `action` props), same as `ProductListPage.tsx` lines 162-172 — `action` only rendered when `isAdmin`.

---

### Mockup 4: CategoryFormPage — Create / Edit

**Context**: `/categories/new` and `/categories/:id/edit`, shared component (`isEdit = Boolean(id)`), direct structural port of `ProductFormPage.tsx` reduced to 2 fields. <a id="category-form-page"></a>

```
┌──────────────┬───────────────────────────────────────────────────────────────────┐
│ TomorrowComm.│  Categories / Edit Category                                       │
│              │  Edit Category                                                    │
│ Products     │  ┌──────────────────────────────────────────────────────────────┐ │
│ Carbon Foot. │  │  Name *                                                       │ │
│ Krąg grupy   │  │  ┌────────────────────────────────────────────────────────┐  │ │
│ ►Categories◄ │  │  │ Zabawka                                                │  │ │
│ Plugins      │  │  └────────────────────────────────────────────────────────┘  │ │
│              │  │                                                                │ │
│              │  │  Description                                                  │ │
│              │  │  ┌────────────────────────────────────────────────────────┐  │ │
│              │  │  │                                                        │  │ │
│              │  │  │                                                        │  │ │
│              │  │  └────────────────────────────────────────────────────────┘  │ │
│              │  │                                                                │ │
│              │  │  ──────────────────────────────────────────────────────────  │ │
│              │  │                                       [Cancel] [Save Category]│ │
│              │  └──────────────────────────────────────────────────────────────┘ │
└──────────────┴───────────────────────────────────────────────────────────────────┘

Route: src/frontend/src/router.tsx →
  { path: "categories/new", element: <CategoryFormPage /> }
  { path: "categories/:id/edit", element: <CategoryFormPage /> }
Page:  src/frontend/src/pages/CategoryFormPage.tsx (NEW, mirrors ProductFormPage.tsx)
```

**Integration Points**:
- ✅ Breadcrumb (`Categories / Edit Category` or `Categories / Add New Category`) — identical pattern to `ProductFormPage.tsx` lines 100-106.
- ✅ Single-column `Grid` (categories have only 2 fields vs. products' 6, so no `md: "1fr 1fr"` two-column need — a single `1fr` column is simpler and still visually consistent with the card/label/input styling).
- ✅ `name` field required, red `*` marker — same `labelStyle` object as `ProductFormPage.tsx` lines 20-26.
- ✅ `description` field optional `<Textarea>`, same as `ProductFormPage.tsx`'s description field.
- ✅ Footer: `Cancel` (outline, links to `/categories`) + `PrimaryButton type="submit"` labeled "Save Category" — same right-aligned, top-bordered footer as `ProductFormPage.tsx` lines 254-261.
- ⚠️ Error banner: **must not** reuse `ProductFormPage`'s generic `catch { setError("Failed to save product.") }` pattern. See Mockup 5 for the required behavior when the submit/delete error is a structured backend message (name conflict, etc.) vs. a network failure.

**Component Reuse**:
- `PrimaryButton` for the submit button.
- Same inline `labelStyle` convention (or promote to a shared constant if this is the second page to duplicate it — worth flagging as a small dedup opportunity, not required for this task).

---

### Mockup 5: Delete-Blocked State (409 `CategoryHasProductsException`)

**Context**: Admin clicks "Delete" on a category row where `productCount > 0` (e.g. "Zabawka", 12 products in use). `ConfirmDialog` opens as normal; on confirm, the backend returns 409 with a `detail` message from `CategoryHasProductsException`. <a id="category-delete-blocked"></a>

```
Step 1: Admin clicks Delete on "Zabawka" (12 products in use)
┌──────────────────────────────────────────────────────────────┐
│  Delete Category                                        [x]  │
│                                                                │
│  Are you sure you want to delete this category? This         │
│  action cannot be undone.                                     │
│                                                                │
│                                        [Cancel]   [Delete]    │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ POST DELETE /api/categories/{id} → 409
                              ▼
Step 2: Backend rejects — error surfaced INSIDE the dialog, not swallowed
┌──────────────────────────────────────────────────────────────┐
│  Delete Category                                        [x]  │
│                                                                │
│  Are you sure you want to delete this category? This         │
│  action cannot be undone.                                     │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Cannot delete "Zabawka": 12 product(s) still use      │    │◄─ NEW:
│  │ this category. Reassign or delete those products      │    │  verbatim
│  │ first.                                                 │    │  backend
│  └──────────────────────────────────────────────────────┘    │  `detail`
│                                                                │  message
│                                        [Cancel]   [Delete]    │  (bg #FEE2E2,
└──────────────────────────────────────────────────────────────┘  color #991B1B —
                                                                     same palette as
                                                                     ProductFormPage's
                                                                     error banner)
```

**Integration Details**:
1. `ConfirmDialog` (`src/frontend/src/components/shared/ConfirmDialog.tsx`) stays open on error instead of closing — needs a new optional `error?: string | null` prop rendered as a banner inside `DialogBody`, above the footer buttons (the component currently has no error-display slot; this is a small, additive change, not a rewrite).
2. `useCategories()`'s `remove(id)` must propagate the backend's actual `error.message` / parsed `detail` field (via `ApiError`, `src/frontend/src/api/client.ts`) up to `CategoryListPage`, which passes it into `ConfirmDialog`'s new `error` prop — **this is the anti-pattern fix**: do not catch-and-discard into a generic `"Failed to delete category."` string, the way `ProductFormPage.tsx` line 86-87 currently does for save failures.
3. Dialog remains open so the admin can read the message and click Cancel (no destructive retry-loop) — clicking Delete again is a no-op until the underlying product references are removed elsewhere.

**Component Reuse**:
- `ConfirmDialog` — extended (new `error` prop), not replaced.
- `ApiError` (`src/frontend/src/api/client.ts`) — existing type already carries the backend's response body; the gap is in *presentation* (not swallowing it), not in data availability.

## Reusable Components

### Layout
- **AppShell**: `src/frontend/src/components/layout/AppShell.tsx` — standard admin page wrapper (Sidebar + content Outlet). No changes needed.
- **Sidebar**: `src/frontend/src/components/layout/Sidebar.tsx` — gains one new `NavItem` + one changed gate condition (Mockup 1).

### UI Components
- **PrimaryButton**: `src/frontend/src/components/shared/PrimaryButton.tsx` — use for `+ Add Category` and form submit.
- **ConfirmDialog**: `src/frontend/src/components/shared/ConfirmDialog.tsx` — use for delete confirmation; needs a new `error` prop (additive change) to surface the 409 message per Mockup 5.
- **EmptyState**: `src/frontend/src/components/shared/EmptyState.tsx` — use for zero-categories state.
- **Chakra `Table.*` primitives** — use for the category list table, same as `ProductListPage.tsx`.

### Icons
- **Icon library**: `src/frontend/src/components/shared/Icons.tsx` (thin `lucide-react` re-export layer). Add `export const CategoriesIcon = Tag;` (or `Tags`) alongside `ProductsIcon`/`PluginsIcon` for the new Sidebar nav item.

### Data Layer (new, mirrors existing product/plugin pattern)
- **`api/categories.ts`** (NEW): `getCategories()`, `getCategory(id)`, `createCategory(request)`, `updateCategory(id, request)`, `deleteCategory(id)` — mirrors `src/frontend/src/api/products.ts`.
- **`hooks/useCategories.ts`** (NEW): mirrors `src/frontend/src/hooks/useProducts.ts`, exposes `{ data, loading, error, remove }`.

## Implementation Notes

### Consistency Checklist
- ✅ Same heading/subtitle typography and spacing as `ProductListPage.tsx` (`fontSize="24px" fontWeight="700" color="#0F172A"` heading, `fontSize="14px" color="#64748B"` subtitle).
- ✅ Same white/bordered/rounded card treatment (`border="1px solid" borderColor="#E2E8F0" borderRadius="12px"`) for both the list table and the form.
- ✅ Same `Edit`/`Delete` ghost-button color convention (`#334155` neutral, `#DC2626` destructive).
- ✅ Same breadcrumb pattern (`List / Current Page`) on the form page.
- ✅ Gating uses the existing `useAuth().permissions` array — no new permission infrastructure introduced (per gap-analysis correction).

### Accessibility Considerations
- Table `Edit`/`Delete` buttons need `aria-label={`Edit ${category.name}`}` / `aria-label={`Delete ${category.name}`}`, matching `ProductListPage.tsx`'s existing pattern (lines 319, 328).
- `ConfirmDialog`'s new error banner should be associated with the dialog via `aria-live="polite"` (or rendered inside the existing `role="alertdialog"` region, which already gets assistive-tech focus) so screen reader users hear the rejection reason without needing to re-navigate.
- Form `name`/`description` labels use real `<label htmlFor>` elements, matching `ProductFormPage.tsx`'s existing accessible-label convention (not placeholder-only labeling).

### Responsive Behavior
- Desktop: as mocked above — Sidebar fixed 220px + fluid content column.
- Mobile: `Sidebar` is already `display={{ base: "none", md: "block" }}` — it disappears below `md` breakpoint with no mobile nav replacement currently built for the admin shell (same as `/products` and `/plugins` today). This task does not change that; Category screens inherit whatever the existing admin-shell mobile behavior is (out of scope to fix here — pre-existing gap shared by all admin-shell pages).

## Alternatives Considered

### Option 1: Add search/filter row to CategoryListPage, mirroring ProductListPage exactly (Rejected)
**Why rejected**: With only 5 seed rows (growing slowly, admin-curated, not high-cardinality like products), a search box and column-sort controls are premature complexity for this screen's realistic data volume. `ProductListPage`'s search/filter/sort exists because product catalogs are large; categories are a small dictionary. Omit for now — trivial to add later using the exact same `Input` + `useState` debounce pattern if the list grows.

### Option 2: Surface the delete-conflict error as a page-level banner instead of inside ConfirmDialog (Considered)
**Why rejected**: Keeping the error inside the still-open `ConfirmDialog` keeps the failure and the action that caused it in the same visual context — the admin doesn't have to correlate a page-top banner with "which row did I just try to delete." Also avoids a state-management side channel (the dialog already owns the delete lifecycle via `deleteId`/`deleting`).

### Option 3: Reuse `ProductFormPage`'s two-column Grid for CategoryFormPage (Rejected)
**Why rejected**: Two fields (`name`, `description`) don't benefit from a `md: "1fr 1fr"` split the way six product fields do — a single column reads more naturally and avoids an awkward half-empty row. Card styling, spacing, and footer remain identical to preserve visual family resemblance.

---

*Generated by ui-mockup-generator subagent*
