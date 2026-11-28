# Sceny grupy: szablony admina i edytor miejsc

> Wejście dla `/maister:development`.
> Makieta wyglądu scen i edytora: [docs/mockups/sceny-grupy.html](mockups/sceny-grupy.html). Rysunki i współrzędne startowych szablonów pochodzą z tej makiety. Model danych opisany niżej ma pierwszeństwo przed makietą.

## 1. Cel

Wizualizacja grupy na ekranie terminu wygląda jak prawdziwe miejsce spotkania: ognisko, boisko, klasa, salon, choinka. Sceny nie są zaszyte w kodzie:

- **Admin** tworzy i publikuje **szablony scen**: wgrywa tło i w edytorze rozstawia punkty.
- **Organizator** wybiera szablon dla swojej grupy, a potem (faza 2) może go dostosować w **tym samym edytorze** albo podłożyć własne tło.

**Scena** = tło + **układ punktów**:

| Punkt | Ile | Rola |
|---|---|---|
| **Organizator** (punkt główny) | dokładnie 1 | miejsce osoby prowadzącej |
| **Miejsca** | 1–100 | po jednej rodzinie na miejsce, w kolejności zapełniania |
| **Reszta** | dokładnie 1 | kółko „+N” z osobami, które nie zmieściły się na miejscach |

Wszystkie trzy rodzaje punktów przesuwa się przeciąganiem.

## 2. Zakres

**Faza 1, to zadanie:**
- szablony scen w bazie;
- panel admina z edytorem (tło, pola, suwaki, przeciąganie);
- seed startowych szablonów z makiety;
- wybór szablonu przez organizatora;
- renderer sceny w widoku terminu, widoku publicznym i miniaturze;
- migracja istniejących grup.

**Faza 2, osobne zadanie (pkt 10):**
- dostosowanie układu przez organizatora w tym samym edytorze, z autozapisem;
- własne tło grupy (upload z moderacją, kadrowanie, przyciemnienie);
- generator promptu do AI.

**Poza zakresem:**
- generowanie obrazów przez AI w aplikacji;
- przypisywanie konkretnej rodziny do konkretnego miejsca;
- ręczna zmiana kolejności zapełniania (kolejność = kolejność dodania punktów);
- animacje.

## 3. Stan obecny

- **Backend:** `GroupLayoutMode` (`CIRCLE` / `PITCH` / `TABLE`) i kolumna `groups.layout_mode` (`_enum_column(…, 10)`, `native_enum=False`, bez CHECK, migracja `0035`).
  - Pole jest w `GroupResponse` i `UpdateGroupRequest`. `UpdateGroupRequest` wymaga `name`, `layout_mode` / `visibility` stosuje, gdy są non-null, a resztę pól według `model_fields_set`.
  - Jest też w widoku publicznym (`groups/application/public_view.py`, `groups/schemas.py`) i w `pages/` (`organization_page.py`, `pages/schemas.py`).
- **Frontend:**
  - `features/terms/components/visualization/` (`GroupVisualization`, `CircleLayout`, `PitchLayout`, `TableLayout`, `FamilySlot`, `GhostSeat`, `OrganizerAvatar`);
  - `utils/layoutPositions.ts`;
  - `GroupFormFields.tsx` (select trybu), `CircleVisualMini.tsx`, `TermVisualization.tsx`, `termViewModel.ts` (`buildVisualizationFamilies`), `api/groups.ts`;
  - panel admina pod `src/app/admin/(shell)/` (categories, groups, photos, points…).
- **Media:**
  - `app/media/` (tabela `media` przypięta do `party_id`, sloty LOGO / AVATAR / COVER / GALLERY, moderacja PENDING → APPROVED, rendition `w1600.webp` / `w400.webp`);
  - `app/storage/` (`MAX_UPLOAD_BYTES` = 15 MB).
- **Do zachowania:**
  - `FamilySlot` z markerami „udostępnia / przynosi”;
  - `OrganizerAvatar`;
  - `GhostSeat`;
  - „Nikt się jeszcze nie zapisał”;
  - `ExchangeLegend`;
  - zaznaczanie rodziny (przewija do wpisu na liście uczestników).
