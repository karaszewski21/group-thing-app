# Specyfikacja: Krok 0 wypożyczeń (B6 + B2-lite, B7, B10, B12)

## Cel
Zamknąć luki bezpieczeństwa i widoczności w cyklu wypożyczeń przed MVP encji `Loan` (ADR-008). Chodzi o cztery rzeczy:
- surowe trasy `/api/reservations*` są zabezpieczone i dopuszczają tylko RETURN (ADR-010);
- Termin transakcji zawsze pochodzi z rezerwacji;
- właściciel widzi swoje pożyczone rzeczy;
- po Terminie obie strony LEND i Pledge-LEND dostają monit, który da się obsłużyć.

## Zakres

**W zakresie:**
- B6 z B2-lite: circulation, surowe trasy i niezmienniki.
- B7: groups, `confirm-transaction` i `cancel-transaction`.
- B10: groups i FE, „Moje rzeczy”.
- B12: groups, notifications i FE, skan końca Terminu, migracja 0040 i modal oczekujących akcji.

**Poza zakresem:** patrz sekcja „Out of Scope”.

## User Stories
- Jako **właściciel** chcę, żeby nikt obcy nie mógł zablokować, przejąć ani „zwrócić” mojej rzeczy przez surowe API.
- Jako **właściciel** chcę widzieć pożyczoną rzecz w „Moich rzeczach” z informacją, komu i do kiedy ją pożyczyłem.
- Jako **pożyczający** chcę dalej oddawać rzecz przyciskiem „Oddaję”, tak jak dotąd.
- Jako **strona transakcji** (właściciel, biorący, organizator lub deklarujący w Pledge-LEND) chcę po Terminie dostać monit „Potwierdź transakcję”, który faktycznie działa.
- Jako **uczestnik** chcę, żeby potwierdzenia nie dało się odblokować cudzym, już minionym Terminem.

---

## Core Requirements

Numeracja wymagań R1–R20 odpowiada `analysis/requirements.md`.

### B6 + B2-lite: surowe trasy circulation

**R1. Jedna reguła dla surowych zapisów: tylko RETURN.** Dotyczy tras:
- `POST /api/reservations`,
- `POST /api/reservations/swap`,
- `POST /api/reservations/{id}/confirm`,
- `POST /api/reservations/{id}/cancel`,
- `POST /api/reservations/{id}/fulfill`.

Każdy typ inny niż RETURN dostaje **403** (`AccessDeniedException`), również przy confirm, cancel i fulfill istniejącej rezerwacji LEND, GIFT lub SWAP. `POST /api/reservations/swap` zawsze zwraca 403, niezależnie od body.

**R2. `POST /api/reservations` przyjmuje `CreateReturnReservationRequest`.** To schemat tylko dla routera (patrz „Kontrakt API”).
- Aktor to principal (`get_user_id_by_principal`).
- Rzecz musi być pożyczona, czyli `home_inventory_id IS NOT NULL`. W przeciwnym razie 403.
- Aktor musi być bieżącym posiadaczem, czyli właścicielem inventory VIRTUAL wskazanego przez `item.inventory_id`. W przeciwnym razie 403.
- `reserved_by_user_id` wylicza serwer: `owner_user_id` z `resolve_owning_inventory(item)`, czyli właściciel domu.
- Pola nadmiarowe w body są ignorowane (`reserved_by_user_id`, `term_id`, `expires_at`). Pydantic ma domyślnie `extra=ignore`.
- `term_id` RETURN nadal wylicza `_resolve_return_term_id`, bez zmian.

**R3. RETURN confirm i fulfill działają jak dziś.** Confirm robi posiadacz (`_require_holder_to_confirm`), fulfill robi strona (`_require_party_to_reservation`). Sekwencja „Oddaję” (create → confirm → fulfill jako pożyczający) dalej przechodzi.

**R4. Reguły z R1 i R2 obowiązują wyłącznie na surowych trasach.** Wywołuje je router, przez fasadę `service`. Wspólne przejścia (`confirm_reservation`, `cancel_reservation`, `fulfill_reservation`, `create_reservation`, `create_lend_reservation`) woła też groups przez `circulation_bridge`, z `acting_user_id` = fizyczny posiadacz. Te funkcje **nie dostają reguł aktora ani typu**. Jedyne dopuszczalne zmiany w nich to R5–R7.

**R5. Anulowanie RETURN (B2-lite).** W `cancel_reservation`, gdy `reservation_type == RETURN`:
- balance → `LENT`,
- czyszczone jest tylko `reserved_at`,
- `due_date` i `lent_at` zostają.

Pozostałe typy zachowują się jak dotąd (→ `AVAILABLE`, czyszczone `reserved_at` i `due_date`).

**R6. `create_reservation` nie nadpisuje `balance.due_date` dla RETURN.** Dla pozostałych typów bez zmian (`due_date = expires_at`).

**R7. Strażnik niezmiennika `home_inventory_id IS NULL` (409, `BusinessConflictException`):**
- we wspólnym `create_reservation` dla typów innych niż RETURN, gdy `item.home_inventory_id` nie jest NULL;
- w gałęzi LEND `fulfill_reservation`, gdy `item.home_inventory_id` nie jest NULL. Zamyka to pod-pożyczanie, czyli nadpisanie domu rzeczy.

Żaden legalny wywołujący z groups nie narusza tego niezmiennika.

**R8. Docstring modułu `app/circulation/router.py`** ma opisywać faktyczny stan:
- surowe zapisy tylko dla RETURN, aktor z principala, 403 dla pozostałych;
- trasy są tymczasowe do MVP (ADR-010).

### B7: Termin z rezerwacji

