# Decision Log: strona organizatora — 5 układów + paleta kolorów

**Data:** 2026-10-07 · **Format:** MADR · **Powiązany projekt:** `outputs/high-level-design.md` · **Źródła alternatyw:** `outputs/solution-exploration.md` (obszary 1–8), `outputs/research-report.md`, `analysis/synthesis.md` (C1–C12, V1–V14).

Wszystkie decyzje zatwierdził użytkownik w fazie 4 (konwergencja). ADR-009 dokumentuje świadome odstępstwo użytkownika od rekomendacji badania.

---

<a id="adr-001"></a>
## ADR-001: Mechanizm motywu: zakres CSS z tokenami ról

### Status
Accepted

### Context
Paleta organizatora ma przebarwiać stronę organizatora, terminu i produktu. Wszystkie trzy strony używają Tailwind v4 i arkusza `KragStage`; Chakra działa tylko w `/admin` (V1). Kompilacja `index.css` repozytorium wykazała, że utility z nazwanymi tokenami kompilują się do `var(--color-*)`, więc nadpisanie zmiennych na elemencie-opakowaniu przebarwia poddrzewo (V2). Zmienne pochodne zadeklarowane na `:root` „zamarzają” (V3), a Tailwind usuwa nieużywane zmienne motywu (V4). W `src/` nie ma portali (V5).

### Decision Drivers
- Zweryfikowany empirycznie mechanizm, bez nowych zależności
- Brak wpływu na panel, admin i chrom platformy
- Zero FOUC (motyw dostępny przy pierwszym renderze)
- Odporność na pułapkę „zamarzania” zmiennych pochodnych

### Considered Options
1. `OrganizerThemeScope`: element z inline `style` ustawiającym wszystkie 13 tokenów-liści, policzonych w JS (`useMemo`)
2. Chakra `colorPalette` / zagnieżdżony `ChakraProvider`
3. Nadpisanie tylko 2 zmiennych (`--color-mint`, `--color-lime`) i odcienie przez CSS `color-mix()` na `:root`
4. Motyw na poziomie `PublicLayout` (trasa)

### Decision Outcome
Chosen option: 1, because to jedyny wariant, który działa na stronach Tailwinda, nie zamarza na `:root`, nie wymaga zależności i daje pokolorowany pierwszy render. Zakres montujemy na górze komponentu strony (organizator, `TermPage` wokół `KragStage`, `OrganizerItemPage`), nigdy w `PublicLayout`.

### Consequences

#### Good
- Pełna izolacja: chrom platformy i panel zostają nietknięte.
- Nakładki i toasty strony terminu dziedziczą motyw, bo są w drzewie.
- Jedno API dla trzech stron i podglądu edytora.

#### Bad
- Wymaga migracji `KragStage` na `--color-*` i tokenizacji ~14 miejsc z hexami (ryzyka R1–R3).
- Element zakresu nie może mieć `transform`/`filter`/`contain` (reguła do pilnowania w przeglądzie).
- Przyszła nakładka z portalem musi dostać `portalled={false}` lub własny zakres.

---

<a id="adr-002"></a>
## ADR-002: Model kolorów: presety + „Własny” z autokorektą WCAG

### Status
Accepted

### Context
Organizator ma łatwo wybrać kolory, a tekst musi pozostać czytelny (WCAG AA 4,5:1) na trzech stronach dla dowolnego koloru. Domyślna paleta już dziś oblewa kilka par kontrastu (V14, X1). CSS `color-mix` nie potrafi wybrać koloru tekstu na primary ani skorygować kontrastu (C2). Prototyp ręcznego generatora OKLCH + WCAG spełnił progi dla 9 kolorów testowych przy 0,9 KB gz (wobec 6,8 KB gz dla `culori/fn`).

