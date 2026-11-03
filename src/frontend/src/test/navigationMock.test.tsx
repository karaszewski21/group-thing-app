import { act, renderHook } from "@testing-library/react";
import { notFound, redirect, useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { getMockRouterCalls, getMockUrl, NotFoundSentinel, RedirectSentinel, resetMockNavigation } from "./navigationMock";

function useUrl() {
  return { router: useRouter(), pathname: usePathname(), search: useSearchParams().toString() };
}

describe("next/navigation mock", () => {
  it("updates the URL on push, replace and back and records each call", () => {
    resetMockNavigation("/start?a=1");
    const { result } = renderHook(useUrl);

    act(() => result.current.router.push("/next?tab=x", { scroll: false }));
    expect(result.current).toMatchObject({ pathname: "/next", search: "tab=x" });
    expect(window.location.pathname).toBe("/next");

    act(() => result.current.router.replace("/other"));
    act(() => result.current.router.back());

    expect(getMockUrl()).toEqual({ pathname: "/start", search: "?a=1", hash: "" });
    expect(result.current.pathname).toBe("/start");
    expect(getMockRouterCalls()).toEqual([
      { method: "push", href: "/next?tab=x", scroll: false },
      { method: "replace", href: "/other", scroll: true },
      { method: "back", href: null, scroll: true },
    ]);
  });

  it("derives useParams from the most specific matching pattern, a splat as an array", () => {
    resetMockNavigation("/admin/plugins/p-1/a/b", ["*", "/admin/plugins/:pluginId/*", "/admin/plugins/new"]);
    const { result } = renderHook(useParams);

    expect(result.current).toEqual({ pluginId: "p-1", "*": ["a", "b"] });

    act(() => resetMockNavigation("/ania/event/e-1", ["/:slug/event/:eventId", "*"]));
    expect(renderHook(useParams).result.current).toEqual({ slug: "ania", eventId: "e-1" });
  });

  it("throws sentinels from redirect and notFound", () => {
    expect(() => redirect("/login")).toThrow(RedirectSentinel);
    expect(() => notFound()).toThrow(NotFoundSentinel);
  });

  it("keeps working after vi.resetAllMocks()", () => {
    vi.resetAllMocks();
    resetMockNavigation("/a");
    const { result } = renderHook(useUrl);

    act(() => result.current.router.push("/b"));

    expect(result.current.pathname).toBe("/b");
    expect(getMockRouterCalls()).toHaveLength(1);
  });
});
