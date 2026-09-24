# Research Plan — maszyna stanów dla TermPage

## 1. Research Overview

**Pytanie główne:** Czy (i jak) można zastosować maszynę stanów (FSM) do strony `TermPage` (`src/frontend/src/pages/krag/TermPage.tsx`)? Czy warto, w jakim zakresie (cała strona vs. pojedyncze przepływy) i jaką techniką?

**Typ badania:** Mixed — technical (analiza kodu) + literature (dobre praktyki, porównanie bibliotek).

**Zakres (in):** `TermPage.tsx` (459 linii: `TermPage` + `PublicTermView`), `pages/krag/components/*` (KragStage, GroupHeader, TermCard, NeededItemsSection, AttendeeList, TermFooter, SwapProposeDialog, termSectionTypes, termLabels), `GroupVisualization.tsx`, `PrivateGroupAccessDenied.tsx`, `hooks/useTermAccess.ts`, `components/krag/{AuthGateSheet,RsvpDialog,RsvpDialogLoggedIn,AccountMergeForm,JoinPrivateGroupDialog}.tsx`, `utils/actionGate.ts`, `test/TermPage.test.tsx`.

**Zakres (out):** backend, usunięty widok prywatny terminu, strony panelu (PanelDataContext tylko jako wzorzec konwencji, nie jako obiekt refaktoru).

**Ograniczenia:** React 19.2, TS 5.9, Vite 8, Vitest 3 + Testing Library, eslint-plugin-react-hooks 7 (reguła `react-hooks/set-state-in-effect`), brak biblioteki stanu (deps: @chakra-ui/react, lucide-react, react, react-dom, react-router-dom). Standardy: minimal dependencies, minimal implementation, components, frontend-testing.

### Sub-pytania
- **SQ1 (inwentaryzacja):** Jakie są wszystkie kawałki stanu (`useState` ×15 w `PublicTermView` L121–155, stan w `useTermAccess`, stan lokalny dialogów), wartości pochodne i przejścia (handlery, efekty, callbacki async)? Dowody plik:linia.
- **SQ2 (niemożliwe stany):** Jakie kombinacje są dziś reprezentowalne, a nie powinny (np. `showRsvpGate && showRsvpDialog`, `showPledgeGate && showTakeGate`, `pledgingItemId` ≠ null przy braku sesji, `takingItemId` + `busyTakeItemId` + `takeOfferedItemId` rozjechane, `lastRsvp` vs `is_attending` z serwera vs gość z localStorage)?
- **SQ3 (async/race):** Gdzie są wyścigi: podwójne kliknięcie, odpowiedź po odmontowaniu/zmianie terminu, równoległy pledge + take, toast nadpisywany, merge gościa w trakcie innego żądania, efekty z `setState` (reguła `set-state-in-effect`)?
- **SQ4 (podział na przepływy):** Które przepływy są naturalnie „maszynowe” (access load, stopka zapisu anon/logged/attending/guest, gate → dialog → submit, take/swap, merge), a które są prostym stanem UI (activePartyId + scroll, toast)?
- **SQ5 (konwencje repo):** Czy repo ma już `useReducer`, unie dyskryminowane (`kind:` w PanelDataContext), własne hooki stanu; jak są pisane testy; co mówią standardy o zależnościach i abstrakcjach?
- **SQ6 (opcje):** useReducer + discriminated unions vs XState v5 (+@xstate/react) vs @xstate/store vs robot3 / @zag-js/core — rozmiar (min+gz), typowanie TS, zgodność z React 19 / StrictMode, testowalność (czysty reducer / `createActor`), krzywa uczenia, wizualizacja.
- **SQ7 (kiedy FSM ma sens):** Co mówi literatura (Kent C. Dodds „stop using isLoading booleans”, David Khourshid, React docs „Choosing the State Structure” / „Extracting State Logic into a Reducer”) o progach opłacalności FSM w UI?
- **SQ8 (wpływ na testy):** Jak zmiana wpłynie na `TermPage.test.tsx` (testy zachowania przez RTL powinny przetrwać) i czy reducer/maszyna daje tańsze testy jednostkowe przejść?

## 2. Methodology

**Podejście główne:**
1. Statyczna analiza kodu: pełne przeczytanie plików w zakresie, spis stanu/przejść w tabeli, zbudowanie macierzy kombinacji bool/nullable → oznaczenie kombinacji niedozwolonych.
2. Rekonstrukcja „ukrytej” maszyny: wyprowadzenie grafu stanów z handlerów i warunków renderu (JSX conditionals), porównanie z tym, co dopuszcza model `useState`.
3. Przegląd konwencji repo + standardów.
4. Research zewnętrzny: oficjalne dokumentacje (stately.ai, react.dev), bundlephobia/pkg-size, npm, GitHub issues dot. React 19.

**Fallback:** gdy dane o rozmiarze bundla niedostępne przez web — `npm view <pkg> dist.unpackedSize` / packagephobia; gdy brak jasności o przepływie — odczyt testów `TermPage.test.tsx` jako specyfikacji zachowania.

