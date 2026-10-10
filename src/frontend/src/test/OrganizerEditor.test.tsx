import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
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
      { path: "/panel/home", element: <p>Panel</p> },
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

const DIRECTORY: groupsApi.OrganizerPageResponse = {
  circles: [],
  upcoming_terms: [],
  exchange: { counts: { GIFT: 0, SWAP: 0, LEND: 0 }, items: [] },
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

async function openEditor() {
  const router = renderAt("/muzyczne-skrzaty?edit=1");
  const sheet = await screen.findByRole("dialog", { name: "Wygląd strony" });
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
  await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Wygląd strony" })).not.toBeInTheDocument());
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/muzyczne-skrzaty$/);
  expect(screen.getByRole("button", { name: "Edytuj wygląd" })).toHaveFocus();
}

describe("Organizer editor sheet", () => {
  it("opens for the owner with ?edit=1 inside the theme scope and focuses its title", async () => {
    const { sheet } = await openEditor();

    expect(sheet).toHaveAttribute("aria-modal", "false");
    expect(sheet.closest("[data-organizer-theme]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Wygląd strony" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Układ" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: "Klasyczny" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Edytuj wygląd" })).toHaveAttribute("aria-expanded", "true");
  });

  it("previews a chosen layout before saving, and Anuluj restores it with the sheet still open", async () => {
    await openEditor();

    chooseLinks();

    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Wizytówka" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.queryByRole("button", { name: "Udostępnij stronę" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Wygląd strony" })).toBeInTheDocument();
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

    expect(screen.queryByRole("dialog", { name: "Wygląd strony" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/muzyczne-skrzaty$/);
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
  });

  it("blocks navigation to another page while dirty, and Wróć do edycji keeps the draft", async () => {
    const { router } = await openEditor();
    chooseLinks();

    await act(() => router.navigate("/panel/home"));

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

    expect(screen.queryByRole("dialog", { name: "Wygląd strony" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edytuj wygląd" })).toHaveFocus();

    await act(() => router.navigate("/muzyczne-skrzaty?edit=1"));

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

  it("closes a clean sheet with Zamknij without asking", async () => {
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Wygląd strony" })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("tab", { name: "Kolory" }));
    return { ...opened, palettes: screen.getByRole("radiogroup", { name: "Paleta kolorów" }) };
  }

  function themeScope() {
    return screen.getByRole("dialog", { name: "Wygląd strony" }).closest("[data-organizer-theme]") as HTMLElement;
  }

  it("renders 11 palette tiles with Mięta first and Własny last, and static preview cards", async () => {
    const { palettes } = await openColors();

    const tiles = within(palettes).getAllByRole("radio");
    expect(tiles).toHaveLength(11);
    expect(tiles[0]).toHaveAccessibleName("Mięta (domyślna)");
    expect(tiles[0]).toHaveAttribute("aria-checked", "true");
    expect(tiles[1]).toHaveAccessibleName("Ocean");
    expect(tiles[10]).toHaveAccessibleName("Własny");

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

  it("validates a custom primary color, disables Zapisz while invalid and explains a darkened color", async () => {
    const { palettes } = await openColors();

    fireEvent.click(within(palettes).getByRole("radio", { name: "Własny" }));
    const hex = screen.getByRole("textbox", { name: "Kolor główny *" });

    fireEvent.change(hex, { target: { value: "#34z8db" } });

    expect(screen.getByText("Podaj kolor w formacie #RRGGBB")).toBeInTheDocument();
    expect(hex).toHaveAccessibleDescription("Podaj kolor w formacie #RRGGBB");
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();

    fireEvent.change(hex, { target: { value: "#3498db" } });

    expect(screen.queryByText("Podaj kolor w formacie #RRGGBB")).not.toBeInTheDocument();
    expect(hex).toHaveValue("#3498DB");
    expect(screen.getByText("Lekko przyciemniliśmy kolor dla czytelności.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeEnabled();
  });

  it("switches a custom accent back to Automatyczny and saves accent_color: null", async () => {
    const customTheme = { palette_preset: null, primary_color: "#7A2A4F", accent_color: "#D4A017" };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, ...customTheme });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, ...customTheme });
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(MY_ORGANIZATION);
    const { palettes } = await openColors();
    expect(within(palettes).getByRole("radio", { name: "Własny" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Automatyczny" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await expectSheetClosedAfterSave();
    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("org-1", { accent_color: null });
  });

  it("lets Anuluj clear an invalid hex typed over a stored custom color", async () => {
    const customTheme = { palette_preset: null, primary_color: "#7A2A4F", accent_color: null };
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue({ ...ORGANIZATION, ...customTheme });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({ ...MY_ORGANIZATION, ...customTheme });
    await openColors();

    fireEvent.change(screen.getByRole("textbox", { name: "Kolor główny *" }), { target: { value: "#7A2A4" } });

    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.getByRole("textbox", { name: "Kolor główny *" })).toHaveValue("#7A2A4F");
    expect(screen.queryByText("Podaj kolor w formacie #RRGGBB")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });
});

describe("editor draft helpers", () => {
  const baseline: Draft = {
    pageLayout: "CLASSIC",
    theme: { palette_preset: null, primary_color: "#7A2A4F", accent_color: null },
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
    };

    expect(diffDraft(current, baseline)).toEqual({ primary_color: null });
  });

  it("derives the palette selection from the theme", () => {
    expect(paletteSelection({ palette_preset: null, primary_color: null, accent_color: null })).toBe("DEFAULT");
    expect(paletteSelection({ palette_preset: "OCEAN", primary_color: "#0E7490", accent_color: null })).toBe("OCEAN");
    expect(paletteSelection(baseline.theme)).toBe("CUSTOM");
    expect(paletteSelection({ palette_preset: "RETIRED", primary_color: null, accent_color: null })).toBe("CUSTOM");
  });
});
