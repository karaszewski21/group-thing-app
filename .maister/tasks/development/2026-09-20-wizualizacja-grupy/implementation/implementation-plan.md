# Implementation Plan: Wizualizacja grupy — 3 tryby layoutu, ikony wymiany, rozbudowana karta rodziny

## Overview
Total Steps: 46
Task Groups: 8
Expected Tests: 30-52

## Implementation Steps

### Task Group 1: Backend — model, migracja, schematy
**Dependencies:** None
**Files to Modify:**
- `src/backend/app/groups/models.py`
- `src/backend/alembic/versions/0035_group_layout_mode.py`
- `src/backend/app/groups/schemas.py`
- `src/backend/tests/groups/test_models_group_layout_mode.py` (or equivalent existing test module for models/schemas per project convention)

- [x] 1.0 Complete model/migration/schema layer
  - [x] 1.1 Napisać 2-4 testy: `GroupLayoutMode` ma dokładnie wartości `CIRCLE`/`PITCH`/`TABLE` jako string-backed enum; `Group.layout_mode` domyślnie `CIRCLE` po utworzeniu wiersza bez podania wartości; `UpdateGroupRequest` akceptuje `layout_mode=None` (pole opcjonalne, `name` nadal wymagane); `GroupResponse` serializuje `layout_mode`.
  - [x] 1.2 Dodać `GroupLayoutMode(enum.StrEnum)` w `app/groups/models.py`, wzorem `GroupRoleType`/`PledgeStatus` (patrz istniejący `_enum_column` w linii 26).
  - [x] 1.3 Dodać kolumnę `Group.layout_mode` przez `_enum_column(GroupLayoutMode, N)`, `nullable=False`, `server_default="CIRCLE"`.
  - [x] 1.4 Utworzyć `alembic/versions/0035_group_layout_mode.py` kopiując strukturę nagłówka/`upgrade`/`downgrade` z `0034_reservation_term_id.py`; `down_revision = "0034"`; jeden krok `add_column` z `server_default`, `downgrade` usuwa kolumnę.
  - [x] 1.5 Rozszerzyć `app/groups/schemas.py`: `GroupResponse.layout_mode: GroupLayoutMode`; `UpdateGroupRequest.layout_mode: GroupLayoutMode | None = None`; dodać nowe DTO `FamilyExchangeSummary`, `GroupExchangeSummaryResponse`, `FamilyExchangeOffer`, `FamilyExchangeDetailResponse` (kształt pól `FamilyExchangeOffer` 1:1 z `BrowseTermItemListingResponse`: `product_name`, `condition`, `offered_types`/`mode`, wszystkie ID jako `int`).
  - [x] 1.6 Uruchomić tylko nowe 2-4 testy z 1.1 i upewnić się, że przechodzą (uwzględnić uruchomienie migracji na testowej bazie, jeśli test tego wymaga).

**Acceptance Criteria:**
- 2-4 testy z kroku 1.1 przechodzą
- `Group.layout_mode` istnieje w schemacie DB z defaultem `CIRCLE`, migracja odwracalna
- `GroupResponse`/`UpdateGroupRequest` mają nowe pole `layout_mode`; nowe DTO istnieją i mają poprawny kształt typów (`int`, nie `str`)

---

### Task Group 2: Backend — agregacja exchange_summary + re-eksport przez service.py
**Dependencies:** Group 1
**Files to Modify:**
- `src/backend/app/groups/application/exchange_summary.py` (nowy plik)
- `src/backend/app/groups/service.py`
- `src/backend/tests/groups/test_exchange_summary.py` (nowy plik testowy, integracyjny z TestContainers)

