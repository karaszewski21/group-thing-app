# Synteza — cykl życia wypożyczenia (LEND) po przekazaniu rzeczy

Data: 2026-09-25 · Typ: mixed (technical + requirements + literature) · Źródła: 4 pliki findings
(`codebase-backend`, `codebase-frontend`, `docs`, `external`) + brief + plan. Ścieżki backendu
względne do `src/backend/`, frontendu do `src/frontend/src/`. Kluczowe twierdzenia z kodu
(RETURN, cancel, fulfil, `confirm_transaction`, `term_end_scan`, reguły potwierdzania)
zweryfikowałem dodatkowo bezpośrednim odczytem kodu w HEAD `acd3b4c`.

---

## 1. Pytanie badawcze

Jak zaprojektować wypożyczenie (LEND) w aplikacji Krąg/Termin, obejmując cały cykl życia **po**
przekazaniu rzeczy: wirtualny magazyn pożyczającego, chęć zwrotu, żądanie zwrotu przez
właściciela, przedłużenie, termin zwrotu i przypomnienia, zaległość, potwierdzenie odbioru przez
właściciela, spory (nieoddane / uszkodzone / zgubione) i anulowanie? Projekt ma pasować do
istniejącego podziału DDD `app.circulation` ↔ `app.groups`.

## 2. Streszczenie

Kod ma szkielet wypożyczenia. Są typy `LEND`/`RETURN`, status `LENT`, magazyn `VIRTUAL`
z `home_inventory_id`, domyślne 14 dni i punkty w ledgerze. Działa jednak tylko **pierwsza połowa**
cyklu: oferta, wzięcie, potwierdzenie po Terminie i przeniesienie do magazynu VIRTUAL. Druga
połowa sprowadza się do jednego przycisku „Oddaję”. Pożyczający sam tworzy RETURN, sam go
potwierdza i sam go realizuje, a właściciel nie uczestniczy. Tego wprost zabraniają wcześniejsze
decyzje projektu (T14 „no shortcuts”, T16 odrzucenie auto-confirm), dokument referencyjny INV
(„zawsze pending → confirmed”) oraz wszystkie zbadane platformy zewnętrzne, w których wypożyczenie
zamyka właściciel lub obsługa.

Znalazłem też kilka błędów, które trzeba naprawić niezależnie od nowej funkcji:

- anulowanie RETURN psuje stan (balance `AVAILABLE`, a rzecz dalej leży w VIRTUAL);
- `due_date` jest nadpisywany i nigdzie nie jest egzekwowany;
- surowe endpointy `/api/reservations*` przyjmują `reserved_by_user_id` z body;
- `confirm-transaction` nie sprawdza, czy `term_id` z body zgadza się z rezerwacją;
- właściciel traci z widoku wypożyczoną rzecz;
- skan końca Terminu pomija LEND, więc pożyczający nie dostaje monitu o potwierdzenie przekazania.

Najważniejszy wniosek projektowy: wybór **gdzie fizycznie „leży” rzecz** (VIRTUAL czy magazyn
właściciela z polem holder) jest **ortogonalny** do właściwego problemu, czyli **gdzie żyje stan
cyklu życia pożyczki**. Dziś ten stan jest rozsmarowany na parę rezerwacji LEND/RETURN i jeden
nadpisywany wiersz `InventoryBalance`. Nie ma w nim historii, powiązania LEND↔RETURN ani miejsca
na przedłużenie, żądanie zwrotu czy spór. To jest decyzja nr 1, a o magazynie decyzja nr 2.

## 3. Analiza krzyżowa (cross-reference)

### 3.1 Potwierdzone przez wiele źródeł

