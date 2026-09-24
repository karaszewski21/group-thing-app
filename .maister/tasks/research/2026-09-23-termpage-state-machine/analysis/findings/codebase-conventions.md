# Findings — codebase-conventions (SQ5, SQ8 + constraints)

Frontend root: `src/frontend/`. All paths below are relative to it unless prefixed with `.maister/`.

## 1. Existing state-management patterns

### F1. `useReducer` is not used anywhere — confirmed
**Source**: `grep -rn "useReducer" src/` → 0 hits. Also 0 hits for `useSyncExternalStore`, and 0 mentions of `xstate|zustand|redux|state machine` in `src/`, `.maister/docs/`, `README.md`, `package-lock.json`.
**Implication**: a reducer/FSM would be the first of its kind in the repo (no precedent to follow, none to conflict with).
**Confidence**: High.

### F2. The dominant pattern is "many flat `useState`s in one component/hook"
`useState` counts per file (grep -c): `pages/panel/PanelDataContext.tsx` 57, `components/panel/EditTermDialog.tsx` 18, `pages/krag/TermPage.tsx` 16, `FirstTermStepperGuest.tsx` 10, `CreateFamilyDialog.tsx` 10, `ProductFormPage.tsx` 9.
TermPage's own list: `pages/krag/TermPage.tsx:121-155` (activePartyId, toast, showRsvpGate, showRsvpDialog, lastRsvp, suggestionDismissed, showPledgeGate, pledgedItemIds, pledgingItemId, showTakeGate, takingItemId, takeOfferedItemId, busyTakeItemId, myAvailableItems, mergingKey).
**Confidence**: High.

### F3. Discriminated unions exist, but only as *data* types, never as *UI state*
- `pages/panel/PanelDataContext.tsx:128-148` — `PendingSwapAction { kind: "SWAP_PROPOSED" … } | PendingConfirmAction { kind: "TERM_CONFIRMATION_NEEDED" … }` → `export type PendingAction` (L148). Built at L662/L673 from notifications. It models server-derived items, not component state.
- `api/notifications.ts:17` — `kind: NotificationKind`.
- No `assertNever`/`: never` exhaustiveness helpers exist; only one `switch` in non-test code (`plugins/PluginMessageHandler.ts:104`, on a string `type`).
**Implication**: `kind:`-tagged unions are an accepted idiom in the codebase; extending the idiom to a local UI-state union is consistent, not novel. `tsconfig.app.json` has `noFallthroughCasesInSwitch: true` which helps a reducer `switch`.
**Confidence**: High.

### F4. Closest precedents for "one-of-N" UI state are string-literal unions in `useState`
- `pages/panel/panelHelpers.ts:19-27` — `type ModalKind = "grupa" | "edit-grupa" | "termin" | "rzecz" | "pierwszy-termin" | "rodzina-nowa" | "edit-termin" | null;` used as `useState<ModalKind>(null)` at `PanelDataContext.tsx:326`. This is exactly the "one modal at a time" enum that TermPage lacks (TermPage uses independent booleans `showRsvpGate`, `showRsvpDialog`, `showPledgeGate`, `showTakeGate` at L128-141).
- `components/panel/FirstTermStepperGuest.tsx:35` — `useState<1 | 2 | "done">(1)` step state; transitions via `setStep(2)` (L51), `setStep("done")` (L68), `setStep(1)` (L154).
- `components/onboarding/OnboardingWizard.tsx:37-39` — `stepIndex` + `busy` + `error` as separate `useState`s.
- `pages/panel/panelHelpers.ts:10-17` — `type View` union, derived from URL (`PanelDataContext.tsx:320`), not stored.
**Implication**: a lightweight "single tagged state instead of N booleans" refactor (e.g. `useState<TermOverlay>` / `useReducer`) matches an existing house pattern (`ModalKind`).
**Confidence**: High.

### F5. Custom hooks: data-fetch shape `{ data, loading, error, refetch }`
- `hooks/useCategories.ts:10-17,25-73` — `loading/error/data` as three `useState`s + `refetch` via `useCallback`; mirrors `useProducts.ts` (doc comment L19-23).
- `hooks/useTermAccess.ts:5-10,21-54` — same shape but **derives** `loading` (`data === null && error === null`, L54) instead of storing it; uses a `cancelled` flag for stale responses (L28-42); refetch on `token` change (L42). Only sets state inside promise callbacks, so it passes `react-hooks/set-state-in-effect`.
**Implication**: `useTermAccess` already implicitly encodes a 3-state machine (loading | error | loaded) with derivation; TermPage branches on it at `pages/krag/TermPage.tsx:60-83` (loading → "Wczytywanie...", error → "Nie znaleziono", PRIVATE → `PrivateGroupAccessDenied`, else `PublicTermView`). Access loading is therefore already modeled acceptably; FSM value lies in `PublicTermView`'s interaction state.
**Confidence**: High.

