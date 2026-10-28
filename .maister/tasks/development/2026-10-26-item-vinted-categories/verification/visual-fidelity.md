# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/ (each mockup was rendered in the same browser as `screenshots/mockup-*.png` for side-by-side review)

## TL;DR
- **Verdict: high structural fidelity.** Of 11 IDs: 7 match (✓), 4 deviate in minor ways (⚠), and none have substantive drift (✗).
- The user-facing flows match their mockups closely: the add-item form, the three buttons, the picker in browse and search, and the gift-limit error.
- The deviations are styling on the admin screens (Chakra blue and text-style actions instead of the mockup's green and bordered buttons) and two layout details: the edit-name editor has no separate "Nazwa" label, and the needed-items add row is collapsed behind a button.

## Key Decisions
- Mockups were rendered at the same viewports as the app captures: 390×844 for user screens and 1366×900 for admin. The mockup gallery chrome and annotation tooltips were ignored.
- Component IDs were judged through the screens that host them.

## Open Questions / Risks
- Admin palette: should the admin screens adopt the mockup's mint/green primary, or keep the existing Chakra admin theme? The implementation follows the existing admin theme.

## Summary
- Total screens compared: 11
- Match (✓): 7
- Minor deviation (⚠): 4
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:dodaj-rzecz (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-rzecz.html (`screenshots/mockup-dodaj-rzecz.png`)
- Screenshot: verification/screenshots/01-add-item-empty-390.png
- Layout: single card with "‹ Wróć" and the "Dodaj rzecz" heading, as in the mockup.
- Field order: Nazwa → Stan → Kategoria * → Zdjęcia → buttons ✓
- Primary actions: Oddam (mint, primary) and Zamienię (teal-soft) in a 2-column grid, with Wersja robocza (outline) full width below. All disabled while invalid ✓
- Copy: the implementation adds the hint "Podaj nazwę i wybierz kategorię, aby zapisać." required by FR-21, and the photo hint text.

### screen:dodaj-rzecz-wybrana-kategoria (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-rzecz-wybrana-kategoria.html (`screenshots/mockup-dodaj-rzecz-wybrana-kategoria.png`)
- Screenshot: verification/screenshots/08-add-item-ready-390.png
- Trigger: small ancestor path "Kobiety › Ubrania › Sukienki ›" plus bold leaf "Sukienki midi" and a trailing "›" ✓
- Buttons enabled ✓

### screen:dodaj-rzecz-limit-oddam (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-rzecz-limit-oddam.html (`screenshots/mockup-dodaj-rzecz-limit-oddam.png`)
- Screenshot: verification/screenshots/15-add-item-gift-limit-390.png
- A danger-soft `role="alert"` above the buttons carries the verbatim backend text. Name, Stan and category are kept ✓

### screen:wybor-kategorii-przegladanie (✓ Match)
- Mockup: analysis/design-context/mockups/wyb-r-kategorii-przegl-danie.html (`screenshots/mockup-wyb-r-kategorii-przegl-danie.png`)
- Screenshot: verification/screenshots/03-picker-drill-kobiety-ubrania-390.png
- Bottom sheet "Wybierz kategorię" with ✕, search box "Szukaj kategorii, np. „buty”", "‹ Wstecz", breadcrumb "Wszystkie › Kobiety › **Ubrania**", and rows with "›" for non-leaves. Leaves show "wybierz" ✓
- Content differs (real fixture names vs mockup sample names), which is expected.

### screen:wybor-kategorii-szukaj (✓ Match)
- Mockup: analysis/design-context/mockups/wyb-r-kategorii-szukaj.html (`screenshots/mockup-wyb-r-kategorii-szukaj.png`)
- Screenshot: verification/screenshots/04-picker-search-sukienki-390.png
- Each result shows a small path line over the name with the match highlighted. A non-leaf result has "›". A live count is shown ("16 wyników" vs "6 wyników" in the mockup, different data) ✓
- The cap hint "Pokazano 50 z N — zawęź wyszukiwanie" is not in the mockup but is required by FR-20 (`screenshots/06-picker-search-inne-cap-390.png`).

### screen:edycja-rzeczy-kategoria (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/edycja-rzeczy-kategoria.html (`screenshots/mockup-edycja-rzeczy-kategoria.png`)
- Screenshot: verification/screenshots/13-item-edit-category-editor-390.png
- Match: thumbnail + name + "Wersja robocza" chip under the name; "Kategoria" picker trigger with path + bold leaf; Zapisz / Anuluj.
- Deviation: the name input has no visible "Nazwa" label. It sits under the existing "NAZWA I KATEGORIA" section heading. The editor is embedded in the existing edit page (photos, stan, opis sections around it), not on its own card. The existing re-point explanation text is shown under the buttons.
- Impact: hierarchy preserved; the label difference is small.
- Recommendation: optional. Add a visible "Nazwa" label for parity with "Kategoria".

### screen:admin-drzewo-kategorii (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/admin-drzewo-kategorii.html (`screenshots/mockup-admin-drzewo-kategorii.png`)
- Screenshot: verification/screenshots/27-admin-delete-parent-409-alert-desktop.png (also 21, 22)
- Match: "Kategorie" + "+ Nowa kategoria główna" on the right; 409 alert at the top; filter input; indented rows with ▸/▾; meta column ("N podkategorii" / "N rzeczy"); actions ↑ ↓ "+ Podkategoria" Edytuj Usuń in the same order; actions disabled on a leaf with products.
- Deviation: the actions are borderless text buttons rather than bordered small buttons, and the primary button is Chakra blue rather than green. The subtitle "Drzewo kategorii rzeczy" is not in the mockup.
- Impact: visual texture only.
- Recommendation: confirm whether the admin should follow the mockup palette or the existing admin theme.

### screen:admin-formularz-kategorii (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/admin-formularz-kategorii.html (`screenshots/mockup-admin-formularz-kategorii.png`)
- Screenshot: verification/screenshots/23-admin-new-subcategory-form-desktop.png
- Match: "Nowa podkategoria"; "Kategoria nadrzędna" picker trigger with the hint "Puste = kategoria główna. Nie można zmienić po utworzeniu."; Nazwa; Opis (opcjonalnie); Zapisz / Anuluj.
- Deviation: an extra "Kategorie / Nowa podkategoria" breadcrumb, and a blue Zapisz instead of green. A preselected root parent shows only the bold name, with no path line, which is correct for a root.
- Impact: none functional.

### screen:rzeczy-potrzebne-na-termin (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/rzeczy-potrzebne-na-termin.html (`screenshots/mockup-rzeczy-potrzebne-na-termin.png`)
- Screenshot: verification/screenshots/38-edit-term-dialog-after-edits-390.png (also 31, 37)
- Match: "Potrzebne rzeczy" list of plain names with Usuń; no category anywhere; add field placeholder "np. Termos" with Dodaj.
- Deviation: each row also has "Edytuj", and descriptions render as "Termos — najlepiej 1 l". The add row is collapsed behind "+ Dodaj potrzebną rzecz" and adds an optional "Doprecyzowanie" field and Anuluj. These come from the existing EditTermDialog structure.
- Impact: one extra click to add; more capability than the mockup.

### component:category-tree-picker (✓ Match)
- Mockup: analysis/design-context/mockups/wyb-r-kategorii-szukaj.html
- Screenshots: verification/screenshots/04-picker-search-sukienki-390.png, verification/screenshots/24-admin-parent-picker-any-mode-desktop.png
- The same sheet is used in the add form, the item edit page, the admin product form and the admin parent picker. Any-node mode adds "Kategoria główna (brak)" ✓

### component:item-submit-actions (✓ Match)
- Mockup: analysis/design-context/mockups/dodaj-rzecz.html
- Screenshot: verification/screenshots/08-add-item-ready-390.png
- Oddam primary (mint), Zamienię secondary (teal-soft), Wersja robocza outline full width ✓