| # | Ustalenie | Źródła | Pewność |
|---|---|---|---|
| X1 | RETURN wykonuje pożyczający sam, jednym kliknięciem (create + confirm + fulfil). Właściciel nie potwierdza odbioru. Pożyczający dostaje +1 pkt od razu. | BE `reservation_rules.py:13-31`, `reservation_transitions.py:85-136`, test `test_circulation.py:325-379`. FE `PanelDataContext.tsx:1354-1380`. Docs D4 (sprzeczne z INV:479 i T14). Zweryfikowane w kodzie. | Wysoka |
| X2 | Właściciel nie widzi wypożyczonej rzeczy w „Moje rzeczy”, bo `/api/inventory-items/mine` filtruje po bieżącym `inventory_id` = PERSONAL. | BE `term_item_listings.py:137-168`, `repository.py:74-91`. FE §0 i §2. | Wysoka |
| X3 | `term_id` dla RETURN pochodzi z ostatniego FULFILLED LEND, czyli z Terminu, który już minął. Zwrot nie jest więc związany z żadnym przyszłym Terminem, a bramka „po Terminie” przechodzi zawsze. | BE `reservations.py:26-46`. Docs T20 `spec.md:82`. | Wysoka |
| X4 | Anulowanie RETURN ustawia balance `AVAILABLE` i czyści `due_date`, choć rzecz zostaje w VIRTUAL z ustawionym `home_inventory_id`. | BE `reservation_transitions.py:65-82` (zweryfikowane). Brak testu. | Wysoka (analiza kodu, nie wykonana) |
| X5 | `due_date` jest nadpisywany wartością `expires_at` (None) przy tworzeniu **każdej** rezerwacji, także RETURN. Nie czyta go żadna logika. | BE `reservations.py:97-99` (zweryfikowane). Docs INV §1.6-2: `dueDate` ma dwa znaczenia, co tłumaczy pochodzenie błędu. | Wysoka |
| X6 | Surowe `/api/reservations*` omijają reguły groups. `reserved_by_user_id` pochodzi z body. | BE `router.py:161-223`, `reservations.py:84-87` (zweryfikowane). FE używa ich w `returnBorrowedItem`. | Wysoka |
| X7 | `confirm_transaction` pobiera `term` z body i rezerwację osobno, bez sprawdzenia `reservation.term_id == term_id`. | BE `term_item_listings.py:687-702` (zweryfikowane). | Wysoka |
| X8 | Pledge→LEND do organizatora nie ma własnej ścieżki zwrotu. Deklarujący widzi tylko „Zrealizowane ✓”. | BE `pledge_fulfillment.py:30-122`. FE `HomeView.tsx:193-236`. Docs R02: gift czy lend to „osobna decyzja produktowa”. | Wysoka (UI organizatora: średnia) |
| X9 | `BalanceStatus.RETURNED` nie jest nigdzie przypisywany. | BE grep. Docs INV:237-245, 512. | Wysoka |
| X10 | INV mówi, że przy LEND magazyn właściciela się nie zmienia. Kod przenosi rzecz do VIRTUAL. Odstępstwa nigdy nie zapisano jako decyzji (WIP „leave untouched”). | Docs D1 (INV:207-213, 505; T16). BE `reservation_transitions.py:100-108`. | Wysoka |
| X11 | Punkty: właściciel dostaje +1 przy LEND, oddający +1 przy RETURN. Nie ma storna. | BE `ledger.py:62-98`. Docs INV:248, 487. | Wysoka |
| X12 | Skan końca Terminu obsługuje tylko GIFT i SWAP. Dla LEND nie ma `TERM_CONFIRMATION_NEEDED`. | BE `term_end_scan.py:66-166` (zweryfikowane: filtr GIFT, linie 72 i 88). Docstring `notifications/models.py:41` mówi „swap or giveaway”. **Sprzeczność** z T17 `spec.md:78` (GIFT/LEND/SWAP). | Wysoka |

### 3.2 Sprzeczności i ich rozstrzygnięcie

- **T17 kontra kod (TERM_CONFIRMATION_NEEDED dla LEND).** FE (`resolvePendingReservationId`,
  `PanelDataContext.tsx:194-230`) obsługuje LEND. Backend jednak nigdy nie wysyła powiadomienia
  dla LEND, więc modal po Terminie w praktyce **nie pojawia się** przy LEND. Właściciel ma
  zapasowy kafelek „Odebrał” (`RzeczyView.tsx:350-369`), a pożyczający **nie ma żadnego monitu**.
  Rozstrzygnięcie: kod jest źródłem prawdy, T17 opisuje intencję niezrealizowaną dla LEND. Wniosek
  nowy, wynika dopiero z zestawienia FE z BE.
