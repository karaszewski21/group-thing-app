# Synteza — maszyna stanów dla TermPage

Data: 2026-09-23. Wejście: `analysis/findings/codebase-termpage-state.md` (dalej **[STATE]**), `analysis/findings/codebase-conventions.md` (**[CONV]**), `analysis/findings/external-fsm-options.md` (**[EXT]**), `planning/research-brief.md`, `planning/research-plan.md`, `planning/sources.md`.
Ścieżki kodu względem `src/frontend/src/`. Kod nie był modyfikowany. W trakcie syntezy wybiórczo zweryfikowano w źródle: `pages/krag/TermPage.tsx:115-360, 436-459`, `hooks/useTermAccess.ts:20-55`, `router.tsx:110-124`. Wszystkie sprawdzone odwołania zgadzają się z ustaleniami.

---

## 1. Pytanie badawcze

Czy (i jak) można zastosować maszynę stanów do strony `TermPage` (`pages/krag/TermPage.tsx`)? Czy to się opłaca, w jakim zakresie (cała strona czy pojedyncze przepływy) i jaką techniką?

## 2. Podsumowanie

Maszynę stanów **da się** zastosować i **częściowo warto**. Warto to zrobić dla trzech powiązanych przepływów: nakładek (3 bramki + dialog RSVP), take/swap oraz stanu „w toku” deklaracji i wzięć. Techniką powinien być `useReducer` z uniami dyskryminowanymi w czystym module `.ts`, a nie XState. Osobno, bez reducera, trzeba przebudować `useTermAccess` na unię statusu z tokenem żądania. Toast, wybór uczestnika i formularze w dialogach powinny zostać przy `useState`.

Najważniejsza obserwacja z porównania źródeł: **mniej więcej połowa realnych błędów nie wynika z braku FSM**, tylko z tego, że stan zależny od tożsamości i terminu nie jest resetowany (S1, S2, S14, S15), z nieczystych odczytów w renderze (R10, S4) i z porównywania po nazwie (S13). Część z nich naprawia się taniej derywacją stanu albo `key`, niż „zdarzeniem w maszynie”. Tego rozróżnienia brakowało w pierwotnym założeniu, że „FSM porządkuje wszystko”.

Pewność ogólna: **wysoka** dla diagnozy (bezpośredni odczyt kodu, wyrywkowo sprawdzony), **średnio-wysoka** dla rekomendacji techniki (wagi kryteriów są osądem, choć wynik jest odporny na ich zmianę, patrz §8.3).

---

## 3. Analiza krzyżowa źródeł

### 3.1 Ustalenia potwierdzone przez kilka źródeł

| # | Ustalenie | Źródła | Pewność |
|---|---|---|---|
| V1 | `PublicTermView` trzyma 15 niezależnych `useState` (L121-155). Cztery z nich to wzajemnie wykluczające się nakładki | [STATE] §1.3; [CONV] F2; weryfikacja kodu | Wysoka |
| V2 | W repo nie ma `useReducer` ani biblioteki stanu. Najbliższy precedens „jednej z N” to `ModalKind` (`pages/panel/panelHelpers.ts:19-27`, `PanelDataContext.tsx:326`) | [CONV] F1, F4, F10 | Wysoka |
| V3 | React docs zalecają jeden `status` zamiast sprzecznych booleanów oraz reducer tam, gdzie „często pojawiają się błędy z niepoprawnych aktualizacji stanu”. TermPage spełnia ten warunek (S7-S11) | [EXT] §2; [STATE] §3 | Wysoka |
| V4 | Standardy repo (minimal dependencies, no speculative abstractions, local state) przemawiają za reducerem, a przeciw nowej zależności | [CONV] §2; [EXT] §3 (Cons) | Wysoka |
| V5 | Testy `test/TermPage.test.tsx` (14) są behawioralne (DOM/ARIA + wywołania API). Refaktor zachowujący render ich nie psuje. Żaden test nie pokrywa S1-S16 ani R1-R10 | [CONV] F15, F16; [STATE] §5 pkt 4 | Wysoka |
| V6 | Czysty reducer można testować bez renderu (precedens `test/layoutPositions.test.ts`), a hook przez `renderHook` (precedens `test/useCategories.test.ts`) | [CONV] F7, F17; [EXT] §2 | Wysoka |
| V7 | Tooling sprzyja czystym reducerom: react-hooks v7 `purity`/`immutability` jako error, `erasableSyntaxOnly` (unie literałów zamiast `enum`), `noFallthroughCasesInSwitch` | [CONV] F11, F12 | Wysoka |