### Decision Drivers
- Łatwy edytor („szybki dobry wybór”) i swoboda koloru marki
- Gwarancja AA dla każdego koloru wejściowego
- Minimum zależności (`conventions.md`)
- Zachowanie dzisiejszego wyglądu domyślnego (poza zamierzonymi poprawkami)

### Considered Options
1. Tylko kuratorowane presety (4-A)
2. **Presety (8–12, ręczne mapy) + „Własny” (primary + opcjonalny accent) z widoczną autokorektą (4-B)**
3. Dwa swobodne kolory bez presetów (4-C)
4. Pełna kontrola ról (4-D)

### Decision Outcome
Chosen option: 2, because pokrywa szybki wybór i kolor marki naraz, a generator gwarantuje AA bez blokowania wyborów. Szczegóły: generator `src/frontend/src/theme/orgPalette.ts` napisany ręcznie (bez `culori`); paleta domyślna i presety to ręcznie dostrojone mapy hex, które **nie** przechodzą przez generator; backend waliduje tylko format hex (CHECK + Pydantic); edytor komunikuje przyciemnienie („Lekko przyciemniliśmy kolor…”) i „kolor za jasny”. W A1 naprawiamy kontrast domyślnej palety (`primary-fg #117b63`, jaśniejszy `primary-soft`, ciemniejsze sage/teal, ikona ink na teal).

### Consequences

#### Good
- AA dla każdego koloru, sprawdzane testami jednostkowymi na zestawie kolorów i na wszystkich presetach.
- Zmiana presetu globalnie (poprawka mapy) to jeden deploy.
- Zero nowych zależności.

#### Bad
- Kolor zapisany ≠ kolor wyświetlony przy korekcie (trzeba to komunikować).
- Stałe generatora wymagają strojenia wizualnego (G-b).
- Domyślny wygląd zmienia się minimalnie (R5, zrzuty przed/po).
- Backend nie liczy tokenów; jeśli kiedyś serwer ma renderować kolory (np. e-maile), trzeba będzie portu generatora.

---

<a id="adr-003"></a>
## ADR-003: Przechowywanie motywu i układu: kolumny + allowlista w kodzie

### Status
Accepted

### Context
`Organization` ma już `primary_color`/`accent_color` (`VARCHAR(7)`, CHECK hex) i dokumentuje „simple flat columns”. Potrzebny jest zapis układu i presetu. Przyszłe układy na zamówienie mają klucze `custom:<uuid>` (43 znaki), których nie da się przewidzieć w enumie (C8). Wzorzec kolumny z trwałym `server_default` istnieje (`0035_group_layout_mode`). `models.md` wymaga enumów jako stringów, nigdy ordinal.

### Decision Drivers
- Brak migracji przy dodaniu układu lub presetu
- Zgodność ze standardami `models.md`/`migrations.md`
- Brak spekulatywnych struktur (`minimal-implementation.md`)
- Odporność na wycofane klucze

### Considered Options
1. **`page_layout VARCHAR(64) NOT NULL DEFAULT 'CLASSIC'` + `palette_preset VARCHAR(40) NULL` + istniejące hexy; allowlisty w kodzie (`page_layouts.py`, `palettes.py`), bez natywnego enuma i bez CHECK**
2. `StrEnum` + `_enum_column(native_enum=False)` dla `page_layout`
3. `theme_settings` JSONB (układ, paleta, ustawienia per układ)
4. Rozpoznawanie presetu po hexach (bez kolumny `palette_preset`)

### Decision Outcome
Chosen option: 1, because klucze `custom:<uuid>` wykluczają enum po stronie ORM (wczytanie nieznanej wartości rzuciłoby błąd), a JSONB nie ma dziś wywołującego. Wybór presetu zapisuje klucz **i** jego kolory bazowe, więc nieznany preset degraduje się do generatora z hexów. Allowlisty rosną razem z rejestrem frontendu; test pilnuje zgodności zbiorów kluczy. Migracja: `0052_organization_page_layout` (zadanie A2).

