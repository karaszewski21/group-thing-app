# Codebase (backend) — current state relevant to organizer layouts & theming

All paths relative to `src/backend/`. Confidence: High unless noted.

## 1. Organization model already stores two colors (flat columns)

**Source**: `app/organizations/models.py:54-89`
```python
class Organization(BaseEntity):
    __tablename__ = "organizations"
    party_id: Mapped[uuid.UUID] = ...           # FK parties.id
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    primary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    __table_args__ = (CheckConstraint("primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'", ...),
                      CheckConstraint("accent_color IS NULL OR accent_color ~ ...", ...))
```
- Docstring (`models.py:55-60`) states the deliberate decision: "simple flat columns rather than a separate branding table".
- Hex regex duplicated: model `_HEX_COLOR_PATTERN` (`models.py:28`), Pydantic `_HEX_COLOR_REGEX` (`schemas.py:10`), migration `0012` (`alembic/versions/0012_organizations_schema.py:34,70-77`).
- No layout field, no logo/cover/description/bio field on Organization. Only `name`, `slug`, two colors. (`grep logo|avatar|photo|description app/organizations/*.py` → no hits.)
- 1:1 owner -> Organization via `OrganizationRole(OWNER)` -> `OrganizationMembership` (`models.py:92-135`); `service.get_own_organization` (`service.py:77-94`).

## 2. Schemas & API

**Source**: `app/organizations/schemas.py:13-52`, `app/organizations/router.py:31-72`

| Endpoint | Auth | Schema | Notes |
|---|---|---|---|
| `GET /api/organizations/public/{slug}` | PUBLIC (matrix row 48) | `PublicOrganizationResponse{slug,name,primary_color,accent_color}` | `router.py:31-39` |
| `GET /api/organizations/mine` | READ | `OrganizationResponse` (+id, party_id, timestamps) | `router.py:42-48` |
| `POST /api/organizations/mine` | EDIT | create, idempotent | `router.py:51-61`, `service.py:97-127` |
| `PATCH /api/organizations/{organization_id}` | EDIT + owner check in service | `UpdateOrganizationRequest{name?, primary_color?, accent_color?}` | `router.py:64-72`, `service.py:130-149` |

- PATCH semantics: `None` = untouched; **colors cannot be cleared** (`schemas.py:44-48` docstring; `service.py:143-146`). A "reset to default palette" would need explicit-null handling (e.g. `model_fields_set`) — gap.
- Ownership enforced in service, not matrix (`service.py:133-138`, raises `AccessDeniedException`) — per `standards/backend/security.md`.
- Name passes text moderation `check_text(TextField.ORGANIZATION_NAME, ...)` (`service.py:140`); colors don't.
- Public response is intentionally narrow (`schemas.py:26-30`): anything added for theming (layout, palette) must be added explicitly here.

## 3. Authorization matrix rows for organizations

**Source**: `app/core/authorization_matrix.py:180-184`
```python
(_methods("GET"), r"^/api/organizations/public/[^/]+$", "PUBLIC"),  # 48
(_methods("GET"), r"^/api/organizations(/.*)?$", ("READ", "mcp:read")),  # 49
(_methods("POST", "PATCH"), r"^/api/organizations(/.*)?$", ("EDIT", "mcp:edit")),  # 50
```
- Any new sub-resource under `/api/organizations/...` (e.g. `PATCH /api/organizations/{id}/theme`, `GET /api/organizations/layouts`) is covered by rows 49/50 with no matrix change. A `PUT` method would NOT be covered by row 50 (only POST/PATCH) — use PATCH or extend row 50.
- New public reads must be declared ahead of row 49 (first-match-wins), like row 48. E.g. `GET /api/organizations/public/{slug}/circles` would NOT match row 48's `[^/]+$` → would fall to row 49 (READ) → needs a new PUBLIC row.
- Generic non-`/api/` GETs are PUBLIC (`authorization_matrix.py:56`) — covers SPA/preview pages.

## 4. Slugs and the public URL space

