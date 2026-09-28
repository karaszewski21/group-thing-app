# Audyt specyfikacji: księga ruchów przedmiotów (`app.circulation`)

- **Spec**: `implementation/spec.md`
- **Wejścia wiążące**: `analysis/requirements.md`, `analysis/scope-clarifications.md`, `analysis/clarifications.md`
- **Data audytu**: 2026-09-28
- **Metoda**: każde twierdzenie spec zweryfikowane w kodzie. Kod sprawdzany na `HEAD` (`08bb4c6`), bo spec był pisany pod `HEAD`. Równolegle sprawdzano drzewo robocze (patrz C1).

## Werdykt

**FAIL (blokada środowiskowa).** Merytorycznie spec jest bardzo dobry: jest kompletny względem decyzji, a odwołania file:line są prawie w 100% poprawne. Lista czyszczenia w 0041 jest pełna, a projekt atomowości rzeczywiście usuwa pośrednie commity. Po rozwiązaniu C1 werdykt zmienia się na **pass-with-concerns**.

Blokada: w drzewie roboczym trwa równolegle nieskomitowana konwersja wszystkich PK na UUID (81 plików, bez migracji). Zmienia ona fundamenty, na których stoi spec: `BigInteger` + sekwencje, `nextval('account_seq')`, typy `int`, numer migracji 0041. Dotyka też dokładnie tych plików, które spec każe przepisywać.

| Poziom | Liczba |
|---|---|
| Critical | 1 |
| High | 2 |
| Medium | 6 |
| Low | 9 |

---

## Critical

### C1. Równoległa, nieskomitowana migracja PK na UUID unieważnia założenia techniczne spec

**Kategoria:** Incorrect / Ambiguous (założenie bazowe).

**Dowody:**

1. `git status` pokazuje 81 zmodyfikowanych plików `src/backend/app/**`. Liczba rosła w trakcie audytu: 22, potem 38, potem 81 plików, więc ktoś aktywnie pracuje w drzewie.
2. `src/backend/app/core/base_model.py` (diff): `id` zmieniono na `postgresql.UUID(as_uuid=True), default=uuid.uuid4, server_default=gen_random_uuid()`, a `__sequence_name__` usunięto.
3. `src/backend/app/circulation/models.py` (diff): wszystkie `Mapped[int]` zamieniono na `Mapped[uuid.UUID]`, a `__sequence_name__ = "account_seq"` itd. usunięto.
4. Zmodyfikowane są dokładnie pliki objęte spec:
   - `circulation/infrastructure/ledger.py`
   - `application/reservation_transitions.py`, `inventory.py`, `inventory_items.py`
   - `groups/application/term_item_listings.py`, `pledge_fulfillment.py`
   - `groups/infrastructure/circulation_bridge.py`
   - `circulation/router.py`, `schemas.py`

   Przykład: `pledge_fulfillment.py:31` ma już `pledge_id: uuid.UUID`, a `groups/router/term_item_listings.py:137` ma `reservation_id: uuid.UUID`.
5. W `alembic/versions/` najnowsza jest `0040`. Migracji UUID nie ma, więc obie zmiany będą rościć sobie numer `0041`.
6. Dokumenty zadania (`analysis/*`, `spec.md`) nie wspominają o UUID. `.maister/docs/standards/backend/models.md` nadal opisuje sekwencje.

**Co w spec staje się nieaktualne:**
- „Sekwencje: wszystkie istniejące zostają bez zmian” (spec, sekcja modelu);
- seed `INSERT … VALUES (nextval('account_seq'), …)` (krok 3 upgrade);
- ponowny seed `900-100` z `0005` w downgrade;
- kolumny `item_id`/`reservation_id`/`inventory_id` jako `BigInteger`;
- typy `int` w `MovementLeg`, `fulfill_exchange(reservation_ids: Sequence[int])` i schematach odpowiedzi;
- test migracji seedujący dane „na 0040” w kształcie BigInteger;
- `down_revision = "0040"`.

