## Data Fetching & Dates

### TanStack Query for Server State

Fetch server state with TanStack Query v5 (`@tanstack/react-query`, `useQuery`), not `useState` + `useEffect`. Data access lives in hooks in `src/hooks/` (e.g. `useCategories`, `useProducts`, `useTermAccess`) that wrap functions from `src/api/*.ts`. Components use those hooks rather than calling `useQuery` ad hoc on API modules.

### One Shared QueryClient

Use the single `queryClient` from `src/api/queryClient.ts`, provided in `src/main.tsx` via `QueryClientProvider`. Retry policy: no retry for an `ApiError` with status < 500 (404/403/409 won't change on retry); up to 2 retries for network/5xx failures.

### Query Keys

Use array keys. The first element is a resource-name constant defined in the hook, followed by the params. Invalidate by that prefix.

```ts
const CATEGORIES_KEY = ["categories"] as const;
useQuery({ queryKey: CATEGORIES_KEY, queryFn: getCategories });
// ["products", { categoryId, search, sortField, pluginFilters }]
// ["groupAccess", groupId, termId ?? null]
```

### Mutations Invalidate the Resource Prefix

Call the `src/api` function, then `await queryClient.invalidateQueries({ queryKey: PREFIX })` so the hook's returned promise resolves only after the refetch. Invalidate the whole resource prefix, not one filtered list, because a write can move items between filtered lists. Backend error messages (`extractProblemMessage`) must reach the caller verbatim (e.g. a 409 shown inline).

```ts
const remove = useCallback(async (id: number) => {
  try { await apiDeleteCategory(id); } catch (err) { throw new Error(extractProblemMessage(err)); }
  await queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
}, [queryClient]);
```

### App-Shaped Hook Return

Hooks return a stable app shape so components don't depend on React Query types:
- `data` with a module-level empty-array fallback constant (stable reference, e.g. `const NO_CATEGORIES: Category[] = []`)
- `loading = query.isPending`
- `error: string | null`
- `refetch(): Promise<void>`

### Keep Values Out of the Key When Data Must Survive Their Change

Don't put a value in the query key if its change must NOT discard the data currently shown. Example: `useTermAccess` keeps the auth token out of the key. The query result is tagged `{ data, forToken }`, a `useEffect` refetches on token change, and `isStale` is derived (`forToken !== token`). The page keeps showing the old data, and keeps it alongside `refreshError` if the refetch fails. Document the reason in the hook's doc comment.

### Dates with dayjs

New date formatting/manipulation code uses `dayjs` imported from `src/utils/dayjs.ts` (which sets the Polish locale `pl`). Never import directly from `"dayjs"`, and don't hand-roll `Date`/`Intl` logic. The existing `src/utils/format.ts` helpers are legacy (en-US `Intl`) and may be migrated to dayjs when touched.

```ts
import dayjs from "../utils/dayjs";
dayjs(iso).format("D MMMM YYYY");
```
