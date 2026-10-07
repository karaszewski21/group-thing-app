# High-Level Design: strona organizatora — 5 układów + paleta kolorów

**Data:** 2026-10-07 · **Faza:** 5 (projekt) · **Wejścia:** `outputs/solution-exploration.md` (decyzje użytkownika z fazy 4 są wiążące), `analysis/synthesis.md` (rev. 2), `outputs/research-report.md`, `analysis/findings/deep-*.md`, `codebase-*.md` · **Rekordy decyzji:** `outputs/decision-log.md` (ADR-001 … ADR-014)

---

## 1. Przegląd projektu

**Kontekst biznesowy.** Publiczna strona organizatora (`/:organizationSlug`) to dziś jedna karta z nazwą. Organizatorzy udostępniają ją na Instagramie i WhatsAppie, więc strona jest ich wizytówką. `HomeView` obiecuje „opis, kolory i logo”, a ścieżki edycji nie ma. Funkcja daje organizatorowi wybór **1 z 5 układów** i **palety kolorów**. Paleta obowiązuje na stronie organizatora, terminu i produktu. Architektura ma być gotowa na **płatne układy** bez budowania billingu teraz.

**Wybrane podejście.**
- **Zakres motywu CSS** (`OrganizerThemeScope`) ustawia inline **13 tokenów ról** Tailwinda (`--color-primary`, …). Tokeny liczy ręcznie napisany generator **`orgPalette.ts`** (OKLCH + autokorekta WCAG).
- Strona organizatora renderuje układ z **deklaratywnego rejestru** (`PageLayoutDefinition`) przez jeden **`LayoutRenderer`** i bibliotekę **17 bloków**.
- Dane pochodzą z **dwóch równoległych odczytów**: motyw i treść z modułu `organizations`, grupy, terminy i wymiana z nowego endpointu modułu **`groups`** (tylko grupy PUBLIC, bez nazwisk).
- Edycja odbywa się **inline**, w dolnym arkuszu na własnej stronie (`?edit=1`), z jawnym zapisem.
- Styl architektury: **modularny monolit** (granice DDD `organizations` ← `groups` przez ACL) + **frontend sterowany rejestrem** (registry-driven rendering).

**Kluczowe decyzje:**
- **Motyw = zmienne CSS na elemencie-zakresie**, a nie Chakra: strony docelowe to Tailwind v4, a mechanizm jest zweryfikowany empirycznie (ADR-001).
- **Presety (8–12) + „Własny” z autokorektą kontrastu.** Backend waliduje tylko hex, bo generator koryguje każdy kolor (ADR-002).
- **Kolumny `page_layout VARCHAR(64)` + `palette_preset VARCHAR(40)`** z allowlistą w kodzie: bez natywnego enuma, bez CHECK i bez JSONB (ADR-003).
- **Endpoint katalogu należy do `groups`** (`GET /api/groups/public/organizers/{slug}`), bo zależność biegnie `groups → organizations` (ADR-006).
- **Produkt w trasie zagnieżdżonej `/:slug/produkt/:id`** w ramie publicznej, za logowaniem, z motywem na całej stronie (ADR-009, odstępstwo użytkownika od badania).
- **Tylko szew pod płatne układy** (kolumna, allowlista, fallback, jedno miejsce rozwiązujące układ). Uprawnienia przychodzą w zadaniu E (ADR-010).

---

## 2. Architektura

### 2.1 Kontekst systemu (C4 poziom 1)

```
   +-------------------+                         +----------------------+
   |  Odwiedzający     |  HTTPS (link z IG/WA)   |  Organizator         |
   |  (rodzic, anonim  |-----------+   +---------|  (właściciel org.)   |
   |   lub zalogowany) |           |   |  HTTPS  |  edytuje wygląd      |
   +-------------------+           v   v         +----------------------+
                           +---------------------------+
                           |      group-thing-app      |
                           |  SPA (React/Tailwind) +   |
                           |  API (FastAPI, Postgres)  |
                           +---------------------------+
                             |          |           ^
             S3 API (put/    |          | SQL       | SQL (granty: SELECT/UPDATE
             public ACL)     v          v           |  kolumn moderacji)
                  +----------------+  +------------------+   +------------------------+
                  | DO Spaces (CDN)|  | PostgreSQL       |<--| group-thing-ai (VPS B) |
                  | zdjęcia (D)    |  | (wspólna baza)   |   | cron ShieldGemma (D)   |
                  +----------------+  +------------------+   +------------------------+
                                            ^
                                            | in-process (VPS A)
                                     +---------------+
                                     | Bielik-Guard  |  check_text (C) — synchronicznie
                                     +---------------+
```

- Odwiedzający czyta stronę organizatora i terminu **bez logowania**. Strona produktu wymaga logowania.
- Organizator edytuje układ i kolory na **własnej** stronie publicznej (tryb właściciela).
- Spaces i cron VPS B dochodzą dopiero w zadaniu D (logo, okładka, galeria). Bielik w zadaniu C (tekst).

### 2.2 Kontenery (C4 poziom 2)

```
+--------------------------------------- Przeglądarka -----------------------------------------+
|  SPA React 19 + Tailwind v4 (+ Chakra tylko /admin)                                          |
|                                                                                              |
|  [PublicLayout: pasek konta — chrom NEUTRALNY]                                               |
|     |-- /:slug ------------------> OrganizerThemeScope -> LayoutRenderer -> bloki            |
|     |                                     (+ EditorSheet dla właściciela, ?edit=1)           |
|     |-- /:slug/grupa/:g/term/:t -> OrganizerThemeScope -> KragStage -> PublicTermView        |
|     |-- /:slug/produkt/:id[/edit] -> AuthGuard -> OrganizerThemeScope -> ItemDetail/Edit     |
|  [PanelShell] /product/:id[/edit] -> PhoneFrame+PanelNavBar (paleta DOMYŚLNA)                |
|                                                                                              |
|  TanStack Query: usePublicOrganization, useMyOrganization, useUpdateOrganization,            |
|                  useOrganizerPage, useOrganizerTerms (infinite), useCircle (istn.)           |
+--------------------------------------------|-------------------------------------------------+
                                             | JSON/HTTPS (JWT opcjonalnie)
+--------------------------------------------v-------------------------------------------------+
|  API FastAPI (VPS A)          AUTHORIZATION_MATRIX (first-match-wins)                         |
|                                                                                              |
|  app.organizations  ------------------------------------------+                              |
|   GET  /api/organizations/public/{slug}   (PUBLIC, wiersz 48) |  page_layout (resolver),     |
|   GET  /api/organizations/mine            (READ)              |  palette_preset, kolory,     |
|   PATCH /api/organizations/{id}           (EDIT)              |  treść (C), media (D)        |
|   POST/DELETE/PATCH .../{id}/media...     (EDIT, zadanie D)   |                              |
|                                  ^ organizations_acl (jedyny import groups -> organizations) |
|  app.groups  -------------------------------------------------+                              |
|   GET /api/groups/public/{id}?term_id=     (PUBLIC) + organizer_theme                        |
|   GET /api/groups/public/organizers/{slug}        (PUBLIC, NOWY)                             |
|   GET /api/groups/public/organizers/{slug}/terms  (PUBLIC, NOWY, stronicowany)               |
|      -> circulation_bridge / product_bridge (funkcje wsadowe)                                |
|  app.moderation  text_guard.check_text (C) · list_photos/decide/delete (D)                   |
+-------------------|---------------------------------------|----------------------------------+
                    v SQLAlchemy async                       v boto3 (D)
            +---------------+                          +-------------+
            | PostgreSQL    |<-- cron VPS B (D) ------ | DO Spaces   |
            +---------------+                          +-------------+
```

| Kontener | Odpowiedzialność |
|---|---|
| SPA (strony publiczne) | Renderuje stronę organizatora z rejestru, nakłada motyw na trzy strony, hostuje edytor właściciela |
| SPA (panel) | Bez zmian strukturalnych; `/product/:id` zostaje w palecie domyślnej |
| API `organizations` | Właściciel motywu, układu i treści organizacji; jedno miejsce rozwiązujące układ (`resolve_page_layout`) |
| API `groups` | Właściciel publicznego katalogu grup, terminów i wymiany organizatora; dokleja `organizer_theme` do strony terminu |
| API `moderation` | Tekst synchronicznie (C), zdjęcia przez kolejkę i cron (D) |
| PostgreSQL | Kolumny motywu i układu w `organizations`, treść (C), `organization_media` (D) |
| VPS B cron | Moderacja zdjęć `organization_media` (nowy `Subject`, zadanie D) |
| DO Spaces | Pliki zdjęć organizacji, prywatne do akceptacji (zadanie D) |

### 2.3 Widok komponentów (logiczny)

```
FRONTEND (src/frontend/src)
 theme/
   orgPalette.ts ........ buildOrgThemeVars(primary, accent?) -> {--color-*: hex} (czysta funkcja)
   palettePresets.ts .... PALETTE_PRESETS: Record<key, ThemeVars>  + DEFAULT_THEME_VARS
   resolveOrgTheme.ts ... (theme | null) -> ThemeVars   [preset > generator > domyślna]
   OrganizerThemeScope.tsx  <div style={vars}> (useMemo), bez transform/filter/contain
 pages/organizer/
   PublicOrganizationPage.tsx (przepisana) -> useOrganizerPageData -> Scope -> LayoutRenderer
   layouts/{types,registry}.ts + definitions/{classic,links,schedule,circles,exchange}.ts
   LayoutRenderer.tsx ... sloty -> BLOCKS[id], when, isEmpty, stan pusty, duchy (owner-edit)
   blocks/*.tsx ......... 17 bloków (czyste komponenty, bez pobierania danych)
   editor/ EditorSheet, LayoutTab, ColorsTab, CustomColorPicker, PreviewSwitch, mini-karty
 pages/krag/TermPage.tsx ......... Scope(theme = circle.organizer_theme) wokół KragStage
 pages/product/OrganizerItemPage.tsx  rama publiczna + Scope(usePublicOrganization(slug))
 hooks/ usePublicOrganization, useMyOrganization, useUpdateOrganization,
        useOrganizerPage, useOrganizerTerms, useOrganizerPageData (składa model widoku)

BACKEND (src/backend/app)
 organizations/ page_layouts.py (allowlista + resolve_page_layout) · palettes.py (allowlista presetów)
                models/schemas/service/router (PATCH model_fields_set, odpowiedź publiczna)
 groups/ application/organizer_page.py (model odczytu, ~12 stałych zapytań)
         router/organizer_page.py · schemas (OrganizerPageResponse, OrganizerTermResponse,
         OrganizerThemeResponse) · infrastructure/organizations_acl.py (+3 funkcje)
         repository.py / circulation_bridge.py / product_bridge.py (+funkcje wsadowe)
         application/public_view.py (+organizer_theme)
 core/authorization_matrix.py (+wiersz PUBLIC organizers, +DELETE w wierszu 50)
```

