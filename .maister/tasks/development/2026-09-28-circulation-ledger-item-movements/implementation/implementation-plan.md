# Plan implementacji: księga ruchów przedmiotów w `app.circulation`

Źródło wiążące: `implementation/spec.md`, w tym sekcje „Zmiany po audycie” i „Warunek wstępny implementacji”. Ścieżki backendu są podane względem `src/backend/`, a frontendu względem `src/frontend/`. Numery linii pochodzą z `HEAD` `23a5dd8` i mogą się przesunąć.

## Przegląd

- Łączna liczba kroków: 47
- Grupy zadań: 6
- Oczekiwane testy: 34-42 nowe lub przepisane testy skupione (5 grup implementacyjnych po 5-8 testów) plus do 10 w grupie przeglądowej. Do tego dochodzi pełny zestaw `uv run pytest` na końcu.
- Złożoność: średnio-wysoka. Kod `app/circulation` jest mały (~1900 linii), ale zmiana dotyka modelu, migracji z czyszczeniem danych, ścieżki commitów między modułami (groups → circulation) i wielu istniejących testów.

### Dlaczego kolejność grup odbiega od sugerowanej

Usunięcie `EntrySide`, `Account.code` i starych wartości `AccountType` w `models.py` od razu psuje import `application/accounts.py`, `infrastructure/ledger.py`, `schemas.py`, `service.py` oraz modułu testów `tests/test_term_item_listings.py` (importuje `Account` i `EntrySide` na poziomie modułu). Testy httpx w `tests/conftest.py` importują aplikację, więc przy niespójnym stanie nie uruchomi się żaden test. Dlatego **Grupa 1** obejmuje model, migrację **oraz** usunięcie całego kodu punktowego (API salda, lista transakcji, wiersz 44 macierzy, FE `api/accounts.ts`) i przebudowę kształtu `GET /api/circulation-transactions/{id}`. Po każdej grupie aplikacja się importuje, a testy tej grupy można uruchomić. Grupa 5 zawiera już tylko nowe API historii.

### Okno przejściowe (świadome)

- Po Grupie 1 do końca Grupy 3 fulfill LEND nie księguje niczego (stare wywołanie `ledger.post_circulation` w `reservation_transitions.py:141` jest usuwane w G1, a nowe `post_movement` dochodzi w G3).
- Istniejące testy audytu księgi (`tests/test_circulation.py:490`, `tests/test_term_item_listings.py` okolice `:1659`, `:1710`) są czerwone od G1 do grup, które je przepisują (G3 i G4). Każda grupa uruchamia tylko swoje testy, a pełny zestaw uruchamia G6.

## Kroki implementacji

### Grupa zadań 1: Model danych, migracja 0042 i usunięcie kodu punktowego
**Zależności:** Brak
**Pliki do modyfikacji:** `app/circulation/models.py`, `alembic/versions/0042_circulation_item_movement_ledger.py` (nowy), `app/circulation/infrastructure/ledger.py`, `app/circulation/infrastructure/repository.py`, `app/circulation/application/accounts.py` (usuwany), `app/circulation/application/movements.py` (nowy), `app/circulation/application/reservation_transitions.py`, `app/circulation/domain/constants.py`, `app/circulation/schemas.py`, `app/circulation/service.py`, `app/circulation/router.py`, `app/core/authorization_matrix.py`, `tests/test_authorization_matrix.py`, `tests/ledger_assertions.py` (nowy), `tests/test_circulation_ledger.py` (nowy), `tests/test_term_item_listings.py`, `src/frontend/src/api/accounts.ts` (usuwany)
**Szacowana liczba kroków:** 11

