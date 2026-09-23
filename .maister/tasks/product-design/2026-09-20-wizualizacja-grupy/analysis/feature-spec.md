## Sekcja 1: Model danych

### Nowe pole: `Group.layout_mode`

Jedyna zmiana schematu w tym zadaniu — nowe pole na istniejącym modelu `Group` (`src/backend/app/groups/models.py`).

```python
class GroupLayoutMode(str, Enum):
    CIRCLE = "CIRCLE"
    PITCH = "PITCH"
    TABLE = "TABLE"

class Group(BaseEntity):
    ...
    layout_mode: Mapped[GroupLayoutMode] = mapped_column(
        String, nullable=False, default=GroupLayoutMode.CIRCLE, server_default="CIRCLE"
    )
```

- String-backed enum (zgodnie ze standardem `standards/backend/models.md` — nigdy ordinal).
- `server_default="CIRCLE"` — istniejące grupy w bazie dostają wartość domyślną bez migracji danych, tylko migracja schematu (Alembic `add_column` z `server_default`, potem opcjonalnie `alter_column` usuwający `server_default` jeśli konwencja projektu tego wymaga — do potwierdzenia z istniejącymi migracjami `Group`).
- Ekspozycja w `GroupResponse` (schemas.py): dodać pole `layout_mode: GroupLayoutMode`.
- Aktualizacja przez istniejący `PATCH /groups/{id}` — rozszerzyć `UpdateGroupRequest`/analogiczny schemat o opcjonalne pole `layout_mode`, obsłużone w `service.update_group` (ten sam kod ścieżki co dzisiejsza zmiana nazwy grupy, ten sam check aktywnego organizatora).

### Brak innych zmian schematu

Żadne z: `Pledge`, `ItemListingPreference`, `Family`, `FamilyMembership`, `InventoryItem` nie wymaga zmian kolumn — cała reszta funkcji to odczyt i agregacja istniejących danych (patrz Sekcja 2).

### Nowe DTO (Pydantic schemas, `app/groups/schemas.py`)

```python
class FamilyExchangeSummary(BaseModel):
    family_id: str
    shares_item: bool   # ma aktywną ItemListingPreference widoczną na bieżący Term
    brings_item: bool   # ma aktywny Pledge (status CLAIMED) na bieżący Term

class GroupExchangeSummaryResponse(BaseModel):
    group_id: str
    term_id: str | None   # None jeśli brak nadchodzącego terminu
    families: list[FamilyExchangeSummary]

class FamilyExchangeOffer(BaseModel):
    listing_id: str
    item_id: str
    product_name: str
    condition: str
    offered_types: list[str]   # LEND / SWAP / GIFT
    lister_party_id: str
    lister_display_name: str

class FamilyExchangeDetailResponse(BaseModel):
    family_id: str
    offers: list[FamilyExchangeOffer]
```

`offered_types`/`product_name`/`condition` pola 1:1 z istniejącym `BrowseTermItemListingResponse` (`term_item_listings.py`) — reużycie kształtu, nie wynajdywanie nowego.

---

## Sekcja 2: Endpointy backendowe

### 2.1. `GET /api/groups/{group_id}/exchange-summary` → `GroupExchangeSummaryResponse`

Zwraca flagi `shares_item`/`brings_item` dla **wszystkich** rodzin grupy w jednym zapytaniu — wywoływany przez frontend raz, przy każdym załadowaniu ekranu wizualizacji.

