# Design Context Index

Task: B — public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts. Paths are relative to the task directory.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:layout-classic | screen | analysis/design-context/ascii/ui-mockups.md#layout-classic | `/:slug` CLASSIC, updated: hero, share, stats, about, upcoming-terms:list (primary), exchange-counts, footer |
| screen:layout-schedule | screen | analysis/design-context/ascii/ui-mockups.md#layout-schedule | `/:slug` SCHEDULE: hero:compact, next-term-cta, agenda:by-day (primary) with circle chips, exchange-counts |
| screen:layout-circles | screen | analysis/design-context/ascii/ui-mockups.md#layout-circles | `/:slug` CIRCLES: circles-grid:cards (≥2 circles) or featured + circle-visual:mini (1 circle) |
| screen:layout-exchange | screen | analysis/design-context/ascii/ui-mockups.md#layout-exchange | `/:slug` EXCHANGE: exchange-counts tabs, exchange-board:grid2 (primary), needed-items, upcoming-terms:compact |
| screen:layout-links | screen | analysis/design-context/ascii/ui-mockups.md#layout-links | `/:slug` LINKS with the directory buttons Najbliższe zajęcia / Wszystkie terminy (N) / Wymiana rzeczy (N) |
| screen:owner-edit-empty | screen | analysis/design-context/ascii/ui-mockups.md#owner-edit-empty | Visitor empty state, owner ghosts with panel CTAs, loading skeletons, directory-unavailable rules |
| screen:organizer-terms | screen | analysis/design-context/ascii/ui-mockups.md#screen-terminy | NEW `/:slug/terminy`: full agenda by day, circle chips, Pokaż więcej, back link, organizer palette |
| screen:editor-layout-tab | screen | analysis/design-context/ascii/ui-mockups.md#editor-layout-tab | EditorSheet LayoutTab: 5 layout cards with data-driven multi "Polecany" badges |
| screen:term-page-listing-thumb | screen | analysis/design-context/ascii/ui-mockups.md#term-page-thumbnail | PublicTermView / AttendeeList ListingRow before and after the 48px thumb_url thumbnail |
| component:block-library | component | analysis/design-context/ascii/ui-mockups.md#block-library | Overview of all new directory blocks and shared visual patterns |
| component:stats | component | analysis/design-context/ascii/ui-mockups.md#stats | StatsBlock tiles3: circles / terms in 60 days / families (≥3); hidden if <2 tiles |
| component:upcoming-terms | component | analysis/design-context/ascii/ui-mockups.md#upcoming-terms | UpcomingTermsBlock: `list` (date tiles + link to /terminy) and `compact` (3 chips) |
| component:next-term-cta | component | analysis/design-context/ascii/ui-mockups.md#next-term-cta | NextTermCtaBlock card: first upcoming term with a "Zobacz i zapisz się" CTA |
| component:agenda | component | analysis/design-context/ascii/ui-mockups.md#agenda | AgendaBlock by-day + shared AgendaList; dayjs Polish day headers; Pokaż kolejne terminy |
| component:circle-filter-chips | component | analysis/design-context/ascii/ui-mockups.md#agenda | CircleFilterChips radiogroup (≥2 circles) driving group_id in the terms query |
| component:circles-grid | component | analysis/design-context/ascii/ui-mockups.md#circles-grid | CirclesGridBlock `cards` / `featured`; zapisanych N, next term, upcoming_term_count |
| component:circle-visual-mini | component | analysis/design-context/ascii/ui-mockups.md#circle-visual-mini | CircleVisualMiniBlock: anonymous seats on CIRCLE/PITCH/TABLE geometry from utils/layoutPositions.ts |
| component:exchange-counts | component | analysis/design-context/ascii/ui-mockups.md#exchange-counts | ExchangeCountsBlock `tiles3` / `tabs` (filters the board); GIFT/SWAP/LEND tones |
| component:exchange-board | component | analysis/design-context/ascii/ui-mockups.md#exchange-board | ExchangeBoardBlock grid2 (≤12 items), links to the term page, no lister |
| component:exchange-item-card | component | analysis/design-context/ascii/ui-mockups.md#exchange-board | ExchangeItemCard: SafeImage/PhotoPlaceholder thumb, mode pill (Oddam/Zamienię/Wypożyczę), condition, pickup date |
| component:needed-items | component | analysis/design-context/ascii/ui-mockups.md#needed-items | NeededItemsBlock read-only list; "Zapewnione" claimed pill, no names |
| component:empty-state-visitor | component | analysis/design-context/ascii/ui-mockups.md#empty-state-visitor | EmptyStateBlock visitor with per-layout copy + injected Share link-stack (token-based, not Chakra EmptyState) |
| component:ghost-directory | component | analysis/design-context/ascii/ui-mockups.md#ghost-directory | GhostBlock extended: per-block GHOST_COPY with panel CTA link; neutral variant when the directory is unavailable |
| component:block-skeleton | component | analysis/design-context/ascii/ui-mockups.md#block-skeleton | BlockSkeleton pulse placeholders while directoryStatus is loading |
| component:link-stack-directory | component | analysis/design-context/ascii/ui-mockups.md#layout-links | LinkStackBlock with directory buttons and visibility rules |
| component:hero-compact | component | analysis/design-context/ascii/ui-mockups.md#layout-schedule | HeroBlock `compact` variant (paper bar, avatar, name, inline Share) for SCHEDULE/EXCHANGE |
| component:layout-card-badge | component | analysis/design-context/ascii/ui-mockups.md#editor-layout-tab | LayoutTab card with recommendWhen-driven "Polecany" pill; no badges while loading |
| component:listing-thumb | component | analysis/design-context/ascii/ui-mockups.md#term-page-thumbnail | 48×48 SafeImage thumbnail in ListingRow (ListingRowVM.thumbUrl) |
