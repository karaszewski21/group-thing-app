# Visual Coverage Matrix

## TL;DR
All 13 design-context entries in `analysis/design-context/INDEX.md` (11 screens and 2 components) are covered by at least one task group.
- Groups 10, 11, 14 and 16 cover them directly.
- Group 13 covers the take/swap sheets that two item screens use.
- Group 12 reuses the owner-items card grid as a style reference.

## Key Decisions
- **The 8 item-page entries are owned by Group 14** (`ItemContextActions`, one view kind per screen). Group 13 also covers `screen:item-gift-eligible` (the event `TakeSuccessSheet`) and `screen:item-swap-picker` (`SwapProposeDialog`), because those sheets live in the generalised take flow.
- **`screen:owner-items-nearest-term` is also referenced by Group 12** — the organizer "Ostatnio dodane rzeczy" block has no mockup of its own and reuses that screen's card grid.

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:owner-items-nearest-term | Group 11 (Owner Items Page), Group 12 (Organizer Recent Items Block, card grid only) | Covered |
| screen:owner-items-chat-only | Group 11 (Owner Items Page) | Covered |
| screen:event-participants-preview | Group 10 (Shared Participants Preview) | Covered |
| component:participant-items-preview | Group 10 (Shared Participants Preview) | Covered |
| screen:item-gift-eligible | Group 14 (Item Page Context Actions), Group 13 (Context-Generic Take Flow: TakeSuccessSheet) | Covered |
| component:item-context-actions | Group 14 (Item Page Context Actions) | Covered |
| screen:item-swap-picker | Group 14 (Item Page Context Actions: Zamienię), Group 13 (Context-Generic Take Flow: SwapProposeDialog) | Covered |
| screen:item-not-signed-up | Group 14 (Item Page Context Actions) | Covered |
| screen:item-anonymous-gate | Group 14 (Item Page Context Actions) | Covered |
| screen:item-stale-context | Group 14 (Item Page Context Actions) | Covered |
| screen:item-no-context | Group 14 (Item Page Context Actions) | Covered |
| screen:item-own | Group 14 (Item Page Context Actions) | Covered |
| screen:event-delete-cancels | Group 16 (Event Delete Dialog) | Covered |

## Uncovered Items

All screens are covered.
