# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (6 screens, 2 components)

| Screen/Component ID | Mockup | Covered By Task Group(s) | Status |
|---------------------|--------|--------------------------|--------|
| screen:private-gate-logged-in | mockups/brama-grupy-prywatnej-zalogowany.html | Group 6 (Frontend Visitor UI) | Covered |
| screen:private-gate-anonymous | mockups/brama-grupy-prywatnej-anonim.html | Group 6 (Frontend Visitor UI) | Covered (`AuthGateLinks` copy exception, spec Visual Design) |
| screen:join-by-code-sheet | mockups/wpisz-kod-dost-pu-joinbycodesheet.html | Group 6 (Frontend Visitor UI) | Covered |
| component:join-by-code-sheet | mockups/wpisz-kod-dost-pu-joinbycodesheet.html | Group 6 (Frontend Visitor UI) | Covered |
| screen:group-details-join-code-card | mockups/szczeg-y-grupy-z-kart-kodu-organizator.html | Group 7 (Frontend Organizer UI) | Covered |
| component:join-code-card | mockups/szczeg-y-grupy-z-kart-kodu-organizator.html | Group 7 (Frontend Organizer UI) | Covered (skeleton/error states from R25, not in the mockup) |
| screen:regenerate-confirm | mockups/potwierdzenie-wygeneruj-nowy-kod.html | Group 7 (Frontend Organizer UI) | Covered |
| screen:stepper-done-private | mockups/kreator-ekran-ko-cowy-grupa-prywatna.html | Group 7 (Frontend Organizer UI) | Covered |

Supporting groups: Group 5 (Frontend Data Layer) supplies `parseJoinCode`/`formatJoinCode`, `useJoinCode`, `useGroupTerms` and `joinWithCode`, which all 8 rows render through. Group 9 re-checks the gaps in the TermPage and GroupDetailsPage tests.

## Uncovered Items

All screens and components are covered (8 of 8). Two exceptions are documented, both binding from the spec's Visual Design section:
- `screen:private-gate-anonymous`: the mockup's "Załóż konto" label is replaced by the unchanged `AuthGateLinks` copy ("Zaloguj się" + "Nie masz konta? Zarejestruj się").
- `component:join-code-card`: the mockups show only loaded states; the skeleton and error states follow R25.
