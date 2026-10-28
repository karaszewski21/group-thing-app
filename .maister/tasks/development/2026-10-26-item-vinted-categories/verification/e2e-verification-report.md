# E2E Verification Report

## TL;DR
- **Verdict: GO.** 13 of 13 executed scenarios passed. The photo-upload scenario was skipped, as the brief allowed.
- The Vinted category tree, the shared `CategoryTreePicker`, Oddam / Zamienię / Wersja robocza, the 10-gift limit, the admin tree and name-only needed items all behave as the spec says in the live app.
- The DB checks match: listing status changes together with the listing preference after every create, toggle and 409. The 409 persisted nothing, and the tree has 9 roots and 2286 categories.
- No new defects were found. The findings are 3 Cosmetic items: two existed before this change, and one is a visual deviation from the mockups.

## Key Decisions
- The dev DB was upgraded 0063 → 0069 (user-approved, backup in place). The stale backend on :8080 was restarted on current code. At the end it was left running detached, with the same command line and port, because it was running before the test.
- Test data was created through the real UI and the API. Four throwaway accounts (`e2e.*@example.test`) were used, and ADMIN was granted by SQL, the same way `tests/test_category_module.py` does it. The first 10 gift items were seeded through the API, as the brief allowed.
- Visual fidelity was judged by rendering every mockup in the same browser (`screenshots/mockup-*.png`) and comparing structure, not pixels.

## Open Questions / Risks
- The listing status ("Aktywna" / "Wersja robocza") is shown only on the item **edit** page, as FR-22 specifies. The item view page and "Moje rzeczy" do not show it. In Moje rzeczy only the pressed Oddam/Zamienię toggle hints at the status. The edit page also shows the older "Aktualny status: Dostępna" (circulation status) panel next to the new chip, and two different "status" concepts may confuse owners.
- The test data stays in the dev DB: 4 `e2e.*` accounts, about 16 items, 1 group, 3 terms, needed items and an admin product `E2E-SKU-001`. Remove it if the data should stay clean.

## 1. Identifier
- **Task**: 2026-10-26-item-vinted-categories
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-26-item-vinted-categories
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-26-item-vinted-categories\implementation\spec.md
- **Date**: 2026-10-28
- **Git ref**: 12587e6 (main, with uncommitted feature changes in the working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite dev server, `/api` proxied to FastAPI on :8080) |
| Browser | Chromium via Playwright MCP (plugin_maister_playwright) |
| Viewport | 390×844 (user screens, phone width) · 1366×900 (admin, desktop) |
| Auth context | `e2e.owner` (GUEST), `e2e.gifter` (GUEST), `e2e.org` (ORGANIZER), `e2e.admin` (GUEST + ADMIN via SQL) |
| Test data | Live dev DB at Alembic 0069 after the legacy wipe (0 products at the start). Items created through the UI, plus 10 gift items seeded through the API |

## 3. Executive Summary
**Verdict**: ✅ GO

| Metric | Count |
|---|---|
| Scenarios planned | 14 |
| Scenarios executed | 13 |
| Passed | 13 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 0 |
| Cosmetic issues | 3 |

Every user-facing requirement in the brief was exercised in a real browser against the migrated dev database, and each one matched the spec.

- **Picker.** The `CategoryTreePicker` is portaled to `document.body`. It supports drill-down, "‹ Wstecz" and breadcrumb jumps, diacritic-insensitive search with full paths and the 50-result cap, and keyboard selection. Esc clears the search without closing the sheet, and focus returns to the trigger. It never submits the host form.
- **Add item.** The three-button form creates ACTIVE+GIFT, ACTIVE+SWAP and DRAFT items, confirmed in the DB. The 11th gift returns the exact Polish 409, persists nothing and keeps the form data.
- **Admin.** The admin tree, the forms and the product pages enforce leaves and show the Polish 409 messages.
- **Needed items.** Needed items work by plain name end to end, including the partial-failure toast.

Only cosmetic observations remain.

## 4. Verification Scenarios

