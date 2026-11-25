# Figury i motywy wizualizacji grupy

> Wejście dla `/maister:development`. Makieta interaktywna: https://claude.ai/artifact/4BdRjqhbW6X4yTSriBNtnZ

## 1. Cel

Dziś grupa ma jedno pole `Group.layout_mode` (`CIRCLE` | `PITCH` | `TABLE`). Każdy tryb to osobny komponent, który miesza matematykę ustawienia z wyglądem. Chcemy to rozdzielić na trzy niezależne warstwy:

| Warstwa | Co to jest | Kto definiuje |
|---|---|---|
| **Figura (geometry)** | czysta funkcja `(index, total, aspect) → {x, y}`, czyli *gdzie* stoją rodziny | kod (stała lista) |
| **Motyw (theme)** | gotowy zestaw: figura + tło + element na środku + reguły | konfiguracja we frontendzie |
| **Tło (background)** | nadpisanie tła motywu: preset albo własne zdjęcie | organizator |

Organizator wybiera motyw (np. „Ognisko”). Może potem zmienić samą figurę albo samo tło. Nowy motyw to wpis w konfiguracji, bez nowego komponentu.

**Zasada nadrzędna:** każda figura musi poprawnie pomieścić **dowolną liczbę rodzin** (0–40+). Nie wprowadzamy trybów ze stałą liczbą miejsc (np. 6 pozycji siatkówki). Liczba rodzin nie blokuje żadnego wyboru, a jedynie wpływa na ocenę czytelności i na regułę „many” motywu (pkt 5.3).

## 2. Zakres

**Faza 1 (ta iteracja, wymagane):**
- 12 figur, 13 motywów, 12 presetów tła;
- nowe pola w `Group` i migracja z `layout_mode`;
- picker motyw / figura / tło dla organizatora;
- ocena czytelności;
- widok publiczny i miniatura (`CircleVisualMini`).

**Faza 2 (osobne zadanie, opisane w pkt 9):** własne zdjęcie tła (upload + moderacja).

**Poza zakresem:**
- przeciąganie rodzin ręcznie na wybrane miejsca;
- animowane motywy poza delikatnym migotaniem ognia;
- motywy tworzone przez organizatora w UI.

## 3. Stan obecny (do przebudowy)

- Backend: `GroupLayoutMode` w [src/backend/app/groups/models.py](../src/backend/app/groups/models.py) (l. 78), kolumna `Group.layout_mode` (`_enum_column`, `server_default="CIRCLE"`, migracja `0035_group_layout_mode`). Pole jest w `GroupResponse`, `UpdateGroupRequest` (opcjonalne, stosowane gdy non-null), w schemacie widoku publicznego (`groups/schemas.py` l. 404, `public_view.py`) i w `pages/schemas.py` (`organization_page.py`).
- Frontend: [GroupVisualization.tsx](../src/frontend/src/features/terms/components/visualization/GroupVisualization.tsx) przełącza `CircleLayout` / `PitchLayout` / `TableLayout`. Matematyka jest w [utils/layoutPositions.ts](../src/frontend/src/utils/layoutPositions.ts) (współrzędne w % kwadratu 0–100).
- Inne miejsca, które używają trybu: `GroupFormFields.tsx` (select trybu), `CircleVisualMini.tsx` (mapa `POSITION` i `Ground` per tryb), `TermVisualization.tsx`, `termViewModel.ts`, `AppDataContext.tsx`.
- **Zachowania, które trzeba zachować:**
  - awatar organizatora (`OrganizerAvatar`);
  - zaznaczanie rodziny (`activeFamilyId` / `onSelectFamily`);
  - markery `sharesItem` / `bringsItem` w `FamilySlot`;
  - `GhostSeat` przy 0 rodzinach;
  - napis „Nikt się jeszcze nie zapisał”;
  - `ExchangeLegend`;
  - deterministyczne tasowanie kolejności z seedem `groupId` (`getStableSlotOrder`). Po zmianie stosujemy je do wszystkich figur poza okręgiem, tak jak dziś dla PITCH/TABLE.

## 4. Model danych

