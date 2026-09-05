# Decision Log

Decyzje projektowe dla modelu Party Archetype Organizator → Grupa → Rodzina + Pledge.
Format: MADR. Źródła: `outputs/research-report.md` (Faza 1 — Fit Test, Party Types,
Concept Mapping), `outputs/solution-exploration.md` (Faza 3 — brainstorming czterech
otwartych obszarów cardinality/kształtu pola/tożsamości).

---

## ADR-001: Party Types dla Organizator/Grupa/Rodzina

### Status
Accepted

### Context
Domena zawiera trzy koncepty — Organizator, Grupa zajęciowa, Rodzina — dziś reprezentowane
w kodzie wyłącznie pozycyjnie lub przez string-match (`groupName: string`, hardcoded string
w środku okręgu w `KragGrupy.tsx:439-443`, brak `groupId` na `Family`). Trzeba rozstrzygnąć,
jakim typom archetypu Party (`Person`/`Organization`/`Group`) odpowiada każdy z nich, zanim
można zaprojektować role i relacje między nimi.

### Decision Drivers
- Metodologia `party-archetype-mapper` (SKILL.md:106) wprost podaje "Family" i "Class" jako
  przykłady `Group` — silna analogia strukturalna do Rodziny i Grupy zajęciowej.
- Rodzina jest w kodzie jednostką atomową — `FAMILIES` nie rozbija rodziny na osoby
  (`kids: string` jako wolny tekst, brak pickera osób), co wskazuje na `Group`, nie `Person`.
- Organizator jest pojedynczą osobą fizyczną mogącą prowadzić wiele grup jednocześnie
  (`PanelOrganizatora.tsx` — `groups: Group[]`, plural) — klasyczny sygnał "multi-role"
  z Fit Testu (SKILL.md:16).
- Brak jakiegokolwiek dowodu w kodzie/wymaganiach na potrzebę osobnego bytu `Organization`
  (placówka/instytucja niezależna od Organizatora-Person).

### Considered Options
1. **Organizator = `Party(Person)` + rola `Organizer`; Grupa = `Party(Group)`; Rodzina =
   `Party(Group)` + rola `Member`** — mapowanie zgodne z przykładami skilla.
2. Organizator = `Party(Person)`; Grupa = `Party(Organization)` (traktowana jako byt
   administracyjny/placówka); Rodzina = `Party(Group)`.
3. Rodzina = `Party(Person)` reprezentująca jedną osobę kontaktową, bez modelowania rodziny
   jako całości.

