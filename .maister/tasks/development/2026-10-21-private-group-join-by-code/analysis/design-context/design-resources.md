# Design Resources

## TL;DR
The app uses Tailwind v4 with `@theme static` tokens in `src/frontend/src/index.css`. The role tokens are primary, cream, stage, line, paper, ink, danger and scrim; the panel also uses a legacy `mint` palette. Fonts are Bricolage Grotesque (serif headings) and Figtree.
Visitor screens use the krag kit: `KragStage`, `GroupHeader`, `kragStyles` (`CARD`, `BTN_PRIMARY`, `BTN_GHOST`, `FIELD`, `ERROR_TEXT`) and the krag `ModalSheet`. Organizer screens use `PhoneFrame`, `PanelNavBar`, the panel `ModalSheet` and the stepper's `primaryClass`/`secondaryClass`. Confirm dialogs use `ConfirmDeleteDialog`.
The mockups echo these classes and tokens by name.

## Standards (tier 1)
- .maister/docs/standards/frontend/css.md, components.md, accessibility.md, responsive.md, data-fetching.md
- .maister/docs/standards/global/validation.md (rules for numeric inputs)

## Design system (tier 2)
- css-var/tailwind: `src/frontend/src/index.css` — `--color-primary #1b8168`, `--color-primary-soft #dcf5ec`, `--color-cream #f4f8f0`, `--color-stage #edf1ea`, `--color-line #e2eadf`, `--color-ink #1e2e27`, `--color-ink-soft #5c7069`, `--color-danger #b23b3b`, `--color-danger-soft #f6e4e2`, `--color-accent-soft #eaf2ce`, `--color-mint #1b8168`, `--color-mint-soft #d8f0e6`, `--color-scrim`.
- theme: `src/frontend/src/theme/OrganizerThemeScope.tsx` overrides the role colors on public organizer pages.
- component-lib: `components/krag/kragStyles.ts`, `components/krag/ModalSheet.tsx`, `components/shared/ConfirmDeleteDialog.tsx`, `pages/panel/panelComponents.tsx` (`ModalSheet`, `CapacityField`), `components/shared/PhoneFrame.tsx`.
- icon-lib: local `pages/panel/panelIcons.tsx` (`CopyIcon`, `BackIcon`) and `CloseIcon`.

## Skill hints (tier 3)
- None applicable. Chakra exists only as legacy; no design MCP is connected.
