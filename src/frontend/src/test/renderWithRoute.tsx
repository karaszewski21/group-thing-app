import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { useLayoutEffect, type ComponentType, type ReactElement, type ReactNode } from "react";
import { useAppNavigate, type AppNavigate } from "../routing/navigation";
import { clearAllNavigationStates, setNavigationState } from "../routing/navigationState";
import { NavigationTracker, subscribeNavigationCalls, type NavigationCall } from "../routing/NavigationTracker";
import { getMockUrl, matchMockRoute, resetMockNavigation, usePathname } from "./navigationMock";

export interface RenderWithRouteOptions extends Omit<RenderOptions, "queries"> {
  /** The URL the test starts on (pathname, query and hash). */
  url: string;
  /** The route pattern `ui` is rendered on; its params feed `useAppParams`. */
  pattern?: string;
  /** Other pages by pattern, e.g. `{ "/login": <p>Login</p> }`. */
  routes?: Record<string, ReactNode>;
  /** Navigation state handed to the start URL (read with `useNavigationState`). */
  state?: unknown;
}

export interface TestLocation {
  pathname: string;
  search: string;
}

export interface TestRouter {
  /** Every navigation the facade performed, in order. */
  calls: NavigationCall[];
  /** The facade's navigate: guards apply, as for the app's own calls. */
  navigate: AppNavigate;
}

let router: TestRouter | null = null;

function Probe({ calls }: { calls: NavigationCall[] }) {
  const navigate = useAppNavigate();
  useLayoutEffect(() => {
    router = { calls, navigate };
  }, [calls, navigate]);
  useLayoutEffect(
    () =>
      subscribeNavigationCalls((call) => {
        calls.push(call);
      }),
    [calls],
  );
  return null;
}

/** The page whose pattern matches the mocked URL, as the App Router picks
 * one. Unkeyed: pages of the same component keep their state, as pages
 * under a shared layout do. */
function Page({ pages }: { pages: Record<string, ReactNode> }) {
  const match = matchMockRoute(Object.keys(pages), usePathname());
  return match && pages[match.pattern];
}

function tree(ui: ReactNode, pattern: string, routes: Record<string, ReactNode>, calls: NavigationCall[]) {
  return (
    <>
      <NavigationTracker />
      <Probe calls={calls} />
      <Page pages={{ [pattern]: ui, ...routes }} />
    </>
  );
}

function start(url: string, pattern: string, routes: Record<string, ReactNode>) {
  resetMockNavigation(url, [pattern, ...Object.keys(routes)]);
}

/** Renders `ui` as the page at `url`, inside the app's router. `rerender`
 * keeps the router (and its current location). */
export function renderWithRoute(
  ui: ReactElement,
  { url, pattern = "*", routes = {}, state, ...renderOptions }: RenderWithRouteOptions,
): RenderResult {
  clearAllNavigationStates();
  if (state !== undefined) setNavigationState(url, state);
  start(url, pattern, routes);
  const calls: NavigationCall[] = [];
  const result = render(tree(ui, pattern, routes, calls), renderOptions);
  return {
    ...result,
    rerender: (next: ReactNode) => result.rerender(tree(next, pattern, routes, calls)),
  };
}

/** The routed page as an element, for `renderToString` (no DOM render). */
export function routeElement(
  ui: ReactElement,
  { url, pattern = "*", routes = {} }: Pick<RenderWithRouteOptions, "url" | "pattern" | "routes">,
): ReactElement {
  start(url, pattern, routes);
  return tree(ui, pattern, routes, []);
}

/** A `renderHook` wrapper: the hook runs on the page at `url`, inside
 * `wrapper` (e.g. `createQueryWrapper()`) when one is given. */
export function routeWrapper({
  wrapper: Outer,
  ...options
}: Pick<RenderWithRouteOptions, "url" | "pattern" | "routes"> & {
  wrapper?: ComponentType<{ children: ReactNode }>;
}): ComponentType<{ children: ReactNode }> {
  const { url, pattern = "*", routes = {} } = options;
  clearAllNavigationStates();
  start(url, pattern, routes);
  return function RouteWrapper({ children }: { children: ReactNode }) {
    const page = tree(<>{children}</>, pattern, routes, []);
    return Outer ? <Outer>{page}</Outer> : page;
  };
}

/** The test router's current location (raw: `/home` stays `/home`). */
export function getTestLocation(): TestLocation {
  const { pathname, search } = getMockUrl();
  return { pathname, search };
}

export function getTestRouter(): TestRouter {
  if (!router) throw new Error("getTestRouter() needs renderWithRoute() first");
  return router;
}
