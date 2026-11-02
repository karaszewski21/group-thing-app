import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import * as googleMaps from "../lib/googleMaps";
import type { PlacesApi, Suggestion } from "../lib/googleMaps";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PlaceCreateView } from "../pages/places/PlaceCreateView";
import { PlaceEditView } from "../pages/places/PlaceEditView";
import { PlacesView } from "../pages/places/PlacesView";
import { createQueryWrapper } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

const showToast = vi.fn();
vi.mock("../app/appDataStore", () => ({ useAppData: () => ({ showToast }) }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

// The real `isGoogleMapsConfigured` stays so `vi.stubEnv` flips the mode;
// only the network-facing calls are replaced.
vi.mock("../lib/googleMaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/googleMaps")>()),
  loadPlaces: vi.fn(),
  newSessionToken: vi.fn(),
  suggest: vi.fn(),
  resolve: vi.fn(),
}));

const SWIETLICA: LocationResponse = {
  id: "loc-1",
  owner_party_id: "party-1",
  name: "Świetlica na Polnej",
  formatted_address: "ul. Polna 12, 60-595 Poznań",
  google_place_id: "ChIJ-polna",
  lat: 52.4,
  lng: 16.9,
  notes: "wejście od podwórza",
  source: "GOOGLE",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
  deleted_at: null,
};

const PARK: LocationResponse = {
  ...SWIETLICA,
  id: "loc-2",
  name: "Park Sołacki",
  formatted_address: "Park Sołacki, Poznań",
  google_place_id: null,
  lat: null,
  lng: null,
  notes: null,
  source: "MANUAL",
};

const fakePlaces = {
  AutocompleteSessionToken: class {},
  AutocompleteSuggestion: {},
  Place: class {},
} as unknown as PlacesApi;

const SUGGESTION: Suggestion = {
  placeId: "ChIJ-test",
  mainText: "Świetlica Osiedlowa",
  secondaryText: "Polna 12, Poznań",
  raw: {} as Suggestion["raw"],
};

const onPlacesChanged = vi.fn();

/** The list stays empty until `createLocation` runs (both the list and the
 * add page fetch it), then holds `created`. */
function mockCreatedOnSave(created: LocationResponse) {
  let saved = false;
  vi.mocked(locationsApi.getMyLocations).mockImplementation(async () => (saved ? [created] : []));
  vi.mocked(locationsApi.createLocation).mockImplementation(async () => {
    saved = true;
    return created;
  });
}

