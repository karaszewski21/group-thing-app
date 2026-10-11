# UI Mockups: D — Zdjęcia organizacji (logo, okładka, galeria)

**Generated**: 2026-10-10
**Task Path**: `.maister/tasks/development/2026-10-10-organization-media-d`
**Feature Type**: Enhancement (public organizer page blocks, appearance editor, admin moderation queue)
**Viewport**: mobile-first, 375px wide. The page column is capped at `max-w-[430px]` by `LayoutRenderer`, and the
editor sheet is capped at `max-w-[430px]` by `EditorSheet`.

Legend used in every diagram (same as task B):

```
[NEW]    new component / block / file
[MOD]    existing file that is modified
[REUSE]  existing component used as-is
###      image / photo area           ░░░  skeleton shimmer / upload in progress
┄┄┄      dashed (ghost / empty slot) border
(RG)     initials circle (fallback)   (@)  logo image in a circle
```

All colors are role tokens from `src/frontend/src/index.css` (`bg-primary`, `bg-primary-soft`, `text-primary-fg`,
`text-on-primary`, `bg-cream`, `bg-paper`, `text-ink`, `text-ink-soft`, `border-line`, `bg-danger-soft`,
`text-danger`, `--color-scrim`). No hex. Owner and visitor copy is Polish. Admin copy is English (the admin
panel is English today).

---

## Overview

### UI Requirements
- **Logo** replaces the initials circle in all three hero variants (`cover`, `compact`, `centered`).
- **Cover** is the background of the `cover` hero variant (layouts CLASSIC and CIRCLES). With no approved cover, or
  when the image fails to load, the band stays `bg-primary` as today.
- **Gallery** block (APPROVED photos only, max 3) in all 5 layouts. Visitors see nothing when it is empty. The owner
  sees a ghost with the CTA "Dodaj zdjęcia →", which opens the editor on the new "Zdjęcia" tab.
- **Editor**: a third tab "Zdjęcia" in `EditorSheet` with sections Logo, Okładka and Galeria. Uploads, deletes and
  reorders save immediately. They are not part of the draft, the Zapisz / Anuluj buttons or the unsaved-changes guard.
- **Per-photo states**: empty, uploading, W weryfikacji (PENDING / NEEDS_REVIEW, shown next to the still-public
  approved one), approved, rejected (note + Usuń, not counted toward the limit), storage unavailable (409),
  validation errors (format, 15 MB, duplicate, limit).
- **Admin**: the moderation card labels organization media `Organization · {name} · {kind}`.

### Integration Strategy
**Decision**: Everything public renders through the existing `LayoutRenderer` pipeline: one new `BlockId`
(`gallery`), one new block file, one new `GHOST_COPY` entry, and image support inside `HeroBlock`. Management sits in
the editor the owner already opens from the settings icon. The tab reuses the row pattern from
`ItemGalleryEditor` (48px thumb, `ModerationBadge`, up/down, trash) and the immediate-save model of the product
photo editor and the profile avatar.
**Rationale**: The owner already looks for "how my page looks" behind the settings icon. Photos are part of the
look, but they save on their own (moderation is asynchronous), which is exactly how product photos and avatars
already behave. No new page, no new panel route, no new layout system.

**Gallery position rule**: in every layout the `gallery` slot goes **directly after `about`**. One rule for all
five layouts. Gallery is never the primary slot, so it never triggers `EmptyStateBlock`.

---

## Existing Layout Analysis

### Application Structure
- `pages/organizer/PublicOrganizationPage.tsx` [MOD]: `PageFrame` → `OrganizerThemeScope` → owner settings bar (gear
  button, `aria-label="Edytuj wygląd"`, sets `?edit=1`) → `LayoutRenderer` → `EditorSheet` when `?edit=1`.
  It renders the **public** response (`usePublicOrganization`), so the hero and gallery show APPROVED media only,
  for the owner too. Owner media with statuses come from `useMyOrganization()` (`/mine`), and only the Zdjęcia tab reads them.
- `pages/organizer/LayoutRenderer.tsx` [MOD]: `BLOCKS` map, owner ghost when `isEmpty`, `max-w-[430px]` column.
  `about` currently has `Component: null` (ghost for the owner, nothing for visitors).
- `pages/organizer/layouts/types.ts` [MOD] (`BlockId` + `"gallery"`), `layouts/registry.ts` [MOD] (slot per layout).
- `pages/organizer/blocks/HeroBlock.tsx` [MOD]: `cover` = `bg-primary` band + 64px initials ring,
  `compact` = paper bar + 56px initials, `centered` = 80px initials. All initials spans are `aria-hidden`.
- `pages/organizer/blocks/GhostBlock.tsx` [MOD]: dashed frame + `EyeIcon`, CTA is a router `Link`.
- `pages/organizer/editor/EditorSheet.tsx` [MOD]: `type Tab = "uklad" | "kolory"`, pill tablist with roving focus
  (`rovingIndex.ts`), panel `max-h-[55vh] overflow-y-auto`, footer Anuluj / Zapisz (draft only), `role="alert"` error box.
- `pages/organizer/editor/ColorsTab.tsx` [REUSE pattern]: `SECTION_LABEL` section headings (`text-xs font-extrabold tracking-wide`).
- `pages/product/ItemGalleryEditor.tsx` [REUSE]: `ModerationBadge`, `PhotoFileField`, row layout, up/down focus
  restore after a move, `busy` disables every control.
