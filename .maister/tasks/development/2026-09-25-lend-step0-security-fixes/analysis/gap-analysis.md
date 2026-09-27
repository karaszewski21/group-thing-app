# Analiza luk: Krok 0 wypożyczeń (B6, B7, B10, B12 + B2-lite)

## Podsumowanie
- **Poziom ryzyka**: Średni. To poprawki bezpieczeństwa we wspólnych przejściach circulation, z których korzystają też przepływy groups przez `circulation_bridge`.
- **Szacowany nakład**: Średni. Około 14 plików produkcyjnych BE+FE, 1 migracja (0040), przepisanie około 12–15 testów BE i około 6 asercji FE, nowe testy regresji dla każdej poprawki.
- **Wykryte cechy zadania**: `has_reproducible_defect`, `modifies_existing_code`, `involves_data_operations`, `ui_heavy` (umiarkowanie). `creates_new_entities` nie dotyczy: dochodzi tylko kolumna i pola odpowiedzi.

## Cechy zadania
- Ma powtarzalny defekt: **tak**. Są 4 potwierdzone błędy i ukryty łańcuch kradzieży.
- Modyfikuje istniejący kod: **tak**.
- Tworzy nowe encje: **nie**. Dochodzi kolumna `Notification.reservation_id`, pola `MyInventoryItemResponse.lent_*` i ewentualnie nowe zapytania repozytorium.
- Operacje na danych: **tak**. Chodzi o przejścia `Reservation`/`InventoryBalance`/`InventoryItem`, odczyt „moich rzeczy” i tworzenie `Notification`.
- Mocno UI: **częściowo**. Zmiany dotyczą badge'a w RzeczyView, blokad przycisków, modalu oczekujących akcji i payloadu `returnBorrowedItem`.

Decyzje już podjęte (C1–C3, `clarifications.md`) są tu przyjęte jako założenia i nie są ponownie zadawane.

---

## Zidentyfikowane luki

### B6: surowe `/api/reservations*` (+ B2-lite z C1/C2)

**Stan obecny** (zweryfikowany w kodzie):
- `router.create_reservation` (`circulation/router.py:161-168`) nie rozwiązuje principala. `reserved_by_user_id` przychodzi z body (`reservations.py:87`).
- `create_swap` (171-180): obie strony `reserved_by` pochodzą z body.
- `/confirm` sprawdza tylko `_require_holder_to_confirm`, a `/cancel` i `/fulfill` tylko `_require_party_to_reservation` (`reservation_rules.py:13-31`). Nie ma reguł per typ ani bramki Terminu.
- `cancel_reservation` (`reservation_transitions.py:65-82`) **zawsze** ustawia `AVAILABLE` i zeruje `reserved_at`/`due_date`, także dla RETURN. To otwiera łańcuch kradzieży.
- `create_reservation` (`reservations.py:97-99`) ustawia `balance.due_date = data.expires_at` także dla RETURN (dla RETURN to zawsze `None`). **Termin zwrotu ginie już przy utworzeniu RETURN**, zanim dojdzie do anulowania. Bez obejścia tego warunek C1 „zachowaj `due_date`” jest więc niespełnialny (patrz decyzja D-I3).
- `CreateReservationRequest` (`circulation/schemas.py:105-124`) to **wspólny DTO**. Używa go też `create_lend_reservation` (`reservations.py:106-118`, ścieżka Pledge przez bridge). Usunięcie `reserved_by_user_id` z tego schematu zepsułoby ścieżkę groups (patrz D-I1).

**Stan docelowy** (C1+C2):
- Na trasach surowych aktor to principal. Ta sama zasada obowiązuje we wszystkich trasach zapisu.
- `POST /api/reservations`:
  - dozwolony tylko RETURN,
  - aktor musi być bieżącym posiadaczem (właścicielem VIRTUAL),
  - `reserved_by` = właściciel `home_inventory_id`, a wartość z body jest ignorowana.
- `POST /api/reservations/swap`: zawsze odrzucane.
- `/fulfill`: tylko RETURN.
- Anulowanie RETURN przywraca `LENT`.
- Utworzenie rezerwacji innej niż RETURN wymaga `home_inventory_id IS NULL`.
- Reguły są tylko w routerze lub w strażniku używanym wyłącznie przez router.

**Luki do domknięcia (brakujące reguły)**:

