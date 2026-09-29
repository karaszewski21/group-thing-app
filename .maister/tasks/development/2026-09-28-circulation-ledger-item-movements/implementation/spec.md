# Specyfikacja: księga ruchów przedmiotów w `app.circulation` („księgowanie produktów”)

Ścieżki kodu są podane względem `src/backend/`, chyba że zaznaczono inaczej. Wymagania wiążące pochodzą z `analysis/requirements.md`, `analysis/scope-clarifications.md`, `analysis/clarifications.md` oraz z decyzji po audycie `verification/spec-audit-decisions.md`. Numery linii podano według `HEAD` `23a5dd8` („id -> uuid”) i mogą się nieznacznie przesunąć.

## Zmiany po audycie

Spec zrewidowano po audycie `verification/spec-audit.md` zgodnie z decyzjami w `verification/spec-audit-decisions.md`:

- **C1, najpierw UUID.** Bazą jest stan po konwersji PK na UUID (`app/core/base_model.py`, `alembic/versions/0041_baseentity_id_uuid.py`). Wszystkie PK/FK to `postgresql.UUID(as_uuid=True)`, typy w sygnaturach i schematach to `uuid.UUID`, a sekwencji nie ma. Migracja księgi to **0042** z `down_revision = "0041"`. Downgrade nie seeduje ponownie `900-100`. Doszedł warunek wstępny implementacji (sekcja niżej).
- **H1.** `fulfill_exchange` / `cancel_exchange` przyjmują `acting_user_id` i zwracają 403 (`AccessDeniedException`), gdy aktor nie jest ani `giver_user_id`, ani `reserved_by_user_id` żadnej nogi. Dodano testy.
- **H2.** `post_movement(SWAP)` wymaga krzyżowania PERSONAL ↔ PERSONAL: X z PERSONAL(A) do PERSONAL(B), Y z PERSONAL(B) do PERSONAL(A), A ≠ B, X ≠ Y. Dodano testy.
- **M3.** Migracja 0042 usuwa **całą** tabelę `pledges` razem z powiadomieniami `PLEDGE_*` i zdarzeniami outbox `groups.pledge_*`. Krok „`resolved_reservation_id = NULL`” usunięto. FK i luźne wskaźniki do `pledges` są wyliczone.
- **L4.** CHECK kształtu konta i indeks częściowy dla EXTERNAL zostają, co potwierdził użytkownik. Nadal nie ma CHECK ani triggera na sumę transakcji.
- **M4.** Ciężki test migracji (osobna baza, wiele przebiegów Alembica) zastąpiono lekkim: `alembic upgrade head` w `conftest` plus test „dokładnie jedno EXTERNAL, konto dla każdego inwentarza”. Downgrade jest sprawdzany ręcznie (sekcja „Weryfikacja ręczna”).
- **M1**: join do `UserProfile` jest zapisany jako akceptowany wyjątek od reguły fasady. **M2**: sprawdzenie `from` jest tylko defensywne, a współbieżność zabezpiecza `version_id_col` → `StaleDataError` → 409. **M5**: kontrakt commita między modułami trafia do docstringów, a test sprawdza usunięcie preferencji po sukcesie. **M6**: dodano zdanie o pośrednich commitach poza zakresem.
- **Korekta niezmiennika (po G2, zgoda użytkownika)**: w zbilansowanej księdze EXTERNAL trwale trzyma −1 każdego żywego itemu (REGISTER), więc niezmiennik sprawdza +1 wśród kont INVENTORY, a EXTERNAL osobno (−1 dla żywego, 0 dla usuniętego). Dawne „pozostałe konta 0” i „usunięty ma +1 na EXTERNAL” były sprzeczne z bilansem transakcji.
- **L1-L9**: poprawiono opis czyszczenia powiadomień (L1), listę konsumentów `confirm_reservation` (L2), kryterium „jednym zapytaniem” (L3), uzasadnienie wiersza 45 (L5), punkt wstrzyknięcia awarii dla `cancel_exchange` (L6), `populate_by_name` dla `from_` (L7), race dwóch stron (L8) i importy bridge'a (L9).

## Warunek wstępny implementacji

- Implementację zaczynamy dopiero wtedy, gdy konwersja PK → UUID jest **skomitowana**, a drzewo robocze jest czyste w plikach, których dotyczy to zadanie.
- Stan w chwili rewizji spec: warunek jest spełniony. UUID jest w commicie `23a5dd8`, a `git status` jest czysty. Implementator sprawdza to ponownie przed startem (`git status`, `alembic heads` zwraca pojedyncze `0041`).
- Konwencje bazowe po UUID, do których stosuje się ten spec:
  - `BaseEntity.id`: `postgresql.UUID(as_uuid=True)`, `primary_key=True`, `default=uuid.uuid4`, `server_default=gen_random_uuid()`. Brak `__sequence_name__` i brak sekwencji.
  - Kolumny FK i luźne wskaźniki: `postgresql.UUID(as_uuid=True)`, tak jak w obecnym `app/circulation/models.py`.
  - `0041` wyczyściło wszystkie tabele `BaseEntity`, w tym `accounts` (seed `900-100` z `0005` nie został odtworzony), i usunęło wszystkie sekwencje (`OBSOLETE_SEQUENCES`). `0041.downgrade` jest nieodwracalny (`NotImplementedError`).

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
   - Tabela `accounts` dostaje `inventory_id` (UUID, UNIQUE, FK `inventories.id`, NULL tylko dla konta systemowego) i `account_type` ∈ {INVENTORY, EXTERNAL}.
   - W systemie istnieje dokładnie jedno konto EXTERNAL („świat zewnętrzny”).
   - Każdy `Inventory` (każdy `InventoryType`) ma dokładnie jedno konto INVENTORY, tworzone razem z inwentarzem.
3. **Transakcja** ma pola `movement_type` ∈ {REGISTER, REMOVE, GIFT, LEND, RETURN, SWAP} (6 typów, **bez OPENING**), `occurred_at` (DateTime, pełny czas), `transaction_number` oraz `description`. Nie ma FK do użytkowników. Porządek chronologiczny wyznacza para `(occurred_at, id)`. PK jest losowym UUID, więc `id` rozstrzyga tylko remisy deterministycznie, bez znaczenia chronologicznego.
4. **Zapis** ma pola `account_id`, `item_id` (UUID, FK `inventory_items.id`), `quantity` (−1 albo +1) i `reservation_id` (UUID, nullable FK `reservations.id`, ustawiany per noga). Kolumny `entry_side`, `amount`, `description` i `entry_date` znikają.
5. **Funkcja księgowania `post_movement`** jest jedynym sposobem przeniesienia rzeczy:
   - waliduje bilans (suma `quantity` per item w transakcji = 0) i reguły kształtu nóg, w tym krzyżowanie PERSONAL ↔ PERSONAL dla SWAP;
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
   - Oba use case'y same sprawdzają, czy aktor jest stroną wymiany (403 w przeciwnym razie).
9. **Konto tworzone razem z inwentarzem** w `create_inventory` i `_get_or_create_inventory` (w tym samym SAVEPOINT co insert inwentarza).
10. **Migracja 0042** (jedna rewizja, `down_revision = "0041"`) wykonuje kolejno:
    - czyści dane circulation, wszystkie pledge i wiersze od nich zależne;
    - zmienia schemat 3 tabel księgi;
    - tworzy konto EXTERNAL i po jednym koncie na każdy istniejący inwentarz (id przez `gen_random_uuid()`).

    Downgrade działa: przywraca schemat punktowy na typach UUID, bez ponownego seedu `900-100`.
11. **Nowe API odczytu (tylko backend):**
    - `GET /api/inventory-items/{id}/history`;
    - nowy kształt `GET /api/circulation-transactions/{id}`.
12. **Usunięcie API punktów:**
    - `GET /api/accounts/{user_id}/balance` i `GET /api/circulation-transactions?account_id=` znikają;
    - w `app/core/authorization_matrix.py` usuwamy wiersz 44, a wiersz 45 zawężamy;
    - usuwamy plik FE `src/frontend/src/api/accounts.ts`.
13. **Niezmiennik** sprawdzany testami:
    - wśród kont INVENTORY żywy item ma saldo +1 wyłącznie na koncie `item.inventory_id`, a na pozostałych kontach INVENTORY saldo 0; item usunięty (soft delete) ma saldo 0 na wszystkich kontach INVENTORY;
    - saldo itemu na koncie EXTERNAL wynosi −1 dla żywego itemu (REGISTER) i 0 dla usuniętego (REGISTER −1, REMOVE +1);
    - każda transakcja sumuje się do 0 per item.
14. **Stan pożyczki** (`InventoryBalance.status`, `lent_at`, `due_date`) zostaje bez zmian semantyki. To stan, a nie ruch.
15. **Dokumentacja:** przepisać `docs/system-wypozyczalni-inventory-accounting.md`, zaktualizować docstringi modułów i dopisać krótki akapit w `.maister/docs/project/architecture.md`.

## Model danych

Wszystkie trzy encje dziedziczą po `BaseEntity` bez zmian: PK UUID (`default=uuid.uuid4`, `server_default=gen_random_uuid()`), `created_at` oraz `updated_at` jako `version_id_col`. Nie ma `__sequence_name__` ani sekwencji.

### Enumy (`app/circulation/models.py`)

| Enum | Wartości | Uwagi |
|---|---|---|
| `AccountType` | `INVENTORY`, `EXTERNAL` | Zastępuje `USER_BALANCE`/`SYSTEM_EMISSION`. |
| `MovementType` (nowy) | `REGISTER`, `REMOVE`, `GIFT`, `LEND`, `RETURN`, `SWAP` | Wartości LEND/RETURN/GIFT/SWAP są identyczne z `ReservationType`, więc typ ruchu przy fulfill to `MovementType(reservation.reservation_type.value)`. |
| `EntrySide` | usunięty | |