**R9. `_resolve_transaction_reservations_for_action`** najpierw ładuje rezerwację, potem `get_term(db, reservation.term_id)`. Bramka `occurs_on > datetime.now()` → 409 „Termin jeszcze się nie odbył” dotyczy Terminu rezerwacji. Kolejność kroków:
1. załadowanie rezerwacji;
2. strażnik RETURN (R11);
3. bramka Terminu;
4. `_require_race_participant`;
5. strażnik already-resolved;
6. dołączenie pary SWAP.

**R10. `term_id` znika całkowicie, bez shimów:**
- klasy `ConfirmTransactionRequest` i `CancelTransactionRequest` są usunięte;
- trasy nie przyjmują body, a wysłane body jest ignorowane;
- parametr `term_id` znika z `confirm_transaction`, `cancel_transaction` i `_resolve_transaction_reservations_for_action`;
- FE: typy `ConfirmTransactionRequest`/`CancelTransactionRequest` są usunięte, a `confirmTransaction(reservationId)` i `cancelTransaction(reservationId)` nie mają argumentu request;
- wywołania w `RzeczyView` (`handleConfirmReceipt`, `handleCancelTransaction`) i w `PanelDataContext.confirmPendingAction` są odpowiednio poprawione.

**R11. Rezerwacja RETURN w `_resolve_transaction_reservations_for_action` → 409** (`BusinessConflictException`, np. „Zwrot nie jest transakcją Terminu”). W efekcie `confirm-transaction` i `cancel-transaction` nie domykają ani nie anulują RETURN.

**R12. Nieaktualne docstringi „a bare Reservation carries no Term reference”** trzeba poprawić w 5 miejscach:
- `_resolve_transaction_reservations_for_action`,
- `ConfirmTransactionRequest` (usuwany),
- `CancelTransactionRequest` (usuwany),
- `src/frontend/src/api/reservations.ts` (komentarze przy typach transakcji),
- docstring modułu `term_end_scan.py`.

### B10: „Moje rzeczy” właściciela

**R13. `GET /api/inventory-items/mine`** zwraca rzeczy, których domem jest PERSONAL wołającego:
- `inventory_id = PERSONAL AND home_inventory_id IS NULL` (w domu), albo
- `home_inventory_id = PERSONAL` (pożyczone),
- zawsze z `deleted_at IS NULL`.

Wymaga to nowego zapytania w repozytorium circulation. Istniejące `list_items_for_inventory_with_product_name` zostaje bez zmian, bo obsługuje `GET /api/inventories/{id}/items`, w tym listę VIRTUAL pożyczającego. Pożyczający nie widzi cudzej rzeczy w swoim `/mine`.

**R14. `MyInventoryItemResponse` dostaje dwa pola:**
- `lent_to_display_name: str | None`: `display_name` profilu (`get_profile_by_account_user_id`) właściciela inventory VIRTUAL (`item.inventory_id`), tylko dla rzeczy pożyczonych;
- `lent_due_date: datetime | None`: `InventoryBalance.due_date`, tylko dla rzeczy pożyczonych.

Dla rzeczy w domu oba pola to `null`. O tym, czy rzecz jest pożyczona, decyduje `home_inventory_id != null`. Nie ma osobnej flagi ani `lent_to_party_id` (YAGNI).

**R15. FE RzeczyView dla `home_inventory_id != null`:**
- badge „Pożyczone: {imię}, do DD.MM.YYYY”, a bez daty samo „Pożyczone: {imię}”:
  - `role="status"`, data przez `dayjs` z `src/utils/dayjs.ts`,
  - **zastępuje** badge blokady (`lockBadgeLabel`), więc jest jeden badge;
- przyciski trybu i kosz: `disabled` + `aria-disabled` + `aria-describedby` wskazujące `id` badge'a;
- edycja nazwy, kategorii i stanu dozwolona;
- „Odebrał” i „Anuluj wymianę” ukryte, również przy oczekującym RETURN (balance `RESERVED`).

**R16. FE PanelDataContext:**
- guard „pożyczone” w `handleDeleteItem` i `setItemMode`: wczesny return, bez optymistycznego usunięcia i bez wywołań API;
- stan `items` typowany jako `MyInventoryItemResponse[]`, żeby RzeczyView miał dostęp do pól `lent_*`;
- `itemCounts` liczy także pożyczone rzeczy. Kod się nie zmienia, zmienia się tylko zawartość `items`.

### B12: monit po Terminie dla LEND i Pledge-LEND

**R17. `term_end_scan` wybiera kandydatów z `Reservation.term_id`:**
- zakres: Terminy z okna `_find_terms_just_ended`;
- typy GIFT i LEND, statusy PENDING i CONFIRMED;
- **bez** RETURN i **bez** SWAP;
- źródłem nie są preferencje (`ItemListingPreference`);
- zakres obejmuje Take-LEND (PENDING), Pledge-LEND (CONFIRMED) i GIFT, więc przy okazji znika brak filtra `term_id` dla GIFT.

Strony:
- `owner_party_id` = profil `giver_user_id`,
- `taker_party_id` = profil `reserved_by_user_id`.

Idempotencja: reużyty `GiveawayTermEndMarker`, bez zmiany nazwy, z poprawionym docstringiem. Zdarzenie: reużyte `TERM_ENDED_GIVEAWAY` z niezmienionym kształtem payloadu. Marker i outbox zostają zapisane w tym samym jednym commicie. Ścieżka SWAP (`_scan_swaps`, oparta na preferencjach i `SwapProposal`) zostaje bez zmian. Ścieżka rezerwacji ma działać także wtedy, gdy Termin nie ma uprawnionych listerów ani preferencji.

