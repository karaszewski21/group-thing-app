import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import type { GroupResponse } from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as locationsApi from "../api/locations";
import * as organizationsApi from "../api/organizations";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as pointsApi from "../api/points";
import * as termsApi from "../api/terms";
import { AppDataProvider } from "../features/panel/AppDataContext";
import { AddTermView } from "../features/terms/AddTermView";
import { makeLocationRef, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { routeWrapper } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "tok", username: "anna", logout: vi.fn() }),
}));
vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
  deleteMyAvatar: vi.fn(),
}));
vi.mock("../api/families", () => ({
  getMyFamilies: vi.fn(),
  getGuardians: vi.fn(),
  getMembershipsForFamily: vi.fn(),
  createLightweightMembers: vi.fn(),
  removeFamilyMember: vi.fn(),
  renameFamily: vi.fn(),
  updateChildBirthYear: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getMyAttendances: vi.fn(),
  createAdditionalMyCircle: vi.fn(),
  deleteGroup: vi.fn(),
  updateGroup: vi.fn(),
}));
vi.mock("../api/inventories", () => ({
  ACTIVE_LOCK_BALANCE_STATUSES: [],
  getMyInventoryItems: vi.fn(),
  getInventoryItemBalance: vi.fn(),
  deleteInventoryItem: vi.fn(),
}));
vi.mock("../api/organizations", () => ({ getMyOrganization: vi.fn() }));
vi.mock("../api/pledges", () => ({ getMyPledges: vi.fn(), withdrawPledge: vi.fn() }));
vi.mock("../api/itemListingPreferences", () => ({ setItemListingPreference: vi.fn() }));
vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));
vi.mock("../api/points", () => ({ getAttendanceRules: vi.fn() }));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
  getTerms: vi.fn(),
  getNeededItemsForTerms: vi.fn(),
}));

const place = makeLocationResponse({ id: "loc-1" });

const group: GroupResponse = {
  id: "g1",
  party_id: "gp1",
  name: "Mamy z Mokotowa",
  description: null,
  organizer_slug: "mamy",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-11-01T10:00:00",
  updated_at: "2026-11-01T10:00:00",
  default_location: makeLocationRef({ id: "loc-1" }),
  default_capacity: null,
  default_price: null,
  default_payment_url: null,
  default_payment_method: null,
};

function renderAddTerm() {
  const RouteWrapper = routeWrapper({ url: "/add/term", wrapper: createQueryWrapper() });
  return render(
    <RouteWrapper>
      <AppDataProvider>
        <AddTermView />
      </AppDataProvider>
    </RouteWrapper>,
  );
}

const MY_PROFILE: peopleApi.MyProfileResponse = {
  id: "p1",
  party_id: "p1",
  account_user_id: "u1",
  display_name: "Anna",
  email: null,
  bio: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_organizer: false,
  page_layout: "BANNER",
  palette_preset: null,
  primary_color: null,
  accent_color: null,
  media: [],
  email_verified: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(MY_PROFILE);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
    { id: "l1", from_role_id: "r1", to_group_id: "g1", organizer_party_id: "p1", valid_from: "2026-01-01", valid_to: null },
  ]);
  vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
  vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([]);
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([place]);
  vi.mocked(pointsApi.getAttendanceRules).mockResolvedValue({ levels: [5, 10, 20], min_present: 3, auto_close_days: 7 });
  vi.mocked(termsApi.createTerm).mockResolvedValue({ id: "t1", group_id: "g1", occurs_on: "2026-12-06T10:00:00" } as termsApi.TermResponse);
});

describe("AddTermView — points for attendance", () => {
  it("defaultsToTheLowestLevel_andSendsIt", async () => {
    renderAddTerm();

    const picker = await screen.findByRole("group", { name: "Punkty za obecność" });
    await waitFor(() =>
      expect(within(picker).getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(picker).getAllByRole("button").map((b) => b.textContent)).toEqual(["5", "10", "20"]);
    expect(picker).toHaveAccessibleDescription(
      "Każda obecna osoba dostanie tyle punktów, jeśli przyjdą co najmniej 3 osoby. Możesz zmienić wybór do zatwierdzenia obecności.",
    );

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-1"));
    fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-12-06T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    expect(termsApi.createTerm).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: "g1", occurs_on: "2026-12-06T10:00", attendance_points: 5 }),
    );
  });

  it("aPickedLevel_isSent", async () => {
    renderAddTerm();

    const picker = await screen.findByRole("group", { name: "Punkty za obecność" });
    fireEvent.click(within(picker).getByRole("button", { name: "20" }));
    expect(within(picker).getByRole("button", { name: "20" })).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Miejsce" })).toHaveValue("loc-1"));
    fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-12-06T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith(expect.objectContaining({ attendance_points: 20 })),
    );
  });
});
