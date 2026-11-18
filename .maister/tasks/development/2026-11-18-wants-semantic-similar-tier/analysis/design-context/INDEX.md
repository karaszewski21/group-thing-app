# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:want-detail-active-similar | screen | analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html | Active want: MATCH grid, „Może Cię zainteresuje”, then the new „Powiązane rzeczy” section, then ActiveActions |
| screen:want-detail-empty-similar | screen | analysis/design-context/mockups/want-detail-no-matches-only-related-items.html | activeEmpty: EmptyCard „Jeszcze nic nie pasuje” stays, followed by „Powiązane rzeczy” |
| screen:want-detail-matching-similar | screen | analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html | matching: MatchingStatus + SkeletonGrid, followed by „Powiązane rzeczy” |
| component:similar-section | component | analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html | SimilarSection: `<section aria-labelledby>`, h2 „Powiązane rzeczy” with an aria-hidden emoji, lead „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.”, grid-cols-2 sm:grid-cols-3 |
| component:similar-card | component | analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html | SimilarCard: ItemCard dashed, no footnote, never „nowe”, reserved captions as on MatchCard and SuggestionCard |