**R18. Migracja `0040_notification_reservation_id`:**
- `notifications.reservation_id BIGINT NULL`, luźny wskaźnik bez FK, wzorem `proposal_id` i `join_request_id`;
- nowe pole w modelu `Notification`, w `create_notification(..., reservation_id=None)` i w `NotificationResponse`;
- `_handle_term_ended_giveaway` ustawia `reservation_id = payload["reservation_id"]` w obu powiadomieniach `TERM_CONFIRMATION_NEEDED`.

**R19. FE:**
- `Notification.reservation_id?: number | null`;
- `PendingConfirmAction.reservationId: number | null`, mapowane z `n.reservation_id ?? null`;
- `confirmPendingAction`: gdy `reservationId` jest obecne, woła od razu `confirmTransaction(reservationId)`, bez resolvera. W przeciwnym razie stary `resolvePendingReservationId(termId, party_id)` (SWAP i stare powiadomienia);
- wymóg `termId !== null` dotyczy tylko ścieżki fallback.

**R20. Synchronizacja statusu Pledge jest poza zakresem.**

---

## Kontrakt API (zmiany)

| Endpoint | Request | Odpowiedzi |
|---|---|---|
| `POST /api/reservations` | `CreateReturnReservationRequest` | 201 `ReservationResponse` (bez zmian); 403: typ ≠ RETURN, rzecz niepożyczona, aktor nie jest posiadaczem; 404 brak rzeczy; 409 balance ≠ LENT albo brak FULFILLED LEND (istniejące); 400 błąd walidacji |
| `POST /api/reservations/swap` | body nieużywane (router nie deklaruje modelu) | zawsze 403 |
| `POST /api/reservations/{id}/confirm` | bez body | 403 dla typu ≠ RETURN (przed istniejącymi sprawdzeniami); dla RETURN bez zmian |
| `POST /api/reservations/{id}/cancel` | bez body | 403 dla typu ≠ RETURN; RETURN → 200, balance `LENT` (R5) |
| `POST /api/reservations/{id}/fulfill` | bez body | 403 dla typu ≠ RETURN; RETURN bez zmian |
| `POST /api/reservations/{id}/confirm-transaction` | **bez body** (dawne `{term_id}` usunięte, wysłane body jest ignorowane) | 200 jak dziś; 409 „Termin jeszcze się nie odbył” wg `reservation.term_id`; **409 dla RETURN**; 409 `already_resolved=true`; 403 nie-uczestnik |
| `POST /api/reservations/{id}/cancel-transaction` | **bez body** | jak wyżej |
| `GET /api/inventory-items/mine` | — | `MyInventoryItemResponse[]` z nowymi polami `lent_to_display_name`, `lent_due_date`; zawiera rzeczy pożyczone |
| `GET /api/notifications` (istniejący) | — | `NotificationResponse.reservation_id: int \| null` |

**`CreateReturnReservationRequest`** (nowy, w `app/circulation/schemas.py`, używany tylko przez router):
- `item_id: int` (wymagane);
- `notes: str | None` (max 1000, jak w `CreateReservationRequest`);
- `reservation_type: ReservationType`, domyślnie `RETURN`. Pole służy tylko do odrzucenia: każda inna wartość daje 403 w routerze, a nie 422. Bez tego pola żądanie „GIFT do siebie” zostałoby po cichu potraktowane jak RETURN i dostałoby 201 (patrz test `test_rawGiftToSelf_afterCancelledReturn_isRejected`).

Wspólny `CreateReservationRequest` (używany przez bridge i Pledge) oraz `CreateSwapRequest` (używany przez `service.create_swap`) **zostają bez zmian**.

**Macierz autoryzacji** (`app/core/authorization_matrix.py`): bez zmian.

## Model danych i migracja 0040
- Plik `src/backend/alembic/versions/0040_notification_reservation_id.py`: `revision="0040"`, `down_revision="0039"`.
- Upgrade: `add_column("notifications", reservation_id BigInteger nullable)`. Bez FK i bez indeksu, bo kolumna nie jest filtrowana (jak 0038).
- Downgrade: `drop_column`. Nie ma nowych wartości enum, więc nie trzeba usuwać wierszy.
- Model `Notification`: `reservation_id: Mapped[int | None]` (BigInteger, nullable) z komentarzem w stylu `proposal_id`: luźny wskaźnik na `app.circulation.models.Reservation.id`, wypełniany dla `TERM_CONFIRMATION_NEEDED` z GIFT i LEND.
- Pozostałe tabele bez zmian. `GiveawayTermEndMarker` jest reużyty, bez migracji.
- Zmiany semantyki danych (bez migracji): anulowanie RETURN zostawia `LENT` z `due_date`; utworzenie RETURN nie czyści `due_date`.

---

## Visual Design

Mockupy w `analysis/design-context/` są wiążące. Implementation-planner dołączy `Visual References` do grup zadań UI. Poziom wierności: **przybliżony (ASCII)**. Obowiązuje reuse istniejących klas i wzorców, bez nowych tokenów ani kolorów.

| ID | Mockup | Kluczowe elementy |
|---|---|---|
| `screen:rzeczy-view` | `ascii/ui-mockups.md#rzeczy-view` | „Moje rzeczy”, kafle zwykły, zablokowany i pożyczony; mobile-first (ok. 375px); licznik nagłówka obejmuje pożyczone |
| `component:rzeczy-item-tile-lent` | `#rzeczy-view` (kafel C) | tryby `disabled` (wybrany tryb nadal podświetlony), kosz `disabled` (`disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent`), edycja meta aktywna, bez „Odebrał” i „Anuluj wymianę” |
| `component:rzeczy-lent-badge` | `#lent-badge` | pigułka w slocie `lockBadgeLabel` (`RzeczyView.tsx` ok. 334–349), identyczne klasy, kropka `aria-hidden`, `role="status"`; warianty z datą i bez daty; zawijanie w `flex-wrap` |
| `component:rzeczy-item-tile-lent-return-pending` | `#lent-tile-return-pending` | balance `RESERVED` przy pożyczonej rzeczy: jeden badge pożyczenia (pierwszeństwo nad „czeka na potwierdzenie”), akcje po Terminie ukryte |
| `component:pending-actions-modal-lend` | `#pending-actions-modal-lend` | `GlobalPendingActionsModal` + `ModalSheet`; copy i wygląd bez zmian |
| `component:pending-actions-modal-lend-states` | `#pending-actions-modal-states` | najpierw `reservation_id`, potem fallback do resolvera; stany OK (toast „Potwierdzono”), already-resolved (`role="alert"`), błąd (toast) |
| `component:home-item-counters` | `#home-item-counters` | `itemCounts` w HomeView liczy pożyczone; wygląd bez zmian |

