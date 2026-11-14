import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as localitiesApi from "../api/localities";
import * as locationsApi from "../api/locations";
import { PlaceCreateView } from "../features/places/PlaceCreateView";
import { useNavigationState } from "../routing/navigation";
import type { PickedLocationState } from "../utils/appHelpers";
import { makeLocalitySearchResult, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

const showToast = vi.fn();
vi.mock("../features/panel/appDataStore", () => ({
  useAppData: () => ({ showToast }),
  usePanelReload: () => () => {},
}));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

vi.mock("../api/localities", () => ({ searchLocalities: vi.fn() }));

const RETURN_URL = `/places/new?${new URLSearchParams({ returnTo: "/items/item-1/edit", picker: "item-edit-place" })}`;

/** The opener form: shows the state `/places/new` handed back. */
function OpenerProbe() {
  const state = useNavigationState<PickedLocationState>();
  return <p>{state ? `picked:${String(state.pickedLocation.locationId)}` : "no state"}</p>;
}

function renderCreate(url: string) {
  return renderWithRoute(<PlaceCreateView />, {
    url,
    pattern: "/places/new",
    routes: { "/items/:id/edit": <OpenerProbe />, "/places": <p>Moje miejsca</p> },
    wrapper: createQueryWrapper(),
  });
}

async function pickKetyAndSave() {
  fireEvent.change(screen.getByRole("combobox", { name: "Miejscowość" }), { target: { value: "Kę" } });
  fireEvent.click(await screen.findByRole("option", { name: /Kęty/ }));
  fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
  vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [makeLocalitySearchResult()], total: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PlaceCreateView", () => {
  it("save with returnTo replaces history and hands the new place to the picker", async () => {
    vi.mocked(locationsApi.createLocation).mockResolvedValue(makeLocationResponse({ id: "loc-new" }));
    renderCreate(RETURN_URL);
    await pickKetyAndSave();

    expect(await screen.findByText("picked:loc-new")).toBeInTheDocument();
    expect(locationsApi.createLocation).toHaveBeenCalledWith({ locality_id: "0937730" });
    expect(showToast).toHaveBeenCalledWith("Dodano miejsce „Kęty”");
    expect(getTestRouter().calls.at(-1)).toEqual({ method: "replace", url: "/items/item-1/edit", scroll: true });
  });

  it("cancel with returnTo + picker replaces history and hands back locationId null", async () => {
    renderCreate(RETURN_URL);

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(await screen.findByText("picked:null")).toBeInTheDocument();
    expect(getTestRouter().calls.at(-1)).toEqual({ method: "replace", url: "/items/item-1/edit", scroll: true });
    expect(locationsApi.createLocation).not.toHaveBeenCalled();
  });

  it("without returnTo, save and cancel push /places", async () => {
    vi.mocked(locationsApi.createLocation).mockResolvedValue(makeLocationResponse({ id: "loc-new" }));
    const { unmount } = renderCreate("/places/new");
    await pickKetyAndSave();

    await waitFor(() => expect(getTestLocation().pathname).toBe("/places"));
    expect(getTestRouter().calls.at(-1)).toEqual({ method: "push", url: "/places", scroll: true });
    unmount();

    renderCreate("/places/new");
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(getTestRouter().calls.at(-1)).toEqual({ method: "push", url: "/places", scroll: true });
  });
});
