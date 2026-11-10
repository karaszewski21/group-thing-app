import { describe, expect, it } from "vitest";
import type { EventDetailResponse } from "../api/events";
import type { PublicCircleResponse, PublicTermResponse } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import {
  eventMetadata,
  isOrganizationSlug,
  organizationMetadata,
  termMetadata,
} from "../lib/publicMetadata";
import { makeLocality, makeLocationRef } from "./fixtures/locations";

function organization(overrides: Partial<PublicOrganizationResponse> = {}): PublicOrganizationResponse {
  return {
    slug: "muzyczne-skrzaty",
    name: "Muzyczne Skrzaty",
    primary_color: null,
    accent_color: null,
    page_layout: "DEFAULT",
    palette_preset: null,
    description: null,
    logo: null,
    avatar: null,
    cover: null,
    gallery: [],
    ...overrides,
  };
}

function event(overrides: Partial<EventDetailResponse> = {}): EventDetailResponse {
  return {
    id: "event-1",
    name: "Piknik wymiany",
    description: null,
    starts_at: "2026-11-07T14:00:00",
    ends_at: null,
    location: null,
    created_at: "2026-11-01T10:00:00",
    updated_at: "2026-11-01T10:00:00",
    author_slug: "muzyczne-skrzaty",
    banner_url: null,
    attendee_count: 0,
    is_author: false,
    author_display_name: "Muzyczne Skrzaty",
    organization: null,
    participants: [],
    is_attending: false,
    has_ended: false,
    open_reservations: null,
    ...overrides,
  };
}

function term(overrides: Partial<PublicTermResponse> = {}): PublicTermResponse {
  return {
    id: "term-1",
    occurs_on: "2026-11-09T17:00:00",
    description: null,
    needed_items: [],
    item_listings: [],
    ...overrides,
  };
}

function circle(overrides: Partial<PublicCircleResponse> = {}): PublicCircleResponse {
  return {
    id: "group-1",
    name: "Nutki dla starszaków",
    organizer_display_name: "Muzyczne Skrzaty",
    organizer_slug: "muzyczne-skrzaty",
    organizer_party_id: null,
    visibility: "PUBLIC",
    layout_mode: "CIRCLE",
    term: null,
    guardians: [],
    organization: null,
    ...overrides,
  };
}

function preview(title: string, description: string, image: string | null) {
  return {
    title,
    openGraph: { title, description, type: "website", ...(image === null ? {} : { images: [image] }) },
    twitter: {
      card: image === null ? "summary" : "summary_large_image",
      title,
      description,
      ...(image === null ? {} : { images: [image] }),
    },
  };
}

describe("publicMetadata", () => {
  it.each([
    {
      label: "with a cover",
      dto: organization({ cover: { url: "https://cdn.example/cover.webp", thumb_url: "https://cdn.example/t.webp" } }),
      expected: preview("Muzyczne Skrzaty", "Strona organizacji Muzyczne Skrzaty.", "https://cdn.example/cover.webp"),
    },
    {
      label: "with HTML in the name, passed through for React to escape",
      dto: organization({ name: '<script>alert("x")</script>' }),
      expected: preview(
        '<script>alert("x")</script>',
        'Strona organizacji <script>alert("x")</script>.',
        null,
      ),
    },
  ])("organization $label", ({ dto, expected }) => {
    expect(isOrganizationSlug(dto.slug)).toBe(true);
    expect(organizationMetadata(dto)).toEqual(expected);
  });

  it("event with location and description: the place's full label", () => {
    const dto = event({
      description: "Przynieś rzeczy do wymiany.",
      location: makeLocationRef({
        locality: makeLocality({ name: "Warszawa", gmina: "Warszawa", powiat: "Warszawa", voivodeship: "mazowieckie" }),
        label: "Warszawa — Park Skaryszewski, al. Zieleniecka",
        formatted_address: "Park Skaryszewski, al. Zieleniecka",
      }),
      banner_url: "https://cdn.example/banner.webp",
    });

    expect(eventMetadata(dto)).toEqual(
      preview(
        "Piknik wymiany",
        "sob 07.11 o 14:00 · Warszawa — Park Skaryszewski, al. Zieleniecka Przynieś rzeczy do wymiany.",
        "https://cdn.example/banner.webp",
      ),
    );
  });

  it.each([
    { label: "and no description", dto: event({ starts_at: "2026-11-11T09:05:00" }), title: "Piknik wymiany" },
    {
      label: "with a backslash name kept literally",
      dto: event({ name: String.raw`Swap \o/ \1`, starts_at: "2026-11-11T09:05:00" }),
      title: String.raw`Swap \o/ \1`,
    },
  ])("event without location $label", ({ dto, title }) => {
    expect(eventMetadata(dto)).toEqual(preview(title, "śr 11.11 o 09:05", null));
  });

  it("term with term and description", () => {
    const dto = circle({ term: term({ description: "Sala 12, godz. 17:00" }) });

    expect(termMetadata(dto)).toEqual(
      preview("Nutki dla starszaków", "Najbliższy termin: 09.11.2026. Sala 12, godz. 17:00", null),
    );
  });

  it("term without term", () => {
    expect(termMetadata(circle())).toEqual(
      preview("Nutki dla starszaków", "Dołącz i zobacz najbliższe spotkania.", null),
    );
  });

  it.each([
    { label: "party UUID slug", actual: () => isOrganizationSlug("3f2b8c1e-9a4d-4e6b-8f1a-2c3d4e5f6a7b"), expected: false },
    { label: "krag slug", actual: () => isOrganizationSlug("krag"), expected: false },
    { label: "reserved slug", actual: () => isOrganizationSlug("login"), expected: false },
    { label: "dotted file name", actual: () => isOrganizationSlug("favicon.ico"), expected: false },
    { label: "organization not found", actual: () => organizationMetadata(null), expected: {} },
    { label: "event not found or invalid UUID", actual: () => eventMetadata(null), expected: {} },
    { label: "circle or term not found", actual: () => termMetadata(null), expected: {} },
  ])("fallback to the root default, no OG: $label", ({ actual, expected }) => {
    expect(actual()).toEqual(expected);
  });
});
