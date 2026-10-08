# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (13 ids; all ASCII, `ascii/ui-mockups.md`)

| Screen/Component ID | Mockup anchor (lines) | Covered By Task Group(s) | Status |
|---|---|---|---|
| screen:org-public-classic | `#org-public-classic` (67-115) | Group 6 (Registry, Renderer and Blocks), Group 7 (Public Page + Owner Pill) | ✅ (override: visitor empty-state card not built, per requirements) |
| screen:org-public-links | `#org-public-links` (116-152) | Group 6 (Registry, Renderer and Blocks), Group 7 (Public Page + Owner Pill) | ✅ |
| component:ghost-block | `#ghost-block` (153-171) | Group 6 (Registry, Renderer and Blocks) | ✅ |
| component:edit-appearance-button | `#edit-appearance-button` (172-187) | Group 7 (Public Page + Owner Pill) | ✅ |
| screen:org-edit-sheet-layout | `#org-edit-sheet-layout` (188-254) | Group 8 (Editor Sheet Core) | ✅ |
| screen:org-edit-sheet-colors | `#org-edit-sheet-colors` (255-302) | Group 9 (Editor Colors Tab) | ✅ |
| component:custom-color-picker | `#custom-color-picker` (303-339) | Group 9 (Editor Colors Tab) | ✅ |
| component:preview-cards | `#preview-cards` (340-364) | Group 9 (Editor Colors Tab) | ✅ |
| component:save-error | `#save-error` (365-385) | Group 8 (Editor Sheet Core); message mapping from Group 4 (`useUpdateOrganization`, non-UI) | ✅ |
| component:unsaved-confirm | `#unsaved-confirm` (386-410) | Group 8 (Editor Sheet Core) | ✅ |
| flow:editor-entry | `#editor-entry-flow` (411-439) | Group 7 (owner check, `?edit=1` gating), Group 8 (open/close/exit paths, guard), Group 10 (entry points) | ✅ |
| component:account-menu-entry | `#account-menu-entry` (440-458) | Group 10 (Entry Points) | ✅ |
| component:home-hint | `#home-hint` (459-476) | Group 10 (Entry Points) | ✅ |

## Uncovered Items

All screens covered (13/13).

Documented deviation (not an uncovered id): the visitor empty-state card drawn in Mockup 1 is intentionally not implemented in A2 (requirements Phase 4 decision; spec "Visual Design" override). Group 6/7 acceptance criteria state this explicitly.
