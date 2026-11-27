# Design Resources

## TL;DR
These mockups reuse the design language found for stage 1 of the points work (`2026-11-19-points-reputation-system/analysis/design-context/design-resources.md`):
- **Panel and site screens:** Tailwind 4 tokens from `src/frontend/src/app/globals.css` (`ink`, `ink-soft`, `cream`, `paper`, `line`, `mint`, `lime`, `danger`), Figtree / Bricolage Grotesque, `rounded-2xl` cards.
- **Admin screens:** Chakra UI 3 with slate colors.

## Standards (tier 1)
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md (picker sheets, `aria-disabled` plus a hint, `ModalSheet`)
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/responsive.md
- .maister/docs/standards/global/validation.md (integers as `type=text inputMode=numeric`, inline Polish `role=alert`)

## Design system (tier 2)
- css-var/tailwind: `src/frontend/src/app/globals.css`
- components:
  - `components/shared/ItemCard.tsx` (`OFFER_BADGE`)
  - `components/shared/ItemPointsPreview.tsx`
  - `components/shared/ModalSheet`
  - `features/product/ChooseContextSheet.tsx` / `PersonalPickupSheet.tsx`
  - `features/admin/PointsConfigPage.tsx`
  - `features/search/SearchFilters.tsx`
- icon-lib: `components/shared/Icons.tsx`

## Skill hints (tier 3)
- `artifact-design` and `dataviz` were seen; they are not needed for these mid-fidelity mockups.
