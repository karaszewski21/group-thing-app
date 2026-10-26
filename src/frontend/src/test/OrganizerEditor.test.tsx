import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
import { getOpenSheetCount } from "../components/shared/openSheets";
import * as organizationsApi from "../api/organizations";
import { diffDraft, paletteSelection, sameDraft, type Draft } from "../pages/organizer/editor/draft";
import { PublicOrganizationPage } from "../pages/organizer/PublicOrganizationPage";
import { findPreset } from "../theme/palettePresets";
import dayjs from "../utils/dayjs";
import { createQueryWrapper } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
  getMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  uploadOrganizationMedia: vi.fn(),
  deleteOrganizationMedia: vi.fn(),
  reorderOrganizationGallery: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  getOrganizerPage: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

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
      { path: "/home", element: <p>Panel</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />, { wrapper: createQueryWrapper() });
  return router;
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

const DIRECTORY: groupsApi.OrganizerPageResponse = {
  circles: [],
  upcoming_terms: [],
  exchange: { counts: { GIFT: 0, SWAP: 0 }, items: [] },
  needed_items: [],
  stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
};

function circle(id: string, name: string): groupsApi.OrganizerCircle {
  return { id, name, layout_mode: "CIRCLE", next_term: null, upcoming_term_count: 2 };
}

function termInDays(days: number, groupId: string): groupsApi.OrganizerTerm {
  return {
    term_id: `term-${groupId}-${days}`,
    group_id: groupId,
    group_name: groupId,
    occurs_on: dayjs().add(days, "day").format("YYYY-MM-DD"),
    description: null,
    attendee_count: 0,
  };
}

const BUSY_DIRECTORY: groupsApi.OrganizerPageResponse = {
  ...DIRECTORY,
  circles: [circle("c-1", "Maluchy"), circle("c-2", "Starszaki")],
  upcoming_terms: [termInDays(1, "c-1"), termInDays(3, "c-2"), termInDays(8, "c-1"), termInDays(10, "c-2")],
  stats: { circle_count: 2, upcoming_term_count: 4, family_count: null },
};

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

/** Opens the sheet on "Układ i kolor", where most of these tests work. */
async function openEditor() {
  const router = renderAt("/muzyczne-skrzaty?edit=1&tab=uklad");
  const sheet = await screen.findByRole("dialog", { name: "Ustawienia" });
  return { router, sheet };
}

function chooseLinks() {
  fireEvent.click(screen.getByRole("radio", { name: "Wizytówka" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "owner-token" };
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
  vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(MY_ORGANIZATION);
  vi.mocked(groupsApi.getOrganizerPage).mockResolvedValue(DIRECTORY);
});

async function expectSheetClosedAfterSave() {
  await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument());
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/muzyczne-skrzaty$/);
  expect(screen.getByRole("button", { name: "Ustawienia" })).toHaveFocus();
}

