# Raport analizy kodu

**Data**: 2026-09-28
**Zadanie**: Przebudowa księgi `app.circulation` z księgi punktów na księgę ruchów przedmiotów między inwentarzami
**Opis**: Przebudować księgę `app.circulation` (`Account`, `CirculationEntry`, `CirculationTransaction`), która dziś jest księgą punktów (+1 dla dającego), tak aby księgowała RUCHY PRZEDMIOTÓW między inwentarzami użytkowników w stylu księgowym. Przykład: A daje B przedmiot X → jedna transakcja, w której X wychodzi z inwentarza A i wchodzi do inwentarza B. Dzięki temu każdy przedmiot ma pełną historię przez GIFT, LEND, RETURN, SWAP. Wcześniejszy research (encja Loan) użytkownik uznał za niezgodny ze swoją intencją.
**Analizator**: codebase-analyzer skill (2 agenty Explore: Code Analysis + File Discovery, Context Discovery)

---

## Podsumowanie

Obecna księga jest formalnie podwójnym zapisem: każde księgowanie tworzy jeden DEBIT i jeden CREDIT o tej samej kwocie. Brakuje jednak ograniczenia albo kontroli bilansowania. Jednostką są punkty (płaskie `Decimal("1")`), a kontami są konto punktów per użytkownik (`100-{user_id}`) i jedno konto systemowe emisji (`900-100`). Transakcje i zapisy nie mają `item_id`, `reservation_id` ani inwentarza źródłowego i docelowego, więc z księgi nie da się odtworzyć historii przedmiotu. Zasięg zmian jest mały. Księgę zapisuje dokładnie jedno miejsce (`fulfill_reservation`, `reservation_transitions.py:139`), czytają ją tylko 3 endpointy GET, 2 obszary testów i nieużywany moduł frontendu `api/accounts.ts`. Poza `app/circulation` nikt nie importuje encji księgi. Główna praca to projekt schematu kont i zapisów, migracja 0041+ (i ewentualny przybliżony backfill), zapis SWAP jako jednej atomowej transakcji oraz zdarzenia otwarcia i zamknięcia (rejestracja, soft delete).

Ważne: dokument referencyjny `docs/system-wypozyczalni-inventory-accounting.md` sam opisuje model PUNKTOWY („Inventory + Punkty za Obieg”). Żądana przebudowa jest więc **zmianą intencji**, a nie powrotem do dokumentu, i dokument trzeba będzie zaktualizować.

---

## Zidentyfikowane pliki

Ścieżki względem `src/backend/`, o ile nie zaznaczono inaczej.

### Pliki główne

**app/circulation/models.py** (302 linie)
- Enumy (`:44-87`): `AccountType` (USER_BALANCE, SYSTEM_EMISSION), `InventoryType` (PERSONAL, PICKUP_POINT, VIRTUAL), `BalanceStatus` (AVAILABLE, RESERVED, IN_TRANSIT, LENT, RETURNED; RETURNED nigdy nie jest ustawiany), `ReservationType` (LEND, RETURN, SWAP, GIFT), `ReservationStatus`, `EntrySide` (DEBIT, CREDIT). Wszystkie zapisane jako VARCHAR przez `_enum_column(native_enum=False)` (`:31`).
- `Account` (`:90-113`), `Inventory` (`:116-132`), `InventoryItem` (`:135-168`), `InventoryBalance` (`:171-188`), `Reservation` (`:191-245`), `CirculationTransaction` (`:248-271`), `CirculationEntry` (`:274-302`).
- Tu trzeba zmienić model kont i zapisów.

**app/circulation/infrastructure/ledger.py** (98 linii)
- Jedyny zapisujący do księgi: `get_or_create_user_balance_account` (`:39-52`), `_get_emission_account` (`:55-59`), `post_circulation` (`:62-98`, tylko flush, commit robi wołający).
- `:68` `datetime.utcnow().date()`: przestarzałe `utcnow`, sama data bez czasu.
- Do przepisania na `post_item_movement` lub podobną funkcję.

**app/circulation/application/reservation_transitions.py** (145 linii)
- `confirm_reservation` (`:47`), `cancel_reservation` (`:65`), `fulfill_reservation` (`:90-145`).
- Zawiera wszystkie 3 miejsca fizycznego ruchu przedmiotu: LEND (`:105-117`), RETURN (`:118-126`), GIFT/SWAP (`:127-134`). Zawiera też jedyne wywołanie księgi (`:139-141`) i commit per wywołanie (`:143`).
- To naturalny punkt integracji dla księgowania ruchu (skąd, dokąd, przedmiot, rezerwacja, typ).

