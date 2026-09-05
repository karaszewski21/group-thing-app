# Solution Exploration: Party Archetype — Organizator → Grupa → Uczestnicy

**Wejście**: `analysis/synthesis.md`, `outputs/research-report.md` (Faza 1, confidence: high dla Fit Testu i klasyfikacji Party Types; medium dla cardinality).

**Zakres tego dokumentu**: brainstorming WYŁĄCZNIE czterech otwartych decyzji oznaczonych **(X)** w raporcie badawczym. Fundamentalne rozstrzygnięcia — Organizator=`Person`, Grupa/Rodzina=`Party(Group)`, potrzeba osobnego konceptu `Pledge` (nie `Relationship` Party, nie `Reservation`) — są traktowane jako dane wejściowe, niepodważane tutaj.

**Twardy kontrakt, którego żadna alternatywa nie może naruszyć**: `Reservation.itemId: string` (wymagane, nie-nullable) i `Reservation.reservedBy: User` (nigdy `Group`/`Family`) — z `docs/system-wypozyczalni-inventory-accounting.md`, potwierdzone w Finding 4/5 raportu. Każda alternatywa poniżej musi zachować granicę Pledge→Reservation zdefiniowaną w Fazie 1.

---

## Problem Reframing

### Research Question

Jak zamodelować Organizator→Grupa→Uczestnicy przy pomocy Party Archetype i gdzie umieścić "prośbę o rzecz na zajęcia"/"zgłoszenie na ochotnika" względem systemu wypożyczalni?

### How Might We Questions (wyprowadzone z obszarów (X))

- **HMW-1**: Jak zamodelować cardinality `leadership`, żeby wspierać realne scenariusze prowadzenia zajęć (w tym ewentualne współprowadzenie/zastępstwa), nie komplikując modelu ponad potrzebę?
- **HMW-2**: Jak zamodelować cardinality `membership`, żeby odzwierciedlić to, czy rodzina realnie może uczestniczyć w więcej niż jednej grupie, bez wymuszania złożoności, której dzisiejszy prototyp nie sugeruje?
- **HMW-3**: Jak ustrukturyzować pole "opis potrzeby" na `Term`, żeby było użyteczne do dopasowania/raportowania, a jednocześnie nie zakładało istnienia współdzielonego katalogu produktów, którego dziś nie ma?
- **HMW-4**: Kiedy i jak wprowadzić tożsamość pojedynczej osoby (Person/User) w obrębie Rodziny, skoro `Reservation.reservedBy` wymaga `User`, a dziś model operuje na anonimowym "Ciebie"?

---

## Obszar 1: Cardinality relacji `leadership` (Organizator ↔ Grupa)

### Alternatywa 1A: Ścisłe 1:N (jeden aktywny organizator na grupę, jeden organizator może prowadzić wiele grup)

**Opis**: `leadership` to relacja z co najwyżej jedną aktywną (niezamkniętą) instancją per Grupa w danym momencie. Zmiana organizatora = zamknięcie starej instancji (`validTo`) + otwarcie nowej. Dokładnie to, co raport oznaczył jako założenie robocze.

**Mocne strony**: najprostszy model do zaimplementowania i zapytania ("kto dziś prowadzi tę grupę?" = jeden wiersz); zero konfliktów uprawnień (kto może edytować `Term`, kto akceptuje `Pledge` — zawsze jednoznaczne); zgodne z tym, jak `KragGrupy.tsx:439-443` dziś wizualnie przedstawia dokładnie jedną osobę w centrum okręgu.

**Słabe strony**: nie obsługuje realnego scenariusza "dwie prowadzące na zmianę" lub "asystentka współprowadzi" bez sztucznego obejścia (np. seria krótkich `validFrom`/`validTo` przy każdych zajęciach, co jest nadużyciem modelu walidacji zaprojektowanego dla wolniejszych zmian).

**Best when**: organizator faktycznie jest pojedynczą, stabilną osobą per grupa (co dzisiejszy kod sugeruje, choć tego nie potwierdza) i zmiany prowadzenia są rzadkie/sezonowe, nie tygodniowe.

**Evidence links**: Concept Mapping raportu (Organizator↔Grupa dziś czysto pozycyjne, jeden hardcoded string w centrum okręgu — `KragGrupy.tsx:439-443`); Role Types (`Organizer`, "Multiple concurrent" odnosi się do wielu grup per organizator, nie do wielu organizatorów per grupa).

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Wysoka — prosty FK + walidacja "jeden aktywny na Grupę" |
| User Impact | Neutralny — pasuje do dzisiejszego UI (jedna osoba widoczna jako prowadząca) |
| Simplicity | Wysoka — najmniej stanów do obsłużenia |
| Risk | Niskie ryzyko techniczne; średnie ryzyko produktowe jeśli współprowadzenie jest realną potrzebą, którą trzeba będzie dorobić później |
| Scalability | Ogranicza się przy realnym współprowadzeniu — wymagałby migracji modelu (nie tylko danych) |

### Alternatywa 1B: N:N od startu (pełne współprowadzenie)

