# Eksploracja rozwiązań: cykl życia wypożyczenia (LEND) po przekazaniu rzeczy

**Data:** 2026-09-25 · **Wejście:** `analysis/synthesis.md`, `outputs/research-report.md`
(§4.3 błędy, §4.4 VIRTUAL vs holder, §5 model i tabela zdarzeń E1–E19, §6 wzorce, §7 D1–D18,
§9 kroki), `project/tech-stack.md`, `project/architecture.md`, standardy `models.md`,
`minimal-implementation.md`.
**Autor:** solution-brainstormer (maister) · **Pewność ogólna rekomendacji:** średnio-wysoka

Odwołania: **B#** = błąd z raportu §4.3, **E#** = zdarzenie z §5.3, **D#** = decyzja z §7,
**X#/I#/P#** = ustalenia, wnioski i wzorce z syntezy.

---

## 1. Przeformułowanie problemu

### 1.1 Pytanie badawcze

Jak zaprojektować wypożyczenie (LEND) w Kręgu/Terminie, żeby obejmowało pełny cykl po
przekazaniu: magazyn VIRTUAL pożyczającego, chęć zwrotu, żądanie zwrotu przez właściciela,
przedłużenie, termin zwrotu i przypomnienia, zaległość, potwierdzenie odbioru przez właściciela,
spory i anulowanie? Projekt musi respektować granicę `app.groups` ↔ `app.circulation`
(tylko `circulation_bridge`).

### 1.2 Przyjęta rama pojęciowa (zaakceptowana przez użytkownika)

| Warstwa | Nośnik | Odpowiada na pytanie |
|---|---|---|
| Lokalizacja | magazyn `VIRTUAL` pożyczającego + `InventoryItem.home_inventory_id` | „Gdzie fizycznie jest rzecz i czyja jest?” |
| Operacje przekazania | `reservations` typu `LEND` / `RETURN` | „Jaka operacja przekazania jest w toku i kto ją potwierdził?” |
| Przepływ | ledger `circulation_transactions` | „Co przepłynęło między użytkownikami (punkty)?” |
| Stan pożyczki | nowa tabela `loans` | „W jakim stanie jest ta konkretna pożyczka, od kiedy, do kiedy, co się z nią działo?” |

Wczesna decyzja użytkownika: magazyn VIRTUAL pożyczającego powstaje, gdy powstaje relacja
wypożyczenia. Kod robi to przy przekazaniu (fulfil), co w tej eksploracji interpretujemy jako
moment powstania relacji (patrz Obszar 1, D2).

### 1.3 Pytania „Jak moglibyśmy…” (HMW)

1. **HMW-1** Jak moglibyśmy trzymać stan jednej pożyczki w jednym, trwałym miejscu, zachowując
   działający model VIRTUAL? (I1, I3, X10, B9)
2. **HMW-2** Jak moglibyśmy zamykać pożyczkę tak, żeby właściciel potwierdzał odbiór, a
   pożyczka nie „wisiała”, gdy ktoś milczy? (X1, P8, B1, I2)
3. **HMW-3** Jak moglibyśmy ustalać termin zwrotu i go zmieniać (przedłużenie, żądanie zwrotu)
   bez ciężkiego procesu, w rytmie Terminów Kręgu? (I4, B3, B4, P11, P12)
4. **HMW-4** Jak moglibyśmy przypominać o terminie i sygnalizować zaległość łagodnie, tylko
   in-app, na istniejącej infrastrukturze skanu? (P3, P4, P9, B12)
5. **HMW-5** Jak moglibyśmy obsłużyć „nie dostałem”, uszkodzenie i zgubienie w zaufanej grupie
   bez pieniędzy i bez operatora? (I5, P10)
6. **HMW-6** Jak moglibyśmy pozwolić wycofać się przed przekazaniem i domknąć Pledge→LEND, który
   dziś jest pożyczką bez końca? (B13, X8, I7)
7. **HMW-7** Jak moglibyśmy dostarczyć to etapami, naprawiając najpierw błędy bezpieczeństwa i
   integralności? (I6, B2, B3, B6, B7, B10, B11, B12)

### 1.4 Obszary decyzyjne

| Obszar | Decyzje | HMW |
|---|---|---|
| O1. Nośnik stanu pożyczki i lokalizacja rzeczy | D1, D2, D3, D14 | HMW-1 |
| O2. Protokół zamknięcia zwrotu | D4, D5, D12, D13 | HMW-2 |
| O3. Termin zwrotu, przedłużenie, żądanie zwrotu | D6, D7, D8 | HMW-3 |
| O4. Przypomnienia i zaległość | D9, D10 | HMW-4 |
| O5. Spory i strata | D11, D17 | HMW-5 |
| O6. Anulowanie przed przekazaniem i Pledge→LEND | D15, D16 | HMW-6 |
| O7. Zakres MVP i kolejność (w tym poprawki) | D18 + B2, B3, B6, B7, B10, B11, B12 | HMW-7 |

---

## 2. Obszary decyzyjne i alternatywy

Skala w macierzach: **W** = wysoko/korzystnie, **Ś** = średnio, **N** = nisko/niekorzystnie.
Dla kolumny „Ryzyko” W oznacza *niskie* ryzyko (korzystne).

### O1. Nośnik stanu pożyczki i lokalizacja rzeczy (D1 + D2 + D3 + D14)

**Kontekst.** Dziś stan pożyczki jest rozproszony na parę rezerwacji LEND/RETURN (bez
powiązania, heurystyka „najnowszy FULFILLED LEND”, `reservations.py:26-46`) i jeden
nadpisywany wiersz `InventoryBalance` (`lent_at`, `due_date`, `returned_at`). Nie ma historii
ani miejsca na przedłużenie, recall czy spór (I1). Wybór VIRTUAL vs „zostaje u właściciela”
jest ortogonalny (§4.4). VIRTUAL daje gratis holdera w regułach potwierdzania, ledger i blokadę
podnajmu, ale właściciel go nie widzi (B10). `BalanceStatus.RETURNED` jest martwy (X9, B5).

