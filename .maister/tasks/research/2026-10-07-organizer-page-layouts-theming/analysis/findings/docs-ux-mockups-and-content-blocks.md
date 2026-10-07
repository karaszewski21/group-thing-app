# docs-ux — Mockups, organizer-profile prototype, and candidate content blocks

## M1. `ux-grup/*.png` are GROUP-visualization mockups, not organizer-page layouts
**Source**: viewed `ux-grup/default.png`, `ux-grup/table.png`, `ux-grup/boisko.png`; origin documented in `.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/context/README.md` and `outputs/product-brief.md:83-90`.

| Mockup | Caption (visible) | Structure |
|---|---|---|
| default.png (koło/mandala) | "Wszyscy równi wobec siebie. Tak wygląda sala podczas zajęć." | Organizer avatar (dark circle, music-note icon) "Kasia Wójcik — prowadzi zajęcia" in center; 8 family avatars (initials WI/NO/LE/KO/ZI/MA/KA/DĄ, shades of green/teal/lime) on a ring joined by spokes; dashed "+" slot; small badges "udostępnia rzecz" (lime ⇄) / "przynosi na zajęcia" (teal basket); legend; family card below. |
| table.png (stół) | "Prowadząca u szczytu. Rzeczy leżą na stole — widać, co już jest." | Organizer at head; families around an oval beige table with name labels (Wiśniewscy, Nowakowie…); item chips on the table ("Tamburyn", "2 koce", "Owoce"). |
| boisko.png (boisko) | "Trener przy linii, rodziny w ustawieniu. Plus to ławka rezerwowych." | Organizer "trenerka" at top; families placed on a green football pitch drawing; "+" slot as bench. |

Shared bottom card in all three: family "Rodzina Wiśniewskich / Zosia, 2 lata", pill "wymienię", block "DO WYMIANY W GRUPIE — Książka: Pucio — Odbiór przy najbliższych zajęciach, w środę o 16:30", buttons "Napisz" (outline) and "Biorę" (solid dark green).

Visual language (all three): cream background, serif display font (Fraunces) for names, sans (Karla) body, deep green primary (`~#1B8168`/darker), lime + teal accents, rounded cards, soft pills.

**Implications**:
- These mockups define the **term/group page** (fixed structure that only gets recolored), not the 5 organizer page presets. They are evidence of *which colors a palette must cover*: primary (solid "Biorę" button, avatar fills, organizer center), accent pair (lime = shares item, teal = brings item — semantic markers), surface (cream), card (paper), soft tints (lime-soft card for exchange block), line, ink.
- The lime/teal badges are **semantic** (legend-explained) — if recolored per organizer, legend and icons must stay distinguishable (text/icon already carries meaning per accessibility.md).
- The pitch drawing (green field) is an illustration color; recoloring it with the organizer primary may look wrong — likely keep fixed or derive a muted tint.
- The family/organizer avatar 8-green `PALETTE` (hash-based) would clash with a non-green organizer palette unless derived from the organizer primary (tonal scale).
**Confidence**: High (viewed images + documented origin).

## M2. Organizer public profile prototype already exists: `pages/ProfilMobilny.tsx` (+ `GaleriaZdjec.tsx`)
**Source**: `pages/ProfilMobilny.tsx:1-446` (header comment line 5: "Muzyczna Wioska — profil prowadzącej (układ mobilny)"); `pages/GaleriaZdjec.tsx:1-64`. Root-level prototype, not wired into `src/`.

Sections, in order (`ProfilMobilny.tsx:364-444`):
1. **Hero**: full-bleed cover photo (`HERO_SRC`) with dark shade; top bar "Wróć" + share button (copies profile URL, toast "Link do profilu skopiowany", lines 358-361); overlay title row: round avatar/logo (`AVATAR_SRC`) + `<h1>` name "Rodzinny grajdołek" + tagline "Zajęcia umuzykalniające dla dzieci 0–6 lat · Poznań, Jeżyce".
2. **Stats row** (3 tiles): "Miejsce: Jeżyce" (pin, mint-soft), "Rodziny: 32" (people, teal-soft), "Zobacz: Galeria" (button → gallery, lime-soft) — lines 393-406.
3. **Bio/about**: 2 paragraphs, first-person, with highlighted phrases (`.mv-hl`) — lines 408-420.
4. **"Najbliższe terminy"**: list of upcoming terms, date badge (day + month) + title + "16:30 · Sala nr 2 · zostały 2 miejsca" — lines 422-428 (data lines 325-329).
5. **"Wymiana rzeczy"**: 3 count cards "Oddam 3 / Wymienię 4 / Wypożyczę 0" in mint/lime/teal soft tints — lines 430-441 (data lines 331-335).
6. **Gallery** sub-page: 2-column square grid + lightbox (`GaleriaZdjec.tsx:37-63`).
Tokens: `--cream #F4F8F0, --paper #FFF, --ink #1E2E27, --ink-soft #5C7069, --mint #1B8168, --mint-bright #3FB68F, --mint-soft #D8F0E6, --sage #5D8A63, --sage-soft, --teal #6FB6B8, --teal-soft, --lime #A9C24F, --lime-soft, --line #E2EADF` (lines 10-23) — identical to `src/frontend/src/index.css` `@theme` (lines 22-42). Fonts Fraunces + Karla.

