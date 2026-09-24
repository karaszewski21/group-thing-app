# Raport z badania: maszyna stanów dla TermPage

**Typ badania:** mixed (analiza kodu + przegląd literatury i bibliotek)
**Data:** 2026-09-23
**Wykonawca:** Research Synthesizer (maister research workflow)
**Obiekt:** `src/frontend/src/pages/krag/TermPage.tsx` (459 linii) i jego otoczenie
**Status kodu:** kod nie był modyfikowany. Ścieżki podane są względem `src/frontend/src/`, chyba że zaznaczono inaczej.

---

## Spis treści

1. [Podsumowanie](#1-podsumowanie)
2. [Cele badania](#2-cele-badania)
3. [Metodologia](#3-metodologia)
4. [Ustalenia](#4-ustalenia)
   - 4.1 Inwentarz stanu
   - 4.2 Stany niemożliwe i wyścigi: tabela
   - 4.3 Ocena kosztu i zysku per przepływ
   - 4.4 Porównanie technik
   - 4.5 Tabela zbiorcza ustaleń
5. [Analiza i wnioski](#5-analiza-i-wnioski)
6. [Wnioski końcowe](#6-wnioski-końcowe)
7. [Rekomendacja i szkic implementacji](#7-rekomendacja-i-szkic-implementacji)
8. [Wpływ na testy](#8-wpływ-na-testy)
9. [Ryzyka](#9-ryzyka)
10. [Następne kroki](#10-następne-kroki)
11. [Załączniki](#11-załączniki)

---

## 1. Podsumowanie

**Werdykt: CZĘŚCIOWO TAK.** Na TermPage można i warto zastosować maszynę stanów, ale:
- **tylko dla trzech sprzężonych przepływów**: nakładek (3 bramki + dialog RSVP), take/swap oraz stanu „w toku” deklaracji i wzięć,
- **techniką `useReducer` + unie dyskryminowane** w czystym module `.ts`, **bez XState** ani innej biblioteki,
- **razem z naprawami poza maszyną**, bo mniej więcej połowa znalezionych błędów wynika z braku resetu przy zmianie tożsamości lub terminu, z nieczystych odczytów w renderze i z brakującej obsługi błędów. Reducer strony ich nie naprawi.

**Co badano.** Stan i przejścia `TermPage` → `useTermAccess` → `PublicTermView` (15 × `useState`, `TermPage.tsx:121-155`), stan dialogów (`RsvpDialog`, `RsvpDialogLoggedIn`, `AccountMergeForm`, `AuthGateSheet`, `SwapProposeDialog`), konwencje repo, standardy, testy oraz 5 technik FSM.

**Jak badano.** Odtworzono „ukrytą maszynę” z handlerów i warunków JSX. Zbudowano macierz niemożliwych kombinacji ze ścieżkami osiągalności, przeanalizowano wyścigi async i oceniono koszt/zysk per przepływ. Porównano techniki z ważonymi kryteriami. Kluczowe odwołania zweryfikowano ponownie w kodzie źródłowym.

**Najważniejsze ustalenia:**
1. Model płaskich `useState` dopuszcza **co najmniej 15 błędów osiągalnych zwykłymi akcjami użytkownika**. Najpoważniejsze to: S1, czyli wiersz trwale traci przyciski po scaleniu konta gościa (`mergingKey` nigdy nie jest zerowany, L155/L294/L340), oraz R2, czyli nieudany `refetch` po udanej akcji zamienia całą stronę na „Nie znaleziono” (`useTermAccess.ts:50` + `TermPage.tsx:63`).
2. **Take/swap** jest rozsmarowany na 5 zmiennych (L141-145), co daje sprzeczności S7-S9 i wyścig R4. To przepływ z największym zyskiem z maszyny.
3. **Nakładki** to 4 niezależne booleany (16 kombinacji, 5 sensownych). Repo ma już precedens jednej unii „jeden modal naraz” (`ModalKind`, `pages/panel/panelHelpers.ts:19-27`).
4. **Pojedyncze sloty „busy”** (`pledgingItemId`, `busyTakeItemId`) odblokowują przyciski w trakcie równoległych żądań (S10, S11). Rozwiązaniem jest `Set<id>`, a nie pełna FSM.
5. **XState v5** (≈15.9 kB gz z `@xstate/react`) daje najwięcej funkcji, ale w ocenie ważonej przegrywa z `useReducer` + unie (69 vs 89/100). Powody to standard minimal dependencies, krzywa uczenia i skala problemu (3 płaskie przepływy jednej strony).

**Pewność ogólna:** wysoka dla diagnozy, średnio-wysoka dla wyboru techniki i kształtu maszyny.

---

## 2. Cele badania

### Pytanie główne
Czy (i jak) można zastosować maszynę stanów do strony `TermPage` (`src/frontend/src/pages/krag/TermPage.tsx`)?

### Pytania szczegółowe
| # | Pytanie | Gdzie odpowiedź |
|---|---|---|
| SQ1 | Inwentarz stanu, wartości pochodnych i przejść | §4.1 |
| SQ2 | Kombinacje reprezentowalne, a niedozwolone | §4.2 |
| SQ3 | Wyścigi async | §4.2 |
| SQ4 | Które przepływy są „maszynowe”, a które to prosty stan UI | §4.3 |
| SQ5 | Konwencje repo i standardy | §4.4, §5 |
| SQ6 | Porównanie technik | §4.4 |
| SQ7 | Kiedy FSM ma sens według literatury | §4.4, §5.2 |
| SQ8 | Wpływ na testy | §8 |

### Zakres
- **W zakresie:** `TermPage.tsx`, `pages/krag/components/*`, `hooks/useTermAccess.ts`, `utils/actionGate.ts`, `components/krag/{AuthGateSheet,RsvpDialog,RsvpDialogLoggedIn,AccountMergeForm,JoinPrivateGroupDialog}.tsx`, `PrivateGroupAccessDenied.tsx`, `test/TermPage.test.tsx`; techniki: useReducer + DU, XState v5, @xstate/store, robot3, @zag-js/core.
- **Poza zakresem:** backend (poza wskazaniem luk), usunięty widok prywatny, panel (tylko jako wzorzec konwencji).

---

## 3. Metodologia

- **Typ:** mixed, w przybliżeniu 70% techniczne i 30% literaturowe.
- **Źródła:**
  - kod: 20+ plików przeczytanych w całości (TermPage 459 linii, useTermAccess 55, 11 komponentów krag, 5 dialogów), fragmenty `api/groups.ts`, `auth/AuthContext.tsx`, `router.tsx`,
  - konfiguracja: `package.json`, `eslint.config.js`, `tsconfig.app.json`, `vite.config.ts`, `vitest.config.ts`,
  - standardy: 5 plików w `.maister/docs/standards/`,
  - testy: `test/TermPage.test.tsx` (14 testów, uruchomione, zielone), precedensy `layoutPositions.test.ts` i `useCategories.test.ts`,
  - zewnętrzne: ok. 15 URL-i (react.dev, stately.ai, TypeScript handbook, Bundlephobia, GitHub, npm).
- **Framework analizy:** tabela stanu → macierz sprzeczności z oceną osiągalności (R = osiągalne, P = tylko reprezentowalne) → ocena per przepływ → porównanie technik z wagami.
- **Weryfikacja:** podczas syntezy sprawdzono ponownie w kodzie `TermPage.tsx:115-360, 436-459`, `useTermAccess.ts:20-55` i `router.tsx:110-124`. Wszystkie sprawdzone ustalenia potwierdziły się.

---

## 4. Ustalenia

### 4.1 Inwentarz stanu (skrót)

**`useTermAccess`** (`hooks/useTermAccess.ts`): `data` (L23, nigdy nie zerowane), `error` (L24), `loading` pochodne `data === null && error === null` (L54), efekt z flagą `cancelled` (L28-43), **`refetch` bez anulowania** (L45-52).

**`TermPage`** (L53-85): bez własnego stanu, tylko rozgałęzienie loading → „Wczytywanie...” (L60) / `error || !data` → „Nie znaleziono” (L63) / PRIVATE (L65-75) / `PublicTermView` (L77-84). Trasa nie ma `key` (`router.tsx:122-123`).

**`PublicTermView`**: 15 × `useState`

| Grupa (przepływ) | Zmienne (linia) |
|---|---|
| Nakładki | `showRsvpGate` (128), `showRsvpDialog` (129), `showPledgeGate` (136), `showTakeGate` (141) |
| Sugestia konta po RSVP gościa | `lastRsvp` (132), `suggestionDismissed` (133) |
| Deklaracja „Ja to przyniosę” | `pledgedItemIds` (137, tylko dopisywane), `pledgingItemId` (138) |
| Take / swap | `takingItemId` (142), `takeOfferedItemId` (143), `busyTakeItemId` (144), `myAvailableItems` (145, cache ładowany raz) |
| Scalenie gościa | `mergingKey` (155, **nigdy nie zerowany**) |
| UI | `activePartyId` (121), `toast` (122; timer w efekcie L157-161) |

**Stan pochodny liczony w renderze:** `isLoggedIn` (118), `guestProfileId` (151-152, **odczyt `localStorage` + TTL 1 h przez `Date.now()`**, `api/groups.ts:309`), `isAttending` (153), `claimedByMe` (320, **porównanie po `display_name`**), `isMerging` (278, 317).

**Stopka** (`TermFooter.tsx:12-19`, `TermPage.tsx:450-456`) to czysta derywacja 4 stanów: A anonim niezapisany / B zalogowany niezapisany / C zalogowany zapisany / D gość zapisany. Nie jest to maszyna.

**Dialogi** mają lokalny stan formularza (`busy`, `formError`, pola). `RsvpDialogLoggedIn` ma `family === null`, które jednocześnie znaczy „ładowanie”, „brak rodziny” i „błąd” (L27, L45, L56).

### 4.2 Stany niemożliwe i wyścigi

Legenda: **Waga** to skutek dla użytkownika. **Kolumna „FSM/reducer”** mówi, czy problem naprawia rekomendowany reducer/unia: **Tak**, **Częściowo** albo **Nie** (wtedy potrzebna jest inna poprawka).

| # | Problem | Osiąg. | Waga | FSM/reducer | Właściwa naprawa | Dowód |
|---|---|---|---|---|---|---|
| S1 | Po scaleniu konta gościa wiersz X trwale traci przyciski (`mergingKey` bez resetu) | R | **Wysoka** | Częściowo | **Derywacja** `effectiveMergingKey = guestProfileId !== null ? mergingKey : null` | L155, 278, 285-286, 294, 298, 317, 331, 340, 345 |
| S2 | Karta „Załóż konto” zostaje po zalogowaniu, a ponowne wysłanie scala już scalony profil | R | Średnia | Częściowo | Derywacja: pokazuj tylko przy `!isLoggedIn` | L439-446; AccountMergeForm.tsx:38-47 |
| S3 | Dwa `AccountMergeForm` naraz, zdublowane `id` w DOM | R | Niska-średnia (a11y) | Częściowo | `useId()` w `AccountMergeForm`; opcjonalnie ukrycie karty, gdy wiersz jest w trybie scalenia | L442, L345; AccountMergeForm.tsx:63-83 |
| S4 | Zalogowany dostaje gościnny `RsvpDialog` (gdy `displayName === null`), który zapisuje klucz gościa w localStorage | R | Średnia | Nie | Status profilu w `AuthContext` (`loading/ready/error`) i wybór dialogu według statusu, a nie `displayName` | L375-389; AuthContext.tsx:76, 82-84, 96 |
| S5 | Flaga bramki przeżywa zalogowanie (martwy stan) | P/R | Niska | **Tak** | Unia `overlay` + render tylko przy `!isLoggedIn` | L128, 136, 141, 362, 391, 399 |
| S6 | Kilka nakładek naraz (16 kombinacji, 5 sensownych) | P | Niska | **Tak** | Unia `overlay` | L128-141, 362-406 |
| S7 | „Anuluj” w trakcie wysyłania propozycji: UI wygląda na anulowane, a potem pojawia się toast sukcesu | R | Średnia | **Tak** | `swap: submitting` ignoruje `SWAP_CANCELLED` (przycisk zablokowany) | L224-225, 242-251; SwapProposeDialog.tsx:69 |
| S8 | Sukces take na B zamyka picker na A | R | Średnia | **Tak** | Rozdzielenie `takingIds` od `swap` | L261-265 |
| S9 | Ponowny klik „Zamień” w wierszu z otwartym pickerem wysyła propozycję | R | Niska | **Tak** (decyzja UX) | Jawne przejście w reducerze: zachować lub zablokować | L232-247, 285-296 |
| S10 | `pledgingItemId` przestaje wskazywać równoległe żądania, więc możliwa jest podwójna deklaracja i fałszywe 409 | R | Średnia* | **Tak** | `pledgingIds: Set<number>` | L178, 189, 337 |
| S11 | To samo dla `busyTakeItemId`, możliwe podwójne `takeTermItemListing` | R | Średnia* | **Tak** | `takingIds: Set<number>` | L261, 270, 291 |
| S12 | `pledgedItemIds` wymusza „Przynosi: Ty” wbrew danym serwera | R | Niska-średnia | Częściowo | Czyszczenie lokalnego zbioru po udanym refetchu (serwer jest źródłem prawdy) | L137, 181, 318-320 |
| S13 | Inna rodzina o tej samej nazwie jest pokazywana jako „Ty” | R (rzadko) | Niska | **Nie** | Porównanie po `claimed_by_party_id` z id bieżącego użytkownika (wymaga sprawdzenia API) | L320 |
| S14 | Po scaleniu miga stopka B „＋ Zapisz się” (dane z anonimowego fetchu) | R | Średnia | Nie (strona) | `forToken` w `useTermAccess` i ukrycie stopki, gdy dane są nieaktualne | L153; useTermAccess.ts:23, 43 |
| S15 | Po zmianie `:termId` stan lokalny i dane starego terminu zostają | R | Średnia | **Nie** | `key={groupId:termId}` na elemencie trasy | TermPage.tsx:121-155; router.tsx:122-123 |
| S16 | Cache `myAvailableItems` nigdy nie jest unieważniany i proponuje rzecz już zaproponowaną | R | Niska-średnia | **Tak** | Unieważnienie w `SWAP_SETTLED(ok)` | L145, 197-221 |
| R1 | `refetch` bez anulowania: stara odpowiedź nadpisuje nowszą | R | Średnia | Nie (strona) | Token sekwencji w `useTermAccess` | useTermAccess.ts:45-52 |
| R2 | Błąd refetcha zamienia stronę na „Nie znaleziono” i gubi toast sukcesu | R | **Wysoka** | Nie (strona) | Unia `ready{refreshError}` w hooku, błąd „miękki” (toast) | useTermAccess.ts:50; TermPage.tsx:63 |
| R3 | Równoległe pledge/take | R | = S10/S11 | **Tak** | jw. | L138, 144 |
| R4 | Pierwszy klik „Zamień” bez busy: podwójne ładowanie, picker otwiera się tam, gdzie ładowanie skończy się później | R | Średnia | **Tak** | Stan `loadingOptions{itemId}` + strażnik itemId przy `SWAP_OPTIONS_LOADED` | L197-221, 232-237 |
| R5 | Nieobsłużony błąd `loadMyAvailableItems`: unhandled rejection, brak komunikatu | R | **Wysoka** | Nie (daje tylko miejsce: `SWAP_OPTIONS_FAILED`) | `try/catch` + toast | L230-237, 255-259; actionGate.ts:15 |
| R6 | Zamknięcie dialogu RSVP w trakcie wysyłania: zapis się udaje, a UI wygląda na anulowane | R | Średnia | Nie | Blokada `onClose` przy `busy` w dialogu | RsvpDialog.tsx:36-46, 62, 82 |
| R7 | `RsvpDialogLoggedIn`: wysyłka przed wczytaniem rodziny (`child_count: 0`), miga baner | R | Niska-średnia | Mała unia lokalna | `familyState: loading \| none \| loaded(family) \| error` | RsvpDialogLoggedIn.tsx:27-57, 63-67 |
| R8 | Toasty nadpisują się wzajemnie | R | Niska | Nie | Akceptowalne (ewentualnie kolejka) | L182, 268 |
| R9 | setState po odmontowaniu | R | Niska | n/d | No-op w React 18+ | L177-191, 230-272 |
| R10 | Wygaśnięcie TTL gościa bez zdarzenia (render zależny od czasu) | R | Niska-średnia | **Nie** | Odczyt profilu gościa do stanu (inicjalizator + po RSVP), ewentualnie timer | L151-152; api/groups.ts:309 |

\* Waga zależy od idempotentności backendu, której nie sprawdzano.

**Bilans:** unia/reducer strony naprawia bezpośrednio **9** pozycji (S5-S11, S16, R4, a R3 przez S10/S11) i częściowo 3 (S1, S3, S12). Unia w `useTermAccess` naprawia **3** (R1, R2, S14). Pozostałe **9** wymagają napraw spoza maszyny (S2, S4, S13, S15, R5, R6, R7, R10, R8). **Żaden z problemów nie jest dziś pokryty testem.**

### 4.3 Ocena kosztu i zysku per przepływ

| Przepływ | Zmienne dziś | Async | Problemy | Zysk | Koszt | Decyzja |
|---|---|---|---|---|---|---|
| **Take / swap** | 5 | tak (ładowanie opcji, wysyłka) | S7, S8, S9, S11, S16, R4, R5 | **Wysoki** | Średni | **Reducer**: `swap` jako unia + `takingIds: Set` |
| **Nakładki** (3 bramki + dialog RSVP) | 4 booleany | nie | S5, S6 | **Wysoki** (czytelność, wykluczanie) | **Niski** | **Unia `overlay`** w reducerze |
| **Pledge** | 2 | tak | S10, S12, R3 | Średni | Niski | `pledgingIds`/`pledgedIds: Set` w reducerze |
| **Sugestia konta** | 2 | nie | S2, S3 | Niski-średni | Niski | Mała unia `suggestion` w reducerze + derywacja `!isLoggedIn` |
| **Scalenie gościa** | 1 | nie | S1, S3 | Wysoki (S1) | **Bardzo niski** | Pole w reducerze + **derywacja** resetu. Sam reset nie wymaga FSM |
| **Dostęp** (`useTermAccess`) | 2 + pochodne | tak | R1, R2, S14, S15 | **Wysoki** | Niski | **Unia statusu + token sekwencji + `forToken`** w hooku; `key` na trasie |
| **Stopka** | 0 (derywacja) | nie | S4, S14, R10 | n/d | n/d | Zostaje derywacją. Naprawić źródła danych |
| **RsvpDialogLoggedIn** | 5 lokalnych | tak | R7 | Niski-średni | Niski | `useState<FamilyState>` (unia), bez reducera |
| **Toast** | 1 + efekt | timer | R8 | Brak | n/d | **Zostaw `useState`** (ewentualnie wspólny hook z panelem, DRY) |
| **activePartyId + scroll** | 1 | nie | brak | Brak | n/d | **Zostaw** |
| **Formularze dialogów**, `PrivateGroupAccessDenied` | 2-4 lokalne | tak | R6 | Brak | n/d | **Zostaw** (R6 to jedna linia) |

### 4.4 Porównanie technik

**Fakty** (Bundlephobia i `npm view`, 2026-09-23):

| | useReducer + DU | XState v5 + @xstate/react | @xstate/store | robot3 | @zag-js/core |
|---|---|---|---|---|---|
| Wersja | React 19.2 | 5.33.2 + 6.1.0 (v6 w alpha) | 4.2.3 (+ `@xstate/store-react`) | 1.2.0 (2025-09) | 1.44.0 |
| min+gzip | **0** | **≈15.9 kB** (14.6 + 1.3) | 3.4 kB + pakiet React | 1.3 kB (+ react-robot) | 2.7 kB |
| Prawdziwa FSM | z konwencji (`switch` stan → zdarzenie) | tak (statecharts, guardy, aktory) | **nie** (event store) | tak | tak, pod widżety |
| Async | poza reducerem | aktory `fromPromise`, auto-anulowanie przy wyjściu ze stanu | poza | `invoke` | wbudowane |
| Testy | czysta funkcja | `transition()` / `createActor`, `xstate/graph` | zdarzenia store | czyste-ish | n/d |
| React 19 | natywne | peer ^19 OK; zastrzeżenia StrictMode (child actors) i React Compiler (#5426) | OK | OK; **strona dokumentacji nie działa** | OK |
| Uwagi | precedens `ModalKind` w repo | pierwsza zależność stanu we froncie | sama dokumentacja: „for more complex state management, use XState” | ryzyko utrzymania | toolkit widżetów, nie logiki strony |

**Kryteria ważone** (skala 1-5; wagi z ograniczeń briefu i standardów repo):

| Kryterium (waga) | Status quo + poprawki | **useReducer + DU** | XState v5 | @xstate/store | robot3 | @zag-js/core |
|---|---|---|---|---|---|---|
| Zgodność ze standardami / minimal deps (20) | 5 | 5 | 2 | 3 | 3 | 2 |
| Eliminacja stanów niemożliwych (20) | 1 | 4 | 5 | 2 | 4 | 3 |
| Async / wyścigi (15) | 2 | 3 | 5 | 2 | 3 | 3 |
| Testowalność (15) | 2 | 5 | 4 | 4 | 4 | 3 |
| Krzywa uczenia / czytelność (15) | 5 | 5 | 2 | 4 | 3 | 2 |
| Rozmiar bundla (5) | 5 | 5 | 2 | 4 | 5 | 4 |
| React 19 / lint / utrzymanie (10) | 5 | 5 | 3 | 4 | 2 | 3 |
| **Wynik (/100)** | 66 | **89** | 69 | 62 | 67 | 54 |

Wynik = Σ(waga · ocena) / 5. Testowalność XState oceniono na 4 z powodu niepewności StrictMode/child-actors (cytat pochodzi z dokumentacji v6 alpha) i nieobserwowalności stanów przechodnich `always`.
**Wrażliwość:** przy podwojeniu wagi async i zmniejszeniu wagi standardów o połowę (po normalizacji) wynik to ok. 85 (reducer) vs ok. 76 (XState). Rekomendacja nie zależy od szczegółów wag.

**Literatura, czyli kiedy FSM:**
- React docs: jeden `status` zamiast sprzecznych booleanów, a reducer, jeśli „often encounter bugs due to incorrect state updates” ([choosing-the-state-structure](https://react.dev/learn/choosing-the-state-structure), [extracting-state-logic-into-a-reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer)). TermPage spełnia ten warunek.
- Kent C. Dodds: unie statusu zawsze, XState przy splecionym cyklu async i wielu stanach ([stop-using-isloading-booleans](https://kentcdodds.com/blog/stop-using-isloading-booleans)).
- Reguła praktyczna ([EXT] §6): kilka wzajemnie wykluczających się trybów i 1-2 wywołania async → unia + `useReducer`. Zagnieżdżenie/równoległość, timery, anulowanie async, wiele guardów, diagram dla osób nietechnicznych → XState. TermPage mieści się w pierwszej kategorii. Jedyne miejsce wymagające anulowania (refetch) rozwiązuje token sekwencji.

### 4.5 Tabela zbiorcza ustaleń

| # | Ustalenie | Kategoria | Pewność |
|---|---|---|---|
| F1 | 15 × `useState` w `PublicTermView`, stan płaski przy sprzężonych przepływach | Kod | Wysoka |
| F2 | ≥ 15 błędów osiągalnych zwykłymi akcjami, w tym 3 o wysokiej wadze (S1, R2, R5) | Kod | Wysoka |
| F3 | Take/swap i nakładki dają najwyższy zysk z unii/reducera | Analiza | Wysoka |
| F4 | Mniej więcej połowa błędów wymaga napraw poza maszyną (reset, derywacja, `key`, try/catch) | Analiza | Wysoka |
| F5 | Brak `useReducer` i bibliotek stanu w repo; precedens `ModalKind` i unie `kind:` | Konwencje | Wysoka |
| F6 | Standardy (minimal deps, no speculative abstractions, local state) sprzyjają reducerowi | Konwencje | Wysoka |
| F7 | Lint (react-hooks v7 `purity`/`immutability`/`set-state-in-effect`) i TS (`erasableSyntaxOnly`) sprzyjają czystemu reducerowi z uniami literałów | Konfiguracja | Wysoka |
| F8 | 14 testów TermPage jest behawioralnych i przetrwa refaktor zachowujący render; żaden nie pokrywa S/R | Testy | Wysoka |
| F9 | XState: 15.9 kB gz, wysoka krzywa, v6 w alpha, zastrzeżenia StrictMode/Compiler | Zewnętrzne | Wysoka (rozmiar), średnia (StrictMode v5) |
| F10 | @xstate/store nie jest FSM; robot3 ma ryzyko utrzymania; zag służy do widżetów | Zewnętrzne | Wysoka / średnia (robot3) |
| F11 | Dzieci dostają gotowe VM-y (`termSectionTypes.ts:4-30`), więc refaktor nie zmienia ich propsów | Kod | Średnio-wysoka |

---

## 5. Analiza i wnioski

### 5.1 Wzorce

| Wzorzec | Występowanie | Ocena | Przykład |
|---|---|---|---|
| „Boolean per modal” | 4 flagi | Antywzorzec | `showRsvpGate/showRsvpDialog/showPledgeGate/showTakeGate` (L128-141) |
| „Pojedynczy slot busy” | 2 | Błąd przy równoległości | `pledgingItemId` (L138), `busyTakeItemId` (L144) |
| „Przepływ na N zmiennych” | swap: 5 | Źródło sprzeczności | L141-145 |
| „Stan zależny od tożsamości bez resetu” | 5 zmiennych | Błąd | `mergingKey` (L155) |
| „Brak granicy terminu” | cała strona | Błąd | brak `key` (`router.tsx:122-123`) |
| „Nieczysta derywacja w renderze” | 2 | Błąd poza zasięgiem FSM | L151-152, L320 |
| „Async bez obsługi błędu” | 2 ścieżki | Błąd | `actionGate.ts:15`, L233, L258 |
| „Hook `{data,error,refetch}`” | 3 hooki | Dojrzały, niepełny | brak „refreshing/refreshError” |
| „VM-y dla prezentacyjnych dzieci” | wszystkie sekcje | Zaleta | `termSectionTypes.ts` |

### 5.2 Kluczowe wnioski

1. **Płaski stan przy sprzężonych przepływach.** Sprzężenie („jedna nakładka”, „jeden picker”, „reset przy loginie”) jest dziś zakodowane w JSX (`&& !isLoggedIn`, `isMerging && guestProfileId !== null`) i w kolejności wywołań `set*`. Unie przenoszą je do typów, a reducer do jednej testowalnej funkcji.
2. **FSM nie jest odpowiedzią na wszystko.** Reset przy zmianie tożsamości lepiej zrobić derywacją niż zdarzeniem z efektu, bo `dispatch` w efekcie po zmianie tokenu zderza się z zasadą „you might not need an effect” i potencjalnie z regułą `set-state-in-effect`. Zmianę terminu najlepiej obsłużyć przez `key`. Błędy async wymagają `try/catch`.
3. **`useTermAccess` ma „prawie dobry” kształt** (3 stany), ale brakuje mu stanu „dane są, odświeżenie się nie udało”. To najtańsza i najbardziej wartościowa zmiana (R2 ma wysoką wagę).
4. **Skala nie uzasadnia XState.** Funkcje XState, które by tu pomogły (auto-anulowanie, guardy), zastępują trzy tanie mechanizmy: token sekwencji, strażnik `itemId` w reducerze i `Set<id>`.

### 5.3 Relacje

Każda udana akcja (RSVP L174, pledge L183, take L266, swap L247) kończy się `refetch()`. Dlatego R1 i R2 to wspólny punkt awarii wszystkich przepływów i trzeba je naprawić raz, w hooku. `AccountMergeForm` → `auth.applyExternalToken` (AccountMergeForm.tsx:38) zmienia token, co unieważnia dane dostępu, `mergingKey`, sugestię, bramki i cache opcji swap (S1, S2, S5, S14, S16).

### 5.4 Ocena jakości (SWOT)

| Mocne strony | Słabe strony |
|---|---|
| Prezentacyjne dzieci z VM-ami; czysty helper `gateAction`; efekty zgodne z lintem; behawioralne testy | 15 niezależnych `useState`; sloty busy; brak resetu przy zmianie tożsamości/terminu; nieczysty render; brak testów ścieżek błędów |
| **Szanse** | **Zagrożenia** |
| Precedens `ModalKind` i unie `kind:`; lint i TS sprzyjają reducerom; pre-prod pozwala zmieniać zachowanie; tanie testy czystej funkcji | Refaktor „big-bang” pliku 459 linii; niezamierzona zmiana UX (port 1:1); reducer rozrastający się w „god object”; nieznana idempotentność backendu |

---

## 6. Wnioski końcowe

### Główne
| # | Wniosek | Pewność |
|---|---|---|
| G1 | **Częściowo tak**: `useReducer` + unie dla nakładek, take/swap, pledge oraz sugestii i scalenia | Średnio-wysoka |
| G2 | **Nie XState** (ani @xstate/store, robot3, zag) przy obecnej skali | Średnio-wysoka |
| G3 | `useTermAccess` → unia statusu + token sekwencji + `forToken`, bez reducera | Wysoka |
| G4 | Naprawy poza maszyną (derywacje resetu, `key` terminu, try/catch, blokada zamknięcia dialogu, status profilu) są konieczne. Bez nich FSM usunie tylko część błędów | Wysoka |

### Drugorzędne
- Toast, `activePartyId`, formularze dialogów, `PrivateGroupAccessDenied` zostają przy `useState`.
- `RsvpDialogLoggedIn` dostaje małą unię `familyState` (R7).
- Timer toastu jest zduplikowany z panelem (`PanelDataContext.tsx:604-608`). To temat DRY, nie FSM.
- Komentarz w `router.tsx:112-118` („full private member experience”) jest nieaktualny.

### Bezpośrednia odpowiedź na pytanie
**Można i warto, ale w ograniczonym zakresie.** Maszyna stanów w lekkiej postaci (`useReducer` + unie dyskryminowane TypeScript, zero zależności) powinna objąć trzy sprzężone przepływy `PublicTermView`. Pełna maszyna całej strony ani biblioteka statechartów nie są uzasadnione. Równie ważne jak reducer są naprawy cyklu życia stanu (reset przy logowaniu, `key` terminu) i hooka dostępu, bo to one odpowiadają za dwa z trzech najpoważniejszych błędów (S1, R2).

---

## 7. Rekomendacja i szkic implementacji

### 7.1 Lista rekomendacji

| # | Rekomendacja | Priorytet | Nakład (szac.) | Naprawia | Korzyść | Ryzyko |
|---|---|---|---|---|---|---|
| 1 | Szybkie poprawki bez FSM: derywacja `effectiveMergingKey`, sugestia tylko przy `!isLoggedIn`, `try/catch` + toast przy ładowaniu opcji swap, `key` terminu na trasie, `useId` w `AccountMergeForm` | **P1** | ok. 0.5 dnia | S1, S2, R5, S15, S3 | Usuwa 2 z 3 błędów o wysokiej wadze | Niskie |
| 2 | `useTermAccess`: unia statusu, token sekwencji, `refreshError`, `forToken` | **P1** | ok. 0.5 dnia | R1, R2, S14 | Strona nie znika po błędzie odświeżenia | Niskie (zmiana API hooka, jeden konsument) |
| 3 | `pages/krag/termPageState.ts`: reducer (overlay, swap, busy sets, pledged, merge, suggestion) + `PublicTermView` na `useReducer` | **P2** | 1-1.5 dnia z testami | S5-S11, S16, R3, R4, S12 (część) | Stany niemożliwe znikają z typów; przejścia mają testy jednostkowe | Średnie (zmiana w pliku 459 linii; mitygacja: testy charakteryzujące przed refaktorem) |
| 4 | `RsvpDialogLoggedIn`: `familyState` jako unia; blokada `onClose` przy `busy` w `RsvpDialog`/`RsvpDialogLoggedIn` | P3 | ok. 0.25 dnia | R7, R6 | Poprawny `child_count`, brak „fałszywego anulowania” | Niskie |
| 5 | Status profilu w `AuthContext` i wybór dialogu RSVP według statusu | P3 | ok. 0.5 dnia | S4 | Zalogowany nie dostaje dialogu gościa | Średnie (AuthContext jest współdzielony) |
| 6 | „Ty” po id partii zamiast nazwy; odczyt profilu gościa do stanu (TTL) | P4 | do ustalenia (wymaga sprawdzenia API) | S13, R10 | Poprawność brzegowa | Zależy od backendu |
| — | **Nie robić:** XState / @xstate/store / robot3 / zag; FSM dla toastu, `activePartyId`, formularzy | — | — | — | Zgodność z minimal deps i minimal implementation | — |

### 7.2 Szkic: stan strony (reducer)

Proponowany plik: `src/frontend/src/pages/krag/termPageState.ts` (czysty moduł bez JSX, co jest zgodne z `react-refresh/only-export-components`). Typy to unie literałów (`erasableSyntaxOnly`), a importy typów przez `import type` (`verbatimModuleSyntax`).

```ts
import type { RsvpResponse } from "../../api/groups";

export type GateReason = "rsvp" | "pledge" | "take";

/** Dokładnie jedna nakładka naraz (zastępuje 4 booleany L128-141). */
export type Overlay =
  | { kind: "none" }
  | { kind: "gate"; reason: GateReason }
  | { kind: "rsvpDialog" };

export type AvailableItem = { id: number; productName: string };

/** Picker zamiany; dane istnieją tylko w stanach, w których mają sens. */
export type Swap =
  | { kind: "idle" }
  | { kind: "loadingOptions"; itemId: number }
  | { kind: "picking"; itemId: number; offeredItemId: number | null }
  | { kind: "submitting"; itemId: number; offeredItemId: number };

export type Suggestion =
  | { kind: "none" }
  | { kind: "shown"; rsvp: RsvpResponse }
  | { kind: "dismissed" };

export type MergeKey = `listing-${number}` | `needed-${number}`;

export type TermPageState = {
  overlay: Overlay;
  swap: Swap;
  swapOptions: readonly AvailableItem[] | null; // cache, unieważniany po udanej zamianie (S16)
  takingIds: ReadonlySet<number>;               // LEND/GIFT w toku (S11)
  pledgingIds: ReadonlySet<number>;             // deklaracje w toku (S10)
  pledgedIds: ReadonlySet<number>;              // optymistyczne "Ty" do czasu refetchu (S12)
  mergingKey: MergeKey | null;
  suggestion: Suggestion;
};

export const initialTermPageState: TermPageState = {
  overlay: { kind: "none" },
  swap: { kind: "idle" },
  swapOptions: null,
  takingIds: new Set(),
  pledgingIds: new Set(),
  pledgedIds: new Set(),
  mergingKey: null,
  suggestion: { kind: "none" },
};

export type TermPageEvent =
  | { type: "GATE_OPENED"; reason: GateReason }
  | { type: "RSVP_DIALOG_OPENED" }                       // stopka B lub „jako gość” z bramki rsvp
  | { type: "OVERLAY_CLOSED" }
  | { type: "RSVP_SUBMITTED"; rsvp: RsvpResponse }
  | { type: "SUGGESTION_DISMISSED" }
  | { type: "PLEDGE_STARTED"; itemId: number }
  | { type: "PLEDGE_SETTLED"; itemId: number; ok: boolean }
  | { type: "TAKE_STARTED"; itemId: number }
  | { type: "TAKE_SETTLED"; itemId: number }
  | { type: "SWAP_REQUESTED"; itemId: number }
  | { type: "SWAP_OPTIONS_LOADED"; itemId: number; options: readonly AvailableItem[] }
  | { type: "SWAP_OPTIONS_FAILED"; itemId: number }
  | { type: "SWAP_OFFER_CHANGED"; offeredItemId: number | null }
  | { type: "SWAP_CANCELLED" }
  | { type: "SWAP_CONFIRMED" }
  | { type: "SWAP_SETTLED"; itemId: number; ok: boolean }
  | { type: "MERGE_REQUESTED"; key: MergeKey }
  | { type: "SERVER_DATA_REFRESHED" };                   // po udanym refetchu: serwer jest źródłem prawdy (S12)

const withId = (s: ReadonlySet<number>, id: number) => new Set(s).add(id);
const withoutId = (s: ReadonlySet<number>, id: number) => {
  const next = new Set(s);
  next.delete(id);
  return next;
};

export function termPageReducer(state: TermPageState, event: TermPageEvent): TermPageState {
  switch (event.type) {
    case "GATE_OPENED":
      return state.overlay.kind === "none"
        ? { ...state, overlay: { kind: "gate", reason: event.reason } }
        : state; // S6: druga nakładka jest niemożliwa
    case "RSVP_DIALOG_OPENED": {
      const o = state.overlay;
      const allowed = o.kind === "none" || (o.kind === "gate" && o.reason === "rsvp");
      return allowed ? { ...state, overlay: { kind: "rsvpDialog" } } : state;
    }
    case "OVERLAY_CLOSED":
      return { ...state, overlay: { kind: "none" } };
    case "RSVP_SUBMITTED":
      return {
        ...state,
        overlay: { kind: "none" },
        suggestion: event.rsvp.attached_to_account ? state.suggestion : { kind: "shown", rsvp: event.rsvp },
      };
    case "SUGGESTION_DISMISSED":
      return { ...state, suggestion: { kind: "dismissed" } };

    case "PLEDGE_STARTED":
      return { ...state, pledgingIds: withId(state.pledgingIds, event.itemId) };
    case "PLEDGE_SETTLED":
      return {
        ...state,
        pledgingIds: withoutId(state.pledgingIds, event.itemId),
        pledgedIds: event.ok ? withId(state.pledgedIds, event.itemId) : state.pledgedIds,
      };

    case "TAKE_STARTED":
      return { ...state, takingIds: withId(state.takingIds, event.itemId) };
    case "TAKE_SETTLED": // S8: nie dotyka pickera zamiany
      return { ...state, takingIds: withoutId(state.takingIds, event.itemId) };

    case "SWAP_REQUESTED":
      switch (state.swap.kind) {
        case "idle":
          return { ...state, swap: { kind: "loadingOptions", itemId: event.itemId } };
        case "picking":
          // S9 — decyzja UX: dziś ponowny klik w tym samym wierszu = wysłanie.
          // Tu: no-op dla tego samego wiersza, przełączenie dla innego.
          return state.swap.itemId === event.itemId
            ? state
            : { ...state, swap: { kind: "loadingOptions", itemId: event.itemId } };
        case "loadingOptions":
        case "submitting":
          return state; // R4: brak równoległego ładowania / przełączenia w trakcie wysyłki
      }
      break;
    case "SWAP_OPTIONS_LOADED":
      if (state.swap.kind !== "loadingOptions" || state.swap.itemId !== event.itemId) return state; // spóźniona odpowiedź
      return {
        ...state,
        swapOptions: event.options,
        swap: { kind: "picking", itemId: event.itemId, offeredItemId: event.options[0]?.id ?? null },
      };
    case "SWAP_OPTIONS_FAILED":
      return state.swap.kind === "loadingOptions" && state.swap.itemId === event.itemId
        ? { ...state, swap: { kind: "idle" } }
        : state;
    case "SWAP_OFFER_CHANGED":
      return state.swap.kind === "picking"
        ? { ...state, swap: { ...state.swap, offeredItemId: event.offeredItemId } }
        : state;
    case "SWAP_CANCELLED":
      return state.swap.kind === "picking" ? { ...state, swap: { kind: "idle" } } : state; // S7
    case "SWAP_CONFIRMED":
      return state.swap.kind === "picking" && state.swap.offeredItemId !== null
        ? { ...state, swap: { kind: "submitting", itemId: state.swap.itemId, offeredItemId: state.swap.offeredItemId } }
        : state;
    case "SWAP_SETTLED":
      if (state.swap.kind !== "submitting" || state.swap.itemId !== event.itemId) return state;
      return event.ok
        ? { ...state, swap: { kind: "idle" }, swapOptions: null } // S16
        : { ...state, swap: { kind: "picking", itemId: state.swap.itemId, offeredItemId: state.swap.offeredItemId } };

    case "MERGE_REQUESTED":
      return { ...state, mergingKey: event.key };
    case "SERVER_DATA_REFRESHED":
      return { ...state, pledgedIds: new Set() };
  }
  return state;
}
```

**Użycie w `PublicTermView`** (fragmenty; efekty uboczne zostają w handlerach, reducer jest czysty):

```ts
const [ui, dispatch] = useReducer(termPageReducer, initialTermPageState);

// Reset tożsamości przez derywację, bez efektu (S1, S2, S5):
const mergingKey = guestProfileId !== null ? ui.mergingKey : null;
const gate = !isLoggedIn && ui.overlay.kind === "gate" ? ui.overlay.reason : null;
const suggestion = !isLoggedIn && ui.suggestion.kind === "shown" ? ui.suggestion.rsvp : null;

async function requestSwap(itemId: number) {
  dispatch({ type: "SWAP_REQUESTED", itemId });
  try {
    const options = ui.swapOptions ?? (await loadMyAvailableItems()); // loadMyAvailableItems bez setState
    dispatch({ type: "SWAP_OPTIONS_LOADED", itemId, options });
  } catch {
    dispatch({ type: "SWAP_OPTIONS_FAILED", itemId });
    setToast("Nie udało się wczytać Twoich rzeczy"); // R5
  }
}

async function confirmSwap() {
  if (ui.swap.kind !== "picking" || !term) return;
  const { itemId, offeredItemId } = ui.swap;
  if (offeredItemId === null) return setToast("Wybierz rzecz do zamiany");
  dispatch({ type: "SWAP_CONFIRMED" });
  try {
    await proposeSwap(itemId, { term_id: term.id, offered_item_id: offeredItemId });
    dispatch({ type: "SWAP_SETTLED", itemId, ok: true });
    setToast("Zaproponowano zamianę! Szczegóły w Twoim panelu");
    void refetch();
  } catch {
    dispatch({ type: "SWAP_SETTLED", itemId, ok: false });
    setToast("Nie udało się zaproponować zamiany");
  }
}
// W VM: disabled: ui.takingIds.has(id) / ui.pledgingIds.has(id);
//       SwapProposeDialog: busy = ui.swap.kind === "submitting", onCancel zablokowany w submitting.
```

Uwagi projektowe:
- `toast` i `activePartyId` celowo zostają jako `useState` (brak zysku).
- Reducer nie zna `isLoggedIn` ani `guestProfileId`. Zależność od tożsamości jest rozwiązywana w renderze (derywacja), co trzyma reducer w czystości i pozwala uniknąć efektu synchronizującego.
- Strażniki `itemId` w `*_LOADED`/`*_SETTLED` zastępują „anulowanie aktorów” XState dla tej skali.

### 7.3 Szkic: `useTermAccess`

```ts
type AccessState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: GroupAccessResponse; forToken: string | null; refreshError: string | null };

export function useTermAccess(groupId: number, termId?: number) {
  const { token } = useAuth();
  const [state, setState] = useState<AccessState>({ status: "loading" });
  const seq = useRef(0); // R1: wygrywa najnowsze żądanie, niezależnie od kolejności odpowiedzi

  const run = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await getGroupAccess(groupId, termId);
      if (id === seq.current) setState({ status: "ready", data, forToken: token, refreshError: null });
    } catch (err) {
      if (id !== seq.current) return;
      const message = errorMessage(err);
      // R2: błąd odświeżenia nie niszczy widoku, jest tylko sygnalizowany
      setState((prev) => (prev.status === "ready" ? { ...prev, refreshError: message } : { status: "error", message }));
    }
  }, [groupId, termId, token]);

  useEffect(() => {
    void run(); // setState wyłącznie asynchronicznie, zgodne z set-state-in-effect
  }, [run]);

  const isStale = state.status === "ready" && state.forToken !== token; // S14: np. ukryj stopkę
  return { state, isStale, refetch: run };
}
```
Plus S15: wrapper trasy `<TermPage key={`${groupId}:${termId}`} />` (albo komponent pośredni czytający `useParams`). Nowy termin to wtedy świeży montaż z `status: "loading"`, bez synchronicznego resetu w efekcie.
`TermPage` renderuje „Nie znaleziono” wyłącznie dla `status === "error"`. `refreshError` przechodzi do toastu w `PublicTermView`.

---

## 8. Wpływ na testy

### 8.1 Istniejące testy
`src/test/TermPage.test.tsx` (14 testów, zielone, ok. 1.1 s) asercje robi przez DOM/ARIA i wywołania mocków API. Nie czyta stanu wewnętrznego. **Refaktor zachowujący render nie wymaga zmian w tych testach.** Ryzyko ogranicza się do trzech powiązań strukturalnych: klasa `.kg-head-sub` (L127), klasa `is-on` (L161) i id `attendee-*` (L158-173). Nie wolno ich zmieniać.

Test „Nie znaleziono” po odrzuconym fetchu (L274) nadal przechodzi, bo pierwszy fetch kończy się `status: "error"`.

### 8.2 Testy do dodania (zgodnie z `frontend-testing.md`: Vitest, `src/test/`, 2-8 na funkcję)

**`src/test/termPageState.test.ts`** (czysty reducer, bez mocków, precedens `layoutPositions.test.ts`):
1. `GATE_OPENED` przy otwartej nakładce jest ignorowane (S6).
2. Bramka rsvp → `RSVP_DIALOG_OPENED` → `RSVP_SUBMITTED` zamyka nakładkę i pokazuje sugestię tylko przy `attached_to_account === false`.
3. `SWAP_CANCELLED` w `submitting` jest ignorowane (S7).
4. `TAKE_SETTLED` nie zmienia `swap` (S8).
5. Równoległe `PLEDGE_STARTED` A i B, potem `PLEDGE_SETTLED` A: B nadal w `pledgingIds` (S10).
6. `SWAP_OPTIONS_LOADED` dla nieaktualnego `itemId` jest ignorowane, a `SWAP_REQUESTED` w `loadingOptions` to no-op (R4).
7. `SWAP_SETTLED(ok)` czyści `swapOptions` (S16).

**`src/test/useTermAccess.test.ts`** (`renderHook` + `vi.mock("../api/groups")`, precedens `useCategories.test.ts`):
1. Po `ready` odrzucony `refetch` zostawia `ready` z `refreshError` (R2).
2. Dwa nakładające się `refetch`, z których wcześniejszy rozwiązuje się później: wygrywają dane późniejszego (R1).
3. Zmiana tokenu przy starych danych daje `isStale === true` do czasu nowej odpowiedzi (S14).

**`src/test/TermPage.test.tsx`** (regresje integracyjne):
1. **S1:** gość (`writeGuestProfile`) → „Pożycz” → formularz scalenia → zmiana `mockAuth.token` + rerender: przycisk „Pożycz” znów widoczny.
2. **R2:** zalogowany → „Ja to przyniosę” OK, drugi `getGroupAccess` odrzucony: widok nadal jest, brak „Nie znaleziono”.
3. **R5:** klik „Zamień” przy odrzuconym `getMyProfile`: toast błędu, brak unhandled rejection.
4. **Swap happy path:** „Zamień” → wybór → „Zaproponuj zamianę”, `proposeSwap(itemId, {term_id, offered_item_id})`. Wymaga mocków `getMyProfile/getProducts/getMyItemListingPreferences/getInventories/getInventoryItems/getInventoryItemBalance`, więc jest to najdroższy test.
5. **S15:** zmiana `termId` w `MemoryRouter` resetuje stan lokalny (np. karta sugestii znika).

Kolejność: testy regresji integracyjnej (1-3) warto napisać **przed** refaktorem jako testy charakteryzujące. Najpierw powinny być czerwone dla błędów, potem zielone po poprawkach.

---

## 9. Ryzyka

| Ryzyko | Prawdop. | Wpływ | Mitygacja |
|---|---|---|---|
| Niezamierzona zmiana UX (pamięć: port prototypu 1:1) | Średnie | Średni | Testy charakteryzujące przed zmianą; decyzje UX (S7, S9) jawnie zatwierdzone przez właściciela |
| Refaktor „big-bang” pliku 459 linii | Średnie | Średni | Kroki 1 → 2 → 3 osobnymi commitami; reducer wprowadzany przepływ po przepływie (overlay → swap → pledge) |
| Reducer rośnie w „god object” | Niskie-średnie | Niski | Twardy zakres: bez toastu, `activePartyId`, formularzy; zasada w standardzie |
| Nieaktualne domknięcia (`ui` czytane w handlerze async) | Średnie | Niski | Strażniki `itemId` w reducerze; decyzje „czy wolno” podejmuje reducer, nie handler |
| Pierwszy reducer w repo, brak konwencji | Pewne | Niski | Dodać standard (niżej); `ModalKind` jako punkt odniesienia |
| Nieznana idempotentność backendu | n/d | Średni | Sprawdzić przed nadaniem priorytetu S10/S11 |
| `ReadonlySet` w stanie a React DevTools / porównania | Niskie | Niski | Zawsze nowe instancje (`withId`/`withoutId`); ewentualnie `readonly number[]` |

---

## 10. Następne kroki

1. **Decyzje właściciela produktu:** S9 (czy drugi klik „Zamień” ma wysyłać), S7 (blokada „Anuluj” w trakcie wysyłki), R6 (blokada zamknięcia dialogu przy `busy`).
2. **Sprawdzenie backendu:** idempotentność `createRsvp`/`createPledge`/`takeTermItemListing`; czy front zna `party_id` bieżącego użytkownika (S13); `attached_to_account` dla zalogowanych (S17).
3. **Implementacja w kolejności z §7.1** (P1 → P2 → P3). Pasuje do `/maister:development` lub `/maister:quick-dev` dla kroku 1.
4. **Propozycja standardu** (do zatwierdzenia, następnie `/maister:standards-update`): *„Wzajemnie wykluczające się tryby UI (modale, bramki, kroki) modeluj jedną unią dyskryminowaną (`kind`), nie osobnymi booleanami. Stan »w toku« dla operacji per element trzymaj jako zbiór id, nie pojedynczy slot. Stan zależny od tożsamości resetuj derywacją lub `key`, nie efektem.”*
5. Przy okazji: poprawić nieaktualny komentarz `router.tsx:112-118`.
6. **Warunki ponownej oceny XState:** przepływy wieloetapowe z zagnieżdżeniem lub równoległością (np. negocjacja zamiany), maszyna współdzielona między stronami i panelem, potrzeba diagramu dla osób nietechnicznych.

---

## 11. Załączniki

### A. Źródła

**Pliki z ustaleniami:** `analysis/findings/codebase-termpage-state.md`, `analysis/findings/codebase-conventions.md`, `analysis/findings/external-fsm-options.md`; synteza: `analysis/synthesis.md`.

**Kod (względem `src/frontend/src/`):** `pages/krag/TermPage.tsx`, `hooks/useTermAccess.ts`, `utils/actionGate.ts`, `pages/krag/components/{TermFooter,NeededItemsSection,AttendeeList,KragStage,SwapProposeDialog,GroupHeader,TermCard,termSectionTypes,termLabels}`, `pages/krag/{GroupVisualization,PrivateGroupAccessDenied}.tsx`, `components/krag/{AuthGateSheet,RsvpDialog,RsvpDialogLoggedIn,AccountMergeForm,JoinPrivateGroupDialog}.tsx`, `api/groups.ts:224-314`, `auth/AuthContext.tsx:59-176`, `router.tsx:110-124`, `pages/panel/panelHelpers.ts:19-27`, `pages/panel/PanelDataContext.tsx:128-148, 326, 604-608`, `test/{TermPage,layoutPositions,useCategories}.test.*`.

**Konfiguracja i standardy:** `src/frontend/package.json`, `eslint.config.js:10-15`, `tsconfig.app.json`, `vite.config.ts`, `vitest.config.ts`; `.maister/docs/standards/global/{conventions,minimal-implementation,coding-style}.md`, `frontend/components.md`, `testing/frontend-testing.md`.

**Zewnętrzne:**
- https://react.dev/learn/choosing-the-state-structure
- https://react.dev/learn/extracting-state-logic-into-a-reducer
- https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect
- https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
- https://kentcdodds.com/blog/stop-using-isloading-booleans
- https://stately.ai/docs/xstate , https://stately.ai/docs/typescript , https://stately.ai/docs/xstate-react , https://stately.ai/docs/testing , https://stately.ai/docs/pure-transitions
- https://stately.ai/docs/xstate/v6/react/use-machine (v6 alpha, StrictMode)
- https://github.com/statelyai/xstate/issues/5426 (React Compiler), /issues/502, /issues/1237 (StrictMode, historyczne)
- https://stately.ai/docs/xstate-store , https://github.com/statelyai/xstate/releases/tag/@xstate/store@4.0.0
- https://github.com/matthewp/robot , https://thisrobot.life/ (parked 2026-09-23)
- https://zagjs.com/overview/introduction
- https://bundlephobia.com/package/xstate , /@xstate/react , /@xstate/store , /robot3
- https://gitnation.com/contents/goodbye-usestate (D. Khourshid; streszczenie wtórne)

### B. Luki i niepewności
| Luka | Wpływ na wnioski | Pewność bez domknięcia |
|---|---|---|
| Idempotentność backendu (S10, S11, podwójny RSVP) | Priorytet napraw „busy” | Średnia |
| `attached_to_account` dla zalogowanego (S17) | Brak (derywacja `!isLoggedIn` i tak zabezpiecza) | Średnia |
| Dostępność `party_id` bieżącego użytkownika (S13) | Kształt naprawy S13 | Niska |
| Zachowanie StrictMode w XState v5 (cytat z v6 alpha), koszt po tree-shakingu | Tylko odrzucona alternatywa | Średnia |
| Czy `set-state-in-effect` flaguje `dispatch` | Nieistotne przy derywacji/`key` | n/d |
| Brak telemetrii częstości błędów | Priorytetyzacja oparta na osiągalności i wadze, nie na częstości | Średnia |

### C. Szczegóły metodologii
Ocena osiągalności: **R** oznacza ścieżkę zdarzeń wykonalną zwykłymi akcjami (opisaną w `codebase-termpage-state.md` §3), **P** oznacza stan reprezentowalny, ale dziś blokowany przez UI (nakładka `position:fixed`). Wagę ustalano jakościowo według skutku dla użytkownika: utrata funkcji lub zniknięcie strony = wysoka, mylący komunikat lub podwójne żądanie = średnia, kosmetyka = niska.

### D. Surowe dane
Pełny inwentarz stanu, grafy przepływów i tabele S1-S17 / R1-R10: `analysis/findings/codebase-termpage-state.md` §1-§4. Pełna macierz bibliotek: `analysis/findings/external-fsm-options.md` §7. Konfiguracja lint/TS: `analysis/findings/codebase-conventions.md` F10-F13.
