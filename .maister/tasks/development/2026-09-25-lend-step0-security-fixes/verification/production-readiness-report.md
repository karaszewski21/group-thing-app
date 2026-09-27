# Raport gotowości produkcyjnej

**Data**: 2026-09-26
**Zakres**: niezacommitowane zmiany w `C:\Users\karas\Desktop\group-thing-app` (git diff + nowe pliki: `src/backend/alembic/versions/0040_notification_reservation_id.py`, `src/backend/tests/test_lend_step0_fixes.py`)
**Cel**: production (aplikacja przed produkcją, brak realnych użytkowników)
**Status**: With Concerns

## Podsumowanie

- **Rekomendacja**: **GO z zastrzeżeniami (GO_WITH_MITIGATIONS)**
- **Ogólna gotowość**: ~85% (dla zakresu tej zmiany)
- **Ryzyko wdrożenia**: Niskie–Średnie
- **Blokery**: 0  **Zastrzeżenia**: 5  **Rekomendacje**: 4

Oceniam zmianę, nie całą platformę. Luki ogólnoplatformowe (brak Sentry, metryk, rate limitingu, health checku zależności) istniały już wcześniej i ta zmiana ich nie pogarsza. Nie uznaję ich za blokery tego wdrożenia. Wymieniam je w sekcji rekomendacji.

**Testy (uruchomione podczas weryfikacji):**
- Backend: `uv run pytest` daje **413 passed**, 0 failed.
- Frontend: `tsc -b --noEmit` czysto. `vitest run` daje 290 passed, 4 failed. Wszystkie 4 błędy są w **niezmienionych** plikach (`auth.test.tsx`, `extension-points.test.tsx`, `foundation.test.tsx`). Przyczyna to zaszyty w testach token JWT z `exp=1790428872` (2026-09-26 13:21 UTC), który wygasł dziś. To bomba czasowa, niezwiązana z tą zmianą. Zmienione testy (`PanelPage.test.tsx`, `RzeczyViewCategory.test.tsx`) przechodzą: 122/122.

## Oceny kategorii

| Kategoria | Ocena | Status |
|-----------|-------|--------|
| Konfiguracja | 90% | OK (brak nowych zmiennych środowiskowych) |
| Monitoring | 70% | Zastrzeżenie (brak logów w scanie) |
| Odporność | 75% | Zastrzeżenia (poison-pill w scanie, zablokowany RETURN) |
| Wydajność | 90% | OK (ograniczone pętle, jedno zapytanie zbiorcze w scanie) |
| Bezpieczeństwo | 95% | OK (zmiana zamyka luki autoryzacji) |
| Wdrożenie | 85% | OK, z wymaganą kolejnością kroków |

## Migracja 0040

- `op.add_column("notifications", reservation_id BIGINT NULL)`: nullable, bez domyślnej wartości i bez indeksu. W PostgreSQL to operacja wyłącznie na metadanych (krótki `ACCESS EXCLUSIVE`, bez przepisywania tabeli), więc jest bezpieczna bez przestoju.
- `down_revision = "0039"`: łańcuch jest liniowy (0036 → 0040), bez rozgałęzień.
- `downgrade()` robi `drop_column`, więc migracja jest odwracalna. Downgrade traci wartości `reservation_id` w istniejących powiadomieniach. To akceptowalne, bo FE ma fallback na `resolvePendingReservationId` przy `reservation_id == null`.
- Brak FK jest świadomy (loose cross-BC pointer), spójnie z `proposal_id`/`join_request_id`.
- ORM `Notification.reservation_id` i `NotificationResponse.reservation_id` odpowiadają migracji.
- `alembic/env.py` czyta `DATABASE_URL` wyłącznie z env (`alembic.ini` ma puste `sqlalchemy.url`). `docker-compose.yml` ustawia `DATABASE_URL` w `environment` i uruchamia `alembic upgrade head && exec uvicorn`, więc w kontenerze to działa. Ręczne uruchomienie poza compose wymaga `export DATABASE_URL=...`, bo `.env` nie jest czytany (patrz zastrzeżenie Z5).

## Kolejność wdrożenia (kompatybilność kontraktu)

Wynik analizy: **nowy BE toleruje stary FE**, ale **nowy FE nie działa ze starym BE**.

- Stary FE wysyła `{term_id}` do `confirm-/cancel-transaction`. Nowe endpointy nie deklarują body, więc FastAPI je ignoruje. Działa.
- Stary FE wysyła `reserved_by_user_id` w `POST /api/reservations`. `CreateReturnReservationRequest` ignoruje nadmiarowe pola, więc działa, a odbiorca i tak jest wyprowadzany po stronie serwera.
- `/api/reservations/swap` usunięty. FE nie miał wywołującego (usunięto też `createSwap`).
- Nowy FE bez body na `confirm-transaction` wobec starego BE dostaje **422**. Tak samo `cancel-transaction`.

