import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { OwnerItemCard, PartyProfileResponse } from "../api/ownerItems";
import * as ownerItemsApi from "../api/ownerItems";
import { PartyProfilePage } from "../features/owner-page/PartyProfilePage";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

const mockAuth: { token: string | null; username: string | null } = { token: null, username: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/ownerItems", () => ({
  getPartyProfile: vi.fn(),
  getPartyOwnerMeetings: vi.fn(),
}));

const PARTY_ID = "0b6f3c1e-9a7d-4c2e-8f1a-2d3e4f5a6b7c";

function card(id: string): OwnerItemCard {
  return {
    item_id: id,
    product_name: `Rzecz ${id}`,
    condition: "GOOD",
    mode: "GIFT",
    thumb_url: null,
    added_at: "2026-10-30T09:00:00",
    reservation: null,
  };
}

function profile(overrides: Partial<PartyProfileResponse> = {}): PartyProfileResponse {
  return {
    owner: { party_id: PARTY_ID, display_name: "Ania Kowalska", slug: null },
    bio: "Oddaję ubranka po córce.",
    avatar_url: null,
    nearest: null,
    counts: { GIFT: 5, SWAP: 2 },
    recent_items: ["i1", "i2", "i3", "i4", "i5", "i6"].map(card),
    is_me: false,
    ...overrides,
  };
}

function renderAt(path: string) {
  renderWithRoute(<PartyProfilePage />, {
    url: path,
    pattern: "/:slug",
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockResolvedValue({
    owner: { party_id: PARTY_ID, display_name: "Ania Kowalska", slug: null },
    meetings: [],
  });
});

describe("PartyProfilePage", () => {
  it("shows the name, bio, newest items and a link to all items", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile());

    renderAt(`/${PARTY_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" })).toBeInTheDocument();
    expect(screen.getByText("Oddaję ubranka po córce.")).toBeInTheDocument();
    expect(screen.getByText("Ania Kowalska nie ma teraz zaplanowanych spotkań")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rzecz i1" })).toHaveAttribute("href", `/${PARTY_ID}/product/i1`);
    expect(screen.getByRole("link", { name: /Zobacz wszystkie \(7\)/ })).toHaveAttribute(
      "href",
      `/${PARTY_ID}/items`,
    );
    expect(screen.queryByRole("link", { name: "Załóż stronę organizatora" })).not.toBeInTheDocument();
  });

  it("invites the person themself to set up an organizer page", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile({ is_me: true }));

    renderAt(`/${PARTY_ID}`);

    expect(await screen.findByRole("link", { name: "Załóż stronę organizatora" })).toHaveAttribute(
      "href",
      "/organization",
    );
  });

  it("with nothing listed, says so and links no item list", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(
      profile({ counts: { GIFT: 0, SWAP: 0 }, recent_items: [], bio: null }),
    );

    renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText("Nie ma teraz rzeczy do oddania ani zamiany.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Zobacz wszystkie/ })).not.toBeInTheDocument();
  });

  it("redirects an Organization owner to the Organization's page", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(
      profile({ owner: { party_id: PARTY_ID, display_name: "Akademia Orlik", slug: "akademia-orlik" } }),
    );

    renderAt(`/${PARTY_ID}`);

    await waitFor(() => expect(getTestLocation().pathname).toBe("/akademia-orlik"));
  });

  it("a person with nothing public is not found", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockRejectedValue(new ApiError(404, "Not Found", null));

    renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText("Ten profil nie istnieje albo nie jest publiczny.")).toBeInTheDocument();
  });
});
