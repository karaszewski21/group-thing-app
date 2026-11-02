import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { useLayoutEffect, type ComponentType, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useAppNavigate, type AppNavigate } from "../routing/navigation";
import { clearAllNavigationStates, setNavigationState } from "../routing/navigationState";
import { NavigationTracker, subscribeNavigationCalls, type NavigationCall } from "../routing/NavigationTracker";

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

let currentLocation: TestLocation = { pathname: "/", search: "" };
let router: TestRouter | null = null;

function Probe({ calls }: { calls: NavigationCall[] }) {
  const { pathname, search } = useLocation();
  const navigate = useAppNavigate();
  useLayoutEffect(() => {
    currentLocation = { pathname, search };
  }, [pathname, search]);
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

function tree(ui: ReactNode, url: string, pattern: string, routes: Record<string, ReactNode>, calls: NavigationCall[]) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <NavigationTracker />
      <Probe calls={calls} />
      <Routes>
        <Route path={pattern} element={ui} />
        {Object.entries(routes).map(([routePattern, element]) => (
          <Route key={routePattern} path={routePattern} element={element} />
        ))}
      </Routes>
    </MemoryRouter>
  );
}

/** Renders `ui` as the page at `url`, inside the app's router. `rerender`
 * keeps the router (and its current location). */
export function renderWithRoute(
  ui: ReactElement,
  { url, pattern = "*", routes = {}, state, ...renderOptions }: RenderWithRouteOptions,
): RenderResult {
  clearAllNavigationStates();
  if (state !== undefined) setNavigationState(url, state);
  const calls: NavigationCall[] = [];
  const result = render(tree(ui, url, pattern, routes, calls), renderOptions);
  return {
    ...result,
    rerender: (next: ReactNode) => result.rerender(tree(next, url, pattern, routes, calls)),
  };
}

/** The routed page as an element, for `renderToString` (no DOM render). */
export function routeElement(
  ui: ReactElement,
  { url, pattern = "*", routes = {} }: Pick<RenderWithRouteOptions, "url" | "pattern" | "routes">,
): ReactElement {
  return tree(ui, url, pattern, routes, []);
}

/** A `renderHook` wrapper: the hook runs on the page at `url`, inside
 * `wrapper` (e.g. `createQueryWrapper()`) when one is given. */
export function routeWrapper({
  wrapper: Outer,
  ...options
}: Pick<RenderWithRouteOptions, "url" | "pattern" | "routes"> & {
  wrapper?: ComponentType<{ children: ReactNode }>;
}): ComponentType<{ children: ReactNode }> {
  clearAllNavigationStates();
  return function RouteWrapper({ children }: { children: ReactNode }) {
    const page = routeElement(<>{children}</>, options);
    return Outer ? <Outer>{page}</Outer> : page;
  };
}

/** The test router's current location (raw: `/home` stays `/home`). */
export function getTestLocation(): TestLocation {
  return currentLocation;
}

export function getTestRouter(): TestRouter {
  if (!router) throw new Error("getTestRouter() needs renderWithRoute() first");
  return router;
}
