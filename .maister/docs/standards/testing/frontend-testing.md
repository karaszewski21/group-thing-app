## Frontend Testing

### Vitest as Test Runner

Use Vitest with `globals: true`; test files still import Vitest APIs explicitly (see Explicit Vitest Imports). Use jsdom as the test environment for browser-like DOM APIs.

```typescript
// vitest.config.ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "next/navigation": fileURLToPath(new URL("./src/test/navigationMock.ts", import.meta.url)),
      "next/link": fileURLToPath(new URL("./src/test/nextLinkMock.tsx", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

### Explicit Vitest Imports

Test files under `src/test` import `describe`/`it`/`expect`/`vi` (and `beforeEach`/`afterEach`) explicitly from `"vitest"` even though `globals: true` is set, because `npm run typecheck` (`tsc --noEmit` on the single `tsconfig.json`, `types: ["node", "next"]`) type-checks `src/test` without Vitest global types.

```typescript
import { describe, expect, it, vi } from "vitest";
```

### Testing Library for Components

Use `@testing-library/react` for rendering and querying components. Use `@testing-library/jest-dom` for extended DOM matchers. Import jest-dom in the setup file:

```typescript
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

### Render Routed Components With renderWithRoute

Anything that uses the navigation facade (`src/routing/navigation.tsx`) renders through `renderWithRoute(ui, options)` from `src/test/renderWithRoute.tsx`, never through a hand-built router. Options: `url` (the start URL, required), `pattern` (the route `ui` is rendered on; its params feed `useAppParams`, default `"*"`), `routes` (other pages by pattern, e.g. `{ "/login": <p>Logowanie</p> }`), `state` (navigation state for the start URL) and any Testing Library render option such as `wrapper`. The page whose pattern matches the current mocked URL is rendered, as the App Router picks one. `routeWrapper(...)` is the `renderHook` counterpart, and `routeElement(...)` returns the routed tree for `renderToString`.
Assert navigation with `getTestLocation()` (the current `{ pathname, search }`, raw: `/home` stays `/home`) or `getTestRouter().calls` (every facade navigation in order). Check `window.location` only for hard redirects that bypass the facade (e.g. a mocked `window.location.href`).
A per-file `renderWithProviders()` helper is still fine when a file needs more providers (ChakraProvider, PluginProvider); it wraps `ui` and calls `renderWithRoute`. Keep such helpers per-file. If the tree uses React Query, pass `wrapper: createQueryWrapper()` (see React Query in Tests).

```typescript
function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
  return renderWithRoute(<ChakraProvider value={system}>{ui}</ChakraProvider>, {
    url: initialRoute,
    wrapper: createQueryWrapper(),
  });
}

renderWithRoute(<PanelGate>{null}</PanelGate>, { url: "/add/event", routes: { "/login": <p>Logowanie</p> } });
await waitFor(() => expect(getTestLocation().pathname).toBe("/login"));
```

### Next Router Mocks Through Aliases Only

`vitest.config.ts` aliases `next/navigation` to `src/test/navigationMock.ts` and `next/link` to `src/test/nextLinkMock.tsx`. The mock keeps one URL store driven by `renderWithRoute` and the mocked router; its functions are plain functions, not `vi.fn()`, so `vi.resetAllMocks()` leaves them working. `redirect()` and `notFound()` throw `RedirectSentinel`/`NotFoundSentinel`. Never `vi.mock("next/navigation")` or `vi.mock("next/link")` per file.

### Server-Rendering Checks

`src/test/ssrSafety.test.tsx` runs under `// @vitest-environment node` and renders server-rendered pages and chrome with `renderToString(routeElement(...))`, so a render-time browser access or a `useSyncExternalStore` without `getServerSnapshot` fails there. Chrome that renders only for a logged-in user gets a case with `AuthProvider initialToken`.

### React Query in Tests

Wrap anything that renders a component or hook using React Query with a QueryClient from `src/test/queryClient.tsx`. The module exports `createQueryWrapper()`, `createTestQueryClient()` and `withQueryClient(ui)`.
- Use a fresh QueryClient per test (no cache shared across tests), with `retry: false` so mocked rejections surface immediately.
- Pass the wrapper via render's `wrapper` option (not inside the ui element) so `rerender()` keeps the same client and cache.
- `src/test/setup.ts` sets `notifyManager.setScheduler(queueMicrotask)` so React Query's observer notifications flush inside `act()` instead of after it (the default is `setTimeout(0)`). Do not remove it.

```typescript
renderHook(() => useCategories(), { wrapper: createQueryWrapper() });
render(<CategoriesPage />, { wrapper: createQueryWrapper() });
```

### API Module Mocking

Mock API modules at the module level using `vi.mock()` with factory functions. Reset mocks between tests with `vi.resetAllMocks()` in `beforeEach`. Configure return values per test or in `beforeEach`.

```typescript
vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(mockCategories);
});
```

### Pin the Clock for Date-Dependent UI

Tests whose output depends on "now" (upcoming vs past Terms, weekday labels, snooze expiry) call `vi.useFakeTimers({ toFake: ["Date"] })` plus `vi.setSystemTime(...)` and restore with `vi.useRealTimers()` in `afterEach`. Faking only `Date` keeps `findBy*` polling working. Use fixture dates whose weekday matches the assertion.

```typescript
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00"));
});
afterEach(() => vi.useRealTimers());
```

### Test Organization

Use `describe()` blocks named after the page or feature being tested. Place test files in `src/test/` directory.

### Typed Fixtures
Fixture factories return fully typed objects — no `as <ResponseType>` casts — so `tsc` catches DTO drift when a response type gains a field. A cast once hid a missing `listing_status` and caused a runtime crash in `OrganizerItemRoute.test.tsx`.
```typescript
// DON'T: return { ... } as ItemDetailsResponse;
function details(overrides: Partial<ItemDetailsResponse> = {}): ItemDetailsResponse {
  return { /* every field */ listing_status: "ACTIVE", ...overrides };
}
```
