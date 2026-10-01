# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md (ASCII mockups in analysis/design-context/ascii/ui-mockups.md)
**Captured**: verification/screenshots/

## Summary
- Total screens compared: 13
- Match (✓): 8
- Minor deviation (⚠): 1
- Substantive drift (✗): 0
- Not comparable live (no data or state reachable): 4 (listed at the end)

## Per-Screen Comparison

### screen:rodzina-populated (✓ Match)
- Mockup: ui-mockups.md#rodzina-populated (Mockup 2)
- Screenshots: screenshots/04-rodzina-children-added.png, screenshots/07-returnTo-safe.png
- Layout: "Mój dom" h2 → family name + rename pencil → "N osoby" → member panel → "Dodaj kolejnego członka" form → return button as the last element. The order matches.
- Member rows: name + `(Ty)`/`(dziecko)` suffix in a soft tone; the child meta line sits under the name with a pencil; the trash button stays on the right and is hidden on the self row. This matches.
- No PanelNav on this view, as the mockup notes.

### component:member-role-label (✓ Match)
- Mockup: ui-mockups.md#rodzina-populated
- Screenshot: screenshots/04-rodzina-children-added.png
- "(Ty)" and "(dziecko)" render as a soft-ink suffix after the name. "(opiekun)" was not visible because the family has no second guardian.

### component:child-birth-year-inline (✓ Match)
- Mockup: ui-mockups.md#child-birth-year-inline (Mockup 5, states A-D)
- Screenshots: screenshots/04-rodzina-children-added.png (A, B), screenshots/05-inline-edit-invalid-year.png (C/D), screenshots/06-inline-edit-saved-toast.png (toast)
- State A: "rocznik 2018 · ok. 8 lat" + pencil (aria-label includes the child's name). State B: "+ Dodaj rok urodzenia" mint text button. State C: numeric input + "Zapisz". State D: "Podaj rok urodzenia z zakresu 1900–2026" with Zapisz disabled. Toast copy "Zapisano rok urodzenia". All match.

### component:birth-year-field (⚠ Minor Deviation)
- Mockup: ui-mockups.md#birth-year-field (Mockup 6)
- Screenshots: screenshots/02-add-form-child-invalid-year.png, screenshots/03-add-form-child-valid-year.png
- Layout: the field is the third item of the form grid, below "Rola", shown only for "Dziecko". There is a live "ok. 8 lat" hint, and the placeholder is "np. 2018". This matches.
- Deviation: the mockup's ASCII label reads "ROK URODZENIA (opcjonalnie)", while the implementation reads "Rok urodzenia". The spec table (`Field label="Rok urodzenia"`) prescribes the implemented label, so this follows the spec over the wireframe annotation.
- Impact: the field's optionality is not stated in its label. "Dodaj" stays enabled when it is empty.
- Recommendation: optional; confirm with design whether "(opcjonalnie)" is wanted.

### component:return-to-term-button (✓ Match)
- Mockup: ui-mockups.md#return-to-term-button (Mockup 4)
- Screenshots: screenshots/07-returnTo-safe.png, screenshots/08-returnTo-unsafe-doubleslash.png, screenshots/09-returnTo-unsafe-tab.png
- Full-width outline secondary link with a back chevron and "Wróć do terminu", placed at the bottom. The visibility table holds: shown for `/x/grupa/1/term/2`; hidden for `//evil.com`, `/\tevil.com` and `/\evil.com`.

### screen:rsvp-dialog-logged-in (✓ Match, prefill branch)
- Mockup: ui-mockups.md#rsvp-banner (Mockup 1)
- Screenshot: screenshots/15-rsvp-dialog-logged-in.png
- The family has children, so the dialog shows the prefill branch ("Zapisujesz się jako …", "Liczba dzieci" = 2, "Zapisz się"), which the mockup lists as the post-return state. The banner branch was not reachable live (see below).

### screen:organizer-term-card / component:signup-summary-chip (✓ Match)
- Mockup: ui-mockups.md#organizer-term-card (Mockup 8)
- Screenshots: screenshots/10-panel-home-chips.png, screenshots/11-spotkania-chips.png
- The chip is on its own `mt-1.5` row under the subtitle, with a FamilyIcon, "N zapisy · M dzieci" and a trailing `›`, styled as a neutral paper pill. The right icon column (copy, edit) is unchanged. Plurals are "2 zapisy · 1 dziecko" and "4 zapisy · 5 dzieci".

### screen:organizer-term-attendees / component:term-attendee-row (✓ Match)
- Mockup: ui-mockups.md#organizer-term-attendees (Mockup 9)
- Screenshots: screenshots/12-term-attendees-page.png, screenshots/13-term-attendees-deeplink.png
- Back link "Wróć" → "Zapisani" h2 → summary → read-only term head (date tile "29 WRZ", group name, time + description, "Zobacz stronę terminu ›") → rounded paper panel with cream attendee rows. Each row has the name, family name, a pill (mint for ≥1, cream for 0) and the ages line. No child names appear and there is no PanelNav. This matches.

### screen:organizer-term-attendees-states (✓ Match, notFound only)
- Mockup: ui-mockups.md#organizer-term-attendees-states (Mockup 10, split per spec req. 21)
- Screenshot: screenshots/14-term-attendees-notfound.png
- The header is only the back link and "Zapisani". The message "Nie znaleziono tego terminu." is in soft ink, with no retry, summary or term card. This matches the approved split copy.

## Not comparable live
- **screen:rodzina-empty**: requires `family === null`. Deleting the family was not allowed.
- **screen:create-family-step2**: CreateFamilyDialog is reachable only from the empty state.
- **RSVP banner branch** (`child_count === 0`): the family already had children when it was checked.
- **Attendees loading, empty, error and denied states, and the "Brak zapisów" chip**: the live data has no empty term and no failing or non-organizer setup.
