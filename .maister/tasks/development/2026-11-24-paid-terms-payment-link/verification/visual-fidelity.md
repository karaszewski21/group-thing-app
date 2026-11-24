# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
- **Overall: high fidelity.** All 5 screens were compared: 4 ✓ match and 1 ⚠ minor deviation, with no substantive drift (✗).
- Every feature element in the mockups is present with matching copy and order: price/link fields and hints, the prefill hint, the four error texts, the price badge and payment lines, the cost line, the three footer states, the Moje zajęcia badges, the switch, and the refund pill and note.
- Differences are either accepted deviations D1–D5 or existing app chrome around the feature (page titles, button labels, the capacity label). The one ⚠ is the payment footer being covered by the bottom nav at 400 px (existing layout behaviour).

## Key Decisions
- Mockups were rendered at 1280×900 from their HTML (`screenshots/mockup-*.png`) and compared with the implementation captured at 400×860. Only structure, order, copy and state coverage were judged; desktop vs mobile sizing was ignored.
- Accepted deviations D1–D5 from the spec count as matches, not drift.
- Pre-existing labels outside the feature's scope are noted but do not lower a screen's mark.

## Open Questions / Risks
- **screen:attendee-payment-cta:** the sticky footer is behind the bottom nav until the page is scrolled to the end (see E2E 5.3-1). Design and frontend should decide on a footer offset in the shared `SignUpFooter` shell.

## Summary
- Total screens compared: 5
- Match (✓): 4
- Minor deviation (⚠): 1
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:circle-form-price (✓ Match)
- Mockup: analysis/design-context/mockups/kr-g-edycja-cena-i-link-domy-lny.html (`screenshots/mockup-kr-g-edycja-cena-i-link-domy-lny.png`)
- Screenshot: `screenshots/04-circle-form-valid.png`, `screenshots/05-circle-edit-prefilled.png`, `screenshots/01-circle-price-zero-error.png`
- Layout: single-column form, price and link directly after the capacity field ✓
- Field order: … → capacity → "Cena domyślna (zł)" (narrow) → "Link do płatności (opcjonalnie)" (full width) ✓
- Copy: hints "Puste = zajęcia bezpłatne." and "Bez linku uczestnicy płacą na miejscu." are verbatim ✓; placeholders "np. 25,50" / "https://"
- Primary action: the implementation says "Dodaj grupę" on create; the mockup shows "Zapisz zmiany" on edit (existing button labels)
- Note: the capacity label is "Ile miejsc (opcjonalnie)" (`GroupFormFields.tsx:33`, pre-existing) vs "Ile miejsc (domyślnie)" in the mockup; outside the feature's scope
- States covered: default, prefilled edit, three error states (price 0, http link, link without price)

### screen:term-form-price (✓ Match)
- Mockup: analysis/design-context/mockups/zaj-cia-formularz-terminu-cena-z-kr-gu-i-b-dy.html (`screenshots/mockup-zaj-cia-formularz-terminu-cena-z-kr-gu-i-b-dy.png`)
- Screenshot: `screenshots/06-add-term-prefill-hint.png`, `screenshots/07-add-term-inline-errors.png`, `screenshots/21-edit-term-link-requires-price.png`
- Layout: hint "Cena i link podpowiedziane z ustawień kręgu — możesz je zmienić." directly under the sheet title ✓
- Field order: date → … → "Ile miejsc" → "Cena (zł)" → "Link do płatności (opcjonalnie)" ✓ (the real form also has the group, description, place, points and needed items, which the mockup leaves out)
- Copy: "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste.", "Link do płatności może mieć najwyżej 500 znaków.", "Link wymaga ceny — wpisz cenę albo usuń link." are verbatim ✓ ("Link musi zaczynać się od https://" seen on the circle form with the same shared field)
- Primary action: "Dodaj termin" (existing) vs mockup "Zapisz termin"; blocked while invalid ✓
- States covered: prefilled, price error, length error, "link without price" variant; the hint is absent on edit as specified