- [x] 2.0 Complete exchange aggregation layer
  - [x] 2.1 Napisać 6-8 testów integracyjnych (TestContainers + PostgreSQL, per `standards/testing/backend-testing.md`): rodzina z aktywnym `Pledge` (status != WITHDRAWN) na bieżący termin → `brings_item=true`; rodzina z aktywną `ItemListingPreference` (eligibility ∩ dostępność) → `shares_item=true`; rodzina bez żadnego → oba `false`; oferta w statusie FULFILLED/CANCELLED nie liczy się jako aktywna; wołający spoza grupy → `AccessDeniedException`/403; rodzina bez opiekunów GUARDIAN → `false`/`false` bez wyjątku.
  - [x] 2.2 Zaimplementować `get_group_exchange_summary(db, group_id, viewer_party_id)`: ustalić bieżący termin algorytmem `useKragGrupy.ts` (najnowszy/najpóźniejszy `Term`, sortowanie `occurs_on DESC`, `terms[0]`) — **NIE** algorytmem `public_view.py` (`min(upcoming, key=occurs_on)`); zgrupować `Membership`→`GroupRole`→opiekuna→`FamilyMembership`→`Family` do mapy `family_id`→lista `party_id`; jedno batchowane zapytanie `IN (...)` po wszystkich `party_id` grupy dla `Pledge` i osobne dla `ItemListingPreference`, filtrowanie per rodzina w pamięci (bez N+1); reużyć `_list_eligible_lister_party_ids`, `_is_item_available` z `term_item_listings.py` i wzorzec `_needed_item_view(claimed=...)` z `terms.py`; membership/leadership check wewnątrz funkcji (`AccessDeniedException` gdy wołający nie jest członkiem/liderem).
  - [x] 2.3 Zaimplementować `get_family_exchange_offers(db, group_id, family_id, viewer_party_id)`: weryfikacja że `family_id` ma aktywny `Membership` w `group_id` (404 jeśli nie); zwrócenie wszystkich aktywnych `ItemListingPreference` opiekunów rodziny zmapowanych na `FamilyExchangeOffer`.
  - [x] 2.4 Zaimportować i re-eksportować `get_group_exchange_summary`/`get_family_exchange_offers` przez `app/groups/service.py` (dopisać do importu i `__all__`, wzorem pozostałych 44 istniejących funkcji) — wymagane przez konwencję projektu (router woła wyłącznie `service.xxx()`).
  - [x] 2.5 Uruchomić tylko nowe 6-8 testów z 2.1.

**Acceptance Criteria:**
- 6-8 testów z kroku 2.1 przechodzą
- Agregacja używa jednego batchowanego zapytania `IN (...)` per typ encji (Pledge, ItemListingPreference), bez N+1
- Funkcje dostępne przez `service.get_group_exchange_summary`/`service.get_family_exchange_offers`, nie bezpośrednio z `application`
- Termin wybierany algorytmem `useKragGrupy.ts` (najnowszy), nie `public_view.py`

---

### Task Group 3: Backend — endpointy router + rozszerzenie PATCH
**Dependencies:** Group 2
**Files to Modify:**
- `src/backend/app/groups/router/circles.py`
- `src/backend/app/groups/application/circles.py`
- `src/backend/tests/groups/test_circles_router.py` (lub istniejący plik testów routera `circles`)

- [x] 3.0 Complete router/endpoint layer
  - [x] 3.1 Napisać 5-7 testów: `GET /groups/{id}/exchange-summary` zwraca 200 z poprawnym kształtem dla członka grupy; 403 dla użytkownika spoza grupy; `GET /groups/{id}/families/{family_id}/exchange-offers` zwraca 200 z listą ofert dla wszystkich opiekunów; 404 dla rodziny spoza grupy; `PATCH /groups/{id}` z `layout_mode` — organizator 200, nie-organizator 403, `name` nadal wymagane.
  - [x] 3.2 Rozszerzyć `application/circles.py::update_group` o opcjonalny parametr `layout_mode`, ustawiany na `Group` tylko gdy `is not None`, zachowując dzisiejszy ownership-check organizatora bez zmian.
  - [x] 3.3 Dodać dwa nowe GET handlery w `router/circles.py` (`/groups/{group_id}/exchange-summary`, `/groups/{group_id}/families/{family_id}/exchange-offers`), zachowując udokumentowaną w pliku wymaganą kolejność route'ów; handlery wołają wyłącznie `service.get_group_exchange_summary`/`service.get_family_exchange_offers`.
  - [x] 3.4 Zweryfikować, że blankietowy wiersz 26 `AUTHORIZATION_MATRIX` (`GET ^/api/groups(/.*)?$` → READ) pokrywa oba nowe GET endpointy — **bez dodawania nowych wierszy** do `app/core/authorization_matrix.py`.
  - [x] 3.5 Uruchomić tylko nowe 5-7 testów z 3.1.

**Acceptance Criteria:**
- 5-7 testów z kroku 3.1 przechodzą
- Zero nowych wierszy w `AUTHORIZATION_MATRIX`
- `PATCH /api/groups/{id}` przyjmuje opcjonalne `layout_mode`, 403 dla nie-organizatora, `name` nadal wymagane

