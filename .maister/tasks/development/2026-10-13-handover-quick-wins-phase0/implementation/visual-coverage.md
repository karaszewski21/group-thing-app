# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (mockups in `analysis/design-context/ascii/ui-mockups.md`)

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| component:add-to-calendar | Group 8 (calendar util + AddToCalendarButton), Group 9 (item page `sm`/down variant), Group 11 (in-sheet `lg`/up variant, Esc-in-sheet behaviour) | Covered |
| screen:take-success-sheet | Group 11 (TakeSuccessSheet + useItemTake), Group 7 (krag ModalSheet Esc/focus/fallback chrome) | Covered (deviation M2: `Zobacz rzecz` → `/product/{itemId}`) |
| screen:swap-accept-success | Group 11 (SwapAcceptSuccessSheet + RzeczyView), Group 7 (panel ModalSheet registration) | Covered |
| screen:item-page-reservation | Group 9 (ItemTimeline/ItemStatusCard party view) | Covered |
| screen:pending-actions-modal-app-wide | Group 10 (PendingActionsHost, snooze, copy, mount), Group 7 (krag ModalSheet a11y + open-sheet registry) | Covered (deviation M3: also waits for RequestAccessDialog and UnsavedChangesDialog) |
| screen:settings | Group 6 (UstawieniaView cleanup) | Covered |

## Uncovered Items

All screens covered (6/6).
