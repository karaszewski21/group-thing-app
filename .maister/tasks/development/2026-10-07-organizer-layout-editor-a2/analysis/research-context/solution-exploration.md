# Eksploracja rozwiązań: strona organizatora — 5 układów + paleta kolorów

**Data:** 2026-10-07 · **Typ badania:** mieszane · **Pewność badania:** średnio-wysoka
**Wejścia:** `analysis/synthesis.md` (rev. 2), `outputs/research-report.md` (21 sekcji, §19 otwarte decyzje), `analysis/findings/deep-layouts.md`, `deep-colors.md`, `deep-content.md`, `deep-product-monetization.md` oraz pliki pierwszego przebiegu. Standardy: `global/minimal-implementation.md`, `backend/models.md`, `backend/queries.md`, `backend/security.md`, `frontend/data-fetching.md`.

Oznaczenia źródeł (jak w syntezie): `DL` deep-layouts · `DC` deep-content · `DCOL` deep-colors · `DPM` deep-product-monetization · `R§n` sekcja raportu · `S§n` sekcja syntezy · `V1…V14`, `C1…C12`, `P-A…P-L` identyfikatory z syntezy · `X1…X7` / `P1…P8` problemy poza zakresem.

**Jak czytać oceny (5 perspektyw).** W każdej tabeli: *Wykonalność*, *Wpływ na użytkownika*, *Prostota* i *Skalowalność* — wyżej znaczy lepiej. *Ryzyko* — opisane wprost („niskie” = lepiej).

---

## 1. Przeformułowanie problemu

### 1.1 Pytanie badawcze

Jak zaprojektować publiczną stronę organizatora (`/:organizationSlug`), na której organizator wybiera 1 z 5 układów i paletę kolorów? Paleta ma przebarwiać też stronę terminu i produktu (stała struktura, zmieniają się tylko kolory). Edytor ma być prosty, a architektura gotowa na płatne układy na zamówienie.

### 1.2 Ograniczenia, które obowiązują we wszystkich obszarach

- Strony docelowe to Tailwind v4 + zmienne CSS; Chakra tylko w `/admin` (V1).
- Mechanizm motywu jest zweryfikowany empirycznie: nadpisanie `--color-*` na elemencie-opakowaniu przebarwia poddrzewo; zmienne pochodne na `:root` „zamarzają” (V2, V3). Brak portali (V5).
- Dane są wąskim gardłem: `Organization` nie ma treści, `Group`/`Term` nie mają pojemności ani miejsca, persony 2–4 to głównie grupy PRIVATE (V6, V7, V13).
- `minimal-implementation.md`: żadnych zaślepek „na przyszłość” ani spekulatywnych abstrakcji. To ogranicza zakres „gotowości na płatne”.
- Prywatność: katalog nie może agregować nazwisk ani ujawniać grup PRIVATE (C5, R§11.3).
- Moderacja: tekst synchronicznie przez Bielik `check_text`, zdjęcia przez cron na VPS B (V9).

### 1.3 Pytania „Jak moglibyśmy…” (HMW)

| # | HMW | Obszar decyzji |
|---|---|---|
| HMW1 | Jak moglibyśmy dać organizatorowi 5 **naprawdę różnych** układów, mimo że większość ma dziś tylko nazwę i jedną grupę? | 1 |
| HMW2 | Jak moglibyśmy pokazać publicznie grupy, terminy i wymianę organizatora, nie ujawniając grup prywatnych ani danych rodzin? | 2 |
| HMW3 | Jak moglibyśmy sprawić, żeby wybór układu i kolorów był „widzę i decyduję”, bez nauki nowego narzędzia? | 3 |
| HMW4 | Jak moglibyśmy pozwolić na dowolny kolor marki, gwarantując czytelność (WCAG AA) na trzech stronach? | 4 |
| HMW5 | Jak moglibyśmy wypełnić stronę treścią (opis, linki, logo, okładka), nie omijając moderacji i nie rozdmuchując pierwszej dostawy? | 5 |
| HMW6 | Jak moglibyśmy pokolorować stronę produktu, skoro przedmiot nie ma jednego „organizatora”? | 6 |
| HMW7 | Jak moglibyśmy przygotować się na płatne układy, nie budując dziś niczego, czego nikt nie wywoła? | 7 |
| HMW8 | Jak moglibyśmy pociąć prace tak, żeby szybko dostarczyć wartość i nie zablokować się na dwóch repozytoriach? | 8 |

---

## 2. Eksplorowane alternatywy

### Obszar 1 — Zestaw układów i sposób ich budowy (HMW1)

Ten obszar ma dwie osie: **(1a) jaki zestaw 5 układów** i **(1b) jak układy są zbudowane**. Kolejność dostarczania omawiamy w obszarze 8.

#### 1a. Zestaw układów

**1a-A. Zestaw z badania: CLASSIC · SCHEDULE „Plan zajęć” · CIRCLES „Grupy” (+`featured`) · LINKS „Wizytówka” · EXCHANGE „Wymiana” (tablica przedmiotów)**
- *Opis:* pięć układów, każdy z innym blokiem głównym i inną strukturą. CIRCLES przy jednej grupie przechodzi w wariant `featured` z mini-wizualizacją (anonimowe miejsca). EXCHANGE to katalog przedmiotów ze zdjęciami.
- *Mocne strony:* zachowuje klucze uzgodnione z użytkownikiem; każda persona ma naturalny wybór; `featured` ratuje odrębność przy jednej grupie; EXCHANGE eksponuje wyróżnik produktu (wymiana).
- *Słabe strony:* EXCHANGE wymaga agregacji przedmiotów i `thumb_url`; SCHEDULE przy skąpych danych upodabnia się do CLASSIC; trzy z pięciu układów zależą od zadania B.
- *Najlepszy, gdy:* chcemy dotrzymać obietnicy „1 z 5” i pokryć wszystkie persony.
- *Dowody:* DL §3–4.1 (alt. A), R§9.3–9.4, C4–C7, V13.

**1a-B. TEAM zamiast EXCHANGE (CLASSIC · SCHEDULE · CIRCLES · LINKS · TEAM „Drużyna/Klasa”)**
- *Opis:* piąty układ to strona jednej grupy z dużą wizualizacją (koło/boisko/stół) jako blokiem głównym.
- *Mocne strony:* najsilniejsze wizualne zróżnicowanie; pasuje do person 3–4 (nauczyciel, trener).
- *Słabe strony:* gubi stronę „wymiana najpierw”, czyli wyróżnik produktu; dubluje CIRCLES:`featured`; prywatne grupy trenera i tak nie trafią na stronę publiczną.
- *Najlepszy, gdy:* wymiana rzeczy okaże się marginalna w użyciu.
- *Dowody:* DL §4.1 (alt. B), V13.

**1a-C. 3 struktury × styl nagłówka = „5 wyglądów”**
- *Opis:* CLASSIC, LINKS, AGENDA jako struktury; do tego ustawienie stylu hero (okładka / kolor / kompakt). Prezentowane jako 5 gotowych kombinacji.
- *Mocne strony:* najmniej kodu; każdy „wygląd” działa przy samej nazwie.
- *Słabe strony:* to tak naprawdę ustawienia, nie układy; wymaga `theme_settings` JSONB już w MVP, czyli sprzeczne z etapowym przechowywaniem; edytor staje się dwuwymiarowy, a nie „prosty”.
- *Najlepszy, gdy:* zespół ma bardzo mało czasu i akceptuje słabszą odrębność.
- *Dowody:* DL §4.1 (alt. D), R§10.1, C10.

