# Plan implementacji: Krok 0 wypożyczeń (B7, B6 + B2-lite, B10, B12)

Źródło: `implementation/spec.md`, łącznie z sekcją „Rozstrzygnięcia audytu specyfikacji (2026-09-26)”, która **ma pierwszeństwo** przed wcześniejszą treścią spec. W szczególności:
- trasa `POST /api/reservations/swap` i cały łańcuch `create_swap` są **usuwane** (m-6/m-7), a nie zwracają 403;
- kolejność w `_resolve_transaction_reservations_for_action`: rezerwacja → uczestnik (403) → strażnik RETURN (409) → bramka Terminu (409) → already-resolved → para SWAP (m-9);
- pola FE `lent_*` są **wymagane**, a bramką jakości FE jest też `tsc` + `eslint` (M-2);
- błąd walidacji w tej aplikacji to **400**, nie 422 (m-5).

## Przegląd

| | |
|---|---|
| Grupy zadań | 7 (4 BE, 2 FE, 1 weryfikacja końcowa) |
| Kroki łącznie | 62 |
| Oczekiwane testy | 13 testów bramki TDD (bez zmian) + 26–34 nowych testów (BE 13–17, FE 11–15) + około 40 przepisanych lub zaktualizowanych miejsc w istniejących testach |
| Złożoność | średnio-wysoka: dużo mechanicznych zmian w testach, ryzyko regresji we wspólnych przejściach circulation |

**Bramka TDD:** `src/backend/tests/test_lend_step0_fixes.py` (13 testów) musi przejść **bez modyfikacji**. Każda grupa BE doprowadza do zieleni swoją część tego pliku:
- G1: 2 testy B7,
- G2: 6 testów B6/B2-lite,
- G3: 2 testy B10,
- G4: 3 testy B12.

**Komendy (z katalogów `src/backend` i `src/frontend`):**
- BE, celowo: `uv run pytest -q tests/<plik>.py` (testcontainer postgres:18). Pełny zestaw (około 35 min) uruchamiamy tylko raz, w G7.
- BE, lint: `uv run ruff check <pliki>` i `uv run mypy app`. W repo jest dużo istniejących błędów mypy, więc kryterium brzmi: **brak nowych błędów w zmienionych plikach**.
- FE: `npx vitest run src/test/<plik>`, `npx tsc -b` (lub `npx tsc --noEmit -p tsconfig.app.json`), `npx eslint <pliki>`.

**Ograniczenie architektoniczne (R4):** reguły aktora i typu żyją **wyłącznie** w routerze circulation i w `create_return_reservation`. Wspólne przejścia (`create_reservation`, `confirm_reservation`, `cancel_reservation`, `fulfill_reservation`, `create_lend_reservation`) dostają tylko zmiany R5–R7. Groups sięga do circulation tylko przez `circulation_bridge`.

---

## Kroki implementacji

### Grupa 1: B7 — Termin z rezerwacji w `confirm-transaction` / `cancel-transaction` (backend)
**Dependencies:** None
**Files to Modify:** `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/router/term_item_listings.py`, `src/backend/app/groups/schemas.py`, `src/backend/app/groups/service.py`, `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_term_item_listings_router.py`
**Estimated Steps:** 8

- [x] 1.0 Ukończ warstwę B7 (groups)
  - [x] 1.1 Napisz 3 nowe skupione testy w `tests/test_term_item_listings_router.py` (HTTP) i potwierdź czerwień 2 testów B7 z bramki TDD
    - `test_cancelTransaction_afterReservationTermEnded_returns200AndCancels`: szczęśliwa ścieżka HTTP `POST /api/reservations/{id}/cancel-transaction` bez body (dziś brak testu HTTP)
    - `test_cancelTransaction_reservationTermUpcoming_returns409`: Termin rezerwacji w przyszłości daje 409 „Termin jeszcze się nie odbył”, nawet gdy body zawiera `term_id` minionego Terminu (body ignorowane)
    - `test_cancelTransaction_onReturnReservation_returns409`: RETURN daje 409 (R11)
    - Bramka TDD: `test_confirmTransaction_otherPastTermId_whileOwnTermUpcoming_returns409`, `test_confirmTransaction_onReturnReservation_returns409`
    - Nazewnictwo `action_condition_expectedResult`, dane budowane przez flow groups (wzór: istniejące testy w tym pliku i w `test_lend_step0_fixes.py`)
  - [x] 1.2 Przebuduj `_resolve_transaction_reservations_for_action` w `app/groups/application/term_item_listings.py` (ok. 657–722) według kolejności m-9:
    1. załaduj rezerwację (`circulation_bridge.get_reservation`);
    2. `_require_race_participant` → 403;
    3. `reservation.reservation_type == RETURN` → `BusinessConflictException` 409 („Zwrot nie jest transakcją Terminu”);
    4. `get_term(db, reservation.term_id)` i bramka `occurs_on > datetime.now()` → 409 „Termin jeszcze się nie odbył”;
    5. strażnik already-resolved;
    6. dołączenie pary SWAP.
  - [x] 1.3 Usuń parametr `term_id` z `confirm_transaction`, `cancel_transaction` i `_resolve_transaction_reservations_for_action` (bez shimów). Popraw docstring helpera: usuń nieaktualne zdanie „a bare Reservation carries no Term reference” (R12).
  - [x] 1.4 Router `app/groups/router/term_item_listings.py` (ok. 129–170): usuń parametr `body` z `confirm_transaction` i `cancel_transaction` oraz importy `ConfirmTransactionRequest`/`CancelTransactionRequest`. Trasy nie deklarują modelu body, a wysłane body jest ignorowane.
  - [x] 1.5 `app/groups/schemas.py`: usuń klasy `ConfirmTransactionRequest` i `CancelTransactionRequest` (ok. 632–660) razem z ich docstringami (R10, R12). `ConfirmTransactionResponse` i `CancelTransactionResponse` zostają. Sprawdź `app/groups/service.py`: jeśli re-eksportuje usunięte klasy lub sygnatury, popraw.
  - [x] 1.6 Zaktualizuj istniejące testy: około 21 wywołań `confirm_transaction(...)`/`cancel_transaction(...)` bez `term_id` w `tests/test_term_item_listings.py` oraz około 8 testów HTTP confirm-transaction w `tests/test_term_item_listings_router.py` (ok. 423–593) bez body `{term_id}`. Nie dopisuj pól `lent_*` w `test_term_item_listings_router.py:160,186` (m-1: punkt nieaktualny).
  - [x] 1.7 Lint: `uv run ruff check` na zmienionych plikach; `uv run mypy app` bez nowych błędów w `app/groups/*` dotkniętych plikach.
  - [x] 1.8 Upewnij się, że testy grupy przechodzą
    - `uv run pytest -q tests/test_term_item_listings_router.py tests/test_term_item_listings.py`
    - `uv run pytest -q tests/test_lend_step0_fixes.py -k "confirmTransaction"` (2 testy B7 zielone)
    - Nie uruchamiaj całego zestawu

