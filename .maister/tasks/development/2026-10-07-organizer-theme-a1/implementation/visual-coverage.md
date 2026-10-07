# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (15 IDs). Mockup file: `analysis/design-context/ascii/ui-mockups.md`.

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| nav:product-entry-points | Group 5 (term-page item link + null-slug fallback), Group 7 (route tree, back fallbacks, `/product/:id` panel entries unchanged) | Covered |
| screen:term-page-themed | Group 3 (consumer tokenization: spokes, legend, toast, card, footer), Group 4 (KragStage `.kg-*` rules), Group 5 (scope wrapper on view branch) | Covered |
| screen:private-group-gate-themed | Group 3 (PrivateGroupGate, RequestAccessDialog scrim/sheet, AccountMergeForm danger, ModalSheet, AuthGateSheet), Group 4 (`.kg-status-line`, `.kg-error`), Group 5 (scope wrapper on gate branch) | Covered |
| screen:organizer-product-page | Group 7 (OrganizerItemLayout, ItemDetailBody, "Edytuj" path); Group 3 supplies tokenized PhoneFrame and AVAILABLE pill | Covered |
| screen:organizer-product-edit | Group 7 (ItemEditBody, viewPath x3, "Moje rzeczy" `text-primary-fg`); Group 3 supplies themed `PRIMARY_BTN` | Covered |
| state:organizer-product-loading | Group 7 (neutral loader, parallel prefetch, 404/error/`k-...` -> default, anonymous -> login returnTo) | Covered |
| screen:panel-product-page | Group 3 (PhoneFrame stage tokens, ItemTimeline pills, ItemGallery ring), Group 7 (`/product/:id` frame + PanelNavBar preserved, regression via ItemDetailPage.test) | Covered |
| screen:public-organization-page | Group 6 (usePublicOrganization, scope on success, unscoped loading/404, accent-only -> default) | Covered |
| component:organizer-theme-scope | Group 2 (OrganizerThemeScope + orgPalette) | Covered |
| component:item-routes | Group 7 (`useItemRoutes`; `base` deliberately not exported per spec) | Covered |
| component:organizer-item-layout | Group 7 (`OrganizerItemLayout.tsx`, mockup name `OrganizerItemPage`) | Covered |
| component:themed-primary-button | Group 3 (TermFooter, PRIMARY_BTN, ItemGalleryEditor), Group 4 (`.kg-btn-primary`) | Covered |
| component:exchange-markers | Group 3 (ExchangeLegend chips in GroupVisualization), Group 4 (`.kg-mark-shares` / `.kg-mark-brings`) | Covered |
| component:item-status-pill | Group 3 (ItemTimeline status pills + date chip) | Covered |
| component:org-badge | Group 6 (badge `bg-accent-soft text-accent-fg`) | Covered |

## Uncovered Items

All screens covered (15/15).

Documented deviations (covered, but intentionally differ from the mockup per spec):
- `screen:private-group-gate-themed`: `.kg-status-line` (and `.kg-eyebrow`) use `ink-soft` instead of the mockup's `[sage] FIXED`, because sage on cream is 3.70:1 and fails 4.5:1 (Group 4).
- `component:item-routes`: the mockup lists `base`; it is not exported (no caller; minimal-implementation) (Group 7).
- Name mapping: mockup `ItemDetailContent` / `ItemEditContent` / `OrganizerItemPage.tsx` are `ItemDetailBody` / `ItemEditBody` / `OrganizerItemLayout.tsx` (Group 7).
