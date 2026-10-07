# External / Theming — Chakra UI v3 runtime, per-subtree theming mechanism

Category: external-theming · Gathered 2026-10-07 · Chakra version in repo: `@chakra-ui/react` 3.34.0 (`src/frontend/node_modules/@chakra-ui/react/package.json`)

Sub-questions addressed: SQ4 (theming mechanism), SQ8 (no flash, portals)

---

## F1. Chakra v3 theme = `createSystem(defaultConfig, defineConfig({...}))`; tokens compile to CSS custom properties

**Source**: https://chakra-ui.com/docs/theming/customization/colors , https://chakra-ui.com/docs/theming/overview ; local `node_modules/@chakra-ui/react/dist/esm/styled-system/system.js:30-31`
**Evidence**:
```ts
const customConfig = defineConfig({ theme: { tokens: { colors: { brand: { 50: { value: "#e6f2ff" }, /* … */ 950: { value: "#001a33" } } } } } })
export const system = createSystem(defaultConfig, customConfig)
```
`system.js:30-31`: `cssVarsRoot = ":where(:root, :host)"`, `cssVarsPrefix = "chakra"` → each token becomes `--chakra-colors-<palette>-<step>` declared on `:root`.
The repo already does this (`src/frontend/src/theme/index.ts` — `brand`, `accent`, `teal`, `sage`, `ink` palettes, 50–900, no `950`, and **no palette semantic tokens defined for them**).
**Confidence**: High (docs + local source + repo file).

## F2. A palette is usable via `colorPalette="x"` only if it has the palette semantic tokens

**Source**: https://chakra-ui.com/docs/theming/customization/colors ; local `dist/esm/theme/semantic-tokens/colors.js:196-221`
Docs recommend for every new palette the semantic keys `solid, contrast, fg, muted, subtle, emphasized, focusRing`. The built-in palettes in 3.34 additionally define **`border`** (8 keys), e.g. blue:
```js
blue: {
  contrast:  { value: { _light: "white", _dark: "white" } },
  fg:        { value: { _light: "{colors.blue.700}", _dark: "{colors.blue.300}" } },
  subtle:    { value: { _light: "{colors.blue.100}", _dark: "{colors.blue.900}" } },
  muted:     { value: { _light: "{colors.blue.200}", _dark: "{colors.blue.800}" } },
  emphasized:{ value: { _light: "{colors.blue.300}", _dark: "{colors.blue.700}" } },
  solid:     { value: { _light: "{colors.blue.600}", _dark: "{colors.blue.600}" } },
  focusRing: { value: { _light: "{colors.blue.500}", _dark: "{colors.blue.500}" } },
  border:    { value: { _light: "{colors.blue.500}", _dark: "{colors.blue.400}" } },
}
```
Recipes (Button, Badge, Tabs, Checkbox…) consume only these virtual keys (`colorPalette.solid`, `.contrast`, `.fg`, …) plus numeric steps. So the **contract an organizer palette must fulfil = 11 scale steps (50–950) + 8 semantic keys**.
**Confidence**: High (local source read directly).

## F3. `colorPalette` is a *virtual color*: it emits element-level CSS vars pointing at the real palette vars — verified empirically

