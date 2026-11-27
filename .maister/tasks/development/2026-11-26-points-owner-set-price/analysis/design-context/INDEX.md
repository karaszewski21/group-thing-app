# Design Context Index

## TL;DR
Eight HTML mockups cover POINTS mode: the item create form and the edit form with the price stepper, cards and the item page, the reservation sheet with the balance, the search filter, the admin config section, and the account points page.
- Panel screens use the globals.css tokens.
- The admin screen uses the Chakra/slate admin style.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:item-create-points | screen | analysis/design-context/mockups/dodaj-rzecz-wystawienie-za-punkty.html | ItemCreateView with a third mode „Za punkty”, the price stepper ±step, the suggestion and range, the photo hint, error/limit states |
| screen:item-edit-points | screen | analysis/design-context/mockups/edycja-rzeczy-cena-za-punkty.html | ItemEditForm: price re-validation on a condition change, clamp case, settlement at the HOLD amount note |
| screen:item-cards-points | screen | analysis/design-context/mockups/karty-przedmiot-w-z-cen-w-punktach.html | ItemCard grid with an orange price badge „60 pkt” beside Oddam/Zamienię |
| screen:item-page-points | screen | analysis/design-context/mockups/strona-przedmiotu-za-punkty.html | Product page for a POINTS item: price, „Biorę za 60 pkt”, owner (held, cancel) and buyer (confirm) views |
| screen:points-reservation-sheet | screen | analysis/design-context/mockups/okno-rezerwacji-za-punkty-saldo.html | ModalSheet with price / available / after, an insufficient-funds blocked state, 409 messages |
| screen:search-points-filter | screen | analysis/design-context/mockups/wyszukiwanie-filtr-za-punkty.html | Search offer_type chips with „Za punkty” |
| screen:admin-points-offers | screen | analysis/design-context/mockups/admin-konfiguracja-ofert-za-punkty.html | PointsConfigPage un-dimmed „Oferty za punkty” section: limit, ratios, cap, step, live example |
| screen:account-points-held | screen | analysis/design-context/mockups/twoje-punkty-saldo-blokady-historia.html | /points: available / held / reputation tiles; history with HOLD/SALE/RELEASE |
| component:price-stepper | component | analysis/design-context/mockups/dodaj-rzecz-wystawienie-za-punkty.html | −/+ buttons around a numeric text input with the suggestion and range, inline role=alert error |
| component:points-badge | component | analysis/design-context/mockups/karty-przedmiot-w-z-cen-w-punktach.html | Orange offer badge showing points_price |
