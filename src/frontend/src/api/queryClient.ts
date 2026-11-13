import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";

const MAX_RETRIES = 2;

/** A 4xx (404, 403, 409…) won't change on retry — only network and 5xx
 * failures are worth retrying. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** The app's query client: a new one per server render, so no cache is shared
 * between requests, and one singleton in the browser. */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}
