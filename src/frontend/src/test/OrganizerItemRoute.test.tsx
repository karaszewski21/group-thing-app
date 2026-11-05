import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as itemsApi from "../api/items";
import * as itemActionsApi from "../api/itemActions";
import type { ItemActionsResponse } from "../api/itemActions";
import { ApiError } from "../api/client";
import * as serverApi from "../api/server";
import type { ItemDetailsResponse } from "../api/items";
import OwnerLayout from "../app/(site)/[slug]/layout";
import { itemRouteElement } from "./itemRoute";
import { Navigate, useAppParams } from "../routing/navigation";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

const mockAuth: { token: string | null } = { token: "valid.jwt.token" };

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
}));

vi.mock("../api/itemActions", () => ({
  getItemActions: vi.fn(),
}));

vi.mock("../api/server", () => ({
  getItemOnServer: vi.fn(),
  getPublicOrganizationOnServer: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn().mockResolvedValue([]),
}));

const ORGANIZATION = {
  slug: "ania",
  name: "Studio Ania",
  primary_color: "#7a2a4f",
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  description: null,
  logo: null,
  cover: null,
  gallery: [],
};

function details(overrides: Partial<ItemDetailsResponse> = {}): ItemDetailsResponse {
  return {
    id: "9",
    product_id: "p-1",
    name: "Rowerek biegowy",
    category_id: "c-1",
    category_name: "Zabawki",
    condition: "GOOD",
    listing_status: "ACTIVE",
    location_id: null,
    description: "Lekki, aluminiowy.",
    photos: [],
    product_photo_url: null,
    is_owner: true,
    deleted_at: null,
    status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null, personal_pickup: false },
    ...overrides,
  };
}

function itemActions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    visibility: null,
    available: true,
    reservation: null,
    party_reservation: null,
    owner: { party_id: "party-1", display_name: "Studio Ania", slug: "ania", items_total: 4 },
    viewer: "OWN",
    location: null,
    contexts: [],
    personal_pickup_available: false,
    ...overrides,
  };
}

function currentUrl() {
  const { pathname, search } = getTestLocation();
  return pathname + search;
}

// The redirects `router.tsx` sets up around the organizer item route.
function ToOrganizerPage() {
  const { slug = "" } = useAppParams();
  return <Navigate to={`/${slug}`} replace />;
}

async function renderAt(path: string) {
  const [, slug = ""] = new URL(path, "http://localhost").pathname.split("/");
  const page = await OwnerLayout({ children: await itemRouteElement(path), params: Promise.resolve({ slug }) });
  return renderWithRoute(<>{page}</>, {
    url: path,
    pattern: "/:slug/product/:id",
    routes: {
      "/:slug/product": <ToOrganizerPage />,
    },
    wrapper: createQueryWrapper(),
  });
}

function paletteOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[style*="--color-primary"]');
}

describe("Organizer product route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.token = "valid.jwt.token";
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    vi.mocked(serverApi.getPublicOrganizationOnServer).mockResolvedValue(ORGANIZATION);
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions());
  });

  it("anonymous: a listed item renders with the actions card, no login detour", async () => {
    mockAuth.token = null;
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ viewer: "ANONYMOUS" }));
    await renderAt("/ania/product/9");

    expect(await screen.findByRole("heading", { name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Jak chcesz odebrać?" })).toBeInTheDocument();
    expect(currentUrl()).toBe("/ania/product/9");
    expect(itemActionsApi.getItemActions).toHaveBeenCalledWith("9");
  });

  it("anonymous: a non-public item (404) offers login in place, staying on the item URL", async () => {
    mockAuth.token = null;
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(404, "Not Found", null));
    await renderAt("/ania/product/9?event=ev-1");

    expect(await screen.findByRole("heading", { name: "Zaloguj się, żeby zobaczyć tę rzecz" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(screen.getByRole("dialog", { name: "Potrzebne konto" })).toBeInTheDocument();
    expect(currentUrl()).toBe("/ania/product/9?event=ev-1");
  });

  it("renders the item in the organizer palette", async () => {
    await renderAt("/ania/product/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    expect(paletteOf(heading)?.style.getPropertyValue("--color-primary")).toBe("#7a2a4f");
  });

  it("falls back to the default palette when the organization is unknown", async () => {
    vi.mocked(serverApi.getPublicOrganizationOnServer).mockResolvedValue(null);
    await renderAt("/ania/product/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    expect(paletteOf(heading)).toBeNull();
  });

  it("Wróć on a direct entry goes to the organizer page", async () => {
    await renderAt("/ania/product/9");

    await screen.findByRole("heading", { name: "Rowerek biegowy" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(currentUrl()).toBe("/ania");
  });

  it("bare /:slug/product redirects to the organizer page without fetching an item", async () => {
    await renderAt("/ania/product");

    expect(currentUrl()).toBe("/ania");
    expect(itemsApi.getItemDetails).not.toHaveBeenCalled();
  });
});
