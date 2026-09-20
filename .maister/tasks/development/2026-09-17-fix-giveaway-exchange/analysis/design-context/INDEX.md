# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| component:listing-row-confirm-button | component | analysis/design-context/ascii/ui-mockups.md#listing-row-confirm-before-after | Term-page `ListingRow` "Potwierdź odbiór" confirm button — rewired to call `confirmTransaction` and gated on term-end (Root Cause A) |
| component:swap-propose-dialog | component | analysis/design-context/ascii/ui-mockups.md#swap-propose-dialog-filtered | `SwapProposeDialog` item picker — filtered to "zamienię"-tagged items, with empty-state variant |
| component:global-pending-actions-modal | component | analysis/design-context/ascii/ui-mockups.md#global-pending-actions-modal-gift-lend | `GlobalPendingActionsModal` "Potwierdź transakcję" dialog — now reliably reachable for GIFT/LEND, not just SWAP (Root Cause B) |