**Acceptance Criteria:**
- 3 nowe testy oraz 2 testy B7 z bramki TDD przechodzą.
- Termin bramki pochodzi wyłącznie z `reservation.term_id`. Body jest ignorowane, a klasy request nie istnieją.
- RETURN w confirm/cancel-transaction daje 409. Nie-uczestnik dostaje 403 przed jakimkolwiek 409.
- Zaktualizowane testy w `test_term_item_listings*.py` są zielone.

---

### Grupa 2: B6 + B2-lite — surowe trasy tylko dla RETURN, niezmienniki, usunięcie martwego kodu (backend)
**Dependencies:** 1 (wspólny plik `tests/test_term_item_listings.py`)
**Files to Modify:** `src/backend/app/circulation/router.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/domain/reservation_rules.py`, `src/backend/app/circulation/application/reservations.py`, `src/backend/app/circulation/application/reservation_transitions.py`, `src/backend/app/circulation/service.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/tests/test_circulation.py`, `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_pledge_fulfillment.py`
**Estimated Steps:** 12

- [x] 2.0 Ukończ warstwę B6 + B2-lite (circulation)
  - [x] 2.1 Napisz 6 skupionych testów w `tests/test_circulation.py` i potwierdź czerwień 6 testów B6/B2-lite z bramki TDD
    - `test_rawCancelReservation_lendReservation_returns403` (surowe `/cancel` dla LEND, R1)
    - `test_rawFulfillReservation_lendReservation_returns403` (surowe `/fulfill` dla LEND, R1)
    - `test_rawCreateSwap_routeRemoved_returns404or405` (m-6: trasy nie ma)
    - `test_createReservation_giftForItemWithHomeInventory_raisesBusinessConflict` (serwis, R7)
    - `test_fulfillReservation_lendForItemWithHomeInventory_raisesBusinessConflict` (serwis, R7)
    - `test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict` przeniesiony na poziom serwisu (M-1: `create_reservation`/`_resolve_return_term_id`, 409). Odpowiednik HTTP asertuje 403 (rzecz bez `home_inventory_id`).
    - Bramka TDD: `test_rawCreateReservation_strangerLocksOthersAvailableItem_returns403`, `test_rawCreateReturn_forSomeoneElsesLoan_returns403`, `test_rawCreateReturn_reservedByAlwaysHomeOwner_bodyValueIgnored`, `test_rawConfirm_lendBeforeTermEnd_returns403`, `test_rawCancelReturn_restoresLentAndKeepsDueDate`, `test_rawGiftToSelf_afterCancelledReturn_isRejected`
  - [x] 2.2 `app/circulation/domain/reservation_rules.py`: dodaj czystą regułę `require_raw_route_reservation_type(reservation_type)`. Typ ≠ RETURN → `AccessDeniedException` (403, komunikat PL). Wzorzec jak `_require_*`, bez `db`.
  - [x] 2.3 `app/circulation/schemas.py`:
    - dodaj `CreateReturnReservationRequest` z polami `item_id: int`, `notes: str | None` (max 1000), `reservation_type: ReservationType = RETURN`;
    - usuń `CreateSwapRequest` (m-6);
    - wspólny `CreateReservationRequest` zostaje bez zmian.
  - [x] 2.4 `app/circulation/application/reservations.py`: dodaj `create_return_reservation(db, *, item_id, notes, acting_user_id)`:
    - `get_item` → 404;
    - `item.home_inventory_id is None` → 403;
    - `_current_holder_user_id(...) != acting_user_id` → 403;
    - `reserved_by = (await resolve_owning_inventory(db, item)).owner_user_id`;
    - delegacja do `create_reservation` z wewnętrznym `CreateReservationRequest(reservation_type=RETURN, notes=...)`. `term_id` wylicza nadal `_resolve_return_term_id`.
  - [x] 2.5 W tym samym pliku, we wspólnym `create_reservation`:
    - R6: dla RETURN nie nadpisuj `balance.due_date` (ok. 97–99);
    - R7: dla typów ≠ RETURN, gdy `item.home_inventory_id is not None` → `BusinessConflictException` 409;
    - usuń `create_swap` i import `CreateSwapRequest` (m-6).
  - [x] 2.6 `app/circulation/application/reservation_transitions.py`:
    - R5 w `cancel_reservation`: dla RETURN balance → `LENT`, czyszczone tylko `reserved_at` (`due_date` i `lent_at` zostają), pozostałe typy bez zmian;
    - R7 w gałęzi LEND `fulfill_reservation`: `item.home_inventory_id is not None` → 409.
    - Żadnych reguł aktora ani typu (R4).
  - [x] 2.7 `app/circulation/router.py`:
    - `create_reservation`: body `CreateReturnReservationRequest`, `require_raw_route_reservation_type(body.reservation_type)`, aktor z `get_user_id_by_principal`, wywołanie `service.create_return_reservation`;
    - usuń trasę `create_swap` i import `CreateSwapRequest`;
    - `confirm`/`cancel`/`fulfill`: `service.get_reservation` → reguła typu → istniejące wywołanie przejścia z `acting_user_id`;
    - docstring modułu (R8): surowe zapisy tylko RETURN, aktor z principala, 403 dla pozostałych, trasy tymczasowe do MVP (ADR-010).
  - [x] 2.8 `app/circulation/service.py`: dodaj do importów i `__all__` `create_return_reservation` i `require_raw_route_reservation_type`, usuń `create_swap`. `list_items_with_product_name` **zostaje** (używa go `GET /api/inventories/{id}/items`).
    - `app/groups/infrastructure/circulation_bridge.py`: usuń `create_swap` (i import `CreateSwapRequest`, wpis w `__all__`), popraw docstring modułu (wzmianka o `create_swap`) i docstring „the future `confirm_transaction` use case (Group 3)” (m-3). `list_items_with_product_name` w bridge'u usuwa G3, po przepięciu wywołującego.
  - [x] 2.9 Przepisz istniejące testy w `tests/test_circulation.py`:
    - `_lend_and_confirm` (ok. 252) i jego użytkownicy (287, 325, 378, 405, 470, 587, 762, **841**, M-1): tworzenie LEND i przejścia przez funkcje fasady `app.circulation.service` na `db_session` albo przez flow groups. RETURN zostaje na HTTP, bo „Oddaję” dalej ma działać (R3);
    - 434 `test_confirmReservation_byRequester_returns403...`: przenieś na wywołania serwisu (reguła posiadacza we wspólnym przejściu);
    - 516, 542, 577, 615: tworzenie przez serwis zamiast surowego HTTP;
    - `test_createReservation_lendMissingTermId_returns400` (726) → asercja 403 (reguła typu przed walidacją domenową; body poprawne składniowo);
    - `test_createSwap_missingTermId_returns400` (744) i inne testy swap/`CreateSwapRequest`: usuń razem z kodem (m-6);
    - `test_createReservation_returnWithNoPriorLend_returns409` (800) → 403 na HTTP (rzecz niepożyczona). Ścieżkę 409 pokrywa test serwisowy z 2.1;
    - 816 (M-1): HTTP asertuje 403, a 409 pokrywa test serwisowy z 2.1.
  - [x] 2.10 `tests/test_term_item_listings.py`:
    - 1203–1255 (surowy LEND, confirm, fulfill) → flow groups albo serwis;
    - 1941 (m-2): potwierdzenie przez `circulation_bridge.confirm_reservation` jako posiadacz, z zachowaniem intencji (balance `IN_TRANSIT`), bez asercji 403.
    - `tests/test_pledge_fulfillment.py:273`: surowe `/fulfill` → `confirm_transaction` po Terminie (bez `term_id`, po G1).
  - [x] 2.11 Lint: `uv run ruff check` na zmienionych plikach, `uv run mypy app` bez nowych błędów. `grep -rn "create_swap\|CreateSwapRequest" src/backend/app` → brak trafień.
  - [x] 2.12 Upewnij się, że testy grupy przechodzą
    - `uv run pytest -q tests/test_circulation.py tests/test_term_item_listings.py tests/test_pledge_fulfillment.py`
    - `uv run pytest -q tests/test_lend_step0_fixes.py -k "raw"` (6 testów zielonych)
    - Nie uruchamiaj całego zestawu

