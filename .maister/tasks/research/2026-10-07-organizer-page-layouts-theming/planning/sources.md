# Research Sources

Paths relative to repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`. All local paths verified to exist at planning time.

## 1. codebase-frontend (`src/frontend/`)

### Key files
- `src/router.tsx` — public routes under `PublicLayout`; `/:organizationSlug` catch-all, `/:organizationSlug/grupa/:groupId/term/:termId`, `/product/:id` (AuthGuard)
- `src/components/layout/PublicLayout.tsx` — shared public shell (theme scope candidate)
- `src/theme/index.ts` — Chakra v3 system/theme
- `src/main.tsx` / `src/App.tsx` — provider setup (verify)
- `src/pages/PublicOrganizationPage.tsx` — public organizer page (consumes colors)
- `src/pages/OrganizationPage.tsx` — organizer's own org page ("Moja organizacja")
- `src/pages/krag/TermPage.tsx`, `src/pages/krag/PublicTermView.tsx` (consumes colors), `src/pages/krag/GroupVisualization.tsx` (consumes colors), `src/pages/krag/components/*` (GroupHeader, KragStage, TermCard, TermFooter, AttendeeList, NeededItemsSection)
- `src/pages/product/ItemDetailPage.tsx` + `ItemGallery.tsx`, `ItemReadOnlyParts.tsx`, `ItemTimeline.tsx`, `ItemBackButton.tsx`, `itemPageShared.ts` — product page
- `src/pages/panel/PanelPage.tsx`, `PanelNav.tsx`, `PanelDataContext.tsx`, `PanelModals.tsx`, `views/UstawieniaView.tsx`, `views/SpotkaniaView.tsx`, `views/ProfilView.tsx` — editor placement candidates
- `src/api/organizations.ts`, `src/api/groups.ts`, `src/api/items.ts`, `src/api/terms.ts`, `src/api/queryClient.ts`
- `src/hooks/useMyOrganizationSlug.ts`, `src/hooks/useItemDetail.ts`, `src/hooks/useTermAccess.ts`
- `package.json` — `@chakra-ui/react ^3.34.0`, color libs (check)

### Search terms
`primaryColor|accentColor|colorPalette|layoutMode|createSystem|defineConfig|semanticTokens|ChakraProvider|useColorMode|ColorModeProvider|#[0-9a-fA-F]{6}|brand\.`

### Tests
- `src/test/PublicOrganizationPage.test.tsx`, `PublicLayout.test.tsx`, `TermPage.test.tsx`, `ItemDetailPage.test.tsx`, `OrganizationPage.test.tsx`, `GroupVisualization.test.tsx`, `PanelPage.test.tsx`

## 2. codebase-backend (`src/backend/`)

### Key files
- `app/organizations/models.py` — `Organization` (`slug`, `primary_color`, `accent_color` lines ~75-78)
- `app/organizations/schemas.py`, `service.py`, `router.py`, `slugs.py` (`RESERVED_SLUGS`)
- `app/groups/domain/organizer_slug.py`
- `app/groups/application/public_view.py` (uses colors), `app/groups/application/circles.py`, `app/groups/router/circles.py`, `app/groups/models.py` (`layout_mode`), `app/groups/schemas.py`
- `app/system/public_preview.py`, `app/system/router.py`
- Product/item ownership → organizer: `app/product/models.py` (JSONB precedent), `app/circulation/`, `app/party/`
- JSONB precedents: `app/product/models.py`, `app/plugin/models.py`, `app/moderation/models.py`
- `app/core/auth_deps.py` — `AUTHORIZATION_MATRIX`
- `alembic/versions/0012_organizations_schema.py`, `0035_group_layout_mode.py`, latest `0051_profile_avatars.py`

### Search terms
`primary_color|accent_color|layout_mode|JSONB|organizer_slug|public_view|RESERVED_SLUGS|organization_id`

### Tests
- `tests/test_organizations.py`, `tests/test_group_layout_mode.py`, `tests/test_group_privacy.py`, `tests/test_item_details.py`

## 3. docs-ux

### Project docs & standards (`.maister/docs/`)
- `INDEX.md`, `project/architecture.md`, `project/tech-stack.md`
- `standards/frontend/css.md`, `components.md`, `accessibility.md`, `responsive.md`, `data-fetching.md`
- `standards/backend/models.md`, `migrations.md`, `api.md`, `security.md`, `queries.md`
- `standards/global/minimal-implementation.md`, `validation.md`

### Prior tasks (`.maister/tasks/`)
- `development/2026-09-08-per-term-public-pages`
- `development/2026-09-20-wizualizacja-grupy`, `product-design/2026-09-20-wizualizacja-grupy` (layout_mode origin)
- `development/2026-10-01-item-detail-page`
- `development/2026-09-10-panelpage-split`, `development/2026-09-09-guest-onboarding-family-panel`
- `research/2026-09-02-party-archetype-organizer-group`, `research/2026-09-22-business-model-fit-recurring-groups` (monetization context), `research/2026-09-23-termpage-state-machine`, `research/2026-09-23-termpage-private-access-request`

### Mockups
- `ux-grup/default.png`, `ux-grup/table.png`, `ux-grup/boisko.png` — view with Read; describe structure and blocks

## 4. external-theming
- Chakra UI v3 theming: https://chakra-ui.com/docs/theming/overview , /docs/theming/customization/colors , /docs/theming/semantic-tokens , /docs/styling/virtual-color (colorPalette), /docs/theming/customization/overview
- Panda CSS tokens / CSS vars (Chakra v3 engine): https://panda-css.com/docs/theming/tokens
- W3C Design Tokens Community Group format: https://www.designtokens.org/
- WCAG 2.2 contrast minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html ; APCA overview
- Palette generation: Material Color Utilities (HCT tonal palettes), Radix Colors scale design, OKLCH-based generation (culori, chroma-js docs), tints.dev / uicolors.app approach
- Runtime theming without FOUC (CSS custom properties on a scoped container, SSR-less SPA considerations)

## 5. external-saas
- Shopify Online Store 2.0: themes, sections/blocks, `settings_schema.json`, theme color schemes, paid theme store — https://shopify.dev/docs/storefronts/themes
- Squarespace templates & site styles / color themes; Wix templates
- Linktree themes/appearance (free vs Pro themes, custom colors gating)
- Luma calendar/event page themes; Calendly branding (paid-tier gating); Eventbrite organizer profile/branding
- Carrd / Beacons templates and pro-tier gating
- Search terms: "premium theme entitlement downgrade fallback", "theme presets vs custom color picker UX", "live preview theme editor"

## Configuration
- `src/frontend/package.json`, `src/frontend/vite.config.*`, `src/backend/pyproject.toml`, `src/backend/alembic.ini` — dependencies and migration setup
