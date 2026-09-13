# Design Context Index

Source of visual references for the implementation-planner. All entries point into
`analysis/design-context/ascii/ui-mockups.md`.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| component:sidebar-admin-nav | component | analysis/design-context/ascii/ui-mockups.md#sidebar-nav-before-after | Sidebar before/after: new ADMIN-gated "Categories" NavItem, and Plugins NavItem's gate changed to `PLUGIN_MANAGEMENT \|\| ADMIN` |
| screen:category-list | screen | analysis/design-context/ascii/ui-mockups.md#category-list-page | CategoryListPage main view — table (name, products-in-use count, actions), `+ Add Category` gated on ADMIN, ported from ProductListPage |
| screen:category-list-empty | screen | analysis/design-context/ascii/ui-mockups.md#category-list-empty-state | CategoryListPage zero-rows state using shared EmptyState component |
| screen:category-form | screen | analysis/design-context/ascii/ui-mockups.md#category-form-page | CategoryFormPage shared create/edit screen (name + description fields), ported from ProductFormPage |
| component:category-delete-blocked | component | analysis/design-context/ascii/ui-mockups.md#category-delete-blocked | ConfirmDialog extended with an error slot to surface the 409 CategoryHasProductsException message verbatim (anti-pattern fix — do not swallow into a generic string) |

## Notes for implementation-planner

- All new/changed screens live inside the existing Chakra `AppShell`/`Sidebar` admin shell (`src/frontend/src/components/layout/AppShell.tsx`, `Sidebar.tsx`), not the Tailwind mobile Panel.
- `screen:category-list` and `screen:category-form` are structural ports of `src/frontend/src/pages/ProductListPage.tsx` and `ProductFormPage.tsx` respectively — implementers should diff against those files directly, not just the ASCII mockup.
- `component:category-delete-blocked` requires a small additive change to `src/frontend/src/components/shared/ConfirmDialog.tsx` (new optional `error` prop) — flagged explicitly because it's a cross-cutting fix that also should NOT regress `ProductListPage`'s existing delete flow.
- `component:sidebar-admin-nav` touches only `src/frontend/src/components/layout/Sidebar.tsx` (new NavItem + one changed boolean gate) and `src/frontend/src/components/shared/Icons.tsx` (new `CategoriesIcon` export).
