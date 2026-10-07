# Codebase (backend) — storage options for layout + palette (with evidence)

Paths relative to `src/backend/`. See `codebase-backend-current-state.md` for the underlying citations.

## Constraints derived from the codebase

1. `organizations` already has `primary_color`/`accent_color` String(7) + DB CHECK hex (`app/organizations/models.py:77-89`, migration `0012:62-77`) and they are already in public + owner API (`schemas.py:13-52`). Any option must migrate/keep these without breaking `tests/test_organizations.py:90-168`.
2. Standard `standards/backend/models.md:9,48`: prefer plain columns/string-backed enums; JSONB for value collections / caller-defined shapes.
3. Enum precedent: `_enum_column(native_enum=False, values_callable=…)` string-backed enum + permanent `server_default` (`app/groups/models.py:70-112`, migration `0035`). Adding a value later = code-only change (no DB enum type to ALTER) — good for adding layouts.
4. No `MutableDict` anywhere → JSONB must be reassigned whole (`grep Mutable|flag_modified` → none).
5. No entitlement concept exists (§9 of current-state) — paid layouts need a new gate.
6. `BaseEntity.updated_at` doubles as `version_id_col` (optimistic locking, per INDEX/models standard) → concurrent editor saves already get `StaleDataError` handling (`tests/test_stale_data_error_handler.py`).

## Option A — flat columns on `organizations` (extend existing pattern)

```
organizations.page_layout  VARCHAR(20) NOT NULL server_default 'CLASSIC'   -- StrEnum OrganizationPageLayout (5 values)
organizations.primary_color / accent_color (existing)
(+ optional) organizations.color_mode VARCHAR(10) / background_color VARCHAR(7)
```
- Pros: identical to `layout_mode` (0035) and existing color columns; DB CHECKs; trivially queryable; one-step migration; Pydantic `Literal`/enum validation for free; matches the docstring decision "flat columns rather than a separate branding table" (`models.py:55-60`).
- Cons: every new palette token or per-layout setting = migration; a paid custom layout needing arbitrary settings won't fit; an enum can't represent "custom layout #123 owned by org X".
- Confidence it fits the MVP (5 presets + 2 seed colors): High.

## Option B — single `theme` JSONB on `organizations`

```
organizations.theme JSONB NULL  -- {"version":1,"layout":"CLASSIC","palette":{"primary":"#..","accent":"#..","mode":"light"},"blocks":{...}}
```
- Pros: schema evolves without migrations; carries `version` for forward migration of saved themes; can hold per-layout block settings (section order/visibility) and custom-layout refs.
- Cons: loses DB-level hex CHECK (must be enforced by a Pydantic `ThemeSettings` model on write — validate-on-write + parse-on-read with defaults); against the "own domain model → columns" guidance in `models.md:48`; requires data migration of existing two color columns.
- Precedents: `products.plugin_data`, `plugins.manifest` (`app/product/models.py:48`, `app/plugin/models.py:58`).

## Option C — hybrid (RECOMMENDED)

```
organizations.page_layout     VARCHAR(40) NOT NULL server_default 'CLASSIC'  -- layout key (preset id; later also custom keys)
organizations.primary_color   (keep)                                         -- palette seed, CHECK hex
organizations.accent_color    (keep)
organizations.theme_settings  JSONB NULL                                     -- optional, Pydantic-validated, versioned:
                                                                             --   {"v":1,"sections":{...},"color_mode":"light", ...}
```
- Layout key stored as a **string validated against an application-side registry** (not a DB enum and not a FK yet): a `LAYOUT_REGISTRY: dict[str, LayoutDefinition(id, tier="free"|"paid", version)]` in `app/organizations/` (or frontend-mirrored constant). Five free presets now; paid/custom layouts are just more registry entries (or later a `page_layouts` table with `owner_organization_id`, at which point `page_layout` becomes a key into it).
- Colors stay as columns → zero migration for existing data, existing tests stay green, DB CHECK retained, `PublicOrganizationResponse` only gains fields.
- JSONB only for genuinely open-ended per-layout settings (section toggles/order, hero text) — matches `models.md:9` "value collections" and lets custom layouts declare their own settings schema.
- Migration sketch (`0052_organization_page_layout.py`, mirroring 0035):
  ```python
  op.add_column("organizations", sa.Column("page_layout", sa.String(40), nullable=False, server_default="CLASSIC"))
  op.add_column("organizations", sa.Column("theme_settings", postgresql.JSONB(), nullable=True))
  ```
  Reversible `downgrade` drops both. Optional DB CHECK on `page_layout` is NOT recommended (would need a migration per new layout; registry validation in Pydantic/service is enough).

## Entitlement for paid layouts (no existing concept)

Minimal, future-proof options (none exist today — Confidence High):
1. `organization_entitlements(organization_id FK, feature_key VARCHAR, valid_from, valid_to)` — mirrors the Party/Role `valid_from/valid_to` shape used across `organization_roles`/`memberships` (`models.py:92-135`); service checks `layout.tier == "paid"` → requires active entitlement `layouts:<key>` or `layouts:premium`. Admin-granted until billing exists.
2. Downgrade behavior: on read, if the stored `page_layout` is not entitled/unknown → render fallback `CLASSIC` but **keep** the stored value (so re-subscribing restores it). Implement in a single resolver used by both public org and term responses.

## API shape recommendations (fit existing conventions)

- Extend `UpdateOrganizationRequest` (`schemas.py:44-52`) with `page_layout: str | None` + `theme_settings: ThemeSettings | None`, or add a dedicated `PATCH /api/organizations/{id}/theme` (covered by matrix row 50; ownership check reused from `service.update_organization:133-138`). Add explicit "reset colors" support (current PATCH can't null a color — `schemas.py:44-48`).
- Extend `PublicOrganizationResponse` (`schemas.py:26-37`) with `page_layout`, `theme_settings` (whitelisted public subset).
- Add a compact `OrganizerThemeResponse{slug?, primary_color, accent_color}` (or `theme: … | None`) to `PublicCircleResponse` (`app/groups/schemas.py:292`) populated via `organizations_acl` in `slug_resolver`/`public_view` — the Organization row is already loaded there (`slug_resolver.py:34`), so no extra query. `None` for fallback-slug organizers → default theme.
- Product page: no backend owner link (see current-state §7). Recommend frontend passes org context; if backend help is wanted, accept optional `?organization_slug=` on a lightweight public `GET /api/organizations/public/{slug}` (already exists) — i.e. no change to `/api/inventory-items/{id}/details`.
- `GET /api/organizations/layouts` (catalog with tier, free/paid flag, availability for caller) — READ via row 49.
- Optionally add `<meta name="theme-color">` + inline CSS vars in `app/system/public_preview.py:_inject` for no-flash first paint (colors are DB-CHECK-validated hex, safe to splice; still escape).

## Confidence summary

| Claim | Confidence |
|---|---|
| Colors already exist as validated columns, public + owner API | High (100%) |
| No layout/entitlement field exists on Organization | High |
| Term-page payload lacks colors; resolver already loads Organization | High |
| Product page has no derivable single organizer | High (90%) — derived from item/listing model docstrings |
| Hybrid C is best fit to standards + extensibility | Medium-High (80%) — design judgment |