#### Alternatywa 1A: VIRTUAL + encja `Loan` w `app.circulation`
Rzecz przy przekazaniu przechodzi do VIRTUAL pożyczającego (jak dziś). Jednocześnie powstaje
wiersz `loans` (`BaseEntity`, StrEnum `LoanStatus`), który jawnie wiąże `lend_reservation_id`
i `return_reservation_id`, strony, daty i status. `Loan.due_date` staje się źródłem prawdy,
`InventoryBalance` wraca do roli „stan bieżący rzeczy” (LENT/AVAILABLE). `RETURNED` usunięty
z `BalanceStatus`.
- **Mocne strony:** jeden rekord na pożyczkę, historia za darmo; spełnia kryterium „własna
  tożsamość i cykl życia” z `models.md:9`; naturalny klucz idempotencji dla przypomnień
  (`loan_id`, `kind`, `due_date`); zero zmian w wyliczaniu holdera i ledgerze; zgodne z ramą
  czterech warstw zaakceptowaną przez użytkownika.
- **Słabe strony:** nowa tabela i migracja; trzeba pilnować spójności `Loan` ↔ rezerwacje ↔
  balance w jednej transakcji; wymaga ADR odstępstwa od INV (VIRTUAL).
- **Najlepsza gdy:** MVP obejmuje choć jedno z: przedłużenie, recall, spór, przypomnienia
  idempotentne per pożyczka.
- **Dowody:** I1, I3, §4.4 kolumna C, §5.1, `models.md:9`, P3 (marker idempotencji).

#### Alternatywa 1B: VIRTUAL + rozszerzona para rezerwacji (bez `Loan`)
Brak nowej tabeli. Do `reservations` dochodzi `paired_reservation_id` (LEND↔RETURN), do
`InventoryBalance` kolumny `return_requested_at`, `extension_count`, `requested_due_date`,
`recalled_at`. Stan pożyczki wyliczany z pary rezerwacji i balance.
- **Mocne strony:** najmniejsza zmiana schematu; brak nowego agregatu; zwrot dwustronny
  (I2) działa praktycznie od ręki.
- **Słabe strony:** balance jest 1:1 z rzeczą i nadpisywany (P6), więc historia nadal ginie;
  stan „spór” nie ma naturalnego miejsca; logika rozsmarowana na dwie tabele, łatwo o błędy
  typu B2/B3; przejście później na `Loan` = migracja podwójna (ryzyko z §8).
- **Najlepsza gdy:** MVP to wyłącznie zwrot dwustronny i nic więcej nie jest planowane.
- **Dowody:** D3(b), P6, X4, X5, §8 „migracja podwójna”.

#### Alternatywa 1C: Rzecz zostaje w magazynie właściciela + `holder_user_id` + `Loan`
Rezygnacja z przenoszenia do VIRTUAL (zgodnie z INV:207-213). Balance `LENT` + pole
`holder_user_id`, stan pożyczki w `Loan`.
- **Mocne strony:** zgodne z dokumentem referencyjnym INV; „co jest moje?” jest trywialne
  dla właściciela (B10 znika sam).
- **Słabe strony:** sprzeczne z wczesną decyzją użytkownika (VIRTUAL); trzeba przepisać
  wyliczanie holdera (`reservations.py:49-57`), reguły potwierdzania, ledger, widok
  „Wypożyczone”, dopisać blokadę podnajmu, wycofać 0030/0033; największy koszt.
- **Najlepsza gdy:** zespół chce ściśle trzymać się INV i nie ma jeszcze kodu VIRTUAL.
- **Dowody:** §4.4 kolumna B, I3, X10.

#### Alternatywa 1D: Stan pożyczki na rezerwacji LEND (LEND jako „długo żyjąca” rezerwacja)
Rezerwacja LEND nie kończy się na FULFILLED, tylko dostaje kolumnę `loan_status`
(ACTIVE/RETURN_PENDING/RETURNED…) oraz `due_date`, `extension_count` itd. Wiersz LEND jest
de facto pożyczką.
- **Mocne strony:** brak nowej tabeli, ale jest jeden rekord na pożyczkę i historia;
  naturalne powiązanie z `term_id` przekazania.
- **Słabe strony:** miesza dwie warstwy (operacja przekazania vs stan pożyczki), wbrew ramie
  zaakceptowanej przez użytkownika; kolumny puste dla GIFT/SWAP/RETURN; dwa statusy na jednym
  wierszu (`status` + `loan_status`) mylą reguły przejść.
- **Najlepsza gdy:** nacisk na minimalną liczbę tabel przeważa nad czytelnością modelu.
- **Dowody:** §5.1 (pola), X3, synteza §3.3.

**Macierz O1**

| | Wykonalność techn. | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność / rozszerzalność |
|---|---|---|---|---|---|
| 1A VIRTUAL + `Loan` | W (nowa tabela, reszta bez zmian) | W (historia, widok właściciela) | Ś (+1 agregat, ale jasne warstwy) | W (odwracalne, pre-prod) | W (przedłużenie, spór, historia) |
| 1B para rezerwacji | W | Ś (brak historii) | Ś (mało tabel, rozproszona logika) | Ś (migracja podwójna) | N |
| 1C holder u właściciela | N (przepisanie wielu miejsc) | W | Ś | N (duża zmiana, sprzeczna z decyzją) | W |
| 1D stan na LEND | W | W | N (dwa statusy w wierszu) | Ś | Ś |

**Rekomendacja O1: 1A (VIRTUAL + `Loan`).** Jedyna opcja, która rozwiązuje I1 bez przepisywania
działającej lokalizacji i zgadza się z ramą czterech warstw. D2: `Loan` i przeniesienie do
VIRTUAL powstają przy potwierdzeniu przekazania (E5), bo przed Terminem rzecz fizycznie jest u
właściciela, a anulowanie PENDING nie musi niczego cofać. D14: usunąć `BalanceStatus.RETURNED`.
Warunki: naprawa B10 (zapytanie po `home_inventory_id`), ADR odstępstwa od INV. Pewność:
średnio-wysoka.

---

### O2. Protokół zamknięcia zwrotu (D4 + D5 + D12 + D13)

**Kontekst.** Dziś „Oddaję” = create + confirm + fulfil RETURN jednym kliknięciem pożyczającego,
+1 pkt od razu (X1, B1). Łamie to INV, T14 i wszystkie zbadane platformy (P8). Istniejący
trzystopniowy potok rezerwacji już pasuje do zwrotu dwustronnego: wystarczy ograniczyć fulfil
RETURN do `reserved_by` = właściciel (I2). Nie wiadomo, jak często są Terminy (luka §11.2).