**Ryzyko:** implementacja zgodna ze spec powstanie na gałęzi, która koliduje z UUID-refaktorem w każdym pliku. Grozi to konfliktami, dwiema rewizjami `0041` i rozgałęzieniem historii Alembica.

**Rekomendacja:** przed implementacją zapytać użytkownika o kolejność:
- **(a)** najpierw dokończyć i skomitować migrację UUID (np. jako `0041`), a ten spec przenumerować na `0042` i przepisać na UUID: seed przez `gen_random_uuid()`, kolumny `postgresql.UUID`, typy `uuid.UUID`;
- **(b)** odłożyć albo zestashować UUID-WIP i realizować ten spec na `HEAD`.

W spec trzeba dopisać jawną „rewizję bazową” i typ PK.

---

## High

### H1. Autoryzacja `fulfill_exchange`/`cancel_exchange` opiera się wyłącznie na wołającym, a funkcje trafiają do publicznej fasady

**Kategoria:** Incomplete (bezpieczeństwo).

**Dowody:**
- Spec (sekcja „Nowe publiczne use case'y”, założenie A2): use case sam wylicza posiadacza i używa go jako aktora. Kontrola tożsamości zostaje w groups (`_require_race_participant`, `term_item_listings.py:738-742` na HEAD).
- Nowe funkcje mają być eksportowane z `app/circulation/service.py`. Dziś eksportowane `confirm_reservation`/`fulfill_reservation` przyjmują `acting_user_id` i same sprawdzają `_require_holder_to_confirm` / `_require_party_to_reservation` (`reservation_transitions.py:54`, `:99`). Nowe API tego nie robi: każdy wołający fasadę dostaje „confirm+fulfill jako posiadacz” bez żadnego sprawdzenia.
- Dziś stan jest faktycznie równoważny (groups przekazuje `resolve_current_holder_user_id`, `circulation_bridge.py:128-137`). Różnica polega na tym, że bramka znika z circulation, a nie tylko jest obchodzona przez jednego wołającego.

**Rekomendacja:**
- Nadać funkcjom nazwę sygnalizującą zaufanego wołającego (np. `fulfill_exchange_as_holders`).
- Nie wystawiać ich przez router.
- Dopisać w spec test w `test_authorization_matrix.py` albo test jednostkowy, że żaden router circulation ich nie woła.
- Alternatywa: przyjmować `acting_user_id` i wymagać, żeby był stroną co najmniej jednej nogi (`reserved_by_user_id` / `giver_user_id`). Wtedy bramka zostaje w circulation.

### H2. Walidacja kształtu SWAP w `post_movement` nie sprawdza krzyżowania nóg

**Kategoria:** Incomplete.

**Dowody:**
- Spec (Walidacja, pkt 1-2): dla SWAP wymaga 2 nóg, różnych itemów, `from ≠ to`.
- Wymóg z `requirements.md` (tabela typów) to „X: A −1 / B +1; Y: B −1 / A +1”. Spec nie wymaga `leg1.from == leg2.to` i `leg1.to == leg2.from`, więc dwie niezależne przeprowadzki A→B i C→D przeszłyby jako SWAP.
- Dane wejściowe są parowane w `fulfill_exchange` (`paired_reservation_id`), ale jeśli `post_movement` ma być „jedynym strażnikiem”, reguła kształtu jest niepełna.
- Uwaga: `to` nogi to PERSONAL(`reserved_by`), a `from` to bieżący inwentarz. Jeśli item Y leży w innym inwentarzu B niż PERSONAL(B) (np. PICKUP_POINT), krzyżowanie „na inwentarzach” nie zajdzie, mimo że wymiana jest poprawna na poziomie właścicieli.

**Rekomendacja:** doprecyzować regułę:
- wariant „inwentarzowy”: `{leg1.from, leg1.to} == {leg2.to, leg2.from}`;
- albo wariant „właścicielski”: właściciel `from` nogi 1 = właściciel `to` nogi 2 i odwrotnie.

Wybór zależy od tego, czy PICKUP_POINT może być źródłem wymiany. To pytanie do użytkownika (patrz „Pytania”).

---

## Medium

### M1. Zapytanie historii importuje model innego modułu (`UserProfile`), wbrew regule fasady

**Kategoria:** Ambiguous (DDD).

**Dowody:**
- Spec (API historii): LEFT JOIN do `user_profiles`, uzasadniony precedensami:
  - `circulation/infrastructure/repository.py:84-92` (`Product`, import `app.product.models` w `:27`);
  - `groups/infrastructure/repository.py:75` (import `app.users.models` w `:18`).
- Precedensy potwierdzono, oba numery linii są poprawne. Pamięć projektu i `CLAUDE.md` mówią jednak: „import from app.<v>.service only”. Obecne precedensy są odstępstwem, a spec je powiela, nie nazywając tego odstępstwem.

**Rekomendacja:** w spec jawnie zapisać: „join na poziomie zapytania do tabeli innego modułu w warstwie `infrastructure/` jest akceptowanym wyjątkiem od reguły fasady (precedensy X, Y)”. Alternatywa: pobrać `display_name` drugim zapytaniem przez `app.users.service` (batch po `owner_user_id`), co daje 2 zapytania, nadal bez N+1.

### M2. Kontrola „from == item.inventory_id” w `post_movement` jest tautologiczna, a współbieżność zależy wyłącznie od `version_id_col`

**Kategoria:** Incorrect (uzasadnienie).

**Dowody:**
- Spec („Kiedy odczytywane jest from”) twierdzi, że niezgodność oznacza „nieaktualny odczyt” i daje 409. Tymczasem wołający bierze `from` z tego samego obiektu `item` w tej samej sesji, który następnie sprawdza `post_movement`. Poza błędem programistycznym (np. dwie nogi tego samego itemu) warunek nie może być fałszywy.
- Faktyczną ochronę przed równoległym ruchem daje `version_id_col = updated_at` (`app/core/base_model.py` na HEAD, `__mapper_args__`). Przy READ COMMITTED drugi `UPDATE … WHERE updated_at = :old` zwróci 0 wierszy, co da `StaleDataError`, który handler zamienia na 409 (`app/core/errors.py:88`, `:138`). Działa to tylko dla ruchów, które faktycznie aktualizują wiersz itemu. REGISTER niczego nie aktualizuje, ale też nie ma konkurencji.
- Test planowany w spec, „`post_movement` z nieaktualnym `from` daje 409”, musi sztucznie skonstruować nogę. Nie testuje współbieżności.

**Rekomendacja:** przeformułować w spec: „asercja spójności nogi z projekcją (ochrona przed błędem wołającego); współbieżność zabezpiecza optimistic lock”. Test współbieżności nie jest wykonalny w izolacji SAVEPOINT na jednym połączeniu (`tests/conftest.py:66-82`). Wystarczy istniejący `tests/test_stale_data_error_handler.py`. Warto to zapisać, żeby implementator nie próbował.

### M3. Pledge po czyszczeniu: `FULFILLED` z `resolved_reservation_id = NULL` to niespójny stan

**Kategoria:** Incomplete.

**Dowody:**
- Spec, wiersz 9 czyszczenia: `UPDATE pledges SET resolved_reservation_id = NULL`, `status` zostaje.
- `groups/application/pledge_fulfillment.py:115-116`: `sync_pledge_fulfillment` rzuca `AccessDeniedException` (403) dla NULL.
- `groups/application/terms.py:184`: FULFILLED liczy się jako „zarejestrowany”, a `public_view.py:156` pokazuje `registered=False`. Dwa widoki dają sprzeczne odpowiedzi dla tego samego pledge.
- Twierdzenie „CLAIMED można ponownie zrealizować” jest prawdziwe, bo `fulfill_pledge` nie sprawdza statusu (`pledge_fulfillment.py:30-110`).

**Rekomendacja:** dodać `UPDATE pledges SET status='CLAIMED' WHERE status='FULFILLED'`. Pledge wraca wtedy do stanu „zgłoszony, bez przedmiotu” spójnie z CLAIMED. Alternatywa: jawnie zaakceptować niespójność (precedens `0007:37` robił to samo). Decyzję zapisać w docstringu.

### M4. Test migracji 0041 to nowy, ciężki wzorzec bez precedensu w repo

**Kategoria:** Ambiguous / ryzyko wykonalności.

**Dowody:**
- Spec (grupa „Migracja 0041”): `CREATE DATABASE` przez połączenie AUTOCOMMIT, potem alembic w subprocessie: `upgrade 0040`, seed SQL, `upgrade head`, `downgrade 0040`, `upgrade head`.
- W repo jedyny test „migracyjny” (`tests/test_circulation.py:818`) odtwarza SQL inline na już zmigrowanej bazie i nie uruchamia Alembica. `conftest.py:47-58` uruchamia `upgrade head` tylko raz.
- Mimo to test jest wykonalny: kontener jest session-scoped, a `DATABASE_URL` przekazywany przez env działa (`conftest.py:50-56`). Kosztuje około 3 pełnych przebiegów 40+ migracji.
- Seed „na 0040” musi być surowym SQL w kształcie sprzed 0041, z `nextval(...)` każdej sekwencji. Kolizja z C1.
- „Test migracji odwołuje się do `_WIPE_STATEMENTS`”: moduł `0041_….py` zaczyna się cyfrą, więc import wymaga `importlib`. Spec tego nie mówi.

**Rekomendacja:**
- Oznaczyć test markerem (np. `@pytest.mark.migration`), żeby dało się go pominąć lokalnie.
- Doprecyzować w spec import przez `importlib.util.spec_from_file_location`.
- Ograniczyć cykl do `upgrade 0040`, seed, `upgrade head`, `downgrade 0040`. Ostatnie `upgrade head` dodaje niewiele.

### M5. Commit zmian groups wykonuje use case circulation, co nie jest opisane jako kontrakt

**Kategoria:** Incomplete (atomowość, pkt 4 zlecenia).

**Dowody:**
- `term_item_listings.py:796-802` (HEAD): usuwanie `ItemListingPreference` jest tylko flushowane. Dziś commituje je pierwszy `fulfill_reservation`. W spec commit przejmuje `fulfill_exchange`, co jest poprawne, ale groups nadal polega na efekcie ubocznym commita w innym module.
- Weryfikacja pozostałych zapisów w tych przepływach:
  - `confirm_transaction` i `cancel_transaction` nie tworzą powiadomień poza ścieżką „already resolved”. Ta ścieżka commituje `TERM_ALREADY_RESOLVED` i rzuca wyjątek **przed** jakąkolwiek zmianą stanu (`term_item_listings.py:761-770`), więc jest spójna.
  - W `_confirm`/`_cancel`/`_fulfill` i `get_or_create_*_inventory` nie ma commitów, tylko `begin_nested` jako SAVEPOINT (`inventory.py:55-58`).
  - Wniosek: przy podziale z spec w `confirm_transaction` i `cancel_transaction` zostaje dokładnie jeden commit.

**Rekomendacja:** w docstringach `fulfill_exchange`/`cancel_exchange` (i w spec) zapisać kontrakt: „commituje całą bieżącą transakcję sesji, łącznie z wcześniej flushowanymi zmianami wołającego”. W teście awarii SWAP spec słusznie sprawdza preferencje. Warto dodać asercję, że po sukcesie preferencja zniknęła.

### M6. `fulfill_pledge`, `accept_swap_proposal` i `take_item_listing` nadal mają pośrednie commity (świadomie poza zakresem, ale bez oceny skutków)

**Kategoria:** Ambiguous.

**Dowody:**
- `pledge_fulfillment.py:75-108`: `register_item` commituje REGISTER + item, `create_lend_reservation` commituje, `confirm_reservation` commituje, a na końcu commit pledge i powiadomienia `PLEDGE_ITEM_REGISTERED`.
- `accept_swap_proposal` (`term_item_listings.py:592-657`): confirm commituje, potem proposal i powiadomienie `SWAP_ACCEPTED` w osobnym commicie.
- Dla księgi to bezpieczne: REGISTER commituje się razem z itemem, więc niezmiennik trzyma się po każdym commicie. Awaria po `register_item` zostawia jednak zarejestrowany item bez pledge. To istniejące zachowanie.

**Rekomendacja:** dopisać w „Poza zakresem” jedno zdanie o skutku: „niezmiennik księgi zachowany; możliwy osierocony item/rezerwacja bez pledge lub powiadomienia, jak dziś”.

---

## Low

- **L1. Drobna nieścisłość w wierszu 4 czyszczenia.** Tekst mówi, że „powiadomienia innych rodzajów (pledge, …) zostają”, a lista `kind IN (…)` usuwa `PLEDGE_ITEM_REGISTERED`. Samo usunięcie jest słuszne, bo dotyczy itemu, który znika. Poprawić tylko opis.
- **L2. `take_item_listing` nie woła `confirm_reservation`.** Spec (Bridge i groups) wymienia go jako konsumenta. Rzeczywiste wywołania to `propose_swap` (`term_item_listings.py:560`), `accept_swap_proposal` (`:636`), `reject_swap_proposal` (`:677`, cancel) i `pledge_fulfillment.py:90`. Wniosek (zostawić pass-throughy) się nie zmienia.
- **L3. „Jednym zapytaniem SQL”** (kryterium sukcesu 6) w praktyce oznacza 2 zapytania, bo dochodzi `repository.get_item` do rozróżnienia 404. Doprecyzować: „ruchy jednym zapytaniem, bez N+1”.
- **L4. CHECK `ck_accounts_inventory_id_account_type` i indeks częściowy EXTERNAL** wykraczają poza wymagania (Extra). Nie łamią decyzji „bez CHECK na quantity”, a spec je uzasadnia. Warto jednak jednym zdaniem potwierdzić to z użytkownikiem, który odrzucił CHECK/trigger dla bilansu.
- **L5. Zawężenie wiersza 45** do `^/api/circulation-transactions/[^/]+$` nie jest konieczne, bo usunięta lista i tak zwróci 404 z routera. Jest nieszkodliwe. Wymaga za to aktualizacji testu macierzy, który spec planuje. Brak asercji `len(AUTHORIZATION_MATRIX)` w testach (sprawdzone), więc usunięcie wiersza 44 niczego nie łamie.
- **L6. Test „awaria przy nodze 2” dla `cancel_exchange`** nie ma wskazanego punktu wstrzyknięcia awarii. Dla fulfill spec podaje monkeypatch `reservation_transitions.get_or_create_personal_inventory`, który jest wykonalny, bo nazwa jest importowana modułowo (`reservation_transitions.py:13-16`). Dla cancel zaproponować np. monkeypatch `reservation_transitions.get_item_balance` rzucający przy drugim wywołaniu.
- **L7. Pole `from_` z aliasem `"from"`.** Do konstrukcji po nazwie potrzeba `model_config = ConfigDict(populate_by_name=True)` albo `validate_by_name` w Pydantic 2.11+. Spec o tym nie wspomina.
- **L8. Race dwóch stron `confirm_transaction`.** Druga strona dostanie generyczne 409 z `StaleDataError` zamiast `TermAlreadyResolved`, jeśli obie miną bramkę statusu równocześnie. Tak jest dziś. Warto odnotować w „Założeniach”.
- **L9. `circulation_bridge` już dziś importuje `app.circulation.models` i `app.circulation.schemas`** (`circulation_bridge.py:15-25`), nie tylko `service`. Spec twierdzi, że groups importuje „wyłącznie przez bridge do `app.circulation.service`”. To prawda dla groups, ale sam bridge łamie regułę. Odnotować i nie pogłębiać (nowe pass-throughy tylko przez `service`).

---

## Weryfikacja odwołań i zachowań (pkt 2 zlecenia)

Wszystkie odwołania sprawdzono na HEAD.

| Twierdzenie spec | Wynik |
|---|---|
| `inventory_items.py:173` daje 409 przy statusie różnym od AVAILABLE | ✅ `:173-176`. Blokada jest w backendzie, a LENT ≠ AVAILABLE, więc pożyczonej rzeczy nie da się usunąć. |
| `inventory_items.py:42` `get_product` | ✅ |
| `soft_delete_item` sam commituje | ✅ `:178` |
| `register_item` commituje po `InventoryBalance` | ✅ `:55` |
| `pledge_fulfillment.py:75` woła `register_item` przez bridge | ✅ `:75-77`, sygnatura bridge'a `circulation_bridge.py:60-63` |
| `confirm_reservation`/`cancel_reservation`/`fulfill_reservation` commitują same | ✅ `reservation_transitions.py:60`, `:85`, `:143` |
| Blokada re-LEND `:106-109`; gałęzie typów `:105-134` | ✅ |
| RETURN bez `home_inventory_id` to dziś cichy no-op | ✅ `:119-121` |
| `_load_reservation_for_transition` `:36`; `_current_holder_user_id` `reservations.py:57` | ✅ |
| `reservation_rules.py:13-31`, `_next_transaction_number` `:44` | ✅ |
| `inventory.py:37-63` (get-or-create z SAVEPOINT), `:66-77` | ✅ |
| Jedyne miejsca `Inventory(` w `app/` | ✅ `inventory.py:18`, `:54` |
| Jedyne mutacje `inventory_id`/`home_inventory_id`/`deleted_at` itemu | ✅ `reservation_transitions.py:113-131`, `inventory_items.py:177`. Brak innych w `app/`, `account_merge` nie rusza itemów. W testach wymuszenia są w `test_circulation.py:1010`, `:1046`. |
| `confirm_transaction :782-822`, `cancel_transaction :825-848`, `_resolve… :698-779` | ✅ |
| `repository.py:84-92` (Product), `:142-150` (`find_transaction_with_entries`) | ✅ |
| `groups/infrastructure/repository.py:75` (UserProfile) | ✅ |
| `router.py:241`, `:252` | ✅ na HEAD; w drzewie roboczym `:242`/`:253` (C1) |
| Matrix, wiersze 44/45 | ✅ `authorization_matrix.py:161-162`; wiersz 40 pokrywa `/history` |
| Testy `test_circulation.py:490`, `:578`, `:332`, `:366`, `:741`; `test_term_item_listings.py:136-170`, `:642`, `:1659`, `:1710`, `:1852` | ✅ |
| `0040` bez indeksu na `notifications.reservation_id` | ✅ (`0040:8`) |
| `uq_user_profiles_account_user_id` | ✅ (`0009:137`) |
| `MovementType(reservation.reservation_type.value)` | ✅ wartości `ReservationType` (`models.py:70-74`) są podzbiorem |

## Migracja 0041: lista czyszczenia (pkt 3 zlecenia)

Sprawdzono wszystkie FK i luźne wskaźniki w `app/*/models.py` i `alembic/versions/*` do: `inventory_items`, `reservations`, `accounts`, `circulation_transactions`, `circulation_entries`, `swap_proposals`.

| Tabela i kolumna | Typ powiązania | Obsługa w spec | Ocena |
|---|---|---|---|
| `inventory_balances.item_id` | FK | DELETE (11) | ✅ |
| `reservations.item_id`, `paired_reservation_id` (samo-FK) | FK | DELETE (10), jedno DELETE jest bezpieczne dla NO ACTION | ✅ |
| `circulation_entries.transaction_id/account_id` | FK | DELETE (1) | ✅ |
| `circulation_transactions` | rodzic | DELETE (2) | ✅ |
| `accounts` (w tym seed `900-100` z 0005) | rodzic, FK do users | DELETE (3) | ✅ |
| `item_listing_preferences.item_id` | luźne (0028) | DELETE (8) | ✅ |
| `swap_proposals.listing_item_id/offered_item_id/proposer_reservation_id` | luźne (0031) | DELETE (7) | ✅ |
| `giveaway_term_end_markers.reservation_id` | luźne (0031) | DELETE (6) | ✅ |
| `notifications.reservation_id` (0040), `proposal_id` (0032) | luźne | DELETE (4) z listą `kind` | ✅ (L1) |
| `notifications.join_request_id` | luźne, do join requests | nie ruszane | ✅ poprawnie |
| `outbox_entries.payload.reservation_id/proposal_id` | luźne JSON (`term_end_scan.py:116-168`, typy `groups.term_ended_giveaway/swap`, `swap_events.py:8-9`) | DELETE (5) | ✅ Zdarzenia pledge (`pledges.py:53`) słusznie zostają. |
| `pledges.resolved_reservation_id` | luźne (0003/0009) | NULL (9) | ✅ zgodnie z precedensem 0007 (M3) |
| `plugin_objects.entity_type/entity_id` | luźne | nie ruszane | ✅ Pluginy wiążą wyłącznie `PRODUCT` (`plugins/warehouse/src/pages/*.tsx`, `ai-description/.../generate.ts:64`). |
| `inventories`, `needed_items`, `terms`, `term_attendances` | brak zależności od itemów | zostają | ✅ |

**Wniosek:**
- Lista jest kompletna i nie pominięto żadnej tabeli.
- Kolejność jest poprawna. Luźne wskaźniki nie mają FK w DB, więc ich kolejność jest dowolna, a rzeczywiste FK idą od dziecka do rodzica.
- Wybory usunąć/NULL są słuszne.
- **Downgrade jest wykonalny**:
  - krok 1 czyści 3 tabele księgi, więc kolumny NOT NULL wracają do pustych tabel;
  - `uq_accounts_code` zostaje odtworzony przed seedem `ON CONFLICT (code)` z 0005;
  - itemy utworzone po 0041 nie zależą od księgi w kształcie 0040.

  Zastrzeżenie: wszystko to dotyczy wersji BigInteger/sekwencje (C1).

## Atomowość (pkt 4 zlecenia)

- Podział na `_confirm`/`_cancel`/`_fulfill` (flush-only) i wrappery z commitem **usuwa wszystkie pośrednie commity** w `confirm_transaction` i `cancel_transaction`. Pozostają tylko commity w `get_or_create_*` (brak, jest tylko SAVEPOINT) i w bramce „already resolved” (przed zmianą stanu). Zweryfikowano w `reservation_transitions.py:47-145`, `inventory.py:37-63`, `term_item_listings.py:698-848`.
- `register_item` i `soft_delete_item`: księgowanie przed istniejącym jedynym commitem jest poprawne.
- Test wycofania jest wykonalny w `conftest`:
  - `join_transaction_mode="create_savepoint"` (`conftest.py:73`) sprawia, że `db_session.rollback()` cofa do ostatniego commita testu;
  - produkcyjne `get_db` (`app/db.py`) zamyka sesję bez commita przy wyjątku.

## `post_movement` i niezmiennik (pkt 5 zlecenia)

- Reguły projekcji per typ są kompletne i zgodne z tabelą wymagań. REMOVE ustawia `deleted_at` i zostawia `inventory_id` jako ostatnią lokalizację, co jest wymuszone przez NOT NULL (`models.py:145-149`).
- „From” jest czytane przed mutacją: poprawnie. Uzasadnienie 409 wymaga poprawki (M2).
- Niezmiennik zawężony do `item_ids` testu działa w izolacji SAVEPOINT, bo zapytania widzą niezacommitowane dane tego samego połączenia. Wszystkie inwentarze w testach powstają przez API lub get-or-create (brak `Inventory(` w `tests/`), więc zawsze mają konto.

## Zapytanie historii (pkt 6 zlecenia)

- Dwa aliasy `CirculationEntry` (−1/+1) po `item_id` w ramach transakcji, JOIN `accounts`, a do `inventories` i `user_profiles` LEFT JOIN. To jedno zapytanie bez N+1, ze stroną EXTERNAL jako NULL. Poprawne.
- Indeks `(item_id, transaction_id)` obsługuje filtr i FK na `item_id`.
- Zastrzeżenia: M1 (reguła fasady), L3, L7.

## Ukryte zależności od usuwanych elementów (pkt 7 zlecenia)

Pełna lista konsumentów (grep `app/`, `tests/`, `src/frontend/src`, `docs/`, `.maister/docs/`):

- `app/circulation/application/accounts.py` (cały plik);
- `domain/constants.py:8`, `:10`;
- `reservation_transitions.py:19`, `:139-141`;
- `infrastructure/ledger.py` (cały plik);
- `repository.py:130-164`;
- `schemas.py:16-18`, `:147`, `:162`, `:172`;
- `router.py:2`, `:241-259`;
- `service.py:1-20` (`__all__`);
- `authorization_matrix.py:161-162`;
- `tests/test_circulation.py:500`, `:512`, `:596`;
- `tests/test_term_item_listings.py:30-34`, `:136-170`, `:1699-1707`, `:1756-1770`;
- `src/frontend/src/api/accounts.ts` (nikt go nie importuje);
- `docs/system-wypozyczalni-inventory-accounting.md` (§1 `:44-62`, §6 `:529`).

**Wszystkie są ujęte w spec.** Nie znaleziono konsumentów w `.maister/docs/standards` ani `project/`. Brak asercji długości macierzy.

## Nadmiar i braki testów (pkt 8 zlecenia)

- Plan testów jest proporcjonalny do zakresu: 6 grup po 2-8 testów, z helperem `tests/ledger_assertions.py` uzasadnionym użyciem w 3 plikach.
- Nadmiarowy jest tylko ciężki test migracji (M4).
- Braki:
  - asercja usunięcia preferencji po udanym SWAP/GIFT (M5);
  - punkt awarii dla `cancel_exchange` (L6);
  - test reguły krzyżowania SWAP (H2);
  - test, że router nie wystawia `fulfill_exchange` (H1).

## Pytania do użytkownika

1. **(C1)** W drzewie roboczym trwa migracja PK na UUID (81 plików, bez rewizji Alembica). Czy ten spec ma iść **po** niej (przenumerować na 0042 i przepisać na UUID), czy UUID-WIP ma zostać odłożony?
2. **(H2)** Czy źródłem SWAP może być inwentarz inny niż PERSONAL, np. PICKUP_POINT? To decyduje, czy krzyżowanie nóg sprawdzamy na inwentarzach, czy na właścicielach.
3. **(M3)** Czy pledge `FULFILLED` po czyszczeniu mają wrócić do `CLAIMED`, czy akceptujemy stan „FULFILLED bez rezerwacji” jak w 0007?
4. **(L4)** Czy CHECK na kształcie konta (INVENTORY ma `inventory_id`, EXTERNAL go nie ma) jest akceptowalny, skoro odrzucono CHECK/trigger bilansu?

## Rekomendowane kolejne kroki

1. Rozstrzygnąć C1 i zaktualizować spec: rewizja bazowa, typ PK, numer migracji, seedy, test migracji.
2. Poprawić H1 (bramka autoryzacji lub nazwa i kontrakt) i H2 (reguła krzyżowania SWAP).
3. Uzupełnić spec o M2-M6 i poprawki opisowe L1-L9. Niczego tu nie trzeba przeprojektowywać.