### Consequences

#### Good
- Nowy darmowy lub płatny układ = zmiana kodu, bez migracji.
- Nieznany klucz w bazie nigdy nie psuje odczytu (fallback CLASSIC / generator).
- Zgodne z precedensem 0035.

#### Bad
- Baza nie broni się przed błędnym kluczem (tylko warstwa aplikacji).
- Dwie allowlisty (FE/BE) do synchronizacji — mitygowane testem.
- Ustawienia per układ (np. warianty hero) wymagają później `theme_settings` JSONB (D7).

---

<a id="adr-004"></a>
## ADR-004: Deklaratywny rejestr układów + jeden `LayoutRenderer`

### Status
Accepted

### Context
Pięć układów dzieli bloki (hero, about, terminy, wymiana), a dane są skąpe i zmienne (V13). Każdy blok musi znikać, gdy jest pusty, właściciel ma widzieć „duchy”, a układ — stan pusty bloku głównego (P-I). Przyszły płatny układ ma być „nowym wpisem w rejestrze” (P-G, wzorzec Shopify).

### Decision Drivers
- Spójna obsługa pustych stanów i duchów w jednym miejscu
- Przełączenie układu nigdy nie gubi treści
- Płatny/własny układ bez przepisywania silnika
- `minimal-implementation.md`: brak pól bez wywołującego

### Considered Options
1. **Rejestr `PageLayoutDefinition` (key, version, label, description, thumbnail, frame, blocks[] `{block, variant, props, primary, when}`, `recommendWhen`) + `LayoutRenderer` + biblioteka 17 bloków; bez `Component`, `minData`, `tier`**
2. Osobny komponent React na każdy układ (1b-B)
3. Układy jako dane w bazie (`page_layouts`, 1b-C)
4. Wariant 1 z polami `Component`/`minData`/`tier` od razu

### Decision Outcome
Chosen option: 1, because `isEmpty`, duchy i stany puste realnie wykorzystują kształt deklaratywny, a pola bez wywołującego dodajemy dopiero z pierwszym układem, który ich potrzebuje. Nieznany klucz → `resolveLayout` zwraca CLASSIC.

### Consequences

#### Good
- Logika pustych stanów w jednym miejscu, testowalna raz.
- Bloki są czystymi komponentami bez pobierania danych.
- Kształt `blocks` jest serializowalny do JSON, więc ewentualne układy w bazie użyją tego samego kontraktu.

#### Bad
- Mała warstwa abstrakcji (`when`, `primary`) do nauczenia.
- Układ wymagający niestandardowej wizualizacji wymaga później dodania `Component` (świadomie odroczone).

---

<a id="adr-005"></a>
## ADR-005: Zestaw pięciu układów

### Status
Accepted

### Context
Wymaganie mówi o 5 wybieralnych układach. Persony: studio/zajęcia (Kasia), trener, nauczyciel, społeczność wymiany, organizator „link-in-bio”. Wersja EXCHANGE z raportu v1 oblała test odrębności (była CLASSIC w innej kolejności). Przy samej nazwie odrębne pozostają tylko LINKS i CIRCLES:`featured`.

### Decision Drivers
- Realna odrębność struktury, nie tylko kolejności sekcji
- Pokrycie person
- Ekspozycja wyróżnika produktu (wymiana rzeczy)
- Działanie przy skąpych danych

### Considered Options
1. **CLASSIC (baza `ProfilMobilny`) · SCHEDULE „Plan zajęć” · CIRCLES „Grupy” (+`featured`, anonimowe miejsca) · LINKS „Wizytówka” · EXCHANGE „Wymiana” (tablica przedmiotów ze zdjęciami)**
2. TEAM zamiast EXCHANGE
3. 3 struktury × styl hero
4. 4 układy + SHOWCASE po galerii