---

### Task Group 4: Frontend — ekstrakcja layoutPositions.ts
**Dependencies:** None (niezależna od backendu, ale logicznie poprzedza Group 6)
**Files to Modify:**
- `src/frontend/src/utils/layoutPositions.ts` (nowy plik)
- `src/frontend/src/test/layoutPositions.test.ts` (nowy plik)
- `src/frontend/src/pages/krag/KragGrupyPage.tsx` (usunięcie `pos()` linia 585-590 i duplikowanej inline trygonometrii SVG-line-mapper linia 868-884, zastąpienie wywołaniami `getCirclePosition`)

- [x] 4.0 Complete positioning utility extraction
  - [x] 4.1 Napisać 5-8 testów: `getCirclePosition` zwraca identyczne wartości jak dzisiejsza `pos()` dla znanych (index, total); brak nakładających się pozycji dla `getCirclePosition`/`getPitchPosition`/`getTablePosition` dla N=1, N=5, N=30; `getStableSlotOrder` jest deterministyczne (ta sama para groupId+familyIds → zawsze ten sam porządek) i różne dla różnych `groupId`.
  - [x] 4.2 Wyekstrahować `getCirclePosition(index, total)` jako jedyne źródło prawdy dla kąta/promienia koła — 1:1 port matematyki z dzisiejszego `pos()` i duplikowanej inline formuły SVG-line-mapper; oba miejsca w `KragGrupyPage.tsx` mają wołać tę samą funkcję po refaktorze.
  - [x] 4.3 Zaimplementować nową geometrię `getPitchPosition(index, total)` (rozkład w rzędach) i `getTablePosition(index, total)` (rozkład po obwodzie elipsy) — czyste funkcje bez zależności od Reacta.
  - [x] 4.4 Zaimplementować `getStableSlotOrder(groupId, familyIds)` — deterministyczne tasowanie rodzina→slot (seed = `groupId`), stosowane wyłącznie dla PITCH/TABLE (CIRCLE zachowuje naturalny porządek `families`) oraz `distributeEvenly`/`locateInRows` jako pomocnicze funkcje dla PITCH.
  - [x] 4.5 Zaktualizować `KragGrupyPage.tsx`, by `pos()` i inline SVG-line-mapper wołały `getCirclePosition` zamiast duplikowanej matematyki (usunięcie duplikacji, bez zmiany zachowania trybu CIRCLE).
  - [x] 4.6 Uruchomić tylko nowe 5-8 testów z 4.1.

**Acceptance Criteria:**
- 5-8 testów z kroku 4.1 przechodzą
- `getCirclePosition`/`getPitchPosition`/`getTablePosition` nie generują nakładających się pozycji dla N w zakresie 1-30
- `getStableSlotOrder` deterministyczne dla tej samej pary wejść
- Tryb CIRCLE w `KragGrupyPage.tsx` renderuje się identycznie jak przed refaktorem (brak regresji pozycji)

---

### Task Group 5: Frontend — Avatar.tsx (konsolidacja)
**Dependencies:** None
**Files to Modify:**
- `src/frontend/src/components/shared/Avatar.tsx` (nowy plik)
- `src/frontend/src/components/shared/Icons.tsx` (dodanie ikon udostępnia/przynosi)
- `src/frontend/src/test/Avatar.test.tsx` (nowy plik)
- `src/frontend/src/pages/krag/KragGrupyPage.tsx` (zastąpienie 2-3 duplikatów logiki inicjałów/koloru wywołaniem `<Avatar>`)

