# Research Report — Party Archetype Model: Organizator → Grupa → Uczestnicy

**Research type**: Mixed (requirements + technical + architektura domenowa)
**Date**: 2026-09-02
**Researcher**: research-synthesizer (via `maister:research`)
**Task path**: `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Research Objectives](#research-objectives)
3. [Methodology](#methodology)
4. [Findings](#findings)
5. [Archetype Fit Assessment](#archetype-fit-assessment)
6. [Party Archetype Model](#party-archetype-model)
   - [Party Types](#party-types)
   - [Concept Mapping](#concept-mapping)
   - [Unmapped Concepts](#unmapped-concepts)
   - [Role Types](#role-types)
   - [Relationships](#relationships)
   - [Validity Rules](#validity-rules)
   - [Contact Mechanisms & Identifiers](#contact-mechanisms--identifiers)
   - [Implementation Notes](#implementation-notes)
7. [Integracja z systemem wypożyczalni: prośba o rzecz i zgłoszenie na ochotnika](#integracja-z-systemem-wypożyczalni-prośba-o-rzecz-i-zgłoszenie-na-ochotnika)
8. [Analysis and Insights](#analysis-and-insights)
9. [Conclusions](#conclusions)
10. [Recommendations](#recommendations)
11. [Appendices](#appendices)

---

## Executive Summary

**Co badano**: Jak zamodelować relacje Organizator → Grupa → Uczestnicy przy pomocy
archetypu Party (Fowler: Person/Organization/Group grający role, połączone relacjami), oraz
gdzie w tym modelu umieścić dwa mechanizmy z prototypu UI — "prośbę o rzecz na zajęcia"
(organizator prosi o konkretną rzecz) i "zgłoszenie na ochotnika" (uczestnik deklaruje
"przyniosę X") — w relacji do już zaprojektowanego, oddzielnego systemu wypożyczalni
(`Reservation`/`InventoryItem`/`CirculationTransaction`, opisanego w
`docs/system-wypozyczalni-inventory-accounting.md`).

**Jak badano**: trzy równoległe, rozłączne strumienie zbierania danych — (1) pełne
odczytanie 7 plików `pages/*.tsx` + `pages/SPEC.md` z cytatami plik+linia, (2) pełne
odczytanie `docs/system-wypozyczalni-inventory-accounting.md` (561 linii) z naciskiem na
cykl życia `Reservation`, (3) pełne odczytanie metodologii `party-archetype-mapper`
(470-liniowy SKILL.md) — a następnie zastosowanie tej metodologii (Fit Test → Party Types →
Concept Mapping → Unmapped Concepts → Role Types → Relationships → Validity → Contact
Mechanisms) do konkretnych konceptów domenowych znalezionych w kodzie.

**Kluczowe wyniki**:
1. Organizator, Grupa i Rodzina (Uczestnik) **przechodzą Fit Test** archetypu Party — to
   prawdziwe role/relacje z cyklem życia, nie zwykłe FK — mimo że **obecny kod w `pages/`
   nie implementuje ŻADNEJ z tych relacji jako danych** (wszystko jest dziś pozycyjne lub
   oparte na dopasowaniu tekstu).
2. "Zgłoszenie na ochotnika" **NIE przechodzi** Fit Testu jako `Relationship` w archetypie
   Party (naturalne pytanie o nie brzmi "w jakim jest stanie", nie "kto gra jaką rolę wobec
   kogo") i **nie mieści się** w istniejącym `Reservation` (które wymaga już istniejącego,
   skonkretyzowanego `itemId`). Wymaga nowego, pośredniego konceptu ("Pledge").
3. Punktem spięcia obu modeli jest tożsamość: `Person` w warstwie Party musi odpowiadać
   `User` z modelu wypożyczalni, bo `Reservation`/`Inventory` nigdy nie operują na poziomie
   grupy/rodziny.

**Główne wnioski**: patrz [Conclusions](#conclusions). Raport nie proponuje zmian w UI, nie
wybiera stacku technologicznego i nie zmienia modelu punktowego (`Points`/
`CirculationTransaction`) — zgodnie z ograniczeniami z research brief.

---

## Research Objectives

**Pytanie główne**: Jak wykorzystać Party Archetype do modelowania relacji Organizator →
Grupa → Uczestnicy, i gdzie w tym modelu (oraz w relacji do systemu wypożyczalni) umieścić
"prośbę o rzecz na zajęcia" i "zgłoszenie na ochotnika"?

**Pytania szczegółowe**:
- Czy Organizator/Grupa/Uczestnik faktycznie spełniają Fit Test archetypu Party (nie są to
  zwykłe FK)?
- Jaki konkretny model Party (Party Types, Role Types z validity, Relationships z
  cardinality/directionality, Contact Mechanisms) najlepiej opisuje tę domenę?
- Jak zmapować istniejące koncepty z `pages/` (Family, Group, Term, Item, ItemMode, Gift,
  GiftSource) na elementy archetypu Party (lub jawnie wykluczyć je z Party, z
  uzasadnieniem)?
- Gdzie żyje "prośba o rzecz" i "zgłoszenie na ochotnika" względem `Reservation` z modelu
  wypożyczalni?

**Scope**:
- **In**: Party/RoleType/Relationship/ContactMechanism dla Organizator/Grupa/Uczestnik;
  modelowanie Term jako punktu zgłoszenia potrzeby; modelowanie zgłoszenia na ochotnika;
  punkt integracji z `Reservation`; mapowanie na istniejące koncepty `pages/`.
- **Out**: redesign UI/UX; wybór stacku backend/DB/ORM; przeprojektowanie modelu punktowego
  (Points/CirculationTransaction) — traktowany jako dany, niezmieniany kontekst.
- **Wykluczone jako źródło**: `.maister/docs/**` — opisuje niepowiązany projekt (platforma
  "aj", Python/FastAPI), zgodnie z jawną uwagą w research brief.

---

## Methodology

**Podejście**: Mapowanie domeny na archetyp Party zgodnie z konwencją skilla
`party-archetype-mapper` (Fit Test → Party Types → Concept Mapping → Unmapped Concepts →
Role Types → Relationships → Validity → Contact Mechanisms → Implementation Notes), w
połączeniu z analizą istniejącego kodu prototypu i modelu wypożyczalni jako twardego
ograniczenia integracyjnego.

**Źródła danych**:
- Codebase: `pages/KragGrupy.tsx`, `pages/KragGrupyStart.tsx`, `pages/PanelOrganizatora.tsx`,
  `pages/PanelGoscia.tsx`, `pages/ProfilMobilny.tsx`, `pages/StronaGlowna.tsx`,
  `pages/GaleriaZdjec.tsx`, `pages/SPEC.md` — 7 plików komponentów + 1 dokument
  specyfikacji, wszystkie przeczytane w całości.
- Dokumentacja domenowa: `docs/system-wypozyczalni-inventory-accounting.md` (561 linii,
  przeczytane w całości).
- Metodologia: `.claude/skills/party-archetype-mapper/SKILL.md` (470 linii, przeczytane w
  całości).

**Analysis framework**: Mixed — component/concept identification (jakie encje istnieją),
pattern recognition (Party vs Role vs Relationship vs zwykły atrybut/FK — Fit Test), flow
analysis (organizator dodaje Term → zgłasza potrzebę → uczestnik zgłasza się na ochotnika →
opcjonalnie Reservation → fulfilled → CirculationTransaction), integration mapping (granica
Party↔Inventory), gap identification.

**Uwaga metodologiczna**: to badanie jest przejściem *dokumentacyjno-syntetyzującym*, nie
interaktywną sesją z live-mapperem. Zgodnie z regułą Step 7.5 skilla (Decision Sanity
Check), decyzje bez jawnego źródła w wymaganiach są oznaczone (X) i — tam, gdzie mają wpływ
biznesowy (cardinality, validity/termination) — jawnie wskazane jako wymagające
potwierdzenia przez użytkownika/product ownera przed implementacją, a nie ciche założenia.

---

## Findings

### Finding 1 — Brak jakiegokolwiek modelu relacyjnego Organizator/Grupa/Rodzina w kodzie

**Category**: Technical / Codebase | **Confidence**: High

Relacja "Organizator → Grupa" jest w `KragGrupy.tsx` czysto wizualna — organizator
("Zuzanna Karaszewska") jest hardcoded stringiem narysowanym w środku okręgu rodzin, bez
jakiegokolwiek pola danych łączącego go z nazwą grupy:

> `KragGrupy.tsx:439-443`
> ```
> <div className="kg-center">
>   <div className="kg-center-av"><Note /></div>
>   <strong>Zuzanna Karaszewska</strong>
>   <span>prowadzi zajęcia</span>
> </div>
> ```

W `PanelOrganizatora.tsx`, `Group` jest już nazwanym typem, ale bez pola `organizerId`:

> `PanelOrganizatora.tsx:377-382`
> ```
> type Group = {
>   id: string;
>   name: string;
>   location: string;
>   freeSpots: number;
> };
> ```

Relacja "Grupa → Uczestnik/Rodzina" jest reprezentowana wyłącznie przez zawieranie w
tablicy (`FAMILIES`, `KragGrupy.tsx:260-277`) — brak `groupId` na `Family`, brak
`memberSince`/dat ważności członkostwa.

**Implication**: model Party proponowany w tym raporcie nie "koduje" istniejących danych —
wprowadza brakującą strukturę relacyjną od zera.

### Finding 2 — Powiązanie Term↔Group jest oparte na dopasowaniu tekstu, nie na FK

**Category**: Technical / Codebase | **Confidence**: High

> `PanelOrganizatora.tsx:384-391`
> ```
> type Term = {
>   id: string;
>   day: string;
>   month: string;
>   groupName: string;
>   note: string;
>   neededItems: string[];
> };
> ```

Dropdown wyboru grupy przy tworzeniu terminu potwierdza mechanikę string-match:

> `PanelOrganizatora.tsx:1030-1035`
> ```
> <select id="org-t-group" value={termForm.groupName} onChange={...}>
>   <option value="">Wybierz grupę…</option>
>   {groups.map((g) => (
>     <option key={g.id} value={g.name}>{g.name}</option>
>   ))}
> </select>
> ```

`<option value={g.name}>` — wartość zapisywana do `termForm.groupName` to nazwa, nie `id`.
Zmiana nazwy grupy zerwałaby powiązanie z istniejącymi terminami.

### Finding 3 — Dwa niepołączone mechanizmy "prośby o rzecz" / "zgłoszenia na ochotnika"

**Category**: Technical / Codebase | **Confidence**: High

Mechanizm A (organizator prosi, `PanelOrganizatora.tsx`): checkbox + lista wyboru z
*własnego* katalogu `Item[]` organizatora:

> `PanelOrganizatora.tsx:1041-1071` (fragment)
> ```
> <input type="checkbox" checked={termForm.needsItems} ... />
> Potrzebuję rzeczy na zajęcia od rodzin
> ...
> {items.map((it) => (
>   <label className="org-check-row" key={it.id}>
>     <input type="checkbox" checked={termForm.neededItems.includes(it.name)}
>            onChange={() => toggleNeededItem(it.name)} />
>     {it.name}
>   </label>
> ))}
> ```

Wynik ląduje jako `Term.neededItems: string[]` — kopia nazw, bez FK z powrotem do `Item`
(`PanelOrganizatora.tsx:539`). Chipsy wyświetlające potrzebę są **wyłącznie do odczytu**,
bez handlera kliknięcia:

> `PanelOrganizatora.tsx:650-654`
> ```
> {t.neededItems.length > 0 && (
>   <div className="org-need-chips">
>     {t.neededItems.map((n) => <span className="org-need-chip" key={n}>{n}</span>)}
>   </div>
> )}
> ```

Mechanizm B (uczestnik zgłasza się na ochotnika, `KragGrupy.tsx`): osobna, hardcoded lista
`NEEDED_ITEMS` niezwiązana z żadnym `Term`:

> `KragGrupy.tsx:285-289`
> ```
> /*  lista rzeczy, których prowadząca potrzebuje na najbliższe zajęcia;
>     goście mogą się zgłosić dobrowolnie, nie muszą wybierać nic  */
> const NEEDED_ITEMS = ["Tamburyn i dzwonki", "Mata piankowa", "Koc piknikowy"];
> ```

Deklaracja chęci — `toggleBringClaim`:

> `KragGrupy.tsx:307-313`
> ```
> const toggleBringClaim = (item: string) => {
>   setBringClaims((c) => {
>     const current = c[item];
>     if (current && current.by !== "you") return c;
>     return { ...c, [item]: current ? null : { by: "you", name: "Ciebie", c: "#1E2E27", i: "TY" } };
>   });
> };
> ```

Te dwa mechanizmy nigdy się nie łączą — `Term` (Panel*) i `NEEDED_ITEMS`/`bringClaims`
(KragGrupy) to dwie osobne, nie-komunikujące się struktury danych opisujące ten sam
rzeczywisty koncept. To jest, dosłownie cytując finding źródłowy, "the single most important
integration gap for the research question".

### Finding 4 — `Reservation` w modelu wypożyczalni zawsze wymaga już istniejącego, konkretnego `itemId`

**Category**: Architecture / Inventory model | **Confidence**: High

> `docs/system-wypozyczalni-inventory-accounting.md`, linia 33 (cytat dosłowny):
> "Każda zmiana posiadania — wypożyczenie, zwrot, zamiana, oddanie — zaczyna się od
> `Reservation` (jak dodanie do koszyka w sklepie). To jeszcze NIE jest transakcja
> księgowa. Dopiero gdy któraś ze stron zaakceptuje odbiór (`status: fulfilled`), powstaje
> `CirculationTransaction`."

Definicja pola (linia 35): `itemId: string` — typ nie-nullable, w kontraście do jawnie
opcjonalnych pól tej samej encji (`pairedReservationId: string | null`, linia 38;
`expiresAt: datetime | null`, linia 40). We wszystkich 4 przykładowych flow (lend/return/
swap/gift) `InventoryItem` + `InventoryBalance(available)` powstają zawsze PRZED
`Reservation` (np. KROK 1 vs KROK 2, linie 65-121). Dokument nie opisuje żadnego wariantu
"potrzeba na rodzaj przedmiotu, bez wskazania konkretnego egzemplarza".

**Implication**: zgłoszenie na ochotnika (gdzie uczestnik jeszcze nie ma zarejestrowanego
`InventoryItem`) nie może być bezpośrednio `Reservation` bez naruszenia tego kontraktu.

### Finding 5 — `Reservation`/`Inventory` operują wyłącznie na poziomie pojedynczego `User`, nigdy grupy/rodziny

**Category**: Architecture / Inventory model | **Confidence**: High

> `docs/system-wypozyczalni-inventory-accounting.md`, §1 (linie 10-14): `Inventory` ma pole
> `userId: string` — magazyn należy zawsze do pojedynczego `User`, nie do grupy/rodziny.
> §1 (linia 37): `Reservation.reservedBy: User` — referencja do pojedynczego `User`.

Nie istnieje w tym dokumencie żadne pojęcie grupowej/rodzinnej odpowiedzialności za
rezerwację.

**Implication**: warstwa Party (gdzie Uczestnik = Rodzina, patrz niżej) musi jawnie
mapować się na poziom pojedynczej osoby (`User`), zanim może dojść do faktycznej
`Reservation`.

### Finding 6 — Fit Test skilla `party-archetype-mapper` jednoznacznie rozdziela "kto gra jaką rolę" od "w jakim stanie coś jest"

**Category**: Methodology | **Confidence**: High

> `.claude/skills/party-archetype-mapper/SKILL.md:33, 35-38`:
> "Is there an entity that plays one or more roles, and/or is connected to other entities
> via a named relationship that itself has a lifecycle? ... If the natural question is
> 'what state is X in?' → state machine, not actor/relationship model → do not map."

`Group` jest w tym samym dokumencie zdefiniowany z przykładami obejmującymi wprost
"Family" i "Class" (SKILL.md:106) — co jest bezpośrednio analogiczne do Rodziny i Grupy
zajęciowej w badanej domenie.

### Summary Table — Findings

| # | Finding | Category | Confidence |
|---|---|---|---|
| 1 | Brak modelu relacyjnego Organizator/Grupa/Rodzina w kodzie | Technical | High |
| 2 | Term↔Group powiązane przez string-match, nie FK | Technical | High |
| 3 | Dwa niepołączone mechanizmy prośby/ochotnika | Technical | High |
| 4 | Reservation wymaga już istniejącego itemId | Architecture | High |
| 5 | Reservation/Inventory operują na poziomie User, nie Group/Family | Architecture | High |
| 6 | Fit Test rozdziela rolę/relację od stanu | Methodology | High |

---

## Archetype Fit Assessment

### Organizator, Grupa, Rodzina/Uczestnik → ✅ Fits

Zastosowanie Fit Testu (SKILL.md:33, sygnały SKILL.md:16-20):

- **Organizator**: może potencjalnie prowadzić wiele grup jednocześnie (`PanelOrganizatora.
  tsx` — `groups: Group[]`, plural) i teoretycznie być jednocześnie uczestnikiem innej
  grupy — klasyczny sygnał "multi-role" (SKILL.md:16). Rola jest scoped do konkretnej
  Grupy, nie globalna (SKILL.md:20).
- **Grupa**: łączy się z Organizatorem i Rodzinami przez relacje, które *powinny* nieść dane
  (od kiedy ktoś prowadzi/jest członkiem) — sygnał SKILL.md:18. Jest to również dokładnie
  ten typ bytu, który skill sam definiuje jako `Group` z przykładem "Class" (SKILL.md:106)
  — silna analogia strukturalna.
- **Rodzina**: członkostwo w grupie jest naturalnym kandydatem na pytanie historyczne
  ("kto był w Muzycznych Maluchach w marcu?") — sygnał SKILL.md:19. Skill wprost wymienia
  "Family" jako przykład `Group` (SKILL.md:106).

Żadien z trzech konceptów nie jest "pojedynczą, niezmienną, nigdy nie odpytywaną
historycznie" relacją (borderline case z SKILL.md:55-59, który sugerowałby zwykły FK) —
w realnym systemie zajęć cyklicznych sezonowe zmiany organizatora i rotacja
uczestników/rodzin są prawdopodobne, choć nie potwierdzone wprost w wymaganiach (stąd
oznaczone (X) w Implementation Notes).

### Zgłoszenie na ochotnika ("BringClaim"/Pledge) → ❌ Nie pasuje jako Party Relationship

Stosując dokładnie tę samą regułę routingu (SKILL.md:35-38): naturalne pytanie o
zgłoszenie na ochotnika brzmi **"w jakim jest ono stanie"** (otwarte / zgłoszone /
wycofane / zrealizowane w Reservation) — to jest sygnaturą state machine, nie modelu
aktor/relacja. Cytat reguły:

> "If the natural question is 'what state is X in?' → state machine, not actor/relationship
> model → do not map." (SKILL.md:37)

**Wniosek**: zgłoszenie na ochotnika nie powinno być modelowane jako nowy `Relationship`
w archetypie Party. Jest to osobny, mały byt stanowy (patrz sekcja
[Integracja z systemem wypożyczalni](#integracja-z-systemem-wypożyczalni-prośba-o-rzecz-i-zgłoszenie-na-ochotnika)),
który *odwołuje się* do Party jako atrybutu (kto się zgłosił), ale sam nie jest częścią
tego archetypu. To samo dotyczy `ItemMode`/`GiftSource` (CB §4/§5.2) — to atrybuty stanu
przedmiotu, poprawnie wykluczone z Party.

---

## Party Archetype Model

### Party Types

| Party Type | Description | Examples in this domain |
|---|---|---|
| `Person` | Pojedyncza osoba fizyczna, może grać różne role w różnym kontekście | Organizator ("Zuzanna Karaszewska", `KragGrupy.tsx:441`); potencjalnie pojedynczy członek rodziny (obecnie nie zamodelowany osobno w kodzie, patrz Unmapped Concepts) |
| `Group` | Nieformalny, adresowalny zbiór — może sam grać role i uczestniczyć w relacjach | Grupa zajęciowa ("Muzyczne Maluchy", `KragGrupy.tsx:358`; `type Group`, `PanelOrganizatora.tsx:377-382`); Rodzina ("Rodzina Wiśniewskich", `KragGrupy.tsx:260-277`) |
| `Organization` | Byt prawny/administracyjny | Nie zidentyfikowano w obecnym zakresie kodu (brak np. "placówki"/"szkoły" jako osobnego bytu — grupa i miejsce (`location`) są dziś polem `Group`, nie osobną Organization; jeśli w przyszłości pojawi się wiele placówek/sal zarządzanych niezależnie od Organizatora, to miejsce na `Organization`) |

### Concept Mapping

| Domain Concept | Party Archetype | Notes |
|---|---|---|
| Organizator ("Zuzanna Karaszewska", `KragGrupy.tsx:441`; `type Profile`, `PanelOrganizatora.tsx:370-375`) | `Party(Person)` + `PartyRole(Organizer, scope=Grupa)` | Dziś hardcoded string, brak jakiejkolwiek referencji danych do Grupy |
| Grupa (`type Group`, `PanelOrganizatora.tsx:377-382`; nagłówek `KragGrupy.tsx:358`) | `Party(Group)` | Analogiczne do przykładu skilla "Class" (`SKILL.md:106`) |
| Rodzina/Family (`FAMILIES`, `KragGrupy.tsx:260-277`) | `Party(Group)` + `PartyRole(Member, scope=Grupa)` | Analogiczne do przykładu skilla "Family" (`SKILL.md:106`); rodzina jako całość jest jednostką członkostwa, nie pojedyncza osoba |
| Indywidualny członek rodziny (`kids: string` free-text, `KragGrupy.tsx:261`; "Ciebie"/`you`, `KragGrupy.tsx:311`) | **Brak osobnego mapowania — patrz Unmapped Concepts** | Kod nie daje dowodu potrzeby osobnej tożsamości; potencjalna przyszła rola `Person` "member of Family" |
| Organizator↔Grupa (pozycyjne — środek okręgu, `KragGrupy.tsx:439-443`) | `Relationship(leadership)`: `Person(Organizer)` → `Group(Grupa)` | Dziś nie istnieje jako dane — Party Archetype rekomenduje wprowadzenie |
| Grupa↔Rodzina (zawieranie w tablicy `FAMILIES`) | `Relationship(membership)`: `Group(Rodzina)` → `Group(Grupa)` | Dziś nie istnieje jako dane; kandydat na relację z walidacją czasową |
| Term/zajęcia (`type Term`, `PanelOrganizatora.tsx:384-391`) | **Nie-Party — patrz Unmapped Concepts** | Event/aktywność, nie aktor; żyje w kontekście relacji `leadership`/`membership` |
| `Term.neededItems` / prośba o rzecz (`PanelOrganizatora.tsx:390, 547-551`) | **Nie-Party — patrz Unmapped Concepts** | Opis potrzeby przypięty do Term, nie relacja aktorów |
| `NEEDED_ITEMS` (`KragGrupy.tsx:289`) | **Nie-Party — patrz Unmapped Concepts** | Drugi, niepołączony wariant tego samego konceptu co wyżej |
| `BringClaim`/`toggleBringClaim` — zgłoszenie na ochotnika (`KragGrupy.tsx:291, 307-313`) | **Nie-Party Relationship — patrz sekcja Integracja i Unmapped Concepts** | Referencuje Party (kto się zgłasza) jako atrybut, ale sam koncept to state-tracked encja ("Pledge"), nie `Relationship` w archetypie |
| `Item` (`type Item`, `PanelOrganizatora.tsx:395-399`) | **Nie-Party** | Odpowiada `InventoryItem`/`Product` z modelu wypożyczalni; poza zakresem archetypu Party |
| `ItemMode` (`PanelOrganizatora.tsx:393`) | **Nie-Party — atrybut stanu** | Fit Test: "what state is X in" → nie mapuj |
| `Gift`/`GiftSource` (`PanelOrganizatora.tsx:429-436`) | **Nie-Party — atrybut/prowenencja** | `Gift.from: string` to dziś wolny tekst, nie referencja do Party — potencjalny przyszły kandydat na Relationship, jeśli miałby nieść dane o relacji (np. "od kogo, kiedy") |
| `Profile` organizatora (`PanelOrganizatora.tsx:370-375`) | Atrybuty bazowego rekordu `Party(Person)` | `bio`/`location`/`avatar` nie są rolą ani relacją — zwykłe pola tożsamości |
| `User` (`docs/system-wypozyczalni-inventory-accounting.md` §1, linie 5-8) | **Tożsamość odpowiadająca `Party(Person)`** | Kluczowy punkt integracji — patrz Implementation Notes i sekcja Integracja |
| `Reservation`, `InventoryItem`, `InventoryBalance`, `CirculationTransaction` | **Poza archetypem Party** — niezmieniony kontekst z INV | Patrz sekcja Integracja |

### Unmapped Concepts

- **Term (zajęcia/spotkanie)** — nie jest aktorem grającym rolę; to zdarzenie/aktywność
  osadzone w kontekście relacji `leadership`/`membership`. Nie wymaga modelowania jako
  Party.
- **`Term.neededItems` / `NEEDED_ITEMS` (prośba o rzecz)** — opis potrzeby (nazwa
  przedmiotu), nie relacja między aktorami. Dodatkowo, obecna implementacja w
  `PanelOrganizatora.tsx` jest wewnętrznie niespójna: organizator wybiera "potrzebne
  rzeczy" wyłącznie ze swojego *własnego* katalogu `Item[]` (`PanelOrganizatora.tsx:1041-
  1071`), mimo że rzeczy mają przynieść *inne* rodziny — to sygnał, że docelowy model
  "potrzeby" powinien być opisem/kategorią, nie referencją do cudzego `Item`. Decyzja o
  kształcie tego pola wykracza poza archetyp Party i wymaga osobnej decyzji produktowej.
- **`BringClaim` / zgłoszenie na ochotnika** — po zastosowaniu Fit Testu (patrz
  [Archetype Fit Assessment](#archetype-fit-assessment)) nie kwalifikuje się jako
  `Relationship` w archetypie Party (naturalne pytanie to "w jakim jest stanie", nie "kto
  gra jaką rolę wobec kogo"). Modelowany jako osobna encja ("Pledge") poza ścisłym
  archetypem — patrz [Integracja](#integracja-z-systemem-wypożyczalni-prośba-o-rzecz-i-zgłoszenie-na-ochotnika).
- **`Item` / `ItemMode`** — `Item` odpowiada `InventoryItem`/`Product` z modelu
  wypożyczalni (poza zakresem tego badania — brief wyklucza przeprojektowanie modelu
  punktowego/inventory); `ItemMode` to atrybut stanu, nie rola.
- **`Gift` / `GiftSource`** — atrybut/prowenencja przedmiotu (jak dany przedmiot trafił do
  posiadacza), nie relacja aktorów w obecnym kształcie (`from: string` to wolny tekst).
  Otwarte pytanie: czy w przyszłości `Gift.from` powinno stać się referencją do Party — nie
  rozstrzygane w tym badaniu (brak dowodu potrzeby w obecnym kodzie).
- **Indywidualny członek rodziny jako osobna tożsamość `Person`** — obecny kod nie daje
  dowodu potrzeby (member kliknięcia oznaczony jako anonimowe "Ciebie"/`you`,
  `KragGrupy.tsx:311`, bez pickera użytkownika). Odłożone świadomie (YAGNI); potencjalna
  przyszła rola `Person` "member of Family" jeśli pojawi się potrzeba rozróżniania, który
  rodzic/dorosły w rodzinie działa.
- **Cztery niespójne słowniki trybu wymiany** (`MODE_STYLE`, `ItemMode`, `GiftSource`,
  `EXCHANGE` w `ProfilMobilny.tsx:330-334`) — wszystkie to atrybuty stanu przedmiotu, nie
  role/relacje aktorów; poza zakresem Party Archetype i poza zakresem tego badania
  (rekomendacja ujednolicenia leży w `pages/SPEC.md`, nie tutaj).

---

## Role Types

| Role Type | Applicable Party Type(s) | Scope | Concurrency | Validity |
|---|---|---|---|---|
| `Organizer` | `Person` | Scoped do konkretnej `Grupa` | Multiple concurrent (jedna osoba może prowadzić kilka grup — `PanelOrganizatora.tsx` obsługuje `groups: Group[]`, plural) | Tracked (rekomendowane; dziś nieobecne w kodzie) — **(X)**, wymaga potwierdzenia czy organizator kiedykolwiek się zmienia w trakcie życia grupy |
| `Member` (Uczestnik) | `Group` (Rodzina) | Scoped do konkretnej `Grupa` | Multiple concurrent (założenie: rodzina może należeć do wielu grup jednocześnie) — **(X)**, brak potwierdzenia w wymaganiach/kodzie | Tracked (rekomendowane; dziś nieobecne w kodzie) |

**Uwaga o unikaniu role explosion**: nie wprowadzono osobnej roli "Volunteer" — zgłoszenie
się na ochotnika to działanie wykonywane przez Party już posiadającą rolę `Member`, nie
nowa, trwała rola tożsamości (zgodnie z pitfallem "Identity Is Not Role" z metodologii —
`SKILL.md:343-353`, nie każde działanie zasługuje na własny RoleType).

---

## Relationships

### `leadership`

**From**: `Person` (rola `Organizer`) → **To**: `Group` (Grupa)
**Directionality**: Asymmetric ("organizuje" / "jest organizowana przez")
**Cardinality**: 1:N (jeden organizator może prowadzić wiele grup) — **(X)**, brak
potwierdzenia czy grupa może mieć więcej niż jednego organizatora jednocześnie
(współprowadzenie); jeśli tak, cardinality zmienia się na N:N
**Uniqueness**: przy założeniu 1 aktywnego organizatora na grupę — tylko jedna aktywna
instancja `leadership` per Grupa naraz

| Field | validFrom | validTo | onTermination | Notes |
|---|---|---|---|---|
| Kiedy Organizator zaczyna prowadzić Grupę | data założenia grupy / przekazania prowadzenia | otwarte / data przekazania innemu organizatorowi | stara relacja kończona (`validTo` ustawiane), nowa tworzona — historia zachowana, nie nadpisywana | Dziś brak jakiegokolwiek pola danych w kodzie — to rekomendacja, nie opis istniejącego stanu |

### `membership`

**From**: `Group` (Rodzina, rola `Member`) → **To**: `Group` (Grupa)
**Directionality**: Asymmetric ("jest członkiem" / "ma członka")
**Cardinality**: N:N (założenie: rodzina może uczestniczyć w wielu grupach; grupa ma wiele
rodzin) — **(X)**, brak potwierdzenia w wymaganiach
**Uniqueness**: ta sama para (Rodzina, Grupa) nie powinna mieć dwóch jednocześnie
aktywnych instancji `membership`; nowa instancja może powstać po zakończeniu poprzedniej
(np. rejoin po przerwie)

| Field | validFrom | validTo | onTermination | Notes |
|---|---|---|---|---|
| Kiedy Rodzina dołącza/opuszcza Grupę | data dołączenia (dziś: przycisk "Zaproś kolejną rodzinę" w `KragGrupy.tsx:430-437` jest tylko toast-stubem, nie mutuje danych) | otwarte / data opuszczenia | soft end-date; brak dowodu na cascading effects (np. czy opuszczenie grupy anuluje otwarte Pledge tej rodziny — otwarte pytanie) | Dziś brak `groupId` na `Family` — to rekomendacja strukturalna |

---

## Validity Rules

| Role / Relationship | Valid From | Valid To | On Termination |
|---|---|---|---|
| `Organizer` (rola) | data przypisania do Grupy | otwarte / data zakończenia prowadzenia | soft end-date, historia zachowana |
| `Member` (rola) | data dołączenia Rodziny do Grupy | otwarte / data opuszczenia | soft end-date, historia zachowana |
| `leadership` (relacja) | jak wyżej (Organizer) | jak wyżej | stara relacja zamykana, nowa tworzona przy zmianie organizatora |
| `membership` (relacja) | jak wyżej (Member) | jak wyżej | stara relacja zamykana, nowa tworzona przy ponownym dołączeniu |

Konwencja: półotwarty przedział `[validFrom, validTo)`, sentinel "otwarte" dla aktywnych
ról/relacji, zgodnie z `SKILL.md:230`. Pytania historyczne ("kto był organizatorem
Muzycznych Maluchów w marcu?") odpowiadane przez filtrowanie istniejących wierszy — bez
osobnego logu audytowego (`SKILL.md:367-369`).

---

## Contact Mechanisms & Identifiers

**Częściowo zastosowalne.** Skill instruuje: dołączyć tę sekcję tylko jeśli Krok 2 ujawnił
taką potrzebę (`SKILL.md:238`). W tym badaniu (bez interaktywnej sesji) potrzeba wynika
pośrednio z modelu wypożyczalni:

- `User.email` (`docs/system-wypozyczalni-inventory-accounting.md` §1, linia 5-8) to
  jedyny zidentyfikowany kanał kontaktu w całym badanym zakresie — scoped na poziomie
  `Party(Person)`, współdzielony między wszystkimi rolami tej osoby (brak dowodu na osobny
  kontakt per rola).
- `Group.location: string` (`PanelOrganizatora.tsx:377-382`) to opis *miejsca zajęć*, nie
  mechanizm kontaktu w sensie archetypu (nie służy do "dotarcia" do Grupy jako aktora) —
  celowo nieujęty jako `ContactMechanism`.
- `Profile.location` (`PanelOrganizatora.tsx:370-375`) ma tę samą niejednoznaczność —
  prawdopodobnie opis miejsca prowadzenia zajęć, nie adres kontaktowy organizatora;
  otwarte pytanie, nie rozstrzygane tutaj.
- Brak zidentyfikowanych `Identifier` (np. numer członkowski) poza wewnętrznymi `id`.

---

## Implementation Notes

Decyzje z jawnym oznaczeniem źródła (R = z wymagań, A = potwierdzone w interaktywnym
kroku, X = założenie tego badania, bez interaktywnego potwierdzenia):

- **(R)** Wykorzystanie archetypu Party dla Organizator→Grupa→Uczestnicy — jawnie zażądane
  w pytaniu badawczym.
- **(R)** Grupa jest `Party(Group)` — bezpośrednio wspierane przykładem "Class" w samym
  skillu (`SKILL.md:106`) i istnieniem `Group` jako nazwanego typu w kodzie
  (`PanelOrganizatora.tsx:377-382`).
- **(R)** Rodzina jest `Party(Group)`, nie `Party(Person)` — bezpośrednio wspierane
  przykładem "Family" w samym skillu (`SKILL.md:106`) oraz tym, że `Family` w kodzie jest
  atomową jednostką (bez rozbicia na osoby).
- **(X)** Cardinality `leadership` = 1:N (jeden organizator, wiele grup, ale jedna grupa —
  jeden aktywny organizator) — brak potwierdzenia możliwości współprowadzenia grupy przez
  kilku organizatorów jednocześnie. **Wpływ biznesowy: średni** — jeśli współprowadzenie
  jest realnym scenariuszem, cardinality zmienia się na N:N i zmienia się reguła
  uniqueness. Wymaga potwierdzenia przed implementacją.
- **(X)** Cardinality `membership` = N:N (rodzina może należeć do wielu grup jednocześnie)
  — brak potwierdzenia w wymaganiach/kodzie (każdy panel w `pages/` operuje na jednej
  grupie na raz, co nie przesądza modelu docelowego). **Wpływ biznesowy: średni.** Wymaga
  potwierdzenia.
- **(X)** Walidacja czasowa (`validFrom`/`validTo`) dla obu ról/relacji jest rekomendowana,
  ale nie potwierdzona jako wymagana przez użytkownika — jeśli w praktyce organizator i
  skład grupy nigdy się nie zmieniają, wystarczyłby prostszy model bez pełnej historii
  (patrz borderline case, `SKILL.md:55-59`). **Wpływ: niski/średni** — rekomendacja
  zachowawcza (dodać walidację), bo koszt jej pominięcia rośnie z czasem, ale można to
  odłożyć bez zrywania reszty modelu.
- **(X)** Indywidualna tożsamość `Person` dla członków rodziny nie jest wprowadzana teraz —
  YAGNI, brak dowodu potrzeby w obecnym kodzie (`toggleBringClaim` operuje na anonimowym
  "Ciebie"). **Wpływ: niski dziś, potencjalnie wysoki w przyszłości** (multi-opiekun w
  jednej rodzinie, autoryzacja per-osoba) — jawnie odnotowane jako punkt rozszerzenia.
- **(X)** `Organization` Party Type nie jest używany w tym modelu — brak dowodu w
  wymaganiach/kodzie na potrzebę reprezentowania placówki/instytucji niezależnej od
  Organizatora-Person. Jeśli w przyszłości pojawi się wiele niezależnych placówek
  zarządzających wieloma organizatorami, `Organization` stanie się potrzebne.
- **Ograniczenie tego badania**: brak interaktywnego `AskUserQuestion` (badanie, nie
  live-sesja implementacyjna z mapperem) — zgodnie z regułą Step 7.5 skilla
  (`SKILL.md:277-282`), decyzje (X) o wpływie biznesowym (cardinality, validity/
  termination) powinny zostać jawnie potwierdzone przez użytkownika przed wdrożeniem, nie
  tylko udokumentowane jako założenia w raporcie badawczym.

---

## Integracja z systemem wypożyczalni: prośba o rzecz i zgłoszenie na ochotnika

To jest sekcja rozstrzygająca centralne pytanie badawcze — umiejscowienie mechanizmu
"prośba o rzecz" / "zgłoszenie na ochotnika" względem `Reservation`.

### Krok 1: "prośba o rzecz na zajęcia" — nie jest konceptem Party ani Reservation

Organizator, tworząc `Term`, opisuje potrzebę (dziś: wybierając ze swojego katalogu —
Finding 3, uznane za niespójność wzorca do niepowielania). Ten opis potrzeby ("NeededItem"
lub podobna nazwa robocza) jest atrybutem `Term`, nie relacją między aktorami — trafia do
sekcji Unmapped Concepts (patrz wyżej). Nie jest to też `Reservation`, bo nie istnieje
jeszcze żaden konkretny przedmiot ani żaden zgłoszony dawca.

### Krok 2: "zgłoszenie na ochotnika" — nowy koncept pośredni ("Pledge")

Zastosowanie Fit Testu w sekcji [Archetype Fit Assessment](#archetype-fit-assessment)
wykazało, że zgłoszenie na ochotnika nie kwalifikuje się jako `Relationship` w archetypie
Party (jest to state-tracked encja, nie relacja aktor↔aktor z lifecycle w sensie
"kto-jest-czym-dla-kogo"). Jednocześnie Finding 4 pokazuje, że nie może być bezpośrednio
`Reservation`, ponieważ `Reservation.itemId` jest polem wymaganym, wskazującym na już
istniejący, skonkretyzowany `InventoryItem` — a w momencie zgłoszenia na ochotnika
("przyniosę tamburyn") żaden taki `InventoryItem` jeszcze nie istnieje w systemie
wypożyczalni.

**Rozstrzygnięcie (zgodne z fallback strategy z research-planu)**: wprowadzić nowy,
pośredni koncept — roboczo **`Pledge`** (możliwe alternatywne nazwy: "Zgłoszenie
ochotnicze", "VolunteerCommitment") — o następującym kształcie koncepcyjnym:

```
Pledge
  id
  termId              → odniesienie do Term (kontekst: na jakich zajęciach)
  neededItemRef        → odniesienie do opisu potrzeby na tym Termie (nie do InventoryItem)
  pledgedBy            → odniesienie do Party (Rodzina; docelowo — patrz niżej —
                          wymaga rozstrzygnięcia na poziomie konkretnej osoby/User)
  status: enum         → open | claimed | withdrawn | fulfilled
  claimedAt: datetime
  resolvedReservationId: string | null   → wypełniane dopiero po skonkretyzowaniu przedmiotu
