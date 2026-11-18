# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
All 5 design-context IDs match structurally: 3 screens and 2 components, with 5 ✓, 0 ⚠ and 0 ✗.
The section placement, the 🔗 heading, the lead copy, the 2/3-column grid and the dashed footnote-less cards follow the mockups in all three states.
The remaining differences come from mockup sample data (emoji thumbnails, the „Oddam” pill, filter summaries, „nowe” on a MATCH card). The live page uses the existing ItemCard copy („Chcę oddać”) and placeholder thumbnails, which the spec's fidelity note allows („Use existing components and classes, not the mockup CSS”).

## Summary
- Total screens compared: 5 (3 screens + 2 components)
- Match (✓): 5
- Minor deviation (⚠): 0
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:want-detail-active-similar (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html
- Screenshot: verification/screenshots/01-active-desktop.png, verification/screenshots/02-active-mobile-related.png
- Layout: header (‹ Szukam / Edytuj, h1, summary) → notifications toggle → „N pasująca rzecz” grid → `.sec.suggestions` → `.sec.similar` → actions (Ważne jeszcze…, Znalezione — zamknij, Przedłuż / Wycofaj). The live page follows the same order.
- Field order: related cards in score order (mercedes, resorak, autko); each card shows thumb → name → „Stan: …” → mode pill, as in the mockup.
- Primary action: the actions block sits after „Powiązane rzeczy”, as in the mockup.
- States covered: active with all three tiers.
- Data-only differences (not drift): emoji thumbnails, the „Oddam” pill (live: „Chcę oddać”, existing ItemCard copy), the filter summary line, the „nowe” badge on a MATCH card and the reserved pills come from mockup sample data and were not seeded.

### screen:want-detail-empty-similar (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-no-matches-only-related-items.html
- Screenshot: verification/screenshots/11-active-empty-mobile.png, verification/screenshots/05-active-empty-with-related-desktop.png
- Layout: EmptyCard (🔔 icon tile, „Jeszcze nic nie pasuje”, „Damy znać, gdy ktoś doda pasującą rzecz.”) → divider → „Powiązane rzeczy” 2-column grid → actions. Same as the mockup.
- Primary action: the actions follow the section.
- States covered: activeEmpty with 2 related items (mockup: „Gondola do wózka” + 1; live: „Gondola do wózka”, „Spacerówka lekka”).

### screen:want-detail-matching-similar (✓ Match)
- Mockup: analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html
- Screenshot: verification/screenshots/09-matching-with-related.png, verification/screenshots/10-matching-slow-with-related.png
- Layout: status row with spinner („Szukamy pasujących rzeczy…”) → 4 skeleton tiles → „Powiązane rzeczy” → actions. Same as the mockup. The live status adds the existing sub-line „To zwykle kilka sekund.”.
- States covered: matching, and matchingSlow (not in a mockup), where the section stays under „Wyniki pojawią się wkrótce … Odśwież teraz”.

### component:similar-section (✓ Match)
- Mockup: active mockup, `.sec.similar`
- Screenshot: verification/screenshots/03-related-section-desktop.png
- Structure: `section` with a top border divider (`mt-5.5 border-t border-line pt-4`, the same as SuggestionsSection), an h2 with the aria-hidden 🔗 and „Powiązane rzeczy”, the lead „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.”, and a ul `grid-cols-2 gap-3 sm:grid-cols-3`. Measured 2 columns at 390 px and 3 at 1280 px.

### component:similar-card (✓ Match)
- Mockup: active mockup, `.similar .card`
- Screenshot: verification/screenshots/03-related-section-desktop.png
- Structure: ItemCard with a dashed `border-line-strong` border (computed `border-style: dashed`), no „brakuje:” footnote and no „nowe” marker. This differs from the solid MATCH card and matches the dashed SUGGESTION card without its footnote, as in the mockup.
- Not compared live: the reserved captions („Zarezerwowane”, „Twoja propozycja”) and the dimmed thumb shown in the mockup. No reservations were seeded.