### screen:term-page-price (✓ Match)
- Mockup: analysis/design-context/mockups/strona-zaj-cena-przed-zapisem-okno-zapisu.html (`screenshots/mockup-strona-zaj-cena-przed-zapisem-okno-zapisu.png`)
- Screenshot: `screenshots/08-guest-term-page-price-badge.png`, `screenshots/09-rsvp-dialog-cost-line.png`, `screenshots/25-guest-do-zaplaty-na-miejscu.png`, `screenshots/23-anonymous-paid-term-price.png`
- Layout: price pill under the date block in the term card, muted payment line below ✓
- Copy: "25,50 zł", "Płatność online po zapisaniu się.", inline "płatność na miejscu" (no-link variant) ✓; dialog "Koszt: 25,50 zł — zapłacisz po zapisaniu" in an accent box ✓
- Primary action: "＋ Zapisz się" footer, dialog "Zapisz się" ✓
- Not exercised: the price badge next to a "+N pkt" badge (the test term had 0 points). The dialog's child-count field was replaced by the existing "Dodaj rodzinę" prompt because the guest has no family.
- States covered: with link, without link, anonymous, logged-in dialog

### screen:attendee-payment-cta (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/zapisany-uczestnik-zap-a-do-zap-aty-op-acone.html (`screenshots/mockup-zapisany-uczestnik-zap-a-do-zap-aty-op-acone.png`)
- Screenshot: `screenshots/10-guest-footer-zaplac.png`, `screenshots/14-guest-term-page-oplacone.png`, `screenshots/25-guest-do-zaplaty-na-miejscu.png`, `screenshots/26-moje-zajecia-both-badges.png`, `screenshots/27-footer-scrolled-bottom.png`
- Layout: three footer states in the sticky footer ✓; "Moje zajęcia" cards with a badge at the bottom ✓
- Copy: "Zapłać 25,50 zł ↗" (external `<a>`, `target=_blank`, `rel="noopener noreferrer"`), "Do zapłaty: 10,00 zł (na miejscu)", "✓ Opłacone"; badges "Do zapłaty 10,00 zł" / "✓ Opłacone" ✓
- Accepted: D4 (no "Wypisz się" under the payment state), D5 (`bg-primary-soft text-primary-fg` for Opłacone on both screens)
- Deviation: at 400 px the sticky footer is painted under the sticky bottom nav until the page is scrolled to the end. The mockup shows it as always visible. The existing "＋ Zapisz się" footer does the same, so this is inherited layout behaviour.
- Impact: the primary payment CTA is out of sight on first view on a phone
- Recommendation: offset the shared footer above the bottom nav (E2E 5.3-1)

### screen:organizer-attendance-payment (✓ Match)
- Mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-z-prze-cznikiem-op-acone.html (`screenshots/mockup-organizator-lista-obecno-ci-z-prze-cznikiem-op-acone.png`)
- Screenshot: `screenshots/12-organizer-list-switch-off.png`, `screenshots/13-organizer-switch-on-oplaceni-1.png`, `screenshots/18-organizer-withdrawn-do-zwrotu.png`, `screenshots/20-organizer-row-back-to-normal.png`, `screenshots/22-organizer-free-term-no-switch.png`
- Layout: the subtitle ends with " · 25,50 zł" ✓; rows with presence checkbox on the left and switch + "opłacone" on the right ✓
- Copy: count line "1 zapis · 0 dzieci · opłaceni: 1" (D1 instead of "Zapisani: 3 · opłaceni: 2"); pill "wypisany — do zwrotu"; note "Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy." (D3) ✓
- Primary action: `role=switch` "opłacone — {name}", `bg-mint` on (D2) ✓
- Note: the page heading is the existing "Zapisani na termin" (mockup: "Lista obecności")
- States covered: priced UNPAID, priced PAID, withdrawn PAID (presence disabled, switch enabled), free term without a switch