Oba enumy są zapisywane jako VARCHAR przez istniejący helper `_enum_column(..., native_enum=False)` (`models.py:34`), z długością 20.

### `Account` (tabela `accounts`)

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | UUID z `BaseEntity` | PK |
| `account_type` | String(20) (`AccountType`) | NOT NULL |
| `inventory_id` | `postgresql.UUID(as_uuid=True)`, `Mapped[uuid.UUID \| None]` | NULL tylko dla EXTERNAL; FK `fk_accounts_inventory_id_inventories`; UNIQUE `uq_accounts_inventory_id` |
| `created_at`, `updated_at` | z `BaseEntity` | |

Ograniczenia dodatkowe (zachowane decyzją użytkownika po audycie, L4):
- `ck_accounts_inventory_id_account_type`: CHECK, że (`account_type = 'INVENTORY'` i `inventory_id IS NOT NULL`) albo (`account_type = 'EXTERNAL'` i `inventory_id IS NULL`). Gwarantuje to kształt konta na poziomie DB.
- `uq_accounts_account_type_external`: unikalny indeks częściowy na `account_type` z warunkiem `WHERE account_type = 'EXTERNAL'`. Wymusza „co najwyżej jedno EXTERNAL”. Istnienie tego konta zapewnia seed w 0042.
- Nadal **nie ma** CHECK ani triggera na sumę transakcji ani na `quantity`. Bilans pilnuje `post_movement`.

Kolumny **usuwane**, z uzasadnieniem:
- `code`: kod planu kont (`100-…`/`900-100`) miał sens tylko dla punktów. Tożsamość konta to teraz `inventory_id`, a dla EXTERNAL `account_type`.
- `name`: stała etykieta bez żadnego konsumenta. Opis wynika z typu i inwentarza.
- `owner_user_id`: właściciel jest wyprowadzalny przez `inventories.owner_user_id`. Kopia wymagałaby synchronizacji i łamałaby zasadę „strony z kont → inventory → owner”.

Razem z nimi znikają `uq_accounts_code`, `fk_accounts_owner_user_id_users` i `ix_accounts_owner_user_id`.

Pozostałe elementy modelu:
- Relacja `Account.inventory` do `Inventory` z `lazy="raise"` (ten sam moduł, więc dozwolona). Potrzebna do `GET /api/circulation-transactions/{id}` oraz do walidacji SWAP w `post_movement` (typ i właściciel inwentarza).
- `__eq__`/`__hash__` po kluczu biznesowym `(account_type, inventory_id)` zamiast `code`.

### `CirculationTransaction` (tabela `circulation_transactions`)

| Kolumna | Typ | Uwagi |
|---|---|---|
| `transaction_number` | String(50), UNIQUE (`uq_circulation_transactions_transaction_number`, bez zmian) | Nadal `TRX-<12 hex>` z `_next_transaction_number()` (`domain/reservation_rules.py:44`). Pozostaje kluczem biznesowym `__eq__`/`__hash__`. |
| `movement_type` | String(20) (`MovementType`) | NOT NULL, nowa |
| `occurred_at` | DateTime() (naiwny UTC, jak reszta modelu) | NOT NULL, nowa. Zastępuje `transaction_date: Date`. |
| `description` | String(500) | NOT NULL, bez zmian. Tekst `"{TYPE}: {nazwa produktu}"`, a dla SWAP `"SWAP: {X} ⇄ {Y}"`. |
| `transaction_date`, `is_posted` | usuwane | Księga jest append-only, nie ma szkiców, więc `is_posted` traci znaczenie. |

Relacja `entries` zostaje (`lazy="raise"`) i dostaje `order_by` po `CirculationEntry.id`. Przy UUID nie oznacza to kolejności wstawiania, tylko deterministyczną kolejność odczytu. Kolejność semantyczną (−1 przed +1, noga przed nogą) odtwarza się z `item_id`/`quantity`.

### `CirculationEntry` (tabela `circulation_entries`)

| Kolumna | Typ | Uwagi |
|---|---|---|
| `transaction_id` | UUID, bez zmian | FK i indeks `ix_circulation_entries_transaction_id` zostają |
| `account_id` | UUID, bez zmian | FK i indeks `ix_circulation_entries_account_id` zostają (saldo konta) |
| `item_id` | `postgresql.UUID(as_uuid=True)` NOT NULL, `Mapped[uuid.UUID]` | FK `fk_circulation_entries_item_id_inventory_items` |
| `quantity` | Integer NOT NULL | −1 lub +1. **Bez CHECK** (decyzja użytkownika). Walidacja odbywa się w `post_movement`. |
| `reservation_id` | `postgresql.UUID(as_uuid=True)` NULL, `Mapped[uuid.UUID \| None]` | FK `fk_circulation_entries_reservation_id_reservations`. NULL dla REGISTER/REMOVE, dla SWAP ustawiany per noga. |
| `amount`, `entry_side`, `description`, `entry_date` | usuwane | |

Indeksy:
- **Nowy** `ix_circulation_entries_item_id_transaction_id` na `(item_id, transaction_id)`. Obsługuje zapytanie historii: filtr po `item_id` i złączenie z transakcją.
- `reservation_id` nie dostaje indeksu. Żadne zapytanie po nim nie filtruje, a rezerwacje nigdy nie są usuwane, więc FK nie potrzebuje indeksu do kaskadowego sprawdzania. Tak samo postąpiono z `notifications.reservation_id` w 0040.

Relacje: `transaction` i `account` zostają (`lazy="raise"`). Relacji do `InventoryItem` ani `Reservation` nie dodajemy, bo nikt z nich nie korzysta (YAGNI, `models.md`).

## Funkcja księgowania (`app/circulation/infrastructure/ledger.py`, przepisana)

### Kontrakt

- Nowy frozen dataclass `MovementLeg` w `ledger.py` z polami:
  - `item: InventoryItem`;
  - `from_inventory_id: uuid.UUID | None`, gdzie None oznacza EXTERNAL;
  - `to_inventory_id: uuid.UUID | None`, gdzie None oznacza EXTERNAL;
  - `reservation_id: uuid.UUID | None`.
- Sygnatura: `post_movement(db, *, movement_type: MovementType, legs: Sequence[MovementLeg], description: str, occurred_at: datetime) -> CirculationTransaction`.
- Funkcja tylko flushuje. Commit należy do wołającego use case'u w `application/`, zgodnie z istniejącym wzorcem flush-only w infrastrukturze.

### Kiedy odczytywane jest „from”

- `from_inventory_id` zawsze odczytuje **wołający**, z bieżącej projekcji `item.inventory_id`. Robi to przy budowaniu nogi, **przed** wywołaniem `post_movement`, i jest to stan sprzed jakiejkolwiek mutacji.
- Ponieważ tylko `post_movement` mutuje `inventory_id`/`home_inventory_id`, każda noga zbudowana przed księgowaniem widzi prawidłowe „from”. Dotyczy to także obu nóg SWAP, które są budowane przed jednym wspólnym wywołaniem.
- `post_movement` dodatkowo sprawdza, że dla nogi z `from_inventory_id is not None` zachodzi `item.inventory_id == from_inventory_id`. Niezgodność daje `BusinessConflictException` (409). To **wyłącznie asercja defensywna** przed błędem wołającego (np. ręcznie zbudowana noga albo dwie nogi tego samego itemu), a nie ochrona przed współbieżnością. Wołający czyta `from` z tego samego obiektu w tej samej sesji, więc przy poprawnym kodzie warunek nie może być fałszywy.

### Walidacja (przed jakimkolwiek zapisem)

Naruszenie reguł biznesowych daje `BusinessConflictException` (409). Niezbilansowanie to błąd programistyczny i daje `ValueError`.

1. Liczba nóg: SWAP wymaga dokładnie 2 nóg z różnymi itemami (X ≠ Y), każdy inny typ dokładnie 1 nogi.
2. Kształt nogi:
   - REGISTER: `from` = None, `to` ≠ None;
   - REMOVE: `from` ≠ None, `to` = None;
   - pozostałe typy: oba ≠ None oraz `from` ≠ `to`.
3. Item nie jest usunięty (`deleted_at IS NULL`).
4. Spójność z projekcją (asercja defensywna, patrz wyżej):
   - dla `from` ≠ None: `item.inventory_id == from`;
   - RETURN: `item.home_inventory_id == to`;
   - LEND, GIFT, SWAP i REMOVE: `item.home_inventory_id IS NULL` (rzeczy pożyczonej nie można dalej przekazać ani usunąć).
5. **Krzyżowanie SWAP (PERSONAL ↔ PERSONAL)**, sprawdzane po odczycie kont i ich inwentarzy (krok 1 poniżej), ale przed jakimkolwiek zapisem. Dla nóg X i Y:
   - wszystkie cztery strony to inwentarze typu `PERSONAL`;
   - `X.from == Y.to` (PERSONAL(A)) i `X.to == Y.from` (PERSONAL(B));
   - właściciele są różni: `owner_user_id` PERSONAL(A) ≠ `owner_user_id` PERSONAL(B).

   Każde inne ułożenie daje 409: dwie niezależne przeprowadzki A→B i C→D, strona VIRTUAL albo PICKUP_POINT, ten sam właściciel po obu stronach. Warunek A ≠ B wynika już z unikalności PERSONAL per właściciel (`uq_inventories_owner_type_personal_virtual`, 0033) i `from ≠ to`, ale jest sprawdzany jawnie, bo to jedno tanie porównanie.
6. Po zbudowaniu listy zapisów: suma `quantity` per `item_id` = 0. Przy budowie z nóg zachodzi to z konstrukcji, ale sprawdzenie jest jawne, zgodnie z wymaganiem „funkcja odrzuca niezbilansowaną transakcję”.

### Kroki