- **T17 „ownership transfer” przy LEND** (docs D8). Kod przy LEND nie przenosi własności: ustawia
  VIRTUAL i `home_inventory_id`, a `resolve_owning_inventory` (`inventory_items.py:117-125`)
  zwraca dom. Rozstrzygnięcie: błędne sformułowanie w dokumentacji.
- **IN_TRANSIT w przepływie Terminu** (docs D3). W `confirm_transaction` confirm i fulfil
  wykonują się w jednym wywołaniu, więc IN_TRANSIT trwa tylko chwilę. Przy Pledge-LEND
  (auto-confirm) rzecz zostaje w IN_TRANSIT aż do surowego `/fulfill`. Rozstrzygnięte.
- **`reservation_id` w balance dla LENT** (docs, pytanie otwarte T20).
  `get_active_reservation_id_for_item` zwraca null dla LENT (`inventory_items.py:97-114`). FE
  podczas pożyczki nie ma więc id LEND. Rozstrzygnięte: pole nie jest wypełniane.
- **Podnajem / ponowne wystawienie przez pożyczającego** (docs T14). Wystawić może tylko właściciel
  wyznaczony przez `resolve_owning_inventory`, czyli dom, a nie VIRTUAL, i tylko z PERSONAL.
  Pożyczający nie może więc wystawić pożyczonej rzeczy. Pewność średnio-wysoka (brak osobnego
  testu).
- **„RETURN nie jest stornem” (INV) kontra „reverses a prior LEND” (T20).** To konflikt
  językowy. Oba źródła zgadzają się, że RETURN to osobna rezerwacja z osobnym wpisem w ledgerze.
- **Standard „derived-not-stored”.** Brief go wymienia, ale nie ma go w `.maister/docs/standards`.
  Istnieje tylko jako precedens (T14: status oferty jest wyliczany). Traktuję go jako praktykę
  zespołu, nie spisany standard.

### 3.3 Wnioski latentne, które uaktywni nowy projekt

Gdy RETURN przestanie być atomowy i będzie **czekać** (PENDING/CONFIRMED) na potwierdzenie
właściciela, uaktywnią się błędy, które dziś są uśpione:

1. `list_my_active_taken_term_item_listings` (`term_item_listings.py:316-340`) szuka po
   `reserved_by_user_id`. Oczekujący RETURN ma `reserved_by = właściciel`, więc właściciel
   zobaczy, że „bierze” własną rzecz.
2. Po zwrocie `_resolve_listing_status` (`:180-212`) pokazuje RETURN i właściciela jako
   „wziął” (B11).
3. `create_reservation` ustawia balance `RESERVED` przy RETURN i gubi `due_date` (X5).
4. `_require_holder_to_confirm` pozwala potwierdzić RETURN tylko pożyczającemu (holder), a
   `_require_party_to_reservation` pozwala fulfil obu stronom. Do potwierdzenia przez właściciela
   trzeba reguły per typ.

**Obserwacja, która upraszcza projekt.** Istniejący potok ma trzy kroki i już pasuje do zwrotu
dwustronnego:

- create RETURN, inicjowane przez pożyczającego, to „chcę oddać”;
- confirm, wykonywane przez holdera (pożyczającego), to „przekazuję / oddałem”;
- fulfil to „odebrałem”.

Wystarczy ograniczyć fulfil RETURN do `reserved_by` (właściciela) i przestać wołać fulfil
z frontendu. Ledger nadal przypisze punkt pożyczającemu, bo holder jest wyliczany przed
przeniesieniem rzeczy (`reservation_transitions.py:93`, `:128-132`).

## 4. Wzorce i motywy