- `app/organizations/slugs.py:18-47` `RESERVED_SLUGS` — manually synced with frontend `router.tsx` top-level routes. Organizer page = catch-all `/:organizationSlug` (frontend `router.tsx:143`), term page `/:organizationSlug/grupa/:groupId/term/:termId` (`router.tsx:133`).
- Slug generated once at creation, never regenerated on rename (`models.py:62-66`, `service.py:36-48`).
- `app/groups/domain/organizer_slug.py:10-20` `_fallback_organizer_slug` → `"k-" + blake2s(...)` pseudo-slug when the organizer has **no Organization**. Such an organizer has no colors/layout to apply → term page must fall back to the default theme. Slug segment is "cosmetic": backend fetches by group_id/term_id and never validates it (`organizer_slug.py:16-18`).

## 5. Term page data path (where colors would need to arrive)

- `GET /api/groups/public/{group_id}?term_id=` → `get_public_circle_view` (`app/groups/router/circles.py:112-131`, `app/groups/application/public_view.py:166-289`).
- `PublicCircleResponse` (`app/groups/schemas.py:~291-303`): `id, name, organizer_display_name, organizer_slug, visibility, layout_mode, term, guardians` — **no colors / theme today**. (Contrary to the sources.md hint "public_view.py (uses colors)" — grep shows no color usage in `public_view.py`.) Confidence: High.
- Organizer slug resolution: `app/groups/infrastructure/slug_resolver.py:19-37` → active `Leadership` → organizer party → `organizations_acl.get_own_organization` (`app/groups/infrastructure/organizations_acl.py:18-19`) → `Organization.slug`. This already loads the full `Organization` row, so returning a `theme` alongside the slug is a zero-extra-query change if the resolver is widened (e.g. `resolve_organizer_branding -> (slug, theme|None)`).
- ACL boundary: `organizations_acl.py` is "the ONLY `app.groups` module that imports the organizations vertical" (`organizations_acl.py:1-4`). Theme data for term page should flow through it (return a DTO, not the ORM object, ideally).
- PRIVATE circles return a reduced response (`public_view.py:200-212`) — still includes `organizer_slug`; theme should also be included in the reduced branch (branding is not member data).
- Alternative (frontend-only): term page already has `organizer_slug` in the URL/response → could call `GET /api/organizations/public/{slug}` second. Fails for fallback `k-…` slugs (404) — acceptable as "default theme", but costs a 2nd request and a flash of default colors.

## 6. Group `layout_mode` — NOT the same concept (naming collision risk)

- `app/groups/models.py:70-80` `GroupLayoutMode(StrEnum){CIRCLE, PITCH, TABLE}` — "participant-visualization layout ... for their Circle's `/krag/{id}` screen". Per-**Circle**, not per-organizer page.
- Column `groups.layout_mode String(10) NOT NULL server_default 'CIRCLE'` (`models.py:108-112`), `_enum_column(native_enum=False, values_callable=...)` string-backed enum pattern.
- Migration `alembic/versions/0035_group_layout_mode.py:34-47`: single `add_column` with permanent `server_default="CIRCLE"`; docstring explains why no nullable→backfill→NOT NULL dance is needed for a fixed default.
- Update path: `UpdateGroupRequest.layout_mode: GroupLayoutMode | None` (`schemas.py:~70-80`), applied only `is not None` in `application/circles.py:149-176`, router `router/circles.py:262-271`.
- Exposed publicly in `PublicCircleResponse.layout_mode` (term page already switches visualization by it).
- Tests: `tests/test_group_layout_mode.py` (enum values, server default, request optional, response serializes).
- **Implication**: the new organizer-page layout should use a distinct name (`page_layout` / `theme.layout`), not `layout_mode`, to avoid confusion on the term page payload which already has `layout_mode`.

## 7. Product / item page — how it links to an organizer