- [x] 5.0 Complete Avatar component
  - [x] 5.1 Napisać 4-6 testów: poprawne inicjały z imienia/nazwiska rodziny; deterministyczny kolor dla tego samego wejścia (`hashString`+`PALETTE`); ikona "udostępnia" renderuje się warunkowo tylko gdy `showsSharesIcon=true`; ikona "przynosi" renderuje się warunkowo tylko gdy `showsBringsIcon=true`; obie ikony jednocześnie widoczne gdy oba propsy `true`.
  - [x] 5.2 Utworzyć `components/shared/Avatar.tsx` konsolidujący istniejącą logikę inicjałów/koloru (`PALETTE`, `hashString`) rozrzuconą dziś po `KragGrupyPage.tsx`; propsy `showsSharesIcon`/`showsBringsIcon` opcjonalne.
  - [x] 5.3 Dodać nowe ikony udostępnia (zielony znacznik)/przynosi (turkusowy znacznik) w `components/shared/Icons.tsx`; użyć istniejącej klasy CSS `.kg-mark` (`position:absolute;right:-5px;bottom:-5px`) jako haka pozycjonującego zamiast nowej klasy.
  - [x] 5.4 Zastąpić w `KragGrupyPage.tsx` istniejące inline duplikaty renderowania avatara wywołaniami `<Avatar>` (bez zmiany trybu CIRCLE — wizualnie identyczne). [2 z 3 duplikatów skonwertowane na JSX; trzeci (needed-item row) reużywa te same funkcje przez import, bez zmiany kształtu VM, bo dotyka pliku testowego spoza zakresu tej grupy — patrz work-log.]
  - [x] 5.5 Uruchomić tylko nowe 4-6 testów z 5.1.

**Acceptance Criteria:**
- 4-6 testów z kroku 5.1 przechodzą
- `<Avatar>` ma jasny, konfigurowalny interfejs (props), pojedynczą odpowiedzialność (`standards/frontend/components.md`)
- Ikony renderują się warunkowo zgodnie z propsami, oba znaczniki mogą być widoczne jednocześnie

---

### Task Group 6: Frontend — GroupVisualization.tsx (CircleLayout/PitchLayout/TableLayout)
**Dependencies:** Group 4, Group 5
**Files to Modify:**
- `src/frontend/src/pages/krag/GroupVisualization.tsx` (nowy plik)
- `src/frontend/src/test/GroupVisualization.test.tsx` (nowy plik)

- [x] 6.0 Complete GroupVisualization container
  - [x] 6.1 Napisać 6-8 testów: poprawna liczba renderowanych avatarów per tryb (CIRCLE/PITCH/TABLE) dla danej listy `families`; kliknięcie avatara wywołuje `onSelectFamily` z poprawnym `familyId`; tryb PITCH renderuje organizatora jako "trenerkę" nad boiskiem; tryb TABLE renderuje statyczne nieinteraktywne "chipy" na środku (kliknięcie chipa nie wywołuje żadnego handlera); `activeFamilyId` wyróżnia poprawną rodzinę we wszystkich 3 trybach.
  - [x] 6.2 Zaimplementować `<GroupVisualization families layoutMode activeFamilyId onSelectFamily>` jako kontener z trzema wewnętrznymi renderami; `CircleLayout` = 1:1 port dzisiejszej logiki koła z `KragGrupyPage.tsx` (używa `getCirclePosition`, `<Avatar>`), bez nowej logiki.
  - [x] 6.3 Zaimplementować `PitchLayout`: rodziny w rzędach (`getPitchPosition`/`distributeEvenly`/`locateInRows`), organizator wyświetlany nad boiskiem jako "trenerka", dowolna liczba rodzin bez nakładania avatarów, `getStableSlotOrder` do przypisania slotów.
  - [x] 6.4 Zaimplementować `TableLayout`: rodziny po obwodzie elipsy (`getTablePosition`, `getStableSlotOrder`), statyczne dekoracyjne "chipy" przedmiotów na środku (nieinteraktywne, bez handlerów kliknięcia).
  - [x] 6.5 Dodać renderowanie legendy `exchange-legend` (dwuwierszowa, identyczna we wszystkich trybach) raz pod wizualizacją, niezależnie od `layoutMode`.
  - [x] 6.6 Uruchomić tylko nowe 6-8 testów z 6.1.

**Acceptance Criteria:**
- 6-8 testów z kroku 6.1 przechodzą
- Zero regresji wizualnej trybu CIRCLE (identyczne pozycje jak dzisiaj)
- PITCH/TABLE renderują dowolną liczbę rodzin bez nakładania avatarów (N=1-30)
- Chipy w TABLE pozostają nieinteraktywne

**Visual References:**
- mockup: analysis/design-context/mockups/wizualizacja-grupy-kolo-mandala.html
  element: screen:group-visualization-circle
  locator: cała wizualizacja koła + legenda pod nią (sekcja "wizualizacja" mockupu)
  acceptance: layout koła pikselowo identyczny z dzisiejszym stanem; legenda dwuwierszowa pod wizualizacją