### 4.1 Nowe kolumny `groups`

| Kolumna | Typ | Null | Default | Opis |
|---|---|---|---|---|
| `layout_geometry` | `GroupLayoutGeometry` (StrEnum, `_enum_column`, len 12) | nie | `CIRCLE` | figura faktycznie renderowana |
| `layout_theme` | `String(32)` | tak | `NULL` | klucz motywu z rejestru frontendu (np. `campfire`); `NULL` = „Bez motywu” |
| `layout_background` | `String(64)` | tak | `NULL` | nadpisanie tła: `preset:<key>` (faza 1) albo `custom` (faza 2); `NULL` = tło z motywu |

`GroupLayoutGeometry`: `CIRCLE, RINGS, ELLIPSE, ROWS, GRID, HEX, SCATTER, ARCS, SPIRAL, SNAKE, LANES, DESKS`.

**Dlaczego `layout_theme` to string, a nie enum:** motywy są konfiguracją frontendu i będą dochodzić często. Backend waliduje je regexem `^[a-z][a-z0-9_]{1,31}$`, a nie listą. Nieznany klucz frontend traktuje jak „Bez motywu”, z zachowaniem `layout_geometry`. Tak samo jest z kluczem presetu w `layout_background`: regex `^(preset:[a-z][a-z0-9_]{1,31}|custom)$`.

**Zapisujemy efektywną figurę, a nie tylko motyw.** Reguła „many” (pkt 5.3) działa we frontendzie w czasie renderu. `layout_geometry` przechowuje figurę wybraną jawnie albo domyślną figurę motywu. Do tego potrzebna jest flaga, czy figura została nadpisana:

| Kolumna | Typ | Null | Default |
|---|---|---|---|
| `layout_geometry_overridden` | `Boolean` | nie | `false` |

Gdy `false`, frontend liczy figurę z motywu i reguły „many”. Gdy `true`, używa `layout_geometry` bez zmian.

### 4.2 Migracja `0106_group_layout_geometry`

1. Dodać 4 kolumny (nullable / z server_default).
2. Przenieść dane z `layout_mode`:

| `layout_mode` | `layout_geometry` | `layout_theme` | `overridden` |
|---|---|---|---|
| `CIRCLE` | `CIRCLE` | `NULL` | false |
| `PITCH` | `GRID` | `pitch` | false |
| `TABLE` | `ELLIPSE` | `roundtable` | true |

   `TABLE` daje dziś owal, a motyw `roundtable` domyślnie używa okręgu, dlatego `overridden = true` zachowuje obecny wygląd.
3. Usunąć kolumnę `layout_mode` i enum `GroupLayoutMode`. Downgrade odtwarza je z mapowania odwrotnego: `ELLIPSE`→`TABLE`, `GRID`/`HEX`→`PITCH`, reszta→`CIRCLE`.

Przed wyborem wzorca sprawdzić `0035_group_layout_mode.py` i `0029` (add nullable → backfill → not null).

## 5. Frontend

### 5.1 Struktura plików

```
src/frontend/src/features/terms/components/visualization/
  geometry/
    geometries.ts        // 12 czystych funkcji + typy, bez React/DOM
    readability.ts       // ocena czytelności
  themes/
    themes.ts            // rejestr motywów
    backgrounds.ts       // rejestr presetów tła (klasy CSS / gradienty)
    Centerpiece.tsx      // ogień, stół, siatka, scena, słońce
  GroupVisualization.tsx // jeden renderer dla wszystkich figur
  FamilySlot.tsx, GhostSeat.tsx, OrganizerAvatar.tsx (bez zmian lub drobne)
```

Pliki `CircleLayout.tsx`, `PitchLayout.tsx` i `TableLayout.tsx` znikają. Ich zachowanie przejmuje jeden renderer. Funkcje z `utils/layoutPositions.ts` przenosimy do `geometries.ts`. `CircleVisualMini` korzysta z tego samego `geometries.ts`, żeby nie było drugiej kopii matematyki.

### 5.2 Kontrakt figury

