# Codebase: Authorization Matrix, Admin/Moderation Precedent, Exposure Surfaces

Backend paths are under `src/backend/`. Frontend paths are under `src/frontend/src/`.

## 1. Authorization model

### F1.1 Permissions are a flat string enum. ADMIN exists.
**Source**: `app/auth/models.py:18-26`. `Permission` = `READ | EDIT | PLUGIN_MANAGEMENT | ADMIN`, stored as text in `user_permissions` (`:33-43`). There is no role hierarchy and no MODERATOR permission. **Confidence**: High.

### F1.2 The matrix is a code table. Enforcement is per-route `require_any(...)`.
**Source**: `app/core/authorization_matrix.py:1-8` (docstring), `:37-224` (`_RAW_MATRIX`, first match wins), `:232-244` (`resolve_requirement`). Routers declare `Depends(require_any(...))`, e.g. `app/product/router.py:37-38` (`ReadPrincipal`, `EditPrincipal`).
- **Doc drift**: `.maister/docs/standards/backend/security.md:27` says the matrix lives in `app/core/auth_deps.py` and has 25 entries. It actually lives in `app/core/authorization_matrix.py` and has about 60 rows. **Confidence**: High.

### F1.3 Product routes are already covered for photo mutations
- Row 11: `GET ^/api/products(/.*)?$` → READ/mcp:read (`authorization_matrix.py:57`).
- Row 17: `POST|PUT|PATCH|DELETE ^/api/products(/.*)?$` → EDIT/mcp:edit, with the comment "PATCH covers the shared description; the gallery uses POST/PUT/DELETE" (`:62-67`).
- **Implication**: new owner-facing routes such as `POST /api/products/{id}/photos/uploads` and `POST /api/products/{id}/photos/{pid}/complete` need **no new matrix row**. The owner check stays in the service (`_require_item_owner`). An **ADMIN-only** moderation route under `/api/products/...` would be swallowed by row 17 (EDIT) unless a more specific ADMIN row is inserted **before** it, which is the same technique as the groups moderation row (F2.1). A separate prefix (e.g. `/api/moderation/...`) would otherwise fall through to the catch-all `AUTHENTICATED` row (`:223`), which is too weak, so it needs explicit rows. **Confidence**: High.

### F1.4 `mcp:edit` (OAuth2/MCP clients) can mutate products and photos too
Rows 11 and 17 grant `mcp:read`/`mcp:edit` (`:57`, `:66`). MCP/OAuth2 clients can therefore add photos and descriptions, so moderation must hook the **service layer**, not the UI, to cover every entry point. This is also required by `standards/global/validation.md` "Consistent Enforcement" (`.maister/docs/standards/global/validation.md:27-28`). **Confidence**: High.

## 2. Existing moderation and admin precedent

### F2.1 `GET /api/groups/moderation` is ADMIN-only and read-only
- Matrix row: `(GET, ^/api/groups/moderation$, ("ADMIN",))`, declared ahead of the blanket `/api/groups` READ row (`authorization_matrix.py:116-119`).
- Route: `app/groups/router/circles.py:54` (`ModerationPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]`), `:247-255` (registered before `{group_id}` so the literal segment matches).
- Service/repository: `app/groups/application/circles.py:119-120`. `app/groups/infrastructure/repository.py:51-75` builds one aggregated query (LEFT JOIN/GROUP BY subqueries, no N+1).
- Schema: `ModerationGroupResponse {id, name, created_at, organizer_name, organizer_email, member_count, term_count}` (`app/groups/schemas.py:45-57`).
- Test: `tests/test_groups_moderation.py`.
- **Scope**: an overview list only. There are no approve/reject actions, no decisions table and no audit. **Confidence**: High.

### F2.2 Frontend admin moderation page (Chakra, legacy fetching style)
- `pages/ModerationPage.tsx:1-30`: Chakra `Table`, data via `useState` + `useEffect` calling `getGroupsForModeration()`, docstring "ADMIN-only, read-only overview … No destructive actions".
- Route `/admin/moderation` (`router.tsx:164`). Sidebar link shown when `permissions.includes("ADMIN")` (`components/layout/Sidebar.tsx:68`, `:94`).
- API: `api/groups.ts:33-35`, `:77-78`.
- **Implication**: a product/photo review queue has a natural home here (a tab or section on `/admin/moderation`). It should be written in the TanStack Query style required by `.maister/docs/standards/frontend/data-fetching.md` (hooks in `src/hooks/`, no `useState`+`useEffect` fetching). The existing page does not follow that standard. **Confidence**: High.

### F2.3 Other ADMIN-only precedents
- Categories: all mutations are ADMIN (`authorization_matrix.py:190-191`, `app/category/router.py:33` `AdminPrincipal`).
- Plugin management: `PLUGIN_MANAGEMENT` or `ADMIN` (`authorization_matrix.py:74-76`, `app/plugin/router.py:36`).
- **Confidence**: High.

### F2.4 There are no moderation state fields anywhere in the domain
A grep for `moderation` in `app/` finds only the groups overview and a reserved slug (`app/organizations/slugs.py:31`). No entity has a `status`/`moderation_status`/`approved` field for user content. **Confidence**: High (grep).

## 3. Where moderated content is exposed (which read paths a "hide until approved" rule must cover)

### F3.1 Photos: authenticated item details only
`app/circulation/application/item_details.py:53`, `schemas.py:191`. These are READ-gated (`/api/inventory-items/...` row 40, `authorization_matrix.py:163`). **Confidence**: High.

### F3.2 Shared description: item details
`item_details.py:97-99` (`get_shared_description(row.plugin_data, row.product_description)`). The ai-description plugin also reads `Product.description` through `GET /api/products/{id}` (see `codebase-plugin-ai-config-standards.md`). **Confidence**: High.

### F3.3 Product names: shown broadly, including PUBLIC unauthenticated pages
- `app/groups/application/public_view.py:164+` (`get_public_circle_view`) emits `product_name` at `:243` and `:257`. It is served by `GET /api/groups/public/{id}`, which is a PUBLIC matrix row (`authorization_matrix.py:86`).
- Also: term item listings (`app/groups/application/term_item_listings.py:153-171`, `:188-200`, `:310-321`, `:530`), pledges (`public_view.py:151`), and notification texts built from `product_name` (`app/notifications/outbox_listener.py:52-58`).
- Notification messages are **pre-rendered and stored** (`notifications/models.py:79`), so a toxic product name that has already been copied into a notification stays there after moderation.
- **Implication**: "hide until approved" for names would touch many read models. The alternatives are pre-moderation, which blocks product creation in `resolve` synchronously (a text classifier is fast), or a post-moderation "replace name with placeholder" approach. **Confidence**: High (paths) / Medium (completeness; there are 13 files referencing `product_name`/photos outside `app/product`, per grep).
