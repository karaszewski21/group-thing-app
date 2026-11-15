# Design resources

## TL;DR
- The app has its own design language: Tailwind 4 tokens in `src/frontend/src/app/globals.css` (`@theme static`), fonts Bricolage Grotesque (headings, `font-serif`) and Figtree (body), and shared components in `src/frontend/src/components/shared/`.
- Mockups reuse the real tokens and component shapes by name: `ItemCard`, `ModalSheet`, `ConfirmDeleteDialog`, `CategoryTreePicker`, `LocalityCombobox`, the search filter chips, the `/add` tiles, the bottom tab bar.
- Four frontend standards are binding: components, accessibility, responsive, CSS.
- No design skill, Figma file or Storybook is connected.

## Tier 1 — project standards (binding)
| Path | Topic |
|---|---|
| `.maister/docs/standards/frontend/components.md` | thin route files, view-state pattern, routing facade |
| `.maister/docs/standards/frontend/accessibility.md` | `aria-disabled` + hint for blocked submits, `ModalSheet`, `ConfirmDeleteDialog`, disclosure buttons |
| `.maister/docs/standards/frontend/responsive.md` | mobile-first, relative units |
| `.maister/docs/standards/frontend/css.md` | Tailwind tokens, minimal custom CSS |
| `.maister/docs/standards/global/validation.md` | inline Polish `role="alert"` errors |

## Tier 2 — codebase design system (binding)
| Kind | Path | Note |
|---|---|---|
| tailwind / css-var | `src/frontend/src/app/globals.css:25-62` | `--color-primary #1b8168`, `primary-fg`, `primary-soft`, `accent`, `accent-soft`, `accent-fg`, `cream`, `line`, `line-strong`, `paper`, `ink`, `ink-soft`, `teal-soft`, `danger`, `danger-soft`, `scrim`; `--font-serif` Bricolage Grotesque, `--font-sans` Figtree |
| component-lib | `src/frontend/src/components/shared/ItemCard.tsx` | item tile: square thumb, name, "Stan:", intent pill, reserved pill |
| component-lib | `src/frontend/src/components/shared/ModalSheet.tsx` | bottom sheet, rounded-top 24px, title row with ✕ |
| component-lib | `src/frontend/src/components/shared/ConfirmDeleteDialog.tsx` | Polish confirm dialog with `tone` |
| component-lib | `src/frontend/src/components/shared/CategoryTreePicker.tsx`, `LocalityCombobox.tsx` | pickers used by the want form |
| component-lib | `src/frontend/src/features/search/SearchFilters.tsx` | radius chips ("Tylko tu", "+10 km"), offer-mode chips, `aria-pressed` |
| component-lib | `src/frontend/src/features/add/AddView.tsx` | `/add` tiles (`rounded-[26px]`, `bg-teal-soft` for "Szukam rzeczy") |
| component-lib | `src/frontend/src/components/layout/BottomNav.tsx` | tab bar Start · Czat · + · Moje rzeczy · Konto |
| component-lib | `src/frontend/src/components/shared/NotificationBell.tsx` | bell rows: message + link |
| icon-lib | `src/frontend/src/components/shared/appIcons.tsx` | local icon set (`SearchIcon`, `BellIcon`, `TrashIcon`, …) |
| pattern | `src/frontend/src/features/search/WantedView.tsx`, `features/add/HuntingCreateView.tsx` | the mock being replaced: card `rounded-[22px] border-line`, primary pill buttons `rounded-full`, inputs `rounded-2xl h-12` |

## Tier 3 — skills, agents, MCP tools
| Kind | Name | Why |
|---|---|---|
| mcp-tool | `mcp__plugin_maister_playwright__browser_navigate` | opens the gallery |
| skill | `artifact-design`, `dataviz` | generic design guidance; not consulted, the project has its own language |

## Deliberate deviations
- Pill-shaped buttons and the light green page background are kept because the app uses them (`rounded-full`, `bg-cream`).
- Icons are drawn as simple glyphs in the mockups; the implementation uses `appIcons.tsx`.