| Wzorzec | Opis | Dowody | Rozpowszechnienie | Ocena |
|---|---|---|---|---|
| P1: Rezerwacja jako „koszyk” przed każdą zmianą posiadania | pending → confirmed → fulfilled, transakcja dopiero przy fulfil | INV:33, `reservation_transitions.py:85-89` | Wszystkie typy | Dojrzały. RETURN go omija (FE). |
| P2: Pierwszy potwierdzający wygrywa, dopiero po Terminie | Obie strony, bramka `occurs_on <= now`, marker idempotencji | T16, `term_item_listings.py:680-767` | GIFT/SWAP/LEND (przekazanie) | Dojrzały, ale nie obejmuje zwrotu. |
| P3: Skan czasowy + outbox + marker idempotencji | APScheduler co 1 min, `GiveawayTermEndMarker` | `main.py:46-73`, `term_end_scan.py` | GIFT/SWAP | Gotowy precedens dla przypomnień i zaległości. |
| P4: Stan wyliczany zamiast przechowywanego | Status oferty wyliczany. Zaległość w ILS wyliczana z due_date. | T14 `spec.md:108`; Koha, Lend Engine, myTurn | Częsty | Zastosować do „po terminie”. |
| P5: Lokalizacja przez magazyn | VIRTUAL + `home_inventory_id`, holder wyliczany z magazynu | `models.py:159-168`, `reservations.py:49-57` | LEND | Działa, ale każde zapytanie po stronie właściciela musi uwzględniać `home_inventory_id` (dziś nie uwzględnia). |
| P6: Stan per rzecz, nadpisywany | `InventoryBalance` 1:1 z rzeczą, daty nadpisywane w każdym cyklu | `models.py:171-188` | Wszystkie | Niewystarczający dla pożyczki (brak historii i powiązań). |
| P7: Tylko in-app, modal globalny | Kanał tylko in-app, akcje po Terminie w modalu | T16 `requirements.md:212-223,275-276` | Wszystkie | Zachować. |
| P8 (zewn.): Wypożyczenie zamyka właściciel lub obsługa | Hygglo „rental ends when the lender confirms”, check-in w bibliotekach, Sharetribe provider marks returned | external C2.1, C1, C4.1 | Wszystkie zbadane systemy z obsługą zwrotu | Silny, przyjąć. |
| P9 (zewn.): Łagodna, bezgotówkowa eskalacja | Przypomnienie dzień wcześniej, potem cyklicznie, blokada bez kar (Berkeley) | myTurn, Lend Engine, Berkeley | Częsty | Przyjąć wariant łagodny. |
| P10 (zewn.): „Claimed returned” jako lekki stan sporu | Rzecz zostaje przypisana do pożyczającego do czasu rozstrzygnięcia | Koha | ILS | Zaadaptować jako DISPUTED. |
| P11 (zewn.): Recall skraca termin | Koha Recall | Koha | ILS | Zaadaptować jako „Poproś o zwrot”. |
| P12 (zewn.): Przedłużenie z ograniczeniami | Limit liczby, blokada przy kolejce lub zaległości | LoT, Leila, Berkeley, Koha | Częsty | Zaadaptować jako prośbę z akceptacją właściciela (brak obsługi). |

**Motywy przekrojowe.** Pierwsza połowa cyklu (przekazanie) jest dojrzała i spójna z GIFT/SWAP.
Druga połowa (zwrot) jest ad hoc: to WIP z T16, nigdy niespecyfikowany. Dokumentacja jest
nieaktualna w kilku miejscach: `architecture.md` pomija circulation i groups, `security.md` podaje
złą ścieżkę do `AUTHORIZATION_MATRIX`, INV nie zna VIRTUAL.

## 5. Kluczowe wnioski (insights)

1. **I1. Luka nie leży w magazynie, tylko w nośniku stanu pożyczki.** Każde nowe zdarzenie
   (przedłużenie, żądanie zwrotu, spór, przypomnienia idempotentne per pożyczka, historia)
   potrzebuje trwałego rekordu „jednej pożyczki”, powiązanego z LEND i RETURN. Dziś tę rolę pełni
   heurystyka „najnowszy FULFILLED LEND” (`reservations.py:26-46`). Pewność wysoka.
2. **I2. Zwrot dwustronny da się zrobić niemal bez nowych mechanizmów** (§3.3): zmienić regułę
   fulfil dla RETURN i przepisać przycisk FE. Pewność wysoka.
3. **I3. Model VIRTUAL jest poprawny, ale nieobsłużony po stronie właściciela.** Kod VIRTUAL daje
   naturalnego holdera (reguły potwierdzania, ledger, blokadę podnajmu). Brakuje odpowiednika
   zapytania „moje rzeczy, łącznie z pożyczonymi” (`home_inventory_id = personal.id`). Alternatywa
   z INV (rzecz zostaje u właściciela, dochodzi pole `holder_user_id`) jest koncepcyjnie prostsza
   dla właściciela. Wymagałaby jednak przepisania wyliczania holdera, reguł potwierdzania, ledgera,
   widoku „Wypożyczone” i migracji 0030. Pewność średnio-wysoka.
