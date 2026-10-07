# Deep dive: colors (Tailwind v4 runtime override, derived tints, hard-coded colors, portals, token set and generator)

Category: deep-colors. Gathered 2026-10-07. Builds on `codebase-frontend-color-application.md`, `external-theming-*.md` and `outputs/research-report.md` §5.
Paths are relative to `src/frontend/src/` unless stated otherwise. `src/` was not modified. All experiments ran in the session scratchpad:
- Tailwind compile: `@tailwindcss/node` 4.3.3 from the repo's `node_modules`, applied to the real `index.css`.
- Browser: Playwright MCP Chromium (Chrome 154 UA), using `getComputedStyle`.
- Generator prototype and bundle measurements: node + esbuild, culori 4.0.2.

---

## 1. Tailwind v4 runtime override: verified

### 1.1 How the repo's `@theme` compiles (empirical)
I compiled the repo's `src/index.css` with `@tailwindcss/node` 4.3.3 and a set of sample class candidates.
```css
@layer theme { :root, :host { --color-ink-soft:#5c7069; --color-mint:#1b8168; --color-mint-soft:#d8f0e6; --color-lime-soft:#eaf2ce; --color-line:#e2eadf; } }
.bg-mint        { background-color: var(--color-mint); }
.text-ink-soft  { color: var(--color-ink-soft); }
.border-line    { border-color: var(--color-line); }
.from-mint-soft { --tw-gradient-from: var(--color-mint-soft); … }
.ring-mint      { --tw-ring-color: var(--color-mint); }
@media (hover:hover){ .hover\:text-mint:hover { color: var(--color-mint); } }
.bg-mint\/50 { background-color: color-mix(in srgb, #1b8168 50%, transparent);            /* fallback, literal baked in */
  @supports (color: color-mix(in lab, red, red)) { background-color: color-mix(in oklab, var(--color-mint) 50%, transparent); } }
.bg-\[\#1B8168\] { background-color: #1B8168; }   /* arbitrary hex: not themable */
```
The shipped build (`src/frontend/dist/assets/index-DIYjCdn0.css`) confirms the same form, e.g. `.bg-mint{background-color:var(--color-mint)}`.

**Conclusion (High confidence):**
- Every named-token utility references `var(--color-*)` at the element.
- Setting `--color-mint: X` on any ancestor (inline `style` or a class) recolors the subtree.
- Opacity modifiers (`/50`) also stay themable in every browser Tailwind v4 supports. The `@supports` branch uses the var; the baked-literal fallback is only for browsers without color-mix.

### 1.2 Things that do bake values in or break the override
| Pattern | Effect | Where in repo |
|---|---|---|
| Arbitrary hex `bg-[#1B8168]`, `text-[#56701F]`, inline `style={{color:"#B4443A"}}`, SVG `stroke="#1B8168"` | Literal value. Ignores theme. | Full list in §3 |
| `@theme { --x: color-mix(… var(--color-primary) …) }` (non-inline) | Emitted on `:root` as `--x: color-mix(in oklch, var(--color-primary) …)`, so it resolves at `:root`. Tailwind also emits an sRGB fallback **with the literal default baked in** (`color-mix(in srgb, #1b8168 15%, white)`). | not used today. Pitfall for the implementation (verified) |
| `@theme inline { --x: color-mix(… var(--color-primary) …) }` | Utility gets `background-color: color-mix(in oklch, var(--color-primary) 15%, white)` inlined, so it **resolves at the element and follows a wrapper override**. No `--x` var is emitted for non-utility consumers. | verified |
| Tree-shaking of theme vars | Only vars used by a generated utility are emitted on `:root`. The repo's `--color-mint-bright`, `--color-sage`, `--color-teal` are **absent** from the compiled sample unless a utility uses them. Any `var(--color-x)` written in inline styles or the KragStage stylesheet may then be undefined. | Fix: `@theme static { … }` for tokens consumed outside utilities, or always set them in the scope's inline style |
| KragStage `:root{--mint:…}` (`KragStage.tsx:7-12`) | A separate, unprefixed var set declared on `:root`. It shadows nothing in Tailwind, but `.kg-*` rules and `var(--ink)`-style arbitrary values read these vars, not `--color-*`. | `KragStage.tsx`, `GroupVisualization.tsx`, `PrivateGroupGate.tsx`, `RequestAccessDialog.tsx`, `AccountMergeForm.tsx` |
| Alias declared at root (`:root{--alias: var(--color-mint)}`) | Frozen to the root value (verified in §2) | KragStage migration pitfall |

