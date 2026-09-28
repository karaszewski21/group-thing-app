# Specyfikacja: księga ruchów przedmiotów w `app.circulation` („księgowanie produktów”)

Ścieżki kodu są podane względem `src/backend/`, chyba że zaznaczono inaczej. Wymagania wiążące pochodzą z `analysis/requirements.md`, `analysis/scope-clarifications.md` i `analysis/clarifications.md`.

## Cel

Przebudować księgę `Account` / `CirculationTransaction` / `CirculationEntry` z księgi punktów na księgę ruchów przedmiotów między inwentarzami. Każda zmiana inwentarza przedmiotu ma być księgowana jako jedna zbilansowana transakcja: −1×item na koncie inwentarza źródłowego i +1×item na koncie docelowego. Dzięki temu każdy przedmiot dostaje kompletną, dopisywaną historię REGISTER → … → REMOVE. Księga staje się źródłem prawdy o lokalizacji, a kolumny `InventoryItem.inventory_id`/`home_inventory_id` są jej projekcją aktualizowaną w tym samym commicie.

## Historyjki użytkownika

- Jako właściciel rzeczy chcę, żeby każde przekazanie mojej rzeczy (pożyczenie, zwrot, oddanie, zamiana) zostawiało ślad „skąd → dokąd, kiedy, w ramach której rezerwacji”. Dzięki temu da się odtworzyć pełną historię rzeczy.
- Jako uczestnik wymiany (SWAP) chcę, żeby wymiana wykonała się w całości albo wcale. Nie może zostać „pół wymiany”, w której oddałem swoją rzecz, a nie dostałem drugiej.
- Jako twórca przyszłego widoku „Historia rzeczy” chcę mieć endpoint zwracający uporządkowaną listę ruchów rzeczy z płaskimi stronami from/to (inwentarz, typ, właściciel).
- Jako deweloper chcę, żeby nie istniał żaden inny sposób zmiany lokalizacji rzeczy niż funkcja księgowania. Wtedy stan księgi i kolumna `inventory_id` nie mogą się rozjechać.

## Wymagania główne

1. **Punkty znikają całkowicie.** Usuwamy konta `100-{user_id}` i `900-100`, `post_circulation`, `get_or_create_user_balance_account`, `_get_emission_account`, `get_account_balance`, `list_transactions_for_account`, stałe `_EMISSION_ACCOUNT_CODE`/`_POSTED_AMOUNT`, enum `EntrySide` i dotychczasowe wartości `AccountType`.
2. **Konto = inwentarz.**
   - Tabela `accounts` dostaje `inventory_id` (UNIQUE, FK `inventories.id`, NULL tylko dla konta systemowego) i `account_type` ∈ {INVENTORY, EXTERNAL}.
   - W systemie istnieje dokładnie jedno konto EXTERNAL („świat zewnętrzny”).
   - Każdy `Inventory` (każdy `InventoryType`) ma dokładnie jedno konto INVENTORY, tworzone razem z inwentarzem.
3. **Transakcja** ma pola `movement_type` ∈ {REGISTER, REMOVE, GIFT, LEND, RETURN, SWAP} (6 typów, **bez OPENING**), `occurred_at` (DateTime, pełny czas), `transaction_number` oraz `description`. Nie ma FK do użytkowników. Porządek chronologiczny wyznacza para `(occurred_at, id)`.
4. **Zapis** ma pola `account_id`, `item_id` (FK `inventory_items.id`), `quantity` (−1 albo +1) i `reservation_id` (nullable FK `reservations.id`, ustawiany per noga). Kolumny `entry_side`, `amount`, `description` i `entry_date` znikają.
5. **Funkcja księgowania `post_movement`** jest jedynym sposobem przeniesienia rzeczy:
   - waliduje bilans (suma `quantity` per item w transakcji = 0) i reguły kształtu nóg;
   - tylko flushuje, bez commita;
   - w tym samym przebiegu aktualizuje projekcję (`inventory_id`, `home_inventory_id`, a dla REMOVE `deleted_at`).
6. **Punkty księgowania:**
   - `register_item` → REGISTER;
   - `soft_delete_item` → REMOVE;
   - `fulfill_reservation` → LEND / RETURN / GIFT;
   - nowy use case wymiany → SWAP jako jedna transakcja z 4 zapisami.
7. **Stany oczekujące niczego nie księgują.** Chodzi o create, confirm i cancel rezerwacji oraz PATCH `condition`/`product_id`.
8. **Atomowy SWAP.**
   - Confirm i fulfill obu nóg odbywają się w jednym commicie, przez nowy use case w circulation wołany przez bridge z `confirm_transaction`.
   - `cancel_transaction` dla SWAP (i dla pojedynczej nogi) również odbywa się w jednym commicie.
9. **Konto tworzone razem z inwentarzem** w `create_inventory` i `_get_or_create_inventory` (w tym samym SAVEPOINT co insert inwentarza).
10. **Migracja 0041** (jedna rewizja) wykonuje kolejno:
    - czyści dane circulation i wiersze od nich zależne;
    - zmienia schemat 3 tabel księgi;
    - usuwa seed `900-100`;
    - tworzy konto EXTERNAL i po jednym koncie na każdy istniejący inwentarz.

    Downgrade działa.
11. **Nowe API odczytu (tylko backend):**
    - `GET /api/inventory-items/{id}/history`;
    - nowy kształt `GET /api/circulation-transactions/{id}`.
12. **Usunięcie API punktów:**
    - `GET /api/accounts/{user_id}/balance` i `GET /api/circulation-transactions?account_id=` znikają;
    - w `app/core/authorization_matrix.py` usuwamy wiersz 44, a wiersz 45 zawężamy;
    - usuwamy plik FE `src/frontend/src/api/accounts.ts`.
13. **Niezmiennik** sprawdzany testami:
    - dla każdego żywego itemu dokładnie jedno konto ma saldo +1 i jest to konto `item.inventory_id`, a pozostałe konta mają saldo 0;
    - dla itemu usuniętego (soft delete) saldo +1 ma EXTERNAL;
    - każda transakcja sumuje się do 0 per item.
14. **Stan pożyczki** (`InventoryBalance.status`, `lent_at`, `due_date`) zostaje bez zmian semantyki. To stan, a nie ruch.
15. **Dokumentacja:** przepisać `docs/system-wypozyczalni-inventory-accounting.md`, zaktualizować docstringi modułów i dopisać krótki akapit w `.maister/docs/project/architecture.md`.

## Model danych

### Enumy (`app/circulation/models.py`)

| Enum | Wartości | Uwagi |
|---|---|---|
| `AccountType` | `INVENTORY`, `EXTERNAL` | Zastępuje `USER_BALANCE`/`SYSTEM_EMISSION`. |
| `MovementType` (nowy) | `REGISTER`, `REMOVE`, `GIFT`, `LEND`, `RETURN`, `SWAP` | Wartości LEND/RETURN/GIFT/SWAP są identyczne z `ReservationType`, więc typ ruchu przy fulfill to `MovementType(reservation.reservation_type.value)`. |
| `EntrySide` | usunięty | |

Oba enumy są zapisywane jako VARCHAR przez istniejący helper `_enum_column(..., native_enum=False)` (`models.py:31`), z długością 20.

### `Account` (tabela `accounts`, `BaseEntity`, sekwencja `account_seq` bez zmian)

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `account_type` | String(20) (`AccountType`) | NOT NULL |
| `inventory_id` | BigInteger | NULL tylko dla EXTERNAL; FK `fk_accounts_inventory_id_inventories`; UNIQUE `uq_accounts_inventory_id` |
| `created_at`, `updated_at` | z `BaseEntity` | |

