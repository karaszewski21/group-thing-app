# Reality check — Krok 0 wypożyczeń (B6 + B2-lite, B7, B10, B12)

**Data:** 2026-09-26
**Metoda:** samodzielne uruchomienie testów, przegląd kodu BE/FE (diff względem HEAD), sondy ataku na surowe trasy i trasy groups (tymczasowy test-sonda, usunięty po uruchomieniu), odczyt lokalnej bazy dev (tylko SELECT).

## Status: ⚠️ Issues Found — GO dla zakresu Kroku 0, z jedną luką kradzieży poza zakresem, którą trzeba zamknąć przed MVP

Wszystko, co spec obiecuje dla B6/B2-lite, B7, B10 i B12, faktycznie działa i jest pokryte testami. Deklaracje z work-logu się potwierdziły: nie znalazłem fałszywych ukończeń. Istnieje jednak **nadal działająca ścieżka przejęcia cudzej rzeczy przez endpointy groups** (niezaakceptowana propozycja zamiany, patrz K-1). Luka jest starsza niż ta zmiana i formalnie leży poza spec, ale podważa cel z user story („nikt obcy nie może zablokować, przejąć ani zwrócić mojej rzeczy”). Krok 0 ją zawęził, bo wcześniej działała od razu, a dziś dopiero po Terminie. Nie została zamknięta.

---

## 1. Twierdzenia a rzeczywistość

| Twierdzenie | Weryfikacja | Wynik |
|---|---|---|
| Pełny BE: 413 passed | `uv run pytest -q -p no:warnings` uruchomione przeze mnie: **413 passed w 3:41** | ✅ zgodne |
| Bramka TDD 13/13 bez zmian asercji | wchodzi w 413; plik `test_lend_step0_fixes.py` jest nieśledzony (nowy), mtime zgodny z red gate | ✅ |
| FE: 290 passed / 4 znane porażki | `npx vitest run`: **290 passed, 4 failed** (auth, extension-points ×2, foundation, poza zmianą) | ✅ |
| `tsc -b` czyste (bramka M-2) | `npx tsc -b`: exit 0 | ✅ |
| Migracja 0040 | lokalna baza dev: `alembic_version = 0040`; testcontainer przechodzi 0039→0040 | ✅ |
| Martwy kod usunięty (m-6) | brak `create_swap`, `CreateSwapRequest`, `list_items_with_product_name` w bridge, FE `createSwap`/`cancelReservation` | ✅ |
| M-1 (testy 816/841) | `test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict` i `test_migration0034_…` nadal istnieją i przechodzą | ✅ |

## 2. Weryfikacja funkcjonalna per błąd

### B6 + B2-lite: surowe `/api/reservations*`, ✅ zamknięte
- `router.py`: create przyjmuje tylko `CreateReturnReservationRequest`. `require_raw_route_reservation_type` stoi przed confirm, cancel i fulfill, a aktor zawsze pochodzi z principala. `/swap` jest usunięte.
- `create_return_reservation`: 403, gdy rzecz nie jest pożyczona albo aktor nie jest posiadaczem. `reserved_by` = właściciel domu (`resolve_owning_inventory`).
- Surowe przejścia RETURN po utworzeniu:
  - confirm tylko posiadacz (pożyczający);
  - cancel i fulfill strona (pożyczający albo właściciel);
  - cancel → `LENT` z zachowanym `due_date`.
  Łańcuch kradzieży (cancel RETURN → AVAILABLE w VIRTUAL → GIFT do siebie) jest zablokowany podwójnie: surowy GIFT dostaje 403, a strażnik R7 daje 409 na `home_inventory_id IS NOT NULL` w `create_reservation` i w fulfil LEND.
- Pozostałe drogi, które sprawdziłem, blokują pożyczającego:
  - PATCH/DELETE rzeczy: `_require_item_owner` przez `resolve_owning_inventory`;
  - ustawienie trybu listowania: własność PERSONAL;
  - `propose_swap` z pożyczoną rzeczą: `_require_own_available_personal_item`;
  - `fulfill_pledge` z pożyczoną rzeczą: fizyczne inventory to VIRTUAL, więc 403.
- Lokalna baza dev nie ma wierszy „AVAILABLE + `home_inventory_id`” (m-8), więc czyszczenie nie jest potrzebne.