| Trasa | RETURN | LEND / GIFT / SWAP | Stan obecny |
|---|---|---|---|
| POST create | aktor = posiadacz (VIRTUAL, `home_inventory_id` NOT NULL), `reserved_by` = właściciel domu | odrzuć (C2) | body decyduje |
| POST /swap | n/d | odrzuć (C2) | body decyduje |
| /{id}/confirm | posiadacz (dziś tak działa FE) | **niezdecydowane (D-C1)** | tylko posiadacz |
| /{id}/cancel | strona; przywraca LENT (C1) | **niezdecydowane (D-C1)** | strona; zawsze AVAILABLE |
| /{id}/fulfill | strona (posiadacz lub właściciel) | odrzuć (C2) | strona |

### B7: `confirm-transaction` / `cancel-transaction`
- **Obecnie**: `_resolve_transaction_reservations_for_action` (`groups/application/term_item_listings.py:657-722`) robi najpierw `get_term(db, term_id)` z body i bramkę `occurs_on > now`. Rezerwację ładuje dopiero w 692 i nigdy nie porównuje jej z `reservation.term_id`.
- **Docelowo**: najpierw rezerwacja, potem `get_term(db, reservation.term_id)`. `Reservation.term_id` jest NOT NULL (migracja 0034), a oba legi SWAP mają ten sam Termin.
- **Nieaktualne docstringi** („a bare Reservation carries no Term reference”) są w pięciu miejscach:
  - `_resolve_…`,
  - `ConfirmTransactionRequest`,
  - `CancelTransactionRequest`,
  - `api/reservations.ts:~72`,
  - docstring modułu `term_end_scan.py`.
- Nie istnieje test HTTP dla `cancel-transaction`.
- **Otwarte**: czy `term_id` znika z body (HLD §10 mówi, że tak), czy zostaje jako opcjonalny i ignorowany (D-I2).

**Skutek uboczny B7 w połączeniu z B10** (nowe ustalenie): RETURN dziedziczy `term_id` minionego Terminu LEND (`_resolve_return_term_id`). Dlatego `confirm_transaction`/`cancel_transaction` działają dla RETURN od razu. Uczestnikami są właściciel (`reserved_by`) i pożyczający (`giver`). Patrz D-C2.

### B10: `GET /api/inventory-items/mine`
- **Obecnie**: `list_my_inventory_items` (`term_item_listings.py:137-168`) wywołuje `find_personal_inventory`, a potem `list_items_with_product_name(inventory_id)`. Ten drugi robi `WHERE inventory_id = :id AND deleted_at IS NULL` (`repository.py:74-91`). Pożyczona rzecz ma `inventory_id` = VIRTUAL pożyczającego, więc znika z listy.
- **Docelowo**: rzeczy z `inventory_id = PERSONAL AND home_inventory_id IS NULL` lub z `home_inventory_id = PERSONAL`, uzupełnione o „pożyczone: komu, do kiedy”.
  - „Komu”: właściciel VIRTUAL → `get_profile_by_account_user_id` → `display_name`.
  - „Do kiedy”: `InventoryBalance.due_date`. To `DateTime`, ustawiane przy fulfil LEND na `expires_at` albo na now+`_DEFAULT_LEND_DAYS`.
- Istniejące `list_items_with_product_name` **musi zostać bez zmian**. Używa go też `GET /api/inventories/{id}/items` (`circulation/router.py:115`), czyli lista VIRTUAL pożyczającego.
- `MyInventoryItemResponse` (`groups/schemas.py:464-479`) i typ FE (`api/inventories.ts:36-38`) nie mają pól pożyczenia.
- **FE RzeczyView** (`pages/panel/views/RzeczyView.tsx`):
  - `lockBadgeLabel` (27-31) zwraca `null` dla `LENT`, więc nie ma badge'a pożyczenia,
  - przyciski trybów blokuje tylko `ACTIVE_LOCK_BALANCE_STATUSES` (RESERVED/IN_TRANSIT),
  - przycisk usuwania (376) nie jest nigdy blokowany, a BE zwraca 409 dla pożyczonych,
  - `handleDeleteItem` usuwa optymistycznie i przywraca pozycję po błędzie.

