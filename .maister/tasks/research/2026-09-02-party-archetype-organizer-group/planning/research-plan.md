# Research Plan — Party Archetype dla Organizator → Grupa → Uczestnicy

## 1. Research Overview

**Pytanie badawcze**: Aplikacja organizuje zajęcia i wymianę/oddawanie/wypożyczanie rzeczy
między rodzinami. Organizator, dodając zajęcia, może poprosić o konkretne rzeczy potrzebne
na zajęcia; uczestnik może zgłosić się na ochotnika ("chcę przynieść rzecz X"). Należy
wykorzystać **Party Archetype** do modelowania relacji Organizator → Grupa → Uczestnicy, a
model prośby/ochotnika osadzić względem systemu wypożyczalni opisanego w
`docs/system-wypozyczalni-inventory-accounting.md`.

**Typ badania**: Mixed (requirements + technical + architektura domenowa)
- Requirements: nazewnictwo/struktura Organizator/Grupa/Uczestnik oraz "prośba o rzecz" +
  "zgłoszenie na ochotnika" w kategoriach domenowych.
- Technical: integracja z istniejącym prototypem (`pages/*.tsx`, `pages/SPEC.md`).
- Architektura: docelowy model domenowy — Party Archetype + integracja z
  Reservation/InventoryBalance/CirculationTransaction z dokumentu inventory-accounting.

**Scope**:
- **In**: Party/RoleType/Relationship/ContactMechanism dla Organizator/Grupa/Uczestnik;
  modelowanie "Zajęć" (Term) jako punktu zgłoszenia potrzeby; modelowanie zgłoszenia na
  ochotnika (obecnie `NEEDED_ITEMS`/`toggleBringClaim` w `KragGrupy.tsx`,
  `toggleNeededItem` w `PanelOrganizatora.tsx`); punkt integracji z `Reservation` z
  dokumentu wypożyczalni; mapowanie na istniejące koncepty w `pages/` (Family, Group, Term,
  Item, ItemMode, Gift, GiftSource).
- **Out**: redesign UI/UX (już opisany w `pages/SPEC.md`); wybór stacku
  backend/DB/ORM; przeprojektowanie modelu punktowego (Points/CirculationTransaction) —
  traktowany jako dany kontekst.
- **Constraints**: zgodność z konwencją `party-archetype-mapper` (Party / RoleType z
  validity / Relationship z cardinality+directionality / ContactMechanism); zgodność z
  modelem z `docs/system-wypozyczalni-inventory-accounting.md` (Reservation jako "koszyk",
  CirculationTransaction dopiero przy `fulfilled`).
- **Uwaga**: `.maister/docs/**` opisuje niepowiązany projekt (platforma "aj",
  Python/FastAPI) i jest wykluczony jako źródło — `project_doc_paths` jest puste.

---

## 2. Methodology

**Primary approach**: Mapowanie domeny na archetyp Party (zgodnie z metodologią skilla
`party-archetype-mapper`: Step 1 identyfikacja Party Types, Step 2 Role Types + validity,
Step 3 Relationships + cardinality/directionality, Step 4 Contact Mechanisms, Concept
Mapping, Unmapped Concepts) w połączeniu z analizą kodu istniejącego prototypu
(`pages/*.tsx`) oraz modelu wypożyczalni (`docs/system-wypozyczalni-inventory-accounting.md`).

**Fallback strategies**:
- Jeśli konkretny koncept z `pages/` nie mapuje się czysto na Party/Role/Relationship
  (np. `mode`/`ItemMode`/`GiftSource` to raczej stan przedmiotu niż rola aktora) —
  udokumentować jako Unmapped Concept zamiast wymuszać dopasowanie.
- Jeśli "zgłoszenie na ochotnika" nie mieści się ani w Party Archetype, ani czysto w
  `Reservation` (bo `Reservation` dotyczy zmiany posiadania konkretnego `InventoryItem`, a
  zgłoszenie na ochotnika może dotyczyć jeszcze niekonkretnego egzemplarza) — opisać to
  jako otwarte pytanie/hybrydowy koncept (np. "intencja poprzedzająca Reservation").

**Analysis framework** (mixed — technical + requirements + architektura):
- Component/concept identification: jakie encje istnieją w `pages/` (Family, Group, Term,
  Item, Gift) i w dokumencie wypożyczalni (User, Inventory, InventoryItem,
  InventoryBalance, Reservation, CirculationTransaction).
