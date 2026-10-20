# Design Context Index

Stable screen/component IDs for the implementation-planner (`Visual References`). All sources are relative to this directory's parent (`analysis/design-context/`).

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:stepper-step1 | screen | ascii/ui-mockups.md#stepper-step1 | "Załóż grupę" step 1: GroupFormFields (name, visibility default PRIVATE/PUBLIC, LocationPicker "Stałe miejsce spotkań", "Ile miejsc") in the panel ModalSheet |
| screen:stepper-step2 | screen | ascii/ui-mockups.md#stepper-step2 | Step 2: first term (date/time, description, "Miejsce" prefilled from group default, "Ile miejsc" prefilled), Wstecz/Dodaj |
| screen:stepper-done | screen | ascii/ui-mockups.md#stepper-done | Done screen: public term link, "Gotowe", optional "Stwórz publiczną wizytówkę / własny adres" CTA to /organization |
| component:group-form-fields | component | ascii/ui-mockups.md#group-form-modals | Shared `GroupFormFields` (name, optional layout select, visibility, LocationPicker, capacity) used by stepper step 1 and both group modals |
| component:location-picker | component | ascii/ui-mockups.md#location-picker | Shared inline `LocationPicker`: props, radiogroup contract, no nested sheet |
| component:location-picker-empty | component | ascii/ui-mockups.md#location-picker-empty | Empty state: search input shown immediately (manual form when no Google key) |
| component:location-picker-list | component | ascii/ui-mockups.md#location-picker-list | List state: "Brak miejsca" radio, saved places (name, address, notes) with Edytuj/Usuń, "(usunięte)" row for a soft-deleted selection, "+ Dodaj nowe miejsce" |
| component:location-picker-add | component | ascii/ui-mockups.md#location-picker-add | Add-new via Google Places Autocomplete: own combobox/listbox inside the sheet, Esc preventDefault, label + notes form, "Zapisz miejsce" |
| component:location-picker-manual | component | ascii/ui-mockups.md#location-picker-manual | Manual mode: name, address (required), notes; source=MANUAL |
| component:location-picker-edit | component | ascii/ui-mockups.md#location-picker-edit | Inline edit row: name/notes editable, address editable only for MANUAL rows, Zapisz/Anuluj, focus management |
| screen:group-add-modal | screen | ascii/ui-mockups.md#group-form-modals | "Dodaj nową grupę" modal using GroupFormFields (createAdditionalMyCircle with defaults) |
| screen:group-edit-modal | screen | ascii/ui-mockups.md#group-form-modals | "Edytuj grupę" modal using GroupFormFields + "Szablon wizualizacji" (PATCH with null-to-clear) |
| screen:term-add-modal | screen | ascii/ui-mockups.md#term-forms | "Dodaj termin zajęć" modal with "Miejsce" + "Ile miejsc" prefilled on group select |
| screen:first-term-stepper-organizer | screen | ascii/ui-mockups.md#term-forms | FirstTermStepperOrganizer one-step form with the two new fields, labels unchanged |
| screen:edit-term-dialog | screen | ascii/ui-mockups.md#term-forms | EditTermDialog with "Miejsce" (term value, incl. soft-deleted row) + "Ile miejsc", diff-PATCH |
| screen:home-view | screen | ascii/ui-mockups.md#home-view | HomeView: reworded hints matrix ("Załóż grupę", "Stwórz wizytówkę"), merged top-3 led + attended + membership-only term cards (deduped, led > attended > membership); panel header has no hamburger |
| component:term-place-line | component | ascii/ui-mockups.md#home-view | `TermPlaceLine`: place name, address, notes, "Otwórz w Google Maps" link, "X/Y miejsc"; hidden when null; no nested anchors inside Link cards |
| component:led-term-card | component | ascii/ui-mockups.md#home-view | organizerTermCard extended with TermPlaceLine and " · X/Y miejsc" in signupSummaryChip |
| component:attended-term-card | component | ascii/ui-mockups.md#home-view | Guest Link card (attended terms from MyAttendanceResponse, and membership-only terms of guestCircles from TermResponse) extended with address line and capacity pill ("X/Y miejsc" attended, "Y miejsc" membership-only; no Maps link) |
| screen:spotkania-view | screen | ascii/ui-mockups.md#spotkania-view | SpotkaniaView: sections "Prowadzę" (+ Załóż grupę / + Dodaj grupę, tiles with default place, terms) and "Zapisane" (my RSVPs plus guestCircles terms, deduped) |
| component:group-tile | component | ascii/ui-mockups.md#spotkania-view | Spotkania group tile: default place name + address, "wolne N miejsca" chip removed |
| component:account-menu-zaloz-grupe | component | ascii/ui-mockups.md#account-menu | AccountMenu menuitem "Załóż grupę" -> /panel/spotkania?nowa=grupa, for every logged-in user; AccountMenu exists only on public pages (PublicLayout), never inside /panel |
| screen:public-term-page | screen | ascii/ui-mockups.md#public-term-page | PublicTermView/TermCard: location block under the date, "Zapisanych X z Y", RSVP footer unchanged |
| component:public-term-full | component | ascii/ui-mockups.md#public-term-page | "Brak wolnych miejsc" role=status pill when attendee_count >= capacity; RSVP still active |
| screen:admin-terms-page | screen | ascii/ui-mockups.md#admin-terms-page | AdminTermsPage columns "Miejsce" (name + address) and "Miejsca" rendered "3 / 10" or "—" |