- `pages/product/ItemGallery.tsx` `SafeImage` [REUSE]: falls back to `PhotoPlaceholder` on a bad URL or load error.
- `pages/product/itemPageShared.ts` [REUSE]: `ACCEPTED_PHOTO_TYPES`, `MAX_PHOTO_BYTES` (15 MB), `photoFileError`.
- `pages/panel/views/ProfilView.tsx` [REUSE pattern]: per-status note under the image (`AVATAR_STATUS_NOTE`),
  "Zmień zdjęcie" / "Usuń" buttons, `role="alert"` error line.
- `components/moderation/PhotoModerationCard.tsx` [MOD] + `api/moderation.ts` [MOD]: title derived from `subject_type`.

### Identified Patterns
- **Section heading (page)**: `px-6 pt-6`, `font-serif text-lg font-semibold text-ink`.
- **Section label (editor)**: `SECTION_LABEL` from `ColorsTab` (`text-xs font-extrabold tracking-wide text-ink-soft`, not exported yet, not uppercase). Diagrams write section labels in capitals only to make them stand out; the real copy is "Logo", "Okładka", "Galeria".
- **Photo row (editor)**: `rounded-2xl border border-line bg-cream p-2`, 48px `SafeImage rounded-xl`, 30px icon buttons.
- **Status badge**: `rounded-full px-2 py-0.5 text-[10.5px] font-extrabold`; pending `bg-cream text-ink-soft`,
  rejected `bg-danger-soft text-danger`.
- **Immediate-save editor**: errors as `<p role="alert" class="text-[12.5px] font-semibold text-danger">`,
  every control disabled while a call and its refetch are pending.
- **Ghost**: `rounded-2xl border-[1.5px] border-dashed border-line text-ink-soft` + `EyeIcon` + "Widzisz to tylko Ty."
- **Touch targets**: at least 44px (`min-h-[44px]`), `focus-visible:outline-focus-ring`.

---

## Mockups

<a id="hero-media"></a>
### Mockup 0: Hero with logo and cover (`component:hero-media`)

**Context**: `HeroBlock.tsx` [MOD]. The public response gains `logo` and `cover` (`{ url, thumb_url } | null`,
APPROVED only). The logo uses `thumb_url`, the cover uses `url`.

```
 cover variant, cover + logo (CLASSIC, CIRCLES)       cover variant, no cover (fallback = today)
 ┌─────────────────────────────────────┐              ┌─────────────────────────────────────┐
 │#####################################│              │█████████████████████████████████████│
 │########  cover photo  ##############│ object-cover │█ (@)                                 │ logo still
 │##(@)################################│ absolute     │█ Rodzinny Grajdołek                  │ replaces
 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ scrim        │█ domena.pl/rodzinny-grajdolek        │ initials
 │▓ Rodzinny Grajdołek ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ gradient     │█████████████████████████████████████│
 │▓ domena.pl/rodzinny-grajdolek ▓▓▓▓▓▓│ (bottom)     └─────────────────────────────────────┘
 └─────────────────────────────────────┘              bg-primary band; (RG) when no logo either
 header: relative, bg-primary (shows while the image loads or if it fails)
 <img> cover: absolute inset-0 h-full w-full object-cover, alt="" (decorative), onError → hidden (band stays)
 ▓ overlay: bg-gradient-to-t from-scrim to-transparent, text stays text-on-primary → check 4.5:1 on light photos
 (@) logo: h-16 w-16 rounded-full border-2 border-on-primary object-cover bg-paper, alt="" (name is the <h1>)

 compact variant (SCHEDULE, EXCHANGE)                  centered variant (LINKS)
 ┌─────────────────────────────────────┐              ┌─────────────────────────────────────┐
 │ (@)  Rodzinny Grajdołek [Udostępnij]│              │                (@)                  │ h-20 w-20
 │ 56px domena.pl/rodz…                │              │                                     │ rounded-full
 └─────────────────────────────────────┘              │        Rodzinny Grajdołek           │ object-cover
 h-14 w-14 rounded-full object-cover                  │   domena.pl/rodzinny-grajdolek      │
 no cover here (no room in a top bar)                 └─────────────────────────────────────┘
```

**Integration Points**:
- One small inner helper (e.g. `HeroLogo`) renders `<img>` when `logo` is set and the existing initials span otherwise,
  with the same size classes per variant. On image error it falls back to initials (same idea as `SafeImage`, but the
  fallback is the initials, not `PhotoPlaceholder`).
- The comment "`cover` has no image yet" in `HeroBlock` goes away.
- The owner never sees pending media in the hero (decision I-9). The hero always shows what visitors see.

---

<a id="gallery-block"></a>
### Mockup 1: Gallery block (`component:gallery-block`)

**Context**: `blocks/GalleryBlock.tsx` [NEW], `BlockId` `"gallery"`, variant `grid`. Data: `data.organization.gallery`
(APPROVED only, ordered by `sort_order`). Not a `directory` block, so it gets no skeleton and no unavailable handling.
`isGalleryEmpty(data)` makes the renderer hide it for visitors and show the ghost for the owner.

