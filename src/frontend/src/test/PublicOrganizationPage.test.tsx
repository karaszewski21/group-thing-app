import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as organizationsApi from "../api/organizations";
import { PublicOrganizationPage } from "../pages/PublicOrganizationPage";
import { buildOrgThemeVars } from "../theme/orgPalette";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:organizationSlug" element={<PublicOrganizationPage />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

function themeScope(element: HTMLElement): HTMLElement {
  const scope = element.closest<HTMLElement>("[data-organizer-theme]");
  if (!scope) throw new Error("no OrganizerThemeScope around the element");
  return scope;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PublicOrganizationPage", () => {
  it("renders the organization's name for an existing slug", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "muzyczne-skrzaty",
      name: "Muzyczne Skrzaty",
      primary_color: "#1b8168",
      accent_color: "#a9c24f",
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

  it("renders the organization in its generated palette with a themed badge", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "studio-ania",
      name: "Studio Ania",
      primary_color: "#7a1f3d",
      accent_color: "#d4a017",
    });

    renderAt("/studio-ania");

    const name = await screen.findByText("Studio Ania");
    const scope = themeScope(name);
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe(
      buildOrgThemeVars("#7a1f3d", "#d4a017")["--color-primary"],
    );
    const badge = screen.getByText("Organizacja");
    expect(badge).toHaveClass("bg-accent-soft", "text-accent-fg");
  });

  it("falls back to the default palette for an accent-only organization", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "tylko-akcent",
      name: "Tylko Akcent",
      primary_color: null,
      accent_color: "#d4a017",
    });

    renderAt("/tylko-akcent");

    const name = await screen.findByText("Tylko Akcent");
    expect(themeScope(name)).toHaveAttribute("data-organizer-theme", "default");
  });
});