- [x] 1.0 Ukończyć warstwę modelu, migracji i usunięcia punktów
  - [x] 1.1 Napisać 6-8 skupionych testów w `tests/test_circulation_ledger.py` (część „migracja + model + usunięcia”) oraz testy macierzy w `tests/test_authorization_matrix.py`
    - `test_migration0042_seedsExactlyOneExternalAccount`: `SELECT count(*) FROM accounts WHERE account_type='EXTERNAL'` = 1, a kolumna `code` nie istnieje (zapytanie do `information_schema.columns`).
    - `test_migration0042_everyInventoryHasExactlyOneInventoryAccount`: LEFT JOIN `inventories` → `accounts` zwraca 0 inwentarzy bez konta (w bazie testowej zbiór jest pusty, patrz ograniczenie L5 w spec).
    - `test_accountCheck_inventoryWithoutInventoryId_raisesIntegrityError`: insert `Account(account_type=INVENTORY, inventory_id=None)` + flush daje `IntegrityError` (`ck_accounts_inventory_id_account_type`).
    - `test_accountPartialIndex_secondExternal_raisesIntegrityError`: drugie EXTERNAL daje `IntegrityError` (`uq_accounts_account_type_external`).
    - `test_getAccountBalance_removedEndpoint_returns404` i `test_listCirculationTransactions_removedEndpoint_returns404` (z tokenem READ, `GET /api/accounts/{uuid}/balance` oraz `GET /api/circulation-transactions?account_id=…`).
    - W `tests/test_authorization_matrix.py`: `resolve_requirement` dla `GET /api/circulation-transactions/{uuid}` daje READ/mcp:read, a `GET /api/accounts/{uuid}/balance` trafia do catch-all (AUTHENTICATED).
    - Testy przejdą dopiero po krokach 1.2-1.10. Uruchomić je po 1.11.
  - [x] 1.2 Przebudować `app/circulation/models.py`
    - `AccountType` = {`INVENTORY`, `EXTERNAL`}, nowy `MovementType` = {`REGISTER`, `REMOVE`, `GIFT`, `LEND`, `RETURN`, `SWAP`}, usunąć `EntrySide`. Oba enumy przez `_enum_column(..., native_enum=False)` z długością 20.
    - `Account`: usunąć `code`, `name`, `owner_user_id`; dodać `inventory_id: Mapped[uuid.UUID | None]` (`postgresql.UUID(as_uuid=True)`, FK `fk_accounts_inventory_id_inventories`, UNIQUE `uq_accounts_inventory_id`), `__table_args__` z `CheckConstraint` `ck_accounts_inventory_id_account_type` oraz `Index("uq_accounts_account_type_external", "account_type", unique=True, postgresql_where=text("account_type = 'EXTERNAL'"))`, relację `inventory` (`lazy="raise"`), `__eq__`/`__hash__` po `(account_type, inventory_id)`.
    - `CirculationTransaction`: usunąć `transaction_date`, `is_posted`; dodać `movement_type` (NOT NULL) i `occurred_at: DateTime()` (NOT NULL). `entries` z `order_by=CirculationEntry.id`, `lazy="raise"`.
    - `CirculationEntry`: usunąć `amount`, `entry_side`, `description`, `entry_date`; dodać `item_id` (UUID NOT NULL, FK `fk_circulation_entries_item_id_inventory_items`), `quantity: Integer NOT NULL`, `reservation_id` (UUID NULL, FK `fk_circulation_entries_reservation_id_reservations`), indeks `ix_circulation_entries_item_id_transaction_id` na `(item_id, transaction_id)`. Bez relacji do itemu i rezerwacji.
    - Przepisać docstring modułu (`models.py:1-16`) i docstringi trzech encji: opis stanu bieżącego, bez changelogu.
  - [x] 1.3 Napisać migrację `alembic/versions/0042_circulation_item_movement_ledger.py` (`revision = "0042"`, `down_revision = "0041"`)
    - Najpierw sprawdzić w lokalnej bazie rzeczywiste nazwy indeksów i ograniczeń na `accounts` (`\d accounts` lub `pg_constraint`/`pg_indexes`), bo 0041 odtwarzał FK pod nazwami z `FK_CONSTRAINTS`.
    - Stała `_WIPE_STATEMENTS` z 12 instrukcjami w kolejności z tabeli „Upgrade, krok 1” w spec (circulation_entries → circulation_transactions → accounts → notifications (warunek z listą `kind`) → outbox_entries (4 typy zdarzeń) → giveaway_term_end_markers → swap_proposals → item_listing_preferences → pledges → reservations → inventory_balances → inventory_items).
    - Krok schematu dla `accounts`, `circulation_transactions` i `circulation_entries` według spec („Upgrade, krok 2”), z nazwami `fk_/uq_/ix_/ck_`.
    - Stała `_SEED_ACCOUNTS_STATEMENTS`: jedno EXTERNAL oraz `INSERT … SELECT gen_random_uuid(), 'INVENTORY', id, now(), now() FROM inventories`.
    - `downgrade()`: DELETE trzech tabel księgi, odwrócenie schematu do stanu 0041 (typy UUID, `uq_accounts_code`, `fk_accounts_owner_user_id_users`, indeks `ix_accounts_owner_user_id`), **bez** seedu `900-100`.
    - Docstring: odstępstwo od „Separate Schema and Data” (decyzja użytkownika, kolumny NOT NULL wymagają pustych tabel) oraz to, że downgrade nie odtwarza wyczyszczonych danych (precedens `0007`, nieodwracalne `0041`).
  - [x] 1.4 Usunąć kod punktowy z infrastruktury
    - `infrastructure/ledger.py`: usunąć `post_circulation`, `get_or_create_user_balance_account`, `_get_emission_account` i importy `EntrySide`/starych `AccountType`. Plik zostaje z docstringiem opisującym nową rolę. `post_movement` powstaje w G2.
    - `infrastructure/repository.py`: usunąć `find_account_by_code`, `list_entries_for_account`, `list_transactions_for_account`. `find_transaction_with_entries` (`:144-152`) rozszerzyć do `selectinload(CirculationTransaction.entries).joinedload(CirculationEntry.account).joinedload(Account.inventory)`.
    - `domain/constants.py`: zostawić tylko `_DEFAULT_LEND_DAYS`, usunąć `_EMISSION_ACCOUNT_CODE`/`_POSTED_AMOUNT`, zaktualizować docstring.
  - [x] 1.5 Usunąć wywołanie `ledger.post_circulation` w `application/reservation_transitions.py:141` (okno przejściowe do G3). Pozostała logika fulfill bez zmian.
  - [x] 1.6 Warstwa application i fasada
    - Usunąć `application/accounts.py`.
    - Utworzyć `application/movements.py` z `get_transaction` (przeniesione z `accounts.py`, 404 przez `EntityNotFoundException`). `get_item_history` dojdzie w G5.
    - `service.py`: usunąć `get_account_balance`, `list_transactions_for_account` i import z `accounts`, `get_transaction` importować z `movements`. Zaktualizować docstring.
  - [x] 1.7 Schematy i router
    - `schemas.py`: usunąć `AccountResponse` i `AccountBalanceResponse`. Przepisać `CirculationEntryResponse` (`id`, `account_id`, `account_type`, `inventory_id | None`, `inventory_type | None`, `owner_user_id | None`, `item_id`, `quantity`, `reservation_id | None`) oraz `CirculationTransactionResponse` (`id`, `transaction_number`, `movement_type`, `occurred_at`, `description`, `entries`). Zaktualizować docstring modułu.
    - `router.py`: usunąć trasy `GET /api/accounts/{user_id}/balance` (`:242`) i `GET /api/circulation-transactions` (lista, `:253`) oraz sekcję „Accounts”. `GET /api/circulation-transactions/{transaction_id}` mapuje jawnie płaskie pola z `entry.account.inventory` (EXTERNAL daje `None`), bez `from_attributes` na zagnieżdżonym koncie. Docstring modułu bez `/api/accounts`.
  - [x] 1.8 Macierz autoryzacji `app/core/authorization_matrix.py`
    - Usunąć wiersz 44 (`GET ^/api/accounts(/.*)?$`, `:161`).
    - Wiersz 45 (`:162`) zawęzić do `^/api/circulation-transactions/[^/]+$` (READ/mcp:read).
    - Numeracji pozostałych wierszy w komentarzach nie zmieniać. Wiersz 40 zostaje bez zmian.
  - [x] 1.9 Testowy helper i odblokowanie importów testów
    - Nowy `tests/ledger_assertions.py`: `movements_for_item(db, item_id)` (transakcje z zapisami itemu, kolejność `(occurred_at, id)`, eager load zapisów) oraz `assert_ledger_matches_projection(db, item_ids)` (per item `SUM(quantity)` per konto — POPRAWIONE w G2 pod podwójny zapis: wśród kont INVENTORY żywy item ma +1 wyłącznie na koncie `item.inventory_id`, usunięty 0 na każdym; EXTERNAL −1 dla żywego, 0 dla usuniętego; w każdej transakcji suma per item = 0).
    - `tests/test_term_item_listings.py`: usunąć importy `Account`, `EntrySide` i helper `_latest_ledger_entries_for_giver` (`:136-170`), zastąpić go importem `movements_for_item`. Treść asercji GIFT/SWAP przepisuje G4.
  - [x] 1.10 Frontend: usunąć `src/frontend/src/api/accounts.ts`. Potwierdzić grepem brak importów, potem w `src/frontend` uruchomić `npx tsc --noEmit -p .`.
  - [x] 1.11 Upewnić się, że testy tej grupy przechodzą i wykonać weryfikację ręczną migracji
    - Uruchomić tylko testy z 1.1: `uv run pytest tests/test_circulation_ledger.py tests/test_authorization_matrix.py` (conftest wykonuje `alembic upgrade head` do 0042).
    - `uv run ruff check` i `uv run mypy` na zmienionych plikach.
    - Weryfikacja ręczna na lokalnej bazie, w `src/backend`, po `set -a; . ./.env; set +a`:
      1. `uv run alembic upgrade head`, a `alembic current` pokazuje `0042`;
      2. `SELECT count(*) FROM accounts WHERE account_type='EXTERNAL'` = 1; `SELECT count(*) FROM inventories i LEFT JOIN accounts a ON a.inventory_id = i.id WHERE a.id IS NULL` = 0; `pledges`, `inventory_items`, `reservations` są puste;
      3. `uv run alembic downgrade 0041`: przechodzi, `accounts` ma znów `code`/`name`/`owner_user_id` (UUID) i nie ma wierszy;
      4. ponownie `uv run alembic upgrade head` i kontrola z punktu 2;
      5. baza zostaje na `0042`.
    - NIE uruchamiać całego zestawu.