### B12: `term_end_scan`
- **Obecnie** (`groups/application/term_end_scan.py`):
  - kandydaci pochodzą wyłącznie z `ItemListingPreference` uprawnionych stron,
  - skan obejmuje tylko GIFT PENDING (`_scan_giveaways`) i SWAP ACCEPTED,
  - Take-LEND PENDING jest pominięty, bo typ nie jest skanowany,
  - Pledge-LEND CONFIRMED jest pominięty, bo nie ma preferencji i ma inny status,
  - `_scan_giveaways` nie filtruje po `reservation.term_id == term.id`, więc GIFT z przyszłego Terminu tego samego lister-a dostaje prompt za wcześnie.
- **Handler** `_handle_term_ended_giveaway` (`notifications/outbox_listener.py:74-86`) dostaje `reservation_id` w payloadzie, ale **nie przekazuje go do Notification**. Kolumny jeszcze nie ma (C3).
- **Modal FE** (`PanelDataContext.tsx:194-230`, `confirmPendingAction` 811-853): `resolvePendingReservationId` szuka rezerwacji tylko przez listy preferencji. Dla Pledge-LEND zwraca `null`, co FE traktuje jako „already resolved”. C3 zamyka tę lukę kolumną `Notification.reservation_id`.
  - Przy okazji: jeśli użytkownik ma w jednym Terminie kilka aktywnych rezerwacji, resolver wybiera pierwszą, więc wynik jest niejednoznaczny. Wskaźnik w powiadomieniu usuwa też ten problem.
- **Docelowo** (HLD §10): po Terminie z PENDING LEND lub Pledge-LEND obie strony dostają `TERM_CONFIRMATION_NEEDED` dokładnie raz. RETURN jest wykluczony. Marker jest oparty na rezerwacji.

---

## Ocena wpływu na ścieżki użytkownika

| Wymiar | Obecnie | Po zmianie | Ocena |
|---|---|---|---|
| Osiągalność pożyczonej rzeczy (właściciel) | brak, rzecz znika z „Moje rzeczy” | widoczna w „Moje rzeczy” z badge'em | poprawa |
| Wykrywalność statusu pożyczenia | 1/10 (brak) | 8/10 (badge tekstowy na karcie) | +7 |
| Monit po Terminie LEND | brak (Take-LEND) / martwy (Pledge-LEND) | modal „potwierdź przekazanie” | poprawa |
| „Oddaję” (pożyczający, `returnBorrowedItem`) | działa, ale przez niezabezpieczone trasy | działa, zmienia się payload (bez `reserved_by_user_id`) | neutralnie, jeśli FE i BE zmienią się razem |
| Liczniki Home | spadają po przekazaniu | bez zmian (kryterium HLD) | poprawa |

**Persony**:
- **Właściciel**: B10, B12, D-C2.
- **Pożyczający**: B6 („Oddaję”), B12.
- **Organizator** (odbiorca w Pledge-LEND): B12 przez C3.
- **Opiekun** (dawca w Pledge-LEND): B12, „Odebrał”.
- **Klienci MCP `mcp:edit`**: tracą surowe create/fulfill dla typów innych niż RETURN. To świadome (ADR-010). Nie znaleziono żadnych realnych konsumentów.

**Nowy przepływ, który pojawi się przez B10** (zweryfikowano w `RzeczyView.tsx:350-369`): przyciski „Odebrał” i „Anuluj wymianę” pokazują się, gdy `locked && termHasEnded`. `termHasEnded` sprawdza Termin rezerwacji z `balance.reservation_id`. Gdy pożyczający zacznie RETURN (bilans RESERVED, `term_id` minionego Terminu LEND), właściciel **od razu** zobaczy te przyciski na swojej pożyczonej rzeczy.
- „Odebrał” wywoła `confirm_transaction` na RETURN i zakończy zwrot jako właściciel. To zgodne z kierunkiem MVP (ADR-003).
- „Anuluj wymianę” odrzuci RETURN pożyczającego (dzięki B2-lite rzecz wraca do LENT).

To jest zmiana zachowania. Patrz D-C2.

---

## Analiza cyklu życia danych

### Encja: Reservation (trasy surowe po kroku 0)

| Operacja | Backend | UI | Dostęp | Status |
|---|---|---|---|---|
| CREATE RETURN | surowy POST (principal = posiadacz) | `returnBorrowedItem` | przycisk „Oddaję” w WypozyczoneView | pełne |
| CREATE LEND/GIFT/SWAP | tylko groups (take/propose/accept/pledge) | strona Terminu | nawigacja Terminu | pełne (surowe odrzucone) |
| READ | GET `/api/reservations*` | RzeczyView, modal | panel | pełne |
| UPDATE (confirm/fulfill) | RETURN: surowe; inne: `confirm-transaction` | „Oddaję”, „Odebrał”, modal | panel | pełne |
| DELETE (cancel) | RETURN: surowe; inne: `cancel-transaction` | „Anuluj wymianę” (tylko po Terminie) | panel | częściowe: brak anulowania **przed** Terminem dla LEND/GIFT. To istniało już wcześniej, FE nigdy nie wołało surowego `/cancel`, a problem rozwiązuje MVP (ADR-007). Nie jest to regresja kroku 0. |

