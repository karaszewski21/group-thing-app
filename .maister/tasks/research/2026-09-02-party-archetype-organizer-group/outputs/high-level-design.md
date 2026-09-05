# High-Level Design: Party Archetype dla Organizator → Grupa → Uczestnicy + Pledge

## Design Overview

**Kontekst biznesowy**: Aplikacja organizuje cykliczne zajęcia dla rodzin i towarzyszącą im wymianę/pożyczanie rzeczy. Dziś w `pages/` Organizator↔Grupa↔Rodzina istnieją wyłącznie jako pozycja na ekranie lub dopasowanie tekstu (`groupName: string`, hardcoded string w środku okręgu) — nie da się zapytać "kto prowadzi tę grupę" ani "kto był w niej w marcu". Równolegle "prośba o rzecz" i "zgłoszenie na ochotnika" żyją w dwóch niepołączonych mechanizmach (`Term.neededItems` vs `NEEDED_ITEMS`/`bringClaims`), a docelowy system wypożyczalni (`Reservation`/`InventoryItem`/`CirculationTransaction`) wymaga już istniejącego, konkretnego przedmiotu — więc żaden z obu mechanizmów nie może dziś bezpośrednio stać się `Reservation`.

**Wybrane podejście**: Domenę Organizator/Grupa/Rodzina modelujemy **archetypem Party** (Fowler) — `Person` grający rolę `Organizer`, `Group` jako Grupa zajęciowa, `Group` (z rolą `Member`) jako Rodzina — połączone dwiema **relacjami z walidacją czasową** (`[validFrom, validTo)`): `leadership` (Organizator→Grupa) i `membership` (Rodzina→Grupa). "Prośba o rzecz" pozostaje **atrybutem `Term`** (`NeededItem.category`), nie relacją Party. "Zgłoszenie na ochotnika" nie przechodzi Fit Testu Party (pytanie "w jakim jest stanie" → state machine) ani nie mieści się w `Reservation` (wymaga już istniejącego `itemId`) — wprowadzamy więc nowy, pośredni koncept stanowy **`Pledge`**, który referencuje Party jako "kto", ale żyje poza ścisłym archetypem Party i konwertuje się w niezmienioną `Reservation` dopiero w momencie, gdy konkretny `InventoryItem` zostanie zarejestrowany.

**Kluczowe decyzje:**
- **Organizator = `Party(Person)` + rola `Organizer`, Grupa = `Party(Group)`, Rodzina = `Party(Group)` + rola `Member`** — zgodne z przykładami archetypu ("Family, Class" jako `Group`) i z faktem, że Rodzina jest w kodzie jednostką atomową (ADR-001).
- **`leadership` = ścisłe 1:N** (jeden aktywny organizator na Grupę naraz, jeden organizator może prowadzić wiele Grup) — brak dowodu na współprowadzenie, model najprostszy zgodny z obserwowanym stanem (ADR-003).
- **`membership` = N:N od startu** (Rodzina może jednocześnie należeć do wielu Grup) — domena "zajęcia dla dzieci" silnie sugeruje wielość, a koszt migracji 1:N→N:N później jest wyższy niż odwrotnie (ADR-004).
- **`NeededItem.category: enum`** (zamknięty, rozszerzalny słownik: instrument, mata/koc, materiały plastyczne, inne) + opcjonalny opis wolnotekstowy — naprawia zidentyfikowaną niespójność (organizator wybierał z własnego katalogu) bez budowania przedwczesnego wspólnego katalogu produktów (ADR-005).
- **Rodzina ma jeden `primaryContact: User` od startu** — zamyka lukę tożsamości (Insight 3: Party musi "zejść" do poziomu User zanim powstanie `Reservation`) bez inwestowania w niepotwierdzoną potrzebę pełnego multi-opiekuna (ADR-006).
- **`Pledge` jako nowy, pośredni koncept stanowy** (nie `Relationship` Party, nie `Reservation`) — chroni niezmieniony kontrakt `Reservation.itemId`/`reservedBy: User`, jednocześnie łącząc dwa dziś niepołączone mechanizmy prośby/ochotnika (ADR-002).

---

## Architektura

### System Context (C4 Level 1)

