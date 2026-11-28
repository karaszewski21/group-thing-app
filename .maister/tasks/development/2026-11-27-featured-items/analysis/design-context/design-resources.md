# Design Resources

## TL;DR
Mockups bind to the app's Tailwind 4 theme tokens in `src/frontend/src/app/globals.css` (primary, accent, ink, on-ink, paper, line, stage, cream, teal-soft, orange) and the real shared components `ItemTileBadges`, `ParticipantItemsPreview`, `ItemCard`, `VisibilityToggle`; the admin page follows Chakra UI `PointsConfigPage`. Featured pill = `bg-ink text-on-ink`, ItemTileBadges pill shape.

## Standards (binding)
- .maister/docs/standards/frontend/css.md, components.md, accessibility.md, responsive.md

## Design system
- css-var/tailwind: src/frontend/src/app/globals.css (`--color-*` tokens; themeTokenUsage test forbids hex)
- component: components/shared/ItemTileBadges.tsx (rounded-full font-extrabold px-2 py-0.5 text-[11px])
- component: components/shared/ParticipantItemsPreview.tsx (ItemRow, PREVIEW_ITEM_LIMIT 3)
- component: components/shared/ItemCard.tsx (CORNER_BADGE left offer badge, right `marker` slot)
- component: features/items/VisibilityToggle.tsx (segmented pill), features/items/MyItemsView.tsx card
- component-lib: Chakra UI 3 for admin (features/admin/PointsConfigPage.tsx)

## Skill hints
- next-devtools MCP (not needed for mockups)
