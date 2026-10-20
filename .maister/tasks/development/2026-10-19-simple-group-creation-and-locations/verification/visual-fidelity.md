# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match against ASCII wireframes (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md (+ ascii/ui-mockups.md)
**Captured**: verification/screenshots/
**Note**: Revision 3 deviations (native `<select>` + "+" instead of the radiogroup; edit/delete only in `/panel/miejsca`) are intentional and are not counted as drift. Google mode was not exercised (no Maps key; manual mode only).

## Summary
- Total screens/components compared: 17
- Match (✓): 12
- Minor deviation (⚠): 4
- Substantive drift (✗): 0
- Not compared: 4 (component:location-picker-add — no Google key; screen:admin-terms-page — no ADMIN account; screen:first-term-stepper-organizer — state not reached; component:location-picker-list/-edit — superseded by Revision 3)

## Per-Screen Comparison

### screen:stepper-step1 (✓ Match)
- Mockup: ascii/ui-mockups.md#stepper-step1
- Screenshot: verification/screenshots/03-stepper-step1.png, 06-stepper-place-added-selected.png
- Layout: title "Załóż grupę" + close, 2 dots, fields in order Nazwa grupy → Widoczność grupy (default "Prywatna") → Stałe miejsce spotkań (opcjonalnie) → Ile miejsc (opcjonalnie) → "Dalej →" (disabled until name).
- Picker per Revision 3 (select + "+"); inline manual add form inside the sheet, no nested sheet.

### screen:stepper-step2 (✓ Match)
- Mockup: ascii/ui-mockups.md#stepper-step2
- Screenshot: verification/screenshots/07-stepper-step2-prefilled.png
- Eyebrow "Pierwszy termin w grupie „E2E Grupa”", Data i godzina → Opis (opcjonalnie) → Miejsce (prefilled, helper "Domyślne miejsce grupy — możesz zmienić") → Ile miejsc (prefilled 12) → "← Wstecz" / "Dodaj". Second dot active.

### screen:stepper-done (✓ Match)
- Mockup: ascii/ui-mockups.md#stepper-done
- Screenshot: verification/screenshots/08-stepper-done.png
- Copy identical to the mockup; "Przejdź do publicznej strony →", "Gotowe", CTA box "Stwórz publiczną wizytówkę / własny adres →" to /organization.
- Caveat (content, not layout): the copy "zobaczy każdy … bez logowania" is false for the default PRIVATE group (see e2e report §5.3).

### component:group-form-fields (✓ Match)
- Screenshots: 03-stepper-step1.png, 19-edit-group-modal.png, 33-add-group-modal.png
- Same field order in the stepper, "Dodaj nową grupę" and "Edytuj grupę" (the latter adds "Szablon wizualizacji" after the name, as in the mockup).

### component:location-picker (⚠ Minor Deviation — intentional, Revision 3)
- Screenshots: 05-stepper-add-place-manual-form.png, 21-add-term-modal-initial.png
- Native select with "Brak stałego miejsca"/"Brak miejsca" first, then saved places; address of the selected place shown below; "+" toggles the inline add form (aria-expanded). No radiogroup, no per-row Edytuj/Usuń, per Revision 3.

### component:location-picker-empty (⚠ Minor Deviation)
- Screenshot: 03-stepper-step1.png
- Mockup shows "Nie masz jeszcze zapisanych miejsc." plus the manual form immediately when there is no key; the implementation shows the select with only "Brak stałego miejsca" and the "+" button (form opens on "+"). Consistent with Revision 3's select + "+" model; the empty-state message appears only in /panel/miejsca.

### component:location-picker-manual (✓ Match)
- Screenshot: 05-stepper-add-place-manual-form.png
- Nazwa miejsca, Adres (required, "Podaj adres" alert on blank), Notatka, "Zapisz miejsce", "Anuluj"; no "szukaj w Google" link (no key) — correct.

### screen:group-add-modal (✓ Match)
- Screenshot: 33-add-group-modal.png — GroupFormFields, visibility defaults to PRIVATE (no org).

### screen:group-edit-modal (✓ Match)
- Screenshots: 19-edit-group-modal.png, 30-edit-group-deleted-default-usuniete.png — includes "(usunięte)" option for a soft-deleted default.

### screen:term-add-modal (✓ Match)
- Screenshot: 21-add-term-modal-initial.png — Grupa → Data i godzina → Opis → Miejsce (prefilled + helper) → Ile miejsc (prefilled) → Potrzebne rzeczy → "Dodaj termin".

### screen:edit-term-dialog (✓ Match)
- Screenshot: 22-edit-term-dialog.png — Data i godzina → Opis → Miejsce → Ile miejsc → Zapisz → Potrzebne rzeczy. No "Formalizuj stałych członków" section.

### screen:home-view (✓ Match)
- Screenshot: 01-home-no-groups.png — "Załóż grupę" hint with the exact description and "Zacznijmy →". After founding a group the hint becomes "Stwórz wizytówkę" (verified by DOM text).

### component:led-term-card / component:term-place-line (✓ Match)
- Screenshots: 09-spotkania-after-create.png, 16-spotkania-after-rename-no-reload.png — place name, address, notes, "Otwórz w Google Maps", "Brak zapisów · 0/12 miejsc".

### component:attended-term-card (⚠ Minor Deviation)
- Screenshot: 28-user-b-spotkania-zapisane.png — name, address, notes and "1/1 miejsc" pill, no Maps link (correct). Mockup lists address only; the card also shows the notes line. Harmless.

### screen:spotkania-view / component:group-tile (✓ Match)
- Screenshots: 02-spotkania-empty.png, 09-spotkania-after-create.png — "Prowadzę · N" with "+ Załóż grupę" (0 groups) / "+ Dodaj grupę"; tile shows the default place name + address; no "wolne N miejsca" chip; "Zapisane · N" section.

### component:account-menu-zaloz-grupe (⚠ Minor Deviation)
- Screenshot: 11-account-menu-public.png — "Załóż grupę" → /panel/spotkania?nowa=grupa and "Moje miejsca" (after "Ustawienia", per Revision 3) present.
- Deviation: the mockup/INDEX state the AccountMenu never exists inside /panel, but the panel header also renders the "Menu" hamburger (visible in 07-stepper-step2-prefilled.png). Functionally useful; confirm it is intended.

### screen:public-term-page / component:public-term-full (✓ Match)
- Screenshots: 24-public-term-anon-miejsce-block.png, 26-public-term-full-brak-wolnych-miejsc.png, 27-public-term-full-rsvp-enabled.png
- "MIEJSCE" block under the date (name, address, notes, "Otwórz w Google Maps ↗ (nowa karta)"), "Zapisanych 1 z 1", role=status pill "Brak wolnych miejsc", RSVP footer still active.
