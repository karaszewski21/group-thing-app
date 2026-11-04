import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as localitiesApi from "../api/localities";
import type { LocationRequest, LocationResponse } from "../api/locations";
import { LocationAddForm } from "../components/shared/LocationAddForm";
import * as googleMaps from "../lib/googleMaps";
import type { PlacesApi, ResolvedPlace, Suggestion } from "../lib/googleMaps";
import { makeLocality, makeLocalitySearchResult, makeLocationResponse } from "./fixtures/locations";
import { withQueryClient } from "./queryClient";

vi.mock("../api/localities", () => ({ searchLocalities: vi.fn() }));

// The real `isGoogleMapsConfigured` stays so `vi.stubEnv` flips the mode;
// only the network-facing calls are replaced.
vi.mock("../lib/googleMaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/googleMaps")>()),
  loadPlaces: vi.fn(),
  newSessionToken: vi.fn(),
  suggest: vi.fn(),
  resolve: vi.fn(),
}));

// The real map needs Google; this stand-in picks a fixed point.
vi.mock("../components/shared/PlaceMapPicker", () => ({
  PlaceMapPicker: ({ onPick }: { onPick: (place: ResolvedPlace) => void }) => (
    <button type="button" onClick={() => onPick(MAP_PLACE)}>
      kliknij mapę
    </button>
  ),
}));

const MAP_PLACE: ResolvedPlace = {
  placeId: "ChIJ-map-point",
  name: "Szkolna 5, 32-650 Kęty",
  formattedAddress: "Szkolna 5, 32-650 Kęty",
  lat: 49.8811,
  lng: 19.2233,
};

const KETY = makeLocalitySearchResult();
const BULOWICE = makeLocalitySearchResult({ id: "0937001", name: "Bulowice", kind: "VILLAGE" });

const fakePlaces = {
  AutocompleteSessionToken: class {},
  AutocompleteSuggestion: {},
  Place: class {},
} as unknown as PlacesApi;

const SUGGESTION: Suggestion = {
  placeId: "ChIJ-sobieskiego",
  mainText: "Jana III Sobieskiego 1",
  secondaryText: "32-650 Kęty",
  raw: {} as Suggestion["raw"],
};

function renderForm(submit: (request: LocationRequest) => Promise<LocationResponse>, initial?: LocationResponse) {
  const onSaved = vi.fn();
  render(
    withQueryClient(
      <LocationAddForm idPrefix="t" initial={initial} submit={submit} onSaved={onSaved} onCancel={() => {}} />,
    ),
  );
  return { onSaved };
}