### B7: Termin z rezerwacji, ✅ zamknięte
- `_resolve_transaction_reservations_for_action`: kolejność load → uczestnik (403) → RETURN (409) → `get_term(reservation.term_id)` (409) → already-resolved → para SWAP, zgodnie z decyzją m-9.
- Body i klasy request zostały usunięte po obu stronach (BE/FE). Wysłane `{"term_id": …}` jest ignorowane, co pokrywa test gate.

### B10: właściciel widzi pożyczone, ✅ działa end-to-end
- Nowe zapytanie (`home_inventory_id = PERSONAL` lub rzecz w domu, `deleted_at IS NULL`) i pola `lent_to_display_name`/`lent_due_date` są wyliczane tylko dla pożyczonych.
- Pożyczający nie widzi cudzej rzeczy w swoim `/mine` (test).
- FE: badge „Pożyczone: X, do DD.MM.YYYY” przez `utils/dayjs`. Tryby i kosz są `disabled` z `aria-describedby`, „Odebrał”/„Anuluj” ukryte przy `lent`. W `setItemMode` i `handleDeleteItem` są guardy.
- Przepływ „Odebrał” (confirm LEND po Terminie) → rzecz trafia do VIRTUAL biorącego → u właściciela zostaje z badge'em. Spójne.

### B12: monit po Terminie, ✅ działa
- Skan korzysta z `Reservation.term_id` (GIFT/LEND, PENDING/CONFIRMED, bez RETURN i SWAP), niezależnie od preferencji. Marker i outbox są zapisywane w jednym commicie. Scheduler co 1 min jest podpięty w `main.py`, listener przekazuje `reservation_id`.
- FE: `PendingConfirmAction.reservationId` i `confirmPendingAction(notificationId, termId, reservationId)` z fallbackiem do resolvera. Modal przekazuje `action.reservationId`.
- Strony dostające monit (giver i reserved_by) są uczestnikami w `_require_race_participant`, więc „Potwierdź” faktycznie przechodzi.

---

## 3. Luki

### Krytyczne dla celu biznesowego (poza formalnym zakresem spec)

**K-1. Właściciel listingu SWAP może zabrać rzecz proponującego bez akceptacji i bez oddania swojej.** Potwierdzone sondą.
- **Scenariusz:**
  1. P proponuje zamianę, a `propose_swap` tworzy leg P z `reserved_by` = właściciel O, od razu CONFIRMED i bez pary.
  2. O nie akceptuje.
  3. Po Terminie O woła `POST /api/reservations/{proposer_reservation_id}/confirm-transaction`.
- **Dowód (sonda):** `200 {"status":"FULFILLED"}`. Właściciel rzeczy P zmienia się z usera 6 na usera 5, a rzecz O zostaje u O. `proposer_reservation_id` jest dostępne dla O, bo `_resolve_listing_status` zwraca je jako `resolved_reservation_id` listingu.
- **Przyczyna:** `_resolve_transaction_reservations_for_action` przyjmuje leg SWAP z `paired_reservation_id IS NULL`, więc powstaje jednostronny SWAP. Wariant pokrewny: O zmienia tryb, oddaje własną rzecz komuś innym flow, a leg P nadal wisi CONFIRMED.
- **Przed Krokiem 0:** działało od razu, z dowolnym minionym `term_id`. B7 zawęził to do okresu po Terminie.
- **Skutek:** kradzież przez endpoint groups. FE tego nie eksponuje, ale API tak. User story B6 („nikt nie może przejąć mojej rzeczy”) nie jest w pełni prawdziwe.
- **Naprawa (mała):** w `_resolve_transaction_reservations_for_action` odrzucić 409 SWAP bez `paired_reservation_id`, ewentualnie także z `SwapProposal.status != ACCEPTED`. Do tego test HTTP.

### Wysokie / średnie (świadome ograniczenia albo stan sprzed zmiany, warto nazwać)