Ograniczenia dodatkowe:
- `ck_accounts_inventory_id_account_type`: CHECK, że (`account_type = 'INVENTORY'` i `inventory_id IS NOT NULL`) albo (`account_type = 'EXTERNAL'` i `inventory_id IS NULL`). Gwarantuje to kształt konta na poziomie DB. Nie jest to CHECK na `quantity`, którego użytkownik nie chciał.
- `uq_accounts_account_type_external`: unikalny indeks częściowy na `account_type` z warunkiem `WHERE account_type = 'EXTERNAL'`. Wymusza „dokładnie jedno EXTERNAL” w wariancie „co najwyżej jedno”. Istnienie tego konta zapewnia seed w 0041.

Kolumny **usuwane**, z uzasadnieniem:
- `code`: kod planu kont (`100-…`/`900-100`) miał sens tylko dla punktów. Tożsamość konta to teraz `inventory_id`, a dla EXTERNAL `account_type`.
- `name`: stała etykieta bez żadnego konsumenta. Opis wynika z typu i inwentarza.
- `owner_user_id`: właściciel jest wyprowadzalny przez `inventories.owner_user_id`. Kopia wymagałaby synchronizacji i łamałaby zasadę „strony z kont → inventory → owner”.

Razem z nimi znikają `uq_accounts_code`, `fk_accounts_owner_user_id_users` i `ix_accounts_owner_user_id`.

Pozostałe elementy modelu:
- Relacja `Account.inventory` do `Inventory` z `lazy="raise"` (ten sam moduł, więc dozwolona). Potrzebna do `GET /api/circulation-transactions/{id}`.
- `__eq__`/`__hash__` po kluczu biznesowym `(account_type, inventory_id)` zamiast `code`.

### `CirculationTransaction` (tabela `circulation_transactions`)

| Kolumna | Typ | Uwagi |
|---|---|---|
| `transaction_number` | String(50), UNIQUE (`uq_circulation_transactions_transaction_number`, bez zmian) | Nadal `TRX-<12 hex>` z `_next_transaction_number()` (`domain/reservation_rules.py:44`). Pozostaje kluczem biznesowym `__eq__`/`__hash__`. |
| `movement_type` | String(20) (`MovementType`) | NOT NULL, nowa |
| `occurred_at` | DateTime() (naiwny UTC, jak reszta modelu) | NOT NULL, nowa. Zastępuje `transaction_date: Date`. |
| `description` | String(500) | NOT NULL, bez zmian. Tekst `"{TYPE}: {nazwa produktu}"`, a dla SWAP `"SWAP: {X} ⇄ {Y}"`. |
| `transaction_date`, `is_posted` | usuwane | Księga jest append-only, nie ma szkiców, więc `is_posted` traci znaczenie. |

Relacja `entries` zostaje (`lazy="raise"`) i dostaje `order_by` po `CirculationEntry.id`, żeby odczyt szczegółów był deterministyczny.

### `CirculationEntry` (tabela `circulation_entries`)

| Kolumna | Typ | Uwagi |
|---|---|---|
| `transaction_id` | bez zmian | FK i indeks `ix_circulation_entries_transaction_id` zostają |
| `account_id` | bez zmian | FK i indeks `ix_circulation_entries_account_id` zostają (saldo konta) |
| `item_id` | BigInteger NOT NULL | FK `fk_circulation_entries_item_id_inventory_items` |
| `quantity` | Integer NOT NULL | −1 lub +1. **Bez CHECK** (decyzja użytkownika). Walidacja odbywa się w `post_movement`. |
| `reservation_id` | BigInteger NULL | FK `fk_circulation_entries_reservation_id_reservations`. NULL dla REGISTER/REMOVE, dla SWAP ustawiany per noga. |
| `amount`, `entry_side`, `description`, `entry_date` | usuwane | |

Indeksy:
- **Nowy** `ix_circulation_entries_item_id_transaction_id` na `(item_id, transaction_id)`. Obsługuje zapytanie historii: filtr po `item_id` i złączenie z transakcją.
- `reservation_id` nie dostaje indeksu. Żadne zapytanie po nim nie filtruje, a rezerwacje nigdy nie są usuwane, więc FK nie potrzebuje indeksu do kaskadowego sprawdzania. Tak samo postąpiono z `notifications.reservation_id` w 0040.

Relacje: `transaction` i `account` zostają (`lazy="raise"`). Relacji do `InventoryItem` ani `Reservation` nie dodajemy, bo nikt z nich nie korzysta (YAGNI, `models.md`).

Sekwencje: wszystkie istniejące (`account_seq`, `circulation_transaction_seq`, `circulation_entry_seq`) zostają bez zmian.

## Funkcja księgowania (`app/circulation/infrastructure/ledger.py`, przepisana)

### Kontrakt

- Nowy frozen dataclass `MovementLeg` w `ledger.py` z polami:
  - `item: InventoryItem`;
  - `from_inventory_id: int | None`, gdzie None oznacza EXTERNAL;
  - `to_inventory_id: int | None`, gdzie None oznacza EXTERNAL;
  - `reservation_id: int | None`.
- Sygnatura: `post_movement(db, *, movement_type: MovementType, legs: Sequence[MovementLeg], description: str, occurred_at: datetime) -> CirculationTransaction`.
- Funkcja tylko flushuje. Commit należy do wołającego use case'u w `application/`, zgodnie z istniejącym wzorcem flush-only w infrastrukturze.

### Kiedy odczytywane jest „from”

- `from_inventory_id` zawsze odczytuje **wołający**, z bieżącej projekcji `item.inventory_id`. Robi to przy budowaniu nogi, **przed** wywołaniem `post_movement`, i jest to stan sprzed jakiejkolwiek mutacji.
- Ponieważ tylko `post_movement` mutuje `inventory_id`/`home_inventory_id`, każda noga zbudowana przed księgowaniem widzi prawidłowe „from”. Dotyczy to także obu nóg SWAP, które są budowane przed jednym wspólnym wywołaniem.
- `post_movement` weryfikuje to ponownie: dla nogi z `from_inventory_id is not None` wymaga `item.inventory_id == from_inventory_id`. Niezgodność oznacza nieaktualny odczyt i kończy się `BusinessConflictException` (409).

### Walidacja (przed jakimkolwiek zapisem)

Naruszenie reguł biznesowych daje `BusinessConflictException` (409). Niezbilansowanie to błąd programistyczny i daje `ValueError`.

1. Liczba nóg: SWAP wymaga dokładnie 2 nóg z różnymi itemami, każdy inny typ dokładnie 1 nogi.
2. Kształt nogi:
   - REGISTER: `from` = None, `to` ≠ None;
   - REMOVE: `from` ≠ None, `to` = None;
   - pozostałe typy: oba ≠ None oraz `from` ≠ `to`.
3. Item nie jest usunięty (`deleted_at IS NULL`).
4. Spójność z projekcją:
   - dla `from` ≠ None: `item.inventory_id == from`;
   - RETURN: `item.home_inventory_id == to`;
   - LEND, GIFT, SWAP i REMOVE: `item.home_inventory_id IS NULL` (rzeczy pożyczonej nie można dalej przekazać ani usunąć).
5. Po zbudowaniu listy zapisów: suma `quantity` per `item_id` = 0. Przy budowie z nóg zachodzi to z konstrukcji, ale sprawdzenie jest jawne, zgodnie z wymaganiem „funkcja odrzuca niezbilansowaną transakcję”.

### Kroki