### F6. Context providers — a "state layer hook + context" pattern exists
- `pages/panel/PanelDataContext.tsx:232` `function usePanelDataValue()` holds all state/effects/handlers; `PanelDataProvider` (L1546-1554) exposes it; context object + `usePanelData()` live in hookless `pages/panel/panelDataStore.ts:1-17` to keep `react-refresh/only-export-components` clean (comment L4-6).
- Header comment `PanelDataContext.tsx:110-115`: state layer was extracted from `PanelPage.tsx` "w niezmienionej postaci … Zero zmian zachowania" — precedent for a behavior-preserving extraction of state logic out of a page.
- Other contexts: `auth/AuthContext.tsx:38`, `plugins/PluginContext.tsx:26`.
**Implication**: extracting TermPage state into a `useTermPageState()` hook (or a reducer module) has direct precedent; if a new module exports non-component values alongside components, put it in a `.ts` sibling (react-refresh rule).
**Confidence**: High.

### F7. Pure logic is already extracted to `utils/` and unit-tested
- `utils/actionGate.ts:5-17` — `gateAction(isLoggedIn, openGate, fn)` pure HOF used by `PublicTermView`.
- `utils/layoutPositions.ts` tested by `test/layoutPositions.test.ts:1-30` (plain `describe/it`, no rendering; even keeps a "legacy pos()" copy from TermPage to prove a 1:1 port, L9-15).
- `utils/` also: `itemQuickAdd.ts`, `neededItemQuickAdd.ts`, `format.ts`, `productCategory.ts`, `url.ts`, `scenarioUrl.ts`.
**Implication**: a pure `termPageReducer(state, event)` in `utils/` or `pages/krag/` with a `.test.ts` has precedent in `layoutPositions.test.ts`.
**Confidence**: High.

### F8. Duplicated toast-timeout effect
`pages/krag/TermPage.tsx:157-161` (`setTimeout(() => setToast(""), 2600)`) and `pages/panel/PanelDataContext.tsx:604-608` (same, 2200 ms). Both call setState inside a timer callback (lint-compliant). Toast is simple UI state, not a FSM candidate; it's a DRY candidate (`coding-style.md` "DRY").
**Confidence**: High.

### F9. View-model props: children are presentational
`pages/krag/components/termSectionTypes.ts:4-30` — `TermActionVM`, `NeededItemRowVM`, `ListingRowVM` carry `onClick`, `disabled`, `extra: ReactNode`. Child components receive pre-computed VMs from `PublicTermView`, so state/transition logic is concentrated in `PublicTermView` and a refactor would not need to touch `pages/krag/components/*` props.
**Confidence**: Medium-High (types read; component bodies covered by the other gatherer).

## 2. Project standards relevant to FSM / new dependency

| Standard | Rule (quote) | Bearing on FSM |
|---|---|---|
| `.maister/docs/standards/global/conventions.md:15-16` | "Minimal Dependencies — Keep dependencies lean and up-to-date; document why major ones are included." | Adding `xstate` + `@xstate/react` requires justification and documentation; `useReducer` needs none. |
| `conventions.md:30-31` | "Build What's Needed — Avoid speculative code and 'just in case' additions" | Model only flows that exist today. |
| `.maister/docs/standards/global/minimal-implementation.md:16-17` | "No Speculative Abstractions — Skip factories, strategies, or adapters unless there's an immediate need." | Argues against a generic FSM framework/helper layer; favors a concrete reducer for concrete flows. |
| `minimal-implementation.md:13-14` | "No Future Stubs … interfaces 'for future extensibility'" | Don't pre-model states for removed/future flows (e.g. deleted private term view). |
| `.maister/docs/standards/global/coding-style.md:12-13` | "Focused Functions … smaller functions are easier to read, test" | Supports extracting transition logic from the 459-line component. |
| `coding-style.md:21-22` | "No Backward Compatibility Unless Required" | Plus user memory: app is pre-prod — behavior/structure changes are fine. |
| `coding-style.md:24-25` | DRY | Toast timer duplication (F8). |
| `.maister/docs/standards/frontend/components.md:28-29,46-47,49-50` | "Single Responsibility"; "Local State — Keep state as close to where it's used as possible; lift only when needed"; "Minimal Props" | Tension: a single page-level machine centralizes state; the standard prefers co-location. E.g. `myAvailableItems`/swap picker state could live in `SwapProposeDialog`. A reducer for *cross-cutting* flows (overlays/gates, busy item) is consistent; a global page machine for everything is less so. |
| `.maister/docs/standards/testing/frontend-testing.md:56-112` | Vitest globals + jsdom; RTL; per-file render helper; `vi.mock()` API modules + `vi.resetAllMocks()`; tests in `src/test/`, `describe` named after page/feature | Nothing forbids pure-function tests; a `src/test/termPageMachine.test.ts` fits (precedent F7). |
| `.maister/docs/project/tech-stack.md`, `architecture.md` | Backend-only content (FastAPI etc.); frontend state management is not addressed (grep for frontend/react/state: only Docker/proxy mentions, e.g. `tech-stack.md:64`, `architecture.md:101-103`). | No documented frontend architecture decision to conflict with; a new library would be the first documented frontend dep decision. |

