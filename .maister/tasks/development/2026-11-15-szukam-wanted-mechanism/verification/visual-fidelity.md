# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
- The implementation follows the 8 mockups closely in layout, Polish copy, field order and states.
- 11 ids compared: **8 ✓ match, 3 ⚠ minor deviation, 0 ✗ substantive drift.**
- The spec overrides listed in `implementation/visual-coverage.md` are applied and are not counted as drift: intent labels "Chcę oddać" / "Chcę się zamienić", the empty-search heading kept, `category_name` on the list card, the verbatim contact message, and a form location block with only the locality field.
- The deviations are small: a label style and chip wrap in the form, the 7-days-or-fewer action frame that auto-extension makes unreachable, and a toast over the closing sheet.

## Open Questions / Risks
- `screen:wanted-matches-states`, frame "Brak dopasowań": the layout with "Przedłuż o 90 dni" as the primary action cannot be seen, because opening the page auto-extends the want (FR-L-02, accepted). Decide whether the frame or the rule should change.

## Summary
- Total screens compared: 11
- Match (✓): 8
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:wanted-list (✓ Match)
- Mockup: analysis/design-context/mockups/wanted-list.html
- Screenshot: verification/screenshots/w16-wanted-list.png, w25-wanted-list-states.png, w22-wanted-list-found.png, w33-wanted-list-empty.png
- Layout: "‹ Konto", h1 "Szukam" with "+ Dodaj" on the right, intro, stacked cards. Matches.
- Cards: name link, summary line, "N nowa" pill, match band (filled vs bell "Jeszcze nic · powiadomimy Cię"), "Ważne jeszcze N dni" with "· Przedłuż" at 6 days. The expired row ("Wygasło", "Zniknie z listy za 27 dni", "Wznów") and the found row ("Znalezione", "Szukam znowu") match.
- Empty state "Czego potrzebujesz?" + "+ Dodaj poszukiwanie" matches.
- Spec override applied: the summary shows the node name ("Rowery dziecięce"), not the top-level category.

### screen:wanted-form (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/wanted-form.html
- Screenshot: verification/screenshots/w05-form-empty-mobile.png, w03-form-prefilled.png, w11-form-filled-mobile.png, w24-form-edit.png
- Field order: name → disclosure → Kategoria → "Jak chcesz dostać rzecz?" → Miejscowość + radius chips → "Notatka dla siebie" ✓
- Copy: titles, intro, placeholders, counters, "Wpisz, czego szukasz (3–80 znaków).", the edit hint, "Zapisz zmiany" / "Anuluj", and the back links "‹ Dodaj" / "‹ Szukaj" / "‹ {name}" all match.
- Deviations:
  - The "Miejscowość" label is smaller and lighter than the other labels.
  - The chosen locality shows as a selected card with "zmień" instead of a plain input. This is the shared `LocalityCombobox` behaviour.
  - "+50 km" wraps to a second row at 390 px.
- Impact: visual unevenness only; the information order is intact.
- Recommendation: align the label style; tighten the chip spacing.

### screen:wanted-form-errors (✓ Match)
- Mockup: analysis/design-context/mockups/wanted-form-errors.html
- Screenshot: verification/screenshots/w06-form-name-too-long.png, w31-form-cap-409.png, w07-form-contact-info-error.png, w10-form-moderation.png, w08-form-note-too-long.png
- The out-of-range prefilled name shows the inline red error under the field and a muted submit.
- The 409 alert sits above the name with the underlined "Zobacz listę".
- Contact and moderation alerts appear above the name.
- Spec override applied: the contact message is the full existing `CONTACT_INFO_MESSAGE`.

### screen:wanted-matches (✓ Match)
- Mockup: analysis/design-context/mockups/wanted-matches.html
- Screenshot: verification/screenshots/w18-matches-new-markers.png, w12-matches-forward.png, w19-toggle-off.png
- Header: "‹ Szukam" / "Edytuj", h1, filter line (full category path when set), "Notatka: …"; toggle row; "N pasujące rzeczy"; a 2-column card grid; "Ważne jeszcze N dni"; "Znalezione — zamknij" (primary) over "Przedłuż" / "Wycofaj". Matches.
- Spec override applied: the card pills read "Chcę oddać" / "Chcę się zamienić" (`ItemCard` labels).

