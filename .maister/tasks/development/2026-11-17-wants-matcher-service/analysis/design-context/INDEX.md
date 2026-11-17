# Design context index

## TL;DR
Five HTML mockups for the „Szukam” frontend changes: pending state, slow-pending fallback, suggestions section, matches-only result, list pending badge. Binding inputs for implementation; design language in `design-resources.md`.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:want-matching | screen | analysis/design-context/mockups/want-detail-matching-pending.html | Want detail while `matching: true` — „Szukamy pasujących rzeczy…” status (aria-live) + skeleton tiles; polls every 2 s |
| screen:want-matching-slow | screen | analysis/design-context/mockups/want-detail-matching-slow.html | After ~60 s polling stops — dashed card „Wyniki pojawią się wkrótce” + „Odśwież teraz” |
| screen:want-results | screen | analysis/design-context/mockups/want-detail-suggestions.html | „Traktor Bruder Claas”: empty MATCH card + section „💡 Może Cię zainteresuje” with cards „brakuje: „Claas”” |
| screen:want-results-matches-only | screen | analysis/design-context/mockups/want-detail-matches-only.html | „kurtka zimowa”: 2 MATCH cards incl. „Kurtka na zimę”; no suggestions section |
| screen:wanted-list | screen | analysis/design-context/mockups/wanted-list-pending-badge.html | /wanted list: pending card shows spinner „Szukamy…” instead of the count |
| component:suggestion-card | component | analysis/design-context/mockups/want-detail-suggestions.html | ItemCard variant with dashed border and „brakuje: …” line |
| component:matching-status | component | analysis/design-context/mockups/want-detail-matching-pending.html | Inline status row with spinner, role=status |
