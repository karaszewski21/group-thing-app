# Research Plan — Organizer page layouts & color theming

## 1. Research Overview

**Question**: How to design the public organizer page (`/:organizationSlug`) with 1-of-5 selectable layout presets and an organizer color palette that also recolors the term page (`/:slug/grupa/:groupId/term/:termId`) and product page (`/product/:id`) — which keep one fixed structure — with an easy editor in the organizer panel and an architecture ready for paid custom layouts.

**Type**: Mixed (technical + requirements + literature).

**In scope**: current public pages/components/data, theme mechanism, storage model (backend + migration + API), 5 layout presets, editor UX with live preview, paid-layout extensibility (registry, entitlements, versioning), accessibility (contrast, light/dark).
**Out of scope**: billing/payments implementation; structural changes to term/product pages.

### Pre-discovered facts (verified during planning — gatherers must deepen, not rediscover)
- `Organization` model already has `primary_color` / `accent_color` (`String(7)`, nullable) — `src/backend/app/organizations/models.py:77-78`, created in `alembic/versions/0012_organizations_schema.py`. Usage spreads to `PublicOrganizationPage.tsx`, `PublicTermView.tsx`, `GroupVisualization.tsx`, `api/organizations.ts`, `groups/application/public_view.py`.
- Groups already carry a `layout_mode` (`alembic/versions/0035_group_layout_mode.py`, `tests/test_group_layout_mode.py`) — a precedent for a "layout" enum; must be distinguished from the new organizer-page layout.
- Chakra UI **v3** (`@chakra-ui/react ^3.34.0`) — theming via `createSystem`/`defineConfig`, semantic tokens, CSS variables, `colorPalette` prop.
- Routing: `PublicLayout` wraps public routes; organizer page is a last-declared single-segment catch-all protected by `RESERVED_SLUGS` (`app/organizations/slugs.py`). `/product/:id` currently sits behind `AuthGuard`.
- JSONB already used in `product`, `plugin`, `moderation`, `outbox` models — precedent for a JSONB settings blob.

## 2. Sub-questions

| # | Sub-question | Maps to success criterion |
|---|---|---|
| SQ1 | Which components/pages/hooks/API endpoints render organizer, term and product pages today, and where do colors currently come from (hard-coded, theme, `primary_color`)? | 1 |
| SQ2 | How is organizer identity (slug → organization) resolved on term and product pages — is organizer context available there for theming? (product page has no slug in URL) | 1, 3 |
| SQ3 | Storage: extend existing columns vs new JSONB `page_settings`/`theme` (schema-versioned) vs separate `organization_page_theme` table? How to validate (Pydantic, hex allowlist, layout enum/registry key)? | 2 |
| SQ4 | Theming mechanism in Chakra v3: scoped CSS-variable override vs nested `ChakraProvider`/system vs `colorPalette` + semantic tokens; palette generation from 1–2 seed colors (50–950 scale); contrast-safe foreground selection; dark mode. | 3 |
| SQ5 | What content blocks exist for an organizer (groups, upcoming terms, description, logo/cover, stats, map, contact) and which 5 layouts make sense (e.g. "default", "table", "boisko" mockups in `ux-grup/`)? | 4 |
| SQ6 | Editor UX: curated preset palettes vs free picker vs seed+auto; live preview (same render component with draft settings), contrast warnings; where in the panel (`UstawieniaView`, `OrganizationPage`). | 5 |
| SQ7 | Paid custom layouts: layout registry (key → component + schema + tier), entitlement/feature-flag check (server-side), versioning of layout configs, graceful fallback when entitlement lapses. How do Shopify/Squarespace/Linktree/Luma/Calendly/Eventbrite do it? | 6 |
| SQ8 | Accessibility & performance: WCAG 4.5:1 enforcement, no flash of unthemed content (data in public payload vs separate fetch), cache keys per standards. | 3, 5 |

## 3. Methodology

- **Primary**: codebase analysis (frontend + backend) for current state; documentation/prior-task review for decisions already made; external research for theming mechanics and SaaS template/entitlement patterns.
- **Analysis framework**: component/flow mapping (technical); option matrix with trade-offs (storage, theming mechanism, editor UX); pattern comparison + applicability (SaaS benchmarks); gap analysis vs success criteria.
- **Fallbacks**: if Chakra v3 docs are ambiguous, read `node_modules/@chakra-ui/react` types locally; if SaaS pages are inaccessible, use help-center/docs pages or developer docs (Shopify theme docs).

## 4. Research Phases

