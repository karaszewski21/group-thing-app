import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { OrganizationGroupTermsResponse, PublicOrganizationResponse } from "../api/organizations";
import * as organizationsApi from "../api/organizations";
import { groupTermsRouteElement } from "./itemRoute";
import { layoutGroup } from "./organizationLayoutFixtures";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
  getOrganizationGroupTerms: vi.fn(),
}));

const SLUG = "rodzinny-grajdolek";
const GROUP_ID = "g-1";

const ORGANIZATION: PublicOrganizationResponse = {
  slug: SLUG,
  name: "Rodzinny Grajdołek",
  primary_color: "#7a1f3d",
  accent_color: "#d4a017",
  page_layout: "SCHEDULE",
  palette_preset: null,
  description: null,
  logo: null,
  avatar: null,
  cover: null,
  gallery: [],
};

// 2026-11-14 is a Saturday, 2026-11-21 too.
function groupTerms(overrides: Partial<OrganizationGroupTermsResponse> = {}): OrganizationGroupTermsResponse {
  return {
    owner: { party_id: "p-1", display_name: "Rodzinny Grajdołek", slug: SLUG },
    group: layoutGroup(GROUP_ID, {
      name: "Zajęcia Pomelody",
      layout_mode: "TABLE",
      next_term: { id: "t1", occurs_on: "2026-11-14T16:00:00", attendee_count: 4 },
      upcoming_term_count: 2,
    }),
    terms: [
      {
        id: "t1",
        occurs_on: "2026-11-14T16:00:00",
        description: "Rytmika w parku",
        location_name: "Grudziądz — Portowa 5",
        attendee_count: 4,
        path: `/${SLUG}/group/${GROUP_ID}/term/t1`,
      },
      {
        id: "t2",
        occurs_on: "2026-11-21T16:00:00",
        description: null,
        location_name: null,
        attendee_count: 1,
        path: `/${SLUG}/group/${GROUP_ID}/term/t2`,
      },
    ],
    ...overrides,
  };
}

async function renderAt(path: string) {
  renderWithRoute(await groupTermsRouteElement(path), {
    url: path,
    pattern: "/:slug/group/:groupId/terms",
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
});

describe("GroupTermsPage", () => {
  it("shows the big group tile and the group's terms, each linking to its page, in the organization theme", async () => {
    vi.mocked(organizationsApi.getOrganizationGroupTerms).mockResolvedValue(groupTerms());

    await renderAt(`/${SLUG}/group/${GROUP_ID}/terms`);

    const heading = await screen.findByRole("heading", { level: 1, name: "Zajęcia Pomelody" });
    expect(organizationsApi.getOrganizationGroupTerms).toHaveBeenCalledWith(SLUG, GROUP_ID);
    expect(heading.closest("[data-organizer-theme]")).not.toBeNull();
    expect(screen.getByText("Stół")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz najbliższy termin grupy Zajęcia Pomelody" })).toHaveAttribute(
      "href",
      `/${SLUG}/group/${GROUP_ID}/term/t1`,
    );

    const list = screen.getByRole("region", { name: "Terminy grupy" });
    expect(within(list).getByText("2 zaplanowane terminy")).toBeInTheDocument();
    const cards = within(list).getAllByRole("listitem");
    expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", `/${SLUG}/group/${GROUP_ID}/term/t1`);
    expect(cards[0]).toHaveTextContent("sobota, 14 listopada · 16:00");
    expect(cards[0]).toHaveTextContent("Rytmika w parku");
    expect(cards[0]).toHaveTextContent("Grudziądz — Portowa 5 · 4 zapisanych");
    expect(cards[1]).toHaveTextContent("1 zapisany");
    expect(within(list).getByRole("link", { name: "Wszystkie spotkania →" })).toHaveAttribute(
      "href",
      `/${SLUG}/meetings`,
    );
    expect(screen.getByRole("link", { name: "Rodzinny Grajdołek" })).toHaveAttribute("href", `/${SLUG}`);
  });

  it("shows the empty notice and no next-term link for a group with nothing planned", async () => {
    vi.mocked(organizationsApi.getOrganizationGroupTerms).mockResolvedValue(
      groupTerms({ group: layoutGroup(GROUP_ID, { name: "Rytmika" }), terms: [] }),
    );

    await renderAt(`/${SLUG}/group/${GROUP_ID}/terms`);

    expect(await screen.findByText("Rytmika nie ma teraz zaplanowanych terminów")).toBeInTheDocument();
    expect(screen.getByText("brak zaplanowanych terminów")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Zobacz najbliższy termin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it.each([404, 400])("shows not found when the group read answers %i", async (status) => {
    vi.mocked(organizationsApi.getOrganizationGroupTerms).mockRejectedValue(new ApiError(status, "Nope", null));

    await renderAt(`/${SLUG}/group/${GROUP_ID}/terms`);

    expect(await screen.findByText("Ta grupa nie istnieje albo nie jest publiczna.")).toBeInTheDocument();
  });

  it("shows the error with a retry when the group read fails", async () => {
    vi.mocked(organizationsApi.getOrganizationGroupTerms).mockRejectedValue(new ApiError(500, "Server Error", null));

    await renderAt(`/${SLUG}/group/${GROUP_ID}/terms`);

    expect(await screen.findByText(/Nie udało się wczytać terminów grupy\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeInTheDocument();
  });
});