1. Rozwiązuje konta **jednym zapytaniem**: konta INVENTORY dla zbioru `from`/`to` wszystkich nóg (z `joinedload(Account.inventory)`, potrzebne do reguły 5) oraz EXTERNAL, jeśli któraś strona jest None. Brak konta daje `EntityNotFoundException("Account", …)`. Przy poprawnym działaniu to niemożliwe, bo konto powstaje razem z inwentarzem.
2. Wykonuje walidację 5 (SWAP), a potem tworzy `CirculationTransaction` (`transaction_number` z `_next_transaction_number()`, `movement_type`, `occurred_at`, `description`) i flushuje ją. `id` nadaje `uuid.uuid4` po stronie Pythona.
3. Dla każdej nogi tworzy dwa zapisy: −1 na koncie „from”, +1 na koncie „to”. Oba mają `item_id` nogi i `reservation_id` nogi.
4. Aktualizuje projekcję per noga:
   - `to` ≠ None: `item.inventory_id = to`;
   - `to` = None (REMOVE): `item.deleted_at = occurred_at`, a `inventory_id` zostaje jako ostatnia lokalizacja, bo kolumna jest NOT NULL;
   - LEND: `item.home_inventory_id = from`;
   - RETURN: `item.home_inventory_id = None`.
5. Flushuje i zwraca transakcję.

### Współbieżność

- Faktyczną ochronę przed równoległym ruchem tego samego itemu daje optimistic locking z `BaseEntity`: `version_id_col = updated_at` z `_version_timestamp`. Mutacja projekcji generuje `UPDATE inventory_items … WHERE id = :id AND updated_at = :old`. Drugi, równoległy ruch aktualizuje 0 wierszy, co daje `StaleDataError`, który istniejący handler (`app/core/errors.py:88`, rejestracja `:138`) zamienia na 409.
- Działa to dla każdego ruchu, który aktualizuje wiersz itemu (LEND, RETURN, GIFT, SWAP, REMOVE). REGISTER niczego nie aktualizuje, ale nie ma też konkurencji, bo item dopiero powstaje.
- Testu współbieżności **nie piszemy**: w izolacji SAVEPOINT na jednym połączeniu (`tests/conftest.py:66-82`) nie da się go wiarygodnie odtworzyć. Mechanizm pokrywa istniejący `tests/test_stale_data_error_handler.py`. Implementator nie powinien próbować takiego testu.

## Punkty księgowania i dokładne zapisy

| Zdarzenie | Miejsce | Zapisy | `reservation_id` | Commit |
|---|---|---|---|---|
| REGISTER | `application/inventory_items.py::register_item` (także z `pledge_fulfillment.py:75` przez bridge) | EXTERNAL −1 / konto `inventory_id` rejestracji +1 | NULL | istniejący `db.commit()` w `register_item` (księgowanie przed nim) |
| REMOVE | `inventory_items.py::soft_delete_item` | konto `item.inventory_id` −1 / EXTERNAL +1; `deleted_at` ustawia `post_movement` | NULL | istniejący commit |
| LEND | `reservation_transitions.py`, gałąź LEND | PERSONAL(A) (bieżące `inventory_id`) −1 / VIRTUAL(B) (`get_or_create_virtual_inventory(reserved_by)`) +1 | id rezerwacji | wrapper `fulfill_reservation` albo `fulfill_exchange` |
| RETURN | gałąź RETURN | VIRTUAL(B) −1 / `home_inventory_id` (PERSONAL A) +1 | id rezerwacji | `fulfill_reservation` (raw route `/fulfill`) |
| GIFT | gałąź GIFT | PERSONAL(A) −1 / PERSONAL(B) (`get_or_create_personal_inventory(reserved_by)`) +1 | id rezerwacji | `fulfill_exchange` (groups) |
| SWAP | nowy `fulfill_exchange` | jedna transakcja z 4 zapisami: X: PERSONAL(A) −1 / PERSONAL(B) +1; Y: PERSONAL(B) −1 / PERSONAL(A) +1 | każda noga ma id swojej rezerwacji | jeden commit |

Szczegóły:

- **REGISTER.**
  - `register_item` tworzy `InventoryItem` z `inventory_id` inwentarza docelowego. Kolumna jest NOT NULL i jest to konstrukcja, a nie przeniesienie. Następnie flushuje, żeby dostać `item.id`, tworzy `InventoryBalance` jak dziś i woła `post_movement(REGISTER, from=None, to=inventory_id)`. Projekcja jest wtedy no-opem.
  - Opis transakcji używa nazwy produktu zwróconej przez istniejące `product_service.get_product` (`inventory_items.py:42`).
  - Sygnatura `register_item` się nie zmienia, więc bridge i `pledge_fulfillment` nie wymagają zmian.
- **REMOVE (decyzja).** Usuwać można tylko rzecz, która fizycznie jest u właściciela, w swoim inwentarzu domowym.
  - Kod już to wymusza: `soft_delete_item` (`inventory_items.py:175-178`) zwraca 409, gdy `InventoryBalance.status ≠ AVAILABLE`, a rzecz pożyczona ma status LENT. Zweryfikowano w kodzie, blokada nie jest tylko w UI.
  - Dodatkowo `post_movement` odrzuca REMOVE, gdy `home_inventory_id IS NOT NULL` (409). Chroni to przed stanem wymuszonym, jak w teście R7 `test_circulation.py:1010`.
  - Uzasadnienie: rzecz pożyczona leży w VIRTUAL(B). Jej REMOVE zdjęłoby ją z konta pożyczającego bez zwrotu, a właściciel nie może usunąć czegoś, czego fizycznie nie ma. Najpierw musi nastąpić RETURN.
- **`fulfill_reservation`** (tylko LEND i RETURN; GIFT przechodzi teraz przez `fulfill_exchange`, ale pojedyncza noga GIFT dalej działa także tutaj):
  - Odrzuca typ SWAP z `BusinessConflictException` („zamiana realizowana jest wyłącznie parą”). Chroni to regułę „SWAP = jedna transakcja z 4 zapisami”.
  - RETURN bez `home_inventory_id` daje teraz 409. Dziś to cichy no-op (`reservation_transitions.py:121-123`), ale nie da się zaksięgować ruchu bez celu. `create_return_reservation` i tak wymaga stanu wypożyczenia.
  - Istniejąca blokada ponownego pożyczenia LEND (`:108-111`) zostaje.
- **Brak zapisów** przy `create_reservation`, `create_lend_reservation`, `create_return_reservation`, `confirm_reservation`, `cancel_reservation` i `update_item`.

## Refaktor przejść rezerwacji i atomowy SWAP

### `application/reservation_transitions.py`

Każde przejście dzielimy na wewnętrzną funkcję flush-only i cienki wrapper, który commituje. Zachowanie i sygnatury publicznych funkcji się nie zmieniają (parametry id są już `uuid.UUID`).

| Funkcja wewnętrzna (bez commita) | Robi | Publiczny wrapper (commit + refresh) |
|---|---|---|
| `_confirm(db, reservation, acting_user_id)` | guard PENDING, `_require_holder_to_confirm`, CONFIRMED, balance IN_TRANSIT | `confirm_reservation(db, id, acting)` |
| `_cancel(db, reservation, acting_user_id)` | guard statusu, `_require_party_to_reservation`, CANCELLED, reguły balance RETURN/nie-RETURN | `cancel_reservation(db, id, acting)` |
| `_fulfill(db, reservation, acting_user_id, now) -> MovementLeg` | guard CONFIRMED, autoryzacja, odczyt `from = item.inventory_id`, wyznaczenie `to` per typ (get-or-create VIRTUAL/PERSONAL), mutacje `InventoryBalance` jak dziś, FULFILLED. **Nie** zmienia `inventory_id`/`home_inventory_id`; to robi `post_movement`. | `fulfill_reservation(db, id, acting)` = `_fulfill` + `post_movement` (typ z rezerwacji, jedna noga) + commit |

Nowe publiczne use case'y w tym samym pliku, eksportowane przez `service.py`:

- **`fulfill_exchange(db, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID) -> list[Reservation]`**
  - Wejście jest poprawne, gdy:
    - to 1 id typu LEND lub GIFT, albo
    - to 2 id typu SWAP, wzajemnie sparowane (`a.paired_reservation_id == b.id` i odwrotnie).

    Inne wejście daje `BusinessConflictException`.
  - **Autoryzacja (H1)**, po załadowaniu rezerwacji i przed jakąkolwiek mutacją: `acting_user_id` musi należeć do `{r.giver_user_id, r.reserved_by_user_id}` dla co najmniej jednej nogi `r`. W przeciwnym razie `AccessDeniedException` (403, ten sam wzorzec co `_require_party_to_reservation` w `domain/reservation_rules.py:13-17`). Nowy predykat trafia do `domain/reservation_rules.py` obok istniejących (czysta funkcja, bez `db`).
  - Dla każdej nogi, w kolejności wejścia:
    - posiadacz jest liczony na świeżo (`_load_reservation_for_transition`);
    - rezerwacja PENDING przechodzi przez `_confirm(…, holder)`;
    - `_fulfill(…, holder, now)` zwraca nogę.

    Wewnętrzne przejścia wykonują się w imieniu posiadacza danej nogi. Zgoda obu stron jest wyrażona przez to, że wymianę inicjuje zweryfikowana strona w groups, tak jak dziś. Wszystkie nogi są budowane przed księgowaniem, więc projekcje są jeszcze niezmienione i każde „from” jest poprawne.
  - Następuje jedno `post_movement`: SWAP z 2 nogami albo LEND/GIFT z 1 nogą. Opis dla SWAP to `"SWAP: {X} ⇄ {Y}"`. `occurred_at = now`. Jeśli itemy SWAP nie leżą w inwentarzach PERSONAL obu stron, `post_movement` odrzuca wymianę z 409 (reguła 5).
  - Na końcu **jeden** commit, refresh rezerwacji i zwrot w kolejności wejścia.
  - **Kontrakt commita (M5), do zapisania w docstringu:** funkcja commituje całą bieżącą transakcję sesji, łącznie ze zmianami wcześniej tylko flushowanymi przez wołającego (w groups: usunięcie `ItemListingPreference` w `confirm_transaction`). Wołający nie commituje sam i polega na tym commicie.
