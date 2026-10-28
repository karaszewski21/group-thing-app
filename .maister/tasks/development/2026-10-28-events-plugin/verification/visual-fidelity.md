# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/ (runtime `NN-*.png`, rendered mockups `mockup-*.png`)

## TL;DR
- Overall the implementation follows the mockups closely: **8 match, 3 minor deviations, 0 substantive drift** across 11 entries (9 screens + 2 components).
- The deviations: the saving screen has no progress bar; the hub's tile design comes from the existing app rather than the mockup; the empty-form date prefill is absent, a correction the spec called for.
- The runtime captures used the test-only `/api/plugins` shim described in the E2E report (C1). Without it, only the `event-plugin-unavailable` screen can be reached.

## Open Questions / Risks
- `event-saving`: should the mockup's progress bar be built, or the mockup updated? (Upload progress is not observable through `uploadImage`.)

## Summary
- Total screens compared: 11 (9 screens + 2 components)
- Match (✓): 8
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:event-form-empty (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/formularz-nowego-wydarzenia-pusty.html (render: verification/screenshots/mockup-formularz-nowego-wydarzenia-pusty.png)
- Screenshot: verification/screenshots/02-event-form-empty.png
- Layout: host SubPageHeader "Nowe wydarzenie" with back button above the plugin iframe ✓
- Field order: intro → Baner (opcjonalnie) → Nazwa → Początek (date + time) → Koniec (opcjonalnie, tego samego dnia) → Lokalizacja → Opis + "0 / 2000" → submit + hint ✓
- Deviation: date and time are blank instead of the mockup's 15.11.2026 / 14:00 / 18:00 prefill, and the hint reads "JPG" instead of "JPEG". Both are corrections required by the spec, so this is not drift.
- Primary action: "Zapisz wydarzenie" is `aria-disabled` with the visible hint below ✓

### screen:event-form-filled (✓ Match)
- Mockup: analysis/design-context/mockups/formularz-wype-niony-z-banerem.html (render: verification/screenshots/mockup-formularz-wype-niony-z-banerem.png)
- Screenshot: verification/screenshots/15-form-with-banner.png, verification/screenshots/10-form-filled-location.png
- Layout: banner preview (blob image) with "Zmień"/"Usuń" chips; date + time row; end time; location row showing name, address and "Zmień ›"; description with counter ✓
- Copy text: labels and the "opcjonalnie" markers match ✓

### screen:event-form-errors (✓ Match)
- Mockup: analysis/design-context/mockups/b-dy-walidacji.html (render: verification/screenshots/mockup-b-dy-walidacji.png)
- Screenshot: verification/screenshots/04-validation-errors.png, verification/screenshots/03-blocked-submit-errors.png
- Inline red errors under each field, with red-bordered inputs: name.blank / name.length, start.past, end.notAfter. The texts are identical to the mockup ✓

### screen:event-location-picker (✓ Match)
- Mockup: analysis/design-context/mockups/wyb-r-lokalizacji.html (render: verification/screenshots/mockup-wyb-r-lokalizacji.png)
- Screenshot: verification/screenshots/11-location-sheet-list.png, verification/screenshots/07-location-sheet.png, verification/screenshots/09-add-place-errors.png
- Layout: bottom sheet over a dimmed form, "Lokalizacja" title with round ✕, the selected place highlighted in mint, a dashed "+ Dodaj nowe miejsce", and a "Bez lokalizacji" pill ✓
- States covered: empty list, list with a selection, add-place form with errors

### screen:event-saving (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/zapisywanie-wydarzenia.html (render: verification/screenshots/mockup-zapisywanie-wydarzenia.png)
- Screenshot: verification/screenshots/19-saving-step1.png, verification/screenshots/20-saving-step2-banner.png
- Matches: "Zapisujemy „…”…" title, a card with ✓ "Wydarzenie zapisane" + spinner "Wysyłanie banera…", "Nie zamykaj tej strony.", and a faded, disabled "Zapisywanie…" pill
- Deviation: the mockup's horizontal progress bar is absent
- Impact: none functionally
- Recommendation: accept, or add an indeterminate bar

### screen:event-saved (✓ Match)
- Mockup: analysis/design-context/mockups/potwierdzenie-zapisu.html (render: verification/screenshots/mockup-potwierdzenie-zapisu.png)
- Screenshot: verification/screenshots/13-event-saved.png
- Mint rounded card: "Wydarzenie zapisane", name, "niedziela, 15 listopada · 14:00–18:00", location line; primary "Dodaj kolejne" and secondary "Wróć do dodawania" ✓

### screen:event-banner-failed (✓ Match)
- Mockup: analysis/design-context/mockups/b-d-wysy-ania-banera.html (render: verification/screenshots/mockup-b-d-wysy-ania-banera.png)
- Screenshot: verification/screenshots/17-banner-failed.png
- Saved card, then a pink alert with banner.failed (plus the 409 detail line, as specified), then "Spróbuj ponownie" (primary) and "Pomiń baner" (secondary) ✓

### screen:event-plugin-unavailable (✓ Match)
- Mockup: analysis/design-context/mockups/plugin-niedost-pny.html (render: verification/screenshots/mockup-plugin-niedost-pny.png)
- Screenshot: verification/screenshots/21-plugin-unavailable.png
- Card with a 🎈 badge, the heading "Plugin wydarzeń jest niedostępny", the subtext, and a "Wróć do dodawania" pill ✓

### screen:add-hub-toast (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/hub-dodawania-z-toastem.html (render: verification/screenshots/mockup-hub-dodawania-z-toastem.png)
- Screenshot: verification/screenshots/14-add-hub-toast.png
- Matches: a dark pill toast "Wydarzenie „…” zapisane" above the bottom nav; the "Wydarzenie / Jednorazowe: piknik, urodziny" tile
- Deviation: the hub uses the app's existing "Co dodajesz?" coloured tiles ("Rzecz", "Szukam rzeczy", "Termin spotkania") instead of the mockup's plain "Dodaj" cards
- Impact: none; the hub is outside this task's scope and predates it
- Recommendation: none

### component:banner-picker (✓ Match)
- Mockup: analysis/design-context/mockups/formularz-wype-niony-z-banerem.html
- Screenshot: verification/screenshots/02-event-form-empty.png (drop zone), verification/screenshots/15-form-with-banner.png (DOM-verified preview + chips)
- Dashed drop zone "+ Dodaj baner" with "JPG, PNG lub WebP, do 5 MB"; the preview has "Zmień"/"Usuń" chips ✓

### component:location-field (✓ Match)
- Mockup: analysis/design-context/mockups/wyb-r-lokalizacji.html
- Screenshot: verification/screenshots/10-form-filled-location.png, verification/screenshots/02-event-form-empty.png
- Row button with the placeholder "Wybierz lub dodaj miejsce ›", or name + address + "Zmień ›" once set; `type="button"`, `aria-haspopup="dialog"` ✓