1. Rozwiązuje konta **jednym zapytaniem**: konta INVENTORY dla zbioru `from`/`to` wszystkich nóg oraz EXTERNAL, jeśli któraś strona jest None. Brak konta daje `EntityNotFoundException("Account", …)`, tak samo jak dziś przy braku konta emisji. Przy poprawnym działaniu to niemożliwe, bo konto powstaje razem z inwentarzem.
2. Tworzy `CirculationTransaction` (`transaction_number` z `_next_transaction_number()`, `movement_type`, `occurred_at`, `description`) i flushuje ją.
3. Dla każdej nogi tworzy dwa zapisy w kolejności: −1 na koncie „from”, +1 na koncie „to”. Oba mają `item_id` nogi i `reservation_id` nogi.
4. Aktualizuje projekcję per noga:
   - `to` ≠ None: `item.inventory_id = to`;
   - `to` = None (REMOVE): `item.deleted_at = occurred_at`, a `inventory_id` zostaje jako ostatnia lokalizacja, bo kolumna jest NOT NULL;
   - LEND: `item.home_inventory_id = from`;
   - RETURN: `item.home_inventory_id = None`.
5. Flushuje i zwraca transakcję.

### Współbieżność

Mutacja projekcji podbija `updated_at` itemu (optimistic locking przez `version_id_col` z `BaseEntity`). Dwa równoległe ruchy tego samego itemu kończą się `StaleDataError`, który istniejący handler zamienia na 409.

## Punkty księgowania i dokładne zapisy

| Zdarzenie | Miejsce | Zapisy | `reservation_id` | Commit |
|---|---|---|---|---|
| REGISTER | `application/inventory_items.py::register_item` (także z `pledge_fulfillment.py:75` przez bridge) | EXTERNAL −1 / konto `inventory_id` rejestracji +1 | NULL | istniejący `db.commit()` w `register_item` (księgowanie przed nim) |
| REMOVE | `inventory_items.py::soft_delete_item` | konto `item.inventory_id` −1 / EXTERNAL +1; `deleted_at` ustawia `post_movement` | NULL | istniejący commit |
| LEND | `reservation_transitions.py`, gałąź LEND | PERSONAL(A) (bieżące `inventory_id`) −1 / VIRTUAL(B) (`get_or_create_virtual_inventory(reserved_by)`) +1 | id rezerwacji | wrapper `fulfill_reservation` albo `fulfill_exchange` |
| RETURN | gałąź RETURN | VIRTUAL(B) −1 / `home_inventory_id` (PERSONAL A) +1 | id rezerwacji | `fulfill_reservation` (raw route `/fulfill`) |
| GIFT | gałąź GIFT | PERSONAL(A) −1 / PERSONAL(B) (`get_or_create_personal_inventory(reserved_by)`) +1 | id rezerwacji | `fulfill_exchange` (groups) |
| SWAP | nowy `fulfill_exchange` | jedna transakcja z 4 zapisami: X: A −1 / B +1; Y: B −1 / A +1 | każda noga ma id swojej rezerwacji | jeden commit |

Szczegóły:

- **REGISTER.**
  - `register_item` tworzy `InventoryItem` z `inventory_id` inwentarza docelowego. Kolumna jest NOT NULL i jest to konstrukcja, a nie przeniesienie. Następnie flushuje, żeby dostać `item.id`, tworzy `InventoryBalance` jak dziś i woła `post_movement(REGISTER, from=None, to=inventory_id)`. Projekcja jest wtedy no-opem.
  - Opis transakcji używa nazwy produktu zwróconej przez istniejące `product_service.get_product` (`inventory_items.py:42`).
  - Sygnatura `register_item` się nie zmienia, więc bridge i `pledge_fulfillment` nie wymagają zmian.
- **REMOVE (decyzja).** Usuwać można tylko rzecz, która fizycznie jest u właściciela, w swoim inwentarzu domowym.
  - Kod już to wymusza: `soft_delete_item` (`inventory_items.py:173`) zwraca 409, gdy `InventoryBalance.status ≠ AVAILABLE`, a rzecz pożyczona ma status LENT. Zweryfikowano w kodzie, blokada nie jest tylko w UI.
  - Dodatkowo `post_movement` odrzuca REMOVE, gdy `home_inventory_id IS NOT NULL` (409). Chroni to przed stanem wymuszonym, jak w teście R7 `test_circulation.py:1010`.
  - Uzasadnienie: rzecz pożyczona leży w VIRTUAL(B). Jej REMOVE zdjęłoby ją z konta pożyczającego bez zwrotu, a właściciel nie może usunąć czegoś, czego fizycznie nie ma. Najpierw musi nastąpić RETURN.
- **`fulfill_reservation`** (tylko LEND i RETURN; GIFT przechodzi teraz przez `fulfill_exchange`, ale pojedyncza noga GIFT dalej działa także tutaj):
  - Odrzuca typ SWAP z `BusinessConflictException` („zamiana realizowana jest wyłącznie parą”). Chroni to regułę „SWAP = jedna transakcja z 4 zapisami”.
  - RETURN bez `home_inventory_id` daje teraz 409. Dziś to cichy no-op, ale nie da się zaksięgować ruchu bez celu. `create_return_reservation` i tak wymaga stanu wypożyczenia.
  - Istniejąca blokada ponownego pożyczenia LEND (`:106-109`) zostaje.
- **Brak zapisów** przy `create_reservation`, `create_lend_reservation`, `create_return_reservation`, `confirm_reservation`, `cancel_reservation` i `update_item`.

## Refaktor przejść rezerwacji i atomowy SWAP

### `application/reservation_transitions.py`

Każde przejście dzielimy na wewnętrzną funkcję flush-only i cienki wrapper, który commituje. Zachowanie i sygnatury publicznych funkcji się nie zmieniają.

| Funkcja wewnętrzna (bez commita) | Robi | Publiczny wrapper (commit + refresh) |
|---|---|---|
| `_confirm(db, reservation, acting_user_id)` | guard PENDING, `_require_holder_to_confirm`, CONFIRMED, balance IN_TRANSIT | `confirm_reservation(db, id, acting)` |
| `_cancel(db, reservation, acting_user_id)` | guard statusu, `_require_party_to_reservation`, CANCELLED, reguły balance RETURN/nie-RETURN | `cancel_reservation(db, id, acting)` |
| `_fulfill(db, reservation, acting_user_id, now) -> MovementLeg` | guard CONFIRMED, autoryzacja, odczyt `from = item.inventory_id`, wyznaczenie `to` per typ (get-or-create VIRTUAL/PERSONAL), mutacje `InventoryBalance` jak dziś, FULFILLED. **Nie** zmienia `inventory_id`/`home_inventory_id`; to robi `post_movement`. | `fulfill_reservation(db, id, acting)` = `_fulfill` + `post_movement` (typ z rezerwacji, jedna noga) + commit |

Nowe publiczne use case'y w tym samym pliku, eksportowane przez `service.py`:

- **`fulfill_exchange(db, reservation_ids: Sequence[int]) -> list[Reservation]`**
  - Wejście jest poprawne, gdy:
    - to 1 id typu LEND lub GIFT, albo
    - to 2 id typu SWAP, wzajemnie sparowane (`a.paired_reservation_id == b.id` i odwrotnie).

    Inne wejście daje `BusinessConflictException`.
  - Dla każdej nogi, w kolejności wejścia:
    - posiadacz jest liczony na świeżo (`_load_reservation_for_transition`);
    - rezerwacja PENDING przechodzi przez `_confirm(…, holder)`;
    - `_fulfill(…, holder, now)` zwraca nogę.

    Wszystkie nogi są budowane przed księgowaniem, więc projekcje są jeszcze niezmienione i każde „from” jest poprawne.
  - Następuje jedno `post_movement`: SWAP z 2 nogami albo LEND/GIFT z 1 nogą. Opis dla SWAP to `"SWAP: {X} ⇄ {Y}"`. `occurred_at = now`.
  - Na końcu **jeden** commit, refresh rezerwacji i zwrot w kolejności wejścia.
  - Autoryzacja: use case przyjmuje posiadacza jako aktora, tak jak dziś robi to groups, przekazując `resolve_current_holder_user_id`. Kontrolę tożsamości aktora wykonuje wołający (`confirm_race_rules._require_race_participant` w groups). Trzeba to opisać w docstringu.
