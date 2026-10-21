# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
Fidelity is high: all six mockup screens are present, with matching layout, field order, primary actions and Polish copy.
3 screens match (✓), 3 show minor deviations (⚠), and none show substantive drift (✗).
The deviations are the documented `AuthGateLinks` copy ("Zarejestruj się" instead of "Załóż konto"), a missing "⧉" glyph on the copy buttons, and the stepper CTA block, which is conditional and absent for an organizer who already has an organization.

## Open Questions / Risks
_None._ No substantive drift. The copy-button glyph is the only undocumented deviation, and the design owner can accept or restore it.

## Summary
- Total screens compared: 6
- Match (✓): 3
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:private-gate-logged-in (✓ Match)
- Mockup: analysis/design-context/mockups/brama-grupy-prywatnej-zalogowany.html
- Screenshot: verification/screenshots/20-gate-logged-in.png
- Layout: back button, "KRĄG" eyebrow, group title, "Prowadzi: …", then a single white gate card. Matches.
- Copy: "🔒 Ta grupa jest prywatna" / "Zajęcia i lista uczestników są widoczne tylko dla członków. Wpisz kod dostępu od organizatora, aby dołączyć." Matches verbatim.
- Primary action: "Mam kod dostępu" (left-aligned pill), replacing "Poproś o dostęp". Matches.
- States covered: default; clicking it opens the sheet (verification/screenshots/21-sheet-empty.png).

### screen:private-gate-anonymous (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/brama-grupy-prywatnej-anonim.html
- Screenshots: verification/screenshots/19-gate-anonymous-no-code.png (no code), verification/screenshots/05-gate-anonymous-with-code.png (with `#code=`)
- Layout: header block plus a gate card with a full-width "Zaloguj się" primary button and a secondary link row below. Matches.
- Copy, without code: "… Zaloguj się, aby wpisać kod dostępu." Matches. With code: "… Masz kod? Zaloguj się, żeby go użyć." Matches.
- Deviation: the secondary action reads "Nie masz konta? Zarejestruj się" where the mockup shows "Załóż konto".
- Impact: none. This is the documented exception (spec audit L10: `AuthGateLinks` is unchanged and the mockup label was an approximation).
- Recommendation: none; accepted by spec.

### screen:join-by-code-sheet (✓ Match)
- Mockup: analysis/design-context/mockups/wpisz-kod-dost-pu-joinbycodesheet.html
- Screenshots: verification/screenshots/21-sheet-empty.png (empty), verification/screenshots/17-sheet-invalid-input.png (invalid), verification/screenshots/09-wrong-code-409.png (409), verification/screenshots/10-rate-limit-429.png (429), verification/screenshots/16-old-code-409-after-regen.png (409 after regenerate)
- Layout: krag ModalSheet with title "Wpisz kod dostępu" and ✕; label "Kod dostępu"; a single wide monospace input; hint "6 cyfr, np. 123 456"; inline alert; Anuluj / Dołącz side by side. Matches.
- Field order: label → input → hint → alert → actions. Matches.
- States covered: empty (Dołącz disabled), invalid ("Kod ma 6 cyfr", danger border), 409 ("Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie"), 429 ("Za dużo prób wpisania kodu — spróbuj ponownie za 15 min"). The busy ("Dołączanie…") and "Inny błąd" states were not captured live because the request resolved too fast and no generic failure was induced.

### screen:group-details-join-code-card (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/szczeg-y-grupy-z-kart-kodu-organizator.html
- Screenshots: verification/screenshots/03-group-details-code-card.png, verification/screenshots/15-regenerated-code.png
- Layout: details card (Widoczność "Prywatna (dostęp z kodem)", Układ, Domyślne miejsce, Domyślny limit miejsc, Utworzono, "Zobacz stronę organizatora ›"), then the JoinCodeCard, then "Uczestnicy terminów". Order matches.
- Card: heading "Kod dostępu", lead "Podaj go osobom, które mają dołączyć do grupy.", a tinted monospace code panel "201 550", a primary "Kopiuj kod", a secondary "Kopiuj link z kodem", and a text link "Wygeneruj nowy kod". Matches.
- Deviation: the mockup prefixes both copy buttons with "⧉"; the implementation is text-only. The feedback is an inline `role=status` line in the card ("Skopiowano link", "Wygenerowano nowy kod"), consistent with the mockup note "toast lokalny (useToast + role=status)".
- Impact: cosmetic only; the information hierarchy is preserved.
- Recommendation: confirm with the design owner, or add an `aria-hidden` copy icon.
- Not captured: the "no upcoming term" variant (only "Kopiuj kod").

### screen:regenerate-confirm (✓ Match)
- Mockup: analysis/design-context/mockups/potwierdzenie-wygeneruj-nowy-kod.html
- Screenshot: verification/screenshots/04-regenerate-confirm.png
- Layout: centered rounded alertdialog over a dimmed page; title, body, then two side-by-side buttons (neutral "Anuluj", primary-tone "Wygeneruj nowy kod"). Matches.
- Copy: "Wygenerować nowy kod?" / "Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie." Matches verbatim.
- States covered: default, cancel, confirm (the busy label was not captured).

### screen:stepper-done-private (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/kreator-ekran-ko-cowy-grupa-prywatna.html
- Screenshot: verification/screenshots/01-stepper-done-private.png
- Layout: "Załóż grupę" sheet with ✕, success copy, the JoinCodeCard, "Przejdź do publicznej strony →" (primary) and "Gotowe" (secondary). Order matches.
- Copy: "Grupa założona, termin dodany! Grupa jest prywatna — dołączą tylko osoby, którym podasz kod dostępu." Matches verbatim.
- Deviations: the copy buttons lack "⧉" (as on the details page). The mockup's bottom CTA ("Chcesz publiczną wizytówkę… Stwórz publiczną wizytówkę / własny adres →") was not shown, because the test organizer already had an organization; the CTA exists in `CreateGroupStepper.tsx` and is conditional.
- Impact: cosmetic only.
- Recommendation: same as the details page for the glyph; the CTA needs no action.