#### Alternatywa 2A: Deklaracja pożyczającego + potwierdzenie właściciela, miejsce hybrydowe, bez auto-zamknięcia
Pożyczający „Chcę oddać” (RETURN PENDING, opcjonalnie z przyszłym `term_id`, `Loan` →
RETURN_PENDING, balance zostaje LENT). Właściciel „Odebrałem” w dowolnej chwili, także bez
wcześniejszej deklaracji (E14), z opcjonalną flagą/notatką o stanie rzeczy (D12a). Przy
milczeniu właściciela: monit po wybranym Terminie zwrotu (E13) i przypomnienia. Punkt +1 dla
pożyczającego dopiero przy fulfil (D13a, bez storna).
- **Mocne strony:** zgodne z P8 i INV; minimalna zmiana potoku (I2); elastyczne wobec
  nieregularnych Terminów; właściciel zawsze ma ostatnie słowo; jeden aktor na przejście (Sharetribe).
- **Słabe strony:** pożyczka może „wisieć”, jeśli właściciel ignoruje monity; więcej ekranów
  (sekcja „Pożyczone innym”, modal zwrotu).
- **Najlepsza gdy:** mała zaufana grupa, Terminy o niepewnej częstotliwości.
- **Dowody:** P8, I2, D4(a), D5(c), D12(a), D13(a), E11–E14.

#### Alternatywa 2B: Jak 2A + auto-zamknięcie po N dniach milczenia
Jeśli pożyczający zadeklarował zwrot, a właściciel nie zareagował przez N dni od deklaracji lub
od Terminu zwrotu, system zamyka pożyczkę jako RETURNED.
- **Mocne strony:** brak „wiszących” pożyczek; wzorzec Sharetribe (auto-received po 14 dniach).
- **Słabe strony:** system rozstrzyga za właściciela, co w sporze „nie dostałem” działa na jego
  niekorzyść; sprzeczne z decyzją T16 (odrzucenie auto-confirm); dodatkowe przejście czasowe i
  testy granic.
- **Najlepsza gdy:** dane pokażą, że pożyczki realnie wiszą.
- **Dowody:** §6 „auto-zamknięcie”, D4(b), T16.

#### Alternatywa 2C: Zwrot tylko na Terminie, symetrycznie z przekazaniem („pierwszy wygrywa”)
RETURN zawsze przypięty do przyszłego Terminu; po Terminie obie strony dostają
`TERM_CONFIRMATION_NEEDED`, pierwsza potwierdzająca zamyka (jak P2).
- **Mocne strony:** jeden mechanizm dla przekazania i zwrotu; reużycie `confirm_transaction`
  i skanu; spójny UX.
- **Słabe strony:** „pierwszy wygrywa” pozwala pożyczającemu zamknąć zwrot bez właściciela,
  czyli powtarza B1 w nowej formie; zwroty poza Terminami niemożliwe; przy rzadkich Terminach
  pożyczki się wydłużają.
- **Najlepsza gdy:** Terminy są częste i regularne, a zaufanie pełne.
- **Dowody:** P2, D5(a), X3.

#### Alternatywa 2D: Tylko właściciel, bez deklaracji pożyczającego
Pożyczający nic nie klika; właściciel po odebraniu rzeczy klika „Odebrałem”. Brak stanu
RETURN_PENDING.
- **Mocne strony:** najprostsze; jeden przycisk; brak ryzyka latentnych błędów
  oczekującego RETURN (§4.3 ostrzeżenie).
- **Słabe strony:** pożyczający nie może zasygnalizować „oddam na T X”; właściciel nie wie,
  kiedy się spodziewać rzeczy; brak podstawy do „nie dostałem” (E15).
- **Najlepsza gdy:** zwroty odbywają się zawsze osobiście i natychmiast.
- **Dowody:** E14 („tworzony, jeśli nie było E11”), Koha check-in.

**Macierz O2**

| | Wykonalność | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 2A deklaracja + potwierdzenie | W (I2) | W | Ś | W | W |
| 2B + auto-zamknięcie | Ś | Ś (mniej wiszących, ryzyko krzywdy właściciela) | N | Ś | W |
| 2C tylko na Terminie | W (reużycie) | N (sztywne) | W | N (powtórka B1) | Ś |
| 2D tylko właściciel | W | Ś | W | W | N |

**Rekomendacja O2: 2A.** Rdzeń funkcji wg raportu i najmocniejszy wzorzec zewnętrzny.
2D jest jej podzbiorem (właściciel może zamknąć bez deklaracji), więc 2A nic nie traci.
Auto-zamknięcie (2B) odłożone jako warunkowe. Stan rzeczy: opcjonalna notatka/flaga przy
„Odebrałem” aktualizująca `InventoryItem.condition`, bez stanu DAMAGED. Pewność: wysoka.

---

### O3. Termin zwrotu, przedłużenie, żądanie zwrotu (D6 + D7 + D8)

**Kontekst.** `due_date` = teraz + 14 dni od kliknięcia fulfil, nadpisywany przy każdej
rezerwacji (B3), nieczytany (B4). Pożyczający nie widzi terminu przy „Pożycz”. Wzorce: 1–3
tygodnie, przedłużenie z limitem (biblioteki), recall skraca termin (Koha). Brak obsługi, więc
strażnikiem jest właściciel.

#### Alternatywa 3A: 14 dni od daty Terminu przekazania + prośba/zgoda + recall skraca termin
`Loan.due_date` = data Terminu przekazania + 14 dni (stała `_DEFAULT_LEND_DAYS`), widoczna
przy „Pożycz”. Przedłużenie: pożyczający prosi o nową datę, właściciel akceptuje lub odrzuca;
właściciel może też przedłużyć sam. Bez limitu. Recall: właściciel ustawia `due_date` na
wskazaną datę (lub najbliższy Termin) + powiadomienie; zaległość i przypomnienia działają
automatycznie.
- **Mocne strony:** deterministyczny termin niezależny od chwili kliknięcia; jedno pole
  `due_date` obsługuje przedłużenie i recall; brak obsługi = właściciel decyduje.
- **Słabe strony:** 14 dni może nie pasować do każdej rzeczy (wózek vs książka); dwa nowe
  przepływy (prośba + odpowiedź).
- **Najlepsza gdy:** różne rytmy Terminów, rzeczy o podobnym czasie użycia.
- **Dowody:** D6(b), D7(a)+(c), D8(a), P11, P12, B4.

