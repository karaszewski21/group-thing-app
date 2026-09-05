# Specyfikacja — `pages/` (Rodzinny grajdołek)

Dokument opisuje 7 komponentów w katalogu `pages/` — mobilny prototyp aplikacji dla grupy
zajęć umuzykalniających dla dzieci, łączący profil prowadzącej, "krąg grupy" (wymiana
rzeczy między rodzinami) oraz panele organizatora i gościa. Napisany na podstawie
faktycznego kodu (nie założeń) 2026-09-02.

## 0. Status i zakres

Wszystkie 7 plików to **samodzielne komponenty prototypowe** — każdy niesie własny CSS
(w template-literalu `const CSS = \`...\``), własny zestaw ikon SVG i własny stan
(`useState`), bez żadnej wspólnej warstwy. Nie ma:
- routera ani App shell, który by je spinał,
- backendu / API — cały stan żyje w pamięci komponentu i znika po odświeżeniu,
- pliku `package.json` / configu builda dla tego katalogu (żyje osobno od `src/frontend`
  i `plugins/`, które mają własne środowiska).

## 1. Krytyczne luki (do naprawy przed uruchomieniem)

| # | Problem | Gdzie | Skutek |
|---|---|---|---|
| 1 | Import `../data/photos` (`AVATAR_SRC`, `HERO_SRC`) wskazuje na plik, którego **nie ma w repo** | `ProfilMobilny.tsx:2`, `PanelOrganizatora.tsx:2` | Kod się nie skompiluje / nie odpali bez dopisania tego modułu |
| 2 | Brak App shell / routera | wszystkie | Callbacki nawigacyjne (`onOpenProfil`, `onOpenKrag`, `onOpenPanelOrganizatora`, `onOpenPanelGoscia`, `onOpenGallery`, `onBack`) nie mają obecnie żadnego wywołującego |
| 3 | Niespójna nazwa produktu: **"Rodzinny grajdołek"** (StronaGlowna, PanelOrganizatora, PanelGoscia, KragGrupyStart w komentarzu) vs **"Muzyczna Wioska"** (KragGrupy, KragGrupyStart w treści nagłówka, ProfilMobilny) | wielokrotnie | Trzeba ustalić jedną nazwę przed dalszą pracą |
| 4 | `KragGrupy.tsx` i `KragGrupyStart.tsx` są **identyczne w ~99%** (różnią się tylko liczbą rekordów w `FAMILIES` — 8 vs 2) | oba pliki | Każda zmiana UI wymaga edycji w dwóch miejscach osobno |
| 5 | `PanelOrganizatora.tsx` i `PanelGoscia.tsx` dzielą **~85% kodu** (cały CSS, cały zestaw ikon, typy `Profile`/`Term`/`Item`/`ItemMode`/`Gift`/`GiftSource`, logikę toastów) | oba pliki | To samo ryzyko co wyżej — jeden komponent z propem roli byłby bezpieczniejszy |

## 2. Wspólne wzorce UI (cross-cutting)

- **Ramka telefonu**: każda strona poza `StronaGlowna` renderuje się w `max-width:430px`
  "telefonie" wyśrodkowanym na jasnym tle (`.kg-stage`/`.org-stage`/`.mv-stage`/`.gal-stage`),
  z zaokrąglonymi rogami i cieniem od `520px` wzwyż (`@media (min-width:520px)`).
- **Fonty**: `Fraunces` (nagłówki, serif) + `Karla` (treść) ładowane przez Google Fonts —
  każda strona osobno wstrzykuje `<link>` w `useEffect` (kolejna kandydatka do wspólnego layoutu).
- **Toasty**: stały wzorzec `useState<string>` + `setTimeout(2200ms)` do potwierdzania
  zaślepionych akcji (np. "Zapisano dane profilowe", "Wylogowano — prototyp") — **żadna
  z tych akcji nic faktycznie nie zapisuje/wysyła**.
- **Modale**: bottom-sheet (`position:fixed`, wjeżdża z dołu, na desktopie wyśrodkowany)
  używany w `PanelOrganizatora` (3 formularze) i `PanelGoscia` (1 formularz) oraz jako
  lightbox w `GaleriaZdjec`.
- **Słowniczek trybów udostępniania rzeczy** — powtarza się w 3 miejscach z drobnymi
  różnicami w nazwach:
  - `KragGrupy`/`KragGrupyStart`: `"wymienię" | "pożyczę" | "oddam"`
  - `PanelOrganizatora`/`PanelGoscia`: `ItemMode = "wypożyczę" | "oddam" | "zamienię"`
  - Podarki (`GiftSource`): `"pożyczone" | "otrzymane" | "zamienione"`

  To są trzy osobne, nieujednolicone słowniki opisujące w gruncie rzeczy tę samą ideę
  (wypożyczam / oddaję na stałe / wymieniam się) — warto ujednolicić nazewnictwo w jeden
  wspólny enum, żeby "Twoje rzeczy" u gościa i "swap" w kręgu grupy mówiły tym samym językiem.