Dodatki przyjęte przez użytkownika:
- `aria-describedby` na zablokowanych przyciskach trybu i koszu, wskazujące na `id` badge'a (np. `lent-badge-{itemId}`);
- zablokowany kosz zachowuje `aria-label="Usuń rzecz {nazwa}"`.

---

## Reusable Components

### Istniejący kod do wykorzystania

| Element | Plik | Jak użyć |
|---|---|---|
| `get_user_id_by_principal` | `app/circulation/application/identity.py` | aktor na surowych trasach |
| `resolve_owning_inventory` | `app/circulation/application/inventory_items.py` | `reserved_by` dla RETURN (właściciel domu) |
| `_current_holder_user_id` | `app/circulation/application/reservations.py` | sprawdzenie „aktor = posiadacz” |
| `create_reservation` (wspólny) + `CreateReservationRequest` | `app/circulation/application/reservations.py`, `schemas.py` | nowy przypadek użycia RETURN buduje wewnętrzny `CreateReservationRequest` z wyliczonym `reserved_by` i deleguje, bez duplikowania logiki |
| wzorzec `_require_*` | `app/circulation/domain/reservation_rules.py` | nowa czysta reguła typu dla surowych tras (bez `db`) |
| `AccessDeniedException`, `BusinessConflictException` | `app/core/errors.py` | 403 i 409 |
| `get_reservation` | fasada `app.circulation.service` | router ładuje rezerwację przed regułą typu (identity map sesji, bez realnego kosztu) |
| `list_items_for_inventory_with_product_name` | `app/circulation/infrastructure/repository.py` | wzorzec join z `Product.name` dla nowego zapytania B10 |
| `list_active_reservations_for_item` | tamże | wzorzec kształtu zapytania PENDING/CONFIRMED dla zapytania B12 po `term_id` |
| `circulation_bridge.get_item_balance`, `get_inventory`, `find_personal_inventory` | `app/groups/infrastructure/circulation_bridge.py` | dane „komu, do kiedy” dla B10 |
| `get_profile_by_account_user_id` | `app.users.service` | `display_name` pożyczającego; `party_id` stron w skanie |
| `_scan_giveaways`, `GiveawayTermEndMarker`, `swap_events.TERM_ENDED_GIVEAWAY`, `outbox_service.append` | `app/groups/application/term_end_scan.py`, `groups/models.py`, `groups/domain/swap_events.py` | przebudowa źródła kandydatów przy zachowaniu markera, zdarzenia i jednego commitu |
| `_handle_term_ended_giveaway`, `create_notification` | `app/notifications/outbox_listener.py`, `service.py` | przekazanie `reservation_id` |
| migracja 0038 i pole `join_request_id` | `alembic/versions/0038_notification_join_request_id.py`, `notifications/models.py`, `schemas.py` | 1:1 wzór dla 0040 |
| `lockBadgeLabel`, klasy pigułki, `disabled`/`aria-disabled` | `src/frontend/src/pages/panel/views/RzeczyView.tsx` | badge pożyczenia i blokady |
| `dayjs` | `src/frontend/src/utils/dayjs.ts` | format `DD.MM.YYYY` |
| `ModalSheet`, `GlobalPendingActionsModal` | `panelComponents.tsx`, `PanelDataContext.tsx` | bez zmian wizualnych |
| `resolvePendingReservationId` | `PanelDataContext.tsx` | fallback dla SWAP i starych powiadomień |
| guard `ACTIVE_LOCK_BALANCE_STATUSES` w `setItemMode` | `PanelDataContext.tsx` | wzór guardu „pożyczone” |

### Nowe elementy (z uzasadnieniem)

1. **`CreateReturnReservationRequest`** (schemat). Wspólny DTO musi zostać dla bridge'a i Pledge, a pole `reserved_by_user_id` nie może istnieć w publicznym body.
2. **Reguła typu surowej trasy** w `reservation_rules.py`, nazwa robocza `require_raw_route_reservation_type(reservation_type)` → 403 dla typu ≠ RETURN, eksportowana przez fasadę `service`. Reguły nie mogą trafić do wspólnych przejść (R4), a jedna funkcja obsłuży 4 trasy.
3. **Przypadek użycia `create_return_reservation(db, *, item_id, notes, acting_user_id)`** w `application/reservations.py`, eksportowany w `service.__all__`. Robi sprawdzenia R2, wylicza `reserved_by` i deleguje do `create_reservation`. Logika wymaga dostępu do bazy (item, inventory), więc nie zmieści się w czystej regule.
4. **Zapytanie repozytorium „rzeczy właściciela łącznie z pożyczonymi” z nazwą produktu**, eksponowane przez `inventory_items.py`, `service.__all__` i `circulation_bridge.__all__`. Istniejące zapytanie musi zostać dla listy VIRTUAL.
5. **Zapytanie repozytorium „aktywne rezerwacje dla Terminów”** (`term_id IN (...)`, typy, statusy PENDING/CONFIRMED), przez application, service i bridge. Obecnie brakuje zapytania po `term_id`. Jedno ograniczone zapytanie zamiast pętli po rzeczach.
6. **Migracja 0040 i kolumna `Notification.reservation_id`.** To decyzja C3. Bez niej Pledge-LEND nie ma w FE rozwiązywalnej akcji.

