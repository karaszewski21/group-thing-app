import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Link,
  useAppPathname,
  useAppSearchParams,
  useHasInAppHistory,
  useNavigationGuard,
  useNavigationState,
} from "../routing/navigation";
import { matchPath, normalizeAppPath } from "../routing/paths";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

function StatePage() {
  const state = useNavigationState<{ note: string }>();
  return <p>{state ? state.note : "bez stanu"}</p>;
}

function HistoryPage() {
  const hasInAppHistory = useHasInAppHistory();
  return (
    <>
      <p>{hasInAppHistory ? "z historią" : "bez historii"}</p>
      <Link to="/next">Dalej</Link>
    </>
  );
}

function SearchPage() {
  const [searchParams, setSearchParams] = useAppSearchParams();
  return (
    <button
      type="button"
      onClick={() =>
        setSearchParams(
          (params) => {
            params.set("tab", "layout");
            return params;
          },
          { replace: true },
        )
      }
    >
      {searchParams.get("tab") ?? "brak"}
    </button>
  );
}

function GuardedPage() {
  const pathname = useAppPathname();
  const blocker = useNavigationGuard((next) => next.pathname !== pathname);
  return (
    <>
      <p>{blocker.state}</p>
      <Link to="/other">Inna strona</Link>
      <button type="button" onClick={blocker.proceed}>
        Odrzuć
      </button>
      <button type="button" onClick={blocker.reset}>
        Zostań
      </button>
    </>
  );
}

describe("navigation facade", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("hands navigation state to the next page once", () => {
    renderWithRoute(<Link to="/next" state={{ note: "Dodano" }}>Dalej</Link>, {
      url: "/start",
      pattern: "/start",
      routes: { "/next": <StatePage />, "/away": <p>Gdzie indziej</p> },
    });

    fireEvent.click(screen.getByRole("link", { name: "Dalej" }));
    expect(screen.getByText("Dodano")).toBeInTheDocument();

    act(() => getTestRouter().navigate("/away"));
    act(() => getTestRouter().navigate("/next"));
    expect(screen.getByText("bez stanu")).toBeInTheDocument();
  });

  it("reports in-app history only after a client navigation", () => {
    renderWithRoute(<HistoryPage />, { url: "/start" });

    expect(screen.getByText("bez historii")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Dalej" }));

    expect(getTestLocation().pathname).toBe("/next");
    expect(screen.getByText("z historią")).toBeInTheDocument();
  });

  it("keeps the other params and the scroll position on a functional search-param update", () => {
    renderWithRoute(<SearchPage />, { url: "/muzyczne-skrzaty?edit=1" });

    fireEvent.click(screen.getByRole("button", { name: "brak" }));

    expect(getTestLocation()).toEqual({ pathname: "/muzyczne-skrzaty", search: "?edit=1&tab=layout" });
    expect(getTestRouter().calls.at(-1)).toEqual({
      method: "replace",
      url: "/muzyczne-skrzaty?edit=1&tab=layout",
      scroll: false,
    });
    expect(screen.getByRole("button", { name: "layout" })).toBeInTheDocument();
  });

  it("holds back a link click until the guard proceeds", () => {
    renderWithRoute(<GuardedPage />, {
      url: "/editor",
      pattern: "/editor",
      routes: { "/other": <p>Druga strona</p> },
    });

    fireEvent.click(screen.getByRole("link", { name: "Inna strona" }));

    expect(getTestLocation().pathname).toBe("/editor");
    expect(screen.getByText("blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));

    expect(getTestLocation().pathname).toBe("/other");
    expect(screen.getByText("Druga strona")).toBeInTheDocument();
  });

  it("holds back a programmatic navigation and stays on reset", () => {
    renderWithRoute(<GuardedPage />, {
      url: "/editor?tab=photos",
      pattern: "/editor",
      routes: { "/other": <p>Druga strona</p> },
    });

    act(() => getTestRouter().navigate("/editor?tab=layout"));
    expect(getTestLocation().search).toBe("?tab=layout");
    expect(screen.getByText("unblocked")).toBeInTheDocument();

    act(() => getTestRouter().navigate("/other"));
    expect(screen.getByText("blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zostań" }));

    expect(getTestLocation().pathname).toBe("/editor");
    expect(screen.getByText("unblocked")).toBeInTheDocument();
    expect(getTestRouter().calls.map((call) => call.url)).toEqual(["/editor?tab=layout"]);
  });

  it("puts the guarded URL back on a blocked history step and steps back on proceed", () => {
    window.history.replaceState(null, "", "/editor");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    renderWithRoute(<GuardedPage />, { url: "/editor", pattern: "/editor" });

    act(() => {
      window.history.replaceState(null, "", "/previous");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(window.location.pathname).toBe("/editor");
    expect(screen.getByText("blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));

    expect(back).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/home", "/"],
    ["/", "/"],
    ["/homes", "/homes"],
    ["/home/x", "/home/x"],
  ])("normalizes %s to %s", (pathname, expected) => {
    expect(normalizeAppPath(pathname)).toBe(expected);
  });

  it("matches route patterns with params and a splat", () => {
    expect(matchPath("/messages/:conversationId", "/messages/c-1")).toEqual({ params: { conversationId: "c-1" } });
    expect(matchPath("/messages/:conversationId", "/messages")).toBeNull();
    expect(matchPath("/search", "/search/")).toEqual({ params: {} });
    expect(matchPath("/admin/plugins/:pluginId/*", "/admin/plugins/p-1/a/b")).toEqual({
      params: { pluginId: "p-1", "*": "a/b" },
    });
    expect(matchPath("/admin/plugins/:pluginId/*", "/admin/plugins/p-1")).toEqual({
      params: { pluginId: "p-1", "*": "" },
    });
    expect(matchPath("/a/:id", "/b/1")).toBeNull();
  });
});