#### Alternatywa 3B: „Do następnego Terminu Kręgu”
`due_date` = data następnego Terminu po Terminie przekazania; przedłużenie = „do kolejnego
Terminu”.
- **Mocne strony:** zgodne z rytmem grupy; zwrot naturalnie na spotkaniu; proste w komunikacji.
- **Słabe strony:** zależy od istnienia zaplanowanego następnego Terminu (circulation nie zna
  Terminów, więc wyliczanie w groups); przy nieregularnych Terminach bezużyteczne; nieznana
  częstotliwość (luka §11.2).
- **Najlepsza gdy:** Terminy są regularne (np. co tydzień) i zawsze zaplanowane z wyprzedzeniem.
- **Dowody:** D6(c), luka §11.2.

#### Alternatywa 3C: Okres ustala właściciel w ofercie + samoobsługowe przedłużenie z limitem
Preferencja LEND dostaje `loan_days` (per rzecz). Pożyczający sam przedłuża do 2 razy, o ile
nie jest po terminie ani nie było recall.
- **Mocne strony:** dopasowanie okresu do rzeczy (Leila „per rzecz”); mniej interakcji dla
  właściciela.
- **Słabe strony:** rozszerza `item_listing_preferences` i formularz oferty; samoobsługa to
  wzorzec z obsługą biblioteki, w małej grupie odbiera właścicielowi kontrolę; limit trzeba
  uzasadnić i utrzymać.
- **Najlepsza gdy:** duży katalog zróżnicowanych rzeczy, słaba dostępność właścicieli.
- **Dowody:** D6(d), D7(b), Leila, Berkeley, Koha.

#### Alternatywa 3D: Pożyczka bezterminowa, tylko recall
Brak domyślnego `due_date`; pożyczka trwa, dopóki właściciel nie poprosi o zwrot.
- **Mocne strony:** najprostsze; zgodne z Olio/Buy Nothing („ustalane na czacie”); brak
  przedłużeń.
- **Słabe strony:** brak podstawy dla zaległości i przypomnień (O4); ciężar pamiętania na
  właścicielu; sprzeczne z oczekiwaniem „termin zwrotu” z pytania badawczego.
- **Najlepsza gdy:** pożyczki są krótkie i nieformalne.
- **Dowody:** §6 Olio, D8(b).

**Macierz O3**

| | Wykonalność | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 3A 14 dni od Terminu + prośba + recall | W | W | Ś | W | W |
| 3B do następnego Terminu | Ś (zależność od groups) | W przy regularnych, N przy nieregularnych | Ś | Ś (nieznana częstotliwość) | Ś |
| 3C okres w ofercie + samoobsługa | Ś | Ś | N | Ś | W |
| 3D bezterminowo | W | N | W | Ś (brak zaległości) | N |

**Rekomendacja O3: 3A.** Najmniejszy model, który zasila zaległość i przypomnienia, a
decyzje zostawia właścicielowi. 3B wymaga odpowiedzi na pytanie o częstotliwość Terminów;
3C (okres per rzecz) jako stretch. Założenie: 14 dni jest akceptowalnym domyślnym okresem.
Pewność: średnia (zależy od rytmu Terminów).

---

### O4. Przypomnienia i zaległość (D9 + D10)

**Kontekst.** Brak skanu i typów `NotificationKind` dla pożyczek. Istnieje precedens P3:
APScheduler co minutę, marker idempotencji, outbox (`term_end_scan`). Kanał tylko in-app (T16).
Zegary: `utcnow` vs naiwny lokalny `occurs_on`. Zaległość wyliczana (P4).

#### Alternatywa 4A: Osobny skan pożyczek w groups, offsety −2 dni / 0 / co 7 dni, zaległość wyliczana, bez sankcji
Nowy job `loan_due_scan` na wzór `term_end_scan`: ograniczone zapytanie przez bridge, marker
per (`loan_id`, `kind`, `due_date`), wpis do outboxu w jednym commicie. `LOAN_DUE_SOON` 2 dni
przed, `LOAN_OVERDUE` w dniu terminu i co 7 dni; właściciel informowany przy pierwszej
zaległości. `is_overdue`/`is_due_soon` wyliczane, nieprzechowywane. Sankcje: brak, tylko
oznaczenie „po terminie”.
- **Mocne strony:** reużycie sprawdzonego wzorca; marker z `due_date` sam „resetuje się”
  po przedłużeniu lub recall; izolacja od logiki Terminów.
- **Słabe strony:** drugi job i drugi typ markera; trzeba ujednolicić zegar.
- **Najlepsza gdy:** zawsze, gdy `due_date` istnieje (3A/3B/3C).
- **Dowody:** P3, P4, P9, D9, D10(a), myTurn, Lend Engine.

#### Alternatywa 4B: Rozszerzenie `term_end_scan` o pożyczki
Jeden skan obsługuje koniec Terminu (GIFT/SWAP/LEND, B12) i terminy pożyczek.
- **Mocne strony:** jeden job, mniej kodu infrastrukturalnego.
- **Słabe strony:** miesza dwa różne wyzwalacze (koniec Terminu vs data zwrotu); rosnąca
  funkcja wbrew „focused functions”; trudniej testować granice.
- **Najlepsza gdy:** obciążenie schedulera jest problemem (nie jest).
- **Dowody:** `term_end_scan.py:66-166`, B12.

#### Alternatywa 4C: Tylko wizualnie, bez powiadomień
Brak skanu; widoki „Wypożyczone” / „Pożyczone innym” pokazują odliczanie i kolor
„po terminie” wyliczany przy odczycie.
- **Mocne strony:** zero infrastruktury; brak ryzyka zegarów w schedulerze.
- **Słabe strony:** użytkownik musi sam wejść do panelu; nie realizuje „przypomnień” z pytania
  badawczego; wszystkie zbadane systemy wysyłają przypomnienia.
- **Najlepsza gdy:** bardzo wczesny prototyp.
- **Dowody:** P4, §5.4.

#### Alternatywa 4D: Przypomnienia zaczepione o Terminy Kręgu
Zamiast offsetów od daty — przypomnienie w dniu (lub dzień przed) najbliższego Terminu, jeśli
pożyczka mija lub minęła („weź na spotkanie X”).
- **Mocne strony:** trafia w moment, w którym zwrot jest fizycznie możliwy; mniej
  powiadomień.