- **Do usunięcia:**
  - trzy komponenty layoutów;
  - `layoutPositions.ts`;
  - `getStableSlotOrder`;
  - `GHOST_SEATS = 8`;
  - enum `GroupLayoutMode` (po migracji).

## 4. Układ punktów (wspólny format)

### 4.1 JSON

Ten sam kształt trzymamy w szablonie (faza 1) i w dostosowanym układzie grupy (faza 2):

```json
{
  "total": 30,
  "rest": 10,
  "seat_size": 4.0,
  "organizer": [80, 22],
  "rest_point": [142, 90],
  "seats": [[91.0, 85.1], [69.0, 85.1], "… razem 20"]
}
```

| Pole | Znaczenie | Zakres |
|---|---|---|
| `total` | **„Liczba osób”**, czyli przewidywana wielkość grupy, dla której projektujemy scenę | 1–100 |
| `rest` | **„Reszta”**, czyli ile z `total` nie ma własnego miejsca i trafia do punktu reszty | 0 … `total − 1` |
| `seats` | pozycje miejsc w kolejności zapełniania; **długość = `total − rest`** | 1–100 elementów |
| `seat_size` | promień awatara w jednostkach sceny | 2,0–8,0 |
| `organizer`, `rest_point`, każdy element `seats` | `[x, y]` w układzie sceny 160 × 100 | x 4–156, y 4–96, zaokrąglenie do 0,1 |

Scena ma zawsze proporcje 16:10, a punkt (0, 0) to lewy górny róg. Współrzędne nie zależą od ekranu.

Walidacja jest w Pydantic (`SceneLayout`) i obejmuje wszystkie reguły z tabeli, łącznie z warunkiem `len(seats) == total − rest`. Odpowiedzi 400 są po polsku.

### 4.2 Jak układ działa przy wyświetlaniu

`S = len(seats)`, `n` = liczba zapisanych rodzin:
- **`n ≤ S`:** rodziny siadają na `seats[0…n−1]`, pozostałe miejsca to puste kółka (`GhostSeat`), a punkt reszty jest ukryty.
- **`n > S`:** wszystkie `S` miejsc jest zajętych, a punkt reszty pokazuje **„+(n − S)”**. Liczba wynika z faktycznie zapisanych osób, więc może być większa niż `rest`.
- **Kolejność pierwszeństwa** (czysta funkcja, `sceneLayout.ts::seatFamilies`):
  1. rodzina oglądającego;
  2. rodziny z `sharesItem || bringsItem`;
  3. reszta w kolejności zapisu.

  Pole `isViewer` dochodzi do `VisualizationFamily`. Źródło id party oglądającego trzeba ustalić w analizie, bo `buildVisualizationFamilies` dostaje dziś tylko `PublicCircleResponse`.
- **Punkt reszty** to `<button aria-label="Pokaż N kolejnych osób">`, który wywołuje `onShowAll()`. `TermVisualization` przewija wtedy do listy uczestników i ustawia na niej focus.

## 5. Edytor sceny (wspólny komponent)

`features/scenes/SceneEditor.tsx` z propsami `value: SceneLayout`, `onChange`, `background` i `mode: "admin" | "organizer"`. Ten sam komponent działa w panelu admina (faza 1) i u organizatora (faza 2).

### 5.1 Pola i suwaki

| Kontrolka | Działanie |
|---|---|
| **Liczba osób** (pole, 1–100) | Zwiększenie podnosi `rest`, a miejsca się nie zmieniają. Zmniejszenie najpierw obniża `rest`; gdy `rest = 0`, usuwa miejsca od końca. |
| **Reszta** (pole, 0 … liczba osób − 1) | Ustawia podział wprost; miejsca dodają się lub usuwają jak przy suwaku 2. |
| **Suwak 1, „Rozmiar awatarów”** (2,0–8,0) | Zmienia `seat_size`. Pozycje się nie zmieniają. |
| **Suwak 2, „Miejsca ↔ reszta”** (0 … liczba osób − 1, w prawo = więcej miejsc) | Każdy krok w prawo dodaje jedno miejsce (`rest − 1`), w lewo usuwa ostatnie miejsce (`rest + 1`). `total` się nie zmienia. |

Pola i suwak 2 to dwa widoki tej samej wartości i są zawsze zsynchronizowane. Pod nimi jest podsumowanie: „20 miejsc na scenie + reszta 10 = 30 osób”.