**app/circulation/application/accounts.py** (39 linii)
- `get_account_balance` (`:16-23`) sumuje DEBIT−CREDIT w Pythonie. Woła get-or-create i `db.commit()`, więc GET może zapisać wiersz konta.
- `get_transaction` (`:26`), `list_transactions_for_account` (`:36`).

**app/circulation/infrastructure/repository.py** (223 linie)
- Zapytania księgi `:130-162`: `find_account_by_code`, `list_entries_for_account`, `find_transaction_with_entries` (selectinload entries + joinedload account), `list_transactions_for_account` (sortuje tylko po `transaction_date desc`, więc kolejność w obrębie dnia jest niedeterministyczna).
- `list_reservations_for_item` (`:171`) nie ma ORDER BY.

**app/circulation/schemas.py** (174 linie)
- `AccountResponse`, `AccountBalanceResponse`, `CirculationEntryResponse`, `CirculationTransactionResponse` (`:140-176`).

**app/circulation/router.py** (269 linii)
- `GET /api/accounts/{user_id}/balance` (`:241`), `GET /api/circulation-transactions?account_id=` (`:252`), `GET /api/circulation-transactions/{id}` (`:262`).
- Raw rezerwacje (`:169-235`, tylko RETURN), inventory-items (`:103-163`), inventories (`:76-100`).

**app/circulation/domain/constants.py** (10 linii)
- `_EMISSION_ACCOUNT_CODE = "900-100"` (`:8`), `_POSTED_AMOUNT = Decimal("1")` (`:10`).

**alembic/versions/0004_circulation_schema.py**, **0005_seed_emission_account.py**
- Schemat tabel `accounts`, `circulation_transactions`, `circulation_entries` plus sekwencje. Seed konta `900-100` (`ON CONFLICT DO NOTHING`).

### Pliki powiązane

**app/circulation/application/reservations.py** (184 linie)
- `_resolve_return_term_id` (`:34`), `_current_holder_user_id` (`:57`, właściciel `item.inventory_id`, czyli fizyczny posiadacz), `create_reservation` (`:68`), `create_return_reservation` (`:124`), `create_lend_reservation` (`:147`).

**app/circulation/application/inventory_items.py** (178 linii)
- `register_item` (`:31`) byłby ruchem otwarcia, `soft_delete_item` (`:166`) ruchem zamknięcia. `update_item` (`:149`) może zmienić `product_id`/`condition` bez żadnego logu.
- `get_active_reservation_id_for_item` (`:104-121`), `resolve_owning_inventory` (`:124`, właściciel prawny, a nie fizyczny posiadacz).

**app/circulation/application/inventory.py**
- Get-or-create inventory (`:37-63`) z obsługą SAVEPOINT/IntegrityError. To wzorzec, którego brakuje w `get_or_create_user_balance_account`.

**app/circulation/domain/reservation_rules.py** (45 linii)
- `:13`, `:20` (confirm tylko przez posiadacza), `:34` (`require_raw_route_reservation_type`, tylko RETURN), `:44` `_next_transaction_number` (`TRX-<12 hex>`).

**app/circulation/service.py** (88 linii)
- Fasada. Re-eksportuje funkcje księgi (`:16-20, 65, 82`).

**app/groups/application/term_item_listings.py** (848 linii)
- `take_item_listing` (`:425`, LEND), `propose_swap` (`:495`), `accept_swap_proposal` (`:592`, wiązanie `paired_reservation_id` `:640-641`), `reject_swap_proposal` (`:658`), `_resolve_transaction_reservations_for_action` (`:698`), `confirm_transaction` (`:782-822`, fulfill per noga SWAP, więc 2 transakcje i 2 commity), `cancel_transaction` (`:825-848`).

**app/groups/infrastructure/circulation_bridge.py** (205 linii)
- Jedyny zewnętrzny konsument circulation. Re-eksportuje tylko `BalanceStatus`, `Inventory`, `InventoryBalance`, `InventoryItem`, `InventoryType`, `Reservation`, `ReservationStatus`, `ReservationType`. Nie dotyka księgi. Pass-through dla confirm/cancel/fulfill (`:105-125`), `resolve_current_holder_user_id` (`:128-137`).

**app/groups/application/pledge_fulfillment.py** (122 linie)
- `create_lend_reservation` + auto-confirm (`:79-91`), `sync_pledge_fulfillment` (`:117`).

