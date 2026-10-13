# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md (mockups in analysis/design-context/ascii/ui-mockups.md)
**Captured**: verification/screenshots/

Intended deviations (user decisions): take-sheet primary CTA is "Zobacz rzecz" → `/product/{id}` (not "Zobacz w panelu"); dates use dayjs `ddd` (`śr 14.10`); no bell emoji in the settings line. None of these count as drift.

## Summary
- Total screens compared: 6
- Match (✓): 5
- Minor deviation (⚠): 1
- Substantive drift (✗): 0

## Per-Screen Comparison

### component:add-to-calendar (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#add-to-calendar
- Screenshots: verification/screenshots/03-take-calendar-menu-open.png, verification/screenshots/07-item-page-taker-calendar-open.png, verification/screenshots/12-swap-accept-calendar-open.png
- Trigger: CalendarIcon + "Dodaj do kalendarza" + ▾/▴ indicator; `aria-haspopup="menu"`, `aria-expanded` toggles ✓
- Popover: `rounded-2xl border border-line bg-paper p-1.5 shadow`, two `role="menuitem"` entries "Kalendarz Google ↗" (`<a target=_blank rel="noopener noreferrer">`) and "Apple / Outlook (.ics) ⬇" (`<button>`) ✓
- Direction: upward in sheets (`bottom-full mb-2`), downward on the item page (`top-full mt-2`) ✓
- Same control in all three places ✓

### screen:take-success-sheet (⚠ Minor Deviation)
- Mockup: analysis/design-context/ascii/ui-mockups.md#take-success-sheet
- Screenshots: verification/screenshots/02-take-success-mobile.png, verification/screenshots/05-take-success-desktop.png
- Layout (mobile): bottom sheet, title "Wzięte!" + ✕, check badge on `bg-primary-soft`, bold headline, `text-ink-soft` hint, stacked full-width calendar → primary "Zobacz rzecz" → "Zamknij" text button ✓
- Layout (desktop): centered 430 px card, actions in one row, no separate "Zamknij" (✕ only) ✓
- Copy: `Odbierz „PucioA2” w śr 14.10 o 16:30 — Muzyczne Maluchy A2`; hint verbatim ✓
- Deviation: on desktop the "Dodaj do kalendarza" label wraps onto two lines and the "Zobacz rzecz" label sits at the top of the taller pill instead of being centered. The mockup shows single-line buttons.
- Impact: cosmetic; information hierarchy preserved
- Recommendation: `inline-flex items-center justify-center` on the primary Link and `whitespace-nowrap` on the trigger label (report §5.4 C-1)

### screen:swap-accept-success (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#swap-accept-success
- Screenshot: verification/screenshots/11-swap-accept-success-mobile.png
- Layout: panel ModalSheet, title "Zamiana zaakceptowana" + ✕ ✓
- Body order: `„KaskA2” ↔ „RowerekA2”` → `śr 14.10 o 16:30` → `— Muzyczne Maluchy A2` (bold) → `Przynieś „KaskA2” i odbierz „RowerekA2” na tym terminie.` (ink-soft) ✓
- Actions: calendar first, then primary "Gotowe" (full width on mobile) ✓
- States covered: single-offer default. Not captured: the "Pozostałe propozycje zostały odrzucone." line (needs >1 offer) and the degraded no-term variant.

### screen:item-page-reservation (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#item-page-reservation
- Screenshots: verification/screenshots/06-item-page-taker-desktop.png, verification/screenshots/08-item-page-owner-desktop.png, verification/screenshots/08-item-page-nonparty-desktop.png
- Party view: clock badge, `role="status"` line `Zarezerwowana — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy A2`, detail line `Dla: …`, small calendar button on a light pill under the detail and outside the status `<p>` ✓
- Non-party view: `Zarezerwowana — odbiór na terminie 14.10`, `Dla: inna rodzina`, no button (unchanged) ✓

### screen:pending-actions-modal-app-wide (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#pending-actions-modal-app-wide
- Screenshots: verification/screenshots/14-pending-prompt-item-page-mobile.png (5a), verification/screenshots/17-swap-confirm-prompt-term-page-mobile.png and verification/screenshots/18-swap-confirm-prompt-term-page-desktop.png (5b), verification/screenshots/10-panel-swap-proposed-prompt.png (5c)
- 5a: "Potwierdź przekazanie" + ✕; question `Czy przekazanie „PucioA2” doszło do skutku? (wt 13.10, Muzyczne Maluchy A2)`; [Potwierdź] [Później] row; hint `Przypomnimy jutro o 8:00.` in small ink-soft text ✓
- 5b: "Potwierdź zamianę"; swap question; same actions and hint; desktop centered card ✓
- 5c: "Propozycja zamiany", [Zobacz w Moje rzeczy] [Później], snooze hint ✓
- Primary buttons use the krag `bg-primary` pill (the mockup's "mint" note was superseded by spec R8.10, which requires krag classes) ✓
- Not captured: 5d join request (blocked by test data), 5e already-resolved

### screen:settings (✓ Match)
- Mockup: analysis/design-context/ascii/ui-mockups.md#settings
- Screenshots: verification/screenshots/01-settings-mobile.png, verification/screenshots/23-settings-desktop.png
- Layout: "Powiadomienia" card removed; "Prywatność" first with "Widoczny profil publiczny" toggle; "Konto" with "Wyloguj się" ✓
- In-app line below the cards: `Powiadomienia dostajesz w aplikacji (dzwonek u góry ekranu).` in small ink-soft text (bell emoji intentionally omitted) ✓
