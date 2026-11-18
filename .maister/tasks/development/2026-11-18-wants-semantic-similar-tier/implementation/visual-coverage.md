# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:want-detail-active-similar | Group 9 (Frontend Data Layer: `active` carries `similar`), Group 10 (Frontend UI: order MATCH grid → suggestions → „Powiązane rzeczy” → ActiveActions) | ✅ |
| screen:want-detail-empty-similar | Group 9 (Frontend Data Layer: `activeEmpty` carries `similar`), Group 10 (Frontend UI: EmptyCard stays, section follows it) | ✅ |
| screen:want-detail-matching-similar | Group 9 (Frontend Data Layer: `matching`/`matchingSlow` carry `similar`), Group 10 (Frontend UI: section after SkeletonGrid or match list) | ✅ |
| component:similar-section | Group 10 (Frontend UI: `SimilarSection` + `similarSection(list)` in `WantMatchesView.tsx`) | ✅ |
| component:similar-card | Group 10 (Frontend UI: `SimilarCard.tsx` + shared `reservedCaption.ts`) | ✅ |

## Uncovered Items

All screens covered (5 of 5 INDEX.md entries).