User memory (`feedback_prototype_port_fidelity.md` via MEMORY.md): pages were ported 1:1 from `pages/*.tsx` prototypes — keep the exact UX. An FSM refactor must be behavior-preserving (views/tabs/modals).

## 3. Configuration constraints

### F10. Dependencies — no state library
`package.json` dependencies: `@chakra-ui/react ^3.34.0`, `lucide-react ^1.7.0`, `react ^19.2.4`, `react-dom ^19.2.4`, `react-router-dom ^7.13.2`. Dev: `typescript ~5.9.3`, `vite ^8.0.1`, `vitest ^3.2.4`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`, `jsdom ^27.0.1`, `eslint ^9.39.4`, `eslint-plugin-react-hooks ^7.0.1` (installed 7.0.1), `typescript-eslint ^8.57.0`, `tailwindcss ^4.3.3`.
`build` = `tsc -b && vite build && vite build -c vite.sdk.config.ts` — type errors fail the build.
No CI workflows (`.github/workflows` absent) — lint is not enforced automatically.

### F11. ESLint: react-hooks v7 recommended (React-Compiler rules) as errors
`eslint.config.js:10-15` extends `js.configs.recommended`, `tseslint.configs.recommended`, `reactHooks.configs.flat.recommended`, `reactRefresh.configs.vite`.
Effective react-hooks 7.0.1 recommended rules (read from the installed plugin): `rules-of-hooks`, `set-state-in-effect`, `set-state-in-render`, `refs`, `purity`, `immutability`, `globals`, `static-components`, `use-memo`, `preserve-manual-memoization`, `component-hook-factories`, `error-boundaries`, `config`, `gating` = **error**; `exhaustive-deps`, `incompatible-library`, `unsupported-syntax` = warn.
- `purity` + `immutability`: a reducer must be pure and return new objects (no mutation) — natural fit for `useReducer`.
- `set-state-in-effect`: syncing derived state via effect is an error. Current violators: `pages/ModerationPage.tsx:21`, `pages/PublicOrganizationPage.tsx:24`. **TermPage scope is clean**: `npx eslint src/pages/krag src/hooks/useTermAccess.ts src/components/krag src/utils/actionGate.ts` → no output.
- `incompatible-library` (warn) flags libraries whose APIs break memoization; relevant only if a third-party FSM hook is introduced (verify in external findings).
- React Compiler itself is **not** enabled in the build (`vite.config.ts:5` plugins: `react()`, `tailwindcss()` only; no babel-plugin-react-compiler) — the rules are lint-only.
- Full-repo lint currently: 24 problems (22 errors, 2 warnings), none in TermPage scope (mostly `react-refresh/only-export-components`, `no-explicit-any` in tests, 2× `set-state-in-effect`).

### F12. TypeScript strictness
`tsconfig.app.json`: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly: true` (no TS `enum`s / namespaces / parameter properties — **use string-literal unions, not `enum`, for states/events**), `noFallthroughCasesInSwitch: true`, `verbatimModuleSyntax: true` (type-only imports need `import type`), target ES2023.

### F13. Vite / Vitest
`vite.config.ts:5-24` — plain SPA, `/api` + `/oauth2` dev proxy; nothing FSM-relevant. `vitest.config.ts:4-10` — jsdom, `globals: true`, `setupFiles: ["./src/test/setup.ts"]`; `src/test/setup.ts` only imports `@testing-library/jest-dom/vitest`. Pure `.test.ts` files run under the same config (e.g. `layoutPositions.test.ts`).

