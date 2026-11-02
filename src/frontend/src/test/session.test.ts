import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { clearSession, reconcileSession, setSession } from "../auth/session";

const NOW_SECONDS = 1_800_000_000;

function fakeJwt(sub: string, exp: number): string {
  const payload = btoa(JSON.stringify({ sub, permissions: [], exp }));
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

function cookieToken(): string | null {
  const entry = document.cookie.split("; ").find((part) => part.startsWith("auth_token="));
  return entry ? decodeURIComponent(entry.slice("auth_token=".length)) : null;
}

function writeRawCookie(value: string): void {
  document.cookie = `auth_token=${encodeURIComponent(value)}; Path=/`;
}

/** Spies on cookie writes; the returned function gives the last one. */
function watchCookieWrites(): () => string | undefined {
  const setter = vi.spyOn(document, "cookie", "set");
  return () => setter.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_SECONDS * 1000);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("auth session", () => {
  it("setSession writes localStorage and the auth_token cookie together", () => {
    const jwt = fakeJwt("anna", NOW_SECONDS + 3600);
    setSession(jwt);

    expect(localStorage.getItem("auth_token")).toBe(jwt);
    expect(cookieToken()).toBe(jwt);
  });

  it("derives the cookie Max-Age from the JWT exp, Lax and Path=/ without Secure on http", () => {
    const lastWrite = watchCookieWrites();
    setSession(fakeJwt("anna", NOW_SECONDS + 3600));

    expect(lastWrite()).toMatch(/; Path=\/; SameSite=Lax; Max-Age=3600$/);
  });

  it("adds Secure on https", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    const lastWrite = watchCookieWrites();
    setSession(fakeJwt("anna", NOW_SECONDS + 60));

    expect(lastWrite()).toMatch(/; SameSite=Lax; Max-Age=60; Secure$/);
  });

  it("clearSession clears localStorage and the cookie", () => {
    setSession(fakeJwt("anna", NOW_SECONDS + 3600));
    clearSession();

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(cookieToken()).toBeNull();
  });

  const valid = fakeJwt("stored", NOW_SECONDS + 3600);
  const validCookie = fakeJwt("cookie", NOW_SECONDS + 3600);
  const expired = fakeJwt("old", NOW_SECONDS - 10);

  it.each([
    ["valid localStorage wins over the cookie", valid, validCookie, valid],
    ["cookie-only token is copied to localStorage", null, validCookie, validCookie],
    ["expired localStorage falls back to a valid cookie", expired, validCookie, validCookie],
    ["both invalid are cleared", expired, expired, null],
  ])("reconciliation: %s", (_label, stored, cookie, expected) => {
    if (stored) localStorage.setItem("auth_token", stored);
    if (cookie) writeRawCookie(cookie);

    expect(reconcileSession()).toBe(expected);
    expect(localStorage.getItem("auth_token")).toBe(expected);
    expect(cookieToken()).toBe(expected);
  });

  it("a 401 from the API client clears both", async () => {
    vi.stubGlobal("location", { protocol: "http:", pathname: "/login", search: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 401, statusText: "Unauthorized" }))),
    );
    setSession(fakeJwt("anna", NOW_SECONDS + 3600));

    await expect(api.get("/people/me")).rejects.toMatchObject({ status: 401 });

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(cookieToken()).toBeNull();
  });
});
