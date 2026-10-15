# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| component:delete-group-trigger | component | analysis/design-context/ascii/ui-mockups.md#delete-group-trigger | SpotkaniaView group-tile trash button ("Usuń grupę {name}"): now opens DeleteGroupDialog instead of calling endLeadership; focus-return anchor |
| component:delete-group-dialog | component | analysis/design-context/ascii/ui-mockups.md#delete-group-dialog | New Tailwind alertdialog (clone of UnsavedChangesDialog): title "Usunąć grupę „{name}”?", Anuluj / Usuń grupę, initial focus Anuluj, Esc, Tab trap, useRegisterOpenSheet(true) |
| component:delete-group-dialog-busy | state | analysis/design-context/ascii/ui-mockups.md#delete-group-dialog-busy | Busy state: "Usuwanie…", both buttons disabled, Esc/scrim ignored |
| component:delete-group-dialog-error | state | analysis/design-context/ascii/ui-mockups.md#delete-group-dialog-error | Inline role=alert error: 409 RSVP block message verbatim, or generic "Nie udało się usunąć grupy. Spróbuj ponownie."; dialog stays open |
| screen:panel-spotkania-after-delete | screen | analysis/design-context/ascii/ui-mockups.md#panel-spotkania-after-delete | Spotkania after success: toast "Usunięto grupę", tile removed, count updated; empty state "Nie masz jeszcze żadnej grupy." |
| screen:admin-groups | screen | analysis/design-context/ascii/ui-mockups.md#admin-groups-active | AdminGroupsPage with new Active/Deleted toggle (role=group, aria-pressed, page reset to 1); Active table unchanged |
| screen:admin-groups-deleted | screen | analysis/design-context/ascii/ui-mockups.md#admin-groups-deleted | Deleted view: extra columns Deleted at (DD.MM.YYYY HH:mm) / Deleted by / Actions |
| component:admin-group-restore-button | component | analysis/design-context/ascii/ui-mockups.md#admin-groups-deleted | Per-row Restore button, no confirm, busy "Restoring…", inline role=alert error; row moves to Active on success |
| screen:admin-groups-deleted-empty | state | analysis/design-context/ascii/ui-mockups.md#admin-groups-deleted-empty | Deleted view empty state "No deleted circles", plus loading/error states |