### Decision Outcome
Chosen option: 1, because każdy układ ma inny blok główny i strukturę, a `featured` ratuje odrębność przy jednej grupie. Dostarczanie: CLASSIC + LINKS w A2, pozostałe w B. SHOWCASE „Magazyn” to przyszły kandydat płatny (E). Klucze stałe, etykiety polskie; „Układ strony” odróżniony od „Szablonu wizualizacji” (`layout_mode`).

### Consequences

#### Good
- Każda persona ma naturalny wybór; odznaka „Polecany” podpowiada.
- EXCHANGE eksponuje wymianę.

#### Bad
- Między A2 a B picker ma tylko 2 układy.
- EXCHANGE wymaga agregacji przedmiotów i `thumb_url`; SCHEDULE przy skąpych danych zbliża się do CLASSIC.
- Persony niezweryfikowane z użytkownikami (G-e).

---

<a id="adr-006"></a>
## ADR-006: Publiczny katalog organizatora w module `groups` z regułami prywatności

### Status
Accepted

### Context
Układy SCHEDULE, CIRCLES i EXCHANGE potrzebują grup, terminów i przedmiotów organizatora. Zależność modułów biegnie dziś tylko `groups → organizations` przez `organizations_acl.py`; endpoint w `organizations` wymagałby odwrotnego importu i ryzyka cyklu (C3). Persony to głównie grupy PRIVATE, a katalog nie może agregować nazwisk (C5).

### Decision Drivers
- Kierunek zależności DDD
- RODO i zaufanie rodziców
- Brak N+1 i limity SQL (`jooq.md`)
- Zero FOUC mimo dwóch żądań

### Considered Options
1. **`GET /api/groups/public/organizers/{slug}` (+ stronicowane `/terms`), tylko grupy PUBLIC, bez nazwisk, limity 60 dni/10/12/30, `needed_items`, `family_count` = null < 3, „zapisanych: N”; ~12 stałych zapytań wsadowych**
2. Jeden endpoint `/api/organizations/public/{slug}/page` (DL)
3. PRIVATE jako teaser lub „Poproś o dołączenie”
4. Jeden payload bez limitów i paginacji

### Decision Outcome
Chosen option: 1, because zachowuje kierunek zależności, nie ujawnia nowych danych (są już publiczne per termin) i ma przewidywalny koszt. Wiersz macierzy PUBLIC `^/api/groups/public/organizers/[^/]+(/terms)?$` stawiamy obok istniejących `/api/groups/public/...`, przed wierszem 26. Właściciela znajdujemy nową funkcją ACL `get_owner_party_id` (członkostwo aktywne + rola OWNER; `Organization.party_id` to strona organizacji, nie właściciela).

### Consequences

#### Good
- Brak cyklu modułów; motyw z pierwszego payloadu, katalog dociągany równolegle ze szkieletem.
- Prosty test prywatności (klucze JSON, PRIVATE).
- Test stałej liczby zapytań chroni przed regresją.

#### Bad
- Dwa żądania zamiast jednego.
- Organizatorzy z samymi grupami PRIVATE mają skromną stronę.
- Nowe funkcje wsadowe w bridge'ach (nie reużywamy pomocników per przedmiot).

---

<a id="adr-007"></a>
## ADR-007: Motyw strony terminu z payloadu serwera (`organizer_theme`)

### Status
Accepted

### Context
Strona terminu `/:slug/grupa/:groupId/term/:termId` ma slug w URL, ale jest on kosmetyczny i niezwalidowany: dowolny krąg dałoby się pokazać w barwach dowolnej organizacji. Resolver w `public_view.py` i tak ładuje wiersz `Organization`, by wyliczyć `organizer_slug`.

### Decision Drivers
- Wiarygodne źródło motywu
- Brak dodatkowych zapytań i żądań
- Brak FOUC

