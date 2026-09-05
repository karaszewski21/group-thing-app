# Research Sources — Party Archetype dla Organizator → Grupa → Uczestnicy

## Codebase Sources

### Key Files
- `pages/KragGrupy.tsx` — "krąg grupy" (wymiana rzeczy między rodzinami). Zawiera
  `type Family` (id, n, i, c, kids, bring, swap, mode, fresh — ~linia 147 wg
  `pages/SPEC.md`), `NEEDED_ITEMS` (linia 289), `toggleBringClaim` (linia 307), sekcję
  "Kto co przynosi" (linia ~454) — mechanizm zgłoszenia na ochotnika przy zajęciach.
- `pages/KragGrupyStart.tsx` — wariant `KragGrupy.tsx` z mniejszą listą `FAMILIES` (widok
  "na starcie" grupy); ~99% identyczny kod (wg SPEC §1 pkt 4).
- `pages/PanelOrganizatora.tsx` — panel prowadzącej. Zawiera `type ItemMode` (linia 393:
  "wypożyczę"|"oddam"|"zamienię"), `type GiftSource` (linia 429:
  "pożyczone"|"otrzymane"|"zamienione"), `toggleNeededItem` (linia 547) — mechanizm
  zgłaszania potrzeby rzeczy przez organizatora przy dodawaniu terminu; widok `spotkania`
  z CRUD grup (`addGroup`/`removeGroup`) i terminów (`addTerm`/`removeTerm`).
- `pages/PanelGoscia.tsx` — panel uczestnika/gościa, ~85% kodu współdzielonego z
  `PanelOrganizatora.tsx` (te same typy `Profile`/`Term`/`Item`/`ItemMode`/`Gift`/
  `GiftSource`); `MY_TERMS` tylko do odczytu (gość nie zarządza grupami/terminami).
- `pages/ProfilMobilny.tsx` — publiczny profil prowadzącej/grupy (statystyka "Rodziny: 32",
  sekcja "Wymiana rzeczy": Oddam/Wymienię/Wypożyczę).
- `pages/StronaGlowna.tsx` — landing page, callbacki nawigacyjne do pozostałych stron
  (drugorzędne dla modelu domenowego).
- `pages/GaleriaZdjec.tsx` — galeria zdjęć + lightbox (drugorzędne dla modelu domenowego;
  jedyny komponent w pełni kontrolowany przez propsy).

### Directories
- `pages/` — cały prototyp UI (7 komponentów `.tsx`, samodzielne, bez wspólnej warstwy
  danych/routera/backendu — wg `pages/SPEC.md` §0).

## Documentation Sources

### Project Documentation (rzeczywiste, wiążące dla tego badania)
- `pages/SPEC.md` — pełna specyfikacja 7 stron: krytyczne luki (§1), wspólne wzorce UI
  (§2, w tym "Słowniczek trybów udostępniania rzeczy" — 3 nieujednolicone słowniki),
  opis szczegółowy każdej strony (§3), mapa nawigacji (§4), rekomendacje (§5).
- `docs/system-wypozyczalni-inventory-accounting.md` — model systemu wypożyczalni:
  `User`, `Inventory`, `InventoryItem`, `InventoryBalance`, `Reservation` (§1: "koszyk" —
  zawsze pierwszy krok zmiany posiadania; status pending/confirmed/cancelled/fulfilled),
  `CirculationTransaction` (powstaje dopiero przy `fulfilled`), model punktowy (Points,
  konta 100-100/900-100) — sekcja 2 opisuje pełny przepływ Dodanie → Rezerwacja → Odbiór.

### Methodology Documentation
- `.claude/skills/party-archetype-mapper/SKILL.md` — konwencja Party Archetype:
  - `## When to Use` / `## When NOT to Use — Fit Test` (linie 13-77) — test dopasowania
    archetypu, sygnały granic (rola biznesowa vs RBAC, FK vs Relationship).
  - `## Mapping Workflow` (linia 80+) — Step 1 Party Types, Step 2 Role Types + validity,
    Step 3 Relationships + cardinality/directionality, Step 4 Contact Mechanisms.
  - `## Output Format` (linia 286) z podsekcjami `## Party Types`, `## Concept Mapping`,
    `## Unmapped Concepts`, `## Role Types`, `## Relationships`, `## Validity Rules`,
    `## Contact Mechanisms & Identifiers`, `## Implementation Notes`.
  - `## Common Patterns & Pitfalls` (linia 341), `## Quality Checks` (linia 373),
    `## Example` (linia 390) — pełny przykład referencyjnego wyjścia.

### Code Documentation
- Inline typy TypeScript w `pages/*.tsx` pełnią rolę dokumentacji modelu danych (brak
  osobnych plików typów/interfejsów — wszystko zaszyte lokalnie w komponentach).

## Configuration Sources
- Brak istotnych plików konfiguracyjnych dla tego pytania domenowego (prototyp bez
  `package.json`/build configu w `pages/` — wg `pages/SPEC.md` §0).

## External Sources
- Brak — pytanie jest w pełni domenowe/wewnętrzne, nie wymaga web research.

## Excluded Sources (jawnie odrzucone, NIE używać)
- `.maister/docs/INDEX.md`, `.maister/docs/project/**`, `.maister/docs/standards/**` —
  opisują niepowiązany projekt "aj" (platforma Python/FastAPI/SQLAlchemy microkernel),
  odrzucone jako niewiążące dla tego badania (patrz research-brief.md, sekcja Constraints
  i "Project Documentation").
