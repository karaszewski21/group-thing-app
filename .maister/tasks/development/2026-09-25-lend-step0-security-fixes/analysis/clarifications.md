# Clarifications — Phase 1

Źródło: analiza kodu (`analysis/codebase-analysis.md`) + research `2026-09-25-lend-lifecycle-virtual-inventory` (ADR-008, ADR-010).

| # | Pytanie | Decyzja użytkownika |
|---|---|---|
| C1 | Luka kradzieży przez surowe trasy (anulowanie RETURN → AVAILABLE w VIRTUAL → GIFT do siebie). Naprawiać w kroku 0 (B2-lite)? | **Tak, w kroku 0.** Anulowanie RETURN przywraca `LENT` (nie AVAILABLE). Surowe create dla typów innych niż RETURN wymaga, żeby rzecz była w domu (`home_inventory_id IS NULL`). Własne testy regresji. |
| C2 | Surowe `POST /api/reservations` dla LEND/GIFT/SWAP (FE ich nie używa). | **Odrzucać (409/403).** Surowe create, `/swap` i `/fulfill` tylko dla RETURN: aktor = bieżący posiadacz, a `reserved_by` wyliczany jako właściciel domu (body ignorowane). Około 12 testów `test_circulation` trzeba przepisać na ścieżki groups/bridge. Reguły tylko w routerze lub w guardzie dla routera. Wspólne funkcje przejść, używane przez groups przez `circulation_bridge`, bez zmian. |
| C3 | B12 dla Pledge-LEND: FE nie znajduje rezerwacji dla powiadomienia. | **`reservation_id` w `Notification`.** Nowa kolumna (migracja 0040, luźny wskaźnik bez FK, jak `proposal_id`). Modal oczekujących akcji używa jej bezpośrednio. |

## Korekty researchu
- FE nie woła surowego `/fulfill` dla Pledge-LEND, robi to tylko `tests/test_pledge_fulfillment.py:273`. Pledge-LEND kończy się przez `confirm_transaction` („Odebrał” w RzeczyView).