| # | Luka | Waga | Uwagi |
|---|---|---|---|
| Q-1 | **Jednostronne potwierdzenie przez biorącego.** Po Terminie biorący GIFT/LEND (albo organizator w Pledge-LEND) sam woła `confirm-transaction` i rzecz przechodzi do niego, nawet jeśli fizycznie nic nie przekazano. Obowiązuje reguła „kto pierwszy, ten wygrywa”. | Średnia | Decyzja projektowa, poza Krokiem 0 (Loan MVP, zwrot dwustronny). Nazwać w ADR i odnotować jako ryzyko nadużycia. |
| Q-2 | **„Oddaję” nie jest atomowe.** FE robi create → confirm → fulfill trzema wywołaniami. Po błędzie w środku RETURN wisi (balance `RESERVED`/`IN_TRANSIT`), a „spróbuj ponownie” zawsze dostaje 409 (balance ≠ LENT). Żadna ze stron nie ma w UI akcji odblokowania. | Średnia | Stan sprzed zmiany. Tani fix: przy retry wznowić istniejący aktywny RETURN (`balance.reservation_id`) albo zrobić jedną transakcję BE. |
| Q-3 | **Właściciel może anulować cudzy RETURN** surowym `/cancel` (jest stroną `reserved_by`) i blokować zwrot, choć pożyczający może utworzyć nowy. | Niska | Zgodne ze spec. Uciążliwość, nie kradzież. |
| Q-4 | **Monity tylko w oknie 24 h.** Istniejące PENDING Take-LEND/GIFT z Terminów, które minęły wcześniej (lokalnie: 1 GIFT i 1 LEND PENDING), nigdy nie dostaną monitu. | Niska | Świadomie poza zakresem. Obie strony mają inne wejścia: „Odebrał” i lista wziętych. |
| Q-5 | **Brakujący profil strony zatrzymuje cały skan** (jeden commit), co m-10 już odnotował. | Niska | Zaakceptowane w audycie. |
| Q-6 | BE pozwala właścicielowi ustawić tryb listowania na pożyczonej rzeczy (blokuje to tylko FE). | Niska | Nieszkodliwe, bo take/propose wymagają AVAILABLE. |

### Integracja
Nie znalazłem problemów. Groups sięga do circulation wyłącznie przez `circulation_bridge`, a poza modułem nie ma innych konsumentów zapisu (plugin, oauth2, system). Macierz autoryzacji jest bez zmian i pokrywa trasy.

## 4. Kompletność funkcjonalna

**~95% zakresu Kroku 0.** Wszystkie R1–R20 wraz z rozstrzygnięciami audytu są zrealizowane i zweryfikowane. Brakuje ~5% względem celu biznesowego, czyli luki K-1: formalnie jest poza spec, ale należy do tej samej klasy co B6.

## 5. Pragmatyczny plan działań

| # | Zadanie | Kryterium sukcesu | Priorytet | Wysiłek |
|---|---|---|---|---|
| 1 | W `_resolve_transaction_reservations_for_action` odrzucać leg SWAP bez `paired_reservation_id` (409, np. „Zamiana nie została zaakceptowana”). Rozważyć też `SwapProposal.status == ACCEPTED`. | Nowy test: O woła confirm-transaction i cancel-transaction na legu P niezaakceptowanej propozycji po Terminie → 409, a rzecz P zostaje u P. Anulowanie legu przez samego P nadal działa (odblokowanie). Pełne `uv run pytest` zielone. | Krytyczny (przed MVP albo jako Krok 0.1) | 1–2 h |
| 2 | Retry „Oddaję”: przy istniejącym aktywnym RETURN wznowić confirm/fulfill zamiast tworzyć nowy (FE, `balance.reservation_id`), albo jeden endpoint BE. | Test FE: po błędzie fulfill ponowne „Oddaję” kończy zwrot. | Wysoki | 1–2 h |
| 3 | Wpisać Q-1 (jednostronne potwierdzenie) do ADR-008/010 jako znane ryzyko do rozwiązania w Loan MVP. | Wpis w ADR. | Średni | 15 min |
| 4 | (Opcjonalnie) Zaproponować standard: „każdy use case przyjmujący `reservation_id` od klienta weryfikuje typ i stan rezerwacji (RETURN, niesparowany SWAP), a nie tylko uczestnictwo”. | Wpis w `standards/backend/security.md` po akceptacji. | Niski | 15 min |

## 6. Decyzja wdrożeniowa

**GO dla Kroku 0** (pre-prod, zakres spec w pełni dostarczony i zweryfikowany: BE 413/413, FE 290 + 4 znane, tsc czysty). **NO-GO dla ogłoszenia, że luki kradzieży są zamknięte**, dopóki nie wejdzie punkt 1 planu (K-1). Poprawka jest mała i warto ją dołączyć do tego samego commitu albo zrobić zaraz po nim.