Nie powstają nowe komponenty FE: badge to inline span w istniejącym slocie, jedno miejsce użycia. Nie powstają nowe zdarzenia, markery ani trasy.

---

## Technical Approach

**Kolejność realizacji:** B7 → B6 + B2-lite → B10 → B12. FE i BE dla B6 (payload „Oddaję”) i B7 (body bez `term_id`) wchodzą razem.

**B7.** Zmiana w `app/groups/application/term_item_listings.py`, zgodnie z kolejnością z R9. Router `app/groups/router/term_item_listings.py` usuwa parametr `body`, a `app/groups/schemas.py` usuwa oba modele request. `ConfirmTransactionResponse` i `CancelTransactionResponse` zostają bez zmian.

**B6 + B2-lite.**
- Router `app/circulation/router.py`:
  - `create_reservation`: przyjmuje `CreateReturnReservationRequest`; reguła typu dla `body.reservation_type` (403); aktor z principala; wywołanie `service.create_return_reservation`;
  - `create_swap`: bez modelu body, zawsze `AccessDeniedException`;
  - `confirm`, `cancel`, `fulfill`: `service.get_reservation` → reguła typu → istniejące wywołanie przejścia z `acting_user_id`.
- `create_return_reservation`:
  - `get_item` (404);
  - `home_inventory_id` NULL → 403;
  - `_current_holder_user_id != acting_user_id` → 403;
  - `reserved_by = resolve_owning_inventory(item).owner_user_id`;
  - delegacja do `create_reservation` z typem RETURN i `notes`.
- `reservation_transitions.py`: gałąź RETURN w `cancel_reservation` (R5) i strażnik R7 w gałęzi LEND `fulfill_reservation`.
- `reservations.py`: R6 i R7 w `create_reservation`.

Łańcuch kradzieży jest zamknięty podwójnie:
- anulowanie RETURN → `LENT`, więc GIFT wymagający `AVAILABLE` i tak by nie przeszedł;
- surowy GIFT → 403.

**B10.**
- Nowe zapytanie w repozytorium:
  - `SELECT item, product.name`,
  - `WHERE deleted_at IS NULL AND ((inventory_id = :p AND home_inventory_id IS NULL) OR home_inventory_id = :p)`,
  - jawny join z `Product`, bez `relationship()`.
- `list_my_inventory_items` używa go przez bridge. Dla każdej rzeczy pożyczonej pobiera:
  - balance (`due_date`),
  - inventory VIRTUAL (`owner_user_id`),
  - profil (`display_name`).
- Pętla obejmuje tylko pożyczone rzeczy danego użytkownika. To ten sam precedens co `_resolve_item_display_info` i `_scan_giveaways`, więc nie trzeba batchowego API.
- FE:
  - `api/inventories.ts`: `MyInventoryItemResponse` dostaje pola `lent_to_display_name: string | null`, `lent_due_date: string | null`;
  - `RzeczyView`: `const lent = it.home_inventory_id != null` obok `locked`; `disabled={locked || lent}`; slot badge'a z pierwszeństwem `lent`; warunek akcji po Terminie `locked && !lent && termHasEnded(...)`; kosz `disabled={lent}`;
  - `PanelDataContext`: guardy i typ stanu `items`.
- `useItemTake` (filtr `balance.status === "AVAILABLE"`) sam wyklucza pożyczone rzeczy ze SWAP, bez zmian w kodzie.

**B12.** W `scan_for_term_ended`:
1. Dla każdego Terminu z okna liczony jest `link_path`, jak dziś.
2. Ścieżka rezerwacji to jedno zapytanie przez bridge o GIFT i LEND PENDING/CONFIRMED z `term_id` z okna. Potem odfiltrowanie już oznaczonych markerem, a dla reszty profile stron, `outbox_service.append(TERM_ENDED_GIVEAWAY, {owner_party_id, taker_party_id, reservation_id, link_path})` i `GiveawayTermEndMarker`.
3. Ścieżka SWAP bez zmian: preferencje uprawnionych stron → `_scan_swaps`.
4. Na końcu jeden commit.

Dotychczasowe `_scan_giveaways` zostaje przebudowane albo zastąpione, a parametr `preferences` znika z jego sygnatury. Handler w `outbox_listener.py` przekazuje `reservation_id`. FE: `api/notifications.ts`, mapowanie `pendingActions` i `confirmPendingAction` (R19).

**Przepływ danych bez zmian:** FE → router → fasada `app.<v>.service` → application → repository. Groups sięga do circulation wyłącznie przez `circulation_bridge`, bez bezpośrednich importów `app.circulation`.

## Pliki objęte zmianą

**Backend:**
- `app/circulation/router.py`
- `app/circulation/schemas.py`
- `app/circulation/domain/reservation_rules.py`
- `app/circulation/application/reservations.py`
- `app/circulation/application/reservation_transitions.py`
- `app/circulation/application/inventory_items.py`
- `app/circulation/infrastructure/repository.py`
- `app/circulation/service.py`
- `app/groups/infrastructure/circulation_bridge.py`
- `app/groups/application/term_item_listings.py`
- `app/groups/router/term_item_listings.py`
- `app/groups/schemas.py`
- `app/groups/application/term_end_scan.py`
- `app/groups/models.py` (tylko docstring markera)
- `app/notifications/models.py`
- `app/notifications/service.py`
- `app/notifications/schemas.py`
- `app/notifications/outbox_listener.py`
- `alembic/versions/0040_notification_reservation_id.py` (nowy)
- ewentualnie `app/groups/service.py`, jeśli sygnatury są tam re-eksportowane

