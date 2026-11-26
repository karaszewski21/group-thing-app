# Design Resources

## TL;DR
The mockups bind to aj's Tailwind 4 theme tokens in `src/frontend/src/app/globals.css` and to the existing auth components, reused by their real class strings. The fonts are Figtree (sans) and Bricolage Grotesque (serif headings). The frontend standards in `.maister/docs/standards/frontend/` apply, especially accessibility for `role="alert"` and focus.

## Tier 1 — Standards
- `.maister/docs/standards/frontend/components.md` — feature code in `src/features/auth/`, SSR-safe rendering, `ClientOnly` / `useClientValue`
- `.maister/docs/standards/frontend/accessibility.md` — modal sheets with a focus trap, `role="alert"` errors, `aria-*`
- `.maister/docs/standards/frontend/css.md`, `responsive.md` — Tailwind tokens, mobile-first, the `min-[520px]` breakpoint used by the auth shell

## Tier 2 — Codebase design system
- css-var: `src/frontend/src/app/globals.css`:
  - colors: `--color-primary` #1b8168, `--color-primary-soft`, `--color-primary-fg`, `--color-ink` #1e2e27, `--color-ink-soft`, `--color-line`, `--color-line-strong`, `--color-paper`, `--color-cream`, `--color-stage`, `--color-danger` #b23b3b, `--color-danger-soft`, `--color-focus-ring`, `--color-scrim`, `--color-accent`, `--color-teal`
  - fonts: `--font-sans` (Figtree), `--font-serif` (Bricolage Grotesque)
- component: `features/auth/AuthLayout.tsx`, the card shell with the dashed "circle" decoration and headings ("Witaj w kręgu" / "Dołącz do kręgu")
- component: `features/auth/AuthTabs.tsx`, the pill tablist "Zaloguj się" / "Załóż konto"
- component: `features/auth/SocialAuthButtons.tsx`. Its `BUTTON_CLASS` pill and the "lub emailem" divider are kept; the Facebook button is removed.
- component: `features/auth/authStyles.ts`: `AUTH_LABEL`, `AUTH_INPUT`, `AUTH_SUBMIT`, `AUTH_LINK`
- component: `LoginForm` / `RegisterForm`, with the alert `rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger` and the inline "Zaloguj się" switch
- component: `components/shared/ModalSheet.tsx`, a bottom sheet `rounded-t-[24px] bg-paper p-5 max-w-[430px]` with the serif title and the ✕ button

## Tier 3 — Skill hints
- `artifact-design` and `dataviz` skills are available but do not apply here (mockups go through the visual companion, not artifacts). No Figma or design MCP is connected.
