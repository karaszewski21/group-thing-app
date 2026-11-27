# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/ (app captures at 390×844 and 1280×900; mockups rendered to `mock-*.png` at 1280 px)

## TL;DR
Fidelity is high: of 8 screens, 5 match the mockups, 3 deviate in minor ways, and none drift.
- Every binding element is present with the mockup's copy: the mode group, the stepper, the suggestion and range, the badge, „Biorę za N pkt”, the sheet rows, the „Brakuje” state, the three tiles, the HOLD/RELEASE/SALE labels and the admin section with its example.
- The deviations are a spec-sanctioned button label, a missing „Wszystkie” search chip, and plain admin input chrome.
- Separate from structure: at 390 px the „Zakup” history row lays out badly (see E2E report §5.3 M1).

## Open Questions / Risks
- Search „Rodzaj oferty” has no „Wszystkie” chip, unlike the mockup. Design should confirm the toggle pattern is acceptable.
- The admin fields render without visible borders across the whole PointsConfigPage. This is pre-existing and not specific to the new section.

## Summary
- Total screens compared: 8
- Match (✓): 5
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:item-create-points (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/dodaj-rzecz-wystawienie-za-punkty.html (`screenshots/mock-dodaj-rzecz-wystawienie-za-punkty.png`)
- Screenshots: `screenshots/01-add-points-mode-no-photo.png`, `screenshots/02-add-price-55-error.png`, `screenshots/03-add-points-ready-60.png`
- Layout: photos → photo info line → fields → „Jak chcesz ją przekazać?” → three-mode group → stepper → primary + secondary. Matches.
- Stepper: −/+ around a numeric text input with „pkt”, „System proponuje 40 pkt”, „Dozwolone 20–60 pkt, co 10”. Matches.
- Error state: the inline „Cena musi być od 20 do 60 pkt, co 10.” and the blocked „Wystaw za punkty”. Matches.
- No-photo state: the hint text and `aria-disabled`. Matches.
- Deviation: the secondary action reads „Wersja robocza” instead of „Zapisz jako szkic”. This is sanctioned by spec L4. The limit text is the number-neutral L6 copy, which was not reproduced live.

### screen:item-edit-points (✓ Match)
- Mockup: analysis/design-context/mockups/edycja-rzeczy-cena-za-punkty.html
- Screenshots: `screenshots/14-edit-form-reserved.png`, `screenshots/15-edit-form-condition-forecast.png`, `screenshots/22-edit-form-unreserved-80.png`
- Forecast note above the stepper: „Zmieniłeś stan — sugestia to teraz 60 pkt (dozwolone 30–90). Twoja cena 60 pkt mieści się w zakresie.” The text matches the mockup.
- Reserved note „Zarezerwowana przez X za H pkt — ta rezerwacja rozliczy się po H pkt. Nowa cena dotyczy kolejnych osób.” Matches.
- The clamp case was not reproduced live, because no save was made with an out-of-range price.

### screen:item-cards-points (✓ Match)
- Mockup: analysis/design-context/mockups/karty-przedmiot-w-z-cen-w-punktach.html
- Screenshots: `screenshots/05-search-cards-points-badge.png`, `screenshots/13-my-items-seller.png`
- Orange „N pkt” badge, top-left, ink text, with the sr-only „Za punkty: N pkt”. Matches.
- No suggestion on public cards. My Items additionally shows the owner-only suggestion chip („★ 40 pkt”), which the spec allows.

### screen:item-page-points (✓ Match)
- Mockup: analysis/design-context/mockups/strona-przedmiotu-za-punkty.html
- Screenshots: `screenshots/04-item-page-owner-listed.png`, `screenshots/09-item-page-buyer-reserved.png`, `screenshots/12-item-page-seller-held.png`
- Buyer: „Cena 60 pkt”, „Biorę za 60 pkt”, then the hold note. Matches.
- Owner: „Zarezerwowane przez X · 60 pkt zablokowane”, „Anuluj rezerwację”, „Potwierdza tylko kupujący. Możesz anulować — punkty wrócą do X.” Matches.
- Buyer after taking: „Potwierdź odbiór”. Matches.

### screen:points-reservation-sheet (✓ Match)
- Mockup: analysis/design-context/mockups/okno-rezerwacji-za-punkty-saldo.html
- Screenshots: `screenshots/08-sheet-sufficient-balance.png`, `screenshots/07-sheet-insufficient-balance.png`
- Bottom ModalSheet „Biorę za punkty”, with the item, pickup and locality line. Rows Cena / Dostępne saldo / Po rezerwacji, then „Zablokuj N pkt i rezerwuj” and „Anuluj”. Matches.
- Short state: no „Po rezerwacji” row, the blocked action and „Brakuje Ci 30 pkt.”, as in the mockup's „Za mało punktów” state. Matches.
- The 409 texts were not reproduced live.

### screen:search-points-filter (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/wyszukiwanie-filtr-za-punkty.html
- Screenshot: `screenshots/06-search-filter-points-chip.png`
- The „Za punkty” chip is present and sets `offer_type=POINTS`.
- Deviation: the mockup shows a leading „Wszystkie” chip; the implementation keeps the existing three toggle chips.
- Impact: none functionally.

### screen:admin-points-offers (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/admin-konfiguracja-ofert-za-punkty.html
- Screenshots: `screenshots/23-admin-points-offers.png`, `screenshots/24-admin-ratio-invalid.png`
- The section „Oferty „za punkty”” is not dimmed. It has the 5 labelled fields in the mockup order and the live example, which adds s=20 per the spec text. The Polish validation copy matches.
- Deviation: inputs show no visible borders, and the save action reads as plain text. This is a page-wide style shared with the pre-existing sections.

### screen:account-points-held (✓ Match)
- Mockup: analysis/design-context/mockups/twoje-punkty-saldo-blokady-historia.html
- Screenshots: `screenshots/10-points-page-held-60.png`, `screenshots/17-points-page-after-release.png`, `screenshots/19-points-page-buyer-after-sale.png`, `screenshots/20-points-page-seller-sale.png`
- Three tiles dostępne / zablokowane / reputacja. History labels Blokada (−p), Zwolnienie blokady (+p), Zakup („zablokowane p → wydane”) and Sprzedaż (+p). Match.
- Rows use the spec's „Label: item” plus a „Sprzedawca/Kupujący” subtitle rather than the mockup's single line, which the spec defines.
- Not structural: at 390 px the Zakup row's title column collapses (E2E §5.3 M1).