**app/core/authorization_matrix.py**
- Wiersz 44 `GET ^/api/accounts(/.*)?$` READ/mcp:read (`:161`), wiersz 45 `GET ^/api/circulation-transactions(/.*)?$` READ/mcp:read (`:162`). Nowa trasa `/api/inventory-items/{id}/history` mieści się w wierszu 40.

**src/frontend/src/api/accounts.ts**
- `getAccountBalance`, `getTransactionsForAccount`, `getTransaction`. Nic tego nie importuje, więc można to swobodnie zastąpić.

**src/frontend/src/api/reservations.ts**, **src/frontend/src/.../PanelDataContext.tsx**, **RzeczyView.tsx**
- `returnBorrowedItem` (`PanelDataContext.tsx:1350-1364`): pożyczający sam tworzy, potwierdza i realizuje RETURN.
- `confirmTransaction`/`cancelTransaction` (`PanelDataContext.tsx:830`, `RzeczyView.tsx:144,159`).
- Frontendowe „balance” to status przedmiotu (`api/inventories.ts:58,109`), a nie saldo księgi.

**docs/system-wypozyczalni-inventory-accounting.md**
- Dokument referencyjny modelu punktowego. Wymaga aktualizacji pod nową intencję.

**Migracje historyczne**: 0007 (czyszczenie danych circulation), 0008 (`product_id` → `products`), 0017 (`deleted_at`), 0030 (`home_inventory_id`), 0033 (partial unique PERSONAL/VIRTUAL per user), 0034 (`reservations.term_id` + backfill), 0039 (`reservations.giver_user_id`, backfill przybliżony), 0040 (ostatnia). Nowa migracja to **0041**.

---

## Obecna funkcjonalność

### Kluczowe komponenty i funkcje

- **Account**: `code` String(20) unikalny (eq/hash po code), `name`, `account_type`, `owner_user_id` (nullable FK users). Per użytkownik `100-{user_id}` („Saldo punktow uzytkownika”, tworzone leniwie). Systemowe `900-100` SYSTEM_EMISSION, zaseedowane. Gdy go brakuje, leci `EntityNotFoundException`.
- **CirculationTransaction**: `transaction_number` `TRX-<12 hex>` (unikalny), `transaction_date` (tylko Date), `description` (wolny tekst `"{TYPE}: {product.name}"`), `is_posted` (zawsze True), `entries` lazy="raise". **Brak FK** do rezerwacji, przedmiotu, użytkownika i terminu.
- **CirculationEntry**: `transaction_id`, `account_id`, `amount` Numeric(12,2) (zawsze dodatni, stronę niesie `entry_side`), `entry_side`, `description`, `entry_date`. Brak ograniczenia debet = kredyt.
- **post_circulation**: DEBIT `100-{giver}` +1, CREDIT `900-100` +1 („Emisja punktow za obieg - ...”).
- **Inventory**: `owner_user_id` NOT NULL, `inventory_type`, `location`. Użytkownik ma jeden PERSONAL i jeden VIRTUAL (VIRTUAL to miejsce przechowania dla pożyczającego).
- **InventoryItem**: `inventory_id` (bieżąca fizyczna lokalizacja, nadpisywana), `home_inventory_id` (ustawiony tylko w trakcie pożyczki), `deleted_at`.
- **InventoryBalance**: 1:1 z przedmiotem, pojedynczy mutowalny wiersz (`status`, `reserved_at`, `lent_at`, `returned_at`, `due_date`).
- **Reservation**: `item_id`, `reservation_type`, `reserved_by_user_id` (strona ZYSKUJĄCA przedmiot), `giver_user_id` (posiadacz w chwili utworzenia, NOT NULL od 0039), `term_id` (NOT NULL od 0034), `paired_reservation_id` (SWAP), `status`. Brak `confirmed_at`/`fulfilled_at`/`cancelled_at`.

### Przepływ per typ rezerwacji

Wspólne: posiadacz jest zawsze liczony na świeżo jako właściciel `item.inventory_id` przed mutacją (`reservation_transitions.py:36-44, 98`). Księga uznaje tego posiadacza, a nie `reservation.giver_user_id` (zwykle są równi).