---

## 3. Kluczowe komponenty

| Komponent | Cel | Odpowiedzialności | Kluczowe interfejsy | Zależności |
|---|---|---|---|---|
| `orgPalette.ts` | Zamienić kolor wejściowy na 13 tokenów spełniających WCAG AA | Przycięcie zbyt jasnych kolorów; wybór `on-primary` (biały/ink); przyciemnianie do 4,5:1; odcienie soft i neutralne; flagi korekty dla edytora | `buildOrgThemeVars(primary, accent?) → { vars, adjusted: {primaryDarkened, tooLight} }` | brak (≈80 linii, 0,9 KB gz) |
| `palettePresets.ts` + `resolveOrgTheme` | Ręcznie dostrojone mapy presetów i domyślnej palety; jedna reguła wyboru źródła | Preset znany → mapa; `primary_color` → generator; nic → domyślna | `resolveOrgTheme(theme?: OrganizerTheme \| null) → ThemeVars` | `orgPalette.ts` |
| `OrganizerThemeScope` | Przebarwić poddrzewo bez wpływu na resztę aplikacji | Inline `style` z 13 tokenami w `useMemo`; brak `transform`/`filter`/`contain` | `<OrganizerThemeScope theme={…}>{children}</…>` | `resolveOrgTheme` |
| Rejestr układów | Opisać układ jako dane | Definicje 5 układów; `resolveLayout(key)` z fallbackiem do CLASSIC; `recommendWhen` | `LAYOUT_REGISTRY`, `resolveLayout`, `FALLBACK_LAYOUT` | typy bloków |
| `LayoutRenderer` | Jeden silnik renderowania układów | Mapuje sloty na bloki; stosuje `when`; ukrywa puste bloki; stan pusty bloku głównego; duchy właściciela | `<LayoutRenderer def data mode="visitor"\|"owner-edit">` | `BLOCKS` |
| Biblioteka bloków (17) | Wielokrotnie używane sekcje strony | Każdy blok: `variants`, `reads`, `isEmpty`, `Component`; tylko tokeny ról | `BLOCKS[id]` | `OrganizerPageData` |
| Edytor (`EditorSheet`) | „Widzę i decyduję” na prawdziwej stronie | Zakładki Układ/Kolory (później Treść); wersja robocza w stanie React; mini-karty terminu/produktu; Zapisz/Anuluj | `draft`, `onSave → useUpdateOrganization` | rejestr, presety, generator |
| Model odczytu organizatora (`groups`) | Publiczny katalog bez wycieku danych | Tylko PUBLIC; aktywne prowadzenie; limity SQL; `family_count` z progiem 3; bez nazwisk; ~12 zapytań | `GET /api/groups/public/organizers/{slug}[/terms]` | `organizations_acl`, bridge'e |
| `organizations` (motyw/układ/treść) | Źródło prawdy wyglądu organizacji | PATCH `model_fields_set`; `resolve_page_layout`; allowlisty; odpowiedź publiczna | `GET /public/{slug}`, `PATCH /{id}` | `moderation` (C), Spaces (D) |
| `organizer_theme` na terminie | Kolory organizatora na stronie terminu bez zaufania do sluga z URL | Dokleja `{primary_color, accent_color, palette_preset}` z wiersza `Organization` rozwiązanego przez serwer | `PublicCircleResponse.organizer_theme` | `organizations_acl` |

---

## 4. Mapa komponentów z plikami

Oznaczenia: **N** nowy · **M** modyfikowany · zadanie w nawiasie.

### 4.1 Frontend (`src/frontend/src/`)

| Plik | N/M | Zadanie | Zmiana |
|---|---|---|---|
| `index.css` | M | A1 | `@theme`: tokeny ról (13 motywowanych + stałe); stałe jako `@theme static`; przejściowe aliasy `mint`/`lime` w `@theme inline`; poprawki kontrastu domyślnej palety |
| `theme/orgPalette.ts` | N | A1 | generator OKLCH + WCAG |
| `theme/palettePresets.ts` | N | A1 (domyślna) / A2 (8–12 presetów) | ręczne mapy hex |
| `theme/resolveOrgTheme.ts` | N | A1 | reguła preset > generator > domyślna |
| `theme/OrganizerThemeScope.tsx` | N | A1 | element zakresu |
| `pages/krag/components/KragStage.tsx` | M | A1 | `.kg-*` na `--color-*`; usunięcie `:root{--mint…}` **po** migracji zależnych; globalny `box-sizing` do `@layer base` lub usunięty (X4) |
| `pages/krag/GroupVisualization.tsx`, `PrivateGroupGate.tsx`, `components/TermFooter.tsx`, `PublicTermView.tsx` | M | A1 | hexy i `var(--ink…)` → utility tokenów ról; link do produktu → `/${organizer_slug}/produkt/${id}` |
| `components/krag/ModalSheet.tsx`, `RequestAccessDialog.tsx`, `AccountMergeForm.tsx` | M | A1 | `bg-scrim`, tokeny zamiast `var(--…)` |
| `components/shared/PhoneFrame.tsx` | M | A1 | `bg-stage` / `bg-stage-wide` |
| `pages/panel/PanelNav.tsx`, `panelIcons.tsx`, `components/shared/Icons.tsx` | M | A1 | ikony `currentColor` |
| `pages/krag/TermPage.tsx` | M | A1 | `OrganizerThemeScope` wokół `KragStage` z `organizer_theme` |
| `api/groups.ts` | M | A1 / B | typ `organizer_theme`; (B) `getOrganizerPage`, `getOrganizerTerms` |
| `router.tsx` | M | A1 | trasy `/:organizationSlug/produkt/:id` i `/:organizationSlug/produkt/:id/edit` (`AuthGuard`) |
| `pages/product/OrganizerItemPage.tsx` | N | A1 | rama publiczna + zakres + treść przedmiotu |
| `pages/product/ItemDetailPage.tsx`, `ItemEditPage.tsx`, `ItemBackButton.tsx`, `ItemTimeline.tsx`, `itemPageShared.ts` | M | A1 | wydzielenie `ItemViewContent` do współdzielenia; `useItemRoutes()` (prefiks `/:slug/produkt` lub `/product`); fallback „Wróć” → `/${slug}`; pigułka „Dostępna” na tokenach |
| `api/organizations.ts` | M | A2 / C / D | nowe pola typów; `null` w `UpdateOrganizationRequest` |
| `hooks/usePublicOrganization.ts`, `useMyOrganization.ts`, `useUpdateOrganization.ts` | N | A1 (public) / A2 | hooki TanStack wg `data-fetching.md`; `useMyOrganizationSlug` staje się cienką nakładką na `useMyOrganization` |
| `pages/PublicOrganizationPage.tsx` → `pages/organizer/PublicOrganizationPage.tsx` | M (przeniesienie) | A2 | koniec `useState`+`useEffect` (X6); zakres + renderer + edytor |
| `pages/organizer/layouts/types.ts`, `registry.ts`, `definitions/classic.ts`, `links.ts` | N | A2 | kontrakt rejestru + 2 układy |
| `pages/organizer/layouts/definitions/schedule.ts`, `circles.ts`, `exchange.ts` | N | B-FE | 3 układy |
| `pages/organizer/LayoutRenderer.tsx` | N | A2 | silnik |
| `pages/organizer/blocks/*.tsx` | N | A2: `hero`, `share`, `about`*, `link-stack`, `empty-state`, `footer` · B-FE: `stats`, `upcoming-terms`, `agenda`, `next-term-cta`, `circles-grid`, `circle-visual`, `exchange-counts`, `exchange-board`, `needed-items` · D2: `gallery` · E: `testimonials` | *`about` renderuje się dopiero, gdy C doda `bio`; w A2 jest tylko duchem właściciela |
| `pages/organizer/editor/*.tsx` | N | A2 (Układ, Kolory) / C (Treść: tekst) / D (Treść: zdjęcia) | arkusz, zakładki, mini-karty |
| `assets/layouts/{classic,links,schedule,circles,exchange}.svg` | N | A2 / B-FE | statyczne miniatury |
| `components/shared/AccountMenu.tsx`, `pages/panel/views/HomeView.tsx` | M | A2 | wejście do `/${slug}?edit=1` |
| `test/*` | N/M | wszystkie | testy kontrastu presetów i generatora; zgodność kluczy z backendem; renderer; edytor; zakres |

### 4.2 Backend (`src/backend/app/`)

