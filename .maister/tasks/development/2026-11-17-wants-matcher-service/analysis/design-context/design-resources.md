# Design resources

## TL;DR
- Same design language as the previous wants task (`.maister/tasks/development/2026-11-15-szukam-wanted-mechanism/analysis/design-context/design-resources.md`): Tailwind 4 tokens in `src/frontend/src/app/globals.css` (`@theme static`), Bricolage Grotesque (`font-serif`) headings, Figtree body.
- Mockups reuse real components by name: `ItemCard` (via `MatchCard`), `WantMatchesView` header/empty state, `WantedListView` cards, `BellIcon`.
- Binding standards: frontend components, accessibility, responsive, CSS.
- No design skill, Figma file or Storybook is connected.

## Tier 1 — project standards (binding)
| Path | Topic |
|---|---|
| `.maister/docs/standards/frontend/components.md` | view-state pattern (`resolve…View`), thin routes |
| `.maister/docs/standards/frontend/accessibility.md` | headings, aria-live, focus |
| `.maister/docs/standards/frontend/responsive.md` | mobile-first |
| `.maister/docs/standards/frontend/css.md` | Tailwind tokens, minimal custom CSS |
| `.maister/docs/standards/frontend/data-fetching.md` | conditional `refetchInterval` polling |

## Tier 2 — codebase design system (binding)
| Kind | Path | Note |
|---|---|---|
| css-var | `src/frontend/src/app/globals.css:25-62` | `--color-primary #1b8168`, `primary-soft #dcf5ec`, `accent-soft #eaf2ce`, `accent-fg #56701f`, `cream #f4f8f0`, `line #e2eadf`, `line-strong #cbdac7`, `paper`, `ink #1e2e27`, `ink-soft #5c7069`, `teal-soft #d9ecec`, `danger` |
| component-lib | `src/frontend/src/components/shared/ItemCard.tsx` | tile: square thumb, name, Stan:, intent pill, reserved pill, `marker` ("nowe") |
| component-lib | `src/frontend/src/features/wanted/WantMatchesView.tsx` | header (‹ Szukam / Edytuj, serif h1, summary), dashed empty card with bell, ActiveActions |
| component-lib | `src/frontend/src/features/wanted/WantedListView.tsx` | want cards with match count and new pill |

## Tier 3 — skills / tools
| Kind | Name | Why |
|---|---|---|
| skill | artifact-design | generic page design guidance; not used for production components |
