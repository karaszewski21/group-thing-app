# Synthesis — Party Archetype dla Organizator → Grupa → Uczestnicy

## Research Question

Aplikacja organizuje zajęcia i wymianę/oddawanie/wypożyczanie rzeczy między rodzinami.
Organizator, dodając zajęcia, może poprosić o konkretne rzeczy potrzebne na zajęcia;
uczestnik może zgłosić się na ochotnika ("chcę przynieść rzecz X"). Należy wykorzystać
Party Archetype do modelowania relacji Organizator → Grupa → Uczestnicy oraz osadzić
mechanizm prośby/ochotnika względem systemu wypożyczalni
(`docs/system-wypozyczalni-inventory-accounting.md`).

Źródła: `analysis/findings/codebase-pages-model.md` (dalej: **CB**),
`analysis/findings/inventory-model-circulation.md` (dalej: **INV**),
`analysis/findings/archetype-methodology-party.md` (dalej: **ARCH**).

---

## Executive Summary

Zastosowanie Fit Testu ze skilla `party-archetype-mapper` (ARCH §1) do Organizator/Grupa/
Rodzina daje jednoznaczny wynik pozytywny: wszystkie trzy koncepty spełniają kryterium
"aktor gra rolę i/lub jest połączony relacją z cyklem życia" (ARCH SKILL.md:33), a nie
kryterium zwykłego FK. Kluczowy wniosek jest jednak inny niż mogłoby się wydawać z samego
kodu: **obecny prototyp (`pages/`) nie implementuje żadnej z tych relacji jako danych** —
CB §1.5 i CB §8 pokazują wprost, że powiązania Organizator↔Grupa i Grupa↔Rodzina są dziś
wyłącznie pozycyjne/wizualne (hardcoded string, ułożenie w tablicy) lub oparte na
dopasowaniu tekstu (`groupName: string`, nie `groupId`). Zastosowanie archetypu Party w tym
przypadku nie jest więc "opisaniem tego co już jest" — jest **rekomendacją wprowadzenia
brakującej struktury relacyjnej**, której dziś w kodzie nie ma wcale.

Drugi kluczowy wynik dotyczy umiejscowienia "prośby o rzecz" i "zgłoszenia na ochotnika".
Zastosowanie tego samego Fit Testu do samego zgłoszenia na ochotnika daje wynik
**negatywny w sensie ścisłym** — naturalne pytanie o zgłoszenie na ochotnika brzmi "w jakim
jest ono stanie" (otwarte/zgłoszone/wycofane/zrealizowane), co po Fit Teście (ARCH
SKILL.md:37) kieruje do state machine, nie do modelu aktor/relacja. Zgłoszenie na ochotnika
**nie powinno** więc być modelowane jako nowy typ `Relationship` w warstwie Party — powinno
być osobną, małą encją stanową ("Pledge"/"Zgłoszenie ochotnicze"), która *odwołuje się* do
Party (kto się zgłasza) jako do atrybutu, ale sama nie jest częścią archetypu Party.
Jednocześnie ta encja nie mieści się w istniejącym modelu `Reservation` z INV, ponieważ
`Reservation.itemId` jest polem wymaganym wskazującym na już istniejący, skonkretyzowany
`InventoryItem` (INV §7, punkt 1-2) — a zgłoszenie na ochotnika w obecnym kodzie dotyczy
opisu tekstowego przedmiotu, bez żadnego związanego `InventoryItem`. Rozwiązaniem zgodnym
z fallback strategy z research-planu jest wprowadzenie nowego, pośredniego konceptu
("Pledge"), który dopiero po skonkretyzowaniu przedmiotu (przypisaniu realnego
`InventoryItem`) przechodzi w `Reservation` — bez zmiany kontraktu `Reservation` i bez
naruszania zasady "Reservation zawsze pierwszy krok, CirculationTransaction dopiero przy
fulfilled" (INV §3).

