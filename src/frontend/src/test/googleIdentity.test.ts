import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GoogleIdentityModule = typeof import("../lib/googleIdentity");

const SCRIPT_SELECTOR = "script#google-identity-services";

function fakeIdApi() {
  return { initialize: vi.fn(), renderButton: vi.fn() };
}

/** Fresh module per test so the loader's memo never leaks between tests. */
async function loadModule(): Promise<GoogleIdentityModule> {
  vi.resetModules();
  return import("../lib/googleIdentity");
}

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>(SCRIPT_SELECTOR));
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  injectedScripts().forEach((script) => script.remove());
});

describe("googleIdentity loader", () => {
  it("resolves null without a client ID, injects nothing and reads the env at call time", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    const gis = await loadModule();

    expect(gis.isGoogleLoginConfigured()).toBe(false);
    await expect(gis.loadGoogleIdentity()).resolves.toBeNull();
    expect(injectedScripts()).toHaveLength(0);

    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
    expect(gis.isGoogleLoginConfigured()).toBe(true);
  });

  it("injects exactly one async script and memoizes the loaded API", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
    const gis = await loadModule();
    const id = fakeIdApi();

    const first = gis.loadGoogleIdentity();
    const second = gis.loadGoogleIdentity();
    const [script] = injectedScripts();
    expect(injectedScripts()).toHaveLength(1);
    expect(script.src).toBe("https://accounts.google.com/gsi/client");
    expect(script.async).toBe(true);

    vi.stubGlobal("google", { accounts: { id } });
    script.dispatchEvent(new Event("load"));

    await expect(first).resolves.toBe(id);
    expect(second).toBe(first);
    await expect(gis.loadGoogleIdentity()).resolves.toBe(id);
    expect(injectedScripts()).toHaveLength(1);
  });

  it("forgets a script error and a timeout so the next call loads again", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
    vi.useFakeTimers();
    const gis = await loadModule();

    const failed = gis.loadGoogleIdentity();
    injectedScripts()[0].dispatchEvent(new Event("error"));
    await expect(failed).resolves.toBeNull();
    expect(injectedScripts()).toHaveLength(0);

    const timedOut = gis.loadGoogleIdentity();
    expect(injectedScripts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(timedOut).resolves.toBeNull();

    const id = fakeIdApi();
    const retry = gis.loadGoogleIdentity();
    expect(retry).not.toBe(timedOut);
    vi.stubGlobal("google", { accounts: { id } });
    injectedScripts()[0].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(id);
  });

  it("reuses a still-pending tag and replaces a stale loaded one", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
    vi.useFakeTimers();
    const gis = await loadModule();

    const timedOut = gis.loadGoogleIdentity();
    const [pending] = injectedScripts();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(timedOut).resolves.toBeNull();

    const addListener = vi.spyOn(pending, "addEventListener");
    const reusing = gis.loadGoogleIdentity();
    expect(injectedScripts()).toEqual([pending]);
    expect(addListener).not.toHaveBeenCalled();
    pending.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(reusing).resolves.toBeNull();
    expect(injectedScripts()).toEqual([pending]);

    const id = fakeIdApi();
    const replacing = gis.loadGoogleIdentity();
    const [fresh] = injectedScripts();
    expect(fresh).not.toBe(pending);
    expect(injectedScripts()).toHaveLength(1);
    vi.stubGlobal("google", { accounts: { id } });
    fresh.dispatchEvent(new Event("load"));
    await expect(replacing).resolves.toBe(id);
  });
});
