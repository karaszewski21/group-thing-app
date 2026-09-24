import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

/** A fresh client per test: no cache shared between tests, and no retries,
 * so a mocked rejection surfaces as an error immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** `wrapper` for `renderHook`: `renderHook(() => useX(), { wrapper: createQueryWrapper() })`. */
export function createQueryWrapper(client = createTestQueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Wraps a tree for `render`, inside each file's `renderWithProviders()`. */
export function withQueryClient(ui: ReactElement, client = createTestQueryClient()): ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
