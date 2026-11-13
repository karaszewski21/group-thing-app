import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as locationsApi from "../api/locations";
import * as organizationsApi from "../api/organizations";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import { AppDataProvider } from "../features/panel/AppDataContext";
import { GroupCreateView } from "../features/groups/GroupCreateView";
import { GroupEditView } from "../features/groups/GroupEditView";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "tok", username: "anna", logout: vi.fn() }),
}));
vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
  updateMyProfile: vi.fn(),
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
vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));
vi.mock("../api/organizations", () => ({ getMyOrganization: vi.fn() }));
vi.mock("../api/pledges", () => ({ getMyPledges: vi.fn(), withdrawPledge: vi.fn() }));
vi.mock("../api/itemListingPreferences", () => ({ setItemListingPreference: vi.fn() }));

const GROUP_ID = "6a1b2c3d-4e5f-4a6b-8c7d-0000000000a1";
const HINT = "Widoczny na stronie terminów grupy i w wyszukiwarce. Bez linków i danych kontaktowych.";
const TOO_LONG = "Opis może mieć najwyżej 500 znaków.";

const profile: peopleApi.UserProfileResponse = {
  id: "p1",
  party_id: "party-1",
  account_user_id: "u1",
  display_name: "Anna",
  email: null,
  bio: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_organizer: true,
  page_layout: "classic",
  palette_preset: null,
  primary_color: null,
  accent_color: null,
  media: [],
};

const leadership: groupsApi.LeadershipResponse = {
  id: "l1",
  from_role_id: "r1",
  to_group_id: GROUP_ID,
  organizer_party_id: "party-1",
  valid_from: "2026-01-01T00:00:00Z",
  valid_to: null,
};

const group: groupsApi.GroupResponse = {
  id: GROUP_ID,
  party_id: "group-party-1",
  name: "Mamy z Ruczaju",
  description: "Wymieniamy się ubrankami.",
  organizer_slug: "anna",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  default_location: null,
  default_capacity: null,
};

function renderCreate() {
  return renderWithRoute(
    <AppDataProvider>
      <GroupCreateView />
    </AppDataProvider>,
    { url: "/groups/new", pattern: "/groups/new", wrapper: createQueryWrapper() },
  );
}

function renderEdit() {
  return renderWithRoute(
    <AppDataProvider>
      <GroupEditView />
    </AppDataProvider>,
    { url: `/groups/${GROUP_ID}/edit`, pattern: "/groups/:groupId/edit", wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(profile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([leadership]);
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(groupsApi.getGroup).mockResolvedValue(group);
  vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([]);
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
});

describe("Group form — Opis", () => {
  it("counts code points after trim: an emoji counts 1 and surrounding spaces 0", async () => {
    renderCreate();
    const textarea = await screen.findByLabelText("Opis");

    fireEvent.change(textarea, { target: { value: "  ab😀  " } });

    expect(screen.getByText("3 / 500")).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(textarea).toHaveAttribute("id", "add-group-description");
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
  });

  it.each([
    ["create", renderCreate],
    ["edit", renderEdit],
  ])("the %s form places Opis between Nazwa grupy and Widoczność grupy", async (_name, render) => {
    render();
    const description = await screen.findByLabelText("Opis");
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;

    expect(screen.getByLabelText("Nazwa grupy").compareDocumentPosition(description) & follows).toBeTruthy();
    expect(description.compareDocumentPosition(screen.getByLabelText("Widoczność grupy")) & follows).toBeTruthy();
  });

  it("over 500 characters shows the inline alert, marks the textarea invalid and disables submit", async () => {
    renderCreate();
    fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: "Mamy z Ruczaju" } });
    const textarea = screen.getByLabelText("Opis");

    fireEvent.change(textarea, { target: { value: "a".repeat(500) } });
    expect(screen.getByRole("button", { name: "Dodaj grupę" })).toBeEnabled();

    fireEvent.change(textarea, { target: { value: "a".repeat(501) } });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(TOO_LONG);
    expect(screen.getByText("501 / 500")).toBeInTheDocument();
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    const describedBy = textarea.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(describedBy).toContain(alert.id);
    expect(describedBy).toContain(screen.getByText("501 / 500").id);
    expect(screen.getByRole("button", { name: "Dodaj grupę" })).toBeDisabled();
  });

  it("the create request sends the trimmed description, and a blank one as null", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue(group);
    renderCreate();
    fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: "Mamy z Ruczaju" } });
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: "Dodaj grupę" }));

    await waitFor(() =>
      expect(groupsApi.createAdditionalMyCircle).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Mamy z Ruczaju", description: null }),
      ),
    );
  });

  it("the create request sends a filled description trimmed", async () => {
    vi.mocked(groupsApi.createAdditionalMyCircle).mockResolvedValue(group);
    renderCreate();
    fireEvent.change(await screen.findByLabelText("Nazwa grupy"), { target: { value: "Mamy z Ruczaju" } });
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "  Ubranka i zabawki.  " } });

    fireEvent.click(screen.getByRole("button", { name: "Dodaj grupę" }));

    await waitFor(() =>
      expect(groupsApi.createAdditionalMyCircle).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Ubranka i zabawki." }),
      ),
    );
  });

  it("the edit form prefills the description and PATCHes the changed one", async () => {
    vi.mocked(groupsApi.updateGroup).mockResolvedValue(group);
    renderEdit();
    const textarea = await screen.findByLabelText("Opis");
    expect(textarea).toHaveValue("Wymieniamy się ubrankami.");
    expect(textarea).toHaveAttribute("id", "edit-group-description");

    fireEvent.change(textarea, { target: { value: "Nowy opis grupy." } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(groupsApi.updateGroup).toHaveBeenCalledWith(
        GROUP_ID,
        expect.objectContaining({ name: "Mamy z Ruczaju", description: "Nowy opis grupy." }),
      ),
    );
  });

  it("a server 400 message is shown verbatim in the banner", async () => {
    const message = "Opis grupy narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(groupsApi.updateGroup).mockRejectedValue(new ApiError(400, "Bad Request", { message }));
    renderEdit();
    await screen.findByLabelText("Opis");

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText(/w moderacji/i)).not.toBeInTheDocument();
  });
});
