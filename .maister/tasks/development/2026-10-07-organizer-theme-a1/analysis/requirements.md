# Requirements — A1 Motyw

## Initial description
Task A1 from research `2026-10-07-organizer-page-layouts-theming`: scoped organizer color theme on the term page, the new organizer product route and the public organizer page. No editor (A2), no DB migration.

## Q&A
### Phase 1
- Panel-page hardcoded colors → out of scope.
- Reserve both `produkt` and `grupa` slugs.
### Phase 2 (decision gate) — see `scope-clarifications.md`
- Theme dormant for organizers until A2 (accepted; verify with API-seeded colors).
- Legacy Tailwind tokens (mint, mint-soft, lime, lime-soft, sage…) keep today's static values; in-scope files switch to new role utilities.
- Backend: single `get_own_organization` read in the inline organizer block of `get_public_circle_view`, derive slug + theme.
- Item pages: layout route `/:organizationSlug/produkt` + `useItemRoutes()`; split ItemDetail/ItemEdit into frame + content.
- TS `organizer_theme: OrganizerTheme | null` required; link fallback `/product/:id` when slug null.
- Product page: neutral loader until org query settles; 404 / `k-…` / error → default palette.
- Frame: tokenized PhoneFrame without PanelNavBar.
- `palette_preset: null` included now.
- Accent-only org → default palette.
- Delete dead `.kg-stage`, `.kg-app`, `kg-modal-overlay`.
- Keep "Moje rzeczy →" link on edit page.
- Danger `#b23b3b`; remove KragStage global box-sizing; PublicOrganizationPage inline override replaced by OrganizerThemeScope.
### Phase 4
- Notification bell / account bar stay default green (ADR-014).
### Phase 5
- **User journey (confirmed):** guest/member opens a term page from the organizer's link → sees it in the organizer's colors; clicks an item → `/:slug/produkt/:id` (after login) in the same colors. Organizer does nothing in A1; colors set via `PATCH /api/organizations/{id}`.
- **Reuse (confirmed):** hook patterns `useMyOrganizationSlug`, `useItemDetail`; `getPublicOrganization`; `PhoneFrame`; ItemDetailPage/ItemEditPage content; backend test helpers `_register_organizer`, `_create_circle`, `_create_term` (test_public_term.py). **No new dependencies** — hand-written OKLCH/WCAG generator.
- **Visual assets:** only ASCII mockups (binding) in `analysis/design-context/`. Test colors: bordo `#7a2a4f` + 9 research seeds (default mint pair, red, yellow `#f1c40f`, blue, purple, black `#000000`, white `#ffffff`, pink `#ff69b4`, `#3fb68f`).

## Functional requirements summary
1. Role tokens in `index.css`: 13 themable (`primary, on-primary, primary-fg, primary-soft, focus-ring, accent, accent-soft, accent-fg, cream, stage, stage-wide, line, line-strong`) with corrected defaults; fixed tokens (`paper, ink, ink-soft, on-ink, teal, teal-soft, sage, sage-soft, danger, danger-soft, scrim`) via `@theme static`; legacy tokens unchanged.
2. `src/frontend/src/theme/orgPalette.ts`: OKLCH + WCAG generator `buildOrgThemeVars(primary, accent?)` producing all 13 vars, auto-correcting contrast; `DEFAULT_THEME_VARS`; `resolveOrgTheme(theme)`.
3. `OrganizerThemeScope` component setting all 13 vars inline on its element (no transform/filter/contain).
4. KragStage: no `:root`, no global `*` rule, `.kg-*` rules use `--color-*` role/fixed tokens, dead rules removed; all var() consumers migrated first.
5. Tokenize in-scope literal colors (term, gate, dialog, product, PhoneFrame, ItemTimeline, PublicOrganizationPage; PanelNav/panelIcons as used by item pages); "przynosi" = ink icon on teal; danger unified.
6. Backend: `OrganizerTheme` schema `{primary_color, accent_color, palette_preset}`; `PublicCircleResponse.organizer_theme: OrganizerTheme | None` on both PUBLIC and PRIVATE return sites; null when no Organization or primary_color null? (theme object returned with colors; frontend decides default) — spec to define; `RESERVED_SLUGS` += `produkt`, `grupa`.
7. Term page wraps view/gate in `OrganizerThemeScope(organizer_theme)`; item links → `/${organizer_slug}/produkt/${id}` (fallback `/product/${id}`).
8. Routes `/:organizationSlug/produkt/:id` and `/:organizationSlug/produkt/:id/edit`: AuthGuard, `usePublicOrganization(slug)`, neutral loader, `OrganizerThemeScope`, PhoneFrame without PanelNavBar; prefix-aware links/redirects/back fallback via `useItemRoutes()`.
9. `usePublicOrganization` TanStack hook (data-fetching standard); PublicOrganizationPage migrated and wrapped in scope; badge on accent-soft/accent-fg.

## Reusability opportunities
`useMyOrganizationSlug.ts`, `useItemDetail.ts`, `api/organizations.ts#getPublicOrganization`, `PhoneFrame`, `AuthGuard`, `src/test/queryClient.tsx#createQueryWrapper`, backend `organizations_acl.get_own_organization`, `_fallback_organizer_slug`, test helpers in `test_public_term.py`, `test_organizations.py` reserved-slug tests.

## Scope boundaries
In: above. Out: editor/color UI (A2), `page_layout`/`palette_preset` columns (A2), public organizer directory endpoint (B), content/media (C/D), panel-page colors, notification bell/account bar colors, dark mode, term page frame, backend notification links (`/product/:id` stays).

## Technical considerations
- Remove KragStage `:root` only after migrating consumers (GroupVisualization ×10, PrivateGroupGate, AccountMergeForm, RequestAccessDialog).
- Plain `@theme` only emits used vars; tokens read via var()/inline need `@theme static`.
- Derived vars must never be declared on `:root`; scope sets all 13 inline.
- jsdom can assert inline custom properties (`toHaveStyle`), not computed colors.
- Breaking tests to update: test_public_term.py:176-185; TermPage.test.tsx:40, 203-206; termAccess.test.ts:5; PublicOrganizationPage.test.tsx (query wrapper).
- TDD red tests: `src/frontend/src/test/themeDefects.test.tsx` must turn green.
- Manual check Firefox + Safari (runtime var override verified only in Chromium).