| Plik | N/M | Zadanie | Zmiana |
|---|---|---|---|
| `groups/infrastructure/organizations_acl.py` | M | A1 / B | (A1) `get_organizer_theme(org)`; (B) `get_organization_by_slug`, `get_owner_party_id` |
| `organizations/service.py` | M | A2 / B / C / D | (A2) PATCH `model_fields_set`, `resolve_page_layout`; (B) `get_owner_party_id` (membership aktywne + rola OWNER); (C) moderacja treści; (D) media |
| `groups/application/public_view.py`, `groups/schemas.py` | M | A1 | `organizer_theme` w `PublicCircleResponse` (także gałąź PRIVATE) |
| `organizations/page_layouts.py` | N | A2 | `PAGE_LAYOUT_KEYS`, `FALLBACK_PAGE_LAYOUT = "CLASSIC"`, `resolve_page_layout(org) -> str` |
| `organizations/palettes.py` | N | A2 | `PALETTE_PRESET_KEYS` (allowlista) |
| `organizations/models.py` | M | A2 / C | kolumny `page_layout`, `palette_preset`; (C) `tagline`, `bio`, `location`, `links` |
| `organizations/schemas.py` | M | A2 / C / D | `UpdateOrganizationRequest` (+walidator nie-nullowych), `OrganizationResponse`, `PublicOrganizationResponse` |
| `organizations/slugs.py` | M | A1 | `"produkt"` w `RESERVED_SLUGS` |
| `core/authorization_matrix.py` | M | A2 / B | (A2) `DELETE` w wierszu 50; (B) wiersz PUBLIC `^/api/groups/public/organizers/[^/]+(/terms)?$` przed wierszem 26 |
| `groups/application/organizer_page.py` | N | B | model odczytu |
| `groups/router/organizer_page.py` | N | B | 2 trasy GET, rejestrowane obok `/public` |
| `groups/infrastructure/repository.py` | M | B | wsadowe: prowadzenia → grupy, terminy w oknie, następny termin na grupę, `family_count`, uprawnieni wystawiający |
| `groups/infrastructure/circulation_bridge.py` | M | B | `list_available_items_with_product(item_ids)` |
| `groups/infrastructure/product_bridge.py` | M | B | `first_approved_photo_by_product(product_ids)` |
| `moderation/text_guard.py` (+`rules.py`) | M | C | `TextField.ORGANIZATION_TAGLINE/BIO/LOCATION` + `MESSAGES`; parametryzacja komunikatu `ensure_no_contact_info` |
| `organizations/models.py` (`OrganizationMedia`), `organizations/media.py` | N | D | tabela i serwis uploadu |
| `moderation/models.py`, `service.py`, `schemas.py` | M | D | `ORGANIZATION_MEDIA` w union/decide/delete |
| `system/public_preview.py` | M | C / D2 | `og:description` (C), `og:image` + `theme-color` (D2) |
| `alembic/versions/0052…0054` | N | A2 / C / D | §10 |
| **group-thing-ai** `app/photo_store.py`, `scripts/moderation_db_role.sql`, `tests/test_deploy_artifacts.py` | M | D | `Subject` + granty + test |

---

## 5. System motywu

### 5.1 Tokeny

| Token (Tailwind `--color-*`) | Domyślnie (A1, po poprawkach) | Dawna nazwa | Użycie | Motywowany |
|---|---|---|---|---|
| `primary` | `#1b8168` | `mint` | wypełnienia: CTA, aktywne znaczniki, „udostępnia”, szprychy | tak |
| `on-primary` | `#ffffff` | `text-white` | tekst i ikony na primary (biały albo ink) | tak |
| `primary-fg` | `#117b63` (było 4,45:1) | `text-mint` | tekst w kolorze marki: linki, etykiety, „Dostępna” | tak |
| `primary-soft` | jaśniej niż `#d8f0e6` (L 0,95) | `mint-soft` | zaznaczenia, pigułki, GIFT | tak |
| `focus-ring` | `#1b8168` | — | obrys fokusu ≥3:1 | tak |
| `accent` | `#a9c24f` | `lime` | akcenty dekoracyjne, bez tekstu | tak |
| `accent-soft` | `#eaf2ce` | `lime-soft` | tła badge'y, SWAP | tak |
| `accent-fg` | `#56701f` | literał | tekst na accent-soft | tak |
| `cream` | `#f4f8f0` | `cream` | tło strony, inputy | tak (neutralny) |
| `stage` / `stage-wide` | `#edf1ea` / `#e7ede4` | literały | tło za kolumną 430px | tak (neutralny) |
| `line` / `line-strong` | `#e2eadf` / `#cbdac7` | `line` / literał | linie, nieaktywne szprychy | tak (neutralny) |
| `paper`, `ink`, `ink-soft`, `on-ink` | dziś | — | karty, tekst, toast | stały (`@theme static`) |
| `danger`, `danger-soft` | `#b23b3b`, `#f6e4e2` | + `#B4443A` z KragStage | błędy (ujednolicone, X5) | stały |
| `teal`, `teal-soft`, `sage`, `sage-soft` | ciemniejsze wg poprawki kontrastu | — | „przynosi” (ikona **ink** na teal), LEND, etykiety pomocnicze | stały |
| `scrim` | `rgba(20,28,24,.55)` | literał | tło modali | stały |
| murawa, drewno, `Avatar PALETTE` | dziś | literały | ilustracje, kolory rodzin | stały, bez tokenów motywu |

**Reguły (obowiązkowe w przeglądzie kodu):**
1. Na stronach publicznych żadnych hexów w klasach arbitralnych, stylach inline, `stroke=` ani `c=`; tylko tokeny ról.
2. Zmiennych pochodnych **nigdy** nie deklarujemy na `:root` (zamarzają). Motyw nadpisujemy wyłącznie na elemencie zakresu.
3. Tokeny czytane poza utility (KragStage, inline) deklarujemy w `@theme static`, bo Tailwind usuwa nieużywane zmienne.
4. Element zakresu nie ma `transform`, `filter`, `perspective`, `contain: paint/layout` ani `will-change: transform`, bo zepsułyby arkusze `position:fixed`. Portali dziś nie ma; nowa nakładka na tych stronach dostaje `portalled={false}` albo własny zakres.
5. Chrom platformy (pasek konta w `PublicLayout`, `NotificationBell`, tło `body`, rama panelu) zostaje w palecie domyślnej. Bez trybu ciemnego.

### 5.2 Rozwiązywanie motywu (frontend)

```ts
// src/frontend/src/theme/resolveOrgTheme.ts
export interface OrganizerTheme {            // = API organizer_theme / pola org
  primary_color: string | null;              // "#rrggbb"
  accent_color: string | null;
  palette_preset: string | null;             // klucz z PALETTE_PRESETS lub null ("Własny"/domyślna)
}
export type ThemeVars = Record<`--color-${ThemeRole}`, string>;   // dokładnie 13 kluczy

export function resolveOrgTheme(t: OrganizerTheme | null | undefined): ThemeVars {
  if (t?.palette_preset && PALETTE_PRESETS[t.palette_preset]) return PALETTE_PRESETS[t.palette_preset];
  if (t?.primary_color) return buildOrgThemeVars(t.primary_color, t.accent_color ?? undefined).vars;
  return DEFAULT_THEME_VARS;                                        // ręczna mapa = dzisiejszy wygląd
}
```

- Wybór presetu zapisuje `palette_preset = <klucz>` **oraz** `primary_color`/`accent_color` = kolory bazowe presetu. Nieznany klucz (np. preset wycofany) degraduje się wtedy do generatora z zapisanych hexów, a nie do palety domyślnej.
- „Własny”: `palette_preset = null`, `primary_color` obowiązkowy, `accent_color` opcjonalny („automatyczny” = `null`).
- „Przywróć domyślne”: wszystkie trzy pola `null`.
- Presety (8–12; nazwy robocze do strojenia w A2): Mięta (= domyślna), Ocean, Lawenda, Malina, Słońce, Las, Terakota, Grafit, Śliwka, Morze Północne. Każdy preset przechodzi test kontrastu wszystkich par ról w CI.

---

## 6. Rejestr układów i bloki

### 6.1 Kontrakt (TypeScript)

```ts
// src/frontend/src/pages/organizer/layouts/types.ts
export type BlockId =
  | "hero" | "share" | "stats" | "about" | "upcoming-terms" | "agenda" | "next-term-cta"
  | "circles-grid" | "circle-visual" | "exchange-counts" | "exchange-board" | "needed-items"
  | "link-stack" | "gallery" | "testimonials" | "empty-state" | "footer";

export interface BlockSlot {
  block: BlockId;
  variant?: string;                                    // walidowany względem BLOCKS[block].variants (test)
  props?: Record<string, string | number | boolean>;   // tylko JSON, np. { limit: 5 }
  primary?: true;                                      // dokładnie jeden na układ (test)
  when?: { minCircles?: number; maxCircles?: number }; // np. CIRCLES: cards vs featured
}

export interface PageLayoutDefinition {
  key: string;            // = organizations.page_layout ("CLASSIC" | … | przyszłe "custom:<uuid>")
  version: number;        // zmiana łamiąca => nowy klucz, nie mutacja
  label: string;          // "Plan zajęć"
  description: string;    // „dla kogo” w pickerze
  thumbnail: { src: string; alt: string };   // statyczny SVG
  frame: "column" | "centered";
  blocks: BlockSlot[];    // deklaratywne, serializowalne do JSON
  recommendWhen?: (d: OrganizerPageData) => boolean;  // odznaka „Polecany”
  // Celowo BRAK: Component, minData, tier — dochodzą z pierwszym wywołującym (ADR-004, ADR-010)
}

export interface BlockDefinition<V extends string = string> {
  id: BlockId;
  variants: readonly V[];
  isEmpty: (d: OrganizerPageData) => boolean;
  Component: React.ComponentType<{ data: OrganizerPageData; variant: V; mode: RenderMode; props?: BlockSlot["props"] }>;
}
export type RenderMode = "visitor" | "owner-edit";

export const FALLBACK_LAYOUT = "CLASSIC";
export const resolveLayout = (key?: string | null): PageLayoutDefinition =>
  (key && LAYOUT_REGISTRY[key]) || LAYOUT_REGISTRY[FALLBACK_LAYOUT];

// Model widoku składany przez useOrganizerPageData z dwóch zapytań:
export interface OrganizerPageData {
  organization: PublicOrganizationResponse;       // motyw, układ, treść (C), media (D)
  directory: OrganizerPageResponse | null;        // null = trwa ładowanie / 404 (k-…) / błąd
  directoryStatus: "loading" | "ready" | "unavailable";
}
```

**Reguły `LayoutRenderer`:**
- w trybie `visitor` pomija sloty, dla których `isEmpty(data)` jest prawdą;
- gdy pusty jest slot `primary`, wstrzykuje `empty-state:visitor` właściwy dla układu i `link-stack` (Udostępnij);
- w trybie `owner-edit` puste sloty renderują się jako **duchy** z wezwaniem do działania („Dodaj opis”, „Dodaj termin”); duchy nigdy nie trafiają do odwiedzającego;
- bloki zależne od `directory` pokazują szkielet, dopóki `directoryStatus === "loading"`.

**Lustro w backendzie:** `organizations/page_layouts.py` → `PAGE_LAYOUT_KEYS: frozenset[str]`. Test frontendu porównuje klucze `LAYOUT_REGISTRY` z kontraktem backendu (lista kluczy wpisana w test po obu stronach). Allowlista rośnie razem z rejestrem: A2 = `{CLASSIC, LINKS}`, B-FE = + `{SCHEDULE, CIRCLES, EXCHANGE}`.

