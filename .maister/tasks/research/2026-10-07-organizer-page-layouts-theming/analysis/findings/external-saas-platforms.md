# External SaaS — how platforms handle layouts, colors, and paid themes

Category: external-saas · Gathered 2026-10-07 · Method: WebSearch + WebFetch (official help/dev docs preferred; third-party blogs flagged).

Confidence: **High** = official doc fetched and quoted; **Medium** = official doc seen in search snippet or a reputable secondary source; **Low** = third-party blog / inference.

---

## 1. Shopify Online Store 2.0 (themes, sections, color schemes, paid themes)

### 1.1 Settings split: schema vs data, with presets
- `settings_schema.json` declares the settings; `settings_data.json` stores values. `settings_data.json` has `current` (live values), `presets` (**max 5** per theme) and optional `platform_customizations`. **High**
  - Source: https://shopify.dev/docs/storefronts/themes/architecture/config/settings-data-json
  - Key behaviour: when a merchant picks a preset, only **presentational settings** (colors, fonts, checkboxes, ranges) are copied into `current`; **content settings (text, collections) are kept**. File limit 1.5 MB.
- Relevance: the exact pattern we need — "switch style, keep content". Layout preset choice should never wipe the organizer's bio/links/etc.

### 1.2 Color schemes (`color_scheme_group` + `color_scheme`)
- `color_scheme_group` in `settings_schema.json` defines a *set of color roles* (`definition`: array of `color` / `color_background` inputs) and a `role` map used for the editor's preview swatch: `background`, `text`, `primary_button`, `on_primary_button`, etc. A section picks one via a `color_scheme` setting (`"default": "scheme_1"`). **High**
  - Source: https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings
  ```json
  "role": {
    "background": { "solid": "background", "gradient": "background_gradient" },
    "text": "text",
    "primary_button": "button",
    "on_primary_button": "button_label"
  }
  ```
- Theme Store requirement: "All background color settings must include a corresponding foreground color setting"; minimum 4 colors. **High** — https://shopify.dev/docs/storefronts/themes/store/requirements
- Implementation in Dawn/Horizon (from public theme code, not fetched this session): each scheme renders as a CSS class `.color-scheme-N { --color-background: …; --color-foreground: …; --color-button: … }` and sections add the class. **Medium** (prior knowledge of Dawn source).
- Relevance: **role-based palette** (bg/fg/primary/on-primary) → CSS variables, applied by class/scope. Maps 1:1 to Chakra semantic tokens.

### 1.3 Layout = JSON template of sections/blocks
- JSON templates: `sections` (id → `{type, settings, blocks, block_order}`) + `order` array; limit 25 sections/template, 50 blocks/section. **High**
  - Source: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Horizon (2025) uses nested "theme blocks" (up to 8 levels) and ships **10 design presets** (Fabric, Dwell, Heritage, Pitch…) as starting points. **Medium** — https://themes.shopify.com/themes/horizon/styles/horizon , secondary: https://gempages.net/blogs/shopify/shopify-horizon-themes
- Relevance: a "layout" can be expressed as **data** (ordered list of section types + per-section settings) rather than code; a preset is just a seed JSON. For our MVP (5 fixed layouts) a full section editor is overkill, but the data shape lets paid/custom layouts later be "another JSON document" rather than a new React page.

### 1.4 Paid themes: preview-before-buy, licensing, versioning
- Merchants can **try up to 19 paid themes** simultaneously (label "Theme trial"), fully customize in the editor (no code editing), and **customizations are saved when they purchase**. **High** — https://help.shopify.com/manual/online-store/themes/adding-themes
- Purchase = **one-time, per-store license**, final sale. Theme switching keeps products (data lives in admin), but theme-specific customizations don't transfer between different themes. **High** (same source)
- Versioning: Theme Store themes must carry a **version number + release notes**. **High** — https://shopify.dev/docs/storefronts/themes/store/requirements
- Auto-update only if theme files are unmodified (excluding `settings_data.json` and `/templates/*.json`); **editor settings are preserved across updates**, custom code isn't. **Medium-High** — https://shopify.dev/docs/storefronts/themes/store/success/updates (search snippet)
- Relevance: (a) "try in editor, can't publish until paid" is the established preview pattern; (b) separate **template version** from **user settings** so a template update doesn't destroy settings.

---

## 2. Squarespace 7.1 (one template engine, palette → color themes)