**Implications**:
- This prototype is the best available statement of **what the organizer page should show** and is a natural "Default" preset. It also exposes data gaps: Organization currently stores only `name, slug, primary_color, accent_color` (`src/backend/app/organizations/models.py:76-78`) — tagline, bio, location, cover photo, avatar/logo, gallery, families count do not exist yet (families count / upcoming terms / exchange counts are derivable from groups/terms/listings).
- The palette roles used by the prototype map 1:1 to the existing `@theme` tokens → a theme = an override of those token values.
**Confidence**: High (file read); Medium that the user intends ProfilMobilny as the organizer page (inferred from comment, URL-copy text "muzyczna-wioska.pl/rodzinny-grajdolek", and section content).

## M3. Candidate content-block inventory for organizer page presets
Grounded in M2, P1-P3 (prior tasks) and the 4 use cases (docs-ux-standards-and-docs.md D2). "Data today" = whether data exists in the current model (per docs/prior tasks; backend gatherer to confirm).

| Block | Source evidence | Data today |
|---|---|---|
| Header/hero: name, logo/avatar, cover image, tagline | ProfilMobilny hero | name only; logo/cover/tagline missing |
| Share profile link | ProfilMobilny share; per-term copy-link pattern (P2) | slug exists |
| Stats tiles (location, families count, gallery) | ProfilMobilny stats | partial (derivable counts) |
| About/bio | ProfilMobilny body | missing |
| Groups list (kręgi) with link to nearest term `/:slug/grupa/:groupId` | per-term pages FR-2 redirect resolver | exists (groups, `organizer_slug`) |
| Upcoming terms (date badge, title, place, seats left) | ProfilMobilny "Najbliższe terminy"; per-term URL | terms exist; "seats left"/place need check |
| Item exchange summary (Oddam/Wymienię/Wypożyczę counts) | ProfilMobilny "Wymiana rzeczy"; group exchange-summary endpoint (P1) | derivable from listings |
| Needed items for upcoming terms ("Potrzebne rzeczy") | term page block (P2 mockup) | exists per term |
| Gallery | GaleriaZdjec | missing for organizations (photo infra exists for products via Spaces + moderation) |
| Team/participants visualization (circle/pitch/table) | ux-grup mockups (M1) | exists per group (`layout_mode`) |
| CTA "Zapisz się" / join | term page RSVP CTA (P2) | exists per term |

## M4. Preset ideas implied by evidence (for synthesis; not decided anywhere)
Inference only — no prior doc defines organizer page presets.
- Use-case driven (D2): music/classes studio (ProfilMobilny shape: hero + bio + terms + exchange), sports team/coach (team roster/pitch emphasis, schedule-first), teacher/class (groups list + terms, compact), community exchange (exchange block first, needed items), minimal/link-in-bio (header + buttons to groups/terms).
- Precedent for per-group visual identity (P1) suggests presets should differ in **section order/emphasis and hero treatment**, while reusing the same block components (components.md composability) — i.e. a layout = ordered list of block keys + variant props, which also makes paid custom layouts a data extension rather than new code.
**Confidence**: Low-Medium (synthesis input, not a documented decision).

## M5. Open questions surfaced from docs/mockups
1. Is `pages/ProfilMobilny.tsx` the intended baseline for the organizer page (and "Default" preset)? (Medium-confidence inference.)
2. Which organizer palette applies on `/product/:id` (item owned by a family, opened from term page, panel, or notification)? (P3.)
3. Should semantic accent colors (lime "udostępnia" / teal "przynosi"; item-mode colors) follow the organizer palette or stay fixed?
4. Should the pitch illustration and avatar `PALETTE` be recolored?
5. Organizer without an Organization: default theme everywhere (P2) — confirm.
6. New profile fields (tagline, bio, cover, logo, location, gallery) — in scope for this feature or separate? Text fields fall under synchronous text moderation (architecture.md:63-67 lists "organization name" as a checked field), images under photo moderation.
