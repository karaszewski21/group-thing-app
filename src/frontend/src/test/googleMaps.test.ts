import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GoogleMapsModule = typeof import("../lib/googleMaps");

const SCRIPT_SELECTOR = 'script[src^="https://maps.googleapis.com/maps/api/js"]';

function makeFakePlaces() {
  const fakePlace = {
    id: "ChIJ-test",
    displayName: "Świetlica Osiedlowa",
    formattedAddress: "Polna 12, 60-595 Poznań",
    location: { lat: () => 52.4064, lng: () => 16.9252 },
    fetchFields: vi.fn(async () => ({ place: fakePlace })),
  };
  const fakePlaces = {
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions: vi.fn(async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ-test",
              mainText: { text: "Świetlica Osiedlowa" },
              secondaryText: { text: "Polna 12, Poznań" },
              toPlace: () => fakePlace,
            },
          },
        ],
      })),
    },
    Place: class {},
  };
  return { fakePlace, fakePlaces };
}

/** Fresh module per test so `loadPlaces`' memo never leaks between tests. */
async function loadModule(): Promise<GoogleMapsModule> {
  vi.resetModules();
  return import("../lib/googleMaps");
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
  injectedScripts().forEach((script) => script.remove());
});

describe("googleMaps loader", () => {
  it("resolves null without a key, injects nothing and reads the env at call time", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const maps = await loadModule();

    expect(maps.isGoogleMapsConfigured()).toBe(false);
    await expect(maps.loadPlaces()).resolves.toBeNull();
    expect(injectedScripts()).toHaveLength(0);

    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    expect(maps.isGoogleMapsConfigured()).toBe(true);
  });

  it("resolves null when the script fails to load and retries with a new script", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    const maps = await loadModule();

    const pending = maps.loadPlaces();
    const [script] = injectedScripts();
    expect(script.async).toBe(true);
    const src = new URL(script.src);
    expect(src.searchParams.get("key")).toBe("test-key");
    expect(src.searchParams.get("v")).toBe("weekly");
    expect(src.searchParams.get("loading")).toBe("async");

    script.dispatchEvent(new Event("error"));
    await expect(pending).resolves.toBeNull();
    expect(injectedScripts()).toHaveLength(0);

    void maps.loadPlaces();
    expect(injectedScripts()).toHaveLength(1);
  });

  it("imports the places library once across calls", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    const { fakePlaces } = makeFakePlaces();
    const importLibrary = vi.fn(async (name: string) => (name === "places" ? fakePlaces : {}));
    const maps = await loadModule();

    const first = maps.loadPlaces();
    const second = maps.loadPlaces();
    vi.stubGlobal("google", { maps: { importLibrary } });
    injectedScripts()[0].dispatchEvent(new Event("load"));

    const api = await first;
    expect(await second).toBe(api);
    expect(await maps.loadPlaces()).toBe(api);
    expect(api?.AutocompleteSuggestion).toBe(fakePlaces.AutocompleteSuggestion);
    expect(importLibrary).toHaveBeenCalledTimes(1);
    expect(importLibrary).toHaveBeenCalledWith("places");
    expect(injectedScripts()).toHaveLength(1);
  });
});

describe("googleMaps places wrapper", () => {
  it("returns no suggestions for blank input without calling Google, and maps real ones", async () => {
    const { fakePlaces } = makeFakePlaces();
    const maps = await loadModule();
    const api = fakePlaces as unknown as NonNullable<Awaited<ReturnType<GoogleMapsModule["loadPlaces"]>>>;
    const token = maps.newSessionToken(api);

    await expect(maps.suggest(api, "  ", token)).resolves.toEqual([]);
    expect(fakePlaces.AutocompleteSuggestion.fetchAutocompleteSuggestions).not.toHaveBeenCalled();

    const suggestions = await maps.suggest(api, "Świetlica", token);
    expect(fakePlaces.AutocompleteSuggestion.fetchAutocompleteSuggestions).toHaveBeenCalledWith({
      input: "Świetlica",
      sessionToken: token,
      language: "pl",
      region: "pl",
    });
    expect(suggestions).toEqual([
      expect.objectContaining({
        placeId: "ChIJ-test",
        mainText: "Świetlica Osiedlowa",
        secondaryText: "Polna 12, Poznań",
      }),
    ]);
  });

  it("resolves a picked suggestion and a fresh token is used for the next search", async () => {
    const { fakePlace, fakePlaces } = makeFakePlaces();
    const maps = await loadModule();
    const api = fakePlaces as unknown as NonNullable<Awaited<ReturnType<GoogleMapsModule["loadPlaces"]>>>;
    const token = maps.newSessionToken(api);
    const [suggestion] = await maps.suggest(api, "Świetlica", token);

    await expect(maps.resolve(suggestion)).resolves.toEqual({
      placeId: "ChIJ-test",
      name: "Świetlica Osiedlowa",
      formattedAddress: "Polna 12, 60-595 Poznań",
      lat: 52.4064,
      lng: 16.9252,
    });
    expect(fakePlace.fetchFields).toHaveBeenCalledWith({
      fields: ["id", "formattedAddress", "location", "displayName"],
    });

    const next = maps.newSessionToken(api);
    expect(next).toBeInstanceOf(fakePlaces.AutocompleteSessionToken);
    expect(next).not.toBe(token);
  });
});
