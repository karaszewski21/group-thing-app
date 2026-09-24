# External findings: FSM options for a React 19 + TS 5.9 page (TermPage)

Gathered: 2026-09-23. Project context (for compatibility checks): `src/frontend/package.json` -> react ^19.2.4, typescript ~5.9.3, eslint-plugin-react-hooks ^7.0.1, vitest ^3.2.4. No React Compiler plugin found in package.json.

## 1. Bundle size and versions (min / min+gzip)

Source: Bundlephobia API (`https://bundlephobia.com/api/size?package=<name>`), fetched 2026-09-23; versions cross-checked with `npm view` the same day.

| Package | Version (npm latest, 2026-09-23) | min | min+gzip | Notes |
|---|---|---|---|---|
| xstate | 5.33.2 (published 2026-09-22) | 46.9 kB | **14.6 kB** | whole package; tree-shaking lowers real cost somewhat (not measured) |
| @xstate/react | 6.1.0 | 2.9 kB | **1.3 kB** | deps: use-sync-external-store, use-isomorphic-layout-effect; peer react `^16.8 / ^17 / ^18 / ^19`, xstate `^5.28.0` |
| @xstate/store | 4.2.3 | 9.1 kB | **3.4 kB** | React bindings now in separate `@xstate/store-react` 2.0.0 (peer react `^18 / ^19`) |
| robot3 | 1.2.0 (published 2025-09-20) | 2.9 kB | **1.3 kB** | ships `index.d.ts`; React via `react-robot` 1.2.1 (peer react incl. ^19) |
| @zag-js/core | 1.44.0 | 6.4 kB | **2.7 kB** | + @zag-js/utils, @zag-js/dom-query deps |
| useReducer + discriminated unions | built into React | 0 | **0** | no dependency |

Total for the XState route: ~15.9 kB min+gzip (xstate + @xstate/react). Confidence: High for figures (single authoritative measuring tool), Medium for "effective" size after tree-shaking.

Note: `xstate@6.0.0-alpha.59` is on the `alpha` dist-tag (2026-09-22), with v6 docs at https://stately.ai/docs/xstate/v6/react/use-machine. v5 is the stable line; adopting now means a future v5 -> v6 migration is likely. (`npm view xstate dist-tags` -> `{ latest: '5.33.2', alpha: '6.0.0-alpha.59', beta: '5.0.0-beta.54' }`.)

## 2. Option A: hand-rolled useReducer + TS discriminated unions

**React docs**
- Principle "Avoid contradictions in state"; isSending/isSent example: "it leaves the door open for 'impossible' states ... it is better to replace them with one `status` state variable that may take one of three valid states" (`'typing' | 'sending' | 'sent'`, booleans derived during render). Other principles: group related state, avoid redundant / duplicated / deeply nested state. — https://react.dev/learn/choosing-the-state-structure
- Reducer vs useState comparison (code size, readability, debugging, testing, preference). Reducers are pure and can be exported and tested in isolation (`actions.reduce(tasksReducer, initialState)`). Recommendation: "We recommend using a reducer if you often encounter bugs due to incorrect state updates in some component, and want to introduce more structure to its code." Mixing useState and useReducer in one component is fine. Reducers must be pure (no requests, timeouts). — https://react.dev/learn/extracting-state-logic-into-a-reducer
- eslint-plugin-react-hooks `set-state-in-effect` flags synchronous setState in effects (derived state, setting loading flags); preferred fix: compute during render. — https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect . Relevant because an FSM/reducer refactor tends to replace effect-driven setState with explicit events.

**TypeScript**: discriminated unions (literal `kind` / `status` tag) narrow inside `switch`; exhaustiveness via assigning to `never` in `default`. — https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions (and `#exhaustiveness-checking`). A state union such as `{status:'idle'} | {status:'confirming', termId} | {status:'submitting', ...}` makes per-state data exist only where valid.

**Kent C. Dodds** (2020-03-02): replace `isLoading` booleans with `status: 'idle' | 'pending' | 'resolved' | 'rejected'`; presents XState as the fuller form where status "is built into the machine". — https://kentcdodds.com/blog/stop-using-isloading-booleans