**Gdzie trafia nowe miejsce:** w punkt siatki co 8 jednostek najbardziej oddalony od wszystkich istniejących punktów (miejsc, organizatora i reszty). Algorytm jest w makiecie, `addSlot`.

### 5.2 Przeciąganie

- Wszystkie punkty (organizator ★, miejsca z numerem kolejności i reszta „+”) są uchwytami.
- Przeciąganie myszą i dotykiem: pointer events, `setPointerCapture` na kontenerze, `touch-action: none`. Pozycje są ograniczone do zakresów z pkt 4.1.
- **Klawiatura:**
  - Tab do uchwytu, Enter / Spacja zaznacza;
  - strzałki przesuwają o 1, z Shift o 5;
  - Delete / Backspace usuwa zaznaczone miejsce (to samo co krok suwaka 2 w lewo, ale dla wybranego miejsca). Organizatora i reszty nie da się usunąć.
- **Ostrzeżenie** inline, gdy dwa punkty są bliżej niż `1,9 × seat_size`, np. „Nachodzą na siebie: 3 i 7”.
- **Podgląd** na żywo przełącza między trybem edycji (uchwyty) a podglądem z `total` przykładowymi rodzinami (awatary, „+rest”).

### 5.3 Tło w edytorze

Tło jest skalowane jak `cover` do 160 × 100 i mnożone przez `zoom`:
- `scale = max(160/w, 100/h) · zoom`;
- `x = 80 − w·scale/2 + fit.x · (w·scale − 160)/2`, analogicznie y.

Kadrowanie (`background_fit = {zoom 1–2,5, x −1…1, y −1…1}`) ustawia się przeciąganiem tła i suwakami „Powiększenie / Poziomo / Pionowo”. Formuła jest w makiecie, `imageBox`.

### 5.4 Zapis

Każda zmiana zapisuje się sama (hook `useSceneAutosave`), w obu trybach:

| Akcja | Moment zapisu |
|---|---|
| przeciągnięcie punktu lub tła | po puszczeniu (`pointerup`), nigdy w trakcie ruchu |
| strzałki, suwaki, pola liczbowe | 600 ms po ostatniej zmianie (debounce) |
| dodanie lub usunięcie miejsca przyciskiem / Delete, „Przywróć” | od razu |

- **Kolejka:** najwyżej jedno zapytanie naraz; nowsze zmiany nadpisują oczekujące (*latest wins*). UI zmienia się od razu (optymistycznie).
- **Status** (`aria-live`):
  - „Zapisywanie…”, potem „Zapisano”;
  - przy błędzie „Nie udało się zapisać” + „Ponów”, bez utraty lokalnego stanu;
  - przy 409 „Ktoś inny zmienił tę scenę” + „Odśwież”.
- **Wersjonowanie:** każdy zapis wysyła `expected_updated_at`, a odpowiedź zwraca nowe `updated_at` do następnego zapisu.
- **„Cofnij”** i Ctrl+Z działają dla 20 ostatnich zmian w sesji. Cofnięcie też się zapisuje.
- **`useNavigationGuard`** pyta przy wyjściu tylko wtedy, gdy zapis trwa albo się nie udał.

## 6. Szablony scen (faza 1)

### 6.1 Tabela `scene_templates`

| Kolumna | Typ | Null | Opis |
|---|---|---|---|
| `id`, `created_at`, `updated_at` | `BaseEntity` | | `updated_at` = wersja do 409 |
| `key` | `String(40)`, unikalny | nie | stały slug, np. `campfire`; używany przez seed i migrację grup |
| `name` | `String(80)` | nie | „Ognisko” |
| `category` | `SceneCategory` (StrEnum, `_enum_column`) | nie | `BASIC`, `SPORT`, `PARTY`, `SCHOOL`, `PUBLIC`, `HOLIDAYS`, `TRIP` |
| `organizer_role` | `String(40)` | tak | podpis organizatora: „trener”, „gwiazda na czubku”… |
| `layout` | `JSONB` | nie | format z pkt 4.1 |
| `background_static` | `String(120)` | tak | ścieżka statycznego pliku frontendu, np. `/scenes/campfire.svg` (seed) |
| `background_media_key` | `String(255)` | tak | klucz pliku w storage (tło wgrane przez admina) |
| `background_fit` | `JSONB` | tak | kadrowanie (pkt 5.3) |
| `dark` | `Boolean` | nie | ciemne tło, czyli jasne obrysy pustych miejsc |
| `is_published` | `Boolean` | nie | widoczny dla organizatorów |
| `sort_order` | `SmallInteger` | nie | kolejność w kategorii |

