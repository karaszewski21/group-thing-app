# Raport badawczy: Strona organizatora — 5 układów + paleta kolorów (wersja 2, po pogłębieniach)

**Typ badania:** mieszane (analiza kodu, wymagania, przegląd literatury i platform SaaS)
**Data:** 2026-10-07
**Opracowanie:** research-synthesizer (maister) na podstawie 17 plików findings (13 z pierwszego przebiegu + 4 pogłębienia: `deep-layouts`, `deep-content`, `deep-colors`, `deep-product-monetization`)
**Ścieżka zadania:** `.maister/tasks/research/2026-10-07-organizer-page-layouts-theming/`

> **Co się zmieniło względem wersji 1:**
> - Mechanizm motywu został zweryfikowany empirycznie: kompilacją Tailwinda z repo i testem w Chromium.
> - Odcienie liczy generator w JS (`orgPalette.ts`). `color-mix` nie jest już opcją główną.
> - Jest pełna lista kolorów na sztywno. Portali w kodzie nie ma, więc luka G1 jest zamknięta.
> - `EXCHANGE` to teraz tablica przedmiotów ze zdjęciami.
> - `SCHEDULE` ma etykietę „Plan zajęć”, a `CIRCLES` dostał wariant „wyróżniona grupa”.
> - Powstała biblioteka 17 bloków i kontrakt rejestru `PageLayoutDefinition`.
> - Publiczny endpoint należy do modułu `groups`, a nie `organizations`.
> - Zaprojektowano przechowywanie treści i zdjęć razem z moderacją.
> - Jest model monetyzacji z podziałem „teraz / później” oraz podział na zadania A/B/C/D/D2.

---

## Spis treści

1. Podsumowanie
2. Cele i zakres
3. Metodologia
4. Stan obecny (skrót z cytatami)
5. Mechanizm motywu (zweryfikowany)
6. Zestaw tokenów
7. Generator kolorów
8. Migracja kolorów na sztywno
9. Układy: zasady, biblioteka bloków, 5 układów z makietami, rejestr
10. Przechowywanie danych i migracje
11. Publiczny endpoint strony organizatora
12. Motyw na stronie terminu
13. Edytor (UX)
14. Strona produktu — decyzja o kolorach
15. Monetyzacja: model oraz „budujemy teraz / później”
16. Podział na zadania (A/B/C/D/D2) i zależności
17. Ryzyka
18. Wnioski i odpowiedź na pytanie badawcze
19. Otwarte decyzje (skonsolidowane)
20. Znalezione problemy poza zakresem
21. Załączniki

---

## 1. Podsumowanie

**Co badano.** Publiczna strona organizatora (`/:organizationSlug`): organizator wybiera 1 z 5 układów i paletę kolorów. Paleta przebarwia też stronę terminu (`/:slug/grupa/:groupId/term/:termId`) i stronę produktu (`/product/:id`), które mają stały układ. Do tego potrzebny jest prosty edytor i architektura gotowa na płatne układy.

**Najważniejsze ustalenia.**

1. **Mechanizm motywu działa, co sprawdzono empirycznie** (`deep-colors` §1–2).
   - Utility Tailwind v4 z repo kompilują się do `var(--color-*)` w miejscu użycia, także z modyfikatorami przezroczystości.
   - Nadpisanie zmiennych na elemencie-opakowaniu przebarwia całe poddrzewo.
   - Pułapka: zmienna zdefiniowana przez `var()` na `:root` „zamarza” na `:root`. Dotyczy to zwykłego `@theme` i aliasów `KragStage`.
   - Dlatego **wszystkie 13 tokenów, które da się motywować, liczymy w JS i ustawiamy inline** na `OrganizerThemeScope`.
2. **W `src/` nie ma portali** (`deep-colors` §4). Wszystkie arkusze i toasty dziedziczą motyw, jeśli zakres jest zamontowany na poziomie strony.
3. **Generator kolorów piszemy sami.** `src/theme/orgPalette.ts` waży około 0,9 KB gz; dla porównania `culori/fn` to 6,8 KB, a pełne `culori` 15,7 KB. Generator gwarantuje WCAG AA dla dowolnego koloru wejściowego: sprawdzono 9 kolorów, w tym biały, czarny, żółty i różowy.
4. **Domyślna paleta już dziś nie spełnia kontrastu w kilku parach.** Opis w §20.
5. **Wąskim gardłem są dane, nie renderowanie.**
   - `Organization` nie ma treści.
   - `Group` nie ma opisu ani pojemności.
   - `Term` nie ma tytułu, miejsca ani limitu miejsc.
   - Brakuje publicznego endpointu z grupami i terminami organizatora.
6. **Pięć układów** (`deep-layouts`):
   - `CLASSIC` „Klasyczny”;
   - `SCHEDULE` „Plan zajęć”;
   - `CIRCLES` „Grupy”, z wariantem `featured`, gdy organizator ma jedną grupę;
   - `LINKS` „Wizytówka”;
   - `EXCHANGE` „Wymiana”, czyli tablica przedmiotów ze zdjęciami.

   Wszystkie budujemy ze wspólnej biblioteki 17 bloków za rejestrem `PageLayoutDefinition`.
7. **Treść i zdjęcia** (`deep-content`):
   - teksty to kolumny moderowane synchronicznie przez `check_text`;
   - linki to jedna kolumna JSONB;
   - zdjęcia trafiają do nowej tabeli `organization_media`, którą obsługuje istniejący cron moderacji na VPS B (zmiana w dwóch repo).
8. **Publiczny endpoint** `GET /api/groups/public/organizers/{slug}`:
   - należy do modułu `groups`, żeby uniknąć cyklu importów;
   - zwraca tylko grupy PUBLIC, bez nazwisk;
   - ma limity w SQL i stałą liczbę zapytań (~12).
9. **Strona produktu:** kolory bierzemy z `?org=` w linkach ze strony terminu. Strona produktu zostaje za logowaniem.
10. **Monetyzacja:** jeden abonament „Organizator Pro” za około 19–29 PLN netto miesięcznie. Teraz budujemy tylko „szew” w danych; uprawnienia (entitlements) dodamy później.

**Ogólny poziom pewności:**
- wysoki: mechanizm, przechowywanie, umiejscowienie endpointu, ścieżka moderacji;
- średnio-wysoki: tokeny, edytor, kontekst produktu;
- średni: persony układów, limity, progi prywatności;
- nisko-średni: cena, downgrade, kwestie prawne.

---

## 2. Cele i zakres

**Pytanie główne.** Jak zaprojektować stronę organizatora z 5 układami i paletą kolorów, która obowiązuje też na stronie terminu i produktu? Dochodzi łatwy edytor i gotowość na płatne układy.

**Pytania pomocnicze:**
- SQ1: strony i komponenty;
- SQ2: kontekst organizatora na stronie terminu i produktu;
- SQ3: przechowywanie;
- SQ4: mechanizm motywu, generowanie kolorów i kontrast;
- SQ5: bloki i układy;
- SQ6: edytor;
- SQ7: płatne układy;
- SQ8: dostępność i brak mignięcia domyślnych kolorów (FOUC).

**Zakres.**
- W zakresie: stan obecny, model danych (motyw, treść, zdjęcia), publiczny model odczytu, mechanizm motywu, tokeny, 5 układów, edytor, kontekst produktu, model monetyzacji (bez integracji płatności).
- Poza zakresem: billing i bramka płatności, zmiana struktury stron terminu i produktu, tryb ciemny.

---

## 3. Metodologia

- **Pierwszy przebieg:** 13 plików findings. Kod frontendu i backendu (około 40 plików), standardy `.maister/docs`, 8 wcześniejszych zadań, mockupy, prototyp `ProfilMobilny.tsx`, dokumentacja Chakra, Tailwind, WCAG i platform SaaS.
- **Pogłębienia:** 4 pliki.
  - `deep-colors`: kompilacja `index.css` przez `@tailwindcss/node` 4.3.3 z repo; test `getComputedStyle` w Chromium 154 (Playwright); prototyp generatora; pomiar bundla w esbuild.
  - `deep-content`: odczyt kodu moderacji w obu repo (`group-thing-app`, `group-thing-ai`).
  - `deep-layouts`: dostępność danych dla każdego bloku, persony, test odrębności układów.
  - `deep-product-monetization`: wszystkie wejścia na `/product/:id`, cenniki (Bookero, Linktree, Carrd, Calendly, Shopify, Luma), Stripe Entitlements, prawo konsumenckie PL/UE.
- **Skala pewności:** Wysoka = zweryfikowane w kodzie albo empirycznie, z wielu źródeł. Średnia = jedno źródło lub wnioskowanie. Niska = źródła wtórne lub opinia projektowa.

---

## 4. Stan obecny (skrót z cytatami)

| Obszar | Stan | Źródło |
|---|---|---|
| `/:organizationSlug` | `PublicOrganizationPage`: jedna karta z nazwą. Nadpisuje inline tylko `--color-mint` i `--color-lime`. Dane przez `useState`+`useEffect` (łamie `data-fetching.md`) | `PublicOrganizationPage.tsx:16-43,64-85` |
| Strona terminu | `TermPage` → `KragStage` → `PublicTermView` / `PrivateGroupGate`. **Bez kolorów organizatora.** Slug w URL kosmetyczny | `router.tsx:122-135`, `TermPage.tsx:10-45` |
| Strona produktu | `ItemDetailPage` w ramie panelu (`PhoneFrame` + `PanelNavBar`), za `AuthGuard`. Payload bez grupy, terminu i organizatora | `router.tsx:114-117`, `api/items.ts:26-56` |
| Tokeny | Tailwind `@theme` (`index.css:22-42`) oraz osobny zestaw `KragStage` na globalnym `:root` (13 zmiennych) | `KragStage.tsx:7-12` |
| `Organization` | `party_id, name, slug, primary_color, accent_color` (CHECK hex). Brak treści | `organizations/models.py:53-89` |
| `Group` / `Term` | `Group`: `name, layout_mode, visibility`. `Term`: `occurs_on, description(2000)`. **Brak miejsca, pojemności i tytułu** | `groups/models.py:97-117,215-229` |
| Publiczne API | `GET /api/organizations/public/{slug}` (PUBLIC, wiersz 48). `GET /api/groups/public/{id}?term_id=` z `organizer_slug`, bez motywu | `organizations/router.py:31-39`, `groups/router/circles.py:112-131` |
| `PATCH /api/organizations/{id}` | `None` = bez zmian, więc kolorów nie da się wyczyścić | `schemas.py:44-52`, `service.py:130-149` |
| Moderacja | Tekst: synchroniczny Bielik `check_text`, odrzuca przy niedostępności (503). Zdjęcia: Spaces, prywatne do akceptacji, cron ShieldGemma na VPS B | `moderation/text_guard.py:66-87`, `group-thing-ai/app/photo_store.py:79-115` |
| Płatności i plany | Brak jakiejkolwiek koncepcji | grep `entitlement\|subscription\|premium\|billing\|tier` |
| Edytor | Kolory celowo usunięte z `/organization`, testy to egzekwują. `HomeView` obiecuje „Dodaj opis, kolory i logo”, ale nie ma ścieżki edycji | `OrganizationPage.test.tsx:78-98`, `HomeView.tsx:77-86` |