```
 3 photos: grid-cols-3 gap-2, square          2 photos: grid-cols-2, square           1 photo: full width 4:3
 ┌─────────────────────────────────────┐      ┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
 │ Galeria                             │      │ Galeria                             │  │ Galeria                             │
 │ ┌─────────┐ ┌─────────┐ ┌─────────┐ │      │ ┌────────────────┐┌────────────────┐│  │ ┌─────────────────────────────────┐ │
 │ │#########│ │#########│ │#########│ │      │ │################││################││  │ │#################################│ │
 │ │#########│ │#########│ │#########│ │      │ │################││################││  │ │#################################│ │
 │ │#########│ │#########│ │#########│ │      │ │################││################││  │ │#################################│ │
 │ └─────────┘ └─────────┘ └─────────┘ │      │ └────────────────┘└────────────────┘│  │ └─────────────────────────────────┘ │
 └─────────────────────────────────────┘      └─────────────────────────────────────┘  └─────────────────────────────────────┘
 <section aria-label="Galeria" class="px-6 pt-6">, heading font-serif text-lg (same as other sections)
 <ul> of <li><SafeImage src={thumb_url} alt="{name} — zdjęcie N z M" class="aspect-square w-full rounded-2xl"/></li>
 Images are not interactive (no lightbox in scope). Thumb rendition is enough for a ≤ 1/3 column tile; the
 single-photo case uses `url`.
```

**Component Reuse**: `SafeImage` (`pages/product/ItemGallery.tsx`) for every tile (placeholder on error).

---

<a id="layout-classic"></a>
### Mockup 2: CLASSIC "Klasyczny", visitor, with logo, cover and gallery (`screen:layout-classic-media`)

```
┌─────────────────────────────────────┐ 375px
│#####################################│ HeroBlock cover [MOD]: cover photo + scrim
│##(@)################################│ logo 64px ring
│▓ Rodzinny Grajdołek ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓ domena.pl/rodzinny-grajdolek ▓▓▓▓▓▓│
│ [ Udostępnij ]                      │ ShareBlock [REUSE]
│ ┌─────────┐┌─────────┐┌─────────┐   │ StatsBlock [REUSE]
│ │ 3 grupy ││9 terminów││32 rodzin│   │
│ └─────────┘└─────────┘└─────────┘   │
│                                     │ about: nothing for visitors (Component null)
│ Galeria                             │ GalleryBlock grid [NEW]  ← slot after `about`
│ ┌───────┐ ┌───────┐ ┌───────┐       │
│ │#######│ │#######│ │#######│       │
│ └───────┘ └───────┘ └───────┘       │
│ Najbliższe terminy                  │ UpcomingTermsBlock list (primary) [REUSE]
│ ┌──┐ Muzyczne Maluchy             > │
│ └──┘ wt · 16:30 · zapisanych: 8     │
│ Wymiana rzeczy  (tiles3)            │ ExchangeCountsBlock [REUSE]
│ footer                              │ FooterBlock [REUSE]
└─────────────────────────────────────┘
registry CLASSIC: hero:cover, share, stats, about, gallery:grid, upcoming-terms:list*, exchange-counts, footer
```

<a id="layout-circles"></a>
### Mockup 3: CIRCLES "Grupy", visitor (`screen:layout-circles-media`)

```
┌─────────────────────────────────────┐
│#####################################│ HeroBlock cover [MOD] (cover + logo)
│##(@)################################│
│▓ Klub Orlik ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ [ Udostępnij ]                      │ ShareBlock
│ Nasze grupy                         │ CirclesGridBlock cards / featured (primary)
│ ┌─────────────────────────────────┐ │
│ │ Orliki 2017 · zapisanych: 12  > │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ Młodziki 2015 · 4 terminy     > │ │
│ └─────────────────────────────────┘ │
│ Galeria                             │ GalleryBlock [NEW] (after about)
│ ┌────────────────┐┌────────────────┐│ 2 approved photos → 2 columns
│ │################││################││
│ └────────────────┘└────────────────┘│
│ Wymiana rzeczy (tiles3)             │
│ footer                              │
└─────────────────────────────────────┘
registry CIRCLES: hero:cover, share, circles-grid:cards|featured*, about, gallery:grid, exchange-counts, footer
```

<a id="layout-schedule"></a>
### Mockup 4: SCHEDULE "Plan zajęć", visitor (`screen:layout-schedule-media`)

```
┌─────────────────────────────────────┐
│ (@) Rodzinny Grajdołek [Udostępnij] │ HeroBlock compact [MOD]: logo 56px, no cover
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │ NextTermCtaBlock [REUSE]
│ │ NAJBLIŻSZE ZAJĘCIA  14 paź 17:00│ │
│ │ [  Zobacz i zapisz się  →     ] │ │
│ └─────────────────────────────────┘ │
│ Plan zajęć                          │ AgendaBlock by-day (primary) [REUSE]
│ WTOREK, 14 PAŹDZIERNIKA ─────────── │
│ │ 17:00 Orliki 2017            >  │ │
│ [   Pokaż kolejne terminy   ]       │
│ Galeria                             │ GalleryBlock [NEW] (after about)
│ ┌───────┐ ┌───────┐ ┌───────┐       │
│ │#######│ │#######│ │#######│       │
│ └───────┘ └───────┘ └───────┘       │
│ Wymiana rzeczy (tiles3)             │
│ footer                              │
└─────────────────────────────────────┘
registry SCHEDULE: hero:compact, next-term-cta, agenda:by-day*, about, gallery:grid, exchange-counts, footer
```

<a id="layout-exchange"></a>
### Mockup 5: EXCHANGE "Wymiana", visitor (`screen:layout-exchange-media`)