**Acceptance Criteria:**
- 6 nowych testów oraz 6 testów B6/B2-lite z bramki TDD przechodzą.
- Surowe create/confirm/cancel/fulfill dla typu ≠ RETURN dają 403. `/swap` nie istnieje. RETURN tworzy tylko bieżący posiadacz, a `reserved_by` to właściciel domu.
- Anulowanie RETURN zostawia `LENT` z `due_date`. Utworzenie RETURN nie czyści `due_date`.
- R7: 409 we wspólnym `create_reservation` (typ ≠ RETURN) i w fulfil LEND, gdy `home_inventory_id` jest ustawione.
- Wspólne przejścia nie mają reguł aktora ani typu. Przepisane testy `test_circulation.py`, `test_term_item_listings.py` i `test_pledge_fulfillment.py` są zielone.

---

### Grupa 3: B10 — pożyczone rzeczy w „Moich rzeczach” (backend)
**Dependencies:** 1, 2 (wspólne pliki: `term_item_listings.py`, `schemas.py`, `service.py`, `circulation_bridge.py`)
**Files to Modify:** `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/application/inventory_items.py`, `src/backend/app/circulation/service.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/schemas.py`, `src/backend/tests/test_term_item_listings_router.py`
**Estimated Steps:** 7

- [x] 3.0 Ukończ warstwę B10
  - [x] 3.1 Napisz 2–3 skupione testy w `tests/test_term_item_listings_router.py` i potwierdź czerwień 2 testów B10 z bramki TDD
    - `test_listMyInventoryItems_borrower_doesNotSeeBorrowedItemOfOwner` (pożyczający nie widzi cudzej rzeczy w swoim `/mine`)
    - `test_listMyInventoryItems_softDeletedItem_isExcluded` (`deleted_at IS NULL` w nowym zapytaniu)
    - opcjonalnie `test_listInventoryItems_borrowerVirtualInventory_stillListsBorrowedItem` (regresja istniejącego `GET /api/inventory-items?inventory_id=` / `GET /api/inventories/{id}/items`)
    - Bramka TDD: `test_listMyInventoryItems_lentItem_stillListedForOwnerWithBorrowerAndDueDate`, `test_listMyInventoryItems_notLentItem_hasNullLentFields`
  - [x] 3.2 `app/circulation/infrastructure/repository.py`: nowe zapytanie (np. `list_owned_items_including_lent_with_product_name(db, personal_inventory_id)`):
    - `SELECT item, Product.name` z jawnym joinem (bez `relationship()`);
    - `WHERE deleted_at IS NULL AND ((inventory_id = :p AND home_inventory_id IS NULL) OR home_inventory_id = :p)`, parametryzowane;
    - wzorzec: `list_items_for_inventory_with_product_name`, które zostaje bez zmian.
  - [x] 3.3 Wystaw zapytanie przez `app/circulation/application/inventory_items.py` i `app/circulation/service.py` (`__all__`). W `circulation_bridge.py` dodaj wrapper, a usuń `list_items_with_product_name` (m-7), gdy nie ma już wywołujących.
  - [x] 3.4 `app/groups/schemas.py`: `MyInventoryItemResponse` dostaje pola `lent_to_display_name: str | None = None` i `lent_due_date: datetime | None = None` (R14).
  - [x] 3.5 `list_my_inventory_items` w `app/groups/application/term_item_listings.py` (ok. 137–168):
    - używa nowego zapytania przez bridge;
    - dla każdej rzeczy z `home_inventory_id is not None` pobiera `circulation_bridge.get_item_balance` (`due_date`), `get_inventory(item.inventory_id)` (`owner_user_id`) i `get_profile_by_account_user_id` (`display_name`);
    - dla rzeczy w domu oba pola są `None`.
    - Pętla obejmuje tylko pożyczone rzeczy (precedens `_resolve_item_display_info`). Bez flagi i bez `lent_to_party_id` (YAGNI).
  - [x] 3.6 Lint: `uv run ruff check`, `uv run mypy app` bez nowych błędów. `grep -rn "list_items_with_product_name" src/backend/app/groups` → brak trafień.
  - [x] 3.7 Upewnij się, że testy grupy przechodzą
    - `uv run pytest -q tests/test_term_item_listings_router.py`
    - `uv run pytest -q tests/test_lend_step0_fixes.py -k "listMyInventoryItems"` (2 testy zielone)
    - Nie uruchamiaj całego zestawu