---

## 5. Mechanizm motywu (zweryfikowany)

### 5.1 Fakty empiryczne (`deep-colors` §1–2, pewność wysoka)

- `.bg-mint{background-color:var(--color-mint)}` (także w zbudowanym `dist`). Tak samo kompilują się `text-*`, `border-*`, `ring-*`, gradienty i `hover:`.
- `bg-mint/50` w gałęzi `@supports` używa `var()`, więc jest motywowalne. Wartość wpisana na sztywno trafia tylko do fallbacku dla przeglądarek bez `color-mix`.
- **Wartości na sztywno nie da się motywować:** arbitralny hex (`bg-[#1B8168]`), style inline, `stroke=` w SVG, propsy `c=` ikon.
- **Pułapka „zamarzania”** (test w Chromium):

| Przypadek | Gdzie zadeklarowane | Czy podąża za opakowaniem? |
|---|---|---|
| `--soft: color-mix(… var(--color-mint) …)` | `:root` | **Nie** |
| to samo | `.org-theme` | Tak |
| `oklch(from var(--color-mint) …)` | `.org-theme` | Tak |
| `--alias: var(--color-mint)` | `:root` | **Nie** |
| `--alias: var(--color-mint)` | `.org-theme` | Tak |

- **Tailwind usuwa nieużywane zmienne motywu.** `--color-mint-bright`, `--color-sage` i `--color-teal` nie trafiają na `:root`, jeśli żadna utility ich nie używa. Tokeny czytane z `KragStage` lub stylów inline mogą więc nie istnieć. Rozwiązanie: `@theme static`.
- Arkusz `KragStage` nie jest w żadnej warstwie (unlayered), więc wygrywa z każdą utility Tailwinda.

### 5.2 Decyzja

**Rozwiązanie:** komponent **`OrganizerThemeScope`** renderuje element z inline `style` zawierającym **13 tokenów-liści** (§6), policzonych przez `buildOrgThemeVars()` w `useMemo` (czysta, synchroniczna funkcja, więc już pierwszy render jest pokolorowany).

**Tokeny stałe:**
- zostają na `:root` i są zadeklarowane jako `@theme static`;
- nic pochodnego nie jest deklarowane na `:root`.

**Odrzucone opcje:**
- Chakra `colorPalette` (te strony nie używają Chakry);
- zagnieżdżony `ChakraProvider`;
- hexy inline;
- odcienie liczone wyłącznie przez CSS `color-mix` (§7.3).

**Reguły montażu:**
1. Zakres montujemy na górze komponentu strony:
   - `PublicOrganizationPage`;
   - `TermPage`, wokół `KragStage`, dzięki czemu obejmuje też `PrivateGroupGate`, nakładki i toast;
   - `ItemDetailPage`, wokół treści;
   - podgląd w edytorze.
2. **Nie** w `PublicLayout`, bo jest wspólny z panelem.
3. Element zakresu **nie może** mieć `transform`, `filter`, `perspective`, `contain: paint/layout` ani `will-change: transform`. Każda z tych właściwości psuje pozycjonowanie arkuszy `position:fixed`.
4. `display: contents` jest dozwolone, ale tło musi zostać na elemencie-dziecku.
5. Portale: dziś ich nie ma. Jeśli kiedyś na tych stronach pojawi się nakładka Chakry, dajemy jej `portalled={false}`, `Portal container={scopeRef}` albo drugi `OrganizerThemeScope`.
6. Poza zakresem zostają: pasek konta w `PublicLayout`, `NotificationBell` (badge `bg-mint`) i tło `body` z Chakry `globalCss`. Rekomendacja: to „chrom platformy”, zostaje domyślny. Opcjonalnie można ustawić `<meta name="theme-color">` (otwarta decyzja 12).

---

## 6. Zestaw tokenów

Zmieniamy nazwy na **role**, żeby układy nigdy nie odwoływały się do „mint”. Stare nazwy (`mint`, `lime`) zostają tylko jako przejściowe aliasy w `@theme inline`, nigdy na `:root`.

| Token roli | Domyślnie (dziś) | Dawna nazwa | Użycie | Motywowany |
|---|---|---|---|---|
| `--color-primary` | `#1b8168` | `mint` | wypełnienia: CTA, aktywne znaczniki, „udostępnia”, aktywne szprychy | **tak** |
| `--color-on-primary` | `#ffffff` | `text-white` | tekst i ikony na primary (biały albo ink, zależnie od kontrastu) | **tak** |
| `--color-primary-fg` | `#117b63` | `text-mint` | **tekst** w kolorze primary: linki, nagłówki-etykiety, „Dostępna” | **tak** |
| `--color-primary-soft` | `#d8f0e6`; zalecane jaśniej (L 0,95) | `mint-soft` | zaznaczenia, poświaty, gradient karty terminu, pigułki | **tak** |
| `--color-focus-ring` | `#1b8168` | — | obrys fokusu (≥3:1) | **tak** |
| `--color-accent` | `#a9c24f` | `lime` | akcenty dekoracyjne (bez tekstu) | **tak** |
| `--color-accent-soft` | `#eaf2ce` | `lime-soft` | tła badge'y i pigułek | **tak** |
| `--color-accent-fg` | `#56701f` | literał | tekst na accent-soft | **tak** |
| `--color-cream` | `#f4f8f0` | `cream` | tło strony, inputy | **tak** (neutralny, lekko zabarwiony) |
| `--color-stage` / `--color-stage-wide` | `#edf1ea` / `#e7ede4` | literały | tło za ramą telefonu | **tak** (neutralny) |
| `--color-line` / `--color-line-strong` | `#e2eadf` / `#cbdac7` | `line` / literał | linie, nieaktywne szprychy | **tak** (neutralny) |
| `--color-paper` | `#ffffff` | `paper` | karty, arkusze | stały |
| `--color-ink`, `--color-ink-soft`, `--color-on-ink` | `#1e2e27`, `#5c7069`, `#eaf2e9` | — | tekst, toast | stały |
| `--color-danger(-soft)` | `#b23b3b`, `#f6e4e2` | — | błędy (ujednolicić z `#B4443A`) | stały |
| `--color-teal(-soft)`, `--color-sage(-soft)` | dziś | — | semantyka „przynosi”, etykiety pomocnicze | stały (z poprawką kontrastu) |
| `--color-scrim` | `rgba(20,28,24,.55)` | literał | tło modali | stały |
| ilustracje (murawa, drewno), `Avatar PALETTE` | dziś | literały | ilustracje, kolory tożsamości rodzin | stały |

**Semantyka wymiany:**
- Oddam (GIFT) = `primary-soft`;
- Wymienię (SWAP) = `accent-soft`;
- Wypożyczę (LEND) = `teal-soft`.

**Legenda wizualizacji:** „udostępnia” = `primary`, „przynosi” = stały `teal`. `--color-mint-bright` wypada z zestawu motywowanego i zostaje statycznym tokenem panelu.

---

## 7. Generator kolorów

### 7.1 Algorytm (`deep-colors` §5.2)

Wejście: `primary` (wymagany) i `accent` (opcjonalny). Obliczenia w OKLCH, kontrast liczony według WCAG 2.

1. **Zabezpieczenie przed zbyt jasnym kolorem.** Jeśli L > 0,9, przycinamy do 0,75. Edytor pokazuje komunikat „kolor za jasny”.
2. **`primary` + `on-primary`.**
   - Jeśli kontrast z białym ≥ 4,5, zostawiamy kolor i dajemy biały tekst.
   - W przeciwnym razie, jeśli kolor jest jasny i kontrast z ink ≥ 4,5, zostawiamy kolor i dajemy tekst ink (dotyczy np. żółtego i różowego).
   - W pozostałych przypadkach obniżamy L (szukanie binarne) przy zachowanym odcieniu, aż kontrast z białym osiągnie 4,5.
3. **`primary-fg`.** Obniżamy L, aż kontrast osiągnie ≥ 4,5 zarówno z cream, jak i z primary-soft.
4. **`primary-soft`.** `oklch(0,95, min(C·0,3, 0,04), H)`. L = 0,95 zapewnia, że ink-soft na soft ma ≥ 4,5.
5. **`focus-ring`.** ≥ 3:1 zarówno z cream, jak i z paper.
6. **`accent`.** Kolor wejściowy albo, gdy go brak, `oklch(0,77, clamp(C,0,10,0,15), H+300°)`. Do tego:
   - `accent-soft`: L 0,946;
   - `accent-fg`: ≥ 4,5 na accent-soft.
7. **Neutralne** (odcień primary, chroma ≤ C·0,3):
   - cream: L 0,974;
   - stage: L 0,953;
   - stage-wide: L 0,939;
   - line: L 0,928;
   - line-strong: L 0,872.
8. **Paleta domyślna (`null`) i palety kuratorowane nie przechodzą przez generator.** To ręcznie dostrojone mapy hex, więc obecny wygląd zostaje zachowany co do piksela. Generator zastosowany do `#1b8168` dałby cream `#eff9f5` zamiast `#f4f8f0`.
9. Zapisujemy tylko kolory wejściowe. Funkcja zwraca płaską mapę `{"--color-primary": "#…", …}`.

### 7.2 Wyniki prototypu (wszystkie progi spełnione)

| Kolor wejściowy | primary → tekst na nim | primary-fg | Uwagi |
|---|---|---|---|
| `#1b8168` | bez zmian → biały 4,79 | `#117b63` | naprawia obecne 4,45 dla linków |
| `#3498db` | przyciemniony `#047cbe` → biały 4,53 | `#006fab` | korekta jasności |
| `#f1c40f` | bez zmian → **ink** 8,57 | `#806600` | jasny kolor dostaje ciemny tekst |
| `#ff69b4` | bez zmian → **ink** 5,38 | `#be297c` | jw. |
| `#ffffff` | przycięty → ink 6,42 | szary | zabezpieczenie zadziałało |
| `#000000` | bez zmian → biały 21 | bez zmian | — |

### 7.3 Biblioteka czy kod własny

