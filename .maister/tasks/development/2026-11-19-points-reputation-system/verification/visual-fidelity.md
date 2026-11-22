# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
- 7 screens compared: 4 ✓ match, 3 ⚠ minor deviation, 0 ✗ drift.
- Layout regions, field order, primary actions, copy and state coverage follow the mockups on every screen.
- The deviations are cosmetic or spec-sanctioned:
  - unstyled admin inputs and buttons (admin-wide, pre-existing);
  - one help-text wording change;
  - the points block moved to the full-width `/account/points` page, as the spec remapped it.

## Key Decisions
- The mockups were rendered with a temporary local HTTP server and captured as `mock-*.png`, so both sides of each pair are rendered images.
- `screen:profile-points` is compared with the `/account/points` page. The spec remapped that block from the public profile to that page.

## Open Questions / Risks
- Admin inputs and buttons render without borders or fill on both the new points page and the pre-existing category form. This is worth a separate admin-theme fix (see E2E report C1).

## Summary
- Total screens compared: 7
- Match (✓): 4
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:admin-category-list (✓ Match)
- Mockup: analysis/design-context/mockups/admin-kategorie-lista-z-klas-wielko-ci.html (`screenshots/mock-admin-category-list.png`)
- Screenshot: `screenshots/05-admin-category-list.png`, `screenshots/07-admin-category-list-after-save.png`
- Layout: header columns „KATEGORIA” and „KLASA WIELKOŚCI”, nested disclosure rows with ▸/▾, „Edytuj” per row. This matches.
- Field order: the size-class pill sits after the name, as in the mockup. The implementation keeps its existing extra controls (subcategory count, ↑/↓, + Podkategoria, Usuń).
- States covered: set („Średnia”, „Duża”) and inherited („Średnia · dziedziczona”, „Duża · dziedziczona”) pills, in green and muted styles as in the mockup.

### screen:admin-category-edit (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/admin-edycja-kategorii-klasa-wielko-ci.html (`screenshots/mock-admin-category-edit.png`)
- Screenshot: `screenshots/06-admin-category-edit.png`
- Layout: breadcrumb „Kategorie / Edytuj kategorię”, then parent, Nazwa, „Klasa wielkości (wycena punktowa)” select, help text, Opis, Zapisz/Anuluj. This matches.
- Field order: same as the mockup.
- Deviation 1: the help text reads „…Zmiana nie wpływa na ceny już wystawionych rzeczy.” The mockup says „…ofert „za punkty””.
- Deviation 2: Nazwa input and Zapisz/Anuluj render unstyled (no border or fill). This is the pre-existing admin styling.
- Impact: none on information hierarchy.
- Recommendation: keep the copy, since it matches stage 1 better; fix the admin theme separately.

### screen:admin-points-config (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/admin-konfiguracja-punkt-w.html (`screenshots/mock-admin-points-config.png`)
- Screenshot: `screenshots/01-admin-points-config.png`, `screenshots/04-admin-points-validation.png`
- Layout: notice banner, then six fieldsets in mockup order: Wycena, Mnożniki stanu, Nagrody, Obecność na terminach, Ochrona przed nabijaniem, Oferty „za punkty” (etap 2, muted). The grid matches.
- Field order: the same within every fieldset; level chips with ✕ and „+ poziom”; inline red `role="alert"` errors under each field.
- Deviation 1: inputs show no border and „Zapisz konfigurację” / „Dodaj” are not filled buttons. The cause is the admin Chakra styling, which is pre-existing.
- Deviation 2: multiplier 1.0 is shown as „1”, not „1,0”.
- Impact: the fields are less clearly editable; content and behaviour are complete.
- Recommendation: fix the admin input and button recipes once for all admin pages.

### screen:term-form-points-level (✓ Match)
- Mockup: analysis/design-context/mockups/organizator-formularz-terminu-punkty-za-obecno.html (`screenshots/mock-term-form.png`)
- Screenshot: `screenshots/08-add-term-points-level.png`, `screenshots/10-term-edit-points-level.png`
- Layout: „Punkty za obecność” label, a full-width three-button segmented control with the selected level filled green, and the help text below. This matches.
- Field order: the picker comes after place and capacity, before the needed items and the submit button.
- Primary action: „Dodaj termin” (add) and „Zapisz” (edit). The existing forms keep their own buttons.
- States covered: default lowest level, a selected level, and the edit form showing the current level.

### screen:attendees-open (✓ Match)
- Mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-przed-zatwierdzeniem.html (`screenshots/mock-attendees-open.png`)
- Screenshot: `screenshots/11-attendees-open-1-of-3.png`, `screenshots/13-attendees-open-3-of-3.png`, `screenshots/12-close-dialog-below-minimum.png`
- Layout: „Zapisani na termin” header, the info banner (level, minimum, „Teraz: X z Y”), checkbox rows with „obecny”, a full-width „Zatwierdź obecność”, and the auto-close date line. This matches.
- Extra: the organizer row carries „organizator — nie dostaje punktów i nie liczy się do minimum” (spec W6). The existing term card and the „Napisz do uczestników” button stay above the list.
- States covered: NOT_STARTED (`screenshots/09-attendees-not-started.png`), OPEN, and the confirmation dialog with the below-minimum warning.

### screen:attendees-closed (✓ Match)
- Mockup: analysis/design-context/mockups/organizator-lista-obecno-ci-zatwierdzona.html (`screenshots/mock-attendees-closed.png`)
- Screenshot: `screenshots/15-attendees-closed-rewarded.png`, `screenshots/16-attendees-closed-below-minimum.png`
- Layout: the result banner replaces the info banner; rows are read-only with disabled checkboxes and „obecny”; the close button is gone. This matches.
- Copy: the awarded text („Obecność zatwierdzona 22 listopada. Obecnych: 3. Każda z tych osób otrzymała do 20 pkt (w granicach miesięcznego limitu).”) and the below-minimum text („Obecność zatwierdzona. Za mało obecnych osób (1 z min. 3), punkty nie zostały naliczone.”) match the mockup's two variants.
- States covered: the awarded and below-minimum variants.

### screen:profile-points (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/profil-twoje-punkty-widok-w-a-ciciela.html (`screenshots/mock-profile-points.png`)
- Screenshot: `screenshots/18-account-points-page.png`, `screenshots/22-giver-points-give-free.png`, `screenshots/19-account-points-empty.png`
- Layout: the card has „Twoje punkty”, „Widzisz to tylko Ty.”, two tiles (punktów / reputacji), the „wkrótce” note, „Historia” rows (icon, title, date · subtitle, „+N reputacji” pill, signed amount) and the „Jak zdobywać punkty” footer. This matches.
- Deviation 1: the block lives on the full-width `/account/points` page, not inside a narrow profile column. The spec remapped it.
- Deviation 2: the ATTENDANCE title is „Obecność na terminie”, with the group in the subtitle, and the GIVE_FREE subtitle is „Odbiorca: {name}” instead of „dla Marty N.”. Both follow the spec's history-row table.
- Deviation 3: „Pokaż starsze” was not visible because there were fewer than one page of entries.
- Impact: none on information hierarchy.
- Recommendation: none, beyond optionally constraining the card width on wide screens.
