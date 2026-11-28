# Visual Coverage Matrix

## TL;DR
All 10 design IDs (7 screens, 3 components) listed in `analysis/design-context/INDEX.md` are covered by at least one task group: groups 5, 6 and 7 between them.
Some of these screens also need backend work. Groups 3 and 4 do it. Those groups have no UI, so they carry no Visual References.

## Key Decisions
- **The mockups and the existing app conflict on three details; the existing app wins (spec Key Decisions).**
  - Errors show in the existing bottom `ToastPill`.
  - The featured chip goes first in the „Moje rzeczy” chip row.
  - „Settings” is placed right after „Points” in the nav.

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:my-items-featured-toggle | Group 6 („Moje rzeczy” Featured Toggle); backend: Group 3 | ✅ |
| screen:my-items-featured-errors | Group 6 (AppDataContext toast + refresh); backend 409s: Group 3 | ✅ |
| screen:term-page-featured-first | Group 5 (termViewModel sort, ParticipantItemsPreview); backend order: Group 4 | ✅ |
| screen:event-page-featured-first | Group 5 (eventViewModel, ParticipantItemsPreview); backend window: Group 4 | ✅ |
| screen:owner-items-featured-first | Group 5 (OwnerItemsList, ProfileItems, RecentItemsBlock); backend order: Group 4 | ✅ |
| screen:product-page-featured-badge | Group 5 (ItemHeader); backend `ItemActionsResponse.is_featured`: Group 4 | ✅ |
| screen:admin-settings | Group 7 (SettingsPage, route, nav); backend API: Group 2 | ✅ |
| component:featured-pill | Group 5 (ItemTileBadges); reused as the chip in Group 6 | ✅ |
| component:item-card-featured-marker | Group 5 (ItemCard) | ✅ |
| component:featured-toggle | Group 6 (FeaturedToggle) | ✅ |

## Uncovered Items

All screens covered (10 of 10).
