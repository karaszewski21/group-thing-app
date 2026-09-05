# Research Brief — Party Archetype dla relacji Organizator → Grupa → Uczestnicy

## Pytanie badawcze (verbatim od użytkownika)

> Aplikacja ma na celu organizować zajęcia i pomóc w wymiaie/oddanie/wypożyczenie różnego
> typu rzeczy (zabawki, książki etc). Organizator ma również mieć możliwość przy dodawaniu
> zajęć, możliwość poproszenia o rzeczy, które potrzebuje na zajęcia — termin "kto chcę
> przynieść rzecz X, może się zgłosić na ochotnika". Chcę wykorzystać archetyp Party do
> modelowania relacji organizator → grupa, grupa → uczestnicy. Więcej danych na temat
> implementacji systemu wypożyczalni jest w dokumencie
> `docs/system-wypozyczalni-inventory-accounting.md`.

## Klasyfikacja

**Typ badania**: mixed (requirements + technical + architektura)
- **Requirements**: jak nazwać/ustrukturyzować relacje Organizator/Grupa/Uczestnik oraz
  "prośbę o rzecz na zajęcia + zgłoszenie na ochotnika" w kategoriach domenowych.
- **Technical**: jak to się integruje z istniejącym prototypem (`pages/*.tsx`,
  `pages/SPEC.md`) i z już zaprojektowanym modelem księgowania obiegu przedmiotów
  (`docs/system-wypozyczalni-inventory-accounting.md`).
- **Architektura**: docelowy model domenowy (Party Archetype + integracja z
  Reservation/InventoryBalance/CirculationTransaction).

## Zakres

### Included
- Modelowanie Organizator, Grupa (zajęcia cykliczne / stała grupa), Uczestnik (rodzina/
  dziecko/rodzic) przy użyciu Party Archetype: Party (Person/Organization/Group), Role Type
  (z ważnością czasową), Relationship (kardynalność, kierunkowość), Contact Mechanism.
- Modelowanie "Zajęć" (Term/Meeting z `pages/SPEC.md`) jako punktu, przy którym organizator
  może zgłosić potrzebę na konkretne rzeczy ("potrzebuję X na zajęcia").
- Modelowanie "zgłoszenia na ochotnika" — uczestnik/rodzina deklaruje chęć przyniesienia
  rzeczy X na dane zajęcia (obecnie zaszyte jako `NEEDED_ITEMS` + `toggleBringClaim` w
  `KragGrupy.tsx`, i `toggleNeededItem` w `PanelOrganizatora.tsx`).
- Punkty integracji z modelem wypożyczalni (`Reservation`, `InventoryBalance`,
  `CirculationTransaction`, `InventoryItem`) z dokumentu inventory-accounting — czy
  "zgłoszenie na ochotnika" to osobny koncept, czy szczególny przypadek/prekursor
  `Reservation`.
- Istniejący prototyp UI/danych w `pages/` jako źródło rzeczywistych nazw domenowych
  (Family, Group, Term, Item, ItemMode, Gift, GiftSource) do zmapowania na archetyp.

### Excluded
- Pełny redesign UI/UX stron prototypowych (to już opisane w `pages/SPEC.md`, poza
  zakresem tego badania).
- Szczegóły implementacji backendu/bazy danych (wybór frameworka, ORM) — badanie skupia
  się na modelu domenowym, nie na stacku technologicznym.
- Zmiana już zaprojektowanego modelu punktowego (Points/CirculationTransaction) — badanie
  ma go uwzględnić jako dany kontekst, nie przeprojektowywać.

### Constraints
- Musi być spójne z konwencją Party Archetype (zgodnie ze skillem
  `party-archetype-mapper`): Party / RoleType (z validity) / Relationship (cardinality +
  directionality) / ContactMechanism.
- Musi być spójne z modelem z `docs/system-wypozyczalni-inventory-accounting.md`
  (Reservation jako "koszyk", CirculationTransaction dopiero przy `fulfilled`).
- **Uwaga o niespójności repo**: `.maister/docs/` (INDEX.md, standards/, project/) opisuje
  zupełnie inny projekt — platformę "aj" (Python/FastAPI/SQLAlchemy microkernel). Te
  standardy najwyraźniej pochodzą z innego repo/szablonu i **nie dotyczą** tej aplikacji
  (React/TS frontend prototyp dla zajęć + wymiany rzeczy między rodzinami,
  `pages/*.tsx`). Badanie traktuje je jako niewiążące i opiera się na rzeczywistym kodzie
  (`pages/`) oraz `docs/system-wypozyczalni-inventory-accounting.md`.

## Kryteria sukcesu

Raport badawczy powinien:
1. Dostarczyć konkretny model Party Archetype dla Organizator/Grupa/Uczestnik z jawnym
   mapowaniem na istniejące koncepty w `pages/` (Family, Group, Profile, itd.).
2. Zaproponować gdzie w modelu żyje "prośba o rzecz na zajęcia" i "zgłoszenie na
   ochotnika" — oraz jak (czy) łączy się to z `Reservation` z dokumentu inventory-accounting.
3. Wskazać elementy niezmapowane / otwarte pytania (zgodnie z konwencją
   party-archetype-mapper: explicit concept mapping + unmapped concepts section).
4. Być osadzony w realiach obecnego prototypu (cytować konkretne pliki/linie z `pages/`).

## Project Documentation (z `.maister/docs/INDEX.md`)

Odkryto, ale **odrzucono jako niezwiązane** z tym zadaniem (patrz Constraints powyżej):
- `.maister/docs/project/tech-stack.md`
- `.maister/docs/project/architecture.md`
- `.maister/docs/standards/**` (wszystkie)

`project_doc_paths` pozostaje puste dla tego badania — realnym kontekstem projektowym są
`docs/system-wypozyczalni-inventory-accounting.md` i `pages/SPEC.md`.
