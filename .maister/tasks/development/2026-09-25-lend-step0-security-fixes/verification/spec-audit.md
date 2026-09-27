# Audyt specyfikacji — Krok 0 wypożyczeń (B6 + B2-lite, B7, B10, B12)

**Audytowany dokument:** `implementation/spec.md`
**Data:** 2026-09-25
**Metoda:** niezależna weryfikacja w kodzie (`src/backend/app`, `src/backend/tests`, `src/frontend/src`), porównanie z `analysis/requirements.md` (R1–R20), `clarifications.md`, `scope-clarifications.md`, `gap-analysis.md`, `design-context/`, `tdd-red-gate.md`, ADR-008/ADR-010 oraz z plikiem `tests/test_lend_step0_fixes.py`.

## Werdykt

**PASS WITH CONCERNS** (⚠️ w większości zgodna)

Specyfikacja jest spójna z decyzjami C1–C3 i z bramką gap analysis. Pokrywa R1–R20 i jest implementowalna. Po prześledzeniu każdego z 13 testów TDD nie widać sprzeczności: przy zakresie opisanym w spec wszystkie 13 mogą przejść bez zmiany asercji. Reguły tylko w routerze (R4) nie zmieniają semantyki wspólnych przejść używanych przez groups. Problemem jest kompletność planu zmian w testach i w typach FE oraz kilka nieścisłości faktograficznych.

| Waga | Liczba |
|---|---|
| Krytyczne | 0 |
| Główne (major) | 2 |
| Drobne (minor) | 11 |

---

## Weryfikacja obszarów wskazanych w zleceniu

### (1) Guardy tylko w routerze a wspólne przejścia (bridge): OK
- Groups woła wspólne przejścia wyłącznie przez `circulation_bridge`, z `acting_user_id` = fizyczny posiadacz albo strona:
  - `confirm_transaction`: `term_item_listings.py:754-763`;
  - `cancel_transaction`: `:784-791`;
  - `reject_swap_proposal`: `cancel_reservation` w imieniu proponującego, `:636-640`;
  - `propose_swap` i `accept_swap_proposal`: `create_reservation` + `confirm_reservation`, `:507-520` i `:586-597`;
  - `fulfill_pledge`: `create_lend_reservation` + `confirm_reservation`, `pledge_fulfillment.py:79-92`.
- R4 wprost zabrania reguł aktora i typu w `confirm/cancel/fulfill_reservation` i `create_reservation`. R5 zmienia tylko gałąź RETURN w `cancel_reservation`, a żaden z powyższych przepływów nie anuluje RETURN (reject anuluje leg SWAP). Semantyka zostaje zachowana.
- Reguła typu w routerze (`service.get_reservation` → reguła → przejście) jest poprawna. Router w `circulation/router.py:199-223` ma już `acting_user_id` z principala.

### (2) Strażnik `home_inventory_id IS NULL` (R7): OK, bez łamania legalnych ścieżek
- Take LEND/GIFT wymaga `AVAILABLE` (`term_item_listings.py:402-404`). Rzecz pożyczona ma `LENT`, więc strażnik nie zadziała.
- Propose/accept SWAP: oferowana rzecz musi być PERSONAL i AVAILABLE (`_require_own_available_personal_item`), rzecz z listingu AVAILABLE (`:477-479`, `:571-573`).
- Pledge: rzecz PERSONAL i AVAILABLE albo świeżo zarejestrowana (`pledge_fulfillment.py:57-75`).
- Fulfil LEND w `confirm_transaction` dotyczy rzeczy z `home_inventory_id = NULL`, bo rezerwacja powstała na rzeczy AVAILABLE w PERSONAL.
- Jedyny stan, w którym strażnik zadziała, to dotychczasowy stan „AVAILABLE + home ustawione”, powstały przez stary błąd anulowania RETURN (`reservation_transitions.py:258-262`). Takie dane mogą już leżeć w lokalnej bazie (patrz m-8).

### (3) RETURN: anulowanie → LENT i zachowanie `due_date`: spójne
- Create RETURN: dziś `balance.due_date = data.expires_at`, czyli None (`reservations.py:97-99`). R6 to usuwa.
- Confirm → `IN_TRANSIT` (`reservation_transitions.py:240-242`).
- Cancel: R5 daje `LENT`, czyści `reserved_at`, a `due_date` i `lent_at` zostają.
- Fulfil RETURN czyści daty (`:293-301`).
- Cykl jest domknięty i zgodny z `test_rawCancelReturn_restoresLentAndKeepsDueDate`. `due_date` przed zwrotem pochodzi z fulfil LEND (`:292`, `expires_at or now + _DEFAULT_LEND_DAYS`), więc nie jest None.