**Frontend:**
- `src/api/reservations.ts`: `CreateReservationRequest` → `CreateReturnReservationRequest {item_id; reservation_type?: "RETURN"; notes?}`, typy transakcji, sygnatury `confirmTransaction` i `cancelTransaction`
- `src/api/inventories.ts`
- `src/api/notifications.ts`
- `src/pages/panel/PanelDataContext.tsx`: `returnBorrowedItem` wysyła `{item_id, reservation_type: "RETURN"}` bez `reserved_by_user_id`, a guard `lenderUserId` przestaje być potrzebny do payloadu
- `src/pages/panel/views/RzeczyView.tsx`

---

## Implementation Guidance

### Testing Approach
- W każdej grupie kroków 2–8 skupionych testów. Weryfikacja uruchamia tylko nowe i zmienione testy grupy (`uv run pytest -q tests/<plik>` w `src/backend`; `npx vitest run src/test/<plik>` w FE). Na końcu jedna bramka: pełne `uv run pytest` w `src/backend`.
- **Czerwona bramka TDD:** `src/backend/tests/test_lend_step0_fixes.py` (12 failing + 1 strażnik) musi przejść w całości bez modyfikacji asercji.

**Testy do przepisania lub aktualizacji (BE):**

| Plik | Zmiana |
|---|---|
| `tests/test_circulation.py` | `_lend_and_confirm` i jego użytkownicy (287, 325, 378, 405, 470, 762) oraz 434, 516, 542, 577, 615: tworzenie i przejścia LEND/GIFT przez wspólne funkcje `app.circulation.service` na `db_session` albo przez flow groups, a nie przez surowe HTTP. Testy RETURN zostają na HTTP. `test_createReservation_lendMissingTermId_returns400` i `test_createSwap_missingTermId_returns400` → asercje 403 (typ, `/swap`). `test_createReservation_returnWithNoPriorLend_returns409` → 403 na HTTP (rzecz niepożyczona); ścieżka 409 zostaje pokryta na poziomie serwisu. `test_confirmReservation_byRequester_returns403...` → przeniesiony na wywołania serwisu (reguła posiadacza we wspólnym przejściu). |
| `tests/test_term_item_listings.py` | 1203–1255 (surowy LEND, confirm, fulfill) → flow groups lub serwis; 1914 i 1941 (surowe `/confirm`) → przepisane (asercja 403 albo przejście przez serwis, zależnie od intencji testu); około 21 wywołań `confirm_transaction`/`cancel_transaction` bez `term_id` |
| `tests/test_term_item_listings_router.py` | 160 i 186: dopisane `lent_to_display_name: None`, `lent_due_date: None`; około 8 testów HTTP confirm-transaction bez body |
| `tests/test_pledge_fulfillment.py:273` | surowe `/fulfill` → `confirm_transaction` po Terminie (albo asercja 403 dla surowego fulfill LEND) |
| `tests/test_term_end_scan.py` | sprawdzić, czy scenariusze GIFT mają `term_id` skanowanego Terminu (nowe źródło kandydatów); liczniki markerów bez zmian |

**Nowe testy BE (poza plikiem TDD, 2–8 na grupę):**
- HTTP `cancel-transaction`: szczęśliwa ścieżka i 409 przy przyszłym Terminie rezerwacji (dziś brak testu HTTP);
- `cancel-transaction` na RETURN → 409;
- wspólny `create_reservation` (GIFT/LEND) dla rzeczy z `home_inventory_id` → 409; fulfil LEND takiej rzeczy → 409;
- `POST /api/reservations/swap` → 403; surowe `/cancel` i `/fulfill` LEND → 403;
- skan: GIFT z innego Terminu nie dostaje monitu (filtr `term_id`);
- migracja 0040 up i down przez alembic head w conftest (test pośredni: model z `reservation_id` zapisuje się i czyta).

**Testy FE:**
- `src/test/PanelPage.test.tsx`:
  - 6 asercji `{term_id: 9}` → `confirmTransaction(reservationId)` bez drugiego argumentu;
  - nowe: modal z `reservation_id` (Pledge-LEND) woła `confirmTransaction(reservation_id)` bez wywołań resolvera;
  - fallback do resolvera, gdy `reservation_id` jest null;
  - `returnBorrowedItem` bez `reserved_by_user_id`;
  - `handleDeleteItem` dla pożyczonej rzeczy nie woła `deleteInventoryItem`;
  - `itemCounts` liczy pożyczone.
- `src/test/RzeczyViewCategory.test.tsx`:
  - 2 asercje bez `term_id`;
  - nowe: badge z datą i bez daty (`role="status"`);
  - tryby i kosz `disabled` z `aria-describedby` na badge;
  - brak „Odebrał” i „Anuluj wymianę” dla pożyczonej rzeczy z balance `RESERVED`;
  - edycja nazwy dostępna.
- Konwencje: `vi.mock` modułów API, `vi.resetAllMocks()` w `beforeEach`, `createQueryWrapper` / `renderWithProviders`, pliki w `src/test/`.