### 3.2 Sprzeczności i ich rozstrzygnięcie

| # | Napięcie | Rozstrzygnięcie |
|---|---|---|
| C1 | [CONV] F5: „dostęp jest już modelowany akceptowalnie, wartość FSM leży w PublicTermView” vs [STATE] §2.1, R1, R2: `useTermAccess` ma realne błędy (refetch bez anulowania, błąd refetcha zamienia stronę na „Nie znaleziono”) | [CONV] oceniał **kształt** (3 stany), [STATE] **zachowanie** po pierwszym ładowaniu. Obie oceny są trafne. Kształt jest bliski dobremu, ale brakuje stanu `ready + refreshError` i tokenu żądania. Wniosek: mała zmiana w hooku (unia + sekwencja), bez pełnej FSM. Zweryfikowano w kodzie (`useTermAccess.ts:45-52` nie ma flagi `cancelled`). |
| C2 | [CONV] `components.md`: „Local State: jak najbliżej użycia” vs rekomendacja jednego reducera strony | Reducer obejmuje tylko przepływy przecinające wiersze i nakładki (overlay, swap, zbiory busy), bo one są dziś sprzężone przez `PublicTermView` (S8: sukces take na B zamyka picker na A). Stan formularzy zostaje w dialogach. Taki podział jest zgodny ze standardem. |
| C3 | [EXT]: XState daje automatyczne anulowanie asynchroniczności vs [STATE]: główne wyścigi to R1 (hook) i S10/S11 (pojedynczy slot) | R1 rozwiązuje token sekwencji (kilka linii). S10/S11 rozwiązują zbiory `Set<id>`. Dla takiej skali zaleta XState jest realna, ale nie decyduje. |
| C4 | Pamięć użytkownika: „port 1:1, zachowaj UX” vs naprawa S9 (drugi klik „Zamień” wysyła propozycję) | S9 może być zamierzonym skrótem prototypu. Reducer może go odtworzyć (`SWAP_REQUESTED` w `picking` tego samego wiersza → `submitting`). Zmiana UX to decyzja właściciela produktu i jest oznaczona jako otwarta (§7). |
| C5 | `router.tsx:112-118` opisuje, że TermPage renderuje „full private member experience” dla zalogowanych, a [STATE]/brief mówią o widoku wyłącznie publicznym | Komentarz w routerze jest nieaktualny po ostatniej przebudowie. Nie wpływa na wnioski, ale warto go poprawić przy okazji. |

### 3.3 Pewność per ustalenie (wybór)

- S1, S7, S8, S9, S10, S11, S15, R2, R4, R5: **wysoka**. Ścieżki zdarzeń wynikają bezpośrednio z kodu (S1, S8, R2, R5 sprawdzone ponownie w źródle).
- S10/S11/drugi `createRsvp` jako *szkoda biznesowa*: **średnia**, bo idempotentność backendu nie była sprawdzana.
- S13 (porównanie po nazwie): **wysoka** co do mechanizmu, **niska** co do częstości.
- S4, S14: **średnio-wysoka**. Zależą od czasu odpowiedzi `getMyProfile` i fetchu po zmianie tokenu (okno czasowe).
- Rozmiary bibliotek: **wysoka** (Bundlephobia + `npm view`). Rozmiar XState po tree-shakingu nie był mierzony.