### (4) B7, usunięcie body: w większości kompletne
- Router: `term_item_listings.py:129-130` i `:155-156` (parametr `body`). Schematy: `groups/schemas.py:632-657`. Serwis: `term_item_listings.py:657-795`.
- Macierz autoryzacji bez zmian. `cancel-transaction` łapie się na blanket row 43 (`authorization_matrix.py:160`), a `confirm-transaction` na row 62 (`:213-217`).
- Wywołania FE: `PanelDataContext.tsx:831`, `RzeczyView.tsx:146` i `:162`.
- Asercje FE: PanelPage 6 (2184/2234/2312/2399/2457/2614) i RzeczyViewCategory 2 (418/445). Liczby się zgadzają.
- Wywołania serwisu w testach: 21 (`test_term_item_listings.py`). Zgadza się.
- Testy HTTP wysyłające `{"term_id": …}` przejdą bez zmian, bo FastAPI ignoruje body bez parametru. Ich aktualizacja jest opcjonalna.
- Braki: m-3.

### (5) B10: poprawne, typowanie FE częściowo pominięte
- Zapytanie z `deleted_at IS NULL` i warunkiem OR jest poprawne. Pożyczający go nie widzi, bo `home_inventory_id` wskazuje PERSONAL właściciela.
- Właściciela VIRTUAL wyznacza `item.inventory_id` → `Inventory.owner_user_id` → `get_profile_by_account_user_id` (`users/service.py:118-129`). Pętla obejmuje tylko pożyczone rzeczy wołającego, czyli jest ograniczona.
- Typowanie FE: patrz M-2.

### (6) B12: poprawne co do testów, drobne luki
- Obecne `_scan_giveaways` pomija Termin bez uprawnionych stron albo bez preferencji (`term_end_scan.py:176-183`). Spec wymaga, żeby ścieżka rezerwacji działała niezależnie od tego (R17). Bez tego `test_scan_confirmedPledgeLend_promptsWithReservationId` by nie przeszedł, bo organizator nie ma preferencji. Warunek jest opisany, a implementer musi przenieść `continue`.
- `test_term_end_scan.py`: wszystkie scenariusze GIFT robią take na skanowanym Terminie (`:136-139`, `:174-177`, `:250-253`). Liczniki markerów się nie zmienią. Test listenera (`:264-299`) już podaje `reservation_id: 999` w payloadzie.
- GIFT CONFIRMED: legalnie nie powstaje. Take GIFT zostaje PENDING (`:421-434`), a surowe confirm będzie 403. Brak skutków.
- Warunek eligibility przestaje obowiązywać. Monit dostają strony rezerwacji niezależnie od RSVP. To zamierzone.
- Idempotencja przez `GiveawayTermEndMarker.reservation_id` (unique, `groups/models.py:393`) i jeden commit (`:188`). OK.
- Okno Pledge-LEND: rezerwacja CONFIRMED już od `fulfill_pledge`, więc łapie ją pierwszy skan po wejściu Terminu w okno 24 h. Pledge zrealizowany ponad 24 h po Terminie jest świadomie poza zakresem (`scope-clarifications.md`, b12-out-of-scope).
- Handler (`outbox_listener.py:74-86`) ma przekazać `payload["reservation_id"]`. Klucz jest już w payloadzie (`term_end_scan.py:122`).
- Migracja 0040 wzorem 0038: 0039 jest obecnym head (`alembic/versions/0039_reservation_giver_user_id.py`). Downgrade bez `DELETE` jest poprawny, bo nie ma nowego enuma, w odróżnieniu od 0038, które go usuwało.

### (7) Fallback modala FE: poprawny, niedookreślony w jednym miejscu
- Logika z R19 jest zgodna z mockupem `#pending-actions-modal-states`. Nie ma jednak mowy o zmianie sygnatury `confirmPendingAction(notificationId, termId)` (`PanelDataContext.tsx:811`) ani o jej miejscu wywołania w modalu (`:1582`). Patrz m-4.

### (8) Plan testów: niekompletny
- Patrz M-1 i m-1.

### (9) Minimal implementation: drobne
- Patrz m-6 i m-7. Nie widać nadmiarowej abstrakcji: nie powstają nowe komponenty, zdarzenia ani markery. Pole `reservation_type` w `CreateReturnReservationRequest` jest uzasadnione i zaakceptowane przez użytkownika.