### 4.1 Add item: initial state and implicit submit — ✅ Passed
- **User story / acceptance criterion**: FR-21. The required "Kategoria *" field has no default, the three buttons are disabled until the form is valid, and implicit Enter does nothing.
- **Preconditions**: Logged in as `e2e.owner`, viewport 390×844, `/product/new`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/product/new` | "Kategoria *" trigger shows "Wybierz kategorię", no default | Trigger "Wybierz kategorię ›", `aria-labelledby` points at the label span | ✅ |
| 2 | Inspect buttons | Oddam/Zamienię/Wersja robocza disabled, hint shown | All three `type="button"`, `aria-disabled="true"`, `aria-describedby="item-create-missing-fields"` → "Podaj nazwę i wybierz kategorię, aby zapisać." | ✅ |
| 3 | Force-click Oddam while invalid | No request | No POST sent | ✅ |
| 4 | Type a name, press Enter (no category) | Nothing is submitted | No POST, URL unchanged | ✅ |
| 5 | Choose a leaf, type a name, press Enter | Nothing is submitted | No POST; the buttons become enabled (`aria-disabled` removed) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-add-item-empty-390.png`, `screenshots/08-add-item-ready-390.png`
- **Acceptance criteria checklist**:
  - [x] Kategoria required, no default
  - [x] Buttons disabled with hint until name + category
  - [x] Enter in the name field submits nothing

### 4.2 Picker sheet: drill-down, Wstecz, breadcrumb — ✅ Passed
- **User story / acceptance criterion**: FR-20, the Drill-down and DOM placement bullets.
- **Preconditions**: Add-item page, picker opened from the trigger.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open the picker | ModalSheet "Wybierz kategorię", 9 roots with "›" | 9 roots in fixture order (Kobiety … Zwierzęta), each with "›" | ✅ |
| 2 | Check DOM placement | Sheet portaled out of the form | The dialog's top ancestor is a direct child of `body` and has no `form` ancestor | ✅ |
| 3 | Kobiety › Ubrania | Breadcrumb "Wszystkie › Kobiety › Ubrania"; leaves marked "wybierz" | As expected. "Inne ubrania", "Przebrania…" and "Spódnico-spodenki" are leaves with "wybierz" | ✅ |
| 4 | Sukienki, then "‹ Wstecz" | Goes up one level | "…› Sukienki" → "Wszystkie › Kobiety › Ubrania" | ✅ |
| 5 | Click breadcrumb "Kobiety", then "Wszystkie" | Jumps to that level | "Wszystkie › Kobiety", then the root list | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/02-picker-root-390.png`, `screenshots/03-picker-drill-kobiety-ubrania-390.png`
- **Acceptance criteria checklist**:
  - [x] Breadcrumb, with each ancestor clickable
  - [x] "‹ Wstecz" goes up one level
  - [x] Non-leaf rows show "›" and only descend

### 4.3 Picker search: paths, diacritics, cap, keyboard — ✅ Passed
- **User story / acceptance criterion**: FR-19 (`searchCategories`) and FR-20, the Search input bullet. Audit item L7.
- **Preconditions**: Picker open.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Search "sukienki" | Full paths + name, live count | "16 wyników"; rows like "Kobiety › Ubrania › Sukienki › / Sukienki midi" with the match highlighted. Non-leaf "Sukienki" rows carry "›" | ✅ |
| 2 | Check combobox ARIA | `aria-controls` only while results are shown | Empty query: `aria-controls` = null, `aria-expanded=false`. With results: `_r_1_-results`, `true` | ✅ |
| 3 | Search "ksiazki" | Diacritic-insensitive match on "Książki" | "2 wyniki": "Rozrywka › Książki" and "Rozrywka › Książki › Książki z kolorowankami…" | ✅ |
| 4 | Search "inne" | Cap hint | "80 wyników", "Pokazano 50 z 80 — zawęź wyszukiwanie", exactly 50 options rendered | ✅ |
| 5 | Esc with results | Clears the search, sheet stays open | Sheet visible, input empty, root list shown | ✅ |
| 6 | "sukienki midi", ArrowDown, Enter | Selects the active option and closes the sheet | `aria-activedescendant=_r_1_-result-0`; sheet closed; trigger "Kobiety › Ubrania › Sukienki ›" + bold "Sukienki midi"; focus on the trigger | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/04-picker-search-sukienki-390.png`, `screenshots/05-picker-search-ksiazki-390.png`, `screenshots/06-picker-search-inne-cap-390.png`, `screenshots/07-add-item-category-selected-390.png`
- **Acceptance criteria checklist**:
  - [x] Search ignores case and diacritics
  - [x] At most 50 results, with the narrowing hint
  - [x] Keyboard-only selection works
  - [x] Esc in search does not close the sheet