- Pattern recognition: które z tych konceptów to Party (aktor grający rolę) vs Role
  (kontekstowe uprawnienie/funkcja) vs Relationship (powiązanie z cyklem życia) vs zwykły
  atrybut/FK.
- Flow analysis: przepływ "organizator dodaje Term → zgłasza potrzebę rzeczy X → uczestnik
  zgłasza się na ochotnika → (opcjonalnie) powstaje Reservation → fulfilled →
  CirculationTransaction".
- Integration mapping: gdzie żyje granica między modelem Party (kto/jaka rola/jaka relacja)
  a modelem wypożyczalni (co/jaki status/jaka transakcja).
- Gap identification: co jest niezmapowane lub wymaga decyzji użytkownika.

---

## 3. Data Sources

### Codebase Sources (prototyp UI + zaszyte modele danych)
- `pages/KragGrupy.tsx` — `type Family` (linia ~147 wg SPEC), `NEEDED_ITEMS` (linia 289),
  `toggleBringClaim` (linia 307), sekcja "Kto co przynosi" (linia ~454).
- `pages/KragGrupyStart.tsx` — wariant `KragGrupy.tsx` z mniejszą listą `FAMILIES` (widok
  "na starcie" tuż po założeniu grupy) — ten sam model danych.
- `pages/PanelOrganizatora.tsx` — `type ItemMode` (linia 393), `type GiftSource` (linia
  429), `toggleNeededItem` (linia 547), widok `spotkania` z sekcjami Grupy/Terminy (CRUD:
  `addGroup`, `removeGroup`, `addTerm`, `removeTerm`, `toggleNeededItem`).
- `pages/PanelGoscia.tsx` — perspektywa uczestnika/gościa: `MY_TERMS` (tylko odczyt, brak
  zarządzania grupami), te same typy `Item`/`ItemMode`/`Gift`/`GiftSource` co
  `PanelOrganizatora.tsx` (duplikacja ~85% wg SPEC §0/pkt 5).
- `pages/ProfilMobilny.tsx` — publiczny profil prowadzącej/grupy, statystyki "Rodziny: 32",
  sekcja "Wymiana rzeczy" (Oddam/Wymienię/Wypożyczę).
- `pages/StronaGlowna.tsx`, `pages/GaleriaZdjec.tsx` — drugorzędne dla modelu domenowego
  (landing page / galeria), sprawdzić tylko czy niosą dodatkowe koncepty relacyjne.

### Documentation Sources
- `pages/SPEC.md` — pełna specyfikacja 7 stron: krytyczne luki, wspólne wzorce, model
  danych `Family`, mapa nawigacji, rekomendacje ujednolicenia słownika trybów
  (wymienię/pożyczę/oddam vs wypożyczę/oddam/zamienię vs pożyczone/otrzymane/zamienione).
- `docs/system-wypozyczalni-inventory-accounting.md` — pełny model: `User`, `Inventory`,
  `InventoryItem`, `InventoryBalance`, `Reservation` ("koszyk" — pierwszy krok każdej
  zmiany posiadania, status pending/confirmed/cancelled/fulfilled),
  `CirculationTransaction` (powstaje dopiero przy `fulfilled`), model punktowy
  (`Points`, konta 100-100/900-100) — do ponownej, pełnej analizy przez gatherera (research
  brief już go zna częściowo, ale plan wymaga świeżego, kompletnego odczytu z cytatami).

### Methodology Sources
- `.claude/skills/party-archetype-mapper/SKILL.md` — konwencja mapowania: Party Types
  (Person/Organization/Group), Role Types (z validity), Relationships (cardinality +
  directionality), Contact Mechanisms, sekcje wyjściowe "Concept Mapping" i "Unmapped
  Concepts" (patrz nagłówki `## Party Types`, `## Concept Mapping`, `## Unmapped
  Concepts`, `## Role Types`, `## Relationships`, `## Validity Rules`, `## Contact
  Mechanisms & Identifiers`, `## Implementation Notes`, `## Common Patterns & Pitfalls`,
  `## Quality Checks`), plus przykład referencyjny w sekcji `## Example`.

