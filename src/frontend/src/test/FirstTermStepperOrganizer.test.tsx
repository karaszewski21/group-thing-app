import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import * as termsApi from "../api/terms";
import { ApiError } from "../api/client";
import { FirstTermStepperOrganizer } from "../components/panel/FirstTermStepperOrganizer";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({ createTerm: vi.fn() }));
vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok" }) }));

const SWIETLICA: LocationResponse = {
  id: "loc-1",
  owner_party_id: "party-1",
  name: "Świetlica na Polnej",
  formatted_address: "ul. Polna 12, 60-595 Poznań",
  google_place_id: null,
  lat: null,
  lng: null,
  notes: null,
  source: "MANUAL",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
  deleted_at: null,
};

function renderStepper(
  onDone = vi.fn(),
  defaults: { defaultLocation?: LocationResponse | null; defaultCapacity?: number | null } = {},
) {
  render(
    <MemoryRouter>
      <FirstTermStepperOrganizer
        onClose={vi.fn()}
        circleGroupId="g-1"
        organizerSlug={null}
        onDone={onDone}
        {...defaults}
      />
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
  return onDone;
}

function fillAndSubmit(description: string) {
  fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-10-10T10:00" } });
  fireEvent.change(screen.getByLabelText("Opis (opcjonalnie)"), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([SWIETLICA]);
});

describe("FirstTermStepperOrganizer — server error message", () => {
  it("shows the server's 400 moderation message in role=alert and keeps the form", async () => {
    const message = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.createTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { status: 400, error: "Bad Request", message }),
    );
    const onDone = renderStepper();
    fillAndSubmit("zły opis");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Opis (opcjonalnie)")).toHaveValue("zły opis");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to the generic Polish message for a non-domain error", async () => {
    vi.mocked(termsApi.createTerm).mockRejectedValue(new ApiError(500, "Server Error", null));
    renderStepper();
    fillAndSubmit("opis");

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się dodać terminu — spróbuj ponownie");
  });
});

describe("FirstTermStepperOrganizer — place and capacity", () => {
  it("createTerm_prefilledGroupDefaults_sendsLocationAndCapacity", async () => {
    vi.mocked(termsApi.createTerm).mockResolvedValue({ id: "t-1" } as termsApi.TermResponse);
    renderStepper(vi.fn(), { defaultLocation: SWIETLICA, defaultCapacity: 12 });

    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveDisplayValue("Świetlica na Polnej");
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue(12);
    fillAndSubmit("opis");

    expect(await screen.findByRole("button", { name: "Gotowe" })).toBeInTheDocument();
    expect(termsApi.createTerm).toHaveBeenCalledWith({
      circle_group_id: "g-1",
      occurs_on: "2026-10-10T10:00",
      description: "opis",
      location_id: "loc-1",
      capacity: 12,
    });
  });

  it("createTerm_clearedPrefilledCapacity_sendsExplicitNull", async () => {
    vi.mocked(termsApi.createTerm).mockResolvedValue({ id: "t-1" } as termsApi.TermResponse);
    renderStepper(vi.fn(), { defaultLocation: SWIETLICA, defaultCapacity: 12 });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveDisplayValue("Świetlica na Polnej");
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "" } });
    fireEvent.change(select, { target: { value: "" } });
    fillAndSubmit("opis");

    expect(await screen.findByRole("button", { name: "Gotowe" })).toBeInTheDocument();
    expect(termsApi.createTerm).toHaveBeenCalledWith({
      circle_group_id: "g-1",
      occurs_on: "2026-10-10T10:00",
      description: "opis",
      location_id: null,
      capacity: null,
    });
  });
});
