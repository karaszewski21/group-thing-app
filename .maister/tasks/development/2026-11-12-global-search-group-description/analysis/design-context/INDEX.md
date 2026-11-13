# Design Context Index

## TL;DR
7 HTML mockups (mockup-studio, Phase 4) for the global search page (items, meetings, empty, guest, hint states), the group form description field, and the group terms page header. Bound to `globals.css` tokens and existing components (SearchView, ItemCard, GroupCard, DateTile, GroupFormFields, AboutTab counter). Design resources: `design-resources.md`.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:search-items | screen | analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html | /search, Przedmioty × Moje grupy: pill input, mode tablist, scope toggle, filters (kategoria/stan/tryb), ItemCard grid with reserved greyed "Zarezerwowana do <data>" / "Zarezerwowana", other-mode footer |
| screen:search-meetings | screen | analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html | Spotkania × Wszędzie: date filters, mixed list Termin / Wydarzenie / Grupa (description clamp 2, "najbliższe spotkanie: <data> →") / Organizacja, other-mode footer |
| screen:search-empty-items | screen | analysis/design-context/mockups/szukaj-brak-przedmiot-w.html | Empty Przedmioty: dashed empty card + "Dodaj do listy 'szukam'" (→ /add/hunting?name=q), highlighted other-mode footer |
| screen:search-guest | screen | analysis/design-context/mockups/szukaj-go.html | Guest: no scope toggle (forced Wszędzie), "Zaloguj się", public items / events, PUBLIC groups, orgs |
| screen:search-hint | screen | analysis/design-context/mockups/szukaj-mniej-ni-2-znaki.html | Query < 2 chars: hint, no request |
| screen:group-form-description | screen | analysis/design-context/mockups/formularz-grupy-opis.html | Group create/edit "Opis" textarea + "n / 500" counter; >500 inline error; moderation 400 banner; no "w moderacji" badge |
| screen:group-terms-header | screen | analysis/design-context/mockups/strona-termin-w-grupy-nag-wek-z-opisem.html | /<slug>/group/<id>/terms GroupCard hero with full description; variant without description = today |
| component:search-result-row | component | analysis/design-context/mockups/szukaj-spotkania-wsz-dzie.html | Single result card driven by `kind` (term/event/group/organization) with type label |
| component:other-mode-line | component | analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html | "<n> spotkań/przedmiotów pasuje do 'q' →" link, highlighted variant when list empty |
| component:segmented-toggle | component | analysis/design-context/mockups/szukaj-przedmioty-moje-grupy.html | Mode tablist + scope radiogroup reusing SearchView segmented markup |