- **create**: wymaga AVAILABLE (dla RETURN: LENT). Typy inne niż RETURN wymagają `home_inventory_id IS NULL`. Ustawia `giver_user_id = holder`, balance RESERVED, a dla typów innych niż RETURN `due_date = expires_at`.
- **confirm**: tylko PENDING i tylko posiadacz. Skutek: CONFIRMED, balance IN_TRANSIT. Bez księgi.
- **cancel**: może każda ze stron. RETURN wraca do LENT (zachowuje `lent_at`/`due_date`), pozostałe do AVAILABLE.
- **fulfill**: tylko CONFIRMED. Po gałęzi typu następuje FULFILLED, `post_circulation(giver=holder, 1, ...)` i commit.

| Typ | Ruch fizyczny | Księga dziś |
|-----|---------------|-------------|
| LEND | `home_inventory_id = PERSONAL(A)`, `inventory_id = VIRTUAL(B)` (get-or-create); LENT, `due_date = expires_at` lub +14 dni | Dt `100-A` +1 / Ct `900-100` |
| RETURN | `inventory_id = home_inventory_id`, `home = None`; AVAILABLE, `returned_at` | Dt `100-B` +1 (zarabia pożyczający) |
| GIFT | `inventory_id = PERSONAL(B)` (get-or-create); AVAILABLE | Dt `100-A` +1 |
| SWAP | dwie nogi, każda przez gałąź GIFT: Y → PERSONAL(O), X → PERSONAL(P) | dwie niezależne, niepowiązane transakcje, dwa commity (**nieatomowo**) |

### Co jest nadpisywane, a co dopisywane

- **Nadpisywane (historia tracona)**: `InventoryItem.inventory_id` i `home_inventory_id`; cały wiersz `InventoryBalance` (np. `lent_at`/`due_date` zerowane przy RETURN, `returned_at` nadpisywane); `Reservation.status` (bez znaczników czasu przejść); `product_id`/`condition` przez PATCH.
- **Dopisywane**: wiersze `Reservation` (nigdy nie usuwane); `CirculationTransaction`/`CirculationEntry`.
- **Najbliższy dziś proxy historii**: FULFILLED rezerwacje przedmiotu posortowane po id. Nie mają jednak id inwentarzy from/to ani znacznika realizacji. Rejestracja i soft delete nie są ruchami. `giver_user_id` jest przybliżony dla wierszy z backfillu 0039.

### Przepływ danych

Groups (`take_item_listing`, `propose_swap`/`accept_swap_proposal`, `pledge_fulfillment`) tworzą rezerwacje przez `circulation_bridge`. Potem `confirm_transaction` (groups) albo raw `/api/reservations/{id}/fulfill` (tylko RETURN) wywołuje `fulfill_reservation`, które mutuje `InventoryItem`/`InventoryBalance` i woła `post_circulation`, a to zapisuje `circulation_transactions` i `circulation_entries`. Odczyt idzie przez `GET /api/accounts/{user_id}/balance` i `/api/circulation-transactions*`, ale nie ma konsumenta w UI.

---

## Zależności

### Importy (od czego zależy)

- SQLAlchemy 2.0 async (`AsyncSession`, `selectinload`/`joinedload`), `BaseEntity` (sekwencje, `created_at`/`updated_at`, optimistic locking).
- `users.id`, `products.id`, `terms.id`: cross-module FK jako zwykłe kolumny id.
- `EntityNotFoundException` i typowane wyjątki z `app.core`.
- `app/circulation/application/inventory.py`: get-or-create PERSONAL/VIRTUAL.

### Konsumenci (co zależy od księgi)

- **app/circulation/application/reservation_transitions.py**: jedyny wołający `post_circulation`.
- **app/circulation/application/accounts.py**, **router.py**, **schemas.py**, **service.py**: odczyt i ekspozycja.
- **tests/test_circulation.py**, **tests/test_term_item_listings.py**: asercje księgi.
- **src/frontend/src/api/accounts.ts**: zdefiniowany, nieużywany.
- Pośrednio przez `fulfill_reservation`: `app/groups/application/term_item_listings.py`, `app/groups/application/pledge_fulfillment.py`, `app/groups/infrastructure/circulation_bridge.py`, raw router rezerwacji.

**Liczba konsumentów**: ok. 5 plików bezpośrednio czyta lub zapisuje encje księgi (poza samymi modelami), a 4 pliki korzystają pośrednio przez `fulfill_reservation`.
**Zakres wpływu**: Niski-średni. Encji księgi nie importuje nic spoza `app/circulation`. Jedyny szeroki kontrakt to sygnatura `fulfill_reservation` wołana przez groups przez bridge. Jeśli sygnatura zostanie zachowana, groups nie wymaga zmian (poza atomowością SWAP).

---

## Pokrycie testami

### Pliki testów