### 6.2 Biblioteka bloków (17)

| Blok | Warianty | Dane | Od zadania | Gdy pusto (odwiedzający) |
|---|---|---|---|---|
| `hero` | `cover`, `color`, `compact`, `centered` | name; tagline (C); logo/cover (D) | A2 | nigdy; `cover` bez zdjęcia → `color` |
| `share` | inline | slug | A2 | nigdy |
| `stats` | `tiles3` | location (C), `family_count`, liczba zdjęć (D2) | B | <2 kafle → ukryty |
| `about` | `full`, `short` | bio (C) | A2 (duch) / C | ukryty |
| `upcoming-terms` | `list`, `compact` | `upcoming_terms` | B | ukryty |
| `agenda` | `by-day`, `week-strip` | `/terms` (stronicowane) + `circles` | B | stan pusty „Brak zaplanowanych zajęć” |
| `next-term-cta` | `card`, `button` | pierwszy termin | B | ukryty |
| `circles-grid` | `cards`, `featured` | `circles` („zapisanych: N”) | B | stan pusty |
| `circle-visual` | `mini` (anonimowe miejsca) | `layout_mode`, `attendee_count` | B | ukryty przy 0 uczestnikach |
| `exchange-counts` | `tiles3` (w EXCHANGE: zakładki) | `exchange.counts` | B | ukryty przy 0/0/0 |
| `exchange-board` | `grid2`, `list` | `exchange.items` (`thumb_url`) | B | stan pusty + „Jak to działa?” |
| `needed-items` | `list` | `needed_items` | B | ukryty |
| `link-stack` | `buttons` | wyliczane: najbliższy termin, terminy, wymiana, `links` (C), udostępnij | A2 | nigdy (zawsze „Udostępnij”) |
| `gallery` | `strip`, `grid2` | zatwierdzone zdjęcia | D2 | ukryty |
| `testimonials` | `cards` | — | E (SHOWCASE) | ukryty |
| `empty-state` | `visitor`, `owner` | statyczne | A2 | — |
| `footer` | `minimal` | — | A2 | nigdy |

Etykiety wymiany pochodzą z `termLabels.ts`. Semantyka kolorów: GIFT = `primary-soft`, SWAP = `accent-soft`, LEND = `teal-soft`.

### 6.3 Pięć układów (szkice ASCII, kolumna 430px)

**1. `CLASSIC` „Klasyczny”** (domyślny i fallback; odwzorowanie `ProfilMobilny`) — `hero:cover→color` · `stats` · `about:full` · `upcoming-terms:list` (primary) · `exchange-counts` · `gallery:strip` · `footer`

```
+------------------------------------------+
|[< Wróć]                           [Udost]|
|####### okładka / gradient primary #######|
| (O) Rodzinny Grajdołek                   |
| Zajęcia umuzykalniające 0-6 · Jeżyce     |
+-/--------------------------------------\-+
| [Jeżyce] [Rodziny 32] [Galeria 8 >]      |
| Zaczęłam od jednej grupy w salce ...     |
| Najbliższe terminy                       |
| |27 sie| Muzyczne Maluchy 16:30 zapis. 8>|
| |30 sie| Rytmy i grzechotki 10:00       >|
| Wymiana rzeczy                           |
| [Oddam 3]  [Wymienię 4]  [Wypożyczę 0]   |
| ---------- Strona utworzona w … -------- |
+------------------------------------------+
```

**2. `SCHEDULE` „Plan zajęć”** — `hero:compact` · `next-term-cta:card` · `agenda:by-day` (primary; filtry przy ≥2 grupach; „Pokaż kolejne tygodnie” = `/terms`) · `about:short` · `exchange-counts` · `footer`

```
+------------------------------------------+
| (O) Akademia Orlik                [Udost]|
+------------------------------------------+
| | NAJBLIŻSZE  wt 14 paź  Orliki 2017   | |
| |                      [ Zapisz się > ]| |
| (Wszystkie) (2015) (2017) (2019)  ->     |
| == wtorek, 14 października ============= |
|  17:00  Orliki 2017       zapisanych 12 >|
|  18:15  Młodziki 2015     zapisanych  9 >|
| == czwartek, 16 października =========== |
|  17:00  Orliki 2017                     >|
|          [ Pokaż kolejne tygodnie ]      |
| O nas: Trenujemy od 2012 ...   Więcej v  |
+------------------------------------------+
```

**3. `CIRCLES` „Grupy”** — `hero:color` · `circles-grid:cards` (when `minCircles: 2`) **albo** `circles-grid:featured` + `circle-visual:mini` (when `maxCircles: 1`) (primary) · `about:short` · `exchange-counts` · `footer`

```
 >= 2 grupy                               1 grupa (featured, anonimowe miejsca)
+--------------------------------------+ +--------------------------------------+
| #### gradient primary ####   [Udost] | | #### gradient primary ####   [Udost] |
| (O) Szkoła Muzyczna Nutka            | | (O) Trenerka Ola                     |
| Nasze grupy                          | | |     o   o   o                    |  |
| | Maluchy 0-2       zapisanych: 12 | | | |   o   (Ola)   o   mini boisko   |  |
| | nast.: śr 15 paź, 9:30         > | | | |     o   o   o                    |  |
| | Przedszkolaki 3-6 zapisanych: 9  | | | | Orliki 2017   nast.: wt 14 paź   |  |
| | nast.: czw 16 paź, 16:30       > | | | |              [ Zobacz trening > ]|  |
| O nas: ...                Więcej v   | | O nas: ...                           |
+--------------------------------------+ +--------------------------------------+
```

**4. `LINKS` „Wizytówka”** (link-in-bio; w pełni sensowny przy samej nazwie) — `hero:centered` · `link-stack:buttons` (primary) · `about:short` · `footer`; frame `centered`

```
+------------------------------------------+
|      tło cream + delikatny primary       |
|                 ( RG )                   |
|           Rodzinny Grajdołek             |
|        Muzyka dla 0-6 · Jeżyce           |
| [ Najbliższe zajęcia · wt 14.10 17:00 ]  |  primary, pełny
| [ Wszystkie terminy (5)               ]  |  paper, obrys line-strong
| [ Wymiana rzeczy (7)                  ]  |
| [ Instagram                           ]  |  tylko z links (C)
| [ Udostępnij stronę                   ]  |
|   Malutkie grupy, rodzic siedzi ...      |
+------------------------------------------+
```

**5. `EXCHANGE` „Wymiana”** (tablica przedmiotów) — `hero:compact` · `exchange-counts` (zakładki-filtry) · `exchange-board:grid2` (primary; ≤12) · `needed-items:list` · `upcoming-terms:compact` (3) · `about:short` · `footer`

```
+------------------------------------------+
| (O) Wymianka Sołacz               [Udost]|
+------------------------------------------+
| [*Oddam 3*] [Wymienię 4] [Wypożyczę 1]   |  zakładki
| +-----------------+ +-----------------+  |
| |#####zdjęcie#####| |#####zdjęcie#####|  |
| | Pucio - książka | | Kask rowerowy   |  |
| | b. dobry [Oddam]| | dobry [Od.][Wy.]|  |
| | odbiór: wt 14   | | odbiór: wt 14   |  |
| +-----------------+ +-----------------+  |
|          [ Pokaż wszystkie (12) ]        |
| Potrzebne na wt 14.10                    |
|  - Koc piknikowy        Ja przyniosę >   |
| Najbliższe spotkania: wt 14 · sb 18      |
+------------------------------------------+
```

Karta przedmiotu **nie** pokazuje udostępniającego. Kliknięcie prowadzi na stronę terminu, gdzie odbywa się akcja. SHOWCASE „Magazyn” to przyszły kandydat płatny (zadanie E, po D2).

**Odznaka „Polecany”** (`recommendWhen`): ≥2 grupy → CIRCLES; ≥4 terminy w 14 dni → SCHEDULE; ≥4 przedmioty → EXCHANGE; brak danych katalogu → LINKS. W A2 (tylko CLASSIC i LINKS) działa wyłącznie reguła LINKS.

---

## 7. Edytor

**Wejście:** `AccountMenu` „Moja organizacja” oraz podpowiedź w `HomeView` prowadzą do `/${slug}?edit=1`. Tryb aktywuje się tylko, gdy `useMyOrganization().data?.slug === slug`. Dla innych osób `?edit=1` jest ignorowane. Przycisk „Edytuj wygląd” jest widoczny tylko dla właściciela.

**Stan:** `draft = { pageLayout, theme: OrganizerTheme }` w `useState`, inicjowany z `usePublicOrganization`. Strona pod arkuszem renderuje `resolveLayout(draft.pageLayout)` w `OrganizerThemeScope(draft.theme)`, czyli podgląd to zwykły render z innymi propsami. „Zapisz” wysyła PATCH tylko ze zmienionymi polami (jawny `null` = reset). Potem `await invalidateQueries` na prefiksach `publicOrganization` i `myOrganization`. Błędy przechodzą przez `extractProblemMessage`. „Anuluj” przywraca stan z serwera. Wyjście z niezapisanymi zmianami pokazuje `ConfirmDialog`.

**Zakładka „Układ”:**

```
+------------------------------------------+
| (O) Rodzinny Grajdołek    [podgląd żywy] |   <- prawdziwa strona w draft.layout
| ...                                      |      i draft.theme (duchy widoczne)
| [ + Dodaj opis ]  (duch)                 |
|==========================================|
|  ___  Wygląd strony                 [x]  |   <- dolny arkusz (~55% wys.,
| [ Układ ]  Kolory   (Treść — od C)       |      uchwyt zwijania)
| +----------+ +----------+ +----------+   |
| |[svg]     | |[svg]     | |[svg]     |   |   karty przewijane poziomo
| |Klasyczny | |Wizytówka | |Plan zajęć|   |
| |Profil z  | |*Polecany*| |Gdy masz  |   |
| |opisem... | |Linki z IG| |kilka zaj.|   |
| |   (o)    | |   ( )    | |   ( )    |   |   radio = wybór roboczy
| +----------+ +----------+ +----------+   |
|  Podgląd: (Strona) Termin  Produkt       |
|        [ Anuluj ]        [ Zapisz ]      |
+------------------------------------------+
```

**Zakładka „Kolory”:**

