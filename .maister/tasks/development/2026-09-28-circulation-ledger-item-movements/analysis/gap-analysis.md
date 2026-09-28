# Analiza luk: księga ruchów przedmiotów w `app.circulation`

**Data**: 2026-09-28
**Wejście**: `analysis/codebase-analysis.md`, `analysis/clarifications.md`, `analysis/research-context/*`, kod `src/backend/app/circulation/**`, `app/groups/application/term_item_listings.py`, `pledge_fulfillment.py`, `groups/infrastructure/circulation_bridge.py`

## Podsumowanie

- **Poziom ryzyka**: Średni
- **Szacowany nakład**: Średni
- **Wykryte cechy zadania**: `modifies_existing_code`, `creates_new_entities` (częściowo: nowy typ konta systemowego, nowe endpointy historii), `involves_data_operations`

Dziś księga liczy punkty: jeden DEBIT `100-{holder}` i jeden CREDIT `900-100`, po 1 pkt za każdą zrealizowaną rezerwację. Nie da się z niej odtworzyć historii żadnego przedmiotu. Docelowo ma to być księga ruchów przedmiotów, w której każde konto odpowiada jednemu inwentarzowi, a każda zmiana miejsca przedmiotu to jedna zbilansowana transakcja (−1×item z konta źródłowego, +1×item na konto docelowe). Do tego dochodzi konto systemowe „świat zewnętrzny” dla rejestracji i usunięcia.

Zmiana w kodzie jest niewielka. Jest jeden writer (`reservation_transitions.py:139`), trzy gałęzie ruchu w `fulfill_reservation` i dwa dodatkowe punkty zapisu (`register_item`, `soft_delete_item`). Zmienia się natomiast znaczenie tabel `accounts`, `circulation_transactions` i `circulation_entries`. Dwie rzeczy są wrażliwe i wymagają decyzji. Pierwsza to atomowość SWAP, bo dziś każda noga ma osobny `confirm` i osobny `fulfill`, każdy z własnym commitem. Druga to relacja księgi do kolumn `InventoryItem.inventory_id`/`home_inventory_id` i do `InventoryBalance`, czyli pytanie, co jest źródłem prawdy.

## Cechy zadania

- Has reproducible defect: **nie**. Zadanie zmienia intencję modelu. Po drodze naprawia jednak wady: nieatomowy SWAP, wyścig get-or-create konta, zapis wykonywany przez GET oraz datę bez czasu.
- Modifies existing code: **tak** (`models.py`, `ledger.py`, `reservation_transitions.py`, `accounts.py`, `repository.py`, `schemas.py`, `router.py`, `service.py`, `constants.py`, `inventory_items.py`, `term_item_listings.py`).
- Creates new entities: **tak, w ograniczonym zakresie**. Dochodzi konto systemowe „świat zewnętrzny”, nowe kolumny (item, rezerwacja, typ ruchu, ilość ze znakiem) i nowe endpointy historii. Encja `Loan` nie powstaje, bo użytkownik odrzucił ten kierunek.
- Involves data operations: **tak**. Chodzi o dopisywanie ruchów, odczyt historii i salda inwentarza oraz reset lub migrację danych księgi.
- UI heavy: **nie**. Frontend nie pokazuje dziś punktów, a `src/frontend/src/api/accounts.ts` nie jest nigdzie importowany. Ewentualny widok historii to decyzja o zakresie (I-3).