```
                    ┌───────────────────────────┐
                    │        Organizator        │
                    │   (Person, rola Organizer)│
                    └─────────────┬─────────────┘
                                  │ prowadzi (leadership, 1:N)
                                  ▼
   ┌────────────────┐    ┌───────────────────┐    ┌────────────────────┐
   │     Rodzina     │───▶│   Domena Party     │◀───│  System Wypożyczalni │
   │ (Group, rola     │    │ Organizator/Grupa/ │    │  (Reservation /      │
   │  Member; N:N)    │    │ Rodzina + Term/    │    │  InventoryItem /     │
   │                  │    │ NeededItem/Pledge  │    │  CirculationTransac- │
   │  primaryContact  │    │                    │    │  tion) — NIEZMIENIONY│
   │  → User          │    │                    │    │  kontekst zewnętrzny │
   └────────────────┘    └───────────────────┘    └────────────────────┘
                                  │                          ▲
                                  │  Pledge (kto+co)          │  Reservation
                                  │  referencuje Party         │  (itemId wymagany,
                                  └────────────────────────────┘  reservedBy: User)
```

**Aktorzy/systemy**:
- **Organizator** (`Person`) — tworzy `Term`, opisuje `NeededItem`, jest jedynym aktywnym liderem Grupy w danym momencie.
- **Rodzina** (`Group`) — członek jednej lub wielu Grup, deklaruje `Pledge` przez swój `primaryContact` (`User`).
- **Domena Party** (ten design) — właściciel modelu Organizator/Grupa/Rodzina + Term/NeededItem/Pledge.
- **System Wypożyczalni** (zewnętrzny, niezmieniony kontekst, `docs/system-wypozyczalni-inventory-accounting.md`) — właściciel `Reservation`/`InventoryItem`/`CirculationTransaction`; domena Party integruje się z nim wyłącznie w punkcie konwersji `Pledge`→`Reservation`.

### Container Overview (C4 Level 2)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          DOMENA PARTY (ten design)                         │
│                                                                             │
│  ┌─────────────────────┐        ┌─────────────────────┐                   │
│  │   Party Layer        │        │  Term / NeededItem   │                   │
│  │  Person(Organizer)   │───────▶│  Term: kontekst zajęć │                   │
│  │  Group(Grupa)         │ leadership│  NeededItem:        │                   │
│  │  Group(Rodzina,       │ membership│   category(enum)    │                   │
│  │   Member,             │        │   + opis (opcjonalny) │                   │
│  │   primaryContact:User)│        └──────────┬───────────┘                   │
│  └─────────────────────┘                    │ opisuje potrzebę na Term       │
│                                              ▼                               │
│                                   ┌─────────────────────┐                    │
│                                   │      Pledge          │                    │
│                                   │  termId, neededItemRef│                   │
│                                   │  pledgedBy → Party    │                    │
│                                   │  status: open|claimed│                    │
│                                   │   |withdrawn|fulfilled│                   │
│                                   │  resolvedReservationId│                   │
│                                   └──────────┬───────────┘                    │
└──────────────────────────────────────────────┼───────────────────────────────┘
                                                │ konwersja przy rejestracji
                                                │ konkretnego InventoryItem
                                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                SYSTEM WYPOŻYCZALNI (zewnętrzny, NIEZMIENIONY)              │
│                                                                             │
│   InventoryItem ──▶ Reservation (itemId wymagany, reservedBy: User)       │
│                          │ pending → confirmed → fulfilled                │
│                          ▼                                                │
│                  CirculationTransaction (powstaje tylko przy fulfilled)   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Kontenery (jednostki logiczne, nie techniczne)**:
- **Party Layer** — odpowiada za tożsamość (`Person`), grupowanie (`Group`), role (`Organizer`, `Member`) i relacje z walidacją czasową (`leadership`, `membership`).
- **Term / NeededItem** — odpowiada za kontekst zajęć i ustrukturyzowany opis potrzeby (kategoria + opcjonalny opis), niezależny od jakiegokolwiek katalogu produktów.
- **Pledge** — odpowiada za śledzenie stanu zgłoszenia na ochotnika od deklaracji do rozstrzygnięcia, jako pomost między Party a systemem wypożyczalni.
- **System Wypożyczalni** — zewnętrzny, dany, niezmieniony kontekst integracyjny; ten design go konsumuje, nie modyfikuje.

---

## Kluczowe komponenty

