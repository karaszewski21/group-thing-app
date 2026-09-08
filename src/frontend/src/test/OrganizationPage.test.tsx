import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as organizationsApi from "../api/organizations";
import { OrganizationPage } from "../pages/OrganizationPage";

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
  createMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

const mockOrganization: organizationsApi.OrganizationResponse = {
  id: 7,
  party_id: 3,
  name: "Muzyczne Skrzaty",
  slug: "muzyczne-skrzaty",
  primary_color: "#1b8168",
  accent_color: "#a9c24f",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <OrganizationPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("OrganizationPage", () => {
  it("loads and pre-fills the existing organization's name", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(mockOrganization);
    renderPage();

    expect(await screen.findByDisplayValue("Muzyczne Skrzaty")).toBeInTheDocument();
  });

  it("when no organization exists yet (404), starts with an empty form and creates one on save", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
    vi.mocked(organizationsApi.createMyOrganization).mockResolvedValue({
      ...mockOrganization,
      id: 9,
      primary_color: null,
      accent_color: null,
    });
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(mockOrganization);
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Nazwa organizacji")).toHaveValue("");
    });

    fireEvent.change(screen.getByLabelText("Nazwa organizacji"), {
      target: { value: "Nowa Organizacja" },
    });
    fireEvent.click(screen.getByRole("button", { name: /zapisz/i }));

    await waitFor(() => {
      expect(organizationsApi.createMyOrganization).toHaveBeenCalledWith({ name: "Nowa Organizacja" });
    });
  });

  it("shows a link to the public organization page using its slug", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(mockOrganization);
    renderPage();

    const link = await screen.findByRole("link", { name: /muzyczne-skrzaty/ });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty");
  });

  it("saving an existing organization calls updateOrganization with only the name (no color fields — form was simplified)", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(mockOrganization);
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(mockOrganization);
    renderPage();

    await screen.findByDisplayValue("Muzyczne Skrzaty");
    fireEvent.click(screen.getByRole("button", { name: /zapisz/i }));

    await waitFor(() => {
      expect(organizationsApi.updateOrganization).toHaveBeenCalledWith(7, { name: "Muzyczne Skrzaty" });
    });
  });

  it("does not render color-picker fields (form is name-only)", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(mockOrganization);
    renderPage();

    await screen.findByDisplayValue("Muzyczne Skrzaty");
    expect(screen.queryByLabelText("Kolor główny")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Kolor dodatkowy")).not.toBeInTheDocument();
  });
});