**Acceptance Criteria:**
- 2–3 nowe testy oraz 2 testy B10 z bramki TDD przechodzą.
- `/mine` właściciela zawiera pożyczone rzeczy z `lent_to_display_name` i `lent_due_date`. Rzeczy w domu mają te pola `null`. Pożyczający nie widzi cudzej rzeczy.
- Lista VIRTUAL pożyczającego (istniejące zapytanie) działa bez zmian.

---

### Grupa 4: B12 — skan końca Terminu dla GIFT/LEND, migracja 0040, `reservation_id` w powiadomieniu (backend)
**Dependencies:** 3 (wspólne pliki: `repository.py`, `service.py`, `circulation_bridge.py`)
**Files to Modify:** `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/application/reservations.py`, `src/backend/app/circulation/service.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`, `src/backend/app/groups/application/term_end_scan.py`, `src/backend/app/groups/models.py`, `src/backend/app/notifications/models.py`, `src/backend/app/notifications/service.py`, `src/backend/app/notifications/schemas.py`, `src/backend/app/notifications/outbox_listener.py`, `src/backend/alembic/versions/0040_notification_reservation_id.py`, `src/backend/tests/test_term_end_scan.py`, `src/backend/tests/test_notifications.py`
**Estimated Steps:** 11

- [x] 4.0 Ukończ warstwę B12
  - [x] 4.1 Napisz 3–4 skupione testy i potwierdź czerwień 2 testów B12 z bramki TDD
    - `tests/test_term_end_scan.py`: `test_scan_giftReservationOfOtherTerm_isNotPrompted` (filtr `term_id`: GIFT z przyszłego Terminu nie dostaje monitu)
    - `tests/test_term_end_scan.py`: `test_scan_termWithoutEligibleListersOrPreferences_stillPromptsReservation` (warunek z `term_end_scan.py:176-183` nie blokuje ścieżki rezerwacji)
    - `tests/test_notifications.py`: `test_handleTermEndedGiveaway_payloadWithReservationId_setsReservationIdOnBothNotifications`
    - `tests/test_notifications.py`: `test_listMyNotifications_notificationWithReservationId_returnsReservationId` (`GET /api/notifications/mine`; pośrednio weryfikuje, że migracja 0040 jest na head w conftest)
    - Bramka TDD: `test_scan_pendingLendPastTermEnd_promptsBothPartiesWithReservationId`, `test_scan_confirmedPledgeLend_promptsWithReservationId`, strażnik `test_scan_returnReservation_isNotPrompted`
  - [x] 4.2 Migracja `alembic/versions/0040_notification_reservation_id.py` (wzór 1:1: `0038_notification_join_request_id.py`):
    - `revision="0040"`, `down_revision="0039"`;
    - upgrade: `op.add_column("notifications", sa.Column("reservation_id", sa.BigInteger(), nullable=True))`, bez FK i bez indeksu;
    - downgrade: `op.drop_column("notifications", "reservation_id")`.
  - [x] 4.3 `app/notifications/models.py`: `reservation_id: Mapped[int | None]` (BigInteger, nullable) z komentarzem w stylu `proposal_id` (luźny wskaźnik na `app.circulation.models.Reservation.id`, wypełniany dla `TERM_CONFIRMATION_NEEDED` z GIFT i LEND).
    - `app/notifications/service.py`: `create_notification(..., reservation_id: int | None = None)`.
    - `app/notifications/schemas.py`: `NotificationResponse.reservation_id: int | None`.
  - [x] 4.4 `app/notifications/outbox_listener.py`, `_handle_term_ended_giveaway` (ok. 74–86): przekaż `reservation_id=payload["reservation_id"]` do obu `create_notification` (`TERM_CONFIRMATION_NEEDED`). Copy bez zmian.
  - [x] 4.5 Zapytanie „aktywne rezerwacje dla Terminów” w `app/circulation/infrastructure/repository.py`:
    - `term_id IN (:ids)`, `reservation_type IN (GIFT, LEND)`, `status IN (PENDING, CONFIRMED)`;
    - wzorzec kształtu: `list_active_reservations_for_item`;
    - wystaw przez `application/reservations.py` → `service.__all__` → `circulation_bridge.__all__`.
  - [x] 4.6 `app/groups/application/term_end_scan.py`, `scan_for_term_ended`:
    - ścieżka rezerwacji (nowa lub przebudowana z `_scan_giveaways`, parametr `preferences` znika) to jedno zapytanie przez bridge dla wszystkich Terminów z `_find_terms_just_ended`. Potem odfiltrowanie rezerwacji z istniejącym `GiveawayTermEndMarker`, a dla reszty:
      - `owner_party_id` = profil `giver_user_id`, `taker_party_id` = profil `reserved_by_user_id`;
      - `outbox_service.append(TERM_ENDED_GIVEAWAY, {owner_party_id, taker_party_id, reservation_id, link_path})`;
      - zapis markera;
    - `link_path` per Termin liczony jak dziś;
    - warunek „brak uprawnionych stron / preferencji → pomiń Termin” dotyczy **tylko** ścieżki SWAP (`_scan_swaps` bez zmian);
    - jeden commit na końcu (marker i outbox razem);
    - bez RETURN i bez SWAP w ścieżce rezerwacji.
  - [x] 4.7 Docstringi (R12, R17): docstring modułu `term_end_scan.py` (usuń „Reservation carries no Term”, opisz źródło kandydatów `Reservation.term_id`) oraz docstring `GiveawayTermEndMarker` w `app/groups/models.py` (obejmuje GIFT i LEND; nazwa bez zmian).
  - [x] 4.8 Przejrzyj `tests/test_term_end_scan.py`: scenariusze GIFT muszą mieć `term_id` skanowanego Terminu (nowe źródło kandydatów). Popraw fixture'y bez zmiany oczekiwanych liczników markerów. Jeśli scenariusz zakłada preferencje jako źródło GIFT, dostosuj go do źródła rezerwacji.
  - [x] 4.9 Sprawdź migrację ręcznie w testcontainerze albo lokalnie: `uv run alembic upgrade head`, potem `uv run alembic downgrade -1` i ponownie `upgrade head` (kryterium sukcesu 9).
  - [x] 4.10 Lint: `uv run ruff check`, `uv run mypy app` bez nowych błędów w dotkniętych plikach.
  - [x] 4.11 Upewnij się, że testy grupy przechodzą
    - `uv run pytest -q tests/test_term_end_scan.py tests/test_notifications.py`
    - `uv run pytest -q tests/test_lend_step0_fixes.py` (**13/13** zielonych, cała bramka TDD)
    - Nie uruchamiaj całego zestawu