```
┌─────────────────────────────────────┐
│ (@) Szafa Sąsiedzka    [Udostępnij] │ HeroBlock compact [MOD]: logo, no cover
├─────────────────────────────────────┤
│ (Wszystko 14)(Oddam 6)(Zamienię 5)… │ ExchangeCounts tabs + ExchangeBoard grid2 (primary)
│ ┌────────────────┐┌────────────────┐│
│ │ ##  Kurtka 104 ││ ##  Rowerek    ││
│ └────────────────┘└────────────────┘│
│ Potrzebne rzeczy                    │ NeededItemsBlock
│ Najbliższe spotkania (chips)        │ UpcomingTermsBlock compact
│ Galeria                             │ GalleryBlock [NEW] (after about)
│ ┌─────────────────────────────────┐ │ 1 approved photo → full width 4:3
│ │#################################│ │
│ └─────────────────────────────────┘ │
│ footer                              │
└─────────────────────────────────────┘
registry EXCHANGE: hero:compact, exchange-board:grid2*, needed-items, upcoming-terms:compact, about, gallery:grid, footer
```

<a id="layout-links"></a>
### Mockup 6: LINKS "Wizytówka", visitor (`screen:layout-links-media`)

```
┌─────────────────────────────────────┐ frame: centered (from-primary-soft to-cream)
│                 (@)                 │ HeroBlock centered [MOD]: logo 80px, no cover
│         Rodzinny Grajdołek          │
│    domena.pl/rodzinny-grajdolek     │
│ [      Najbliższe zajęcia         ] │ LinkStackBlock (primary) [REUSE]
│ [      Wszystkie terminy (9)      ] │
│ [      Wymiana rzeczy (14)        ] │
│ Galeria                             │ GalleryBlock [NEW] (after about), same px-6 grid
│ ┌───────┐ ┌───────┐ ┌───────┐       │ heading stays left-aligned (section), not centered
│ │#######│ │#######│ │#######│       │
│ └───────┘ └───────┘ └───────┘       │
│ footer                              │
└─────────────────────────────────────┘
registry LINKS: hero:centered, link-stack*, about, gallery:grid, footer
```

---

<a id="owner-empty"></a>
### Mockup 7: Empty media: visitor vs owner ghost (`screen:owner-media-empty`, `component:ghost-gallery`)

**Context**: the organization has no approved logo, cover or gallery photo. Pending photos do not change this view
(the page renders the public response).

```
 VISITOR (CLASSIC)                                  OWNER (CLASSIC, same data)
 ┌─────────────────────────────────────┐            ┌─────────────────────────────────────┐
 │█████████████████████████████████████│            │                               [⚙]  │ settings bar (gear) [REUSE]
 │█ (RG)                               │ initials,  │█████████████████████████████████████│
 │█ Rodzinny Grajdołek                 │ primary    │█ (RG)                               │ hero unchanged: no ghost
 │█ domena.pl/rodzinny-grajdolek       │ band       │█ Rodzinny Grajdołek                 │ inside the hero
 │█████████████████████████████████████│            │█████████████████████████████████████│
 │ [ Udostępnij ]                      │            │ [ Udostępnij ]                      │
 │ stats …                             │            │ stats …                             │
 │                                     │ about: —   │ ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐ │ about ghost [REUSE]
 │                                     │ gallery: — │ ┆ Opis — wkrótce               👁 ┆ │
 │ Najbliższe terminy                  │ (hidden)   │ └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘ │
 │ …                                   │            │ ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐ │ gallery ghost [NEW copy]
 └─────────────────────────────────────┘            │ ┆ Galeria                      👁 ┆ │
                                                    │ ┆ Dodaj do 3 zdjęć — odwiedzający┆ │
                                                    │ ┆ zobaczą je po sprawdzeniu.     ┆ │
                                                    │ ┆ Widzisz to tylko Ty.           ┆ │
                                                    │ ┆ Dodaj zdjęcia →                ┆ │ CTA → ?edit=1&tab=zdjecia
                                                    │ └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘ │
                                                    │ Najbliższe terminy …                │
                                                    └─────────────────────────────────────┘
```

**Integration Points**:
- `GHOST_COPY.gallery = { title: "Galeria", body: "Dodaj do 3 zdjęć — odwiedzający zobaczą je po sprawdzeniu. Widzisz to tylko Ty.", cta: { label: "Dodaj zdjęcia →", to: "?edit=1&tab=zdjecia" } }`.
  The existing `Link` already handles a search-only `to` (stays on `/:slug`). Pass `replace` so it matches the gear
  button (`setSearchParams(..., { replace: true })`); that needs an optional `replace` on the CTA, or a small
  `onClick` variant. No new route.
- `EditorSheet` reads the initial tab from `?tab=zdjecia` (fallback `uklad`), so the CTA lands on the Zdjęcia tab with
  focus on the sheet title (existing behaviour). Unknown values fall back to `uklad`.
- The ghost shows in every layout (the gallery slot exists in all five).

---

<a id="editor-photos-tab"></a>
### Mockup 8: Editor "Zdjęcia" tab, overview (`screen:editor-photos-tab`)

**Context**: `editor/EditorSheet.tsx` [MOD] adds `{ id: "zdjecia", label: "Zdjęcia" }` to `TABS`
(`Tab = "uklad" | "kolory" | "zdjecia"`, `tabRefs` gets a key). The panel renders `editor/PhotosTab.tsx` [NEW],
outside the `<fieldset disabled={saving}>` draft lock. Data: owner media from `useMyOrganization()`.
Mutations: new hooks (upload / delete / reorder) that invalidate `MY_ORGANIZATION_KEY` and `PUBLIC_ORGANIZATION_KEY`.

