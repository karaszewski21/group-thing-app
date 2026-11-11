import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as mediaApi from "../api/media";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
import * as organizationsApi from "../api/organizations";
import { findPreset } from "../theme/palettes";
import { appearanceRouteElement } from "./itemRoute";
import { layoutStats, linksLayout } from "./organizationLayoutFixtures";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
  getMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  getOrganizationLayout: vi.fn(),
}));

vi.mock("../api/media", () => ({
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  reorderGallery: vi.fn(),
}));

function currentUrl() {
  const { pathname, search } = getTestLocation();
  return pathname + search;
}

const EDITOR = "/muzyczne-skrzaty/appearance";

/** `/:slug/appearance` through its route files (page, not-found, error). */
async function renderAt(path: string) {
  renderWithRoute(await appearanceRouteElement(path), {
    url: path,
    pattern: "/:slug/appearance",
    routes: { "/home": <p>Panel</p>, "/login": <p>Logowanie</p> },
    wrapper: createQueryWrapper(),
  });
  return getTestRouter();
}

const ORGANIZATION: organizationsApi.PublicOrganizationResponse = {
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

const MY_ORGANIZATION: organizationsApi.MyOrganizationResponse = {
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

const DIRECTORY = linksLayout();

const BUSY_DIRECTORY = linksLayout({ stats: layoutStats({ group_count: 2, meeting_count: 4 }) });

function textOfIds(ids: string | null) {
  return (ids ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** Names of the layout cards whose accessible description announces "Polecany", in card order. */
function recommendedLayouts() {
  return within(screen.getByRole("radiogroup", { name: "Układ strony" }))
    .getAllByRole("radio")
    .filter((card) => textOfIds(card.getAttribute("aria-describedby")).startsWith("Polecany"))
    .map((card) => textOfIds(card.getAttribute("aria-labelledby")));
}

/** Opens the page on "Układ i kolor", where most of these tests work. */
async function openEditor() {
  const router = await renderAt(`${EDITOR}?tab=layout`);
  await screen.findByRole("radio", { name: "Klasyczny" });
  return { router };
}

/** The draft theme's scope around the editor. */
function themeScope() {
  return screen.getByRole("tablist", { name: "Ustawienia strony" }).closest("[data-organizer-theme]") as HTMLElement;
}

function chooseLinks() {
  fireEvent.click(screen.getByRole("radio", { name: "Wizytówka" }));
}

async function expectSaved() {
  expect(await screen.findByRole("status")).toHaveTextContent("Zapisano");
  expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  expect(currentUrl()).toBe(`${EDITOR}?tab=layout`);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "owner-token" };
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
  vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(MY_ORGANIZATION);
  vi.mocked(organizationsApi.getOrganizationLayout).mockResolvedValue(DIRECTORY);
});

describe("Wygląd strony page", () => {
  it("opens the requested tab inside the draft theme scope with the stored layout checked", async () => {
    await openEditor();

    expect(themeScope()).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Układ i kolor" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: "Klasyczny" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: "Zobacz stronę →" })).toHaveAttribute("href", "/muzyczne-skrzaty");
  });

  it("is not found for a caller without an Organization", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    await renderAt(EDITOR);

    expect(await screen.findByText("Tej strony nie możesz edytować.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("is not found on another Organization's page", async () => {
    await renderAt("/inna-organizacja/appearance");

    expect(await screen.findByText("Tej strony nie możesz edytować.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("sends a visitor without a session to log in and come back", async () => {
    mockAuth = { token: null };
    await renderAt(EDITOR);

    await vi.waitFor(() => expect(getTestLocation().pathname).toBe("/login"));
    expect(new URLSearchParams(getTestLocation().search).get("returnTo")).toBe(EDITOR);
    expect(organizationsApi.getMyOrganization).not.toHaveBeenCalled();
  });

  it("shows the load error with a retry that reads the organization again", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(500, "Server Error", null));
    await renderAt(EDITOR);

    expect(await screen.findByText(/Nie udało się wczytać ustawień strony\./)).toBeInTheDocument();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(MY_ORGANIZATION);
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("tablist", { name: "Ustawienia strony" })).toBeInTheDocument();
  });

  it("Anuluj drops a chosen layout and disables Zapisz again", async () => {
    await openEditor();

    chooseLinks();
    expect(screen.getByRole("radio", { name: "Wizytówka" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.getByRole("radio", { name: "Klasyczny" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("saves only the changed layout and stays on the page", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue({ ...MY_ORGANIZATION, page_layout: "LINKS" });
    await openEditor();
    chooseLinks();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, page_layout: "LINKS" });

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await expectSaved();
    expect(organizationsApi.updateOrganization).toHaveBeenCalledTimes(1);
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { page_layout: "LINKS" });
    expect(screen.getByRole("radio", { name: "Wizytówka" })).toHaveAttribute("aria-checked", "true");
  });

  it("blocks leaving with a dirty draft: Wróć do edycji keeps it, Odrzuć leaves", async () => {
    const { router } = await openEditor();
    chooseLinks();

    await act(() => router.navigate("/home"));

    const confirm = screen.getByRole("alertdialog", { name: "Odrzucić zmiany?" });
    expect(confirm.closest("[data-organizer-theme]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Wróć do edycji" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Wróć do edycji" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Panel")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Wizytówka" })).toHaveAttribute("aria-checked", "true");

    await act(() => router.navigate("/home"));
    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));

    expect(await screen.findByText("Panel")).toBeInTheDocument();
  });

  it("switching tabs with a dirty draft is never blocked", async () => {
    await openEditor();
    chooseLinks();

    fireEvent.click(screen.getByRole("tab", { name: "Zdjęcia i opis" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(currentUrl()).toBe(`${EDITOR}?tab=photos`);
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeEnabled();
  });

  it("locks the tab panel while saving", async () => {
    let finishSave!: () => void;
    vi.mocked(organizationsApi.updateOrganization).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve({ ...MY_ORGANIZATION, page_layout: "LINKS" });
        }),
    );
    await openEditor();
    chooseLinks();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(screen.getByRole("radio", { name: "Klasyczny" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, page_layout: "LINKS" });
    await act(async () => finishSave());

    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { page_layout: "LINKS" });
    await expectSaved();
  });

  it("shows a failed save as an alert, keeps the draft and refetches the organization", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, message: "Conflict" }),
    );
    await openEditor();
    chooseLinks();
    const callsBeforeSave = vi.mocked(organizationsApi.getMyOrganization).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie.",
    );
    expect(vi.mocked(organizationsApi.getMyOrganization).mock.calls.length).toBeGreaterThan(callsBeforeSave);
    expect(screen.getByRole("radio", { name: "Wizytówka" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: "Klasyczny" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks Spotkania as Polecany for four upcoming meetings, reading only the LINKS stats", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockResolvedValue(BUSY_DIRECTORY);
    await openEditor();

    await vi.waitFor(() => expect(recommendedLayouts()).toEqual(["Spotkania"]));
    expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledWith("muzyczne-skrzaty", "LINKS");
    expect(within(screen.getByRole("radiogroup", { name: "Układ strony" })).getAllByRole("radio")).toHaveLength(4);
  });

  it("marks only the Wizytówka layout as Polecany for an organizer without meetings or items", async () => {
    await openEditor();

    await vi.waitFor(() => expect(recommendedLayouts()).toEqual(["Wizytówka"]));
  });

  it("shows no Polecany badge while the stats are loading", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockReturnValue(new Promise(() => {}));
    await openEditor();

    expect(recommendedLayouts()).toEqual([]);
    expect(screen.queryByText("Polecany")).not.toBeInTheDocument();
  });

  it("marks only the Wizytówka layout as Polecany when the stats are unavailable", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockRejectedValue(
      new ApiError(500, "Server Error", { status: 500, message: "Server Error" }),
    );
    await openEditor();

    await vi.waitFor(() => expect(recommendedLayouts()).toEqual(["Wizytówka"]));
  });

  it("shows ACCESS_DENIED_MESSAGE when the save is forbidden", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockRejectedValue(
      new ApiError(403, "Forbidden", { status: 403, message: "You do not own this Organization" }),
    );
    await openEditor();
    chooseLinks();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ACCESS_DENIED_MESSAGE);
  });
});