**Acceptance Criteria:**
- 3–4 nowe testy oraz 3 testy B12 z bramki TDD przechodzą. Cały `test_lend_step0_fixes.py` jest zielony bez modyfikacji.
- Take-LEND PENDING i Pledge-LEND CONFIRMED po Terminie dają dokładnie jedno zdarzenie i dwa powiadomienia z `reservation_id`. Drugi skan nie tworzy nowych zdarzeń.
- GIFT z innego Terminu nie dostaje monitu. RETURN i SWAP nie trafiają do ścieżki rezerwacji. Ścieżka SWAP działa bez zmian.
- Migracja 0040 przechodzi upgrade i downgrade.

---

### Grupa 5: Frontend — kontrakt API, PanelDataContext, modal oczekujących akcji, liczniki Home
**Dependencies:** None technicznie (kontrakt API jest ustalony w spec). Wdrożenie razem z G1–G4.
**Files to Modify:** `src/frontend/src/api/reservations.ts`, `src/frontend/src/api/inventories.ts`, `src/frontend/src/api/notifications.ts`, `src/frontend/src/pages/panel/PanelDataContext.tsx`, `src/frontend/src/pages/panel/views/RzeczyView.tsx`, `src/frontend/src/test/PanelPage.test.tsx`, `src/frontend/src/test/RzeczyViewCategory.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#pending-actions-modal-lend
  element: component:pending-actions-modal-lend
  locator: „Mockup 2: Globalny modal, prompt po Terminie dla LEND / Pledge-LEND” (bottom sheet <520px, wyśrodkowany ≥520px)
  acceptance: tytuł „Potwierdź transakcję”, treść `message` z backendu, przyciski „Potwierdź” / „Później”, `ModalSheet` i klasy bez zmian. Żadnych zmian wizualnych.
- mockup: analysis/design-context/ascii/ui-mockups.md#pending-actions-modal-states
  element: component:pending-actions-modal-lend-states
  locator: sekcja „Przepływ i stany” (diagram od „[Potwierdź] klik”)
  acceptance: gdy `reservationId != null`, wołane jest `confirmTransaction(reservationId)` bez resolvera i bez drugiego argumentu. Gdy `null`, fallback `resolvePendingReservationId(termId, party_id)`. OK → `load({silent})`, dismiss, toast „Potwierdzono”. 409 `already_resolved` albo resolver null → komunikat `role="alert"` „Transakcja została już rozstrzygnięta przez drugą stronę.” z przyciskiem „Rozumiem”. Inny błąd → toast „Nie udało się potwierdzić — spróbuj ponownie”. „Później” / ✕ → `dismissPendingAction`.
- mockup: analysis/design-context/ascii/ui-mockups.md#home-item-counters
  element: component:home-item-counters
  locator: „Mockup 3: HomeView, liczniki trybów” (3 kafle wypożyczyć/oddać/zamienić)
  acceptance: `itemCounts[mode]` liczy także rzeczy z `home_inventory_id != null`. Kod `itemCounts` i wygląd bez zmian. Liczniki nie spadają po pożyczeniu.
**Estimated Steps:** 11

- [x] 5.0 Ukończ warstwę FE: kontrakt i kontekst danych
  - [x] 5.1 Napisz 5–7 skupionych testów w `src/test/PanelPage.test.tsx` (konwencje: `vi.mock` modułów API, `vi.resetAllMocks()` w `beforeEach`, `createQueryWrapper`/`renderWithProviders`)
    - „modal z `reservation_id` (Pledge-LEND) woła `confirmTransaction(reservation_id)` bez wywołań resolvera”
    - „modal bez `reservation_id` używa fallbacku resolvera”
    - „`returnBorrowedItem` wysyła `{item_id, reservation_type: "RETURN"}` bez `reserved_by_user_id`”
    - „`handleDeleteItem` dla pożyczonej rzeczy nie woła `deleteInventoryItem` i nie usuwa jej optymistycznie”
    - „`setItemMode` dla pożyczonej rzeczy nie wywołuje API”
    - „`itemCounts` w HomeView liczy pożyczone rzeczy”
  - [x] 5.2 `src/api/reservations.ts`:
    - `CreateReservationRequest` → `CreateReturnReservationRequest { item_id: number; reservation_type?: "RETURN"; notes?: string | null }` (funkcja `createReservation` przyjmuje nowy typ);
    - usuń `createSwap`, `CreateSwapRequest`, `cancelReservation` (m-6);
    - usuń `ConfirmTransactionRequest` i `CancelTransactionRequest`; `confirmTransaction(reservationId)` i `cancelTransaction(reservationId)` bez argumentu request i bez body;
    - popraw komentarze przy typach transakcji: usuń „Reservation carries no Term” (R12).
  - [x] 5.3 `src/api/inventories.ts`: `MyInventoryItemResponse` dostaje **wymagane** pola `lent_to_display_name: string | null` i `lent_due_date: string | null` (M-2).
  - [x] 5.4 `src/api/notifications.ts`: `NotificationResponse.reservation_id: number | null` (m-5; wymagane, zgodnie z BE).
  - [x] 5.5 `PanelDataContext.tsx`, `returnBorrowedItem` (ok. 1356–1375): payload `{ item_id, reservation_type: "RETURN" }`, bez `reserved_by_user_id`. Usuń guard `lenderUserId == null` z payloadu. Zostaw go tylko, jeśli jest potrzebny do czegoś innego niż payload (sprawdź; w przeciwnym razie usuń również pole `lenderUserId` z mapowania ok. 507, gdy nie ma innych czytelników).
  - [x] 5.6 `PanelDataContext.tsx`, oczekujące akcje:
    - `PendingConfirmAction.reservationId: number | null`, mapowane w `pendingActions` (ok. 683–708) z `n.reservation_id ?? null`;
    - nowa sygnatura `confirmPendingAction(notificationId: number, termId: number | null, reservationId: number | null)` (m-4): gdy `reservationId != null` → od razu `confirmTransaction(reservationId)`, w przeciwnym razie `resolvePendingReservationId(termId, …)`. Wymóg `termId !== null` dotyczy tylko fallbacku;
    - `GlobalPendingActionsModal` (ok. 1540–1582) przekazuje `action.reservationId`.
  - [x] 5.7 `PanelDataContext.tsx`, rzeczy:
    - stan `items` typowany jako `MyInventoryItemResponse[]` (R16);
    - guard „pożyczone” (`item.home_inventory_id != null`) w `handleDeleteItem` i `setItemMode`: wczesny return przed optymistyczną zmianą i przed wywołaniem API (wzór: guard `ACTIVE_LOCK_BALANCE_STATUSES` w `setItemMode`);
    - `itemCounts` (ok. 1048) bez zmian w kodzie.
  - [x] 5.8 `RzeczyView.tsx`, tylko wywołania B7 (m-3): `handleConfirmReceipt` i `handleCancelTransaction` (ok. 140–165) wołają `confirmTransaction(reservationId)` / `cancelTransaction(reservationId)` bez drugiego argumentu i sprawdzają tylko `reservationId` (warunek na `termId` znika). `reservationTermInfo` zostaje, bo zasila `termHasEnded`.
  - [x] 5.9 Fixture'y i istniejące asercje:
    - dopisz `lent_to_display_name: null, lent_due_date: null` wszędzie, gdzie powstaje obiekt `MyInventoryItemResponse` (m.in. `RzeczyViewCategory.test.tsx:131`, `PanelPage.test.tsx:1725`, `:2551`), oraz `reservation_id: null` w fixture'ach `NotificationResponse`;
    - 6 asercji `{ term_id: 9 }` w `PanelPage.test.tsx` (ok. 2184/2234/2312/2399/2457/2614) → `confirmTransaction(reservationId)` bez drugiego argumentu;
    - 2 asercje z `term_id` w `RzeczyViewCategory.test.tsx` → bez drugiego argumentu;
    - usuń mocki `createSwap`/`cancelReservation` z fabryk `vi.mock`, jeśli występują.
  - [x] 5.10 Bramka typów i lint: `npx tsc -b` bez błędów; `npx eslint src/api/reservations.ts src/api/inventories.ts src/api/notifications.ts src/pages/panel/PanelDataContext.tsx src/pages/panel/views/RzeczyView.tsx src/test/PanelPage.test.tsx src/test/RzeczyViewCategory.test.tsx`. `grep -rn "createSwap\|cancelReservation\|reserved_by_user_id\|term_id: termId" src` → brak trafień w kodzie produkcyjnym.
  - [x] 5.11 Upewnij się, że testy grupy przechodzą
    - `npx vitest run src/test/PanelPage.test.tsx src/test/RzeczyViewCategory.test.tsx`
    - Nie uruchamiaj całego zestawu

**Acceptance Criteria:**
- 5–7 nowych testów przechodzi, a zaktualizowane asercje w `PanelPage.test.tsx` i `RzeczyViewCategory.test.tsx` są zielone.
- `tsc -b` jest czysty, a `eslint` nie zgłasza nowych błędów w zmienionych plikach.
- „Oddaję” wysyła payload bez `reserved_by_user_id`. `confirm`/`cancelTransaction` nie wysyłają body.
- Modal potwierdza przez `reservation_id`, gdy jest obecne, a w przeciwnym razie przez fallback. Copy i wygląd bez zmian.
- Guardy „pożyczone” blokują usuwanie i zmianę trybu bez wywołań API. Liczniki Home liczą pożyczone rzeczy.
- Wszystkie kryteria `acceptance` z Visual References powyżej są spełnione.

---

### Grupa 6: Frontend — kafel pożyczonej rzeczy w RzeczyView
**Dependencies:** 5 (typ `MyInventoryItemResponse` z `lent_*`, wspólne pliki `RzeczyView.tsx` i `RzeczyViewCategory.test.tsx`)
**Files to Modify:** `src/frontend/src/pages/panel/views/RzeczyView.tsx`, `src/frontend/src/test/RzeczyViewCategory.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md#rzeczy-view
  element: screen:rzeczy-view
  locator: „Mockup 1: Moje rzeczy, trzy kafle obok siebie (mobile, ok. 375px)” (kafle A, B, C i nagłówek z licznikiem)
  acceptance: kafle A (zwykły) i B (zablokowany) bez zmian. Licznik nagłówka „{n} rzecz/rzeczy” (`items.length`) obejmuje pożyczone. Układ mobile-first bez poziomego przewijania przy ok. 375px.