### Considered Options
1. **`PublicCircleResponse.organizer_theme: {primary_color, accent_color, palette_preset} | null`, także dla grup PRIVATE**
2. Motyw z `usePublicOrganization(slug z URL)`
3. Osobny endpoint brandingu grupy

### Decision Outcome
Chosen option: 1, because dane przychodzą w tym samym payloadzie co strona (zero FOUC, zero zapytań). Branding to nie dane członków, więc pole jest też w odpowiedzi PRIVATE. `palette_preset` dochodzi w A2 (w A1 `null`). Strona terminu nie dostaje `page_layout`.

### Consequences

#### Good
- Motyw nie do podrobienia przez URL.
- Wartość od razu po A1 (bez edytora).

#### Bad
- Kontrakt `PublicCircleResponse` rośnie; frontend musi obsłużyć `null` (organizatorzy `k-…`).

---

<a id="adr-008"></a>
## ADR-008: Edytor inline w dolnym arkuszu na własnej stronie

### Status
Accepted

### Context
Edycja ma być „łatwa”. Precedens z wcześniejszych prac: „widzę i decyduję” na prawdziwych komponentach, jawny zapis (V12). Kolory celowo usunięto z `/organization` (testy to egzekwują). Użytkownicy są głównie na telefonie (kolumna 430px).

### Decision Drivers
- Podgląd na prawdziwej stronie i danych
- Minimum nowego UI i nawigacji
- Spójność z przyszłym „podglądem przed zakupem” (E)
- Dostępność na telefonie

### Considered Options
1. **Tryb właściciela na `/:slug?edit=1`, niemodalny dolny arkusz z zakładkami „Układ” / „Kolory” (później „Treść”), strona pod arkuszem = podgląd, mini-karty terminu/produktu, wersja robocza w stanie React, jawne Zapisz/Anuluj, statyczne miniatury SVG + „Polecany”, duchy właściciela**
2. Osobna strona ustawień w panelu
3. Pełnoekranowy kreator
4. Autozapis zamiast jawnego zapisu; mini-rendery na żywo w pickerze

### Decision Outcome
Chosen option: 1, because daje najprawdziwszy podgląd bez osobnego ekranu, a wersja robocza w stanie React jest zwykłym renderem z innymi propsami. Wejścia: `AccountMenu` „Moja organizacja” i podpowiedź w `HomeView`. Tryb aktywny tylko dla właściciela (`useMyOrganization().slug === slug`).

### Consequences

#### Good
- Duchy działają jak lista kontrolna onboardingu i spełniają obietnicę `HomeView`.
- „Odblokuj” w E to zamiana przycisku w tym samym edytorze.

#### Bad
- Arkusz zasłania część strony (R14).
- Termin i produkt widać tylko jako mini-karty, nie pełne strony.
- Miniatury SVG nie pokazują danych organizatora (mini-rendery odroczone, D2).

---

<a id="adr-009"></a>
## ADR-009: Strona produktu w trasie zagnieżdżonej `/:slug/produkt/:id`

### Status
Accepted (odstępstwo użytkownika od rekomendacji badania `?org=`)

### Context
Przedmiot należy do użytkownika i może być wystawiony u wielu organizatorów; „organizator przedmiotu” nie istnieje, istnieje tylko kontekst nawigacji (V10). Badanie rekomendowało `?org=<slug>` z motywem tylko na obszarze treści w ramie panelu. Użytkownik wybrał trasę zagnieżdżoną, aby strona produktu wyglądała jak kontynuacja strony terminu.

### Decision Drivers
- Spójność wizualna terminu i produktu (ta sama rama publiczna, motyw na całej stronie)
- Czytelny, udostępnialny URL w kontekście organizatora
- Brak zmian w API przedmiotów i w uprawnieniach
- Zachowanie wejść z panelu i powiadomień