**Implementacja** (`app/groups/application/exchange_summary.py`, nowy moduł, wołany z `service.py`):
1. Ustal bieżący/najbliższy `Term` dla grupy (reużyć logikę z `application/term_item_listings.py` — ten sam sposób wyboru "aktualnego" terminu co dziś w `useKragGrupy`/backend).
2. Pobierz wszystkie `Membership` dla grupy → zgrupuj po `family_id` (reużyć `resolveFamiliesForMemberships`-równoważną logikę backendową, albo dodać jej odpowiednik w `groups/application/`, jeśli dziś istnieje tylko po stronie frontu — **do zweryfikowania podczas implementacji**: jeśli logika grupowania po rodzinie istnieje już tylko w `useKragGrupy.ts`, backend potrzebuje własnej wersji tego joina).
3. Dla każdej rodziny: zbierz `party_id` wszystkich jej opiekunów (`FamilyMembership` z rolą `GUARDIAN`).
4. `brings_item = True` jeśli którykolwiek `party_id` ma `Pledge` ze statusem `CLAIMED` na `NeededItem` należący do bieżącego `Term`.
5. `shares_item = True` jeśli którykolwiek `party_id` ma `ItemListingPreference` widoczną na bieżący `Term` (reużyć warunek widoczności z `term_item_listings.py`) i nieprzypisaną jeszcze do zrealizowanej `Reservation` (status `FULFILLED`/`CANCELLED` się nie liczy — reużyć definicję "aktywna" z `list_browsable_term_item_listings`).
6. Zwróć listę `FamilyExchangeSummary` w kolejności zgodnej z dzisiejszym porządkiem `families` (ten sam porządek, którego używa `pos(i)` dziś — ważne dla Sekcji 7, stabilnego przypisania slotów).

**Autoryzacja**: nowy wiersz w `AUTHORIZATION_MATRIX`, wzorem wierszy 55-58: `GET /api/groups/[^/]+/exchange-summary` → `READ`, umieszczony PRZED blankietowym wierszem 26 (kolejność nie zmienia efektywnego uprawnienia, bo oba dają READ, ale zachowuje czytelność matrycy per zasób). Dodatkowy check w `service.py`: wołający musi być `Membership` (dowolna rola) lub aktywnym `Leadership` tej grupy — **nowa reguła ownership**, bo dziś blankietowy READ nie wymusza członkostwa. Brak członkostwa → `403`.

### 2.2. `GET /api/groups/{group_id}/families/{family_id}/exchange-offers` → `FamilyExchangeDetailResponse`

Zwraca pełną listę aktywnych ofert JEDNEJ rodziny — wywoływany leniwie po kliknięciu jej avatara.

**Implementacja**:
1. Zweryfikuj że `family_id` należy do `group_id` (rodzina ma aktywny `Membership` w tej grupie) — 404 jeśli nie.
2. Zbierz `party_id` wszystkich opiekunów rodziny.
3. Zwróć wszystkie ich `ItemListingPreference`/powiązane `InventoryItem` uznane za "aktywne" (ta sama definicja co w kroku 5 powyżej — reużyć wspólny helper, nie duplikować warunku).
4. Mapuj na `FamilyExchangeOffer` (pola jak `BrowseTermItemListingResponse`).

**Autoryzacja**: nowy wiersz analogiczny do 2.1 (`GET /api/groups/[^/]+/families/[^/]+/exchange-offers` → `READ` + membership check w service.py).

### 2.3. Rozszerzenie `PATCH /groups/{id}`

Istniejący endpoint (`router/circles.py`) — dodać opcjonalne pole `layout_mode` do request body. Walidacja: musi być jedną z wartości `GroupLayoutMode`. Ten sam check aktywnego organizatora co dziś (bez zmian w autoryzacji — endpoint już wymaga `EDIT` + ownership).

### Wspólny helper (unika duplikacji reguły "aktywna oferta"/"aktywny pledge")

```python
# app/groups/application/exchange_helpers.py
def get_active_pledges_for_parties(party_ids: list[str], term_id: str) -> set[str]: ...
def get_active_listings_for_parties(party_ids: list[str], term_id: str) -> list[ItemListingPreference]: ...
```

Wywoływane zarówno przez endpoint 2.1 (dla każdej rodziny, batchowo — jedno zapytanie SQL z `IN (...)`, nie N zapytań per rodzina), jak i 2.2 (dla jednej rodziny). Implementacja musi unikać N+1: jedno zapytanie po wszystkie `party_id` na raz w 2.1, filtrowanie w pamięci per rodzina.

---

## Sekcja 3: Warstwa danych frontendu

### 3.1. Nowe funkcje API client (`src/frontend/src/api/groups.ts`)