| Opcja | Rozmiar (min / gzip) | Werdykt |
|---|---|---|
| Kod własny (macierze Ottossona + przycinanie gamutu + luminancja WCAG), ~80 linii + testy | 1,46 KB / **0,9 KB** | **Rekomendowany** (`conventions.md`: minimum zależności) |
| `culori/fn` (tree-shaking) | 16,8 KB / 6,8 KB | gdyby kiedyś potrzebne były P3 lub APCA |
| `culori` (domyślne wejście) | 44,8 KB / 15,7 KB | nigdy |
| Tylko CSS `color-mix` | 0 | odrzucony: nie wybierze `on-primary`, nie skoryguje kontrastu, a mieszanie z bielą daje różną jasność dla różnych odcieni |

Backend: na razie tylko walidacja hex (CHECK + Pydantic). Generator potrafi skorygować każdy kolor, więc nie ma czego odrzucać. Lustrzana kontrola WCAG w Pythonie (~20 linii) to opcja (decyzja 14).

---

## 8. Migracja kolorów na sztywno (podsumowanie `deep-colors` §3)

**Skala:**
- zakres terminu: ~22 literały poza `KragStage`, 13 zmiennych `:root` i ~10 literałów w `KragStage`;
- zakres produktu: ~22 literały (w tym 16 w `panelIcons`);
- strona organizatora: 3 literały.

**Obowiązkowe dla motywu (~14 miejsc, kolory motywowane):**

| Plik:linia | Dziś | Docelowo |
|---|---|---|
| `pages/krag/components/TermFooter.tsx:18` | `bg-[#1B8168] text-white` (CTA „Zapisz się”) | `bg-primary text-on-primary` |
| `pages/krag/GroupVisualization.tsx:101` | `stroke="#1B8168"` / `"#CBDAC7"` | `var(--color-primary)` / `var(--color-line-strong)` |
| `pages/krag/GroupVisualization.tsx:259` | `bg-[var(--mint)] text-white` (legenda) | `bg-primary text-on-primary` |
| `KragStage.tsx:14,92` | tło sceny `#EDF1EA` / `#E7EDE4` | `--color-stage` / `--color-stage-wide` |
| `components/shared/PhoneFrame.tsx:11` | `bg-[#EDF1EA]` / `bg-[#E7EDE4]` | `bg-stage` / `bg-stage-wide` |
| `KragStage.tsx:38,72` | `#fff` na mint (znacznik, `kg-btn-primary`) | `--color-on-primary` |
| `pages/product/ItemTimeline.tsx:21` | `text-[#12604D]` (pigułka „Dostępna”) | `bg-primary-soft text-primary-fg` |
| `pages/panel/PanelNav.tsx:31` | `c={active ? "#1B8168" : "#5C7069"}` | ikony `currentColor` + `text-primary-fg` / `text-ink-soft` |
| `pages/PublicOrganizationPage.tsx:76` | `text-[#56701F]` | `text-accent-fg` |
| `pages/krag/PublicTermView.tsx:209,212` | `#E2EADF`, `#5C7069` | `border-line`, `text-ink-soft` |

**Kolejność migracji `KragStage` (krytyczna):**
1. Przepisać reguły `.kg-*` na `--color-*`.
2. Przenieść zależne komponenty, które czytają `var(--ink)` / `var(--ink-soft)` / `var(--paper)` / `var(--cream)`, na utility Tailwinda: `GroupVisualization.tsx:153-257`, `PrivateGroupGate.tsx:12,169`, `AccountMergeForm.tsx:58,63,77,89`, `RequestAccessDialog.tsx:94-133`.
3. **Dopiero potem** usunąć blok `:root{--mint…}`. Inaczej tekst w tych komponentach straci kolor.

**Stałe, ale do ztokenizowania:** toast (`PublicTermView.tsx:180` → `bg-ink text-on-ink`), błąd `#B4443A` → `text-danger`, scrim (`ModalSheet.tsx:24`, `RequestAccessDialog.tsx:94`) → `bg-scrim`, ikony `panelIcons` → `currentColor`, `Icons.tsx:58` → `currentColor`.

**Bez zmian:** murawa (`GroupVisualization.tsx:164`), drewno stołu (`:220`), `Avatar PALETTE` (decyzja 11), cienie w odcieniu ink.

Przy okazji naprawiamy kontrast domyślnej palety (§20, P1).

**Sugestie do standardów** (do potwierdzenia, potem `/maister:standards-update`):
- „Na stronach publicznych żadnych hexów w klasach arbitralnych, stylach inline ani `stroke=`; tylko tokeny ról”.
- „Zmiennych pochodnych nigdy nie deklarujemy na `:root`; zmienne motywu nadpisujemy wyłącznie na elemencie zakresu”.
- „Tokeny czytane poza utility deklarujemy jako `@theme static`”.

---

## 9. Układy

### 9.1 Zasady wspólne (`deep-layouts` §1)

1. **Układ = uporządkowana lista slotów (blok + wariant) + rama** (`column` albo `centered`). Bloki to czyste komponenty i nie pobierają danych same.
2. **Każdy blok ma `isEmpty(data)`.**
   - Odwiedzający nie widzi pustych bloków.
   - Właściciel w trybie edycji widzi „ducha” z wezwaniem do działania („Dodaj opis”, „Dodaj termin”). Tak powstaje lista kontrolna onboardingu i spełniamy obietnicę z `HomeView`.
3. **Każdy układ ma jeden blok główny.** Gdy jest pusty, wyświetla się stan pusty specyficzny dla układu oraz `link-stack` (Udostępnij).
4. **Tylko tokeny ról, żadnych hexów.**
5. **Wspólny nagłówek:** przycisk „Udostępnij” jest zawsze; „Wróć” tylko przy `history.length > 1`, bo zwykle wchodzi się z Instagrama lub WhatsAppa.
6. **Etykiety wymiany** pochodzą z `termLabels.ts:5-13`. Nie wymyślamy trzeciego słownictwa.
7. **Strona działa przy samej nazwie.** To dziś najczęstszy przypadek. Persony 2–4 (rodzina, klasa, drużyna) to zwykle grupy PRIVATE, więc publicznych danych jest mało.

### 9.2 Biblioteka bloków (17)

Oznaczenia w kolumnie „Dane dziś”:
- **T** = renderowalne z obecnych publicznych danych;
- **E** = dane są w bazie, brakuje endpointu (zadanie B);
- **N** = dane nie istnieją (zadania C/D).

| Blok | Warianty | Dane | Dane dziś | Gdy pusto (odwiedzający) |
|---|---|---|---|---|
| `hero` | `cover`, `color`, `compact`, `centered` | name, tagline, logo, cover | T (nazwa), N (reszta) | nigdy pusty; `cover` bez zdjęcia → `color` |
| `share` | inline | slug | T | nigdy |
| `stats` | `tiles3` | location, familyCount, galleryCount | E/N | pokazuje tylko kafle z wartością; <2 kafle → ukryty |
| `about` | `full`, `short` | bio | N | ukryty |
| `upcoming-terms` | `list`, `compact` | terminy (grupa, data, opis, liczba zapisanych) | E | ukryty |
| `agenda` | `by-day`, `week-strip` | terminy + grupy (filtry) | E | stan pusty „Brak zaplanowanych zajęć” |
| `next-term-cta` | `card`, `button` | pierwszy termin | E | ukryty |
| `circles-grid` | `cards`, `featured` | grupy (nazwa, `layout_mode`, następny termin, liczba zapisanych) | E | stan pusty |
| `circle-visual` | `mini` (tylko odczyt, 240px, **anonimowe miejsca**) | `layout_mode`, liczba miejsc, organizator | E (komponent N) | ukryty dla PRIVATE lub 0 uczestników |
| `exchange-counts` | `tiles3` (w EXCHANGE pełni rolę zakładek-filtrów) | counts GIFT/SWAP/LEND | E | ukryty, gdy wszystko = 0 |
| `exchange-board` | `grid2`, `list` | przedmioty (nazwa, stan, tryb, miniatura, termin) | E (zdjęcie: nowe pole `thumb_url`) | stan pusty + „Jak to działa?” |
| `needed-items` | `list` | potrzebne rzeczy na najbliższy termin | E | ukryty |
| `link-stack` | `buttons` | wyliczane: najbliższy termin, wszystkie terminy, wymiana, kontakt, udostępnij | E/N (kontakt) | nigdy (zawsze „Udostępnij”) |
| `gallery` | `strip`, `grid2` | zatwierdzone zdjęcia | N (zadanie D2) | ukryty |
| `testimonials` | `cards` | opinie | N | ukryty (tylko płatny SHOWCASE) |
| `empty-state` | `visitor`, `owner` | treści statyczne | T | — |
| `footer` | `minimal` | — | T | nigdy |

„Zostały 2 miejsca” z prototypu **wypada z MVP**, bo nie ma pojemności grupy ani terminu. Zamiast tego pokazujemy „zapisanych: N”.

### 9.3 Pięć układów z makietami (skrót z `deep-layouts` §3)

#### 1. `CLASSIC` — „Klasyczny” (domyślny i fallback)

**Dla kogo:** Kasia (zajęcia muzyczne 0–6), studio. Wierne odwzorowanie `ProfilMobilny.tsx`.

**Bloki:** `hero:cover`→`color` · `stats` · `about:full` · `upcoming-terms:list` (5) · `exchange-counts` · `gallery:strip` · `footer`.

**Przy samej nazwie:** kolorowy hero + Udostępnij + stopka.

```
+------------------------------------------+
|[< Wroc]                             [^>] |
|######## okladka / gradient primary ######|
| (O) Rodzinny grajdolek                   |
| Zajecia umuzykalniajace 0-6 · Jezyce     |
+-/--------------------------------------\-+
| [Miejsce Jezyce] [Rodziny 32] [Galeria >]|
| Zaczelam od jednej grupy w salce ...     |
| Najblizsze terminy                       |
| |27 sie| Muzyczne Maluchy 16:30 zapis.8 >|
| |30 sie| Rytmy i grzechotki 10:00       >|
| Wymiana rzeczy                           |
| [Oddam 3]  [Wymienie 4]  [Wypozycze 0]   |
+------------------------------------------+
```

#### 2. `SCHEDULE` — „Plan zajęć” (zamiast „Grafik”)

**Dla kogo:** trener z kilkoma treningami w tygodniu, studio z wieloma slotami.

**Bloki:** `hero:compact` · `next-term-cta:card` · **`agenda:by-day`** (główny; filtry po grupach przy ≥2 grupach) · `about:short` · `exchange-counts` · `footer`.

**Stan pusty:** „Organizator nie zaplanował jeszcze zajęć”.

