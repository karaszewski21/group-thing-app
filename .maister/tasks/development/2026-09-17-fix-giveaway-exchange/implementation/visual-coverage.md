# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|---------------------------|--------|
| component:listing-row-confirm-button | Group 3 (Frontend — term-page confirm button wiring + term-end gating) | ✅ |
| component:swap-propose-dialog | Group 5 (Frontend — SWAP counter-offer item-mode filtering) | ✅ |
| component:global-pending-actions-modal | Group 4 (Frontend — resolvePendingReservationId GIFT/LEND owner+taker branches) | ✅ |

## Uncovered Items

All screens covered. All three components in `analysis/design-context/INDEX.md` are wiring/gating/filtering fixes to already-shipped, unchanged markup (per spec.md's Visual Design section and the mockups' "Fidelity level: exact" note) — no new visual components, layouts, or labels are introduced, so each maps 1:1 to the task group that fixes its underlying wiring/data-resolution logic.