---

## 4. Wzorce i tematy

| Wzorzec | Opis | Dowód | Występowanie | Ocena |
|---|---|---|---|---|
| P1 „Boolean per modal” | Każda nakładka ma własną flagę, a wzajemne wykluczanie zapewnia tylko nakładka CSS | `TermPage.tsx:128-141, 362-406`; `AuthGateSheet.tsx:76-88` | 4 flagi | Antywzorzec (S5, S6). Repo zna już lepszy wzorzec (`ModalKind`) |
| P2 „Pojedynczy slot busy” | `xxxItemId: number \| null` oznacza „żądanie w toku”, choć żądania mogą biec równolegle | L138, L144; `finally` zeruje slot (L189, L270) | 2 sloty | Błąd (S10, S11) |
| P3 „Przepływ rozsmarowany na N zmiennych” | Swap składa się z `takingItemId`, `takeOfferedItemId`, `busyTakeItemId`, `myAvailableItems` (+ `showTakeGate`) | L141-145, L224-270 | 1 przepływ, 5 zmiennych | Główne źródło sprzeczności (S7-S9, R4, S16) |
| P4 „Stan zależny od tożsamości bez resetu” | `mergingKey`, `lastRsvp`, bramki, cache `myAvailableItems` przeżywają zmianę tokenu | L155 (brak `setMergingKey(null)`), L439, L145 | 5 zmiennych | Błąd (S1, S2, S5, S16) |
| P5 „Brak granicy terminu” | Trasa bez `key`, hook nie zeruje `data` | `router.tsx:122-123`; `useTermAccess.ts:23` | cała strona | Błąd (S15) |
| P6 „Nieczysta derywacja w renderze” | `localStorage` + `Date.now()` w renderze, „Ty” liczone przez porównanie nazw | L151-152, L320; `api/groups.ts:309` | 2 miejsca | Błąd, którego FSM nie rozwiąże (R10, S13) |
| P7 „Async bez obsługi błędu” | `void fn()` w `gateAction`, `await` bez `try` | `actionGate.ts:15`; L233, L258 | 2 ścieżki | Błąd (R5), niezależny od FSM |
| P8 „Hook fetch `{data,error,refetch}`” | Wspólny kształt hooków danych | `useTermAccess`, `useCategories`, `useProducts` | 3 hooki | Dojrzały wzorzec, któremu brakuje stanu „odświeżanie / błąd odświeżenia” |
| P9 „VM-y dla prezentacyjnych dzieci” | Dzieci dostają gotowe `*RowVM` | `termSectionTypes.ts:4-30` | wszystkie sekcje | Zaleta: refaktor stanu nie dotyka `pages/krag/components/*` |

Wspólny mianownik: stan jest **płaski i niezależny**, a przepływy są **sprzężone** (jedna nakładka naraz, jeden picker naraz, reset przy zmianie tożsamości). Płaski model nie wyraża sprzężenia, dlatego logika sprzężenia jest dziś rozproszona w JSX (`&& !isLoggedIn`, `isMerging && guestProfileId !== null`) i w kolejności wywołań `set*`.

---

## 5. Kluczowe wnioski