```
|==========================================|
|  ___  Wygląd strony                 [x]  |
|  Układ  [ Kolory ]  (Treść — od C)       |
|  Gotowe palety                           |
|  (●Mięta) (○Ocean) (○Lawenda) (○Malina)  |   koła 44px, obwódka = wybór
|  (○Słońce) (○Las) (○Terakota) (○Grafit)  |
|  (+ Własny)                              |
|  -- Własny --------------------------------|
|  Kolor główny  [■] [#3498db        ]     |
|  Akcent        [auto ▾]                  |
|  ! Lekko przyciemniliśmy kolor, żeby     |   tylko gdy adjusted.primaryDarkened
|    tekst był czytelny.                   |   / „Kolor jest za jasny” gdy tooLight
|  Podgląd: [Zapisz się >]  (Dostępna)     |   przycisk + pigułka w drafcie
|  Podgląd: Strona (Termin) Produkt        |   mini-karty: CTA terminu, pigułka produktu
|  Przywróć domyślne                       |
|        [ Anuluj ]        [ Zapisz ]      |
+------------------------------------------+
```

- Arkusz jest **niemodalny** (strona pozostaje widoczna i przewijalna), montowany wewnątrz `OrganizerThemeScope` (bez portalu), z dostępnością: `role="dialog"` + `aria-modal="false"`, zakładki jako `tablist`, focus trap tylko w obrębie arkusza po otwarciu.
- Przełącznik „Strona / Termin / Produkt” podmienia sekcję podglądu w arkuszu na **mini-karty** (`TermPreviewCard`, `ProductPreviewCard`) w roboczej palecie. Nie renderuje pełnych stron.
- Między A2 a B picker pokazuje tylko CLASSIC i LINKS, bez kart „wkrótce” (`minimal-implementation.md`).

---

## 8. Kontrakty API

Konwencje: JSON snake_case; błędy jako istniejące koperty problemu; daty ISO-8601. Pola oznaczone `(C)`, `(D)`, `(D2)` dochodzą w tych zadaniach i są addytywne.

### 8.1 `GET /api/organizations/public/{slug}` (rozszerzony, PUBLIC, wiersz 48)

```jsonc
// 200 PublicOrganizationResponse
{
  "slug": "rodzinny-grajdolek",
  "name": "Rodzinny Grajdołek",
  "primary_color": "#1b8168" | null,
  "accent_color": "#a9c24f" | null,
  "palette_preset": "OCEAN" | null,                 // A2
  "page_layout": "CLASSIC",                         // A2; zawsze wynik resolve_page_layout(org)
  "tagline": "Zajęcia umuzykalniające 0-6" | null,  // C
  "bio": "Zaczęłam od…\n\nMalutkie grupy…" | null,  // C, zwykły tekst
  "location": "Poznań, Jeżyce" | null,              // C
  "links": [ { "kind": "INSTAGRAM", "url": "https://instagram.com/…" } ],   // C, [] gdy brak
  "logo":  { "url": "https://cdn…/w1600.webp", "thumb_url": "https://cdn…/w400.webp" } | null,  // D
  "cover": { "url": "…", "thumb_url": "…" } | null, // D; najnowsze APPROVED
  "gallery": [ { "id": "uuid", "url": "…", "thumb_url": "…" } ]           // D2; tylko APPROVED, ≤12
}
// 404 — brak organizacji (w tym slugi k-…)
```

Odpowiedź zostaje wąska: bez `id`, `party_id`, statusów moderacji i identyfikatorów przesyłających.

### 8.2 `GET /api/organizations/mine` (READ) i odpowiedzi PATCH

`OrganizationResponse` = dotychczasowe pola (`id`, `party_id`, `name`, `slug`, `primary_color`, `accent_color`, `created_at`, `updated_at`) + `palette_preset`, `page_layout` (A2) + `tagline`, `bio`, `location`, `links` (C). `page_layout` zwraca **zapisany** klucz; publiczny endpoint zwraca klucz **efektywny** (od E mogą się różnić).

### 8.3 `PATCH /api/organizations/{id}` (EDIT, wiersz 50, właściciel)

```jsonc
// Request — każde pole opcjonalne; semantyka model_fields_set
{
  "name": "Rodzinny Grajdołek",          // null => 422
  "page_layout": "LINKS",                // null => 422; spoza PAGE_LAYOUT_KEYS => 422
  "palette_preset": "OCEAN" | null,      // spoza PALETTE_PRESET_KEYS => 422; null = brak presetu
  "primary_color": "#3498db" | null,     // ^#[0-9a-fA-F]{6}$; null = wyczyść
  "accent_color":  "#a9c24f" | null,
  "tagline": "…" | null,                 // C: ≤160, jedna linia, "" => null, check_text + ensure_no_contact_info
  "bio": "…" | null,                     // C: ≤2000, zwykły tekst, check_text
  "location": "…" | null,                // C: ≤120, check_text
  "links": [ { "kind": "WEBSITE", "url": "https://…" } ] | null   // C: ≤6, https, kind ∈ {WEBSITE, INSTAGRAM, FACEBOOK, TIKTOK, YOUTUBE}, allowlista hostów, bez duplikatów; [] => null
}
// 200 OrganizationResponse
// 403 nie właściciel · 409 StaleDataError (wyścig zapisów) · 422 walidacja / odrzucenie moderacji (komunikat z MESSAGES) · 503 moderacja niedostępna (fail closed)
```

- Pole **pominięte** zostaje bez zmian. **Jawny `null`** czyści pole (kolory, `palette_preset`, pola treści).
- Wszystkie kontrole (`check_text`) biegną **przed** jakąkolwiek mutacją, więc odrzucone bio nie zapisze połowicznie koloru.
- `extra="forbid"`; `str_strip_whitespace=True`.

### 8.4 `PublicCircleResponse.organizer_theme` (`GET /api/groups/public/{id}?term_id=`, PUBLIC)

```jsonc
{
  "id": "uuid", "name": "Orliki 2017", "organizer_display_name": "…", "organizer_slug": "akademia-orlik",
  "visibility": "PUBLIC" | "PRIVATE", "layout_mode": "PITCH", "term": { … } | null, "guardians": [ … ],
  "organizer_theme": {                       // NOWE (A1); null gdy organizator nie ma Organization (slug k-…)
    "primary_color": "#1b8168" | null,
    "accent_color": "#a9c24f" | null,
    "palette_preset": "OCEAN" | null         // dochodzi w A2 (w A1 zawsze null)
  } | null
}
```

Pole jest obecne także w zredukowanej odpowiedzi dla grup PRIVATE (branding to nie dane członków). Wyliczane z tego samego wiersza `Organization`, który rozwiązuje `organizer_slug`, więc nie dodaje zapytań. Strona terminu **nie** dostaje `page_layout`.

### 8.5 `GET /api/groups/public/organizers/{slug}` (NOWY, PUBLIC, zadanie B)

```jsonc
// 200 OrganizerPageResponse
{
  "circles": [                                    // ≤30; tylko PUBLIC, aktywne prowadzenie właściciela
    { "id": "uuid", "name": "Muzyczne Maluchy", "layout_mode": "CIRCLE",
      "next_term": { "id": "uuid", "occurs_on": "2026-10-12T16:30:00", "attendee_count": 7 } | null,
      "upcoming_term_count": 4 }                  // sort: next_term.occurs_on NULLS LAST, name
  ],
  "upcoming_terms": [                             // ≤10, okno 60 dni, occurs_on >= now, rosnąco
    { "term_id": "uuid", "group_id": "uuid", "group_name": "…", "occurs_on": "…",
      "description": "…" | null, "attendee_count": 7 }
  ],
  "exchange": {
    "counts": { "GIFT": 3, "SWAP": 4, "LEND": 0 },
    "items": [                                    // ≤12; AVAILABLE, uprawnieni do najbliższego terminu, zdjęcia APPROVED
      { "item_id": "uuid", "product_name": "…", "condition": "GOOD", "mode": "SWAP",
        "thumb_url": "https://cdn…/w400.webp" | null, "term_id": "uuid", "group_id": "uuid",
        "occurs_on": "…" }
    ]
  },
  "needed_items": [                               // następny termin na grupę PUBLIC; bez nazwisk deklarujących
    { "term_id": "uuid", "group_id": "uuid", "product_name": "Koc piknikowy", "claimed": false }
  ],
  "stats": { "circle_count": 3, "upcoming_term_count": 9, "family_count": 32 | null }   // null gdy < 3
}
// 404 — slug nie rozwiązuje organizacji (w tym k-…) albo organizacja nie ma właściciela
```

Żadnych nazwisk: brak opiekunów, `lister_display_name`, `lister_party_id`, `claimed_by_*` i danych dzieci. Front buduje linki `/${slug}/grupa/${group_id}/term/${term_id}` (slug zwalidowany, bo rozwiązał organizację).

### 8.6 `GET /api/groups/public/organizers/{slug}/terms?page=1&size=20&group_id=` (NOWY, PUBLIC, zadanie B)

```jsonc
// 200 Page[OrganizerTermResponse]  (app/core/pagination.py: strony od 1, size domyślnie 20, max 100)
{
  "items": [ { "term_id": "uuid", "group_id": "uuid", "group_name": "…", "occurs_on": "…",
               "description": "…" | null, "attendee_count": 7 } ],
  "total": 37, "page": 1, "size": 20
}
// sort: occurs_on ASC, id; te same filtry prywatności; bez okna 60 dni (agenda w przód)
// 404 jak wyżej; group_id spoza grup PUBLIC organizatora => pusty wynik (200), nie 422 — nie ujawniamy istnienia grupy
```

### 8.7 Media organizacji (zadanie D)

```jsonc
// POST /api/organizations/{id}/media?kind=LOGO|COVER|GALLERY   multipart: file   (EDIT, wiersz 50)
// 201 OrganizationMediaResponse
{ "id": "uuid", "kind": "LOGO", "url": "…", "thumb_url": "…",
  "status": "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED", "sort_order": 0 }
// 409: Spaces niedostępne („chwilowo niedostępne”) · duplikat SHA · limit galerii 12
// 413/422: rozmiar / format (jak avatar)

// GET /api/organizations/{id}/media            (READ, właściciel) -> [OrganizationMediaResponse]
//   najnowsze APPROVED + oczekujące z plakietką; URL-e presigned dla niezatwierdzonych

// DELETE /api/organizations/{id}/media/{media_id}   (EDIT — DELETE dodany do wiersza 50 w A2)
// 204

// PATCH /api/organizations/{id}/media/order        (EDIT)
{ "ids": ["uuid", "uuid", "…"] }                    // pełna lista GALLERY w nowej kolejności
// 200 [OrganizationMediaResponse]
```