## 3. Strony — opis szczegółowy

### 3.1 `StronaGlowna.tsx` — strona główna / landing

**Layout**: desktopowy, pełna szerokość (jedyna strona bez ramki telefonu).

**Props**:
```ts
{
  onOpenProfil: () => void;
  onOpenKrag: () => void;
  onOpenPanelOrganizatora: () => void;
  onOpenPanelGoscia: () => void;
}
```

**Sekcje** (kolejność w DOM):
1. Sticky topbar z CTA "Wejdź do panelu" → `onOpenPanelGoscia`
2. Hero (zdjęcie tła + gradient, nagłówek, 2 CTA: "Poznaj prowadzącą" → `onOpenProfil`,
   "Zobacz krąg grupy" → `onOpenKrag`)
3. Przewijany pasek haseł (czysto dekoracyjny, `animation: lp-scroll`)
4. Sekcja "Czym jest" — zdjęcie + opis + tag "Pierwsze zajęcia zawsze bezpłatne"
5. Siatka 4 kart funkcji (`FEATURES`), każda z `onClick` mapowanym na jeden z 4 propsów
   przez klucz (`profil`/`krag`/`panel`/`gosc`)
6. "Jak to działa" — 3 kroki (czysto informacyjne, statyczne)
7. Cytat/opinia (statyczny, jeden przykład)
8. CTA stopki z 2 przyciskami → `onOpenPanelGoscia` / `onOpenPanelOrganizatora`
9. Stopka z dopiskiem "prototyp"

**Stan**: brak (poza efektem ładowania fontów). W pełni deklaratywna strona wizytówkowa.

---

### 3.2 `ProfilMobilny.tsx` — publiczny profil prowadzącej

**Nazwa pliku sugeruje "profil mobilny", ale w treści widnieje jako profil grupy
"Rodzinny grajdołek" / "Muzyczna Wioska" prowadzonej przez Zuzannę Karaszewską.**

**Props**:
```ts
{ onOpenGallery: () => void }
```
Brak `onBack` — przycisk "Wróć" w hero tylko pokazuje toast ("Powrót — prototyp"), nie
wywołuje żadnego callbacku. To niespójność względem reszty stron (`PanelOrganizatora`
ma pełną nawigację wewnętrzną, tu "Wróć" nie robi nic realnego).

**Zależność zewnętrzna**: `AVATAR_SRC`, `HERO_SRC` z `../data/photos` — **plik nie
istnieje w repo** (patrz §1).

**Sekcje**:
- Hero: zdjęcie tła, przyciski Wróć / Udostępnij (`navigator.clipboard.writeText(...)`
  + toast), awatar + nazwa + podtytuł, poziomy pasek miniaturek (`mv-thumbs` — obecnie
  bez zawartości/danych, sam markup)
- Pasek statystyk: Miejsce (statyczne "Jeżyce"), Rodziny (statyczne "32"), przycisk
  "Galeria" → `onOpenGallery`
- Opis prowadzącej (statyczny tekst, 2 akapity)
- "Najbliższe terminy" — lista `DATES` (statyczna, 3 pozycje)
- "Wymiana rzeczy" — 3 kafle licznikowe `EXCHANGE` (Oddam/Wymienię/Wypożyczę,
  statyczne liczby: 3/4/0)

**Stan**: tylko `toast` (lokalny). Brak formularzy, brak edycji — to widok **tylko do
odczytu** (w przeciwieństwie do `PanelOrganizatora`, gdzie te same dane są edytowalne).

---

### 3.3 `GaleriaZdjec.tsx` — galeria zdjęć + lightbox

Najprostszy i najbardziej samodzielny komponent — **jedyny, który poprawnie przyjmuje
dane przez propsy zamiast trzymać je zaszyte w pliku**.

**Props**:
```ts
type Photo = { id: string; label: string; src: string };
{ photos: Photo[]; onBack: () => void }
```

**Zachowanie**: siatka 2 kolumny (`aspect-ratio:1/1`) → klik otwiera lightbox
(`position:fixed`, pełny ekran, tło 92% czarne) → klik w tło lub × zamyka.

**Uwaga integracyjna**: skoro to jedyny komponent czysto "kontrolowany" przez propsy,
powinien być wzorcem dla refaktoru pozostałych stron (przenieść dane z modułowych
stałych do propsów / kontekstu).

