# Design context index

## TL;DR
- 8 HTML mockups for the "Szukam" feature, generated in Phase 4 and bound to the app's real tokens and shared components (see `design-resources.md`).
- 5 screens and 6 components with stable IDs for `Visual References` in the implementation plan.
- Layout, Polish copy, field order and the listed states are binding; icons are placeholder glyphs (the implementation uses `appIcons.tsx`).

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:wanted-list | screen | analysis/design-context/mockups/wanted-list.html | `/wanted`: want cards with filter summary, match band, "N nowe" pill, expiry hint, expired row with "Wznów", fulfilled row with "Szukam znowu", "+ Dodaj" link; second frame: empty state with "+ Dodaj poszukiwanie" |
| screen:wanted-form | screen | analysis/design-context/mockups/wanted-form.html | `/add/wanted` empty, prefilled from search with "Doprecyzuj" expanded, and `/wanted/:id/edit`; name, disclosure, category, offer-mode chips, locality and radius chips, note |
| screen:wanted-form-errors | screen | analysis/design-context/mockups/wanted-form-errors.html | Form error states: prefilled name outside 3–80 with blocked submit, limit of 30 (409), contact details / moderation / 503 messages |
| screen:wanted-matches | screen | analysis/design-context/mockups/wanted-matches.html | `/wanted/:id`: header with filters and note, "Edytuj", notification toggle, item cards with "nowe", reserved captions, actions "Znalezione", "Przedłuż", "Wycofaj" |
| screen:wanted-matches-states | screen | analysis/design-context/mockups/wanted-matches-states.html | `/wanted/:id` states: no matches yet, expired with "Wznów", withdraw confirmation, own not-found state linking to `/wanted` |
| component:close-want-sheet | component | analysis/design-context/mockups/close-want-sheet.html | Sheet on the item page after a take: one want and several wants, "Zamknij poszukiwanie" / "Szukam dalej" (reuses ModalSheet) |
| component:want-disclosure | component | analysis/design-context/mockups/wanted-form.html | "Doprecyzuj" disclosure button with `aria-expanded` (new pattern) |
| component:want-notification-toggle | component | analysis/design-context/mockups/wanted-matches.html | Per-want notification switch row, saved at once |
| component:match-card | component | analysis/design-context/mockups/wanted-matches.html | ItemCard with the "nowe" marker and "Zarezerwowane przez Ciebie" / "Twoja propozycja" captions |
| component:entry-points | component | analysis/design-context/mockups/entry-points.html | `/add` tile with new-match count, "Konto" row with real counts, empty-search prompt "Dodaj do listy „Szukam”" |
| component:bell-rows | component | analysis/design-context/mockups/bell-rows.html | Bell rows: one match naming the item, several matches with a count, expiry reminder |
