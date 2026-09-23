# Design Context Index

Source: product-design task `.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/` (`brief.md` = `outputs/product-brief.md`).

## Screens

| ID | Source mockup | Description |
|---|---|---|
| `screen:group-visualization-circle` | `mockups/wizualizacja-grupy-kolo-mandala.html` | `/krag/:groupId` w trybie CIRCLE — istniejący layout koła/mandali (bez zmian pozycjonowania), z dodanym przełącznikiem trybu, ikonami udostępnia/przynosi na avatarach, i rozbudowaną kartą rodziny z sekcją "do wymiany w grupie" (lista ofert + przycisk Biorę). |
| `screen:group-visualization-pitch` | `mockups/wizualizacja-grupy-boisko.html` | `/krag/:groupId` w trybie PITCH — nowy layout "boisko": rodziny rozłożone w rzędach (generalized row distribution), organizator jako "trenerka" nad boiskiem, ten sam przełącznik/ikony/karta co circle. |
| `screen:group-visualization-table` | `mockups/wizualizacja-grupy-stol.html` | `/krag/:groupId` w trybie TABLE — nowy layout "stół": rodziny rozłożone po obwodzie elipsy, statyczne "chipy" przedmiotów na środku stołu (dekoracja), ten sam przełącznik/ikony/karta co circle. |

## Components (cross-screen, shared across all 3 screens above)

| ID | Description |
|---|---|
| `component:layout-switcher` | Segmented control "Koło / Boisko / Stół", widoczny tylko dla organizatora (`isOrganizerViewer`), zapisuje `Group.layout_mode` przez `PATCH /groups/{id}`. Nowy element. |
| `component:group-visualization` | `<GroupVisualization>` — komponent-kontener dysponujący trzema wewnętrznymi renderami (`CircleLayout`/`PitchLayout`/`TableLayout`), przyjmuje `families`, `layoutMode`, `activeFamilyId`, `onSelectFamily`. Ekstrakcja z `KragGrupyPage.tsx`. Nowy plik. |
| `component:avatar` | Wspólny `<Avatar>` (inicjały + deterministyczny kolor + opcjonalne ikony udostępnia/przynosi), konsoliduje 2-3 istniejące duplikaty. Nowy komponent w `components/shared/`. |
| `component:family-card-exchange-section` | Rozbudowa istniejącej `.kg-card` o sekcję "DO WYMIANY W GRUPIE" — lista wszystkich aktywnych ofert rodziny, każda z przyciskiem **Biorę** (bez "Napisz"), leniwie ładowana po kliknięciu avatara. Nie renderuje się, gdy lista pusta lub to własna rodzina. |
| `component:exchange-legend` | Legenda ikon "udostępnia rzecz" / "przynosi na zajęcia" pod wizualizacją, identyczna we wszystkich 3 trybach. |

## Notatka dla Fazy 5/7/8

Pełna specyfikacja implementacyjna (modele danych, endpointy, algorytmy pozycjonowania, edge case'y) już istnieje w `analysis/feature-spec.md` tego katalogu product-design (skopiuj/reużyj jako wejście do `specification-creator`, nie odtwarzaj od zera) — patrz też `analysis/design-decisions.md` i `analysis/alternatives.md` dla uzasadnień wybranych podejść.