- mockup: analysis/design-context/mockups/wizualizacja-grupy-boisko.html
  element: screen:group-visualization-pitch
  locator: sekcja boiska — rzędy rodzin + pozycja "trenerki" nad boiskiem
  acceptance: rodziny w rzędach bez nakładania się dla dowolnego N; organizator wyraźnie oddzielony jako trenerka nad boiskiem; ta sama legenda co circle
- mockup: analysis/design-context/mockups/wizualizacja-grupy-stol.html
  element: screen:group-visualization-table
  locator: sekcja stołu — elipsa rodzin + chipy przedmiotów na środku
  acceptance: rodziny rozłożone po obwodzie elipsy bez nakładania; chipy statyczne, nieinteraktywne, tylko dekoracja
- mockup: analysis/design-context/mockups/wizualizacja-grupy-kolo-mandala.html
  element: component:group-visualization
  locator: struktura komponentu-kontenera (nie konkretny mockup wizualny — kontrakt props families/layoutMode/activeFamilyId/onSelectFamily widoczny pośrednio przez zachowanie każdego z 3 ekranów)
  acceptance: jeden komponent-kontener z trzema wewnętrznymi renderami, spójny interfejs props używany identycznie przez wszystkie 3 tryby
- mockup: analysis/design-context/mockups/wizualizacja-grupy-kolo-mandala.html
  element: component:exchange-legend
  locator: blok legendy pod wizualizacją (dwuwierszowy, dwie ikony + etykiety)
  acceptance: legenda identyczna treściowo i wizualnie we wszystkich 3 trybach, renderowana raz niezależnie od layoutMode

---

### Task Group 7: Frontend — API client + useKragGrupy.ts integracja
**Dependencies:** Group 3 (kontrakt backendu), Group 6 (typy KragFamily rozszerzone dla GroupVisualization)
**Files to Modify:**
- `src/frontend/src/api/groups.ts`
- `src/frontend/src/hooks/useKragGrupy.ts`
- `src/frontend/src/test/useKragGrupy.test.ts`

- [x] 7.0 Complete API + hook integration layer
  - [x] 7.1 Napisać 5-7 testów (aktualizacja `useKragGrupy.test.ts`): `Promise.all` przy mount pobiera exchange summary i mapuje `sharesItem`/`bringsItem` na `KragFamily`; błąd/timeout agregacji summary daje fallback `false`/`false` bez blokowania renderu reszty ekranu; `loadExchangeOffersForFamily` ładuje leniwie oferty po wywołaniu (nie przy mount); `setGroupLayoutMode` aktualizuje stan optymistycznie i wykonuje rollback przy błędzie PATCH; kształt rozszerzonego `KragFamily` zawiera nowe pola.
  - [x] 7.2 Dodać w `api/groups.ts` funkcje `getGroupExchangeSummary`, `getFamilyExchangeOffers`, `updateGroupLayoutMode` + odpowiadające interfejsy TS (wszystkie ID jako `number`).
  - [x] 7.3 Rozszerzyć `KragFamily` interfejs (`useKragGrupy.ts` linia 41-45) o `sharesItem`/`bringsItem` (bez zastępowania istniejących pól).
  - [x] 7.4 Dodać nowy fetch `getGroupExchangeSummary` do istniejącego `Promise.all` przy mount, zmapować wynik na `KragFamily.sharesItem`/`bringsItem`, fallback `false`/`false` przy błędzie (miękka degradacja, nie blokuje reszty ekranu).
  - [x] 7.5 Dodać stan `activeFamilyExchangeOffers`/`loadingExchangeOffers` i akcję `loadExchangeOffersForFamily` (leniwe wołanie z handlera kliknięcia avatara, krótki stan ładowania ograniczony do sekcji karty).
  - [x] 7.6 Dodać akcję `setGroupLayoutMode` (optymistyczna zmiana + wywołanie `updateGroupLayoutMode` PATCH + rollback przy błędzie), wzorem istniejących mutacji w tym hooku.
  - [x] 7.7 Wyekstrahować wspólną funkcję/hook "Biorę" z dzisiejszej inline logiki `browseListingsSection` (obsługa `takeTermItemListing`/`proposeSwapApi` + błąd/toast), umieszczoną tak, by mogła być używana z dwóch call site'ów (lista "Rzeczy od innych" i nowa sekcja karty rodziny w Group 8). [Zaimplementowane jako `takeOrProposeExchange` w useKragGrupy.ts; Group 8 musi przełączyć istniejący handleTakeButtonClick w KragGrupyPage.tsx na wywołanie tej funkcji, żeby uniknąć dwóch kopii logiki.]
  - [x] 7.8 Uruchomić tylko nowe/zaktualizowane 5-7 testy z 7.1.

