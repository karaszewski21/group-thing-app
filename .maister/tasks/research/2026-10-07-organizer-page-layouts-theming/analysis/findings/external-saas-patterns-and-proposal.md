# External SaaS — cross-platform patterns + proposal (5 layouts, editor, paid layouts, data model)

Builds on `external-saas-platforms.md` (citations there). Confidence per item.

---

## A. Layout templates — how many and how they differ

| Platform | # of layouts/themes | What actually differs | Switch without content loss? |
|---|---|---|---|
| Shopify OS 2.0 | ≤5 presets per theme (`settings_data.presets`); Horizon 10 presets | Section order/types + presentational settings | Yes within a theme (presets copy only presentational settings) |
| Squarespace 7.1 | Many "templates" but **one engine** | Starting design only | Template not swappable; styles are |
| Wix | Hundreds | Whole site | No (new site) |
| Linktree | ~dozens curated + custom | Mostly visual (bg, buttons, fonts), **same structure** | Yes |
| Luma | 40+ themes | Visual only (background effect, color, font, light/dark), structure fixed | Yes |
| Hi.Events / Eventbrite / Calendly / Meetup | 1 fixed layout | Colors, cover, logo only | n/a |

**Pattern (High)**: event/booking platforms (Luma, Eventbrite, Calendly, Hi.Events) keep **structure fixed** and vary only visual style. Page builders (Shopify, Squarespace) vary structure via **data-driven section lists**. Our requirement (5 organizer layouts; fixed term/product pages recoloured only) is a hybrid: the organizer page behaves like Shopify presets, term/product pages like Luma/Calendly.

**Pattern (High)**: layout ≠ palette — every platform keeps them as **orthogonal choices** (Shopify: template vs color scheme; Squarespace: layout vs site styles; Luma: theme vs color). Switching one never resets the other.

## B. Color customization UX

1. **Preset swatches + one custom picker** (Luma: "choose a preset color or click the last color circle to pick a custom color"). **High**
2. **Seed color → generated palette** (Squarespace "From color" / "From image"). **High**
3. **Few roles, not dozens of fields**: Calendly = primary + text (+bg); Hi.Events = accent + background + light/dark; Shopify scheme = background/text/button/button-label (+ few). **High**
4. **Role pairs**: every background needs its foreground (Shopify store rule; Squarespace auto white/black for contrast; Hi.Events auto light/dark from bg). **High**
5. **Live preview side-by-side** with controls (Linktree, Hi.Events, Shopify editor, Luma). **High**
6. **Explicit Save/Publish** for style changes (Hi.Events), draft vs current (Shopify `current` vs unpublished themes). **High**
7. One brand color propagates to all organizer surfaces incl. emails (Luma). **High**

→ Recommendation: 8–12 curated palettes (each = a validated role set) + "custom" = pick 1 accent (+ optional background) from which the rest is generated, with auto on-color and WCAG 4.5:1 check (warn/block). Live preview of organizer page with a tab toggle "Organizer / Term / Product" so the user sees the palette on all three surfaces.

## C. Paid themes / premium layouts — gating & lifecycle

| Concern | Observed practice | Source confidence |
|---|---|---|
| Discoverability | Premium items shown inline with a badge (Linktree lightning bolt; Carrd Pro templates) | High / Medium |
| Preview before buy | Shopify: full editor trial of up to 19 paid themes, customizations kept on purchase, can't publish until bought. Carrd: 7-day Pro trial, no card | High |
| Entitlement model | Shopify: one-time **per-store license** for a theme. Linktree/Carrd/Beacons/Calendly: **subscription tier** unlocks a set of themes/features | High / Medium |
| Downgrade | Carrd: site stays live, Pro features stop. Linktree: officially undocumented; secondary sources say paid features stop immediately | Low |
| Versioning | Shopify: theme version + release notes; updates keep editor settings (`settings_data.json`, template JSON) and only overwrite theme code | High / Medium-High |

