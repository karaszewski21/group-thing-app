# Requirements — Krok 0 wypożyczeń (B6 + B2-lite, B7, B10, B12)

## Opis wyjściowy
Krok 0 z research `2026-09-25-lend-lifecycle-virtual-inventory` (ADR-008, ADR-010): łatki bezpieczeństwa i widoczności przed MVP wypożyczeń (encja `Loan`).
- **B6:** surowe `/api/reservations*` biorą `reserved_by` z body i omijają reguły groups.
- **B7:** `confirm`/`cancel-transaction` ufają `term_id` z body.
- **B10:** właściciel nie widzi pożyczonych rzeczy w `/api/inventory-items/mine`.
- **B12:** `term_end_scan` ignoruje LEND i Pledge-LEND.

Rozszerzenie zakresu: B2-lite (luka kradzieży przez anulowanie RETURN).

## Q&A (wszystkie rundy)
- Phase 1: `analysis/clarifications.md` (C1–C3).
- Phase 2: `analysis/scope-clarifications.md` (decyzje krytyczne i ważne).
- Phase 5:
  - **User journey:** tylko istniejące miejsca, bez nowych ekranów.
    - `/panel/rzeczy` („Moje rzeczy”): właściciel widzi pożyczoną rzecz z badge.
    - `/panel/podarki` (widok „Wypożyczone”, `WypozyczoneView`): pożyczający klika „Oddaję” jak dziś. FE przestaje wysyłać `reserved_by_user_id`.
    - Globalny modal „Potwierdź transakcję” (`GlobalPendingActionsModal`): działa też dla Pledge-LEND dzięki `notification.reservation_id`. Dotyczy organizatora i deklarującego.
    - Nazwa trasy `podarki` zostaje bez zmian.
  - **Reużycie wzorców (potwierdzone):**
    - `Notification.proposal_id`/`join_request_id` (migracja 0038) jako wzór dla `reservation_id` (0040);
    - helpery `_require_*` w `circulation/domain/reservation_rules.py`;
    - `term_end_scan` (marker + outbox w jednym commicie);
    - badge wzorem `lockBadgeLabel` w RzeczyView;
    - testy wzorem `test_term_item_listings_router.py` i `test_lend_step0_fixes.py`.
  - **Wizualia:** tylko ASCII z Fazy 4 (`analysis/design-context/`).
  - **Dodatki UI (oba przyjęte):**
    - guard `lent` w `handleDeleteItem` i `setItemMode` w PanelDataContext, jako obrona oprócz zablokowanych przycisków;
    - `aria-describedby` przy zablokowanych przyciskach trybu i koszu, wskazujące na badge „Pożyczone…”.

## Wymagania funkcjonalne

### B6 + B2-lite (circulation, surowe trasy)
1. Surowe zapisy (`POST /api/reservations`, `POST /api/reservations/swap`, `POST /{id}/confirm|cancel|fulfill`) są dozwolone **tylko dla RETURN**. Inne typy dostają 403. `/swap` zawsze 403.
2. `POST /api/reservations` przyjmuje `CreateReturnReservationRequest {item_id, notes?}`, tylko dla routera:
   - aktor = principal i musi być bieżącym posiadaczem, czyli właścicielem VIRTUAL, w którym leży rzecz;
   - `reserved_by` jest wyliczany jako właściciel domu (`resolve_owning_inventory`);
   - pola nadmiarowe w body są ignorowane.
3. RETURN confirm i fulfill działają jak dziś (confirm wykonuje posiadacz, fulfil strona), więc „Oddaję” dalej działa.
4. Reguły żyją w guardzie dla routera. Wspólne funkcje przejść, wołane przez groups przez `circulation_bridge`, zostają bez zmian semantycznych.
5. Anulowanie RETURN ustawia balance na `LENT` i czyści tylko `reserved_at`. `due_date` i `lent_at` zostają.
6. `create_reservation` nie nadpisuje `due_date` przy RETURN.
7. Strażnik niezmiennika: wspólny `create_reservation` dla typów innych niż RETURN oraz fulfil LEND wymagają `home_inventory_id IS NULL`. W przeciwnym razie 409.
8. Docstring routera circulation zostaje poprawiony.