Other notes from the compile:
- The repo has no `@apply` or `theme()` usage in source, and `@theme` appears only in `index.css:22`.
- The KragStage `<style>` is **unlayered**, so its rules beat every Tailwind `@layer utilities` rule.
- KragStage also leaks a global `*,*::before,*::after{box-sizing}` rule (`KragStage.tsx:13`).

---

## 2. color-mix() / relative color syntax at wrapper scope: verified in Chromium

Test page: `.org-theme` wrapper with inline `--color-mint:#c0392b` (red). Defaults are `:root{--color-mint:#1b8168}`.

| Case | Declared on | Computed bg of child | Follows wrapper? |
|---|---|---|---|
| a `--soft: color-mix(in oklch, var(--color-mint) 15%, white)` | `:root` | `oklch(0.931 0.015 171.7)` (mint hue) | **No**, pitfall confirmed |
| b same expression | `.org-theme` (wrapper class) | `oklch(0.931 0.026 29.7)` (red hue) | Yes |
| c `oklch(from var(--color-mint) 0.95 calc(c*0.3) h)` | `.org-theme` | `oklch(0.95 0.052 29.7)` | Yes |
| d `--alias: var(--color-mint)` | `:root` | `rgb(27,129,104)` (mint) | **No** |
| e `--alias2: var(--color-mint)` | `.org-theme` | `rgb(192,57,43)` | Yes |
| f `color-mix(in oklab, var(--color-mint) 50%, transparent)` used directly in a rule | element | red at 50% | Yes |

`getComputedStyle(:root).getPropertyValue('--soft')` returns `color-mix(in oklch, #1b8168 15%, white)`. The `var()` has already been substituted at `:root`, so descendants inherit the substituted string. This matches CSS Variables L1: custom properties compute with `var()` substituted, then inherit.

**Pitfall:** a var defined on `:root` in terms of another var is frozen at `:root`. The same applies to `@theme` (non-inline) definitions and to KragStage aliases such as `--mint: var(--color-mint)` on `:root`.

**Fixes (pick one per token):**
1. Declare derived vars **on the scope selector** (`.org-theme { --color-primary-soft: color-mix(...) }`). They then recompute wherever `.org-theme` matches, including nested previews.
2. Use `@theme inline` for derived Tailwind tokens, so the expression is inlined into each utility.
3. Compute in JS and set **every leaf** var in the scope's inline style. This is the recommended approach because it is the only option that also does contrast correction (see §5).

**Browser support:**
- `color-mix()` has been Baseline Widely Available since May 2023 (Chrome 111, Firefox 113, Safari 16.2). Tailwind v4 already requires it: its own browser floor is Safari 16.4 / Chrome 111 / Firefox 128.
- Relative color syntax (`oklch(from …)`) is supported from Chrome 119, Firefox 128 and Safari 18. It is Baseline Newly Available (since 2024), so Safari 16.4–17.x users would lose it, but they would not lose color-mix.
- Neither function can **enforce contrast**. CSS `contrast-color()` is not Baseline. So CSS-only derivation cannot guarantee WCAG; JS must at least pick the on-primary color and correct the solid and text colors.

Sources: https://web.dev/blog/baseline2023 , https://web.dev/blog/web-platform-07-2024 , https://caniuse.com/mdn-css_types_color_color_relative_syntax

---

## 3. Complete inventory of hard-coded colors (organizer, term, product and the shared components they use)

Recommended token names come from §5. "Themable" means it should follow the organizer palette. "Fixed" means it stays constant but should still be tokenized where noted.

### 3.1 Organizer page
| file:line | value | role | → token | decision |
|---|---|---|---|---|
| `pages/PublicOrganizationPage.tsx:5` | `"#1b8168"` DEFAULT_PRIMARY | default seed | remove; `null` theme = static defaults | themable (input) |
| `pages/PublicOrganizationPage.tsx:6` | `"#a9c24f"` DEFAULT_ACCENT | default seed | remove | themable (input) |
| `pages/PublicOrganizationPage.tsx:68-73` | inline `--color-mint`/`--color-lime` override | partial scope | replace with `OrganizerThemeScope` (all leaves) | — |
| `pages/PublicOrganizationPage.tsx:76` | `text-[#56701F]` on `bg-lime-soft` | badge text on accent tint | `text-accent-fg` / `bg-accent-soft` | themable |

