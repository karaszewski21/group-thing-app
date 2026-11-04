import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as locationsApi from "../api/locations";
import { PlaceEditView } from "../features/places/PlaceEditView";
import { PlacesView } from "../features/places/PlacesView";
import { makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

const showToast = vi.fn();
vi.mock("../features/panel/appDataStore", () => ({
  useAppData: () => ({ showToast }),
  usePanelReload: () => onPlacesChanged,
}));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

vi.mock("../api/localities", () => ({ searchLocalities: vi.fn() }));

/** An address-less place: the detail line is its second line. */
const KETY = makeLocationResponse({ id: "loc-1", label: "Kęty, małopolskie" });

/** A place with a typed address: "{address} · {voivodeship}". */
const KRAKOW = makeLocationResponse({
  id: "loc-2",
  locality: makeLocality({ id: "0950463", name: "Kraków", gmina: "Kraków", powiat: "Kraków" }),
  label: "Kraków — Klub Sąsiedzki, ul. Długa 5",
  formatted_address: "Klub Sąsiedzki, ul. Długa 5",
  source: "MANUAL",
});

const onPlacesChanged = vi.fn();

/** "Moje miejsca" with its edit page, as the panel routes them. */
function renderView(path = "/places") {
  return renderWithRoute(<PlacesView />, {
    url: path,
    pattern: "/places",
    routes: { "/places/:locationId/edit": <PlaceEditView /> },
    wrapper: createQueryWrapper(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Moje miejsca — list and edit page", () => {
  it("rows show the locality first, then the address · voivodeship or the detail line, plus Edytuj/Usuń", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, KRAKOW]);
    renderView();

    const list = await screen.findByRole("list", { name: "Moje miejsca" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/^Kętygm\. Kęty, pow\. oświęcimski, małopolskie/);
    expect(rows[1]).toHaveTextContent(/^KrakówKlub Sąsiedzki, ul\. Długa 5 · małopolskie/);
    expect(within(rows[0]).getByRole("link", { name: "Edytuj miejsce Kęty, małopolskie" })).toHaveAttribute(
      "href",
      "/places/loc-1/edit",
    );
    expect(
      within(rows[1]).getByRole("button", { name: "Usuń miejsce Kraków — Klub Sąsiedzki, ul. Długa 5" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Miejsca bez adresu wystarczą dla przedmiotów. Dla terminów i wydarzeń dodaj adres."),
    ).toBeInTheDocument();
  });

  it("empty state shows the copy and a link to the add page", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderView();

    expect(await screen.findByText("Nie masz jeszcze zapisanych miejsc.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Dodaj miejsce" })).toHaveAttribute("href", "/places/new");
  });

  it("edit page: prefilled 2-field form PUTs the locality and address, then goes back to the list", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, KRAKOW]);
    vi.mocked(locationsApi.updateLocation).mockResolvedValue(KRAKOW);
    renderView();

    fireEvent.click(await screen.findByRole("link", { name: "Edytuj miejsce Kraków — Klub Sąsiedzki, ul. Długa 5" }));
    const page = await screen.findByRole("region", { name: "Edytuj miejsce" });
    expect(within(page).getByRole("group", { name: "Lokalizacja" })).toHaveTextContent("Kraków");
    const address = within(page).getByLabelText("Adres (opcjonalnie)");
    expect(address).toHaveValue("Klub Sąsiedzki, ul. Długa 5");

    fireEvent.change(address, { target: { value: "" } });
    fireEvent.click(within(page).getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(locationsApi.updateLocation).toHaveBeenCalledWith("loc-2", { locality_id: "0950463" }));
    expect(await screen.findByRole("list", { name: "Moje miejsca" })).toBeInTheDocument();
    expect(onPlacesChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Zapisano miejsce");
  });

  it("edit page: an unknown id shows a not-found note", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY]);
    renderView("/places/nope/edit");
    expect(await screen.findByText("Nie znaleziono tego miejsca wśród Twoich miejsc.")).toBeInTheDocument();
  });

  it("delete asks in an alertdialog, then DELETEs and moves focus to the next row", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValueOnce([KETY, KRAKOW]).mockResolvedValue([KRAKOW]);
    vi.mocked(locationsApi.deleteLocation).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Usuń miejsce Kęty, małopolskie" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Kęty, małopolskie");
    expect(within(dialog).getByRole("button", { name: "Anuluj" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń miejsce" }));

    await waitFor(() => expect(locationsApi.deleteLocation).toHaveBeenCalledWith("loc-1"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/oświęcimski/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Edytuj miejsce Kraków — Klub Sąsiedzki, ul. Długa 5" })).toHaveFocus());
    expect(onPlacesChanged).toHaveBeenCalledTimes(1);
  });

  it("delete dialog: Esc cancels without deleting and returns focus to Usuń", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY]);
    renderView();

    const deleteButton = await screen.findByRole("button", { name: "Usuń miejsce Kęty, małopolskie" });
    // A real click focuses the button; `ConfirmDeleteDialog` returns focus to that opener.
    deleteButton.focus();
    fireEvent.click(deleteButton);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(locationsApi.deleteLocation).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(onPlacesChanged).not.toHaveBeenCalled();
  });

  it("shows the load error as an alert", async () => {
    vi.mocked(locationsApi.getMyLocations).mockRejectedValue(new Error("Błąd serwera"));
    renderView();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