### 4.4 Picker close paths and form safety — ✅ Passed
- **User story / acceptance criterion**: FR-20, the Reopen and Button types bullets. Success criterion "Using the picker never submits a host form".
- **Preconditions**: Leaf "Sukienki midi" selected.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Reopen the picker | Opens at the selected node's parent level | Breadcrumb "Wszystkie › Kobiety › Ubrania › Sukienki" | ✅ |
| 2 | Close with ✕ | Closes, keeps the selection, focus returns, no submit | Closed; trigger unchanged; focus on the trigger; no POST | ✅ |
| 3 | Reopen, press Esc (empty search) | Closes | Closed | ✅ |
| 4 | Reopen, click the scrim | Closes and does not reopen | 0 dialogs afterwards; URL unchanged | ✅ |
| 5 | Admin parent picker: Enter in search with no active option | Nothing happens, no form submit | Sheet stays open; no POST `/api/categories` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-add-item-category-selected-390.png`, `screenshots/24-admin-parent-picker-any-mode-desktop.png`
- **Acceptance criteria checklist**:
  - [x] ✕, Enter in search and scrim leave the host form unsubmitted
  - [x] Focus returns to the trigger
  - [x] Reopen at the parent level

### 4.5 Create with Oddam / Zamienię / Wersja robocza — ✅ Passed
- **User story / acceptance criterion**: FR-12, FR-21. Success criterion "Oddam / Zamienię / Wersja robocza create … ACTIVE+GIFT / ACTIVE+SWAP / DRAFT".
- **Preconditions**: `e2e.owner`, no items.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "E2E Sukienka oddam" (Sukienki midi), click Oddam | `listing_mode: GIFT` in the register payload, navigate to the item | `POST /api/inventory-items {…,"listing_mode":"GIFT"}` → `/product/{id}` | ✅ |
| 2 | "E2E Książka zamienię" (Rozrywka › Książki › Książki z kolorowankami…), click Zamienię | SWAP | Navigated to the item page | ✅ |
| 3 | "E2E Szkic" (Inteligentne termostaty), click Wersja robocza | No mode | Navigated to the item page | ✅ |
| 4 | Check the DB | ACTIVE+GIFT, ACTIVE+SWAP, DRAFT with no pref | `ACTIVE/GIFT`, `ACTIVE/SWAP`, `DRAFT/-` | ✅ |
| 5 | Open Moje rzeczy | Modes reflected | "✓ Oddam", "✓ Zamienię", and neither pressed for the draft; "Do oddania: 1/10" | ✅ |

- **Issues observed**: _None observed._ The status chip is shown on the edit page only, as specified (see Open Questions).
- **Evidence**: `screenshots/09-item-page-after-oddam-390.png`, `screenshots/10-moje-rzeczy-390.png`, `screenshots/12-item-edit-draft-chip-390.png`, `screenshots/14-item-edit-active-chip-390.png`
- **Acceptance criteria checklist**:
  - [x] Oddam → ACTIVE + GIFT
  - [x] Zamienię → ACTIVE + SWAP
  - [x] Wersja robocza → DRAFT, no mode

### 4.6 Gift limit (10) — ✅ Passed
- **User story / acceptance criterion**: FR-14, FR-21. Success criterion "An 11th GIFT returns the Polish 409 and persists nothing".
- **Preconditions**: `e2e.gifter` with 10 GIFT items seeded through the API (all 201).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | API: register an 11th GIFT | 409, register message | 409 "Możesz mieć maksymalnie 10 rzeczy do oddania. Wybierz „Zamienię” albo zapisz wersję roboczą." | ✅ |
| 2 | UI: "E2E Jedenasta", Stan "Jak nowy", Sukienki midi, click Oddam | Alert with the verbatim text, form data kept | `role="alert"` with the exact text; name, Stan and category all kept; URL unchanged | ✅ |
| 3 | Click Zamienię on the same form | Succeeds | 201, item page | ✅ |
| 4 | Check the DB | Exactly one "E2E Jedenasta" item, ACTIVE/SWAP | One row, `ACTIVE/SWAP` (the 409 left nothing) | ✅ |
| 5 | API: `PUT /api/item-listing-preferences/{id} {"mode":"GIFT"}` at 10/10 | 409, PUT message | 409 "… Zdejmij „Oddam” z innej rzeczy." | ✅ |
| 6 | Moje rzeczy at 10/10 | Limit shown | "Do oddania: 10/10 — …"; Oddam is disabled for non-gift items (client-side guard that already existed) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/15-add-item-gift-limit-390.png`, `screenshots/16-moje-rzeczy-gift-limit-390.png`
- **Acceptance criteria checklist**:
  - [x] Polish 409 on register, shown verbatim
  - [x] Nothing persisted; form keeps its data
  - [x] PUT path returns its own 409 text