**Kryteria akceptacji:**
- 6-8 testów z 1.1 przechodzi.
- Aplikacja i wszystkie moduły testów się importują (`uv run pytest --collect-only` bez błędów).
- W `app/` i `src/frontend/src` nie ma odwołań do `EntrySide`, `900-100`, `100-`, `_POSTED_AMOUNT`, `post_circulation`, `api/accounts`.
- Upgrade/downgrade/upgrade na lokalnej bazie przechodzi, lokalna baza jest na `0042`.
- `npx tsc --noEmit -p .` w `src/frontend` przechodzi.

---

### Grupa zadań 2: Rdzeń księgi (`post_movement`, walidacja, projekcja, konta z inwentarzem)
**Zależności:** 1
**Pliki do modyfikacji:** `app/circulation/infrastructure/ledger.py`, `app/circulation/infrastructure/repository.py`, `app/circulation/application/inventory.py`, `tests/test_circulation_ledger.py`
**Szacowana liczba kroków:** 7

- [x] 2.0 Ukończyć rdzeń księgi
  - [x] 2.1 Napisać 6-8 skupionych testów w `tests/test_circulation_ledger.py` (część „konta + walidacja `post_movement`”)
    - `test_createInventory_viaApi_createsInventoryAccount`: `POST /api/inventories` daje dokładnie jedno konto INVENTORY z `inventory_id` nowego inwentarza.
    - `test_getOrCreatePersonalInventory_createsAccountOnce`: dwa wywołania `get_or_create_personal_inventory`/`get_or_create_virtual_inventory` dają jedno konto na inwentarz (brak duplikatu, ścieżka SAVEPOINT).
    - `test_postMovement_fromNotMatchingProjection_raisesConflictWithoutEntries`: noga z `from` ≠ `item.inventory_id` daje `BusinessConflictException`, bez nowych wierszy transakcji ani zapisów.
    - `test_postMovement_swapNonCrossingLegs_raisesConflict` (A→B i C→D).
    - `test_postMovement_swapSameItemInBothLegs_raisesConflict`.
    - `test_postMovement_swapWithVirtualSide_raisesConflict` (jedna strona VIRTUAL lub PICKUP_POINT).
    - `test_postMovement_validPersonalSwap_postsFourEntriesAndMatchesProjection`: SWAP PERSONAL(A) ↔ PERSONAL(B) daje 4 zapisy, zamienia `inventory_id` obu itemów i spełnia `assert_ledger_matches_projection`.
    - Dane testowe budować bezpośrednio przez ORM w sesji (items tworzone z `inventory_id`, bez przechodzenia przez `register_item`, który zacznie księgować dopiero w G3). Asercję niezmiennika w teście SWAP poprzedzić ręcznym `post_movement(REGISTER)` dla obu itemów.
  - [x] 2.2 Dodać `repository.find_accounts_for_posting(db, inventory_ids, include_external)`
    - **Jedno** zapytanie: konta INVENTORY dla zbioru `inventory_id` z `joinedload(Account.inventory)` oraz konto EXTERNAL (`OR account_type='EXTERNAL'`), gdy `include_external`.
  - [x] 2.3 Zaimplementować `MovementLeg` (frozen dataclass: `item`, `from_inventory_id`, `to_inventory_id`, `reservation_id`) i szkielet `post_movement(db, *, movement_type, legs, description, occurred_at) -> CirculationTransaction` w `infrastructure/ledger.py`
  - [x] 2.4 Walidacja przed jakimkolwiek zapisem (kolejność jak w spec, „Walidacja”)
    - liczba nóg (SWAP = 2 różne itemy, inne typy = 1);
    - kształt nogi (REGISTER `from=None`, REMOVE `to=None`, pozostałe oba ≠ None i `from ≠ to`);
    - `item.deleted_at IS NULL`;
    - asercja defensywna projekcji (`item.inventory_id == from`; RETURN: `home_inventory_id == to`; LEND/GIFT/SWAP/REMOVE: `home_inventory_id IS NULL`);
    - rozwiązanie kont przez `find_accounts_for_posting`, brak konta daje `EntityNotFoundException("Account", …)`;
    - reguła krzyżowania SWAP: wszystkie 4 strony PERSONAL, `X.from == Y.to`, `X.to == Y.from`, różni `owner_user_id`;
    - naruszenia reguł dają `BusinessConflictException`, niezbilansowanie daje `ValueError` (jawne sprawdzenie sumy `quantity` per `item_id` po zbudowaniu listy zapisów).
  - [x] 2.5 Zapis i projekcja
    - `CirculationTransaction` z `_next_transaction_number()` (`domain/reservation_rules.py:44`), flush, potem dla każdej nogi zapis −1 (konto from) i +1 (konto to) z `item_id` i `reservation_id` nogi.
    - Projekcja per noga: `to ≠ None` daje `item.inventory_id = to`; REMOVE daje `item.deleted_at = occurred_at` (bez zmiany `inventory_id`); LEND daje `home_inventory_id = from`; RETURN daje `home_inventory_id = None`. Flush, bez commita, zwrot transakcji.
    - Docstring modułu (`ledger.py:1-17`) i funkcji: jedyna ścieżka zmiany lokalizacji, flush-only, współbieżność przez `version_id_col` → `StaleDataError` → 409. Testu współbieżności nie pisać.
  - [x] 2.6 Konta tworzone razem z inwentarzem w `application/inventory.py`
    - `create_inventory` (`:16-25`): add `Inventory`, flush, add `Account(account_type=INVENTORY, inventory_id=inventory.id)`, istniejący commit.
    - `_get_or_create_inventory` (`:39-65`): w istniejącym `async with db.begin_nested()` add inwentarz, flush, add konto, flush. `IntegrityError` cofa oba, ponowny `find` bez zmian.
  - [x] 2.7 Upewnić się, że testy rdzenia przechodzą
    - Uruchomić tylko testy z 2.1 (np. `uv run pytest tests/test_circulation_ledger.py -k "postMovement or Inventory"`), plus ruff i mypy na zmienionych plikach.