**Wymagana kolejność:** (1) `alembic upgrade head` (0040), (2) backend, (3) frontend. Albo wszystko razem w jednym `docker compose up --build`: compose i tak uruchamia migrację przed uvicornem. Rollback w odwrotnej kolejności: najpierw FE, potem BE, a dopiero na końcu (opcjonalnie) `alembic downgrade 0039`. Stary BE działa z kolumną `reservation_id` (nie mapuje jej), więc downgrade schematu nie jest konieczny przy wycofaniu kodu.

Zaległe zdarzenia outbox `TERM_ENDED_GIVEAWAY` wyemitowane przez stary kod mają już `reservation_id` w payload. Nowy `_handle_term_ended_giveaway` czyta `payload["reservation_id"]`, więc przetworzy je poprawnie (brak `KeyError`).

## Scheduler (APScheduler, `term_end_scan`)

- Zapytanie GIFT/LEND jest teraz jedno i zbiorcze (`list_active_hand_over_reservations_for_terms`, `term_id IN (...)`, statusy PENDING/CONFIRMED). Usunięto pętlę per-item. RETURN i SWAP są poprawnie wykluczone.
- Idempotencja: `GiveawayTermEndMarker.reservation_id` ma `unique=True`, a marker i outbox trafiają do jednej transakcji. Istniejące markery GIFT ze starego scanu blokują duplikaty po wdrożeniu.
- Efekt uboczny wdrożenia (akceptowalny): LEND-y z Terminów zakończonych w ostatnich 24h (`DEFAULT_WINDOW`) dostaną jednorazowo nowe powiadomienia `TERM_CONFIRMATION_NEEDED`, bo wcześniej nie były skanowane.
- Job ma interwał 1 min. `_run_term_end_scan` nie ma `try/except`, więc wyjątek łapie i loguje wewnętrzny logger APSchedulera (`Job ... raised an exception`), a job nadal działa. Patrz zastrzeżenie Z1.
- Dockerfile i compose uruchamiają jeden proces uvicorna (bez `--workers`), więc scheduler nie jest zdublowany. Przy wielu workerach unikalny marker spowodowałby `IntegrityError` i rollback jednej z instancji, czyli brak duplikatów, ale z szumem w logach.

## Blokery (muszą być naprawione)

Brak.

## Zastrzeżenia (powinny być naprawione)

**Z1: Poison-pill w `scan_for_term_ended` (resilience, warning)**
- Lokalizacja: `src/backend/app/groups/application/term_end_scan.py`, `_scan_hand_over_reservations`
- Problem: dla każdej rezerwacji wywoływane są `get_profile_by_account_user_id(giver_user_id)` i `(reserved_by_user_id)`. Oba rzucają `EntityNotFoundException`, gdy konto nie ma `UserProfile`. Jeden taki rekord wycofuje całą transakcję scanu, łącznie ze SWAP-ami wszystkich Terminów, i powtarza się co minutę przez 24h okna. Nowy lookup `giver_user_id` (wcześniej `preference.owner_party_id`) dokłada drugą możliwość awarii. Ryzyko jest niskie, jeśli każde konto ma profil.
- Sugestia: izolować błąd per rezerwacja (`try/except` + `logger.warning` + `continue`) albo przynajmniej zalogować `reservation_id` przy błędzie.

**Z2: Zablokowany RETURN po częściowej awarii bez ścieżki odzyskania w UI (resilience, warning)**
- Lokalizacja: `src/frontend/src/pages/panel/PanelDataContext.tsx`, `returnBorrowedItem`; `src/frontend/src/api/reservations.ts`
- Problem: zwrot to 3 osobne wywołania (create → confirm → fulfill). Jeśli confirm albo fulfill się nie powiedzie, zostaje PENDING RETURN i balance `RESERVED`. Ponowne „Oddaję” dostaje 409 (wymagany status `LENT`). Usunięto `cancelReservation` z API FE, więc użytkownik nie ma jak tego odkręcić. Endpoint `/api/reservations/{id}/cancel` nadal istnieje i poprawnie przywraca `LENT`. Wzorzec 3 wywołań istniał wcześniej. Nowością jest brak funkcji cancel po stronie FE.
- Sugestia: przywrócić `cancelReservation` i wołać go w `catch` po nieudanym confirm/fulfill albo wznawiać confirm/fulfill dla istniejącego PENDING RETURN. Tymczasowo w runbooku: ręczny `POST /api/reservations/{id}/cancel`.