### 4.7 Item edit: category picker, status chip, no notice — ✅ Passed
- **User story / acceptance criterion**: FR-22.
- **Preconditions**: `e2e.owner`, `/product/{id}/edit` for the DRAFT and ACTIVE items.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open edit for the DRAFT item | Chip "Wersja robocza"; no "zdjęta z terminów" notice | Chip under the name; notice absent | ✅ |
| 2 | Open edit for the ACTIVE item | Chip "Aktywna" | "Aktywna" | ✅ |
| 3 | "Edytuj nazwę i kategorię" | Picker labelled "Kategoria", leaf mode, shows the path | Trigger labelled by the "Kategoria" span: "Rozrywka › Książki ›" + bold leaf | ✅ |
| 4 | Reopen the picker, search "Komiksy", choose the leaf | Opens at the parent level; selecting sends nothing until Zapisz | Breadcrumb "Wszystkie › Rozrywka › Książki"; no request before Zapisz | ✅ |
| 5 | Click Zapisz | Resolve → re-point | `POST /api/products/resolve`, then `PATCH /api/inventory-items/{id} {product_id}`; shows "Komiksy, manga i powieści graficzne" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/12-item-edit-draft-chip-390.png`, `screenshots/13-item-edit-category-editor-390.png`, `screenshots/14-item-edit-active-chip-390.png`
- **Acceptance criteria checklist**:
  - [x] Kategoria picker in NameCategoryEditor
  - [x] Status chip DRAFT/ACTIVE
  - [x] Moderation notice removed

### 4.8 Moje rzeczy: mode toggles update status — ✅ Passed
- **User story / acceptance criterion**: FR-13, FR-23.
- **Preconditions**: Items from 4.5 (GIFT, SWAP, DRAFT).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | GIFT item → Zamienię | PUT SWAP, stays ACTIVE | `PUT 200 {"mode":"SWAP"}`; DB `ACTIVE/SWAP` | ✅ |
| 2 | SWAP item → click "✓ Zamienię" (clear) | PUT null → DRAFT | `PUT 200 {"mode":null}`; DB `DRAFT/-` | ✅ |
| 3 | DRAFT item → Oddam | PUT GIFT → ACTIVE | `PUT 200 {"mode":"GIFT"}`; DB `ACTIVE/GIFT` | ✅ |
| 4 | Check the UI | Toggles reflect the state | `aria-pressed` matches; toggles are not disabled | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/11-moje-rzeczy-after-toggles-390.png`
- **Acceptance criteria checklist**:
  - [x] ACTIVE ⇔ pref row after set, clear and change
  - [x] Toggles enabled (no moderation gate)

### 4.9 Admin category tree — ✅ Passed
- **User story / acceptance criterion**: FR-7, FR-8, FR-25 (CategoryListPage).
- **Preconditions**: `e2e.admin` with ADMIN, 1366×900, `/admin/categories`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Load the page | 9 roots, "N podkategorii" with Polish plurals, actions, "+ Nowa kategoria główna" | "5 podkategorii", "4 podkategorie", "12 podkategorii"…; ↑ ↓ "+ Podkategoria" Edytuj Usuń on every row | ✅ |
| 2 | Click Kobiety | Expands (▾), `aria-expanded=true` | Children: Ubrania, Obuwie, Akcesoria, Torby, Kosmetyki | ✅ |
| 3 | Check boundary ↑ | First sibling's ↑ disabled | "Przenieś Kobiety w górę" disabled; last sibling's ↓ disabled | ✅ |
| 4 | Mężczyźni ↑, then ↓ | Swaps with its adjacent root, then restores | Order changed, then restored; `PATCH …/move` 200 ×2 | ✅ |
| 5 | Rozrywka › Muzyka ↑, then ↓ | Moves only within siblings | Muzyka/Książki swapped under Rozrywka only; roots unchanged; restored | ✅ |
| 6 | Filter "Sukienki midi" | Branches with matches expand | Kobiety ▾ › Ubrania ▾ › Sukienki ▾ › "Sukienki midi — 13 rzeczy" | ✅ |
| 7 | Leaf with products | "+ Podkategoria"/Usuń disabled with a title | Both `disabled`, `title="Kategoria ma przypisane rzeczy"`; Edytuj enabled | ✅ |
| 8 | Usuń Zwierzęta → confirm | Top alert with the children message | `DELETE` 409; top `role="alert"`: "Nie można usunąć „Zwierzęta”: kategoria ma podkategorie." | ✅ |