| Komponent | Cel | Odpowiedzialności | Kluczowe interfejsy | Zależności |
|---|---|---|---|---|
| **Party (Person/Group)** | Reprezentować tożsamość i grupowanie aktorów domeny | • Przechowuje bazowe atrybuty tożsamości (Organizator, Grupa, Rodzina)<br>• Nosi role (`Organizer`, `Member`) scoped do konkretnej Grupy<br>• Jest punktem odniesienia dla relacji `leadership`/`membership` | Odczytywany przez Term (kto tworzy), przez Pledge (`pledgedBy`), przez warstwę integracji (mapowanie Person↔User) | Brak (warstwa bazowa) |
| **Relationship: `leadership`** | Wiązać Organizatora z Grupą, którą aktualnie prowadzi | • Utrzymuje dokładnie jedną aktywną instancję per Grupa (1:N)<br>• Zamyka starą instancję (`validTo`) i otwiera nową przy zmianie organizatora<br>• Odpowiada na pytania historyczne ("kto prowadził w marcu") | Odpytywane przez UI/raportowanie; referencowane pośrednio przy autoryzacji tworzenia `Term` | Party (Person, Group) |
| **Relationship: `membership`** | Wiązać Rodzinę z Grupą/Grupami, do których należy | • Utrzymuje N jednocześnie aktywnych instancji per Rodzina (N:N)<br>• Zamyka/otwiera instancje przy dołączeniu/opuszczeniu Grupy | Odpytywane przy budowaniu listy Rodzin danej Grupy; kontekst dla `Pledge.pledgedBy` | Party (Group×2) |
| **Term** | Reprezentować konkretne zajęcia/spotkanie w kontekście Grupy | • Wskazuje Grupę (FK, nie string-match) i Organizatora (przez `leadership`)<br>• Nosi listę `NeededItem` | Tworzony przez Organizatora danej Grupy (przez `leadership`); czytany przez Rodziny tej Grupy (przez `membership`) | Party (Group, przez leadership) |
| **NeededItem** | Ustrukturyzować opis potrzeby na danym Termie | • Przechowuje `category: enum` (zamknięty, rozszerzalny słownik)<br>• Przechowuje opcjonalny opis doprecyzowujący | Referencowany przez `Pledge.neededItemRef`; źródło dla raportowania/agregacji | Term |
| **Pledge** | Śledzić deklarację "przyniosę X" od zgłoszenia do rozstrzygnięcia | • Referencuje `Term`, `NeededItem`, `pledgedBy` (Party/Rodzina)<br>• Zarządza przejściami stanu: `open → claimed → withdrawn/fulfilled`<br>• Przechowuje `resolvedReservationId` po konwersji | Tworzony przez Rodzinę (przez `primaryContact`); konwertowany na `Reservation` przy rejestracji `InventoryItem` | NeededItem, Party (pledgedBy), Integration Bridge |
| **Integration Bridge (Person↔User)** | Rozwiązać tożsamość Party do konkretnego `User` wymaganego przez `Reservation` | • Utrzymuje `primaryContact: User` na Rodzinie<br>• Dostarcza `User`, którego `Pledge` użyje przy konwersji na `Reservation.reservedBy` | Wołany wyłącznie w kroku Pledge→Reservation | Party (Rodzina), System Wypożyczalni (User) |
| **System Wypożyczalni (zewnętrzny)** | Zarządzać cyklem życia rezerwacji i transakcji obiegowych | • `Reservation` (pending→confirmed→fulfilled)<br>• `CirculationTransaction` przy fulfilled<br>• Niezmieniony kontrakt (`itemId` wymagany, `reservedBy: User`) | Konsumowany przez `Pledge` w momencie konwersji; nigdy nie modyfikowany przez ten design | Brak (dany, zewnętrzny) |

---

## Przepływ danych

**Jak dane wchodzą do systemu**: Organizator (uwierzytelniony jako `Person` z aktywną rolą `Organizer` na danej Grupie, przez `leadership`) tworzy `Term` i opcjonalnie dołącza jeden lub więcej `NeededItem` (kategoria + opis). Rodzina (uwierzytelniona przez swój `primaryContact: User`, powiązana z Grupą przez aktywną `membership`) widzi `Term` swojej Grupy i może zadeklarować `Pledge` wskazując konkretny `NeededItem`.