**Kryteria akceptacji:**
- 6-8 testów z 2.1 przechodzi.
- `post_movement` nie commituje. Nieudana walidacja nie zostawia wierszy transakcji ani zapisów.
- Każdy nowy inwentarz (API i get-or-create) ma dokładnie jedno konto INVENTORY.

---

### Grupa zadań 3: Punkty księgowania i refaktor przejść flush-only
**Zależności:** 2
**Pliki do modyfikacji:** `app/circulation/application/inventory_items.py`, `app/circulation/application/reservation_transitions.py`, `app/circulation/domain/reservation_rules.py`, `tests/test_circulation_ledger.py`, `tests/test_circulation.py`
**Szacowana liczba kroków:** 8

- [x] 3.0 Ukończyć punkty księgowania
  - [x] 3.1 Napisać 7-8 skupionych testów (w `tests/test_circulation_ledger.py`, poza przepisanym testem w `test_circulation.py`)
    - `test_registerItem_viaApi_postsRegisterFromExternal`: transakcja REGISTER, EXTERNAL −1 / konto inwentarza +1, `reservation_id` NULL.
    - `test_fulfillPledge_registersItem_postsRegister` (przez `pledge_fulfillment`, dane jak w `tests/test_pledge_fulfillment.py`).
    - `test_deleteItem_postsRemoveToExternalAndSetsDeletedAt`.
    - `test_deleteItem_lentItem_returns409WithoutNewTransaction`.
    - `test_fulfillReturn_postsVirtualToHomeAndClearsHome`: RETURN VIRTUAL(B) −1 / PERSONAL(A) +1, `home_inventory_id` = NULL.
    - `test_pendingTransitions_createConfirmCancelAndPatch_postNoEntries`: create/confirm/cancel rezerwacji i PATCH `condition`/`product_id` nie dodają zapisów.
    - `test_fulfillReservation_swapType_raisesConflict`.
    - `test_itemLifecycle_registerLendReturnGiftRemove_ledgerMatchesProjectionAtEachStep` (GIFT jako pojedyncza noga przez `fulfill_reservation`).
    - Przepisać `tests/test_circulation.py:490` `test_fulfillLend_postsCirculationTransactionCreditingOwner` na `test_fulfillLend_postsLendMovementFromPersonalToVirtual`: PERSONAL(A) −1 / VIRTUAL(B) +1, `reservation_id` = id rezerwacji, `home_inventory_id` = PERSONAL(A), bez `/api/accounts`.
  - [x] 3.2 REGISTER w `application/inventory_items.py::register_item`
    - Item tworzony z docelowym `inventory_id` (konstruktor, NOT NULL), flush, `InventoryBalance` jak dziś, potem `post_movement(REGISTER, from=None, to=inventory_id)` z opisem `"REGISTER: {nazwa produktu}"` (nazwa z istniejącego `product_service.get_product`, `:42`), przed istniejącym `db.commit()`. Sygnatura bez zmian, więc bridge i `pledge_fulfillment.py:75` bez zmian.
  - [x] 3.3 REMOVE w `soft_delete_item`
    - Istniejąca blokada statusu ≠ AVAILABLE (`:175-178`) zostaje. Zamiast ręcznego `item.deleted_at = …` wołać `post_movement(REMOVE, from=item.inventory_id, to=None)`, a potem istniejący commit.
  - [x] 3.4 Wydzielić funkcje flush-only w `application/reservation_transitions.py`
    - `_confirm(db, reservation, acting_user_id)`, `_cancel(db, reservation, acting_user_id)`, `_fulfill(db, reservation, acting_user_id, now) -> MovementLeg`.
    - `_fulfill` przejmuje gałęzie `:107-136`: guard CONFIRMED, autoryzacja, `from = item.inventory_id`, `to` per typ (LEND: `get_or_create_virtual_inventory(reserved_by)`; GIFT: `get_or_create_personal_inventory(reserved_by)`; RETURN: `home_inventory_id`, a jego brak daje 409), mutacje `InventoryBalance` jak dziś, status FULFILLED. **Nie** przypisuje `inventory_id`/`home_inventory_id`.
    - Istniejąca blokada ponownego LEND (`:108-111`) zostaje.
  - [x] 3.5 Publiczne wrappery z commitem
    - `confirm_reservation` = load + `_confirm` + commit + refresh; `cancel_reservation` analogicznie.
    - `fulfill_reservation` = load, odrzucenie typu SWAP (`BusinessConflictException`, „zamiana realizowana jest wyłącznie parą”), `_fulfill`, `post_movement(MovementType(reservation.reservation_type.value), [leg], description, occurred_at=now)`, commit, refresh. Ten sam `now` dla `InventoryBalance` i `occurred_at`.
    - Sygnatury publiczne bez zmian.
  - [x] 3.6 Docstringi: `reservation_transitions.py:1-4` oraz `reservation_rules._require_holder_to_confirm` (usunąć zdanie „accounting always credits the holder”, opisać ruch LEND z konta posiadacza).
  - [x] 3.7 Grep kontrolny: w `app/circulation/` przypisania `.inventory_id =`, `.home_inventory_id =`, `.deleted_at =` na itemie występują tylko w `post_movement` oraz w konstruktorze w `register_item`.
  - [x] 3.8 Upewnić się, że testy punktów księgowania przechodzą
    - Uruchomić tylko testy z 3.1 oraz istniejące testy przenoszące rzeczy, które muszą przejść bez zmian w asercjach: `tests/test_circulation.py` (`:332`, `:366`, `:741`, przepisany `:490`), `tests/test_lend_step0_fixes.py`, `tests/test_pledge_fulfillment.py`.
    - Testy R7 wymuszające stan legacy (`test_circulation.py:1010`, `:1046`) sprawdzić: po zmianie REMOVE z `home_inventory_id` daje 409 z `post_movement`, co jest zgodne z intencją. Dostosować oczekiwanie tylko wtedy, gdy test zakładał inne zachowanie, i odnotować to w work-logu.
    - Ruff i mypy na zmienionych plikach.