**Opis**: `leadership` dopuszcza wiele jednocześnie aktywnych instancji per Grupa — każda z własnym `validFrom`/`validTo`. Dowolna liczba organizatorów może współistnieć.

**Mocne strony**: obsługuje każdy scenariusz (współprowadzenie, płynne przekazywanie, zastępstwa) bez zmiany modelu w przyszłości; jeden spójny mechanizm zamiast dwóch (relacja podstawowa + osobny mechanizm delegacji).

**Słabe strony**: wprowadza pytania, których dzisiejszy kod/wymagania w ogóle nie sugerują ("kto ma ostateczny głos, gdy dwóch organizatorów edytuje ten sam `Term` jednocześnie?", "czy uprawnienia obu są identyczne?") — realne ryzyko over-engineeringu względem obserwowanego stanu (raport: "every cross-reference... is either positional... or free-text string match", brak jakiegokolwiek dowodu na współprowadzenie). Koszt UI/UX do obsługi wielu prowadzących nie jest trywialny, mimo że leży poza zakresem tego badania.

**Best when**: współprowadzenie jest znanym, częstym scenariuszem biznesowym (np. duże zajęcia z asystentką, rotacyjne prowadzenie w spółdzielni rodzicielskiej) — ale to nie jest potwierdzone w żadnym źródle.

**Evidence links**: ARCH sygnał "multi-role" (SKILL.md:16) — cytowany w raporcie jako uzasadnienie dla Organizatora mogącego prowadzić wiele grup, NIE jako dowód na wiele osób prowadzących jedną grupę; to ekstrapolacja, nie fakt z badania.

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Średnia — wymaga dodatkowej logiki uprawnień przy konfliktach edycji |
| User Impact | Nieznany/spekulatywny — brak dowodu, że użytkownicy tego potrzebują |
| Simplicity | Niska — najwięcej przypadków brzegowych |
| Risk | Wysokie ryzyko rozwiązywania nieistniejącego problemu (scope creep względem dowodów) |
| Scalability | Najwyższa teoretycznie, ale niepotrzebna bez potwierdzonego wymagania |

### Alternatywa 1C: 1:N z osobnym mechanizmem "zastępstwa"/delegacji (bez pełnego współprowadzenia)

**Opis**: Relacja `leadership` pozostaje ściśle 1:N (jeden aktywny organizator "właściciel" grupy), ale dodaje się osobny, czasowo ograniczony mechanizm delegacji (np. `Delegation`: `fromOrganizer`, `toPerson`, `validFrom`/`validTo`, `scope=Term` lub `scope=Grupa`), który pozwala innej osobie tymczasowo działać w imieniu organizatora (np. prowadzić konkretne zajęcia, akceptować `Pledge`) bez zmiany "kto jest właścicielem" grupy.

**Mocne strony**: rozwiązuje realny scenariusz "zastępstwo na jedne zajęcia" bez komplikowania rdzenia `leadership`; zachowuje jednoznaczność "kto jest głównym organizatorem" (ważne dla raportowania, punktów, odpowiedzialności); delegacja jako osobny, mały koncept jest łatwa do pominięcia w MVP i dodania później bez zrywania rdzenia.

**Słabe strony**: dwa koncepty zamiast jednego (`leadership` + `Delegation`) zwiększają powierzchnię modelu; wymaga jasnej reguły, co się dzieje z uprawnieniami delegata (czy może tworzyć `Term`? akceptować `Pledge`? to pytania produktowe wykraczające poza zakres tego badania, ale muszą zostać rozstrzygnięte przy projektowaniu `Delegation`).

**Best when**: zastępstwa/tymczasowe prowadzenie są realnym, ale rzadkim scenariuszem (typowe dla zajęć cyklicznych z jedną główną prowadzącą i okazjonalnymi zastępstwami), a pełne współprowadzenie nie jest potrzebne.

**Evidence links**: brak bezpośredniego dowodu w kodzie (żadna z tych relacji nie istnieje jako dane — Finding 1), ale spójne z ARCH borderline-case ostrzeżeniem (SKILL.md:55-59) o niepowiększaniu modelu bez potrzeby oraz z zasadą unikania "role explosion" (SKILL.md:343-353) already zacytowaną w raporcie przy okazji `Volunteer`.

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Średnia — nowy, ale mały i izolowany koncept |
| User Impact | Wysoki potencjał — realistyczne dopasowanie do "prowadzące czasem się zastępują" |
| Simplicity | Średnia — rdzeń zostaje prosty (1:N), złożoność jest opt-in |
| Risk | Niskie — nie zmienia rdzenia, łatwo odłożyć do fazy 2 |
| Scalability | Dobra — rozszerzalna bez migracji rdzenia `leadership` |

### Rekomendacja: Obszar 1

**Wybrana**: **Alternatywa 1A (ścisłe 1:N)** jako model startowy, z **1C (delegacja)** jako udokumentowanym, ale odłożonym rozszerzeniem (nie budować teraz).