### Encja: InventoryItem, widok właściciela („Moje rzeczy”)

| Operacja | Backend | UI | Dostęp | Status |
|---|---|---|---|---|
| READ (w domu) | `/mine` | RzeczyView | panel | pełne |
| READ (pożyczona) | **brak** → nowe zapytanie | **brak badge'a** | nie | **luka (B10)** |
| UPDATE meta (pożyczona) | PATCH dozwolony dla właściciela (`inventory_items.py:117-171`) | edycja na karcie | będzie widoczna po B10 | zostaje (zachowanie już istnieje) |
| UPDATE trybu (pożyczona) | `set_item_listing_preference` pozwala | przyciski trybów nie są zablokowane dla LENT | będzie widoczna | **decyzja D-I5** |
| DELETE (pożyczona) | 409 | przycisk kosza aktywny, usuwanie optymistyczne | będzie widoczny | **luka FE: zablokować** |

### Encja: Notification (`TERM_CONFIRMATION_NEEDED`)

| Operacja | Backend | UI | Dostęp | Status |
|---|---|---|---|---|
| CREATE GIFT/SWAP | skan + handler | — | — | istnieje |
| CREATE LEND/Pledge-LEND | **brak** | — | — | **luka (B12)** |
| READ, akcja w modalu | `reservation_id` **brak** (C3 → 0040) | modal | globalny modal panelu | **luka dla Pledge-LEND** (rozwiązana przez C3) |

**Kompletność**: około 75% przed poprawkami (osierocone: READ pożyczonej rzeczy u właściciela, akcja modalu Pledge-LEND). Po poprawkach według C1–C3 i D-* ocena wynosi około 95%. Brakujące anulowanie przed Terminem jest świadomie odłożone do MVP.

**Osierocone operacje**:
1. Pożyczona rzecz istnieje w danych (`home_inventory_id` = PERSONAL), ale właściciel jej nie widzi. Naprawia to B10.
2. Powiadomienie Pledge-LEND nie ma rozwiązywalnej akcji. Naprawia to C3.
3. `Pledge.status` nigdy nie przechodzi na FULFILLED (`sync_pledge_fulfillment` bez wywołania). Poza zakresem kroku 0, patrz D-I7.

**Brakujące punkty styku**: badge pożyczenia w RzeczyView, blokady kosza i trybów dla pożyczonych, przekazanie `reservation_id` w handlerach, filtr `term_id` w `_scan_giveaways`.

---

## Analiza defektów

### Dane reprodukcji

**B6 (blokada cudzej rzeczy)**
1. Użytkownik X (EDIT) wywołuje `POST /api/reservations {item_id: <rzecz Y>, reservation_type: GIFT, reserved_by_user_id: X, term_id: <dowolny>}`.
2. Oczekiwane: 403. Obecnie: 201, rzecz Y ma status RESERVED.

**B6 (łańcuch kradzieży)**
1. Pożyczający P tworzy surowy RETURN.
2. P robi surowe `/cancel`. Oczekiwane: status LENT. Obecnie: AVAILABLE, rzecz wciąż w VIRTUAL P.
3. P tworzy surowy GIFT z `reserved_by` = P, potem `/confirm` i `/fulfill`.
4. Obecnie: rzecz ląduje w PERSONAL P, `home_inventory_id` wskazuje właściciela, P dostaje +1 w ledgerze.

**B6 (pod-pożyczenie)**
- Po anulowaniu RETURN (bilans AVAILABLE w VIRTUAL) fulfil LEND ustawia `home_inventory_id = VIRTUAL P` (`reservation_transitions.py:104`). Właściciel traci rzecz.
- Ścieżką mogą być też groups: właściciel ma preferencję na tej rzeczy, więc ktoś ją „weźmie” z Terminu. Dlatego guard `home_inventory_id IS NULL` ma sens także we wspólnym `create_reservation`. Patrz D-I4.