- **`cancel_exchange(db, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID) -> list[Reservation]`**
  - Ta sama walidacja wejścia i ta sama autoryzacja (403) co wyżej.
  - Dla każdej nogi: `_cancel(…, holder)`.
  - Jeden commit, z tym samym kontraktem commita w docstringu.

### Bridge i groups

- `app/groups/infrastructure/circulation_bridge.py`:
  - dodać pass-through `fulfill_exchange` i `cancel_exchange` (oba z `acting_user_id`), importowane wyłącznie z `app.circulation.service`;
  - usunąć `fulfill_reservation` i `resolve_current_holder_user_id`, które po zmianie nie mają wołających w `app/` (`__all__` zaktualizować);
  - `confirm_reservation` i `cancel_reservation` zostają. Rzeczywiste wywołania: `propose_swap` (`term_item_listings.py:565`, confirm), `accept_swap_proposal` (`:641`, confirm), `reject_swap_proposal` (`:682`, cancel) i `pledge_fulfillment.py:90` (confirm). `take_item_listing` ich nie woła.
  - Bridge już dziś importuje `app.circulation.models` i `app.circulation.schemas` (`circulation_bridge.py:15-25`), a nie tylko `service`. Ten spec tego nie zmienia i nie pogłębia: nowe pass-throughy idą tylko przez `service`.
- `app/groups/application/term_item_listings.py`:
  - `confirm_transaction` (`:787-827`): gating `_resolve_transaction_reservations_for_action` (`:703-784`, w tym `_require_race_participant`) i usuwanie `ItemListingPreference` (flush) zostają bez zmian. Pętlę per noga zastępuje jedno wywołanie `circulation_bridge.fulfill_exchange(db, [r.id for r in reservations], acting_user_id)`, gdzie `acting_user_id` to id użytkownika z principala (a nie posiadacz). Zwraca rezerwację o `id == reservation_id`. Usunięcie preferencji jest teraz commitowane atomowo razem z wymianą, zgodnie z kontraktem commita.
  - `cancel_transaction` (`:830-853`): pętlę zastępuje jedno `circulation_bridge.cancel_exchange(..., acting_user_id)`, więc wszystko idzie jednym commitem.
  - Docstringi obu funkcji zaktualizować: opisać, że commit wykonuje use case circulation (bez komentarzy w stylu changelog, zgodnie z `commenting.md`).

## Konta tworzone razem z inwentarzem (`application/inventory.py`)

- `create_inventory` (`:16-25`): dodaje `Inventory`, flushuje (`id` z `uuid.uuid4`), dodaje `Account(account_type=INVENTORY, inventory_id=inventory.id)` i robi istniejący jeden commit.
- `_get_or_create_inventory` (`:39-65`): wewnątrz istniejącego `async with db.begin_nested()` dodaje inwentarz, flushuje, dodaje konto i flushuje.
  - Przy `IntegrityError` SAVEPOINT cofa jednocześnie inwentarz i konto.
  - Ponowny `find` zwraca wiersz zwycięzcy, którego konto powstało w jego transakcji.
  - Istniejący wzorzec pozostaje bez zmian strukturalnych.
- Innych miejsc tworzenia `Inventory` nie ma (zweryfikowane grepem `Inventory(` w `app/`: `inventory.py:19`, `:56`).

## Migracja `alembic/versions/0042_circulation_item_movement_ledger.py`

`revision = "0042"`, `down_revision = "0041"` (identyfikator rewizji zadeklarowany w `0041_baseentity_id_uuid.py`). Nie powstaje żadna nowa tabela ani sekwencja. Nowe kolumny kluczy to `postgresql.UUID(as_uuid=True)`, a id seedowanych wierszy nadaje `gen_random_uuid()`, jak w `0041._reseed_dev_users`/`_reseed_categories`.

Docstring musi wyjaśniać:
- świadome odstępstwo od reguły „Separate Schema and Data” (`migrations.md`). Użytkownik zdecydował o jednej migracji (scope-clarifications, Phase 5), bo aplikacja jest w fazie dev. Czyszczenie musi się odbyć przed zmianą schematu, żeby dodać kolumny NOT NULL do pustych tabel;
- że downgrade nie odtwarza wyczyszczonych danych (precedens `0007.downgrade` i nieodwracalne `0041`).

Instrukcje czyszczenia i seedu mają być stałymi modułowymi, np. `_WIPE_STATEMENTS` i `_SEED_ACCOUNTS_STATEMENTS` (krotki SQL), wykonywanymi w `upgrade()`, analogicznie do `DELETE_ORDER` w 0041. Żaden test ich nie importuje.

### Upgrade, krok 1: czyszczenie danych (kolejność zgodna z FK, dziecko przed rodzicem)

Tabele zależne ustalono z modeli (`app/*/models.py`) i migracji, w tym z list `FK_COLUMNS`/`FK_CONSTRAINTS` w 0041. „Luźne” oznacza wskaźnik cross-BC bez FK w DB.

**Powiązania z `pledges` (M3), wyliczone:**
- **Przychodzące FK do `pledges.id`:** brak. `FK_CONSTRAINTS` w 0041 nie zawiera żadnego ograniczenia wskazującego `pledges`.
- **Przychodzące luźne wskaźniki na pledge:** brak. Żaden model nie ma kolumny `pledge_id`, `notifications` ma tylko `proposal_id`/`join_request_id`/`reservation_id`, a payloady outbox dla pledge (`groups/application/pledges.py:56-61`) zawierają `organizer_party_id`, `actor_name`, `product_name` i `link_path`, bez id pledge.
- **Wychodzące z `pledges`:** FK `fk_pledges_needed_item_id_needed_items` i `fk_pledges_pledged_by_party_id_parties` (pledge jest dzieckiem, więc usunięcie jest bezpieczne) oraz luźne `resolved_reservation_id` → `reservations` (znika razem z wierszem).
- **Dane pochodne (bez wskaźnika, ale dotyczące usuniętych pledge):** powiadomienia `PLEDGE_CREATED`, `PLEDGE_WITHDRAWN`, `PLEDGE_ITEM_REGISTERED` oraz nieprzetworzone zdarzenia outbox `groups.pledge_claimed`/`groups.pledge_withdrawn` (`groups/domain/pledge_events.py`). Usuwamy je w wierszach 4 i 5.

| # | Instrukcja | Powiązanie z danymi | Decyzja i uzasadnienie |
|---|---|---|---|
| 1 | `DELETE FROM circulation_entries` | FK → `circulation_transactions`, `accounts` | Usunąć: stara księga punktowa. |
| 2 | `DELETE FROM circulation_transactions` | | Usunąć. |
| 3 | `DELETE FROM accounts` | | Usunąć: konta punktowe. Po 0041 tabela jest zwykle pusta (0041 nie odtworzył `900-100`), ale mogły powstać konta `100-…`. |
| 4 | `DELETE FROM notifications WHERE reservation_id IS NOT NULL OR proposal_id IS NOT NULL OR kind IN ('PLEDGE_CREATED','PLEDGE_WITHDRAWN','PLEDGE_ITEM_REGISTERED','TERM_ITEM_LISTING_TAKEN','SWAP_PROPOSED','SWAP_ACCEPTED','SWAP_REJECTED','TERM_CONFIRMATION_NEEDED','TERM_ALREADY_RESOLVED')` | luźne `notifications.reservation_id` (0040) → reservations; luźne `notifications.proposal_id` (0032) → swap_proposals; rodzaje `PLEDGE_*` dotyczą usuwanych pledge | **Usunąć, nie NULL-ować.** To powiadomienia-akcje o wymianach i powiadomienia o pledge, których już nie ma. Po NULL-owaniu modal oczekujących akcji pokazywałby martwe wpisy. Zostają tylko powiadomienia `NEEDED_ITEM_REMOVED` i `GROUP_JOIN_*` (dotyczą potrzeb i próśb o dołączenie, które nie są czyszczone). |
| 5 | `DELETE FROM outbox_entries WHERE event_type IN ('groups.term_ended_giveaway','groups.term_ended_swap','groups.pledge_claimed','groups.pledge_withdrawn')` | luźne `payload.reservation_id` / `payload.proposal_id` (`term_end_scan.py:116-168`); zdarzenia pledge | Usunąć: nieprzetworzone zdarzenia utworzyłyby powiadomienia o skasowanych rezerwacjach i pledge. |
| 6 | `DELETE FROM giveaway_term_end_markers` | luźne `reservation_id` (0031) | Usunąć: znaczniki idempotencji skanu dla skasowanych rezerwacji. |
| 7 | `DELETE FROM swap_proposals` | luźne `listing_item_id`, `offered_item_id`, `proposer_reservation_id` (0031) | Usunąć: każda propozycja wskazuje itemy i rezerwację. |
| 8 | `DELETE FROM item_listing_preferences` | luźne `item_id` (0028) | Usunąć: preferencja dotyczy konkretnego itemu. |
| 9 | `DELETE FROM pledges` | wychodzące FK → `needed_items`, `parties`; luźne `resolved_reservation_id` (0003/0009) | **Usunąć wszystkie** (decyzja użytkownika, M3). Unika to niespójnego stanu „FULFILLED bez rezerwacji”. `needed_items` zostają i znów są wolne do zgłoszenia. |
| 10 | `DELETE FROM reservations` | FK → `inventory_items`, samo-FK `paired_reservation_id` | Usunąć. Jedno `DELETE` wszystkich wierszy nie narusza samo-FK, bo sprawdzenie NO ACTION odbywa się na końcu instrukcji. |
| 11 | `DELETE FROM inventory_balances` | FK → `inventory_items` | Usunąć. |
| 12 | `DELETE FROM inventory_items` | FK → `inventories`, `products` | Usunąć. |

**Nie czyścimy:** `inventories` (decyzja użytkownika), `products`, `needed_items`, `terms`, `term_attendances`, `group_join_requests`, `plugin_objects` (pluginy wiążą tylko `PRODUCT`) oraz grup i użytkowników.