/** "Moje miejsca" with its add and edit pages, as the panel routes them. */
function renderView(path = "/places") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/places" element={<PlacesView onPlacesChanged={onPlacesChanged} />} />
        <Route path="/places/new" element={<PlaceCreateView />} />
        <Route path="/places/:locationId/edit" element={<PlaceEditView onPlacesChanged={onPlacesChanged} />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Moje miejsca — list, add and edit pages", () => {
  it("lists own places with name, address and notes, plus per-row Edytuj/Usuń", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA, PARK]);
    renderView();

    expect(screen.getByRole("heading", { name: "Moje miejsca", level: 1 })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Moje miejsca" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Świetlica na Polnej");
    expect(rows[0]).toHaveTextContent("ul. Polna 12, 60-595 Poznań");
    expect(rows[0]).toHaveTextContent("wejście od podwórza");
    expect(rows[1]).toHaveTextContent("Park Sołacki");
    expect(within(rows[0]).getByRole("link", { name: "Edytuj miejsce Świetlica na Polnej" })).toHaveAttribute(
      "href",
      "/places/loc-1/edit",
    );
    expect(within(rows[1]).getByRole("button", { name: "Usuń miejsce Park Sołacki" })).toBeInTheDocument();
    expect(screen.queryByText("Nie masz jeszcze zapisanych miejsc.")).not.toBeInTheDocument();
  });

  it("empty state shows the copy and a link to the add page, no inline form", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderView();

    expect(await screen.findByText("Nie masz jeszcze zapisanych miejsc.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Dodaj miejsce" })).toHaveAttribute("href", "/places/new");
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
  });

  it("adds a MANUAL place on /places/new, then lists it back on Moje miejsca with a toast", async () => {
    const created: LocationResponse = { ...PARK, id: "loc-new", name: "Sala nr 2", formatted_address: "ul. Szkolna 5" };
    mockCreatedOnSave(created);
    renderView();

    fireEvent.click(await screen.findByRole("link", { name: "+ Dodaj miejsce" }));
    const page = await screen.findByRole("region", { name: "Nowe miejsce" });
    fireEvent.change(within(page).getByLabelText("Nazwa miejsca"), { target: { value: "Sala nr 2" } });
    fireEvent.change(within(page).getByLabelText("Adres"), { target: { value: "ul. Szkolna 5" } });
    fireEvent.click(within(page).getByRole("button", { name: "Zapisz miejsce" }));

    await waitFor(() =>
      expect(locationsApi.createLocation).toHaveBeenCalledWith({
        source: "MANUAL",
        name: "Sala nr 2",
        formatted_address: "ul. Szkolna 5",
        notes: null,
      }),
    );
    expect(await screen.findByRole("listitem")).toHaveTextContent("Sala nr 2");
    expect(showToast).toHaveBeenCalledWith("Dodano miejsce „Sala nr 2”");
  });

  it("the add page's Anuluj goes back without saving", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderView("/places/new");

    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    expect(await screen.findByText("Nie masz jeszcze zapisanych miejsc.")).toBeInTheDocument();
    expect(locationsApi.createLocation).not.toHaveBeenCalled();
  });

  it("edit page: Google address is read-only '(z Google)'; save PATCHes and goes back to the list", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA, PARK]);
    vi.mocked(locationsApi.updateLocation).mockResolvedValue({ ...SWIETLICA, notes: null });
    renderView();

    fireEvent.click(await screen.findByRole("link", { name: "Edytuj miejsce Świetlica na Polnej" }));
    const page = await screen.findByRole("region", { name: "Edytuj miejsce" });
    expect(within(page).getByText(/\(z Google\)/)).toBeInTheDocument();
    expect(within(page).queryByLabelText("Adres")).not.toBeInTheDocument();

    fireEvent.change(within(page).getByLabelText("Nazwa miejsca"), { target: { value: "Świetlica" } });
    fireEvent.change(within(page).getByLabelText("Notatka"), { target: { value: "" } });
    fireEvent.click(within(page).getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(locationsApi.updateLocation).toHaveBeenCalledWith("loc-1", { name: "Świetlica", notes: null }),
    );
    expect(await screen.findByRole("list", { name: "Moje miejsca" })).toBeInTheDocument();
    expect(onPlacesChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Zapisano miejsce");
  });

  it("edit page: a MANUAL address is editable; an unknown id shows a not-found note", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA, PARK]);
    const { unmount } = renderView("/places/loc-2/edit");
    expect(await screen.findByLabelText("Adres")).toHaveValue("Park Sołacki, Poznań");
    unmount();

    renderView("/places/nope/edit");
    expect(await screen.findByText("Nie znaleziono tego miejsca wśród Twoich miejsc.")).toBeInTheDocument();
  });

  it("delete asks in an alertdialog, then DELETEs and moves focus to the next row", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValueOnce([SWIETLICA, PARK]).mockResolvedValue([PARK]);
    vi.mocked(locationsApi.deleteLocation).mockResolvedValue(undefined);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Usuń miejsce Świetlica na Polnej" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Świetlica na Polnej");
    expect(within(dialog).getByRole("button", { name: "Anuluj" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń miejsce" }));

    await waitFor(() => expect(locationsApi.deleteLocation).toHaveBeenCalledWith("loc-1"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Świetlica na Polnej")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Edytuj miejsce Park Sołacki" })).toHaveFocus());
    expect(onPlacesChanged).toHaveBeenCalledTimes(1);
  });

  it("delete dialog: Esc cancels without deleting and returns focus to Usuń", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA]);
    renderView();

    const deleteButton = await screen.findByRole("button", { name: "Usuń miejsce Świetlica na Polnej" });
    // A real click focuses the button; `ConfirmDeleteDialog` returns focus to that opener.
    deleteButton.focus();
    fireEvent.click(deleteButton);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(locationsApi.deleteLocation).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(onPlacesChanged).not.toHaveBeenCalled();
  });

  it("Google mode: adds a picked suggestion as a GOOGLE place", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    vi.mocked(googleMaps.loadPlaces).mockResolvedValue(fakePlaces);
    vi.mocked(googleMaps.newSessionToken).mockImplementation(() => new fakePlaces.AutocompleteSessionToken());
    vi.mocked(googleMaps.suggest).mockResolvedValue([SUGGESTION]);
    vi.mocked(googleMaps.resolve).mockResolvedValue({
      placeId: "ChIJ-test",
      name: "Świetlica Osiedlowa",
      formattedAddress: "Polna 12, 60-595 Poznań",
      lat: 52.4064,
      lng: 16.9252,
    });
    const created: LocationResponse = {
      ...SWIETLICA,
      id: "loc-new",
      name: "Świetlica Osiedlowa",
      formatted_address: "Polna 12, 60-595 Poznań",
      google_place_id: "ChIJ-test",
      notes: null,
    };
    mockCreatedOnSave(created);
    renderView();

    fireEvent.click(await screen.findByRole("link", { name: "+ Dodaj miejsce" }));
    const input = await screen.findByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pol" } });
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: /Świetlica Osiedlowa/ }));
    expect(await screen.findByLabelText("Nazwa miejsca")).toHaveValue("Świetlica Osiedlowa");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));

    await waitFor(() =>
      expect(locationsApi.createLocation).toHaveBeenCalledWith({
        source: "GOOGLE",
        name: "Świetlica Osiedlowa",
        formatted_address: "Polna 12, 60-595 Poznań",
        google_place_id: "ChIJ-test",
        lat: 52.4064,
        lng: 16.9252,
        notes: null,
      }),
    );
    expect(await screen.findByRole("listitem")).toHaveTextContent("Świetlica Osiedlowa");
  });

  it("shows the load error as an alert", async () => {
    vi.mocked(locationsApi.getMyLocations).mockRejectedValue(new Error("Błąd serwera"));
    renderView();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