**Uzasadnienie**: raport nie dostarcza żadnego dowodu — ani w kodzie, ani w wymaganiach — na współprowadzenie (1B). Zasada minimal-implementation ("build only what is needed") i borderline-case guidance z metodologii ARCH wskazują na najprostszy model zgodny z obserwowanym stanem. 1A jest też najłatwiejsza do rozszerzenia w stronę 1C, gdyby zastępstwa okazały się potrzebne — a 1C jest z kolei stanowczo łatwiejsza do dodania niż wycofanie się z N:N (1B), gdyby się okazało niepotrzebne. To asymetria ryzyka na korzyść 1A.

**Kluczowe założenie, które obala tę rekomendację**: jeśli produkt faktycznie zakłada regularne współprowadzenie (nie tylko zastępstwa) jako częsty scenariusz — to należy przejść bezpośrednio do 1B, bo dorabianie N:N po fakcie do modelu zbudowanego jako 1:N jest kosztowną migracją (zmiana unikalności, nie tylko dodanie wierszy).

---

## Obszar 2: Cardinality relacji `membership` (Rodzina ↔ Grupa)

### Alternatywa 2A: N:N od startu

**Opis**: Rodzina może mieć wiele jednocześnie aktywnych instancji `membership` (do różnych Grup); Grupa ma wiele Rodzin. Dokładnie założenie robocze z raportu.

**Mocne strony**: naturalnie odzwierciedla realny scenariusz "jedna rodzina zapisana na zajęcia muzyczne I na zajęcia plastyczne jednocześnie" — co jest bardzo prawdopodobne w domenie "zajęcia dla rodzin"; unika kosztownej migracji, jeśli multi-membership okaże się potrzebne później.

**Słabe strony**: żaden z 7 plików `pages/` dziś nie zakłada nawigacji "wybierz, do której grupy należysz" — każdy panel (`KragGrupy`, `PanelGoscia`) operuje na jednej grupie na raz (raport, Implementation Notes: "(X) ... każdy panel w `pages/` operuje na jednej grupie na raz, co nie przesądza modelu docelowego" — ale też nie potwierdza N:N).

**Best when**: domena rzeczywiście przewiduje, że rodziny zapisują się na wiele równoległych cykli zajęć (co jest wysoce prawdopodobne dla tego typu produktu, choć niepotwierdzone wprost).

**Evidence links**: ARCH przykład Group="Family, Class" (SKILL.md:106) nie przesądza cardinality; Gaps and Uncertainties w syntezie wprost: "brak dowodu; przyjęto N:N jako założenie robocze (X), do potwierdzenia".

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Wysoka — standardowa tabela łącząca |
| User Impact | Wysoki potencjał — dopasowuje się do prawdopodobnego realnego użycia (wiele zajęć naraz) |
| Simplicity | Średnia — wymaga UI do przełączania kontekstu grupy (poza zakresem tego badania, ale to konsekwencja modelu) |
| Risk | Niskie — zgodne z najbardziej prawdopodobnym realnym scenariuszem |
| Scalability | Wysoka — nie wymaga migracji, jeśli założenie się potwierdzi |

### Alternatywa 2B: Ścisłe 1:N (rodzina w jednej grupie na raz)

**Opis**: Rodzina ma co najwyżej jedną aktywną instancję `membership` w danym momencie. Zmiana grupy = zamknięcie starej + otwarcie nowej (analogicznie do 1A dla leadership).

**Mocne strony**: dokładnie zgodne z tym, co KAŻDY panel w `pages/` dziś zakłada strukturalnie (jedna grupa w centrum ekranu, `FAMILIES` jako lista "rodzin tej grupy", brak jakiegokolwiek UI do przełączania między grupami) — to jedyna z trzech alternatyw, która ma bezpośrednie, pozytywne wsparcie w obserwowanym kodzie, a nie tylko brak zaprzeczenia; najprostszy model.

**Słabe strony**: realistycznie ogranicza produkt — rodziny z dziećmi na różnych zajęciach (typowy scenariusz) nie mogłyby być reprezentowane poprawnie; wymagałoby osobnej "Rodziny" per grupa, co dubluje dane i łamie ideę Rodziny jako spójnej jednostki Party.

**Best when**: produkt świadomie skupia się na modelu "jedna rodzina = jedna grupa zajęciowa" (np. każda grupa to osobna "klasa" i rodzina zapisuje się raz na sezon) — możliwe, ale sprzeczne z intuicją domeny "zajęcia dla dzieci" (rodziny zwykle zapisują różne dzieci na różne zajęcia).

**Evidence links**: CB — struktura każdego z 7 plików `pages/` (jeden `Group`/kontekst na panel, brak przełącznika grup).

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Wysoka — najprostsza |
| User Impact | Ryzyko negatywne — realistycznie ogranicza użycie produktu |
| Simplicity | Najwyższa |
| Risk | Średnie — ryzyko, że model trzeba będzie migrować do N:N krótko po wdrożeniu |
| Scalability | Niska — najbardziej prawdopodobny kandydat do przebudowy |

### Alternatywa 2C: N:N z jedną grupą "primary"/domyślną

**Opis**: Jak 2A (N:N, wiele aktywnych `membership`), ale jedna instancja jest oznaczona jako `isPrimary: true` per Rodzina — używana jako domyślny kontekst przy logowaniu/nawigacji, bez ograniczania liczby faktycznych członkostw.