Trzeci istotny wynik to konieczność jawnego wskazania punktu styku tożsamości: model
wypożyczalni operuje wyłącznie na pojedynczym `User` (INV §1, `Inventory.userId`,
`Reservation.reservedBy: User` — nigdy `Group`/`Family`, INV §7 punkt 5), podczas gdy
w warstwie Party "Uczestnik" jest najsensowniej modelowany jako `Rodzina` (Party typu
`Group`, zgodnie z własnym przykładem `Group` w skillu, ARCH SKILL.md:106, gdzie "Family"
jest wprost wymienione jako przykład Group). Oznacza to, że każde zgłoszenie na ochotnika
musi w pewnym momencie "zejść" z poziomu Rodziny (Group) do poziomu konkretnej osoby
(Person = `User`), zanim może stać się `Reservation`. To rozstrzygnięcie — a nie samo
wprowadzenie archetypu Party — jest głównym architektonicznym wkładem tego badania.

Confidence ogólny: **high** dla Fit Testu i klasyfikacji Party Types; **medium** dla
konkretnych cardinality/directionality relacji (nie potwierdzone w wymaganiach — jawnie
oznaczone jako założenia (X) wymagające decyzji użytkownika); **high** dla rozstrzygnięcia
"Pledge jako osobny koncept, nie Reservation, nie Party Relationship" (wynika wprost
z zastosowania Fit Testu i z twardego ograniczenia `Reservation.itemId`).

---

## Cross-Source Analysis

### Potwierdzone wzorce (confirmed across sources)

