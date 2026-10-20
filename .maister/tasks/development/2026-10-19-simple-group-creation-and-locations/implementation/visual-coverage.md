# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (25 ids). Mockups: `analysis/design-context/ascii/ui-mockups.md`. Plan: `implementation/implementation-plan.md`.

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:stepper-step1 | Group 7 (Panel restructure — CreateGroupStepper step 1) | ✅ |
| screen:stepper-step2 | Group 7 (CreateGroupStepper step 2) | ✅ |
| screen:stepper-done | Group 7 (CreateGroupStepper done screen) | ✅ |
| component:group-form-fields | Group 5 (GroupFormFields component); hosted by Group 7 | ✅ |
| component:location-picker | Group 5 (LocationPicker) | ✅ |
| component:location-picker-empty | Group 5 (LocationPicker empty state) | ✅ |
| component:location-picker-list | Group 5 (LocationPicker list state) | ✅ |
| component:location-picker-add | Group 5 (LocationPicker Google add) | ✅ |
| component:location-picker-manual | Group 5 (LocationPicker manual mode) | ✅ |
| component:location-picker-edit | Group 5 (LocationPicker inline edit + delete confirm) | ✅ |
| screen:group-add-modal | Group 7 (PanelModals "Dodaj nową grupę") | ✅ |
| screen:group-edit-modal | Group 7 (PanelModals "Edytuj grupę") | ✅ |
| screen:term-add-modal | Group 7 (PanelModals "Dodaj termin zajęć" + PanelDataContext add-term state) | ✅ |
| screen:first-term-stepper-organizer | Group 6 (FirstTermStepperOrganizer); wired with group defaults in Group 7 | ✅ |
| screen:edit-term-dialog | Group 6 (EditTermDialog) | ✅ |
| screen:home-view | Group 7 (HomeView hints + merged top-3) | ✅ |
| component:term-place-line | Group 5 (TermPlaceLine) | ✅ |
| component:led-term-card | Group 7 (organizerTermCard + signupSummaryChip in PanelDataContext) | ✅ |
| component:attended-term-card | Group 7 (HomeView / SpotkaniaView guest Link cards, membership-only cards) | ✅ |
| screen:spotkania-view | Group 7 (SpotkaniaView "Prowadzę"/"Zapisane") | ✅ |
| component:group-tile | Group 7 (SpotkaniaView tile) | ✅ |
| component:account-menu-zaloz-grupe | Group 6 (AccountMenu menuitem); `?nowa=grupa` landing in Group 7 (PanelPage) | ✅ |
| screen:public-term-page | Group 8 (TermCard + PublicTermView) | ✅ |
| component:public-term-full | Group 8 (TermCard "Brak wolnych miejsc" pill) | ✅ |
| screen:admin-terms-page | Group 8 (AdminTermsPage columns) | ✅ |

## Uncovered Items

All 25 screens/components covered (25/25). No uncovered items.

## Notes

- Backend Groups 1–3 and the data-layer Group 4 carry no `Visual References` (non-UI).
- Group 9 (integration) carries none; it verifies the suites that assert the above.
