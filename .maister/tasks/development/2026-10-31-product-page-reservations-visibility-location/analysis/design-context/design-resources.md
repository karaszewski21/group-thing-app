# Design Resources

## TL;DR
Tailwind v4 with `@theme static` tokens in `src/frontend/src/index.css` (on top of Chakra). Fonts: Bricolage Grotesque for headings, Figtree for body text. Mockups reuse the real tokens and components: `ItemCard`, `ParticipantItemsPreview`, `LocationPicker`, `TermPlaceLine`, `StatusPill`, `ItemContextActions` and the `EXCHANGE_MODE_TONE` chips.

## Standards (binding)
- .maister/docs/standards/frontend/components.md: discriminated view state via `resolve…View()`
- .maister/docs/standards/frontend/accessibility.md: text labels instead of colour alone, `aria-modal` sheets, stretched-link tiles
- .maister/docs/standards/frontend/responsive.md: mobile-first
- .maister/docs/standards/frontend/css.md: tokens, minimal custom CSS

## Design system
- **css-var**, `src/frontend/src/index.css`:
  - `--color-primary` #1b8168, `--color-primary-soft` #dcf5ec, `--color-primary-fg` #117b63
  - `--color-accent-soft` #eaf2ce, `--color-accent-fg` #56701f
  - `--color-cream` #f4f8f0, `--color-stage` #edf1ea, `--color-line` #e2eadf
  - `--color-paper` #fff, `--color-ink` #1e2e27, `--color-ink-soft` #5c7069
  - `--color-teal-soft` #d9ecec
  - `--color-danger` #b23b3b
- **theme**: `OrganizerThemeScope` overrides the 13 themable roles on organizer pages (`theme/orgPalette.ts`).
- **component-lib**: Chakra UI plus local `components/shared/*`:
  - `ModalSheet`, `LocationPicker`, `LocationAddForm`, `TermPlaceLine`, `MapPinIcon`, `PhotoPlaceholder`
  - `ParticipantItemsPreview`
  - `pages/organizer/blocks/ExchangeItemCard.ItemCard`
- **Mode tones** (`termLabels.ts` `EXCHANGE_MODE_TONE`): GIFT is `bg-primary-soft text-primary-fg`, SWAP is `bg-accent-soft text-accent-fg`.

## Skill hints
- No design MCP or skill matched; tier 3 was skipped.