| # | Wniosek | Dowody | Implikacja | Pewność |
|---|---|---|---|---|
| I1 | Błędy układają się w 4 klasy przyczyn. Tylko 2 z nich są „problemem kształtu stanu” (P1/P3 sprzeczne kombinacje, P2 sloty busy). Pozostałe to cykl życia (P4/P5) i nieczyste źródła (P6/P7) | [STATE] §5 wnioski 1, 3 | Maszyna stanów rozwiązuje część problemów. Plan musi obejmować też naprawy poza reducerem | Wysoka |
| I2 | Take/swap to przepływ o najwyższym zysku. Pięć zmiennych da się zastąpić jedną unią `swap` i zbiorem `takingIds`, co eliminuje S7, S8, S9 i R4 z definicji | [STATE] §2.5, §5 | Pierwszy kandydat do reducera | Wysoka |
| I3 | Nakładki (4 booleany, 16 kombinacji, z czego 5 ma sens) dają najlepszy stosunek zysku do kosztu | [STATE] S5, S6; [CONV] F4 | Unia `overlay`. Nawet samo `useState<Overlay>` byłoby dużą poprawą | Wysoka |
| I4 | Reset przy zmianie tożsamości najtaniej zrobić **derywacją**, np. `effectiveMergingKey = guestProfileId !== null ? mergingKey : null` albo pokazywanie sugestii tylko gdy `!isLoggedIn`, a nie zdarzeniem `IDENTITY_CHANGED` wysyłanym z efektu. Taki efekt zderzyłby się z regułą `set-state-in-effect` i React docs „you might not need an effect” | [STATE] S1, S2; [CONV] F11; [EXT] §2 | Szkic reducera nie ma zdarzenia `LOGGED_IN`. Reset jest w derywacji, a zmiana terminu w `key` | Średnio-wysoka (projekt, nie fakt) |
| I5 | `useTermAccess` potrzebuje unii statusu (`loading \| error \| ready{refreshError}`) i tokenu sekwencji, a nie FSM. To naprawia R1, R2, a z polem `forToken` także migotanie S14 | [STATE] R1, R2, S14; [CONV] F5 | Mała, izolowana zmiana z testami `renderHook` | Wysoka |
| I6 | XState przegrywa nie funkcjami, tylko proporcją: 15.9 kB gz, nowa zależność (pierwsza „decyzja architektoniczna” frontendu), krzywa uczenia, zbliżające się v6 i niepewności StrictMode, wszystko po to, by zamodelować 3 przepływy lokalnego UI jednej strony | [EXT] §1, §3, §6; [CONV] §2 | Rekomendacja: `useReducer` + unie. Warunki powrotu do XState opisano w §9 | Średnio-wysoka |
| I7 | Obecne testy chronią render, ale nie przejścia. Reducer daje „za darmo” miejsce na testy S7-S11, a regresje S1/R2/R5 trzeba dopisać w `TermPage.test.tsx` | [CONV] F15-F17 | Plan testów w raporcie §8 | Wysoka |
| I8 | Refaktor nie wymaga zmian propsów komponentów potomnych (VM-y). Dotyka tylko `PublicTermView`, `useTermAccess` i nowego modułu stanu | [CONV] F9 | Niskie ryzyko regresji wizualnej, zgodne z „port 1:1” | Średnio-wysoka |

---

## 6. Relacje i zależności

```
AuthContext(token, displayName) ──┐
router params(groupId, termId) ───┼─> useTermAccess ──data/refetch──> TermPage ─(visibility)─> PublicTermView | PrivateGroupAccessDenied
                                  │                                                                   │
localStorage(guest_profile_id, TTL)┘ (odczyt w renderze L151)                                       │
                                                                                                      v
PublicTermView: overlay(4 bool) ── swap(4 zm.) ── pledge(2 zm.) ── merge(1) ── suggestion(2) ── toast ── activeParty
      │  każdy sukces akcji ──> refetch() (L174, L183, L247, L266) ──> useTermAccess (R1, R2)
      │  każdy sukces/błąd ──> setToast (R8)
      └─ AccountMergeForm ──> auth.applyExternalToken ──> token zmienia się ──> useTermAccess effect (S14) / stan lokalny NIE resetowany (S1, S2, S16)
```

Kluczowe sprzężenia, które model stanu musi wyrazić:
1. **Akcja → refetch**: każdy przepływ kończy się `refetch`, więc błąd refetcha (R2) jest wspólnym punktem awarii. Należy go naprawić w hooku, a nie w każdym przepływie.
2. **Token → wszystko**: zmiana tożsamości unieważnia `mergingKey`, `suggestion`, bramki, cache opcji swap i dane dostępu.
3. **Take (LEND/GIFT) ↔ swap picker**: dziś sprzężone przez wspólne `busyTakeItemId` i `closeSwapPicker()` (S8). Należy je rozdzielić.

