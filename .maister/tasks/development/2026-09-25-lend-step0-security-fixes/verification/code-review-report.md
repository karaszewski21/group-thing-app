# Raport przeglądu kodu

**Data**: 2026-09-26
**Ścieżka**: niezacommitowane zmiany w `src/backend` i `src/frontend` (git diff) oraz nowe pliki `src/backend/alembic/versions/0040_notification_reservation_id.py` i `src/backend/tests/test_lend_step0_fixes.py`
**Zakres**: all (jakość, bezpieczeństwo, wydajność, dobre praktyki)
**Status**: ⚠️ Znaleziono problemy (brak krytycznych)

## Podsumowanie
- **Krytyczne**: 0
- **Ostrzeżenia**: 2
- **Informacyjne**: 9

Poprawki B6, B2-lite, B7, B10 i B12 są wdrożone zgodnie ze spec.md, łącznie z sekcją „Rozstrzygnięcia audytu”. Nie znalazłem żadnej ścieżki HTTP, którą użytkownik mógłby przenieść cudzą rzecz albo ją zablokować:

- **Surowe `POST /api/reservations`.** Przyjmuje tylko RETURN (`require_raw_route_reservation_type`, 403). Aktor pochodzi z principala. `reserved_by_user_id` jest wyprowadzany z `resolve_owning_inventory`. RETURN może rozpocząć tylko osoba, która ma rzecz (`_current_holder_user_id == acting_user_id`), i tylko dla rzeczy z ustawionym `home_inventory_id`.
- **Surowe confirm/cancel/fulfill.** Typ jest sprawdzany w routerze przed wywołaniem współdzielonych przejść, więc LEND, GIFT i SWAP dostają 403. Dla RETURN obowiązują dotychczasowe predykaty holder/party. Właściciel może tylko anulować zwrot (wtedy rzecz wraca do LENT) albo sfinalizować zwrot już potwierdzony.
- **Niezmiennik `home_inventory_id`.** `create_reservation` odrzuca każdy typ inny niż RETURN dla rzeczy pożyczonej (409). `fulfill_reservation(LEND)` ma dodatkowego strażnika (409). Dzięki temu ani groups (take/propose/accept), ani Pledge-LEND nie mogą ponownie pożyczyć, oddać ani zamienić rzeczy, która jest u pożyczającego.
- **`confirm/cancel-transaction`.** Termin brany jest z `reservation.term_id`, a nie od klienta. Kolejność bramek jest zgodna z m-9: uczestnik (403), RETURN (409), Termin (409), already-resolved.
- **R4 zachowane.** Reguły aktora i typu są tylko w `circulation/router.py` i `create_return_reservation`. W `reservation_transitions.py` doszły wyłącznie reguły stanu i niezmiennika: gałąź RETURN w cancel i strażnik w fulfill LEND. Nie ma tam reguł autoryzacyjnych, które zablokowałyby ścieżkę `circulation_bridge`.
- **Wyścigi.** `InventoryBalance` i `Reservation` dziedziczą z `BaseEntity` z `version_id_col`. Współbieżne `create_reservation`/`create_return_reservation` na tej samej rzeczy kończą się więc `StaleDataError`, który jest mapowany na 409 (`core/errors.py:88`). Podwójne zablokowanie rzeczy nie jest możliwe.

## Problemy krytyczne

Brak.

## Ostrzeżenia

### W-1. Oddawanie rzeczy w trzech krokach bez atomowości i bez ścieżki wznowienia (FE)
- **Lokalizacja**: `src/frontend/src/pages/panel/PanelDataContext.tsx:1371-1388` (`returnBorrowedItem`)
- **Kategoria**: best_practices / poprawność FE
- **Opis**: Zwrot to trzy osobne żądania: `createReservation`, potem `confirmReservation`, potem `fulfillReservation`. Jeśli drugie albo trzecie się nie powiedzie (sieć, 409 ze `StaleDataError`, 5xx), zostaje aktywna rezerwacja RETURN (`PENDING` lub `CONFIRMED`), a balance ma status `RESERVED` lub `IN_TRANSIT`. Ponowne kliknięcie „Oddaj” znów wywołuje `createReservation`, a serwer odpowiada 409, bo balance nie jest już `LENT`. Pożyczający nie ma w UI żadnego wyjścia z tej sytuacji, zwłaszcza że zgodnie z m-7 usunięto z FE `cancelReservation`. Rzecz utyka do czasu ręcznej interwencji.
- **Dlaczego to ważne**: dotyczy to głównego przepływu zwrotu po zmianach B6. Użytkownik widzi tylko „Nie udało się oddać rzeczy — spróbuj ponownie”, a ponowna próba zawsze kończy się błędem.
- **Rekomendacja**: przed `createReservation` sprawdzić, czy rzecz ma już aktywną rezerwację (`getInventoryItemBalance(itemId).reservation_id`, albo `getReservations(itemId)` z filtrem na aktywne RETURN) i wznowić od brakującego kroku: confirm, jeśli `PENDING`, fulfill, jeśli `CONFIRMED`. Alternatywą jest jeden endpoint serwerowy „oddaj”, który wykona trzy kroki w jednej transakcji, ale to raczej zadanie dla Loan MVP.
- **Możliwa do naprawy od ręki**: tak (FE, lokalnie)

