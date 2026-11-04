import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as locationsApi from "../api/locations";
import { LocationPicker, type FallbackLocation } from "../components/shared/LocationPicker";
import type { PickedLocationState } from "../utils/appHelpers";
import { makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { getTestRouter, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

const KETY = makeLocationResponse();
const POLNA = makeLocationResponse({
  id: "loc-2",
  locality: makeLocality({ id: "0969400", name: "Poznań", gmina: "Poznań", powiat: "Poznań", voivodeship: "wielkopolskie" }),
  label: "Poznań — ul. Polna 12",
  formatted_address: "ul. Polna 12",
  source: "MANUAL",
});

interface HarnessProps {
  initial?: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
  invalid?: boolean;
  fallbackLocation?: FallbackLocation | null;
  onAddClick?: () => void;
}

function Harness({ initial = null, onChange, ...rest }: HarnessProps) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <LocationPicker
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      label="Lokalizacja"
      noneLabel="Brak miejsca"
      idPrefix="test"
      {...rest}
    />
  );
}

function renderPicker(props: HarnessProps, url = "/form", state?: PickedLocationState) {
  return renderWithRoute(<Harness {...props} />, { url, state, wrapper: createQueryWrapper() });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("LocationPicker", () => {
  it("required: no none option, a disabled 'Wybierz miejsce' placeholder, labels as options and the selected place's detail", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, POLNA]);
    const onChange = vi.fn();
    renderPicker({ onChange, required: true });

    const select = await screen.findByRole("combobox", { name: "Lokalizacja" });
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Wybierz miejsce", "Kęty, małopolskie", "Poznań — ul. Polna 12"]);
    expect(options[0]).toBeDisabled();
    expect(select).toHaveValue("");
    expect(screen.queryByText("Brak miejsca")).not.toBeInTheDocument();
    expect(select).not.toHaveAttribute("aria-invalid");

    fireEvent.change(select, { target: { value: "loc-1" } });
    expect(onChange).toHaveBeenLastCalledWith("loc-1");
    expect(screen.getByText("gm. Kęty, pow. oświęcimski, małopolskie")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "loc-2" } });
    expect(screen.getByText("ul. Polna 12")).toBeInTheDocument();
  });

  it("invalid: aria-invalid and aria-describedby point at the 'Wybierz lokalizację' alert", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY]);
    renderPicker({ onChange: vi.fn(), required: true, invalid: true });

    const select = await screen.findByRole("combobox", { name: "Lokalizacja" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Wybierz lokalizację");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", alert.id);
  });

  it("required with no places: 'Nie masz jeszcze miejsc', the '+' link and the helper", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderPicker({ onChange: vi.fn(), required: true });

    const select = await screen.findByRole("combobox", { name: "Lokalizacja" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Nie masz jeszcze miejsc"]);
    expect(screen.getByRole("link", { name: "Dodaj nowe miejsce" })).toBeInTheDocument();
    expect(
      screen.getByText("Dodaj miejsce przyciskiem „+”. Wrócisz tu z zachowanymi danymi i zdjęciami."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Nazwa miejsca")).not.toBeInTheDocument();
  });

  it("'+' replaces this entry with /places/new (returnTo + picker), running onAddClick first", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY]);
    let callsAtAddClick = -1;
    const onAddClick = vi.fn(() => {
      callsAtAddClick = getTestRouter().calls.length;
    });
    renderPicker({ onChange: vi.fn(), onAddClick }, "/items/1/edit?x=1");

    const add = await screen.findByRole("link", { name: "Dodaj nowe miejsce" });
    const href = "/places/new?returnTo=%2Fitems%2F1%2Fedit%3Fx%3D1&picker=test";
    expect(add).toHaveAttribute("href", href);
    fireEvent.click(add);

    expect(onAddClick).toHaveBeenCalledTimes(1);
    expect(callsAtAddClick).toBe(0);
    expect(getTestRouter().calls).toEqual([{ method: "replace", url: href, scroll: true }]);
  });

  it("a pick handed back to this picker is applied once; another picker's is ignored", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, POLNA]);
    const onChange = vi.fn();
    const other = renderPicker({ onChange, required: true }, "/form", {
      pickedLocation: { picker: "other", locationId: POLNA.id },
    });
    await screen.findByRole("combobox", { name: "Lokalizacja" });
    expect(onChange).not.toHaveBeenCalled();
    other.unmount();

    const { rerender } = renderPicker({ onChange, required: true }, "/form", {
      pickedLocation: { picker: "test", locationId: POLNA.id },
    });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Lokalizacja" })).toHaveValue(POLNA.id));
    rerender(<Harness onChange={onChange} required />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(POLNA.id);
  });

  it("a null pick (cancelled on /places/new) leaves the value unchanged", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, POLNA]);
    const onChange = vi.fn();
    renderPicker({ onChange, required: true, initial: KETY.id }, "/form", {
      pickedLocation: { picker: "test", locationId: null },
    });

    const select = await screen.findByRole("combobox", { name: "Lokalizacja" });
    expect(select).toHaveValue(KETY.id);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists a selected fallback place missing from own places, '(usunięte)' when soft-deleted", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY]);
    renderPicker({
      initial: "loc-gone",
      onChange: vi.fn(),
      fallbackLocation: { id: "loc-gone", label: "Kęty — ul. Stara 1", deleted_at: "2026-10-10T10:00:00" },
    });

    const select = await screen.findByRole("combobox", { name: "Lokalizacja" });
    expect(select).toHaveValue("loc-gone");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Brak miejsca",
      "Kęty, małopolskie",
      "Kęty — ul. Stara 1 (usunięte)",
    ]);
  });
});