**Mocne strony**: łączy elastyczność 2A z prostotą UX 2B (jest zawsze jeden domyślny kontekst do pokazania, unikając potrzeby przełącznika grup w pierwszej iteracji UI); łatwe dojście od 2B — "primary" to naturalne pierwsze membership.

**Słabe strony**: dodatkowe pole i reguła niesie własną złożoność (co się dzieje z `isPrimary`, gdy ta relacja się kończy — czy automatycznie inna staje się primary? kolejna decyzja stanu do zaprojektowania); to szczegół częściowo UX, który wykracza w stronę warstwy prezentacji — ryzyko przekroczenia zakresu modelu domenowego tego badania.

**Best when**: N:N jest potrzebne modelowo, ale produkt chce uniknąć budowania UI do przełączania kontekstu grupy w pierwszej wersji.

**Evidence links**: brak bezpośredniego dowodu w kodzie; to synteza 2A+2B jako łagodzenie ryzyka UX N:N, nie osobny wzorzec zaobserwowany w źródłach.

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Średnia — jedno dodatkowe pole + reguła spójności |
| User Impact | Wysoki — zachowuje prostotę UI dzisiejszych paneli przy pełnej elastyczności danych |
| Simplicity | Średnia — nieco więcej reguł niż czyste 2A |
| Risk | Niskie |
| Scalability | Wysoka |

### Rekomendacja: Obszar 2

**Wybrana**: **Alternatywa 2A (N:N od startu)**, z notatką, że **2C jest naturalnym rozszerzeniem UX**, gdy zajdzie potrzeba przełącznika kontekstu (poza zakresem modelu domenowego).

**Uzasadnienie**: w przeciwieństwie do Obszaru 1 (gdzie brak dowodu przemawiał za prostszym modelem), tu domena sama sugeruje wielość — "zajęcia dla dzieci/rodzin" to kontekst, w którym pojedyncza rodzina bardzo prawdopodobnie uczestniczy w wielu równoległych aktywnościach (różne dzieci, różne zajęcia). Koszt wdrożenia N:N od razu (tabela łącząca zamiast FK) jest minimalny, podczas gdy koszt migracji z 1:N na N:N później (Alternatywa 2B → 2A) obejmowałby migrację danych i zmianę unikalności — asymetryczne ryzyko na korzyść zaczynania od N:N, w przeciwieństwie do Obszaru 1.

**Kluczowe założenie, które obala tę rekomendację**: jeśli produkt jest świadomie zawężony do modelu "jedna rodzina, jeden cykl zajęć na raz" (np. z powodów biznesowych, nie technicznych) — 2B jest właściwsza i lepiej odzwierciedla dzisiejszy, jedyny zaobserwowany wzorzec UI.

---

## Obszar 3: Kształt pola "opis potrzeby" na `Term`

### Alternatywa 3A: Wolny tekst

**Opis**: `NeededItem.description: string` — organizator/system po prostu zapisuje opis słowny ("mata piankowa", "tamburyn i dzwonki"), bez żadnej struktury poza tekstem.

**Mocne strony**: zero kosztu implementacji; rozwiązuje bezpośrednio zidentyfikowaną niespójność (Finding 3/Insight 2 raportu — obecny model `Term.neededItems` budowany z cudzego katalogu organizatora jest błędny) najmniejszym możliwym ruchem; elastyczne — obsługuje dowolny opis, którego nikt wcześniej nie przewidział.

**Słabe strony**: brak możliwości dopasowania/raportowania ("ile razy proszono o matę piankową w tym miesiącu?" wymaga fuzzy-matchingu stringów — dokładnie ten sam problem, który dziś psuje `Family.bring`/`NEEDED_ITEMS` string-match, CB §1.2); brak wsparcia dla i18n/normalizacji pisowni.

**Best when**: produkt jest wciąż na etapie walidacji pomysłu (co odpowiada obecnemu stanowi "prototyp bez backendu") i raportowanie/dopasowanie nie jest priorytetem.

**Evidence links**: Cross-Source Analysis w syntezie — "obie [wersje] są prawdziwe, równolegle istniejące fragmenty tego samego, niedokończonego prototypu"; Insight potwierdza, że żaden obecny mechanizm nie nadaje się do skopiowania, więc wolny tekst byłby świadomym uproszczeniem, nie kontynuacją błędu.

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Najwyższa |
| User Impact | Neutralny/dobry — brak tarcia przy wpisywaniu |
| Simplicity | Najwyższa |
| Risk | Niskie teraz, rośnie z czasem (dług dopasowania/raportowania) |
| Scalability | Niska — string-matching nie skaluje się do raportowania/agregacji |

### Alternatywa 3B: Kategoria/tag z zamkniętego słownika

**Opis**: `NeededItem.category: enum` (np. "instrument", "mata/koc", "materiały plastyczne", "inne" + opcjonalny wolny opis doprecyzowujący) — zamknięty, ale rozszerzalny słownik kategorii, niezależny od czyjegokolwiek prywatnego katalogu `Item[]`.

