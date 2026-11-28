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
    const location = stubLocation("/org/group/5/term/7", "?tab=rzeczy");

    await expect(api.get("/public/groups/5/access")).rejects.toBeInstanceOf(ApiError);

    expect(location.href).toBe(`/login?returnTo=${encodeURIComponent("/org/group/5/term/7?tab=rzeczy")}`);
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("request_unauthorizedOnLoginPage_doesNotRedirect", async () => {
    const location = stubLocation("/login", "?returnTo=%2Fpanel");

    await expect(api.post("/auth/login", {})).rejects.toBeInstanceOf(ApiError);

    expect(location.href).toBe("/login?returnTo=%2Fpanel");
  });

  it("request_unauthorizedWithoutToken_doesNotRedirect", async () => {
    localStorage.clear();
    const location = stubLocation("/", "");

    await expect(api.get("/notifications/mine")).rejects.toBeInstanceOf(ApiError);

    expect(location.href).toBe("/");
  });
});

describe("api client empty success replies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("request_emptyAccepted_resolvesUndefinedWithoutParsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202, statusText: "Accepted" })));

    await expect(api.post("/auth/password-reset", { email: "ania@example.pl" })).resolves.toBeUndefined();
  });

  it("request_acceptedWithJsonBody_parsesIt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ queued: 1 }), { status: 202 })));

    await expect(api.post("/x", {})).resolves.toEqual({ queued: 1 });
  });

  it("request_emptyOkBody_resolvesUndefined", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));

    await expect(api.put("/x", {})).resolves.toBeUndefined();
  });

  it("request_jsonBody_parsesIt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));

    await expect(api.get("/x")).resolves.toEqual({ ok: true });
  });
});