```
┌─────────────────────────────────────────┐ EditorSheet, bottom sheet, max-w-[430px]
│ Wygląd strony                      [ X ]│
│ ( Układ ) ( Kolory ) (■Zdjęcia■)        │ tablist: 3 pills, roving arrows (rovingIndex)
│ ┌─────────────────────────────────────┐ │ tabpanel max-h-[55vh] overflow-y-auto
│ │ Zdjęcia zapisują się od razu.       │ │ text-[12px] text-ink-soft
│ │                                     │ │
│ │ LOGO                                │ │ SECTION_LABEL
│ │ ┌─────────────────────────────────┐ │ │
│ │ │ (@)  Na stronie                 │ │ │ photo row (ItemGalleryEditor style)
│ │ │      [Zmień logo]  [Usuń]       │ │ │
│ │ └─────────────────────────────────┘ │ │
│ │                                     │ │
│ │ OKŁADKA                             │ │
│ │ Widoczna w układach Klasyczny i     │ │ text-[12px] text-ink-soft (always shown)
│ │ Grupy.                              │ │
│ │ ┌─────────────────────────────────┐ │ │
│ │ │ ┌──────┐ Na stronie             │ │ │ wide thumb w-20 aspect-video rounded-xl
│ │ │ │######│ [Zmień okładkę] [Usuń] │ │ │
│ │ │ └──────┘                        │ │ │
│ │ └─────────────────────────────────┘ │ │
│ │                                     │ │
│ │ GALERIA                        2/3  │ │ counter = non-rejected count
│ │ ┌─────────────────────────────────┐ │ │
│ │ │ ┌──┐ Zdjęcie 1          ˄ ˅ 🗑 │ │ │ up disabled on first, down on last
│ │ │ └──┘                            │ │ │
│ │ └─────────────────────────────────┘ │ │
│ │ ┌─────────────────────────────────┐ │ │
│ │ │ ┌──┐ Zdjęcie 2 (W weryfikacji) ˄ ˅ 🗑│ │
│ │ │ └──┘                            │ │ │
│ │ └─────────────────────────────────┘ │ │
│ │ [ + Dodaj zdjęcie ]                 │ │ PhotoFileField (single file)
│ │ JPG, PNG lub WebP, do 15 MB.        │ │ hint text-[11.5px] text-ink-soft
│ │ Odwiedzający zobaczą zdjęcia po     │ │
│ │ sprawdzeniu.                        │ │
│ └─────────────────────────────────────┘ │
│ ─────────────────────────────────────── │
│                     [Anuluj]  [Zapisz]  │ footer unchanged: only the Układ/Kolory draft
└─────────────────────────────────────────┘
```

**Integration Points**:
- Photo actions never set `dirty`, never enter `diffDraft`, and never trigger `useBlocker` / `UnsavedChangesDialog`.
  Zapisz / Anuluj stay where they are and still act on the draft only (enabled only when the draft is dirty). The
  line "Zdjęcia zapisują się od razu." tells the owner that photos do not wait for Zapisz.
- Optional extra line under OKŁADKA when the current draft layout has no `cover` hero (SCHEDULE / EXCHANGE / LINKS):
  "W wybranym układzie ({label}) okładka nie jest widoczna." It reads `draft.pageLayout` via `resolveLayout`, so it
  follows the Układ tab live.
- Each section has its own busy flag and its own `role="alert"` line, so an error is shown next to the slot it came
  from. While any photo call is in flight, that section's buttons are disabled (same rule as `ItemGalleryEditor`).
- Polling: while any owner media is PENDING or NEEDS_REVIEW, `useMyOrganization` refetches every 10 s (the
  `useItemDetail` pattern; NEEDS_REVIEW polls too). The refetch also refreshes presigned thumb URLs before they expire.

---

<a id="photo-slot"></a>
### Mockup 9: Logo / Okładka slot, all states (`component:photo-slot`)

**Context**: `PhotoSlot` [NEW] (inner component of `PhotosTab.tsx`), used twice: `kind="LOGO"` (round 48px thumb)
and `kind="COVER"` (16:9 thumb). The slot can hold at most one APPROVED row (public) and one PENDING / NEEDS_REVIEW
row. A REJECTED row shows until it is removed or replaced. Copy below is for the logo, the cover says "okładkę".

