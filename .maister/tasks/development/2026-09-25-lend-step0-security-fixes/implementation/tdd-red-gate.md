# TDD Red Gate — Krok 0 (B6 + B2-lite, B7, B10, B12)

**Plik testów:** `src/backend/tests/test_lend_step0_fixes.py`
**Komenda:** `uv run pytest -q tests/test_lend_step0_fixes.py`
**Wynik:** 12 failed, 1 passed (2026-09-25)

Pożyczone rzeczy są tworzone wyłącznie przez flow groups (oferta LEND → take → koniec Terminu → `confirm-transaction`). Testy nie zależą więc od surowych tras zapisu, które B6 ogranicza do RETURN.

| Test | Błąd | Obecny wynik (FAIL) | Oczekiwany |
|---|---|---|---|
| `test_rawCreateReservation_strangerLocksOthersAvailableItem_returns403` | B6 | 201 (obcy blokuje cudzą rzecz) | 403 |
| `test_rawCreateReturn_forSomeoneElsesLoan_returns403` | B6 | 201 | 403 |
| `test_rawCreateReturn_reservedByAlwaysHomeOwner_bodyValueIgnored` | B6 | `reserved_by` = wartość z body (pożyczający) | właściciel domu |
| `test_rawConfirm_lendBeforeTermEnd_returns403` | B6 | 200 (surowe confirm LEND przed Terminem) | 403 |
| `test_rawCancelReturn_restoresLentAndKeepsDueDate` | B2-lite | balance `AVAILABLE` | `LENT`, `due_date` zachowany |
| `test_rawGiftToSelf_afterCancelledReturn_isRejected` | B6/B2-lite (łańcuch kradzieży) | 201 | 403 |
| `test_confirmTransaction_otherPastTermId_whileOwnTermUpcoming_returns409` | B7 | 200 (cudzy miniony Termin odblokowuje) | 409 |
| `test_confirmTransaction_onReturnReservation_returns409` | B7 / return-visible-to-owner | 200 (właściciel domyka RETURN) | 409 |
| `test_listMyInventoryItems_lentItem_stillListedForOwnerWithBorrowerAndDueDate` | B10 | rzecz nieobecna w `/mine` | obecna + `lent_to_display_name`, `lent_due_date` |
| `test_listMyInventoryItems_notLentItem_hasNullLentFields` | B10 | brak pól `lent_*` (KeyError) | pola `null` |
| `test_scan_pendingLendPastTermEnd_promptsBothPartiesWithReservationId` | B12 | 0 zdarzeń | 1 zdarzenie (idempotentnie), 2 powiadomienia z `reservation_id` |
| `test_scan_confirmedPledgeLend_promptsWithReservationId` | B12 | 0 zdarzeń | 1 zdarzenie dla CONFIRMED Pledge-LEND |
| `test_scan_returnReservation_isNotPrompted` | B12 (strażnik) | PASS (dziś nie skanujemy RETURN) | nadal PASS po zmianie źródła kandydatów |

Wszystkie niepowodzenia wynikają z opisanych defektów, a nie z błędów konfiguracji. Czerwona bramka jest spełniona.
