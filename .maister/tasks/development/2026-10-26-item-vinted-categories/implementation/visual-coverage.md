# Visual Coverage Matrix

## TL;DR
- Every one of the 11 screen/component IDs in `analysis/design-context/INDEX.md` is covered by at least one task group (100%).
- The UI groups are 10 (picker), 11 (add item), 12 (item edit), 13 (admin) and 14 (needed items).

## Key Decisions
- The admin tree follows the mockup layout, but its ARIA uses nested lists with disclosure buttons instead of `role="tree"` (a spec Key Decision).
- Every picker trigger is a `<button type="button">` labelled through `aria-labelledby`, where the mockups show a `div role=button` inside a `<label>` (spec audit H1).

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:dodaj-rzecz | Group 11 (Add Item — Picker + 3 Buttons) | ✅ |
| screen:dodaj-rzecz-wybrana-kategoria | Group 10 (CategoryTreePicker trigger), Group 11 (Add Item) | ✅ |
| screen:dodaj-rzecz-limit-oddam | Group 11 (Add Item; backend message from Group 5) | ✅ |
| screen:wybor-kategorii-przegladanie | Group 10 (CategoryTreePicker) | ✅ |
| screen:wybor-kategorii-szukaj | Group 10 (CategoryTreePicker) | ✅ |
| screen:edycja-rzeczy-kategoria | Group 12 (Item Edit & Moje rzeczy) | ✅ |
| screen:admin-drzewo-kategorii | Group 13 (Admin Category Tree & Product Forms) | ✅ |
| screen:admin-formularz-kategorii | Group 13 (Admin forms), Group 10 (any-mode picker) | ✅ |
| screen:rzeczy-potrzebne-na-termin | Group 14 (Frontend Needed Items) | ✅ |
| component:category-tree-picker | Group 10 (CategoryTreePicker) | ✅ |
| component:item-submit-actions | Group 11 (Add Item) | ✅ |

## Uncovered Items

All screens covered.