### Analysis Framework
- **Model stanu:** tabela `stan | typ | plik:linia | kto ustawia | kto czyta | przepływ`.
- **Macierz sprzeczności:** pary/trójki zmiennych, które razem nie mają sensu, + czy UI je dziś wyklucza tylko „konwencją”.
- **Ocena per przepływ (koszt vs zysk):** liczba stanów, liczba zdarzeń, async (tak/nie), ryzyko wyścigu, bugi niemożliwych stanów → rekomendacja: zostaw `useState` / `useReducer`+union / XState.
- **Porównanie technik:** kryteria ważone — zależności (standard minimal deps), rozmiar, typowanie, testowalność, czytelność dla zespołu, zgodność z React 19 i lint, koszt migracji testów.
- **Wynik:** rekomendacja tak/nie/częściowo + szkic typu stanu (discriminated union) i listy zdarzeń dla wybranych przepływów.

## 3. Research Phases

1. **Broad discovery:** Glob/Grep plików w zakresie; grep `useState|useEffect|useRef|useReducer|localStorage` w frontendzie; lista testów.
2. **Targeted reading:** pełny odczyt `TermPage.tsx`, `useTermAccess.ts`, `actionGate.ts`, dialogów krag, komponentów stopki/sekcji; odczyt `TermPage.test.tsx`.
3. **Deep dive:** śledzenie każdego przepływu end-to-end (klik → gate → dialog → API → setState → render/toast); identyfikacja wyścigów i efektów; wyprowadzenie grafu stanów; porównanie z wzorcem `kind:` w `PanelDataContext.tsx`.
4. **External:** dokumentacje XState v5 / @xstate/react / @xstate/store / robot3 / zag; rozmiary; artykuły o FSM w UI; React docs o reducerach.
5. **Verification:** cross-check inwentaryzacji z testami i z JSX; sprawdzenie, czy wskazane „niemożliwe stany” są realnie osiągalne (ścieżka zdarzeń); weryfikacja liczb rozmiarów w ≥2 źródłach.

## Gathering Strategy

### Instances: 3

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase-termpage-state | Inwentaryzacja każdego `useState`/stanu pochodnego/przejścia w TermPage, PublicTermView, useTermAccess, komponentach `pages/krag/components` i dialogach `components/krag` (plik:linia); graf przepływów (access, stopka anon/logged/attending/guest, RSVP gate→dialog, pledge, take/swap, merge gościa, toast, activeParty+scroll); macierz niemożliwych/sprzecznych kombinacji; async i race conditions; efekty z setState | Glob, Grep, Read | codebase-termpage-state |
| 2 | codebase-conventions | Istniejące wzorce w repo (`useReducer` — obecnie brak; unie dyskryminowane `kind:` w `PanelDataContext.tsx`; własne hooki `useTermAccess/useCategories/useProducts`); standardy (conventions, minimal-implementation, components, frontend-testing); `TermPage.test.tsx` i jak FSM wpłynie na testy; `package.json`, `eslint.config.js`, `tsconfig*`, `vite.config.ts` — ograniczenia zależności i lint | Read, Grep, Glob | codebase-conventions |
| 3 | external-fsm-options | XState v5 + @xstate/react, @xstate/store, useReducer + discriminated unions (react.dev), robot3, @zag-js/core — rozmiar min+gz, typowanie TS (`setup({types})`), React 19 / StrictMode, testowanie (czyste funkcje, `createActor`), kiedy FSM jest/nie jest zalecane w UI | WebSearch, WebFetch | external-fsm-options |

### Rationale
Pytanie jest w ~70% techniczne (kod jednej strony, ~2.3k linii w zakresie), więc analiza kodu jest rozdzielona na część merytoryczną (stan i przejścia — najcięższa praca) i kontekstową (konwencje, testy, konfiguracja, standardy), żeby gatherer #1 skupił się wyłącznie na modelu stanu. Konfiguracja jest mała (package.json, eslint) i wchłonięta przez #2 zamiast osobnej instancji. Część literaturowa to jedna instancja webowa. Brak nakładania: #1 = zawartość stanu strony, #2 = otoczenie repo, #3 = świat zewnętrzny.

## 4. Success Criteria
1. Kompletna tabela stanu (wszystkie 15 `useState` w PublicTermView + stan `useTermAccess` + stan lokalny dialogów) z plik:linia.
2. Lista co najmniej konkretnych niemożliwych/sprzecznych kombinacji z oceną osiągalności (ścieżka zdarzeń) i ewentualne wyścigi async.
3. Ocena koszt/zysk dla każdego przepływu z osobna.
4. Tabela porównawcza technik z liczbami (rozmiar) i źródłami, uwzględniająca standard minimal dependencies.
5. Rekomendacja tak/nie/częściowo + szkic typu stanu i zdarzeń (TypeScript) dla rekomendowanego zakresu + wpływ na `TermPage.test.tsx`.

## 5. Expected Outputs
- `analysis/findings/codebase-termpage-state-*.md`, `analysis/findings/codebase-conventions-*.md`, `analysis/findings/external-fsm-options-*.md`
- Raport z badania z rekomendacją i szkicem maszyny (discriminated union + reducer lub definicja XState), bez implementacji.