```
 S1 empty                                        S2 uploading (aria-busy on the section)
 ┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
 │ ┌┄┄┐ Brak logo — na stronie widać   │         │ ░░░  Wysyłanie…                     │ shimmer thumb,
 │ ┆RG┆ inicjały.                      │         │ ░░░                                 │ no % (fetch has no
 │ └┄┄┘ [ + Dodaj logo ]               │         │      [ + Dodaj logo ] (disabled)    │ upload progress)
 └─────────────────────────────────────┘         └─────────────────────────────────────┘

 S3 first upload, pending                        S4 approved (live)
 ┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
 │ (@)  (W weryfikacji)                │         │ (@)  Na stronie                     │
 │      Odwiedzający zobaczą je po     │         │      [Zmień logo]  [Usuń]           │
 │      sprawdzeniu.                   │         └─────────────────────────────────────┘
 │      [Zmień logo]  [Anuluj]         │         Usuń = delete the approved row → hero falls back to initials
 └─────────────────────────────────────┘         Anuluj = delete the pending row

 S5 approved + new pending (replace flow, both visible)
 ┌─────────────────────────────────────┐
 │ (@)  Na stronie teraz               │  current public logo (APPROVED)
 │      [Usuń ze strony]               │
 │ ─────────────────────────────────── │
 │ (@)  Nowe  (W weryfikacji)          │  pending row
 │      Zastąpi obecne po sprawdzeniu. │
 │      [Zmień]  [Anuluj]              │  Zmień = upload again → replaces the pending row
 └─────────────────────────────────────┘

 S6 rejected (with or without an approved one above it)
 ┌─────────────────────────────────────┐
 │ (@)  Na stronie teraz   [Usuń ze strony]  only when an APPROVED row exists
 │ ─────────────────────────────────── │
 │ (@)  (Odrzucone)                    │  thumb opacity-60, badge bg-danger-soft text-danger
 │      Odrzucone przez moderację —    │  text-[12px] text-ink-soft
 │      dodaj inne zdjęcie.            │
 │      [ + Dodaj logo ]  [Usuń]       │  new upload also clears the rejected row (I-2)
 └─────────────────────────────────────┘

 S7 error lines (under the slot, role="alert", text-danger)
 │ ⚠ Dodawanie zdjęć jest chwilowo niedostępne.        │  409 storage not configured
 │ ⚠ Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP │  client photoFileError (before upload)
 │ ⚠ Zdjęcie jest za duże (maks. 15 MB)                 │  client photoFileError / 413 from server
 │ ⚠ Nie udało się wysłać zdjęcia. Spróbuj ponownie.    │  network / 5xx fallback
```

**Interaction Details**:
1. "+ Dodaj logo" / "Zmień logo" opens the file picker (`PhotoFileField` style label, `accept=ACCEPTED_PHOTO_TYPES`,
   single file). `photoFileError` runs first. An invalid file shows the error and sends nothing.
2. During the POST and its refetch the slot shows S2, all of its buttons are disabled and the section has `aria-busy="true"`.
3. Response PENDING → S3 (first time) or S5 (an approved one exists). With moderation off the server returns APPROVED → S4 directly.
4. The 10 s poll moves the row to S4 (approved: the old approved one is replaced on the public page) or S6 (rejected).
5. Removing a row never asks for confirmation, same as `ItemGalleryEditor` and the avatar. After a delete, focus goes
   to the slot's add / change button.
6. Server 4xx messages (`extractProblemMessage`) are shown verbatim; the strings above are the expected Polish copy.

---

<a id="gallery-editor"></a>
### Mockup 10: Galeria section, all states (`component:gallery-editor`)

**Context**: `GallerySection` [NEW] inside `PhotosTab.tsx`, built from the `ItemGalleryEditor` row markup
(or `ItemGalleryEditor` itself if it gets a configurable limit and hint; see Reusable Components).
Limit = 3 non-rejected photos (`MAX_ORGANIZATION_GALLERY = 3`).

```
 G1 empty                                         G2 mixed states, under limit (2/3)
 ┌─────────────────────────────────────┐          ┌─────────────────────────────────────┐
 │ GALERIA                        0/3  │          │ GALERIA                        2/3  │
 │ Brak zdjęć.                         │          │ ┌──┐ Zdjęcie 1               ˄ ˅ 🗑 │ APPROVED
 │ [ + Dodaj zdjęcie ]                 │          │ ┌──┐ Zdjęcie 2 (W weryfikacji) ˄ ˅ 🗑│ PENDING keeps its place
 │ JPG, PNG lub WebP, do 15 MB.        │          │ [ + Dodaj zdjęcie ]                 │ in the order
 └─────────────────────────────────────┘          └─────────────────────────────────────┘

 G3 at limit (3/3)                                G4 rejected photo (not counted)
 ┌─────────────────────────────────────┐          ┌─────────────────────────────────────┐
 │ GALERIA                        3/3  │          │ GALERIA                        2/3  │
 │ ┌──┐ Zdjęcie 1               ˄ ˅ 🗑 │          │ ┌──┐ Zdjęcie 1               ˄ ˅ 🗑 │
 │ ┌──┐ Zdjęcie 2               ˄ ˅ 🗑 │          │ ┌──┐ Zdjęcie 2               ˄ ˅ 🗑 │
 │ ┌──┐ Zdjęcie 3 (W weryfikacji) ˄ ˅ 🗑│          │ ─────────────────────────────────── │
 │ [ + Dodaj zdjęcie ] (disabled)      │          │ ┌──┐ (Odrzucone)                  🗑 │ below the ordered list,
 │ Osiągnięto limit 3 zdjęć.           │          │      Odrzucone przez moderację —    │ no ˄ ˅ (not in the order)
 └─────────────────────────────────────┘          │      dodaj inne zdjęcie.            │
                                                  │ [ + Dodaj zdjęcie ]                 │ still enabled (2/3)
                                                  └─────────────────────────────────────┘

 G5 uploading                                     G6 errors (role="alert" under the section)
 ┌─────────────────────────────────────┐          │ ⚠ To zdjęcie jest już w galerii.            │ 409 duplicate (sha)
 │ GALERIA                        2/3  │          │ ⚠ Galeria może mieć najwyżej 3 zdjęcia.     │ 409 limit (race)
 │ ┌──┐ Zdjęcie 1               ˄ ˅ 🗑 │          │ ⚠ Kolejność się zmieniła. Odśwież i spróbuj │ 409 stale reorder
 │ ┌──┐ Zdjęcie 2               ˄ ˅ 🗑 │          │   ponownie.                                 │
 │ ┌──┐ ░░░ Wysyłanie…                 │          │ ⚠ Dodawanie zdjęć jest chwilowo niedostępne. │ 409 storage
 │ [ + Dodaj zdjęcie ] (disabled)      │          │ ⚠ Zdjęcie jest za duże (maks. 15 MB)        │ client / 413
 └─────────────────────────────────────┘          │ ⚠ Nieobsługiwany plik — dodaj zdjęcie JPG,  │ client
  all ˄ ˅ 🗑 disabled while busy                   │   PNG lub WebP                              │
                                                  └─────────────────────────────────────────────┘
```

