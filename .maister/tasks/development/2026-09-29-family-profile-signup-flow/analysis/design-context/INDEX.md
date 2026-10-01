# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:rsvp-dialog-logged-in | screen | analysis/design-context/ascii/ui-mockups.md#rsvp-banner | Logged-in RSVP dialog. The "Przejdź do „Mój dom”" banner link changes to /panel/rodzina?returnTo=<term path> |
| screen:rodzina-populated | screen | analysis/design-context/ascii/ui-mockups.md#rodzina-populated | RodzinaView with members: role-aware labels (Ty/opiekun/dziecko), child age line, birth-year field in the add form, return button at the bottom |
| screen:rodzina-empty | screen | analysis/design-context/ascii/ui-mockups.md#rodzina-empty | RodzinaView empty state (family === null) with the return button under the dashed "Załóż rodzinę" card |
| component:return-to-term-button | component | analysis/design-context/ascii/ui-mockups.md#return-to-term-button | "Wróć do terminu" secondary outline Link, shown only when isSafeReturnPath(returnTo); state table and flow across CreateFamilyDialog |
| component:member-role-label | component | analysis/design-context/ascii/ui-mockups.md#rodzina-populated | Member suffix "(Ty)" / "(opiekun)" / "(dziecko)" from party_id and role_type (RodzinaView :113-114) |
| component:child-birth-year-inline | component | analysis/design-context/ascii/ui-mockups.md#child-birth-year-inline | CHILD row meta line "rocznik 2018 · ok. 8 lat" with a pencil button that opens a rename-style inline birth-year editor; display, empty, editing and error states |
| component:birth-year-field | component | analysis/design-context/ascii/ui-mockups.md#birth-year-field | Optional "Rok urodzenia" Field, visible only when the Dziecko toggle is pressed; shared by the RodzinaView add form and CreateFamilyDialog step 2 |
| screen:create-family-step2 | screen | analysis/design-context/ascii/ui-mockups.md#create-family-step2 | CreateFamilyDialog step 2 with the birth-year field and the "Dziecko · ok. N lat" draft row suffix |
| component:signup-summary-chip | component | analysis/design-context/ascii/ui-mockups.md#organizer-term-card | Organizer term card chip "5 zapisów · 8 dzieci" (or "Brak zapisów") linking to /panel/terminy/:termId; Polish plural rules |
| screen:organizer-term-card | screen | analysis/design-context/ascii/ui-mockups.md#organizer-term-card | organizerTermCard (HomeView, SpotkaniaView) with the new summary chip row |
| screen:organizer-term-attendees | screen | analysis/design-context/ascii/ui-mockups.md#organizer-term-attendees | New organizer-only page /panel/terminy/:termId: back link, summary, term card head, attendee rows |
| component:term-attendee-row | component | analysis/design-context/ascii/ui-mockups.md#organizer-term-attendees | Attendee row: name, family name, "przychodzi z N dzieci" pill, "dzieci w rodzinie: 5, 8 lat" (ages only, "wiek nieznany" for a missing year) |
| screen:organizer-term-attendees-states | screen | analysis/design-context/ascii/ui-mockups.md#organizer-term-attendees-states | Loading, empty, error (retry) and 403/404 states of the attendees page |
