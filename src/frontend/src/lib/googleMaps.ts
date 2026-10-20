/// <reference types="google.maps" />

/**
 * Loader and thin wrapper for Places API (New) through the Maps JavaScript
 * API `places` library. The legacy `AutocompleteService`/`PlacesService`
 * must not be used: new Cloud projects no longer get them.
 *
 * Nothing loads at import time. The picker calls `loadPlaces()` on the first
 * focus or keystroke in its search input, so manual mode costs no request.
 */

const SCRIPT_URL = "https://maps.googleapis.com/maps/api/js";
const LOAD_TIMEOUT_MS = 10_000;

export interface PlacesApi {
  AutocompleteSuggestion: typeof google.maps.places.AutocompleteSuggestion;
  AutocompleteSessionToken: typeof google.maps.places.AutocompleteSessionToken;
  Place: typeof google.maps.places.Place;
}

export type SessionToken = google.maps.places.AutocompleteSessionToken;

export interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
  raw: google.maps.places.AutocompleteSuggestion;
}

export interface ResolvedPlace {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}

/** Reads the env on every call (never cached) so tests can flip modes with `vi.stubEnv`. */
export function isGoogleMapsConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

let placesPromise: Promise<PlacesApi | null> | null = null;

/** Memoized; resolves `null` without a key, on a script error or after 10 s,
 * and forgets a failed attempt so the next call can retry. */
export function loadPlaces(): Promise<PlacesApi | null> {
  if (!placesPromise) {
    placesPromise = importPlaces().then((api) => {
      if (!api) placesPromise = null;
      return api;
    });
  }
  return placesPromise;
}

async function importPlaces(): Promise<PlacesApi | null> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([importPlacesLibrary(key), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function importPlacesLibrary(key: string): Promise<PlacesApi> {
  if (typeof google === "undefined" || !google.maps?.importLibrary) {
    await injectScript(key);
  }
  const places = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  return {
    AutocompleteSuggestion: places.AutocompleteSuggestion,
    AutocompleteSessionToken: places.AutocompleteSessionToken,
    Place: places.Place,
  };
}

function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `${SCRIPT_URL}?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Google Maps script failed to load"));
    });
    document.head.appendChild(script);
  });
}

export function newSessionToken(api: PlacesApi): SessionToken {
  return new api.AutocompleteSessionToken();
}

export async function suggest(api: PlacesApi, input: string, token: SessionToken): Promise<Suggestion[]> {
  if (!input.trim()) return [];
  const { suggestions } = await api.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: token,
    language: "pl",
    region: "pl",
  });
  return suggestions.flatMap((raw) => {
    const prediction = raw.placePrediction;
    if (!prediction) return [];
    return [
      {
        placeId: prediction.placeId,
        mainText: prediction.mainText?.text ?? "",
        secondaryText: prediction.secondaryText?.text ?? "",
        raw,
      },
    ];
  });
}

/** Fetches the picked place's details. `fetchFields` takes no session token:
 * Google attaches the one passed to `suggest` automatically, which ends that
 * billing session, so the caller must start a new token afterwards. */
export async function resolve(suggestion: Suggestion): Promise<ResolvedPlace> {
  const prediction = suggestion.raw.placePrediction;
  if (!prediction) throw new Error("Suggestion has no place prediction");
  const { place } = await prediction.toPlace().fetchFields({
    fields: ["id", "formattedAddress", "location", "displayName"],
  });
  if (!place.location) throw new Error("Place has no location");
  return {
    placeId: place.id,
    name: place.displayName ?? suggestion.mainText,
    formattedAddress: place.formattedAddress ?? suggestion.secondaryText,
    lat: place.location.lat(),
    lng: place.location.lng(),
  };
}

export function buildMapsUrl({
  formatted_address,
  google_place_id,
}: {
  formatted_address: string;
  google_place_id: string | null;
}): string {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatted_address)}`;
  return google_place_id ? `${url}&query_place_id=${encodeURIComponent(google_place_id)}` : url;
}
