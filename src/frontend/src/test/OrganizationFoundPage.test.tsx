import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import { OrganizationFoundPage } from "../features/organization-public/OrganizationFoundPage";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

const reloadPanel = vi.fn();
vi.mock("../features/panel/appDataStore", () => ({ usePanelReload: () => reloadPanel }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok" }) }));

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
  createMyOrganization: vi.fn(),
}));

const ORGANIZATION: organizationsApi.MyOrganizationResponse = {
  id: "7",
  party_id: "3",
  name: "Muzyczne Skrzaty",
  slug: "muzyczne-skrzaty",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  description: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  media: [],
};

function renderPage() {
  return renderWithRoute(<OrganizationFoundPage />, {
    url: "/organization",
    pattern: "/organization",
    routes: {
      "/:slug": <p>Strona organizacji</p>,
      "/:slug/appearance": <p>Wygląd strony</p>,
    },
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("OrganizationFoundPage", () => {
  it("sends an existing owner to the name tab of their page's appearance", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(ORGANIZATION);
    renderPage();

    await waitFor(() =>
      expect(getTestLocation()).toEqual({ pathname: "/muzyczne-skrzaty/appearance", search: "?tab=name" }),
    );
    expect(getTestRouter().calls.at(-1)).toMatchObject({ method: "replace" });
  });

  it("founds an organization from the typed name, reloads the panel and opens its page", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    vi.mocked(organizationsApi.createMyOrganization).mockResolvedValue(ORGANIZATION);
    renderPage();

    const name = await screen.findByLabelText("Nazwa organizacji");
    const submit = screen.getByRole("button", { name: "Załóż organizację" });
    expect(submit).toBeDisabled();
    fireEvent.change(name, { target: { value: "Muzyczne Skrzaty" } });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(ORGANIZATION);
    fireEvent.click(submit);

    await waitFor(() => expect(getTestLocation().pathname).toBe("/muzyczne-skrzaty"));
    expect(organizationsApi.createMyOrganization).toHaveBeenCalledWith({ name: "Muzyczne Skrzaty" });
    expect(reloadPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps the form with the server's message when the name is rejected", async () => {
    const rejection = "Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    vi.mocked(organizationsApi.createMyOrganization).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText("Nazwa organizacji"), { target: { value: "Zła nazwa" } });
    fireEvent.click(screen.getByRole("button", { name: "Załóż organizację" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Nazwa organizacji")).toHaveValue("Zła nazwa");
    expect(getTestLocation().pathname).toBe("/organization");
    expect(reloadPanel).not.toHaveBeenCalled();
  });
});