### Considered Options
1. `?org=<organizer_slug>` na `/product/:id`, motyw tylko na treści (6-A, rekomendacja badania)
2. `?term=<termId>` rozwiązywane na serwerze (6-B)
3. **Trasa zagnieżdżona `/:slug/produkt/:id` (+ `/edit`) w ramie publicznej (`PublicLayout`, jak strona terminu), za logowaniem, motyw na całej stronie; `/product/:id` zostaje dla panelu i powiadomień w palecie domyślnej**
4. Brak motywu na produkcie / organizator wyliczany z przedmiotu

### Decision Outcome
Chosen option: 3, because użytkownik priorytetyzuje ciągłość wyglądu termin → produkt. Motyw pochodzi z `usePublicOrganization(slug)`; nieznany slug lub `k-<hash>` → paleta domyślna. Link na stronie terminu buduje się ze zwalidowanego `organizer_slug` z odpowiedzi serwera. `"produkt"` trafia do `RESERVED_SLUGS`. Edycja i „Wróć” zachowują prefiks (`useItemRoutes`); fallback „Wróć” prowadzi do `/:slug`. `?term=` odroczone (D1). Odczyt przedmiotu przez dowolnego zalogowanego to zamierzone zachowanie, bez zmian.

### Consequences

#### Good
- Termin i produkt wyglądają jak jedna przestrzeń organizatora.
- Zero zmian w backendzie poza `RESERVED_SLUGS`.
- Wejścia z panelu działają jak dziś.

#### Bad
- Dwa URL-e tego samego przedmiotu; `ItemDetailPage`/`ItemEditPage` trzeba rozdzielić na ramę i treść.
- Slug jest kosmetyczny: ręcznie wpisany slug pokaże przedmiot w cudzych barwach (tylko za logowaniem, tylko wygląd).
- Wejścia z powiadomień nadal bez motywu (do D1).

---

<a id="adr-010"></a>
## ADR-010: Tylko szew pod płatne układy; kierunek sprzedaży: abonament + usługa

### Status
Accepted

### Context
Architektura ma pozwolić sprzedawać płatne układy, ale nie ma ani jednego płatnego układu, billingu ani potwierdzonego popytu (V11). Standard `minimal-implementation.md` zakazuje zaślepek „na przyszłość”. Rynek (Linktree, Carrd, Bookero) wlicza wygląd w abonament; licencje per element mają sens tylko na rynku wielu projektantów.

### Decision Drivers
- Zero kodu bez wywołującego
- Wszystko późniejsze czysto addytywne
- Strona organizatora nigdy offline (zależą od niej terminy i zapisy)

### Considered Options
1. **Teraz tylko szew: `page_layout VARCHAR(64)` z allowlistą, fallback rejestru do CLASSIC, treść ortogonalna do układu, `resolve_page_layout(org)` jako jedyne miejsce zwracające układ, wersja robocza w edytorze**
2. Szew + `organization_entitlements` i `effective_layout()` od razu (7a-B)
3. Pełny pakiet z billingiem i SHOWCASE (7a-C)

### Decision Outcome
Chosen option: 1, because każdy element szwu jest potrzebny pięciu darmowym układom. Kierunek na zadanie E: abonament „Organizator Pro” (~19–29 PLN netto/mies.) odblokowujący układy premium + usługa układu na zamówienie (`custom:<uuid>`, uprawnienie `source=SERVICE`, renderowany przy aktywnym abonamencie). Tabela `organization_entitlements(organization_id, kind, key, source ADMIN|SUBSCRIPTION|PURCHASE|SERVICE, valid_from, valid_to, external_ref)`, `tier` w rejestrze, `effective_layout()` opakowujące `resolve_page_layout`, „Odblokuj” zamiast „Zapisz”, baner downgrade'u. Downgrade: uprawnienie do końca okresu, ~14 dni karencji, potem CLASSIC w palecie organizatora; zapisany wybór zostaje.

### Consequences

#### Good
- Brak spekulatywnego kodu; E nie zmienia typu kolumny, URL-i ani danych.
- Podgląd przed zakupem jest gratis (wersja robocza edytora).