**B7**
- Rezerwacja R ma Termin T2 w przyszłości. Wywołanie `confirm-transaction R {term_id: T1 (miniony)}`.
- Oczekiwane: 409 „Termin jeszcze się nie odbył”. Obecnie: potwierdza i fulfiluje.

**B10**
- Po fulfil LEND `GET /api/inventory-items/mine` właściciela.
- Oczekiwane: rzecz z „pożyczone: P, do D”. Obecnie: brak rzeczy.

**B12**
- Termin minął, istnieje Take-LEND PENDING albo Pledge-LEND CONFIRMED, uruchamiany jest `scan_for_term_ended`.
- Oczekiwane: 2 powiadomienia, 1 marker, przy ponownym skanie 0 nowych. Obecnie: 0.

### Hipotezy przyczyn źródłowych
- **B6**: brak rozwiązania principala w `create`, brak reguł per typ na surowych trasach, bezwarunkowe `AVAILABLE` w `cancel_reservation`.
- **B7**: kolejność ładowania (Termin z body przed rezerwacją). Pozostałość z czasów, gdy `Reservation` nie miało `term_id` (przed migracją 0034).
- **B10**: zapytanie filtruje po samym `inventory_id`.
- **B12**: kandydaci pochodzą z preferencji, a zbiór typów to tylko GIFT i SWAP.

### Obszary ryzyka regresji
- **Wspólne przejścia** (`confirm/cancel/fulfill_reservation`, `create_reservation`) wywoływane przez `circulation_bridge` w take, propose, accept, confirm/cancel-transaction i fulfill_pledge.
  - Zmiana w cancel dla RETURN jest bezpieczna, bo groups nigdy nie tworzą RETURN. Obejmie jednak `cancel_transaction` na RETURN (D-C2).
- **`test_circulation.py`**: około 24 wywołań surowych tras, z czego helper `_lend_and_confirm` i jego około 11 użytkowników wymaga przepisania na bridge/groups. Do tego `test_term_item_listings.py` (16 wywołań, w tym surowy LEND 1203-1255 i surowe `/confirm` 1914/1941) oraz `test_pledge_fulfillment.py:273` (surowe `/fulfill`).
- **B7 z usunięciem `term_id`**: około 21 wywołań serwisu w `test_term_item_listings.py`, testy HTTP w `test_term_item_listings_router.py` (423-593) i asercje FE `{term_id: 9}` w `PanelPage.test.tsx` (2184/2234/2312/2399/2457/2614).
- **B10**: testy `/mine` z dokładną równością słownika (`test_term_item_listings_router.py:160,186`) wymagają dopisania nowych pól (`None`).
- **B12**: `test_term_end_scan.py:187,260` liczą **wszystkie** markery. Jeśli fixture zawiera LEND, liczba się zmieni. Obecnie nie zawiera.

---

## Kwestie wymagające decyzji

### Krytyczne (decyzja przed specyfikacją)

**D-C1. Surowe `/confirm` i `/cancel` dla typów innych niż RETURN**

C2 zamknął create, `/swap` i `/fulfill`, ale nie rozstrzygnął `/confirm` ani `/cancel`.
- Surowe `/confirm` LEND/GIFT/SWAP przez posiadacza **przed** Terminem ustawia CONFIRMED/IN_TRANSIT. W efekcie `confirm_transaction` pomija krok confirm i od razu fulfiluje, co omija wyścig i zgodę obu stron (`confirm_race_rules`).
- Surowe `/cancel`:
  - dla SWAP anuluje jeden leg, a drugi zostaje RESERVED,
  - dla Pledge-LEND zostawia `pledge.resolved_reservation_id` wskazujące rezerwację CANCELLED,
  - pomija efekty uboczne groups.
- FE nie używa żadnej z tych ścieżek. Testy używają `/confirm` w `test_term_item_listings.py:1914/1941`.

Opcje:
- (A) `/confirm` i `/cancel` tylko dla RETURN, pozostałe typy → odrzucenie (spójnie z C2).
- (B) `/confirm` bez zmian (tylko posiadacz), `/cancel` odrzuca tylko SWAP.
- (C) Bez zmian.

**Rekomendacja: A.** Daje jedną regułę „surowe trasy zapisu = tylko RETURN”, najmniejszą powierzchnię do usunięcia w MVP (ADR-010) i nie kosztuje nic po stronie FE.

**D-C2. RETURN widoczny u właściciela po B10**