---

## Problemy główne (major)

### M-1. Lista testów BE do przepisania pomija testy, które złamie B6
**Kategoria:** Incomplete. **Spec:** „Testy do przepisania lub aktualizacji (BE)”, wiersz `tests/test_circulation.py`.

**Dowód:**
- `tests/test_circulation.py:816-838`, `test_createReservation_returnWithLentBalanceButNoFulfilledLend_raisesBusinessConflict`:
  - test wymusza `LENT` na rzeczy właściciela z `home_inventory_id = NULL` i woła surowy RETURN jako właściciel;
  - po zmianie (R2, „rzecz niepożyczona → 403”) dostanie **403 zamiast 409**;
  - pokrycie ścieżki `_resolve_return_term_id` → 409 zniknie, jeśli test nie przejdzie na poziom serwisu.
  - Spec wymienia analogiczny `returnWithNoPriorLend` (800), ale pomija ten.
- `tests/test_circulation.py:841` (`test_migration0034_backfillsLegacyNullTermIdRows_withoutError`) używa `_lend_and_confirm` (`:860`). Nie ma go na liście użytkowników helpera (287, 325, 378, 405, 470, 762). Łapie się tylko ogólnym sformułowaniem „i jego użytkownicy”.

**Skutek:** pełna bramka `uv run pytest` i tak to wychwyci, ale spec obiecuje enumerację, a implementer planujący grupy zadań po liście nie przewidzi tych zmian. Test 816 dodatkowo traci intencję (ochronę przed `term_id = NULL`), jeśli ktoś „naprawi” go zmianą asercji na 403.

**Rekomendacja:** dopisać 816 (przenieść na wywołanie serwisu `create_reservation` z typem RETURN, asercja 409 zostaje) i 841 (przepisać setup na serwis albo flow groups).

### M-2. Przetypowanie `items` na `MyInventoryItemResponse[]` łamie `tsc -b` w fixture'ach testów FE, a spec nie ma bramki typów
**Kategoria:** Incomplete. **Spec:** R16 („stan `items` typowany jako `MyInventoryItemResponse[]`”), „Technical Approach / B10 FE” (nowe wymagane pola `lent_to_display_name`, `lent_due_date`), „Testing Approach”.

**Dowód:**
- `src/frontend/tsconfig.app.json`: `"include": ["src"]`, więc testy w `src/test` są typowane. `package.json:8`: `"build": "tsc -b && …"`.
- `src/test/RzeczyViewCategory.test.tsx:131`: `const item: InventoryItemResponse = {…}` jest podawany jako `items` do zamockowanego `usePanelData`. Po przetypowaniu brakuje w nim `listing_mode` i pól `lent_*`.
- `src/test/PanelPage.test.tsx:1725-1735` i `:2551`: `invItem` w `getMyInventoryItems.mockResolvedValue([invItem])` nie ma nowych pól. `mockResolvedValue` jest typowane typem zwracanym przez `getMyInventoryItems`.
- Kryteria sukcesu w spec (1–9) i „Testing Approach” wymieniają tylko `vitest run` (który nie sprawdza typów) oraz `pytest`. Nie ma `tsc -b`, `npm run build` ani `npm run lint`.

**Skutek:** wszystkie testy przejdą, a build FE się wysypie. Błąd wyjdzie dopiero przy buildzie albo w CI.

**Rekomendacja:**
- dodać do planu aktualizację fixture'ów (`listing_mode`, `lent_to_display_name: null`, `lent_due_date: null`);
- dodać do Success Criteria bramkę `npx tsc -b` (albo `npm run build`) i `npm run lint` w `src/frontend`.

---

## Problemy drobne (minor)

