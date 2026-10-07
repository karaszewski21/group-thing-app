# External / Theming — Contrast enforcement, flash-of-unthemed-content, presets vs free picker

Category: external-theming · Gathered 2026-10-07
Sub-questions: SQ4 (contrast-safe on-colour), SQ6 (editor UX), SQ8 (a11y, no flash)

---

## F1. WCAG 2.2 AA remains the legal/target baseline; thresholds

**Source**: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- SC 1.4.3: "text … has a contrast ratio of at least 4.5:1, except … Large Text … at least 3:1". Large = ≥18pt (~24px) or ≥14pt bold (~18.5px).
- Ratio `(L1 + 0.05) / (L2 + 0.05)`; sRGB relative luminance `L = 0.2126 R + 0.7152 G + 0.0722 B` (linearised channels).
- SC 1.4.11 non-text contrast: UI components/graphics ≥ 3:1 (borders of inputs, focus rings, icons).
**Confidence**: High.

## F2. APCA is not a standard — use it at most as a secondary signal

**Sources**: https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html ; https://www.yatil.net/blog/wcag-3-is-not-ready-yet
April 2026 WCAG 3 editor's draft: "The contrast algorithm used in WCAG 3 is yet to be determined." APCA was pulled from the July 2023 draft; WCAG 3 "perhaps 2030 at the soonest". Roselli's advice: satisfy WCAG 2 first; if also using APCA, meet both. (APCA scale reference: Lc 60 min body text, Lc 75 preferred, Lc 90 high — Radix uses Lc 60/90 for its text steps.)
**Recommendation**: enforce WCAG 2 4.5:1 (text) / 3:1 (large text, UI) server- and client-side; optionally show APCA as a hint. **Confidence**: High.

## F3. Auto-correction algorithm (contrast-safe derived colours)

Synthesis (Medium-High; standard technique used by Material HCT "tone distance" and Radix step guarantees — see `external-theming-tokens-and-palette-generation.md` F3/F4):
1. **On-colour (`contrast`)**: compute `wcagContrast(solid, white)` and `(solid, black|near-black ink)`; pick the higher. If neither ≥ 4.5, go to step 2.
2. **Nudge, don't reject**: move `solid` along OKLCH L (keep H, scale C to stay in gamut) towards darker (if white text) or lighter (if dark text) in small steps until ≥ 4.5:1 — typically 1–6 iterations; binary search on L also works. Keep the *original* seed as `brandRaw` for decorative large fills where 3:1 suffices.
3. **Text-on-page (`fg`)**: same check of `org.fg` against page bg (`neutral.50`/surface) — must be ≥ 4.5:1; links ≥ 4.5:1 and distinguishable from body text.
4. **UI/borders/focus ring** ≥ 3:1 against adjacent bg.
5. Surface the result in the editor: "We darkened your colour slightly so text stays readable" + before/after swatch; optionally an "I accept low contrast" override is **not** recommended for public pages.
Library calls: culori `wcagContrast(a,b)`, `oklch()`, `formatHex()`, `toGamut()` (https://culorijs.org/api/); chroma-js `chroma.contrast(a,b)` (https://gka.github.io/chroma.js/). Backend can re-validate with a ~20-line pure-Python WCAG function (no dependency needed) to reject API calls that bypass the UI.
**Confidence**: Medium-High (algorithm is synthesis; formulas High).

## F4. Avoiding flash of unthemed content (FOUC) in a CSR SPA (Vite, no SSR)

**Sources**: https://yomotherboard.com/question/how-can-i-prevent-flicker-from-dynamic-css-variables-in-a-single-page-app/ ; https://blog.openreplay.com/theme-switcher-css-variables/ ; https://www.mintlify.com/mui/material-ui/customization/css-theme-variables
General guidance: CSS vars can change at runtime without re-render; flashes come from painting before the theme is known. Classic fixes are an inline `<head>` script (works for user-preference themes stored in localStorage) or SSR-inlined critical vars.
Application to this repo (CSR, theme comes from API per organizer — Medium-High):
- **Ship theme inputs inside the same public payload** that the page already needs (organizer public view / term public view / product detail) instead of a separate `/theme` request → no extra waterfall; the page is in a loading state anyway until that payload arrives, so render skeletons *neutrally* (grey, not mint) and apply vars together with content.
- Derivation is pure & synchronous (`useMemo(() => buildOrgThemeVars(settings), [settings])`) → first contentful render already themed; no `useEffect`-after-paint.
- TanStack Query cache keeps settings across navigations organizer → term → product, so there is no re-flash between the three pages (key per data-fetching standard).
- Optional: cache last palette per slug in `localStorage` (try/catch) to paint the skeleton in brand colours on repeat visits; inline `<head>` script only makes sense if the slug can be read from `location` before React boots — low value, skip initially.
- If SSR/OG previews come later (link previews), `theme-color` meta can be set from the primary colour (`<meta name="theme-color">` updated client-side).
**Confidence**: Medium-High.

## F5. Curated presets vs free picker vs seed+auto

**Sources**: Radix Themes offers a fixed accent list plus a separate "custom palette" generator from a couple of colours — https://www.radix-ui.com/themes/docs/theme/color , https://www.radix-ui.com/colors/custom ; Material You derives entire schemes from one seed with a `contrastLevel` knob — https://github.com/material-foundation/material-color-utilities . (SaaS-specific UX benchmarks — Linktree, Shopify colour schemes, Luma, Calendly — are covered by the `external-saas` gatherer.)
Recommended layered UX (Medium-High):
1. **Default view: 8–12 curated presets** (swatch cards rendered with the real generator, incl. 1–2 dark ones) — zero chance of failure, one click, also good free-tier content.
2. **"Custom" tab: one primary picker (+ optional accent)** with hex input + eyedropper; everything else derived (F2/F3 of palette file); live contrast badge (AA pass / auto-adjusted).
3. **No per-token pickers** for organizers (that is the "paid custom layout"/pro-designer territory if ever).
4. **Live preview** = render the real page component inside the same `OrgThemeScope` with draft settings (scoped CSS vars make this cheap; see chakra-v3-mechanism F3/F6) plus a mini-preview of term/product page cards, since those pages only change colours.
5. Store `presetId` when a preset is chosen (lets you re-tune presets globally later) and seeds when custom.
**Confidence**: Medium (UX recommendation grounded in cited systems).

## Sources
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html
- https://www.yatil.net/blog/wcag-3-is-not-ready-yet
- https://culorijs.org/api/
- https://gka.github.io/chroma.js/
- https://yomotherboard.com/question/how-can-i-prevent-flicker-from-dynamic-css-variables-in-a-single-page-app/
- https://blog.openreplay.com/theme-switcher-css-variables/
- https://www.mintlify.com/mui/material-ui/customization/css-theme-variables
- https://www.radix-ui.com/themes/docs/theme/color
- https://www.radix-ui.com/colors/custom
- https://github.com/material-foundation/material-color-utilities
