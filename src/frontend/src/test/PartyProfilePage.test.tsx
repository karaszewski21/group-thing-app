import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { OwnerItemCard, OwnerItemsPageResponse, PartyProfileResponse } from "../api/ownerItems";
import * as ownerItemsApi from "../api/ownerItems";
import { findPreset } from "../theme/palettes";
import { ownerRouteElement } from "./itemRoute";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

const mockAuth: { token: string | null; username: string | null } = { token: null, username: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/ownerItems", () => ({
  getPartyProfile: vi.fn(),
  getPartyOwnerMeetings: vi.fn(),
  getPartyOwnerItems: vi.fn(),
}));

const PARTY_ID = "0b6f3c1e-9a7d-4c2e-8f1a-2d3e4f5a6b7c";
const OWNER = { party_id: PARTY_ID, display_name: "Ania Kowalska", slug: null };

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
    owner: OWNER,
    organization: null,
    bio: "Oddaję ubranka po córce.",
    page_layout: "BANNER",
    palette_preset: null,
    primary_color: null,
    accent_color: null,
    logo: null,
    avatar: null,
    cover: null,
    gallery: [],
    nearest: null,
    counts: { GIFT: 5, SWAP: 2 },
    recent_items: [],
    is_me: false,
    ...overrides,
  };
}

function itemsPage(page: number, ids: string[], total: number): OwnerItemsPageResponse {
  return {
    owner: OWNER,
    nearest: null,
    counts: { GIFT: 5, SWAP: 2 },
    items: ids.map(card),
    total,
    page,
    size: 20,
  };
}

const FIRST_PAGE = Array.from({ length: 20 }, (_, i) => `i${i + 1}`);

async function renderAt(path: string) {
  return renderWithRoute(await ownerRouteElement(path), {
    url: path,
    pattern: "/:slug",
    wrapper: createQueryWrapper(),
  });
}