describe("Wygląd strony colors", () => {
  const OCEAN = findPreset("OCEAN")!;

  async function openColors() {
    const opened = await openEditor();
    return { ...opened, palettes: screen.getByRole("radiogroup", { name: "Paleta kolorów" }) };
  }

  it("renders 10 palette tiles with Mięta first and no custom tile, preview or reset link", async () => {
    const { palettes } = await openColors();

    const tiles = within(palettes).getAllByRole("radio");
    expect(tiles).toHaveLength(10);
    expect(tiles[0]).toHaveAccessibleName("Mięta (domyślna)");
    expect(tiles[0]).toHaveAttribute("aria-checked", "true");
    expect(tiles[1]).toHaveAccessibleName("Ocean");
    expect(within(palettes).queryByRole("radio", { name: "Własny" })).not.toBeInTheDocument();

    expect(screen.queryByText("Podgląd")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Podgląd/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Przywróć domyślne" })).not.toBeInTheDocument();
  });

  it("previews a chosen preset on the editor and saves its key with its base colors", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(MY_ORGANIZATION);
    const { palettes } = await openColors();

    fireEvent.click(within(palettes).getByRole("radio", { name: "Ocean" }));

    expect(within(palettes).getByRole("radio", { name: "Ocean" })).toHaveAttribute("aria-checked", "true");
    expect(themeScope().style.getPropertyValue("--color-primary")).toBe(OCEAN.vars["--color-primary"]);
    expect(themeScope().style.getPropertyValue("--color-accent-soft")).toBe(OCEAN.vars["--color-accent-soft"]);

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await vi.waitFor(() =>
      expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", {
        palette_preset: "OCEAN",
        primary_color: OCEAN.vars["--color-primary"],
        accent_color: OCEAN.vars["--color-accent"],
      }),
    );
  });

  it("restores the default palette from a preset with three explicit nulls", async () => {
    const oceanTheme = {
      palette_preset: "OCEAN",
      primary_color: OCEAN.vars["--color-primary"],
      accent_color: OCEAN.vars["--color-accent"],
    };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, ...oceanTheme });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, ...oceanTheme });
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(MY_ORGANIZATION);
    const { palettes } = await openColors();
    expect(within(palettes).getByRole("radio", { name: "Ocean" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(palettes).getByRole("radio", { name: "Mięta (domyślna)" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await vi.waitFor(() =>
      expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", {
        palette_preset: null,
        primary_color: null,
        accent_color: null,
      }),
    );
  });

  it("checks no tile for a stored custom theme and keeps the first tile reachable by Tab", async () => {
    const customTheme = { palette_preset: null, primary_color: "#7A2A4F", accent_color: "#D4A017" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, ...customTheme });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, ...customTheme });
    const { palettes } = await openColors();

    const tiles = within(palettes).getAllByRole("radio");
    expect(tiles.filter((tile) => tile.getAttribute("aria-checked") === "true")).toHaveLength(0);
    expect(tiles[0]).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("textbox", { name: "Kolor główny *" })).not.toBeInTheDocument();
  });
});