**Acceptance Criteria:**
- 5-7 testów z kroku 7.1 przechodzą
- Błąd agregacji summary nie blokuje renderu wizualizacji (avatary bez ikon)
- `setGroupLayoutMode` ma poprawny rollback przy błędzie zapisu
- Wspólna funkcja "Biorę" istnieje jako jedno miejsce logiki, gotowa do użycia z dwóch call site'ów

---

### Task Group 8: Frontend — integracja w KragGrupyPage.tsx (przełącznik, karta rodziny) + aktualizacja pozostałych testów
**Dependencies:** Group 6, Group 7
**Files to Modify:**
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/test/KragGrupyPage.test.tsx`
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`

- [x] 8.0 Complete page integration
  - [x] 8.1 Napisać/zaktualizować 6-8 testów w `KragGrupyPage.test.tsx`: przełącznik trybu widoczny tylko dla `isOrganizerViewer`; nie-organizator widzi tryb tylko do odczytu (brak kontrolki); zmiana trybu wywołuje `updateGroupLayoutMode` i jest optymistyczna; sekcja "DO WYMIANY W GRUPIE" nie renderuje się dla własnej rodziny; sekcja nie renderuje się gdy lista ofert pusta; przycisk "Biorę" w nowej sekcji wywołuje tę samą wspólną funkcję co lista "Rzeczy od innych"; brak przycisku "Napisz" w sekcji.
  - [x] 8.2 Usunąć inline `pos()`/SVG-rendering/avatar-rendering z `PrivateKragGrupyView`, zastąpić `<GroupVisualization families={...} layoutMode={...} activeFamilyId={...} onSelectFamily={...}>`.
  - [x] 8.3 Dodać stan `layoutMode` inicjalizowany z `group.layoutMode`, przełącznik `component:layout-switcher` (segmented control "Koło / Boisko / Stół", pill-shaped, widoczny tylko gdy `isOrganizerViewer`) umieszczony bezpośrednio nad wizualizacją, wołający `setGroupLayoutMode` z Group 7. [Czytane bezpośrednio z group.layout_mode zamiast duplikowania do osobnego stanu lokalnego — hook już aktualizuje group optymistycznie.]
  - [x] 8.4 Rozbudować kartę rodziny (`.kg-card`) o nową sekcję "DO WYMIANY W GRUPIE": renderuje się tylko gdy kliknięta rodzina to NIE własna rodzina i lista ofert niepusta; każda pozycja: nazwa przedmiotu, typ oferty jako tag (reużycie `TAKE_ACTION_LABELS` linia 177), przycisk "Biorę" (bez "Napisz") wołający wspólną funkcję z Group 7.7; wywołanie `loadExchangeOffersForFamily` leniwie po kliknięciu avatara, stan ładowania ograniczony do sekcji. [Retry-on-error UI nie zaimplementowany — loadExchangeOffersForFamily z Group 7 połyka błędy wewnętrznie i zawsze rozwiązuje do [] lub realnych ofert, nie eksponując stanu błędu; drobna, udokumentowana luka względem spec.md, wymagałaby zmiany w useKragGrupy.ts poza zakresem tej grupy.]
  - [x] 8.5 Zweryfikować `PublicKragGrupyPage.test.tsx` (834 linii) — brak zależności od `GroupResponse.layout_mode`, wszystkie 36 testów przechodzi bez zmian.
  - [x] 8.6 Uruchomić testy z 8.1 (29/29) + PublicKragGrupyPage.test.tsx (36/36) + pełna regresja (backend 300/300; frontend 285/291 — 4 przedistniejące niepowiązane awarie zweryfikowane przez git stash, 2 mechaniczne do naprawy w PanelPage.test.tsx spoza deklarowanego zakresu tej grupy, naprawione bezpośrednio przez main agenta poniżej).