## 4. `src/test/TermPage.test.tsx` — what it asserts (SQ8)

Runs green: 14 tests, 1.1 s (`npx vitest run src/test/TermPage.test.tsx`).

### F14. Setup
- API mocked at module level: `api/groups` partial (`getGroupAccess`, `createRsvp`, `mergeAnonymousProfile`, rest real incl. `guestProfileIdKey`/`writeGuestProfile`) L10-13; `api/pledges` `createPledge` L14; `api/termItemListings` `takeTermItemListing`, `proposeSwap` L15.
- `useAuth` mocked via mutable `mockAuth` (L17-21); `beforeEach` resets mocks, clears `localStorage`, stubs `scrollIntoView` (L103-109).
- Renders the real routed `TermPage` in `MemoryRouter` (L93-101) — no ChakraProvider (deviates from the standard's example helper but consistent with Tailwind-only krag pages).

### F15. Assertions are behavioral (DOM/ARIA + API calls), not internal state
| describe | test (line) | asserts via |
|---|---|---|
| header and content | L112, L120, L130, L153, L164 | roles/text; `getGroupAccess` called with `(7,101)`; **3 DOM-structure couplings**: CSS class `.kg-head-sub` (L127), class `is-on` (L161), element ids `attendee-21/22/99` (L158,168,171,173) |
| sign-up footer | L178, L192, L202, L211 | dialog names ("Zapisz się na zajęcia"), link href `/login?returnTo=…`, presence/absence of buttons; guest state seeded via real `localStorage` helper `writeGuestProfile` (L212); `form` name /Załóż konto/ and "no dialog" (L220-221) |
| item actions | L226, L235, L246 | gate dialog "Załóż konto, aby przynieść rzecz" + `createPledge` not called; `createPledge(11)` + "Przynosi: Ty"; `takeTermItemListing(9, {term_id:101, reservation_type:"LEND"})` |
| access | L263, L274 | PRIVATE card text, login link, region absent; "Nie znaleziono" on rejected fetch |

No test reads component state, hook internals, or `useState` counts. `is-on` (L161) is the only assertion tied to a state-derived rendering detail (`activePartyId`) and would survive any refactor that still renders the class.
**Implication**: a reducer/FSM refactor that preserves rendered output should pass all 14 tests unchanged. Risk is limited to renaming CSS classes/ids/aria labels.
**Confidence**: High.

### F16. Coverage gaps (flows a machine would formalize but tests don't pin down)
Not tested: swap proposal flow (`proposeSwap` mocked L15 but never asserted), take gate for anonymous users, logged-out → take/swap gate, RSVP submit → toast "Zapisano na zajęcia" (`TermPage.tsx:170-175`), `mergeAnonymousProfile` success/error (mocked L12, never asserted), busy/disabled state during in-flight pledge/take, double-click, API error paths for pledge/take, toast auto-dismiss, `suggestionDismissed`, mutual exclusion of gates/dialogs. These are exactly the transitions a reducer test would cover cheaply.
**Confidence**: High (grep of the file; all `it(` read).

### F17. Can machine logic be unit-tested separately under the standard?
Yes. `frontend-testing.md` prescribes Vitest + location `src/test/` + `describe` named after feature; it doesn't require rendering. Precedents: pure `test/layoutPositions.test.ts`; hook tests with `renderHook` in `test/useCategories.test.ts:1-40` (and `useProducts.test.ts`). So: (a) pure reducer `(state, event) => state` → plain `.test.ts`, no mocks; (b) a `useTermPageState` hook with async effects → `renderHook` + `vi.mock` API modules, as in `useCategories.test.ts`; (c) existing `TermPage.test.tsx` stays as the integration/behavior layer.
**Confidence**: High.

## 5. Summary for synthesis
- Repo has zero reducers/FSM libs; flat `useState` is the norm; `kind:` unions and `ModalKind`-style single-slot enums exist and are the natural idioms to extend.
- Standards (minimal dependencies, no speculative abstractions, local state) favor `useReducer` + discriminated union for the genuinely coupled flows over adding XState; a library would be the repo's first documented frontend state dependency.
- Tooling favors pure reducers: react-hooks v7 `purity`/`immutability`/`set-state-in-effect` are errors; `erasableSyntaxOnly` forbids `enum` → use string-literal unions; `noFallthroughCasesInSwitch` helps reducer switches.
- `TermPage.test.tsx` (14 tests) is DOM/API-behavioral and should survive a behavior-preserving refactor; it leaves the swap, merge, error, busy and mutual-exclusion transitions untested — a pure reducer test file would fill that gap cheaply.