**Kryteria akceptacji:**
- 7-8 testów z 3.1 (z przepisanym `:490`) przechodzi.
- REGISTER, REMOVE, LEND, RETURN i GIFT (pojedyncza noga) tworzą dokładnie jedną transakcję z poprawnymi kontami, `item_id`, `quantity` i `reservation_id`.
- Stany oczekujące nie tworzą zapisów.
- Grep z 3.7 potwierdza pojedynczą ścieżkę mutacji lokalizacji.

---

### Grupa zadań 4: Atomowa wymiana (`fulfill_exchange`/`cancel_exchange`, bridge, groups)
**Zależności:** 3
**Pliki do modyfikacji:** `app/circulation/application/reservation_transitions.py`, `app/circulation/domain/reservation_rules.py`, `app/circulation/service.py`, `app/groups/infrastructure/circulation_bridge.py`, `app/groups/application/term_item_listings.py`, `tests/test_term_item_listings.py`, `tests/test_circulation.py`
**Szacowana liczba kroków:** 8

- [ ] 4.0 Ukończyć atomową wymianę
  - [ ] 4.1 Napisać 7-8 skupionych testów w `tests/test_term_item_listings.py`
    - `test_confirmTransaction_swap_postsSingleSwapTransactionWithFourEntries`: jedna transakcja SWAP, 4 zapisy, każda noga ze swoim `reservation_id`, itemy zamieniają inwentarze, `ItemListingPreference` obu itemów zniknęły (kontrakt commita M5), `assert_ledger_matches_projection` przechodzi.
    - `test_confirmTransaction_swapFailureInSecondLeg_leavesNoChanges`: monkeypatch `reservation_transitions.get_or_create_personal_inventory` rzuca przy drugim wywołaniu; po `db_session.rollback()` obie rezerwacje, oba itemy i preferencje są w stanie sprzed wywołania i nie ma transakcji.
    - `test_cancelTransaction_swap_cancelsBothLegsInOneCommit`.
    - `test_cancelExchange_failureInSecondLeg_leavesFirstLegUntouched`: monkeypatch `reservation_transitions.get_item_balance` rzuca przy drugim wywołaniu.
    - `test_fulfillExchange_unpairedLegs_raisesConflict` (przez `circulation_bridge.fulfill_exchange`).
    - `test_fulfillExchange_nonPartyActor_raisesAccessDeniedWithoutStateChange`.
    - `test_cancelExchange_nonPartyActor_raisesAccessDeniedWithoutStateChange`.
    - Przepisać `tests/test_circulation.py:578` (bridge `fulfill_reservation`) na test `circulation_bridge.fulfill_exchange` dla pojedynczej nogi LEND, z `acting_user_id` strony rezerwacji.
  - [ ] 4.2 Predykat w `domain/reservation_rules.py`: czysta funkcja (bez `db`), np. `_require_party_to_any_reservation(reservations, acting_user_id)`, rzucająca `AccessDeniedException`, gdy aktor nie jest `giver_user_id` ani `reserved_by_user_id` żadnej nogi (wzorzec `_require_party_to_reservation`, `:13-17`).
  - [ ] 4.3 `fulfill_exchange(db, reservation_ids, acting_user_id) -> list[Reservation]` w `reservation_transitions.py`
    - Walidacja wejścia: 1 id LEND/GIFT albo 2 id SWAP wzajemnie sparowane (`paired_reservation_id`), inaczej `BusinessConflictException`.
    - Autoryzacja z 4.2 po załadowaniu, przed mutacją.
    - Per noga w kolejności wejścia: posiadacz liczony na świeżo (`_load_reservation_for_transition`, `_current_holder_user_id`), PENDING przez `_confirm(…, holder)`, potem `_fulfill(…, holder, now)` zwraca nogę. Wszystkie nogi zbudowane przed księgowaniem.
    - Jedno `post_movement`: SWAP z 2 nogami (opis `"SWAP: {X} ⇄ {Y}"`) albo LEND/GIFT z 1 nogą. Jeden commit, refresh, zwrot w kolejności wejścia.
    - Docstring: kontrakt commita (commituje całą bieżącą transakcję sesji, łącznie ze zmianami flushowanymi przez wołającego) i autoryzacja 403.
  - [ ] 4.4 `cancel_exchange(db, reservation_ids, acting_user_id) -> list[Reservation]`: ta sama walidacja i autoryzacja, per noga `_cancel(…, holder)`, jeden commit, ten sam kontrakt w docstringu. Eksport obu funkcji w `service.py`.
  - [ ] 4.5 `app/groups/infrastructure/circulation_bridge.py`
    - Dodać pass-throughy `fulfill_exchange` i `cancel_exchange` (z `acting_user_id`), importowane wyłącznie z `app.circulation.service`.
    - Usunąć `fulfill_reservation` i `resolve_current_holder_user_id`, zaktualizować `__all__` i docstring modułu. `confirm_reservation`/`cancel_reservation` zostają (wołają je `propose_swap`, `accept_swap_proposal`, `reject_swap_proposal`, `pledge_fulfillment.py:90`). Istniejące importy `models`/`schemas` bez zmian.
  - [ ] 4.6 `app/groups/application/term_item_listings.py`
    - `confirm_transaction` (`:787-827`): gating `_resolve_transaction_reservations_for_action` i flush usunięcia `ItemListingPreference` bez zmian. Pętlę z `resolve_current_holder_user_id` + `fulfill_reservation` (`:809-827`) zastąpić jednym `circulation_bridge.fulfill_exchange(db, [r.id for r in reservations], acting_user_id)` (id z principala). Zwrócić rezerwację o `id == reservation_id`. Dotyczy także LEND i GIFT (założenie A1).
    - `cancel_transaction` (`:830-853`): jedno `circulation_bridge.cancel_exchange(..., acting_user_id)`.
    - Docstringi obu funkcji: commit wykonuje use case circulation. Usunąć nieaktualne komentarze o `fulfill_reservation` (`:548`, `:799`, `:809`), bez stylu changelog.
  - [ ] 4.7 Dostosować istniejące testy księgi w `tests/test_term_item_listings.py`
    - Test GIFT (okolice `:1659`): jedna transakcja GIFT, 2 zapisy −1/+1 na PERSONAL(lister)/PERSONAL(taker), `reservation_id`, nazwa produktu w `description`.
    - Test SWAP (okolice `:1710`, `test_confirmTransaction_swapFulfillment_postsCirculationTransactionAndEntriesPerLeg`): **jedna** transakcja SWAP z 4 zapisami zamiast „dwóch różnych transakcji”. Zmienić nazwę testu odpowiednio.
    - Pozostałe audyty księgi w rejonie `:1571-1770` dostosować analogicznie, korzystając z `movements_for_item`.
    - Istniejące testy SWAP (`:642`, `:799`, `:1096`, `:1773`, `:1943`): uruchomić. Te, których itemy nie leżą w PERSONAL obu stron (dostają 409 z reguły krzyżowania), dostosować danymi (item w PERSONAL wystawiającego), nie asercjami biznesowymi. Testy `GET /api/inventory-items/{id}/balance` (`:1852-2037`) zostają bez zmian.
  - [ ] 4.8 Upewnić się, że testy wymiany przechodzą
    - Uruchomić tylko `tests/test_term_item_listings.py` i przepisany test z `tests/test_circulation.py:578`, plus ruff i mypy na zmienionych plikach.