### W-2. „Wzięte przeze mnie” pokazuje właścicielowi jego własną rzecz w trakcie zwrotu i nie filtruje po Terminie
- **Lokalizacja**: `src/backend/app/groups/application/term_item_listings.py:347-356` (`list_my_active_taken_term_item_listings`)
- **Kategoria**: quality / poprawność
- **Opis**: Po B6 rezerwacja RETURN ma zawsze `reserved_by_user_id` równe właścicielowi. `list_active_reservations_for_taker` zwraca wszystkie aktywne rezerwacje danego „biorącego”, bez filtra typu i Terminu. Aktywny RETURN trafia więc do listy „wzięte przeze mnie” właściciela: preferencja ma `owner_party_id` równe właścicielowi, który jest też uprawnionym wystawiającym. Pokazuje się to w każdym Terminie, do którego właściciel należy. Bezpieczeństwo jest zachowane, bo `confirm-transaction` dla RETURN zwraca 409, ale UI może zaproponować akcję, która zawsze kończy się błędem. Zapytanie ignoruje też `reservation.term_id`, choć od migracji 0039/0034 jest ono zawsze wypełnione. Samo zachowanie istniało wcześniej, ale B6 sprawia, że dotyczy teraz każdego zwrotu.
- **Rekomendacja**: w pętli (albo w nowym zapytaniu repozytorium) pomijać `reservation_type == RETURN` i wymagać `reservation.term_id == term_id`.
- **Możliwa do naprawy od ręki**: tak

## Informacyjne

### I-1. N+1 w skanie końca Terminu (B12)
- **Lokalizacja**: `src/backend/app/groups/application/term_end_scan.py:93-94`
- Każdy kandydat to dwa zapytania `get_profile_by_account_user_id`, a `resolve_organizer_slug` wykonuje się raz na każdy Termin (`:158-160`). Pobranie rezerwacji i markerów idzie już wsadowo, co jest wyraźną poprawą względem starej pętli per-item. Brak profilu przerywa cały skan (`EntityNotFoundException`), co zaakceptowano jako ryzyko m-10.
- **Sugestia**: przy wzroście skali pobrać profile jednym `select(UserProfile).where(account_user_id.in_(...))`. Możliwa do naprawy: tak.

### I-2. Ograniczone N+1 w `GET /api/inventory-items/mine` (B10)
- **Lokalizacja**: `src/backend/app/groups/application/term_item_listings.py:163-169`
- Każda pożyczona rzecz to trzy zapytania (balance, inventory, profil). Pętla ogranicza się do pożyczonych rzeczy, zgodnie z docstringiem i precedensem `_resolve_item_display_info`. Brak profilu pożyczającego kończy się 404 całej listy „Moje rzeczy”, a nie tylko pustym `lent_to_display_name`.
- **Sugestia**: przy braku profilu zwracać `None` zamiast propagować 404, a przy większej skali użyć jednego joina. Możliwa do naprawy: tak.

### I-3. Podwójne pobieranie rezerwacji w surowych trasach
- **Lokalizacja**: `src/backend/app/circulation/router.py:202-203, 213-214, 224-225`
- Router pobiera rezerwację, żeby sprawdzić typ, a zaraz potem serwis pobiera ją ponownie (drugi SELECT w obrębie tej samej sesji, prawdopodobnie z identity map). Koszt jest pomijalny, a układ świadomie wynika z R4.
- **Sugestia**: zostawić. Ewentualnie dodać komentarz, że jest to celowe ze względu na R4.

### I-4. Wyścig w `confirm_transaction`: przegrany dostaje ogólne 409 zamiast `already_resolved`
- **Lokalizacja**: `src/backend/app/groups/application/term_item_listings.py:727-736` i `:775-785`
- Przy dwóch współbieżnych wywołaniach obu stron oba mogą przejść sprawdzenie statusu, a drugie kończy się `StaleDataError`/`BusinessConflictException` („not PENDING”), czyli ogólnym 409 zamiast `already_resolved: true`. FE pokazuje wtedy toast „spróbuj ponownie”, a ponowienie da już poprawną odpowiedź. Problem istniał przed zmianami i nie jest regresją.
- **Sugestia**: na razie nic. Przy Loan MVP warto rozważyć `with_for_update()` na rezerwacji.

### I-5. 403 zamiast 409 dla „rzecz nie jest pożyczona” w surowym RETURN
- **Lokalizacja**: `src/backend/app/circulation/application/reservations.py:130-131`
- Semantycznie jest to konflikt stanu (409), ale spec (M-1) wprost wymaga 403. Zgodne ze specyfikacją, odnotowuję tylko dla porządku. Różne kody (404 dla nieistniejącego `item_id`, 403 dla istniejącego) pozwalają każdemu użytkownikowi z EDIT sprawdzić, czy dany identyfikator istnieje. Wyciek jest znikomy, bo ID są sekwencyjne, a `GET /api/inventory-items/{id}` i tak je ujawnia.

