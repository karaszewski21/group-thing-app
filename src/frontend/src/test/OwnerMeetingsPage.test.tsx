import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { PublicOrganizationResponse } from "../api/organizations";
import * as organizationsApi from "../api/organizations";
import type { OwnerMeetingsResponse, OwnerNearestDate } from "../api/ownerItems";
import * as ownerItemsApi from "../api/ownerItems";
import { ownerMeetingsRouteElement } from "./itemRoute";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
}));

vi.mock("../api/ownerItems", () => ({
  getOrganizationOwnerMeetings: vi.fn(),
  getPartyOwnerMeetings: vi.fn(),
}));

const SLUG = "akademia-orlik";
const PARTY_ID = "0b6f3c1e-9a7d-4c2e-8f1a-2d3e4f5a6b7c";

const ORGANIZATION: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: "#7a1f3d",
  accent_color: "#d4a017",
  page_layout: "EXCHANGE",
  palette_preset: null,
  description: null,
  logo: null,
  cover: null,
  gallery: [],
};

// 2026-11-07 is a Saturday, 2026-11-10 a Tuesday.
const TERM: OwnerNearestDate = {
  kind: "TERM",
  id: "t1",
  name: "Rytmika",
  starts_at: "2026-11-07T10:00:00",
  location_name: "Park Jordana",
  attendee_count: 1,
  path: `/${SLUG}/group/g1/term/t1`,
};
const EVENT: OwnerNearestDate = {
  kind: "EVENT",
  id: "e1",
  name: "Wymianka sąsiedzka",
  starts_at: "2026-11-10T17:30:00",
  location_name: null,
  attendee_count: 14,
  path: `/${SLUG}/event/e1`,
};

function meetings(overrides: Partial<OwnerMeetingsResponse> = {}): OwnerMeetingsResponse {
  return {
    owner: { party_id: PARTY_ID, display_name: "Akademia Orlik", slug: SLUG },
    meetings: [TERM, EVENT],
    ...overrides,
  };
}

async function renderAt(path: string) {
  renderWithRoute(await ownerMeetingsRouteElement(path), {
    url: path,
    pattern: "/:slug/meetings",
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
});

describe("OwnerMeetingsPage", () => {
  it("lists the organization's terms and events, each linking to its page", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerMeetings).mockResolvedValue(meetings());

    await renderAt(`/${SLUG}/meetings`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Spotkania: Akademia Orlik" }),
    ).toBeInTheDocument();
    expect(ownerItemsApi.getOrganizationOwnerMeetings).toHaveBeenCalledWith(SLUG);
    expect(screen.getByText("2 zaplanowane spotkania")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rytmika/ })).toHaveAttribute("href", TERM.path);
    expect(screen.getByRole("link", { name: /Wymianka sąsiedzka/ })).toHaveAttribute("href", EVENT.path);
    expect(screen.getByText("Park Jordana · 1 zapisany")).toBeInTheDocument();
    expect(screen.getByText("14 zapisanych")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Akademia Orlik" })).toHaveAttribute("href", `/${SLUG}`);
    expect(screen.getByRole("heading", { level: 1 }).closest("[data-organizer-theme]")).not.toBeNull();
  });

  it("shows the empty notice when nothing is planned", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockResolvedValue(
      meetings({ owner: { party_id: PARTY_ID, display_name: "Ania", slug: null }, meetings: [] }),
    );

    await renderAt(`/${PARTY_ID}/meetings`);

    expect(await screen.findByText("Ania nie ma teraz zaplanowanych spotkań")).toBeInTheDocument();
    expect(ownerItemsApi.getPartyOwnerMeetings).toHaveBeenCalledWith(PARTY_ID);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("redirects a party URL of an Organization owner to the slug URL, keeping the query", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockResolvedValue(meetings());

    await renderAt(`/${PARTY_ID}/meetings?x=1`);

    await waitFor(() => {
      const { pathname, search } = getTestLocation();
      expect(pathname + search).toBe(`/${SLUG}/meetings?x=1`);
    });
    expect(getTestRouter().calls).toEqual([{ method: "replace", url: `/${SLUG}/meetings?x=1`, scroll: true }]);
  });

  it("shows not found for a person with nothing public", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockRejectedValue(new ApiError(404, "Not Found", null));

    await renderAt(`/${PARTY_ID}/meetings`);

    expect(await screen.findByText("Ten profil nie istnieje albo nie jest publiczny.")).toBeInTheDocument();
  });

  it("shows not found for an unknown organization", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));

    await renderAt(`/${SLUG}/meetings`);

    expect(await screen.findByText("Ten profil nie istnieje albo nie jest publiczny.")).toBeInTheDocument();
  });

  it("shows the load error with a retry that fetches the meetings again", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerMeetings)
      .mockRejectedValueOnce(new ApiError(500, "Server Error", null))
      .mockResolvedValue(meetings());

    await renderAt(`/${SLUG}/meetings`);

    expect(await screen.findByText(/Nie udało się wczytać spotkań\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Spotkania: Akademia Orlik" })).toBeInTheDocument();
    expect(ownerItemsApi.getOrganizationOwnerMeetings).toHaveBeenCalledTimes(2);
  });
});