```typescript
export interface FamilyExchangeSummary {
  familyId: string;
  sharesItem: boolean;
  bringsItem: boolean;
}
export interface GroupExchangeSummaryResponse {
  groupId: string;
  termId: string | null;
  families: FamilyExchangeSummary[];
}
export function getGroupExchangeSummary(groupId: string): Promise<GroupExchangeSummaryResponse> {
  return api.get(`/groups/${groupId}/exchange-summary`);
}

export interface FamilyExchangeOffer {
  listingId: string;
  itemId: string;
  productName: string;
  condition: string;
  offeredTypes: string[];
  listerPartyId: string;
  listerDisplayName: string;
}
export interface FamilyExchangeDetailResponse {
  familyId: string;
  offers: FamilyExchangeOffer[];
}
export function getFamilyExchangeOffers(groupId: string, familyId: string): Promise<FamilyExchangeDetailResponse> {
  return api.get(`/groups/${groupId}/families/${familyId}/exchange-offers`);
}

export function updateGroupLayoutMode(groupId: string, layoutMode: "CIRCLE" | "PITCH" | "TABLE"): Promise<GroupResponse> {
  return api.patch(`/groups/${groupId}`, { layoutMode });
}
```

Konwencja JSDoc + typ zwracany zgodnie z istniejącymi funkcjami w tym pliku (patrz `getGroup`, `getCurrentLeadership`).

### 3.2. Rozszerzenie `useKragGrupy.ts`

- Dodać do `Promise.all` wywołanie `getGroupExchangeSummary(groupId)` — pobierane raz, przy tym samym mount co reszta danych.
- Wzbogacić istniejący typ `KragFamily` o pola `sharesItem: boolean`, `bringsItem: boolean`, uzupełniane przez zmapowanie wyniku `getGroupExchangeSummary` po `familyId` (fallback `false`/`false` jeśli endpoint się nie powiódł — nie blokować renderowania reszty ekranu przy błędzie tego jednego wywołania; patrz Sekcja 8: obsługa błędów).
- Dodać nowy stan/akcję: `activeFamilyExchangeOffers: FamilyExchangeOffer[] | null` + `loadingExchangeOffers: boolean`, oraz funkcję `loadExchangeOffersForFamily(familyId)` wywoływaną z `KragGrupyPage.tsx` w handlerze kliknięcia avatara (nie w `Promise.all` przy mount — to jest leniwe wywołanie z Sekcji 2.2).
- Dodać `group.layoutMode: "CIRCLE"|"PITCH"|"TABLE"` do zwracanych danych (już przychodzi w `GroupResponse` po rozszerzeniu z Sekcji 1) oraz akcję `setGroupLayoutMode(mode)` wołającą `updateGroupLayoutMode` i aktualizującą lokalny stan optymistycznie (rollback przy błędzie — wzorem istniejących mutacji w tym hooku, np. `takeTermItemListing`).

### 3.3. `usePublicKragGrupy.ts`

**Bez zmian w tym zadaniu.** Zgodnie z ustaleniami z Fazy 4 (Deferred Ideas) — publiczny widok nie renderuje dziś orbitu rodzin i pozostaje poza zakresem. `layoutMode` z `PublicCircleResponse` może być zignorowany/nieużyty na razie.

---

## Sekcja 4: Architektura komponentów frontendowych

### 4.1. `src/frontend/src/components/shared/Avatar.tsx` (nowy)

Konsoliduje `panelHelpers.initials` i `KragGrupyPage.tsx`'s `familyInitials`/`familyColor`/`hashString`/`PALETTE`.

```typescript
interface AvatarProps {
  name: string;
  size?: number;        // default 52 (px), dopasowywalny per layout mode
  selected?: boolean;    // scale-up + highlight, jak dzisiejszy .kg-av.selected
  onClick?: () => void;
}
export function Avatar({ name, size = 52, selected, onClick }: AvatarProps) { ... }
```

Zawiera wewnątrz istniejący `PALETTE` (8 zielonych heksów), `hashString`, logikę 2-literowych inicjałów — przeniesione 1:1 z `KragGrupyPage.tsx`, bez zmiany kolorów/algorytmu (żeby dzisiejszy tryb koła wyglądał identycznie po refaktorze). Stylowane Tailwindem (nie kolejny inline CSS-in-JS).

### 4.2. `src/frontend/src/utils/layoutPositions.ts` (nowy)

Trzy czyste funkcje, każda `(index: number, total: number) → { left: string; top: string }` (wartości procentowe, jak dzisiejszy `pos(i)`):