### Standards Compliance
- `standards/backend/security.md`: autoryzacja przez principal, 403 przez `AccessDeniedException`, macierz bez zmian.
- `standards/backend/models.md`: luźny wskaźnik cross-BC bez FK; BC groups sięga do circulation tylko przez bridge.
- `standards/backend/migrations.md`: mała, odwracalna migracja 0040 z `down_revision="0039"`.
- `standards/backend/queries.md`: parametryzowane zapytania, jedno ograniczone zapytanie po `term_id`, bez N+1 poza ograniczoną pętlą po pożyczonych rzeczach.
- `standards/global/error-handling.md`: typowane wyjątki 403/409 z czytelnym komunikatem (PL).
- `standards/global/minimal-implementation.md`: bez shimów `term_id`, bez nowego zdarzenia i markera, bez `lent_to_party_id`, bez nowego komponentu FE.
- `standards/global/commenting.md`: poprawione nieaktualne docstringi, bez komentarzy typu changelog.
- `standards/testing/backend-testing.md`: testy integracyjne z testcontainer, nazwy `test_<action>_<condition>_<result>`.
- `standards/testing/frontend-testing.md`: patrz „Testy FE” wyżej.
- `standards/frontend/data-fetching.md`: daty tylko przez `src/utils/dayjs.ts`.
- `standards/frontend/accessibility.md`: `role="status"`, tekst zamiast samego koloru, `disabled` + `aria-disabled` + `aria-describedby`.

---

## Ryzyka

| Ryzyko | Poziom | Mitigacja |
|---|---|---|
| Reguły aktora lub typu trafią do wspólnych przejść i zepsują take, swap i Pledge | średni | R4; reguły tylko w routerze i `create_return_reservation`; pełna bramka `uv run pytest` |
| Zmiana źródła kandydatów GIFT w skanie (bez preferencji) zmieni zachowanie istniejących testów lub doda monity dla GIFT CONFIRMED | średni | przegląd `test_term_end_scan.py`; marker gwarantuje idempotencję |
| Niezsynchronizowany deploy FE i BE (payload „Oddaję”, body B7) | niski | zmiany FE i BE w jednym przebiegu; BE ignoruje nadmiarowe pola, więc stary FE też działa z nowym BE |
| Duża liczba mechanicznych zmian w testach (około 40 miejsc) | średni | kolejność B7 → B6 → B10 → B12, grupa po grupie |
| Pożyczone rzeczy w trybie SWAP zwiększą fan-out zapytań o balance w FE | niski | akceptowalne; `useItemTake` i tak je odfiltrowuje |
| Stare powiadomienia bez `reservation_id` | niski | fallback do resolvera |

## Założenia
- `Reservation.term_id` jest NOT NULL (migracja 0034), a oba legi SWAP mają ten sam Termin.
- `Reservation.giver_user_id` (0039) wskazuje stronę oddającą, dla GIFT i LEND właściciela lub posiadacza. Organizator i deklarujący w Pledge mają profile.
- Pydantic ignoruje nadmiarowe pola body (brak `extra="forbid"` w schematach).
- Surowych tras zapisu nie wywołują żadni realni konsumenci poza „Oddaję” (FE); wtyczki i MCP nie mają takich wywołań (ADR-010).
- Aplikacja jest przed produkcją: bez shimów i bez migracji danych dla istniejących powiadomień.

## Out of Scope
- Encja `Loan`, zwrot dwustronny (potwierdzenie RETURN przez właściciela), reguła „confirm/fulfil RETURN tylko dla W”.
- Usunięcie surowych tras `/api/reservations*` (MVP, ADR-010).
- B3 w pełnej formie (usunięcie `InventoryBalance.due_date`), B11, „moje wzięcia” z RETURN.
- Synchronizacja statusu Pledge (`sync_pledge_fulfillment`) i monit dla Pledge zrealizowanego ponad 24 h po Terminie.
- Przemianowanie `GiveawayTermEndMarker` i `TERM_ENDED_GIVEAWAY`.
- Anulowanie LEND lub GIFT przed Terminem.
- Atomowość fulfil legów SWAP.
- Zmiana nazwy trasy `podarki` i nowe ekrany.

## Success Criteria
1. `uv run pytest -q tests/test_lend_step0_fixes.py`: 13/13 zielonych.
2. Pełne `uv run pytest` w `src/backend` zielone po przepisaniu wskazanych testów.
3. Testy FE `PanelPage.test.tsx` i `RzeczyViewCategory.test.tsx` zielone, łącznie z nowymi przypadkami.
4. Obcy użytkownik z EDIT nie może utworzyć ani przejść żadnej rezerwacji innej niż RETURN przez surowe trasy (403). RETURN może utworzyć tylko bieżący posiadacz, a `reserved_by` = właściciel domu.
5. Anulowanie RETURN zostawia `LENT` z `due_date`, a łańcuch kradzieży jest niewykonalny.
6. `confirm-transaction` przy przyszłym Terminie rezerwacji zwraca 409 niezależnie od body. RETURN daje 409.
7. Właściciel widzi pożyczoną rzecz w „Moich rzeczach” z badge'em „Pożyczone: {imię}, do DD.MM.YYYY”. Tryby i kosz są zablokowane, a liczniki Home nie spadają po przekazaniu.
8. Po Terminie z Take-LEND PENDING lub Pledge-LEND CONFIRMED powstaje dokładnie jedno zdarzenie i dwa powiadomienia z `reservation_id`, a modal „Potwierdź” faktycznie potwierdza transakcję.
9. `alembic upgrade head` i `downgrade -1` dla 0040 przechodzą.

## Known Limitations
- `CreateReturnReservationRequest` zawiera opcjonalne `reservation_type` (domyślnie RETURN), mimo że wymaganie mówiło `{item_id, notes?}`. Pole jest potrzebne, żeby żądanie innego typu dostało 403 (R1 i test `test_rawGiftToSelf_afterCancelledReturn_isRejected`), a nie zostało po cichu obsłużone jako RETURN.
- Pożyczający widzi pożyczone rzeczy tylko w widoku „Wypożyczone”, co zostaje bez zmian.

---

## Rozstrzygnięcia audytu specyfikacji (2026-09-26)

