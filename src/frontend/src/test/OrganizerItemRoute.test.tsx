import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/AuthGuard";
import * as itemsApi from "../api/items";
import * as organizationsApi from "../api/organizations";
import { ApiError } from "../api/client";
import type { ItemDetailsResponse } from "../api/items";
import { ItemDetailBody } from "../pages/product/ItemDetailPage";
import { ItemEditBody } from "../pages/product/ItemEditPage";
import { OrganizerItemLayout } from "../pages/product/OrganizerItemLayout";
import { createQueryWrapper } from "./queryClient";

const mockAuth: { token: string | null } = { token: "valid.jwt.token" };

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
  getItemHistory: vi.fn(),
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
};

function details(overrides: Partial<ItemDetailsResponse> = {}): ItemDetailsResponse {
  return {
    id: "9",
    product_id: "p-1",
    name: "Rowerek biegowy",
    category_id: null,
    category_name: "Zabawki",
    condition: "GOOD",
    description: "Lekki, aluminiowy.",
    photos: [],
    product_photo_url: null,
    is_owner: true,
    deleted_at: null,
    status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null },
    ...overrides,
  } as ItemDetailsResponse;
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:organizationSlug/produkt" element={<Navigate to=".." relative="path" replace />} />
        <Route
          path="/:organizationSlug/produkt/:id"
          element={
            <AuthGuard>
              <OrganizerItemLayout />
            </AuthGuard>
          }
        >
          <Route index element={<ItemDetailBody />} />
          <Route path="edit" element={<ItemEditBody />} />
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
    vi.mocked(itemsApi.getItemHistory).mockResolvedValue([]);
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
  });

  it("sends an anonymous visitor to login with returnTo", () => {
    mockAuth.token = null;
    renderAt("/ania/produkt/9");

    expect(screen.getByTestId("where")).toHaveTextContent("/login?returnTo=%2Fania%2Fprodukt%2F9");
    expect(itemsApi.getItemDetails).not.toHaveBeenCalled();
  });

  it("shows a neutral loader while the organization is pending, item fetch already started", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockReturnValue(new Promise(() => {}));
    const { container } = renderAt("/ania/produkt/9");

    expect(screen.getByText("Wczytywanie rzeczy…")).toBeInTheDocument();
    expect(container.querySelector("[data-organizer-theme]")).toBeNull();
    await waitFor(() => expect(itemsApi.getItemDetails).toHaveBeenCalledWith("9"));
    expect(screen.queryByText("Rowerek biegowy")).not.toBeInTheDocument();
  });

  it("renders the item in the organizer palette without the panel nav", async () => {
    const { container } = renderAt("/ania/produkt/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    const scope = scopeOf(heading);
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe("#7a2a4f");
    expect(container.querySelector('nav[aria-label="Nawigacja panelu"]')).toBeNull();
    expect(screen.getByRole("link", { name: /Edytuj/ })).toHaveAttribute("href", "/ania/produkt/9/edit");
  });

  it("falls back to the default palette when the organization is unknown", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt("/ania/produkt/9");

    const heading = await screen.findByRole("heading", { name: "Rowerek biegowy" });
    expect(scopeOf(heading)).toHaveAttribute("data-organizer-theme", "default");
  });

  it("edit page links back inside the organizer prefix", async () => {
    renderAt("/ania/produkt/9/edit");

    expect(await screen.findByRole("heading", { name: "Edycja rzeczy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gotowe" })).toHaveAttribute("href", "/ania/produkt/9");
    expect(screen.getByRole("link", { name: /Wróć do podglądu/ })).toHaveAttribute("href", "/ania/produkt/9");
  });

  it("redirects a non-owner from edit to the organizer view", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    renderAt("/ania/produkt/9/edit");

    expect(await screen.findByRole("heading", { name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
  });

  it("Wróć on a direct entry goes to the organizer page", async () => {
    renderAt("/ania/produkt/9");

    await screen.findByRole("heading", { name: "Rowerek biegowy" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/ania$/);
  });

  it("Wróć on a direct entry under a fallback k- slug goes to the panel items list", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt("/k-0123456789ab/produkt/9");

    await screen.findByRole("heading", { name: "Rowerek biegowy" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/panel\/rzeczy$/);
  });

  it("bare /:slug/produkt redirects to the organizer page without fetching an item", () => {
    renderAt("/ania/produkt");

    expect(screen.getByTestId("where")).toHaveTextContent(/^\/ania$/);
    expect(itemsApi.getItemDetails).not.toHaveBeenCalled();
  });
});