1. **Broad discovery** — Glob/Grep for pages, theme, color fields, organizer endpoints, layout_mode, JSONB columns; list mockups and prior tasks.
2. **Targeted reading** — Read the key files in `sources.md`; extract data shapes (public organizer payload, term public view payload, item detail payload) and how color is applied.
3. **Deep dive** — Trace slug → organization → color on each of the 3 pages; trace panel settings save flow (`useMyOrganizationSlug`, `api/organizations.ts`, organizations router/service); research Chakra v3 scoped theming + palette generation; benchmark SaaS products.
4. **Verification** — Cross-check findings against tests (`PublicOrganizationPage.test.tsx`, `TermPage.test.tsx`, `test_organizations.py`, `test_group_layout_mode.py`); confirm every claim has a file:line or URL citation; list open questions.

## Gathering Strategy

### Instances: 5

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|---|---|---|---|
| 1 | codebase-frontend | Public organizer page, term page (TermPage/PublicTermView + krag components), product page (`pages/product/*`, `ItemDetailPage`), `PublicLayout`, Chakra v3 theme (`theme/index.ts`, `main.tsx` provider), router, panel settings (`UstawieniaView`, `OrganizationPage`, `PanelDataContext`), `api/organizations.ts` + hooks, where `primaryColor`/`accentColor` are consumed, hard-coded colors in public pages, existing tests | Glob, Grep, Read | codebase-frontend |
| 2 | codebase-backend | `organizations/` (model incl. `primary_color`/`accent_color`, schemas, service, router, `slugs.py`), `groups/domain/organizer_slug.py`, `groups/application/public_view.py`, `system/public_preview.py`, groups `layout_mode`, how item/product API exposes owning organizer, JSONB precedents (`product/models.py`, `plugin/models.py`), migrations 0012/0035, `auth_deps.py` AUTHORIZATION_MATRIX for organizer-settings write, related tests | Glob, Grep, Read | codebase-backend |
| 3 | docs-ux | `.maister/docs` (architecture, tech-stack, standards: frontend css/components/accessibility/data-fetching/responsive; backend models/migrations/api/security), prior tasks touching public pages/organizer/colors (`2026-09-08-per-term-public-pages`, `2026-09-20-wizualizacja-grupy` dev + product-design, `2026-09-02-party-archetype-organizer-group`, `2026-09-22-business-model-fit-recurring-groups`, `2026-09-23-termpage-*`, `2026-10-01-item-detail-page`), mockups `ux-grup/{boisko,default,table}.png` (view images, describe blocks/structure) | Read, Grep, Glob | docs-ux |
| 4 | external-theming | Chakra UI v3 theming (createSystem, semantic tokens, `colorPalette`, CSS vars, scoped/nested theme, `_dark`), design-token architecture (primitive → semantic → component), palette generation from seed color (OKLCH/HSL tonal scales; libs: `chroma-js`, `culori`, Material Color Utilities, Radix Colors approach), WCAG 2.x 4.5:1 / APCA contrast checks and auto on-color selection, FOUC avoidance for runtime themes | WebSearch, WebFetch | external-theming |
| 5 | external-saas | How Linktree, Calendly, Luma, Eventbrite, Shopify themes (OS 2.0 sections/blocks, theme settings_schema), Squarespace/Wix templates, Carrd, Beacons offer layout templates, color customization UX (presets vs pickers, live preview) and paid/premium themes (entitlement gating, downgrade behavior, versioning of themes) | WebSearch, WebFetch | external-saas |

### Rationale
The feature splits cleanly into frontend rendering/theming (largest code surface), backend storage/API (already partially present — colors exist), prior decisions and mockups (avoid contradicting earlier tasks; mockups likely seed the layout presets), and two distinct external bodies of knowledge: low-level theming mechanics vs product/business patterns for templates and paid tiers. Configuration is folded into the two codebase gatherers (package.json, alembic) since there is little standalone config.

## 5. Success Criteria

1. Map of every page/component/hook/endpoint touched, with file:line citations, including how organizer context reaches term and product pages (SQ1, SQ2).
2. Storage recommendation with option comparison (existing columns vs JSONB vs table), validation, versioning, migration sketch (SQ3).
3. Theming mechanism recommendation for Chakra v3 that recolors all 3 pages without forking them, incl. palette derivation and contrast guarantee (SQ4, SQ8).
4. Five concrete layout presets with their content blocks, grounded in available data and mockups (SQ5).
5. Editor UX recommendation with live-preview approach and placement in panel (SQ6).
6. Extension path for paid custom layouts: registry, entitlement check, fallback, versioning (SQ7).
7. All claims cited; open questions listed.

## 6. Expected Outputs

- `analysis/findings/<prefix>-*.md` from each gatherer
- Synthesized research report with recommendations, option matrices, and open questions for the subsequent product-design / development workflow
