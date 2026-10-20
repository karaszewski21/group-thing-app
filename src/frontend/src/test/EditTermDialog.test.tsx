import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as categoriesApi from "../api/categories";
import * as groupsApi from "../api/groups";
import * as locationsApi from "../api/locations";
import type { LocationResponse } from "../api/locations";
import * as productsApi from "../api/products";
import * as termsApi from "../api/terms";
import { EditTermDialog } from "../components/panel/EditTermDialog";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));
vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
}));
vi.mock("../api/terms", () => ({
  createNeededItem: vi.fn(),
  deleteNeededItem: vi.fn(),
  updateNeededItem: vi.fn(),
  updateTerm: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  formalizeGroupFromTerm: vi.fn(),
  getTermAttendeesForFormalization: vi.fn(),
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

const term: termsApi.TermResponse = {
  id: "t1",
  circle_group_id: "g1",
  occurs_on: "2026-10-14T17:00:00",
  description: "Park Sołacki",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  attendee_count: 0,
  child_count: 0,
  location: salaNr2,
  capacity: 10,
};

const group: groupsApi.GroupResponse = {
  id: "g1",
  party_id: "p1",
  name: "Nutki",
  organizer_slug: null,
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  default_location: groupDefault,
  default_capacity: 20,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const neededItem: termsApi.NeededItemResponse = {
  id: "ni1",
  term_id: "t1",
  product_id: "pr1",
  product_name: "Rower",
  product_category_id: "c1",
  product_category_name: "Zabawki",
  description: null,
  claimed: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderDialog() {
  return render(
    <EditTermDialog
      term={term}
      neededItems={[neededItem]}
      group={group}
      onChanged={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue([
    {
      id: "c1",
      name: "Zabawki",
      description: null,
      sortOrder: 0,
      productCount: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ]);
  vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([salaNr2, groupDefault]);
});

describe("EditTermDialog — server error surfacing", () => {
  it("saveEdit_rejectedName_showsItemsErrorAndKeepsRowEditorOpen", async () => {
    const rejection = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(productsApi.resolveProduct).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Zła nazwa" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Nazwa rzeczy")).toHaveValue("Zła nazwa");
    expect(termsApi.updateNeededItem).not.toHaveBeenCalled();
  });

  it("updateTerm_rejectedDescription_showsFormErrorAlert", async () => {
    const rejection = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.updateTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderDialog();

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
    renderDialog();

    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Nowy opis" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(unavailable);
  });
});

describe("EditTermDialog — place and capacity", () => {
  it("initialState_showsTermValuesNotGroupDefaults", async () => {
    renderDialog();

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-2");
    expect(select).toHaveDisplayValue("Sala nr 2");
    expect(within(select).getByRole("option", { name: "Świetlica na Polnej" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ile miejsc")).toHaveValue(10);
  });

  it("saveTermFields_clearedPlace_sendsOnlyLocationIdNull", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    renderDialog();

    fireEvent.change(await screen.findByRole("combobox", { name: "Miejsce" }), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByText("Zapisano")).toBeInTheDocument();
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { location_id: null });
  });

  it("saveTermFields_changedCapacity_sendsOnlyCapacity", async () => {
    vi.mocked(termsApi.updateTerm).mockResolvedValue(term);
    renderDialog();

    expect(await screen.findByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-2");
    fireEvent.change(screen.getByLabelText("Ile miejsc"), { target: { value: "8" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByText("Zapisano")).toBeInTheDocument();
    expect(termsApi.updateTerm).toHaveBeenCalledWith("t1", { capacity: 8 });
  });

  it("deletedTermLocation_rendersUsunieteRow", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([groupDefault]);
    renderDialog();

    const select = await screen.findByRole("combobox", { name: "Miejsce" });
    expect(select).toHaveValue("loc-2");
    expect(select).toHaveDisplayValue("Sala nr 2 (usunięte)");
  });
});
