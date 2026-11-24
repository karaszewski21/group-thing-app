# Visual Coverage Matrix

## TL;DR
All 9 items in `analysis/design-context/INDEX.md` (5 screens and 4 components) are covered by at least one UI task group (6, 7, 8 or 9). Nothing is uncovered.

## Key Decisions
- The two field components are covered by group 6, where they are built, and their screens by group 7, where they are placed in the forms.
- The accepted mockup deviations D1–D4 are part of the `acceptance` items of groups 8 and 9, not gaps.

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:circle-form-price | Group 7 (Frontend Forms) | ✅ |
| screen:term-form-price | Group 7 (Frontend Forms) | ✅ |
| screen:term-page-price | Group 8 (Term Page and Attendee State) | ✅ |
| screen:attendee-payment-cta | Group 8 (Term Page and Attendee State); D4 (no "Wypisz się") accepted | ✅ |
| screen:organizer-attendance-payment | Group 9 (Organizer Attendance List); D1, D3 accepted | ✅ |
| component:price-field | Group 6 (Types, Helpers and Fields), placed by Group 7 | ✅ |
| component:payment-url-field | Group 6 (Types, Helpers and Fields), placed by Group 7 | ✅ |
| component:price-badge | Group 8 (Term Page and Attendee State) | ✅ |
| component:payment-switch | Group 9 (Organizer Attendance List); D2 accepted | ✅ |

## Uncovered Items

All screens are covered.