CHECK: najwyżej jedno z `background_static` / `background_media_key`. Gdy oba są puste, tło jest neutralne.

Nazwy kategorii w UI: Podstawowe, Sport, Przyjęcia, Szkoła, Miejsca publiczne, Święta, Wyjazdy i plener.

### 6.2 Tło szablonu

- **Upload admina:** `POST /api/admin/scene-templates/{id}/background` (multipart, `MAX_UPLOAD_BYTES`).
- Plik przechodzi przez `app/storage` (`images`, rendition `w1600.webp` + `w400.webp` na miniatury). **Bez moderacji**, bo admin to zaufany autor.
- Stary plik jest usuwany przez outbox `storage.objects_delete`, tak jak przy podmianie mediów.
- **Seed** korzysta z plików SVG w `src/frontend/public/scenes/<key>.svg`. Rysunki eksportujemy z makiety (funkcje `draw`), jeden plik na scenę, viewBox 160 × 100. Dzięki temu migracja nie musi niczego wgrywać do storage.

### 6.3 Startowe szablony (seed)

Seedujemy 18 opublikowanych szablonów: 17 scen z makiety oraz neutralny **„Krąg”** (kategoria `BASIC`, bez tła) dla dzisiejszych grup `CIRCLE`.

- **Wartości układów** (punkty, organizator, kolejność) bierzemy z makiety (`LAYOUTS` + `ARTS`) w formacie z pkt 4.1, z `rest = 0` i `total = len(seats)`.
- **Punkt reszty** dla każdego szablonu ustawiamy w prawym dolnym rogu wolnej przestrzeni sceny. Konkretne pozycje ustala implementujący, sprawdzając nachodzenie (pkt 5.2).
- **Dane** leżą w `src/backend/alembic/data/scene_templates.json` (zgodnie ze standardem seedów: plik danych + README ze źródłem).

| key | Nazwa | Kategoria | Miejsc | Organizator |
|---|---|---|---|---|
| `ring` | Krąg | BASIC | 12 | — |
| `football` | Boisko piłkarskie | SPORT | 12 | trener |
| `tennis` | Kort tenisowy | SPORT | 12 | sędzia |
| `volleyball` | Siatkówka | SPORT | 12 | sędzia |
| `basketball` | Koszykówka | SPORT | 12 | trener |
| `pool` | Basen | SPORT | 12 | ratownik |
| `round_table` | Stół okrągły | PARTY | 12 | gospodarz |
| `feast` | Stół biesiadny | PARTY | 17 | gospodarz |
| `living_room` | Salon | PARTY | 12 | gospodarz |
| `classroom` | Klasa | SCHOOL | 40 | nauczyciel |
| `aula` | Aula | SCHOOL | 40 | prowadzący |
| `concert` | Sala koncertowa | PUBLIC | 40 | dyrygent |
| `garden` | Ogród | PUBLIC | 12 | gospodarz |
| `campfire` | Ognisko | PUBLIC | 12 | prowadzący |
| `christmas_tree` | Choinka | HOLIDAYS | 20 | gwiazda na czubku |
| `easter` | Pisanki w koszyku | HOLIDAYS | 22 | zajączek |
| `bus` | Autobus | TRIP | 28 | przewodnik |
| `picnic` | Piknik | TRIP | 16 | gospodarz |

### 6.4 Edycja szablonu a grupy

Grupa wskazuje szablon (`groups.scene_template_id`). Dopóki organizator nie dostosuje układu (faza 2), **grupa zawsze pokazuje aktualną wersję szablonu**. Zmiana szablonu przez admina od razu zmienia wszystkie takie grupy, o czym edytor admina informuje: „Ten szablon ma N grup”.

Szablonu nie usuwamy, tylko go odpublikowujemy (`is_published = false`):
- znika z pickera;
- grupy, które go używają, dalej go pokazują;
- FK `RESTRICT`, w fazie 1 bez endpointu DELETE.