| # | Problem | Dowód | Rekomendacja |
|---|---|---|---|
| m-1 | Twierdzenie, że `test_term_item_listings_router.py:160,186` ma „dokładne porównania dictów” wymagające dopisania pól `None`, jest nieprawdziwe. Linia 186 porównuje mapę `id → listing_mode`, a 187 zbiór `product_name`. Nie ma pełnej równości wierszy. Linia 160 należy do innego testu. Zmiana jest zbędna. | `test_term_item_listings_router.py:183-201` | Usunąć ten punkt z planu, żeby nie sugerował pracy do wykonania. |
| m-2 | „`test_term_item_listings.py` 1914 i 1941 (surowe `/confirm`)”: linia 1914 to definicja testu `test_getItemBalance_inTransitStatus_stillReportsSameReservationId`, a jedyne surowe `/confirm` jest w 1941. Intencją testu jest stan `IN_TRANSIT` balance, więc po B6 potrzebne jest przejście przez `service.confirm_reservation` / `bridge`, a nie asercja 403. | `test_term_item_listings.py:1912-1950` | Doprecyzować: jeden test, confirm przez warstwę serwisu. Asercja 403 zgubiłaby intencję. |
| m-3 | R10/R12 nie wspominają nieaktualnego docstringu bridge'a „the future `confirm_transaction` use case (Group 3)”. Nie wymieniają też, że `RzeczyView.handleConfirmReceipt`/`handleCancelTransaction` robią `return`, gdy brak `termId` (`:141-142`, `:157-158`). Po B7 ten warunek jest zbędny, ale `reservationTermInfo` nadal jest potrzebne dla `termHasEnded`. | `circulation_bridge.py:145-149`; `RzeczyView.tsx:139-169` | Dopisać: warunek tylko na `reservationId`, a `termHasEnded` zostaje. |
| m-4 | R19 nie określa zmiany sygnatury `confirmPendingAction(notificationId, termId)` (np. przyjęcie całej `PendingConfirmAction` albo dodatkowego `reservationId`) ani aktualizacji wywołania w `GlobalPendingActionsModal`. | `PanelDataContext.tsx:811`, `:1582` | Dopisać docelową sygnaturę i miejsce wywołania. |
| m-5 | Nazwy i trasy niezgodne z kodem: typ FE to `NotificationResponse`, nie `Notification`; endpoint to `GET /api/notifications/mine`, nie `GET /api/notifications`; istniejące zapytanie obsługuje `GET /api/inventory-items?inventory_id=`, nie `GET /api/inventories/{id}/items`; błąd walidacji w tej aplikacji to 400, nie 422 (spec pisze „403 … a nie 422”). | `api/notifications.ts:18`; `notifications/router.py:29`; `circulation/router.py:111-116`; `test_circulation.py:731-735` | Poprawić odwołania. |
| m-6 | Martwy kod po B6/B10, o którym spec nie mówi, a nawet błędnie uzasadnia jego pozostawienie („`CreateSwapRequest` używany przez `service.create_swap`”). Po zamknięciu `/swap` ani `service.create_swap`, ani `circulation_bridge.create_swap` nie mają wywołujących, bo groups tworzy legi SWAP przez `create_reservation`. Po B10 `circulation_bridge.list_items_with_product_name` traci jedynego wywołującego. W FE `createSwap`/`CreateSwapRequest`, `cancelReservation` są nieużywane. | grep: `create_swap` wołane tylko z `circulation/router.py:179`; `circulation_bridge.py:100-122`, `:189-192`; `api/reservations.ts:34-40`, `:54-56`, `:62-64` | Albo usunąć (zgodnie z `minimal-implementation.md`), albo jawnie odłożyć do MVP (ADR-010) i poprawić uzasadnienie. |
| m-7 | `create_swap` (wspólny) nie dostaje strażnika R7, choć spec deklaruje niezmiennik „dla typów innych niż RETURN”. Dziś to kod martwy (m-6), więc ryzyka nie ma, ale reguła jest niespójna. | `reservations.py:121-166` | Usunąć `create_swap` (m-6) albo objąć go R7. |
| m-8 | Lokalna baza może zawierać wiersze „AVAILABLE + `home_inventory_id` ustawione” (skutek starego B2). Po R7 take/propose na takiej rzeczy da 409, a rzecz wypadnie z `/mine` odbiorcy albo pojawi się u właściciela z badge'em. Pre-prod, bez shimów, ale spec tego nie odnotowuje. | `reservation_transitions.py:258-262` (obecne zachowanie) | Dopisać w Założeniach, że dane dev mogą wymagać ręcznego czyszczenia. |
| m-9 | Kolejność w R9 (RETURN guard i bramka Terminu przed `_require_race_participant`) pozwala nie-uczestnikowi z EDIT odróżnić RETURN i „Termin nie minął” (409) od 403. Bramka Terminu przed uczestnikiem jest już dziś (`term_item_listings.py:689-701`), ale RETURN guard dochodzi nowy. Wyciek informacji jest znikomy. | `term_item_listings.py:689-701` | Rozważyć kolejność load → participant → RETURN → Termin. Test TDD na RETURN przechodzi w obu wariantach, bo właściciel jest uczestnikiem. |
| m-10 | Skan: dla każdego kandydata wołane jest `get_profile_by_account_user_id` dla dwóch stron. Rzuca `EntityNotFoundException` (`users/service.py:127-128`), a jeden commit na końcu (`term_end_scan.py:188`) sprawia, że jeden wadliwy wiersz blokuje cały skan przy każdym uruchomieniu. Dotyczy to już dziś strony biorącej, a spec dokłada stronę `giver`. Realne ryzyko jest niskie, bo merge dotyczy tylko profili bez konta. | `term_end_scan.py:115`; `users/service.py:118-129`; `groups/application/account_merge.py:34-51` | Opcjonalnie odnotować w Ryzykach. Obsługa nie jest wymagana w kroku 0. |
| m-11 | Nowe zapytanie po `Reservation.term_id IN (...)` i zapytanie B10 po `home_inventory_id` nie mają indeksów (brak `create_index` na `reservations.term_id` w migracjach). `queries.md` mówi o „strategic indexing”. Przy skali pre-prod bez znaczenia. | `alembic/versions/*`: brak indeksu na `reservations.term_id` | Odnotować decyzję „bez indeksu” albo dodać indeks w 0040. Ta druga opcja zwiększa zakres, więc raczej tylko odnotować. |