---

### 3.4 `KragGrupy.tsx` / `KragGrupyStart.tsx` — krąg grupy (wymiana rzeczy)

**To najbardziej rozbudowana i najważniejsza funkcjonalnie strona** — serce
"wymiany rzeczy między rodzinami", które nadaje repo nazwę ("group-thing-app"/"krąg grupy").

Oba pliki mają identyczny komponent, różnią się tylko rozmiarem tablicy `FAMILIES`
(8 rodzin w `KragGrupy`, 2 rodziny w `KragGrupyStart` — "widok na starcie", tuż po
założeniu grupy). Brak propsów — brak eksportu.

**Model danych** (obecnie zaszyty w pliku, nie API):
```ts
type Family = {
  id: string; n: string /* nazwisko w dopełniaczu */; i: string /* inicjały */;
  c: string /* kolor avatara */; kids: string;
  bring: string | null;   // co rodzina przynosi na najbliższe zajęcia
  swap: string | null;    // co rodzina oferuje do wymiany/pożyczenia/oddania
  mode: "wymienię" | "pożyczę" | "oddam" | null;
  fresh: boolean;         // czy pokazać pulsujący pierścień "nowa oferta"
};
```

**UI**:
- Nagłówek grupy (nazwa, dzień/sala/liczba rodzin) + przycisk "więcej opcji" (toast-stub)
- 3 filtry-zakładki: Wszyscy / Wymiana (z licznikiem) / Przynoszą (z licznikiem)
- **Krąg** — SVG z rodzinami rozmieszczonymi po okręgu (trygonometria: `pos(i)` liczy
  współrzędne po kącie), środek = awatar prowadzącej. Klik na rodzinę = `setActive`.
  Plakietki na awatarach: zielona (swap), niebieskozielona (bring), pulsujący pierścień
  dla `fresh: true`. Placeholder `+` na końcu okręgu = "Zaproś kolejną rodzinę" (toast-stub).
- Sekcja "Kto co przynosi" — lista `NEEDED_ITEMS` (3 stałe pozycje) z możliwością
  samodzielnego zgłoszenia się (`toggleBringClaim`) — **czysto lokalny stan, tylko
  bieżący użytkownik ("Ciebie") może się zgłosić/wycofać**, nie może nadpisać zgłoszenia
  innej rodziny.
- Legenda kolorów
- Karta wybranej rodziny (`fam`) — pokazuje ofertę wymiany lub to, co przynosi;
  przyciski "Napisz" / "Chcę pożyczyć"/"Biorę" — oba tylko toast-stub, **żadna
  wiadomość ani zgłoszenie nie jest nigdzie zapisywane**.

**Rekomendacja**: scalić oba pliki w jeden komponent `KragGrupy({ families, groupName,
meta })`, a "widok na starcie" osiągnąć przez przekazanie mniejszej tablicy `families`
z zewnątrz, zamiast duplikować ~540 linii.

---

### 3.5 `PanelOrganizatora.tsx` — panel prowadzącej (organizatora)

Pełna, wieloekranowa aplikacja z dolną nawigacją (bottom nav), w całości na stanie
lokalnym `useState` (bez persystencji).

**Zależność zewnętrzna**: `AVATAR_SRC` z `../data/photos` (patrz §1, ta sama luka).

**Widoki** (`View = "home" | "spotkania" | "rzeczy" | "podarki" | "profil" | "ustawienia"`):

| Widok | Zawartość | Akcje |
|---|---|---|
| `home` | Powitanie + skrót: najbliższe 3 terminy, statystyki "Rzeczy dla innych" (wg trybu), statystyki "Rzeczy od innych" (wg źródła) | linki "Zobacz wszystkie" → zmiana widoku |
| `spotkania` | Sekcja **Grupy** (CRUD: dodaj przez modal, usuń) + sekcja **Terminy** (CRUD: dodaj przez modal z opcjonalnym check­listą potrzebnych rzeczy z własnej listy `items`, usuń) | `addGroup`, `removeGroup`, `addTerm`, `removeTerm`, `toggleNeededItem` |
| `rzeczy` | Lista własnych rzeczy do udostępnienia, każda z 3 przełącznikami trybu (wypożyczę/oddam/zamienię) + usuwanie | `addItem` (modal), `removeItem`, `setItemMode` |
| `podarki` | Lista rzeczy otrzymanych od innych rodzin (tylko odczyt + usuń z listy) | `removeGift` |
| `profil` | Edycja: avatar (URL), imię i nazwisko, lokalizacja, bio — zapis pokazuje "Zapisano" + toast | `saveProfile` |
| `ustawienia` | Przełączniki: powiadomienia e-mail/SMS, widoczność profilu publicznego; przycisk "Wyloguj się" (toast-stub) | lokalne togglowanie `settings` |