- mockup: analysis/design-context/ascii/ui-mockups.md#rzeczy-view
  element: component:rzeczy-item-tile-lent
  locator: kafel „C) POŻYCZONA (NEW stan kafla)” i lista „Punkty integracji” pod `#lent-badge`
  acceptance: `const lent = it.home_inventory_id != null` obok `locked`. Przyciski trybu mają `disabled={locked || lent}` i `aria-disabled={locked || lent}`, a wybrany tryb jest nadal podświetlony (`ITEM_MODE_STYLE`). Kosz ma `disabled={lent}` + `aria-disabled` + `disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent` i zachowuje `aria-label="Usuń rzecz {nazwa}"`. Przyciski trybu i kosz mają `aria-describedby="lent-badge-{itemId}"`. Edycja nazwy, kategorii i stanu jest aktywna. Brak „Odebrał” i „Anuluj wymianę”.
- mockup: analysis/design-context/ascii/ui-mockups.md#lent-badge
  element: component:rzeczy-lent-badge
  locator: „Badge pożyczenia, warianty” (slot `lockBadgeLabel`, `RzeczyView.tsx` ok. 334–349)
  acceptance: `<span role="status" id="lent-badge-{itemId}">` z klasami identycznymi jak badge `lockBadgeLabel` i kropką `aria-hidden="true"`. Tekst „Pożyczone: {lent_to_display_name}, do DD.MM.YYYY” (data przez `dayjs` z `src/utils/dayjs.ts`, format `DD.MM.YYYY`), a gdy `lent_due_date == null`, samo „Pożyczone: {imię}”. Badge **zastępuje** `lockBadgeLabel` (jeden badge), zawija się w `flex flex-wrap gap-1.5`, bez obcinania imienia.