**Kryteria akceptacji:**
- 7-8 testów z 4.1 i dostosowane testy z 4.7 przechodzą.
- SWAP to zawsze jedna transakcja z 4 zapisami PERSONAL(A) ↔ PERSONAL(B). Wymuszona awaria drugiej nogi nie zostawia zmian, a anulowanie SWAP to jeden commit.
- Obcy aktor dostaje 403 bez zmian stanu zarówno w `fulfill_exchange`, jak i w `cancel_exchange`.
- `circulation_bridge` nie eksportuje już `fulfill_reservation` ani `resolve_current_holder_user_id`, a w `app/` nie ma ich wołających.

---

### Grupa zadań 5: API historii rzeczy
**Zależności:** 4
**Pliki do modyfikacji:** `app/circulation/infrastructure/repository.py`, `app/circulation/application/movements.py`, `app/circulation/service.py`, `app/circulation/schemas.py`, `app/circulation/router.py`, `tests/test_circulation_ledger.py`, `tests/test_authorization_matrix.py`
**Szacowana liczba kroków:** 6

- [ ] 5.0 Ukończyć API odczytu
  - [ ] 5.1 Napisać 6-7 skupionych testów
    - `test_itemHistory_fullLifecycle_returnsOldestFirstWithExternalNulls`: kolejność od najstarszego, `from = null` dla REGISTER, `owner_display_name` wypełniony.
    - `test_itemHistory_deletedItem_returns200EndingWithRemove` (`to = null`).
    - `test_itemHistory_unknownItem_returns404` (`uuid.uuid4()`).
    - `test_itemHistory_withoutToken_returns401`.
    - `test_itemHistory_executesSingleMovementsQuery`: licznik zapytań (event listener `before_cursor_execute` na silniku testowym) potwierdza 2 zapytania SQL na endpoint (bez N+1).
    - `test_getCirculationTransaction_swap_returnsFourEntriesWithExternalNullFields` (4 zapisy dla SWAP; dla transakcji REGISTER pola `inventory_*` i `owner_user_id` zapisu EXTERNAL = null).
    - W `tests/test_authorization_matrix.py`: `resolve_requirement` dla `GET /api/inventory-items/{uuid}/history` daje READ/mcp:read.
  - [ ] 5.2 `repository.list_item_movements(db, item_id)` jako **jedno** `select`
    - Od `CirculationTransaction`, dwa aliasy `CirculationEntry` dla `item_id` (wyjście `quantity=-1`, wejście `quantity=+1`) z tej samej transakcji, dla każdej strony LEFT JOIN `Account` → `Inventory` → `UserProfile` (`account_user_id = inventories.owner_user_id`). Tylko potrzebne kolumny, sortowanie `occurred_at, id`.
    - Docstring wskazuje akceptowany wyjątek od reguły fasady (M1) z precedensami `repository.py:29` i `groups/infrastructure/repository.py`.
  - [ ] 5.3 Schematy w `schemas.py`: `ItemMovementSideResponse` (`inventory_id`, `inventory_type`, `owner_user_id`, `owner_display_name | None`) i `ItemMovementResponse` (`transaction_id`, `transaction_number`, `movement_type`, `occurred_at`, `reservation_id | None`, `from_` z aliasem `"from"`, `to`, `model_config = ConfigDict(populate_by_name=True)`).
  - [ ] 5.4 `application/movements.py::get_item_history(db, item_id)`: istnienie przez `repository.get_item` (usunięty item daje 200, brak wiersza daje `EntityNotFoundException` → 404), potem `list_item_movements` i mapowanie wierszy na schemat (strona z NULL-owym inwentarzem daje `None`). Eksport w `service.py`.
  - [ ] 5.5 Trasa `GET /api/inventory-items/{item_id}/history` w `router.py` z `ReadPrincipal`, `item_id: uuid.UUID`, `response_model=list[ItemMovementResponse]`, serializacja po aliasie. Macierz bez zmian (pokrywa ją wiersz 40). Uzupełnić docstring routera.
  - [ ] 5.6 Upewnić się, że testy API przechodzą
    - Uruchomić tylko testy z 5.1, plus ruff i mypy na zmienionych plikach.