```ts
type Geometry = "CIRCLE" | "RINGS" | "ELLIPSE" | "ROWS" | "GRID" | "HEX"
  | "SCATTER" | "ARCS" | "SPIRAL" | "SNAKE" | "LANES" | "DESKS";

interface GeometryResult {
  points: { x: number; y: number }[];   // w % szerokości/wysokości sceny (0–100)
  deco: Deco | null;                    // miejsce na element środkowy / dekorację
  organizer: OrganizerAnchor;           // gdzie stoi awatar organizatora
  maxSlotSize?: number;                 // limit rozmiaru awatara (np. wysokość toru)
}
type Deco =
  | { kind: "round"; cx: number; cy: number; rx: number; ry: number } // wolne pole w środku
  | { kind: "band"; x0: number; x1: number; cy: number; dy: number }   // pas między rzędami
  | { kind: "stage"; x: number; y: number; w: number; h: number }      // scena na dole
  | { kind: "path" }                                                   // linia przez punkty w kolejności
  | { kind: "lanes"; top: number; laneH: number };
  | { kind: "desks"; desks: { x: number; y: number; w: number; h: number }[]; board: { x: number; y: number; w: number; h: number } };
type OrganizerAnchor = "center" | "stage" | "head" | "badge";

function layoutGeometry(g: Geometry, total: number, aspect: number): GeometryResult;
```

**Wymagania wspólne:**
- **Deterministyczność.** Ten sam `(g, total, aspect)` zawsze daje ten sam wynik. Bez `Math.random`; `SCATTER` używa seedowanego PRNG (mulberry32, stały seed).
- **Margines.** Margines ok. 9% krótszego boku. Żaden punkt nie wychodzi poza scenę.
- **Brzegi.** `total = 0` zwraca pustą listę (ghost seats rysuje renderer), `total = 1` zwraca poprawny punkt.
- **Proporcje.** `aspect = szerokość / wysokość`. Scena ma 16:10 na desktopie i 4:5 poniżej 620 px. Wynik liczymy po zmierzeniu kontenera (`ResizeObserver`).

### 5.3 Figury

Szczegóły algorytmów są w kodzie makiety (funkcja `layout`). To jest źródło prawdy do przeniesienia.

| Figura | Algorytm | Deco | Organizator |
|---|---|---|---|
| `CIRCLE` | równe kąty od góry, r = ½ krótszego boku − margines | round | center |
| `RINGS` | ≤7 → jak CIRCLE; inaczej 37% na pierścieniu wewn. (r·0,56), reszta na zewn., przesunięcie o pół kroku | round (wewn.) | center |
| `ELLIPSE` | równe kąty, rx/ry z szerokości/wysokości | round | center |
| `ROWS` | dwa rzędy (górny ⌈n/2⌉), y = środek ± 23% H, x w 10–90% W; dolny rząd przesunięty przy nieparzystym n | band | head (lewy koniec pasa) |
| `GRID` | kolumny = round(√(n·aspect)), ostatni rząd wyśrodkowany | — | badge |
| `HEX` | jak GRID, nieparzyste rzędy przesunięte o pół komórki | — | badge |
| `SCATTER` | best-candidate Mitchella (26 prób na punkt, kara za bliskość brzegu); kolejne punkty nie zmieniają poprzednich | — | badge |
| `ARCS` | 1/2/3/4 łuki dla n ≤7/16/26/więcej, rozdział proporcjonalny do promienia (largest remainder), kąt od −160° do −20°, środek łuków na dole | stage | stage |
| `SPIRAL` | słonecznik: r = Rh + (R−Rh)·√((i+½)/n), θ = i·137,5°, rozciągnięcie w poziomie ≤1,45 | round (Rh) | center |
| `SNAKE` | serpentyna: kolumny = clamp(round(√(n·aspect·0,9)), 2, 10), co drugi rząd odwrócony | path | head (start ścieżki) |
| `LANES` | n poziomych torów, x = 14% + 60%·frac(i·0,618 + 0,12); `maxSlotSize` = 84% wysokości toru | lanes | badge |
| `DESKS` | ławki dwuosobowe przed tablicą: górne 20% H zarezerwowane na tablicę, ławek = ⌈n/2⌉, kolumny ławek = clamp(round(√(ławek·W/(H−tablica)/2)), 1, 5), ostatnia ławka może mieć 1 osobę, rzędy od tablicy w dół | desks (prostokąty ławek + tablica) | stage (przy tablicy) |