- **tests/conftest.py**: sesyjny `PostgresContainer("postgres:18")`, `alembic upgrade head` w subprocesie (stąd istnieje konto emisji), `db_session` z rollbackiem SAVEPOINT per test, klient httpx ASGI z override `get_db`.
- **tests/test_circulation.py** (1126 linii):
  - `:490` `test_fulfillLend_postsCirculationTransactionCreditingOwner` (saldo +1). To jedyna asercja księgi w tym pliku.
  - Ruch przedmiotu bez asercji księgi: `:332` (LEND → VIRTUAL), `:366` (RETURN → home), `:578` (fulfill przez bridge), `:741` (RETURN `term_id`), `:818` (backfill 0034), `:1025` (re-lend odrzucony).
- **tests/test_term_item_listings.py** (2037 linii):
  - Helper `_latest_ledger_entries_for_giver` (`:136-170`, `Account.code == f"100-{uid}"`, wpisy DEBIT).
  - `:1659` `test_confirmTransaction_giftFulfillment_postsCirculationTransactionAndEntries` (is_posted, nazwa produktu w opisie, 2 wpisy, debet = kredyt).
  - `:1710` `test_confirmTransaction_swapFulfillment_postsCirculationTransactionAndEntriesPerLeg` (dwie transakcje, po jednej na dającego).
  - Audyty księgi dla GIFT/LEND/SWAP w okolicy `:1571-1770`. Sprawdzenia `/balance` w `:1863-2033`.
- **tests/test_lend_step0_fixes.py**: reguły raw RETURN, cancel zachowuje LENT/`due_date`, confirm-transaction dla RETURN daje 409, listing pożyczonych, `term_end_scan`.
- **tests/test_term_item_listings_router.py** (`:871`), **tests/test_pledge_fulfillment.py** (bez księgi), **tests/test_authorization_matrix.py** (bez przypadków dla accounts/circulation-transactions).
- Frontend: żaden test nie dotyka accounts ani punktów.

### Ocena pokrycia

- **Liczba testów księgi**: 3 bezpośrednie asercje plus helper. Kilkanaście testów dotyka ruchu przedmiotu przez fulfill.
- **Luki**:
  - brak asercji księgi dla RETURN;
  - brak testów `GET /api/circulation-transactions*` i `/api/accounts/{id}/balance`;
  - brak testu ścieżki braku konta emisji;
  - brak testu historii per przedmiot;
  - brak testów authz dla wierszy 44/45;
  - brak testu atomowości SWAP i wyścigu get-or-create konta.

---

## Wzorce kodowania

### Konwencje nazewnictwa

