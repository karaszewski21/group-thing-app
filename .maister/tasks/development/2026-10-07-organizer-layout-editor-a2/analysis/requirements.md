# Requirements: A2 "Układ i edytor"

Date: 2026-10-08

## Initial description
Task A2 from research 2026-10-07-organizer-page-layouts-theming, building on A1 (committed 65e5068).
Migration 0052: organizations.page_layout VARCHAR(64) NOT NULL DEFAULT 'CLASSIC' + palette_preset VARCHAR(40) NULL; code allowlists (page_layouts.py with resolve_page_layout as single place, palettes.py), no DB enum/CHECK; PATCH /api/organizations/{id} with model_fields_set; extended public/owner responses; organizer_theme.palette_preset filled; DELETE matrix row (P3). Frontend: 8-12 palette presets + "Własny" with contrast correction shown; declarative layout registry + LayoutRenderer + blocks for CLASSIC and LINKS; EditorSheet inline on /:slug?edit=1; entries from AccountMenu and HomeView; TanStack hooks useMyOrganization, useUpdateOrganization; FE/BE key parity tests.

## Q&A (all rounds)
### Phase 1 (analysis/clarifications.md)
- Validation status: **400** + fieldErrors (global handler), not 422.
- `/organization` page unchanged (create + rename).

### Phase 2 (analysis/scope-clarifications.md)
- C-1 ghosts: non-interactive owner-only dashed placeholder, no CTA.
- C-2 composition: CLASSIC = hero(cover→color) · share · about(ghost, primary) · footer; LINKS = hero centered · link-stack(share only, primary) · about:short(ghost) · footer.
- I-1 parity test: vitest parses backend .py allowlists. (Backend stores only keys; FE owns visuals; drift risk low → 400 on save or graceful fallback.)
- I-2 `describeColorAdjustment(primary)` helper; `buildOrgThemeVars` unchanged.
- I-3 "Mięta (domyślna)" = nulls; no MINT key.
- I-4 unsaved guard: X + in-app nav (useBlocker, only on pathname change); Tailwind dialog inside theme scope; Anuluj resets draft, sheet stays open; no beforeunload.
- I-5 HomeView hint copy → "Wybierz układ i kolory swojej strony".
- I-6 trimmed registry types.
- I-7 `str_strip_whitespace` on UpdateOrganizationRequest.
- I-8 sheet opens after owner confirmed; ?edit=1 ignored otherwise; exported query keys; useMyOrganizationSlug wraps useMyOrganization.

### Phase 4 (design-context)
- No visitor empty-state card in A2 (HLD Example 3 over §6.1 rule); visitor sees hero, share, footer.
- Accepted: bottom-center bg-ink owner pill "Edytuj wygląd" (only when sheet closed); non-modal sheet copying ModalSheet classes (no scrim, no click-outside close, Esc closes only confirm), docked bottom on desktop; 2 mini preview cards (term, product) instead of toggle; "✓ Zapisano" + Polish error copy for 400/403/409/network; nav guard only on pathname change; "Polecany" always on LINKS in A2; shared share helper (navigator.share → clipboard + "Skopiowano link" toast).

### Phase 5
- **User journey:** only owner-organizer (1 org per owner, no collaborators). Entries: AccountMenu "Moja organizacja", HomeView hint, owner pill on own page. Palette applies on /:slug, TermPage, OrganizerItemLayout; layout only on /:slug. Confirmed.
- **Reuse:** A1 (orgPalette.ts, OrganizerThemeScope, usePublicOrganization), ModalSheet classes; backend patterns slugs.py (frozenset allowlist), 0050_user_profile_bio (add_column), 0035 (server_default rationale), families/schemas.py:107 extra="forbid". model_fields_set is the only new pattern (candidate for standards backend/api.md). Confirmed.
- **Visual assets:** ASCII mockups (analysis/design-context/) + HLD are binding; preset hex values chosen during implementation from HLD §5.2 names (Mięta(default), Ocean, Lawenda, Malina, Słońce, Las, Terakota, Grafit, Śliwka, Morze Północne + Własny) and must pass WCAG contrast tests. No external mockups.

## Functional requirements summary
Backend
1. Migration 0052 (`0052_organization_page_layout.py`): add `page_layout String(64) NOT NULL server_default 'CLASSIC'`, `palette_preset String(40) NULL`; reversible.
2. `app/organizations/page_layouts.py`: `PAGE_LAYOUT_KEYS = frozenset({"CLASSIC","LINKS"})`, `FALLBACK_PAGE_LAYOUT`, `resolve_page_layout(...)` single place for effective value.
3. `app/organizations/palettes.py`: `PALETTE_PRESET_KEYS = frozenset({...})` (no MINT).
4. `UpdateOrganizationRequest`: extra="forbid", str_strip_whitespace, page_layout/palette_preset fields with allowlist validation, explicit null rejected for name/page_layout (400); model_fields_set drives service: omitted = unchanged, explicit null clears colors/preset; check_text before any mutation.
5. Responses: OrganizationResponse (owner) has stored page_layout + palette_preset; PublicOrganizationResponse has effective page_layout (resolve_page_layout) + palette_preset — consistent at both construction sites (organizations router, system public preview).
6. organizations_acl.organizer_theme fills palette_preset; update OrganizerTheme docstring; update exact-dict tests.
7. Authorization matrix row 50: add DELETE + test.
8. Tests in test_organizations.py etc. (2-8 per feature group).

Frontend
1. api/organizations.ts types (+page_layout, palette_preset; update request allows null).
2. hooks useMyOrganization, useUpdateOrganization (invalidate publicOrganization + myOrganization prefixes; exported key constants); useMyOrganizationSlug wrapper.
3. theme/palettePresets.ts (10 presets), resolveOrgTheme preset > generator > default, OrganizerThemeScope accepts palette_preset, describeColorAdjustment.
4. Layout registry (trimmed types), definitions classic/links, LayoutRenderer (visitor vs owner modes, ghosts owner-only), blocks hero/share/about-ghost/link-stack/footer, shared share helper, static SVG thumbnails.
5. PublicOrganizationPage moved to pages/organizer/, owner pill, ?edit=1 handling, EditorSheet (tabs, LayoutTab, ColorsTab, CustomColorPicker, preview cards, save error, footer states), unsaved confirm + useBlocker.
6. AccountMenu + HomeView links to /${slug}?edit=1 (fallback /organization), HomeView copy.
7. Tests: parity, preset contrast, renderer/ghost invariants, editor flows, hooks, entry links; update fixtures broken by new fields; themeTokenUsage file lists.

## Reusability opportunities
See codebase-analysis.md §reuse and design-context ui-mockups.md "Reusable Components".

## Scope boundaries
In: CLASSIC + LINKS, layout + colors editor, PATCH semantics, matrix DELETE.
Out: SCHEDULE/CIRCLES/EXCHANGE layouts and directory endpoint (B), content tab/bio/links (C), media/logo (D), paid custom layouts (seam only), visitor empty-state card, beforeunload guard, changes to /organization page, PanelDataContext refactor beyond what's needed.

## Technical considerations
- Baselines: 17 FE tests failing pre-existing; mypy 4; eslint 18-19; backend 642/642 green.
- EditorSheet must render inside OrganizerThemeScope without portal/transform.
- Standards: data-fetching.md (hooks, keys, invalidation), minimal-implementation.md, backend migrations/security/models, frontend testing.
