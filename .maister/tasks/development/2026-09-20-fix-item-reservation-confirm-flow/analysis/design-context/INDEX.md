# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:rzeczy-tile-baseline | screen | analysis/design-context/ascii/ui-mockups.md#baseline | "Moje rzeczy" item tile, current behavior before the fix (toggles always enabled, badge has no attached actions) |
| screen:rzeczy-tile-available | screen | analysis/design-context/ascii/ui-mockups.md#available-after-fix | Item tile in AVAILABLE state after the fix — unchanged from baseline (toggles enabled, no badge, no new buttons) |
| component:rzeczy-tile-locked | component | analysis/design-context/ascii/ui-mockups.md#component-rzeczy-tile-locked | Item tile in RESERVED/IN_TRANSIT state before the term ends — mode toggles disabled, lock badge shown, no fallback action buttons yet (Bug #1 fix only) |
| component:rzeczy-tile-locked-post-term | component | analysis/design-context/ascii/ui-mockups.md#component-rzeczy-tile-locked-post-term | Item tile in RESERVED/IN_TRANSIT state after the term has ended — mode toggles disabled, lock badge shown, plus new "Odebrał" and "Anuluj wymianę" fallback action buttons (Bug #1 + Bug #4 fix) |
