import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import { buildOrgThemeVars } from "../theme/orgPalette";
import { findPreset } from "../theme/palettes";
import { ownerRouteElement } from "./itemRoute";
import { classicLayout } from "./organizationLayoutFixtures";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
  getMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  getOrganizationLayout: vi.fn(),
}));

async function renderAt(path: string) {
  return renderWithRoute(await ownerRouteElement(path), {
    url: path,
    pattern: "/:slug",
    wrapper: createQueryWrapper(),
  });
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
  description: null,
  logo: null,
  avatar: null,
  cover: null,
  gallery: [],
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
  description: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  media: [],
};

const DIRECTORY = classicLayout();

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: null };
  vi.mocked(organizationsApi.getOrganizationLayout).mockResolvedValue(DIRECTORY);
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
      description: null,
      logo: null,
      avatar: null,
      cover: null,
      gallery: [],
    });

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByText("Muzyczne Skrzaty")).toBeInTheDocument();
    expect(organizationsApi.getPublicOrganization).toHaveBeenCalledWith("muzyczne-skrzaty");
  });

  it("shows a not-found message for an unknown slug", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));

    await renderAt("/does-not-exist");

    expect(await screen.findByText("Nie znaleziono strony")).toBeInTheDocument();
    expect(screen.getByText("Ta organizacja nie istnieje.")).toBeInTheDocument();
  });

  it("a failed read shows the error with a retry that fetches again", async () => {
    vi.mocked(organizationsApi.getPublicOrganization)
      .mockRejectedValueOnce(new ApiError(500, "Server Error", null))
      .mockResolvedValue(ORGANIZATION);

    await renderAt("/muzyczne-skrzaty");

    fireEvent.click(await screen.findByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
  });

  it("renders the organization in its generated palette through the layout renderer", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      slug: "studio-ania",
      name: "Studio Ania",
      primary_color: "#7a1f3d",
      accent_color: "#d4a017",
      page_layout: "CLASSIC",
      palette_preset: null,
      description: null,
      logo: null,
      avatar: null,
      cover: null,
      gallery: [],
    });

    await renderAt("/studio-ania");

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
      description: null,
      logo: null,
      avatar: null,
      cover: null,
      gallery: [],
    });

    await renderAt("/tylko-akcent");

    const name = await screen.findByText("Tylko Akcent");
    expect(themeScope(name)).toHaveAttribute("data-organizer-theme", "default");
  });

  it("shows a visitor the hero and share button without owner chrome", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.queryByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.")).not.toBeInTheDocument();
    expect(organizationsApi.getMyOrganization).not.toHaveBeenCalled();
  });

  it("shows no settings link to a logged-in non-owner", async () => {
    mockAuth = { token: "other-token" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, slug: "inna-org" });

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    await vi.waitFor(() => expect(organizationsApi.getMyOrganization).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.queryByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.")).not.toBeInTheDocument();
  });

  it("shows the plain visitor page when the owner check fails", async () => {
    mockAuth = { token: "owner-token" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("network"));

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    await vi.waitFor(() => expect(organizationsApi.getMyOrganization).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.queryByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.")).not.toBeInTheDocument();
  });

  it("shows the owner the ghost and the Ustawienia link to Wygląd strony", async () => {
    mockAuth = { token: "owner-token" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(MY_ORGANIZATION);

    await renderAt("/muzyczne-skrzaty");

    const settings = await screen.findByRole("link", { name: "Ustawienia" });
    expect(screen.getByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.")).toBeInTheDocument();
    const scope = themeScope(settings);
    expect(scope).toContainElement(screen.getByText("Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty."));
    expect(settings).toHaveAttribute("href", "/muzyczne-skrzaty/appearance");
  });

  it("keeps the hero and share when the layout request fails", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getOrganizationLayout).mockRejectedValue(new Error("500"));

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledWith("muzyczne-skrzaty", "CLASSIC"),
    );
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
  });

  it("reads the data of the organization's own layout", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, page_layout: "EXCHANGE" });

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledWith("muzyczne-skrzaty", "EXCHANGE"),
    );
    expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledTimes(1);
  });

  it("paints the page from the organization alone while the layout data is pending", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(organizationsApi.getOrganizationLayout).mockReturnValue(new Promise(() => {}));

    await renderAt("/muzyczne-skrzaty");

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.queryByText("Wczytywanie…")).not.toBeInTheDocument();
  });

  it("applies a stored palette preset to the theme scope", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({
      ...ORGANIZATION,
      palette_preset: "OCEAN",
      description: null,
      logo: null,
      avatar: null,
      cover: null,
      gallery: [],
    });

    await renderAt("/muzyczne-skrzaty");

    const name = await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    const scope = themeScope(name);
    const ocean = findPreset("OCEAN");
    expect(ocean).toBeDefined();
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe(ocean?.vars["--color-primary"]);
    expect(scope.style.getPropertyValue("--color-cream")).toBe(ocean?.vars["--color-cream"]);
  });
});
