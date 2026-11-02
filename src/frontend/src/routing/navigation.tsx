/* The app's only door to the router (Next.js App Router). Every page,
 * layout and hook navigates and reads the URL through these exports, so the
 * router underneath can be swapped without touching the call sites. */
"use client";

import NextLink from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type Ref,
} from "react";
import { interceptNavigation } from "./navigationGuard";
import { clearNavigationState, peekNavigationState, setNavigationState } from "./navigationState";
import { recordNavigation } from "./NavigationTracker";
import { normalizeAppPath } from "./paths";

export { useNavigationGuard, type NavigationBlocker, type NavigationTarget } from "./navigationGuard";
export { useHasInAppHistory } from "./NavigationTracker";

export interface NavigateOptions {
  replace?: boolean;
  /** Handed to the target page, read there once with `useNavigationState`. */
  state?: unknown;
  /** `false` keeps the scroll position. */
  scroll?: boolean;
}

/** Navigates to an absolute app path, or one history step back with `-1`. */
export type AppNavigate = (to: string | -1, options?: NavigateOptions) => void;

/** Absolute app paths pass through; a query- or fragment-only target
 * (`?edit=1`) stays on the current pathname. */
function resolveTo(to: string, currentPathname: string): string {
  return to.startsWith("?") || to.startsWith("#") ? currentPathname + to : to;
}

function pathnameOf(to: string): string {
  return normalizeAppPath(new URL(to, "http://app.invalid").pathname);
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  const target = event.currentTarget.getAttribute("target");
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!target || target === "_self")
  );
}

export function useAppNavigate(): AppNavigate {
  const router = useRouter();
  const pathname = usePathname();
  // The returned function stays stable across locations so effects that
  // navigate run once.
  const latest = useRef({ router, pathname });
  useLayoutEffect(() => {
    latest.current = { router, pathname };
  });

  return useCallback((target, options = {}) => {
    if (target === -1) {
      recordNavigation({ method: "back", url: null, scroll: true });
      latest.current.router.back();
      return;
    }
    const to = resolveTo(target, latest.current.pathname);
    const { replace = false, state, scroll = true } = options;
    const go = () => {
      setNavigationState(to, state);
      recordNavigation({ method: replace ? "replace" : "push", url: to, scroll });
      if (replace) latest.current.router.replace(to, { scroll });
      else latest.current.router.push(to, { scroll });
    };
    if (!interceptNavigation({ pathname: pathnameOf(to) }, go)) go();
  }, []);
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  replace?: boolean;
  state?: unknown;
  scroll?: boolean;
  ref?: Ref<HTMLAnchorElement>;
}

/** An in-app link. A guard (`useNavigationGuard`) can hold its click back. */
export function Link({ to: target, replace = false, state, scroll = true, onClick, ...anchorProps }: LinkProps) {
  const to = resolveTo(target, usePathname());
  return (
    <NextLink
      {...anchorProps}
      href={to}
      replace={replace}
      scroll={scroll}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event)) return;
        setNavigationState(to, state);
        recordNavigation({ method: replace ? "replace" : "push", url: to, scroll });
      }}
    />
  );
}

/** Navigates once it is rendered (a client redirect). */
export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useAppNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);
  return null;
}

/** The current route's params, keyed as in the route patterns; a catch-all
 * segment is `"*"` (the rest of the path, joined with `/`). */
export function useAppParams<
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
>(): Readonly<Partial<Params>> {
  const params = useParams();
  return useMemo(() => {
    const appParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params ?? {})) {
      if (Array.isArray(value)) appParams["*"] = value.join("/");
      else if (value !== undefined) appParams[key] = value;
    }
    return appParams as Readonly<Partial<Params>>;
  }, [params]);
}

/** The app pathname: `/home` (the session holder's `/`) reads as `/`. */
export function useAppPathname(): string {
  return normalizeAppPath(usePathname());
}

/** The query string, with its leading `?` (empty when there is none). */
export function useAppSearch(): string {
  const query = useSearchParams().toString();
  return query ? `?${query}` : "";
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The fragment, with its leading `#` (empty when there is none; always
 * empty on the server, which never sees it). */
export function useAppHash(): string {
  // The router's search params change with every URL change, hash-only ones
  // included, so this re-renders and re-reads the hash after a navigation.
  useSearchParams();
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
}

type SearchParamsInit = ConstructorParameters<typeof URLSearchParams>[0];
export type SetSearchParams = (
  next: SearchParamsInit | ((current: URLSearchParams) => SearchParamsInit),
  options?: { replace?: boolean },
) => void;

/** The query string as `URLSearchParams`, and a setter that keeps the
 * pathname and the scroll position. */
export function useAppSearchParams(): [URLSearchParams, SetSearchParams] {
  const pathname = usePathname();
  const search = useAppSearch();
  const navigate = useAppNavigate();
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);

  const setSearchParams = useCallback<SetSearchParams>(
    (next, { replace = false } = {}) => {
      const init = typeof next === "function" ? next(new URLSearchParams(searchParams)) : next;
      const query = new URLSearchParams(init).toString();
      navigate(query ? `${pathname}?${query}` : pathname, { replace, scroll: false });
    },
    [navigate, pathname, searchParams],
  );

  return [searchParams, setSearchParams];
}

/** The state the previous page handed over with this navigation, read once:
 * a later visit, a reload or a remount gets `null`. */
export function useNavigationState<T>(): T | null {
  const url = useAppPathname() + useAppSearch();
  const [entry, setEntry] = useState(() => ({ url, state: peekNavigationState(url) }));
  let current = entry;
  if (entry.url !== url) {
    current = { url, state: peekNavigationState(url) };
    setEntry(current);
  }
  useEffect(() => {
    clearNavigationState(current.url);
  }, [current.url]);
  return current.state as T | null;
}

/** Re-renders server-provided data (server components, metadata). */
export function useRouterRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => router.refresh(), [router]);
}