### B7 (groups)
9. `confirm_transaction` i `cancel_transaction` biorą Termin z `reservation.term_id`. Rezerwacja jest ładowana przed sprawdzeniem Terminu.
10. `term_id` znika z `ConfirmTransactionRequest`/`CancelTransactionRequest`, z sygnatur serwisu, z typów FE i z wywołań (`RzeczyView`, `PanelDataContext.confirmPendingAction`). Bez shimów.
11. Rezerwacja typu RETURN w `_resolve_transaction_reservations_for_action` daje 409.
12. Nieaktualne docstringi „Reservation carries no Term” (5 miejsc) zostają poprawione.

### B10 (groups + FE)
13. `GET /api/inventory-items/mine` zwraca rzeczy, których domem jest PERSONAL wołającego: te leżące w nim (`home_inventory_id IS NULL`) oraz pożyczone (`home_inventory_id` = PERSONAL). Potrzebne jest nowe zapytanie w repozytorium, a istniejące zostaje dla widoku VIRTUAL.
14. `MyInventoryItemResponse` dostaje pola `lent_to_display_name: str | None` (właściciel VIRTUAL, a przez profil jego `display_name`) oraz `lent_due_date: datetime | None` (`InventoryBalance.due_date`).
15. FE RzeczyView, dla rzeczy z `home_inventory_id != null`:
    - badge „Pożyczone: {imię}, do DD.MM.YYYY” (`role=status`, dayjs z `src/utils/dayjs.ts`), bez daty samo „Pożyczone: {imię}”; zastępuje badge blokady;
    - przyciski trybu i kosz zablokowane (`disabled` + `aria-disabled` + `aria-describedby` na badge);
    - edycja nazwy, kategorii i stanu dozwolona;
    - „Odebrał” i „Anuluj wymianę” ukryte.
16. FE PanelDataContext: guard `lent` w `handleDeleteItem` i `setItemMode`. Liczniki na Home liczą też pożyczone rzeczy.

### B12 (groups + notifications + FE)
17. `term_end_scan` wybiera kandydatów po `Reservation.term_id` dla GIFT i LEND w statusach PENDING/CONFIRMED, bez RETURN i bez SWAP. Źródłem nie są preferencje. Obejmuje to Pledge-LEND (CONFIRMED). Skan jest idempotentny dzięki `GiveawayTermEndMarker` i reużywa `TERM_ENDED_GIVEAWAY`. Ścieżka SWAP zostaje bez zmian.
18. Migracja `0040_notification_reservation_id`: nullable `notifications.reservation_id`, luźny wskaźnik bez FK. Handler giveaway/LEND ustawia go w obu powiadomieniach `TERM_CONFIRMATION_NEEDED`.
19. FE: `Notification`/`PendingConfirmAction` dostają `reservationId`. `confirmPendingAction` używa go, gdy jest obecny, a w przeciwnym razie stary resolver (SWAP, stare powiadomienia).
20. Synchronizacja statusu Pledge jest poza zakresem.

## Testy
- Nowe: `src/backend/tests/test_lend_step0_fixes.py` (TDD red: 12 failing + 1 strażnik) musi przejść.
- Do przepisania, bo używają surowych tras dla typów innych niż RETURN:
  - `test_circulation.py` (`_lend_and_confirm` i około 11 użyć);
  - `test_term_item_listings.py:1203/1914/1941`;
  - `test_pledge_fulfillment.py:273` (przejście na `confirm_transaction`).
- Do aktualizacji po usunięciu `term_id` z body: około 21 wywołań serwisu, około 8 testów HTTP, 6 asercji w PanelPage i 2 w RzeczyViewCategory.
- Dokładne porównania dictów w `test_term_item_listings_router.py:160,186` dostają pola `None`.
- Nowe: test HTTP `cancel-transaction`, testy FE dla badge i blokad pożyczonej rzeczy, test modala z `reservation_id`.

## Poza zakresem
Encja `Loan`, zwrot dwustronny, usunięcie surowych tras (MVP), B3 w pełnej formie (usunięcie kolumn), B11, sync statusu Pledge, zmiana nazwy trasy `podarki`.