### screen:wanted-matches-states (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/wanted-matches-states.html
- Screenshot: verification/screenshots/w27-matches-empty-expiring.png, w04-matches-active-empty.png, w28-matches-expired.png, w29-withdraw-dialog.png, w30-matches-not-found.png, w23-matches-fulfilled.png
- No matches: the bell tile, "Jeszcze nic nie pasuje" and the sentence match.
- Expired: the danger banner text and "Wznów na 90 dni" match.
- Withdraw dialog: title, body, "Wycofaj" / "Anuluj" match.
- Not-found: icon, title, body and "Wróć do listy „Szukam”" match.
- Deviation: the frame shows the 6-days-left action set ("Przedłuż o 90 dni" primary, then "Znalezione" / "Wycofaj"). In the live app, opening the page auto-extends the want to 90 days (FR-L-02), so the page always shows "Znalezione — zamknij" / "Przedłuż" / "Wycofaj". The code for the frame's layout exists (`WantMatchesView.tsx:276-294`).
- Recommendation: accept this, or drop the frame from the mockup set.

### component:close-want-sheet (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/close-want-sheet.html
- Screenshot: verification/screenshots/w35-close-want-sheet-one.png, w21-close-want-sheet-two.png
- One want: "Znalezione?", ✕, "Ta rzecz pasuje do Twojego poszukiwania:", „{name}”, "Zamknij poszukiwanie", "Szukam dalej" and the retention hint all match.
- Several wants: the bulleted names and "Zamknij oba poszukiwania" match.
- Deviation: right after the take, the "Zarezerwowano!" toast covers the primary button for about 3 s.

### component:want-disclosure (✓ Match)
- Mockup: analysis/design-context/mockups/wanted-form.html
- Screenshot: verification/screenshots/w05-form-empty-mobile.png, w03-form-prefilled.png
- Full-width button "Doprecyzuj (opcjonalnie)" with a ▸/▾ glyph. `aria-expanded` and `aria-controls` point at the existing panel. It starts collapsed when empty and expanded on prefill or edit.

### component:want-notification-toggle (✓ Match)
- Mockup: analysis/design-context/mockups/wanted-matches.html
- Screenshot: verification/screenshots/w12-matches-forward.png, w19-toggle-off.png
- The row label, sub-text "Damy znać w dzwonku" / "Wyłączone", and `role="switch"` with `aria-checked` all match.

### component:match-card (✓ Match)
- Mockup: analysis/design-context/mockups/wanted-matches.html
- Screenshot: verification/screenshots/w18-matches-new-markers.png, w23-matches-fulfilled.png
- The "nowe" marker sits top-left on the thumbnail. The caption "Zarezerwowane przez Ciebie" appears on a reserved card listed after the available ones. The "Twoja propozycja" and "Zarezerwowane" captions were not exercised (see the e2e report §8).

### component:entry-points (✓ Match)
- Mockup: analysis/design-context/mockups/entry-points.html
- Screenshot: verification/screenshots/w14-add-tile-count.png, w15-konto-row.png, w01-empty-search-guest-prompt.png
- The tile "Szukam rzeczy" with its count pill ("1 nowa", `pluralPl` per FR-F-15) matches.
- The Konto row "Szukam · 2 rzeczy · 1 nowe dopasowanie" matches.
- The empty-search prompt (sentence and button) matches.
- Spec override applied: the existing heading is kept; there is no "Szukaj wszędzie" button.

### component:bell-rows (✓ Match)
- Mockup: analysis/design-context/mockups/bell-rows.html
- Screenshot: verification/screenshots/w13-bell-one-match.png, w17-bell-two-matches.png, w34-bell-new-one-after-read.png, w26-bell-expiring.png
- All three texts match the mockup word for word: one match naming the item, "N nowe pasujące rzeczy", and the expiry reminder.
- There is one unread row per want, and the links are right. The bell UI itself is unchanged.