**1a-D. 4 układy teraz + SHOWCASE jako piąty po galerii (SCHEDULE wchłonięty przez CIRCLES jako zakładka)**
- *Opis:* mniej, ale bogatszych układów; piąty (SHOWCASE „Magazyn”) przychodzi z galerią.
- *Mocne strony:* każdy układ jest „pełny”; mniej bloków do utrzymania.
- *Słabe strony:* SHOWCASE jest bezużyteczny przed zadaniem D2; tracimy najlepszego kandydata na układ płatny; łamie wymaganie „5 układów” w pierwszej wersji.
- *Najlepszy, gdy:* galeria ma przyjść szybko, a SHOWCASE ma być darmowy.
- *Dowody:* DL §4.1 (alt. C), R§9.3 (SHOWCASE).

**Etykiety (dotyczy każdej alternatywy):** „Plan zajęć” zamiast „Grafik”, „Grupy” zamiast „Kręgi” w pickerze; klucze bez zmian; „Układ strony” odróżnione od „Szablonu wizualizacji” (`layout_mode`, ryzyko R12). DL §4.1.

#### 1b. Sposób budowy układów

**1b-A. Hybryda: deklaratywna lista bloków (JSON-serializowalna) + opcjonalny `Component` (rejestr `PageLayoutDefinition`)**
- *Opis:* każdy układ to wpis rejestru z ramą (`column`/`centered`) i listą slotów `{block, variant, when}`; jeden `LayoutRenderer` mapuje sloty na 17 bloków. Pole `Component` jest furtką dla układów na zamówienie.
- *Mocne strony:* puste bloki, stany puste i bloki-duchy obsłużone w jednym miejscu (P-I); płatny układ to nowy wpis; ten sam kształt pozwoli kiedyś trzymać układy w bazie.
- *Słabe strony:* `LayoutRenderer` + `when` to mała warstwa abstrakcji; pole `Component` nie ma wywołującego w MVP (patrz niżej).
- *Najlepszy, gdy:* układy dzielą bloki, a dane są skąpe i zmienne.
- *Dowody:* DL §5, R§9.5, P-G (Shopify schema/data/presets).

**1b-B. Osobny komponent React na każdy układ (`ClassicLayout.tsx`, …), współdzielone bloki importowane ręcznie**
- *Opis:* rejestr to prosta mapa `key → Component`. Każdy układ sam składa bloki i sam obsługuje puste stany.
- *Mocne strony:* najprostszy model mentalny; pełna swoboda wizualna w każdym układzie; zero „silnika”.
- *Słabe strony:* logika `isEmpty`/duchów/stanu pustego powielona 5 razy; trudniej zagwarantować „przełączenie układu nigdy nie gubi treści”; układy w bazie (przyszłość) wymagałyby przepisania.
- *Najlepszy, gdy:* układy prawie nie dzielą bloków albo ma być ich najwyżej 2–3.
- *Dowody:* DPM B6 (rejestr `key → component` wystarcza dla 5 układów), `minimal-implementation.md`.

**1b-C. Układy jako dane w bazie (`page_layouts` + JSON bloków) od razu**
- *Opis:* definicje układów w tabeli; frontend renderuje JSON.
- *Mocne strony:* nowy układ bez deployu; gotowe pod rynek układów.
- *Słabe strony:* spekulatywne (nikt dziś nie tworzy układów poza kodem); wersjonowanie danych i migracje definicji; łamie „No Speculative Abstractions”.
- *Najlepszy, gdy:* powstaje edytor układów dla organizatorów lub rynek projektantów.
- *Dowody:* R§15.4 („tabela `page_layouts` — może nigdy nie być potrzebna”), DPM B5–B6.

**Uwaga o minimalności (1b-A):** pole `Component?` i `minData`/`tier` w kontrakcie DL §5 nie mają wywołującego w 5 darmowych układach. Rekomendujemy 1b-A **bez** tych pól; dodajemy je z pierwszym układem, który ich potrzebuje. Kształt deklaratywny zostaje, bo `isEmpty` i duchy realnie go wykorzystują.

---

### Obszar 2 — Prywatność i dane publicznego katalogu (HMW2)

Wspólne we wszystkich alternatywach: endpoint należy do `groups` (`GET /api/groups/public/organizers/{slug}`, C3), bez nazwisk (C5), tylko przyszłe terminy, tylko aktywne prowadzenie.

**2-A. Tylko grupy PUBLIC, PRIVATE pominięte całkowicie; agregat z limitami SQL (60 dni / 10 terminów / 12 przedmiotów / 30 grup) + paginowane `/terms` dla SCHEDULE; `family_count` z progiem 3; na kartach „zapisanych: N”**
- *Mocne strony:* zero nowej ekspozycji (te dane są już publiczne per termin, V8); stały plan ~12 zapytań; prosty test autoryzacji.
- *Słabe strony:* organizatorzy z samymi grupami PRIVATE mają „pustą” stronę (V13); `/terms` to dodatkowy endpoint w B.
- *Najlepszy, gdy:* priorytetem jest RODO i zaufanie rodziców.
- *Dowody:* DC §4, R§11.2–11.4, C4, C6, C7.

**2-B. PRIVATE jako „teaser”: nazwa grupy + „zamknięta”, bez terminów i liczników**
- *Mocne strony:* strona trenera/nauczyciela nie jest pusta; pokazuje skalę działalności.
- *Słabe strony:* ujawnia istnienie i nazwę grup prywatnych („Klasa 2b SP 12” to już informacja o dzieciach); organizator mógł nie chcieć tego pokazywać; wymaga dodatkowej flagi „pokaż na stronie” per grupa, żeby było zgodne z intencją.
- *Najlepszy, gdy:* nazwy grup są z natury niewrażliwe (np. „Orliki 2017”) i dodamy opt-in.
- *Dowody:* R§19 decyzja 3, R§11.3.

**2-C. PRIVATE jako karta „Poproś o dołączenie” (reużycie `RequestAccessDialog`)**
- *Mocne strony:* zamienia pustą stronę w kanał pozyskania członków; komponent już istnieje (`RequestAccessDialog.tsx`).
- *Słabe strony:* to nowy przepływ produktowy (zaproszenia z publicznego katalogu), a nie layout; te same problemy ujawnienia co 2-B; ryzyko spamu próśb.
- *Najlepszy, gdy:* produkt chce rosnąć przez strony organizatorów.
- *Dowody:* DCOL §3 (dialog istnieje), R§19 decyzja 3.

**2-D. Jeden payload bez limitów i bez paginacji (wszystko w agregacie)**
- *Mocne strony:* najprostszy frontend; brak `/terms`.
- *Słabe strony:* ryzyko N+1 i dużych odpowiedzi przy aktywnych organizatorach; łamie „enforced SQL-level LIMIT” z `jooq.md`.
- *Najlepszy, gdy:* nigdy przy publicznym endpoincie.
- *Dowody:* `standards/backend/jooq.md`, R§11.4.