- mockup: analysis/design-context/ascii/ui-mockups.md#lent-tile-return-pending
  element: component:rzeczy-item-tile-lent-return-pending
  locator: „Kafel C przy oczekującym RETURN pożyczającego”
  acceptance: przy balance `RESERVED` i `lent` widoczny jest tylko badge pożyczenia (bez „czeka na potwierdzenie”). Warunek akcji po Terminie to `locked && !lent && termHasEnded(it.id)`, więc „Odebrał” i „Anuluj wymianę” są ukryte. Tryby i kosz są zablokowane.
**Estimated Steps:** 7

- [x] 6.0 Ukończ kafel pożyczonej rzeczy
  - [x] 6.1 Napisz 5–6 skupionych testów w `src/test/RzeczyViewCategory.test.tsx` (fixture z `home_inventory_id` ustawionym)
    - „pożyczona rzecz z datą pokazuje badge `role="status"` »Pożyczone: Ania, do 12.10.2026«”
    - „pożyczona rzecz bez `lent_due_date` pokazuje »Pożyczone: Ania«”
    - „przyciski trybu i kosz są `disabled` z `aria-describedby` wskazującym `id` badge'a, a kosz zachowuje `aria-label`”
    - „pożyczona rzecz z balance `RESERVED` i minionym Terminem nie pokazuje »Odebrał« ani »Anuluj wymianę« i ma jeden badge”
    - „edycja nazwy pożyczonej rzeczy jest dostępna”
    - opcjonalnie: „licznik nagłówka obejmuje pożyczoną rzecz”
  - [x] 6.2 `RzeczyView.tsx` (ok. 199–201): `const lent = it.home_inventory_id != null` obok `locked` i `const lentBadgeId = \`lent-badge-${it.id}\``.
  - [x] 6.3 Przyciski trybu (ok. 325–326): `disabled={locked || lent}`, `aria-disabled={locked || lent}`, `aria-describedby={lent ? lentBadgeId : undefined}`. Wybrany tryb nadal ma `aria-pressed` i styl `ITEM_MODE_STYLE`.
  - [x] 6.4 Slot badge'a (ok. 334–349): gdy `lent`, renderuj pigułkę pożyczenia (te same klasy co `lockBadgeLabel`, kropka `aria-hidden`, `role="status"`, `id={lentBadgeId}`) **zamiast** `lockBadgeLabel`. Datę formatuj przez `dayjs` z `../../../utils/dayjs` (nie importuj `"dayjs"` ani `utils/format.ts`).
  - [x] 6.5 Warunek akcji po Terminie (ok. 350): `locked && !lent && termHasEnded(it.id)`. Kosz (ok. 375–381): `disabled={lent}`, `aria-disabled={lent}`, `aria-describedby={lent ? lentBadgeId : undefined}` i klasy `disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent`. `aria-label` bez zmian. Edycja meta bez zmian.
  - [x] 6.6 Bramka typów i lint: `npx tsc -b`, `npx eslint src/pages/panel/views/RzeczyView.tsx src/test/RzeczyViewCategory.test.tsx`.
  - [x] 6.7 Upewnij się, że testy grupy przechodzą
    - `npx vitest run src/test/RzeczyViewCategory.test.tsx`
    - Nie uruchamiaj całego zestawu

**Acceptance Criteria:**
- 5–6 nowych testów przechodzi.
- Pożyczona rzecz ma jeden badge `role="status"` z imieniem i opcjonalną datą `DD.MM.YYYY`. Tryby i kosz są zablokowane z `aria-disabled` i `aria-describedby`. Edycja meta działa. Akcje po Terminie są ukryte, także przy oczekującym RETURN.
- Bez nowych kolorów, tokenów ani komponentów. Reuse klas pigułki i mechanizmu `disabled`.
- Wszystkie kryteria `acceptance` z Visual References powyżej są spełnione.

---

### Grupa 7: Przegląd testów i weryfikacja końcowa
**Dependencies:** 1, 2, 3, 4, 5, 6
**Files to Modify:** `src/backend/tests/**/*.py`, `src/frontend/src/test/*.test.tsx` (tylko gdy trzeba dopisać brakujący test albo naprawić regresję wykrytą przez pełny zestaw)
**Estimated Steps:** 6