```

`Pledge` **referencuje** Party jako pole (`pledgedBy`), ale **nie jest** sam typem
`Relationship` w archetypie Party — stąd figuruje w sekcji Unmapped Concepts, mimo że jego
"kto" jest w pełni wyprowadzony z modelu Party.

### Krok 3: przejście Pledge → Reservation

`Pledge` przechodzi w `Reservation` wyłącznie w momencie, gdy wolontariusz przypisuje/
rejestruje konkretny, fizyczny przedmiot jako `InventoryItem` (np. rejestrując swój
tamburyn we własnym `Inventory`, zgodnie z niezmienionym modelem z INV §1). Dopiero wtedy
może powstać `Reservation` z `type: gift` lub `type: lend` (zależnie od tego, czy rodzina
oddaje przedmiot na stałe grupie/organizatorowi, czy tylko użycza go na czas zajęć — to
osobna decyzja produktowa, nie rozstrzygana w tym badaniu), z `itemId` wskazującym na ten
nowo zarejestrowany `InventoryItem`, i `reservedBy: User` wskazującym na **osobę**
odbierającą przedmiot (najpewniej organizatora, jako `User` — patrz Finding 5), nie na
Grupę.

To podejście:
- **Nie zmienia** kontraktu `Reservation` (pole `itemId` pozostaje wymagane, tak jak jest
  dziś udokumentowane w INV) — zgodne z ograniczeniem "brak przeprojektowania modelu
  punktowego" z brief.
- **Nie narusza** zasady "Reservation zawsze pierwszy krok, CirculationTransaction dopiero
  przy fulfilled" (INV §3) — `Pledge` żyje *przed* `Reservation`, nie zastępuje żadnego z
  jej etapów.
- Wymaga jawnego rozstrzygnięcia tożsamości: `Pledge.pledgedBy` odnosi się do `Party
  (Rodzina)`, ale `Reservation.reservedBy` (a ściślej: strona *oddająca* przedmiot w
  `fulfilled`, zgodnie z INV §3 "kto zarabia punkt trafia zawsze do aktualnego posiadacza,
  nie do `reservedBy`") musi wskazywać na pojedynczego `User`. Konieczne jest więc pole
  łączące — najprościej: rodzina musi mieć co najmniej jednego powiązanego `User` (rodzica/
  opiekuna), a `Pledge`, w momencie konwersji, wybiera konkretnego `User` z tej rodziny.
  Skoro (per Unmapped Concepts) obecny kod nie modeluje osobnych tożsamości członków
  rodziny, jest to **otwarte pytanie wymagające decyzji przed implementacją**, nie tylko
  szczegół techniczny.

### Diagram przepływu (tekstowy)

```
Organizator (Person, rola Organizer)
   tworzy Term (zajęcia)
      opisuje potrzebę → NeededItem (opis, nie Party, nie Reservation)

