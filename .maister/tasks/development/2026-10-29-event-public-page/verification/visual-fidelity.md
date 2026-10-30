# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/ (mockups rendered to `screenshots/mock-*.png` for side-by-side viewing)

## TL;DR
Fidelity is high. All 11 design IDs were compared: 9 match (✓), 2 show minor deviation (⚠), 0 show substantive drift (✗).
Layout order, copy and states match the binding mockups, including the user-decided overrides (M3 anonymous footer, gender-neutral copy).
The deviations are the merge-card divider placement and the attendee-list item rows, which could not be checked with local data.
Shared across all screens: `GroupHeader` stacks back button / eyebrow / h1 instead of the mockup's single row (it is reused as-is per spec), and the page sits inside the app shell (search bar + bottom nav).

## Open Questions / Risks
- Item rows (thumb, product name, "Weź na stałe"/"Zamiana", "Pokaż wszystkie (n)") and the banner were not rendered in any capture. Their fidelity is unverified.
- The app shell around the public page (search bar + bottom nav, also for anonymous visitors) is not in the mockups. Confirm that this is intended.

## Summary
- Total screens compared: 11 (7 screens + 4 components)
- Match (✓): 9
- Minor deviation (⚠): 2
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:event-anonymous (✓ Match)
- Mockup: analysis/design-context/mockups/anonymous-visitor-view.html (`screenshots/mock-anonymous-visitor-view.png`)
- Screenshot: verification/screenshots/26-anon-footer-withAttendee.png, verification/screenshots/03-anonymous-view-top.png
- Layout: header → when-card → description → "Zapisani i ich rzeczy" → sticky footer. Banner absent because none was uploaded (correctly conditional).
- Field order: author row first with the "ORGANIZATOR" pill, then attendees.
- Primary action: "＋ Zapisz się na wydarzenie", full-width primary footer ✓. No chat row ✓.
- Note: no header chip because the author has no Organization (L6 intended).

### screen:event-participant (✓ Match)
- Mockup: analysis/design-context/mockups/signed-up-participant-view.html
- Screenshot: verification/screenshots/10-participant-signed-up-toast.png, verification/screenshots/10b-participant-view-full.png
- Layout: "💬 Czat wydarzenia" full-width row between description and list ✓.
- Own row carries the "To Ty" pill (primary-soft) ✓. Outline "Wypisz się" footer ✓.

### screen:event-author (✓ Match)
- Mockup: analysis/design-context/mockups/author-view.html
- Screenshot: verification/screenshots/02b-author-view-top.png, verification/screenshots/13-author-delete-blocked-2.png
- Chat row, no footer, "TWOJE WYDARZENIE" card with the exact copy, "✏️ Edytuj" + danger "Usuń" side by side ✓.
- With attendees, "Usuń" is dimmed (`aria-disabled`) and the count hint appears below ✓.

### screen:event-guest-signup (✓ Match)
- Mockup: analysis/design-context/mockups/guest-sign-up-sheet.html
- Screenshot: verification/screenshots/05-guest-signup-sheet.png
- Bottom sheet with ✕, title, subtitle "name · sob. 7 listopada, 18:00", label "Twoje imię", hint, primary "Zapisz się", "Masz konto? Zaloguj się" ✓.
- Inline alert state: verification/screenshots/06-guest-signup-blank-error.png.

### screen:event-guest-merge (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/guest-signed-up-merge-card.html
- Screenshot: verification/screenshots/07b-guest-merge-card-full.png
- Layout: card below the list, no footer ✓. Copy is the gender-neutral "Zapisano Cię jako gościa ✓" (intended override) + hint ✓. Email/password/"Załóż konto" ✓.
- Deviation: an empty band and a divider render above the title inside the card. In the mockup the divider sits between the hint and the fields.
- Impact: cosmetic only.
- Recommendation: strip `AccountMergeForm`'s top border/padding when it is nested in the event card.

### screen:event-ended (✓ Match)
- Mockup: analysis/design-context/mockups/ended-event-state.html
- Screenshot: verification/screenshots/21-ended-event-logged-in.png, verification/screenshots/22-ended-event-anonymous.png
- Disabled, muted full-width "Wydarzenie się zakończyło" footer; list stays ✓. The ended-with-chat (attendee) variant was not reachable locally.

### screen:event-empty (✓ Match)
- Mockup: analysis/design-context/mockups/empty-participants-state.html
- Screenshot: verification/screenshots/03-anonymous-view-top.png, verification/screenshots/26-anon-footer-empty.png
- Author row always shown; dashed empty box with "Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany." ✓.
- Footer "＋ Zapisz się na wydarzenie" (M3 override of the mockup's login CTA, intended).

### component:event-when-card (✓ Match)
- Mockup: anonymous-visitor-view.html
- Screenshot: verification/screenshots/27-merged-attendee-view-with-place.png
- Date badge (SO / 7), eyebrow "TERMIN WYDARZENIA", full date with uppercase first letter, "godz. 18:00–21:00" ✓. The "MIEJSCE" block has name, address, notes and "Otwórz w Google Maps ↗" ✓. "Dodaj do kalendarza" + "Kopiuj link" ghost buttons ✓. No capacity ✓.

### component:event-attendee-list (⚠ Minor Deviation)
- Mockup: anonymous-visitor-view.html
- Screenshot: verification/screenshots/10b-participant-view-full.png
- h2 "Zapisani i ich rzeczy", avatar + name + pill rows ✓.
- Not verified: item rows (48px thumb, product name, mode label) and "Pokaż wszystkie (n)"/"Zwiń", because the test users had no listed items.
- Recommendation: spot-check on a seeded account.

### component:event-chat-row (✓ Match)
- Mockup: signed-up-participant-view.html
- Screenshot: verification/screenshots/10-participant-signed-up-toast.png
- Full-width rounded "💬 Czat wydarzenia" button; opens the EVENT thread ✓.

### component:event-footer (✓ Match)
- Mockup: anonymous-visitor-view.html
- Screenshot: verification/screenshots/26-anon-footer-withAttendee.png, verification/screenshots/15-withdraw-confirm-dialog.png, verification/screenshots/21-ended-event-logged-in.png
- Variants signUp / withdraw / ended observed. There is no "Zaloguj się" variant, by design (M3).

### Shared deviation (all screens, ⚠ informational, not counted)
- The mockup shows back button + org chip + eyebrow + h1 in one row. The implementation (`GroupHeader` reused as-is per spec) stacks the back button above the eyebrow and h1.
- The page renders inside the app shell (top search bar, bottom tab bar), which the mockups omit.