`badge` oznacza, że organizator jest pokazany jako awatar z podpisem w rogu sceny (lewy górny róg), poza siatką rodzin.

**Rozmiar awatara** jest wspólny dla wszystkich figur: `clamp(minOdległośćMiędzyPunktami × 0,82, min 8 px, max 60 px, max 17% krótszego boku, maxSlotSize)`.

**Podpisy:**
- nazwa rodziny w pigułce pod awatarem, gdy awatar ma ≥ 44 px;
- w `LANES` podpis jest obok awatara, gdy awatar ma ≥ 20 px;
- w pozostałych przypadkach tylko `title` / `aria-label`.

**Linie do organizatora** (jak dziś w CIRCLE) rysujemy tylko dla `organizer = "center"`.

### 5.4 Ocena czytelności (`readability.ts`)

Liczona dla referencyjnej sceny 800 × 500 px, dzięki czemu wynik nie zależy od ekranu:

| Rozmiar awatara | Ocena |
|---|---|
| ≥ 42 px | Swobodnie |
| ≥ 31 px | Dobrze |
| ≥ 23 px | Ciasno |
| < 23 px | Za ciasno |

Ocena pojawia się w pickerze przy każdej figurze, przy aktualnej liczbie rodzin. **Nie blokuje wyboru.**

### 5.5 Rejestr motywów (`themes.ts`)

```ts
interface Theme {
  id: string; name: string;
  geometry: Geometry;
  background: BackgroundKey;
  center: "fire" | "table" | "net" | "sun" | "stage" | "board" | null;
  many?: { over: number; geometry: Geometry }; // reguła dla dużych grup
}
```

| id | Nazwa | Figura | Tło | Środek | many |
|---|---|---|---|---|---|
| `none` (= `NULL`) | Bez motywu | CIRCLE | plain | — | — |
| `campfire` | Ognisko | CIRCLE | night | fire | >14 → RINGS |
| `roundtable` | Okrągły stół | CIRCLE | wood | table | >16 → RINGS |
| `feast` | Stół biesiadny | ROWS | wood | table | — |
| `meadow` | Łąka | SCATTER | grass | — | — |
| `pitch` | Boisko | GRID | pitch | — | — |
| `volley` | Siatkówka | ROWS | parquet | net | — |
| `hive` | Ul | HEX | honey | — | — |
| `theatre` | Teatr | ARCS | curtain | stage | — |
| `galaxy` | Galaktyka | SPIRAL | space | sun | — |
| `trip` | Wycieczka | SNAKE | sand | — | — |
| `track` | Bieżnia | LANES | tartan | — | — |
| `classroom` | Klasa | DESKS | floor | board | — |

**Efektywna figura:** `overridden ? layout_geometry : (theme.many && n > theme.many.over ? theme.many.geometry : theme.geometry)`.

**Element środkowy** zależy od typu `deco`:
- przy `round`: koło lub owal w wolnym polu (`fire`, `table`, `sun`), tylko gdy wolny promień > 14 px;
- przy `band`: `table` to długi stół, `net` to siatka, `fire` to podłużne ognisko;
- przy `stage`: scena rysowana zawsze;
- przy `desks`: ławki i tablica rysowane zawsze (to znaczenie figury); `board` daje zieloną tablicę kredową, bez motywu tablica jest neutralna;
- inne kombinacje: nic.

### 5.6 Presety tła (`backgrounds.ts`)

`plain` (Jasne), `night` (Noc), `wood` (Drewno), `grass` (Łąka), `pitch` (Murawa, z liniami boiska), `parquet` (Parkiet, z liniami boiska), `honey` (Miód), `curtain` (Kurtyna), `space` (Kosmos), `tartan` (Tartan), `sand` (Plaża), `floor` (Klasa, jasna podłoga w kratkę).

