# Design Resources

## TL;DR
The app uses two visual languages, and the mockups bind to both:
- **Panel and site** (meetings, profile, term forms): Tailwind 4 with tokens from `src/frontend/src/app/globals.css`. The tokens are `ink`, `ink-soft`, `cream`, `paper`, `line`, `mint`, `mint-soft`, `lime`, `danger` and `focus-ring`; fonts are Figtree (sans) and Bricolage Grotesque (serif); cards use `rounded-2xl` / `rounded-[22px]`.
- **Admin** (categories, the new points config): Chakra UI 3 with slate hex colors (`#0F172A`, `#334155`, `#64748B`, `#E2E8F0`), white bordered cards with a 12px radius, and `PrimaryButton`.

## Standards (tier 1)
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/responsive.md
- .maister/docs/standards/global/validation.md: integer inputs use `type=text inputMode=numeric`, with an inline Polish `role=alert` error.

## Design system (tier 2)
- css-var/tailwind: `src/frontend/src/app/globals.css` (`--color-*`, `--font-*`).
- component-lib: `@chakra-ui/react` (admin), `components/shared/PrimaryButton`, `CategoryTreePicker`, `ModalSheet` and `ConfirmDeleteDialog`.
- icon-lib: `components/shared/Icons.tsx` (local).
- Screens to extend:
  - `features/admin/CategoryFormPage.tsx`
  - `features/meetings/TermAttendeesPage.tsx`
  - `features/terms/TermEditForm.tsx`
  - `features/profile-public/blocks/ProfileHero.tsx`

## Skill hints (tier 3)
- `artifact-design` and `dataviz` were seen; they are not needed for these mid-fidelity mockups.