**Warianty liczb (dotyczy 2-A):** (i) `family_count` tylko z członków PUBLIC, `null` < 3 — rekomendowane; (ii) liczyć też jednorazowe zapisy — więcej, ale miesza pojęcia; (iii) bez statystyk w ogóle — najbezpieczniej, ale CLASSIC traci kafel. Na kartach grup „zapisanych: N” z najbliższego terminu (C7).

---

### Obszar 3 — Edytor i picker układów (HMW3)

**3-A. Tryb edycji na własnej stronie `/:slug?edit=1` z dolnym arkuszem „Układ / Kolory” (później „Treść”); statyczne miniatury SVG + odznaka „Polecany”; strona pod arkuszem = podgląd; jawne Zapisz/Anuluj; wersja robocza w stanie React**
- *Mocne strony:* „widzę i decyduję” na prawdziwych danych (V12); zero osobnego ekranu; bloki-duchy działają jako lista kontrolna; wersja robocza od razu służy jako „podgląd przed zakupem” (DPM B4).
- *Słabe strony:* arkusz zasłania część strony w kolumnie 430px; przełącznik podglądu terminu/produktu to mini-karty, nie pełne strony.
- *Najlepszy, gdy:* edycji jest mało (układ, paleta, kilka pól), a użytkownicy są na telefonie.
- *Dowody:* R§13, C11, UX-PRIOR P1, EXT-SAAS (Hi.Events), DL §1 (duchy).

**3-B. Osobna strona ustawień w panelu (`/organization/wyglad`) z formularzem i podglądem obok/pod spodem**
- *Mocne strony:* znane miejsce „ustawień”; łatwe testy formularza; nie miesza trybów na stronie publicznej.
- *Słabe strony:* podgląd to druga instancja renderera w ramie panelu — mniejszy, mniej „prawdziwy”; kolory celowo usunięto z `/organization` (testy to egzekwują), więc odwracamy wcześniejszą decyzję; wymaga osobnej nawigacji.
- *Najlepszy, gdy:* edytor rozrośnie się do wielu ustawień albo wejdzie desktop.
- *Dowody:* UX-PRIOR, `OrganizationPage.test.tsx:78-98`, FE-SEAMS.

**3-C. Pełnoekranowy edytor (kreator krok po kroku: układ → kolory → treść → publikuj)**
- *Mocne strony:* świetny onboarding dla nowego organizatora; jasny „lejek”.
- *Słabe strony:* ciężki dla drobnej zmiany koloru; najwięcej nowego UI; kreator przy pustych danych pokazuje puste układy.
- *Najlepszy, gdy:* chcemy prowadzić nowych organizatorów od zera.
- *Dowody:* EXT-A11Y F5, R§13 (brak precedensu kreatora w repo).

**Oś miniatur (niezależna):**
- *(i) statyczne SVG + „dla kogo” + „Polecany” liczone z danych* — tanie, przewidywalne, ale nie pokazują danych organizatora;
- *(ii) mini-render na żywo każdego układu z danymi organizatora* — najbardziej „uczciwe” przy skąpych danych, ale 5 rendererów naraz w arkuszu i ryzyko wydajności;
- *(iii) bez miniatur, tylko lista nazw + przełączanie strony pod arkuszem* — najprostsze, ale słaba odkrywalność.
Dowody: DL §4 pkt 2, R§13 pkt 6.

**Oś zapisu:** jawne Zapisz (rekomendowane; PATCH z `model_fields_set`, `await invalidateQueries`) vs autozapis (ryzyko zapisu połowicznych wyborów i niespójności z „Odblokuj” później) vs wersja robocza na serwerze (spekulatywne). Dowody: R§10.4, DPM B4, `data-fetching.md`.

---

### Obszar 4 — System kolorów (HMW4)

Wspólne: `OrganizerThemeScope` ustawia inline 13 tokenów ról; generator `orgPalette.ts` (~0,9 KB gz) liczony w `useMemo`; stałe tokeny jako `@theme static` (V2–V4, C2).

**4-A. Tylko kuratorowane presety (8–12 ręcznie dostrojonych map)**
- *Mocne strony:* każdy preset sprawdzony testem kontrastu; zero korekt kolorów „na oczach” użytkownika; najprostszy edytor.
- *Słabe strony:* brak koloru marki (np. organizator z logo w bordo); generator zbędny, ale i tak przydatny do testów; słabsze poczucie „to moja strona”.
- *Najlepszy, gdy:* chcemy minimalnej powierzchni i ewentualnie sprzedawać „Własny” jako płatny.
- *Dowody:* R§7.1 pkt 8, EXT-SAAS (Luma), S§5 pkt 3.

**4-B. Presety + „Własny” (picker primary, accent opcjonalnie „automatyczny”), generator koryguje kontrast i edytor to pokazuje**
- *Mocne strony:* pokrywa 90% przypadków presetami i 100% przez „Własny”; AA gwarantowane dla dowolnego koloru (9 kolorów testowych, R§7.2); wzorzec Luma/Squarespace.
- *Słabe strony:* kolor zapisany ≠ kolor wyświetlony (przyciemnienie) — trzeba to komunikować; stałe generatora wymagają strojenia (G-b).
- *Najlepszy, gdy:* chcemy prostego edytora i swobody marki naraz.
- *Dowody:* DCOL §5, R§7, R§13 pkt 2.

**4-C. Dwa swobodne kolory (primary + accent) bez presetów**
- *Mocne strony:* najmniej UI; zgodne z obecnym modelem danych (`primary_color`, `accent_color`).
- *Słabe strony:* organizatorzy bez wyczucia kolorów dobiorą brzydkie pary; brak „szybkiego dobrego wyboru”; generator pracuje zawsze, więc domyślny wygląd się zmienia (cream `#eff9f5` zamiast `#f4f8f0`).
- *Najlepszy, gdy:* odbiorcy to głównie marki z gotowym brandbookiem.
- *Dowody:* S§5 pkt 3, R§7.1 pkt 8.

**4-D. Pełna kontrola ról (osobny kolor tła, tekstu, linii…)**
- *Mocne strony:* maksymalna swoboda.
- *Słabe strony:* nie da się zagwarantować WCAG bez blokowania wyborów; sprzeczne z „łatwym edytorem”; wymaga JSONB z ustawieniami.
- *Najlepszy, gdy:* płatny tryb zaawansowany w odległej przyszłości.
- *Dowody:* EXT-TOK (wzorzec „seed → role”), R§7.

**Decyzje szczegółowe (osobne osie):**