**Kluczowe transformacje**:
1. `Pledge` powstaje w stanie `open` (deklaracja zamiaru) lub od razu `claimed` (deklaracja konkretnej Rodziny "ja to przyniosę") — rozróżnienie `open`/`claimed` pozwala odróżnić "potrzeba nadal otwarta" od "ktoś się już zgłosił".
2. Gdy Rodzina faktycznie dostarcza rzecz, jej `primaryContact` (`User`) rejestruje konkretny egzemplarz jako `InventoryItem` w systemie wypożyczalni (poza tym designem, niezmienione).
3. Rejestracja `InventoryItem` jest wyzwalaczem do utworzenia `Reservation` (`itemId` = nowo zarejestrowany `InventoryItem`, `reservedBy` = `primaryContact` Rodziny) — `Pledge.resolvedReservationId` zapisuje tę referencję.
4. `Reservation` przechodzi niezmienionym cyklem `pending → confirmed → fulfilled`; przy `fulfilled` powstaje `CirculationTransaction` (niezmienione, poza tym designem).
5. Po `fulfilled`, `Pledge.status` przechodzi na `fulfilled` — zamykając pętlę między deklaracją a realizacją.

**Gdzie dane są przechowywane**: Party (Person/Group) i relacje (`leadership`/`membership`) jako rekordy z `[validFrom, validTo)`; `Term`/`NeededItem`/`Pledge` jako encje domeny Party powiązane FK-ami (nie string-match); `Reservation`/`InventoryItem`/`CirculationTransaction` pozostają w niezmienionym magazynie systemu wypożyczalni.

**Jak dane wychodzą / docierają do użytkowników**: Organizator widzi status swoich `NeededItem` przez agregację `Pledge` (ile otwartych/zaklejmowanych/zrealizowanych na kategorię); Rodzina widzi historię własnych `Pledge` i powiązanych `Reservation`/`CirculationTransaction` (odczyt z niezmienionego systemu wypożyczalni).

### Diagram przepływu (Specification by Example flow)

```
Organizator ──tworzy──▶ Term ──opisuje──▶ NeededItem(category)
                                              │
                                              ▼
                          Rodzina (przez primaryContact User) ──tworzy──▶ Pledge(status=open)
                                              │
                                    Rodzina deklaruje się ──▶ Pledge(status=claimed)
                                              │
                          [primaryContact rejestruje InventoryItem w Wypożyczalni]
                                              │
                                              ▼
                      Reservation(itemId, reservedBy=primaryContact) [pending→confirmed→fulfilled]
                                              │
                                              ▼
                              CirculationTransaction (niezmieniony)
                                              │
                                              ▼
                    Pledge(status=fulfilled, resolvedReservationId=<id>)
```

---

## Punkty integracji

- **Party ↔ System Wypożyczalni (tożsamość)**: `Person`/`primaryContact` warstwy Party musi odpowiadać `User` systemu wypożyczalni. To jedyny most tożsamości — `Reservation.reservedBy` i `Inventory.userId` nigdy nie wskazują na `Group`/`Family` (niezmienny kontrakt, `docs/system-wypozyczalni-inventory-accounting.md`).
- **Pledge → Reservation (konwersja jednokierunkowa)**: `Pledge` inicjuje utworzenie `Reservation` wyłącznie w momencie, gdy konkretny `InventoryItem` zostaje zarejestrowany przez `primaryContact` Rodziny. Ten punkt jest jedynym miejscem, w którym domena Party "puka" do systemu wypożyczalni — bez zmiany jego kontraktu (`itemId` pozostaje wymagane, `reservedBy` pozostaje `User`).
- **Reservation → Pledge (informacja zwrotna)**: Po osiągnięciu `fulfilled` przez `Reservation`, `Pledge.status` aktualizuje się na `fulfilled` i zapisuje `resolvedReservationId` — jednokierunkowa synchronizacja stanu z systemu wypożyczalni do domeny Party (nie odwrotnie).
- **Term ↔ Party (kontekst, nie relacja)**: `Term` odwołuje się do Grupy przez FK (nie `groupName: string`), a jego twórcą jest Organizator z aktywną `leadership` na tej Grupie w momencie tworzenia — to walidacja autoryzacji, nie osobna relacja Party.
- **Brak integracji z modelem punktowym**: `Points`/rozliczenia pozostają wyłącznie wewnątrz `CirculationTransaction` (zewnętrzny, dany kontekst) — ten design nie odczytuje ani nie zapisuje do tego modelu.