**Interaction Details**:
1. ˄ / ˅ sends `PATCH /api/organizations/{id}/media/order` with the full id list of non-rejected photos, then
   refetches. Focus returns to the same photo's move button (existing `focusAfterMove` logic).
2. Visitors see only APPROVED photos, in `sort_order`. A pending photo keeps its slot in the order and appears on
   the page at that position once approved.
3. "Zdjęcie N" numbering follows the ordered (non-rejected) list. Rejected rows are listed after a divider with the note.
4. Button labels for screen readers: "Przesuń zdjęcie N w górę", "Przesuń zdjęcie N w dół", "Usuń zdjęcie N"
   (existing strings), "Usuń odrzucone zdjęcie" for a rejected row.

---

<a id="badge"></a>
### Mockup 11: Status badge copy (`component:media-status-badge`)

```
 PENDING        → (W weryfikacji)   bg-cream text-ink-soft
 NEEDS_REVIEW   → (W weryfikacji)   bg-cream text-ink-soft      (owner does not see the difference)
 REJECTED       → (Odrzucone)       bg-danger-soft text-danger
 APPROVED       → no badge; slot rows say "Na stronie" / "Na stronie teraz"
```

`ModerationBadge` (`pages/product/ItemGalleryEditor.tsx`) has fixed product labels ("W moderacji", "Do sprawdzenia").
Recommended: add an optional `labels` prop (default = current product map) and pass the organization map. Product
pages stay unchanged.

---

<a id="admin-card"></a>
### Mockup 12: Admin moderation card (`screen:admin-moderation-org-media`, `component:moderation-card-org`)

**Context**: `/admin` photo moderation queue, `components/moderation/PhotoModerationCard.tsx` [MOD]. English copy,
Chakra, layout unchanged. `api/moderation.ts` [MOD]: `subject_type: "PHOTO" | "AVATAR" | "ORGANIZATION_MEDIA"` and a
`media_kind` field (or equivalent) for the kind.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌────────────┐  NEEDS REVIEW                         [Approve] [Reject] [Delete] │
│ │############│  Organization · Rodzinny Grajdołek · Logo                        │ title
│ │###  120  ##│  nsfw 0.41 · neutral 0.55 (vit-nsfw) · 10.10.2026 14:32          │
│ │############│                                                                  │
│ └────────────┘                                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
 Existing titles: PHOTO → "{product_name}", AVATAR → "Avatar · {name}".
 NEW: ORGANIZATION_MEDIA → "Organization · {name} · {kind}", kind ∈ Logo | Cover | Gallery.
 Image alt: "Photo of {title}". Delete dialog: 'Delete this photo of "{title}"? …' (existing template).
 Approve on an APPROVED logo is hidden; Reject on it = takedown → the public hero falls back to initials.
