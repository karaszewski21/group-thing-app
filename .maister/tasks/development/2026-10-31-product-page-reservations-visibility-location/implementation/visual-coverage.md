# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (10 screens + 3 components)

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:product-logged-in | Group 7 (Product page UI) | ✅ |
| screen:product-anonymous | Group 7 (Product page UI) | ✅ |
| screen:product-own | Group 7 (location, own copy), Group 15 (🔒 Prywatny badge + visibility line) | ✅ |
| screen:product-reserved | Group 7 (S1 party view + personal status card + party actions without a mockup), Group 12 (non-party reserved view, header badge, disabled actions + hint) | ✅ |
| screen:sheet-choose-term | Group 7 (`ChooseContextSheet`) | ✅ |
| screen:sheet-personal-pickup | Group 7 (`PersonalPickupSheet`) | ✅ |
| screen:term-participant-items | Group 9 (link rows + intent pill, no take buttons), Group 12 (reserved pill) | ✅ |
| screen:organizer-exchange-board | Group 9 (`ItemCard` tiles), Group 12 (three counts + four tabs + reserved pill) | ✅ |
| screen:owner-items-anonymous | Group 9 (tiles, "Najbliżej"), Group 12 (reserved badge with no name, tabs) | ✅ |
| screen:my-items-location-visibility | Group 8 ("📍 Gdzie są moje rzeczy?" location card), Group 15 (per-item toggle rows + hints) | ✅ |
| component:intent-badge | Group 9 (`ItemTileBadges` intent pill, `INTENT_LABELS`) | ✅ |
| component:reserved-badge | Group 12 (`ItemTileBadges` reserved pill) | ✅ |
| component:visibility-toggle | Group 15 (`VisibilityToggle`) | ✅ |

## Uncovered Items

All screens are covered (13/13).

Note: the product page's party-actions block (confirm/cancel/accept/reject, R8.6) has no mockup. Group 7 implements it from the spec copy only, using the existing `ItemContextActions` button styles, and attaches it to `screen:product-reserved` (and the `own` view).
