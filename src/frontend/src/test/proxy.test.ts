import { describe, expect, it } from "vitest";
import { config, resolveProxy, type ProxyRequest } from "../proxy";

const BACKEND = "http://backend.test:8080";

function request(overrides: Partial<ProxyRequest>): ProxyRequest {
  return { method: "GET", pathname: "/", search: "", hasSession: false, ...overrides };
}

describe("proxy", () => {
  it("redirects a direct /home visit to / keeping the search", () => {
    expect(resolveProxy(request({ pathname: "/home", search: "?tab=1", hasSession: true }), BACKEND)).toEqual({
      kind: "redirect",
      location: "/?tab=1",
    });
  });

  it("rewrites / to /home for a cookie holder and lets anonymous / through", () => {
    expect(resolveProxy(request({ search: "?x=1", hasSession: true }), BACKEND)).toEqual({
      kind: "rewrite",
      destination: "/home?x=1",
    });
    expect(resolveProxy(request({}), BACKEND)).toEqual({ kind: "next" });
  });

  it("rewrites POST /oauth2/authorize to the backend, while the GET page is only gated", () => {
    const post = request({ method: "POST", pathname: "/oauth2/authorize", search: "?client_id=c" });
    expect(resolveProxy(post, BACKEND)).toEqual({
      kind: "rewrite",
      destination: `${BACKEND}/oauth2/authorize?client_id=c`,
    });
    expect(
      resolveProxy(request({ pathname: "/oauth2/authorize", search: "?client_id=c", hasSession: true }), BACKEND),
    ).toEqual({ kind: "next" });
  });

  it("redirects a gated prefix without a cookie to /login with the authPath returnTo", () => {
    expect(resolveProxy(request({ pathname: "/meetings", search: "?a=b" }), BACKEND)).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2Fmeetings%3Fa%3Db",
    });
    expect(resolveProxy(request({ pathname: "/meetings", hasSession: true }), BACKEND)).toEqual({ kind: "next" });
  });

  it("leaves /add public and gates /add/product", () => {
    expect(resolveProxy(request({ pathname: "/add" }), BACKEND)).toEqual({ kind: "next" });
    expect(resolveProxy(request({ pathname: "/add/product" }), BACKEND)).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2Fadd%2Fproduct",
    });
  });

  it.each(["/groupsx", "/login", "/product/123", "/some-org", "/some-org/event/1"])(
    "does not gate %s",
    (pathname) => {
      expect(resolveProxy(request({ pathname }), BACKEND)).toEqual({ kind: "next" });
    },
  );

  it("gates nested paths of a prefix on a segment boundary", () => {
    expect(resolveProxy(request({ pathname: "/groups/42/members" }), BACKEND)).toEqual({
      kind: "redirect",
      location: "/login?returnTo=%2Fgroups%2F42%2Fmembers",
    });
  });

  it("matcher skips the backend, Next internals and static files", () => {
    const matcher = new RegExp(`^${config.matcher}$`);
    for (const skipped of [
      "/api/items",
      "/_next/static/chunk.js",
      "/assets/plugin-sdk.js",
      "/.well-known/openid-configuration",
      "/favicon.svg",
      "/icons.svg",
    ]) {
      expect(matcher.test(skipped), skipped).toBe(false);
    }
    for (const matched of ["/", "/home", "/meetings", "/oauth2/authorize", "/apiary"]) {
      expect(matcher.test(matched), matched).toBe(true);
    }
  });
});