Oczekujące LOGO/COVER nie zastępuje publicznie ostatniego zatwierdzonego (wariant B). Przy braku zatwierdzonego hero przechodzi na kolor primary z inicjałami.

---

## 9. Przepływy danych

### 9.1 Strona organizatora `/:slug`

```
Przeglądarka                         API
  |-- GET /organizations/public/{slug} ------------> organizations (1 zapytanie + media od D)
  |-- GET /groups/public/organizers/{slug} --------> groups.organizer_page (~12 stałych zapytań)
  |       (równolegle; drugie nie bramkuje malowania)
  v
useOrganizerPageData = { organization, directory, directoryStatus }
  -> OrganizerThemeScope(resolveOrgTheme(org | draft))      // motyw z PIERWSZEGO payloadu: zero FOUC
  -> LayoutRenderer(resolveLayout(org.page_layout | draft), data, mode)
       bloki katalogu: szkielet -> dane | ukryte (404/błąd => "unavailable")
  -> [właściciel && ?edit=1] EditorSheet
```

- Do czasu odpowiedzi organizacji renderuje się neutralny szkielet (paleta domyślna, bez treści), więc nie ma mignięcia złej palety.
- 404 organizacji → istniejący stan „nie znaleziono” w palecie domyślnej.
- W A2 (przed B) `useOrganizerPage` nie istnieje; `directory = null`, a CLASSIC/LINKS degradują się do bloków z danych organizacji.

### 9.2 Strona terminu `/:slug/grupa/:groupId/term/:termId`

```
GET /groups/public/{groupId}?term_id=… -> PublicCircleResponse (+organizer_theme z wiersza Organization)
TermPage -> OrganizerThemeScope(resolveOrgTheme(circle.organizer_theme))
         -> KragStage (.kg-* na --color-*) -> PublicTermView | PrivateGroupGate (+ arkusze, toast w drzewie)
Link przedmiotu -> /${circle.organizer_slug}/produkt/${item_id}
```

Slug z URL **nie** decyduje o motywie strony terminu (byłby niezwalidowany). Struktura strony terminu się nie zmienia.

### 9.3 Strona produktu

```
Ze strony terminu:  /:slug/produkt/:id  (AuthGuard -> login z powrotem)
  OrganizerItemPage
    usePublicOrganization(slug)  (cache zwykle ciepły po stronie terminu)
       200 -> theme = org ; 404/błąd (np. k-…) -> theme = null (domyślna)
    OrganizerThemeScope(theme)  -> rama publiczna (stage + kolumna 430, bez PanelNavBar)
       -> ItemViewContent (useItemDetail, useItemHistory — bez zmian w API)
       -> ItemBackButton: history back | fallback "/:slug"
       -> "Edytuj" -> /:slug/produkt/:id/edit  (ItemEditPage z tym samym prefiksem; powrót też)
Z panelu/powiadomień: /product/:id -> PhoneFrame + PanelNavBar, paleta domyślna (bez zmian)
```

Slug w tej trasie jest **kosmetyczny**: wpływa tylko na kolory strony za logowaniem. Uprawnienia do odczytu przedmiotu są takie jak dziś (każdy zalogowany może czytać przedmiot po id; to zamierzone zachowanie).

### 9.4 Zapis w edytorze

```
EditorSheet (draft) --Zapisz--> useUpdateOrganization.mutateAsync(diff(draft, server))
   PATCH /organizations/{id}  { page_layout?, palette_preset?, primary_color?, accent_color? }
     service: owner check -> walidacja allowlist/hex -> (C: check_text wszystkich pól) -> mutacja
              -> commit (updated_at = version_id_col; konflikt => 409)
   <- 200 OrganizationResponse
 -> await invalidateQueries(["publicOrganization"]), (["myOrganization"])
 -> draft := dane serwera; arkusz pokazuje „Zapisano”
 błąd -> extractProblemMessage -> komunikat w arkuszu; draft zostaje
```

---

## 10. Punkty integracji

| Integracja | Kierunek | Szczegóły | Zadanie |
|---|---|---|---|
| `AUTHORIZATION_MATRIX` | — | (B) `(_methods("GET"), r"^/api/groups/public/organizers/[^/]+(/terms)?$", "PUBLIC")` obok wierszy `/api/groups/public/...` (l. 86/93), **przed** wierszem 26 `GET ^/api/groups(/.*)?$`; (A2) wiersz 50 → `_methods("POST", "PATCH", "DELETE")`. Testy: nowa ścieżka PUBLIC, `/api/groups/public/{uuid}` dalej PUBLIC, `DELETE /api/organizations/x` wymaga EDIT | A2, B |
| `organizations_acl` | `groups → organizations` | `get_organizer_theme` (A1), `get_organization_by_slug`, `get_owner_party_id` (B). Jedyny moduł `groups` importujący `organizations` | A1, B |
| `circulation_bridge`, `product_bridge` | `groups → circulation/product` | nowe funkcje wsadowe; istniejące pomocniki per przedmiot z `term_item_listings.py` **nie** są używane | B |
| `RESERVED_SLUGS` | — | `"produkt"` | A1 |
| `public_preview.py` (OG) | — | `og:description` z `tagline` (C); `og:image` z okładki, `twitter:card summary_large_image`, `<meta name="theme-color">` (D2) | C, D2 |
| Moderacja tekstu | sync | `check_text(ORGANIZATION_TAGLINE/BIO/LOCATION, new, current)`; fail closed 503 | C |
| Moderacja zdjęć | async | `ModerationSubjectType.ORGANIZATION_MEDIA`; union w `list_photos`, `decide`, `delete_upload`, `Literal` w schemacie, etykieta „Organizacja” w adminie | D |
| group-thing-ai (VPS B) | cron → DB | `Subject` w `photo_store.py`, granty w `moderation_db_role.sql`, `test_deploy_artifacts.py`. Kolejność wdrożenia: migracja → granty → cron | D |
| DO Spaces | app → S3 | klucze `organizations/{org_id}/{media_id}`; prywatne do akceptacji; bez Spaces upload = 409 | D |
| Cache TanStack | FE | prefiksy `publicOrganization`, `myOrganization`, `organizerPage`, `organizerTerms`; mutacje unieważniają cały prefiks | A2, B |

---

## 11. Plan migracji Alembic

Ostatnia migracja w repo: **`0051_profile_avatars`** (`src/backend/alembic/versions/`). Numery przydzielane są przy scaleniu (A2 i B-backend idą równolegle, a B może nie potrzebować migracji). Wzorce: `0035_group_layout_mode` (kolumna z trwałym `server_default`, jeden krok `add_column`), `0050_user_profile_bio` (kolumna tekstowa), `0051_profile_avatars` (tabela moderowana z indeksem częściowym crona). Standardy: `migrations.md` (odwracalne, małe, review autogenerate), `models.md` (`BaseEntity`, enumy jako stringi, `lazy="raise"`).

| # | Plik | Zadanie | `upgrade()` | `downgrade()` | Uwagi |
|---|---|---|---|---|---|
| — | brak | A1 | — | — | `organizer_theme` korzysta z istniejących `primary_color`/`accent_color` |
| 0052 | `0052_organization_page_layout.py` | A2 | `add_column("organizations", Column("page_layout", String(64), nullable=False, server_default="CLASSIC"))`; `add_column("organizations", Column("palette_preset", String(40), nullable=True))` | `drop_column` × 2 | `server_default` zostaje na stałe (stała, zawsze sensowna wartość, jak 0035). **Bez** CHECK i bez natywnego enuma: allowlista w kodzie (`page_layouts.py`, `palettes.py`), bo przyszłe klucze `custom:<uuid>` nie mogą wymagać migracji. Model: `Mapped[str] = mapped_column(String(64), nullable=False, server_default="CLASSIC")` |
| (0053?) | `00NN_terms_circle_occurs_on_index.py` | B (warunkowo) | `create_index("ix_terms_circle_group_id_occurs_on", "terms", ["circle_group_id", "occurs_on"])` | `drop_index` | **Tylko jeśli** `EXPLAIN ANALYZE` zapytań 5–6 i `/terms` pokaże potrzebę. Dziś istnieje tylko `ix_terms_circle_group_id`. Bez spekulacji |
| 0053 | `0053_organization_content.py` | C | `add_column`: `tagline String(160) NULL`, `bio String(2000) NULL`, `location String(120) NULL`, `links postgresql.JSONB NULL` | `drop_column` × 4 | Kształt `links` waliduje Pydantic (`list[OrganizationLink]`, ≤6), nie DB. Kolumny zamiast tabeli profilu (precedens `user_profiles.bio`, 0050) |
| 0054 | `0054_organization_media.py` | D | `create_table("organization_media", id UUID PK, organization_id UUID FK organizations.id NOT NULL, kind String(10) NOT NULL, storage_key String(200) NOT NULL, width/height/size_bytes Integer NOT NULL, content_sha256 String(64) NOT NULL, status String(20) NOT NULL, sort_order Integer NOT NULL server_default 0, uploaded_by_user_id UUID FK users.id NOT NULL, moderation_attempts Integer NOT NULL server_default 0, moderation_retry_at TIMESTAMP NULL, created_at/updated_at NOT NULL)`; `UNIQUE(organization_id, content_sha256)`; `INDEX ix_organization_media_org_kind_status`; indeks częściowy `ix_organization_media_pending_created_at (created_at, id) WHERE status='PENDING'`; indeks częściowy unikalny `(organization_id, kind) WHERE status IN ('PENDING','NEEDS_REVIEW') AND kind <> 'GALLERY'` | `drop_index` × 3, `drop_table` | Kolumny dla crona **identyczne** z `profile_avatars` (0051). UUID PK = `subject_id` moderacji (jak 0051, carve-out względem `BaseEntity` id-sekwencji — sprawdzić w `models.md` przy specyfikacji). Docstring migracji: „po upgrade uruchom `moderation_db_role.sql`; przed downgrade zatrzymaj cron” |
| (E) | `00NN_organization_entitlements.py` | E (później) | `create_table("organization_entitlements", id BIGINT seq PK (BaseEntity), organization_id FK, kind String(20), key String(64), source String(20), valid_from, valid_to NULL, external_ref NULL, created_at, updated_at)`; indeks `(organization_id, valid_to)` | `drop_table` | Poza zakresem tej funkcji; pokazane, by udowodnić addytywność szwu |