- **`cancel_exchange(db, reservation_ids: Sequence[int]) -> list[Reservation]`**
  - Ta sama walidacja wejścia co wyżej.
  - Dla każdej nogi: `_cancel(…, holder)`.
  - Jeden commit.

### Bridge i groups

- `app/groups/infrastructure/circulation_bridge.py`:
  - dodać pass-through `fulfill_exchange` i `cancel_exchange`;
  - usunąć `fulfill_reservation` i `resolve_current_holder_user_id`, które po zmianie nie mają wołających w `app/` (`__all__` zaktualizować);
  - `confirm_reservation` i `cancel_reservation` zostają, bo korzystają z nich `take_item_listing`, `propose_swap`, `accept_swap_proposal`, `reject_swap_proposal` i `pledge_fulfillment`.
- `app/groups/application/term_item_listings.py`:
  - `confirm_transaction` (`:782-822`): gating `_resolve_transaction_reservations_for_action` i usuwanie `ItemListingPreference` (flush) zostają bez zmian. Pętlę per noga zastępuje jedno wywołanie `circulation_bridge.fulfill_exchange(db, [r.id for r in reservations])`. Zwraca rezerwację o `id == reservation_id`. Usunięcie preferencji jest teraz commitowane atomowo razem z wymianą.
  - `cancel_transaction` (`:825-848`): pętlę zastępuje jedno `circulation_bridge.cancel_exchange(...)`, więc wszystko idzie jednym commitem.
  - Docstringi obu funkcji zaktualizować (bez komentarzy w stylu changelog, zgodnie z `commenting.md`).

## Konta tworzone razem z inwentarzem (`application/inventory.py`)

- `create_inventory`: dodaje `Inventory`, flushuje, dodaje `Account(account_type=INVENTORY, inventory_id=inventory.id)` i robi istniejący jeden commit.
- `_get_or_create_inventory`: wewnątrz istniejącego `async with db.begin_nested()` dodaje inwentarz, flushuje, dodaje konto i flushuje.
  - Przy `IntegrityError` SAVEPOINT cofa jednocześnie inwentarz i konto.
  - Ponowny `find` zwraca wiersz zwycięzcy, którego konto powstało w jego transakcji.
  - Istniejący wzorzec (`inventory.py:37-63`) pozostaje bez zmian strukturalnych.
- Innych miejsc tworzenia `Inventory` nie ma (zweryfikowane grepem `Inventory(` w `app/`).

## Migracja `alembic/versions/0041_circulation_item_movement_ledger.py`

`revision = "0041"`, `down_revision = "0040"`. Helpery `_sequenced_id`/`_create_sequence`/`_own_sequence` nie są potrzebne, bo nie powstaje żadna nowa tabela ani sekwencja.

Docstring musi wyjaśniać świadome odstępstwo od reguły „Separate Schema and Data” (`migrations.md`). Użytkownik zdecydował o jednej migracji (scope-clarifications, Phase 5), bo aplikacja jest w fazie dev. Czyszczenie musi się odbyć przed zmianą schematu, żeby dodać kolumny NOT NULL do pustych tabel.

Instrukcje czyszczenia i seedu mają być stałymi modułowymi, np. `_WIPE_STATEMENTS` i `_SEED_ACCOUNTS_STATEMENTS` (krotki SQL), wykonywanymi w `upgrade()`. Test migracji odwołuje się do nich.

### Upgrade, krok 1: czyszczenie danych (kolejność zgodna z FK, dziecko przed rodzicem)

Tabele zależne ustalono z modeli (`app/*/models.py`) i migracji. „Luźne” oznacza wskaźnik cross-BC bez FK w DB.

| # | Instrukcja | Powiązanie z danymi circulation | Decyzja i uzasadnienie |
|---|---|---|---|
| 1 | `DELETE FROM circulation_entries` | FK → `circulation_transactions`, `accounts` | Usunąć: stara księga punktowa. |
| 2 | `DELETE FROM circulation_transactions` | | Usunąć. |
| 3 | `DELETE FROM accounts` | | Usunąć: konta punktowe, w tym seed `900-100` z 0005. |
| 4 | `DELETE FROM notifications WHERE reservation_id IS NOT NULL OR proposal_id IS NOT NULL OR kind IN ('PLEDGE_ITEM_REGISTERED','TERM_ITEM_LISTING_TAKEN','SWAP_PROPOSED','SWAP_ACCEPTED','SWAP_REJECTED','TERM_CONFIRMATION_NEEDED','TERM_ALREADY_RESOLVED')` | luźne `notifications.reservation_id` (0040) → reservations; luźne `notifications.proposal_id` (0032) → swap_proposals | **Usunąć, nie NULL-ować.** To powiadomienia-akcje o wymianach, których już nie ma. Po NULL-owaniu modal oczekujących akcji pokazywałby martwe wpisy. Powiadomienia innych rodzajów (pledge, needed item, join request) zostają. |
| 5 | `DELETE FROM outbox_entries WHERE event_type IN ('groups.term_ended_giveaway','groups.term_ended_swap')` | luźne `payload.reservation_id` / `payload.proposal_id` (`term_end_scan.py:116-168`) | Usunąć: nieprzetworzone zdarzenia utworzyłyby powiadomienia o skasowanych rezerwacjach. |
| 6 | `DELETE FROM giveaway_term_end_markers` | luźne `reservation_id` (0031) | Usunąć: znaczniki idempotencji skanu dla skasowanych rezerwacji. |
| 7 | `DELETE FROM swap_proposals` | luźne `listing_item_id`, `offered_item_id`, `proposer_reservation_id` (0031) | Usunąć: każda propozycja wskazuje itemy i rezerwację. |
| 8 | `DELETE FROM item_listing_preferences` | luźne `item_id` (0028) | Usunąć: preferencja dotyczy konkretnego itemu. |
| 9 | `UPDATE pledges SET resolved_reservation_id = NULL WHERE resolved_reservation_id IS NOT NULL` | luźne `pledges.resolved_reservation_id` (0003/0009) | **NULL, nie usuwać.** Pledge należy do potrzeb Terminu (groups), a nie do circulation. Precedens `0007:37`. `status` zostaje. Pledge CLAIMED wraca do stanu „zgłoszony, bez przedmiotu” i można go ponownie zrealizować. |
| 10 | `DELETE FROM reservations` | FK → `inventory_items`, samo-FK `paired_reservation_id` | Usunąć. Jedno `DELETE` wszystkich wierszy nie narusza samo-FK, bo sprawdzenie NO ACTION odbywa się na końcu instrukcji. |
| 11 | `DELETE FROM inventory_balances` | FK → `inventory_items` | Usunąć. |
| 12 | `DELETE FROM inventory_items` | FK → `inventories`, `products` | Usunąć. |

**Nie czyścimy:** `inventories` (decyzja użytkownika), `products`, `needed_items`, `terms`, `term_attendances` oraz grup i użytkowników.

### Upgrade, krok 2: schemat

- `accounts`:
  - drop `ix_accounts_owner_user_id`, `fk_accounts_owner_user_id_users` i `uq_accounts_code`;
  - drop kolumn `code`, `name` i `owner_user_id`;
  - add `inventory_id` BigInteger NULL, FK `fk_accounts_inventory_id_inventories` i UNIQUE `uq_accounts_inventory_id`;
  - add CHECK `ck_accounts_inventory_id_account_type`;
  - add unikalny indeks częściowy `uq_accounts_account_type_external` (`postgresql_where` `account_type = 'EXTERNAL'`);
  - `account_type` zostaje jako String(20), zmieniają się tylko wartości.
- `circulation_transactions`:
  - drop `transaction_date` i `is_posted`;
  - add `movement_type` String(20) NOT NULL i `occurred_at` TIMESTAMP NOT NULL.