### 6.5 Panel admina

- Trasy `src/app/admin/(shell)/scenes/` (lista) i `scenes/[id]/` (edycja), w nawigacji „Scenes”.
- **Lista:** szablony pogrupowane w kategorie, z miniaturą, liczbą miejsc, liczbą grup i stanem „Opublikowany / Szkic”. Przycisk „Nowy szablon” tworzy szkic z 12 miejscami w kręgu.
- **Edycja:**
  - nazwa, kategoria, rola organizatora, `sort_order`, przełącznik „Opublikowany”, „Ciemne tło”;
  - upload tła;
  - `SceneEditor` w trybie `admin`.
- Metadane zapisują się tym samym autozapisem co układ.

## 7. Grupa (faza 1)

### 7.1 Dane i migracje

- **`0113_scene_templates` (schemat):** tabela `scene_templates` + nullable `groups.scene_template_id` (FK `fk_groups_scene_template_id_scene_templates`, `RESTRICT`).
- **`0114_seed_scene_templates` (dane):**
  - wstawia 18 szablonów z `scene_templates.json` (walidacja całości przed insertem);
  - mapuje grupy: `CIRCLE` → `ring`, `PITCH` → `football`, `TABLE` → `round_table`.
  - Downgrade: `UPDATE groups SET scene_template_id = NULL`, a potem `DELETE` seedów po `key`.
- **`0115_drop_group_layout_mode` (schemat):**
  - `scene_template_id` staje się NOT NULL z domyślnym szablonem ustawianym w kodzie przy tworzeniu grupy (`ring`);
  - usuwa `layout_mode`.
  - Downgrade odtwarza `layout_mode`: `football` → `PITCH`, `round_table` → `TABLE`, reszta → `CIRCLE`.

  Wszystkie trzy migracje mają test downgrade → upgrade head. W `CHANGELOG.md` trzeba odnotować, że grupy `CIRCLE` mają po zmianie organizatora u góry kręgu, a nie na środku.

### 7.2 API

| Metoda | Ścieżka | Kto | Opis |
|---|---|---|---|
| GET | `/api/admin/scene-templates` | ADMIN | wszystkie, z `group_count` |
| POST | `/api/admin/scene-templates` | ADMIN | nowy szkic |
| GET / PUT | `/api/admin/scene-templates/{id}` | ADMIN | pełny stan (metadane + `layout` + `background_fit`) z `expected_updated_at`, 409 przy konflikcie |
| POST | `/api/admin/scene-templates/{id}/background` | ADMIN | upload tła |
| GET | `/api/public/scene-templates` | PUBLIC | opublikowane, do pickera (`id`, `key`, `name`, `category`, `layout`, `background_url`, `thumb_url`, `background_fit`, `dark`, `organizer_role`) |

- `UpdateGroupRequest` dostaje opcjonalne `scene_template_id`, stosowane gdy jest w `model_fields_set`. Musi wskazywać szablon opublikowany albo ten, który grupa już ma, w przeciwnym razie 400.
- `GroupResponse`, widok publiczny i `pages/schemas.py` dostają rozwinięty obiekt **`scene`** (układ efektywny + tło + `dark` + `organizer_role` + `template_id`), żeby widok terminu nie robił osobnego zapytania. Odczyt to jeden batched lookup szablonów po id (bez N+1).
- **Macierz uprawnień:** nowe wiersze dla `/api/admin/scene-templates*` (ADMIN) i `/api/public/scene-templates` (PUBLIC), zgodnie z kolejnością first-match-wins.

### 7.3 Picker organizatora

W `GroupFormFields` w miejsce selecta trybu pojawia się sekcja „Wygląd grupy”:
- kafelki opublikowanych szablonów w kategoriach, każdy z miniaturą (`thumb_url`), nazwą i podpisem „12 miejsc”;
- podgląd na żywo z liczbą rodzin z najbliższego terminu.

Wybór zapisuje `scene_template_id`.

### 7.4 Renderer

`features/scenes/SceneView.tsx` rysuje kolejno:
1. tło (`<img>` / SVG z kadrowaniem albo neutralne `#EEE8DC`);
2. `GhostSeat`;
3. `FamilySlot`;
4. punkt reszty;
5. `OrganizerAvatar` z `title` = rola.