- **Słabe strony:** wymaga łączenia Terminów z pożyczkami (groups + bridge), przy braku
  Terminów nie przypomina wcale.
- **Najlepsza gdy:** Terminy regularne i zwroty głównie na spotkaniach.
- **Dowody:** D9 (dodatek „w dniu Terminu Kręgu”).

**Macierz O4**

| | Wykonalność | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 4A osobny skan + offsety | W (P3) | W | Ś | W | W |
| 4B rozszerzony `term_end_scan` | W | W | N (mieszanie odpowiedzialności) | Ś | Ś |
| 4C tylko wizualnie | W | N | W | W | N |
| 4D zaczepione o Terminy | Ś | W przy regularnych Terminach | Ś | Ś | Ś |

**Rekomendacja O4: 4A** (wyliczana zaległość w widokach jak w 4C jest i tak jej częścią).
Przypomnienie w dniu Terminu (4D) jako stretch po poznaniu rytmu Terminów. Sankcje (D10b/c)
odłożone. Pewność: wysoka.

---

### O5. Spory i strata (D11 + D17)

**Kontekst.** Spory odłożono świadomie (T20). Społeczności bez pieniędzy wybierają rozwiązania
miękkie (Leila, Olio, Buy Nothing). Koha ma lekki stan „claimed returned” (P10). Brak modelu
uprawnień organizatora do cudzych pożyczek.

#### Alternatywa 5A: Lekki stan DISPUTED + rozstrzyga właściciel + LOST jako spisanie
`Loan` → DISPUTED przy „Nie dostałem” (E15) lub „Zgłoś problem” (E16). Rzecz zostaje w VIRTUAL
pożyczającego. Właściciel rozstrzyga: RETURNED, ACTIVE lub LOST (spisanie rzeczy, brak +1
pożyczającemu, bez storna +1 właściciela). Organizator bez roli.
- **Mocne strony:** pełna tabela E15–E18; jawna historia problemu; zgodne z P10 i
  „jeden aktor na przejście”.
- **Słabe strony:** 2 dodatkowe stany i ~3 przejścia; właściciel jest sędzią we własnej
  sprawie (akceptowalne w zaufanej grupie).
- **Najlepsza gdy:** spory zdarzają się i trzeba je odróżnić od zwykłej zaległości.
- **Dowody:** P10, D11(a), D13(a), D17(a), E15–E18.

#### Alternatywa 5B: Bez stanu sporu — tylko „Spisz jako zgubione” (ACTIVE → LOST) i notatka
Brak DISPUTED. Rozmowa odbywa się poza systemem; właściciel może zamknąć pożyczkę jako LOST
z notatką. Zaległość pełni rolę sygnału „coś jest nie tak”.
- **Mocne strony:** jedno przejście; zgodne z `minimal-implementation`; wystarcza, jeśli
  spory są rzadkie.
- **Słabe strony:** „Nie dostałem” po deklaracji zwrotu nie ma reprezentacji (RETURN_PENDING
  wisi); brak śladu, że był problem, jeśli rzecz się znajdzie.
- **Najlepsza gdy:** pierwsza iteracja, spory incydentalne.
- **Dowody:** Olio, Buy Nothing, I5, `minimal-implementation.md`.

#### Alternatywa 5C: Organizator Kręgu jako arbiter
DISPUTED jak w 5A, ale rozstrzygać może też organizator (lub tylko on).
- **Mocne strony:** strona trzecia w konflikcie; wzorzec „case manager”.
- **Słabe strony:** wymaga nowego modelu uprawnień organizatora do cudzych pożyczek (luka
  §11.2); ciężkie dla zaufanej grupy (§6 „unikać”).
- **Najlepsza gdy:** duże Kręgi z anonimowymi członkami.
- **Dowody:** D17(c), Fat Llama/Sharetribe (odrzucone).

#### Alternatywa 5D: Przy stracie własność przechodzi na pożyczającego
Zamiast spisania — rzecz „zgubiona” lub „zniszczona” staje się rzeczą pożyczającego (np. do
odkupienia/naprawy).
- **Mocne strony:** nic nie znika z systemu; odzwierciedla „kto ma rzecz”.
- **Słabe strony:** dla zgubionej rzeczy semantycznie fałszywe; komplikuje ledger (transfer
  własności bez GIFT); brak wzorca zewnętrznego.
- **Najlepsza gdy:** rzecz uszkodzona, ale istniejąca, i strony tak się umówią.
- **Dowody:** D11(b).

**Macierz O5**

| | Wykonalność | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 5A DISPUTED + właściciel | W | W | Ś | W | W |
| 5B tylko LOST + notatka | W | Ś | W | Ś (wiszące RETURN_PENDING) | Ś |
| 5C organizator arbitrem | N (nowe uprawnienia) | Ś | N | N | W |
| 5D transfer własności | Ś | N | N | N | Ś |

**Rekomendacja O5: 5A, w drugiej iteracji.** W pierwszej iteracji nie dodawać stanów DISPUTED
i LOST (zgodnie z `minimal-implementation` — bez przedwczesnych wartości enumów). `LoanStatus`
jest string-backed (`models.md`), więc dołożenie wartości później nie wymaga migracji typu.
Jeśli pierwsza iteracja musi mieć jakąkolwiek obsługę straty, 5B jest bezpiecznym
podzbiorem 5A. Pewność: średnia.

---

### O6. Anulowanie przed przekazaniem i Pledge→LEND (D15 + D16)

**Kontekst.** `cancel_transaction` działa tylko po Terminie (B13). Pledge→LEND do organizatora
ma auto-confirm i fulfil przez surowy `/fulfill`, bez ścieżki zwrotu (X8, I7). R02 zostawił
„gift czy lend” jako osobną decyzję.

#### Alternatywa 6A: Obie strony anulują PENDING LEND przed i po Terminie; Pledge-LEND = zwykły `Loan`, deklarujący wybiera GIFT/LEND
Nowa akcja groups „Zrezygnuj” dla PENDING LEND dostępna dla obu stron w każdej chwili przed
przekazaniem (E3, powiadomienie drugiej strony). Po przekazaniu brak anulowania, tylko zwrot.
Pledge: deklarujący wybiera „oddaję” (GIFT) albo „pożyczam” (LEND); LEND tworzy `Loan` z
organizatorem jako pożyczającym, `due_date` domyślnie = dzień zajęć/Terminu, fulfil przez groups
(nie surowy).
- **Mocne strony:** zamyka B13 i I7 tym samym mechanizmem; jeden cykl dla wszystkich pożyczek;
  usuwa zależność od surowego `/fulfill` (wspiera naprawę B6).