### Upgrade, krok 2: schemat

- `accounts`:
  - drop `ix_accounts_owner_user_id` (z 0004, przetrwał 0041), `fk_accounts_owner_user_id_users` i `uq_accounts_code`;
  - drop kolumn `code`, `name` i `owner_user_id`;
  - add `inventory_id` `postgresql.UUID(as_uuid=True)` NULL, FK `fk_accounts_inventory_id_inventories` i UNIQUE `uq_accounts_inventory_id`;
  - add CHECK `ck_accounts_inventory_id_account_type`;
  - add unikalny indeks częściowy `uq_accounts_account_type_external` (`postgresql_where` `account_type = 'EXTERNAL'`);
  - `account_type` zostaje jako String(20), zmieniają się tylko wartości;
  - `id` zostaje bez zmian (UUID z `DEFAULT gen_random_uuid()` z 0041).
- `circulation_transactions`:
  - drop `transaction_date` i `is_posted`;
  - add `movement_type` String(20) NOT NULL i `occurred_at` TIMESTAMP NOT NULL.
- `circulation_entries`:
  - drop `amount`, `entry_side`, `description` i `entry_date`;
  - add `item_id` `postgresql.UUID(as_uuid=True)` NOT NULL z FK `fk_circulation_entries_item_id_inventory_items`;
  - add `quantity` Integer NOT NULL;
  - add `reservation_id` `postgresql.UUID(as_uuid=True)` NULL z FK `fk_circulation_entries_reservation_id_reservations`;
  - add indeks `ix_circulation_entries_item_id_transaction_id` na `(item_id, transaction_id)`.

Implementator sprawdza w bazie rzeczywiste nazwy indeksów i ograniczeń na `accounts` przed ich usunięciem, bo 0041 odtwarzał FK pod nazwami z `FK_CONSTRAINTS`.

### Upgrade, krok 3: seed kont

- `INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) VALUES (gen_random_uuid(), 'EXTERNAL', NULL, now(), now())`.
- `INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) SELECT gen_random_uuid(), 'INVENTORY', id, now(), now() FROM inventories`.

### Downgrade

Downgrade wraca do stanu schematu z 0041: schemat punktowy na typach UUID. Kroki w odwrotnej kolejności zależności:

1. `DELETE FROM circulation_entries`, `circulation_transactions` i `accounts`. Dane w nowym kształcie nie mają odpowiednika w starym.
2. `circulation_entries`:
   - drop indeksu `ix_circulation_entries_item_id_transaction_id`, obu nowych FK i kolumn `item_id`/`quantity`/`reservation_id`;
   - add `amount` Numeric(12,2) NOT NULL, `entry_side` String(10) NOT NULL, `description` String(500) NOT NULL i `entry_date` Date NOT NULL.
3. `circulation_transactions`:
   - drop `movement_type` i `occurred_at`;
   - add `transaction_date` Date NOT NULL i `is_posted` Boolean NOT NULL.
4. `accounts`:
   - drop indeksu częściowego, CHECK, UNIQUE, FK i kolumny `inventory_id`;
   - add `code` String(20) NOT NULL, `name` String(255) NOT NULL i `owner_user_id` `postgresql.UUID(as_uuid=True)` NULL;
   - odtworzyć `uq_accounts_code`, `fk_accounts_owner_user_id_users` oraz indeks na `owner_user_id` w takiej postaci, w jakiej istniał po 0041.
5. **Bez ponownego seedu `900-100`.** Stan po 0041 też go nie ma, bo 0041 wyczyścił `accounts` i go nie odtworzył. Downgrade odtwarza dokładnie ten stan.
6. Wyczyszczone dane (itemy, rezerwacje, pledge, propozycje, preferencje, powiadomienia, zdarzenia outbox) **nie są odtwarzane**. To świadoma decyzja, do opisania w docstringu. Downgrade poniżej 0041 jest niemożliwy (`0041.downgrade` rzuca `NotImplementedError`).

Uruchomienie lokalne: `set -a; . ./.env; set +a` przed `uv run alembic upgrade head` w `src/backend`. Migrację trzeba zastosować do lokalnej bazy.

## API

Wszystkie identyfikatory w ścieżkach i odpowiedziach to `uuid.UUID` (w JSON string UUID), zgodnie z resztą API po 0041.

### `GET /api/inventory-items/{item_id}/history` (nowy, `app/circulation/router.py`)

- **Autoryzacja**: `ReadPrincipal` (`READ`/`mcp:read`). Ścieżkę pokrywa istniejący wiersz 40 macierzy (`GET ^/api/inventory-items(/.*)?$`, `authorization_matrix.py:157`), więc macierz się nie zmienia. Każdy principal z READ widzi historię dowolnego itemu (decyzja `history-read-authorization`).
- **Parametr**: `item_id: uuid.UUID`. Niepoprawny UUID daje 422 z FastAPI, jak w innych trasach.
- **404**: tylko gdy wiersz `inventory_items` nie istnieje. Rzecz **usunięta** (soft delete) zwraca 200, a jej historia kończy się ruchem REMOVE. Dlatego endpoint sprawdza istnienie przez `repository.get_item`, a nie przez `application.get_item`, które zwraca 404 dla `deleted_at`.
- **Odpowiedź**: lista `ItemMovementResponse`, **od najstarszego**, sortowana po `(occurred_at, id)` transakcji.
  - `transaction_id: uuid.UUID`, `transaction_number: str`, `movement_type: MovementType`, `occurred_at: datetime`;
  - `reservation_id: uuid.UUID | None` (z zapisów tej nogi);
  - `from`: `ItemMovementSideResponse | None`. W Pydantic pole nazywa się `from_` z aliasem `"from"`. Model ma `model_config = ConfigDict(populate_by_name=True)`, żeby dało się go budować po nazwie pola. Odpowiedź jest serializowana po aliasie, jak domyślnie robi FastAPI.
  - `to`: `ItemMovementSideResponse | None`;
  - `null` oznacza EXTERNAL („świat zewnętrzny”): `from` dla REGISTER i `to` dla REMOVE.
- **`ItemMovementSideResponse`**: `inventory_id: uuid.UUID`, `inventory_type: InventoryType`, `owner_user_id: uuid.UUID`, `owner_display_name: str | None`.
  - `display_name` jest tani. Pochodzi z jednego LEFT JOIN do `user_profiles` po `account_user_id = inventories.owner_user_id`, a `uq_user_profiles_account_user_id` gwarantuje relację 1:1.
  - **Akceptowany wyjątek od reguły fasady (M1).** Reguła projektu brzmi „importuj z `app.<v>.service`”. Join na poziomie zapytania do tabeli innego modułu w warstwie `infrastructure/` jest świadomym wyjątkiem, z precedensami: `circulation/infrastructure/repository.py:29` (import `app.product.models.Product`, użycie `:87-88`) oraz `groups/infrastructure/repository.py` (import `app.users.models`, join `UserProfile`). Wyjątek dotyczy tylko zapytań odczytowych w `infrastructure/` i trzeba go wskazać w docstringu `list_item_movements`.
- **Zapytanie** (bez N+1): nowa `repository.list_item_movements(db, item_id)` jako **jedno** `select`.
  - Wychodzi od `CirculationTransaction`.
  - Dołącza dwa aliasy `CirculationEntry` dla tego `item_id`: wyjście (`quantity = -1`) i wejście (`quantity = +1`) z tej samej transakcji.
  - Dla każdej strony wykonuje LEFT JOIN `Account` → `Inventory` → `UserProfile`. EXTERNAL nie ma inwentarza, więc wychodzą NULL-e.
  - Wybiera tylko potrzebne kolumny i sortuje po `occurred_at, id`.
  - Mapowanie wierszy na schemat odbywa się w warstwie application albo router, tak jak `_item_response`.
  - Cały endpoint wykonuje więc 2 zapytania: `repository.get_item` (rozróżnienie 404) i jedno zapytanie ruchów.

### `GET /api/circulation-transactions/{transaction_id}` (nowy kształt odpowiedzi)

- Autoryzacja: `ReadPrincipal`, wiersz 45 (zawężony, patrz niżej). 404 przez istniejące `get_transaction`. `transaction_id: uuid.UUID`.
- `CirculationTransactionResponse` zawiera `id: uuid.UUID`, `transaction_number`, `movement_type`, `occurred_at`, `description` i `entries: list[CirculationEntryResponse]` (kolejność po `id`).
- `CirculationEntryResponse` zawiera `id: uuid.UUID`, `account_id: uuid.UUID`, `account_type` i `inventory_id: uuid.UUID | None`, `inventory_type: InventoryType | None`, `owner_user_id: uuid.UUID | None` (wszystkie trzy None dla EXTERNAL), a także `item_id: uuid.UUID`, `quantity` i `reservation_id: uuid.UUID | None`.
- `repository.find_transaction_with_entries` (`repository.py:144-152`) ładuje `selectinload(entries).joinedload(account).joinedload(Account.inventory)`, więc wszystko idzie jednym ładowaniem i bez N+1. Mapowanie jest jawne (płaskie pola z `entry.account.inventory`), bez `from_attributes` na zagnieżdżonym koncie.

### Usunięcia

