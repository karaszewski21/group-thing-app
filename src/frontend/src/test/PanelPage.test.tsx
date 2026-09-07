import { render, screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

// TODO(Group 8): this unit suite can only exercise the hamburger-promotion
// click-through and item-dialog rework at the component level — if the
// project wires up Playwright, add an end-to-end pass over the full GUEST
// "Chcę dodać krąg" → submit → organizer-view flow there.

import * as peopleApi from "../api/people";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as productsApi from "../api/products";
import * as termsApi from "../api/terms";
import { PanelPage } from "../pages/panel/PanelPage";

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      token: "test-token",
      username: "guest",
      displayName: "Jan Kowalski",
      permissions: [],
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    })),
  };
});

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getProfile: vi.fn(),
  getProfileByParty: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
}));

vi.mock("../api/families", () => ({
  getMyFamilies: vi.fn(),
  getMembershipsForFamily: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
  endLeadership: vi.fn(),
  getGroup: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
  getInventoryItems: vi.fn(),
  registerInventoryItem: vi.fn(),
}));

vi.mock("../api/products", () => ({
  createProduct: vi.fn(),
  getProducts: vi.fn(),
  resolveProduct: vi.fn(),
}));

vi.mock("../api/terms", () => ({
  getTerms: vi.fn(),
  getNeededItems: vi.fn(),
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
}));

const mockProfile: peopleApi.UserProfileResponse = {
  id: 1,
  party_id: 1,
  account_user_id: 1,
  display_name: "Jan Kowalski",
  email: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockInventory: inventoriesApi.InventoryResponse = {
  id: 1,
  owner_user_id: 1,
  inventory_type: "PERSONAL",
  location: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockGroup: groupsApi.GroupResponse = {
  id: 5,
  party_id: 2,
  name: "Nowa grupa",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <PanelPage />
    </MemoryRouter>,
  );
}

function mockGuestDefaults() {
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockProfile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([]);
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(familiesApi.getMembershipsForFamily).mockResolvedValue([]);
}

function mockOrganizerDefaults() {
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockProfile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
    { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
  ]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([]);
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
  vi.mocked(termsApi.getTerms).mockResolvedValue([]);
  vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
}

async function openMenu() {
  const menuButton = await screen.findByRole("button", { name: "Menu" });
  fireEvent.click(menuButton);
}

describe("PanelPage — hamburger promotion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows "Chcę dodać krąg" as a menuitem for a GUEST session (isOrganizer === false)', async () => {
    mockGuestDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", { name: /Chcę dodać krąg/ });
    expect(item).toBeInTheDocument();
  });

  it('hides "Chcę dodać krąg" when the session is already an organizer', async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Chcę dodać krąg/ })).not.toBeInTheDocument();
    // sanity: the two pre-existing items are still there
    expect(within(menu).getByRole("menuitem", { name: /Profil/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Ustawienia/ })).toBeInTheDocument();
  });

  it('clicking "Chcę dodać krąg" opens the existing "+ Dodaj grupę" modal', async () => {
    mockGuestDefaults();
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Chcę dodać krąg/ }));

    expect(await screen.findByRole("dialog", { name: "Dodaj nową grupę" })).toBeInTheDocument();
  });

  it("submitting that sheet calls createMyCircle and flips isOrganizer to true after reload", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroup);
    renderPanel();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Chcę dodać krąg/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj nową grupę" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });

    // Next load() (triggered post-submit) should see an active leadership,
    // flipping isOrganizer to true.
    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj grupę" }));

    await waitFor(() => expect(groupsApi.createMyCircle).toHaveBeenCalledWith({ name: "Nutki" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openMenu();
    const menu = screen.getByRole("menu");
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: /Chcę dodać krąg/ })).not.toBeInTheDocument(),
    );
  });
});

describe("PanelPage — item add dialog rework", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('the "+ Dodaj rzecz" modal renders ItemQuickAddForm (3 fields, no product dropdown)', async () => {
    mockGuestDefaults();
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj rzecz" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj rzecz" });
    expect(within(dialog).getByLabelText("Nazwa")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Stan")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Typ")).toBeInTheDocument();
    expect(within(dialog).queryByText("+ inny przedmiot")).not.toBeInTheDocument();
  });

  it("submitting it calls resolveProduct then registerInventoryItem with the resolved product_id", async () => {
    mockGuestDefaults();
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: 42,
      name: "Rowerek",
      description: null,
      photoUrl: null,
      price: 0,
      sku: "SKU",
      category: "TOY",
      pluginData: null,
      createdAt: "",
      updatedAt: "",
    });
    vi.mocked(inventoriesApi.registerInventoryItem).mockResolvedValue({
      id: 1,
      inventory_id: 1,
      product_id: 42,
      condition: "GOOD",
      added_at: "",
      created_at: "",
      updated_at: "",
    });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Moje rzeczy" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Dodaj rzecz" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj rzecz" });
    fireEvent.change(within(dialog).getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj rzecz" }));

    await waitFor(() =>
      expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Rowerek", category: "OTHER" }),
    );
    await waitFor(() =>
      expect(inventoriesApi.registerInventoryItem).toHaveBeenCalledWith({
        inventory_id: 1,
        product_id: 42,
        condition: "GOOD",
      }),
    );
  });
});