```typescript
export function getCirclePosition(index: number, total: number): Position {
  // 1:1 port dzisiejszego pos(i) z KragGrupyPage.tsx — R=38, slots=total, a = (index/total)*2*PI - PI/2
}
export function getPitchPosition(index: number, total: number): Position {
  // patrz Sekcja 7 — rozkład w rzędach
}
export function getTablePosition(index: number, total: number): Position {
  // patrz Sekcja 7 — rozkład po obwodzie elipsy
}
export function getStableSlotOrder(familyIds: string[], groupId: string): string[] {
  // patrz Sekcja 7 — deterministyczne, stabilne tasowanie (seed = groupId)
}
```

Bez zależności od Reacta — łatwe do przetestowania w Vitest bez renderowania.

### 4.3. `src/frontend/src/pages/krag/GroupVisualization.tsx` (nowy)

```typescript
interface GroupVisualizationProps {
  layoutMode: "CIRCLE" | "PITCH" | "TABLE";
  organizerName: string;
  families: KragFamily[];             // już z sharesItem/bringsItem (Sekcja 3)
  activeFamilyId: string | null;
  onSelectFamily: (familyId: string) => void;
  onInviteSlotClick?: () => void;      // zachowuje dzisiejszy "+" slot (tylko tryb CIRCLE ma dziś tę funkcję — do potwierdzenia czy PITCH/TABLE też go potrzebują, patrz Sekcja 8)
}
export function GroupVisualization(props: GroupVisualizationProps) {
  const orderedFamilies = useMemo(
    () => reorderByStableSlot(props.families, props.layoutMode, groupId),
    [props.families, props.layoutMode]
  );
  switch (props.layoutMode) {
    case "CIRCLE": return <CircleLayout families={orderedFamilies} ... />;
    case "PITCH": return <PitchLayout families={orderedFamilies} ... />;
    case "TABLE": return <TableLayout families={orderedFamilies} ... />;
  }
}
```

- `CircleLayout`, `PitchLayout`, `TableLayout` — trzy małe wewnętrzne komponenty (ten sam plik lub `pages/krag/layouts/`), każdy: renderuje tło/grafikę specyficzną dla trybu (SVG linie dla koła; tło boiska + brak linii dla pitch; owal + "chipy" przedmiotów w środku dla table — patrz mockup `table.png`), umieszcza `<Avatar>` na pozycjach z `layoutPositions.ts`, renderuje ikony udostępnia/przynosi (Sekcja 5) na każdym avatarze, obsługuje `onClick` → `onSelectFamily`.
- `CircleLayout` przenosi 1:1 dzisiejszą logikę SVG-linii z `KragGrupyPage.tsx` (bez zmian wizualnych).
- `PitchLayout`/`TableLayout` — nowe, zbudowane od zera wg mockupów `boisko.png`/`table.png` (tło boiska jako CSS/SVG gradient zielony z liniami pola, jak w mockupie; tabela jako zaokrąglony owal z borderem, jak w mockupie).

### 4.4. Zmiany w `KragGrupyPage.tsx`

- Usunąć inline `pos()`, SVG-line-rendering, avatar-rendering z `PrivateKragGrupyView` — zastąpić `<GroupVisualization ... />`.
- Dodać stan `layoutMode` inicjalizowany z `group.layoutMode` (Sekcja 3), przekazywany do `GroupVisualization` i do przełącznika (Sekcja 5).
- Family card (`.kg-card`) pozostaje w tym pliku (poza zakresem ekstrakcji — patrz Deferred Ideas), ale jej zawartość rozszerzona wg Sekcji 6.
- Reszta pliku (sekcje "kto co przynosi", listy wymiany poniżej wizualizacji) — bez zmian strukturalnych.

---

## Sekcja 5: Przełącznik trybu layoutu i ikony udostępnia/przynosi

### 5.1. Przełącznik trybu (organizator only)