**Acceptance Criteria:**
- 6-8 testów z kroku 8.1 przechodzą, `PublicKragGrupyPage.test.tsx` nadal przechodzi bez regresji
- Przełącznik trybu widoczny wyłącznie dla organizatora, zmiana trwała (PATCH) i widoczna po odświeżeniu
- Sekcja "do wymiany" spełnia warunki pustej listy / własnej rodziny
- Brak przycisku "Napisz"; "Biorę" działa przez tę samą wspólną funkcję co istniejąca lista

**Visual References:**
- mockup: analysis/design-context/mockups/wizualizacja-grupy-kolo-mandala.html
  element: component:layout-switcher
  locator: pasek przełącznika nad wizualizacją (segmented control, 3 opcje z ikonami)
  acceptance: pill-shaped, ikonka+etykieta per opcja, aktywna opcja wyróżniona kolorem, widoczny tylko dla organizatora
- mockup: analysis/design-context/mockups/wizualizacja-grupy-kolo-mandala.html
  element: component:family-card-exchange-section
  locator: sekcja karty rodziny "DO WYMIANY W GRUPIE" (przykład z 2 ofertami w tym mockupie)
  acceptance: lista ofert z nazwą przedmiotu, tagiem typu oferty, przyciskiem "Biorę"; brak przycisku "Napisz"; sekcja znika dla pustej listy/własnej rodziny
- mockup: analysis/design-context/mockups/wizualizacja-grupy-boisko.html
  element: component:family-card-exchange-section
  locator: sekcja karty rodziny w wariancie z 1 ofertą
  acceptance: identyczne zachowanie sekcji niezależnie od trybu layoutu (pitch vs circle)

---

## Execution Order

1. Group 1: Backend model/migracja/schematy (5 kroków)
2. Group 2: Backend agregacja exchange_summary + re-eksport service.py (5 kroków, zależy od 1)
3. Group 3: Backend router endpointy + PATCH (5 kroków, zależy od 2)
4. Group 4: Frontend layoutPositions.ts (6 kroków, niezależna, może iść równolegle z 1-3)
5. Group 5: Frontend Avatar.tsx (5 kroków, niezależna, może iść równolegle z 1-4)
6. Group 6: Frontend GroupVisualization.tsx (6 kroków, zależy od 4, 5)
7. Group 7: Frontend API client + useKragGrupy.ts (8 kroków, zależy od 3, 6)
8. Group 8: Frontend integracja KragGrupyPage.tsx + testy (6 kroków, zależy od 6, 7)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/` — zawsze obowiązujące (coding-style, commenting, minimal-implementation, conventions)
- `backend/models.md` — string-backed `enum.StrEnum` + `_enum_column`, cross-module referencje przez plain FK-id
- `backend/queries.md` — batchowane `IN (...)`, bez N+1
- `backend/migrations.md` — mała, ukierunkowana migracja, `server_default` bez zbędnego backfillu
- `backend/security.md` — `AUTHORIZATION_MATRIX`-as-code, blankietowe wiersze, ownership check w warstwie `application`
- `backend/api.md` — zagnieżdżone zasoby pod `/api/groups/{id}/...`
- `frontend/components.md` — `Avatar`/`GroupVisualization` z jasnym interfejsem, pojedyncza odpowiedzialność
- `frontend/css.md` — nowe elementy Tailwindem, reużycie `.kg-mark`
- `testing/backend-testing.md` / `testing/frontend-testing.md` — integration-first backend, `renderWithProviders` frontend, 2-8 testów/grupa

## Notes

- Test-Driven: każda grupa zaczyna od 2-8 testów przed implementacją.
- Run Incrementally: po każdej grupie uruchamiać WYŁĄCZNIE nowe/zaktualizowane testy tej grupy, nie całą suitę.
- Mark Progress: odznaczać kroki w tym pliku w miarę postępu.
- Reuse First: priorytet dla istniejących komponentów/funkcji wskazanych w spec.md (`_list_eligible_lister_party_ids`, `_is_item_available`, `_require_term_eligibility`, `TAKE_ACTION_LABELS`, `.kg-mark`, `pos()` jako źródło do ekstrakcji).
- Grupy 4 i 5 mogą być realizowane równolegle z grupami backendowymi 1-3, ponieważ nie mają zależności technicznej między nimi.
- `PublicKragGrupyView`/`usePublicKragGrupy.ts` pozostają całkowicie poza zakresem zmian we wszystkich grupach — jedyny dotyk w Group 8.5 to weryfikacja braku regresji w istniejącym pliku testowym.
