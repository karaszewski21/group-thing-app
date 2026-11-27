# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (8 screens, 2 components)

| Screen/Component ID | Mockup | Covered By Task Group(s) | Status |
|---------------------|--------|--------------------------|--------|
| screen:item-create-points | `mockups/dodaj-rzecz-wystawienie-za-punkty.html` | Group 9 (Item create — POINTS mode and price stepper) | ✅ |
| screen:item-edit-points | `mockups/edycja-rzeczy-cena-za-punkty.html` | Group 10 (Item edit — price re-validation) | ✅ |
| screen:item-cards-points | `mockups/karty-przedmiot-w-z-cen-w-punktach.html` | Group 8 (mode tones, HomeView three tiles), Group 11 (cards, My Items) | ✅ |
| screen:item-page-points | `mockups/strona-przedmiotu-za-punkty.html` | Group 12 (Item page and points reservation sheet) | ✅ |
| screen:points-reservation-sheet | `mockups/okno-rezerwacji-za-punkty-saldo.html` | Group 12 (Item page and points reservation sheet) | ✅ |
| screen:search-points-filter | `mockups/wyszukiwanie-filtr-za-punkty.html` | Group 11 (Cards, search filter and My Items) | ✅ |
| screen:admin-points-offers | `mockups/admin-konfiguracja-ofert-za-punkty.html` | Group 13 (Admin config — POINTS offers section) | ✅ |
| screen:account-points-held | `mockups/twoje-punkty-saldo-blokady-historia.html` | Group 14 (Account points — held tile and history) | ✅ |
| component:price-stepper | `mockups/dodaj-rzecz-wystawienie-za-punkty.html` | Group 9 (built), Group 10 (reused) | ✅ |
| component:points-badge | `mockups/karty-przedmiot-w-z-cen-w-punktach.html` | Group 11 (Cards, search filter and My Items) | ✅ |

## Uncovered Items

All screens are covered (10/10).

Notes:
- **Backend dependencies.** The backend groups that feed these screens (3: item-value bounds and config keys; 6: take/confirm/cancel; 7: `points_price`/`held_points` on read models; 2: `held` and `held_amount`) carry no `Visual References`, because they have no UI surface.
- **Recorded deviation from the mockup.** The offer-limit 409 text is the number-neutral „Masz już maksymalną liczbę ofert za punkty ({n}).” (spec L6), not the mockup's „Masz już 5 ofert za punkty — to maksimum.” Group 9 renders the server text verbatim.
- **HomeView has no mockup of its own.** The spec assigns it to `screen:item-cards-points` with the minimal `grid-cols-3` layout (Group 8).
