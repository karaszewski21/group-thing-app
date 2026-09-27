# Scope clarifications — Phase 2 (gap analysis)

Decyzje C1–C3 z Fazy 1 (`clarifications.md`) obowiązują. Poniżej decyzje z bramki gap analysis.

## Krytyczne
| ID | Decyzja |
|---|---|
| raw-confirm-cancel-types | Surowe `/confirm` i `/cancel` **tylko dla RETURN**. LEND/GIFT/SWAP są odrzucane. Jedna reguła dla wszystkich surowych zapisów (create, swap, confirm, cancel, fulfill). Testy `test_term_item_listings.py:1914/1941` do przepisania. |
| return-visible-to-owner | **Blokujemy RETURN** w `_resolve_transaction_reservations_for_action` (confirm i cancel transaction zwracają 409). RzeczyView ukrywa „Odebrał” i „Anuluj wymianę” dla pożyczonych rzeczy (`home_inventory_id != null`). Zwrot dwustronny wejdzie w MVP. |

## Ważne
| ID | Decyzja |
|---|---|
| raw-post-schema | Nowy schemat tylko dla routera: `CreateReturnReservationRequest {item_id, notes?}`. `reserved_by` nie występuje w body, jest wyliczany jako właściciel domu (`resolve_owning_inventory`). FE przestaje go wysyłać. Wspólny `CreateReservationRequest` (używany przez bridge/Pledge) zostaje bez zmian. |
| raw-reject-status | Odrzucenia na surowych trasach to zawsze **403** (`AccessDeniedException`). |
| return-actor | RETURN na surowych trasach działa jak dziś: potwierdza posiadacz, fulfil wykonuje strona. „Oddaję” dalej działa (ADR-010). |
| b7-term-id-body | `term_id` **usunięty całkowicie** ze schematów `ConfirmTransactionRequest`/`CancelTransactionRequest`, z sygnatur serwisu i z FE. Termin zawsze z `reservation.term_id`. Bez shimów. |
| b2lite-due-date | `create_reservation` nie nadpisuje `due_date` przy RETURN. Anulowanie RETURN ustawia `LENT` i czyści tylko `reserved_at`. |
| home-inventory-guard-location | Strażnik `home_inventory_id IS NULL` jest we wspólnym `create_reservation` dla typów innych niż RETURN oraz przy fulfil LEND, z błędem 409. Sprawdza niezmiennik, a żaden legalny wywołujący z groups go nie narusza. |
| b10-fields | `MyInventoryItemResponse` dostaje pola `lent_to_display_name: str \| None` i `lent_due_date: datetime \| None`. „Pożyczone” wynika z `home_inventory_id != null`. |
| b10-ui | Badge „Pożyczone: {imię}, do DD.MM.YYYY” (`role=status`, dayjs z `src/utils/dayjs.ts`). Usuwanie i przyciski trybu są zablokowane, edycja nazwy i kategorii dozwolona. |
| b12-event-marker-source | Kandydaci wybierani przez `Reservation.term_id` dla GIFT i LEND (PENDING/CONFIRMED, bez RETURN). Reużywamy `TERM_ENDED_GIVEAWAY` i `GiveawayTermEndMarker`, bez zmiany nazw. Handler ustawia `Notification.reservation_id`. FE używa `notification.reservation_id`, gdy jest obecne, a stary resolver zostaje jako fallback (SWAP i stare powiadomienia). |
| b12-out-of-scope | Synchronizacja statusu Pledge i brak monitu dla Pledge zrealizowanego ponad 24 h po Terminie są poza zakresem (MVP / ADR-007). |

## Kolejność realizacji (sugestia gap analysis)
B7 → B6 + B2-lite → B10 → B12
