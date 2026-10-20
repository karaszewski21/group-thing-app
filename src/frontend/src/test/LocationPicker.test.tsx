import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import { LocationPicker, type FallbackLocation } from "../components/shared/LocationPicker";
import * as googleMaps from "../lib/googleMaps";
import type { PlacesApi, Suggestion } from "../lib/googleMaps";
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

function Harness({
  initial = null,
  onChange,
  fallbackLocation,
}: {
  initial?: string | null;
  onChange: (id: string | null) => void;
  fallbackLocation?: FallbackLocation | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <LocationPicker
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      label="Miejsce"
      noneLabel="Brak miejsca"
      idPrefix="test"
      fallbackLocation={fallbackLocation}
    />
  );
}

function renderPicker(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, { wrapper: createQueryWrapper() });
}

function stubGoogle() {
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
  vi.mocked(googleMaps.loadPlaces).mockResolvedValue(fakePlaces);
  vi.mocked(googleMaps.newSessionToken).mockImplementation(
    () => new fakePlaces.AutocompleteSessionToken(),
  );
  vi.mocked(googleMaps.suggest).mockImplementation(async (_api, input) =>
    input.trim() ? [SUGGESTION] : [],
  );
  vi.mocked(googleMaps.resolve).mockResolvedValue({
    placeId: "ChIJ-test",
    name: "Świetlica Osiedlowa",
    formattedAddress: "Polna 12, 60-595 Poznań",
    lat: 52.4064,
    lng: 16.9252,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LocationPicker", () => {
  it("is a native select: none option first, own places, change selects; no edit/delete controls", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA, PARK]);
    const onChange = vi.fn();
    renderPicker({ initial: "loc-1", onChange });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select.tagName).toBe("SELECT");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Brak miejsca", "Świetlica na Polnej", "Park Sołacki"]);
    expect(select).toHaveValue("loc-1");
    expect(screen.getByText("ul. Polna 12, 60-595 Poznań")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usuń/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "loc-2" } });
    expect(onChange).toHaveBeenLastCalledWith("loc-2");
    expect(select).toHaveValue("loc-2");

    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("lists a selected '(usunięte)' fallback place that is no longer among own places", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([PARK]);
    renderPicker({
      initial: "loc-gone",
      onChange: vi.fn(),
      fallbackLocation: {
        id: "loc-gone",
        name: "Sala nr 2",
        formatted_address: "ul. Stara 1, Poznań",
        notes: null,
        deleted_at: "2026-10-10T10:00:00",
      },
    });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-gone");
    expect(within(select).getByRole("option", { name: "Sala nr 2 (usunięte)" })).toBeInTheDocument();
  });

  it("lists an active fallback place owned by someone else under its plain name", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([PARK]);
    renderPicker({
      initial: "loc-other",
      onChange: vi.fn(),
      fallbackLocation: {
        id: "loc-other",
        name: "Sala nr 2",
        formatted_address: "ul. Stara 1, Poznań",
        notes: null,
        deleted_at: null,
      },
    });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-other");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Brak miejsca",
      "Park Sołacki",
      "Sala nr 2",
    ]);
  });

  it("'+' expands the inline add form; manual save selects the new place, collapses and refocuses the select", async () => {
    const created: LocationResponse = { ...PARK, id: "loc-new", name: "Sala nr 2", formatted_address: "ul. Szkolna 5" };
    vi.mocked(locationsApi.getMyLocations).mockResolvedValueOnce([]).mockResolvedValue([created]);
    vi.mocked(locationsApi.createLocation).mockResolvedValue(created);
    const onChange = vi.fn();
    renderPicker({ onChange });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(within(select).getAllByRole("option")).toHaveLength(1);
    const plus = screen.getByRole("button", { name: "Dodaj nowe miejsce" });
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();

    fireEvent.click(plus);
    expect(plus).toHaveAttribute("aria-expanded", "true");
    const formId = plus.getAttribute("aria-controls");
    expect(formId).toBeTruthy();
    expect(document.getElementById(formId!)).toContainElement(screen.getByLabelText("Nazwa miejsca"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("szukaj w Google")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nazwa miejsca"), { target: { value: "Sala nr 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Podaj adres");
    expect(locationsApi.createLocation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "ul. Szkolna 5" } });
    fireEvent.change(screen.getByLabelText("Notatka"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("loc-new"));
    expect(locationsApi.createLocation).toHaveBeenCalledWith({
      source: "MANUAL",
      name: "Sala nr 2",
      formatted_address: "ul. Szkolna 5",
      notes: null,
    });
    await waitFor(() => expect(select).toHaveValue("loc-new"));
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
    await waitFor(() => expect(select).toHaveFocus());
  });

  it("Anuluj collapses the add form and returns focus to '+'", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([PARK]);
    renderPicker({ onChange: vi.fn() });

    const plus = await screen.findByRole("button", { name: "Dodaj nowe miejsce" });
    fireEvent.click(plus);
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
    await waitFor(() => expect(plus).toHaveFocus());
  });

  it("Google mode: suggestions in the own listbox; Esc closes only the listbox and is defaultPrevented", async () => {
    stubGoogle();
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderPicker({ onChange: vi.fn() });

    fireEvent.click(await screen.findByRole("button", { name: "Dodaj nowe miejsce" }));
    const input = screen.getByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" });
    expect(screen.getByRole("button", { name: "wpisz ręcznie" })).toBeInTheDocument();
    expect(googleMaps.loadPlaces).not.toHaveBeenCalled();
    fireEvent.focus(input);
    await waitFor(() => expect(googleMaps.loadPlaces).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "pol" } });

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /Świetlica Osiedlowa/ })).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");

    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    const notCancelled = fireEvent.keyDown(input, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(notCancelled).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");
    expect(input).toBeInTheDocument();
  });

  it("Google mode: a rejected suggest request switches to manual entry with the unavailable alert", async () => {
    stubGoogle();
    vi.mocked(googleMaps.suggest).mockRejectedValue(new Error("REQUEST_DENIED"));
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderPicker({ onChange: vi.fn() });

    fireEvent.click(await screen.findByRole("button", { name: "Dodaj nowe miejsce" }));
    const input = screen.getByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" });
    fireEvent.focus(input);
    await waitFor(() => expect(googleMaps.loadPlaces).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "pol" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Wyszukiwarka niedostępna — wpisz adres ręcznie");
    expect(googleMaps.suggest).toHaveBeenCalledWith(fakePlaces, "pol", expect.any(fakePlaces.AutocompleteSessionToken));
    expect(screen.queryByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Adres")).toBeInTheDocument();
  });

  it("Google mode: picking prefills the name and saves a GOOGLE row; a duplicate place_id selects the existing row", async () => {
    stubGoogle();
    const created: LocationResponse = {
      ...SWIETLICA,
      id: "loc-new",
      name: "Świetlica Osiedlowa",
      formatted_address: "Polna 12, 60-595 Poznań",
      google_place_id: "ChIJ-test",
      lat: 52.4064,
      lng: 16.9252,
      notes: null,
    };
    vi.mocked(locationsApi.getMyLocations).mockResolvedValueOnce([PARK]).mockResolvedValue([PARK, created]);
    vi.mocked(locationsApi.createLocation).mockResolvedValue(created);
    const onChange = vi.fn();
    renderPicker({ onChange });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj nowe miejsce" }));
    const input = screen.getByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pol" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("opt-0"));
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByLabelText("Nazwa miejsca")).toHaveValue("Świetlica Osiedlowa");
    expect(screen.getByText("Polna 12, 60-595 Poznań")).toBeInTheDocument();
    expect(googleMaps.newSessionToken).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz miejsce" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("loc-new"));
    expect(locationsApi.createLocation).toHaveBeenCalledWith({
      source: "GOOGLE",
      name: "Świetlica Osiedlowa",
      formatted_address: "Polna 12, 60-595 Poznań",
      google_place_id: "ChIJ-test",
      lat: 52.4064,
      lng: 16.9252,
      notes: null,
    });
    await waitFor(() => expect(select).toHaveValue("loc-new"));

    // Same place again: the hook finds it in the loaded list, no second request.
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj nowe miejsce" }));
    const again = screen.getByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" });
    fireEvent.focus(again);
    fireEvent.change(again, { target: { value: "pol" } });
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: /Świetlica Osiedlowa/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz miejsce" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("loc-new"));
    expect(locationsApi.createLocation).toHaveBeenCalledTimes(1);
  });

  it("Google mode: loadPlaces resolving null falls back to the manual form with an alert", async () => {
    stubGoogle();
    vi.mocked(googleMaps.loadPlaces).mockResolvedValue(null);
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderPicker({ onChange: vi.fn() });

    fireEvent.click(await screen.findByRole("button", { name: "Dodaj nowe miejsce" }));
    fireEvent.focus(screen.getByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wyszukiwarka niedostępna — wpisz adres ręcznie");
    expect(screen.queryByRole("combobox", { name: "Szukaj adresu lub nazwy miejsca" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Adres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "szukaj w Google" })).toBeInTheDocument();
  });
});