#### Bad
- Pierwsza sprzedaż wymaga całego zadania E.
- Cena, polityka downgrade'u i kwestie prawne PL/UE (14 dni odstąpienia, JDG jako konsument) niepotwierdzone (G-f, G-g, G-h).

---

<a id="adr-011"></a>
## ADR-011: Semantyka PATCH `model_fields_set`

### Status
Accepted

### Context
`PATCH /api/organizations/{id}` traktuje `None` jako „bez zmian”, więc kolorów nie da się wyczyścić (V6). Edytor potrzebuje „Przywróć domyślne”, a treść (C) — czyszczenia pól. Frontend wysyła tylko zmienione pola.

### Decision Drivers
- Reset kolorów i treści bez osobnych endpointów
- Zgodność wstecz
- Atomowość z moderacją (brak połowicznych zapisów)

### Considered Options
1. **Pydantic `model_fields_set`: pominięte = bez zmian, jawny `null` = wyczyść; `name`/`page_layout` nie przyjmują `null` (422); wszystkie `check_text` przed mutacją**
2. Osobny endpoint `DELETE .../theme`
3. Sentinel (np. pusty string = wyczyść)

### Decision Outcome
Chosen option: 1, because to standardowa semantyka JSON Merge Patch, nie zmienia dotychczasowych wywołań, a kolejność „waliduj wszystko → mutuj” zapewnia atomowość. Wyścigi zapisów łapie `updated_at` jako `version_id_col` (409).

### Consequences

#### Good
- Jeden endpoint dla układu, palety i treści.
- Testowalne trzy przypadki: pominięte, `null`, wartość.

#### Bad
- Frontend musi rozróżniać `undefined` i `null` w typach i w diffie wersji roboczej.

---

<a id="adr-012"></a>
## ADR-012: Podział zadań A1 → A2 ∥ B → C → D → D2

### Status
Accepted

### Context
Pierwotne zadanie A (motyw + układ + edytor) było duże i mieszało refaktor kolorów z nowym UI. Backend katalogu (B) nie zależy od motywu. Zdjęcia (D) wymagają dwóch repozytoriów i kolejności wdrożenia.

### Decision Drivers
- Małe, przeglądalne PR-y z mierzalnym wynikiem
- Wartość dla użytkownika jak najwcześniej
- Równoległość pracy
- Izolacja ryzyka wdrożenia między repozytoriami

### Considered Options
1. Jedno A + B + C + D + D2 (8-A)
2. **A1 „Motyw” → A2 „Układ i edytor” (CLASSIC + LINKS, w tym poprawka DELETE w macierzy) ∥ B-backend → B-frontend (SCHEDULE, CIRCLES, EXCHANGE) → C → D → D2; E później (8-B)**
3. Pionowe plastry per układ (8-C)
4. Najpierw cały backend (8-D)

### Decision Outcome
Chosen option: 2, because A1 to czysty refaktor z mierzalnym wynikiem (zrzuty przed/po, testy kontrastu), który od razu koloruje stronę terminu i produktu; A2 buduje na stabilnych tokenach; B-backend biegnie równolegle. Numery migracji przydzielane przy scaleniu.

### Consequences

#### Good
- Łatwiejsze przeglądy; regresje kolorów oddzielone od nowego UI.
- D (dwa repo) nie blokuje niczego poza D2.

#### Bad
- Jedna dodatkowa iteracja przeglądu i wdrożenia.
- A1 nie daje organizatorowi nowej funkcji edycji (kolory edytowalne od A2).
- Obietnica „1 z 5” spełniana etapami.

---

<a id="adr-013"></a>
## ADR-013: Etapowanie treści i mediów C → D → D2

### Status
Accepted