4. **I4. Termin zwrotu i przypomnienia są „martwe”.** Pole istnieje, ale jest nadpisywane,
   liczone od kliknięcia (nie od Terminu), niewidoczne dla właściciela i nieczytane przez żaden
   skan. Infrastruktura skanu (P3) jest gotowa do ponownego użycia. Pewność wysoka.
5. **I5. Spory i zgubienie odłożono świadomie** (T20 `clarifications.md:92`), więc to pierwsze
   miejsce, gdzie trzeba je zaprojektować. Zbadane społeczności bez pieniędzy (Leila, Olio,
   Buy Nothing) wybierają rozwiązania miękkie: rozmowa, zastąpienie rzeczą, spisanie. Pewność
   średnia.
6. **I6. Istniejące błędy bezpieczeństwa i integralności (X6, X7) są poważniejsze niż sama
   funkcja.** Każdy użytkownik z EDIT może zablokować cudzą rzecz albo założyć RETURN cudzej
   pożyczki. Trzeba je naprawić przed dodaniem nowych przejść. Pewność wysoka.
7. **I7. Pledge→LEND jest dziś pożyczką bez końca**, bo nikt nie jest proszony o zwrot. Ten sam
   mechanizm pożyczki rozwiązuje to naturalnie, jeśli organizator będzie traktowany jak zwykły
   pożyczający. Pewność średnia (brak decyzji R02).

## 6. Relacje i zależności

```
groups (Terminy, oferty, powiadomienia, skan)
  term_item_listings.take/confirm_transaction/cancel_transaction
  pledge_fulfillment (LEND do organizatora)
  term_end_scan (GIFT/SWAP)  -- brak LEND / RETURN / due
        │  circulation_bridge (jedyne przejście)
        ▼
circulation
  Reservation(LEND|RETURN, term_id, giver_user_id, reserved_by)
  InventoryItem(inventory_id, home_inventory_id) ── Inventory(PERSONAL|VIRTUAL)
  InventoryBalance(status, lent_at, due_date, returned_at)   [1:1, nadpisywane]
  ledger.post_circulation (holder +1)
        ▲
FE panel: RzeczyView (PERSONAL tylko) · WypozyczoneView (VIRTUAL) · GlobalPendingActionsModal
FE Term: useItemTake „Pożycz”
```

Przepływ danych dla LEND (dziś):

1. take: rezerwacja `LEND PENDING`, balance `RESERVED`.
2. Po Terminie `confirm_transaction`: `CONFIRMED`, balance `IN_TRANSIT`, potem `FULFILLED`.
   Rzecz przechodzi do VIRTUAL, `home_inventory_id` = dom, balance `LENT`, `due_date` = teraz
   + 14 dni, +1 pkt dla właściciela.
3. „Oddaję”: `RETURN` → `CONFIRMED` → `FULFILLED`. Rzecz wraca do domu, balance `AVAILABLE`,
   +1 pkt dla pożyczającego, oferta ponownie widoczna.

Punkty integracji z nowym projektem:

- `circulation_bridge`: nowe odczyty pożyczek do skanu i widoków;
- `notifications`: nowe typy `NotificationKind`;
- `outbox`: nowe zdarzenia;
- `authorization_matrix`: nowe trasy;
- FE: widoki „Pożyczone innym”, „Wypożyczone” i modal globalny.

## 7. Luki i niepewności

- Nie wiadomo, jak często odbywają się Terminy w Kręgu (co tydzień? nieregularnie?). To decyduje,
  czy termin zwrotu „do następnego Terminu” ma sens. **Pytanie do użytkownika.**
- Nie wiadomo, czy organizator Kręgu ma mieć jakąkolwiek rolę w sporach. Brak modelu uprawnień
  organizatora do cudzych pożyczek.