| Oś | Opcje | Rekomendacja | Dowody |
|---|---|---|---|
| Zapis presetu | (a) kolumna `palette_preset VARCHAR(40) NULL` + kolory wejściowe; (b) rozpoznawanie presetu po hexach; (c) tylko hexy, presety przez generator | **(a)**: ręczne mapy, globalne poprawki presetu jednym deployem, nieznany klucz → generator z zapisanych hexów | R§10.1, S§5 pkt 3, R§19 d.13 |
| Walidacja backendu | (a) tylko hex (CHECK + Pydantic); (b) lustrzany WCAG w Pythonie (~20 linii); (c) backend liczy i zapisuje tokeny | **(a)**: generator koryguje każdy kolor, nie ma czego odrzucać | R§7.3, R§19 d.14 |
| Kontrast domyślnej palety | (a) naprawić w A (`primary-fg #117b63`, `primary-soft` L 0,95, ciemniejszy sage/teal); (b) osobne zadanie; (c) zostawić | **(a)**: tokeny i tak są przepisywane; zrzuty przed/po (R5) | X1/P1, DCOL §3.6 |
| Teal „przynosi” | (a) ciemniejszy teal; (b) ikona ink na teal; (c) teal w motywie | **(b)** jako najmniejsza zmiana wyglądu; (a) jeśli test wizualny źle wypadnie | C9, R§19 d.10 |
| Awatary rodzin | (a) stała `Avatar PALETTE`; (b) wyprowadzana z odcienia primary | **(a)**: kolor tożsamości rodziny nie powinien zmieniać się między organizatorami | R§19 d.11 |
| Chrom platformy | (a) neutralny (pasek konta, `NotificationBell`, `body`, ramka panelu); (b) + `<meta name="theme-color">`; (c) zakres na poziomie trasy | **(a)** w A, **(b)** w D2 | R§5.2 pkt 6, R§19 d.12 |
| Tryb ciemny | (a) poza zakresem; (b) generator liczy też wariant ciemny | **(a)** — strony nie mają dziś trybu ciemnego | R§2 |

---

### Obszar 5 — Treść i media organizatora (HMW5)

**5-A. Treść jako osobne zadania po A: C (tekst + linki) → D (logo/okładka, dwa repo) → D2 (galeria, OG)**
- *Opis:* `tagline`/`bio`/`location` jako kolumny moderowane `check_text`, `links` JSONB z allowlistą, `organization_media` w potoku crona; oczekujące zdjęcie w wariancie B (ostatnie zatwierdzone zostaje).
- *Mocne strony:* każdy krok mały i wdrażalny osobno; zdjęcia (dwa repo, kolejność wdrożenia) nie blokują motywu; kopiujemy znane kontrakty (P-E, P-F).
- *Słabe strony:* przez jakiś czas CLASSIC jest ubogi (brak bio, okładki); obietnica `HomeView` „opis, kolory i logo” spełniona etapami.
- *Najlepszy, gdy:* chcemy szybko dostarczyć układy i kolory.
- *Dowody:* DC §1–3, R§10.2–10.3, R§16.

**5-B. Treść tekstowa razem z A, media osobno**
- *Mocne strony:* od pierwszej wersji strona ma opis i linki, więc CLASSIC i LINKS są pełne; zakładka „Treść” w edytorze od razu.
- *Słabe strony:* A i tak jest L; dochodzą 4 nowe `TextField` + `MESSAGES`, schematy, moderacja — A puchnie.
- *Najlepszy, gdy:* A jest podzielone na A1/A2 i treść wchodzi do A2.
- *Dowody:* R§16 (C zależy tylko od A: semantyka PATCH, edytor), DC §3.

**5-C. Treść poza tą funkcją (osobna inicjatywa „profil organizatora”)**
- *Mocne strony:* najmniejszy zakres; układy i kolory gotowe najszybciej.
- *Słabe strony:* CLASSIC/LINKS bez bio i linków są wydmuszką; `HomeView` nadal obiecuje coś, czego nie ma (X7); bloki-duchy prowadzą donikąd.
- *Najlepszy, gdy:* priorytetem jest wyłącznie warstwa wizualna.
- *Dowody:* DL §2 (bloki `about`, `link-stack` zależne od N), X7.

**Decyzje szczegółowe:**

| Oś | Opcje | Rekomendacja | Dowody |
|---|---|---|---|
| Format bio | (a) zwykły tekst, akapity `\n\n`; (b) ograniczony Markdown; (c) rich text | **(a)**: brak parsera, brak XSS, Bielik ocenia czysty tekst | R§10.2, DC §2 |
| Dane kontaktowe | (a) `ensure_no_contact_info` na tagline, nie na bio; (b) na obu; (c) na żadnym | **(a)**; uwaga: komunikat w `rules.py:11-14` jest na sztywno „Nazwa i opis” — wymaga parametryzacji | DC §1.1 |
| Linki EMAIL/PHONE | (a) dozwolone publicznie (wybór organizatora); (b) tylko WWW i social | **(b)** w C, (a) jako rozszerzenie po decyzji produktowej — mniej danych osobowych w katalogu | DC D-C3 |
| Oczekujące zdjęcie | (a) jak awatar (zastępuje od razu); (b) ostatnie zatwierdzone zostaje do akceptacji | **(b)**: strona nigdy nie traci logo przez kolejkę moderacji | DC §2 Option A/B, R11 |
| Limit galerii | 6 / **12** / 20 | **12** (produkt ma 10) | DC §2 |
| Podpisy zdjęć | teraz / **później** | później (nowy `TextField`, mało wartości) | R§19 d.18 |

---

### Obszar 6 — Kontekst motywu na stronie produktu (HMW6)

**6-A. `?org=<organizer_slug z odpowiedzi serwera>` w linkach ze strony terminu; motyw tylko na obszarze treści; domyślna paleta przy innych wejściach**
- *Mocne strony:* zero zmian w backendzie; cache `usePublicOrganization` zwykle ciepły; ramka panelu zostaje neutralna („przestrzeń użytkownika”).
- *Słabe strony:* parametr w URL można ręcznie podmienić (tylko kosmetyka za logowaniem); wejścia z powiadomień bez motywu; `ItemEditPage`/`ItemBackButton` muszą przenosić `location.search`.
- *Najlepszy, gdy:* MVP i większość wejść ze strony terminu.
- *Dowody:* DPM A4 (opcja a), R§14, V10.

**6-B. `?term=<termId>` rozwiązywane przez nowy endpoint grup**
- *Mocne strony:* wiarygodne źródło motywu; umożliwia „← wróć do terminu” i motyw w linkach z powiadomień (producenci mają `term.id`).
- *Słabe strony:* nowy endpoint brandingu terminu (także dla PRIVATE), nowy wiersz macierzy, przegląd prywatności; więcej pracy teraz.
- *Najlepszy, gdy:* potrzebny jest powrót do terminu lub motyw w powiadomieniach.
- *Dowody:* DPM A4 (opcja b, „Good v2”).

**6-C. Brak motywu na stronie produktu**
- *Mocne strony:* zero pracy; brak niejednoznaczności.
- *Słabe strony:* nie spełnia wymagania („paleta obowiązuje też na produkcie”).
- *Najlepszy, gdy:* wymaganie zostanie zmienione.
- *Dowody:* R§14 (odrzucone).

**6-D. Organizator wyliczany z przedmiotu (backend) albo „ostatnio odwiedzony” (localStorage)**
- *Mocne strony:* brak zmian w URL.
- *Słabe strony:* niejednoznaczne (przedmiot u wielu organizatorów, V10); „ostatni odwiedzony” maluje „Moje rzeczy” w obce barwy i jest niewspółdzielony.
- *Najlepszy, gdy:* nigdy — odrzucone w badaniu.
- *Dowody:* DPM A4 (opcje d, e).

