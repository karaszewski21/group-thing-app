/* `next/navigation` for Vitest (vitest.config.ts aliases it here). One URL
 * store per test run, driven by renderWithRoute and the mocked router. Plain
 * functions, not `vi.fn()`, so `vi.resetAllMocks()` leaves them working. */
import { useMemo, useSyncExternalStore } from "react";
import { matchPath } from "../routing/paths";

export interface MockRouterCall {
  method: "push" | "replace" | "back" | "refresh";
  /** `null` for back and refresh. */
  href: string | null;
  scroll: boolean;
}

interface MockNavigateOptions {
  scroll?: boolean;
}

const BASE = "http://localhost";

let entries: string[] = ["/"];
let index = 0;
let patterns: string[] = ["*"];
const calls: MockRouterCall[] = [];
const listeners = new Set<() => void>();

function currentHref(): string {
  return entries[index];
}

function toHref(url: string): string {
  const { pathname, search, hash } = new URL(url, BASE + currentHref());
  return pathname + search + hash;
}

/** jsdom's URL follows, as the browser's does under Next. */
function mirror(method: "pushState" | "replaceState") {
  if (typeof window !== "undefined") window.history[method](null, "", currentHref());
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Starts a fresh history at `url`; `routePatterns` (`/a/:id`, `/b/*`) are
 * the pages `useParams` and renderWithRoute match against. */
export function resetMockNavigation(url: string, routePatterns: string[] = ["*"]): void {
  entries = [toHref(url)];
  index = 0;
  patterns = routePatterns;
  calls.length = 0;
  mirror("replaceState");
  emit();
}

export function getMockUrl(): { pathname: string; search: string; hash: string } {
  const { pathname, search, hash } = new URL(currentHref(), BASE);
  return { pathname, search, hash };
}

/** Every router call since the last reset, in order. */
export function getMockRouterCalls(): readonly MockRouterCall[] {
  return calls;
}

function rank(pattern: string): number {
  const segments = pattern.split("/").filter(Boolean);
  const splat = segments.at(-1) === "*";
  return segments.reduce(
    (score, segment) => score + (segment === "*" ? 0 : segment.startsWith(":") ? 3 : 10),
    segments.length + (splat ? -2 : 0),
  );
}

/** The most specific of `candidates` matching `pathname` (static segments
 * over params over a splat, the first on a tie), or `null`. */
export function matchMockRoute(candidates: string[], pathname: string): { pattern: string; params: Record<string, string> } | null {
  let best: { pattern: string; params: Record<string, string>; score: number } | null = null;
  for (const pattern of candidates) {
    const match = matchPath(pattern, pathname);
    if (!match) continue;
    const score = rank(pattern);
    if (!best || score > best.score) best = { pattern, params: match.params, score };
  }
  return best && { pattern: best.pattern, params: best.params };
}

function go(method: "push" | "replace", href: string, options: MockNavigateOptions = {}) {
  calls.push({ method, href, scroll: options.scroll ?? true });
  if (method === "push") {
    entries = [...entries.slice(0, index + 1), toHref(href)];
    index += 1;
  } else {
    entries = entries.map((entry, i) => (i === index ? toHref(href) : entry));
  }
  mirror(method === "push" ? "pushState" : "replaceState");
  emit();
}

function back() {
  calls.push({ method: "back", href: null, scroll: true });
  if (index === 0) return;
  index -= 1;
  mirror("replaceState");
  emit();
}

const router = {
  push: (href: string, options?: MockNavigateOptions) => go("push", href, options),
  replace: (href: string, options?: MockNavigateOptions) => go("replace", href, options),
  back,
  refresh: () => {
    calls.push({ method: "refresh", href: null, scroll: true });
  },
};

export type MockRouter = typeof router;

function useHref(): string {
  return useSyncExternalStore(subscribe, currentHref, currentHref);
}

export function useRouter(): MockRouter {
  return router;
}

export function usePathname(): string {
  return new URL(useHref(), BASE).pathname;
}

/** A new object whenever the URL changes, hash included, as under Next. */
export function useSearchParams(): URLSearchParams {
  const href = useHref();
  return useMemo(() => new URL(href, BASE).searchParams, [href]);
}

/** The params of the best-matching route pattern; a splat is an array, as a
 * Next catch-all segment is. */
export function useParams(): Record<string, string | string[]> {
  const pathname = usePathname();
  return useMemo(() => {
    const match = matchMockRoute(patterns, pathname);
    if (!match) return {};
    const { "*": splat, ...params } = match.params;
    return splat === undefined ? params : { ...params, "*": splat.split("/").filter(Boolean) };
  }, [pathname]);
}

export class RedirectSentinel extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`NEXT_REDIRECT ${url}`);
    this.url = url;
  }
}

export class NotFoundSentinel extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export function redirect(url: string): never {
  throw new RedirectSentinel(url);
}

export function notFound(): never {
  throw new NotFoundSentinel();
}
