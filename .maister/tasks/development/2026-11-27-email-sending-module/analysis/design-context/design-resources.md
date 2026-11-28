# Design Resources

## TL;DR
The mockups bind to aj's real design language. They use the Tailwind 4 tokens in `src/frontend/src/app/globals.css` and the shared class constants (`authStyles.ts`, `uiStyles.ts`). They reuse the `appComponents.tsx` components `ListCard`, `HintCard`, `Switch`/`ToggleRow`, the `AuthLayout` card shell and the PhoneFrame panel layout. Icons are lucide-react. The fonts are Bricolage Grotesque for headings and Figtree for body text.

## Standards (binding)
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/responsive.md
- .maister/docs/standards/global/validation.md

## Design system
- **tailwind** `src/frontend/src/app/globals.css`:
  - Colours: `--color-primary #1b8168`, `--color-primary-soft #dcf5ec`, `--color-accent #a9c24f`, `--color-accent-soft #eaf2ce`, `--color-accent-fg #56701f`, `--color-cream #f4f8f0`, `--color-stage #edf1ea`, `--color-line #e2eadf`, `--color-paper #fff`, `--color-ink #1e2e27`, `--color-ink-soft #5c7069`, `--color-danger #b23b3b`, `--color-danger-soft #f6e4e2`, `--color-mint #1b8168`
  - Fonts: `--font-serif`, `--font-sans`
- **component-lib** `src/frontend/src/components/shared/appComponents.tsx`:
  - `ListCard`: rounded-3xl card with divide-y rows and a chevron
  - `HintCard`: bg-accent-soft nudge card with a CTA
  - `Switch`: role=switch, h-26 w-11, bg-mint/bg-line
  - `ToggleRow`: label, hint and switch
- **component-lib** `features/auth/AuthLayout.tsx`: cream card with a serif title, a subtitle and a dashed-circle ornament
- **component-lib** `features/auth/authStyles.ts`:
  - `AUTH_INPUT`: h-13, rounded-2xl
  - `AUTH_SUBMIT`: rounded-full bg-primary
  - `AUTH_LINK`
- **component-lib** `features/wanted/WantNotificationToggle.tsx`: a switch with optimistic update and revert
- **icon-lib**: lucide-react

## Skill hints
- none used (no design MCP connected)