**Modale** (`Modal = "grupa" | "termin" | "rzecz" | null`): trzy formularze bottom-sheet,
każdy z własnym lokalnym stanem formularza i walidacją "nie dodawaj pustego".

**Uwaga**: cały ten panel to CRUD w pamięci przeglądarki — każde odświeżenie strony
kasuje dodane grupy/terminy/rzeczy.

---

### 3.6 `PanelGoscia.tsx` — panel rodzica/gościa

Struktura (CSS, ikony, typy, nawigacja dolna, toasty) jest **niemal 1:1 skopiowana**
z `PanelOrganizatora.tsx` — różnice są tylko w treści i uprawnieniach:

| Różnica względem `PanelOrganizatora` | Szczegóły |
|---|---|
| Brak sekcji **Grupy** | Gość nie zarządza grupami — `spotkania` pokazuje tylko listę zajęć, na które jest zapisany (`MY_TERMS`, tylko odczyt, bez dodawania/usuwania) |
| `rzeczy` bez zmian funkcjonalnych | Gość też ma własną listę rzeczy do udostępnienia z tymi samymi trybami |
| `podarki` bez zmian funkcjonalnych | Rzeczy otrzymane od innych rodzin (nie od organizatora) |
| Brak importu `data/photos` | Awatar gościa jest zaszyty jako URL `https://i.pravatar.cc/160?img=32`, więc **ten plik faktycznie się kompiluje** — w przeciwieństwie do `PanelOrganizatora`/`ProfilMobilny` |
| Tylko 1 modal (`"rzecz"`) zamiast 3 | Gość nie dodaje grup ani terminów |

**Rekomendacja**: to najsilniejszy kandydat do konsolidacji — jeden komponent
`PanelUzytkownika({ role: "organizer" | "guest", ... })`, gdzie różnice w §3.5/§3.6
sterują widocznością sekcji "Grupy" i trybem odczytu/zapisu "Spotkań".

## 4. Mapa nawigacji (zamierzona, jeszcze niepodłączona)

```
StronaGlowna ──onOpenProfil──────────────→ ProfilMobilny ──onOpenGallery──→ GaleriaZdjec
      │                                         │ (Wróć: tylko toast, brak realnego onBack)
      ├──onOpenKrag─────────────────────→ KragGrupy / KragGrupyStart
      ├──onOpenPanelOrganizatora────────→ PanelOrganizatora (własna nawigacja wewnętrzna: home/spotkania/rzeczy/podarki/profil/ustawienia)
      └──onOpenPanelGoscia──────────────→ PanelGoscia (analogicznie)
```

Żaden z tych przejść nie jest obecnie zaimplementowany poza `StronaGlowna` (która
przyjmuje callbacki, ale nikt jej ich nie dostarcza) i `GaleriaZdjec` (przyjmuje `onBack`,
ale wywołujący nie istnieje). Do uruchomienia całości potrzebny jest jeden nadrzędny
komponent (np. `App.tsx`) trzymający `view` w stanie i renderujący odpowiednią stronę.

## 5. Rekomendacje (przed dalszym rozwojem)

1. **Dodać brakujący moduł** `data/photos.ts` (`AVATAR_SRC`, `HERO_SRC`) albo przenieść
   te wartości do propsów, żeby `ProfilMobilny` i `PanelOrganizatora` w ogóle się kompilowały.
2. **Ujednolicić nazwę produktu** — "Rodzinny grajdołek" czy "Muzyczna Wioska".
3. **Scalić `KragGrupy` + `KragGrupyStart`** w jeden komponent przyjmujący `families` jako prop.
4. **Scalić `PanelOrganizatora` + `PanelGoscia`** w jeden komponent z propem roli.
5. **Wydzielić wspólne** CSS tokeny (paleta kolorów powtórzona 1:1 w 6 plikach), zestaw
   ikon SVG (duplikowany w `KragGrupy*` i `PanelOrganizatora`/`PanelGoscia`) oraz
   ładowanie fontów Google do jednego miejsca w App shell.
6. **Ujednolicić słownik trybów** udostępniania rzeczy (obecnie 3 różne zestawy nazw
   w 3 miejscach, patrz §2).
7. **Zbudować App shell / router**, który spina 7 stron przez istniejące już propsy
   nawigacyjne (`onOpenX`/`onBack`).
8. Zdecydować o warstwie **persystencji** (obecnie 100% stanu ginie po odświeżeniu) —
   dopiero to pozwoli zamienić toasty-zaślepki ("Zapisano", "Zgłoszono chęć: ...") na
   realne zapisy.
