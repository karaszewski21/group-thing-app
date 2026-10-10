# UI Mockups: B — Public organizer directory + SCHEDULE / CIRCLES / EXCHANGE layouts

**Generated**: 2026-10-09
**Task Path**: `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b`
**Feature Type**: Enhancement (extends A2's layout registry) + one new page (`/:slug/terminy`)
**Viewport**: mobile-first, 375px wide (the content column is capped at `max-w-[430px]` by `LayoutRenderer`)

Legend used in every diagram:

```
[NEW]    new component / block / file
[MOD]    existing file that is modified
[REUSE]  existing component used as-is
(o) ( )  radio / pill states        [ ... ]  button        > / ›  link chevron
###      image / photo area         ░░░      skeleton shimmer   ┄┄┄  dashed (ghost) border
```

All colors are role tokens from `src/frontend/src/index.css` (`bg-primary`, `bg-primary-soft`, `text-primary-fg`,
`bg-accent-soft`, `text-accent-fg`, `bg-teal-soft`, `bg-cream`, `bg-paper`, `text-ink`, `text-ink-soft`,
`border-line`, `text-on-primary`). No hex. All copy is Polish. No person names or party ids appear in any directory block.

---

## Overview

### UI Requirements
- 9 new directory blocks: `stats`, `upcoming-terms` (`list` | `compact`), `agenda` (`by-day`), `next-term-cta` (`card`),
  `circles-grid` (`cards` | `featured`), `circle-visual` (`mini`), `exchange-counts` (`tiles3` | `tabs`),
  `exchange-board` (`grid2`), `needed-items` (`list`), plus the `empty-state` (`visitor`) block.
- 3 new layouts (SCHEDULE, CIRCLES, EXCHANGE) and updates to CLASSIC (new composition) and LINKS (directory buttons).
- A new subpage, `/:slug/terminy`.
- Owner-edit ghosts for the directory blocks. Skeletons while the directory loads.
- Editor LayoutTab: 5 cards with data-driven "Polecany" badges.
- The public term page item listing gains a thumbnail.

### Integration Strategy
**Decision**: Everything renders through the existing `LayoutRenderer` pipeline. A layout is a list of `BlockSlot`s, and each
block is a component in `pages/organizer/blocks/`. The new subpage reuses `OrganizerThemeScope` and the visual
language of the A2 page (cream canvas, 430px column, serif headings, rounded-2xl paper cards), so it reads as part
of the organizer's site rather than as an app panel.
**Rationale**: A2 already established the registry, renderer, ghosts and editor. B only adds rows to the registry, rows to
`BLOCKS` and `GHOST_COPY`, and grows `OrganizerPageData` with `directory` and `directoryStatus`. No new layout system.

---

## Existing Layout Analysis

### Application Structure
- `pages/organizer/PublicOrganizationPage.tsx` [MOD]: `PageFrame` (cream, `min-h-dvh`) → `OrganizerThemeScope` → `LayoutRenderer`.
  The owner gets the floating "Edytuj wygląd" pill (`bg-ink`, bottom-center) and the non-modal `EditorSheet` (`?edit=1`).
- `pages/organizer/LayoutRenderer.tsx` [MOD]: maps `layout.blocks` to `BLOCKS[slot.block]`, frames `column` | `centered`
  (centered = `from-primary-soft to-cream` gradient). Unknown or `null` blocks become `GhostBlock` for the owner.
- `pages/organizer/layouts/registry.ts` + `types.ts` [MOD]: `LAYOUT_REGISTRY`, `resolveLayout`, `BlockSlot`, `recommended`.
- `pages/organizer/blocks/*` [REUSE/MOD]: `HeroBlock` (`cover`, `centered`), `ShareBlock`/`ShareButton`, `LinkStackBlock`, `FooterBlock`, `GhostBlock`.
- `pages/organizer/editor/EditorSheet.tsx` [MOD] + `LayoutTab.tsx` [MOD]: 2-column radio card grid, `Polecany` = `bg-accent-soft text-accent-fg` pill, check bubble on the selected card.
- `pages/organizer/editor/PreviewCards.tsx` [REUSE pattern]: `TermPreviewCard` (46px `bg-primary-soft` date tile + `rounded-full bg-primary` CTA) and `ProductPreviewCard` (`bg-cream` photo slot + `PhotoPlaceholder` + soft pills). These two cards are the visual source for the agenda rows and exchange cards.
- `pages/krag/PublicTermView.tsx` [MOD] → `pages/krag/components/AttendeeList.tsx` [MOD] `ListingRow` (`kg-bring-item`).
- `pages/krag/GroupVisualization.tsx` + `utils/layoutPositions.ts` [REUSE geometry]: `getCirclePosition`, `getPitchPosition`, `getTablePosition`, `distributeEvenly`.
- `pages/product/ItemGallery.tsx` `SafeImage` [REUSE]: falls back to `PhotoPlaceholder` on a bad URL or load error.
- `components/shared/Icons.tsx` [REUSE]: `TermsIcon` (CalendarDays), `GroupsIcon` (UsersRound), `SharesIcon` (ArrowLeftRight), `BringsIcon` (Backpack), `PhotoPlaceholder`.
- `utils/dayjs.ts` [REUSE] (Polish locale) and `utils/plural.ts` `pluralPl` [REUSE].
- `utils/productCategory.ts` `CONDITION_LABELS` [REUSE] ("Dobry", ...).
- `pages/krag/components/termLabels.ts` [MOD]: add `EXCHANGE_MODE_LABELS = {GIFT:"Oddam", SWAP:"Zamienię", LEND:"Wypożyczę"}` and `EXCHANGE_MODE_TONE = {GIFT:"bg-primary-soft", SWAP:"bg-accent-soft", LEND:"bg-teal-soft"}`.

### Identified Patterns
- **Section heading**: `px-6 pt-6`, `font-serif text-lg font-semibold text-ink`. Content cards are `rounded-2xl border border-line bg-paper`.
- **Date tile**: 46×46 `rounded-[13px] bg-primary-soft`, day number `font-extrabold` over a short month (`paź`).
- **Primary CTA**: `min-h-12 rounded-2xl bg-primary text-on-primary font-extrabold` (LinkStack) / `rounded-full` (TermPreviewCard).
- **Soft pill**: `rounded-full px-2 py-0.5 text-[11px] font-extrabold` on a `*-soft` background.
- **Ghost**: `rounded-2xl border-[1.5px] border-dashed border-line text-ink-soft` + `EyeIcon` ("only you see this").
- **Touch targets**: ≥ 44px (`min-h-[44px]`), with focus-visible rings `outline-focus-ring`.

---

## Mockups

<a id="block-library"></a>
### Mockup 0: Block library (shared building blocks)

**Context**: Every layout below is composed from these. The file names are the proposed `pages/organizer/blocks/` files.

<a id="stats"></a>
#### `component:stats`: `StatsBlock.tsx` [NEW], variant `tiles3`

```
 ┌───────────────────────────────────────────────┐
 │ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │   3 tiles max, grid-cols-3 gap-2
 │ │ [Groups]  3 │ │ [Terms]   9 │ │ [Users] 32│ │   tile: rounded-2xl bg-paper border-line
 │ │ grupy       │ │ terminów    │ │ rodzin    │ │   number: font-extrabold text-ink
 │ │             │ │ w 60 dni    │ │           │ │   label: text-[12px] text-ink-soft (pluralPl)
 │ └─────────────┘ └─────────────┘ └───────────┘ │
 └───────────────────────────────────────────────┘
 rules: circle_count tile (if > 0), upcoming_term_count tile (if > 0), family_count tile only if != null (BE: null when < 3)
        fewer than 2 tiles → block hidden (visitor) / ghost (owner)
```

<a id="upcoming-terms"></a>
#### `component:upcoming-terms`: `UpcomingTermsBlock.tsx` [NEW], variants `list` | `compact`

```
 list (CLASSIC primary, up to 10 from directory.upcoming_terms)
 ┌───────────────────────────────────────────────┐
 │ Najbliższe terminy                            │  serif heading
 │ ┌──────┐                                      │
 │ │  14  │ Muzyczne Maluchy                  >  │  row = <Link> to /:slug/grupa/:gid/term/:tid
 │ │ paź  │ wt · 16:30 · zapisanych: 8           │  date tile = TermPreviewCard tile
 │ └──────┘                                      │  min-h 56, divide-y divide-line
 │ ┌──────┐                                      │
 │ │  16  │ Rytmy i grzechotki                >  │  attendee_count 0 → line omitted
 │ │ paź  │ czw · 10:00                          │
 │ └──────┘                                      │
 │            Wszystkie terminy (9) →            │  text link → /:slug/terminy (if total > shown)
 └───────────────────────────────────────────────┘

 compact (EXCHANGE, limit 3): one line of chips
 ┌───────────────────────────────────────────────┐
 │ Najbliższe spotkania                          │
 │ (wt 14 paź ›) (sb 18 paź ›) (wt 21 paź ›)     │  chips: rounded-full bg-paper border-line, links
 └───────────────────────────────────────────────┘
```

<a id="next-term-cta"></a>
#### `component:next-term-cta`: `NextTermCtaBlock.tsx` [NEW], variant `card`

```
 ┌───────────────────────────────────────────────┐
 │ ┌───────────────────────────────────────────┐ │  rounded-2xl bg-primary-soft p-4
 │ │ NAJBLIŻSZE ZAJĘCIA                        │ │  text-[11px] tracking-wide text-primary-fg
 │ │ ┌──────┐ Orliki 2017                      │ │
 │ │ │  14  │ wtorek, 14 października · 17:00  │ │  dayjs "dddd, D MMMM · HH:mm"
 │ │ │ paź  │ zapisanych: 12                   │ │
 │ │ └──────┘                                  │ │
 │ │ [        Zobacz i zapisz się  →         ] │ │  rounded-full bg-primary text-on-primary min-h-11
 │ └───────────────────────────────────────────┘ │
 └───────────────────────────────────────────────┘
 data: directory.upcoming_terms[0]; hidden when none
```

<a id="agenda"></a>
#### `component:agenda`: `AgendaBlock.tsx` [NEW], variant `by-day` (+ `component:circle-filter-chips`)

```
 ┌───────────────────────────────────────────────┐
 │ Plan zajęć                                    │
 │ (●Wszystkie) ( Orliki 2017 ) ( Młodziki 2015 )→ │  CircleFilterChips [NEW], only when ≥ 2 circles
 │                                               │  overflow-x-auto, role=radiogroup, aria-checked
 │ WTOREK, 14 PAŹDZIERNIKA ───────────────────── │  day header: text-[12px] font-extrabold
 │ ┌───────────────────────────────────────────┐ │  uppercase text-ink-soft, sticky top-0 bg-cream
 │ │ 17:00  Orliki 2017       zapisanych 12  > │ │  row: time font-extrabold w-12, name font-bold
 │ ├───────────────────────────────────────────┤ │  whole row = <Link>, min-h-[52px]
 │ │ 18:15  Młodziki 2015     zapisanych  9  > │ │
 │ └───────────────────────────────────────────┘ │
 │ CZWARTEK, 16 PAŹDZIERNIKA ─────────────────── │
 │ ┌───────────────────────────────────────────┐ │
 │ │ 17:00  Orliki 2017                      > │ │
 │ │        Trening na hali                    │ │  description: text-[12px] text-ink-soft, 1 line clamp
 │ └───────────────────────────────────────────┘ │
 │                                               │
 │        [   Pokaż kolejne terminy   ]          │  bg-paper border-line rounded-2xl min-h-11
 └───────────────────────────────────────────────┘    fetchNextPage() of useOrganizerTerms (size 20)
 grouping: dayjs(occurs_on).format("YYYY-MM-DD"); header dayjs(...).format("dddd, D MMMM")
 Shared with /:slug/terminy (same AgendaList [NEW] inner component).
```

<a id="circles-grid"></a>
#### `component:circles-grid`: `CirclesGridBlock.tsx` [NEW], variants `cards` | `featured`

```
 cards (≥ 2 circles)                                  featured (exactly 1 circle)
 ┌─────────────────────────────────────┐              ┌─────────────────────────────────────┐
 │ Nasze grupy                         │              │ ┌─────────────────────────────────┐ │
 │ ┌─────────────────────────────────┐ │              │ │      circle-visual:mini          │ │
 │ │ [Groups] Maluchy 0-2            │ │              │ │         (see below)              │ │
 │ │ zapisanych: 7 · 4 terminy       │ │              │ ├─────────────────────────────────┤ │
 │ │ nast.: śr 15 paź, 9:30        > │ │              │ │ Orliki 2017                     │ │
 │ └─────────────────────────────────┘ │              │ │ nast.: wt 14 paź, 17:00          │ │
 │ ┌─────────────────────────────────┐ │              │ │ zapisanych: 12 · 4 terminy       │ │
 │ │ [Groups] Przedszkolaki 3-6      │ │              │ │ [     Zobacz zajęcia  →       ] │ │
 │ │ brak zaplanowanych terminów     │ │              │ └─────────────────────────────────┘ │
 │ └─────────────────────────────────┘ │              └─────────────────────────────────────┘
 └─────────────────────────────────────┘
 card = rounded-2xl bg-paper border-line p-4; link target = next_term's term page
 (no next_term → card not a link; text "brak zaplanowanych terminów" text-ink-soft)
 "zapisanych: N" = next_term.attendee_count; "4 terminy" = upcoming_term_count (pluralPl, 60 days)
```

<a id="circle-visual-mini"></a>
#### `component:circle-visual-mini`: `CircleVisualMiniBlock.tsx` [NEW], variant `mini`

```
 CIRCLE (getCirclePosition)   PITCH (getPitchPosition)        TABLE (getTablePosition)
 ┌─────────────────────┐      ┌───────────────────────────┐   ┌─────────────────────────┐
 │       ●   ●   ●     │      │ ┌───────────────────────┐ │   │        ●    ●    ●      │
 │    ●     ┌───┐    ● │      │ │  ●    ●    ●    ●     │ │   │   ● ╭──────────────╮ ●  │
 │    ●     │ ◎ │    ● │      │ │──────────○────────────│ │   │     │    stół       │    │
 │    ●     └───┘    ● │      │ │  ●    ●    ●          │ │   │   ● ╰──────────────╯ ●  │
 │       ●   ●   ●     │      │ └───────────────────────┘ │   │        ●    ●    ●      │
 └─────────────────────┘      └───────────────────────────┘   └─────────────────────────┘
 ● = anonymous seat: h-6 w-6 rounded-full bg-primary-soft border-2 border-primary (no initials, no names)
 ◎ = center marker: rounded-full bg-primary (no organizer name — anonymity)
 n = next_term.attendee_count (cap ~16 seats, then "+N" chip); layout = circle.layout_mode
 aspect-[4/3] max-h-48, role="img" aria-label="Zapisanych 12 rodzin"
 hidden when attendee_count == 0 (featured card then shows only the text part)
```

<a id="exchange-counts"></a>
#### `component:exchange-counts`: `ExchangeCountsBlock.tsx` [NEW], variants `tiles3` | `tabs`

```
 tiles3 (CLASSIC / SCHEDULE / CIRCLES)            tabs (EXCHANGE; filters exchange-board)
 ┌───────────────────────────────────────┐        ┌───────────────────────────────────────┐
 │ Wymiana rzeczy                        │        │ (●Wszystko 8)(Oddam 3)(Zamienię 4)(Wyp. 1)│
 │ ┌─────────┐ ┌─────────┐ ┌─────────┐   │        └───────────────────────────────────────┘
 │ │ Oddam   │ │Zamienię │ │Wypożyczę│   │        role=tablist; selected = bg-ink text-on-ink
 │ │    3    │ │    4    │ │    0    │   │        unselected = bg-{tone}-soft; count 0 → tab disabled
 │ └─────────┘ └─────────┘ └─────────┘   │
 │  primary-soft accent-soft  teal-soft  │        tiles link to the nearest term with items
 └───────────────────────────────────────┘        hidden for visitors at 0/0/0
```

<a id="exchange-board"></a>
#### `component:exchange-board`: `ExchangeBoardBlock.tsx` [NEW], variant `grid2` (+ `component:exchange-item-card`)

```
 ┌───────────────────────────────────────────────┐
 │ ┌────────────────────┐ ┌────────────────────┐ │  grid-cols-2 gap-2.5
 │ │####################│ │                    │ │  ExchangeItemCard [NEW] = ProductPreviewCard
 │ │####  thumb_url  ###│ │   [PhotoPlaceholder]│ │  pattern: SafeImage aspect-square rounded-xl
 │ │####################│ │    bg-cream         │ │  (thumb_url null → PhotoPlaceholder)
 │ │ Pucio — książka    │ │ Kask rowerowy      │ │  product_name: font-bold, line-clamp-2
 │ │ (Oddam) Bardzo dobry│ │ (Zamienię) Dobry  │ │  mode pill (tone) + CONDITION_LABELS
 │ │ odbiór: wt 14 paź  │ │ odbiór: wt 14 paź  │ │  text-[12px] text-ink-soft
 │ └────────────────────┘ └────────────────────┘ │
 │ ┌────────────────────┐ ┌────────────────────┐ │  whole card = <Link> to the item's term page
 │ │ ...                │ │ ...                │ │  /:slug/grupa/:group_id/term/:term_id
 │ └────────────────────┘ └────────────────────┘ │  (the action happens there)
 └───────────────────────────────────────────────┘
 pills: GIFT "Oddam" bg-primary-soft text-primary-fg · SWAP "Zamienię" bg-accent-soft text-accent-fg
        LEND "Wypożyczę" bg-teal-soft text-ink
 NO lister name/avatar on the card. ≤ 12 items (BE cap).
```

<a id="needed-items"></a>
#### `component:needed-items`: `NeededItemsBlock.tsx` [NEW], variant `list` (read-only)

```
 ┌───────────────────────────────────────────────┐
 │ Potrzebne na najbliższe zajęcia               │
 │ ┌───────────────────────────────────────────┐ │
 │ │ [Backpack] Koc piknikowy                  │ │  open item: text-ink
 │ │            wt 14 paź        Zobacz →      │ │  "Zobacz →" links to the term page (declare there)
 │ ├───────────────────────────────────────────┤ │
 │ │ [✓] Głośnik                (Zapewnione)   │ │  claimed: text-ink-soft line-through-none,
 │ └───────────────────────────────────────────┘ │  pill bg-primary-soft "Zapewnione" (no who)
 └───────────────────────────────────────────────┘
 hidden when needed_items is empty
```

<a id="empty-state-visitor"></a>
#### `component:empty-state-visitor`: `EmptyStateBlock.tsx` [NEW], variant `visitor`

```
 ┌───────────────────────────────────────────────┐
 │ ┌───────────────────────────────────────────┐ │  rounded-2xl bg-paper border-line px-6 py-8
 │ │              [TermsIcon 32]               │ │  icon text-ink-soft
 │ │      Brak zaplanowanych zajęć             │ │  font-serif text-lg
 │ │  Zajrzyj tu wkrótce albo udostępnij       │ │  text-[13px] text-ink-soft
 │ │  stronę znajomym.                         │ │
 │ └───────────────────────────────────────────┘ │
 │ [            Udostępnij stronę             ]  │  injected link-stack (ShareButton) [REUSE]
 └───────────────────────────────────────────────┘
 copy per layout: SCHEDULE/CLASSIC "Brak zaplanowanych zajęć" · CIRCLES "Brak grup do pokazania"
                  EXCHANGE "Na razie nic tu nie ma" + "Jak to działa?" disclosure (details/summary)
 NOTE: do NOT reuse components/shared/EmptyState.tsx: it is Chakra with hard-coded hex colors.
```

<a id="ghost-directory"></a>
#### `component:ghost-directory`: `GhostBlock.tsx` [MOD], owner-only

```
 ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
 ┆ Najbliższe terminy                    [Eye] ┆  existing ghost frame (dashed border-line)
 ┆ Tu pokażemy Twoje najbliższe zajęcia.       ┆  body text-[12.5px] text-ink-soft
 ┆ Widzisz to tylko Ty.                        ┆
 ┆ Dodaj termin →                              ┆  NEW: optional CTA <Link> text-primary-fg font-bold
 └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘    to the panel (e.g. /panel/terminy), min-h-[44px]
 GHOST_COPY additions (title / CTA → panel route):
   upcoming-terms, agenda, next-term-cta → "Dodaj termin →"
   circles-grid, circle-visual           → "Dodaj grupę →"
   exchange-counts, exchange-board       → "Dodaj rzecz do wymiany →"
   needed-items                          → "Dodaj potrzebną rzecz →"
   stats                                 → no CTA ("Statystyki pojawią się, gdy będziesz mieć więcej grup i terminów.")
 directoryStatus "unavailable" → neutral ghost, no CTA: "Nie udało się wczytać danych katalogu. Odwiedzający nie widzą tej sekcji."
```

<a id="block-skeleton"></a>
#### `component:block-skeleton`: `BlockSkeleton.tsx` [NEW]

```
 ┌───────────────────────────────────────────────┐
 │ ░░░░░░░░░░░░░                                 │  heading bar h-4 w-1/3
 │ ┌──────┐ ░░░░░░░░░░░░░░░░░░░░░                │  rows mimic the target block's shape
 │ │░░░░░░│ ░░░░░░░░░░░                          │  bg-line/60 animate-pulse rounded
 │ └──────┘                                      │  (motion-reduce:animate-none)
 │ ┌──────┐ ░░░░░░░░░░░░░░░░░░                   │  aria-hidden; the container has aria-busy="true"
 │ └──────┘                                      │
 └───────────────────────────────────────────────┘
 shown for directory blocks while directoryStatus === "loading"; hero/about/footer paint
 immediately from the organization payload (theme first).
```

---

<a id="layout-classic"></a>
### Mockup 1: CLASSIC "Klasyczny" (updated), visitor

**Context**: `/:slug`, layout `CLASSIC` (default and fallback). The primary slot moves from `about` to `upcoming-terms:list`.

```
┌─────────────────────────────────────┐ 375px
│█████████████████████████████████████│ HeroBlock cover→color [REUSE] bg-primary
│█ (RG)                               │
│█ Rodzinny Grajdołek                 │ font-serif text-3xl text-on-primary
│█ domena.pl/rodzinny-grajdolek       │
│█████████████████████████████████████│
│ [ Udostępnij ]                      │ ShareBlock [REUSE]
│                                     │
│ ┌─────────┐┌─────────┐┌─────────┐   │ StatsBlock tiles3 [NEW]
│ │ 3 grupy ││9 terminów││32 rodzin│   │
│ └─────────┘└─────────┘└─────────┘   │
│                                     │
│ (about: ghost for owner, hidden for │ about [REUSE, still null until C]
│  visitors)                          │
│                                     │
│ Najbliższe terminy           PRIMARY│ UpcomingTermsBlock list [NEW]
│ │14 paź│ Muzyczne Maluchy        >  │
│ │      │ wt · 16:30 · zapisanych 8  │
│ │16 paź│ Rytmy i grzechotki      >  │
│ │      │ czw · 10:00                │
│        Wszystkie terminy (9) →      │ → /:slug/terminy
│                                     │
│ Wymiana rzeczy                      │ ExchangeCountsBlock tiles3 [NEW]
│ [Oddam 3] [Zamienię 4] [Wypożyczę 0]│
│                                     │
│ ───── Strona utworzona w … ──────── │ FooterBlock [REUSE]
└─────────────────────────────────────┘
```

**Registry** (`registry.ts` [MOD]): `hero:cover · share · stats · about · upcoming-terms:list (primary) · exchange-counts · footer` (gallery deferred to D2).

<a id="layout-schedule"></a>
### Mockup 2: SCHEDULE "Plan zajęć", visitor

**Context**: Organizers with many recurring sessions (clubs, schools). Primary = `agenda:by-day`.

```
┌─────────────────────────────────────┐ 375px
│ (AO) Akademia Orlik     [Udostępnij]│ HeroBlock compact [MOD: new variant]
│      domena.pl/akademia-orlik       │ bg-paper border-b border-line, h-14 avatar
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │ NextTermCtaBlock card [NEW]
│ │ NAJBLIŻSZE ZAJĘCIA              │ │ bg-primary-soft
│ │ │14 paź│ Orliki 2017            │ │
│ │ │      │ wtorek · 17:00 · 12 zap.│ │
│ │ [  Zobacz i zapisz się  →     ] │ │ bg-primary
│ └─────────────────────────────────┘ │
│                                     │
│ Plan zajęć                   PRIMARY│ AgendaBlock by-day [NEW]
│ (●Wszystkie)(Orliki 2017)(Młodziki→ │ CircleFilterChips [NEW] (≥ 2 circles)
│ WTOREK, 14 PAŹDZIERNIKA ─────────── │
│ │ 17:00 Orliki 2017    zapisanych 12>│
│ │ 18:15 Młodziki 2015  zapisanych 9 >│
│ CZWARTEK, 16 PAŹDZIERNIKA ───────── │
│ │ 17:00 Orliki 2017                >│
│ SOBOTA, 18 PAŹDZIERNIKA ─────────── │
│ │ 10:00 Młodziki 2015  Turniej     >│
│     [  Pokaż kolejne terminy  ]     │ useOrganizerTerms.fetchNextPage
│                                     │
│ (about:short: hidden until C)       │
│ Wymiana rzeczy                      │ ExchangeCountsBlock tiles3 [NEW]
│ [Oddam 3] [Zamienię 4] [Wypożyczę 1]│
│ ───── Strona utworzona w … ──────── │ FooterBlock [REUSE]
└─────────────────────────────────────┘
```

**Registry**: `hero:compact · next-term-cta:card · agenda:by-day (primary) · about:short · exchange-counts · footer`.
The share action sits in the compact hero (ShareButton [REUSE], icon + label, min-h-[44px]).

<a id="layout-circles"></a>
### Mockup 3: CIRCLES "Grupy", visitor (two variants via `when`)

**Context**: Organizers whose identity is "the groups" (music school, kindergarten groups). `BlockSlot.when` picks `cards` (minCircles 2) or `featured` + `circle-visual:mini` (maxCircles 1).

```
 ≥ 2 grupy  (circles-grid:cards)            1 grupa  (circles-grid:featured + circle-visual:mini)
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│█████████████████████████████████████│     │█████████████████████████████████████│ HeroBlock color
│█ (SN) Szkoła Muzyczna Nutka         │     │█ (TO) Trenerka Ola                  │ [REUSE cover→color]
│█ domena.pl/nutka                    │     │█ domena.pl/trenerka-ola             │
│█████████████████████████████████████│     │█████████████████████████████████████│
│ [ Udostępnij ]                      │     │ [ Udostępnij ]                      │ ShareBlock
│                                     │     │                                     │
│ Nasze grupy                  PRIMARY│     │ Nasza grupa                  PRIMARY│
│ ┌─────────────────────────────────┐ │     │ ┌─────────────────────────────────┐ │
│ │ Maluchy 0-2                     │ │     │ │ ┌─────────────────────────────┐ │ │ CircleVisualMini
│ │ zapisanych: 7 · 4 terminy       │ │     │ │ │  ●  ●  ●  ●  ●              │ │ │ (PITCH, 12 seats,
│ │ nast.: śr 15 paź, 9:30        > │ │     │ │ │ ─────────○──────────        │ │ │  anonymous)
│ └─────────────────────────────────┘ │     │ │ │  ●  ●  ●  ●  ●  ●  ●        │ │ │
│ ┌─────────────────────────────────┐ │     │ │ └─────────────────────────────┘ │ │
│ │ Przedszkolaki 3-6               │ │     │ │ Orliki 2017                     │ │
│ │ zapisanych: 9 · 2 terminy       │ │     │ │ nast.: wt 14 paź, 17:00         │ │
│ │ nast.: czw 16 paź, 16:30      > │ │     │ │ zapisanych: 12 · 4 terminy      │ │
│ └─────────────────────────────────┘ │     │ │ [     Zobacz zajęcia  →       ] │ │
│ ┌─────────────────────────────────┐ │     │ └─────────────────────────────────┘ │
│ │ Rytmika (sobota)                │ │     │                                     │
│ │ brak zaplanowanych terminów     │ │     │ Wymiana rzeczy                      │
│ └─────────────────────────────────┘ │     │ [Oddam 1] [Zamienię 0] [Wypożyczę 2]│
│ Wymiana rzeczy                      │     │ ───── Strona utworzona w … ──────── │
│ [Oddam 3] [Zamienię 4] [Wypożyczę 0]│     └─────────────────────────────────────┘
│ ───── Strona utworzona w … ──────── │
└─────────────────────────────────────┘
```

**Registry**: `hero:color · share · circles-grid:cards {when:{minCircles:2}, primary} · circles-grid:featured {when:{maxCircles:1}, primary} · circle-visual:mini {when:{maxCircles:1}} · about:short · exchange-counts · footer`.
Note: in the featured variant `circle-visual:mini` renders inside the featured card. Implementation choice: `CirclesGridBlock featured` composes `CircleVisualMini` directly, so the registry row for `circle-visual` may be dropped. Either way, there is one visual per page.

<a id="layout-exchange"></a>
### Mockup 4: EXCHANGE "Wymiana", visitor

**Context**: Swap-meet organizers. Primary = `exchange-board:grid2`.

```
┌─────────────────────────────────────┐ 375px
│ (WS) Wymianka Sołacz    [Udostępnij]│ HeroBlock compact [MOD]
├─────────────────────────────────────┤
│(●Wszystko 8)(Oddam 3)(Zamienię 4)(W→│ ExchangeCountsBlock tabs [NEW] (filters board)
│                                     │
│ ┌────────────────┐┌────────────────┐│ ExchangeBoardBlock grid2 [NEW]   PRIMARY
│ │################││                ││
│ │### zdjęcie ####││ [PhotoPlaceh.] ││ SafeImage [REUSE] / PhotoPlaceholder
│ │################││                ││
│ │Pucio — książka ││Kask rowerowy   ││
│ │(Oddam) B. dobry││(Zamienię) Dobry││ mode pill tone + condition
│ │odbiór: wt 14 paź││odbiór: wt 14 paź││
│ └────────────────┘└────────────────┘│
│ ┌────────────────┐┌────────────────┐│
│ │################││################││
│ │Fotelik 9-18 kg ││Rowerek biegowy ││
│ │(Wypożyczę) Dobry││(Zamienię) Nowy ││
│ │odbiór: sb 18 paź││odbiór: wt 14 paź││
│ └────────────────┘└────────────────┘│
│                                     │
│ Potrzebne na najbliższe zajęcia     │ NeededItemsBlock list [NEW]
│ │[Backpack] Koc piknikowy   Zobacz →│ read-only, links to term page
│ │[✓] Głośnik           (Zapewnione) │ claimed flag only, no names
│                                     │
│ Najbliższe spotkania                │ UpcomingTermsBlock compact [NEW] (3)
│ (wt 14 paź ›)(sb 18 paź ›)(wt 21 ›) │
│ ───── Strona utworzona w … ──────── │ FooterBlock [REUSE]
└─────────────────────────────────────┘
```

**Registry**: `hero:compact · exchange-counts:tabs · exchange-board:grid2 (primary) · needed-items:list · upcoming-terms:compact {limit:3} · about:short · footer`.
Tabs filter on the client over `exchange.items` (≤ 12). No "Pokaż wszystkie" in B: there is no paged items endpoint. Show the full ≤ 12.

<a id="layout-links"></a>
### Mockup 5: LINKS "Wizytówka" (directory buttons added), visitor

```
┌─────────────────────────────────────┐ 375px, frame centered (primary-soft→cream gradient)
│                                     │
│               ( RG )                │ HeroBlock centered [REUSE]
│         Rodzinny Grajdołek          │
│     domena.pl/rodzinny-grajdolek    │
│                                     │
│ [ Najbliższe zajęcia · wt 14.10 17:00]│ NEW link, bg-primary text-on-primary (first = filled)
│ [ Wszystkie terminy (9)            ]│ NEW link → /:slug/terminy; bg-paper border-line-strong
│ [ Wymiana rzeczy (8)               ]│ NEW link → nearest term with items (else nearest term)
│ [ Udostępnij stronę                ]│ ShareButton [REUSE]; filled only when it is the sole button
│                                     │
│ (about: hidden until C)             │
│ ───── Strona utworzona w … ──────── │
└─────────────────────────────────────┘
 Button rules (LinkStackBlock [MOD]):
  - "Najbliższe zajęcia" only if upcoming_terms[0]; label suffix dayjs "dd D.MM HH:mm"
  - "Wszystkie terminy (N)" only if stats.upcoming_term_count > 0 (N from stats, 60-day window)
  - "Wymiana rzeczy (N)" only if sum(exchange.counts) > 0
  - directory loading → 2 skeleton bars above Share; unavailable → Share only (the A2 behavior)
```

<a id="owner-edit-empty"></a>
### Mockup 6: Owner-edit / empty / loading variants (SCHEDULE shown)

```
 A. Visitor, 0 terms               B. Owner (owner-edit), 0 terms     C. Loading (any viewer)
┌───────────────────────────────┐ ┌───────────────────────────────┐ ┌───────────────────────────────┐
│ (AO) Akademia Orlik  [Udostęp]│ │ (AO) Akademia Orlik  [Udostęp]│ │ (AO) Akademia Orlik  [Udostęp]│
├───────────────────────────────┤ ├───────────────────────────────┤ ├───────────────────────────────┤
│ ┌───────────────────────────┐ │ │┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐│ │ ┌───────────────────────────┐ │
│ │       [TermsIcon]         │ │ │┆ Najbliższe zajęcia  [Eye] ┆│ │ │ ░░░░░░░░░                 │ │
│ │ Brak zaplanowanych zajęć  │ │ │┆ Tu pojawi się Twój        ┆│ │ │ ░░░░  ░░░░░░░░░░░░░       │ │
│ │ Zajrzyj tu wkrótce albo   │ │ │┆ najbliższy termin.        ┆│ │ │ ░░░░░░░░░░░░░░░░░░░░░░░   │ │
│ │ udostępnij stronę.        │ │ │┆ Dodaj termin →            ┆│ │ └───────────────────────────┘ │
│ └───────────────────────────┘ │ │└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘│ │ ░░░░░░░░                      │
│ [   Udostępnij stronę      ]  │ │┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐│ │ ░░░░░ ░░░░░░░░░░░░░░░░░░░░    │
│                               │ │┆ Plan zajęć          [Eye] ┆│ │ ░░░░░ ░░░░░░░░░░░░░░░░░░░░    │
│ (next-term-cta hidden)        │ │┆ Gdy dodasz terminy,       ┆│ │ ░░░░░ ░░░░░░░░░░░░░░░░░░░░    │
│ (exchange-counts hidden 0/0/0)│ │┆ odwiedzający zobaczą tu   ┆│ │                               │
│ ───── Strona utworzona … ──── │ │┆ plan zajęć.               ┆│ │ ───── Strona utworzona … ──── │
└───────────────────────────────┘ │┆ Dodaj termin →            ┆│ └───────────────────────────────┘
                                  │└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘│  hero + footer paint at once from
 primary empty → empty-state:     │┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐│  the organization payload (theme
 visitor + injected link-stack    │┆ Wymiana rzeczy      [Eye] ┆│  applied); directory blocks use
 (Share). Auxiliary empty blocks  │┆ Dodaj rzecz do wymiany →  ┆│  BlockSkeleton
 are hidden.                      │└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘│
                                  │        ( ✎ Edytuj wygląd )    │ existing owner pill [REUSE]
                                  └───────────────────────────────┘

 D. Directory unavailable (404 / error)
   visitor: directory blocks are NOT rendered; the page = hero + share + footer (+ the primary
            empty-state if the primary is a directory block → generic "Brak informacji do pokazania" + Share)
   owner:   each directory slot = neutral ghost, no CTA:
            ┆ Plan zajęć  [Eye]  Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji. ┆
```

**LayoutRenderer rules** [MOD] (in priority order per slot):
1. `slot.when` does not match the circle count → skip.
2. directory block and `directoryStatus === "loading"` → `BlockSkeleton`.
3. directory block and `unavailable` → visitor: skip; owner: neutral `GhostBlock`.
4. `isEmpty(data)` → visitor: skip (if `primary`: `EmptyStateBlock visitor` + `link-stack`); owner: `GhostBlock` with CTA.
5. otherwise render the block.

<a id="screen-terminy"></a>
### Mockup 7: NEW page `/:slug/terminy` ("Wszystkie terminy")

**Context**: Reached from "Wszystkie terminy (N)" (LINKS button, the upcoming-terms footer link). Full forward agenda, not windowed.
File: `pages/organizer/OrganizerTermsPage.tsx` [NEW]; route in `router.tsx` [MOD] as `/:organizationSlug/terminy` (multi-segment,
so it ranks ahead of the `/:organizationSlug` catch-all; `terminy` is added to the backend `RESERVED_SLUGS`).

```
┌─────────────────────────────────────┐ 375px  OrganizerThemeScope(organization) [REUSE]
│ ‹ Rodzinny Grajdołek                │ back <Link to="/:slug"> min-h-[44px] text-primary-fg
│                                     │
│ Wszystkie terminy                   │ h1 font-serif text-2xl
│ 37 zaplanowanych                    │ total from page 1, pluralPl
│                                     │
│ (●Wszystkie)(Maluchy 0-2)(Przedszk.→│ CircleFilterChips [NEW] (≥ 2 circles, from useOrganizerPage)
│                                     │ selecting a chip → group_id in the query key, resets pages
│ WTOREK, 14 PAŹDZIERNIKA ─────────── │ AgendaList [NEW, shared with AgendaBlock]
│ ┌─────────────────────────────────┐ │
│ │ 16:30 Muzyczne Maluchy  zap. 8 >│ │
│ ├─────────────────────────────────┤ │
│ │ 17:30 Przedszkolaki 3-6 zap. 5 >│ │
│ └─────────────────────────────────┘ │
│ CZWARTEK, 16 PAŹDZIERNIKA ───────── │
│ ┌─────────────────────────────────┐ │
│ │ 10:00 Rytmy i grzechotki       >│ │
│ └─────────────────────────────────┘ │
│ ...                                 │
│      [     Pokaż więcej     ]       │ fetchNextPage; disabled + "Wczytywanie…" while fetching
│                                     │ hidden when !hasNextPage
│ ───── Strona utworzona w … ──────── │ FooterBlock [REUSE]
└─────────────────────────────────────┘

 States:
  loading (first page): heading + 3 skeleton day groups (BlockSkeleton)
  empty (filter or all):  EmptyStateBlock visitor "Brak zaplanowanych zajęć" (+ "Pokaż wszystkie grupy" if a chip is active)
  org 404 / directory 404: the existing "Nie znaleziono strony" frame from PublicOrganizationPage (extract to a shared NotFoundFrame)
  fetchNextPage error: inline text-[13px] "Nie udało się wczytać kolejnych terminów." + [Spróbuj ponownie]
```

Hooks: `useOrganizerTerms(slug, groupId)` [NEW] = the first `useInfiniteQuery` (key `["organizerTerms", slug, groupId ?? null]`,
`getNextPageParam` from `page * size < total`). Chips come from `useOrganizerPage(slug).data.circles`.

<a id="editor-layout-tab"></a>
### Mockup 8: Editor LayoutTab, 5 cards with data-driven "Polecany"

**Context**: `/:slug?edit=1`, the bottom `EditorSheet` [MOD] → `LayoutTab` [MOD]. The live page stays visible above the sheet.

```
┌─────────────────────────────────────┐ 375px
│ (live page in draft layout, ghosts) │
│ ...                                 │
│═════════════════════════════════════│
│  ───   Wygląd strony           [x]  │ EditorSheet [REUSE]
│  [ Układ ]  Kolory                  │ tablist [REUSE]
│ ┌───────────────┐ ┌───────────────┐ │ grid-cols-2 gap-2.5 (existing)
│ │ [classic.svg] │ │ [links.svg]   │ │
│ │ Klasyczny   ✓ │ │ Wizytówka     │ │ ✓ = selected bubble (bg-primary)
│ │ Profil z      │ │ Same linki,   │ │
│ │ opisem i ...  │ │ jak w bio ... │ │
│ └───────────────┘ └───────────────┘ │
│ ┌───────────────┐ ┌───────────────┐ │
│ │[schedule.svg] │ │[circles.svg]  │ │ NEW thumbnails: assets/layouts/{schedule,circles,exchange}.svg
│ │ Plan zajęć    │ │ Grupy         │ │
│ │ (Polecany)    │ │ (Polecany)    │ │ bg-accent-soft text-accent-fg pill [REUSE style]
│ │ Gdy masz wiele│ │ Kilka grup    │ │ several badges may show at once
│ │ zajęć w tyg.  │ │ na jednej str.│ │
│ └───────────────┘ └───────────────┘ │
│ ┌───────────────┐                   │
│ │[exchange.svg] │                   │
│ │ Wymiana       │                   │
│ │ Tablica rzeczy│                   │
│ │ do oddania... │                   │
│ └───────────────┘                   │
│        [ Anuluj ]   [ Zapisz ]      │
└─────────────────────────────────────┘

 Badge rules: recommendWhen(data) [NEW on PageLayoutDefinition, replaces static `recommended`]
   SCHEDULE  ≥ 4 upcoming_terms with occurs_on < now + 14 days
   CIRCLES   circles.length ≥ 2
   EXCHANGE  GIFT + SWAP + LEND ≥ 4
   LINKS     directoryStatus === "unavailable" OR circles.length === 0
   CLASSIC   never
   directoryStatus === "loading" → no badge on any card (no flicker)
 Data path: PublicOrganizationPage → EditorSheet (new prop `pageData`) → LayoutTab (new prop `data`).
 a11y: the badge id stays in aria-describedby (existing pattern), so "Polecany" is announced per card.
```

Proposed descriptions: SCHEDULE "Gdy masz wiele zajęć w tygodniu." · CIRCLES "Twoje grupy na jednej stronie." · EXCHANGE "Tablica rzeczy do oddania i wymiany."

<a id="term-page-thumbnail"></a>
### Mockup 9: Public term page, item listing thumbnail (before / after)

**Context**: `/:slug/grupa/:gid/term/:tid` → `pages/krag/PublicTermView.tsx` [MOD] `toListingRow` → `AttendeeList.tsx` `ListingRow` [MOD].
`PublicItemListingResponse.thumb_url: string | null` is new (BE).

```
 BEFORE                                        AFTER
┌─────────────────────────────────────┐      ┌─────────────────────────────────────┐
│ Zapisani na zajęcia                 │      │ Zapisani na zajęcia                 │
│ (AK) Rodzina Kowalskich             │      │ (AK) Rodzina Kowalskich             │
│   ┌───────────────────────────────┐ │      │   ┌───────────────────────────────┐ │
│   │ Kask rowerowy ›               │ │      │   │┌──────┐ Kask rowerowy ›       │ │
│   │ [Pożycz] [Zamień]             │ │      │   ││######│ [Pożycz] [Zamień]     │ │
│   └───────────────────────────────┘ │      │   │└──────┘                       │ │
│   ┌───────────────────────────────┐ │      │   └───────────────────────────────┘ │
│   │ Pucio — książka ›             │ │      │   ┌───────────────────────────────┐ │
│   │ [Weź na stałe]                │ │      │   ││ [ph] │ Pucio — książka ›     │ │
│   └───────────────────────────────┘ │      │   ││      │ [Weź na stałe]        │ │
└─────────────────────────────────────┘      │   │└──────┘                       │ │
                                             │   └───────────────────────────────┘ │
                                             └─────────────────────────────────────┘
 thumb: 48×48 rounded-xl shrink-0, SafeImage [REUSE from pages/product/ItemGallery.tsx]
        src=thumb_url, alt="" (decorative: the name is the link text), placeholderSize={20}
        thumb_url null → the same 48×48 bg-cream tile with PhotoPlaceholder (keeps rows aligned)
 ListingRowVM [MOD] gains `thumbUrl?: string | null`; ListingRow renders flex gap-3 [thumb][body].
 The thumbnail stays outside the item-page <Link>, so each row has one tab stop.
```

---

## Reusable Components

### Layout and theme
- **OrganizerThemeScope**: `src/frontend/src/theme/OrganizerThemeScope.tsx`. Wraps `/:slug` and `/:slug/terminy`.
- **LayoutRenderer** [MOD]: `pages/organizer/LayoutRenderer.tsx`. Adds `when`, skeleton, `isEmpty`, primary-empty fallback and the `mode` prop for blocks.
- **PageFrame** (local in `PublicOrganizationPage.tsx`). Extract it with the not-found frame so `OrganizerTermsPage` can reuse both.

### Existing blocks
- **HeroBlock** [MOD]: add the `compact` and `color` variants (`cover` already renders as a color band).
- **ShareBlock / ShareButton** [REUSE]. **FooterBlock** [REUSE]. **GhostBlock** [MOD]: CTA link and neutral variant.
- **LinkStackBlock** [MOD]: directory buttons.

### Shared UI
- **SafeImage**: `pages/product/ItemGallery.tsx`. Exchange cards and term-page thumbnails.
- **PhotoPlaceholder, TermsIcon, GroupsIcon, SharesIcon, BringsIcon**: `components/shared/Icons.tsx`.
- **familyInitials**: `components/shared/Avatar.tsx`. Only the hero uses it (organization initials, never people).
- **layoutPositions**: `utils/layoutPositions.ts`. `getCirclePosition`, `getPitchPosition`, `getTablePosition` for the mini visual.
- **dayjs**: `utils/dayjs.ts` (pl). **pluralPl**: `utils/plural.ts`. **CONDITION_LABELS**: `utils/productCategory.ts`.
- **nextIndex**: `pages/organizer/editor/rovingIndex.ts`. Arrow-key roving for chips and tabs.
- **Not reused**: `components/shared/EmptyState.tsx` (Chakra + hex) and `components/shared/Pagination.tsx` (numbered pages; the spec wants "Pokaż więcej").

### New
| File | Purpose |
|---|---|
| `pages/organizer/blocks/StatsBlock.tsx` | stats tiles3 |
| `pages/organizer/blocks/UpcomingTermsBlock.tsx` | list / compact |
| `pages/organizer/blocks/NextTermCtaBlock.tsx` | card |
| `pages/organizer/blocks/AgendaBlock.tsx` + `AgendaList.tsx` | by-day, shared with /terminy |
| `pages/organizer/blocks/CircleFilterChips.tsx` | chip radiogroup |
| `pages/organizer/blocks/CirclesGridBlock.tsx` | cards / featured |
| `pages/organizer/blocks/CircleVisualMiniBlock.tsx` | anonymous seats |
| `pages/organizer/blocks/ExchangeCountsBlock.tsx` | tiles3 / tabs |
| `pages/organizer/blocks/ExchangeBoardBlock.tsx` + `ExchangeItemCard.tsx` | grid2 |
| `pages/organizer/blocks/NeededItemsBlock.tsx` | read-only list |
| `pages/organizer/blocks/EmptyStateBlock.tsx` | visitor empty |
| `pages/organizer/blocks/BlockSkeleton.tsx` | loading |
| `pages/organizer/OrganizerTermsPage.tsx` | /:slug/terminy |
| `assets/layouts/{schedule,circles,exchange}.svg` | editor thumbnails |
| `hooks/useOrganizerPage.ts`, `hooks/useOrganizerTerms.ts`, `api/groups.ts` [MOD] | data |

---

## Implementation Notes

### Consistency Checklist
- ✅ All blocks use the A2 spacing (`px-6`, `pt-5`/`pt-6`), `rounded-2xl` paper cards and serif section headings.
- ✅ Date tiles and CTAs copy `TermPreviewCard`. Exchange cards copy `ProductPreviewCard`, so the editor's color preview matches the real page.
- ✅ Mode tone mapping is centralized in `termLabels.ts`. No ad hoc colors.
- ✅ Every term link uses `/${slug}/grupa/${group_id}/term/${term_id}`.
- ✅ Privacy: no names, avatars of people or party ids. Seat dots are anonymous. Needed items show only "Zapewnione".

### Accessibility Considerations
- Chips: `role="radiogroup"` + `aria-checked` + roving tabindex (`nextIndex`). Exchange tabs: `role="tablist"` controlling the board (`aria-controls`).
- Day headers are `<h3>`; the agenda is `<ol>` per day; rows are single links with an accessible name like "Orliki 2017, wtorek 14 października, 17:00, zapisanych 12".
- Circle visual: `role="img"` with an aria-label count. Seats are `aria-hidden`.
- Skeleton containers: `aria-busy="true"`; shimmer `motion-reduce:animate-none`.
- "Pokaż więcej": after load, keep focus on the button. Announce "Wczytano N kolejnych terminów" through an `aria-live="polite"` region.
- Ghost CTA links: ≥ 44px tall, visible focus ring. Ghosts never render for visitors.
- Contrast: pills use `*-fg` or `text-ink` on `*-soft` (4.5:1 per the A2 token checks).

### Responsive Behavior
- Mobile (375px): everything is a single column inside `max-w-[430px]`. The exchange grid stays at 2 columns (cards ~165px wide). Chips and tabs scroll horizontally (`overflow-x-auto`, `snap-x`, no page scroll).
- Desktop: the same 430px column centered on cream (the A2 phone-column convention). No separate desktop layout.

## Alternatives Considered

### Separate `/terminy` route reusing `components/shared/Pagination` (Rejected)
**Why**: The spec asks for "Pokaż więcej" plus infinite pagination, and the numbered pager is admin-panel styled (Chakra).

### Reusing `components/shared/EmptyState` for visitor empties (Rejected)
**Why**: It uses Chakra with hard-coded hex colors, so it would ignore the organizer palette and break the "tokens only" rule.

### Rendering `GroupVisualization` directly for the mini visual (Rejected)
**Why**: It needs family names and the organizer name (privacy), and it is too large for a card. Reusing only the geometry from `layoutPositions.ts` keeps it anonymous and compact.

### Item listing on the public term page: thumbnail inside the link (Considered, not chosen)
**Why not**: It would duplicate the accessible name and add a larger tap target that competes with the action buttons. A decorative thumbnail outside the link is simpler.

### Owner-only actions inside the directory blocks (Rejected)
**Why**: Editing lives in the panel. Ghosts link there ("Dodaj termin →") rather than duplicating panel forms on the public page.

---

*Generated by ui-mockup-generator subagent*
