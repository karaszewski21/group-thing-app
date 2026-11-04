import type { ItemLocationResponse } from "../../api/itemActions";
import type { LocalitySearchResult } from "../../api/localities";
import type {
  Locality,
  LocationRefResponse,
  LocationResponse,
  PublicLocationResponse,
} from "../../api/locations";

/** Typed location fixtures shared by the frontend tests. The defaults
 * describe one address-less place in Kęty; pass overrides for the rest. */

export function makeLocality(overrides: Partial<Locality> = {}): Locality {
  return {
    id: "0937730",
    name: "Kęty",
    kind: "TOWN",
    gmina: "Kęty",
    powiat: "oświęcimski",
    voivodeship: "małopolskie",
    ...overrides,
  };
}

export function makeLocalitySearchResult(overrides: Partial<LocalitySearchResult> = {}): LocalitySearchResult {
  return { ...makeLocality(), postal_code: null, ...overrides };
}

export function makeLocationResponse(overrides: Partial<LocationResponse> = {}): LocationResponse {
  return {
    id: "loc-1",
    owner_party_id: "party-1",
    locality: makeLocality(),
    label: "Kęty, małopolskie",
    formatted_address: null,
    google_place_id: null,
    lat: null,
    lng: null,
    source: null,
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-01T10:00:00",
    deleted_at: null,
    ...overrides,
  };
}

export function makeLocationRef(overrides: Partial<LocationRefResponse> = {}): LocationRefResponse {
  return {
    id: "loc-1",
    locality: makeLocality(),
    label: "Kęty, małopolskie",
    formatted_address: null,
    google_place_id: null,
    deleted_at: null,
    ...overrides,
  };
}

export function makePublicLocation(overrides: Partial<PublicLocationResponse> = {}): PublicLocationResponse {
  return {
    locality: makeLocality(),
    label: "Kęty, małopolskie",
    formatted_address: null,
    google_place_id: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

/** The non-owner shape by default: locality only, the other keys `null`. */
export function makeItemLocation(overrides: Partial<ItemLocationResponse> = {}): ItemLocationResponse {
  return {
    locality: makeLocality(),
    formatted_address: null,
    deleted_at: null,
    ...overrides,
  };
}