Kolejność wdrożenia D: **(1)** migracja 0054 w group-thing-app → **(2)** ponowne uruchomienie `moderation_db_role.sql` → **(3)** wdrożenie crona na VPS B. Do kroku 3 wiersze czekają w PENDING (fail closed).

---

## 12. Podział zadań

```
A1 Motyw ──► A2 Układ + edytor (CLASSIC, LINKS) ──┬──► C Treść ──► D Media (2 repo) ──► D2 Galeria/OG ──► E (później)
                                                  │                                     ▲
B-backend (równolegle z A1/A2) ───────────────────┴──► B-frontend (SCHEDULE, CIRCLES, EXCHANGE)
```

| Zadanie | Zawartość | Zależy od | Rozmiar | Kryteria akceptacji |
|---|---|---|---|---|
| **A1 Motyw** | Tokeny ról + `@theme static` + aliasy przejściowe; migracja `KragStage` (kolejność: `.kg-*` → zależne komponenty → usunięcie `:root`); tokenizacja ~14 miejsc motywowanych + stałych; poprawki kontrastu domyślnej palety (X1), ikona ink na teal, danger (X5), `box-sizing` (X4); `orgPalette.ts`, `resolveOrgTheme`, `OrganizerThemeScope`; `organizer_theme` w `PublicCircleResponse`; trasa `/:slug/produkt/:id[/edit]` w ramie publicznej + `"produkt"` w `RESERVED_SLUGS`; `usePublicOrganization` | — | M | (1) Strona terminu organizatora z `primary_color` ma CTA, legendę i szprychy w jego kolorze; organizator bez koloru wygląda jak dziś (poza zamierzonymi poprawkami kontrastu, zrzuty przed/po). (2) `grep` nie znajduje hexów w klasach arbitralnych/`stroke=`/`c=` na stronach terminu, produktu i organizatora (poza listą stałych ilustracji). (3) Testy jednostkowe generatora: 9 kolorów testowych (w tym `#ffffff`, `#000000`, `#f1c40f`, `#ff69b4`) spełniają 4,5:1 dla tekstu i 3:1 dla fokusu. (4) Po wejściu na termin i powrocie do panelu żadne style nie wyciekają (brak globalnego `:root` KragStage). (5) `/akademia-orlik/produkt/<id>` pokazuje przedmiot w palecie organizatora, za logowaniem; `/k-abc/produkt/<id>` w domyślnej; Edytuj i Wróć zachowują prefiks. (6) Test ręczny w Firefox i Safari (G-a) |
| **A2 Układ + edytor** | Migracja 0052; `page_layouts.py` (+`resolve_page_layout` jako jedyne miejsce), `palettes.py`; PATCH `model_fields_set`; rozszerzone odpowiedzi; DELETE w wierszu 50 (P3); rejestr, `LayoutRenderer`, bloki A2, CLASSIC + LINKS; 8–12 presetów; `EditorSheet` (Układ/Kolory, mini-karty, Zapisz/Anuluj); wejścia z `AccountMenu` i `HomeView`; hooki TanStack zamiast `useState`+`useEffect` (X6) | A1 | M–L | (1) Właściciel na `/:slug?edit=1` przełącza układ i paletę, a strona pod arkuszem zmienia się natychmiast; „Anuluj” przywraca stan. (2) „Zapisz” utrwala wybór; odświeżenie i inna przeglądarka pokazują nowy wygląd. (3) PATCH: pominięte pole bez zmian, `null` czyści kolor, `name: null` i `page_layout: null` → 422, nieznany klucz → 422. (4) Nieznany `page_layout` w bazie renderuje CLASSIC. (5) Nie-właściciel z `?edit=1` widzi zwykłą stronę. (6) Każdy preset przechodzi test kontrastu; zbiory kluczy FE/BE są równe (test). (7) `DELETE /api/organizations/...` bez uprawnień EDIT → 403 |
| **B-backend** | ACL (`get_organization_by_slug`, `get_owner_party_id`); `organizer_page.py`; 2 trasy; wiersz macierzy; funkcje wsadowe; ewentualny indeks (warunkowo) | — (równolegle z A) | M | (1) Grupy PRIVATE nie pojawiają się w żadnej postaci. (2) Odpowiedź nie zawiera nazwisk ani `party_id` (test na kluczach JSON). (3) `family_count` = `null` dla <3 rodzin. (4) Liczba zapytań jednakowa dla 1 i 5 grup (licznik `before_cursor_execute`). (5) Limity 30/10/12 i okno 60 dni egzekwowane w SQL. (6) Slug `k-…` → 404. (7) Testy macierzy autoryzacji (nowy wiersz + regresja) |
| **B-frontend** | `useOrganizerPage`, `useOrganizerTerms` (infinite), `useOrganizerPageData`; bloki B; SCHEDULE, CIRCLES (+`featured`), EXCHANGE; „Polecany”; klucze w allowliście BE | A2, B-backend | M | (1) Picker pokazuje 5 układów; „Polecany” zgodny z regułami. (2) CIRCLES z 1 grupą PUBLIC renderuje `featured` z anonimowymi miejscami. (3) SCHEDULE „Pokaż kolejne tygodnie” dociąga stronę `/terms`. (4) EXCHANGE: karta przedmiotu bez nazwiska, link na termin. (5) Błąd/404 katalogu nie psuje strony (bloki znikają) |
| **C Treść** | Migracja 0053; `TextField` + `MESSAGES` (×3); parametryzowany komunikat danych kontaktowych (tylko `tagline`); `links` (allowlista WWW + social, https); PATCH i odpowiedzi; zakładka „Treść” (tekst); `og:description` | A2 | S–M | (1) Odrzucone bio → 422 z komunikatem pola; kolor wysłany w tym samym PATCH **nie** zostaje zapisany. (2) `null` czyści pole. (3) Link `http://` lub spoza allowlisty → 422; render `rel="nofollow noopener ugc"`. (4) Telefon w taglinie → 422; w bio dozwolony. (5) Niedostępny Bielik → 503, nic nie zapisane |
| **D Media** | Migracja 0054; trasy upload/list/delete/reorder; wariant B; moderacja (union/decide/delete/admin); hero z logo/okładką; **group-thing-ai**: `Subject`, granty, test | C (zakładka „Treść”), Spaces | M | (1) Nowe logo czeka w PENDING; publicznie widać poprzednie zatwierdzone. (2) Po akceptacji crona nowe logo jest publiczne. (3) Duplikat → 409; 13. zdjęcie galerii → 409. (4) Admin widzi „Organizacja” w kolejce. (5) Wdrożenie wg kolejności; bez grantów cron nie startuje (self-check), wiersze nie przechodzą bez kontroli |
| **D2 Galeria i OG** | Blok `gallery`; `og:image`, `twitter:card`; `<meta name="theme-color">` z `primary` | B, D | S | (1) Galeria w CLASSIC pokazuje tylko APPROVED, ≤12. (2) Podgląd linku w komunikatorze ma okładkę. (3) `theme-color` odpowiada palecie organizatora |
| **E Monetyzacja (później)** | `organization_entitlements`, `effective_layout()` opakowujące `resolve_page_layout`, `tier` w rejestrze, SHOWCASE, „Odblokuj” na wersji roboczej, baner downgrade'u, billing | A2, D2 | M+ | (osobna specyfikacja) |

---

## 13. Decyzje projektowe