**Mocne strony**: bezpośrednio naprawia zidentyfikowaną niespójność (organizator nie wybiera już z WŁASNEGO katalogu — kategorie są neutralne, niczyje); umożliwia proste raportowanie/agregację ("najczęściej brakuje mat piankowych") bez kosztu pełnego katalogu produktów; łatwe do rozszerzenia o nowe kategorie bez migracji strukturalnej.

**Słabe strony**: wymaga z góry zdefiniowanej listy kategorii, która może nie pokryć wszystkich realnych potrzeb (ryzyko ciągłego dodawania "inne" jako wytrychu); dodaje warstwę zarządzania słownikiem (kto go utrzymuje?), której dziś nie ma.

**Best when**: potrzeby są w praktyce powtarzalne i ograniczone do kilku typów rzeczy (co pasuje do domeny "zajęcia dla dzieci" — maty, instrumenty, materiały plastyczne, koce — skończony, przewidywalny zestaw).

**Evidence links**: bezpośrednio adresuje Insight z Unmapped Concepts raportu: "sygnał, że docelowy model 'potrzeby' powinien być opisem/kategorią, nie referencją do cudzego `Item`" — to dosłownie rekomendacja z Fazy 1, tu rozwinięta w pełną alternatywę.

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Średnia — nowy słownik + ewentualne pole doprecyzowujące |
| User Impact | Dobry — łatwiejszy wybór niż wolny tekst, mniej pracy niż pełny katalog |
| Simplicity | Średnia |
| Risk | Niskie — łatwo rozszerzać słownik bez migracji struktury |
| Scalability | Dobra dla raportowania w skali produktu tej wielkości |

### Alternatywa 3C: Pełna referencja do współdzielonego katalogu produktów (bliżej `Product`/`InventoryItem`)

**Opis**: `NeededItem.productRef` wskazuje na pozycję we wspólnym, współdzielonym katalogu typów przedmiotów (nie prywatnym katalogu organizatora), koncepcyjnie zbliżonym do `Product` z modelu wypożyczalni — każda "potrzeba" odnosi się do konkretnego, ustandaryzowanego typu rzeczy.

**Mocne strony**: najsilniejsza podstawa do przyszłego dopasowania/automatyzacji (np. system mógłby sam sugerować, kto ma dany typ przedmiotu w swoim `Inventory`); najbliżej spójności z modelem wypożyczalni, gdzie `InventoryItem` i tak będzie musiał istnieć w kroku Pledge→Reservation.

**Słabe strony**: największy koszt implementacji — wymaga zbudowania i utrzymania współdzielonego katalogu produktów, którego dziś nigdzie nie ma (INV operuje na `InventoryItem` per-user, nie na globalnym katalogu typów); realne ryzyko przedwczesnej abstrakcji — rozwiązuje problem ("dopasowanie do konkretnego produktu"), którego żadne źródło jeszcze nie potwierdziło jako potrzebny teraz; graniczy z redesignem modelu wypożyczalni, co brief wprost wyklucza.

**Best when**: produkt dojrzeje do punktu, w którym systemowe dopasowywanie próśb do konkretnych zasobów (nie tylko deklaracja chęci) staje się realną potrzebą biznesową — nie teraz.

**Evidence links**: raport ostrzega wprost przed tym kierunkiem: "`Item` odpowiada `InventoryItem`/`Product`... poza zakresem tego badania — brief wyklucza przeprojektowanie modelu punktowego/inventory" (Unmapped Concepts) — 3C balansuje na granicy tego ograniczenia.

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Niska w tej fazie — wymaga nowej infrastruktury katalogowej |
| User Impact | Potencjalnie wysoki długoterminowo, ale niepotwierdzony teraz |
| Simplicity | Najniższa |
| Risk | Wysokie — ryzyko przedwczesnej złożoności i zbliżenia się do zakazanego zakresu (redesign modelu inventory) |
| Scalability | Najwyższa teoretycznie, ale niedopasowana do obecnej dojrzałości produktu |

### Rekomendacja: Obszar 3

**Wybrana**: **Alternatywa 3B (kategoria/tag z zamkniętego słownika)**.

**Uzasadnienie**: 3A jest zbyt słaba — powtarza dokładnie ten sam błąd string-matchingu, który raport już zdiagnozował jako problem w `Family.bring`/`NEEDED_ITEMS` (CB §1.2). 3C przekracza granicę zakresu badania (zbliża się do redesignu modelu inventory, wyraźnie wykluczonego w brief) i rozwiązuje problem bez potwierdzonej potrzeby. 3B jest jedyną alternatywą, która bezpośrednio realizuje rekomendację już sformułowaną w Fazie 1 ("opisem/kategorią, nie referencją do cudzego Item") — utrzymuje `NeededItem` jako koncept niezależny od jakiegokolwiek prywatnego lub wspólnego katalogu produktów, więc nie tworzy przedwczesnego sprzężenia z warstwą `Pledge`/`Reservation`.