### 3.2 Term page: KragStage stylesheet (`pages/krag/components/KragStage.tsx`)
| line | value | role | → token | decision |
|---|---|---|---|---|
| 7-12 | `:root{--cream…--danger}` 13 vars | duplicate palette on `:root` (global leak, not scopable) | **delete**; `.kg-*` rules read `--color-*` directly | — |
| 11 | `--danger:#B4443A` | error text | `--color-danger` (#b23b3b in Tailwind; **values drift**) | fixed |
| 14 | `.kg-stage{background:#EDF1EA}` | backdrop behind phone (<520px) | `--color-stage` | themable (tinted neutral) |
| 92 | `.kg-stage{background:#E7EDE4}` (≥520px) | wide backdrop | `--color-stage-wide` | themable (tinted neutral) |
| 93 | `0 0 0 9px #1E2E27` | phone bezel ring | `--color-ink` | fixed |
| 93 | `rgba(30,46,39,.6)` shadow | drop shadow | ink-based shadow (keep) | fixed |
| 33, 36, 45, 81 | `rgba(30,46,39,.7/.85/.9)` shadows | avatar/center/toast shadows | keep (ink tinted) | fixed |
| 33 | `.kg-av{color:#fff}` | initials on avatar (bg from Avatar PALETTE) | `--color-on-avatar` = white | fixed |
| 38, 40 | `.kg-mark*{color:#fff}` | icon on mint/teal mark | `--color-on-primary` (shares mark), white on teal (fixed) | shares: themable |
| 45 | `.kg-center-av{color:#fff}` on `var(--ink)` | organizer disc | white on ink | fixed |
| 72 | `.kg-btn-primary{color:#fff}` on `var(--mint)` | primary CTA label | `--color-on-primary` | **themable** |
| 80 | `.kg-toast{color:#EAF2E9}` on `var(--ink)` | toast text | `--color-on-ink` (#eaf2e9) | fixed |
| 21, 75 | `color:var(--sage)` (eyebrow, status line) | secondary label | keep `--color-sage` fixed **or** map to `--color-primary-fg`. Note sage on cream is **3.70:1** and on paper 3.98:1, which fails AA for 11-12px text | fixed + a11y fix |
| 24, 58, 63, 70, 72, 85 | `var(--mint)` back link, bring-btn, focus ring, btn-primary, term eyebrow | primary roles | `--color-primary` (fills) / `--color-primary-fg` (text: 24, 58, 85) / `--color-focus-ring` (63, 70) | themable |
| 36, 62, 70, 83 | `var(--mint-soft)` halo, selected attendee, input focus halo, term-card gradient | primary tint | `--color-primary-soft` | themable |
| 16, 33, 38, 40, 69 | `var(--cream)` | page bg / avatar ring / input bg | `--color-cream` (page) | themable (tinted neutral) |
| 20, 48, 53, 61, 67, 69, 74, 77-78, 84, 89 | `var(--line)` | hairlines | `--color-line` | themable (tinted neutral) |
| 42 | `var(--teal)` | "brings" mark | `--color-teal` | fixed (semantic) |
| 15, 44, 86, 89; 23, 47, 50, 57, 59, 74, 82, 90 | `var(--ink)` / `var(--ink-soft)` | text | `--color-ink`, `--color-ink-soft` | fixed |
| 20, 48, 58, 77-78, 83, 88 | `var(--paper)` | cards | `--color-paper` | fixed |

### 3.3 Term page: React components
| file:line | value | role | → token | decision |
|---|---|---|---|---|
| `pages/krag/components/TermFooter.tsx:18` | `bg-[#1B8168] … text-white` | main CTA "Zapisz się" | `bg-primary text-on-primary` | **themable (highest visibility)** |
| `pages/krag/GroupVisualization.tsx:101` | `stroke="#1B8168"` / `"#CBDAC7"` | circle spokes active / inactive | `var(--color-primary)` / `var(--color-line-strong)` | themable |
| `pages/krag/GroupVisualization.tsx:153, 209` | `bg-[var(--ink)] text-white` + `rgba(30,46,39,.85)` | organizer disc | `bg-ink text-white` | fixed |
| `pages/krag/GroupVisualization.tsx:156, 159, 212, 215, 226, 257` | `text-[var(--ink)]`, `text-[var(--ink-soft)]` | text (KragStage vars) | `text-ink`, `text-ink-soft` | fixed. **Breaks if KragStage `:root` block is removed without migrating these** |
| `pages/krag/GroupVisualization.tsx:163` | `border-white/50` | pitch frame | keep | fixed (illustration) |
| `pages/krag/GroupVisualization.tsx:164` | `linear-gradient(160deg,#4E9A5F,#3E8A4E)` | football pitch grass | `--color-illus-grass-*` const | fixed (semantic illustration) |
| `pages/krag/GroupVisualization.tsx:220` | `#e7cfa8`, `6px solid var(--ink)` | table wood + rim | const + `--color-ink` | fixed (illustration) |
| `pages/krag/GroupVisualization.tsx:226` | `bg-white … rgba(0,0,0,.12)` | chip on table | `bg-paper` | fixed |
| `pages/krag/GroupVisualization.tsx:259` | `bg-[var(--mint)] text-white` | legend "udostępnia" | `bg-primary text-on-primary` | themable |
| `pages/krag/GroupVisualization.tsx:265` | `bg-[var(--teal)] text-white` | legend "przynosi" | `bg-teal` (white icon on teal = **2.32:1**, below the 3:1 non-text minimum) | fixed + a11y fix (darker teal or ink icon) |
| `pages/krag/PublicTermView.tsx:180` | `bg-[#1E2E27] text-[#EAF2E9]` + rgba shadow | toast (duplicate of `.kg-toast`) | `bg-ink text-on-ink` | fixed |
| `pages/krag/PublicTermView.tsx:209` | `border-[#E2EADF] bg-white` | account-suggestion card | `border-line bg-paper` | line themable |
| `pages/krag/PublicTermView.tsx:212` | `border-[#E2EADF] text-[#5C7069]` | ghost button | `border-line text-ink-soft` | line themable |
| `pages/krag/PublicTermView.tsx:69` | `hover:text-mint` | link hover | `hover:text-primary-fg` | themable |
| `pages/krag/components/GroupHeader.tsx:16` | `bg-white` (commented-out code) | — | delete | — |
| `pages/krag/PrivateGroupGate.tsx:12, 169` | `color:"var(--ink-soft)"` inline | body text | `text-ink-soft` | fixed (KragStage-var dependency) |
| `components/krag/AccountMergeForm.tsx:58, 63, 77` | `color:"var(--ink-soft)"` inline | labels | `text-ink-soft` | fixed (KragStage-var dependency) |
| `components/krag/AccountMergeForm.tsx:89` | `color:"#B4443A"` | form error | `text-danger` | fixed |
| `components/krag/RequestAccessDialog.tsx:94` | `rgba(20,28,24,0.55)` | modal scrim | `--color-scrim` | fixed |
| `components/krag/RequestAccessDialog.tsx:107, 122, 123, 133` | `var(--paper)`, `var(--cream)`, `var(--ink-soft)` inline | sheet bg / close btn / text | Tailwind tokens (`bg-paper`, `bg-cream`, `text-ink-soft`) | cream themable |
| `components/krag/ModalSheet.tsx:24` | `bg-[rgba(20,28,24,0.55)]` | scrim | `bg-scrim` | fixed |
| `components/krag/AuthGateSheet.tsx:39` | `text-mint` | link | `text-primary-fg` | themable |
| `components/shared/Avatar.tsx:7` | 8-hex `PALETTE` (all greens/teals) | family identity color (hash-based) | keep fixed in MVP. Optional v2: derive 8 hues around the primary hue at fixed L/C | fixed (identity) |
| `components/shared/Icons.tsx:58` | `stroke="#94a3b8"` | image placeholder icon | `currentColor` + `text-ink-soft` | fixed |

### 3.4 Product pages (`pages/product/*`) and the shared chrome they mount (`PhoneFrame`, `PanelNavBar`, `panelIcons`)
| file:line | value | role | → token | decision |
|---|---|---|---|---|
| `pages/product/ItemTimeline.tsx:21` | `bg-mint-soft text-[#12604D]` | "Dostępna" pill | `bg-primary-soft text-primary-fg` | themable |
| `pages/product/ItemTimeline.tsx:26-40` | `bg-lime-soft text-ink` | reserved/in-transit pills | `bg-accent-soft text-ink` | themable |
| `pages/product/ItemTimeline.tsx:48` | `bg-teal-soft` | pill | keep | fixed |
| `pages/product/ItemTimeline.tsx:141` | `bg-mint-soft` | timeline dot/bg | `bg-primary-soft` | themable |
| `pages/product/itemPageShared.ts:32` | `bg-mint … text-white` (PRIMARY_BTN) | primary button | `bg-primary text-on-primary` | themable |
| `pages/product/ItemCreatePage.tsx:65` | `bg-mint … text-white` | submit | `bg-primary text-on-primary` | themable |
| `pages/product/ItemGalleryEditor.tsx:199` | `bg-mint text-white focus-within:ring-mint/40` | upload button | `bg-primary text-on-primary ring-focus-ring/40` | themable |
| `pages/product/ItemGallery.tsx:90` | `bg-ink/70 text-white` | photo counter overlay | keep | fixed |
| `pages/product/ItemGallery.tsx:105` | `ring-mint` | selected thumbnail | `ring-focus-ring` | themable |
| `pages/product/ItemEditPage.tsx:115, 123` | `text-mint` | text links | `text-primary-fg` | themable |
| `components/shared/PhoneFrame.tsx:11` | `bg-[#EDF1EA]`, `min-[520px]:bg-[#E7EDE4]` | stage backdrop (also used by panel) | `bg-stage`, `bg-stage-wide` | themable |
| `pages/panel/PanelNav.tsx:20` | `rgba(30,46,39,0.7)` shadow | nav shadow | keep | fixed |
| `pages/panel/PanelNav.tsx:31` | `c={active ? "#1B8168" : "#5C7069"}` | nav icon stroke | switch icons to `stroke="currentColor"`, color from parent `text-primary-fg`/`text-ink-soft` | themable |
| `pages/panel/panelIcons.tsx:3,12,18,24,34,43,50,56,67,96` | default `c="#1E2E27"` | icon stroke | `currentColor` | fixed (ink) |
| `pages/panel/panelIcons.tsx:64, 80` | `stroke="#1E2E27"` (menu, back) | icon stroke | `currentColor` | fixed |
| `pages/panel/panelIcons.tsx:104,112,121` | default `c="#5C7069"` | secondary icons | `currentColor` | fixed |
| `pages/panel/panelIcons.tsx:134` | `stroke="#B23B3B"` (trash) | destructive icon | `currentColor` + `text-danger` | fixed |
| `pages/panel/panelComponents.tsx:29, 64, 80, 84` | `bg-mint`, `border-mint bg-mint-soft`, `text-mint` | toggle / hint / link (panel, only if used on product) | role tokens | themable |
| `pages/panel/panelComponents.tsx:32` | `bg-white` | toggle knob | `bg-paper` | fixed |
| `pages/panel/panelComponents.tsx:112` | scrim rgba | modal scrim | `bg-scrim` | fixed |

### 3.5 Outside the scope wrapper (`components/layout/PublicLayout.tsx`, wraps both public routes)
| file:line | value | note |
|---|---|---|
| `PublicLayout.tsx:17` | `border-line bg-paper`, shadow rgba | Logged-in account bar is rendered **above** the page, outside any page-level scope. It stays default-themed. |
| `components/shared/NotificationBell.tsx:32, 74` | `bg-mint text-white` badge/dot | stays default mint on a red organizer page |
| `components/shared/NotificationBell.tsx:46`, `AccountMenu.tsx:44` | rgba shadows | fixed |
| `theme/index.ts:5-7` | Chakra `globalCss body { bg:#f4f8f0; color:#1e2e27 }` | body/overscroll color stays default |

Fix: either accept (account chrome = platform, not organizer), or mount the scope in a thin layout route around `<Outlet/>` for the organizer/term routes, keyed by the resolved theme. The body/overscroll color can be set on `document.documentElement` while mounted, or with `<meta name="theme-color">`.

**Counts:**
- Term scope: ~22 literal colors outside KragStage + 13 `:root` vars + ~10 literals inside KragStage.
- Product scope: 2 in product files + 2 PhoneFrame + 2 PanelNav + 16 panelIcons.
- Organizer page: 3.
- **Must-change for theming (themable roles): about 14 sites.** TermFooter CTA, GroupVisualization spokes and legend, PhoneFrame/KragStage stage bg ×4, ItemTimeline pill text, PanelNav icon color, PublicOrganizationPage badge text, KragStage `#fff`-on-mint ×2, and the PublicTermView line colors.

### 3.6 Existing contrast defects found while calibrating (default palette)
Measured with a WCAG 2 relative-luminance implementation:
- `--color-mint` text on cream `#f4f8f0` = **4.45:1** (AA needs 4.5). Affects `text-mint` links and `.kg-term-eyebrow`/`.kg-back` on the cream page.
- `--sage` text on cream = **3.70:1**, on paper = 3.98:1 (`.kg-eyebrow`, `.kg-status-line`, 11-12px bold).
- White icon on `--teal` = **2.32:1**, below the 3:1 non-text minimum (legend, `.kg-mark-brings`).
- White on lime = 2.00:1. Not currently used for text; keep it that way.
- `ink-soft` on `mint-soft` = **4.41:1** (`.kg-attendee.is-on` selected row text).

These should be fixed when tokenizing. The generator below guarantees them for custom palettes.

---

## 4. Portals and overlays

**`createPortal`, Chakra `<Portal>` and `document.body` appear nowhere in `src/`** (repo-wide grep over `.tsx`/`.ts`, excluding tests). Every overlay on the term and product pages is an in-tree `position: fixed` element:

| Overlay | file:line | Rendered where | Inherits scoped vars? |
|---|---|---|---|
| `ModalSheet` (used by `AuthGateSheet`, `RsvpDialog`, `RsvpDialogLoggedIn`, `SwapProposeDialog`) | `components/krag/ModalSheet.tsx:24` | inline, fixed | Yes, if mounted inside the scope |
| `RequestAccessDialog` | `components/krag/RequestAccessDialog.tsx:88-108` | inline, fixed, inline styles | Yes |
| Toast | `pages/krag/PublicTermView.tsx:180` (+ `.kg-toast` `KragStage.tsx:80`) | inline via `KragStage` `overlay` prop (`KragStage.tsx:115`, inside the same `<div>`) | Yes |
| Panel `ModalSheet` | `pages/panel/panelComponents.tsx:112` | inline, fixed | Yes |
| `AccountMenu` / `NotificationBell` dropdowns + click-catchers | `AccountMenu.tsx:40-44`, `NotificationBell.tsx:42-46` | inside `PublicLayout` nav, **outside** page scope | No (see §3.5) |
| Native dialogs (`window.confirm`, if any) | — | browser UI | n/a |

**Rules for the implementation:**
1. Mount `OrganizerThemeScope` at the top of the page component, so `KragStage`'s `overlay` and every sheet sit inside it. `TermPage` wraps both `PublicTermView` and `PrivateGroupGate`.
2. The scope element must not get `transform`, `filter`, `perspective`, `contain: paint/layout` or `will-change: transform`. These would make it the containing block for the `position:fixed` sheets and toasts, and break their viewport positioning. The theme vars would still apply.
3. To add no layout box, the scope may use `display: contents`. Custom properties still inherit through it. Caveat: an element with `display: contents` cannot itself paint a background, so the stage background must stay on the child.
4. If a Chakra overlay (Dialog/Toaster/Menu → Ark `Portal` → `document.body`) is ever introduced on these pages, do one of the following:
   - pass `portalled={false}`;
   - pass `<Portal container={scopeRef}>`;
   - wrap the portal content in a second `OrganizerThemeScope` with the same style object.

---

## 5. Final token set and generation algorithm

### 5.1 Token roles (Tailwind `@theme` names; defaults = today's values)
Rename to role names now, so layouts never refer to "mint". Keep the old names only as transitional aliases, declared in `@theme inline` (never on `:root`).

| Role token | Default (today) | Old name | Used for | Themable? |
|---|---|---|---|---|
| `--color-primary` | `#1b8168` | `mint` | solid fills: CTAs, active marks, legend dot, active spokes | **yes** |
| `--color-on-primary` | `#ffffff` | (`text-white`) | text/icons on primary | **yes** (white or ink by contrast) |
| `--color-primary-fg` | `#117b63`* (generator output) | (`text-mint`) | primary-colored **text** on cream/paper/soft: links, eyebrows, back link, active nav label, "Dostępna" text | **yes** |
| `--color-primary-soft` | `#d8f0e6` (gen: L 0.95) | `mint-soft` | selected row, halos, term-card gradient, pills | **yes** |
| `--color-focus-ring` | `#1b8168` | — | focus outlines, selected thumbnail (≥3:1 vs cream/paper) | **yes** |
| `--color-accent` | `#a9c24f` | `lime` | decorative accent fills (no text on it) | **yes** |
| `--color-accent-soft` | `#eaf2ce` | `lime-soft` | badge/pill bg | **yes** |
| `--color-accent-fg` | `#56701f` | (`#56701F`) | text on accent-soft | **yes** |
| `--color-cream` (page) | `#f4f8f0` | `cream` | page background, input bg | **yes** (tinted neutral) |
| `--color-stage` / `--color-stage-wide` | `#edf1ea` / `#e7ede4` | literals | backdrop behind phone frame | **yes** (tinted neutral) |
| `--color-line` | `#e2eadf` | `line` | hairlines/borders | **yes** (tinted neutral) |
| `--color-line-strong` | `#cbdac7` | literal | inactive spokes, dashed separators | **yes** (tinted neutral) |
| `--color-paper` | `#ffffff` | `paper` | cards, sheets | fixed |
| `--color-ink`, `--color-ink-soft` | `#1e2e27`, `#5c7069` | same | text | fixed (ink-soft must stay ≥4.5 on cream and primary-soft; verified in §5.3) |
| `--color-on-ink` | `#eaf2e9` | literal | toast text | fixed |
| `--color-danger`, `--color-danger-soft` | `#b23b3b`, `#f6e4e2` | same | errors (unify the KragStage `#B4443A`) | fixed |
| `--color-teal`, `--color-teal-soft`, `--color-sage`, `--color-sage-soft` | today | same | "brings" semantics, secondary labels | fixed (fix sage/teal contrast) |
| `--color-scrim` | `rgba(20,28,24,.55)` | literal | modal backdrop | fixed |
| illustration constants (grass, wood), Avatar PALETTE | today | literals | illustrations / identity | fixed |

*Today `text-mint` = `#1b8168` (4.45:1 on cream). Introducing `primary-fg` fixes that.

`mint-bright` is unused on these pages. Drop it from the themable set and leave it as a static token for the panel.

The **scope element must set all 13 themable leaves** inline: primary, on-primary, primary-fg, primary-soft, focus-ring, accent, accent-soft, accent-fg, cream, stage, stage-wide, line, line-strong. Fixed tokens stay on `:root`. Mark them `@theme static`, so they are emitted even when only KragStage or inline styles use them.

### 5.2 Generation algorithm (JS, pure, synchronous, run in `useMemo`; mirror on the backend for validation)
Inputs: `primary` (required hex), `accent` (optional hex). Work in OKLCH; enforce WCAG 2.

1. **Guard:** if primary `L > 0.9`, the seed is near-white. Clamp to `L = 0.75`, so buttons don't vanish on paper, and the editor shows a "kolor za jasny" note.
2. **primary + on-primary:**
   - If contrast(seed, white) ≥ 4.5: use the seed, with white on-primary.
   - Else if the seed is light (L > 0.68) and contrast(seed, ink) ≥ 4.5: use the seed, with ink on-primary (e.g. yellow, pink).
   - Else: binary-search L downward, keeping H and gamut-clamping C, until contrast with white is ≥ 4.5.
3. **primary-fg:** binary-search the seed L downward until it is ≥ 4.5 against both cream and primary-soft.
4. **primary-soft:** `oklch(0.95, min(C·0.3, 0.04), H)`. L = 0.95 rather than 0.935 is what keeps ink-soft ≥ 4.5 on it (§5.3).
5. **focus-ring:** seed darkened until ≥ 3:1 vs cream and paper.
6. **accent:** seed, or if absent `oklch(0.77, clamp(C,0.10,0.15), H+300°)`. Then accent-soft = `oklch(0.946, min(C·0.35, 0.05), Ha)` and accent-fg = accent darkened to ≥ 4.5 on accent-soft.
7. **Tinted neutrals:** hue = primary H, chroma = min(target, C·0.3) so grays stay gray.
   - cream: L 0.974, C 0.012
   - stage: L 0.953, C 0.011
   - stage-wide: L 0.939, C 0.014
   - line: L 0.928, C 0.017
   - line-strong: L 0.872, C 0.03
   - These targets were calibrated from today's palette in OKLCH (e.g. cream `#f4f8f0` = L 0.974 C 0.011).
   - Caveat: today's neutrals use hue ≈130–140 (yellow-green), not the mint hue 172.
8. **Default palette (`theme == null`) and named presets do not run the generator.** They ship hand-tuned hex maps, so the current look is pixel-identical. The generator applied to `#1b8168` gives cream `#eff9f5` instead of `#f4f8f0`.
9. Return the flat `{"--color-primary": "#…", …}` map. Persist only the inputs.

### 5.3 Prototype results (hand-written OKLCH + WCAG code, ~1.4 KB min / 0.9 KB gz)
Per-seed contrast results after correction (all ≥ thresholds):

| seed (accent) | primary → on | primary-fg | fg/cream | fg/soft | accent-fg/soft | ink-soft/cream | ink-soft/soft | focus/cream |
|---|---|---|---|---|---|---|---|---|
| #1b8168 (#a9c24f) | #1b8168 → white 4.79 | #117b63 | 4.84 | 4.54 | 4.52 | 4.91 | 4.61 | 4.45* |
| #c0392b (auto) | #c0392b → white 5.44 | ≈seed | 5.03 | 4.67 | 4.50 | 4.89 | 4.54 | 5.03 |
| #f1c40f (#2c3e50) | #f1c40f → **ink** 8.57 | #806600 | 4.83 | 4.51 | 9.38 | 4.89 | 4.56 | 3.01 |
| #3498db (auto) | **#047cbe** (darkened) → white 4.53 | #006fab | 4.86 | 4.52 | 4.55 | 4.92 | 4.58 | 3.01 |
| #8e44ad (#f39c12) | seed → white 5.87 | seed | 5.41 | 5.01 | 4.51 | 4.87 | 4.51 | 5.41 |
| #000000 | seed → white 21 | seed | 19.4 | 18.1 | 4.54 | 4.89 | 4.55 | 19.4 |
| #ffffff (clamped) | clamped → ink 6.42 | grey | 4.84 | 4.51 | 4.53 | 4.89 | 4.55 | 3.03 |
| #ff69b4 | seed → **ink** 5.38 | #be297c | 4.86 | 4.51 | 4.53 | 4.86 | 4.51 | 3.01 |
| #3fb68f | seed → ink 5.63 | #00795b | 4.78 | 4.50 | 4.52 | 4.91 | 4.63 | 3.03 |

*Focus ring only needs 3:1.

Takeaways:
- With primary-soft at L 0.935 (≈ today's mint-soft), ink-soft on soft was 4.31–4.43 for every seed. Raising it to L 0.95 fixed all cases. **Recommend lightening `mint-soft` in the default palette too** (or using ink for text on selected rows).
- Very light primaries (yellow, pink) get **ink** button labels. This is preferable to darkening, which would muddy them. The editor should show the resulting button.

Prototype source: scratchpad `culori/src/gen.mjs` + `hand.mjs` (not in repo).

### 5.4 Library vs hand-written: measured bundle size (esbuild, minified, ESM)
| Option | min | gzip |
|---|---|---|
| culori 4.0.2 `culori/fn` tree-shaken (`useMode(modeOklch/modeRgb/modeLrgb)`, `parseHex`, `formatHex`, `wcagContrast`, `clampChroma`) | 16.8 KB | **6.8 KB** |
| culori 4.0.2 default entry (`oklch`, `formatHex`, `wcagContrast`, `clampChroma`), which registers all modes | 44.8 KB | **15.7 KB** |
| hand-written OKLCH↔sRGB (Ottosson matrices) + gamut clamp by chroma bisection + WCAG luminance/contrast | 1.46 KB | **0.9 KB** |

Note: esbuild needs a `NODE_PATH`/package context to resolve the `culori/fn` export map. The Vite build resolves it normally.

**Recommendation:**
- Hand-written module `src/theme/orgPalette.ts` (~80 lines + unit tests). Zero dependencies, in line with `standards/global/conventions.md` (minimal dependencies). It needs only hex parse, OKLCH conversion, chroma clamp and contrast; all are short, well-known formulas.
- Mirror the WCAG check (~20 lines of Python) on the backend `PATCH` to reject invalid seeds. The server may also store the corrected values, but the inputs remain the source of truth.
- If more color features are needed later (P3, APCA, interpolation), switch to `culori/fn` (~7 KB gz) and **never** the default `culori` entry (~16 KB gz).

**Why not CSS color-mix only:**
- It cannot pick on-primary.
- It cannot darken to a contrast target.
- Each 15%-mix with white yields a different perceived lightness per hue.
- It is acceptable only as a no-JS fallback for decorative tints (`@theme inline`).

---

## 6. Gaps / uncertainties
- Firefox and Safari were not executed. Behavior is standard per spec and Baseline data; only Chromium 154 was tested empirically.
- Whether Tailwind v4.3 emits theme vars referenced only via `var(--color-x)` inside source strings (not utilities) was not exhaustively tested. `--color-mint-bright` was absent in the sample. Using `@theme static` for those tokens removes the question.
- The generator constants (L ladder, chroma factors, accent hue offset +300°) need visual tuning with real organizer colors.
- Avatar palette harmony with non-green primaries is a design decision; it is kept fixed here.