describe("Wygląd strony photos and description", () => {
  const JPEG = new File(["x"], "logo.jpg", { type: "image/jpeg" });

  function tab(name: string) {
    return screen.getByRole("tab", { name });
  }

  it("opens on Zdjęcia i opis by default, with the photos and the description together", async () => {
    await renderAt(EDITOR);
    await screen.findByRole("region", { name: "Logo" });

    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Zdjęcia i opis");
    expect(screen.getByRole("textbox", { name: "O nas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
  });

  it("falls back to Zdjęcia i opis for an unknown tab value", async () => {
    await renderAt(`${EDITOR}?tab=nieznana`);
    await screen.findByRole("region", { name: "Logo" });

    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");
  });

  it("uploads a photo right away without making the draft dirty", async () => {
    vi.mocked(mediaApi.uploadMedia).mockResolvedValue({
      id: "m-1",
      kind: "LOGO",
      status: "PENDING",
      url: "https://cdn/m-1",
      thumb_url: "https://cdn/m-1-t",
      sort_order: 0,
    });
    const router = await renderAt(`${EDITOR}?tab=photos`);
    const logo = within(await screen.findByRole("region", { name: "Logo" }));

    fireEvent.change(logo.getByLabelText("Dodaj logo"), { target: { files: [JPEG] } });

    await vi.waitFor(() =>
      expect(mediaApi.uploadMedia).toHaveBeenCalledWith({ kind: "organization", organizationId: "org-1" }, "LOGO", JPEG),
    );
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();

    await act(() => router.navigate("/home"));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Panel")).toBeInTheDocument();
  });

  it("moves roving focus across the three pills with the arrow keys, wrapping around", async () => {
    await openEditor();

    fireEvent.keyDown(tab("Układ i kolor"), { key: "ArrowRight" });
    expect(tab("Nazwa")).toHaveFocus();
    expect(tab("Nazwa")).toHaveAttribute("aria-selected", "true");
    expect(tab("Nazwa")).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(tab("Nazwa"), { key: "ArrowRight" });
    expect(tab("Zdjęcia i opis")).toHaveFocus();
    fireEvent.keyDown(tab("Zdjęcia i opis"), { key: "ArrowLeft" });
    expect(tab("Nazwa")).toHaveFocus();
  });

  it("saves the typed description trimmed", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue({ ...MY_ORGANIZATION, description: "Śpiewamy." });
    await renderAt(`${EDITOR}?tab=photos`);
    const textarea = await screen.findByRole("textbox", { name: "O nas" });

    fireEvent.change(textarea, { target: { value: "  Śpiewamy.  " } });
    expect(screen.getByText("13/1000")).toBeInTheDocument();

    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, description: "Śpiewamy." });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano");
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { description: "Śpiewamy." });
  });
});

describe("Wygląd strony name", () => {
  async function openName() {
    await renderAt(`${EDITOR}?tab=name`);
    return screen.findByRole("textbox", { name: "Nazwa organizacji" });
  }

  it("renames the organization with only the trimmed name", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue({ ...MY_ORGANIZATION, name: "Skrzaty" });
    const name = await openName();
    expect(name).toHaveValue("Muzyczne Skrzaty");

    fireEvent.change(name, { target: { value: "  Skrzaty " } });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, name: "Skrzaty" });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano");
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { name: "Skrzaty" });
  });

  it("blocks Zapisz with an inline error while the name is blank", async () => {
    const name = await openName();

    fireEvent.change(name, { target: { value: "   " } });

    expect(screen.getByRole("alert")).toHaveTextContent("Podaj nazwę.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(name).toHaveValue("Muzyczne Skrzaty");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(organizationsApi.updateOrganization).not.toHaveBeenCalled();
  });
});