**Typ zmiany**: modificative (zmiana znaczenia i zachowania księgi) z elementem additive (historia, REGISTER/REMOVE).
**Wymagania kompatybilności**: flexible. To PoC przed produkcją, zmiany schematu i URL-i są dozwolone bez shimów (clarifications #4, memory).

---

## Stan obecny a docelowy, per obszar

### 1. Model: konta, transakcje, zapisy

| Element | Stan obecny (dowód) | Stan docelowy | Luka |
|---|---|---|---|
| `Account` | `code` `100-{user}` / `900-100`, `AccountType` USER_BALANCE/SYSTEM_EMISSION, `owner_user_id` (`models.py:90-113`, `ledger.py:39-59`) | Jedno konto na każdy `Inventory` (PERSONAL, VIRTUAL, także PICKUP_POINT i ręcznie tworzone przez `POST /api/inventories`) plus jedno konto systemowe EXTERNAL („świat zewnętrzny”) | Brak powiązania konto↔inventory. Trzeba zmienić typy kont i usunąć konta punktowe. Decyzja K-2: czy konto to osobna tabela z `inventory_id UNIQUE`, czy zapis wskazuje bezpośrednio `inventory_id`. |
| `CirculationTransaction` | `transaction_number`, `transaction_date: Date`, `description` wolnym tekstem, `is_posted` zawsze True, brak FK (`models.py:248-271`) | Typ ruchu (REGISTER, LEND, RETURN, GIFT, SWAP, REMOVE), znacznik czasu z godziną, powiązanie z rezerwacją (lub rezerwacjami), opcjonalnie `actor_user_id` | Brak typu ruchu, rezerwacji i czasu. `is_posted` przestaje mieć znaczenie, bo księga jest append-only i nie ma szkiców. |
| `CirculationEntry` | `amount Numeric(12,2)` zawsze dodatni, `entry_side` DEBIT/CREDIT, `description`, `entry_date: Date` (`models.py:274-302`) | `item_id` (FK `inventory_items`), ilość (±1 lub strona + 1), konto, opcjonalnie `reservation_id` per noga | Brak `item_id`, więc historia jest niemożliwa. Brak kontroli bilansu. Decyzja K-3 dotyczy reprezentacji ilości. |
| Bilansowanie | Nic nie wymusza Σ = 0 (codebase-analysis „Brak kontroli bilansu”) | Suma ilości per (transakcja, item) = 0, a każdy item ma dokładnie jedno wyjście i jedno wejście w transakcji | Trzeba dodać walidację w `ledger.py`, opcjonalnie CHECK/trigger (I-7). |
| Indeksy | brak pod historię | `(item_id, id)` lub `(item_id, occurred_at, id)` pod historię przedmiotu, `(account_id, item_id)` pod saldo konta | Nowe indeksy w migracji 0041. |
| Stałe | `_EMISSION_ACCOUNT_CODE`, `_POSTED_AMOUNT` (`constants.py`) | Kod lub typ konta EXTERNAL. `_DEFAULT_LEND_DAYS` zostaje. | Usunąć obie stałe punktowe. |

### 2. Punkty księgowania

| Zdarzenie | Miejsce w kodzie | Dziś w księdze | Docelowo | Uwagi |
|---|---|---|---|---|
| Rejestracja | `inventory_items.py:31` `register_item`. Woła je router `:108` oraz `pledge_fulfillment.py:75` przez `circulation_bridge.py:60`. | nic | REGISTER: EXTERNAL −1×item / `Inventory(inventory_id)` +1×item | Commit jest w `register_item`, więc zapis musi się zmieścić przed nim. Rejestracja jest możliwa do każdego inventory, którego użytkownik jest właścicielem, także PICKUP_POINT i ręcznie utworzonych. |
| LEND (fulfill) | `reservation_transitions.py:105-117` | Dt `100-holder` +1 pkt | PERSONAL(A) −1 / VIRTUAL(B) +1 | Źródło („from”) trzeba odczytać przed `item.inventory_id = virtual.id` (`:114`). |
| RETURN (fulfill) | `:118-126` | Dt `100-borrower` +1 | VIRTUAL(B) −1 / `home_inventory_id` (PERSONAL A) +1 | Gałąź `if item.home_inventory_id is not None` (`:119`). Dla RETURN bez home (teoretycznie niemożliwe, bo `create_return_reservation` tego wymaga) ruchu nie ma. Spec powinna tu zabronić albo nic nie księgować. |
| GIFT (fulfill) | `:127-134` | Dt `100-holder` +1 | PERSONAL(A) −1 / PERSONAL(B) +1 | Konto docelowe PERSONAL(B) może dopiero powstawać (`get_or_create_personal_inventory`). |
| SWAP (fulfill) | `:127-134` × 2 nogi, `term_item_listings.py:782-822` | dwie niepowiązane transakcje, dwa (a z confirm cztery) commity | jedna transakcja SWAP z 4 zapisami (item X: O −1 / P +1; item Y: P −1 / O +1) | Decyzja K-4. |
| Soft delete | `inventory_items.py:166` | nic | REMOVE: `Inventory(inventory_id)` −1 / EXTERNAL +1 | Dozwolony tylko przy AVAILABLE, więc przedmiot nie jest wtedy w VIRTUAL. Po GIFT jest w PERSONAL nowego właściciela. |
| create / confirm / cancel rezerwacji | `reservations.py:68`, `reservation_transitions.py:47,65` | nic (reguła INV „nigdy przy pending/confirmed”) | proponowane: nic, bo to zmiana stanu, a nie miejsca | Decyzja I-1. |
| PATCH `product_id` / `condition` | `inventory_items.py:149` | nic, zmiana nadpisywana bez logu | proponowane: poza księgą ruchów | Decyzja I-2. |

Wspólna luka: `fulfill_reservation` woła dziś `ledger.post_circulation(giver_user_id=holder, ...)` **po** mutacji (`:139`), ale przekazuje tylko posiadacza. Nowa funkcja zapisu (np. `post_item_movement(db, *, movement_type, legs=[(item_id, from_inventory_id, to_inventory_id, reservation_id)])`) potrzebuje `from_inventory_id` przechwyconego przed mutacją, `to_inventory_id` po niej oraz `reservation_id`. Sygnatura `fulfill_reservation` może zostać bez zmian, więc `pledge_fulfillment.py` i raw router rezerwacji nie wymagają zmian.

### 3. Atomowość

| Obszar | Stan obecny | Docelowo | Luka |
|---|---|---|---|
| SWAP confirm+fulfill | `confirm_transaction` (`term_item_listings.py:809-820`) w pętli per noga woła `confirm_reservation` (commit `:61`) i `fulfill_reservation` (commit `:143`). Przy SWAP z PENDING daje to do 4 commitów. | Obie nogi i 4 zapisy w jednym commicie | Potrzebne warianty confirm/fulfill bez commita (flush-only) albo nowy use case `fulfill_swap(db, reservation_ids, ...)` w circulation, wystawiony przez bridge i fasadę. |
| SWAP cancel | `cancel_transaction` (`:825-848`) to dwa osobne commity | jeden commit | To nie jest ruch w księdze, ale ten sam wzorzec. Poprawić przy okazji (I-8). |
| Rejestracja/usunięcie | commit w use case | ruch w tym samym commicie | Zapis musi być w `register_item`/`soft_delete_item` przed `db.commit()`. |
| Tworzenie konta | `get_or_create_user_balance_account` bez SAVEPOINT, wyścig na `uq_accounts_code` (`ledger.py:39-52`) | konto tworzone razem z inventory albo get-or-create z SAVEPOINT/IntegrityError (wzorzec `inventory.py:37-63`) | Decyzja I-5. |
| GET, który zapisuje | `get_account_balance` robi get-or-create i `db.commit()` (`accounts.py:16-23`) | odczyty bez efektów ubocznych | Znika razem z endpointem salda punktów. Nowe odczyty mają być czyste. |

### 4. Źródło prawdy: księga a `InventoryItem.inventory_id`/`home_inventory_id` i `InventoryBalance`

- **Dziś**: lokalizację niesie wyłącznie `InventoryItem.inventory_id` (nadpisywane). Własność prawną w trakcie pożyczki niesie `home_inventory_id`. Stan dostępności i daty (`status`, `reserved_at`, `lent_at`, `returned_at`, `due_date`) niesie jeden mutowalny wiersz `InventoryBalance`. Z kolumn `inventory_id`/`home_inventory_id` korzysta wiele zapytań: `_current_holder_user_id`, `resolve_owning_inventory`, `list_items_for_inventory*`, `list_lent_out_items_*`, `circulation_bridge.py:176,204`, reguły confirm i reguła „on loan”.
- **Docelowo (wg clarifications #2)**: saldo konta to zbiór przedmiotów, które są teraz w danym inventory. Ta sama informacja istnieje więc w dwóch miejscach: w księdze i w `inventory_id`.
- **Luka**: trzeba zdecydować, co jest źródłem prawdy i jak utrzymać zgodność (K-1). Przepisanie wszystkich odczytów lokalizacji na sumy z księgi to duży zakres z ryzykiem regresji. Tańsza jest ścisła niezmiennicza zgodność: kolumna jest projekcją aktualizowaną w tej samej transakcji DB co zapis, a testy pilnują równości salda z księgi i `inventory_id`.
- **`home_inventory_id`** da się wyprowadzić z księgi (źródło ostatniego ruchu LEND bez następującego po nim RETURN), ale zapytania go potrzebują. Rekomendacja: zostaje jako projekcja.
- **`InventoryBalance`** trzyma stan i daty, a nie miejsce. Nie jest duplikatem salda konta. Rekomendacja: zostaje jako projekcja stanu bieżącego. `lent_at`/`returned_at` stają się wyprowadzalne z księgi (czas ruchu LEND/RETURN).

### 5. `due_date` i stan pożyczki

- **Dziś**: `InventoryBalance.due_date` ustawiane przy create (`reservations.py:99`, dla typów innych niż RETURN wartością `expires_at`, która bywa None), nadpisywane przy LEND fulfill (`:116`, `expires_at` lub +14 dni), zerowane przy RETURN/GIFT/SWAP i przy cancel typów innych niż RETURN. B3 z researchu jest już załatany: RETURN nie nadpisuje `due_date` (`reservations.py:96-99`), a cancel RETURN zachowuje LENT/`due_date` (`reservation_transitions.py:74-77`, testy `test_lend_step0_fixes.py`). `due_date` nadal nie jest czytany przez żadną logikę (B4).
- **Po zmianie**: księga ruchów daje pełną historię pożyczek. Każda pożyczka to para transakcji LEND → RETURN na tym samym `item_id`, połączona rezerwacjami. To zaspokaja potrzebę „historii pożyczki” bez encji `Loan`. Termin zwrotu nie jest jednak ruchem, więc nie pasuje do zapisu, a w dodatku może się zmieniać (przedłużenia, recall z researchu E8–E10).
- **Luka**: brak decyzji, gdzie żyje `due_date`. Opcje opisuje I-4. Rekomendacja: zostawić w `InventoryBalance` jako stan bieżący, a opcjonalnie zapisać migawkę `due_date` na rezerwacji LEND lub w transakcji LEND, żeby zachować historię. `Loan` nie wchodzi w zakres.

### 6. API odczytu historii

| Endpoint | Dziś | Docelowo | Autoryzacja |
|---|---|---|---|
| `GET /api/accounts/{user_id}/balance` | saldo punktów, zapisuje przy GET (`router.py:241`) | **usunąć** (clarifications #1) | wiersz 44 `authorization_matrix.py:161` usunąć lub przepiąć |
| `GET /api/circulation-transactions?account_id=` | lista transakcji konta po `transaction_date desc`, niedeterministyczna (`repository.py:130-162`) | usunąć albo zastąpić wyciągiem konta inventory | wiersz 45 (`:162`) |
| `GET /api/circulation-transactions/{id}` | transakcja z zapisami | opcjonalnie zostaje (szczegóły ruchu, np. SWAP z 4 zapisami) | wiersz 45 |
| **nowy** `GET /api/inventory-items/{id}/history` | brak | lista ruchów przedmiotu od REGISTER do REMOVE, sortowana `(occurred_at, id)`, każdy z from/to inventory (+ owner), typem i `reservation_id` | wiersz 40 (READ), bez zmian w macierzy |
| **nowy (opcjonalny)** `GET /api/inventories/{id}/ledger` lub `/statement` | brak | wyciąg konta: ruchy i bieżące saldo (lista itemów) | wiersz 38 (READ) |

Luka dotycząca prywatności: istniejące GET-y (`/api/inventory-items/{id}`, `/api/inventories/{id}`) nie sprawdzają właściciela, wystarcza dowolny principal z READ. Historia ujawnia, kto i kiedy miał przedmiot (decyzja I-6). Historia usuniętego przedmiotu: `get_item` zwraca 404 dla `deleted_at` (`inventory_items.py:59-66`), a nowy endpoint musi świadomie pokazywać także REMOVE.

### 7. Usunięcie punktów (backend i frontend)

- Backend usuwa: `get_or_create_user_balance_account`, `_get_emission_account`, `post_circulation`, `get_account_balance`, `AccountBalanceResponse`, `AccountType.USER_BALANCE`/`SYSTEM_EMISSION`, `_POSTED_AMOUNT`, `_EMISSION_ACCOUNT_CODE`, re-eksporty z `service.py:16-20,65,82`, endpoint salda i wiersz 44 macierzy.
- Frontend usuwa `src/frontend/src/api/accounts.ts`. Nic go nie importuje (zweryfikowane grepem, trafienia „accounts” w `OrganizationPage.tsx`/`router.tsx`/`PanelPage.test.tsx` to komentarze o kontach użytkowników). Ewentualnie powstaje nowy moduł `api/itemHistory.ts` z hookiem, jeśli UI jest w zakresie.
- Dokument `docs/system-wypozyczalni-inventory-accounting.md` (tytuł „Inventory + Punkty za Obieg”, sekcje 44-59, 175-259) trzeba przepisać na model ruchów. Docstring `models.py:1-16` i `ledger.py:1-17` też odwołują się do „points ledger”.

### 8. Migracja i dane

- Ostatnia migracja to `0040`, nowe to `0041+`. Seed konta emisji pochodzi z `0005_seed_emission_account.py`, a schemat z `0004_circulation_schema.py`. Kaskad `ondelete` nie ma, a użytkownicy nie są usuwani (grep), więc FK `item_id` i `inventory_id` są bezpieczne. Soft delete zostawia wiersz itemu.
- Zgodnie z `migrations.md` schemat i dane idą w osobnych rewizjach, każda z prawdziwym `downgrade`.
  - **0041 (schemat)**: przebudowa `accounts` (np. `inventory_id` UNIQUE nullable, nowy `account_type`: INVENTORY/EXTERNAL, usunięcie `owner_user_id` lub zostawienie go jako denormalizacji), `circulation_transactions` (`movement_type`, `occurred_at` DateTime, nullable `reservation_id`, usunięcie `transaction_date`/`is_posted`), `circulation_entries` (`item_id` NOT NULL, `quantity` ze znakiem lub zachowane `entry_side` + integer, `reservation_id` per noga, usunięcie `entry_date`). Nowe indeksy.
  - **0042 (dane)**: `DELETE` zapisów, transakcji i kont punktowych (precedens `0007`), seed konta EXTERNAL, konta dla wszystkich istniejących inventory (jeśli wybrano eager, I-5) i bilans otwarcia (K-5).
- Po stronie środowiska: przed `uv run alembic upgrade head` załadować `.env` (memory). Lokalna baza zawiera śmieciowe dane testowe, co przemawia za prostym resetem z bilansem otwarcia zamiast przybliżonego backfillu z FULFILLED rezerwacji. `giver_user_id` z 0039 jest przybliżony, a rezerwacje nie mają from/to ani czasu realizacji.

### 9. Testy

| Plik / miejsce | Dziś | Potrzebna zmiana |
|---|---|---|
| `tests/test_circulation.py:490` `test_fulfillLend_postsCirculationTransactionCreditingOwner` | saldo +1 pkt | przepisać: LEND daje 1 transakcję, PERSONAL(A) −1 / VIRTUAL(B) +1, `item_id`, `reservation_id` |
| `tests/test_term_item_listings.py:136-170` helper `_latest_ledger_entries_for_giver` (`Account.code == f"100-{uid}"`) | punkty | zastąpić helperem `_movements_for_item(item_id)` |
| `tests/test_term_item_listings.py:1659`, `:1710`, audyty `~1571-1770`, sprawdzenia `/balance` `:1863-2033` | GIFT/SWAP w punktach, SWAP jako dwie transakcje | GIFT jako 2 zapisy, SWAP jako **jedna** transakcja z 4 zapisami, usunąć asercje `/balance` |
| nowe | brak | REGISTER (także przez pledge), RETURN, REMOVE, sekwencja REGISTER → LEND → RETURN → GIFT → SWAP → REMOVE w historii (kolejność deterministyczna), niezmiennik saldo konta = `inventory_id` dla każdego itemu, bilans Σ=0 per transakcja, atomowość SWAP (wymuszona awaria drugiej nogi nie zostawia pierwszej), brak zapisu przy create/confirm/cancel, endpoint historii (200/404, usunięty item), testy macierzy autoryzacji dla nowych i usuniętych tras |
| infrastruktura | `conftest.py` robi `alembic upgrade head`, więc konto emisji istnieje | konto EXTERNAL z seedu 0042 będzie dostępne w testach. Testy rejestrują itemy przez `POST /api/inventory-items` (grep: `test_circulation.py:95`, `test_term_item_listings.py:128`), więc REGISTER powstanie naturalnie i niezmiennik da się sprawdzać globalnie. |

Standard: integracyjnie na Postgres 18 (TestContainers), 2–8 testów na grupę funkcji.

### 10. Dokumentacja

- `docs/system-wypozyczalni-inventory-accounting.md`: przepisać sekcje punktowe na księgę ruchów (konta = inventory, EXTERNAL, typy ruchów, przykłady GIFT/LEND/SWAP).
- `.maister/docs/project/architecture.md`: dziś nie wspomina księgi (grep bez trafień). Dodać krótki opis vertical `circulation` jako księgi ruchów.
- `.maister/docs/standards/backend/models.md`: jeśli pojawi się wzorzec „append-only ledger z projekcją w tej samej transakcji”, zasugerować wpis do standardów.

---

## Ścieżka użytkownika

| Wymiar | Obecnie | Po zmianie | Ocena |
|---|---|---|---|
| Osiągalność | Punkty i transakcje dostępne tylko przez API bez konsumenta w UI | Historia przez `GET /api/inventory-items/{id}/history`. Widoczna w UI tylko, jeśli ją dodamy (I-3). | ⚠️ zależy od I-3 |
| Wykrywalność | 1/10 (nieużywany `api/accounts.ts`) | backend-only: 1/10; z sekcją „Historia” w szczegółach rzeczy (`RzeczyView`/panel „Moje rzeczy”): 7/10 | +0 lub +6 |
| Integracja z przepływem | Księga nie wpływa na przepływy | Przepływy LEND/RETURN/GIFT/SWAP, rejestracja i usuwanie zostają dla użytkownika identyczne. Zmienia się tylko zapis w tle, a SWAP staje się atomowy (poprawa). | ✅ |
| Persony | brak | właściciel i pożyczający widzą historię rzeczy. Kto jeszcze? (I-6) | ⚠️ |

Użytkownik nie zobaczy żadnej zmiany zachowania, dopóki nie powstanie UI historii. Wartość zadania to kompletny, audytowalny zapis danych i fundament pod przyszłą historię pożyczek.

## Cykl życia danych

### Encja: ruch przedmiotu (`CirculationTransaction` + `CirculationEntry`)

| Operacja | Backend | UI | Dostęp użytkownika | Status |
|---|---|---|---|---|
| CREATE | dziś tylko `post_circulation` przy fulfill. Docelowo `post_item_movement` przy register, fulfill (4 typy) i soft delete. | pośrednio: istniejące akcje „Dodaj rzecz”, „Potwierdź wymianę”, „Oddaję”, „Usuń” | istniejące przyciski | ✅ po zmianie (automatyczne) |
| READ | dziś `/api/circulation-transactions*` (punkty). Docelowo endpoint historii. | **brak** (grep: brak konsumenta, `api/accounts.ts` nieużywany) | **brak** | ❌ orphaned: backend bez UI |
| UPDATE | celowo brak (append-only) | brak | brak | ✅ n/d (niezmienność) |
| DELETE | celowo brak (korekta tylko nowym ruchem) | brak | brak | ✅ n/d |

### Encja: konto inventory (saldo = przedmioty w inventory)

| Operacja | Backend | UI | Dostęp | Status |
|---|---|---|---|---|
| CREATE | dziś brak (tylko konta punktowe). Docelowo przy tworzeniu inventory lub leniwie. | n/d (systemowe) | n/d | ✅ po zmianie |
| READ (saldo) | dziś brak. Salda nie trzeba wystawiać osobno, jeśli `inventory_id` pozostaje projekcją, bo lista „Moje rzeczy” już pokazuje zawartość inventory. | istniejąca lista rzeczy (`GET /api/inventory-items?inventory_id=`) | ✅ | ✅ (przez projekcję) |
| READ (wyciąg) | brak | brak | brak | ❌ opcjonalne (I-3) |

**Kompletność**: 75%. CREATE działa automatycznie, UPDATE/DELETE świadomie nie istnieją, READ historii w UI jest osierocony. Jest to spójne z dzisiejszym stanem, w którym punkty też są osierocone.
**Operacje osierocone**: READ historii ruchów (backend bez UI) oraz istniejące endpointy punktowe (backend bez UI, do usunięcia).
**Brakujące punkty styku**: szczegóły rzeczy w „Moje rzeczy” (`RzeczyView.tsx`), lista „Pożyczone”/„Wypożyczone komuś” (tu pasowałaby informacja „od kiedy, od kogo”), podsumowanie wymian (`test_exchange_summary.py` wskazuje na istniejący widok podsumowania).

---

## Kwestie wymagające decyzji

### Krytyczne (przed specyfikacją)

1. **K-1 Źródło prawdy o lokalizacji.** Księga czy kolumna `InventoryItem.inventory_id` (i `home_inventory_id`)?
   - A: księga jest źródłem prawdy, a `inventory_id`/`home_inventory_id` to projekcja aktualizowana w tej samej transakcji DB. Niezmiennik saldo = kolumna pilnują testy, a odczyty zostają na kolumnach.
   - B: czysty event-sourcing, czyli usuwamy `inventory_id` i liczymy lokalizację z księgi. Trzeba przepisać wszystkie zapytania holder, owning, list i bridge.
   - C: kolumna jest źródłem prawdy, a księga to tylko log audytu.
   - **Rekomendacja: A.** Daje pełną historię i saldo zgodne z clarifications #2 bez przepisywania kilkunastu zapytań. Wymaga jednak dyscypliny: każda mutacja `inventory_id` przechodzi przez funkcję ruchu.

2. **K-2 Kształt konta.**
   - A: zostaje tabela `accounts` z `inventory_id` UNIQUE FK (nullable tylko dla EXTERNAL) i `account_type` INVENTORY/EXTERNAL.
   - B: bez tabeli kont. Zapis wskazuje `inventory_id`, a EXTERNAL to specjalny `Inventory` (nowy `InventoryType.EXTERNAL`, `owner_user_id` NOT NULL wymusza jednak sztucznego właściciela).
   - **Rekomendacja: A.** Zgodne z archetypem accounting i z „account = inventory” z clarifications. Nie psuje `Inventory.owner_user_id NOT NULL`.

3. **K-3 Reprezentacja ilości w zapisie.**
   - A: jeden zapis per (item, konto) z `item_id` i `quantity` ze znakiem (−1/+1, CHECK `quantity IN (-1, 1)`), bez `entry_side`/`amount`.
   - B: zachowane `entry_side` DEBIT/CREDIT + `quantity` dodatnie + `item_id`.
   - **Rekomendacja: A.** Saldo to `SUM(quantity)` per (konto, item) = 1, bilans to Σ=0. Prosto i zgodnie z przykładami użytkownika („−1×item#40 / +1×item#40”).

4. **K-4 Atomowość SWAP.**
   - A: jedna `CirculationTransaction` typu SWAP z 4 zapisami. Obie nogi (confirm i fulfill) idą w jednym commicie przez nowy use case w circulation (np. `fulfill_swap`) wołany przez bridge z `confirm_transaction`.
   - B: dwie transakcje, ale w jednym commicie.
   - C: zostawić jak jest (dwie transakcje, osobne commity).
   - **Rekomendacja: A.** Wymiana to jedno zdarzenie, a C może zostawić pół wymiany. Konsekwencja: confirm/fulfill potrzebują ścieżek flush-only, a `confirm_transaction` ma dziś commity per noga w confirm i w fulfill.

5. **K-5 Istniejące dane.**
   - A: reset. Usunąć punkty i konta punktowe, założyć konta i EXTERNAL, dla każdego żywego itemu zaksięgować „bilans otwarcia” (EXTERNAL → bieżące `inventory_id`, typ OPENING lub REGISTER z adnotacją), żeby niezmiennik K-1 był spełniony od razu.
   - B: przybliżony backfill historii z FULFILLED rezerwacji.
   - C: reset bez bilansu otwarcia, czyli stare itemy bez historii, a niezmiennik obowiązuje tylko dla nowych.
   - **Rekomendacja: A.** Dane są śmieciowe (PoC), backfill byłby niedokładny (brak from/to, przybliżony `giver_user_id` z 0039), a C łamie „saldo konta = przedmioty w inventory”. Pytanie pomocnicze: czy itemy pożyczone (w VIRTUAL) otwierać wprost w VIRTUAL, czy jako OPENING → home + LEND → VIRTUAL? Rekomendacja: wprost do bieżącego `inventory_id`.

### Ważne (warto rozstrzygnąć, jest domyślna odpowiedź)

1. **I-1 Czy create/confirm/cancel rezerwacji coś księgują?** Opcje: nic / zapisy „zarezerwowane” (np. konto rezerwacji). **Domyślnie: nic.** Rezerwacja to stan, a nie ruch, zgodnie z regułą INV „nigdy przy pending/confirmed”. Stan zostaje w `InventoryBalance` i `Reservation.status`.
2. **I-2 Czy PATCH `condition`/`product_id` trafia do historii?** Opcje: poza zakresem / osobny log zdarzeń niebędących ruchem / typ transakcji ADJUST bez zapisów. **Domyślnie: poza zakresem.** Księga dotyczy ruchów, a nadpisywanie bez logu zostaje świadomą luką do osobnego zadania.
3. **I-3 Zakres API i UI historii w tym zadaniu.** Opcje:
   - (a) tylko backend: `GET /api/inventory-items/{id}/history` + `GET /api/circulation-transactions/{id}`;
   - (b) jak (a) + wyciąg konta `GET /api/inventories/{id}/ledger`;
   - (c) jak (a) + sekcja „Historia” w szczegółach rzeczy w FE (hook TanStack Query wg `data-fetching.md`).

   **Domyślnie: (a).** Bez UI odczyt pozostaje osierocony, co jest świadomą decyzją. Warto zapytać, czy (c) wchodzi teraz.
4. **I-4 Gdzie żyje `due_date` i stan pożyczki?** Opcje:
   - (a) zostaje w `InventoryBalance` jako stan bieżący, a księga daje historię LEND/RETURN;
   - (b) jak (a) + migawka `due_date` na LEND (kolumna w transakcji albo na rezerwacji), żeby historia pamiętała umówiony termin;
   - (c) encja `Loan` (odrzucona przez użytkownika jako główny nośnik).

   **Domyślnie: (a).** Termin nie jest ruchem, a przedłużenia/recall są poza zakresem. (b) to tania opcja, jeśli użytkownik chce „do kiedy” w historii.
5. **I-5 Tworzenie kont i wyścigi.** Opcje:
   - (a) konto tworzone razem z inventory (w `create_inventory` i `_get_or_create_inventory`, w tym samym SAVEPOINT) + backfill w 0042 dla istniejących;
   - (b) leniwie przy pierwszym ruchu, get-or-create z SAVEPOINT/IntegrityError (wzorzec `inventory.py:37-63`).

   **Domyślnie: (a).** Konto istnieje zawsze, gdy istnieje inventory, więc nie ma wyścigu na `uq`. Wymaga jednak pilnowania wszystkich miejsc tworzenia inventory (dziś 2).
6. **I-6 Kto może czytać historię przedmiotu?** Opcje: dowolny principal z READ (jak istniejące GET-y) / tylko strony, które kiedykolwiek miały przedmiot / tylko obecny właściciel. **Domyślnie: dowolny READ**, spójnie z `/api/inventory-items/{id}`. Historia ujawnia jednak, kto miał rzecz, więc trzeba to potwierdzić.
7. **I-7 Egzekwowanie bilansu.** Opcje: walidacja w `ledger.py` + testy / dodatkowo CHECK `quantity IN (-1, 1)` i deferrable constraint trigger Σ=0. **Domyślnie: walidacja w kodzie + CHECK na `quantity`.** Trigger to przerost dla PoC.
8. **I-8 Precyzja i strefa czasu.** Opcje: `DateTime()` naiwny UTC z pełnym czasem (spójnie z resztą modelu, `datetime.utcnow()` wszędzie) / `timestamptz` tylko dla księgi. W obu przypadkach sortowanie po `(occurred_at, id)`. **Domyślnie: naiwny UTC DateTime, spójnie z projektem.** Ujednolicenie zegara to osobne zadanie.
9. **I-9 Powiązanie SWAP z rezerwacjami.** Opcje: `reservation_id` na zapisie (każda noga wskazuje swoją rezerwację) / `reservation_id` na transakcji (noga główna, druga przez `paired_reservation_id`). **Domyślnie: `reservation_id` na zapisie**, nullable dla REGISTER/REMOVE/OPENING.
10. **I-10 Atomowość `cancel_transaction` dla SWAP.** Opcje: poprawić przy okazji (jeden commit) / zostawić. **Domyślnie: poprawić**, ten sam mechanizm flush-only co w K-4, mały koszt.
11. **I-11 Los `GET /api/circulation-transactions?account_id=`.** Opcje: usunąć / zastąpić wyciągiem konta inventory. **Domyślnie: usunąć** (albo przepiąć, jeśli I-3 = b). `GET /api/circulation-transactions/{id}` zostaje jako szczegóły ruchu.

## Rekomendacje

- Jedna funkcja zapisu w `infrastructure/ledger.py` (flush-only, waliduje bilans) jako jedyne miejsce zmiany `inventory_id`/`home_inventory_id`, dzięki czemu niezmiennik K-1 wynika z kodu.
- `from_inventory_id` przechwytywać przed mutacją w każdej gałęzi `fulfill_reservation`, zachować jego sygnaturę i dodać ścieżkę SWAP z jednym commitem.
- Migracje: 0041 schemat, 0042 dane (reset, EXTERNAL, konta per inventory, bilans otwarcia), obie z `downgrade`.
- Usunąć punkty kompletnie (backend, macierz wiersz 44, FE `api/accounts.ts`, docstringi, dokument INV).
- Dodać test niezmiennika „dla każdego itemu: konto z saldem 1 = konto `inventory_id`, a usunięte itemy mają saldo 0 wszędzie” i test historii pełnego cyklu.
- Po implementacji zaproponować standard: „append-only ledger + projekcja aktualizowana w tej samej transakcji; mutacja lokalizacji tylko przez funkcję ruchu”.

## Ocena ryzyka

- **Ryzyko złożoności: średnie.** Model jest prosty (item × ±1), ale SWAP w jednym commicie wymaga refaktoru commitów w confirm/fulfill.
- **Ryzyko integracji: średnie.** `confirm_transaction` (groups) i bridge dostają nową ścieżkę SWAP. `pledge_fulfillment` i `register_item` dostają zapis przed commitem. Pozostałe odczyty się nie zmieniają (K-1 A).
- **Ryzyko regresji: średnie.** Kilkanaście testów fulfill i asercje punktowe do przepisania. Migracja zmienia znaczenie tabel, a lokalną bazę trzeba zmigrować z załadowanym `.env`.

---

```yaml
status: success
report_path: ".maister/tasks/development/2026-09-28-circulation-ledger-item-movements/analysis/gap-analysis.md"
risk_level: medium
effort_estimate: medium
task_characteristics:
  has_reproducible_defect: false
  modifies_existing_code: true
  creates_new_entities: true
  involves_data_operations: true
  ui_heavy: false
change_type: modificative
compatibility_requirements: flexible
user_journey_impact:
  reachability_change: "0"
  discoverability_before: 1
  discoverability_after: 1   # 7 jeśli I-3 = (c) UI historii
  flow_integration: neutral  # SWAP atomowy = poprawa niewidoczna
integration_points:
  - "app/circulation/application/reservation_transitions.py fulfill_reservation (LEND :105, RETURN :118, GIFT/SWAP :127, ledger call :139)"
  - "app/circulation/application/inventory_items.py register_item :31, soft_delete_item :166"
  - "app/circulation/application/inventory.py create_inventory / _get_or_create_inventory (tworzenie kont)"
  - "app/groups/application/term_item_listings.py confirm_transaction :782-822, cancel_transaction :825-848"
  - "app/groups/infrastructure/circulation_bridge.py (nowy pass-through dla atomowego SWAP)"
  - "app/circulation/router.py + app/core/authorization_matrix.py wiersze 40, 44, 45"
patterns_to_follow:
  - "SAVEPOINT + IntegrityError get-or-create: app/circulation/application/inventory.py:37-63"
  - "flush-only infrastructure, commit w application (ledger.py / reservation_transitions.py)"
  - "data-reset migration precedens: alembic/versions/0007 (DELETE FROM circulation_entries/transactions)"
  - "_enum_column StrEnum String-backed (models.py:31), lazy='raise' + selectinload"
architectural_impact: medium
data_lifecycle_gaps:
  orphaned_operations:
    - "READ historii ruchów: backend (nowy endpoint) bez UI"
    - "obecne endpointy punktowe /api/accounts/*/balance i /api/circulation-transactions* bez konsumenta (do usunięcia)"
  missing_touchpoints:
    - "szczegóły rzeczy w Moje rzeczy (RzeczyView.tsx): sekcja Historia"
    - "listy Pożyczone / Wypożyczone komuś: od kiedy, od kogo"
    - "PATCH condition/product_id bez logu"
  completeness_score: 75
decisions_needed:
  critical:
    - id: "source-of-truth-location"
      issue: "Lokalizacja przedmiotu będzie w dwóch miejscach: saldo konta w księdze i InventoryItem.inventory_id/home_inventory_id"
      options: ["A: księga źródłem prawdy, kolumny jako projekcja w tej samej transakcji + test niezmiennika", "B: usunąć inventory_id, liczyć lokalizację z księgi", "C: kolumna źródłem prawdy, księga tylko log"]
      recommendation: "A"
      rationale: "Pełna historia i saldo zgodne z clarifications #2 bez przepisywania kilkunastu zapytań holder/owning/list/bridge"
    - id: "account-shape"
      issue: "Jak zamodelować konto = inventory oraz konto systemowe EXTERNAL"
      options: ["A: tabela accounts z inventory_id UNIQUE FK (NULL tylko dla EXTERNAL), account_type INVENTORY/EXTERNAL", "B: bez kont, zapis wskazuje inventory_id, EXTERNAL jako specjalny Inventory"]
      recommendation: "A"
      rationale: "Zgodne z archetypem accounting; nie łamie Inventory.owner_user_id NOT NULL"
    - id: "entry-quantity-representation"
      issue: "Jak reprezentować ruch przedmiotu w zapisie"
      options: ["A: item_id + quantity ze znakiem (-1/+1, CHECK), bez entry_side/amount", "B: entry_side DEBIT/CREDIT + quantity dodatnie + item_id"]
      recommendation: "A"
      rationale: "Saldo = SUM(quantity), bilans Σ=0; odpowiada przykładom użytkownika"
    - id: "swap-atomicity"
      issue: "SWAP dziś to 2 transakcje i do 4 commitów (confirm+fulfill per noga); awaria może zostawić pół wymiany"
      options: ["A: jedna transakcja SWAP z 4 zapisami, confirm+fulfill obu nóg w jednym commicie (nowy use case w circulation przez bridge)", "B: dwie transakcje w jednym commicie", "C: bez zmian"]
      recommendation: "A"
      rationale: "Wymiana to jedno zdarzenie; wymaga ścieżek flush-only w confirm/fulfill"
    - id: "existing-data-plan"
      issue: "Istniejące dane punktowe i itemy bez historii ruchów"
      options: ["A: reset + konta per inventory + EXTERNAL + bilans otwarcia EXTERNAL->bieżące inventory_id dla każdego żywego itemu", "B: przybliżony backfill z FULFILLED rezerwacji", "C: reset bez bilansu otwarcia"]
      recommendation: "A"
      rationale: "PoC ze śmieciowymi danymi; backfill niedokładny (brak from/to, przybliżony giver z 0039); C łamie niezmiennik salda"
  important:
    - id: "pending-states-posting"
      issue: "Czy create/confirm/cancel rezerwacji coś księgują"
      options: ["nic (stan zostaje w InventoryBalance/Reservation)", "zapisy na koncie rezerwacji"]
      default: "nic"
      rationale: "Rezerwacja to stan, nie ruch; reguła INV 'nigdy przy pending/confirmed'"
    - id: "patch-item-changes"
      issue: "PATCH condition/product_id nadpisuje bez logu"
      options: ["poza zakresem", "osobny log zdarzeń", "typ ADJUST bez zapisów"]
      default: "poza zakresem"
      rationale: "Księga dotyczy ruchów między inventory"
    - id: "history-api-ui-scope"
      issue: "Zakres odczytu historii w tym zadaniu; bez UI READ jest osierocony"
      options: ["a: GET /api/inventory-items/{id}/history + GET /api/circulation-transactions/{id}", "b: a + wyciąg konta GET /api/inventories/{id}/ledger", "c: a + sekcja Historia w FE (hook TanStack Query)"]
      default: "a"
      rationale: "Najmniejszy zakres realizujący cel; UI można dodać osobno"
    - id: "due-date-location"
      issue: "Gdzie żyje due_date/stan pożyczki po odrzuceniu Loan"
      options: ["a: InventoryBalance jako stan bieżący, historia LEND/RETURN z księgi", "b: a + migawka due_date na LEND (transakcja lub rezerwacja)", "c: encja Loan"]
      default: "a"
      rationale: "Termin nie jest ruchem; przedłużenia/recall poza zakresem; B3 już załatany"
    - id: "account-creation"
      issue: "Kiedy tworzyć konto inventory i jak uniknąć wyścigu (dziś race na uq_accounts_code)"
      options: ["a: razem z inventory (create_inventory, _get_or_create_inventory) + backfill w 0042", "b: leniwie przy pierwszym ruchu z SAVEPOINT/IntegrityError"]
      default: "a"
      rationale: "Konto zawsze istnieje, gdy istnieje inventory; brak wyścigu przy księgowaniu"
    - id: "history-read-authorization"
      issue: "Historia ujawnia, kto i kiedy miał przedmiot; istniejące GET-y nie sprawdzają właściciela"
      options: ["dowolny principal z READ", "tylko strony, które miały przedmiot", "tylko obecny właściciel"]
      default: "dowolny principal z READ"
      rationale: "Spójność z GET /api/inventory-items/{id} (wiersz 40)"
    - id: "balance-enforcement"
      issue: "Nic dziś nie wymusza bilansu transakcji"
      options: ["walidacja w ledger.py + CHECK quantity IN (-1,1)", "dodatkowo deferrable trigger Σ=0"]
      default: "walidacja w kodzie + CHECK"
      rationale: "Trigger to przerost dla PoC"
    - id: "timestamp-precision"
      issue: "transaction_date/entry_date to tylko Date, kolejność w obrębie dnia niedeterministyczna"
      options: ["DateTime() naiwny UTC + sortowanie (occurred_at, id)", "timestamptz tylko dla księgi"]
      default: "DateTime() naiwny UTC"
      rationale: "Spójnie z resztą modelu (utcnow wszędzie); ujednolicenie zegara to osobne zadanie"
    - id: "swap-reservation-link"
      issue: "Transakcja SWAP obejmuje dwie rezerwacje"
      options: ["reservation_id na zapisie (per noga)", "reservation_id na transakcji (noga główna)"]
      default: "reservation_id na zapisie"
      rationale: "Każda noga jednoznacznie łączy się z rezerwacją; NULL dla REGISTER/REMOVE/OPENING"
    - id: "swap-cancel-atomicity"
      issue: "cancel_transaction dla SWAP to dwa commity"
      options: ["poprawić przy okazji", "zostawić"]
      default: "poprawić przy okazji"
      rationale: "Ten sam mechanizm flush-only co przy fulfill, mały koszt"
    - id: "points-transactions-endpoint"
      issue: "Los GET /api/circulation-transactions?account_id="
      options: ["usunąć", "zastąpić wyciągiem konta inventory"]
      default: "usunąć (GET /api/circulation-transactions/{id} zostaje)"
      rationale: "Konta punktowe znikają; wyciąg tylko jeśli history-api-ui-scope = b"
scope_expansion_recommended: false
critical_issues:
  - "SWAP nieatomowy: confirm_transaction commituje per noga w confirm_reservation (:61) i fulfill_reservation (:143)"
  - "Podwójne źródło lokalizacji (księga vs inventory_id) wymaga decyzji i testu niezmiennika"
  - "Zmiana znaczenia tabel accounts/circulation_* wymaga migracji schematu i danych (0041/0042) z downgrade"
```