```
+------------------------------------------+
| (O) Akademia Orlik                 [^>]  |
+------------------------------------------+
| | NAJBLIZSZE  wt 14 paz  Orliki 2017    | |
| |                       [ Zapisz sie > ]| |
| (Wszystkie) (2015) (2017) (2019) ->      |
| == wtorek, 14 pazdziernika ============= |
|  17:00  Orliki 2017       zapis.: 12   > |
|  18:15  Mlodziki 2015     zapis.:  9   > |
| == czwartek, 16 pazdziernika =========== |
|  17:00  Orliki 2017                    > |
|            [ Pokaz kolejne tygodnie ]    |
| O nas: Trenujemy od 2012 ...   Wiecej v  |
+------------------------------------------+
```

#### 3. `CIRCLES` — „Grupy” (klucz zostaje `CIRCLES`)

**Dla kogo:** nauczyciel z kilkoma klasami, szkoła muzyczna z grupami wiekowymi.

**Jedna grupa → wariant `featured`:** duża karta z mini-wizualizacją koło/boisko/stół z `layout_mode`, z anonimowymi miejscami. To naturalna strona drużyny trenera albo klasy nauczyciela.

**Bloki:** `hero:color` · **`circles-grid:cards | featured + circle-visual:mini`** · `about:short` · `exchange-counts` · `footer`.

```
 >= 2 grupy                                  1 grupa (featured)
+--------------------------------------+ +--------------------------------------+
| ##### gradient primary ##### [^>]    | | ##### gradient primary ##### [^>]    |
| (O) Szkola Muzyczna Nutka            | | (O) Trenerka Ola                     |
| Nasze grupy                          | | |     o   o   o                     |  |
| | Maluchy 0-2        zapisanych: 12 || | |   o   (Ola)   o   mini boisko    |  |
| | nast.: sr 15 paz, 9:30          > || | |     o   o   o     (anonimowo)    |  |
| | Przedszkolaki 3-6  zapisanych: 9  || | | Orliki 2017    nast.: wt 14 paz  |  |
| | nast.: czw 16 paz, 16:30        > || | |               [ Zobacz trening > ]|  |
| O nas: ...                 Wiecej v  | | O nas: ...                           |
+--------------------------------------+ +--------------------------------------+
```

Grupy PRIVATE domyślnie pomijamy w całości (decyzja 3).

#### 4. `LINKS` — „Wizytówka” (link-in-bio)

**Dla kogo:** solowy organizator z ruchem z Instagrama lub WhatsAppa; Kasia na starcie; gospodarz spotkań rodzinnych. Jedyny układ w pełni satysfakcjonujący przy dzisiejszych danych.

**Bloki:** `hero:centered` · **`link-stack:buttons`** · `about:short` · `footer`. Przyciski bez celu są pomijane.

```
+------------------------------------------+
|        tlo cream + delikatny primary     |
|                 ( OK )                   |
|           Rodzinny grajdolek             |
|        Muzyka dla 0-6 · Jezyce           |
| [ Najblizsze zajecia · wt 14.10 17:00 ]  |  primary, pelny
| [ Wszystkie terminy (5)               ]  |  paper, obrys
| [ Wymiana rzeczy (7)                  ]  |
| [ Kontakt                             ]  |  tylko z links
| [ Udostepnij strone                   ]  |
|   Malutkie grupy, rodzic siedzi ...      |
+------------------------------------------+
```

#### 5. `EXCHANGE` — „Wymiana” (przedefiniowany: tablica przedmiotów)

**Dlaczego zmiana:** wersja z raportu v1 („potrzebne rzeczy + liczniki, potem terminy”) to był CLASSIC z inną kolejnością sekcji i oblała test odrębności.

**Dla kogo:** społeczności wymiany zabawek, książek i ubranek (rodzice, przedszkole, sąsiedzi).

**Bloki:** `hero:compact` · `exchange-counts` jako zakładki-filtry · **`exchange-board:grid2`** · `needed-items:list` · `upcoming-terms:compact` (3) · `about:short` · `footer`.

**Karta przedmiotu:** zdjęcie, nazwa, stan, tryby, „odbiór: wt 14.10”. **Bez nazwiska udostępniającego** (rozstrzygnięcie prywatności, §11.3). Kliknięcie prowadzi na stronę terminu, a sama akcja odbywa się tam (bramki logowania zostają na stronie terminu).

```
+------------------------------------------+
| (O) Wymianka Solacz                [^>]  |
+------------------------------------------+
| [*Oddam 3*] [Wymienie 4] [Pozycze 1]     |  zakladki
| +-----------------+ +-----------------+  |
| |#####zdjecie#####| |#####zdjecie#####|  |
| | Pucio - ksiazka | | Kask rowerowy   |  |
| | b. dobry [Oddam]| | dobry [Od.][Wy.]|  |
| | odbior: wt 14   | | odbior: wt 14   |  |
| +-----------------+ +-----------------+  |
|            [ Pokaz wszystkie (12) ]      |
| Potrzebne na wt 14.10                    |
|  - Koc piknikowy        Ja przyniose >   |
| Najblizsze spotkania: wt 14 · sb 18      |
+------------------------------------------+
```

**Stan pusty:** „Na najbliższych zajęciach nikt jeszcze nic nie udostępnia” oraz trzykrokowe wyjaśnienie „Jak to działa?”.

#### (Płatny kandydat) `SHOWCASE` — „Magazyn”

Hero na cały ekran, galeria, opinie. Zablokowany przez brak danych (okładka, galeria, opinie). Może być płatny i dostępny dopiero przy okładce i ≥4 zdjęciach w galerii (`minData`).

### 9.4 Ocena odrębności

| Układ | Blok główny | Struktura | Przy skąpych danych |
|---|---|---|---|
| CLASSIC | bio + terminy | długa kolumna, arkusz nachodzący na okładkę | kolorowy hero, mało treści |
| SCHEDULE | agenda | kompaktowy nagłówek + oś czasu | zbliża się do CLASSIC |
| CIRCLES | karty grup / wyróżniona grupa | siatka kart / karta wyróżniona | **nadal odrębny** (dzięki `featured`) |
| LINKS | stos przycisków | wyśrodkowana kolumna | **w pełni odrębny** |
| EXCHANGE (nowy) | tablica przedmiotów | katalog + zakładki | odrębny, ale często pusty na starcie |

**Środki zaradcze:**
- kolejność dostarczania: najpierw CLASSIC i LINKS, pozostałe po zadaniu B;
- odznaka „Polecany” liczona z danych:
  - ≥2 grupy → CIRCLES;
  - ≥4 terminy w 2 tygodnie → SCHEDULE;
  - ≥4 przedmioty → EXCHANGE;
  - sama nazwa → LINKS;
- opis „dla kogo” przy każdej miniaturze.

**Odrzucone alternatywy:**
- osobny układ `TEAM` (wchłonięty przez CIRCLES:featured);
- połączenie SCHEDULE z CIRCLES;
- „3 układy × styl hero” (wymagałoby JSONB z ustawieniami już w MVP).

**Pewność:** średnio-wysoka (struktura), średnia (persony).

### 9.5 Kontrakt rejestru (`deep-layouts` §5)

```ts
export interface PageLayoutDefinition {
  key: string;                 // "CLASSIC" | … | "custom:<id>"  — = organizations.page_layout
  version: number;             // zmiana łamiąca → nowy klucz zamiast mutacji
  label: string;               // "Plan zajęć"
  description: string;         // "dla kogo" w pickerze
  thumbnail: { src: string; alt: string };   // statyczny SVG
  frame: "column" | "centered";
  blocks: BlockSlot[];         // deklaratywne, serializowalne do JSON
  minData?: DataKey[];         // np. SHOWCASE: ["cover","gallery"]
  recommendWhen?: (d: OrganizerPageData) => boolean;  // odznaka „Polecany”
  Component?: React.ComponentType<LayoutProps>;       // furtka dla układów na zamówienie
  // tier: "free" | "paid"  — dopiero z pierwszym płatnym układem
}
interface BlockSlot { block: BlockId; variant?: string; props?: Record<string, string|number|boolean>;
                      primary?: true; when?: { minCircles?: number; maxCircles?: number } }
export const FALLBACK_LAYOUT = "CLASSIC";
export const resolveLayout = (key?: string|null) => (key && LAYOUT_REGISTRY[key]) || LAYOUT_REGISTRY[FALLBACK_LAYOUT];
```

- **Renderowanie:** jeden `<LayoutRenderer def data mode>` mapuje sloty na `BLOCKS[id].Component`, stosuje `when`, pomija puste bloki i wstrzykuje stan pusty dla bloku głównego.
- **Lustro w backendzie:** `organizations/page_layouts.py` z allowlistą kluczy. Test frontendu sprawdza zgodność zbiorów kluczy.
- **Model widoku po stronie frontu:** `OrganizerPageData` jest **składany przez hook z dwóch zapytań** (§11). Nie przychodzi z jednego endpointu.
- **Przyszły płatny lub własny układ to nowy wpis w rejestrze:**
  - preset na istniejących blokach;
  - `custom:<id>` z blokami jako JSON;
  - wpis z własnym `Component`.

---

## 10. Przechowywanie danych i migracje

### 10.1 Motyw i układ (zadanie A)

```text
organizations.primary_color   VARCHAR(7)  NULL  (bez zmian, CHECK hex)
organizations.accent_color    VARCHAR(7)  NULL  (bez zmian, CHECK hex)
organizations.page_layout     VARCHAR(64) NOT NULL server_default 'CLASSIC'   -- NOWE
organizations.palette_preset  VARCHAR(40) NULL                                -- OPCJONALNE (decyzja 13)
```

**`page_layout`:**
- Typ: `StrEnum` + `_enum_column(native_enum=False)`.
- **Bez** natywnego enuma w bazie i **bez** CHECK. Wzorzec: `layout_mode`, migracja 0035.
- **`VARCHAR(64)`, a nie 40/32.** `custom:<uuid>` ma 43 znaki.
- Nazwa celowo różna od `layout_mode`: „Układ strony” vs „Szablon wizualizacji”.

**Nie przechowujemy:**
- wyliczonych odcieni (tylko kolory wejściowe);
- `theme_settings` JSONB (dopiero przy pierwszym układzie z ustawieniami).

### 10.2 Treść tekstowa i linki (zadanie C)