### Context
`Organization` nie ma treści (bio, tagline, linki, logo). Tekst moderuje synchronicznie Bielik `check_text` (fail closed), zdjęcia — cron ShieldGemma na VPS B, z kontraktem identycznego zestawu kolumn (V9). Bez treści CLASSIC i LINKS są ubogie, ale włączenie treści do A rozdmuchałoby i tak duże zadanie.

### Decision Drivers
- Małe, niezależnie wdrażalne kroki
- Kopiowanie znanych kontraktów (moderacja tekstu i zdjęć)
- Strona nigdy nie traci logo przez kolejkę moderacji
- Minimalizacja danych osobowych

### Considered Options
1. **Osobne zadania po A: C (tekst + linki) → D (logo/okładka, dwa repo) → D2 (galeria ≤12, `og:image`, `theme-color`)**
2. Treść tekstowa razem z A
3. Treść poza tą funkcją

### Decision Outcome
Chosen option: 1. Szczegóły:
- **C:** `tagline`, `bio`, `location` jako kolumny `VARCHAR` moderowane `check_text` (nowe `TextField` + `MESSAGES`); `links` JSONB (≤6, tylko https, tylko WWW i social); reguła danych kontaktowych tylko na `tagline`; bio jako zwykły tekst.
- **D:** tabela `organization_media` z kolumnami identycznymi jak `profile_avatars`; subject `ORGANIZATION_MEDIA` w cronie group-thing-ai; kolejność wdrożenia migracja → granty → cron; oczekujące zdjęcie nie zastępuje ostatniego zatwierdzonego (wariant B).
- **D2:** galeria ≤12, `og:image`, meta `theme-color`.

### Consequences

#### Good
- Każdy krok mały; zdjęcia (dwa repo) nie blokują motywu i układów.
- Brak parsera Markdown i ryzyka XSS (bio jako tekst).

#### Bad
- Przez pewien czas CLASSIC jest ubogi (duchy łagodzą to u właściciela).
- Wariant B nie ma precedensu w repo (G-d): wymaga niezmiennika „najwyżej jeden niezatwierdzony LOGO/COVER” i sprzątania starszych zatwierdzonych.
- Linki EMAIL/PHONE i podpisy zdjęć odroczone (D14).

---

<a id="adr-014"></a>
## ADR-014: Granice motywu: chrom neutralny, bez trybu ciemnego, stałe awatary

### Status
Accepted

### Context
Zakres motywu obejmuje treść stron, ale na tych stronach są też elementy platformy: pasek konta w `PublicLayout`, `NotificationBell`, tło `body`, rama panelu. Kolory awatarów rodzin pełnią funkcję tożsamości. Strony nie mają dziś trybu ciemnego. Ikona biała na teal („przynosi”) ma 2,32:1.

### Decision Drivers
- Wyraźna granica „przestrzeń organizatora” vs „przestrzeń użytkownika/platformy”
- Stabilność tożsamości rodzin między organizatorami
- Minimalny zakres

### Considered Options
1. **Chrom platformy neutralny (paleta domyślna); `theme-color` dopiero w D2; bez trybu ciemnego; stała `Avatar PALETTE`; „przynosi” = ikona ink na stałym teal**
2. Motyw na poziomie trasy (obejmuje pasek konta)
3. Generator liczy także wariant ciemny; awatary z odcienia primary; ciemniejszy teal

### Decision Outcome
Chosen option: 1, because utrzymuje jednoznaczną granicę motywu i najmniejszą zmianę wyglądu. Ciemniejszy teal pozostaje planem B, jeśli test wizualny ikony ink wypadnie źle.

### Consequences

#### Good
- Panel i powiadomienia zawsze wyglądają tak samo; brak „obcych barw” w przestrzeni użytkownika.
- Kolor rodziny jest stały w całej aplikacji.

#### Bad
- Pasek konta nad stroną organizatora nie dopasowuje się do palety.
- Tryb ciemny wymaga później rozszerzenia generatora (D12).