W RzeczyView pojawią się „Odebrał” i „Anuluj wymianę” dla oczekującego RETURN, a `confirm-transaction`/`cancel-transaction` przyjmą RETURN.
- Opcje:
  - (A) Zezwolić. Właściciel może potwierdzić zwrot („Odebrał” = `confirm_transaction`) albo go odrzucić (cancel → LENT). To zgodne z kierunkiem ADR-003 w MVP. Wymaga testu i etykiet dopasowanych do RETURN (np. „Odebrałem zwrot”).
  - (B) Zablokować. `_resolve_transaction_reservations_for_action` odrzuca RETURN (409), a FE ukrywa przyciski dla rzeczy z `home_inventory_id != null`. RETURN obsługują wyłącznie surowe trasy do czasu MVP.
  - (C) Zostawić przyciski bez zmian etykiet.
- **Rekomendacja: B.** Krok 0 ma zamykać luki, nie wprowadzać przedwcześnie nowego przepływu zwrotu (MVP go przepisuje). Dziś pożyczający robi create, confirm i fulfill jednym ciągiem, więc okno, w którym właściciel zobaczy RETURN, jest bardzo krótkie. Wariant A byłby i tak nadpisany przez `Loan`.
- **Uzasadnienie wagi**: bez decyzji B10 niejawnie uruchomi ścieżkę zwrotu przez właściciela bez testów.

### Ważne (warto zdecydować, są wartości domyślne)

**D-I1. Kształt body surowego POST (B6)**
- Opcje:
  - (A) Nowy schemat tylko dla routera, np. `CreateReturnReservationRequest {item_id, notes?}`. Router dopisuje `reservation_type=RETURN` i buduje wewnętrzny `CreateReservationRequest` z `reserved_by` wyliczonym po stronie serwera. FE przestaje wysyłać `reserved_by_user_id` i `reservation_type`.
  - (B) Zostawić wspólny schemat i ignorować `reserved_by_user_id` z body.
  - (C) Usunąć pole ze wspólnego DTO. Psuje to `create_lend_reservation`, więc wymaga osobnego wewnętrznego DTO.
- **Domyślnie: A.** Spełnia HLD („pole nie istnieje”) i nie rusza DTO używanego przez bridge.
- Czy `reservation_type` ma zostać w body jako wymagane `"RETURN"`, żeby niejawnie nie zmieniać znaczenia trasy? Domyślnie: pole zostaje, a każda wartość inna niż RETURN daje 403.

**D-I2. B7: `term_id` w body `confirm-transaction`/`cancel-transaction`**
- Opcje:
  - (A) Usunąć z body schematu, z sygnatur serwisu i z FE (HLD §10). Pre-prod bez shimów.
  - (B) Opcjonalne i ignorowane. Minimalny diff.
- **Domyślnie: A.** HLD i pamięć projektu („pre-production, no shims”). Koszt to około 21 mechanicznych zmian w testach serwisu, około 8 w testach HTTP i 6 asercji FE.
- FE RzeczyView dalej potrzebuje `reservationTermInfo` do `termHasEnded`, ale nie do payloadu.

**D-I3. B2-lite: zachowanie `due_date` przy RETURN**
- `create_reservation` nadpisuje `due_date = None` dla RETURN, więc anulowanie nie ma czego przywrócić. Przy tym B10 pokazałby „do: —” w czasie trwającego RETURN.
- Opcje:
  - (A) W `create_reservation` nie nadpisywać `due_date` dla RETURN (mini-B3). Anulowanie przywraca `LENT` i zeruje tylko `reserved_at`.
  - (B) Pogodzić się z utratą `due_date` po anulowaniu RETURN (MVP i tak przenosi daty do `Loan`).
- **Domyślnie: A.** To jedna linia, spełnia C1 („zachowaj `lent_at`/`due_date`”) i nie wpływa na groups, bo te nie tworzą RETURN.

**D-I4. Miejsce guardu `home_inventory_id IS NULL`**
- Z C2 wynika, że na surowej trasie typy inne niż RETURN są odrzucane w całości, więc guard w routerze byłby martwym kodem.
- Realnym wektorem pod-pożyczenia jest wspólne `create_reservation`, na przykład take z groups dla rzeczy, która po uszkodzonym stanie ma AVAILABLE w VIRTUAL.
- Opcje:
  - (A) Guard we wspólnym `create_reservation` dla typów innych niż RETURN (niezmiennik, 409). Żaden legalny wywołujący groups go nie trafi.
  - (B) Tylko w routerze (martwy kod po C2).
  - (C) Pominąć.
