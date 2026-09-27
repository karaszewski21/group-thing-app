# Raport analizy kodu

**Data**: 2026-09-25
**Zadanie**: Krok 0 poprawek wypożyczeń (LEND): B6, B7, B10, B12
**Opis**: B6: surowe `/api/reservations*` biorą `reserved_by` z body i omijają reguły groups. Aktor ma być brany z principala i sprawdzany regułami per typ; trasy zostają do MVP. B7: `confirm-transaction`/`cancel-transaction` ufają `term_id` z body. Termin ma pochodzić z rezerwacji. B10: `GET /api/inventory-items/mine` gubi pożyczone rzeczy właściciela. Trzeba je dodać z informacją „pożyczone: komu, do kiedy”. B12: `term_end_scan` ignoruje LEND i Pledge-LEND. Ma wysyłać `TERM_CONFIRMATION_NEEDED`. Kontekst: ADR-008, ADR-010 w `analysis/research-context/`.
**Analizator**: codebase-analyzer (2 agenty Explore: File Discovery + Code Analysis, Context Discovery)

---

## Podsumowanie

Wszystkie cztery błędy potwierdzono w kodzie i każdy ma jedną wyraźną przyczynę:
- **B6**: router nie ustala aktora przy `create`. Przejścia sprawdzają tylko, czy aktor jest stroną albo posiadaczem.
- **B7**: termin jest ładowany z body, zanim w ogóle zostanie odczytana rezerwacja.
- **B10**: zapytanie repozytorium filtruje wyłącznie po `inventory_id`.
- **B12**: kandydaci do skanu pochodzą tylko z `ItemListingPreference` i obejmują wyłącznie GIFT PENDING oraz SWAP ACCEPTED.

Najważniejsze odkrycie przy okazji: przez surowe trasy da się **ukraść pożyczoną rzecz** (RETURN → cancel → AVAILABLE → GIFT do siebie). Tę dziurę trzeba zamknąć w kroku 0 razem z B6 (w wersji „B2-lite”). Po stronie FE są dwie dodatkowe luki:
- Pledge-LEND nie rozwiązuje się w modalu `TERM_CONFIRMATION_NEEDED`. Bez tej poprawki B12 wysłałby powiadomienie, na które nie da się zareagować.
- Twierdzenie z researchu, że „Pledge używa surowego `/fulfill`”, jest **błędne dla FE**. Surowego `/fulfill` dla Pledge używają tylko testy.

---

## Zidentyfikowane pliki

### Pliki główne

**src/backend/app/circulation/router.py** (B6)
- `create_reservation` (161-168) i `create_swap` (171-180) przekazują body do serwisu bez rozwiązania principala.
- `confirm` (199-205), `cancel` (208-214) i `fulfill` (217-223) ustalają `acting_user_id` przez `get_user_id_by_principal`. Nie mają jednak reguł per typ ani bramki czasowej Terminu.
- Docstring modułu (9-13) twierdzi, że sprawdza własność. Dla `create` to nieprawda.

**src/backend/app/circulation/application/reservations.py** (B6)
- `create_reservation` (60-103):
  - wymagany bilans to `LENT` dla RETURN, a `AVAILABLE` dla pozostałych typów (65-74),
  - `reserved_by_user_id` jest brane z body (87),
  - `giver_user_id` to `_current_holder_user_id` (88),
  - ustawia `due_date = data.expires_at` (97-99), co nadpisuje termin zwrotu (`None` dla RETURN, powiązane z B3).
- `_resolve_return_term_id` (26-46). `create_lend_reservation` (106-118) obsługuje Pledge. `create_swap` (121-166) bierze obie wartości `reserved_by` z body (136, 146).

