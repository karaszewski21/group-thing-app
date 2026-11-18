# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
The implementation matches the five mockup screens and both components structurally. Score: 6 ✓ match, 1 ⚠ minor deviation, 0 ✗ drift. The single deviation is on `/wanted` and comes from code this task left unchanged: the other cards keep their existing copy and icon („Jeszcze nic · powiadomimy Cię” with a bell, „+ Dodaj”), while the mockup simplified them. Every element the spec binds is present: the pending row, skeletons, the slow card, the suggestions section with dashed cards, the matches-only grid and the list badge.

## Key Decisions
- The mockups were rendered in the same 390 px viewport (`screenshots/mockup-*.png`) and compared region by region with the live captures.
- Differences that depend on the data were ignored: the summary line („Bez doprecyzowania” vs „Każda kategoria · Cała Polska · …”), item names and counts, and placeholder thumbnails vs emoji art.

## Open Questions / Risks
_None._ No substantive drift.

## Summary
- Total screens compared: 7 (5 screens + 2 components)
- Match (✓): 6
- Minor deviation (⚠): 1
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:want-matching (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-matching-pending.html (render `screenshots/mockup-want-detail-matching-pending.png`)
- Screenshot: verification/screenshots/09-want-matching-pending.png
- Layout: header („‹ Szukam”, „Edytuj”, h1, summary) → notification toggle → status row → 2×2 skeleton grid → validity → actions, same order
- Skeleton: 4 tiles shaped like ItemCard (thumb + 2 bars), grid `aria-hidden`
- Primary actions: „Znalezione — zamknij”, „Przedłuż”, „Wycofaj” unchanged
- States covered: pending with no stored match

### component:matching-status (✓ Match)
- Mockup: want-detail-matching-pending.html
- Screenshot: verification/screenshots/09-want-matching-pending.png
- Inline card row with a ring spinner left, „Szukamy pasujących rzeczy…” bold, sub-line „To zwykle kilka sekund.”; `role="status" aria-live="polite"`, spinner `aria-hidden` with `motion-reduce:animate-none`

### screen:want-matching-slow (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-matching-slow.html (render `screenshots/mockup-want-detail-matching-slow.png`)
- Screenshot: verification/screenshots/12-want-matching-slow.png
- Dashed card with ⏳ in a soft tile (`aria-hidden`), heading „Wyniki pojawią się wkrótce”, body copy word for word, text-style button „Odśwież teraz”; `role="status" aria-live="polite"`; no skeleton
- States covered: slow, and resume to pending (`screenshots/13-after-refresh-click.png`)

### screen:want-results (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-suggestions.html (render `screenshots/mockup-want-detail-suggestions.png`)
- Screenshot: verification/screenshots/04-want-suggestions.png, verification/screenshots/07-claas-window-suggestion.png
- Layout: empty dashed card („Jeszcze nic nie pasuje” + bell tile) → divider (section has a top border) → „💡 Może Cię zainteresuje” h2 (emoji `aria-hidden`) → lead „Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.” → 2-column grid → validity → actions
- The `<section>` is labelled by its heading through `aria-labelledby`

### component:suggestion-card (✓ Match)
- Mockup: want-detail-suggestions.html
- Screenshot: verification/screenshots/04-want-suggestions.png
- ItemCard tile with a dashed border (ARTICLE `border-style: dashed`), thumb, name, „Stan: …”, mode pill, extra line „brakuje: „Claas”” with the word bold in „…” quotes, no „nowe”; links to the product page

### screen:want-results-matches-only (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-matches-only.html (render `screenshots/mockup-want-detail-matches-only.png`)
- Screenshot: verification/screenshots/15-matches-only.png, verification/screenshots/08-rowerek-window-match-nowe.png
- Count line („1 pasująca rzecz” / „5 pasujących rzeczy”) → MatchCards with the „nowe” pill on unseen pairs → no suggestions section

### screen:wanted-list (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/wanted-list-pending-badge.html (render `screenshots/mockup-wanted-list-pending-badge.png`)
- Screenshot: verification/screenshots/10-wanted-list-badge.png
- Match: the matching card shows a small spinner (`aria-hidden`) + „Szukamy…” in `role="status"` in place of the count/new pills; other cards keep their state
- Deviation: the existing cards look different from the mockup's simplified versions. The empty card reads „Jeszcze nic · powiadomimy Cię” with a bell icon on a cream pill (mockup: plain „Jeszcze nic nie pasuje”). Counts sit in a full-width green pill (mockup: inline „3 pasujące” + „1 nowe” chip). The page has „‹ Konto” and „+ Dodaj” (mockup: „+ Dodaj poszukiwanie”). Each card has a validity line.
- Impact: none on the new element. The deviations belong to the pre-existing list, which the spec says stays unchanged („Other cards unchanged”)
- Recommendation: none. Optionally align the mockup with the shipped list copy.