Wspólne: strona produktu **zostaje za logowaniem** (publiczne `/details` + `/history` ujawniłyby rytm wymian i przedmioty członków grup PRIVATE; R§14, X2).

---

### Obszar 7 — Architektura płatnych układów (HMW7)

Oś (7a): co budować teraz. Oś (7b): model sprzedaży (decyzja produktowa, budowana później).

#### 7a. Zakres „teraz”

**7a-A. Tylko „szew”: `page_layout VARCHAR(64)` + allowlista w kodzie (bez natywnego enuma i CHECK), rejestr z fallbackiem do CLASSIC, treść ortogonalna do układu, klucz układu zwracany z jednego miejsca w serwisie, wersja robocza w edytorze**
- *Mocne strony:* każdy element jest potrzebny 5 darmowym układom (zgodne z `minimal-implementation.md`); wszystko późniejsze (uprawnienia, `tier`, katalog, `effective_layout`, „Odblokuj”) jest czysto addytywne.
- *Słabe strony:* pierwsza sprzedaż wymaga jeszcze jednego zadania (E).
- *Najlepszy, gdy:* nie ma jeszcze ani jednego płatnego układu ani billingu.
- *Dowody:* DPM B6, R§15.4, C8.

**7a-B. Szew + tabela `organization_entitlements` i resolver `effective_layout()` już teraz (nadawanie przez admina)**
- *Mocne strony:* można ręcznie „sprzedać” układ na zamówienie (przelew + admin) bez billingu; test downgrade’u od początku.
- *Słabe strony:* tabela i resolver bez płatnego układu to spekulacja (nikt ich nie wywoła z sensem); dodatkowe testy i migracja.
- *Najlepszy, gdy:* pierwszy klient na układ na zamówienie jest już umówiony.
- *Dowody:* DPM B2, B6 („LATER”), R13.

**7a-C. Pełny pakiet: uprawnienia + Stripe/P24 + SHOWCASE + strona cennika**
- *Mocne strony:* monetyzacja od pierwszego dnia.
- *Słabe strony:* SHOWCASE wymaga galerii (D2); kwestie prawne PL/UE niepotwierdzone (G-g); największe ryzyko harmonogramu; brak dowodu popytu.
- *Najlepszy, gdy:* walidacja płatności jest celem biznesowym tego kwartału.
- *Dowody:* R§15.2, G-g, R14.

#### 7b. Model sprzedaży (do decyzji później, kierunek teraz)

| Model | Opis | Za | Przeciw | Dowody |
|---|---|---|---|---|
| **Abonament „Organizator Pro”** (~19–29 PLN netto/mies.) odblokowujący układy premium (+ ew. „Własny” kolor) | jeden plan, wiersz uprawnienia per plan, mapa `PLAN_FEATURES` w kodzie | wzorzec platform, na których stoi biznes użytkownika (Linktree, Carrd, Bookero); przewidywalny przychód | wymaga billingu cyklicznego; polityka downgrade | DPM B1, R§15.1–15.2 |
| Licencja jednorazowa per układ | kup SHOWCASE raz | prosta płatność | ma sens tylko na rynku wielu projektantów (Shopify); mały przychód | DPM B1 |
| Usługa „układ na zamówienie” | jednorazowa opłata, `custom:<id>` w rejestrze, uprawnienie `source=SERVICE` | wysoka marża per klient; nie wymaga billingu cyklicznego | brak benchmarku ceny w PL (G-h); kod per klient do utrzymania | DPM B1, B5 |

Kierunek: **abonament jako podstawa + usługa na zamówienie jako dodatek** (rekomendacja: układ na zamówienie renderowany przy aktywnym abonamencie). Polityka downgrade: uprawnienie do końca okresu, ~14 dni windykacji, potem **CLASSIC w palecie organizatora, strona nigdy offline**, zapisany wybór zachowany (DPM B3, R§15.2). Podgląd przed zakupem = ta sama wersja robocza edytora z „Odblokuj” (DPM B4).

---

### Obszar 8 — Podział i kolejność zadań (HMW8)

**8-A. Podział z badania: A (motyw + układ + edytor, L) ∥ B-backend → B-frontend; potem C → D → D2; E później**
- *Mocne strony:* A i B-backend równolegle; zależności jasne; dwa repo dopiero w D.
- *Słabe strony:* A jest duże (tokeny + migracja `KragStage` + rejestr + edytor + `?org=` + hooki) — ryzyko długiej gałęzi; regresje kolorów na stronie terminu mieszają się z nowym UI.
- *Dowody:* R§16.

**8-B. A1/A2 + reszta jak w 8-A**
- *Opis:* **A1 „Motyw”**: tokeny ról, `@theme static`, migracja `KragStage` i zależnych, tokenizacja ~14 miejsc, naprawa kontrastu (X1), `orgPalette.ts`, `OrganizerThemeScope` na terminie (`organizer_theme` w `PublicCircleResponse`) i produkcie (`?org=`), naprawa X4/X5. Może wejść na produkcję z istniejącymi `primary/accent_color`. **A2 „Układ i edytor”**: `page_layout`, PATCH `model_fields_set`, `palette_preset`, rejestr, CLASSIC + LINKS, hooki TanStack (X6), edytor „Układ / Kolory”, wejścia z menu i `HomeView`.
- *Mocne strony:* A1 to czysty refaktor z mierzalnym wynikiem (zrzuty przed/po, testy kontrastu) — łatwy przegląd; A2 buduje na stabilnych tokenach; A1 od razu daje wartość (kolory organizatora na stronie terminu).
- *Słabe strony:* jedna dodatkowa iteracja przeglądu/wdrożenia; A1 nie ma widocznej nowej funkcji dla organizatora (kolory edytowalne dopiero w A2).
- *Dowody:* R§16 („można podzielić na A1/A2”), R1–R3, R5.

**8-C. Pionowe plastry per układ (plaster 1: motyw + CLASSIC + edytor kolorów; plaster 2: LINKS + C; plaster 3: B + SCHEDULE/CIRCLES; plaster 4: EXCHANGE; plaster 5: D/D2)**
- *Mocne strony:* każde wydanie to widoczna funkcja; łatwo priorytetyzować.
- *Słabe strony:* backend B jest wspólny dla trzech układów, więc i tak trzeba go zrobić w całości; migracja `KragStage` nie dzieli się na plastry; picker z 1–2 układami wygląda na niedokończony.
- *Dowody:* DL §4 (alt. E), C3–C4.

**8-D. Backend najpierw (wszystkie migracje i endpointy: A-BE, B, C, D), potem cały frontend**
- *Mocne strony:* jeden przegląd modelu danych; frontend bez czekania.
- *Słabe strony:* długo bez wartości dla użytkownika; D (dwa repo, cron) blokuje wszystko; sprzeczne z „build what you need”.
- *Dowody:* R§16 (D zależy od konfiguracji Spaces i kolejności wdrożenia).

**Gdzie trafiają znalezione defekty:**