**src/backend/app/circulation/application/reservation_transitions.py** (B6, łańcuch kradzieży)
- `cancel_reservation` (65-82) zawsze ustawia bilans `AVAILABLE` i czyści `reserved_at`/`due_date` (76-78). Dla RETURN to błąd.
- `fulfill_reservation` (85-136) przyjmuje tylko CONFIRMED. Nie ma bramki czasu ani Terminu.
  - LEND (100-108): rzecz trafia do VIRTUAL pożyczającego, `home_inventory_id = item.inventory_id` (104), bilans `LENT`, ustawiany `due_date`.
  - RETURN (109-117): rzecz wraca do domu jako `AVAILABLE`.
  - GIFT/SWAP (118-125): rzecz trafia do PERSONAL strony `reserved_by`.
  - Wpis do ledgera w 130-132.
- Tych samych funkcji używa groups przez `circulation_bridge.py:129-149`.

**src/backend/app/circulation/domain/reservation_rules.py** (B6)
- `_require_party_to_reservation` (13-17) i `_require_holder_to_confirm` (20-31). To naturalne miejsce na nowy strażnik, używany tylko przez router (np. `_require_raw_route_allowed`).

**src/backend/app/groups/application/term_item_listings.py** (B7, B10, B12)
- `_resolve_transaction_reservations_for_action` (657-722): `get_term(db, term_id)` z body, potem `occurs_on > now` → 409 (688-690). Rezerwacja jest ładowana dopiero w 692 i nigdy nie jest porównywana z `reservation.term_id`.
- `confirm_transaction` (725-767) i `cancel_transaction` (770-795).
- `list_my_inventory_items` (137-168) dotyczy B10.
- `list_my_active_taken_term_item_listings` (316-340) wymaga preferencji (336-338). To źródło luki FE dla Pledge-LEND.
- `take_item_listing` (428-434), `propose_swap` (507-519), `accept_swap_proposal` (586-600).

**src/backend/app/groups/router/term_item_listings.py** (B7, B10)
- `GET /mine` (56-60).
- `confirm_transaction` (125-148) przekazuje `body.term_id` (139). `cancel_transaction` (151-171) robi to w linii 163.

**src/backend/app/groups/schemas.py** (B7, B10)
- `ConfirmTransactionRequest` (632-636) i `CancelTransactionRequest` (651-657) mają `{term_id:int}`.
- `MyInventoryItemResponse` (464-479) nie ma pól o pożyczeniu.

**src/backend/app/circulation/infrastructure/repository.py** (B10, B12)
- Zapytanie o przedmioty z nazwą produktu (74-91) ma `WHERE inventory_id = :id AND deleted_at IS NULL`.
- Jest `list_active_reservations_for_item` (174-185). Brakuje zapytań po `home_inventory_id` i po `Reservation.term_id`.

**src/backend/app/groups/application/term_end_scan.py** (B12)
- `_find_terms_just_ended` (54-63) bierze okno 24h.
- `_scan_giveaways` (66-126) obsługuje GIFT PENDING z markerem `GiveawayTermEndMarker`. Nie filtruje `reservation.term_id == term.id`.
- `_scan_swaps` (129-166). `scan_for_term_ended` (169-188) robi jeden commit na końcu.

**src/frontend/src/pages/panel/PanelDataContext.tsx** (B6, B7, B10, B12)
- `resolvePendingReservationId` (187/194-230) i `confirmPendingAction` (811-853). Brak rozwiązania dla Pledge-LEND sprawia, że prompt jest mylnie odrzucany jako „already resolved” (819-829).
- Ładowanie przedmiotów: 472-483. Wypożyczone: 485-516.
- Liczniki Home: `itemCounts` (1048-1055). `setItemMode`: 1029-1046.
- `handleDeleteItem` (1335-1352) usuwa optymistycznie.
- `returnBorrowedItem` (1356-1379) to jedyne wywołanie surowego create/confirm/fulfill.

**src/frontend/src/pages/panel/RzeczyView.tsx** (B7, B10)
- `lockBadgeLabel` (27-31) i `locked` (199-201) obsługują tylko RESERVED/IN_TRANSIT.
- Wywołania `term_id` z `reservation.term_id` (146, 162). Przycisk „Odebrał” (350-369).

### Pliki powiązane