describe("Organizer editor sheet", () => {
  it("opens for the owner with ?edit=1 inside the theme scope and focuses its title", async () => {
    const { sheet } = await openEditor();

    expect(sheet).toHaveAttribute("aria-modal", "false");
    expect(sheet.closest("[data-organizer-theme]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Ustawienia" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Układ i kolor" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: "Klasyczny" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Ustawienia" })).toHaveAttribute("aria-expanded", "true");
  });

  it("previews a chosen layout before saving, and Anuluj restores it with the sheet still open", async () => {
    await openEditor();

    chooseLinks();

    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Wizytówka" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.queryByRole("button", { name: "Udostępnij stronę" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Ustawienia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("saves only the changed layout and closes the sheet", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue({ ...MY_ORGANIZATION, page_layout: "LINKS" });
    await openEditor();
    chooseLinks();
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, page_layout: "LINKS" });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, page_layout: "LINKS" });

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await expectSheetClosedAfterSave();
    expect(organizationsApi.updateOrganization).toHaveBeenCalledTimes(1);
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { page_layout: "LINKS" });
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
  });

  it("asks before discarding a dirty draft on close, and Odrzuć closes the sheet", async () => {
    await openEditor();
    chooseLinks();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    const confirm = screen.getByRole("alertdialog", { name: "Odrzucić zmiany?" });
    expect(confirm.closest("[data-organizer-theme]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Wróć do edycji" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));

    expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/muzyczne-skrzaty$/);
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
  });

  it("blocks navigation to another page while dirty, and Wróć do edycji keeps the draft", async () => {
    const { router } = await openEditor();
    chooseLinks();

    await act(() => router.navigate("/home"));

    expect(screen.getByRole("alertdialog", { name: "Odrzucić zmiany?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wróć do edycji" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/muzyczne-skrzaty?edit=1");
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zamknij" })).toHaveFocus();
  });

  it("locks the tab panel while saving and closes the sheet once saved", async () => {
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
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, page_layout: "LINKS" });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, page_layout: "LINKS" });
    await act(async () => finishSave());

    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { page_layout: "LINKS" });
    await expectSheetClosedAfterSave();
  });

  it("drops the draft when the sheet closes without Zamknij, and reopens clean", async () => {
    const { router } = await openEditor();
    chooseLinks();

    await act(() => router.navigate("/muzyczne-skrzaty"));

    expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ustawienia" })).toHaveFocus();

    await act(() => router.navigate("/muzyczne-skrzaty?edit=1&tab=uklad"));

    expect(screen.getByRole("radio", { name: "Klasyczny" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: "Klasyczny" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("counts as an open sheet while shown, so app-wide prompts wait for it", async () => {
    await openEditor();
    expect(getOpenSheetCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(getOpenSheetCount()).toBe(0);
  });

  it("closes a clean sheet with Zamknij without asking", async () => {
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/muzyczne-skrzaty$/);
  });

  it("marks both Plan zajęć and Grupy as Polecany for two circles with four terms within 14 days", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockResolvedValue(BUSY_DIRECTORY);
    await openEditor();

    await vi.waitFor(() => expect(recommendedLayouts()).toEqual(["Plan zajęć", "Grupy"]));
    expect(within(screen.getByRole("radiogroup", { name: "Układ strony" })).getAllByRole("radio")).toHaveLength(5);
  });

  it("marks only the Wizytówka layout as Polecany for an organizer without circles", async () => {
    await openEditor();

    await vi.waitFor(() => expect(recommendedLayouts()).toEqual(["Wizytówka"]));
  });

  it("shows no Polecany badge while the directory is loading", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockReturnValue(new Promise(() => {}));
    await openEditor();

    expect(recommendedLayouts()).toEqual([]);
    expect(screen.queryByText("Polecany")).not.toBeInTheDocument();
  });

  it("marks only the Wizytówka layout as Polecany when the directory is unavailable", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockRejectedValue(
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

describe("Organizer editor colors tab", () => {
  const OCEAN = findPreset("OCEAN")!;

  async function openColors() {
    const opened = await openEditor();
    return { ...opened, palettes: screen.getByRole("radiogroup", { name: "Paleta kolorów" }) };
  }

  function themeScope() {
    return screen.getByRole("dialog", { name: "Ustawienia" }).closest("[data-organizer-theme]") as HTMLElement;
  }

  it("renders 10 palette tiles with Mięta first, no custom tile, and static preview cards", async () => {
    const { palettes } = await openColors();

    const tiles = within(palettes).getAllByRole("radio");
    expect(tiles).toHaveLength(10);
    expect(tiles[0]).toHaveAccessibleName("Mięta (domyślna)");
    expect(tiles[0]).toHaveAttribute("aria-checked", "true");
    expect(tiles[1]).toHaveAccessibleName("Ocean");
    expect(within(palettes).queryByRole("radio", { name: "Własny" })).not.toBeInTheDocument();

    for (const name of ["Podgląd terminu w wybranych kolorach", "Podgląd produktu w wybranych kolorach"]) {
      const card = screen.getByRole("img", { name });
      expect(card.querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(0);
    }
    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeDisabled();
  });

  it("previews a chosen preset and saves its key with its base colors", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(MY_ORGANIZATION);
    const { palettes } = await openColors();

    fireEvent.click(within(palettes).getByRole("radio", { name: "Ocean" }));

    expect(within(palettes).getByRole("radio", { name: "Ocean" })).toHaveAttribute("aria-checked", "true");
    expect(themeScope().style.getPropertyValue("--color-primary")).toBe(OCEAN.vars["--color-primary"]);
    expect(themeScope().style.getPropertyValue("--color-accent-soft")).toBe(OCEAN.vars["--color-accent-soft"]);

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await expectSheetClosedAfterSave();
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", {
      palette_preset: "OCEAN",
      primary_color: OCEAN.vars["--color-primary"],
      accent_color: OCEAN.vars["--color-accent"],
    });
  });

  it.each(["tile", "link"])("restores the default palette from a preset with three explicit nulls (%s)", async (via) => {
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

    if (via === "tile") fireEvent.click(within(palettes).getByRole("radio", { name: "Mięta (domyślna)" }));
    else fireEvent.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await expectSheetClosedAfterSave();
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", {
      palette_preset: null,
      primary_color: null,
      accent_color: null,
    });
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

describe("Organizer editor photos tab", () => {
  const JPEG = new File(["x"], "logo.jpg", { type: "image/jpeg" });

  function tab(name: string) {
    return screen.getByRole("tab", { name });
  }

  it("opens on Zdjęcia i opis by default, with the photos and the description together", async () => {
    renderAt("/muzyczne-skrzaty?edit=1");
    await screen.findByRole("dialog", { name: "Ustawienia" });

    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Zdjęcia i opis");
    expect(screen.getByRole("region", { name: "Logo" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "O nas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
  });

  it("falls back to Zdjęcia i opis for an unknown tab value", async () => {
    renderAt("/muzyczne-skrzaty?edit=1&tab=nieznana");
    await screen.findByRole("dialog", { name: "Ustawienia" });

    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["opis", "Zdjęcia i opis"],
    ["kolory", "Układ i kolor"],
  ])("maps the former ?tab=%s to %s", async (value, name) => {
    renderAt(`/muzyczne-skrzaty?edit=1&tab=${value}`);
    await screen.findByRole("dialog", { name: "Ustawienia" });

    expect(tab(name)).toHaveAttribute("aria-selected", "true");
  });

  it("switches an open sheet to Zdjęcia from the gallery ghost CTA, and closing drops edit and tab", async () => {
    await openEditor();
    expect(tab("Układ i kolor")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("link", { name: "Dodaj zdjęcia →" }));

    expect(await screen.findByRole("region", { name: "Logo" })).toBeInTheDocument();
    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/muzyczne-skrzaty?edit=1&tab=zdjecia");

    fireEvent.click(tab("Układ i kolor"));

    expect(screen.getByTestId("location")).toHaveTextContent("/muzyczne-skrzaty?edit=1&tab=uklad");

    fireEvent.click(screen.getByRole("link", { name: "Dodaj zdjęcia →" }));

    expect(await screen.findByRole("region", { name: "Logo" })).toBeInTheDocument();
    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/muzyczne-skrzaty$/);
  });

  it("uploads a photo right away without making the draft dirty", async () => {
    vi.mocked(organizationsApi.uploadOrganizationMedia).mockResolvedValue({
      id: "m-1",
      kind: "LOGO",
      status: "PENDING",
      url: "https://cdn/m-1",
      thumb_url: "https://cdn/m-1-t",
      sort_order: 0,
    });
    renderAt("/muzyczne-skrzaty?edit=1&tab=zdjecia");
    const logo = within(await screen.findByRole("region", { name: "Logo" }));

    fireEvent.change(logo.getByLabelText("Dodaj logo"), { target: { files: [JPEG] } });

    await vi.waitFor(() =>
      expect(organizationsApi.uploadOrganizationMedia).toHaveBeenCalledWith("org-1", "LOGO", JPEG),
    );
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Ustawienia" })).not.toBeInTheDocument();
  });

  it("moves roving focus across both pills with the arrow keys", async () => {
    await openEditor();

    fireEvent.keyDown(tab("Układ i kolor"), { key: "ArrowRight" });
    expect(tab("Zdjęcia i opis")).toHaveFocus();
    expect(tab("Zdjęcia i opis")).toHaveAttribute("aria-selected", "true");
    expect(tab("Zdjęcia i opis")).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(tab("Zdjęcia i opis"), { key: "ArrowRight" });
    expect(tab("Układ i kolor")).toHaveFocus();
    fireEvent.keyDown(tab("Układ i kolor"), { key: "ArrowLeft" });
    expect(tab("Zdjęcia i opis")).toHaveFocus();
  });
});

describe("Organizer editor description tab", () => {
  it("opens Zdjęcia i opis from the about ghost, previews the typed description live and saves it trimmed", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue({ ...MY_ORGANIZATION, description: "Śpiewamy." });
    await openEditor();

    fireEvent.click(screen.getByRole("link", { name: "Dodaj opis →" }));
    const textarea = await screen.findByRole("textbox", { name: "O nas" });
    expect(screen.getByRole("tab", { name: "Zdjęcia i opis" })).toHaveAttribute("aria-selected", "true");

    fireEvent.change(textarea, { target: { value: "  Śpiewamy.  " } });

    expect(screen.getByRole("region", { name: "O nas" })).toHaveTextContent("Śpiewamy.");
    expect(screen.queryByRole("link", { name: "Dodaj opis →" })).not.toBeInTheDocument();
    expect(screen.getByText("13/1000")).toBeInTheDocument();

    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, description: "Śpiewamy." });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, description: "Śpiewamy." });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await expectSheetClosedAfterSave();
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { description: "Śpiewamy." });
    expect(screen.getByRole("region", { name: "O nas" })).toHaveTextContent("Śpiewamy.");
  });
});

describe("editor draft helpers", () => {
  const baseline: Draft = {
    pageLayout: "CLASSIC",
    theme: { palette_preset: null, primary_color: "#7A2A4F", accent_color: null },
    description: "Śpiewamy razem.",
  };

  it("compares colors case-insensitively and sends nothing for a case-only change", () => {
    const current: Draft = { ...baseline, theme: { ...baseline.theme, primary_color: "#7a2a4f" } };

    expect(sameDraft(current, baseline)).toBe(true);
    expect(diffDraft(current, baseline)).toEqual({});
  });

  it("sends only changed fields, with explicit nulls", () => {
    const current: Draft = {
      pageLayout: "CLASSIC",
      theme: { palette_preset: null, primary_color: null, accent_color: null },
      description: "Śpiewamy razem.",
    };

    expect(diffDraft(current, baseline)).toEqual({ primary_color: null });
  });

  it("sends the trimmed description, a blank one as null, and nothing for a whitespace-only change", () => {
    expect(diffDraft({ ...baseline, description: "  Śpiewamy razem. \n" }, baseline)).toEqual({});
    expect(diffDraft({ ...baseline, description: " Tańczymy. " }, baseline)).toEqual({ description: "Tańczymy." });
    expect(diffDraft({ ...baseline, description: "   " }, baseline)).toEqual({ description: null });
  });

  it("derives the palette selection from the theme", () => {
    expect(paletteSelection({ palette_preset: null, primary_color: null, accent_color: null })).toBe("DEFAULT");
    expect(paletteSelection({ palette_preset: "OCEAN", primary_color: "#0E7490", accent_color: null })).toBe("OCEAN");
    expect(paletteSelection(baseline.theme)).toBe("CUSTOM");
    expect(paletteSelection({ palette_preset: "RETIRED", primary_color: null, accent_color: null })).toBe("CUSTOM");
  });
});
