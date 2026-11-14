import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as localitiesApi from "../api/localities";
import type { LocationRequest, LocationResponse } from "../api/locations";
import { LocationAddForm } from "../components/shared/LocationAddForm";
import * as googleMaps from "../lib/googleMaps";
import type { LatLng, PlacesApi, ResolvedPlace, Suggestion } from "../lib/googleMaps";
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

// The real map needs Google; this stand-in picks a fixed point, as an
// address (`onPick`) or as a bare point (`onPoint`).
vi.mock("../components/shared/PlaceMapPicker", () => ({
  PlaceMapPicker: ({
    onPick,
    onPoint,
  }: {
    onPick?: (place: ResolvedPlace) => void;
    onPoint?: (point: LatLng) => void;
  }) => (
    <button
      type="button"
      onClick={() => (onPoint ? onPoint({ lat: MAP_PLACE.lat, lng: MAP_PLACE.lng }) : onPick?.(MAP_PLACE))}
    >
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

const SOBIESKIEGO: ResolvedPlace = {
  placeId: "ChIJ-sobieskiego",
  name: "Jana III Sobieskiego 1",
  formattedAddress: "Jana III Sobieskiego 1, 32-650 Kęty",
  lat: 49.88,
  lng: 19.22,
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

type Submit = (request: LocationRequest) => Promise<LocationResponse>;

function renderForm(submit: Submit, initial?: LocationResponse) {
  const onSaved = vi.fn();
  render(
    withQueryClient(
      <LocationAddForm idPrefix="t" initial={initial} submit={submit} onSaved={onSaved} onCancel={() => {}} />,
    ),
  );
  return { onSaved };
}

function makeSubmit(saved: LocationResponse = makeLocationResponse()) {
  return vi.fn<Submit>().mockResolvedValue(saved);
}

async function pickLocality(text: string, name: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Miejscowość" }), { target: { value: text } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
}

function addressField() {
  return screen.getByLabelText("Adres (opcjonalnie)");
}

function stubGoogle() {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
  vi.mocked(googleMaps.loadPlaces).mockResolvedValue(fakePlaces);
  vi.mocked(googleMaps.newSessionToken).mockImplementation(() => new fakePlaces.AutocompleteSessionToken());
  vi.mocked(googleMaps.suggest).mockResolvedValue([SUGGESTION]);
  vi.mocked(googleMaps.resolve).mockResolvedValue(SOBIESKIEGO);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
  vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [KETY, BULOWICE], total: 2 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LocationAddForm", () => {
  it("keeps the address disabled until a locality is chosen; changing the locality clears it", async () => {
    renderForm(vi.fn());

    expect(screen.queryByLabelText(/Nazwa/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Notatka/)).not.toBeInTheDocument();
    const blocked = addressField();
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveAttribute("placeholder", "Najpierw wybierz miejscowość");
    expect(
      screen.getByText("Potrzebny głównie dla terminów i wydarzeń. Przy przedmiotach widzisz go tylko Ty."),
    ).toBeInTheDocument();

    await pickLocality("Kę", "Kęty");
    expect(addressField()).not.toHaveAttribute("aria-disabled");
    fireEvent.change(addressField(), { target: { value: "ul. Sobieskiego 1" } });

    fireEvent.click(screen.getByRole("button", { name: "Zmień miejscowość Kęty" }));
    expect(addressField()).toHaveAttribute("aria-disabled", "true");
    await pickLocality("Bu", "Bulowice");
    expect(addressField()).toHaveValue("");
  });

  it("create: Zapisz without a locality shows the pick error; then sends locality only, or with a MANUAL address", async () => {
    const saved = makeLocationResponse();
    const submit = makeSubmit(saved);
    const { onSaved } = renderForm(submit);

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz miejscowość z listy");
    expect(screen.getByRole("combobox", { name: "Miejscowość" })).toHaveAttribute("aria-invalid", "true");
    expect(submit).not.toHaveBeenCalled();

    await pickLocality("Kę", "Kęty");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ locality_id: "0937730" }));
    expect(onSaved).toHaveBeenCalledWith(saved);

    fireEvent.change(addressField(), { target: { value: " ul. Szkolna 5 " } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        locality_id: "0937730",
        formatted_address: "ul. Szkolna 5",
        source: "MANUAL",
      }),
    );
  });

  it("edit: a GOOGLE address is sent back whole; retyping it drops the place id and its point", async () => {
    const initial = makeLocationResponse({
      locality: makeLocality(),
      label: "Kęty — Jana III Sobieskiego 1, 32-650 Kęty",
      formatted_address: "Jana III Sobieskiego 1, 32-650 Kęty",
      google_place_id: "ChIJ-sobieskiego",
      lat: 49.88,
      lng: 19.22,
      source: "GOOGLE",
    });
    const submit = makeSubmit(initial);
    renderForm(submit, initial);

    expect(screen.getByRole("group", { name: "Miejscowość" })).toHaveTextContent("Kęty");
    expect(addressField()).toHaveValue("Jana III Sobieskiego 1, 32-650 Kęty");
    expect(screen.getByText("Dokładne położenie zaznaczone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        locality_id: "0937730",
        formatted_address: "Jana III Sobieskiego 1, 32-650 Kęty",
        source: "GOOGLE",
        google_place_id: "ChIJ-sobieskiego",
        lat: 49.88,
        lng: 19.22,
      }),
    );

    fireEvent.change(addressField(), { target: { value: "Długa 3" } });
    expect(screen.queryByText("Dokładne położenie zaznaczone.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        locality_id: "0937730",
        formatted_address: "Długa 3",
        source: "MANUAL",
      }),
    );
  });

  it("a picked suggestion (biased to the locality) fills the field and is saved as GOOGLE", async () => {
    stubGoogle();
    const submit = makeSubmit();
    renderForm(submit);

    await pickLocality("Kę", "Kęty");
    const address = screen.getByRole("combobox", { name: "Adres (opcjonalnie)" });
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: "Sobieskiego 1" } });
    const listbox = await screen.findByRole("listbox", { name: "Podpowiedzi adresów" });
    expect(vi.mocked(googleMaps.suggest).mock.calls[0][1]).toBe("Sobieskiego 1, Kęty, małopolskie");
    fireEvent.click(within(listbox).getByRole("option", { name: /Jana III Sobieskiego 1/ }));
    await waitFor(() => expect(address).toHaveValue("Jana III Sobieskiego 1, 32-650 Kęty"));
    expect(screen.queryByRole("listbox", { name: "Podpowiedzi adresów" })).not.toBeInTheDocument();

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

  it("typed text left without picking a suggestion is saved as typed", async () => {
    stubGoogle();
    const submit = makeSubmit();
    renderForm(submit);

    await pickLocality("Kę", "Kęty");
    const address = screen.getByRole("combobox", { name: "Adres (opcjonalnie)" });
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: "sala przy remizie" } });
    await screen.findByRole("listbox", { name: "Podpowiedzi adresów" });

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        locality_id: "0937730",
        formatted_address: "sala przy remizie",
        source: "MANUAL",
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("failed suggestions leave a plain field with a notice", async () => {
    stubGoogle();
    vi.mocked(googleMaps.loadPlaces).mockResolvedValue(null);
    renderForm(vi.fn());

    await pickLocality("Kę", "Kęty");
    fireEvent.focus(addressField());
    expect(
      await screen.findByText("Podpowiedzi adresów są teraz niedostępne. Wpisz adres ręcznie."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Adres (opcjonalnie)" })).not.toBeInTheDocument();
    expect(addressField()).not.toHaveAttribute("aria-disabled");
  });

  it("without a Maps key the form offers no map", async () => {
    renderForm(vi.fn());
    await pickLocality("Kę", "Kęty");
    expect(screen.queryByRole("button", { name: "Wskaż na mapie" })).not.toBeInTheDocument();
  });

  it("Wskaż na mapie on an empty field fills in the point's address and saves it as GOOGLE", async () => {
    stubGoogle();
    const submit = makeSubmit();
    renderForm(submit);

    expect(screen.queryByRole("button", { name: "Wskaż na mapie" })).not.toBeInTheDocument();
    await pickLocality("Kę", "Kęty");
    fireEvent.click(screen.getByRole("button", { name: "Wskaż na mapie" }));
    fireEvent.click(screen.getByRole("button", { name: "kliknij mapę" }));
    expect(addressField()).toHaveValue("Szkolna 5, 32-650 Kęty");

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

  it("a map point keeps the typed address, needs one, survives edits and can be removed", async () => {
    stubGoogle();
    const submit = makeSubmit();
    renderForm(submit);

    await pickLocality("Kę", "Kęty");
    fireEvent.change(addressField(), { target: { value: "sala przy remizie" } });
    fireEvent.click(screen.getByRole("button", { name: "Wskaż na mapie" }));
    fireEvent.click(screen.getByRole("button", { name: "kliknij mapę" }));
    expect(addressField()).toHaveValue("sala przy remizie");
    expect(screen.getByText("Dokładne położenie zaznaczone.")).toBeInTheDocument();

    fireEvent.change(addressField(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Wpisz adres wskazanego miejsca albo usuń pinezkę");
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(addressField(), { target: { value: "remiza, wejście od tyłu" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        locality_id: "0937730",
        formatted_address: "remiza, wejście od tyłu",
        source: "MANUAL",
        lat: 49.8811,
        lng: 19.2233,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Usuń pinezkę" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        locality_id: "0937730",
        formatted_address: "remiza, wejście od tyłu",
        source: "MANUAL",
      }),
    );
  });

  it("edit: a MANUAL place keeps its pin without a Maps key", async () => {
    const initial = makeLocationResponse({
      formatted_address: "sala przy remizie",
      lat: 49.8811,
      lng: 19.2233,
      source: "MANUAL",
    });
    const submit = makeSubmit(initial);
    renderForm(submit, initial);

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        locality_id: "0937730",
        formatted_address: "sala przy remizie",
        source: "MANUAL",
        lat: 49.8811,
        lng: 19.2233,
      }),
    );
  });
});