- Frontend route `/product/:id` (`src/frontend/src/router.tsx:115`) — **no organizer slug in the URL**.
- Backend `GET /api/inventory-items/{item_id}/details` (`app/circulation/router.py:185-194`) — requires READ (authenticated; matrix row 40, `authorization_matrix.py:166`). Read model `ItemDetails` (`app/circulation/application/item_details.py:29-42`) and `ItemDetailsResponse` (`app/circulation/schemas.py:178-195`): product/category/photos/status — **no group, term or organizer field**.
- Ownership chain: `InventoryItem` → owner's inventory → user (`item_details.py:58-63`). An item belongs to a **user**, not an organizer.
- Item ↔ term link is indirect and many-to-many over time: `ItemListingPreference` (`app/groups/models.py:313-345`) is "not scoped to any Term"; term visibility is derived at read time from the owner's `TermAttendance` (`application/term_item_listings.py`). Reservations carry `term_id` (migration 0034) but only while in flight (`item_details.py:67-75`).
- **Conclusion** (High): there is no single "owning organizer" of a product page. Product-page theming must be driven by **navigation context** (e.g. `?org=<slug>` / route state when arriving from a term page, or a nested route `/:slug/.../product/:id`), or by an optional `organization_slug` query param the backend resolves. Deriving it server-side from the item would be ambiguous (owner may attend several organizers' circles).

## 8. Server-rendered public preview (link unfurling / first paint)

- `app/system/public_preview.py:30-61` injects OG/Twitter meta into `static/index.html` for `/:slug` and `/:slug/grupa/...` routes; `app/system/router.py:77-124`.
- Hook point: same injection could add `<meta name="theme-color" content="#rrggbb">` and/or an inline `<style>:root{--org-primary:...}</style>` to avoid a flash of default theme on organizer/term pages. Not done today. `render_public_circle_meta` takes `PublicCircleResponse` → would get theme for free if theme is added there.
- Tests: `tests/test_public_preview.py` (incl. HTML-escaping test `:133`) — any injected color must be validated hex (already guaranteed by DB CHECK) before splicing into `<style>`.

## 9. Plan / subscription / entitlement concept

- None exists. `grep -i "entitlement|subscription|premium|billing|tier"` over `app/` → no domain hits (only unrelated words in `core/security.py`, `plugin/models.py` docstrings). Confidence: High.
- Only gating primitives: user permissions in JWT (`READ`/`EDIT`/`ADMIN`, `mcp:*`), `UserRoleType.ORGANIZATOR`, and `PluginDescriptor.enabled` (`app/plugin/models.py:46-66`). A paid-layout entitlement would be net-new (e.g. `organization_entitlements` table or a `features` JSONB on Organization, set by admin until billing exists).

## 10. JSONB precedents

| Column | File | Nullability | Shape owner |
|---|---|---|---|
| `products.plugin_data` | `app/product/models.py:48` | nullable | plugin-defined |
| `plugins.manifest` | `app/plugin/models.py:58` | NOT NULL | plugin-defined |
| `plugin_objects.data` | `app/plugin/models.py:84` | NOT NULL | plugin-defined |
| `moderation_decisions.scores/thresholds` | `app/moderation/models.py:65-66` | nullable | model output |
| `outbox.payload` | `app/outbox/models.py:44` | NOT NULL | event payload |

- All use `sqlalchemy.dialects.postgresql.JSONB` with `Mapped[dict[str, Any]]`; none uses `MutableDict`/`flag_modified` (grep → no hits) → JSONB values are always reassigned whole, never mutated in place. A theme JSONB must follow that (assign new dict).
- Standard `.maister/docs/standards/backend/models.md:9,40,48`: prefer plain columns; JSONB for value collections or "genuinely schemaless plugin/manifest/breakdown data where the shape is caller-defined, not part of this system's own domain model". A palette defined by *our* domain is borderline: fixed small shape → columns; open-ended per-layout settings → JSONB with Pydantic-validated schema.

## 11. Related tests

- `tests/test_organizations.py` — create/slug/reserved/public-by-slug (`:90-107`, asserts `party_id` not exposed)/owner sets colors (`:149-168`)/non-owner rejected (`:171`).
- `tests/test_group_layout_mode.py:19-50` — enum + default + schema tests (template for a new `PageLayout` enum test).
- `tests/test_public_preview.py:96-133` — org preview + HTML escaping.
- `tests/test_authorization_matrix.py` — matrix rows (re-check if a new PUBLIC row is added).
- `tests/test_item_details.py` — item page read model (would change only if an org-theme field is added there).
