# Design Resources

## TL;DR
Mockups bind to the app's Tailwind 4 `@theme` tokens in `src/frontend/src/index.css` (primary #1b8168, primary-soft, accent/accent-soft, cream, paper, ink/ink-soft, line, teal-soft, danger) and fonts Bricolage Grotesque (serif headings) + Figtree (body). Components are reused by name: `EventAttendeeList`, `AttendeeList`, `ExchangeItemCard`, `NextTermCtaBlock`, `Avatar`, `PhotoPlaceholder`, `ModalSheet`, `SwapProposeDialog`, `AuthGateSheet`, `AskAboutItemButton`, and `uiStyles` (`CARD`, `BTN_PRIMARY`, `BTN_GHOST`, `PAGE_SHELL`).

## Standards (tier 1, binding)
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md
- .maister/docs/standards/frontend/responsive.md

## Design system (tier 2)
- tailwind / css-var: src/frontend/src/index.css (`@theme static` tokens; organizer-themable via OrganizerThemeScope)
- component-lib: src/frontend/src/components/shared/* (local), uiStyles.ts
- icon-lib: src/frontend/src/components/shared/Icons.tsx (local)

## Skill hints (tier 3)
- artifact-design / mockup-studio only; no design MCP connected.