- Router usuwa trasy `GET /api/accounts/{user_id}/balance` (`router.py:242`) i `GET /api/circulation-transactions` (lista, `router.py:253`) oraz sekcję „Accounts”. Docstring modułu nie wymienia już `/api/accounts`.
- `schemas.py` usuwa `AccountResponse` i `AccountBalanceResponse`, przepisuje `CirculationEntryResponse`/`CirculationTransactionResponse` i dodaje `ItemMovementResponse`/`ItemMovementSideResponse`. Docstring modułu też do aktualizacji.
- `app/core/authorization_matrix.py`:
  - **usunąć** wiersz 44 (`GET ^/api/accounts(/.*)?$`, `:161`);
  - wiersz 45 (`:162`) zmienić na `GET ^/api/circulation-transactions/[^/]+$` (READ/mcp:read). Zawężenie nie jest konieczne, bo usunięta lista i tak zwraca 404 z routera. Jest nieszkodliwe i zostaje dla czytelności macierzy. Wymaga aktualizacji testu macierzy (grupa API). Żaden test nie sprawdza `len(AUTHORIZATION_MATRIX)`, więc usunięcie wiersza 44 niczego nie łamie;
  - numeracji pozostałych wierszy w komentarzach nie zmieniamy, bo numery są przywoływane w innych dokumentach.

  Usunięte ścieżki trafiają do catch-all (AUTHENTICATED), a router zwraca 404.
- Frontend: usunąć `src/frontend/src/api/accounts.ts`. Nikt go nie importuje, co zweryfikowano grepem. Frontendowy build i typecheck muszą przejść.

## Komponenty do ponownego użycia

### Istniejący kod do wykorzystania

| Element | Ścieżka | Użycie |
|---|---|---|
| Get-or-create z SAVEPOINT + `IntegrityError` | `app/circulation/application/inventory.py:39-65` | Rozszerzyć o insert konta w tym samym `begin_nested()`. Bez nowego mechanizmu. |
| `_enum_column(native_enum=False)` | `app/circulation/models.py:34` | `AccountType` (nowe wartości) i `MovementType`. |
| `BaseEntity` (PK UUID, `updated_at` jako version col) | `app/core/base_model.py` | Wszystkie trzy encje bez zmian PK. Optimistic lock chroni przed równoległym ruchem itemu. |
| Konwencja kolumn UUID FK / luźnych wskaźników | `app/circulation/models.py` (np. `InventoryItem.home_inventory_id`) | Kolumny `Account.inventory_id`, `CirculationEntry.item_id`/`reservation_id`. |
| Seed przez `gen_random_uuid()` i stała lista instrukcji | `alembic/versions/0041_baseentity_id_uuid.py` (`DELETE_ORDER`, `_reseed_*`) | Wzorzec `_WIPE_STATEMENTS`/`_SEED_ACCOUNTS_STATEMENTS` i seed kont w 0042. |
| `_next_transaction_number()` | `app/circulation/domain/reservation_rules.py:44` | Numer transakcji ruchu. |
| `_load_reservation_for_transition`, `_current_holder_user_id` | `reservation_transitions.py:38`, `reservations.py:57` | Wyznaczanie posiadacza per noga w `fulfill_exchange`/`cancel_exchange`. |
| `_require_holder_to_confirm`, `_require_party_to_reservation`, `AccessDeniedException` | `domain/reservation_rules.py:13-31`, `app/core/errors.py:53` | Bez zmian, wołane z `_confirm`/`_cancel`/`_fulfill`. Wzorzec dla nowego predykatu „aktor jest stroną którejś nogi”. |
| Gałęzie typów w `fulfill_reservation` | `reservation_transitions.py:107-136` | Przenieść do `_fulfill`, zachowując mutacje `InventoryBalance`. Zmiana `inventory_id`/`home_inventory_id` przechodzi do `post_movement`. |
| `get_or_create_personal_inventory` / `get_or_create_virtual_inventory` | `application/inventory.py:68-79` | Cele GIFT/SWAP/LEND (konto powstaje razem z inwentarzem). |
| Flush-only infrastruktura, commit w application | `infrastructure/ledger.py`, `application/*` | `post_movement` flush-only, commity w wrapperach i use case'ach. |
| Wzorzec eager loadingu `find_transaction_with_entries` | `infrastructure/repository.py:144-152` | Rozszerzyć o `joinedload(Account.inventory)`. |
| Join na poziomie zapytania do modelu innego modułu | `repository.py:29`, `:87-88` (`Product`), `groups/infrastructure/repository.py` (`UserProfile`) | Zapytanie historii z `display_name` (akceptowany wyjątek, M1). |
| Wspólny gating wymiany | `term_item_listings.py:703-784` `_resolve_transaction_reservations_for_action` | Bez zmian. Groups przekazuje wynik i id aktora do `fulfill_exchange`/`cancel_exchange`. |
| Handler `StaleDataError` → 409 | `app/core/errors.py:88`, `:138`; test `tests/test_stale_data_error_handler.py` | Ochrona współbieżności ruchów, bez nowego kodu i bez nowego testu. |
| Precedens czyszczenia danych bez odtwarzania w downgrade | `alembic/versions/0007_circulation_product_cleanup_data.py` | Kolejność DELETE i opis w docstringu. |
| `alembic upgrade head` w subprocessie | `tests/conftest.py:47-58` | Lekka weryfikacja migracji 0042 przy każdym przebiegu testów. |
| Helpery testów | `tests/test_circulation.py` (`_authed_headers`, `_create_item`, `_create_term`, `_lend_and_confirm`, `_user_id`), `tests/test_term_item_listings.py` (`_register`, `_register_personal_item`, `_principal`, `_create_circle_and_term`, `_rsvp`) | Nowe testy korzystają z tych samych konstrukcji danych. |

### Nowe komponenty i uzasadnienie

| Nowy element | Dlaczego nie da się użyć istniejącego |
|---|---|
| `MovementType` (enum) | Typ ruchu jest nowym pojęciem. `ReservationType` nie ma REGISTER ani REMOVE, a rezerwacja to nie ruch. |
| `MovementLeg` + `post_movement` (zastępuje `post_circulation`) | Stara funkcja księguje punkty bez itemu i bez inwentarzy. Nowa semantyka wymaga nóg from/to per item, reguły krzyżowania SWAP i aktualizacji projekcji. |
| `_confirm`/`_cancel`/`_fulfill` (wydzielone z istniejących funkcji) | Atomowy SWAP wymaga wariantów bez commita. To wydzielenie istniejącej logiki, a nie nowa logika. |
| `fulfill_exchange` / `cancel_exchange` + 2 pass-throughy w bridge | Brak use case'u, który obejmuje obie nogi jednym commitem. Groups nie może commitować ani importować encji circulation (reguła fasady i bridge). |
| Predykat „aktor jest stroną którejś nogi” w `domain/reservation_rules.py` | Istniejące predykaty dotyczą jednej rezerwacji. Kilkulinijkowa funkcja z jednym wołającym (oba nowe use case'y). |
| `repository.list_item_movements`, `find_accounts_for_posting` | Brak zapytań po nowych kolumnach. Stare (`find_account_by_code`, `list_entries_for_account`, `list_transactions_for_account`) są usuwane. |
| Endpoint i schematy historii | Nowa funkcja (historia rzeczy), niewyrażalna dotychczasowymi schematami. |
| Migracja 0042 | Zmiana schematu i czyszczenie danych. |
| `tests/ledger_assertions.py` (helper testowy) | Asercja niezmiennika i odczyt ruchów itemu są potrzebne w co najmniej 3 plikach testów. Import z `conftest` byłby niezgodny z konwencją. |

Świadomie **nie** tworzymy:
- endpointu salda/wyciągu konta;
- relacji ORM `CirculationEntry.item`/`.reservation`;
- CHECK na `quantity` ani triggera bilansu;
- encji `Loan`;
- kolumny `actor_user_id`;
- osobnego testu migracji na odrębnej bazie ani testu współbieżności.

## Podejście techniczne

- **Warstwy**, zgodnie z DDD w circulation:
  - `models.py`: model;
  - `infrastructure/ledger.py`: księgowanie, walidacja i projekcja;
  - `infrastructure/repository.py`: zapytania;
  - `domain/reservation_rules.py`: czyste predykaty autoryzacji (w tym nowy dla wymiany);
  - `application/reservation_transitions.py`, `inventory_items.py` i `inventory.py`: punkty księgowania i commity;
  - nowy `application/movements.py`: odczyty `get_transaction` i `get_item_history`. Zastępuje `application/accounts.py`, który jest usuwany.
  - Fasada `service.py` eksportuje:
    - bez `get_account_balance` i `list_transactions_for_account`;
    - dodatkowo `get_item_history`, `fulfill_exchange` i `cancel_exchange`.

  Groups importuje circulation wyłącznie przez `circulation_bridge`. Nowe pass-throughy bridge'a korzystają tylko z `app.circulation.service` (istniejące importy `models`/`schemas` w bridge'u zostają bez zmian, L9).
- **Przepływ danych**: use case czyta item, sprawdza aktora, buduje nogi (from z projekcji), mutuje stan `Reservation`/`InventoryBalance`, woła `post_movement` (walidacja, wpisy, projekcja), a na końcu wykonuje jeden commit.
- **Pojedyncza ścieżka mutacji lokalizacji**: po zmianie jedyne przypisania `item.inventory_id =`, `item.home_inventory_id =` i `item.deleted_at =` w `app/circulation/` są w `post_movement`. Wyjątkiem jest konstruktor `InventoryItem` w `register_item`. Należy to zweryfikować grepem w fazie weryfikacji.
- **Stałe**: `domain/constants.py` zostawia tylko `_DEFAULT_LEND_DAYS`, a docstring modułu trzeba zaktualizować.
- **Czas**: `datetime.utcnow()` jest używane tak jak w reszcie modułu. Ten sam `now` trafia do `InventoryBalance` i `occurred_at` w obrębie jednego use case'u.
- **Docstringi do przepisania** (opis stanu bieżącego, bez changelogu):
  - `models.py:1-16` i docstringi `Account`/`CirculationTransaction`/`CirculationEntry`;
  - `ledger.py:1-17`;
  - `service.py`;
  - `router.py`;
  - `schemas.py`;
  - `reservation_transitions.py:1-4` oraz docstringi `fulfill_exchange`/`cancel_exchange` (kontrakt commita i autoryzacja);
  - `reservation_rules._require_holder_to_confirm` (zdanie o „accounting always credits the holder”);
  - `repository.list_item_movements` (akceptowany wyjątek M1);
  - `circulation_bridge.py` (moduł i nowe pass-throughy);
  - `confirm_transaction`/`cancel_transaction` w groups (commit wykonuje use case circulation).