- **Domyślnie: A.** Niewielkie odstępstwo od literalnego „shared functions unchanged” w C2, ale dotyczy wyłącznie nieprawidłowego stanu. Warto dodać to samo sprawdzenie w gałęzi LEND `fulfill_reservation`.

**D-I5. B10: zachowanie UI dla pożyczonej rzeczy u właściciela**
- Badge tekstowy (`role="status"`, zgodnie z `accessibility.md`): „Pożyczone: {display_name}, do {DD.MM.YYYY}” (dayjs z `src/utils/dayjs.ts`).
- Kosz: `disabled` i `aria-disabled`, z podpowiedzią w tekście.
- Przyciski trybów:
  - (A) zablokowane,
  - (B) dozwolone (tryb „na po zwrocie”, BE i tak pozwala).
- Edycja nazwy i stanu: bez zmian (BE pozwala).
- **Domyślnie**: badge, zablokowany kosz, tryby zablokowane (A), edycja meta dozwolona.

**D-I6. B10: pola odpowiedzi**
- **Domyślnie**: `lent_to_display_name: str | None`, `lent_due_date: datetime | None` w `MyInventoryItemResponse`. „Pożyczona” wynika z `home_inventory_id != null`, więc bez osobnej flagi.
- Bez `lent_to_party_id` (YAGNI, MVP przepina na `Loan`).
- Alternatywa: dodać `lent_to_party_id` pod MVP. Niezalecana.

**D-I7. B12: zdarzenie, marker, zakres skanu**
- (a) **Zdarzenie**: użyć ponownie `TERM_ENDED_GIVEAWAY`. Payload `owner_party_id`/`taker_party_id`/`reservation_id` pasuje do LEND, a treść „potwierdź przekazanie rzeczy” też. Handler zaczyna przekazywać `reservation_id` do `create_notification`. Druga możliwość to nowe `groups.term_ended_lend` z własnym handlerem. **Domyślnie: reuse.**
- (b) **Marker**: użyć ponownie `GiveawayTermEndMarker` bez zmiany nazwy (unikalne `reservation_id` już jest), poprawiając docstring. Druga możliwość to przemianowanie tabeli w 0040 na `reservation_term_end_markers`, zgodnie z HLD „uogólnienie”. **Domyślnie: reuse bez przemianowania** (minimal-implementation, MVP i tak przebuduje).
- (c) **Źródło kandydatów**:
  - nowe zapytanie po `Reservation.term_id IN (:just_ended)`, typ ∈ {GIFT, LEND}, status ∈ {PENDING, CONFIRMED},
  - strony z `giver_user_id`/`reserved_by_user_id` → profile,
  - to samo zapytanie zastępuje ścieżkę GIFT, co przy okazji naprawia brak filtra `term_id`,
  - alternatywa: osobna ścieżka LEND, a w `_scan_giveaways` tylko dopisany filtr `term_id`,
  - **domyślnie: jedno zapytanie po `term_id` dla GIFT i LEND.** Zmiana dla GIFT: kandydaci nie zależą już od preferencji ani uprawnień listera.
- (d) **`reservation_id` w powiadomieniu**: wypełniać dla GIFT i LEND. FE używa go bezpośrednio, gdy jest, a stary resolver zostaje jako fallback dla SWAP i starszych powiadomień. **Domyślnie: tak.**
- (e) **Status pledge (`sync_pledge_fulfillment`)**: poza krokiem 0 (MVP, ADR-007). **Domyślnie: poza zakresem.**
- (f) **Pledge zrealizowany po upływie okna 24h od Terminu**: nie dostanie promptu. **Domyślnie: akceptujemy** (kosmetyka, zmienia to MVP).

**D-I8. Kody odpowiedzi dla odrzuceń na surowych trasach**
- Kryterium HLD: obca osoba dostaje 403.
- Opcje:
  - (A) Zawsze 403 (`AccessDeniedException`): zły typ, zły aktor i `/swap`.
  - (B) 403 dla złego aktora, 409 z komunikatem „użyj przepływu Terminu” dla złego typu.
- **Domyślnie: A.** Jednolite i spełnia kryterium akceptacji dosłownie.

