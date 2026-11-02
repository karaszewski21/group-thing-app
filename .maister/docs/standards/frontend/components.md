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

### Feature Folders and Thin Route Files
Feature code lives in `src/features/<domain>/` (pages, views, view states and feature hooks); shared UI lives in `src/components/{layout,shared}/`. `src/app/` holds route files only (`page.tsx`, `layout.tsx`, `not-found.tsx`): a page renders one feature entry and holds no feature logic.
A page that needs server data for `generateMetadata` or the organizer palette is a server component that wraps a `"use client"` feature entry, and reads the backend only through `src/api/server.ts` (see `data-fetching.md`). Example: `src/frontend/src/app/(site)/[organizationSlug]/event/[eventId]/page.tsx` around `features/events/EventPage.tsx`.
A page that only calls server `redirect()` (a legacy URL) never sits under a layout that withholds `children` during server rendering (`ClientOnly`, a loading gate): there the redirect becomes a client redirect with status 200. Put such pages in a route group outside that layout, as `admin/(shell)/` and `product/[id]/(item)/` do.

### Router Access Only Through the Facade
Components and hooks reach the router only through `src/routing/navigation.tsx`: `useAppNavigate`, `Link`, `Navigate`, `useAppParams`, `useAppPathname`, `useAppSearch`, `useAppSearchParams`, `useAppHash`, `useNavigationGuard`, `useHasInAppHistory`, `useRouterRefresh`. Path builders and `PROTECTED_PREFIXES` live in `routing/paths.ts`. Never import `next/navigation` or `next/link` in feature code; ESLint `no-restricted-imports` allows them only in `src/routing/`, `src/app/` (server `redirect()`/`notFound()`) and the test mocks.
State handed to the next page goes through `navigate(to, { state })` or `<Link state>` and is read once with `useNavigationState<T>()`; it is lost on a hard reload, so the target page must render without it. Search-param-only updates pass `scroll: false` to keep the scroll position.
```tsx
const navigate = useAppNavigate();
navigate(eventPath(event.author_slug, event.id), { state: { toast: savedToast(event) } }); // EventCreateView
const state = useNavigationState<unknown>(); // EventPage: null on reload or a later visit
```

### Server-Safe Rendering
Components on server-rendered routes must not touch `window`, `document`, `localStorage` or `sessionStorage` during render or at module load. Read browser-only values with `useClientValue(read, serverValue)` or `useOrigin()` from `src/lib/useClientValue.ts`, and write to storage only in effects or handlers. Every `useSyncExternalStore` call passes a `getServerSnapshot` (the third argument): without it, React throws while server rendering. Wrap a subtree that cannot render on the server in `routing/ClientOnly.tsx`. Chrome that renders only for a logged-in user gets a `renderToString` case with `initialToken` in `test/ssrSafety.test.tsx`.
```ts
const openSheetCount = useSyncExternalStore(subscribeOpenSheets, getOpenSheetCount, () => 0);
const origin = useOrigin(); // "" while server rendering
```

### Pages With Several Screens: One View State
A page that shows mutually exclusive screens derives ONE discriminated view state in a pure function `resolve…View(...)`, kept in a separate `*ViewState.ts` file.
The page component only `switch`es over `view.kind` and renders one view component per state.
Do not scatter `if` checks across the JSX, and do not let a child component re-derive which screen it is.
Test the resolver as a table with `it.each`, one row per state, including edge cases such as stale or refresh-error states.
Flows and side effects tied to the state (URL params, storage, mutations) live in a dedicated hook that takes `view.kind`, not in the page.
Narrow sub-unions with `Extract<…>` for views that handle several states.
Examples: `src/frontend/src/features/terms/termViewState.ts`, `features/terms/TermPage.tsx`, `features/terms/hooks/useJoinCodeLink.ts`, `test/termViewState.test.ts`.

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