- Nie zweryfikowałem uruchomieniem skutków X4 (tylko analiza kodu) ani wpływu B11 na UI.
- Źródła zewnętrzne o Peerby, Fat Llama i myTurn znam tylko ze snippetów (średnia pewność).
  Wnioski o wzorcach opierają się jednak na co najmniej dwóch źródłach wysokiej pewności każdy.
- Wpływ zegarów: `due_date` jest liczony w UTC (`utcnow`), `occurs_on` to lokalny czas naiwny.
  Skan przypomnień musi to ujednolicić. Rozmiar błędu to ok. 2 h, co ma znaczenie tylko przy
  „dziś / jutro”.
- Backfill 0039 przypisuje historycznym LEND złego giver. W środowisku pre-prod to bez znaczenia,
  ale lokalne dane testowe mogą mylić przy testach ręcznych.

## 8. Synteza według frameworku (mixed)

### 8.1 Technical: komponenty, przepływy, luki
Istnieje: enumy, VIRTUAL, `home_inventory_id`, przekazanie po Terminie, ledger, widok
pożyczającego. Brakuje: zwrotu dwustronnego, żądania zwrotu, przedłużenia, przypomnień i
zaległości, sporu i straty, widoku właściciela, historii i powiązania pożyczki, monitu po
Terminie dla LEND. Błędy od B1 do B15 opisuje backend, a UX-owe frontend (§7 findings FE).

### 8.2 Requirements: aktorzy × zdarzenia
Aktorzy: pożyczający, właściciel, system (scheduler), opcjonalnie organizator. Potwierdzenia
dwustronne wymagane są przy przekazaniu (już jest) i przy zwrocie (brak). Jednostronne akcje
z powiadomieniem to: chęć zwrotu, żądanie zwrotu, prośba o przedłużenie, zgłoszenie problemu.
Akcje rozstrzygające należą do właściciela: potwierdzenie odbioru, zgoda na przedłużenie,
przyjęcie straty. Stan wyliczany: `overdue`, `due_soon`. Stan przechowywany: status pożyczki,
`due_date`, liczba przedłużeń, powód sporu.

### 8.3 Literature: przyjąć / zaadaptować / unikać
- **Przyjąć:** właściciel zamyka zwrot (Hygglo, Sharetribe); zaległość wyliczana (Koha);
  przypomnienie przed terminem i cykliczne po nim (myTurn, Lend Engine); aktor przypisany do
  każdego przejścia (Sharetribe).
- **Zaadaptować:** recall jako skrócenie terminu (Koha); „claimed returned” jako DISPUTED (Koha);
  przedłużenie z akceptacją właściciela zamiast samoobsługi (LoT, Lend Engine); notatka o stanie
  rzeczy i kompletności przy zwrocie (biblioteki zabawek).
- **Unikać:** opłat, kaucji i ubezpieczeń (poza zakresem); pełnego sporu z operatorem
  (Sharetribe, Fat Llama case manager), bo to za ciężkie dla zaufanej grupy; przedłużenia jako
  nowej rezerwacji (Hygglo); ratingów i bramek zaufania (Olio), bo w zamkniętym Kręgu są zbędne.

## 9. Wnioski

**Główne:**
1. Zbudować zwrot dwustronny: pożyczający deklaruje, właściciel potwierdza. To rdzeń funkcji.
   Pewność wysoka.
2. Wprowadzić jawny nośnik pożyczki (encja `Loan` w circulation) albo świadomie rozszerzyć parę
   rezerwacji. Rekomenduję `Loan`, bo spełnia kryterium „lifecycle” z `models.md:9`. Pewność
   średnio-wysoka.
3. Zachować magazyn VIRTUAL (decyzja użytkownika, gotowy kod), ale naprawić widoki właściciela
   i zapisać ADR. Pewność średnio-wysoka.
4. Przed nową funkcją naprawić X4–X7, X2 i X12. Pewność wysoka.

**Drugorzędne:** przypomnienia na wzór `term_end_scan`; zaległość wyliczana; żądanie zwrotu
skraca termin; spór w wersji lekkiej; zgubienie = spisanie bez storna; Pledge-LEND jako zwykła
pożyczka.

**Pewność ogólna:** wysoka dla stanu obecnego i błędów, średnia dla proponowanego modelu
(zależy od decyzji produktowych).
