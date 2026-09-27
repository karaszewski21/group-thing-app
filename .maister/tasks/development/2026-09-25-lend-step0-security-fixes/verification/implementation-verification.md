# Implementation Verification — Krok 0 wypożyczeń (B6 + B2-lite, B7, B10, B12)

**Data:** 2026-09-26
**Status ogólny: ❌ Failed. Jeden problem krytyczny dla celu B6 (K-1)**, wykryty przez reality check. Leży poza literą spec i istniał przed zmianą. Poza nim implementacja jest kompletna i zgodna ze spec.

## Executive summary
Wszystkie 4 błędy z zakresu (B6 + B2-lite, B7, B10, B12) są zamknięte i potwierdzone testami:
- BE 413 passed,
- bramka TDD 13/13,
- FE 290 passed + 4 niezwiązane błędy („bomba czasowa” mock JWT, `exp` = 2026-09-26 13:21 UTC).

Reality check uruchomił sondę i znalazł **K-1**: właściciel listingu SWAP może po Terminie przejąć rzecz proponującego przez `confirm-transaction` na niesparowanym legu, bez akceptacji zamiany. To podważa cel B6 („nikt nie przejmie cudzej rzeczy”), więc status ogólny to Failed, dopóki K-1 nie zostanie naprawiony albo świadomie zaakceptowany.

## Plan implementacji (completeness checker)
- 62 kroki: 61 [x] + 1 [~] (7.6 pominięty, migracja zweryfikowana w 4.9). **100% efektywnie.**
- Spot-checki kodu dla G1–G7: wszystkie potwierdzone.

## Testy
Pełny zestaw nie był uruchamiany osobno w tej fazie (`skip_test_suite`, przeszedł w G7). Reality check i production readiness uruchomiły go niezależnie:

| Zestaw | Wynik |
|---|---|
| BE `uv run pytest` | **413 passed**, 0 failed (około 3:45) |
| Bramka TDD `test_lend_step0_fixes.py` | **13/13** |
| FE `npx vitest run` | **290 passed, 4 failed**: `auth`, `extension-points` ×2, `foundation`. Niezwiązane ze zmianą. Mock JWT w tych testach ma `exp=1790428872` (2026-09-26 13:21 UTC), token wygasł dziś, więc CI będzie czerwone niezależnie od tej zmiany. |
| FE `npx tsc -b` | czysty |

## Zgodność ze standardami
**mostly_compliant**: 17/17 standardów, które mają zastosowanie, przestrzegane. 1 ostrzeżenie (`queries.md`): ograniczone pętle per-wiersz. `/mine` robi 3 wywołania na pożyczoną rzecz, skan 2 wyszukiwania profilu na kandydata. Plan to zaakceptował.

## Dokumentacja
**complete**: work-log dla G1–G7, `tdd-red-gate.md`, `tdd-green-gate.md`, `visual-coverage.md` 7/7. Uwaga informacyjna: plik bramki TDD i migracja 0040 są nieśledzone w git. Brak modyfikacji bramki potwierdzono po mtime.

## Przeglądy opcjonalne

| Przegląd | Status | Krytyczne | Ostrzeżenia | Info | Raport |
|---|---|---|---|---|---|
| Code review | issues_found | 0 | 2 | 9 | `code-review-report.md` |
| Pragmatic review | ✅ odpowiednia złożoność | 0 | 3 (średnie) | 6 (niskie) | `pragmatic-review.md` |
| Production readiness | GO_WITH_MITIGATIONS (85%) | 0 | 5 | 4 | `production-readiness-report.md` |
| Reality check | ⚠️ Issues Found | **1 (K-1)** | kilka | — | `reality-check.md` |

## Problemy wymagające uwagi (zdeduplikowane)

### Krytyczne
1. **K-1: kradzież przez niesparowany leg SWAP** (reality check, potwierdzone sondą).
   - `propose_swap` tworzy leg proponującego jako CONFIRMED, z `reserved_by` = właściciel listingu i bez pary.
   - Po Terminie właściciel woła `confirm-transaction` na `proposer_reservation_id`. Ten identyfikator jest widoczny w listingu jako `resolved_reservation_id`.
   - Wynik: 200 FULFILLED, rzecz proponującego trafia do właściciela bez akceptacji zamiany.
   - Błąd istniał przed zmianą. B7 go zawęził: działa dopiero po Terminie, a nie z dowolnym `term_id`.
   - **Poprawka:** w `_resolve_transaction_reservations_for_action` zwrócić 409 dla SWAP bez `paired_reservation_id`, opcjonalnie też gdy `SwapProposal` nie jest ACCEPTED. Do tego test HTTP. Około 1–2 h. **Fixable: tak.**