- [x] 7.0 Przejrzyj testy i przeprowadź bramki jakości
  - [x] 7.1 Przejrzyj testy z grup 1–6 (około 26–34 nowych + 13 z bramki TDD) pod kątem wymagań R1–R19 i Success Criteria 1–9. Wypisz luki dotyczące **tylko** tej funkcji (np. `lent_due_date` z właściwą wartością, idempotencja drugiego skanu dla Pledge-LEND, `cancel-transaction` nie-uczestnik → 403 przed 409).
  - [x] 7.2 Dopisz maksymalnie 10 strategicznych testów zamykających luki z 7.1 (BE w odpowiednim pliku `tests/`, FE w `src/test/`).
  - [x] 7.3 Pełny zestaw BE: `uv run pytest` w `src/backend` (około 35 min, uruchom w tle). Oczekiwany wynik: zielony, a `tests/test_lend_step0_fixes.py` 13/13 bez modyfikacji (`git diff --stat src/backend/tests/test_lend_step0_fixes.py` pusty). Regresje we wspólnych przejściach (take, propose, accept, Pledge) napraw zgodnie z R4, bez dodawania reguł do wspólnych funkcji.
  - [x] 7.4 Pełny zestaw FE: `npx vitest run` w `src/frontend`. Do tego `npx tsc -b` i `npx eslint` na wszystkich zmienionych plikach FE.
  - [x] 7.5 Lint BE: `uv run ruff check` na wszystkich zmienionych plikach i `uv run mypy app`, bez **nowych** błędów względem stanu sprzed zmian w dotkniętych plikach. `grep` kontrolny: brak `create_swap`, `CreateSwapRequest`, `ConfirmTransactionRequest`, `CancelTransactionRequest` w `src/backend/app` i `src/frontend/src`; brak `circulation_bridge.list_items_with_product_name`.
  - [~] 7.6 SKIPPED: zweryfikowane w 4.9 (upgrade/downgrade/upgrade na postgres:18), bez zmian od tego czasu — Migracja: `uv run alembic upgrade head` → `downgrade -1` → `upgrade head` przechodzi (jeśli nie sprawdzono w 4.9 na tej samej bazie).

**Acceptance Criteria:**
- Pełne `uv run pytest` i `npx vitest run` są zielone. `tsc -b` jest czysty, a `eslint`/`ruff` bez nowych błędów w zmienionych plikach. `mypy` bez nowych błędów w dotkniętych plikach.
- `test_lend_step0_fixes.py` 13/13 bez modyfikacji asercji.
- Dopisano co najwyżej 10 dodatkowych testów.
- Success Criteria 1–9 ze spec są spełnione.

---

## Kolejność wykonania

1. Grupa 1: B7 backend (8 kroków)
2. Grupa 2: B6 + B2-lite backend (12 kroków, zależy od 1)
3. Grupa 3: B10 backend (7 kroków, zależy od 1, 2)
4. Grupa 4: B12 backend (11 kroków, zależy od 3)
5. Grupa 5: FE kontrakt + PanelDataContext + modal + liczniki (11 kroków, bez zależności technicznych; może iść równolegle z 1–4)
6. Grupa 6: FE kafel pożyczonej rzeczy w RzeczyView (7 kroków, zależy od 5)
7. Grupa 7: Przegląd testów i weryfikacja końcowa (6 kroków, zależy od 1–6)

Łańcuch BE jest szeregowy, bo grupy dzielą pliki: `test_term_item_listings.py`, `circulation/service.py`, `circulation_bridge.py`, `repository.py` i `groups/schemas.py`. Łańcuch FE (5 → 6) może iść równolegle z BE. Wdrożenie FE i BE ma nastąpić razem (payload „Oddaję”, brak body B7).

## Zgodność ze standardami

Standardy z `.maister/docs/standards/`:
- `global/`: `error-handling.md` (typowane 403/409, komunikaty PL), `minimal-implementation.md` (bez shimów `term_id`, bez nowego zdarzenia i markera, bez `lent_to_party_id`, bez nowego komponentu FE, usunięcie martwego kodu swap), `commenting.md` (poprawione nieaktualne docstringi, bez komentarzy typu changelog), `coding-style.md`, `validation.md` (400 dla walidacji).
- `backend/`: `security.md` (aktor z principala, `AccessDeniedException`, macierz autoryzacji bez zmian), `models.md` (luźny wskaźnik `reservation_id` bez FK, groups → circulation tylko przez bridge), `migrations.md` (mała, odwracalna 0040, `down_revision="0039"`), `queries.md` (parametryzowane zapytania, jedno zapytanie po `term_id IN (...)`, ograniczona pętla tylko po pożyczonych rzeczach), `api.md`.
- `frontend/`: `accessibility.md` (`role="status"`, tekst zamiast koloru, `disabled` + `aria-disabled` + `aria-describedby`), `data-fetching.md` (daty tylko przez `src/utils/dayjs.ts`), `css.md` (reuse klas Tailwind, bez nowych tokenów), `components.md`, `responsive.md` (mobile-first, `flex-wrap`).
- `testing/`: `backend-testing.md` (testy integracyjne z testcontainer, nazwy `action_condition_expectedResult`, 2–8 testów na grupę), `frontend-testing.md` (`vi.mock`, `vi.resetAllMocks()`, `createQueryWrapper`/`renderWithProviders`, pliki w `src/test/`).

## Uwagi

- **Test-driven:** każda grupa zaczyna od 2–8 testów i od potwierdzenia czerwieni odpowiednich testów z bramki TDD.
- **Uruchamianie przyrostowe:** po każdej grupie uruchamiamy tylko pliki testów tej grupy. Pełny `uv run pytest` (około 35 min) tylko w G7.
- **Bramka TDD jest nietykalna:** `test_lend_step0_fixes.py` nie może być modyfikowany.
- **R4 jest krytyczne:** reguły aktora i typu tylko w routerze circulation i w `create_return_reservation`. Jeśli pełny zestaw pokaże regresje w take, propose, accept lub Pledge, przyczyną jest prawie na pewno naruszenie R4.
- **Dane dev (m-8):** lokalna baza może mieć wiersze „AVAILABLE + `home_inventory_id`” po starym B2. Po R7 dostaną 409. To pre-prod: dopuszczalne ręczne czyszczenie, bez shimów.
- **Świadome pominięcia:** brak indeksów na `reservations.term_id` i `inventory_items.home_inventory_id` (m-11). Brak obsługi brakującego profilu w skanie (m-10). Brak synchronizacji statusu Pledge (R20).
- **Reuse:** `get_user_id_by_principal`, `resolve_owning_inventory`, `_current_holder_user_id`, wspólne `create_reservation`, wzorzec `_require_*`, `list_items_for_inventory_with_product_name` jako wzór zapytania, `GiveawayTermEndMarker`, `TERM_ENDED_GIVEAWAY`, migracja 0038 jako wzór, pigułka `lockBadgeLabel`, `ModalSheet`, `resolvePendingReservationId` jako fallback.
- **Postęp:** odhaczaj kroki w tym pliku, bo to źródło prawdy przy wznowieniu.
