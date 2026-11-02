// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetailResponse } from "../api/events";
import type { PublicCircleResponse } from "../api/groups";
import type { PublicOrganizationResponse } from "../api/organizations";
import { generateMetadata as eventPageMetadata } from "../app/(site)/[organizationSlug]/event/[eventId]/page";
import { generateMetadata as termPageMetadata } from "../app/(site)/[organizationSlug]/group/[groupId]/term/[termId]/page";
import { generateMetadata as ownerPageMetadata } from "../app/(site)/[organizationSlug]/(owner)/page";
import { eventMetadata, organizationMetadata, termMetadata } from "../lib/publicMetadata";

vi.mock("server-only", () => ({}));

const ORGANIZATION: PublicOrganizationResponse = {
  slug: "muzyczne-skrzaty",
  name: "Muzyczne Skrzaty",
  primary_color: "#7a2a4f",
  accent_color: null,
  page_layout: "DEFAULT",
  palette_preset: null,
  description: null,
  logo: null,
  cover: { url: "https://cdn.example/cover.webp", thumb_url: "https://cdn.example/t.webp" },
  gallery: [],
};

const EVENT: EventDetailResponse = {
  id: "ev-1",
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
};

const CIRCLE: PublicCircleResponse = {
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
};

function stubFetch(response: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const PAGES = [
  {
    kind: "organization",
    load: () => ownerPageMetadata({ params: Promise.resolve({ organizationSlug: "muzyczne-skrzaty" }) }),
    path: "/api/organizations/public/muzyczne-skrzaty",
    dto: ORGANIZATION,
    expected: organizationMetadata(ORGANIZATION),
  },
  {
    kind: "event",
    load: () => eventPageMetadata({ params: Promise.resolve({ eventId: "ev-1" }) }),
    path: "/api/events/ev-1",
    dto: EVENT,
    expected: eventMetadata(EVENT),
  },
  {
    kind: "term",
    load: () => termPageMetadata({ params: Promise.resolve({ groupId: "group-1", termId: "term-1" }) }),
    path: "/api/groups/public/group-1?term_id=term-1",
    dto: CIRCLE,
    expected: termMetadata(CIRCLE),
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page generateMetadata", () => {
  it.each(PAGES)("$kind page reads its DTO anonymously and maps it", async ({ load, path, dto, expected }) => {
    const fetchMock = stubFetch(() => Promise.resolve(Response.json(dto)));

    const metadata = await load();

    expect(metadata).toEqual(expected);
    expect(metadata.title).toBe(dto.name);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname + new URL(url).search).toBe(path);
    expect(init).toEqual({ cache: "no-store" });
  });

  it.each(PAGES.flatMap(({ kind, load }) => [
    { kind, failure: "a 404", load, response: () => Promise.resolve(new Response("{}", { status: 404 })) },
    { kind, failure: "an unreachable backend", load, response: () => Promise.reject(new TypeError("fetch failed")) },
  ]))("$kind page falls back to the root default on $failure", async ({ load, response }) => {
    stubFetch(response);

    await expect(load()).resolves.toEqual({});
  });

  it("does not fetch an Organization for a person profile slug", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(Response.json(ORGANIZATION)));

    const metadata = await ownerPageMetadata({
      params: Promise.resolve({ organizationSlug: "3f2b8c1e-9a4d-4e6b-8f1a-2c3d4e5f6a7b" }),
    });

    expect(metadata).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