- **Słabe strony:** dodatkowy wybór w formularzu deklaracji; organizator dostaje obowiązki
  pożyczającego (przypomnienia).
- **Najlepsza gdy:** Pledge-LEND jest realnie używany.
- **Dowody:** D15(a), D16(a)+(b), X8, I7, R02.

#### Alternatywa 6B: Anulowanie tylko po Terminie (jak dziś); Pledge-LEND bez zwrotu
Zachować status quo; Pledge traktować jako darowiznę de facto.
- **Mocne strony:** zero pracy.
- **Słabe strony:** pożyczający nie może się wycofać przed spotkaniem (rzecz zablokowana
  jako RESERVED); Pledge-LEND pozostaje „pożyczką bez końca” (I7).
- **Najlepsza gdy:** Pledge wychodzi z użycia.
- **Dowody:** B13, X8.

#### Alternatywa 6C: Anuluje tylko pożyczający przed Terminem, właściciel może „odrzucić” wzięcie; Pledge zawsze GIFT
Asymetria: pożyczający rezygnuje, właściciel odrzuca (nowy krok akceptacji). Pledge upraszczamy
do darowizny.
- **Mocne strony:** właściciel zyskuje kontrolę nad tym, komu pożycza; Pledge prostszy.
- **Słabe strony:** wprowadza akceptację wzięcia, której dziś nie ma (E2 „W nie akceptuje”),
  czyli rozszerza zakres; zmienia semantykę Pledge wbrew możliwym oczekiwaniom deklarujących.
- **Najlepsza gdy:** właściciele chcą wybierać pożyczających.
- **Dowody:** E2, R02.

**Macierz O6**

| | Wykonalność | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 6A symetryczne + Pledge jako `Loan` | W | W | Ś | W | W |
| 6B status quo | W | N | W | Ś (I7, B13 zostają) | N |
| 6C asymetryczne + Pledge GIFT | Ś | Ś | Ś | Ś (rozszerzenie zakresu) | Ś |

**Rekomendacja O6: 6A.** Anulowanie przed przekazaniem jest tanie i usuwa B13. Pledge-LEND jako
zwykła pożyczka to „darmowy” efekt O1/1A. Wybór GIFT/LEND przy deklaracji może trafić do
iteracji z O5, jeśli trzeba ograniczyć MVP. Pewność: średnio-wysoka (organizator: średnia).

---

### O7. Zakres MVP i kolejność prac (D18 + poprawki B2, B3, B6, B7, B10, B11, B12)

**Kontekst.** Błędy bezpieczeństwa/integralności (B6, B7) są poważniejsze niż sama funkcja (I6).
Trzy latentne błędy uaktywnią się, gdy RETURN zacznie czekać (§4.3 ostrzeżenie). D3 trzeba
wybrać z wyprzedzeniem, żeby uniknąć migracji podwójnej.

#### Alternatywa 7A: Krok 0 (poprawki) osobno → MVP „zwrot dwustronny + widok właściciela + termin + przypomnienia + przedłużenie + recall” → iteracja 2 (spory, strata, Pledge GIFT/LEND)
Krok 0 jako `/maister:quick-bugfix`/osobny development: B6, B7, B2, B3, B10, B11, B12 + testy.
Następnie `/maister:development` z `Loan` od początku (O1/1A), O2/2A, O3/3A, O4/4A, O6
(anulowanie). Iteracja 2: O5/5A, reszta O6.
- **Mocne strony:** zamyka luki bezpieczeństwa od razu, niezależnie od losów funkcji; `Loan`
  od pierwszego dnia (brak migracji podwójnej); MVP pokrywa większość pytania badawczego.
- **Słabe strony:** trzy osobne przebiegi; część poprawek (B2, B3) dotyka kodu, który MVP i tak
  przepisze.
- **Najlepsza gdy:** priorytetem jest bezpieczeństwo i przewidywalny rozwój.
- **Dowody:** §9 kroki 0–3, D18(b), I6, §8.

#### Alternatywa 7B: Big-bang — poprawki i pełny zakres (z O5) w jednym przebiegu
- **Mocne strony:** jedna specyfikacja, jeden przegląd, spójna całość.
- **Słabe strony:** duży zakres = duże ryzyko opóźnienia; B6/B7 czekają na całą funkcję;
  wbrew `minimal-implementation` (spory przed potwierdzeniem potrzeby).
- **Najlepsza gdy:** krótki, pewny horyzont i jeden wykonawca.
- **Dowody:** D18(c), §8 „przerost”.

#### Alternatywa 7C: Minimalny start — poprawki + zwrot dwustronny bez `Loan` (I2), `Loan` później
Krok 0, potem tylko przepięcie fulfil RETURN na właściciela, sekcja „Pożyczone innym”, bez
przedłużeń/recall/przypomnień.
- **Mocne strony:** najszybciej usuwa B1; minimalna zmiana.
- **Słabe strony:** implikuje O1/1B teraz i migrację podwójną potem; przypomnienia bez
  `Loan` nie mają naturalnego klucza idempotencji.
- **Najlepsza gdy:** trzeba „na jutro” zatrzymać jednostronne zwroty.
- **Dowody:** I2, D18(a), D3(b), §8.

#### Alternatywa 7D: Poprawki wplecione w funkcję (bez osobnego kroku 0)
Każdy błąd naprawiany w miejscu, które funkcja i tak zmienia.
- **Mocne strony:** brak podwójnej pracy nad B2/B3/B11.
- **Słabe strony:** B6/B7 (bezpieczeństwo) czekają na funkcję; trudniej przeglądać;
  poprawki nie mają własnych testów regresji.
- **Najlepsza gdy:** funkcja startuje natychmiast i jest mała.
- **Dowody:** §4.3 kolumna „Przed funkcją?”.

**Macierz O7**

| | Wykonalność | Wpływ na użytkownika | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 7A krok 0 → MVP(b) → iteracja 2 | W | W | Ś | W | W |
| 7B big-bang | Ś | W (późno) | N | N | W |
| 7C minimalny bez `Loan` | W | Ś | W | Ś (migracja podwójna) | N |
| 7D poprawki wplecione | W | Ś | Ś | N (B6/B7 czekają) | Ś |