- Umiejscowienie: bezpośrednio nad `<GroupVisualization>` w `KragGrupyPage.tsx`, widoczny tylko gdy `isOrganizerViewer === true` (ten sam gate co dzisiejsze organizator-only elementy w tym pliku).
- UI: segmented control 3 opcji z ikonką + etykietą: "⭕ Koło", "⚽ Boisko", "🍽️ Stół" (finalne ikony do ustalenia przy implementacji — placeholder). Tailwind: pill-shaped container `rounded-full bg-paper border border-line p-1`, aktywna opcja `bg-mint text-white`, nieaktywne `text-ink-soft`.
- Zachowanie: klik → optymistyczna zmiana `layoutMode` w stanie lokalnym (natychmiastowy re-render `GroupVisualization` z nowym trybem) → wywołanie `setGroupLayoutMode` (Sekcja 3.2) → jeśli `PATCH` się nie powiedzie, rollback do poprzedniego trybu + toast błędu (wzorem istniejącego `.kg-toast`).
- Dla rodzica/opiekuna (nie-organizatora): brak kontrolki, `layoutMode` renderowany tylko do odczytu z `group.layoutMode`.

### 5.2. Ikony "udostępnia rzecz" / "przynosi na zajęcia" na avatarze

- Źródło danych: `family.sharesItem` / `family.bringsItem` (Sekcja 3.2), już obliczone przez backend (Sekcja 2.1).
- Wygląd: małe kółka-znaczniki w rogu avatara (zgodnie z mockupami — zielone kółko z ikoną wymiany dla "udostępnia", teal/turkusowe kółko z ikoną plecaka/pudełka dla "przynosi"), pozycjonowane `absolute` względem kontenera avatara (`bottom-right`/`top-right`), oba mogą być widoczne jednocześnie jeśli rodzina spełnia oba warunki.
- Renderowane wewnątrz `Avatar` komponentu jako opcjonalne propsy: `showsSharesIcon?: boolean`, `showsBringsIcon?: boolean` (Avatar pozostaje "głupim" komponentem prezentacyjnym — logika czyj to avatar i jakie ma flagi żyje w `GroupVisualization`/rodzicu).
- Legenda (jak w mockupach: "🟢 udostępnia rzecz" / "🔵 przynosi na zajęcia") renderowana raz pod `GroupVisualization`, niezależnie od trybu layoutu.
- Widoczne we wszystkich 3 trybach layoutu identycznie (ikony to właściwość avatara, nie konkretnego trybu graficznego).

### 5.3. Stan ładowania / błędu podsumowania

Jeśli `getGroupExchangeSummary` się nie powiedzie lub jeszcze się ładuje: avatary renderują się bez ikon (fallback `false`/`false`, patrz Sekcja 3.2) — brak blokującego spinnera na całej wizualizacji, tylko brak ikon do czasu odpowiedzi (miękka degradacja, zgodna z priorytetem "wizualizacja renderuje się natychmiast").

---

## Sekcja 6: Rozbudowana karta rodziny — sekcja "do wymiany w grupie"

### 6.1. Trigger i ładowanie

- Kliknięcie avatara w `GroupVisualization` → `onSelectFamily(familyId)` → `KragGrupyPage.tsx` ustawia `activeFamilyId` (bez zmian względem dziś) ORAZ wywołuje `loadExchangeOffersForFamily(familyId)` (Sekcja 3.2) — leniwe pobranie z `GET /groups/{id}/families/{familyId}/exchange-offers`.
- Podczas ładowania: karta pokazuje istniejącą treść (avatar, nazwa, opiekunowie) natychmiast, a nowa sekcja "do wymiany" renderuje krótki stan ładowania (skeleton/spinner) tylko w swoim obrębie — reszta karty nie czeka.
- Po zmianie `activeFamilyId` na inną rodzinę: poprzednie `activeFamilyExchangeOffers` czyszczone/nadpisywane nowym fetchem (bez pokazywania danych poprzednio wybranej rodziny przez moment).

### 6.2. Zawartość sekcji "DO WYMIANY W GRUPIE"

Rozszerza istniejący blok `.kg-card` (`KragGrupyPage.tsx`, ~linia 1182) o nowy podblok, stylowany Tailwindem (nowy element w pliku, który wciąż zawiera legacy CSS-in-JS — patrz ograniczenie z Sekcji 4: nowe elementy Tailwind, stare zostają jak są):

