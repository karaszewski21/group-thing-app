# Design Context Index

## TL;DR
There are 10 HTML mockups in `mockups/` and design tokens in `design-resources.md`. Together they cover:
- the product page: 3 actions, 4 viewer variants and 2 sheets;
- tiles on the term page, organizer page and owner items page;
- the "Moje rzeczy" page, with inventory location and per-item visibility.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:product-logged-in | screen | analysis/design-context/mockups/strona-produktu-zalogowany-3-akcje.html | Product page for a logged-in viewer. Shows the location name, the owner's upcoming terms/events (read-only) and 3 actions: Odbiorę osobiście / Wybieram termin / Napisz o przedmiocie |
| screen:product-anonymous | screen | analysis/design-context/mockups/strona-produktu-niezalogowany.html | Product page for an anonymous viewer. No physical location; login/register gate |
| screen:product-own | screen | analysis/design-context/mockups/strona-produktu-m-j-przedmiot.html | Product page for the owner. Full address, private badge, edit button |
| screen:product-reserved | screen | analysis/design-context/mockups/strona-produktu-zarezerwowana.html | Reserved item. "Zarezerwowana · przez Anna" badge, actions disabled, chat still available |
| screen:sheet-choose-term | screen | analysis/design-context/mockups/arkusz-wybieram-termin.html | "Wybieram termin" sheet. Radio list of shared eligible contexts; SWAP continues to SwapProposeDialog |
| screen:sheet-personal-pickup | screen | analysis/design-context/mockups/arkusz-odbior-osobi-cie.html | "Odbiorę osobiście" confirm sheet. Location name only, address agreed in chat |
| screen:term-participant-items | screen | analysis/design-context/mockups/strona-terminu-rzeczy-uczestnik-w.html | Term page ParticipantItemsPreview. Intent and reserved badges, whole row links to the product page, no take buttons |
| screen:organizer-exchange-board | screen | analysis/design-context/mockups/strona-organizatora-tablica-wymiany-i-liczniki.html | Organizer page. Counts: Chcę oddać / Chcę się zamienić / Zarezerwowane, plus tabs and ItemCard tiles |
| screen:owner-items-anonymous | screen | analysis/design-context/mockups/rzeczy-w-a-ciciela-niezalogowany.html | Owner items page for an anonymous viewer. Reserved badge without a name |
| screen:my-items-location-visibility | screen | analysis/design-context/mockups/moje-rzeczy-lokalizacja-i-widoczno.html | "Moje rzeczy" page. Global inventory LocationPicker, per-item Publiczna/Prywatna toggle (only when a mode is set) |
| component:intent-badge | component | analysis/design-context/mockups/strona-terminu-rzeczy-uczestnik-w.html | "Chcę oddać" (GIFT, primary-soft) / "Chcę się zamienić" (SWAP, accent-soft) via EXCHANGE_MODE_TONE |
| component:reserved-badge | component | analysis/design-context/mockups/strona-organizatora-tablica-wymiany-i-liczniki.html | Teal-soft "Zarezerwowana" pill, with "· przez <imię>" added for logged-in viewers |
| component:visibility-toggle | component | analysis/design-context/mockups/moje-rzeczy-lokalizacja-i-widoczno.html | Publiczna/Prywatna segmented toggle (aria-pressed) |