- Wszystkie tła to CSS (gradienty), bez plików graficznych. Jeśli później dojdą grafiki, trzymamy je w `public/backgrounds/<key>.webp`.
- Każdy preset ma flagę `dark`. Od niej zależy kolor linii dekoracji (ścieżka, tory).
- Pigułki z nazwami mają stałe jasne tło i ciemny tekst, czytelne na każdym tle.
- Tła sceny są treścią: **nie zmieniają się** z motywem jasnym/ciemnym aplikacji. Ramka i panel korzystają z tokenów.

### 5.7 UI wyboru (tylko aktywny organizator)

W miejscu dzisiejszego selecta trybu (`GroupFormFields`, `showLayoutMode`) pojawia się sekcja „Wygląd grupy” z podglądem na żywo:

1. **Motyw:** siatka kafelków z miniaturą tła i nazwą. Kliknięcie ustawia `layout_theme`, zeruje nadpisania (`overridden = false`, `layout_background = null`) i ustawia `layout_geometry = theme.geometry`.
2. **Figura:** chipy 12 figur, każdy z oceną czytelności. Wybranie figury innej niż figura motywu ustawia `overridden = true`, a wybranie figury motywu przywraca `false`.
3. **Tło:** chip „Z motywu” (`null`) i 12 presetów. W fazie 2 dochodzi „+ Własne zdjęcie”.
4. **Przywróć motyw:** link widoczny, gdy jest jakiekolwiek nadpisanie.
5. **Informacja pod podglądem**, gdy działa reguła many: „Motyw Ognisko powyżej 14 rodzin sam przechodzi na figurę Dwa kręgi”.

Zapis przez istniejący `PATCH /groups/{id}`. Podgląd używa liczby rodzin z najbliższego terminu, a gdy jej nie ma, liczby członków grupy.

## 6. API

`GroupResponse`, schemat widoku publicznego i `pages/schemas.py` zamiast `layout_mode` dostają:

```json
{
  "layout_geometry": "CIRCLE",
  "layout_geometry_overridden": false,
  "layout_theme": "campfire",
  "layout_background": null
}
```

`UpdateGroupRequest`: wszystkie 4 pola opcjonalne. Pomijamy je, gdy nie zostały przysłane, czyli tak jak dziś przy `layout_mode`. **Wyjątek:** `layout_theme` i `layout_background` muszą dać się wyczyścić do `null`, więc używamy `model_fields_set`, a nie „non-null”. Trzeba to uzgodnić ze wzorcem z docstringu `UpdateGroupRequest` (l. 102).

**Walidacja:**
- `layout_theme` i `layout_background` regexami z pkt 4.1;
- `layout_background = "custom"` odrzucamy (400), dopóki faza 2 nie jest wdrożona;
- uprawnienia jak dziś: zmiana tylko przez aktywnego organizatora (`authorization_matrix.py`, sprawdzić, czy nie trzeba nic dodać).

Typy w `src/frontend/src/api/groups.ts`: usunąć `GroupLayoutMode`, dodać `GroupLayoutGeometry` i 4 pola.

## 7. Widok publiczny i miniatura

- `PublicKragGrupyPage` / widok terminu renderuje dokładnie ten sam motyw, figurę i tło co widok organizatora.
- `CircleVisualMini` (karta grupy na stronie organizacji) używa `layoutGeometry()` i tła motywu w wersji uproszczonej: bez środka, bez podpisów, kropki zamiast awatarów, gdy są mniejsze niż 17 px.

## 8. Dostępność i ruch

- Awatary to przyciski z `aria-label` = nazwa rodziny (+ „organizator”). Widoczny focus.
- Scena ma `role="img"` z opisem, np. „Ognisko, 12 rodzin”. Kolejność tabulacji odpowiada kolejności rodzin.
- Animacja zmiany figury (przejście `left`/`top` ok. 450 ms) i migotanie ognia są wyłączone przy `prefers-reduced-motion`.

## 9. Faza 2: własne zdjęcie tła (osobne zadanie)