| ADR | Decyzja | Status |
|---|---|---|
| [ADR-001](decision-log.md#adr-001) | Mechanizm motywu: `OrganizerThemeScope` z 13 tokenami ról inline | Accepted |
| [ADR-002](decision-log.md#adr-002) | Model kolorów: presety + „Własny”, generator `orgPalette.ts`, backend tylko hex | Accepted |
| [ADR-003](decision-log.md#adr-003) | Przechowywanie: `page_layout VARCHAR(64)`, `palette_preset VARCHAR(40)`, allowlista w kodzie | Accepted |
| [ADR-004](decision-log.md#adr-004) | Deklaratywny rejestr + `LayoutRenderer` bez `Component`/`minData`/`tier` | Accepted |
| [ADR-005](decision-log.md#adr-005) | Zestaw układów CLASSIC/SCHEDULE/CIRCLES/LINKS/EXCHANGE | Accepted |
| [ADR-006](decision-log.md#adr-006) | Katalog w `groups`, tylko PUBLIC, limity, bez nazwisk | Accepted |
| [ADR-007](decision-log.md#adr-007) | Motyw terminu z `organizer_theme` w payloadzie | Accepted |
| [ADR-008](decision-log.md#adr-008) | Edytor inline w arkuszu, jawny zapis | Accepted |
| [ADR-009](decision-log.md#adr-009) | Produkt: trasa `/:slug/produkt/:id` | Accepted |
| [ADR-010](decision-log.md#adr-010) | Tylko szew pod płatne układy; kierunek: abonament + usługa | Accepted |
| [ADR-011](decision-log.md#adr-011) | PATCH z `model_fields_set` (jawny `null` = reset) | Accepted |
| [ADR-012](decision-log.md#adr-012) | Podział zadań A1 → A2 ∥ B → C → D → D2 | Accepted |
| [ADR-013](decision-log.md#adr-013) | Etapowanie treści i mediów C → D → D2 | Accepted |
| [ADR-014](decision-log.md#adr-014) | Granice motywu: chrom neutralny, bez trybu ciemnego, stałe awatary | Accepted |

---

## 14. Przykłady konkretne (Specification by Example)

**Przykład 1 — kolor marki z korektą (A1 + A2).**
- *Dane:* organizatorka „Rodzinny Grajdołek” ma CLASSIC i paletę domyślną.
- *Gdy:* na `/rodzinny-grajdolek?edit=1` w zakładce „Kolory” wybiera „Własny” i wpisuje `#3498db`.
- *Wtedy:* strona pod arkuszem natychmiast przechodzi na primary `#047cbe` z białym tekstem (4,53:1), a arkusz pokazuje „Lekko przyciemniliśmy kolor…”. Po „Zapisz” PATCH wysyła `{palette_preset: null, primary_color: "#3498db"}`. Strona terminu jej grupy pokazuje CTA „Zapisz się” w `#047cbe`. Strona `/rodzinny-grajdolek/produkt/<id>` (wejście z listy na terminie) pokazuje pigułkę „Dostępna” w `primary-fg` `#006fab`. `/product/<id>` z panelu zostaje w palecie domyślnej.

**Przykład 2 — trener z jedną grupą PUBLIC i dwiema PRIVATE (B).**
- *Dane:* „Akademia Orlik” prowadzi „Orliki 2017” (PUBLIC, 9 zapisanych na najbliższy trening) oraz dwie grupy PRIVATE; członkowie grupy PUBLIC to 2 rodziny.
- *Gdy:* anonimowy odwiedzający otwiera `/akademia-orlik`, a organizator wybrał CIRCLES.
- *Wtedy:* `GET /api/groups/public/organizers/akademia-orlik` zwraca `circles` z jedną grupą, `stats.family_count: null` i żadnych nazw grup PRIVATE. Renderer wybiera `circles-grid:featured` + `circle-visual:mini` (9 anonimowych miejsc wokół organizatora). Odznaka „Polecany” nie trafia do CIRCLES, bo reguła wymaga ≥2 grup; przy ≥4 treningach w 14 dni dostaje ją SCHEDULE.

**Przykład 3 — organizator bez danych, edycja i duchy (A2).**
- *Dane:* nowa organizacja ma tylko nazwę; zadanie C jeszcze nie wdrożone.
- *Gdy:* właściciel wchodzi z `AccountMenu` „Moja organizacja” → `/nowa-org?edit=1`.
- *Wtedy:* picker pokazuje CLASSIC i LINKS, z „Polecany” przy LINKS. W CLASSIC pod arkuszem widać kolorowy hero, „Udostępnij”, stopkę i ducha „Dodaj opis”. Odwiedzający w tym samym czasie widzi tylko hero, „Udostępnij” i stopkę (bez duchów).

**Przykład 4 — degradacja nieznanego klucza (A2/E).**
- *Dane:* w bazie `page_layout = "custom:7f3c…"`, a rejestr frontendu go nie zna (np. wycofany).
- *Gdy:* odwiedzający otwiera stronę.
- *Wtedy:* `resolveLayout` zwraca CLASSIC w palecie organizatora; strona nie znika, a zapisany klucz pozostaje bez zmian.

---

## 15. Ryzyka i mitygacje

| # | Ryzyko | Wpływ | Prawdop. | Mitygacja |
|---|---|---|---|---|
| R1 | Usunięcie `:root` z `KragStage` przed migracją zależnych komponentów | tekst bez koloru na stronie terminu | wysokie przy złej kolejności | kolejność z A1; grep `var(--ink`/`--mint`/`--paper`/`--cream` jako kryterium akceptacji |
| R2 | Tokeny usunięte przez tree-shaking Tailwinda | brakujące kolory w KragStage i inline | średnie | `@theme static` dla stałych; 13 liści zawsze inline |
| R3 | Pominięte hexy („zielone wyspy”) | niespójny wygląd w obcej palecie | średnie | inwentarz z `deep-colors` §3 + grep w CI (propozycja standardu) |
| R4 | Kontrast koloru „Własny” | naruszenie WCAG | niskie | generator + testy na 9 kolorach; presety jako sprawdzone mapy |
| R5 | Zmiana domyślnego wyglądu przez poprawki kontrastu | zauważalne różnice | pewne | świadoma decyzja; zrzuty przed/po w PR A1 |
| R6 | `transform`/`contain` na elemencie zakresu | rozjechane arkusze `fixed` | niskie | reguła + komentarz w komponencie + test (brak tych stylów) |
| R7 | Układy puste przy skąpych danych | słabe pierwsze wrażenie | wysokie | CLASSIC + LINKS najpierw, „Polecany”, duchy, `featured` |
| R8 | Wyciek prywatności w katalogu | RODO, zaufanie rodziców | średnie | reguły z §8.5; testy kluczy JSON i PRIVATE |
| R9 | N+1 w modelu odczytu | wydajność | średnie | stały plan ~12 zapytań + test licznika |
| R10 | Kolejność wdrożenia zdjęć w dwóch repo | cron się wyłącza / zdjęcia w PENDING | średnie | migracja → granty → cron; docstring migracji; fail closed |
| R11 | Długa weryfikacja logo/okładki | strona bez obrazu | średnie | wariant B (ostatnie zatwierdzone zostaje) |
| R12 | Pomylenie `page_layout` z `layout_mode` | błędy, dezorientacja | średnie | różne nazwy i etykiety („Układ strony” vs „Szablon wizualizacji”) |
| R13 | Trasa `/:slug/produkt/:id` — dwa URL-e tego samego przedmiotu, kolizja z przyszłym slugiem | mylące linki, cień trasy | niskie | `"produkt"` w `RESERVED_SLUGS`; wspólny `ItemViewContent`; `useItemRoutes` jako jedno źródło ścieżek |
| R14 | Arkusz zasłania stronę w kolumnie 430px | gorszy podgląd | średnie | zwijany uchwyt; arkusz ~55%; mini-karty dla terminu/produktu |
| R15 | Rozjazd allowlist FE/BE (układy, presety) | 422 przy zapisie albo nieużywane klucze | niskie | test zgodności zbiorów kluczy po obu stronach |
| R16 | Firefox/Safari nietestowane (G-a) | różnice w `color-mix` gałęzi opacity | niskie | test ręczny jako kryterium A1 |

---

## 16. Poza zakresem

- **Billing i sprzedaż** (Stripe/P24, BLIK cykliczny, windykacja, konsultacja prawna), `organization_entitlements`, `effective_layout()`, `tier`, katalog `GET /api/organizations/layouts`, „Odblokuj”, SHOWCASE — zadanie E (odroczone D4–D6).
- **Zmiana struktury** strony terminu i produktu (tylko kolory).
- **`?term=`** na produkcie, „← wróć do terminu”, motyw w linkach z powiadomień (D1).
- **Publiczna strona produktu** bez logowania (D11). Uprawnienia odczytu przedmiotu zostają bez zmian (zamierzone).
- **Grupy PRIVATE** na stronie organizatora, teaser lub „Poproś o dołączenie” (D9).
- **Pojemność, miejsce, tytuł terminu** („zostały 2 miejsca”) (D10).
- **Tryb ciemny** (D12), paleta awatarów z primary (D13), P3/APCA (D16).
- **Mini-rendery** układów w pickerze (D2) i **szerokie warianty desktopowe** (D3).
- **`theme_settings` JSONB**, tabela `page_layouts`, edytor układów (D7, D8).
- **Linki EMAIL/PHONE**, podpisy zdjęć galerii, opinie (D14, D15).
- **Aktualizacja `architecture.md`/`tech-stack.md`** (D18) i propozycje standardów (D17) — osobno, przez `/maister:standards-update`.

---

## 17. Kryteria sukcesu

1. **Kontrast:** każda para tekst/tło na trzech stronach spełnia WCAG AA (4,5:1 tekst, 3:1 fokus i ikony) dla palety domyślnej, wszystkich presetów i 9 kolorów testowych „Własny” (testy automatyczne).
2. **Izolacja motywu:** zmiana palety organizatora nie zmienia ani jednego piksela w panelu, adminie i chromie platformy; strona terminu nie wycieka stylów globalnych.
3. **Zero FOUC:** pierwsze pomalowanie strony organizatora, terminu i produktu (z prefiksem) odbywa się już w palecie organizatora.
4. **Odporność:** nieznany klucz układu lub presetu, brak katalogu (404/błąd) ani brak danych nigdy nie dają pustej lub zepsutej strony; minimum to hero + „Udostępnij” + stopka.
5. **Prywatność i wydajność katalogu:** zero grup PRIVATE i nazwisk w odpowiedzi; stała liczba zapytań (~12) niezależnie od liczby grup.
6. **Łatwość edycji:** organizator zmienia układ i kolory w ≤3 dotknięciach + „Zapisz”, widząc wynik na własnej stronie przed zapisem.
7. **Addytywność płatnych układów:** zadanie E nie wymaga zmiany typu kolumny, schematu URL ani zapisanych danych.

---

## 18. Otwarte pytania (pozostałe)

| # | Pytanie | Kiedy rozstrzygnąć | Domyślna odpowiedź projektu |
|---|---|---|---|
| Q1 | Ostateczna lista i nazwy presetów (8 czy 12) i strojenie stałych generatora (G-b) | A2 (z projektantem / zrzuty) | 10 presetów z §5.2 |
| Q2 | Segment edycji w trasie zagnieżdżonej: `/edit` (jak `/product/:id/edit`) czy polski `/edycja` | A1 | `/edit` (spójność z istniejącą trasą) |
| Q3 | Czy rama publiczna produktu reużywa `PhoneFrame` bez `PanelNavBar`, czy wydzielamy wspólny `PublicColumnFrame` z `KragStage` | A1 (specyfikacja) | wspólna rama kolumny 430px na tokenach `stage` |
| Q4 | Kopie odznaki „Polecany” i opisów „dla kogo”; progi reguł | A2/B-FE | reguły z §6.3 |
| Q5 | Czy `family_count` liczyć także z jednorazowych zapisów (D-P3) | B | tylko członkowie |
| Q6 | Czy indeks `(circle_group_id, occurs_on)` jest potrzebny | B (EXPLAIN) | nie, dopóki pomiar nie pokaże |
| Q7 | Kolor „Własny” jako funkcja płatna w „Organizator Pro” | E | darmowy do czasu E |
| Q8 | Cena abonamentu (19–29 PLN), polityka downgrade (~14 dni), cena usługi układu na zamówienie, kwestie prawne PL/UE | E (biznes + prawnik) | kierunek z ADR-010 |
| Q9 | UUID PK `organization_media` vs `BaseEntity` (sekwencja) — potwierdzić carve-out w `models.md` | D | UUID jak `profile_avatars` (kontrakt crona) |
| Q10 | Czy link do produktu w EXCHANGE (karta przedmiotu) ma prowadzić na termin (obecnie) czy na `/:slug/produkt/:id` | B-FE | na termin (akcje i bramki logowania są tam) |