Pozycjonowanie jest procentowe (`left = x/160`, `top = y/100`), średnica = `2·seat_size/160` szerokości kontenera, a kontener ma `aspect-ratio: 16/10`.

`GroupVisualization` zostaje kontenerem (scena + legenda + pusty stan). `CircleVisualMini` używa tego samego `SceneView` w trybie miniatury: kropki, bez reszty, bez interakcji.

## 8. Dostępność

- Uchwyty edytora, miejsca z rodzinami i punkt reszty są fokusowalne i mają `aria-label`. Kolejność tabulacji odpowiada kolejności miejsc.
- Suwaki i pola mają widoczne etykiety. Podsumowanie „20 miejsc + reszta 10” jest w `aria-live`.
- Edytor jest w pełni obsługiwany z klawiatury (pkt 5.2).

## 9. Testy (faza 1)

**Backend:**
- `SceneLayout`:
  - granice `total` (0 / 1 / 100 / 101) i `rest`;
  - `len(seats) != total − rest` → 400;
  - współrzędne poza zakresem;
  - `seat_size` poza zakresem;
- migracje 0113–0115: mapowanie grup w obie strony, seed waliduje plik w całości;
- admin API:
  - CRUD bez DELETE;
  - 409 przy nieaktualnym `expected_updated_at`;
  - nowe `updated_at` w odpowiedzi;
  - upload tła usuwa stary plik przez outbox;
  - nie-admin → 403;
- `PATCH /groups/{id}`:
  - opublikowany szablon OK;
  - nieopublikowany, który nie jest bieżący → 400;
  - nie-organizator → 403;
- odpowiedzi grupy i widoku publicznego zawierają `scene` (dokładne zestawy kluczy);
- `count_queries` nie rośnie z liczbą grup na liście.

**Frontend (Vitest):**
- `sceneLayout.test.ts`:
  - `seatFamilies` (pierwszeństwo, `n ≤ S`, `n > S` → „+(n−S)”);
  - zmiana `total` w górę i w dół;
  - suwak 2 (dodaj / usuń, `total` stałe);
  - wybór punktu dla nowego miejsca;
  - wykrywanie nachodzenia;
  - funkcja kadrowania;
- `SceneEditor.test.tsx`:
  - pola i suwak 2 są zsynchronizowane;
  - Delete usuwa zaznaczone miejsce;
  - strzałki przesuwają;
  - organizatora i reszty nie da się usunąć;
  - „Cofnij”;
- `useSceneAutosave.test.ts`:
  - jeden zapis na przeciągnięcie;
  - debounce suwaków i strzałek;
  - *latest wins*;
  - „Ponów” po błędzie;
  - „Odśwież” po 409;
- `SceneView.test.tsx`: ghost seats, „+N”, `onShowAll`, neutralne tło bez pliku, rola organizatora;
- testy stron admina (lista, edycja) i pickera;
- do aktualizacji: `GroupVisualization.test.tsx`, `themeDefects.test.tsx`, `CircleVisualMini`, `GroupFormFields`, `PublicKragGrupyPage`.

## 10. Faza 2: dostosowanie przez organizatora i własne tło

### 10.1 Dane (`0116_group_custom_scene`)

| Kolumna `groups` | Typ | Opis |
|---|---|---|
| `custom_layout` | `JSONB` null | dostosowany układ (format z pkt 4.1); `NULL` = układ z szablonu |
| `custom_background` | `Boolean` | używa własnego tła grupy |
| `custom_background_fit` | `JSONB` null | kadrowanie własnego tła |
| `custom_background_dim` | `SmallInteger` null | przyciemnienie 0–60 %, domyślnie 30 |

**Media własnego tła** (do decyzji w analizie, bo `Media` jest przypięte do `party_id`, a grupa ma `party_id` właściciela):
- (a) `MediaKind.GROUP_BACKGROUND` + nullable `Media.group_id`, slot = najnowszy APPROVED per grupa;
- (b) osobna tabela.

Moderacja jest jak dla zdjęć profilu (PENDING → APPROVED). W stanie PENDING / REJECTED grupa pokazuje tło szablonu, a organizator widzi status. W grupie PRIVATE własne tło widzą tylko członkowie, a widok publiczny pokazuje tło szablonu.