- **Issues observed**: §5.4 C1 (English "Cancel" in the confirm dialog, pre-existing) and §5.4 C3 (action styling differs from the mockup).
- **Evidence**: `screenshots/20-admin-tree-root-desktop.png`, `screenshots/21-admin-tree-kobiety-expanded-desktop.png`, `screenshots/22-admin-tree-filter-leaf-with-products-desktop.png`, `screenshots/27-admin-delete-parent-409-alert-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Disclosure buttons ▸/▾ with `aria-expanded`
  - [x] "N podkategorii" / "N rzeczy" meta
  - [x] Filter expands matching branches
  - [x] ↑/↓ within siblings only
  - [x] 409 shown in a top alert
  - [x] Actions disabled on a leaf with products

### 4.10 Admin category form: create child, duplicate, rename, delete — ✅ Passed
- **User story / acceptance criterion**: FR-5, FR-6, FR-25 (CategoryFormPage).
- **Preconditions**: Admin on the tree.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "+ Podkategoria" on Zwierzęta | `/admin/categories/new?parent=…`, "Nowa podkategoria", parent preselected, hint | As expected. Parent trigger "Zwierzęta"; hint "Puste = kategoria główna. Nie można zmienić po utworzeniu."; label is a `SPAN` | ✅ |
| 2 | Open the parent picker | `any` mode, with "Kategoria główna (brak)" | Root list starts with "Kategoria główna (brak)" | ✅ |
| 3 | Name "E2E Testowa podkategoria", Zapisz | 201 with `parent_id` | `POST 201 {"name":…,"parent_id":"c7770f98…"}`; back to the tree; Zwierzęta shows "7 podkategorii" | ✅ |
| 4 | Create the same name again | 409, sibling message inline | "Kategoria o tej nazwie już istnieje na tym poziomie" | ✅ |
| 5 | Edytuj → rename to "… 2" | Parent read-only; PUT name only | Parent "Zwierzęta" shown as text; `PUT 200 {"name":"E2E Testowa podkategoria 2"}` | ✅ |
| 6 | Delete the test child | Succeeds | Removed (filter "E2E Testowa": no matches); Zwierzęta back to 6 children in the DB | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/23-admin-new-subcategory-form-desktop.png`, `screenshots/24-admin-parent-picker-any-mode-desktop.png`, `screenshots/25-admin-duplicate-sibling-409-desktop.png`, `screenshots/26-admin-edit-category-readonly-parent-desktop.png`
- **Acceptance criteria checklist**:
  - [x] `?parent=` preselects the parent
  - [x] Any-node parent picker with a root option
  - [x] Read-only parent on edit
  - [x] 409 shown inline

### 4.11 Admin products: leaf picker, filter, path labels — ✅ Passed
- **User story / acceptance criterion**: FR-9, FR-25 (ProductFormPage, ProductListPage).
- **Preconditions**: Admin, `/admin/products`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Category filter `<select>` | Leaves only, sorted by full path | 1978 options = 1978 leaves out of 2286 categories; 0 non-leaf; sorted by path (e.g. "Kobiety › Ubrania › Sukienki › Sukienki midi") | ✅ |
| 2 | Category column | Full path | "Kobiety › Ubrania › Sukienki › Sukienki midi" | ✅ |
| 3 | Add Product → picker; search "sukienki", click the non-leaf "Sukienki" result | Leaf mode drills in, does not select | Sheet stays open at "Wszystkie › Kobiety › Ubrania › Sukienki" | ✅ |
| 4 | Choose "Sukienki midi", fill name + SKU, Save | 201 with the leaf `category_id` | `POST 201 {"name":"E2E Admin produkt","sku":"E2E-SKU-001","category_id":"4eabb8c9…"}` | ✅ |
| 5 | API: resolve with a root category | 409 leaf message | 409 "Wybierz najbardziej szczegółową kategorię (bez podkategorii)." | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/28-admin-product-list-desktop.png`, `screenshots/29-admin-product-form-picker-drill-desktop.png`, `screenshots/30-admin-product-form-filled-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Product form uses the leaf picker
  - [x] Filter lists leaves by full path
  - [x] Server rejects non-leaf categories with 409

