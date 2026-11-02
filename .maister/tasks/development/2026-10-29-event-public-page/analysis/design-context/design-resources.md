# Design Resources

## TL;DR
Mockups bind to the Term page design language: Tailwind v4 `@theme` tokens in `src/frontend/src/index.css` (primary #1b8168, cream, paper, ink, line, accent-soft; fonts Bricolage Grotesque serif / Figtree sans) and shared classes in `components/shared/uiStyles.ts` (PAGE_SHELL, CARD, BTN_PRIMARY, BTN_GHOST, FIELD, SUB_FORM). Components echoed: GroupHeader, TermCard (date badge), AttendeeList, TermFooter, ChatRow CHAT_BUTTON, ModalSheet, AuthGateSheet.

## Standards (tier 1)
- .maister/docs/standards/frontend/css.md
- .maister/docs/standards/frontend/components.md
- .maister/docs/standards/frontend/accessibility.md
- .maister/docs/standards/frontend/responsive.md

## Design system (tier 2)
- tailwind/css-var: src/frontend/src/index.css `@theme static` tokens
- component-lib: src/frontend/src/components/shared/uiStyles.ts, components/shared/{ModalSheet,Avatar,TermPlaceLine,AddToCalendarButton,ToastPill}
- term components: src/frontend/src/pages/term/components/{GroupHeader,TermCard,AttendeeList,TermFooter}.tsx; ChatRow in views/PublicTermView.tsx
- theme: src/frontend/src/theme/OrganizerThemeScope.tsx (organizer palette override)

## Skill hints (tier 3)
- skill: artifact-design — not applicable (production app mockups); none consulted