- `circulation_entries`:
  - drop `amount`, `entry_side`, `description` i `entry_date`;
  - add `item_id` BigInteger NOT NULL z FK `fk_circulation_entries_item_id_inventory_items`;
  - add `quantity` Integer NOT NULL;
  - add `reservation_id` BigInteger NULL z FK `fk_circulation_entries_reservation_id_reservations`;
  - add indeks `ix_circulation_entries_item_id_transaction_id` na `(item_id, transaction_id)`.

### Upgrade, krok 3: seed kont

- `INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) VALUES (nextval('account_seq'), 'EXTERNAL', NULL, now(), now())`.
- `INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) SELECT nextval('account_seq'), 'INVENTORY', id, now(), now() FROM inventories`.

### Downgrade

Kroki w odwrotnej kolejności zależności:

1. `DELETE FROM circulation_entries`, `circulation_transactions` i `accounts`. Dane w nowym kształcie nie mają odpowiednika w starym.
2. `circulation_entries`:
   - drop indeksu `ix_circulation_entries_item_id_transaction_id`, obu nowych FK i kolumn `item_id`/`quantity`/`reservation_id`;
   - add `amount` Numeric(12,2) NOT NULL, `entry_side` String(10) NOT NULL, `description` String(500) NOT NULL i `entry_date` Date NOT NULL.
3. `circulation_transactions`:
   - drop `movement_type` i `occurred_at`;
   - add `transaction_date` Date NOT NULL i `is_posted` Boolean NOT NULL.
4. `accounts`:
   - drop indeksu częściowego, CHECK, UNIQUE, FK i kolumny `inventory_id`;
   - add `code` String(20) NOT NULL, `name` String(255) NOT NULL i `owner_user_id` BigInteger NULL;
   - odtworzyć `uq_accounts_code`, `fk_accounts_owner_user_id_users` i `ix_accounts_owner_user_id`.
5. Ponowny seed `900-100` (ta sama instrukcja co w `0005`), żeby kod z rewizji 0040 działał.
6. Wyczyszczone dane (itemy, rezerwacje, propozycje, preferencje, powiadomienia) **nie są odtwarzane**. To świadoma decyzja, do opisania w docstringu, z precedensem `0007.downgrade`.

Uruchomienie lokalne: `set -a; . ./.env; set +a` przed `uv run alembic upgrade head` w `src/backend`. Migrację trzeba zastosować do lokalnej bazy.

## API

### `GET /api/inventory-items/{item_id}/history` (nowy, `app/circulation/router.py`)

- **Autoryzacja**: `ReadPrincipal` (`READ`/`mcp:read`). Ścieżkę pokrywa istniejący wiersz 40 macierzy (`GET ^/api/inventory-items(/.*)?$`), więc macierz się nie zmienia. Każdy principal z READ widzi historię dowolnego itemu (decyzja `history-read-authorization`).
- **404**: tylko gdy wiersz `inventory_items` nie istnieje. Rzecz **usunięta** (soft delete) zwraca 200, a jej historia kończy się ruchem REMOVE. Dlatego endpoint sprawdza istnienie przez `repository.get_item`, a nie przez `application.get_item`, które zwraca 404 dla `deleted_at`.
- **Odpowiedź**: lista `ItemMovementResponse`, **od najstarszego**, sortowana po `(occurred_at, id)` transakcji.
  - `transaction_id: int`, `transaction_number: str`, `movement_type: MovementType`, `occurred_at: datetime`;
  - `reservation_id: int | None` (z zapisów tej nogi);
  - `from`: `ItemMovementSideResponse | None`. W Pydantic pole nazywa się `from_` z aliasem `"from"`, a odpowiedź jest serializowana po aliasie, jak domyślnie robi FastAPI.
  - `to`: `ItemMovementSideResponse | None`;
  - `null` oznacza EXTERNAL („świat zewnętrzny”): `from` dla REGISTER i `to` dla REMOVE.
- **`ItemMovementSideResponse`**: `inventory_id: int`, `inventory_type: InventoryType`, `owner_user_id: int`, `owner_display_name: str | None`.
  - `display_name` jest tani. Pochodzi z jednego LEFT JOIN do `user_profiles` po `account_user_id = inventories.owner_user_id`, a `uq_user_profiles_account_user_id` gwarantuje relację 1:1.
  - Join na poziomie zapytania do modelu innego modułu ma precedensy: `Product` w `circulation/infrastructure/repository.py:84-92` i `UserProfile` w `groups/infrastructure/repository.py:75`.
- **Zapytanie** (bez N+1): nowa `repository.list_item_movements(db, item_id)` jako **jedno** `select`.
  - Wychodzi od `CirculationTransaction`.
  - Dołącza dwa aliasy `CirculationEntry` dla tego `item_id`: wyjście (`quantity = -1`) i wejście (`quantity = +1`) z tej samej transakcji.
  - Dla każdej strony wykonuje LEFT JOIN `Account` → `Inventory` → `UserProfile`. EXTERNAL nie ma inwentarza, więc wychodzą NULL-e.
  - Wybiera tylko potrzebne kolumny i sortuje po `occurred_at, id`.
  - Mapowanie wierszy na schemat odbywa się w warstwie application albo router, tak jak `_item_response`.

### `GET /api/circulation-transactions/{transaction_id}` (nowy kształt odpowiedzi)

- Autoryzacja: `ReadPrincipal`, wiersz 45 (zawężony, patrz niżej). 404 przez istniejące `get_transaction`.
- `CirculationTransactionResponse` zawiera `id`, `transaction_number`, `movement_type`, `occurred_at`, `description` i `entries: list[CirculationEntryResponse]` (kolejność po `id`).
- `CirculationEntryResponse` zawiera `id`, `account_id`, `account_type` i `inventory_id: int | None`, `inventory_type: InventoryType | None`, `owner_user_id: int | None` (wszystkie trzy None dla EXTERNAL), a także `item_id`, `quantity` i `reservation_id: int | None`.
- `repository.find_transaction_with_entries` ładuje `selectinload(entries).joinedload(account).joinedload(Account.inventory)`, więc wszystko idzie jednym ładowaniem i bez N+1. Mapowanie jest jawne (płaskie pola z `entry.account.inventory`), bez `from_attributes` na zagnieżdżonym koncie.

### Usunięcia

- Router usuwa trasy `GET /api/accounts/{user_id}/balance` (`router.py:241`) i `GET /api/circulation-transactions` (lista, `router.py:252`) oraz sekcję „Accounts”. Docstring modułu nie wymienia już `/api/accounts`.
- `schemas.py` usuwa `AccountResponse` i `AccountBalanceResponse`, przepisuje `CirculationEntryResponse`/`CirculationTransactionResponse` i dodaje `ItemMovementResponse`/`ItemMovementSideResponse`. Docstring modułu też do aktualizacji.
- `app/core/authorization_matrix.py`:
  - **usunąć** wiersz 44 (`GET ^/api/accounts(/.*)?$`);
  - wiersz 45 zmienić na `GET ^/api/circulation-transactions/[^/]+$` (READ/mcp:read);
  - numeracji pozostałych wierszy w komentarzach nie zmieniamy, bo numery są przywoływane w innych dokumentach.

  Usunięte ścieżki trafiają do catch-all (AUTHENTICATED), a router zwraca 404.
- Frontend: usunąć `src/frontend/src/api/accounts.ts`. Nikt go nie importuje, co zweryfikowano grepem. Frontendowy build i typecheck muszą przejść.

## Komponenty do ponownego użycia

### Istniejący kod do wykorzystania