**Kluczowe założenie, które obala tę rekomendację**: jeśli zestaw możliwych "potrzeb" jest w praktyce nieograniczony i nieprzewidywalny (nie tylko maty/instrumenty/koce, ale dowolne rzeczy specyficzne dla każdych zajęć) — zamknięty słownik będzie ciągle "przeciekał" do kategorii "inne", co unieważnia korzyść raportowania i zbliża 3B z powrotem do 3A.

---

## Obszar 4: Moment i sposób wprowadzenia indywidualnej tożsamości członka rodziny

### Alternatywa 4A: Pełny `Person` jako część modelu Party od razu (right-sizing teraz)

**Opis**: Rodzina (`Party(Group)`) od startu ma jawnych członków jako osobne `Party(Person)` z rolą "member of Family" (relacja analogiczna do `membership`, ale wewnątrz rodziny), z osobną tożsamością (np. `User`-powiązanie) dla każdego dorosłego opiekuna.

**Mocne strony**: rozwiązuje Insight 3 (tożsamość musi "zejść" z Grupy/Rodziny do User przed `Reservation`) raz a porządnie, bez żadnego punktu przejścia w przyszłości; wspiera z góry scenariusze multi-opiekun (dwoje rodziców, każde z osobnym loginem) i przyszłą autoryzację per-osoba.

**Słabe strony**: **wprost sprzeczne z dowodami z Fazy 1** — raport jawnie stwierdza "kod nie daje dowodu na potrzebę" (confidence: Low dla tej potrzeby) i cytuje `KragGrupy.tsx:311` (anonimowe "Ciebie"/`you`, singleton) jako dowód przeciwny; to najkosztowniejsza z trzech opcji, budowana pod niepotwierdzoną potrzebę — klasyczny sygnał ostrzegawczy z zasady minimal-implementation ("no future stubs or speculative abstractions").

**Best when**: wiadomo z góry (poza dowodami z tego badania — np. z rozmowy z product ownerem), że multi-opiekun i autoryzacja per-osoba są wymaganiem dnia pierwszego, nie przyszłości.

**Evidence links**: Gaps and Uncertainties w syntezie: "obecnie brak dowodu potrzeby... Low (obecnie 'nie potrzeba'); YAGNI".

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Średnia — więcej encji i relacji do zbudowania teraz |
| User Impact | Nieznany — potencjalnie dobry długoterminowo, zerowy dowód na potrzebę teraz |
| Simplicity | Niska — najbardziej złożona z trzech opcji na starcie |
| Risk | Wysokie — inwestycja w niepotwierdzoną potrzebę (naruszenie YAGNI) |
| Scalability | Najwyższa, ale przedwczesna |

### Alternatywa 4B: Odłożyć — rozstrzygnięcie ad-hoc przy konwersji Pledge→Reservation

**Opis**: Rodzina pozostaje atomową jednostką Party bez wewnętrznego rozbicia na osoby. Dopiero w momencie, gdy `Pledge` konwertuje się w `Reservation` (bo ktoś faktycznie rejestruje `InventoryItem`), system wymaga wskazania/utworzenia jednego reprezentującego `User` — bez trwałego modelowania "kto jest kim w rodzinie".

**Mocne strony**: dokładnie zgodne z YAGNI i z oceną confidence "Low" z raportu; nie buduje niczego, czego obecny dowód nie wymaga; minimalna zmiana względem dzisiejszego stanu (anonimowe "Ciebie" zastępuje się jednorazowym pytaniem "jako kto to rejestrujesz?" dokładnie w punkcie, gdzie `Reservation.reservedBy: User` tego wymaga — czyli dokładnie na granicy Pledge→Reservation zaprojektowanej w Fazie 1).

**Słabe strony**: raport sam ostrzega przed tym ryzykiem (Risks w Analysis and Insights): "jeśli tożsamość pojedynczej osoby w rodzinie zostanie wprowadzona później 'na szybko', bez przemyślenia relacji do Pledge/Reservation, może powstać kolejna, osobna, niepołączona struktura — powtórka wzorca z Finding 3" (dokładnie ten błąd, który już popełniono z `Term.neededItems` vs `NEEDED_ITEMS`); "ad-hoc" musi być zaprojektowane świadomie (jasny punkt w przepływie), nie zaimplementowane przypadkowo, inaczej odtwarza dokładnie problem, który to badanie miało rozwiązać.

**Best when**: potrzeba osobnej tożsamości faktycznie pozostaje rzadka/marginalna (większość rodzin ma jednego głównego kontaktowego opiekuna, co jest zgodne z modelem "Ciebie" jako singleton w dzisiejszym kodzie).

**Evidence links**: Gaps and Uncertainties: "Otwarte, świadomie odłożone (YAGNI) pytanie"; Implementation Notes: "**(X)** Indywidualna tożsamość Person dla członków rodziny nie jest wprowadzana teraz — YAGNI".

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Wysoka — minimalna zmiana strukturalna teraz |
| User Impact | Dobry teraz (brak dodatkowego tarcia), ryzykowny później (nagłe pytanie "jako kto?" bez przygotowania) |
| Simplicity | Wysoka teraz |
| Risk | Średnie — realne ryzyko powtórki wzorca "dwa niepołączone mechanizmy" (Finding 3), jeśli retrofit nie będzie świadomie zaprojektowany z wyprzedzeniem |
| Scalability | Niska bez dodatkowej dyscypliny projektowej przy retrofit |