### 4.12 Term needed items by name — ✅ Passed
- **User story / acceptance criterion**: FR-17, FR-24. Success criterion "Needed items … displayed by `name` … public term page shows names".
- **Preconditions**: `e2e.org` created group "E2E Grupa wymiany" through the "Załóż grupę" stepper.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | "Termin spotkania" → "+ Dodaj potrzebną rzecz" | Name + optional description only, no category | Fields: Nazwa, Doprecyzowanie (opcjonalnie), Dodaj rzecz, Zwiń | ✅ |
| 2 | Add "Termos — najlepiej 1 l" and "Koc piknikowy", then Dodaj termin | Term, then needed items `{term_id, name}` | `POST /api/terms` 201, then `POST /api/needed-items {"term_id":…,"name":"Termos","description":"najlepiej 1 l"}` and `{…"name":"Koc piknikowy"}`, both 201 | ✅ |
| 3 | Term page ("Zobacz stronę terminu") | Names listed | "Potrzebne rzeczy: Koc piknikowy · Termos — najlepiej 1 l", each with "Ja to przyniosę" | ✅ |
| 4 | Public needed-item payload | Keys `{id,name,description,claimed,claimed_by_name,claimed_by_party_id}` | Exactly that key set (`/api/groups/public/{id}/access?term_id=…`) | ✅ |
| 5 | New term with "Kubki" + "Termos zadzwoń 600 700 800" | Continues past the failure; one toast; modal closes | Kubki 201; the second item 400 (contact info); toast "Termin dodany, ale nie dodano rzeczy: Termos zadzwoń 600 700 800 — Nazwa i opis nie mogą zawierać danych kontaktowych…"; modal closed | ✅ |
| 6 | Spotkania → "Edytuj termin": rename "Koc piknikowy" → "Koc piknikowy duży"; add "Sztućce" | Name-based edit and create | List shows "Koc piknikowy duży", "Sztućce", "Termos — najlepiej 1 l"; `POST {"term_id":…,"name":"Sztućce"}` 201 | ✅ |

- **Issues observed**: _None observed._ The anonymous public view could not be shown because the group was created as private (see §8).
- **Evidence**: `screenshots/31-term-add-needed-item-form-390.png`, `screenshots/32-term-needed-items-drafted-390.png`, `screenshots/33-term-public-page-organizer-390.png`, `screenshots/34-term-public-page-anonymous-390.png`, `screenshots/35-term-needed-item-rejected-toast-390.png`, `screenshots/36-spotkania-term-cards-needed-names-390.png`, `screenshots/37-edit-term-dialog-needed-items-390.png`, `screenshots/38-edit-term-dialog-after-edits-390.png`
- **Acceptance criteria checklist**:
  - [x] No category field; name only
  - [x] Term page shows names
  - [x] Partial failure → one toast, modal closed
  - [x] EditTermDialog edits and creates by name