| Pole | Typ | Walidacja | Moderacja |
|---|---|---|---|
| `tagline` | `VARCHAR(160) NULL` | jedna linia, pusty → `NULL` | `check_text(ORGANIZATION_TAGLINE)`; opcjonalnie `ensure_no_contact_info` (decyzja 17) |
| `bio` | `VARCHAR(2000) NULL` | zwykły tekst, akapity `\n\n`, bez HTML i Markdown | `check_text(ORGANIZATION_BIO)` |
| `location` | `VARCHAR(120) NULL` | miasto i dzielnica, bez geolokalizacji | `check_text(ORGANIZATION_LOCATION)` |
| `links` | `JSONB NULL` | lista ≤6 `{kind, url}`; `kind` z allowlisty (WEBSITE, INSTAGRAM, FACEBOOK, TIKTOK, YOUTUBE, EMAIL, PHONE); tylko `https`; allowlista hostów; bez duplikatów | strukturalna (Bielik nie ocenia URL-i); render `rel="nofollow noopener ugc"` |

```python
op.add_column("organizations", sa.Column("tagline", sa.String(160), nullable=True))
op.add_column("organizations", sa.Column("bio", sa.String(2000), nullable=True))
op.add_column("organizations", sa.Column("location", sa.String(120), nullable=True))
op.add_column("organizations", sa.Column("links", postgresql.JSONB(), nullable=True))
```

- Nowe człony `TextField` **muszą mieć komunikat w `MESSAGES`**. Bez niego odrzucenie kończy się `KeyError` (`text_guard.py:18-48,87`).
- Kolumny zamiast osobnej tabeli profilu: docstring `Organization` („simple flat columns”) i precedens `user_profiles.bio` (migracja 0050).
- JSONB dla `links`: `models.md:9` dopuszcza JSONB dla kolekcji wartości.

### 10.3 Zdjęcia: `organization_media` (zadanie D, dwa repozytoria)

```text
organization_media
  id UUID PK (= subject_id moderacji) · organization_id FK · kind VARCHAR(10) LOGO|COVER|GALLERY
  storage_key VARCHAR(200) "organizations/{org_id}/{media_id}" · width, height, size_bytes · content_sha256
  status VARCHAR(20) · sort_order INT · uploaded_by_user_id FK · moderation_attempts · moderation_retry_at
  created_at, updated_at (BaseEntity; updated_at = version_id_col)
  UNIQUE (organization_id, content_sha256) · INDEX (organization_id, kind, status)
  INDEX częściowy (created_at, id) WHERE status='PENDING'   -- indeks dla crona
```

**Zestaw kolumn** jest identyczny jak w `profile_avatars` (0051). To kontrakt crona z `photo_store.py:79-81`.

**Trasy:**
- `POST /api/organizations/{id}/media?kind=` (multipart);
- `DELETE /api/organizations/{id}/media/{media_id}`;
- `PATCH /api/organizations/{id}/media/order`.

**Wymagane zmiany w kodzie:**
- **Nowy wiersz macierzy dla DELETE.** Dziś DELETE wpada do catch-all (§20, P3).
- Moderacja: `ModerationSubjectType.ORGANIZATION_MEDIA`, trzeci `select` w `list_photos`, słownik modeli w `decide`, trzecia próba w `delete_upload`, `Literal` w `schemas.py:37`, etykieta „Organizacja” w panelu admina.
- Repo `group-thing-ai`:
  - nowy `Subject` w `photo_store.py:112-115`;
  - granty w `moderation_db_role.sql`;
  - test `test_deploy_artifacts.py`.

**Kolejność wdrożenia:**
1. Migracja aplikacji.
2. Ponowne uruchomienie `moderation_db_role.sql`.
3. Wdrożenie crona.

Do czasu wdrożenia crona wiersze czekają w PENDING. Nigdy nie przechodzą bez kontroli (fail closed).

**Oczekujące zdjęcie (wariant B, rekomendowany):**
- Ostatnie zatwierdzone logo lub okładka zostaje publiczne do czasu zatwierdzenia nowego.
- Właściciel widzi nowe z plakietką „W weryfikacji”.
- Gdy brak zatwierdzonego, hero przechodzi na kolor primary z inicjałami.
- Oczekujące zdjęcia galerii są niewidoczne dla odwiedzających.
- Niezmiennik: dla każdego rodzaju LOGO i COVER istnieje najwyżej jeden niezatwierdzony wiersz.

**Limity:** galeria ≤12 (decyzja 18). Duplikat SHA zwraca 409.

**Bez Spaces** (`get_storage() is None`) upload zwraca 409 „chwilowo niedostępne”.

### 10.4 `PATCH /api/organizations/{id}` — semantyka `model_fields_set` (zadanie A)

- Pole **pominięte** → bez zmian.
- Pole z **jawnym `null`** → wyczyszczone. Dotyczy: kolory (to jest „Przywróć domyślne”), `tagline`, `bio`, `location`, `links`.
- `name` i `page_layout` nie przyjmują `null` (422).
- Wszystkie `check_text` uruchamiamy **przed** jakąkolwiek zmianą, więc odrzucone bio nie zapisze połowicznie zmiany koloru.
- **Zgodność wstecz:** frontend wysyła tylko zmienione pola (`api/organizations.ts:25-28`), więc nic się nie psuje.
- Wyścigi zapisów: `updated_at` jako `version_id_col` (`StaleDataError` jest już obsługiwany).

---

## 11. Publiczny endpoint strony organizatora

### 11.1 Rozstrzygnięcie konfliktu ścieżki

| | `deep-layouts`: `GET /api/organizations/public/{slug}/page` | **`deep-content`: `GET /api/groups/public/organizers/{slug}`** |
|---|---|---|
| Zależności | `organizations` musiałby importować `groups`: odwrotny kierunek i ryzyko cyklu (`exchange_summary.py:13-18`) | `groups → organizations` już istnieje przez `organizations_acl.py` |
| Zapytania HTTP | 1 | 2 równoległe |
| FOUC | brak | brak: motyw jest w payloadzie organizacji, który bramkuje pierwsze malowanie; sekcje grup pokazują szkielety |
| Werdykt | odrzucony | **przyjęty** |

**Frontend:**
- `usePublicOrganization(slug)` pobiera motyw, układ, treść i zatwierdzone media.
- `useOrganizerPage(slug)` pobiera grupy, terminy i wymianę.
- Oba składają się w `OrganizerPageData`.

### 11.2 Specyfikacja

```jsonc
// GET /api/groups/public/organizers/{slug}           PUBLIC
{
  "circles": [ { "id": "uuid", "name": "…", "layout_mode": "CIRCLE",
                 "next_term": { "id": "uuid", "occurs_on": "…", "attendee_count": 7 } | null,
                 "upcoming_term_count": 4 } ],                         // ≤30, sort: next_term NULLS LAST, name
  "upcoming_terms": [ { "term_id", "group_id", "group_name", "occurs_on",
                        "description": "…"|null, "attendee_count": 7 } ], // ≤10, okno 60 dni, rosnąco
  "exchange": { "counts": { "GIFT": 3, "SWAP": 4, "LEND": 0 },
                "items": [ { "item_id", "product_name", "condition", "mode",
                             "thumb_url": "…/w400.webp"|null, "term_id", "group_id" } ] },  // ≤12
  "needed_items": [ { "term_id", "group_id", "product_name", "claimed": false } ],        // DODANE (dla EXCHANGE)
  "stats": { "circle_count": 3, "upcoming_term_count": 9, "family_count": 32 | null }
}
// GET /api/groups/public/organizers/{slug}/terms?page=&size=&group_id=  → Page[OrganizerTermResponse]  (dla SCHEDULE)
```

- **Macierz autoryzacji:** nowy wiersz `(_methods("GET"), r"^/api/groups/public/organizers/[^/]+(/terms)?$", "PUBLIC")`.
  - Stawiamy go obok istniejących wierszy `/api/groups/public/...` (`authorization_matrix.py:86,93`), **przed wierszem 26** (`GET ^/api/groups(/.*)?$` READ).
  - Testy: nowa ścieżka jest PUBLIC, a `/api/groups/public/{uuid}` nadal jest PUBLIC.
- **ACL:**
  - `organizations_acl.get_organization_by_slug`;
  - `get_owner_party_id`: membership + rola OWNER. Uwaga: `Organization.party_id` to strona samej organizacji, a nie właściciela.
- **Organizatorzy bez `Organization`** (slug `k-…`) dostają 404, a strona organizatora pokazuje domyślny stan.
- **Linki budowane na froncie:** `/${slug}/grupa/${group_id}/term/${term_id}`. Slug jest tu zwalidowany, bo rozwiązał organizację.

### 11.3 Prywatność

| Zasada | Uzasadnienie |
|---|---|
| Tylko grupy `PUBLIC`. PRIVATE pomijamy całkowicie: bez nazwy i bez licznika | Lista publiczna ujawniłaby istnienie grup prywatnych (decyzja 3) |
| Tylko aktywne prowadzenie (`Leadership.valid_to IS NULL`) obecnego właściciela | Grupy przekazane innemu organizatorowi znikają ze strony |
| Tylko przyszłe terminy | Strona organizatora to agenda (inaczej niż strona terminu) |
| **Żadnych nazwisk**: bez opiekunów, `lister_display_name`, `claimed_by_*`; bez danych dzieci | Minimalizacja danych. Katalog nie może agregować nazwisk z wielu grup |
| `family_count` tylko z członków grup PUBLIC, **`null` poniżej 3** | Ochrona przed re-identyfikacją (decyzja 4) |
| Przedmioty: tylko AVAILABLE, od uprawnionych do najbliższego terminu, z zatwierdzonymi zdjęciami | Lustro `list_public_term_item_listings` |

### 11.4 Wydajność

- **Stały plan, około 12 zapytań:** organizacja, właściciel, prowadzenia, grupy, terminy, następny termin na grupę, liczby zapisanych, `family_count`, uprawnieni wystawiający, preferencje, przedmioty z produktem, pierwsze zatwierdzone zdjęcie.
- **Nie** używamy istniejących pomocników per przedmiot z `term_item_listings.py` (pętle N zapytań).
- Nowe funkcje wsadowe: `circulation_bridge.list_available_items_with_product`, `product_bridge` (pierwsze zdjęcie dla produktu) oraz repo grup.
- Test: liczba zapytań jest taka sama dla 1 i dla 5 grup.
- Limity to `LIMIT` w SQL (`jooq.md`).

---

## 12. Motyw na stronie terminu

- `PublicCircleResponse` dostaje `organizer_theme: { primary_color, accent_color, palette_preset? } | null`.
  - Wyliczane przez `organizations_acl`; resolver i tak ładuje wiersz `Organization`, więc to 0 dodatkowych zapytań.
  - Pole jest **także w zredukowanej odpowiedzi dla grup PRIVATE**: branding to nie dane członków.