## Wytyczne implementacyjne

### Podejście do testów

- **2-8 skupionych testów na grupę kroków implementacji.** Weryfikacja uruchamia tylko nowe i zmienione testy danej grupy. Pełny zestaw (`uv run pytest` w `src/backend`) uruchamiamy raz na końcu.
- Testy integracyjne: pytest + TestContainers Postgres 18 + httpx (`tests/conftest.py`), z izolacją per test przez SAVEPOINT. Nazwy według konwencji `test_<akcja>_<warunek>_<oczekiwanie>`. Identyfikatory w testach to UUID (np. nieistniejący item to `uuid.uuid4()`, a nie `999999`).
- **Helper `tests/ledger_assertions.py`** (nowy):
  - `movements_for_item(db, item_id)`: lista transakcji z zapisami itemu, w kolejności `(occurred_at, id)`;
  - `assert_ledger_matches_projection(db, item_ids)`:
    - dla każdego itemu `SUM(quantity)` per konto INVENTORY: żywy item ma dokładnie `{konto item.inventory_id: +1}`, usunięty nie ma żadnego niezerowego salda INVENTORY;
    - saldo EXTERNAL itemu wynosi −1 dla żywego i 0 dla usuniętego;
    - w każdej transakcji suma per item wynosi 0.

  Asercja jest zawężona do podanych itemów, bo niektóre istniejące testy celowo wymuszają „legacy” stan (`test_circulation.py:1010`, `:1046`).

Planowane grupy testów:

| Grupa | Plik | Testy (2-8) |
|---|---|---|
| Migracja 0042 (lekki test) | `tests/test_circulation_ledger.py` (nowy) | `alembic upgrade head` w `conftest` przechodzi (pośrednio, każdy przebieg testów); w bazie po migracji istnieje dokładnie jedno konto EXTERNAL, nie ma kont z kodem `900-100`/`100-…` (kolumny `code` nie ma); każdy wiersz `inventories` ma dokładnie jedno konto INVENTORY (zapytanie LEFT JOIN zwraca 0 inwentarzy bez konta). Bez osobnej bazy, bez wielokrotnych przebiegów Alembica, bez importu modułu migracji. |
| Model + konta | jw. | `POST /api/inventories` tworzy konto INVENTORY; get-or-create PERSONAL/VIRTUAL tworzy konto, a przy wyścigu (IntegrityError) nie powstaje duplikat; CHECK kształtu konta odrzuca INVENTORY bez `inventory_id` (IntegrityError); indeks częściowy odrzuca drugie EXTERNAL |
| REGISTER / REMOVE | jw. | rejestracja przez API daje transakcję REGISTER (EXTERNAL −1 / inwentarz +1, `reservation_id` NULL); rejestracja przez `fulfill_pledge` daje REGISTER; DELETE itemu daje REMOVE i `deleted_at`; DELETE itemu LENT zwraca 409 i nie tworzy nowej transakcji |
| Walidacja `post_movement` | jw. | asercja defensywna: noga z `from` ≠ `item.inventory_id` daje 409 bez zapisów; SWAP z nogami niekrzyżującymi się (A→B i C→D) daje 409; SWAP z tym samym itemem w obu nogach daje 409; SWAP, w którym jedna strona to VIRTUAL lub PICKUP_POINT, daje 409; poprawny SWAP PERSONAL(A) ↔ PERSONAL(B) przechodzi i spełnia `assert_ledger_matches_projection`. Przypadek „ten sam właściciel po obu stronach” jest nieosiągalny przez dane (unikalność PERSONAL per właściciel), więc nie ma osobnego testu. |
| LEND / RETURN / GIFT i stany oczekujące | jw. | LEND: PERSONAL(A) −1 / VIRTUAL(B) +1 z `reservation_id` i `home_inventory_id`; RETURN: VIRTUAL(B) −1 / PERSONAL(A) +1 i `home` = NULL; GIFT przez `confirm_transaction`: PERSONAL(A) −1 / PERSONAL(B) +1; create/confirm/cancel rezerwacji i PATCH itemu nie dodają zapisów; `fulfill_reservation` dla SWAP daje 409; pełny cykl REGISTER → LEND → RETURN → GIFT → REMOVE spełnia `assert_ledger_matches_projection` na każdym etapie |
| Atomowy SWAP i autoryzacja wymiany | `tests/test_term_item_listings.py` | `confirm_transaction` SWAP tworzy **jedną** transakcję SWAP z 4 zapisami, każda noga ma swój `reservation_id`, oba itemy zamieniają się inwentarzami, a `ItemListingPreference` obu itemów zniknęły (kontrakt commita, M5); awaria w nodze 2 (monkeypatch `reservation_transitions.get_or_create_personal_inventory` rzucający przy drugim wywołaniu), a po `db_session.rollback()` obie rezerwacje, oba itemy i preferencje są w stanie sprzed wywołania, bez transakcji; `cancel_transaction` SWAP anuluje obie nogi jednym commitem; awaria `cancel_exchange` przy nodze 2 (monkeypatch `reservation_transitions.get_item_balance` rzucający przy drugim wywołaniu) zostawia nogę 1 nietkniętą; `circulation_bridge.fulfill_exchange` odrzuca niesparowane nogi (409); `fulfill_exchange` z `acting_user_id` spoza stron obu nóg daje 403 i nie zmienia stanu; `cancel_exchange` z obcym aktorem daje 403 i nie zmienia stanu |
| API | `tests/test_circulation_ledger.py` + `tests/test_authorization_matrix.py` | historia: kolejność od najstarszego, `from = null` dla REGISTER, `to = null` dla REMOVE, `owner_display_name` wypełniony; historia usuniętego itemu zwraca 200 i kończy się REMOVE; nieistniejący item (`uuid.uuid4()`) 404; bez tokenu 401; `GET /api/circulation-transactions/{id}` ma nowy kształt (4 zapisy dla SWAP, pola `inventory_*` = null dla EXTERNAL); `GET /api/accounts/{id}/balance` i `GET /api/circulation-transactions?account_id=` zwracają 404; `resolve_requirement` dla `/api/inventory-items/{uuid}/history` daje READ, a dla `/api/circulation-transactions/{uuid}` daje READ |

Przepisanie istniejących testów:
- `tests/test_circulation.py:490` `test_fulfillLend_postsCirculationTransactionCreditingOwner` → `test_fulfillLend_postsLendMovementFromPersonalToVirtual` (asercje na zapisach, bez `/api/accounts`).
- `tests/test_circulation.py:578` (bridge `fulfill_reservation`) → test `circulation_bridge.fulfill_exchange` dla pojedynczej nogi LEND, z `acting_user_id` strony rezerwacji.
- `tests/test_term_item_listings.py`:
  - `:136-170`: helper `_latest_ledger_entries_for_giver` zastąpić importem `movements_for_item` z `tests/ledger_assertions.py`;
  - importy `Account`, `EntrySide` usunąć;
  - test GIFT (okolice `:1659`): jedna transakcja GIFT, 2 zapisy −1/+1 na kontach PERSONAL(lister)/PERSONAL(taker), `reservation_id` i nazwa produktu w `description`;
  - test SWAP (okolice `:1710`): **jedna** transakcja SWAP z 4 zapisami, zamiast asercji „dwie różne transakcje”;
  - pozostałe audyty księgi w rejonie `:1571-1770` dostosować analogicznie.
- Testy `GET /api/inventory-items/{id}/balance` (`:1852-2037`) to saldo **statusu** `InventoryBalance`, a nie konta. **Zostają bez zmian.**
- Istniejące testy, które przenoszą rzeczy (`test_circulation.py:332`, `:366`, `:741`; `test_lend_step0_fixes.py`; `test_pledge_fulfillment.py`; `test_term_item_listings.py:642`), muszą przejść bez zmian w asercjach. Wyjątek: testy SWAP, których itemy nie leżą w PERSONAL obu stron, muszą zostać dostosowane do reguły krzyżowania (implementator sprawdza je przy pierwszym przebiegu).

### Weryfikacja ręczna (lokalna baza)

Wykonywana przez implementatora po grupie migracji, w `src/backend`, z załadowanym `.env` (`set -a; . ./.env; set +a`):

1. `uv run alembic upgrade head`: przechodzi, a `alembic current` pokazuje `0042`.
2. Kontrola danych: `SELECT count(*) FROM accounts WHERE account_type = 'EXTERNAL'` daje 1; `SELECT count(*) FROM inventories i LEFT JOIN accounts a ON a.inventory_id = i.id WHERE a.id IS NULL` daje 0; `pledges`, `inventory_items`, `reservations` są puste.
3. `uv run alembic downgrade 0041`: przechodzi, a `accounts` ma znów kolumny `code`/`name`/`owner_user_id` (UUID), bez wierszy.
4. `uv run alembic upgrade head` ponownie: przechodzi, a kontrola z kroku 2 daje te same wyniki.
5. Lokalna baza zostaje na `0042`.

### Zgodność ze standardami

- `standards/backend/models.md`: `BaseEntity` z PK UUID (stan po 0041; opis sekwencji w standardzie jest nieaktualny, patrz „Założenia”); StrEnum przez `_enum_column(native_enum=False)` (nigdy ordinal); `lazy="raise"` z jawnym `selectinload`/`joinedload`; `__eq__`/`__hash__` po kluczu biznesowym (`Account`: `(account_type, inventory_id)`, transakcja: `transaction_number`); referencje do innych modułów tylko jako kolumny UUID i joiny na poziomie zapytania, bez `relationship()`; brak relacji bez konsumenta.
- `standards/backend/migrations.md`:
  - działający `downgrade` w odwrotnej kolejności zależności (do 0041);
  - nazwy `fk_/uq_/ix_/ck_` według konwencji;
  - brak nowych sekwencji (po 0041 nie ma ich wcale).
  - **Udokumentowane odstępstwo** od „Separate Schema and Data”. Wynika z decyzji użytkownika o jednej migracji (faza dev), a kolejność „czyszczenie przed zmianą schematu” jest technicznie wymagana dla kolumn NOT NULL.