- **src/backend/app/core/authorization_matrix.py**: wiersz 42 (159) to GET READ, wiersz 43 (160) to POST EDIT dla `/api/reservations*`. Wiersz 62 (211-216) z confirm-transaction jest nieosiągalny przez zasadę first-match, ale to kosmetyka. Wiersze inventory-items: 156-158. Żadna poprawka nie wymaga zmian w macierzy.
- **src/backend/app/groups/infrastructure/circulation_bridge.py**: pass-throughs (55-211); `resolve_current_holder_user_id` (152-161); `find_personal_inventory` (180-186); `list_items_with_product_name` (189-192).
- **src/backend/app/circulation/application/inventory_items.py**: lista (73-80), bilans (97-114; `reservation_id` tylko dla RESERVED/IN_TRANSIT), `resolve_owning_inventory` (117-125), `soft_delete_item` (159-171; 409 dla pożyczonych).
- **src/backend/app/circulation/application/identity.py** (16-25): `get_user_id_by_principal`.
- **src/backend/app/circulation/schemas.py**: `CreateReservationRequest` (164-183). Komentarz przy `CreateSwapRequest` (136-138) potwierdza, że FE nie wywołuje tej trasy.
- **src/backend/app/groups/application/pledge_fulfillment.py**: `fulfill_pledge` (30-110; `reserved_by` = organizator, `giver` = gość, auto-confirm w 90-92 → CONFIRMED/IN_TRANSIT); `sync_pledge_fulfillment` (113-122) nie ma wywołania w FE.
- **src/backend/app/groups/domain/confirm_race_rules.py** (19-23): `_require_race_participant`.
- **src/backend/app/groups/swap_events.py** (8-9), **src/backend/app/notifications/outbox_listener.py** (wire strings 32-33, `register()` 38-47, handlery 74-100), **src/backend/app/notifications/models.py** (`NotificationKind` 56, `proposal_id` 86).
- **src/backend/app/groups/models.py**: `SwapProposal.term_ended_notified_at` (379) i `GiveawayTermEndMarker` (382-394; unikalne `reservation_id`, migracja 0031:83-89). Ostatnia migracja: 0039.
- **src/backend/app/main.py**: scheduler (48-72); kolejność routerów, groups przed circulation (105/108).
- **src/frontend/src/api/reservations.ts** (26-32 payload, 50-68 surowe wywołania, 72-74/98 typy transakcji), **src/frontend/src/api/inventories.ts** (22-58 typy, 79 `getMyInventoryItems`, 104 `ACTIVE_LOCK_BALANCE_STATUSES`, 118-125 fan-out bilansów).
- **src/frontend/src/pages/krag/hooks/useItemTake.ts** (10-21), **HomeView.tsx** (262, 285), **WypozyczoneView.tsx** (36).

---

## Obecna funkcjonalność

### B6: surowe trasy rezerwacji
- POST `/api/reservations` przyjmuje `reserved_by_user_id` z body. Każdy użytkownik z uprawnieniem EDIT może utworzyć LEND, GIFT lub SWAP na cudzą rzecz albo na rzecz osoby trzeciej.
- Przejścia confirm, cancel i fulfill sprawdzają tylko „posiadacz lub strona”. Nie ma bramki Terminu, a fulfill LEND jest możliwy w dowolnym momencie.

**Kto legalnie korzysta z surowych tras**
- FE: wyłącznie `returnBorrowedItem`. Pożyczający tworzy RETURN z `reserved_by_user_id = lenderUserId`, a potem sam robi surowe `/confirm` i `/fulfill` jako posiadacz.
- Tras `createSwap` i `cancelReservation` FE nie używa.
- Wtyczki (`plugins/`, `app/plugin`) nie odwołują się do rezerwacji. Klienci OAuth2 z `mcp:edit` to scenariusz tylko teoretyczny.

**KOREKTA researchu:** Pledge-LEND **nie** używa surowego `/fulfill` w FE. Kończy się przez `confirm_transaction` po kliknięciu „Odebrał” w RzeczyView przez opiekuna (guardian). Surowe `/fulfill` pojawia się tylko w `tests/test_pledge_fulfillment.py:273`. Organizator nie ma działającego UI.

