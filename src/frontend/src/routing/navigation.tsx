/* The app's only door to the router (React Router today). Every page,
 * layout and hook navigates and reads the URL through these exports, so the
 * router underneath can be swapped without touching the call sites. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type Ref,
} from "react";
import { Link as RouterLink, useLocation, useNavigate, useParams } from "react-router-dom";
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
  const routerNavigate = useNavigate();
  const { pathname } = useLocation();
  // The router's function changes with the location; the returned one stays
  // stable so effects that navigate run once.
  const latest = useRef({ routerNavigate, pathname });
  useLayoutEffect(() => {
    latest.current = { routerNavigate, pathname };
  });

  return useCallback((target, options = {}) => {
    if (target === -1) {
      recordNavigation({ method: "back", url: null, scroll: true });
      void latest.current.routerNavigate(-1);
      return;
    }
    const to = resolveTo(target, latest.current.pathname);
    const { replace = false, state, scroll = true } = options;
    const go = () => {
      setNavigationState(to, state);
      recordNavigation({ method: replace ? "replace" : "push", url: to, scroll });
      void latest.current.routerNavigate(to, { replace, preventScrollReset: !scroll });
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
  const to = resolveTo(target, useLocation().pathname);
  return (
    <RouterLink
      {...anchorProps}
      to={to}
      replace={replace}
      preventScrollReset={!scroll}
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
  return useParams() as Readonly<Partial<Params>>;
}

/** The app pathname: `/home` (the session holder's `/`) reads as `/`. */
export function useAppPathname(): string {
  return normalizeAppPath(useLocation().pathname);
}

/** The raw query string, with its leading `?` (empty when there is none). */
export function useAppSearch(): string {
  return useLocation().search;
}

/** The raw fragment, with its leading `#` (empty when there is none). */
export function useAppHash(): string {
  return useLocation().hash;
}

type SearchParamsInit = ConstructorParameters<typeof URLSearchParams>[0];
export type SetSearchParams = (
  next: SearchParamsInit | ((current: URLSearchParams) => SearchParamsInit),
  options?: { replace?: boolean },
) => void;

/** The query string as `URLSearchParams`, and a setter that keeps the
 * pathname and the scroll position. */
export function useAppSearchParams(): [URLSearchParams, SetSearchParams] {
  const { pathname, search } = useLocation();
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

/** Re-renders server-provided data; nothing to do on a client-only router. */
export function useRouterRefresh(): () => void {
  return useCallback(() => {}, []);
}