```

**Integration Points**: one more branch in the `title` expression (a small `subject → title` map reads better than a
nested ternary). `PhotoModerationPage.tsx` already passes `entry.subject_type` to decide, so nothing else changes in
the admin UI.

---

## Reusable Components

### Layout
- **LayoutRenderer**: `src/frontend/src/pages/organizer/LayoutRenderer.tsx` [MOD]. Add `gallery: { Component: GalleryBlock, isEmpty: isGalleryEmpty }` to `BLOCKS`.
  This is the first non-directory block with `isEmpty`: the renderer checks `isEmpty` only when
  `directoryStatus === "ready"`, so the condition must also allow non-directory blocks (otherwise the ghost would
  wait for the directory). Note for the planner.
- **Registry**: `src/frontend/src/pages/organizer/layouts/registry.ts` [MOD]. `{ block: "gallery", variant: "grid" }` after `about` in all 5 layouts.
- **PageFrame / OrganizerThemeScope** [REUSE]: unchanged.

### Organizer blocks
- **HeroBlock**: `src/frontend/src/pages/organizer/blocks/HeroBlock.tsx` [MOD]. Logo in 3 variants, cover in `cover`.
- **GalleryBlock**: `src/frontend/src/pages/organizer/blocks/GalleryBlock.tsx` [NEW].
- **GhostBlock**: `src/frontend/src/pages/organizer/blocks/GhostBlock.tsx` [MOD]. `gallery` copy and a CTA that opens the editor tab.

### Editor
- **EditorSheet**: `src/frontend/src/pages/organizer/editor/EditorSheet.tsx` [MOD]. Third tab, initial tab from `?tab=`.
- **PhotosTab**: `src/frontend/src/pages/organizer/editor/PhotosTab.tsx` [NEW]. Contains `PhotoSlot` (x2) and `GallerySection`.
- **SECTION_LABEL**: `editor/ColorsTab.tsx:23` [MOD], a module-private const today; export it (or move it to a small shared editor file).

### Photo UI (product module)
- **PhotoFileField**: `src/frontend/src/pages/product/ItemGalleryEditor.tsx` [REUSE/MOD]. The label says "+ Dodaj
  zdjęcia" and the input is `multiple`. The tab needs singular labels ("+ Dodaj logo", "+ Dodaj zdjęcie") and a
  single file, so add optional `label` and `multiple` props.
- **ModerationBadge**: same file [MOD]. Optional `labels` prop (Mockup 11).
- **ItemGalleryEditor** row markup [REUSE pattern]: either copy the row into `GallerySection` or parametrise
  `ItemGalleryEditor` (limit, hint, no "Gotowe" button). Copying the ~40-line row is simpler and keeps the product
  editor untouched. This is a planner decision.
- **SafeImage**: `src/frontend/src/pages/product/ItemGallery.tsx` [REUSE]. Gallery tiles and tab thumbnails.
- **photoFileError / ACCEPTED_PHOTO_TYPES / MAX_PHOTO_BYTES**: `src/frontend/src/pages/product/itemPageShared.ts` [REUSE].

### Icons
- `ChevronUp` / `ChevronDown` (lucide-react), `TrashIcon`, `EyeIcon`, `SettingsIcon`, `CloseIcon` (`pages/panel/panelIcons.tsx`), `PhotoPlaceholder` (`components/shared/Icons.tsx`) [REUSE].

### Admin
- **PhotoModerationCard**: `src/frontend/src/components/moderation/PhotoModerationCard.tsx` [MOD].
- **moderation API types**: `src/frontend/src/api/moderation.ts` [MOD].

---

## Implementation Notes

### Consistency Checklist
- The gallery heading, padding and card radius match the other organizer sections (`px-6 pt-6`, serif heading, `rounded-2xl`).
- The hero keeps its exact geometry. The image only swaps the initials span and the band background.
- The editor tab uses the same pill tabs, section labels, row cards and `role="alert"` lines as the existing tabs and the product photo editor.
- Immediate save behaves like product photos and avatars. The draft model (Układ / Kolory) is untouched.
- Status copy: "W weryfikacji" / "Odrzucone przez moderację — dodaj inne zdjęcie" (owner), English labels for the admin.

### Accessibility Considerations
- Logo `<img alt="">`: the organization name is already the `<h1>` (the initials span is `aria-hidden` today).
  Cover `alt=""` (decorative). Gallery tiles: `alt="{name} — zdjęcie N z M"`.
- Text over the cover: a `--color-scrim` gradient under the name and address, verified for 4.5:1 with `text-on-primary`.
- The third tab joins the existing roving-tabindex tablist (ArrowLeft / ArrowRight / Home / End through `rovingIndex.ts`).
- Upload progress: the section gets `aria-busy="true"` and a visible "Wysyłanie…" text. Errors use `role="alert"` next to the slot.
- All buttons are at least 44px tall in the tab (the product editor's 30px icon buttons are acceptable only inside a
  row that is itself larger; prefer `h-11 w-11` for ˄ ˅ 🗑 here). Visible labels on Zmień / Usuń / Anuluj.
- After a delete, focus goes to the slot's add button. After a move, focus stays on the moved photo's button.
- The ghost CTA is a real link with a visible label ("Dodaj zdjęcia →").

### Responsive Behavior
- Mobile (≤ 430px): everything as drawn. The gallery grid stays 3 / 2 / 1 columns (no horizontal scroll). The tab
  panel scrolls inside `max-h-[55vh]`.
- Wider screens: the page column and the sheet stay capped at 430px (`min-[520px]` floats the sheet with rounded corners). Nothing else changes.

---

## Alternatives Considered

### Photo management in `/panel` (organization settings view) (Rejected)
**Why**: the decision is the editor tab. The panel would split "how my page looks" across two places, and the owner
could not see the result on the page next to the controls.

### Photo changes as part of the draft (saved by Zapisz) (Rejected)
**Why**: uploads are asynchronous and moderated. Holding files until Zapisz means uploading on save, a long
blocking save and a confusing Anuluj (it cannot undo a stored upload). Immediate save matches product photos and avatars.

### Pending photo previewed in the hero for the owner (Rejected, decision I-9)
**Why**: the owner page renders the public response, and a preview would show the owner something visitors do not see.
Pending state lives only in the Zdjęcia tab.

### Gallery position per layout (after primary content vs after `about`) (Considered)
**Why after `about`**: a single rule for all layouts, close to the organization's description (the "who we are"
part), and never above the primary content in SCHEDULE / CIRCLES / EXCHANGE / LINKS. In CLASSIC it sits above the
terms list because `about` comes before the primary slot there. With max 3 tiles the strip is about 110px tall, so
the terms list moves down only slightly. If the team prefers terms first, move the CLASSIC slot below `upcoming-terms`.

### Cover in compact / centered heroes (Rejected, decision C-1)
**Why**: no room in the compact top bar, and LINKS is a link-in-bio card. The tab says where the cover is shown.

### Confirmation dialog before deleting an approved logo / cover (Rejected for now)
**Why**: parity with the product gallery and the avatar (no confirm). Re-uploading is cheap, though it goes through
moderation again. Easy to add later with the existing `ConfirmDialog` if owners delete by accident.

---

*Generated by ui-mockup-generator subagent*
