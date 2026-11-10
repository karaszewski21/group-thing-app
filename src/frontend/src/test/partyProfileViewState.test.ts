import { describe, expect, it } from "vitest";
import type { PartyProfileResponse } from "../api/ownerItems";
import {
  PARTY_PROFILE_LOAD_ERROR,
  resolvePartyProfileView,
  type PartyProfileView,
} from "../features/profile-public/partyProfileViewState";

function profile(slug: string | null = null): PartyProfileResponse {
  return {
    owner: { party_id: "party-1", display_name: "Ania Kowalska", slug },
    bio: null,
    avatar_url: null,
    nearest: null,
    counts: { GIFT: 0, SWAP: 0 },
    recent_items: [],
    is_me: false,
  };
}

type Input = Parameters<typeof resolvePartyProfileView>[0];

const BASE: Input = { data: null, loading: false, notFound: false, error: null };
const person = profile();

describe("resolvePartyProfileView", () => {
  it.each<{ name: string; input: Partial<Input>; expected: PartyProfileView }>([
    { name: "first read pending", input: { loading: true }, expected: { kind: "loading" } },
    { name: "404 wins over data", input: { notFound: true, data: person }, expected: { kind: "notFound" } },
    {
      name: "Organization owner redirected to its slug",
      input: { data: profile("akademia-orlik") },
      expected: { kind: "redirect", to: "/akademia-orlik" },
    },
    { name: "loaded profile", input: { data: person }, expected: { kind: "content", profile: person } },
    {
      name: "failed refresh keeps the profile",
      input: { data: person, error: "Błąd serwera" },
      expected: { kind: "content", profile: person },
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
