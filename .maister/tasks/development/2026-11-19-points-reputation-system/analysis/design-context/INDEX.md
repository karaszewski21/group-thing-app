# Design Context Index

## TL;DR
Seven HTML mockups cover stage 1 of the points system:
- admin: category size class (list and edit) and the points config page
- organizer: the points level in the term form, and the attendance list before and after it is closed
- the owner-only „Twoje punkty” profile block

Panel screens use the Tailwind tokens from globals.css; admin screens use the Chakra/slate admin style.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:admin-category-list | screen | analysis/design-context/mockups/admin-kategorie-lista-z-klas-wielko-ci.html | Category tree with a size class column (set vs inherited) |
| screen:admin-category-edit | screen | analysis/design-context/mockups/admin-edycja-kategorii-klasa-wielko-ci.html | CategoryFormPage with a size_class select (Dziedzicz/Mała/Średnia/Duża) |
| screen:admin-points-config | screen | analysis/design-context/mockups/admin-konfiguracja-punkt-w.html | Single-form points_config: bases, multipliers, awards, attendance levels/cap/min/auto-close, pair limit, stage-2 cap |
| screen:term-form-points-level | screen | analysis/design-context/mockups/organizator-formularz-terminu-punkty-za-obecno.html | Term edit form with an attendance points level picker (admin-allowed levels) |
| screen:attendees-open | screen | analysis/design-context/mockups/organizator-lista-obecno-ci-przed-zatwierdzeniem.html | TermAttendeesPage with presence checkboxes, min-present info, „Zatwierdź obecność”, auto-close date |
| screen:attendees-closed | screen | analysis/design-context/mockups/organizator-lista-obecno-ci-zatwierdzona.html | Attendance closed (read-only), with awarded and below-minimum variants |
| screen:profile-points | screen | analysis/design-context/mockups/profil-twoje-punkty-widok-w-a-ciciela.html | Owner-only „Twoje punkty” block: balance, reputation, history, „Wydawanie punktów — wkrótce” |
| component:points-level-segmented | component | analysis/design-context/mockups/organizator-formularz-terminu-punkty-za-obecno.html | Segmented button group with aria-pressed, built from attendance_levels |
| component:attendance-checkbox-row | component | analysis/design-context/mockups/organizator-lista-obecno-ci-przed-zatwierdzeniem.html | Attendee row with a presence checkbox |
| component:points-history-row | component | analysis/design-context/mockups/profil-twoje-punkty-widok-w-a-ciciela.html | Ledger history entry with points and optional reputation |