- `standards/backend/queries.md`: historia jako jedno zapytanie z joinami (bez N+1), wybór tylko potrzebnych kolumn, indeks `(item_id, transaction_id)` pod filtr historii, wszystkie operacje jednego use case'u w jednej transakcji DB.
- `standards/backend/api.md`: zasoby w liczbie mnogiej, zagnieżdżenie ≤ 2 poziomy (`/inventory-items/{id}/history`), kody 200/401/403/404/409/422.
- `standards/backend/security.md`: autoryzacja przez `Depends(require_any("READ", "mcp:read"))`; macierz `AUTHORIZATION_MATRIX` zaktualizowana (wiersz 44 usunięty, 45 zawężony, 40 bez zmian); publiczne use case'y wymiany same sprawdzają stronę (403), a nie polegają wyłącznie na wołającym.
- `standards/global/minimal-implementation.md`: usunięcie całego kodu punktowego, pass-throughów bez wołających (`fulfill_reservation`, `resolve_current_holder_user_id` w bridge) i nieużywanego FE `accounts.ts`; brak speculative API (wyciąg konta, `Loan`); lekki test migracji zamiast osobnej infrastruktury.
- `standards/global/error-handling.md`: typowane wyjątki (`BusinessConflictException` dla naruszeń reguł ruchu, `AccessDeniedException` dla obcego aktora, `EntityNotFoundException` dla brakującego itemu lub konta) i fail-fast walidacja nóg przed jakimkolwiek zapisem.
- `standards/global/commenting.md`: docstringi opisują stan bieżący, bez komentarzy w stylu changelog.
- `standards/testing/backend-testing.md`: testy integracyjne na prawdziwym Postgres 18, każdy test tworzy własne dane, 2-8 testów na grupę. Faktyczny stack to pytest + httpx (nie MockMvc).

## Dokumentacja

- `docs/system-wypozyczalni-inventory-accounting.md`:
  - zmienić tytuł na księgę ruchów;
  - w §1 zastąpić „CirculationTransaction (Transakcja punktowa)” i „Konta punktowe” opisem kont inwentarzy + EXTERNAL, typów ruchu i zapisu ±1;
  - w §2 przykłady kroków przepisać na zapisy ruchów (LEND: PERSONAL(A) −1 / VIRTUAL(B) +1, RETURN, SWAP jako jedna transakcja z 4 zapisami PERSONAL ↔ PERSONAL, GIFT, rejestracja i usunięcie);
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
- SWAP z udziałem inwentarzy innych niż PERSONAL (np. PICKUP_POINT). Reguła krzyżowania go odrzuca.
- Aktualizacja `standards/backend/models.md` (opis sekwencji) po konwersji na UUID. To zadanie konwersji UUID, nie tego spec.
- Zmiany w przepływach create/confirm rezerwacji w `take_item_listing`, `propose_swap`, `accept_swap_proposal`, `reject_swap_proposal` i `pledge_fulfillment` (ich pośrednie commity zostają). Skutek (M6): niezmiennik księgi jest zachowany po każdym commicie, bo REGISTER commituje się razem z itemem. Awaria w połowie `fulfill_pledge` lub `accept_swap_proposal` może jednak zostawić osierocony item lub rezerwację bez pledge albo powiadomienia, tak jak dziś.

## Kryteria sukcesu

1. `uv run pytest` w `src/backend` przechodzi w całości (w tym `alembic upgrade head` do 0042 w `conftest`), łącznie z nowymi testami ledger, walidacji SWAP, autoryzacji wymiany, API, macierzy i lekkim testem migracji.
2. Dla każdego typu ruchu (REGISTER, REMOVE, LEND, RETURN, GIFT, SWAP) powstaje dokładnie jedna transakcja, której zapisy mają poprawne konta, `item_id`, `quantity` i `reservation_id`, zgodnie z tabelą „Punkty księgowania”.
3. `assert_ledger_matches_projection` przechodzi po każdym kroku pełnego cyklu życia itemu i po wymianie SWAP.
4. SWAP to zawsze jedna transakcja z 4 zapisami PERSONAL(A) ↔ PERSONAL(B). Niekrzyżujące się nogi, ten sam item lub strona inna niż PERSONAL dają 409. Wymuszona awaria drugiej nogi nie zostawia żadnych zmian (rezerwacje, itemy, preferencje, księga). Anulowanie SWAP to jeden commit.
5. `fulfill_exchange` i `cancel_exchange` wywołane przez użytkownika, który nie jest `giver_user_id` ani `reserved_by_user_id` żadnej nogi, dają 403 bez zmian stanu.
6. Create, confirm i cancel rezerwacji oraz PATCH itemu nie tworzą zapisów.
7. `GET /api/inventory-items/{id}/history` zwraca pełną historię od najstarszego: ruchy jednym zapytaniem SQL bez N+1 (plus `repository.get_item` do rozróżnienia 404), z `null` dla strony EXTERNAL, także dla rzeczy usuniętej.
8. `GET /api/accounts/{id}/balance` i lista `GET /api/circulation-transactions` nie istnieją (404). `GET /api/circulation-transactions/{id}` zwraca nowy kształt. W kodzie backendu i FE nie ma żadnych odwołań do punktów (`900-100`, `100-`, `EntrySide`, `_POSTED_AMOUNT`, `api/accounts.ts`).
9. Kroki „Weryfikacji ręcznej” przechodzą na lokalnej bazie: `upgrade head`, kontrola kont, `downgrade 0041`, ponowne `upgrade head`. Po upgrade istnieje 1 konto EXTERNAL i po 1 koncie na każdy inwentarz, a tabela `pledges` jest pusta.
10. Grep potwierdza, że przypisania `inventory_id`/`home_inventory_id`/`deleted_at` itemu występują wyłącznie w `post_movement` (oraz w konstruktorze w `register_item`).
11. Build i typecheck frontendu przechodzą po usunięciu `accounts.ts`. Dokumenty z sekcji „Dokumentacja” są zaktualizowane.

## Założenia i znane ograniczenia

- **Założenie A0 (baza UUID)**: spec zakłada stan po `0041_baseentity_id_uuid.py` (commit `23a5dd8`). Jeśli przed implementacją pojawi się inna rewizja po 0041, numer i `down_revision` migracji księgi trzeba przesunąć.
- **Założenie A1**: `confirm_transaction` korzysta z `fulfill_exchange` także dla LEND i GIFT, nie tylko dla SWAP. Daje to jedną ścieżkę kodu i jeden commit dla confirm + fulfill. Wymagania na to pozwalają („dla LEND/GIFT istniejące zachowanie może zostać”), a zmiana jest nadzbiorem wymaganej atomowości.
- **Założenie A2 (zmienione po audycie, H1)**: `fulfill_exchange` i `cancel_exchange` przyjmują `acting_user_id` i same wymagają, żeby aktor był `giver_user_id` lub `reserved_by_user_id` którejś nogi (403). Wewnętrzne przejścia nóg wykonują się w imieniu posiadacza każdej nogi. Groups zachowuje swój `_require_race_participant` jako bramkę specyficzną dla Terminu.
- **Założenie A3**: REGISTER tworzy item z `inventory_id` docelowym w konstruktorze (NOT NULL), a `post_movement` jest wtedy no-opem projekcji. Nie jest to „przeniesienie” poza funkcją ruchu.
- **Założenie A4**: RETURN bez `home_inventory_id` daje teraz 409 zamiast cichego no-opu, a fulfill pojedynczej nogi SWAP daje 409. Obie ścieżki są dziś nieosiągalne z UI.
- **Założenie A5 (H2)**: wymiana SWAP w obecnych przepływach groups zachodzi między inwentarzami PERSONAL obu stron (`to` każdej nogi to `get_or_create_personal_inventory(reserved_by)`, a itemy wystawia się z PERSONAL). Item leżący w PICKUP_POINT lub VIRTUAL nie może być przedmiotem SWAP (409).
- **Ograniczenie L1**: `occurred_at` to naiwny UTC (`utcnow`), spójnie z resztą modelu. Porównania z czasem lokalnym Terminów pozostają osobnym zadaniem.
- **Ograniczenie L2**: migracja 0042 kasuje wszystkie itemy, rezerwacje, pledge i powiązane wymiany na lokalnej bazie, a downgrade ich nie przywraca. Zostają inwentarze, potrzeby Terminów i powiadomienia niezwiązane z wymianą ani pledge. To zgodne z decyzją użytkownika.
- **Ograniczenie L3**: pełne „dokładnie jedno EXTERNAL” zapewniają indeks częściowy (co najwyżej jedno) i seed w 0042 (co najmniej jedno). Nie ma ograniczenia DB zabraniającego usunięcia tego wiersza, ale nie istnieje też kod, który by go usuwał.
- **Ograniczenie L4 (race, L8)**: jeśli obie strony `confirm_transaction` miną bramkę statusu równocześnie, druga dostanie generyczne 409 z `StaleDataError` zamiast `TermAlreadyResolved`. Tak jest dziś i ten spec tego nie zmienia.
- **Ograniczenie L5**: lekki test migracji w środowisku testowym sprawdza seed EXTERNAL i niezmiennik „konto dla każdego inwentarza”. Ścieżka seedu kont dla już istniejących inwentarzy (`INSERT … SELECT FROM inventories`) jest w testach pusta, bo baza testowa po 0041 nie ma inwentarzy. Weryfikuje się ją ręcznie na lokalnej bazie (krok 2 „Weryfikacji ręcznej”).
- **Ograniczenie L6**: stan schematu 0041 (do którego prowadzi downgrade) nie ma konta emisji `900-100`, więc kod punktowy z tej rewizji nie zaksięguje fulfill. To cecha 0041, a nie tego spec.