**Kryteria akceptacji:**
- 6-7 testów z 5.1 przechodzi.
- Historia zwraca pełną listę od najstarszego, z `null` dla strony EXTERNAL, także dla rzeczy usuniętej. Endpoint wykonuje 2 zapytania SQL.
- `GET /api/circulation-transactions/{id}` zwraca nowy kształt.

---

### Grupa zadań 6: Przegląd testów, dokumentacja i pełna weryfikacja
**Zależności:** 1, 2, 3, 4, 5
**Pliki do modyfikacji:** `tests/test_circulation_ledger.py`, `tests/test_term_item_listings.py`, `tests/test_circulation.py`, `docs/system-wypozyczalni-inventory-accounting.md` (w katalogu głównym repo), `.maister/docs/project/architecture.md` (w katalogu głównym repo)
**Szacowana liczba kroków:** 7

- [ ] 6.0 Przejrzeć testy, uzupełnić luki, zaktualizować dokumentację i uruchomić całość
  - [ ] 6.1 Przejrzeć testy z grup 1-5 (~34-39) pod kątem kryteriów sukcesu 1-11 ze spec. W szczególności sprawdzić, że każdy typ ruchu ma test z asercją kont, `quantity` i `reservation_id`, a `assert_ledger_matches_projection` jest wołane po każdym kroku cyklu życia i po SWAP.
  - [ ] 6.2 Zidentyfikować luki tylko dla tej funkcji (np. REMOVE z wymuszonym `home_inventory_id` → 409 przez `post_movement`, LEND GIFT przez `confirm_transaction` spełniające niezmiennik, RETURN bez `home_inventory_id` → 409).
  - [ ] 6.3 Dopisać najwyżej 10 strategicznych testów, tylko dla realnych luk.
  - [ ] 6.4 Dokumentacja
    - `docs/system-wypozyczalni-inventory-accounting.md`: tytuł „księga ruchów”; §1 konta inwentarzy + EXTERNAL, typy ruchu, zapis ±1; §2 przykłady ruchów (LEND, RETURN, SWAP jako 4 zapisy PERSONAL ↔ PERSONAL, GIFT, REGISTER, REMOVE); §3 transakcja powstaje przy REGISTER, fulfill i REMOVE, nigdy przy stanach oczekujących; §4 aktualizacja; usunąć §6.
    - `.maister/docs/project/architecture.md`: krótki akapit o vertical `circulation` (append-only księga ruchów, konto = inwentarz + EXTERNAL, `post_movement` jako jedyna ścieżka zmiany lokalizacji, projekcja w tym samym commicie, atomowa wymiana przez `fulfill_exchange`).
    - Sprawdzić, że docstringi z listy „Docstringi do przepisania” w spec zostały zaktualizowane w G1-G5.
  - [ ] 6.5 Kontrole grep w `src/backend/app`, `src/backend/tests` i `src/frontend/src`: brak `EntrySide`, `900-100`, `"100-`, `_POSTED_AMOUNT`, `post_circulation`, `get_account_balance`, `api/accounts`; przypisania lokalizacji itemu tylko w `post_movement` i w konstruktorze `register_item`.
  - [ ] 6.6 Uruchomić pełne bramki
    - `uv run pytest` w `src/backend` (cały zestaw, w tym `alembic upgrade head` w conftest).
    - `uv run ruff check` i `uv run mypy` na wszystkich zmienionych plikach backendu.
    - `npx tsc --noEmit -p .` oraz `npx vitest run` w `src/frontend`.
  - [ ] 6.7 Potwierdzić, że lokalna baza jest na `0042` (`uv run alembic current` po załadowaniu `.env`), i zaproponować użytkownikowi standard „append-only ledger + projekcja w tej samej transakcji; mutacja lokalizacji wyłącznie przez funkcję ruchu” (dodanie tylko po zgodzie, przez `/maister:standards-update`).