---

## Decyzje projektowe

| # | Decyzja | Rozstrzygnięcie | ADR |
|---|---|---|---|
| 1 | Party Types dla Organizator/Grupa/Rodzina | `Person`(Organizer) / `Group` / `Group`(Member) | [ADR-001](./decision-log.md#adr-001-party-types-dla-organizator-grupa-rodzina) |
| 2 | Umiejscowienie zgłoszenia na ochotnika | Nowy pośredni koncept `Pledge` (nie Party Relationship, nie Reservation) | [ADR-002](./decision-log.md#adr-002-wprowadzenie-pledge-jako-pośredniego-konceptu) |
| 3 | Cardinality `leadership` | Ścisłe 1:N | [ADR-003](./decision-log.md#adr-003-cardinality-leadership--ścisłe-1n) |
| 4 | Cardinality `membership` | N:N od startu | [ADR-004](./decision-log.md#adr-004-cardinality-membership--nn-od-startu) |
| 5 | Kształt pola "opis potrzeby" | `NeededItem.category: enum` + opcjonalny opis | [ADR-005](./decision-log.md#adr-005-neededitem-jako-kategoriatag-zamiast-wolnego-tekstu-lub-katalogu) |
| 6 | Tożsamość reprezentująca Rodzinę | `primaryContact: User` per Rodzina od startu | [ADR-006](./decision-log.md#adr-006-primary-contact-user-per-rodzina) |

---

## Konkretne przykłady (Specification by Example)

### Przykład 1: Organizator prosi o rzecz, Rodzina zgłasza się na ochotnika, przedmiot trafia do Wypożyczalni

**Given**: Zuzanna prowadzi Grupę "Muzyczne Maluchy" (aktywna `leadership`, `validTo` = otwarte). Rodzina Wiśniewskich ma aktywną `membership` w tej Grupie i `primaryContact` = User "Anna Wiśniewska".

**When**: Zuzanna tworzy `Term` na 15 września i dodaje `NeededItem(category=instrument, opis="tamburyn lub dzwonki")`. Anna widzi tę potrzebę i tworzy `Pledge(status=claimed, pledgedBy=Rodzina Wiśniewskich, neededItemRef=ten NeededItem)`. W dniu zajęć Anna rejestruje swój tamburyn jako `InventoryItem` w swoim `Inventory`.

**Then**: Powstaje `Reservation(itemId=<tamburyn>, reservedBy=Anna Wiśniewska, status=pending)`. Po potwierdzeniu odbioru przez Zuzannę, `Reservation.status=fulfilled` i powstaje `CirculationTransaction` (niezmienione, punkt trafia do aktualnego posiadacza-dawcy zgodnie z INV §3). `Pledge.status` przechodzi na `fulfilled`, `resolvedReservationId` wskazuje na tę `Reservation`.

### Przykład 2: Rodzina należąca do dwóch Grup jednocześnie (test cardinality `membership`)

**Given**: Rodzina Kowalskich ma aktywną `membership` w Grupie "Muzyczne Maluchy" (od stycznia) ORAZ aktywną `membership` w Grupie "Plastyczne Skrzaty" (od marca) — obie relacje otwarte (`validTo` = brak).

**When**: Organizator "Plastycznych Skrzatów" tworzy `Term` z `NeededItem(category=materiały plastyczne)`.

**Then**: Rodzina Kowalskich widzi tę potrzebę wyłącznie w kontekście "Plastycznych Skrzatów" (bo `membership` jest scoped do konkretnej Grupy), niezależnie od jej równoległego, aktywnego członkostwa w "Muzycznych Maluchach" — potwierdza to, że N:N nie powoduje "przecieku" potrzeb między Grupami.

### Przykład 3: Zmiana organizatora Grupy (test cardinality `leadership` i walidacji czasowej)

**Given**: Zuzanna prowadzi Grupę "Muzyczne Maluchy" od stycznia (aktywna `leadership`, `validTo` = otwarte). W maju przekazuje prowadzenie Marcie.

**When**: System zamyka `leadership(Zuzanna, Muzyczne Maluchy)` ustawiając `validTo = data przekazania` i otwiera nową `leadership(Marta, Muzyczne Maluchy, validFrom = data przekazania, validTo = otwarte)`.

**Then**: Zapytanie "kto prowadził Muzyczne Maluchy w marcu?" zwraca Zuzannę (filtrowanie po `[validFrom, validTo)` zawierającym marzec); zapytanie "kto prowadzi dziś?" zwraca dokładnie Martę — w każdym momencie istnieje dokładnie jedna aktywna instancja `leadership` per Grupa, zgodnie z uniqueness 1:N.

---

## Poza zakresem

- **Mechanizm delegacji/zastępstwa** (rozszerzenie 1C z `solution-exploration.md`) — świadomie odłożone; `leadership` pozostaje ścisłe 1:N teraz, delegacja do zaprojektowania dopiero gdy zastępstwa okażą się realną, potwierdzoną potrzebą.
- **Przełącznik kontekstu Grupy w UI** — konsekwencja N:N `membership`, ale to zagadnienie warstwy prezentacji, wprost wykluczone z zakresu tego designu (brief: brak redesignu UI).
- **Współdzielony katalog produktów** (rozszerzenie 3C) — `NeededItem` pozostaje kategorią/tagiem niezależnym od jakiegokolwiek `Product`/`InventoryItem`; pełna referencja katalogowa byłaby zbliżeniem do redesignu modelu wypożyczalni, wprost zakazanego.
- **Pełny model multi-opiekuna** (rozszerzenie 4A) — `primaryContact` jest jednym `User` per Rodzina; wiele niezależnych tożsamości opiekunów z osobną autoryzacją to potwierdzone rozszerzenie na przyszłość, nie projektowane teraz.
- **Zachowanie `Pledge` przy `Reservation.status=cancelled`** — nieudokumentowane w źródle systemu wypożyczalni; wymaga rozstrzygnięcia przy projektowaniu maszyny stanów `Pledge` w fazie specyfikacji, nie w tym designie.
- **Ujednolicenie czterech słowników trybu wymiany** (`ItemMode`/`GiftSource`/`MODE_STYLE`/`EXCHANGE`) — poza zakresem modelu Party; rekomendacja leży w `pages/SPEC.md`.
- **Zmiany w modelu punktowym/`CirculationTransaction`** — traktowany jako dany, niezmieniony kontekst integracyjny w tym designie, nigdy jako przedmiot projektowania.
- **Wybór stacku technologicznego/bazy danych** — ten dokument opisuje model domenowy (Party/DDD), nie implementację.

---

## Kryteria sukcesu

1. **Jednoznaczność lidera**: dla dowolnej Grupy i dowolnego momentu w czasie istnieje co najwyżej jedna aktywna instancja `leadership` — zapytanie "kto dziś prowadzi tę Grupę" zwraca zero lub jeden wynik, nigdy więcej.
2. **Wielo-przynależność bez przecieku**: Rodzina może mieć N jednocześnie aktywnych `membership`, a potrzeby (`Term`/`NeededItem`) każdej Grupy pozostają widoczne wyłącznie w kontekście tej Grupy.
3. **Historia zachowana**: zmiana organizatora lub członkostwa Rodziny nie nadpisuje poprzednich relacji — pytania historyczne ("kto był w Grupie w danym miesiącu") są odpowiadalne przez filtrowanie `[validFrom, validTo)`.
4. **Zero naruszeń kontraktu Reservation**: żadna instancja `Pledge` nie tworzy `Reservation` bez uprzedniej rejestracji konkretnego `InventoryItem`; `Reservation.itemId` pozostaje zawsze wypełnione, `reservedBy` zawsze wskazuje pojedynczego `User`.
5. **Spójność Pledge↔Reservation**: każdy `Pledge` w stanie `fulfilled` ma niepusty `resolvedReservationId` wskazujący na `Reservation` w stanie `fulfilled`; nie istnieje `Pledge.fulfilled` bez odpowiadającej `Reservation`.
6. **Ustrukturyzowane raportowanie potrzeb**: agregacja "ile razy proszono o kategorię X w danym okresie" jest możliwa bez fuzzy-matchingu stringów, dzięki `NeededItem.category` jako zamkniętemu słownikowi.
