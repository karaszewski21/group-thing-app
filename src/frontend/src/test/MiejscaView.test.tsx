import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import * as googleMaps from "../lib/googleMaps";
import type { PlacesApi, Suggestion } from "../lib/googleMaps";
import { MiejscaView } from "../pages/panel/views/MiejscaView";
import { createQueryWrapper } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

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

function renderView() {
  return render(<MiejscaView onPlacesChanged={onPlacesChanged} />, { wrapper: createQueryWrapper() });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MiejscaView", () => {
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
    expect(within(rows[0]).getByRole("button", { name: "Edytuj miejsce Świetlica na Polnej" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Usuń miejsce Park Sołacki" })).toBeInTheDocument();
    expect(screen.queryByText("Nie masz jeszcze zapisanych miejsc.")).not.toBeInTheDocument();
  });

  it("empty state shows the copy and the collapsed add disclosure", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderView();

    expect(await screen.findByText("Nie masz jeszcze zapisanych miejsc.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Dodaj miejsce" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
  });

  it("adds a MANUAL place through the disclosure; the new row appears and the form collapses", async () => {
    const created: LocationResponse = { ...PARK, id: "loc-new", name: "Sala nr 2", formatted_address: "ul. Szkolna 5" };
    vi.mocked(locationsApi.getMyLocations).mockResolvedValueOnce([]).mockResolvedValue([created]);
    vi.mocked(locationsApi.createLocation).mockResolvedValue(created);
    renderView();

    const toggle = await screen.findByRole("button", { name: "+ Dodaj miejsce" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(
      screen.getByLabelText("Nazwa miejsca"),
    );

    fireEvent.change(screen.getByLabelText("Nazwa miejsca"), { target: { value: "Sala nr 2" } });
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "ul. Szkolna 5" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));

    await waitFor(() =>
      expect(locationsApi.createLocation).toHaveBeenCalledWith({
        source: "MANUAL",
        name: "Sala nr 2",
        formatted_address: "ul. Szkolna 5",
        notes: null,
      }),
    );
    const row = await screen.findByRole("listitem");
    expect(row).toHaveTextContent("Sala nr 2");
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Dodaj miejsce" })).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(within(row).getByRole("button", { name: "Edytuj miejsce Sala nr 2" })).toHaveFocus());
    expect(onPlacesChanged).toHaveBeenCalledTimes(1);
  });

  it("edit: Google address is read-only '(z Google)', MANUAL address editable; save PATCHes and refocuses Edytuj", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA, PARK]);
    vi.mocked(locationsApi.updateLocation).mockResolvedValue({ ...SWIETLICA, notes: null });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj miejsce Świetlica na Polnej" }));
    expect(screen.getByLabelText("Nazwa miejsca")).toHaveFocus();
    expect(screen.getByText(/\(z Google\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Adres")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nazwa miejsca"), { target: { value: "Świetlica" } });
    fireEvent.change(screen.getByLabelText("Notatka"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(locationsApi.updateLocation).toHaveBeenCalledWith("loc-1", { name: "Świetlica", notes: null }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edytuj miejsce Świetlica na Polnej" })).toHaveFocus(),
    );
    expect(onPlacesChanged).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Edytuj miejsce Park Sołacki" }));
    expect(screen.getByLabelText("Adres")).toHaveValue("Park Sołacki, Poznań");
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.getByRole("button", { name: "Edytuj miejsce Park Sołacki" })).toHaveFocus();
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Edytuj miejsce Park Sołacki" })).toHaveFocus());
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
    vi.mocked(locationsApi.getMyLocations).mockResolvedValueOnce([]).mockResolvedValue([created]);
    vi.mocked(locationsApi.createLocation).mockResolvedValue(created);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj miejsce" }));
    const input = screen.getByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" });
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