**KRYTYCZNE: ukryty łańcuch kradzieży** (istotny dla zakresu B6)

| Krok | Akcja pożyczającego | Stan po kroku |
|---|---|---|
| 1 | surowy create RETURN | bilans `RESERVED` |
| 2 | surowy `/cancel` (jest stroną) | `cancel_reservation:76` ustawia `AVAILABLE`, chociaż rzecz dalej leży w VIRTUAL pożyczającego z ustawionym `home_inventory_id` |
| 3 | surowy create GIFT z `reserved_by` = on sam | rezerwacja GIFT |
| 4 | confirm (jest posiadaczem) i fulfill | rzecz ląduje w PERSONAL pożyczającego (118-122) |

Po kroku 4 `home_inventory_id` nadal wskazuje właściciela, a pożyczający dostaje +1 w ledgerze. To jest **kradzież**.

Wariant: po zwykłym anulowaniu RETURN pożyczający może pod-pożyczyć rzecz. Fulfill LEND nadpisuje wtedy `home_inventory_id` jego VIRTUAL (104), a pierwotny właściciel traci rzecz.

**Wniosek:** sama zmiana „aktor = principal” nie wystarcza. Do kroku 0 trzeba wciągnąć **B2-lite**:
- anulowanie RETURN przywraca `LENT` i zachowuje `lent_at`/`due_date`,
- surowy create dla typów innych niż RETURN wymaga `home_inventory_id IS NULL`.

### B7: confirm/cancel-transaction
Dowolne `term_id` przeszłego Terminu odblokowuje potwierdzenie albo anulowanie rezerwacji, której własny Termin jest jeszcze w przyszłości. `Reservation.term_id` ma ograniczenie NOT NULL FK (migracja 0034). Oba legi SWAP mają ten sam Termin (`accept_swap_proposal:591`).

Nieaktualne docstringi mówią, że „bare Reservation carries no Term reference”. Występują w `_resolve_transaction_reservations_for_action`, w obu schematach, w typie FE i w docstringu modułu `term_end_scan`.

### B10: `/mine`
Pożyczona rzecz ma `inventory_id` = VIRTUAL pożyczającego i `home_inventory_id` = PERSONAL właściciela. Dlatego zapytanie ją wyklucza. Dane do „komu i do kiedy” są dostępne:
- pożyczający to `owner_user_id` VIRTUAL, a jego nazwę daje `get_profile_by_account_user_id` → `display_name`,
- termin zwrotu to `InventoryBalance.due_date`.

**Ryzyko `useItemTake` (sprawdzone):** `useItemTake.ts:11` filtruje `listing_mode === "SWAP"`, a linia 16 dodatkowo `balance.status === "AVAILABLE"`. Pożyczona rzecz ma bilans `LENT`, więc **nie** zostanie zaproponowana w SWAP. Ryzyka 409 z `_require_own_available_personal_item` nie ma. Koszt uboczny: pożyczone rzeczy w trybie SWAP zwiększą fan-out zapytań o bilans. Warto zostawić test regresyjny.

**Inne skutki w FE po dodaniu pożyczonych rzeczy:**
- Liczniki Home (`itemCounts`) zaczną je liczyć. To naprawia obecny spadek liczników.
- `setItemMode` blokuje tylko RESERVED/IN_TRANSIT. BE `set_item_listing_preference` (97-134) pozwala zmieniać tryb pożyczonych rzeczy. To zachowanie już istnieje, decyzja należy do produktu.
- `handleDeleteItem` usuwa optymistycznie, a BE zwraca 409. Trzeba zablokować usuwanie pożyczonych rzeczy w UI.

### B12: skan końca Terminu
- Kandydaci pochodzą tylko z preferencji. Pledge-LEND nie ma preferencji i jest CONFIRMED, więc skan go nie widzi. Take-LEND (PENDING) też jest pomijany, bo skanowane są tylko GIFT i SWAP.
- `_scan_giveaways` nie filtruje po `term_id`. GIFT z innego Terminu może dostać prompt za wcześnie.