### Excluded Sources (jawnie odrzucone)
- `.maister/docs/**` (INDEX.md, project/, standards/) — opisuje niepowiązany projekt
  "aj" (Python/FastAPI microkernel), niewiążące dla tego badania.

---

## 4. Research Phases

### Phase 1: Broad Discovery
- Potwierdzić pełną listę plików w `pages/` i ich rolę (już wykonane — 7 plików + SPEC.md).
- Zweryfikować istnienie i pełną treść `docs/system-wypozyczalni-inventory-accounting.md`.
- Zlokalizować metodologię `party-archetype-mapper` (`.claude/skills/party-archetype-mapper/SKILL.md`).

### Phase 2: Targeted Reading
- Przeczytać w całości `pages/KragGrupy.tsx` / `KragGrupyStart.tsx` (model `Family`,
  `NEEDED_ITEMS`, `toggleBringClaim`) z dokładnymi numerami linii.
- Przeczytać w całości `pages/PanelOrganizatora.tsx` i `pages/PanelGoscia.tsx` (typy
  `Profile`/`Term`/`Item`/`ItemMode`/`Gift`/`GiftSource`, `toggleNeededItem`,
  CRUD grup/terminów).
- Przeczytać `pages/SPEC.md` w całości (już wykonane w tym planie — do potwierdzenia przez
  gatherera z cytatami).
- Przeczytać `docs/system-wypozyczalni-inventory-accounting.md` w całości, ze szczególnym
  naciskiem na definicję `Reservation` i przejście `pending → confirmed → fulfilled`.
- Przeczytać sekcje `Mapping Workflow`, `Output Format`, `Common Patterns & Pitfalls`,
  `Quality Checks` i `Example` skilla `party-archetype-mapper`.

### Phase 3: Deep Dive
- Zmapować `Family`/uczestnika, `Group`/grupę zajęciową, `Organizator`/prowadzącą na
  Party Types (Person vs Group) i Role Types (np. Organizer, Participant/Guardian) z
  atrybutami ważności czasowej (czy uczestnictwo w grupie ma start/end?).
- Zmapować relację Grupa↔Uczestnik i Organizator↔Grupa na Relationship (cardinality:
  1 organizator : N grup? N uczestników : 1 grupa?; directionality).
- Prześledzić, gdzie w modelu żyje "prośba o rzecz na zajęcia" (`toggleNeededItem` na
  poziomie `Term`) i "zgłoszenie na ochotnika" (`toggleBringClaim` na poziomie
  `NEEDED_ITEMS`/`Family`) — czy to nowy typ Relationship/zdarzenie, czy rozszerzenie roli.
- Zbadać punkt styku z `Reservation`: czy zgłoszenie na ochotnika to (a) prekursor
  `Reservation` (intencja przed potwierdzeniem), (b) osobny koncept "Pledge"/"Volunteer
  Commitment" poza modelem wypożyczalni, czy (c) `Reservation` z `type` rozszerzonym o
  nowy wariant — z jawnym uzasadnieniem wyboru.
- Zidentyfikować konflikty nazewnicze między `pages/` a dokumentem wypożyczalni (np.
  `Family` vs `User`, `Item`/`Gift` vs `InventoryItem`/`Product`) i zaproponować spójne
  mapowanie lub jawnie oznaczyć jako otwarte pytanie.

### Phase 4: Verification
- Sprawdzić zgodność proponowanego modelu z Fit Test skilla (`## When NOT to Use — Fit
  Test`) — potwierdzić, że Organizator/Grupa/Uczestnik faktycznie spełniają kryterium
  "aktor gra rolę i/lub jest połączony relacją z cyklem życia", a nie że to zwykły FK.
  Osobno ocenić, czy tryby `ItemMode`/`GiftSource` NIE są Party Role (to raczej atrybut
  stanu przedmiotu — potencjalny sygnał "nie mapuj tego na Party").
  Zweryfikować, czy "zgłoszenie na ochotnika" faktycznie wymaga modelu Party/Relationship
  czy wystarczy prostszy encja-zdarzenie (cross-check z `problem-classifier`-owym
  rozróżnieniem CRUD vs coś więcej — poza zakresem wyboru innego archetypu, ale istotne
  dla `Unmapped Concepts`).
