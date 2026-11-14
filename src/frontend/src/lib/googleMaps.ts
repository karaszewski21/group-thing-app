/// <reference types="google.maps" />

/**
 * Loader and thin wrapper for Places API (New) through the Maps JavaScript
 * API `places` library. The legacy `AutocompleteService`/`PlacesService`
 * must not be used: new Cloud projects no longer get them.
 *
 * Nothing loads at import time. The picker calls `loadPlaces()` on the first
 * focus or keystroke in its search input, so manual mode costs no request;
 * `loadMaps()` (map, marker, geocoder) loads only once the form shows a map.
 * The item page's map is a keyed Maps Embed API iframe (`buildMapsEmbedUrl`).
 */

const SCRIPT_URL = "https://maps.googleapis.com/maps/api/js";
const SCRIPT_ID = "google-maps-js";
const LOAD_TIMEOUT_MS = 10_000;
const READY_CALLBACK = "__googleMapsReady";

export interface PlacesApi {
  AutocompleteSuggestion: typeof google.maps.places.AutocompleteSuggestion;
  AutocompleteSessionToken: typeof google.maps.places.AutocompleteSessionToken;
  Place: typeof google.maps.places.Place;
}

export interface MapsApi {
  Map: typeof google.maps.Map;
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement;
  geocoder: google.maps.Geocoder;
}

export interface LatLng {
  lat: number;
  lng: number;
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
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
}

let placesPromise: Promise<PlacesApi | null> | null = null;
let mapsPromise: Promise<MapsApi | null> | null = null;

/** Memoized; resolves `null` without a key, on a script error or after 10 s,
 * and forgets a failed attempt so the next call can retry. */
export function loadPlaces(): Promise<PlacesApi | null> {
  if (!placesPromise) {
    placesPromise = importWithTimeout(importPlacesLibrary).then((api) => {
      if (!api) placesPromise = null;
      return api;
    });
  }
  return placesPromise;
}

/** The interactive map of the place form, loaded like `loadPlaces()`. */
export function loadMaps(): Promise<MapsApi | null> {
  if (!mapsPromise) {
    mapsPromise = importWithTimeout(importMapsLibraries).then((api) => {
      if (!api) mapsPromise = null;
      return api;
    });
  }
  return mapsPromise;
}

async function importWithTimeout<T>(load: (key: string) => Promise<T>): Promise<T | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([load(key), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureMapsScript(key: string): Promise<void> {
  if (!importLibraryReady()) await injectScript(key);
}

async function importPlacesLibrary(key: string): Promise<PlacesApi> {
  await ensureMapsScript(key);
  const places = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  return {
    AutocompleteSuggestion: places.AutocompleteSuggestion,
    AutocompleteSessionToken: places.AutocompleteSessionToken,
    Place: places.Place,
  };
}

async function importMapsLibraries(key: string): Promise<MapsApi> {
  await ensureMapsScript(key);
  const [maps, marker, geocoding] = await Promise.all([
    google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    google.maps.importLibrary("geocoding") as Promise<google.maps.GeocodingLibrary>,
  ]);
  return {
    Map: maps.Map,
    AdvancedMarkerElement: marker.AdvancedMarkerElement,
    geocoder: new geocoding.Geocoder(),
  };
}

function importLibraryReady(): boolean {
  return typeof google !== "undefined" && Boolean(google.maps?.importLibrary);
}

/** With `loading=async` the tag's `load` event can fire before the API has
 * defined `importLibrary`, so readiness is Google's `callback` (or a `load`
 * that already finds `importLibrary`). A retry after a timeout waits on the
 * tag still loading instead of adding a second one (Google rejects a page
 * that includes the API twice). A tag that already loaded yet left no
 * `importLibrary` is stale and gets replaced. */
function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = document.getElementById(SCRIPT_ID);
    if (pending?.dataset.loaded) {
      pending.remove();
      pending = null;
    }
    const script = pending instanceof HTMLScriptElement ? pending : document.createElement("script");
    const callbacks = window as unknown as Record<string, (() => void) | undefined>;
    const earlier = callbacks[READY_CALLBACK];
    callbacks[READY_CALLBACK] = () => {
      earlier?.();
      resolve();
    };
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      if (importLibraryReady()) resolve();
    });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Google Maps script failed to load"));
    });
    if (script === pending) return;
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `${SCRIPT_URL}?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${READY_CALLBACK}`;
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

/** A Maps search link: `query` is the address, or `localityMapsQuery(...)`
 * for a place without one; `google_place_id` pins the exact place. */
export function buildMapsUrl({ query, google_place_id }: { query: string; google_place_id?: string | null }): string {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return google_place_id ? `${url}&query_place_id=${encodeURIComponent(google_place_id)}` : url;
}

/** The centre of a search such as `localityMapsQuery(...)`, or `null` when
 * Google finds nothing or geocoding is unavailable. */
export async function geocode(api: MapsApi, address: string): Promise<LatLng | null> {
  try {
    const { results } = await api.geocoder.geocode({
      address,
      language: "pl",
      region: "pl",
    });
    const location = results[0]?.geometry.location;
    return location ? { lat: location.lat(), lng: location.lng() } : null;
  } catch {
    return null;
  }
}

/** The address at a point picked on the map, kept at the picked point (not
 * snapped to the address). Throws when Google finds no address there. */
export async function reverseGeocode(api: MapsApi, position: LatLng): Promise<ResolvedPlace> {
  const { results } = await api.geocoder.geocode({
    location: position,
    language: "pl",
  });
  const result = results[0];
  if (!result) throw new Error("No address at this point");
  return {
    placeId: result.place_id,
    name: result.formatted_address,
    formattedAddress: result.formatted_address,
    lat: position.lat,
    lng: position.lng,
  };
}

/** A Maps Embed API iframe URL pinning `query`, or `null` without a key. */
export function buildMapsEmbedUrl(query: string, zoom: number): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({
    key,
    q: query,
    zoom: String(zoom),
    language: "pl",
    region: "PL",
  });
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
}
