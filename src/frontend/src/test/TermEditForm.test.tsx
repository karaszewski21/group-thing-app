import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as locationsApi from "../api/locations";
import type { LocationRefResponse, LocationResponse } from "../api/locations";
import * as termsApi from "../api/terms";
import { TermEditForm } from "../components/panel/TermEditForm";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({
  createNeededItem: vi.fn(),
  deleteNeededItem: vi.fn(),
  updateNeededItem: vi.fn(),
  updateTerm: vi.fn(),
}));
vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok" }) }));

const salaNr2: LocationResponse = {
  id: "loc-2",
  owner_party_id: "party-1",
  name: "Sala nr 2",
  formatted_address: "ul. Szkolna 2, Poznań",
  google_place_id: null,
  lat: null,
  lng: null,
  notes: null,
  source: "MANUAL",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const groupDefault: LocationResponse = { ...salaNr2, id: "loc-9", name: "Świetlica na Polnej" };

/** The nested group/term view of a saved place. */
function locationRef({ id, name, formatted_address, google_place_id, notes, deleted_at }: LocationResponse): LocationRefResponse {
  return { id, name, formatted_address, google_place_id, notes, deleted_at };
}

const term: termsApi.TermResponse = {
  id: "t1",
  circle_group_id: "g1",
  occurs_on: "2026-10-14T17:00:00",
  description: "Park Sołacki",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  attendee_count: 0,
  child_count: 0,
  location: locationRef(salaNr2),
  capacity: 10,
};

const neededItem: termsApi.NeededItemResponse = {
  id: "ni1",
  term_id: "t1",
  name: "Rower",
  description: null,
  claimed: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderForm(shownTerm: termsApi.TermResponse = term, onChanged = vi.fn(), onDone = vi.fn()) {
  return render(
    <MemoryRouter>
      <TermEditForm
        term={shownTerm}
        neededItems={[neededItem]}
        onChanged={onChanged}
        onDone={onDone}
      />
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([salaNr2, groupDefault]);
});

describe("TermEditForm — server error surfacing", () => {
  it("saveEdit_rejectedName_showsItemsErrorAndKeepsRowEditorOpen", async () => {
    const rejection = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(termsApi.updateNeededItem).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Zła nazwa" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Nazwa rzeczy")).toHaveValue("Zła nazwa");
    expect(termsApi.updateNeededItem).toHaveBeenCalledWith("ni1", { name: "Zła nazwa", description: "" });
  });

  it("updateTerm_rejectedDescription_showsFormErrorAlert", async () => {
    const rejection = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.updateTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderForm();

    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Zły opis" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Opis")).toHaveValue("Zły opis");
  });

  it("updateTerm_moderationUnavailable_showsServerMessage", async () => {
    const unavailable = "Moderacja jest chwilowo niedostępna — spróbuj za chwilę.";
    vi.mocked(termsApi.updateTerm).mockRejectedValue(
      new ApiError(503, "Service Unavailable", { message: unavailable }),
    );
    renderForm();

    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Nowy opis" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(unavailable);
  });
});

describe("TermEditForm — needed items as plain names", () => {
  it("render_listsNamesWithDangerRemove_andNoCategoryField", async () => {
    renderForm();
    await screen.findByRole("combobox", { name: "Miejsce" });

    expect(screen.getByText("Potrzebne rzeczy")).toBeInTheDocument();
    expect(screen.getByText("Rower")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń potrzebną rzecz" })).toHaveClass("text-danger");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    expect(screen.getByLabelText("Nazwa nowej rzeczy")).toHaveAttribute("placeholder", "np. Termos");
    expect(screen.queryByLabelText(/^Typ/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("addItem_sendsTermIdNameAndDescription", async () => {
    vi.mocked(termsApi.createNeededItem).mockResolvedValue(neededItem);
    const onChanged = vi.fn();
    renderForm(term, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Dodaj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa nowej rzeczy"), { target: { value: "  Termos " } });
    fireEvent.change(screen.getByLabelText("Doprecyzowanie nowej rzeczy"), { target: { value: "1 l" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(termsApi.createNeededItem).toHaveBeenCalledWith({ term_id: "t1", name: "Termos", description: "1 l" });
  });

  it("saveEdit_unchangedName_sendsOnlyDescription", async () => {
    vi.mocked(termsApi.updateNeededItem).mockResolvedValue(neededItem);
    const onChanged = vi.fn();
    renderForm(term, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Doprecyzowanie rzeczy"), { target: { value: "dla 3-latka" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[1]);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(termsApi.updateNeededItem).toHaveBeenCalledWith("ni1", { description: "dla 3-latka" });
  });
});

describe("TermEditForm — place and capacity", () => {
  it("render_noStandingMembersSection", async () => {
    renderForm();

    expect(await screen.findByLabelText("Miejsce")).toBeInTheDocument();
    expect(screen.queryByText("Formalizuj stałych członków")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ustal stałych członków" })).not.toBeInTheDocument();
  });

  it("initialState_showsTermValuesNotGroupDefaults", async () => {
    renderForm();

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-2");
    expect(select).toHaveDisplayValue("Sala nr 2");
    expect(within(select).getByRole("option", { name: "Świetlica na Polnej" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue("10");
  });

  it("saveTermFields_clearedPlace_sendsOnlyLocationIdNull", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    const onDone = vi.fn();
    renderForm(term, vi.fn(), onDone);

    fireEvent.change(await screen.findByRole("combobox", { name: "Miejsce" }), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { location_id: null });
  });

  it("saveTermFields_changedCapacity_sendsOnlyCapacity", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    const onDone = vi.fn();
    renderForm(term, vi.fn(), onDone);

    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-2");
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "8" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { capacity: 8 });
  });

  it.each(["0", "-1", "2.5", "10001"])("saveTermFields_invalidCapacity_%s_showsInlineErrorAndBlocksSave", async (raw) => {
    renderForm();

    await screen.findByRole("combobox", { name: "Miejsce" });
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: raw } });

    expect(screen.getByRole("alert")).toHaveTextContent("Podaj liczbę od 1 do 10000");
    const save = screen.getAllByRole("button", { name: "Zapisz" })[0];
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(termsApi.updateTerm).not.toHaveBeenCalled();
  });

  it("deletedTermLocation_rendersUsunieteRow", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([groupDefault]);
    renderForm({ ...term, location: { ...locationRef(salaNr2), deleted_at: "2026-10-10T10:00:00Z" } });

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-2");
    expect(select).toHaveDisplayValue("Sala nr 2 (usunięte)");
  });
});