| Element | Ścieżka | Użycie |
|---|---|---|
| Get-or-create z SAVEPOINT + `IntegrityError` | `app/circulation/application/inventory.py:37-63` | Rozszerzyć o insert konta w tym samym `begin_nested()`. Bez nowego mechanizmu. |
| `_enum_column(native_enum=False)` | `app/circulation/models.py:31` | `AccountType` (nowe wartości) i `MovementType`. |
| `BaseEntity` (sekwencja, `updated_at` jako version col) | `app/core/base_model.py` | Wszystkie trzy encje bez zmian PK. Optimistic lock chroni przed równoległym ruchem itemu. |
| `_next_transaction_number()` | `app/circulation/domain/reservation_rules.py:44` | Numer transakcji ruchu. |
| `_load_reservation_for_transition`, `_current_holder_user_id` | `reservation_transitions.py:36`, `reservations.py:57` | Wyznaczanie posiadacza per noga w `fulfill_exchange`/`cancel_exchange`. |
| `_require_holder_to_confirm`, `_require_party_to_reservation` | `domain/reservation_rules.py:13-31` | Bez zmian, wołane z `_confirm`/`_cancel`/`_fulfill`. |
| Gałęzie typów w `fulfill_reservation` | `reservation_transitions.py:105-134` | Przenieść do `_fulfill`, zachowując mutacje `InventoryBalance`. Zmiana `inventory_id`/`home_inventory_id` przechodzi do `post_movement`. |
| `get_or_create_personal_inventory` / `get_or_create_virtual_inventory` | `application/inventory.py:66-77` | Cele GIFT/SWAP/LEND (konto powstaje razem z inwentarzem). |
| Flush-only infrastruktura, commit w application | `infrastructure/ledger.py`, `application/*` | `post_movement` flush-only, commity w wrapperach i use case'ach. |
| Wzorzec eager loadingu `find_transaction_with_entries` | `infrastructure/repository.py:142-150` | Rozszerzyć o `joinedload(Account.inventory)`. |
| Join na poziomie zapytania do modelu innego modułu | `repository.py:84-92` (`Product`), `groups/infrastructure/repository.py:75` (`UserProfile`) | Zapytanie historii z `display_name`. |
| Wspólny gating wymiany | `term_item_listings.py:698-779` `_resolve_transaction_reservations_for_action` | Bez zmian. Groups przekazuje wynik do `fulfill_exchange`/`cancel_exchange`. |
| Precedens czyszczenia danych i NULL-owania pledge | `alembic/versions/0007_circulation_product_cleanup_data.py` | Kolejność DELETE i `UPDATE pledges`. |
| Seed konta przez `nextval('account_seq')` | `alembic/versions/0005_seed_emission_account.py` | Seed EXTERNAL i kont inwentarzy, a w downgrade ponowny seed `900-100`. |
| Migracja uruchamiana w subprocessie | `tests/conftest.py:47-58` | Test migracji 0041 na osobnej bazie w tym samym kontenerze. |
| Helpery testów | `tests/test_circulation.py` (`_authed_headers`, `_create_item`, `_create_term`, `_lend_and_confirm`, `_user_id`), `tests/test_term_item_listings.py` (`_register`, `_register_personal_item`, `_principal`, `_create_circle_and_term`, `_rsvp`) | Nowe testy korzystają z tych samych konstrukcji danych. |

### Nowe komponenty i uzasadnienie

| Nowy element | Dlaczego nie da się użyć istniejącego |
|---|---|
| `MovementType` (enum) | Typ ruchu jest nowym pojęciem. `ReservationType` nie ma REGISTER ani REMOVE, a rezerwacja to nie ruch. |
| `MovementLeg` + `post_movement` (zastępuje `post_circulation`) | Stara funkcja księguje punkty bez itemu i bez inwentarzy. Nowa semantyka wymaga nóg from/to per item i aktualizacji projekcji. |
| `_confirm`/`_cancel`/`_fulfill` (wydzielone z istniejących funkcji) | Atomowy SWAP wymaga wariantów bez commita. To wydzielenie istniejącej logiki, a nie nowa logika. |
| `fulfill_exchange` / `cancel_exchange` + 2 pass-throughy w bridge | Brak use case'u, który obejmuje obie nogi jednym commitem. Groups nie może commitować ani importować encji circulation (reguła fasady i bridge). |
| `repository.list_item_movements`, `find_accounts_for_posting` | Brak zapytań po nowych kolumnach. Stare (`find_account_by_code`, `list_entries_for_account`, `list_transactions_for_account`) są usuwane. |
| Endpoint i schematy historii | Nowa funkcja (historia rzeczy), niewyrażalna dotychczasowymi schematami. |
| Migracja 0041 | Zmiana schematu i czyszczenie danych. |
| `tests/ledger_assertions.py` (helper testowy) | Asercja niezmiennika i odczyt ruchów itemu są potrzebne w co najmniej 3 plikach testów. Import z `conftest` byłby niezgodny z konwencją. |

Świadomie **nie** tworzymy:
- endpointu salda/wyciągu konta;
- relacji ORM `CirculationEntry.item`/`.reservation`;
- CHECK na `quantity` ani triggera;
- encji `Loan`;
- kolumny `actor_user_id`.

## Podejście techniczne

- **Warstwy**, zgodnie z DDD w circulation:
  - `models.py`: model;
  - `infrastructure/ledger.py`: księgowanie, walidacja i projekcja;
  - `infrastructure/repository.py`: zapytania;
  - `application/reservation_transitions.py`, `inventory_items.py` i `inventory.py`: punkty księgowania i commity;
  - nowy `application/movements.py`: odczyty `get_transaction` i `get_item_history`. Zastępuje `application/accounts.py`, który jest usuwany.
  - Fasada `service.py` eksportuje:
    - bez `get_account_balance` i `list_transactions_for_account`;
    - dodatkowo `get_item_history`, `fulfill_exchange` i `cancel_exchange`.

  Groups importuje wyłącznie przez `circulation_bridge` → `app.circulation.service`.
- **Przepływ danych**: use case czyta item, buduje nogi (from z projekcji), mutuje stan `Reservation`/`InventoryBalance`, woła `post_movement` (wpisy + projekcja), a na końcu wykonuje jeden commit.
- **Pojedyncza ścieżka mutacji lokalizacji**: po zmianie jedyne przypisania `item.inventory_id =`, `item.home_inventory_id =` i `item.deleted_at =` w `app/circulation/` są w `post_movement`. Wyjątkiem jest konstruktor `InventoryItem` w `register_item`. Należy to zweryfikować grepem w fazie weryfikacji.
- **Stałe**: `domain/constants.py` zostawia tylko `_DEFAULT_LEND_DAYS`, a docstring modułu trzeba zaktualizować.
- **Czas**: `datetime.utcnow()` jest używane tak jak w reszcie modułu. Ten sam `now` trafia do `InventoryBalance` i `occurred_at` w obrębie jednego use case'u.
- **Docstringi do przepisania** (opis stanu bieżącego, bez changelogu):
  - `models.py:1-16` i docstringi `Account`/`CirculationTransaction`/`CirculationEntry`;
  - `ledger.py:1-17`;
  - `service.py:1-12`;
  - `router.py:1-22`;
  - `schemas.py:1-5`;
  - `reservation_transitions.py:1-4`;
  - `reservation_rules._require_holder_to_confirm` (zdanie o „accounting always credits the holder”);
  - `circulation_bridge.py` (moduł i nowe pass-throughy).

## Wytyczne implementacyjne

### Podejście do testów