Pros: zero bytes, no new concept for the team, pure reducer testable directly in Vitest, native TS narrowing, no StrictMode/Compiler interop concerns.
Cons: async (fetch/submit) stays in handlers/effects outside the reducer; no hierarchy/parallel states, guards or visualizer; "transition table" discipline is by convention only (a reducer accepts any action in any state unless written as `switch (state.status)` then `switch (action.type)`, ignoring invalid events).

Confidence: High.

## 3. Option B: XState v5 + @xstate/react

**Typing** (https://stately.ai/docs/typescript): requires TypeScript >= 5.0 (project 5.9 OK); `strictNullChecks` strongly recommended; `setup({ types: { context, events, input }, actions, guards, actors })` is "the recommended way to strongly type your machine"; types then flow into `machine.transition(...)` and `actor.send(...)`. "Typegen is not supported in XState version 5"; use `assertEvent(...)` to narrow events in actions/guards.

**React API** (https://stately.ai/docs/xstate-react): "The `useMachine(...)` hook is an alias for the `useActor(...)` hook" -> `[snapshot, send, actorRef]`; `useActorRef` returns a static ref (no rerender) paired with `useSelector` (rerender only when the selected value changes); `createActorContext` for sharing via Context. The docs page states no React version limits; npm peer range includes `^19.0.0` (verified via `npm view @xstate/react peerDependencies`).

**React 19 caveats**
- StrictMode: historical double-instantiation issues (https://github.com/statelyai/xstate/issues/502, https://github.com/statelyai/xstate/issues/1237). The v6 docs describe current behaviour: in dev, StrictMode remount makes `useActor`/`useActorRef` create a fresh actor from the initial state; "That development-only stop and restart does not currently restart invoked or spawned children. If a child actor appears inert only under StrictMode, that is why; the behavior in production builds is unaffected." — https://stately.ai/docs/xstate/v6/react/use-machine (v6 alpha doc; whether identical behaviour applies to v5.33 is **uncertain**).
- React Compiler: open issue #5426 (2025-12-09, still open, no maintainer response seen): `useActor` compares machine config by reference, so machines built by a factory inside the component loop infinitely unless wrapped in `useMemo`. — https://github.com/statelyai/xstate/issues/5426. Mitigation: define the machine at module scope and pass runtime values via `input` / `machine.provide(...)`. Project does not appear to use React Compiler, so low impact today.

**Async / actors**: `fromPromise` actors invoked from states model fetch/submit with `onDone`/`onError`; guards and delayed transitions are built in (https://stately.ai/docs/xstate). An invoked actor is stopped when its state is exited, so stale responses from abandoned requests are ignored by construction (helps with async race conditions).

**Testing** (https://stately.ai/docs/testing, https://stately.ai/docs/pure-transitions):
- Actor-based: `createActor(machine).start()`, `send(...)`, assert `getSnapshot().value` / `.context`; mock actions/promise actors with `vi.fn()` via `machine.provide(...)`.
- Pure functions: `initialTransition(machine, input?)` -> `[state, actions]`, `transition(machine, state, event)` -> `[nextState, actions]`, plus `getMicrosteps` / `getInitialMicrosteps`. "The pure functions capture these actions but don't execute them" — comparable to testing a reducer.
- Model-based testing has moved into `xstate/graph`; standalone `@xstate/test` is deprecated.
- Caveat: states passed through only via eventless (`always`) transitions are not observable in snapshots.

**Tooling**: Stately visual editor / inspector (https://stately.ai) visualizes machines — useful for documenting a flow for non-code reviewers (not re-verified in detail this session).

Pros: explicit statecharts (hierarchy, parallel, guards, delays), async lifecycle owned by the machine, visualizer, strong typing, very active maintenance.
Cons: ~16 kB gz new dependency; significant learning curve (actors, snapshots, setup, provide, assign); StrictMode/Compiler quirks above; v6 on the horizon; more ceremony than one page's local UI state usually needs. Project standards (minimal-implementation, "minimal dependencies" in conventions) push against a new heavy dependency unless clearly justified.

Confidence: High for API/typing/size; Medium for StrictMode specifics on v5.

## 4. Option C: @xstate/store

"@xstate/store is a small library for simple state management"; docs compare it to "Zustand, Redux, and Pinia" and state "For more complex state management, you should use XState instead" — https://stately.ai/docs/xstate-store. It is an **event-driven store (context + event handlers), not a finite state machine**: no finite states, no per-state transition rules. Bridges into XState via `fromStore(...)`. v3 (2025-02-26) added selectors (https://stately.ai/blog/2025-02-26-xstate-store-v3); v4 removed deprecated APIs, added schemas, `createStoreLogic`, `createReducerAtom`, and split framework packages (`@xstate/store-react`) (https://github.com/statelyai/xstate/releases/tag/@xstate/store@4.0.0, https://stately.ai/docs/xstate-store/migration).

Verdict: offers no "impossible states impossible" guarantees beyond a typed useReducer; main benefit would be shared cross-component state with selectors. Adds 3.4 kB + React package. Confidence: High.

## 5. Option D: other small FSM libs

- **robot3** 1.2.0 (1.3 kB gz): functional, immutable FSM (`createMachine`, `state`, `transition`, `guard`, `reduce`, `invoke`, `interpret`), BSD-2, ~2.2k GitHub stars — https://github.com/matthewp/robot . React via `react-robot` (peer includes React 19). Last release 2025-09-20 (a year old). **Flag**: the documented site https://thisrobot.life/ returned a parked-domain page on 2026-09-23 — documentation availability is a maintenance risk. Guard/invoke/nesting details not re-verified (Low-Medium confidence on feature list).
- **@zag-js/core** 1.44.0 (2.7 kB gz): Zag is "a framework agnostic toolkit for implementing complex, interactive, and accessible UI components" — https://zagjs.com/overview/introduction . Its machine engine targets widget internals (menus, dialogs, comboboxes), not page/app flow logic. Poor fit for TermPage flows.
- Not investigated in depth: `@xstate/fsm` (believed deprecated with XState v5 — unverified), `ts-pattern` (pattern matching, not an FSM).

## 6. When an FSM is recommended vs overkill (synthesis of sources)

- React docs: prefer a single `status` enum over contradictory booleans; reach for a reducer when you "often encounter bugs due to incorrect state updates" (react.dev links above). This is the lightweight "FSM" React itself endorses.
- Kent C. Dodds: status enums always; XState when async lifecycle and many states intertwine.
- David Khourshid (XState author), talk "Goodbye, useState" (https://gitnation.com/contents/goodbye-usestate): local state is fine and not to be avoided; centralizing logic in a reducer/machine makes it testable; choose tools by need. (Secondary summary via search; Medium confidence on exact wording.)
- Practical rule derived from sources: a few mutually exclusive modes and 1-2 async calls -> typed discriminated union + useReducer (or even one `useState<Status>`). Nested/parallel modes, timers, cancellation of in-flight async, many guards, or a need for a diagram shared with non-devs -> XState.

## 7. Comparison matrix

| Criterion | useReducer + DU | XState v5 | @xstate/store | robot3 | zag core |
|---|---|---|---|---|---|
| min+gz | 0 | ~15.9 kB (with react pkg) | 3.4 kB + react pkg | 1.3 kB (+ react-robot) | 2.7 kB |
| Real FSM | By convention (switch on state, then event) | Yes (statecharts) | No | Yes | Yes (widget-oriented) |
| TS ergonomics | Excellent native narrowing | Good via `setup({types})`, `assertEvent` | Good | Adequate (.d.ts) | Good, internal-oriented |
| React 19 | Native | Peer ^19 OK; StrictMode child-actor + Compiler caveats | Peer ^19 OK | Peer ^19 OK | Peer >=18 OK |
| Testability (Vitest) | Pure reducer | Pure `transition()` or actor; `xstate/graph` MBT | Store events | Pure-ish | n/a |
| Async | Outside reducer | Built-in actors, auto-cancel on exit | Outside | `invoke` | Built-in |
| Learning curve | Low | High | Low | Medium | Medium |
| Maintenance (2026-09) | React core | Very active (release 2026-09-22), v6 alpha | Active | Last release 2025-09; docs site down | Active |

## Gaps / uncertainties
- Tree-shaken XState cost in the project's Vite build not measured.
- StrictMode quote is from v6 alpha docs; v5 behaviour assumed similar, not confirmed.
- robot3 feature details and docs availability need confirmation if shortlisted.