**Z3: Brak logowania decyzji w scanie (monitoring, warning)**
- Lokalizacja: `term_end_scan.py`, `app/main.py::_run_term_end_scan`
- Problem: scan nie loguje, ile Terminów i rezerwacji przetworzył ani ile zdarzeń wyemitował. Po zmianie zakresu (GIFT+LEND z `term_id` zamiast z preferencji listingu) nie da się na produkcji zweryfikować, czy powiadomienia wychodzą.
- Sugestia: jeden `logger.info` na przebieg z licznikami (tylko ID, bez danych osobowych).

**Z4: Porządek walidacji w surowych trasach ujawnia istnienie rezerwacji (security, info/warning)**
- Lokalizacja: `src/backend/app/circulation/router.py`, confirm/cancel/fulfill
- Problem: `get_reservation` (404) i `require_raw_route_reservation_type` (403) wykonują się przed autoryzacją stron. Zalogowany użytkownik EDIT może odróżnić „nie istnieje” od „istnieje, nie-RETURN”. Niewielki wyciek (enumeracja ID). Brak eskalacji uprawnień, bo sprawdzenie strony nadal jest w serwisie.
- Sugestia: akceptowalne przed produkcją. Ewentualnie ujednolicić do 404/403 niezależnie od typu.

**Z5: `DATABASE_URL` dla alembica tylko z env (deployment, warning)**
- Lokalizacja: `src/backend/alembic/env.py`, `alembic.ini` (`sqlalchemy.url =` puste)
- Problem: ręczne `alembic upgrade head` z hosta bez eksportu zmiennej łączy się z pustym URL i kończy błędem. W compose problemu nie ma.
- Sugestia: udokumentować w runbooku wdrożenia (`export DATABASE_URL=...` przed alembikiem) albo wczytywać `app.core.config.settings`.

## Rekomendacje (opcjonalne)

1. **Naprawić bombę czasową w testach FE**: zaszyty `exp` w mock-tokenach (`auth.test.tsx`, `extension-points.test.tsx`, `foundation.test.tsx`) generować dynamicznie (`Date.now()/1000 + 3600`). Bez tego CI jest czerwone niezależnie od tej zmiany.
2. **Guard serwerowy dla trybu listingu na pożyczonej rzeczy**: `set_item_listing_preference` nadal pozwala ustawić tryb na rzeczy z `home_inventory_id != null`. FE blokuje to tylko w UI. Skutek jest nieszkodliwy (take wymaga `AVAILABLE`, a `create_reservation` blokuje rzeczy na wypożyczeniu), ale warto dodać spójny 409.
3. **Ogólnoplatformowe (istniejące wcześniej, poza zakresem)**: error tracking (Sentry), metryki, rate limiting publicznych endpointów, health check z weryfikacją DB. Wymagane przed prawdziwym startem produkcyjnym, ale nie wprowadzone ani pogorszone przez tę zmianę.
4. **`GiveawayTermEndMarker`**: nazwa nie oddaje już zakresu (GIFT+LEND). Docstring to opisuje. Ewentualna zmiana nazwy tabeli to osobna migracja, niepilna.

## Pozytywne ustalenia

- Luki bezpieczeństwa są zamknięte: surowe trasy obsługują tylko RETURN, `reserved_by_user_id` jest wyprowadzany z właściciela, RETURN może rozpocząć tylko aktualny posiadacz, a `term_id` jest brany z rezerwacji, nie od klienta (zamyka wcześniejsze rozwiązanie wymiany przez podanie innego, zakończonego Terminu).
- Autoryzacja w `_resolve_transaction_reservations_for_action` idzie przed 409 (brak wycieku stanu do osób trzecich).
- `fulfill_reservation` ma dodatkowy guard przed podwójnym wypożyczeniem (`home_inventory_id is not None` daje 409).
- `cancel` RETURN przywraca `LENT` z zachowaniem `due_date`.
- Usuwanie pożyczonej rzeczy jest zablokowane serwerowo (balance `!= AVAILABLE` daje 409), a FE dodatkowo blokuje przycisk.
- `list_my_inventory_items`: dodatkowe zapytania tylko dla pożyczonych pozycji (ograniczona pętla, akceptowalna skala).
- Brak nowych zmiennych środowiskowych i sekretów. Nie ma nowych danych wrażliwych w logach (bo nie ma nowych logów).

## Kolejne kroki (priorytet)

1. (przed wdrożeniem) Wdrażać w kolejności: migracja → BE → FE, albo jednym `docker compose up --build`.
2. (zalecane) Z1: izolacja błędów per rezerwacja w scanie.
3. (zalecane) Z2: przywrócić `cancelReservation` i obsłużyć częściową awarię zwrotu.
4. (zalecane) Z3: logowanie liczników scanu.
5. (niezależnie) Naprawić wygasłe mock-tokeny w testach FE.
