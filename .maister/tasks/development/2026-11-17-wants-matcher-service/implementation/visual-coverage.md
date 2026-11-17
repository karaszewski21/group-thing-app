# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:want-matching | Group 8 (Frontend Views and Components). Group 7 supplies the `matching` kind and polling | ✅ |
| screen:want-matching-slow | Group 8. Group 7 supplies `matchingSlow`, `slow` and `refetch` | ✅ |
| screen:want-results | Group 8. Group 7 supplies `suggestions` on active/activeEmpty | ✅ |
| screen:want-results-matches-only | Group 8 | ✅ |
| screen:wanted-list | Group 8. Group 7 supplies list polling (`useWants`) | ✅ |
| component:suggestion-card | Group 8 (`SuggestionCard.tsx`, `ItemCard.tsx` optional props) | ✅ |
| component:matching-status | Group 8 (`MatchingStatus.tsx`) | ✅ |

## Uncovered Items

All screens covered: 7 of 7 IDs. The binding acceptance criteria are in the Group 8 `Visual References` of `implementation-plan.md`.