---

## 7. Luki i niepewności

| Luka | Wpływ | Jak domknąć |
|---|---|---|
| Idempotentność backendu dla `createRsvp` / `createPledge` / `takeTermItemListing` | Waga S10, S11 i podwójnego RSVP (ryzyko danych vs sam „szum” toastów) | Sprawdzić serwisy backendu lub napisać test integracyjny |
| `attached_to_account` dla RSVP zalogowanego (S17) | Czy sugestia może pojawić się u zalogowanego | Odczyt `app/.../rsvp` w backendzie |
| Brak `claimed_by_party_id` w porównaniu „Ty” (S13) | Poprawna naprawa wymaga id partii bieżącego użytkownika. Nie wiadomo, czy front je zna | Sprawdzić `getMyProfile` i odpowiedź dostępu |
| Czy S9 (drugi klik „Zamień” = wysłanie) jest zamierzony | Zakres zmian UX | Decyzja właściciela produktu |
| XState: zachowanie StrictMode w v5 (cytat pochodzi z dokumentacji v6 alpha), koszt po tree-shakingu | Dotyczy tylko alternatywy odrzuconej | Nie wymaga domknięcia, chyba że decyzja się zmieni |
| `set-state-in-effect` a `dispatch` z `useReducer` | Czy reguła flaguje synchroniczny `dispatch` w efekcie (nie sprawdzono) | Nieistotne, jeśli zastosujemy derywację/`key` (I4) |
| Częstość realnego wystąpienia wyścigów (brak telemetrii) | Priorytetyzacja | Dopuszczalne: pre-prod, poprawki są tanie |

---

## 8. Synteza według frameworku (mixed)

### 8.1 Techniczna: komponenty, przepływy, wzorce

Rekonstrukcja „ukrytej maszyny” ([STATE] §2) pokazuje 7 przepływów. Tylko 3 z nich mają więcej niż dwa stany z przejściami asynchronicznymi i interakcjami między wierszami: overlay/RSVP, take/swap, pledge. Stopka to **czysta derywacja** (A/B/C/D), a nie maszyna. Jej błędy (S4, S14, R10) pochodzą ze źródeł danych.

### 8.2 Literaturowa: stan obecny, dobre praktyki, kompromisy

- Stan obecny: płaskie `useState`. Zalety: prostota, zgodność z repo. Wady: 15+ realnych sprzeczności i wyścigów.
- Dobre praktyki (React docs, Kent C. Dodds, D. Khourshid): najpierw unie statusu, reducer przy powtarzalnych błędach aktualizacji, XState przy zagnieżdżonych/równoległych stanach, timerach, anulowaniu async i potrzebie diagramu dla osób spoza zespołu programistów.
- Dopasowanie: TermPage ma 3 przepływy bez zagnieżdżenia, jeden timer (toast, poza zakresem) i jedno miejsce wymagające anulowania (refetch, rozwiązywane tokenem). Leży więc w strefie „unie + reducer”.

### 8.3 Porównanie technik: kryteria ważone

Skala 1-5 (5 = najlepiej dla tego projektu). Wagi wyprowadzone z ograniczeń briefu i standardów.

| Kryterium (waga) | Status quo + punktowe poprawki | useReducer + DU | XState v5 + @xstate/react | @xstate/store | robot3 | @zag-js/core |
|---|---|---|---|---|---|---|
| Zgodność ze standardami / zależności (20) | 5 | 5 | 2 | 3 | 3 | 2 |
| Eliminacja stanów niemożliwych (20) | 1 | 4 | 5 | 2 | 4 | 3 |
| Obsługa async / wyścigów (15) | 2 | 3 | 5 | 2 | 3 | 3 |
| Testowalność (15) | 2 | 5 | 4 | 4 | 4 | 3 |
| Krzywa uczenia / czytelność dla zespołu (15) | 5 | 5 | 2 | 4 | 3 | 2 |
| Rozmiar bundla (5) | 5 | 5 | 2 | 4 | 5 | 4 |
| React 19 / lint / utrzymanie (10) | 5 | 5 | 3 | 4 | 2 | 3 |
| **Wynik ważony (/100)** | **66** | **89** | **69** | **62** | **67** | **54** |