- **Nie** bierzemy motywu ze sluga w URL. Slug nie jest walidowany, więc dowolny krąg dałoby się pokazać w barwach dowolnej organizacji.
- `TermPage` owija `KragStage` w `OrganizerThemeScope`.
- Strona terminu **nie** dostaje `page_layout`.

---

## 13. Edytor (UX)

1. **Wejście.** Tryb „Edytuj wygląd” na własnej stronie `/:slug`, tylko dla właściciela (`useMyOrganization().slug === slug`). Linki „Moja organizacja” (`AccountMenu.tsx:65`) i podpowiedź w `HomeView` prowadzą do `/${slug}?edit=1`.
2. **Dolny arkusz z zakładkami:**
   - **„Układ”:** 5 kart ze statycznymi miniaturami SVG, nazwą, opisem „dla kogo” i odznaką „Polecany”. Kliknięcie przełącza układ strony pod arkuszem (wersja robocza).
   - **„Kolory”:**
     - 8–12 kuratorowanych palet (ręcznie dostrojone mapy, sprawdzone testem kontrastu) i kółko „Własny”;
     - „Własny” to picker primary z polem hex i opcjonalny accent (domyślnie „automatyczny”);
     - pod spodem podgląd przycisku (biały albo ciemny tekst) i komunikat „Lekko przyciemniliśmy kolor, żeby tekst był czytelny” lub „kolor za jasny”;
     - „Przywróć domyślne” wysyła `null` w PATCH.
   - **„Treść”** (zadanie C, potem D): tagline, bio, miejsce, linki, logo, okładka, galeria. Zdjęcia mają plakietkę statusu moderacji.
3. **Podgląd innych stron.** Przełącznik „Strona / Termin / Produkt” pokazuje miniaturowe karty (CTA „Zapisz się”, pigułka „Dostępna”) w roboczej palecie.
4. **Bloki-duchy.** W trybie edycji puste bloki pokazują wezwania do działania („Dodaj opis”, „Dodaj termin”).
5. **Jawne „Zapisz” / „Anuluj”.**
   - Mutacja PATCH, potem `await invalidateQueries` na `["publicOrganization", slug]` i `["myOrganization", …]`.
   - Błędy przez `extractProblemMessage`.
   - Wersja robocza jest w stanie React, więc podgląd to zwykły render z innymi propsami.
6. **Miniatury** to statyczne SVG. Na żywo przebudowuje się strona pod arkuszem; mini-rendery z danymi organizatora są możliwe później.
7. **Układ okna.** MVP w kolumnie 430px na każdej szerokości (spójnie ze stroną terminu). Szerokie warianty desktopowe to ulepszenie (decyzja 6).

Pewność: średnio-wysoka.

---

## 14. Strona produktu — decyzja o kolorach

**Fakty (pewność wysoka):**
- Przedmiot należy do **użytkownika**. Jego widoczność w terminach wynika z obecności właściciela, więc może być wystawiony u kilku organizatorów naraz.
- „Organizator przedmiotu” nie istnieje. Istnieje tylko „organizator terminu, przez który użytkownik wszedł”.

**Wejścia na stronę produktu:**

| Wejście | Kontekst terminu |
|---|---|
| Lista na stronie terminu (`PublicTermView.tsx:67-73`) | **tak** |
| Panel „Moje rzeczy”, „Wypożyczone”, po utworzeniu przedmiotu | nie |
| Powiadomienia (`link_path` w `term_item_listings.py`, `pledge_fulfillment.py`) | serwer zna termin, ale link go nie niesie |

**Decyzja (MVP):**
1. Link ze strony terminu dostaje `?org=<organizer_slug z odpowiedzi serwera>`, a nie slug z URL.
2. Strona produktu wywołuje istniejące `usePublicOrganization(slug)`. Cache z TanStack jest zwykle ciepły po wizycie na stronie terminu.
3. **Motyw obejmuje tylko obszar treści.** `PhoneFrame` i `PanelNavBar` zostają neutralne, bo to „przestrzeń użytkownika”.
4. Wejścia z panelu i z powiadomień dostają domyślną paletę.
5. `ItemEditPage` i `ItemBackButton` zachowują `location.search`, żeby kontekst nie ginął w obiegu podgląd → edycja → podgląd.
6. Slug `k-…` zwraca 404, więc pokazujemy domyślną paletę. Ręcznie podmieniony `?org=` zmienia tylko kosmetykę strony za logowaniem; to akceptowalne.

**v2: `?term=<termId>`, rozwiązywane po stronie serwera** przez osobny endpoint grup.
- Daje wiarygodne źródło, pozwala dodać „← wróć do terminu” i motyw w linkach z powiadomień (producenci powiadomień mają `term.id` pod ręką).

**Odrzucone:**
- trasa zagnieżdżona;
- wyliczanie organizatora z przedmiotu (niejednoznaczne);
- „ostatni odwiedzony organizator” w localStorage;
- brak motywu na produkcie (nie spełnia wymagania).

**Czy strona produktu ma być publiczna? Nie w tej funkcji.**
- Publiczne `/details` + `/history` ujawniłyby rytm wymian rodziny, terminy posiadania, przedmioty członków grup PRIVATE i zdjęcia wnętrz.
- Jeśli kiedyś będzie potrzebny publiczny widok przedmiotu, to osobny wąski model odczytu przez `?term=`, tylko dla przedmiotów wystawionych w terminie grupy PUBLIC, bez historii. Osobne zadanie z przeglądem prywatności.
- Przy okazji wykryto istniejącą lukę (§20, P2).

Pewność: średnio-wysoka.

---

## 15. Monetyzacja: model oraz „budujemy teraz / później”

### 15.1 Dowody rynkowe (skrót)

| Produkt | Model | Cena | Co jest płatne |
|---|---|---|---|
| Bookero (PL, źródło oficjalne) | abonament | 19,90 / 49,90 / 89,90 PLN netto/mies. | m.in. ukrycie stopki (Premium) |
| Linktree | abonament | Pro ~12–15 USD/mies. | motywy premium, kolory, czcionki |
| Carrd | abonament roczny | ~9 / 19 / 49 USD/rok | szablony Pro |
| Calendly | abonament per użytkownik | ~10–12 USD/mies. | branding |
| Shopify | licencja jednorazowa per motyw | 140–400 USD | cały motyw (rynek wielu projektantów) |
| Luma | motywy darmowe, płatne funkcje operacyjne | 59 USD/mies. | nie motywy |

**Wzorzec:** platformy, na których stoi cały biznes użytkownika, wliczają wygląd w abonament. Licencje per element mają sens tylko na rynku wielu zewnętrznych projektantów.

### 15.2 Rekomendowany model (pewność średnia)

- **Jeden abonament „Organizator Pro”**, rząd wielkości **19–29 PLN netto/mies.** (lub rocznie z rabatem).
  - Odblokowuje wszystkie układy premium (pierwszy: SHOWCASE) i prawdopodobnie kolor „Własny” (decyzja 19).
  - **Nie** sprzedajemy jednorazowo poszczególnych układów.
- **Układ na zamówienie to usługa:** jednorazowa opłata, kod w rejestrze `custom:<id>`, uprawnienie `source=SERVICE`. Rekomendacja: wymaga aktywnego abonamentu, żeby był renderowany.
- **Downgrade:**
  - Po anulowaniu uprawnienie trwa do końca opłaconego okresu.
  - Przy nieudanej płatności działa okres windykacji ~14 dni (`valid_to = period_end + 14d`).
  - Po wygaśnięciu strona renderuje **`CLASSIC` w palecie organizatora** i **nigdy nie znika**, bo zależą od niej strony terminów i zapisy.
  - Zapisany `page_layout` i ustawienia zostają, więc odnowienie przywraca stronę natychmiast.
  - Panel pokazuje baner „Twój układ premium jest nieaktywny”.
  - Płatna paleta wraca do najbliższego presetu, a kolor wejściowy zostaje zapisany.
- **Podgląd przed zakupem:** ta sama wersja robocza w edytorze, z „Odblokuj” zamiast „Zapisz”. Nie trzeba zapisywać wersji roboczej na serwerze. Okres próbny = wiersz uprawnienia z `valid_to = now + 7d`.
- **Wersjonowanie:** zmiana łamiąca oznacza nowy klucz (`showcase2`), a nie zmianę znaczenia zapisanych ustawień (podejście Shopify).
- **Kwestie prawne PL/UE (do potwierdzenia przez prawnika):**
  - 14 dni na odstąpienie od umowy; prawo wygasa tylko za wyraźną zgodą na natychmiastowe wykonanie;
  - JDG traktowana jak konsument (od 2021);
  - ceny brutto (23% VAT);
  - Stripe Billing i Przelewy24 obsługują cykliczny BLIK.

### 15.3 Model uprawnień (później)

```text
organization_entitlements
  id BIGINT (BaseEntity) · organization_id FK · kind VARCHAR(20) LAYOUT|FEATURE
  key VARCHAR(64)  'plan:pro' | 'layout:showcase' | 'feature:custom_palette' | 'layout:custom:<id>'
  source VARCHAR(20) ADMIN|SUBSCRIPTION|PURCHASE|SERVICE · valid_from · valid_to NULL · external_ref NULL
```

- Jeden wiersz per **plan**, a w kodzie mapa `PLAN_FEATURES`. Nowy układ w planie nie wymaga uzupełniania danych.
- Darmowe układy nie potrzebują wierszy.
- Okres karencji to przesunięcie `valid_to`.
- Zgodne z zaleceniem Stripe Entitlements: przechowujemy uprawnienia u siebie.

### 15.4 Teraz vs później

| **TERAZ** (potrzebne 5 darmowym układom albo tańsze teraz) | **PÓŹNIEJ** (z pierwszym płatnym układem lub billingiem) |
|---|---|
| `page_layout VARCHAR(64)` + allowlista w kodzie, bez natywnego enuma i bez CHECK | tabela `organization_entitlements`, serwis, nadawanie przez admina |
| inna nazwa niż `layout_mode` | `tier` w rejestrze + badge „Premium” |
| rejestr frontendu z fallbackiem nieznanego klucza do `CLASSIC` | `GET /api/organizations/layouts` (katalog) |
| treść poza ustawieniami układu; układ i paleta jako niezależne pola | resolver `effective_layout()` + baner w panelu |
| klucz układu zwracany z **jednego** miejsca w serwisie (później opakuje go resolver) | „Odblokuj” zamiast „Zapisz” w edytorze |
| wersja robocza w edytorze (podgląd) | `schema_version` ustawień, `theme_settings` JSONB |
| `?org=` na produkcie | tabela `page_layouts` (może nigdy nie być potrzebna) |
| | Stripe lub P24, webhooki, windykacja |