- **Encje**: PascalCase, `__tablename__` w liczbie mnogiej snake_case, `__sequence_name__` jawny (`*_seq`).
- **Funkcje**: snake_case. Prywatne helpery i stałe z prefiksem `_` (`_POSTED_AMOUNT`, `_current_holder_user_id`).
- **Pliki**: warstwy `domain/` (reguły, stałe), `application/` (use-case'y), `infrastructure/` (repository, ledger) za płaską fasadą `service.py`. Importy z zewnątrz tylko z `app.<v>.service`.
- **Testy**: `test_<akcja>_<warunek>_<oczekiwanie>` (camelCase w segmentach).
- **Migracje**: `00NN_<opis>.py`, FK `fk_<table>_<col>_<ref>`.

### Wzorce architektoniczne

- **Styl**: funkcyjny (funkcje modułowe przyjmujące `db: AsyncSession`), DDD-owe warstwy, bez klas serwisowych.
- **Zarządzanie stanem**: PostgreSQL przez SQLAlchemy async. Commit robi warstwa application (`fulfill_reservation`), a infrastruktura tylko flushuje.
- **Standardy (models.md)**: `BaseEntity` + jawny `Sequence`; StrEnum jako String przez `_enum_column(native_enum=False)`; Numeric dla kwot; relacje `lazy="raise"` + jawne `selectinload`/`joinedload`; eq/hash po kluczu biznesowym; cross-module jako zwykłe FK id; kolumny zamiast nowych klas, gdy to wystarcza.
- **Standardy (migrations.md)**: prawdziwy `downgrade` w kolejności zależności; `CREATE SEQUENCE ... OWNED BY`; zmiany schematu i danych w **osobnych** rewizjach (backfill i usunięcie seedu 0005 to osobne rewizje danych).

---

## Ocena złożoności

| Czynnik | Wartość | Poziom |
|---------|---------|--------|
| Rozmiar plików | ok. 1 860 linii modułu; księga ok. 140 linii (`ledger.py` 98 + `accounts.py` 39); `models.py` 302; `reservation_transitions.py` 145 | Średni |
| Pliki do zmiany | ok. 10–12 (models, ledger, accounts, repository, schemas, router, service, constants, reservation_transitions, inventory_items, migracje, testy, FE `accounts.ts`, docs) | Wysoki |
| Zależności | SQLAlchemy, BaseEntity, inventory helper, FK users/products/terms | Niski |
| Konsumenci | 1 miejsce zapisu, ok. 5 odczytu, 4 pośrednie przez fulfill | Średni |
| Pokrycie testami | 3 asercje księgi, dobre pokrycie ruchów przedmiotu | Średni (częściowe) |

### Ogólnie: Umiarkowana

Logika domenowa jest skupiona w jednej funkcji (`fulfill_reservation`) i ma jeden punkt zapisu. Rzeczywista złożoność leży w projekcie modelu księgowego (jakie konta, jednostka ilości, czy item na zapisie, czy zdarzenia otwarcia i zamknięcia), w migracji zmieniającej znaczenie istniejących tabel oraz w decyzji o backfillu historii z FULFILLED rezerwacji.

---

## Kluczowe ustalenia

### Mocne strony
- Dokładnie jeden punkt zapisu księgi (`reservation_transitions.py:139`) i dokładnie trzy miejsca ruchu przedmiotu, wszystkie w `fulfill_reservation`.
- Struktura podwójnego zapisu (Transaction → Entries, DEBIT/CREDIT) już istnieje, więc można ją przeprojektować zamiast budować od zera.
- Encje księgi nie wyciekają poza `app/circulation`. `circulation_bridge` ich nie re-eksportuje.
- Frontend nie wyświetla punktów (`api/accounts.ts` nieużywany), więc nie ma kosztu kompatybilności UI. Aplikacja jest przed produkcją, więc zmiana i usuwanie URL-i są dopuszczalne.
- `Inventory` już modeluje miejsca przechowania (PERSONAL, VIRTUAL, PICKUP_POINT). To naturalni kandydaci na „konta” w modelu ruchów.

### Obawy
- **SWAP nieatomowy**: `confirm_transaction` realizuje każdą nogę osobnym `fulfill_reservation` z własnym commitem (`:143`). Awaria między nogami zostawia pół wymiany. W modelu ruchów SWAP powinien być jedną transakcją z czterema zapisami.
- **Wyścig w `get_or_create_user_balance_account`**: brak SAVEPOINT i obsługi IntegrityError (w przeciwieństwie do `application/inventory.py:37-63`), więc dwa równoległe pierwsze księgowania uderzą w `uq_accounts_code`.
- **GET zapisuje**: `get_account_balance` tworzy konto i commituje przy odczycie.
- **Czas**: `datetime.utcnow().date()` (przestarzałe, sama data, UTC), podczas gdy groups porównuje Termy z lokalnym `datetime.now()`. Sortowanie tylko po dacie daje niedeterministyczną kolejność w obrębie dnia, a to jest niedopuszczalne dla historii przedmiotu.
- **Posiadacz a `giver_user_id`**: księga uznaje posiadacza liczonego na świeżo, a nie `giver_user_id`. Dla wierszy z backfillu 0039 wartości mogą się różnić, co ma znaczenie przy backfillu historii.
- **Brak kontroli bilansu**: nic nie wymusza sumy debetów równej sumie kredytów w transakcji.
- **Rozjazd dokumentu i kodu**: dokument INV opisuje punkty, konto `100-100`, `Product.value` i pożyczony przedmiot zostający w inwentarzu właściciela. Kod ma `100-{user_id}`, płaskie 1, VIRTUAL + `home_inventory_id`, a `RETURNED` jest nieużywane.
- **Dwa pojęcia „właściciela”**: prawny (`resolve_owning_inventory` / `home_inventory_id`) i fizyczny (`inventory_id`). Model ruchów musi jawnie rozstrzygnąć, co księguje (zapewne fizyczne przemieszczenie między inwentarzami, a własność LEND wynika z `home_inventory_id`).

### Szanse
- Konta mogą odpowiadać inwentarzom (np. FK `inventory_id` na `Account` albo bezpośrednio zapisy na `Inventory`), z kontem systemowym „źródło/zewnętrzne” dla rejestracji (`register_item`) i soft delete (`soft_delete_item`). Wtedy saldo inwentarza w danej chwili daje zbiór przedmiotów, a zapisy per `item_id` dają pełną historię.
- Dodanie `item_id`, `reservation_id` i typu ruchu na transakcji lub zapisie pozwala złączyć księgę z rezerwacjami, czego dziś brakuje.
- Nowy endpoint `GET /api/inventory-items/{id}/history` jest już objęty wierszem 40 macierzy autoryzacji.
- Przy okazji: zamiana `utcnow` na znacznik czasu z strefą (`timestamptz`), deterministyczne sortowanie oraz naprawa wzorca get-or-create.

---

## Ocena wpływu

- **Zmiany główne**: `app/circulation/models.py`, `app/circulation/infrastructure/ledger.py`, `app/circulation/application/reservation_transitions.py`, `app/circulation/application/accounts.py`, `app/circulation/infrastructure/repository.py`, `app/circulation/schemas.py`, `app/circulation/router.py`, `app/circulation/service.py`, `app/circulation/domain/constants.py`, nowa migracja `alembic/versions/0041_*.py` (schemat) oraz osobne rewizje danych (usunięcie seedu `900-100` / nowy seed konta systemowego, opcjonalny backfill).
- **Zmiany powiązane**: `app/circulation/application/inventory_items.py` (`register_item`, `soft_delete_item` jako ruchy otwarcia i zamknięcia); `app/groups/application/term_item_listings.py` (`confirm_transaction`, atomowy SWAP); ewentualnie `app/groups/infrastructure/circulation_bridge.py`, jeśli zmieni się sygnatura fulfill; `app/core/authorization_matrix.py` (wiersze 44/45, jeśli zmienią się URL-e); `src/frontend/src/api/accounts.ts` (zastąpić lub usunąć); `docs/system-wypozyczalni-inventory-accounting.md` oraz `.maister/docs/project/architecture.md`.
- **Aktualizacja testów**:
  - przepisać `tests/test_circulation.py:490`, helper `tests/test_term_item_listings.py:136-170`, `:1659`, `:1710` oraz audyty `:1571-1770`;
  - dodać testy ruchu dla RETURN, rejestracji, soft delete, atomowego SWAP (jedna transakcja, cztery zapisy), historii per przedmiot, endpointów odczytu i bilansowania (debet = kredyt);
  - testy migracji i backfillu na wzór `:818`.

### Poziom ryzyka: Średni

Zasięg kodu jest mały (jeden writer, brak UI, brak zewnętrznych importów encji księgi). Ryzyko podnoszą: (1) zmiana znaczenia istniejących tabel i danych, która wymaga migracji z prawdziwym downgrade oraz decyzji: przebudować `accounts`/`circulation_*` czy dodać nowe struktury; (2) przybliżony backfill historii z FULFILLED rezerwacji (brak inwentarzy from/to i znaczników realizacji, przybliżony `giver_user_id`); (3) zmiana atomowości SWAP wpływająca na przepływ groups `confirm_transaction`; (4) wymóg deterministycznej kolejności ruchów w historii.

---

## Rekomendacje

Typ zadania: **modyfikacja istniejącego kodu ze zmianą intencji modelu** (istniejąca księga punktów → księga ruchów przedmiotów).

### Strategia implementacji
1. **Najpierw ustalić model księgowy** (np. skillem `accounting-archetype-mapper`):
   - Zasób: przedmiot (`InventoryItem`), ilość 1.
   - Konta: per `Inventory` (PERSONAL, VIRTUAL, PICKUP_POINT) plus konto systemowe źródła/zewnętrzne dla wejścia do systemu i wyjścia z niego.
   - Transakcja ruchu: CREDIT (wyjście) z konta inwentarza źródłowego, DEBIT (wejście) na konto inwentarza docelowego, oba z `item_id`.
   - Rozstrzygnąć, czy konto to nowa kolumna `Account.inventory_id` (zachowując tabelę `accounts`), czy zapisy bezpośrednio na `inventory_id`. Standard „kolumny zamiast nowych klas” przemawia za rozbudową istniejących tabel.
2. **Schemat**: na `CirculationTransaction` dodać `reservation_id` (nullable FK, bo rejestracja i soft delete nie mają rezerwacji), typ ruchu (StrEnum: np. REGISTER, LEND, RETURN, GIFT, SWAP, REMOVE) i znacznik czasu `timestamptz`. Na `CirculationEntry` dodać `item_id` (FK `inventory_items`) i ilość (`quantity` = 1 zamiast punktów albo reinterpretacja `amount`). Indeksy `(item_id, occurred_at)` pod historię i `(account_id, ...)` pod stan inwentarza. Opcjonalnie deferrable check bilansu per transakcja, przynajmniej jako walidacja w `ledger.py`.
3. **Punkt zapisu**: zastąpić `post_circulation` funkcją w stylu `post_item_movement(db, *, item, from_inventory_id, to_inventory_id, reservation, movement_type)` wołaną w każdej z 3 gałęzi `fulfill_reservation` **przed** mutacją `inventory_id`, gdy from jest jeszcze znany. Dla SWAP dodać wariant księgujący obie nogi w jednej transakcji (4 zapisy) i przenieść commit tak, by obie nogi były atomowe, np. `fulfill_swap_pair` w circulation wołane przez bridge z `confirm_transaction`.
4. **Otwarcie i zamknięcie**: `register_item` księguje ruch źródło → PERSONAL(owner), `soft_delete_item` księguje bieżący inwentarz → wyjście. Dzięki temu saldo inwentarza jest spójne z `InventoryItem.inventory_id`.
5. **Odczyt**: zastąpić `GET /api/accounts/{user_id}/balance` i `/api/circulation-transactions*` endpointami historii przedmiotu (`GET /api/inventory-items/{id}/history`, objęty wierszem 40) i ewentualnie ruchów inwentarza. Pozbyć się zapisu przy GET. Deterministyczne sortowanie po `(occurred_at, id)`.
6. **Migracje** (osobne rewizje zgodnie z `migrations.md`): 0041 schemat (nowe kolumny i indeksy, ewentualnie sekwencje `OWNED BY`), 0042 dane (usunięcie punktowych transakcji i zapisów oraz kont `100-*`/`900-100`, seed konta systemowego lub kont per inventory), opcjonalnie 0043 przybliżony backfill historii z FULFILLED rezerwacji (oznaczony jako przybliżony) lub świadoma rezygnacja z niego. To decyzja dla użytkownika. Środowisko jest przed produkcją, a lokalna baza pełna testowych danych, co przemawia za prostym resetem zamiast backfillu. Przed `alembic upgrade head` załadować `.env`.
7. **Poprawki przy okazji**: get-or-create konta z SAVEPOINT/IntegrityError (wzorzec z `application/inventory.py:37-63`), zamiana `datetime.utcnow()` na świadomy strefy znacznik czasu.

### Kompatybilność wsteczna
- Nie jest wymagana: brak konsumentów UI, aplikacja przed produkcją. Usunąć `_POSTED_AMOUNT`, `AccountType.USER_BALANCE`/`SYSTEM_EMISSION` (lub przemianować) i nieużywany `api/accounts.ts`.
- Zachować sygnaturę `fulfill_reservation` dla LEND/GIFT/RETURN, żeby nie dotykać `pledge_fulfillment` ani raw routera.

### Wymagania testowe
- Integracyjne na prawdziwym PostgreSQL (TestContainers), 2–8 testów na grupę funkcji. Każdy typ ruchu (REGISTER, LEND, RETURN, GIFT, SWAP, REMOVE) sprawdza: jedna transakcja, suma wyjść równa sumie wejść, poprawne from/to, `item_id`, `reservation_id`.
- Historia przedmiotu po sekwencji LEND → RETURN → GIFT → SWAP ma pełną, uporządkowaną listę ruchów.
- SWAP atomowy: wymuszona awaria drugiej nogi nie zostawia pierwszej zrealizowanej.
- Stan inwentarza z księgi zgodny z `InventoryItem.inventory_id`.
- Endpointy historii i macierz autoryzacji.

---

## Następne kroki

1. Wywołać **gap-analyzer**, żeby porównać stan obecny (księga punktów) z docelowym (księga ruchów przedmiotów). Szczególnie wskazać decyzje wymagające potwierdzenia użytkownika:
   - konta per inventory czy per użytkownik;
   - czy rejestracja i soft delete są ruchami;
   - backfill czy reset historii;
   - czy znikają punkty i endpointy salda;
   - atomowy SWAP jako jedna transakcja;
   - czy LEND księguje przeniesienie fizyczne (PERSONAL(A) → VIRTUAL(B)) oraz jak odzwierciedlić własność prawną.
2. Rozważyć `accounting-archetype-mapper` do sformalizowania modelu (zasób, konta, transakcje, zapisy, storna) przed specyfikacją.
3. Zaplanować aktualizację `docs/system-wypozyczalni-inventory-accounting.md` i `.maister/docs/project/architecture.md`.