**D-I9. RETURN: kto confirmuje i fulfiluje na surowych trasach**
- Dziś pożyczający (posiadacz) sam robi create, confirm i fulfill w `returnBorrowedItem`. HLD przesuwa zasadę „confirm/fulfil RETURN tylko dla W” do MVP.
- **Domyślnie**: bez zmian w kroku 0 (posiadacz confirmuje, strona fulfiluje), żeby nie zepsuć „Oddaję” przed MVP (ADR-010).

---

## Punkty integracji
- `app/circulation/router.py`: rozwiązanie principala w create; strażnik tylko dla routera (np. `_require_raw_route_allowed` w `circulation/domain/reservation_rules.py` lub przypadek użycia `create_return_reservation`); odrzucanie `/swap`; poprawka docstringu.
- `app/circulation/application/reservation_transitions.py`: gałąź RETURN w `cancel_reservation` (→ LENT); ewentualnie guard w fulfil LEND (D-I4).
- `app/circulation/application/reservations.py`: guard `home_inventory_id` (D-I4); brak nadpisywania `due_date` dla RETURN (D-I3); wyliczenie `reserved_by` dla RETURN z `resolve_owning_inventory` (`inventory_items.py:117-125`).
- `app/circulation/schemas.py`: nowy request dla routera (D-I1).
- `app/circulation/infrastructure/repository.py` + `application/inventory_items.py` + `service.__all__` + `groups/infrastructure/circulation_bridge.py`:
  - zapytanie „rzeczy właściciela łącznie z pożyczonymi” (B10),
  - zapytanie `list_active_reservations_for_terms` (B12).
- `app/groups/application/term_item_listings.py`: `_resolve_transaction_reservations_for_action` (B7, D-C2), `list_my_inventory_items` (B10).
- `app/groups/router/term_item_listings.py`, `app/groups/schemas.py`: body B7 i pola B10.
- `app/groups/application/term_end_scan.py`: B12.
- `app/notifications/models.py`, `service.py`, `schemas.py`, `outbox_listener.py` + `alembic/versions/0040_notification_reservation_id.py` (C3, wzór: 0038 `join_request_id`).
- FE:
  - `src/api/reservations.ts` (payload create, typy transakcji),
  - `src/api/inventories.ts` (`MyInventoryItemResponse`),
  - `src/api/notifications.ts` (`reservation_id`),
  - `src/pages/panel/PanelDataContext.tsx` (`returnBorrowedItem`, `confirmPendingAction`/resolver, `handleDeleteItem`),
  - `src/pages/panel/views/RzeczyView.tsx` (badge, blokady, payload B7).
- Macierz autoryzacji (`core/authorization_matrix.py`): **bez zmian**.

## Wzorce do naśladowania
- Luźny wskaźnik bez FK w Notification: `proposal_id`, `join_request_id` (migracja 0038).
- Reguły `_require_*` w `domain/*_rules.py` jako czyste funkcje bez `db`.
- Marker idempotencji i outbox w jednym commicie (`scan_for_term_ended`).
- Testy: `test_<action>_<condition>_<result>`, testcontainer postgres:18, HTTP przez httpx ASGI. FE: `vi.mock` modułów API i `createQueryWrapper`.

## Rekomendacje
1. Implementować w kolejności B7 → B6 z B2-lite → B10 → B12. B7 jest najbardziej lokalne, a B10 i B12 zależą od stanu po B6 (bez łańcucha kradzieży i ze spójnym LENT).
2. Każda poprawka ma własny test regresji odtwarzający scenariusz z sekcji „Dane reprodukcji”. Łańcuch kradzieży testować end-to-end przez HTTP.
3. Przepisać helper `_lend_and_confirm` na ścieżkę bridge lub groups (take, a potem `confirm_transaction`), a nie na surowe trasy.
4. Test regresji `useItemTake` (pożyczona rzecz w trybie SWAP nie jest proponowana).
5. Poprawić nieaktualne docstringi o „Reservation bez Termu” (5 miejsc).

## Ocena ryzyka
- **Złożoność**: średnia. Każda poprawka jest lokalna, ale reguły routera muszą być odseparowane od wspólnych przejść.
- **Integracja**: średnia. Dotyczy bridge, outboxu i migracji 0040, a FE i BE muszą wejść razem (payload `returnBorrowedItem`, B7).
- **Regresja**: średnia do wysokiej w testach (około 40 miejsc do aktualizacji), niska w produkcji, jeśli reguły trafią tylko do routera.