| Defekt | Opcje | Rekomendacja | Uzasadnienie |
|---|---|---|---|
| X2/P2 — odczyt dowolnego przedmiotu po UUID (wysoka waga) | (a) osobne zadanie bezpieczeństwa **przed** A; (b) w A1 przy `?org=`; (c) w E | **(a), niezależnie i jak najszybciej** | to luka prywatności istniejąca dziś, niezwiązana z motywem; zmiana reguł dostępu wymaga własnych testów i przeglądu; `?org=` jej nie pogarsza |
| X3/P3 — DELETE pod `/api/organizations` w catch-all | (a) w D (pierwsza trasa DELETE); (b) w A2 przy zmianach organizacji; (c) osobno | **(b) w A2** (jedna linia w macierzy + test), najpóźniej w D | tanie, a A2 już dotyka `organizations`; nie zostawiamy otwartego wzorca do D |
| X4 (`KragStage` globalne style), X5 (danger), X1 (kontrast) | w A1 | A1 | ten sam kod, który i tak przepisujemy |
| X6 (`useState`+`useEffect`) | w A2 | A2 | strona i tak przebudowywana na hookach |
| X8/P8 (dokumentacja projektu nieaktualna) | osobno | osobno | poza zakresem funkcji |

---

## 3. Analiza kompromisów (5 perspektyw)

### Obszar 1a — zestaw układów

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **1a-A zestaw z badania** | średnia (EXCHANGE: agregacja + `thumb_url`) | wysoki (każda persona ma wybór) | średnia | średnie (układy puste przy skąpych danych, R7) | wysoka |
| 1a-B TEAM zamiast EXCHANGE | średnia | średni (traci wyróżnik wymiany) | średnia | średnie (dubel z `featured`) | średnia |
| 1a-C 3 struktury × hero | wysoka | niski (to ustawienia, nie układy) | niska (edytor 2D, JSONB w MVP) | średnie | niska |
| 1a-D 4 + SHOWCASE | niska (czeka na D2) | średni | średnia | wysokie (łamie „5”) | średnia |

### Obszar 1b — budowa układów

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **1b-A lista bloków + renderer (bez pól „na zapas”)** | wysoka | wysoki (spójne puste stany, duchy) | średnia | niskie | wysoka |
| 1b-B komponent per układ | wysoka | średni (niespójne puste stany) | wysoka | średnie (5× powielona logika) | średnia |
| 1b-C układy w bazie | średnia | taki sam | niska | wysokie (spekulacja) | bardzo wysoka |

### Obszar 2 — prywatność i dane

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **2-A tylko PUBLIC + limity + `/terms`** | wysoka | średni (pusto dla person PRIVATE) | średnia | niskie | wysoka |
| 2-B teaser PRIVATE | wysoka | średnio-wysoki | średnia (opt-in per grupa) | wysokie (ujawnienie nazw grup dzieci) | wysoka |
| 2-C karta „Poproś o dołączenie” | średnia | wysoki (kanał wzrostu) | niska (nowy przepływ) | wysokie (ujawnienie, spam) | średnia |
| 2-D bez limitów | wysoka | taki sam | wysoka | wysokie (N+1, łamie `jooq.md`) | niska |

### Obszar 3 — edytor

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **3-A tryb na stronie + arkusz + SVG + jawny zapis** | wysoka | wysoki („widzę i decyduję”) | wysoka | niskie | średnia (arkusz ma limit miejsca) |
| 3-B strona ustawień w panelu | wysoka | średni (podgląd „nieprawdziwy”) | średnia | średnie (odwraca decyzję + testy) | wysoka |
| 3-C pełnoekranowy kreator | średnia | wysoki dla nowych, niski dla zmian | niska | średnie | średnia |

### Obszar 4 — kolory

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 4-A tylko presety | wysoka | średni (brak koloru marki) | bardzo wysoka | bardzo niskie | średnia |
| **4-B presety + „Własny” z korektą** | wysoka (generator gotowy jako prototyp) | wysoki | wysoka | niskie (strojenie stałych, G-b) | wysoka |
| 4-C dwa swobodne kolory | wysoka | średni (brzydkie pary) | wysoka | średnie (zmiana domyślnego wyglądu) | średnia |
| 4-D pełna kontrola ról | niska | niski dla większości | niska | wysokie (WCAG) | wysoka |

### Obszar 5 — treść i media

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **5-A etapami C → D → D2 po A** | wysoka | średni na start, wysoki po C | wysoka (małe kroki) | niskie | wysoka |
| 5-B tekst w A, media osobno | wysoka | wysoki od startu | średnia (A puchnie) | średnie (dłuższa gałąź) | wysoka |
| 5-C treść poza funkcją | wysoka | niski (wydmuszki, X7) | bardzo wysoka | średnie (produktowe) | — |

### Obszar 6 — produkt

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **6-A `?org=`** | wysoka (0 zmian BE) | średnio-wysoki | wysoka | niskie (tylko kosmetyka) | średnia |
| 6-B `?term=` | średnia | wysoki (powrót do terminu, powiadomienia) | średnia | średnie (nowy publiczny odczyt) | wysoka |
| 6-C brak motywu | wysoka | niski (łamie wymaganie) | bardzo wysoka | niskie | — |
| 6-D wyliczany / localStorage | średnia | niski (złe kolory) | średnia | wysokie | niska |

### Obszar 7a — zakres „teraz” dla płatnych

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| **7a-A tylko szew** | wysoka | neutralny | wysoka | niskie (wszystko addytywne) | wysoka |
| 7a-B szew + uprawnienia teraz | wysoka | neutralny | średnia | średnie (kod bez wywołań) | wysoka |
| 7a-C pełny pakiet | niska | zależny od popytu | niska | wysokie (prawo, D2, harmonogram) | wysoka |

### Obszar 8 — podział

| Alternatywa | Wykonalność | Wpływ na użytk. | Prostota | Ryzyko | Skalowalność |
|---|---|---|---|---|---|
| 8-A A/B/C/D/D2 | wysoka | wysoki po A | średnia | średnie (duże A) | wysoka |
| **8-B A1/A2 + reszta** | wysoka | wysoki (A1 już koloruje termin) | wysoka (małe przeglądy) | niskie | wysoka |
| 8-C pionowe plastry | średnia | wysoki per wydanie | średnia | średnie (B nie dzieli się) | średnia |
| 8-D backend najpierw | wysoka | niski długo | średnia | wysokie (D blokuje) | wysoka |

**Główne napięcia:**
- *Wpływ na użytkownika vs prywatność* (obszar 2): teaser PRIVATE poprawia pustą stronę trenera, ale ujawnia grupy dzieci. Wybieramy prywatność, a pustkę łagodzimy układami LINKS i CIRCLES:`featured` oraz duchami.
- *Swoboda vs gwarancja* (obszar 4): „Własny” kolor bez korekty byłby prostszy w komunikacji, ale łamałby WCAG; korekta jest tania, bo generator już istnieje jako prototyp.
- *Gotowość na płatne vs minimalizm* (obszary 1b, 7): każde pole „na zapas” (`Component`, `tier`, `minData`, uprawnienia) dodajemy dopiero z pierwszym wywołującym.

---

## 4. Preferencje użytkownika