Każdy element z kolumny „PÓŹNIEJ” jest **czysto addytywny**: nie zmienia typu kolumny, schematu URL ani zapisanych danych.

---

## 16. Podział na zadania i zależności

| Zadanie | Zawartość | Repo | Zależy od | Rozmiar |
|---|---|---|---|---|
| **A: Motyw + układ + szkielet edytora** | Tokeny ról i `@theme static`; migracja `KragStage` i zależnych; tokenizacja ~14 miejsc (+ stałych); `orgPalette.ts` z testami; `OrganizerThemeScope` (organizator, termin, produkt). `page_layout` (migracja, schematy), PATCH `model_fields_set`, opcjonalnie `palette_preset`. `organizer_theme` w `PublicCircleResponse` (także PRIVATE). Rejestr, `LayoutRenderer`, bloki bez nowych danych, układy **CLASSIC i LINKS**. Edytor: arkusz „Układ / Kolory”, presety, „Własny”, podgląd, zapis, wejścia z menu i `HomeView`. `?org=` na produkcie. Hooki TanStack (`usePublicOrganization`, `useMyOrganization`, `useUpdateOrganization`); naprawa kontrastu domyślnej palety | app | — | L (można podzielić na A1: tokeny i motyw, A2: układ i edytor) |
| **B: Publiczny model odczytu + układy z danymi** | `GET /api/groups/public/organizers/{slug}` (+ `needed_items`, + `/terms` z paginacją); funkcje ACL, wiersz macierzy, funkcje wsadowe w bridge, test stałej liczby zapytań. Bloki `agenda`, `circles-grid`, `circle-visual:mini`, `exchange-board`, `needed-items`, `stats`; układy **SCHEDULE, CIRCLES, EXCHANGE**; odznaka „Polecany”; `thumb_url` na liście publicznej | app | backend: — (równolegle z A); frontend: rejestr z A | M–L |
| **C: Treść tekstowa** | `tagline`, `bio`, `location`, `links` (migracja, `TextField` + `MESSAGES`, PATCH, odpowiedzi publiczne); zakładka „Treść” (tekst); `og:description` z taglinu | app | A (semantyka PATCH, edytor) | S–M |
| **D: Zdjęcia organizacji** | Tabela `organization_media`; trasy upload, delete, reorder; wiersz macierzy DELETE; moderacja (union, decide, delete, admin UI); hero z logo i okładką; **cron: `Subject` + granty + test artefaktów** | app **+ group-thing-ai** | C (zakładka „Treść”, opcjonalnie); skonfigurowane Spaces; kolejność wdrożenia | M |
| **D2: Galeria i OG** | Blok `gallery`; `og:image` z okładki (`public_preview.py`) + `twitter:card summary_large_image`; opcjonalnie `<meta name="theme-color">` | app | B, D | S |
| (później) E: Monetyzacja | Uprawnienia, `tier`, katalog, `effective_layout`, SHOWCASE, „Odblokuj”, billing | app | A, D2 (SHOWCASE wymaga galerii) | M+ |

```
A (motyw/uklad/edytor) ──┬──► C (tresc) ──► D (media, 2 repo) ──► D2 (galeria/OG) ──► E (pozniej)
                         │                                         ▲
B-backend (rownolegle) ──┴──► B-frontend (SCHEDULE/CIRCLES/EXCHANGE)┘
```

---

## 17. Ryzyka

| # | Ryzyko | Wpływ | Prawdop. | Mitygacja |
|---|---|---|---|---|
| R1 | Usunięcie `:root` z `KragStage` przed migracją zależnych komponentów | tekst bez koloru na stronie terminu | wysokie, jeśli kolejność zła | kolejność z §8; grep `var(--ink` / `--mint` / `--paper` / `--cream` |
| R2 | Tokeny tree-shakowane przez Tailwinda (niezdefiniowane zmienne) | brakujące kolory w `KragStage` i stylach inline | średnie | `@theme static` dla stałych; 13 liści zawsze inline |
| R3 | Pominięte hexy | „zielone wyspy” w obcej palecie | średnie | lista z §8 + grep `\[#`, `stroke="#`, `c="#`; propozycja standardu |
| R4 | Słaby kontrast przy kolorze własnym | naruszenie WCAG | niskie (generator) | testy jednostkowe na zestawie kolorów; presety jako sprawdzone mapy |
| R5 | Zmiana domyślnego wyglądu przez poprawki kontrastu | zauważalne różnice (jaśniejszy mint-soft, ciemniejszy tekst linków) | pewne | świadoma decyzja (§20 P1); zrzuty przed i po |
| R6 | `transform` / `contain` na elemencie zakresu | rozjechane arkusze `fixed` | niskie | reguła w §5.2 + komentarz w komponencie |
| R7 | Układy puste przy skąpych danych | słabe pierwsze wrażenie, mylący wybór 1 z 5 | wysokie | CLASSIC i LINKS najpierw, „Polecany”, bloki-duchy, `featured` |
| R8 | Wyciek prywatności w katalogu (nazwiska, grupy PRIVATE, małe liczby) | RODO, zaufanie | średnie | reguły §11.3; testy autoryzacji i odpowiedzi |
| R9 | N+1 w modelu odczytu | wydajność | średnie | plan stałych zapytań + test licznika |
| R10 | Kolejność wdrożenia zdjęć w dwóch repo | cron się wyłącza (self-check) albo zdjęcia czekają w PENDING | średnie | migracja → granty → cron; zdjęcia nie przechodzą bez kontroli |
| R11 | Długi czas weryfikacji logo lub okładki | strona bez obrazu | średnie | wariant B (ostatnie zatwierdzone zostaje) |
| R12 | Pomylenie `page_layout` z `layout_mode` | błędy i dezorientacja | średnie | różne nazwy i etykiety |
| R13 | Nadmiarowa architektura „pod płatne” | sprzeczność z `minimal-implementation.md` | średnie | tylko elementy z kolumny „TERAZ” (§15.4) |
| R14 | Kwestie prawne przy sprzedaży (odstąpienie, JDG) | ryzyko reklamacji | — (później) | konsultacja prawna przed uruchomieniem płatności |

---

## 18. Wnioski i odpowiedź na pytanie badawcze

1. **Paleta.** Zapisujemy 2 kolory wejściowe (i opcjonalnie klucz presetu). Własny generator `orgPalette.ts` wylicza 13 tokenów ról, które `OrganizerThemeScope` ustawia inline na stronie organizatora, terminu i produktu. Bez Chakry i bez nowych zależności. AA jest gwarantowane. *(wysoka)*
2. **Dostarczanie motywu.**
   - Organizator: jego publiczny endpoint.
   - Termin: `organizer_theme` w `PublicCircleResponse`.
   - Produkt: `?org=` z linku na stronie terminu, w pozostałych przypadkach paleta domyślna.

   Motyw przychodzi zawsze w tym samym payloadzie co treść, więc nie ma FOUC. *(wysoka / średnio-wysoka dla produktu)*
3. **Dane.**
   - `page_layout VARCHAR(64)`;
   - kolumny tekstowe moderowane przez Bielik;
   - `links` JSONB;
   - `organization_media` w istniejącym potoku moderacji zdjęć;
   - PATCH z `model_fields_set`.

   *(wysoka)*
4. **Publiczne grupy, terminy i wymiana** przez `GET /api/groups/public/organizers/{slug}`, należący do `groups`. Tylko PUBLIC, bez nazwisk, stała liczba zapytań. *(wysoka: umiejscowienie; średnia: kształt i limity)*
5. **Układy:** CLASSIC, SCHEDULE „Plan zajęć”, CIRCLES „Grupy” (+`featured`), LINKS „Wizytówka”, EXCHANGE „Wymiana” (tablica przedmiotów). 17 bloków i rejestr `PageLayoutDefinition`. *(średnio-wysoka / średnia)*
6. **Edytor:** tryb na własnej stronie, arkusz „Układ / Kolory / Treść”, presety + „Własny” z widoczną korektą, bloki-duchy, jawny zapis. *(średnio-wysoka)*
7. **Płatne układy:** jeden abonament; teraz tylko „szew” w danych; uprawnienia i resolver później; downgrade renderuje CLASSIC i zachowuje wybór. *(średnia / nisko-średnia)*

**Wnioski dodatkowe:**
- Największy koszt to dane (zadania B, C, D), nie motyw.
- Funkcja zamyka istniejącą lukę: obietnicę „Dodaj opis, kolory i logo” bez ścieżki edycji.
- Badanie ujawniło 4 istotne problemy poza zakresem (§20).

---

## 19. Otwarte decyzje (skonsolidowane)

**Układy**
1. Czy akceptujemy **EXCHANGE jako tablicę przedmiotów** (z `thumb_url` i `needed_items` w endpoincie B)?
2. Czy akceptujemy **CIRCLES:featured** zamiast osobnego układu TEAM? Mini-wizualizacja z **anonimowymi miejscami** czy z danymi opiekunów z payloadu strony terminu (kwestia prywatności)?
3. **Grupy PRIVATE na stronie publicznej:** pomijać całkowicie (rekomendacja) czy pokazywać „zamknięta — poproś o dołączenie”?
4. **Liczby:** `family_count` z progiem 3? Tylko członkowie czy też jednorazowe zapisy? Na kartach grup „zapisanych: N” (następny termin) czy liczba rodzin w grupie?
5. **Limity modelu odczytu:** 60 dni, 10 terminów, 12 przedmiotów, 30 grup? Paginowane `/terms` w zadaniu B (razem z SCHEDULE) czy później?
6. **Desktop:** MVP w kolumnie 430px, szerokie warianty później?
7. **Miniatury w pickerze:** statyczne SVG + odznaka „Polecany” (rekomendacja) czy mini-rendery na żywo?
8. **Kolejność dostarczania:** najpierw CLASSIC i LINKS, pozostałe po zadaniu B?
9. **Etykiety:** „Plan zajęć” i „Grupy” w pickerze (klucze bez zmian)?

**Kolory**
10. **Semantyka akcentów:** „udostępnia” = primary, pigułki = accent-soft, „przynosi” = stały teal. Jak poprawić teal: ciemniejszy odcień czy ikona w kolorze ink?
11. **Paleta awatarów rodzin:** stała w MVP (rekomendacja) czy wyprowadzana z odcienia primary?
12. **Chrom poza zakresem** (pasek konta, `NotificationBell`, tło `body`, ramka panelu na produkcie): zostaje domyślny (rekomendacja) czy dodajemy `<meta name="theme-color">` lub zakres na poziomie trasy?
13. **`palette_preset`:** zapisywać klucz presetu (pozwala na ręcznie dostrojone mapy i globalne poprawki; rekomendacja) czy rozpoznawać preset po zgodności kolorów?
14. **Walidacja na backendzie:** tylko hex (rekomendacja) czy dodatkowo lustrzana kontrola WCAG w Pythonie?
15. **Naprawa kontrastu domyślnej palety** w ramach zadania A (lekka zmiana obecnego wyglądu)?
16. **Tryb ciemny:** poza zakresem (rekomendacja)?