Obliczenie: wynik = Σ(waga·ocena)/5. useReducer: (100 + 80 + 45 + 75 + 75 + 25 + 50)/5 = 89. XState: (40 + 100 + 75 + 60 + 30 + 10 + 30)/5 = 69. Testowalność XState oceniono na 4, a nie 5, z powodu niepewności StrictMode/child-actors i nieobserwowalności stanów przechodnich `always` ([EXT] §3).

**Wrażliwość**: nawet przy podwojeniu wagi async (30) i zmniejszeniu wagi standardów do 10 (po normalizacji do 100) XState osiąga ok. 76, a useReducer ok. 85. Kolejność zmieniłaby się dopiero, gdyby w przyszłości pojawiły się zagnieżdżone/równoległe przepływy wieloekranowe albo potrzeba wizualizacji dla osób nietechnicznych.

### 8.4 Wymagania: gap analysis

- Wymaganie jawne (brief): jasny werdykt, inwentarz, porównanie, szkic. Spełnione.
- Wymagania niejawne: zachowanie UX 1:1 (pamięć użytkownika), zielone istniejące testy, brak nowych błędów lint. Rekomendacja je respektuje.
- Konflikt: naprawa S9/S7 może zmienić mikro-UX (zablokowany „Anuluj” podczas wysyłania). Zaznaczone jako decyzja.

---

## 9. Wnioski

### Główne
1. **Werdykt: częściowo tak.** FSM w postaci `useReducer` + unii dyskryminowanych dla overlay, take/swap i zbiorów „w toku”. Pewność: średnio-wysoka.
2. **Nie dla XState** na obecną skalę. Warunki ponownej oceny: (a) pojawią się przepływy wieloetapowe z zagnieżdżeniem/równoległością (np. kreator swapu z negocjacją), (b) trzeba będzie współdzielić maszynę między stronami/panelem, (c) potrzebny będzie diagram dla osób spoza zespołu. Pewność: średnio-wysoka.
3. **Poza reducerem**: unia + token sekwencji w `useTermAccess` (R1, R2, S14), `key` terminu (S15), derywacje resetu tożsamości (S1, S2, S5), `try/catch` w swap (R5). Pewność: wysoka.

### Drugorzędne
- Toast, `activePartyId`, formularze dialogów, `PrivateGroupAccessDenied`: zostawić `useState`. Timer toastu jest zduplikowany z panelem (DRY, osobny temat).
- `RsvpDialogLoggedIn`: mała unia `familyState` (R7), bez reducera.
- Nieaktualny komentarz w `router.tsx:112-118`.

### Rekomendacje (kolejność)
1. Szybkie poprawki bez FSM + testy regresji (S1, S2, R5, S15, S3).
2. `useTermAccess`: unia + sekwencja + `forToken` (R1, R2, S14).
3. `termPageState.ts`: reducer (overlay, swap, busy sets, pledged, merge, suggestion) + `termPageState.test.ts`.
4. Opcjonalnie: `familyState` w `RsvpDialogLoggedIn`, blokada zamknięcia dialogu podczas `busy` (R6).

Sugestia standardu (do akceptacji przez użytkownika, `/maister:standards-update`): „Wzajemnie wykluczające się tryby UI (modale, bramki, kroki) modeluj jedną unią dyskryminowaną (`kind`), nie osobnymi booleanami. Stan »w toku« dla operacji per element trzymaj jako `Set<id>`, nie pojedynczy slot”.