**Luka FE dla Pledge-LEND:** `resolvePendingReservationId` szuka tylko przez `getMyTermItemListings` i `getMyTakenTermItemListings`, a oba wymagają preferencji. Skutki:
- dla organizatora wynik jest pusty,
- dla opiekuna wynik jest pusty, jeśli nie ma preferencji,
- zwrócone `null` FE traktuje jako „already resolved” i odrzuca prompt,
- nawet po naprawie B12 powiadomienie dla Pledge-LEND będzie więc martwe.

Działa za to BE `confirm_transaction` na Pledge-LEND (uczestnicy to organizator i opiekun; pomija już potwierdzone confirm; fulfil jako opiekun). Działa też „Odebrał” w RzeczyView.

**Poza zakresem:** `pledge.status` nigdy nie przechodzi na FULFILLED, bo `syncPledgeFulfillment` nie ma wywołania w FE.

### Przepływ danych (skrót)
FE → router groups/circulation → `app.<v>.service` (fasada) → application → repository. Groups korzysta z circulation przez `circulation_bridge`, podając posiadacza fizycznego jako aktora. Scheduler uruchamia `scan_for_term_ended` co minutę. Ten wpisuje zdarzenie do outboxu, a `outbox_listener` tworzy z niego powiadomienie.

---

## Zależności

### Importy
- Wspólne przejścia circulation (`reservation_transitions`) używane przez surowy router i przez `circulation_bridge`.
- `app.users.service.get_profile_by_account_user_id` do nazwy pożyczającego i do stron w skanie.
- Outbox: `swap_events` razem z `outbox_listener`.

### Konsumenci
- **circulation_bridge.py**: `create_lend_reservation` (Pledge), `create_reservation` (take, propose, accept), confirm/fulfill/cancel jako posiadacz. Dlatego reguły aktora muszą siedzieć w routerze albo w nowym przypadku użycia dla routera, nie w `service.create_reservation`.
- **term_item_listings.py**, **pledge_fulfillment.py**.
- **FE**: `PanelDataContext.tsx` (returnBorrowedItem, confirmPendingAction, lista items), `RzeczyView.tsx`, `useItemTake.ts`, `HomeView.tsx`, `WypozyczoneView.tsx`.

**Liczba konsumentów**: około 8 plików produkcyjnych.
**Zasięg wpływu**: Średni. Wspólne funkcje przejść są krytyczne dla przepływów groups.

---

## Pokrycie testami

### Pliki testów
- **tests/test_circulation.py** (921 linii):
  - helper `_lend_and_confirm` (właściciel tworzy LEND z `reserved_by` = pożyczający),
  - RETURN (L325-376, 762, 800, 816), patch/delete w trakcie pożyczenia (378, 405), confirm przez zamawiającego → 403 (434),
  - poziom bridge (542, 577, 615), brak `term_id` → 400 (726, 744).
- **tests/test_term_item_listings.py** (2047 linii):
  - około 21 bezpośrednich wywołań `confirm_transaction`/`cancel_transaction` z `term_id` własnej rezerwacji,
  - GIFT nieobecny w `/mine` organizatora (1049-1093; po B10 dalej poprawne),
  - surowy LEND w 1203-1255, surowe `/confirm` w 1914/1941.
- **tests/test_term_item_listings_router.py** (595 linii):
  - `/mine` (L160, 186: dokładna równość słownika),
  - confirm-transaction przez HTTP (484-577), 401 (580-595),
  - **brak testu HTTP dla cancel-transaction**.
