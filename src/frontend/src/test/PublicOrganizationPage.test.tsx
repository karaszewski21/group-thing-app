import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as organizationsApi from "../api/organizations";
import { PublicOrganizationPage } from "../pages/PublicOrganizationPage";

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
  );
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
});
