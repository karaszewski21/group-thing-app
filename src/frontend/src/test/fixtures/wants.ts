import type { WantMatchResponse, WantResponse, WantSuggestionResponse } from "../../api/wants";

/** Typed want fixtures shared by the frontend tests. The default want is
 * active, has no filters and no matches; pass overrides for the rest. */

export function makeWant(overrides: Partial<WantResponse> = {}): WantResponse {
  return {
    id: "want-1",
    name: "Rowerek biegowy",
    note: null,
    category_id: null,
    category_name: null,
    category_path: null,
    offer_mode: null,
    locality_id: null,
    locality_name: null,
    radius_km: null,
    notifications_enabled: true,
    status: "ACTIVE",
    expires_at: "2027-02-13T10:00:00",
    closed_at: null,
    created_at: "2026-11-15T10:00:00",
    matching: false,
    match_count: 0,
    new_match_count: 0,
    ...overrides,
  };
}

export function makeWantMatch(overrides: Partial<WantMatchResponse> = {}): WantMatchResponse {
  return {
    id: "item-1",
    title: "Rowerek biegowy Puky",
    href: "/ania/product/item-1",
    meta: { mode: "GIFT", condition: "GOOD", thumb_url: null, reserved: false, reserved_until: null },
    is_new: false,
    reserved_by_me: false,
    proposed_by_me: false,
    ...overrides,
  };
}

export function makeWantSuggestion(overrides: Partial<WantSuggestionResponse> = {}): WantSuggestionResponse {
  return {
    id: "item-7",
    title: "Traktor bruder Deutz",
    href: "/ania/product/item-7",
    meta: { mode: "SWAP", condition: "GOOD", thumb_url: null, reserved: false, reserved_until: null },
    missing_words: ["Claas"],
    reserved_by_me: false,
    proposed_by_me: false,
    ...overrides,
  };
}