async function pickLocality(text: string, name: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Lokalizacja" }), { target: { value: text } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LocationAddForm", () => {
  it("keeps the address disabled until a locality is chosen; changing the locality clears it", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY, BULOWICE], total: 2 });
    renderForm(vi.fn());

    expect(screen.queryByLabelText(/Nazwa/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Notatka/)).not.toBeInTheDocument();
    const blocked = screen.getByLabelText("Adres (opcjonalnie)");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveAttribute("placeholder", "Najpierw wybierz miejscowość");
    expect(
      screen.getByText("Potrzebny głównie dla terminów i wydarzeń. Przy przedmiotach widzisz go tylko Ty."),
    ).toBeInTheDocument();

    await pickLocality("Kę", "Kęty");
    const address = screen.getByLabelText("Adres (opcjonalnie)");
    expect(address).not.toHaveAttribute("aria-disabled");
    fireEvent.change(address, { target: { value: "ul. Sobieskiego 1" } });

    fireEvent.click(screen.getByRole("button", { name: "Zmień miejscowość Kęty" }));
    expect(screen.getByLabelText("Adres (opcjonalnie)")).toHaveAttribute("aria-disabled", "true");
    await pickLocality("Bu", "Bulowice");
    expect(screen.getByLabelText("Adres (opcjonalnie)")).toHaveValue("");
  });

  it("create: Zapisz without a locality shows the pick error; then sends locality only, or with a MANUAL address", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY], total: 1 });
    const saved = makeLocationResponse();
    const submit = vi.fn<(request: LocationRequest) => Promise<LocationResponse>>().mockResolvedValue(saved);
    const { onSaved } = renderForm(submit);

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz miejscowość z listy");
    expect(screen.getByRole("combobox", { name: "Lokalizacja" })).toHaveAttribute("aria-invalid", "true");
    expect(submit).not.toHaveBeenCalled();

    await pickLocality("Kę", "Kęty");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ locality_id: "0937730" }));
    expect(onSaved).toHaveBeenCalledWith(saved);

    fireEvent.change(screen.getByLabelText("Adres (opcjonalnie)"), { target: { value: " ul. Szkolna 5 " } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        locality_id: "0937730",
        formatted_address: "ul. Szkolna 5",
        source: "MANUAL",
      }),
    );
  });

  it("edit: prefilled from `initial`, a GOOGLE address is sent back whole", async () => {
    const initial = makeLocationResponse({
      locality: makeLocality(),
      label: "Kęty — Jana III Sobieskiego 1, 32-650 Kęty",
      formatted_address: "Jana III Sobieskiego 1, 32-650 Kęty",
      google_place_id: "ChIJ-sobieskiego",
      lat: 49.88,
      lng: 19.22,
      source: "GOOGLE",
    });
    const submit = vi.fn<(request: LocationRequest) => Promise<LocationResponse>>().mockResolvedValue(initial);
    renderForm(submit, initial);

    expect(screen.getByRole("group", { name: "Lokalizacja" })).toHaveTextContent("Kęty");
    expect(screen.getByText("Jana III Sobieskiego 1, 32-650 Kęty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        locality_id: "0937730",
        formatted_address: "Jana III Sobieskiego 1, 32-650 Kęty",
        source: "GOOGLE",
        google_place_id: "ChIJ-sobieskiego",
        lat: 49.88,
        lng: 19.22,
      }),
    );
  });

  it("Google suggestions are biased to the chosen locality", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY], total: 1 });
    vi.mocked(googleMaps.loadPlaces).mockResolvedValue(fakePlaces);
    vi.mocked(googleMaps.newSessionToken).mockImplementation(() => new fakePlaces.AutocompleteSessionToken());
    vi.mocked(googleMaps.suggest).mockResolvedValue([SUGGESTION]);
    vi.mocked(googleMaps.resolve).mockResolvedValue({
      placeId: "ChIJ-sobieskiego",
      name: "Jana III Sobieskiego 1",
      formattedAddress: "Jana III Sobieskiego 1, 32-650 Kęty",
      lat: 49.88,
      lng: 19.22,
    });
    const submit = vi
      .fn<(request: LocationRequest) => Promise<LocationResponse>>()
      .mockResolvedValue(makeLocationResponse());
    renderForm(submit);

    await pickLocality("Kę", "Kęty");
    const address = screen.getByRole("combobox", { name: "Adres (opcjonalnie)" });
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: "Sobieskiego 1" } });
    const listbox = await screen.findByRole("listbox", { name: "Podpowiedzi adresów" });
    expect(vi.mocked(googleMaps.suggest).mock.calls[0][1]).toBe("Sobieskiego 1, Kęty, małopolskie");
    fireEvent.click(within(listbox).getByRole("option", { name: /Jana III Sobieskiego 1/ }));
    expect(await screen.findByText("Jana III Sobieskiego 1, 32-650 Kęty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        locality_id: "0937730",
        formatted_address: "Jana III Sobieskiego 1, 32-650 Kęty",
        source: "GOOGLE",
        google_place_id: "ChIJ-sobieskiego",
        lat: 49.88,
        lng: 19.22,
      }),
    );
  });

  it("without a Maps key the form offers no map", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY], total: 1 });
    renderForm(vi.fn());
    await pickLocality("Kę", "Kęty");
    expect(screen.queryByRole("button", { name: "wskaż na mapie" })).not.toBeInTheDocument();
  });

  it("wskaż na mapie opens the map and saves the picked point", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY], total: 1 });
    const submit = vi
      .fn<(request: LocationRequest) => Promise<LocationResponse>>()
      .mockResolvedValue(makeLocationResponse());
    renderForm(submit);

    expect(screen.queryByRole("button", { name: "wskaż na mapie" })).not.toBeInTheDocument();
    await pickLocality("Kę", "Kęty");
    fireEvent.click(screen.getByRole("button", { name: "wskaż na mapie" }));
    fireEvent.click(screen.getByRole("button", { name: "kliknij mapę" }));
    expect(await screen.findByText("Szkolna 5, 32-650 Kęty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        locality_id: "0937730",
        formatted_address: "Szkolna 5, 32-650 Kęty",
        source: "GOOGLE",
        google_place_id: "ChIJ-map-point",
        lat: 49.8811,
        lng: 19.2233,
      }),
    );
  });
});