Ta faza nie zbierała nowych preferencji (orkiestrator robi konwergencję później). Z pytania badawczego i wcześniejszych zadań wynikają ustalone ramy:
- **5 układów** do wyboru, klucze `CLASSIC/SCHEDULE/CIRCLES/LINKS/EXCHANGE` (uzgodnione wcześniej, DL §4.1);
- paleta obowiązuje na stronie organizatora, terminu i produktu; **struktura terminu i produktu bez zmian**;
- **łatwy edytor**;
- architektura **gotowa** na płatne układy na zamówienie, ale bez billingu w tej funkcji (R§2: billing poza zakresem);
- poza zakresem: tryb ciemny, zmiana struktury stron terminu i produktu (R§2).
- Standardy projektu (`minimal-implementation.md`, `data-fetching.md`, `models.md`) traktujemy jako preferencje zespołu.

---

## 5. Rekomendowane podejście

### 5.1 Rekomendowana kombinacja

| Obszar | Rekomendacja | Pewność |
|---|---|---|
| 1a Zestaw układów | **1a-A**: CLASSIC · SCHEDULE „Plan zajęć” · CIRCLES „Grupy” (+`featured`, anonimowe miejsca) · LINKS „Wizytówka” · EXCHANGE „Wymiana” (tablica przedmiotów) | średnio-wysoka (struktura), średnia (persony) |
| 1b Budowa | **1b-A** w wersji odchudzonej: rejestr deklaratywnych list bloków + `LayoutRenderer` + `isEmpty`/duchy; **bez** `Component`, `minData`, `tier` do pierwszego wywołującego | średnio-wysoka |
| 2 Katalog | **2-A**: tylko PUBLIC, bez nazwisk, limity SQL 60 dni/10/12/30, `needed_items`, paginowane `/terms` w B, `family_count` z progiem 3, „zapisanych: N” na kartach | wysoka (zasady), średnia (progi) |
| 3 Edytor | **3-A**: `/:slug?edit=1`, arkusz „Układ / Kolory” (później „Treść”), statyczne SVG + „dla kogo” + „Polecany”, strona pod arkuszem jako podgląd, mini-karty terminu/produktu, jawne Zapisz/Anuluj, wersja robocza w stanie React, kolumna 430px | średnio-wysoka |
| 4 Kolory | **4-B**: 8–12 presetów (ręczne mapy) + „Własny” z widoczną korektą; zapis `palette_preset` + kolory wejściowe; backend tylko hex; naprawa kontrastu domyślnej palety w A1; „przynosi” = ikona ink na teal; stała paleta awatarów; chrom neutralny; bez trybu ciemnego | wysoka (mechanizm), średnio-wysoka (presety) |
| 5 Treść | **5-A**: C (tekst, linki WWW/social, bio jako zwykły tekst, `ensure_no_contact_info` na tagline) → D (logo/okładka, wariant B, dwa repo) → D2 (galeria ≤12, `og:image`, `theme-color`) | wysoka (kontrakty), średnia (wariant B) |
| 6 Produkt | **6-A**: `?org=` ze slugu z odpowiedzi serwera, motyw tylko na treści, strona za logowaniem; `?term=` jako v2 | średnio-wysoka |
| 7 Płatne | **7a-A** (tylko szew) + kierunek **abonament „Organizator Pro” + usługa na zamówienie**; downgrade → CLASSIC w palecie, strona nigdy offline, wybór zachowany | średnio-wysoka (szew), nisko-średnia (cena, downgrade) |
| 8 Podział | **8-B**: A1 (motyw) → A2 (układ + edytor, CLASSIC + LINKS) ∥ B-backend → B-frontend (SCHEDULE, CIRCLES, EXCHANGE) → C → D → D2; E później. X2/P2 osobne zadanie bezpieczeństwa od razu; X3/P3 w A2 | wysoka |

### 5.2 Uzasadnienie

Rekomendacja łączy **zweryfikowany mechanizm** (zakres CSS + generator, V2–V5) z **danymi jako ścieżką krytyczną** (V6–V8, V13). A1 dostarcza kolory organizatora na stronę terminu i produktu bez żadnych nowych danych. A2 daje dwa układy, które działają przy samej nazwie (CLASSIC, LINKS), i edytor. B dodaje trzy układy zależne od danych dopiero, gdy jest publiczny model odczytu. Prywatność ma pierwszeństwo przed „pełnością” strony, a pustkę łagodzą duchy, „Polecany” i `featured`. Gotowość na płatne ogranicza się do elementów, których 5 darmowych układów i tak potrzebuje, więc nie łamie `minimal-implementation.md`.

### 5.3 Akceptowane kompromisy

- Przez okres między A2 a B picker pokazuje 2 aktywne układy (pozostałe oznaczone „wkrótce” albo ukryte) — obietnica „1 z 5” przychodzi etapami.
- Organizatorzy z samymi grupami PRIVATE mają skromną stronę (LINKS / CLASSIC z nazwą i treścią).
- „Własny” kolor może zostać lekko przyciemniony — komunikujemy to w edytorze zamiast pozwalać na nieczytelny tekst.
- Domyślny wygląd zmienia się minimalnie (naprawa kontrastu X1).
- Strona produktu ma motyw tylko przy wejściu ze strony terminu.
- Pierwsza sprzedaż wymaga osobnego zadania E (uprawnienia, billing, SHOWCASE).

### 5.4 Kluczowe założenia (gdy któreś jest fałszywe, rekomendacja się zmienia)

1. **Organizatorzy wolą prywatność grup od „pełnej” strony.** Jeśli wielu chce pokazywać grupy PRIVATE → rozważyć 2-B z opt-in per grupa.
2. **Wymiana rzeczy jest istotnym wyróżnikiem.** Jeśli nie → 1a-B (TEAM) zamiast EXCHANGE.
3. **Większość ruchu na stronę produktu przychodzi ze strony terminu.** Jeśli dominują powiadomienia → przyspieszyć 6-B (`?term=`).
4. **Generator da się dostroić wizualnie** na prawdziwych kolorach bez zmiany algorytmu (G-b). Jeśli nie → 4-A (tylko presety) na start.
5. **Mechanizm działa też w Firefox/Safari** (spec + Baseline; testowano tylko Chromium, G-a). Test w A1 to potwierdzi.
6. **Nie ma umówionego klienta na układ na zamówienie w najbliższym czasie.** Jeśli jest → 7a-B (uprawnienia nadawane przez admina) zamiast czekać na E.
7. **Plan ~12 stałych zapytań jest wykonalny** (G-c). Jeśli nie → zmniejszyć zakres agregatu (np. `exchange.items` przenieść do osobnego zapytania EXCHANGE).

**Ogólna pewność rekomendacji:** średnio-wysoka.

---

## 6. Dlaczego nie inne

**Obszar 1a**
- *1a-B (TEAM):* dubluje CIRCLES:`featured` i usuwa jedyny układ eksponujący wymianę.
- *1a-C (3 × hero):* to ustawienia przebrane za układy; wymaga JSONB z ustawieniami w MVP i komplikuje edytor.
- *1a-D (4 + SHOWCASE):* SHOWCASE nie działa przed galerią, a tracimy kandydata na pierwszy płatny układ.

**Obszar 1b**
- *1b-B (komponent per układ):* logika pustych stanów i duchów powielona pięć razy; wspólne bloki i tak powstaną.
- *1b-C (układy w bazie):* brak wywołującego — spekulacja wprost zakazana przez standard.