**Rekomendacja O7: 7A.** Wariant kompromisowy: w kroku 0 naprawić bezwzględnie B6, B7, B10,
B12 (bezpieczeństwo, widoczność, monit), a B2, B3, B11 można przenieść do MVP, bo i tak
dotyczą przepisywanego przepływu RETURN — pod warunkiem, że MVP startuje od razu. Pewność:
wysoka.

---

## 3. Zbiorcza analiza kompromisów (rekomendowana ścieżka)

| Perspektywa | Ocena rekomendowanego zestawu (1A + 2A + 3A + 4A + 5A w iter. 2 + 6A + 7A) |
|---|---|
| Wykonalność techniczna | Wysoka. Reużywa VIRTUAL, trzystopniowy potok rezerwacji (I2), wzorzec skan + marker + outbox (P3), bridge. Jedyny nowy agregat to `Loan`. |
| Wpływ na użytkownika | Wysoki. Właściciel widzi pożyczone rzeczy i zamyka zwrot; pożyczający widzi termin od chwili „Pożycz”, dostaje przypomnienia, może prosić o przedłużenie. |
| Prostota | Średnia. +1 tabela, ~8 nowych `NotificationKind`, 1 job. Zrównoważone przez usunięcie `RETURNED`, heurystyki LEND↔RETURN i surowych wywołań z FE. |
| Ryzyko | Niskie–średnie. Pre-prod, odwracalne. Ryzyka: latentne błędy oczekującego RETURN (mitygowane w tym samym zakresie), zegary UTC/lokalny, „wiszące” pożyczki (monity, 2B warunkowo). |
| Skalowalność / rozszerzalność | Wysoka. `Loan` przyjmuje spory, historię, sankcje, okres per rzecz bez przebudowy. |

---

## 4. Preferencje użytkownika i ograniczenia

- Rama czterech warstw (VIRTUAL / rezerwacje / ledger / `loans`) — zaakceptowana.
- VIRTUAL pożyczającego powstaje wraz z relacją wypożyczenia — zachowane (moment: potwierdzenie
  przekazania, D2b).
- Granica DDD: `Loan` i przejścia w `app.circulation`; wybór Terminu zwrotu, kwalifikowalność,
  powiadomienia i skan w `app.groups` przez `circulation_bridge`. Circulation przechowuje
  `term_id` tylko jako plain FK.
- Standardy: `BaseEntity`, StrEnum string-backed, `lazy="raise"`, `minimal-implementation`
  (bez przedwczesnych stanów), trasy w liczbie mnogiej (`api.md`), aktor = principal (nigdy z body).
- Pre-prod: zmiany schematu i URL bez shimów.
- Powiadomienia tylko in-app.
- Brak pieniędzy, kaucji, ocen.

Uwaga metodyczna: alternatywy wygenerowano z dowodów, bez dialogu preferencyjnego; powyższe
preferencje pochodzą z bramki orkiestratora i ograniczeń zadania.

---

## 5. Rekomendowane podejście

**„`Loan` jako nośnik stanu nad działającym VIRTUAL, zwrot zamyka właściciel, termin od daty
Terminu, łagodne przypomnienia, etapami od poprawek.”**

| Obszar | Wybór |
|---|---|
| O1 | 1A — VIRTUAL + encja `Loan` (tworzona przy potwierdzeniu przekazania), `RETURNED` usunięty z `BalanceStatus`, B10 naprawione, ADR odstępstwa od INV |
| O2 | 2A — deklaracja pożyczającego (opcjonalnie z przyszłym Terminem) + „Odebrałem” właściciela w dowolnej chwili, notatka o stanie opcjonalna, +1 pożyczającemu przy fulfil, bez auto-zamknięcia |
| O3 | 3A — `due_date` = data Terminu przekazania + 14 dni, widoczna przy „Pożycz”; przedłużenie: prośba + zgoda (lub przedłużenie przez właściciela), bez limitu; recall skraca `due_date` |
| O4 | 4A — osobny skan pożyczek (−2 dni, 0, co 7 dni), marker per (`loan_id`, `kind`, `due_date`), zaległość wyliczana, brak sankcji |
| O5 | 5A w iteracji 2 (DISPUTED/LOST, rozstrzyga właściciel, bez storna, organizator bez roli) |
| O6 | 6A — anulowanie PENDING LEND przez obie strony przed i po Terminie; Pledge-LEND jako zwykły `Loan` (wybór GIFT/LEND przy deklaracji może wejść w iteracji 2) |
| O7 | 7A — krok 0 (min. B6, B7, B10, B12; B2, B3, B11 w kroku 0 lub w MVP) → MVP → iteracja 2 |

**Główne uzasadnienie.** To najmniejszy zestaw, który zamienia martwe elementy (`due_date`,
`RETURNED`, heurystyka LEND↔RETURN) w jawny cykl życia, reużywa wszystkiego, co działa
(VIRTUAL, potok rezerwacji, ledger, skan), i odpowiada najmocniejszemu wzorcowi zewnętrznemu
(właściciel zamyka pożyczkę).

**Akceptowane kompromisy.**
- Nowa tabela i agregat zamiast minimalnej rozbudowy rezerwacji.
- Pożyczki mogą wisieć przy milczącym właścicielu (świadomie, zamiast auto-zamknięcia).
- Stały okres 14 dni zamiast okresu per rzecz.
- Spory dopiero w drugiej iteracji; do tego czasu problem rozwiązywany poza systemem.
- Odstępstwo od INV (VIRTUAL) zamiast pełnej zgodności z dokumentem referencyjnym.

**Kluczowe założenia (jeśli fałszywe, rekomendacja się zmienia).**
1. Terminy nie są na tyle regularne, by „do następnego Terminu” było lepszym domyślnym okresem
   (jeśli są — rozważyć 3B i 4D).
2. Właściciele reagują na monity; jeśli dane pokażą wiszące pożyczki — włączyć 2B.
3. Grupa jest mała i zaufana, więc właściciel może być arbitrem (w przeciwnym razie 5C).
4. Pledge-LEND jest realnie używany (w przeciwnym razie część O6 można pominąć).
5. MVP startuje zaraz po kroku 0 (inaczej B2, B3, B11 muszą wejść do kroku 0).