→ Recommendations:
- **Entitlement table** separate from the layout choice: `organizer_layout_entitlement(organizer_id, layout_key, source=plan|purchase, valid_until)`; free layouts need no row. Supports both Shopify-style one-time purchase and tier-based unlock.
- **Preview-before-buy**: allow selecting a premium layout in the editor in *draft* mode with real data; block *publish* until entitled (Shopify trial model).
- **Downgrade fallback** (no documented industry standard; recommend): keep the stored choice and settings, but **render the free fallback layout** (`fallback_layout_key`, e.g. layout 1) while entitlement is missing — never delete settings, so re-subscribing restores the page. Show a banner in the panel only.
- **Versioning**: store `layout_key` + `layout_version` (or schema version) and the organizer's `settings` JSON; layout code must tolerate older settings (defaults for missing keys) — mirrors Shopify's "settings survive updates".

## D. Data-model patterns

Shopify's split is the reference (High): **definition (schema, code-owned)** vs **values (data, user-owned)**, plus **presets = seed values**.

Suggested shape (per organizer):
```json
{
  "layout": { "key": "classic", "version": 1, "settings": { "showProducts": true, "heroStyle": "cover" } },
  "palette": { "presetKey": "forest", "custom": null, "mode": "light" },
  "schemaVersion": 1
}
```
- Palette stored as **preset key OR custom seed(s)**, not the expanded scale — derived tokens are computed at render (like Squarespace generating 10 themes from 5 colors). Optionally cache resolved roles.
- Layout registry (code): `{ key, name, tier: free|premium, version, settingsSchema (zod/pydantic), defaultSettings, previewImage, Component }`. Backend validates `settings` against a per-layout pydantic schema (allowlist), like Shopify validating against `settings_schema.json`.
- Presets copy **presentational** values only; organizer content (bio, links, images) lives outside `layout.settings` so switching layouts never loses content (Shopify preset rule).

## E. Proposed 5 layouts for an event/group organizer page (recurring terms + lending items)

All share the same content model (name, logo, cover, bio, upcoming terms, groups, lendable items/products, location, contact/socials, gallery); layouts differ in **ordering, emphasis and density**. Rationale draws on Luma (calendar-first), Linktree (mobile link-stack), Eventbrite/Meetup (profile + event list), Shopify (catalog grid), Squarespace (editorial hero).

| # | Key | Name (PL suggestion) | Best for | Structure |
|---|---|---|---|---|
| 1 | `classic` | Klasyczny (default / fallback) | Most organizers | Cover banner + logo + name/bio → "Nadchodzące terminy" list (next 5, CTA "Zapisz się") → items grid → about/location/contact. Eventbrite/Meetup-like. |
| 2 | `calendar` | Kalendarz | High-frequency recurring terms (weekly classes, pitches) | Compact header → **week/month calendar or agenda grouped by day** as hero → filters by group → items in sidebar (desktop) / below (mobile). Luma calendar-like. |
| 3 | `cards` | Kafelki / Grupy | Organizers with many groups/types of activity | Header → **grid of group cards** (image, schedule summary, spots left) → click into group/term → items strip. Shopify collection-grid-like. |
| 4 | `minimal` | Minimalny / Link-in-bio | Small/solo organizers, traffic from Instagram/WhatsApp | Centered single column, avatar, short bio, **stacked big buttons**: next term, all terms, rent items, contact. Mobile-first, Linktree-like. |
| 5 | `showcase` | Wizytówka / Magazyn | Brand-heavy organizers (clubs, studios) | **Full-bleed hero image** with headline + primary CTA → about with photos/gallery → featured terms → featured items → testimonials/stats (attendees, terms held) → contact/map. Squarespace-editorial-like. |

Notes:
- Layout 1 doubles as the **fallback** for expired premium layouts.
- Per-layout settings should stay tiny (2–4 toggles, e.g. show items section, hero style cover/plain, terms count) — "easy editor".
- Future paid layouts = new registry entries (e.g. seasonal/sport-specific, venue map-first, "lending library" catalog-first) gated by entitlement; no change to term/product pages, which only consume palette tokens.

Confidence on the 5-layout proposal: **Medium** (synthesis of observed platform archetypes; not validated with users).

## F. Gaps
- No authoritative source on downgrade behaviour for premium *themes* (Linktree, Carrd, Beacons docs silent) — recommendation in C is design judgement.
- Eventbrite official help blocked (403); Wix official article 404; Meetup undocumented.
- Shopify Dawn CSS-variable implementation cited from prior knowledge, not fetched.
