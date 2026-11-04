# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:place-create | screen | analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html | /places/new — 2 fields: Lokalizacja (TERYT combobox, name or postal code) + optional Adres (Google, biased to locality); states empty/suggestions/code/chosen/error |
| screen:item-create | screen | analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html | /add/product with required LocationPicker ('+' → /places/new), no-places state, return-with-draft state |
| screen:item-edit | screen | analysis/design-context/mockups/edytuj-rzecz-zmiana-lokalizacji.html | /items/:id/edit with required LocationPicker; transferred item without location banner |
| screen:item-page-location | screen | analysis/design-context/mockups/strona-przedmiotu-blok-lokalizacji.html | Item page location block: public locality label + Maps link; owner-only address; deleted place state |
| screen:places-list | screen | analysis/design-context/mockups/moje-miejsca-lista.html | /places list: locality primary, address secondary |
| component:locality-combobox | component | analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html | TERYT locality combobox with gmina/powiat/województwo disambiguation |
| component:location-picker-required | component | analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html | LocationPicker `required` mode (no 'none' option) |