1. **Brak jakiejkolwiek relacyjnej struktury danych w `pages/` dla
   Organizator/Grupa/Rodzina** — potwierdzone niezależnie w trzech miejscach CB: brak
   `organizerId` na `Group` (CB §2.1, PanelOrganizatora.tsx:377-382), brak `groupId` na
   `Family` (CB §1.5), oraz jawne podsumowanie w CB §8 ("Open gaps... every cross-reference
   observed in `pages/` is either positional... or a free-text string match"). Trzy
   niezależne fragmenty kodu (KragGrupy, KragGrupyStart, PanelOrganizatora) potwierdzają tę
   samą lukę — **confidence: high**.

2. **Trzy/cztery niespójne słowniki trybu wymiany są atrybutami stanu przedmiotu, nie
   rolami aktorów** — CB §4 (tabela 3 słowników) + CB §5.2 (czwarty, wykryty niezależnie od
   SPEC.md) wprost pokazują, że `ItemMode`/`GiftSource`/`MODE_STYLE`/`EXCHANGE` opisują
   *stan/tryb przedmiotu*, a nie kto-jaką-rolę-gra. To potwierdza sygnał z research-planu
   (fallback strategy) i z ARCH Fit Testu ("what state is X in?" → nie mapuj na Party) —
   **confidence: high**.

3. **`Reservation` w INV zawsze wymaga konkretnego, już istniejącego `itemId`** —
   potwierdzone przez definicję pola (INV §7 pkt 1: `itemId: string`, nie `string | null`,
   w kontraście do jawnie opcjonalnych pól tej samej encji) oraz przez wszystkie 4
   przykładowe flow w dokumencie (lend/return/swap/gift), gdzie `InventoryItem` +
   `InventoryBalance(available)` zawsze powstają PRZED `Reservation` (INV §7 pkt 3) —
   **confidence: high**.

### Rozbieżności zidentyfikowane i wyjaśnione

- **"Prośba o rzecz" istnieje w kodzie w dwóch niepowiązanych wariantach**, nie w jednym:
  `NEEDED_ITEMS` (KragGrupy.tsx:289, wolny tekst, niezależny od jakiegokolwiek `Item`) oraz
  `Term.neededItems` (PanelOrganizatora.tsx:390, budowany z nazw organizatora własnego
  katalogu `Item[]`, CB §2.3). Nie jest to sprzeczność do "rozstrzygnięcia" w sensie
  wybrania jednej wersji jako prawdziwej — obie są prawdziwe, równolegle istniejące
  fragmenty tego samego, niedokończonego prototypu (CB §2.3: "the single most important
  integration gap for the research question"). Synteza traktuje to jako dowód, że **żaden
  z dwóch obecnych mechanizmów nie jest gotowym wzorcem do skopiowania** — trzeba
  zaprojektować nowy, wspólny model (patrz sekcja "Model prośby/ochotnika" niżej).
- **Kuriozalny fakt w `PanelOrganizatora.tsx`**: organizator, prosząc o rzeczy na zajęcia
  *od rodzin*, wybiera je wyłącznie z *własnego* katalogu `items` (CB §2.3, linia 434:
  "the checklist is built from `items.map(...)`, so the organizer is choosing which of
  their own things they want brought/returned"). To sugeruje, że nawet w obrębie
  pojedynczego pliku model "prośby o rzecz" jest wewnętrznie niespójny — prośba powinna
  logicznie dotyczyć rzeczy, których organizator *nie ma*, a mimo to źródłem wyboru jest
  jego własna lista. Nie jest to błąd do naprawienia w tym badaniu (poza zakresem — brief
  wyklucza redesign UI), ale jest to istotny sygnał przy projektowaniu nowego modelu
  "potrzeby": potrzeba powinna być opisem (nazwa/kategoria), nie referencją do cudzego
  `Item` — **confidence: high** (bezpośrednio zacytowany kod).

### Ocena jakości dowodów

| Twierdzenie | Poziom pewności | Uzasadnienie |
|---|---|---|
| Organizator/Grupa/Rodzina przechodzą Fit Test archetypu Party | High | Jednoznaczne dopasowanie do sygnałów ARCH SKILL.md:16-20; potwierdzone również przez to, że `Group` jest w skillu wprost zdefiniowany z przykładami "Family, Class" (ARCH §2/SKILL.md:106) |
| Zgłoszenie na ochotnika NIE jest Party Relationship | High | Bezpośrednie zastosowanie reguły routingu Fit Testu (ARCH SKILL.md:35-38, "what state is X in? → state machine") |
| Reservation nie może bezpośrednio reprezentować zgłoszenia na ochotnika | High | Twarde ograniczenie typu pola `itemId: string` (nie nullable) + brak przykładu bez itemId w całym dokumencie INV (INV §7) |
| Rodzina = Party typu Group (nie Person) | Medium-High | Wspiera to przykład z ARCH (Family jako przykład Group), ale to decyzja projektowa, nie fakt wyprowadzony z wymagań |
| Cardinality Organizator↔Grupa = 1:N, Grupa↔Rodzina = N:N | Medium | Brak w wymaganiach i kodzie jawnego potwierdzenia; oznaczone jako założenie (X) wymagające decyzji |
| Potrzeba osobnej tożsamości Person dla członka rodziny | Low (obecnie "nie potrzeba") | Kod nie daje dowodu na potrzebę (CB §1.3 — "you" jest anonimowe/singleton); YAGNI |

---

## Patterns and Themes

### Pattern: "Brak modelu relacyjnego, tylko pozycja i string-match" (Organizational)

Występuje konsekwentnie w całym `pages/`: `groupName: string` zamiast `groupId` (CB §2.1,
PanelOrganizatora.tsx:264-280), `Gift.from: string` zamiast FK do Family (CB §2.1, linia
329), `Family.bring` dopasowywane do `NEEDED_ITEMS` przez równość stringów (CB §1.2, linie
64-76). Dojrzałość: ad-hoc/prototypowa (brak backendu, cały stan w `useState` — CB §7).
Jest to spójny, powtarzalny wzorzec w całym kodzie, nie odosobniony przypadek — silny
sygnał, że wprowadzenie właściwego modelu Party (z prawdziwymi id-referencjami i
relacjami) jest realną wartością dodaną tego badania, a nie tylko ćwiczeniem
akademickim.

### Pattern: "Aktywny głos vs bierny głos w słownictwie trybu wymiany" (Implementation/Vocabulary)

CB §4 pokazuje 3 (+1 w ProfilMobilny, CB §5.2) niezależne słowniki opisujące te same 3
pojęcia (oddaj na stałe / pożycz tymczasowo / zamień) w różnych formach gramatycznych.
Potwierdza to (niezależnie od SPEC.md) że są to atrybuty *stanu przedmiotu* w różnych
kontekstach (oferta aktywna vs opis skąd coś przyszło), nie role aktorów — istotne dla
Concept Mapping (te koncepty lądują w "Unmapped Concepts").

### Pattern: "Reservation jako toaster dla już-istniejących przedmiotów" (Integration)

INV §7 pokazuje bardzo konsekwentny wzorzec projektowy: w każdym z 4 flow (lend/return/
swap/gift) kolejność jest zawsze: najpierw `InventoryItem` + `InventoryBalance(available)`,
dopiero potem `Reservation`. Jest to świadomy, jednolity wzorzec (nie przypadek), wspierany
przez jawny cytat dokumentu (INV §1: "Każda zmiana posiadania... zaczyna się od
Reservation... Dopiero gdy któraś ze stron zaakceptuje odbiór, powstaje
CirculationTransaction"). Ten wzorzec jest *celowo* wąski i nie powinien być rozszerzany
(brief wyklucza redesign modelu punktowego) — stąd wniosek, że nowy koncept ("Pledge") musi
żyć obok, nie wewnątrz, `Reservation`.

---

## Key Insights

### Insight 1 — Party Archetype tu nie opisuje istniejących danych, tylko projektuje brakujące

**Dowód**: CB §1.5, §2.1, §8 (brak `organizerId`, `groupId`, `memberSince` wszędzie).
**Implikacja**: raport nie może być czytany jako "udokumentowanie tego co jest" — to
rekomendacja strukturalna. Warto to jasno komunikować odbiorcy raportu, żeby nie oczekiwał,
że wdrożenie modelu Party to tylko "przepisanie" istniejącego kodu.
**Confidence**: High.

### Insight 2 — Zgłoszenie na ochotnika żyje w martwej strefie między dwoma modelami

**Dowód**: CB §2.3 (Term.neededItems i BringClaim nigdy się nie łączą) + INV §7 (Reservation
wymaga itemId). Oba źródła niezależnie potwierdzają tę samą lukę z dwóch różnych stron
(strona UI/kodu i strona modelu docelowego).
**Implikacja**: potrzebny jest nowy, jawnie nazwany koncept pośredni. To nie jest defekt do
"naprawienia" w istniejącym kodzie (poza zakresem), ale realna decyzja projektowa do
podjęcia przy projektowaniu docelowego modelu domenowego.
**Confidence**: High.

### Insight 3 — Tożsamość musi "zejść" z poziomu Grupy/Rodziny do poziomu pojedynczej osoby (User) zanim powstanie Reservation

**Dowód**: INV §7 pkt 5 (`Inventory.userId` i `Reservation.reservedBy: User` — zawsze
pojedynczy user, nigdy Group/Family) skrzyżowane z decyzją modelowania Rodziny jako Party
typu Group (ARCH SKILL.md:106).
**Implikacja**: warstwa Party musi udostępniać jawne mapowanie Person↔User (patrz sekcja
Implementation Notes w raporcie) — to jest punkt integracji, nie szczegół.
**Confidence**: High.

### Insight 4 — Organizator sam może być typowym przykładem "multi-role" z Fit Testu

**Dowód**: ARCH sygnał #1 (SKILL.md:16, "the same real-world entity can play multiple roles"
— np. organizator jednej grupy będący jednocześnie uczestnikiem innej). Kod nie potwierdza
ani nie zaprzecza tej możliwości (brak `organizerId`, wszystko hardcoded per-page), ale to
dokładnie ten scenariusz, dla którego archetyp Party istnieje (rozdzielenie tożsamości od
roli).
**Implikacja**: model musi pozwalać jednej osobie (Person) trzymać zarówno rolę Organizer,
jak i być powiązaną (przez swoją Rodzinę/Group) z rolą Uczestnika w innej grupie — bez
duplikowania tożsamości.
**Confidence**: Medium (uzasadnione metodologicznie, nie potwierdzone dowodem z wymagań).

---

## Relationships and Dependencies

```
Person (Organizator)  --[organizuje]-->  Group (Grupa)  <--[jest członkiem]--  Group (Rodzina)
      |                                        |
      | (tożsamość = User w modelu wypożyczalni)   | (kontekst dla Term/zajęcia)
      v                                        v
   User (INV)                              Term (zajęcia; NIE Party)
                                                |
                                                | (opisuje potrzebę)
                                                v
                                     NeededItem / prośba o rzecz (NIE Party)
                                                |
                                                | (ktoś się zgłasza)
                                                v
                                  Pledge/VolunteerCommitment  --[referencuje]--> Party (Rodzina/Person)
                                                |
                                                | (po skonkretyzowaniu przedmiotu)
                                                v
                                     InventoryItem (INV) istnieje  -->  Reservation (INV, itemId wymagany)
                                                                              |
                                                                              v (przy fulfilled)
                                                                     CirculationTransaction (INV, bez zmian)
```

Integration points:
- **Party ↔ Inventory**: Person = User (identity bridge, Insight 3).
- **Party ↔ Term**: Term nie jest Party, ale "żyje w kontekście" relacji Organizator↔Grupa
  (Term.groupName → docelowo Grupa; Term jest tworzony przez Organizatora tej Grupy).
- **Pledge ↔ Party**: Pledge referencuje Party (Rodzinę lub — po rozstrzygnięciu — osobę)
  jako pole, ale nie jest sam typem Relationship w archetypie Party.
- **Pledge ↔ Reservation**: Pledge jest prekursorem; konwersja następuje wyłącznie gdy
  wolontariusz przypisze/zarejestruje konkretny `InventoryItem` — dopiero wtedy może
  powstać `Reservation` zgodna z niezmienionym kontraktem z INV.

---

## Gaps and Uncertainties

- **Cardinality Organizator↔Grupa** (czy jeden organizator może współprowadzić grupę z
  kimś innym?) — brak dowodu w kodzie i wymaganiach. Otwarte pytanie.
- **Cardinality Grupa↔Rodzina** (czy rodzina może należeć do wielu grup jednocześnie?) —
  brak dowodu; przyjęto N:N jako założenie robocze (X), do potwierdzenia.
- **Czy potrzebna jest osobna tożsamość Person dla członków rodziny** (rodzic vs dziecko)
  — obecnie brak dowodu potrzeby (CB §1.3: "you" jest anonimowe), ale realny system
  produkcyjny prawdopodobnie tego zażąda przy logowaniu wielu opiekunów z jednej rodziny.
  Otwarte, świadomie odłożone (YAGNI) pytanie.
- **Kształt pola docelowego "potrzeby"** (czy to wolny tekst, czy odniesienie do
  kategorii/`Product`) — obecny kod ma dwa sprzeczne podejścia (wolny tekst w KragGrupy vs
  referencja do własnego katalogu w PanelOrganizatora, oba niedoskonałe, patrz Cross-Source
  Analysis wyżej). Wymaga decyzji produktowej, nie tylko modelarskiej.
- **Zachowanie `Reservation.status: cancelled`** — INV §2 jawnie odnotowuje brak
  przykładu/scenariusza w źródle; nie wpływa bezpośrednio na model Party, ale może wpłynąć
  na to, co się dzieje z Pledge, jeśli powiązana Reservation zostanie anulowana (otwarte).
- **Wszystkie decyzje oznaczone (X) w tym badaniu nie przeszły interaktywnego
  AskUserQuestion** (bo to badanie, nie sesja implementacyjna z live-mapperem) — zgodnie z
  regułą Step 7.5 ARCH (SKILL.md:277-282), przed wdrożeniem modelu decyzje o wpływie
  biznesowym (cardinality, validity/termination) powinny zostać jawnie potwierdzone przez
  użytkownika, a nie tylko udokumentowane jako założenie.

---

## Synthesis by Framework (Mixed: Requirements + Technical + Architecture)

**Requirements framework**: Stated requirement = "wykorzystać Party Archetype dla
Organizator→Grupa→Uczestnicy" (explicit, R). Implicit requirement = potrzeba spójnego
mechanizmu prośba/ochotnik (wynika z opisu "kto chce przynieść rzecz X może się zgłosić na
ochotnika", nie z istniejącego kodu, który tego nie łączy). Gap: brak wymagania co do
cardinality/multi-membership — pozostawione jako otwarte pytanie zamiast zgadywane na
sztywno.

**Technical framework**: Component analysis = 7 plików `pages/`, żaden nie implementuje
relacyjnego modelu Party; Flow analysis = organizator dodaje Term → deklaruje potrzebę →
(dziś: dwa niepołączone mechanizmy) → docelowo: Pledge → Reservation → fulfilled →
CirculationTransaction (bez zmian, INV).

**Architecture framework**: Granica między modelem Party (kto/jaka rola/jaka relacja) a
modelem wypożyczalni (co/jaki status/jaka transakcja) przebiega dokładnie na granicy
Pledge→Reservation: Pledge zna Party i opis potrzeby; Reservation zna wyłącznie User i
konkretny InventoryItem. Ta granica jest świadomie wąska, żeby nie naruszać
niezmienionego kontraktu Reservation/CirculationTransaction (constraint z brief).

---

## Conclusions

### Primary

1. Organizator, Grupa i Rodzina/Uczestnik przechodzą Fit Test archetypu Party i powinny być
   modelowane jako: `Person` (Organizator), `Group` (Grupa), `Group` (Rodzina) — z rolami
   `Organizer` (scoped do Grupy) i `Member` (Rodzina scoped do Grupy) połączonymi
   relacjami `leadership` i `membership`, obie z rekomendowaną walidacją czasową, której
   dziś w kodzie brak. **Confidence: High** (klasyfikacja), **Medium** (dokładne
   cardinality).
2. Zgłoszenie na ochotnika NIE powinno być modelowane jako `Relationship` w archetypie
   Party ani jako `Reservation` w modelu wypożyczalni — wymaga nowego, pośredniego
   konceptu ("Pledge"/"Zgłoszenie ochotnicze"), który referencuje Party, ale żyje poza
   ścisłym archetypem Party i poza niezmienionym kontraktem Reservation. **Confidence:
   High.**
3. Kluczowy punkt integracji między dwoma modelami to tożsamość: `Person` w warstwie Party
   musi odpowiadać `User` w modelu wypożyczalni, ponieważ `Reservation.reservedBy` i
   `Inventory.userId` nigdy nie wskazują na grupę/rodzinę. **Confidence: High.**

### Secondary

4. Obecny prototyp `pages/` nie zawiera żadnej z tych relacji jako danych — wprowadzenie
   modelu Party to realna zmiana strukturalna, nie kodyfikacja istniejącego stanu.
5. `ItemMode`/`GiftSource`/`MODE_STYLE`/`EXCHANGE` (4 niespójne słowniki) są atrybutami
   stanu przedmiotu, poprawnie wykluczone z archetypu Party.
6. Sposób, w jaki `PanelOrganizatora.tsx` dziś buduje `Term.neededItems` (z własnego
   katalogu organizatora, nie z opisu potrzeby) jest wewnętrznie niespójny i nie powinien
   być traktowany jako wzorzec do naśladowania przy projektowaniu Pledge.

### Recommendations (poziom modelu domenowego, zgodnie z granicami z brief)

- Wprowadzić jawne relacje `leadership` (Organizator→Grupa) i `membership` (Rodzina→Grupa)
  z polami `validFrom`/`validTo`, zamiast dalszego polegania na string-match/pozycji.
- Wprowadzić nowy typ encji `Pledge` (nazwa robocza) wiążący Party (Rodzina, docelowo z
  rozstrzygnięciem "kto konkretnie" na poziomie osoby) z opisem potrzebnego przedmiotu na
  danym Termie, z jawnym przejściem w `Reservation` dopiero po przypisaniu konkretnego
  `InventoryItem` — bez modyfikacji istniejącego kontraktu `Reservation`.
- Przed implementacją: rozstrzygnąć z użytkownikiem/product ownerem cardinality
  Organizator↔Grupa i Grupa↔Rodzina oraz potrzebę osobnej tożsamości dla członków rodziny
  (oznaczone (X) w tym dokumencie) — zgodnie z regułą Step 7.5 metodologii Party.