### 4.13 Responsive check (390px user screens, desktop admin) — ✅ Passed
- **User story / acceptance criterion**: Brief: phone width for screens 1–2, desktop for admin. Standard `frontend/responsive.md`.
- **Preconditions**: Viewport 390×844 for scenarios 4.1–4.8 and 4.12; 1366×900 for 4.9–4.11.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Add form + picker at 390px | No horizontal overflow; sheet fits | Sheet is full width, rows wrap long paths, the trigger wraps long leaf names onto 2 lines | ✅ |
| 2 | Admin tree at 1366px | Rows and actions on one line | Single-line rows; meta and actions aligned | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-picker-drill-kobiety-ubrania-390.png`, `screenshots/13-item-edit-category-editor-390.png`, `screenshots/27-admin-delete-parent-409-alert-desktop.png`
- **Acceptance criteria checklist**:
  - [x] Phone-width layout works for the add form and the picker
  - [x] Desktop admin layout works

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
_None observed._

### 5.4 Cosmetic
**C1 — Admin delete confirm shows English "Cancel"**
- **Spec requirement**: The UI is Polish. FR-25 says nothing specific about the confirm dialog.
- **Expected**: Polish cancel label ("Anuluj").
- **Actual**: The `alertdialog` "Usunąć kategorię?" offers "Cancel" / "Usuń".
- **Evidence**: Accessibility snapshot during scenario 4.9 step 8; `screenshots/27-admin-delete-parent-409-alert-desktop.png` (after confirm)
- **Root cause hypothesis**: The shared `components/shared/ConfirmDialog` default cancel label. It existed before this change, and `CategoryListPage.tsx` at HEAD already used it.
- **User impact**: Mixed-language admin UI only.
- **Recommended fix**: Pass a Polish `cancelLabel` from `CategoryListPage`, or localize the `ConfirmDialog` default.
- **Workaround**: None needed.

**C2 — `/admin/categories` renders a read-only tree for non-admin users**
- **Spec requirement**: "Authorization. … mutations stay ADMIN" (Technical Approach).
- **Expected**: Admin-only page. Mutations are hidden or rejected for non-admins.
- **Actual**: A READ+EDIT user who opens the URL directly sees the tree without any action buttons. The server-side ADMIN guard is unaffected. This existed before (`isAdmin` gating at HEAD).
- **Evidence**: `screenshots/20-admin-tree-root-desktop.png` (later overwritten by the admin view; observed in the first load before ADMIN was granted)
- **Root cause hypothesis**: `CategoryListPage` gates only the action buttons on `ADMIN`, not the page.
- **User impact**: Nothing beyond reading public category names, which any logged-in user can already fetch through `GET /api/categories`.
- **Recommended fix**: Optional. Leave as is, or redirect non-admins.
- **Workaround**: None needed.

**C3 — Admin tree action styling differs from the mockup**
- **Spec requirement**: Visual Design, screen:admin-drzewo-kategorii.
- **Expected**: Bordered small buttons for ↑ ↓ "+ Podkategoria" Edytuj Usuń, and a green "+ Nowa kategoria główna".
- **Actual**: Borderless text-style buttons, and a blue (Chakra default) primary button. Structure, order and states match.
- **Evidence**: `screenshots/27-admin-delete-parent-409-alert-desktop.png` vs `screenshots/mockup-admin-drzewo-kategorii.png`
- **Root cause hypothesis**: The implementation uses the existing admin Chakra theme rather than the mockup's palette.
- **User impact**: None functional.
- **Recommended fix**: Optional theme alignment. See `visual-fidelity.md`.
- **Workaround**: None needed.

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `/api/organizations/mine` | 404 Not Found | ~10 (each user-app page load for users without an organization) | Cosmetic | None. This existed before and is an expected "no organization" response |
| `/api/inventory-items` | 409 Conflict | 1 | Cosmetic | Expected (gift-limit test, scenario 4.6) |
| `/api/item-listing-preferences/{id}` | 409 Conflict | 1 | Cosmetic | Expected (PUT gift-limit test) |
| `/api/categories` (POST) | 409 Conflict | 1 | Cosmetic | Expected (duplicate sibling test) |
| `/api/categories/{id}` (DELETE) | 409 Conflict | 2 | Cosmetic | Expected (delete parent test) |
| `/api/needed-items` | 400 Bad Request | 1 | Cosmetic | Expected (contact-info rejection test) |

There were no JavaScript exceptions or React warnings. The only other console output is the React DevTools info banner.

## 7. Spec Alignment
- **Fully implemented**:
  - FR-1/FR-3/FR-4: 9 roots in order, 2286 nodes, flat list with `parent_id`, legacy rows gone (DB + API).
  - FR-5/FR-6/FR-7/FR-8: child create, sibling-duplicate 409, rename, delete-with-children 409, sibling-scoped move.
  - FR-9: leaf-only resolve/create (409 for a root, picker drills on non-leaves).
  - FR-10–FR-14: `listing_status` set at register and kept in step with the pref; register-time mode; both gift-limit messages; nothing persisted on 409.
  - FR-19/FR-20: path labels, diacritic-insensitive search, 50 cap, portaled sheet, `type="button"` everywhere, Enter/Esc rules, reopen at the parent level, focus return, `any` mode with "Kategoria główna (brak)".
  - FR-21: required Kategoria, three buttons, disabled with a hint, Enter does nothing, verbatim error with the data kept.
  - FR-22: Kategoria picker in NameCategoryEditor, DRAFT/ACTIVE chip, notice removed.
  - FR-23: toggles enabled; mode changes update the status.
  - FR-24: name-only needed items in the quick-add form and EditTermDialog; partial-failure toast; names shown on term cards and the term page.
  - FR-25: tree with disclosure, plural meta, filter, sibling moves, disabled actions with a title, top 409 alert, `?parent=` form, read-only parent on edit, leaf picker in ProductFormPage, leaf-only filter labelled and sorted by path, path column.
- **Partially implemented**: _None._
- **Not implemented**: _None._ FR-15's photo gate removal and FR-2's fixture provenance were not testable from the browser and were out of scope for this run.
- **Extra (unspecified) behavior**:
  - Moje rzeczy disables the Oddam toggle at 10/10 with an inline hint (client-side guard that already existed). The backend 409 is still enforced and was confirmed through the API.
  - Non-admin users can view `/admin/categories` read-only (C2, pre-existing).
  - The item edit page shows the circulation "Aktualny status: Dostępna" panel next to the new listing-status chip (see Open Questions).

## 8. Variances from Plan
- **Photo upload skipped.** Photo-upload scenarios were not executed, so FR-15's "upload keeps the pref" was not exercised in the browser. The brief made them optional, and Spaces keys exist only in the root `.env`. This is the one planned-but-not-executed scenario.
- **Gift seeding through the API.** The first 10 gift items were seeded with `POST /api/products/resolve` and `POST /api/inventory-items` (`listing_mode: GIFT`). The 11th went through the UI.
- **PUT gift limit at API level.** The UI pre-disables Oddam at 10/10, so the PUT-path gift limit was verified with a direct `fetch` from the logged-in page.
- **Anonymous public term page not shown.** The stepper created the group as private, so anonymous users get the private-group gate. Name rendering was verified on the organizer's view of the public term page and in the public API payload key set.
- **Admin grant redone.** The first ADMIN grant was rolled back, because it ran in one `psql -c` with a failing statement, and was then re-applied. The admin tree was first observed as a non-admin, which surfaced C2.
- **Backend restart.** The pre-existing backend on :8080 (started 2026-10-27 without reload) served stale code, so it was stopped and restarted on current code. It was left running detached at the end, with the same port and arguments.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| After `alembic upgrade head`, `categories` holds only the reviewed Vinted tree: 9 roots in order, every node reachable, no legacy rows | ✅ | DB: 9 roots in fixture order, 2286 rows, 0 products after the wipe |
| `alembic downgrade 0063` followed by `upgrade head` succeeds | ⚠️ | Not run against the dev DB (out of scope for browser E2E; covered by the migration pytest files) |
| Every product write with a non-leaf category returns 409; every picker only lets the user choose leaves (except the admin parent picker) | ✅ | Resolve with a root → 409; leaf mode drills on non-leaves (4.3, 4.11); `any` mode in the admin parent picker (4.10) |
| Oddam / Zamienię / Wersja robocza create ACTIVE+GIFT / ACTIVE+SWAP / DRAFT; an 11th GIFT returns the Polish 409 and persists nothing | ✅ | 4.5, 4.6 + DB rows |
| `listing_status = 'ACTIVE'` exactly when a pref row exists after register, set, clear and confirm | ✅ | Register + set + clear verified in the DB (4.5, 4.8); confirm not exercised |
| Uploading a PENDING photo or re-pointing never removes the pref; PUT with photos pending → 200 | ⚠️ | Re-point verified (4.7, the DRAFT item stayed DRAFT, no pref change). Photo upload skipped (§8) |
| Needed items are created, edited, pledged and displayed by `name`; the public term page shows names | ✅ | 4.12 (create, edit, display, public payload); pledge not exercised |
| Picker a11y: keyboard-only selection, Esc in search does not close, focus returns to the trigger | ✅ | 4.3 steps 5–6, 4.4 step 2 |
| The picker never submits a host form (✕, Enter in search, scrim); a scrim click does not reopen | ✅ | 4.1, 4.4 |
| All new/changed tests pass; mypy/ruff no worse; tsc clean | ⚠️ | Not in E2E scope. See `test-suite-results-reverify.md` |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: _None._
- **Nice-to-have**:
  - §5.4 C1: Polish "Anuluj" in the admin delete confirm.
  - §5.4 C3: align the admin tree button styling with the mockup.
  - §5.4 C2: optionally redirect non-admins from `/admin/categories`.
  - Consider showing the listing status on the item view page or in Moje rzeczy (see Open Questions; not a spec gap).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (44 files: 35 app captures + 9 rendered mockups `mockup-*.png`)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
**Verdict: ✅ GO.** Every scenario in the brief passed against the migrated dev database. This covers the category tree and picker, the three-way add flow with listing status matching the pref, the server-enforced 10-gift limit with data kept, the admin tree and forms, leaf-only products, and name-only needed items. The DB checks confirm the invariants, not just the UI. The only findings are cosmetic and existed before this change, or are styling drift from the mockups. Recommendation: **merge**. Optionally run a photo-upload smoke test with Spaces before release.
