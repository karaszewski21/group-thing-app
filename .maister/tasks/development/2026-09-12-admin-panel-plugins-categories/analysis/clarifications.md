# Phase 1 Clarifications

## Q1 — Scope of "category management"
**Decision**: Real CRUD. Reintroduce a `Category` entity (new Alembic migration + `app/category/` module mirroring `app/product`'s flat pattern), and re-point `Product.category` at it (FK instead of the closed `ProductCategory` StrEnum). This reverses migration `0006_product_category_enum.py`'s removal of the standalone `categories` table/module — the reversal is deliberate and confirmed by the user.

## Q2 — Admin permission model
**Decision**: A single new `Permission.ADMIN` value (in `app/auth/models.py`), granted via the existing `user_permissions` table. New/extended routes for category management (and optionally re-pointing plugin management) gate via `require_any("ADMIN")`. No new `UserRoleType`/business role is introduced — this stays purely on the auth-authority (`Permission`) axis, consistent with the codebase analysis finding that `UserRoleType` (USER/ORGANIZATOR) is an unrelated axis.

## Q3 — Where the admin panel lives in the UI
**Decision**: The existing desktop `AppShell`/`Sidebar` (Chakra UI) — the same shell that already hosts `/products` and `/plugins`. New admin screens (Categories list/form, and the gated Plugins section) are added as sibling routes inside `Layout()`'s children in `router.tsx`, not as a new mobile `/admin` + `/admin/:view` pair mirroring `/panel`.

## Q4 — Plugin-admin UI gaps (no Edit/Delete wiring, raw-JSON manifest textarea)
**Decision**: Out of scope for this task. Existing `PluginListPage`/`PluginFormPage`/`PluginDetailPage` UI stays as-is (including the raw-JSON manifest form and the currently-unwired `deletePlugin()`). This task only adds `ADMIN`-permission gating around plugin management access (nav visibility / route guard), it does not rebuild the plugin admin screens.

## Net effect on scope
This task now has two real deliverables:
1. **New `Category` entity + CRUD** (backend: migration, `app/category/` module, `AUTHORIZATION_MATRIX` rows, `require_any("ADMIN")`; frontend: `CategoryListPage`/`CategoryFormPage` under `AppShell`, following `ProductListPage`/`ProductFormPage` as the template) — reversing `Product.category`'s enum column back to a FK.
2. **New `ADMIN` permission** wired through the existing plugin-management routes/UI (gating only — no UI rebuild) and the new category routes/UI, plus a way for the frontend to know a user has `ADMIN` (decode JWT permissions claim client-side — no such mechanism exists today per codebase analysis) so nav items can be shown/hidden.