### Decision Outcome
Chosen option: 1, ponieważ bezpośrednio odzwierciedla przykłady z metodologii ("Family,
Class" jako `Group`, SKILL.md:106), pasuje do dzisiejszej atomowości Rodziny w kodzie, oraz
nie wprowadza `Organization` bez dowodu potrzeby (opcja 2 rozwiązywałaby niepotwierdzony
problem — brak placówek niezależnych od Organizatora). Opcja 3 zerwałaby z ideą Rodziny jako
spójnej jednostki Party, tracąc możliwość modelowania członkostwa całej rodziny w Grupie.

### Consequences

#### Good
- Role (`Organizer`, `Member`) są scoped do konkretnej Grupy, nie globalne — pozwala jednej
  osobie/rodzinie mieć różne role w różnym kontekście bez konfliktu.
- Model nie wymaga dziś budowania `Organization` — mniejsza powierzchnia startowa.
- Bezpośrednia zgodność z `SKILL.md:106` ułatwia przyszłe rozszerzenia (np. `Organization`
  dla placówek), gdyby taka potrzeba się potwierdziła.

#### Bad
- Rodzina jako `Group` (nie `Person`) oznacza, że tożsamość pojedynczej osoby wewnątrz
  rodziny musi zostać rozstrzygnięta osobno (patrz ADR-006) — dodatkowy krok modelowy przy
  integracji z `Reservation.reservedBy: User`.
- Jeśli w przyszłości pojawi się wiele niezależnych placówek zarządzających wieloma
  organizatorami, model będzie wymagał dodania `Organization` jako osobnego rozszerzenia
  (nieprzewidzianego dziś w strukturze).

---

## ADR-002: Wprowadzenie Pledge jako pośredniego konceptu

### Status
Accepted

### Context
"Zgłoszenie na ochotnika" (uczestnik deklaruje "przyniosę X") istnieje dziś w kodzie jako
osobny, niepołączony mechanizm (`NEEDED_ITEMS`/`bringClaims` w `KragGrupy.tsx`), zupełnie
odrębny od "prośby o rzecz" organizatora (`Term.neededItems` w `PanelOrganizatora.tsx`).
Trzeba rozstrzygnąć, gdzie w modelu domenowym umiejscowić to zgłoszenie względem archetypu
Party i względem systemu wypożyczalni (`Reservation`/`InventoryItem`).

### Decision Drivers
- Fit Test archetypu Party (SKILL.md:35-38): "jeśli naturalne pytanie brzmi 'w jakim jest
  stanie', to state machine, nie model aktor/relacja" — zgłoszenie na ochotnika pyta
  dokładnie o stan (otwarte/zgłoszone/wycofane/zrealizowane), nie o "kto gra jaką rolę wobec
  kogo".
- Twardy, niezmienny kontrakt `Reservation.itemId: string` (nie-nullable, Finding 4) —
  `Reservation` zawsze zakłada już istniejący, skonkretyzowany `InventoryItem`, którego przy
  samym zgłoszeniu ochotniczym jeszcze nie ma.
- Brief wyklucza przeprojektowanie modelu wypożyczalni/punktowego — każde rozwiązanie musi
  zachować ten kontrakt bez zmian.

### Considered Options
1. Modelować zgłoszenie na ochotnika jako nowy `Relationship` w archetypie Party
   (np. `volunteering` między Rodziną a Grupą/Termem).
2. Modelować je bezpośrednio jako `Reservation` z opcjonalnym/nullable `itemId`, wypełnianym
   później.
3. **Wprowadzić nowy, pośredni koncept stanowy `Pledge`** (poza ścisłym archetypem Party,
   referencujący Party jako "kto"), konwertowany na niezmienioną `Reservation` dopiero przy
   rejestracji konkretnego `InventoryItem`.

### Decision Outcome
Chosen option: 3, ponieważ opcja 1 nie przechodzi Fit Testu (naturalne pytanie o stan, nie
o relację aktorów) — wprowadzenie jej jako `Relationship` byłoby niezgodne z metodologią.
Opcja 2 naruszałaby udokumentowany, celowy kontrakt `Reservation.itemId` (Finding 4) i
zbliżałaby się do zakazanego przeprojektowania modelu wypożyczalni. `Pledge` jako osobny
koncept rozwiązuje zidentyfikowaną lukę integracyjną (Finding 3) bez naruszania żadnego z
dwóch istniejących modeli.

### Consequences

#### Good
- Kontrakt `Reservation` (`itemId` wymagane, `reservedBy: User`) pozostaje całkowicie
  niezmieniony — zero ryzyka regresji w systemie wypożyczalni.
- Łączy dwa dziś niepołączone mechanizmy (prośba organizatora / zgłoszenie ochotnika) w
  jeden spójny przepływ przez wspólne odniesienie do `Term`/`NeededItem`.
- Stan `Pledge` (`open|claimed|withdrawn|fulfilled`) daje jednoznaczną odpowiedź na pytanie
  "czy ta potrzeba jest już pokryta", czego dziś żaden z dwóch mechanizmów nie umożliwia.

#### Bad
- Wprowadza nowy koncept do zaprojektowania i utrzymania (dodatkowa encja, dodatkowa
  maszyna stanów) zamiast rozszerzenia istniejącego modelu.
- Zachowanie `Pledge` przy `Reservation.status=cancelled` pozostaje nieudokumentowane w
  źródle systemu wypożyczalni — wymaga rozstrzygnięcia w fazie specyfikacji (odnotowane w
  sekcji "Poza zakresem" designu).

---

## ADR-003: Cardinality leadership – ścisłe 1:N

### Status
Accepted

### Context
Relacja `leadership` (Organizator → Grupa) wymaga rozstrzygnięcia cardinality: czy w danym
momencie Grupa może mieć tylko jednego aktywnego organizatora (1:N), czy wielu jednocześnie
(N:N, pełne współprowadzenie). Dzisiejszy kod nie zawiera żadnego dowodu na współprowadzenie
— `KragGrupy.tsx:439-443` wizualnie przedstawia dokładnie jedną osobę w centrum okręgu jako
prowadzącą.

### Decision Drivers
- Brak jakiegokolwiek dowodu — w kodzie ani w wymaganiach — na współprowadzenie grupy przez
  kilku organizatorów jednocześnie.
- Zasada minimal-implementation ("build only what is needed", brak spekulatywnych
  abstrakcji) i borderline-case guidance metodologii Party (SKILL.md:55-59).
- Asymetria kosztu migracji: przejście z 1:N na N:N później (gdyby współprowadzenie okazało
  się potrzebne) jest tańsze niż wycofywanie się z N:N, gdyby okazało się niepotrzebne.

### Considered Options
1. **1A — ścisłe 1:N**: co najwyżej jedna aktywna instancja `leadership` per Grupa; zmiana
   organizatora = zamknięcie starej instancji + otwarcie nowej.
2. 1B — N:N od startu (pełne współprowadzenie): dowolna liczba jednocześnie aktywnych
   organizatorów per Grupa.
3. 1C — 1:N z osobnym mechanizmem "zastępstwa"/delegacji (`Delegation`), bez zmiany rdzenia
   `leadership`.

### Decision Outcome
Chosen option: 1A jako model startowy, z 1C udokumentowanym jako świadomie odłożone
rozszerzenie (nie budowane teraz), ponieważ raport nie dostarcza żadnego dowodu na
współprowadzenie, a 1A jest najprostszym modelem zgodnym z obserwowanym stanem i
najłatwiejszym do rozszerzenia w stronę 1C, gdyby zastępstwa okazały się potrzebne.

### Consequences

#### Good
- Najprostszy model do zaimplementowania i zapytania — "kto dziś prowadzi tę grupę" zwraca
  zawsze zero lub jeden wynik.
- Zero konfliktów uprawnień (kto może edytować `Term`, akceptować `Pledge` — zawsze
  jednoznaczne).
- Zgodny z dzisiejszym UI (`KragGrupy.tsx:439-443` pokazuje dokładnie jedną osobę).

#### Bad
- Nie obsługuje bezpośrednio scenariusza "dwie prowadzące na zmianę"/współprowadzenie bez
  dodatkowego mechanizmu (1C) — jeśli współprowadzenie okaże się częstym, potwierdzonym
  wymaganiem, wymagana będzie migracja modelu (zmiana reguły uniqueness), nie tylko danych.
- Mechanizm delegacji/zastępstwa (1C) pozostaje niezaprojektowany — odnotowany jako Stretch
  w `solution-exploration.md`, do zaprojektowania dopiero gdy potrzeba się potwierdzi.

---

## ADR-004: Cardinality membership – N:N od startu

### Status
Accepted

### Context
Relacja `membership` (Rodzina ↔ Grupa) wymaga rozstrzygnięcia, czy Rodzina może
jednocześnie należeć do wielu Grup (N:N), czy tylko do jednej naraz (1:N). Żaden z 7 plików
`pages/` dziś nie implementuje przełącznika kontekstu grupy (każdy panel operuje na jednej
grupie naraz), co nie przesądza modelu docelowego, ale też go nie potwierdza.

### Decision Drivers
- Domena "zajęcia dla dzieci/rodzin" silnie sugeruje wielość — rodziny typowo zapisują różne
  dzieci na różne, równoległe zajęcia (muzyczne, plastyczne itd.).
- Koszt wdrożenia N:N od razu (tabela łącząca) jest minimalny, podczas gdy migracja z 1:N na
  N:N później wymagałaby zmiany reguły unikalności i migracji danych — asymetryczne ryzyko
  na korzyść N:N od startu.
- Rodzina jako `Group` (ADR-001) pozostaje spójną jednostką niezależnie od liczby
  jednoczesnych członkostw — N:N nie wymaga duplikowania danych Rodziny.

### Considered Options
1. **2A — N:N od startu**: Rodzina może mieć wiele jednocześnie aktywnych instancji
   `membership`.
2. 2B — ścisłe 1:N: Rodzina należy co najwyżej do jednej Grupy naraz; zmiana grupy = zamknij
   starą + otwórz nową.
3. 2C — N:N z jedną instancją oznaczoną jako `isPrimary` (domyślny kontekst nawigacji).

### Decision Outcome
Chosen option: 2A, ponieważ domena sama sugeruje wielość (w przeciwieństwie do Obszaru 1,
gdzie brak dowodu przemawiał za prostszym modelem) — koszt migracji z 1:N do N:N później jest
wyższy niż odwrotnie. 2C odnotowana jako naturalne rozszerzenie UX (przełącznik kontekstu),
gdy zajdzie potrzeba, ale nie jest częścią modelu domenowego teraz.

### Consequences

#### Good
- Dopasowuje się do prawdopodobnego realnego użycia (jedna rodzina, wiele równoległych
  zajęć) bez wymuszania sztucznego duplikowania Rodziny per Grupa.
- Nie wymaga migracji, jeśli założenie wielości się potwierdzi — najniższe ryzyko
  długoterminowe spośród trzech alternatyw.
- Potrzeby (`Term`/`NeededItem`) każdej Grupy pozostają widoczne wyłącznie w kontekście tej
  Grupy (membership scoped), więc N:N nie powoduje przecieku informacji między Grupami.

#### Bad
- Implikuje potrzebę przełącznika kontekstu Grupy w UI (który panel/grupa jest aktywna) —
  zagadnienie warstwy prezentacji, wprost wykluczone z zakresu tego designu, ale odnotowane
  jako konsekwencja modelu do rozwiązania później.
- Żaden z dzisiejszych paneli `pages/` nie ma bezpośredniego dowodu potwierdzającego N:N —
  decyzja opiera się na prawdopodobieństwie domenowym, nie na obserwowanym kodzie.

---

## ADR-005: NeededItem jako kategoria/tag zamiast wolnego tekstu lub katalogu

### Status
Accepted

### Context
Pole opisujące "potrzebę" na `Term` (np. "przynieś tamburyn") istnieje dziś w dwóch
niespójnych wariantach: organizator wybiera z *własnego* katalogu `Item[]`
(`PanelOrganizatora.tsx:1041-1071`), mimo że rzeczy mają przynieść *inne* rodziny — a
uczestnik zgłasza się do osobnej, hardcoded listy `NEEDED_ITEMS`
(`KragGrupy.tsx:285-289`), niepowiązanej z żadnym `Term`. Trzeba rozstrzygnąć docelowy
kształt tego pola.

### Decision Drivers
- Zidentyfikowana niespójność: organizator nie powinien wybierać z własnego katalogu, skoro
  przedmiot ma dostarczyć ktoś inny.
- Potrzeba prostego raportowania/agregacji ("ile razy proszono o kategorię X") bez
  fuzzy-matchingu stringów — dokładnie ten problem, który dziś psuje `Family.bring`/
  `NEEDED_ITEMS` (string-match).
- Brief wyklucza przeprojektowanie modelu wypożyczalni/katalogu produktów — każde
  rozwiązanie musi pozostać niezależne od `Product`/`InventoryItem`.

### Considered Options
1. 3A — Wolny tekst: `NeededItem.description: string`, bez struktury.
2. **3B — Kategoria/tag z zamkniętego, rozszerzalnego słownika** (`category: enum`:
   instrument, mata/koc, materiały plastyczne, inne) + opcjonalny opis doprecyzowujący.
3. 3C — Pełna referencja do współdzielonego katalogu produktów (`productRef`), zbliżona do
   `Product`/`InventoryItem` z modelu wypożyczalni.

### Decision Outcome
Chosen option: 3B, ponieważ 3A powtarzałaby dokładnie ten sam błąd string-matchingu, który
już zdiagnozowano jako problem w istniejącym kodzie, a 3C przekracza granicę zakresu badania
(zbliża się do zakazanego przeprojektowania modelu wypożyczalni) i rozwiązuje problem bez
potwierdzonej potrzeby. 3B bezpośrednio realizuje rekomendację z Fazy 1 badania ("opisem/
kategorią, nie referencją do cudzego Item").

### Consequences

#### Good
- Naprawia zidentyfikowaną niespójność — kategorie są neutralne, niczyje, nie z prywatnego
  katalogu organizatora.
- Umożliwia proste raportowanie/agregację bez fuzzy-matchingu ("najczęściej brakuje mat
  piankowych").
- Łatwe do rozszerzenia o nowe kategorie bez migracji strukturalnej (dodanie wartości do
  enuma, nie zmiana kształtu pola).
- Nie tworzy przedwczesnego sprzężenia z warstwą `Pledge`/`Reservation` (w przeciwieństwie do
  3C).

#### Bad
- Wymaga z góry zdefiniowanej listy kategorii, która może nie pokryć wszystkich realnych
  potrzeb — ryzyko ciągłego nadużywania kategorii "inne" jako wytrychu, co osłabiałoby
  korzyść raportowania.
- Dodaje warstwę zarządzania słownikiem (kto go utrzymuje, jak dodaje się nowe kategorie),
  której dziś nie ma.

---

## ADR-006: Primary contact User per Rodzina

### Status
Accepted

### Context
`Reservation.reservedBy` w systemie wypożyczalni wymaga pojedynczego `User`, nigdy
`Group`/`Family` (Finding 5). Rodzina jest jednak modelowana jako `Party(Group)` (ADR-001),
atomowa jednostka bez rozbicia na osoby — dzisiejszy kod reprezentuje zgłaszającego jako
anonimowe "Ciebie"/`you` (`KragGrupy.tsx:311`, singleton, brak pickera użytkownika). Trzeba
rozstrzygnąć, kiedy i jak tożsamość pojedynczej osoby "schodzi" z poziomu Rodziny do poziomu
`User`, wymaganego przez `Pledge`→`Reservation`.

### Decision Drivers
- Insight 3 z raportu badawczego: tożsamość musi zejść z poziomu Grupy/Rodziny do poziomu
  `User` zanim powstanie `Reservation` — to twardy wymóg integracyjny, nie opcjonalny
  szczegół.
- Confidence "Low" dla potrzeby pełnego modelu multi-opiekuna — kod nie daje dowodu na
  potrzebę wielu niezależnych tożsamości w obrębie jednej Rodziny (YAGNI).
- Ryzyko odłożenia decyzji "na później": raport wprost ostrzega, że retrofit tożsamości bez
  wcześniejszego zaprojektowania punktu konwersji powtórzyłby wzorzec "dwóch
  niepołączonych mechanizmów" już zaobserwowany w Finding 3 (prośba/ochotnik).

### Considered Options
1. 4A — Pełny `Person` jako część modelu Party od razu: Rodzina od startu ma jawnych
   członków jako osobne `Party(Person)` z osobną tożsamością/loginem dla każdego opiekuna.
2. 4B — Odłożyć: Rodzina pozostaje atomowa, tożsamość `User` rozstrzygana ad-hoc dopiero w
   momencie konwersji `Pledge`→`Reservation`.
3. **4C — Hybryda: jeden `primaryContact: User` per Rodzina od początku**, bez pełnego
   modelu wielu osób, ale z jawnym, ustrukturyzowanym punktem tożsamości.

### Decision Outcome
Chosen option: 4C, ponieważ 4A byłaby inwestycją w niepotwierdzoną potrzebę (naruszenie
YAGNI, jawny cytat anonimowego singletona w kodzie jako dowód przeciwny), a 4B niesie
konkretne, zidentyfikowane w raporcie ryzyko powtórki wzorca "dwóch niepołączonych
mechanizmów", jeśli retrofit nie zostanie przemyślany z wyprzedzeniem. 4C zamyka lukę
tożsamości świadomie i od początku, bez kosztu modelowania wielu osób.

### Consequences

#### Good
- Eliminuje ryzyko "nagłego pytania ad-hoc" przy konwersji Pledge→Reservation — `User` jest
  już znany, bo istnieje od założenia Rodziny.
- Minimalny koszt implementacji — jedno dodatkowe pole/FK na Rodzinie, nie osobna relacja
  wewnątrz rodziny.
- Addytywnie rozszerzalne do 4A później (dodanie kolejnych `User` powiązanych z Rodziną to
  rozszerzenie, nie migracja struktury), jeśli multi-opiekun stanie się potwierdzoną
  potrzebą.

#### Bad
- Nie obsługuje bezpośrednio scenariusza "dwoje rodziców, każde loguje się osobno i zgłasza
  się jako siebie" — to kompromis, nie pełne rozwiązanie multi-opiekuna.
- Wymaga zdefiniowania zachowania, gdy `primaryContact` "odejdzie" (zmiana opiekuna) — mały,
  ale realny przypadek brzegowy pozostawiony do fazy specyfikacji.
