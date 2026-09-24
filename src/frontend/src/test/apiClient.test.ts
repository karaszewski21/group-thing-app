import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";

function unauthorized(): Response {
  return new Response(JSON.stringify({ status: 401 }), { status: 401, statusText: "Unauthorized" });
}

function stubLocation(pathname: string, search: string) {
  const location = { pathname, search, href: `${pathname}${search}` };
  vi.stubGlobal("location", location);
  return location;
}

describe("api client 401 handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized()));
    localStorage.setItem("auth_token", "expired");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("request_unauthorized_redirectsToLoginWithEncodedReturnTo", async () => {
    const location = stubLocation("/org/grupa/5/term/7", "?tab=rzeczy");

    await expect(api.get("/groups/public/5/access")).rejects.toBeInstanceOf(ApiError);

    expect(location.href).toBe(`/login?returnTo=${encodeURIComponent("/org/grupa/5/term/7?tab=rzeczy")}`);
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("request_unauthorizedOnLoginPage_doesNotRedirect", async () => {
    const location = stubLocation("/login", "?returnTo=%2Fpanel");

    await expect(api.post("/auth/login", {})).rejects.toBeInstanceOf(ApiError);

    expect(location.href).toBe("/login?returnTo=%2Fpanel");
  });
});