### Alternatywa 4C: Hybryda — jeden domyślny "primary contact" `User` per Rodzina od początku

**Opis**: Rodzina (`Party(Group)`) ma od startu jedno pole/relację wskazującą na dokładnie jednego reprezentującego `User` ("primary contact") — bez pełnego modelu wielu osób, ale z jawnym, ustrukturyzowanym punktem tożsamości zamiast anonimowego "Ciebie".

**Mocne strony**: eliminuje ryzyko z 4B (nie ma "nagłego pytania ad-hoc" przy konwersji — `User` jest już znany, bo istnieje od założenia Rodziny) bez kosztu 4A (brak potrzeby modelowania wielu osób/relacji wewnątrz rodziny); naturalny punkt startowy, który da się rozszerzyć do 4A później (dodanie kolejnych `User` powiązanych z Rodziną to rozszerzenie addytywne, nie migracja struktury).

**Słabe strony**: nadal nie obsługuje bezpośrednio scenariusza "dwoje rodziców, każde loguje się osobno i każde może zgłosić się na ochotnika jako 'siebie'" — w tym sensie to kompromis, nie pełne rozwiązanie; wymaga zdefiniowania, co się dzieje, gdy primary contact "odejdzie" (zmiana opiekuna) — mały, ale realny przypadek brzegowy.

**Best when**: potrzeba jest realna (Rodzina musi mieć jakiś jawny punkt kontaktu do celów `Reservation.reservedBy`), ale pełne multi-osobowe modelowanie jest przedwczesne — co pasuje dokładnie do sytuacji opisanej w raporcie (obecny model ma dokładnie jedną anonimową osobę reprezentującą rodzinę, `KragGrupy.tsx:311`).

**Evidence links**: bezpośrednio adresuje Insight 3 raportu ("tożsamość musi zejść z poziomu Grupy/Rodziny do poziomu User zanim powstanie Reservation") w sposób ustrukturyzowany, zamiast pozostawiać to jako niezaprojektowany punkt decyzyjny (ryzyko z 4B) lub przedwczesną pełną strukturę (koszt z 4A).

| Perspektywa | Ocena |
|---|---|
| Technical Feasibility | Wysoka — jedno dodatkowe pole/FK na Rodzinie |
| User Impact | Dobry — zero dodatkowego tarcia przy zgłaszaniu, jasny punkt tożsamości |
| Simplicity | Wysoka — jeden User zamiast N |
| Risk | Niskie — rozwiązuje Insight 3 świadomie, bez inwestycji w niepotwierdzoną wielość osób |
| Scalability | Dobra — addytywnie rozszerzalna do 4A, jeśli multi-opiekun stanie się potwierdzoną potrzebą |

### Rekomendacja: Obszar 4

**Wybrana**: **Alternatywa 4C (hybryda — jeden primary contact `User` per Rodzina od początku)**.

**Uzasadnienie**: 4A jest odrzucana wprost na podstawie dowodów Fazy 1 (confidence "Low" dla potrzeby, jawny cytat anonimowego singletona) — budowanie pełnego modelu wielu osób byłoby naruszeniem YAGNI. 4B jest kusząca jako "nic nie rób teraz", ale raport sam identyfikuje konkretne ryzyko tej ścieżki — powtórkę wzorca "dwa niepołączone mechanizmy" (Finding 3), jeśli retrofit nie zostanie przemyślany z wyprzedzeniem. 4C rozwiązuje dokładnie ten problem: jest to zaprojektowany, jawny punkt tożsamości (nie ad-hoc łatka przy konwersji), a jednocześnie nie inwestuje w strukturę wielu osób, na której potrzebę nie ma dowodu. To najlepiej balansuje Insight 3 (tożsamość musi zejść do poziomu User) z zasadą minimal-implementation.

**Kluczowe założenie, które obala tę rekomendację**: jeśli multi-opiekun z osobnymi kontami i osobną atrybucją zgłoszeń jest znanym wymaganiem produktowym (nie tylko teoretyczną możliwością) — należy przejść od razu do 4A, ponieważ 4C nie obsługuje "kto konkretnie z rodziny się zgłosił", tylko "kto jest kontaktem rodziny", co jest węższym rozwiązaniem.

---

## Trade-Off Analysis — zbiorcze podsumowanie

| Obszar | Alternatywa rekomendowana | Technical Feasibility | User Impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|---|
| 1. `leadership` cardinality | 1A: ścisłe 1:N (+ 1C jako odłożone rozszerzenie) | Wysoka | Neutralny | Wysoka | Niskie | Ograniczona bez 1C |
| 2. `membership` cardinality | 2A: N:N od startu | Wysoka | Wysoki potencjał | Średnia | Niskie | Wysoka |
| 3. Kształt "potrzeby" | 3B: kategoria/tag zamknięty | Średnia | Dobry | Średnia | Niskie | Dobra |
| 4. Tożsamość członka rodziny | 4C: primary contact `User` | Wysoka | Dobry | Wysoka | Niskie | Dobra (addytywna) |