- **tests/test_term_end_scan.py** (334 linie): GIFT i marker, idempotencja (liczy wszystkie `GiveawayTermEndMarker`: 190, 260), SWAP, przyszły Termin, handlery outboxu. Brak przypadku LEND.
- **tests/test_pledge_fulfillment.py**: LEND CONFIRMED po fulfil (116-120); surowe `/fulfill` i `/sync` (257-278).
- **FE**: `PanelPage.test.tsx` (mocki surowych wywołań 157-164, brak testu `returnBorrowedItem`, asercje `{term_id: 9}` w 2184/2234/2312/2399/2457/2614); `RzeczyViewCategory.test.tsx` (badge 191-247, toggle 249-320, post-term 396-447, nieaktualny test parity 451: 10 vs 13 rodzajów).
- Infrastruktura: `conftest.py` (testcontainer postgres:18, alembic head, rollback przez SAVEPOINT, klient httpx ASGI).

### Ocena pokrycia
- **Liczba testów**: ponad 60 związanych testów BE i kilkanaście FE.
- **Luki**:
  - surowy POST przez stronę trzecią (403),
  - RETURN cudzej pożyczki,
  - fulfill LEND przed końcem Terminu,
  - łańcuch cancel-RETURN → GIFT,
  - `/mine` z pożyczonymi rzeczami,
  - skan dla LEND PENDING i Pledge-LEND CONFIRMED (z idempotencją i wykluczeniem RETURN),
  - confirm/cancel-transaction z niezgodnym `term_id`,
  - cancel-transaction przez HTTP,
  - FE `returnBorrowedItem`,
  - FE rozwiązanie Pledge-LEND.

### Oczekiwane pęknięcia
- **B6**, gdy LEND/GIFT/SWAP wymagają `reserved_by = principal`:
  - użytkownicy `_lend_and_confirm` w `test_circulation` (287, 325, 378, 405, 470, 577, 762) oraz 434, 516, 542, 615,
  - `test_term_item_listings.py:1203`.
  - Naprawa: POST wysyła pożyczający. Confirm/cancel przez właściciela pozostają legalne.
- **B6**, jeśli surowy fulfill ograniczymy do RETURN: `test_pledge_fulfillment.py:273` i `test_term_item_listings.py:1245`.
- **B7**:
  - samo sprawdzenie równości nic nie psuje,
  - usunięcie `term_id` z sygnatury psuje około 21 wywołań serwisu, testy HTTP (423, 436, 496, 518, 542, 552, 574, 593) i asercje FE.
- **B10**: nic nie pęka.
- **B12**: nic nie pęka, jeśli marker zostanie użyty ponownie. Liczby markerów GIFT się nie zmienią.

---

## Wzorce kodowania

- **Nazewnictwo**: snake_case w Pythonie. Prywatne helpery reguł mają postać `_require_*`. Testy `test_<action>_<condition>_<result>`. Po stronie FE camelCase, hooki `use*`.
- **Architektura**: DDD warstwy domain/application/infrastructure za fasadą `service.py` (import tylko z `app.<v>.service`). Groups korzysta z circulation wyłącznie przez `circulation_bridge`. Wyjątki są typowane i mapowane na 403/409. Outbox działa z markerami idempotencji w tej samej transakcji.
- **FE**: kontekst `PanelDataContext` oraz moduły `src/api/*.ts`.

---

## Ocena złożoności

| Czynnik | Wartość | Poziom |
|--------|-------|-------|
| Liczba plików | ~14 BE+FE produkcyjnych | Wysoki |
| Zależności | bridge, users, outbox, notifications | Średni |
| Konsumenci | ~8 | Wysoki (współdzielone przejścia) |
| Pokrycie testami | dobre dla ścieżek szczęśliwych, luki dla nadużyć | Średni |

### Ogólnie: Średnio złożone

Każda poprawka jest lokalna. Złożoność wynika z czterech rzeczy:
- współdzielonych funkcji przejść, dlatego reguły muszą być tylko w routerze,
- rozszerzenia zakresu B6 o B2-lite,
- sprzężenia B12 z luką FE,
- dość szerokich zmian w testach.

---

## Kluczowe ustalenia

