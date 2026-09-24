# Research Sources

Root frontendu: `C:\Users\karas\Desktop\group-thing-app\src\frontend\`

## 1. codebase-termpage-state

### Key Files (zweryfikowane, liczba linii)
- `src/pages/krag/TermPage.tsx` (459) — `TermPage` + `PublicTermView`; `useState` L121–155 (activePartyId, toast, showRsvpGate, showRsvpDialog, lastRsvp, suggestionDismissed, showPledgeGate, pledgedItemIds, pledgingItemId, showTakeGate, takingItemId, takeOfferedItemId, busyTakeItemId, myAvailableItems, mergingKey), `useEffect` od L157
- `src/hooks/useTermAccess.ts` (55) — loading / error / PRIVATE / PUBLIC
- `src/utils/actionGate.ts` (17) — logika gate'ów akcji
- `src/pages/krag/components/TermFooter.tsx` (20), `NeededItemsSection.tsx` (50), `AttendeeList.tsx` (78), `KragStage.tsx` (127), `SwapProposeDialog.tsx` (75), `GroupHeader.tsx` (26), `TermCard.tsx` (19), `termSectionTypes.ts` (36), `termLabels.ts` (13)
- `src/pages/krag/GroupVisualization.tsx` (324), `src/pages/krag/PrivateGroupAccessDenied.tsx` (87)
- `src/components/krag/AuthGateSheet.tsx` (126), `RsvpDialog.tsx` (137), `RsvpDialogLoggedIn.tsx` (180, używa localStorage), `AccountMergeForm.tsx` (96), `JoinPrivateGroupDialog.tsx` (135)
- API wywoływane przez przepływy: `src/api/terms.ts`, `src/api/pledges.ts`, `src/api/termItemListings.ts`, `src/api/groups.ts` (localStorage gościa), `src/api/accounts.ts`, `src/api/client.ts`
- Kontekst sesji: `src/auth/AuthContext.tsx`

### Patterns
- `grep -n "useState|useEffect|useRef|useCallback|useMemo|localStorage"` na plikach powyżej
- Warunki renderu w JSX (`&&`, ternary) w `PublicTermView` i `TermFooter`

## 2. codebase-conventions

- `src/test/TermPage.test.tsx` (280) — specyfikacja zachowania, mocki API
- `src/test/GroupVisualization.test.tsx`, `src/test/AccountMergeAuthHandoff.test.tsx`, `src/test/setup.ts` — wzorce testów
- `src/pages/panel/PanelDataContext.tsx` — istniejąca unia dyskryminowana `kind: "SWAP_PROPOSED" | "TERM_CONFIRMATION_NEEDED"` (L129, L142)
- `src/hooks/useCategories.ts`, `src/hooks/useProducts.ts` — wzorzec własnych hooków
- Brak `useReducer` w `src/` (grep zwrócił 0 trafień) — do potwierdzenia
- Konfiguracja: `package.json`, `eslint.config.js`, `tsconfig*.json`, `vite.config.ts`, `vitest` config
- Standardy: `.maister/docs/standards/global/conventions.md`, `global/minimal-implementation.md`, `global/coding-style.md`, `frontend/components.md`, `testing/frontend-testing.md`
- Dokumentacja projektu: `.maister/docs/INDEX.md`, `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`
- Pamięć użytkownika (kontekst): port prototypu 1:1, pre-prod — zmiany URL/zachowania dopuszczalne

## 3. external-fsm-options

- XState v5 docs: https://stately.ai/docs/xstate , setup/typy: https://stately.ai/docs/typescript , React: https://stately.ai/docs/xstate-react , testowanie: https://stately.ai/docs/testing
- @xstate/store: https://stately.ai/docs/xstate-store
- npm / rozmiary: https://bundlephobia.com/package/xstate , https://bundlephobia.com/package/@xstate/react , https://bundlephobia.com/package/@xstate/store , https://bundlephobia.com/package/robot3 , https://pkg-size.dev
- robot3: https://thisrobot.life/ ; Zag: https://zagjs.com/overview/introduction (@zag-js/core)
- React docs: https://react.dev/learn/choosing-the-state-structure , https://react.dev/learn/extracting-state-logic-into-a-reducer , https://react.dev/learn/you-might-not-need-an-effect
- Kent C. Dodds, „Stop using isLoading booleans”: https://kentcdodds.com/blog/stop-using-isloading-booleans
- TS discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
- eslint-plugin-react-hooks 7 (`set-state-in-effect`): https://react.dev/reference/eslint-plugin-react-hooks
- GitHub statelyai/xstate — issues/releases dot. React 19 zgodności