---

## Deferred Ideas (Stretch / Out-of-scope)

- **Mechanizm delegacji/zastępstwa (1C)** — celowo nie rozwijany teraz jako pełna specyfikacja; odnotowany jako naturalne rozszerzenie 1A, do zaprojektowania dopiero gdy zastępstwa okażą się realną potrzebą. **Klasyfikacja: Stretch.**
- **Przełącznik kontekstu grupy w UI (konsekwencja 2A/N:N membership)** — to zagadnienie UX/UI, wprost wykluczone z zakresu tego badania (brief: "no UI redesign"). **Klasyfikacja: Out-of-scope** (zanotowane, bo model N:N je implikuje, ale nie rozwiązywane tutaj).
- **Współdzielony katalog produktów (3C, `Product`-podobny)** — potencjalnie wartościowy w przyszłości dla automatycznego dopasowania próśb do zasobów, ale dziś zbliżałby się do redesignu modelu wypożyczalni, wprost zakazanego w brief. **Klasyfikacja: Out-of-scope.**
- **Pełny model multi-opiekuna z autoryzacją per-osoba (4A)** — odnotowany jako naturalna ścieżka rozwoju 4C, jeśli multi-opiekun stanie się potwierdzonym wymaganiem. **Klasyfikacja: Stretch.**
- **Zachowanie `Reservation.status: cancelled` względem otwartego `Pledge`** (co się dzieje z `Pledge`, gdy powiązana `Reservation` zostanie anulowana) — zidentyfikowane w Gaps and Uncertainties Fazy 1 jako nieudokumentowane w źródle INV; nie jest to decyzja (X) objęta zakresem tego brainstormingu (dotyczy stanu `Pledge`/`Reservation`, nie cardinality Party), ale wymaga rozstrzygnięcia przy projektowaniu stanu `Pledge`. **Klasyfikacja: Stretch — do specification-designer.**
- **Ujednolicenie czterech niespójnych słowników trybu wymiany** (`ItemMode`/`GiftSource`/`MODE_STYLE`/`EXCHANGE`) — raport jawnie odnotowuje, że rekomendacja leży w `pages/SPEC.md`, nie w tym badaniu. **Klasyfikacja: Out-of-scope.**

---

## Rekomendacja Konwergencji (spójność kombinacji)

Cztery rekomendacje (1A, 2A, 3B, 4C) są **wzajemnie spójne** i tworzą jeden koherentny model startowy:

- **1A + 2A**: asymetryczne cardinality (1:N dla leadership, N:N dla membership) nie są sprzeczne — opisują różne relacje z różnym poziomem dowodów; oba są niezależne od siebie strukturalnie (żadna nie zakłada tej drugiej).
- **2A + 4C**: N:N membership (rodzina w wielu grupach) współgra z 4C (jeden primary contact per Rodzina, niezależnie od tego, w ilu grupach rodzina uczestniczy) — primary contact jest atrybutem Rodziny jako całości, nie per-membership, więc się nie mnoży.
- **3B + Pledge (Faza 1)**: kategoria/tag jako `neededItemRef` w strukturze `Pledge` zaproponowanej w raporcie pasuje bezpośrednio — pole `neededItemRef` może wprost wskazywać na kategorię z 3B zamiast na wolny tekst lub referencję do katalogu.
- **4C + Pledge→Reservation (Faza 1)**: 4C bezpośrednio zasila krok konwersji opisany w raporcie ("rodzina musi mieć co najmniej jednego powiązanego User") — 4C czyni to pole jawnym i istniejącym od początku, zamiast punktem ad-hoc decyzji przy każdej konwersji.

**Jedyna kombinacja wymagająca dodatkowej koordynacji**: jeśli w przyszłości wybrane zostanie 1C (delegacja) razem z 4A (pełny multi-person, rozszerzenie 4C) — te dwa rozszerzenia dotykają nakładających się pytań o uprawnienia ("czy delegat organizatora i czy dodatkowy opiekun rodziny mają te same uprawnienia co 'główna' osoba") i powinny być projektowane razem, nie niezależnie, żeby uniknąć niespójnego modelu autoryzacji.

**Rekomendowana kombinacja do przekazania do `solution-designer`**: **1A + 2A + 3B + 4C**, z 1C, 4A i przełącznikiem kontekstu grupy jako jawnie odnotowanymi punktami rozszerzenia na przyszłość (nie do projektowania teraz).

**Ogólny poziom pewności rekomendacji**: **Medium-High**. Wysoki dla 2A i 3B (silne dopasowanie do domeny i bezpośrednia zgodność z rekomendacją Fazy 1); Medium dla 1A i 4C (rozsądne na podstawie dostępnych dowodów, ale — zgodnie z regułą Step 7.5 metodologii Party cytowaną w obu dokumentach źródłowych — wszystkie cztery decyzje powinny zostać jawnie potwierdzone z użytkownikiem/product ownerem przed przekazaniem do implementacji, nie tylko przyjęte jako wynik brainstormingu).
