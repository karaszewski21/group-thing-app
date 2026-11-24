# Design Resources

## TL;DR
Mockups bind to the Tailwind 4 `@theme` tokens in `src/frontend/src/app/globals.css` (primary/mint #1b8168, accent/lime, cream, line, ink, paper) and to existing components: TermCard badges, SignUpFooter CTA classes, CapacityField/INPUT_CLASS, TermAttendeeRow. Fonts Figtree (sans) + Bricolage Grotesque (serif).

## Standards (binding)
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/responsive.md
- .maister/docs/standards/global/validation.md (text inputs + inline role=alert errors)

## Design system
- tailwind/css-var: src/frontend/src/app/globals.css `@theme static` tokens
- component: features/terms/components/TermCard.tsx (lime-soft "+N pkt" badge)
- component: components/shared/SignUpFooter.tsx (CTA_PRIMARY / CTA_OUTLINE, sticky footer)
- component: components/shared/appComponents.tsx (INPUT_CLASS, Field, CapacityField, ToggleRow)
- component: features/meetings/TermAttendeesPage.tsx (TermAttendeeRow checkbox + pill)
- external-link pattern: components/shared/TermPlaceLine.tsx (target=_blank, "(nowa karta)", ↗)

## Skill hints
- none used (artifact-design skill not applicable: mockups are local throwaway markup)