Rodzina (Group, rola Member Grupy)
   zgłasza się na ochotnika → Pledge (status: claimed)
      referencuje Party (Rodzina) jako "kto"
      referencuje Term + NeededItem jako "na co"

   [w chwili faktycznego dostarczenia przedmiotu]
   konkretna osoba z Rodziny (User) rejestruje przedmiot → InventoryItem (INV, niezmieniony)
      → powstaje Reservation (INV, niezmieniony kontrakt: itemId wymagany, reservedBy: User)
         → status: pending → confirmed → fulfilled
            → CirculationTransaction (INV, niezmieniony) — punkt dla aktualnego posiadacza-dawcy

Pledge.status → fulfilled, Pledge.resolvedReservationId → wypełnione
```

---

## Analysis and Insights

### Patterns identified

| Pattern | Type | Prevalence | Assessment | Example |
|---|---|---|---|---|
| Brak modelu relacyjnego — tylko pozycja/string-match | Organizational | Powszechny w całym `pages/` | Ad-hoc/prototypowy, spójny w całym kodzie | `groupName: string` zamiast `groupId` (`PanelOrganizatora.tsx:384-391`) |
| Rozbieżne słownictwo trybu wymiany (4 warianty) | Implementation | 4 niezależne miejsca | Nieujednolicone, ale spójnie *jako atrybut stanu*, nie roli | `MODE_STYLE` vs `ItemMode` vs `GiftSource` vs `EXCHANGE` (CB §4/§5.2) |
| "Reservation zawsze po już-istniejącym itemId" | Integration | Konsekwentne we wszystkich 4 flow INV | Dojrzały, celowy wzorzec projektowy | INV §7, KROK 1→KROK 2 we wszystkich przykładach |

### Key insights

1. **Party Archetype tu projektuje, nie dokumentuje** — obecny kod nie zawiera żadnej z
   proponowanych relacji jako danych (Finding 1). Wysoka pewność.
2. **Zgłoszenie na ochotnika żyje w martwej strefie między dwoma modelami** — potwierdzone
   niezależnie przez Finding 3 (strona kodu) i Finding 4 (strona modelu docelowego).
   Wysoka pewność.
3. **Tożsamość musi zejść z poziomu Grupy/Rodziny do poziomu User** zanim powstanie
   `Reservation` — bezpośrednia konsekwencja Finding 5 skrzyżowanego z decyzją "Rodzina =
   `Group`". Wysoka pewność.
4. **Organizator jest kandydatem na przykład "multi-role"** z Fit Testu — metodologicznie
   uzasadnione, niepotwierdzone bezpośrednim dowodem z kodu. Średnia pewność.

### Quality assessment (SWOT-style, model domenowy)

- **Strengths**: model jasno rozdziela tożsamość od roli (Organizator/Rodzina mogą mieć
  wiele ról w czasie bez utraty historii); granica Pledge↔Reservation chroni istniejący,
  działający kontrakt modelu wypożyczalni.
- **Weaknesses**: kilka kluczowych cardinality (`leadership`, `membership`) pozostaje
  niepotwierdzonych — ryzyko błędnego założenia, jeśli nie zostaną potwierdzone przed
  implementacją.
- **Opportunities**: wprowadzenie relacji z walidacją czasową otwiera możliwość
  historycznych zapytań ("kto był w tej grupie w marcu"), których dziś w ogóle nie da się
  zadać.
- **Risks**: jeśli tożsamość pojedynczej osoby w rodzinie zostanie wprowadzona później "na
  szybko", bez przemyślenia relacji do `Pledge`/`Reservation`, może powstać kolejna,
  osobna, niepołączona struktura — powtórka wzorca z Finding 3.

---

## Conclusions

### Primary conclusions

1. **Organizator/Grupa/Rodzina przechodzą Fit Test archetypu Party** i powinny być
   modelowane jako `Person`+rola `Organizer` / `Group` (Grupa) / `Group`+rola `Member`
   (Rodzina), połączone relacjami `leadership` i `membership` z rekomendowaną walidacją
   czasową. **Confidence: High** (klasyfikacja Party Types), **Medium** (dokładne
   cardinality — oznaczone (X)).
2. **Zgłoszenie na ochotnika nie jest ani `Relationship` w archetypie Party, ani
   bezpośrednio `Reservation`** — wymaga nowego, pośredniego konceptu `Pledge`,
   referencującego Party, ale żyjącego poza ścisłym archetypem i poza niezmienionym
   kontraktem `Reservation`. **Confidence: High.**
3. **Punkt integracji tożsamości**: `Party(Person)` musi odpowiadać `User` z modelu
   wypożyczalni; `Pledge` na poziomie Rodziny musi w chwili konwersji na `Reservation`
   rozstrzygnąć się do konkretnej osoby (`User`). **Confidence: High.**

### Secondary conclusions

4. Obecny prototyp `pages/` nie zawiera żadnej badanej relacji jako danych — to
   projekt strukturalny, nie kodyfikacja stanu istniejącego.
5. Cztery niespójne słowniki trybu wymiany są poprawnie wykluczone z archetypu Party jako
   atrybuty stanu przedmiotu.
6. Obecny sposób budowania `Term.neededItems` (z własnego katalogu organizatora) jest
   wewnętrznie niespójny i nie powinien być wzorcem dla docelowego modelu potrzeby.

### Direct answer to research question

Relacje Organizator → Grupa → Uczestnicy modeluje się jako Party (`Person`/`Group`/`Group`)
połączone relacjami `leadership` i `membership` z walidacją czasową. "Prośba o rzecz" jest
atrybutem `Term` (poza archetypem Party). "Zgłoszenie na ochotnika" to nowy, pośredni
koncept `Pledge`, który referencuje Party jako "kto", ale konwertuje się w `Reservation`
(bez zmiany jej kontraktu) dopiero gdy wolontariusz zarejestruje konkretny `InventoryItem`
— chroniąc zarówno spójność Party Archetype (Fit Test), jak i niezmieniony model
wypożyczalni/punktowy.

---

## Recommendations

| Rekomendacja | Priorytet | Effort | Rationale | Benefits | Risks |
|---|---|---|---|---|---|
| Wprowadzić relacje `leadership`/`membership` z `validFrom`/`validTo` zamiast string-match/pozycji | High | Medium | Finding 1, 2 — brak jest dziś kompletny | Umożliwia realne zapytania relacyjne i historyczne | Wymaga migracji istniejących (mock) danych do referencji id |
| Wprowadzić `Pledge` jako osobny koncept pośredni | High | Medium | Finding 3, 4, Fit Test | Rozwiązuje zidentyfikowaną lukę integracyjną bez naruszania modelu wypożyczalni | Wymaga decyzji produktowej co do momentu i sposobu konwersji na Reservation |
| Potwierdzić z użytkownikiem cardinality `leadership`/`membership` przed implementacją | High | Low | Oznaczone (X), wpływ biznesowy średni | Unika kosztownej zmiany modelu później | Brak — to tylko rozmowa/decyzja |
| Rozstrzygnąć potrzebę osobnej tożsamości `Person` dla członków rodziny | Medium | Low (decyzja) / Medium (implementacja) | Wymagane dla poprawnej konwersji Pledge→Reservation (Finding 5) | Precyzyjniejsza atrybucja punktów i odpowiedzialności | Odłożenie tej decyzji zbyt długo utrudni retrofit |

(Rekomendacje ograniczone do poziomu modelu domenowego — bez propozycji stacku
technologicznego, redesignu UI ani zmian w modelu punktowym, zgodnie z ograniczeniami z
research brief.)

---

## Appendices

### A. Complete source list

- `pages/KragGrupy.tsx`, `pages/KragGrupyStart.tsx`, `pages/PanelOrganizatora.tsx`,
  `pages/PanelGoscia.tsx`, `pages/ProfilMobilny.tsx`, `pages/StronaGlowna.tsx`,
  `pages/GaleriaZdjec.tsx`, `pages/SPEC.md` — przeczytane w całości.
- `docs/system-wypozyczalni-inventory-accounting.md` (561 linii) — przeczytany w całości.
- `.claude/skills/party-archetype-mapper/SKILL.md` (470 linii) — przeczytany w całości.
- Findings: `analysis/findings/codebase-pages-model.md`,
  `analysis/findings/inventory-model-circulation.md`,
  `analysis/findings/archetype-methodology-party.md`.

### B. Gaps and uncertainties (skonsolidowane)

Patrz sekcja [Gaps and Uncertainties w `analysis/synthesis.md`](../analysis/synthesis.md)
dla pełnej listy; najważniejsze: cardinality `leadership`/`membership` niepotwierdzone,
potrzeba osobnej tożsamości członków rodziny nierozstrzygnięta, kształt pola "opis
potrzeby" (wolny tekst vs referencja do kategorii) nierozstrzygnięty, zachowanie
`Reservation.status: cancelled` nieudokumentowane w źródle.

### C. Methodology details

Trzy równoległe strumienie zbierania (codebase / inventory-model / archetype-methodology),
zgodnie z `planning/research-plan.md` §5 — rozdzielenie zapobiegło pomieszaniu cytatów z
kodu z regułami archetypu podczas syntezy.

### D. Excluded context

`.maister/docs/**` (INDEX.md, project/, standards/) opisuje niepowiązany projekt —
platformę "aj" (Python/FastAPI/SQLAlchemy microkernel) — jawnie wykluczone jako
niewiążące dla tego badania, zgodnie z research brief.
