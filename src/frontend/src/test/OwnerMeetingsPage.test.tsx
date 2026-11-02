import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { PublicOrganizationResponse } from "../api/organizations";
import * as organizationsApi from "../api/organizations";
import type { OwnerMeetingsResponse, OwnerNearestDate } from "../api/ownerItems";
import * as ownerItemsApi from "../api/ownerItems";
import { OwnerMeetingsPage } from "../pages/owner/OwnerMeetingsPage";
import { createQueryWrapper } from "./queryClient";

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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/:organizationSlug/meetings",
        element: (
          <>
            <OwnerMeetingsPage />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />, { wrapper: createQueryWrapper() });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
});

describe("OwnerMeetingsPage", () => {
  it("lists the organization's terms and events, each linking to its page", async () => {
    vi.mocked(ownerItemsApi.getOrganizationOwnerMeetings).mockResolvedValue(meetings());

    renderAt(`/${SLUG}/meetings`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Spotkania: Akademia Orlik" }),
    ).toBeInTheDocument();
    expect(ownerItemsApi.getOrganizationOwnerMeetings).toHaveBeenCalledWith(SLUG);
    expect(screen.getByText("2 zaplanowane spotkania")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rytmika/ })).toHaveAttribute("href", TERM.path);
    expect(screen.getByRole("link", { name: /Wymianka sąsiedzka/ })).toHaveAttribute("href", EVENT.path);
    expect(screen.getByText("Park Jordana · 1 zapisany")).toBeInTheDocument();
    expect(screen.getByText("14 zapisanych")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Akademia Orlik/ })).toHaveAttribute("href", `/${SLUG}`);
  });

  it("shows the empty notice when nothing is planned", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockResolvedValue(
      meetings({ owner: { party_id: PARTY_ID, display_name: "Ania", slug: null }, meetings: [] }),
    );

    renderAt(`/${PARTY_ID}/meetings`);

    expect(await screen.findByText("Ania nie ma teraz zaplanowanych spotkań")).toBeInTheDocument();
    expect(ownerItemsApi.getPartyOwnerMeetings).toHaveBeenCalledWith(PARTY_ID);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("redirects a party URL of an Organization owner to the slug URL", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockResolvedValue(meetings());
    vi.mocked(ownerItemsApi.getOrganizationOwnerMeetings).mockResolvedValue(meetings());

    renderAt(`/${PARTY_ID}/meetings`);

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/${SLUG}/meetings`));
    expect(await screen.findByRole("heading", { level: 1, name: "Spotkania: Akademia Orlik" })).toBeInTheDocument();
  });

  it("shows not found for a person with nothing public", async () => {
    vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockRejectedValue(new ApiError(404, "Not Found", null));

    renderAt(`/${PARTY_ID}/meetings`);

    expect(await screen.findByText("Ten profil nie istnieje albo nie jest publiczny.")).toBeInTheDocument();
  });
});
