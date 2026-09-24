# Research Brief — maszyna stanów dla TermPage

## Pytanie
Czy do obecnej strony `TermPage` (`src/frontend/src/pages/krag/TermPage.tsx`) można — i czy warto — zastosować maszynę stanów? Jeśli tak: w jakim zakresie (cała strona vs. pojedyncze przepływy) i jaką techniką (useReducer + unie dyskryminowane, XState v5, inna mała biblioteka)?

## Typ badania
Mixed — analiza kodu (technical) + dobre praktyki / porównanie bibliotek (literature).

## Kontekst
Strona została właśnie przebudowana jako wyłącznie publiczny widok terminu:
- `TermPage` → `useTermAccess` (loading / error / PRIVATE → `PrivateGroupAccessDenied` / PUBLIC → `PublicTermView`)
- `PublicTermView` ma ~15 `useState`: gate'y (`showRsvpGate`, `showPledgeGate`, `showTakeGate`), dialogi (`showRsvpDialog`), stan zapisu (`lastRsvp`, `suggestionDismissed`, gość z localStorage, `is_attending` z serwera), deklaracje (`pledgedItemIds`, `pledgingItemId`), wymiana (`takingItemId`, `takeOfferedItemId`, `busyTakeItemId`, `myAvailableItems`), `mergingKey`, `activePartyId`, `toast`.
- Stopka: niezalogowany / zalogowany-niezapisany / zapisany (także gość).

## Zakres
**W zakresie:** TermPage.tsx i komponenty w `pages/krag/components`, `useTermAccess`, dialogi RSVP / AuthGateSheet / AccountMergeForm / SwapProposeDialog; wszystkie przepływy UI na stronie; opcje: ręczny FSM (useReducer + unie), XState v5 (+ @xstate/react), inne lekkie biblioteki.
**Poza zakresem:** backend, usunięty widok prywatny, panel.
**Ograniczenia:** React 19 / TS 5.9 / Vite / Vitest; brak biblioteki stanu w projekcie; standardy minimal-dependencies i minimal-implementation; istniejące testy `src/test/TermPage.test.tsx`.

## Kryteria sukcesu
1. Inwentaryzacja stanów i przejść strony z dowodami (plik:linia), wraz z niemożliwymi/sprzecznymi kombinacjami, które dziś dopuszcza model `useState`.
2. Ocena, które przepływy zyskują na FSM, a które nie (koszt vs. zysk).
3. Porównanie technik (useReducer + discriminated union vs. XState v5 vs. inne) pod kątem tego projektu: rozmiar, typowanie, testowalność, zgodność ze standardami.
4. Jasna rekomendacja (tak/nie/częściowo) z uzasadnieniem i szkicem kształtu maszyny.
