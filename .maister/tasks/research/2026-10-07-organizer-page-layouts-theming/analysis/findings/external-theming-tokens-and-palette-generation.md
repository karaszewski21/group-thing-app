# External / Theming — Token layering & generating a palette from 1–2 seed colours

Category: external-theming · Gathered 2026-10-07
Sub-questions: SQ4 (palette derivation), SQ3 (what to store), SQ6 (seed vs picker)

---

## F1. Three-tier token architecture (primitive → semantic → component) is the industry norm and maps 1:1 onto Chakra v3

**Sources**: Design Tokens Format Module 2025.10 (first stable DTCG spec, 28 Oct 2025) — https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/ , announcement https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ ; Chakra v3 tokens vs semanticTokens — https://chakra-ui.com/docs/theming/semantic-tokens
- **Primitive** (raw scale): `org.50 … org.950` (+ optional `orgAccent.*`, neutral `orgGray.*`). Chakra `tokens.colors`.
- **Semantic** (role): `org.solid/contrast/fg/muted/subtle/emphasized/focusRing/border` + page roles (`page.bg`, `surface`, `text`, `textMuted`, `line`). Chakra `semanticTokens.colors`, alias syntax `{colors.org.600}`.
- **Component**: recipes reference only semantic/virtual tokens (`colorPalette.solid`). Layout presets should also reference only semantic roles → a layout never hard-codes a hue.
DTCG 2025.10 adds theming/multi-brand, aliases and OKLCH/Display-P3 colour values — useful if the token file is ever exported to Figma/Style Dictionary, but **not needed at runtime** here.
**Implication for storage (SQ3)**: persist only the *inputs* (seed hex(es) + preset id + appearance + schema version), never the 19+ derived values; derive on the client (and/or server for validation). Keeps the DB small and lets the algorithm be improved later without migrating data.
**Confidence**: High (spec + docs); storage implication = recommendation.

## F2. Generate scales in OKLCH (perceptually uniform), anchored on the seed, with chroma taper at the ends