**Treść i zdjęcia**
17. **Treść tekstowa:**
    - bio jako zwykły tekst (rekomendacja) czy ograniczony Markdown?
    - `ensure_no_contact_info` dla taglinu (rekomendacja: tak) i dla bio (rekomendacja: nie)?
    - czy linki EMAIL i PHONE mają być publiczne?
18. **Zdjęcia:**
    - oczekujące zdjęcie w wariancie B (ostatnie zatwierdzone zostaje; rekomendacja) czy A (jak awatar)?
    - limit galerii 12?
    - podpisy pod zdjęciami (wymagają `TextField`)?

**Produkt i monetyzacja**
19. **Strona produktu:** `?org=` (MVP) teraz, a `?term=` kiedy pojawi się potrzeba „wróć do terminu” lub motywu w powiadomieniach? Motyw tylko na obszarze treści?
20. **Monetyzacja:**
    - jeden abonament „Organizator Pro” (19–29 PLN netto)?
    - czy kolor „Własny” jest płatny?
    - czy układ na zamówienie wymaga aktywnego abonamentu?
    - czy akceptujemy politykę downgrade (CLASSIC + zachowanie wyboru, strona nigdy offline)?

**Problemy poza zakresem**
21. Czy naprawiamy P2 (odczyt dowolnego przedmiotu) i P3 (DELETE poza macierzą) w osobnych zadaniach, czy przy okazji zadań A i D?

---

## 20. Znalezione problemy poza zakresem

| # | Problem | Dowód | Waga | Sugestia |
|---|---|---|---|---|
| **P1** | **Domyślna paleta nie spełnia kontrastu WCAG AA w 4 parach (5 pomiarów):** (1) `mint` jako tekst na cream **4,45:1** (wymagane 4,5): linki, `.kg-back`, `.kg-term-eyebrow`; (2) `sage` na cream **3,70:1**, na paper 3,98:1: `.kg-eyebrow`, `.kg-status-line`, 11–12px; (3) biała ikona na `teal` **2,32:1** (minimum dla elementów nietekstowych 3:1): legenda „przynosi”, `.kg-mark-brings`; (4) `ink-soft` na `mint-soft` **4,41:1**: zaznaczony wiersz uczestnika. Dodatkowo biały na lime 2,00:1 (dziś nieużywane jako tekst; tak ma zostać) | `deep-colors` §3.6 | średnia (dostępność) | naprawić w zadaniu A: `primary-fg` `#117b63`, `primary-soft` L 0,95, ciemniejszy sage lub ink, ciemniejszy teal lub ikona ink |
| **P2** | **Każdy zalogowany użytkownik może odczytać dowolny przedmiot po UUID** (`/api/inventory-items/{id}/details` i `/history`). Jedyny warunek to zalogowanie (macierz, wiersz 40). UUID-y są publiczne przez listy w terminach grup PUBLIC. Ujawnia historię ruchów, daty i przedmioty członków grup PRIVATE | `deep-product-monetization` A2/A5; `authorization_matrix.py:166`; `circulation/application/item_details.py:45-108`; `groups/schemas.py:264-276` | **wysoka** (prywatność) | osobne zadanie: ograniczyć odczyt do właściciela, posiadacza, uczestników rezerwacji i współuczestników terminów, w których przedmiot jest wystawiony |
| **P3** | **`DELETE /api/organizations/...` wpada do reguły catch-all `AUTHENTICATED`.** Wiersz 50 obejmuje tylko POST i PATCH. Każda przyszła (lub istniejąca, niezweryfikowane) trasa DELETE pod tym prefiksem wymaga jedynie zalogowania, a nie uprawnienia EDIT | `deep-content` §3.2; `authorization_matrix.py:184,231` | średnia | dodać `DELETE` do wiersza 50 albo osobny wiersz przed catch-all; testy w `test_authorization_matrix.py` (najpóźniej w zadaniu D) |
| **P4** | **`KragStage` wstrzykuje globalne style bez warstwy:** `*,*::before,*::after{box-sizing}` (`KragStage.tsx:13`) oraz paletę na `:root` (`:7-12`). Po zamontowaniu strony terminu reguły obowiązują w całej aplikacji (SPA nie usuwa `<style>`) i wygrywają z utility Tailwinda | `deep-colors` §1.2 | niska–średnia | w zadaniu A: zawęzić do `.kg-stage`, usunąć `:root`, rozważyć przeniesienie do pliku CSS w warstwie |
| P5 (drobny) | Rozjazd koloru błędu: `KragStage` `#B4443A` vs Tailwind `--color-danger #b23b3b` | `deep-colors` §3.2 | niska | ujednolicić w A |
| P6 (drobny) | `PublicOrganizationPage` pobiera dane przez `useState`+`useEffect` (łamie `data-fetching.md`) | `codebase-frontend-pages-and-data-flow` §2 | niska | hook w A |
| P7 (drobny) | `HomeView` obiecuje „Dodaj opis, kolory i logo”, ale nie ma ścieżki edycji | `HomeView.tsx:77-86`, `OrganizationPage.test.tsx:78-98` | niska (UX) | zamyka zadanie A (edytor) |
| P8 (drobny) | Dokumentacja projektu (`architecture.md`, `tech-stack.md`) nieaktualna dla domeny grup i organizacji | `docs-ux-standards-and-docs` D1 | niska | aktualizacja dokumentacji |

---

## 21. Załączniki

### A. Źródła

**Pierwszy przebieg** (`analysis/findings/`):
- `codebase-frontend-color-application.md`
- `codebase-frontend-pages-and-data-flow.md`
- `codebase-frontend-seams-and-tests.md`
- `codebase-backend-current-state.md`
- `codebase-backend-storage-options.md`
- `docs-ux-mockups-and-content-blocks.md`
- `docs-ux-prior-tasks.md`
- `docs-ux-standards-and-docs.md`
- `external-theming-chakra-v3-mechanism.md`
- `external-theming-contrast-fouc-editor.md`
- `external-theming-tokens-and-palette-generation.md`
- `external-saas-platforms.md`
- `external-saas-patterns-and-proposal.md`

**Pogłębienia:**
- `deep-layouts.md`
- `deep-content.md`
- `deep-colors.md`
- `deep-product-monetization.md`

**Synteza:** `analysis/synthesis.md` (rev. 2).

**Zewnętrzne (wybór):**
- Tailwind v4 (theme, colors), CSS Variables L1, web.dev Baseline (`color-mix`, relative color syntax), WCAG 2.2 SC 1.4.3 i 1.4.11.
- culori 4.0.2, Shopify (themes, updating themes, try-before-buy), Linktree (paid features, cancel).
- Carrd (trial), Luma Plus, Bookero cennik, Stripe Entitlements, Smart Retries i recurring BLIK, Przelewy24 BLIK.
- Ustawa o prawach konsumenta (art. 27, art. 38).

Pełne URL-e są w plikach findings.

### B. Luki i niepewności

- Firefox i Safari nie były uruchamiane; empirycznie przetestowano tylko Chromium 154.
- Stałe generatora wymagają strojenia wizualnego na prawdziwych kolorach.
- Plan stałych zapytań nie ma prototypu.
- Wariant B dla oczekujących zdjęć nie ma precedensu w repo.
- Persony i układy nie były walidowane z użytkownikami.
- Brak oficjalnej dokumentacji downgrade motywów premium u konkurencji.
- Kwestie prawne pochodzą ze źródeł wtórnych.
- Brak polskiego benchmarku ceny układu na zamówienie.
- Nie zweryfikowano, czy istnieją już dziś trasy DELETE pod `/api/organizations` (P3).

### C. Rozstrzygnięte konflikty

| Konflikt | Rozstrzygnięcie |
|---|---|
| Chakra `colorPalette` vs Tailwind | zmienne Tailwinda na zakresie (teraz zweryfikowane) |
| `color-mix` w CSS vs generator JS | generator JS (kontrast, `on-primary`); `color-mix` najwyżej jako fallback dekoracyjny |
| Ścieżka endpointu: `organizations/public/{slug}/page` vs `groups/public/organizers/{slug}` | **groups**, bo to istniejący kierunek zależności i brak cyklu; `OrganizerPageData` jako model widoku z dwóch zapytań |
| Limity: 6 tyg./30/24 vs 60 dni/10/12 | 60 dni/10/12/30 + paginowane `/terms` w B |
| Nazwiska udostępniających i opiekunów na stronie organizatora | brak nazwisk; mini-wizualizacja anonimowa |
| `needed-items` w EXCHANGE vs brak w endpoincie | dodane `needed_items` (bez nazwisk) |
| `page_layout` 40 vs 32 vs `custom:<uuid>` (43 zn.) | `VARCHAR(64)` |
| „lime = udostępnia” (v1) | „udostępnia” = primary; lime/accent tylko w pigułkach |
| EXCHANGE v1 (CLASSIC z inną kolejnością) | tablica przedmiotów |
| „Grafik” | „Plan zajęć” |
| Portale (G1) | brak w kodzie; reguły na przyszłość |
| `/terms` z paginacją w D2 (`deep-content`) | w B, razem z SCHEDULE |

### D. Poziomy pewności

| Ustalenie | Pewność |
|---|---|
| Nadpisanie tokenów Tailwind v4 na zakresie, pułapka `:root`, tree-shaking | Wysoka (empirycznie) |
| Brak portali | Wysoka |
| 13 tokenów ról + generator własny | Średnio-wysoka (stałe do strojenia) |
| Przechowywanie (kolumny, `links` JSONB, `organization_media`) | Wysoka |
| Ścieżka moderacji (Bielik, cron VPS B) | Wysoka |
| Endpoint w `groups`: umiejscowienie / kształt i limity | Wysoka / Średnia |
| Reguły prywatności | Wysoka (zasady) / Średnia (progi) |
| 5 układów: struktura / persony | Średnio-wysoka / Średnia |
| Kontrakt rejestru | Średnio-wysoka |
| Edytor | Średnio-wysoka |
| `?org=` na produkcie | Średnio-wysoka |
| Model abonamentowy i cena | Średnia |
| Downgrade, kwestie prawne | Nisko-średnia |
| Podział na zadania | Wysoka |