### Ostrzeżenia
2. **W-1 / Z2: „Oddaję” nie jest atomowe** (code review, production readiness, reality check). To 3 żądania. Jeśli confirm albo fulfill się nie uda, zostaje RETURN w stanie PENDING/CONFIRMED, ponowienie daje 409, a w UI nie ma wyjścia. Poprawka FE: wykryć aktywny RETURN (`balance.reservation_id`) i dokończyć brakujące kroki. `src/frontend/src/pages/panel/PanelDataContext.tsx:1371`. **Fixable.**
3. **W-2: RETURN widoczny właścicielowi jako „wzięte przeze mnie”.** `list_my_active_taken_term_item_listings` nie pomija RETURN i nie filtruje po `reservation.term_id`. `src/backend/app/groups/application/term_item_listings.py:347`. **Fixable.**
4. **Z1 / m-10: brak profilu jednej ze stron przerywa cały skan** (jeden commit, powtarzane co minutę przez 24 h). Poprawka: `try/except` per rezerwacja, log i `continue`. `term_end_scan.py`. **Fixable.**
5. **Z3: skan nie loguje** liczników Terminów, rezerwacji i zdarzeń. **Fixable.**
6. **Pragmatic M1: zdublowane testy** między bramką TDD a plikami tematycznymi (5 par). Bramka TDD ma zostać nietknięta, więc ewentualnie usunąć duplikaty z plików tematycznych albo zostawić. **Decyzja.**
7. **Pragmatic M2: przegadane docstringi** z odwołaniami do „spec.md Bug #4”, „gap analysis” i identyfikatorów B6/B7. **Fixable.**
8. **Pragmatic M3: zawiłe `confirmPendingAction`**, podwójny guard. **Fixable.**
9. **Właściciel może anulować cudzy RETURN** surowym `/cancel` (reality check). Właściciel jest `reserved_by`, więc przepuszcza go reguła strony. **Fixable** (tylko posiadacz anuluje RETURN, reguła w routerze).
10. **Z4 / I-5: wyciek ID** (404 i 403 przed sprawdzeniem strony) w surowych trasach. Niskie ryzyko.

### Info (wybrane)
- **Test „bomba czasowa”:** mock JWT w 3 plikach testów FE wygasł 2026-09-26. Poza zakresem, ale czerwone CI.
- **Naiwna data UTC w badge'u** może przesunąć się o dzień blisko północy (I-6). Pusty badge „Pożyczone: ” przy `null` (I-7/L6).
- **Brakujące testy (I-9):** RETURN tworzony przez właściciela zamiast posiadacza, anulowanie RETURN przez osobę trzecią, strażnik `fulfill(LEND)`.
- **Jednostronne potwierdzenie** („kto pierwszy, ten wygrywa”) to świadoma decyzja. Dopisać do ADR jako ryzyko.
- **Monity tylko w oknie 24 h.** W bazie dev wiszą 1 GIFT i 1 LEND w stanie PENDING bez monitu.
- **Backend pozwala ustawić tryb listingu dla pożyczonej rzeczy.** Przejęcie blokuje strażnik, ale zabezpieczenie w UI jest tylko po stronie frontendu.

## Rekomendacje
1. **Naprawić K-1** (z testem) przed commitem.
2. Naprawić W-1, W-2, Z1 i punkt 9. Są małe i zamykają realne ścieżki błędów.
3. Opcjonalnie posprzątać M2, M3 i Z3.
4. Odnotować w ADR: jednostronne potwierdzenie, okno monitu 24 h.
5. Propozycja standardu (do zgody użytkownika): każdy use case, który przyjmuje `reservation_id` od klienta, sprawdza typ i stan rezerwacji (RETURN, niesparowany SWAP), a nie tylko uczestnictwo.

## Checklista weryfikacji
- [x] Completeness checker
- [x] Code review
- [x] Pragmatic review
- [x] Production readiness
- [x] Reality check
- [x] Zestaw testów (odziedziczony z G7, potwierdzony niezależnie: BE 413, FE 290 + 4 niezwiązane)
- [ ] Brak problemów krytycznych (K-1 otwarte)
