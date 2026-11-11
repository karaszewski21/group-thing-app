import { describe, expect, it } from "vitest";
import type { PartyProfileResponse } from "../api/ownerItems";
import {
  PARTY_PROFILE_LOAD_ERROR,
  resolvePartyProfileView,
  type PartyProfileView,
} from "../features/profile-public/partyProfileViewState";

function profile(slug: string | null = null): PartyProfileResponse {
  return {
    owner: { party_id: "party-1", display_name: "Ania Kowalska", slug: null },
    organization: slug ? { name: "Akademia Orlik", slug } : null,
    bio: null,
    page_layout: "BANNER",
    palette_preset: null,
    primary_color: null,
    accent_color: null,
    logo: null,
    avatar: null,
    cover: null,
    gallery: [],
    nearest: null,
    counts: { GIFT: 0, SWAP: 0 },
    recent_items: [],
    is_me: false,
  };
}

type Input = Parameters<typeof resolvePartyProfileView>[0];

const BASE: Input = { data: null, loading: false, notFound: false, error: null };
const person = profile();
const owner = profile("akademia-orlik");
const active: PartyProfileResponse = {
  ...person,
  counts: { GIFT: 0, SWAP: 2 },
  nearest: {
    kind: "TERM",
    id: "t-1",
    name: "Wymianka",
    starts_at: "2026-11-20T17:00:00",
    location_name: null,
    attendee_count: 0,
    path: "/x/group/g/term/t",
  },
};

describe("resolvePartyProfileView", () => {
  it.each<{ name: string; input: Partial<Input>; expected: PartyProfileView }>([
    { name: "first read pending", input: { loading: true }, expected: { kind: "loading" } },
    { name: "404 wins over data", input: { notFound: true, data: person }, expected: { kind: "notFound" } },
    {
      name: "Organization owner keeps their profile",
      input: { data: owner },
      expected: { kind: "content", profile: owner, hasTerms: false, hasItems: false },
    },
    {
      name: "loaded profile with nothing yet",
      input: { data: person },
      expected: { kind: "content", profile: person, hasTerms: false, hasItems: false },
    },
    {
      name: "loaded profile with a term and items",
      input: { data: active },
      expected: { kind: "content", profile: active, hasTerms: true, hasItems: true },
    },
    {
      name: "failed refresh keeps the profile",
      input: { data: person, error: "Błąd serwera" },
      expected: { kind: "content", profile: person, hasTerms: false, hasItems: false },
    },
    {
      name: "failed first read",
      input: { error: "Błąd serwera" },
      expected: { kind: "error", message: PARTY_PROFILE_LOAD_ERROR },
    },
    { name: "nothing to show", input: {}, expected: { kind: "notFound" } },
  ])("$name", ({ input, expected }) => {
    expect(resolvePartyProfileView({ ...BASE, ...input })).toEqual(expected);
  });
});
