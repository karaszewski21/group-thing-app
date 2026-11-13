// @vitest-environment node
import { getRedirectUrl, getRewrittenUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../proxy";

const ORIGIN = "http://app.test";

function request(path: string, { method = "GET", cookie }: { method?: string; cookie?: string } = {}): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { method, headers: cookie === undefined ? {} : { cookie } });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy under Next", () => {
  it.each([
    ["/api/items", false],
    ["/api/items/i-1/photos", false],
    ["/_next/static/chunks/main.js", false],
    ["/_next/image", false],
    ["/assets/plugin-sdk.js", false],
    ["/.well-known/openid-configuration", false],
    ["/favicon.ico", false],
    ["/icons.svg", false],
    ["/", true],
    ["/home", true],
    ["/meetings?tab=past", true],
    ["/oauth2/authorize", true],
    ["/zielony-krag/event/ev-1", true],
  ])("Next's matcher runs the proxy on %s: %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });

  it("reads the cookie, rewrites and redirects on the request origin and posts the consent form to the backend", () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://backend.test:8080");

    expect(getRewrittenUrl(proxy(request("/?x=1", { cookie: "auth_token=abc" })))).toBe(`${ORIGIN}/home?x=1`);
    expect(getRewrittenUrl(proxy(request("/", { cookie: "auth_token=" })))).toBeNull();
    expect(getRedirectUrl(proxy(request("/messages", { cookie: "other=1" })))).toBe(
      `${ORIGIN}/login?returnTo=%2Fmessages`,
    );
    expect(getRewrittenUrl(proxy(request("/oauth2/authorize?client_id=c", { method: "POST" })))).toBe(
      "http://backend.test:8080/oauth2/authorize?client_id=c",
    );
  });
});
