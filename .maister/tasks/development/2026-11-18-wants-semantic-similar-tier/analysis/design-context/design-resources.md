# Design Resources

## TL;DR
The mockups use the app's Tailwind 4 theme tokens from `src/frontend/src/app/globals.css`: `--color-primary #1b8168`, `ink`, `ink-soft`, `line`, `line-strong`, `paper`, `cream`, `accent-soft`, and the fonts Bricolage Grotesque (serif headings) and Figtree (sans). They reuse the existing `ItemCard` tile and the `SuggestionsSection` structure from `features/wanted/WantMatchesView.tsx`. The frontend standards (components, accessibility, responsive, css) are binding.

## Standards (tier 1)
- `.maister/docs/standards/frontend/components.md`: one view state and a `switch` on `view.kind`
- `.maister/docs/standards/frontend/accessibility.md`: a `<section aria-labelledby>`, an `aria-hidden` emoji, and 4.5:1 contrast
- `.maister/docs/standards/frontend/responsive.md`: mobile-first, `grid-cols-2 sm:grid-cols-3`
- `.maister/docs/standards/frontend/css.md`: Tailwind utilities and design tokens

## Design system (tier 2)
- tailwind / css-var: `src/frontend/src/app/globals.css`, `@theme static` color roles and font families
- component: `components/shared/ItemCard.tsx` (`dashed`, `footnote`, `reservedCaption`), `features/wanted/SuggestionCard.tsx`, `MatchCard.tsx`, and `WantMatchesView.tsx` (`SuggestionsSection`, `EmptyCard`, `ActiveActions`, `SkeletonGrid`)
- component-lib: Chakra UI 3 is present, but the wanted feature is Tailwind-only

## Skill hints (tier 3)
- None relevant. The artifact-design and dataviz skills cover a different domain.
