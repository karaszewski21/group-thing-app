# Design Context Index

## TL;DR
- 9 HTML mockups (Phase 4, mockup-studio): add-item flow with the 3 buttons, the shared CategoryTreePicker sheet (browse + search), item edit, admin category tree + form, and the term's needed list without categories.

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:dodaj-rzecz | screen | analysis/design-context/mockups/dodaj-rzecz.html | Add item form: empty required "Kategoria", buttons Oddam / Zamienię / Wersja robocza disabled until valid |
| screen:dodaj-rzecz-wybrana-kategoria | screen | analysis/design-context/mockups/dodaj-rzecz-wybrana-kategoria.html | Add item with chosen leaf shown as path + leaf name |
| screen:dodaj-rzecz-limit-oddam | screen | analysis/design-context/mockups/dodaj-rzecz-limit-oddam.html | Error state: backend gift limit (10) message |
| screen:wybor-kategorii-przegladanie | screen | analysis/design-context/mockups/wyb-r-kategorii-przegl-danie.html | CategoryTreePicker sheet, drill-down with breadcrumb and "Wstecz" |
| screen:wybor-kategorii-szukaj | screen | analysis/design-context/mockups/wyb-r-kategorii-szukaj.html | CategoryTreePicker sheet, search results with full paths (combobox) |
| screen:edycja-rzeczy-kategoria | screen | analysis/design-context/mockups/edycja-rzeczy-kategoria.html | NameCategoryEditor with "Kategoria" field + status chip |
| screen:admin-drzewo-kategorii | screen | analysis/design-context/mockups/admin-drzewo-kategorii.html | Admin CategoryListPage as expandable tree, sibling reorder, 409 alert |
| screen:admin-formularz-kategorii | screen | analysis/design-context/mockups/admin-formularz-kategorii.html | Admin CategoryFormPage with parent picker (any node, read-only on edit) |
| screen:rzeczy-potrzebne-na-termin | screen | analysis/design-context/mockups/rzeczy-potrzebne-na-termin.html | Term needed list as plain names (no category) |
| component:category-tree-picker | component | analysis/design-context/mockups/wyb-r-kategorii-szukaj.html | Shared ModalSheet picker: search + drill-down, leaf-only (any-node mode for admin parent) |
| component:item-submit-actions | component | analysis/design-context/mockups/dodaj-rzecz.html | Three submit buttons: Oddam (primary), Zamienię (secondary), Wersja robocza (outline) |