- **2-8 skupionych testów na grupę kroków implementacji.** Weryfikacja uruchamia tylko nowe i zmienione testy danej grupy. Pełny zestaw (`uv run pytest` w `src/backend`) uruchamiamy raz na końcu.
- Testy integracyjne: pytest + TestContainers Postgres 18 + httpx (`tests/conftest.py`), z izolacją per test przez SAVEPOINT. Nazwy według konwencji `test_<akcja>_<warunek>_<oczekiwanie>`.
- **Helper `tests/ledger_assertions.py`** (nowy):
  - `movements_for_item(db, item_id)`: lista transakcji z zapisami itemu, w kolejności `(occurred_at, id)`;
  - `assert_ledger_matches_projection(db, item_ids)`:
    - dla każdego itemu `SUM(quantity)` per konto: dokładnie jedno konto z +1, reszta 0;
    - dla żywego itemu konto z +1 jest kontem `item.inventory_id`, dla usuniętego jest nim EXTERNAL;
    - w każdej transakcji suma per item wynosi 0.

  Asercja jest zawężona do podanych itemów, bo niektóre istniejące testy celowo wymuszają „legacy” stan (`test_circulation.py:1010`, `:1046`).

Planowane grupy testów:

| Grupa | Plik | Testy (2-8) |
|---|---|---|
| Model + konta | `tests/test_circulation_ledger.py` (nowy) | `POST /api/inventories` tworzy konto INVENTORY; get-or-create PERSONAL/VIRTUAL tworzy konto, a przy wyścigu (IntegrityError) nie powstaje duplikat; istnieje dokładnie jedno EXTERNAL i brak `900-100` |
| REGISTER / REMOVE | jw. | rejestracja przez API daje transakcję REGISTER (EXTERNAL −1 / inwentarz +1, `reservation_id` NULL); rejestracja przez `fulfill_pledge` daje REGISTER; DELETE itemu daje REMOVE i `deleted_at`; DELETE itemu LENT zwraca 409 i nie tworzy nowej transakcji; `post_movement` z nieaktualnym `from` daje 409 |
| LEND / RETURN / GIFT i stany oczekujące | jw. | LEND: PERSONAL(A) −1 / VIRTUAL(B) +1 z `reservation_id` i `home_inventory_id`; RETURN: VIRTUAL(B) −1 / PERSONAL(A) +1 i `home` = NULL; GIFT przez `confirm_transaction`: PERSONAL(A) −1 / PERSONAL(B) +1; create/confirm/cancel rezerwacji i PATCH itemu nie dodają zapisów; `fulfill_reservation` dla SWAP daje 409; pełny cykl REGISTER → LEND → RETURN → GIFT → REMOVE spełnia `assert_ledger_matches_projection` na każdym etapie |
| Atomowy SWAP | `tests/test_term_item_listings.py` | `confirm_transaction` SWAP tworzy **jedną** transakcję SWAP z 4 zapisami, każda noga ma swój `reservation_id`, a oba itemy zamieniają się inwentarzami; awaria w nodze 2 (monkeypatch `reservation_transitions.get_or_create_personal_inventory` rzucający przy drugim wywołaniu), a po `db_session.rollback()` obie rezerwacje, oba itemy i preferencje są w stanie sprzed wywołania, bez transakcji; `cancel_transaction` SWAP anuluje obie nogi, a awaria przy nodze 2 zostawia nogę 1 nietkniętą; `circulation_bridge.fulfill_exchange` odrzuca niesparowane nogi (409) |
| API | `tests/test_circulation_ledger.py` + `tests/test_authorization_matrix.py` | historia: kolejność od najstarszego, `from = null` dla REGISTER, `to = null` dla REMOVE, `owner_display_name` wypełniony; historia usuniętego itemu zwraca 200 i kończy się REMOVE; nieistniejący item 404; bez tokenu 401; `GET /api/circulation-transactions/{id}` ma nowy kształt (4 zapisy dla SWAP, pola `inventory_*` = null dla EXTERNAL); `GET /api/accounts/{id}/balance` i `GET /api/circulation-transactions?account_id=` zwracają 404; `resolve_requirement` dla `/api/inventory-items/1/history` daje READ, a dla `/api/circulation-transactions/1` daje READ |
| Migracja 0041 | `tests/test_migration_0041.py` (nowy) | Na **osobnej bazie** w kontenerze z sesji (`CREATE DATABASE` przez połączenie AUTOCOMMIT, alembic w subprocessie jak w `conftest.py`): `upgrade 0040`, potem seed SQL (inwentarz, item, balance, rezerwacja, preferencja, swap proposal, marker, notyfikacja z `reservation_id`, outbox `groups.term_ended_giveaway`, pledge z `resolved_reservation_id`), potem `upgrade head`. Asercje: tabele wyczyszczone według tabeli z kroku 1, pledge ma NULL, inwentarz przetrwał, jest 1 EXTERNAL i po 1 koncie INVENTORY na każdy inwentarz. Następnie `downgrade 0040` (istnieje `accounts.code`, jest seed `900-100`) i ponownie `upgrade head` bez błędu. |

Przepisanie istniejących testów:
- `tests/test_circulation.py:490` `test_fulfillLend_postsCirculationTransactionCreditingOwner` → `test_fulfillLend_postsLendMovementFromPersonalToVirtual` (asercje na zapisach, bez `/api/accounts`).
- `tests/test_circulation.py:578` (bridge `fulfill_reservation`) → test `circulation_bridge.fulfill_exchange` dla pojedynczej nogi LEND.
- `tests/test_term_item_listings.py`:
  - `:136-170`: helper `_latest_ledger_entries_for_giver` zastąpić importem `movements_for_item` z `tests/ledger_assertions.py`;
  - importy `Account`, `EntrySide` usunąć;
  - `:1659` (GIFT): jedna transakcja GIFT, 2 zapisy −1/+1 na kontach PERSONAL(lister)/PERSONAL(taker), `reservation_id` i nazwa produktu w `description`;
  - `:1710` (SWAP): **jedna** transakcja SWAP z 4 zapisami, zamiast asercji „dwie różne transakcje”;
  - pozostałe audyty księgi w rejonie `:1571-1770` dostosować analogicznie.
- Testy `GET /api/inventory-items/{id}/balance` (`:1852-2037`) to saldo **statusu** `InventoryBalance`, a nie konta. **Zostają bez zmian.**
- Istniejące testy, które przenoszą rzeczy (`test_circulation.py:332`, `:366`, `:741`; `test_lend_step0_fixes.py`; `test_pledge_fulfillment.py`; `test_term_item_listings.py:642`), muszą przejść bez zmian w asercjach.

### Zgodność ze standardami

- `standards/backend/models.md`: `BaseEntity` z jawną sekwencją; StrEnum przez `_enum_column(native_enum=False)` (nigdy ordinal); `lazy="raise"` z jawnym `selectinload`/`joinedload`; `__eq__`/`__hash__` po kluczu biznesowym (`Account`: `(account_type, inventory_id)`, transakcja: `transaction_number`); referencje do innych modułów tylko jako joiny na poziomie zapytania, bez `relationship()`; brak relacji bez konsumenta.
- `standards/backend/migrations.md`:
  - działający `downgrade` w odwrotnej kolejności zależności;
  - nazwy `fk_/uq_/ix_/ck_` według konwencji;
  - brak nowych sekwencji.
  - **Udokumentowane odstępstwo** od „Separate Schema and Data”. Wynika z decyzji użytkownika o jednej migracji (faza dev), a kolejność „czyszczenie przed zmianą schematu” jest technicznie wymagana dla kolumn NOT NULL.