**Obszar 2**
- *2-B (teaser):* ujawnia nazwy grup, często z danymi o dzieciach (klasa, rocznik).
- *2-C (prośba o dołączenie):* nowy przepływ produktowy z tymi samymi problemami ujawnienia; osobna inicjatywa.
- *2-D (bez limitów):* łamie standard zapytań i grozi N+1.

**Obszar 3**
- *3-B (strona w panelu):* słabszy podgląd i odwrócenie świadomej decyzji (kolory usunięte z `/organization`).
- *3-C (kreator):* najwięcej nowego UI, a przy skąpych danych pokazuje puste układy.

**Obszar 4**
- *4-A (tylko presety):* brak koloru marki, przy tym generator kosztuje ~0,9 KB i jest gotowy jako prototyp.
- *4-C (dwa swobodne kolory):* brak szybkiego dobrego wyboru i zmiana domyślnego wyglądu przez generator.
- *4-D (pełna kontrola ról):* nie da się zagwarantować WCAG i nie jest „łatwy”.

**Obszar 5**
- *5-B (tekst w A):* rozdmuchuje i tak duże A; C jest małe i może iść zaraz po A2.
- *5-C (poza funkcją):* CLASSIC i LINKS bez bio i linków to wydmuszki; obietnica `HomeView` dalej pusta.

**Obszar 6**
- *6-B (`?term=`):* dobre v2, ale teraz to nowy publiczny odczyt z przeglądem prywatności bez wyraźnej potrzeby.
- *6-C (brak motywu):* łamie wymaganie.
- *6-D (wyliczany / localStorage):* niejednoznaczny i maluje przestrzeń użytkownika w obce barwy.

**Obszar 7**
- *7a-B (uprawnienia teraz):* kod bez wywołującego, dopóki nie ma płatnego układu.
- *7a-C (pełny pakiet):* blokowany przez galerię i kwestie prawne, bez dowodu popytu.
- *Licencja per układ:* ma sens tylko na rynku wielu projektantów.

**Obszar 8**
- *8-A (jedno A):* duża gałąź mieszająca refaktor kolorów z nowym UI — trudny przegląd i większe ryzyko R1–R3.
- *8-C (plastry):* backend B nie dzieli się na układy, a migracja `KragStage` nie dzieli się na plastry.
- *8-D (backend najpierw):* długo bez wartości, a D (dwa repo) blokuje całość.

---

## 7. Zakres: klasyfikacja

| Element | Klasa | Uwagi |
|---|---|---|
| Tokeny ról, `OrganizerThemeScope`, `orgPalette.ts`, migracja `KragStage` | w zakresie | A1 |
| `page_layout`, rejestr, CLASSIC + LINKS, edytor „Układ / Kolory” | w zakresie | A2 |
| Publiczny model odczytu grup + SCHEDULE/CIRCLES/EXCHANGE | w zakresie | B |
| `?org=` na produkcie | w zakresie | A1 |
| Treść tekstowa i linki | w zakresie (rozciągnięcie konieczne dla sensu układów) | C |
| Logo i okładka (dwa repo) | w zakresie / rozciągnięcie | D |
| Galeria, `og:image`, `theme-color` | rozciągnięcie | D2 |
| Uprawnienia, billing, SHOWCASE | rozciągnięcie (później) | E |
| X1, X4, X5, X6 | w zakresie (ten sam kod) | A1/A2 |
| X3 DELETE w macierzy | w zakresie (tania poprawka przy okazji) | A2 |
| X2 odczyt dowolnego przedmiotu | **poza zakresem** — osobne pilne zadanie | — |
| Tryb ciemny, szerokie układy desktopowe, publiczna strona produktu | poza zakresem | odroczone |

---

## 8. Odroczone pomysły

| # | Pomysł | Klasa | Dlaczego warto później | Wyzwalacz |
|---|---|---|---|---|
| D1 | `?term=` na produkcie + „← wróć do terminu” + motyw w linkach z powiadomień | rozciągnięcie | wiarygodny kontekst i lepsza nawigacja | potrzeba powrotu do terminu lub motywu w powiadomieniach |
| D2 | Mini-rendery układów na żywo w pickerze | rozciągnięcie | „uczciwe” miniatury przy skąpych danych | gdy statyczne SVG mylą użytkowników |
| D3 | Szerokie warianty desktopowe układów | rozciągnięcie | lepszy odbiór na komputerze (linki z WWW) | ruch desktopowy > ~30% |
| D4 | SHOWCASE „Magazyn” jako pierwszy płatny układ (`minData`: okładka + ≥4 zdjęcia) | rozciągnięcie | kandydat do „Organizator Pro” | po D2 i decyzji o monetyzacji |
| D5 | `organization_entitlements`, `effective_layout()`, katalog `GET /api/organizations/layouts`, `tier`, „Odblokuj”, okres próbny | rozciągnięcie | monetyzacja | pierwszy płatny układ lub klient na zamówienie |
| D6 | Billing Stripe/P24 z cyklicznym BLIK, windykacja, konsultacja prawna (odstąpienie, JDG) | poza zakresem | sprzedaż abonamentu | decyzja biznesowa o płatnościach |
| D7 | `theme_settings` JSONB + `schema_version` (ustawienia per układ) | poza zakresem | warianty bez nowych kluczy | pierwszy układ z ustawieniami |
| D8 | Tabela `page_layouts` (układy jako dane) / edytor układów | poza zakresem | rynek układów bez deployu | wielu klientów na zamówienie lub projektanci zewnętrzni |
| D9 | Grupy PRIVATE na stronie z opt-in („pokaż na stronie”) lub karta „Poproś o dołączenie” | poza zakresem | kanał wzrostu, pełniejsza strona trenera | sygnał od organizatorów |
| D10 | Pojemność grupy/terminu („zostały 2 miejsca”), miejsce i tytuł terminu | poza zakresem | bogatsze karty i agenda | osobna funkcja modelu grup |
| D11 | Publiczny wąski widok przedmiotu (tylko PUBLIC, bez historii) | poza zakresem | udostępnianie przedmiotów poza logowaniem | osobne zadanie z przeglądem prywatności |
| D12 | Tryb ciemny (generator liczy wariant ciemny) | poza zakresem | spójność z preferencjami systemu | gdy cała aplikacja dostanie tryb ciemny |
| D13 | Paleta awatarów wyprowadzana z primary | poza zakresem | spójniejszy wygląd | po testach z rodzinami |
| D14 | Linki EMAIL/PHONE publicznie, podpisy zdjęć w galerii | rozciągnięcie | pełniejsza wizytówka | decyzja produktowa o danych kontaktowych |
| D15 | Opinie (`testimonials`) z moderacją | poza zakresem | blok dla SHOWCASE | po D4 |
| D16 | `culori/fn` dla P3 lub APCA | poza zakresem | szersza gama, nowszy model kontrastu | gdy WCAG 3 / P3 staną się wymaganiem |
| D17 | Propozycje standardów: „bez hexów na stronach publicznych”, „zmienne pochodne nigdy na `:root`”, „tokeny czytane poza utility jako `@theme static`” | proces | utrwalenie lekcji z A1 | po A1, przez `/maister:standards-update` |
| D18 | Aktualizacja `architecture.md` / `tech-stack.md` (X8) | poza zakresem | dokumentacja opisuje inną platformę | osobne zadanie dokumentacyjne |