### 10.2 Zachowanie

- **„Dostosuj”** otwiera `SceneEditor` w trybie `organizer` na kopii układu szablonu. Pierwsza zmiana zapisuje `custom_layout` (*copy-on-write*). Od tej chwili zmiany szablonu przez admina nie dotyczą tej grupy, a picker pokazuje „Dostosowano”.
- **„Przywróć szablon”** ustawia `custom_layout = null`, więc grupa wraca do aktualnej wersji szablonu.
- **Zmiana szablonu** w pickerze przy dostosowanym układzie wymaga potwierdzenia przez `ConfirmDeleteDialog`: „Twoje ustawienie miejsc zostanie zastąpione”.
- **Przyciemnienie** to warstwa `rgba(10,20,15, dim/100)` nad własnym tłem i jasna podkładka pod każdym miejscem (`seat_size × 1,32`, biel 32 %).
- **Autozapis** jak w pkt 5.4, przez `PUT /api/groups/{id}/scene` (pełny stan: `custom_layout`, `custom_background*`, `expected_updated_at`; tylko aktywny organizator).

  Osobny endpoint jest potrzebny, bo `UpdateGroupRequest` wymaga `name`. Nowy wiersz trafia do macierzy uprawnień. `DELETE /api/groups/{id}/scene/custom` = „Przywróć szablon”.
- **Prompt do AI:**
  - pole „Opisz tło” i styl (płaska ilustracja / akwarela / zdjęcie / książka dla dzieci);
  - aplikacja dokleja „Widok z góry, kadr 16:10”, ogólną wskazówkę „wolne, spokojne miejsca tam, gdzie stoją punkty” oraz stałe zakazy (ludzie, napisy, logotypy);
  - przycisk „Kopiuj prompt” (`navigator.clipboard` z fallbackiem zaznaczenia).

### 10.3 Testy fazy 2

- **Backend:**
  - `PUT /scene` (walidacja, 409, 403);
  - copy-on-write: zmiana szablonu nie rusza grupy z `custom_layout`;
  - `DELETE /scene/custom`;
  - stany moderacji;
  - prywatność tła.
- **Frontend:**
  - przejścia szablon ↔ dostosowany;
  - potwierdzenie przy zmianie szablonu;
  - prompt.

## 11. Kryteria akceptacji

**Faza 1:**
1. Admin tworzy szablon: wgrywa tło, ustawia liczbę osób i resztę, rozmiar awatarów, przeciąga organizatora, miejsca i punkt reszty, a potem publikuje. Każda zmiana zapisuje się sama i jest widoczna po odświeżeniu.
2. Suwak 2 dokłada (w prawo) i odejmuje (w lewo) miejsca bez zmiany liczby osób. Pola i suwak zawsze pokazują ten sam podział.
3. Organizator wybiera opublikowany szablon. Widok terminu, widok publiczny i miniatura pokazują tę samą scenę.
4. Przy 0 rodzinach widać same puste miejsca. Przy `n ≤ S` widać zajęte i puste miejsca, przy `n > S` wszystkie miejsca są zajęte, a punkt reszty pokazuje „+(n − S)” i przewija do listy uczestników.
5. Rodzina oglądającego zawsze jest na scenie. Rodziny z markerami mają pierwszeństwo.
6. Zmiana opublikowanego szablonu przez admina od razu zmienia wygląd grup, które go używają (w fazie 1 wszystkich).
7. Istniejące grupy po migracji: `CIRCLE` → Krąg, `PITCH` → Boisko piłkarskie, `TABLE` → Stół okrągły.
8. Nie-admin nie ma dostępu do panelu scen (403). Uczestnik nie widzi pickera i dostaje 403 przy PATCH.
9. Edytor działa myszą, dotykiem i klawiaturą. Przy błędzie zapisu pokazuje „Ponów” bez utraty zmian, a przy konflikcie „Odśwież”.

**Faza 2:**

10. Organizator dostosowuje układ w tym samym edytorze. Od tej chwili zmiany szablonu go nie dotyczą, a „Przywróć szablon” wraca do szablonu.
11. Organizator wgrywa własne tło, kadruje je i ustawia przyciemnienie. Członkowie widzą je po akceptacji moderacji.
12. Prompt do AI kopiuje się jednym kliknięciem.
