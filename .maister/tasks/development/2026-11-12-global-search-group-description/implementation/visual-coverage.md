# Visual Coverage Matrix

## TL;DR
All 10 entries in `analysis/design-context/INDEX.md` (7 screens, 3 components) are covered by at least one task group. The search UI is mostly Group 11. The guest shell and hint states are also Group 10 (routing and view state). The description surfaces are Groups 7 and 12.

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Mockup | Covered By Task Group(s) | Status |
|---------------------|--------|--------------------------|--------|
| screen:search-items | mockups/szukaj-przedmioty-moje-grupy.html | Group 11 (Search Results UI) | ✅ |
| screen:search-meetings | mockups/szukaj-spotkania-wsz-dzie.html | Group 11 (Search Results UI), Group 12 (Group Description Display: group rows) | ✅ |
| screen:search-empty-items | mockups/szukaj-brak-przedmiot-w.html | Group 11 (Search Results UI: empty card, HuntingCreateView prefill) | ✅ |
| screen:search-guest | mockups/szukaj-go.html | Group 10 (Guest Routing: PanelGate shell, forced scope), Group 11 (Search Results UI: no scope toggle, guest filters) | ✅ |
| screen:search-hint | mockups/szukaj-mniej-ni-2-znaki.html | Group 10 (View State: `hint`, no request), Group 11 (Search Results UI: hint copy) | ✅ |
| screen:group-form-description | mockups/formularz-grupy-opis.html | Group 7 (Group Description Form) | ✅ |
| screen:group-terms-header | mockups/strona-termin-w-grupy-nag-wek-z-opisem.html | Group 12 (Group Description Display) | ✅ |
| component:search-result-row | mockups/szukaj-spotkania-wsz-dzie.html | Group 11 (SearchResultCard by kind), Group 12 (group description clamp) | ✅ |
| component:other-mode-line | mockups/szukaj-przedmioty-moje-grupy.html | Group 11 (OtherModeLine) | ✅ |
| component:segmented-toggle | mockups/szukaj-przedmioty-moje-grupy.html | Group 11 (mode tablist + scope radiogroup) | ✅ |

## Uncovered Items

None. Every screen and component is covered.
