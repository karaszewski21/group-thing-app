# Design Resources

## TL;DR
Mockups bind to the app's Tailwind 4 tokens in `src/frontend/src/app/globals.css` (`--color-primary #1b8168`, `--color-paper`, `--color-ink`, `--color-ink-soft`, `--color-line`, `--color-line-strong`, `--color-cream`, `--color-primary-soft`, `--color-accent-soft`, `--color-danger`), fonts Bricolage Grotesque (`font-serif`, headings) + Figtree (`font-sans`), lucide-react icons, and the existing components SearchView, ItemCard/ItemTileBadges, GroupCard, DateTile, GroupFormFields/Field/INPUT_CLASS, AboutTab counter.

## Standards (tier 1, binding)
- `.maister/docs/standards/frontend/components.md`
- `.maister/docs/standards/frontend/accessibility.md`
- `.maister/docs/standards/frontend/css.md`
- `.maister/docs/standards/frontend/responsive.md`
- `.maister/docs/standards/global/validation.md` (inline Polish `role="alert"` errors, `aria-invalid`/`aria-describedby`)

## Design system (tier 2)
- tailwind / css-var: `src/frontend/src/app/globals.css` (`@theme` colour + font tokens)
- component-lib: local `src/frontend/src/components/shared/*` (ItemCard, ItemTileBadges, CategoryTreePicker, ModalSheet), `features/organization-public/blocks/GroupCard.tsx`, `DateTile.tsx`; Chakra UI 3 present but Tailwind panel pages avoid Chakra components
- icon-lib: `lucide-react` + local `components/shared/appIcons.tsx` / `Icons.tsx`

## Skill hints (tier 3)
- `artifact-design`, `dataviz` — not applicable (production-app mockups, not artifacts); no design MCP connected.