- Nagłówek sekcji: "DO WYMIANY W GRUPIE" (wielkie litery, mały font, `text-ink-soft`, zgodnie z mockupem).
- Jeśli `activeFamilyExchangeOffers` jest puste (rodzina nic nie oferuje): sekcja się nie renderuje w ogóle (brak pustego stanu/"brak ofert" — zgodnie z zasadą minimalnej implementacji, chyba że user zdecyduje inaczej przy review).
- Jeśli niepuste: lista pozycji, każda jako mini-karta (`rounded-[13px] border border-line bg-cream p-3`):
  - Nazwa przedmiotu (`productName`) pogrubiona.
  - Typ oferty jako mały tag (LEND→"Pożyczę", SWAP→"Zamienię", GIFT→"Oddam") — reużyć istniejące etykiety `TAKE_ACTION_LABELS` z `KragGrupyPage.tsx`.
  - Przycisk **"Biorę"** (`.kg-btn-primary`/Tailwind odpowiednik) — wywołuje ISTNIEJĄCY flow: `takeTermItemListing`/`proposeSwapApi` w zależności od `offeredTypes` (dokładnie ta sama logika co dzisiejsza `browseListingsSection`, tylko wywołana z karty rodziny zamiast z listy pod spodem).
  - **Brak przycisku "Napisz"** — potwierdzone w Fazie 2: ta funkcja nie istnieje w systemie i nie jest budowana w tym zadaniu (różnica względem oryginalnych mockupów, które pokazywały "Napisz" — świadomie pominięte).
- Jeśli rodzina kliknięta to rodzina **samego wyświetlającego usera** (własna rodzina): sekcja "do wymiany" się nie pokazuje (nie ma sensu "brać" własną ofertę) — analogiczne do dzisiejszego rozróżnienia `myListingsSection` vs `browseListingsSection`.

### 6.3. Reużycie logiki akcji

Wyekstrahować wspólną funkcję/hook z dzisiejszej `browseListingsSection` obsługującą klik "Biorę" (dziś prawdopodobnie inline w `KragGrupyPage.tsx`), żeby karta rodziny i istniejąca lista "Rzeczy od innych" używały tej samej funkcji zamiast duplikować wywołanie API + obsługę błędu/toastu.

---

## Sekcja 7: Algorytmy pozycjonowania (implementation-ready)

