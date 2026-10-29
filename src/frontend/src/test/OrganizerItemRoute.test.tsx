import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/AuthGuard";
import * as itemsApi from "../api/items";
import * as organizationsApi from "../api/organizations";
import { ApiError } from "../api/client";
import type { ItemDetailsResponse } from "../api/items";
import { ItemDetailBody } from "../pages/product/ItemDetailPage";
import { OrganizerItemLayout } from "../pages/product/OrganizerItemLayout";
import { createQueryWrapper } from "./queryClient";

const mockAuth: { token: string | null } = { token: "valid.jwt.token" };

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
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
    description: "Lekki, aluminiowy.",
    photos: [],
    product_photo_url: null,
    is_owner: true,
    deleted_at: null,
    status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null },
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:organizationSlug/product" element={<Navigate to=".." relative="path" replace />} />
        <Route
          path="/:organizationSlug/product/:id"
          element={
            <AuthGuard>
              <OrganizerItemLayout />
            </AuthGuard>
          }
        >
          <Route index element={<ItemDetailBody />} />
          <Route path="edit" element={<Navigate to="..?edit=1" relative="path" replace />} />
        </Route>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
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
  });

  it("sends an anonymous visitor to login with returnTo", () => {
    mockAuth.token = null;
    renderAt("/ania/product/9");

    expect(screen.getByTestId("where")).toHaveTextContent("/login?returnTo=%2Fania%2Fproduct%2F9");
    expect(itemsApi.getItemDetails).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: /Edytuj/ })).toBeInTheDocument();
  });

  it("falls back to the default palette when the organization is unknown", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt("/ania/product/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    expect(scopeOf(heading)).toHaveAttribute("data-organizer-theme", "default");
  });

  it("the old edit address opens edit mode in place, inside the organizer prefix", async () => {
    renderAt("/ania/product/9/edit");

    expect(await screen.findByRole("form", { name: "Edycja rzeczy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(await screen.findByRole("heading", { name: "Rowerek biegowy" })).toBeInTheDocument();
  });

  it("a non-owner on the edit address sees the organizer view without edit controls", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    renderAt("/ania/product/9/edit");

    expect(await screen.findByRole("heading", { name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj/ })).not.toBeInTheDocument();
  });

  it("Wróć on a direct entry goes to the organizer page", async () => {
    renderAt("/ania/product/9");

    await screen.findByRole("heading", { name: "Rowerek biegowy" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/ania$/);
  });

  it("Wróć on a direct entry under a fallback k- slug goes to the panel items list", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt("/k-0123456789ab/product/9");

    await screen.findByRole("heading", { name: "Rowerek biegowy" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/items$/);
  });

  it("bare /:slug/product redirects to the organizer page without fetching an item", () => {
    renderAt("/ania/product");

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/ania$/);
    expect(itemsApi.getItemDetails).not.toHaveBeenCalled();
  });
});
