# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
- **Overall: high structural fidelity.** All 7 design IDs were compared: 4 match (✓), 3 have minor deviations (⚠) and none show substantive drift (✗).
- All binding copy matches the mockups word for word: hints, errors, empty states, banner, privacy line and toast.
- The deviations are chrome and data rather than layout:
  - no in-page heading or "← Wróć" on the panel place screens;
  - "+ Dodaj miejsce" sits under the list instead of a header "+";
  - the mockup's "Nowa Wieś Ełcka · miasto" top row cannot appear, because TERYT lists it as a village;
  - anonymous visitors get no "Odbiór osobisty dostępny." line.

## Key Decisions
- **Matched by flow state.** Mockup states were paired with screenshots by flow state (empty, suggestions, postal, chosen, error, return-from-places, banner and so on), not by file name.
- **Compared the Google address state through manual entry only.** No Maps key is set locally, so the address-suggestion part of `screen:place-create` state 4 could not be rendered.

## Open Questions / Risks
- **Places screens.** Should `/places` and `/places/new` get a visible heading and a back link, as the mockups show? Other panel views in the app also have no in-page heading, so this may be a deliberate app-wide convention.

## Summary
- Total screens compared: 7
- Match (✓): 4
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:place-create (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html
- Screenshots:
  - verification/screenshots/01-place-create-empty.png
  - verification/screenshots/03-place-create-nowa-wies-disambiguation.png
  - verification/screenshots/04-place-create-postal-32-650.png
  - verification/screenshots/08-place-create-chosen-chip.png
  - verification/screenshots/07-place-create-validation-error.png
- Layout: a single card with Lokalizacja * above Adres (opcjonalnie), then Zapisz/Anuluj. This matches.
- States:
  - empty ✓ (address disabled, "Najpierw wybierz miejscowość");
  - name suggestions ✓ (with the overflow line);
  - postal ✓ (code shown in each option);
  - chosen chip with "zmień" ✓;
  - error "Wybierz miejscowość z listy" ✓.
- Deviations:
  1. There is no in-page "Dodaj miejsce" heading and no "← Wróć" link. The app header and bottom nav are shown instead.
  2. The mockup's first suggestion "Nowa Wieś Ełcka · miasto" cannot occur: the dictionary lists it as a VILLAGE, so the first rows are plain "Nowa Wieś" villages. TOWN-first ranking itself was verified with "Nowa".
  3. The Google address-suggestion list (state 4) was not rendered, because no API key is set locally.
- Impact: low. The form anatomy and copy are exact.
- Recommendation: confirm that omitting the heading is the panel convention.

### screen:item-create (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html
- Screenshots:
  - verification/screenshots/49-item-create-prefilled-location.png
  - verification/screenshots/27-item-create-no-places-empty-state.png
  - verification/screenshots/31-item-create-first-place-returned.png
- Layout: Zdjęcia → Nazwa → Stan → Kategoria → Opis → Lokalizacja * with `+` → helper → Oddam/Zamienię → Wersja robocza. The order matches.
- States:
  - prefilled ✓;
  - no places ✓ ("Nie masz jeszcze miejsc" + `+` + helper + blocked hint);
  - return from `/places/new` ✓ (place selected, draft and photo intact, toast "Dodano miejsce …").
- Note: the selected option text is the full `label` ("Kęty — ul. Sekretna 13…") where the mockup shows "Kęty, małopolskie". Req. 26 specifies `label`, so this is not counted as a deviation.

### screen:item-edit (✓ Match)
- Mockup: analysis/design-context/mockups/edytuj-rzecz-zmiana-lokalizacji.html
- Screenshots:
  - verification/screenshots/20-item-edit-initial.png
  - verification/screenshots/25-item-edit-banner-no-location.png
  - verification/screenshots/26-item-edit-error-wybierz-lokalizacje.png
- Layout: the required picker with `+` sits under Opis, followed by "Zapisz zmiany" / "Anuluj". This matches.
- States:
  - with location ✓;
  - banner "Ustaw lokalizację, aby wystawić przedmiot." with an empty picker ✓;
  - inline error "Wybierz lokalizację" ✓.

### screen:item-page-location (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/strona-przedmiotu-blok-lokalizacji.html
- Screenshots:
  - verification/screenshots/17-item-page-anonymous.png
  - verification/screenshots/18-item-page-other-user.png
  - verification/screenshots/16-item-page-owner.png
  - verification/screenshots/24-item-page-owner-deleted-place.png
- Layout: the "Lokalizacja przedmiotu" card has 📍 + locality, a detail line and "Otwórz w Mapach". This matches for every viewer.
- Owner: "Widoczne tylko dla Ciebie" + address + "Zmień lokalizację" ✓.
- Owner with a deleted place: "(usunięte)" + "Odbiór osobisty niedostępny — ustaw lokalizację", with no Maps link ✓.
- Deviations:
  1. The anonymous guest gets no "Odbiór osobisty dostępny." line. The logged-in other user does, and the mockup's state 1 covers both viewers. The API reports `personal_pickup_available=false` for anonymous visitors, who see a login CTA instead.
  2. In the deleted state the detail line is the full "gm. Kęty, pow. oświęcimski, małopolskie"; the mockup shows the shorter "gm. Kęty, małopolskie".
- Impact: low.

### screen:places-list (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/moje-miejsca-lista.html
- Screenshot: verification/screenshots/10-places-list-two-rows.png
- Rows: the locality is primary, and the secondary line is "address · voivodeship" or the detail line. The footer note text matches exactly.
- Deviation: the mockup header has "← Panel / Moje miejsca / +". The implementation has no heading and shows a full-width "+ Dodaj miejsce" button below the list. Row actions are separate "Edytuj" and "Usuń" buttons rather than "Edytuj · Usuń" text.
- Impact: low. All the information is present.

### component:locality-combobox (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html
- Screenshots:
  - verification/screenshots/02-place-create-kety-suggestion.png
  - verification/screenshots/04-place-create-postal-32-650.png
  - verification/screenshots/08-place-create-chosen-chip.png
- Option anatomy: a bold name, then a detail line with gm./pow./voivodeship, the postal code prefix in postal mode, and the "· miasto" suffix. Below the options sits the status line "… i N więcej — doprecyzuj wpis" (not an option), and a chosen chip with "zmień". All match.

### component:location-picker-required (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html
- Screenshots:
  - verification/screenshots/12-item-create-initial.png
  - verification/screenshots/26-item-edit-error-wybierz-lokalizacje.png
- Matches:
  - no "none" option, and a disabled "Wybierz miejsce" placeholder;
  - the `+` link;
  - the helper text;
  - the error "Wybierz lokalizację" with `aria-invalid`.
