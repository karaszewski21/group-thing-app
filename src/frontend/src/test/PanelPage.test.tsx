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
import * as organizationsApi from "../api/organizations";
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
  getGuardians: vi.fn(),
  createLightweightMembers: vi.fn(),
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

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
}));

const mockProfile: peopleApi.UserProfileResponse = {
  id: 1,
  party_id: 1,
  account_user_id: 1,
  display_name: "Jan Kowalski",
  email: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_organizer: false,
};

const mockOrganizerProfile: peopleApi.UserProfileResponse = {
  ...mockProfile,
  is_organizer: true,
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

const mockFamily: familiesApi.FamilyOut = {
  id: 10,
  party_id: 99,
  name: "Kowalscy",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockGuardians: familiesApi.GuardianResponse[] = [
  {
    family_membership_id: 1,
    party_id: 1, // matches mockProfile.party_id — "(Ty)"
    user_profile_id: 1,
    display_name: "Jan Kowalski",
    email: null,
    is_primary_contact: true,
    valid_from: "2026-01-01",
    valid_to: null,
  },
  {
    family_membership_id: 2,
    party_id: 2,
    user_profile_id: 2,
    display_name: "Marek Kowalski",
    email: null,
    is_primary_contact: false,
    valid_from: "2026-01-01",
    valid_to: null,
  },
];

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
  vi.mocked(familiesApi.getGuardians).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
}

function mockOrganizerDefaults() {
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockOrganizerProfile);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
    { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
  ]);
  vi.mocked(inventoriesApi.getInventories).mockResolvedValue([mockInventory]);
  vi.mocked(inventoriesApi.getInventoryItems).mockResolvedValue([]);
  vi.mocked(productsApi.getProducts).mockResolvedValue([]);
  vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
  vi.mocked(termsApi.getTerms).mockResolvedValue([]);
  vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(familiesApi.getGuardians).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
}

async function openMenu() {
  const menuButton = await screen.findByRole("button", { name: "Menu" });
  fireEvent.click(menuButton);
}

describe("PanelPage — hamburger promotion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows "Dodaj pierwszy termin" (not "Chcę dodać krąg") for a GUEST-without-circle session and opens FirstTermStepperGuest', async () => {
    mockGuestDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Dodaj pierwszy termin/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Chcę dodać krąg/ })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    // GUEST variant: 2-step, starts on "Nazwa kręgu"
    expect(within(dialog).getByPlaceholderText("np. Nutki dla starszaków")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dalej →" })).toBeInTheDocument();
  });

  it('shows "Dodaj pierwszy termin" (1-step) for an ORGANIZER-with-zero-terms session and opens FirstTermStepperOrganizer', async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Dodaj pierwszy termin/ })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    // ORGANIZER variant: 1-step, term fields only, no circle-name field
    expect(within(dialog).queryByPlaceholderText("np. Nutki dla starszaków")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Dodaj termin" })).toBeInTheDocument();
  });

  it('shows neither hamburger item for an ORGANIZER who already has terms', async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Dodaj pierwszy termin/ })).not.toBeInTheDocument();
  });

  it('shows "Moja organizacja" (linking to /organization) for an organizer session with no Organization yet', async () => {
    mockOrganizerDefaults();
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    const link = within(menu).getByRole("menuitem", { name: /Moja organizacja/ });
    expect(link).toHaveAttribute("href", "/organization");
  });

  it('"Moja organizacja" links directly to the public organization page once one already exists', async () => {
    mockOrganizerDefaults();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({
      id: 1,
      party_id: 1,
      name: "Muzyczne Skrzaty",
      slug: "muzyczne-skrzaty",
      primary_color: null,
      accent_color: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();
    await openMenu();

    const menu = screen.getByRole("menu");
    const link = within(menu).getByRole("menuitem", { name: /Moja organizacja/ });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty");
  });

  it("completing the GUEST 2-step flow calls createMyCircle then createTerm and flips isOrganizer to true after reload", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });

    // Step 1 -> step 2 immediately triggers a `load()` refresh (via
    // onCircleCreated) so a reopened menu already reflects the new circle.
    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));
    await waitFor(() => expect(groupsApi.createMyCircle).toHaveBeenCalledWith({ name: "Nutki" }));

    const dateInput = await within(dialog).findByLabelText("Data");
    fireEvent.change(dateInput, { target: { value: "2026-02-01" } });

    // After the term is created, the final (non-silent) `load()` re-fetches
    // terms — reflect that a term now exists so the hamburger item's
    // `terms.length === 0` gate correctly hides it below.
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(termsApi.createTerm).toHaveBeenCalledWith({
        circle_group_id: mockGroup.id,
        occurs_on: "2026-02-01",
        description: undefined,
      }),
    );

    // Dialog stays open, offering a switch to the public circle page,
    // instead of closing immediately.
    const publicLink = await within(dialog).findByRole("link", { name: /Przejdź do publicznej strony/ });
    expect(publicLink).toHaveAttribute("href", `/krag/${mockGroup.id}/publiczny`);

    fireEvent.click(within(dialog).getByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openMenu();
    const menu = screen.getByRole("menu");
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: /Dodaj pierwszy termin/ })).not.toBeInTheDocument(),
    );
  });

  it("shows an inline error (not a silent failure) when createMyCircle rejects in the GUEST stepper", async () => {
    // Regression test for a code-review finding: FirstTermStepperGuest's
    // handleStep1 had no catch block, so a failed createMyCircle call
    // became an unhandled promise rejection with no user-facing feedback.
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockRejectedValue(new Error("network error"));
    renderPanel();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Dodaj pierwszy termin/ }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));

    expect(
      await within(dialog).findByText("Nie udało się utworzyć kręgu — spróbuj ponownie"),
    ).toBeInTheDocument();
    // Dialog stays open on failure — no silent close/no-op.
    expect(screen.getByRole("dialog", { name: "Dodaj pierwszy termin" })).toBeInTheDocument();
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