**Kryteria akceptacji:**
- Pełny `uv run pytest` przechodzi, ruff i mypy są czyste na zmienionych plikach, a typecheck i vitest frontendu przechodzą.
- Dodano najwyżej 10 testów w tej grupie. Testy funkcji łącznie mieszczą się w ~34-49.
- Dokumenty z sekcji „Dokumentacja” w spec są zaktualizowane, a kontrole grep są czyste.

## Kolejność wykonania

1. Grupa 1: Model danych, migracja 0042 i usunięcie kodu punktowego (11 kroków)
2. Grupa 2: Rdzeń księgi (7 kroków, zależy od 1)
3. Grupa 3: Punkty księgowania i refaktor przejść flush-only (8 kroków, zależy od 2)
4. Grupa 4: Atomowa wymiana (8 kroków, zależy od 3)
5. Grupa 5: API historii rzeczy (6 kroków, zależy od 4, bo test kształtu transakcji SWAP wymaga `fulfill_exchange`)
6. Grupa 6: Przegląd testów, dokumentacja i pełna weryfikacja (7 kroków, zależy od wszystkich)

Łańcuch jest liniowy. Grupy dzielą pliki (`tests/test_circulation_ledger.py`, `reservation_transitions.py`, `repository.py`, `service.py`, `router.py`, `schemas.py`), więc nie można ich wykonywać równolegle.

## Zgodność ze standardami

Stosować standardy z `.maister/docs/standards/`:
- `global/`: `minimal-implementation.md` (usunięcie całego kodu punktowego i pass-throughów bez wołających, brak speculative API), `error-handling.md` (`BusinessConflictException`, `AccessDeniedException`, `EntityNotFoundException`, fail-fast przed zapisem), `commenting.md` (docstringi opisują stan bieżący, bez changelogu), `coding-style.md`, `conventions.md`.
- `backend/models.md`: StrEnum przez `_enum_column(native_enum=False)`, `lazy="raise"` z jawnym eager loadingiem, `__eq__`/`__hash__` po kluczu biznesowym, referencje cross-module jako kolumny UUID. Opis sekwencji w standardzie jest nieaktualny: obowiązuje baza UUID z `app/core/base_model.py` i 0041.
- `backend/migrations.md`: działający downgrade, nazwy `fk_/uq_/ix_/ck_`, udokumentowane odstępstwo od „Separate Schema and Data”.
- `backend/queries.md`: historia jednym zapytaniem, tylko potrzebne kolumny, indeks `(item_id, transaction_id)`, jeden use case = jedna transakcja DB.
- `backend/api.md`: zasoby w liczbie mnogiej, zagnieżdżenie ≤ 2 poziomy, kody 200/401/403/404/409/422.
- `backend/security.md`: `Depends(require_any("READ", "mcp:read"))`, aktualizacja `AUTHORIZATION_MATRIX` (wiersz 44 usunięty, 45 zawężony), use case'y wymiany same sprawdzają stronę.
- `testing/backend-testing.md`: testy integracyjne na prawdziwym Postgres 18 (pytest + TestContainers + httpx ASGI, izolacja SAVEPOINT), nazwy `test_<akcja>_<warunek>_<oczekiwanie>`, identyfikatory UUID, każdy test tworzy własne dane.
- DDD: importy między modułami tylko przez `app.<moduł>.service`; groups sięga do circulation wyłącznie przez `groups/infrastructure/circulation_bridge.py`. Join do `UserProfile` w `list_item_movements` to udokumentowany wyjątek (M1).

## Uwagi

- Warunek wstępny: przed startem G1 sprawdzić `git status` (czyste pliki zadania) i `uv run alembic heads` (pojedyncze `0041`).
- Test-driven: każda grupa zaczyna od 2-8 testów.
- Uruchamiać przyrostowo: po każdej grupie tylko jej testy, pełny zestaw wyłącznie w G6.
- Nie pisać testu współbieżności ani osobnego testu migracji na odrębnej bazie (decyzje spec, M4).
- Alembic wymaga załadowanego `.env` (`set -a; . ./.env; set +a`) przed `uv run alembic …` w `src/backend`.
- Oznaczać postęp: odhaczać kroki po ukończeniu.
- Najpierw reużycie: `_get_or_create_inventory` (SAVEPOINT), `_enum_column`, `_next_transaction_number`, `_load_reservation_for_transition`/`_current_holder_user_id`, `_resolve_transaction_reservations_for_action`, handler `StaleDataError`, helpery testów z `test_circulation.py` i `test_term_item_listings.py`.
