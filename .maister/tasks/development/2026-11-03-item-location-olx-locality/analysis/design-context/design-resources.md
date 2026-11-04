# Design Resources

## TL;DR
Mockups bind to the app's Tailwind 4 tokens in `src/frontend/src/app/globals.css` (mint/primary #1b8168, cream, line, ink, ink-soft, danger, teal-soft), the LocationAddForm style consts (LOCATION_INPUT_CLASS, LOCATION_LABEL_CLASS, LOCATION_SAVE_BTN_CLASS, LOCATION_ERROR_CLASS) and existing components (LocationPicker, ItemQuickAddForm, NewPhotosField, PhotoGalleryField). Frontend standards (components, accessibility, css, responsive) are binding.

## Standards (tier 1)
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md (inline combobox pattern: aria-activedescendant, Esc closes listbox only; aria-disabled + describedby hint for blocked actions)
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/responsive.md
- .maister/docs/standards/global/validation.md (inline Polish role="alert" errors)

## Design system (tier 2)
- css-var: src/frontend/src/app/globals.css — --color-mint, --color-cream, --color-line, --color-line-strong, --color-paper, --color-ink, --color-ink-soft, --color-teal-soft, --color-danger, --color-danger-soft
- tailwind: Tailwind 4 via PostCSS (utility classes: rounded-[22px] border-line bg-paper cards, rounded-[9px] bg-mint buttons)
- component-lib: local src/frontend/src/components/shared/ (LocationPicker, LocationAddForm, ItemQuickAddForm, PhotoGalleryField); Chakra UI 3 in admin only

## Skill hints (tier 3)
- skill: artifact-design / dataviz (not used — mockups are throwaway HTML)
