## Components

### Single Responsibility
Each component should do one thing well.

### Reusability
Design components to work across different contexts with configurable props.

### Composability
Build complex UIs by combining smaller components rather than creating monoliths.

### Clear Interface
Define explicit, documented props with sensible defaults.

### Encapsulation
Keep implementation details private; expose only what's necessary.

### Consistent Naming
Use descriptive names that indicate purpose and follow team conventions.

### Local State
Keep state as close to where it's used as possible; lift only when needed.

### Minimal Props
If a component needs many props, consider composition or splitting it.

### Documentation
Document usage, props, and examples to help team adoption.

### Pages With Several Screens: One View State
A page that shows mutually exclusive screens derives ONE discriminated view state in a pure function `resolve…View(...)`, kept in a separate `*ViewState.ts` file.
The page component only `switch`es over `view.kind` and renders one view component per state.
Do not scatter `if` checks across the JSX, and do not let a child component re-derive which screen it is.
Test the resolver as a table with `it.each`, one row per state, including edge cases such as stale or refresh-error states.
Flows and side effects tied to the state (URL params, storage, mutations) live in a dedicated hook that takes `view.kind`, not in the page.
Narrow sub-unions with `Extract<…>` for views that handle several states.
Examples: `src/frontend/src/pages/term/termViewState.ts`, `pages/term/TermPage.tsx`, `pages/term/hooks/useJoinCodeLink.ts`, `test/termViewState.test.ts`.

```ts
export type TermViewState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "content"; group: PublicCircleResponse; isAttending: boolean }
  | { kind: "loginRequired"; group: PublicCircleResponse; refreshError: string | null }
  | { kind: "enterCode"; group: PublicCircleResponse; refreshError: string | null }
  | { kind: "refreshFailed"; group: PublicCircleResponse };

const view = resolveTermView(state, isStale);
switch (view.kind) {
  case "loading": return <TermPageSkeleton />;
  case "content": return <PublicTermView ... />;
  default: return <PrivateTermView view={view} ... />;
}
```