Wszystkie funkcje operują na kwadratowym viewboxie 0-100 (jak dzisiejszy `pos(i)`), zwracają `{ left: "${x}%", top: "${y}%" }".

### 7.1. `getCirclePosition(index, total)` — bez zmian względem dziś

```typescript
const R = 38;
function getCirclePosition(index: number, total: number): Position {
  const slots = total; // "+" invite slot liczony jako dodatkowy total+1 przez wywołującego, jak dziś
  const a = (index / slots) * 2 * Math.PI - Math.PI / 2;
  return { left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` };
}
```

### 7.2. `getPitchPosition(index, total)` — rozkład w rzędach

```typescript
function getPitchPosition(index: number, total: number): Position {
  const ROW_SIZE_TARGET = 3; // ile awatarów na rząd zanim zaczynamy nowy rząd
  const rows = Math.max(1, Math.ceil(total / ROW_SIZE_TARGET));
  const rowSizes = distributeEvenly(total, rows); // np. total=7,rows=3 -> [3,2,2]
  const { row, indexInRow, rowSize } = locateInRows(index, rowSizes);

  const topMargin = 15, bottomMargin = 15; // % viewboxu, zostawia miejsce na trenerkę/nagłówek nad boiskiem
  const top = rows === 1 ? 50 : topMargin + (row / (rows - 1)) * (100 - topMargin - bottomMargin);

  const sideMargin = 15;
  const left = rowSize === 1 ? 50 : sideMargin + (indexInRow / (rowSize - 1)) * (100 - 2 * sideMargin);

  return { left: `${left}%`, top: `${top}%` };
}
```

- `distributeEvenly(total, rows)`: rozdziela `total` możliwie równo na `rows` grup (różnica maks. 1 między najliczniejszym a najmniej licznym rzędem) — czysta funkcja pomocnicza, testowalna osobno.
- `locateInRows`: mapuje płaski `index` na `(row, indexInRow, rowSize tego rzędu)`.
- Rzędy ułożone od góry (bliżej prowadzącej-trenerki) do dołu (jak w mockupie boisko.png: rząd obrony bliżej bramki/góry, atak niżej — ale bez przypisywania znaczenia, czysto wizualnie górne/dolne rzędy).
- Slot "+" (zaproszenie) — dołączony jako `total+1`-ta pozycja, tak jak dziś w kole.

### 7.3. `getTablePosition(index, total)` — rozkład po obwodzie elipsy

```typescript
function getTablePosition(index: number, total: number): Position {
  const A = 42; // promień poziomy (%), owal szerszy niż wyższy — jak w mockupie table.png
  const B = 30; // promień pionowy (%)
  const theta = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { left: `${50 + A * Math.cos(theta)}%`, top: `${50 + B * Math.sin(theta)}%` };
}
```

Bezpośrednia analogia do `getCirclePosition`, tylko z niezależnymi promieniami x/y (elipsa zamiast koła) — odzwierciedla owalny stół z mockupu. Przedmioty-chipy ("Tamburyn", "2 koce" z mockupu `table.png`) pozostają poza zakresem tej funkcji (statyczna dekoracja wewnątrz owalu, nie pozycjonowane dynamicznie względem rodzin — brak wymogu w problem statement, żeby były interaktywne).

### 7.4. Stabilne tasowanie: `getStableSlotOrder(familyIds, groupId)`

```typescript
function getStableSlotOrder(familyIds: string[], groupId: string): string[] {
  const seeded = familyIds.map(id => ({ id, key: hashString(`${groupId}:${id}`) }));
  seeded.sort((a, b) => a.key - b.key);
  return seeded.map(s => s.id);
}
```

- Reużywa istniejący `hashString` (z `Avatar`/dawnego `KragGrupyPage.tsx`).
- Deterministyczne: ta sama grupa + te same rodziny → zawsze ten sam porządek, między sesjami i urządzeniami (nie localStorage — czysta funkcja od `groupId`+`familyId`, nie wymaga żadnego zapisu stanu).
- Stosowane **tylko** dla trybów `PITCH`/`TABLE` (Decyzja Obszar 4) — tryb `CIRCLE` zachowuje dzisiejszą kolejność naturalną (porządek `families` z API, bez tasowania), żeby nie zmieniać istniejącego, znanego użytkownikom układu koła.
- Gdy skład grupy się zmienia (dodanie/usunięcie rodziny) — kolejność pozostałych rodzin może się przesunąć (bo `total` w mapowaniu index→slot się zmienia), co jest akceptowalne (nie jest to "trwałe przypisanie do slotu", tylko stabilne między odświeżeniami przy tym samym składzie).

### 7.5. Testy jednostkowe (Vitest, `layoutPositions.test.ts`)

- Dla `getPitchPosition`/`getTablePosition`/`getCirclePosition`: dla N w zakresie 1-30, żadne dwie pozycje nie są bliżej niż próg minimalnego odstępu (np. sprawdzić czy min. odległość euklidesowa między parami > rozsądny próg, albo prościej: sprawdzić że wszystkie wygenerowane `{left, top}` są unikalne z tolerancją).
- Dla `getStableSlotOrder`: ta sama para (groupId, familyIds) wywołana dwukrotnie daje identyczny wynik (determinizm).

---

## Sekcja 8: Edge case'y i strategia testów

### 8.1. Edge case'y

| Sytuacja | Zachowanie |
|---|---|
| Grupa z 0 rodzin (tylko organizator) | Wszystkie 3 tryby renderują sam slot "+" (zaproszenie) + centrum/trenerkę/nagłówek — bez błędu dzielenia przez zero (`getCirclePosition`/`getPitchPosition`/`getTablePosition` muszą obsłużyć `total=0` lub wywołujący filtruje ten przypadek przed wywołaniem funkcji pozycjonującej dla samego slotu "+", który zawsze ma `total=1` gdy jest jedynym elementem). |
| Bardzo duża grupa (np. 30+ rodzin) | `PITCH`: rzędy gęstnieją, avatary się zmniejszają (akceptowalna degradacja wizualna, jak dziś w `CIRCLE` przy dużym N — nie blokująca). `TABLE`: elipsa gęstnieje analogicznie. Brak twardego limitu w tym zadaniu. |
| `GET /exchange-summary` zwraca błąd (5xx/timeout) | Wizualizacja renderuje się bez ikon (Sekcja 5.3), toast informacyjny opcjonalny (nie blokujący), reszta ekranu (kto co przynosi, listy pod spodem) działa niezależnie. |
| `GET /families/{id}/exchange-offers` zwraca błąd po kliknięciu avatara | Sekcja "do wymiany" w karcie pokazuje krótki komunikat błędu z opcją retry (mały link "spróbuj ponownie"), reszta karty (nazwa, opiekunowie) pozostaje widoczna. |
| Kliknięcie "Biorę" na ofercie, która w międzyczasie została wzięta przez kogoś innego | Reużywa istniejącą obsługę błędu z `takeTermItemListing`/`proposeSwapApi` (już obsłużone dziś w `browseListingsSection` — ten sam toast/komunikat "Ktoś już to wziął"). |
| Organizator zmienia `layoutMode` w trakcie gdy inny użytkownik ma otwarty ekran | Brak wymogu realtime sync w tym zadaniu — inny użytkownik zobaczy nowy tryb po odświeżeniu/ponownym wejściu (zgodne z resztą ekranu, który też nie ma dziś realtime). |
| Rodzina bez żadnych opiekunów z rolą GUARDIAN (edge case danych) | `sharesItem`/`bringsItem` = `false`, brak crasha w agregacji backendowej (pusta lista `party_ids` → pusty wynik zapytania, nie błąd). |

### 8.2. Strategia testów

**Frontend (Vitest + Testing Library, `src/frontend/src/test/`)**:
- `layoutPositions.test.ts` — testy jednostkowe czystych funkcji (Sekcja 7.5), pierwsze testy dla tej wcześniej nieprzetestowanej logiki.
- `Avatar.test.tsx` — renderuje inicjały, kolor deterministyczny dla tej samej nazwy, ikony udostępnia/przynosi pojawiają się warunkowo wg propsów.
- `GroupVisualization.test.tsx` — dla każdego `layoutMode` renderuje poprawną liczbę avatarów bez duplikatów pozycji (mock `families`), klik avatara wywołuje `onSelectFamily` z poprawnym `familyId`.
- Nowy plik `KragGrupyPage.test.tsx` (dziś brak) — co najmniej: przełącznik trybu widoczny tylko dla organizatora, zmiana trybu wywołuje `updateGroupLayoutMode`, karta rodziny pokazuje sekcję "do wymiany" tylko gdy `activeFamilyExchangeOffers` niepuste i to nie własna rodzina.

**Backend (integration-first, TestContainers + PostgreSQL, per `standards/testing/backend-testing.md`)**:
- Test `GET /groups/{id}/exchange-summary`: rodzina z aktywnym Pledge → `bringsItem=true`; rodzina z aktywną ItemListingPreference → `sharesItem=true`; rodzina bez żadnego → oba `false`; rodzina z FULFILLED/CANCELLED ofertą → `false` (nie liczy się jako aktywna).
- Test autoryzacji: użytkownik spoza grupy → `403` na obu nowych endpointach.
- Test `GET /families/{familyId}/exchange-offers`: zwraca oferty wszystkich opiekunów rodziny, nie tylko jednego; rodzina z innej grupy → `404`.
- Test `PATCH /groups/{id}` z `layout_mode`: aktualizacja przez organizatora się udaje; próba przez nie-organizatora → `403` (istniejący check, tylko nowe pole).

### 8.3. Poza zakresem tego zadania (potwierdzone w toku projektowania)

- Publiczny/niezalogowany widok grupy (`PublicKragGrupyView`) — bez zmian.
- Dedykowany ekran ustawień grupy — przełącznik żyje tylko na ekranie wizualizacji.
- Realtime synchronizacja zmiany trybu między jednocześnie otwartymi sesjami.
- Przycisk "Napisz" w karcie rodziny — funkcja nie istnieje w systemie.
- Interaktywne "chipy" przedmiotów na środku stołu (tryb TABLE) — czysto dekoracyjne w tym zadaniu.
- Pełny rewrite `KragGrupyPage.tsx` z CSS-in-JS na Tailwind (tylko nowe elementy używają Tailwind).

---

