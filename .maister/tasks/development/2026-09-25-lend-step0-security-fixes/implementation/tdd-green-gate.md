# TDD Green Gate — Krok 0 (B6 + B2-lite, B7, B10, B12)

**Plik testów:** `src/backend/tests/test_lend_step0_fixes.py`, niezmieniony od Fazy 3 (mtime 2026-09-25 21:39, 13 funkcji `test_`).
**Komenda:** `uv run pytest -q tests/test_lend_step0_fixes.py -p no:warnings`
**Wynik:** **13 passed** w 17.74 s (2026-09-26)

| Test | Błąd | Red (Faza 3) | Green |
|---|---|---|---|
| `test_rawCreateReservation_strangerLocksOthersAvailableItem_returns403` | B6 | 201 | ✅ 403 |
| `test_rawCreateReturn_forSomeoneElsesLoan_returns403` | B6 | 201 | ✅ 403 |
| `test_rawCreateReturn_reservedByAlwaysHomeOwner_bodyValueIgnored` | B6 | `reserved_by` z body | ✅ właściciel domu |
| `test_rawConfirm_lendBeforeTermEnd_returns403` | B6 | 200 | ✅ 403 |
| `test_rawCancelReturn_restoresLentAndKeepsDueDate` | B2-lite | AVAILABLE | ✅ LENT + `due_date` |
| `test_rawGiftToSelf_afterCancelledReturn_isRejected` | B6/B2-lite | 201 | ✅ 403 |
| `test_confirmTransaction_otherPastTermId_whileOwnTermUpcoming_returns409` | B7 | 200 | ✅ 409 |
| `test_confirmTransaction_onReturnReservation_returns409` | B7 | 200 | ✅ 409 |
| `test_listMyInventoryItems_lentItem_stillListedForOwnerWithBorrowerAndDueDate` | B10 | brak rzeczy | ✅ rzecz + `lent_*` |
| `test_listMyInventoryItems_notLentItem_hasNullLentFields` | B10 | KeyError | ✅ `null` |
| `test_scan_pendingLendPastTermEnd_promptsBothPartiesWithReservationId` | B12 | 0 zdarzeń | ✅ 1 zdarzenie, 2 powiadomienia z `reservation_id` |
| `test_scan_confirmedPledgeLend_promptsWithReservationId` | B12 | 0 zdarzeń | ✅ 1 zdarzenie |
| `test_scan_returnReservation_isNotPrompted` | B12 (strażnik) | PASS | ✅ PASS |

Pełny zestaw BE (G7): 413 passed. Lokalna baza dev zmigrowana do 0040 (head), wcześniej stała na 0038.
Zielona bramka jest spełniona.