### I-6. Strefa czasowa `lent_due_date` w badge'u
- **Lokalizacja**: `src/frontend/src/pages/panel/views/RzeczyView.tsx:39-44`; źródło po stronie BE: `reservation_transitions.py:117` (`datetime.utcnow()` + `timedelta`)
- `due_date` to naiwny datetime w UTC, serializowany bez `Z`, a `dayjs(...)` parsuje go jako czas lokalny. Przy terminach bliskich północy data w formacie `DD.MM.YYYY` może przesunąć się o dzień. Ten sam problem ma istniejący `BorrowedItem.dueDate`, więc nie jest nowy.
- **Sugestia**: ujednolicić serializację (UTC z `Z`) albo parsować przez `dayjs.utc`. Możliwa do naprawy: tak.

### I-7. Pusty opis w badge'u przy braku nazwy pożyczającego
- **Lokalizacja**: `src/frontend/src/pages/panel/views/RzeczyView.tsx:40`
- Przy `lent_to_display_name === null` badge wyświetla „Pożyczone: ”, z pustym miejscem po dwukropku (i „Pożyczone: , do …”, gdy jest data). Z kontraktu BE (I-2) to się nie zdarza, ale typ na to pozwala.
- **Sugestia**: przy braku nazwy wyświetlać „Pożyczone” albo „Pożyczone: nieznana osoba”, tak jak robi `borrowedItems`. Możliwa do naprawy: tak.

### I-8. Ciche wyjście w strażnikach FE
- **Lokalizacja**: `src/frontend/src/pages/panel/PanelDataContext.tsx:1043` (`setItemMode`) i `:1353` (`deleteItem`)
- Guard `home_inventory_id != null` kończy funkcję bez komunikatu. Przyciski są zablokowane (`disabled` + `aria-describedby` na badge), więc to defense-in-depth. Jest spójne z komentarzem, ale BE nadal pozwala właścicielowi ustawić preferencję listingu dla pożyczonej rzeczy (`set_item_listing_preference` sprawdza tylko własność). Przejęcie jest i tak zablokowane przez `balance != AVAILABLE` oraz strażnika `home_inventory_id` w `create_reservation`.
- **Sugestia**: bez zmian w kroku 0. Blokadę po stronie BE warto rozważyć przy Loan MVP.

### I-9. Luki w testach dla nowych strażników
- **Lokalizacja**: `src/backend/tests/test_lend_step0_fixes.py`, `src/backend/tests/test_circulation.py`
- Brakuje trzech testów:
  - (a) właściciel, a nie posiadacz, próbuje przez surową trasę utworzyć RETURN swojej pożyczonej rzeczy (403); test `:187` obejmuje obcą osobę;
  - (b) osoba trzecia wywołuje `POST /api/reservations/{id}/cancel` na cudzym RETURN (403);
  - (c) strażnik `fulfill_reservation(LEND)` przy ustawionym `home_inventory_id` (409); dziś trudno do niego dotrzeć, bo wcześniej blokuje `create_reservation`, ale to właśnie siatka bezpieczeństwa na „brudne” dane (m-8).
- **Sugestia**: dopisać 2–3 krótkie testy. Możliwa do naprawy: tak.

## Metryki
- Najdłuższa funkcja: `_resolve_transaction_reservations_for_action` ma ok. 75 linii, z czego ok. 45 to docstring; kodu jest ok. 30 linii. `list_my_inventory_items` ma ok. 65 linii.
- Maksymalna głębokość zagnieżdżenia: 3 poziomy.
- Potencjalne podatności (autoryzacja/IDOR): 0.
- Ryzyka N+1: 2, oba ograniczone (I-1, I-2).
- Migracja 0040: odwracalna (`add_column`/`drop_column`), nullable, bez FK, zgodna z konwencją 0032/0038. Łańcuch rewizji 0039 → 0040 jest ciągły i nie ma duplikatu 0040.
- Nie znaleziono sekretów, SQL budowanego z konkatenacji, `console.log` ani TODO/FIXME w zmienionym kodzie.

## Priorytetowe rekomendacje
1. **W-1**: wznowienie w `returnBorrowedItem` (wykrycie aktywnego RETURN i dokończenie confirm/fulfill), żeby nieudany zwrot nie blokował rzeczy na stałe.
2. **W-2**: odfiltrować RETURN i obcy `term_id` w `list_my_active_taken_term_item_listings`.
3. **I-9**: dopisać testy regresji dla RETURN inicjowanego przez właściciela, cancel przez osobę trzecią i strażnika fulfill LEND.
4. **I-2 / I-7**: odporność „Moich rzeczy” na brak profilu pożyczającego (BE) i fallback nazwy w badge'u (FE).
5. **I-1 / I-6**: wsadowe pobieranie profili w skanie, ujednolicenie strefy czasowej `due_date`. Do zrobienia później, niskie ryzyko.