### Mocne strony
- Wyraźna warstwa reguł domenowych (`reservation_rules.py`, `confirm_race_rules.py`), w której łatwo dodać strażnik routera.
- `Reservation.term_id` jest NOT NULL, więc B7 ma pewne źródło prawdy.
- Idempotentne markery i outbox w pojedynczym commicie. `GiveawayTermEndMarker` można użyć ponownie bez migracji.
- Macierz autoryzacji nie wymaga zmian.

### Obawy
- **Łańcuch kradzieży** przez surowe cancel RETURN oraz nadpisanie `home_inventory_id` przy pod-pożyczeniu.
- Nieprawdziwy docstring routera o sprawdzaniu własności.
- Legi SWAP są fulfilowane w osobnych commitach, bez atomowości (poza zakresem).
- Anulowanie Pledge-LEND zostawia `pledge.resolved_reservation_id`, które wskazuje rezerwację CANCELLED.
- `_scan_giveaways` nie filtruje po `term_id`.
- `create_reservation` nadpisuje `due_date` przy RETURN (B3).
- Nazwa `GiveawayTermEndMarker` wprowadza w błąd, jeśli zostanie użyta dla LEND.

### Szanse
- Usunięcie `reserved_by_user_id` z `CreateReservationRequest`. Pydantic domyślnie ma `extra=ignore`, więc FE nie pęknie.
- Usunięcie `term_id` z body B7 albo zrobienie go opcjonalnym i ignorowanym.
- Uporządkowanie nieaktualnych docstringów.

---

## Ocena wpływu

- **Zmiany główne**: `circulation/router.py`, `reservation_rules.py`, `reservation_transitions.py` (cancel RETURN), `reservations.py` (guard `home_inventory_id`), `groups/application/term_item_listings.py`, `groups/router/term_item_listings.py`, `groups/schemas.py`, `circulation/infrastructure/repository.py`, `circulation_bridge.py`, `term_end_scan.py`.
- **Zmiany powiązane**: `inventory_items.py` i `service.py` (`__all__`), `outbox_listener.py`/`swap_events.py` (jeśli powstanie nowe zdarzenie), FE `RzeczyView.tsx`, `PanelDataContext.tsx`, `api/inventories.ts`, `api/reservations.ts`. Ewentualnie `notifications/models.py` z migracją 0040 (`reservation_id` w Notification).
- **Testy**: aktualizacja helperów surowego LEND i Pledge `/fulfill` oraz nowe testy dla wszystkich luk wymienionych wyżej.

### Poziom ryzyka: Średni

Dotykamy bezpieczeństwa i wspólnych przejść używanych przez przepływy groups. Istnieje ryzyko regresji w take, swap i Pledge, jeśli reguły trafią do serwisu zamiast do routera. B7 i B10 mają niskie ryzyko. B12 ma średnie, bo wiąże się ze zmianą zbioru kandydatów i zależnością od FE.

---

## Rekomendacje

### B6 z B2-lite (naprawa defektu bezpieczeństwa)
1. W routerze rozwiązuj aktora z principala dla wszystkich tras. Reguły umieść w strażniku używanym tylko przez router (np. `_require_raw_route_allowed` w `reservation_rules.py`) albo w wrapperach serwisu dla routera. **Nie** zmieniaj `service.create_reservation` ani wspólnych przejść.
2. POST per typ:
   - **RETURN**: aktor musi być bieżącym posiadaczem, a `reserved_by` wymuszasz na właściciela `home_inventory_id` (`resolve_owning_inventory`), ignorując body.
   - **LEND/GIFT/SWAP**: odrzuć (403/409), bo legalnie tworzą je tylko przepływy groups. Wariant zgodny z testami: zezwól tylko, gdy aktor jest posiadaczem, rzecz jest w jego PERSONAL i `home_inventory_id IS NULL`.
   - `/swap`: odrzuć.