**Sources**: Tailwind v4 default palette is authored in OKLCH — https://tailwindcss.com/docs/colors ; generator write-ups https://66colorful.com/tools/tailwind-scale-generator , https://dev.to/okabrionz/universal-oklch-color-system-blueprint-one-base-color-design-tokens-3639
Reference lightness/chroma curve (Tailwind v4, quoted):
| step | blue L / C | emerald L / C |
|---|---|---|
| 50 | 97% / 0.014 | 97.9% / 0.021 |
| 100 | 93.2% / 0.032 | 95% / 0.052 |
| 200 | 88.2% / 0.059 | 90.5% / 0.093 |
| 300 | 80.9% / 0.105 | 84.5% / 0.143 |
| 400 | 70.7% / 0.165 | 76.5% / 0.177 |
| 500 | 62.3% / 0.214 | 69.6% / 0.17 |
| 600 | 54.6% / 0.245 | 59.6% / 0.145 |
| 700 | 48.8% / 0.243 | 50.8% / 0.118 |
| 800 | 42.4% / 0.199 | 43.2% / 0.095 |
| 900 | 37.9% / 0.146 | 37.8% / 0.077 |
| 950 | 28.2% / 0.091 | 26.2% / 0.051 |
Pattern: fixed-ish L ladder (~97 → ~27%), chroma peaks around 400–700 and tapers to ~5–10% of max at 50/950; hue held (small drift allowed). Recommended algorithm:
1. Parse seed → OKLCH `(L0, C0, H0)`.
2. Pick anchor step whose target L is closest to `L0` (don't force seed into 500 — a pale seed becomes 200, a dark one 800).
3. For each step: `L = ladder[step]` (shift ladder slightly so anchor hits `L0` exactly), `C = C0 * taper(step)`, `H = H0`.
4. Gamut-map to sRGB (`toGamut('rgb','oklch')` / `clampChroma`), output hex.
Libraries: **culori** (`oklch`, `formatHex`, `toGamut`, `clampChroma`, `wcagContrast`, `wcagLuminance`, `interpolate`; tree-shakeable `culori/fn`) — https://culorijs.org/api/ ; alternatives chroma-js (`chroma.scale`, `chroma.contrast`, has `oklch` mode) https://gka.github.io/chroma.js/ , colorjs.io (heaviest, most complete, includes APCA).
**Confidence**: High for curve data & lib APIs; Medium for exact taper constants (tune visually).

## F3. Material Color Utilities (HCT) — contrast-by-construction alternative

**Sources**: https://github.com/material-foundation/material-color-utilities (npm `@material/material-color-utilities`: `argbFromHex`, `Hct`, `themeFromSourceColor`, `applyTheme`, `TonalPalette`, `SchemeTonalSpot`, `DynamicScheme` with `contrastLevel` −1…1) — https://api.flutter.dev/flutter/package-material_color_utilities_scheme_scheme_tonal_spot/SchemeTonalSpot-class.html ; HCT tone guarantee — https://developer.android.com/agents/skills/xr/display-glasses-with-jetpack-compose-glimmer/references/material-hct-source
Key property: HCT "tone" = CIE L*; **tone difference ≥ 40 ⇒ contrast ≥ 3:1; ≥ 50 ⇒ ≥ 4.5:1**. So `TonalPalette.fromHct(seed).tone(t)` gives tones 0–100 at constant hue/chroma, and a token mapping such as `solid = tone 40`, `contrast = tone 100`, `fg = tone 30`, `subtle = tone 95`, `muted = tone 90` is WCAG-AA by construction regardless of seed.
Trade-offs vs F2: MCU deliberately *reshapes* the seed (chroma normalised, seed hue not necessarily at any step) → brand colour may not appear exactly; bundle larger than culori; Material-flavoured output. Good fallback idea to borrow: **define token roles by lightness distance, not by step index**.
**Confidence**: High (tone rule is documented in the library source); Medium for bundle comparison (not measured).

## F4. Radix Colors — 12-step *functional* scale and seed-based custom palette

**Sources**: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale , https://www.radix-ui.com/colors/custom , https://www.radix-ui.com/themes/docs/theme/color , open-source port `radix-theme-generator` (`generateRadixColors({ appearance, accent, gray, background })`) https://unpkg.com/radix-theme-generator@0.1.1/README.md
Step semantics (quoted): 1–2 app/subtle backgrounds; 3–5 component bg normal/hover/pressed; 6–8 borders (subtle, interactive, strong + focus ring); 9–10 solid bg + hover ("highest chroma"); 11 low-contrast text; 12 high-contrast text. "Steps 11 and 12 are guaranteed to Lc 60 and Lc 90 APCA contrast … on top of a step 2 background from the same scale." The custom generator takes **accent + gray + background** (i.e. 2–3 seeds) and outputs `--accent-1..12`, `--accent-contrast`, `--accent-surface`, `--accent-indicator`, `--accent-track`, plus a matching tinted gray — a direct precedent for "organizer picks 1–2 colours, system derives everything, including light/dark".
Mapping Radix → Chakra semantic keys (proposal): `subtle≈3`, `muted≈4`, `emphasized≈5`, `border≈7`, `focusRing≈8`, `solid≈9`, `fg≈11`, text≈12, `contrast` = white/black chosen by contrast.
**Confidence**: High (docs quoted); mapping = Medium (judgement).

## F5. What "1–2 seeds" should mean for this product

Synthesis of F2–F4 (recommendation, Medium confidence):
- **primary** (required) → `org.*` scale + Chakra palette semantic keys; buttons, links, active states, header band.
- **accent** (optional; default = derived, e.g. hue+150° or the seed's analogous with lower chroma) → `orgAccent.*`; badges, highlights, "available spots" chips. Existing columns `primary_color` / `accent_color` (String(7)) already match this two-seed model.
- **neutral** → derived: seed hue with very low chroma (C≈0.01–0.02) for page bg/surfaces/lines — gives each organizer a tinted cream/grey like the current mint-cream look (`#f4f8f0`).
- **appearance** light | dark (generator input; dark = invert ladder, reduce chroma of large surfaces).
- Persist: `{ version: 1, presetId?: "mint", primary: "#1b8168", accent?: "#a9c24f", appearance: "light" }`.

## Sources
- https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
- https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- https://chakra-ui.com/docs/theming/semantic-tokens
- https://tailwindcss.com/docs/colors
- https://66colorful.com/tools/tailwind-scale-generator
- https://dev.to/okabrionz/universal-oklch-color-system-blueprint-one-base-color-design-tokens-3639
- https://culorijs.org/api/
- https://gka.github.io/chroma.js/
- https://github.com/material-foundation/material-color-utilities
- https://api.flutter.dev/flutter/package-material_color_utilities_scheme_scheme_tonal_spot/SchemeTonalSpot-class.html
- https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- https://www.radix-ui.com/colors/custom
- https://www.radix-ui.com/themes/docs/theme/color
- https://unpkg.com/radix-theme-generator@0.1.1/README.md
