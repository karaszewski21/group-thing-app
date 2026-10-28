# Design Resources

## TL;DR
Mockups bind to the host Tailwind v4 tokens in `src/frontend/src/index.css` (`--color-primary #1b8168`, `--color-cream`, `--color-ink`, `--color-line`, `--color-danger`, Figtree / Bricolage Grotesque) and the existing `EventCreateView` form classes (h-12 rounded-2xl inputs, rounded-full primary button). The plugin's own CSS must mirror these tokens.

## Standards (binding)
- `.maister/docs/standards/frontend/accessibility.md` — labels, `role="alert"`, `aria-invalid`/`aria-describedby`, picker sheets, focus
- `.maister/docs/standards/frontend/components.md`, `css.md`, `responsive.md` (mobile-first)
- `.maister/docs/standards/global/validation.md` — inline Polish errors, submit blocked while invalid

## Design system
- css-var: `src/frontend/src/index.css` `@theme static` tokens (primary, primary-soft, cream, paper, ink, ink-soft, line, line-strong, danger, danger-soft, accent-soft, focus-ring; fonts --font-sans Figtree, --font-serif Bricolage Grotesque)
- component: `SubPageHeader` (`components/shared/appComponents.tsx:338`) — round back button + serif 26px title
- component: `uiStyles.ts` BTN_PRIMARY / BTN_GHOST / CARD / ERROR_TEXT
- pattern: `pages/add/EventCreateView.tsx` LABEL / INPUT classes and confirmation card (`rounded-[28px] bg-primary-soft`)
- component: `components/shared/LocationAddForm.tsx` / location picker sheets (host-side; the plugin re-implements a simple picker)

## Skill hints
- none used (no design MCP connected)
