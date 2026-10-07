# Frontend: how colors are applied today

Paths relative to `src/frontend/src/`.

## Key finding: the three target pages do not use Chakra at all

`@chakra-ui/react` is imported only by `main.tsx`, `theme/index.ts`, admin pages (`AdminGroupsPage`, `ProductListPage`, `Plugin*`, `Category*`, `PhotoModerationPage`, `OAuth2AuthorizePage`...) and admin layout/shared components (`AppShell`, `Header`, `Sidebar`, `MobileDrawer`, `AdminTable`, `ConfirmDialog`, `EmptyState`, `Pagination`, `PrimaryButton`). Verified via grep for `@chakra-ui/react` imports. **None** of PublicOrganizationPage, krag/*, product/*, panel/* use Chakra. (Confidence: High.)

Consequence: Chakra v3 `createSystem`/semantic tokens/`colorPalette` would recolor only the admin. The theming mechanism for organizer/term/product pages must work on **CSS custom properties** consumed by Tailwind v4 utilities and the KragStage stylesheet. Chakra's `brand`/`accent` tokens in `theme/index.ts:20-103` are a 1:1 copy of the Tailwind palette ("ported 1:1 from the Tailwind palette in index.css", `theme/index.ts:21-22`) and are irrelevant to the public pages.

## Two parallel CSS-variable systems

### A. Tailwind v4 `@theme` tokens — `index.css:22-42`
`--color-cream #f4f8f0, --color-paper #fff, --color-ink #1e2e27, --color-ink-soft #5c7069, --color-mint #1b8168, --color-mint-bright #3fb68f, --color-mint-soft #d8f0e6, --color-sage(-soft), --color-teal(-soft), --color-lime #a9c24f, --color-lime-soft #eaf2ce, --color-line #e2eadf, --color-danger(-soft)`, fonts `--font-serif/--font-sans`.
Tailwind v4 utilities (`bg-mint`, `text-ink-soft`, `border-line`, `bg-lime-soft`) compile to `var(--color-*)`, so overriding the variable on an ancestor element recolors descendants at runtime. Layer order fix for Chakra/Tailwind coexistence: `index.css:11`.
Used by: PublicOrganizationPage, product pages (`itemPageShared.ts:30-33` `PRIMARY_BTN = bg-mint`, `ItemTimeline.tsx` `bg-lime-soft`/`bg-teal-soft`/`bg-mint-soft`), panel, `PhoneFrame`, `PublicTermView` link hover `hover:text-mint` (`:69`).

### B. KragStage inline stylesheet — `pages/krag/components/KragStage.tsx:6-95`
Injected via `<style>{CSS}</style>` (`:111-117`), declares **global `:root`** vars `--cream --paper --ink --ink-soft --mint --mint-soft --sage --sage-soft --teal --teal-soft --lime --line --danger` (`:7-12`) — different names (no `color-` prefix) duplicating the same values — and ~70 `.kg-*` rules consuming them (`.kg-bring-btn`, `.kg-btn-primary`, `.kg-term` gradient `var(--mint-soft)→var(--paper)`, `.kg-attendee.is-on`, focus rings...). Also hard-coded stage backgrounds `#EDF1EA`, `#E7EDE4`, bezel `#1E2E27` (`:14, 92-93`). Because it targets `:root`, it leaks globally while mounted and cannot be scoped per organizer as-is; switching the selector to a wrapper class (e.g. `.kg-theme`) or reading from the `--color-*` set would make it themeable.
Used by: term page, `PrivateGroupGate`, `GroupVisualization` (`var(--ink)`, `var(--mint)`, `var(--teal)`, `var(--ink-soft)` in Tailwind arbitrary values, `GroupVisualization.tsx:153-159, 209-220, 257-266`).

## The only place organizer colors are consumed: `PublicOrganizationPage.tsx:5-6, 64-73`
```tsx
const DEFAULT_PRIMARY = "#1b8168"; // --color-mint
const DEFAULT_ACCENT = "#a9c24f"; // --color-lime
...
style={{ ["--color-mint" as string]: primaryColor, ["--color-lime" as string]: accentColor }}
```
- Pattern = scoped CSS-variable override on the page root — already the right mechanism in miniature.
- Weaknesses: only the base vars are overridden; derived `--color-mint-soft`, `--color-lime-soft` keep default greens (the badge uses `bg-lime-soft` + hard-coded `text-[#56701F]`, `:76`), so a custom accent produces mismatched tints; no contrast check; and the page body actually uses neither `mint` nor `lime` base utilities, so the override is currently almost invisible.
- Grep for `primary_color|accent_color|primaryColor|accentColor` in `src/` finds only `api/organizations.ts`, `PublicOrganizationPage.tsx` and test fixtures. **The research plan's claim that `PublicTermView.tsx` and `GroupVisualization.tsx` consume organization colors is incorrect** — they use hard-coded / KragStage colors only. (Confidence: High.)

## Hard-coded colors that bypass any variable (must be tokenized for theming)

| File:line | Value | Role |
|---|---|---|
| `pages/krag/components/TermFooter.tsx:18` | `bg-[#1B8168]` | primary CTA "Zapisz się" |
| `pages/krag/GroupVisualization.tsx:101` | `#1B8168` / `#CBDAC7` | circle active/inactive spokes |
| `pages/krag/GroupVisualization.tsx:164` | gradient `#4E9A5F→#3E8A4E` | pitch grass (semantic, can stay) |
| `pages/krag/GroupVisualization.tsx:220` | `#e7cfa8` | table wood (semantic, can stay) |
| `pages/krag/PublicTermView.tsx:180` | `bg-[#1E2E27] text-[#EAF2E9]` | toast |
| `pages/krag/PublicTermView.tsx:209,212` | `#E2EADF`, `#5C7069` | account-suggestion card |
| `components/krag/AccountMergeForm.tsx:89` | `#B4443A` | error text |
| `pages/product/ItemTimeline.tsx:21` | `text-[#12604D]` | "Dostępna" pill |
| `components/shared/PhoneFrame.tsx:11` | `#EDF1EA`, `#E7EDE4` | stage background (product + panel) |
| `pages/panel/PanelNav.tsx:31` | `#1B8168`/`#5C7069` icon stroke | panel nav on product page |
| `pages/panel/panelIcons.tsx` | 16 hex literals | icon strokes |
| `components/shared/Avatar.tsx:7` | 8-color `PALETTE` | family avatars (hash-based; arguably identity colors, not brand) |
| `PublicOrganizationPage.tsx:76` | `text-[#56701F]` | badge text |

Count of hex literals: `pages/krag` 28 (incl. KragStage), `components/shared/Avatar.tsx` 8, `panelIcons.tsx` 16, product pages 1.

## Global CSS / fonts
- Body bg/text/fonts set twice: Chakra `globalCss` (`theme/index.ts:4-13`) and Tailwind tokens; KragStage injects Google Fonts link at mount (`KragStage.tsx:3-4, 101-109`). A per-organizer font choice (if ever part of a paid layout) would follow the same injection pattern.

## Dark mode
No dark-mode support exists on public pages (no `prefers-color-scheme`, no `_dark` tokens used by Tailwind pages); Chakra default config ships a color-mode system only for admin. (Confidence: High — grep found no `dark:` variants in the target files; verified only for listed files.)