describe("PanelPage — dismissible home hints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it("GUEST hint renders on Panel home and dismiss persists across a re-mount via localStorage", async () => {
    mockGuestDefaults();
    const { unmount } = renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_first_term_dismissed")).toBe("1");

    unmount();
    mockGuestDefaults();
    renderPanel();
    await screen.findByRole("heading", { name: /Cześć/ });
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
  });

  it("both ORGANIZER hints render stacked (org-polish first, first-term second) and dismiss independently via their own localStorage keys", async () => {
    mockOrganizerDefaults();
    renderPanel();

    await screen.findByText("Dopracuj stronę organizacji");
    const html = document.body.innerHTML;
    expect(html.indexOf("Dopracuj stronę organizacji")).toBeLessThan(
      html.indexOf("Dodaj swój pierwszy termin"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dopracuj stronę organizacji" }));
    expect(screen.queryByText("Dopracuj stronę organizacji")).not.toBeInTheDocument();
    expect(screen.getByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
    expect(localStorage.getItem("hint_org_polish_dismissed")).toBe("1");
    expect(localStorage.getItem("hint_first_term_dismissed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij: Dodaj swój pierwszy termin" }));
    expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint_first_term_dismissed")).toBe("1");
  });

  it("ORGANIZER first-term hint auto-hides once terms.length > 0, with no manual dismiss needed", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    renderPanel();

    await screen.findByText("Dopracuj stronę organizacji");
    expect(screen.queryByText("Ustal pierwsze zajęcia w swoim kręgu.")).not.toBeInTheDocument();
  });

  it('org-polish hint\'s CTA links to "/organization" when no Organization exists yet', async () => {
    mockOrganizerDefaults();
    renderPanel();

    const link = await screen.findByRole("link", { name: "Przejdź →" });
    expect(link).toHaveAttribute("href", "/organization");
  });

  it("org-polish hint's CTA links directly to the public organization page once one already exists", async () => {
    mockOrganizerDefaults();
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue({
      id: 1,
      party_id: 1,
      name: "Muzyczne Skrzaty",
      slug: "muzyczne-skrzaty",
      primary_color: null,
      accent_color: null,
      created_at: "",
      updated_at: "",
    });
    renderPanel();

    const link = await screen.findByRole("link", { name: "Przejdź →" });
    expect(link).toHaveAttribute("href", "/muzyczne-skrzaty");
  });

  // --- Group 11 gap review: cross-group composition (Group 6 stepper + Group 7 hint) ---

  it("GUEST hint auto-disappears after completing the real 2-step first-term stepper (isOrganizer flip, not a manual dismiss)", async () => {
    mockGuestDefaults();
    vi.mocked(groupsApi.createMyCircle).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();

    expect(await screen.findByText("Dodaj swój pierwszy termin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zacznijmy →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    fireEvent.change(within(dialog).getByPlaceholderText("np. Nutki dla starszaków"), {
      target: { value: "Nutki" },
    });

    vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([
      { id: 1, from_role_id: 1, to_group_id: 5, organizer_party_id: 1, valid_from: "2026-01-01", valid_to: null },
    ]);
    vi.mocked(groupsApi.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(termsApi.getTerms).mockResolvedValue([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Dalej →" }));
    await waitFor(() => expect(groupsApi.createMyCircle).toHaveBeenCalled());

    const dateInput = await within(dialog).findByLabelText("Data");
    fireEvent.change(dateInput, { target: { value: "2026-02-01" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Hint disappears purely because `!isOrganizer` flips false — it was
    // never dismissed via its own "Zamknij" button in this test.
    await waitFor(() => expect(screen.queryByText("Dodaj swój pierwszy termin")).not.toBeInTheDocument());
    expect(localStorage.getItem("hint_first_term_dismissed")).toBeNull();
  });

  it("ORGANIZER first-term hint auto-hides after a term is added via the real ORGANIZER 1-step stepper (not just terms mocked directly)", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.createTerm).mockResolvedValue({
      id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "",
    });
    renderPanel();

    expect(await screen.findByText("Ustal pierwsze zajęcia w swoim kręgu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj termin →" }));

    const dialog = await screen.findByRole("dialog", { name: "Dodaj pierwszy termin" });
    const dateInput = await within(dialog).findByLabelText("Data");
    fireEvent.change(dateInput, { target: { value: "2026-02-01" } });

    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dodaj termin" }));

    await waitFor(() => expect(termsApi.createTerm).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gotowe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await waitFor(() =>
      expect(screen.queryByText("Ustal pierwsze zajęcia w swoim kręgu.")).not.toBeInTheDocument(),
    );
    // org-polish hint is a separate, still-undismissed card — unaffected.
    expect(screen.getByText("Dopracuj stronę organizacji")).toBeInTheDocument();
  });
});

describe("PanelPage — Rodzina section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('"Mój dom" hamburger item renders and navigates to the family list (name + role tag, no avatars)', async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));

    expect(await screen.findByRole("heading", { name: "Mój dom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("(Ty)")).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("(opiekun)")).toBeInTheDocument();
    // no avatars — rows carry no <img> element
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("inline add-member form submits and the new member appears without a reload", async () => {
    mockGuestDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValueOnce([]).mockResolvedValueOnce(mockGuardians);
    vi.mocked(familiesApi.createLightweightMembers).mockResolvedValue({
      family: mockFamily,
      guardians: mockGuardians,
    });
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));
    await screen.findByRole("heading", { name: "Mój dom", level: 2 });

    fireEvent.change(screen.getByPlaceholderText("np. Zosia Kowalska"), {
      target: { value: "Marek Kowalski" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(familiesApi.createLightweightMembers).toHaveBeenCalledWith([
        { name: "Marek Kowalski", role_type: "GUARDIAN" },
      ]),
    );
    // list refreshes in place — no reload/navigation required
    expect(await screen.findByText("Marek Kowalski")).toBeInTheDocument();
  });

  it('the "Mój dom" section is reachable and shows the same family list for both GUEST and ORGANIZER accounts', async () => {
    mockOrganizerDefaults();
    vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([mockFamily]);
    vi.mocked(familiesApi.getGuardians).mockResolvedValue(mockGuardians);
    renderPanel();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Mój dom/ }));

    expect(await screen.findByRole("heading", { name: "Mój dom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Marek Kowalski", { selector: "h3" })).toBeInTheDocument();
  });
});

describe("PanelPage — Spotkania list links to the public circle page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("each term row in the Spotkania list is a link (the whole tile) to the public circle page, not the authenticated one", async () => {
    mockOrganizerDefaults();
    vi.mocked(termsApi.getTerms).mockResolvedValue([
      { id: 1, circle_group_id: 5, occurs_on: "2026-02-01", description: null, created_at: "", updated_at: "" },
    ]);
    vi.mocked(termsApi.getNeededItems).mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Spotkania" }));

    const link = await screen.findByRole("link", { name: new RegExp(mockGroup.name) });
    expect(link).toHaveAttribute("href", `/krag/${mockGroup.id}/publiczny`);
  });
});
