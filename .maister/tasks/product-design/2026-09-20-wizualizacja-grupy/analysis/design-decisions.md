# Design Decisions: Wizualizacja grupy zajęciowej

Pełne alternatywy i uzasadnienia: `analysis/alternatives.md`. Poniżej: wybrane podejście per obszar.

## Obszar 1: Architektura agregacji danych

**Wybrano: Alternatywa 1B/1C — agregacja po stronie backendu.**

- Nowy endpoint zbiorczy: zwraca dla wszystkich rodzin w grupie flagi `sharesItem`/`bringsItem` w jednym zapytaniu (używany na każdym załadowaniu ekranu, dla każdego avatara).
- Nowy endpoint per-rodzina: zwraca pełną listę aktywnych ofert wymiany danej rodziny, wywoływany leniwie (lazy) dopiero po kliknięciu jej avatara.
- Oba endpointy współdzielą jeden helper w warstwie `application`/`service`, żeby reguła "co się liczy jako aktywna oferta" istniała w jednym miejscu.
- Wymaga: nowej trasy w `app/groups/router/`, nowego wpisu w `AUTHORIZATION_MATRIX` (wzorem wierszy 55-58), sprawdzenia członkostwa w service.py (blankietowy wiersz READ nie wystarcza).

**Uwaga (świadomie odłożona z Fazy 2)**: dokładny zakres czasowy flag (bieżący termin vs. ogólny stan) — backend implementuje domyślnie zgodnie z dzisiejszą logiką widoczności `ItemListingPreference` per-Term; można to później skorygować bez zmiany architektury (logika żyje w jednym miejscu po stronie backendu).

## Obszar 2: Struktura komponentów

**Wybrano: Alternatywa 2C — pełna ekstrakcja.**

- `src/frontend/src/utils/layoutPositions.ts` — czyste, testowalne funkcje `getCirclePosition(i,n)`, `getPitchPosition(i,n)`, `getTablePosition(i,n)`.
- `src/frontend/src/components/shared/Avatar.tsx` — wspólny komponent avatara z inicjałami (konsoliduje 2-3 istniejące duplikaty).
- `src/frontend/src/pages/krag/GroupVisualization.tsx` (lub `components/krag/`) — komponent przyjmujący `families`, `layoutMode`, `activeFamilyId`, `onSelectFamily`, renderujący wybrany tryb (Circle/Pitch/Table) wewnętrznie.
- `KragGrupyPage.tsx` chudnie: pobiera dane, trzyma stan `layoutMode`/`activeFamilyId`, renderuje `<GroupVisualization>` + istniejące sekcje (kto co przynosi, wymiana) + rozbudowaną kartę rodziny.
- Poza zakresem: pełny rewrite CSS-in-JS na Tailwind istniejącego trybu koła; nowe elementy (ikony, przełącznik trybu, rozbudowana karta) stylowane Tailwindem.

## Obszar 3: UX zmiany trybu layoutu

**Wybrano: Alternatywa 3A (z zastrzeżeniem 3C).**

- Kontrolka (segmented control/przełącznik) "Koło / Boisko / Stół" widoczna tylko dla organizatora (`isOrganizerViewer`), umieszczona bezpośrednio nad/przy `GroupVisualization` na ekranie `/krag/:groupId`.
- Zmiana natychmiast widoczna (optymistyczny update lub refetch po `PATCH`).
- Backend: nowe pole `Group.layout_mode` (string-backed enum: `CIRCLE`/`PITCH`/`TABLE`, domyślnie `CIRCLE`), zapisywane przez istniejący `PATCH /groups/{id}` — pole ogólne, niezależne od tego, który ekran je edytuje (możliwość dodania osobnego ekranu ustawień w przyszłości bez zmian backendu).

## Obszar 4: Algorytm rozkładu (pitch/table)

**Wybrano: Alternatywa 4C — uogólniona geometria + stabilne tasowanie.**

- `getPitchPosition(i, n)`: N rodzin rozłożone w rzędach (liczba rzędów = `Math.ceil(N / rowSize)`), równomiernie w pionie i poziomie w obrębie grafiki boiska — bez przypisania do realnych pozycji piłkarskich.
- `getTablePosition(i, n)`: N rodzin rozłożonych po obwodzie elipsy (parametryzacja `x = cx + a*cos(θ)`, `y = cy + b*sin(θ)`), analogicznie do dzisiejszego kręgu.
- **Tasowanie**: kolejność przypisania rodzina→slot jest deterministycznie wylosowana (np. seed = `groupId`, ewentualnie `+ familyId`) i **stabilna** między wizytami — ta sama rodzina zawsze ląduje na tym samym miejscu, dopóki skład grupy się nie zmieni. Nie tasujemy ponownie przy każdym wejściu na ekran.
- Test jednostkowy: brak nakładania się pozycji dla N w rozsądnym zakresie (np. 1-30).