function itemsSection() {
  return within(screen.getByRole("region", { name: "Rzeczy użytkownika" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ownerItemsApi.getPartyOwnerMeetings).mockResolvedValue({ owner: OWNER, meetings: [] });
  vi.mocked(ownerItemsApi.getPartyOwnerItems).mockResolvedValue(itemsPage(1, ["i1", "i2"], 2));
});

describe("PartyProfilePage", () => {
  it("shows the name, count, bio, the person's items and no owner controls to a visitor", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile());

    const { container } = await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" })).toBeInTheDocument();
    expect(screen.getByText("7 rzeczy do oddania lub zamiany")).toBeInTheDocument();
    expect(screen.getByText("Oddaję ubranka po córce.")).toBeInTheDocument();
    expect(screen.getByText("AK")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: /Wróć/ })).toBeInTheDocument();
    expect(await itemsSection().findByRole("link", { name: /Rzecz i1/ })).toHaveAttribute(
      "href",
      `/${PARTY_ID}/product/i1`,
    );
    expect(ownerItemsApi.getPartyOwnerItems).toHaveBeenCalledWith(PARTY_ID, 1, undefined);
    expect(screen.queryByRole("region", { name: "Galeria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Załóż organizację" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pokaż więcej" })).not.toBeInTheDocument();
  });

  it("shows the person themself the settings gear to Wygląd strony and the organizer invite", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile({ is_me: true }));

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByRole("link", { name: "Ustawienia" })).toHaveAttribute(
      "href",
      `/${PARTY_ID}/appearance`,
    );
    expect(screen.getByRole("link", { name: "Załóż organizację" })).toHaveAttribute("href", "/organization");
  });

  it("paints the banner, avatar and gallery from the approved photos in the chosen colors", async () => {
    const ocean = findPreset("OCEAN")!;
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(
      profile({
        palette_preset: "OCEAN",
        primary_color: ocean.vars["--color-primary"],
        accent_color: ocean.vars["--color-accent"],
        cover: { url: "https://cdn/cover.webp", thumb_url: "https://cdn/cover-t.webp" },
        avatar: { url: "https://cdn/avatar.webp", thumb_url: "https://cdn/avatar-t.webp" },
        gallery: [
          { url: "https://cdn/g1.webp", thumb_url: "https://cdn/g1-t.webp" },
          { url: "https://cdn/g2.webp", thumb_url: "https://cdn/g2-t.webp" },
        ],
      }),
    );

    const { container } = await renderAt(`/${PARTY_ID}`);

    const heading = await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" });
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(expect.arrayContaining(["https://cdn/cover.webp", "https://cdn/avatar-t.webp"]));
    expect(screen.queryByText("AK")).not.toBeInTheDocument();
    const gallery = within(screen.getByRole("region", { name: "Galeria" }));
    expect(gallery.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://cdn/g1.webp",
      "https://cdn/g2.webp",
    ]);
    const scope = heading.closest("[data-organizer-theme]") as HTMLElement;
    expect(scope).not.toBeNull();
    expect(scope.style.getPropertyValue("--color-primary")).toBe(ocean.vars["--color-primary"]);
  });

  it("pages through the person's items with Pokaż więcej", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile());
    vi.mocked(ownerItemsApi.getPartyOwnerItems)
      .mockResolvedValueOnce(itemsPage(1, FIRST_PAGE, 22))
      .mockResolvedValueOnce(itemsPage(2, ["i21", "i22"], 22));

    await renderAt(`/${PARTY_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" });

    expect(await itemsSection().findAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(itemsSection().getByRole("button", { name: "Pokaż więcej" }));

    expect(await itemsSection().findByRole("link", { name: /Rzecz i22/ })).toBeInTheDocument();
    expect(itemsSection().getAllByRole("listitem")).toHaveLength(22);
    expect(ownerItemsApi.getPartyOwnerItems).toHaveBeenLastCalledWith(PARTY_ID, 2, undefined);
    expect(itemsSection().queryByRole("button", { name: "Pokaż więcej" })).not.toBeInTheDocument();
  });

  it("tells a visitor in two boxes that the person has added no terms and no items", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile({ counts: { GIFT: 0, SWAP: 0 }, bio: null }));

    await renderAt(`/${PARTY_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" });

    expect(screen.getByText("Ten użytkownik nie dodał jeszcze żadnych terminów.")).toBeInTheDocument();
    expect(screen.getByText("Ten użytkownik nie dodał jeszcze żadnych rzeczy.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Dodaj/ })).not.toBeInTheDocument();
    expect(ownerItemsApi.getPartyOwnerItems).not.toHaveBeenCalled();
  });

  it("gives a new owner one box with a '+' to /add while they have neither terms nor items", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(
      profile({ counts: { GIFT: 0, SWAP: 0 }, is_me: true }),
    );

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText("Nie masz jeszcze ani terminów, ani rzeczy")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Dodaj/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Dodaj termin lub rzecz" })).toHaveAttribute("href", "/add");
    expect(screen.queryByText("Ten użytkownik nie dodał jeszcze żadnych terminów.")).not.toBeInTheDocument();
  });

  it("asks an owner with items but no terms to add a term", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(profile({ is_me: true }));

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText("Nie masz jeszcze terminów")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dodaj termin" })).toHaveAttribute("href", "/add");
    expect(screen.queryByRole("link", { name: "Dodaj rzecz" })).not.toBeInTheDocument();
  });

  it("asks an owner with a term but no items to add an item", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(
      profile({ counts: { GIFT: 0, SWAP: 0 }, nearest: {
        kind: "TERM",
        id: "t-1",
        name: "Wymianka",
        starts_at: "2026-11-20T17:00:00",
        location_name: null,
        attendee_count: 0,
        path: "/ania/group/g-1/term/t-1",
      }, is_me: true }),
    );

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText("Nie masz jeszcze rzeczy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dodaj rzecz" })).toHaveAttribute("href", "/add");
    expect(screen.queryByRole("link", { name: "Dodaj termin" })).not.toBeInTheDocument();
  });

  it("keeps an Organization owner on their own profile, linking the owner to the Organization's page", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockResolvedValue(
      profile({ organization: { name: "Akademia Orlik", slug: "akademia-orlik" }, is_me: true }),
    );

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" })).toBeInTheDocument();
    expect(getTestLocation().pathname).toBe(`/${PARTY_ID}`);
    expect(screen.getByRole("link", { name: "Przejdź do strony organizacji „Akademia Orlik”" })).toHaveAttribute("href", "/akademia-orlik");
    expect(screen.queryByRole("link", { name: "Załóż organizację" })).not.toBeInTheDocument();
  });

  it("a person with nothing public is not found", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile).mockRejectedValue(new ApiError(404, "Not Found", null));

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText("Ten profil nie istnieje albo nie jest publiczny.")).toBeInTheDocument();
  });

  it("a failed read shows the error with a retry that fetches again", async () => {
    vi.mocked(ownerItemsApi.getPartyProfile)
      .mockRejectedValueOnce(new ApiError(500, "Server Error", null))
      .mockResolvedValue(profile());

    await renderAt(`/${PARTY_ID}`);

    expect(await screen.findByText(/Nie udało się wczytać profilu\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ania Kowalska" })).toBeInTheDocument();
  });
});