**Pewność rekomendacji:** średnio-wysoka (wysoka dla O2, O4, O7; średnia dla O3, O5).

---

## 6. Dlaczego nie inne

| Alternatywa | Dlaczego nie |
|---|---|
| 1B para rezerwacji | Nie daje historii ani miejsca na spór; przy rozwoju wymusza migrację podwójną. |
| 1C holder u właściciela | Sprzeczne z decyzją użytkownika o VIRTUAL i wymaga przepisania działającego kodu holdera, reguł i ledgera. |
| 1D stan na LEND | Miesza warstwę operacji z warstwą stanu pożyczki, wbrew zaakceptowanej ramie; dwa statusy w jednym wierszu. |
| 2B auto-zamknięcie | Rozstrzyga za właściciela i jest sprzeczne z T16; włączyć dopiero przy dowodach na wiszące pożyczki. |
| 2C tylko na Terminie | „Pierwszy wygrywa” pozwala pożyczającemu zamknąć zwrot sam, czyli odtwarza B1. |
| 2D tylko właściciel | Pożyczający nie może zasygnalizować zwrotu; brak podstawy dla „nie dostałem”. 2A zawiera 2D. |
| 3B do następnego Terminu | Zależy od nieznanej częstotliwości Terminów i od zaplanowania kolejnego Terminu. |
| 3C okres w ofercie + samoobsługa | Rozszerza ofertę i odbiera właścicielowi kontrolę; pasuje do bibliotek z obsługą, nie do Kręgu. |
| 3D bezterminowo | Brak podstawy dla zaległości i przypomnień, które są w pytaniu badawczym. |
| 4B rozszerzony `term_end_scan` | Łączy dwa różne wyzwalacze w jednej funkcji, trudniej testować. |
| 4C tylko wizualnie | Nie realizuje przypomnień. |
| 4D zaczepione o Terminy | Nie działa bez regularnych Terminów; dobre uzupełnienie później. |
| 5B tylko LOST | Nie reprezentuje „nie dostałem” po deklaracji; akceptowalne tylko jako tymczasowy podzbiór. |
| 5C organizator arbitrem | Wymaga nowego modelu uprawnień i jest za ciężkie dla zaufanej grupy. |
| 5D transfer własności | Semantycznie fałszywe dla zgubionej rzeczy, komplikuje ledger. |
| 6B status quo | Zostawia B13 i „pożyczkę bez końca” przy Pledge. |
| 6C asymetryczne + Pledge GIFT | Wprowadza akceptację wzięcia (rozszerzenie zakresu) i zmienia semantykę Pledge. |
| 7B big-bang | Opóźnia poprawki bezpieczeństwa i buduje spory przed potwierdzeniem potrzeby. |
| 7C bez `Loan` | Szybkie, ale kosztuje migrację podwójną i nie zasila przypomnień. |
| 7D poprawki wplecione | B6/B7 (bezpieczeństwo) czekałyby na całą funkcję. |

---

## 7. Granice zakresu

| Element | Klasyfikacja | Uwagi |
|---|---|---|
| `Loan`, zwrot dwustronny, widok właściciela, `due_date`, przypomnienia, zaległość wyliczana | W zakresie | MVP |
| Przedłużenie, recall | W zakresie | MVP (D18b) |
| Anulowanie PENDING LEND przed Terminem | W zakresie | MVP |
| Poprawki B2, B3, B6, B7, B10, B11, B12 | W zakresie | Krok 0 / MVP |
| DISPUTED, LOST, notatka o stanie | W zakresie | Iteracja 2 |
| Pledge-LEND jako `Loan`, wybór GIFT/LEND przy deklaracji | W zakresie | MVP lub iteracja 2 |
| Blok „Na tym Terminie oddajesz / odbierasz” na stronie Terminu | Stretch | §5.4 |
| Przypomnienie w dniu Terminu Kręgu (4D) | Stretch | po poznaniu rytmu Terminów |
| Okres pożyczki per rzecz w ofercie (3C) | Stretch | |
| Auto-zamknięcie po N dniach (2B) | Stretch | warunkowe, przy dowodach |
| Aktualizacja INV, `architecture.md`, ścieżki w `security.md`, ADR VIRTUAL | Stretch (towarzyszące) | nie funkcja, ale warunek rekomendacji O1 |
| Sankcje (blokada nowych wypożyczeń), widoczność zaległości dla organizatora | Poza zakresem | D10b/c |
| Rola organizatora w sporach | Poza zakresem | D17b/c |
| Pieniądze, kaucje, ubezpieczenia, oceny | Poza zakresem | §2 raportu |
| Zmiany GIFT/SWAP | Poza zakresem | poza naprawą B12 |
| Kolejka rezerwacji (holds) blokująca przedłużenie | Poza zakresem | |

---

## 8. Odłożone pomysły

1. **Auto-zamknięcie zwrotu po N dniach milczenia właściciela** — wrócić, jeśli metryki pokażą
   wiszące RETURN_PENDING (Sharetribe).
2. **Łagodne sankcje za zaległość** (blokada nowych wypożyczeń do czasu zwrotu, Berkeley) — gdy
   zaległości staną się problemem społecznym.
3. **Organizator: podgląd sporów tylko do odczytu** (D17b) — gdy pojawi się model uprawnień
   organizatora.
4. **Okres pożyczki ustalany przez właściciela per rzecz** — gdy katalog będzie zróżnicowany.
5. **Przypomnienia zaczepione o Terminy Kręgu** i blok „oddajesz / odbierasz na tym Terminie” —
   po ustaleniu częstotliwości Terminów.
6. **Kolejka chętnych (holds) i blokada przedłużenia przy kolejce** (Koha) — gdy popularne rzeczy
   będą rozchwytywane.
7. **Historia pożyczek rzeczy/użytkownika jako widok zaufania** — `Loan` to umożliwia, ale widok
   nie jest potrzebny w MVP.
8. **Standard „stan wyliczalny z czasu nie jest przechowywany”** — propozycja do
   `/maister:standards-update` (§9 krok 4 raportu).
9. **Czyszczenie lokalnych danych z błędnym backfillem 0039 (B14)** — kosmetyka pre-prod.
10. **Przepięcie FE panelu na hooki TanStack Query** poza zakresem pożyczek (N+1 z F2) — szerszy
    refaktor `PanelDataContext`.
