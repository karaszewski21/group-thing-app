# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (mockups: `analysis/design-context/ascii/ui-mockups.md`)

| Screen/Component ID | Mockup lines | Covered By Task Group(s) | Status |
|---------------------|--------------|--------------------------|--------|
| screen:rsvp-dialog-logged-in | 66-103 | Group 8 (Frontend Family View): banner link only | ✅ |
| screen:rodzina-populated | 104-165 | Group 8 (Frontend Family View) | ✅ |
| screen:rodzina-empty | 166-192 | Group 8 (Frontend Family View) | ✅ |
| component:return-to-term-button | 193-240 | Group 8 (Frontend Family View); Group 6 (`isSafeReturnPath` helper) | ✅ |
| component:member-role-label | 104-165 | Group 8 (Frontend Family View); Group 2 (backend `role_type`) | ✅ |
| component:child-birth-year-inline | 241-283 | Group 8 (Frontend Family View); Group 6 (age helpers); Group 2 (PATCH endpoint) | ✅ |
| component:birth-year-field | 284-307 | Group 8 (Frontend Family View: RodzinaView add form and CreateFamilyDialog) | ✅ |
| screen:create-family-step2 | 308-347 | Group 8 (Frontend Family View) | ✅ |
| component:signup-summary-chip | 348-385 | Group 10 (Organizer Card Chip); Group 6 (`pluralPl`); Group 5 (backend counts) | ✅ |
| screen:organizer-term-card | 348-385 | Group 10 (Organizer Card Chip) | ✅ |
| screen:organizer-term-attendees | 386-450 | Group 9 (Organizer Attendees Page); Group 4 (backend `children`) | ✅ |
| component:term-attendee-row | 386-450 | Group 9 (Organizer Attendees Page); Group 6 (`formatChildAges`) | ✅ |
| screen:organizer-term-attendees-states | 451-483 | Group 9 (Organizer Attendees Page) | ✅ |

## Uncovered Items

All screens covered: 13 of 13 INDEX.md entries.

## Superseded mockup details (per spec)
- Mockup 9: the hook signature `useTermAttendees(groupId, termId)` (line 446) and its "open point" about resolving the group from PanelDataContext are replaced by `useTermAttendees(termId: string)`, with the group resolved through `term.circle_group_id` (spec R29-R30). Group 9 applies this.
- Mockup 10: the combined 403/404 message is split into denied ("Nie masz dostępu do tego terminu.") and notFound ("Nie znaleziono tego terminu."), both without retry (spec R21). Group 9 applies this.
