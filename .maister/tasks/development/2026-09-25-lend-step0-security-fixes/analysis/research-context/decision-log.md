# Rejestr decyzji: cykl życia wypożyczenia (LEND)

**Data:** 2026-09-25 · **Format:** MADR · **Powiązany projekt:**
[`high-level-design.md`](high-level-design.md)

Źródła alternatyw: `outputs/solution-exploration.md` (obszary O1–O7), `outputs/research-report.md`
(§4.3 błędy B#, §5.3 zdarzenia E#), `analysis/synthesis.md` (X#, I#, P#). Wszystkie decyzje
zatwierdził użytkownik w fazie 4 (zbieżność). Tam, gdzie wybór różni się od rekomendacji
raportu, ADR to zaznacza.

---

<a id="adr-001"></a>
## ADR-001: Magazyn VIRTUAL + encja `Loan` zamiast modelu INV (odstępstwo od dokumentu referencyjnego)

### Status
Accepted

### Context
Stan pożyczki jest dziś rozproszony. Składają się na niego para rezerwacji LEND/RETURN bez
powiązania (heurystyka „najnowszy FULFILLED LEND”, B9) oraz jeden nadpisywany wiersz
`InventoryBalance` (P6). Nie ma historii ani miejsca na przedłużenie, recall czy przypomnienia
idempotentne per pożyczka (I1).

Kod przy przekazaniu przenosi rzecz do magazynu VIRTUAL pożyczającego i ustawia
`home_inventory_id`. Dokument referencyjny `docs/system-wypozyczalni-inventory-accounting.md`
(INV:207-213) mówi natomiast, że przy LEND magazyn właściciela się nie zmienia. Odstępstwa nigdy
nie zapisano (X10). VIRTUAL daje gratis holdera w regułach potwierdzania, w ledgerze i w blokadzie
podnajmu. Ma jednak wadę: właściciel traci rzecz z widoku (B10).

### Decision Drivers
- Wczesna decyzja użytkownika: VIRTUAL pożyczającego powstaje razem z relacją wypożyczenia.
- Potrzeba jednego trwałego rekordu pożyczki z własną tożsamością i cyklem życia (`models.md:9`).
- Minimalny koszt zmiany działającego kodu (holder, ledger, reguły potwierdzania).
- Zaakceptowana rama czterech warstw: lokalizacja, operacje, przepływ, stan pożyczki.

### Considered Options
1. **1A** VIRTUAL + nowa encja `Loan` w `app.circulation`
2. **1B** VIRTUAL + rozszerzona para rezerwacji (bez `Loan`)
3. **1C** rzecz zostaje u właściciela + `holder_user_id` + `Loan` (zgodnie z INV)
4. **1D** stan pożyczki zapisany na rezerwacji LEND

### Decision Outcome
Wybrano **1A**. Tylko ta opcja rozwiązuje I1 bez przepisywania działającej lokalizacji i zgadza
się z ramą czterech warstw.

Szczegóły:
- `Loan` powstaje przy potwierdzeniu przekazania (fulfil LEND). Przed Terminem rzecz fizycznie
  jest jeszcze u właściciela, więc anulowanie PENDING nie musi niczego cofać.
- `home_inventory_id` = PERSONAL właściciela. Przy „Odebrałem” rzecz wraca do
  `home_inventory_id`, czyli PERSONAL właściciela, a pole jest zerowane.
- VIRTUAL jest jeden na użytkownika i trwały (`get_or_create_virtual_inventory`, indeks `0033`).
  Po zwrocie ostatniej rzeczy zostaje pusty i jest ponownie używany. Nie jest kasowany.
- Wymagana jest naprawa B10: zapytanie „moje rzeczy” uwzględnia `home_inventory_id`, a dane
  pożyczki pochodzą z `Loan`.
- Dokument INV należy zaktualizować (zadanie towarzyszące).

### Consequences

#### Good
- Jeden rekord na pożyczkę daje historię i naturalny klucz idempotencji dla przypomnień.
- Holder, ledger i blokada podnajmu działają bez zmian.
- `LoanStatus` jest string-backed, więc łatwo go rozszerzyć (spory, historia) bez migracji typu.

#### Bad
- Dochodzi nowa tabela i agregat. Spójność `Loan` ↔ rezerwacje ↔ balance ↔ magazyn trzeba
  pilnować w jednej transakcji.
- Zapisane odstępstwo od dokumentu referencyjnego wymaga aktualizacji INV.
- Każde zapytanie po stronie właściciela musi pamiętać o `home_inventory_id`.

---

<a id="adr-002"></a>
## ADR-002: `Loan` w `app.circulation`, akcje i reguły Terminów w `app.groups`

### Status
Accepted

### Context
Backend ma warstwy DDD. `app.circulation` nie zna Terminów ani Kręgów, a `term_id` trzyma tylko
jako plain FK. `app.groups` posiada Terminy, oferty, powiadomienia i skany. Do circulation
odwołuje się wyłącznie przez `infrastructure/circulation_bridge.py`. Precedensem jest
`confirm_transaction`: reguła Terminu i kwalifikowalność stron są w groups, a przejście rezerwacji
w circulation.

Nowa funkcja potrzebuje obu stron. Z jednej strony potrzebny jest stan pożyczki i jego przejścia.
Z drugiej potrzebna jest wiedza o Terminie: `due_date` z `occurs_on`, anulowanie przed Terminem,
Pledge.

### Decision Drivers
- Utrzymanie granicy kontekstów i kierunku zależności groups → circulation.
- Jedno publiczne API funkcji z aktorem = principal.
- Spójność z istniejącym wzorcem (`confirm_transaction`, `term_end_scan`).

### Considered Options
1. `Loan` i przejścia w circulation. Endpointy, reguły Terminu, powiadomienia i skan w groups,
   przez bridge.
2. Całość (`Loan` i endpointy) w circulation, a groups przekazuje tylko datę Terminu.
3. `Loan` jako encja groups.

### Decision Outcome
Wybrano **opcję 1**. Stan pożyczki to pojęcie circulation (rzecz, strony, rezerwacje, ledger).
„Kiedy i na jakim spotkaniu” to pojęcie groups, więc podział odwzorowuje język obu kontekstów.

Konsekwencje dla kodu:
- Circulation dostaje `due_date` jako gotową datę i nie liczy jej z Terminu.
- Stała `_DEFAULT_LEND_DAYS` zostaje w circulation. Udostępnia ją funkcja
  `default_due_date(start_date)` w fasadzie.
- Endpointy `/api/loans` należą do routera groups.

### Consequences

#### Good
- Circulation pozostaje niezależne od Terminów, a groups w całości odpowiada za reguły stron
  i Terminów.
- Jedno miejsce dla powiadomień i skanów (groups), zgodnie z `term_end_scan`.

#### Bad
- Bridge rośnie o około 10 funkcji pass-through.
- Reguły są w dwóch miejscach: strażnicy stanu w circulation, rola strony i Termin w groups.
  Specyfikacja musi jasno rozdzielić, kto sprawdza co.

---

<a id="adr-003"></a>
## ADR-003: Zwrot dwustronny zamykany wyłącznie przez właściciela, zawsze poza Terminami

### Status
Accepted (zmodyfikowana alternatywa 2A: bez wyboru Terminu zwrotu i bez monitu po Terminie zwrotu)

### Context
Dziś pożyczający sam tworzy, potwierdza i realizuje RETURN jednym kliknięciem i od razu dostaje
+1 pkt (B1, X1). Łamie to INV („zawsze pending → confirmed”), decyzje T14/T16 oraz wzorzec
wszystkich zbadanych platform, w których pożyczkę zamyka właściciel lub obsługa (P8).

Użytkownik ustalił, że zwrot zawsze odbywa się prywatnie, poza Terminami. Obecny `term_id`
rezerwacji RETURN, skopiowany z minionego LEND, jest przez to mylący (B8).

### Decision Drivers
- Właściciel ma ostatnie słowo, jak w Hygglo, Sharetribe i przy check-in w bibliotekach.
- Minimalna zmiana potoku rezerwacji (I2).
- Zwroty prywatne, niezależne od częstotliwości Terminów.
- Brak auto-zamknięcia (T16 odrzucił auto-confirm).

### Considered Options
1. **2A zmodyfikowana:** deklaracja pożyczającego + „Odebrałem” właściciela w dowolnej chwili,
   zwrot poza Terminami
2. **2B:** jak 2A + auto-zamknięcie po N dniach
3. **2C:** zwrot tylko na Terminie, „pierwszy wygrywa”
4. **2D:** tylko właściciel, bez deklaracji

### Decision Outcome
Wybrano **2A (zmodyfikowaną)**. 2D jest jej podzbiorem, bo właściciel może zamknąć pożyczkę bez
deklaracji. 2C odtwarza B1, a 2B rozstrzyga za właściciela.

Przebieg:
- **Deklaracja.** Pożyczający klika „Oddałem / chcę oddać”. Powstaje RETURN `PENDING`
  (`reserved_by` = W, `giver` = P, `term_id = NULL`), `Loan` przechodzi w `RETURN_PENDING`,
  a balance zostaje `LENT`.
- **Wycofanie.** Pożyczający może wycofać deklarację: RETURN `CANCELLED`, balance `LENT`,
  `Loan` wraca do `ACTIVE`.
- **Zamknięcie.** Właściciel klika „Odebrałem”. Jeśli nie było deklaracji, system najpierw
  tworzy RETURN, a potem wykonuje confirm i fulfil, które wolno zrobić tylko `reserved_by`.
  Rzecz wraca do domu jako `AVAILABLE`, a `Loan` przechodzi w `RETURNED`.
- **Punkty.** Ledger przyznaje +1 bieżącemu holderowi (pożyczającemu), bez storna.
- **Brak powiązania z Terminem.** Nie ma wyboru Terminu zwrotu, monitu po Terminie zwrotu ani
  bramki Terminu dla akcji zwrotu.
- **Schemat.** `reservations.term_id` staje się nullable z `CHECK (term_id IS NOT NULL OR
  reservation_type = 'RETURN')`.

### Consequences

#### Good
- Pożyczający nie może sam zamknąć pożyczki ani „wyklikać” sobie punktu.
- Zwrot pasuje do nieregularnych Terminów. Znika B8.
- Zmiana potoku jest mała: przestawienie reguł confirm/fulfil RETURN na W, bez nowego mechanizmu.

#### Bad
- Pożyczka może „wisieć”, jeśli właściciel nie reaguje. Mitygacja: przypomnienia do W
  w `RETURN_PENDING` (ADR-005).
- Uaktywniają się latentne błędy oczekującego RETURN (B11, „moje wzięcia”). Trzeba je naprawić
  w MVP.
- `term_id` przestaje być NOT NULL dla wszystkich typów, więc kod czytający go musi obsłużyć NULL
  dla RETURN.

---

<a id="adr-004"></a>
## ADR-004: Termin zwrotu od daty Terminu przekazania + 14 dni; przedłużenie prośbą/zgodą; recall jako wcześniejsza data

### Status
Accepted

### Context
Dzisiejszy `due_date` ma trzy wady:
- jest liczony jako teraz + 14 dni od kliknięcia fulfil;
- jest nadpisywany przy każdej rezerwacji (B3) i nieczytany (B4);
- pożyczający nie widzi go przy „Pożycz”.

Brakuje przedłużenia i żądania zwrotu. W zaufanej grupie bez obsługi strażnikiem jest właściciel.
Zegar też jest niespójny: `occurs_on` to naiwny czas lokalny, a znaczniki dat to `utcnow`.

### Decision Drivers
- Deterministyczny termin, znany w chwili „Pożycz”.
- Jedno pole obsługujące przedłużenie i recall.
- Decyzje zostają u właściciela, bez samoobsługi i bez limitów do utrzymania.
- Jedna konwencja zegara dla skanu przypomnień.

### Considered Options
1. **3A:** data Terminu przekazania + 14 dni, prośba i zgoda na przedłużenie, recall skraca termin
2. **3B:** „do następnego Terminu Kręgu”
3. **3C:** okres ustalany w ofercie + samoobsługowe przedłużenie z limitem
4. **3D:** pożyczka bezterminowa, tylko recall

### Decision Outcome
Wybrano **3A**. To najmniejszy model, który zasila przypomnienia i zostawia decyzje
właścicielowi. 3B zależy od nieznanej częstotliwości Terminów.

Szczegóły:
- **Wyliczenie terminu.** `Loan.due_date` (typ **DATE**) = `Term.occurs_on.date()` +
  `_DEFAULT_LEND_DAYS`. Liczy go groups, a ta sama wartość wyświetla się przy „Pożycz” jako
  `expected_due_date`.
- **Przedłużenie z prośbą.** Pożyczający ustawia `requested_due_date` (musi być > `due_date`,
  najwyżej jedna prośba naraz). Właściciel akceptuje lub odrzuca.
- **Zmiana terminu przez właściciela.** Właściciel zmienia termin bezpośrednio przez
  `PATCH /due-date`:
  - data późniejsza to przedłużenie;
  - data wcześniejsza, ale nie wcześniejsza niż dziś, to recall: ustawia `recalled_at`, czyści
    prośbę i wysyła powiadomienie.
- **Brak limitu przedłużeń** i brak kolumny `extension_count`.
- **Zegar.** `due_date` jest datą kalendarzową w czasie lokalnym serwera, tak jak `occurs_on`.
  Flagi `is_overdue` (`today > due_date`) i `is_due_soon` (`due_date − 2 ≤ today ≤ due_date`) są
  wyliczane przy odczycie i nigdy nie są zapisywane. Znaczniki czasu (`lent_at`, `returned_at`,
  `recalled_at`) pozostają w UTC i służą wyłącznie do audytu.

### Consequences

#### Good
- Termin nie zależy od chwili kliknięcia. Pożyczający zna go z góry.
- Jedno pole `due_date` obsługuje przedłużenie i recall, a skan resetuje się sam (ADR-005).
- Nie ma porównań UTC z czasem lokalnym, więc znika problem „dziś / jutro”.

#### Bad
- Stałe 14 dni nie pasuje do każdej rzeczy. Okres per rzecz (3C) jest odłożony.
- Dochodzą dwa przepływy (prośba i odpowiedź) oraz jedno pole z podwójną semantyką (PATCH
  wcześniej/później), co wymaga jasnych komunikatów w UI.
- Recall nie wymusza zwrotu. To tylko wcześniejsza data i przypomnienia.

---

<a id="adr-005"></a>
## ADR-005: Osobny skan `loan_due_scan` z limitowanymi przypomnieniami

### Status
Accepted

### Context
Nie ma przypomnień ani wykrywania zaległości. Istnieje sprawdzony wzorzec
`app/groups/application/term_end_scan.py` (P3):
- APScheduler;
- ograniczone zapytanie;
- marker idempotencji;
- outbox;
- jeden commit.

Użytkownik chce łagodnych przypomnień bez sankcji i bez niekończącego się spamu, bo pożyczka,
która nie wraca, może być otwarta długo (ADR-006).

### Decision Drivers
- Reużycie wzorca skan + marker + outbox.
- Rozdzielenie wyzwalaczy „koniec Terminu” i „data zwrotu” (focused functions).
- Idempotencja odporna na przedłużenie i recall.
- Twardy limit powiadomień.

### Considered Options
1. **4A:** osobny `loan_due_scan`, marker per (`loan_id`, `kind`, `due_date`, `sequence`), limit 3
   przypomnień o zaległości
2. **4B:** rozszerzenie `term_end_scan` o pożyczki
3. **4C:** tylko wizualnie, bez powiadomień
4. **4D:** przypomnienia zaczepione o Terminy Kręgu

### Decision Outcome
Wybrano **4A**.

Szczegóły:
- **Nowy job.** Drugi job w tym samym `AsyncIOScheduler`, z interwałem jako stałą modułową.
- **Zapytanie.** Jedno ograniczone zapytanie przez bridge o pożyczki `ACTIVE` i
  `RETURN_PENDING` z `due_date ≤ today + 2`, z limitem partii.
- **`LOAN_DUE_SOON`.** Wysyłany 2 dni przed terminem do pożyczającego, tylko w stanie `ACTIVE`.
- **`LOAN_OVERDUE`.** Wysyłany w dniu terminu (seq 0), po 7 dniach (seq 1) i po 14 dniach
  (seq 2). Łącznie **najwyżej 3 na jedną wartość `due_date`**. Później zostaje tylko wyliczany
  znacznik „po terminie”.
- **Odbiorcy `LOAN_OVERDUE`:**
  - w `ACTIVE` pożyczający, a przy seq 0 także kopia do właściciela;
  - w `RETURN_PENDING` właściciel („zgłoszono zwrot, potwierdź odbiór”).
- **Idempotencja.** Marker `loan_reminder_markers` należy do groups i ma UNIQUE na
  (`loan_id`, `kind`, `due_date`, `sequence`). Zapisuje się w tym samym commicie co wpis do
  outboxu.
- **Nadrabianie.** Po przestoju skan wysyła tylko bieżącą sekwencję.

### Consequences

#### Good
- Wzorzec jest sprawdzony. Zmiana `due_date` automatycznie daje nowy cykl przypomnień.
- Spamu nie ma, bo liczba powiadomień na jedną wartość `due_date` jest ograniczona do 4.
- Sankcje i stan „overdue” nie są zapisywane (derived-not-stored).

#### Bad
- Drugi job i druga tabela markerów.
- Po wyczerpaniu limitu przypomnienia o dalej niezwróconej rzeczy są wyłącznie wizualne.
- Wysyłanie `LOAN_OVERDUE` już w dniu terminu, choć `is_overdue` zaczyna się dzień później,
  wymaga spójnego tekstu („dziś mija termin”).

---

<a id="adr-006"></a>
## ADR-006: Spory i strata całkowicie poza systemem

### Status
Accepted (decyzja własna użytkownika; odbiega od rekomendacji 5A w iteracji 2)

### Context
Raport i eksploracja proponowały lekki stan DISPUTED i spisanie jako LOST (5A) albo samo LOST
(5B). Zbadane społeczności bez pieniędzy (Leila, Olio, Buy Nothing) rozwiązują problemy
rozmową. Krąg to mała, zaufana grupa i nie ma modelu uprawnień organizatora do cudzych pożyczek.

### Decision Drivers
- `minimal-implementation`: bez przedwczesnych stanów i przejść.
- Zaufana grupa, w której rozmowa jest naturalnym kanałem.
- Brak arbitra i brak pieniędzy.

### Considered Options
1. **5A:** DISPUTED + rozstrzyga właściciel + LOST jako spisanie
2. **5B:** tylko „Spisz jako zgubione” (LOST) + notatka
3. **5C:** organizator jako arbiter
4. **5D:** przy stracie własność przechodzi na pożyczającego
5. **Poza systemem:** brak stanów sporu i straty. Pożyczkę zamyka tylko „Odebrałem”.

### Decision Outcome
Wybrano **opcję 5 (poza systemem)**. Użytkownik uznał, że w Kręgu sporne sytuacje strony
załatwiają same.

Skutki:
- `LoanStatus` ma tylko `ACTIVE`, `RETURN_PENDING` i `RETURNED`.
- Rzecz, która nie wraca, utrzymuje pożyczkę otwartą, dopóki strony nie dogadają się poza
  systemem.
- Nie ma spisania i nie ma storna.
- Limit przypomnień (ADR-005) zapobiega spamowi.

### Consequences

#### Good
- Najmniejszy możliwy model i najmniej ekranów.
- Brak ryzyka, że system „rozstrzygnie” niesprawiedliwie.
- String-backed `LoanStatus` pozwala dodać DISPUTED/LOST później bez migracji typu.

#### Bad
- Zgubiona rzecz na zawsze wisi jako otwarta pożyczka (w VIRTUAL pożyczającego).
- Brak śladu problemu w systemie.
- Właściciel, który „odpuścił”, musi kliknąć „Odebrałem”, żeby zamknąć pożyczkę. Semantycznie
  nieścisłe, ale akceptowane.

---

<a id="adr-007"></a>
## ADR-007: Anulowanie PENDING LEND przez obie strony i Pledge-LEND jako zwykły `Loan`

### Status
Accepted

### Context
`cancel_transaction` działa tylko po Terminie (B13), więc przed spotkaniem nie da się zrezygnować.
Pledge→LEND do organizatora ma dziś trzy problemy (X8, I7):
- auto-confirm;
- fulfil przez surowy `/fulfill`;
- brak ścieżki zwrotu.

Wybór „oddaję czy pożyczam” przy deklaracji był osobną, niepodjętą decyzją produktową (R02).

### Decision Drivers
- Tanie usunięcie B13.
- Jeden cykl życia dla wszystkich pożyczek.
- Usunięcie zależności od surowego `/fulfill`, co wspiera ADR-010.

### Considered Options
1. **6A:** obie strony anulują PENDING LEND w każdej chwili przed przekazaniem. Pledge-LEND jest
   zwykłym `Loan`, a deklarujący wybiera GIFT lub LEND.
2. **6B:** status quo
3. **6C:** asymetrycznie (pożyczający rezygnuje, właściciel odrzuca). Pledge zawsze jako GIFT.

### Decision Outcome
Wybrano **6A**.

**Anulowanie:**
- `cancel_transaction` dla LEND w stanie `PENDING` nie ma bramki Terminu;
- dozwolone dla `reserved_by` i `giver`;
- Termin jest brany z rezerwacji;
- druga strona dostaje `LEND_CANCELLED`;
- GIFT i SWAP bez zmian;
- po przekazaniu anulowania nie ma, jest tylko zwrot.

**Pledge:**
- nowa kolumna `pledges.transfer_type` (`GIFT` | `LEND`);
- dla LEND usuwamy auto-confirm, a przekazanie po Terminie idzie przez `confirm_transaction`
  (monit zapewnia poprawka B12);
- powstaje `Loan` z lender = deklarujący, borrower = organizator i `due_date` =
  `occurs_on.date()` (domyślnie dzień zajęć).

### Consequences

#### Good
- Pożyczający może się wycofać przed spotkaniem, a rzecz nie jest blokowana bez potrzeby.
- Pledge-LEND ma zwrot, przypomnienia i zamknięcie „za darmo”.
- Surowy `/fulfill` przestaje być potrzebny.

#### Bad
- Formularz deklaracji dostaje dodatkowy wybór. Organizator dostaje obowiązki pożyczającego.
- Przy `due_date` = dzień zajęć pierwsza wiadomość `LOAN_OVERDUE` dotrze do organizatora zaraz po
  przekazaniu. Jest to zamierzone („oddaj po zajęciach”), ale może wydać się nachalne. Zmiana
  okresu to jedna stała.
- Anulowanie w ostatniej chwili nie jest niczym ograniczone.

---

<a id="adr-008"></a>
## ADR-008: Krok 0 (poprawki) przed MVP

### Status
Accepted

### Context
Błędy bezpieczeństwa i integralności są poważniejsze niż sama funkcja (I6):
- **B6:** surowe `/api/reservations*` przyjmują `reserved_by` z body;
- **B7:** `term_id` z body w `confirm-transaction` i `cancel-transaction`;
- **B10:** właściciel nie widzi pożyczonej rzeczy;
- **B12:** brak monitu po Terminie dla LEND.

Z kolei B2, B3 i B11 dotyczą przepływu RETURN, który MVP i tak przepisuje.

### Decision Drivers
- Zamknięcie luk bezpieczeństwa niezależnie od losów funkcji.
- Uniknięcie podwójnej pracy nad kodem, który MVP przepisze.
- Każda poprawka ma własne testy regresji.

### Considered Options
1. **7A:** krok 0 osobno, potem MVP
2. **7B:** big-bang
3. **7C:** minimalny start bez `Loan`
4. **7D:** poprawki wplecione w funkcję

### Decision Outcome
Wybrano **7A w wariancie kompromisowym**.

- **Krok 0** (osobny przebieg, np. `/maister:quick-bugfix` lub osobny development), każda
  poprawka z testami:
  - B6: aktor = principal i reguły per typ na surowych trasach;
  - B7: Termin z rezerwacji;
  - B10: „moje rzeczy” po `home_inventory_id`;
  - B12: `TERM_CONFIRMATION_NEEDED` dla PENDING LEND i Pledge-LEND.
- **MVP** (`/maister:development`): O1, O2, O3, O4, O6 oraz B2, B3 (znika z kolumną), B11
  i błąd latentny „moje wzięcia”.
- **Brak iteracji ze sporami** (ADR-006).

### Consequences

#### Good
- Luki bezpieczeństwa są zamknięte od razu.
- `Loan` powstaje od początku, więc nie ma migracji podwójnej.
- Poprawki mają osobne, czytelne testy.

#### Bad
- Dwa przebiegi i dwa przeglądy.
- Poprawka B10 z kroku 0 (dane z VIRTUAL i balance) zostanie w MVP przepięta na `Loan`.
- Surowe trasy w kroku 0 są tylko zabezpieczone, a usuwa je dopiero MVP (ADR-010).

---

<a id="adr-009"></a>
## ADR-009: `Loan` jako jedyne źródło dat pożyczki; usunięcie `BalanceStatus.RETURNED` i dat z `InventoryBalance`

### Status
Accepted

### Context
`InventoryBalance` (1:1 z rzeczą) ma kolumny `lent_at`, `returned_at` i `due_date`, nadpisywane
w każdym cyklu. `create_reservation` kopiuje do `due_date` wartość `expires_at` (None) przy każdej
rezerwacji, także RETURN (B3). `BalanceStatus.RETURNED` nie jest nigdzie przypisywany (X9, B5).
Gdy `Loan` przechowuje daty, kopia w balance jest tylko źródłem rozjazdów.

### Decision Drivers
- Jedno źródło prawdy dla dat pożyczki.
- Usunięcie przyczyny B3 zamiast łatania jej.
- `minimal-implementation`: brak martwych wartości enumów.
- Pre-produkcja: zmiana schematu bez shimów.

### Considered Options
1. Usunąć `due_date`, `lent_at` i `returned_at` z balance oraz `RETURNED` z enumu. Daty tylko
   w `Loan`.
2. Zostawić daty w balance jako lustro `Loan`.
3. Zostawić wszystko i naprawić tylko nadpisywanie (B3).

### Decision Outcome
Wybrano **opcję 1**. Lustro wymagałoby synchronizacji przy każdym przejściu i odtwarzałoby klasę
błędów B3.

Balance wraca do roli „stanu bieżącego rzeczy”:
- `LENT`, gdy pożyczka trwa i także gdy zwrot jest zgłoszony;
- `AVAILABLE` po „Odebrałem”.

Migracja sprawdza, że żaden wiersz nie ma statusu `RETURNED`.

### Consequences

#### Good
- B3 znika z definicji, a model jest prostszy.
- Balance jest zgodny ze swoją rolą (lokalizacja i dostępność), a `Loan` z cyklem życia.

#### Bad
- Wszyscy czytelnicy tych kolumn (FE „Oddaj do”, bridge, odpowiedzi API) muszą przejść na `Loan`.
  Specyfikacja musi ich zinwentaryzować.
- Odczyt „do kiedy pożyczone” wymaga złączenia z `loans`.

---

<a id="adr-010"></a>
## ADR-010: Zamknięcie surowych tras zapisu `/api/reservations`

### Status
Accepted

### Context
Trasy `POST /api/reservations`, `/{id}/confirm`, `/{id}/cancel` i `/{id}/fulfill` w
`app/circulation/router.py` omijają reguły groups. Przyjmują `reserved_by_user_id` z body
i wymagają tylko uprawnienia EDIT (`authorization_matrix.py`, wpis 43). Każdy użytkownik może
więc zablokować cudzą rzecz albo założyć RETURN cudzej pożyczki (B6). FE używa ich wyłącznie
w `returnBorrowedItem`, który MVP zastępuje, a Pledge używa `/fulfill`, co ADR-007 usuwa.

### Decision Drivers
- Bezpieczeństwo: aktor zawsze = principal.
- Jeden kanał zmian stanu pożyczki (use case'y groups).
- Pre-produkcja: usunięcie tras bez okresu przejściowego.

### Considered Options
1. Krok 0: zabezpieczyć (principal + reguły per typ). MVP: usunąć trasy zapisu z routera
   i z macierzy, trasy odczytu zostają.
2. Tylko zabezpieczyć i zostawić na stałe.
3. Usunąć od razu w kroku 0.

### Decision Outcome
Wybrano **opcję 1**. Usunięcie w kroku 0 zepsułoby działający „Oddaję” przed dostarczeniem MVP.
Samo zabezpieczenie zostawiłoby drugą, równoległą ścieżkę przejść, którą trzeba by utrzymywać
spójnie z `Loan`.

### Consequences

#### Good
- Luka jest zamknięta od razu. Po MVP istnieje jedna ścieżka przejść, spójna z `Loan`.
- Mniejsza powierzchnia API.

#### Bad
- Nieznani klienci (MCP `mcp:edit`, pluginy) tracą trasy zapisu. W specyfikacji trzeba sprawdzić,
  czy tacy są.
- Reguły per typ z kroku 0 są kodem przejściowym, usuwanym w MVP.
