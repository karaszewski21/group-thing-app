# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (9 screens + 19 components = 28 IDs). Mockups: `analysis/design-context/ascii/ui-mockups.md`, where the anchors match the INDEX sources.

| Screen/Component ID | Mockup anchor (lines) | Covered By Task Group(s) | Status |
|---------------------|-----------------------|--------------------------|--------|
| screen:layout-classic | #layout-classic (l.314–350) | Group 11 (Layouts) | ✅ |
| screen:layout-schedule | #layout-schedule (l.351–388) | Group 11 (Layouts), Group 9 (agenda, next-term-cta) | ✅ |
| screen:layout-circles | #layout-circles (l.389–426) | Group 11 (Layouts), Group 10 (circles-grid) | ✅ |
| screen:layout-exchange | #layout-exchange (l.427–465) | Group 11 (Layouts), Group 10 (exchange-board, needed-items) | ✅ |
| screen:layout-links | #layout-links (l.466–490) | Group 11 (Layouts + LinkStackBlock) | ✅ |
| screen:owner-edit-empty | #owner-edit-empty (l.491–532) | Group 8 (renderer rules, EmptyState, Ghost, Skeleton), Group 11 (per-layout behaviour) | ✅ |
| screen:organizer-terms | #screen-terminy (l.533–574) | Group 13 (OrganizerTermsPage) | ✅ |
| screen:editor-layout-tab | #editor-layout-tab (l.575–621) | Group 12 (Editor badges), Group 8 (LayoutTab `isRecommended` wiring) | ✅ |
| screen:term-page-listing-thumb | #term-page-thumbnail (l.622–652) | Group 14 (Listing thumbnail) | ✅ |
| component:block-library | #block-library (l.77–313) | Group 9 (shared patterns); all of its blocks are covered by Groups 8, 9 and 10 | ✅ |
| component:stats | #stats (l.82–96) | Group 9 | ✅ |
| component:upcoming-terms | #upcoming-terms (l.97–121) | Group 9 | ✅ |
| component:next-term-cta | #next-term-cta (l.122–138) | Group 9 | ✅ |
| component:agenda | #agenda (l.139–164) | Group 9 (AgendaBlock + AgendaList), Group 13 (AgendaList reuse) | ✅ |
| component:circle-filter-chips | #agenda (l.139–164) | Group 9, Group 13 | ✅ |
| component:circles-grid | #circles-grid (l.165–186) | Group 10 | ✅ |
| component:circle-visual-mini | #circle-visual-mini (l.187–205) | Group 10 (`CircleVisualMini`, embedded in `circles-grid:featured`) | ✅ |
| component:exchange-counts | #exchange-counts (l.206–220) | Group 10 (`tiles3`; the `tabs` variant is delivered inside exchange-board per L-6) | ✅ |
| component:exchange-board | #exchange-board (l.221–242) | Group 10 | ✅ |
| component:exchange-item-card | #exchange-board (l.221–242) | Group 10 | ✅ |
| component:needed-items | #needed-items (l.243–258) | Group 10 | ✅ |
| component:empty-state-visitor | #empty-state-visitor (l.259–276) | Group 8 | ✅ |
| component:ghost-directory | #ghost-directory (l.277–295) | Group 8 | ✅ |
| component:block-skeleton | #block-skeleton (l.296–313) | Group 8 | ✅ |
| component:link-stack-directory | #layout-links (l.466–490) | Group 11 | ✅ |
| component:hero-compact | #layout-schedule (l.351–388) | Group 11 | ✅ |
| component:layout-card-badge | #editor-layout-tab (l.575–621) | Group 12 | ✅ |
| component:listing-thumb | #term-page-thumbnail (l.622–652) | Group 14 | ✅ |

## Uncovered Items

All screens covered (28/28).

Spec-approved composition deviations. The items are still covered, only in a different form:
- `component:exchange-counts` `tabs` variant: it is rendered as the tab strip inside `exchange-board:grid2` in EXCHANGE, not as a separate slot. The user accepted this on 2026-10-09 (audit L-6).
- `component:circle-visual-mini`: it is a non-block component (`CircleVisualMini.tsx`) embedded in `circles-grid:featured`, not a separate `circle-visual` block id. The mockup note on circle-visual allows this.
