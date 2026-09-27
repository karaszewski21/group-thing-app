# Pragmatic review: Krok 0, poprawki bezpieczeństwa wypożyczeń

*(Raport zwrócony przez `code-quality-pragmatist`. Zapisał go orkiestrator, bo subagent nie tworzy plików.)*

**Status: ✅ złożoność odpowiednia, drobne uwagi.** Krytyczne: 0 · Wysokie: 0 · Średnie: 3 · Niskie: 6

Zmiana w sumie **upraszcza** kod. Usunięte zostały:
- `create_swap` razem z `/swap`, schematem i bridge (około 120 linii);
- `term_id` z body oraz `ConfirmTransactionRequest` i `CancelTransactionRequest`;
- we frontendzie `lenderUserId` i `cancelReservation`.

Skan to teraz jedno zapytanie po `term_id`. Nie ma nowej infrastruktury ani spekulatywnych abstrakcji. Migracja 0040 jest minimalna.

## Średnie
- **M1. Zdublowane testy.** `test_lend_step0_fixes.py` (bramka TDD) pokrywa się z testami dopisanymi w plikach tematycznych:
  - `rawCancelReturn` ↔ `test_circulation.py:927`;
  - `rawCreateReservation_stranger` ↔ `test_circulation.py:715`;
  - `confirmTransaction_onReturn` ↔ `test_term_item_listings_router.py:629/787`;
  - `listMyInventoryItems_lentItem` ↔ `:807`;
  - `scan_confirmedPledgeLend` ↔ `test_term_end_scan.py:436`.

  Każda zmiana kontraktu wymaga więc poprawki w dwóch miejscach, a suite zwalnia. Propozycja: usunąć 5 duplikatów albo przenieść unikalne testy do plików tematycznych. Zysk około −150 linii, nakład około 40 min.
- **M2. Przegadane docstringi z odwołaniami do dokumentów zadania** („spec.md Bug #4”, „gap analysis”, B6/B7…), wbrew `commenting.md`:
  - `_resolve_transaction_reservations_for_action` ma około 35 linii;
  - `require_raw_route_reservation_type` ma 5 linii nad 2 liniami kodu;
  - `CreateReturnReservationRequest`, docstring modułu `router.py`, docstringi repozytorium opisujące SQL;
  - „older notifications” w `PendingConfirmAction`;
  - „name predates LEND coverage” w `GiveawayTermEndMarker`.

  Zysk około −60 linii, nakład około 25 min.
- **M3. `confirmPendingAction` (`PanelDataContext.tsx` ok. l.813–835).** Guard i wyliczanie `reservationId` sprawdzają `termId`/`profile` dwukrotnie, a guard używa `account_user_id` zamiast `party_id`. Propozycja: jeden `canResolve` i `??`, a w komentarzu „SWAP” zamiast „older notifications”. Nakład 10 min.

## Niskie
- **L1.** Reguła `require_raw_route_reservation_type` jest w domenie i w fasadzie, choć stosuje ją tylko router, a trasy są przejściowe. Prywatny helper w routerze byłby prostszy. Opcjonalne.
- **L2.** `reservation_type` w `CreateReturnReservationRequest` istnieje tylko po to, żeby je odrzucić. `Literal[RETURN]` dałby 400 zamiast 403, ale spec wymaga 403, więc decyzja należy do zespołu. FE wysyła wartość domyślną bez potrzeby.
- **L3.** Router czyta rezerwację dwukrotnie (confirm/cancel/fulfill). Akceptowalne.
- **L4.** Guardy „lent” w `setItemMode`/`handleDeleteItem` działają tylko we frontendzie. Backend nie sprawdza `home_inventory_id` przy preferencji ani przy usuwaniu. Komentarz „Defense-in-depth…” stoi nad inną linią niż ta, której dotyczy. `handleDeleteItem` wraca po cichu, bez toasta. **Do przeglądu bezpieczeństwa.**
- **L5.** Długa nazwa `list_owned_items_including_lent_with_product_name`. Kosmetyka.
- **L6.** Drobiazgi:
  - `lentBadgeLabel` przy `lent_to_display_name === null` wyświetla „Pożyczone: ” z pustym miejscem;
  - 11 błędów E501 w `test_lend_step0_fixes.py`;
  - test `/swap` akceptuje `in (404, 405)`, lepiej przypiąć jedną wartość.

## Zgodność z wymaganiami
B6/B2-lite, B7, B10, B12, R5 i R7 są zgodne ze spec. Bez funkcji spoza zakresu. Jedyny rozjazd: `/swap` zwraca 404/405 zamiast 403 (spec wyżej). Rozstrzygnięcie audytu m-6 już to przewiduje, więc do poprawy jest tekst kontraktu w spec, nie kod.

## Top 3 uproszczenia
1. Deduplikacja testów (M1).
2. Skrócenie docstringów (M2).
3. Uproszczenie `confirmPendingAction` (M3).

Łączny nakład około 1,5 h. Nic nie blokuje.