- `standards/backend/queries.md`: historia jako jedno zapytanie z joinami (bez N+1), wybór tylko potrzebnych kolumn, indeks `(item_id, transaction_id)` pod filtr historii, wszystkie operacje jednego use case'u w jednej transakcji DB.
- `standards/backend/api.md`: zasoby w liczbie mnogiej, zagnieżdżenie ≤ 2 poziomy (`/inventory-items/{id}/history`), kody 200/401/404/409.
- `standards/backend/security.md`: autoryzacja przez `Depends(require_any("READ", "mcp:read"))`; macierz `AUTHORIZATION_MATRIX` zaktualizowana (wiersz 44 usunięty, 45 zawężony, 40 bez zmian).
- `standards/global/minimal-implementation.md`: usunięcie całego kodu punktowego, pass-throughów bez wołających (`fulfill_reservation`, `resolve_current_holder_user_id` w bridge) i nieużywanego FE `accounts.ts`; brak speculative API (wyciąg konta, `Loan`).
- `standards/global/error-handling.md`: typowane wyjątki (`BusinessConflictException` dla naruszeń reguł ruchu, `EntityNotFoundException` dla brakującego itemu lub konta) i fail-fast walidacja nóg przed jakimkolwiek zapisem.
- `standards/global/commenting.md`: docstringi opisują stan bieżący, bez komentarzy w stylu changelog.
- `standards/testing/backend-testing.md`: testy integracyjne na prawdziwym Postgres 18, każdy test tworzy własne dane, 2-8 testów na grupę. Faktyczny stack to pytest + httpx (nie MockMvc).

## Dokumentacja

- `docs/system-wypozyczalni-inventory-accounting.md`:
  - zmienić tytuł na księgę ruchów;
  - w §1 zastąpić „CirculationTransaction (Transakcja punktowa)” i „Konta punktowe” opisem kont inwentarzy + EXTERNAL, typów ruchu i zapisu ±1;
  - w §2 przykłady kroków przepisać na zapisy ruchów (LEND: PERSONAL(A) −1 / VIRTUAL(B) +1, RETURN, SWAP jako jedna transakcja z 4 zapisami, GIFT, rejestracja i usunięcie);
  - w §3 opisać, że transakcja powstaje przy REGISTER, fulfill i REMOVE, a nigdy przy stanach oczekujących;
  - §4 zaktualizować;
  - **usunąć** §6 (wartość punktowa na przyszłość).
- `.maister/docs/project/architecture.md`: krótki akapit o vertical `circulation`. Ma opisać append-only księgę ruchów (konto = inwentarz + EXTERNAL), `post_movement` jako jedyną ścieżkę zmiany lokalizacji, projekcję `inventory_id`/`home_inventory_id` w tym samym commicie i atomową wymianę przez `fulfill_exchange`.
- Po implementacji warto zaproponować użytkownikowi standard: „append-only ledger + projekcja aktualizowana w tej samej transakcji; mutacja lokalizacji wyłącznie przez funkcję ruchu”. Dodanie go wymaga zgody (`/maister:standards-update`).

## Poza zakresem

- UI historii rzeczy (widok, hook TanStack Query, moduł `src/frontend/src/api/itemHistory.ts`).
- Encja `Loan`, przedłużenia, recall i przypomnienia. Historia `due_date` (migawka terminu) też nie wchodzi w zakres.
- Logowanie zmian PATCH `condition`/`product_id` (typ ADJUST lub osobny log).
- Usunięcie kolumny `inventory_id` i liczenie lokalizacji wyłącznie z księgi (opcja B).
- Ujednolicenie zegara UTC i czasu lokalnego w całej aplikacji (`utcnow` vs `now`, `timestamptz`).
- Kontrole właścicielskie na pozostałych GET-ach, w tym na nowej historii (dostęp ma każdy principal z READ).
- Endpoint wyciągu i salda konta inwentarza.
- CHECK `quantity IN (-1, 1)` i trigger bilansu.
- Bilans otwarcia, typ OPENING i backfill historii z istniejących rezerwacji. Dane są czyszczone.
- Zmiany w przepływach create/confirm rezerwacji w `take_item_listing`, `propose_swap`, `accept_swap_proposal`, `reject_swap_proposal` i `pledge_fulfillment` (ich pośrednie commity zostają).

## Kryteria sukcesu

1. `uv run pytest` w `src/backend` przechodzi w całości, łącznie z nowymi testami ledger, SWAP, API, macierzy i migracji.
2. Dla każdego typu ruchu (REGISTER, REMOVE, LEND, RETURN, GIFT, SWAP) powstaje dokładnie jedna transakcja, której zapisy mają poprawne konta, `item_id`, `quantity` i `reservation_id`, zgodnie z tabelą „Punkty księgowania”.
3. `assert_ledger_matches_projection` przechodzi po każdym kroku pełnego cyklu życia itemu i po wymianie SWAP.
4. SWAP to zawsze jedna transakcja z 4 zapisami. Wymuszona awaria drugiej nogi nie zostawia żadnych zmian (rezerwacje, itemy, preferencje, księga). Anulowanie SWAP to jeden commit.
5. Create, confirm i cancel rezerwacji oraz PATCH itemu nie tworzą zapisów.
6. `GET /api/inventory-items/{id}/history` zwraca pełną historię od najstarszego jednym zapytaniem SQL, z `null` dla strony EXTERNAL, także dla rzeczy usuniętej.
7. `GET /api/accounts/{id}/balance` i lista `GET /api/circulation-transactions` nie istnieją (404). `GET /api/circulation-transactions/{id}` zwraca nowy kształt. W kodzie backendu i FE nie ma żadnych odwołań do punktów (`900-100`, `100-`, `EntrySide`, `_POSTED_AMOUNT`, `api/accounts.ts`).
8. `alembic upgrade head` na lokalnej bazie (z załadowanym `.env`) przechodzi. Potem `alembic downgrade 0040` i ponowne `upgrade head` też przechodzą. Po upgrade istnieje 1 konto EXTERNAL i po 1 koncie na każdy inwentarz.
9. Grep potwierdza, że przypisania `inventory_id`/`home_inventory_id`/`deleted_at` itemu występują wyłącznie w `post_movement` (oraz w konstruktorze w `register_item`).
10. Build i typecheck frontendu przechodzą po usunięciu `accounts.ts`. Dokumenty z sekcji „Dokumentacja” są zaktualizowane.

## Założenia i znane ograniczenia

- **Założenie A1**: `confirm_transaction` korzysta z `fulfill_exchange` także dla LEND i GIFT, nie tylko dla SWAP. Daje to jedną ścieżkę kodu i jeden commit dla confirm + fulfill. Wymagania na to pozwalają („dla LEND/GIFT istniejące zachowanie może zostać”), a zmiana jest nadzbiorem wymaganej atomowości.
- **Założenie A2**: `fulfill_exchange` i `cancel_exchange` przyjmują bieżącego posiadacza jako aktora. Tożsamość wołającego weryfikuje groups (`_require_race_participant`). To poziom bezpieczeństwa identyczny z dzisiejszym, bo groups już dziś przekazuje posiadacza jako `acting_user_id`.
- **Założenie A3**: REGISTER tworzy item z `inventory_id` docelowym w konstruktorze (NOT NULL), a `post_movement` jest wtedy no-opem projekcji. Nie jest to „przeniesienie” poza funkcją ruchu.
- **Założenie A4**: RETURN bez `home_inventory_id` daje teraz 409 zamiast cichego no-opu, a fulfill pojedynczej nogi SWAP daje 409. Obie ścieżki są dziś nieosiągalne z UI.
- **Ograniczenie L1**: `occurred_at` to naiwny UTC (`utcnow`), spójnie z resztą modelu. Porównania z czasem lokalnym Terminów pozostają osobnym zadaniem.
- **Ograniczenie L2**: migracja 0041 kasuje wszystkie itemy, rezerwacje i powiązane wymiany na lokalnej bazie, a downgrade ich nie przywraca. Zostają inwentarze, pledge (bez rezerwacji) i powiadomienia niezwiązane z wymianą. To zgodne z decyzją użytkownika.
- **Ograniczenie L3**: pełne „dokładnie jedno EXTERNAL” zapewniają indeks częściowy (co najwyżej jedno) i seed w 0041 (co najmniej jedno). Nie ma ograniczenia DB zabraniającego usunięcia tego wiersza, ale nie istnieje też kod, który by go usuwał.
