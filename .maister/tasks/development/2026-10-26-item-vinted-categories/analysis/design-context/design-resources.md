# Design Resources

## TL;DR
- User-facing screens use Tailwind v4 with `@theme` tokens in `src/frontend/src/index.css` (`--color-ink`, `ink-soft`, `paper`, `cream`, `line`, `mint`, `primary-soft`, `danger`, `danger-soft`, `scrim`); fonts are Bricolage Grotesque (headings, `font-serif`) and Figtree (body).
- Mobile screens sit in `PhoneFrame`; sheets use `components/shared/ModalSheet` (rounded-t-[24px], close button `bg-cream`).
- Admin pages use Chakra UI v3 (`Table`, `Button`, `PrimaryButton`) with the brand palette from `src/theme/index.ts`.
- Icons: lucide-react plus local `components/shared/appIcons`.

## Standards (binding)
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md (ModalSheet, trapFocus, combobox Esc rules)
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/responsive.md
- .maister/docs/standards/global/validation.md (inline Polish role="alert" errors)

## Design system
- css-var: src/frontend/src/index.css (@theme tokens)
- theme: src/frontend/src/theme/index.ts (Chakra brand/accent palettes)
- component-lib: @chakra-ui/react ^3.34 (admin), ModalSheet / PhoneFrame / PrimaryButton (shared)
- icon-lib: lucide-react ^1.7

## Skill hints
- maister:ascii-mockup-generator (fallback only)
