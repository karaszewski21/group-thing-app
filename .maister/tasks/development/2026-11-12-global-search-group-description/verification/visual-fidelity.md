# Visual Fidelity Report

## TL;DR
- 10 comparisons (7 screens + 3 components): **✓ 7 match, ⚠ 3 minor deviation, ✗ 0 substantive drift**.
- Every deviation is one of the orchestrator's accepted ones (Kategoria full-width trigger, Stan select, native Od/Do inputs, date filters visible to guests), or the guest „Zaloguj się” sitting in its own row.
- The information hierarchy, field order, primary actions and states match the mockups. This report does not gate completion.

## Key Decisions
- Comparison is LLM-judged and structural, not pixel-based. The mockups were rendered to `screenshots/mockup-*.png`; their annotation overlays and the mockup app chrome („swaptime” / avatar header) are not part of the design contract.
- The real panel chrome (icon row, bottom navigation) is treated as unchanged context, not as drift.

## Open Questions / Risks
- None of the deviations needs a design decision. The guest „Zaloguj się” placement (screen:search-guest) can optionally be moved into the top bar.

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## Summary
- Total screens compared: 10 (7 screens + 3 components)
- Match (✓): 7
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:search-items (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html (`screenshots/mockup-szukaj-przedmioty-moje-grupy.png`)
- Screenshot: verification/screenshots/03-guest-items-results.png, 14-user-items-wszedzie.png, 15-user-reserved-gniotka.png
- Layout: pill input with ✕ → mode tablist → scope segmented toggle → filters → summary → 2-column ItemCard grid → „Pokaż więcej” → other-mode line. Same order as the mockup.
- Reserved tile dimmed with „Zarezerwowana do sob 14 lis”, matching the mockup's „Zarezerwowana do pt 21 lis”.
- Deviation (accepted): Kategoria is a full-width picker row, Stan is a `<select>`, and Oddam/Zamienię are two separate pills instead of one „Oddam / Zamienię ▾” chip. Item badges read „Chcę oddać / Chcę się zamienić”.
- Impact: filters take one extra row; hierarchy unchanged.

### screen:search-meetings (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html
- Screenshot: verification/screenshots/07-guest-meetings-gra.png, 25-user-meetings-desc-match-all.png
- Layout: date filters → summary → single-column list of kind-labelled cards (DateTile for Termin/Wydarzenie, icon tile for Grupa/Organizacja) → other-mode line. Matches.
- Deviation (accepted): Od/Do are native date inputs („Od: 13.11.2026”, „Do: dd.mm.rrrr”) instead of „Od: dziś ▾ / Do ▾” chips.
- Note: org-run group cards show no „najbliższe spotkanie” line. This follows the spec (`next_starts_at` only when the href is the nearest term) and is not drift.

### screen:search-empty-items (✓ Match)
- Mockup: analysis/design-context/mockups/szukaj-brak-przedmiot-w.html
- Screenshot: verification/screenshots/12-user-items-mine-empty.png, 06-guest-items-other-mode-line.png
- Dashed empty card with icon, „Nikt w Twoich grupach tego nie oddaje”, the same body copy, and the primary „Dodaj do listy „szukam”” button. The other-mode line is highlighted under it (06). Matches.

### screen:search-guest (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/szukaj-go.html
- Screenshot: verification/screenshots/03-guest-items-results.png, 07-guest-meetings-gra.png, 26-guest-meetings-desc-match.png
- No scope toggle, „Zaloguj się” present, items and meetings modes as in the mockup.
- Deviation: „Zaloguj się” is a right-aligned link in its own row instead of in the header. Guests also see the Od/Do date filters (accepted).
- Impact: a little vertical space; no functional difference.

### screen:search-hint (✓ Match)
- Mockup: analysis/design-context/mockups/szukaj-mniej-ni-2-znaki.html
- Screenshot: verification/screenshots/02-guest-one-char-hint.png
- Hint copy „Wpisz co najmniej 2 znaki, żeby zacząć szukać.” is identical, with the controls above it. No request is sent.

### screen:group-form-description (✓ Match)
- Mockup: analysis/design-context/mockups/formularz-grupy-opis.html
- Screenshot: verification/screenshots/19-group-form-desc-valid.png, 18-group-form-desc-too-long.png, 21-group-edit-prefilled.png, 22-group-edit-contact-info-rejected.png
- Field order Nazwa → Opis → Widoczność → miejsce, as in the mockup. Counter `n / 500` sits right-aligned under the textarea. The hint copy is identical. In the invalid state the counter turns red at `520 / 500`, the inline error is the mockup's „Opis może mieć najwyżej 500 znaków.”, and submit is disabled. The server 400 banner shows the server text verbatim. There is no „w moderacji” badge.

### screen:group-terms-header (✓ Match)
- Mockup: analysis/design-context/mockups/strona-termin-w-grupy-nag-wek-z-opisem.html
- Screenshot: verification/screenshots/23-group-terms-header-with-description.png, 24-group-terms-header-no-description.png
- The full description sits under the group name inside the GroupCard hero (`pre-line`, not clamped). The variant without a description is unchanged.

### component:search-result-row (✓ Match)
- Mockup: szukaj-spotkania-wsz-dzie.html
- Screenshot: verification/screenshots/07-guest-meetings-gra.png, 25-user-meetings-desc-match-mine.png
- One card shape with an uppercase type label (GRUPA / TERMIN / WYDARZENIE / ORGANIZACJA), a „moja grupa” pill, title, subtitle „org · time · place”, and a 2-line description clamp for groups.

### component:other-mode-line (✓ Match)
- Mockup: szukaj-przedmioty-moje-grupy.html
- Screenshot: verification/screenshots/06-guest-items-other-mode-line.png, 05-guest-meetings.png
- „<n> spotkań/przedmiotów pasuje do „q” →”, highlighted when the list is empty, and hidden at 0.

### component:segmented-toggle (✓ Match)
- Mockup: szukaj-przedmioty-moje-grupy.html
- Screenshot: verification/screenshots/14-user-items-wszedzie.png
- Mode tablist and scope radiogroup use the same rounded segmented markup, with a white selected pill.