3. `/fulfill` tylko dla RETURN. LEND (w tym Pledge), GIFT i SWAP → 409 z odesłaniem do `confirm_transaction`. `/confirm` zostaje tylko dla posiadacza. `/cancel`: RETURN przywraca `LENT` z `lent_at`/`due_date`, SWAP → 409.
4. B2-lite: cancel RETURN przywraca `LENT`. Surowy create dla typów innych niż RETURN wymaga `home_inventory_id IS NULL`. Warto dodać tę samą blokadę dla fulfil LEND, żeby wykluczyć pod-pożyczanie.
5. Opcjonalnie usuń `reserved_by_user_id` ze schematu. Popraw docstring routera.
6. Testy: 403 dla strony trzeciej, RETURN cudzej pożyczki, test regresyjny łańcucha kradzieży, przepisanie helperów (POST jako pożyczający albo przez bridge), aktualizacja `test_pledge_fulfillment.py:273` (np. przez `confirm_transaction`).

### B7
1. W `_resolve_transaction_reservations_for_action` najpierw załaduj rezerwację, potem `get_term(db, reservation.term_id)`. Bramkę `occurs_on` stosuj do Terminu rezerwacji.
2. `term_id` w body zrób opcjonalnym i ignorowanym. To minimalny wariant, który nie psuje około 21 testów ani FE. Pełne usunięcie wymaga aktualizacji typów FE i asercji. Popraw docstringi.
3. Testy: niezgodny lub przeszły `term_id` przy przyszłym Terminie własnym → 409. Dodaj test HTTP dla cancel-transaction.

### B10
1. Nowe zapytanie repozytorium: `deleted_at IS NULL AND ((inventory_id = :id AND home_inventory_id IS NULL) OR home_inventory_id = :id)`. Istniejące zapytanie zostaje dla listy VIRTUAL. Wystaw nowe przez `inventory_items.py`, `service.__all__` i bridge.
2. Dla pożyczonych rzeczy ustal `lent_to_display_name` i `lent_to_party_id` (właściciel VIRTUAL → profil) oraz `lent_due_date` (bilans). Dodaj je jako pola opcjonalne `MyInventoryItemResponse`. W MVP to przejdzie na Loan.
3. FE: badge „Pożyczone: <imię>, do <data>”, blokada usuwania i toggli dla pożyczonych. Zweryfikuj liczniki Home. `useItemTake` jest bezpieczny, bo filtruje bilans AVAILABLE. Dodaj test regresyjny.
4. Testy: `/mine` właściciela zawiera pożyczoną rzecz z pożyczającym i terminem. `/mine` pożyczającego jej nie zawiera.

### B12
1. Skan po `Reservation.term_id`: nowe zapytanie `list_active_reservations_for_term(term_id, types)` o statusie PENDING lub CONFIRMED, przez service i bridge. Typ LEND, z wykluczeniem RETURN. Strony: `giver_user_id` i `reserved_by_user_id` → profile.
2. Marker: użyj ponownie `GiveawayTermEndMarker` (bez migracji). Zdarzenie: użyj ponownie `TERM_ENDED_GIVEAWAY`, bo payload pasuje, albo dodaj `TERM_ENDED_LEND` z handlerem i rejestracją w obu plikach stałych. Rozważ filtr `term_id` w `_scan_giveaways`.
3. **Warunek konieczny: luka FE.** Bez rozwiązania `reservation_id` dla Pledge-LEND prompt nie zadziała. Opcje:
   - (a) kolumna `reservation_id` w Notification (wzorem `proposal_id`), migracja 0040, a modal używa jej bezpośrednio. Rekomendowane.
   - (b) lookup w BE po rezerwacjach aktywnych dla użytkownika bez wymogu preferencji.
4. Testy: LEND PENDING i Pledge-LEND CONFIRMED dają zdarzenie, marker i idempotencję. RETURN jest pomijany. Test FE dla modalu Pledge-LEND. Popraw nieaktualny test parity.

---

## Następne kroki

Wywołać gap-analyzer z trzema decyzjami do potwierdzenia przez użytkownika:
- włączenie B2-lite do kroku 0,
- odrzucenie albo zawężenie surowego LEND/GIFT/SWAP (wpływ na testy),
- sposób rozwiązania `reservation_id` dla Pledge-LEND w FE (kolumna w Notification albo lookup w BE).