- Every site uses a **5-color palette** (lightest → darkest, accent in the middle); most palettes include black and white for text. **High** — https://support.squarespace.com/hc/en-us/articles/205815278-Changing-colors
- Palette sources: **Presets** (curated), **From image** (3 most prominent colors), **From color** (generate complementary palette from one seed), Custom. **High** (same)
- "Every palette has **ten color themes**" (combinations of the 5 colors) applied **per section**; per-theme element tweaks propagate everywhere that theme is used. **High**
- Contrast: "in some cases, text and button colors default to white or black to provide better contrast against the background color". **High**
- Template switching: in 7.1 all templates share one underlying structure; a "template" is just a starting design, there is no template swap — design is changed via styles. **Medium** (secondary: https://www.outfy.com/blog/how-to-change-squarespace-template/ , https://squaremuse.com/blog/71-squarespace-version-most-important-things-to-know)
- Relevance: **seed color → generated palette → a few named "surface themes"** is the easiest editor UX for non-designers; auto black/white on-color is the minimum contrast safeguard.

## 3. Wix

- Wix does not let you swap the template of an existing site; you create a new site from another template. **Low-Medium** (official article URL 404'd; only low-quality secondary sources found). Wix also has a site-wide "theme colors" palette — prior knowledge, **Medium**.
- Relevance: anti-pattern for us — layout must be switchable at any time without content loss (Squarespace 7.1 / Shopify presets show the right model).

## 4. Linktree (closest analogue: single public profile page)

- Design section: browse **curated themes** with **live preview** (right pane on desktop, preview button on mobile). Premium themes marked with a **lightning bolt** are Pro/Premium only. **High** — https://linktr.ee/help/en/articles/5434137-choose-a-theme-for-your-linktree
- Custom theme controls: Background (color free; image/video Pro+), Buttons (shape, fill/outline/shadow), Button & font colors, Fonts. Linktree itself recommends custom over preset theme for brand fit and warns about readability. **High** — https://linktr.ee/help/en/articles/8614125-customizing-your-linktree-design
- Paid design features list: advanced design customization (themes, palettes, backgrounds, fonts, button styles), font color, remove footer, hero profile image, video profile image. **High** — https://linktr.ee/help/en/articles/5434140-an-overview-of-paid-features-available-on-linktree
- Downgrade: official help does not document what happens to an applied premium theme. Third-party: paid-tier features "stop working immediately" on downgrade. **Low** — https://app.unilink.us/blog/linktree-pricing-2026
- Relevance: badge on premium options, preview allowed, gating on use/publish.

## 5. Luma (event/calendar pages)

- **40+ event themes** in categories (Minimal, Quantum, Ambient, Texture, Emoji, Confetti, Pattern, Playful, Seasonal, Holiday). Most themes: **choose a preset color or click the last circle for a custom color**. Fonts from a curated list; Light/Dark display option on supported themes; real-time preview. **High** — https://help.luma.com/p/event-themes-and-customization.md
- Theme color propagates to **event emails, links, buttons and accents**; **calendar-level** emails use the calendar's color setting (separate from per-event theme). **High** (same)
- No premium gating of themes mentioned. **High** (absence in official doc)
- Relevance: (a) "N preset swatches + 1 custom picker" UX; (b) one brand color propagating across the organizer's surfaces (our organizer → term → product pages); (c) a calendar (≈ our organizer) has its own color separate from per-event themes.

## 6. Calendly

- Branding: **Primary color** (buttons & links) and **Text color** via picker or hex in Account → Branding; background color too. Advanced color customization is paid-plan; historically full color control applied to **embeds**, with standalone booking page limited (community feature requests). **Medium** — https://calendly.com/help/how-to-customize-your-embed , https://community.calendly.com/how-do-i-40/feature-request-native-accessibility-and-color-customization-for-standalone-live-booking-links-no-embed-5988
- Relevance: minimal viable theming = 2–3 roles (primary, text, background). Colors are a common paid-tier lever.

## 7. Eventbrite (organizer profile)

- Organizer profile: profile image (1:1), cover image (landscape), description, social links, custom URL; profile "color scheme" can match the logo. **Medium** — https://www.eventbrite.com/blog/?p=17109 (official help returned 403)
- No layout choice; one fixed organizer layout listing upcoming/past events.

## 8. Hi.Events (open-source ticketing — closest feature twin)

- "Homepage Designer" in organizer dashboard with **live preview alongside controls**: logo + cover, **background type** (solid color / blurred cover image), **Accent color** ("buttons, links, and highlights"), **Background color**, **Light/Dark mode** ("picks a sensible default based on your background color, and you can override it"), typography. Published events auto-listed. Images save on upload; style changes require explicit "Save Changes". **High** — https://hi.events/docs/help-center/getting-started/designing-your-organizer-homepage
- Relevance: near-exact blueprint for our editor MVP (accent + background + auto light/dark).

## 9. Carrd

- Plans Free / Pro Lite / Pro Standard / Pro Plus; ~half of templates free, rest **Pro templates**. **Medium** (secondary: https://nocode.mba/articles/carrd-pricing ; https://www.unilink.us/blog/carrd-pricing-2026)
- **7-day free trial of Pro features, no card**. **High** — https://carrd.com/docs/pro/trial , https://carrd.com/pro
- On expiry: sites stay published, Pro features stop working. **Low** (secondary only; official docs silent).

## 10. Beacons

- Free plan has customizable templates + drag-and-drop editor, custom colors/themes/fonts/backgrounds; paid tiers add custom domain etc. **Low** (secondary blogs only: https://stackinfluence.com/beacons-vs-linktree-2026-link-bio-tool-is-best/)

## 11. Meetup

- No dedicated documentation found on group page theming; Meetup group pages offer a fixed layout with cover photo, description, organizers, upcoming/past events, members, photos. **Low** (prior knowledge; no source retrieved). Layout choice/color not customizable to our knowledge.