- Zweryfikować kompletność Concept Mapping (każdy koncept z `pages/` — Family, Group,
  Term, Item, ItemMode, Gift, GiftSource — ma jawne przypisanie: Party / Role /
  Relationship / ContactMechanism / poza-zakresem-Party).
- Sprawdzić spójność z `docs/system-wypozyczalni-inventory-accounting.md` (czy proponowana
  integracja nie narusza zasady "Reservation zawsze pierwszy krok, CirculationTransaction
  dopiero przy fulfilled").

---

## 5. Gathering Strategy

### Instances: 3 (max 8)

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase | `pages/*.tsx` — modele danych (Family, Group, Term, Item, ItemMode, Gift, GiftSource), akcje (`toggleBringClaim`, `toggleNeededItem`, `addGroup`/`addTerm`), oraz `pages/SPEC.md` jako kontekst istniejącej analizy | Glob, Grep, Read | codebase |
| 2 | inventory-model | Pełna re-analiza `docs/system-wypozyczalni-inventory-accounting.md` — model `User`/`Inventory`/`InventoryItem`/`InventoryBalance`/`Reservation`/`CirculationTransaction`, cykl życia Reservation (pending→fulfilled), model punktowy jako dany kontekst (bez przeprojektowania) | Read, Grep | inventory-model |
| 3 | archetype-methodology | Metodologia `party-archetype-mapper` (Fit Test, Mapping Workflow, Output Format, Common Patterns & Pitfalls, Quality Checks, Example) — jak poprawnie ustrukturyzować Party/RoleType/Relationship/ContactMechanism i sekcje Concept Mapping / Unmapped Concepts | Read | archetype-methodology |

### Rationale
Trzy naturalnie rozłączne kategorie źródeł odpowiadają trzem wymiarom mixed research z
brief: (1) **codebase** dostarcza rzeczywiste nazwy domenowe i istniejące zachowania UI do
zmapowania — to "co jest"; (2) **inventory-model** dostarcza kontekst systemu, z którym
nowy model musi być spójny (constraint z brief) — to "z czym musi współgrać"; (3)
**archetype-methodology** dostarcza regułę mapowania i wymagany format wyjścia — to "jak
mapować". Rozdzielenie zapobiega pomieszaniu cytatów z kodu z regułami archetypu podczas
syntezy. Nie ma potrzeby osobnej kategorii "external" (brak potrzeby web research — to
domena wewnętrzna, w pełni opisana w repo) ani "configuration" (brak istotnych plików
konfiguracyjnych dla tego pytania domenowego).

---

## 6. Success Criteria

Badanie uznaje się za kompletne, gdy raport:
1. Dostarcza konkretny model Party Archetype (Party Types, Role Types z validity,
   Relationships z cardinality/directionality, Contact Mechanisms) dla
   Organizator/Grupa/Uczestnik, z jawnym mapowaniem na `Family`/`Group`/`Profile` z `pages/`.
2. Jawnie umiejscawia "prośbę o rzecz na zajęcia" i "zgłoszenie na ochotnika" w modelu oraz
   wyjaśnia relację do `Reservation` z dokumentu inventory-accounting (z uzasadnieniem, nie
   tylko stwierdzeniem).
3. Zawiera sekcję Unmapped Concepts / otwarte pytania zgodną z konwencją
   `party-archetype-mapper`.
4. Cytuje konkretne pliki i linie z `pages/` (nie ogólniki) oraz konkretne sekcje
   `docs/system-wypozyczalni-inventory-accounting.md`.
5. Nie miesza się z niepowiązanym kontekstem `.maister/docs/**` (platforma "aj").
6. Respektuje granice Excluded (brak propozycji redesignu UI, brak wyboru stacku, brak
   przeprojektowania modelu punktowego).

---

## 7. Expected Outputs

- Research report (`analysis/` lub odpowiedni katalog orkiestratora) z:
  - Sekcją Party Types / Role Types / Relationships / Contact Mechanisms.
  - Sekcją Concept Mapping (tabela: koncept z `pages/` → element Party Archetype).
  - Sekcją modelowania "prośba o rzecz" + "zgłoszenie na ochotnika" + relacja do
    `Reservation`.
  - Sekcją Unmapped Concepts / otwarte pytania.
  - Cytatami z plików źródłowych (ścieżka + linia).
- Brak: rekomendacji technologicznych, redesignu UI, zmian w modelu punktowym.
