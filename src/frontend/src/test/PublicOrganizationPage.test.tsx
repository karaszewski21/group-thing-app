import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import * as organizationsApi from "../api/organizations";
import { PublicOrganizationPage } from "../pages/organizer/PublicOrganizationPage";
import { buildOrgThemeVars } from "../theme/orgPalette";
import { findPreset } from "../theme/palettePresets";
import { createQueryWrapper } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
  getMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

// A data router: once open, the editor sheet guards navigation with useBlocker.
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/:organizationSlug",
        element: (
          <>
            <PublicOrganizationPage />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />, { wrapper: createQueryWrapper() });
}

function themeScope(element: HTMLElement): HTMLElement {
  const scope = element.closest<HTMLElement>("[data-organizer-theme]");
  if (!scope) throw new Error("no OrganizerThemeScope around the element");
  return scope;
}

const ORGANIZATION = {
  slug: "muzyczne-skrzaty",
  name: "Muzyczne Skrzaty",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
};

const MY_ORGANIZATION = {
  id: "org-1",
  party_id: "party-1",
  name: "Muzyczne Skrzaty",
  slug: "muzyczne-skrzaty",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: null };
});

describe("PublicOrganizationPage", () => {
  it("renders the organization's name for an existing slug", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "muzyczne-skrzaty",
      name: "Muzyczne Skrzaty",
      primary_color: "#1b8168",
      accent_color: "#a9c24f",
      page_layout: "CLASSIC",
      palette_preset: null,
    });

    renderAt("/muzyczne-skrzaty");

    expect(await screen.findByText("Muzyczne Skrzaty")).toBeInTheDocument();
    expect(organizationsApi.getPublicOrganization).toHaveBeenCalledWith("muzyczne-skrzaty");
  });

  it("shows a not-found message for an unknown slug", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new Error("404"));

    renderAt("/does-not-exist");

    expect(await screen.findByText("Nie znaleziono strony")).toBeInTheDocument();
  });

  it("renders the organization in its generated palette through the layout renderer", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "studio-ania",
      name: "Studio Ania",
      primary_color: "#7a1f3d",
      accent_color: "#d4a017",
      page_layout: "CLASSIC",
      palette_preset: null,
    });

    renderAt("/studio-ania");

    const name = await screen.findByText("Studio Ania");
    const scope = themeScope(name);
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe(
      buildOrgThemeVars("#7a1f3d", "#d4a017")["--color-primary"],
    );
    expect(screen.getByRole("heading", { level: 1, name: "Studio Ania" })).toBeInTheDocument();
    expect(screen.queryByText("Organizacja")).not.toBeInTheDocument();
  });

  it("falls back to the default palette for an accent-only organization", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "tylko-akcent",
      name: "Tylko Akcent",
      primary_color: null,
      accent_color: "#d4a017",
      page_layout: "CLASSIC",
      palette_preset: null,
    });

    renderAt("/tylko-akcent");

    const name = await screen.findByText("Tylko Akcent");
    expect(themeScope(name)).toHaveAttribute("data-organizer-theme", "default");
  });

  it("shows a visitor the hero and share button without owner chrome", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);

    renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Udostępnij/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj wygląd/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Opis — wkrótce")).not.toBeInTheDocument();
    expect(organizationsApi.getMyOrganization).not.toHaveBeenCalled();
  });

  it("ignores ?edit=1 for a logged-in non-owner", async () => {
    mockAuth = { token: "other-token" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, slug: "inna-org" });

    renderAt("/muzyczne-skrzaty?edit=1");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    await vi.waitFor(() => expect(organizationsApi.getMyOrganization).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj wygląd/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Opis — wkrótce")).not.toBeInTheDocument();
  });

  it("shows the plain visitor page with ?edit=1 when the owner check fails", async () => {
    mockAuth = { token: "owner-token" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("network"));

    renderAt("/muzyczne-skrzaty?edit=1");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    await vi.waitFor(() => expect(organizationsApi.getMyOrganization).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj wygląd/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Opis — wkrótce")).not.toBeInTheDocument();
  });

  it("shows the owner the ghost and the Edytuj wygląd pill, which opens edit mode", async () => {
    mockAuth = { token: "owner-token" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(MY_ORGANIZATION);

    renderAt("/muzyczne-skrzaty");

    const pill = await screen.findByRole("button", { name: "Edytuj wygląd" });
    expect(screen.getByText("Opis — wkrótce")).toBeInTheDocument();
    const scope = themeScope(pill);
    expect(scope).toContainElement(screen.getByText("Opis — wkrótce"));

    fireEvent.click(pill);

    expect(screen.getByTestId("location")).toHaveTextContent("/muzyczne-skrzaty?edit=1");
    expect(screen.queryByRole("button", { name: "Edytuj wygląd" })).not.toBeInTheDocument();
  });

  it("applies a stored palette preset to the theme scope", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      ...ORGANIZATION,
      palette_preset: "OCEAN",
    });

    renderAt("/muzyczne-skrzaty");

    const name = await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    const scope = themeScope(name);
    const ocean = findPreset("OCEAN");
    expect(ocean).toBeDefined();
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe(ocean?.vars["--color-primary"]);
    expect(scope.style.getPropertyValue("--color-cream")).toBe(ocean?.vars["--color-cream"]);
  });
});