- Upload przez istniejący pipeline mediów (`media/service.py`, `storage`, renditions `w1600.webp`, moderacja `PENDING` → `APPROVED`, `MAX_UPLOAD_BYTES`).
- **Decyzja do analizy:** `Media` jest przypięte do `party_id`, a `Group.party_id` to (prawdopodobnie) strona właściciela, nie sama grupa. Opcje:
  - (a) nowy `MediaKind.GROUP_BACKGROUND` + nullable `Media.group_id`, slot = najnowszy APPROVED per grupa;
  - (b) osobna tabela `group_backgrounds`.
- `layout_background = "custom"` oznacza „użyj najnowszego APPROVED tła grupy”. Gdy zdjęcie jest PENDING albo REJECTED, frontend pokazuje tło motywu, a organizator widzi status „Czeka na akceptację”.
- Na zdjęcie zawsze nakładana jest przyciemniająca warstwa ok. 42% (czytelność awatarów), `background-size: cover`.
- Prywatność: w grupie `PRIVATE` własne tło widzą tylko członkowie. Widok publiczny i `CircleVisualMini` pokazują wtedy tło motywu.

## 10. Testy

**Backend:**
- migracja `0106` w obie strony: mapowanie z pkt 4.2 i downgrade;
- `PATCH /groups/{id}`:
  - zapis każdego pola;
  - czyszczenie `layout_theme` / `layout_background` do `null`;
  - odrzucenie złego regexu i `custom` (400);
  - brak uprawnień dla osoby, która nie jest organizatorem (403);
- odpowiedzi `GroupResponse`, widoku publicznego i strony organizacji zawierają nowe pola i nie zawierają `layout_mode`.

**Frontend (Vitest + Testing Library):**
- `geometries.test.ts`, dla każdej figury i `n ∈ {0, 1, 2, 5, 12, 25, 40}` oraz aspect ∈ {1.6, 0.8}:
  - liczba punktów = n;
  - wszystkie punkty w granicach 0–100;
  - determinizm (dwa wywołania dają równe wyniki);
  - `SCATTER`: pierwsze k punktów nie zmienia się przy n + 1;
- `readability.test.ts`: progi; `CIRCLE` przy 25 rodzinach jest gorszy niż `GRID`;
- `themes.test.ts`: reguła many (Ognisko: 14 → CIRCLE, 15 → RINGS); `overridden = true` ignoruje many; nieznany motyw daje fallback do „Bez motywu”;
- `GroupVisualization.test.tsx`:
  - poprawić istniejące testy, które dotyczą `layoutMode`;
  - renderuje n awatarów dla każdej figury;
  - `GhostSeat` przy 0 rodzinach;
  - zaznaczanie rodziny;
  - markery shares/brings;
  - organizator wg `OrganizerAnchor`;
- picker: wybór motywu zeruje nadpisania, wybór figury ustawia `overridden`, „Przywróć motyw”, payload PATCH;
- zaktualizować: `themeDefects.test.tsx`, testy `CircleVisualMini`, `GroupFormFields`, `PublicKragGrupyPage`.

## 11. Kryteria akceptacji

1. Organizator wybiera jeden z 13 motywów, a podgląd i widok grupy zmieniają się bez przeładowania. Zmiana zostaje po odświeżeniu.
2. Organizator może zmienić figurę albo tło niezależnie od motywu i przywrócić motyw jednym kliknięciem.
3. Każda z 12 figur poprawnie renderuje 0, 1, 12 i 40 rodzin: bez wychodzenia poza scenę, z ghost seats przy 0.
4. Przy każdej figurze widać ocenę czytelności dla aktualnej liczby rodzin. Żadna figura nie jest zablokowana.
5. Ognisko przy 15+ rodzinach samo pokazuje dwa kręgi, chyba że organizator jawnie wybrał figurę.
6. Istniejące grupy po migracji wyglądają tak samo jak przed nią (CIRCLE → okrąg, PITCH → boisko, TABLE → owal ze stołem).
7. Widok publiczny i miniatura na stronie organizacji pokazują ten sam motyw.
8. Uczestnik (nie organizator) nie widzi pickera i dostaje 403 przy próbie PATCH.
9. Przy `prefers-reduced-motion` nie ma animacji.