---

## Zgodność z testami TDD (`tests/test_lend_step0_fixes.py`)

Każdy test prześledzony względem spec:

| Test | Spełnia go | Uwagi |
|---|---|---|
| `rawCreateReservation_strangerLocks…_returns403` | R1 (typ LEND → 403 w routerze) | — |
| `rawCreateReturn_forSomeoneElsesLoan_returns403` | R2 (aktor ≠ posiadacz) | — |
| `rawCreateReturn_reservedByAlwaysHomeOwner…` | R2 (`resolve_owning_inventory`) | body `reserved_by_user_id` ignorowane (`extra=ignore`) |
| `rawConfirm_lendBeforeTermEnd_returns403` | R1 (reguła typu przed przejściem) | — |
| `rawCancelReturn_restoresLentAndKeepsDueDate` | R5 + R6 | `due_date` z fulfil LEND ≠ None |
| `rawGiftToSelf_afterCancelledReturn_isRejected` | `reservation_type` w `CreateReturnReservationRequest` + R1 | odstępstwo zaakceptowane przez użytkownika |
| `confirmTransaction_otherPastTermId…_returns409` | R9 | body ignorowane |
| `confirmTransaction_onReturnReservation_returns409` | R11 | — |
| `listMyInventoryItems_lentItem_…` | R13 + R14 | — |
| `listMyInventoryItems_notLentItem_hasNullLentFields` | R14 | — |
| `scan_pendingLendPastTermEnd_…` | R17 + R18 | izolacja testów przez rollback (`conftest.py:67-81`) |
| `scan_confirmedPledgeLend_…` | R17 (niezależność od preferencji) | patrz (6) |
| `scan_returnReservation_isNotPrompted` | R17 (bez RETURN) | — |

Nie znaleziono sprzeczności. `_lent_item` wysyła `json={"term_id": …}` do `confirm-transaction`, co po R10 jest bezpiecznie ignorowane.

---

## Pytania do doprecyzowania
1. **M-2:** czy `lent_to_display_name` i `lent_due_date` w `MyInventoryItemResponse` (FE) mają być wymagane (`string | null`), co wymaga aktualizacji fixture'ów, czy opcjonalne (`?:`)? Rekomendacja: wymagane, zgodnie z kontraktem BE, i aktualizacja fixture'ów.
2. **m-6:** usuwamy martwy `create_swap` (service, bridge, FE) w kroku 0 czy świadomie zostawiamy do MVP?
3. **m-2:** czy test z `test_term_item_listings.py:1912` ma zachować intencję `IN_TRANSIT` przez warstwę serwisu? Rekomendacja: tak.
4. **m-9:** czy zmienić kolejność kroków w R9 tak, żeby autoryzacja uczestnika była przed RETURN guardem?

## Rekomendacje (kolejność)
1. Uzupełnić listę testów BE o `test_circulation.py:816` i `:841` (M-1).
2. Dodać do planu FE aktualizację fixture'ów i bramkę `tsc -b` + `lint` w Success Criteria (M-2).
3. Doprecyzować sygnaturę `confirmPendingAction` i miejsce wywołania w modalu (m-4) oraz uproszczenie handlerów w RzeczyView (m-3).
4. Poprawić nieścisłości faktograficzne (m-1, m-2, m-5).
5. Podjąć decyzję w sprawie martwego kodu `create_swap` i `list_items_with_product_name` (m-6, m-7).