**Source**: https://chakra-ui.com/docs/styling/virtual-color ; local `styled-system/token-dictionary.js:160-196` (`buildColorPalette`), `utility.js:48-49`; runtime test below.
Empirical check (node, repo's Chakra 3.34):
```js
const sys = createSystem(defaultConfig, defineConfig({ theme: {
  tokens: { colors: { org: { 500: { value: "var(--org-500, #3fb68f)" }, 600: { value: "#111" } } } },
  semanticTokens: { colors: { org: { solid: { value: "{colors.org.500}" }, contrast: { value: "white" }, fg: { value: "{colors.org.600}" } } } } } }));
sys.getTokenCss()  // → --chakra-colors-org-500: var(--org-500, #3fb68f); --chakra-colors-org-solid: var(--chakra-colors-org-500); …  (on :root)
sys.css({ colorPalette: "org", bg: "colorPalette.solid", color: "colorPalette.contrast" })
// → { "--chakra-colors-color-palette-solid": "var(--chakra-colors-org-solid)",
//     "--chakra-colors-color-palette-contrast": "var(--chakra-colors-org-contrast)", …,
//     background: "var(--chakra-colors-color-palette-solid)", color: "var(--chakra-colors-color-palette-contrast)" }
```
Consequences:
1. Setting `colorPalette="org"` on a page root makes every descendant Chakra component that doesn't set its own `colorPalette` use `org`.
2. Because the indirection is resolved **at the element using inherited values**, overriding `--chakra-colors-org-*` on an ancestor `<div style={...}>` recolors the whole subtree at runtime, **without creating a new system / provider and without re-render of children**.
**Confidence**: High (executed against installed package).

## F4. GOTCHA — override every leaf variable, not just the scale steps

**Source**: CSS Custom Properties Level 1 (computed value of a custom property has `var()` substituted and is then inherited) — https://www.w3.org/TR/css-variables-1/#cycles (substitution at computed-value time); combined with F3 output.
`--chakra-colors-org-solid: var(--chakra-colors-org-500)` is declared on `:root`, so its value is **resolved at :root** and inherited already-substituted. If a wrapper overrides only `--chakra-colors-org-500`, descendants still see the *old* `solid`. Same for a scale defined as `var(--org-500, …)`: setting `--org-500` on a wrapper has no effect on `--chakra-colors-org-500` below it.
**Rule**: the runtime theme object must emit the full flat map: `--chakra-colors-org-{50..950}` **and** `--chakra-colors-org-{solid,contrast,fg,muted,subtle,emphasized,focusRing,border}` (and any project-level semantic tokens like page bg/surface/text) on the wrapper. The static theme should still define an `org` palette (with defaults = current mint `brand`) so types/`colorPalette="org"` resolve and the app looks right with no organizer data.
**Confidence**: High (spec behaviour; consistent with F3 output).

## F5. Tailwind v4 classes in the same pages can be recoloured the same way

**Source**: repo `src/frontend/src/index.css:22-38` (`@theme { --color-mint: #1b8168; … }`), Tailwind v4 docs https://tailwindcss.com/docs/theme (theme variables are emitted as CSS vars and utilities reference them, e.g. `bg-mint` → `background-color: var(--color-mint)`).
The repo mixes Chakra and Tailwind v4. Overriding `--color-mint`, `--color-mint-soft`, `--color-mint-bright`, `--color-lime*`, `--color-cream`… on the same wrapper recolours Tailwind-styled descendants too (utility resolves `var()` at the element). Same F4 caveat applies to any `@theme` var defined via another var (use `@theme inline` or override the leaf).
**Confidence**: Medium-High (Tailwind v4 mechanism well-documented; not executed in-repo).

## F6. Portals escape the themed subtree

**Source**: local `dist/types/components/portal/index.d.ts` → re-exports `Portal` from `@ark-ui/react/portal` (which accepts a `container` ref, https://ark-ui.com/docs/utilities/portal); Chakra overlay components (Dialog, Drawer, Menu, Popover, Tooltip, Select content, Toaster) render through Portal into `document.body`.
Content in portals does **not** inherit wrapper-scoped CSS vars. Options:
- (a) render overlays with `<Portal container={themeRootRef}>` or `portalled={false}` on organizer/term/product pages;
- (b) additionally write the same vars to `document.documentElement.style` while a public organizer-scoped route is mounted (cleanup on unmount) — simple, covers portals and `body` background, but is global, so **not** usable for side-by-side live preview in the panel;
- (c) recommended combo: scoped wrapper (works for preview) + wrap portal content in a small `<OrgThemeScope>` that re-applies the same style object.
**Confidence**: Medium-High (portal behaviour is standard DOM; exact per-component props not individually verified).

## F7. `Theme` component — forcing light/dark per subtree

**Source**: https://chakra-ui.com/docs/components/theme ; local `dist/esm/components/theme.js`
```js
const Theme = forwardRef(function Theme2(props, ref) {
  const { appearance, style, className, hasBackground = true, ...rest } = props;
  return jsx(chakra.div, { color: "fg", bg: hasBackground ? "bg" : void 0, colorPalette: "gray", ...rest,
    className: cx("chakra-theme", appearance, className), style: { ...style, colorScheme: appearance }, ref })
})
```
Dark condition in preset: `dark: ".dark &, .dark .chakra-theme:not(.light) &"`, `light: ":root &, .light &"` (`preset-base.js:158-159`). So `<Theme appearance="dark" colorPalette="org" style={orgVars}>` is a ready-made "theme scope" element; note its default `colorPalette: "gray"` must be overridden. The repo currently has **no color-mode setup** (no `next-themes`/`ColorModeProvider` in `src/`), so dark mode would be an opt-in per organizer (a "dark" palette preset) rather than an OS-following toggle.
Caveat: `_dark` conditions in semantic tokens are compiled at build-time into `.dark` selectors on the static system; for runtime org palettes, the generator should simply produce a different flat var map for dark appearance (i.e. light/dark is a generator input, not a token condition).
**Confidence**: High for component behaviour; Medium for the recommendation.

## F8. Alternatives considered (option matrix)

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Scoped CSS-var override + static `org` palette | `<Box colorPalette="org" style={toCssVars(palette)}>` | No new system; instant updates; works for live preview (draft state); cheap; zero re-render cost | Must emit full var map (F4); portals (F6) | **Recommended** |
| B. Nested `ChakraProvider value={createSystem(...)}` per organizer | build a system from API colours | "Pure" Chakra | `createSystem` is heavy (whole token dictionary + global CSS injection); nested providers re-inject `:root` vars (global, not scoped) → conflicts; no official per-subtree support | Avoid |
| C. Rebuild root system on route change | swap system in top provider | Simple mental model | Global; re-renders/re-injects all CSS; flashes | Avoid |
| D. Inline hex everywhere (`bg={org.primary}`) | current pattern in some components | Trivial | Doesn't reach Chakra recipes; no shades/contrast; scatter | Migrate away |

**Confidence**: Medium-High (B/C cons inferred from source structure: `system.js:115-119` writes vars under `cssVarsRoot`).

## Sources
- https://chakra-ui.com/docs/theming/customization/colors
- https://chakra-ui.com/docs/theming/semantic-tokens
- https://chakra-ui.com/docs/styling/virtual-color
- https://chakra-ui.com/docs/components/theme
- https://chakra-ui.com/docs/theming/overview
- https://ark-ui.com/docs/utilities/portal
- https://www.w3.org/TR/css-variables-1/
- https://tailwindcss.com/docs/theme
- Local: `src/frontend/node_modules/@chakra-ui/react/dist/esm/{styled-system/system.js,styled-system/token-dictionary.js,theme/semantic-tokens/colors.js,components/theme.js,preset-base.js}`