Źródło: `verification/spec-audit.md` (werdykt PASS WITH CONCERNS: 0 krytycznych, 2 poważne, 11 drobnych). Decyzje użytkownika są wiążące i **mają pierwszeństwo przed treścią wyżej**, jeśli coś jest z nią sprzeczne.

### Poważne
- **M-1 (testy BE do przepisania).** Dochodzą dwa testy:
  - `test_circulation.py:816` (`test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict`): po zmianie HTTP zwraca 403 (rzecz bez `home_inventory_id`). Nie wystarczy odwrócić asercji. Przypadek 409 „brak FULFILLED LEND do wyprowadzenia `term_id`” trzeba pokryć na poziomie serwisu (`create_reservation`/`_resolve_return_term_id`), a HTTP asertuje 403.
  - `test_circulation.py:841` (test backfillu 0034): używa `_lend_and_confirm`, więc trzeba go przepiąć na ścieżkę serwis/bridge.
- **M-2 (typ FE i bramka typów).** Pola `lent_to_display_name: string | null` i `lent_due_date: string | null` w FE `MyInventoryItemResponse` są **wymagane**, zgodnie z kontraktem BE, który zawsze zwraca wartość albo `null`.
  - Fixture'y trzeba uzupełnić w: `RzeczyViewCategory.test.tsx:131`, `PanelPage.test.tsx:1725`, `:2551` i wszędzie tam, gdzie powstaje obiekt `MyInventoryItemResponse`.
  - **Nowa bramka jakości:** `npx tsc -b` (albo `npm run build`) oraz `npx eslint` na zmienionych plikach FE, obok vitest i pytest.

### Drobne
- **m-1:** punkt o „dokładnych porównaniach dictów” w `test_term_item_listings_router.py:160,186` jest nieaktualny. Nie dopisujemy tam pól `None`.
- **m-2:** `test_term_item_listings.py:1941`, czyli jedyne surowe `/confirm` (1914 to definicja testu). Test zachowuje intencję (balance `IN_TRANSIT`) i potwierdza przez warstwę serwisu/bridge (`circulation_bridge.confirm_reservation` jako posiadacz), a nie asercją 403.
- **m-3:** docstring bridge'a „the future `confirm_transaction` use case (Group 3)” do poprawy. `RzeczyView.handleConfirmReceipt`/`handleCancelTransaction` sprawdzają tylko `reservationId`, a warunek na `termId` znika. `reservationTermInfo` zostaje, bo zasila `termHasEnded`.
- **m-4:** nowa sygnatura FE to `confirmPendingAction(notificationId: number, termId: number | null, reservationId: number | null)`. `GlobalPendingActionsModal` (`PanelDataContext.tsx` około `:1582`) przekazuje `action.reservationId`. Gdy `reservationId != null`, wywołanie idzie bezpośrednio do `confirmTransaction(reservationId)`, a w przeciwnym razie przez `resolvePendingReservationId(termId, …)` (fallback dla SWAP i starych powiadomień). `PendingConfirmAction` dostaje pole `reservationId: number | null`.
- **m-5:** poprawne nazwy i trasy:
  - typ FE to `NotificationResponse` (`api/notifications.ts`), dostaje pole `reservation_id: number | null`;
  - endpoint to `GET /api/notifications/mine`;
  - istniejące zapytanie po `inventory_id` obsługuje `GET /api/inventory-items?inventory_id=`;
  - błąd walidacji w tej aplikacji to **400**, nie 422.
- **m-6 / m-7 (martwy kod):** decyzja użytkownika to **usunąć teraz**:
  - trasę `POST /api/reservations/swap` (router),
  - `service.create_swap` i `circulation/application/reservations.create_swap`,
  - `CreateSwapRequest` (schemat BE),
  - `circulation_bridge.create_swap`,
  - `circulation_bridge.list_items_with_product_name` (po B10 bez wywołujących),
  - w FE: `createSwap`, `CreateSwapRequest`, `cancelReservation` (`api/reservations.ts`).

  Dotyczy to też testów `test_circulation.py` sprawdzających swap (brak `term_id` → 400, surowe `create_swap`): usuwamy je razem z kodem. Ewentualne powiązane wpisy w macierzy autoryzacji zostają, bo `^/api/reservations(/.*)?$` pokrywa pozostałe trasy.

  Uwaga: surowe `/swap` przestaje istnieć, więc zamiast 403 odpowiada 404/405. Wymóg „/swap zawsze 403” z R1 zostaje zastąpiony usunięciem trasy.
- **m-8 (Założenia):** lokalna baza dev może mieć wiersze „AVAILABLE + `home_inventory_id` ustawione” po starym B2. Po R7 dostaną 409 przy take/propose. Pre-prod, dopuszczalne ręczne czyszczenie danych, bez shimów.
- **m-9 (kolejność R9):** decyzja użytkownika to **najpierw uczestnik**. Kolejność w `_resolve_transaction_reservations_for_action`:
  1. załaduj rezerwację,
  2. `_require_race_participant` (403),
  3. strażnik RETURN (409),
  4. bramka Terminu z `reservation.term_id` (409),
  5. already-resolved,
  6. para SWAP.
- **m-10 (Ryzyka):** brakujący profil strony przerywa cały skan przy każdym uruchomieniu (jeden commit). Ryzyko niskie, obsługa nie jest wymagana w kroku 0.
- **m-11:** brak indeksu na `reservations.term_id` i `inventory_items.home_inventory_id`. Świadomie bez indeksu w kroku 0, bo przy skali pre-prod nie ma to znaczenia.
- **Skan B12 (przypomnienie z audytu):** warunek „brak uprawnionych stron / brak preferencji → pomiń Termin” (`term_end_scan.py:176-183`) nie może blokować ścieżki rezerwacji GIFT+LEND. Bez tego test Pledge-LEND nie przejdzie.
