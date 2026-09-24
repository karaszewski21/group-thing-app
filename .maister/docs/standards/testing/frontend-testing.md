## Frontend Testing

### Vitest as Test Runner

Use Vitest with `globals: true` (describe/it/expect available without imports). Use jsdom as the test environment for browser-like DOM APIs.

```typescript
// vitest.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

### Testing Library for Components

Use `@testing-library/react` for rendering and querying components. Use `@testing-library/jest-dom` for extended DOM matchers. Import jest-dom in the setup file:

```typescript
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

### renderWithProviders Helper

Define a `renderWithProviders()` helper per test file that wraps components in required providers (ChakraProvider, MemoryRouter). Keep helpers per-file, not shared globally. If the tree uses React Query, also pass `wrapper: createQueryWrapper()` (see React Query in Tests).

```typescript
function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
  );
}
```

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

### Test Organization

Use `describe()` blocks named after the page or feature being tested. Place test files in `src/test/` directory.
