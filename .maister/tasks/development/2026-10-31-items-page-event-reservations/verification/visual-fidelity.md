# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
- The implementation follows the mockups closely. I compared 13 entries: 3 match, 10 have minor deviations and 0 show substantive drift.
- Layout, field order, copy and primary actions match on every screen.
- Most deviations share one root cause: the item page has no "Oddam/Zamienię" mode chip beside "Dostępna", which affects 7 screens.
- The rest are a delete dialog shown as a centered dialog instead of a sheet, the stale CTA copy, and smaller preview thumbnails.

## Open Questions / Risks
- Should the item page get the mode chip that every item mockup shows? Today only the action button label conveys the mode.
- Is "Przejdź do wydarzenia ›" (when the next date is an event) the accepted copy instead of "Przejdź do nowego terminu ›"?

## Summary
- Total screens compared: 13 (11 screens + 2 components)
- Match (✓): 3
- Minor deviation (⚠): 10
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:owner-items-nearest-term (✓ Match)
- Mockup: analysis/design-context/mockups/owner-items-page-nearest-term.html (render: verification/screenshots/mockup-owner-items-page-nearest-term.png)
- Screenshot: verification/screenshots/03-owner-items-org-nearest-chips.png
- Layout: back link, then the avatar and "Rzeczy: <name>" header with the count, the "Najbliższa okazja do odbioru" card with a DateTile and the CTA, filter pills, and a 2-column grid. All match.
- Chips: "Zamienię · sob 31 paź" matches the "Weź · sob 8 lis" pattern when the page has no query. When opened with a non-nearest `?event=`, the date is dropped (see the E2E report, §5.3 #1).
- Primary action: "Zobacz wydarzenie i zapisz się" matches.

### screen:owner-items-chat-only (✓ Match)
- Mockup: analysis/design-context/mockups/owner-items-page-no-upcoming-terms-chat-only.html
- Screenshot: verification/screenshots/04-owner-items-party-chat-only.png
- Layout: "‹ Wróć", header, the notice "<name> nie ma teraz zaplanowanych spotkań" and "Napisz w sprawie konkretnej rzeczy — umówicie się na czacie.", and mode-only chips "Oddam"/"Zamienię". All match.

### screen:event-participants-preview (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/event-page-participants-preview.html (render: verification/screenshots/mockup-event-page-participants-preview.png)
- Screenshot: verification/screenshots/01-event-page-participants-preview.png
- Layout: participant rows with avatar, name and "Organizator" pill; up to 3 item rows with name and "mode · dodano …"; "Pokaż więcej (N) ›". All match.
- Deviation: item thumbnails are small squares, where the mockup shows wide tiles.
- Impact: visual only.

### component:participant-items-preview (⚠ Minor Deviation)
- Same as above. It is also used on the term page with the inline Weź/Zamień actions slot (verification/screenshots/18-term-page-preview-inline-actions.png).

### screen:item-gift-eligible (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-gift-eligible-we.html (render: verification/screenshots/mockup-item-page-gift-eligible-we.png)
- Screenshot: verification/screenshots/07-item-gift-eligible.png
- Match: context line "📅 Odbiór na: … ", Weź (primary), Napisz (secondary), the hint "Rezerwacja możliwa do startu wydarzenia…", and the owner row with "Zobacz wszystkie rzeczy (N) ›".
- Deviation: there is no "Oddam" mode chip beside "Dostępna". The existing status card is shown instead.

### component:item-context-actions (✓ Match)
- Action card structure (context line, primary/secondary actions, hint) matches across all view kinds.

### screen:item-swap-picker (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-swap-picker-zamieni.html
- Screenshot: verification/screenshots/11-item-swap-picker.png
- Match: "Co proponujesz w zamian?", "Twoje rzeczy wystawione do zamiany", item list with condition, Anuluj / "Zaproponuj zamianę".
- Deviation: the mode chip is missing on the page behind the sheet (same root cause).

### screen:item-not-signed-up (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-not-signed-up-zapisz-si.html
- Screenshot: verification/screenshots/06-item-not-signed-up.png
- Match: context line, the hint "Żeby zarezerwować tę rzecz, zapisz się na wydarzenie — tam ją odbierzesz.", "Zapisz się na wydarzenie ›", Napisz. The copy is identical.
- Deviation: the mode chip is missing.

### screen:item-anonymous-gate (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-anonymous-account-gate.html
- Screenshot: verification/screenshots/05-item-anonymous-account-gate.png
- Match: sheet "Załóż konto, żeby zarezerwować", body copy, "Załóż konto" and "Mam konto — zaloguj". The copy is identical.
- Deviation: the mode chip is missing.

### screen:item-stale-context (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-stale-context-termin-si-odby.html (render: verification/screenshots/mockup-item-page-stale-context-termin-si-odby.png)
- Screenshot: verification/screenshots/10-item-stale-event-started.png
- Match: the "⏱ <name> (<date>) …" warning, the "<owner> ma kolejne …" hint, the CTA and Napisz.
- Deviation: the CTA reads "Przejdź do wydarzenia ›" instead of "Przejdź do nowego terminu ›" (the next date is an event), and the mode chip is missing.

### screen:item-no-context (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-no-context-napisz-only.html
- Screenshot: verification/screenshots/14-item-no-context.png
- Match: "Właściciel nie ma teraz zaplanowanych spotkań", "💬 Napisz do właściciela", "Umówcie się na czacie w sprawie tej rzeczy.", the owner row.
- Deviation: the mode chip is missing.

### screen:item-own (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/item-page-own-item.html
- Screenshot: verification/screenshots/13-item-own.png
- Match: "To Twoja rzecz — widoczna dla uczestników „…”", Edytuj, no actions.
- Deviation: the mode chip is missing.

### screen:event-delete-cancels (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/event-delete-cancels-reservations.html (render: verification/screenshots/mockup-event-delete-cancels-reservations.png)
- Screenshot: verification/screenshots/16-event-delete-cancels-dialog.png
- Match: title "Usunąć wydarzenie?", the count line with the swap count, the consequence copy, Anuluj and the red "Usuń i anuluj rezerwacje".
- Deviation: the implementation shows a centered alert dialog where the mockup shows a bottom sheet, and the count is not bold.
- Recommendation: optional. It reuses the existing confirm dialog component.
