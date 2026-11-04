import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as itemsApi from "../api/items";
import * as itemActionsApi from "../api/itemActions";
import type { ItemActionsResponse } from "../api/itemActions";
import * as organizationsApi from "../api/organizations";
import { ApiError } from "../api/client";
import type { ItemDetailsResponse } from "../api/items";
import { ItemDetailBody } from "../features/items/product/ItemDetailPage";
import { OrganizerItemLayout } from "../features/items/product/OrganizerItemLayout";
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

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
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

function renderAt(path: string) {
  return renderWithRoute(
    <OrganizerItemLayout>
      <ItemDetailBody />
    </OrganizerItemLayout>,
    {
      url: path,
      pattern: "/:slug/product/:id",
      routes: {
        "/:slug/product": <ToOrganizerPage />,
      },
      wrapper: createQueryWrapper(),
    },
  );
}

function scopeOf(element: HTMLElement): HTMLElement {
  const scope = element.closest<HTMLElement>("[data-organizer-theme]");
  if (!scope) throw new Error("no theme scope");
  return scope;
}

describe("Organizer product route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.token = "valid.jwt.token";
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions());
  });

  it("anonymous: a listed item renders with the actions card, no login detour", async () => {
    mockAuth.token = null;
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ viewer: "ANONYMOUS" }));
    renderAt("/ania/product/9");

    expect(await screen.findByRole("heading", { name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Chcesz tę rzecz?" })).toBeInTheDocument();
    expect(currentUrl()).toBe("/ania/product/9");
    expect(itemActionsApi.getItemActions).toHaveBeenCalledWith("9");
  });

  it("anonymous: a non-public item (404) sends the visitor to login with returnTo, query kept", async () => {
    mockAuth.token = null;
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt("/ania/product/9?event=ev-1");

    await waitFor(() => expect(currentUrl()).toBe("/login?returnTo=%2Fania%2Fproduct%2F9%3Fevent%3Dev-1"));
  });

  it("shows a neutral loader while the organization is pending, item fetch already started", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockReturnValue(new Promise(() => {}));
    const { container } = renderAt("/ania/product/9");

    expect(screen.getByText("Wczytywanie rzeczy…")).toBeInTheDocument();
    expect(container.querySelector("[data-organizer-theme]")).toBeNull();
    await waitFor(() => expect(itemsApi.getItemDetails).toHaveBeenCalledWith("9"));
    expect(screen.queryByText("Rowerek biegowy")).not.toBeInTheDocument();
  });

  it("renders the item in the organizer palette", async () => {
    renderAt("/ania/product/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    const scope = scopeOf(heading);
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe("#7a2a4f");
    expect(screen.getByRole("link", { name: /Edytuj/ })).toBeInTheDocument();
  });

  it("falls back to the default palette when the organization is unknown", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt("/ania/product/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    expect(scopeOf(heading)).toHaveAttribute("data-organizer-theme", "default");
  });

  it("Edytuj links the owner to the panel edit page", async () => {
    renderAt("/ania/product/9");

    expect(await screen.findByRole("link", { name: /Edytuj/ })).toHaveAttribute("href", "/items/9/edit");
  });

  it("Wróć on a direct entry goes to the organizer page", async () => {
    renderAt("/ania/product/9");

    await screen.findByRole("heading", { name: "Rowerek biegowy" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(currentUrl()).toBe("/ania");
  });

  it("bare /:slug/product redirects to the organizer page without fetching an item", () => {
    renderAt("/ania/product");

    expect(currentUrl()).toBe("/ania");
    expect(itemsApi.getItemDetails).not.toHaveBeenCalled();
  });
});
